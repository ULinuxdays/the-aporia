/**
 * js/knot/rope.js — the shape of the knot, and how it moves. No DOM, no drawing.
 *
 * Two closed loops in a 1000-unit box centred on the weave, traced from
 * assets/logo.png. Loop 0 runs top left to bottom right, loop 1 bottom left to
 * top right, and they pass over, under, over, under, so they can be pulled into
 * a line but never apart.
 *
 * A POSE is where the loops rest at a given t (0 tied, 1 pulled out). The ROPE
 * is the pose plus a displacement per point, D, which springs back to nothing:
 * everything a visitor's hand does is a change to D. CONTRACTS.md §18.
 */

export const N = 200;                       // points per loop
export const LOOPS = 2;

// Half the gap between a loop's two strands; then per loop, half the width of a
// strand and how far its bends are drawn out (1 is a half circle). As in the
// logo, loop 0 is wide, with only a slit inside it, and loop 1 is a narrower belt.
const TIED = { half: 137, rad: [127, 101], bend: [1, 1.62] };
const OPEN = { half: 62, rad: [52, 46], bend: [1, 1.5] };
export const LOBE = 212;                    // a lobe's centre, from the middle of the knot, tied
export const ARM = 150;                     // how far off the axis the pulled arms lie
export const FOOT = 132;                    // a small lobe's centre, pulled
export const REACH = LOBE + TIED.half + TIED.rad[0];     // half the tied knot, edge to edge
export const ARM_WIDTH = OPEN.half + OPEN.rad[0];        // half an arm, pulled
export const FOOT_WIDTH = OPEN.half + OPEN.rad[0];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ the spine
// The line down the middle of a loop, sampled from its arm's end to the weave
// (NA samples) and on to its small lobe (NB). Tied, it is a straight diagonal.
// Pulled, a straight arm that turns into the same diagonal through the weave.

const NA = 72, NB = 26, NS = NA + NB + 1;

function sampleByLength(pts, count, out) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = L[L.length - 1];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = total * i / count;
    while (j < pts.length - 2 && L[j + 1] < s) j++;
    const f = (s - L[j]) / (L[j + 1] - L[j] || 1);
    out.push([mix(pts[j][0], pts[j + 1][0], f), mix(pts[j][1], pts[j + 1][1], f)]);
  }
}

function openSpine(far, tall) {
  const pts = [], bend = Math.min(330, far * 0.62);
  for (let i = 0; i <= 40; i++) pts.push([mix(-far, -bend, i / 40), -ARM]);
  // a level line easing into the 45° line through the weave
  const a = [-bend, -ARM], d = [-74, -74], h = (bend - ARM) * 0.62, g = 46;
  const b = [a[0] + h, a[1]], c = [d[0] - g, d[1] - g];
  for (let i = 1; i <= 60; i++) {
    const s = i / 60, r = 1 - s;
    pts.push([0, 1].map((n) => r * r * r * a[n] + 3 * r * r * s * b[n] + 3 * r * s * s * c[n] + s * s * s * d[n]));
  }
  for (let i = 1; i <= 8; i++) pts.push([mix(-74, 0, i / 8), mix(-74, 0, i / 8)]);
  const out = [];
  sampleByLength(pts, NA, out);
  for (let i = 0; i <= NB; i++) out.push([FOOT * i / NB, FOOT * i / NB]);
  return tall ? out.map(([x, y]) => [y, x]) : out;
}

function tiedSpine() {
  const out = [];
  for (let i = 0; i < NA; i++) out.push([mix(-LOBE, 0, i / NA), mix(-LOBE, 0, i / NA)]);
  for (let i = 0; i <= NB; i++) out.push([LOBE * i / NB, LOBE * i / NB]);
  return out;
}

// over and under: a strand's height by its distance along from the weave's centre
function weave(u, w) {
  const a = Math.abs(u) / w, s = a <= 1 ? Math.sin(Math.PI / 2 * a) : 1;
  return u < 0 ? -s : s;
}

// ------------------------------------------------------------------- the rope

