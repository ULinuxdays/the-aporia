# CONTRACTS — interfaces every part of the site agrees on

Read BRIEF.md first. This file is the source of truth for file formats,
module APIs, coordinate conventions and directory layout. If you add an
interface in a later part, add it here. If you change one, change it here
*and* every consumer, in the same session.

## 1. Directory layout

```
The Aporia Web/
├── BRIEF.md                 what we're building and why
├── CONTRACTS.md             this file
├── index.html               the page: copy, acts, masthead, colophon, the gate to the shelf
├── shelf.html               The Complete Shelf — the issues, as a 3D library (§16)
├── css/
│   ├── styles.css           type, layout, colours; the .act heights ARE the choreography (§12)
│   └── shelf.css            the shelf page
├── js/
│   ├── clouds.js            point-cloud loader       (part 1; int16-aware since part 5)
│   ├── state.js             the state defaults as data (no three.js) — the static path's only scene import
│   ├── shapes.js            the seven morph targets  (part 2, stable)
│   ├── scene.js             THREE.Points + shader    (part 2, stable)
│   ├── main.js              scroll choreography      (part 3)
│   ├── page.js              DOM mechanics: jargon field, swap, marginalia, covers (part 4)
│   ├── normals.js           per-point normal estimation (local PCA)
│   ├── normals-worker.js    runs normals.js off the main thread
│   ├── curtain.js           the grain curtain both pages draw (§15)
│   └── shelf/               main.js · books.js · scene.js · browse.js · inspect.js · ui.js  (§16)
├── assets/
│   ├── shelf/
│   │   ├── manifest.json    the 19 books (§16)
│   │   └── mint/            Mint GLBs land here via tools/import-mint.mjs (empty until the MCP is used)
│   └── clouds/
│       ├── thinker.bin      baked point cloud   (part 1)
│       ├── epicurus.bin     baked point cloud   (part 1)
│       └── manifest.json    metadata for both   (part 1)
├── vendor/
│   ├── animejs/             anime.js v4.5.0, ESM, MIT  (+ LICENSE.md)
│   └── three/               three.js r185 (npm 0.185.0), MIT  (+ LICENSE)
│       ├── build/three.module.js, three.core.js
│       └── examples/jsm/controls/OrbitControls.js   (smoke test only)
├── tools/
│   ├── bake.mjs             Node-only. Bakes assets/clouds/. Never shipped to the browser.
│   └── import-mint.mjs      Node-only. Links Mint-generated books into the shelf manifest.
├── smoke-test.html          THROWAWAY. Part-1 visual check. Delete once the owner signs off.
└── particles-test.html      THROWAWAY. Part-2 morph slider. Delete once the owner signs off.
```

Everything in the folder is what gets dragged to Netlify. Keep junk out.

## 2. Module loading

Every HTML page must declare this import map **before** any
`<script type="module">`:

```html
<script type="importmap">
{
  "imports": {
    "three":   "./vendor/three/build/three.module.js",
    "animejs": "./vendor/animejs/anime.esm.js"
  }
}
</script>
```

Why it is mandatory, not cosmetic: `vendor/three/examples/jsm/**` and
`vendor/animejs/adapters/three/**` both `import ... from 'three'` with the
bare specifier. Without the map they fail to resolve, and with a *different*
path for `three` you get two copies of the library and `instanceof` breaks.

Application code uses the bare specifiers:

```js
import * as THREE from 'three';
import { animate, onScroll, createTimeline, stagger, utils, svg } from 'animejs';
```

No bundler, no `node_modules`, no CDN. `js/clouds.js` imports nothing.

## 3. Point-cloud binary format — `assets/clouds/<name>.bin`

- Raw little-endian, no header, no footer. **Default dtype is `int16`**
  (part 5): each coordinate × 32767, rounded; `manifest.json` records
  `dtype` and `scale` per cloud and `loadAllClouds()` dequantises to
  Float32. `--dtype float32` is still available. Precision of int16 on a
  height of 1 is 1.5e-5 units; Float32 compressed no better than int16 raw, so
  int16 halves the transfer outright (1.44 MB → 0.72 MB).
- Layout: `x0 y0 z0 x1 y1 z1 …` — interleaved XYZ triples.
- `byteLength === pointCount * 6` (int16) or `* 12` (float32). Current pointCount is
  **60 000** per model (360 000 bytes each as int16).
- **Point order is random** (each point is an independent area-weighted
  draw). Any prefix of the array is itself a valid, uniformly distributed,
  lower-density cloud. Mobile / low-power tiers should take a prefix, never
  re-sample.
- The bake is **deterministic** for a given seed (default 1). Re-running
  `tools/bake.mjs` without changing inputs reproduces the bytes exactly.

### Coordinate frame (applies to every cloud, and to every shape later parts generate procedurally)

- three.js default: **+Y is up**, right-handed.
- **Height is exactly 1.0**: `min(y) === 0`, `max(y) === 1`.
- **Centred on X and Z by bounding box**: `min(x) === -max(x)`,
  `min(z) === -max(z)`.
- Width / depth are whatever the model's proportions give; see
  `manifest.json → bbox` for exact extents.
- Facing: both models' **fronts point +Z**, i.e. at a camera placed on +Z
  looking at the origin (the default three.js camera). Verified by eye in the
  part-1 smoke test. The Thinker needed no correction; the Epicurus scan
  faced -Z and is yawed 180° in the bake (`yawDegrees` in the manifest). If a
  future model faces the wrong way, fix it in the bake (`yaw` in `MODELS`),
  never in the renderer.

