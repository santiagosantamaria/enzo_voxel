// The ground and clouds on the graphics card (WebGL2).
//
// drawWorld (scene.ts) walks the screen columns from the nearest depth step to the farthest and
// fills each column front to back. Here every pixel does that walk on its own: it steps through the
// same depths (the scene's stepV, uploaded each frame), and the first cloud or ground column that
// covers it gives its colour and depth. For one pixel, "column k covers row y" comes down to
// comparing the column's height with the height a column needs at that depth to reach the row,
// which falls in a straight line with depth (zNeed below), so the walk is a few multiplies a step.
//
// Most of a pixel's walk is over open sea or through empty sky, so it jumps: hBlock holds the
// tallest column of every 16 x 16 block of the map and cBlock the lowest cloud rank in every
// 16 x 16 block of the cloud map. When the line passes over a whole block (and no cloud in it can
// show), the walk goes straight to the first step past the block.
//
// Along a screen column, a row higher up needs taller columns at every depth, so it can never meet
// the ground nearer than the rows below it. Two small passes first walk the lowest row of every
// band of 64 rows, then of every band of 8 rows (starting where its 64-row band met the ground),
// and keep the step where each met it. A pixel then only looks for clouds before its band's step,
// and walks the ground from there on.
//
// The colours and depths are read back into the scene's frame and depth buffers, so everything else
// (sky, boats, the person, the plane, the cockpit) draws over them on the CPU exactly as before.
// When there is no WebGL2, or the context is lost, draw() returns false and the scene uses
// drawWorld instead.

import { log } from './log'

const gpuLog = log.child('gpu')

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

