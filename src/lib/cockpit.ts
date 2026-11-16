// The open cockpit of the biplane, from the pilot's rear seat. It is painted once (per size and
// colour scheme) as three layers at different distances from the pilot's eyes:
//
//   the nose  ·  the wings, struts and wires  ·  windscreen, leather coaming and instrument panel
//
// Each frame the layers are laid over the view, shifted by different amounts as the pilot's head
// sways with the flying (near things move most), with sunlight falling across them from wherever
// the sun is. The live parts are drawn in between: the propeller spinning in front of the nose,
// the glass of the windscreen, the needles of the gauges, the throttle and the stick.
//
// Colours are 0xAABBGGRR. Sizes are in "design pixels": one at a frame 300 px tall. The horizon
// in level flight is at design row 102 (the scene rolls the world about that row).

const rgb = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const BRASS = [rgb(110, 78, 26), rgb(196, 150, 56), rgb(250, 218, 124)]
const FACE = rgb(18, 18, 20)
const DIAL = rgb(232, 226, 204)
const NEEDLE = rgb(246, 240, 214)
const WHITE = rgb(255, 255, 255)
const BLACK = rgb(0, 0, 0)
const GLASS = rgb(196, 228, 246)

// how much each layer shifts as the head moves: the nearer it is, the more
const NEAR = { prop: 0.12, nose: 0.22, wing: 0.3, near: 0.9, lever: 1.05, stick: 1.3 }
const HORIZON = 102

function hash(n) {
  let h = Math.imul(n ^ (n >>> 13), 0x5bd1e995)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  return (h >>> 24) & 255
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

function mix(bg, fg, k) {
  const r = ((bg & 255) * (256 - k) + (fg & 255) * k) >> 8
  const g = (((bg >> 8) & 255) * (256 - k) + ((fg >> 8) & 255) * k) >> 8
  const b = (((bg >> 16) & 255) * (256 - k) + ((fg >> 16) & 255) * k) >> 8
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
}

/** a small drawing surface over a pixel buffer; (ox, oy) moves everything drawn on it */
class Sheet {
  buf
  W
  H
  ox = 0
  oy = 0
  constructor(buf, W, H) {
    this.buf = buf
    this.W = W
    this.H = H
  }
  put(x, y, col) {
    x += this.ox
    y += this.oy
    if (x >= 0 && y >= 0 && x < this.W && y < this.H) this.buf[y * this.W + x] = col
  }
  /** blend a colour over what is there (k of 256) */
  tint(x, y, col, k) {
    x += this.ox
    y += this.oy
    if (x >= 0 && y >= 0 && x < this.W && y < this.H) {
      const o = y * this.W + x
      this.buf[o] = mix(this.buf[o], col, k)
    }
  }
  get(x, y) {
    x += this.ox
    y += this.oy
    return x >= 0 && y >= 0 && x < this.W && y < this.H ? this.buf[y * this.W + x] : 0
  }
  line(xa, ya, xb, yb, col) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(xb - xa), Math.abs(yb - ya))))
    for (let i = 0; i <= n; i++) this.put(Math.round(xa + ((xb - xa) * i) / n), Math.round(ya + ((yb - ya) * i) / n), col)
  }
  disc(cx, cy, r, col) {
    const ri = Math.ceil(r)
    for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) if (dx * dx + dy * dy <= r * r) this.put(cx + dx, cy + dy, col)
  }
}

/** distance from (u, v) to the segment a → b, signed across it, and how far along it is (0..1) */
function seg(u, v, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = ((u - ax) * dx + (v - ay) * dy) / l2
  const l = Math.sqrt(l2)
  return { t, d: ((u - ax) * dy - (v - ay) * dx) / l }
}

