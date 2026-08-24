/**
 * js/state.js — the scene state contract, as data. Imports nothing, so the
 * static (no-WebGL) path can use it without ever touching three.js.
 * The table of meanings lives in CONTRACTS.md §10.
 */
export const STATE_DEFAULTS = Object.freeze({
  morph: 0, spread: 0.45, drift: 0.006, size: 1.45, opacity: 1, tone: 0,
  accentMix: 0, accentR: 0.78, accentG: 0.50, accentB: 0.22,
  camZ: 5.6, camY: 1.15, lookY: 1.05, rotY: 0, tiltX: 0,
  repel: 0.26, repelRadius: 0.055,
  swirl: 0, sweep: 0,   // the ending: vortex spin rate (rad/s at the centre) and the sweep off-screen (0..1)
});
