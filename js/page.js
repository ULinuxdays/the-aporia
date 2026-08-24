/**
 * js/page.js — the DOM-side mechanics. Part 4.
 *
 *   1. The jargon field (Act I): words crowd the monument, then scatter when
 *      the plinth goes. Scroll-scrubbed.
 *   2. The jargon → plain swap (Act III): six rows that character-shuffle
 *      from academic to plain English as the reader scrolls them through
 *      the viewport. anime.js scrambleText + stagger, scrubbed with damping,
 *      so the reader performs the translation.
 *   3. Marginalia: hand-drawn strokes (svg.createDrawable) and notes that
 *      stroke themselves on as you scroll. Four on the whole page.
 *   4. Act IV issue cards: the card for the current lens is highlighted.
 *
 * Everything here reads the same sections js/main.js measures and never
 * touches the scene state. CONTRACTS.md §14.
 */

import { animate, createTimeline, onScroll, stagger, svg, scrambleText } from '../vendor/animejs/anime.esm.js';

const DEBUG = new URLSearchParams(location.search).has('debug');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DAMPING = 0.35;

// The static page (html.static — reduced motion, weak device, no WebGL) gets
// none of the scroll-driven mechanics: CSS shows everything resolved, and the
// issue covers mark the first issue. main.js decides the mode synchronously
// before this module runs.
if (document.documentElement.classList.contains('static')) {
  fanCovers([...document.querySelectorAll('.cover[data-lens]')]);
  document.querySelector('.cover[data-lens="0"]')?.classList.add('is-active');
} else {
  jargonField();
  swapList();
  marginalia();
  issueCards();
}

// --------------------------------------------------------------------------- 1. jargon field

function jargonField() {
  const field = document.getElementById('jargon');
  const monument = document.querySelector('.act--monument');
  const fracture = document.querySelector('.act--fracture');
  if (!field || !monument || !fracture) return;

  const outers = [...field.querySelectorAll(':scope > span')];
  // Two wrappers per word: the outer owns placement and the fade-in, the
  // inner owns the scatter. Separate elements, so the tweens never fight.
  const inners = outers.map((outer) => {
    const inner = document.createElement('i');
    inner.textContent = outer.textContent;
    outer.textContent = '';
    outer.appendChild(inner);
    return inner;
  });

  // Fade in over the first three quarters of Act I, in a loose order.
  animate(outers, {
    opacity: { from: 0, to: 1 },
    delay: stagger(70, { from: 'random' }),
    duration: 700,
    ease: 'outSine',
    autoplay: onScroll({
      target: monument,
      enter: { target: 'start', container: 'start' },
      leave: { target: '75%', container: 'center' },
      sync: DAMPING,
      debug: DEBUG,
    }),
  });

  // Scatter: each word flies away from the monument (the screen centre) and
  // fades, from the tremor at the end of Act II to 40 % into Act III.
  const away = (outer, axis) => {
    const x = parseFloat(outer.style.getPropertyValue('--x')) - 50;
    const y = parseFloat(outer.style.getPropertyValue('--y')) - 50;
    const len = Math.hypot(x, y) || 1;
    return axis === 'x' ? `${(x / len) * 70}vw` : `${(y / len) * 70}vh`;
  };
  animate(inners, {
    translateX: { from: '0vw', to: (el, i) => away(outers[i], 'x') },
    translateY: { from: '0vh', to: (el, i) => away(outers[i], 'y') },
    rotate: { from: 0, to: (el, i) => (i % 2 ? 28 : -28) },
    opacity: { from: 1, to: 0, delay: 250, duration: 650 },
    delay: stagger(45, { from: 'center' }),
    duration: 1000,
    ease: 'inQuad',
    autoplay: onScroll({
      target: fracture,
      enter: { target: 'start', container: '85%' },
      leave: { target: '40%', container: 'center' },
      sync: DAMPING,
      debug: DEBUG,
    }),
  });

  if (!reduced) field.classList.add('is-floating');
}

// --------------------------------------------------------------------------- 2. the swap

