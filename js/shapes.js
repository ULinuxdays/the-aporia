/**
 * js/shapes.js — the seven point clouds the page morphs between.
 *
 *   0 monument   the Thinker, seated on his rock, on a tall plinth
 *   1 epicurus   the bust, at eye level, no plinth, larger in frame
 *   2 crowd      ~50 procedural human figures on a ground plane, wired together
 *   3 device     a slab with a lit face, circuit traces on a board behind it
 *   4 unformed   a loose, unresolved cloud
 *   5 page       a blank sheet on a desk, a half-written line, a cursor
 *   6 wordmark   "THE APORIA", sampled from a 2D canvas
 *   7 portal     everything fallen in a heap, and a ring at eye level: the way through
 *
 * PARTICLE CORRESPONDENCE — the thing that makes the morphs read.
 *
 * Every shape is laid out in the same part order, so particle i means roughly
 * the same thing in every shape:
 *
 *   indices [0, baseCount)       "the thing underneath" — BASE_SHARE (22 %)
 *                                plinth → rubble → network lines → circuit
 *                                traces → sediment → desk → underline
 *   indices [baseCount, count)   the form itself
 *
 * Within each group the points are additionally sorted into a raster
 * (horizontal bands bottom-to-top, left-to-right within a band) of that
 * group's own bounding box. So the bottom-left of one form morphs to the
 * bottom-left of the next, the plinth's top collapses into the top of the
 * rubble pile, and so on. Without this the transitions are a uniform
 * cross-dissolve and the page reads as noise.
 *
 * FRAME — CONTRACTS.md §9. Y up, ground at y = 0, things live roughly in
 * x ∈ [-1.9, 1.9], y ∈ [0, 2.3], z ∈ [-1.4, 1.0], fronts face +Z.
 *
 * Everything is seeded (mulberry32), so layouts are identical across reloads.
 * Browser-only for the canvas-sampled shapes (5, 6); they degrade to blocky
 * placeholders where there is no `document`.
 */

/** Shape order for the default three lenses. buildAllShapes() recomputes this for any lens list. */
export const DEFAULT_LENSES = Object.freeze(['crowd', 'device', 'unformed']);
export const SHAPE_NAMES = Object.freeze(['monument', 'epicurus', ...DEFAULT_LENSES, 'page', 'wordmark', 'portal']);
export const shapeNamesFor = (lenses = DEFAULT_LENSES) => ['monument', 'epicurus', ...lenses, 'page', 'wordmark', 'portal'];
import { PORTAL } from './state.js';
export { PORTAL };                      // the ring's geometry, shared with main.js
export const BASE_SHARE = 0.22;
export const DEFAULT_SEED = 20260821;

// --------------------------------------------------------------------------- PRNG

/** mulberry32 — the same generator tools/bake.mjs uses. Returns () => [0, 1). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (rng, a, b) => a + (b - a) * rng();
const gauss = (rng) => {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// --------------------------------------------------------------------------- emitters
// An emitter is { w, fn } — a relative weight (≈ surface area, or an explicit
// share) and a function that writes ONE point into out[o..o+2], in LOCAL space.
// emit() divides n points between emitters by weight and applies a transform.

function emit(parts, n, rng, out, o, transform) {
  const W = parts.reduce((s, p) => s + p.w, 0);
  const counts = new Int32Array(parts.length);
  const frac = new Float64Array(parts.length);
  let used = 0;
  for (let i = 0; i < parts.length; i++) {
    const raw = W > 0 ? (parts[i].w / W) * n : 0;
    counts[i] = Math.floor(raw);
    frac[i] = raw - counts[i];
    used += counts[i];
  }
  // largest-remainder for the leftovers
  const order = [...counts.keys()].sort((a, b) => frac[b] - frac[a]);
  for (let k = 0; used < n; k = (k + 1) % parts.length) { counts[order[k]]++; used++; }

  for (let i = 0; i < parts.length; i++) {
    const fn = parts[i].fn;
    for (let k = 0; k < counts[i]; k++) {
      fn(rng, out, o);
      if (transform) transform(out, o);
      o += 3;
    }
  }
  return o;
}

/** scale → rotate about X (pitch) → rotate about Y (yaw) → translate. Radians. */
function makeTransform({ scale = 1, yaw = 0, pitch = 0, pos = [0, 0, 0] } = {}) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return (out, o) => {
    let x = out[o] * scale, y = out[o + 1] * scale, z = out[o + 2] * scale;
    // pitch about X
    const y1 = y * cp - z * sp, z1 = y * sp + z * cp;
    // yaw about Y
    const x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
    out[o] = x2 + pos[0];
    out[o + 1] = y1 + pos[1];
    out[o + 2] = z2 + pos[2];
  };
}

function boxSurface(c, s, w) {
  const [sx, sy, sz] = s;
  const ax = sy * sz, ay = sx * sz, az = sx * sy;
  const area = 2 * (ax + ay + az);
  const cdf = [ax, ax * 2, ax * 2 + ay, ax * 2 + ay * 2, ax * 2 + ay * 2 + az, area];
  return {
    w: w ?? area,
    fn(rng, out, o) {
      const r = rng() * area;
      let f = 0;
      while (cdf[f] < r) f++;
      const u = rng() - 0.5, v = rng() - 0.5;
      const sign = (f & 1) ? 1 : -1;
      if (f < 2) { out[o] = c[0] + sign * sx / 2; out[o + 1] = c[1] + u * sy; out[o + 2] = c[2] + v * sz; }
      else if (f < 4) { out[o] = c[0] + u * sx; out[o + 1] = c[1] + sign * sy / 2; out[o + 2] = c[2] + v * sz; }
      else { out[o] = c[0] + u * sx; out[o + 1] = c[1] + v * sy; out[o + 2] = c[2] + sign * sz / 2; }
    },
  };
}

