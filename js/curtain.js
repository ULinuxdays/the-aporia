/**
 * js/curtain.js — the grain curtain that carries you between the two pages.
 *
 * One diagonal edge, travelling bottom-left → top-right, with a fringe of
 * grains riding on it. Both pages draw the SAME curtain from the same seed:
 *
 *   landing page   draw(p, 'cover')    fills BEHIND the edge; at p = 1 the
 *                                      viewport is solid — that is when the
 *                                      page changes, so the cut is invisible.
 *   shelf page     draw(p, 'uncover')  fills AHEAD of the edge; at p = 0 the
 *                                      viewport is still solid, and the same
 *                                      edge carries on in the same direction,
 *                                      uncovering the room behind it.
 *
 * It is a 2D canvas, not WebGL: at the moment of the hand-over the screen is
 * covered, so what matters is that both halves move alike, not that individual
 * grains match. Costs nothing on the shelf page, which has its own renderer.
 */

const DEFAULTS = {
  dir: [0.78, -0.62],          // canvas coords (y down): right and up
  seed: 20260821,
  grains: 1400,
  grain: '236, 229, 214',      // marble
  ground: '10, 9, 11',         // the ground it leaves behind
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createCurtain(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const len = Math.hypot(o.dir[0], o.dir[1]) || 1;
  const d = [o.dir[0] / len, o.dir[1] / len];
  const perp = [-d[1], d[0]];

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed', left: '0', top: '0', width: '100%', height: '100%',
    zIndex: '2147483000', pointerEvents: 'none', display: 'none',
  });
  const ctx = canvas.getContext('2d');

  const rnd = mulberry32(o.seed);
  const pts = [];
  for (let i = 0; i < o.grains; i++) {
    pts.push({
      a: Math.pow(rnd(), 0.55),               // distance from the edge, crowded near it
      b: rnd(),                               // position across the edge
      r: 0.18 + rnd() * rnd() * 1.0,          // size
      o: 0.35 + rnd() * 0.65,                 // opacity
      back: rnd() < 0.34,                     // a third of them sit inside the fill
    });
  }

  let W = 0, H = 0, dpr = 1, geom = null;

  function measure() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const corners = [[0, 0], [W, 0], [0, H], [W, H]];
    const s = corners.map((c) => c[0] * d[0] + c[1] * d[1]);
    const q = corners.map((c) => c[0] * perp[0] + c[1] * perp[1]);
    const smin = Math.min(...s), smax = Math.max(...s);
    const span = smax - smin;
    geom = { smin, smax, span, qmin: Math.min(...q) - 40, qmax: Math.max(...q) + 40, fringe: span * 0.26 };
  }

  /**
   * @param {number} p 0..1
   * @param {'cover'|'uncover'} mode
   */
  function draw(p, mode) {
    if (!geom || W !== innerWidth || H !== innerHeight) measure();
    const { smin, span, qmin, qmax, fringe } = geom;
    const cover = mode !== 'uncover';
    const t = Math.min(1, Math.max(0, p));
    const edge = smin - fringe + t * (span + fringe * 2);
    const away = cover ? -1 : 1;                 // which side of the edge is solid

    ctx.clearRect(0, 0, W, H);

    // the solid ground behind (or ahead of) the edge, with a soft gradient lip
    const lip = span * 0.06;
    const solid = edge + away * lip;
    const poly = (from, to) => {
      const A = [d[0] * from + perp[0] * qmin, d[1] * from + perp[1] * qmin];
      const B = [d[0] * from + perp[0] * qmax, d[1] * from + perp[1] * qmax];
      const C = [B[0] + d[0] * (to - from), B[1] + d[1] * (to - from)];
      const D = [A[0] + d[0] * (to - from), A[1] + d[1] * (to - from)];
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.lineTo(D[0], D[1]); ctx.closePath(); ctx.fill();
    };
    ctx.fillStyle = `rgb(${o.ground})`;
    poly(solid, solid + away * span * 2.2);

    const g0 = [d[0] * solid, d[1] * solid];
    const g1 = [d[0] * edge, d[1] * edge];
    const grad = ctx.createLinearGradient(g0[0], g0[1], g1[0], g1[1]);
    grad.addColorStop(0, `rgba(${o.ground}, 1)`);
    grad.addColorStop(1, `rgba(${o.ground}, 0)`);
    ctx.fillStyle = grad;
    poly(solid, edge);

    // the grains riding on the edge
    const base = Math.max(W, H);
    for (let i = 0; i < pts.length; i++) {
      const g = pts[i];
      const off = (g.back ? -1 : 1) * away * -g.a * fringe;   // most ahead of the edge, some inside
      const s = edge + off;
      const q = qmin + g.b * (qmax - qmin);
      const x = d[0] * s + perp[0] * q;
      const y = d[1] * s + perp[1] * q;
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
      const fade = g.back ? 1 : 1 - g.a * 0.92;
      const alpha = g.o * fade;
      if (alpha <= 0.01) continue;
      const r = 1.5 + g.r * base * 0.012;
      ctx.fillStyle = `rgba(${g.back ? o.ground : o.grain}, ${alpha.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  return {
    canvas,
    /** Attach and show. Draws the given start state before it is ever visible. */
    show(p, mode) {
      if (!canvas.parentNode) document.body.appendChild(canvas);
      measure();
      draw(p, mode);
      canvas.style.display = 'block';
    },
    draw,
    hide() { canvas.style.display = 'none'; },
    dispose() { canvas.remove(); },
  };
}
