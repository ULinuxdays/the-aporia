#!/usr/bin/env node
/**
 * tools/import-mint.mjs — bring Mint-generated hardcovers onto the shelf.
 *
 * Run by hand on a developer machine after generating a book with Mint MCP
 * (the MCP is never called from browser code). It wraps the mint-threejs-skills
 * sync script, which downloads the artifact, inspects the GLB and records it
 * in the project registry `mint-assets.json`; then it points the matching
 * entry of assets/shelf/manifest.json at the local file. The shelf loads
 * whatever the manifest says; books without a file stay procedural.
 *
 *   # 1. in the MCP client, save the result of get_asset_artifact_manifest
 *   #    for the generated book to a temporary JSON file, then:
 *   node tools/import-mint.mjs --manifest /tmp/book-07.json --book 07
 *
 *   # already synced everything by hand? just map the registry onto the shelf:
 *   node tools/import-mint.mjs --from-registry
 *
 *   # forget a book (back to procedural)
 *   node tools/import-mint.mjs --book 07 --unlink
 *
 * Registry keys are `book-NN`. Asset root is assets/shelf/mint/ (so the
 * recorded localPath is already a URL relative to the site root).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHELF_MANIFEST = path.join(ROOT, 'assets', 'shelf', 'manifest.json');
const REGISTRY = path.join(ROOT, 'mint-assets.json');
const ASSET_ROOT = 'assets/shelf/mint';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes(name);

function fail(msg) { console.error(`import-mint: ${msg}`); process.exit(1); }

function findSyncScript() {
  const candidates = [
    process.env.MINT_SKILLS_ROOT,
    path.join(os.homedir(), '.claude', 'skills', 'mint-threejs-skills'),
    path.join(ROOT, '.claude', 'skills', 'mint-threejs-skills'),
  ].filter(Boolean);
  for (const c of candidates) {
    const p = path.join(c, 'scripts', 'sync-mint-assets.mjs');
    if (fs.existsSync(p)) return p;
  }
  fail('mint-threejs-skills not found. Install with: npx skills add mintdotgg/mint-threejs-skills -a claude-code -g -y');
}

function loadShelf() { return JSON.parse(fs.readFileSync(SHELF_MANIFEST, 'utf8')); }
function saveShelf(m) { fs.writeFileSync(SHELF_MANIFEST, JSON.stringify(m, null, 2) + '\n'); }
function loadRegistry() { return fs.existsSync(REGISTRY) ? JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) : null; }

/** Pick the GLB to load for a registry asset: the canonical model, else any glb. */
function pickArtifact(asset) {
  const arts = Object.values(asset.artifacts || {});
  return arts.find((a) => a.role === 'canonical_model' && a.format === 'glb')
    || arts.find((a) => a.format === 'glb')
    || null;
}

function linkBook(shelf, key, asset) {
  const book = shelf.books.find((b) => b.id === key);
  if (!book) return `${key}: no such book in the shelf manifest`;
  const art = pickArtifact(asset);
  if (!art) return `${key}: registry entry has no GLB artifact`;
  if (art.extensionsRequired?.some((e) => !['KHR_draco_mesh_compression', 'KHR_mesh_quantization', 'KHR_texture_transform'].includes(e))) {
    return `${key}: requires ${art.extensionsRequired.join(', ')} — the shelf loader only provides Draco. Not linked.`;
  }
  book.file = art.localPath.replace(/\\/g, '/');
  book.requiresDraco = !!art.requiresDraco;
  book.transform = book.transform || { yaw: 0 };
  book.attribution = book.attribution || `Generated with Mint (asset ${asset.source?.assetId ?? 'unknown'}).`;
  return `${key}: → ${book.file}${book.requiresDraco ? ' (draco)' : ''}`;
}

function main() {
  const shelf = loadShelf();
  const bookNo = opt('--book');
  const key = bookNo ? `book-${String(bookNo).padStart(2, '0')}` : null;

  if (has('--unlink')) {
    if (!key) fail('--unlink needs --book NN');
    const book = shelf.books.find((b) => b.id === key) || fail(`no book ${key}`);
    book.file = null; book.requiresDraco = false; delete book.transform;
    saveShelf(shelf);
    console.log(`${key}: unlinked, back to the procedural book`);
    return;
  }

  const manifestFile = opt('--manifest');
  if (manifestFile) {
    if (!key) fail('--manifest needs --book NN');
    const sync = findSyncScript();
    const res = spawnSync(process.execPath, [sync, '--project', ROOT, '--manifest', path.resolve(manifestFile), '--key', key, '--asset-root', ASSET_ROOT, ...(has('--force') ? ['--force'] : [])], { stdio: 'inherit' });
    if (res.status !== 0) fail(`sync-mint-assets.mjs exited with ${res.status}`);
  } else if (!has('--from-registry')) {
    fail('nothing to do. Use --manifest <file> --book NN, --from-registry, or --book NN --unlink');
  }

  const reg = loadRegistry() || fail('mint-assets.json not found — sync at least one book first');
  const keys = key ? [key] : Object.keys(reg.assets || {}).filter((k) => /^book-\d\d$/.test(k));
  if (!keys.length) fail('no book-NN assets in the registry');
  for (const k of keys) {
    const asset = reg.assets?.[k];
    console.log(asset ? linkBook(shelf, k, asset) : `${k}: not in the registry`);
  }
  saveShelf(shelf);
  const linked = shelf.books.filter((b) => b.file).length;
  console.log(`shelf manifest updated: ${linked}/${shelf.books.length} books from Mint, the rest procedural.`);
}

main();
