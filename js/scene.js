/**
 * js/scene.js — the particle field. One THREE.Points, one ShaderMaterial.
 *
 * Morphing happens on the GPU. Every particle carries two positions (aPosA,
 * aPosB), a random unit direction and a random seed. A single uMorph uniform
 * slides it from A to B, staggered by the seed so the cloud comes APART
 * before it comes back together, with an outward burst that peaks at the
 * midpoint of each particle's own crossing. The dissolve is the point.
 *
 * The A/B buffers are swapped whenever the integer part of state.morph
 * changes, so the seven shapes become six GPU transitions.
 *
 * Nothing in here reads the scroll. `state` is a plain object of numbers
 * (CONTRACTS.md §10) that part 3 animates with anime.js; this module just
 * applies it every frame.
 *
 * Blending is NORMAL, depth test/write off: the page ground goes from
 * near-black to warm paper and additive blending would blow out on paper.
 * The renderer clears to transparent — the page paints the background.
 */

import * as THREE from '../vendor/three/build/three.module.js';
import { STATE_DEFAULTS } from './state.js';
import { PORTAL } from './shapes.js';

export { STATE_DEFAULTS };   // the table, with comments, is in js/state.js and CONTRACTS.md §10

/** Where the ending's sweep carries the field: up and to the right, the same line the curtain travels. */
const SWEEP_DIR = /* @__PURE__ */ (() => new THREE.Vector3(0.78, 0.62, 0.1).normalize())();

const REF_DISTANCE = 5;
const REF_HEIGHT = 900;
const MAX_DPR = 2;

