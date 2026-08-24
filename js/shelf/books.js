/**
 * js/shelf/books.js — hardcovers for the shelf.
 *
 * Every book comes from one manifest entry (assets/shelf/manifest.json,
 * CONTRACTS.md §16). If the entry names a `file`, it is a Mint-generated GLB
 * and is loaded through the shared Draco-capable loader and normalised to the
 * manifest's size. Otherwise the book is built here: two cloth boards, a
 * rounded cloth spine, a page block, and foil stamped on the spine and front
 * board. Both paths return the same thing — a THREE.Group standing on y = 0,
 * thickness along X, height along Y, spine facing +Z, front board facing +X —
 * so the shelf and the inspector never care which kind they hold.
 *
 * Units: metres (the manifest is in cm).
 */

import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from '../../vendor/three/examples/jsm/loaders/DRACOLoader.js';

const CM = 0.01;
const BOARD = 0.0032;           // board thickness, m
const PAGE_INSET = 0.004;       // boards overhang the pages by this much on three sides

// --------------------------------------------------------------------------- shared textures

let weaveNormal = null, pageEdges = null;

/** A woven-cloth normal map, generated once and shared. */
function getWeaveNormal() {
  if (weaveNormal) return weaveNormal;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  // height field: two crossing thread directions plus a little noise
  const h = new Float32Array(S * S);
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const warp = Math.sin((x / S) * Math.PI * 2 * 32) * 0.5 + 0.5;
    const weft = Math.sin((y / S) * Math.PI * 2 * 32) * 0.5 + 0.5;
    const over = ((x >> 3) + (y >> 3)) & 1;
    h[y * S + x] = (over ? warp * 0.7 + weft * 0.3 : warp * 0.3 + weft * 0.7) + (rnd() - 0.5) * 0.18;
  }
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const l = h[y * S + ((x + S - 1) % S)], r = h[y * S + ((x + 1) % S)];
    const u = h[((y + S - 1) % S) * S + x], d = h[((y + 1) % S) * S + x];
    const nx = (l - r) * 1.4, ny = (u - d) * 1.4;
    const len = Math.hypot(nx, ny, 1);
    const i = (y * S + x) * 4;
    img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
    img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
    img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  weaveNormal = new THREE.CanvasTexture(c);
  weaveNormal.wrapS = weaveNormal.wrapT = THREE.RepeatWrapping;
  weaveNormal.repeat.set(6, 6);
  return weaveNormal;
}

/** Page edges: fine horizontal lines on cream. */
function getPageEdges() {
  if (pageEdges) return pageEdges;
  const c = document.createElement('canvas'); c.width = 64; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#efe6d3'; ctx.fillRect(0, 0, 64, 512);
  for (let y = 0; y < 512; y += 2) { ctx.fillStyle = (y % 6 === 0) ? 'rgba(120,95,60,0.22)' : 'rgba(120,95,60,0.08)'; ctx.fillRect(0, y, 64, 1); }
  pageEdges = new THREE.CanvasTexture(c);
  pageEdges.wrapS = pageEdges.wrapT = THREE.RepeatWrapping;
  pageEdges.colorSpace = THREE.SRGBColorSpace;
  return pageEdges;
}

// --------------------------------------------------------------------------- foil art

const MOTIFS = {
  roundel(ctx, cx, cy, r) {
    ctx.lineWidth = r * 0.09; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = r * 0.05; ctx.beginPath(); ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.14, 0, Math.PI * 2); ctx.fill();
  },
  grid(ctx, cx, cy, r) {
    ctx.lineWidth = r * 0.045; const n = 4, s = (r * 2) / n;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(cx - r + i * s, cy - r); ctx.lineTo(cx - r + i * s, cy + r); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - r, cy - r + i * s); ctx.lineTo(cx + r, cy - r + i * s); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx + s * 0.5, cy - s * 0.5, r * 0.12, 0, Math.PI * 2); ctx.fill();
  },
  lozenge(ctx, cx, cy, r) {
    ctx.lineWidth = r * 0.08;
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.7, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.7, cy); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.45); ctx.lineTo(cx + r * 0.32, cy); ctx.lineTo(cx, cy + r * 0.45); ctx.lineTo(cx - r * 0.32, cy); ctx.closePath(); ctx.fill();
  },
  rule(ctx, cx, cy, r) {
    ctx.lineWidth = r * 0.1; ctx.beginPath(); ctx.moveTo(cx - r, cy - r * 0.18); ctx.lineTo(cx + r, cy - r * 0.18); ctx.stroke();
    ctx.lineWidth = r * 0.04; ctx.beginPath(); ctx.moveTo(cx - r, cy + r * 0.12); ctx.lineTo(cx + r, cy + r * 0.12); ctx.stroke();
  },
  stroke(ctx, cx, cy, r) {
    ctx.lineWidth = r * 0.12; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - r, cy + r * 0.5); ctx.bezierCurveTo(cx - r * 0.4, cy - r * 1.1, cx + r * 0.3, cy + r * 0.9, cx + r, cy - r * 0.6); ctx.stroke();
  },
};

