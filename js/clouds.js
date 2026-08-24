/**
 * js/clouds.js — load the pre-baked point clouds.
 *
 * The clouds are raw little-endian Float32 XYZ triples written by
 * tools/bake.mjs (see CONTRACTS.md §3). This module never throws: a missing
 * or malformed file resolves to `null` so the page can be developed, and can
 * degrade in production, without the bake having run.
 *
 * Paths are relative to the document, because index.html sits at the folder
 * root and that folder is what gets deployed.
 */

/** @type {{ thinker: string, epicurus: string }} */
export const CLOUD_URLS = Object.freeze({
  thinker: 'assets/clouds/thinker.bin',
  epicurus: 'assets/clouds/epicurus.bin',
});

export const MANIFEST_URL = 'assets/clouds/manifest.json';

/**
 * Fetch one baked cloud.
 * @param {string} url
 * @param {{ dtype?: 'int16'|'float32', scale?: number }} [format]  from the manifest; defaults to float32.
 *   int16 files (the bake's default) are dequantised to Float32 here: value × scale.
 * @returns {Promise<Float32Array|null>} XYZ triples, or null on any failure.
 */
export async function loadCloud(url, format = {}) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.info(`[clouds] ${url}: HTTP ${res.status} — cloud unavailable`);
      return null;
    }
    const buf = await res.arrayBuffer();
    // Decide the dtype from the bytes themselves, checked against the manifest's
    // point count when we have one: a cached Float32 file read as Int16 (or the
    // reverse) is garbage, and caches are exactly where that happens.
    let dtype = null;
    if (format.pointCount) {
      if (buf.byteLength === format.pointCount * 6) dtype = 'int16';
      else if (buf.byteLength === format.pointCount * 12) dtype = 'float32';
      else { console.warn(`[clouds] ${url}: ${buf.byteLength} bytes does not match ${format.pointCount} points — cloud unavailable`); return null; }
    } else {
      // no manifest: a 60k int16 file is also a whole number of float32 triples,
      // so look at the values — normalised clouds live within ±1.5.
      dtype = buf.byteLength % 12 === 0 && plausibleFloat32(buf) ? 'float32' : 'int16';
    }
    const bytesPerPoint = dtype === 'int16' ? 6 : 12;
    if (buf.byteLength === 0 || buf.byteLength % bytesPerPoint !== 0) {
      console.warn(`[clouds] ${url}: ${buf.byteLength} bytes is not a whole number of ${dtype} XYZ triples`);
      return null;
    }
    // The bake writes little-endian; every platform the page runs on is
    // little-endian, so a straight view is correct and copy-free.
    if (dtype === 'float32') return new Float32Array(buf);
    const q = new Int16Array(buf);
    // trust the manifest's scale only if it was describing an int16 file
    const scale = format.dtype === 'int16' && format.scale ? format.scale : 1 / 32767;
    const out = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) out[i] = q[i] * scale;
    return out;
  } catch (err) {
    console.info(`[clouds] ${url}: ${err && err.message ? err.message : err} — cloud unavailable`);
    return null;
  }
}

/** True if the first few hundred values read as a normalised float32 cloud. */
function plausibleFloat32(buf) {
  const f = new Float32Array(buf, 0, Math.min(600, buf.byteLength >> 2));
  for (let i = 0; i < f.length; i++) if (!Number.isFinite(f[i]) || Math.abs(f[i]) > 1.5) return false;
  return true;
}

/**
 * Fetch both clouds in parallel, reading the manifest first for each file's
 * dtype/scale (a missing manifest falls back to sniffing the byte length).
 * @param {string} [base=''] optional prefix, e.g. '/' or '../'. Must end in '/' if non-empty.
 * @returns {Promise<{ thinker: Float32Array|null, epicurus: Float32Array|null }>}
 */
export async function loadAllClouds(base = '') {
  let manifest = null;
  try { const r = await fetch(base + MANIFEST_URL, { cache: 'no-cache' }); if (r.ok) manifest = await r.json(); } catch {}
  const fmt = (name) => manifest?.clouds?.[name]
    ? { dtype: manifest.clouds[name].dtype, scale: manifest.clouds[name].scale, pointCount: manifest.clouds[name].pointCount }
    : {};
  // the manifest's `generated` stamp versions the files: a re-bake is a new URL, never a stale cache hit
  const v = manifest?.generated ? `?v=${encodeURIComponent(manifest.generated)}` : '';
  const [thinker, epicurus] = await Promise.all([
    loadCloud(base + CLOUD_URLS.thinker + v, fmt('thinker')),
    loadCloud(base + CLOUD_URLS.epicurus + v, fmt('epicurus')),
  ]);
  return { thinker, epicurus };
}
