/**
 * js/progress.js — the reading progress rule at the top of the page.
 *
 * Stands in for the native scrollbar, which styles.css hides. It reads the real
 * document scroll rather than the timeline, so it stays truthful in both modes:
 * the static page has no scene and no scrubbed timeline, but it still scrolls.
 *
 * Colour comes from --accent, which main.js rewrites every frame, so the rule
 * turns ochre, blue, grey and pen-red along with the act it is measuring, and
 * survives the black-to-paper flip without being told about it.
 *
 * Two deliberate choices, both learned the hard way:
 *
 *   The scroll height is read live rather than cached. This page rewrites its
 *   own height repeatedly — the static flip collapses the acts to a quarter of
 *   the dynamic document, and reveals and late fonts move it again. A cached
 *   measurement plus a ResizeObserver looked cheaper and left the rule reading
 *   26 % at the foot of the static page. One cached-layout read per frame is
 *   the correct price for a rule that is never wrong.
 *
 *   The write happens in the scroll handler, not on a rAF hop. Deferring would
 *   put the rule a frame behind the page it measures, which is visible because
 *   smooth-scroll.js drives scrollTo() every frame.
 */

const REVEAL_AT = 24;   // px — same idea as the scroll cue: absent until you begin

export function createScrollProgress() {
  const el = document.getElementById('progress');
  if (!el) return { dispose() {} };
  const fill = el.firstElementChild;

  let last = -1;
  let revealed = false;

  function write() {
    const y = scrollY;
    if (!revealed && y > REVEAL_AT) { revealed = true; el.classList.add('is-live'); }
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max <= 0 || y <= 0 ? 0 : y >= max ? 1 : y / max;
    if (Math.abs(p - last) < 0.0004) return;    // sub-pixel on any plausible viewport
    last = p;
    fill.style.transform = `scaleX(${p.toFixed(5)})`;
  }

  addEventListener('scroll', write, { passive: true });
  addEventListener('resize', write);
  write();                                      // a reload lands mid-page with the rule already correct

  return {
    dispose() {
      removeEventListener('scroll', write);
      removeEventListener('resize', write);
    },
  };
}