/** paints the fixed parts of the cockpit for a frame of W × H */
export function buildCockpit(W, H, pal) {
  const s = H / 300
  const cx = W >> 1
  const pad = Math.ceil(14 * s) + 3
  const aw = W + pad * 2
  const ah = H + pad * 2
  const B = pal.body // fuselage blue, dark → light
  const A = pal.hot // wing yellow, dark → light
  const M = pal.metal // struts and engine, dark → light
  const LTH = pal.leather // [shade, lit]
  const PIT = pal.pit
  const hw = W / 2 / s // half the frame's width, in design px
  const layer = () => {
    const buf = new Uint32Array(aw * ah)
    const sh = new Sheet(buf, aw, ah)
    sh.ox = pad
    sh.oy = pad
    return sh
  }
  const nv = layer()
  const wv = layer()
  const pv = layer()
  // paint a layer: fn(u, v, n) gives the colour at design (u across from the middle, v down), or 0
  const paint = (sh, fn) => {
    for (let y = -pad; y < H + pad; y++) {
      const v = y / s
      for (let x = -pad; x < W + pad; x++) {
        const c = fn((x - cx) / s, v, hash(x * 73 + y * 1031))
        if (c) sh.put(x, y, c)
      }
    }
  }
  // a strut: a round bar, lit down one edge, outlined
  const strut = (u, v, ax, ay, bx, by, w) => {
    const q = seg(u, v, ax, ay, bx, by)
    if (q.t < 0 || q.t > 1) return 0
    const half = w / 2
    const d = q.d
    if (Math.abs(d) > half + 0.9) return 0
    if (Math.abs(d) > half) return M[0]
    const f = d / half
    return f < -0.5 ? M[4] : f < -0.1 ? M[3] : f < 0.5 ? M[2] : M[1]
  }
  const wire = (u, v, ax, ay, bx, by) => {
    const q = seg(u, v, ax, ay, bx, by)
    return q.t >= 0 && q.t <= 1 && Math.abs(q.d) < 0.55 / s + 0.15 ? B[1] : 0
  }

  // ── the nose: the fuselage running forward to the engine, the front cockpit open in it,
  // and the tops of the engine's cylinders standing over its far end
  const deckTop = (du) => (du < 52 ? 126 + (du / 52) * (du / 52) * 24 : 150 + (du - 52) * 2.2)
  const ENGINE_V = 152
  paint(nv, (u, v, n) => {
    const du = Math.abs(u)
    const top = deckTop(du)
    if (v >= top) {
      // the front cockpit: a dark hole with a leather rim
      const e = (u / 40) * (u / 40) + ((v - 172) / 12) * ((v - 172) / 12)
      if (e < 1) return v < 166 ? LTH[0] : PIT
      if (e < 1.5) return v < 172 ? LTH[1] : LTH[0]
      // its little windscreen
      if (v >= 150 && v < 159 && du < 30 - (159 - v) * 0.5) return v < 152 ? WHITE : mix(B[6], GLASS, 150)
      if (v - top < 1.4) return B[7] // the curve of the deck catches the sky
      let c = du < 11 ? B[6] : du < 34 ? B[5] : du < 56 ? B[4] : B[3]
      // fabric over stringers, and a little wear
      if (du > 14 && Math.abs(((du + 6) % 18) - 9) < 0.5) c = du < 38 ? B[4] : B[3]
      if (n > 250) c = B[2]
      return c
    }
    // cylinders: three of the nine stand up past the deck, finned barrels with bright heads
    for (const ang of [0, -0.72, 0.72]) {
      const ax = Math.sin(ang)
      const ay = -Math.cos(ang)
      const t = u * ax + (v - ENGINE_V) * ay // along the cylinder, out from the engine's middle
      const p = u * -ay + (v - ENGINE_V) * ax // across it
      const r = ang === 0 ? 50 : 44
      if (t < 20 || t > r || Math.abs(p) > 8) continue
      if (t > r - 7) return Math.abs(p) > 6.5 ? M[1] : p < -2 ? M[5] : M[4] // rocker box
      if (Math.abs(p) > 7) return M[0]
      const fin = Math.floor(t * 0.75) % 2 === 0
      return p < -3 ? (fin ? M[4] : M[2]) : p > 3 ? (fin ? M[2] : M[0]) : fin ? M[3] : M[1]
    }
    return 0
  })

  // ── the wings, with their struts and wires
  const LE_UP = 56 // the upper wing's leading edge
  const LE_LO = 226 // the lower wing's leading edge, low in the corners
  const fuselageEdge = (v) => 52 + Math.max(0, v - 150) / 2.2
  // interplane struts: a front and a rear one on each side, out near the tips
  const outer = (side) => [
    [side * hw * 0.8, LE_UP - 2, side * hw * 0.78, LE_LO + 8, 7],
    [side * hw * 0.93, LE_UP - 4, side * hw * 0.93, LE_LO + 30, 9],
  ]
  // cabane struts: from the deck up to the middle of the upper wing
  const cabane = (side) => [
    [side * 40, LE_UP - 2, side * 26, 132, 5],
    [side * 55, LE_UP - 2, side * 41, 150, 6],
  ]
  paint(wv, (u, v, n) => {
    const du = Math.abs(u)
    const side = u < 0 ? -1 : 1
    for (const st of [...cabane(side), ...outer(side)]) {
      if (v < LE_UP - 3) break
      const c = strut(u, v, st[0], st[1], st[2], st[3], st[4])
      if (c) return c
    }
    // flying wires between the wings, crossed
    if (v > LE_UP && v < LE_LO + 30) {
      const w1 = wire(u, v, side * hw * 0.8, LE_UP, side * 112, LE_LO + 4)
      if (w1) return w1
      const w2 = wire(u, v, side * 48, LE_UP, side * hw * 0.78, LE_LO + 8)
      if (w2) return w2
      const w3 = wire(u, v, side * hw * 0.93, LE_UP, side * 126, LE_LO + 12)
      if (w3) return w3
    }
    if (v < LE_UP) {
      // the upper wing's underside, in its own shade, with a cut-out over the cockpit
      const e = (u / 50) * (u / 50) + ((v + 8) / 34) * ((v + 8) / 34)
      if (e < 1) return 0
      if (e < 1.14) return A[1]
      if (v >= LE_UP - 1.5) return A[0] // the edge, against the sky
      if (v >= LE_UP - 5) return A[3] // the rounded nose of the wing
      // ribs under the fabric, running back towards you from the leading edge
      const xr = (u * (HORIZON - LE_UP)) / (HORIZON - v)
      const f = Math.abs(xr - Math.round(xr / 30) * 30)
      if (f < 0.75) return A[1]
      if (f < 1.6) return A[3]
      return n > 246 ? A[1] : A[2]
    }
    if (v >= LE_LO - 1 && du > fuselageEdge(v) + 1) {
      // the lower wing's top, in the sun, ribs fanning out towards you
      if (v < LE_LO) return A[0]
      if (v < LE_LO + 2.5) return A[5]
      const xr = (u * (LE_LO - HORIZON)) / (v - HORIZON)
      const f = Math.abs(xr - Math.round(xr / 30) * 30)
      if (f < 0.7) return A[2]
      if (f < 1.4) return A[5]
      return n > 248 ? A[3] : A[4]
    }
    return 0
  })

  // ── near: the windscreen's frame, the leather coaming round the cockpit, the panel under it
  const coam = (u) => 216 + (u / 120) * (u / 120) * 52
  const screenHalf = (v) => 52 + ((v - 178) / 38) * 12
  // a plain black panel, as in the trainers of the day: the compass in a window at the top,
  // airspeed and height either side, the engine's revolutions in the middle, oil and fuel below
  const dials = [
    { x: 0, y: 240, r: 9, kind: 'compass' },
    { x: -62, y: 259, r: 16, kind: 'speed' },
    { x: 0, y: 264, r: 14, kind: 'rpm' },
    { x: 62, y: 259, r: 16, kind: 'alt' },
    { x: -104, y: 285, r: 9, kind: 'oil' },
    { x: 104, y: 285, r: 9, kind: 'fuel' },
  ]
  paint(pv, (u, v, n) => {
    const du = Math.abs(u)
    const yc = coam(u)
    // windscreen frame: a thin bent rim on three sides
    if (v >= 178 && v < yc) {
      const h = screenHalf(v)
      const round = v < 182 ? (182 - v) * 1.2 : 0
      if (du <= h - round && du > h - 2.6 - round) return du > h - 1.2 - round ? M[1] : M[4]
      if (v < 180.6 && du < h - round) return v < 179.3 ? M[4] : M[2]
    }
    // the fuselage's top beside the cockpit
    if (v < yc && v >= yc - 11 && du > 76) return v < yc - 10 ? B[7] : v < yc - 8 ? B[6] : B[5]
    if (v < yc) return 0
    // the coaming: a padded leather roll, stitched
    if (v < yc + 13) {
      const t = v - yc
      if (t < 1.4) return LTH[1]
      if (t < 4) return Math.abs(((u + 300) % 7) - 3.5) < 0.6 && t > 2 ? BRASS[2] : LTH[1]
      if (t > 11.8) return PIT
      return n > 240 ? LTH[1] : LTH[0]
    }
    // the side walls below it
    if (du > 120) {
      const tube = Math.abs(((u * 0.55 + v) % 46) - 23) < 2.2
      return tube ? (((u * 0.55 + v) % 46) - 23 < 0 ? M[3] : M[1]) : n > 248 ? LTH[0] : PIT
    }
    // the panel: black, with its dials sunk in brass rims
    for (const d of dials) {
      const dx = u - d.x
      const dy = v - d.y
      if (d.kind === 'compass') {
        const ax = Math.abs(dx)
        const ay = Math.abs(dy)
        if (ax > d.r * 1.5 + 2 || ay > d.r * 0.6 + 2) continue
        if (ax > d.r * 1.5 || ay > d.r * 0.6) return dy < 0 || dx < 0 ? BRASS[2] : BRASS[0]
        return dy < -d.r * 0.2 ? rgb(40, 34, 28) : rgb(24, 20, 16)
      }
      const r = Math.sqrt(dx * dx + dy * dy)
      if (r > d.r + 2.2) continue
      if (r > d.r) return dx + dy < -1 ? BRASS[2] : dx + dy > 1 ? BRASS[0] : BRASS[1]
      // the face: marks round the scale, heavier every third
      const ang = Math.atan2(dy, dx)
      const deg = ((ang * 180) / Math.PI + 360 + 225) % 360 // 0 at the start of the scale
      if (deg <= 270 && r > d.r - 4) {
        const step = 27
        const off = deg % step
        if (off < 2.2 || off > step - 1) return Math.round(deg / step) % 3 === 0 || r > d.r - 2.4 ? DIAL : FACE
      }
      if (d.kind === 'rpm' && deg > 216 && deg <= 270 && r > d.r - 5.5 && r <= d.r - 4) return rgb(170, 40, 34) // red line
      return FACE
    }
    // throttle quadrant on the left, in the side wall
    if (u > -150 && u < -136 && v > 256 && v < 298) return u < -147 || u > -139 ? M[2] : rgb(10, 8, 8)
    // the panel board itself
    if (Math.abs(((u + 400) % 96) - 48) < 0.5 && v > yc + 20) return B[1] // a seam
    return n > 252 ? B[2] : rgb(22, 22, 26)
  })

  return {
    W, H, s, cx, pad, aw, ah,
    nose: nv.buf, wing: wv.buf, near: pv.buf,
    coamTop: Math.round(coam(0) * s),
    noseTop: Math.round(98 * s),
    dials, pal,
  }
}