function boxEdgeList(c, s) {
  const [sx, sy, sz] = s;
  const x0 = c[0] - sx / 2, x1 = c[0] + sx / 2, y0 = c[1] - sy / 2, y1 = c[1] + sy / 2, z0 = c[2] - sz / 2, z1 = c[2] + sz / 2;
  return [
    [[x0, y0, z0], [x1, y0, z0]], [[x0, y1, z0], [x1, y1, z0]], [[x0, y0, z1], [x1, y0, z1]], [[x0, y1, z1], [x1, y1, z1]],
    [[x0, y0, z0], [x0, y1, z0]], [[x1, y0, z0], [x1, y1, z0]], [[x0, y0, z1], [x0, y1, z1]], [[x1, y0, z1], [x1, y1, z1]],
    [[x0, y0, z0], [x0, y0, z1]], [[x1, y0, z0], [x1, y0, z1]], [[x0, y1, z0], [x0, y1, z1]], [[x1, y1, z0], [x1, y1, z1]],
  ];
}

/** Points along a set of segments, uniform by length, jittered within `r` of the line. */
function segments(list, r = 0, w) {
  const n = list.length;
  const cdf = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [a, b] = list[i];
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    cdf[i] = total;
  }
  return {
    w: w ?? total,
    fn(rng, out, o) {
      const target = rng() * total;
      let lo = 0, hi = n - 1;
      while (lo < hi) { const m = (lo + hi) >>> 1; if (cdf[m] < target) lo = m + 1; else hi = m; }
      const [a, b] = list[lo];
      const t = rng();
      out[o] = a[0] + (b[0] - a[0]) * t + gauss(rng) * r;
      out[o + 1] = a[1] + (b[1] - a[1]) * t + gauss(rng) * r;
      out[o + 2] = a[2] + (b[2] - a[2]) * t + gauss(rng) * r;
    },
  };
}

/** Open tube from a to b, radius r0 → r1, cross-section squashed by `flatten` on its second axis. */
function tube(a, b, r0, r1 = r0, flatten = 1, w) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]) || 1e-6;
  const ax = [d[0] / len, d[1] / len, d[2] / len];
  // perpendicular basis: u is "sideways" (prefer world X), v = axis × u
  let ref = Math.abs(ax[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  let u = cross(ref, ax); u = norm(u);
  const v = cross(ax, u);
  const area = Math.PI * (r0 + r1) * len * (0.5 + 0.5 * flatten);
  return {
    w: w ?? area,
    fn(rng, out, o) {
      const t = rng(), th = rng() * Math.PI * 2;
      const r = r0 + (r1 - r0) * t;
      const cu = Math.cos(th) * r, cv = Math.sin(th) * r * flatten;
      out[o] = a[0] + d[0] * t + u[0] * cu + v[0] * cv;
      out[o + 1] = a[1] + d[1] * t + u[1] * cu + v[1] * cv;
      out[o + 2] = a[2] + d[2] * t + u[2] * cu + v[2] * cv;
    },
  };
}

function ellipsoid(c, r, w) {
  const area = 4 * Math.PI * Math.pow((Math.pow(r[0] * r[1], 1.6) + Math.pow(r[0] * r[2], 1.6) + Math.pow(r[1] * r[2], 1.6)) / 3, 1 / 1.6);
  return {
    w: w ?? area,
    fn(rng, out, o) {
      let x = gauss(rng), y = gauss(rng), z = gauss(rng);
      const l = Math.hypot(x, y, z) || 1;
      out[o] = c[0] + (x / l) * r[0];
      out[o + 1] = c[1] + (y / l) * r[1];
      out[o + 2] = c[2] + (z / l) * r[2];
    },
  };
}

/** Filled parallelogram origin + a·u + b·v, a, b ∈ [0, 1). */
function rectFill(origin, u, v, w) {
  const area = Math.hypot(...cross(u, v));
  return {
    w: w ?? area,
    fn(rng, out, o) {
      const a = rng(), b = rng();
      out[o] = origin[0] + u[0] * a + v[0] * b;
      out[o + 1] = origin[1] + u[1] * a + v[1] * b;
      out[o + 2] = origin[2] + u[2] * a + v[2] * b;
    },
  };
}

function gaussianBlob(c, sigma, w) {
  return {
    w,
    fn(rng, out, o) {
      out[o] = c[0] + gauss(rng) * sigma[0];
      out[o + 1] = c[1] + gauss(rng) * sigma[1];
      out[o + 2] = c[2] + gauss(rng) * sigma[2];
    },
  };
}

/** Points from a 2D sample set (Float32Array of u,v pairs) mapped through `map(u, v) → [x, y, z]`. */
function fromPoints2D(pts, map, w) {
  const n = pts.length / 2;
  return {
    w,
    fn(rng, out, o) {
      const i = Math.floor(rng() * n) * 2;
      const p = map(pts[i], pts[i + 1]);
      out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2];
    },
  };
}

/** One emitter that picks among `parts` by weight per point, then applies `transform`. */
function union(parts, transform, w) {
  const cdf = new Float64Array(parts.length);
  let tot = 0;
  parts.forEach((p, i) => { tot += p.w; cdf[i] = tot; });
  return {
    w: w ?? tot,
    fn(rng, out, o) {
      const r = rng() * tot;
      let lo = 0, hi = parts.length - 1;
      while (lo < hi) { const m = (lo + hi) >>> 1; if (cdf[m] < r) lo = m + 1; else hi = m; }
      parts[lo].fn(rng, out, o);
      if (transform) transform(out, o);
    },
  };
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// --------------------------------------------------------------------------- ordering & helpers

/** Reorder points into a bottom-to-top, left-to-right raster of their own bbox. Returns a new array. */
function rasterOrder(pts, bands = 48) {
  const n = pts.length / 3;
  if (n === 0) return pts;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1];
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  const xr = (xmax - xmin) || 1, yr = (ymax - ymin) || 1;
  const keys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const band = Math.min(bands - 1, Math.floor(((pts[i * 3 + 1] - ymin) / yr) * bands));
    keys[i] = band + ((pts[i * 3] - xmin) / xr) * 0.999;
  }
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => keys[a] - keys[b]);
  const out = new Float32Array(pts.length);
  for (let i = 0; i < n; i++) {
    out[i * 3] = pts[idx[i] * 3];
    out[i * 3 + 1] = pts[idx[i] * 3 + 1];
    out[i * 3 + 2] = pts[idx[i] * 3 + 2];
  }
  return out;
}