const VERT = /* glsl */ `
  attribute vec3 aPosA;
  attribute vec3 aPosB;
  attribute vec3 aDir;
  attribute float aSeed;
  attribute float aPart;
  attribute float aScale;
  attribute vec4 aNrmA;   // xyz normal, w = confidence (0 on lines / fog)
  attribute vec4 aNrmB;

  uniform float uMorph;
  uniform float uSpread;
  uniform float uDrift;
  uniform float uSize;
  uniform float uTime;
  uniform float uPointScale;
  uniform float uCamDist;
  uniform vec2 uPointer;        // NDC, smoothed
  uniform float uPointerActive; // 0..1
  uniform float uAspect;
  uniform float uRepel;
  uniform float uRepelRadius;
  uniform float uSwirl;       // accumulated vortex angle at the centre, radians
  uniform vec3 uSweep;        // world offset the sweep carries particles by
  uniform vec2 uPortal;       // the ring's centre in stage space

  varying float vBurst;
  varying float vPart;
  varying float vSeed;
  varying float vAlpha;
  varying float vDepth;
  varying vec3 vNrm;
  varying vec3 vView;
  varying float vConf;
  varying float vNear;

  void main() {
    // Stagger: low-seed particles leave first and land first, high-seed last.
    const float STAGGER = 1.0;
    float t = clamp(uMorph * (1.0 + STAGGER) - aSeed * STAGGER, 0.0, 1.0);
    float e = t * t * (3.0 - 2.0 * t);
    vec3 pos = mix(aPosA, aPosB, e);

    // Outward burst, peaking at the midpoint of this particle's own crossing.
    float burst = sin(t * 3.14159265);
    pos += aDir * burst * uSpread * (0.3 + 1.2 * aSeed);

    // The ending's vortex: everything rotates about the ring's centre, inner
    // particles faster than outer, so the arms wind up. Far-away particles
    // (the heap on the ground) barely move.
    if (uSwirl != 0.0) {
      vec2 d = pos.xy - uPortal;
      float rr = length(d);
      float a = uSwirl / (0.16 + rr * rr * 4.0);
      float cs = cos(a), sn = sin(a);
      pos.xy = uPortal + vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
    }
    // …and then the whole field sweeps off the screen, staggered by seed so it streaks.
    pos += uSweep * (0.25 + 1.5 * aSeed);

    // Idle drift.
    float ph = aSeed * 97.0;
    pos += aDir * sin(uTime * 0.7 + ph) * uDrift;
    pos.y += sin(uTime * 0.45 + ph * 1.7) * uDrift * 0.5;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);

    // Pointer repulsion, in screen space (after reactbits' ParticleText): every
    // particle within uRepelRadius of the smoothed pointer is pushed straight
    // away from it along the screen with a (1 - d/R)^2 falloff, compensated
    // for depth so the push reads the same size wherever the particle sits.
    vNear = 0.0;
    if (uPointerActive > 0.001 && uRepel > 0.0) {
      vec4 clip0 = projectionMatrix * mv;
      vec2 ndc = clip0.xy / clip0.w;
      vec2 d = vec2((ndc.x - uPointer.x) * uAspect, ndc.y - uPointer.y);
      float pd = length(d);
      if (pd < uRepelRadius) {
        float fall = 1.0 - pd / uRepelRadius;
        float f = fall * fall * uRepel * uPointerActive * (0.55 + 0.9 * aSeed);
        vec2 dir = pd > 1e-5 ? d / pd : vec2(0.0, 1.0);
        mv.xy += dir * f * (-mv.z / 5.0);
        vNear = fall * uPointerActive;
      }
    }

    gl_Position = projectionMatrix * mv;
    float dist = max(-mv.z, 0.05);
    gl_PointSize = max(uSize * aScale * uPointScale / dist, 1.0);

    vBurst = burst;
    vPart = aPart;
    vSeed = aSeed;
    vAlpha = 0.78 + 0.22 * fract(aScale * 7.31);
    vDepth = dist - uCamDist;   // <0 nearer than the look point, >0 beyond it

    // Normals are interpolated across the crossing like positions, and their
    // confidence collapses mid-flight (a particle in the air has no surface).
    vec3 nrm = normalize(mix(aNrmA.xyz, aNrmB.xyz, e) + 1e-6);
    vNrm = normalize(mat3(modelViewMatrix) * nrm);
    vView = normalize(-mv.xyz);
    vConf = mix(aNrmA.w, aNrmB.w, e) * (1.0 - burst);
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;

  uniform float uOpacity;
  uniform float uTone;
  uniform float uAccentMix;
  uniform vec3 uAccent;
  uniform vec3 uCold;
  uniform vec3 uWarm;
  uniform vec3 uLight;
  uniform float uShade;

  varying float vBurst;
  varying float vPart;
  varying float vSeed;
  varying float vAlpha;
  varying float vDepth;
  varying vec3 vNrm;
  varying vec3 vView;
  varying float vConf;
  varying float vNear;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float disc = 1.0 - smoothstep(0.36, 0.5, d);
    if (disc <= 0.002) discard;

    // Each particle flips cold→warm at its own threshold, so mid-transition
    // the cloud is a salt-and-pepper mix of marble and ink — visible against
    // whatever grey the page background is passing through at that moment.
    float flip = smoothstep(vSeed * 0.8, vSeed * 0.8 + 0.2, uTone);
    vec3 col = mix(uCold, uWarm, flip);
    float accentW = uAccentMix * mix(1.0, 0.3, vPart);
    col = mix(col, uAccent, accentW);

    // A little per-particle variation, and a fade mid-flight so the cloud
    // thins as it dissolves rather than smearing.
    // Depth shading: the near side of a form is denser than the far side, so
    // the cloud reads as a volume instead of a flat silhouette.
    float depthFade = 1.0 - 0.8 * smoothstep(-0.35, 0.4, vDepth);

    // Two-sided lambert: PCA gives the normal's AXIS reliably but its sign is
    // arbitrary on a flat patch, so light |N·L|. Sign-free, and it is the
    // form — cheekbones, folds, the bulge of a shoulder — not the silhouette.
    float lambert = abs(dot(vNrm, normalize(uLight)));
    // Silhouette rim: normals perpendicular to the view mark the edge of a
    // form. Brightening them draws the outline the cloud otherwise lacks.
    float rim = 1.0 - abs(dot(vNrm, vView));
    float lit = mix(1.0, 0.34 + 0.78 * lambert + 0.5 * rim * rim, uShade * vConf);
    lit *= 1.0 + 0.45 * vNear;   // the disturbed particles catch the light

    float alpha = disc * uOpacity * vAlpha * depthFade * lit * 0.74 * (1.0 - 0.45 * vBurst);
    gl_FragColor = vec4(col, alpha);
  }
`;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 * @param {number} opts.count            particle count; every shape must be count*3 long
 * @param {Float32Array[]} opts.shapes   the seven shapes from buildAllShapes()
 * @param {(state: object, dt: number) => void} [opts.onFrame]  called before each render
 * @param {number} [opts.seed]           for aDir / aSeed / aScale
 * @param {[number,number,number]} [opts.coldColor]  sRGB, default marble
 * @param {[number,number,number]} [opts.warmColor]  sRGB, default ink
 * @param {number} [opts.parallax]       0..1 pointer-parallax strength, default 1 (0 under prefers-reduced-motion)
 * @param {number} [opts.fov]            degrees, default 38
 * @returns {{ state: object, resize: () => void, start: () => void, stop: () => void, dispose: () => void,
 *             setShape: (index: number, positions: Float32Array) => void, three: object }}
 */