export class Rope {
  constructor() {
    const n = LOOPS * N, f = () => new Float32Array(n);
    this.px = f(); this.py = f();           // the pose, in units
    this.pz = f();                          // over (1) and under (-1)
    this.side = f();                        // which strand: 1, -1, and between them round a bend
    this.turn = f();                        // how far round a bend: the sine that goes with that cosine
    this.u = f();                           // signed distance along the strand from the weave
    this.dx = f(); this.dy = f();           // D
    this.vx = f(); this.vy = f();
    this.fx = f(); this.fy = f();
    this.lift = f();                        // raised towards the viewer where it is held
    this.fat = f().fill(1);                 // thinner where it is stretched
    this.restLen = [1, 1];
    this.ends = [1, 1, 1, 1];               // how far each lobe's end is from the weave: loop 0 arm, foot, loop 1 arm, foot
    this.tips = [0, 0, 0, 0];               // and which point is that end
    this.cross = [];
    this.t = NaN; this.far = 0; this.tall = false;
    this.cx = 0; this.cy = 0; this.sc = 1;  // units to css pixels
    this.grab = null;
    this.tied = tiedSpine();
    this.sp = this.tied.map((p) => p.slice());
    this.half = TIED.half; this.rad = TIED.rad.slice();
  }

  /** how far the arms reach (units), and whether they stand upright */
  layout(far, tall) {
    if (far === this.far && tall === this.tall) return;
    this.far = far; this.tall = tall;
    this.opened = openSpine(far, tall);
    this.t = NaN;
  }

  setPose(t) {
    if (t === this.t) return;
    this.t = t;
    const half = this.half = mix(TIED.half, OPEN.half, t);
    this.rad = [0, 1].map((l) => mix(TIED.rad[l], OPEN.rad[l], t));
    for (let i = 0; i < NS; i++) {
      this.sp[i][0] = mix(this.tied[i][0], this.opened[i][0], t);
      this.sp[i][1] = mix(this.tied[i][1], this.opened[i][1], t);
    }
    this.outline(0, half, mix(TIED.bend[0], OPEN.bend[0], t));
    this.outline(1, half, mix(TIED.bend[1], OPEN.bend[1], t));
    // Loop 1 is drawn on the same spine and mirrored, side to side when the arms
    // are level and top to bottom when they are upright. Mirrored, its over and
    // under swap, which is what makes the weave. Upright it is also turned half
    // way round the loop, so that tied, point i is in the same place in both
    // layouts and turning a phone does not spin the loop.
    for (let j = N; j < 2 * N; j++) {
      if (this.tall) this.py[j] = -this.py[j]; else this.px[j] = -this.px[j];
      this.pz[j] = -this.pz[j];
      this.turn[j] = -this.turn[j];
    }
    if (this.tall) {
      for (const a of [this.px, this.py, this.pz, this.side, this.turn, this.u]) {
        const b = a.slice(N, N + N / 2); a.copyWithin(N, N + N / 2, 2 * N); a.set(b, N + N / 2);
      }
    }
    this.findCrossings(half);
    for (let l = 0; l < LOOPS; l++) {
      let lo = l * N, hi = l * N;
      for (let i = l * N; i < (l + 1) * N; i++) { if (this.u[i] < this.u[lo]) lo = i; if (this.u[i] > this.u[hi]) hi = i; }
      this.tips[l * 2] = lo; this.tips[l * 2 + 1] = hi;
      this.ends[l * 2] = -this.u[lo]; this.ends[l * 2 + 1] = this.u[hi];
    }
  }

