// Inside the museum: one gallery, seen in first person. A tall room with walls of red cloth over a dark
// dado, a black band and a gilt cornice under a cream frieze, a coffered ceiling with a skylight in the
// middle, and a herringbone parquet. Two gilt Louis XV benches face the side walls, and two Sèvres vases
// stand on marble columns either side of the Last Supper.
// The paintings (paintings.ts) hang on wires, in gilt frames, each with a little card beside it. The door
// out is in the middle of the front wall, under a medallion with a bust.
//
// It has its own renderer, a ray caster: the room is a box, so each column of the frame finds the wall its
// ray meets, and each row above or below it the ceiling or the floor at that distance. The benches and the
// columns are boxes drawn over that with a depth per pixel; the vases are round, found by marching the ray.
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
const BODY = 0.9 // how near a wall, a bench or a column the man can come
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

// the furniture, as boxes { x0, x1, y0, y1, z0 (its foot, 0 if left out), h (its top), c (side colour), top }
const MID_X = RW / 2
const MID_Y = RD / 2
const BOXES = []

// Two benches in the manner of Louis XV, one either side of the room, long side to the side walls so you
// sit facing the paintings there. A seat stuffed high and buttoned, in a sage silk damask, on a gilt frame:
// serpentine rails with a carved shell in the middle of each, and four cabriole legs on scroll feet.
// A box may start above the floor (z0) and have its faces painted: paint(xFace, along, z) and
// topPaint(x, y) give a colour, or null where the face is open (the rails' shaped lower edge).
const GILT = [198, 160, 72]
const GILT_DK = [126, 90, 38]
const GILT_HI = [242, 214, 132]
const DAMASK = [132, 154, 118]
const DAMASK_DK = [100, 122, 88]
const DAMASK_HI = [168, 186, 150]
const BUTTON = [70, 88, 62]
const BENCH_X = [8.5, RW - 8.5] // where they stand across the room
const BENCH_HL = 2.3 // half the length, along the wall …
const BENCH_HW = 0.85 // … and half the depth
const RAIL_T = 0.12
const RAIL_Z0 = 0.78
const SEAT_Z = 1.28 // the top of the frame
const PAD_Z = 1.62 // the stuffed seat …
const DOME_Z = 1.74 // … and its crown
// the cabriole leg from the foot up: from, to, how far out from its line (towards the corner), half width
const LEG = [
  [0, 0.12, 0.05, 0.12], // the scroll foot
  [0.12, 0.3, -0.03, 0.07], // the ankle
  [0.3, 0.5, 0, 0.085],
  [0.5, 0.66, 0.05, 0.105],
  [0.66, RAIL_Z0 + 0.06, 0.1, 0.14], // the knee, swelling out under the rail
]
const LEG_IN = 0.26 // the leg's line, in from the corner
const PC = [0, 0, 0] // the colour a painted face gives back
const put = (c, k = 1) => {
  PC[0] = c[0] * k
  PC[1] = c[1] * k
  PC[2] = c[2] * k
  return PC
}
/** carved and gilded: little ripples of light and hollow */
function gilt(s, z) {
  const v = Math.sin(s * 11 + z * 17) + 0.6 * Math.sin(s * 23 - z * 9)
  return v > 0.95 ? GILT_HI : v < -0.95 ? GILT_DK : GILT
}
/** silk damask, a in one way along the face and b the other: lozenges with a flower, a sheen on alternate ones */
function damask(a, b, k = 1) {
  const p = a * 2.4
  const q = b * 2.4
  const i = Math.floor(p + q)
  const j = Math.floor(p - q)
  const fu = p + q - i - 0.5
  const fv = p - q - j - 0.5
  const r = Math.abs(fu) + Math.abs(fv)
  if (r > 0.44) return put(DAMASK_DK, k) // the lattice between the lozenges
  if (r < 0.16) return put((i + j) & 1 ? DAMASK_HI : DAMASK_DK, k) // the flower
  return put((i + j) & 1 ? DAMASK : DAMASK_HI, k * 0.97)
}
/** the lower edge of a rail, u from 0 to 1 along it: serpentine, dipping to a shell in the middle and to the knees */
function railEdge(u) {
  const mid = Math.exp(-(((u - 0.5) / 0.08) ** 2))
  const end = Math.exp(-((u / 0.07) ** 2)) + Math.exp(-(((1 - u) / 0.07) ** 2))
  return 1.04 - 0.22 * mid - 0.24 * end - 0.04 * Math.cos((u - 0.5) * Math.PI * 4)
}
const SHELL_Z = railEdge(0.5)
/** a rail's face: from and len its span along the face it shows (xFace says which way that face looks) */
function railPaint(xMain, from, len) {
  return (xFace, s, z) => {
    if (xFace !== xMain) return put(gilt(s, z), 0.9)
    const u = (s - from) / len
    const e = railEdge(u)
    if (z < e) return null
    // the shell: ribs fanning up from its foot, with a scalloped rim
    const m = (u - 0.5) * len
    const r = Math.hypot(m, z - SHELL_Z)
    const a = Math.atan2(m, z - SHELL_Z)
    if (r < 0.3 + 0.03 * Math.cos(a * 9)) {
      if (r > 0.25 + 0.03 * Math.cos(a * 9)) return put(GILT_DK)
      return put(Math.floor((a + 2) * 3.2) & 1 ? GILT_HI : GILT)
    }
    if (z > SEAT_Z - 0.06 || z < e + 0.05) return put(GILT_HI) // the beads along the top and the edge
    return put(gilt(s, z))
  }
}
function benchBoxes(cx) {
  const x0 = cx - BENCH_HW
  const x1 = cx + BENCH_HW
  const y0 = MID_Y - BENCH_HL
  const y1 = MID_Y + BENCH_HL
  const out = []
  // the rails: long ones under the sides, short ones at the ends
  out.push({ x0, x1: x0 + RAIL_T, y0, y1, z0: RAIL_Z0, h: SEAT_Z, c: GILT, top: GILT, paint: railPaint(true, y0, y1 - y0) })
  out.push({ x0: x1 - RAIL_T, x1, y0, y1, z0: RAIL_Z0, h: SEAT_Z, c: GILT, top: GILT, paint: railPaint(true, y0, y1 - y0) })
  out.push({ x0, x1, y0, y1: y0 + RAIL_T, z0: RAIL_Z0, h: SEAT_Z, c: GILT, top: GILT, paint: railPaint(false, x0, x1 - x0) })
  out.push({ x0, x1, y0: y1 - RAIL_T, y1, z0: RAIL_Z0, h: SEAT_Z, c: GILT, top: GILT, paint: railPaint(false, x0, x1 - x0) })
  // the seat: damask sides with a thin gold braid at the foot and a rolled edge, a buttoned crown
  const sides = (xFace, s, z) => {
    if (z < SEAT_Z + 0.05) return put(GILT, 0.95)
    if (z > PAD_Z - 0.06) return put(DAMASK_HI)
    return damask(s, z * 0.8, 0.94)
  }
  const crown = (x, y) => {
    // buttons in a diamond grid, and the creases running between them
    const bx = (x - cx) / 0.42
    const by = (y - MID_Y) / 0.5
    const rx = bx - Math.round(bx)
    const row = Math.round(by)
    const ox = row & 1 ? 0.5 : 0
    const ux = bx + ox - Math.round(bx + ox)
    const uy = by - row
    if (ux * ux + uy * uy * 0.7 < 0.03) return put(BUTTON)
    if (Math.abs(Math.abs(ux) - Math.abs(uy)) < 0.06 && rx * rx < 1) return put(DAMASK_DK, 0.95)
    // a sheen towards the middle, where it is stuffed highest
    const k = 1.08 - 0.12 * Math.min(1, Math.abs(x - cx) / BENCH_HW)
    return damask(x, y, k)
  }
  out.push({ x0, x1, y0, y1, z0: SEAT_Z, h: PAD_Z, c: DAMASK, top: DAMASK, paint: sides, topPaint: crown })
  out.push({ x0: x0 + 0.1, x1: x1 - 0.1, y0: y0 + 0.1, y1: y1 - 0.1, z0: PAD_Z, h: DOME_Z, c: DAMASK_HI, top: DAMASK, paint: () => put(DAMASK_HI, 0.98), topPaint: crown })
  // the legs, each a stack of short pieces, curving out at the knee and in at the ankle
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const lx = cx + sx * (BENCH_HW - LEG_IN)
      const ly = MID_Y + sy * (BENCH_HL - LEG_IN)
      for (const [z0, z1, o, hw] of LEG) {
        const px = lx + sx * o
        const py = ly + sy * o
        const foot = z0 === 0
        out.push({
          x0: px - hw, x1: px + hw, y0: py - hw, y1: py + hw, z0, h: z1, c: GILT, top: GILT_HI,
          paint: (xFace, s, z) => put(foot && z > 0.07 ? GILT_HI : gilt(s * 2, z), xFace === (sx > 0) ? 1 : 0.9),
        })
      }
    }
  }
  return out
}
BOXES.push(...benchBoxes(BENCH_X[0]), ...benchBoxes(BENCH_X[1]))

