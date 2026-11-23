// Enzo's day: a sprite-stack biplane scene, drawn by a small software renderer.
//
// Everything is drawn into one low-resolution pixel buffer, the way the technique works:
//   · the plane is a stack of horizontal slices drawn 1 px apart, turned to any angle
//     (it is still called "the jet" in the code)
//   · the islands and the clouds are stacks too (a height per ground pixel)
// The buffer is then shown scaled up with hard pixels.
//
// Two views share one camera: the overhead sprite-stack view, and a chase view from behind
// the jet. The camera slides between them, so the switch is a single continuous move.

import {
  JET_W, JET_L, JET_H, JET_PALETTE, decodeJet,
  JET_PIVOT_K, JET_PIVOT_Y, JET_SMOKE_A, JET_SMOKE_K, JET_SMOKE_Y, JET_PROP_K, JET_PROP_Y, JET_PROP_R,
  JET_WINGTIP_A, JET_WINGTIP_K, JET_WINGTIP_Y,
} from './jet-model.ts'
import { buildCockpit, drawCockpit } from './cockpit.ts'
import { log } from './log.ts'
import { createMuseumRoom } from './museum-room.ts'

const worldLog = log.child('world')
const footLog = log.child('foot')
const boatLog = log.child('boat')


 




































export const DEFAULT_PARAMS = {
  speed: 74,
  boost: 1.8,
  agility: 1.25,
  altitude: 64,
  ceiling: 300,
  clearance: 7,
  bank: 52,
  spread: 1,
  jetScale: 1,
  cameraFollow: 0.6,
  view: 'top',
  chaseDistance: 2.6,
  chaseAngle: 12,
  chaseSize: 0.19,
  transition: 1.4,
  timeOfDay: 'day',
  clouds: 0.45,
  land: 0.33,
  seed: 7,
  afterburner: 0.8,
  flameStyle: 'pixel',
  trails: true,
  wingmen: 0,
  shadow: true,
  followPointer: true,
  stunts: true,
  intro: true,
  bodyColor: '#3254a0',
  accentColor: '#f6c022',
  canopyColor: '#9ca2ac',
}

// ───────────────────────────────────────────────────────────── constants
const N = 2048 // world size (wraps)
const NM = N - 1
const NSHIFT = 11
const HMAX = 40 // tallest terrain stack, trees and houses included

const NC = 1024 // cloud map size (wraps)
const NCM = NC - 1
const NCSHIFT = 10
const CK = 8 // cloud stack height
const CLOUD_ALT = 40

const PIV_K = JET_PIVOT_K // pivot along the fuselage
const PIV_Y = JET_PIVOT_Y // pivot slice (wing level)
const WINGTIP_A = JET_WINGTIP_A
const WINGTIP_K = JET_WINGTIP_K
const WINGTIP_Y = JET_WINGTIP_Y

const TRAIL_N = 160
const SMOKE_N = 96 // puffs of exhaust smoke kept alive at once
const SMOKE_F = 9 // numbers kept per puff
const BOMB_MAX = 18
const BOOM_N = 180 // sparks and fire from a blast
const BOOM_F = 10 // x y z vx vy vz born life heat size
const BLAST_N = 24 // expanding flash on the ground

const ZTOP = CLOUD_ALT + CK // the tallest thing in the world
const VIEW_DIST = 1500 // how far the chase view sees
const FOG_START = 300
const FOG_STEPS = 10 // shades of haze between here and the horizon
const NSKY = 8 // bands in the sky gradient
const EPS = 1e-5
const HOLD = 0.2 // seconds: shorter is a click (roll), longer is a hold (thrusters)
const COCKPIT_LOOK = 64 // the cockpit view is centred this far ahead of the jet, px
const COCKPIT_EYE = 3 // the pilot's eyes, px above the jet's middle
const FLAME_MAX = 6 // smooth flames: two a jet
const FLAME_F = 16 // numbers kept per smooth flame

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

// ───────────────────────────────────────────────────────────── helpers
const pack = (r, g, b) =>
  ((255 << 24) | (clamp255(b) << 16) | (clamp255(g) << 8) | clamp255(r)) >>> 0
// the light that falls into the cockpit
const SUN_DAY = pack(255, 246, 222)
const SUN_SUNSET = pack(255, 170, 92)
const SUN_NIGHT = pack(150, 190, 255)
function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]

function mulberry32(seed) {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hash8(o) {
  let h = Math.imul(o ^ (o >>> 13), 0x5bd1e995)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  return (h >>> 24) & 255
}
function wrapAngle(a) {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2))
}

export function parseColor(str, fallback) {
  if (!str) return fallback
  let s = String(str).trim()
  if (s[0] === '#') {
    s = s.slice(1)
    if (s.length === 3 || s.length === 4) s = s.split('').map((ch) => ch + ch).join('')
    if (s.length >= 6) {
      const n = parseInt(s.slice(0, 6), 16)
      if (!isNaN(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    }
    return fallback
  }
  const m = s.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const parts = m[1].split(/[ ,/]+/).map(parseFloat)
    if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) return [parts[0], parts[1], parts[2]]
  }
  return fallback
}

/** colour grading per time of day (amount 0..1) */
function grade(c, tod, amount) {
  if (tod === 'day' || amount <= 0) return c
  let r, g, b
  if (tod === 'sunset') {
    r = 0.95 * c[0] + 0.1 * c[1] + 12
    g = 0.72 * c[1] + 0.05 * c[0] + 4
    b = 0.7 * c[2] + 0.08 * c[0] + 10
  } else {
    r = 0.22 * c[0] + 2
    g = 0.3 * c[1] + 6
    b = 0.5 * c[2] + 22
  }
  return [c[0] + (r - c[0]) * amount, c[1] + (g - c[1]) * amount, c[2] + (b - c[2]) * amount]
}

// Day and night. The light runs on a phase from 0 (day) through DUSK (the sunset light) to 1 (night),
// and every colour that changes with it is a mix of its day, sunset and night versions in the weights
// todWeights gives. N moves the phase over DAY_FADE seconds, either way, so dawn is dusk backwards.
const DUSK = 0.45
const DUSK_PEAK = 0.85 // how much of the sunset colours there are at the height of dusk
const DAY_FADE = 9
const TOD_PHASE = { day: 0, sunset: DUSK, night: 1 }
const NIGHT_LOG = log.child('night')
function todWeights(s, out) {
  if (s <= DUSK) {
    out[1] = DUSK_PEAK * (s / DUSK)
    out[0] = 1 - out[1]
    out[2] = 0
  } else {
    const u = (s - DUSK) / (1 - DUSK)
    out[2] = u
    out[1] = DUSK_PEAK * (1 - u)
    out[0] = (1 - DUSK_PEAK) * (1 - u)
  }
  return out
}
// the lamps come on as the dusk deepens, LAMP_ON0 to LAMP_ON1 of the phase, each at its own moment
const LAMP_ON0 = 0.55
const LAMP_ON1 = 0.9
const WIN_LIT = 150 // of 256 villa windows, how many are lit at full night

// tileable value noise, one octave added into `field`
function addOctave(field, n, cell, amp, rnd) {
  const P = n / cell
  const lat = new Float32Array(P * P)
  for (let i = 0; i < lat.length; i++) lat[i] = rnd()
  const x0 = new Int32Array(n)
  const x1 = new Int32Array(n)
  const tx = new Float32Array(n)
  for (let x = 0; x < n; x++) {
    const g = x / cell
    const i = Math.floor(g)
    const f = g - i
    x0[x] = i % P
    x1[x] = (i + 1) % P
    tx[x] = f * f * (3 - 2 * f)
  }
  for (let y = 0; y < n; y++) {
    const ra = x0[y] * P
    const rb = x1[y] * P
    const ty = tx[y]
    const row = y * n
    for (let x = 0; x < n; x++) {
      const a0 = lat[ra + x0[x]]
      const b0 = lat[rb + x0[x]]
      const va = a0 + (lat[ra + x1[x]] - a0) * tx[x]
      const vb = b0 + (lat[rb + x1[x]] - b0) * tx[x]
      field[row + x] += amp * (va + (vb - va) * ty)
    }
  }
}
function normalise(field) {
  let mn = Infinity
  let mx = -Infinity
  for (let i = 0; i < field.length; i++) {
    const v = field[i]
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  const k = 1 / (mx - mn || 1)
  for (let i = 0; i < field.length; i++) field[i] = (field[i] - mn) * k
}

// ───────────────────────────────────────────────────────────── materials
// index: 0 deep · 1 mid · 2 shallow · 3 surf · 4 sand · 5 sand speck · 6 grass · 7 grass dark · 8 grass light
//        9 tree top · 10 tree · 11 tree edge · 12 rock · 13 rock dark · 14 rock light · 15 snow · 16 snow shade
//        17–19 stucco wall: ochre, cream, salmon (the top is the terracotta eave) · 20 roof · 21 roof shaded side
//        22 roof sunny side · 23 rubble · 24 scorch · 25 dock · 26 dock dark · 27 stucco wall, pale yellow
//        28–31 the same four walls with a column of shuttered windows · 32 tower · 33 tower cap · 34 cypress
//        35 balustrade · 36 topiary · 37–39 fir: top, body, edge · 40–42 round-crowned tree: top, body, edge
//        villa gardens: 43 box hedge · 44 stone (fountain rim) · 45 fountain water · 46 plinth and spout
//        47–49 flowers: pink, yellow, white · 50 clipped lawn · 51–52 paving, light and dark
//        houses: 53 white stone wall (the corner pilasters) · 54–55 the stone portal bay of a house of two
//        and three floors · 56–58 only colours on a facade: shutter slats, iron, the door
const MAT_TOP = [
  [36, 104, 180], [44, 124, 198], [66, 160, 216], [104, 204, 214],
  [238, 220, 164], [222, 200, 140],
  [96, 178, 52], [70, 148, 44], [134, 206, 76],
  [70, 158, 64], [42, 122, 54], [28, 92, 46],
  [146, 140, 134], [118, 112, 110], [178, 172, 162],
  [246, 250, 255], [214, 226, 244],
  [178, 86, 58], [178, 86, 58], [178, 86, 58],
  [212, 108, 70], [176, 82, 56], [234, 140, 94],
  [132, 118, 104], [58, 50, 44],
  [196, 154, 96], [154, 112, 66],
  [178, 86, 58],
  [178, 86, 58], [178, 86, 58], [178, 86, 58], [178, 86, 58],
  [238, 236, 228], [212, 208, 200], [44, 92, 54], [238, 234, 224], [112, 178, 74],
  [72, 146, 98], [44, 116, 78], [30, 90, 62],
  [76, 162, 62], [46, 128, 52], [30, 98, 46],
  [52, 118, 58], [178, 174, 166], [118, 186, 214], [206, 204, 198],
  [236, 76, 146], [248, 212, 58], [246, 244, 238], [118, 186, 74],
  [206, 198, 182], [188, 180, 164],
  [178, 86, 58], [178, 86, 58], [178, 86, 58], [36, 70, 50], [46, 46, 52], [100, 62, 40],
  [178, 86, 58], [178, 86, 58],
]
const MAT_SIDE = [
  [36, 104, 180], [44, 124, 198], [66, 160, 216], [104, 204, 214],
  [204, 180, 122], [204, 180, 122],
  [56, 120, 44], [50, 108, 42], [60, 128, 46],
  [24, 78, 42], [22, 72, 40], [20, 64, 38],
  [96, 90, 92], [86, 82, 86], [104, 98, 98],
  [186, 202, 228], [176, 192, 220],
  [228, 186, 108], [238, 224, 190], [224, 158, 120],
  [170, 78, 54], [148, 64, 44], [188, 96, 64],
  [96, 86, 78], [40, 36, 32],
  [148, 108, 64], [112, 78, 46],
  [236, 210, 132],
  [228, 186, 108], [238, 224, 190], [224, 158, 120], [236, 210, 132],
  [232, 228, 218], [180, 176, 168], [30, 72, 42], [214, 208, 196], [72, 136, 52],
  [32, 88, 62], [28, 78, 56], [22, 66, 48],
  [26, 82, 42], [24, 76, 40], [21, 68, 38],
  [34, 84, 44], [138, 134, 128], [88, 146, 170], [160, 158, 152],
  [70, 128, 56], [70, 128, 56], [70, 128, 56], [78, 140, 52],
  [150, 142, 130], [150, 142, 130],
  [236, 230, 214], [228, 186, 108], [238, 224, 190], [36, 70, 50], [46, 46, 52], [100, 62, 40],
  [224, 158, 120], [236, 210, 132],
]
const NMAT = MAT_TOP.length
const WALLS = [17, 18, 19, 27] // stucco colours; the windowed wall of each is WINDOWED[i]
const WINDOWED = [28, 29, 30, 31]
const M_HSTONE = 53 // a house's white stone: corner pilasters, trim
const M_PORTAL = [54, 55, 59, 60] // the bay with the door, in each wall colour (as WALLS)
const M_SLAT = 56
const M_IRON = 57
const M_DOOR = 58
/** walls and roofs: not walkable, a bomb knocks them down to the house's floor */
const isBuilt = (m) => (m >= 17 && m <= 22) || (m >= 27 && m <= 33) || (m >= 53 && m <= 55) || m === 59 || m === 60
const FLOOR_H = 5

// ── facades
// A house's walls are columns of the height map like everything else, so the detail is painted on each
// face as it is drawn, after the palazzi of southern Italy: a white stone cornice with dentils under the
// eaves and a stone band between the floors; on the windowed cells a window with green slatted shutters
// in a stone frame with a little cornice over it; white stone pilasters at the corners; and in the middle
// of one long side an arched door in a stone surround, an iron balcony on a stone slab over it. Some
// houses (all of three floors, and the pink ones) stand on a ground floor of rusticated white stone.
// FACADE says which a wall material is. facadeAt gives a role (F_…), which each renderer turns into a
// colour; gpu-world.ts has the same function in GLSL, and the two must agree. The detail comes in by how
// many pixels a unit is on the screen (mp), so far off a wall does not shimmer or break into stripes:
// past FAC_L1 a floor shows only a band where its windows are, and the stone.
const FACADE = new Uint8Array(64) // kind: 1 plain stucco, 2 stucco with a window, 3 stone pilaster, 4 the door's bay; + 8 rusticated
for (let i = 0; i < 4; i++) {
  const rust = i === 2 ? 8 : 0
  FACADE[WALLS[i]] = 1 | rust
  FACADE[WINDOWED[i]] = 2 | rust
  FACADE[M_PORTAL[i]] = 4 | rust
}
FACADE[M_HSTONE] = 3
// a house's roof (kind 5): its sides show only over the walls; under the eaves, the wall in front of it
const F_ROOF = 5
for (const m of [20, 21, 22]) FACADE[m] = F_ROOF
const FAC_WALK = 12 // how many cells the renderers walk back along a ray to find where it came into a house
const F_WALL = 0
const F_WALL_DK = 1
const F_STONE = 2
const F_STONE_DK = 3
const F_SHUTTER = 4
const F_SLAT = 5
const F_LIT = 6
const F_IRON = 7
const F_DOOR = 8
const F_BAND = 9 // far off: the wall and the shutters together
const FAC_L1 = 2.5 // pixels a unit: from here the cornice, the bands and the windows' shape …
const FAC_L2 = 7 // … the frames, the little cornices, the door's arch, the joints …
const FAC_L3 = 14 // … the slats, the balcony's bars
/**
 * what a house wall shows at a point of its face: fk its FACADE value, dTop how far below the eave, a
 * across the cell (0 to 1), mp pixels a unit, cell the cell's index and on how many windows of 256 are lit
 * (both for the lit ones), floors how many floors the house has (from the ground in front of the wall)
 */
function facadeAt(fk, dTop, a, mp, cell, on, floors) {
  const kind = fk & 7
  const da = Math.abs(a - 0.5)
  const fl = Math.max(0, Math.floor(dTop / FLOOR_H))
  const r = dTop - fl * FLOOR_H
  const ground = fl >= floors - 1 // the ground floor (or the footing under it, where the ground falls away)
  const rust = ground && (fk >= 8 || floors >= 3) // a ground floor of rusticated stone
  const stone = kind === 3 || rust
  const dk = stone ? F_STONE_DK : F_WALL_DK
  const windowed = kind === 2 || (kind === 4 && !ground)
  const lit = windowed && on > 0 && hash8(cell * 4 + fl) < on
  if (mp < FAC_L1) {
    if (stone || fl >= floors) return F_STONE
    if (r >= 1.4 && r < 3.95) return lit ? F_LIT : F_BAND
    return F_WALL
  }
  const l2 = mp >= FAC_L2
  const l3 = mp >= FAC_L3
  // the cornice under the eaves, with dentils, and its shadow on the wall
  if (dTop < 0.45) return l2 && dTop > 0.3 && (a * 5) % 1 < 0.5 ? F_STONE_DK : F_STONE
  if (l2 && dTop < 0.6) return dk
  if (fl >= floors) return F_STONE
  // the door, arched, in a stone surround
  const door = kind === 4 && ground
  if (door) {
    const top = 1.3 + 0.6 * (1 - Math.sqrt(Math.max(0, 1 - (da / 0.38) ** 2)))
    if (da < 0.38 && r >= top) return l3 && da < 0.02 ? F_IRON : F_DOOR
    if (l2 && da < 0.45 && r >= top - 0.2) return rust ? F_STONE_DK : F_STONE
  }
  // a stone band at the foot of each floor: on the ground floor the plinth, darker under rusticated stone
  if (r > FLOOR_H - 0.28) return rust && l2 ? F_STONE_DK : F_STONE
  // rusticated stone, in courses (and so the foot of each pilaster); the pilaster above, with joints
  const courses = l3 && (r / 0.55) % 1 < 0.1 ? F_STONE_DK : F_STONE
  if (kind === 3) return ground ? courses : l2 && (dTop / 0.8) % 1 < 0.08 ? F_STONE_DK : F_STONE
  if (windowed) {
    // a balcony over the door: the railing in front of the window, the slab, its shadow
    if (kind === 4 && fl === floors - 2) {
      if (r >= 3.2 && r < 3.95 && da < 0.47) {
        if (!l3 || r < 3.3 || (a * 9) % 1 < 0.4) return F_IRON
      } else if (r >= 3.95 && r < 4.15 && da < 0.5) return F_STONE
      else if (l2 && r >= 4.15 && r < 4.4 && da < 0.45) return dk
    }
    // the window, most of the cell wide: shutters (or lit, at night), its frame, a little cornice over it
    if (da < 0.4 && r >= 1.4 && r < 3.95) {
      if (lit) return l3 && da < 0.02 ? F_SLAT : F_LIT
      return l3 && (da < 0.02 || (r * 5) % 1 < 0.3) ? F_SLAT : F_SHUTTER
    }
    if (l2 && da < 0.47 && r >= 1.25 && r < 4.1) return rust ? F_STONE_DK : F_STONE
    if (l2 && da < 0.5 && r >= 0.95 && r < 1.25) return rust ? F_STONE_DK : F_STONE
  }
  return rust ? courses : F_WALL
}
/** trees, three kinds: [middle, body, edge] materials. The middle cell is the trunk under the leaves. */
const TREE_KINDS = [[9, 10, 11], [37, 38, 39], [40, 41, 42]] // leafy, fir, round crown
const TREE = new Uint8Array(64) // 1 leaves, 2 trunk
for (const k of TREE_KINDS) { TREE[k[0]] = 2; TREE[k[1]] = 1; TREE[k[2]] = 1 }
const isTree = (m) => TREE[m] !== 0
const isTrunk = (m) => TREE[m] === 2
/** villa garden materials */
const M_HEDGE = 43
const M_STONE = 44
const M_POOL = 45
const M_PLINTH = 46
const M_FLOWERS = [47, 48, 49] // pink, yellow, white
/** flowers drawn as a small bloom in the middle of the cell, not the whole cell: yellow and white */
const BLOOM = new Uint8Array(64)
BLOOM[48] = 1
BLOOM[49] = 1
/** the plane shows flowers only below this height above the ground, in the chase and cockpit views */
const BLOOM_ALT = 16
const M_LAWN = 50
const M_PAVE = [51, 52] // lakeside terraces and promenades
/** green things a blast scorches: grass, trees, cypresses, topiary, hedges, flowers, lawn */
const GREEN = new Uint8Array(64)
for (const m of [6, 7, 8, 34, 36, M_HEDGE, 47, 48, 49, M_LAWN]) GREEN[m] = 1
const isGreen = (m) => GREEN[m] === 1 || isTree(m)
/** a flower: yellow or white, half and half (the pink material is no longer used) */
const flowerAt = (r) => M_FLOWERS[r < 0.5 ? 1 : 2]






















// ───────────────────────────────────────────────────────────── boats
// Three classic yachts of the 1920s, in boat units (across, forward, up; z 0 is the waterline).
// The hull is built once per type and level of detail, as voxels. The rig (masts, booms, sails)
// is built while drawing, because the sails swing out with the wind and are hoisted or furled.
//
// cabin: [aft, fore, height] of the deckhouse · cockpit: [aft, fore] · sprit: bowsprit length
// masts: f position, h top, boom length, and for a gaff sail the throat height and gaff length
// jibs: tack on the bowsprit end or on the stem, head height on the foremost mast
// seat: where the forehatch is, a little forward of the foremast; Enzo comes up through it and
//       sits on the rail beside it when the boat lies still (clear of the shrouds, and of every
//       boom, which all swing aft of their masts)
const YACHTS = [
  // gaff sloop: one mast well forward, a gaff main on a long boom, a jib out to a short bowsprit
  {
    L: 9, B: 2.8, free: 1.1, sheer: 0.34, transom: 0.5, seat: 2.5,
    cabin: [-0.5, 1.9, 0.5], cockpit: [-3.4, -1.1], sprit: 1.6,
    masts: [{ f: 1.6, h: 9.6, boom: 5.6, throat: 6.8, gaff: 3.6, top: false }],
    jibs: [{ sprit: true, head: 8.4 }],
  },
  // ketch: a tall main and a short mizzen, both triangular, and a big jib
  {
    L: 12, B: 3.1, free: 1.2, sheer: 0.4, transom: 0.42, seat: 3.4,
    cabin: [-2.3, 2.9, 0.55], cockpit: [-4.5, -2.7], sprit: 0.9,
    masts: [{ f: 2.3, h: 12.8, boom: 5.0, throat: 0, gaff: 0, top: false }, { f: -3.7, h: 8.4, boom: 2.7, throat: 0, gaff: 0, top: false }],
    jibs: [{ sprit: true, head: 11.4 }],
  },
  // three-masted schooner: gaff sails with topsails over them, two jibs out to a long bowsprit
  {
    L: 15, B: 3.6, free: 1.35, sheer: 0.5, transom: 0.4, seat: 5.0,
    cabin: [-1.7, 1.5, 0.5], cockpit: [-6.2, -4.8], sprit: 3.6,
    masts: [
      { f: 4.1, h: 12.0, boom: 3.2, throat: 8.0, gaff: 2.7, top: true },
      { f: 0.5, h: 12.5, boom: 3.3, throat: 8.3, gaff: 2.9, top: true },
      { f: -3.1, h: 13.0, boom: 4.4, throat: 8.6, gaff: 3.3, top: true },
    ],
    jibs: [{ sprit: true, head: 10.2 }, { sprit: false, head: 8.4 }],
  },
]
// boat materials: each has four shades (shadow, side, top, lit side)
// 0 hull (replaced by the boat's own hull colour) · 1 boot-top · 2 cove stripe · 3 rail · 4 deck · 5 deck seam
// 6 deckhouse · 7 deckhouse roof · 8 window · 9 cockpit · 10 spar · 11 sail · 12 furled sail · 13 rigging
// 14 flag (the boat you are in) · 15 burgee · 16.. hull colours: white, navy, green, varnished, black
const YM_SAIL = 11
const YM_HULL = 16
const YACHT_COL = [
  [236, 234, 228], [124, 38, 34], [200, 154, 66], [146, 94, 54], [210, 176, 122], [184, 148, 98],
  [132, 76, 44], [234, 228, 212], [36, 48, 60], [104, 72, 46], [190, 144, 86], [248, 244, 228],
  [226, 218, 196], [58, 52, 48], [42, 104, 214], [216, 54, 46],
  [240, 238, 232], [36, 54, 92], [34, 78, 62], [158, 104, 60], [40, 40, 46],
  // whale parts above the water: flukes (pale on the underside), the back
  [46, 58, 72], [218, 224, 226], [40, 52, 66],
  // the man: skin, shirt, shirt stripe, trousers, shoes and belt, hair, straw hat, hat band
  [226, 172, 132], [240, 238, 230], [38, 58, 112], [46, 54, 80], [104, 66, 40], [164, 116, 70],
  [232, 200, 120], [44, 40, 52],
  // garden statues (grey marble), fountain spray, benches (dark brown slats, dark iron), yellow flowers and leaves in the urns
  [196, 194, 188], [224, 240, 250], [88, 56, 34], [44, 46, 52], [248, 208, 60], [62, 122, 56],
  // gulls: white, grey wings, black wing tips, yellow bill
  [244, 244, 240], [168, 176, 186], [36, 36, 42], [238, 188, 60],
  // the chapel: travertine, brick, the lead of the dome, the gilt ball and cross
  [228, 220, 200], [184, 110, 70], [146, 154, 164], [222, 184, 84],
  // the garden temple: knapped flint, dark and pale, limestone, the ochre plaster of the niche's vault
  [92, 96, 104], [152, 154, 152], [206, 196, 172], [206, 150, 100],
  // the museum: cream stucco, the darker joints of its rusticated ground floor, the sculpted frieze, its red banners
  [240, 228, 200], [206, 190, 158], [218, 188, 136], [172, 44, 50],
  // lamps: the glass of an unlit lantern; then a lit lantern, the same in every shade and kept from
  // the night's grading. Lamps stay last: k >= YM_LAMP is what makes a material a lamp.
  [196, 206, 200], [255, 208, 128],
]
const YM_FLUKE = 21
const YM_WHALE = 23
const YM_SKIN = 24
const YM_SHIRT = 25
const YM_STRIPE = 26
const YM_TROUSERS = 27
const YM_SHOE = 28
const YM_HAIR = 29
const YM_STRAW = 30
const YM_BAND = 31
const YM_MARBLE = 32
const YM_SPRAY = 33
const YM_WOOD = 34
const YM_IRON = 35
const YM_BLOOM = 36
const YM_LEAF = 37
const YM_GULL = 38
const YM_GULL_WING = 39
const YM_WING_TIP = 40
const YM_BILL = 41
const YM_TRAV = 42
const YM_BRICK = 43
const YM_LEAD = 44
const YM_GOLD = 45
const YM_FLINT = 46
const YM_FLINT2 = 47
const YM_LIME = 48
const YM_OCHRE = 49
const YM_CREAM = 50
const YM_JOINT = 51
const YM_RELIEF = 52
const YM_BANNER = 53
const YM_GLASS = 54
const YM_LAMP = 55
const YM_WINDOW = 8 // a boat's deckhouse windows and its open hatch: lit from inside at night
// the glow round each kind of lamp (packed like the frame: 0xAABBGGRR)
const LAMP_WARM_GLOW = 0xff3c96ff // 255, 150, 60
const FOUNTAIN_GLOW = 0xffffbe64 // 100, 190, 255
const NYM = YACHT_COL.length
// fish and whales
// 0 whale back · 1 flank · 2 lit · 3 scars · 4 flippers · 5 dark (rim, blowholes) · 6 spray
// 7–9 mackerel back, bars, flank · 10–12 yellowtail back, stripe, flank · 13–15 snapper back, flank, fins · 16 eye
const LIFE_COL = [
  [40, 52, 66], [62, 76, 90], [104, 122, 136], [128, 142, 150], [212, 226, 230], [22, 28, 38], [238, 246, 250],
  [30, 66, 86], [14, 34, 50], [168, 196, 206],
  [44, 88, 94], [236, 204, 72], [178, 200, 196],
  [198, 80, 58], [240, 156, 116], [224, 106, 76],
  [16, 18, 24],
]
const HULL_PICK = [0, 0, 0, 0, 1, 1, 2, 2, 3, 4] // white most often

function yachtDeck(y, f) {
  const t = f / (y.L / 2)
  return y.free + y.sheer * t * t * (t > 0 ? 1 : 0.55)
}
/** first person aboard: the eye sits at the forward end of the cockpit, this high over the deck */
const yachtEyeF = (y) => y.cockpit[1] - 0.3
const YACHT_EYE = 2.4
const BOAT_LOOK = 4
// walking in first person: how far ahead of the eyes the camera point is (1 / vQ), the focal length as a
// part of the frame's longer side, where the horizon sits (a part of the height down from the top), and
// how near the eyes a voxel may come before it is left out
const WALK_LOOK = 4
const WALK_FOCAL = 0.8
const WALK_HORIZON = 0.3
const WALK_NEAR = 0.8
/** the aerial view aboard: a fixed diagonal, and the look-down (height : depth on screen is 1 : vTan, so tan of the angle) */
const BOAT_ISO_YAW = Math.PI / 4
const BOAT_ISO_TAN = 0.62
/** there, clouds open (and a plane turns to a ghost) within this many units of the boat's middle, BOAT_ISO_MID up */
const BOAT_ISO_HOLE = 27
const BOAT_ISO_MID = 5.5
/** walking, seen from above: the clouds open within this many units of the man's middle, WALK_MID up */
const WALK_HOLE = 8
const WALK_MID = 2
/** half the beam at f and height z, or -1 outside the hull (the waterline is shorter and narrower than the deck) */
function yachtHalf(y, f, z) {
  const half = y.L / 2
  const deck = yachtDeck(y, f)
  if (z < 0 || z > deck) return -1
  const h = z / deck
  const t = f / half
  const fore = 0.84 + 0.16 * Math.pow(h, 1.3)
  const aft = 0.74 + 0.26 * Math.pow(h, 1.3)
  if (t > fore || t < -aft) return -1
  let w
  if (t >= 0) {
    const u = t / fore
    w = Math.pow(Math.max(0, 1 - Math.pow(u, 2.2)), 0.55)
  } else {
    const u = -t / aft
    // a counter stern ending in a small transom, which only shows near the deck
    w = Math.max(y.transom * clamp((h - 0.35) / 0.5, 0, 1), Math.sqrt(Math.max(0, 1 - Math.pow(u, 2.8))))
  }
  return (y.B / 2) * w * (0.62 + 0.38 * Math.pow(h, 0.6))
}

/** the hull, deck and deckhouse as voxels of size g */
function buildYacht(y, g) {
  const A = []
  const F = []
  const Z = []
  const NA = []
  const NF = []
  const NZ = []
  const K = []
  const add = (a, f, z, k, na, nf, nz) => {
    const l = Math.sqrt(na * na + nf * nf + nz * nz) || 1
    A.push(a); F.push(f); Z.push(z); K.push(k); NA.push(na / l); NF.push(nf / l); NZ.push(nz / l)
  }
  const half = y.L / 2
  const [ck0, ck1] = y.cockpit
  const [cb0, cb1, cbH] = y.cabin
  const top = (a, f) => {
    // the deck, with the cockpit sunk into it
    const d = yachtDeck(y, f)
    return f > ck0 && f < ck1 && Math.abs(a) < yachtHalf(y, f, d) * 0.56 ? d - 0.5 : d
  }
  const inside = (a, f, z) => {
    if (z < 0) return true
    if (z > top(a, f)) return false
    const w = yachtHalf(y, f, z)
    return w >= 0 && Math.abs(a) <= w
  }
  const fine = g < 0.4
  const nA = Math.ceil(y.B / g) + 2
  const nF = Math.ceil(y.L / g) + 2
  for (let i = 0; i < nF; i++) {
    const f = -half - g + (i + 0.5) * g
    const deck = yachtDeck(y, f)
    for (let j = 0; j < nA; j++) {
      const a = -y.B / 2 - g + (j + 0.5) * g
      for (let z = g / 2; z <= deck + g; z += g) {
        if (!inside(a, f, z)) continue
        const na = (inside(a - g, f, z) ? 1 : 0) - (inside(a + g, f, z) ? 1 : 0)
        const nf = (inside(a, f - g, z) ? 1 : 0) - (inside(a, f + g, z) ? 1 : 0)
        const up = !inside(a, f, z + g)
        if (!up && na === 0 && nf === 0) continue
        const wHere = yachtHalf(y, f, Math.min(z, deck))
        const outer = Math.abs(a) > wHere - g * 1.6 || !inside(a, f + g * 2, z) || !inside(a, f - g * 2, z)
        let k
        if (up) {
          const tz = top(a, f)
          const hA = Math.abs(a)
          const hF = Math.abs(f - y.seat)
          if (tz < deck - 0.1) k = 9
          else if (hA < 0.35 && hF < 0.35) k = hA < 0.2 && hF < 0.2 ? 8 : 3 // the forehatch, open: dark, in a varnished frame
          else if (outer) k = 3
          else k = fine && (Math.floor((a + 8) / 0.5) & 1) ? 5 : 4
          add(a, f, z, k, na * 0.3, nf * 0.3, 1)
          // a low varnished toe-rail along the edge of the deck
          if (fine && outer && tz >= deck - 0.1) add(a, f, z + g, 3, na, nf, 1)
        } else {
          if (!outer) k = 6
          else if (z < 0.32) k = 1
          else if (fine && z > deck - 0.4 && z < deck - 0.22) k = 2
          else k = 0
          add(a, f, z, k, na, nf, 0.15)
        }
      }
    }
  }
  // the deckhouse: varnished sides with portlights, a pale roof
  for (let f = cb0 + g / 2; f < cb1; f += g) {
    const deck = yachtDeck(y, f)
    const nose = clamp((cb1 - f) / 0.7, 0.35, 1)
    const w = yachtHalf(y, f, deck) * 0.58 * Math.sqrt(nose)
    for (let a = -w + g / 2; a < w; a += g) {
      const edge = Math.abs(a) > w - g || f < cb0 + g || f > cb1 - g
      for (let z = deck + g / 2; z < deck + cbH; z += g) {
        const roof = z + g >= deck + cbH
        if (!roof && !edge) continue
        if (roof) { add(a, f, z, 7, 0, 0, 1); continue }
        const port = fine && Math.abs(z - deck - cbH * 0.5) < g * 0.8 && (Math.floor((f - cb0) / 0.75) & 1) === 1
        add(a, f, z, port ? 8 : 6, Math.abs(a) > w - g ? Math.sign(a) : 0, f > cb1 - g ? 1 : f < cb0 + g ? -1 : 0, 0)
      }
    }
  }
  // bowsprit, rising a little
  const bowZ = yachtDeck(y, half) - 0.1
  for (let s = 0; s < y.sprit; s += g) add(0, half * 0.94 + s, bowZ + s * 0.12, 10, 0, 0, 0)
  const n = A.length
  return {
    n, g,
    A: Float32Array.from(A), F: Float32Array.from(F), Z: Float32Array.from(Z),
    NA: Float32Array.from(NA), NF: Float32Array.from(NF), NZ: Float32Array.from(NZ),
    K: Uint8Array.from(K),
  }
}
const BAYER4 = Uint8Array.from([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5])
const YACHT_LOD = [0.5, 0.25, 0.125, 0.0625] // the last only for the boat you sit in, seen from on board
const yachtModels = YACHTS.map(() => [null, null, null, null])
function yachtModel(kind, lod) {
  const row = yachtModels[kind]
  if (!row[lod]) row[lod] = buildYacht(YACHTS[kind], YACHT_LOD[lod])
  return row[lod]
}
/** kind: 0 sloop, 1 ketch, 2 schooner · hull: colour 0–4 · sail: 0 furled … 1 hoisted · boom: signed angle, + to starboard */
function makeBoat(x, y, yaw, kind, hull, moored, speed, phase) {
  return {
    x, y, yaw, kind, hull, speed, phase, turn: 0, moored,
    v: 0, sail: moored ? 0 : 1, boom: 0, heel: 0,
    // intent 0 keeps sailing, 1 ties up at a dock and stays, 2 drops sail off a shore and stays
    intent: 0, berth: -1, avoid: 0, avoidT: 0, leg: 0, seek: 0, stuck: 0,
  }
}

// The man, in the same units as the boats (across, forward, up), as voxels of PERSON_G with
// normals, drawn by the boat rasterizer. About 5.5 tall: straw boater, striped shirt, navy
// trousers. Each voxel has a part: 0 body · 1 left leg · 2 right leg · 3 left arm · 4 right arm.
// Legs swing about the hip, arms about the shoulder.
const PERSON_G = 0.25
const PERSON_HIP = 2
const PERSON_KNEE = 1
const PERSON_SHOULDER = 3.6
// Enzo out on the deck of the boat you are in (drawEnzoOut): the same model at one size on every
// boat, about 2.9 tall, a touch over life size against the hulls so he shows from the air
const LOUNGE_SCALE = 0.52
const LOUNGE_WAIT = 15 // seconds lying still, with no key down, before he comes up
const LOUNGE_RISE = 1 // up the ladder and out of the forehatch
const LOUNGE_WALK = 0.8 // out to the rail
const LOUNGE_SIT = 0.9 // down onto it, legs over the side
const LOUNGE_END = LOUNGE_RISE + LOUNGE_WALK + LOUNGE_SIT
const LOUNGE_BACK = 1.6 // going back in plays this much faster
const PERSON = (() => {
  const g = PERSON_G
  const A = [], F = [], Z = [], NA = [], NF = [], NZ = [], K = [], P = []
  // a box, surface voxels only. col(i, j, k) picks the material (i across, j forward, k up).
  // A box one voxel thick on an axis faces the `hint` side on it (0 for neither).
  const box = (a0, a1, f0, f1, z0, z1, part, col, hint = [0, 0, 0], skip = null) => {
    const na = Math.max(1, Math.round((a1 - a0) / g))
    const nf = Math.max(1, Math.round((f1 - f0) / g))
    const nz = Math.max(1, Math.round((z1 - z0) / g))
    const side = (i, n, h) => (n === 1 ? h : i === 0 ? -1 : i === n - 1 ? 1 : 0)
    for (let i = 0; i < na; i++) {
      for (let j = 0; j < nf; j++) {
        for (let k = 0; k < nz; k++) {
          const inside = na > 1 && nf > 1 && nz > 1 && i > 0 && i < na - 1 && j > 0 && j < nf - 1 && k > 0 && k < nz - 1
          if (inside || (skip && skip(i, j, k, na, nf))) continue
          let sa = side(i, na, hint[0])
          let sf = side(j, nf, hint[1])
          let sz = side(k, nz, hint[2])
          const l = Math.hypot(sa, sf, sz) || 1
          A.push(a0 + (i + 0.5) * g); F.push(f0 + (j + 0.5) * g); Z.push(z0 + (k + 0.5) * g)
          NA.push(sa / l); NF.push(sf / l); NZ.push(sz / l)
          K.push(col(i, j, k, na, nf, nz)); P.push(part)
        }
      }
    }
  }
  const one = (m) => () => m
  // the shirt: navy stripes on white, every other row, plain at the shoulders
  const stripes = (z0) => (i, j, k) => {
    const row = Math.round((z0 + k * g - 2) / g)
    return row > 0 && row < 6 && row % 2 === 0 ? YM_STRIPE : YM_SHIRT
  }
  for (const [s, part] of [[-1, 1], [1, 2]]) {
    const a0 = s < 0 ? -0.625 : 0.125
    box(a0, a0 + 0.5, -0.25, 0.5, 0, 0.25, part, one(YM_SHOE)) // shoe, the toe forward
    box(a0, a0 + 0.5, -0.25, 0.25, 0.25, 2, part, one(YM_TROUSERS)) // leg
  }
  box(-0.125, 0.125, -0.25, 0.25, 1.5, 2, 0, one(YM_TROUSERS)) // between the legs
  box(-0.625, 0.625, -0.375, 0.375, 2, 2.25, 0, one(YM_SHOE)) // belt
  box(-0.625, 0.625, -0.375, 0.375, 2.25, 3.75, 0, stripes(2.25)) // chest and back
  for (const [s, part] of [[-1, 3], [1, 4]]) {
    const a0 = s < 0 ? -0.875 : 0.625
    box(a0, a0 + 0.25, -0.25, 0.25, 2, 3.75, part, stripes(2), [s, 0, 0]) // sleeve
    box(a0, a0 + 0.25, -0.25, 0.25, 1.75, 2, part, one(YM_SKIN), [s, 0, 0]) // hand
  }
  box(-0.125, 0.125, -0.125, 0.125, 3.75, 4, 0, one(YM_SKIN)) // neck
  // the head: hair at the back and sides, eyes on the face
  box(-0.375, 0.375, -0.375, 0.375, 4, 4.75, 0, (i, j, k, na, nf) => {
    if (j === nf - 1) return k === 1 && i !== 1 ? YM_BAND : YM_SKIN
    if (j === 0 || k === 2 || ((i === 0 || i === na - 1) && k >= 1)) return YM_HAIR
    return YM_SKIN
  })
  // the boater: a round brim, a crown with a dark band
  box(-0.625, 0.625, -0.625, 0.625, 4.75, 5, 0, one(YM_STRAW), [0, 0, 1],
    (i, j, k, na, nf) => (i === 0 || i === na - 1) && (j === 0 || j === nf - 1))
  box(-0.375, 0.375, -0.375, 0.375, 5, 5.5, 0, (i, j, k) => (k === 0 ? YM_BAND : YM_STRAW))
  return {
    n: A.length,
    A: Float32Array.from(A), F: Float32Array.from(F), Z: Float32Array.from(Z),
    NA: Float32Array.from(NA), NF: Float32Array.from(NF), NZ: Float32Array.from(NZ),
    K: Uint8Array.from(K), P: Uint8Array.from(P),
  }
})()

// Garden props, drawn like the boats: surface voxels of PROP_G with normals. Kinds:
// 0, 1 marble statues in a long robe, 3 to 3.4 tall, so on a plinth one high the head stays under a
//      villa's eaves: an orator with the right arm raised, and a figure holding a staff
// 2    a park bench, dark brown slats on a dark iron frame, 2.8 long; the sitter faces forward
// 3    a marble urn of yellow flowers, for the top of a post
const PROP_G = 0.2
const P_BENCH = 2
const P_URN = 3
function propModel(build, g = PROP_G) {
  const A = [], F = [], Z = [], NA = [], NF = [], NZ = [], K = [], P = []
  // a box, surface voxels only; col is a material, or col(i, j, k) picks one (i across, j forward, k up).
  // part tags the voxels (a bird's wings). A box one voxel thick is a plate, and faces up.
  const box = (a0, a1, f0, f1, z0, z1, col, part = 0) => {
    const na = Math.max(1, Math.round((a1 - a0) / g))
    const nf = Math.max(1, Math.round((f1 - f0) / g))
    const nz = Math.max(1, Math.round((z1 - z0) / g))
    const side = (i, n) => (n === 1 ? 0 : i === 0 ? -1 : i === n - 1 ? 1 : 0)
    for (let i = 0; i < na; i++) {
      for (let j = 0; j < nf; j++) {
        for (let k = 0; k < nz; k++) {
          const sa = side(i, na)
          const sf = side(j, nf)
          const sz = nz === 1 ? 1 : side(k, nz)
          if (sa === 0 && sf === 0 && sz === 0 && na > 1 && nf > 1 && nz > 1) continue
          const l = Math.hypot(sa, sf, sz) || 1
          A.push(a0 + (i + 0.5) * g); F.push(f0 + (j + 0.5) * g); Z.push(z0 + (k + 0.5) * g)
          NA.push(sa / l); NF.push(sf / l); NZ.push(sz / l)
          K.push(typeof col === 'function' ? col(i, j, k) : col)
          P.push(part)
        }
      }
    }
  }
  build(box)
  return {
    n: A.length,
    A: Float32Array.from(A), F: Float32Array.from(F), Z: Float32Array.from(Z),
    NA: Float32Array.from(NA), NF: Float32Array.from(NF), NZ: Float32Array.from(NZ),
    K: Uint8Array.from(K), P: Uint8Array.from(P),
  }
}
const statueModel = (pose) => propModel((box) => {
  const m = YM_MARBLE
  box(-0.5, 0.5, -0.4, 0.4, 0, 0.4, m) // the hem of the robe
  box(-0.4, 0.4, -0.2, 0.4, 0.4, 1.6, m) // the robe, falling in front
  box(-0.4, 0.4, -0.2, 0.2, 1.6, 2.6, m) // chest and shoulders
  box(-0.2, 0.2, -0.2, 0.2, 2.6, 3.0, m) // the head
  box(-0.6, -0.4, -0.1, 0.1, 1.4, 2.6, m) // the left arm, hanging
  if (pose === 0) box(0.4, 0.6, 0, 0.2, 2.2, 3.4, m) // the right arm, raised
  else {
    box(0.4, 0.6, -0.1, 0.1, 1.6, 2.6, m) // the right arm
    box(0.6, 0.8, 0.0, 0.2, 0, 3.4, m) // the staff
  }
})
const PROPS = [
  statueModel(0),
  statueModel(1),
  propModel((box) => {
    box(-1.2, 1.2, -0.4, 0.4, 1.0, 1.2, YM_WOOD) // the seat
    box(-1.2, 1.2, -0.6, -0.4, 1.2, 2.2, YM_WOOD) // the back
    for (const a0 of [-1.4, 1.2]) {
      box(a0, a0 + 0.2, -0.6, 0.4, 0, 1.0, YM_IRON) // the end frame
      box(a0, a0 + 0.2, 0.2, 0.4, 1.0, 1.4, YM_IRON) // the arm's upright
      box(a0, a0 + 0.2, -0.6, 0.4, 1.4, 1.6, YM_IRON) // the arm
    }
  }),
  propModel((box) => {
    box(-0.2, 0.2, -0.2, 0.2, 0, 0.2, YM_MARBLE) // the foot
    box(-0.4, 0.4, -0.4, 0.4, 0.2, 0.8, YM_MARBLE) // the bowl
    box(-0.6, 0.6, -0.6, 0.6, 0.8, 1.0, YM_MARBLE) // the lip
    box(-0.4, 0.4, -0.4, 0.4, 1.0, 1.4, (i, j, k) => ((i * 3 + j * 5 + k * 7) % 3 === 0 ? YM_LEAF : YM_BLOOM))
  }),
  lampModel(false),
]
// 4: a garden lamp, a slim iron post with a glass lantern on top, 4.2 tall; LAMP_LIT is the same lamp lit
const P_LAMP = 4
const LAMP_TOP = 3.7 // the middle of the lantern
const LAMP_LIT = lampModel(true)
function lampModel(lit) {
  return propModel((box) => {
    box(-0.2, 0.2, -0.2, 0.2, 0, 0.4, YM_IRON) // the foot
    box(-0.1, 0.1, -0.1, 0.1, 0.4, 3.4, YM_IRON) // the post
    // the lantern: glass panes between iron corners
    box(-0.3, 0.3, -0.3, 0.3, 3.4, 4.0, (i, j) => (i !== 1 && j !== 1 ? YM_IRON : lit ? YM_LAMP : YM_GLASS))
    box(-0.4, 0.4, -0.4, 0.4, 4.0, 4.2, YM_IRON) // its cap
  })
}

// ── The chapel: one on the map, a small domed church in the Roman manner. A square block of brick
// panels between travertine pilasters, arched windows and niches, a porch of two columns under a
// pediment at the door, a cornice and a parapet; on it an octagonal drum with a window in each face;
// then a ribbed lead dome with eight round dormer windows, and a lantern of eight columns with a small
// cupola, a gilt ball and a cross. About 21 tall. It is drawn as voxels, like the boats, from
// chapelAt(a, f, z): across, forward (the door is at +f) and up from its floor, in map units.
const CH_TOP = 21.2
const CH_BACK = 5.8 // the block's footprint: ±CH_BACK across and behind …
const CH_STEPS = 7.0 // … and forward to the bottom step
const CH_FORE = 11.5 // the paved square in front reaches this far forward
const OCT_C = Array.from({ length: 8 }, (_, k) => Math.cos((k * Math.PI) / 4))
const OCT_S = Array.from({ length: 8 }, (_, k) => Math.sin((k * Math.PI) / 4))
let octD = 0 // octFace: how far out the point is towards its face …
let octU = 0 // … and where along that face
function octFace(a, f) {
  octD = -1e9
  for (let k = 0; k < 8; k++) {
    const d = a * OCT_C[k] + f * OCT_S[k]
    if (d > octD) {
      octD = d
      octU = -a * OCT_S[k] + f * OCT_C[k]
    }
  }
}
// angle from the nearest of eight directions spaced 45° apart, starting at `start`
const near8 = (th, start) => {
  const s = Math.PI / 4
  const t = th - start
  return Math.abs(t - s * Math.round(t / s))
}
function chapelAt(a, f, z) {
  const A = Math.abs(a)
  const F = Math.abs(f)
  // the plinth, and the steps up to the door
  if (z < 0.5) {
    if (A <= 5.75 && F <= 5.75) return YM_TRAV
    if (A <= 2.4 && f > 0 && (f <= 6.4 || (f <= CH_STEPS && z < 0.25))) return YM_TRAV
    return 0
  }
  if (z < 6.4) {
    // the porch: two columns, their entablature and the pediment over the door
    if (f > 5.25 && A <= 2.4) {
      if (z < 4.3) {
        const dc = Math.hypot(A - 1.6, f - 5.85)
        if (dc <= 0.34) return YM_TRAV
      } else if (f <= 6.35) {
        if (z < 4.8 && A <= 2.3) return YM_TRAV
        if (z >= 4.8 && A <= 2.3 - (z - 4.8) * 1.7) return YM_TRAV
      }
    }
    // the walls: which face, how far out and where along it
    const side = A >= F
    const out = side ? A : F
    const u = side ? f : a
    const U = Math.abs(u)
    const front = !side && f > 0
    if (A > 5.25 && F > 5.25) return A <= 5.5 && F <= 5.5 ? YM_TRAV : 0 // the corner pilasters
    const pilaster = U >= 4.4 || (U >= 1.75 && U <= 2.45)
    if (out > 5.25) return pilaster && out <= 5.5 ? YM_TRAV : 0
    // windows, the door and the niches are let into the wall
    let recess = 0
    if (U < 1.0) {
      if (front) recess = z < 3.5 && U < 0.85 ? YM_WOOD : z > 3.9 && z < 5.6 && U < 0.7 ? YM_WINDOW : 0
      else if (U < 0.85 && ((z > 2.2 && z < 4.6) || (z >= 4.6 && (z - 4.6) ** 2 + u * u < 0.72))) recess = YM_WINDOW
    } else if (U > 2.45 && U < 4.4) {
      const du = U - 3.42
      if (Math.abs(du) < 0.45 && z > 4.4 && z < 5.6) recess = YM_WINDOW
      else if (Math.abs(du) < 0.55 && ((z > 1.4 && z < 3.2) || (z >= 3.2 && (z - 3.2) ** 2 + du * du < 0.3))) recess = YM_TRAV
    }
    if (recess) return out > 5.0 ? 0 : recess
    if (z < 1.0 || pilaster || (z > 3.9 && z < 4.2)) return YM_TRAV
    return YM_BRICK
  }
  if (z < 7.0) {
    // the cornice, and the roof inside it
    const r = z < 6.6 ? 5.55 : 5.75
    if (A > r || F > r) return 0
    return z > 6.75 && A < 5.2 && F < 5.2 ? YM_LEAD : YM_TRAV
  }
  // a parapet round the roof, with a little obelisk at each corner
  if (z < 8.1 && (A > 5.0 || F > 5.0)) {
    if (A > 5.55 || F > 5.55) return 0
    if (A > 4.95 && F > 4.95) return z < 8.1 - Math.max(A - 4.95, F - 4.95) * 1.2 ? YM_TRAV : 0
    return z < 7.5 && (A > 5.25 || F > 5.25) ? YM_TRAV : 0
  }
  if (z < 11.0) {
    // the octagonal drum: brick between pilasters at the corners, a window in each face
    octFace(a, f)
    const U = Math.abs(octU)
    if (octD > 4.6 || (octD > 4.4 && U < 1.35)) return 0
    if (U < 0.55 && z > 8.0 && z < 9.9) return octD > 4.15 ? 0 : YM_WINDOW
    if (U < 0.8 && z > 10.0 && z < 10.3) return YM_TRAV // the hood over the window
    if (octD > 4.4) return YM_TRAV
    return U >= 1.35 || z < 7.5 ? YM_TRAV : YM_BRICK
  }
  if (z < 11.5) {
    octFace(a, f)
    return octD <= 4.75 ? YM_TRAV : 0 // the drum's cornice
  }
  const r = Math.hypot(a, f)
  const th = Math.atan2(f, a)
  if (z < 16.1) {
    // the dormers: eight round windows framed in stone, between the ribs, low on the dome
    if (z < 13.4) {
      for (let k = 0; k < 8; k++) {
        const rho = a * OCT_C[k] + f * OCT_S[k]
        const tau = -a * OCT_S[k] + f * OCT_C[k]
        if (rho > 2 && rho <= 4.42 && Math.abs(tau) < 0.62) {
          if (z > 13.0 && Math.abs(tau) > 0.62 - (z - 13.0) * 1.6) break // a rounded top
          return rho > 4.12 && tau * tau + (z - 12.55) ** 2 < 0.16 ? YM_WINDOW : YM_TRAV
        }
      }
    }
  }
  // the dome: lead between eight raised ribs of stone
  const rib = r * near8(th, Math.PI / 8) < 0.28
  const rd = 4.3 + (rib ? 0.14 : 0)
  if (r < rd && z <= 11.5 + 4.6 * Math.sqrt(1 - (r / rd) ** 2)) return rib ? YM_TRAV : YM_LEAD
  // the lantern: eight columns round a dark middle, under a little cupola, a gilt ball and a cross
  if (z >= 15.7 && z < 18.0) {
    if (r > 1.15) return 0
    if (z < 16.1 || z > 17.5) return YM_TRAV
    if (r > 0.85) return r * near8(th, 0) < 0.2 ? YM_TRAV : 0
    return YM_WINDOW
  }
  if (z >= 18.0 && z < 18.3) return r <= 1.35 ? YM_TRAV : 0
  if (z >= 18.3 && z < 19.2) return r <= 1.15 * Math.sqrt(1 - ((z - 18.3) / 0.9) ** 2) ? YM_LEAD : 0
  if (a * a + f * f + (z - 19.5) ** 2 <= 0.11) return YM_GOLD
  if (F <= 0.13 && ((A <= 0.13 && z >= 19.8 && z <= 21.0) || (A <= 0.42 && z >= 20.4 && z <= 20.65))) return YM_GOLD
  return 0
}
// ── The garden temple: one on the map, a folly of knapped flint dressed in limestone. A wall with a tall
// round-arched niche, and in it a marble statue on a pedestal; the vault of the niche plastered ochre.
// Two pairs of columns on high plinths stand before the wall and carry an entablature that breaks forward
// over them; over that an attic with an inscribed panel in the middle and four dies, one over each column,
// with round caps. About 11 tall and 10 across, and shallow: from 1.7 behind its middle to 2 in front.
// templeAt(a, f, z) as chapelAt: across, forward (the niche opens to +f), up.
const TP_TOP = 11.2
const TP_WALL = 0.5 // the front face of the wall
const TP_NICHE = -1.0 // the back of the niche
const TP_ARCH = 1.75 // the niche's half width, and the radius of its arch …
const TP_SPRING = 4.7 // … which springs from this height
const TP_COLS = [-4.0, -2.95, 2.95, 4.0] // the columns, across
const TP_COL_F = 1.25 // and forward
// the speckle of the flint, in squares of a quarter, so every level of detail shows the same stones
function flintAt(a, f, z) {
  return speck(a, f, z, 4) < 3 ? YM_FLINT2 : YM_FLINT
}
/** a hash, 0–7, of the cube of side 1/s the point is in */
function speck(a, f, z, s) {
  let h = Math.imul(Math.floor(a * s), 0x27d4eb2d) ^ Math.imul(Math.floor(f * s), 0x165667b1) ^ Math.imul(Math.floor(z * s), 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return h & 7
}
/** the statue in the niche: a young man standing, his cloak over the left arm; h up from his feet, d forward */
function templeStatue(a, h, d) {
  const seg = (a0, d0, h0, a1, d1, h1, r) => {
    const ua = a1 - a0, ud = d1 - d0, uh = h1 - h0
    const t = clamp(((a - a0) * ua + (d - d0) * ud + (h - h0) * uh) / (ua * ua + ud * ud + uh * uh), 0, 1)
    return (a - a0 - ua * t) ** 2 + (d - d0 - ud * t) ** 2 + (h - h0 - uh * t) ** 2 <= r * r
  }
  if (h < 0.12) return Math.abs(a) <= 0.42 && Math.abs(d) <= 0.32
  if (h < 1.45) {
    // the legs, the right one bearing his weight, the left a little forward and bent
    if (seg(0.15, 0, 0.12, 0.13, 0, 1.45, 0.14) || seg(-0.17, 0.12, 0.12, -0.14, 0.02, 1.45, 0.13)) return true
  }
  if (h >= 1.3 && h < 2.42) {
    const w = h > 2.15 ? 0.43 : 0.34 // the shoulders are broader than the waist
    if ((a / w) ** 2 + (d / 0.2) ** 2 <= 1) return true
  }
  if (h >= 2.42 && h < 2.55) return a * a + d * d <= 0.09 ** 2 // the neck
  if (a * a + d * d + (h - 2.7) ** 2 <= 0.17 ** 2) return true // the head
  if (seg(0.42, 0, 2.28, 0.5, 0.03, 1.35, 0.08)) return true // the right arm, hanging
  if (seg(-0.42, 0, 2.28, -0.6, 0.32, 1.8, 0.08)) return true // the left arm, held out
  // the cloak, falling from the left forearm
  return a >= -0.8 && a <= -0.5 && d >= -0.05 && d <= 0.36 && h >= 0.85 && h <= 1.95 - (a + 0.8) * 0.4
}
function templeAt(a, f, z) {
  const A = Math.abs(a)
  if (A > 5.05 || f < -1.75 || f > 2.05 || z > TP_TOP) return 0
  // the pedestal and its statue, standing in the niche
  const pd = f + 0.3
  if (A <= 0.62 && Math.abs(pd) <= 0.57 && z < 1.45) {
    if (z < 0.25 || z >= 1.25) return YM_LIME
    return A <= 0.5 && Math.abs(pd) <= 0.45 ? YM_LIME : 0
  }
  if (z >= 1.45 && z < 4.5 && A < 0.9 && Math.abs(pd) < 0.45) return templeStatue(a, z - 1.45, pd) ? YM_MARBLE : 0
  // the columns: a moulded base, the shaft, the capital and its square abacus
  if (f > TP_WALL && z >= 1.35 && z < 6.9) {
    for (const ac of TP_COLS) {
      const r = Math.hypot(a - ac, f - TP_COL_F)
      if (z < 1.6 ? r <= 0.55 : z < 6.45 ? r <= 0.42 - (z - 1.6) * 0.012 : z < 6.7 ? r <= 0.48 : Math.max(Math.abs(a - ac), Math.abs(f - TP_COL_F)) <= 0.55) return YM_LIME
    }
  }
  const pair = A >= 2.35 && A <= 4.65 // over and under each pair of columns
  // the high plinths the columns stand on, and the base course of the wall between them
  if (z < 1.35 && pair && f <= 1.85) return z > 1.15 && f > 1.75 ? 0 : YM_LIME
  if (z < 0.9 && f <= TP_WALL + 0.15 && A <= 5.0) {
    if (A < TP_ARCH && f > TP_NICHE) return z < 0.2 ? YM_LIME : 0 // the floor of the niche
    return YM_LIME
  }
  // the entablature, breaking forward over the columns
  if (z >= 6.9 && z < 8.6) {
    if (pair && f <= 1.75 && z < 8.15) return YM_LIME
    if (A >= 2.25 && A <= 4.85 && f <= 2.0 && z >= 8.15) return YM_LIME // the cornice over the pair
    if (f > TP_WALL) {
      if (z < 7.25 && f <= TP_WALL + 0.12) return YM_LIME // the band over the arch
      if (z >= 8.15 && f <= TP_WALL + 0.35) return YM_LIME // the cornice between the pairs
      return 0
    }
  }
  // the attic, its coping, the inscribed panel, and the four dies with their round caps
  if (z >= 8.6) {
    for (const ac of TP_COLS) {
      const da = Math.abs(a - ac)
      const df = f - (TP_COL_F - 0.15)
      if (z < 10.5 && da <= 0.45 && f >= 0.25 && f <= 1.55) return YM_LIME
      if (z >= 10.5 && z < 10.66 && da <= 0.52 && f >= 0.2 && f <= 1.62) return YM_LIME
      if (z >= 10.66 && da * da + df * df + ((z - 10.66) * 0.95) ** 2 <= 0.42 ** 2) return YM_LIME
    }
    if (z >= 10.55) return 0
    if (z >= 10.3) return A <= 4.85 && f >= -1.6 && f <= 0.45 ? YM_LIME : 0
    if (A > 4.7 || f < -1.5 || f > 0.4) return 0
    if (A <= 1.0 && z >= 9.0 && z < 9.85) return YM_LIME // the panel (the letters are too small to show)
    return f > 0.3 ? 0 : flintAt(a, f, z)
  }
  if (f > TP_WALL) {
    // what stands proud of the wall: the string course at the springing, the jambs, the archivolt and keystone
    if (f > TP_WALL + 0.25 && !(A <= 0.32 && z > 6.2 && z < 7.0 && f <= TP_WALL + 0.32)) return 0
    if (z >= 4.5 && z < 4.85 && A <= 5.0 && A >= TP_ARCH) return YM_LIME
    if (A >= TP_ARCH && A <= 2.3 && z >= 0.9 && z < 4.5) return YM_LIME
    const rr = Math.hypot(a, z - TP_SPRING)
    if (z >= TP_SPRING && rr >= TP_ARCH && rr <= 2.2) return YM_LIME
    if (A <= 0.32 && z > 6.2 && z < 7.0) return YM_LIME // the keystone, to the band over it
    return 0
  }
  if (f < -1.7 || A > 5.0) return 0
  // the wall, and the niche cut into it
  const rr = Math.hypot(a, z - TP_SPRING)
  const open = z < TP_SPRING ? A < TP_ARCH : rr < TP_ARCH
  if (open) return f > TP_NICHE ? 0 : flintAt(a, f, z) // the back of the niche is flint
  if (f > TP_NICHE - 0.25) {
    // the sides of the niche are dressed stone; its vault is plastered
    if (z < TP_SPRING ? A < TP_ARCH + 0.25 : rr < TP_ARCH + 0.25) return z < TP_SPRING ? YM_LIME : YM_OCHRE
  }
  if (z > 4.5 && z < 4.85) return YM_LIME // the string course runs on round the niche
  return flintAt(a, f, z)
}

// ── The museum: one on the map, an exhibition hall of cream stucco in the Viennese manner of the 1860s.
// A raised middle block of three bays: on the ground floor three arched glass doors up a flight of steps,
// with a marble statue on a pedestal either side of each; over them three tall arched windows, each behind
// a little balustrade, between engaged columns; then a band of sculpted panels, a frieze with the name in
// gilt letters (too small to read), a cornice and an attic balustrade, and behind it a glass skylight over
// the hall. Either side a lower wing with a red banner, and at each end a pavilion standing a little
// forward. The ground floor is rusticated, the roofs are lead. About 14 tall, 29 across and 16 deep.
// museumAt(a, f, z) as chapelAt: across, forward (the doors are at +f), up.
const MU_TOP = 13.8
const MU_BACK = 7 // the back wall, all along
const MU_C = 6.5 // the middle block to ±MU_C across, its front at MU_CF, its cornice up to MU_CT
const MU_CF = 6.5
const MU_CT = 11.2
const MU_WING = 11 // the wings to ±MU_WING, …
const MU_WF = 5.0
const MU_WT = 9.5
const MU_SIDE = 14 // … and the end pavilions to ±MU_SIDE
const MU_PF = 5.6
const MU_PT = 9.9
const MU_BAYS = [-3.4, 0, 3.4] // the doors and the windows over them, across
const MU_COLS = [-5.1, -1.7, 1.7, 5.1] // the statues, and the columns over them
const MU_BANNER = 8.75 // the middle of each wing, across
const MU_END = 12.5 // the middle of each pavilion
const MU_SIDE_WIN = [-5, -2, 1, 4] // the windows along each end, forward
/** how far a block's walls stand out at height z, its cornice's top at T: the plinth, the string course, the cornice */
function muProj(z, T) {
  if (z < 0.8) return 0.3
  if (z >= 5.2 && z < 5.7) return 0.25
  if (z >= T - 0.6) return 0.45
  if (z >= T - 0.8) return 0.2
  return 0
}
/** a balustrade h high, zz up from its foot, u along it: a rail at the foot and at the top, balusters between */
function muRail(zz, h, u) {
  if (zz < 0.2 || zz >= h - 0.2) return YM_CREAM
  return u / 0.4 - Math.floor(u / 0.4) < 0.5 ? YM_CREAM : 0
}
function museumAt(a, f, z) {
  const A = Math.abs(a)
  if (A > MU_SIDE + 0.5 || f < -MU_BACK - 0.5 || f > 9.1 || z > MU_TOP) return 0
  // the steps up to the doors
  if (A <= 5.6 && f > MU_CF && z < (f <= 7.6 ? 0.8 : f <= 8.3 ? 0.53 : f <= 9.0 ? 0.27 : 0)) return YM_CREAM
  // what stands before the middle block: the statues on their pedestals, the columns, the balustrades
  if (f > MU_CF && A <= MU_C) {
    if (z >= 0.8 && z < 4.2 && f < MU_CF + 1.0) {
      for (const ac of MU_COLS) {
        const da = a - ac
        if (Math.abs(da) > 0.7) continue
        const df = f - (MU_CF + 0.5)
        if (z < 1.9) {
          const r = z < 1.0 || z >= 1.75 ? 0.45 : 0.38
          return Math.abs(da) <= r && Math.abs(df) <= r ? YM_CREAM : 0
        }
        return templeStatue((Math.sign(ac) * da) / 0.8, (z - 1.9) / 0.8, df / 0.8) ? YM_MARBLE : 0
      }
    }
    if (z >= 5.7 && z < 9.3) {
      for (const ac of MU_COLS) {
        const r = Math.hypot(a - ac, f - MU_CF)
        if (z < 5.9 ? r <= 0.42 : z < 8.95 ? r <= 0.3 : z < 9.1 ? r <= 0.38 : Math.max(Math.abs(a - ac), f - MU_CF) <= 0.45) return YM_CREAM
      }
      if (z < 6.5 && f <= MU_CF + 0.45) {
        for (const ac of MU_BAYS) if (Math.abs(a - ac) <= 1.05) return muRail(z - 5.7, 0.8, a - ac + 1.05)
      }
    }
  }
  // the pilasters at the corners of each pavilion, and the gilt rod each banner hangs from
  if (A > MU_WING && f > MU_PF && f <= MU_PF + 0.2 && z >= 5.7 && z < MU_PT - 0.8 && (A <= 11.6 || A >= 13.4)) return YM_CREAM
  if (A > MU_C && A <= MU_WING && f > MU_WF && f <= MU_WF + 0.2 && z >= 8.85 && z < 9.0 && Math.abs(A - MU_BANNER) <= 0.85) return YM_GOLD
  // the walls of the three blocks, the middle first: the plinth, the string course and the cornice stand out from them
  let p = muProj(z, MU_CT)
  if (z < MU_CT && A <= MU_C + p && f <= MU_CF + p && f >= -MU_BACK - p) return muWall(0, a, A, f, z)
  p = muProj(z, MU_WT)
  if (z < MU_WT && A <= MU_WING + p && f <= MU_WF + p && f >= -MU_BACK - p) return muWall(1, a, A, f, z)
  p = muProj(z, MU_PT)
  if (z < MU_PT && A > MU_WING && A <= MU_SIDE + p && f <= MU_PF + p && f >= -MU_BACK - p) return muWall(2, a, A, f, z)
  // on the roofs: the attic over the middle and the skylight behind it, and a balustrade round the wings and pavilions
  if (A <= MU_C) {
    if (z < MU_CT || z >= MU_CT + 1.4) return museumSkylight(a, A, f, z)
    const dF = MU_CF - f
    const dB = f + MU_BACK
    const dS = MU_C - A
    const din = Math.min(dF, dB, dS)
    if (din < 0) return 0
    if (din > 0.5) return museumSkylight(a, A, f, z)
    const u = dS <= 0.5 ? f : a
    // a die at each corner, over each column, and every 3 along the sides and the back
    const corner = (dF <= 0.5 ? 1 : 0) + (dB <= 0.5 ? 1 : 0) + (dS <= 0.5 ? 1 : 0) > 1
    if (corner || (dF <= 0.5 ? MU_COLS.some((ac) => Math.abs(a - ac) < 0.35) : Math.abs(u / 3 - Math.round(u / 3)) < 0.1)) return YM_CREAM
    return muRail(z - MU_CT, 1.4, u)
  }
  if (A <= MU_WING) {
    if (z < MU_WT || z >= MU_WT + 0.9) return 0
    const din = Math.min(MU_WF - f, f + MU_BACK)
    if (din < 0 || din > 0.5) return 0
    return A >= MU_WING - 0.4 || A <= MU_C + 0.4 ? YM_CREAM : muRail(z - MU_WT, 0.9, a)
  }
  if (z < MU_PT) return 0
  const dF = MU_PF - f
  const dB = f + MU_BACK
  const dS = MU_SIDE - A
  // a ball on a die at each outer corner
  if (dS <= 0.5 && (dF <= 0.5 || dB <= 0.5)) {
    if (z < MU_PT + 0.9) return dS >= 0 && dF >= 0 && dB >= 0 ? YM_CREAM : 0
    const df = dF <= 0.5 ? f - (MU_PF - 0.25) : f + MU_BACK - 0.25
    return (A - 13.75) ** 2 + df * df + (z - MU_PT - 1.25) ** 2 <= 0.35 ** 2 ? YM_CREAM : 0
  }
  if (z >= MU_PT + 0.9) return 0
  const din = Math.min(dF, dB, dS)
  if (din < 0 || din > 0.5) return 0
  return muRail(z - MU_PT, 0.9, dS <= 0.5 ? f : a)
}
/** the glass skylight over the middle of the hall: a low hipped roof of glass in an iron grid, on a stucco curb */
function museumSkylight(a, A, f, z) {
  if (A > 3.8 || f < -5 || f > 3.6 || z < MU_CT) return 0
  if (z < MU_CT + 0.7) return YM_CREAM
  if (z >= MU_CT + 0.7 + Math.min(3.8 - A, f + 5, 3.6 - f) * 0.5) return 0
  const rib = Math.abs(a - 0.9 * Math.round(a / 0.9)) < 0.1 || Math.abs(f - 0.9 * Math.round(f / 0.9)) < 0.1
  return rib ? YM_IRON : YM_GLASS
}
/** the wall of block b (0 the middle, 1 a wing, 2 a pavilion) at a point inside it or its mouldings */
function muWall(b, a, A, f, z) {
  const T = b === 0 ? MU_CT : b === 1 ? MU_WT : MU_PT
  const front = b === 0 ? MU_CF : b === 1 ? MU_WF : MU_PF
  const dF = front - f
  const dB = f + MU_BACK
  const dS = (b === 0 ? MU_C : MU_SIDE) - A
  // the lead roof inside the cornice
  const inner = Math.min(dF, dB, b === 0 ? dS : b === 2 ? Math.min(dS, A - MU_WING) : 1e9)
  if (z >= T - 0.15 && inner > 0.5) return YM_LEAD
  if (z < 0.8) return YM_JOINT
  if (z >= T - 0.8 || (z >= 5.2 && z < 5.7)) return YM_CREAM
  // the face it is nearest, and how deep in from it; only the front, the back and the ends have openings
  let d = dF
  let face = 0
  if (dB < d) { d = dB; face = 1 }
  if (b === 2 && dS < d) { d = dS; face = 2 }
  const upper = z >= 5.7
  const rusticated = z - 0.8 - 0.72 * Math.floor((z - 0.8) / 0.72) < 0.14 ? YM_JOINT : YM_CREAM
  if (d > 0.6) return upper ? YM_CREAM : rusticated
  let win = false
  if (face === 0 && b === 0) {
    if (!upper) {
      // the three doors, arched, in smooth arches cut through the rustication
      for (const ac of MU_BAYS) {
        const du = Math.abs(a - ac)
        if (du >= 1.25 || z >= 4.85) continue
        const r2 = du * du + (z - 3.6) ** 2
        if (z < 3.6 ? du < 0.95 : r2 < 0.95 * 0.95) return d < 0.35 ? 0 : YM_WINDOW
        if (z < 3.6 || r2 < 1.25 * 1.25) return YM_CREAM
      }
      return rusticated
    }
    if (z < 9.3) {
      for (const ac of MU_BAYS) {
        const du = a - ac
        if (Math.abs(du) < 0.8 && z > 6.5 && (z < 8.5 || du * du + (z - 8.5) ** 2 < 0.64)) win = true
      }
    } else if (z < 9.85) {
      return speck(a, f, z, 4) < 3 ? YM_JOINT : YM_RELIEF // the sculpted panels
    } else if (A <= 3.6 && z >= 9.97 && z < 10.28) {
      // the name, in gilt letters
      const col = Math.floor((a + 3.6) / 0.24)
      if (col % 4 !== 3 && speck(col, 0, Math.floor((z - 9.97) / 0.1), 1) < 6) return YM_GOLD
    }
  } else if (face === 0) {
    const du = Math.abs(A - (b === 1 ? MU_BANNER : MU_END))
    if (!upper) win = du < 0.65 && z > 1.8 && z < 3.9
    else if (b === 1) {
      // a red banner on the wall, with a pale band near its foot
      if (du <= 0.7 && z >= 6.1 && z < 8.9) return d > 0.3 || (z >= 6.55 && z < 6.75) ? YM_CREAM : YM_BANNER
    } else win = du < 0.6 && z > 6.4 && (z < 8.2 || du * du + (z - 8.2) ** 2 < 0.36)
  } else {
    const du = face === 1 ? a - 3 * Math.round(a / 3) : Math.min(...MU_SIDE_WIN.map((w) => Math.abs(f - w)))
    win = Math.abs(du) < 0.6 && (upper ? z > 6.4 && z < 8.6 : z > 1.8 && z < 3.9)
  }
  if (win) return d < 0.3 ? 0 : YM_WINDOW
  return upper ? YM_CREAM : rusticated
}

// The chapel, the temple and the museum are built the same way, at three levels of detail, far to near.
const MON_LOD = [0.5, 0.25, 0.125]
const MONUMENTS = {
  chapel: { at: chapelAt, side: 6.1, back: 6.1, fore: 7.1, top: CH_TOP, reach: 15, mid: 9, models: [], build: null },
  temple: { at: templeAt, side: 5.1, back: 1.8, fore: 2.1, top: TP_TOP, reach: 8, mid: 5.5, models: [], build: null },
  museum: { at: museumAt, side: 14.5, back: 7.5, fore: 9.1, top: MU_TOP, reach: 17, mid: 6, models: [], build: null },
}
/**
 * the surface voxels of a monument at size g, normals from which of their neighbours are empty. It fills
 * its grid a level at a time as step(ms) is called, for no longer than ms each time, so the finest model
 * can be made over a few frames; done once model is set.
 */
function monumentBuilder(M, g) {
  const na = Math.ceil(M.side / g)
  const nb = Math.ceil(M.back / g)
  const nf = Math.ceil(M.fore / g)
  const NX = na * 2 + 1
  const NY = nb + nf + 1
  const NZ = Math.ceil(M.top / g)
  const grid = new Uint8Array(NX * NY * NZ)
  let k = 0
  const B = { model: null, step }
  return B
  function step(ms) {
    const t0 = performance.now()
    while (k < NZ) {
      const z = (k + 0.5) * g
      for (let j = 0; j < NY; j++) {
        const f = (j - nb) * g
        const row = (k * NY + j) * NX
        for (let i = 0; i < NX; i++) grid[row + i] = M.at((i - na) * g, f, z)
      }
      k++
      if (performance.now() - t0 > ms) return B.model
    }
    // outside the grid is empty, except below the floor
    const empty = (i, j, k) => k >= 0 && (i < 0 || j < 0 || i >= NX || j >= NY || k >= NZ || grid[(k * NY + j) * NX + i] === 0)
    const A = [], F = [], Z = [], NA = [], NF = [], NZv = [], K = []
    for (let k = 0; k < NZ; k++) {
      for (let j = 0; j < NY; j++) {
        for (let i = 0; i < NX; i++) {
          const m = grid[(k * NY + j) * NX + i]
          if (m === 0) continue
          if (!empty(i - 1, j, k) && !empty(i + 1, j, k) && !empty(i, j - 1, k) && !empty(i, j + 1, k) && !empty(i, j, k - 1) && !empty(i, j, k + 1)) continue
          let nx = 0, ny = 0, nz = 0
          for (let dk = -1; dk <= 1; dk++) {
            for (let dj = -1; dj <= 1; dj++) {
              for (let di = -1; di <= 1; di++) {
                if (empty(i + di, j + dj, k + dk)) { nx += di; ny += dj; nz += dk }
              }
            }
          }
          const l = Math.hypot(nx, ny, nz)
          A.push((i - na) * g); F.push((j - nb) * g); Z.push((k + 0.5) * g)
          if (l > 0) { NA.push(nx / l); NF.push(ny / l); NZv.push(nz / l) } else { NA.push(0); NF.push(0); NZv.push(1) }
          K.push(m)
        }
      }
    }
    B.model = {
      n: A.length,
      A: Float32Array.from(A), F: Float32Array.from(F), Z: Float32Array.from(Z),
      NA: Float32Array.from(NA), NF: Float32Array.from(NF), NZ: Float32Array.from(NZv), K: Uint8Array.from(K),
    }
    return B.model
  }
}
/** a monument's model at a level of detail, made now if it is not made yet */
function monumentModel(M, lod) {
  return M.models[lod] || (M.models[lod] = monumentBuilder(M, MON_LOD[lod]).step(Infinity))
}
/** the finest model, made a few milliseconds at a time: null until it is done */
function monumentFine(M, ms) {
  if (M.models[2]) return M.models[2]
  if (!M.build) M.build = monumentBuilder(M, MON_LOD[2])
  const m = M.build.step(ms)
  if (m) { M.models[2] = m; M.build = null }
  return m
}
/** the top of a monument over the point (a, f) of its footprint, sampled down its column */
function monumentHeight(M, a, f) {
  for (let z = M.top; z > 0; z -= 0.25) if (M.at(a, f, z)) return z
  return 0.5
}

// The gull, built like the props, with parts: 0 the body, 1 the left wing, 2 the right wing. The wings
// beat about the shoulder (GULL_SHOULDER across, at the wing's own height). White, grey wings with
// black tips, a yellow bill, 4.5 across. Voxels of 0.25.
const GULL_G = 0.25
const GULL_SHOULDER = 0.25
const GULL = propModel((box) => {
  box(-0.25, 0.25, -1.0, 0.75, -0.25, 0.25, YM_GULL) // the body
  box(-0.25, 0.25, 0.75, 1.25, 0, 0.5, YM_GULL) // the head
  box(-0.125, 0.125, 1.25, 1.5, 0.125, 0.375, YM_BILL)
  box(-0.25, 0.25, -1.5, -1.0, -0.125, 0.125, YM_GULL) // the tail
  box(-2.25, -0.25, -0.5, 0.25, 0, 0.25, (i) => (i < 2 ? YM_WING_TIP : YM_GULL_WING), 1)
  box(0.25, 2.25, -0.5, 0.25, 0, 0.25, (i) => (i > 5 ? YM_WING_TIP : YM_GULL_WING), 2)
}, GULL_G)

function makeJet(x, y, z, yaw) {
  return {
    x, y, z, yaw, yawRate: 0, roll: 0, pitch: 0, stunt: -1, stuntDir: 1, stuntDelay: 0, vx: 0, vy: 0,
    trail: [new Float32Array(TRAIL_N * 4), new Float32Array(TRAIL_N * 4)],
    trailHead: 0, trailLen: 0, g: 0, lastTrailX: x, lastTrailY: y,
    // bumps in the air: roll, pitch, yaw and height, each a little spring kicked now and then
    joltR: 0, joltRV: 0, joltP: 0, joltPV: 0, joltY: 0, joltYV: 0, joltZ: 0, joltZV: 0, joltNext: 1, joltN: 0,
    propAngle: 0,
  }
}

export function createScene(initial) {
  let p = { ...initial }

  // ── the jet's slices as lists of voxels
  const slices = decodeJet()
  const sliceA = []
  const sliceB = []
  const sliceC = []
  const sliceT = [] // 1 where a voxel is a thin column (a strut, a leg) with another voxel on top
  const shadowMask = new Uint8Array(JET_W * JET_L)
  let firstSlice = JET_H
  for (let y = 0; y < JET_H; y++) {
    const s = slices[y]
    let n = 0
    for (let o = 0; o < s.length; o++) if (s[o]) n++
    const a = new Float32Array(n)
    const b = new Float32Array(n)
    const c = new Uint8Array(n)
    const tc = new Uint8Array(n)
    let j = 0
    for (let k = 0; k < JET_L; k++) {
      for (let i = 0; i < JET_W; i++) {
        const v = s[k * JET_W + i]
        if (!v) continue
        a[j] = i - (JET_W - 1) / 2
        b[j] = PIV_K - k
        c[j] = v
        if (y + 1 < JET_H && slices[y + 1][k * JET_W + i] !== 0) {
          let near = 0
          if (i > 0 && s[k * JET_W + i - 1]) near++
          if (i < JET_W - 1 && s[k * JET_W + i + 1]) near++
          if (k > 0 && s[(k - 1) * JET_W + i]) near++
          if (k < JET_L - 1 && s[(k + 1) * JET_W + i]) near++
          tc[j] = near <= 1 ? 1 : 0
        }
        j++
        shadowMask[k * JET_W + i] = 1
      }
    }
    if (n && y < firstSlice) firstSlice = y
    sliceA.push(a)
    sliceB.push(b)
    sliceC.push(c)
    sliceT.push(tc)
  }

  // ── palettes (rebuilt when colours change, and every frame while the light changes)
  const jetPal = new Uint32Array(96)
  const jetPalLit = new Uint32Array(96) // one tone up, for surfaces turned to the sun
  const jetPalDim = new Uint32Array(96) // one tone down, for surfaces turned away
  const jetPalDay = new Uint32Array(96) // jetPal in daylight: the cockpit is painted in it, then toned live
  const cockpitTint = [256, 256, 256] // that tone: r, g, b in 256ths
  let shutterLit = 0 // green shutters on the villas
  let shutterShade = 0
  let winLit = 0 // a villa window lit from inside, at night
  let winOn = 0 // how many windows in 256 are lit now: those whose hash8 is under this
  const facPal = new Uint32Array(10) // a facade's colours for this column, by role (F_…)
  const topLit = new Uint32Array(NMAT)
  const topShade = new Uint32Array(NMAT)
  const sideLit = new Uint32Array(NMAT)
  const sideShade = new Uint32Array(NMAT)
  const cloudTop = new Uint32Array(CK)
  const cloudSide = new Uint32Array(CK)
  const flamePal = new Uint32Array(6)
  const trailPal = new Uint32Array(3)
  const skyPal = new Uint32Array(NSKY)
  const starPal = new Uint32Array(NSKY) // a star against each band of the sky, as bright as the night is dark
  let hazeCol = 0
  let cloudUnder = 0
  let sunCol = 0 // the low sun at dusk and dawn
  let sunGlow = 0
  let moonCol = 0
  let moonGlow = 0
  let sparkA = 0
  let sparkB = 0
  let foamCol = 0
  let sunX = 0.45
  let sunY = 0.3
  let cockpitSun = SUN_DAY // the light that falls into the cockpit, and how strong it is
  let cockpitPower = 1
  let smokeNight = 1 // the exhaust smoke is fainter in the dark
  let jetLitAt = 0.9 // how square to the light a side of the plane must be to take the lit tone …
  let jetDimAt = 0.66 // … or how far from it to take the dim one
  const yachtPal = new Uint32Array(NYM * 4) // per boat material: shadow, side, top, lit side
  const lifePal = new Uint32Array(LIFE_COL.length)

  // the light: phase 0 day … 1 night (todWeights), eased from dayLin, which N moves at an even pace
  let dayLin = TOD_PHASE[p.timeOfDay] ?? 0
  let dayGoal = dayLin
  const easeDay = (l) => 0.5 * l + 0.5 * l * l * (3 - 2 * l)
  let phase = easeDay(dayLin)
  const tw = [1, 0, 0] // the weights of the day, sunset and night colours
  let lampK = 0 // 0 every lamp off … 1 every lamp on
  let moonK = 0 // how much of the moon and the stars shows
  // one number, or one colour, mixed from its day, sunset and night versions
  const mixN = (d, s, n) => d * tw[0] + s * tw[1] + n * tw[2]
  const mix3 = (d, s, n) => [mixN(d[0], s[0], n[0]), mixN(d[1], s[1], n[1]), mixN(d[2], s[2], n[2])]
  const mixPacked = (d, s, n) =>
    pack(mixN(d & 255, s & 255, n & 255), mixN((d >> 8) & 255, (s >> 8) & 255, (n >> 8) & 255), mixN((d >> 16) & 255, (s >> 16) & 255, (n >> 16) & 255))
  // a colour graded for the light: aS of the sunset grade at dusk, aN of the night grade at night
  const gradeT = (c, aS, aN) => mix3(c, grade(c, 'sunset', aS), grade(c, 'night', aN))
  const toward = (c, to, k) => [c[0] + (to[0] - c[0]) * k, c[1] + (to[1] - c[1]) * k, c[2] + (to[2] - c[2]) * k]
  /** one lamp, its own moment to come on given by h (0…255): 0 off … 1 fully on */
  const lampOn = (h) => clamp((lampK - (h / 255) * 0.8) * 5, 0, 1)

  function setPhase(s) {
    phase = s
    todWeights(s, tw)
    lampK = clamp((s - LAMP_ON0) / (LAMP_ON1 - LAMP_ON0), 0, 1)
    moonK = clamp((s - 0.62) / 0.3, 0, 1)
  }
  setPhase(phase)

  /** every palette, for the colours and the light now; repaint: the cockpit too (it is slow) */
  function rebuildPalettes(repaint = true) {
    // jet: recolour each family from its key tone
    const keys = {
      0: { key: 4, col: parseColor(p.bodyColor, [50, 84, 160]), def: [50, 84, 160] },
      1: { key: 3, col: parseColor(p.accentColor, [246, 192, 34]), def: [246, 192, 34] },
      2: { key: 3, col: parseColor(p.canopyColor, [156, 162, 172]), def: [156, 162, 172] },
    }
    const keyLum = {}
    for (const row of JET_PALETTE) {
      const fam = row[4]
      if (fam < 3 && ((row[0] - 1) & 15) === keys[fam].key) keyLum[fam] = lum([row[1], row[2], row[3]])
    }
    for (const row of JET_PALETTE) {
      const idx = row[0]
      const fam = row[4]
      let c = [row[1], row[2], row[3]]
      if (fam < 3) {
        const k = keys[fam]
        const same = k.col[0] === k.def[0] && k.col[1] === k.def[1] && k.col[2] === k.def[2]
        if (!same) {
          const l = lum(c)
          const kl = keyLum[fam] || 100
          if (l <= kl) {
            const f = l / kl
            c = [k.col[0] * f, k.col[1] * f, k.col[2] * f]
          } else {
            const f = (l - kl) / (255 - kl)
            c = [k.col[0] + (255 - k.col[0]) * f, k.col[1] + (255 - k.col[1]) * f, k.col[2] + (255 - k.col[2]) * f]
          }
        }
        jetPalDay[idx] = pack(c[0], c[1], c[2])
        c = gradeT(c, 0.5, 0.3)
      } else jetPalDay[idx] = pack(c[0], c[1], c[2])
      jetPal[idx] = pack(c[0], c[1], c[2])
    }
    for (const row of JET_PALETTE) {
      const idx = row[0]
      const fam = row[4]
      jetPalLit[idx] = fam < 3 && jetPal[idx + 1] ? jetPal[idx + 1] : jetPal[idx]
      jetPalDim[idx] = fam < 3 && ((idx - 1) & 15) > 0 ? jetPal[idx - 1] : jetPal[idx]
    }
    // the grade above, as a tone for the cockpit (it is slow to paint, so it is painted in daylight)
    const grey = gradeT([160, 160, 160], 0.5, 0.3)
    for (let i = 0; i < 3; i++) cockpitTint[i] = Math.round((grey[i] / 160) * 256)
    if (repaint) {
      cockpit = null // repainted in the new colours shortly
      cockpitDue = 0.3
    }
    // world
    for (let m = 0; m < NMAT; m++) {
      const t = gradeT(MAT_TOP[m], 1, 1)
      const s = gradeT(MAT_SIDE[m], 1, 1)
      topLit[m] = pack(t[0], t[1], t[2])
      sideLit[m] = pack(s[0], s[1], s[2])
      topShade[m] = pack(t[0] * 0.62, t[1] * 0.67, t[2] * 0.8)
      sideShade[m] = pack(s[0] * 0.62, s[1] * 0.67, s[2] * 0.8)
    }
    const sh = gradeT([58, 104, 72], 1, 1)
    shutterLit = pack(sh[0], sh[1], sh[2])
    shutterShade = pack(sh[0] * 0.62, sh[1] * 0.67, sh[2] * 0.8)
    winLit = pack(255, 194, 102)
    winOn = Math.round(WIN_LIT * lampK)
    for (let k = 0; k < CK; k++) {
      const f = k / (CK - 1)
      const ft = Math.min(1, k / 2)
      const t = gradeT([218 + 37 * ft, 230 + 25 * ft, 247 + 8 * ft], 1, 0.72)
      const s = gradeT([158 + 44 * f, 182 + 36 * f, 222 + 18 * f], 1, 0.72)
      cloudTop[k] = pack(t[0], t[1], t[2])
      cloudSide[k] = pack(s[0], s[1], s[2])
    }
    const sa = mix3([120, 190, 236], [255, 170, 110], [70, 110, 190])
    const sb = mix3([236, 250, 255], [255, 226, 170], [170, 200, 240])
    const fm = mix3([240, 252, 255], [255, 226, 214], [110, 140, 200])
    sparkA = pack(sa[0], sa[1], sa[2])
    sparkB = pack(sb[0], sb[1], sb[2])
    foamCol = pack(fm[0], fm[1], fm[2])
    for (let k = 0; k < NYM; k++) {
      const pale = k === YM_SAIL || k === 12 || k === 7 || k === YM_HULL
      // the chapel, the temple and the museum take the light as the ground does, a little less, so they stand out from it
      const stone = k >= YM_TRAV && k <= YM_BANNER
      let c = stone ? gradeT(YACHT_COL[k], 0.8, 0.85) : gradeT(YACHT_COL[k], 0.42, pale ? 0.22 : 0.32)
      // the fountains are lit from under the water at night
      if (k === YM_SPRAY) c = toward(c, [196, 232, 255], lampK * 0.8)
      let shades = [
        [c[0] * 0.6, c[1] * 0.66, c[2] * 0.8],
        [c[0] * 0.84, c[1] * 0.86, c[2] * 0.92],
        c,
        [c[0] * 1.07 + 10, c[1] * 1.07 + 9, c[2] * 1.05 + 6],
      ]
      // a lamp gives its own light, the same from every side and at any hour
      if (k >= YM_LAMP) shades = [YACHT_COL[k], YACHT_COL[k], YACHT_COL[k], YACHT_COL[k]]
      // a boat's windows and open hatch glow with the cabin lamp
      if (k === YM_WINDOW) shades = shades.map((s) => toward(s, [255, 190, 100], lampK * 0.9))
      for (let s = 0; s < 4; s++) yachtPal[k * 4 + s] = pack(shades[s][0], shades[s][1], shades[s][2])
    }
    for (let k = 0; k < LIFE_COL.length; k++) {
      const c = gradeT(LIFE_COL[k], 0.4, 0.3)
      lifePal[k] = pack(c[0], c[1], c[2])
    }
    const flames = [[255, 252, 224], [255, 224, 120], [255, 164, 44], [246, 96, 20], [176, 48, 26], [96, 34, 40]]
    for (let i = 0; i < 6; i++) flamePal[i] = pack(flames[i][0], flames[i][1], flames[i][2])
    const tr = [gradeT([255, 255, 255], 0.8, 0.8), gradeT([214, 232, 250], 0.8, 0.8), gradeT([170, 204, 240], 0.8, 0.8)]
    for (let i = 0; i < 3; i++) trailPal[i] = pack(tr[i][0], tr[i][1], tr[i][2])
    // sky: from the horizon up
    const skyA = mix3([198, 232, 250], [255, 198, 132], [36, 56, 110])
    const skyM = mix3([122, 190, 240], [238, 122, 130], [18, 28, 70])
    const skyB = mix3([62, 142, 222], [84, 68, 150], [7, 10, 34])
    const star = [232, 238, 255]
    for (let i = 0; i < NSKY; i++) {
      const f = i / (NSKY - 1)
      const a = f < 0.5 ? skyA : skyM
      const b = f < 0.5 ? skyM : skyB
      const g = f < 0.5 ? f * 2 : f * 2 - 1
      const c = [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g, a[2] + (b[2] - a[2]) * g]
      skyPal[i] = pack(c[0], c[1], c[2])
      const st = toward(c, star, moonK)
      starPal[i] = pack(st[0], st[1], st[2])
    }
    const hz = mix3([188, 224, 246], [250, 182, 134], [28, 44, 92])
    hazeCol = pack(hz[0], hz[1], hz[2])
    const cu = gradeT([138, 160, 200], 1, 0.72)
    cloudUnder = pack(cu[0], cu[1], cu[2])
    sunCol = pack(255, 244, 200)
    sunGlow = pack(255, 222, 150)
    moonCol = pack(star[0], star[1], star[2])
    moonGlow = pack(70, 96, 160)
    sunX = mixN(0.5, 0.95, 0.3)
    sunY = mixN(0.32, 0.5, 0.42)
    cockpitSun = mixPacked(SUN_DAY, SUN_SUNSET, SUN_NIGHT)
    cockpitPower = mixN(1, 1.1, 0.45)
    smokeNight = mixN(1, 1, 0.55)
    jetLitAt = mixN(0.9, 0.9, 0.74)
    jetDimAt = mixN(0.66, 0.66, 0.4)
  }

  // ── the world: a height and a material per ground pixel
  const heightMap = new Uint8Array(N * N)
  const floorMap = new Uint8Array(N * N) // ground under the trees, so walking stays on the floor
  const matMap = new Uint8Array(N * N)
  const smallIsle = new Uint8Array(N * N) // 1 on land too small to spawn the person
  const houseMap = new Uint16Array(N * N) // 0 empty, else house id
  const cloudN = new Uint8Array(NC * NC)
  const nz = new Uint8Array(256 * 256)
  // what the GPU needs of the world (gpu-world.ts). stamp changes when the world is rebuilt; dirty
  // holds row ranges (y0, y1 pairs) of the height and material maps changed since, by bombs.
  const GW = {
    heightMap, matMap, cloudN, nz, stamp: 0, dirty: [],
    bloom: BLOOM, facade: FACADE, // per material: a flower drawn as a bloom; a house wall's facade
    consts: { N, NC, CLOUD_ALT, CK, ZTOP, FLOOR_H, JET_W, JET_L, PIV_K, EPS, FOG_STEPS, M_HSTONE, M_SLAT, M_IRON, M_DOOR, FAC_L1, FAC_L2, FAC_L3, F_ROOF, FAC_WALK },
  }
  let spawnX = N / 2
  let spawnY = N / 2
  const houses = []
  const props = [] // { kind, x, y, z, yaw, alive }: kind indexes PROPS; z is what it stands on
  const fountains = [] // { x, y, z, alive }: z is the top of the spout
  // gulls fly set paths, worked out from the time each frame: each circles an anchor (ax, ay) at
  // height az, at radius r with angular speed w and phase ph.
  const birds = []
  // what a cell is part of, so one layout never runs over another:
  // 1 a house and its yard · 2 a villa garden · 3 a lakeside terrace, promenade, path or the chapel's
  // garden, the temple's lawn and the museum's grounds · 4 a monument: the chapel, the temple or the museum
  const parkMap = new Uint8Array(N * N)
  // the chapel and the temple: the middle of each, its floor and the way it faces (null if none would
  // fit), and how high they stand over each cell of their footprints, for the plane, the bombs and the camera
  let chapel = null
  let temple = null
  let museum = null
  const monumentTop = new Map()
  let gardenN = 0
  let flowerN = 0

  function buildWorld() {
    const rnd = mulberry32((p.seed | 0) * 7919 + 13)
    for (let i = 0; i < nz.length; i++) nz[i] = (rnd() * 256) | 0

    const E = new Float32Array(N * N)
    addOctave(E, N, 512, 0.55, rnd)
    addOctave(E, N, 256, 1, rnd)
    addOctave(E, N, 128, 0.5, rnd)
    addOctave(E, N, 64, 0.25, rnd)
    addOctave(E, N, 32, 0.11, rnd)
    addOctave(E, N, 16, 0.05, rnd)
    normalise(E)

    // sea level from the wanted share of land
    const bins = new Uint32Array(1024)
    for (let o = 0; o < E.length; o++) bins[(E[o] * 1023) | 0]++
    const land = clamp(p.land, 0.02, 0.9)
    let acc = 0
    let sea = 1
    const target = (1 - land) * E.length
    for (let b = 0; b < 1024; b++) {
      acc += bins[b]
      if (acc >= target) { sea = (b + 1) / 1023; break }
    }
    const SAND = 0.012
    const span = Math.max(0.05, 1 - sea - SAND)

    for (let y = 0; y < N; y++) {
      const row = y << NSHIFT
      const rowNW = ((y - 2) & NM) << NSHIFT
      const rowSE = ((y + 2) & NM) << NSHIFT
      for (let x = 0; x < N; x++) {
        const o = row | x
        const e = E[o]
        const hs = hash8(o)
        const d = e - sea
        if (d < 0) {
          const dd = -d + (hs - 128) * 0.00004
          matMap[o] = dd > 0.07 ? 0 : dd > 0.03 ? 1 : dd > 0.008 ? 2 : 3
          heightMap[o] = 0
          continue
        }
        if (d < SAND) {
          matMap[o] = hs < 34 ? 5 : 4
          heightMap[o] = 0
          continue
        }
        const hr = (d - SAND) / span
        // terraces: 8 grass levels (2 px each), 4 rock levels and the snow cap (3 px each)
        let lv = hr < 0.5 ? 1 + ((hr * 16) | 0) : hr < 0.78 ? 9 + (((hr - 0.5) / 0.07) | 0) : 13 + (((hr - 0.78) / 0.09) | 0)
        if (lv > 15) lv = 15
        heightMap[o] = lv <= 8 ? lv * 2 : 16 + (lv - 8) * 3
        const g = E[rowNW | ((x - 2) & NM)] - E[rowSE | ((x + 2) & NM)]
        const lit = g < -0.007
        const shaded = g > 0.007
        if (lv >= 13) matMap[o] = shaded ? 16 : 15
        else if (lv >= 9) matMap[o] = lit ? 14 : shaded ? 13 : hs < 26 ? 13 : 12
        else matMap[o] = lit ? 8 : shaded ? 7 : hs < 22 ? 7 : hs > 240 ? 8 : 6
      }
    }

    floorMap.set(heightMap)

    // forests, of three kinds of tree: the leafy cone everywhere, dark firs crowding the higher
    // ground, and big round-crowned trees (chestnut, plane) in groves on the low slopes.
    // Groves are patches of ~32 cells.
    const STEP = 5
    for (let gy = 0; gy < N; gy += STEP) {
      for (let gx = 0; gx < N; gx += STEP) {
        const hs = hash8(gy * 977 + gx * 131 + 7)
        const cx = (gx + (hs & 3)) & NM
        const cy = (gy + ((hs >> 2) & 3)) & NM
        const o = (cy << NSHIFT) | cx
        const m = matMap[o]
        if (m < 6 || m > 8) continue
        const h0 = heightMap[o]
        if (h0 > 14) continue
        const f = E[(((cy + 613) & NM) << NSHIFT) | ((N - 1 - cx + 911) & NM)]
        const pr = (f - sea) * 30
        if (pr <= 0 || pr * 255 < hash8(o + 99)) continue
        const grove = hash8((((cx >> 5) * 73) ^ ((cy >> 5) * 151)) + 11)
        let kind = 0
        if (h0 >= 8 ? grove < 170 : grove < 50) kind = 1
        else if (h0 <= 6 && grove > 175) kind = 2
        if (((hs >> 5) & 7) === 0) kind = 0 // a stray of the common kind in any grove
        const mats = TREE_KINDS[kind]
        // fir: narrow and tall · round: a broad dome, taller than the cone, with a lumpy top · leafy: the cone
        const r = kind === 1 ? 1.7 : kind === 2 ? 2.4 + ((hs >> 4) & 1) * 0.6 : 2 + ((hs >> 4) & 1)
        const ri = Math.ceil(r)
        for (let dy = -ri; dy <= ri; dy++) {
          for (let dx = -ri; dx <= ri; dx++) {
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist > r + 0.3) continue
            const oo = (((cy + dy) & NM) << NSHIFT) | ((cx + dx) & NM)
            if (matMap[oo] < 4) continue
            let rise
            if (kind === 1) rise = Math.round((1 - dist / (r + 0.4)) * 7.5)
            else if (kind === 2) {
              const q = dist / (r + 0.6)
              rise = Math.round(Math.sqrt(Math.max(0, 1 - q * q)) * (r + 2.4))
              // clumps of leaves: a cell here and there inside the crown stands one higher
              if (dist > 0.9 && dist < r - 0.4 && (hash8(oo * 7 + hs) & 3) === 0) rise++
            }
            else rise = Math.round((1 - dist / (r + 0.5)) * (r + 1))
            const nh = h0 + 1 + rise
            if (nh > heightMap[oo]) {
              heightMap[oo] = nh
              matMap[oo] = dist < 1.1 ? mats[0] : dist < r - 0.5 ? mats[1] : mats[2]
            }
          }
        }
      }
    }

    // a start over open water next to land
    let best = -1
    for (let tries = 0; tries < 400; tries++) {
      const x = (rnd() * N) | 0
      const y = (rnd() * N) | 0
      const here = matMap[(y << NSHIFT) | x]
      if (here > 2) continue
      let landNear = 0
      for (let a = 0; a < 8; a++) {
        const xx = (x + Math.cos(a * 0.785) * 120) & NM
        const yy = (y + Math.sin(a * 0.785) * 120) & NM
        if (matMap[(yy << NSHIFT) | xx] >= 4) landNear++
      }
      if (landNear > best && landNear <= 5) { best = landNear; spawnX = x; spawnY = y }
    }

    placeHouses(rnd)
    placeDocks()
    placeViewpoints(rnd)
    placeWildflowers(rnd)
    monumentTop.clear()
    placeChapel()
    placeTemple()
    placeMuseum()
    placeLamps()
    placeBoats(rnd)
    placeLife(rnd)
    placeBirds(mulberry32((p.seed | 0) * 4513 + 29)) // its own random stream, so the clouds stay put
    GW.stamp++
    GW.dirty.length = 0
    worldLog.info('built', {
      islands: bigIsle.length,
      specks: speckN,
      docks: docks.length,
      boats: boats.length,
      fish: fish.length,
      whales: whales.length,
      birds: birds.length,
      houses: houses.length,
      gardens: gardenN,
      viewpoints: views.length,
      chapel: chapel ? [chapel.x | 0, chapel.y | 0] : null,
      temple: temple ? [temple.x | 0, temple.y | 0] : null,
      museum: museum ? [museum.x | 0, museum.y | 0] : null,
      props: props.length,
      flowers: flowerN,
      spawn: [spawnX | 0, spawnY | 0],
    })

    // clouds: clusters of round puffs. Each cell holds (rank << 4) | thickness; a cloud shows
    // when its rank is under the cover setting, so the slider adds and removes whole clouds.
    cloudN.fill(0)
    for (let i = 0; i < 200; i++) {
      const rank = i & 15
      const cx = rnd() * NC
      const cy = rnd() * NC
      const sc = 0.6 + rnd() * rnd() * 1.25
      const ang = 0.35 + (rnd() - 0.5) * 1.3
      const len = (12 + rnd() * 24) * sc
      const puffs = 4 + ((rnd() * 7) | 0)
      for (let q = 0; q < puffs; q++) {
        const t = (q / (puffs - 1)) * 2 - 1
        const pxc = cx + Math.cos(ang) * t * len + (rnd() - 0.5) * 9 * sc
        const pyc = cy + Math.sin(ang) * t * len + (rnd() - 0.5) * 9 * sc
        const r = (6 + rnd() * 8) * sc * (1 - 0.45 * Math.abs(t))
        const maxT = clamp(Math.round(r * 0.6), 2, CK)
        const ri = Math.ceil(r)
        for (let dy = -ri; dy <= ri; dy++) {
          for (let dx = -ri; dx <= ri; dx++) {
            const d2 = (dx * dx + dy * dy) / (r * r)
            if (d2 > 1) continue
            const tk = Math.max(1, Math.round(Math.sqrt(1 - d2) * maxT))
            const xx = (Math.round(pxc) + dx) & NCM
            const yy = (Math.round(pyc) + dy) & NCM
            const oo = (yy << NCSHIFT) | xx
            if (tk > (cloudN[oo] & 15)) cloudN[oo] = (rank << 4) | tk
          }
        }
      }
    }
  }

  // A house on the lake, after the villas of Lake Como and the palazzi further south: stucco walls in one
  // of four warm colours, a column of windows every other cell, white stone pilasters at the corners, a
  // stone bay with the door in the middle of one long side (the facade is painted on as it is drawn: see
  // facadeAt), a shallow terracotta hip roof that slopes down on all four sides, lighter on the sunny
  // slopes, and a gravel yard. A villa is bigger and often three floors, may have a white bell tower with a
  // pointed cap at one corner, and stands in a garden of cypresses and clipped topiary behind a stone
  // balustrade.
  function stampHouse(cx, cy, rot, rnd) {
    const villa = rnd() < 0.4
    const w0 = villa ? 14 + ((rnd() * 3) | 0) : 9 + ((rnd() * 3) | 0)
    const d0 = villa ? 15 + ((rnd() * 5) | 0) : 10 + ((rnd() * 4) | 0)
    const ww = rot ? d0 : w0
    const dd = rot ? w0 : d0
    const yard = villa ? 3 : 2
    let minH = 99
    let maxH = 0
    for (let dy = -yard; dy < dd + yard; dy++) {
      for (let dx = -yard; dx < ww + yard; dx++) {
        const o = ((((cy + dy) & NM) << NSHIFT) | ((cx + dx) & NM))
        const m = matMap[o]
        if (m < 4 || m >= M_HEDGE) return false // water, or another villa's garden
        if (houseMap[o] || parkMap[o]) return false
        if (dx >= 0 && dy >= 0 && dx < ww && dy < dd) {
          if ((m < 6 || m > 8) && !isTree(m)) return false
          const h = isTree(m) ? 0 : heightMap[o]
          if (h && h < minH) minH = h
          if (h > maxH) maxH = h
        }
      }
    }
    if (minH > 90) minH = 8
    if (maxH - minH > 4 || minH > 16) return false
    const id = houses.length + 1
    const floors = villa && rnd() < 0.5 ? 3 : 2
    const top = minH + Math.round(floors * FLOOR_H)
    const tint = (rnd() * 4) | 0
    const wall = WALLS[tint]
    const win = WINDOWED[tint]
    // the garden first: gravel round the house, then (for a villa) a ring of garden and the balustrade
    const garden = []
    for (let dy = -yard; dy < dd + yard; dy++) {
      for (let dx = -yard; dx < ww + yard; dx++) {
        if (dx >= 0 && dy >= 0 && dx < ww && dy < dd) continue
        const o = ((((cy + dy) & NM) << NSHIFT) | ((cx + dx) & NM))
        const m = matMap[o]
        const ring = Math.max(dx < 0 ? -dx : dx >= ww ? dx - ww + 1 : 0, dy < 0 ? -dy : dy >= dd ? dy - dd + 1 : 0)
        if (isTree(m)) {
          heightMap[o] = minH
          matMap[o] = 6
        }
        if (matMap[o] < 6 || matMap[o] > 8) continue
        if (ring === 1) {
          matMap[o] = ((dx + dy) & 1) ? 4 : 5
          heightMap[o] = minH
        } else if (villa && ring === yard) {
          // the balustrade, with a gap for the gate in the middle of each side
          const mid = dy < 0 || dy >= dd ? Math.abs(dx - (ww >> 1)) <= 1 : Math.abs(dy - (dd >> 1)) <= 1
          heightMap[o] = minH + (mid ? 0 : 1)
          matMap[o] = mid ? 4 : 35
        } else if (villa) {
          heightMap[o] = minH
          garden.push(o)
        }
      }
    }
    // the house: walls round the edge (stone at the corners, the portal in the middle of one long side,
    // windows every other cell counted from the middle of each side, so the portal stands where a window
    // would and has plain wall either side, and never in the cell beside a corner), the hip roof inside
    const front = (id & 1) === 0 ? 0 : 1 // which long side has the door
    const portal = M_PORTAL[tint]
    for (let dy = 0; dy < dd; dy++) {
      for (let dx = 0; dx < ww; dx++) {
        const o = ((((cy + dy) & NM) << NSHIFT) | ((cx + dx) & NM))
        const dW = dx
        const dE = ww - 1 - dx
        const dN = dy
        const dS = dd - 1 - dy
        const near = Math.min(dW, dE, dN, dS)
        if (near === 0) {
          const corner = (dW === 0 || dE === 0) && (dN === 0 || dS === 0)
          const ns = dN === 0 || dS === 0
          const along = ns ? dx : dy
          const len = ns ? ww : dd
          const onFront = ww >= dd ? (front ? dS === 0 : dN === 0) : (front ? dE === 0 : dW === 0)
          heightMap[o] = top
          if (corner) matMap[o] = M_HSTONE
          else if (onFront && along === len >> 1) matMap[o] = portal
          else matMap[o] = ((along - (len >> 1)) & 1) === 0 && along >= 2 && along <= len - 3 ? win : wall
        } else {
          heightMap[o] = top + 1 + Math.floor((near - 1) * 0.55)
          const ties = (dW === near ? 1 : 0) + (dE === near ? 1 : 0) + (dN === near ? 1 : 0) + (dS === near ? 1 : 0)
          // the slopes facing the sun (west and north) are lighter; the hips between slopes are the mid tone
          matMap[o] = ties > 1 ? 20 : dW === near || dN === near ? 22 : 21
        }
        houseMap[o] = id
      }
    }
    // a bell tower at one corner of a villa: white walls, a pointed stone cap
    if (villa && rnd() < 0.45) {
      const tx = rnd() < 0.5 ? 0 : ww - 3
      const ty = rnd() < 0.5 ? 0 : dd - 3
      const tTop = top + 5
      for (let k = 0; k < 9; k++) {
        const ix = k % 3
        const iy = (k / 3) | 0
        const o = ((((cy + ty + iy) & NM) << NSHIFT) | ((cx + tx + ix) & NM))
        const centre = ix === 1 && iy === 1
        const side = ix === 1 || iy === 1
        heightMap[o] = tTop + (centre ? 2 : side ? 1 : 0)
        matMap[o] = side ? 33 : 32
      }
    }
    for (let dy = -yard; dy < dd + yard; dy++) {
      for (let dx = -yard; dx < ww + yard; dx++) parkMap[(((cy + dy) & NM) << NSHIFT) | ((cx + dx) & NM)] = 1
    }
    // cypresses standing tall in the garden, and a few round clipped bushes
    if (garden.length) {
      const nCyp = 2 + ((rnd() * 3) | 0)
      for (let i = 0; i < nCyp; i++) {
        const o = garden[(rnd() * garden.length) | 0]
        matMap[o] = 34
        heightMap[o] = minH + 7 + ((rnd() * 4) | 0)
      }
      const nTop = 1 + ((rnd() * 3) | 0)
      for (let i = 0; i < nTop; i++) {
        const o = garden[(rnd() * garden.length) | 0]
        if (matMap[o] === 34) continue
        // a small clipped dome: the middle highest
        const ox = o & NM
        const oy = o >> NSHIFT
        for (let k = 0; k < 5; k++) {
          const nx = (ox + (k === 1 ? 1 : k === 2 ? -1 : 0)) & NM
          const ny = (oy + (k === 3 ? 1 : k === 4 ? -1 : 0)) & NM
          const no = (ny << NSHIFT) | nx
          if (k > 0 && (houseMap[no] || matMap[no] < 6 || matMap[no] > 8)) continue
          matMap[no] = 36
          heightMap[no] = minH + (k === 0 ? 3 : 2)
        }
      }
      // flowers along the garden ring, here and there
      for (const o of garden) {
        if (matMap[o] < 6 || matMap[o] > 8) continue
        if (hash8(o * 7 + 3) > 37) continue
        matMap[o] = flowerAt(rnd())
        heightMap[o] = minH + 1
      }
      if (stampGarden(cx, cy, ww, dd, yard, minH, rnd)) gardenN++
    }
    houses.push({ x: cx, y: cy, w: ww, d: dd, base: minH, alive: true })
    return true
  }

  // A villa's formal garden, out past the balustrade on one side of the house, after the Italian villa
  // gardens. It is open: no hedge runs round it, the balustrade opens onto it with an urn on a post at
  // each end, and the walk from the gate runs down its middle. Three layouts:
  // 0 parterre: four box-edged beds of flowers round a round fountain, topiary cones at their outer
  //   corners, benches at the ends of the cross walk, a statue closing the axis
  // 1 canal: a long stone-rimmed pool on the axis with a fountain at the far end and urns at its
  //   corners, gravel walks either side with benches, flower borders, an allée of cypresses, a statue
  // 2 knot garden: four square beds of clipped box drawn in an X or a cross with flowers between,
  //   a statue in the middle where the walks cross, benches at the ends of the cross walk
  // It goes on the first side, in random order, where the ground is open grass or trees, free of other
  // houses and gardens and within a terrace or so of the house's floor; the ground is levelled to it.
  const G_LAWN = 0, G_WALK = 1, G_HEDGE = 2, G_RIM = 3, G_WATER = 4, G_SPOUT = 5, G_STATUE = 6
  const G_FLOWER = 7, G_CONE = 8, G_CYPRESS = 9, G_URN = 10
  const GARDEN_DEPTHS = [[13, 11], [12, 10, 8], [13, 11]]
  // Lays out a garden hw either side of the axis (a = −hw..hw) and D deep (v = 0 at the balustrade).
  // set(a, v, code) paints a cell; prop(a, v, kind, da, dv) stands a prop on one, facing along (da, dv).
  function planGarden(pat, hw, D, set, prop, rnd) {
    const fill = (c) => { for (let v = 0; v < D; v++) for (let a = -hw; a <= hw; a++) set(a, v, c) }
    const statue = () => (rnd() < 0.5 ? 0 : 1)
    if (pat === 0) {
      const n = (D - 5) >> 1 // rows in a bed: a walk, n rows of beds, the cross walk, n rows, a walk
      const vC = n + 2
      fill(G_WALK)
      for (const sv of [-1, 1]) {
        for (const sa of [-1, 1]) {
          const a1 = hw - 1
          const v0 = sv < 0 ? 1 : vC + 2
          const v1 = v0 + n - 1
          for (let v = v0; v <= v1; v++) {
            for (let a = 2; a <= a1; a++) set(sa * a, v, v === v0 || v === v1 || a === 2 || a === a1 ? G_HEDGE : G_FLOWER)
          }
          set(sa * a1, sv < 0 ? v0 : v1, G_CONE)
        }
      }
      // the fountain on the crossing: water in a stone rim, gravel round it cutting the beds' corners
      for (let v = 0; v < D; v++) {
        for (let a = -hw; a <= hw; a++) {
          const d = Math.hypot(a, v - vC)
          if (d < 0.5) set(a, v, G_SPOUT)
          else if (d < 1.5) set(a, v, G_WATER)
          else if (d < 2.5) set(a, v, G_RIM)
          else if (d < 3.2) set(a, v, G_WALK)
        }
      }
      set(-2, 0, G_CONE)
      set(2, 0, G_CONE)
      prop(0, D - 1, statue(), 0, -1)
      prop(-hw, vC, P_BENCH, 1, 0)
      prop(hw, vC, P_BENCH, -1, 0)
    } else if (pat === 1) {
      for (let v = 0; v < D; v++) {
        for (let a = -hw; a <= hw; a++) {
          const x = Math.abs(a)
          let c = G_LAWN
          if ((v <= 1 || v === D - 1) && x <= 4) c = G_WALK // the forecourt, and the walk across the end
          else if (x <= 2 && v <= D - 2) c = x === 2 || v === 2 || v === D - 2 ? G_RIM : G_WATER
          else if (x === 3 || x === 4) c = G_WALK
          else if (x === 5 && v >= 1 && v <= D - 2) c = G_FLOWER
          else if (x === 6 && v % 3 === 1 && v <= D - 2) c = G_CYPRESS
          set(a, v, c)
        }
      }
      set(0, D - 4, G_SPOUT)
      for (const v of [2, D - 2]) for (const a of [-2, 2]) prop(a, v, P_URN, 0, 1)
      prop(0, D - 1, statue(), 0, -1)
      for (const v of D >= 10 ? [Math.round(D / 3), Math.round((2 * D) / 3)] : [D >> 1]) {
        prop(-4, v, P_BENCH, 1, 0)
        prop(4, v, P_BENCH, -1, 0)
      }
    } else {
      const S = (D - 3) >> 1 // the beds' side: S rows of beds, the cross walk, S rows
      const vC = S + 1
      fill(G_WALK)
      for (let v = 0; v < D; v++) {
        for (let a = -hw; a <= hw; a++) {
          if (Math.abs(a) > S + 2) set(a, v, (hash8(v * 31 + a * 7 + 5) & 7) === 0 ? G_FLOWER : G_LAWN)
        }
      }
      for (const sv of [-1, 1]) {
        for (const sa of [-1, 1]) {
          const v0 = sv < 0 ? 0 : vC + 2
          const cross = sv !== sa // an X in two opposite beds, a cross in the other two
          for (let i = 0; i < S; i++) {
            for (let j = 0; j < S; j++) {
              const edge = i === 0 || j === 0 || i === S - 1 || j === S - 1
              let c = edge ? G_HEDGE : G_FLOWER
              if (!edge && S >= 5 && (cross ? i === 2 || j === 2 : Math.abs(i - 2) === Math.abs(j - 2))) c = G_HEDGE
              set(sa * (2 + i), v0 + j, c)
            }
          }
          set(sa * (S + 1), sv < 0 ? 0 : D - 1, G_CONE)
        }
      }
      for (const [a, v] of [[-1, vC - 1], [1, vC - 1], [-1, vC + 1], [1, vC + 1]]) set(a, v, G_FLOWER)
      prop(0, vC, statue(), 0, -1)
      prop(-(S + 2), vC, P_BENCH, 1, 0)
      prop(S + 2, vC, P_BENCH, -1, 0)
    }
  }

  function stampGarden(cx, cy, ww, dd, yard, base, rnd) {
    const sides = [0, 1, 2, 3]
    for (let i = 3; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0
      const t = sides[i]
      sides[i] = sides[j]
      sides[j] = t
    }
    const first = (rnd() * 3) | 0
    for (let k = 0; k < 3; k++) {
      const pat = (first + k) % 3
      for (const side of sides) {
        // u runs along the side (0 at the house's corner), v outward from the balustrade (−1)
        const L = side < 2 ? ww : dd
        const uA = L >> 1 // the gate's axis
        const hw = uA + yard - ((L & 1) ? 0 : 1) // so the garden is symmetric about the axis
        const cellU = (u, v) => {
          let dx = u
          let dy = u
          if (side === 0) dy = -yard - 1 - v
          else if (side === 1) dy = dd + yard + v
          else if (side === 2) dx = -yard - 1 - v
          else dx = ww + yard + v
          return (((cy + dy) & NM) << NSHIFT) | ((cx + dx) & NM)
        }
        const cell = (a, v) => cellU(uA + a, v)
        for (const D of GARDEN_DEPTHS[pat]) {
          let ok = true
          for (let v = 0; v < D && ok; v++) {
            for (let a = -hw; a <= hw; a++) {
              const o = cell(a, v)
              const m = matMap[o]
              if (houseMap[o] || parkMap[o] || !((m >= 6 && m <= 8) || isTree(m)) || Math.abs(floorMap[o] - base) > 4) {
                ok = false
                break
              }
            }
          }
          if (!ok) continue
          const nA = 2 * hw + 1
          const plan = new Uint8Array(nA * D)
          const marks = []
          const set = (a, v, c) => {
            if (a >= -hw && a <= hw && v >= 0 && v < D) plan[v * nA + a + hw] = c
          }
          const prop = (a, v, kind, da, dv) => {
            marks.push([a, v, kind, da, dv])
            if (kind === P_URN) set(a, v, G_URN)
            else if (kind !== P_BENCH) set(a, v, G_STATUE)
          }
          planGarden(pat, hw, D, set, prop, rnd)
          // the garden's axes in the world, for the props' headings
          const uX = side < 2 ? 1 : 0
          const uY = side < 2 ? 0 : 1
          const vX = side === 2 ? -1 : side === 3 ? 1 : 0
          const vY = side === 0 ? -1 : side === 1 ? 1 : 0
          let spout = -1
          for (let v = 0; v < D; v++) {
            for (let a = -hw; a <= hw; a++) {
              const o = cell(a, v)
              const c = plan[v * nA + a + hw]
              let m = M_LAWN
              let h = base
              let floor = -1
              if (c === G_WALK) m = ((a + v) & 1) ? 4 : 5
              else if (c === G_HEDGE) { m = M_HEDGE; h = base + 1 }
              else if (c === G_RIM) { m = M_STONE; h = base + 1 }
              else if (c === G_WATER) m = M_POOL
              else if (c === G_SPOUT) { m = M_PLINTH; h = base + 2; spout = o }
              else if (c === G_STATUE) { m = M_PLINTH; h = base + 1 }
              else if (c === G_FLOWER) { m = flowerAt(rnd()); h = base + 1 }
              else if (c === G_CONE) { m = 36; h = base + 3 }
              else if (c === G_CYPRESS) { m = 34; h = base + 7 + ((rnd() * 3) | 0); floor = base }
              else if (c === G_URN) { m = M_PLINTH; h = base + 2 }
              matMap[o] = m
              heightMap[o] = h
              floorMap[o] = floor < 0 ? h : floor
              parkMap[o] = 2
            }
          }
          const standOn = (o, kind) => {
            const x = (o & NM) + 0.5
            const y = (o >> NSHIFT) + 0.5
            return { x, y, z: heightMap[o] }
          }
          for (const [a, v, kind, da, dv] of marks) {
            const at = standOn(cell(a, v), kind)
            const dx = da * uX + dv * vX
            const dy = da * uY + dv * vY
            props.push({ kind, x: at.x, y: at.y, z: at.z, yaw: Math.atan2(dx, -dy), alive: true })
          }
          if (spout >= 0) fountains.push({ x: (spout & NM) + 0.5, y: (spout >> NSHIFT) + 0.5, z: base + 2, alive: true })
          // open the balustrade onto the garden: gravel, and an urn on a post at each end
          for (let u = -yard; u < L + yard; u++) {
            const o = cellU(u, -1)
            if (u === -yard || u === L + yard - 1) {
              matMap[o] = M_PLINTH
              heightMap[o] = base + 2
              floorMap[o] = base + 2
              props.push({ kind: P_URN, x: (o & NM) + 0.5, y: (o >> NSHIFT) + 0.5, z: base + 2, yaw: 0, alive: true })
            } else {
              matMap[o] = ((u + 1) & 1) ? 4 : 5
              heightMap[o] = base
              floorMap[o] = base
            }
          }
          return true
        }
      }
    }
    return false
  }

  function placeHouses(rnd) {
    houses.length = 0
    props.length = 0
    fountains.length = 0
    gardenN = 0
    houseMap.fill(0)
    parkMap.fill(0)
    const tryVillage = (vx, vy, n) => {
      let placed = 0
      for (let i = 0; i < n * 14 && placed < n; i++) {
        const ox = ((rnd() - 0.5) * 62) | 0
        const oy = ((rnd() - 0.5) * 62) | 0
        if (stampHouse((vx + ox) & NM, (vy + oy) & NM, rnd() > 0.5 ? 1 : 0, rnd)) placed++
      }
      return placed
    }
    // first along the coast the jet starts beside, so there is something to bomb at once
    for (let k = 0; k < 14; k++) {
      const ang = rnd() * Math.PI * 2
      const dist = 40 + rnd() * 220
      tryVillage((spawnX + Math.cos(ang) * dist) | 0, (spawnY + Math.sin(ang) * dist) | 0, 3 + ((rnd() * 4) | 0))
    }
    for (let k = 0; k < 95; k++) {
      const x = (rnd() * N) | 0
      const y = (rnd() * N) | 0
      const m = matMap[(y << NSHIFT) | x]
      if (m < 6 || m > 8) continue
      let water = 0
      for (let a = 0; a < 6; a++) {
        const xx = (x + Math.cos(a * 1.05) * 36) & NM
        const yy = (y + Math.sin(a * 1.05) * 36) & NM
        if (matMap[(yy << NSHIFT) | xx] < 4) water++
      }
      if (water < 1 && rnd() > 0.45) continue
      tryVillage(x, y, 2 + ((rnd() * 5) | 0))
    }
  }

  const matAt = (x, y) => matMap[(((y | 0) & NM) << NSHIFT) | ((x | 0) & NM)]

  const docks = []
  const bigIsle = []
  let speckN = 0
  let windYaw = 0.6

  function windAlong(yaw) {
    // 1 with the wind, −1 into it. Heading and wind share the jet's forward axis.
    return Math.sin(yaw) * Math.sin(windYaw) + Math.cos(yaw) * Math.cos(windYaw)
  }

  function placeDocks() {
    docks.length = 0
    boats.length = 0
    bigIsle.length = 0
    speckN = 0
    aboard = -1
    loungeReset()
    smallIsle.fill(0)
    windYaw = ((p.seed * 2.399) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
    const sea = new Uint8Array(N * N)
    const seen = new Uint8Array(N * N)
    const stack = new Int32Array(N * N)
    const dirs = [1, 0, -1, 0, 0, 1, 0, -1]
    // The ocean is the largest connected body of water. Lakes and ponds inside
    // an island are smaller, and they never get a dock.
    let seed = -1
    let best = 0
    for (let y = 0; y < N; y++) {
      const row = y << NSHIFT
      for (let x = 0; x < N; x++) {
        const start = row | x
        if (seen[start] || matMap[start] >= 4) continue
        let sp = 0
        let count = 0
        stack[sp++] = start
        seen[start] = 1
        while (sp > 0) {
          const o = stack[--sp]
          count++
          const cx = o & NM
          const cy = o >> NSHIFT
          for (let k = 0; k < 8; k += 2) {
            const no = (((cy + dirs[k + 1]) & NM) << NSHIFT) | ((cx + dirs[k]) & NM)
            if (seen[no] || matMap[no] >= 4) continue
            seen[no] = 1
            stack[sp++] = no
          }
        }
        if (count > best) { best = count; seed = start }
      }
    }
    if (seed >= 0) {
      let sp = 0
      stack[sp++] = seed
      sea[seed] = 1
      while (sp > 0) {
        const o = stack[--sp]
        const cx = o & NM
        const cy = o >> NSHIFT
        for (let k = 0; k < 8; k += 2) {
          const no = (((cy + dirs[k + 1]) & NM) << NSHIFT) | ((cx + dirs[k]) & NM)
          if (sea[no] || matMap[no] >= 4) continue
          sea[no] = 1
          stack[sp++] = no
        }
      }
    }
    seen.fill(0)
    const seaAt = (x, y) => sea[(((y | 0) & NM) << NSHIFT) | ((x | 0) & NM)] === 1
    // Average direction toward nearby ocean. A weak result means a cove, a point,
    // or water on several sides, so the pier would not sit square to the beach.
    const outward = (x, y) => {
      let wx = 0
      let wy = 0
      let n = 0
      for (let a = 0; a < 16; a++) {
        const ang = a * (Math.PI / 8)
        const sx = Math.cos(ang)
        const sy = Math.sin(ang)
        for (let r = 3; r <= 12; r += 3) {
          const xx = x + sx * r
          const yy = y + sy * r
          if (matAt(xx, yy) < 4 && seaAt(xx, yy)) { wx += sx; wy += sy; n++ }
        }
      }
      const len = Math.hypot(wx, wy)
      if (n < 6 || len < 2.4) return null
      return { dx: wx / len, dy: wy / len }
    }
    // Straight out must be open ocean, and wide, so a creek or a lagoon mouth is skipped.
    const openSea = (x, y, dx, dy) => {
      const px = -dy
      const py = dx
      for (let t = 3; t <= 18; t++) {
        if (matAt(x + dx * t, y + dy * t) >= 4 || !seaAt(x + dx * t, y + dy * t)) return false
      }
      const tx = x + dx * 12
      const ty = y + dy * 12
      let side = 0
      for (let s = 2; s <= 8; s += 2) {
        if (matAt(tx + px * s, ty + py * s) < 4 && seaAt(tx + px * s, ty + py * s)) side++
        if (matAt(tx - px * s, ty - py * s) < 4 && seaAt(tx - px * s, ty - py * s)) side++
      }
      return side >= 5
    }
    const shores = []
    const consider = (x, y, dx, dy) => {
      for (const s of shores) {
        const ddx = x - s.x
        const ddy = y - s.y
        const wrapped = Math.min(ddx * ddx, (ddx - N) * (ddx - N), (ddx + N) * (ddx + N))
          + Math.min(ddy * ddy, (ddy - N) * (ddy - N), (ddy + N) * (ddy + N))
        if (wrapped < 340 * 340) return
      }
      if (shores.length < 5) shores.push({ x, y, dx, dy })
    }
    const stamp = (sx, sy, dx, dy) => {
      const px = -dy
      const py = dx
      for (let i = -2; i <= 11; i += 0.5) {
        for (let s = -1.15; s <= 1.15; s += 0.55) {
          const x = Math.round(sx + dx * i + px * s) & NM
          const y = Math.round(sy + dy * i + py * s) & NM
          const o = (y << NSHIFT) | x
          const m = matMap[o]
          const dock = m === 25 || m === 26
          if (houseMap[o] || isTrunk(m) || m >= 32 || isBuilt(m)) continue
          if (i > 2.5 && m >= 4 && !dock) continue
          matMap[o] = ((Math.round(i * 2) + Math.round(s * 2)) & 1) ? 25 : 26
          if (m < 4 || dock) {
            heightMap[o] = 1
            floorMap[o] = 1
          } else if (heightMap[o] < 1) heightMap[o] = 1
        }
      }
      const yaw = Math.atan2(dx, -dy)
      // a sloop lies alongside the outer end of the pier, bow out to sea, on whichever side is open water;
      // failing that, just past the end
      const fits = (x, y) => {
        for (let k = -5; k <= 5; k += 2.5) if (matAt(x + dx * k, y + dy * k) >= 4) return false
        return seaAt(x, y)
      }
      let bx = 0
      let by = 0
      let found = false
      for (const side of [1, -1]) {
        const x = sx + dx * 8.6 + px * side * 3.2
        const y = sy + dy * 8.6 + py * side * 3.2
        if (fits(x, y)) { bx = x; by = y; found = true; break }
      }
      if (!found) {
        bx = sx + dx * 16
        by = sy + dy * 16
        if (matAt(bx, by) >= 4 || !seaAt(bx, by)) return
      }
      boats.push(makeBoat(wrapPos(bx), wrapPos(by), yaw, 0, HULL_PICK[(boats.length * 7 + 3) % HULL_PICK.length], true, 7, boats.length * 0.7))
      docks.push({ bx: wrapPos(bx), by: wrapPos(by), yaw })
    }
    for (let y = 0; y < N; y++) {
      const row = y << NSHIFT
      for (let x = 0; x < N; x++) {
        const start = row | x
        if (seen[start] || matMap[start] < 4) continue
        let sp = 0
        let count = 0
        const saved = []
        shores.length = 0
        stack[sp++] = start
        seen[start] = 1
        while (sp > 0) {
          const o = stack[--sp]
          count++
          if (saved.length < 2000) saved.push(o)
          const cx = o & NM
          const cy = o >> NSHIFT
          const m = matMap[o]
          for (let k = 0; k < 8; k += 2) {
            const nx = (cx + dirs[k]) & NM
            const ny = (cy + dirs[k + 1]) & NM
            const no = (ny << NSHIFT) | nx
            if (matMap[no] >= 4) {
              if (!seen[no]) { seen[no] = 1; stack[sp++] = no }
            } else if (m <= 8 && sea[no] && (count & 31) === 0) {
              const nrm = outward(cx, cy)
              if (nrm && openSea(cx, cy, nrm.dx, nrm.dy)) consider(cx, cy, nrm.dx, nrm.dy)
            }
          }
        }
        // A pier is about 11 cells long. Below this, the island is a speck and the dock is the whole shore.
        // Mark only the cells of this island. A later pier must not leak the mark onto a larger one.
        if (count < 2000) {
          speckN++
          for (let i = 0; i < saved.length; i++) smallIsle[saved[i]] = 1
          continue
        }
        bigIsle.push({ x: start & NM, y: start >> NSHIFT })
        for (const s of shores) stamp(s.x, s.y, s.dx, s.dy)
      }
    }
  }

  // Lakeside belvederes: by some of the houses near the water, a paved terrace at the shore with a
  // balustrade along the water, a marble statue on a pedestal in its middle and an urn on a post at each
  // end, two benches facing the view and flowers at the back. A paved promenade runs on from each end
  // along the shore, two cells in from the water, with a bench now and then and flowers on the land
  // side, and a gravel path leads up from the terrace to the house.
  const views = [] // { x, y, ex, ey }: the shore cell in the middle of each terrace, and the way out to the water
  const VIEW_R = 40
  const VIEW_W = VIEW_R * 2 + 1
  const viewDist = new Uint8Array(VIEW_W * VIEW_W)
  const viewSeen = new Uint8Array(VIEW_W * VIEW_W)
  const viewQ = new Int32Array(VIEW_W * VIEW_W)
  const viewDepth = new Uint8Array(VIEW_W * VIEW_W)
  function placeViewpoints(rnd) {
    views.length = 0
    const order = houses.map((_, i) => i)
    for (let i = order.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0
      const t = order[i]
      order[i] = order[j]
      order[j] = t
    }
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    for (const hi of order) {
      if (views.length >= 16) break
      const h = houses[hi]
      const hx = (h.x + (h.w >> 1)) | 0
      const hy = (h.y + (h.d >> 1)) | 0
      const first = (rnd() * 4) | 0
      let done = false
      for (let k = 0; k < 4 && !done; k++) {
        const [ex, ey] = dirs[(first + k) & 3]
        // the first water out from the house this way
        let r = 4
        while (r < 44 && matAt(hx + ex * r, hy + ey * r) >= 4) r++
        if (r >= 44) continue
        // then along the shore a little either way, for a straight piece of it
        for (const slide of [0, 6, -6, 12, -12]) {
          const bx = hx + ex * (r - 8) - ey * slide
          const by = hy + ey * (r - 8) + ex * slide
          let j = 0
          while (j < 16 && matAt(bx + ex * j, by + ey * j) >= 4) j++
          if (j === 0 || j >= 16) continue
          if (stampBelvedere((bx + ex * (j - 1)) & NM, (by + ey * (j - 1)) & NM, ex, ey, hx, hy, rnd)) {
            done = true
            break
          }
        }
      }
    }
  }

  // (sx, sy) is the last land before the water, out along (ex, ey); t runs along the shore, n out to the water
  function stampBelvedere(sx, sy, ex, ey, hx, hy, rnd) {
    const tx = -ey
    const ty = ex
    const at = (t, n) => ((((sy + ty * t + ey * n) & NM) << NSHIFT) | ((sx + tx * t + ex * n) & NM))
    for (const v of views) if (wrapDelta(v.x, sx) ** 2 + wrapDelta(v.y, sy) ** 2 < 120 * 120) return false
    for (const d of docks) if (wrapDelta(d.bx, sx) ** 2 + wrapDelta(d.by, sy) ** 2 < 36 * 36) return false
    // open water in front, for the view
    for (let n = 2; n <= 12; n++) if (matMap[at(0, n)] >= 4) return false
    for (const t of [-4, 4]) for (let n = 2; n <= 6; n++) if (matMap[at(t, n)] >= 4) return false
    // a straight enough shore, free land behind, no cliff
    const th = Math.max(2, floorMap[at(0, 0)])
    for (let t = -4; t <= 4; t++) {
      for (let n = -4; n <= 1; n++) {
        const o = at(t, n)
        const m = matMap[o]
        if (houseMap[o] || parkMap[o] || isBuilt(m) || m === 25 || m === 26 || m === 34) return false
        if (n <= -2 && m < 4) return false
        if (m >= 4 && floorMap[o] > th + 4) return false
      }
    }
    // how far each cell round about is from the water, before the terrace fills some of it in
    const ox = sx - VIEW_R
    const oy = sy - VIEW_R
    const wo = (i, j) => ((((oy + j) & NM) << NSHIFT) | ((ox + i) & NM))
    viewDist.fill(255)
    let qh = 0
    let qt = 0
    for (let j = 0; j < VIEW_W; j++) {
      for (let i = 0; i < VIEW_W; i++) {
        if (matMap[wo(i, j)] < 4) { viewDist[j * VIEW_W + i] = 0; viewQ[qt++] = j * VIEW_W + i }
      }
    }
    while (qh < qt) {
      const q = viewQ[qh++]
      const d = viewDist[q]
      if (d >= 5) continue
      const i = q % VIEW_W
      const j = (q / VIEW_W) | 0
      for (let k = 0; k < 4; k++) {
        const ni = i + (k === 0 ? 1 : k === 1 ? -1 : 0)
        const nj = j + (k === 2 ? 1 : k === 3 ? -1 : 0)
        if (ni < 0 || nj < 0 || ni >= VIEW_W || nj >= VIEW_W) continue
        const nq = nj * VIEW_W + ni
        if (viewDist[nq] !== 255) continue
        viewDist[nq] = d + 1
        viewQ[qt++] = nq
      }
    }
    const main = flowerAt(rnd())
    const bloom = () => (rnd() < 0.75 ? main : flowerAt(rnd()))
    // the terrace
    for (let t = -3; t <= 3; t++) {
      for (let n = -3; n <= 1; n++) {
        const o = at(t, n)
        let m = M_PAVE[(t + n) & 1]
        let h = th
        if (n === 1) {
          m = t === 0 || t === -3 || t === 3 ? M_PLINTH : 35 // the balustrade, with the pedestal and the posts
          h = m === M_PLINTH ? th + 2 : th + 1
        } else if (n === -3 && Math.abs(t) >= 2) {
          m = bloom()
          h = th + 1
        }
        matMap[o] = m
        heightMap[o] = h
        floorMap[o] = h
        parkMap[o] = 3
      }
    }
    const put = (o, kind, z, dx, dy) => props.push({ kind, x: (o & NM) + 0.5, y: (o >> NSHIFT) + 0.5, z, yaw: Math.atan2(dx, -dy), alive: true })
    put(at(0, 1), rnd() < 0.5 ? 0 : 1, th + 2, -ex, -ey) // the statue looks back over the terrace
    put(at(-3, 1), P_URN, th + 2, ex, ey)
    put(at(3, 1), P_URN, th + 2, ex, ey)
    put(at(-2, -1), P_BENCH, th, ex, ey)
    put(at(2, -1), P_BENCH, th, ex, ey)
    const benches = [[wrapPos(sx - tx * 2), wrapPos(sy - ty * 2)], [wrapPos(sx + tx * 2), wrapPos(sy + ty * 2)]]
    // the promenade: the band two and three cells in from the water, followed from each end of the terrace
    const reach = 22 + ((rnd() * 18) | 0)
    viewSeen.fill(0)
    qh = 0
    qt = 0
    const band = (q) => {
      const d = viewDist[q]
      if (d < 2 || d > 3) return false
      const o = wo(q % VIEW_W, (q / VIEW_W) | 0)
      const m = matMap[o]
      return m >= 4 && !houseMap[o] && !parkMap[o] && !isBuilt(m) && m !== 25 && m !== 26 && !isTrunk(m) && m !== 34
    }
    for (const t of [-4, 4]) {
      for (const n of [-1, -2]) {
        const i = wrapDelta(sx + tx * t + ex * n, ox) | 0
        const j = wrapDelta(sy + ty * t + ey * n, oy) | 0
        const q = j * VIEW_W + i
        if (i < 0 || j < 0 || i >= VIEW_W || j >= VIEW_W || viewSeen[q] || !band(q)) continue
        viewSeen[q] = 1
        viewDepth[q] = 0
        viewQ[qt++] = q
      }
    }
    while (qh < qt) {
      const q = viewQ[qh++]
      const i = q % VIEW_W
      const j = (q / VIEW_W) | 0
      if (viewDepth[q] >= reach) continue
      for (let k = 0; k < 4; k++) {
        const ni = i + (k === 0 ? 1 : k === 1 ? -1 : 0)
        const nj = j + (k === 2 ? 1 : k === 3 ? -1 : 0)
        if (ni < 1 || nj < 1 || ni >= VIEW_W - 1 || nj >= VIEW_W - 1) continue
        const nq = nj * VIEW_W + ni
        if (viewSeen[nq] || !band(nq)) continue
        viewSeen[nq] = 1
        viewDepth[nq] = viewDepth[q] + 1
        viewQ[qt++] = nq
      }
    }
    const pathN = qt
    for (let p = 0; p < pathN; p++) {
      const q = viewQ[p]
      const o = wo(q % VIEW_W, (q / VIEW_W) | 0)
      const h = Math.max(1, floorMap[o])
      matMap[o] = M_PAVE[(q + ((q / VIEW_W) | 0)) & 1]
      heightMap[o] = h
      floorMap[o] = h
      parkMap[o] = 3
    }
    for (let p = 0; p < pathN; p++) {
      const q = viewQ[p]
      if (viewDist[q] !== 3) continue
      const i = q % VIEW_W
      const j = (q / VIEW_W) | 0
      // flowers on the land side
      for (let k = 0; k < 4; k++) {
        const ni = i + (k === 0 ? 1 : k === 1 ? -1 : 0)
        const nj = j + (k === 2 ? 1 : k === 3 ? -1 : 0)
        const nq = nj * VIEW_W + ni
        if (viewDist[nq] !== 4 || rnd() > 0.2) continue
        const o = wo(ni, nj)
        const m = matMap[o]
        if (m < 6 || m > 8 || parkMap[o] || houseMap[o]) continue
        matMap[o] = bloom()
        heightMap[o] = floorMap[o] + 1
        parkMap[o] = 3
      }
      // a bench on a straight stretch, facing the water, well apart from the others
      let fx = 0
      let fy = 0
      for (let k = 0; k < 4; k++) {
        const di = k === 0 ? 1 : k === 1 ? -1 : 0
        const dj = k === 2 ? 1 : k === 3 ? -1 : 0
        if (viewDist[(j + dj) * VIEW_W + i + di] === 2 && viewSeen[(j + dj) * VIEW_W + i + di]) { fx = di; fy = dj }
      }
      if (fx === 0 && fy === 0) continue
      const s1 = (j + fx) * VIEW_W + i - fy
      const s2 = (j - fx) * VIEW_W + i + fy
      if (!viewSeen[s1] || !viewSeen[s2] || viewDist[s1] !== 3 || viewDist[s2] !== 3) continue
      const o = wo(i, j)
      const bx = (o & NM) + 0.5
      const by = (o >> NSHIFT) + 0.5
      if (benches.some(([x, y]) => wrapDelta(x, bx) ** 2 + wrapDelta(y, by) ** 2 < 10 * 10)) continue
      benches.push([bx, by])
      props.push({ kind: P_BENCH, x: bx, y: by, z: heightMap[o], yaw: Math.atan2(fx, -fy), alive: true })
    }
    // a gravel path up to the house, until it meets the yard
    let x = sx - ex * 4
    let y = sy - ey * 4
    let lastH = th
    for (let step = 0; step < 60; step++) {
      const o = (((y & NM) << NSHIFT) | (x & NM))
      if (houseMap[o] || parkMap[o] === 1 || parkMap[o] === 2) break
      const m = matMap[o]
      if (parkMap[o] !== 3) {
        if (m < 4 || isBuilt(m) || m === 25 || m === 26 || m === 34 || Math.abs(floorMap[o] - lastH) > 4) break
        matMap[o] = ((x + y) & 1) ? 4 : 5
        heightMap[o] = floorMap[o]
        parkMap[o] = 3
      }
      lastH = floorMap[o]
      const dx = wrapDelta(hx, x)
      const dy = wrapDelta(hy, y)
      if (dx === 0 && dy === 0) break
      if (Math.abs(dx) > Math.abs(dy) || (Math.abs(dx) === Math.abs(dy) && (step & 1))) x += Math.sign(dx)
      else y += Math.sign(dy)
    }
    views.push({ x: sx, y: sy, ex, ey })
    return true
  }

  // Wildflowers: little patches of yellow and white over the open grass of the whole map, thick in
  // some meadows and sparse in others, and half as many away from the houses. A patch is mostly one colour.
  const NEAR_SHIFT = 4 // the near-a-house grid is in squares of 16 cells
  const NEAR_N = N >> NEAR_SHIFT
  const nearHouse = new Uint8Array(NEAR_N * NEAR_N)
  // The chapel and the temple each stand square to the map; (a, f) are across and forward of the middle
  // cell (cx, cy), forward being the way the door or the niche faces (yaw).
  const turned = (cx, cy, yaw) => {
    const c = Math.round(Math.cos(yaw))
    const s = Math.round(Math.sin(yaw))
    return (a, f) => (((cy + a * s - f * c) & NM) << NSHIFT) | ((cx + a * c + f * s) & NM)
  }
  /** grass, trees or wild flowers that nothing has taken yet */
  const openLand = (o) => {
    const m = matMap[o]
    return !houseMap[o] && !parkMap[o] && ((m >= 6 && m <= 8) || isTree(m) || BLOOM[m] === 1)
  }
  const mid = (h) => [h.x + h.w / 2, h.y + h.d / 2]
  const isVilla = (h) => h.w * h.d >= 180 // a townhouse is at most 11 by 13, a villa at least 14 by 15
  /** the way from (cx, cy) to the middle of a house, as the nearest of the four map directions */
  const facing = (cx, cy, hx, hy) => {
    const dx = wrapDelta(hx, cx + 0.5)
    const dy = wrapDelta(hy, cy + 0.5)
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : dy > 0 ? Math.PI : 0
  }
  /** a front facing −x or −y is turned to the sun (see voxBegin's light), and is worth this much more */
  const sunward = (yaw) => (Math.sin(yaw) < -0.5 || Math.cos(yaw) > 0.5 ? 5 : 0)
  /** a gravel path from (x, y) towards the middle of a house, until it meets its yard; how many cells it laid */
  function gravelPath(x, y, hx, hy, lastH, clear = 0) {
    let n = 0
    for (let step = 0; step < 90; step++) {
      const o = ((y & NM) << NSHIFT) | (x & NM)
      if (houseMap[o] || parkMap[o] === 1 || parkMap[o] === 2) break
      const m = matMap[o]
      if (parkMap[o] !== 3) {
        if (m < 4 || isBuilt(m) || m === 25 || m === 26 || m === 34 || parkMap[o] === 4 || Math.abs(floorMap[o] - lastH) > 4) break
        matMap[o] = (x + y) & 1 ? 4 : 5
        heightMap[o] = floorMap[o]
        parkMap[o] = 3
        n++
        // through a wood, the trees either side are cleared, so the way in is open
        for (let dy = -clear; dy <= clear; dy++) {
          for (let dx = -clear; dx <= clear; dx++) {
            const q = (((y + dy) & NM) << NSHIFT) | ((x + dx) & NM)
            if (!parkMap[q] && !houseMap[q] && isTree(matMap[q])) { heightMap[q] = floorMap[q]; matMap[q] = 6 }
          }
        }
      }
      lastH = floorMap[o]
      const dx = Math.round(wrapDelta(hx, x))
      const dy = Math.round(wrapDelta(hy, y))
      if (dx === 0 && dy === 0) break
      if (Math.abs(dx) > Math.abs(dy) || (Math.abs(dx) === Math.abs(dy) && step & 1)) x += Math.sign(dx)
      else y += Math.sign(dy)
    }
    return n
  }
  /** how much of the land within r of (cx, cy) is wood, from 0 to 1 */
  function woodAround(cx, cy, r) {
    let n = 0
    let t = 0
    for (let dy = -r; dy <= r; dy += 3) {
      for (let dx = -r; dx <= r; dx += 3) {
        if (dx * dx + dy * dy > r * r) continue
        const m = matMap[(((cy + dy) & NM) << NSHIFT) | ((cx + dx) & NM)]
        if (m < 4) continue
        n++
        if (isTree(m)) t++
      }
    }
    return n ? t / n : 0
  }
  /**
   * clears the trees round a garden, in cell(a, f): those within about m of the rectangle a0…a1, f0…f1,
   * with round corners and an edge that comes and goes, so it opens on to a clearing, not a cut
   */
  function clearRound(cell, a0, a1, f0, f1, m) {
    const am = (a0 + a1) / 2
    const fm = (f0 + f1) / 2
    for (let f = f0 - m - 4; f <= f1 + m + 4; f++) {
      for (let a = a0 - m - 4; a <= a1 + m + 4; a++) {
        const da = a < a0 ? a0 - a : a > a1 ? a - a1 : 0
        const df = f < f0 ? f0 - f : f > f1 ? f - f1 : 0
        const ang = Math.atan2(f - fm, a - am)
        if (Math.hypot(da, df) > m + 2.5 * Math.sin(ang * 3 + 1) + 1.5 * Math.sin(ang * 7 + 2)) continue
        const o = cell(a, f)
        if (!parkMap[o] && !houseMap[o] && isTree(matMap[o])) { heightMap[o] = floorMap[o]; matMap[o] = 6 }
      }
    }
  }
  const WOOD_R = 40 // how far round a site the chapel and the museum look at the wood …
  const WOOD_K = 40 // … and how much they mind it: all wood counts as much as four villas near the chapel
  const CLEARING = 14 // how far the trees are cleared round their gardens
  const PATH_CLEAR = 2 // and either side of their paths
  /** a monument's own cells: a stone floor nobody walks on, and how high it stands over each */
  function monumentCell(o, base, M, a, f) {
    heightMap[o] = floorMap[o] = base
    matMap[o] = 51
    parkMap[o] = 4
    monumentTop.set(o, base + Math.ceil(monumentHeight(M, a, f)))
  }

  // The chapel: one on the map, a short walk from a group of villas (its middle not closer than 24 to any
  // house, near as many villas as it can be, and near the start), its door towards the nearest of them
  // and, where it can be, to the sun.
  // It stands in a walled garden in the Italian manner: a low box hedge all round, a clipped lawn about
  // the chapel, and before its door a paved square and then a parterre down to the gate: gravel walks,
  // beds of lawn edged with box with a clipped cone in each, and a pair of long pools. A lamp at the
  // square's front corners and two by the gate, a cypress either side of it outside, and a gravel path
  // on to the villa's yard. The trees near the hedge are cleared. It takes nothing from the random
  // stream, so the rest of the map stays as it was.
  const GARDEN_A = 12 // the hedge runs 12 across from the chapel's middle …
  const GARDEN_B = -8 // … 8 behind it, and in front at the gate, as far as the garden's bands reach
  const CHAPEL_GARDENS = [
    { front: 30, bands: [['bed', 6], ['walk', 1], ['pool', 5], ['walk', 1], ['bed', 4]] },
    { front: 24, bands: [['bed', 5], ['walk', 1], ['pool', 5]] },
    { front: 19, bands: [['bed', 6]] },
  ]
  /** what is at (a, f) of the chapel's garden G */
  function chapelPlan(G, a, f) {
    const A = Math.abs(a)
    if (A === GARDEN_A || f === GARDEN_B || f === G.front) return f === G.front && A <= 1 ? 'walk' : 'hedge'
    if (A <= 5 && f >= -5 && f <= 6) return 'chapel'
    if (A <= 4 && f >= 7 && f <= CH_FORE) return 'square'
    // a walk inside the hedge all round, and one from the square to the gate
    if (A === GARDEN_A - 1 || f === GARDEN_B + 1 || f === G.front - 1 || (A <= 1 && f > CH_FORE)) return 'walk'
    if (f <= CH_FORE) return 'lawn'
    let f0 = Math.floor(CH_FORE) + 1
    for (const [kind, n] of G.bands) {
      if (f < f0 + n) {
        const edge = A === 2 || A === GARDEN_A - 2 || f === f0 || f === f0 + n - 1
        if (kind === 'walk') return 'walk'
        if (kind === 'pool') return edge ? 'rim' : 'water'
        if (edge) return 'hedge'
        return A === 6 && f === f0 + (n >> 1) ? 'cone' : 'lawn'
      }
      f0 += n
    }
    return 'walk'
  }
  function placeChapel() {
    chapel = null
    let best = null
    let bestScore = -1e9
    for (const h of houses) {
      if (!isVilla(h)) continue
      const [hx, hy] = mid(h)
      for (let k = 0; k < 16; k++) {
        for (const r of [36, 44, 52, 60]) {
          const cx = Math.floor(hx + Math.cos((k * Math.PI) / 8) * r) & NM
          const cy = Math.floor(hy + Math.sin((k * Math.PI) / 8) * r) & NM
          let near = 0
          let ok = true
          for (const o of houses) {
            const [ox, oy] = mid(o)
            const d2 = wrapDelta(ox, cx) ** 2 + wrapDelta(oy, cy) ** 2
            if (d2 < 24 * 24) { ok = false; break }
            if (isVilla(o) && d2 < 90 * 90) near++
          }
          if (!ok) continue
          const yaw = facing(cx, cy, hx, hy)
          const score0 = near * 10 + sunward(yaw) - Math.hypot(wrapDelta(cx, spawnX), wrapDelta(cy, spawnY)) / 25 - woodAround(cx, cy, WOOD_R) * WOOD_K
          // the biggest garden that fits here
          for (let gi = 0; gi < CHAPEL_GARDENS.length; gi++) {
            const score = score0 + (CHAPEL_GARDENS.length - 1 - gi) * 4
            if (score <= bestScore) break
            const base = chapelSite(cx, cy, yaw, CHAPEL_GARDENS[gi])
            if (base < 0) continue
            bestScore = score
            best = { cx, cy, yaw, base, hx, hy, near, G: CHAPEL_GARDENS[gi], wood: woodAround(cx, cy, WOOD_R) }
            break
          }
        }
      }
    }
    if (!best) {
      worldLog.warn('no room for the chapel')
      return
    }
    const { cx, cy, yaw, base, hx, hy, G } = best
    const cell = turned(cx, cy, yaw)
    const M = MONUMENTS.chapel
    let cones = 0
    for (let f = GARDEN_B; f <= G.front; f++) {
      for (let a = -GARDEN_A; a <= GARDEN_A; a++) {
        const o = cell(a, f)
        const what = chapelPlan(G, a, f)
        let m = M_LAWN
        let h = base
        if (what === 'chapel') { monumentCell(o, base, M, a, f); continue }
        if (what === 'square') m = Math.abs(a) === 4 || f === Math.floor(CH_FORE) ? 52 : 51 // a darker border
        else if (what === 'walk') m = (a + f) & 1 ? 4 : 5
        else if (what === 'hedge') { m = M_HEDGE; h = base + 1 }
        else if (what === 'rim') { m = M_STONE; h = base + 1 }
        else if (what === 'water') m = M_POOL
        else if (what === 'cone') { m = 36; h = base + 3; cones++ }
        matMap[o] = m
        heightMap[o] = floorMap[o] = h
        parkMap[o] = 3
      }
    }
    // the trees round the hedge are cleared, to a clearing of grass round the garden
    clearRound(cell, -GARDEN_A, GARDEN_A, GARDEN_B, G.front, CLEARING)
    // a lamp at each front corner of the square and either side of the gate, a cypress outside it
    const at = (a, f) => [cx + 0.5 + a * Math.round(Math.cos(yaw)) + f * Math.round(Math.sin(yaw)), cy + 0.5 + a * Math.round(Math.sin(yaw)) - f * Math.round(Math.cos(yaw))]
    for (const [a, f] of [[-4, Math.floor(CH_FORE)], [4, Math.floor(CH_FORE)], [-2, G.front - 1], [2, G.front - 1]]) {
      const [x, y] = at(a, f)
      props.push({ kind: P_LAMP, x, y, z: base, yaw, alive: true })
    }
    for (const a of [-3, 3]) {
      const o = cell(a, G.front + 1)
      if (!openLand(o) || Math.abs(floorMap[o] - base) > 2) continue
      matMap[o] = 34
      heightMap[o] = floorMap[o] + 8 + (a > 0 ? 1 : 0)
    }
    const [px, py] = at(0, G.front + 1)
    const pathN = gravelPath(Math.floor(px), Math.floor(py), hx, hy, base, PATH_CLEAR)
    chapel = { x: cx + 0.5, y: cy + 0.5, z: base, yaw }
    monumentModel(M, 0)
    monumentModel(M, 1)
    worldLog.info('chapel', {
      at: [cx, cy], villas: best.near, garden: G.front - GARDEN_B + 1, cones, path: pathN, wood: Math.round(best.wood * 100) / 100,
      fromSpawn: Math.round(Math.hypot(wrapDelta(cx, spawnX), wrapDelta(cy, spawnY))),
    })
  }
  /** the floor the chapel and its garden G would stand on at (cx, cy), the door towards yaw; -1 if the ground will not do */
  function chapelSite(cx, cy, yaw, G) {
    const cell = turned(cx, cy, yaw)
    const base = floorMap[(cy << NSHIFT) | cx]
    if (base < 2) return -1
    for (let f = GARDEN_B; f <= G.front + 1; f++) {
      for (let a = -GARDEN_A; a <= GARDEN_A; a++) {
        const o = cell(a, f)
        if (!openLand(o)) return -1
        const inner = Math.abs(a) <= 6 && f >= -6 && f <= CH_FORE
        if (Math.abs(floorMap[o] - base) > (inner ? 2 : 3)) return -1
      }
    }
    return base
  }

  // The temple: one on the map, a garden folly on the edge of a wood, far from the chapel (300 or more),
  // not closer than 18 to any house and a short walk from a villa, its niche towards it (and, where it can
  // be, to the sun). Trees behind and
  // beside it are kept, so it stands against the wood; those in front are cleared to a lawn, with a paved
  // step before it and a gravel path on to the villa. Like the chapel it takes nothing from the random stream.
  function placeTemple() {
    temple = null
    let best = null
    let bestScore = -1e9
    for (const h of houses) {
      if (!isVilla(h)) continue
      const [hx, hy] = mid(h)
      for (let k = 0; k < 16; k++) {
        for (const r of [24, 30, 36]) {
          const cx = Math.floor(hx + Math.cos((k * Math.PI) / 8) * r) & NM
          const cy = Math.floor(hy + Math.sin((k * Math.PI) / 8) * r) & NM
          if (chapel && Math.hypot(wrapDelta(chapel.x, cx), wrapDelta(chapel.y, cy)) < 300) continue
          let near = 0
          let ok = true
          for (const o of houses) {
            const [ox, oy] = mid(o)
            const d2 = wrapDelta(ox, cx) ** 2 + wrapDelta(oy, cy) ** 2
            if (d2 < 18 * 18) { ok = false; break }
            if (isVilla(o) && d2 < 90 * 90) near++
          }
          if (!ok) continue
          const yaw = facing(cx, cy, hx, hy)
          const site = templeSite(cx, cy, yaw)
          if (!site) continue
          // near villas, against a wood, and not too far from the start
          const score = near * 10 + sunward(yaw) + Math.min(site.wood, 80) / 8 - Math.hypot(wrapDelta(cx, spawnX), wrapDelta(cy, spawnY)) / 25
          if (score <= bestScore) continue
          bestScore = score
          best = { cx, cy, yaw, base: site.base, wood: site.wood, hx, hy, near }
        }
      }
    }
    if (!best) {
      worldLog.warn('no room for the temple')
      return
    }
    const { cx, cy, yaw, base, hx, hy } = best
    const cell = turned(cx, cy, yaw)
    const M = MONUMENTS.temple
    for (let f = -3; f <= 24; f++) {
      for (let a = -9; a <= 9; a++) {
        const o = cell(a, f)
        const A = Math.abs(a)
        if (A <= 5 && f >= -2 && f <= 2) monumentCell(o, base, M, a, f)
        else if (A <= 5 && f >= 3 && f <= 4) {
          // the paved step before it
          heightMap[o] = floorMap[o] = base
          matMap[o] = f === 4 || A === 5 ? 52 : 51
          parkMap[o] = 3
        } else if (A <= 7 && f >= 3 && f <= 9 && !parkMap[o] && !houseMap[o]) {
          // a lawn before it, a gravel walk up the middle
          heightMap[o] = floorMap[o] = base
          matMap[o] = A === 0 ? (f & 1 ? 4 : 5) : M_LAWN
          parkMap[o] = 3
        } else if (!parkMap[o] && !houseMap[o] && isTree(matMap[o]) && (f >= 3 || A <= 6)) {
          heightMap[o] = floorMap[o] // the trees in front are cleared, so it can be seen from a way off
          matMap[o] = 6
        }
      }
    }
    const c = Math.round(Math.cos(yaw))
    const s = Math.round(Math.sin(yaw))
    const pathN = gravelPath(cx + 10 * s, cy - 10 * c, hx, hy, base)
    temple = { x: cx + 0.5, y: cy + 0.5, z: base, yaw }
    monumentModel(M, 0)
    monumentModel(M, 1)
    worldLog.info('temple', {
      at: [cx, cy], villas: best.near, wood: best.wood, path: pathN,
      fromSpawn: Math.round(Math.hypot(wrapDelta(cx, spawnX), wrapDelta(cy, spawnY))),
      fromChapel: chapel ? Math.round(Math.hypot(wrapDelta(chapel.x, cx), wrapDelta(chapel.y, cy))) : null,
    })
  }
  /** the floor the temple would stand on at (cx, cy), the niche towards yaw, and how much wood is behind
   * and beside it; null if the ground will not do */
  function templeSite(cx, cy, yaw) {
    const cell = turned(cx, cy, yaw)
    const base = floorMap[(cy << NSHIFT) | cx]
    if (base < 2) return null
    for (let f = -3; f <= 10; f++) {
      for (let a = -8; a <= 8; a++) {
        const o = cell(a, f)
        if (!openLand(o)) return null
        const inner = Math.abs(a) <= 6 && f <= 5
        if (Math.abs(floorMap[o] - base) > (inner ? 2 : 3)) return null
      }
    }
    let wood = 0
    for (let f = -10; f <= 2; f++) {
      for (let a = -12; a <= 12; a++) {
        if ((f < -3 || Math.abs(a) > 8) && isTree(matMap[cell(a, f)])) wood++
      }
    }
    return { base, wood }
  }

  // The museum: one on the map, near the chapel. It goes where a lone outcrop of rock stands on open ground
  // within MUSEUM_R of the chapel: the rock is cleared and the ground levelled. Where there is no such rock,
  // it goes on open ground in a ring round the chapel. Its doors face the sun where they can, and else the
  // chapel. Before them a paved forecourt with a lamp at each corner, cypresses down either side, lawn round
  // the rest, gardens beside and behind it (museumGardens), and a gravel path on to the nearest villa. Like the chapel it takes nothing from the random stream.
  const MUSEUM_R = 240
  const isRock = (m) => m >= 12 && m <= 14
  const isPeak = (m) => m >= 12 && m <= 16 // rock or snow: what a mountain is made of
  // the grounds, in (a, f) of the museum: the building, then lawn round it and the forecourt before it
  const MG_A = 17
  const MG_B = -10
  const MG_F = 16
  /** whether (a, f) is a cell the building stands over */
  const museumCell = (a, f) => {
    const A = Math.abs(a)
    return f >= -MU_BACK && (A <= 6 ? f <= 9 : A <= 11 ? f <= 5 : A <= MU_SIDE && f <= 6)
  }
  // The museum's gardens, in the manner of the lake's villas: open lawns with gravel walks, clipped box balls
  // and cones, beds of pink flowers, benches, cypresses, and no hedge or wall round the edge, so they can be
  // walked into from anywhere. Either side of the building, a gravel walk and a lawn panel with a round
  // bed. Behind it, a formal garden on terraces that follow the slope: a parterre of four lawns round a round
  // bed in a curved hedge, a cross walk, then a long striped grass avenue between gravel walks and cypresses
  // with a fountain halfway, closed by a statue between urns. Each part is as big as the ground allows, or
  // left out. They take nothing from the random stream.
  const MG_SIDE = [27, 25, 23] // how far out the side gardens may reach, widest first
  const MG_DEPTH = [46, 38, 30, 22, 14] // how deep the back garden may be, deepest first
  const MG_HW = 16 // its half width
  function museumGardens(cell, c, s, cx, cy, base) {
    const at = (a, f) => [cx + 0.5 + a * c + f * s, cy + 0.5 + a * s - f * c]
    /** the world heading of a way (da, df) in the museum's own across and forward */
    const heading = (da, df) => Math.atan2(da * c + df * s, -(da * s - df * c))
    const lay = (o, m, floor, up, park = 3) => {
      matMap[o] = m
      floorMap[o] = up === 'tree' ? floor : floor + up
      heightMap[o] = up === 'tree' ? floor + 8 + (o & 1) : floor + up
      parkMap[o] = park
    }
    const lawnCell = (o, floor) => lay(o, M_LAWN, floor, 0)
    const pink = (o, floor) => lay(o, M_FLOWERS[hash8(o) < 200 ? 0 : 2], floor, 1)
    const put = (kind, a, f, z, da, df) => {
      const [x, y] = at(a, f)
      props.push({ kind, x, y, z, yaw: heading(da, df), alive: true })
    }
    // the side gardens: a gravel walk along the building, then a lawn panel
    let sides = 0
    for (const sg of [-1, 1]) {
      let AW = 0
      for (const w of MG_SIDE) {
        let ok = true
        for (let f = -8; f <= 14 && ok; f++) {
          for (let A = 18; A <= w && ok; A++) {
            const o = cell(sg * A, f)
            if (!openLand(o) || Math.abs(floorMap[o] - base) > 3) ok = false
          }
        }
        if (ok) { AW = w; break }
      }
      if (!AW) continue
      sides++
      const Ac = (21 + AW) / 2
      for (let f = -8; f <= 14; f++) {
        for (let A = 18; A <= AW; A++) {
          const o = cell(sg * A, f)
          const r = Math.hypot(A - Ac, f - 3)
          if (A <= 19) lay(o, (A + f) & 1 ? 4 : 5, base, 0)
          else if ((A === 21 || A === AW) && (f === -7 || f === 13)) lay(o, 36, base, 2) // a ball at each corner
          else if (r < 0.7 || (A === Math.round(Ac) && (f === -4 || f === 10))) lay(o, 36, base, 3) // cones
          else if (r <= 2.3 || (A === 20 && (f + 9) % 3 !== 0)) pink(o, base)
          else lawnCell(o, base)
        }
      }
      for (const f of [-3, 9]) put(P_BENCH, sg * 19, f, base, sg, 0)
    }
    // the back garden: how many rows behind the grounds will take it, each row levelled to its own floor
    const rowF = []
    let prev = base
    for (let g = 0; g < MG_DEPTH[0]; g++) {
      const f = MG_B - 1 - g
      const count = new Map()
      let ok = true
      for (let a = -MG_HW; a <= MG_HW && ok; a++) {
        const o = cell(a, f)
        if (!openLand(o)) ok = false
        else count.set(floorMap[o], (count.get(floorMap[o]) || 0) + 1)
      }
      if (!ok) break
      let floor = prev
      let most = 0
      for (const [h, n] of count) if (n > most || (n === most && Math.abs(h - prev) < Math.abs(floor - prev))) { most = n; floor = h }
      floor = clamp(floor, prev - 2, prev + 2) // gentle steps from one terrace to the next
      let fits = true
      for (let a = -MG_HW; a <= MG_HW; a++) if (Math.abs(floorMap[cell(a, f)] - floor) > 3) fits = false
      if (!fits) break
      rowF.push(floor)
      prev = floor
    }
    const D = MG_DEPTH.find((d) => d <= rowF.length) || 0
    if (!D) return { sides, depth: 0 }
    const avenue = D >= 22
    const gEnd = D - 2 // the last two rows are the terrace the statue closes
    const gFount = 14 + Math.floor((gEnd - 14) / 2)
    for (let g = 0; g < D; g++) {
      const f = MG_B - 1 - g
      const floor = rowF[g]
      for (let a = -MG_HW; a <= MG_HW; a++) {
        const o = cell(a, f)
        const A = Math.abs(a)
        const walk = () => lay(o, (a + g) & 1 ? 4 : 5, floor, 0)
        if (g <= 1 || (g >= 12 && g <= 13) || g >= gEnd) {
          // the cross walks, and the terrace at the far end with the statue and its urns, a cypress either side
          if (g === D - 1 && A === 0) lay(o, M_PLINTH, floor, 1)
          else if (g === D - 1 && A === 3) lay(o, M_PLINTH, floor, 2)
          else if (g === D - 1 && A === 6) lay(o, 34, floor, 'tree')
          else walk()
          continue
        }
        if (g < 12) {
          // the parterre: four lawns round a round pink bed in a curved hedge, open on the axis
          const p = g - 2
          const r = Math.hypot(a, p - 4.5)
          if (r <= 2.2) pink(o, floor)
          else if (r <= 3.2 || A <= 1) walk()
          else if (r <= 3.9) lay(o, M_HEDGE, floor, 1)
          else if (A === 7 || A === 8) walk()
          else if ((A === 2 || A === 6 || A === 9) && (p === 0 || p === 9)) lay(o, 36, floor, 2)
          else if (A === 12 && (p === 4 || p === 5)) lay(o, 36, floor, 3)
          else if (A === 15 && p % 3 !== 2) pink(o, floor)
          else lawnCell(o, floor)
          continue
        }
        // the avenue: striped grass, gravel walks, cypresses, cones and balls, a fountain halfway
        const r = Math.hypot(a, g - gFount)
        if (avenue && r <= 2.9) {
          if (r < 0.6) lay(o, M_PLINTH, floor, 2)
          else if (r <= 2.1) lay(o, M_POOL, floor, 0)
          else lay(o, M_STONE, floor, 1)
        } else if (A <= 3) lay(o, (g >> 1) & 1 ? M_LAWN : 8, floor, 0)
        else if (A <= 5) walk()
        else if (A === 7 && (g - 14) % 3 === 0) lay(o, 34, floor, 'tree')
        else if (A === 11 && g % 4 === 0) lay(o, 36, floor, 3)
        else if (A === 14 && g % 4 === 2) lay(o, 36, floor, 2)
        else if (A === 16 && g % 4 !== 3) pink(o, floor)
        else lawnCell(o, floor)
      }
    }
    // the trees round it are cleared, so it opens on to the meadow
    for (let g = -2; g < D + 6; g++) {
      for (let a = -MG_HW - 6; a <= MG_HW + 6; a++) {
        const o = cell(a, MG_B - 1 - g)
        if (!parkMap[o] && !houseMap[o] && isTree(matMap[o])) { heightMap[o] = floorMap[o]; matMap[o] = 6 }
      }
    }
    // benches: at the ends of the near cross walk facing the parterre, along the avenue facing the grass
    const fAt = (g) => MG_B - 1 - g
    for (const sg of [-1, 1]) {
      put(P_BENCH, sg * 12, fAt(13), rowF[13] ?? base, 0, 1)
      for (let g = 18; g < gEnd - 2; g += 8) put(P_BENCH, sg * 5, fAt(g), rowF[g], -sg, 0)
      put(P_URN, sg * 3, fAt(D - 1), rowF[D - 1] + 2, 0, 1)
    }
    put(1, 0, fAt(D - 1), rowF[D - 1] + 1, 0, 1) // the statue looks back down the garden to the museum
    if (avenue) {
      const [x, y] = at(0, fAt(gFount))
      fountains.push({ x, y, z: rowF[gFount] + 2, alive: true })
    }
    return { sides, depth: D }
  }
  function placeMuseum() {
    museum = null
    if (!chapel) return
    // the outcrops of rock near the chapel, each as a flood fill of its cells (snow too, so a mountain is
    // one piece): its middle, if it is small
    const seen = new Set()
    const rocks = []
    const R = MUSEUM_R
    for (let dy = -R; dy <= R; dy += 2) {
      for (let dx = -R; dx <= R; dx += 2) {
        const o0 = (((chapel.y + dy) & NM) << NSHIFT) | ((chapel.x + dx) & NM)
        if (!isPeak(matMap[o0]) || seen.has(o0)) continue
        const stack = [o0]
        seen.add(o0)
        const cells = []
        let n = 0, sx = 0, sy = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9
        while (stack.length && n < 1500) {
          const o = stack.pop()
          cells.push(o)
          const x = o & NM
          const y = o >> NSHIFT
          const ux = (chapel.x | 0) + wrapDelta(x, chapel.x)
          const uy = (chapel.y | 0) + wrapDelta(y, chapel.y)
          n++; sx += ux; sy += uy
          x0 = Math.min(x0, ux); x1 = Math.max(x1, ux); y0 = Math.min(y0, uy); y1 = Math.max(y1, uy)
          for (const q of [((y << NSHIFT) | ((x + 1) & NM)), ((y << NSHIFT) | ((x - 1) & NM)), ((((y + 1) & NM) << NSHIFT) | x), ((((y - 1) & NM) << NSHIFT) | x)]) {
            if (!seen.has(q) && isPeak(matMap[q])) { seen.add(q); stack.push(q) }
          }
        }
        if (n >= 100 && n < 1500 && x1 - x0 <= 30 && y1 - y0 <= 30) rocks.push({ x: Math.round(sx / n) & NM, y: Math.round(sy / n) & NM, cells: new Set(cells) })
      }
    }
    // where to try: about each outcrop, then a ring round the chapel
    const spots = []
    for (const rock of rocks) for (let j = -4; j <= 4; j += 4) for (let i = -4; i <= 4; i += 4) spots.push([(rock.x + i) & NM, (rock.y + j) & NM, rock])
    for (let k = 0; k < 16; k++) {
      for (const r of [70, 95, 120, 150]) spots.push([Math.floor(chapel.x + Math.cos((k * Math.PI) / 8) * r) & NM, Math.floor(chapel.y + Math.sin((k * Math.PI) / 8) * r) & NM, null])
    }
    let best = null
    let bestScore = -1e9
    for (const [cx, cy, rock] of spots) {
      const bonus = rock ? 20 : 0
      const dc = Math.hypot(wrapDelta(cx, chapel.x), wrapDelta(cy, chapel.y))
      if (dc < 50) continue
      if (houses.some((h) => { const [hx, hy] = mid(h); return wrapDelta(hx, cx) ** 2 + wrapDelta(hy, cy) ** 2 < 28 * 28 })) continue
      const toChapel = facing(cx, cy, chapel.x, chapel.y)
      const wood = woodAround(cx, cy, WOOD_R)
      for (let k = 0; k < 4; k++) {
        const yaw = (k * Math.PI) / 2 - Math.PI / 2
        const score = bonus + sunward(yaw) + (Math.abs(wrapAngle(yaw - toChapel)) < 0.1 ? 4 : Math.abs(wrapAngle(yaw - toChapel)) < 2 ? 2 : 0) - dc / 25 - wood * WOOD_K
        if (score <= bestScore) continue
        const base = museumSite(cx, cy, yaw, rock)
        if (base < 0) continue
        bestScore = score
        best = { cx, cy, yaw, base, rock: !!rock, wood }
      }
    }
    if (!best) {
      worldLog.warn('no room for the museum')
      return
    }
    const { cx, cy, yaw, base } = best
    const cell = turned(cx, cy, yaw)
    const M = MONUMENTS.museum
    for (let f = MG_B; f <= MG_F; f++) {
      for (let a = -MG_A; a <= MG_A; a++) {
        const o = cell(a, f)
        if (museumCell(a, f)) { monumentCell(o, base, M, a, f); continue }
        const A = Math.abs(a)
        let m = M_LAWN
        if (A <= 12 && f >= 7) m = A === 12 || f === MG_F ? 52 : 51 // the forecourt, with a darker border
        else if (A === MU_SIDE + 1 || f === -MU_BACK - 1) m = 51 // a paved walk round the building
        matMap[o] = m
        heightMap[o] = floorMap[o] = base
        parkMap[o] = 3
      }
    }
    // the rock round the grounds is cleared to grass, levelled to the grounds (the trees go below)
    for (let f = MG_B - 12; f <= MG_F + 12; f++) {
      for (let a = -MG_A - 12; a <= MG_A + 12; a++) {
        const o = cell(a, f)
        if (parkMap[o] || houseMap[o]) continue
        if (isRock(matMap[o])) {
          matMap[o] = 6
          heightMap[o] = floorMap[o] = base
        }
      }
    }
    // a lamp at each corner of the forecourt, and cypresses down either side of it
    const c = Math.round(Math.cos(yaw))
    const s = Math.round(Math.sin(yaw))
    const at = (a, f) => [cx + 0.5 + a * c + f * s, cy + 0.5 + a * s - f * c]
    for (const [a, f] of [[-12, 7], [12, 7], [-12, MG_F], [12, MG_F]]) {
      const [x, y] = at(a, f)
      props.push({ kind: P_LAMP, x, y, z: base, yaw, alive: true })
    }
    for (const a of [-MG_A + 1, MG_A - 1]) {
      for (const f of [8, 11, 14]) {
        const o = cell(a, f)
        matMap[o] = 34
        heightMap[o] = base + 8 + ((a + f) & 1)
      }
    }
    const gardens = museumGardens(cell, c, s, cx, cy, base)
    // the trees round the grounds and the gardens are cleared, so it stands in a clearing
    const reach = gardens.sides ? MG_SIDE[0] : MG_A
    clearRound(cell, -reach, reach, MG_B - 1 - gardens.depth, MG_F, CLEARING)
    // the nearest villa, and a gravel path on to it from the forecourt
    let near = null
    let nd = 1e9
    for (const h of houses) {
      if (!isVilla(h)) continue
      const [hx, hy] = mid(h)
      const d = Math.hypot(wrapDelta(hx, cx), wrapDelta(hy, cy))
      if (d < nd) { nd = d; near = [hx, hy] }
    }
    const [px, py] = at(0, MG_F + 1)
    const pathN = near ? gravelPath(Math.floor(px), Math.floor(py), near[0], near[1], base, PATH_CLEAR) : 0
    museum = { x: cx + 0.5, y: cy + 0.5, z: base, yaw }
    monumentModel(M, 0)
    monumentModel(M, 1)
    worldLog.info('museum', {
      at: [cx, cy], onRock: best.rock, rocks: rocks.length, path: pathN, wood: Math.round(best.wood * 100) / 100, sideGardens: gardens.sides, backGarden: gardens.depth,
      fromChapel: Math.round(Math.hypot(wrapDelta(chapel.x, cx), wrapDelta(chapel.y, cy))),
    })
  }
  /**
   * the floor the museum and its grounds would stand on at (cx, cy), the doors towards yaw, clearing the
   * outcrop rock (or none); -1 if the ground will not do. All of the outcrop must be inside the cleared
   * ground, and no other rock or snow.
   */
  function museumSite(cx, cy, yaw, rock) {
    const cell = turned(cx, cy, yaw)
    // the floor is the commonest floor of the open ground the building would stand on
    const count = new Map()
    for (let f = -MU_BACK; f <= 9; f += 2) {
      for (let a = -MU_SIDE; a <= MU_SIDE; a += 2) {
        const o = cell(a, f)
        if (!isRock(matMap[o])) count.set(floorMap[o], (count.get(floorMap[o]) || 0) + 1)
      }
    }
    let base = -1
    let most = 0
    for (const [h, n] of count) if (n > most) { most = n; base = h }
    if (base < 2) return -1
    for (let f = MG_B; f <= MG_F + 1; f++) {
      for (let a = -MG_A; a <= MG_A; a++) {
        const o = cell(a, f)
        const stone = isRock(matMap[o]) && !parkMap[o] && !houseMap[o]
        if (!stone && !openLand(o)) return -1
        if (!stone && Math.abs(floorMap[o] - base) > (museumCell(a, f) ? 2 : 3)) return -1
      }
    }
    let mine = 0
    for (let f = MG_B - 12; f <= MG_F + 12; f++) {
      for (let a = -MG_A - 12; a <= MG_A + 12; a++) {
        const o = cell(a, f)
        if (!isPeak(matMap[o])) continue
        if (!rock || !rock.cells.has(o)) return -1
        mine++
      }
    }
    return rock && mine < rock.cells.size ? -1 : base
  }

  // a garden lamp by the end of every bench, a little behind it, so the gardens, the terraces and the
  // promenades are lit at night. It takes nothing from the random stream: the rest stays as it was.
  function placeLamps() {
    const n = props.length
    for (let i = 0; i < n; i++) {
      const s = props[i]
      if (s.kind !== P_BENCH) continue
      // across the bench is (cos, sin) of its yaw, the way the sitter faces (sin, −cos)
      const cs = Math.cos(s.yaw)
      const sn = Math.sin(s.yaw)
      props.push({ kind: P_LAMP, x: s.x + 1.9 * cs - 0.3 * sn, y: s.y + 1.9 * sn + 0.3 * cs, z: s.z, yaw: s.yaw, alive: true })
    }
  }

  function placeWildflowers(rnd) {
    flowerN = 0
    const STEP = 6
    const corner = (i, j) => hash8((((i & 31) * 73) ^ ((j & 31) * 151)) + 977) / 255
    // squares within about 40 of a house
    nearHouse.fill(0)
    const NM2 = NEAR_N - 1
    for (const h of houses) {
      const qx = (h.x + (h.w >> 1)) >> NEAR_SHIFT
      const qy = (h.y + (h.d >> 1)) >> NEAR_SHIFT
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy <= 9) nearHouse[(((qy + dy) & NM2) * NEAR_N) + ((qx + dx) & NM2)] = 1
        }
      }
    }
    for (let gy = 0; gy < N; gy += STEP) {
      for (let gx = 0; gx < N; gx += STEP) {
        const fx = gx / 64
        const fy = gy / 64
        const ix = fx | 0
        const iy = fy | 0
        const u = fx - ix
        const w = fy - iy
        const top = corner(ix, iy) * (1 - u) + corner(ix + 1, iy) * u
        const bottom = corner(ix, iy + 1) * (1 - u) + corner(ix + 1, iy + 1) * u
        const dens = top * (1 - w) + bottom * w
        const near = nearHouse[((gy >> NEAR_SHIFT) * NEAR_N) + (gx >> NEAR_SHIFT)] === 1
        if (rnd() >= (dens - 0.3) * (near ? 0.48 : 0.24)) continue
        const x0 = gx + ((rnd() * STEP) | 0)
        const y0 = gy + ((rnd() * STEP) | 0)
        const r = 0.8 + rnd() * 1.8
        const ri = Math.ceil(r)
        const main = flowerAt(rnd())
        for (let dy = -ri; dy <= ri; dy++) {
          for (let dx = -ri; dx <= ri; dx++) {
            if (dx * dx + dy * dy > r * r || rnd() > 0.7) continue
            const o = (((y0 + dy) & NM) << NSHIFT) | ((x0 + dx) & NM)
            const m = matMap[o]
            if (m < 6 || m > 8 || parkMap[o] || houseMap[o]) continue
            matMap[o] = rnd() < 0.8 ? main : flowerAt(rnd())
            heightMap[o] = floorMap[o] + 1
            flowerN++
          }
        }
      }
    }
  }

  function placeBoats(rnd) {
    const docked = boats.length
    const freeGoal = docked + 8
    let freeN = 0
    const tryBoat = (x, y) => {
      if (boats.length >= freeGoal) return false
      if (matAt(x, y) > 2) return false
      let land = 0
      for (let a = 0; a < 8; a++) {
        if (matAt(x + Math.cos(a * 0.785) * 22, y + Math.sin(a * 0.785) * 22) >= 4) land++
      }
      if (land < 1 || land > 6) return false
      for (const o of boats) {
        const dx = o.x - x
        const dy = o.y - y
        if (dx * dx + dy * dy < 70 * 70) return false
      }
      let nx = 0
      let ny = 0
      for (let a = 0; a < 8; a++) {
        if (matAt(x + Math.cos(a * 0.785) * 28, y + Math.sin(a * 0.785) * 28) >= 4) {
          nx += Math.cos(a * 0.785)
          ny += Math.sin(a * 0.785)
        }
      }
      // sail along the shore, not into it
      const yaw = Math.atan2(-nx, ny) + (rnd() > 0.5 ? 0 : Math.PI)
      const r = rnd()
      const kind = r < 0.35 ? 0 : r < 0.7 ? 1 : 2
      const boat = makeBoat(x, y, yaw, kind, HULL_PICK[(rnd() * HULL_PICK.length) | 0], false, 5.2 + rnd() * 3.4, rnd() * Math.PI * 2)
      // four keep sailing, two make for a dock, two anchor off a beach
      boat.intent = freeN === 1 || freeN === 4 ? 1 : freeN === 3 || freeN === 6 ? 2 : 0
      freeN++
      boats.push(boat)
      return true
    }
    for (let k = 0; k < 20 && boats.length < freeGoal && boats.length < docks.length + 4; k++) {
      const ang = rnd() * Math.PI * 2
      const dist = 30 + rnd() * 160
      tryBoat((spawnX + Math.cos(ang) * dist) | 0, (spawnY + Math.sin(ang) * dist) | 0)
    }
    for (let k = 0; k < 400 && boats.length < freeGoal; k++) {
      tryBoat((rnd() * N) | 0, (rnd() * N) | 0)
    }
  }

  // Gulls, few on the whole map: 8 colonies of 2–4 over the water by a shore, the first near the start.
  function placeBirds(rnd) {
    birds.length = 0
    const apart = (x, y, d) => birds.every((b) => wrapDelta(b.ax, x) ** 2 + wrapDelta(b.ay, y) ** 2 > d * d)
    for (let c = 0; c < 8; c++) {
      let x = 0
      let y = 0
      let found = false
      for (let t = 0; t < 300 && !found; t++) {
        const ang = rnd() * Math.PI * 2
        const dist = 60 + rnd() * 200
        x = c === 0 ? (spawnX + Math.cos(ang) * dist) | 0 : (rnd() * N) | 0
        y = c === 0 ? (spawnY + Math.sin(ang) * dist) | 0 : (rnd() * N) | 0
        const m = matAt(x, y)
        if (m < 1 || m > 3) continue
        let land = 0
        for (let a = 0; a < 8; a++) if (matAt(x + Math.cos(a * 0.785) * 22, y + Math.sin(a * 0.785) * 22) >= 4) land++
        if (land < 1 || land > 5 || !apart(x, y, 220)) continue
        found = true
      }
      if (!found) continue
      const n = 2 + ((rnd() * 3) | 0)
      const dir = rnd() < 0.5 ? -1 : 1
      for (let i = 0; i < n; i++) {
        birds.push({
          ax: wrapPos(x + (rnd() - 0.5) * 8), ay: wrapPos(y + (rnd() - 0.5) * 8), az: 10 + rnd() * 6,
          r: 10 + rnd() * 8, w: dir * (0.35 + rnd() * 0.15), ph: rnd() * Math.PI * 2,
        })
      }
    }
  }

  // Fish are shorter than the person reads from above (the figure stacks to about 8).
  // A whale is a few times that, and there are only a handful on the whole map.
  function placeLife(rnd) {
    fish.length = 0
    whales.length = 0
    const schoolN = 8
    for (let s = 0; s < schoolN; s++) {
      let x = 0
      let y = 0
      let found = false
      const near = s < 3
      for (let t = 0; t < 50; t++) {
        const ang = rnd() * Math.PI * 2
        const dist = near ? 80 + rnd() * 260 : rnd() * N
        x = near ? (spawnX + Math.cos(ang) * dist) | 0 : (rnd() * N) | 0
        y = near ? (spawnY + Math.sin(ang) * dist) | 0 : (rnd() * N) | 0
        if (matAt(x, y) > 2) continue
        found = true
        break
      }
      if (!found) continue
      const yaw = rnd() * Math.PI * 2
      const kind = (rnd() * 3) | 0
      const n = 4 + ((rnd() * 2) | 0)
      const lead = fish.length
      for (let i = 0; i < n; i++) {
        let fx = wrapPos(x + (rnd() - 0.5) * 16)
        let fy = wrapPos(y + (rnd() - 0.5) * 16)
        if (matAt(fx, fy) >= 4) { fx = wrapPos(x); fy = wrapPos(y) }
        fish.push({
          x: fx,
          y: fy,
          yaw: yaw + (rnd() - 0.5) * 0.5,
          speed: 8 + rnd() * 4,
          phase: rnd() * Math.PI * 2,
          kind,
          size: 5.2 + rnd() * 1.4,
          lead,
        })
      }
    }
    for (let i = 0; i < 3; i++) {
      let x = 0
      let y = 0
      let found = false
      for (let t = 0; t < 80; t++) {
        const ang = rnd() * Math.PI * 2
        const dist = i === 0 ? 220 + rnd() * 280 : rnd() * N
        x = i === 0 ? (spawnX + Math.cos(ang) * dist) | 0 : (rnd() * N) | 0
        y = i === 0 ? (spawnY + Math.sin(ang) * dist) | 0 : (rnd() * N) | 0
        if (matAt(x, y) > 0) continue
        let far = true
        for (const w of whales) {
          const dx = w.x - x
          const dy = w.y - y
          if (dx * dx + dy * dy < 480 * 480) far = false
        }
        if (!far) continue
        found = true
        break
      }
      if (!found) continue
      whales.push({
        x: wrapPos(x), y: wrapPos(y),
        yaw: rnd() * Math.PI * 2,
        speed: 3.4 + rnd() * 1.3,
        phase: rnd() * Math.PI * 2,
        size: 14 + rnd() * 3,
      })
    }
  }

  // ── state
  let W = 0
  let H = 0
  let fb = new Uint32Array(0)
  let bytes = new Uint8ClampedArray(0)
  let jetMask = new Uint8Array(0)
  let time = 0
  let introT = 0
  let spreadNow = p.spread
  let holding = false
  let holdT = 0
  let pointerOn = false
  let pointerX = 0
  let pointerY = 0
  let pointerIdle = 99
  let autoStunt = 6
  let burn = 0 // afterburner, eased in after the intro
  let boost = 0 // 0..1: how hard the thrusters are being pushed (hold)
  let boostKey = false
  let keyTurn = 0 // flying with the keys: −1 left … +1 right
  let keyClimb = 0 // −1 dive … +1 climb
  let keyMode = false // the keys fly the jet until the pointer moves again
  let altGoal = p.altitude // the height the jet is heading for
  let climbV = 0 // how fast it is climbing, px per second (smoothed)
  let climbTilt = 0 // the jet's climb angle, which the chase camera leans with
  let worldDirty = 0 // seconds until the world is rebuilt (waits for a slider to settle)
  let reseat = false
  const cam = { x: 0, y: 0, yaw: 0, alt: p.altitude } // what the view is centred on (yaw: the overhead heading)
  const follow = { x: 0, y: 0, alt: p.altitude } // the same point as it trails the jet; the cockpit locks on instead
  let jets = []
  let colY = new Int32Array(0) // per screen column: the highest row the ground has reached
  let zbuf = new Float32Array(0) // per pixel: how deep into the view the world is, so it can hide a jet behind it
  // the cockpit view is drawn on a larger square sheet and then turned (the horizon rolls)
  let sheetSide = 0
  let sheet = new Uint32Array(0)
  let sheetMask = new Uint8Array(0)
  let sheetColY = new Int32Array(0)
  let sheetZ = new Float32Array(0)
  let pivotY = 0 // the screen row the cockpit view rolls about
  let cockpit = null
  let cockpitDue = 0.3 // seconds until the cockpit is (re)painted; it is done ahead of time, never mid-move
  let colLo = 0 // the columns and rows being drawn (all of them, except on the sheet)
  let colHi = 0
  let rowLo = 0
  let rowHi = 0
  let frameH = 0 // height of the frame on screen (H is the sheet's while the world is drawn on it)
  let backdrop = new Uint32Array(0) // what was behind a jet, kept while it fades in or out
  let sheetBackdrop = new Uint32Array(0)

  // the view: 0 = overhead, 1 = behind the jet, 2 = in the cockpit, and anywhere between while it moves
  const viewIndex = (v) => (v === 'cockpit' ? 2 : v === 'chase' ? 1 : 0)
  let viewTarget = viewIndex(p.view)
  // How much of each view the camera is in. Each weight glides to its goal through three soft
  // stages, so a change starts and ends gently, goes straight from any view to any other, and
  // can be redirected half-way without a jolt.
  const wChase = [0, 0, 0]
  const wCock = [0, 0, 0]
  wChase.fill(viewTarget === 1 ? 1 : 0)
  wCock.fill(viewTarget === 2 ? 1 : 0)
  let vC = wChase[2] // chase
  let vK = wCock[2] // cockpit (what is left over is the overhead view)
  let jetFade = 1 // how solid the leader is drawn: it fades out as the camera moves into it
  let camSpin = 0 // 1 while the camera is going round with a roll that began in the cockpit
  let chaseYaw = 0 // heading of the chase camera (lags the jet a little in turns)
  let yawDiff = 0 // how far the chase heading is from the overhead one, kept continuous
  let vQ = 0 // 1 / camera distance: 0 is the flat sprite-stack view
  // walking in first person, no voxel nearer than this depth is drawn: one he walks through (a bench)
  // would otherwise fill the screen
  let vNear = -1e9
  let vTan = 1 // how steeply the camera looks down
  let vS = 1 // scale at the jet
  let vCx = 0 // where the jet sits on screen
  let vCy = 0
  let vCos = 1
  let vSin = 0
  let vYaw = 0
  let vIn = 0 // 0..1: how far into the cockpit the camera is
  const smoke = new Float32Array(SMOKE_N * SMOKE_F) // x, y, z, born, size, push x, push y, strength, life
  let smokeHead = 0
  const bombs = []
  const boats = []
  const fish = []
  const whales = []
  const walker = { x: 0, y: 0, yaw: 0, z: 0 }
  // inside the museum: the man walks its gallery, drawn by its own renderer (museum-room.ts)
  const room = createMuseumRoom()
  let indoors = false
  let onFoot = false
  let footView = 0 // 0 overhead third person, 1 first person
  let aboard = -1
  let rigGhost = 0 // first person aboard: 0 the rig solid … 1 the sails see-through, once sailing
  let walkTurn = 0
  let walkMove = 0
  let walkSide = 0 // a step to the right (+) or the left (−), on land
  let sailing = false
  // a finger dragging on a phone, aboard or flying overhead: the way on the screen to turn to (x right, y down)
  let aimOn = false
  let aimX = 0
  let aimY = 0
  // Enzo out on deck: seconds the boat has lain still, how far along the way out he is
  // (0 below … LOUNGE_END sat on the rail), which way he is going (1 out, -1 back in, 0 not out),
  // the side he sits on (1 starboard, -1 port), and whether W was pressed while he was out
  let restT = 0
  let lounge = 0
  let loungeDir = 0
  let loungeSide = 1
  let loungeGo = false
  let bombHeld = false
  let bombReady = 0
  const boom = new Float32Array(BOOM_N * BOOM_F)
  let boomHead = 0
  const blasts = []
  let smokeClock = 0
  let vRoll = 0 // the camera's roll (cockpit only)
  let vSteerY = 0 // the screen row that means "hold this height" when pointing to climb or dive
  let vLean = 1 // how steeply the chase camera would look down if nothing were in its way
  let camFix = 0 // how far the chase camera is moved up or down to stay clear of hills and clouds, px
  let camFloor = 0 // the lowest the chase camera may sit right now, px
  let floorS = 0 // the lowest the jet may fly right now (the ground ahead plus clearance), smoothed
  let speedNow = p.speed
  // the pilot's head, swaying with the flying (design pixels; right and down are positive)
  let headX = 0
  let headY = 0
  let headVX = 0
  let headVY = 0
  // Smooth flames are not drawn into the picture: the fire layer over it draws them. For each:
  // nozzle x y, a point straight behind it x y, tip x y (frame px), radius at the nozzle,
  // how much larger things are at the tip, thrust 0..1, strength 0..1, how much of the nozzle,
  // middle and tip can be seen, which flame it is, the afterburner setting, and its true
  // length in nozzle radii.
  const flameData = new Float32Array(FLAME_MAX * FLAME_F)
  const flameOut = { count: 0, data: flameData }

  /** 0..1: how far the cockpit has slid into place round the camera */
  function cockpitIn() {
    const u = clamp((vK - 0.16) / 0.84, 0, 1)
    return u * u * u * (u * (u * 6 - 15) + 10)
  }

  function updateView() {
    vNear = -1e9
    if (onFoot && W > 0) {
      applyFootCamera()
      return
    }
    const sc = jetSize()
    const lead = jets[0]
    const top = 1 - vC - vK
    vCx = W >> 1
    vIn = vK
    cam.x = follow.x
    cam.y = follow.y
    cam.alt = follow.alt
    if ((vC === 0 && vK === 0) || !lead) {
      // the plain overhead view, exactly
      vQ = 0
      vTan = 1
      vLean = 1
      vS = 1
      vCy = H >> 1
      vSteerY = vCy
      vRoll = 0
      jetFade = 1
      vYaw = cam.yaw
    } else {
      // Each view is a camera pose; the frame shows a blend of the three.
      // chase: behind the jet (under boost it closes in a little, which widens the view)
      const dist = clamp(p.chaseDistance, 1, 8) * JET_L * sc * (1 - 0.16 * boost)
      const zoom = Math.max(1, (clamp(p.chaseSize, 0.05, 0.6) * W) / (JET_W * sc))
      // cockpit: at the pilot's eyes, looking at a point ahead of the nose
      const focalIn = W * 0.6 * (1 - 0.1 * boost)
      const ahead = COCKPIT_LOOK * vK
      const sn = Math.sin(lead.yaw)
      const cs = Math.cos(lead.yaw)
      cam.x += (lead.x + sn * ahead - follow.x) * vK
      cam.y += (lead.y - cs * ahead - follow.y) * vK
      cam.alt += (lead.z + COCKPIT_EYE * sc - follow.alt) * vK
      vQ = vC / dist + vK / COCKPIT_LOOK
      vS = Math.exp(vC * Math.log(zoom) + vK * Math.log(focalIn / COCKPIT_LOOK))
      // how steeply it looks down: 45° overhead, the chase angle behind, level in the cockpit.
      // The chase camera drops behind the jet as it climbs and rises over it as it dives, and
      // camFix lifts or lowers it to stay clear of the hills and out of the cloud layer.
      const angle = (45 * top + clamp(p.chaseAngle, 2, 40) * vC) * (Math.PI / 180)
      vLean = Math.tan(angle) - 0.5 * climbTilt * vC
      const free = 1 - vK
      vTan = Math.max(vLean + camFix * vQ * free, (camFloor - cam.alt) * vQ * free, (2 - cam.alt) * vQ)
      // where the jet (or, in the cockpit, the horizon) sits in the frame; a climb drops the horizon
      const focal = vS / vQ
      const cyChase = (H >> 1) + H * (0.14 - 0.03 * boost)
      const cyIn = pivotY + focal * Math.tan(clamp(lead.pitch * 0.8, -0.6, 0.6))
      vCy = top * (H >> 1) + vC * cyChase + vK * cyIn
      vSteerY = top * (H >> 1) + vC * cyChase + vK * H * 0.34
      // in the cockpit the view rolls and turns exactly with the jet
      // (a full roll is followed either all the way round or not at all, so it always ends level)
      vRoll = (lead.roll + lead.joltR) * vK + spinOf(lead) * camSpin
      const behind = cam.yaw + yawDiff
      vYaw = cam.yaw + yawDiff * (vC + vK) + wrapAngle(-lead.yaw - behind) * vK
      // the jet fades away as the camera moves into it
      const f = clamp((vK - 0.12) / 0.4, 0, 1)
      jetFade = 1 - f * f * (3 - 2 * f)
    }
    vCos = Math.cos(vYaw)
    vSin = Math.sin(vYaw)
  }

  /** how far through a full roll a jet is, as an angle (0 when it is not rolling) */
  function spinOf(j) {
    if (j.stunt < 0 || j.stuntDelay > 0) return 0
    const t = j.stunt
    return j.stuntDir * Math.PI * 2 * (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
  }
  /** a jet's bank angle, including any roll it is half-way through */
  function rollOf(j) {
    return j.roll + spinOf(j) + j.joltR
  }
  // the ground's height, a monument's over its footprint (the plane clears it and the bombs burst on it)
  const groundAt = (x, y) => {
    const o = (((y | 0) & NM) << NSHIFT) | ((x | 0) & NM)
    return parkMap[o] === 4 ? Math.max(heightMap[o], monumentTop.get(o) || 0) : heightMap[o]
  }
  /** the tallest ground under a jet and along the next stretch of its path */
  function groundAhead(j, speed) {
    const sn = Math.sin(j.yaw)
    const cs = Math.cos(j.yaw)
    let top = 0
    for (let i = 0; i <= 4; i++) {
      const d = speed * 0.16 * i
      for (let side = -1; side <= 1; side++) {
        const h = groundAt(j.x + sn * d + cs * side * 7, j.y - cs * d + sn * side * 7)
        if (h > top) top = h
      }
    }
    return top
  }

  const jetSize = () => clamp(p.jetScale || 1, 0.4, 2)
  const formX = () => JET_W * 1.2 * jetSize() + 2
  const formY = () => JET_L * 0.74 * jetSize()

  function resetFlight() {
    const yaw = 0.9
    jets = [makeJet(spawnX, spawnY, p.altitude, yaw)]
    cam.x = follow.x = spawnX
    cam.y = follow.y = spawnY
    cam.yaw = -yaw * p.cameraFollow
    cam.alt = follow.alt = p.altitude
    camFix = 0
    camFloor = 0
    floorS = 0
    chaseYaw = -yaw
    yawDiff = wrapAngle(chaseYaw - cam.yaw)
    introT = p.intro ? 0 : 99
    burn = p.intro ? 0 : 1
    autoStunt = 7
    altGoal = p.altitude
    climbV = 0
    climbTilt = 0
    boost = 0
  }
  function syncWingmen() {
    const want = 1 + clamp(Math.round(p.wingmen), 0, 2)
    const lead = jets[0]
    while (jets.length < want) {
      const side = jets.length === 1 ? -1 : 1
      const j = makeJet(
        lead.x + Math.cos(lead.yaw) * side * formX() - Math.sin(lead.yaw) * formY(),
        lead.y + Math.sin(lead.yaw) * side * formX() + Math.cos(lead.yaw) * formY(),
        lead.z, lead.yaw,
      )
      jets.push(j)
    }
    if (jets.length > want) jets.length = want
  }

  rebuildPalettes()
  buildWorld()
  resetFlight()
  syncWingmen()

  function setParams(next) {
    const prev = p
    p = { ...next }
    if (prev.seed !== p.seed) { worldDirty = 0.2; reseat = true }
    if (prev.land !== p.land) worldDirty = 0.2
    // a new time of day is eased to, like N
    if (prev.timeOfDay !== p.timeOfDay) dayGoal = TOD_PHASE[p.timeOfDay] ?? 0
    if (prev.bodyColor !== p.bodyColor || prev.accentColor !== p.accentColor || prev.canopyColor !== p.canopyColor) rebuildPalettes()
    if (prev.intro !== p.intro && p.intro) { introT = 0; burn = 0 }
    if (prev.view !== p.view) viewTarget = viewIndex(p.view)
    if (prev.seed !== p.seed || prev.land !== p.land) {
      bombs.length = 0
      blasts.length = 0
      boom.fill(0)
    }
    syncWingmen()
  }

  function resize(w, h) {
    W = Math.max(8, w | 0)
    H = Math.max(8, h | 0)
    const buf = new ArrayBuffer(W * H * 4)
    fb = new Uint32Array(buf)
    bytes = new Uint8ClampedArray(buf)
    jetMask = new Uint8Array(W * H)
    colY = new Int32Array(W)
    zbuf = new Float32Array(W * H)
    // the square sheet reaches every corner of the frame however far the view is rolled
    pivotY = Math.round(H * 0.34)
    cockpit = null
    cockpitDue = 0.3
    const tall = Math.max(pivotY, H - pivotY)
    sheetSide = (Math.ceil(Math.sqrt((W / 2) * (W / 2) + tall * tall)) + 2) * 2
    sheet = new Uint32Array(sheetSide * sheetSide)
    sheetMask = new Uint8Array(sheetSide * sheetSide)
    sheetColY = new Int32Array(sheetSide)
    sheetZ = new Float32Array(sheetSide * sheetSide)
    backdrop = new Uint32Array(W * H)
    sheetBackdrop = new Uint32Array(sheetSide * sheetSide)
    updateView()
  }

  function pointerMove(x, y) {
    keyMode = false
    pointerOn = true
    pointerX = x
    pointerY = y
    pointerIdle = 0
  }
  function pointerLeave() {
    pointerOn = false
    holding = false
  }
  function press() {
    holding = true
    holdT = 0
  }
  function release() {
    if (!onFoot && holding && holdT < HOLD) startRoll() // a click rolls; a hold was the thrusters
    holding = false
  }
  /** arrow keys / WASD: turn −1..1, climb −1..1 (chase view), and whether the boost key is down */
  function setKeys(turn, climb, boostHeld) {
    keyTurn = clamp(turn, -1, 1)
    keyClimb = clamp(climb, -1, 1)
    boostKey = boostHeld
    if (keyTurn !== 0 || keyClimb !== 0) keyMode = true
  }
  function startRoll() {
    const lead = jets[0]
    if (lead.stunt >= 0) return
    const dir = lead.yawRate >= 0 ? 1 : -1
    camSpin = vK > 0.5 ? 1 : 0
    jets.forEach((j, i) => {
      j.stunt = 0
      j.stuntDir = dir
      j.stuntDelay = i * 0.16
    })
  }
  /** on to the next view: overhead → behind the jet → cockpit → overhead */
  function toggleView() {
    viewTarget = (viewTarget + 1) % 3
  }
  function replayIntro() {
    introT = 0
    burn = 0
  }
  function setBomb(on) {
    bombHeld = !!on
  }
  function dropBomb() {
    const lead = jets[0]
    if (!lead || bombs.length >= BOMB_MAX || time < bombReady) return
    bombReady = time + 0.38
    const sc = jetSize()
    bombs.push({
      x: lead.x,
      y: lead.y,
      z: lead.z - 2.4 * sc,
      vx: lead.vx * 0.42,
      vy: lead.vy * 0.42,
      vz: -14,
    })
  }

  function puffSmoke(x, y, z, size, str, life) {
    const o = smokeHead * SMOKE_F
    smoke[o] = x
    smoke[o + 1] = y
    smoke[o + 2] = z
    smoke[o + 3] = time
    smoke[o + 4] = size
    smoke[o + 5] = (hash8(smokeHead * 17 + 3) - 128) * 0.18
    smoke[o + 6] = (hash8(smokeHead * 13 + 5) - 128) * 0.18
    smoke[o + 7] = str
    smoke[o + 8] = life
    smokeHead = (smokeHead + 1) % SMOKE_N
  }

  function spawnSpark(x, y, z, vx, vy, vz, life, heat, size) {
    const o = boomHead * BOOM_F
    boom[o] = x
    boom[o + 1] = y
    boom[o + 2] = z
    boom[o + 3] = vx
    boom[o + 4] = vy
    boom[o + 5] = vz
    boom[o + 6] = time
    boom[o + 7] = life
    boom[o + 8] = heat
    boom[o + 9] = size
    boomHead = (boomHead + 1) % BOOM_N
  }

  function wreckHouse(id, worldX, worldY) {
    const house = houses[id - 1]
    if (!house || !house.alive) return
    house.alive = false
    const unwrap = (from, to) => from + (to - from - N * Math.round((to - from) / N))
    const cx = unwrap(worldX, house.x + house.w * 0.5)
    const cy = unwrap(worldY, house.y + house.d * 0.5)
    const cz = house.base + 6
    for (let dy = -1; dy <= house.d; dy++) {
      for (let dx = -1; dx <= house.w; dx++) {
        const x = (house.x + dx) & NM
        const y = (house.y + dy) & NM
        const o = (y << NSHIFT) | x
        if (houseMap[o] === id) {
          houseMap[o] = 0
          heightMap[o] = house.base + 1 + ((dx + dy) & 1)
          matMap[o] = ((dx * 3 + dy * 5) & 3) === 0 ? 24 : 23
        } else if (isGreen(matMap[o])) {
          matMap[o] = 24
        }
      }
    }
    GW.dirty.push(house.y - 1, house.y + house.d)
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + hash8(id * 19 + i) * 0.02
      const sp = 18 + (hash8(id * 7 + i) / 255) * 38
      spawnSpark(
        cx + (hash8(i * 11) - 128) * 0.04,
        cy + (hash8(i * 13) - 128) * 0.04,
        cz + (hash8(i * 17) / 255) * 6,
        Math.cos(a) * sp,
        Math.sin(a) * sp,
        22 + (hash8(i * 23) / 255) * 40,
        0.45 + (hash8(i * 29) / 255) * 0.55,
        (hash8(i * 31) / 255) * 4,
        1.1 + (hash8(i * 37) / 255) * 1.6,
      )
    }
    puffSmoke(cx, cy, cz, 3.2, 0.85, 1.6)
    puffSmoke(cx + 2, cy - 1, cz + 1, 2.4, 0.7, 1.3)
  }

  function explode(wx, wy, wz) {
    const gx = wx | 0
    const gy = wy | 0
    const water = matMap[(((gy & NM) << NSHIFT) | (gx & NM))] < 4
    const r = water ? 6 : 12
    const hit = new Set()
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy
        if (d2 > r * r) continue
        const x = (gx + dx) & NM
        const y = (gy + dy) & NM
        const o = (y << NSHIFT) | x
        const hid = houseMap[o]
        if (hid && !hit.has(hid)) {
          hit.add(hid)
          wreckHouse(hid, wx, wy)
        }
        const m = matMap[o]
        if (m < 4 || parkMap[o] === 4) continue // the chapel and the temple stand, whatever falls on them
        const fall = Math.round((1 - Math.sqrt(d2) / r) * (water ? 2 : 9))
        heightMap[o] = Math.max(isBuilt(m) ? houses[hid - 1]?.base || 0 : 0, heightMap[o] - fall)
        if (d2 < (r * 0.55) * (r * 0.55)) matMap[o] = d2 < 8 ? 24 : 23
        else if (isGreen(m) && d2 < r * r * 0.85) matMap[o] = 24
      }
    }
    GW.dirty.push(gy - r, gy + r)
    // statues, benches, urns and fountains in the blast are knocked down
    for (const s of props) if (s.alive && wrapDelta(s.x, wx) ** 2 + wrapDelta(s.y, wy) ** 2 < r * r) s.alive = false
    for (const f of fountains) if (f.alive && wrapDelta(f.x, wx) ** 2 + wrapDelta(f.y, wy) ** 2 < r * r) f.alive = false
    if (blasts.length < BLAST_N) blasts.push({ x: wx, y: wy, z: wz, t: time, life: water ? 0.28 : 0.55, r: water ? 7 : 16 })
    const n = water ? 12 : 36
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const sp = (water ? 10 : 22) + (hash8((gx * 13 + gy + i) | 0) / 255) * 34
      spawnSpark(
        wx,
        wy,
        wz + 1,
        Math.cos(a) * sp,
        Math.sin(a) * sp,
        (water ? 8 : 18) + (hash8(i * 41 + gx) / 255) * 36,
        0.35 + (hash8(i * 9) / 255) * 0.5,
        water ? 0 : (hash8(i * 21) / 255) * 5,
        water ? 1.2 : 1.4 + (hash8(i * 5) / 255),
      )
    }
    puffSmoke(wx, wy, wz + 2, water ? 2 : 3.6, water ? 0.45 : 0.9, water ? 0.7 : 1.8)
  }

  function wrapPos(v) {
    return ((v % N) + N) % N
  }
  function wrapDelta(a, b) {
    return a - b - N * Math.round((a - b) / N)
  }
  function standable(x, y) {
    const o = ((y & NM) << NSHIFT) | (x & NM)
    if (houseMap[o] || parkMap[o] === 4) return false // a house, the chapel, the temple
    const m = matMap[o]
    // a tree (trunk, canopy, a cypress) does not stop anyone: it is walked through, on the ground under it
    if (isBuilt(m)) return false
    if (m === M_HEDGE || m === M_POOL || m === M_PLINTH) return false // the hedge, the fountain, a statue
    return m >= 4
  }
  function walkFloor(x, y) {
    const o = (((y | 0) & NM) << NSHIFT) | ((x | 0) & NM)
    const m = matMap[o]
    if (isTree(m) || m === 34) return floorMap[o]
    return heightMap[o]
  }
  function nearestStand(x, y, reach, spawn) {
    const x0 = x | 0
    const y0 = y | 0
    const ok = (xx, yy) => standable(xx, yy) && (!spawn || !smallIsle[((yy & NM) << NSHIFT) | (xx & NM)])
    if (ok(x0, y0)) return { x: x0 + 0.5, y: y0 + 0.5 }
    for (let r = 2; r <= reach; r += 3) {
      const n = Math.max(10, r * 2)
      for (let a = 0; a < n; a++) {
        const xx = (x0 + Math.cos((a / n) * Math.PI * 2) * r) | 0
        const yy = (y0 + Math.sin((a / n) * Math.PI * 2) * r) | 0
        if (ok(xx, yy)) return { x: xx + 0.5, y: yy + 0.5 }
      }
    }
    return null
  }
  function canStep(x0, y0, x1, y1) {
    if (!standable(x1 | 0, y1 | 0)) return false
    return walkFloor(x1, y1) - walkFloor(x0, y0) <= 4
  }
  function applyFootCamera() {
    const above = footView === 0
    const bob = aboard >= 0 ? Math.sin(time * 1.35) * 0.25 : 0
    const baseZ = (aboard >= 0 ? 2.2 : walker.z) + bob
    const sn = Math.sin(walker.yaw)
    const cs = Math.cos(walker.yaw)
    vC = 1
    vK = 0
    vRoll = 0
    jetFade = 1
    vCx = W >> 1
    vYaw = -walker.yaw
    vCos = Math.cos(vYaw)
    vSin = Math.sin(vYaw)
    if (aboard >= 0 && above) {
      // isometric: no perspective, looking down at about 32° from a fixed diagonal, so the map's
      // cells line up as diamonds and the boat turns on the screen instead of the world turning
      vYaw = BOAT_ISO_YAW
      vCos = Math.cos(vYaw)
      vSin = Math.sin(vYaw)
      vC = 0
      vK = 0
      vQ = 0
      vTan = BOAT_ISO_TAN
      vS = 4
      cam.x = walker.x
      cam.y = walker.y
      cam.alt = 0
      vCx = W >> 1
      vCy = H >> 1
      vSteerY = vCy
      vLean = 1
      cam.yaw = vYaw
      return
    }
    if (above) {
      const back = 9
      cam.x = walker.x - sn * back
      cam.y = walker.y + cs * back
      cam.alt = baseZ + 12
      const floor = walkFloor(cam.x, cam.y) + 4
      if (cam.alt < floor) cam.alt = floor
      if (cam.alt > CLOUD_ALT - 8) cam.alt = Math.max(floor, CLOUD_ALT - 8)
      vQ = 1 / 34
      vTan = 1.05
      vS = 16
      vCy = H * 0.4
    } else if (aboard >= 0) {
      // seated in the cockpit looking forward over the cabin top, rising and falling with the boat.
      // A true wide lens, like the plane's cockpit and walking in first person: the eye is BOAT_LOOK
      // behind the camera point, so the boat you sit in fills the bottom of the picture.
      const b = boats[aboard]
      const Y = YACHTS[b.kind] || YACHTS[0]
      const fe = yachtEyeF(Y) + BOAT_LOOK
      cam.x = walker.x + sn * fe
      cam.y = walker.y - cs * fe
      cam.alt = Math.sin(time * 1.35 + b.phase) * 0.14 + yachtDeck(Y, fe - BOAT_LOOK) + YACHT_EYE
      const focal = 0.45 * Math.max(W, H)
      vQ = 1 / BOAT_LOOK
      vS = focal / BOAT_LOOK
      vTan = 0
      vCy = H * 0.34
    } else {
      // a true lens at his eyes, like the seat in a boat: the camera point is WALK_LOOK ahead of the eyes
      // (just in front of his face), so what is behind him or right beside him falls outside the picture
      // by itself. (A long lens, with the eye far behind him, drew a wall at his back across the screen.)
      const fe = 0.35 + WALK_LOOK
      cam.x = walker.x + sn * fe
      cam.y = walker.y - cs * fe
      cam.alt = baseZ + 4.5 // the man's eyes
      const floor = walkFloor(walker.x, walker.y) + 1.4
      if (cam.alt < floor) cam.alt = floor
      vQ = 1 / WALK_LOOK
      vS = (WALK_FOCAL * Math.max(W, H)) / WALK_LOOK
      vTan = 0
      vCy = H * WALK_HORIZON
      vNear = WALK_NEAR - WALK_LOOK
    }
    vSteerY = vCy
    vLean = vTan
    cam.yaw = vYaw
  }
  function toggleFoot() {
    if (onFoot) {
      onFoot = false
      aboard = -1
      indoors = false
      keyMode = false
      holding = false
      boostKey = false
      walkTurn = 0
      walkMove = 0
      walkSide = 0
      sailing = false
      loungeReset()
      footLog.info('back to the jet')
      return false
    }
    const lead = jets[0]
    if (!lead) return false
    // Skip specks. A pier only exists on a large island, so it is the fallback when
    // the jet is over open water or a sandbar and the first search finds nothing.
    let how = ''
    let spot = nearestStand(lead.x, lead.y, 480, true)
    if (spot) how = 'nearby'
    let best = spot ? 480 * 480 : Infinity
    for (const dock of docks) {
      const dx = wrapDelta(dock.bx, lead.x)
      const dy = wrapDelta(dock.by, lead.y)
      const d = dx * dx + dy * dy
      if (d >= best) continue
      const shore = nearestStand(dock.bx, dock.by, 48, true)
      if (!shore) continue
      best = d
      spot = shore
      how = 'dock'
    }
    if (!spot) {
      let far = Infinity
      for (const isle of bigIsle) {
        const dx = wrapDelta(isle.x, lead.x)
        const dy = wrapDelta(isle.y, lead.y)
        const d = dx * dx + dy * dy
        if (d >= far) continue
        const shore = nearestStand(isle.x, isle.y, 160, true)
        if (!shore) continue
        far = d
        spot = shore
        how = 'island'
      }
    }
    if (!spot) {
      footLog.warn('nowhere to stand', { islands: bigIsle.length, docks: docks.length, specks: speckN })
      return false
    }
    footLog.info('spawned', { how, x: spot.x | 0, y: spot.y | 0 })
    walker.x = spot.x
    walker.y = spot.y
    walker.yaw = lead.yaw
    walker.z = walkFloor(spot.x, spot.y)
    aboard = -1
    footView = 0
    onFoot = true
    keyMode = false
    holding = false
    boostKey = false
    return true
  }
  function toggleFootView() {
    if (!onFoot || indoors) return
    footView = footView === 0 ? 1 : 0
  }
  /** a phone: turn the boat, or the plane overhead, to the way a finger drags on the screen (x right, y down),
   * or null when the finger lets go. Let go of the plane, it flies straight on, as after the keys. */
  function setAim(dx, dy) {
    const on = dx !== null && dx !== undefined && (aboard >= 0 || !onFoot)
    if (aimOn && !on && !onFoot) {
      keyMode = true
      keyTurn = 0
      keyClimb = 0
    }
    aimOn = on
    aimX = aimOn ? dx : 0
    aimY = aimOn ? dy : 0
  }
  function setWalk(turn, move, side = 0) {
    walkTurn = clamp(turn, -1, 1)
    walkMove = clamp(move, -1, 1)
    walkSide = clamp(side, -1, 1)
  }
  function board() {
    if (!onFoot || indoors) return false
    if (aboard >= 0) {
      const b = boats[aboard]
      const land = b ? nearestStand(b.x, b.y, 28) : null
      if (!land) {
        boatLog.warn('no shore to step onto')
        return false
      }
      walker.x = land.x
      walker.y = land.y
      walker.z = walkFloor(land.x, land.y)
      aboard = -1
      sailing = false
      loungeReset()
      boatLog.info('ashore')
      return true
    }
    let best = -1
    let bestD = 48 * 48
    for (let i = 0; i < boats.length; i++) {
      const b = boats[i]
      const dx = wrapDelta(b.x, walker.x)
      const dy = wrapDelta(b.y, walker.y)
      const d = dx * dx + dy * dy
      if (d < bestD) { bestD = d; best = i }
    }
    if (best < 0) {
      boatLog.warn('no boat in reach')
      return false
    }
    aboard = best
    sailing = false
    loungeReset()
    boats[best].moored = true
    boatLog.info('boarded', { boat: best, moored: true })
    walker.x = boats[best].x
    walker.y = boats[best].y
    walker.yaw = boats[best].yaw
    return true
  }
  /**
   * a tap on a phone while aboard: set sail if the boat lies still, or stop it. Enzo out on deck goes back
   * to the cockpit first, as he does for W. Whether the boat is now under way, or about to be.
   */
  function sailToggle() {
    if (!onFoot || aboard < 0) return false
    const b = boats[aboard]
    if (!b) return false
    if (sailing) {
      sailing = false
      return false
    }
    if (lounge > 0 || loungeDir !== 0) {
      loungeGo = true
      loungeDir = -1
      return true
    }
    castOff(b)
    return true
  }
  function castOff(b) {
    sailing = true
    b.moored = false
    b.leg = 0
    b.berth = -1
    b.stuck = 0
  }
  function loungeReset() {
    restT = 0
    lounge = 0
    loungeDir = 0
    loungeGo = false
  }
  /**
   * Enzo out on deck. After LOUNGE_WAIT seconds lying still in the overhead view with no key
   * down, he comes up through the forehatch and sits on the rail on the side facing the camera.
   * W, A or D send him back down first; a W pressed meanwhile casts off once he is in. Returns
   * true while he is out, when the boat must hold still.
   */
  function loungeStep(b, dt) {
    if (loungeDir === 0) {
      const still = !sailing && footView === 0 && walkMove === 0 && walkTurn === 0 && !aimOn
      restT = still ? restT + dt : 0
      if (restT < LOUNGE_WAIT) return false
      loungeReset()
      loungeDir = 1
      // across +1 faces the camera when sin(yaw + its yaw) > 0 (see the sail lighting in rasterVox)
      loungeSide = Math.sin(b.yaw + BOAT_ISO_YAW) >= 0 ? 1 : -1
      boatLog.info('Enzo comes up on deck', { side: loungeSide > 0 ? 'starboard' : 'port' })
    }
    // in first person the eye is his, back in the cockpit
    if (footView !== 0) {
      loungeReset()
      return false
    }
    if (walkMove > 0) loungeGo = true
    if (loungeDir > 0 && (walkMove > 0 || walkTurn !== 0 || aimOn)) loungeDir = -1
    lounge = Math.min(LOUNGE_END, lounge + loungeDir * dt * (loungeDir < 0 ? LOUNGE_BACK : 1))
    if (lounge > 0) return true
    const go = loungeGo
    loungeReset()
    if (go) castOff(b)
    return false
  }
  function stepFoot(dt) {
    if (!onFoot) return
    if (indoors) {
      if (room.step(dt, walkTurn, walkMove, walkSide)) leaveMuseum()
      return
    }
    if (aboard >= 0) {
      const b = boats[aboard]
      if (!b) { aboard = -1; return }
      if (!loungeStep(b, dt)) {
        let turn = walkTurn
        if (aimOn) {
          // the screen's up is the world's heading −vYaw, so the drag is a heading in the world: turn to it
          // at the rate of A and D. In first person the view turns with the boat, so it keeps turning while
          // the finger is held off to one side, like a tiller.
          const d = wrapAngle(-vYaw + Math.atan2(aimX, -aimY) - b.yaw)
          turn = clamp(turn + d * 3, -1, 1)
        }
        b.yaw += turn * 1.15 * dt
        if (walkMove < 0) sailing = false
        if (walkMove > 0) castOff(b)
      }
      if (sailing) {
        const spd = 12 * (1 + 0.42 * windAlong(b.yaw))
        const nx = b.x + Math.sin(b.yaw) * spd * dt
        const ny = b.y - Math.cos(b.yaw) * spd * dt
        if (matAt(nx, ny) < 4) {
          b.x = wrapPos(nx)
          b.y = wrapPos(ny)
        }
      }
      b.x = wrapPos(b.x)
      b.y = wrapPos(b.y)
      walker.x = b.x
      walker.y = b.y
      walker.yaw = b.yaw
      walker.z = 2.2
      const ghostGoal = sailing && footView === 1 ? 1 : 0
      rigGhost += (ghostGoal - rigGhost) * (1 - Math.exp(-dt * 1.6))
      return
    }
    walker.yaw += walkTurn * 2.1 * dt
    if (walkMove !== 0 || walkSide !== 0) {
      // forward is (sin, −cos) and right is (cos, sin); a diagonal is no faster than a straight walk
      const sn = Math.sin(walker.yaw)
      const cs = Math.cos(walker.yaw)
      const k = (20 * dt) / Math.max(1, Math.hypot(walkMove, walkSide))
      const nx = walker.x + (sn * walkMove + cs * walkSide) * k
      const ny = walker.y + (-cs * walkMove + sn * walkSide) * k
      if (atMuseumDoor(nx, ny)) {
        enterMuseum()
        return
      }
      if (canStep(walker.x, walker.y, nx, ny)) {
        walker.x = wrapPos(nx)
        walker.y = wrapPos(ny)
      }
    }
    walker.z = walkFloor(walker.x, walker.y)
  }

  /** (x, y) in the museum's own across and forward (the doors are at +f) */
  function museumLocal(x, y) {
    const c = Math.round(Math.cos(museum.yaw))
    const s = Math.round(Math.sin(museum.yaw))
    const dx = wrapDelta(x, museum.x)
    const dy = wrapDelta(y, museum.y)
    return [dx * c + dy * s, dx * s - dy * c]
  }
  /** a step to (x, y) goes up the steps and in at the middle doors */
  function atMuseumDoor(x, y) {
    if (!museum) return false
    const [a, f] = museumLocal(x, y)
    return Math.abs(a) <= 4.6 && f > MU_CF && f < 9.6
  }
  function enterMuseum() {
    indoors = true
    room.enter()
    footLog.info('into the museum')
  }
  /** out through the door: on the forecourt before the steps, facing away from them */
  function leaveMuseum() {
    indoors = false
    if (!museum) return
    const c = Math.round(Math.cos(museum.yaw))
    const s = Math.round(Math.sin(museum.yaw))
    const f = 11.5
    walker.x = wrapPos(museum.x + f * s)
    walker.y = wrapPos(museum.y - f * c)
    walker.yaw = museum.yaw
    walker.z = walkFloor(walker.x, walker.y)
    footLog.info('out of the museum')
  }

  // How far the water runs from (x, y) along a heading, checking the bow line and, close in, the beam.
  function seaClear(x, y, yaw, dist) {
    const sn = Math.sin(yaw)
    const cs = Math.cos(yaw)
    const rx = cs
    const ry = sn
    for (let d = 4; d <= dist; d += 4) {
      const fx = x + sn * d
      const fy = y - cs * d
      if (matAt(fx, fy) >= 4) return d - 4
      if (d <= 20) {
        if (matAt(fx + rx * 3.5, fy + ry * 3.5) >= 4) return d - 4
        if (matAt(fx - rx * 3.5, fy - ry * 3.5) >= 4) return d - 4
      }
    }
    return dist
  }

  function landNear(x, y, max) {
    let best = max + 1
    let bx = 0
    let by = 0
    for (let a = 0; a < 8; a++) {
      const ang = a * 0.785398
      const sx = Math.cos(ang)
      const sy = Math.sin(ang)
      for (let d = 8; d <= max; d += 8) {
        if (matAt(x + sx * d, y + sy * d) >= 4) {
          if (d < best) { best = d; bx = sx; by = sy }
          break
        }
      }
    }
    return { d: best, x: bx, y: by }
  }

  // Just seaward of the sloop already at the pier, so a second boat can tie up without sitting on it.
  function offDock(dock, dist) {
    return {
      x: wrapPos(dock.bx + Math.sin(dock.yaw) * dist),
      y: wrapPos(dock.by - Math.cos(dock.yaw) * dist),
    }
  }

  function spotTaken(x, y, self) {
    for (let k = 0; k < boats.length; k++) {
      const o = boats[k]
      if (o === self) continue
      const dx = wrapDelta(o.x, x)
      const dy = wrapDelta(o.y, y)
      if (dx * dx + dy * dy < 14 * 14) return true
    }
    return false
  }

  function spotOk(b) {
    if (b.berth < 0 || b.berth >= docks.length) return false
    const spot = offDock(docks[b.berth], 24)
    return matAt(spot.x, spot.y) < 4 && !spotTaken(spot.x, spot.y, b)
  }

  function pickBerth(b) {
    let best = -1
    let bestD = 700 * 700
    for (let i = 0; i < docks.length; i++) {
      const spot = offDock(docks[i], 24)
      if (matAt(spot.x, spot.y) >= 4) continue
      if (seaClear(spot.x, spot.y, docks[i].yaw, 16) < 10) continue
      if (spotTaken(spot.x, spot.y, b)) continue
      const dx = wrapDelta(spot.x, b.x)
      const dy = wrapDelta(spot.y, b.y)
      const dd = dx * dx + dy * dy
      if (dd < bestD) { bestD = dd; best = i }
    }
    b.berth = best
  }

  // Parallel to a nearby shore, or a gentle curve back toward land when the sea is empty.
  function coastSteer(b) {
    const land = landNear(b.x, b.y, 72)
    if (land.d > 72) return Math.sin(time * 0.07 + b.phase) * 0.2
    const toLand = Math.atan2(land.x, -land.y)
    if (land.d >= 28) {
      const side = b.phase < Math.PI ? 0.85 : -0.85
      return clamp(wrapAngle(toLand + side - b.yaw) * 0.55, -0.4, 0.4)
    }
    const a = toLand - Math.PI / 2
    const c = toLand + Math.PI / 2
    const parallel = Math.abs(wrapAngle(a - b.yaw)) < Math.abs(wrapAngle(c - b.yaw)) ? a : c
    return clamp(wrapAngle(parallel - b.yaw) * 0.8, -0.45, 0.45)
  }

  function steerBoat(b) {
    const wander = Math.sin(time * 0.09 + b.phase) * 0.1
    if (b.intent === 1 && b.berth >= 0) {
      const dock = docks[b.berth]
      const spot = offDock(dock, 24)
      const dx = wrapDelta(spot.x, b.x)
      const dy = wrapDelta(spot.y, b.y)
      const dist = Math.hypot(dx, dy)
      if (dist > 0.5 && matAt(spot.x, spot.y) < 4) {
        const aim = Math.atan2(dx, -dy)
        const mix = dist < 40 ? clamp((40 - dist) / 40, 0, 0.65) : 0
        return clamp(wrapAngle(aim + wrapAngle(dock.yaw - aim) * mix - b.yaw) * 1.25, -1.05, 1.05)
      }
    }
    return coastSteer(b) + wander
  }

  function crowdTurn(b) {
    const sn = Math.sin(b.yaw)
    const cs = Math.cos(b.yaw)
    let push = 0
    for (let k = 0; k < boats.length; k++) {
      const o = boats[k]
      if (o === b) continue
      const dx = wrapDelta(o.x, b.x)
      const dy = wrapDelta(o.y, b.y)
      const d2 = dx * dx + dy * dy
      if (d2 > 26 * 26 || d2 < 0.01) continue
      const along = dx * sn - dy * cs
      if (along < 2) continue
      const side = dx * cs + dy * sn
      push += (side >= 0 ? -1 : 1) * (along < 12 ? 1 : 0.45)
    }
    return clamp(push, -1.2, 1.2)
  }

  function hullHitsBoat(b, x, y) {
    for (let k = 0; k < boats.length; k++) {
      const o = boats[k]
      if (o === b) continue
      const dx = wrapDelta(o.x, x)
      const dy = wrapDelta(o.y, y)
      if (dx * dx + dy * dy < 11 * 11) return true
    }
    return false
  }

  function lineWater(x, y, tx, ty) {
    const dx = wrapDelta(tx, x)
    const dy = wrapDelta(ty, y)
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 3))
    for (let s = 1; s <= steps; s++) {
      if (matAt(x + (dx * s) / steps, y + (dy * s) / steps) >= 4) return false
    }
    return true
  }

  function tryDock(b, i) {
    if (b.berth < 0 || !spotOk(b)) { b.berth = spotOk(b) ? b.berth : -1; return }
    const dock = docks[b.berth]
    const spot = offDock(dock, 24)
    const sx = wrapDelta(spot.x, b.x)
    const sy = wrapDelta(spot.y, b.y)
    if (sx * sx + sy * sy > 6 * 6) return
    b.x = spot.x
    b.y = spot.y
    b.yaw = dock.yaw
    b.moored = true
    b.turn = 0
    boatLog.info('tied up at a dock', { boat: i })
  }

  function tryAnchor(b, i) {
    if (b.leg < 28) return
    const land = landNear(b.x, b.y, 40)
    if (land.d < 16 || land.d > 24) return
    if (seaClear(b.x, b.y, b.yaw, 28) < 20) return
    const sn = Math.sin(b.yaw)
    const cs = Math.cos(b.yaw)
    const rx = cs
    const ry = sn
    if (matAt(b.x + rx * 5, b.y + ry * 5) >= 4 || matAt(b.x - rx * 5, b.y - ry * 5) >= 4) return
    if (matAt(b.x + sn * 8, b.y - cs * 8) >= 4 || matAt(b.x - sn * 8, b.y + cs * 8) >= 4) return
    for (let k = 0; k < docks.length; k++) {
      const dx = wrapDelta(b.x, docks[k].bx)
      const dy = wrapDelta(b.y, docks[k].by)
      if (dx * dx + dy * dy < 40 * 40) return
    }
    b.moored = true
    b.turn = 0
    boatLog.info('sails down near shore', { boat: i })
  }

  function stepBoats(dt) {
    for (let i = 0; i < boats.length; i++) {
      const b = boats[i]
      if (i === aboard || b.moored) continue
      b.leg += dt
      if (b.intent === 1) {
        b.seek += dt
        if (!spotOk(b) && b.seek > 2) {
          pickBerth(b)
          b.seek = 0
        } else if (spotOk(b) && b.seek > 25) {
          const spot = offDock(docks[b.berth], 24)
          const dx = wrapDelta(spot.x, b.x)
          const dy = wrapDelta(spot.y, b.y)
          if (dx * dx + dy * dy > 90 * 90) { pickBerth(b); b.seek = 0 }
          else b.seek = 20
        }
      }
      let homing = null
      if (b.intent === 1 && spotOk(b)) {
        const spot = offDock(docks[b.berth], 24)
        const dx = wrapDelta(spot.x, b.x)
        const dy = wrapDelta(spot.y, b.y)
        homing = { dx, dy, dist: Math.hypot(dx, dy) }
        if (homing.dist < 10 && matAt(b.x, b.y) < 4 && lineWater(b.x, b.y, spot.x, spot.y)) {
          b.x = spot.x
          b.y = spot.y
          b.yaw = docks[b.berth].yaw
          b.moored = true
          b.turn = 0
          boatLog.info('tied up at a dock', { boat: i })
          continue
        }
      }
      const ahead = seaClear(b.x, b.y, b.yaw, 52)
      let want
      if (homing && homing.dist < 48 && ahead > 10) {
        if (b.avoidT > 0) b.avoidT -= dt
        want = clamp(wrapAngle(Math.atan2(homing.dx, -homing.dy) - b.yaw) * 1.4, -1.15, 1.15)
      } else if (ahead < 34) {
        const left = seaClear(b.x, b.y, b.yaw - 0.85, 52) + seaClear(b.x, b.y, b.yaw - 1.5, 48)
        const right = seaClear(b.x, b.y, b.yaw + 0.85, 52) + seaClear(b.x, b.y, b.yaw + 1.5, 48)
        let dir
        if (b.avoid && b.avoidT > 0 && ahead > 8) dir = b.avoid
        else if (left === right) dir = b.avoid || (b.phase < Math.PI ? -1 : 1)
        else dir = left > right ? -1 : 1
        b.avoid = dir
        b.avoidT = ahead < 16 ? 2.2 : 1.3
        want = dir * (ahead < 12 ? 1.55 : ahead < 22 ? 1.05 : 0.62)
      } else {
        if (b.avoidT > 0) b.avoidT -= dt
        else b.avoid = 0
        const land = landNear(b.x, b.y, 72)
        if (land.d < 14) {
          want = clamp(wrapAngle(Math.atan2(-land.x, land.y) - b.yaw) * 1.1, -1.3, 1.3)
        } else if (b.avoidT > 0) {
          want = b.avoid * 0.35
        } else {
          want = steerBoat(b)
        }
      }
      const crowd = crowdTurn(b)
      if (crowd) want = clamp(want + crowd, -1.6, 1.6)
      b.turn += (want - b.turn) * (1 - Math.exp(-dt * 2.4))
      const rate = ahead < 14 ? 1.7 : 1.05
      b.yaw = wrapAngle(b.yaw + b.turn * dt * rate)
      let spd = b.speed * (ahead < 18 ? 0.55 : 1) * (1 - 0.35 * Math.min(1, Math.abs(b.turn)))
      if (crowd) spd *= 0.7
      if (homing && homing.dist < 36) spd *= clamp(homing.dist / 22, 0.4, 1)
      const sn = Math.sin(b.yaw)
      const cs = Math.cos(b.yaw)
      const nx = b.x + sn * spd * dt
      const ny = b.y - cs * spd * dt
      const bow = ahead < 14 ? 6 : 8
      const open = matAt(nx, ny) < 4
        && matAt(nx + sn * bow, ny - cs * bow) < 4
        && matAt(nx + cs * 3.5, ny + sn * 3.5) < 4
        && matAt(nx - cs * 3.5, ny - sn * 3.5) < 4
        && !hullHitsBoat(b, nx, ny)
      if (open) {
        b.x = wrapPos(nx)
        b.y = wrapPos(ny)
        b.stuck = 0
      } else {
        b.stuck += dt
        const kick = b.avoid || (b.phase < Math.PI ? -1 : 1)
        b.yaw = wrapAngle(b.yaw + kick * (1.5 + Math.min(b.stuck, 2.5)) * dt)
      }
      if (b.intent === 1) tryDock(b, i)
      else if (b.intent === 2) tryAnchor(b, i)
    }
    trimSails(dt)
    replenishDocks(dt)
  }

  // Sails up while under way, furled when moored or stopped. The boom swings out to leeward, further the
  // more the wind is from behind, and crosses over (a gybe) when the wind changes side. The hull heels away
  // from the wind, most on a reach.
  function trimSails(dt) {
    const ease = (k) => 1 - Math.exp(-dt * k)
    for (let i = 0; i < boats.length; i++) {
      const b = boats[i]
      const going = i === aboard ? sailing : !b.moored
      b.v = going ? (i === aboard ? 12 * (1 + 0.42 * windAlong(b.yaw)) : b.speed) : 0
      b.sail += ((going ? 1 : 0) - b.sail) * ease(going ? 0.9 : 1.6)
      const rel = wrapAngle(windYaw - b.yaw)
      const across = Math.sin(rel)
      const off = Math.PI - Math.abs(rel) // 0 head to wind … π dead downwind
      const swing = clamp((off - 0.45) * 0.62, 0.1, 1.3)
      let side = b.boom >= 0 ? 1 : -1
      if (Math.abs(across) > 0.12) side = across > 0 ? 1 : -1
      const boomGoal = going ? side * swing : Math.sin(time * 0.4 + b.phase) * 0.05
      b.boom += (boomGoal - b.boom) * ease(1.8)
      const heelGoal = going ? side * 0.2 * Math.pow(Math.abs(across), 0.8) * b.sail * clamp(b.v / 7, 0.4, 1.3) : 0
      b.heel += (heelGoal - b.heel) * ease(1.2)
    }
  }

  let dockWait = 0
  function replenishDocks(dt) {
    dockWait -= dt
    if (dockWait > 0 || docks.length === 0) return
    dockWait = 0.6
    if (boats.length > docks.length + 14) return
    for (const dock of docks) {
      let taken = false
      for (const b of boats) {
        const dx = wrapDelta(b.x, dock.bx)
        const dy = wrapDelta(b.y, dock.by)
        if (dx * dx + dy * dy < 26 * 26) { taken = true; break }
      }
      if (taken) continue
      if (onFoot) {
        const dx = wrapDelta(walker.x, dock.bx)
        const dy = wrapDelta(walker.y, dock.by)
        if (dx * dx + dy * dy < 48 * 48) continue
      }
      boats.push(makeBoat(dock.bx, dock.by, dock.yaw, 0, HULL_PICK[(boats.length * 7 + 3) % HULL_PICK.length], true, 7, boats.length * 0.4))
    }
  }

  function stepBombs(dt) {
    if (bombHeld) dropBomb()
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i]
      b.vz -= 95 * dt
      if (b.vz < -220) b.vz = -220
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.z += b.vz * dt
      const floor = groundAt(b.x, b.y)
      if (b.z <= floor + 0.6) {
        explode(b.x, b.y, floor)
        bombs.splice(i, 1)
      }
    }
    for (let i = 0; i < BOOM_N; i++) {
      const o = i * BOOM_F
      if (boom[o + 7] <= 0) continue
      if (time - boom[o + 6] >= boom[o + 7]) {
        boom[o + 7] = 0
        continue
      }
      boom[o + 5] -= 70 * dt
      boom[o] += boom[o + 3] * dt
      boom[o + 1] += boom[o + 4] * dt
      boom[o + 2] += boom[o + 5] * dt
      const floor = groundAt(boom[o], boom[o + 1])
      if (boom[o + 2] < floor) {
        boom[o + 2] = floor
        boom[o + 5] *= -0.25
        boom[o + 3] *= 0.55
        boom[o + 4] *= 0.55
      }
    }
    for (let i = blasts.length - 1; i >= 0; i--) {
      if (time - blasts[i].t >= blasts[i].life) blasts.splice(i, 1)
    }
  }

  // ── simulation
  function step(dtRaw) {
    const dt = clamp(dtRaw, 0, 0.05)
    time += dt
    introT += dt
    pointerIdle += dt
    if (holding) holdT += dt
    if (worldDirty > 0) {
      worldDirty -= dt
      if (worldDirty <= 0) {
        buildWorld()
        if (onFoot) {
          aboard = -1
          const spot = nearestStand(walker.x, walker.y, 100, true)
          if (spot) {
            walker.x = spot.x
            walker.y = spot.y
            walker.z = walkFloor(spot.x, spot.y)
          }
        }
        if (reseat) {
          const dx = spawnX - jets[0].x
          const dy = spawnY - jets[0].y
          for (const j of jets) { j.x += dx; j.y += dy; j.trailLen = 0; j.lastTrailX = j.x; j.lastTrailY = j.y }
          follow.x += dx
          follow.y += dy
          reseat = false
        }
      }
    }
    // dusk or dawn: the light moves at an even pace, eased at both ends, and every palette follows it
    // (the cockpit is not repainted: it takes the light as a tone when it is laid on)
    if (dayLin !== dayGoal) {
      const d = dt / DAY_FADE
      dayLin = dayGoal > dayLin ? Math.min(dayGoal, dayLin + d) : Math.max(dayGoal, dayLin - d)
      setPhase(easeDay(dayLin))
      rebuildPalettes(false)
      if (dayLin === dayGoal) NIGHT_LOG.info(dayGoal > 0.5 ? 'night has fallen' : 'day has come')
    }
    if (!cockpit && W > 0) {
      cockpitDue -= dt
      if (cockpitDue <= 0) cockpitArt()
    }
    const introDone = introT > 1.9
    burn += ((introDone ? 1 : 0) - burn) * (1 - Math.exp(-dt * 5))

    // holding down opens the thrusters: longer flames, more speed
    const pushing = introDone && ((holding && holdT >= HOLD) || boostKey)
    boost += ((pushing ? 1 : 0) - boost) * (1 - Math.exp(-dt * (pushing ? 5 : 2.4)))
    if (boost < 0.0005 && !pushing) boost = 0
    const lead = jets[0]
    const wind = 1 + 0.26 * windAlong(lead.yaw)
    const speed = p.speed * wind * (1 + (clamp(p.boost, 1, 4) - 1) * boost)
    speedNow = speed
    spreadNow += (p.spread - spreadNow) * (1 - Math.exp(-dt * 11))

    const maxRate = Math.max(0.1, p.agility)
    // how low and how high it may fly: it skims whatever ground lies ahead, with a little
    // room to spare, so it can get close but never hit anything; the ceiling is a setting
    const clearance = clamp(p.clearance, 2, 60)
    const floorNow = groundAhead(lead, speed) + clearance
    if (floorS === 0) floorS = floorNow
    floorS += (floorNow - floorS) * (1 - Math.exp(-dt * (floorNow > floorS ? 9 : 3)))
    const altLo = floorS
    const altHi = Math.max(altLo, p.altitude, clamp(p.ceiling, 20, 900))
    const climbMax = speed * 0.55
    const chase = vC + vK > 0.5 // flying from behind or from the seat

    // where to turn and, from behind, how high to fly
    let want = 0
    let flown = false // true while the player is choosing the height
    if (onFoot) keyMode = false
    const steering = !onFoot && p.followPointer && pointerOn && pointerIdle < 5
    if (!introDone) {
      want = 0
    } else if (!onFoot && aimOn && !chase) {
      // a finger dragging overhead: turn to point the way of the drag, as in a boat
      flown = true
      const fx = aimX * vCos + aimY * vSin
      const fy = -aimX * vSin + aimY * vCos
      want = clamp(wrapAngle(Math.atan2(fx, -fy) - lead.yaw) * 2.6, -maxRate, maxRate)
    } else if (!onFoot && keyMode) {
      want = keyTurn * maxRate
      altGoal += keyClimb * climbMax * dt
      flown = true
    } else if (steering && (chase || project(lead.x, lead.y, lead.z))) {
      const vx = pointerX - prX
      const vy = pointerY - prY
      if (chase) {
        // from behind: point left or right of the jet to turn, above or below it to climb or dive
        const t = clamp((pointerX - vCx) / (W * 0.26), -1, 1)
        if (Math.abs(t) > 0.06) want = t * maxRate
        const raw = pointerY < vSteerY ? (vSteerY - pointerY) / Math.max(1, vSteerY) : -(pointerY - vSteerY) / Math.max(1, H - vSteerY)
        const up = Math.sign(raw) * Math.max(0, Math.abs(raw) - 0.08) / 0.92
        altGoal = up >= 0 ? p.altitude + up * (altHi - p.altitude) : p.altitude + up * (p.altitude - altLo)
        flown = true
      } else {
        flown = true // overhead: keep the height it was flown to
        if (vx * vx + vy * vy > 18 * 18) {
        const fx = vx * vCos + vy * vSin
        const fy = -vx * vSin + vy * vCos
          const err = wrapAngle(Math.atan2(fx, -fy) - lead.yaw)
          want = clamp(err * 2.6, -maxRate, maxRate)
        }
      }
    } else {
      want = maxRate * (0.62 * Math.sin(time * 0.31 + 1.3) + 0.38 * Math.sin(time * 0.73 + 0.4) + 0.22 * Math.sin(time * 0.17))
      want = clamp(want, -maxRate, maxRate)
      if (p.stunts) {
        autoStunt -= dt
        if (autoStunt <= 0) { startRoll(); autoStunt = 9 + (hash8((time * 10) | 0) / 255) * 7 }
      }
    }
    lead.yawRate += (want - lead.yawRate) * (1 - Math.exp(-dt * 2.6))
    lead.yaw += lead.yawRate * dt
    const bankMax = (p.bank * Math.PI) / 180
    const rollTarget = clamp(lead.yawRate / maxRate, -1, 1) * bankMax
    lead.roll += (rollTarget - lead.roll) * (1 - Math.exp(-dt * 5))
    lead.vx = Math.sin(lead.yaw) * speed
    lead.vy = -Math.cos(lead.yaw) * speed
    lead.x += lead.vx * dt
    lead.y += lead.vy * dt
    // height: left alone it drifts back to cruising; it climbs and dives at a limited rate
    if (!flown) altGoal += (p.altitude - altGoal) * (1 - Math.exp(-dt * 0.9))
    altGoal = clamp(altGoal, altLo, altHi)
    let dz = (altGoal + Math.sin(time * 0.9) * 1.5 - lead.z) * (1 - Math.exp(-dt * 3))
    dz = clamp(dz, -climbMax * dt, climbMax * dt)
    lead.z += dz
    // last resort: never closer to what is right underneath than most of the clearance
    const hard = groundAt(lead.x, lead.y) + clearance * 0.7
    if (lead.z < hard) lead.z += (hard - lead.z) * (1 - Math.exp(-dt * 22))
    climbV += (dz / Math.max(dt, 1e-4) - climbV) * (1 - Math.exp(-dt * 6))
    // nose up in a climb, down in a dive (the gentle cruise bob does not count)
    const climbing = Math.sign(climbV) * Math.max(0, Math.abs(climbV) - 3)
    climbTilt = clamp((climbing / Math.max(20, speed)) * 1.25, -0.5, 0.5)
    const pitchTarget = Math.abs(lead.yawRate / maxRate) * 0.1 + climbTilt
    lead.pitch += (pitchTarget - lead.pitch) * (1 - Math.exp(-dt * 4))
    // the pilot's head: it leans into a turn, sinks in a climb and under thrust, lifts in a
    // dive, and is never quite still. On a soft spring, so it overshoots a little and settles.
    const hxGoal = clamp(lead.yawRate / maxRate, -1, 1) * 6.4 + Math.sin(time * 0.53) * 0.3
    const hyGoal = clamp(climbTilt / 0.5, -1, 1) * 3.4 + boost * 1.6 + Math.sin(time * 0.71 + 1) * 0.25
    headVX += ((hxGoal - headX) * 64 - headVX * 11) * dt
    headVY += ((hyGoal - headY) * 64 - headVY * 11) * dt
    headX = clamp(headX + headVX * dt, -8, 8)
    headY = clamp(headY + headVY * dt, -5, 5)

    // wingmen hold formation
    for (let i = 1; i < jets.length; i++) {
      const j = jets[i]
      const side = i === 1 ? -1 : 1
      const tx = lead.x + Math.cos(lead.yaw) * side * formX() - Math.sin(lead.yaw) * formY()
      const ty = lead.y + Math.sin(lead.yaw) * side * formX() + Math.cos(lead.yaw) * formY()
      const k = 1 - Math.exp(-dt * 3.2)
      const ox = j.x
      const oy = j.y
      j.x += lead.vx * dt + (tx - (j.x + lead.vx * dt)) * k
      j.y += lead.vy * dt + (ty - (j.y + lead.vy * dt)) * k
      j.vx = (j.x - ox) / Math.max(dt, 1e-4)
      j.vy = (j.y - oy) / Math.max(dt, 1e-4)
      j.yaw += wrapAngle(lead.yaw - j.yaw) * (1 - Math.exp(-dt * 4))
      j.roll += (lead.roll - j.roll) * (1 - Math.exp(-dt * 3.2))
      j.pitch = lead.pitch
      j.z += (lead.z + Math.sin(time * 1.1 + i * 2) * 1.2 - j.z) * (1 - Math.exp(-dt * 3))
      j.z = Math.max(j.z, groundAt(j.x, j.y) + clearance * 0.7)
    }

    for (const j of jets) {
      const gNow = clamp(Math.abs(lead.yawRate) / maxRate + (j.stunt >= 0 ? 0.7 : 0) + boost * 0.9 + Math.abs(climbTilt), 0, 1)
      j.g += (gNow - j.g) * (1 - Math.exp(-dt * 2.5))
      if (j.stunt >= 0) {
        if (j.stuntDelay > 0) j.stuntDelay -= dt
        else {
          j.stunt += dt / 0.85
          if (j.stunt >= 1) j.stunt = -1
        }
      }
      // wingtip trails
      const ddx = j.x - j.lastTrailX
      const ddy = j.y - j.lastTrailY
      if (ddx * ddx + ddy * ddy > 6.25) {
        j.lastTrailX = j.x
        j.lastTrailY = j.y
        const ax = axes(j)
        for (let w = 0; w < 2; w++) {
          const sc = jetSize()
          const a = (w === 0 ? -WINGTIP_A : WINGTIP_A) * sc
          const b = (PIV_K - WINGTIP_K) * sc
          const hy = (WINGTIP_Y - PIV_Y) * sc
          const o = j.trailHead * 4
          j.trail[w][o] = j.x + a * ax.rx + b * ax.fx + hy * ax.ux
          j.trail[w][o + 1] = j.y + a * ax.ry + b * ax.fy + hy * ax.uy
          j.trail[w][o + 2] = j.z + a * ax.rz + b * ax.fz + hy * ax.uz
          j.trail[w][o + 3] = time
        }
        j.trailHead = (j.trailHead + 1) % TRAIL_N
        if (j.trailLen < TRAIL_N) j.trailLen++
      }
    }

    // the air is not quite smooth: now and then a bump kicks the plane, which rocks and settles.
    // Each bump is four small springs (roll, pitch, yaw, height); between bumps it sways gently.
    for (let i = 0; i < jets.length; i++) {
      const j = jets[i]
      j.joltNext -= dt
      if (j.joltNext <= 0) {
        const n = ++j.joltN * 7 + i * 131 + (p.seed | 0)
        const r = (k) => hash8(n * 13 + k) / 255 - 0.5
        const hard = 0.55 + (hash8(n * 29) / 255) * 0.9
        j.joltNext = 0.8 + (hash8(n * 3 + 1) / 255) * 2.6
        j.joltRV += r(1) * 0.9 * hard
        j.joltPV += r(2) * 0.5 * hard
        j.joltYV += r(3) * 0.3 * hard
        j.joltZV += r(4) * 9 * hard
      }
      const k = Math.min(dt, 0.05)
      const sway = Math.sin(time * 1.3 + i * 2.1) * 0.012 + Math.sin(time * 2.9 + i) * 0.008
      j.joltRV += (-60 * (j.joltR - sway) - 6.5 * j.joltRV) * k
      j.joltPV += (-60 * j.joltP - 6.5 * j.joltPV) * k
      j.joltYV += (-45 * j.joltY - 6 * j.joltYV) * k
      j.joltZV += (-55 * j.joltZ - 6 * j.joltZV) * k
      j.joltR += j.joltRV * k
      j.joltP += j.joltPV * k
      j.joltY += j.joltYV * k
      j.joltZ += j.joltZV * k
      // the propeller: ticking over, faster with the throttle open
      j.propAngle = (j.propAngle + dt * (24 + 26 * boost)) % (Math.PI * 2)
    }

    // white smoke streams from under the tail while the throttle is open or a stunt is flown,
    // the way display pilots trail it, and hangs in the air behind
    smokeClock += dt
    const smokeOn = boost > 0.2 || lead.stunt >= 0
    if (smokeClock >= 0.03 && burn > 0.6 && spreadNow < 2 && smokeOn) {
      smokeClock = 0
      const sc = jetSize()
      for (let i = 0; i < jets.length; i++) {
        const j = jets[i]
        const ax = axes(j)
        const a = JET_SMOKE_A * sc
        const b = (PIV_K - JET_SMOKE_K) * sc
        const hy = (JET_SMOKE_Y - PIV_Y) * sc
        const o = smokeHead * SMOKE_F
        smoke[o] = j.x + a * ax.rx + b * ax.fx + hy * ax.ux
        smoke[o + 1] = j.y + a * ax.ry + b * ax.fy + hy * ax.uy
        smoke[o + 2] = j.z + a * ax.rz + b * ax.fz + hy * ax.uz
        smoke[o + 3] = time
        smoke[o + 4] = (1.6 + (hash8(smokeHead * 31 + 7) / 255) * 1.0) * sc
        smoke[o + 5] = -j.vx * 0.25 + (hash8(smokeHead * 17 + 3) - 128) * 0.03
        smoke[o + 6] = -j.vy * 0.25 + (hash8(smokeHead * 13 + 5) - 128) * 0.03
        smoke[o + 7] = 0.5 + 0.3 * Math.max(boost, j.stunt >= 0 ? 0.6 : 0)
        smoke[o + 8] = 1.6 + 0.8 * boost + (hash8(smokeHead * 5) / 255) * 0.4
        smokeHead = (smokeHead + 1) % SMOKE_N
      }
    }

    // the view weights glide to their goals (three soft stages each)
    const goC = viewTarget === 1 ? 1 : 0
    const goK = viewTarget === 2 ? 1 : 0
    const ease = 1 - Math.exp((-dt * 7.6) / clamp(p.transition, 0.2, 8))
    let settled = true
    for (let i = 0; i < 3; i++) {
      wChase[i] += ((i === 0 ? goC : wChase[i - 1]) - wChase[i]) * ease
      wCock[i] += ((i === 0 ? goK : wCock[i - 1]) - wCock[i]) * ease
      if (Math.abs(wChase[i] - goC) > 0.0004 || Math.abs(wCock[i] - goK) > 0.0004) settled = false
    }
    if (settled) {
      wChase.fill(goC)
      wCock.fill(goK)
    }
    vC = wChase[2]
    vK = wCock[2]

    // camera: ahead of the leader, turning part of the way with it
    const look = (22 + 16 * boost) * (1 - vC - vK)
    const tx = lead.x + Math.sin(lead.yaw) * look
    const ty = lead.y - Math.cos(lead.yaw) * look
    const kc = 1 - Math.exp(-dt * 3.5)
    follow.x += lead.vx * dt + (tx - (follow.x + lead.vx * dt)) * kc
    follow.y += lead.vy * dt + (ty - (follow.y + lead.vy * dt)) * kc
    cam.yaw += (-lead.yaw * clamp(p.cameraFollow, 0, 1) - cam.yaw) * (1 - Math.exp(-dt * 1.6))
    follow.alt += (lead.z - follow.alt) * (1 - Math.exp(-dt * 3))
    // the chase camera keeps clear of the hills behind the jet, and stays out of the cloud
    // layer: under it while the jet is low, over it otherwise
    let fix = 0
    camFloor = 0
    if (vC > 0.3 && vQ > 1e-4) {
      const back = 1 / vQ
      const gx = cam.x + vSin * back
      const gy = cam.y + vCos * back
      let top = 0
      for (let iy = -1; iy <= 1; iy++) for (let ix = -1; ix <= 1; ix++) top = Math.max(top, groundAt(gx + ix * 9, gy + iy * 9))
      camFloor = top + 5
      const nominal = follow.alt + vLean * back
      let want = Math.max(nominal, camFloor)
      if (want > CLOUD_ALT - 3 && want < ZTOP + 3) want = lead.z < CLOUD_ALT - 8 ? Math.max(camFloor, CLOUD_ALT - 3) : ZTOP + 3
      fix = want - nominal
    }
    camFix += (fix - camFix) * (1 - Math.exp(-dt * 7))
    // the chase camera sits behind the jet and swings round a beat late in turns
    stepBombs(dt)
    stepBoats(dt)
    stepLife(dt)
    stepFoot(dt)

    chaseYaw += (-lead.yaw - chaseYaw) * (1 - Math.exp(-dt * 3.4))
    const raw = chaseYaw - cam.yaw
    if (vC === 0 && vK === 0) yawDiff = wrapAngle(raw)
    else yawDiff += wrapAngle(raw - yawDiff)
    updateView()
  }

  // the jet's own axes in the world (x right, y down the map, z up)
  function axes(j) {
    // (the bumps of the air are only seen, they do not steer)
    const cs = Math.cos(j.yaw + j.joltY)
    const sn = Math.sin(j.yaw + j.joltY)
    const roll = rollOf(j)
    const cr = Math.cos(roll)
    const sr = Math.sin(roll)
    // right wing dips for a positive roll
    const rx = cs * cr
    const ry = sn * cr
    const rz = -sr
    const u2x = cs * sr
    const u2y = sn * sr
    const u2z = cr
    const cp = Math.cos(j.pitch + j.joltP)
    const sp = Math.sin(j.pitch + j.joltP)
    const fx = sn * cp + u2x * sp
    const fy = -cs * cp + u2y * sp
    const fz = u2z * sp
    const ux = u2x * cp - sn * sp
    const uy = u2y * cp + cs * sp
    const uz = u2z * cp
    return { rx, ry, rz, fx, fy, fz, ux, uy, uz, cr }
  }

  // ── drawing
  //
  // One camera covers both views. A world point lands on screen at
  //   scale = S / (1 + q·depth)     x = Cx + scale·across     y = Cy − scale·(height + slope·depth)
  // With q = 0 this is the flat sprite-stack view: every layer is drawn one pixel above the last.
  // Raising q brings the camera in behind the jet: far things shrink and a horizon appears.
  // Switching views only slides q, the slope, the scale and the heading, so there is no cut.
  const sjx = new Float64Array(3)
  const sjy = new Float64Array(3)
  const srx = new Float64Array(3)
  const sry = new Float64Array(3)
  const sfx = new Float64Array(3)
  const sfy = new Float64Array(3)
  const sic = new Float64Array(3)
  const rowNow = new Int32Array(64) // screen row of every height at this depth step
  const rowPrev = new Int32Array(64) // … and at the step before
  const offX = new Float32Array(64)
  const offY = new Float32Array(64)
  const sliceOrder = new Int32Array(JET_H)
  const sliceKey = new Float64Array(JET_H)
  let prX = 0
  let prY = 0
  let prM = 0
  let prV = 0

  /** world point → screen (prX, prY) and its scale (prM); false when it is behind the camera */
  function project(x, y, z) {
    const dx = x - cam.x
    const dy = y - cam.y
    const depth = -(dx * vSin + dy * vCos)
    const den = 1 + vQ * depth
    if (den < 0.12) return false
    prV = depth
    prM = vS / den
    prX = vCx + prM * (dx * vCos - dy * vSin)
    prY = vCy - prM * (z - cam.alt + vTan * depth)
    return true
  }

  // ── one frame's view of the ground and clouds, shared by drawWorld and the GPU (gpu-world.ts):
  // the camera, the cloud drift, the shadows and the haze, and the depth of every step of the walk
  // from near to far. stepV[0] is where the walk starts; steps 1..n are drawn.
  const stepV = new Float64Array(4001)
  const WF = {
    c: 0, s: 0, q: 0, S: 0, tn: 0, Cx: 0, Cy: 0, A: 0, bx: 0, by: 0, rankMax: 0, cloudsOn: false,
    holeR: 0, holeCx: 0, holeCy: 0, cdx: 0, cdy: 0, csx: 0, csy: 0, tW1: 0, tW2: 0, tF: 0, sx: 0, sy: 0,
    isc: 0, reach: 0, blooms: false, nShadow: 0, viewDist: 0, fogStart: 0, n: 0,
    // colours the GPU needs that are not in the material palettes
    hazeCol: 0, cloudUnder: 0, foamCol: 0, sparkA: 0, sparkB: 0, shutterLit: 0, shutterShade: 0, winLit: 0, winOn: 0,
    topLit, topShade, sideLit, sideShade, cloudTop, cloudSide, shadowMask, sjx, sjy, srx, sry, sfx, sfy, sic,
  }
  function worldFrame() {
    const f = WF
    const c = vCos
    const s = vSin
    const q = vQ
    const S = vS
    const tn = vTan
    const Cx = vCx
    const Cy = vCy
    const A = cam.alt
    const bx = cam.x - Math.floor(cam.x / N) * N + N * 2
    const by = cam.y - Math.floor(cam.y / N) * N + N * 2
    f.c = c
    f.s = s
    f.q = q
    f.S = S
    f.tn = tn
    f.Cx = Cx
    f.Cy = Cy
    f.A = A
    f.bx = bx
    f.by = by
    f.rankMax = Math.round(clamp(p.clouds, 0, 1) * 16)
    f.cloudsOn = f.rankMax > 0
    // the isometric view aboard looks down at a shallow angle, so a cloud would sit over the boat:
    // the clouds open a round hole around it, its rim dithered so it reads as thinning cloud
    f.holeR = onFoot && aboard >= 0 && footView === 0 ? BOAT_ISO_HOLE * S : 0
    f.holeCx = Cx
    f.holeCy = Cy - BOAT_ISO_MID * S
    // walking, seen from above and behind: a cloud can drift between the camera and the man, so the
    // clouds open around him too, sized by how big he is on the screen
    if (onFoot && aboard < 0 && footView === 0) {
      const x = walker.x - N * Math.round((walker.x - cam.x) / N)
      const y = walker.y - N * Math.round((walker.y - cam.y) / N)
      if (project(x, y, walker.z + WALK_MID)) {
        f.holeR = WALK_HOLE * prM
        f.holeCx = prX
        f.holeCy = prY
      }
    }
    f.cdx = (time * 7) % NC
    f.cdy = (time * 3) % NC
    f.csx = sunX * CLOUD_ALT - f.cdx + NC
    f.csy = sunY * CLOUD_ALT - f.cdy + NC
    f.tW1 = ((time * 6) | 0) & 1023
    f.tW2 = ((time * 4) | 0) & 1023
    f.tF = (time * 36) | 0
    const sx = sunX
    const sy = sunY
    f.sx = sx
    f.sy = sy
    f.isc = 1 / jetSize()
    f.reach = JET_L * 0.75 * jetSize() + 3
    // flowers only show near the ground: on foot or aboard, or from the plane flying low in the chase
    // and cockpit views; never from the view overhead. Elsewhere a flower cell is plain green.
    const lead = jets[0]
    f.blooms = onFoot || (viewTarget !== 0 && lead.z - groundAt(lead.x, lead.y) < BLOOM_ALT)
    let nShadow = 0
    if (p.shadow && introT > 0.3) {
      for (let j = 0; j < jets.length && j < 3; j++) {
        const jet = jets[j]
        const ax = axes(jet)
        sjx[j] = bx + (jet.x - cam.x) + sx * jet.z
        sjy[j] = by + (jet.y - cam.y) + sy * jet.z
        const cs = Math.cos(jet.yaw)
        const sn = Math.sin(jet.yaw)
        srx[j] = cs
        sry[j] = sn
        sfx[j] = sn
        sfy[j] = -cs
        sic[j] = 1 / (Math.max(0.3, Math.abs(ax.cr)) * jetSize())
        nShadow++
      }
    }
    f.nShadow = nShadow
    f.hazeCol = hazeCol
    f.cloudUnder = cloudUnder
    f.foamCol = foamCol
    f.sparkA = sparkA
    f.sparkB = sparkB
    f.shutterLit = shutterLit
    f.shutterShade = shutterShade
    f.winLit = winLit
    f.winOn = winOn

    // start where the tallest thing sits on the bottom row; stop when the sea leaves the top
    // of the frame, or at the view distance once there is a horizon
    // (a camera down among the hills and clouds starts right in front of itself instead)
    const below = rowHi - Cy
    const nearest = q > 0 ? -0.85 / q : -1e9
    const camHigh = q > 0 ? A + tn / q : 1e9
    const dn = S * tn + q * below
    let v = camHigh > ZTOP + 1 && dn > 1e-6 ? Math.max(nearest, (S * (A - ZTOP) - below) / dn - 2) : nearest
    // from higher up it sees further, and the haze starts further out
    f.viewDist = VIEW_DIST + 3 * A
    f.fogStart = FOG_START + 2 * A
    const above = Cy - rowLo + 2
    let vEnd = f.viewDist
    if (S * tn > q * above) vEnd = Math.min(f.viewDist, (S * A + above) / (S * tn - q * above))
    const rowsK = S * (tn + q * A)
    let den = 1 + q * v
    let n = 0
    stepV[0] = v
    for (let guard = 0; v < vEnd && guard < 4000; guard++) {
      // one step deeper: about one screen row of sea, never coarser than a few pixels across
      let dv = (den * den) / rowsK
      const cap = (2.5 * den) / S
      if (dv > cap) dv = cap
      if (dv < 0.5) dv = 0.5
      v += dv
      den = 1 + q * v
      stepV[++n] = v
    }
    f.n = n
    return f
  }

  // the ground and clouds: on the GPU when one is attached (setGpu), else drawWorld on the CPU,
  // which is also the fallback whenever the GPU cannot draw (no WebGL2, or its context was lost)
  let gpu = null
  let groundMs = 0
  let compareNext = false
  let groundDiff = null
  const gpuOut = { fb: new Uint32Array(0), zbuf: new Float32Array(0), W: 0, H: 0, colLo: 0, colHi: 0, rowLo: 0, rowHi: 0 }
  function drawGround() {
    const t0 = performance.now()
    let onGpu = false
    if (gpu) {
      const f = worldFrame()
      gpuOut.fb = fb
      gpuOut.zbuf = zbuf
      gpuOut.W = W
      gpuOut.H = H
      gpuOut.colLo = colLo
      gpuOut.colHi = colHi
      gpuOut.rowLo = rowLo
      gpuOut.rowHi = rowHi
      onGpu = gpu.draw(f, stepV, GW, gpuOut)
      if (onGpu && compareNext) {
        // debugging: draw the same frame on the CPU too and count the pixels that differ
        compareNext = false
        const gFb = fb.slice()
        const gZ = zbuf.slice()
        const t1 = performance.now()
        drawWorld()
        const cpuMs = performance.now() - t1
        let n = 0
        let color = 0
        let depth = 0
        for (let y = rowLo; y < rowHi; y++) {
          for (let x = colLo; x < colHi; x++) {
            const o = y * W + x
            n++
            if (gFb[o] !== fb[o]) color++
            if (gZ[o] !== zbuf[o]) depth++
          }
        }
        groundDiff = { pixels: n, color, depth, gpuMs: t1 - t0, cpuMs }
        fb.set(gFb)
        zbuf.set(gZ)
      }
    }
    if (!onGpu) drawWorld()
    groundMs += (performance.now() - t0 - groundMs) * 0.05
  }

  // The islands and clouds, drawn from the nearest ground to the farthest. Every ground pixel
  // is a column of stacked layers: its top is drawn where the column ends and its wall where it
  // starts, and a pixel that is already taken stays taken (nearer things win).
  function drawWorld() {
    const f = worldFrame()
    const _fb = fb
    const _zb = zbuf
    if (rowLo === 0 && rowHi === H && colLo === 0 && colHi === W) {
      _fb.fill(0)
      _zb.fill(1e9)
    } else {
      for (let y = rowLo; y < rowHi; y++) {
        _fb.fill(0, y * W + colLo, y * W + colHi)
        _zb.fill(1e9, y * W + colLo, y * W + colHi)
      }
    }
    colY.fill(rowHi)
    const { c, s, q, S, tn, Cx, Cy, A, bx, by, rankMax, cloudsOn, holeR, holeCx, holeCy } = f
    const { cdx, cdy, csx, csy, tW1, tW2, tF, sx, sy, isc, reach, blooms, nShadow, viewDist, fogStart } = f
    const holeIn2 = (holeR * 0.6) * (holeR * 0.6)
    const holeOut2 = holeR * holeR
    const inHole = (px, y) => {
      const dx = px - holeCx
      const dy = (y - holeCy) * 1.15
      const d2 = dx * dx + dy * dy
      if (d2 >= holeOut2) return false
      if (d2 < holeIn2) return true
      const t = (Math.sqrt(d2) - holeR * 0.6) / (holeR * 0.4)
      return BAYER4[((y & 3) << 2) | (px & 3)] >= t * 16
    }
    const _h = heightMap
    const _m = matMap
    const _cn = cloudN
    const _nz = nz
    const _cy = colY
    const hzR = hazeCol & 255
    const hzG = (hazeCol >> 8) & 255
    const hzB = (hazeCol >> 16) & 255
    const mixHaze = (col, keep, fog) =>
      ((255 << 24) |
        (((((col >> 16) & 255) * keep + hzB * fog) >> 8) << 16) |
        (((((col >> 8) & 255) * keep + hzG * fog) >> 8) << 8) |
        (((col & 255) * keep + hzR * fog) >> 8)) >>> 0

    let v = stepV[0]
    let den = 1 + q * v
    let m = S / den
    let R = Cy - m * (tn * v - A) + EPS
    for (let z = 0; z <= ZTOP; z++) rowNow[z] = Math.floor(R - m * z)
    // columns not yet drawn up to the top of the frame; when none are left, nothing more can show
    let live = colHi - colLo
    for (let k = 1; k <= f.n && live > 0; k++) {
      // the front faces drawn at this step stand at the previous depth (for the heights up a facade)
      const Rp = R
      const mp = m
      v = stepV[k]
      den = 1 + q * v
      m = S / den
      R = Cy - m * (tn * v - A) + EPS
      for (let z = 0; z <= ZTOP; z++) {
        rowPrev[z] = rowNow[z]
        rowNow[z] = Math.floor(R - m * z)
      }
      const inv = den / S
      const ax = c * inv
      const ay = -s * inv
      let wx = bx - Cx * ax - v * s
      let wy = by - Cx * ay - v * c
      // where each pixel's ray was at the step before, to find which face of a wall it came in by
      const vP = stepV[k - 1]
      const invP = (1 + q * vP) / S
      const axP = c * invP
      const ayP = -s * invP
      const wxP0 = bx - Cx * axP - vP * s
      const wyP0 = by - Cx * ayP - vP * c
      // distance haze: colours step towards the horizon colour, a few shades at a time
      let fog = 0
      if (q > 0 && v > fogStart) {
        const f = (v - fogStart) / (viewDist - fogStart)
        fog = Math.min(256, ((Math.sqrt(f) * FOG_STEPS + 0.5) | 0) * (256 / FOG_STEPS)) | 0
      }
      const keep = 256 - fog
      const fine = inv < 1.8
      // every cloud pixel at this depth lies between these rows (higher layers are higher up the
      // screen), so a column already drawn up past cTop has no room left for cloud here
      const cTop = rowNow[ZTOP - 1] < rowPrev[ZTOP - 1] ? rowNow[ZTOP - 1] : rowPrev[ZTOP - 1]
      const cBot = rowNow[CLOUD_ALT] > rowPrev[CLOUD_ALT] ? rowNow[CLOUD_ALT] : rowPrev[CLOUD_ALT]
      const cloudsHere = cloudsOn && cTop < rowHi && cBot > rowLo
      wx += ax * colLo
      wy += ay * colLo
      for (let px = colLo; px < colHi; px++, wx += ax, wy += ay) {
        // a column drawn up to the top of the frame is finished
        let cY = _cy[px]
        if (cY <= rowLo) continue
        // clouds: a stack of up to CK layers floating at CLOUD_ALT
        if (cloudsHere && cTop < cY) {
          const cv = _cn[((((wy - cdy + NC) | 0) & NCM) << NCSHIFT) | (((wx - cdx + NC) | 0) & NCM)]
          if (cv !== 0 && cv >> 4 < rankMax) {
            const tk = cv & 15
            const zt = CLOUD_ALT + tk - 1
            let y0 = rowNow[zt]
            let y1 = rowPrev[zt]
            if (y0 < rowLo) y0 = rowLo
            if (y1 > rowHi) y1 = rowHi
            if (y0 < y1) {
              let col = cloudTop[tk - 1]
              if (fog > 0) col = mixHaze(col, keep, fog)
              for (let y = y0, o = y0 * W + px; y < y1; y++, o += W) {
                // the thinnest rim is a checker, so the cloud edge is soft
                if (_fb[o] !== 0 || (tk === 1 && ((px + y) & 1) === 0)) continue
                if (holeR > 0 && inHole(px, y)) continue
                _fb[o] = col
                _zb[o] = v
              }
            }
            // its underside, when the camera is below the clouds
            let u0 = rowPrev[CLOUD_ALT]
            let u1 = rowNow[CLOUD_ALT]
            if (u0 < u1) {
              if (u0 < rowLo) u0 = rowLo
              if (u1 > rowHi) u1 = rowHi
              const col = fog > 0 ? mixHaze(cloudUnder, keep, fog) : cloudUnder
              for (let y = u0, o = u0 * W + px; y < u1; y++, o += W) {
                if (_fb[o] !== 0 || (tk === 1 && ((px + y) & 1) === 0)) continue
                if (holeR > 0 && inHole(px, y)) continue
                _fb[o] = col
                _zb[o] = v
              }
            }
            for (let k = tk - 2; k >= 0; k--) {
              let ya = rowPrev[CLOUD_ALT + k + 1]
              let yb = rowPrev[CLOUD_ALT + k]
              if (ya < rowLo) ya = rowLo
              if (yb > rowHi) yb = rowHi
              if (ya >= yb) continue
              let col = cloudSide[k]
              if (fog > 0) col = mixHaze(col, keep, fog)
              for (let y = ya, o = ya * W + px; y < yb; y++, o += W) {
                if (_fb[o] === 0 && !(holeR > 0 && inHole(px, y))) { _fb[o] = col; _zb[o] = v }
              }
            }
          }
        }
        // terrain
        const gx = wx | 0
        const gy = wy | 0
        const idx = ((gy & NM) << NSHIFT) | (gx & NM)
        const h = _h[idx]
        const yT = rowNow[h]
        let yR = rowPrev[h]
        if (yT >= cY && yR >= cY) continue
        const mat = _m[idx]
        // shadows: clouds, then the jets
        let shade = 0
        if (cloudsOn) {
          const sv = _cn[((((gy + csy) | 0) & NCM) << NCSHIFT) | (((gx + csx) | 0) & NCM)]
          if ((sv & 15) > 1 && sv >> 4 < rankMax) shade = 1
        }
        if (shade === 0 && nShadow > 0) {
          for (let j = 0; j < nShadow; j++) {
            const dx = gx - sjx[j] + sx * h
            const dy = gy - sjy[j] + sy * h
            if (dx > -reach && dx < reach && dy > -reach && dy < reach) {
              const a = (dx * srx[j] + dy * sry[j]) * sic[j]
              const b = (dx * sfx[j] + dy * sfy[j]) * isc
              const i = Math.floor(a + JET_W / 2)
              const k = Math.floor(PIV_K - b + 0.5)
              if (i >= 0 && i < JET_W && k >= 0 && k < JET_L && shadowMask[k * JET_W + i] === 1) { shade = 1; break }
            }
          }
        }
        let top
        let side
        if (mat < 4) {
          top = shade ? topShade[mat] : topLit[mat]
          if (mat === 3) {
            if (((_nz[((gy & 255) << 8) | (gx & 255)] + tF) & 255) < 120) top = shade ? topShade[2] : foamCol
          } else if (shade === 0 && fine) {
            const n1 = _nz[((gy & 255) << 8) | (((gx + tW1) >> 2) & 255)]
            if (n1 > 243) {
              const n2 = _nz[(((gy + 91) & 255) << 8) | (((gx + 1024 - tW2) >> 2) & 255)]
              if (n2 > 128) top = n1 > 252 ? sparkB : sparkA
            }
          }
          side = top
        } else {
          top = shade ? topShade[mat] : topLit[mat]
          side = shade ? sideShade[mat] : sideLit[mat]
          // a flower is a small bloom in the middle of its cell, with green leaves round it
          if (BLOOM[mat] === 1) {
            const fx = wx - gx - 0.5
            const fy = wy - gy - 0.5
            if (!blooms || fx * fx + fy * fy > 0.09) top = shade ? topShade[6] : topLit[6]
          }
        }
        if (fog > 0) {
          top = mixHaze(top, keep, fog)
          side = mixHaze(side, keep, fog)
        }
        // the wall of this column, where it starts …
        if (yR < cY) {
          if (yR < rowLo) yR = rowLo
          const fk = FACADE[mat]
          // a house: its facade painted on (facadeAt). First where the ray came into the house: walk back
          // from this cell towards where the ray was at the step before, cell by cell, to the last one that
          // is part of the house. When that is a wall, the ray met it on the face it crossed to come in,
          // and that is what shows, up to the eaves. Mostly it is this cell, but it can be the one before
          // it along the wall, when the ray ran along the wall between two steps (up close at a joint, or
          // far off, where a step is several cells), or the wall under the roof the step landed on (far
          // off): without this, joints show slivers of side faces and, far off, the roof runs down to the
          // ground in stripes.
          let facade = false
          let xEdge = true
          let t = 0
          let kind = fk
          let cell = idx
          let fm = mat
          let hW = h
          let hF = -1
          let wxp = 0
          let wyp = 0
          if (fk !== 0) {
            wxp = wxP0 + axP * px
            wyp = wyP0 + ayP * px
            let ix = Math.floor(wx)
            let iy = Math.floor(wy)
            const dx = wxp - wx
            const dy = wyp - wy
            let sX = dx > 0 ? (ix + 1 - wx) / dx : dx < 0 ? (ix - wx) / dx : 2
            let sY = dy > 0 ? (iy + 1 - wy) / dy : dy < 0 ? (iy - wy) / dy : 2
            const dsX = dx !== 0 ? Math.abs(1 / dx) : 2
            const dsY = dy !== 0 ? Math.abs(1 / dy) : 2
            let ek = fk
            let ei = idx
            for (let n = 0; n < FAC_WALK; n++) {
              const isX = sX < sY
              const sc = isX ? sX : sY
              if (sc > 1) break
              if (isX) { ix += dx > 0 ? 1 : -1; sX += dsX } else { iy += dy > 0 ? 1 : -1; sY += dsY }
              const i2 = ((iy & NM) << NSHIFT) | (ix & NM)
              const k2 = FACADE[_m[i2]]
              if (k2 === 0) {
                // out of the house: the ray came in through ei, across this line
                if ((ek & 7) !== F_ROOF) {
                  facade = true
                  xEdge = isX
                  t = 1 - sc
                  kind = ek
                  cell = ei
                  fm = _m[ei]
                  hW = _h[ei]
                  hF = _h[i2]
                }
                break
              }
              ek = k2
              ei = i2
            }
            // a wall with no way in found (the ray came down onto it within one cell): as it is
            if (!facade && (fk & 7) !== F_ROOF) facade = true
          }
          if (facade) {
            let a
            if (xEdge) {
              const yy = wyp + (wy - wyp) * t
              a = yy - Math.floor(yy)
            } else {
              const xx = wxp + (wx - wxp) * t
              a = xx - Math.floor(xx)
            }
            const cx = cell & NM
            const cy = cell >> NSHIFT
            if (hF < 0) {
              // the ground in front: the lower of the cells beside this one towards the camera
              const sx = wx > wxp ? -1 : 1
              const sy = wy > wyp ? -1 : 1
              hF = Math.min(_h[(cy << NSHIFT) | ((cx + sx) & NM)], _h[(((cy + sy) & NM) << NSHIFT) | cx])
            }
            // how many floors the house has: its height over the ground in front
            const floors = Math.max(1, Math.round((hW - hF) / FLOOR_H))
            // the heights on it are measured where the ray meets the face, not at the step before, so the
            // bands and windows line up from one column of pixels to the next
            const vc = vP + (v - vP) * t
            const mc = S / (1 + q * vc)
            const rc = Cy - mc * (tn * vc - A) + EPS
            const fp = facPal
            const wallC = shade ? sideShade[fm] : sideLit[fm]
            const shutC = shade ? shutterShade : shutterLit
            fp[F_WALL] = wallC
            fp[F_WALL_DK] = sideShade[fm]
            fp[F_STONE] = shade ? sideShade[M_HSTONE] : sideLit[M_HSTONE]
            fp[F_STONE_DK] = sideShade[M_HSTONE]
            fp[F_SHUTTER] = shutC
            fp[F_SLAT] = shade ? sideShade[M_SLAT] : sideLit[M_SLAT]
            fp[F_LIT] = winLit
            fp[F_IRON] = shade ? sideShade[M_IRON] : sideLit[M_IRON]
            fp[F_DOOR] = shade ? sideShade[M_DOOR] : sideLit[M_DOOR]
            // half and half, byte by byte (as the shader does)
            fp[F_BAND] = ((((wallC & 0xfefefefe) >>> 1) + ((shutC & 0xfefefefe) >>> 1)) | 0xff000000) >>> 0
            if (fog > 0) for (let i = 0; i < 10; i++) fp[i] = mixHaze(fp[i], keep, fog)
            const on = winOn
            // over the wall, when this is the roof behind it: the roof's own side
            const eave = (fk & 7) === F_ROOF ? hW : 1e9
            for (let y = yR, o = yR * W + px; y < cY; y++, o += W) {
              if (_fb[o] !== 0) continue
              const z = (rc - y) / mc
              _fb[o] = z >= eave ? side : fp[facadeAt(kind, hW - z, a, mc, cell, on, floors)]
              _zb[o] = v
            }
          } else {
            for (let y = yR, o = yR * W + px; y < cY; y++, o += W) {
              if (_fb[o] === 0) { _fb[o] = side; _zb[o] = v }
            }
          }
          cY = yR
        }
        // … and its top, up to where it ends (unless the camera is below it)
        if (yT < cY) {
          const y0 = yT < rowLo ? rowLo : yT
          for (let y = y0, o = y0 * W + px; y < cY; y++, o += W) {
            if (_fb[o] === 0) { _fb[o] = top; _zb[o] = v }
          }
          cY = yT
        }
        _cy[px] = cY
        if (cY <= rowLo) live--
      }
    }
  }

  // whatever the ground left empty: sky above the horizon, haze below it
  function drawSky() {
    if (vC === 0 && vK === 0) return
    const _fb = fb
    const q = vQ
    const horizon = q > 1e-7 ? vCy - (vS * vTan) / q : -1e9
    const hz = horizon > H ? H : Math.floor(horizon)
    const focal = q > 1e-7 ? vS / q : 1e9
    // a disc in the sky towards (-dx, -dy), elev above the horizon, its glow dithered round it;
    // k (0…1) thins the whole of it to nothing
    const disc = (dx, dy, rad, elev, core, halo, k) => {
      const sl = Math.sqrt(dx * dx + dy * dy) || 1
      const du = (-dx * vCos + dy * vSin) / sl
      const dv = (dx * vSin + dy * vCos) / sl
      if (dv <= 0.2 || k <= 0) return
      const lvl = k * 16
      const cxs = vCx + (focal * du) / dv
      const cys = horizon - (focal * elev) / dv
      const reach = rad * 1.9
      const xa = Math.max(0, Math.floor(cxs - reach))
      const xb = Math.min(W - 1, Math.ceil(cxs + reach))
      const ya = Math.max(0, Math.floor(cys - reach))
      const yb = Math.min(hz - 1, Math.ceil(cys + reach))
      for (let y = ya; y <= yb; y++) {
        for (let x = xa; x <= xb; x++) {
          const o = y * W + x
          if (_fb[o] !== 0) continue
          const b = BAYER[((y & 3) << 2) | (x & 3)]
          const d = Math.sqrt((x - cxs) * (x - cxs) + (y - cys) * (y - cys)) / rad
          if (d < 1) { if (lvl > b) _fb[o] = core }
          else if (d < 1.9 && (1.9 - d) * 14 * k > b) _fb[o] = halo
        }
      }
    }
    if (hz > 0) {
      // the sun, big and low at dusk, sinking under the horizon as the night comes on (and up at dawn)
      disc(sunX, sunY, W * 0.05, 0.12 + (DUSK - phase) * 0.5, sunCol, sunGlow, Math.min(1, tw[1] / DUSK_PEAK) * 1.3 - 0.15)
      // the moon, small and high, opposite the shadows of the night
      disc(0.3, 0.42, W * 0.022, 0.3, moonCol, moonGlow, moonK)
    }
    const span = frameH * 0.75
    const starOff = ((vYaw * focal) | 0) & 4095
    const stars = moonK > 0
    for (let y = rowLo; y < rowHi; y++) {
      let o = y * W
      o += colLo
      if (y < hz) {
        const t = ((hz - y) / span) * (NSKY - 1)
        for (let x = colLo; x < colHi; x++, o++) {
          if (_fb[o] !== 0) continue
          let b = t | 0
          const edge = (t - b - 0.7) * 3.4
          if (edge > 0 && edge * 16 > BAYER[((y & 3) << 2) | (x & 3)]) b++
          if (b >= NSKY) b = NSKY - 1
          _fb[o] = stars && b > 1 && hash8(((x + starOff) & 4095) * 73 + y * 9973) < 2 ? starPal[b] : skyPal[b]
        }
      } else {
        for (let x = colLo; x < colHi; x++, o++) if (_fb[o] === 0) _fb[o] = hazeCol
      }
    }
  }

  function drawTrails() {
    if (!p.trails) return
    const LIFE = 2.6
    const _fb = fb
    const _zb = zbuf
    for (const j of jets) {
      if (j === jets[0] && jetFade < 0.5) continue
      const g = j.g
      for (let w = 0; w < 2; w++) {
        const tr = j.trail[w]
        let prevX = 0
        let prevY = 0
        let has = false
        for (let n = 0; n < j.trailLen; n++) {
          const o = ((j.trailHead - 1 - n + TRAIL_N * 2) % TRAIL_N) * 4
          const age = (time - tr[o + 3]) / (LIFE * (0.3 + 0.7 * g))
          if (age >= 1) break
          if (!project(tr[o], tr[o + 1], tr[o + 2])) { has = false; continue }
          const sxp = prX
          const syp = prY
          if (has) {
            // short line from the previous point, thicker when it is close to the camera
            const span = Math.max(Math.abs(sxp - prevX), Math.abs(syp - prevY))
            if (span < 600) {
              const steps = Math.max(1, Math.ceil(span))
              const alpha = age < 0.5 ? 1 : (1 - age) * 2
              const col = age < 0.25 ? trailPal[0] : age < 0.6 ? trailPal[1] : trailPal[2]
              const thick = prM > 2.4 ? 2 : 1
              for (let k = 0; k < steps; k++) {
                const x0 = Math.round(prevX + ((sxp - prevX) * k) / steps)
                const y0 = Math.round(prevY + ((syp - prevY) * k) / steps)
                for (let yy = y0; yy < y0 + thick; yy++) {
                  for (let xx = x0; xx < x0 + thick; xx++) {
                    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
                    if (_zb[yy * W + xx] < prV - 1) continue // behind a hill or a cloud
                    if (alpha * 16 > BAYER[((yy & 3) << 2) | (xx & 3)]) _fb[yy * W + xx] = col
                  }
                }
              }
            }
          }
          prevX = sxp
          prevY = syp
          has = true
        }
      }
    }
  }

  // dark exhaust smoke: soft round puffs that swell, pale and thin out as they hang in the air
  function drawSmoke() {
    const _fb = fb
    const _zb = zbuf
    const night = smokeNight
    for (let i = 0; i < SMOKE_N; i++) {
      const o = i * SMOKE_F
      const life = smoke[o + 8]
      if (life <= 0) continue
      const age = time - smoke[o + 3]
      if (age < 0 || age >= life) continue
      const u = age / life
      // the exhaust shoves it backwards at first; then it just hangs and rises a little
      const push = (1 - Math.exp(-age * 5)) / 5
      if (!project(smoke[o] + smoke[o + 5] * push, smoke[o + 1] + smoke[o + 6] * push, smoke[o + 2] + age * 2.5)) continue
      const rad = Math.max(0.8, smoke[o + 4] * (1 + 2.4 * u) * prM)
      if (rad > 60) continue
      const alpha = smoke[o + 7] * (1 - u) * (1 - u) * (u < 0.08 ? u / 0.08 : 1) * night
      // display smoke: white, greying a little as it spreads
      const shade = 238 - 34 * u
      const cr = shade
      const cg = shade + 3
      const cb = Math.min(255, shade + 9)
      const x0 = Math.max(0, Math.floor(prX - rad))
      const x1 = Math.min(W - 1, Math.ceil(prX + rad))
      const y0 = Math.max(0, Math.floor(prY - rad))
      const y1 = Math.min(H - 1, Math.ceil(prY + rad))
      const inv = 1 / (rad * rad)
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d2 = ((x - prX) * (x - prX) + (y - prY) * (y - prY)) * inv
          if (d2 > 1) continue
          const at = y * W + x
          if (_zb[at] < prV - 1) continue
          const k = (alpha * (1 - d2 * 0.7) * 256) | 0
          const bg = _fb[at]
          const r = ((bg & 255) * (256 - k) + cr * k) >> 8
          const g = (((bg >> 8) & 255) * (256 - k) + cg * k) >> 8
          const b = (((bg >> 16) & 255) * (256 - k) + cb * k) >> 8
          _fb[at] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
        }
      }
    }
  }

  function plotDot(px, py, col, depth, size) {
    const s = Math.max(1, size | 0)
    const x0 = Math.round(px)
    const y0 = Math.round(py)
    for (let yy = y0; yy < y0 + s; yy++) {
      for (let xx = x0; xx < x0 + s; xx++) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
        const at = yy * W + xx
        if (zbuf[at] < depth - 1) continue
        fb[at] = col
        zbuf[at] = depth
      }
    }
  }

  function stepLife(dt) {
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i]
      const lead = fish[f.lead]
      let want = Math.sin(time * 0.28 + f.phase) * 0.4
      if (lead && lead !== f) {
        want += wrapAngle(lead.yaw - f.yaw) * 0.9
        const dx = wrapDelta(lead.x, f.x)
        const dy = wrapDelta(lead.y, f.y)
        if (dx * dx + dy * dy > 20 * 20) want += wrapAngle(Math.atan2(dx, -dy) - f.yaw) * 0.45
      }
      const sn = Math.sin(f.yaw)
      const cs = Math.cos(f.yaw)
      if (matAt(f.x + sn * 14, f.y - cs * 14) >= 4) want += 1.4
      f.yaw += want * dt
      const nx = f.x + Math.sin(f.yaw) * f.speed * dt
      const ny = f.y - Math.cos(f.yaw) * f.speed * dt
      if (matAt(nx, ny) < 4) { f.x = wrapPos(nx); f.y = wrapPos(ny) }
      else f.yaw += 1.6 * dt
    }
    for (const w of whales) {
      const sn = Math.sin(w.yaw)
      const cs = Math.cos(w.yaw)
      let want = Math.sin(time * 0.08 + w.phase) * 0.15
      const ahead = matAt(w.x + sn * 28, w.y - cs * 28)
      if (ahead > 1) want += ahead >= 4 ? 0.9 : 0.35
      w.yaw += want * dt
      const nx = w.x + Math.sin(w.yaw) * w.speed * dt
      const ny = w.y - Math.cos(w.yaw) * w.speed * dt
      if (matAt(nx, ny) <= 1) { w.x = wrapPos(nx); w.y = wrapPos(ny) }
      else w.yaw += 0.7 * dt
    }
  }

  // ── fish and whales
  //
  // Both are flat shapes on a level plane just under the surface. Each screen pixel over one is traced back
  // to the plane and asked what part of the animal it is, so the shape stays solid and smooth at any scale
  // and in perspective. The water shows through a little (`flatSub`), more while a whale is down.
  let flatSub = 0
  /** shape(f, a, m) → colour or 0, with f forward and a across in the animal's own units, m pixels per unit */
  function rasterFlat(x, y, z0, yaw, fBack, fFront, aSpan, shape) {
    const q = vQ
    const S = vS
    const tn = vTan
    const c = vCos
    const s = vSin
    const cs = Math.cos(yaw)
    const sn = Math.sin(yaw)
    let x0 = 1e9
    let y0 = 1e9
    let x1 = -1e9
    let y1 = -1e9
    for (let k = 0; k < 4; k++) {
      const f = k & 1 ? fFront : fBack
      const a = k & 2 ? aSpan : -aSpan
      if (!project(x + a * cs + f * sn, y + a * sn - f * cs, z0)) return
      if (prX < x0) x0 = prX
      if (prX > x1) x1 = prX
      if (prY < y0) y0 = prY
      if (prY > y1) y1 = prY
    }
    x0 = Math.max(0, Math.floor(x0))
    y0 = Math.max(0, Math.floor(y0))
    x1 = Math.min(W - 1, Math.ceil(x1))
    y1 = Math.min(H - 1, Math.ceil(y1))
    if (x0 > x1 || y0 > y1) return
    const _fb = fb
    const _zb = zbuf
    const keep = (flatSub * 256) | 0
    const put = 256 - keep
    const ox = cam.x - x
    const oy = cam.y - y
    const zr = z0 - cam.alt
    for (let yy = y0; yy <= y1; yy++) {
      // the depth of this row on the plane, then each pixel across it
      const k = (vCy - (yy + 0.5)) / S
      const dn = k * q - tn
      if (Math.abs(dn) < 1e-6) continue
      const d = (zr - k) / dn
      const den = 1 + q * d
      if (den < 0.15 || d < vNear) continue
      const m = S / den
      // world offset from the animal, as a line in screen x: l = base + step * px
      const lx0 = ox - s * d
      const ly0 = oy - c * d
      for (let xx = x0; xx <= x1; xx++) {
        const at = yy * W + xx
        if (_zb[at] < d - 1) continue // land in front
        const A = (xx + 0.5 - vCx) / m
        const lx = lx0 + c * A
        const ly = ly0 - s * A
        const col = shape(lx * sn - ly * cs, lx * cs + ly * sn, m)
        if (col === 0) continue
        if (keep === 0) { _fb[at] = col; continue }
        const bg = _fb[at]
        const r = ((col & 255) * put + (bg & 255) * keep) >> 8
        const g = (((col >> 8) & 255) * put + ((bg >> 8) & 255) * keep) >> 8
        const b = (((col >> 16) & 255) * put + ((bg >> 16) & 255) * keep) >> 8
        _fb[at] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
      }
    }
  }

  /** a soft round drop of spray, blended in */
  function sprayDot(px, py, rad, alpha) {
    const _fb = fb
    const r0 = Math.max(0.6, rad)
    const xa = Math.max(0, Math.floor(px - r0))
    const xb = Math.min(W - 1, Math.ceil(px + r0))
    const ya = Math.max(0, Math.floor(py - r0))
    const yb = Math.min(H - 1, Math.ceil(py + r0))
    const cr = lifePal[6] & 255
    const cg = (lifePal[6] >> 8) & 255
    const cb = (lifePal[6] >> 16) & 255
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const d2 = ((x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2) / (r0 * r0)
        if (d2 > 1) continue
        const k = (alpha * (1 - d2 * 0.5) * 256) | 0
        const at = y * W + x
        const bg = _fb[at]
        const r = ((bg & 255) * (256 - k) + cr * k) >> 8
        const g = (((bg >> 8) & 255) * (256 - k) + cg * k) >> 8
        const b = (((bg >> 16) & 255) * (256 - k) + cb * k) >> 8
        _fb[at] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
      }
    }
  }

  // A humpback, seen from above: a stout dark body, a knobbly head with the blowhole, a small dorsal fin,
  // long pale flippers and wide notched flukes. It cruises a little way down and comes up every so often
  // to blow; then its back is wet and dark and the water foams round it.
  const WHALE_CYCLE = 17
  function whaleState(w) {
    const c = (time + w.phase * 2.7) % WHALE_CYCLE
    const up = c < 1.4 ? c / 1.4 : c < 6.5 ? 1 : c < 8 ? 1 - (c - 6.5) / 1.5 : 0
    return { c, up: up * up * (3 - 2 * up) }
  }
  function drawWhale(w, x, y) {
    const L = w.size
    const half = L / 2
    const wMax = 0.12 * L
    const { c, up } = whaleState(w)
    const cs = Math.cos(w.yaw)
    const sn = Math.sin(w.yaw)
    // which way the light falls across the back
    const ll = Math.sqrt(sunX * sunX + sunY * sunY + 1.21)
    const side = (-sunX * cs - sunY * sn) / ll
    const sway = Math.sin(time * 1.1 + w.phase) * 0.05 * L
    const beat = Math.cos(time * 1.1 + w.phase)
    const flip = 0.95 + 0.14 * Math.sin(time * 0.7 + w.phase)
    const fCos = Math.cos(flip)
    const fSin = Math.sin(flip)
    const seed = (w.phase * 1000) | 0
    const pal = lifePal
    const halfW = (f) => {
      if (f > 0.5 * L || f < -0.36 * L) return -1
      if (f >= 0.12 * L) {
        const t = (f - 0.12 * L) / (0.38 * L)
        return wMax * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.2)))
      }
      const t = (0.12 * L - f) / (0.48 * L)
      return wMax * (1 - 0.9 * Math.pow(t, 1.6))
    }
    const rootF = 0.16 * L
    const rootA = 0.8 * halfW(rootF)
    const finL = 0.3 * L
    const span = 0.17 * L
    const dive = (c - 6.3) / 2.4
    const fluking = dive > 0.12 && dive < 0.88
    flatSub = 0.5 - 0.42 * up
    const shape = (f, a0, m) => {
      // the tail sways from side to side, more towards the flukes
      const tail = f < 0 ? (-f / half) * (-f / half) : 0
      const a = a0 - sway * tail
      const aa = Math.abs(a)
      const w0 = halfW(f)
      if (w0 >= 0 && aa <= w0) {
        const r = a / (w0 || 1)
        let lit = r * side + Math.sqrt(Math.max(0, 1 - r * r)) * 0.55
        if (aa > w0 - 0.7 / m && m > 1.5) return pal[5] // a dark rim
        // the dorsal fin, low on the back towards the tail
        if (f > -0.2 * L && f < -0.12 * L && aa < 0.025 * L * (1 - (f + 0.2 * L) / (0.08 * L)) + 0.6 / m) return m > 1.5 && a * side > 0 ? pal[2] : pal[5]
        if (m > 2.4) {
          // knobs on the head, the two blowholes
          if (f > 0.31 * L && f < 0.345 * L && aa > 0.004 * L && aa < 0.022 * L) return pal[5]
          if (f > 0.36 * L && aa < w0 * 0.6 && hash8(((f * 3) | 0) * 131 + ((a * 3) | 0) * 71 + seed) > 222) return pal[3]
          // pale scars and patches on the flanks
          if (aa > w0 * 0.45 && hash8(((f * 1.5) | 0) * 97 + ((a * 1.5) | 0) * 57 + seed) > 236) return pal[3]
        }
        if (up > 0.3 && aa < w0 * 0.22 && a * side >= 0) lit += 0.35 // a wet shine along the spine
        return lit > 0.72 ? pal[2] : lit > 0.42 ? pal[1] : pal[0]
      }
      // the flukes (unless they are up in the air)
      const b = -0.34 * L - f
      if (b >= 0 && aa <= span && !fluking) {
        const sweep = 0.55 * aa * (0.85 + 0.15 * beat)
        let chord = 0.075 * L * Math.sqrt(Math.max(0, 1 - (aa / span) * (aa / span))) + 0.02 * L
        if (aa < 0.025 * L) chord -= 0.025 * L - aa // the notch
        if (b >= sweep - 0.01 * L && b <= sweep + chord) {
          if (m > 2 && b > sweep + chord - 0.7 / m) return pal[4] // the pale trailing edge
          return a * side > 0 ? pal[1] : pal[0]
        }
      }
      // the long flippers, with a scalloped leading edge
      const pa = aa - rootA
      const pf = f - rootF
      const qq = pa * fCos - pf * fSin
      const rr = pa * fSin + pf * fCos
      if (qq > 0 && qq < finL) {
        let hw = 0.035 * L * Math.pow(1 - qq / finL, 0.6) * Math.min(1, qq / (0.05 * L) + 0.4)
        if (rr > 0 && m > 2) hw += Math.sin((qq / (0.03 * L)) * Math.PI) * 0.006 * L
        if (Math.abs(rr) <= hw) return Math.abs(rr) > hw - 0.6 / m && m > 2.5 ? pal[1] : pal[4]
      }
      // foam round the back while it is up
      if (up > 0.25 && w0 >= 0 && aa < w0 + 0.5 && hash8((((f * 4) | 0) * 37 + ((a * 4) | 0) * 113 + ((time * 6) | 0) * 7) & 0xffff) < 120 * up) return foamCol
      return 0
    }
    rasterFlat(x, y, 0.1, w.yaw, -0.52 * L, 0.52 * L, Math.max(span, rootA + finL) + 0.5, shape)
    flatSub = 0
    // Above the water, as voxels: the back as it breaks the surface (seen from low down, where the flat
    // shape is only a line), and the flukes lifted clear as it dives.
    const hump = up > 0.15 && vQ > 1e-4
    if (hump || (dive > 0 && dive < 1)) {
      if (!project(x, y, 0)) return
      const g = prM >= 9 ? 0.125 : prM >= 2.2 ? 0.25 : 0.5
      ensureAkey()
      voxBegin(x, y, 0, w.yaw, 0, 0, g)
      rigN = 0
      if (hump) {
        for (let f = -0.3 * L; f < 0.46 * L; f += g) {
          const w0 = halfW(f)
          const top = up * 0.075 * L * Math.pow(Math.sin((Math.PI * (f + 0.3 * L)) / (0.76 * L)), 0.6)
          for (let a = -w0; a <= w0; a += g) {
            const r = a / (w0 || 1)
            const n = Math.sqrt(Math.max(0, 1 - r * r))
            const h = top * n - 0.12
            for (let z = h; z > 0; z -= g) rigVox(a, f, z, YM_WHALE, r, 0, n)
          }
        }
      }
      if (dive > 0 && dive < 1) {
        // the tail stock rises out of the water and the flukes stand up behind it, then slide under
        const lift = Math.sin(Math.PI * dive) * 0.2 * L
        const stockF = -0.36 * L
        for (let t = 0; t <= 1; t += g / (0.2 * L)) {
          const f = -0.2 * L + (stockF + 0.2 * L) * t
          const z = lift * t * t - 0.1
          const r = 0.035 * L * (1 - 0.6 * t)
          for (let a = -r; a <= r; a += g) if (z > 0) rigVox(a, f, z, YM_WHALE, a / r, 0.3, 0.8)
        }
        for (let a = -span; a <= span; a += g) {
          const aa = Math.abs(a)
          const lead = 0.55 * aa
          let chord = 0.075 * L * Math.sqrt(Math.max(0, 1 - (aa / span) * (aa / span))) + 0.02 * L
          if (aa < 0.025 * L) chord -= 0.025 * L - aa
          for (let b = lead; b <= lead + chord; b += g) {
            const z = lift + b * 0.92 - 0.1
            if (z <= 0) continue
            // the underside is mottled black and white, different on every whale
            const spot = b > lead + chord - g * 1.5 || hash8(((a * 3) | 0) * 59 + ((b * 3) | 0) * 101 + seed) > 170
            rigVox(a, stockF - b * 0.35, z, spot ? YM_WHALE : YM_FLUKE, 0, 0.94, 0.35)
          }
        }
      }
      rasterVox(rigA, rigF, rigZ, rigNA, rigNF, rigNZ, rigK, rigN)
      voxEnd()
    }
    // the blow: a bushy column of spray that rises fast, drifts downwind and thins out
    const p = (c - 1.1) / 2.6
    if (p > 0 && p < 1) {
      const bx = x + sn * 0.33 * L
      const by = y - cs * 0.33 * L
      const hgt = 0.34 * L * Math.min(1, p * 4)
      const alpha = p < 0.25 ? 0.9 : 0.9 * (1 - (p - 0.25) / 0.75)
      const wx = Math.sin(windYaw) * p * 2.2
      const wy = -Math.cos(windYaw) * p * 2.2
      for (let i = 0; i < 30; i++) {
        const t = hash8(i * 7 + 3) / 255
        const z = hgt * Math.sqrt(t)
        const sp = (0.15 + 0.55 * t) * hgt * (0.4 + 0.6 * p)
        const ang = (hash8(i * 13 + 5) / 255) * Math.PI * 2
        const ox = Math.cos(ang) * sp * 0.6 + wx * t
        const oy = Math.sin(ang) * sp * 0.6 + wy * t
        if (!project(bx + ox, by + oy, z + 0.3)) continue
        sprayDot(prX, prY, prM * (0.25 + 0.45 * t) * (0.7 + 0.5 * p), alpha * (0.55 + 0.45 * (1 - t)))
      }
    }
  }

  // A fish from above: a slim body widest behind the head, a forked tail, small pectoral fins, the back
  // patterned by kind (mackerel bars, a yellowtail's stripe, a snapper's coral). It swims with a wave that
  // grows towards the tail, and now and then flashes silver as it rolls.
  const FISH_KIND = [[7, 8, 9, 7], [10, 11, 12, 11], [13, 15, 14, 15]]
  function drawFish(fi, x, y) {
    const L = fi.size
    const wMax = 0.1 * L
    const pal = lifePal
    const kind = FISH_KIND[fi.kind] || FISH_KIND[0]
    const back = pal[kind[0]]
    const mark = pal[kind[1]]
    const flank = pal[kind[2]]
    const fin = pal[kind[3]]
    const cs = Math.cos(fi.yaw)
    const sn = Math.sin(fi.yaw)
    const ll = Math.sqrt(sunX * sunX + sunY * sunY + 1.21)
    const side = (-sunX * cs - sunY * sn) / ll
    const ph = time * 10 + fi.phase
    const flash = Math.sin(time * 1.7 + fi.phase * 7) > 0.985
    flatSub = 0.24
    const shape = (f, a0, m) => {
      const fromHead = (0.5 * L - f) / L
      const a = a0 - 0.08 * L * Math.sin(ph - fromHead * 5.5) * Math.pow(Math.max(0, fromHead), 1.5)
      const aa = Math.abs(a)
      let w0 = -1
      if (f <= 0.5 * L && f >= -0.3 * L) {
        if (f >= 0.1 * L) {
          const t = (f - 0.1 * L) / (0.4 * L)
          w0 = wMax * Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.8)))
        } else {
          const t = (0.1 * L - f) / (0.4 * L)
          w0 = wMax * (1 - 0.85 * Math.pow(t, 1.3))
        }
      }
      if (w0 >= 0 && aa <= Math.max(w0, 0.45 / m)) {
        if (flash) return pal[9]
        const r = a / (w0 || 1)
        if (m > 3.2 && f > 0.34 * L && f < 0.4 * L && aa > w0 * 0.35 && aa < w0 * 0.85) return pal[16] // eyes
        if (m > 2.2) {
          if (fi.kind === 0 && aa < w0 * 0.75 && Math.sin((f / L) * 34 + aa * 3) > 0.45) return mark
          if (fi.kind === 1 && aa > w0 * 0.45 && aa < w0 * 0.8) return mark
          if (aa > w0 * 0.8) return flank
        }
        return r * side > 0.25 ? flank : back
      }
      // forked tail
      const b = -0.28 * L - f
      if (b >= 0 && b <= 0.22 * L && aa <= 0.03 * L + b * 0.75 && aa >= (b - 0.1 * L) * 0.95) return fin
      // pectoral fins
      if (m > 2.2 && f > 0.12 * L && f < 0.22 * L && aa > w0 && aa < w0 + (0.22 * L - f) * 0.6) return fin
      return 0
    }
    rasterFlat(x, y, 0.15, fi.yaw, -0.52 * L, 0.52 * L, 0.22 * L, shape)
    flatSub = 0
  }

  function drawSeaLife() {
    const wrapToCam = (v, c) => c + (v - c - N * Math.round((v - c) / N))
    for (const w of whales) {
      const x = wrapToCam(w.x, cam.x)
      const y = wrapToCam(w.y, cam.y)
      const dx = x - cam.x
      const dy = y - cam.y
      if (dx * dx + dy * dy > 900 * 900) continue
      drawWhale(w, x, y)
    }
    for (const f of fish) {
      const x = wrapToCam(f.x, cam.x)
      const y = wrapToCam(f.y, cam.y)
      const dx = x - cam.x
      const dy = y - cam.y
      if (dx * dx + dy * dy > 720 * 720) continue
      drawFish(f, x, y)
    }
  }

  // ── boats
  //
  // A boat is a list of voxels: the hull from its model, then the rig built for this frame. Each voxel is
  // filled as the box it covers on screen. The boat has its own depth buffer (`akey`, distance from the
  // eye), so whichever part is nearer wins, from above and from the side alike; the world's buffer only
  // decides whether a hill or a house is in front.
  let akey = new Float32Array(0)
  const RIG_MAX = 90000
  const rigA = new Float32Array(RIG_MAX)
  const rigF = new Float32Array(RIG_MAX)
  const rigZ = new Float32Array(RIG_MAX)
  const rigNA = new Float32Array(RIG_MAX)
  const rigNF = new Float32Array(RIG_MAX)
  const rigNZ = new Float32Array(RIG_MAX)
  const rigK = new Uint8Array(RIG_MAX)
  // what may fade in first person once under way: 0 never (spars, the cloth's edges) · 1 sail cloth · 2 rope and seams
  const rigT = new Uint8Array(RIG_MAX)
  let rigTag = 0
  let rigN = 0
  function rigVox(a, f, z, k, na, nf, nz) {
    if (rigN >= RIG_MAX) return
    rigT[rigN] = k === 13 ? 2 : rigTag
    rigA[rigN] = a
    rigF[rigN] = f
    rigZ[rigN] = z
    rigK[rigN] = k
    rigNA[rigN] = na
    rigNF[rigN] = nf
    rigNZ[rigN] = nz
    rigN++
  }
  function rigLine(a0, f0, z0, a1, f1, z1, k, g) {
    const len = Math.sqrt((a1 - a0) * (a1 - a0) + (f1 - f0) * (f1 - f0) + (z1 - z0) * (z1 - z0))
    const n = Math.max(1, Math.ceil(len / (g * 0.9)))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      rigVox(a0 + (a1 - a0) * t, f0 + (f1 - f0) * t, z0 + (z1 - z0) * t, k, 0, 0, 0)
    }
  }
  // A sail between four corners: luff foot, leech foot, luff head, leech head (a triangle repeats the head).
  // It bellies out along the horizontal normal (na, nf), most at mid-chord and low down, and the normal
  // follows the curve, so the light runs across it.
  function rigSail(p00, p10, p01, p11, na, nf, belly, g, k) {
    const d = (p, q) => Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2)
    const chord = Math.max(d(p00, p10), d(p01, p11), 0.01)
    const ns = Math.max(1, Math.ceil(chord / (g * 0.85)))
    const nt = Math.max(1, Math.ceil(Math.max(d(p00, p01), d(p10, p11)) / (g * 0.85)))
    let ca = p10[0] - p00[0]
    let cf = p10[1] - p00[1]
    const cl = Math.sqrt(ca * ca + cf * cf) || 1
    ca /= cl
    cf /= cl
    // up close, the cloth shows its panels: a seam across the sail every 0.9
    const seams = k === YM_SAIL && g <= 0.13
    for (let i = 0; i <= ns; i++) {
      const s = i / ns
      const bend = Math.sin(Math.PI * s)
      const slope = (belly * Math.PI * Math.cos(Math.PI * s)) / chord
      const nA = na - ca * slope
      const nF = nf - cf * slope
      for (let j = 0; j <= nt; j++) {
        const t = j / nt
        const bl = belly * bend * (1 - 0.35 * t)
        const a = (1 - t) * (p00[0] + (p10[0] - p00[0]) * s) + t * (p01[0] + (p11[0] - p01[0]) * s) + na * bl
        const f = (1 - t) * (p00[1] + (p10[1] - p00[1]) * s) + t * (p01[1] + (p11[1] - p01[1]) * s) + nf * bl
        const z = (1 - t) * (p00[2] + (p10[2] - p00[2]) * s) + t * (p01[2] + (p11[2] - p01[2]) * s)
        const seam = seams && (z + 9) % 0.9 < g * 0.9
        rigTag = seam ? 2 : i > 1 && i < ns - 1 && j > 1 && j < nt - 1 ? 1 : 0
        rigVox(a, f, z, seam ? 12 : k, nA, nF, 0)
      }
    }
    rigTag = 0
  }

  /** masts, spars, sails, stays and the flag of one boat, for this frame */
  function buildRig(b, Y, g, own) {
    rigN = 0
    const lod = g < 0.2 ? 2 : g < 0.4 ? 1 : 0
    const half = Y.L / 2
    const u = b.sail
    const side = b.boom >= 0 ? 1 : -1
    const phi = Math.abs(b.boom)
    const furled = u < 0.06
    for (let mi = 0; mi < Y.masts.length; mi++) {
      const M = Y.masts[mi]
      const mf = M.f
      const deck = yachtDeck(Y, mf)
      const bz = deck + 0.95
      rigLine(0, mf, deck, 0, mf, M.h, 10, g)
      // the boom swings out to leeward; the top of the sail twists off a little further
      const ca = side * Math.sin(phi)
      const cf = -Math.cos(phi)
      const na = side * Math.cos(phi)
      const nf = Math.sin(phi)
      const end = [ca * M.boom, mf + cf * M.boom, bz]
      rigLine(0, mf, bz, end[0], end[1], end[2], 10, g)
      const tack = [0, mf, bz + g]
      const clew = [end[0], end[1], bz + g]
      if (M.throat > 0) {
        const tw = phi + 0.2 * u
        const ga = side * Math.sin(tw)
        const gf = -Math.cos(tw)
        const throatZ = bz + 0.4 + (M.throat - bz - 0.4) * u
        const lean = 1.5 - 0.5 * u // the gaff lies along the boom when lowered, and stands at ~57° when up
        const peak = [ga * M.gaff * Math.sin(lean), mf + gf * M.gaff * Math.sin(lean), throatZ + M.gaff * Math.cos(lean)]
        rigLine(0, mf, throatZ, peak[0], peak[1], peak[2], 10, g)
        if (!furled) {
          rigSail(tack, clew, [0, mf, throatZ], peak, na, nf, 0.1 * M.boom * u, g, YM_SAIL)
          if (M.top) {
            const topZ = throatZ + (M.h - 0.4 - throatZ) * u
            rigSail([0, mf, throatZ + g], [peak[0], peak[1], peak[2] + g], [0, mf, topZ], [0, mf, topZ], na, nf, 0.05 * M.gaff * u, g, YM_SAIL)
          }
        }
      } else if (!furled) {
        const head = [0, mf, bz + (M.h - 0.5 - bz) * u]
        rigSail(tack, clew, head, head, na, nf, 0.1 * M.boom * u, g, YM_SAIL)
      }
      if (furled) {
        // the sail bundled along the boom
        for (let t = 0.04; t <= 0.9; t += g / M.boom) {
          rigVox(ca * M.boom * t, mf + cf * M.boom * t, bz + g, 12, na, nf, 0.6)
          if (lod > 0) rigVox(ca * M.boom * t, mf + cf * M.boom * t, bz + g * 2, 12, 0, 0, 1)
        }
      }
      // shrouds, down to the rail either side
      if (lod > 0) {
        const w = yachtHalf(Y, mf - 0.4, deck)
        for (const s of [-1, 1]) rigLine(s * w, mf - 0.4, deck + 0.1, 0, mf, M.h * 0.86, 13, g)
      }
    }
    // jibs, set on stays from the bowsprit or the stem up to the foremast
    const fore = Y.masts[0]
    const phiJ = Math.min(phi * 0.8 + 0.1, 0.9)
    const bowZ = yachtDeck(Y, half) - 0.1
    for (const J of Y.jibs) {
      const tf = J.sprit ? half * 0.94 + Y.sprit * 0.95 : half * 0.9
      const tz = J.sprit ? bowZ + Y.sprit * 0.95 * 0.12 + 0.05 : yachtDeck(Y, tf) + 0.15
      const hf = fore.f + 0.15
      if (lod > 0 || furled) rigLine(0, tf, tz, 0, hf, J.head, 13, g)
      if (furled) continue
      const head = [0, tf + (hf - tf) * u, tz + (J.head - tz) * u]
      const foot = (tf - fore.f) * 0.62
      const clew = [side * Math.sin(phiJ) * foot, tf - Math.cos(phiJ) * foot, tz + 0.35]
      rigSail([0, tf, tz], clew, head, head, side * Math.cos(phiJ), Math.sin(phiJ), 0.08 * foot * u, g, YM_SAIL)
    }
    // a pennant at the main masthead streaming downwind: the boat you are in flies a big blue one
    let main = Y.masts[0]
    for (const M of Y.masts) if (M.h > main.h) main = M
    const rel = windYaw - b.yaw
    const da = Math.sin(rel)
    const df = Math.cos(rel)
    const len = own ? 2.8 : 1.1
    const tall = own ? 1.1 : 0.45
    for (let s = 0; s <= 1; s += g / len) {
      const wave = Math.sin(time * 9 - s * 5 + b.phase) * 0.22 * s
      const hgt = tall * (1 - s * 0.85)
      for (let h = 0; h <= hgt; h += g) {
        rigVox(da * s * len - df * wave, main.f + df * s * len + da * wave, main.h + 0.15 - h, own ? 14 : 15, -df, da, 0)
      }
    }
  }

  // per boat, while its voxels are drawn
  let yOU = 0
  let yOV = 0
  let yOW = 0
  let yAU = 0
  let yAV = 0
  let yFU = 0
  let yFV = 0
  let yHX = 0
  let yHY = 0
  let yCH = 1
  let ySH = 0
  let yCP = 1
  let ySP = 0
  let yCS = 1
  let ySN = 0
  let yHull = YM_HULL
  let yCut = -1e9
  let yZW = false // also write the depth buffer, so that what is behind (a jet) stays hidden
  let yFadeT = null // per-voxel fade tags (rigT) while the rig is see-through, else null
  let yFadeS = 1 // how much of the sail cloth is left, 0–1
  let yFadeR = 1 // how much of the rope
  let yX0 = 0
  let yY0 = 0
  let yX1 = 0
  let yY1 = 0
  const yL = new Float32Array(3)
  const yE = new Float32Array(3)

  function rasterVox(A, F, Z, NA, NF, NZ, K, n) {
    const _fb = fb
    const _zb = zbuf
    const _ak = akey
    const _mk = jetMask
    const q = vQ
    const S = vS
    const tn = vTan
    const Cx = vCx
    const Cy = vCy
    const persp = q > 1e-6
    const eyeV = persp ? -1 / q : 0
    const eyeW = persp ? tn / q : 0
    const Lx = yL[0]
    const Ly = yL[1]
    const Lz = yL[2]
    const zw = yZW
    const ft = yFadeT
    for (let v = 0; v < n; v++) {
      const a = A[v]
      const f = F[v]
      if (f < yCut) continue
      // see-through: screen-door dither against a 4×4 Bayer pattern, so the cloth thins to nothing
      const tag = ft === null ? 0 : ft[v]
      const keep = tag === 0 ? 1 : tag === 1 ? yFadeS : yFadeR
      if (keep <= 0) continue
      const lvl = keep * 16
      const z = Z[v]
      // heel about the keel, then pitch
      const a1 = a * yCH + z * ySH
      const z1 = -a * ySH + z * yCH
      const f1 = f * yCP - z1 * ySP
      const z2 = f * ySP + z1 * yCP
      const U = yOU + a1 * yAU + f1 * yFU
      const V = yOV + a1 * yAV + f1 * yFV
      const Wz = yOW + z2
      const den = 1 + q * V
      if (den < 0.15 || V < vNear) continue
      const m = S / den
      const sx = Cx + m * U
      const sy = Cy - m * (Wz + tn * V)
      let x0 = Math.round(sx - yHX * m)
      let x1 = Math.round(sx + yHX * m)
      if (x1 <= x0) x1 = x0 + 1
      let y0 = Math.round(sy - yHY * m)
      let y1 = Math.round(sy + yHY * m)
      if (y1 <= y0) y1 = y0 + 1
      if (x1 <= 0 || y1 <= 0 || x0 >= W || y0 >= H) continue
      if (x0 < 0) x0 = 0
      if (y0 < 0) y0 = 0
      if (x1 > W) x1 = W
      if (y1 > H) y1 = H
      const key = persp ? U * U + (V - eyeV) * (V - eyeV) + (Wz - eyeW) * (Wz - eyeW) : V - tn * Wz
      // shade from the sun; sails are lit on whichever face the eye sees
      let k = K[v]
      if (k === 0) k = yHull
      let shade = 2
      const na = NA[v]
      const nf = NF[v]
      const nz = NZ[v]
      if (na !== 0 || nf !== 0 || nz !== 0) {
        const na1 = na * yCH + nz * ySH
        const nz1 = -na * ySH + nz * yCH
        const wx = na1 * yCS + nf * ySN
        const wy = na1 * ySN - nf * yCS
        let d = wx * Lx + wy * Ly + nz1 * Lz
        if (k === YM_SAIL || k === 12) {
          if (wx * yE[0] + wy * yE[1] + nz1 * yE[2] < 0) d = -d
          shade = d > 0.12 ? 3 : d < -0.16 ? 1 : 2
        } else if (k === YM_FLUKE && wx * yE[0] + wy * yE[1] + nz1 * yE[2] < 0) {
          k = YM_FLUKE + 1 // the pale underside of the flukes
          shade = 2
        } else if (nz1 > 0.7) shade = 2
        else shade = d > 0.2 ? 3 : d < -0.06 ? 0 : 1
      }
      const col = yachtPal[k * 4 + shade]
      for (let yy = y0; yy < y1; yy++) {
        let at = yy * W + x0
        for (let xx = x0; xx < x1; xx++, at++) {
          if (_zb[at] < V - 1) continue // a hill or a house is in front
          if (lvl < 16 && BAYER4[((yy & 3) << 2) | (xx & 3)] >= lvl) continue
          if (key >= _ak[at]) continue
          _ak[at] = key
          _fb[at] = col
          _mk[at] = 1
          if (zw && V < _zb[at]) _zb[at] = V
        }
      }
      if (x0 < yX0) yX0 = x0
      if (x1 > yX1) yX1 = x1
      if (y0 < yY0) yY0 = y0
      if (y1 > yY1) yY1 = y1
    }
  }

  /** foam on the water, blended with what is there (t 0 solid … 1 gone) */
  function foamDot(px, py, depth, size, t) {
    const s = Math.max(1, size | 0)
    const x0 = Math.round(px - s / 2)
    const y0 = Math.round(py - s / 2)
    const k = ((1 - t) * 256) | 0
    const fr = foamCol & 255
    const fg = (foamCol >> 8) & 255
    const fbl = (foamCol >> 16) & 255
    for (let yy = y0; yy < y0 + s; yy++) {
      for (let xx = x0; xx < x0 + s; xx++) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
        const at = yy * W + xx
        if (zbuf[at] < depth - 1) continue
        const bg = fb[at]
        const r = ((bg & 255) * (256 - k) + fr * k) >> 8
        const g = (((bg >> 8) & 255) * (256 - k) + fg * k) >> 8
        const bl = (((bg >> 16) & 255) * (256 - k) + fbl * k) >> 8
        fb[at] = ((255 << 24) | (bl << 16) | (g << 8) | r) >>> 0
      }
    }
  }

  /**
   * A lamp's light, added to what is there: strongest in the middle and gone r pixels out, in steps of
   * a quarter dithered between, so it keeps the pixel look. a is its strength in the middle (0…1).
   */
  function glow(sx, sy, r, col, a) {
    if (a <= 0.02 || r < 0.5) return
    const R = Math.ceil(r)
    const y0 = Math.max(rowLo, Math.floor(sy) - R)
    const y1 = Math.min(rowHi - 1, Math.floor(sy) + R)
    const x0 = Math.max(colLo, Math.floor(sx) - R)
    const x1 = Math.min(colHi - 1, Math.floor(sx) + R)
    const ir2 = 1 / (r * r)
    const cr = col & 255
    const cg = (col >> 8) & 255
    const cb = (col >> 16) & 255
    const _fb = fb
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - sy
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - sx
        const d = 1 - (dx * dx + dy * dy) * ir2
        if (d <= 0) continue
        const w = Math.floor(a * d * d * 4 + BAYER[((y & 3) << 2) | (x & 3)] / 16) * 0.25
        if (w <= 0) continue
        const o = y * W + x
        const bg = _fb[o]
        const r1 = Math.min(255, (bg & 255) + cr * w)
        const g1 = Math.min(255, ((bg >> 8) & 255) + cg * w)
        const b1 = Math.min(255, ((bg >> 16) & 255) + cb * w)
        _fb[o] = ((255 << 24) | (b1 << 16) | (g1 << 8) | r1) >>> 0
      }
    }
  }

  /** a lamp at a world point that is not a voxel: its glow, worldR across, unless the ground is in front */
  function lampGlow(x, y, z, worldR, col, a) {
    if (a <= 0.02 || !project(x, y, z) || prV < vNear) return
    const px = Math.floor(prX)
    const py = Math.floor(prY)
    if (px < colLo || py < rowLo || px >= colHi || py >= rowHi) return
    if (zbuf[py * W + px] < prV - 1.5) return // a hill or a house is in front
    glow(prX, prY, clamp(prM * worldR, 1.5, 9), col, a)
  }

  /**
   * One lamp on the voxel object voxBegin set up, at (a, f, z) in its own units: a voxel of g in the lit
   * material k, wherever nothing nearer hides it. True if any of it shows; prX, prY, prM and prV are
   * then where its middle is.
   */
  function lampVox(a, f, z, k, g) {
    if (f < yCut) return false
    const a1 = a * yCH + z * ySH
    const z1 = -a * ySH + z * yCH
    const f1 = f * yCP - z1 * ySP
    const z2 = f * ySP + z1 * yCP
    const U = yOU + a1 * yAU + f1 * yFU
    const V = yOV + a1 * yAV + f1 * yFV
    const Wz = yOW + z2
    const q = vQ
    const den = 1 + q * V
    if (den < 0.15 || V < vNear) return false
    const m = vS / den
    prX = vCx + m * U
    prY = vCy - m * (Wz + vTan * V)
    prM = m
    prV = V
    const h = 0.5 * g * m
    let x0 = Math.round(prX - h)
    let x1 = Math.round(prX + h)
    if (x1 <= x0) x1 = x0 + 1
    let y0 = Math.round(prY - h)
    let y1 = Math.round(prY + h)
    if (y1 <= y0) y1 = y0 + 1
    if (x1 <= 0 || y1 <= 0 || x0 >= W || y0 >= H) return false
    if (x0 < 0) x0 = 0
    if (y0 < 0) y0 = 0
    if (x1 > W) x1 = W
    if (y1 > H) y1 = H
    const key = q > 1e-6 ? U * U + (V + 1 / q) * (V + 1 / q) + (Wz - vTan / q) * (Wz - vTan / q) : V - vTan * Wz
    const col = yachtPal[k * 4 + 2]
    let shown = false
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0, at = yy * W + x0; xx < x1; xx++, at++) {
        if (zbuf[at] < V - 1 || key >= akey[at]) continue
        akey[at] = key
        fb[at] = col
        jetMask[at] = 1
        shown = true
      }
    }
    if (x0 < yX0) yX0 = x0
    if (x1 > yX1) yX1 = x1
    if (y0 < yY0) yY0 = y0
    if (y1 > yY1) yY1 = y1
    return shown
  }

  // a boat's lights at night, all warm lanterns: one on each side a little forward of the middle, one
  // on the stern and one at the top of the foremast. Each boat lights up at its own moment as the dusk deepens.
  function drawBoatLamps(Y, idx) {
    const on = lampOn(hash8(idx * 2654435 + 977))
    if (on <= 0) return
    const g = 0.35
    const r = (wr) => clamp(prM * wr, 1.5, 8)
    const fs = Y.L * 0.22
    const ds = yachtDeck(Y, fs)
    const hs = Math.max(0.3, yachtHalf(Y, fs, ds - 0.05)) + 0.1
    for (const side of [1, -1]) {
      if (lampVox(side * hs, fs, ds + 0.15, YM_LAMP, g)) glow(prX, prY, r(0.9), LAMP_WARM_GLOW, 0.4 * on)
    }
    const ft = -Y.L / 2 + 0.4
    if (lampVox(0, ft, yachtDeck(Y, ft) + 0.4, YM_LAMP, g)) glow(prX, prY, r(1.4), LAMP_WARM_GLOW, 0.5 * on)
    const M = Y.masts[0]
    if (lampVox(0, M.f, M.h + 0.2, YM_LAMP, g)) glow(prX, prY, r(1), LAMP_WARM_GLOW, 0.35 * on)
  }

  function drawYacht(b, x, y, idx) {
    const Y = YACHTS[b.kind] || YACHTS[0]
    const half = Y.L / 2
    const cs = Math.cos(b.yaw)
    const sn = Math.sin(b.yaw)
    const bob = Math.sin(time * 1.35 + b.phase) * 0.14
    if (!project(x, y, bob)) return
    const m0 = prM
    const reach = (half + Y.sprit + 15) * m0
    if (prX < -reach || prX > W + reach || prY - 14 * m0 > H + reach || prY < -reach) return
    const own = idx === aboard
    const firstPerson = own && footView === 1
    // in first person the eye is in the cockpit: nothing behind it is drawn, the wake included
    const cut = firstPerson ? yachtEyeF(Y) + 0.5 : -1e9
    // the wake: a V spreading from the bow and churned water behind the stern
    if (b.v > 0.3) {
      const len = clamp(b.v * 1.3, 3, 15)
      const spread = 0.36
      for (const arm of [-1, 1]) {
        for (let d = 0.6; d < len; d += 0.9) {
          if ((((d * 3 + time * 7 + b.phase) | 0) & 3) === 0) continue
          const a = arm * Math.sin(spread) * d
          const f = half * 0.8 - Math.cos(spread) * d
          if (f < cut) break
          if (!project(x + a * cs + f * sn, y + a * sn - f * cs, 0.05)) continue
          foamDot(prX, prY, prV, Math.ceil(prM * 0.55), clamp(d / len, 0, 1) * 0.85)
        }
      }
      for (let d = 0.4; d < len * 0.8 && !firstPerson; d += 0.8) {
        if ((((d * 5 + time * 9 + b.phase * 3) | 0) % 3) === 0) continue
        const a = Math.sin(time * 4 + d * 2.3 + b.phase) * 0.35 * Math.min(1, d)
        const f = -half * 0.72 - d
        if (!project(x + a * cs + f * sn, y + a * sn - f * cs, 0.05)) continue
        foamDot(prX, prY, prV, Math.ceil(prM * 0.7), clamp(d / (len * 0.8), 0, 1) * 0.8)
      }
    }
    const lod = firstPerson ? 3 : m0 >= 9 ? 2 : m0 >= 2.2 ? 1 : 0
    const g = YACHT_LOD[lod]
    const heel = b.heel + Math.sin(time * 0.9 + b.phase) * 0.02
    const pitch = Math.sin(time * 1.1 + b.phase * 1.7) * 0.025
    voxBegin(x, y, bob, b.yaw, heel, pitch, g)
    yHull = YM_HULL + (b.hull | 0)
    // in first person, only what is ahead of the eye: the cabin top, the masts and sails, the
    // foredeck and the bow. What you sit in is painted under them.
    yCut = cut
    yZW = firstPerson
    const hull = yachtModel(b.kind | 0, lod)
    rasterVox(hull.A, hull.F, hull.Z, hull.NA, hull.NF, hull.NZ, hull.K, hull.n)
    buildRig(b, Y, g, own)
    // seen from on board while under way, the sail cloth thins away to its edges, and the seams and
    // stays to dotted lines, so they do not hide the view; the masts and spars stay solid
    if (firstPerson && rigGhost > 0.01) {
      yFadeT = rigT
      yFadeS = 1 - rigGhost * 1.1 // all gone a little before the ease ends
      yFadeR = 1 - 0.6 * rigGhost
    }
    rasterVox(rigA, rigF, rigZ, rigNA, rigNF, rigNZ, rigK, rigN)
    // Enzo, out on deck: drawn with the boat, so the hull and the rig hide him where they should
    if (own && !firstPerson && lounge > 0) drawEnzoOut(Y)
    if (lampK > 0) drawBoatLamps(Y, idx)
    voxEnd()
  }

  /**
   * Enzo on the deck of the boat you are in, at lounge seconds along the way out: up the ladder
   * through the forehatch (nothing of him below the deck), out across the deck to the rail, then
   * down onto it facing out, his legs over the side, leaning back on one hand with the other on
   * his knee, his shins swinging. Going back in plays it backwards, but he turns to walk to the
   * hatch face first. PERSON, posed, scaled and turned into boat units.
   */
  function drawEnzoOut(Y) {
    const t = lounge
    const side = loungeSide
    const sc = LOUNGE_SCALE
    const ease = (u) => u * u * (3 - 2 * u)
    const fs = Y.seat
    const deck = yachtDeck(Y, fs)
    const rail = yachtHalf(Y, fs, deck)
    const standA = rail - 0.5
    const hipA = rail - 0.15
    // the thighs rest on the deck edge, just over the toe-rail
    const seatZ = deck + 0.2
    let at = 0 // how far out from the middle of the deck
    let base = deck // where his feet are, standing
    let clipZ = -1e9
    let psi = side > 0 ? 0 : Math.PI // which way he faces: 0 starboard, π port
    let hip1 = 0, hip2 = 0, knee1 = 0, knee2 = 0, arm1 = 0, arm2 = 0, lean = 0
    if (t < LOUNGE_RISE) {
      // three rungs, a step each, his arms reaching up in turn for the hatch rim
      const e = (t / LOUNGE_RISE) * 3
      const rung = Math.min(3, Math.floor(e) + ease(e - Math.floor(e)))
      base = deck - (1 - rung / 3) * 5.6 * sc
      clipZ = deck - 0.03
      const w = Math.sin(e * Math.PI)
      arm1 = 0.6 + 0.4 * w
      arm2 = 0.6 - 0.4 * w
      hip1 = 0.5 * Math.max(0, w)
      hip2 = 0.5 * Math.max(0, -w)
      knee1 = 2 * hip1
      knee2 = 2 * hip2
      if (loungeDir < 0) psi += Math.PI
    } else if (t < LOUNGE_RISE + LOUNGE_WALK) {
      const u = (t - LOUNGE_RISE) / LOUNGE_WALK
      at = standA * u
      const stride = Math.sin(u * Math.PI * 3)
      hip1 = 0.45 * stride
      hip2 = -hip1
      arm1 = -0.4 * stride
      arm2 = -arm1
      base = deck + Math.abs(Math.cos(u * Math.PI * 3)) * 0.04
      // on the way back he turns to face the hatch as he sets off
      if (loungeDir < 0) psi += Math.PI * clamp((LOUNGE_RISE + LOUNGE_WALK - t) / 0.3, 0, 1)
    } else {
      const k = clamp((t - LOUNGE_RISE - LOUNGE_WALK) / LOUNGE_SIT, 0, 1)
      const kLeg = ease(Math.min(1, k * 1.4)) // the legs come up over the rail ahead of the drop
      const kDrop = ease(k) ** 1.6
      at = standA + (hipA - standA) * ease(k)
      // sat, the hip is LOUNGE_SCALE·(hip − thigh's underside) over the seat
      base = deck + (seatZ - (PERSON_HIP - 0.25) * sc - deck) * kDrop
      hip1 = hip2 = 1.38 * kLeg
      // the shins hang straight down (knee bend = thigh angle), swinging a little, one then the other
      const sway = 0.22 * k * Math.sin(time * 1.7)
      knee1 = hip1 - sway
      knee2 = hip2 + sway
      lean = 0.18 * ease(k)
      arm1 = -0.3 * ease(k) // a hand on the deck behind him
      arm2 = 0.35 * ease(k) // the other on his knee
    }
    const P = PERSON
    const cp = Math.cos(psi)
    const sp = Math.sin(psi)
    const cl = Math.cos(lean)
    const sl = Math.sin(lean)
    const x0 = side * at
    let n = 0
    for (let v = 0; v < P.n; v++) {
      const part = P.P[v]
      let f = P.F[v]
      let z = P.Z[v]
      let nf = P.NF[v]
      let nz = P.NZ[v]
      if (part === 1 || part === 2) {
        // the thigh turns about the hip; below the knee, the shin turns back by the knee bend
        const th = part === 1 ? hip1 : hip2
        let ang = th
        let pf = 0
        let pz = PERSON_HIP
        let dz = z - PERSON_HIP
        if (z < PERSON_KNEE) {
          const thigh = PERSON_HIP - PERSON_KNEE
          pf = Math.sin(th) * thigh
          pz = PERSON_HIP - Math.cos(th) * thigh
          ang = th - (part === 1 ? knee1 : knee2)
          dz = z - PERSON_KNEE
        }
        const c = Math.cos(ang)
        const s = Math.sin(ang)
        f = pf + P.F[v] * c - dz * s
        z = pz + P.F[v] * s + dz * c
        nf = P.NF[v] * c - P.NZ[v] * s
        nz = P.NF[v] * s + P.NZ[v] * c
      } else if (part >= 3) {
        const s0 = part === 3 ? arm1 : arm2
        const c = Math.cos(s0)
        const s = Math.sin(s0)
        const dz = z - PERSON_SHOULDER
        f = P.F[v] * c - dz * s
        z = PERSON_SHOULDER + P.F[v] * s + dz * c
        nf = P.NF[v] * c - P.NZ[v] * s
        nz = P.NF[v] * s + P.NZ[v] * c
      }
      if (lean !== 0 && part !== 1 && part !== 2) {
        // the body and arms lean back about the hip
        const dz = z - PERSON_HIP
        const f1 = f * cl - dz * sl
        z = PERSON_HIP + f * sl + dz * cl
        f = f1
        const nf1 = nf * cl - nz * sl
        nz = nf * sl + nz * cl
        nf = nf1
      }
      const bz = base + z * sc
      if (bz < clipZ) continue
      const a = P.A[v]
      rigA[n] = x0 + sc * (f * cp + a * sp)
      rigF[n] = fs + sc * (f * sp - a * cp)
      rigZ[n] = bz
      rigNA[n] = nf * cp + P.NA[v] * sp
      rigNF[n] = nf * sp - P.NA[v] * cp
      rigNZ[n] = nz
      rigK[n] = P.K[v]
      n++
    }
    voxGrain(PERSON_G * sc)
    rasterVox(rigA, rigF, rigZ, rigNA, rigNF, rigNZ, rigK, n)
  }

  /** the size each voxel splats to on screen, for voxels of size g in the object set up by voxBegin */
  function voxGrain(g) {
    yHX = 0.5 * g * (Math.abs(yAU) + Math.abs(yFU)) + 0.02
    yHY = 0.5 * g * (vTan * (Math.abs(yAV) + Math.abs(yFV)) + 1) + 0.02
  }

  /** set up the view of one voxel object at (x, y, z) turned to yaw, heeled and pitched, voxels of size g */
  function voxBegin(x, y, z, yaw, heel, pitch, g) {
    const c = vCos
    const s = vSin
    const cs = Math.cos(yaw)
    const sn = Math.sin(yaw)
    const dx = x - cam.x
    const dy = y - cam.y
    yOU = dx * c - dy * s
    yOV = -(dx * s + dy * c)
    yOW = z - cam.alt
    yAU = cs * c - sn * s
    yAV = -(cs * s + sn * c)
    yFU = sn * c + cs * s
    yFV = -(sn * s - cs * c)
    voxGrain(g)
    yCH = Math.cos(heel)
    ySH = Math.sin(heel)
    yCP = Math.cos(pitch)
    ySP = Math.sin(pitch)
    yCS = cs
    ySN = sn
    yHull = YM_HULL
    yCut = -1e9
    yZW = false
    yFadeT = null
    const ll = Math.sqrt(sunX * sunX + sunY * sunY + 1.21)
    yL[0] = -sunX / ll
    yL[1] = -sunY / ll
    yL[2] = 1.1 / ll
    yE[0] = vSin
    yE[1] = vCos
    yE[2] = vTan
    yX0 = W
    yY0 = H
    yX1 = 0
    yY1 = 0
  }

  /** after one voxel object: clear its mask and depth over the box it touched */
  function voxEnd() {
    if (yX1 <= yX0) return
    const _mk = jetMask
    const _ak = akey
    for (let yy = Math.max(0, yY0 - 1); yy <= Math.min(H - 1, yY1 + 1); yy++) {
      const a0 = yy * W + Math.max(0, yX0 - 1)
      const a1 = yy * W + Math.min(W, yX1 + 2)
      _mk.fill(0, a0, a1)
      _ak.fill(1e30, a0, a1)
    }
  }

  function ensureAkey() {
    if (akey.length >= W * H) return
    akey = new Float32Array(W * H)
    akey.fill(1e30)
  }

  function drawBoats() {
    if (!boats.length) return
    ensureAkey()
    const wrapToCam = (v, c) => c + (v - c - N * Math.round((v - c) / N))
    const order = boats.map((b, i) => {
      const x = wrapToCam(b.x, cam.x)
      const y = wrapToCam(b.y, cam.y)
      return { i, d: (x - cam.x) * vSin + (y - cam.y) * vCos, x, y }
    })
    order.sort((a, b) => a.d - b.d)
    for (const e of order) {
      const dx = e.x - cam.x
      const dy = e.y - cam.y
      if (dx * dx + dy * dy > 780 * 780) continue
      drawYacht(boats[e.i], e.x, e.y, e.i)
    }
  }

  // The chapel and the temple, drawn first of everything that stands in the world, at a level of detail
  // for how near they are. They write zbuf as the ground does, so what is behind them (props, boats, the
  // person, the plane, lamps' glows) is hidden by them. The finest model is made a little at a time while
  // the next one down is shown, so coming near costs no stall.
  function drawMonuments() {
    if (chapel) drawMonument(chapel, MONUMENTS.chapel)
    if (temple) drawMonument(temple, MONUMENTS.temple)
    if (museum) drawMonument(museum, MONUMENTS.museum)
  }
  function drawMonument(mo, M) {
    const x = mo.x - N * Math.round((mo.x - cam.x) / N)
    const y = mo.y - N * Math.round((mo.y - cam.y) / N)
    if ((x - cam.x) ** 2 + (y - cam.y) ** 2 > 1100 * 1100 || !project(x, y, mo.z + M.mid)) return
    const m = prM
    const reach = M.reach * m + 4
    if (prX < -reach || prX > W + reach || prY < -reach * 1.2 || prY > H + reach) return
    ensureAkey()
    let lod = m >= 9 ? 2 : m >= 2.2 ? 1 : 0
    let model = null
    if (lod === 2) model = monumentFine(M, 3)
    else if (lod === 1) monumentFine(M, 1.5)
    if (!model) {
      lod = Math.min(lod, 1)
      model = monumentModel(M, lod)
    }
    voxBegin(x, y, mo.z, mo.yaw, 0, 0, MON_LOD[lod])
    yZW = true
    rasterVox(model.A, model.F, model.Z, model.NA, model.NF, model.NZ, model.K, model.n)
    voxEnd()
  }

  const swingC = new Float32Array(5)
  const swingS = new Float32Array(5)
  // the statues, benches and urns, and the spray of each fountain: a jet from the spout falling in four arcs
  function drawGardens() {
    if (props.length === 0 && fountains.length === 0) return
    ensureAkey()
    const onScreen = (x, y, z, reach) => {
      if (!project(x, y, z)) return false
      const r = prM * reach + 2
      return prX > -r && prX < W + r && prY > -r * 1.5 && prY < H + r
    }
    for (const s of props) {
      if (!s.alive) continue
      const x = s.x - N * Math.round((s.x - cam.x) / N)
      const y = s.y - N * Math.round((s.y - cam.y) / N)
      if ((x - cam.x) ** 2 + (y - cam.y) ** 2 > 780 * 780 || !onScreen(x, y, s.z, 4)) continue
      // at night the garden lamps come on, each at its own moment, and a soft light falls on the statues
      const on = lampK > 0 && (s.kind === P_LAMP || s.kind <= 1) ? lampOn(hash8(((s.x * 8) | 0) * 7919 + ((s.y * 8) | 0))) : 0
      const M = s.kind === P_LAMP && on > 0.4 ? LAMP_LIT : PROPS[s.kind]
      voxBegin(x, y, s.z, s.yaw, 0, 0, PROP_G)
      rasterVox(M.A, M.F, M.Z, M.NA, M.NF, M.NZ, M.K, M.n)
      voxEnd()
      if (on > 0) {
        if (s.kind === P_LAMP) lampGlow(x, y, s.z + LAMP_TOP, 1.9, LAMP_WARM_GLOW, 0.55 * on)
        else lampGlow(x, y, s.z + 1.2, 1.7, LAMP_WARM_GLOW, 0.22 * on)
      }
    }
    for (const f of fountains) {
      if (!f.alive) continue
      const x = f.x - N * Math.round((f.x - cam.x) / N)
      const y = f.y - N * Math.round((f.y - cam.y) / N)
      if (!onScreen(x, y, f.z, 3)) continue
      rigN = 0
      const t = time + f.x * 0.37
      for (let k = 0; k < 6; k++) {
        if (((k + ((t * 12) | 0)) & 3) === 0) continue // drops, not a solid rod
        rigVox(0, 0, 0.1 + k * 0.2, YM_SPRAY, 0, 0, 1)
      }
      for (let arm = 0; arm < 4; arm++) {
        const a = arm * (Math.PI / 2) + Math.PI / 4
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        for (let i = 0; i < 5; i++) {
          const u = (i / 5 + t * 0.9) % 1
          const r = 0.2 + u * 1.0
          rigVox(ca * r, sa * r, 1.1 + 0.6 * u - 3.0 * u * u, YM_SPRAY, ca, sa, 0.6)
        }
      }
      voxBegin(x, y, f.z, 0, 0, 0, 0.2)
      rasterVox(rigA, rigF, rigZ, rigNA, rigNF, rigNZ, rigK, rigN)
      voxEnd()
      // lit from under the water at night
      if (lampK > 0) lampGlow(x, y, f.z + 0.5, 1.8, FOUNTAIN_GLOW, 0.32 * lampOn(hash8(((f.x * 8) | 0) * 7919 + ((f.y * 8) | 0))))
    }
  }

  // the gulls: each frame works out where each one is on its circle, which way it heads, and how its
  // wings beat. They glide with the wings a little raised and flap now and then.
  function drawBirds() {
    if (birds.length === 0) return
    ensureAkey()
    const t = time
    for (const b of birds) {
      const th = b.w * t + b.ph
      let x = b.ax + Math.cos(th) * b.r
      let y = b.ay + Math.sin(th) * b.r
      const z = b.az + 1.2 * Math.sin(0.5 * t + b.ph)
      const dx = -Math.sin(th) * b.w
      const dy = Math.cos(th) * b.w
      // banked into the circle
      const heel = b.w > 0 ? 0.3 : -0.3
      const flap = Math.sin(0.6 * t + b.ph * 3) > 0.35 ? 0.55 * Math.sin(6.5 * t + b.ph) : 0.12
      x = x - N * Math.round((x - cam.x) / N)
      y = y - N * Math.round((y - cam.y) / N)
      if ((x - cam.x) ** 2 + (y - cam.y) ** 2 > 600 * 600) continue
      if (!project(x, y, z)) continue
      const reach = prM * 3 + 2
      if (prX < -reach || prX > W + reach || prY < -reach || prY > H + reach) continue
      // the wings turn about the shoulder: up on both sides together
      const M = GULL
      const sh = GULL_SHOULDER
      const cf = Math.cos(flap)
      const sf = Math.sin(flap)
      for (let i = 0; i < M.n; i++) {
        const part = M.P[i]
        let a = M.A[i]
        let zz = M.Z[i]
        let na = M.NA[i]
        let nz = M.NZ[i]
        if (part !== 0) {
          const s = part === 1 ? -sf : sf
          const pa = part === 1 ? -sh : sh
          const da = a - pa
          a = pa + da * cf - zz * s
          zz = da * s + zz * cf
          const na0 = na
          na = na0 * cf - nz * s
          nz = na0 * s + nz * cf
        }
        rigA[i] = a
        rigF[i] = M.F[i]
        rigZ[i] = zz
        rigNA[i] = na
        rigNF[i] = M.NF[i]
        rigNZ[i] = nz
        rigK[i] = M.K[i]
      }
      voxBegin(x, y, z, Math.atan2(dx, -dy), heel, 0, GULL_G)
      rasterVox(rigA, rigF, rigZ, rigNA, rigNF, rigNZ, rigK, M.n)
      voxEnd()
    }
  }

  function drawWalker() {
    if (!onFoot || footView !== 0 || aboard >= 0) return
    ensureAkey()
    const moving = walkMove !== 0 || walkSide !== 0
    const stride = moving ? Math.sin(time * 9) : 0
    // a little lift each time the legs pass
    const base = walker.z + (moving ? Math.abs(Math.cos(time * 9)) * 0.08 : 0)
    const x = walker.x - N * Math.round((walker.x - cam.x) / N)
    const y = walker.y - N * Math.round((walker.y - cam.y) / N)
    walkerShadow(x, y, walker.z)
    // legs swing about the hip, each arm against its leg
    const swing = [0, 0.5 * stride, -0.5 * stride, -0.42 * stride, 0.42 * stride]
    for (let p = 0; p < 5; p++) { swingC[p] = Math.cos(swing[p]); swingS[p] = Math.sin(swing[p]) }
    const P = PERSON
    for (let v = 0; v < P.n; v++) {
      const part = P.P[v]
      let f = P.F[v]
      let z = P.Z[v]
      let nf = P.NF[v]
      let nz = P.NZ[v]
      if (part !== 0) {
        const c = swingC[part]
        const s = swingS[part]
        const piv = part < 3 ? PERSON_HIP : PERSON_SHOULDER
        const dz = z - piv
        f = P.F[v] * c - dz * s
        z = piv + P.F[v] * s + dz * c
        nf = P.NF[v] * c - P.NZ[v] * s
        nz = P.NF[v] * s + P.NZ[v] * c
      }
      rigA[v] = P.A[v]
      rigF[v] = f
      rigZ[v] = z
      rigNA[v] = P.NA[v]
      rigNF[v] = nf
      rigNZ[v] = nz
      rigK[v] = P.K[v]
    }
    voxBegin(x, y, base, walker.yaw, 0, 0, PERSON_G)
    rasterVox(rigA, rigF, rigZ, rigNA, rigNF, rigNZ, rigK, P.n)
    voxEnd()
  }

  /** a soft patch of shade on the ground under the man, nudged away from the sun */
  function walkerShadow(x, y, z) {
    if (!project(x + sunX * 0.35, y + sunY * 0.35, z)) return
    const cx = prX
    const cy = prY
    const V = prV
    const rx = 0.75 * prM
    const ry = rx * clamp(vTan, 0.2, 1)
    if (rx < 1) return
    const x0 = Math.max(0, Math.floor(cx - rx))
    const x1 = Math.min(W - 1, Math.ceil(cx + rx))
    const y0 = Math.max(0, Math.floor(cy - ry))
    const y1 = Math.min(H - 1, Math.ceil(cy + ry))
    for (let yy = y0; yy <= y1; yy++) {
      const dy = (yy + 0.5 - cy) / ry
      for (let xx = x0; xx <= x1; xx++) {
        const dx = (xx + 0.5 - cx) / rx
        const r = dx * dx + dy * dy
        if (r > 1) continue
        const at = yy * W + xx
        if (Math.abs(zbuf[at] - V) > 1.5) continue // only on the ground he stands on
        const k = r < 0.55 ? 0.68 : 0.8
        const bg = fb[at]
        fb[at] = ((255 << 24) | ((((bg >> 16) & 255) * k) << 16) | ((((bg >> 8) & 255) * k) << 8) | ((bg & 255) * k)) >>> 0
      }
    }
  }

  function drawBombs() {
    const body = pack(48, 46, 52)
    const rim = pack(92, 86, 80)
    const nose = pack(196, 78, 40)
    const shade = pack(22, 24, 28)
    for (const b of bombs) {
      const floor = groundAt(b.x, b.y)
      if (project(b.x, b.y, floor)) {
        const rad = Math.max(1, Math.ceil(prM * 1.1))
        plotDot(prX - rad * 0.3, prY - rad * 0.2, shade, prV + 0.4, rad + 1)
      }
      if (!project(b.x, b.y, b.z)) continue
      const s = Math.max(1, Math.ceil(prM * 1.15))
      plotDot(prX, prY, body, prV, s + 1)
      plotDot(prX, prY - s, rim, prV - 0.2, s)
      plotDot(prX, prY + s, nose, prV - 0.1, Math.max(1, s - 1))
    }
  }

  function drawBooms() {
    const _fb = fb
    const _zb = zbuf
    for (const bl of blasts) {
      const u = (time - bl.t) / bl.life
      if (u < 0 || u >= 1) continue
      if (!project(bl.x, bl.y, bl.z + 1.5 + u * 4)) continue
      const rad = Math.max(2, bl.r * (0.35 + 0.9 * u) * prM)
      if (rad > 80) continue
      const alpha = u < 0.18 ? u / 0.18 : 1 - (u - 0.18) / 0.82
      const col = flamePal[u < 0.2 ? 0 : u < 0.4 ? 1 : u < 0.65 ? 2 : 3]
      const x0 = Math.max(0, Math.floor(prX - rad))
      const x1 = Math.min(W - 1, Math.ceil(prX + rad))
      const y0 = Math.max(0, Math.floor(prY - rad * 0.72))
      const y1 = Math.min(H - 1, Math.ceil(prY + rad * 0.72))
      const inv = 1 / (rad * rad)
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - prX
          const dy = (y - prY) / 0.72
          const d2 = (dx * dx + dy * dy) * inv
          if (d2 > 1) continue
          const at = y * W + x
          if (_zb[at] < prV - 2) continue
          const edge = 1 - d2
          if (alpha * edge * 16 > BAYER[((y & 3) << 2) | (x & 3)]) {
            _fb[at] = col
            if (d2 < 0.45) _zb[at] = prV
          }
        }
      }
    }
    for (let i = 0; i < BOOM_N; i++) {
      const o = i * BOOM_F
      const life = boom[o + 7]
      if (life <= 0) continue
      const age = time - boom[o + 6]
      if (age < 0 || age >= life) continue
      const u = age / life
      if (!project(boom[o], boom[o + 1], boom[o + 2])) continue
      const heat = clamp((boom[o + 8] + (1 - u) * 2) | 0, 0, 5)
      const s = Math.max(1, Math.ceil(prM * boom[o + 9] * (1.1 - 0.5 * u)))
      if (u > 0.55 && ((i + (age * 20) | 0) & 1) === 0) continue
      plotDot(prX, prY, flamePal[heat], prV, s)
    }
  }

  function drawJet(j, index) {
    const c = vCos
    const s = vSin
    const q = vQ
    const S = vS
    const tn = vTan
    const ax = axes(j)
    const sc = jetSize()
    // the jet's own axes in view space, per voxel: across the screen (U), into it (V), up (W)
    const rU = (ax.rx * c - ax.ry * s) * sc
    const rV = -(ax.rx * s + ax.ry * c) * sc
    const rW = ax.rz * sc
    const fU = (ax.fx * c - ax.fy * s) * sc
    const fV = -(ax.fx * s + ax.fy * c) * sc
    const fW = ax.fz * sc
    const uU = (ax.ux * c - ax.uy * s) * sc
    const uV = -(ax.ux * s + ax.uy * c) * sc
    const uW = ax.uz * sc
    const dx = j.x - cam.x
    const dy = j.y - cam.y
    const cU = dx * c - dy * s
    const cV = -(dx * s + dy * c)
    const cW = j.z + j.joltZ - cam.alt
    // going into the cockpit, the camera moves into the leader, which fades away
    let fade = index === 0 ? jetFade : 1
    if (fade < 0.004) return
    const _bg = backdrop
    const den0 = 1 + q * cV
    if (den0 < 0.2) return
    const m0 = S / den0
    const cx = vCx + m0 * cU
    const cy = vCy - m0 * (cW + tn * cV)
    // the isometric view aboard: a plane passing over the boat turns to a ghost, as the clouds open there
    if (onFoot && aboard >= 0 && footView === 0) {
      const R = BOAT_ISO_HOLE * S
      const hx = cx - vCx
      const hy = (cy - (vCy - BOAT_ISO_MID * S)) * 1.15
      fade = Math.min(fade, clamp((Math.sqrt(hx * hx + hy * hy) - 0.45 * R) / (0.75 * R), 0.18, 1))
    }
    const fading = fade < 1
    const far = JET_L * sc * m0 + 40
    if (cx < -far || cy < -far - H || cx > W + far || cy > H + far) return
    // screen steps for one voxel along the wing and along the fuselage, at the jet's centre
    const prx = m0 * rU
    const pry = -m0 * (rW + tn * rV)
    const pfx = m0 * fU
    const pfy = -m0 * (fW + tn * fV)
    const _fb = fb
    const _mk = jetMask
    const _zb = zbuf
    // light: which way each half of the jet faces the sun
    const lx = -sunX
    const ly = -sunY
    const lz = 1.1
    const ll = Math.sqrt(lx * lx + ly * ly + lz * lz)
    const litAt = jetLitAt
    const dimAt = jetDimAt
    const lit = (side) => {
      const nx = ax.ux + side * 0.4 * ax.rx
      const ny = ax.uy + side * 0.4 * ax.ry
      const nz2 = ax.uz + side * 0.4 * ax.rz
      const b = (nx * lx + ny * ly + nz2 * lz) / (ll * Math.sqrt(nx * nx + ny * ny + nz2 * nz2))
      return b > litAt ? jetPalLit : b < dimAt ? jetPalDim : jetPal
    }
    const palL = lit(-1)
    const palR = lit(1)
    let x0 = W
    let y0 = H
    let x1 = -1
    let y1 = -1
    // several samples per voxel, more the larger it is drawn, so a turned slice has no pin-holes
    const big = (sc * S) / Math.max(0.2, den0 - q * JET_L * 0.6 * sc)
    const ns = clamp(Math.ceil(big * 2 - 0.24), 2, 8)
    for (let i = 0; i < ns; i++) {
      for (let k = 0; k < ns; k++) {
        const oi = (i + 0.5) / ns - 0.5
        const ok = (k + 0.5) / ns - 0.5
        offX[i * ns + k] = oi * prx + ok * pfx
        offY[i * ns + k] = oi * pry + ok * pfy
      }
    }
    const nOff = ns * ns
    // one slice up, on screen: thin columns are filled across that gap
    const pux = m0 * uU * spreadNow
    const puy = -m0 * (uW + tn * uV) * spreadNow
    const fills = Math.min(4, Math.ceil(Math.hypot(pux, puy)) - 1)
    // slices are drawn from the one farthest from eye level to the nearest, so nearer ones cover
    let eye
    if (q < 1e-6) eye = tn * uW - uV >= 0 ? 1e9 : -1e9
    else eye = (-cU * uU + (-1 / q - cV) * uV + (tn / q - cW) * uW) / (sc * sc)
    for (let y = 0; y < JET_H; y++) {
      sliceOrder[y] = y
      sliceKey[y] = Math.abs((y - PIV_Y) * spreadNow - eye)
    }
    for (let i = 1; i < JET_H; i++) {
      const y = sliceOrder[i]
      const key = sliceKey[y]
      let k = i - 1
      while (k >= 0 && sliceKey[sliceOrder[k]] < key) { sliceOrder[k + 1] = sliceOrder[k]; k-- }
      sliceOrder[k + 1] = y
    }
    const it = introT - index * 0.25
    const dropOf = (y) => {
      // the intro: slices fall in from the top one after another and land on the stack
      if (it >= 2) return 0
      const tt = (it - (y - firstSlice) * 0.07) / 0.36
      if (tt <= 0) return NaN
      return tt < 1 ? -(1 - tt * tt) * ((H >> 1) + 44) : 0
    }
    // the propeller: a pale disc where it blurs, and the two wooden blades caught mid-turn with a
    // ghost of where they just were. From in front it covers the nose; from behind, only the gaps.
    const prop = () => {
      if (it < 2) return
      const R = JET_PROP_R
      const hc = (JET_PROP_Y - PIV_Y) * spreadNow
      const b = PIV_K - JET_PROP_K
      const hU = cU + hc * uU + b * fU
      const hV = cV + hc * uV + b * fV
      const hW = cW + hc * uW + b * fW
      const face = q < 1e-6 ? -fV + tn * fW : -hU * fU + (-1 / q - hV) * fV + (tn / q - hW) * fW
      const front = face > 0
      const ca = Math.cos(j.propAngle)
      const sa = Math.sin(j.propAngle)
      const cg = Math.cos(j.propAngle - 0.45)
      const sg = Math.sin(j.propAngle - 0.45)
      const wood = jetPal[56]
      const blur = jetPal[38]
      const hub = jetPal[37]
      const step = clamp(0.6 / Math.max(0.05, m0 * Math.hypot(rU, rW + tn * rV, uU, uW + tn * uV) * 0.7), 0.08, 1)
      for (let w = -R; w <= R; w += step) {
        for (let u = -R; u <= R; u += step) {
          const r2 = u * u + w * w
          if (r2 > R * R) continue
          const V = hV + u * rV + w * uV
            const den = 1 + q * V
            if (den < 0.2) continue
            const m = S / den
          const x = Math.round(vCx + m * (hU + u * rU + w * uU))
          const yy = Math.round(vCy - m * (hW + u * rW + w * uW + tn * V))
          if (x < 0 || yy < 0 || x >= W || yy >= H) continue
          const at = yy * W + x
          const mk = _mk[at]
          if (mk === 2 || (mk === 1 && !front)) continue
                if (_zb[at] < V - 1) continue
          const r = Math.sqrt(r2)
          const blade = Math.abs(-u * sa + w * ca) < 0.35 + 0.25 * (r / R)
          const ghost = !blade && Math.abs(-u * sg + w * cg) < 0.4 + 0.3 * (r / R)
          if (fading && mk === 0) _bg[at] = _fb[at]
          const bg = _fb[at]
          const col = r < 0.9 ? hub : blade ? wood : blur
          const k = r < 0.9 ? 256 : blade ? 220 : ghost ? 70 : 34
          _fb[at] = k >= 256 ? col : (((255 << 24) | (((((bg >> 16) & 255) * (256 - k) + ((col >> 16) & 255) * k) >> 8) << 16) | (((((bg >> 8) & 255) * (256 - k) + ((col >> 8) & 255) * k) >> 8) << 8) | ((((bg & 255) * (256 - k) + (col & 255) * k) >> 8))) >>> 0)
          _mk[at] = 2 // never outlined, and blended only once
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (yy < y0) y0 = yy
          if (yy > y1) y1 = yy
        }
      }
    }
    for (let n = 0; n < JET_H; n++) {
      const y = sliceOrder[n]
      const cnt = sliceC[y].length
      if (cnt === 0) continue
      const drop = dropOf(y)
      if (drop !== drop) continue
      const hgt = (y - PIV_Y) * spreadNow
      const bU = cU + hgt * uU
      const bV = cV + hgt * uV
      const bW = cW + hgt * uW
      const A = sliceA[y]
      const B = sliceB[y]
      const C = sliceC[y]
      const T = sliceT[y]
      for (let v = 0; v < cnt; v++) {
        const a = A[v]
        const b = B[v]
        const V = bV + a * rV + b * fV
        const den = 1 + q * V
        if (den < 0.2) continue
        const m = S / den
        const col = a < 0 ? palL[C[v]] : palR[C[v]]
        const px = vCx + m * (bU + a * rU + b * fU)
        const py = vCy - m * (bW + a * rW + b * fW + tn * V) + drop
        const k = m / m0
        let x = 0
        let yy = 0
        for (let o = 0; o < nOff; o++) {
          x = Math.round(px + offX[o] * k)
          yy = Math.round(py + offY[o] * k)
          if (x < 0 || yy < 0 || x >= W || yy >= H) continue
          const at = yy * W + x
          if (_zb[at] < V - 1) continue // a hill or a cloud is in front
          if (fading && _mk[at] === 0) _bg[at] = _fb[at]
          _fb[at] = col
          _mk[at] = 1
        }
        if (T[v] === 1 && fills > 0) {
          for (let fi = 1; fi <= fills; fi++) {
            const fu = fi / (fills + 1)
            for (let o = 0; o < nOff; o++) {
              const xf = Math.round(px + (offX[o] + fu * pux) * k)
              const yf = Math.round(py + (offY[o] + fu * puy) * k)
              if (xf < 0 || yf < 0 || xf >= W || yf >= H) continue
              const at = yf * W + xf
              if (_zb[at] < V - 1 || _mk[at] === 1) continue
              if (fading && _mk[at] === 0) _bg[at] = _fb[at]
              _fb[at] = col
              _mk[at] = 1
            }
          }
        }
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (yy < y0) y0 = yy
        if (yy > y1) y1 = yy
      }
    }
    prop()
    x0 = Math.max(1, x0 - 4)
    y0 = Math.max(1, y0 - 4)
    x1 = Math.min(W - 2, x1 + 4)
    y1 = Math.min(H - 2, y1 + 4)
    // fading into the cockpit: let what was behind show through
    for (let yy = y0; yy <= y1 && fading; yy++) {
      let o = yy * W + x0
      for (let x = x0; x <= x1; x++, o++) {
        {
          if (_mk[o] !== 0) {
            const bg = _bg[o]
            const fg = _fb[o]
            const k = (fade * 256) | 0
            const r = ((bg & 255) * (256 - k) + (fg & 255) * k) >> 8
            const g = (((bg >> 8) & 255) * (256 - k) + ((fg >> 8) & 255) * k) >> 8
            const b = (((bg >> 16) & 255) * (256 - k) + ((fg >> 16) & 255) * k) >> 8
            _fb[o] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
          }
        }
      }
    }
    for (let yy = y0 - 1; yy <= y1 + 1; yy++) _mk.fill(0, yy * W + x0 - 1, yy * W + x1 + 2)
  }

  // ── the cockpit view
  //
  // The world is drawn on a larger square sheet and then turned, so the horizon tilts as the
  // jet banks. On top of that come the head-up display, the canopy frame and the instruments.

  /** turn the square sheet by the camera's roll into the frame */
  function turnSheet() {
    const c = Math.cos(vRoll)
    const s = Math.sin(vRoll)
    const half = sheetSide >> 1
    const cx = W >> 1
    const _fb = fb
    const _sh = sheet
    const side = sheetSide
    for (let y = 0; y < H; y++) {
      const dy = y - pivotY
      let sx = half - c * cx - s * dy + 0.5
      let sy = half - s * cx + c * dy + 0.5
      let o = y * W
      for (let x = 0; x < W; x++, o++, sx += c, sy += s) _fb[o] = _sh[(sy | 0) * side + (sx | 0)]
    }
  }

  // the cockpit's fixed metalwork is painted once per size and colour scheme
  function cockpitArt() {
    if (!cockpit || cockpit.W !== W || cockpit.H !== H) {
      const body = []
      const hot = []
      const metal = []
      for (let t = 0; t < 9; t++) body.push(jetPalDay[1 + t])
      for (let t = 0; t < 6; t++) hot.push(jetPalDay[17 + t])
      for (let t = 0; t < 6; t++) metal.push(jetPalDay[33 + t])
      cockpit = buildCockpit(W, H, { body, hot, metal, leather: [jetPalDay[50], jetPalDay[51]], pit: jetPalDay[52], wood: jetPalDay[56] })
    }
    return cockpit
  }
  function drawCockpitView() {
    const lead = jets[0]
    // the wings, the nose and the panel slide into place over the later part of the move
    const inPlace = cockpitIn()
    if (inPlace <= 0) return
    const sn = Math.sin(lead.yaw)
    const cs = Math.cos(lead.yaw)
    // where the sun is from the seat: to one side or the other, ahead or behind
    const sl = Math.sqrt(sunX * sunX + sunY * sunY) || 1
    const sunFront = (-sunX * sn + sunY * cs) / sl
    const sunSide = (-sunX * cs - sunY * sn) / sl
    drawCockpit(fb, cockpitArt(), {
      time,
      inPlace,
      roll: vRoll,
      heading: lead.yaw,
      prop: lead.propAngle,
      speed: speedNow,
      speedMax: p.speed * clamp(p.boost, 1, 4) * 1.08,
      alt: lead.z,
      altMax: Math.max(p.altitude, clamp(p.ceiling, 20, 900)),
      climb: clamp(climbTilt / 0.5, -1, 1),
      turn: clamp(lead.yawRate / Math.max(0.1, p.agility), -1, 1),
      boost,
      // the head sways with the flying, bumps with the air, and shudders with the throttle open
      headX,
      headY: headY - lead.joltZ * 4 + (boost > 0.2 ? ((((time * 30) | 0) & 1) - 0.5) * 1.5 * boost : 0),
      // light pours over the pilot's shoulder with the sun behind; the wing shades it with the sun ahead
      sunSide,
      sunReach: 0.72 - 0.28 * sunFront,
      sunColor: cockpitSun,
      sunPower: cockpitPower,
      tint: cockpitTint,
    })
  }

  function render() {
    if (W === 0) return bytes
    if (onFoot && indoors) {
      flameOut.count = 0
      room.render(fb, W, H, lampK)
      return bytes
    }
    updateView()
    frameH = H
    flameOut.count = 0
    // in the cockpit the view rolls with the jet, so the world goes onto the square sheet first
    const rolled = vK > 0 || vRoll !== 0
    const w0 = W
    const h0 = H
    const f0 = fb
    const c0 = colY
    const m0 = jetMask
    const z0 = zbuf
    const b0 = backdrop
    const y0 = vCy
    if (rolled) {
      W = sheetSide
      H = sheetSide
      fb = sheet
      colY = sheetColY
      jetMask = sheetMask
      zbuf = sheetZ
      backdrop = sheetBackdrop
      const half = sheetSide >> 1
      vCx = half
      vCy = half + (y0 - pivotY)
      // only the part of the sheet the turned frame can see is drawn
      const c = Math.abs(Math.cos(vRoll))
      const s = Math.abs(Math.sin(vRoll))
      colLo = Math.max(0, half - Math.ceil(c * (w0 / 2) + s * Math.max(pivotY, h0 - pivotY)) - 2)
      colHi = Math.min(sheetSide, half + Math.ceil(c * (w0 / 2) + s * Math.max(pivotY, h0 - pivotY)) + 2)
      rowLo = Math.max(0, half - Math.ceil(c * pivotY + s * (w0 / 2)) - 2)
      rowHi = Math.min(sheetSide, half + Math.ceil(c * (h0 - pivotY) + s * (w0 / 2)) + 2)
    } else {
      colLo = 0
      colHi = W
      rowLo = 0
      rowHi = H
    }
    drawGround()
    drawSky()
    drawMonuments()
    drawTrails()
    drawSmoke()
    drawBombs()
    drawSeaLife()
    drawGardens()
    drawBoats()
    drawBirds()
    drawWalker()
    // far jets first
    const order = jets.map((j, i) => ({ i, d: (j.x - cam.x) * vSin + (j.y - cam.y) * vCos }))
    order.sort((a, b) => a.d - b.d)
    for (const e of order) drawJet(jets[e.i], e.i)
    drawBooms()
    if (rolled) {
      W = w0
      H = h0
      fb = f0
      colY = c0
      jetMask = m0
      zbuf = z0
      backdrop = b0
      vCx = W >> 1
      vCy = y0
      turnSheet()
      // the smooth flames were placed on the sheet: turn them with it
      const half = sheetSide >> 1
      const rc = Math.cos(vRoll)
      const rs = Math.sin(vRoll)
      for (let i = 0; i < flameOut.count; i++) {
        for (let n = 0; n < 3; n++) {
          const o = i * FLAME_F + n * 2
          const dx = flameData[o] - half
          const dy = flameData[o + 1] - half
          flameData[o] = (W >> 1) + rc * dx + rs * dy
          flameData[o + 1] = pivotY - rs * dx + rc * dy
        }
      }
      drawCockpitView()
    }
    return bytes
  }

  return {
    setParams,
    resize,
    /** draw the ground and clouds with this GPU drawer (gpu-world.ts), or null for the CPU */
    setGpu(g) {
      gpu = g
    },
    /** debugging: the next frame draws the ground both ways; groundDiff then has the count */
    compareGround() {
      compareNext = true
    },
    get groundDiff() { return groundDiff },
    /** where the ground is drawn and its average time per frame, in ms */
    get groundStats() { return { on: gpu && gpu.ok ? 'gpu' : 'cpu', ms: Math.round(groundMs * 100) / 100, steps: WF.n, gpu: gpu?.timing } },
    pointerMove,
    pointerLeave,
    press,
    release,
    replayIntro,
    toggleView,
    setKeys,
    setBomb,
    dropBomb,
    toggleFoot,
    toggleFootView,
    setWalk,
    board,
    sailToggle,
    setAim,
    /** N: towards night, or back towards day (from wherever the light is now) */
    toggleNight() {
      dayGoal = dayGoal > 0.5 ? 0 : 1
      NIGHT_LOG.info(dayGoal > 0.5 ? 'dusk' : 'dawn', { phase: Math.round(phase * 100) / 100 })
    },
    /** debugging: jump the light to where the change from day (0) to night (1) is s along */
    setLight(s) {
      dayLin = dayGoal = clamp(s, 0, 1)
      setPhase(easeDay(dayLin))
      rebuildPalettes(false)
    },
    /** heading for night (or there) */
    get night() { return dayGoal > 0.5 },
    get phase() { return phase },
    step,
    render,
    get width() { return W },
    get height() { return H },
    /** the smooth flames to lay over this frame (none while the flames are drawn in pixels) */
    get flames() { return flameOut },
    /** the view the camera is in, or heading for */
    get view() { return viewTarget === 2 ? 'cockpit' : viewTarget === 1 ? 'chase' : 'top' },
    get onFoot() { return onFoot },
    /** walking the gallery inside the museum */
    get indoors() { return onFoot && indoors },
    get aboard() { return aboard >= 0 },
    get footView() { return footView === 1 ? 'first' : 'above' },
    /** the boat you are in is under way */
    get sailing() { return aboard >= 0 && sailing },
    /** whether E would do something now: on foot, a boat within reach; aboard, a shore within reach */
    get canBoard() {
      if (!onFoot || indoors) return false
      if (aboard >= 0) {
        const b = boats[aboard]
        return !!b && !!nearestStand(b.x, b.y, 28)
      }
      for (const b of boats) if (wrapDelta(b.x, walker.x) ** 2 + wrapDelta(b.y, walker.y) ** 2 < 48 * 48) return true
      return false
    },
  }
}

 