  /** one loop: the outline of a capsule bent along the spine, resampled evenly */
  outline(loop, w, bend) {
    const S = this.sp, n = NS, CAP = 64, out = [];
    const L = new Float64Array(n), tx = new Float64Array(n), ty = new Float64Array(n);
    for (let i = 1; i < n; i++) L[i] = L[i - 1] + Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]);
    const lc = L[NA];
    for (let i = 0; i < n; i++) {
      const p = S[Math.max(0, i - 1)], r = S[Math.min(n - 1, i + 1)], l = Math.hypot(r[0] - p[0], r[1] - p[1]) || 1;
      tx[i] = (r[0] - p[0]) / l; ty[i] = (r[1] - p[1]) / l;
    }
    const add = (x, y, side, u) => out.push(x, y, -side * weave(u, w), side, u);
    for (let i = 0; i < n; i++) add(S[i][0] + ty[i] * w, S[i][1] - tx[i] * w, 1, L[i] - lc);
    const cap = (e, dir) => {
      for (let j = 1; j < CAP; j++) {
        const a = Math.PI * j / CAP, c = Math.cos(a), s = Math.sin(a) * bend;
        add(S[e][0] + dir * (ty[e] * c + tx[e] * s) * w, S[e][1] + dir * (-tx[e] * c + ty[e] * s) * w, dir * c, L[e] - lc + dir * w * s);
      }
    };
    cap(n - 1, 1);
    for (let i = n - 1; i >= 0; i--) add(S[i][0] - ty[i] * w, S[i][1] + tx[i] * w, -1, L[i] - lc);
    cap(0, -1);

    const m = out.length / 5, C = new Float64Array(m + 1);
    for (let i = 1; i <= m; i++) { const a = (i % m) * 5, b = (i - 1) * 5; C[i] = C[i - 1] + Math.hypot(out[a] - out[b], out[a + 1] - out[b + 1]); }
    const o = loop * N;
    let at = 0;
    for (let i = 0; i < N; i++) {
      const s = C[m] * i / N;
      while (C[at + 1] < s) at++;
      const f = (s - C[at]) / (C[at + 1] - C[at] || 1), a = at * 5, b = ((at + 1) % m) * 5, j = o + i;
      this.px[j] = mix(out[a], out[b], f);
      this.py[j] = mix(out[a + 1], out[b + 1], f);
      this.pz[j] = mix(out[a + 2], out[b + 2], f);
      this.side[j] = mix(out[a + 3], out[b + 3], f);
      this.u[j] = mix(out[a + 4], out[b + 4], f);
      this.turn[j] = Math.sign(this.u[j]) * Math.sqrt(Math.max(0, 1 - this.side[j] ** 2));
    }
    this.restLen[loop] = C[m] / N;
  }

  /** the four crossings, as pairs of points, one on each loop */
  findCrossings(half) {
    this.cross.length = 0;
    for (const [s, u] of [[1, -1], [1, 1], [-1, 1], [-1, -1]]) {
      let a = 0, ad = 1e9;
      for (let i = 0; i < N; i++) { const d = Math.abs(this.u[i] - u * half) + Math.abs(this.side[i] - s) * 400; if (d < ad) { ad = d; a = i; } }
      let b = N, bd = 1e9;
      for (let i = N; i < 2 * N; i++) { const d = Math.hypot(this.px[i] - this.px[a], this.py[i] - this.py[a]); if (d < bd) { bd = d; b = i; } }
      this.cross.push([a, b]);
    }
  }

  /** which end a point belongs to: 0 loop 0's arm, 1 its foot, 2 loop 1's arm, 3 its foot */
  endOf(i) { return (i < N ? 0 : 2) + (this.u[i] < 0 ? 0 : 1); }

  x(i) { return this.cx + (this.px[i] + this.dx[i]) * this.sc; }
  y(i) { return this.cy + (this.py[i] + this.dy[i]) * this.sc; }

  /** change the layout but keep every point where it is on screen: D takes up
      the difference, and the springs carry the rope across */
  carry(change) {
    const n = this.px.length, x = new Float32Array(n), y = new Float32Array(n);
    for (let i = 0; i < n; i++) { x[i] = this.x(i); y[i] = this.y(i); }
    change();
    for (let i = 0; i < n; i++) {
      this.dx[i] = (x[i] - this.cx) / this.sc - this.px[i];
      this.dy[i] = (y[i] - this.cy) / this.sc - this.py[i];
    }
  }

  // ---------------------------------------------------------------- physics
  // Displacement travels along a strand (kc) and through the four crossings
  // (kx), and springs back to the pose (ks). Run in fixed steps, so it feels the
  // same at 60 and 120 Hz.

  step(h) {
    const { dx, dy, vx, vy, fx, fy, grab } = this;
    const held = grab ? grab.hold : 0;
    const ks = mix(44, 12, held), c = mix(6.4, 10, held), kc = 24000, ci = 26, kx = 5200;
    for (let l = 0; l < LOOPS; l++) {
      const o = l * N;
      for (let i = 0; i < N; i++) {
        const j = o + i, a = o + (i + N - 1) % N, b = o + (i + 1) % N;
        fx[j] = -ks * dx[j] - c * vx[j] + kc * (dx[a] + dx[b] - 2 * dx[j]) + ci * (vx[a] + vx[b] - 2 * vx[j]);
        fy[j] = -ks * dy[j] - c * vy[j] + kc * (dy[a] + dy[b] - 2 * dy[j]) + ci * (vy[a] + vy[b] - 2 * vy[j]);
      }
    }
    for (const [a, b] of this.cross) {
      const gx = kx * (dx[b] - dx[a]), gy = kx * (dy[b] - dy[a]);
      fx[a] += gx; fy[a] += gy; fx[b] -= gx; fy[b] -= gy;
    }
    for (let j = 0; j < dx.length; j++) {
      vx[j] += fx[j] * h; vy[j] += fy[j] * h;
      dx[j] += vx[j] * h; dy[j] += vy[j] * h;
    }
    if (grab && held > 0) {
      const o = grab.j < N ? 0 : N, i0 = grab.j - o, soft = 0.16 * held;
      for (let w = -12; w <= 12; w++) {
        const j = o + (i0 + w + N) % N, q = Math.exp(-w * w / 60);
        dx[j] += (grab.x - dx[j]) * q * soft; dy[j] += (grab.y - dy[j]) * q * soft;
        vx[j] *= 1 - 0.5 * q * held; vy[j] *= 1 - 0.5 * q * held;
      }
    }
  }

  /** a gentle pull on the points round j, towards a displacement of (x, y) units */
  tug(j, x, y, amount) {
    const o = j < N ? 0 : N, i0 = j - o;
    for (let w = -14; w <= 14; w++) {
      const k = o + (i0 + w + N) % N, q = Math.exp(-w * w / 70) * amount;
      this.dx[k] += (x - this.dx[k]) * q; this.dy[k] += (y - this.dy[k]) * q;
    }
  }

  /** strands thin out where they are stretched, and rise where they are held */
  settle(liftAt, liftBy) {
    const K = 9, span = 2 * K + 1, len = this.len || (this.len = new Float32Array(N));
    for (let l = 0; l < LOOPS; l++) {
      const o = l * N;
      for (let i = 0; i < N; i++) {
        const a = o + i, b = o + (i + 1) % N;
        len[i] = Math.hypot(this.px[b] + this.dx[b] - this.px[a] - this.dx[a], this.py[b] + this.dy[b] - this.py[a] - this.dy[a]);
      }
      let sum = 0;
      for (let w = -K; w <= K; w++) sum += len[(w + N) % N];
      for (let i = 0; i < N; i++) {
        this.fat[o + i] = clamp(Math.sqrt(this.restLen[l] / (sum / span)), 0.62, 1.06);
        sum += len[(i + K + 1) % N] - len[(i - K + N) % N];
      }
    }
    this.lift.fill(0);
    if (liftBy > 0.001) {
      const o = liftAt < N ? 0 : N, i0 = liftAt - o, r = this.rad[o ? 1 : 0];
      for (let w = -40; w <= 40; w++) this.lift[o + (i0 + w + N) % N] = liftBy * r * 1.3 * Math.exp(-w * w / 500);
    }
  }

  /** how much is still moving, in units */
  energy() {
    let e = 0;
    for (let i = 0; i < this.dx.length; i++) e = Math.max(e, Math.abs(this.dx[i]) + Math.abs(this.dy[i]) + 0.05 * (Math.abs(this.vx[i]) + Math.abs(this.vy[i])));
    return e;
  }
}
