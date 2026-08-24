#!/usr/bin/env node
/**
 * tools/bake.mjs — bake the source scans into point clouds for the site.
 *
 * Run by hand, on a developer machine. Node >= 18. Zero dependencies.
 * The browser never runs this; it only ever fetches the .bin files it writes.
 *
 *   node tools/bake.mjs                  bake both models, 60 000 points each
 *   node tools/bake.mjs --only thinker   (or --only epicurus)
 *   node tools/bake.mjs --points 80000
 *   node tools/bake.mjs --seed 7
 *   node tools/bake.mjs --thinker /path/to.stl --epicurus /path/to.obj
 *   node tools/bake.mjs --dtype float32   (default int16: half the bytes, 3e-5 precision)
 *
 * For each model:
 *   1. parse the mesh (own binary-STL / Wavefront-OBJ readers)
 *   2. STL only: detect + strip the printer raft (see detectRaft)
 *   3. rotate Z-up sources to Y-up, apply any yaw correction
 *   4. sample N points uniformly by triangle AREA
 *   5. normalise the sampled cloud: centre X/Z, min y = 0, max y = 1
 *   6. write assets/clouds/<name>.bin and update assets/clouds/manifest.json
 *
 * Output format and coordinate frame are specified in CONTRACTS.md §3–§4.
 * Sources are opened read-only and never copied into the repo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets', 'clouds');
const SOURCE_DIR = '/Users/uday/Desktop/Position papers';

/** Per-model bake configuration. `yaw` is a correction about +Y in degrees, applied after up-axis conversion. */
const MODELS = {
  thinker: {
    source: path.join(SOURCE_DIR, 'the-thinker-at-the-musee-rodin-france-1.stl'),
    kind: 'stl',
    sourceUp: '+Z',
    sourceUnits: 'mm',
    stripRaft: true,
    yaw: 0,
  },
  epicurus: {
    source: path.join(SOURCE_DIR, 'Epikur_Timvias.obj'),
    kind: 'obj',
    sourceUp: '+Y',
    sourceUnits: 'unlabelled (normalised away)',
    stripRaft: false,
    yaw: 180, // the scan faces -Z; turn it to face +Z (the default camera) like the Thinker
  },
};

// --------------------------------------------------------------------------- CLI

function parseArgs(argv) {
  const opts = { points: 60000, seed: 1, only: null, dtype: 'int16' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--points') opts.points = Number(next());
    else if (a === '--seed') opts.seed = Number(next());
    else if (a === '--only') opts.only = next();
    else if (a === '--dtype') opts.dtype = next();
    else if (a === '--thinker') MODELS.thinker.source = path.resolve(next());
    else if (a === '--epicurus') MODELS.epicurus.source = path.resolve(next());
    else if (a === '-h' || a === '--help') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else fail(`unknown argument ${a}`);
  }
  if (!Number.isInteger(opts.points) || opts.points <= 0) fail('--points must be a positive integer');
  if (!Number.isInteger(opts.seed)) fail('--seed must be an integer');
  if (opts.only && !MODELS[opts.only]) fail(`--only must be one of: ${Object.keys(MODELS).join(', ')}`);
  if (!['int16', 'float32'].includes(opts.dtype)) fail('--dtype must be int16 or float32');
  return opts;
}

function fail(msg) {
  console.error(`bake: ${msg}`);
  process.exit(1);
}

// --------------------------------------------------------------------------- readers
// Both return a flat triangle soup: Float32Array of 9 floats per triangle
// (ax ay az bx by bz cx cy cz). Nothing else about the source is kept.

