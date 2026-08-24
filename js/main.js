/**
 * js/main.js — connects the scroll to the scene. Part 3.
 *
 * One master anime.js timeline, scrubbed across the whole page by onScroll
 * with damping, animates the scene's plain `state` object. The timeline is
 * MEASURED from the five <section class="act"> elements every time it is
 * built: each act's scroll span (in px) becomes its span on the timeline (in
 * ms, 1 ms = 1 px), so changing a section's CSS height re-choreographs the
 * page. Nothing here is positioned by hand. It rebuilds on resize.
 *
 * Inside each act, beats are placed at FRACTIONS of that act's span — see
 * choreograph(). That table is the storyboard (BRIEF.md) in numbers, and is
 * the part to edit when the timing feels wrong. CONTRACTS.md §12.
 *
 * Every frame, the scene calls onFrame(state); we write the CSS custom
 * properties --bg / --ink / --ink-soft / --rule / --accent from state.tone
 * and the accent channels, so the DOM and the WebGL never disagree about
 * what colour the world is. Values are only written when they change.
 *
 * ?debug adds onScroll's own overlay and a readout of morph / tone / progress.
 */

import { createTimeline, animate, onScroll, svg } from 'animejs';
import { loadAllClouds } from './clouds.js';
import { STATE_DEFAULTS } from './state.js';
import { createSmoothScroll } from './smooth-scroll.js';
import { PORTAL } from './shapes.js';
import { createCurtain } from './curtain.js';
// three.js, the shapes and the scene are imported lazily, and only on the
// dynamic path — the static page never fetches them.

const PARAMS = new URLSearchParams(location.search);
const DEBUG = PARAMS.has('debug');
const DAMPING = 0.35;           // onScroll sync: smaller is heavier

/** The Act V invitation accent (sRGB 0..1). Lens accents come from the covers in the HTML. */
export const INVITATION = [0.85, 0.42, 0.3];    // ember red — Act V is on black again, so it has to carry against the dark

/**
 * The issues, read from the Act IV covers in index.html — ONE place. Each
 * <article class="cover" data-lens="i" data-shape="crowd" style="--tint: r, g, b">
 * gives its lens shape (a name in shapes.js LENS_BUILDERS) and its colour
 * (the tint, 0–255, is also the scene accent). Adding Issue 04 is adding a
 * cover. Falls back to the original three if the DOM has none.
 */
export function readLenses() {
  const covers = [...document.querySelectorAll('.cover[data-lens]')].sort((a, b) => Number(a.dataset.lens) - Number(b.dataset.lens));
  const lenses = covers.map((el) => {
    const tint = (el.style.getPropertyValue('--tint') || '140,140,148').split(',').map((v) => Number(v) / 255);
    return { shape: el.dataset.shape || 'unformed', accent: tint, id: el.dataset.accent || `lens-${el.dataset.lens}` };
  });
  return lenses.length ? lenses : [
    { shape: 'crowd', accent: [0.78, 0.50, 0.22], id: 'sociology' },
    { shape: 'device', accent: [0.29, 0.47, 0.94], id: 'technology' },
    { shape: 'unformed', accent: [0.55, 0.55, 0.58], id: 'undecided' },
  ];
}
const LENSES = readLenses();
const N_LENS = LENSES.length;
const SHAPE_PAGE = 2 + N_LENS, SHAPE_WORDMARK = 3 + N_LENS, SHAPE_PORTAL = 4 + N_LENS;
/** Page ground and text at the two ends of the tonal shift (0..255). */
const COLD_BG = [8, 8, 11],      WARM_BG = [244, 238, 227];
const COLD_INK = [244, 241, 234], WARM_INK = [28, 22, 20];

/** Where the state starts at scroll 0. Everything choreograph() does is relative to these. */
const INITIAL = {
  ...STATE_DEFAULTS,
  morph: 0, spread: 0.45, drift: 0.006, tone: 0, accentMix: 0,
  accentR: LENSES[0].accent[0], accentG: LENSES[0].accent[1], accentB: LENSES[0].accent[2],
  camZ: 5.5, camY: 0.85, lookY: 1.35, rotY: 0, tiltX: 0,
};

// --------------------------------------------------------------------------- capability

/**
 * Decide, before loading anything heavy, whether this visit gets the particle
 * scene and how big it should be. The magazine's argument is that philosophy
 * shouldn't gatekeep, so the static page is a first-class path, not an error
 * state. Force with ?static or ?webgl.
 *
 * @returns {{ static: boolean, reason: string, count: number, tier: string, narrow: boolean }}
 */