Procedural shapes for Act IV (crowd/network, device/circuit, drifting cloud)
and the Act V wordmark must be generated into this same frame so the morph
targets line up without per-shape fudge factors.

## 4. `assets/clouds/manifest.json`

```jsonc
{
  "version": 1,
  "generated": "<ISO-8601 UTC>",
  "generator": "tools/bake.mjs",
  "format": { "dtype": "float32", "layout": "xyz-interleaved", "endian": "little", "up": "+Y" },
  "clouds": {
    "thinker": {
      "file": "thinker.bin",
      "bytes": 720000,
      "pointCount": 60000,
      "source": "the-thinker-at-the-musee-rodin-france-1.stl",
      "sourceTriangles": 837482,          // before any stripping
      "bakedTriangles": <n>,              // after raft strip
      "sourceUp": "+Z",
      "sourceUnits": "mm",
      "raft": { "stripped": true, "zThresholdSource": <mm>, "method": "<short description>" },
      "bbox": { "min": [x, 0, z], "max": [x, 1, z] },
      "seed": 1,
      "attribution": ""                   // OWNER FILLS IN. Licence + creator + URL.
    },
    "epicurus": { ...same shape, "sourceUp": "+Y", "raft": { "stripped": false } ... }
  }
}
```

`attribution` is blank on purpose and must be filled in by the owner before
the site goes public.

## 5. `js/clouds.js` — loader API (stable from part 1)

```js
import { loadCloud, loadAllClouds, CLOUD_URLS } from './js/clouds.js';

// Fetch one .bin. Resolves to a Float32Array of length 3 * pointCount
// (int16 files are dequantised with the given scale). NEVER throws. Resolves
// to `null` if the file is missing (404), the network fails, the response is
// empty, or byteLength is not a whole number of triples.
const pts = await loadCloud('assets/clouds/thinker.bin', { dtype: 'int16', scale: 1 / 32767 });
// loadAllClouds() reads manifest.json first and passes each cloud's dtype/scale itself.

// Fetch both in parallel. Resolves to { thinker, epicurus }; each value is a
// Float32Array or null, independently. Never throws.
const { thinker, epicurus } = await loadAllClouds();

// The URLs it uses, relative to the page. Override by passing a base:
//   loadAllClouds('/some/other/base/')  →  '/some/other/base/thinker.bin'
CLOUD_URLS // { thinker: 'assets/clouds/thinker.bin', epicurus: 'assets/clouds/epicurus.bin' }
```

Consumers must handle `null` by falling back to a procedural shape so the
page can be developed without the bake having run. Do not treat `null` as an
error in production either: a missing cloud should degrade, not blank the
page.

Paths are relative to the *document*, not to `clouds.js`, because the page is
served from the folder root on Netlify and `index.html` lives at the root.

## 6. `tools/bake.mjs` — the asset bake

Run by hand, on the developer's machine, Node ≥ 18, zero dependencies:

```
node tools/bake.mjs                         # bakes both, 60 000 points each
node tools/bake.mjs --only thinker          # or --only epicurus
node tools/bake.mjs --points 80000          # different budget
node tools/bake.mjs --seed 7                # different (still deterministic) sample
node tools/bake.mjs --thinker <path.stl> --epicurus <path.obj>   # other sources
```

Defaults point at the source scans listed in BRIEF.md. The script:

1. Parses binary STL / Wavefront OBJ with its own readers (no npm).
2. STL only: detects and strips the printer raft. Method — **footprint
   drop**: slice the bottom 10 % of the height into 256 thin Z slices and
   measure each slice's XY bounding-box area. A raft is by construction wider
   than the part's first layer (slicers add a margin), so the raft is the
   contiguous bottom band whose footprint is ≥ 0.8 × the largest footprint
   seen; the threshold is the top edge of that band, and every triangle
   whose centroid lies below it is discarded. This copes with multi-layer
   rafts that have gaps between layers (the Thinker's does: underside at
   z=0, strand layers at ~0.9 and ~1.8 mm, top slab at 2.7–3.3 mm). Sanity
   checks abort the bake instead of guessing if the footprint does not
   actually drop above the band or the band is > 5 % of the height. The
   derived threshold (3.301 mm for the Thinker, 2.54 % of height) is
   recorded in the manifest.
3. Rotates Z-up sources to Y-up: `(x, y, z) → (x, z, -y)`. Applies any
   facing correction about Y (`yaw`, recorded in manifest as `yawDegrees`;
   Epicurus = 180).
4. Samples N points uniformly **by triangle area** (cumulative area table +
   binary search, uniform barycentric coordinates). Never per vertex.
5. Normalises the *sampled* cloud: centre on X/Z by bbox, min y → 0,
   scale so max y === 1.
6. Writes `<name>.bin` + updates `manifest.json`. Prints sizes and counts.

It refuses to modify or copy the source files.

## 7. Smoke test — `smoke-test.html` (throwaway)

Serves each baked cloud as raw `THREE.Points` with `OrbitControls`. Exists
only so the owner can confirm by eye that the Thinker is intact, the raft is
gone, and Epicurus is upright. Serve the folder with any static server
(`python3 -m http.server 8080`) — `fetch()` and ES modules do not work from
`file://`. Delete the page (and `vendor/three/examples/jsm/controls/`, if
nothing else has come to use it) once part 1 is signed off.

