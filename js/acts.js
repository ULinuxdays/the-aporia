/**
 * js/acts.js — where the five acts are, and how far through each one we are.
 *
 * Two layouts, one story:
 *
 *   wide     Copy sits in columns either side of the figure. Sections follow
 *            one another and an act is "active" while the viewport's centre
 *            line is inside it.
 *   compact  (phones, tablets) One column. The figure owns the top of the
 *            screen; the copy is paged through a fixed zone under it. Sections
 *            overlap by one viewport (CSS), so each act's sticky block pins at
 *            the moment the previous one lets go and there is never a screen
 *            with nothing to read. An act runs from its own top to the next's.
 *
 * Imports nothing, so the static page can use it.
 */

export const COMPACT = '(max-width: 64rem)';
export const isCompact = () => matchMedia(COMPACT).matches;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Spans are in px of scroll. */
export function measureActs() {
  const vh = innerHeight;
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
  const overlapped = isCompact() && document.documentElement.classList.contains('dynamic');
  const focus = overlapped ? 0 : vh * 0.5;
  const acts = [...document.querySelectorAll('section.act')].map((el) => {
    const r = el.getBoundingClientRect();
    return { el, id: el.dataset.act || el.className, top: r.top + scrollY, height: r.height, start: 0, end: 0, len: 0 };
  });
  acts.forEach((a, i) => {
    const next = acts[i + 1];
    a.start = i === 0 ? 0 : clamp(a.top - focus, 0, maxScroll);
    a.end = overlapped
      ? clamp(next ? next.top : a.top + a.height - vh, 0, maxScroll)
      : clamp(a.top + a.height - focus, 0, maxScroll);
    a.len = Math.max(1, a.end - a.start);
  });
  return { acts, maxScroll, vh };
}

/**
 * Call fn(fractions, acts) now and on every scroll: fractions[k] is how far
 * through act k+1 the page is (below 0 before it, above 1 after it). The
 * measurement is cached and only redone when the document changes size, so a
 * scroll costs no layout.
 */
export function trackActs(fn) {
  let key = '', acts = [], raf = 0;
  const update = () => {
    raf = 0;
    const k = `${innerWidth}x${document.documentElement.scrollHeight}`;
    if (k !== key) { key = k; ({ acts } = measureActs()); }
    const y = scrollY;
    fn(acts.map((a) => (y - a.start) / a.len), acts);
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(update); };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);
  update();
}