export function decideMode() {
  const w = innerWidth, h = innerHeight;
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;            // GB; Safari and Firefox don't expose it — unknown is not weak
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = !!navigator.connection?.saveData;
  const narrow = w < 720;
  const forced = PARAMS.has('webgl') ? 'webgl' : PARAMS.has('static') ? 'static' : null;

  let reason = null;
  if (forced === 'static') reason = 'forced';
  else if (!forced && reduced) reason = 'prefers-reduced-motion';
  else if (!forced && saveData) reason = 'save-data';
  else if (!forced && (cores <= 2 || mem <= 2)) reason = `low capability (${cores} cores, ${mem} GB)`;
  else if (!forced && Math.min(w, h) < 340) reason = 'tiny viewport';
  else if (forced !== 'webgl' && !probeWebGL()) reason = 'no WebGL context';   // ?webgl skips the probe; createScene() still falls back if the context really fails
  if (reason) return { static: true, reason, count: 0, tier: 'static', narrow };

  // particle budget by tier; point size is compensated so density reads the same
  let tier, count;
  // Measured on an Apple M4 at DPR 2: 90k and 120k both scrub at a steady
  // 60 fps (p95 18 ms); the GPU is not the limit at these counts. 90k is the
  // approved look; below it the figures lose the detail the normals need.
  if (narrow) { tier = 'phone'; count = 18000; }
  else if (w < 1100) { tier = 'tablet'; count = 30000; }
  else if (cores >= 8 && mem >= 8) { tier = 'desktop-strong'; count = 90000; }
  else { tier = 'desktop'; count = 60000; }
  if (cores <= 4 || mem <= 4) { count = Math.round(count * 0.6); tier += '-weak'; }
  if (PARAMS.has('count')) { count = Math.max(1000, Number(PARAMS.get('count')) || count); tier += '-forced'; }   // testing
  return { static: false, reason: forced === 'webgl' ? 'forced' : 'capable', count, tier, narrow };
}

function probeWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) || c.getContext('webgl', { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}

// --------------------------------------------------------------------------- boot

function goStatic(reason) {
  const html = document.documentElement;
  html.classList.remove('dynamic');
  html.classList.add('static');
  html.dataset.staticReason = reason;
  console.info(`[aporia] static page: ${reason}`);
}

async function main() {
  const mode = decideMode();
  const html = document.documentElement;
  const smooth = createSmoothScroll({ lerp: 0.055 });     // eased wheel scrolling; off under reduced motion / touch
  createScrollCue(smooth);
  if (mode.static) {
    goStatic(mode.reason);
    if (DEBUG) window.__aporia = { mode };
    return;                 // nothing else: no three.js, no clouds, no timeline
  }
  html.classList.add('dynamic');

  // 1. Everything that doesn't need the renderer starts now, so the page is
  //    reading-ready and colour-correct before a single cloud byte arrives.
  INITIAL.size = STATE_DEFAULTS.size * Math.pow(90000 / mode.count, 0.3);   // fewer particles → bigger grains, same density on screen
  const state = { ...INITIAL };
  const debug = DEBUG ? makeDebugReadout() : null;
  const scroll = createScrollChoreography(state, { debug });
  createReveals();
  let themeRaf = requestAnimationFrame(function tick() { applyTheme(state); if (debug) debug.update(state, scroll); themeRaf = requestAnimationFrame(tick); });
  if (DEBUG || PARAMS.has('expose')) window.__aporia = { state, scroll, scene: null, measureActs, mode };

  // 2. The heavy parts, in parallel: three + scene + shapes modules, and the clouds.
  const canvas = document.getElementById('stage');
  let scene = null;
  try {
    const [{ createScene }, { buildAllShapes, buildShape }, clouds] = await Promise.all([
      import('./scene.js'),
      import('./shapes.js'),
      loadAllClouds(),
    ]);
    const count = mode.count;
    const built = buildAllShapes(count, { clouds, lenses: LENSES.map((l) => l.shape) });
    preYawShapes(built.shapes);
    if (built.usedStandIn.thinker || built.usedStandIn.epicurus) {
      console.info('[aporia] using stand-in geometry for', Object.entries(built.usedStandIn).filter(([, v]) => v).map(([k]) => k).join(', '), '— run node tools/bake.mjs');
    }
    scene = createScene(canvas, { count, shapes: built.shapes, onFrame });
    Object.assign(scene.state, state);               // hand the live values over; the timeline keeps animating this object
    scroll.retarget(scene.state);
    cancelAnimationFrame(themeRaf);
    if (mode.narrow) scene.setViewOffset(-0.55);     // lift the figure above the copy on phones
    scene.start();
    if (window.__aporia) { window.__aporia.scene = scene; window.__aporia.state = scene.state; }
    // The cloud fades in only once the monument is shaded: an unshaded cloud
    // reads as an X-ray blob, and first impressions are the whole point.
    const shown = { done: false };
    const show = () => { if (shown.done) return; shown.done = true; requestAnimationFrame(() => canvas.classList.add('is-ready')); };
    setTimeout(show, 4000);
    estimateNormalsInBackground(scene, built.shapes.length, {
      nextIndex: () => Math.round(Math.min(built.shapes.length - 1, Math.max(0, scene.state.morph))),   // the shape under the reader first
      onDone: (i) => { if (i === 0) show(); },
    });
    rebuildTextShapesWhenFontsLoad(scene, count, clouds, buildShape);
    console.info(`[aporia] scene: ${count.toLocaleString('en-US')} particles (${mode.tier})`);
  } catch (err) {
    console.warn('[aporia] no renderer — static page', err.message);
    cancelAnimationFrame(themeRaf);
    goStatic('renderer failed');
    return;
  }

  const portal = createPortal(scroll);
  function onFrame(s) {
    applyTheme(s);
    portal.update(s, scene);
    if (debug) debug.update(s, scroll);
  }

  // Rebuild the timeline when the layout actually changes size (not on every scroll-driven
  // mobile toolbar twitch: we compare the measured document, not the event).
  let lastKey = `${innerWidth}x${document.documentElement.scrollHeight}`;
  const onResize = debounce(() => {
    const key = `${innerWidth}x${document.documentElement.scrollHeight}`;
    if (key === lastKey) return;
    lastKey = key;
    scroll.rebuild();
  }, 150);
  addEventListener('resize', onResize);
  addEventListener('orientationchange', onResize);
}

/**
 * Estimate a surface normal per point for every shape, off the main thread,
 * and hand each one to the scene as it arrives. Until a shape's normals land
 * it renders unshaded, so this is pure progressive enhancement. Shapes are
 * done in scroll order, so the monument is shaded before anyone reaches it.
 */
function estimateNormalsInBackground(scene, shapeCount, { nextIndex, onDone } = {}) {
  let worker = null;
  try {
    worker = new Worker(new URL('./normals-worker.js', import.meta.url), { type: 'module' });
  } catch (err) {
    console.info('[aporia] no module worker; clouds stay unshaded.', err.message);
    onDone?.(0);
    return () => {};
  }
  const pending = new Set();
  for (let k = 0; k < shapeCount; k++) if (scene.getShape(k)) pending.add(k);
  const next = () => {
    if (!pending.size) { worker.terminate(); worker = null; return; }
    // the shape the reader is on (or nearest to it) goes first, then the rest in order
    let index = nextIndex ? nextIndex() : -1;
    if (!pending.has(index)) {
      let best = null;
      for (const k of pending) if (best === null || Math.abs(k - index) < Math.abs(best - index)) best = k;
      index = best;
    }
    pending.delete(index);
    const copy = scene.getShape(index).slice();
    worker.postMessage({ id: index, positions: copy }, [copy.buffer]);
  };
  worker.onmessage = (e) => {
    const { id, normals } = e.data;
    try { scene.setNormals(id, normals); } catch (err) { console.warn('[aporia] normals rejected', err.message); }
    onDone?.(id);
    next();
  };
  worker.onerror = (err) => {
    console.info('[aporia] normal worker failed; clouds stay unshaded.', err.message);
    worker.terminate();
    worker = null;
    onDone?.(0);
  };
  next();
  return () => { if (worker) { worker.terminate(); worker = null; } };
}

/** The page and wordmark shapes are sampled from canvas text; re-sample them in the real faces once loaded. */
const PAGE_FONT = '500 120px Caveat, "Bradley Hand", cursive';
const WORDMARK_FONT = '800 220px Inter, Helvetica, Arial, sans-serif';
function rebuildTextShapesWhenFontsLoad(scene, count, clouds, buildShape) {
  if (!document.fonts?.load) return;
  Promise.all([document.fonts.load(PAGE_FONT), document.fonts.load(WORDMARK_FONT)])
    .then(() => {
      const lenses = LENSES.map((l) => l.shape);
      scene.setShape(SHAPE_PAGE, yawShape(buildShape(SHAPE_PAGE, count, { clouds, lenses, pageFont: PAGE_FONT }), YAW.page));
      scene.setShape(SHAPE_WORDMARK, buildShape(SHAPE_WORDMARK, count, { clouds, lenses, wordmarkFont: WORDMARK_FONT, wordmarkWidth: 3.2 }));
      estimateNormalsInBackground({ ...scene, getShape: (i) => (i === SHAPE_PAGE || i === SHAPE_WORDMARK ? scene.getShape(i) : null) }, SHAPE_WORDMARK + 1, {});
    })
    .catch((err) => console.info('[aporia] webfont shapes not rebuilt:', err.message));
}

// --------------------------------------------------------------------------- measurement

/**
 * Measure the acts. An act is "active" while the viewport's focus line (its
 * vertical centre) is inside the section, which is also the midpoint of the
 * hand-over between one sticky block and the next. Spans are in px of scroll.
 */
export function measureActs() {
  const vh = innerHeight;
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
  const focus = vh * 0.5;
  const sections = [...document.querySelectorAll('section.act')];
  const acts = sections.map((el) => {
    const r = el.getBoundingClientRect();
    const top = r.top + scrollY;
    return { el, id: el.dataset.act || el.className, top, height: r.height, start: 0, end: 0, len: 0 };
  });
  acts.forEach((a, i) => {
    a.start = i === 0 ? 0 : clamp(a.top - focus, 0, maxScroll);
    // The last act ends at its own bottom too; anything after it inside <main>
    // (the colophon) scrolls in with the final state held.
    a.end = clamp(a.top + a.height - focus, 0, maxScroll);
    a.len = Math.max(1, a.end - a.start);
  });
  return { acts, maxScroll, vh };
}

// --------------------------------------------------------------------------- the choreography

/**
 * Builds the master timeline from the measured acts. Returns { timeline, acts, rebuild }.
 */
function createScrollChoreography(state, { debug } = {}) {
  let timeline = null;
  let measured = null;
  let target = state;     // the object the tweens write to; swapped for scene.state once the scene exists

  function build() {
    measured = measureActs();
    const { acts, maxScroll } = measured;
    if (acts.length < 5) console.warn(`[aporia] expected 5 <section class="act">, found ${acts.length}`);

    const tl = createTimeline({
      defaults: { ease: 'linear' },
      autoplay: onScroll({
        target: '#scroll',
        enter: { target: 'start', container: 'start' },
        leave: { target: 'end', container: 'end' },
        sync: document.documentElement.classList.contains('smooth') ? 0.65 : DAMPING,   // the wheel is already eased; don't double-smooth
        debug: !!debug,
      }),
    });

    // Pin the total duration to the full scroll length so 1 ms === 1 px whatever the last tween is.
    tl.add({ t: 0 }, { t: 1, duration: maxScroll }, 0);

    choreograph(tl, target, acts);
    timeline = tl;
    if (debug) console.info('[aporia] timeline', acts.map((a) => `${a.id}: ${Math.round(a.start)}–${Math.round(a.end)}px`).join(' · '), `max ${Math.round(maxScroll)}px`);
  }

  function rebuild() {
    if (timeline) timeline.revert();
    Object.assign(target, INITIAL);
    build();
  }
  /** Point the timeline at another state object (same shape). Rebuilds so the tweens bind to it. */
  function retarget(next) {
    if (next === target) return;
    target = next;
    rebuild();
  }

  build();
  return {
    get timeline() { return timeline; },
    get acts() { return measured?.acts ?? []; },
    get maxScroll() { return measured?.maxScroll ?? 1; },
    rebuild,
    retarget,
  };
}

/**
 * The storyboard, in numbers. Each line places a beat at fractions [f0, f1]
 * of one act's scroll span. `from` values are tracked automatically so every
 * property is continuous across the whole page — no snaps at act boundaries.
 */
function choreograph(tl, state, acts) {
  const cur = { ...INITIAL };
  const lastEnd = {};   // per property, the timeline ms at which its last tween ends

  /** Add a beat: animate `props` (to-values) over [f0, f1] of `act`. */
  const beat = (act, f0, f1, props, ease = 'linear') => {
    if (!act) return;
    const start = act.start + f0 * act.len;
    const duration = Math.max(1, (f1 - f0) * act.len);
    const params = { duration, ease };
    for (const [k, to] of Object.entries(props)) {
      if (lastEnd[k] !== undefined && start < lastEnd[k] - 0.5) {
        console.warn(`[aporia] choreograph: ${k} overlaps its previous beat at ${Math.round(start)}ms`);
      }
      params[k] = { from: cur[k], to };
      cur[k] = to;
      lastEnd[k] = start + duration;
    }
    tl.add(state, params, start);
  };
  const rgb = (c) => ({ accentR: c[0], accentG: c[1], accentB: c[2] });

  const [I, II, III, IV, V] = acts;

  // ---- The camera moves in ONE direction. rotY runs 0 → 2π across the page
  // (the Thinker turns from head-on to full profile over Act I and keeps
  // turning); every later shape is pre-rotated (YAW, below) so it faces the
  // camera at the moment it resolves. camY only rises. camZ pushes in once
  // (I–III) and pulls out once (IV–V). lookY rises to look up at him, then
  // comes down once at the fracture and keeps descending. No back-and-forth.

  // ---- Act I — THE MONUMENT. morph holds at 0. Head-on, then a slow quarter
  // turn to full profile while the camera rises and pushes in; the first
  // screenful barely moves.
  beat(I, 0.00, 0.55, { camZ: 5.1 }, 'inCubic');
  beat(I, 0.55, 1.00, { camZ: 4.7 }, 'inOutSine');
  beat(I, 0.00, 1.00, { camY: 1.15 }, 'inQuad');
  beat(I, 0.00, 1.00, { lookY: 1.5 }, 'inQuad');          // looking up at him
  beat(I, 0.00, 1.00, { rotY: YAW.monumentEnd }, 'inSine'); // head-on → sideways
  beat(I, 0.00, 1.00, { tiltX: 0.035 }, 'inOutSine');        // …and a slow lean in: the turn is a helix, not a turntable

  // ---- Act II — THE IMPASSE. Nothing resolves. The camera all but stops for
  // the whole act. Only in the last slice does the plinth start to give.
  beat(II, 0.00, 0.86, { camZ: 4.65 });
  beat(II, 0.00, 0.86, { camY: 1.17 });
  beat(II, 0.00, 0.86, { rotY: YAW.impasseEnd });           // barely drifting
  beat(II, 0.00, 0.86, { tiltX: 0.05 });
  beat(II, 0.86, 1.00, { morph: 0.05 }, 'inExpo');
  beat(II, 0.84, 1.00, { spread: 1.6 }, 'inExpo');

  // ---- Act III — THE FRACTURE. The plinth collapses, the Thinker dissolves
  // and reforms as Epicurus; the turn continues through the dust and the bust
  // is built facing us at the angle we arrive at.
  beat(III, 0.00, 0.62, { morph: 1 }, 'inOutQuad');
  beat(III, 0.00, 0.28, { spread: 1.15 }, 'outSine');
  beat(III, 0.28, 0.66, { spread: 0.45 }, 'outSine');
  beat(III, 0.16, 0.48, { tone: 1 }, 'inOutSine');
  beat(III, 0.00, 0.80, { camZ: 4.5 }, 'inOutSine');
  beat(III, 0.08, 0.62, { camY: 1.2 }, 'inOutSine');
  beat(III, 0.08, 0.62, { lookY: 1.36 }, 'inOutSine');    // coming down towards eye level
  beat(III, 0.00, 0.62, { rotY: YAW.bust });
  beat(III, 0.62, 1.00, { rotY: YAW.fractureEnd });
  beat(III, 0.00, 1.00, { tiltX: 0.075 }, 'inOutSine');      // the crest of the tilt

  // ---- Act IV — THE LENSES. One shape per issue, each with its own accent;
  // the camera keeps turning and eases back out. Generalised over however many
  // covers the HTML declares (LENSES).
  const slice = 1 / N_LENS, go = 0.62;
  LENSES.forEach((lens, k) => {
    const f0 = k * slice, f1 = f0 + go * slice, f2 = (k + 1) * slice;
    const u = N_LENS > 1 ? k / (N_LENS - 1) : 1;        // 0 on the first lens, 1 on the last
    beat(IV, f0, f1, { morph: 2 + k, accentMix: 0.85, ...rgb(lens.accent) }, 'inOutSine');
    beat(IV, f0, f1, { camZ: 4.5 + 1.3 * (k + 1) / N_LENS, camY: 1.2 + 0.15 * (k + 1) / N_LENS, lookY: 1.36 - 0.11 * (k + 1) / N_LENS }, 'inOutSine');
    beat(IV, f0, f1, { rotY: YAW.lens[k].resolve });
    beat(IV, f1, f2, { rotY: YAW.lens[k].end });
    beat(IV, f0, f2, { tiltX: 0.075 + 0.02 * (k + 1) / N_LENS }, 'inOutSine');   // still rising: the lean never reverses mid-page
    if (k === N_LENS - 1) beat(IV, f0, 1.00, { drift: 0.012 }, 'inOutSine');
    void u;
  });

  // ---- Act V — YOUR TURN. The sheet, then the wordmark, which arrives exactly
  // as the turn completes (2π ≡ head-on); the drift is left raised.
  beat(V, 0.00, 0.40, { morph: SHAPE_PAGE, ...rgb(INVITATION) }, 'inOutSine');
  beat(V, 0.02, 0.26, { tone: 0 }, 'inOutSine');             // 005 is on black: the page glows marble on the dark, the way we came in
  beat(V, 0.02, 0.30, { size: INITIAL.size * 1.3 }, 'inOutSine');   // …and the grains overlap a little more, so the sheet reads as a lit page rather than a grey slab
  beat(V, 0.00, 0.86, { tiltX: 0 }, 'inOutSine');            // the lean settles out, once, as the wordmark comes level
  beat(V, 0.00, 0.40, { camZ: 6.0, camY: 1.38, lookY: 1.12, drift: 0.006 }, 'inOutSine');
  beat(V, 0.00, 0.40, { rotY: YAW.page });
  beat(V, 0.55, 0.78, { morph: SHAPE_WORDMARK, accentMix: 0.7 }, 'inOutSine');
  beat(V, 0.55, 0.86, { camZ: 6.6, lookY: 1.05 }, 'inOutSine');
  beat(V, 0.40, 0.86, { rotY: YAW.end }, 'outSine');
  beat(V, 0.55, 0.78, { repel: 0.34, repelRadius: 0.08 }, 'inOutSine');   // the wordmark gives way under the cursor a little more
  beat(V, 0.70, 0.86, { drift: 0.016 }, 'inSine');
  // …it holds (78–86 %), then the letters fall and a ring gathers: the portal. No burst —
  // straight down, staggered by seed, reads as falling.
  beat(V, 0.86, 0.98, { morph: SHAPE_PORTAL, spread: 0.06, accentMix: 0.95, drift: 0.028, ...rgb([0.8, 0.4, 0.16]) }, 'inQuad');   // the ring burns in the orange and shimmers
}

/**
 * Stage yaw (state.rotY) at the moments that matter, in radians. Shapes that
 * must be seen front-on are built rotated by −YAW[…] (see preYawShapes), so
 * one continuous turn serves every act. The lens entries are spread evenly
 * between the fracture and the page for however many issues there are.
 */
export const YAW = (() => {
  const monumentEnd = Math.PI / 2, impasseEnd = 1.66, bust = 2.45, fractureEnd = 2.62;
  const lensesEnd = 5.75, page = 5.95, end = Math.PI * 2;
  const step = (lensesEnd - fractureEnd) / N_LENS;
  const lens = LENSES.map((_, k) => ({ resolve: fractureEnd + step * (k + 0.49), end: fractureEnd + step * (k + 1) }));
  return { monumentEnd, impasseEnd, bust, fractureEnd, lens, lensesEnd, page, end };
})();

/** Rotate a shape about the Y axis (in place) so it faces the camera at stage yaw `theta`. */
function yawShape(arr, theta) {
  const c = Math.cos(-theta), s = Math.sin(-theta);
  for (let i = 0; i < arr.length; i += 3) {
    const x = arr[i], z = arr[i + 2];
    arr[i] = c * x + s * z;
    arr[i + 2] = -s * x + c * z;
  }
  return arr;
}

/** Pre-rotate the shapes that have a front, to the yaw at which they resolve. */
function preYawShapes(shapes) {
  yawShape(shapes[1], YAW.bust);
  YAW.lens.forEach((y, k) => yawShape(shapes[2 + k], y.resolve));
  yawShape(shapes[SHAPE_PAGE], YAW.page);
  // 0 (monument) is head-on at 0; the wordmark resolves at 2π.
  return shapes;
}

// --------------------------------------------------------------------------- reveals

/**
 * Per-element reveals, driven by playback methods rather than scrubbing: each
 * element plays in when its section has scrolled `data-at` (fraction, default
 * staggered) past the viewport centre, and reverses when the section leaves —
 * or earlier, at `data-leave` (fraction of the section past the centre), for
 * copy that must clear the stage before a beat lands.
 */
function createReveals() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const section of document.querySelectorAll('section.act')) {
    const items = [...section.querySelectorAll('.reveal')];
    items.forEach((el, i) => {
      const at = el.dataset.at !== undefined ? Number(el.dataset.at) : Math.min(0.6, i * 0.12);
      const leave = el.dataset.leave !== undefined
        ? { target: `${Math.round(Number(el.dataset.leave) * 100)}%`, container: 'center' }
        : { target: 'end', container: 'end' };
      animate(el, {
        opacity: { from: 0, to: 1 },
        translateY: reduced ? { from: '0rem', to: '0rem' } : { from: '1.2rem', to: '0rem' },
        duration: reduced ? 300 : 900,
        ease: 'outCubic',
        autoplay: onScroll({
          target: section,
          enter: { target: `${Math.round(at * 100)}%`, container: 'center' },
          leave,
          sync: 'play reverse',
          debug: DEBUG,
        }),
      });
    });
  }
}

