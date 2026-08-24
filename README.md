# The Aporia — landing page

A scroll-driven landing page for *The Aporia*, a student philosophy magazine,
plus *The Complete Shelf*, a 3D library of its issues. Plain HTML/CSS/JS, ES
modules, three.js and anime.js vendored, **no build step**. Deploy by dragging
this folder onto Netlify (or any static host).

Two documents are the source of truth and every session reads them first:

- `BRIEF.md` — what this is and why (mission, storyboard, decisions).
- `CONTRACTS.md` — every interface: file formats, module APIs, the scene state,
  the choreography table, the shelf manifest.

## Run it locally

Any static server from this folder. ES modules and `fetch()` don't work from
`file://`.

```bash
python3 -m http.server 8080        # then open http://localhost:8080/
```

Useful URL flags on `index.html`:

| flag | what |
|---|---|
| `?static` | force the static (no-WebGL) page |
| `?webgl` | force the particle scene even where the capability check would decline |
| `?debug` | onScroll rulers, a state readout, `window.__aporia` |
| `?expose` | `window.__aporia` only (instrumentation, no overlays) |

`shelf.html?expose` exposes `window.__shelf`.

## How the page decides what to render

`js/main.js → decideMode()` runs before anything heavy loads. The **static
page** (same words, same black-to-paper shift, stills of the figure, no
three.js fetched at all) is used when any of these hold: `prefers-reduced-motion`,
`Save-Data`, ≤ 2 CPU cores or ≤ 2 GB `deviceMemory`, a viewport under 340 px on
its short side, or no WebGL context that runs without a major performance
caveat (software GL gets the static page on purpose). Otherwise the scene loads
with a particle budget by tier: 90 000 (≥ 8 cores, ≥ 8 GB, ≥ 1100 px),
60 000 (desktop), 30 000 (tablet), 18 000 (phone); ×0.6 on ≤ 4 cores or
≤ 4 GB. Point size is compensated so density reads the same. `?count=N`
overrides for testing. (Measured: 90k and 120k both hold 60 fps on an M4 at
DPR 2; the GPU is not the limit, the normals' clarity is.)

The text is readable and correctly coloured before a single cloud byte
arrives; the canvas fades in when the scene is ready.

## Re-running the bake (different model, more points)

The Thinker and the bust are point clouds baked offline by `tools/bake.mjs`
(Node ≥ 18, zero dependencies). The browser only ever fetches the result.

```bash
node tools/bake.mjs                                  # both models, 60 000 points, int16
node tools/bake.mjs --only thinker
node tools/bake.mjs --points 80000
node tools/bake.mjs --dtype float32                  # if you need the extra precision (you don't)
node tools/bake.mjs --thinker /path/to/model.stl --epicurus /path/to/model.obj
```

Readers for binary STL and Wavefront OBJ are built in. A Z-up source is
rotated to Y-up; a printer raft is detected and stripped (footprint rule, see
CONTRACTS §6); points are sampled by triangle area; the cloud is normalised to
height 1 standing on y = 0, facing +Z. If a new model faces the wrong way, set
`yaw` for it in `MODELS` inside `bake.mjs` and re-run. Output lands in
`assets/clouds/` with a `manifest.json` describing dtype and scale. The
`attribution` field there is yours to fill in.

## Adding Issue 04

One block of HTML, one shape name, one colour:

1. In `index.html`, Act IV, add a cover after the third:

   ```html
   <article class="cover" data-lens="3" data-accent="issue-04" data-shape="crowd" style="--tint: 120, 90, 170">
     <p class="cover__no"><span>04</span><span class="cover__status">in progress</span></p>
     <h3 class="cover__title">The Philosophy of …</h3>
     <p class="cover__line">One line.</p>
     <p class="cover__mark">The Aporia</p>
   </article>
   ```

   `data-shape` names a particle shape from `LENS_BUILDERS` in `js/shapes.js`
   (`crowd`, `device`, `unformed`, or one you add there — a builder returns the
   22 % "underneath" and the 78 % "form", see the top of that file). `--tint`
   is the issue's colour; it is also the scene accent. The choreography, the
   yaw schedule, the cover fan and the morph indices all follow the list of
   covers — nothing else in `main.js` or `shapes.js` needs touching.

2. For the shelf, add the book's title, line and cloth colour to its entry in
   `assets/shelf/manifest.json` (issues 04–19 already exist as "unwritten").

## The real links

Every placeholder link carries `class="is-placeholder"`, a `data-placeholder`
note and a visible "link pending" tag. Search for `TODO-`:

- `#TODO-issue-01-url` — Read Issue 01 (Act IV cover, Act V button, shelf manifest `href`)
- `#TODO-submission-url` — Send us a piece (Act V)
- `#TODO-pitch-url` — Pitch a subject (Act IV cover, shelf manifest)
- `#TODO-email` — the editorial address in the colophon

Remove the `is-placeholder` class and the `<span class="placeholder-tag">`
when you set each one. Also replace `REPLACE-WITH-YOUR-DOMAIN` in the
`og:url`, `og:image`, `twitter:image` and `canonical` tags once the site has a
domain, and fill the attribution line in the colophon (`#attribution`).

## The Complete Shelf

`shelf.html` is reachable only from the gate at the very end of the landing
page. Books are procedural until Mint-generated GLBs are linked in with
`tools/import-mint.mjs` (see CONTRACTS §16 for the Mint workflow; the MCP
needs an OAuth login first).

## Layout of the folder

```
index.html  shelf.html  css/  js/  assets/  vendor/  tools/
BRIEF.md  CONTRACTS.md  README.md
smoke-test.html  particles-test.html      ← throwaway test pages, safe to delete
```