/** Binary STL: 80-byte header, uint32 count, then 50 bytes per triangle. */
function readSTL(buf) {
  if (buf.length < 84) fail('STL too short to be binary');
  if (buf.toString('latin1', 0, 5) === 'solid' && !looksBinarySTL(buf)) fail('ASCII STL not supported');
  const count = buf.readUInt32LE(80);
  if (84 + count * 50 !== buf.length) fail(`STL size mismatch: header says ${count} triangles`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tris = new Float32Array(count * 9);
  for (let i = 0, o = 84 + 12; i < count; i++, o += 50) {
    // skip the 12-byte stored normal — we derive normals from winding when needed
    for (let k = 0; k < 9; k++) tris[i * 9 + k] = dv.getFloat32(o + k * 4, true);
  }
  return { tris, triangleCount: count, vertexCount: count * 3 };
}

function looksBinarySTL(buf) {
  const count = buf.readUInt32LE(80);
  return 84 + count * 50 === buf.length;
}

/**
 * Wavefront OBJ. Handles `v x y z`, `f a b c …` with `a`, `a/b`, `a//c`, `a/b/c`
 * index forms, negative (relative) indices, and fan-triangulates polygons.
 * vt / vn / groups / materials are ignored. Parsed byte-wise: the Epicurus
 * file is 122 MB and a split('\n') would allocate 2.3 M strings.
 */
function readOBJ(buf) {
  const verts = [];        // flat xyz, grows as plain JS numbers then packed
  const faceIdx = [];      // flat triangle vertex indices (0-based)
  const len = buf.length;
  let lineStart = 0;
  const SP = 32, NL = 10, CR = 13, SLASH = 47;

  const parseFloatAt = (s, e) => parseFloat(buf.toString('latin1', s, e));

  while (lineStart < len) {
    let lineEnd = buf.indexOf(NL, lineStart);
    if (lineEnd === -1) lineEnd = len;
    let end = lineEnd;
    if (end > lineStart && buf[end - 1] === CR) end--;

    const c0 = buf[lineStart], c1 = buf[lineStart + 1];
    if (c0 === 118 /* v */ && (c1 === SP || c1 === 9)) {
      let p = lineStart + 2, got = 0;
      while (got < 3 && p < end) {
        while (p < end && (buf[p] === SP || buf[p] === 9)) p++;
        const s = p;
        while (p < end && buf[p] !== SP && buf[p] !== 9) p++;
        if (p > s) { verts.push(parseFloatAt(s, p)); got++; }
      }
      if (got !== 3) fail(`OBJ: malformed vertex line at byte ${lineStart}`);
    } else if (c0 === 102 /* f */ && (c1 === SP || c1 === 9)) {
      const poly = [];
      let p = lineStart + 2;
      while (p < end) {
        while (p < end && (buf[p] === SP || buf[p] === 9)) p++;
        const s = p;
        while (p < end && buf[p] !== SP && buf[p] !== 9) p++;
        if (p === s) break;
        let slash = buf.indexOf(SLASH, s);
        if (slash === -1 || slash > p) slash = p;
        let idx = parseInt(buf.toString('latin1', s, slash), 10);
        if (Number.isNaN(idx)) fail(`OBJ: bad face index at byte ${s}`);
        const vcount = verts.length / 3;
        idx = idx < 0 ? vcount + idx : idx - 1;
        if (idx < 0 || idx >= vcount) fail(`OBJ: face index out of range at byte ${s}`);
        poly.push(idx);
      }
      for (let k = 1; k + 1 < poly.length; k++) faceIdx.push(poly[0], poly[k], poly[k + 1]);
    }
    lineStart = lineEnd + 1;
  }

  const triangleCount = faceIdx.length / 3;
  const tris = new Float32Array(triangleCount * 9);
  for (let i = 0; i < faceIdx.length; i++) {
    const v = faceIdx[i] * 3;
    tris[i * 3] = verts[v];
    tris[i * 3 + 1] = verts[v + 1];
    tris[i * 3 + 2] = verts[v + 2];
  }
  return { tris, triangleCount, vertexCount: verts.length / 3 };
}

// --------------------------------------------------------------------------- geometry helpers

function triangleAreas(tris) {
  const n = tris.length / 9;
  const areas = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    const ax = tris[o + 3] - tris[o], ay = tris[o + 4] - tris[o + 1], az = tris[o + 5] - tris[o + 2];
    const bx = tris[o + 6] - tris[o], by = tris[o + 7] - tris[o + 1], bz = tris[o + 8] - tris[o + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    areas[i] = Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5;
  }
  return areas;
}

function bbox(tris) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = tris[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/**
 * Detect a 3D-printer raft fused to the bottom of a Z-up mesh and return the
 * z threshold above which the real model starts.
 *
 * What a raft is, geometrically: a thin slab (possibly several layers with
 * gaps between them) whose XY footprint is LARGER than the part's first
 * layer — slicers add a margin around the part. So the signal is footprint,
 * not flatness: slice the bottom of the mesh thinly, measure each slice's XY
 * bounding-box area, and the raft is the contiguous band at the bottom whose
 * footprint is close to the largest footprint seen; the model begins where
 * the footprint drops and stays dropped.
 *
 * Everything is derived from the mesh itself:
 *   - window:   bottom 10 % of the height, 256 slices
 *   - raftFp:   the largest slice footprint in the window (the raft underside)
 *   - raft band: slices with footprint >= 0.8 * raftFp
 *   - threshold: the top edge of the highest raft-band slice
 * Sanity checks abort the bake (no silent guessing) if the band is thicker
 * than 5 % of the height, or if the footprint above it doesn't actually drop.
 */
function detectRaft(tris) {
  const { min, max } = bbox(tris);
  const zmin = min[2], height = max[2] - zmin;
  const SLICES = 256, WINDOW = 0.10, RATIO = 0.8, MAX_THICKNESS = 0.05;
  const top = zmin + height * WINDOW;
  const w = (top - zmin) / SLICES;

  const fx0 = new Float64Array(SLICES).fill(Infinity), fx1 = new Float64Array(SLICES).fill(-Infinity);
  const fy0 = new Float64Array(SLICES).fill(Infinity), fy1 = new Float64Array(SLICES).fill(-Infinity);
  const count = new Uint32Array(SLICES);

  for (let i = 0; i < tris.length; i += 9) {
    const zc = (tris[i + 2] + tris[i + 5] + tris[i + 8]) / 3;
    if (zc >= top) continue;
    const s = Math.min(SLICES - 1, Math.floor((zc - zmin) / w));
    count[s]++;
    for (const k of [0, 3, 6]) {
      const x = tris[i + k], y = tris[i + k + 1];
      if (x < fx0[s]) fx0[s] = x; if (x > fx1[s]) fx1[s] = x;
      if (y < fy0[s]) fy0[s] = y; if (y > fy1[s]) fy1[s] = y;
    }
  }

  const footprint = new Float64Array(SLICES);
  let raftFp = 0;
  for (let s = 0; s < SLICES; s++) {
    footprint[s] = count[s] ? (fx1[s] - fx0[s]) * (fy1[s] - fy0[s]) : 0;
    if (footprint[s] > raftFp) raftFp = footprint[s];
  }

  let topSlice = -1;
  for (let s = 0; s < SLICES; s++) if (footprint[s] >= RATIO * raftFp) topSlice = s;
  if (topSlice < 0) fail('raft detection: no slices at all in the bottom window');

  const threshold = zmin + (topSlice + 1) * w;
  const thickness = threshold - zmin;

  // The footprint above the band must actually be smaller — otherwise this
  // isn't a raft, it's just the bottom of a wide model.
  const above = [];
  for (let s = topSlice + 1; s < Math.min(SLICES, topSlice + 21); s++) if (count[s]) above.push(footprint[s]);
  if (above.length < 5) fail('raft detection: nothing above the candidate raft in the window — is the window too small?');
  above.sort((a, b) => a - b);
  const medianAbove = above[above.length >> 1];
  if (medianAbove >= RATIO * raftFp) {
    fail(`raft detection: footprint does not drop above z=${threshold.toFixed(3)} (${(medianAbove / raftFp).toFixed(2)} of raft footprint). Refusing to guess.`);
  }
  if (thickness > height * MAX_THICKNESS) {
    fail(`raft detection: candidate raft is ${(100 * thickness / height).toFixed(1)} % of model height — too thick to be a raft. Refusing to guess.`);
  }

  return {
    threshold,
    thickness,
    thicknessFractionOfHeight: thickness / height,
    raftFootprintArea: raftFp,
    modelBaseFootprintArea: medianAbove,
    sliceWidth: w,
    method: `footprint drop: bottom ${WINDOW * 100} % sliced ${SLICES}×; raft = contiguous band with XY bbox area >= ${RATIO} × max; threshold = top of that band`,
  };
}

/** Keep only triangles whose centroid z is >= threshold. */
function stripBelowZ(tris, threshold) {
  const n = tris.length / 9;
  let kept = 0;
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    if ((tris[o + 2] + tris[o + 5] + tris[o + 8]) / 3 >= threshold) { keep[i] = 1; kept++; }
  }
  const out = new Float32Array(kept * 9);
  for (let i = 0, j = 0; i < n; i++) {
    if (!keep[i]) continue;
    out.set(tris.subarray(i * 9, i * 9 + 9), j * 9);
    j++;
  }
  return out;
}

/** (x, y, z) → (x, z, −y): rotate −90° about X so +Z becomes +Y. Preserves winding. */
function rotateZUpToYUp(tris) {
  for (let i = 0; i < tris.length; i += 3) {
    const y = tris[i + 1], z = tris[i + 2];
    tris[i + 1] = z;
    tris[i + 2] = -y;
  }
}

/** Rotate about +Y by `deg` degrees (in the Y-up frame). */
function yaw(tris, deg) {
  if (!deg) return;
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], z = tris[i + 2];
    tris[i] = c * x + s * z;
    tris[i + 2] = -s * x + c * z;
  }
}

