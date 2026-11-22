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

/** What the bake ships, for when the manifest itself cannot be read. */
const SHIPPED = Object.freeze({ dtype: 'int16', pointCount: 60000, scale: 1 / 32767 });

/**
 * Fetch one baked cloud.
 * @param {string} url
 * @param {{ dtype?: 'int16'|'float32', scale?: number, pointCount?: number }} [format]  from the manifest.
 *   int16 files (the bake's default) are dequantised to Float32 here: value × scale.
 * @returns {Promise<Float32Array|null>} XYZ triples, or null on any failure.
 */
export async function loadCloud(url, format = {}) {
  const points = format.pointCount || SHIPPED.pointCount;
  try {
    const buf = await fetchCloud(url, points);
    // The dtype comes from the bytes, not the manifest: a cached Float32 file
    // read as Int16 (or the reverse) is garbage, and caches are where that happens.
    if (buf.byteLength === points * 12) return new Float32Array(buf);
    const q = new Int16Array(buf);
    const scale = format.dtype === 'int16' && format.scale ? format.scale : SHIPPED.scale;
    const out = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) out[i] = q[i] * scale;
    return out;
  } catch (err) {
    console.info(`[clouds] ${url}: ${err && err.message ? err.message : err} — cloud unavailable`);
    return null;
  }
}

/**
 * The bytes of one cloud, trying hard. These two files ARE the page: losing one
 * used to replace the sculpture with a stand-in made of tubes.
 *
 * Every attempt is checked for length, because a failure does not always look
 * like one: a filtering network answers a blocked .bin with 200 and an HTML
 * page, and that page can then sit in the cache. So the second try bypasses
 * the cache, and the last resort is the same bytes as a JavaScript module —
 * anything that let this file through will let that through too.
 */
async function fetchCloud(url, points) {
  const sound = (buf) => {
    if (buf.byteLength !== points * 6 && buf.byteLength !== points * 12) throw new Error(`${buf.byteLength} bytes is not ${points} points`);
    return buf;
  };
  const bin = async (cache) => {
    const r = await fetch(url, { cache });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return sound(await r.arrayBuffer());
  };
  const module = async () => {
    const file = url.split('?')[0].replace(/\.bin$/, '.js');
    const raw = atob((await import(new URL(file, document.baseURI).href)).default);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return sound(out.buffer);
  };
  let last;
  for (const [attempt, wait] of [[() => bin('default'), 0], [() => bin('reload'), 250], [module, 0], [() => bin('reload'), 1500]]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try { return await attempt(); } catch (err) { last = err; }
  }
  throw last;
}

/**
 * Fetch both clouds in parallel, reading the manifest first for each file's
 * dtype/scale (a missing manifest falls back to what the bake ships, SHIPPED).
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