/** min y → 0, height → 1, centre x/z by bbox. In place. (Same rule as the bake.) */
function normaliseHeight(pts) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  const s = 1 / ((ymax - ymin) || 1), cx = (xmin + xmax) / 2, cz = (zmin + zmax) / 2;
  for (let i = 0; i < pts.length; i += 3) {
    pts[i] = (pts[i] - cx) * s;
    pts[i + 1] = (pts[i + 1] - ymin) * s;
    pts[i + 2] = (pts[i + 2] - cz) * s;
  }
  return pts;
}

/**
 * n points from a baked cloud (CONTRACTS §3: random order, any prefix is a
 * uniform subsample). If n exceeds the cloud, it wraps with a little jitter.
 */
function fromCloud(cloud, n, rng, transform) {
  const m = cloud.length / 3;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = (i % m) * 3;
    const jit = i >= m ? 0.004 : 0;
    out[i * 3] = cloud[j] + gauss(rng) * jit;
    out[i * 3 + 1] = cloud[j + 1] + gauss(rng) * jit;
    out[i * 3 + 2] = cloud[j + 2] + gauss(rng) * jit;
    if (transform) transform(out, i * 3);
  }
  return out;
}

/**
 * Sample the ink of `text` drawn on an offscreen canvas. Returns
 * { pts: Float32Array(n*2) in pixel coords, ink: {x0,y0,x1,y1} } or null
 * when there is no DOM (Node) — callers then fall back to block glyphs.
 */
function sampleCanvasText(text, font, n, rng) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.font = font;
  const px = parseInt(/(\d+)px/.exec(font)?.[1] ?? '100', 10);
  const m = ctx.measureText(text);
  const pad = Math.ceil(px * 0.25);
  const w = Math.ceil(m.width + pad * 2), h = Math.ceil(px * 1.6);
  canvas.width = w; canvas.height = h;
  ctx.font = font;                       // resizing resets state
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, pad, Math.round(px * 1.15));
  const data = ctx.getImageData(0, 0, w, h).data;
  const lit = [];
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = data[(y * w + x) * 4]; // red channel of white-on-black = coverage
      if (v > 96) {
        lit.push(x, y, v);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (!lit.length) return null;
  const count = lit.length / 3;
  const pts = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    // coverage-weighted rejection keeps anti-aliased edges soft instead of fuzzy
    let k;
    do { k = Math.floor(rng() * count) * 3; } while (rng() * 255 > lit[k + 2]);
    pts[i * 2] = lit[k] + rng();
    pts[i * 2 + 1] = lit[k + 1] + rng();
  }
  return { pts, ink: { x0, y0, x1: x1 + 1, y1: y1 + 1 } };
}

/** No-DOM fallback for text: one block per letter, gap per space. Pixel-ish units. */
function blockText(text, n, rng) {
  const px = 100, w = px * 0.62, gap = px * 0.12;
  const boxes = [];
  let x = 0;
  for (const ch of text) {
    if (ch === ' ') { x += w * 0.7; continue; }
    boxes.push([x, x + w]);
    x += w + gap;
  }
  const pts = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const b = pick(rng, boxes);
    pts[i * 2] = range(rng, b[0], b[1]);
    pts[i * 2 + 1] = range(rng, 0, px);
  }
  return { pts, ink: { x0: 0, y0: 0, x1: x - gap, y1: px } };
}

/**
 * Build an emitter for text placed in the XY plane: ink width → `width` world
 * units, left edge at x = left (or centred if `centre`), baseline-ish bottom at y = bottom.
 */
function textEmitter(text, font, n, rng, { width, bottom, left, centre = false, z = 0 }, w) {
  const s = sampleCanvasText(text, font, n, rng) ?? blockText(text, n, rng);
  const { x0, y0, x1, y1 } = s.ink;
  const scale = width / (x1 - x0);
  const height = (y1 - y0) * scale;
  const x = centre ? -width / 2 : left;
  return {
    emitter: fromPoints2D(s.pts, (u, v) => [x + (u - x0) * scale, bottom + height - (v - y0) * scale, z], w),
    width, height,
  };
}

// --------------------------------------------------------------------------- procedural humans

/**
 * Emitters for a standing figure of unit height in local space (feet at y=0,
 * facing +Z). Ordinary proportions: ~7.5 heads tall, arms to mid-thigh.
 */
