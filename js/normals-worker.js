/**
 * js/normals-worker.js — runs estimateNormals() off the main thread.
 * Message in:  { id, positions: Float32Array }   (positions transferred)
 * Message out: { id, normals: Float32Array }     (normals transferred)
 */
import { estimateNormals } from './normals.js';

self.onmessage = (e) => {
  const { id, positions } = e.data;
  const normals = estimateNormals(positions);
  self.postMessage({ id, normals }, [normals.buffer]);
};