function fragSource(K, band) {
  return `#version 300 es
${band ? '#define BAND' : ''}
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp sampler2D;

#define CLOUD_ALT ${K.CLOUD_ALT}.0
#define CLOUD_TOP ${K.ZTOP}.0
#define NMASK ${K.N - 1}
#define NCMASK ${K.NC - 1}
#define NC ${K.NC}
#define FLOOR_H ${K.FLOOR_H}.0
#define M_HSTONE ${K.M_HSTONE}
#define M_SLAT ${K.M_SLAT}
#define M_IRON ${K.M_IRON}
#define M_DOOR ${K.M_DOOR}
#define FAC_L1 ${Number(K.FAC_L1).toFixed(3)}
#define F_ROOF ${K.F_ROOF}
#define FAC_WALK ${K.FAC_WALK}
#define FAC_L2 ${Number(K.FAC_L2).toFixed(3)}
#define FAC_L3 ${Number(K.FAC_L3).toFixed(3)}
#define NSHIFT ${Math.round(Math.log2(K.N))}
#define JET_W ${K.JET_W}
#define JET_L ${K.JET_L}
#define PIV_K ${Number(K.PIV_K).toFixed(6)}
#define EPS ${Number(K.EPS).toExponential()}
#define FOG_STEPS ${K.FOG_STEPS}.0

uniform usampler2D uHeight;  // height of every map cell
uniform usampler2D uMat;     // material of every map cell
uniform usampler2D uCloud;   // cloud map: rank << 4 | thickness
uniform usampler2D uNoise;   // 256 x 256 noise for foam and sparkle
uniform usampler2D uMask;    // the plane's shadow outline
uniform usampler2D uPal;     // rows: top lit, top shaded, side lit, side shaded, flags, other colours
uniform sampler2D uSteps;    // the depth of every step, 64 to a row
uniform usampler2D uHBlock;  // the tallest column in each 16 x 16 block of the map
uniform usampler2D uCBlock;  // the lowest cloud rank in each 16 x 16 block of the cloud map (255: none)
uniform usampler2D uStepAt;  // for depth uV0 + i·uDV, the first step at least that deep (128 to a row)
uniform float uV0, uDVInv;
uniform int uStepAtN;

uniform int uN;              // steps 1..uN are drawn; step 0 is where the walk starts
uniform float uC, uS, uQ, uScale, uTn, uCx, uCy, uA;
uniform ivec2 uB;            // where the camera samples the map (whole cells) …
uniform vec2 uBf;            // … and the fraction
uniform int uCloudsOn, uRankMax;
uniform ivec2 uCd;           // cloud drift (whole cells) …
uniform vec2 uCdf;           // … and the fraction
uniform ivec2 uCs;           // where a cloud's shadow falls, whole cells
uniform int uTW1, uTW2, uTF; // water sparkle and foam timing
uniform vec2 uSun;
uniform int uBlooms;
uniform int uFogOn;
uniform float uFogStart, uViewDist;
uniform int uFogLv[12];      // haze for each step of distance
uniform ivec3 uHz;           // haze colour
uniform vec3 uHole;          // radius, x, y of the hole in the clouds over the boat
uniform int uNShadow;
uniform ivec2 uSjI[3];       // each plane's shadow: where it falls (whole cells) …
uniform vec2 uSjF[3];        // … and the fraction
uniform vec4 uSr[3];         // its axes: across (x, y), along (x, y)
uniform float uSic[3];
uniform float uIsc, uReach;
uniform float uHMax;         // the tallest column on the map
uniform float uTop;          // nothing reaches higher than this (clouds included)

#ifdef BAND
uniform int uBandShift;      // bands of 1 << uBandShift rows
uniform int uPrevShift;      // when not 0, the coarser bands (uPrev) this walk can start from
uniform usampler2D uPrev;
layout(location = 0) out uint oStep;
#else
uniform usampler2D uBand;    // for every column and band of 8 rows, the first step the ground reaches
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oDepth;
#endif

const int BAYER[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);

float stepV(int k) { return texelFetch(uSteps, ivec2(k & 63, k >> 6), 0).r; }
uint pal(int row, int i) { return texelFetch(uPal, ivec2(i, row), 0).r; }
uint cloudAt(int x, int y) { return texelFetch(uCloud, ivec2(x & NCMASK, y & NCMASK), 0).r; }
uint noise(int x, int y) { return texelFetch(uNoise, ivec2(x & 255, y & 255), 0).r; }
// hash8 in scene.ts: the same bits, as uint arithmetic wraps like Math.imul
uint hash8(uint o) {
  uint h = (o ^ (o >> 13)) * 0x5bd1e995u;
  h ^= h >> 15;
  h *= 0x2c1b3c6du;
  return (h >> 24) & 255u;
}

// facadeAt in scene.ts, the same rules: what a house wall shows at a point of its face, as a role
// 0 wall · 1 wall in shadow · 2 stone · 3 stone in shadow · 4 shutter · 5 slat · 6 lit window · 7 iron · 8 door
// · 9 far off, the wall and the shutters together
int facadeAt(int fk, float dTop, float a, float mp, uint cell, uint on, int floors) {
  int kind = fk & 7;
  float da = abs(a - 0.5);
  int fl = max(0, int(floor(dTop / FLOOR_H)));
  float r = dTop - float(fl) * FLOOR_H;
  bool ground = fl >= floors - 1;
  bool stone = kind == 3;
  int dk = stone ? 3 : 1;
  bool windowed = kind == 2 || (kind == 4 && !ground);
  bool lit = windowed && on != 0u && hash8(cell * 4u + uint(fl)) < on;
  if (mp < FAC_L1) {
    if (stone || fl >= floors) return 2;
    if (r >= 1.4 && r < 3.95) return lit ? 6 : 9;
    return 0;
  }
  bool l2 = mp >= FAC_L2;
  bool l3 = mp >= FAC_L3;
  if (dTop < 0.45) return l2 && dTop > 0.3 && fract(a * 5.0) < 0.5 ? 3 : 2;
  if (l2 && dTop < 0.6) return dk;
  if (fl >= floors) return 2;
  bool door = kind == 4 && ground;
  if (door) {
    float top = 1.3 + 0.6 * (1.0 - sqrt(max(0.0, 1.0 - (da / 0.38) * (da / 0.38))));
    if (da < 0.38 && r >= top) return l3 && da < 0.02 ? 7 : 8;
    if (l2 && da < 0.45 && r >= top - 0.2) return 2;
  }
  if (r > FLOOR_H - 0.28) return 2;
  if (kind == 3) return l2 && fract(dTop / 0.8) < 0.08 ? 3 : 2;
  if (windowed) {
    if (kind == 4 && fl == floors - 2) {
      if (r >= 3.2 && r < 3.95 && da < 0.47) {
        if (!l3 || r < 3.3 || fract(a * 9.0) < 0.4) return 7;
      } else if (r >= 3.95 && r < 4.15 && da < 0.5) return 2;
      else if (l2 && r >= 4.15 && r < 4.4 && da < 0.45) return dk;
    }
    if (da < 0.4 && r >= 1.4 && r < 3.95) {
      if (lit) return l3 && da < 0.02 ? 5 : 6;
      return l3 && (da < 0.02 || fract(r * 5.0) < 0.3) ? 5 : 4;
    }
    if (l2 && da < 0.47 && r >= 1.25 && r < 4.1) return 2;
    if (l2 && da < 0.5 && r >= 0.95 && r < 1.25) return 2;
  }
  return 0;
}

// the depth at which the line t0 + t1·v leaves [lo, hi] (r1 is 1 / t1, or 0 when t1 is 0)
float exitV(float t0, float t1, float r1, float lo, float hi) {
  if (t1 > 0.0) return (hi - t0) * r1;
  if (t1 < 0.0) return (lo - t0) * r1;
  return 1e30;
}

// the first step at least as deep as v (uN + 1 when there is none)
int firstStepAt(float v) {
  // one slot back, in case rounding put v just past a slot's start
  int i = max(0, int(clamp((v - uV0) * uDVInv, 0.0, float(uStepAtN - 1))) - 1);
  int k = int(texelFetch(uStepAt, ivec2(i & 127, i >> 7), 0).r);
  while (k <= uN && stepV(k) < v) k++;
  return k;
}

bool inHole(int px, int y) {
  float R = uHole.x;
  if (R <= 0.0) return false;
  float dx = float(px) - uHole.y;
  float dy = (float(y) - uHole.z) * 1.15;
  float d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return false;
  if (d2 < (R * 0.6) * (R * 0.6)) return true;
  float t = (sqrt(d2) - R * 0.6) / (R * 0.4);
  return float(BAYER[((y & 3) << 2) | (px & 3)]) >= t * 16.0;
}

int fogAt(float v) {
  if (uFogOn == 0 || v <= uFogStart) return 0;
  float f = (v - uFogStart) / (uViewDist - uFogStart);
  return uFogLv[min(11, int(sqrt(f) * FOG_STEPS + 0.5))];
}

// a packed colour (as the scene stores it: red in the low byte), hazed by fog out of 256
vec4 colour(uint col, int fog) {
  ivec3 c = ivec3(int(col & 255u), int((col >> 8) & 255u), int((col >> 16) & 255u));
  if (fog <= 0) return vec4(vec3(c), float(col >> 24)) / 255.0;
  ivec3 r = (c * (256 - fog) + uHz * fog) >> 8;
  return vec4(vec3(r) / 255.0, 1.0);
}

vec4 packDepth(float v) {
  uint b = floatBitsToUint(v);
  return vec4(float(b & 255u), float((b >> 8) & 255u), float((b >> 16) & 255u), float(b >> 24)) / 255.0;
}

// this pixel's line: a column needs height a0 + a1·v at depth v to reach the row (drawWorld: its
// top's row, floor(R - m·h), is at or above y), and the pixel's screen column samples the map at
// (tx0 + tx1·v, ty0 + ty1·v), cells past uB; rx1, ry1 are 1 / tx1, 1 / ty1 (0 for 0)
float a0, a1, tx0, tx1, ty0, ty1, rx1, ry1;

void setLine(float fpx, int y) {
  float K = (uCy + EPS - float(y) - 1.0) / uScale;
  a0 = uA + K;
  a1 = K * uQ - uTn;
  float dxp = fpx - uCx;
  tx0 = uBf.x + uC * dxp / uScale;
  tx1 = uC * uQ * dxp / uScale - uS;
  ty0 = uBf.y - uS * dxp / uScale;
  ty1 = -uS * uQ * dxp / uScale - uC;
  rx1 = tx1 != 0.0 ? 1.0 / tx1 : 0.0;
  ry1 = ty1 != 0.0 ? 1.0 / ty1 : 0.0;
}

// looking down, the first step where the line has come below z (uN + 1: it never does); else 1
int firstBelow(float z) {
  if (a1 >= 0.0) return 1;
  int lo = 0;
  int hi = uN + 1;
  while (lo < hi) {
    int mid = (lo + hi) >> 1;
    if (a0 + a1 * stepV(mid) < z) hi = mid; else lo = mid + 1;
  }
  return max(1, lo);
}

#ifdef BAND
// the first step at which the ground reaches the lowest row of this band (uN + 1: none does)
void main() {
  int px = int(gl_FragCoord.x);
  int y = ((int(gl_FragCoord.y) + 1) << uBandShift) - 1;
  setLine(float(px), y);
  oStep = uint(uN + 1);
  int k = firstBelow(uHMax);
  if (uPrevShift > 0) k = max(k, int(texelFetch(uPrev, ivec2(px, y >> uPrevShift), 0).r) - 1);
  float zPrev = a0 + a1 * stepV(k - 1);
  for (; k <= uN; k++) {
    float v = stepV(k);
    float zk = a0 + a1 * v;
    float lo = min(zk, zPrev);
    if (lo >= uHMax) {
      if (a1 > 0.0) return; // rising above every column
      zPrev = zk;
      continue;
    }
    float tx = tx0 + tx1 * v;
    float ty = ty0 + ty1 * v;
    int gx = uB.x + int(floor(tx));
    int gy = uB.y + int(floor(ty));
    float M = float(texelFetch(uHBlock, ivec2((gx & NMASK) >> 4, (gy & NMASK) >> 4), 0).r);
    if (lo >= M) {
      // over the tallest column of this block: when the line stays over it, jump past the block
      float sx0 = float(((gx >> 4) << 4) - uB.x);
      float sy0 = float(((gy >> 4) << 4) - uB.y);
      float vEx = min(exitV(tx0, tx1, rx1, sx0 + 0.01, sx0 + 15.99), exitV(ty0, ty1, ry1, sy0 + 0.01, sy0 + 15.99));
      if (M <= min(zPrev, a0 + a1 * vEx)) {
        int kk = firstStepAt(vEx) - 1;
        if (kk > k) {
          k = kk;
          zPrev = a0 + a1 * stepV(kk);
          continue;
        }
      }
      zPrev = zk;
      continue;
    }
    // the same test as the ground's below: its wall (h > zPrev) or its top (h > zk)
    if (float(texelFetch(uHeight, ivec2(gx & NMASK, gy & NMASK), 0).r) > lo) {
      oStep = uint(k);
      return;
    }
    zPrev = zk;
  }
}
#else
// the face of cloud cv that the step from zPrev down or up to zk meets, if one shows at this pixel:
// its top, its underside, or a side of its stack of thickness layers
bool cloudFace(uint cv, float zk, float zPrev, int px, int y, out uint col) {
  col = 0u;
  if (cv == 0u || int(cv >> 4) >= uRankMax) return false;
  int tk = int(cv & 15u);
  float zt = CLOUD_ALT + float(tk - 1);
  bool checker = tk == 1 && ((px + y) & 1) == 0;
  bool face = false;
  if (zk < zt && zt <= zPrev) { if (!checker) { face = true; col = pal(5, tk - 1); } }
  else if (zPrev < CLOUD_ALT && CLOUD_ALT <= zk) { if (!checker) { face = true; col = pal(5, 16); } }
  else if (zPrev >= CLOUD_ALT && zPrev < zt) { face = true; col = pal(5, 8 + int(floor(zPrev)) - int(CLOUD_ALT)); }
  return face && !inHole(px, y);
}

void main() {
  int px = int(gl_FragCoord.x);
  int y = int(gl_FragCoord.y);
  float fpx = float(px);
  oColor = vec4(0.0);
  oDepth = packDepth(1e9);
  setLine(fpx, y);
  ivec2 cOff = uB - uCd + NC;
  bool slabPossible = uCloudsOn == 1;
  // looking down, start where the line has come below everything
  int k = firstBelow(uTop);
  // the ground cannot reach this pixel before step kT: no nearer than the lowest row of its band
  // (one step back, for rounding)
  int kT = max(1, int(texelFetch(uBand, ivec2(px, y >> 3), 0).r) - 1);

  // before kT only a cloud can cover the pixel: walk the steps where the line is among the clouds
  if (slabPossible && k < kT) {
    int c0 = k;
    int c1 = uN;
    if (a1 < 0.0) {
      c0 = firstStepAt((CLOUD_TOP - a0) / a1) - 1;
      c1 = firstStepAt((CLOUD_ALT - a0) / a1) + 1;
    } else if (a1 > 0.0) {
      c0 = firstStepAt((CLOUD_ALT - a0) / a1) - 1;
      c1 = firstStepAt((CLOUD_TOP - a0) / a1) + 1;
    } else if (a0 < CLOUD_ALT || a0 >= CLOUD_TOP) {
      c0 = uN + 1;
    }
    int kc = max(k, c0);
    int kEnd = min(kT - 1, c1);
    float zPrev = a0 + a1 * stepV(kc - 1);
    for (; kc <= kEnd; kc++) {
      float v = stepV(kc);
      float zk = a0 + a1 * v;
      if (max(zk, zPrev) >= CLOUD_ALT && min(zk, zPrev) < CLOUD_TOP) {
        float tx = tx0 + tx1 * v;
        float ty = ty0 + ty1 * v;
        int ccx = cOff.x + int(floor(tx - uCdf.x));
        int ccy = cOff.y + int(floor(ty - uCdf.y));
        if (int(texelFetch(uCBlock, ivec2((ccx & NCMASK) >> 4, (ccy & NCMASK) >> 4), 0).r) >= uRankMax) {
          // no cloud in this block of the cloud map can show: on to the last step inside it
          float cx0 = float(((ccx >> 4) << 4) - cOff.x);
          float cy0 = float(((ccy >> 4) << 4) - cOff.y);
          int kk = firstStepAt(min(exitV(tx0 - uCdf.x, tx1, rx1, cx0 + 0.01, cx0 + 15.99), exitV(ty0 - uCdf.y, ty1, ry1, cy0 + 0.01, cy0 + 15.99))) - 1;
          if (kk > kc) {
            kc = kk;
            zPrev = a0 + a1 * stepV(kk);
            continue;
          }
        } else {
          uint col;
          if (cloudFace(cloudAt(ccx, ccy), zk, zPrev, px, y, col)) {
            oColor = colour(col, fogAt(v));
            oDepth = packDepth(v);
            return;
          }
        }
      }
      zPrev = zk;
    }
  }

  // from kT on, the clouds and the ground
  k = max(k, kT);
  float vPrev = stepV(k - 1);
  float zPrev = a0 + a1 * vPrev;
  for (; k <= uN; k++) {
    float v = stepV(k);
    float zk = a0 + a1 * v;
    float lo = min(zk, zPrev);
    float hiZ = max(zk, zPrev);
    if (lo >= uTop) {
      if (a1 > 0.0) return; // rising above everything: nothing more can cover this pixel
      zPrev = zk;
      vPrev = v;
      continue;
    }
    // where this step samples the map for this screen column
    float tx = tx0 + tx1 * v;
    float ty = ty0 + ty1 * v;
    float flx = floor(tx);
    float fly = floor(ty);
    int gx = uB.x + int(flx);
    int gy = uB.y + int(fly);

    // clouds: the top face, the underside, or a side face of a stack of tk layers
    if (slabPossible && hiZ >= CLOUD_ALT && lo < CLOUD_TOP) {
      uint col;
      if (cloudFace(cloudAt(cOff.x + int(floor(tx - uCdf.x)), cOff.y + int(floor(ty - uCdf.y))), zk, zPrev, px, y, col)) {
        oColor = colour(col, fogAt(v));
        oDepth = packDepth(v);
        return;
      }
    }

    // the tallest column of this block: when the line passes over all of it, jump past the block
    float M = float(texelFetch(uHBlock, ivec2((gx & NMASK) >> 4, (gy & NMASK) >> 4), 0).r);
    if (lo >= M) {
      float sx0 = float(((gx >> 4) << 4) - uB.x);
      float sy0 = float(((gy >> 4) << 4) - uB.y);
      float vEx = min(exitV(tx0, tx1, rx1, sx0 + 0.01, sx0 + 15.99), exitV(ty0, ty1, ry1, sy0 + 0.01, sy0 + 15.99));
      float zEx = a0 + a1 * vEx;
      bool ok = M <= min(zPrev, zEx);
      if (ok && slabPossible && max(zPrev, zEx) >= CLOUD_ALT && min(zPrev, zEx) < CLOUD_TOP) {
        // among the clouds: only when no cloud in this block of the cloud map can show
        int ccx = cOff.x + int(floor(tx - uCdf.x));
        int ccy = cOff.y + int(floor(ty - uCdf.y));
        if (int(texelFetch(uCBlock, ivec2((ccx & NCMASK) >> 4, (ccy & NCMASK) >> 4), 0).r) >= uRankMax) {
          float cx0 = float(((ccx >> 4) << 4) - cOff.x);
          float cy0 = float(((ccy >> 4) << 4) - cOff.y);
          vEx = min(vEx, min(exitV(tx0 - uCdf.x, tx1, rx1, cx0 + 0.01, cx0 + 15.99), exitV(ty0 - uCdf.y, ty1, ry1, cy0 + 0.01, cy0 + 15.99)));
        } else {
          ok = false;
        }
      }
      if (ok) {
        // the last step before the line leaves the block
        int kk = firstStepAt(vEx) - 1;
        if (kk > k) {
          k = kk;
          vPrev = stepV(kk);
          zPrev = a0 + a1 * vPrev;
          continue;
        }
      }
      zPrev = zk;
      vPrev = v;
      continue;
    }

    // the ground: the column's wall (it reached this row at the step before) or its top
    if (lo < uHMax) {
      float h = float(texelFetch(uHeight, ivec2(gx & NMASK, gy & NMASK), 0).r);
      bool wall = h > zPrev;
      if (wall || h > zk) {
        int m = int(texelFetch(uMat, ivec2(gx & NMASK, gy & NMASK), 0).r);
        // in shadow: under a cloud, or under a plane
        bool shade = false;
        if (uCloudsOn == 1) {
          uint sv = cloudAt(gx + uCs.x, gy + uCs.y);
          shade = int(sv & 15u) > 1 && int(sv >> 4) < uRankMax;
        }
        for (int j = 0; j < 3; j++) {
          if (shade || j >= uNShadow) break;
          float dx = float(gx - uSjI[j].x) - uSjF[j].x + uSun.x * h;
          float dy = float(gy - uSjI[j].y) - uSjF[j].y + uSun.y * h;
          if (dx > -uReach && dx < uReach && dy > -uReach && dy < uReach) {
            float a = (dx * uSr[j].x + dy * uSr[j].y) * uSic[j];
            float b = (dx * uSr[j].z + dy * uSr[j].w) * uIsc;
            int i = int(floor(a + float(JET_W) / 2.0));
            int kk = int(floor(PIV_K - b + 0.5));
            if (i >= 0 && i < JET_W && kk >= 0 && kk < JET_L && texelFetch(uMask, ivec2(i, kk), 0).r == 1u) shade = true;
          }
        }
        uint topC = pal(shade ? 1 : 0, m);
        uint sideC;
        if (m < 4) {
          // water: foam on the surf line, sparkle in the sun close by
          if (m == 3) {
            if (((int(noise(gx, gy)) + uTF) & 255) < 120) topC = shade ? pal(1, 2) : pal(5, 17);
          } else if (!shade && (1.0 + uQ * v) / uScale < 1.8) {
            uint n1 = noise((gx + uTW1) >> 2, gy);
            if (n1 > 243u) {
              uint n2 = noise((gx + 1024 - uTW2) >> 2, gy + 91);
              if (n2 > 128u) topC = n1 > 252u ? pal(5, 19) : pal(5, 18);
            }
          }
          sideC = topC;
        } else {
          sideC = pal(shade ? 3 : 2, m);
          uint flags = pal(4, m);
          // a flower is a small bloom in the middle of its cell, with green leaves round it
          if ((flags & 1u) != 0u) {
            float fx = tx - flx - 0.5;
            float fy = ty - fly - 0.5;
            if (uBlooms == 0 || fx * fx + fy * fy > 0.09) topC = pal(shade ? 1 : 0, 6);
          }
        }
        uint col = wall ? sideC : topC;
        int fk = int((pal(4, m) >> 2) & 15u);
        if (wall && fk != 0) {
          // a house: its facade painted on (facadeAt). First where the ray came into the house: walk back
          // from this cell towards where the ray was at the step before, cell by cell, to the last one that
          // is part of the house; when that is a wall, the ray met it on the face it crossed to come in,
          // and that is what shows, up to the eaves (see scene.ts)
          float txp = tx0 + tx1 * vPrev;
          float typ = ty0 + ty1 * vPrev;
          int ix = int(flx);
          int iy = int(fly);
          float dx = txp - tx;
          float dy = typ - ty;
          float sX = dx > 0.0 ? (flx + 1.0 - tx) / dx : dx < 0.0 ? (flx - tx) / dx : 2.0;
          float sY = dy > 0.0 ? (fly + 1.0 - ty) / dy : dy < 0.0 ? (fly - ty) / dy : 2.0;
          float dsX = dx != 0.0 ? abs(1.0 / dx) : 2.0;
          float dsY = dy != 0.0 ? abs(1.0 / dy) : 2.0;
          bool facade = false;
          bool xEdge = true;
          float t = 0.0;
          int kind = fk;
          int fm = m;
          int cx = gx;
          int cy = gy;
          float hW = h;
          float hF = -1.0;
          int ek = fk;
          int em = m;
          int ex = gx;
          int ey = gy;
          for (int n = 0; n < FAC_WALK; n++) {
            bool isX = sX < sY;
            float sc = isX ? sX : sY;
            if (sc > 1.0) break;
            if (isX) { ix += dx > 0.0 ? 1 : -1; sX += dsX; } else { iy += dy > 0.0 ? 1 : -1; sY += dsY; }
            ivec2 c2 = ivec2((uB.x + ix) & NMASK, (uB.y + iy) & NMASK);
            int m2 = int(texelFetch(uMat, c2, 0).r);
            int k2 = int((pal(4, m2) >> 2) & 15u);
            if (k2 == 0) {
              if ((ek & 7) != F_ROOF) {
                facade = true;
                xEdge = isX;
                t = 1.0 - sc;
                kind = ek;
                fm = em;
                cx = ex;
                cy = ey;
                hW = float(texelFetch(uHeight, ivec2(ex & NMASK, ey & NMASK), 0).r);
                hF = float(texelFetch(uHeight, c2, 0).r);
              }
              break;
            }
            ek = k2;
            em = m2;
            ex = uB.x + ix;
            ey = uB.y + iy;
          }
          if (!facade && (fk & 7) != F_ROOF) facade = true;
          if (facade) {
            float a = xEdge ? fract(typ + (ty - typ) * t) : fract(txp + (tx - txp) * t);
            if (hF < 0.0) {
              int sx = tx > txp ? -1 : 1;
              int sy = ty > typ ? -1 : 1;
              hF = min(float(texelFetch(uHeight, ivec2((cx + sx) & NMASK, cy & NMASK), 0).r), float(texelFetch(uHeight, ivec2(cx & NMASK, (cy + sy) & NMASK), 0).r));
            }
            int floors = max(1, int(floor((hW - hF) / FLOOR_H + 0.5)));
            // the heights on it are measured where the ray meets the face (see scene.ts)
            float vc = vPrev + (v - vPrev) * t;
            float mc = uScale / (1.0 + uQ * vc);
            float rc = uCy - mc * (uTn * vc - uA) + EPS;
            float z = (rc - float(y)) / mc;
            // over the wall, when this is the roof behind it: the roof's own side
            if ((fk & 7) != F_ROOF || z < hW) {
              uint cell = (uint(cy & NMASK) << NSHIFT) | uint(cx & NMASK);
              int role = facadeAt(kind, hW - z, a, mc, cell, pal(5, 23), floors);
              int lit = shade ? 3 : 2;
              uint wallC = pal(lit, fm);
              uint shutC = shade ? pal(5, 21) : pal(5, 20);
              if (role == 0) col = wallC;
              else if (role == 1) col = pal(3, fm);
              else if (role == 2) col = pal(lit, M_HSTONE);
              else if (role == 3) col = pal(3, M_HSTONE);
              else if (role == 4) col = shutC;
              else if (role == 5) col = pal(lit, M_SLAT);
              else if (role == 6) col = pal(5, 22);
              else if (role == 7) col = pal(lit, M_IRON);
              else if (role == 8) col = pal(lit, M_DOOR);
              else if (role == 9) col = (((wallC & 0xfefefefeu) >> 1) + ((shutC & 0xfefefefeu) >> 1)) | 0xff000000u;
            }
          }
        }
        oColor = colour(col, fogAt(v));
        oDepth = packDepth(v);
        return;
      }
    }
    zPrev = zk;
    vPrev = v;
  }
}
#endif
`
}