function standingFigure(rng, pose = 'down') {
  const parts = [];
  const head = [0, 0.925, 0];
  parts.push(ellipsoid(head, [0.062, 0.075, 0.068]));
  parts.push(tube([0, 0.85, 0], [0, 0.875, 0], 0.026));
  parts.push(tube([0, 0.53, 0], [0, 0.845, 0], 0.105, 0.138, 0.58));           // torso, widening to shoulders
  parts.push(rectFill([-0.138, 0.845, -0.04], [0.276, 0, 0], [0, 0, 0.08], 0.012)); // shoulder top
  parts.push(tube([0, 0.47, 0], [0, 0.54, 0], 0.1, 0.105, 0.6));              // hips
  for (const s of [-1, 1]) {
    parts.push(tube([s * 0.055, 0.5, 0], [s * 0.07, 0.02, 0.0], 0.048, 0.036, 0.9)); // leg
    parts.push(boxSurface([s * 0.07, 0.015, 0.03], [0.07, 0.03, 0.13]));        // foot
    const sh = [s * 0.145, 0.82, 0];
    let hand;
    if (pose === 'raise' && s === 1) hand = [s * 0.2, 1.06, 0.02];
    else if (pose === 'point' && s === -1) hand = [s * 0.42, 0.78, 0.1];
    else if (pose === 'hips') hand = [s * 0.13, 0.52, 0.02];
    else hand = [s * 0.185, 0.44, 0.02];
    if (pose === 'hips' || (pose === 'raise' && s === 1)) {
      const elbow = pose === 'hips' ? [s * 0.25, 0.66, 0.02] : [s * 0.24, 0.92, 0.02];
      parts.push(tube(sh, elbow, 0.034, 0.03));
      parts.push(tube(elbow, hand, 0.03, 0.026));
    } else {
      parts.push(tube(sh, hand, 0.034, 0.027));
    }
  }
  return parts;
}

/** Stand-in for thinker.bin: a seated, forward-leaning figure on a rock, unit height, facing +Z. */
export function standInThinker(n, rng = makeRng(7)) {
  const parts = [];
  parts.push(ellipsoid([0, 0.2, -0.06], [0.34, 0.21, 0.32]));                // the rock
  const hipL = [-0.09, 0.44, -0.02], hipR = [0.09, 0.44, -0.02];
  const kneeL = [-0.1, 0.5, 0.3], kneeR = [0.1, 0.5, 0.3];
  const ankL = [-0.1, 0.05, 0.27], ankR = [0.1, 0.05, 0.27];
  parts.push(tube(hipL, kneeL, 0.075, 0.06)); parts.push(tube(hipR, kneeR, 0.075, 0.06));
  parts.push(tube(kneeL, ankL, 0.055, 0.045)); parts.push(tube(kneeR, ankR, 0.055, 0.045));
  parts.push(boxSurface([-0.1, 0.02, 0.31], [0.08, 0.04, 0.16])); parts.push(boxSurface([0.1, 0.02, 0.31], [0.08, 0.04, 0.16]));
  parts.push(tube([0, 0.44, -0.02], [0, 0.8, 0.12], 0.13, 0.15, 0.6));      // torso leaning forward
  parts.push(rectFill([-0.15, 0.8, 0.08], [0.3, 0, 0], [0, 0.0, 0.09], 0.012));
  parts.push(tube([0, 0.8, 0.12], [0, 0.85, 0.16], 0.035));                 // neck
  parts.push(ellipsoid([0, 0.92, 0.2], [0.07, 0.082, 0.075]));              // head, bowed forward
  // right arm: elbow on left knee, hand to chin
  parts.push(tube([0.17, 0.78, 0.1], [-0.03, 0.54, 0.33], 0.04, 0.035));
  parts.push(tube([-0.03, 0.54, 0.33], [0.0, 0.86, 0.26], 0.035, 0.03));
  // left arm: resting across left thigh
  parts.push(tube([-0.17, 0.78, 0.1], [-0.22, 0.6, 0.22], 0.04, 0.035));
  parts.push(tube([-0.22, 0.6, 0.22], [-0.1, 0.52, 0.33], 0.035, 0.03));
  const out = new Float32Array(n * 3);
  emit(parts, n, rng, out, 0);
  return normaliseHeight(out);
}

/** Stand-in for epicurus.bin: a bearded bust, unit height, facing +Z. */
export function standInBust(n, rng = makeRng(11)) {
  const parts = [];
  parts.push(tube([0, 0.0, 0], [0, 0.42, 0], 0.36, 0.3, 0.5));                // chest up to shoulders
  parts.push(rectFill([-0.3, 0.42, -0.15], [0.6, 0, 0], [0, 0, 0.3], 0.05));  // shoulder top
  parts.push(tube([0, 0.42, 0], [0, 0.56, 0], 0.1, 0.09));                    // neck
  parts.push(ellipsoid([0, 0.76, 0], [0.17, 0.22, 0.19]));                    // head
  parts.push(ellipsoid([0, 0.74, 0.19], [0.035, 0.05, 0.035]));               // nose
  parts.push(ellipsoid([0, 0.6, 0.12], [0.11, 0.1, 0.08]));                   // beard
  const out = new Float32Array(n * 3);
  emit(parts, n, rng, out, 0);
  return normaliseHeight(out);
}

// --------------------------------------------------------------------------- the seven shapes
// Each builder receives { rng, baseCount, formCount, clouds, opts } and
// returns { base: Float32Array(baseCount*3), form: Float32Array(formCount*3) }.

const PLINTH = { foot: [1.12, 0.12, 1.12], shaft: [0.84, 1.0, 0.84], cap: [1.02, 0.13, 1.02] };
export const PLINTH_HEIGHT = PLINTH.foot[1] + PLINTH.shaft[1] + PLINTH.cap[1]; // 1.25

function buildMonument({ rng, baseCount, formCount, clouds }) {
  const base = new Float32Array(baseCount * 3);
  const parts = [];
  let y = 0;
  for (const key of ['foot', 'shaft', 'cap']) {
    const s = PLINTH[key];
    const c = [0, y + s[1] / 2, 0];
    parts.push(boxSurface(c, s));
    parts.push(segments(boxEdgeList(c, s), 0.003, (2 * (s[0] * s[1] + s[1] * s[2] + s[0] * s[2])) * 0.22));
    y += s[1];
  }
  emit(parts, baseCount, rng, base, 0);

  const xf = makeTransform({ pos: [0, PLINTH_HEIGHT, 0] });
  const form = clouds?.thinker
    ? fromCloud(clouds.thinker, formCount, rng, xf)
    : (() => { const f = standInThinker(formCount, rng); for (let i = 0; i < f.length; i += 3) xf(f, i); return f; })();
  return { base, form };
}