## 8. Stage frame — where things are in world space

Every shape, baked or procedural, lives in one frame so the morph targets line
up without per-shape fudge:

- **Y up, ground at y = 0.** Everything stands on, or floats above, y = 0.
- Things occupy roughly x ∈ [-1.9, 1.9], y ∈ [0, 2.3], z ∈ [-1.4, 1.0].
- **Fronts face +Z.** The default camera sits on +Z looking at the Y axis.
- The monument: plinth 0 → 1.25 (`PLINTH_HEIGHT`), Thinker 1.25 → 2.25.
  Epicurus: 0.4 → 1.85 (bust scaled ×1.45). Crowd figures: 0.44–0.56 tall.
  Device slab: centred y 1.17. Page sheet: 0.26 → ~1.7 on a desk at y 0.26.
  Wordmark: cap height ≈ 0.47, baseline y 1.0, width 3.3; underline y 0.88.
- Camera defaults (`STATE_DEFAULTS`): fov 38°, camZ 5.6, camY 1.15,
  lookY 1.05. The visible height at z = 0 is ≈ 3.9 units. Part 3 moves the
  camera per act (the crowd in particular wants a lower lookY / nearer camZ).

## 9. `js/shapes.js` — the seven morph targets

```js
import { buildAllShapes, buildShape, SHAPE_NAMES, BASE_SHARE, PLINTH_HEIGHT, splitCount, makeRng } from './js/shapes.js';

const { shapes, names, baseCount, formCount, usedStandIn } =
  buildAllShapes(count, { clouds, seed, wordmarkText, wordmarkFont, wordmarkWidth, pageLine, pageFont, crowdSize });
// shapes: Float32Array[7], each EXACTLY count*3, in SHAPE_NAMES order:
//   0 monument · 1 epicurus · 2… lenses · page · wordmark · portal  (indices follow the lens count)
// clouds: the { thinker, epicurus } from loadAllClouds(); null → procedural stand-in (usedStandIn says which)
buildShape(6, count, opts)        // rebuild one (e.g. the wordmark after document.fonts.ready), same length contract
```

**Particle correspondence (do not break this).** Indices are partitioned the
same way in every shape:

| indices | share | meaning, per shape |
|---|---|---|
| `[0, baseCount)` | `BASE_SHARE` = 22 % | the thing underneath: plinth → rubble → network lines → circuit traces → sediment → desk → underline |
| `[baseCount, count)` | 78 % | the form: Thinker → bust → figures → slab → cloud → sheet+line+cursor → letters |

Within each group points are **raster-ordered** over that group's own bbox:
horizontal bands bottom-to-top, left-to-right within a band. So particle *i*
maps bottom-left → bottom-left, top → top, across every transition. This is
what makes the plinth *fall* into rubble in Act III instead of cross-fading.
Anything that reorders, filters or prefixes a shape array must do so
identically for all seven, or the morph turns to noise.

Layouts are seeded (`DEFAULT_SEED`, mulberry32) and identical across reloads.
Shapes 5 and 6 sample text from a 2D canvas, so the text and font are
editable via `opts`; if you change the font after the first build (webfont
load), call `buildShape(6, …)` + `scene.setShape(6, …)`. Without a DOM they
degrade to block glyphs.

Defaults that later parts may want to override: `pageLine` = "I keep coming
back to", `wordmarkText` = "THE APORIA", fonts = Georgia bold / italic.

## 10. `js/scene.js` — the particle field and the STATE CONTRACT

```js
import { createScene, STATE_DEFAULTS } from './js/scene.js';
const scene = createScene(canvas, { count, shapes, onFrame, seed, coldColor, warmColor, parallax, fov });
//  → { state, resize, start, stop, dispose, setShape, renderOnce, three }
scene.start();  // RAF loop; pauses itself while the tab is hidden, resumes on return
```

Throws if WebGL is unavailable or any shape is the wrong length — the caller
owns the no-WebGL fallback.

`onFrame(state, dt)` is called every frame *before* the state is applied and
the scene rendered. `dt` is seconds, capped at 0.1.

**`state` is a plain object of numbers** — animate it directly with anime.js.
Nothing else in the object; no methods, no nested objects.

