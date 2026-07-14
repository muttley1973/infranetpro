#!/usr/bin/env node
'use strict';
// ============================================================================
//  import-device-types.js  —  public-domain (CC0) device-type data  ->  InfraNet
//
//  Usa i DATI YAML (CC0, riusabili anche commercialmente) della
//  public-domain device-type library per generare:
//    (a) un CATALOGO modelli JSON (brand/model/u_height/conteggi porte)
//    (b) SKIN SVG NATIVE InfraNet, VETTORIALI e con porte VIVE (id="port-N"),
//        validate con lib/panel-skin.js.
//
//  NON usa le immagini di elevazione di device-type: sono raster, senza id-porta
//  (non diventerebbero LED vivi nel rack) e con provenienza incerta. Qui si
//  prende solo il dato strutturato e si disegna artwork NOSTRO.
//
//  Uso:  node tools/import-device-types.js [inputDir] [outDir]
//        inputDir = cartella con file .yaml della devicetype-library
//        outDir   = dove scrivere le skin .svg + catalog.json
// ============================================================================
const fs = require('fs');
const path = require('path');
const { parsePanelSkin } = require('../lib/panel-skin');

// Proporzione (larghezza:altezza) di uno slot rack 1U in InfraNet (da
// src/app-panel-skin.js): una skin 1U ~10.86:1 riempie lo slot con margine ~0.
const U_ASPECT = 10.86;

// ---- mini-parser YAML (sottoinsieme devicetype-library) --------------------
// Gestisce: scalari top-level `key: value`, e blocchi-lista `key:` + `  - a: b`
// con proprieta' indentate. Sufficiente per lo schema devicetype (niente
// mappe annidate profonde, niente ancore YAML). Puro, nessuna dipendenza.
function parseDeviceType(text) {
  const out = {};
  let curList = null, curItem = null;
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.replace(/^\s+/, '').length;
    const line = raw.trim();
    if (indent === 0) {
      curItem = null;
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (!m) continue;
      if (m[2] === '') { curList = m[1]; out[curList] = out[curList] || []; }
      else { curList = null; out[m[1]] = unquote(m[2]); }
    } else if (line.startsWith('- ')) {
      if (!curList) continue;
      curItem = {};
      if (!Array.isArray(out[curList])) out[curList] = [];
      out[curList].push(curItem);
      const m = line.slice(2).trim().match(/^([\w-]+):\s*(.*)$/);
      if (m) curItem[m[1]] = unquote(m[2]);
    } else if (curItem) {
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (m) curItem[m[1]] = unquote(m[2]);
    }
  }
  return out;
}
function unquote(v) {
  v = String(v).trim();
  if ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}