// --------------------------------------------------------------------------- the scroll cue

/** "Scroll" at the foot of the first screen. Goes once the reader has. */
function createScrollCue(smooth) {
  const cue = document.getElementById('scroll-cue');
  if (!cue) return;
  if (smooth.enabled) document.documentElement.classList.add('smooth');
  const hide = () => { cue.classList.add('is-gone'); removeEventListener('scroll', onScroll); };
  const onScroll = () => { if (scrollY > 40) hide(); };
  addEventListener('scroll', onScroll, { passive: true });
  cue.addEventListener('click', (e) => {
    e.preventDefault();
    const to = innerHeight * 0.9;
    if (smooth.enabled) smooth.scrollTo(to); else scrollTo({ top: to, behavior: 'smooth' });
  });
  onScroll();
}

// --------------------------------------------------------------------------- the portal

/**
 * The only way to the shelf. At the end of Act V the wordmark falls into a
 * heap and a ring of particles gathers at eye level; inside it, this DOM
 * aperture opens onto the shelf. Each frame the ring's centre and radius are
 * projected through the scene camera so the aperture sits exactly inside the
 * particles. It is a link; it fades in with the ring (morph 6.55 → 7).
 */
function createPortal(scroll) {
  const el = document.getElementById('portal');
  if (!el) return { update() {} };
  const v = new THREE_LITE.Vec3(), u = new THREE_LITE.Vec3();
  const note = createPortalNote();
  let lastKey = '';
  let liveScene = null, entering = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Entering: the camera dives through the ring while the aperture swells to
  // fill the screen and the room inside comes up to meet you; then the shelf
  // page opens out of the same circle (shelf.html reads the flag).
  /**
   * Going through. Three moves, one line of travel (bottom-left → top-right):
   *   1. the field storms — the vortex spins up, everything shakes loose, the
   *      world inverts to black and the grains turn to marble;
   *   2. it rushes up and to the right, and a curtain of grains closes over
   *      the viewport until the screen is solid — that is when the page
   *      changes, so there is nothing to see at the cut;
   *   3. on the shelf the same curtain carries on in the same direction and
   *      uncovers the room (js/shelf/main.js).
   */
  el.addEventListener('click', (e) => {
    if (entering) { e.preventDefault(); return; }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;   // let the browser open a new tab
    e.preventDefault();
    entering = true;
    try { sessionStorage.setItem('aporia:portal', '1'); } catch {}
    const go = () => { location.href = el.href; };
    if (reduced || !liveScene) {
      try { sessionStorage.removeItem('aporia:portal'); } catch {}   // no transition, so nothing for the shelf to continue
      go();
      return;
    }
    document.documentElement.classList.add('is-entering');
    scroll?.timeline?.pause();                       // the scroll must not fight the transition
    const st = liveScene.state;
    const curtain = createCurtain();
    curtain.show(0, 'cover');
    let done = false;
    const once = () => { if (!done) { done = true; go(); } };
    const wipe = { p: 0 };
    const T = PARAMS.has('slow') ? 4 : 1;            // ?slow stretches the transition for tuning and filming
    const tl = createTimeline({ defaults: { ease: 'inQuad' } });
    // 1. the storm
    tl.add(st, { swirl: 9, drift: 0.07, spread: 0.4, size: st.size * 1.6, duration: 480 * T }, 0);
    tl.add(st, { tone: 0, accentMix: 1, duration: 240 * T, ease: 'linear' }, 120 * T);
    // 2. the rush, and the curtain closing over the lens along the same diagonal
    tl.add(st, { swirl: 34, duration: 700 * T }, 420 * T);
    tl.add(st, { sweep: 1, duration: 760 * T, ease: 'inCubic' }, 420 * T);
    tl.add(st, { camZ: Math.max(2.4, st.camZ * 0.74), duration: 740 * T, ease: 'inOutSine' }, 420 * T);
    tl.add(wipe, { p: 1, duration: 660 * T, ease: 'inOutQuad', onUpdate: () => curtain.draw(wipe.p, 'cover') }, 430 * T);
    tl.then(once);
    setTimeout(once, 1500 * T);                      // never strand the reader on a half-finished animation
  });

  // Coming back (bfcache): undo the dive.
  addEventListener('pageshow', (ev) => {
    if (!entering && !ev.persisted) return;
    entering = false;
    document.documentElement.classList.remove('is-entering');
    scroll?.rebuild?.();
  });

  return {
    update(s, scene) {
      if (!scene) return;
      liveScene = scene;
      if (entering) return;
      const cam = scene.three.camera;
      const t = Math.min(1, Math.max(0, (s.morph - (SHAPE_PORTAL - 0.45)) / 0.45));
      // project the ring centre and a point on its rim
      const c = v.set(PORTAL.x, PORTAL.y, PORTAL.z).applyObject(scene.three.points).project(cam);
      const e = u.set(PORTAL.x + PORTAL.r, PORTAL.y, PORTAL.z).applyObject(scene.three.points).project(cam);
      const w = innerWidth, h = innerHeight;
      const cx = (c.x + 1) / 2 * w, cy = (1 - c.y) / 2 * h;
      const ex = (e.x + 1) / 2 * w, ey = (1 - e.y) / 2 * h;
      const r = Math.hypot(ex - cx, ey - cy) * 0.98;        // just inside the ring
      const key = `${cx | 0},${cy | 0},${r | 0},${t.toFixed(2)}`;
      if (key === lastKey) return;
      lastKey = key;
      el.style.setProperty('--px', `${cx}px`);
      el.style.setProperty('--py', `${cy}px`);
      el.style.setProperty('--pr', `${r}px`);
      el.style.setProperty('--pt', t.toFixed(3));
      el.classList.toggle('is-open', t > 0.02);
      el.setAttribute('aria-hidden', t > 0.02 ? 'false' : 'true');
      el.tabIndex = t > 0.02 ? 0 : -1;
      note.update(cx, cy, r, t);
    },
  };
}

