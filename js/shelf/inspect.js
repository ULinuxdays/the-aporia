/**
 * js/shelf/inspect.js — pull one book off the shelf and look at it properly.
 *
 * open(i): the book slides out of its slot, turns its front board to the
 * camera and comes forward to an inspection point; OrbitControls take over
 * (orbit, pan, zoom within limits). close(): everything goes back, in one
 * motion. Only one book is ever out.
 */

import * as THREE from 'three';
import { OrbitControls } from '../../vendor/three/examples/jsm/controls/OrbitControls.js';
import { animate, createTimeline } from 'animejs';

export function createInspector({ camera, renderer, books, getBrowseCamera, onOpen, onClose }) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  // Limits: enough to turn the book and read the boards, never enough to see
  // past the case. Azimuth ±40°, tilt ±22° from level, distance 0.3–0.85 m,
  // and the orbit centre is boxed in (see update()).
  controls.minDistance = 0.3;
  controls.maxDistance = 0.85;
  controls.minAzimuthAngle = -0.7;
  controls.maxAzimuthAngle = 0.7;
  controls.minPolarAngle = Math.PI / 2 - 0.38;
  controls.maxPolarAngle = Math.PI / 2 + 0.38;
  controls.screenSpacePanning = true;
  controls.panSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  controls.rotateSpeed = 0.7;

  let openIndex = -1;
  let busy = false;
  const home = new Map();   // index → { position, rotation }
  const anchor = new THREE.Vector3();

  function inspectPoint(book) {
    // in front of the browse camera, at a height that centres the book
    const cam = getBrowseCamera();
    const h = book.userData.size.h;
    return { pos: new THREE.Vector3(cam.position.x - 0.07, 0.17 - h / 2, 0.5), look: new THREE.Vector3(cam.position.x - 0.07, 0.17, 0.5) };
  }

  async function open(i) {
    if (busy || openIndex >= 0) return;
    const book = books[i];
    if (!book) return;
    busy = true; openIndex = i;
    home.set(i, { position: book.position.clone(), rotation: book.rotation.clone() });
    const { pos, look } = inspectPoint(book);
    anchor.copy(look);
    onOpen?.(i);

    const D = reduced ? 160 : 1;
    const tl = createTimeline({ defaults: { ease: 'inOutCubic' } });
    // 1. slide forward out of the row
    tl.add(book.position, { z: book.position.z + 0.22, duration: 480 * D }, 0);
    // 2. rise, turn the front board (local +X) to face the camera (+Z), travel to the point
    tl.add(book.position, { x: pos.x, y: pos.y, z: pos.z, duration: 900 * D, ease: 'inOutQuart' }, 380 * D);
    tl.add(book.rotation, { y: -Math.PI / 2, duration: 900 * D, ease: 'inOutQuart' }, 380 * D);
    // 3. camera eases to frame it
    const cam = getBrowseCamera();
    const camTarget = new THREE.Vector3(pos.x + 0.04, 0.19, pos.z + 0.7);
    tl.add(camera.position, { x: camTarget.x, y: camTarget.y, z: camTarget.z, duration: 1100 * D, ease: 'inOutQuart' }, 300 * D);
    const lookState = { t: 0 };
    const from = cam.look.clone();
    tl.add(lookState, { t: 1, duration: 1100 * D, ease: 'inOutQuart', onUpdate: () => camera.lookAt(from.clone().lerp(look, lookState.t)) }, 300 * D);
    await tl.then();
    controls.target.copy(look);
    controls.update();
    controls.enabled = true;
    busy = false;
  }

  async function close() {
    if (busy || openIndex < 0) return;
    busy = true;
    const i = openIndex;
    const book = books[i];
    const h = home.get(i);
    controls.enabled = false;
    const D = reduced ? 160 : 1;
    const cam = getBrowseCamera();
    const tl = createTimeline({ defaults: { ease: 'inOutCubic' } });
    const lookState = { t: 0 };
    const fromLook = controls.target.clone();
    const camFrom = camera.position.clone();
    tl.add(camera.position, { x: cam.position.x, y: cam.position.y, z: cam.position.z, duration: 1000 * D, ease: 'inOutQuart' }, 0);
    tl.add(lookState, { t: 1, duration: 1000 * D, ease: 'inOutQuart', onUpdate: () => camera.lookAt(fromLook.clone().lerp(cam.look, lookState.t)) }, 0);
    tl.add(book.rotation, { x: 0, y: h.rotation.y, z: 0, duration: 800 * D, ease: 'inOutQuart' }, 0);
    tl.add(book.position, { x: h.position.x, y: h.position.y, z: h.position.z + 0.22, duration: 800 * D, ease: 'inOutQuart' }, 0);
    tl.add(book.position, { z: h.position.z, duration: 420 * D }, 760 * D);
    void camFrom;
    await tl.then();
    openIndex = -1;
    busy = false;
    onClose?.(i);
  }

  return {
    open, close,
    get isOpen() { return openIndex >= 0; },
    get busy() { return busy; },
    get index() { return openIndex; },
    update() {
      if (!controls.enabled) return;
      // keep the orbit centre near the book: pan cannot wander off the set
      const t = controls.target;
      t.x = Math.min(anchor.x + 0.12, Math.max(anchor.x - 0.12, t.x));
      t.y = Math.min(anchor.y + 0.1, Math.max(anchor.y - 0.1, t.y));
      t.z = Math.min(anchor.z + 0.04, Math.max(anchor.z - 0.04, t.z));
      controls.update();
    },
    dispose() { controls.dispose(); },
  };
}
