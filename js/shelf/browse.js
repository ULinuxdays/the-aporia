/**
 * js/shelf/browse.js — the continuous shelf controller.
 *
 * One number, `offset` (metres along the shelf), is the whole browsing state.
 * Drag (with inertia), wheel, ← →, the two buttons and the position markers
 * all write to it; on release it snaps to the nearest book. The camera reads
 * it every frame. Moves are anime.js tweens so the page and the shelf share
 * one motion language.
 */

import { animate } from 'animejs';

export function createBrowser({ canvas, positions, onChange, onSelect, pick }) {
  const state = { offset: positions[0], enabled: true };
  const x0 = positions[0], x1 = positions[positions.length - 1];
  let current = -1;
  let tween = null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const nearest = (x) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < positions.length; i++) { const d = Math.abs(positions[i] - x); if (d < bd) { bd = d; best = i; } }
    return best;
  };
  const clamp = (x) => Math.min(x1 + 0.04, Math.max(x0 - 0.04, x));
  const stop = () => { if (tween) { tween.pause(); tween = null; } };

  function announce() {
    const i = nearest(state.offset);
    if (i !== current) { current = i; onChange?.(i); }
  }

  function goTo(i, { duration } = {}) {
    i = Math.max(0, Math.min(positions.length - 1, i));
    stop();
    const dist = Math.abs(positions[i] - state.offset);
    tween = animate(state, {
      offset: positions[i],
      duration: reduced ? 120 : duration ?? Math.min(1100, 320 + dist * 900),
      ease: 'outExpo',
      onUpdate: announce,
      onComplete: announce,
    });
    return tween;
  }
  const step = (n) => goTo(nearest(state.offset) + n);
  const snap = () => goTo(nearest(state.offset));

  // ---- drag with inertia
  let dragging = false, downX = 0, downY = 0, lastX = 0, lastT = 0, vel = 0, startOffset = 0, moved = false;
  const PX_PER_M = () => canvas.clientWidth / 0.85;    // how much shelf one viewport width covers at browse distance

  function onDown(e) {
    if (!state.enabled || e.button > 0) return;
    dragging = true; moved = false;
    downX = lastX = e.clientX; downY = e.clientY; lastT = performance.now(); vel = 0;
    startOffset = state.offset;
    stop();
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-dragging');
  }
  function onMove(e) {
    if (!dragging) return;
    const now = performance.now();
    const dx = e.clientX - downX;
    if (Math.abs(dx) > 6 || Math.abs(e.clientY - downY) > 6) moved = true;
    state.offset = clamp(startOffset - dx / PX_PER_M());
    const dt = Math.max(1, now - lastT);
    vel = 0.6 * vel + 0.4 * (-(e.clientX - lastX) / PX_PER_M()) / dt; // m per ms
    lastX = e.clientX; lastT = now;
    announce();
  }
  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('is-dragging');
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
    if (!moved) {
      // a click: select the centred book, or travel to the one under the pointer
      const hit = pick?.(e.clientX, e.clientY);
      if (hit != null) { if (hit === nearest(state.offset) && Math.abs(positions[hit] - state.offset) < 0.02) onSelect?.(hit); else goTo(hit); }
      return;
    }
    // inertia, then snap
    const target = clamp(state.offset + vel * 260);
    goTo(nearest(target));
  }

  // ---- wheel: either axis scrolls the shelf
  let wheelTimer = 0;
  function onWheel(e) {
    if (!state.enabled) return;
    e.preventDefault();
    stop();
    const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * (e.deltaMode === 1 ? 16 : 1);
    state.offset = clamp(state.offset + d / PX_PER_M() * 0.9);
    announce();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(snap, 140);
  }

  // ---- keys
  function onKey(e) {
    if (!state.enabled) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); goTo(0); }
    else if (e.key === 'End') { e.preventDefault(); goTo(positions.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { if (document.activeElement === document.body || document.activeElement === canvas) { e.preventDefault(); onSelect?.(nearest(state.offset)); } }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  addEventListener('keydown', onKey);

  announce();
  return {
    state,
    goTo, step, snap,
    get current() { return nearest(state.offset); },
    setEnabled(v) { state.enabled = v; if (!v) { stop(); dragging = false; } },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel); removeEventListener('keydown', onKey);
    },
  };
}
