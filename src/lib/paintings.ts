// The paintings in the museum: sacred subjects after the old masters, as small pixel pictures in the way
// of the paintings in a block game, a few dozen pixels across, each pixel a dab of its own colour.
//
// Each is painted once, in code, onto a little canvas of floats: flat shapes (rectangles, ellipses,
// polygons, rings), a glow or two, then every pixel is nudged by a hash so no two are quite alike, and the
// whole is warmed and darkened at the edges as old varnish does. buildPaintings() returns them packed
// like the frame (0xAABBGGRR), with a mask for the arched one.

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0)
const pack = (r, g, b) => ((255 << 24) | (clamp255(b) << 16) | (clamp255(g) << 8) | clamp255(r)) >>> 0

function hash(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

// the old masters' colours
const C = {
  blue: [40, 62, 138], blueDk: [24, 36, 88], blueLt: [74, 104, 176],
  red: [170, 40, 36], redDk: [108, 24, 26], rose: [222, 172, 170],
  skin: [232, 192, 152], skinDk: [190, 140, 104], pale: [226, 210, 188],
  hair: [96, 60, 36], hairLt: [176, 128, 66], grey: [168, 164, 160],
  gold: [214, 172, 72], halo: [240, 206, 104],
  sky: [124, 162, 208], skyLt: [204, 218, 226], dusk: [196, 120, 80],
  dark: [34, 28, 24], umber: [66, 46, 32], brown: [104, 70, 42],
  green: [62, 98, 54], greenDk: [36, 62, 40], olive: [116, 120, 62],
  white: [230, 224, 206], stone: [168, 160, 146], ochre: [196, 150, 70],
  violet: [104, 70, 120], teal: [52, 110, 110], orange: [204, 112, 46],
}

class Canvas {
  constructor(w, h) {
    this.w = w
    this.h = h
    this.d = new Float32Array(w * h * 3)
    this.mask = null
  }
  put(x, y, c, t = 1) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const o = (y * this.w + x) * 3
    this.d[o] += (c[0] - this.d[o]) * t
    this.d[o + 1] += (c[1] - this.d[o + 1]) * t
    this.d[o + 2] += (c[2] - this.d[o + 2]) * t
  }
  /** every pixel whose middle passes the test */
  each(x0, y0, x1, y1, test, c, t = 1) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.h, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.w, Math.ceil(x1)); x++) {
        if (test(x + 0.5, y + 0.5)) this.put(x, y, c, t)
      }
    }
  }
  fill(c) { this.rect(0, 0, this.w, this.h, c) }
  /** a gradient down the rows from y0 to y1, from c0 to c1 */
  vgrad(y0, y1, c0, c1) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.h, Math.ceil(y1)); y++) {
      const t = (y + 0.5 - y0) / (y1 - y0)
      const c = [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t]
      for (let x = 0; x < this.w; x++) this.put(x, y, c)
    }
  }
  rect(x0, y0, x1, y1, c, t = 1) { this.each(x0, y0, x1, y1, (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1, c, t) }
  ell(cx, cy, rx, ry, c, t = 1) {
    this.each(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, c, t)
  }
  ring(cx, cy, r0, r1, c, t = 1) {
    this.each(cx - r1, cy - r1, cx + r1, cy + r1, (x, y) => { const d = Math.hypot(x - cx, y - cy); return d >= r0 && d <= r1 }, c, t)
  }
  poly(pts, c, t = 1) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
    this.each(x0, y0, x1, y1, (x, y) => {
      let inside = false
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i]
        const [xj, yj] = pts[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
      }
      return inside
    }, c, t)
  }
  /** a line a pixel wide */
  line(xa, ya, xb, yb, c, t = 1) {
    const n = Math.ceil(Math.max(Math.abs(xb - xa), Math.abs(yb - ya)) * 2) + 1
    for (let i = 0; i <= n; i++) this.put(Math.floor(xa + ((xb - xa) * i) / n), Math.floor(ya + ((yb - ya) * i) / n), c, t)
  }
  /** light laid over a round patch, strongest in the middle */
  glow(cx, cy, r, c, k) {
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(this.h, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(this.w, Math.ceil(cx + r)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r
        if (d < 1) this.put(x, y, c, k * (1 - d) * (1 - d))
      }
    }
  }
}

