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

// ---- template NATIVO (ports + frontPanel) per il renderer di DEFAULT --------
// E' la strada per il look ESATTO: non una skin, ma i campi del nodo che il
// renderer nativo usa per disegnare copper/SFP/MGMT con le loro gabbie e numeri.
// Split fiber in SFP (1o blocco) e QSFP/40G+ (2o blocco); ports = totale dati
// (copper+sfp+qsfp) ordinati copper->sfp->qsfp (il frontpanel tratta la CODA come
// blocchi SFP). sfpStartNum/sfp2StartNum = numero iniziale REALE letto dal nome
// interfaccia device-type (es. "sfp-sfpplus1" -> 1 = numerazione che riparte).
// NB: frontpanel clampa sfpCount/sfp2Count a 8 e mgmtCount a 4.
function buildTemplate(dt) {
  let copper = 0, sfp = 0, qsfp = 0, mgmt = 0, sfp1st = null, qsfp1st = null;
  for (const it of (dt.interfaces || [])) {
    const k = classify(it);
    if (!k) continue;
    if (k === 'mgmt') { mgmt++; continue; }
    if (k === 'fiber') {
      const s = (String(it.type || '') + ' ' + String(it.name || '')).toLowerCase();
      if (/qsfp|40gbase|100gbase|200gbase|400gbase/.test(s)) { qsfp++; if (!qsfp1st) qsfp1st = it.name; }
      else { sfp++; if (!sfp1st) sfp1st = it.name; }
    } else copper++;
  }
  const ports = copper + sfp + qsfp;
  const trail = s => { const m = String(s || '').match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : null; };
  const fp = {};
  if (sfp + qsfp > 0) {
    fp.separateSfp = true;
    fp.sfpCount = Math.min(8, sfp);
    if (qsfp > 0) fp.sfp2Count = Math.min(8, qsfp);
    const ss = trail(sfp1st); if (ss && ss !== copper + 1) fp.sfpStartNum = ss;   // riparte (≠ continuata)
    const qs = trail(qsfp1st); if (qs) fp.sfp2StartNum = qs;
  }
  if (mgmt > 0) fp.mgmtCount = Math.min(4, mgmt);
  return { ports, rackU: Math.max(1, parseInt(dt.u_height, 10) || 1), counts: { copper, sfp, qsfp, mgmt }, frontPanel: fp };
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
  const usableW = W - 2 * padX;

  // Porte a PROPORZIONE FISSA e uniformi tra tutti i modelli: RJ45 ~quadrata (1.05:1),
  // SFP ~slot 1.9:1. La densita' cambia la SPAZIATURA, non la forma. Il blocco porte
  // e' centrato; shrink UNIFORME (aspetto preservato) solo se non entra in larghezza.
  const blocks = [];
  if (copper.length) blocks.push({ g: copper, k: 'cu' });
  if (fiber.length)  blocks.push({ g: fiber,  k: 'fib' });
  if (mgmt.length)   blocks.push({ g: mgmt,   k: 'mg' });
  const dims = ph => ({ ph, cu: ph * 1.05, fib: ph * 1.9, mg: ph * 1.05, gap: ph * 0.42, ggap: ph * 1.0 });
  const pwOf = (d, k) => (k === 'fib' ? d.fib : k === 'mg' ? d.mg : d.cu);
  const contentW = d => blocks.reduce((a, b, i) => a + (i ? d.ggap : 0) + Math.ceil(b.g.length / ROWS) * (pwOf(d, b.k) + d.gap) - d.gap, 0);
  let d = dims(Math.min(rowH * 0.6, 24));            // cap altezza porta (jack non giganti in 1 riga)
  const cw0 = contentW(d);
  if (cw0 > usableW) d = dims(d.ph * usableW / cw0);  // troppo densa: rimpicciolisci tutto uguale
  let cx = padX + Math.max(0, (usableW - contentW(d)) / 2);   // blocco porte centrato

  const rects = [];
  for (let bi = 0; bi < blocks.length; bi++) {
    if (bi > 0) cx += d.ggap;
    const b = blocks[bi], pw = pwOf(d, b.k);
    b.g.forEach((p, i) => {
      const col = Math.floor(i / ROWS), row = i % ROWS;
      const x = cx + col * (pw + d.gap);
      const y = gridY0 + row * rowH + (rowH - d.ph) / 2;
      const isFib = p.kind === 'fiber';
      const cls = p.kind === 'mgmt' ? 'p-mgmt' : isFib ? 'p-fib' : 'p-cu';
      // Placeholder = grigio "porta a riposo" del default (--inactive-color #6e7681):
      // nel rack il fill viene comunque stripato e ricolorato dallo stato SNMP; questo
      // rende l'ANTEPRIMA e la vista a riposo identiche a un device senza skin.
      rects.push(`  <rect id="${p.id}" class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${pw.toFixed(1)}" height="${d.ph.toFixed(1)}" rx="${isFib ? 3 : 2}" fill="#6e7681" stroke="#3a4048" stroke-width="1"/>`);
    });
    cx += Math.ceil(b.g.length / ROWS) * (pw + d.gap) - d.gap;
  }

  const title = esc(`${dt.manufacturer || ''} ${dt.model || ''}`.trim());
  // Chassis = STESSO gradiente metallico del device di default (--rack-metal
  // #4a4a4a->#2b2b2b): la skin non e' piu' "nera" ma grigia come un device senza
  // skin. id gradiente UNIVOCO per modello (niente collisioni con piu' skin nel rack).
  const gradId = 'ch-' + String(dt.slug || dt.model || 'x').replace(/[^\w-]/g, '').slice(0, 28);
  const svg =
`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4a4a"/><stop offset="1" stop-color="#2b2b2b"/></linearGradient></defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#${gradId})"/>
  <text x="${padX}" y="${titleH - 6}" fill="#d8dce0" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.round(titleH * 0.62)}" font-weight="600" opacity="0.85">${title}</text>
${rects.join('\n')}
</svg>`;

  return { svg, copper: copper.length, fiber: fiber.length, mgmt: mgmt.length, dataCount: dnum, mgmtCount: mnum };
}