// Two porcelain vases in the manner of Sèvres, either side of the Last Supper against the back wall, so
// they are the first thing seen coming in: a baluster in royal blue with gilt bands and a sprinkle of gilt
// dots, a white panel of flowers in a gilt frame on the side facing the room. Each stands on a column of
// green marble. A vase is round, so it is not a box: each pixel marches its ray through the vase's
// profile (VASE_PROFILE, radius by height) to find where it first meets it.
const VASE_X = [MID_X - 9.2, MID_X + 9.2]
const VASE_Y = 1.3
const PED_H = 2.4 // the column's top, where the vase stands …
const VASE_H = 3.2 // … and the vase's height
// height (0 at the foot, 1 at the lip) and radius: foot, stem, body, shoulder, neck, flared lip
const VASE_PROFILE = [
  [0, 0.34], [0.06, 0.34], [0.09, 0.2], [0.14, 0.22], [0.28, 0.48], [0.42, 0.58], [0.55, 0.52],
  [0.68, 0.3], [0.8, 0.18], [0.9, 0.19], [0.96, 0.27], [1, 0.33],
]
const VASE_K = 1.2 // the profile's radii are scaled by this
const VASE_R = 0.58 * VASE_K
const VASE_BLUE = [26, 50, 142]
const PORCELAIN = [238, 236, 226]
const MARBLE = [46, 74, 60]
const MARBLE_VEIN = [112, 146, 124]
const LEAF = [72, 128, 70]
// the blooms of the posy on the panel: across and up it (-1 to 1), and colour
const POSY = [[0, 0.1, [196, 58, 74]], [-0.38, -0.12, [232, 150, 170]], [0.36, -0.1, [240, 196, 80]], [0.05, -0.42, [150, 92, 170]]]
/** the vase's radius at height u (0 to 1) */
function vaseR(u) {
  const P = VASE_PROFILE
  if (u <= 0) return P[0][1] * VASE_K
  for (let i = 1; i < P.length; i++) {
    if (u <= P[i][0]) {
      const f = (u - P[i - 1][0]) / (P[i][0] - P[i - 1][0])
      const s = (1 - Math.cos(f * Math.PI)) / 2 // eased, so the curve has no corners
      return (P[i - 1][1] + (P[i][1] - P[i - 1][1]) * s) * VASE_K
    }
  }
  return P[P.length - 1][1] * VASE_K
}
/** the vase's colour at height u and angle a round it (0 facing the room), before light */
function vaseColour(u, a) {
  // gilt bands: the foot, the stem, the shoulder, the neck and the lip
  if ((u > 0.055 && u < 0.085) || (u > 0.13 && u < 0.155) || (u > 0.66 && u < 0.69) || (u > 0.88 && u < 0.91) || u > 0.97) return GILT_HI
  if (u < 0.055) return GILT
  // the panel of flowers in its gilt frame, on the side facing the room
  const e = (a / 0.85) ** 2 + ((u - 0.41) / 0.17) ** 2
  if (e < 1) {
    if (e > 0.8) return GILT
    // a posy: a few round blooms and leaves round them
    const fu = (u - 0.41) / 0.17
    const fa = a / 0.85
    for (const [ba, bu, c] of POSY) {
      const d = (fa - ba) ** 2 + (fu - bu) ** 2
      if (d < 0.025) return c
      if (d < 0.06) return LEAF
    }
    return PORCELAIN
  }
  // royal blue, with gilt dots in rows
  const i = Math.round(a * 4.5)
  const j = Math.round(u * 26)
  if ((i + j) % 2 === 0 && (a * 4.5 - i) ** 2 + (u * 26 - j) ** 2 < 0.05) return GILT_HI
  return VASE_BLUE
}
// the columns, as boxes: a base, a shaft of marble with veins, and a capital, gilt beads between
function pedestalBoxes(cx) {
  const marble = (xFace, s, z) => {
    if (z > PED_H - 0.08 || (z > 2.0 && z < 2.06) || (z > 0.3 && z < 0.36)) return put(GILT)
    const v = Math.sin(s * 7 + z * 3 + Math.sin(z * 5 + s * 2) * 2)
    return put(v > 0.9 ? MARBLE_VEIN : MARBLE, v < -0.6 ? 0.85 : 1)
  }
  const top = (x, y) => put(MARBLE, 1.1)
  const box = (hw, z0, h) => ({ x0: cx - hw, x1: cx + hw, y0: VASE_Y - hw, y1: VASE_Y + hw, z0, h, c: MARBLE, top: MARBLE, paint: marble, topPaint: top })
  return [box(0.75, 0, 0.36), box(0.55, 0.36, 2.06), box(0.7, 2.06, PED_H)]
}
BOXES.push(...pedestalBoxes(VASE_X[0]), ...pedestalBoxes(VASE_X[1]))