/**
 * a figure: a head with its hair, a robe from the shoulders down, a mantle over one side, a halo behind.
 * (x, top) is the top of the head, h the height to the hem; arms 'up', 'pray', 'out' or none.
 */
function figure(p, x, top, h, o) {
  const r = Math.max(0.8, h * 0.085)
  const hy = top + r
  const side = o.side || 1
  if (o.halo) p.ring(x, hy, r * 1.25, r * 1.85, C.halo, 0.85)
  const sh = top + r * 2.1
  const wTop = h * (o.seated ? 0.17 : 0.14)
  const wHem = h * (o.seated ? 0.34 : 0.23)
  p.poly([[x - wTop, sh], [x + wTop, sh], [x + wHem, top + h], [x - wHem, top + h]], o.robe)
  if (o.mantle) p.poly([[x + side * wTop * 0.2, sh - 0.3], [x + side * wTop * 1.15, sh], [x + side * wHem * 1.08, top + h], [x - side * wHem * 0.35, top + h]], o.mantle)
  if (o.arms === 'up') {
    for (const s of [-1, 1]) {
      p.line(x + s * wTop, sh + 0.5, x + s * (wTop + h * 0.16), sh - h * 0.2, o.mantle || o.robe)
      p.put(Math.floor(x + s * (wTop + h * 0.17)), Math.floor(sh - h * 0.22), o.skin || C.skin)
    }
  } else if (o.arms === 'pray') {
    p.ell(x, sh + h * 0.17, Math.max(0.6, h * 0.045), Math.max(0.7, h * 0.06), o.skin || C.skin)
  } else if (o.arms === 'out') {
    p.line(x + side * wTop, sh + 0.8, x + side * (wTop + h * 0.2), sh + h * 0.12, o.robe)
    p.put(Math.floor(x + side * (wTop + h * 0.22)), Math.floor(sh + h * 0.13), o.skin || C.skin)
  }
  // the head: hair (or a veil) behind, the face in front
  p.ell(x, hy - r * 0.15, r * 1.12, r * 1.1, o.hair || C.hair)
  p.ell(x + side * r * 0.12, hy + r * 0.12, r * 0.78, r * 0.86, o.skin || C.skin)
  if (o.beard) p.ell(x + side * r * 0.1, hy + r * 0.75, r * 0.6, r * 0.5, o.beard)
}

/** a little cherub: a round head and body, a wing either side */
function cherub(p, x, y) {
  p.put(Math.floor(x) - 1, Math.floor(y), C.white)
  p.put(Math.floor(x) + 1, Math.floor(y), C.white)
  p.put(Math.floor(x), Math.floor(y), C.skin)
  p.put(Math.floor(x), Math.floor(y) + 1, C.skinDk)
}

/** the finish: each pixel nudged by a hash, warmed and darkened towards the edges like old varnish */
function finish(p, seed) {
  const out = new Uint32Array(p.w * p.h)
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const o = (y * p.w + x) * 3
      const k = 0.9 + hash(x, y, seed) * 0.2
      const dx = (x + 0.5) / p.w - 0.5
      const dy = (y + 0.5) / p.h - 0.5
      const v = 1 - (dx * dx + dy * dy) * 0.55
      const j = (hash(y, x, seed + 7) - 0.5) * 10
      out[y * p.w + x] = pack(p.d[o] * k * v + j, p.d[o + 1] * k * v * 0.97 + j, p.d[o + 2] * k * v * 0.86 + j)
    }
  }
  return out
}

// ── the pictures

/** The Assumption of the Virgin, after Rubens: tall, the top arched. She rises in a golden light among
 * clouds and cherubs, her arms raised; below, the apostles round the empty tomb. */
