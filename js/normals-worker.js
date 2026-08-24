/**
 * js/normals-worker.js — runs estimateNormals() off the main thread.
 * Message in:  { id, positions, from, to }   (positions transferred; the whole
 *                                            cloud is needed for the neighbour
 *                                            search, only [from, to) is computed)
 * Message out: { id, from, to, normals }     (normals transferred)
 */
import { estimateNormals } from './normals.js';

self.onmessage = (e) => {
  const { id, positions, from = 0, to = -1 } = e.data;
  const normals = estimateNormals(positions, { from, to });
  self.postMessage({ id, from, to, normals }, [normals.buffer]);
};