/** "go on, click it" — a pen arrow into the portal, drawn on once the ring has formed. */
function createPortalNote() {
  const el = document.getElementById('portal-note');
  if (!el) return { update() {} };
  const paths = [...el.querySelectorAll('path')];
  const drawables = svg.createDrawable(paths);
  const text = el.querySelector('.marg__note');
  let drawn = false, hidden = false;
  const show = () => {
    if (drawn) return; drawn = true; hidden = false;
    el.classList.add('is-on');
    const tl = createTimeline({ defaults: { ease: 'inOutSine' } });
    tl.add(drawables, { draw: { from: '0 0', to: '0 1' }, duration: 900, delay: (_, i) => i * 300 }, 200);
    if (text) tl.add(text, { opacity: { from: 0, to: 1 }, translateY: { from: '0.3rem', to: '0rem' }, duration: 450 }, 700);
  };
  const hide = () => {
    if (!drawn || hidden) return; hidden = true; drawn = false;
    el.classList.remove('is-on');
    animate(drawables, { draw: '0 0', duration: 300, ease: 'inSine' });
    if (text) animate(text, { opacity: 0, duration: 200 });
  };
  return {
    update(cx, cy, r, t) {
      el.style.setProperty('--px', `${cx}px`);
      el.style.setProperty('--py', `${cy}px`);
      el.style.setProperty('--pr', `${r}px`);
      if (t > 0.85) show(); else if (t < 0.5) hide();
    },
  };
}