function buildEpicurus({ rng, baseCount, formCount, clouds }) {
  // base: the rubble the plinth became — chunks strewn on the ground, plus dust
  const base = new Float32Array(baseCount * 3);
  const parts = [];
  const chunks = 38;
  for (let i = 0; i < chunks; i++) {
    const r = 0.3 + 1.15 * Math.sqrt(rng()), th = rng() * Math.PI * 2;
    const s = [range(rng, 0.07, 0.3), range(rng, 0.05, 0.2), range(rng, 0.07, 0.3)];
    const c = [0, s[1] * 0.32, 0];
    const xf = makeTransform({ yaw: rng() * Math.PI, pitch: gauss(rng) * 0.15, pos: [Math.cos(th) * r, 0, Math.sin(th) * r * 0.75] });
    const surf = boxSurface(c, s), edge = segments(boxEdgeList(c, s), 0.002, surf.w * 0.3);
    parts.push(union([surf, edge], xf));
  }
  const chunkW = parts.reduce((s, p) => s + p.w, 0);
  parts.push({ w: chunkW * 0.3, fn: (rng, out, o) => {
    const r = 1.55 * Math.sqrt(rng()), th = rng() * Math.PI * 2;   // dust, uniform on a disc
    out[o] = Math.cos(th) * r; out[o + 1] = Math.abs(gauss(rng)) * 0.015; out[o + 2] = Math.sin(th) * r * 0.75;
  } });
  emit(parts, baseCount, rng, base, 0);

  const scale = 1.45;
  const xf = makeTransform({ scale, pos: [0, 0.62, 0] });   // raised so the bust sits in the middle of the frame at eye level
  const form = clouds?.epicurus
    ? fromCloud(clouds.epicurus, formCount, rng, xf)
    : (() => { const f = standInBust(formCount, rng); for (let i = 0; i < f.length; i += 3) xf(f, i); return f; })();
  return { base, form };
}

function buildCrowd({ rng, baseCount, formCount, opts }) {
  const count = opts.crowdSize ?? 52;
  // jittered grid layout over the ground, a little denser at the back
  const cols = 9, rows = 6;
  const x0 = -1.85, x1 = 1.85, z0 = -1.15, z1 = 0.8;
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c, r]);
  // drop cells at random until `count` remain
  while (cells.length > count) cells.splice(Math.floor(rng() * cells.length), 1);
  const figures = cells.map(([c, r]) => {
    const cw = (x1 - x0) / cols, rh = (z1 - z0) / rows;
    const x = x0 + (c + 0.5 + (rng() - 0.5) * 0.7) * cw;
    const z = z0 + (r + 0.5 + (rng() - 0.5) * 0.7) * rh;
    const child = rng() < 0.12;
    const h = child ? range(rng, 0.28, 0.34) : range(rng, 0.44, 0.56);
    const pose = pick(rng, ['down', 'down', 'down', 'down', 'down', 'raise', 'point', 'hips']);
    const yaw = gauss(rng) * 0.5;
    return { x, z, h, pose, yaw };
  });

  // form: every figure, points ∝ surface area (∝ h²)
  const form = new Float32Array(formCount * 3);
  const figParts = figures.map((f) => {
    const parts = standingFigure(rng, f.pose);
    const xf = makeTransform({ scale: f.h, yaw: f.yaw, pos: [f.x, 0, f.z] });
    const w = parts.reduce((s, p) => s + p.w, 0) * f.h * f.h;
    return union(parts, xf, w);
  });
  emit(figParts, formCount, rng, form, 0);

  // base: the network — each head wired to its 2 nearest neighbours — over a dotted ground
  const nodes = figures.map((f) => [f.x, f.h * 1.0 + 0.035, f.z]);
  const edges = new Map();
  nodes.forEach((a, i) => {
    const d = nodes.map((b, j) => [j === i ? Infinity : Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), j]).sort((p, q) => p[0] - q[0]);
    for (let k = 0; k < 2; k++) {
      const j = d[k][1];
      edges.set(i < j ? `${i}-${j}` : `${j}-${i}`, [nodes[i], nodes[j]]);
    }
  });
  const base = new Float32Array(baseCount * 3);
  const lines = segments([...edges.values()], 0.0025, 0.78);
  const floorDots = [];
  for (let gx = x0; gx <= x1 + 1e-6; gx += 0.15) for (let gz = z0; gz <= z1 + 1e-6; gz += 0.15) floorDots.push([gx, 0, gz]);
  const floor = { w: 0.22, fn: (rng, out, o) => { const p = pick(rng, floorDots); out[o] = p[0] + gauss(rng) * 0.006; out[o + 1] = 0; out[o + 2] = p[2] + gauss(rng) * 0.006; } };
  emit([lines, floor], baseCount, rng, base, 0);
  // the whole gathering is lifted so it sits in the middle of the frame,
  // a floor of dots and all — a floating floor reads fine in a point cloud
  const CROWD_LIFT = 0.75;
  for (let i = 1; i < base.length; i += 3) base[i] += CROWD_LIFT;
  for (let i = 1; i < form.length; i += 3) form[i] += CROWD_LIFT;
  return { base, form };
}