// --------------------------------------------------------------------------- sampling

/** mulberry32 — small, fast, deterministic. Good enough for sampling positions. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Uniform surface sampling by triangle area.
 *   - pick a triangle with probability proportional to its area
 *     (cumulative-area table + binary search)
 *   - pick a uniformly distributed point inside it
 *     (r1, r2 ~ U[0,1); reflect if r1 + r2 > 1; p = a + r1·(b−a) + r2·(c−a))
 * Each sample is independent, so the output order is random and any prefix
 * is itself a uniform, lower-density sample.
 */
function sampleByArea(tris, areas, count, rng) {
  const n = areas.length;
  const cum = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) { total += areas[i]; cum[i] = total; }
  if (!(total > 0)) fail('mesh has zero surface area');

  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const target = rng() * total;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cum[mid] < target) lo = mid + 1; else hi = mid;
    }
    const o = lo * 9;
    let r1 = rng(), r2 = rng();
    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
    out[i * 3]     = ax + r1 * (tris[o + 3] - ax) + r2 * (tris[o + 6] - ax);
    out[i * 3 + 1] = ay + r1 * (tris[o + 4] - ay) + r2 * (tris[o + 7] - ay);
    out[i * 3 + 2] = az + r1 * (tris[o + 5] - az) + r2 * (tris[o + 8] - az);
  }
  return { points: out, totalArea: total };
}