const FONT_DISPLAY = '"Bodoni Moda", "Bodoni 72", Didot, Georgia, serif';
const FONT_MONO = '"IBM Plex Mono", Menlo, monospace';

/** Alpha texture for the spine: number at the head, title running up the spine, motif at the tail. */
function spineArt(book) {
  const W = 256, H = 1536;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
  const real = book.status !== 'unwritten';
  // number, head
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `500 ${real ? 96 : 80}px ${FONT_DISPLAY}`;
  ctx.fillText(String(book.number).padStart(2, '0'), W / 2, 120);
  // hairline under the number
  ctx.fillRect(W * 0.3, 196, W * 0.4, 4);
  // title, rotated to run up the spine
  ctx.save();
  ctx.translate(W / 2, H * 0.56);
  ctx.rotate(Math.PI / 2);            // titles read top-to-bottom, as on an English spine
  ctx.font = `400 ${real ? 118 : 72}px ${FONT_DISPLAY}`;
  const title = real ? book.title : 'unwritten';
  const maxLen = H * 0.62;
  let size = real ? 118 : 72;
  while (ctx.measureText(title).width > maxLen && size > 40) { size -= 4; ctx.font = `400 ${size}px ${FONT_DISPLAY}`; }
  ctx.fillText(title, 0, 0);
  ctx.restore();
  // publisher's mark at the tail
  ctx.font = `500 34px ${FONT_MONO}`;
  ctx.fillText('THE APORIA', W / 2, H - 96);
  if (real && book.foil && MOTIFS[book.foil.motif]) MOTIFS[book.foil.motif](ctx, W / 2, H - 230, 46);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

/** Alpha texture for the front board: motif, title block, number. */
function coverArt(book) {
  const W = 1024, H = 1536;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const real = book.status !== 'unwritten';
  if (real && book.foil && MOTIFS[book.foil.motif]) MOTIFS[book.foil.motif](ctx, W / 2, H * 0.36, 170);
  // title block
  ctx.font = `400 ${real ? 86 : 60}px ${FONT_DISPLAY}`;
  const words = (real ? book.title : 'Unwritten').split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) { const test = cur ? cur + ' ' + w : w; if (ctx.measureText(test).width > W * 0.78 && cur) { lines.push(cur); cur = w; } else cur = test; }
  if (cur) lines.push(cur);
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.64 + i * 100));
  ctx.fillRect(W * 0.38, H * 0.64 + lines.length * 100 + 10, W * 0.24, 5);
  ctx.font = `500 54px ${FONT_MONO}`;
  ctx.fillText(`ISSUE ${String(book.number).padStart(2, '0')}`, W / 2, H * 0.64 + lines.length * 100 + 80);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

// --------------------------------------------------------------------------- procedural book

/**
 * Build one clothbound hardcover from a manifest entry.
 * @returns {THREE.Group} standing on y=0, centred on x/z, spine at +Z
 */