export function createGpuWorld() {
  let canvas
  try {
    canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
  } catch {
    return null
  }
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  })
  if (!gl) {
    gpuLog.warn('no WebGL2: the ground is drawn on the CPU')
    return null
  }
  let dead = false
  canvas.addEventListener?.('webglcontextlost', (e) => {
    e.preventDefault()
    dead = true
    gpuLog.warn('context lost: the ground is drawn on the CPU')
  })

  let prog = null
  let U = {}
  let progBand = null
  let UB = {}
  let vao = null
  let tHeight, tMat, tCloud, tNoise, tMask, tPal, tSteps, tHBlock, tCBlock, tStepAt
  const STEP_AT = 128 * 64
  const stepAt = new Uint16Array(STEP_AT)
  const hBlock = new Uint8Array(128 * 128)
  const cBlock = new Uint8Array(64 * 64)
  let fbo = null
  let tColor = null
  let tDepth = null
  // the band passes' results and targets: bands of 64 rows, then of 8
  let tBand64 = null
  let tBand8 = null
  let fbo64 = null
  let fbo8 = null
  let tw = 0
  let th = 0
  let stamp = -1
  let hMax = 0
  const steps = new Float32Array(64 * 64)
  const palData = new Uint32Array(64 * 6)
  let fbBytes = new Uint8Array(0)
  let zBytes = new Uint8Array(0)

  function compile(type, src) {
    const sh = gl.createShader(type)
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gpuLog.error('shader did not compile', gl.getShaderInfoLog(sh))
      return null
    }
    return sh
  }

  // textures are made and filled on a spare unit, so the shaders' units 0–11 keep their textures
  const SPARE = 15
  const BAND_UNIT = 10
  const PREV_UNIT = 11
  function texture(internal, w, h) {
    gl.activeTexture(gl.TEXTURE0 + SPARE)
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  function upload8(t, x, y, w, h, data) {
    gl.activeTexture(gl.TEXTURE0 + SPARE)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data)
  }

  // a program and its uniforms' locations by name
  function link(vs, src, locs) {
    const fs = compile(gl.FRAGMENT_SHADER, src)
    if (!fs) return null
    const p = gl.createProgram()
    gl.attachShader(p, vs)
    gl.attachShader(p, fs)
    gl.bindAttribLocation(p, 0, 'aPos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      gpuLog.error('shader did not link', gl.getProgramInfoLog(p))
      return null
    }
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '')
      locs[name] = gl.getUniformLocation(p, name)
    }
    return p
  }

  // the shaders and the textures that never change size, made on the first frame
  function setup(K) {
    const vs = compile(gl.VERTEX_SHADER, VERT)
    if (!vs) return false
    prog = link(vs, fragSource(K, false), U)
    progBand = link(vs, fragSource(K, true), UB)
    if (!prog || !progBand) return false
    vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    // one triangle over the whole viewport
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    tHeight = texture(gl.R8UI, K.N, K.N)
    tMat = texture(gl.R8UI, K.N, K.N)
    tCloud = texture(gl.R8UI, K.NC, K.NC)
    tNoise = texture(gl.R8UI, 256, 256)
    tMask = texture(gl.R8UI, K.JET_W, K.JET_L)
    tPal = texture(gl.R32UI, 64, 6)
    tSteps = texture(gl.R32F, 64, 64)
    tHBlock = texture(gl.R8UI, 128, 128)
    tCBlock = texture(gl.R8UI, 64, 64)
    tStepAt = texture(gl.R16UI, 128, 64)
    fbo = gl.createFramebuffer()
    fbo64 = gl.createFramebuffer()
    fbo8 = gl.createFramebuffer()
    // units 0–9 hold the world for both programs; 10 is the 8-row bands for the pixels, and 11 the
    // 64-row bands for the 8-row pass (both bound each frame)
    const units = [['uHeight', tHeight], ['uMat', tMat], ['uCloud', tCloud], ['uNoise', tNoise], ['uMask', tMask], ['uPal', tPal], ['uSteps', tSteps], ['uHBlock', tHBlock], ['uCBlock', tCBlock], ['uStepAt', tStepAt]]
    units.forEach(([, t], i) => {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, t)
    })
    for (const [p, locs] of [[prog, U], [progBand, UB]]) {
      gl.useProgram(p)
      units.forEach(([name], i) => gl.uniform1i(locs[name], i))
    }
    gl.useProgram(prog)
    gl.uniform1i(U.uBand, BAND_UNIT)
    gl.useProgram(progBand)
    gl.uniform1i(UB.uPrev, PREV_UNIT)
    gl.activeTexture(gl.TEXTURE0 + SPARE)
    return true
  }

  // the targets: colour, the depth's four bytes, and the steps of the two band passes
  function target(w, h) {
    if (w <= tw && h <= th) return
    tw = Math.max(w, tw)
    th = Math.max(h, th)
    for (const t of [tColor, tDepth, tBand64, tBand8]) if (t) gl.deleteTexture(t)
    tColor = texture(gl.RGBA8, tw, th)
    tDepth = texture(gl.RGBA8, tw, th)
    tBand64 = texture(gl.R16UI, tw, (th + 63) >> 6)
    tBand8 = texture(gl.R16UI, tw, (th + 7) >> 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tColor, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tDepth, 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo64)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tBand64, 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0])
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo8)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tBand8, 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0])
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  // the tallest column of each 16 x 16 block, for block rows by0..by1
  function blockRows(G, by0, by1) {
    const N = G.consts.N
    for (let by = by0; by <= by1; by++) {
      for (let bx = 0; bx < 128; bx++) {
        let top = 0
        for (let y = by << 4; y < (by + 1) << 4; y++) {
          const row = y * N + (bx << 4)
          for (let x = 0; x < 16; x++) if (G.heightMap[row + x] > top) top = G.heightMap[row + x]
        }
        hBlock[(by << 7) | bx] = top
      }
    }
    upload8(tHBlock, 0, by0, 128, by1 - by0 + 1, hBlock.subarray(by0 << 7, (by1 + 1) << 7))
  }

  function uploadWorld(G) {
    const K = G.consts
    if (G.stamp !== stamp) {
      stamp = G.stamp
      upload8(tHeight, 0, 0, K.N, K.N, G.heightMap)
      upload8(tMat, 0, 0, K.N, K.N, G.matMap)
      upload8(tCloud, 0, 0, K.NC, K.NC, G.cloudN)
      upload8(tNoise, 0, 0, 256, 256, G.nz)
      hMax = 0
      for (let i = 0; i < G.heightMap.length; i++) if (G.heightMap[i] > hMax) hMax = G.heightMap[i]
      blockRows(G, 0, 127)
      cBlock.fill(255)
      for (let y = 0; y < K.NC; y++) {
        for (let x = 0; x < K.NC; x++) {
          const cv = G.cloudN[y * K.NC + x]
          const b = ((y >> 4) << 6) | (x >> 4)
          if (cv !== 0 && cv >> 4 < cBlock[b]) cBlock[b] = cv >> 4
        }
      }
      upload8(tCBlock, 0, 0, 64, 64, cBlock)
      G.dirty.length = 0
      gpuLog.info('world uploaded', { tallest: hMax })
      return
    }
    // rows changed by bombs since (they only ever lower the ground, so hMax still holds)
    for (let i = 0; i + 1 < G.dirty.length; i += 2) {
      const y0 = Math.max(0, G.dirty[i])
      const y1 = Math.min(K.N - 1, G.dirty[i + 1])
      const wrapLo = G.dirty[i] < 0
      const wrapHi = G.dirty[i + 1] > K.N - 1
      const band = (a, b) => {
        if (b < a) return
        const off = a * K.N
        const len = (b - a + 1) * K.N
        upload8(tHeight, 0, a, K.N, b - a + 1, G.heightMap.subarray(off, off + len))
        upload8(tMat, 0, a, K.N, b - a + 1, G.matMap.subarray(off, off + len))
        blockRows(G, a >> 4, b >> 4)
      }
      band(y0, y1)
      if (wrapLo) band(K.N + G.dirty[i], K.N - 1)
      if (wrapHi) band(0, G.dirty[i + 1] - K.N)
    }
    G.dirty.length = 0
  }

  // time per frame in ms, averaged: setting up and uploading, the shaders (band passes and pixels)
  // with the colour read back, the depth read back
  const timing = { setup: 0, shade: 0, read: 0 }
  const avg = (key, ms) => { timing[key] += (ms - timing[key]) * 0.1 }

  function draw(f, stepV, G, out) {
    const t0 = performance.now()
    if (dead || gl.isContextLost()) {
      dead = true
      return false
    }
    if (!prog && !setup(G.consts)) {
      dead = true
      return false
    }
    const K = G.consts
    gl.useProgram(prog)
    gl.bindVertexArray(vao)
    uploadWorld(G)

    // this frame's palettes, the plane's shadow outline, and the depth of every step
    for (let i = 0; i < 64; i++) {
      palData[i] = f.topLit[i] || 0
      palData[64 + i] = f.topShade[i] || 0
      palData[128 + i] = f.sideLit[i] || 0
      palData[192 + i] = f.sideShade[i] || 0
      palData[256 + i] = (G.bloom[i] ? 1 : 0) | (G.facade[i] << 2)
    }
    for (let i = 0; i < 8; i++) {
      palData[320 + i] = f.cloudTop[i] || 0
      palData[328 + i] = f.cloudSide[i] || 0
    }
    palData[336] = f.cloudUnder
    palData[337] = f.foamCol
    palData[338] = f.sparkA
    palData[339] = f.sparkB
    palData[340] = f.shutterLit
    palData[341] = f.shutterShade
    palData[342] = f.winLit
    palData[343] = f.winOn
    gl.activeTexture(gl.TEXTURE0 + SPARE)
    gl.bindTexture(gl.TEXTURE_2D, tPal)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 6, gl.RED_INTEGER, gl.UNSIGNED_INT, palData)
    upload8(tMask, 0, 0, K.JET_W, K.JET_L, f.shadowMask)
    const n = f.n
    for (let i = 0; i <= n; i++) steps[i] = stepV[i]
    gl.bindTexture(gl.TEXTURE_2D, tSteps)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, (n >> 6) + 1, gl.RED, gl.FLOAT, steps)
    // depth -> first step at least that deep, in slots no wider than the shortest step (0.5)
    const v0 = steps[0]
    const span = Math.max(1e-3, steps[n] - v0)
    const slots = Math.min(STEP_AT, Math.ceil(span / 0.5) + 2)
    const dv = span / Math.max(1, slots - 2)
    let k = 0
    for (let i = 0; i < slots; i++) {
      const at = v0 + i * dv
      while (k <= n && steps[k] < at) k++
      stepAt[i] = k
    }
    gl.bindTexture(gl.TEXTURE_2D, tStepAt)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, ((slots - 1) >> 7) + 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, stepAt)

    // what both programs need: the steps, the camera, the tallest column
    const bxI = Math.floor(f.bx)
    const byI = Math.floor(f.by)
    const shared = (L) => {
      gl.uniform1f(L.uV0, v0)
      gl.uniform1f(L.uDVInv, 1 / dv)
      gl.uniform1i(L.uStepAtN, slots)
      gl.uniform1i(L.uN, n)
      gl.uniform1f(L.uC, f.c)
      gl.uniform1f(L.uS, f.s)
      gl.uniform1f(L.uQ, f.q)
      gl.uniform1f(L.uScale, f.S)
      gl.uniform1f(L.uTn, f.tn)
      gl.uniform1f(L.uCx, f.Cx)
      gl.uniform1f(L.uCy, f.Cy)
      gl.uniform1f(L.uA, f.A)
      gl.uniform2i(L.uB, bxI, byI)
      gl.uniform2f(L.uBf, f.bx - bxI, f.by - byI)
      gl.uniform1f(L.uHMax, hMax)
    }

    // the band passes: the lowest row of every band of 64 rows, then of every band of 8
    target(out.W, out.H)
    const w = out.colHi - out.colLo
    const h = out.rowHi - out.rowLo
    gl.useProgram(progBand)
    shared(UB)
    const t1 = performance.now()
    for (const [shift, prev, into, from] of [[6, 0, fbo64, tBand8], [3, 6, fbo8, tBand64]]) {
      // 'from' is only read by the 8-row pass; the 64-row pass gets a texture it is not drawing to
      gl.activeTexture(gl.TEXTURE0 + PREV_UNIT)
      gl.bindTexture(gl.TEXTURE_2D, from)
      gl.bindFramebuffer(gl.FRAMEBUFFER, into)
      const b0 = out.rowLo >> shift
      gl.viewport(out.colLo, b0, w, ((out.rowHi - 1) >> shift) - b0 + 1)
      gl.uniform1i(UB.uBandShift, shift)
      gl.uniform1i(UB.uPrevShift, prev)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    gl.activeTexture(gl.TEXTURE0 + BAND_UNIT)
    gl.bindTexture(gl.TEXTURE_2D, tBand8)
    gl.activeTexture(gl.TEXTURE0 + SPARE)

    gl.useProgram(prog)
    shared(U)
    gl.uniform1i(U.uCloudsOn, f.cloudsOn ? 1 : 0)
    gl.uniform1i(U.uRankMax, f.rankMax)
    const cdxI = Math.floor(f.cdx)
    const cdyI = Math.floor(f.cdy)
    gl.uniform2i(U.uCd, cdxI, cdyI)
    gl.uniform2f(U.uCdf, f.cdx - cdxI, f.cdy - cdyI)
    gl.uniform2i(U.uCs, Math.floor(f.csx), Math.floor(f.csy))
    gl.uniform1i(U.uTW1, f.tW1)
    gl.uniform1i(U.uTW2, f.tW2)
    gl.uniform1i(U.uTF, f.tF)
    gl.uniform2f(U.uSun, f.sx, f.sy)
    gl.uniform1i(U.uBlooms, f.blooms ? 1 : 0)
    gl.uniform1i(U.uFogOn, f.q > 0 ? 1 : 0)
    gl.uniform1f(U.uFogStart, f.fogStart)
    gl.uniform1f(U.uViewDist, f.viewDist)
    const lv = new Int32Array(12)
    for (let i = 0; i < 12; i++) lv[i] = Math.min(256, i * (256 / K.FOG_STEPS)) | 0
    gl.uniform1iv(U.uFogLv, lv)
    gl.uniform3i(U.uHz, f.hazeCol & 255, (f.hazeCol >> 8) & 255, (f.hazeCol >> 16) & 255)
    gl.uniform3f(U.uHole, f.holeR, f.holeCx, f.holeCy)
    gl.uniform1i(U.uNShadow, f.nShadow)
    const sjI = new Int32Array(6)
    const sjF = new Float32Array(6)
    const sr = new Float32Array(12)
    const sic = new Float32Array(3)
    for (let j = 0; j < 3; j++) {
      sjI[j * 2] = Math.floor(f.sjx[j])
      sjI[j * 2 + 1] = Math.floor(f.sjy[j])
      sjF[j * 2] = f.sjx[j] - sjI[j * 2]
      sjF[j * 2 + 1] = f.sjy[j] - sjI[j * 2 + 1]
      sr[j * 4] = f.srx[j]
      sr[j * 4 + 1] = f.sry[j]
      sr[j * 4 + 2] = f.sfx[j]
      sr[j * 4 + 3] = f.sfy[j]
      sic[j] = f.sic[j]
    }
    gl.uniform2iv(U.uSjI, sjI)
    gl.uniform2fv(U.uSjF, sjF)
    gl.uniform4fv(U.uSr, sr)
    gl.uniform1fv(U.uSic, sic)
    gl.uniform1f(U.uIsc, f.isc)
    gl.uniform1f(U.uReach, f.reach)
    gl.uniform1f(U.uTop, f.cloudsOn ? Math.max(K.ZTOP, hMax) : hMax)

    // draw the clip box, then read colours and depths straight into the scene's buffers
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.viewport(out.colLo, out.rowLo, w, h)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    if (fbBytes.buffer !== out.fb.buffer) fbBytes = new Uint8Array(out.fb.buffer, out.fb.byteOffset, out.fb.byteLength)
    if (zBytes.buffer !== out.zbuf.buffer) zBytes = new Uint8Array(out.zbuf.buffer, out.zbuf.byteOffset, out.zbuf.byteLength)
    const at = (out.rowLo * out.W + out.colLo) * 4
    gl.pixelStorei(gl.PACK_ROW_LENGTH, out.W)
    gl.readBuffer(gl.COLOR_ATTACHMENT0)
    gl.readPixels(out.colLo, out.rowLo, w, h, gl.RGBA, gl.UNSIGNED_BYTE, fbBytes, at)
    const t2 = performance.now()
    gl.readBuffer(gl.COLOR_ATTACHMENT1)
    gl.readPixels(out.colLo, out.rowLo, w, h, gl.RGBA, gl.UNSIGNED_BYTE, zBytes, at)
    avg('setup', t1 - t0)
    avg('shade', t2 - t1)
    avg('read', performance.now() - t2)
    return true
  }

  return {
    get ok() {
      return !dead
    },
    draw,
    timing,
    dispose() {
      dead = true
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