function buildDevice({ rng, baseCount, formCount }) {
  const W = 0.96, H = 1.56, T = 0.07, bezel = 0.055;
  const centre = [0, 1.17, 0.08], pitch = -0.17; // leans back ~10°
  const xf = makeTransform({ pitch, pos: centre });
  const front = T / 2;
  const sw = W - 2 * bezel, sh = H - 2 * bezel, sx0 = -W / 2 + bezel, sy1 = H / 2 - bezel;
  const bars = [];
  // a few lines of "content" at the top of the screen, ragged right, and a home indicator
  const lineW = [0.62, 0.86, 0.74, 0.4, 0.8, 0.55];
  lineW.forEach((f, i) => bars.push(rectFill([sx0 + sw * 0.09, sy1 - sh * (0.12 + i * 0.075), front + 0.001], [sw * 0.82 * f, 0, 0], [0, sh * 0.028, 0], f)));
  bars.push(rectFill([-sw * 0.16, -H / 2 + bezel + sh * 0.03, front + 0.001], [sw * 0.32, 0, 0], [0, sh * 0.008, 0], 0.25));
  const parts = [
    rectFill([sx0, -H / 2 + bezel, front], [sw, 0, 0], [0, sh, 0], 0.26),                                // the screen, kept sparse — on paper, lit means light
    union(bars, null, 0.14),
    boxSurface([0, 0, 0], [W, H, T], 0.24),                                                               // body (all faces, incl. back)
    segments(boxEdgeList([0, 0, 0], [W, H, T]), 0.002, 0.2),                                              // crisp edges
    segments([                                                                                            // bezel inner edge
      [[-W / 2 + bezel, -H / 2 + bezel, front], [W / 2 - bezel, -H / 2 + bezel, front]],
      [[-W / 2 + bezel, H / 2 - bezel, front], [W / 2 - bezel, H / 2 - bezel, front]],
      [[-W / 2 + bezel, -H / 2 + bezel, front], [-W / 2 + bezel, H / 2 - bezel, front]],
      [[W / 2 - bezel, -H / 2 + bezel, front], [W / 2 - bezel, H / 2 - bezel, front]],
    ], 0.0015, 0.1),
  ];
  const form = new Float32Array(formCount * 3);
  emit(parts, formCount, rng, form, 0, xf);

  // base: right-angled traces on a board behind the slab, emerging from under its edges
  const zb = centre[2] - 0.34;
  const snap = (v) => Math.round(v / 0.05) * 0.05;
  const cx = 0, cy = centre[1], hw = W / 2, hh = H / 2;
  const traceSegs = [], pads = [];
  const nTraces = 38;
  for (let i = 0; i < nTraces; i++) {
    // which edge it leaves from: bottom-heavy
    const u = rng();
    const edge = u < 0.42 ? 'bottom' : u < 0.64 ? 'left' : u < 0.86 ? 'right' : 'top';
    let x, y, dx = 0, dy = 0;
    if (edge === 'bottom') { x = snap(range(rng, -hw + 0.05, hw - 0.05)); y = cy - hh + 0.12; dy = -1; }
    else if (edge === 'top') { x = snap(range(rng, -hw + 0.05, hw - 0.05)); y = cy + hh - 0.12; dy = 1; }
    else { y = snap(range(rng, cy - hh + 0.1, cy + hh - 0.1)); x = (edge === 'left' ? -hw : hw) + (edge === 'left' ? 0.12 : -0.12); dx = edge === 'left' ? -1 : 1; }
    const turns = 2 + Math.floor(rng() * 2);
    for (let t = 0; t <= turns; t++) {
      let len = snap(range(rng, t === 0 ? 0.3 : 0.15, t === 0 ? 0.6 : 0.45));
      let nx = x + dx * len, ny = y + dy * len;
      // stay on the board and above the floor
      nx = Math.max(-1.85, Math.min(1.85, nx));
      ny = Math.max(0.08, Math.min(2.28, ny));
      if (Math.abs(nx - x) > 1e-6 || Math.abs(ny - y) > 1e-6) traceSegs.push([[x, y, zb], [nx, ny, zb]]);
      x = nx; y = ny;
      // turn 90°: keep moving broadly away from the slab
      if (dx !== 0) { dy = (y > cy ? 1 : -1) * (rng() < 0.75 ? 1 : -1); dx = 0; }
      else { dx = (x > cx ? 1 : -1) * (rng() < 0.75 ? 1 : -1); dy = 0; }
    }
    pads.push([x, y]);
  }
  const padSegs = [];
  for (const [px, py] of pads) {
    const s = 0.028;
    padSegs.push([[px - s, py - s, zb], [px + s, py - s, zb]], [[px + s, py - s, zb], [px + s, py + s, zb]], [[px + s, py + s, zb], [px - s, py + s, zb]], [[px - s, py + s, zb], [px - s, py - s, zb]]);
  }
  const base = new Float32Array(baseCount * 3);
  emit([segments(traceSegs, 0.003, 0.8), segments(padSegs, 0.002, 0.2)], baseCount, rng, base, 0);
  return { base, form };
}

