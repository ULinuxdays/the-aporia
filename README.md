# The Aporia — the website

The site of *The Aporia*, a student philosophy magazine. Three pages:

- **`index.html` — the landing page: the knot.** The two woven loops of the
  logo, which can be pulled into a line but never apart. Pulling them (or
  scrolling) brings out the name and the menu: Archive and About on the two
  arms, Write and Read the Latest on the two small lobes. Nothing on it can be
  clicked until the knot has been pulled. Raw WebGL2 and no libraries: it never
  loads three.js, anime.js or a scan. See CONTRACTS §18.
- **`about.html` — About: the scroll experience** (the particle scans of the
  Thinker and Epicurus, five acts, a portal at the end to the shelf). It was the
  landing page until 2026-11-23 and is unchanged apart from its address. Old
  links to `/#about` are sent on to `about.html#about`.
- **`shelf.html` — *The Complete Shelf***, a 3D library of the issues. It is the
  "Archive" on the landing page's menu.

Plain HTML/CSS/JS, ES modules, three.js and anime.js vendored, **no build
step**. Pushing `main` deploys to https://aporia.press on Vercel.

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

Useful URL flags on `about.html`:

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
`Save-Data`, ≤ 2 CPU cores or ≤ 2 GB (only where the browser reports
`deviceMemory` — Safari caps its core count, so alone it would condemn every
iPhone), a viewport under 280 px on its short side, scans that cannot be
fetched after retries, or no WebGL context that runs without a major performance
caveat (software GL gets the static page on purpose). Otherwise the scene loads
with a particle budget by tier: 90 000 (≥ 8 cores, ≥ 8 GB, ≥ 1100 px),
60 000 (desktop), 80 000 (tablet), 60 000 (phone; until 2026-11-23 tablets had
45 000 and phones 32 000, and the figures looked coarse); ×0.6 on ≤ 4 cores or ≤ 4 GB where the browser
reports memory. Point size is compensated so density reads the same. `?count=N`
overrides for testing. (Measured: 90k and 120k both hold 60 fps on an M4 at
DPR 2; the GPU is not the limit, the normals' clarity is.) Pixel ratio: up to
3 on a small screen, 2 on a large one; a device that keeps missing frames steps
down by 0.5, never below 2 on a sharp screen, and back up when it can; a raise
that has to be undone doubles the wait before the next (`govern()` in
`js/scene.js`).

The text is readable and correctly coloured before a single cloud byte
arrives; the canvas fades in when the scene is ready.

## How fast it loads, and why

Time from navigation to the model appearing, measured in headless Chrome at
1440×900 (`window.__aporia.timing` holds the stage marks on any `?expose` load):

| | desktop | 4× CPU throttle | 4× CPU + 5 Mbps |
|---|---|---|---|
| before | 1,941 ms | 5,812 ms | 5,983 ms |
| now | **759 ms** | **1,581 ms** | **3,972 ms** |

Four things get it there, and they are worth keeping:

1. **Only two shapes are built up front** — the monument and the bust. The
   other six are built after the first paint, in scroll order, and swapped in
   with `scene.setShape()`. Building all eight cost 447 ms on a fast machine
   and 2.6 s on a slow one, all of it before anything was on screen.
2. **Normals are estimated by a pool of workers**, one shape at a time split
   across up to four of them, priority given to the shape the reader is
   actually looking at.
3. **The pool is spawned at boot**, before the clouds are even requested, so
   the workers' module fetch and parse overlap with the download instead of
   following it.
4. **The renderer is preloaded from the HTML head.** Without it the browser
   only learns about three.js four round trips deep (`html → main.js →
   scene.js → three.module.js → three.core.js`). The inline script that does
   this repeats the cheap half of `decideMode()` — **if you change the static
   page's trigger conditions, change them in both places**, or a
   reduced-motion visitor will download a renderer they never use.

The canvas is revealed as soon as the monument is shaded, or after 700 ms,
whichever comes first, then fades in over 500 ms.

## Caching: the site is meant to be edited constantly

`vercel.json` sets `Cache-Control: public, max-age=0, must-revalidate` on
**everything**. Nothing is served from a browser or edge cache without asking
first, so a push reaches every visitor on their next reload — minutes after
you make it, not days. Unchanged files answer with a 304 and no body, so the
cost is a round trip, not a download. If you ever want to trade freshness for
speed again, that one rule is the only place to change.

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

Every link still waiting for a URL carries `data-todo="#TODO-…"`. On the
landing page, Write and Read the Latest are not links yet: they say "soon", do
nothing when pressed, and Read the Latest is greyed out. Make each an
`<a class="lobe" href="…">` (drop `is-soon`, `is-off`, `role`, `aria-disabled`
and the `soon` tag) and its lobe lights up on hover by itself. The ones with
nowhere to go yet are `<span class="is-placeholder">` with a "soon" tag (make
them `<a href>` and drop the tag); Issue 01 points at the shelf meanwhile.
Search for `TODO-`:

- `#TODO-issue-01-url` — Read Issue 01 (Act IV cover, Act V button, shelf manifest `href`)
- `#TODO-latest-url` — Read the Latest (the landing page's menu)
- `#TODO-submission-url` — Send us a piece (Act V), and Write (the landing page's menu)
- `#TODO-pitch-url` — Pitch a subject (Act IV cover, shelf manifest)
- `#TODO-email` — the editorial address (had a home in the colophon, now removed)


**The colophon is gone** (the page now ends on the portal), and it took the
editorial email, the copyright line and — importantly — the scan attribution
placeholder with it. If those scans require credit, the site currently gives
none: pick it a home before launch. The shelf page is the obvious candidate.

The site's canonical domain is **https://aporia.press/** — set in `og:url`,
`og:image`, `twitter:image` and `canonical` in `index.html` and `about.html`.
If you ever move it or prefer `www.`, those eight lines are the only place it
appears.

## The Complete Shelf

`shelf.html` is reached from Archive on the landing page and from the portal
at the very end of About; its "← The Aporia" goes back to the landing page. Books are procedural until Mint-generated GLBs are linked in with
`tools/import-mint.mjs` (see CONTRACTS §16 for the Mint workflow; the MCP
needs an OAuth login first).

## Layout of the folder

```
index.html   the knot             css/knot.css   js/knot/{main,rope,paint}.js
about.html   the scroll page      css/styles.css js/*.js (main.js, scene.js, …)
shelf.html   the shelf            css/shelf.css  js/shelf/
assets/  vendor/  tools/  BRIEF.md  CONTRACTS.md  README.md
smoke-test.html  particles-test.html      ← throwaway test pages, safe to delete
```

## The knot (`index.html`)

How it behaves, so it can be checked after a change:

- Until it is pulled, nothing can be clicked: the menu is hidden and inert, a
  click on the knot only gives it a small tug, and "Pull it apart" is a caption
  for the mouse (the keyboard can still press it, and it is the first Tab stop).
- Drag a strand: it stretches, and a hairline ring round your hand fills as you
  pull. When it is full the knot gives and springs out into a line. Let go
  before then and it springs back. Pulling the arms when it is out does nothing
  but stretch them: the weave never comes out.
- Scrolling pulls it out too; the page ends with it pulled. Once it is out by
  hand, the page quietly moves to the end of its scroll, so scrolling back up
  ties it again.
- On a phone the first swipe on the knot pulls it; once it is out, swipes
  scroll. A swipe off the knot always scrolls.
- "Drag to pull it apart" (or "Swipe…" on a touch screen) / "Tie it back up",
  under the knot, is a real button, for the keyboard; once the knot is out it
  can be clicked too. The two round grips show where to take hold. Every few
  seconds, until someone takes hold, two fingertips land on the grips and draw
  the lobes apart (the rope really stretches), then let go. Over the knot the
  pointer becomes a ring that says "Pull" and fills as you pull.
- Hovering, tied or pulled: the knot turns a few degrees towards the pointer, a
  soft light follows it across the ribbon (which swells a little under it), the
  strands lean towards it, and where the pointer comes onto a strand a glint
  runs both ways round that loop.
- Reduced motion: no scroll, no demonstration, and the button (or a pull)
  changes it at once.
- No WebGL2, no script, or a script that fails: `assets/static/knot.webp` (a
  still from the same renderer) with the menu round it.

Three effects are ported, by hand, from React Bits (https://reactbits.dev,
MIT + Commons Clause, © David Haz). React Bits is a library of React
components; this site has no React and no build step, so they are plain
JS/CSS here and keep the credit in the code: **Blur Text** (the name and the
menu come in a letter at a time, blurred and a little off their line; here
scrubbed by how far the knot is pulled), **Shiny Text** (the light crossing
"Pull it apart") and **Magnet** (a menu word leans towards the pointer).

`window.__knot` exposes the state, the rope and the grips for tests.
`js/knot/paint.js → LOOK` holds every number of the look (thickness, shine,
shadow, grain); the colours are taken from `assets/logo.png`.

To re-render the still or the social image (`assets/social-knot.jpg`,
1200 × 630 at 2×), screenshot the live page: the still at 1200 × 1200 with a
transparent background and the knot tied, the social image at 1200 × 630
pulled out with the menu and the button hidden.
