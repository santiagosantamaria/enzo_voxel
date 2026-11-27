// Inside the lake church: a nave of four bays with a chapel off each side of every bay, a crossing under a
// dome on a drum with an arm of the transept either side of it, and a raised presbytery ending in an apse,
// after the churches of Lake Como's western shore rebuilt in the Renaissance manner. Pilasters with gilt
// Corinthian capitals and panels of painted rosettes carry a gilt entablature; over it a barrel vault painted
// deep blue with a gilt lattice, a painting in the middle of each bay and a lunette window over each chapel.
// The pendentives hold four painted roundels, the dome a sky with a ring of saints round a golden glory
// under the lantern; the apse has a painted half dome over walls of beige and pink courses, and windows of
// stained glass. Pews of walnut either side of a middle aisle, a high altar with six candles, an altar rail,
// and an organ in a loft over the door under a rose window. The floor is polished marble, and mirrors it all.
//
// It has its own renderer, a ray tracer. The church is a union of a few simple solids: the nave and the
// transept are boxes under barrel vaults, the crossing a box under a sail vault cut by a drum and a dome,
// the presbytery a box under a vault, the apse a half cylinder under a half dome, the chapels little barrel
// vaults. Each solid is convex, so each pixel's ray finds where it leaves the one it is in and, if that
// point is inside another, goes on through that one. The sun comes in by the lunettes on the left, the
// transept's left window and the drum's windows; it lays patches of light where it falls and shows as
// shafts in the dusty air. The furniture is boxes drawn over that a column at a time, as in the museum,
// and again upside down in the floor where the floor mirrors them.
//
// Units are the world's: the man is about 5.5 tall. x runs across (0 the middle, + to the right facing the
// altar), y from the back of the apse (0) to the door wall (L), z up from the floor. Forward is
// (sin yaw, −cos yaw), as outside: yaw 0 looks up the nave to the altar.

import { buildPaintings } from './paintings.ts'

const L = 96 // the door wall
const NW = 12 // the nave's half width; its vault, a half circle of this radius, …
const SPR = 22 // … springs at this height, so its crown is at 34
const PIL_X = 11.2 // the faces of the pilasters
const PILS = [57, 69, 81, 93] // the pilasters, along
const CHAPELS = [51, 63, 75, 87] // the middle of each bay, and of the chapels off it
const CH_HW = 4.5 // a chapel's half width, and its vault's radius …
const CH_SPR = 13 // … which springs at this height
const CH_X = 16 // its back wall
const Y0 = 21 // the crossing, from the presbytery …
const Y1 = 45 // … to the nave
const YX = 33 // its middle
const TX = 18 // the ends of the transept
const R1 = NW * Math.SQRT2 // the sail vault's sphere, round (0, YX, SPR)
const DRUM0 = 34 // the drum, from the top of the sail vault …
const DRUM1 = 38 // … up to where the dome springs
const DOME_R = NW
const DRUM_LOW = 30 // the drum's solid reaches down into the crossing's to here
const PR_HW = 9 // the presbytery's half width, and its vault's radius …
const PR_SPR = 19 // … which springs here
const YP = 9 // the apse's middle; its radius is PR_HW
const PLAT = 1.2 // the presbytery's floor, raised
const RAIL_Y = 21 // the altar rail, along the edge of it
const STEP_Y = 22.6 // the foot of the steps up to it
const EYE = 4.4
const BODY = 0.9
const WALK = 9
const TURN = 2.1
const FULL_MS = 30 // drawn whole at full size each frame where that takes no longer than this (milliseconds), …
const STRIP_MS = 22 // … else sharpened to it a strip of about this long at a time
const DOOR_HW = 2.6
const DOOR_Z = 8 // the door's arch springs here
const ROSE_Z = 27
const ROSE_R = 5
const LUN_R = 3.6 // the nave's lunettes …
const TLUN_R = 7 // … and the transept ends' big ones
const PEW_X0 = 2.4 // the pews, from the middle aisle …
const PEW_X1 = 9.0 // … out to here
const PEW_Y = 50 // the first row
const PEW_N = 12
const PEW_STEP = 3.4

// the way the sunlight goes: in from the left (−x), down, a little towards the altar
const SUN = (() => {
  const l = Math.hypot(0.62, 0.28, 0.73)
  return [0.62 / l, -0.28 / l, -0.73 / l]
})()
const LX = SUN[0]
const LY = SUN[1]
const LZ = SUN[2]

// what the rays leave the solids through
const S_FLOOR = 1
const S_NWALL = 2
const S_NVAULT = 3
const S_DOORWALL = 4
const S_OPEN = 5 // a face that only ever opens into another solid
const S_TWALL = 6
const S_TVAULT = 7
const S_TEND = 8
const S_XBACK = 9 // the crossing's face towards the presbytery: the arch and the wall round it
const S_PEND = 10
const S_DRUM = 11
const S_DOME = 12
const S_PWALL = 13
const S_PVAULT = 14
const S_AWALL = 15
const S_ADOME = 16
const S_CWALL = 17
const S_CVAULT = 18
const S_CBACK = 19
// the surfaces with nothing of the church beyond them, so a ray that reaches one has hit it
const FINAL = new Uint8Array(24)
for (const s of [S_FLOOR, S_NVAULT, S_DOORWALL, S_TEND, S_DOME, S_PWALL, S_PVAULT, S_AWALL, S_ADOME, S_CWALL, S_CBACK]) FINAL[s] = 1

// colours
const GOLD = [204, 160, 74]
const GOLD_DK = [132, 94, 42]
const GOLD_HI = [246, 214, 128]
const BLUE = [30, 50, 124]
const BLUE_DK = [20, 32, 86]
const CREAM = [238, 226, 202]
const CREAM_DK = [206, 190, 160]
const CREAM_HI = [250, 244, 228]
const STUCCO = [230, 210, 176]
const PINK = [214, 158, 146]
const PINK_DK = [184, 124, 114]
const GREY_M = [150, 148, 156]
const PANEL = [172, 168, 176]
const WHITE_M = [234, 228, 214]
const GREY_F = [182, 180, 186]
const RED_M = [168, 76, 68]
const GOLD_M = [214, 182, 120]
const JOINT = [120, 116, 120]
const BEIGE_C = [228, 210, 178]
const PINK_C = [220, 176, 156]
const WOOD = [112, 68, 38]
const WOOD_DK = [72, 42, 24]
const WOOD_HI = [146, 94, 54]
const LINEN = [244, 242, 232]
const SKIN = [232, 192, 152]
const CLOUD = [236, 232, 226]
const PEWTER = [184, 186, 192]
const LEAD = [46, 42, 48]
const FLAME = [255, 222, 128]
const ROBES = [[176, 46, 42], [44, 70, 156], [60, 112, 70], [196, 150, 60]]
const CLOAKS = [[42, 64, 140], [190, 66, 50], [214, 176, 90], [120, 76, 136]]
const GLASS = [[38, 66, 170], [176, 34, 46], [232, 182, 58], [52, 132, 80], [120, 60, 150], [226, 222, 200]]

const VAULT_ART = ['annunciation', 'adoration', 'baptism', 'supper'] // the bays, from the crossing to the door
const CHAPEL_ART = ['madonna', 'prayer', 'pieta', 'annunciation', 'adoration', 'baptism', 'crucifixion', 'assumption']
const ROUNDEL_ART = ['madonna', 'prayer', 'assumption', 'pieta']
const TRANSEPT_ART = ['crucifixion', 'assumption'] // the left arm's altar, the right's

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
function hash(x, y) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}
/** which bay (0 to 3) a point along the nave is in */
const bayOf = (y) => clamp(Math.round((y - CHAPELS[0]) / 12), 0, 3)

// the colour being worked out, and whether it gives its own light (glass, flames, the day outside)
let R = 0
let G = 0
let B = 0
let glow = false
function set(c, k = 1) {
  R = c[0] * k
  G = c[1] * k
  B = c[2] * k
}
function mix(a, b, t) {
  R = a[0] + (b[0] - a[0]) * t
  G = a[1] + (b[1] - a[1]) * t
  B = a[2] + (b[2] - a[2]) * t
}
// colours some of the paint mixes between, kept here so painting a pixel makes nothing new
const PANE_DAY = [240, 238, 224], PANE_NIGHT = [26, 34, 66]
const OUT_SKY = [206, 226, 242], OUT_SKY_N = [22, 32, 66]
const OUT_HILL = [92, 128, 104], OUT_HILL_N = [14, 22, 30]
const OUT_LAKE = [86, 140, 184], OUT_LAKE_N = [16, 24, 48]
const OUT_PAVE = [214, 204, 182], OUT_PAVE_N = [40, 38, 44]
const LANTERN_DAY = [255, 246, 220], LANTERN_NIGHT = [30, 40, 72]
const SKY_DEEP = [66, 102, 172], SKY_PALE = [172, 198, 228], SKY_GLORY = [250, 224, 150]
const GOLD_PALE = [252, 238, 196]
const GLASS_ROW = [3, 2, 0]
const LOBE_U = [0.27, -0.27, 0, 0], LOBE_W = [0, 0, 0.27, -0.27] // a quatrefoil's four lobes
const PC = [0, 0, 0] // the colour a painted box face gives back
const put = (c, k = 1) => {
  PC[0] = c[0] * k
  PC[1] = c[1] * k
  PC[2] = c[2] * k
  return PC
}

// the paintings, as the museum hangs them (paintings.ts), here in the vault, the chapels and the roundels
let pics = null
let vaultArt = []
/** a painting's pixel at (u, v), across and down from its top left, 0 to 1; false where it is not painted */
function sample(p, u, v) {
  const ix = clamp((u * p.w) | 0, 0, p.w - 1)
  const iy = clamp((v * p.h) | 0, 0, p.h - 1)
  const o = iy * p.w + ix
  if (p.mask && !p.mask[o]) return false
  const c = p.px[o]
  R = c & 255
  G = (c >> 8) & 255
  B = (c >> 16) & 255
  return true
}
/**
 * a painting in a gilt frame, its middle at (u, z) = (0, zc) on a flat face, w wide: true if (u, z) is on
 * it or its frame, with the colour set
 */
function framed(p, u, z, zc, w) {
  const hw = w / 2
  const hh = (w * p.h) / p.w / 2
  const du = Math.abs(u)
  const dz = Math.abs(z - zc)
  if (du > hw + 0.45 || dz > hh + 0.45) return false
  if (du < hw && dz < hh && sample(p, (u + hw) / w, (zc + hh - z) / (hh * 2))) return true
  const e = Math.max(du - hw, dz - hh)
  if (e > 0.32) set(GOLD_DK)
  else if (e > 0.12 && e < 0.2) set(GOLD_HI)
  else set(GOLD)
  return true
}