// what the man walks round
const SOLID = [
  ...BENCH_X.map((cx) => ({ x0: cx - BENCH_HW, x1: cx + BENCH_HW, y0: MID_Y - BENCH_HL, y1: MID_Y + BENCH_HL })),
  ...VASE_X.map((cx) => ({ x0: cx - 0.75, x1: cx + 0.75, y0: VASE_Y - 0.75, y1: VASE_Y + 0.75 })),
]
/** how much light reaches the floor at (x, y): a soft shadow under and round the seats */
function floorShade(x, y) {
  let k = 1
  for (const r of SOLID) {
    const ex = Math.max(r.x0 - x, 0, x - r.x1)
    const ey = Math.max(r.y0 - y, 0, y - r.y1)
    const d = Math.hypot(ex, ey)
    if (d < 0.7) k = Math.min(k, 0.62 + 0.38 * (d / 0.7))
  }
  return k
}

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
  function step(dt, turn, move, side = 0) {
    me.yaw += turn * TURN * dt
    if (move === 0 && side === 0) return false
    const sn = Math.sin(me.yaw)
    const cs = Math.cos(me.yaw)
    const k = (WALK * dt) / Math.max(1, Math.hypot(move, side))
    const nx = me.x + (sn * move + cs * side) * k
    const ny = me.y + (-cs * move + sn * side) * k
    if (ny > RD - BODY && Math.abs(nx - DOOR_U) < DOOR_HW - 0.2) return true
    const inBlock = (x, y) => SOLID.some((b) => x > b.x0 - BODY && x < b.x1 + BODY && y > b.y0 - BODY && y < b.y1 + BODY)
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
          const gx = me.x + dx * d
          const gy = me.y + dy * d
          floorAt(gx, gy, d)
          k = (1 - Math.min(0.22, d * 0.007)) * floorShade(gx, gy)
        } else {
          d = t
          wallAt(w, u, EYE + ((cy - row - 0.5) * t) / focal, px)
          k *= WALL_LIGHT[w]
        }
        const o = row * W + col
        zb[o] = d
        fb[o] = (255 << 24 | (clamp(B * k * lb, 0, 255) << 16) | (clamp(G * k * lg, 0, 255) << 8) | clamp(R * k * lr, 0, 255)) >>> 0
      }
      // the benches and the vases' columns
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
        const rBot = Math.min(H, Math.ceil(cy + ((EYE - (b.z0 || 0)) * focal) / tn - 0.5))
        const along = xFace ? me.y + dy * tn : me.x + dx * tn
        for (let row = rTop; row < rBot; row++) {
          const o = row * W + col
          if (zb[o] <= tn) continue
          const z = EYE + ((cy - row - 0.5) * tn) / focal
          let c = b.c
          if (b.paint) {
            c = b.paint(xFace, along, z)
            if (!c) continue
          }
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
            const c = b.topPaint ? b.topPaint(me.x + dx * tt, me.y + dy * tt) : b.top
            zb[o] = tt
            fb[o] = (255 << 24 | (clamp(c[2] * k * lb, 0, 255) << 16) | (clamp(c[1] * k * lg, 0, 255) << 8) | clamp(c[0] * k * lr, 0, 255)) >>> 0
          }
        }
      }
      // the vases: where the ray passes within VASE_R of the axis, each row marches through and finds the
      // first point inside the profile
      for (const vx of VASE_X) {
        const ox = me.x - vx
        const oy = me.y - VASE_Y
        const a2 = dx * dx + dy * dy
        const bq = ox * dx + oy * dy
        const disc = bq * bq - a2 * (ox * ox + oy * oy - VASE_R * VASE_R)
        if (disc <= 0) continue
        const sq = Math.sqrt(disc)
        const t1 = (-bq + sq) / a2
        if (t1 <= 0.1) continue
        const t0 = Math.max(0.1, (-bq - sq) / a2)
        const z0 = PED_H
        const z1 = PED_H + VASE_H
        const rA = Math.max(0, Math.floor(cy - ((z1 - EYE) * focal) / (z1 > EYE ? t0 : t1)))
        const rB = Math.min(H, Math.ceil(cy - ((z0 - EYE) * focal) / (z0 > EYE ? t1 : t0)))
        const steps = 24
        const st = (t1 - t0) / steps
        const fade = 1 - Math.min(0.22, t0 * 0.007)
        for (let row = rA; row < rB; row++) {
          const o = row * W + col
          if (zb[o] <= t0) continue
          const sl = (cy - row - 0.5) / focal // the height the ray gains for each unit of depth
          const inside = (tt) => {
            const u = (EYE + sl * tt - z0) / VASE_H
            if (u < 0 || u > 1) return false
            const r = vaseR(u)
            const px = ox + dx * tt
            const py = oy + dy * tt
            return px * px + py * py <= r * r
          }
          let hit = -1
          for (let i = 0; i <= steps; i++) {
            const tt = t0 + i * st
            if (inside(tt)) {
              // close in on the edge, so the outline is smooth
              let lo = i > 0 ? tt - st : tt
              let hi = tt
              for (let j = 0; j < 5 && i > 0; j++) {
                const mid = (lo + hi) / 2
                if (inside(mid)) hi = mid
                else lo = mid
              }
              hit = hi
              break
            }
          }
          if (hit < 0 || zb[o] <= hit) continue
          const u = (EYE + sl * hit - z0) / VASE_H
          const px = ox + dx * hit
          const py = oy + dy * hit
          const h = Math.hypot(px, py) || 1e-6
          // the surface's normal: out from the axis, tipped by how the profile slopes
          const slope = (vaseR(Math.min(1, u + 0.01)) - vaseR(Math.max(0, u - 0.01))) / 0.02 / VASE_H
          let nx = px / h
          let ny = py / h
          let nz = -slope
          const nl = Math.hypot(nx, ny, nz)
          nx /= nl; ny /= nl; nz /= nl
          // light from the skylight, high over the middle of the room; a glint where it reflects to the eye
          const lx = (MID_X - vx) * 0.05
          const ly = 0.55
          const lz = 1
          const ll = Math.hypot(lx, ly, lz)
          const diff = Math.max(0, (nx * lx + ny * ly + nz * lz) / ll)
          let hx = lx / ll - dx
          let hy = ly / ll - dy
          let hz = lz / ll - sl
          const hl = Math.hypot(hx, hy, hz)
          const spec = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl) ** 24
          const c = vaseColour(u, Math.atan2(px, py))
          const gold = c === GILT || c === GILT_HI
          const k = (0.42 + 0.68 * diff) * fade
          const g = spec * (gold ? 170 : 120)
          zb[o] = hit
          fb[o] = (255 << 24 | (clamp((c[2] * k + g) * lb, 0, 255) << 16) | (clamp((c[1] * k + g) * lg, 0, 255) << 8) | clamp((c[0] * k + g) * lr, 0, 255)) >>> 0
        }
      }
    }
  }

  return { enter, step, render, me }
}