function assumption() {
  const p = new Canvas(18, 30)
  p.vgrad(0, 14, [246, 222, 150], C.sky)
  p.vgrad(14, 22, C.sky, [92, 96, 110])
  p.vgrad(22, 30, [80, 72, 64], C.umber)
  p.glow(9, 7, 9, [255, 236, 170], 0.8)
  p.ell(3, 15, 4.5, 2.2, [196, 190, 186])
  p.ell(15, 14, 4.5, 2.3, [204, 198, 190])
  p.ell(9, 17.5, 6.5, 2.2, [176, 172, 172])
  for (const [x, y] of [[3, 9], [15, 8], [4, 12.5], [14, 11.5], [6, 4], [12, 4], [2, 17], [16, 17]]) cherub(p, x, y)
  figure(p, 9, 4, 12, { robe: C.red, mantle: C.blue, arms: 'up', halo: true })
  p.poly([[11, 8], [16, 10], [13, 14]], C.blueLt) // her mantle blown out to the side
  // the tomb, and the apostles round it, some looking up
  p.rect(6, 25, 12.5, 30, C.stone)
  p.rect(6, 25, 12.5, 26, [120, 114, 106])
  const ap = [[2, 21, C.green], [5, 20, C.red], [8, 21.5, C.ochre], [11, 21, C.teal], [14, 20, C.redDk], [16.5, 21.5, C.olive]]
  ap.forEach(([x, y, c], i) => figure(p, x, y, 9, { robe: c, hair: i % 2 ? C.grey : C.hair, beard: i % 3 === 0 ? C.grey : null, arms: i === 1 || i === 4 ? 'up' : null, side: x < 9 ? 1 : -1 }))
  p.rect(6, 26, 12.5, 30, C.stone)
  // the arch: what is outside it is wall
  p.mask = new Uint8Array(18 * 30)
  for (let y = 0; y < 30; y++) for (let x = 0; x < 18; x++) p.mask[y * 18 + x] = y >= 9 || Math.hypot(x + 0.5 - 9, y + 0.5 - 9) <= 9 ? 1 : 0
  return p
}

/** The Last Supper, after Leonardo: the long table, the twelve in four groups of three, and Christ in the
 * middle against the bright window. */
function lastSupper() {
  const p = new Canvas(44, 18)
  p.fill([62, 52, 42])
  p.rect(0, 0, 44, 3, [44, 36, 30])
  for (let x = 2; x < 44; x += 5) p.rect(x, 0, x + 1, 3, [70, 58, 46]) // the coffers of the ceiling
  // the tapestries down the side walls, and the windows at the back
  for (const x of [1, 5, 36, 40]) p.rect(x, 4, x + 3, 10, [36, 32, 30])
  p.rect(12, 5, 15, 9, [176, 200, 214])
  p.rect(29, 5, 32, 9, [176, 200, 214])
  p.rect(19, 4, 25, 10, [184, 206, 220])
  p.rect(19, 8.5, 25, 10, [120, 150, 104])
  p.rect(0, 15, 44, 18, [104, 84, 60])
  // the twelve, then Christ
  const cols = [C.green, C.red, C.ochre, C.blueLt, C.rose, C.brown, C.olive, C.orange, C.violet, C.teal, C.umber, C.redDk]
  const xs = [4, 6.6, 9.2, 12, 14.6, 17, 27, 29.4, 32, 34.8, 37.4, 40]
  xs.forEach((x, i) => {
    const lean = i % 3 === 1 ? 0.6 : 0
    figure(p, x + (i < 6 ? lean : -lean), 6.5 + (i % 2) * 0.7, 9, { robe: cols[i], hair: i % 4 === 0 ? C.grey : i % 4 === 2 ? C.hairLt : C.hair, beard: i % 3 === 0 ? C.grey : null, side: i < 6 ? 1 : -1, arms: i % 3 === 2 ? 'out' : null })
  })
  figure(p, 22, 6, 10, { robe: C.red, mantle: C.blue, hair: C.hair, beard: C.hair })
  // the table and its cloth, bread and dishes on it, hands on it
  p.rect(2, 11.5, 42, 13, C.white)
  p.rect(2, 13, 42, 15, [200, 194, 178])
  p.rect(2, 14.5, 42, 15, [150, 144, 132])
  for (let x = 4; x < 42; x += 3) p.put(x, 11, hash(x, 1, 3) < 0.5 ? [140, 136, 132] : C.ochre)
  for (const x of [8, 14, 20, 24, 30, 37]) p.put(x, 12, C.skin)
  return p
}

/** The Annunciation: the angel kneels on the left, the Virgin is at her prayers on the right; between
 * them a column, a lily, and the dove coming down in a beam of light. */