// ── the surfaces of the solids: each sets R, G, B (and glow)

/** deep blue, a gilt lattice of diamonds over it and a gilt rosette in each: a and b along the surface */
function lattice(a, b) {
  const p = a * 0.42
  const q = b * 0.42
  const i = Math.floor(p + q)
  const j = Math.floor(p - q)
  const fu = p + q - i - 0.5
  const fv = p - q - j - 0.5
  if (Math.abs(fu) > 0.455 || Math.abs(fv) > 0.455) return set(GOLD)
  const r = Math.abs(fu) + Math.abs(fv)
  if (r < 0.13) return set(r < 0.06 ? GOLD_HI : GOLD)
  set(r < 0.19 ? BLUE_DK : BLUE)
}
/** deep blue scattered with little gilt stars */
function stars(a, b) {
  const p = a * 0.8
  const q = b * 0.8
  const i = Math.floor(p)
  const j = Math.floor(q)
  const h = hash(i, j)
  const fx = p - i - 0.25 - h * 0.5
  const fy = q - j - 0.25 - hash(j, i) * 0.5
  if (h < 0.55 && Math.abs(fx) + Math.abs(fy) < 0.1) return set(GOLD_HI)
  set(BLUE)
}
/** the soffit of an arch: cream coffers, each with a gilt rosette, between gilt edges; s along it, e (0 to 1.5) across */
function band(s, e) {
  if (e > 1.32 || e < 0.06) return set(GOLD)
  if (e > 1.18 || e < 0.2) return set(CREAM_DK)
  const q = s / 1.4
  const f = q - Math.floor(q)
  if (f < 0.1) return set(CREAM_DK)
  const rr = Math.hypot((f - 0.55) * 1.4, e - 0.69)
  if (rr < 0.3) return set(rr < 0.13 ? GOLD_HI : GOLD)
  set(CREAM)
}
/** the dado round the foot of every wall, grey marble under a cream moulding; z up from where it stands */
function dado(z) {
  set(z > 1.32 || z < 0.2 ? CREAM : GREY_M)
}
/** clear glass in little leaded diamonds: a lunette or a drum window; u, v across and up it */
function leaded(u, v) {
  glow = true
  const p = (u + v) * 1.3
  const q = (u - v) * 1.3
  if (Math.abs(p - Math.round(p)) < 0.07 || Math.abs(q - Math.round(q)) < 0.07) return set(LEAD, 1 - dark * 0.7)
  mix(PANE_DAY, PANE_NIGHT, dark)
}
/** stained glass: panes of colour in a grid of lead, a gold roundel in the middle light */
function stained(s, z, zc) {
  glow = true
  const k = 1 - dark * 0.82
  const p = s / 0.55
  const q = z / 0.55
  if (Math.abs(p - Math.round(p)) < 0.09 || Math.abs(q - Math.round(q)) < 0.09) return set(LEAD, k)
  const r = Math.hypot(s, z - zc)
  if (r < 0.95) return set(r > 0.78 ? GLASS[3] : GLASS[2], k)
  set(GLASS[(hash(Math.round(p) + 40, Math.round(q)) * GLASS.length) | 0], k * 1.05)
}

let dark = 0

function floorAt(x, y, d) {
  glow = false
  const X = Math.abs(x)
  // under the dome: a great round of inlaid marble, a star of eight points in a red ring
  if (y > Y0 && y < Y1 && X < NW) {
    const v = y - YX
    const r = Math.hypot(x, v)
    if (r < 9.4) {
      if (r > 8.9) return set(RED_M)
      if (r > 8.5) return set(WHITE_M)
      if (r < 1.6) return set(r > 1.25 ? WHITE_M : RED_M)
      const q = Math.atan2(v, x) / (Math.PI / 4) + 8
      const w = Math.abs(q - Math.floor(q) - 0.5) * 2 // 0 in the middle of a point, 1 between two
      if (r < 1.6 + 6.9 * (1 - w)) return set(Math.floor(q) & 1 ? WHITE_M : GOLD_M)
      return set(GREY_F)
    }
  }
  // down the middle aisle a runner of red marble with white lozenges, edged in white
  if (y > Y1 && X < 2.3) {
    if (X > 2.0) return set(WHITE_M)
    const q = (y - Y1) / 3
    const f = Math.abs(q - Math.floor(q) - 0.5)
    if (f * 3 + X < 1.2) return set(WHITE_M, 0.97)
    return set(RED_M)
  }
  // elsewhere squares of white and grey set on the diagonal, finely jointed, a little veined
  const u = (x + y) * 0.2946
  const v = (x - y) * 0.2946
  const i = Math.floor(u)
  const j = Math.floor(v)
  if (d < 34 && (u - i < 0.025 || v - j < 0.025)) return set(JOINT)
  set((i + j) & 1 ? GREY_F : WHITE_M, 1 + 0.045 * Math.sin(x * 1.3 + Math.sin(y * 0.7) * 2.2 + y * 0.31))
}

function naveWallAt(y, z) {
  glow = false
  if (z < 1.6) return dado(z)
  // the frame of the chapel's arch, a keystone at its crown
  const u = y - CHAPELS[bayOf(y)]
  const da = z > CH_SPR ? Math.hypot(u, z - CH_SPR) : Math.abs(u)
  if (da < CH_HW + 0.95) {
    if (da < CH_HW + 0.14 || da > CH_HW + 0.8) return set(GOLD)
    if (z > CH_SPR + CH_HW && Math.abs(u) < 0.45) return set(CREAM_HI)
    return set(CREAM)
  }
  // over it, between the arches, a panel of pink marble
  if (z > 17.4 && z < 19.6 && Math.abs(u) < 3.9) return set(Math.abs(u) > 3.7 || z < 17.6 || z > 19.4 ? GOLD : PINK)
  set(STUCCO)
}

function naveVaultAt(x, y, z) {
  glow = false
  const h = z - SPR
  const s = Math.atan2(x, h) * NW // along the vault from its crown
  // the bands over the pilasters
  for (let k = 0; k < 5; k++) {
    const e = Math.abs(y - (Y1 + 12 * k))
    if (e < 1.5) return band(s, 1.5 - e)
  }
  const k = bayOf(y)
  const u = y - CHAPELS[k]
  // the lunette over the chapel, low on the vault either side
  const lr = Math.hypot(u, h)
  if (lr < LUN_R) return leaded(u, h)
  if (lr < LUN_R + 0.55) return set(lr < LUN_R + 0.15 ? GOLD_HI : GOLD)
  // the painting in the middle of the bay, its top towards the altar
  const a = vaultArt[k]
  if (a) {
    const du = Math.abs(s)
    const dv = Math.abs(u)
    if (du < a.hs + 0.45 && dv < a.hv + 0.45) {
      if (du < a.hs && dv < a.hv && sample(a.p, (s + a.hs) / (a.hs * 2), (u + a.hv) / (a.hv * 2))) return
      const e = Math.max(du - a.hs, dv - a.hv)
      return set(e > 0.32 ? GOLD_DK : e > 0.12 && e < 0.2 ? GOLD_HI : GOLD)
    }
  }
  lattice(s, u)
}

function doorWallAt(x, z) {
  glow = false
  const X = Math.abs(x)
  const top = DOOR_Z + Math.sqrt(Math.max(0, DOOR_HW * DOOR_HW - X * X))
  if (X < DOOR_HW && z < top) {
    // the day outside: the sky, the lake and the far shore, the paving of the square
    glow = true
    if (z > 5.4) return mix(OUT_SKY, OUT_SKY_N, dark)
    if (z > 4.7) return mix(OUT_HILL, OUT_HILL_N, dark)
    if (z > 3.0) return mix(OUT_LAKE, OUT_LAKE_N, dark)
    return mix(OUT_PAVE, OUT_PAVE_N, dark)
  }
  if (X < DOOR_HW + 0.65 && z < top + 0.65) return set(X < DOOR_HW + 0.12 && z < top + 0.12 ? GOLD : GREY_M)
  if (z < 1.6) return dado(z)
  // the organ over the loft: pipes of pewter, tall in the middle, in a case of walnut
  if (z > 14.2 && z < 22 && X < 8.6) {
    const c = (x + 8.5) / 0.5
    const i = Math.floor(c)
    const f = c - i
    const ptop = 17.6 + 3.2 * Math.cos((x / 8.6) * (Math.PI / 2)) + (i % 3) * 0.3
    if (z > ptop + 0.6) return set(z < ptop + 0.9 ? GOLD : WOOD_DK)
    if (z > ptop) return set(WOOD)
    if (f < 0.12 || f > 0.88) return set(WOOD_DK)
    if (z > 15.0 && z < 15.45 && f > 0.3 && f < 0.7) return set(LEAD)
    return set(PEWTER, f > 0.32 && f < 0.48 ? 1.22 : 1 - Math.abs(f - 0.5) * 0.5)
  }
  // the rose window
  const rr = Math.hypot(x, z - ROSE_Z)
  if (rr < ROSE_R) return rose(x, z - ROSE_Z, rr)
  if (rr < ROSE_R + 0.7) return set(rr < ROSE_R + 0.2 ? GOLD_HI : rr > ROSE_R + 0.55 ? GOLD_DK : CREAM)
  if (z > 20 && z < 22) return set(z > 21.4 ? GOLD : CREAM)
  if (z > SPR) return lattice(Math.atan2(x, z - SPR) * NW, z)
  set(STUCCO)
}
/** the rose: a gold heart, twelve petals of blue and red, an outer ring of green, gold and blue */
function rose(x, v, rr) {
  glow = true
  const k = 1 - dark * 0.82
  const q = (Math.atan2(x, v) / (Math.PI * 2) + 1) * 12
  const f = q - Math.floor(q)
  if (rr > ROSE_R - 0.18 || Math.abs(rr - 1.15) < 0.09 || Math.abs(rr - 3.2) < 0.09) return set(LEAD, k)
  if (rr < 1.15) return set(rr < 0.45 ? GLASS[5] : GLASS[2], k)
  if (rr < 3.2) {
    if (f < 0.06 || f > 0.94) return set(LEAD, k)
    const pr = Math.hypot((f - 0.5) * rr * 0.52, rr - 2.2)
    if (pr < 0.42) return set(pr > 0.32 ? LEAD : GLASS[2], k)
    return set(Math.floor(q) & 1 ? GLASS[1] : GLASS[0], k)
  }
  const q2 = q * 2
  const f2 = q2 - Math.floor(q2)
  if (f2 < 0.08) return set(LEAD, k)
  set(GLASS[GLASS_ROW[Math.floor(q2) % 3]], k)
}