// ---- main ------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const SEED = args.includes('--seed');   // scrive le skin nello skin store (server/skins-store)
  const catFlag = args.find(a => a.startsWith('--catalog='));   // --catalog=data/device-types.json
  const catalogPath = catFlag ? catFlag.slice('--catalog='.length) : null;
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
    // TEMPLATE NATIVO (ports + frontPanel) = look esatto via renderer di default.
    const tmpl = buildTemplate(dt);
    catalog.push({
      slug, brand: dt.manufacturer || '', model: dt.model || '',
      partNumber: dt.part_number || '', rackU: tmpl.rackU,
      isFullDepth: dt.is_full_depth === 'true',
      ports: tmpl.ports, frontPanel: tmpl.frontPanel, counts: tmpl.counts,
      skin: slug + '.svg'   // opzionale: artwork custom (non serve per il look default)
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

  // VERIFICA NATIVA: il frontpanel PURO (lo stesso del renderer default) deriva
  // dai campi template gli stessi conteggi SFP/MGMT? Prova che il look sara' esatto.
  const { frontPanelState } = require('../lib/frontpanel');
  let vOk = 0, vBad = 0;
  for (const c of catalog) {
    const s = frontPanelState({ type: 'switch', ports: c.ports, frontPanel: c.frontPanel }, c.ports, true);
    const eSfp = Math.min(8, c.counts.sfp), eSfp2 = Math.min(8, c.counts.qsfp), eMg = Math.min(4, c.counts.mgmt);
    if (s.sfpCount === eSfp && (s.sfp2Count || 0) === eSfp2 && (s.mgmtCount || 0) === eMg) vOk++;
    else { vBad++; if (vBad <= 6) console.log('  ! mismatch', c.model, '| sfp', s.sfpCount + '/' + eSfp, 'sfp2', (s.sfp2Count || 0) + '/' + eSfp2, 'mgmt', (s.mgmtCount || 0) + '/' + eMg); }
  }
  console.log(`Verifica frontpanel (puro): ${vOk} OK, ${vBad} mismatch\n`);

  // --catalog=<path>: installa/merge i template NATIVI nel catalogo servito
  // dall'app (GET /api/device-types). Campi essenziali; merge per slug.
  if (catalogPath) {
    let existing = [];
    try { const j = JSON.parse(fs.readFileSync(catalogPath, 'utf8')); if (Array.isArray(j)) existing = j; } catch (_) { /* file nuovo */ }
    const lean = catalog.map(c => ({ slug: c.slug, brand: c.brand, model: c.model, partNumber: c.partNumber, ports: c.ports, rackU: c.rackU, frontPanel: c.frontPanel, counts: c.counts }));
    const bySlug = new Map(existing.map(e => [e.slug, e]));
    for (const c of lean) bySlug.set(c.slug, c);
    const merged = [...bySlug.values()].sort((a, b) => (a.brand + a.model).localeCompare(b.brand + b.model));
    fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
    fs.writeFileSync(catalogPath, JSON.stringify(merged, null, 2), 'utf8');
    console.log(`CATALOG -> ${catalogPath}: ${merged.length} modelli totali (${lean.length} da questo run)\n`);
  }

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
