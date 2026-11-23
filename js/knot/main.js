/**
 * js/knot/main.js — the landing page. CONTRACTS.md §18.
 *
 * One number runs the page: k, how far the knot is pulled out (0 tied, 1 in a
 * line). It follows, on a spring, whichever is further: the scroll, or the
 * knot having been pulled (or its button pressed). While someone holds the rope,
 * how hard they pull is shown, and k stretches a little with it, until it gives.
 * Everything else (the rope, the menu round it, the name, the red pen) is laid
 * out from k on each frame.
 *
 *   rope.js   the shape and the springs    paint.js   WebGL2, the drawing
 */

import { Rope, N, REACH, ARM, FOOT, ARM_WIDTH, FOOT_WIDTH } from './rope.js';

import { createPainter } from './paint.js';

const html = document.documentElement;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

const stage = $('stage'), ui = $('ui'), cv = $('rope'), hint = $('hint'), hintText = $('hint-text');
const title = $('title'), masthead = $('masthead'), meter = $('meter'), menu = $('menu');
const grips = [$('grip-0'), $('grip-1')];
const ghosts = [$('ghost-0'), $('ghost-1')], trails = [$('trail-0'), $('trail-1')], cursor = $('cursor');
const cursorFill = cursor.querySelector('.cursor__fill');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const lobes = {};
for (const el of document.querySelectorAll('.lobe')) lobes[el.dataset.lobe] = el;

function fallback(why) {
  html.classList.remove('live');
  html.classList.add('fallback');
  html.dataset.fallback = why;
}

let painter = null;
try { painter = createPainter(cv); } catch (e) { console.warn('[knot]', e); }
if (!painter) fallback('no WebGL2');
else if (styled()) start();
else {
  // Safari can run this before css/knot.css has applied, and would measure an
  // unstyled page. Wait for it.
  let started = false;
  const go = () => { if (!started && styled()) { started = true; start(); } };
  for (const l of document.querySelectorAll('link[rel=stylesheet]')) l.addEventListener('load', go);
  addEventListener('load', () => { go(); if (!started) fallback('the page has no styles'); });
}
function styled() { return getComputedStyle(stage).position === 'fixed'; }