// a tiny vector helper so this module doesn't import three on the static path
const THREE_LITE = {
  Vec3: class {
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    applyObject(obj) {
      // points.rotation (y then x) — the stage is only ever rotated, never moved
      const cy = Math.cos(obj.rotation.y), sy = Math.sin(obj.rotation.y), cx = Math.cos(obj.rotation.x), sx = Math.sin(obj.rotation.x);
      let { x, y, z } = this;
      const y1 = y * cx - z * sx, z1 = y * sx + z * cx;                // rotation about X
      const x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;             // rotation about Y
      this.x = x2; this.y = y1; this.z = z2; return this;
    }
    project(cam) {
      cam.updateMatrixWorld();
      const m = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
      const { x, y, z } = this;
      const vx = m[0] * x + m[4] * y + m[8] * z + m[12], vy = m[1] * x + m[5] * y + m[9] * z + m[13], vz = m[2] * x + m[6] * y + m[10] * z + m[14];
      const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12], cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13], cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
      this.x = cx / cw; this.y = cy / cw; return this;
    }
  },
};

// --------------------------------------------------------------------------- theme

let lastThemeKey = '';
/** Write --bg / --ink / --ink-soft / --rule / --accent from the scene state. Only when changed. */
export function applyTheme(s) {
  // The ground STEPS at tone 0.5 rather than fading: any ground that passes
  // through mid-grey leaves the text unreadable for part of the scroll
  // (measured: 49 % of the tonal range below 4.5:1 with a linear fade, 1.01:1
  // at the worst point). Black/cream before the flip, paper/ink after, a short
  // CSS transition to soften the switch; contrast stays ≥ 15:1 at every tone.
  // The particles crossfade per grain on their own (scene.js), so the dissolve
  // is still gradual where it matters.
  const warm = clamp(s.tone, 0, 1) >= 0.5;
  const bg = warm ? WARM_BG : COLD_BG;
  const ink = warm ? WARM_INK : COLD_INK;
  const ar = Math.round(clamp(s.accentR, 0, 1) * 255), ag = Math.round(clamp(s.accentG, 0, 1) * 255), ab = Math.round(clamp(s.accentB, 0, 1) * 255);
  const key = `${bg}|${ink}|${ar},${ag},${ab}`;
  if (key === lastThemeKey) return;
  lastThemeKey = key;
  const st = document.documentElement.style;
  st.setProperty('--bg', `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`);
  st.setProperty('--ink', `rgb(${ink[0]}, ${ink[1]}, ${ink[2]})`);
  st.setProperty('--ink-soft', `rgba(${ink[0]}, ${ink[1]}, ${ink[2]}, 0.62)`);
  st.setProperty('--rule', `rgba(${ink[0]}, ${ink[1]}, ${ink[2]}, 0.16)`);
  st.setProperty('--accent', `rgb(${ar}, ${ag}, ${ab})`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`);
}

// --------------------------------------------------------------------------- debug

const SHAPE_NAMES = ['monument', 'epicurus', ...LENSES.map((l) => l.shape), 'page', 'wordmark'];

function makeDebugReadout() {
  const el = document.createElement('div');
  el.id = 'debug';
  document.body.appendChild(el);
  let last = '';
  return {
    update(s, scroll) {
      const tl = scroll.timeline;
      const acts = scroll.acts;
      const y = scrollY;
      const act = acts.find((a) => y >= a.start && y < a.end) || acts[acts.length - 1];
      const seg = Math.min(SHAPE_NAMES.length - 2, Math.max(0, Math.floor(s.morph)));
      const text =
        `scroll   ${Math.round(y)} / ${Math.round(scroll.maxScroll)} px\n` +
        `progress ${tl ? (tl.progress * 100).toFixed(1) : '–'} %  (damped)\n` +
        `act      ${act ? act.id : '–'}  ${act ? (((y - act.start) / act.len) * 100).toFixed(0) : '–'} %\n` +
        `morph    ${s.morph.toFixed(3)}  ${SHAPE_NAMES[seg]} → ${SHAPE_NAMES[seg + 1]}\n` +
        `tone     ${s.tone.toFixed(3)}   spread ${s.spread.toFixed(2)}  drift ${s.drift.toFixed(3)}\n` +
        `accent   ${s.accentMix.toFixed(2)}  rgb(${[s.accentR, s.accentG, s.accentB].map((v) => Math.round(v * 255)).join(',')})\n` +
        `camera   z ${s.camZ.toFixed(2)}  y ${s.camY.toFixed(2)}  look ${s.lookY.toFixed(2)}  rotY ${s.rotY.toFixed(2)}`;
      if (text !== last) { el.textContent = text; last = text; }
    },
  };
}

// --------------------------------------------------------------------------- utils

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function debounce(fn, ms) {
  let id = 0;
  return () => { clearTimeout(id); id = setTimeout(fn, ms); };
}

// --------------------------------------------------------------------------- go
// (at the end, after every const above has been initialised)
main().catch((err) => {
  console.error('[aporia] failed to start', err);
  goStatic('startup error');
});