function buildUnformed({ rng, baseCount, formCount }) {
  const c = [0, 1.15, 0];
  const parts = [];
  const blobs = 11;
  for (let i = 0; i < blobs; i++) {
    const p = [c[0] + gauss(rng) * 0.5, c[1] + gauss(rng) * 0.36, c[2] + gauss(rng) * 0.3];
    const s = range(rng, 0.1, 0.34);
    parts.push(gaussianBlob(p, [s, s * range(rng, 0.6, 1.1), s * 0.8], s * s * s));
  }
  const blobW = parts.reduce((s, p) => s + p.w, 0);
  parts.push(gaussianBlob(c, [0.62, 0.44, 0.4], blobW * 0.55)); // the diffuse envelope nothing resolves out of
  // a few wisps trailing off
  for (let i = 0; i < 4; i++) {
    const a = [c[0] + gauss(rng) * 0.3, c[1] + gauss(rng) * 0.25, c[2] + gauss(rng) * 0.2];
    const b = [a[0] + gauss(rng) * 1.0, a[1] + gauss(rng) * 0.7, a[2] + gauss(rng) * 0.5];
    const m = [(a[0] + b[0]) / 2 + gauss(rng) * 0.3, (a[1] + b[1]) / 2 + gauss(rng) * 0.3, (a[2] + b[2]) / 2 + gauss(rng) * 0.2];
    parts.push({ w: blobW * 0.07, fn: (rng, out, o) => {
      const t = rng(), it = 1 - t;
      const j = 0.03 + 0.06 * t;
      out[o] = it * it * a[0] + 2 * it * t * m[0] + t * t * b[0] + gauss(rng) * j;
      out[o + 1] = it * it * a[1] + 2 * it * t * m[1] + t * t * b[1] + gauss(rng) * j;
      out[o + 2] = it * it * a[2] + 2 * it * t * m[2] + t * t * b[2] + gauss(rng) * j;
    } });
  }
  const form = new Float32Array(formCount * 3);
  emit(parts, formCount, rng, form, 0);
  // keep the stragglers inside the frame and above the floor (fold, don't clip)
  for (let i = 0; i < form.length; i += 3) {
    if (form[i + 1] < 0.04) form[i + 1] = 0.04 + (0.04 - form[i + 1]) * 0.5;
    if (Math.abs(form[i]) > 2.1) form[i] = Math.sign(form[i]) * (2.1 - (Math.abs(form[i]) - 2.1) * 0.3);
    if (Math.abs(form[i + 2]) > 1.5) form[i + 2] = Math.sign(form[i + 2]) * (1.5 - (Math.abs(form[i + 2]) - 1.5) * 0.3);
  }

  // base: sediment — what has settled out, a thin haze on the ground
  const base = new Float32Array(baseCount * 3);
  emit([{ w: 1, fn: (rng, out, o) => { out[o] = gauss(rng) * 0.85; out[o + 1] = Math.abs(gauss(rng)) * 0.07; out[o + 2] = gauss(rng) * 0.55; } }], baseCount, rng, base, 0);
  return { base, form };
}

function buildPage({ rng, baseCount, formCount, opts }) {
  const W = 1.3, H = 1.76, deskY = 0.26;
  const pitch = -0.21; // leans back ~12°
  const xf = makeTransform({ pitch, pos: [0, deskY, 0.05] });
  const line = opts.pageLine ?? 'I keep coming back to';
  const font = opts.pageFont ?? 'italic 400 120px Georgia, "Times New Roman", serif';
  const text = textEmitter(line, font, Math.ceil(formCount * 0.2), rng, { width: 0.94, bottom: H * 0.82, left: -W / 2 + 0.12, z: 0.002 }, 0.17);
  const cursorX = -W / 2 + 0.12 + text.width + 0.045, cursorBottom = H * 0.82 - 0.015;
  const parts = [
    rectFill([-W / 2, 0, 0], [W, 0, 0], [0, H, 0], 0.62),                                       // the sheet
    segments([[[-W / 2, 0, 0], [W / 2, 0, 0]], [[-W / 2, H, 0], [W / 2, H, 0]], [[-W / 2, 0, 0], [-W / 2, H, 0]], [[W / 2, 0, 0], [W / 2, H, 0]]], 0.002, 0.11),
    text.emitter,
    rectFill([cursorX, cursorBottom, 0.002], [0.016, 0, 0], [0, 0.11, 0], 0.1),                 // the cursor
  ];
  const form = new Float32Array(formCount * 3);
  emit(parts, formCount, rng, form, 0, xf);

  // base: the desk
  const dw = 3.4, dd = 1.2, z0 = -0.6;
  const base = new Float32Array(baseCount * 3);
  emit([
    rectFill([-dw / 2, deskY, z0], [dw, 0, 0], [0, 0, dd], 0.58),
    segments([[[-dw / 2, deskY, z0 + dd], [dw / 2, deskY, z0 + dd]]], 0.003, 0.2),             // front edge
    segments([[[-dw / 2, deskY, z0], [dw / 2, deskY, z0]]], 0.003, 0.07),                      // back edge
    segments([[[-dw / 2, deskY, z0], [-dw / 2, deskY, z0 + dd]], [[dw / 2, deskY, z0], [dw / 2, deskY, z0 + dd]]], 0.003, 0.07),
    rectFill([-dw / 2, deskY - 0.05, z0 + dd], [dw, 0, 0], [0, 0.05, 0], 0.08),                // front face of the top
  ], baseCount, rng, base, 0);
  return { base, form };
}

function buildWordmark({ rng, baseCount, formCount, opts }) {
  const text = opts.wordmarkText ?? 'THE APORIA';
  const font = opts.wordmarkFont ?? '700 220px Georgia, "Times New Roman", serif';
  const width = opts.wordmarkWidth ?? 3.3;
  const bottom = 1.0;
  const t = textEmitter(text, font, formCount, rng, { width, bottom, centre: true }, 1);
  const form = new Float32Array(formCount * 3);
  emit([t.emitter], formCount, rng, form, 0);

  // base: the underline — a hand-ruled line that doesn't quite sit still
  const y = bottom - 0.12, half = width / 2 + 0.02;
  const base = new Float32Array(baseCount * 3);
  emit([{ w: 1, fn: (rng, out, o) => {
    const u = rng();
    const x = -half + u * 2 * half;
    out[o] = x;
    out[o + 1] = y + Math.sin(u * 9.2) * 0.006 + gauss(rng) * 0.0045;
    out[o + 2] = gauss(rng) * 0.003;
  } }], baseCount, rng, base, 0);
  return { base, form };
}