// ---- classificazione porta -------------------------------------------------
// -> 'copper' | 'fiber' | 'mgmt' | null (scarta: virtuali/wireless/lag).
function classify(iface) {
  const name = String(iface.name || '').toLowerCase();
  const label = String(iface.label || '').toLowerCase();
  const type = String(iface.type || '').toLowerCase();
  if (iface.mgmt_only === 'true' || /\bmgmt\b|manag/.test(name + ' ' + label)) return 'mgmt';
  if (/virtual|lag|bridge|ieee802\.11|wireless|lte|other$/.test(type)) return null;
  if (/sfp|qsfp|xfp|cfp|base-x|gbic/.test(type) || /sfp|qsfp/.test(name)) return 'fiber';
  if (/base-t|base-tx|base-t1|base-kx|10gbase-t|2\.5gbase|5gbase|100base|1000base/.test(type)) return 'copper';
  if (/ether|eth\d|^gi|^te|^fa|^xe/.test(name)) return 'copper';
  return 'copper'; // fallback: porta dati generica
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- costruzione skin SVG --------------------------------------------------
function buildSkin(dt) {
  const U = Math.max(1, parseInt(dt.u_height, 10) || 1);
  const W = 1000, H = Math.max(80, Math.round(1000 * U / U_ASPECT));

  // classifica + numera (numero ASSOLUTO 1..N, dati prima di mgmt)
  const copper = [], fiber = [], mgmt = [];
  let dnum = 0, mnum = 0;
  for (const it of (dt.interfaces || [])) {
    const k = classify(it);
    if (!k) continue;
    if (k === 'mgmt') { mnum++; mgmt.push({ id: 'mgmt-' + mnum, kind: 'mgmt', num: mnum, name: it.name }); }
    else { dnum++; (k === 'fiber' ? fiber : copper).push({ id: (k === 'fiber' ? 'sfp-' : 'port-') + dnum, kind: k, num: dnum, name: it.name }); }
  }

  const ROWS = (copper.length + fiber.length) > 6 ? 2 : 1;
  const padX = 16, titleH = Math.min(22, Math.round(H * 0.26)), padB = 8;
  const gridY0 = titleH, gridH = H - titleH - padB, rowH = gridH / ROWS;
  const groups = [copper, fiber, mgmt].filter(g => g.length);
  const colsOf = g => Math.ceil(g.length / ROWS);
  const GAP = 0.6;
  const totalCols = groups.reduce((a, g) => a + colsOf(g), 0) + GAP * Math.max(0, groups.length - 1);
  const usableW = W - 2 * padX;
  const colW = usableW / Math.max(1, totalCols);

  const rects = [];
  let cx = padX;
  groups.forEach((g, gi) => {
    if (gi > 0) cx += GAP * colW;
    g.forEach((p, i) => {
      const col = Math.floor(i / ROWS), row = i % ROWS;
      const x = cx + col * colW, y = gridY0 + row * rowH;
      const isFib = p.kind === 'fiber';
      const pw = colW * (isFib ? 0.84 : 0.72), ph = rowH * 0.66;
      const px = +(x + (colW - pw) / 2).toFixed(1), py = +(y + (rowH - ph) / 2).toFixed(1);
      const cls = p.kind === 'mgmt' ? 'p-mgmt' : isFib ? 'p-fib' : 'p-cu';
      const stroke = p.kind === 'mgmt' ? '#f5a623' : isFib ? '#2f6d86' : '#2a3440';
      rects.push(`  <rect id="${p.id}" class="${cls}" x="${px}" y="${py}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" rx="${isFib ? 3 : 2}" fill="#0d1117" stroke="${stroke}" stroke-width="1"/>`);
    });
    cx += colsOf(g) * colW;
  });

  const title = esc(`${dt.manufacturer || ''} ${dt.model || ''}`.trim());
  const svg =
`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="6" fill="#141a22" stroke="#0b0f14" stroke-width="2"/>
  <text x="${padX}" y="${titleH - 6}" fill="#8b95a1" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.round(titleH * 0.62)}" font-weight="600">${title}</text>
${rects.join('\n')}
</svg>`;

  return { svg, copper: copper.length, fiber: fiber.length, mgmt: mgmt.length, dataCount: dnum, mgmtCount: mnum };
}

// ---- main ------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const SEED = args.includes('--seed');   // scrive le skin nello skin store (server/skins-store)
  const pos = args.filter(a => !a.startsWith('--'));
  const inDir = pos[0] || path.join(__dirname, '..', 'skins-src', 'device-type-samples');
  const outDir = pos[1] || path.join(__dirname, '..', 'skins-src', 'generated');
  if (!fs.existsSync(inDir)) { console.error('Input dir non trovata:', inDir); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });

  const files = fs.readdirSync(inDir).filter(f => /\.ya?ml$/i.test(f));
  const catalog = [], seedBatch = [];
  let okN = 0, failN = 0;
  console.log(`\nInput: ${inDir}\nOutput: ${outDir}\nModelli: ${files.length}\n`);
  console.log('MODELLO'.padEnd(26), 'U', 'DATI', 'SFP', 'MGMT', 'VALIDAZIONE');
  console.log('-'.repeat(72));

  for (const f of files) {
    const dt = parseDeviceType(fs.readFileSync(path.join(inDir, f), 'utf8'));
    const built = buildSkin(dt);
    const parsed = parsePanelSkin(built.svg, {
      name: `${dt.manufacturer} ${dt.model}`, brand: dt.manufacturer, model: dt.model, face: 'front'
    });
    const slug = dt.slug || f.replace(/\.ya?ml$/i, '').toLowerCase();
    const model = `${dt.manufacturer || '?'} ${dt.model || slug}`;
    if (!parsed.ok) {
      failN++;
      console.log(model.slice(0, 25).padEnd(26), String(dt.u_height || 1).padEnd(1), '', '', '', 'X ' + parsed.errorCode + ': ' + parsed.error);
      continue;
    }
    // coerenza: le porte estratte dalla skin combaciano coi conteggi attesi?
    const okCounts = parsed.counts.data === built.dataCount && parsed.counts.mgmt === built.mgmtCount;
    fs.writeFileSync(path.join(outDir, slug + '.svg'), built.svg, 'utf8');
    catalog.push({
      slug, brand: dt.manufacturer || '', model: dt.model || '',
      partNumber: dt.part_number || '', uHeight: parseInt(dt.u_height, 10) || 1,
      isFullDepth: dt.is_full_depth === 'true', face: 'front',
      ports: { data: built.dataCount, copper: built.copper, fiber: built.fiber, mgmt: built.mgmtCount },
      skin: slug + '.svg'
    });
    seedBatch.push({ name: `${dt.manufacturer} ${dt.model}`, brand: dt.manufacturer || '', model: dt.model || '', face: parsed.face, viewBox: parsed.viewBox, ports: parsed.ports, svg: parsed.svg });
    okN++;
    const warn = parsed.warnings.length ? '  ! ' + parsed.warnings.length + ' warn' : '';
    console.log(model.slice(0, 25).padEnd(26), String(dt.u_height || 1).padEnd(1),
      String(built.dataCount).padEnd(4), String(built.fiber).padEnd(3), String(built.mgmt).padEnd(4),
      (parsed.ok ? 'OK' : 'X') + (okCounts ? '' : ' [counts?]') + warn);
  }

  fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 2), 'utf8');
  console.log('-'.repeat(72));
  console.log(`\nOK: ${okN}  FAIL: ${failN}  ->  ${path.join(outDir, 'catalog.json')} (${catalog.length} voci)\n`);

  // --seed: installa le skin nello skin store del server (skins/<id>.svg + index.json).
  // Idempotente: rimuove prima le skin preesistenti con stessa (brand, model, face).
  if (SEED && seedBatch.length) {
    const store = require('../server/skins-store');
    const keys = new Set(seedBatch.map(b => `${b.brand}|${b.model}|${b.face}`));
    let removed = 0;
    for (const s of store.listSkinsMeta()) {
      if (keys.has(`${s.brand}|${s.model}|${s.face}`) && store.deleteSkin(s.id)) removed++;
    }
    for (const b of seedBatch) {
      store.saveSkin({ name: b.name, brand: b.brand, model: b.model, face: b.face, viewBox: b.viewBox, ports: b.ports }, b.svg);
    }
    console.log(`SEED -> skin store: ${store.SKINS_DIR}\n  rimossi (re-seed): ${removed}  |  scritti: ${seedBatch.length}\n`);
  }
}

main();
