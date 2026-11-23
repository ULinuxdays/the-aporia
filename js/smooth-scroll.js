/**
 * js/smooth-scroll.js — eased wheel scrolling, the ScrollSmoother / Lenis feel.
 *
 * Wheel input is intercepted and accumulated into a target; each frame the
 * real scroll position is eased toward it and written with scrollTo(). The
 * document still scrolls natively, so position: sticky, anchor links, the
 * scrollbar, keyboard and touch all keep working, and anime.js's onScroll
 * observers see ordinary scroll events. (GSAP's ScrollSmoother translates a
 * wrapper instead, which breaks sticky — not usable with this page.)
 *
 * Off under prefers-reduced-motion and on touch-only devices.
 */

export function createSmoothScroll({ rate = 8, wheelMultiplier = 1, maxStep = 220 } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  if (reduced || coarse) return { enabled: false, dispose() {} };

  let target = scrollY, current = scrollY, raf = 0, animating = false, last = 0;
  const max = () => document.documentElement.scrollHeight - innerHeight;
  const begin = () => { if (!animating) { animating = true; last = 0; raf = requestAnimationFrame(tick); } };

  function onWheel(e) {
    if (e.ctrlKey || e.metaKey) return;                       // pinch-zoom / browser zoom
    if (e.defaultPrevented) return;
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;       // horizontal: leave to the browser (the shelf uses it)
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= innerHeight;
    dy = Math.max(-maxStep, Math.min(maxStep, dy)) * wheelMultiplier;
    if (!animating) { current = scrollY; target = scrollY; }
    target = Math.max(0, Math.min(max(), target + dy));
    begin();
  }

  // Eased by time, not by frame: the page catches up with the wheel in the same
  // time at 60 Hz and 120 Hz. `rate` 8/s closes 90 % of the gap in under 0.3 s;
  // it used to be a fixed 5.5 % a frame, which left the page sliding for well
  // over a second after the wheel stopped and read as lag.
  function tick(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    current += (target - current) * (1 - Math.exp(-rate * dt));
    if (Math.abs(target - current) < 0.5) { current = target; animating = false; scrollTo(0, current); return; }
    scrollTo(0, current);
    raf = requestAnimationFrame(tick);
  }

  // scrolls we didn't cause (keys, scrollbar, anchors, touch) become the new baseline
  function onScroll() { if (!animating) { current = scrollY; target = scrollY; } }
  function onResize() { target = Math.min(target, max()); }

  addEventListener('wheel', onWheel, { passive: false });
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onResize);

  return {
    enabled: true,
    /** Ease to an absolute position (used by the scroll cue and anchor links). */
    scrollTo(y) { if (!animating) { current = scrollY; } target = Math.max(0, Math.min(max(), y)); begin(); },
    dispose() { cancelAnimationFrame(raf); removeEventListener('wheel', onWheel); removeEventListener('scroll', onScroll); removeEventListener('resize', onResize); },
  };
}
