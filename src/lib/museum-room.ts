// Inside the museum: one gallery, seen in first person. A tall room with walls of red cloth over a dark
// dado, a black band and a gilt cornice under a cream frieze, a coffered ceiling with a skylight in the
// middle, and a herringbone parquet. Two grey sofas stand back to back against a dark plinth in the middle.
// The paintings (paintings.ts) hang on wires, in gilt frames, each with a little card beside it. The door
// out is in the middle of the front wall, under a medallion with a bust.
//
// It has its own renderer, a ray caster: the room is a box, so each column of the frame finds the wall its
// ray meets, and each row above or below it the ceiling or the floor at that distance. The sofas and the
// plinth are boxes drawn over that with a depth per pixel.
//
// Room units are the world's: the man is about 5.5 tall. x runs across the room, y from the back wall
// (y = 0) to the front wall with the door (y = RD). Forward is (sin yaw, −cos yaw), as outside.

import { buildPaintings } from './paintings.ts'

export const ROOM_W = 44
export const ROOM_D = 30
const RW = ROOM_W
const RD = ROOM_D
const EYE = 4.4
const CEIL = 14
const DOOR_U = RW / 2 // the door is in the middle of the front wall …
const DOOR_HW = 1.7 // … this wide either side …
const DOOR_H = 6.8 // … and this tall
const BODY = 0.9 // how near a wall or the sofas the man can come
const WALK = 9
const TURN = 2.1

// walls: 0 the back (y = 0), 1 the right (x = RW), 2 the front with the door (y = RD), 3 the left (x = 0).
// u runs along each from left to right as seen from inside, facing it.
const WALL_LEN = [RW, RD, RW, RD]
const WALL_LIGHT = [1, 0.86, 0.8, 0.9]

// where each painting hangs: its wall, the middle of it along the wall, the height of its foot, units a pixel
const HANG = [
  { id: 'assumption', wall: 0, u: 7, z: 2.8, k: 0.32 },
  { id: 'supper', wall: 0, u: 22, z: 3.6, k: 0.3 },
  { id: 'annunciation', wall: 0, u: 37, z: 3.3, k: 0.3 },
  { id: 'adoration', wall: 1, u: 9, z: 3.2, k: 0.3 },
  { id: 'baptism', wall: 1, u: 21, z: 3.0, k: 0.3 },
  { id: 'pieta', wall: 2, u: 10, z: 3.4, k: 0.3 },
  { id: 'prayer', wall: 2, u: 34, z: 3.6, k: 0.32 },
  { id: 'madonna', wall: 3, u: 9, z: 3.0, k: 0.3 },
  { id: 'crucifixion', wall: 3, u: 21, z: 2.8, k: 0.3 },
]
const FRAME = 0.4

// the sofas and the plinth between them: boxes { x0, x1, y0, y1, h, c (side colour), top, legs }
const SOFA = [112, 116, 134]
const SOFA_TOP = [136, 140, 158]
const PLINTH = [50, 38, 32]
const PLINTH_TOP = [76, 60, 48]
const MID_X = RW / 2
const MID_Y = RD / 2
function sofaBoxes(y0, y1, backY0, backY1) {
  return [
    { x0: MID_X - 2.2, x1: MID_X + 2.2, y0, y1, h: 1.45, c: SOFA, top: SOFA_TOP, legs: true },
    { x0: MID_X - 2.2, x1: MID_X + 2.2, y0: backY0, y1: backY1, h: 2.7, c: SOFA, top: SOFA_TOP },
    { x0: MID_X - 2.2, x1: MID_X - 1.75, y0, y1, h: 2.0, c: SOFA, top: SOFA_TOP },
    { x0: MID_X + 1.75, x1: MID_X + 2.2, y0, y1, h: 2.0, c: SOFA, top: SOFA_TOP },
  ]
}
const BOXES = [
  { x0: MID_X - 2.4, x1: MID_X + 2.4, y0: MID_Y - 0.7, y1: MID_Y + 0.7, h: 3.1, c: PLINTH, top: PLINTH_TOP },
  ...sofaBoxes(MID_Y + 0.7, MID_Y + 2.3, MID_Y + 0.7, MID_Y + 1.25),
  ...sofaBoxes(MID_Y - 2.3, MID_Y - 0.7, MID_Y - 1.25, MID_Y - 0.7),
]
const BLOCK = { x0: MID_X - 2.4, x1: MID_X + 2.4, y0: MID_Y - 2.3, y1: MID_Y + 2.3 } // what the man walks round