/**
 * Lays a layer over the frame, shifted by (dx, dy + fy): fy is the part of a pixel left over
 * while the layer is sliding, so it glides instead of stepping. Where the sun reaches it, it
 * is lit: the light falls in a slanted band with broken edges.
 */
function lay(fb, art, src, dx, dy, fy, top, bottom, light) {
  const { W, H, aw, ah, pad } = art
  const w1 = fy > 0.004 ? Math.round(fy * 256) : 0 // how much of the row above shows in each row
  const y0 = Math.max(0, top + dy)
  const y1 = Math.min(H, bottom + dy + (w1 > 0 ? 1 : 0))
  for (let ty = y0; ty < y1; ty++) {
    const sy = ty - dy + pad
    if (sy < 0 || sy > ah || (sy === ah && w1 === 0)) continue
    let i = sy * aw + pad - dx
    let o = ty * W
    if (!light && w1 === 0) {
      for (let x = 0; x < W; x++, o++, i++) {
        const c = src[i]
        if (c !== 0) fb[o] = c
      }
      continue
    }
    const here = sy < ah
    const above = w1 > 0 && sy > 0
    let xa = 0
    let xb = 0
    if (light) {
      const mid = light.x + (ty - light.y0) * light.slope
      xa = mid - light.half
      xb = mid + light.half
    }
    for (let x = 0; x < W; x++, o++, i++) {
      let c = here ? src[i] : 0
      let cover = 256
      if (w1 > 0) {
        const up = above ? src[i - aw] : 0
        if (up !== c) {
          if (up === 0) cover = 256 - w1
          else if (c === 0) { c = up; cover = w1 }
          else c = mix(c, up, w1)
        }
      }
      if (c === 0) continue
      if (light && x >= xa && x < xb) {
        // ragged edges, so the light does not end in a ruled line
        const e = Math.min(x - xa, xb - x)
        if (e >= 4 || BAYER[((ty & 3) << 2) | (x & 3)] <= e * 4) c = mix(c, light.col, light.k)
      }
      fb[o] = cover === 256 ? c : mix(fb[o], c, cover)
    }
  }
}

