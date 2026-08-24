# THE APORIA — landing page brief

Read this file and CONTRACTS.md before doing anything. They replace being
re-briefed. If something you need is not in here, it was never specified —
decide it, then write the decision down here so the next session inherits it.

## Mission

The Aporia is a student-run philosophy magazine.

The main problem it exists to solve: students find philosophy intimidating,
and the intimidation pushes them away before they ever meet the ideas.

The secondary problem: the students who *are* interested have nowhere to
publish opinionated work. Venues exist for rigorous academic argument. Almost
none exist for intuitive, playful, unfinished takes — philosophy applied to
ordinary life, an argument about whether some position is even liveable. The
Aporia is that venue.

Every issue takes an interdisciplinary angle:

- Issue 01 — the philosophy of sociology
- Issue 02 — the philosophy of technology
- Issue 03 — open / undecided

## Central device

Rodin's *Thinker* is the world's icon of philosophy-as-intimidation: bronze,
on a plinth, above eye level, straining. The page opens by presenting him
reverently and then dismantles him.

Everything on the page is rendered as a **particle cloud** that comes apart
and reassembles as something else. That is also what "aporia" (ἀπορία,
"without passage") means — no way through, the productive dead end.

## Storyboard — five acts, driven by scroll

| Act | Name          | What happens |
|-----|---------------|--------------|
| I   | THE MONUMENT  | The Thinker on a plinth. Black ground, cold marble particles, academic jargon orbiting him. Deliberately unwelcoming. |
| II  | THE IMPASSE   | The scroll stalls. Nothing resolves. The word "aporia" is defined. This beat is the magazine's name, made literal. |
| III | THE FRACTURE  | The plinth collapses. The Thinker dissolves and reforms as the **bust of Epicurus**. Background flips from black to warm paper; particles from marble to ink. Epicurus argued philosophy exists to improve ordinary life, and taught anyone who showed up. |
| IV  | THE LENSES    | Epicurus dissolves through one shape per issue: a **crowd wired into a network** (sociology), a **device with circuit traces** (technology), an **unformed drifting cloud** (undecided). Each has its own accent colour. |
| V   | YOUR TURN     | The ground returns to black. A blank page with a cursor, lit in the dark, then the wordmark THE APORIA, which never fully settles — and finally falls into the portal to the shelf. |

## Stack — non-negotiable

- Plain HTML / CSS / JS. **No npm for the site, no build step for the site.**
  ES modules loaded directly by the browser.
- **anime.js v4** (MIT) drives *all* scroll work via `onScroll`. Vendored at
  `vendor/animejs/anime.esm.js` (v4.5.0, single-file ESM bundle).
- **three.js** renders. Vendored at `vendor/three/` (r185 / npm 0.185.0).
- Both are served from `vendor/`, never from a CDN.
- Deploys by dragging the project folder onto Netlify. Anything that needs a
  server-side step is wrong. The only "tooling" is `tools/bake.mjs`, a Node
  script run by hand on the developer's machine; the browser never runs it.

## Assets — point clouds, pre-baked

The Thinker and Epicurus are not loaded as meshes in the browser. They are
baked offline into raw point clouds (`assets/clouds/*.bin`) by
`tools/bake.mjs`. The browser only ever fetches a Float32Array. See
CONTRACTS.md for the exact format and the loader API.

Sources (outside the repo; never copied in, never modified):

- `/Users/uday/Desktop/Position papers/the-thinker-at-the-musee-rodin-france-1.stl`
  — binary STL, 837,482 triangles, Z-up, millimetres, with a thin flat printer
  raft fused to the base which the bake detects and strips.
- `/Users/uday/Desktop/Position papers/Epikur_Timvias.obj`
  — Wavefront OBJ, Y-up, 565,677 vertices, 1,130,836 faces, 122 MB. A bust of
  Epicurus cut off at the chest.

Licence / attribution for both scans is **not yet recorded** — the
`attribution` field in `assets/clouds/manifest.json` is left blank for the
owner to fill in. Do not ship without it.

## Work plan — five parts

1. **Foundation + asset pipeline** (this part, done 2026-08-21): BRIEF.md,
   CONTRACTS.md, vendored libs verified, `tools/bake.mjs`, baked clouds,
   `js/clouds.js` loader, a throwaway smoke-test page.
2. **Particle system** (done 2026-08-21): `js/shapes.js` (seven morph
   targets, 22 % base / 78 % form correspondence, raster-ordered),
   `js/scene.js` (one THREE.Points, GPU morph, state contract in
   CONTRACTS.md §10), throwaway `particles-test.html`.
3. **Scroll choreography** (done 2026-08-21): `js/main.js` — one damped
   master timeline measured from the `.act` sections (CONTRACTS.md §12),
   CSS colour variables written from the state (§11), per-element reveals,
   `?debug` mode. Plus a *structural* `index.html` / `css/styles.css` with
   placeholder copy so there was something to measure.
4. **Copy, type, DOM mechanics** (done 2026-08-21): real copy for all five
   acts, masthead and colophon; Bodoni Moda → Inter as the typographic
   argument (survives no-JS); the jargon field, the jargon→plain swap, four
   marginalia, the issue cards (`js/page.js`, CONTRACTS.md §13–§14).
   Placeholder links are marked `link pending`.