function transWallAt(x, z) {
  glow = false
  if (z < 1.6) return dado(z)
  const u = Math.abs(x) - 15
  if (Math.abs(u) < 1.7 && z > 3 && z < 15) return set(Math.abs(u) > 1.55 || z < 3.15 || z > 14.85 ? GOLD : PINK)
  set(STUCCO)
}
function transVaultAt(x, y, z) {
  glow = false
  const s = Math.atan2(y - YX, z - SPR) * NW
  const X = Math.abs(x)
  if (X < 13.5) return band(s, (X - 12) * 1.0)
  lattice(s, x)
}
function transEndAt(x, y, z) {
  glow = false
  const v = y - YX
  if (z > SPR) {
    const lr = Math.hypot(v, z - SPR)
    if (lr < TLUN_R) return leaded(v * 0.7, (z - SPR) * 0.7)
    if (lr < TLUN_R + 0.6) return set(lr < TLUN_R + 0.18 ? GOLD_HI : GOLD)
    return lattice(v, z)
  }
  if (z > 20) return set(z > 21.4 ? GOLD : z < 20.2 ? GOLD_DK : CREAM)
  if (z < 1.6) return dado(z)
  // the altarpiece over the side altar
  if (pics && framed(pics[TRANSEPT_ART[x > 0 ? 1 : 0]], x > 0 ? -v : v, z, 9.6, 6.4)) return
  if (Math.abs(v) > 6 && Math.abs(v) < 9 && z > 3 && z < 16) return set(Math.abs(Math.abs(v) - 7.5) > 1.35 || z < 3.15 || z > 15.85 ? GOLD : PINK)
  set(STUCCO)
}

function triumphAt(x, z) {
  glow = false
  const X = Math.abs(x)
  // the arch into the presbytery, its soffit of coffers and a gilt frame round it
  const da = z > PR_SPR ? Math.hypot(x, z - PR_SPR) : X
  if (da < PR_HW + 1.3) {
    if (da < PR_HW + 0.15 || da > PR_HW + 1.15) return set(GOLD)
    const s = (z > PR_SPR ? Math.atan2(x, z - PR_SPR) * (PR_HW + 0.65) : z - PR_SPR) / 1.2
    const f = Math.abs(s - Math.round(s))
    if (f < 0.16 && Math.abs(da - PR_HW - 0.65) < 0.2) return set(GOLD_HI)
    return set(CREAM)
  }
  if (z < PLAT + 1.6 && X < PR_HW + 1.6) return dado(z - PLAT)
  if (z < 1.6) return dado(z)
  if (z > 20 && z < 22) return set(z > 21.4 ? GOLD : z < 20.2 ? GOLD_DK : CREAM)
  if (z > SPR) {
    // a band of gilt letters over the arch
    if (z > 30.4 && z < 31.6 && X < 7.6) {
      const cx = Math.floor((x + 7.6) / 0.42)
      const cz = Math.floor((z - 30.4) / 0.24)
      if (cx % 3 !== 2 && hash(cx, cz) < 0.62) return set(GOLD_HI)
      return set(BLUE_DK)
    }
    return stars(x, z)
  }
  set(STUCCO)
}

function pendAt(x, y, z) {
  glow = false
  const v = y - YX
  if (z > DRUM0 - 0.8) return set(z > DRUM0 - 0.3 ? GOLD_HI : GOLD)
  // a roundel in each, framed in gilt
  const sx = x < 0 ? -1 : 1
  const sy = v < 0 ? -1 : 1
  const m = 11.2
  const zc = 28
  const dx = x - sx * m
  const dy = v - sy * m
  const dz = z - zc
  const r = Math.hypot(dx, dy, dz)
  if (r < 3.0) {
    if (r > 2.55) return set(r > 2.8 ? GOLD_DK : GOLD)
    if (pics) {
      const p = pics[ROUNDEL_ART[(sx > 0 ? 1 : 0) + (sy > 0 ? 2 : 0)]]
      const u = (dy * sx - dx * sy) * Math.SQRT1_2 // to the right, seen from under the dome
      const s = Math.min(p.w, p.h)
      if (sample(p, 0.5 + (u / 5.1) * (s / p.w), 0.5 - (dz / 5.1) * (s / p.h))) return
    }
    return set(BLUE)
  }
  stars(Math.atan2(v, x) * 14, z)
}

function drumAt(x, y, z) {
  glow = false
  if (z < DRUM0 + 0.45) return set(z < DRUM0 + 0.15 ? GOLD_HI : GOLD)
  if (z > DRUM1 - 0.35) return set(GOLD)
  const q = Math.atan2(y - YX, x) * (16 / (Math.PI * 2))
  const s = (q - Math.floor(q) - 0.5) * 4.712 // along the wall from the middle of a window
  const S = Math.abs(s)
  const top = 36.2 + Math.sqrt(Math.max(0, 1.21 - S * S))
  if (S < 1.1 && z > 34.8 && z < top) return leaded(s, z - 34.8)
  if (S < 1.3 && z > 34.62 && z < top + 0.2) return set(GOLD)
  set(z > 37.1 ? GOLD : CREAM)
}

function domeAt(x, y, z) {
  glow = false
  const v = y - YX
  const rr = Math.hypot(x, v)
  if (rr < 2.1) {
    // the lantern, open to the sky
    glow = true
    return mix(LANTERN_DAY, LANTERN_NIGHT, dark)
  }
  if (rr < 2.7) return set(rr < 2.3 ? GOLD_HI : GOLD)
  const el = Math.atan2(z - DRUM1, rr) // 0 at the foot, π/2 at the top
  if (el < 0.06) return set(GOLD)
  const az = Math.atan2(v, x)
  // a ring of twelve saints on clouds, low in the dome
  const fq = (az / (Math.PI * 2) + 1) * 12
  const fi = Math.floor(fq)
  if (saint((fq - fi - 0.5) * ((Math.PI * 2 * rr) / 12), (el - 0.2) * 12, fi)) return
  // the sky, deep at the foot and paler going up, into the gold of the glory round the lantern
  const k = el / (Math.PI / 2)
  if (k < 0.62) mix(SKY_DEEP, SKY_PALE, k / 0.62)
  else mix(SKY_PALE, SKY_GLORY, (k - 0.62) / 0.38)
  const cl = Math.sin(az * 9 + Math.sin(el * 7) * 2) * Math.sin(el * 21 + az * 3)
  if (cl > 0.5 && k > 0.4 && k < 0.8) {
    const t = Math.min(1, (cl - 0.5) * 3)
    R += (CLOUD[0] - R) * t
    G += (CLOUD[1] - G) * t
    B += (CLOUD[2] - B) * t
  }
  if (k > 0.74 && Math.sin(az * 24) > 0.55) {
    R *= 1.06
    G *= 1.05
  }
}
/** a saint standing on a cloud, u across from its middle, w up from its feet: true if hit, the colour set */
function saint(u, w, i) {
  if (w < -0.9 || w > 4.5) return false
  const U = Math.abs(u)
  if (w < 0.3) {
    const c = u / 0.55
    const pr = Math.hypot((c - Math.round(c)) * 0.55 * 1.3, w + 0.25)
    if (U < 1.9 && pr < 0.4) {
      set(CLOUD, 1 - pr * 0.3)
      return true
    }
    return false
  }
  if (w < 3.3) {
    const hw = 0.5 + (0.32 * (3.3 - w)) / 3.3
    if (U >= hw) return false
    const side = i & 1 ? 1 : -1
    if (u * side > hw - 0.32 - (w - 1) * 0.1) set(CLOAKS[i & 3], 1 - U / hw * 0.25)
    else set(ROBES[i & 3], 1 - U / hw * 0.25)
    return true
  }
  const hd = Math.hypot(u, w - 3.72)
  if (hd < 0.34) {
    set(SKIN)
    return true
  }
  if (hd < 0.62) {
    set(hd > 0.48 ? GOLD_HI : GOLD)
    return true
  }
  return false
}

/** the walls of the presbytery and the apse: courses of beige and pink over the dado, a gilt cornice */
function coursesAt(z) {
  if (z < PLAT + 1.6) return dado(z - PLAT)
  if (z > 17.4) return set(z > 18.6 ? GOLD : z > 17.9 ? CREAM : GOLD_DK)
  set(Math.floor((z - PLAT - 1.6) / 0.9) & 1 ? PINK_C : BEIGE_C)
}
function presbVaultAt(x, y, z) {
  glow = false
  const s = Math.atan2(x, z - PR_SPR) * PR_HW
  if (y > Y0 - 1.5) return band(s, Y0 - y)
  // coffers: a gilt grid, a rosette in each
  const p = s / 1.6
  const q = (y - YP) / 1.6
  const fp = p - Math.floor(p) - 0.5
  const fq = q - Math.floor(q) - 0.5
  if (Math.abs(fp) > 0.43 || Math.abs(fq) > 0.43) return set(GOLD)
  const r = Math.hypot(fp, fq)
  if (r < 0.16) return set(r < 0.08 ? GOLD_HI : GOLD)
  set(Math.abs(fp) > 0.34 || Math.abs(fq) > 0.34 ? BLUE_DK : BLUE)
}
function apseWallAt(x, y, z) {
  glow = false
  const s = Math.atan2(x, YP - y) * PR_HW // along the wall from the middle
  const S = Math.abs(s)
  // the middle window and two either side of it, of stained glass
  const top = 13.2 + Math.sqrt(Math.max(0, 1.69 - S * S))
  if (S < 1.3 && z > 7.4 && z < top) return stained(s, z, 10.6)
  if (S < 1.6 && z > 7.1 && z < top + 0.3) return set(GOLD)
  const ds = S - 6.4
  const top2 = 12.4 + Math.sqrt(Math.max(0, 0.81 - ds * ds))
  if (Math.abs(ds) < 0.9 && z > 8.2 && z < top2) return stained(ds, z, 10.2)
  if (Math.abs(ds) < 1.15 && z > 7.95 && z < top2 + 0.25) return set(GOLD)
  coursesAt(z)
}
function apseDomeAt(x, y, z) {
  glow = false
  if (YP - y < 0.55) return set(GOLD)
  if (z < PR_SPR + 0.5) return set(z < PR_SPR + 0.18 ? GOLD_HI : GOLD)
  // Christ in glory, in a mandorla of gold
  const fz = z - 23.6
  const e = (x / 2.6) ** 2 + (fz / 3.8) ** 2
  if (e < 1) {
    if (e > 0.86) return set(e > 0.93 ? GOLD_DK : GOLD_HI)
    const hd = Math.hypot(x, fz - 2.2)
    if (hd < 0.4) return set(SKIN)
    if (hd < 0.78) {
      if (Math.abs(x) < 0.08 || Math.abs(fz - 2.2) < 0.08) return set(RED_M) // the cross in the halo
      return set(GOLD_HI)
    }
    const X = Math.abs(x)
    // the arms raised, the hands
    for (let sg = -1; sg <= 1; sg += 2) {
      const ax = x * sg
      const t = clamp((ax - 0.5) / 0.75, 0, 1)
      const dd = Math.hypot(ax - (0.5 + 0.75 * t), fz - (1.4 + 0.85 * t))
      if (dd < 0.17) return set(t > 0.92 ? SKIN : LINEN)
    }
    if (fz > -3.3 && fz < 1.7 && X < 0.5 + (0.34 * (1.7 - fz)) / 5) {
      if (x > 0.08 - (fz - 1.7) * 0.06) return set(RED_M, 1.05 - X * 0.2)
      return set(LINEN, 0.92 + 0.08 * Math.sin(x * 9 + fz))
    }
    return mix(GOLD_HI, GOLD_PALE, e)
  }
  // rays of gold out from the glory over a starry blue
  const ra = Math.atan2(fz, x) * 9
  if (Math.abs(ra - Math.round(ra)) < 0.08 && e < 2.6) return set(GOLD)
  stars(x, z)
}

