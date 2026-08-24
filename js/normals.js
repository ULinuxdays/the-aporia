/**
 * js/normals.js — estimate a surface normal for every point of a cloud.
 *
 * The baked clouds and the procedural shapes are positions only. To light
 * them like sculpture (and to hide the far side of a form so it stops
 * reading as an X-ray), each point needs a normal. We estimate one by local
 * PCA: the k nearest neighbours' covariance, smallest eigenvector = normal,
 * oriented away from the neighbourhood centroid (outward on anything
 * locally convex).
 *
 * Output: Float32Array of 4 per point — normal xyz and a confidence w in
 * [0, 1]. w is the planarity of the neighbourhood: ~1 on a surface, ~0 on a
 * line (network wires, traces, the underline) or inside a volume (the
 * unformed cloud). The shader scales shading by w, so lines and fog stay
 * unshaded instead of getting junk normals.
 *
 * ~150 ms for 90k points; scene.js runs it lazily, one shape at a time.
 */

/**
 * @param {Float32Array} pts  the whole cloud (needed for neighbour search)
 * @param {{k?: number, from?: number, to?: number}} [opts]  compute only points [from, to)
 * @returns {Float32Array} 4 floats per point IN THAT RANGE (normal xyz + confidence)
 */
export function estimateNormals(pts, { k = 16, from = 0, to = -1 } = {}) {
  const n = pts.length / 3;
  const hi = to < 0 ? n : Math.min(to, n);
  const lo = Math.max(0, from);
  const out = new Float32Array(Math.max(0, hi - lo) * 4);
  if (n < k + 1) return out;

  // bounding box
  let xmin = Infinity, ymin = Infinity, zmin = Infinity, xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  const diag = Math.hypot(xmax - xmin, ymax - ymin, zmax - zmin) || 1;
  // cell size: aim for a handful of points per occupied cell
  const cell = diag / 56;
  const nx = Math.max(1, Math.ceil((xmax - xmin) / cell) + 1);
  const ny = Math.max(1, Math.ceil((ymax - ymin) / cell) + 1);
  const nz = Math.max(1, Math.ceil((zmax - zmin) / cell) + 1);
  const cellOf = (x, y, z) => (((z - zmin) / cell) | 0) * ny * nx + (((y - ymin) / cell) | 0) * nx + (((x - xmin) / cell) | 0);

  // counting sort of point indices by cell
  const cells = nx * ny * nz;
  const count = new Int32Array(cells + 1);
  const cid = new Int32Array(n);
  for (let i = 0; i < n; i++) { const c = cellOf(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]); cid[i] = c; count[c + 1]++; }
  for (let c = 0; c < cells; c++) count[c + 1] += count[c];
  const order = new Int32Array(n);
  const fill = count.slice(0, cells);
  for (let i = 0; i < n; i++) order[fill[cid[i]]++] = i;

  // k-nearest scratch
  const nd = new Float64Array(k);  // distances²
  const ni = new Int32Array(k);    // indices
  const cov = new Float64Array(6);

  for (let i = lo; i < hi; i++) {
    const o4 = (i - lo) * 4;
    const px = pts[i * 3], py = pts[i * 3 + 1], pz = pts[i * 3 + 2];
    const cx = ((px - xmin) / cell) | 0, cy = ((py - ymin) / cell) | 0, cz = ((pz - zmin) / cell) | 0;
    let found = 0;
    for (let r = 1; r <= 3 && found < k; r++) {
      found = 0;
      for (let zz = Math.max(0, cz - r); zz <= Math.min(nz - 1, cz + r); zz++) {
        for (let yy = Math.max(0, cy - r); yy <= Math.min(ny - 1, cy + r); yy++) {
          let c = zz * ny * nx + yy * nx + Math.max(0, cx - r);
          const cEnd = zz * ny * nx + yy * nx + Math.min(nx - 1, cx + r);
          for (; c <= cEnd; c++) {
            for (let s = count[c], e = count[c + 1]; s < e; s++) {
              const j = order[s];
              if (j === i) continue;
              const dx = pts[j * 3] - px, dy = pts[j * 3 + 1] - py, dz = pts[j * 3 + 2] - pz;
              const d = dx * dx + dy * dy + dz * dz;
              // insert into the sorted k-list
              if (found < k) {
                let q = found++;
                while (q > 0 && nd[q - 1] > d) { nd[q] = nd[q - 1]; ni[q] = ni[q - 1]; q--; }
                nd[q] = d; ni[q] = j;
              } else if (d < nd[k - 1]) {
                let q = k - 1;
                while (q > 0 && nd[q - 1] > d) { nd[q] = nd[q - 1]; ni[q] = ni[q - 1]; q--; }
                nd[q] = d; ni[q] = j;
              }
            }
          }
        }
      }
    }
    if (found < 4) { out[o4 + 3] = 0; continue; }

    // centroid and covariance of the neighbourhood (including the point)
    let mx = px, my = py, mz = pz;
    for (let q = 0; q < found; q++) { const j = ni[q] * 3; mx += pts[j]; my += pts[j + 1]; mz += pts[j + 2]; }
    const inv = 1 / (found + 1);
    mx *= inv; my *= inv; mz *= inv;
    cov.fill(0);
    const acc = (x, y, z) => { cov[0] += x * x; cov[1] += x * y; cov[2] += x * z; cov[3] += y * y; cov[4] += y * z; cov[5] += z * z; };
    acc(px - mx, py - my, pz - mz);
    for (let q = 0; q < found; q++) { const j = ni[q] * 3; acc(pts[j] - mx, pts[j + 1] - my, pts[j + 2] - mz); }

    // eigen-decomposition of the symmetric 3×3 (Smith's closed form)
    const a = cov[0] * inv, b = cov[1] * inv, c = cov[2] * inv, d = cov[3] * inv, e = cov[4] * inv, f = cov[5] * inv;
    const p1 = b * b + c * c + e * e;
    let l0, l1, l2;
    if (p1 < 1e-18) { l0 = Math.min(a, d, f); l2 = Math.max(a, d, f); l1 = a + d + f - l0 - l2; }
    else {
      const q = (a + d + f) / 3;
      const p2 = (a - q) * (a - q) + (d - q) * (d - q) + (f - q) * (f - q) + 2 * p1;
      const p = Math.sqrt(p2 / 6);
      const ip = 1 / p;
      const B00 = (a - q) * ip, B01 = b * ip, B02 = c * ip, B11 = (d - q) * ip, B12 = e * ip, B22 = (f - q) * ip;
      const detB = B00 * (B11 * B22 - B12 * B12) - B01 * (B01 * B22 - B12 * B02) + B02 * (B01 * B12 - B11 * B02);
      let r = detB / 2;
      r = r < -1 ? -1 : r > 1 ? 1 : r;
      const phi = Math.acos(r) / 3;
      l2 = q + 2 * p * Math.cos(phi);
      l0 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
      l1 = 3 * q - l2 - l0;
    }
    // eigenvector for the smallest eigenvalue: cross product of two rows of (C − l0·I)
    const r0x = a - l0, r0y = b, r0z = c;
    const r1x = b, r1y = d - l0, r1z = e;
    const r2x = c, r2y = e, r2z = f - l0;
    let vx = r0y * r1z - r0z * r1y, vy = r0z * r1x - r0x * r1z, vz = r0x * r1y - r0y * r1x;
    let len = vx * vx + vy * vy + vz * vz;
    if (len < 1e-20) { vx = r0y * r2z - r0z * r2y; vy = r0z * r2x - r0x * r2z; vz = r0x * r2y - r0y * r2x; len = vx * vx + vy * vy + vz * vz; }
    if (len < 1e-20) { vx = r1y * r2z - r1z * r2y; vy = r1z * r2x - r1x * r2z; vz = r1x * r2y - r1y * r2x; len = vx * vx + vy * vy + vz * vz; }
    if (len < 1e-20) { out[o4 + 3] = 0; continue; }
    len = 1 / Math.sqrt(len);
    vx *= len; vy *= len; vz *= len;

    // orient outward: away from the neighbourhood centroid
    const ox = px - mx, oy = py - my, oz = pz - mz;
    if (vx * ox + vy * oy + vz * oz < 0) { vx = -vx; vy = -vy; vz = -vz; }

    // confidence: surface-likeness. surfaces: l0 ≪ l1 ≈ l2; lines: l0 ≈ l1 ≪ l2; blobs: all similar.
    const w = l2 > 1e-20 ? Math.min(1, Math.max(0, ((l1 - l0) / l2) * 1.6)) : 0;

    out[o4] = vx; out[o4 + 1] = vy; out[o4 + 2] = vz; out[o4 + 3] = w;
  }
  return out;
}