| key | default | range | meaning |
|---|---|---|---|
| `morph` | 0 | 0 … 6 | continuous shape index. `floor` picks the A/B pair, `fract` is the GPU morph. 6 = wordmark fully resolved. |
| `spread` | 0.45 | 0 … ~2 | world units the burst carries particles outward at the midpoint of *their own* crossing. 0 = straight-line interpolation. |
| `drift` | 0.006 | 0 … ~0.05 | idle wander amplitude. Leave it non-zero: the brief says it never fully settles. |
| `size` | 2.0 | 0.5 … ~6 | point diameter in CSS px at 5 world units from the camera on a 900 px-tall viewport; scales with viewport height and distance. |
| `opacity` | 1 | 0 … 1 | global alpha. |
| `tone` | 0 | 0 … 1 | 0 = cold (marble `coldColor` #e0e6f2), 1 = warm (ink `warmColor` #241c1a). **Each particle flips at its own seeded threshold**, so at tone 0.5 the cloud is half marble / half ink and stays visible against any background grey. The page background must be driven from the same value (part 3, via CSS variables). |
| `accentMix` | 0 | 0 … 1 | how much accent colour. Base-group particles (lines / traces / underline) take it at 100 %, the form at 30 %. |
| `accentR/G/B` | ochre | 0 … 1 | accent colour, sRGB, written straight to the framebuffer (no colour-space conversion). |
| `camZ` | 5.6 | > 0.2 | camera distance from the Y axis. |
| `camY` | 1.15 | | camera height. |
| `lookY` | 1.05 | | the point (0, lookY, 0) the camera looks at. |
| `rotY` | 0 | rad | spin the whole stage about Y. The choreography runs it **0 → 2π monotonically** across the page; see §12 `YAW`. |
| `tiltX` | 0 | rad | tilt the whole stage about X. |
| `swirl` | 0 | rad/s | the ending's vortex: rotation rate about the portal ring's centre, falling off with radius. Accumulated into an angle by the scene. |
| `sweep` | 0 | 0 … 1 | the ending's exit: carries the whole field off the screen along a fixed direction (right and slightly up), staggered per particle. |
| `repel` | 0.26 | 0 … ~1 | pointer repulsion strength: how far (world units at 5 m) a particle under the cursor is pushed aside. 0 turns the interaction off. |
| `repelRadius` | 0.055 | 0 … ~0.6 | the pointer's reach, in viewport-height units (2 = the whole height). |

**Pointer interaction** (after reactbits' ParticleText, on the GPU): the
pointer is tracked in NDC, smoothed, and faded in/out on enter/leave; in the
vertex shader every particle whose projected position lies within
`repelRadius` of it is pushed straight away along the screen by
`(1 − d/R)² · repel · (0.55 + 0.9·seed)`, depth-compensated so the push reads
the same size at any distance, and brightened up to 45 % so the disturbed
grains catch the light. Particles spring back as the smoothed pointer moves
on. Off under `prefers-reduced-motion`. Works on touch (pointerdown/move).

Pointer parallax is layered on top of the camera state (±0.16 in x, ±0.08 in
y, smoothed) and never writes back into `state`. It is 0 under
`prefers-reduced-motion`, or when `parallax: 0` is passed.

Rendering rules (fixed): `NormalBlending`, `depthTest` and `depthWrite` off,
transparent clear — the **page paints the background**, the canvas never does.
`devicePixelRatio` capped at 2. Base alpha is 0.48 so overlap accumulates
tone. A slow idle sway (±0.045 units, off under reduced motion) rides on top
of the pointer parallax.

**Lighting.** Clouds have no normals, so `js/normals.js` estimates one per
point (k=16 nearest neighbours, PCA, smallest eigenvector) plus a confidence
`w` = planarity (≈1 on surfaces, ≈0 on lines and inside fog). main.js runs it
in a module worker (`normals-worker.js`), one shape at a time in scroll
order, and hands results to `scene.setNormals(i, Float32Array(count*4))`;
until they arrive a shape renders unshaded. The shader carries `aNrmA/aNrmB`
like positions and interpolates them across the crossing (confidence drops to
0 mid-flight). Shading is **two-sided** (`|N·L|`, fixed lamp `uLight`
upper-left-front) because PCA fixes the normal's axis but not its sign, plus
a silhouette rim (`1 − |N·V|`) that draws the outline, plus depth fade (near
side of the look point denser than the far side). `uShade` (default 1) scales
all of it. This is what makes the Thinker, the bust and the crowd legible;
lines (wires, traces, underline) and the unformed cloud are left alone by
`w`.

Staggered morph, for anyone tuning it: `t = clamp(fract(morph)·2 − seed, 0, 1)`,
position = smoothstep-mix(A, B, t) + dir·sin(πt)·spread·(0.3 + 1.2·seed);
alpha fades up to 45 % at peak burst. Low-seed particles leave and land
first, and **base-group particles are seeded in [0, 0.4) while the form is in
[0.25, 1)** — so the plinth gives before the Thinker does, the network lines
arrive before the crowd, etc. Consequence for choreography: `spread` is only
visible while particles are mid-crossing; a "tremor" needs `morph` to move a
little (≈ 0.05 moves the base group only).

## 11. Page colour — CSS custom properties written from the scene state

`js/main.js` writes these on `<html>` every frame the value changes (and only
then), from `state.tone` and `state.accentR/G/B`. Style everything with them;
never hardcode a page colour, or the DOM will disagree with the WebGL.

| variable | cold (tone 0) | warm (tone 1) | notes |
|---|---|---|---|
| `--bg` | `rgb(8, 8, 11)` | `rgb(244, 238, 227)` | page ground; **steps at tone 0.5** (never grey — measured: a linear fade put 49 % of the range below 4.5:1 text contrast), softened by a 480 ms CSS transition |
| `--ink` | `rgb(244, 241, 234)` | `rgb(28, 22, 20)` | text |
| `--ink-soft` | ink @ 0.62 | ink @ 0.62 | secondary text |
| `--rule` | ink @ 0.16 | ink @ 0.16 | hairlines |
| `--accent` | `rgb(accentR·255, …)` | | the current lens / invitation accent |

Accents (`ACCENTS` in main.js, sRGB 0..1): sociology ochre (0.78, 0.50,
0.22) · technology blue (0.29, 0.47, 0.94) · undecided grey (0.55, 0.55,
0.58) · invitation red (0.80, 0.32, 0.30). Unapproved as brand tokens; they
are what the scaffold had and what the choreography currently uses.

## 12. Scroll choreography — `js/main.js`

**One master timeline, scrubbed by the page.** `createTimeline({ autoplay:
onScroll({ target: '#scroll', enter: {target:'start', container:'start'},
leave: {target:'end', container:'end'}, sync: 0.35 }) })`. The 0.35 damping
is the page's weight; it lags a fast scroll by up to ~250 px and settles in
well under a second.

**Nothing is positioned by hand.** `measureActs()` reads every
`<section class="act">` from the DOM. An act is *active* while the viewport's
vertical centre is inside it (that is also the midpoint of the hand-over
between neighbouring sticky blocks). Its scroll span in px becomes its span on
the timeline in ms (1 ms = 1 px; the timeline is pinned to `maxScroll`). The
last act ends at its own bottom like the others; anything after it inside
`<main>` (the colophon) scrolls in with the final state held. So:

- To make a beat longer or shorter, **change the section's CSS height** in
  `css/styles.css` (`.act--monument { height: 220vh }` etc.). Nothing else.
- Timing *within* an act is a table of fractions in `choreograph()` —
  `beat(act, f0, f1, { prop: to }, ease)`. `from` values are tracked
  automatically so every property is continuous across the page; the helper
  warns in the console if two beats on one property overlap.
- The timeline is rebuilt (`revert()` + measure + build) on resize /
  orientation change, debounced, only when the document size actually changed.

**Issues are data.** `readLenses()` reads the Act IV covers
(`.cover[data-lens][data-shape][style=--tint]`) and everything below that
mentions a lens is generated from that list: the Act IV beats (one equal slice
per issue, morph `2+k`, accent = tint), the yaw schedule (`YAW.lens[k]`), the
pre-rotation, the page/wordmark indices (`2+N`, `3+N`). Adding an issue is
adding a cover (README).

**Capability and tiers.** `decideMode()` picks the static page or a particle
budget before any heavy import (README has the table). The static page is
`html.static`: CSS grounds per act, both swap phrasings visible, stills in
`assets/static/`, no three.js request at all. The scene is loaded with
`import()` only on the dynamic path; the timeline, reveals, theme and gate
start immediately and the canvas fades in (`#stage.is-ready`) when ready.

**Eased wheel scrolling** (`js/smooth-scroll.js`): wheel deltas accumulate
into a target and the native scroll position is eased toward it each frame
(`lerp` 0.055, ~1.6 s to settle), Lenis-style — the document still scrolls
natively, so `position: sticky`, anchors, keyboard, touch and anime's
observers are untouched. Off under reduced motion and on touch-only devices.
When it is on (`html.smooth`), the master timeline's damping is lightened to
0.65 so the scene isn't smoothed twice. GSAP ScrollSmoother was considered
and rejected: it translates a wrapper, which breaks sticky.

**The scroll cue** (`#scroll-cue`): "Scroll" with a dropping hairline at the
foot of the first screen, under the copy; fades in after 2.4 s, gone for
good once `scrollY > 40`; click eases down one screen.

**The five acts, as currently tuned** (fractions of each act's span):

| act | section | beats |
|---|---|---|
| I   | `.act--monument` 220vh | morph 0. camZ 6.6→6.0 `inCubic` over 0–55 % (the heavy first screenful), →5.2 over 55–100 %; camY 0.95→1.15, lookY 1.3→1.5 (looking up at him). |
| II  | `.act--impasse` 300vh | morph 0. Camera all but stops: camZ 5.2→5.1, lookY 1.5→1.48 over 0–86 %. Last slice: morph 0→0.05 `inExpo` (86–100 %) and spread 0.45→1.6 `inExpo` (84–100 %) — the plinth begins to give. Only the base group moves at morph ≤ 0.05 (§10 seeds). |
| III | `.act--fracture` 340vh | morph 0.05→1 `inOutQuad` over 0–62 % (the bust is formed before the swap list crosses the viewport at ~55–80 %); spread →1.15 (0–28 %) then →0.45 (28–66 %); **tone 0→1 over 16–48 %** — `--bg` flips with it; camZ →4.8 over 0–80 %; camY/lookY →1.15/1.12 over 8–62 % (coming down to eye level). |
| IV  | `.act--lenses` 480vh | thirds. In each third the morph runs over the first 62 % then holds: 1→2 crowd (accentMix 0→0.85; camera camY 1.1, lookY 1.35, camZ 5.8, rotY −0.12 — the crowd becomes a horizon along the bottom, clear of the copy); 2→3 device (accent → technology, camY/lookY 1.15, camZ 4.9, rotY 0.1); 3→4 unformed (accent → undecided, camZ 5.4, rotY 0, drift →0.012). |
| V   | `.act--invite` 380vh | **back to black**: `tone` → 0 over 2–26 % (the ground returns to the cold ink of Act I and the grains to marble), `size` ×1.3 so the sheet reads as a lit page, `tiltX` → 0. |
| V (cont.) | | morph 4→5 over 0–40 % (accent → invitation, camZ 4.3 push-in on the sheet); hold; 5→6 over 55–78 % (accentMix →0.7, the underline takes the red); camZ →6.6 over 55–86 %; hold 78–86 %; **6→7 over 86–98 %: the fall and the portal** (§15), drift left raised. |

`INITIAL` in main.js is the state at scroll 0 (camZ 6.6, camY 0.95, lookY
1.3, everything else at its default). Change it and Act I's `from` values
follow.

**Reveals.** Every `.reveal` gets its own `animate(el, …, { autoplay:
onScroll({ target: <its section>, enter: { target: '<at>%', container:
'center' }, leave: …, sync: 'play reverse' }) })` — playback methods, never
scrubbing. `data-at="0.35"` = play when 35 % of the section has passed the
viewport centre (default: staggered by index, 0.12 apart). `data-leave="0.55"`
= reverse out at that fraction instead of when the section's bottom reaches
the viewport's bottom. Under `prefers-reduced-motion` they fade without
moving.

**Debug.** `index.html?debug` turns on onScroll's own overlay (the ruler with
enter/leave markers, for the master and every reveal), a fixed readout of
scroll / progress / act / morph / tone / spread / accent / camera, a console
print of the measured act spans, and `window.__aporia = { state, scroll,
scene, measureActs }` for scripting. `?expose` sets only `window.__aporia`
(instrumentation without the overlays — what the screenshot harness uses).

**Webfonts.** After `document.fonts.load()` resolves for Caveat and Inter 800,
main.js rebuilds shapes 5 and 6 (`rebuildTextShapesWhenFontsLoad`): the
sheet's half-written line is set in Caveat, the wordmark in Inter 800.

**Fallbacks.** Static page (`html.static`) per `decideMode()`; a renderer that
fails after the decision also falls back to it. Narrow screens (< 720 px) get
a dimmed canvas, a scrim of the page colour behind the copy, the figure lifted
above the copy (`scene.setViewOffset(-0.55)`), and Act III's copy flowing
above the swap list instead of a sticky column.

**The camera moves in one direction.** Two axes, one flow: `rotY` runs
**0 → 2π** across the page and `tiltX` leans **0 → 0.095 rad** across Acts
I–IV, so the turn is a helix rather than a turntable; the lean then settles
back to level exactly once, across Act V, as the wordmark comes up. Neither
axis reverses anywhere else. `rotY` never reverses: head-on at the top, the Thinker turns to full profile
by the end of Act I (π/2), the turn continues through the fracture and the
lenses, and the wordmark arrives exactly as the circle closes. Because the
stage keeps turning, every shape that has a front is **pre-rotated at build
time** by −`YAW[name]` (`preYawShapes()` in main.js) so it faces the camera at
the yaw it resolves at: bust 2.45, crowd 3.1, device 4.12, page 5.95; the
monument is head-on at 0, the unformed cloud has no front, the wordmark reads
at 2π. Edit `YAW` and the choreography together — they are one table. `camY`
only rises (0.75 → 1.38); `camZ` pushes in once (6.6 → 4.8 by Act III) and
pulls out once (→ 6.6); `lookY` rises to look up at him, then comes down once
at the fracture and keeps descending. `tiltX` carries the lean described above.

## 13. Type and page structure — `index.html`, `css/styles.css`

**The type is the argument.** Acts I and II (`.act--monument`, `.act--impasse`)
are set in **Bodoni Moda** (Google Fonts, optical sizing on) on the cold
ground; from Act III on, display and prose are **Inter** on paper. Labels are
IBM Plex Mono; marginalia are Caveat. The switch is done per act in CSS, and
`html:not(.js)` gives each act its own static ground (black for I–II, paper
for III–V), so the thesis survives with JavaScript off. Google Fonts is the
only external request on the page.

**Layout.** Every act has a sticky 100vh block with a three-track grid:
`left` copy column (`--col`, ≤ 28rem) · `stage` (the particles) · `right`
aside (`--aside`, ≤ 24rem). Copy goes left (I, III, IV, V) or right (II);
Act IV's issue cards and Act II's copy use the right track. Act III is the
exception: `.act__cols` makes the left column sticky and lets the right
column **flow**, so the swap list physically travels through the viewport.
Below 64rem everything collapses to one column and Act III shows the swap
list only (the Epicurus copy returns in a later pass — noted in BRIEF.md).

**Colour.** Everything uses the variables in §11. Static defaults are the
cold set. `--pen` (#cc524d) is the student's pen and does not change.

**Placeholders.** Links that do not exist yet carry `.is-placeholder`,
`data-placeholder="…"` and a visible `link pending` tag: the two Issue 01
links, the submission link, the pitch link, the editorial email, and the
scan-attribution line in the colophon.

## 14. DOM mechanics — `js/page.js`

Runs alongside main.js, reads the same sections, never touches `state`.

| mechanic | markup it needs | how it is driven |
|---|---|---|
| Jargon field (Act I) | `#jargon > span[style="--x --y --s --r"]` — a fixed layer; words are positioned in the centre band so they crowd the monument, not the copy | fade-in scrubbed over `.act--monument` (start → 75 % past centre); scatter scrubbed over `.act--fracture` (top at 85 % of the viewport → 40 % past centre), each word flying away from the screen centre. `.is-floating` adds a CSS idle drift (off under reduced motion). |
| The swap (Act III) | `#swap-list > li.swap[data-from][data-to]` containing `.swap__from` (aria-hidden) and `.swap__to` (the accessible text). page.js adds `.swap__live`. All three share one grid cell, so the row is sized by the longer phrasing and never reflows. | one `animate(lives, { textContent: scrambleText({ text: to, from: 'left', override: false, delay: stagger(260), duration: 1500 }) })`, scrubbed with `sync: 0.35` while the list travels from 82 % to 34 % of the viewport. Rows switch from Didone to Inter as their wave passes 45 %. **The stagger must be passed inside `scrambleText`** — it returns its own per-tween delay. |
| Marginalia | `svg[data-marg="n"]` (paths only) + `[data-marg-note="n"]` (Caveat note), positioned relative to a `.marg-anchor`. Four on the page: I underline + "says who?", II arrow + "wait, is this actually true?", III arrow + "every deadline I have ever had" (on the akrasia row), V loop + "this one". | `svg.createDrawable(paths)` drawn `'0 0' → '0 1'` in a small timeline scrubbed (`sync: 0.5`) against the host (`section.act` at fractions past centre, or the row's own position for III). Thresholds are the `specs` table at the top of `marginalia()`. Keep it to three or four; sparse reads as wit. |
| Issue covers (Act IV) | `.covers.reveal > article.cover[data-lens="0|1|2"][style="--tint: r, g, b"]` — three magazine covers fanned in a stack (CSS vars `--rot/--dy/--sc/--fade` per lens). The reveal lives on the container, never on a cover: the reveal tween writes inline transforms. | three standalone `onScroll` observers over the thirds of `.act--lenses` toggle `.is-active`; the active cover comes to the front and straightens. |

To add a marginalia: drop an `<svg class="marg … " data-marg="5">` with one or
more `<path>` next to a `.marg-anchor`, optionally a `[data-marg-note="5"]`,
add a line to `specs`, and position it in CSS. Paths use
`vector-effect: non-scaling-stroke` so they can be stretched with
`preserveAspectRatio="none"`.

## 15. The portal, and the way through to the shelf

`shelf.html` is reachable from exactly one place: the end of Act V, as a
particle event.

**The ending.** The wordmark settles (Act V 78 %), holds (78–86 %), then every
grain falls — `spread` 0.06, no burst, low seeds first so the underline gives
before the letters — into a heap on the ground, while the underline itself
rises into a **ring** at eye level and a **vortex** of three arms winds inside
it. That is shape 7, `portal` (`buildPortal` in shapes.js; the ring's centre
and radius are exported as `PORTAL`). Base-group particles carry the accent at
full strength, so the ring and its sparks burn orange. The vortex turns:
`state.swirl` (rad/s) is accumulated into `uSwirl` and applied in the vertex
shader as a rotation about `uPortal` with a `1/(0.16 + r²·4)` falloff, so inner
grains spin fast and the heap barely moves. There is no image and no video
anywhere in this — it is all the same 90 k particles.

**The hit area.** `#portal` is an empty circular `<a href="shelf.html">` with a
visually-hidden label, placed over the ring each frame by projecting the ring's
centre and rim through the scene camera (`createPortal()` in main.js →
`--px/--py/--pr`), live once `--pt` opens (morph 6.55 → 7). A pen arrow and
"go on, click it" (`#portal-note`) are drawn on with the vortex by the
marginalia mechanism (§14).

**Going through.** Clicking runs one line of travel, bottom-left → top-right,
across both pages. On the landing page (main.js, ~1.15 s):

1. *the storm* — `swirl` → 9, `drift`, `spread` and `size` up, and the world
   inverts: `tone` → 0 so the ground snaps to black and the grains turn to
   marble, `accentMix` → 1. The heap is drawn up off the floor into the vortex.
2. *the rush and the cover* — `swirl` → 34 and `sweep` 0 → 1 carries the whole
   field up and to the right (`SWEEP_DIR` in scene.js, staggered per particle
   so it streaks), the camera pushes in, and a **grain curtain**
   (`js/curtain.js`) closes over the viewport along the same diagonal.
3. At `p = 1` the viewport is solid, and only then does the page change. There
   is nothing to see at the cut, so the two pages never have to agree on
   anything but the direction of travel.

`js/curtain.js` is a 2D canvas both pages draw from the same seed: one diagonal
edge with a fringe of grains riding on it. `draw(p, 'cover')` fills *behind*
the edge (the landing page); `draw(p, 'uncover')` fills *ahead* of it (the
shelf). It is not WebGL because at the hand-over the screen is covered — what
matters is that both halves move alike.

A `sessionStorage` flag (`aporia:portal`) tells the next page it is mid-move,
and a hard 1.5 s timeout guarantees navigation even if a frame is dropped.
`index.html?slow` stretches the whole transition ×4 for tuning.

**Arriving.** `shelf.html` reads that flag inline in `<head>` and adds
`html.arriving`, which keeps `<body>` hidden. js/shelf/main.js puts the curtain
up at `p = 0` (still solid) before anything else, adds `.curtained` to reveal
the body underneath it, and once the room has rendered runs
`draw(p, 'uncover')` 0 → 1 over 1.15 s — the same edge, still travelling
up-right, uncovering the shelf from the bottom-left — while the camera settles
in from behind and to the left. The flag is consumed on arrival, so a reload or
a direct visit is an ordinary page load.

**Reduced motion, static page.** Under `prefers-reduced-motion` the click is an
ordinary navigation (and the flag is cleared, so the shelf does not try to
continue a move that never happened). On the static page (§12) there are no particles, so the
portal is hidden and the colophon shows a plain text link instead
(`.shelf-link`), which is also what a no-JS visitor gets. Nothing else links to
the shelf — the Act IV covers keep their `link pending` placeholders. The page
is `noindex`; direct visits are not redirected.

## 16. The Complete Shelf — `shelf.html`, `js/shelf/*`

A second page, same stack rules (vendored three + anime, import map, no
build). A reading room: a full walnut bookcase (end uprights, crown, plinth,
shelves above and below the issue run), a deep green linen back, brass
picture lights, objects on the upper shelf (stacked cloth volumes, a brass
bookend, a ceramic vessel, a small stone head), stacked volumes and document
boxes below, a warm lamp that follows the camera, a CSS vignette. Serif type,
muted clothbound covers. Units are metres; the case runs along +X.

**The manifest is the product** — `assets/shelf/manifest.json`:

```jsonc
{ "version": 1, "units": "cm", "books": [ {
  "id": "book-07", "number": 7,
  "title": "Unwritten", "line": "Not yet. This one is whatever you talk us into.",
  "status": "out" | "progress" | "open" | "unwritten",
  "cloth": "#9a8268",                       // board colour
  "foil": { "motif": "roundel|grid|lozenge|rule|stroke", "color": "#caa46a" } | null,
  "size": { "w": 16.4, "h": 24.8, "d": 3.1 },   // cover width, height, thickness, cm
  "file": null | "assets/shelf/mint/book-07/optimized_glb.glb",
  "requiresDraco": false, "transform": { "yaw": 0 },
  "href": null | "#TODO-…", "attribution": ""
} ] }
```

The planned run is 19 volumes: 01–03 are real (out / in progress /
undecided), 04–19 are **unwritten** — plain cloth, blind-stamped, no foil —
which is what the colophon says in words.

**Books** (`books.js`). `file: null` → a procedural hardcover: two cloth
boards, a rounded cloth spine, an inset page block with ruled edges, foil
stamped on the spine (number, title reading top-to-bottom, motif, the
publisher's mark) and the front board (motif, title, issue number), all drawn
on canvases in Bodoni Moda / IBM Plex Mono after the fonts load. `file` set →
a Mint GLB through one shared `GLTFLoader` + `DRACOLoader` (decoder
self-hosted under `vendor/three/examples/jsm/libs/draco/gltf/`), normalised
to the manifest height, centred, stood on y = 0; a failed load falls back to
the procedural book. Both return a Group in the **book frame**: thickness
along X, height along Y, spine facing +Z, front board facing +X.

**Room** (`scene.js`): ACES tone mapping, PCF shadows, a warm SpotLight that
travels with the camera, a cool fill, a low-intensity RoomEnvironment so foil
and brass reflect something, exponential fog into the room's dark. The issue
shelf is one uninterrupted run; bay dividers exist only on the shelves above
and below. The camera is boxed so nothing unbuilt can appear: browsing clamps
`offset` to the first/last book ±4 cm, and inspection (below) has hard orbit
limits.

**Plaque** (`plaque.js`): the centred book is named by an engraved brass
plaque (`ISSUE NN · title · status`, canvas-drawn, re-engraved on change) on
the front edge of the issue shelf; it slides along the lip to the centred
book. Clicking it opens that book. There is no floating DOM caption; a
visually-hidden live region speaks the same text.

**Browse** (`browse.js`): one number, `offset` (metres). Inputs: pointer drag
with inertia, wheel on either axis, ← → Home End, the two arrows, the 19
position markers (real issues labelled). Snaps to the nearest book; the
centred book lifts 8 mm and gets the title plate. A click on the centred book
(or Enter / Space / "Take it down") opens it; a click on another book travels
to it. Moves are anime.js tweens (`outExpo`).

**Inspect** (`inspect.js`): the book slides out of the row, turns its front
board to the camera and comes forward; the camera eases in; then
`OrbitControls`, **limited**: azimuth ±40°, tilt ±22° from level, distance
0.3–0.85 m, and the orbit centre is clamped to a 24 × 20 × 8 cm box around the
book every frame, so pan can never leave the set. Esc / "Put it back"
reverses it in one motion. One book out at a time; browsing is disabled while
it is.

**UI** (`ui.js`): masthead (back link, title, count), markers, arrows, a
"Take down …" button, hint line, inspection panel with number / title / line / status /
link (placeholders still marked). No provider chrome anywhere in the UI.
Keyboard complete; `prefers-reduced-motion` collapses every move; no WebGL or
no JS shows the run as a list.

**Mint pipeline** (`tools/import-mint.mjs`, Node only). The MCP is registered
in Claude Code (`claude mcp add --transport http mint https://mcp.mint.gg/mcp`)
but needs an OAuth login (`/mcp`) before it can generate anything. Then, per
book: save the `get_asset_artifact_manifest` result to a temp file and run
`node tools/import-mint.mjs --manifest /tmp/book-07.json --book 07`. That
calls the skills pack's `sync-mint-assets.mjs` (registry `mint-assets.json`,
asset root `assets/shelf/mint/`), records Draco/extension requirements, and
points the manifest entry at the local GLB. `--unlink` returns a book to
procedural. Per the pack's invariant, once Mint has generated a book, keep
it — do not regenerate it procedurally. The browser never calls the MCP.
Generation prompts should ask for low-poly, real-world scale, spine facing +Z,
and the manifest's cloth / foil / size for that book.

## 17. Things that are NOT contracts yet (decide in later parts, then record here)

- The accent palette (§11) and `--pen` are working values, not approved brand
  tokens.
- Small screens: Act III currently hides the Epicurus copy below 64rem; the
  jargon field and marginalia notes are hidden there too.
- The reduced-motion treatment of the morph itself (currently unchanged; the
  reveals and the jargon drift already respect it).
- Real URLs for every `.is-placeholder` link, the domain in the OG/canonical
  tags, and the scan attribution strings (`#attribution` in the colophon).
- Mint: the OAuth login and the first generated book; a `mintProject` entry in
  `mint-assets.json` (the pack wants one Mint Project per codebase).