function chapelBackAt(k, y, z) {
  glow = false
  const u = y - CHAPELS[k >> 1]
  if (z < 1.6) return dado(z)
  if (z > CH_SPR - 0.8) return set(z > CH_SPR - 0.25 ? GOLD : CREAM)
  if (pics && framed(pics[CHAPEL_ART[k]], (k & 1 ? -u : u), z, 7.4, 3.8)) return
  if (Math.abs(u) > 3.3 && Math.abs(u) < 4.1 && z > 2.0) return set(PINK, Math.abs(u) > 3.4 && Math.abs(u) < 4.0 ? 1 : 0.82)
  set(STUCCO)
}
function chapelSideAt(x, z) {
  glow = false
  if (z < 1.6) return dado(z)
  if (z > CH_SPR - 0.8) return set(z > CH_SPR - 0.25 ? GOLD : CREAM)
  const X = Math.abs(x)
  if (X > 12.9 && X < 15.3 && z > 2.4 && z < 11.2) return set(X < 13.02 || X > 15.18 || z < 2.52 || z > 11.08 ? GOLD : PINK, 0.92 + 0.08 * Math.sin(z * 2.3 + X * 4))
  set(STUCCO)
}
function chapelVaultAt(x, y, z) {
  glow = false
  const u = y - CHAPELS[bayOf(y)]
  const X = Math.abs(x)
  const s = Math.atan2(u, z - CH_SPR) * CH_HW
  if (X < 13.0) return band(s, (X - 11.9) * 1.36)
  stars(s, X)
}

// ── the furniture: boxes { x0, x1, y0, y1, z0, h, paint(face, along, z), top(x, y), bottom(x, y), glow }
// paint gives a colour (PC), or null where the face is open; face is the way it looks: 1 +x, −1 −x, 2 +y,
// −2 −y; along is y on a face across x and x on a face across y.
const BOXES = []
const SOLID = [] // what the man walks round, as rectangles
function box(x0, x1, y0, y1, z0, h, paint, top = null, bottom = null, lit = false) {
  BOXES.push({ x0, x1, y0, y1, z0, h, paint, top, bottom, glow: lit, d: 0 })
}
/** for sorting boxes nearest the eye first, by d */
const nearer = (p, q) => p.d - q.d
/** a box on the right of the middle (x0 to x1), and its mirror on the left */
function pair(x0, x1, y0, y1, z0, h, paint, top = null, bottom = null, lit = false) {
  box(x0, x1, y0, y1, z0, h, paint, top, bottom, lit)
  box(-x1, -x0, y0, y1, z0, h, paint, top, bottom, lit)
}
/** carved and gilded: little ripples of light and hollow */
function giltK(s, z) {
  const v = Math.sin(s * 11 + z * 17) + 0.6 * Math.sin(s * 23 - z * 9)
  return v > 0.95 ? GOLD_HI : v < -0.95 ? GOLD_DK : GOLD
}
const plain = (c) => () => put(c)
/** a pilaster's shaft: a grey marble base, and on its face a panel of pink quatrefoils on grey in a gilt frame */
function pilasterPaint(mid) {
  return (face, along, z) => {
    if (z < 1.6) return put(z > 1.32 || z < 0.25 ? CREAM : GREY_M)
    const across = face === 1 || face === -1
    if (!across) return put(CREAM, 0.94)
    const u = along - mid
    const U = Math.abs(u)
    if (U < 1.12 && z > 2.2 && z < 17.6) {
      if (U > 0.98 || z < 2.34 || z > 17.46) return put(GOLD)
      const q = (z - 2.34) / 1.52
      const w = (q - Math.floor(q) - 0.5) * 1.52
      // four round lobes about the middle of each, a gilt bud at its heart
      const r0 = Math.hypot(u, w)
      if (r0 < 0.12) return put(GOLD_HI)
      for (let q = 0; q < 4; q++) {
        const r = Math.hypot(u - LOBE_U[q], w - LOBE_W[q])
        if (r < 0.25) return put(r > 0.2 ? PINK_DK : PINK)
      }
      if (Math.abs(w) > 0.7) return put(GOLD_DK, 0.9)
      return put(PANEL)
    }
    return put(CREAM)
  }
}
/** a Corinthian capital: gilt acanthus in two rows, volutes at its corners, the abacus over it */
function capitalPaint(face, along, z) {
  const zz = z - 18.4
  if (zz > 1.35) return put(GOLD_HI)
  if (zz < 0.12) return put(GOLD_DK)
  const leaf = Math.sin(along * 5.2 + (zz > 0.7 ? 1.6 : 0)) * 0.5 + 0.5
  if (zz > 0.9) return put(Math.abs(Math.sin(along * 2.6)) > 0.8 ? GOLD_HI : GOLD)
  return put(leaf > 0.55 ? GOLD_HI : leaf < 0.18 ? GOLD_DK : GOLD)
}
function entablaturePaint(face, along, z) {
  if (z > 21.4) return put(z > 21.85 ? GOLD_HI : giltK(along, z))
  if (z < 20.35) return put(z < 20.12 ? GOLD_DK : CREAM)
  // the frieze: gilt scrolls on cream
  const f = Math.sin(along * 3.4 + Math.sin(z * 9) * 1.2)
  return put(f > 0.6 ? GOLD : CREAM, f > 0.6 ? 1 : 0.97)
}
const giltBottom = () => put(GOLD, 0.9)
function woodPaint(face, along, z) {
  const g = Math.sin(along * 7 + Math.sin(z * 3) * 2)
  return put(g > 0.75 ? WOOD_HI : g < -0.8 ? WOOD_DK : WOOD)
}
const woodTop = (x, y) => put(Math.sin(x * 6 + Math.sin(y * 4)) > 0.7 ? WOOD_HI : WOOD, 1.04)
function marblePaint(c) {
  return (face, along, z) => {
    const v = Math.sin(along * 4 + z * 3 + Math.sin(z * 5 + along * 2) * 2)
    return put(v > 0.88 ? WHITE_M : c, v < -0.7 ? 0.9 : 1)
  }
}
const marbleWhite = marblePaint(WHITE_M)
const marblePink = marblePaint(PINK)
const marbleGrey = marblePaint(GREY_M)
function platformTop(x, y) {
  const u = (x + y) * 0.38
  const v = (x - y) * 0.38
  const i = Math.floor(u)
  const j = Math.floor(v)
  if (u - i < 0.03 || v - j < 0.03) return put(JOINT)
  return put((i + j) & 1 ? PINK_C : WHITE_M)
}

