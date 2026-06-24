'use strict';
// ============================================================
//  Skin store — libreria condivisa di skin SVG del pannello device.
//  Le skin sono ASSET per-MODELLO riusabili da ogni progetto (fuori dal JSON
//  progetto): metadati in skins/index.json, artwork in skins/<id>.svg.
//  Mirror della struttura di projects-store.js.
// ============================================================
const fs   = require('fs');
const path = require('path');
const { atomicWriteFile } = require('./projects-store');

// Override via INFRANET_SKINS_DIR (store isolato per E2E; default invariato).
const SKINS_DIR  = process.env.INFRANET_SKINS_DIR || path.join(__dirname, '..', 'skins');
if (!fs.existsSync(SKINS_DIR)) fs.mkdirSync(SKINS_DIR, { recursive: true });
const INDEX_FILE = path.join(SKINS_DIR, 'index.json');

// ---- puri (testabili senza fs) ---------------------------------------------

/** slug filesystem-safe da un nome libero. */
function slug(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // toglie accenti
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'skin';
}

/** id univoco a partire da una base, evitando quelli gia' presi. */
function makeSkinId(base, existingIds) {
  const root = slug(base);
  const taken = new Set(existingIds || []);
  let id = root, i = 2;
  while (taken.has(id)) id = root + '-' + (i++);
  return id;
}

/** upsert per id su un array indice (puro). */
function addToIndex(arr, rec) {
  const next = (arr || []).filter(x => x.id !== rec.id);
  next.push(rec);
  return next;
}

/** rimozione per id (puro). */
function removeFromIndex(arr, id) {
  return (arr || []).filter(x => x.id !== id);
}

// ---- fs ---------------------------------------------------------------------

function readIndex() {
  try { const a = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); return Array.isArray(a) ? a : []; }
  catch (_) { return []; }
}
function writeIndex(arr) { atomicWriteFile(INDEX_FILE, JSON.stringify(arr, null, 2)); }
function svgPath(id) { return path.join(SKINS_DIR, slug(id) + '.svg'); }

/** Solo metadati (senza svg). */
function listSkinsMeta() { return readIndex(); }

/** Metadati + svg di ogni skin (per popolare la cache client in un colpo). */
function listSkinsFull() {
  return readIndex().map(rec => {
    let svg = '';
    try { svg = fs.readFileSync(svgPath(rec.id), 'utf8'); } catch (_) {}
    return Object.assign({}, rec, { svg });
  });
}

function getSkin(id) {
  const rec = readIndex().find(x => x.id === id);
  if (!rec) return null;
  let svg = '';
  try { svg = fs.readFileSync(svgPath(id), 'utf8'); } catch (_) {}
  return Object.assign({}, rec, { svg });
}

/** Crea una nuova skin (id derivato e univoco). `svg` deve essere gia'
 *  sanitizzato dal chiamante (la route lo passa da parsePanelSkin). */
function saveSkin(meta, svg) {
  const idx = readIndex();
  const base = meta.name || [meta.brand, meta.model, meta.face].filter(Boolean).join('-') || 'skin';
  const id = makeSkinId(base, idx.map(x => x.id));
  const now = new Date().toISOString();
  const rec = {
    id,
    name:  meta.name || id,
    brand: meta.brand || '',
    model: meta.model || '',
    face:  meta.face === 'rear' ? 'rear' : 'front',
    viewBox: meta.viewBox || '',
    ports: meta.ports || [],
    createdAt: now, updatedAt: now
  };
  fs.writeFileSync(svgPath(id), String(svg || ''), 'utf8');
  writeIndex(addToIndex(idx, rec));
  return rec;
}

function deleteSkin(id) {
  const idx = readIndex();
  if (!idx.some(x => x.id === id)) return false;
  try { fs.unlinkSync(svgPath(id)); } catch (_) {}
  writeIndex(removeFromIndex(idx, id));
  return true;
}

module.exports = {
  SKINS_DIR, slug, makeSkinId, addToIndex, removeFromIndex,
  listSkinsMeta, listSkinsFull, getSkin, saveSkin, deleteSkin
};