function start() {
  if (still) html.classList.add('still-motion');
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const rope = new Rope();
  let W = 0, H = 0, CH = 0, tall = false, short = false, dpr = 1;
  let C0 = [0, 0], C1 = [0, 0], run = 1;

  // which lobe of the knot is which item: the ends of the loops, by layout
  // (rope.endOf: 0 loop 0's arm, 1 its foot, 2 loop 1's arm, 3 its foot)
  const LOBE_OF_END = () => (tall ? ['tl', 'br', 'bl', 'tr'] : ['tl', 'br', 'tr', 'bl']);
  const live = (key) => lobes[key] && lobes[key].tagName === 'A';

  // ---------------------------------------------------------------- layout
  function size(first) {
    W = stage.clientWidth; CH = stage.clientHeight; H = ui.clientHeight;
    const wasTall = tall;
    tall = H > W * 1.15; short = H < 460;
    html.classList.toggle('tall', tall);
    // the same sums as --box in css/knot.css
    const box = tall ? Math.min(W * 0.88, H * 0.54) : Math.min(W * 0.6, H - (short ? 96 : 150));
    const sc = box / (2 * REACH);
    C0 = [W / 2, H / 2];
    let far;
    if (tall) {
      C1 = [W * 0.4, H * 0.56];
      const top = Math.max(H * 0.2, 126), bottom = Math.max(H * 0.12, 84);
      far = Math.min(C1[1] - top, H - bottom - C1[1]) / sc - ARM_WIDTH;
    } else {
      C1 = [W / 2, H * (short ? 0.53 : 0.585)];
      far = (W / 2 - Math.max(18, W * 0.03)) / sc - ARM_WIDTH;
    }
    far = Math.max(far, 330);
    const apply = () => { rope.sc = sc; rope.layout(far, tall); rope.setPose(clamp(k, -0.08, 1.08)); centre(); };
    if (first) apply(); else rope.carry(apply);
    if (wasTall !== tall && !first) for (const el of Object.values(lobes)) el.style.transform = '';
    run = H * 0.8 * 0.97;
    // The screen's own sharpness, up to 3 (a phone's canvas is small), within
    // about 6 million pixels. A slow device may step down from there, but never
    // below 2 on a sharp screen: at 1 the ribbon's edges step and its grain
    // goes to blocks.
    const ratio = Math.min(3, window.devicePixelRatio || 1, Math.sqrt(6e6 / Math.max(1, W * CH)));
    dprFloor = Math.min(ratio, 2); dprTop = ratio;
    dpr = Math.max(dprFloor, Math.min(ratio, dprCap));
    painter.resize(W, CH, dpr);
    // the grain keeps its size against the knot, not against the screen
    painter.look.grain = clamp(1.5 * sc / 0.68, 0.75, 1.5);
    measured = false;
    dirty = true;
  }
  let dprCap = 3, dprFloor = 1, dprTop = 1, measured = false;

  function centre() {
    const e = smooth(0, 1, clamp(k, 0, 1));
    rope.cx = mix(C0[0], C1[0], e); rope.cy = mix(C0[1], C1[1], e);
  }

  // ---------------------------------------------------------------- state
  let k = 0, kv = 0;                      // how far it is pulled out, and how fast that is changing
  let menuOn = false;
  let open = 0;                           // pulled out by hand or by the button
  let grab = null, hot = -1, touched = false, lastTouch = performance.now();
  const glow = [0, 0, 0, 0];               // per end of a loop, as rope.endOf numbers them
  let light = [-0.42, -0.62, 0.66], aim = light.slice();
  let dirty = true;

  const scrollK = () => (still ? 0 : clamp(scrollY / run, 0, 1));
  const tiedNow = () => Math.max(open, scrollK()) < 0.5;

  function setOpen(v, how) {
    open = v ? 1 : 0;
    if (!open && scrollY > 2) scrollTo({ top: 0, behavior: still || how === 'jump' ? 'auto' : 'smooth' });
    if (open && !still) kv += 2.2;       // a kick: it springs out rather than slides
    dirty = true;
  }
  // Once it is out, the scroll says so too: the page sits at its end, so scrolling
  // back up ties it again. Nothing on screen moves, the canvas is fixed.
  let fingers = 0;
  addEventListener('touchstart', (e) => { fingers = e.touches.length; }, { passive: true, capture: true });
  addEventListener('touchend', (e) => { fingers = e.touches.length; }, { passive: true, capture: true });
  addEventListener('touchcancel', () => { fingers = 0; }, { passive: true, capture: true });
  function holdOpenByScroll() {
    if (!open || still || grab || fingers) return;
    if (Math.abs(k - 1) > 0.003 || Math.abs(kv) > 0.02) return;      // once it has finished springing out
    if (scrollY < run) scrollTo({ top: Math.ceil(run) + 1, behavior: 'auto' });
    open = 0;
  }

  // ---------------------------------------------------------------- input
  function local(e) { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  // the rope point under p (topmost where strands cross), or null
  function hit(p, slack = 1) {
    let best = -1, bz = -9, bd = 1e9;
    for (let j = 0; j < 2 * N; j++) {
      const r = rope.rad[j < N ? 0 : 1] * rope.sc * rope.fat[j] * slack;
      const d = Math.hypot(p[0] - rope.x(j), p[1] - rope.y(j));
      if (d > r) continue;
      const z = rope.pz[j] + rope.lift[j] / 40;
      if (best < 0 || z > bz + 0.35 || (Math.abs(z - bz) <= 0.35 && d < bd)) { best = j; bz = z; bd = d; }
    }
    return best < 0 ? null : best;
  }
  function onGrip(p) {
    if (!tiedNow()) return -1;
    for (let g = 0; g < 2; g++) {
      if (+grips[g].style.opacity < 0.2) continue;
      const j = gripPoint(g);
      if (Math.hypot(p[0] - rope.x(j), p[1] - rope.y(j)) < 30) return j;
    }
    return -1;
  }

  function grabAt(p, touch) {
    const g = onGrip(p), j = g >= 0 ? g : hit(p);
    if (j === null) return false;
    const out = norm(rope.x(j) - rope.cx, rope.y(j) - rope.cy);
    grab = {
      j, touch, p0: p, p: p, x: rope.dx[j], y: rope.dy[j], hold: 0, far: 0, tension: 0, gave: false, letGo: false,
      at: [rope.x(j), rope.y(j)], out, wasOpen: !tiedNow(), grip: g >= 0,
    };
    rope.grab = grab;
    stage.classList.add('has');
    meter.classList.toggle('touch', !!touch);
    touched = true; lastTouch = performance.now();
    return true;
  }

  function pull(p) {
    grab.p = p;
    const dx = p[0] - grab.p0[0], dy = p[1] - grab.p0[1], d = Math.hypot(dx, dy);
    grab.far = Math.max(grab.far, d);
    // how hard: away from the middle counts in full, any other way a bit over half
    const along = d ? (dx * grab.out[0] + dy * grab.out[1]) / d : 0;
    const L = REACH * rope.sc * 0.5;
    grab.tension = clamp(d * (0.56 + 0.44 * Math.max(0, along)) / L, 0, 1.2);
    grab.along = along;
    if (!grab.gave && grab.tension >= 1) give();
    lastTouch = performance.now();
  }
  // where the held point is asked to be: the pointer, with growing resistance
  function holdTarget() {
    const dx = grab.p[0] - grab.p0[0], dy = grab.p[1] - grab.p0[1], d = Math.hypot(dx, dy) || 1;
    const lim = 430 * rope.sc, f = lim * (1 - Math.exp(-d / lim)) / d;
    const ax = grab.at[0] + dx * f, ay = grab.at[1] + dy * f;
    grab.x = (ax - rope.cx) / rope.sc - rope.px[grab.j];
    grab.y = (ay - rope.cy) / rope.sc - rope.py[grab.j];
  }
  function give() {
    grab.gave = true; grab.letGo = true;
    if (grab.wasOpen) { if (grab.along < 0.2) setOpen(0); }
    else setOpen(1);
  }
  function drop() {
    if (!grab) return;
    const g = grab;
    g.letGo = true;
    stage.classList.remove('has');
    if (g.far < 7) tap(g);
    lastTouch = performance.now();
  }
  // a click or a tap that did not move
  function tap(g) {
    // Until the knot has been pulled out there is nothing to press: a click
    // only gives it a small tug, which is the hint.
    if (!menuOn) { nudge(g.j); return; }
    const key = LOBE_OF_END()[rope.endOf(g.j)];
    if (g.touch) { flash(key); return; }
    if (live(key)) lobes[key].click();
    else say(key);
  }
  function say(key) {
    const el = lobes[key]; if (!el) return;
    el.classList.remove('said'); void el.offsetWidth; el.classList.add('said');
    clearTimeout(el._said); el._said = setTimeout(() => el.classList.remove('said'), 1600);
  }
  const nudges = [];
  function nudge(j) {
    const d = norm(rope.x(j) - rope.cx, rope.y(j) - rope.cy);
    nudges.push({ j, d, t: 0 });
    dirty = true;
  }
  let flashKey = null, flashUntil = 0;
  function flash(key) { flashKey = key; flashUntil = performance.now() + 900; if (!live(key)) say(key); }

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if (e.target.closest('a, button, .lobe')) return;
    if (grabAt(local(e), false)) { e.preventDefault(); stage.setPointerCapture?.(e.pointerId); }
  });
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const p = local(e);
    if (grab && !grab.touch) { pull(p); return; }
    pointerAt = { p, over: false };
    handMoved = performance.now();
    if (!still) aim = [-0.42 + 0.36 * clamp(p[0] / W - 0.5, -0.5, 0.5) * 2, -0.62 + 0.3 * clamp(p[1] / H - 0.5, -0.5, 0.5) * 2, 0.66];
    if (e.target === cv || e.target === stage) {
      const j = onGrip(p) >= 0 ? onGrip(p) : hit(p);
      const key = j === null ? null : LOBE_OF_END()[rope.endOf(j)];
      hot = menuOn && key && live(key) ? rope.endOf(j) : -1;
      stage.classList.toggle('can', j !== null);
      pointerAt.over = j !== null;
      if (j !== null) glintAt(j);
    }
    dirty = true;
  });
  const up = (e) => { if (e.pointerType !== 'touch' && grab && !grab.touch) drop(); };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('pointerleave', () => { if (!grab) { hot = -1; pointerAt = null; stage.classList.remove('can'); } });

  // touch: the first swipe on the knot pulls it; once it is out, swipes scroll
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || grab) return;
    if (e.target.closest('a, button, .lobe')) return;
    if (!tiedNow() || k > 0.4) return;
    if (grabAt(local(e.touches[0]), true)) glintAt(grab.j);
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (!grab || !grab.touch) return;
    if (e.cancelable) e.preventDefault();
    if (!grab.letGo) pull(local(e.touches[0]));
  }, { passive: false });
  const touchEnd = () => { if (grab && grab.touch) drop(); };
  addEventListener('touchend', touchEnd);
  addEventListener('touchcancel', touchEnd);

  hint.addEventListener('click', () => { touched = true; lastTouch = performance.now(); setOpen(tiedNow() ? 1 : 0); });

  for (const [key, el] of Object.entries(lobes)) {
    if (!live(key)) {
      el.addEventListener('click', () => say(key));
      continue;
    }
    const on = () => { if (menuOn) { hot = endOfLobe(key); dirty = true; } }, off = () => { hot = -1; dirty = true; };
    el.addEventListener('pointerenter', on); el.addEventListener('pointerleave', off);
    el.addEventListener('focus', on); el.addEventListener('blur', off);
  }
  const endOfLobe = (key) => LOBE_OF_END().indexOf(key);

  addEventListener('scroll', () => { dirty = true; lastTouch = performance.now(); }, { passive: true });
  addEventListener('keydown', () => { lastTouch = performance.now(); });

  // ---------------------------------------------------------------- placing the words
  function place(el, x, y, ax, ay, s, w, h) {
    // keep it on the screen
    const left = clamp(x - w * ax * s, 8, W - w * s - 8), top = clamp(y - h * ay * s, 8, H - h * s - 8);
    el.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px) scale(${s.toFixed(4)})`;
    return [left, top, w * s, h * s];
  }
  // Blur Text, after React Bits (reactbits.dev, MIT + Commons Clause, © David Haz):
  // the words come in a letter at a time, each from blurred and a little off its
  // line, past it, and back. Here it is scrubbed by k instead of timed, so the
  // words come and go with the knot.
  const pieces = new Map();
  function split(el) {
    const list = [];
    const walk = (node) => {
      for (const c of [...node.childNodes]) {
        if (c.nodeType === 1) { walk(c); continue; }
        if (c.nodeType !== 3) continue;
        const frag = document.createDocumentFragment();
        for (const ch of c.textContent) {
          if (/\s/.test(ch)) { frag.append(ch); continue; }
          const sp = document.createElement('span');
          sp.className = 'ch'; sp.textContent = ch; sp.setAttribute('aria-hidden', 'true');
          frag.append(sp); list.push(sp);
        }
        c.replaceWith(frag);
      }
    };
    walk(el);
    pieces.set(el, list);
  }
  function reveal(list, e, dir, dist, blur) {
    const n = list.length, spread = 0.45;
    for (let i = 0; i < n; i++) {
      const sp = list[i], start = n > 1 ? i / (n - 1) * spread : 0;
      const p = still ? (e > 0.5 ? 1 : 0) : clamp((e - start) / (1 - spread), 0, 1);
      if (p === sp._p) continue;
      sp._p = p;
      let b, o, y;
      if (p < 0.5) { const q = p / 0.5; b = mix(blur, blur / 2, q); o = 0.5 * q; y = mix(dir * dist, -dir * dist / 10, q); }
      else { const q = (p - 0.5) / 0.5; b = mix(blur / 2, 0, q); o = mix(0.5, 1, q); y = mix(-dir * dist / 10, 0, 1 - (1 - q) * (1 - q)); }
      sp.style.opacity = o.toFixed(3);
      sp.style.transform = Math.abs(y) > 0.01 ? `translateY(${y.toFixed(2)}px)` : '';
      sp.style.filter = b > 0.05 ? `blur(${b.toFixed(2)}px)` : '';
    }
  }
  const titleName = title.querySelector('.title__name'), titleSub = title.querySelector('.title__sub');
  for (const el of Object.values(lobes)) {
    el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    const inner = document.createElement('span');
    inner.className = 'lobe__in';
    inner.append(...el.childNodes);
    el.append(inner);
    split(el);
  }
  split(titleName); pieces.set(title, pieces.get(titleName));
  titleSub.style.opacity = '0';
  title.style.opacity = '1';

  // Magnet, after React Bits: a menu word leans towards the pointer as it comes
  // near (a fifth of the way), and settles back when it leaves.
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || still) return;
    for (const el of Object.values(lobes)) {
      const inner = el.firstElementChild, r = el.getBoundingClientRect(), s = el._s || 1;
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      if (menuOn && Math.abs(dx) < r.width / 2 + 46 && Math.abs(dy) < r.height / 2 + 46) {
        inner.style.transition = 'transform 0.3s ease-out';
        inner.style.transform = `translate3d(${(dx / 5 / s).toFixed(2)}px, ${(dy / 5 / s).toFixed(2)}px, 0)`;
        inner._on = true;
      } else if (inner._on) {
        inner.style.transition = 'transform 0.5s ease-in-out';
        inner.style.transform = '';
        inner._on = false;
      }
    }
  }, { passive: true });

  const sizes = new Map();
  function measure() {
    for (const el of [...Object.values(lobes), title]) { el.style.transform = 'none'; sizes.set(el, [el.offsetWidth, el.offsetHeight]); }
    measured = true;
  }

  // Each word circles the end of its own lobe as the knot is pulled: it starts
  // off the lobe's outer corner and swings round under it (or beside it, when
  // the knot stands upright), so it never crosses a strand; under the arms it then
  // slides in along them. [end of the loop, angle tied, angle pulled, is an arm]
  const ORBIT_WIDE = { tl: [0, 225, 90, 1], tr: [2, 315, 450, 1], bl: [3, 135, 122, 0], br: [1, 45, 58, 0] };
  const ORBIT_TALL = { tl: [0, 270, 360, 1], bl: [2, 90, 0, 1], tr: [3, 270, 360, 0], br: [1, 90, 0, 0] };
  const ORBIT_SHORT = { tl: [0, 196, 90, 1], tr: [2, 344, 450, 1], bl: [3, 164, 150, 0], br: [1, 16, 30, 0] };   // a phone on its side: beside the lobes, clear of the masthead
  function capCentre(end) {
    const S = rope.sp, q = end % 2 === 0 ? S[0] : S[S.length - 1];
    let x = q[0], y = q[1];
    if (end >= 2) { if (tall) y = -y; else x = -x; }
    return [rope.cx + x * rope.sc, rope.cy + y * rope.sc];
  }
  function words() {
    if (!measured) measure();
    const e = smooth(0, 1, clamp(k, 0, 1)), sc = rope.sc, cx = rope.cx, cy = rope.cy;
    const far = rope.far * sc, armW = ARM_WIDTH * sc, foot = FOOT * sc, footW = FOOT_WIDTH * sc;
    const narrow = W < 620, big = narrow || short ? 1.5 : 2.2;
    const ORBIT = tall ? ORBIT_TALL : short ? ORBIT_SHORT : ORBIT_WIDE;
    const swing = smooth(0, 0.8, e), slide = smooth(0.45, 1, e);
    for (const key of Object.keys(ORBIT)) {
      const el = lobes[key]; if (!el) continue;
      const [w, h] = sizes.get(el), [end, a0, a1, isArm] = ORBIT[key], loop = end >> 1;
      const th = (a0 + (a1 - a0) * swing) * Math.PI / 180, co = Math.cos(th), si = Math.sin(th);
      const R = (rope.half * (loop ? 1.3 : 1) + rope.rad[loop]) * sc + 10;
      const tip = rope.tips[end], follow = 0.45 * sc;
      const [ccx, ccy] = capCentre(end);
      let x = ccx + R * co + rope.dx[tip] * follow, y = ccy + R * si + rope.dy[tip] * follow;
      if (isArm) {
        const sign = end === 0 ? -1 : 1;
        if (tall) y = mix(y, cy + sign * far * 0.7, slide);
        else x = mix(x, cx + sign * far * 0.62, slide);
      }
      const s = mix(1, isArm ? big : narrow ? 1 : 1.1, e);
      place(el, x, y, 0.5 - 0.5 * co, 0.5 - 0.5 * si, s, w, h);
      el._s = s;
      reveal(pieces.get(el), smooth(0.3, 0.97, k), -1, 14, 8);
      el.classList.toggle('on', live(key) && (hot === end || (flashKey === key && performance.now() < flashUntil)));
    }

    // the name comes out from behind the knot
    const t = smooth(0.45, 1, k), [, th] = sizes.get(title);
    const armTop = cy - ARM * sc - armW;
    const ny = tall ? Math.max(14, H * 0.045) : short ? 10 : Math.max(46, (armTop - th) * 0.45);
    reveal(pieces.get(title), smooth(0.45, 1, k), 1, 34, 12);
    titleSub.style.opacity = smooth(0.8, 1, k).toFixed(3);
    title.style.transform = `translateY(${ny.toFixed(1)}px)`;
    masthead.style.opacity = (1 - smooth(0.12, 0.42, k)).toFixed(3);
  }

  // ---------------------------------------------------------------- the indicators
  // A grip on each loop, where it is pulled from; the button under the knot says
  // what to do. They step aside once someone has hold of it, and come back if
  // they leave it be.
  function gripPoint(g) {
    const end = g === 0 ? 0 : 2, tip = rope.tips[end], o = tip < N ? 0 : N;
    const want = rope.ends[end] - (g ? rope.half * 1.62 + rope.rad[1] * 0.2 : rope.half * 0.35);
    let best = tip, bd = 1e9;
    for (let i = o; i < o + N; i++) {
      if (Math.sign(rope.u[i]) !== Math.sign(rope.u[tip]) || rope.pz[i] < 0.2) continue;
      const d = Math.abs(Math.abs(rope.u[i]) - want);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  let gripShow = 0;
  function indicators(now, dt) {
    const idle = now - lastTouch > 6000;
    const want = tiedNow() && (!touched || idle) && !grab ? 1 : 0;
    gripShow += (want - gripShow) * (1 - Math.exp(-dt * (want ? 2.5 : 8)));
    const vis = gripShow * (1 - smooth(0.02, 0.2, k)) * (demoT > 0.08 && demoT < 0.7 ? 0.35 : 1);
    for (let g = 0; g < 2; g++) {
      const el = grips[g], j = gripPoint(g);
      el.style.opacity = vis.toFixed(3);
      if (vis < 0.01) continue;
      const a = tall ? (g === 0 ? -90 : 90) : (g === 0 ? 180 : 0);
      el.style.transform = `translate(${rope.x(j).toFixed(1)}px, ${rope.y(j).toFixed(1)}px) rotate(${a}deg)`;
    }
    // the pull: a ring round the hand, filling until it gives
    const m = grab && grab.touch && !grab.gave && !grab.wasOpen && grab.far > 6 ? 1 : 0;
    meter.style.opacity = m;
    if (grab) {
      const j = grab.j;
      meter.style.transform = `translate(${rope.x(j).toFixed(1)}px, ${rope.y(j).toFixed(1)}px)`;
      meter.querySelector('.meter__fill').style.strokeDashoffset = (1 - clamp(grab.tension, 0, 1)).toFixed(3);
    }
    hint.style.setProperty('--p', grab && !grab.wasOpen && !grab.gave ? clamp(grab.tension, 0, 1).toFixed(3) : demoPull.toFixed(3));
    const tied = tiedNow(), label = tied ? (finePointer ? 'Drag to pull it apart' : 'Swipe to pull it apart') : 'Tie it back up';
    hint.classList.toggle('is-caption', tied);
    if (hintText.textContent !== label) {
      hintText.textContent = label;
      hint.classList.remove('swap'); void hint.offsetWidth; hint.classList.add('swap');
    }
    hint.style.opacity = grab && grab.gave ? 0.4 : 1;
  }

  // Hint motion: the gesture shown on the knot itself. Now and then, until
  // someone has hold of it, two fingertips land on the grips, press, and draw
  // the two lobes apart; the rope really stretches after them, the line under
  // the button fills part way, and then they let go and it springs back.
  const DEMO = 2.8;                       // seconds, of which the first half is the pull
  let demoAt = 1300, demoT = -1, demoPull = 0;
  const demoFrom = [[0, 0], [0, 0]], demoJ = [0, 0], demoAt2 = [[0, 0], [0, 0]];
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  function demoDir(g) { return tall ? [0, g === 0 ? -1 : 1] : [g === 0 ? -1 : 1, 0]; }
  function demo(now, dt) {
    const ok = !still && tiedNow() && !grab && (!touched || now - lastTouch > 8000) && !document.hidden && now - handMoved > 2500;
    if (demoT < 0) {
      demoPull = 0;
      if (!ok || k > 0.05) { demoAt = Math.max(demoAt, now + 2500); for (const el of [...ghosts, ...trails]) el.style.opacity = '0'; return false; }
      if (now < demoAt) return false;
      demoT = 0;
      for (let g = 0; g < 2; g++) { demoJ[g] = gripPoint(g); demoFrom[g] = [rope.x(demoJ[g]), rope.y(demoJ[g])]; }
    }
    demoT += dt / DEMO;
    const t = demoT;
    const arrive = smooth(0, 0.1, t), press = smooth(0.1, 0.17, t), draw = easeInOut(clamp((t - 0.17) / 0.36, 0, 1));
    const lift = smooth(0.6, 0.72, t), D = REACH * rope.sc * 0.5 * 0.72 * draw;
    demoPull = 0.72 * draw * (1 - lift);
    for (let g = 0; g < 2; g++) {
      const d = demoDir(g);
      // the fingertip stays on the rope it holds, and is left where it let go
      if (t < 0.62) demoAt2[g] = [rope.x(demoJ[g]), rope.y(demoJ[g])];
      const [x, y] = demoAt2[g], run = Math.hypot(x - demoFrom[g][0], y - demoFrom[g][1]);
      const sc = 1.3 - 0.3 * arrive - 0.14 * press + 0.5 * lift;
      ghosts[g].style.opacity = (arrive * (1 - lift)).toFixed(3);
      ghosts[g].style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${sc.toFixed(3)})`;
      trails[g].style.opacity = (0.9 * smooth(0, 0.15, draw) * (1 - lift)).toFixed(3);
      const ang = Math.atan2(d[1], d[0]) * 180 / Math.PI + 180;
      trails[g].style.width = `${run.toFixed(1)}px`;
      trails[g].style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${ang}deg)`;
      // the rope follows the fingertip while it is held
      if (t > 0.12 && t < 0.62) rope.tug(demoJ[g], d[0] * D / rope.sc, d[1] * D / rope.sc, 0.3);
    }
    if (t >= 1 || !ok) { demoT = -1; demoAt = now + 4600; for (const el of [...ghosts, ...trails]) el.style.opacity = '0'; }
    return true;
  }

  // the pointer over the knot: a ring that says "Pull"; held, it fills until it gives
  let pointerAt = null, handMoved = -1e9;
  function pointerRing() {
    const show = finePointer && pointerAt && !menuOn && (grab ? !grab.touch && !grab.gave && !grab.wasOpen : pointerAt.over);
    stage.classList.toggle('pointer-pull', !!show);
    cursor.classList.toggle('on', !!show);
    if (!show) return;
    const p = grab && !grab.touch ? grab.p : pointerAt.p;
    cursor.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px)`;
    cursor.classList.toggle('held', !!grab);
    cursorFill.style.strokeDashoffset = grab ? (1 - clamp(grab.tension, 0, 1)).toFixed(3) : '1';
  }

  // The hand over the knot. A soft light follows it across the ribbon (a satin
  // sheen), strands near it lean towards it a little, and brushing across them
  // sends a small wave along the loop. Held, the light stays with the hand.
  const sheen = [0, 0, 0];                 // x, y, strength
  let lastHand = null;
  // the knot turns a few degrees towards the hand (radians about x and y)
  const turn = [0, 0];
  // glints: where the hand comes onto a strand, a band of light runs both ways round its loop
  const glints = [], glintData = new Float32Array(24);
  let lastGlint = { l: -1, s: 0, at: -1e9 };
  function glintAt(j) {
    if (still) return;
    const l = j < N ? 0 : 1, s0 = (j % N) / N, now = performance.now();
    const ds = Math.abs(((s0 - lastGlint.s + 1.5) % 1) - 0.5);
    if (l === lastGlint.l && ds < 0.14 && now - lastGlint.at < 1400) return;
    if (now - lastGlint.at < 260) return;
    lastGlint = { l, s: s0, at: now };
    glints.push({ l, s0, t: 0 });
    if (glints.length > 6) glints.shift();
  }
  function hand(dt) {
    const p = grab && grab.p ? grab.p : finePointer && pointerAt ? pointerAt.p : null;
    const want = p && !still ? 1 : 0;
    const s0 = sheen[2];
    sheen[2] += (want - sheen[2]) * (1 - Math.exp(-dt * (want ? 5 : 3)));
    if (p) {
      if (sheen[2] < 0.02) { sheen[0] = p[0]; sheen[1] = p[1]; }
      sheen[0] += (p[0] - sheen[0]) * (1 - Math.exp(-dt * 14));
      sheen[1] += (p[1] - sheen[1]) * (1 - Math.exp(-dt * 14));
    }
    let busy = Math.abs(sheen[2] - s0) > 1e-4 || (p && Math.hypot(p[0] - sheen[0], p[1] - sheen[1]) > 0.3);
    if (p && !grab && !still && finePointer) {
      const r = 120, sc = rope.sc;
      const vx = lastHand ? (p[0] - lastHand[0]) / Math.max(dt, 1 / 240) : 0, vy = lastHand ? (p[1] - lastHand[1]) / Math.max(dt, 1 / 240) : 0;
      const speed = Math.min(1, Math.hypot(vx, vy) / 2400), f = Math.min(2, dt * 60);
      for (let j = 0; j < rope.px.length; j++) {
        const dx = p[0] - rope.x(j), dy = p[1] - rope.y(j), d = Math.hypot(dx, dy);
        if (d > r) continue;
        const w = (1 - d / r) ** 2;
        // lean towards the hand
        rope.dx[j] += (dx / sc) * 0.0022 * w * f;
        rope.dy[j] += (dy / sc) * 0.0022 * w * f;
        // and be brushed by it
        rope.vx[j] += (vx / sc) * 0.04 * w * speed * f;
        rope.vy[j] += (vy / sc) * 0.04 * w * speed * f;
      }
      busy = true;
    }
    lastHand = p && !grab ? p.slice() : null;

    // turn towards it
    const reach = REACH * rope.sc * 1.4, tx = p && !still ? clamp((p[1] - rope.cy) / reach, -1, 1) * 0.085 : 0;
    const ty = p && !still ? -clamp((p[0] - rope.cx) / reach, -1, 1) * 0.085 : 0;
    const t0 = turn[0], t1 = turn[1], ease = 1 - Math.exp(-dt * 3.2);
    turn[0] += (tx - turn[0]) * ease; turn[1] += (ty - turn[1]) * ease;
    if (Math.abs(turn[0] - t0) + Math.abs(turn[1] - t1) > 2e-5) busy = true;

    // and run the glints on
    glintData.fill(0);
    for (let i = glints.length - 1; i >= 0; i--) {
      const g = glints[i];
      g.t += dt;
      if (g.t > 1.9) { glints.splice(i, 1); continue; }
    }
    glints.forEach((g, i) => {
      glintData.set([g.l, g.s0, g.t * 0.3, smooth(0, 0.12, g.t) * (1 - smooth(1.0, 1.9, g.t))], i * 4);
    });
    if (glints.length) busy = true;
    return busy;
  }

  // ---------------------------------------------------------------- the frame
  const H_STEP = 1 / 240;
  let last = 0, acc = 0, slowFrames = 0, easyNeed = 240, raised = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;

    // what k is heading for
    let target = Math.max(open, scrollK()), stiff = 6.6, damp = 0.74;
    if (grab && !grab.letGo && !grab.wasOpen) target = Math.max(target, 0.2 * smooth(0, 1, grab.tension) * (0.35 + 0.65 * Math.max(0, grab.along || 0)));
    if (demoPull > 0) target = Math.max(target, 0.2 * smooth(0, 1, demoPull));
    if (!open && !grab && scrollY > 0) { stiff = 10; damp = 1; }   // following the scroll: no bounce
    if (still) { k = target; kv = 0; }
    else {
      for (let t = 0; t < dt; t += H_STEP) {
        const h = Math.min(H_STEP, dt - t);
        kv += (stiff * stiff * (target - k) - 2 * damp * stiff * kv) * h;
        k += kv * h;
      }
      if (Math.abs(target - k) < 1e-4 && Math.abs(kv) < 1e-3) { k = target; kv = 0; }
    }
    const kk = clamp(k, -0.08, 1.08);
    if (kk !== rope.t) { rope.setPose(kk); centre(); dirty = true; }

    // hands
    if (grab) {
      grab.hold = grab.letGo ? Math.max(0, grab.hold - dt * 5) : Math.min(1, grab.hold + dt * 9);
      if (!grab.letGo) holdTarget();
      if (grab.letGo && grab.hold <= 0) { grab = null; rope.grab = null; }
      dirty = true;
    }
    const tugged = demo(now, dt) || nudges.length > 0;
    for (let i = nudges.length - 1; i >= 0; i--) {
      const u = nudges[i];
      u.t += dt / 0.55;
      const a = 26 * Math.sin(Math.PI * clamp(u.t, 0, 1)) ** 2;
      rope.tug(u.j, u.d[0] * a, u.d[1] * a, 0.1);
      if (u.t >= 1) nudges.splice(i, 1);
    }
    // the menu can be used once the knot is out, and not before
    const on = k > 0.9 && !tiedNow();
    if (on !== menuOn) {
      menuOn = on; menu.inert = !on;
      html.classList.toggle('menu-on', on);
      if (!on) hot = -1;
    }

    // springs
    if (!still || grab) {
      acc += dt;
      let steps = 0;
      while (acc >= H_STEP && steps < 16) { rope.step(H_STEP); acc -= H_STEP; steps++; }
      if (steps >= 16) acc = 0;
    } else { rope.dx.fill(0); rope.dy.fill(0); }

    for (let i = 0; i < 4; i++) {
      const want = hot === i || (flashKey && performance.now() < flashUntil && LOBE_OF_END()[i] === flashKey && live(flashKey)) ? 1 : 0;
      glow[i] += (want - glow[i]) * (still ? 1 : 1 - Math.exp(-dt * (want ? 4 : 6)));
    }
    for (let n = 0; n < 3; n++) light[n] += (aim[n] - light[n]) * (1 - Math.exp(-dt * 3));
    painter.look.light = light;
    const touching = hand(dt);

    const moving = dirty || tugged || touching || rope.energy() > 0.02 || glow.some((g) => g > 0.002 && g < 0.998) || Math.abs(light[0] - aim[0]) + Math.abs(light[1] - aim[1]) > 1e-4;
    rope.settle(grab ? grab.j : 0, grab ? grab.hold : 0);
    if (moving || painter.lost) {
      painter.draw(rope, glow, 1, { hand: sheen, turn, pulses: glintData });
      words();
      dirty = false;
      // a slow machine draws fewer pixels
      // a device that is really struggling draws fewer pixels, and gets them back when it is not
      // (a raise that has to be taken back doubles the wait before the next one)
      if (dt > 0.045) slowFrames++; else if (dt < 0.022) slowFrames -= 0.25;
      if (slowFrames > 90 && dpr > dprFloor) { dprCap = Math.max(dprFloor, dpr - 0.5); slowFrames = 0; if (raised) easyNeed = Math.min(easyNeed * 2, 3840); raised = false; size(false); }
      else if (slowFrames < -easyNeed && dpr < dprTop) { dprCap = Math.min(3, dpr + 0.5); slowFrames = 0; raised = true; size(false); }
      slowFrames = clamp(slowFrames, -easyNeed - 60, 120);
    }
    indicators(now, dt);
    pointerRing();
    if (open) holdOpenByScroll();
  }

  cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });
  cv.addEventListener('webglcontextrestored', () => {
    try { painter = createPainter(cv); size(false); } catch (e) { fallback('WebGL was lost'); }
  });

  let resizing = 0;
  const resized = () => { cancelAnimationFrame(resizing); resizing = requestAnimationFrame(() => { if (stage.clientWidth !== W || stage.clientHeight !== CH || ui.clientHeight !== H) size(false); }); };
  addEventListener('resize', resized);
  if ('ResizeObserver' in window) { const ro = new ResizeObserver(resized); ro.observe(stage); ro.observe(ui); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measured = false; dirty = true; });

  size(true);
  k = scrollK(); rope.setPose(k); centre();
  painter.draw(rope, glow);
  words();
  menu.inert = true;
  hintText.textContent = finePointer ? 'Drag to pull it apart' : 'Swipe to pull it apart';
  html.classList.remove('fallback');
  html.classList.add('live');
  requestAnimationFrame(frame);

  // for the tests in the README
  window.__knot = { get state() { return { k, open, scroll: scrollK(), grab: grab && { j: grab.j, tension: grab.tension, gave: grab.gave }, tall, sc: rope.sc, cx: rope.cx, cy: rope.cy, dpr, energy: rope.energy() }; }, rope, point: (j) => [rope.x(j), rope.y(j)], grip: (g) => gripPoint(g) };
}

function norm(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