function buildFurniture() {
  BOXES.length = 0
  SOLID.length = 0
  const solid = (x0, x1, y0, y1) => SOLID.push({ x0, x1, y0, y1 }, { x0: -x1, x1: -x0, y0, y1 })
  // the pilasters, and the piers at the crossing's corners
  for (const yp of PILS) {
    pair(PIL_X, NW, yp - 1.5, yp + 1.5, 0, 18.4, pilasterPaint(yp))
    pair(PIL_X - 0.16, NW, yp - 1.66, yp + 1.66, 18.4, 20, capitalPaint, null, giltBottom)
    solid(PIL_X, NW, yp - 1.5, yp + 1.5)
  }
  for (const [ya, yb] of [[Y1 - 1.6, Y1 + 1.6], [Y0 - 1.0, Y0 + 1.6]]) {
    const mid = (ya + yb) / 2
    pair(11.0, 13.6, ya, yb, 0, 18.4, pilasterPaint(mid))
    pair(10.84, 13.76, ya - 0.16, yb + 0.16, 18.4, 20, capitalPaint, null, giltBottom)
    pair(10.6, 14.0, ya - 0.4, yb + 0.4, 20, 22, entablaturePaint, null, giltBottom)
    solid(11.0, 13.6, ya, yb)
  }
  // the entablature along the nave and along the transept's walls
  pair(11.0, NW, Y1 + 1.6, L, 20, 21.4, entablaturePaint, null, giltBottom)
  pair(10.6, NW, Y1 + 1.6, L, 21.4, 22, entablaturePaint, null, giltBottom)
  for (const [ya, yb] of [[Y1 - 1.0, Y1], [Y0, Y0 + 1.0]]) {
    pair(14.0, TX, ya, yb, 20, 21.4, entablaturePaint, null, giltBottom)
    pair(14.0, TX, ya < Y0 + 1 ? ya : ya - 0.4, ya < Y0 + 1 ? yb + 0.4 : yb, 21.4, 22, entablaturePaint, null, giltBottom)
  }
  // the presbytery's floor, raised, and the steps up to it
  box(-PR_HW, PR_HW, 0, RAIL_Y + 0.4, 0, PLAT, marbleWhite, platformTop)
  box(-10.5, 10.5, RAIL_Y + 0.4, STEP_Y, 0, 0.6, marbleWhite, platformTop)
  // the altar rail along its edge: balusters of pink marble under a cream rail
  box(-PR_HW, PR_HW, RAIL_Y - 0.2, RAIL_Y + 0.2, PLAT, PLAT + 2.3, (face, along, z) => {
    const zz = z - PLAT
    if (zz > 2.0) return put(CREAM, zz > 2.2 ? 1.06 : 1)
    if (zz < 0.3) return put(CREAM, 0.92)
    if (face === 1 || face === -1) return put(PINK)
    const c = along / 0.6
    const f = Math.abs(c - Math.round(c))
    const w = 0.11 + 0.08 * Math.sin(((zz - 0.3) / 1.7) * Math.PI) ** 2
    return f < w ? put(PINK, 1 - f * 1.2) : null
  }, () => put(CREAM, 1.08))
  // the high altar: a step, the table with its gilt front and linen, the candle step, the tabernacle,
  // a crucifix, six candles
  const AZ = PLAT + 0.4
  box(-4.2, 4.2, 6.6, 10.6, PLAT, AZ, marbleWhite, platformTop)
  box(-3.2, 3.2, 7.4, 9.4, AZ, AZ + 3.0, (face, along, z) => {
    const zz = z - AZ
    if (zz > 2.62) {
      // the linen falling over the front, a lace edge at its foot
      if (zz < 2.74 && Math.sin(along * 18) > 0.2) return null
      return put(LINEN)
    }
    if (face !== 2) return marblePink(face, along, z)
    const ax = Math.abs(along)
    if (ax > 2.95 || zz < 0.22 || zz > 2.42) return put(GOLD_DK)
    // three panels, a roundel with a red cross in the middle one
    const pr = Math.hypot(along, zz - 1.3)
    if (pr < 0.62) return put(pr > 0.5 ? GOLD_HI : Math.abs(along) < 0.1 || Math.abs(zz - 1.3) < 0.1 ? RED_M : CREAM)
    if (Math.abs(ax - 0.95) < 0.07 || Math.abs(ax - 2.0) < 0.07) return put(GOLD_DK)
    return put(giltK(along, zz))
  }, () => put(LINEN, 1.05))
  const GZ = AZ + 3.0
  box(-3.0, 3.0, 7.4, 8.0, GZ, GZ + 0.5, (face, along, z) => put(z > GZ + 0.4 ? GOLD : WHITE_M), () => put(WHITE_M, 1.04))
  const TZ = GZ + 0.5
  box(-0.75, 0.75, 7.4, 8.3, TZ, TZ + 1.9, (face, along, z) => {
    const zz = z - TZ
    if (face === 2 && Math.abs(along) < 0.42 && zz > 0.3 && zz < 1.4) return put(Math.abs(along) < 0.05 ? GOLD_DK : GOLD_HI)
    if (zz > 1.65) return put(GOLD_HI)
    return put(giltK(along, zz))
  }, () => put(GOLD_HI))
  const CZ = TZ + 1.9
  box(-0.08, 0.08, 7.75, 7.9, CZ, CZ + 2.3, plain(GOLD))
  box(-0.65, 0.65, 7.75, 7.9, CZ + 1.5, CZ + 1.66, plain(GOLD))
  box(-0.13, 0.13, 7.9, 7.98, CZ + 0.6, CZ + 1.55, plain(CREAM_HI))
  for (const [cx, hk] of [[1.3, 1.0], [2.0, 0.85], [2.65, 0.7]]) {
    for (const sx of [-1, 1]) {
      const x = cx * sx
      box(x - 0.17, x + 0.17, 7.5, 7.84, TZ, TZ + 0.14, plain(GOLD))
      box(x - 0.06, x + 0.06, 7.61, 7.73, TZ + 0.14, TZ + 1.1 * hk, (f, a, z) => put(giltK(a * 3, z)))
      box(x - 0.15, x + 0.15, 7.52, 7.82, TZ + 1.1 * hk, TZ + 1.1 * hk + 0.08, plain(GOLD_HI))
      box(x - 0.07, x + 0.07, 7.6, 7.74, TZ + 1.1 * hk + 0.08, TZ + 1.1 * hk + 0.95, plain(LINEN))
      box(x - 0.05, x + 0.05, 7.62, 7.72, TZ + 1.1 * hk + 0.95, TZ + 1.1 * hk + 1.2, plain(FLAME), null, null, true)
    }
  }
  // the choir stalls either side of the presbytery
  pair(7.3, PR_HW, 11.5, 20.0, PLAT, PLAT + 3.2, (face, along, z) => {
    const zz = z - PLAT
    if (zz > 3.0) return put(WOOD_HI)
    if (face === 1 || face === -1) {
      const c = along / 1.4
      if (Math.abs(c - Math.round(c)) < 0.06 || zz < 0.2 || (zz > 1.5 && zz < 1.62)) return put(WOOD_DK)
    }
    return woodPaint(face, along, z)
  }, woodTop)
  // an altar in each chapel, and in each arm of the transept, with two candles
  const sideAltar = (x0, x1, y0, y1, faceOut) => {
    box(x0, x1, y0, y1, 0, 3.0, (face, along, z) => {
      if (z > 2.66) return put(LINEN)
      if (face !== faceOut) return marblePink(face, along, z)
      const mid = (faceOut === 1 || faceOut === -1) ? (y0 + y1) / 2 : (x0 + x1) / 2
      const a = Math.abs(along - mid)
      if (a < 0.1 && z > 0.6 && z < 2.2) return put(GOLD_HI)
      if (Math.abs(z - 1.6) < 0.1 && a < 0.5) return put(GOLD_HI)
      return (z < 0.3 || z > 2.45 ? marbleGrey : marblePink)(face, along, z)
    }, () => put(LINEN, 1.05))
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const along = faceOut === 1 || faceOut === -1
    for (const s of [-1, 1]) {
      const px = along ? cx : cx + s * ((x1 - x0) / 2 - 0.4)
      const py = along ? cy + s * ((y1 - y0) / 2 - 0.4) : cy
      box(px - 0.06, px + 0.06, py - 0.06, py + 0.06, 3.0, 3.9, (f, a, z) => put(z > 3.3 ? LINEN : GOLD))
      box(px - 0.04, px + 0.04, py - 0.04, py + 0.04, 3.9, 4.1, plain(FLAME), null, null, true)
    }
    SOLID.push({ x0, x1, y0, y1 })
  }
  for (const yc of CHAPELS) {
    sideAltar(14.8, CH_X, yc - 2, yc + 2, -1)
    sideAltar(-CH_X, -14.8, yc - 2, yc + 2, 1)
  }
  sideAltar(16.4, TX, YX - 3, YX + 3, -1)
  sideAltar(-TX, -16.4, YX - 3, YX + 3, 1)
  // the organ loft over the door, on two columns
  box(-NW, NW, 91, L, 12.4, 14.2, (face, along, z) => {
    if (face !== -2) return put(GOLD)
    const zz = z - 12.4
    if (zz < 0.25 || zz > 1.55) return put(zz > 1.55 ? GOLD_HI : GOLD_DK)
    const c = along / 0.5
    return Math.abs(c - Math.round(c)) < 0.16 ? put(GOLD_HI) : put(WOOD_DK)
  }, () => put(WOOD), (x, y) => {
    const c = x / 2
    const d = (y - 91) / 1.6
    return put(Math.abs(c - Math.round(c)) < 0.06 || Math.abs(d - Math.round(d)) < 0.08 ? GOLD : WOOD, 0.85)
  })
  pair(4.6, 5.4, 90.6, 91.4, 0, 12.4, (face, along, z) => {
    if (z < 1.0 || z > 11.6) return put(z > 11.6 ? GOLD : CREAM)
    return marbleGrey(face, along, z)
  })
  solid(4.6, 5.4, 90.6, 91.4)
  // the pews, either side of the middle aisle, facing the altar: a kneeler, a seat, a back, carved ends
  for (let r = 0; r < PEW_N; r++) {
    const y = PEW_Y + r * PEW_STEP
    pair(PEW_X0, PEW_X1, y - 0.75, y - 0.45, 0.45, 0.72, woodPaint, woodTop)
    pair(PEW_X0, PEW_X1, y, y + 1.25, 1.45, 1.72, woodPaint, woodTop)
    pair(PEW_X0, PEW_X1, y + 1.25, y + 1.45, 1.72, 3.3, (face, along, z) => {
      if (z > 3.12) return put(WOOD_HI)
      const c = along / 1.65
      if (face === 2 && (Math.abs(c - Math.round(c)) < 0.05 || z < 1.9)) return put(WOOD_DK)
      return woodPaint(face, along, z)
    }, woodTop)
    const end = (face, along, z) => {
      // a scrolled top, rising to the aisle
      const t = clamp((along - (y - 0.8)) / 2.3, 0, 1)
      const zt = 2.9 + 0.7 * Math.sin(t * Math.PI) ** 0.6
      if (z > zt) return null
      if (z > zt - 0.14) return put(WOOD_HI)
      if (face === 1 || face === -1) {
        const inset = along > y - 0.5 && along < y + 1.2 && z > 0.6 && z < zt - 0.5
        if (inset && (Math.abs(along - (y - 0.5)) < 0.06 || Math.abs(along - (y + 1.2)) < 0.06 || Math.abs(z - 0.6) < 0.06 || Math.abs(z - (zt - 0.5)) < 0.06)) return put(WOOD_DK)
      }
      return woodPaint(face, along, z)
    }
    pair(PEW_X0, PEW_X0 + 0.2, y - 0.8, y + 1.5, 0, 3.6, end)
    pair(PEW_X1 - 0.2, PEW_X1, y - 0.8, y + 1.5, 0, 3.6, end)
    solid(PEW_X0, PEW_X1, y - 0.8, y + 1.5)
  }
}

/** where the man may stand: in the nave, a chapel, the crossing below the steps or an arm of the transept */
function standable(x, y) {
  const X = Math.abs(x)
  let ok = false
  if (y >= Y1 && y <= L - BODY && X <= NW - BODY) ok = true
  else if (y >= STEP_Y + BODY && y <= Y1 && X <= NW) ok = true
  else if (y >= Y0 + BODY && y <= Y1 - BODY && X <= TX - BODY) ok = true
  if (!ok && X > NW - BODY && X <= CH_X - BODY) {
    const u = Math.abs(y - CHAPELS[bayOf(y)])
    ok = y > Y1 && u <= CH_HW - BODY
  }
  if (!ok) return false
  for (const b of SOLID) if (x > b.x0 - BODY && x < b.x1 + BODY && y > b.y0 - BODY && y < b.y1 + BODY) return false
  return true
}

