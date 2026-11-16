// The plane: a 1920s two-seat training biplane. Blue fuselage, chrome-yellow wings and tail, a bare
// radial engine with its cylinders showing, a wooden propeller, a striped rudder, and the pilot in a
// leather helmet in the open rear seat. Built here in code as a sprite stack: JET_H horizontal
// slices of JET_W × JET_L voxels. Slice 0 is the bottom of the wheels, the top slice the fin tip.
// Row 0 is the nose; columns run left wing → right wing. Each voxel is a palette index, 0 empty.
// (The names keep "jet" so the renderer and the rest of the game did not have to change.)
//
// The propeller is not in the stack: the renderer spins it in front of the nose (PROP_*).

export const JET_W = 44
export const JET_L = 34
export const JET_H = 14

/** the pivot the plane turns about, in voxels: between the wings, at the fuselage's middle */
export const JET_PIVOT_K = 12.5
export const JET_PIVOT_Y = 5
/** where the smoke comes out: under the tail */
export const JET_SMOKE_A = 0
export const JET_SMOKE_K = 31
export const JET_SMOKE_Y = 4
/** the propeller: its disc stands across the nose */
export const JET_PROP_K = -0.6
export const JET_PROP_Y = 5
export const JET_PROP_R = 5.4
/** upper wing tips, where the trails start */
export const JET_WINGTIP_A = 21
export const JET_WINGTIP_K = 11
export const JET_WINGTIP_Y = 10

/**
 * [index, r, g, b, family] — family 0 the fuselage (recoloured by bodyColor from tone 5),
 * 1 wings and tail (accentColor, from tone 20), 2 metal (canopyColor, from tone 36), 3 fixed.
 * Within families 0–2, neighbouring indices are one shade apart (lit and shaded halves use them).
 */
export const JET_PALETTE = [
  [1, 12, 18, 38, 0],
  [2, 20, 32, 66, 0],
  [3, 28, 48, 98, 0],
  [4, 38, 64, 130, 0],
  [5, 50, 84, 160, 0],
  [6, 70, 108, 186, 0],
  [7, 98, 136, 208, 0],
  [8, 140, 172, 226, 0],
  [9, 196, 214, 242, 0],
  [17, 132, 82, 10, 1],
  [18, 186, 122, 12, 1],
  [19, 224, 160, 18, 1],
  [20, 246, 192, 34, 1],
  [21, 252, 216, 86, 1],
  [22, 255, 238, 156, 1],
  [33, 38, 40, 46, 2],
  [34, 72, 76, 86, 2],
  [35, 112, 118, 128, 2],
  [36, 156, 162, 172, 2],
  [37, 200, 206, 214, 2],
  [38, 238, 242, 246, 2],
  [49, 28, 26, 28, 3], // tyre
  [50, 104, 60, 32, 3], // leather
  [51, 146, 90, 48, 3], // leather, lit
  [52, 22, 18, 16, 3], // inside the cockpit
  [53, 200, 42, 38, 3], // rudder red
  [54, 240, 238, 230, 3], // white: rudder stripes, the scarf
  [55, 150, 206, 224, 3], // goggles
  [56, 120, 74, 38, 3], // propeller wood
  [57, 226, 178, 132, 3], // face
]

// palette shortcuts
const BODY = (t) => clampT(t, 1, 9)
const WING = (t) => clampT(t, 17, 22)
const METAL = (t) => clampT(t, 33, 38)
const TYRE = 49
const LEATHER = 50
const LEATHER_LIT = 51
const PIT = 52
const RED = 53
const WHITE = 54
const GOGGLES = 55
const FACE = 57
function clampT(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : Math.round(v)
}