/** Centre on X/Z by bbox, drop min y to 0, scale so max y is exactly 1. In place. */
function normalise(points) {
  const { min, max } = bbox(points);
  const height = max[1] - min[1];
  if (!(height > 0)) fail('degenerate cloud: zero height');
  const s = 1 / height;
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
  for (let i = 0; i < points.length; i += 3) {
    points[i]     = (points[i] - cx) * s;
    points[i + 1] = (points[i + 1] - min[1]) * s;
    points[i + 2] = (points[i + 2] - cz) * s;
  }
  // Float32 rounding can leave max y at 0.99999994; pin the extremes exactly.
  const after = bbox(points);
  return { min: after.min.map(v => round6(v)), max: after.max.map(v => round6(v)) };
}

const round6 = v => Math.round(v * 1e6) / 1e6;

// --------------------------------------------------------------------------- output

const INT16_SCALE = 32767;
/**
 * int16: every coordinate is within [-1, 1] after normalisation (x/z centred,
 * y in [0, 1]), so value·32767 rounds to a signed 16-bit with a worst-case
 * error of 1.5e-5 units on a height of 1. Half the bytes of float32.
 */
function writeBin(file, points, dtype) {
  if (dtype === 'int16') {
    const buf = Buffer.alloc(points.length * 2);
    for (let i = 0; i < points.length; i++) {
      const q = Math.max(-INT16_SCALE, Math.min(INT16_SCALE, Math.round(points[i] * INT16_SCALE)));
      buf.writeInt16LE(q, i * 2);
    }
    fs.writeFileSync(file, buf);
    return buf.length;
  }
  const buf = Buffer.alloc(points.length * 4);
  for (let i = 0; i < points.length; i++) buf.writeFloatLE(points[i], i * 4); // explicit LE regardless of host
  fs.writeFileSync(file, buf);
  return buf.length;
}