export function createChurchRoom() {
  const me = { x: 0, y: L - 2.5, yaw: 0 }
  let built = false
  function build() {
    if (built) return
    built = true
    pics = buildPaintings()
    vaultArt = VAULT_ART.map((id) => {
      const p = pics[id]
      if (!p) return null
      // as wide as the middle of the vault allows, as tall as the bay between its bands
      let hs = 5.6
      let hv = (hs * p.h) / p.w
      if (hv > 3.9) {
        hv = 3.9
        hs = (hv * p.w) / p.h
      }
      return { p, hs, hv }
    })
    buildFurniture()
  }

  /** come in by the door, facing up the nave */
  function enter() {
    build()
    me.x = 0
    me.y = L - 2.5
    me.yaw = 0
  }

  /** walk: turn and move from −1 to 1. True when the man has walked out through the door. */
  function step(dt, turn, move, side = 0) {
    me.yaw += turn * TURN * dt
    if (move === 0 && side === 0) return false
    const sn = Math.sin(me.yaw)
    const cs = Math.cos(me.yaw)
    const k = (WALK * dt) / Math.max(1, Math.hypot(move, side))
    const nx = me.x + (sn * move + cs * side) * k
    const ny = me.y + (-cs * move + sn * side) * k
    if (ny > L - BODY && Math.abs(nx) < DOOR_HW - 0.3) return true
    if (standable(nx, ny)) {
      me.x = nx
      me.y = ny
    } else if (standable(nx, me.y)) me.x = nx
    else if (standable(me.x, ny)) me.y = ny
    return false
  }

  // ── the ray: from (ox, oy, oz) along (dx, dy, dz); t is depth along the view, as in the museum
  let ox = 0, oy = 0, oz = 0, dx = 0, dy = 0, dz = 0
  let xt = 0 // where the ray leaves the solid being looked at …
  let xs = 0 // … and through which surface
  let ht = 0, hs = 0, hv = 0 // the hit: its depth, its surface, the solid it is on

  function slab(o, d, lo, hi, sLo, sHi) {
    if (d > 1e-9) {
      const t = (hi - o) / d
      if (t < xt) { xt = t; xs = sHi }
    } else if (d < -1e-9) {
      const t = (lo - o) / d
      if (t < xt) { xt = t; xs = sLo }
    }
  }
  /** a barrel vault's section: walls at ±r up to the spring, a half circle of radius r over them */
  function vault(lo, ld, spring, r, sWall, sVault) {
    const ho = oz - spring
    if (ld > 1e-9 || ld < -1e-9) {
      const t = ((ld > 0 ? r : -r) - lo) / ld
      if (t < xt && ho + dz * t <= 0) { xt = t; xs = sWall }
    }
    const a = ld * ld + dz * dz
    if (a > 1e-12) {
      const b = lo * ld + ho * dz
      const disc = b * b - a * (lo * lo + ho * ho - r * r)
      if (disc >= 0) {
        const t = (-b + Math.sqrt(disc)) / a
        if (t < xt && ho + dz * t > 0) { xt = t; xs = sVault }
      }
    }
  }
  /** an upright cylinder of radius r round (cx, cy) up to the spring, a half sphere over it */
  function capsule(cx, cy, spring, r, sWall, sDome) {
    const px = ox - cx
    const py = oy - cy
    const ho = oz - spring
    const a = dx * dx + dy * dy
    const b = px * dx + py * dy
    if (a > 1e-12) {
      const disc = b * b - a * (px * px + py * py - r * r)
      if (disc >= 0) {
        const t = (-b + Math.sqrt(disc)) / a
        if (t < xt && ho + dz * t <= 0) { xt = t; xs = sWall }
      }
    }
    const a2 = a + dz * dz
    const b2 = b + ho * dz
    const d2 = b2 * b2 - a2 * (px * px + py * py + ho * ho - r * r)
    if (d2 >= 0) {
      const t = (-b2 + Math.sqrt(d2)) / a2
      if (t < xt && ho + dz * t > 0) { xt = t; xs = sDome }
    }
  }
  // the solids: 0 the nave, 1 the transept, 2 the crossing up to its sail vault, 3 the drum and the dome,
  // 4 the presbytery, 5 the apse, 6 to 13 the chapels (6 + 2·bay, + 1 on the right)
  function exitOf(v) {
    xt = 1e9
    xs = 0
    if (dz < -1e-9) {
      xt = -oz / dz
      xs = S_FLOOR
    }
    switch (v) {
      case 0:
        vault(ox, dx, SPR, NW, S_NWALL, S_NVAULT)
        slab(oy, dy, Y1, L, S_OPEN, S_DOORWALL)
        break
      case 1:
        vault(oy - YX, dy, SPR, NW, S_TWALL, S_TVAULT)
        slab(ox, dx, -TX, TX, S_TEND, S_TEND)
        break
      case 2:
        slab(ox, dx, -NW, NW, S_OPEN, S_OPEN)
        slab(oy, dy, Y0, Y1, S_XBACK, S_OPEN)
        capsule(0, YX, SPR, R1, S_OPEN, S_PEND)
        break
      case 3:
        capsule(0, YX, DRUM1, DOME_R, S_DRUM, S_DOME)
        if (dz < -1e-9) {
          const t = (DRUM_LOW - oz) / dz
          if (t < xt) { xt = t; xs = S_OPEN }
        }
        break
      case 4:
        vault(ox, dx, PR_SPR, PR_HW, S_PWALL, S_PVAULT)
        slab(oy, dy, YP, Y0, S_OPEN, S_OPEN)
        break
      case 5:
        capsule(0, YP, PR_SPR, PR_HW, S_AWALL, S_ADOME)
        if (dy > 1e-9) {
          const t = (YP - oy) / dy
          if (t < xt) { xt = t; xs = S_OPEN }
        }
        break
      default: {
        const k = v - 6
        const right = (k & 1) === 1
        vault(oy - CHAPELS[k >> 1], dy, CH_SPR, CH_HW, S_CWALL, S_CVAULT)
        if (right) slab(ox, dx, NW - 0.2, CH_X, S_OPEN, S_CBACK)
        else slab(ox, dx, -CH_X, -NW + 0.2, S_CBACK, S_OPEN)
      }
    }
  }
  const vin = (l, z, s, r) => l >= -r && l <= r && (z <= s || l * l + (z - s) * (z - s) <= r * r)
  const cin = (x, y, z, s, r) => {
    const h = z > s ? z - s : 0
    return x * x + y * y + h * h <= r * r
  }
  function inside(v, px, py, pz) {
    if (pz < 0) return false
    switch (v) {
      case 0: return py >= Y1 && py <= L && vin(px, pz, SPR, NW)
      case 1: return px >= -TX && px <= TX && vin(py - YX, pz, SPR, NW)
      case 2: return px >= -NW && px <= NW && py >= Y0 && py <= Y1 && cin(px, py - YX, pz, SPR, R1)
      case 3: return pz >= DRUM_LOW && cin(px, py - YX, pz, DRUM1, DOME_R)
      case 4: return py >= YP && py <= Y0 && vin(px, pz, PR_SPR, PR_HW)
      case 5: return py <= YP && cin(px, py - YP, pz, PR_SPR, PR_HW)
      default: {
        const k = v - 6
        const X = k & 1 ? px : -px
        return X >= NW - 0.2 && X <= CH_X && vin(py - CHAPELS[k >> 1], pz, CH_SPR, CH_HW)
      }
    }
  }
  /** the chapel a point may be in, or −1 */
  function chapelAt(px, py) {
    if (Math.abs(px) < NW - 0.3 || py < Y1 || py > L) return -1
    return 6 + bayOf(py) * 2 + (px > 0 ? 1 : 0)
  }
  /** follow the ray from the solid v0 it starts in, through any it goes on into, to what it meets */
  function trace(v0) {
    let v = v0
    exitOf(v)
    for (let i = 0; i < 8; i++) {
      if (FINAL[xs]) break // nothing lies beyond these

      const t = xt + 1e-3
      const px = ox + dx * t
      const py = oy + dy * t
      const pz = oz + dz * t
      const vt = xt
      const vs = xs
      let best = -1
      let bt = vt
      let bs = vs
      for (let w = 0; w < 6; w++) {
        if (w === v || !inside(w, px, py, pz)) continue
        exitOf(w)
        if (xt > bt) { bt = xt; bs = xs; best = w }
      }
      const c = chapelAt(px, py)
      if (c >= 0 && c !== v && inside(c, px, py, pz)) {
        exitOf(c)
        if (xt > bt) { bt = xt; bs = xs; best = c }
      }
      if (best < 0) {
        ht = vt
        hs = vs
        hv = v
        return
      }
      v = best
      xt = bt
      xs = bs
    }
    ht = xt
    hs = xs
    hv = v
  }
  function startIn(px, py, pz) {
    const c = chapelAt(px, py)
    if (c >= 0 && inside(c, px, py, pz)) return c
    for (let w = 0; w < 6; w++) if (inside(w, px, py, pz)) return w
    return 0
  }

  // the normal of the surface hit, and its colour, at (px, py, pz); d is how far
  let nx = 0, ny = 0, nz = 0
  function surface(s, v, px, py, pz, d) {
    switch (s) {
      case S_FLOOR: nx = 0; ny = 0; nz = 1; return floorAt(px, py, d)
      case S_NWALL: nx = px > 0 ? -1 : 1; ny = 0; nz = 0; return naveWallAt(py, pz)
      case S_NVAULT: nx = -px / NW; ny = 0; nz = -(pz - SPR) / NW; return naveVaultAt(px, py, pz)
      case S_DOORWALL: nx = 0; ny = -1; nz = 0; return doorWallAt(px, pz)
      case S_TWALL: nx = 0; ny = py > YX ? -1 : 1; nz = 0; return transWallAt(px, pz)
      case S_TVAULT: nx = 0; ny = -(py - YX) / NW; nz = -(pz - SPR) / NW; return transVaultAt(px, py, pz)
      case S_TEND: nx = px > 0 ? -1 : 1; ny = 0; nz = 0; return transEndAt(px, py, pz)
      case S_XBACK: nx = 0; ny = 1; nz = 0; return triumphAt(px, pz)
      case S_PEND: nx = -px / R1; ny = -(py - YX) / R1; nz = -(pz - SPR) / R1; return pendAt(px, py, pz)
      case S_DRUM: nx = -px / DOME_R; ny = -(py - YX) / DOME_R; nz = 0; return drumAt(px, py, pz)
      case S_DOME: nx = -px / DOME_R; ny = -(py - YX) / DOME_R; nz = -(pz - DRUM1) / DOME_R; return domeAt(px, py, pz)
      case S_PWALL: nx = px > 0 ? -1 : 1; ny = 0; nz = 0; glow = false; return coursesAt(pz)
      case S_PVAULT: nx = -px / PR_HW; ny = 0; nz = -(pz - PR_SPR) / PR_HW; return presbVaultAt(px, py, pz)
      case S_AWALL: nx = -px / PR_HW; ny = -(py - YP) / PR_HW; nz = 0; return apseWallAt(px, py, pz)
      case S_ADOME: nx = -px / PR_HW; ny = -(py - YP) / PR_HW; nz = -(pz - PR_SPR) / PR_HW; return apseDomeAt(px, py, pz)
      case S_CWALL: {
        const u = py - CHAPELS[bayOf(py)]
        nx = 0; ny = u > 0 ? -1 : 1; nz = 0
        return chapelSideAt(px, pz)
      }
      case S_CVAULT: {
        const u = py - CHAPELS[bayOf(py)]
        nx = 0; ny = -u / CH_HW; nz = -(pz - CH_SPR) / CH_HW
        return chapelVaultAt(px, py, pz)
      }
      case S_CBACK: nx = px > 0 ? -1 : 1; ny = 0; nz = 0; return chapelBackAt(v - 6, py, pz)
      default: nx = 0; ny = 0; nz = 1; glow = false; return set(STUCCO)
    }
  }

  // ── the light
  let sunK = 0 // how strong the sun is
  let ambK = 0.6
  let ambR = 1, ambG = 1, ambB = 1
  let LR = 1, LG = 1, LB = 1
  /** whether the sun reaches (px, py, pz), back along its light through a window */
  function inSun(px, py, pz) {
    // the lunettes in the nave's left wall, over the cornice
    let s = (px + NW) / LX
    if (s > 0.05) {
      if (px > NW) {
        // in a chapel on the right: only by way of its arch
        const s1 = (px - NW) / LX
        const qy = py - LY * s1
        const qz = pz - LZ * s1
        const u = qy - CHAPELS[bayOf(qy)]
        if (Math.abs(u) > CH_HW || (qz > CH_SPR && u * u + (qz - CH_SPR) ** 2 > CH_HW * CH_HW)) return false
      }
      const qy = py - LY * s
      const qz = pz - LZ * s
      if (qz > SPR + 0.3 && qy > Y1 && qy < L) {
        const u = qy - CHAPELS[bayOf(qy)]
        if (u * u + (qz - SPR) * (qz - SPR) < LUN_R * LUN_R) return true
      }
    }
    // the big lunette over the left arm of the transept
    s = (px + TX) / LX
    if (s > 0.05) {
      const qy = py - LY * s
      const qz = pz - LZ * s
      const u = qy - YX
      if (qz > SPR + 0.3 && u * u + (qz - SPR) * (qz - SPR) < TLUN_R * TLUN_R) return true
    }
    // the drum's windows, from under the dome
    if (px > -NW && px < NW && py > Y0 && py < Y1 && pz < DRUM0) {
      const hx = px
      const hy = py - YX
      const a = LX * LX + LY * LY
      const b = -(hx * LX + hy * LY)
      const disc = b * b - a * (hx * hx + hy * hy - DOME_R * DOME_R)
      if (disc >= 0) {
        const t = (-b + Math.sqrt(disc)) / a
        const qz = pz - LZ * t
        if (qz > 34.8 && qz < 37.0) {
          const q = Math.atan2(hy - LY * t, hx - LX * t) * (16 / (Math.PI * 2))
          const f = q - Math.floor(q)
          if (f > 0.27 && f < 0.73) return true
        }
      }
    }
    return false
  }
  let sunHint = -1 // whether the point is in the sun, where that is known already (0 or 1), else −1 …
  let sunGot = 2 // … and what light found: 0 in shade, 1 in the sun, 2 not asked (facing away, or lit itself)
  /** the light falling on a surface with normal (nx, ny, nz) at (px, py, pz): LR, LG, LB */
  function light(px, py, pz) {
    const a = ambK + (nz > 0 ? 0.14 * nz : 0.22 * nz)
    LR = a * ambR
    LG = a * ambG
    LB = a * ambB
    sunGot = 2
    if (sunK > 0) {
      const ct = -(nx * LX + ny * LY + nz * LZ)
      if (ct > 0) {
        const lit = sunHint >= 0 ? sunHint === 1 : inSun(px, py, pz)
        sunGot = lit ? 1 : 0
        if (lit) {
          const s = sunK * ct
          LR += s
          LG += s * 0.93
          LB += s * 0.78
        }
      }
    }
    if (dark > 0) {
      // at night the candles on the altars light the east end
      const d2 = px * px + (py - 9) * (py - 9) + (pz - 6) * (pz - 6)
      const g = dark * 0.55 * Math.exp(-d2 / 300)
      LR += g
      LG += g * 0.76
      LB += g * 0.46
    }
  }
  // the haze the far end sits in
  let hzR = 0, hzG = 0, hzB = 0

  let zb = new Float32Array(0)
  let rk = new Float32Array(0) // how much of the pixel is the floor's mirror …
  let rz = new Float32Array(0) // … how far off what it mirrors is
  let cr = new Float32Array(0), cg = new Float32Array(0), cbuf = new Float32Array(0)
  let qr = new Float32Array(0), qg = new Float32Array(0), qb = new Float32Array(0)
  let bm = new Float32Array(0) // the sun's shafts along the ray, 0 to 1
  let hitS = new Uint8Array(0), hitV = new Uint8Array(0) // the surface each pixel's ray met, and the solid it is of …
  let sunLit = new Uint8Array(0) // … and whether it is in the sun, as light found (sunGot)
  const order = [] // the furniture in front of the eye, nearest first
  // the frame as last drawn, from where and at what hour, and how much of it is drawn at full size yet
  let frame = new Uint32Array(0)
  let half = new Uint32Array(0)
  let fW = 0, fH = 0, fX = NaN, fY = NaN, fYaw = NaN, fNight = -1
  let sharp = 0 // columns drawn at full size so far, from the left
  let perCol = 0.25 // milliseconds a column takes at full size, smoothed

  /** the colour of what the ray meets, lit and hazed, into (R, G, B); d its depth */
  function shadeHit(d) {
    const px = ox + dx * ht
    const py = oy + dy * ht
    const pz = oz + dz * ht
    sunGot = 2
    surface(hs, hv, px, py, pz, d)
    if (!glow) {
      light(px, py, pz)
      R *= LR
      G *= LG
      B *= LB
    }
    const h = Math.min(0.32, d * 0.0034)
    R += (hzR - R) * h
    G += (hzG - G) * h
    B += (hzB - B) * h
  }
  /** a box's face colour c at (px, py, pz) with normal (fx, fy, fz), lit and hazed, into (R, G, B) */
  function shadeBox(c, lit, fx, fy, fz, px, py, pz, d) {
    R = c[0]
    G = c[1]
    B = c[2]
    if (!lit) {
      nx = fx; ny = fy; nz = fz
      light(px, py, pz)
      R *= LR
      G *= LG
      B *= LB
    }
    const h = Math.min(0.32, d * 0.0034)
    R += (hzR - R) * h
    G += (hzG - G) * h
    B += (hzB - B) * h
  }

  /**
   * draw the church into the frame (packed 0xAABBGGRR, W by H); night from 0 (day) to 1. Nothing in it moves,
   * so while the man stands still the frame is kept. Where the whole of it is too slow to draw each frame on
   * this machine, it is drawn at half the size each way while he walks or turns, each pixel doubled, and
   * when he stops it is drawn again at full size a strip at a time, sharpening across from the left.
   */
  function render(fb, W, H, night) {
    const n = W * H
    if (fW !== W || fH !== H) {
      frame = new Uint32Array(n)
      fW = W
      fH = H
      fX = NaN
    }
    const nq = Math.round(clamp(night, 0, 1) * 60) / 60 // the hour, in steps too small to see
    const moved = me.x !== fX || me.y !== fY || me.yaw !== fYaw
    if (moved || nq !== fNight) {
      fX = me.x
      fY = me.y
      fYaw = me.yaw
      fNight = nq
      sharp = 0
      if (moved && perCol * W > FULL_MS && W >= 2 && H >= 2) {
        const w = W >> 1
        const h = H >> 1
        if (half.length !== w * h) half = new Uint32Array(w * h)
        draw(half, w, h, nq, 0, w)
        for (let row = 0; row < H; row++) {
          const src = Math.min(h - 1, row >> 1) * w
          const dst = row * W
          for (let col = 0; col < W; col++) frame[dst + col] = half[src + Math.min(w - 1, col >> 1)]
        }
        fb.set(frame)
        return
      }
    }
    if (sharp < W) {
      const t0 = performance.now()
      const step = perCol * W <= FULL_MS ? W : clamp(Math.floor(STRIP_MS / perCol), 8, W) & ~1
      const c1 = Math.min(W, sharp + step)
      draw(frame, W, H, nq, sharp, c1)
      perCol += ((performance.now() - t0) / (c1 - sharp) - perCol) * 0.3
      sharp = c1
    }
    fb.set(frame)
  }
  /** draw columns c0 to c1 of the church at W by H into fb */
  function draw(fb, W, H, night, c0, c1) {
    build()
    dark = clamp(night, 0, 1)
    sunK = 0.78 * (1 - dark)
    ambK = 0.6 - 0.26 * dark
    ambR = 1 - dark * 0.1
    ambG = 0.98 - dark * 0.24
    ambB = 0.94 - dark * 0.42
    hzR = 196 - 150 * dark
    hzG = 182 - 146 * dark
    hzB = 154 - 124 * dark
    // the buffers only grow, so drawing at half size and at full size in turn makes nothing new
    const n = W * H
    if (zb.length < n) {
      zb = new Float32Array(n)
      rk = new Float32Array(n)
      rz = new Float32Array(n)
      cr = new Float32Array(n)
      cg = new Float32Array(n)
      cbuf = new Float32Array(n)
      qr = new Float32Array(n)
      qg = new Float32Array(n)
      qb = new Float32Array(n)
      bm = new Float32Array(n)
      hitS = new Uint8Array(n)
      hitV = new Uint8Array(n)
      sunLit = new Uint8Array(n)
    }
    const focal = Math.max(W, H * 0.75) / 2 / Math.tan(0.62)
    const cy = H * 0.62 // the horizon low, so more of the vault shows
    const fx = Math.sin(me.yaw)
    const fy = -Math.cos(me.yaw)
    const plane = W / 2 / focal
    const rx = Math.cos(me.yaw) * plane
    const ry = Math.sin(me.yaw) * plane
    const v0 = startIn(me.x, me.y, EYE)

    // the church itself, a ray for each pixel. First every other pixel each way, traced through the church
    // (with the sun's shafts along it and, on the floor, what the floor mirrors); then the pixels between
    // them: where those about one all met the same surface, its ray only needs to find where it leaves that
    // solid, else it is traced too, and the floor's mirror there is theirs, softened. The first goes a
    // little past the columns drawn either side, for the pixels between at their edges.
    for (let pass = 0; pass < 2; pass++) {
      const p0 = pass === 0 ? Math.max(0, c0 - 2) : c0
      const p1 = pass === 0 ? Math.min(W, c1 + 2) : c1
      for (let col = p0; col < p1; col++) {
        const cam = (2 * (col + 0.5)) / W - 1
        const ddx = fx + rx * cam
        const ddy = fy + ry * cam
        const oddC = col & 1
        for (let row = pass === 0 || oddC ? 0 : 1; row < H; row += pass === 0 || !oddC ? 2 : 1) {
          if (pass === 0 && oddC) break
          const o = row * W + col
          ox = me.x
          oy = me.y
          oz = EYE
          dx = ddx
          dy = ddy
          dz = (cy - row - 0.5) / focal
          // the pixels about this one that were traced first: either side, above and below, or at its corners
          let na = -1, nb = -1, nc = -1, nd = -1
          if (pass === 1) {
            const up = row > 0
            const down = row + 1 < H
            const left = col > 0
            const right = col + 1 < W
            if (row & 1) {
              if (oddC) {
                if (right && down) { na = o - W - 1; nb = o - W + 1; nc = o + W - 1; nd = o + W + 1 }
              } else if (up && down) { na = o - W; nb = o + W }
            } else if (left && right) { na = o - 1; nb = o + 1 }
          }
          let done = false
          if (na >= 0) {
            const s = hitS[na]
            const v = hitV[na]
            if (s !== S_OPEN && hitS[nb] === s && hitV[nb] === v && (nc < 0 || (hitS[nc] === s && hitV[nc] === v && hitS[nd] === s && hitV[nd] === v))) {
              exitOf(v)
              if (xs === s) {
                ht = xt
                hs = s
                hv = v
                done = true
                // and in the sun or in shade as they are, where they all are the same
                const l = sunLit[na]
                if (l < 2 && sunLit[nb] === l && (nc < 0 || (sunLit[nc] === l && sunLit[nd] === l))) sunHint = l
              }
            }
          }
          if (!done) trace(v0)
          const t0 = ht
          const s0 = hs
          const vv = hv
          hitS[o] = s0
          hitV[o] = vv
          shadeHit(t0)
          sunLit[o] = sunGot
          sunHint = -1
          cr[o] = R
          cg[o] = G
          cbuf[o] = B
          zb[o] = t0
          // the sun's shafts: worked out for every other pixel each way, and shared
          if (sunK > 0) {
            if (pass === 0) {
              const reach = Math.min(t0, 80)
              let lit = 0
              const j = ((col >> 1) + (row >> 1)) & 1 ? 0.3 : 0.7
              for (let i = 0; i < 4; i++) {
                const tt = ((i + j) / 4) * reach
                if (inSun(me.x + ddx * tt, me.y + ddy * tt, EYE + dz * tt)) lit++
              }
              bm[o] = (lit / 4) * (reach / 80)
            } else bm[o] = bm[((row & ~1) * W) + (col & ~1)]
          } else bm[o] = 0
          // the polished floor mirrors what is over it
          rk[o] = 0
          if (s0 !== S_FLOOR) continue
          const px = ox + dx * t0
          const py = oy + dy * t0
          const k = vv === 2 && Math.hypot(px, py - YX) < 9.4 ? 0.36 : 0.28
          if (na >= 0) {
            // the mirror of the pixels about it that mirror anything
            let m = 0, r = 0, g = 0, b = 0, z = 0
            for (let q = 0; q < 4; q++) {
              const p = q === 0 ? na : q === 1 ? nb : q === 2 ? nc : nd
              if (p < 0 || rk[p] === 0) continue
              r += qr[p]; g += qg[p]; b += qb[p]; z += rz[p]
              m++
            }
            if (m > 0) {
              qr[o] = r / m
              qg[o] = g / m
              qb[o] = b / m
              rz[o] = z / m
              rk[o] = k
              continue
            }
          }
          ox = px
          oy = py
          oz = 1e-4
          dz = -dz
          trace(startIn(px, py, 0.5))
          const t1 = ht
          shadeHit(t0 + t1)
          qr[o] = R
          qg[o] = G
          qb[o] = B
          rz[o] = t0 + t1
          rk[o] = k
        }
      }
    }

    // the furniture, over the church and again in the floor: nearest first, so what it hides is passed over
    // and not painted, and what is wholly behind the eye left out
    order.length = 0
    for (let bi = 0; bi < BOXES.length; bi++) {
      const b = BOXES[bi]
      const x0 = b.x0 - me.x
      const x1 = b.x1 - me.x
      const y0 = b.y0 - me.y
      const y1 = b.y1 - me.y
      if (x0 * fx + y0 * fy < 0 && x1 * fx + y0 * fy < 0 && x0 * fx + y1 * fy < 0 && x1 * fx + y1 * fy < 0) continue
      const ex = Math.max(x0, 0, -x1)
      const ey = Math.max(y0, 0, -y1)
      b.d = ex * ex + ey * ey
      order.push(b)
    }
    order.sort(nearer)
    for (let col = c0; col < c1; col++) {
      const cam = (2 * (col + 0.5)) / W - 1
      const ddx = fx + rx * cam
      const ddy = fy + ry * cam
      for (let bi = 0; bi < order.length; bi++) {
        const b = order[bi]
        let tn = -1e9
        let tf = 1e9
        let xFace = false
        if (Math.abs(ddx) < 1e-9) {
          if (me.x < b.x0 || me.x > b.x1) continue
        } else {
          const a1 = (b.x0 - me.x) / ddx
          const a2 = (b.x1 - me.x) / ddx
          tn = Math.min(a1, a2)
          tf = Math.max(a1, a2)
          xFace = true
        }
        if (Math.abs(ddy) < 1e-9) {
          if (me.y < b.y0 || me.y > b.y1) continue
        } else {
          const a1 = (b.y0 - me.y) / ddy
          const a2 = (b.y1 - me.y) / ddy
          const nn = Math.min(a1, a2)
          if (nn > tn) {
            tn = nn
            xFace = false
          }
          tf = Math.min(tf, Math.max(a1, a2))
        }
        if (tn >= tf || tf <= 0.05) continue
        // standing under it (the organ loft) or over it, only its underside or its top shows
        let sides = true
        if (tn <= 0.05) {
          if (EYE >= b.z0 && EYE <= b.h) continue
          tn = 0.05
          sides = false
        }
        const face = xFace ? (ddx > 0 ? -1 : 1) : ddy > 0 ? -2 : 2
        const fnx = xFace ? face : 0
        const fny = xFace ? 0 : face / 2
        const along = xFace ? me.y + ddy * tn : me.x + ddx * tn
        const hx = me.x + ddx * tn
        const hy = me.y + ddy * tn
        // the side it shows
        const rTop = sides ? Math.max(0, Math.ceil(cy - ((b.h - EYE) * focal) / tn - 0.5)) : 0
        const rBot = sides ? Math.min(H, Math.ceil(cy + ((EYE - b.z0) * focal) / tn - 0.5)) : 0
        for (let row = rTop; row < rBot; row++) {
          const o = row * W + col
          if (zb[o] <= tn) continue
          const z = EYE + ((cy - row - 0.5) * tn) / focal
          const c = b.paint(face, along, z)
          if (!c) continue
          shadeBox(c, b.glow, fnx, fny, 0, hx, hy, z, tn)
          cr[o] = R
          cg[o] = G
          cbuf[o] = B
          zb[o] = tn
          rk[o] = 0
        }
        // its top, seen from above
        if (EYE > b.h) {
          const e = EYE - b.h
          const r0 = Math.max(0, Math.ceil(cy + (e * focal) / tf - 0.5))
          const r1 = Math.min(H, Math.ceil(cy + (e * focal) / tn - 0.5))
          for (let row = r0; row < r1; row++) {
            const tt = (e * focal) / (row + 0.5 - cy)
            const o = row * W + col
            if (tt < tn || tt > tf || zb[o] <= tt) continue
            const x = me.x + ddx * tt
            const y = me.y + ddy * tt
            const c = b.top ? b.top(x, y) : b.paint(face, along, b.h - 0.01)
            if (!c) continue
            shadeBox(c, b.glow, 0, 0, 1, x, y, b.h, tt)
            cr[o] = R
            cg[o] = G
            cbuf[o] = B
            zb[o] = tt
            rk[o] = 0
          }
        }
        // its underside, seen from below
        if (EYE < b.z0 && b.bottom) {
          const e = b.z0 - EYE
          const r0 = Math.max(0, Math.ceil(cy - (e * focal) / tn - 0.5))
          const r1 = Math.min(H, Math.ceil(cy - (e * focal) / tf - 0.5))
          for (let row = r0; row < r1; row++) {
            const tt = (e * focal) / (cy - row - 0.5)
            const o = row * W + col
            if (tt < tn || tt > tf || zb[o] <= tt) continue
            const x = me.x + ddx * tt
            const y = me.y + ddy * tt
            const c = b.bottom(x, y)
            if (!c) continue
            shadeBox(c, b.glow, 0, 0, -1, x, y, b.z0, tt)
            cr[o] = R
            cg[o] = G
            cbuf[o] = B
            zb[o] = tt
          }
        }
        // its side again, upside down in the floor
        if (sides && b.z0 < 14) {
          const m0 = Math.max(0, Math.ceil(cy + ((EYE + b.z0) * focal) / tn - 0.5))
          const m1 = Math.min(H, Math.ceil(cy + ((EYE + b.h) * focal) / tn - 0.5))
          for (let row = m0; row < m1; row++) {
            const o = row * W + col
            if (rk[o] === 0 || rz[o] <= tn) continue
            const z = -(EYE + ((cy - row - 0.5) * tn) / focal)
            const c = b.paint(face, along, z)
            if (!c) continue
            shadeBox(c, b.glow, fnx, fny, 0, hx, hy, z, tn)
            qr[o] = R
            qg[o] = G
            qb[o] = B
            rz[o] = tn
          }
        }
      }
    }

    // together: the floor's mirror over the floor, the shafts of sun in the air
    const sr = 92 * sunK
    const sg = 84 * sunK
    const sb = 66 * sunK
    for (let row = 0; row < H; row++) {
      for (let o = row * W + c0, oe = row * W + c1; o < oe; o++) {
        const k = rk[o]
        let r = cr[o]
        let g = cg[o]
        let b = cbuf[o]
        if (k > 0) {
          r += (qr[o] - r) * k
          g += (qg[o] - g) * k
          b += (qb[o] - b) * k
        }
        const s = bm[o]
        if (s > 0) {
          r += sr * s
          g += sg * s
          b += sb * s
        }
        fb[o] = ((255 << 24) | (clamp(b, 0, 255) << 16) | (clamp(g, 0, 255) << 8) | clamp(r, 0, 255)) >>> 0
      }
    }
  }

  return { enter, step, render, me }
}
