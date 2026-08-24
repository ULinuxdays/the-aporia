/**
 * js/shelf/plaque.js — an engraved brass plaque on the shelf's front edge.
 *
 * It names the centred book (number · title · status) and slides along the
 * lip to sit under whichever book is centred, the way a library labels a
 * run. Replaces any floating caption: the label lives in the room.
 */

import * as THREE from 'three';
import { animate } from 'animejs';

const W = 0.21, H = 0.042;  // metres
const FONT_DISPLAY = '"Bodoni Moda", "Bodoni 72", Didot, Georgia, serif';
const FONT_MONO = '"IBM Plex Mono", Menlo, monospace';
const STATUS = { out: 'OUT NOW', progress: 'IN PROGRESS', open: 'PITCH US', unwritten: 'UNWRITTEN' };

function engrave(book) {
  const PW = 1500, PH = 300;
  const c = document.createElement('canvas'); c.width = PW; c.height = PH;
  const ctx = c.getContext('2d');
  // brushed brass
  const g = ctx.createLinearGradient(0, 0, PW, PH);
  g.addColorStop(0, '#c9a86a'); g.addColorStop(0.45, '#b8955a'); g.addColorStop(0.55, '#d3b273'); g.addColorStop(1, '#ad8a50');
  ctx.fillStyle = g; ctx.fillRect(0, 0, PW, PH);
  for (let y = 0; y < PH; y += 3) { ctx.fillStyle = `rgba(255,240,200,${0.03 + (y % 9 === 0 ? 0.05 : 0)})`; ctx.fillRect(0, y, PW, 1); }
  // bevel
  ctx.strokeStyle = 'rgba(80,55,20,0.55)'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, PW - 10, PH - 10);
  ctx.strokeStyle = 'rgba(255,235,190,0.45)'; ctx.lineWidth = 3; ctx.strokeRect(18, 18, PW - 36, PH - 36);
  // engraving
  const ink = '#2b1d10';
  ctx.fillStyle = ink; ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `500 46px ${FONT_MONO}`;
  ctx.fillText(`ISSUE ${String(book.number).padStart(2, '0')}`, 70, 82);
  ctx.textAlign = 'right';
  ctx.fillText(STATUS[book.status] || book.status.toUpperCase(), PW - 70, 82);
  ctx.textAlign = 'center';
  let size = 136;
  ctx.font = `400 ${size}px ${FONT_DISPLAY}`;
  const title = book.status === 'unwritten' ? 'Unwritten' : book.title;
  while (ctx.measureText(title).width > PW - 160 && size > 56) { size -= 4; ctx.font = `400 ${size}px ${FONT_DISPLAY}`; }
  // engraved look: a light edge under a dark fill
  ctx.fillStyle = 'rgba(255,240,205,0.55)'; ctx.fillText(title, PW / 2 + 2, 200 + 3);
  ctx.fillStyle = ink; ctx.fillText(title, PW / 2, 200);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function createPlaque({ scene, lipY, lipZ, brass }) {
  const mat = new THREE.MeshStandardMaterial({ metalness: 0.82, roughness: 0.34, color: 0xffffff });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.0025), mat);
  plate.castShadow = true;
  const g = new THREE.Group();
  g.add(plate);
  for (const sx of [-1, 1]) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.002, 12), brass);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(sx * (W / 2 - 0.01), 0, 0.0015);
    g.add(screw);
  }
  g.position.set(0, lipY, lipZ + 0.0014);
  scene.add(g);

  let tween = null;
  let currentId = null;
  return {
    group: g,
    setBook(book, x, { immediate = false } = {}) {
      if (book.id !== currentId) {
        currentId = book.id;
        const old = mat.map;
        mat.map = engrave(book);
        mat.needsUpdate = true;
        old?.dispose();
      }
      if (tween) tween.pause();
      if (immediate) { g.position.x = x; return; }
      tween = animate(g.position, { x, duration: 700, ease: 'outExpo' });
    },
    setVisible(v) { g.visible = v; },
  };
}