function swapList() {
  const list = document.getElementById('swap-list');
  if (!list) return;
  const rows = [...list.querySelectorAll('.swap')];
  const lives = rows.map((row) => {
    const from = row.dataset.from, to = row.dataset.to;
    const mk = (cls, text, hidden) => {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = text;
      if (hidden) s.setAttribute('aria-hidden', 'true');
      return s;
    };
    // Both phrasings are already in the HTML (so the list reads without JS) and
    // are laid out in the same grid cell (CSS), so the row is sized by the
    // longer one and never reflows while the live text shuffles over them.
    if (!row.querySelector('.swap__from')) row.prepend(mk('swap__from', from, true), mk('swap__to', to, false));
    const live = mk('swap__live is-academic', from, true);
    live.dataset.to = to;
    row.insertBefore(live, row.querySelector('.swap__to').nextSibling);
    return live;
  });

  const ROW_STAGGER = 260, ROW_DURATION = 1500;
  const anim = animate(lives, {
    textContent: scrambleText({
      text: (el) => el.dataset.to,
      chars: 'lowercase',
      from: 'left',
      duration: ROW_DURATION,
      settleDuration: 260,
      seed: 17,
      override: false,               // untouched rows keep reading as the academic phrase until the wave reaches them
      delay: stagger(ROW_STAGGER),   // inside: scrambleText returns its own per-tween delay, which would override an outer one
    }),
    ease: 'linear',
    onUpdate: (self) => {
      // switch each row from the Didone to the grotesque as its wave passes the middle
      const t = self.currentTime;
      lives.forEach((el, i) => el.classList.toggle('is-academic', t < i * ROW_STAGGER + ROW_DURATION * 0.45));
    },
    autoplay: onScroll({
      target: list,
      enter: { target: 'start', container: '82%' },
      leave: { target: 'end', container: '34%' },
      sync: DAMPING,
      debug: DEBUG,
    }),
  });
  return anim;
}

// --------------------------------------------------------------------------- 3. marginalia

function marginalia() {
  const specs = [
    // [svg data-marg, host selector relative to the svg, enter, leave] — thresholds are
    // fractions of the host that have passed the viewport centre (or, for the
    // flowing row, positions of the row in the viewport).
    { id: '1', host: 'section.act', enter: { target: '8%', container: 'center' }, leave: { target: '26%', container: 'center' } },
    { id: '2', host: 'section.act', enter: { target: '42%', container: 'center' }, leave: { target: '60%', container: 'center' } },
    { id: '3', host: '.swap', enter: { target: 'start', container: '58%' }, leave: { target: 'start', container: '34%' } },
    { id: '4', host: 'section.act', enter: { target: '27%', container: 'center' }, leave: { target: '44%', container: 'center' } },
  ];
  for (const spec of specs) {
    const el = document.querySelector(`svg[data-marg="${spec.id}"]`);
    const note = document.querySelector(`[data-marg-note="${spec.id}"]`);
    if (!el) continue;
    const host = el.closest(spec.host);
    if (!host) continue;
    const paths = [...el.querySelectorAll('path')];
    const drawables = svg.createDrawable(paths);
    const tl = createTimeline({
      defaults: { ease: 'inOutSine' },
      autoplay: onScroll({ target: host, enter: spec.enter, leave: spec.leave, sync: 0.5, debug: DEBUG }),
    });
    tl.add(drawables, { draw: { from: '0 0', to: '0 1' }, duration: 800, delay: stagger(260) }, 0);
    if (note) tl.add(note, { opacity: { from: 0, to: 1 }, translateY: { from: '0.3rem', to: '0rem' }, duration: 450 }, 450);
  }
}

// --------------------------------------------------------------------------- 4. issue cards

function issueCards() {
  const section = document.querySelector('.act--lenses');
  if (!section) return;
  const cards = [...section.querySelectorAll('.cover[data-lens], .issue[data-lens]')];
  fanCovers(cards);
  cards.forEach((card, k) => {
    const a = (k / cards.length) * 100, b = ((k + 1) / cards.length) * 100;
    onScroll({
      target: section,
      enter: { target: `${a.toFixed(1)}%`, container: 'center' },
      leave: { target: `${b.toFixed(1)}%`, container: 'center' },
      onEnter: () => card.classList.add('is-active'),
      onLeave: () => card.classList.remove('is-active'),
      debug: DEBUG,
    });
  });
}

/** Lay the covers out as a fan, whatever their number: the middle one upright, the others leaning out. */
function fanCovers(cards) {
  const n = cards.length;
  cards.forEach((card, k) => {
    const c = (n - 1) / 2, d = k - c, ad = Math.abs(d);
    card.style.setProperty('--fan-rot', `${d * 7}deg`);
    card.style.setProperty('--fan-dy', `${0.3 + ad * 0.3}rem`);
    card.style.setProperty('--fan-sc', `${(0.97 - ad * 0.03).toFixed(3)}`);
    card.style.setProperty('--fan-fade', `${(0.85 - ad * 0.15).toFixed(2)}`);
    card.style.setProperty('--fan-z', String(Math.round(10 - ad * 2)));
  });
}