export function buildBook(book) {
  const w = book.size.w * CM, h = book.size.h * CM, d = book.size.d * CM;
  const g = new THREE.Group();
  g.name = book.id;

  const cloth = new THREE.MeshStandardMaterial({
    color: new THREE.Color(book.cloth),
    roughness: 0.88,
    metalness: 0,
    normalMap: getWeaveNormal(),
    normalScale: new THREE.Vector2(0.45, 0.45),
  });

  // boards
  const boardGeo = new THREE.BoxGeometry(BOARD, h, w);
  const front = new THREE.Mesh(boardGeo, cloth);
  front.position.set(d / 2 - BOARD / 2, h / 2, 0);
  const back = new THREE.Mesh(boardGeo, cloth);
  back.position.set(-d / 2 + BOARD / 2, h / 2, 0);

  // rounded spine along the +Z edge
  const r = d / 2;
  const spineGeo = new THREE.CylinderGeometry(r, r, h, 28, 1, true, -Math.PI / 2, Math.PI);
  const spine = new THREE.Mesh(spineGeo, cloth);
  spine.position.set(0, h / 2, w / 2 - r * 0.15);

  // page block, inset from the boards on head, tail and fore-edge
  const pages = new THREE.Mesh(
    new THREE.BoxGeometry(d - BOARD * 2 - 0.0006, h - PAGE_INSET * 2, w - PAGE_INSET - 0.002),
    new THREE.MeshStandardMaterial({ map: getPageEdges(), roughness: 0.95, metalness: 0 }),
  );
  pages.position.set(0, h / 2, -PAGE_INSET / 2 - 0.002);

  for (const m of [front, back, spine, pages]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }

  // foil (or blind stamp on the unwritten ones)
  const real = book.status !== 'unwritten';
  const foilColor = real && book.foil ? new THREE.Color(book.foil.color) : new THREE.Color(book.cloth).multiplyScalar(0.72);
  const foilMat = (alphaMap) => new THREE.MeshStandardMaterial({
    color: foilColor,
    metalness: real ? 0.9 : 0.05,
    roughness: real ? 0.32 : 0.9,
    transparent: true,
    alphaMap,
    depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });

  // spine label: a thin curved strip hugging the spine
  const labelGeo = new THREE.CylinderGeometry(r + 0.0004, r + 0.0004, h * 0.92, 28, 1, true, -Math.PI * 0.32, Math.PI * 0.64);
  const spineTex = spineArt(book);
  const label = new THREE.Mesh(labelGeo, foilMat(spineTex));
  label.position.copy(spine.position);
  g.add(label);

  // front-board decal
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.62, h * 0.62), foilMat(coverArt(book)));
  decal.rotation.y = Math.PI / 2;
  decal.position.set(d / 2 + 0.0003, h / 2, -0.002);
  g.add(decal);

  g.userData.book = book;
  g.userData.size = { w, h, d };
  return g;
}

// --------------------------------------------------------------------------- Mint GLB path

let gltfLoader = null;
/** One GLTFLoader for the page, with a shared lazily-loaded Draco decoder (self-hosted). */
export function getGLTFLoader() {
  if (gltfLoader) return gltfLoader;
  const draco = new DRACOLoader();
  draco.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/');
  gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(draco);
  return gltfLoader;
}

/**
 * Load a Mint-generated book and normalise it into the book frame: height
 * = manifest height, standing on y=0, centred on x/z. `book.transform.yaw`
 * (radians) turns it so the spine faces +Z if the model was authored otherwise.
 */
export async function loadBookGLB(book) {
  const gltf = await getGLTFLoader().loadAsync(book.file);
  const root = gltf.scene;
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  if (book.transform?.yaw) root.rotation.y = book.transform.yaw;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const s = (book.size.h * CM) / Math.max(size.y, 1e-6);
  root.scale.multiplyScalar(s);
  root.updateMatrixWorld(true);
  box.setFromObject(root);
  const centre = box.getCenter(new THREE.Vector3());
  root.position.x -= centre.x;
  root.position.z -= centre.z;
  root.position.y -= box.min.y;
  const g = new THREE.Group();
  g.name = book.id;
  g.add(root);
  g.userData.book = book;
  g.userData.size = { w: size.z * s, h: book.size.h * CM, d: size.x * s };
  return g;
}

/** Build or load every book in the manifest, in order. Failed GLBs fall back to the procedural book. */
export async function buildAllBooks(manifest) {
  const out = [];
  for (const book of manifest.books) {
    if (book.file) {
      try { out.push(await loadBookGLB(book)); continue; }
      catch (err) { console.warn(`[shelf] ${book.id}: could not load ${book.file}, using the procedural book.`, err.message); }
    }
    out.push(buildBook(book));
  }
  return out;
}