/** Builds the JET_H slices, each a Uint8Array(JET_W * JET_L) of palette indices (row = nose → tail). */
export function decodeJet() {
  const slices = []
  for (let y = 0; y < JET_H; y++) slices.push(new Uint8Array(JET_W * JET_L))
  const mid = (JET_W - 1) / 2
  const A = (i) => i - mid // across: negative is the left wing
  const set = (i, k, y, v) => {
    if (i < 0 || k < 0 || y < 0 || i >= JET_W || k >= JET_L || y >= JET_H) return
    slices[y][k * JET_W + i] = v
  }
  const get = (i, k, y) => slices[y][k * JET_W + i]

  // ── wings: one slice thick, rounded at the tips, ribs showing through the fabric
  const wing = (y, k0, k1, half, notch) => {
    for (let i = 0; i < JET_W; i++) {
      const a = Math.abs(A(i))
      if (a > half) continue
      const tip = half - a // 0 at the very tip
      for (let k = k0; k <= k1; k++) {
        // round the tips: the corners go first
        const fromEdge = Math.min(k - k0, k1 - k)
        if (tip < 0.6 && fromEdge < 2) continue
        if (tip < 1.6 && fromEdge < 1) continue
        if (notch && k === k1 && a < 3) continue // cut-out over the cockpit
        let t = 20
        if (k === k0) t = 21 // leading edge catches the light
        else if (k === k1) t = 19
        if (a > 11.5 && k >= k1 - 1) t = 19 // aileron
        if (Math.abs(a - 11.5) < 0.6 && k >= k1 - 1) t = 18 // its hinge gap
        if (Math.round(a + 0.5) % 4 === 0 && k > k0 && k < k1) t -= 1 // a rib
        if (tip < 1) t = 19
        set(i, k, y, WING(t))
      }
    }
  }
  wing(3, 9, 15, 20.5, false) // lower
  wing(10, 7, 13, 21.5, true) // upper, staggered forward

  // ── fuselage: wide behind the engine, tapering to the tail, its belly rising aft
  const halfW = (k) => (k <= 16 ? 3 : 3 - ((k - 16) / 17) * 2)
  const bottomAt = (k) => (k <= 14 ? 3 : 3 + ((k - 14) / 19) * 2.2)
  const topAt = (k) => (k >= 19 && k <= 25 ? 8 : 7)
  for (let k = 3; k < JET_L; k++) {
    const hw = halfW(k)
    const lo = Math.round(bottomAt(k))
    const hi = topAt(k)
    for (let i = 0; i < JET_W; i++) {
      const a = Math.abs(A(i))
      if (a >= hw) continue
      const edge = a > hw - 1
      for (let y = lo; y <= hi; y++) {
        // the turtle deck behind the pilot is narrower than the fuselage under it
        if (y === 8 && a > 1.5) continue
        if (edge && hw >= 2.5 && (y === lo || (y === hi && y === 7))) continue // rounded corners
        let t
        if (y === hi) t = a < 1.5 ? 7 : 6
        else t = 2 + ((y - lo) / Math.max(1, hi - lo)) * 4
        if (y === 6 && edge && k >= 4 && k <= 29) t = -1 // the yellow cheat line down each side
        set(i, k, y, t < 0 ? WING(21) : BODY(t))
      }
    }
  }

  // ── open cockpits with leather rims: the front one under the wing, the pilot's behind it
  const cockpitAt = (k0, k1) => {
    for (let k = k0 - 1; k <= k1 + 1; k++) {
      for (let i = 0; i < JET_W; i++) {
        const a = Math.abs(A(i))
        if (a > 2.5) continue
        const rim = k === k0 - 1 || k === k1 + 1 || a > 1.5
        set(i, k, 7, rim ? (k === k0 - 1 ? LEATHER_LIT : LEATHER) : PIT)
      }
    }
  }
  cockpitAt(11, 12)
  cockpitAt(16, 18)
  // windscreens
  for (const k of [10, 15]) for (let i = 0; i < JET_W; i++) if (Math.abs(A(i)) < 1.5) set(i, k, 8, METAL(38))
  // the pilot: leather helmet, goggles, face, and a white scarf blowing back over the deck
  for (let i = 0; i < JET_W; i++) {
    const a = A(i)
    if (Math.abs(a) > 1) continue
    set(i, 17, 8, LEATHER)
    set(i, 17, 9, LEATHER_LIT)
    set(i, 16, 9, GOGGLES)
    set(i, 16, 8, FACE)
    set(i, 18, 9, LEATHER)
  }
  set(Math.round(mid + 1.5), 19, 8, WHITE)
  set(Math.round(mid + 1.5), 20, 8, WHITE)
  set(Math.round(mid + 2.5), 21, 8, WHITE)

  // ── struts: the cabane pairs over the front cockpit, an interplane pair out on each wing
  for (const s of [-1, 1]) {
    for (const k of [9, 12]) {
      const i = Math.round(mid + s * 2.5)
      set(i, k, 8, METAL(35))
      set(i, k, 9, METAL(36))
    }
    for (const k of [10, 13]) {
      const i = Math.round(mid + s * 15.5)
      for (let y = 4; y <= 9; y++) set(i, k, y, METAL(y > 6 ? 36 : 35))
    }
  }

  // ── landing gear: splayed legs and two fat tyres, a skid under the tail
  for (const s of [-1, 1]) {
    const leg = Math.round(mid + s * 4)
    set(leg, 11, 2, METAL(34))
    set(leg, 11, 1, METAL(34))
    for (const di of [0, 1]) {
      const i = Math.round(mid + s * (4.5 + di))
      for (let k = 10; k <= 12; k++) {
        set(i, k, 0, TYRE)
        set(i, k, 1, k === 11 && di === 1 ? METAL(37) : TYRE)
      }
    }
  }
  for (let i = 0; i < JET_W; i++) if (Math.abs(A(i)) < 1) set(i, 32, 4, TYRE)

  // ── tail: a yellow stabiliser across the rear fuselage, the fin, and a striped rudder
  for (let k = 27; k <= 32; k++) {
    for (let i = 0; i < JET_W; i++) {
      const a = Math.abs(A(i))
      const span = k === 27 ? 4.5 : k === 28 ? 7 : 8.5
      if (a > span || (k === 32 && a > 7.5)) continue
      if (get(i, k, 6) !== 0 && a < 1.5) continue // the fuselage runs through it
      let t = k === 27 ? 21 : k >= 31 ? 19 : 20
      if (k === 30 && a > 1.5) t = 18 // elevator hinge
      set(i, k, 6, WING(t))
    }
  }
  const finFrom = [26, 27, 28, 29, 30] // first row of the fin, per slice above the fuselage
  for (let y = 8; y <= 12; y++) {
    for (let k = finFrom[y - 8]; k < JET_L; k++) {
      if (y === 12 && k > 32) continue
      for (let i = 0; i < JET_W; i++) {
        if (A(i) !== -0.5) continue // one voxel thick, just left of the middle
        let v
        if (k < 31) v = WING(k === finFrom[y - 8] ? 21 : 20)
        else if (k === 31) v = BODY(5) // the blue band at the hinge
        else v = y % 2 === 0 ? RED : WHITE
        set(i, k, y, v)
      }
    }
  }
  // the rudder runs down the back of the fuselage too
  for (let y = 5; y <= 7; y++) {
    for (let i = 0; i < JET_W; i++) {
      if (A(i) === -0.5) set(i, 33, y, y % 2 === 0 ? RED : WHITE)
      else if (A(i) === 0.5) set(i, 33, y, 0)
    }
  }

  // ── the engine: a bare radial, nine cylinders round a crankcase, a ring behind them
  const ec = JET_PROP_Y
  for (let i = 0; i < JET_W; i++) {
    const a = A(i)
    for (let y = 0; y < JET_H; y++) {
      const dy = y - ec
      const r = Math.sqrt(a * a + dy * dy)
      const ang = Math.atan2(dy, a)
      // cylinders
      let cyl = false
      for (let n = 0; n < 9; n++) {
        let d = ang - (Math.PI / 2 + (n * 2 * Math.PI) / 9)
        d -= Math.PI * 2 * Math.round(d / (Math.PI * 2))
        if (Math.abs(d) < 0.3) cyl = true
      }
      if (r < 1.7) set(i, 1, y, METAL(r < 0.8 ? 37 : 34)) // crankcase nose
      if (r < 1.9) set(i, 2, y, METAL(33))
      else if (cyl && r < 3.6) set(i, 2, y, METAL(r > 2.9 ? 37 : r > 2.4 ? 35 : 36)) // finned barrel, bright head
      if (r < 3.2 && r >= 2.2) set(i, 3, y, METAL(r > 2.8 ? 34 : 33)) // exhaust ring
    }
  }
  return slices
}