function annunciation() {
  const p = new Canvas(24, 20)
  p.fill([196, 176, 146])
  p.vgrad(3, 12, C.skyLt, [140, 170, 110])
  p.rect(10, 0, 24, 16, [196, 176, 146])
  p.rect(0, 0, 24, 3, [170, 150, 122])
  for (let y = 15; y < 20; y++) for (let x = 0; x < 24; x++) p.put(x, y, (x + y) & 1 ? [168, 146, 118] : [132, 112, 90])
  p.rect(11, 2, 12.5, 16, [226, 216, 192])
  p.rect(10.5, 2, 13, 3, [236, 226, 204])
  p.rect(14, 3, 24, 15, [150, 120, 100]) // the room behind her
  p.rect(17, 4, 23, 9, C.redDk) // a curtain
  // the angel: wings raised behind, a rose robe, kneeling, a hand held out
  p.poly([[5, 9], [1, 2], [3, 1], [7, 7]], C.gold)
  p.poly([[2, 2], [3, 1], [4, 3]], C.rose)
  figure(p, 6, 6, 10, { robe: C.rose, mantle: [236, 220, 200], hair: C.hairLt, halo: true, arms: 'out', side: 1 })
  // the Virgin, her head bowed, at a lectern with a book
  figure(p, 18, 7, 10, { robe: C.red, mantle: C.blue, seated: true, halo: true, arms: 'pray', side: -1 })
  p.rect(20.5, 11, 22.5, 16, C.brown)
  p.rect(20, 10.5, 23, 11.5, C.white)
  // the lily, the dove and its light
  p.line(13.5, 16, 14, 11, C.green)
  for (const [x, y] of [[13, 11], [14, 10], [15, 11], [14, 12]]) p.put(x, y, C.white)
  p.line(12, 2, 18, 7, C.halo, 0.6)
  p.line(12, 3, 17, 8, C.halo, 0.4)
  p.ell(11.5, 1.8, 1.4, 0.8, [250, 250, 246])
  return p
}

/** The Madonna and Child in a meadow, after Raphael: she sits in red and blue before blue hills, the
 * child on her lap. */
function madonna() {
  const p = new Canvas(16, 22)
  p.vgrad(0, 12, [138, 176, 216], [222, 226, 210])
  p.ell(3, 12.5, 6, 2, [140, 156, 176])
  p.ell(13, 12, 5, 1.8, [130, 148, 170])
  p.vgrad(12.5, 22, [110, 132, 72], [70, 92, 46])
  p.rect(0, 12.5, 1, 22, C.greenDk)
  p.ell(1, 7, 1.2, 5, C.greenDk)
  p.ell(15, 8, 1, 4, C.greenDk)
  p.ring(8, 6, 2.1, 3, C.halo, 0.7)
  // the Virgin, half length, her blue mantle over her knees
  p.poly([[5.5, 9], [10.5, 9], [14.5, 22], [1.5, 22]], C.red)
  p.poly([[4.5, 10], [7, 9.5], [9, 14], [15, 18], [15, 22], [1, 22]], C.blue)
  p.ell(8, 5.8, 2, 2.3, C.hair)
  p.ell(8.2, 6.3, 1.4, 1.7, C.skin)
  p.rect(7.5, 8, 8.8, 9.3, C.skinDk)
  // the child on her lap, his head against her
  p.ell(9.5, 14, 2.4, 1.5, C.skin)
  p.ell(11, 12, 1.2, 1.2, C.skin)
  p.ell(11, 11.4, 1.1, 0.6, C.hairLt)
  p.put(12, 15, C.skinDk)
  p.put(7, 15, C.skin) // her hand
  return p
}

/** The Crucifixion: the cross against a darkening sky, the Virgin on one side and Saint John on the
 * other, the Magdalene at the foot of the cross. */