function buildPortal({ rng, baseCount, formCount }) {
  // base: the underline rises and becomes the ring — an annulus at eye level
  // with a loose halo. Base particles take the accent at full strength, so the
  // ring burns in the orange.
  const ring = { w: 0.82, fn: (rng, out, o) => {
    const th = rng() * Math.PI * 2;
    const inner = rng() < 0.7;
    const r = inner ? PORTAL.r + (rng() - 0.5) * 0.045 : PORTAL.r + 0.02 + Math.abs(gauss(rng)) * 0.1;
    out[o] = PORTAL.x + Math.cos(th) * r;
    out[o + 1] = PORTAL.y + Math.sin(th) * r;
    out[o + 2] = PORTAL.z + gauss(rng) * (inner ? 0.01 : 0.06);
  } };
  const sparks = { w: 0.18, fn: (rng, out, o) => {
    const t = rng();
    const th = t * Math.PI * 2.6 + (rng() < 0.5 ? 0 : Math.PI) + gauss(rng) * 0.12;
    const r = PORTAL.r * (1.05 + t * 1.2);
    out[o] = PORTAL.x + Math.cos(th) * r;
    out[o + 1] = PORTAL.y + Math.sin(th) * r * 0.9;
    out[o + 2] = PORTAL.z + gauss(rng) * 0.08 * (0.4 + t);
  } };
  const base = new Float32Array(baseCount * 3);
  emit([ring, sparks], baseCount, rng, base, 0);

  // form: most letters fall into a heap on the ground; the rest wind into a
  // vortex filling the ring — three arms, denser at the centre. The shader
  // spins it differentially (uSwirl), so the arms wind up as you watch.
  const ARMS = 3;
  const swirl = { w: 0.4, fn: (rng, out, o) => {
    const u = rng();
    const r = PORTAL.r * 0.94 * Math.pow(u, 0.62);
    const arm = Math.floor(rng() * ARMS) * (Math.PI * 2 / ARMS);
    const th = arm - 4.6 * (r / PORTAL.r) + gauss(rng) * (0.16 + 0.5 * (1 - u));
    out[o] = PORTAL.x + Math.cos(th) * r;
    out[o + 1] = PORTAL.y + Math.sin(th) * r;
    out[o + 2] = PORTAL.z + gauss(rng) * 0.035 * (0.3 + u);
  } };
  const heap = { w: 0.6, fn: (rng, out, o) => {
    const x = gauss(rng) * 1.05;
    const top = Math.max(0, 0.26 * (1 - Math.abs(x) / 1.7));
    out[o] = x;
    out[o + 1] = Math.abs(gauss(rng)) * 0.35 * top + rng() * rng() * top * 0.6;
    out[o + 2] = gauss(rng) * 0.28;
  } };
  const form = new Float32Array(formCount * 3);
  emit([heap, swirl], formCount, rng, form, 0);
  return { base, form };
}

/**
 * Lens shapes, by name. To add an Issue 04 with a NEW shape, add a builder
 * here (base = the thing underneath, form = the thing itself, see the top of
 * this file) and name it in the cover's data-shape. An issue can also reuse
 * an existing lens shape.
 */
export const LENS_BUILDERS = { crowd: buildCrowd, device: buildDevice, unformed: buildUnformed };
const buildersFor = (lenses) => [buildMonument, buildEpicurus, ...lenses.map((n) => {
  if (!LENS_BUILDERS[n]) throw new Error(`shapes: unknown lens shape "${n}" (have: ${Object.keys(LENS_BUILDERS).join(', ')})`);
  return LENS_BUILDERS[n];
}), buildPage, buildWordmark, buildPortal];

// --------------------------------------------------------------------------- public API

/**
 * Build all seven shapes.
 * @param {number} count  total particles; every returned array is exactly count*3 long
 * @param {object} [opts]
 * @param {{thinker?: Float32Array|null, epicurus?: Float32Array|null}} [opts.clouds]  from loadAllClouds(); nulls → stand-ins
 * @param {number} [opts.seed]
 * @param {string} [opts.wordmarkText]  default 'THE APORIA'
 * @param {string} [opts.wordmarkFont]  CSS font for the wordmark canvas
 * @param {number} [opts.wordmarkWidth] world units, default 3.3
 * @param {string} [opts.pageLine]      the half-written line, default 'I keep coming back to'
 * @param {string} [opts.pageFont]
 * @param {number} [opts.crowdSize]     default 52
 * @param {string[]} [opts.lenses]      lens shape names in issue order, default DEFAULT_LENSES
 * @returns {{ shapes: Float32Array[], names: string[], baseCount: number, formCount: number, count: number, usedStandIn: {thinker: boolean, epicurus: boolean} }}
 */
export function buildAllShapes(count, opts = {}) {
  const lenses = opts.lenses ?? DEFAULT_LENSES;
  const names = shapeNamesFor(lenses);
  const out = [];
  for (let i = 0; i < names.length; i++) out.push(buildShape(i, count, { ...opts, lenses }));
  const { baseCount, formCount } = splitCount(count);
  return {
    shapes: out,
    names,
    lenses: [...lenses],
    baseCount, formCount, count,
    usedStandIn: { thinker: !opts.clouds?.thinker, epicurus: !opts.clouds?.epicurus },
  };
}

/** Build one shape by index (0–6) or name. Same contract as buildAllShapes for that entry. */
export function buildShape(which, count, opts = {}) {
  const lenses = opts.lenses ?? DEFAULT_LENSES;
  const names = shapeNamesFor(lenses);
  const builders = buildersFor(lenses);
  const i = typeof which === 'number' ? which : names.indexOf(which);
  if (!builders[i]) throw new Error(`shapes: unknown shape ${which}`);
  const { baseCount, formCount } = splitCount(count);
  const rng = makeRng((opts.seed ?? DEFAULT_SEED) + i * 7919);
  const { base, form } = builders[i]({ rng, baseCount, formCount, clouds: opts.clouds ?? {}, opts });
  if (base.length !== baseCount * 3 || form.length !== formCount * 3) throw new Error(`shapes: ${names[i]} returned the wrong point count`);
  const all = new Float32Array(count * 3);
  all.set(rasterOrder(base), 0);
  all.set(rasterOrder(form), baseCount * 3);
  return all;
}

export function splitCount(count) {
  const baseCount = Math.round(count * BASE_SHARE);
  return { baseCount, formCount: count - baseCount };
}