function hash(x, y) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

export function createMuseumRoom() {
  let pics = null
  let hung = []
  const me = { x: RW / 2, y: RD - 2, yaw: 0 }
  // the colour being worked out, and the light of this frame
  let R = 0, G = 0, B = 0
  let dark = 0
  let skyC = [200, 222, 240]
  let zb = new Float32Array(0)

  function paint() {
    if (pics) return
    pics = buildPaintings()
    hung = HANG.map((h) => {
      const p = pics[h.id]
      const w = p.w * h.k
      const ht = p.h * h.k
      return { ...h, p, w, ht, u0: h.u - w / 2, top: h.z + ht, arch: !!p.mask }
    })
  }

  /** come in by the door, facing into the room */
  function enter() {
    paint()
    me.x = DOOR_U
    me.y = RD - 1.6
    me.yaw = 0
  }

  /** walk: turn and move from -1 to 1. True when the man has walked out through the door. */
  function step(dt, turn, move) {
    me.yaw += turn * TURN * dt
    if (move === 0) return false
    const nx = me.x + Math.sin(me.yaw) * move * WALK * dt
    const ny = me.y - Math.cos(me.yaw) * move * WALK * dt
    if (ny > RD - BODY && Math.abs(nx - DOOR_U) < DOOR_HW - 0.2) return true
    const inBlock = (x, y) => x > BLOCK.x0 - BODY && x < BLOCK.x1 + BODY && y > BLOCK.y0 - BODY && y < BLOCK.y1 + BODY
    const cx = clamp(nx, BODY, RW - BODY)
    const cy = clamp(ny, BODY, RD - BODY)
    // slide along what is in the way
    if (!inBlock(cx, cy)) { me.x = cx; me.y = cy } else if (!inBlock(cx, me.y)) me.x = cx
    else if (!inBlock(me.x, cy)) me.y = cy
    return false
  }

  // ── colours of the room's surfaces: each sets R, G, B

  function set(c, k = 1) {
    R = c[0] * k
    G = c[1] * k
    B = c[2] * k
  }

  function floorAt(x, y, dist) {
    // a herringbone of oak: cells of 0.4 on the diagonal, planks two cells long, turning at each step
    const s = 0.4
    const u = (x + y) * 0.7071 / s
    const v = (x - y) * 0.7071 / s
    const i = Math.floor(u)
    const j = Math.floor(v)
    const fx = u - i
    const fy = v - j
    const d = (((i - j) % 4) + 4) % 4
    let ai, aj, edge
    if (d < 2) { ai = i - d; aj = j; edge = fy < 0.12 || (d === 0 && fx < 0.1) }
    else { ai = i; aj = d === 2 ? j - 1 : j; edge = fx < 0.12 || (d === 3 && fy < 0.1) }
    const h = hash(ai * 2 + (d < 2 ? 0 : 1), aj)
    let r = 196 + (h - 0.5) * 34
    let g = 150 + (h - 0.5) * 28
    let b = 92 + (h - 0.5) * 20
    if (edge) { r -= 44; g -= 38; b -= 28 }
    // far off the grain is too fine to see: it goes to the floor's own colour
    const t = clamp((dist - 9) / 12, 0, 1)
    R = r + (194 - r) * t
    G = g + (148 - g) * t
    B = b + (90 - b) * t
    // a little brighter under the skylight
    const k = 1.06 - Math.min(0.16, Math.hypot(x - RW / 2, y - RD / 2) * 0.01)
    R *= k; G *= k; B *= k
  }

  function ceilingAt(x, y) {
    const edge = Math.min(x, y, RW - x, RD - y)
    if (edge < 1.2) {
      // the cove over the frieze: cream, picked out in gold
      set(edge < 0.25 || (edge > 1.0 && edge < 1.2) ? [176, 140, 72] : [222, 212, 186])
      return
    }
    const sx = x - RW / 2
    const sy = y - RD / 2
    if (Math.abs(sx) < 10 && Math.abs(sy) < 8) {
      if (Math.abs(sx) > 9.5 || Math.abs(sy) > 7.5) { set([150, 118, 66]); return }
      const mull = Math.abs(sx / 1.4 - Math.round(sx / 1.4)) < 0.07 || Math.abs(sy / 1.4 - Math.round(sy / 1.4)) < 0.07
      const day = [226, 234, 238]
      const night = [34, 44, 74]
      const g = [day[0] + (night[0] - day[0]) * dark, day[1] + (night[1] - day[1]) * dark, day[2] + (night[2] - day[2]) * dark]
      set(mull ? [140, 146, 152] : g, mull ? 1 - dark * 0.6 : 1)
      return
    }
    // coffers round the skylight, each with a gilt rosette
    const cx = x / 2.4 - Math.floor(x / 2.4)
    const cy = y / 2.4 - Math.floor(y / 2.4)
    if (cx < 0.1 || cy < 0.1) set([200, 186, 154])
    else if (Math.hypot(cx - 0.55, cy - 0.55) < 0.14) set([206, 168, 90])
    else set([234, 224, 198], cx < 0.2 || cy < 0.2 ? 0.9 : 1)
  }

  function wallAt(w, u, z, px) {
    // the door, and the medallion over it
    if (w === 2) {
      const du = Math.abs(u - DOOR_U)
      if (du < DOOR_HW && z < DOOR_H) {
        // the day outside: sky over the trees, the paved forecourt below
        if (z > 3.3) { set(skyC, 1); return }
        if (z > 2.4) { set([110, 140, 92], 1 - dark * 0.8); return }
        set([200, 192, 172], 1 - dark * 0.75)
        return
      }
      if (du < DOOR_HW + 0.6 && z < DOOR_H + 0.6) {
        set(du < DOOR_HW + 0.1 && z < DOOR_H + 0.1 ? [176, 140, 70] : [44, 34, 30])
        return
      }
      if (du < DOOR_HW + 1.0 && z >= DOOR_H + 0.6 && z < DOOR_H + 1.4) {
        set(z > DOOR_H + 1.28 ? [176, 140, 70] : [36, 28, 26])
        return
      }
      const mz = DOOR_H + 2.5
      const dm = Math.hypot(u - DOOR_U, z - mz)
      if (dm < 0.85) {
        if (dm > 0.66) set([30, 26, 26])
        else if (((u - DOOR_U) / 0.28) ** 2 + ((z - mz - 0.12) / 0.34) ** 2 <= 1 || (z < mz - 0.2 && z > mz - 0.55 && du < 0.45)) set([226, 224, 218])
        else set([60, 64, 72])
        return
      }
    }
    // the paintings, their frames, wires and cards
    for (const h of hung) {
      if (h.wall !== w || u < h.u0 - FRAME - 1 || u > h.u0 + h.w + FRAME + 1.2) continue
      const r = h.u0 + h.w
      // the wire it hangs from
      if (z > h.top + FRAME && z < 12) {
        const wires = h.arch ? [h.u] : [h.u0 + 0.35, r - 0.35]
        for (const wu of wires) if (Math.abs(u - wu) < Math.max(0.03, px * 0.55)) { set([66, 40, 34]); return }
      }
      // its card
      if (u > r + 0.5 && u < r + 1.0 && z > 3.0 && z < 3.35) { set([232, 226, 210]); return }
      // the canvas
      if (u >= h.u0 && u < r && z >= h.z && z < h.top) {
        const ix = Math.floor((u - h.u0) / h.k)
        const iy = Math.floor((h.top - z) / h.k)
        const o = iy * h.p.w + ix
        if (!h.arch || h.p.mask[o]) {
          const c = h.p.px[o]
          R = c & 255
          G = (c >> 8) & 255
          B = (c >> 16) & 255
          return
        }
      }
      // the frame: how far out from the canvas, round the arch where there is one
      let d = Math.max(h.u0 - u, u - r, h.z - z, z - h.top)
      const zc = h.top - h.w / 2
      if (h.arch && z > zc) d = Math.max(h.u0 - u, u - r, h.z - z, Math.hypot(u - h.u, z - zc) - h.w / 2)
      if (d > 0 && d <= FRAME) {
        const t = d / FRAME
        if (t > 0.82) set([40, 30, 20])
        else if (t < 0.15) set([70, 52, 28])
        else if (t > 0.4 && t < 0.55) set([226, 190, 104])
        else set([184, 144, 64])
        return
      }
    }
    // the wall: a dark dado, the red cloth, a black band, gilt dentils, a cream frieze
    if (z < 2.3) {
      if (z < 0.3) set([24, 20, 20])
      else if (z >= 2.0) set([74, 58, 46])
      else set(u / 3 - Math.floor(u / 3) < 0.03 ? [60, 50, 46] : [38, 32, 32])
      return
    }
    if (z < 12) {
      const seam = Math.abs(u / 2.4 - Math.round(u / 2.4)) * 2.4 < Math.max(0.03, px * 0.5)
      set(seam ? [166, 60, 44] : [186, 72, 52], z > 9.5 ? 1 - (z - 9.5) * 0.05 : 1)
      return
    }
    if (z < 12.35) { set([26, 22, 22]); return }
    if (z < 12.8) { set(u / 0.4 - Math.floor(u / 0.4) < 0.55 ? [176, 140, 66] : [60, 46, 30]); return }
    if (z > 13.88) { set([176, 140, 72]); return }
    const hh = hash(Math.floor(u * 5), Math.floor(z * 5))
    set(hh < 0.3 ? [246, 240, 222] : hh > 0.85 ? [176, 160, 124] : [226, 216, 190])
  }

  /** draw the room into the frame (packed 0xAABBGGRR, W by H); night from 0 (day) to 1 */
  function render(fb, W, H, night) {
    paint()
    dark = clamp(night, 0, 1)
    skyC = [200 + (24 - 200) * dark, 222 + (34 - 222) * dark, 240 + (70 - 240) * dark]
    if (zb.length !== W * H) zb = new Float32Array(W * H)
    const focal = Math.max(W, H * 0.75) / 2 / Math.tan(0.62)
    const cy = H * 0.54
    const fx = Math.sin(me.yaw)
    const fy = -Math.cos(me.yaw)
    const plane = W / 2 / focal
    const rx = Math.cos(me.yaw) * plane
    const ry = Math.sin(me.yaw) * plane
    // the lamps at night: a little dimmer and warmer
    const lr = 1 - dark * 0.12
    const lg = 1 - dark * 0.18
    const lb = 1 - dark * 0.3
    for (let col = 0; col < W; col++) {
      const cam = (2 * (col + 0.5)) / W - 1
      const dx = fx + rx * cam
      const dy = fy + ry * cam
      // the wall this column's ray meets, and how far
      let t = 1e9
      let w = 0
      if (dx > 1e-6) { t = (RW - me.x) / dx; w = 1 } else if (dx < -1e-6) { t = -me.x / dx; w = 3 }
      if (dy > 1e-6) { const ty = (RD - me.y) / dy; if (ty < t) { t = ty; w = 2 } } else if (dy < -1e-6) { const ty = -me.y / dy; if (ty < t) { t = ty; w = 0 } }
      const hx = me.x + dx * t
      const hy = me.y + dy * t
      const u = w === 0 ? hx : w === 1 ? hy : w === 2 ? RW - hx : RD - hy
      const top = cy - ((CEIL - EYE) * focal) / t
      const bot = cy + (EYE * focal) / t
      const px = t / focal
      const fade = 1 - Math.min(0.22, t * 0.007)
      for (let row = 0; row < H; row++) {
        let d
        let k = fade
        if (row < top) {
          d = ((CEIL - EYE) * focal) / (cy - row - 0.5)
          ceilingAt(me.x + dx * d, me.y + dy * d)
          k = 1 - Math.min(0.22, d * 0.007)
        } else if (row >= bot) {
          d = (EYE * focal) / (row + 0.5 - cy)
          floorAt(me.x + dx * d, me.y + dy * d, d)
          k = 1 - Math.min(0.22, d * 0.007)
        } else {
          d = t
          wallAt(w, u, EYE + ((cy - row - 0.5) * t) / focal, px)
          k *= WALL_LIGHT[w]
        }
        const o = row * W + col
        zb[o] = d
        fb[o] = (255 << 24 | (clamp(B * k * lb, 0, 255) << 16) | (clamp(G * k * lg, 0, 255) << 8) | clamp(R * k * lr, 0, 255)) >>> 0
      }
      // the sofas and the plinth
      for (const b of BOXES) {
        let tn = -1e9, tf = 1e9, xFace = false
        if (Math.abs(dx) < 1e-9) { if (me.x < b.x0 || me.x > b.x1) continue } else {
          const a1 = (b.x0 - me.x) / dx
          const a2 = (b.x1 - me.x) / dx
          tn = Math.min(a1, a2); tf = Math.max(a1, a2); xFace = true
        }
        if (Math.abs(dy) < 1e-9) { if (me.y < b.y0 || me.y > b.y1) continue } else {
          const a1 = (b.y0 - me.y) / dy
          const a2 = (b.y1 - me.y) / dy
          const n = Math.min(a1, a2)
          if (n > tn) { tn = n; xFace = false }
          tf = Math.min(tf, Math.max(a1, a2))
        }
        if (tn >= tf || tf <= 0.05 || tn <= 0.05) continue
        const shade = (xFace ? 0.8 : 0.92) * (1 - Math.min(0.22, tn * 0.007))
        // the side it shows
        const rTop = Math.max(0, Math.ceil(cy - ((b.h - EYE) * focal) / tn - 0.5))
        const rBot = Math.min(H, Math.ceil(cy + (EYE * focal) / tn - 0.5))
        const along = xFace ? me.y + dy * tn : me.x + dx * tn
        const lo = xFace ? b.y0 : b.x0
        const hi = xFace ? b.y1 : b.x1
        const leg = along - lo < 0.28 || hi - along < 0.28
        for (let row = rTop; row < rBot; row++) {
          const o = row * W + col
          if (zb[o] <= tn) continue
          const z = EYE + ((cy - row - 0.5) * tn) / focal
          let c = b.c
          if (b.legs && z < 0.35) { if (!leg) continue; c = [40, 30, 26] } else if (b.legs && z < 0.45) c = [84, 86, 100]
          zb[o] = tn
          fb[o] = (255 << 24 | (clamp(c[2] * shade * lb, 0, 255) << 16) | (clamp(c[1] * shade * lg, 0, 255) << 8) | clamp(c[0] * shade * lr, 0, 255)) >>> 0
        }
        // its top, seen from above
        if (EYE > b.h) {
          const e = EYE - b.h
          const r0 = Math.max(0, Math.ceil(cy + (e * focal) / tf - 0.5))
          const r1 = Math.min(H, Math.ceil(cy + (e * focal) / tn - 0.5))
          const k = 1.06 * (1 - Math.min(0.22, tn * 0.007))
          for (let row = r0; row < r1; row++) {
            const tt = (e * focal) / (row + 0.5 - cy)
            const o = row * W + col
            if (tt < tn || tt > tf || zb[o] <= tt) continue
            zb[o] = tt
            fb[o] = (255 << 24 | (clamp(b.top[2] * k * lb, 0, 255) << 16) | (clamp(b.top[1] * k * lg, 0, 255) << 8) | clamp(b.top[0] * k * lr, 0, 255)) >>> 0
          }
        }
      }
    }
  }

  return { enter, step, render, me }
}
