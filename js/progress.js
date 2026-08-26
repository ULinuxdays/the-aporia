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
 * The rule is divided by a hairline notch at every act boundary — the same five
 * chapters the copy numbers 001 to 005 — and carries one further mark where the
 * portal finishes forming, so the door is visible on the rule before you reach
 * it. Marks are supplied by the caller (main.js owns measureActs) as fractions
 * of the scrollable length.
 *
 * Two deliberate choices, both learned the hard way:
 *
 *   The scroll height is read live rather than cached. This page rewrites its
 *   own height repeatedly — the static flip collapses the acts to a quarter of
 *   the dynamic document, and reveals and late fonts move it again. A cached
 *   measurement plus a ResizeObserver looked cheaper and left the rule reading
 *   26 % at the foot of the static page. One cached-layout read per frame is
 *   the correct price for a rule that is never wrong. That same read doubles as
 *   the trigger for re-laying the marks, so they cannot drift out of step.
 *
 *   The write happens in the scroll handler, not on a rAF hop. Deferring would
 *   put the rule a frame behind the page it measures, which is visible because
 *   smooth-scroll.js drives scrollTo() every frame.
 */

const REVEAL_AT = 24;   // px — same idea as the scroll cue: absent until you begin

/**
 * @param {object} [opts]
 * @param {() => Array<{at: number, kind?: 'chapter'|'portal'}>} [opts.marks]
 *        Positions as fractions of maxScroll, recomputed whenever the document
 *        changes height. Omit for a plain rule.
 */
export function createScrollProgress({ marks } = {}) {
  const el = document.getElementById('progress');
  if (!el) return { dispose() {} };
  const fill = el.querySelector('.progress__fill');
  if (!fill) return { dispose() {} };

  let last = -1;
  let lastHeight = -1;
  let revealed = false;

  function layoutMarks() {
    if (!marks) return;
    let list;
    try { list = marks() || []; } catch { return; }
    // Rebuild wholesale: there are five of these, not five hundred.
    el.querySelectorAll('.progress__mark').forEach((n) => n.remove());
    const frag = document.createDocumentFragment();
    for (const m of list) {
      const at = Math.min(1, Math.max(0, m.at));
      if (!(at > 0) || at >= 1) continue;          // 0 and 1 are the rule's own ends
      const i = document.createElement('i');
      i.className = 'progress__mark' + (m.kind === 'portal' ? ' progress__mark--portal' : '');
      i.style.left = `${(at * 100).toFixed(3)}%`;
      frag.appendChild(i);
    }
    el.appendChild(frag);
  }

  function write() {
    const y = scrollY;
    if (!revealed && y > REVEAL_AT) { revealed = true; el.classList.add('is-live'); }

    const docHeight = document.documentElement.scrollHeight;
    if (docHeight !== lastHeight) { lastHeight = docHeight; layoutMarks(); }

    const max = docHeight - innerHeight;
    const p = max <= 0 || y <= 0 ? 0 : y >= max ? 1 : y / max;
    if (Math.abs(p - last) < 0.0004) return;    // sub-pixel on any plausible viewport
    last = p;
    fill.style.transform = `scaleX(${p.toFixed(5)})`;
  }

  addEventListener('scroll', write, { passive: true });
  addEventListener('resize', write);
  write();                                      // a reload lands mid-page with the rule already correct

  return {
    /** Re-read the marks now, without waiting for the document to change height. */
    refresh() { lastHeight = -1; write(); },
    dispose() {
      removeEventListener('scroll', write);
      removeEventListener('resize', write);
    },
  };
}