5. **The Complete Shelf** (done 2026-08-21): `shelf.html` — the issues as a
   3D library (CONTRACTS.md §16): 19 clothbound volumes on a continuous
   walnut shelf, three written and sixteen unwritten, browse by drag / wheel
   / keys / arrows / markers, take one down to orbit it. Procedural books
   today; Mint GLBs slot in via `tools/import-mint.mjs` once the MCP login is
   done. Reachable only from the gate at the very end of the landing page (§15).
6. **Ship** (done 2026-08-21): a first-class static page (reduced motion,
   weak devices, software/no WebGL) that never fetches three.js; particle
   budgets by tier; int16 clouds; anime.js as one file; the ground steps at
   the flip so text contrast never dips; mobile scrim and framing; focus
   styles, skip link, heading order; favicon, OG tags, social image, README.
   Still yours to do: the real links, the domain in the OG tags, and the
   scan attribution strings (not invented — ask the owner).
   Each later part should read this file and CONTRACTS.md first, and extend
   CONTRACTS.md when it adds an interface.

## Decisions already made (don't re-litigate)

- An earlier scaffold (a full `index.html`, `css/styles.css`, `js/scene.js`,
  `js/shapes.js`, `js/model.js`, `js/config.js`) was audited on 2026-08-21 and
  **deleted**. It was built for a different concept — runtime sampling of an
  optional `.glb` via GLTFLoader + MeshSurfaceSampler, a procedural stand-in
  figure, an Act III with no Epicurus, issue *cards* instead of lens shapes,
  and a `js/main.js` that never existed. None of it matched this brief, and
  none of it was verified. Its vendored libraries were correct and were kept.
  The `three/examples/jsm` loaders it pulled in were removed; only
  `OrbitControls` (for the smoke test) is kept from `examples/jsm`.
- Point clouds are baked, not sampled at runtime. 60,000 points per model,
  area-weighted. Runtime sampling of a 122 MB OBJ in the browser is not an
  option and never was.
- Coordinate convention everywhere is three.js default: **Y up**, unit height,
  feet on y = 0, centred on X and Z, front facing +Z. See CONTRACTS.md.
- The Epicurus bust is cut on an oblique plane, so when its lowest point
  rests on y = 0 it touches the ground at the front edge only and the rest of
  the cut floats. That is the source geometry, not a bake error. Whether Act
  III wants it raised onto something is a later-part decision.

## Draft copy from the discarded scaffold (SUPERSEDED)

Part 4 wrote the page's copy into index.html; this appendix is the earlier
scaffold's draft, kept only for the record:

- Act I: "This is what we were shown." / "Bronze. On a plinth. Well above eye
  level. A man thinking so hard that it appears to hurt him. And around him, a
  vocabulary you are somehow expected to already have." / "Most people take
  one look at this and quietly decide philosophy isn't for them. They're
  reacting to the packaging. Nobody ever shows them what's inside."
- Jargon field: phenomenological, a priori, Dasein, qua, noumenon, apodictic,
  hermeneutic circle, telos, sublation, transcendental idealism, quiddity,
  supervenience, ceteris paribus, modal realism, epistemic.
- Act II: "aporia — noun · from the Greek ἀπορία · literally, without
  passage." / "In Plato it names a specific moment: the argument runs out of
  road. Someone who was certain sixty seconds ago now has nothing to say.
  Socrates treated that silence as the point where the thinking actually
  starts. For most students it's the point where they stop." / "We named the
  magazine after it because being stuck is the interesting part, and nobody
  should be embarrassed to be there."
- Act III: "So we took him off the plinth." / "Philosophy is not an arena
  where every sentence has to survive review. Almost none of it starts that
  way. It starts much smaller. A film that irritated you and you can't say
  why. A rule at school that felt wrong before you could argue it. The growing
  suspicion that a word everybody uses doesn't actually mean anything. Those
  are real philosophical problems. They just haven't been dressed up yet."
  Jargon → plain pairs: epistemic humility → you might be wrong about this;
  the hard problem of consciousness → why does any of this feel like
  anything?; the categorical imperative → would it still be fine if everyone
  did it?; phenomenology → what it's actually like from in here; reification →
  treating an idea like it's a thing you can hold; the is-ought gap → knowing
  how things are won't tell you how they should be.
- Act IV: "Every issue borrows someone else's subject." / Issue 01, The
  Philosophy of Sociology — "The rules nobody wrote down, and what happens
  when you ask who's enforcing them." (Out now) / Issue 02, The Philosophy of
  Technology — "The tools have started making choices on our behalf. Nobody
  voted on the criteria." (In progress) / Issue 03, Undecided — "Genuinely
  open. If there's a field you think deserves the treatment, tell us and make
  the case." (Pitch us)
- Act V: "Your take goes here." / "You don't need a thesis. You don't need a
  reading list. You need something you noticed and can't put down, and about
  a thousand words to chase it. Write it the way you'd explain it to a friend
  who is interested but not impressed. We would rather publish an interesting
  mistake than a safe summary." / CTAs: "Send us a piece", "Read Issue 01".
- Coda: "It never quite settles. That's the name."
- Scaffold's accent palette (unapproved): sociology #c78038 ochre, technology
  #4a78f0 electric blue, undecided grey #8c8c94, invitation #cc514c ink red;
  cold ground rgb(8,8,11), warm paper rgb(244,238,227).