/** lays the cockpit over the frame and draws its live parts */
export function drawCockpit(fb, art, live) {
  const { W, H, s, cx } = art
  const B = art.pal.body
  const A = art.pal.hot
  const M = art.pal.metal
  const R = (v) => Math.round(v * s)
  const a = clamp(live.inPlace, 0, 1)
  if (a <= 0) return
  const t = live.time

  // how far each layer is shifted: it slides in as the camera arrives, then sways with the head
  const hx = live.headX * s
  const hy = live.headY * s
  const away = 1 - a
  const off = (near, slide) => {
    const whole = Math.floor(slide)
    return {
      x: -clamp(Math.round(hx * near), -art.pad, art.pad),
      y: -clamp(Math.round(hy * near), -art.pad, art.pad) + whole,
      f: slide - whole,
    }
  }
  const oProp = off(NEAR.prop, away * H * 0.9)
  const oNose = off(NEAR.nose, away * H * 0.9)
  const oWing = off(NEAR.wing, -away * H * 0.7)
  const oNear = off(NEAR.near, away * (H - art.coamTop + 8) * 1.4)
  const oLever = off(NEAR.lever, away * (H - art.coamTop + 8) * 1.4)
  const oStick = off(NEAR.stick, away * (H - art.coamTop + 8) * 1.6)

  // sunlight: a slanted band that crosses the cockpit as the plane turns to and from the sun
  let light = null
  if (live.sunPower > 0.02 && live.sunReach > 0.02) {
    light = {
      x: cx - live.sunSide * R(176),
      slope: clamp(Math.tan(live.roll) * 0.9 - live.sunSide * 0.6, -2.4, 2.4),
      half: R(90),
      k: Math.round(52 * live.sunPower * live.sunReach),
      col: live.sunColor,
      y0: art.coamTop,
    }
  }
  const farLight = light ? { ...light, k: light.k >> 1 } : null

  // the propeller, out in front of the nose: a pale blur with the blades caught as they pass,
  // yellow at the tips, and a ghost of where they just were
  {
    const pcx = cx + oProp.x
    const pcy = R(152) + oProp.y
    const pr = R(112)
    const ang = live.prop
    const c0 = Math.cos(ang)
    const s0 = Math.sin(ang)
    const c1 = Math.cos(ang - 0.42)
    const s1 = Math.sin(ang - 0.42)
    const wood = art.pal.wood
    const y0 = Math.max(0, pcy - pr)
    const y1 = Math.min(H - 1, pcy + pr)
    for (let y = y0; y <= y1; y++) {
      const dy = y - pcy
      const span = Math.floor(Math.sqrt(Math.max(0, pr * pr - dy * dy)))
      const xa = Math.max(0, pcx - span)
      const xb = Math.min(W - 1, pcx + span)
      for (let x = xa; x <= xb; x++) {
        const dx = x - pcx
        const r = Math.sqrt(dx * dx + dy * dy) / pr
        const half = (3 + 5 * r) * s
        const o = y * W + x
        if (Math.abs(dx * -s0 + dy * c0) < half) fb[o] = mix(fb[o], r > 0.9 ? A[4] : wood, r > 0.9 ? 120 : 56)
        else if (Math.abs(dx * -s1 + dy * c1) < half * 1.3) fb[o] = mix(fb[o], r > 0.9 ? A[3] : wood, 22)
        else if (r > 0.95) fb[o] = mix(fb[o], A[4], 26) // the painted tips leave a ring
        else fb[o] = mix(fb[o], WHITE, 10)
      }
    }
  }

  lay(fb, art, art.nose, oNose.x, oNose.y, oNose.f, art.noseTop, H + art.pad, farLight)
  lay(fb, art, art.wing, oWing.x, oWing.y, oWing.f, -art.pad, H + art.pad, farLight)

  // the windscreen's glass: a faint tint and two slanting glints
  {
    const gx = oNear.x
    const gy = oNear.y
    for (let v = 181; v < 216; v++) {
      const y = R(v) + gy
      if (y < 0 || y >= H) continue
      const h = (52 + ((v - 178) / 38) * 12 - 2.6) * s
      const xa = Math.max(0, Math.round(cx + gx - h))
      const xb = Math.min(W - 1, Math.round(cx + gx + h))
      for (let x = xa; x <= xb; x++) {
        const o = y * W + x
        const d = (x - cx - gx) / s + (v - 181) * 0.8
        const glint = (d > -40 && d < -30) || (d > -24 && d < -21)
        fb[o] = mix(fb[o], glint ? WHITE : GLASS, glint ? 40 : 18)
      }
    }
  }

  lay(fb, art, art.near, oNear.x, oNear.y, oNear.f, art.coamTop - R(40), H + art.pad, light)

  // the gauges' needles: airspeed, engine revolutions, height, oil, and the compass card
  {
    const v = new Sheet(fb, W, H)
    v.ox = oNear.x
    v.oy = oNear.y
    const rpm = clamp(0.55 + 0.4 * live.boost + Math.sin(t * 23) * 0.006, 0, 1)
    for (const d of art.dials) {
      const x = cx + R(d.x)
      const y = R(d.y)
      const r = R(d.r)
      if (d.kind === 'compass') {
        // a card turning behind a lubber line
        const hd = live.heading
        const half = r * 1.5 - 1
        for (let k = -4; k <= 4; k++) {
          const a2 = Math.round(hd / (Math.PI / 8)) + k
          const off2 = (a2 * (Math.PI / 8) - hd) * r * 1.6
          const xx = Math.round(x + off2)
          if (Math.abs(off2) > half) continue
          v.line(xx, y - Math.round(r * 0.3), xx, y + (((a2 % 2) + 2) % 2 === 0 ? Math.round(r * 0.35) : 0), DIAL)
        }
        v.line(x, y - Math.round(r * 0.55), x, y + Math.round(r * 0.55), rgb(210, 56, 44))
        continue
      }
      let f = 0
      if (d.kind === 'speed') f = clamp(live.speed / Math.max(1, live.speedMax), 0, 1)
      else if (d.kind === 'rpm') f = rpm
      else if (d.kind === 'alt') f = clamp(live.alt / Math.max(1, live.altMax), 0, 1)
      else if (d.kind === 'fuel') f = 0.82 - ((t * 0.004) % 0.6) // only for show: it drains slowly, then is full again
      else f = 0.62 + 0.12 * live.boost + Math.sin(t * 0.4) * 0.02 // oil pressure
      const an = ((-225 + f * 270) * Math.PI) / 180
      const len = r - Math.max(2, R(3))
      v.line(x + 1, y + 1, x + 1 + Math.cos(an) * len, y + 1 + Math.sin(an) * len, BLACK)
      v.line(x, y, x + Math.cos(an) * len, y + Math.sin(an) * len, NEEDLE)
      if (d.kind === 'alt') {
        const an2 = ((-225 + ((f * 4) % 1) * 270) * Math.PI) / 180 // the short hand
        v.line(x, y, x + Math.cos(an2) * len * 0.55, y + Math.sin(an2) * len * 0.55, NEEDLE)
      }
      v.disc(x, y, Math.max(1, R(1.6)), BRASS[1])
      // a glint on the glass
      for (let k = 0; k < 4; k++) {
        const ga = (-150 + k * 11) * (Math.PI / 180)
        v.tint(Math.round(x + Math.cos(ga) * (r - 3)), Math.round(y + Math.sin(ga) * (r - 3)), WHITE, 120)
      }
    }
  }

  // the throttle: a black knob that slides forward as it opens
  {
    const v = new Sheet(fb, W, H)
    v.ox = oLever.x
    v.oy = oLever.y
    const kx = cx + R(-143)
    const ky = R(290 - 26 * clamp(live.boost, 0, 1))
    v.line(kx, ky, kx, H + 4, M[2])
    v.line(kx + 1, ky, kx + 1, H + 4, M[1])
    v.disc(kx, ky, Math.max(2, R(5)), BLACK)
    v.disc(kx - 1, ky - 1, Math.max(1, R(2)), rgb(90, 90, 96))
  }

  // the stick: a wooden column with a black rubber grip, leaning with the turn and the climb
  {
    const v = new Sheet(fb, W, H)
    v.ox = oStick.x
    v.oy = oStick.y
    const topY = R(282) - Math.round(clamp(live.climb, -1, 1) * R(3))
    const lean = clamp(live.turn, -1, 1) * R(10)
    const reach = H + R(40) - topY
    const wood = art.pal.wood
    const gripH = Math.max(8, R(16))
    for (let y = topY; y < H + art.pad; y++) {
      const d = y - topY
      const x = Math.round(cx + lean * (1 - d / reach))
      if (d < gripH) {
        const hw = Math.max(3, R(6)) - (d < 2 ? 2 - d : 0)
        const ridge = d > 2 && d % 3 === 0
        for (let i = -hw; i <= hw; i++) {
          const f = i / hw
          v.put(x + i, y, ridge ? rgb(8, 8, 8) : f < -0.5 ? rgb(70, 70, 74) : f < 0.2 ? rgb(38, 38, 42) : rgb(16, 16, 18))
        }
      } else {
        const hw = Math.max(2, R(4))
        for (let i = -hw; i <= hw; i++) {
          const f = i / hw
          v.put(x + i, y, f < -0.5 ? mix(wood, WHITE, 60) : f > 0.5 ? mix(wood, BLACK, 90) : wood)
        }
      }
    }
  }
}