function loadManifest(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function saveManifest(file, manifest) {
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}

// --------------------------------------------------------------------------- main

function fmtMB(bytes) { return (bytes / 1e6).toFixed(3) + ' MB'; }
function elapsed(t0) { return ((performance.now() - t0) / 1000).toFixed(1) + 's'; }

function bakeOne(name, cfg, opts) {
  const t0 = performance.now();
  console.log(`\n[${name}] ${path.basename(cfg.source)}`);
  if (!fs.existsSync(cfg.source)) fail(`source not found: ${cfg.source}`);

  const buf = fs.readFileSync(cfg.source);           // read-only; never written back
  const parsed = cfg.kind === 'stl' ? readSTL(buf) : readOBJ(buf);
  let tris = parsed.tris;
  console.log(`  parsed ${parsed.triangleCount.toLocaleString('en-US')} triangles, ${parsed.vertexCount.toLocaleString('en-US')} vertices (${elapsed(t0)})`);

  const sourceBox = bbox(tris);
  console.log(`  source bbox min [${sourceBox.min.map(v => v.toFixed(3)).join(', ')}] max [${sourceBox.max.map(v => v.toFixed(3)).join(', ')}]`);

  let raft = { stripped: false };
  if (cfg.stripRaft) {
    if (cfg.sourceUp !== '+Z') fail('raft detection is written for Z-up sources');
    const r = detectRaft(tris);
    const before = tris.length / 9;
    tris = stripBelowZ(tris, r.threshold);
    const removed = before - tris.length / 9;
    raft = {
      stripped: true,
      zThresholdSource: round6(r.threshold),
      thicknessSource: round6(r.thickness),
      thicknessFractionOfHeight: round6(r.thicknessFractionOfHeight),
      raftFootprintArea: round6(r.raftFootprintArea),
      modelBaseFootprintArea: round6(r.modelBaseFootprintArea),
      trianglesRemoved: removed,
      method: r.method,
    };
    console.log(`  raft: threshold z=${r.threshold.toFixed(3)} ${cfg.sourceUnits} (${(100 * r.thicknessFractionOfHeight).toFixed(2)} % of height), footprint ${r.raftFootprintArea.toFixed(0)} → ${r.modelBaseFootprintArea.toFixed(0)}; removed ${removed.toLocaleString('en-US')} triangles`);
  }

  if (cfg.sourceUp === '+Z') rotateZUpToYUp(tris);
  else if (cfg.sourceUp !== '+Y') fail(`unsupported sourceUp ${cfg.sourceUp}`);
  yaw(tris, cfg.yaw);

  const areas = triangleAreas(tris);
  const rng = makeRng(opts.seed);
  const { points, totalArea } = sampleByArea(tris, areas, opts.points, rng);
  console.log(`  sampled ${opts.points.toLocaleString('en-US')} points by area over ${(tris.length / 9).toLocaleString('en-US')} triangles (surface area ${totalArea.toPrecision(5)} in source units²)`);

  const box = normalise(points);
  console.log(`  normalised bbox min [${box.min.join(', ')}] max [${box.max.join(', ')}]`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.bin`);
  const bytes = writeBin(file, points, opts.dtype);
  console.log(`  wrote ${path.relative(ROOT, file)} — ${bytes.toLocaleString('en-US')} bytes (${fmtMB(bytes)}) in ${elapsed(t0)}`);

  return {
    file: `${name}.bin`,
    bytes,
    dtype: opts.dtype,
    scale: opts.dtype === 'int16' ? 1 / INT16_SCALE : 1,
    pointCount: opts.points,
    source: path.basename(cfg.source),
    sourceTriangles: parsed.triangleCount,
    sourceVertices: parsed.vertexCount,
    bakedTriangles: tris.length / 9,
    sourceUp: cfg.sourceUp,
    sourceUnits: cfg.sourceUnits,
    yawDegrees: cfg.yaw,
    raft,
    bbox: box,
    seed: opts.seed,
    attribution: '',
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const names = opts.only ? [opts.only] : Object.keys(MODELS);
  const manifestFile = path.join(OUT_DIR, 'manifest.json');
  const previous = loadManifest(manifestFile);

  const manifest = {
    version: 1,
    generated: new Date().toISOString(),
    generator: 'tools/bake.mjs',
    format: { dtype: opts.dtype, scale: opts.dtype === 'int16' ? 1 / INT16_SCALE : 1, layout: 'xyz-interleaved', endian: 'little', up: '+Y', height: 1, centred: 'x,z by bbox', order: 'random — any prefix is a uniform subsample', note: 'per-cloud dtype/scale in clouds.*; multiply int16 values by scale' },
    clouds: previous?.clouds ?? {},
  };

  for (const name of names) {
    const entry = bakeOne(name, MODELS[name], opts);
    // keep an attribution the owner already typed in
    const prior = previous?.clouds?.[name]?.attribution;
    if (prior) entry.attribution = prior;
    manifest.clouds[name] = entry;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  saveManifest(manifestFile, manifest);

  let total = 0;
  console.log('\nSummary');
  for (const [name, c] of Object.entries(manifest.clouds)) {
    total += c.bytes;
    console.log(`  ${name.padEnd(9)} ${String(c.pointCount).padStart(7)} pts  ${String(c.bytes).padStart(9)} bytes  (${fmtMB(c.bytes)})${c.attribution ? '' : '   ⚠ attribution blank'}`);
  }
  console.log(`  ${'total'.padEnd(9)} ${''.padStart(7)}      ${String(total).padStart(9)} bytes  (${fmtMB(total)})`);
  console.log(`  manifest: ${path.relative(ROOT, manifestFile)}`);
}

main();