export function createScene(canvas, { count, shapes, onFrame, seed = 1, coldColor, warmColor, parallax, fov = 38 } = {}) {
  if (!Array.isArray(shapes) || shapes.length < 2) throw new Error('createScene: need at least two shapes');
  shapes = shapes.slice();
  for (let i = 0; i < shapes.length; i++) {
    if (!(shapes[i] instanceof Float32Array) || shapes[i].length !== count * 3) {
      throw new Error(`createScene: shape ${i} must be a Float32Array of length count*3 (${count * 3}), got ${shapes[i]?.length}`);
    }
  }
  const maxMorph = shapes.length - 1;
  const state = { ...STATE_DEFAULTS };

  // ------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 60);

  // ------------------------------------------------------------- geometry
  const rng = mulberry32(seed);
  const posA = new Float32Array(count * 3);
  const posB = new Float32Array(count * 3);
  const dir = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const part = new Float32Array(count);
  const scale = new Float32Array(count);
  const baseCount = Math.round(count * 0.22); // mirrors shapes.BASE_SHARE; aPart is cosmetic (accent weighting)
  for (let i = 0; i < count; i++) {
    let x = rng() * 2 - 1, y = rng() * 2 - 1, z = rng() * 2 - 1;
    const l = Math.hypot(x, y, z) || 1;
    dir[i * 3] = x / l; dir[i * 3 + 1] = y / l; dir[i * 3 + 2] = z / l;
    // Base-group (plinth / rubble / lines…) particles get LOW seeds, so they
    // leave first and land first: the plinth gives before the figure does.
    seeds[i] = i < baseCount ? rng() * 0.4 : 0.25 + rng() * 0.75;
    part[i] = i < baseCount ? 0 : 1;
    scale[i] = 0.7 + rng() * rng() * 0.8;  // mostly small, a few larger
  }

  const geometry = new THREE.BufferGeometry();
  const nrmA = new Float32Array(count * 4);
  const nrmB = new Float32Array(count * 4);
  const attrNA = new THREE.BufferAttribute(nrmA, 4).setUsage(THREE.DynamicDrawUsage);
  const attrNB = new THREE.BufferAttribute(nrmB, 4).setUsage(THREE.DynamicDrawUsage);
  const attrA = new THREE.BufferAttribute(posA, 3).setUsage(THREE.DynamicDrawUsage);
  const attrB = new THREE.BufferAttribute(posB, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attrA); // three needs a 'position' for culling/bounds; we disable culling anyway
  geometry.setAttribute('aPosA', attrA);
  geometry.setAttribute('aPosB', attrB);
  geometry.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(scale, 1));
  geometry.setAttribute('aNrmA', attrNA);
  geometry.setAttribute('aNrmB', attrNB);

  const uniforms = {
    uMorph: { value: 0 },
    uSpread: { value: state.spread },
    uDrift: { value: state.drift },
    uSize: { value: state.size },
    uTime: { value: 0 },
    uPointScale: { value: 1 },
    uCamDist: { value: 5 },
    uLight: { value: new THREE.Vector3(-0.45, 0.78, 0.44) },   // fixed lamp, upper left and in front
    uPointer: { value: new THREE.Vector2(0, 0) },
    uPointerActive: { value: 0 },
    uAspect: { value: 1 },
    uRepel: { value: state.repel },
    uRepelRadius: { value: state.repelRadius },
    uSwirl: { value: 0 },
    uSweep: { value: new THREE.Vector3() },
    uPortal: { value: new THREE.Vector2(PORTAL.x, PORTAL.y) },
    uShade: { value: 1 },
    uOpacity: { value: 1 },
    uTone: { value: 0 },
    uAccentMix: { value: 0 },
    uAccent: { value: new THREE.Vector3(state.accentR, state.accentG, state.accentB) },
    uCold: { value: new THREE.Vector3(...(coldColor ?? [0.88, 0.90, 0.95])) },
    uWarm: { value: new THREE.Vector3(...(warmColor ?? [0.14, 0.11, 0.10])) },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    blending: THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  // ------------------------------------------------------------- A/B segments
  // Normals per shape, filled in asynchronously (see setNormals). Until a
  // shape's normals arrive its confidence is 0, i.e. it renders unshaded.
  const normals = shapes.map(() => null);
  const blank = new Float32Array(count * 4);

  let segment = -1;
  function applySegment(i) {
    segment = i;
    const j = Math.min(i + 1, maxMorph);
    posA.set(shapes[i]);
    posB.set(shapes[j]);
    nrmA.set(normals[i] || blank);
    nrmB.set(normals[j] || blank);
    attrA.needsUpdate = true;
    attrB.needsUpdate = true;
    attrNA.needsUpdate = true;
    attrNB.needsUpdate = true;
  }
  applySegment(0);

  function setShape(index, positions) {
    if (!(positions instanceof Float32Array) || positions.length !== count * 3) throw new Error('setShape: wrong length');
    shapes[index] = positions;
    normals[index] = null;
    if (index === segment || index === segment + 1) applySegment(segment);
  }

  /** Attach estimated normals for one shape (Float32Array, 4 per point). */
  function setNormals(index, data) {
    if (!(data instanceof Float32Array) || data.length !== count * 4) throw new Error('setNormals: wrong length');
    normals[index] = data;
    // only the normal buffer that changed is re-uploaded; positions stay put
    if (index === segment) { nrmA.set(data); attrNA.needsUpdate = true; }
    if (index === Math.min(segment + 1, maxMorph)) { nrmB.set(data); attrNB.needsUpdate = true; }
  }

  // ------------------------------------------------------------- sizing
  let width = 1, height = 1, dpr = 1;
  const view = { dy: 0 };   // frame offset for narrow screens (setViewOffset)
  function resize() {
    const w = canvas.clientWidth || canvas.width || 1;
    const h = canvas.clientHeight || canvas.height || 1;
    dpr = Math.min(MAX_DPR, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    if (w === width && h === height && renderer.getPixelRatio() === dpr) return;
    width = w; height = h;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    uniforms.uPointScale.value = (h / REF_HEIGHT) * dpr * REF_DISTANCE;
    uniforms.uAspect.value = w / h;
  }
  resize();

  // ------------------------------------------------------------- pointer parallax
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const parallaxStrength = parallax ?? (reduced ? 0 : 1);
  const pointer = { tx: 0, ty: 0, x: 0, y: 0, targetActive: 0, active: 0, rx: 0, ry: 0 };
  function onPointer(e) {
    if (!width || !height) return;
    pointer.tx = (e.clientX / width) * 2 - 1;
    pointer.ty = (e.clientY / height) * 2 - 1;
    pointer.targetActive = 1;
  }
  function onPointerLeave() { pointer.tx = 0; pointer.ty = 0; pointer.targetActive = 0; }
  function onPointerOut(e) { if (!e.relatedTarget) pointer.targetActive = 0; }

  // ------------------------------------------------------------- frame loop
  let raf = 0, running = false, wasRunningWhenHidden = false, last = 0, time = 0, swirlAngle = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    time += dt;
    if (onFrame) onFrame(state, dt);
    render(dt);
  }

  function render(dt) {
    resize();

    // morph → segment + fraction
    const m = Math.min(maxMorph, Math.max(0, state.morph || 0));
    let seg = Math.min(maxMorph - 1, Math.floor(m));
    if (seg !== segment) applySegment(seg);
    uniforms.uMorph.value = m - seg;

    uniforms.uSpread.value = state.spread;
    uniforms.uDrift.value = state.drift;
    uniforms.uSize.value = state.size;
    uniforms.uTime.value = time;
    uniforms.uOpacity.value = state.opacity;
    uniforms.uTone.value = state.tone;
    uniforms.uAccentMix.value = state.accentMix;
    uniforms.uAccent.value.set(state.accentR, state.accentG, state.accentB);

    // camera, with smoothed pointer parallax layered on top of the state
    const k = 1 - Math.exp(-dt * 5);
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;
    // the repulsion field follows its own, quicker smoothing and fades in/out
    const kr = 1 - Math.exp(-dt * 10);
    pointer.rx += (pointer.tx - pointer.rx) * kr;
    pointer.ry += (pointer.ty - pointer.ry) * kr;
    pointer.active += (pointer.targetActive - pointer.active) * (1 - Math.exp(-dt * 6));
    uniforms.uPointer.value.set(pointer.rx, -pointer.ry);
    uniforms.uPointerActive.value = reduced ? 0 : pointer.active;
    uniforms.uRepel.value = state.repel;
    uniforms.uRepelRadius.value = state.repelRadius;
    swirlAngle += dt * (state.swirl || 0);
    uniforms.uSwirl.value = swirlAngle;
    uniforms.uSweep.value.copy(SWEEP_DIR).multiplyScalar((state.sweep || 0) * 9);
    // pointer parallax plus a slow idle sway, so the stage is never a still photograph
    const sway = parallaxStrength * 0.045;
    const px = pointer.x * 0.16 * parallaxStrength + Math.sin(time * 0.23) * sway;
    const py = -pointer.y * 0.08 * parallaxStrength + Math.sin(time * 0.17 + 1.3) * sway * 0.5;
    camera.position.set(px, state.camY + py + view.dy, state.camZ);
    camera.lookAt(px * 0.35, state.lookY + py * 0.35 + view.dy, 0);
    uniforms.uCamDist.value = Math.hypot(camera.position.x - px * 0.35, camera.position.y - (state.lookY + py * 0.35 + view.dy), camera.position.z);

    points.rotation.set(state.tiltX, state.rotY, 0);
    renderer.render(scene, camera);
  }

  function start() {
    if (running) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function onVisibility() {
    if (document.hidden) {
      wasRunningWhenHidden = running;
      if (running) { stop(); }
    } else if (wasRunningWhenHidden) {
      wasRunningWhenHidden = false;
      start();
    }
  }
  function onContextLost(e) { e.preventDefault(); wasRunningWhenHidden = running; stop(); }
  function onContextRestored() { if (wasRunningWhenHidden) start(); }

  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerdown', onPointer, { passive: true });
  window.addEventListener('pointerleave', onPointerLeave, { passive: true });
  document.addEventListener('pointerout', onPointerOut, { passive: true });
  window.addEventListener('blur', onPointerLeave);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  function dispose() {
    stop();
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('pointerdown', onPointer);
    window.removeEventListener('pointerleave', onPointerLeave);
    document.removeEventListener('pointerout', onPointerOut);
    window.removeEventListener('blur', onPointerLeave);
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
  }

  return {
    state,
    resize,
    start,
    stop,
    dispose,
    setShape,
    setNormals,
    /** Shift the whole frame up/down (world units) without touching state — used to lift the figure above the copy on narrow screens. */
    setViewOffset: (dy) => { view.dy = dy; },
    /** The shapes the scene is currently holding (for normal estimation). */
    getShape: (i) => shapes[i],
    /** Render one frame immediately without the loop (tests, screenshots). */
    renderOnce: () => render(0),
    three: { renderer, scene, camera, points, material, geometry },
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
