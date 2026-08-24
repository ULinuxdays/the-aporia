/**
 * js/shelf/scene.js — the room.
 *
 * A walnut bookcase in a reading room: the issue shelf at eye height, a shelf
 * of objects above it, a shelf of stacked volumes below, a deep green linen
 * back, brass picture lights, and one warm lamp that follows you along the
 * case. Everything the camera can reach is built; the dark closes the rest.
 * Units are metres; the case runs along +X.
 */

import * as THREE from 'three';
import { RoomEnvironment } from '../../vendor/three/examples/jsm/environments/RoomEnvironment.js';

export const SHELF_DEPTH = 0.30;
export const SHELF_GAP = 0.40;          // vertical distance between shelves
const GAP = 0.006;                       // between books
const MARGIN = 0.5;                      // empty shelf at either end of the issue row, so the case fills the frame at the ends
const BAY = 1.02;                        // distance between uprights
const ROOM = 0x1f1b18;

// --------------------------------------------------------------------------- textures

function seeded(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** Walnut with long grain. */
function walnut() {
  const W = 1024, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#4e3020'); base.addColorStop(0.5, '#5b3a25'); base.addColorStop(1, '#4a2d1e');
  ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
  const rnd = seeded(3);
  for (let i = 0; i < 160; i++) {
    const y = rnd() * H, amp = 2 + rnd() * 6, freq = 0.002 + rnd() * 0.004, width = 0.6 + rnd() * 1.8;
    const dark = rnd() < 0.55;
    ctx.strokeStyle = dark ? `rgba(30,16,8,${0.12 + rnd() * 0.2})` : `rgba(150,105,70,${0.07 + rnd() * 0.1})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) { const yy = y + Math.sin(x * freq + i) * amp; if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

/** Dark green linen for the back of the case. */
function linen() {
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#26352d'; ctx.fillRect(0, 0, S, S);
  const rnd = seeded(11);
  const img = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const x = (i / 4) % S, y = ((i / 4) / S) | 0;
    const thread = ((x % 4 < 2) ^ (y % 4 < 2)) ? 10 : -6;
    const n = (rnd() - 0.5) * 14 + thread;
    img.data[i] += n; img.data[i + 1] += n * 1.1; img.data[i + 2] += n * 0.9;
  }
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

// --------------------------------------------------------------------------- materials

let MAT = null;
export function materials() {
  if (MAT) return MAT;
  const wood = walnut();
  MAT = {
    wood,
    walnut: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.5, metalness: 0.03 }),
    walnutDark: new THREE.MeshStandardMaterial({ map: wood, color: 0xb59a86, roughness: 0.62, metalness: 0.02 }),
    linen: new THREE.MeshStandardMaterial({ map: linen(), roughness: 0.98, metalness: 0 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb4915c, metalness: 0.9, roughness: 0.32 }),
    brassDull: new THREE.MeshStandardMaterial({ color: 0x8f7245, metalness: 0.8, roughness: 0.5 }),
    ceramic: new THREE.MeshStandardMaterial({ color: 0xe6dcc8, roughness: 0.35, metalness: 0 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xcfc6b5, roughness: 0.85, metalness: 0 }),
    ink: new THREE.MeshStandardMaterial({ color: 0x1c1614, roughness: 0.6, metalness: 0.1 }),
  };
  return MAT;
}

// --------------------------------------------------------------------------- room

export function createRoom(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(ROOM, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(ROOM);
  scene.fog = new THREE.FogExp2(ROOM, 0.4);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 20);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.22;
  pmrem.dispose();

  // a low, warm ambient from the room; the real light is the lamp
  scene.add(new THREE.HemisphereLight(0xe8d9c2, 0x3a2a1e, 0.28));

  // the lamp: warm, from above and in front, follows the camera along the case
  const key = new THREE.SpotLight(0xffd9ae, 26, 3.2, Math.PI / 5.2, 0.55, 1.6);
  key.position.set(0, 0.62, 0.55);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.2; key.shadow.camera.far = 3;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 3;
  scene.add(key, key.target);

  // a cool fill from the window side so the shadows have colour
  const fill = new THREE.DirectionalLight(0xcfd9e6, 0.45);
  fill.position.set(-1.2, 0.5, 1.4);
  scene.add(fill);

  return { renderer, scene, camera, key };
}

// --------------------------------------------------------------------------- set dressing

function lyingStack(rnd, cloths, n, maxW) {
  const g = new THREE.Group();
  let y = 0;
  for (let i = 0; i < n; i++) {
    const w = maxW * (0.78 + rnd() * 0.22), h = 0.018 + rnd() * 0.02, d = w * (0.68 + rnd() * 0.1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cloths[(rnd() * cloths.length) | 0]);
    m.position.set((rnd() - 0.5) * 0.012, y + h / 2, (rnd() - 0.5) * 0.01);
    m.rotation.y = (rnd() - 0.5) * 0.12;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    y += h;
  }
  return g;
}

function bookend(mat) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.004, 0.13), mat);
  base.position.y = 0.002;
  const up = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.13, 0.13), mat);
  up.position.set(-0.043, 0.065, 0);
  for (const m of [base, up]) { m.castShadow = m.receiveShadow = true; g.add(m); }
  return g;
}

function vessel(mat, rnd) {
  const pts = [];
  const h = 0.16 + rnd() * 0.08, r = 0.045 + rnd() * 0.02;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const rr = r * (0.55 + Math.sin(t * Math.PI) * 0.55 + (t > 0.85 ? -0.15 : 0));
    pts.push(new THREE.Vector2(Math.max(0.008, rr), t * h));
  }
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 36), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** A small stone head on a plinth: a nod to the garden. */
function bust(mat) {
  const g = new THREE.Group();
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.07), mat);
  plinth.position.y = 0.025;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.04, 18), mat);
  neck.position.y = 0.07;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.042, 28, 20), mat);
  head.scale.set(0.85, 1.05, 0.92);
  head.position.y = 0.125;
  for (const m of [plinth, neck, head]) { m.castShadow = m.receiveShadow = true; g.add(m); }
  return g;
}

function pictureLight(mat, length) {
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, length, 20), mat);
  tube.rotation.z = Math.PI / 2;
  const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 10), mat);
  arm1.rotation.x = Math.PI / 2; arm1.position.set(-length * 0.35, 0, -0.03);
  const arm2 = arm1.clone(); arm2.position.x = length * 0.35;
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, length * 0.92, 16, 1, true, Math.PI * 0.15, Math.PI * 0.7),
    new THREE.MeshBasicMaterial({ color: 0xffe1b5, fog: false }));
  glow.rotation.z = Math.PI / 2;
  for (const m of [tube, arm1, arm2]) { m.castShadow = true; g.add(m); }
  g.add(glow);
  return g;
}

// --------------------------------------------------------------------------- the case

/**
 * Lay the issues along the middle shelf and build the bookcase around them.
 * @returns {{ group, positions, length, x0, x1, lipZ, lipY }}
 */
export function buildShelf(scene, books) {
  const M = materials();
  const group = new THREE.Group();
  const positions = [];
  let x = MARGIN;
  books.forEach((b, i) => {
    const d = b.userData.size.d;
    x += d / 2;
    positions.push(x);
    b.position.set(x, 0, -0.03);
    b.rotation.y = ((i * 7919) % 13 - 6) * 0.0025;
    group.add(b);
    x += d / 2 + GAP;
  });
  const length = x - GAP + MARGIN;
  const bays = Math.max(2, Math.round(length / BAY));
  const bayW = length / bays;
  const zBack = -0.03 - SHELF_DEPTH / 2;          // inside face of the back
  const zFront = -0.03 + SHELF_DEPTH / 2;
  const T = 0.026;                                   // board thickness
  const rnd = seeded(5);
  const cloths = ['#8a6a4a', '#5b6b84', '#6f7b6a', '#7d7a74', '#6b5c66', '#9a8268', '#4f5a66', '#857262', '#5e6a5a', '#75665c']
    .map((c) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: 0.9, metalness: 0 }));

  M.wood.repeat.set(length / 0.5, 1);

  // three shelves: the issues on the middle one
  for (const yy of [-SHELF_GAP, 0, SHELF_GAP]) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(length, T, SHELF_DEPTH), M.walnut);
    plank.position.set(length / 2, yy - T / 2, -0.03);
    plank.castShadow = plank.receiveShadow = true;
    const lip = new THREE.Mesh(new THREE.BoxGeometry(length, 0.04, 0.014), M.walnut);
    lip.position.set(length / 2, yy - 0.02, zFront - 0.007);
    lip.castShadow = lip.receiveShadow = true;
    group.add(plank, lip);
  }
  // top and bottom boards of the case
  const top = new THREE.Mesh(new THREE.BoxGeometry(length + 0.08, T, SHELF_DEPTH + 0.04), M.walnut);
  top.position.set(length / 2, SHELF_GAP * 2 - T / 2, -0.03 + 0.02);
  const crown = new THREE.Mesh(new THREE.BoxGeometry(length + 0.12, 0.05, SHELF_DEPTH + 0.08), M.walnutDark);
  crown.position.set(length / 2, SHELF_GAP * 2 + 0.025, -0.03 + 0.04);
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(length + 0.08, T, SHELF_DEPTH + 0.04), M.walnut);
  bottom.position.set(length / 2, -SHELF_GAP * 2 + T / 2, -0.03 + 0.02);
  const plinthBoard = new THREE.Mesh(new THREE.BoxGeometry(length + 0.12, 0.08, SHELF_DEPTH + 0.08), M.walnutDark);
  plinthBoard.position.set(length / 2, -SHELF_GAP * 2 - 0.04, -0.03 + 0.04);
  for (const m of [top, crown, bottom, plinthBoard]) { m.castShadow = m.receiveShadow = true; group.add(m); }

  // back: green linen panel
  const backMat = M.linen.clone(); backMat.map = M.linen.map.clone(); backMat.map.needsUpdate = true;
  backMat.map.repeat.set(length / 0.35, (SHELF_GAP * 4) / 0.35);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(length + 0.08, SHELF_GAP * 4), backMat);
  back.position.set(length / 2, 0, zBack - 0.002);
  back.receiveShadow = true;
  group.add(back);

  // uprights at the ends only: the issue shelf is one uninterrupted run
  for (const xx of [-T / 2, length + T / 2]) {
    const up = new THREE.Mesh(new THREE.BoxGeometry(T, SHELF_GAP * 4, SHELF_DEPTH + 0.02), M.walnut);
    up.position.set(xx, 0, -0.03 + 0.01);
    up.castShadow = up.receiveShadow = true;
    group.add(up);
  }
  // short dividers on the upper and lower shelves mark the bays without crossing the run
  for (let i = 1; i < bays; i++) {
    for (const yy of [SHELF_GAP, -SHELF_GAP]) {
      const dv = new THREE.Mesh(new THREE.BoxGeometry(T * 0.7, SHELF_GAP - T, SHELF_DEPTH - 0.02), M.walnut);
      dv.position.set(i * bayW, yy + (SHELF_GAP - T) / 2 + (yy > 0 ? 0 : 0), -0.03);
      dv.castShadow = dv.receiveShadow = true;
      group.add(dv);
    }
  }

  // picture lights under the top of each bay, over the issues
  for (let i = 0; i < bays; i++) {
    const pl = pictureLight(M.brass, bayW * 0.42);
    pl.position.set((i + 0.5) * bayW, SHELF_GAP + 0.33, zFront - 0.02);
    group.add(pl);
  }

  // upper shelf: a few things that live in a reading room
  for (let i = 0; i < bays; i++) {
    const cx = (i + 0.5) * bayW;
    const st = lyingStack(rnd, cloths, 3 + ((rnd() * 3) | 0), 0.2);
    st.position.set(cx - bayW * 0.3, SHELF_GAP, -0.06);
    group.add(st);
    const be = bookend(M.brassDull);
    be.position.set(cx + bayW * 0.08, SHELF_GAP, -0.04);
    group.add(be);
    if (i % 2 === 0) { const v = vessel(M.ceramic, rnd); v.position.set(cx + bayW * 0.3, SHELF_GAP, -0.05); group.add(v); }
    else { const b = bust(M.stone); b.position.set(cx + bayW * 0.3, SHELF_GAP, -0.05); group.add(b); }
  }

  // lower shelf: stacked volumes and a document box
  for (let i = 0; i < bays; i++) {
    const cx = (i + 0.5) * bayW;
    const s1 = lyingStack(rnd, cloths, 4 + ((rnd() * 4) | 0), 0.24);
    s1.position.set(cx - bayW * 0.28, -SHELF_GAP, -0.05);
    const s2 = lyingStack(rnd, cloths, 2 + ((rnd() * 3) | 0), 0.2);
    s2.position.set(cx + bayW * 0.02, -SHELF_GAP, -0.04);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.2), M.ink);
    box.position.set(cx + bayW * 0.3, -SHELF_GAP + 0.045, -0.05);
    box.castShadow = box.receiveShadow = true;
    group.add(s1, s2, box);
  }

  // the room beyond the case: a dark floor and wall so nothing reads as void
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(length + 8, 8), new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(length / 2, -SHELF_GAP * 2 - 0.08, 1.5);
  floor.receiveShadow = true;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(length + 8, 6), new THREE.MeshStandardMaterial({ color: 0x2b2a27, roughness: 1 }));
  wall.position.set(length / 2, 1.5, zBack - 0.03);
  group.add(floor, wall);

  scene.add(group);
  return { group, positions, length, x0: positions[0], x1: positions[positions.length - 1], lipZ: zFront, lipY: -0.02 };
}
