/**
 * js/page.js — the DOM-side mechanics. Part 4.
 *
 *   1. The jargon field (Act I): words crowd the monument, then scatter when
 *      the plinth goes. Scroll-scrubbed.
 *   2. Act IV issue cards: the card for the current lens is highlighted.
 *
 * Everything here reads the same sections js/main.js measures and never
 * touches the scene state. CONTRACTS.md §14.
 */

import { isCompact, trackActs } from './acts.js';
import { animate, onScroll, stagger } from '../vendor/animejs/anime.esm.js';

const DEBUG = new URLSearchParams(location.search).has('debug');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DAMPING = 0.35;
const compact = isCompact();

/**
 * The static page (reduced motion, weak device, no WebGL) gets none of the
 * scroll-driven mechanics: CSS shows everything resolved, and the issue covers
 * mark the first issue.
 *
 * The mode comes from main.js, never from reading a class here. The head's
 * watchdog can set `static` before main.js runs and main.js can take it off
 * again, so a class read at an arbitrary moment is a coin toss — and losing it
 * leaves the page dynamic but with none of these mechanics running, which
 * looks exactly like a broken site.
 */
whenMode((mode) => {
  if (mode === 'static') {
    fanCovers([...document.querySelectorAll('.cover[data-lens]')]);
    document.querySelector('.cover[data-lens="0"]')?.classList.add('is-active');
  } else {
    jargonField();
    issueCards();
  }
});

function whenMode(fn) {
  const html = document.documentElement;
  let done = false;
  const once = (m) => { if (!done) { done = true; fn(m); } };
  if (html.dataset.mode) { once(html.dataset.mode); return; }
  addEventListener('aporia:mode', (e) => once(e.detail), { once: true });
  // main.js never reported in: treat it as static, which is what the page is showing
  setTimeout(() => once(html.dataset.mode || (html.classList.contains('dynamic') ? 'dynamic' : 'static')), 5000);
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
      leave: compact ? { target: '20%', container: 'start' } : { target: '75%', container: 'center' },
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
      enter: compact ? { target: 'start', container: '20%' } : { target: 'start', container: '85%' },
      leave: compact ? { target: '22%', container: 'start' } : { target: '22%', container: 'center' },   // gone before the About copy arrives
      sync: DAMPING,
      debug: DEBUG,
      // Once every word has flown off, stop the layer: sixteen floating words
      // nobody can see were still being animated for the rest of the page.
      onLeaveForward: () => field.classList.add('is-gone'),
      onEnterBackward: () => field.classList.remove('is-gone'),
    }),
  });

  if (!reduced) field.classList.add('is-floating');
}

// --------------------------------------------------------------------------- 2. issue cards

function issueCards() {
  const section = document.querySelector('.act--lenses');
  if (!section) return;
  const cards = [...section.querySelectorAll('.cover[data-lens], .issue[data-lens]')];
  fanCovers(cards);
  if (compact) {
    trackActs((f) => {
      // the covers take over from the copy at 26 % (data-step) and share the rest evenly
      const k = Math.min(cards.length - 1, Math.max(0, Math.floor((f[3] - 0.26) / (0.72 / cards.length))));
      cards.forEach((c, i) => c.classList.toggle('is-active', i === k));
    });
    return;
  }
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
