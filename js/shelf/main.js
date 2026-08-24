/**
 * js/shelf/main.js — The Complete Shelf. Boot, frame loop, wiring.
 *
 *   manifest → books (procedural or Mint GLB) → shelf → browse controller
 *   → inspector → UI. CONTRACTS.md §16.
 */

import * as THREE from 'three';
import { animate } from 'animejs';
import { createRoom, buildShelf, materials } from './scene.js';
import { createPlaque } from './plaque.js';
import { buildAllBooks } from './books.js';
import { createBrowser } from './browse.js';
import { createInspector } from './inspect.js';
import { createUI } from './ui.js';
import { createCurtain, removeCurtains } from '../curtain.js';

const MANIFEST_URL = 'assets/shelf/manifest.json';
const BROWSE = { y: 0.34, z: 1.2, lookY: 0.1 };

main().catch((err) => {
  console.error('[shelf] failed to start', err);
  removeCurtains();                                  // whatever went wrong, do not leave the page covered
  document.documentElement.classList.remove('arriving', 'curtained');
  document.documentElement.classList.add('no-webgl');
  const el = document.getElementById('loading');
  if (el) el.textContent = 'The shelf needs WebGL. The list below is the same run.';
});

async function main() {
  // Came through the portal: the landing page handed over with the viewport
  // solid, so put the curtain up before anything else is on screen. It carries
  // on along the same diagonal once the room is ready to be seen.
  removeCurtains();                                  // never inherit one from a restored page
  const arriving = document.documentElement.classList.contains('arriving');
  const curtain = arriving ? createCurtain() : null;
  if (curtain) {
    curtain.show(0, 'uncover');
    document.documentElement.classList.add('curtained');   // reveals the body under it
    try { sessionStorage.removeItem('aporia:portal'); } catch {}
    // A curtain is opaque. If the room never arrives — no WebGL, a failed
    // fetch, a thrown frame — this takes it down anyway rather than leaving
    // a black screen.
    setTimeout(() => {
      if (!document.documentElement.classList.contains('arriving')) return;
      curtain.dispose();
      document.documentElement.classList.remove('arriving', 'curtained');
    }, 6000);
  }

  const canvas = document.getElementById('stage');
  const manifest = await (await fetch(MANIFEST_URL)).json();
  document.getElementById('count').textContent = `${manifest.books.length} volumes · ${manifest.books.filter((b) => b.status !== 'unwritten').length} written`;

  // fonts first: the foil is drawn onto canvases in Bodoni Moda
  try { await Promise.all([document.fonts.load('400 64px "Bodoni Moda"'), document.fonts.load('500 64px "Bodoni Moda"'), document.fonts.load('500 34px "IBM Plex Mono"')]); } catch {}

  const { renderer, scene, camera, key } = createRoom(canvas);
  const books = await buildAllBooks(manifest);
  const shelf = buildShelf(scene, books);
  const plaque = createPlaque({ scene, lipY: shelf.lipY, lipZ: shelf.lipZ, brass: materials().brass });

  // ---- camera for browsing
  const browseCam = { position: new THREE.Vector3(shelf.x0, BROWSE.y, BROWSE.z), look: new THREE.Vector3(shelf.x0, BROWSE.lookY, 0) };
  camera.position.copy(browseCam.position);
  camera.lookAt(browseCam.look);

  // ---- picking
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...books, plaque.group], true);
    if (!hits.length) return null;
    if (plaque.group.children.includes(hits[0].object)) return browser.current;   // the plaque stands for the centred book
    let o = hits[0].object;
    while (o && !o.userData.book) o = o.parent;
    return o ? books.indexOf(o) : null;
  }

  // ---- ui + controllers
  let ui, browser, inspector;
  ui = createUI(manifest, {
    onMarker: (i) => { if (inspector.isOpen) return; browser.goTo(i); },
    onPrev: () => { if (!inspector.isOpen) browser.step(-1); },
    onNext: () => { if (!inspector.isOpen) browser.step(1); },
    onOpen: () => { if (!inspector.isOpen) inspector.open(browser.current); },
    onClose: () => inspector.close(),
  });
  browser = createBrowser({
    canvas, positions: shelf.positions, pick,
    onChange: (i) => { ui.setCurrent(i); plaque.setBook(manifest.books[i], shelf.positions[i]); },
    onSelect: (i) => inspector.open(i),
  });
  inspector = createInspector({
    camera, renderer, books,
    getBrowseCamera: () => browseCam,
    onOpen: (i) => { browser.setEnabled(false); ui.showPanel(i); ui.setHint('drag to turn it · scroll to zoom · right-drag to pan · Esc to put it back'); },
    onClose: () => { browser.setEnabled(true); ui.hidePanel(); ui.setHint('drag, scroll or use ← → · click the centred book to take it down'); },
  });
  ui.setHint('drag, scroll or use ← → · click the centred book to take it down');
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && inspector.isOpen) inspector.close(); });

  // lift the centred book a little
  const lift = new Map();

  // ---- size
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    if (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }
  addEventListener('resize', resize);
  resize();

  // ---- frame loop
  let arrival = null;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    resize();
    const x = browser.state.offset + (arrival ? arrival.cam.x : 0);
    if (!inspector.isOpen && !inspector.busy) {
      browseCam.position.x = x; browseCam.position.z = arrival ? arrival.cam.z : BROWSE.z; browseCam.look.x = browser.state.offset;
      camera.position.copy(browseCam.position);
      camera.lookAt(browseCam.look);
    } else {
      browseCam.position.x = x; browseCam.look.x = x;
    }
    // key light and its shadow frustum travel with the camera
    key.position.set(x + 0.6, 1.3, 1.1);
    key.target.position.set(x, 0.1, 0);
    key.target.updateMatrixWorld();
    // centred book lifts 8 mm; the others settle
    const cur = browser.current;
    books.forEach((b, i) => {
      if (inspector.index === i) return;
      const target = (i === cur && !inspector.isOpen) ? 0.008 : 0;
      const y = lift.get(i) ?? 0;
      const ny = y + (target - y) * Math.min(1, dt * 9);
      lift.set(i, ny);
      b.position.y = ny;
    });
    inspector.update();
    renderer.render(scene, camera);
  }
  ui.setLoading(false);
  document.documentElement.dataset.ready = '1';
  requestAnimationFrame(frame);

  // arriving through the portal: the curtain carries on in the same direction and
  // uncovers the room, while the camera settles in from behind and to the left
  if (curtain) {
    const cam = { z: BROWSE.z + 0.4, x: -0.3 };
    browseCam.position.z = cam.z;
    arrival = { cam };
    animate(cam, { z: BROWSE.z, x: 0, duration: 2400, ease: 'outExpo' });
    const wipe = { p: 0 };
    requestAnimationFrame(() => requestAnimationFrame(() => {
      animate(wipe, {
        p: 1, duration: 1150, ease: 'outQuad', delay: 60,
        onUpdate: () => curtain.draw(wipe.p, 'uncover'),
        onComplete: () => {
          curtain.hide(); curtain.dispose();
          document.documentElement.classList.remove('arriving', 'curtained');
          setTimeout(() => { arrival = null; }, 1400);
        },
      });
    }));
  }

  if (new URLSearchParams(location.search).has('expose')) window.__shelf = { browser, inspector, books, shelf, camera };
}