function crucifixion() {
  const p = new Canvas(16, 24)
  p.vgrad(0, 18, [22, 22, 42], [120, 52, 42])
  p.vgrad(18, 24, [70, 56, 40], [44, 36, 28])
  p.rect(0, 17, 5, 18, [36, 32, 40])
  p.rect(1, 16, 3, 17, [36, 32, 40])
  p.rect(12, 16.5, 16, 18, [36, 32, 40])
  // the cross and the title over it
  p.rect(7.3, 3, 8.7, 21, [74, 48, 30])
  p.rect(2.5, 6, 13.5, 7.2, [74, 48, 30])
  p.rect(7.2, 2, 8.8, 3, C.white)
  // Christ
  p.ring(8.3, 7.6, 1.0, 1.5, C.halo, 0.7)
  p.rect(3, 6.2, 13, 6.9, C.pale)
  p.rect(7.3, 7.5, 8.7, 12.5, C.pale)
  p.rect(7, 12, 9, 13.5, C.white)
  p.rect(7.6, 13.5, 8.5, 18, C.pale)
  p.ell(8.4, 7.5, 0.8, 0.9, C.hair)
  p.put(8, 8, C.skinDk)
  // the Virgin and Saint John, and the Magdalene kneeling at the foot
  figure(p, 3.5, 13, 10, { robe: C.violet, mantle: C.blue, arms: 'pray', halo: true, side: 1 })
  figure(p, 12.5, 13, 10, { robe: C.green, mantle: C.red, hair: C.hairLt, arms: 'pray', halo: true, side: -1 })
  figure(p, 9.5, 17.5, 6, { robe: C.redDk, mantle: C.red, hair: C.orange, seated: true, side: -1 })
  return p
}

/** The Adoration of the Magi: the three kings bring their gifts at night to the child, who gives the light. */
function adoration() {
  const p = new Canvas(26, 20)
  p.fill([42, 34, 28])
  p.rect(0, 0, 11, 8, [30, 38, 70]) // the night through a ruined arch, and the star
  p.ring(5.5, 8, 4, 6, [92, 84, 72])
  p.rect(0, 8, 1.5, 17, [92, 84, 72])
  p.rect(9.5, 8, 11, 17, [92, 84, 72])
  p.put(7, 2, [255, 240, 180])
  p.line(7, 2, 12, 9, [255, 236, 170], 0.35)
  p.poly([[12, 0], [26, 0], [26, 3], [14, 5]], [78, 56, 34]) // the roof of the stable
  p.rect(0, 16.5, 26, 20, [124, 98, 52])
  p.glow(17, 13, 10, [255, 218, 150], 0.55)
  // the ox and the ass
  p.ell(21.5, 8, 1.6, 1.2, [120, 84, 54])
  p.ell(24.5, 9, 1.3, 1, [130, 126, 120])
  // the Virgin with the child, Joseph behind
  figure(p, 23, 5, 12, { robe: C.ochre, mantle: C.brown, hair: C.grey, beard: C.grey, side: -1 })
  figure(p, 19, 8, 10, { robe: C.red, mantle: C.blue, seated: true, halo: true, side: -1 })
  p.ell(16.5, 13, 1.6, 1, [248, 236, 214])
  p.ell(15.6, 12.6, 0.8, 0.8, [248, 236, 214])
  // the kings: one kneeling in gold, one standing in red and ermine, one in green with a white turban
  figure(p, 12.5, 10, 7, { robe: C.gold, mantle: C.red, hair: C.grey, beard: C.white, seated: true, side: 1, arms: 'out' })
  figure(p, 8, 6, 11, { robe: C.red, mantle: C.white, hair: C.hair, beard: C.hair, side: 1 })
  figure(p, 3.8, 6.5, 10.5, { robe: C.green, mantle: C.teal, hair: C.white, skin: [120, 80, 56], side: 1, arms: 'out' })
  p.put(13, 11, C.halo)
  p.put(6, 10, C.halo)
  return p
}

/** The Baptism of Christ: he stands in the river, Saint John pours the water, an angel holds his robe,
 * and the dove comes down. */
function baptism() {
  const p = new Canvas(16, 22)
  p.vgrad(0, 12, [168, 196, 222], [216, 222, 200])
  p.vgrad(12, 15, [110, 134, 78], [88, 110, 60])
  p.ell(1.5, 8, 2, 7, C.greenDk)
  p.ell(14.8, 6, 1.6, 6, C.greenDk)
  p.vgrad(15, 22, [86, 126, 152], [52, 86, 112])
  for (const [x, y] of [[2, 16], [6, 18], [11, 17], [13, 20], [4, 20]]) p.put(x, y, [196, 216, 226])
  // the dove and its light
  p.line(8, 2, 8, 5, C.halo, 0.6)
  p.ell(8, 1.6, 1.4, 0.7, [250, 250, 246])
  // Christ in the water, Saint John on the bank, the angel kneeling with the robe
  figure(p, 8, 5.5, 13, { robe: C.pale, mantle: null, arms: 'pray', halo: true })
  p.rect(7, 11, 9, 12.5, C.white)
  p.rect(6, 16, 10, 18.5, [96, 136, 160], 0.6)
  figure(p, 12.5, 5, 11, { robe: [124, 88, 52], mantle: C.red, hair: C.hair, beard: C.hair, side: -1 })
  p.line(11, 7.5, 9.5, 5.5, [124, 88, 52])
  p.put(9, 5, C.stone)
  figure(p, 3, 9, 7, { robe: C.rose, mantle: C.blueLt, hair: C.hairLt, seated: true, halo: true, side: 1 })
  return p
}

/** The Pietà: the Virgin holds her son across her knees, in the dark before the tomb. */
function pieta() {
  const p = new Canvas(22, 16)
  p.fill([32, 28, 32])
  p.vgrad(9, 14, [36, 32, 36], [70, 60, 50])
  p.rect(0, 13.5, 22, 16, [64, 50, 38])
  p.rect(15, 2, 22, 13.5, [52, 48, 46]) // the rock of the tomb
  // the Virgin: a wide blue mantle, a white veil
  p.ring(11, 3.6, 1.6, 2.3, C.halo, 0.7)
  p.poly([[8, 4], [14, 4], [18, 14], [4, 14]], C.blue)
  p.poly([[9.5, 6], [12.5, 6], [13, 9], [9, 9]], C.redDk)
  p.ell(11, 3.6, 1.6, 1.7, C.white)
  p.ell(11.2, 4, 1, 1.2, C.skin)
  // her son across her knees: his head fallen back on the left, a white cloth, his legs to the right
  p.poly([[4, 9.5], [12, 10], [18, 11.5], [18, 12.5], [12, 11.5], [4, 11]], C.pale)
  p.rect(10, 10, 13, 11.8, C.white)
  p.ell(4.2, 9.8, 1, 0.9, C.hair)
  p.put(18, 12, C.skinDk)
  p.put(13, 9, C.skin) // her hand
  return p
}

/** The Virgin in Prayer, after Sassoferrato: a white headcloth, the blue mantle, the hands joined. */
function virginInPrayer() {
  const p = new Canvas(12, 16)
  p.fill([30, 28, 34])
  p.poly([[3, 4], [9, 4], [12, 16], [0, 16]], C.blue)
  p.poly([[4.5, 8], [7.5, 8], [7, 11], [5, 11]], C.red)
  p.ell(6, 5, 2.6, 2.6, C.blueDk)
  p.ell(6, 5.4, 2, 2.2, C.white)
  p.ell(6.1, 5.9, 1.3, 1.6, C.skin)
  p.put(6, 6, C.skinDk)
  p.ell(6, 11.5, 1, 1.3, C.skin)
  return p
}

export const PAINTINGS = [
  { id: 'assumption', title: 'The Assumption of the Virgin', paint: assumption },
  { id: 'supper', title: 'The Last Supper', paint: lastSupper },
  { id: 'annunciation', title: 'The Annunciation', paint: annunciation },
  { id: 'madonna', title: 'The Madonna of the Meadow', paint: madonna },
  { id: 'crucifixion', title: 'The Crucifixion', paint: crucifixion },
  { id: 'adoration', title: 'The Adoration of the Magi', paint: adoration },
  { id: 'baptism', title: 'The Baptism of Christ', paint: baptism },
  { id: 'pieta', title: 'Pietà', paint: pieta },
  { id: 'prayer', title: 'The Virgin in Prayer', paint: virginInPrayer },
]

/** every painting, painted: { id, title, w, h, px (packed colours), mask (1 where it is painted, or null) } */
export function buildPaintings() {
  const out = {}
  PAINTINGS.forEach((d, i) => {
    const p = d.paint()
    out[d.id] = { id: d.id, title: d.title, w: p.w, h: p.h, px: finish(p, i * 131 + 17), mask: p.mask }
  })
  return out
}
