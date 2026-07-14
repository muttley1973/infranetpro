#!/usr/bin/env node
'use strict';
// ============================================================================
//  import-device-types.js  —  YAML device-type (CC0 / pubblico dominio)  ->  InfraNet
//
//  Usa DATI YAML pubblici (CC0, riusabili anche commercialmente) di device-type
//  per generare:
//    (a) un CATALOGO modelli JSON (brand/model/u_height/conteggi porte)
//    (b) SKIN SVG NATIVE InfraNet, VETTORIALI e con porte VIVE (id="port-N"),
//        validate con lib/panel-skin.js.
//
//  NON usa immagini di elevazione raster: senza id-porta (non diventerebbero LED
//  vivi nel rack) e con provenienza incerta. Qui si prende solo il dato
//  strutturato e si disegna artwork NOSTRO.
//
//  Uso:  node tools/import-device-types.js [inputDir] [outDir]
//        inputDir = cartella con file .yaml dei device-type
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

// Cap per blocco SFP: DEVE combaciare col clamp del renderer (lib/frontpanel.js
// `Math.min(SFP_BLOCK_MAX, ...)`). Se il tool capa a un valore e il renderer a un
// altro, le porte oltre il clamp del renderer diventano "rame fantasma".
const SFP_BLOCK_MAX = 48;

// ---- template NATIVO (ports + frontPanel) per il renderer di DEFAULT --------
// E' la strada per il look ESATTO: non una skin, ma i campi del nodo che il
// renderer nativo usa per disegnare copper/SFP/MGMT con le loro gabbie e numeri.
// Il renderer dispone: RAME in testa -> SFP blocco1 -> SFP blocco2 (in coda), con
// copper = ports - sfpCount - sfp2Count. Quindi:
//  (a) split fibra in DUE blocchi al PRIMO cambio di TIPO in ordine fisico
//      (block1 = corsa iniziale stesso tipo, es. 24xSFP+; block2 = resto, es. 4xSFP56).
//      Cosi' SFP+/SFP28/SFP56/QSFP finiscono nel blocco giusto (prima solo QSFP/40G+
//      andavano nel blocco2, e SFP56/25G/50G restavano erroneamente nel blocco1).
//  (b) ports MOSTRATE = rame + min(cap,block1) + min(cap,block2): coerente col clamp
//      del renderer -> rame_implicito == rame reale, MAI fibra resa come rame.
// sfpStartNum/sfp2StartNum = numero iniziale REALE dal nome interfaccia solo se la
// numerazione RIPARTE (≠ continuata), altrimenti omesso.
function buildTemplate(dt) {
  let copper = 0, mgmt = 0;
  const fiber = [];   // { type, name } in ORDINE fisico
  for (const it of (dt.interfaces || [])) {
    const k = classify(it);
    if (!k) continue;
    if (k === 'mgmt') { mgmt++; continue; }
    if (k === 'fiber') fiber.push({ type: String(it.type || '').toLowerCase(), name: it.name });
    else copper++;
  }
  // split al primo cambio di tipo: block1 = corsa iniziale, block2 = tutto il resto
  let b1 = 0, b2 = 0, b1first = null, b2first = null;
  if (fiber.length) {
    const t0 = fiber[0].type; b1first = fiber[0].name;
    let i = 0;
    while (i < fiber.length && fiber[i].type === t0) { b1++; i++; }
    if (i < fiber.length) { b2first = fiber[i].name; b2 = fiber.length - i; }
  }
  const trail = s => { const m = String(s || '').match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : null; };
  const sfp1 = Math.min(SFP_BLOCK_MAX, b1);
  const sfp2 = Math.min(SFP_BLOCK_MAX, b2);
  const ports = copper + sfp1 + sfp2;   // coerente col clamp del renderer
  const fp = {};
  if (sfp1 + sfp2 > 0) {
    fp.separateSfp = true;
    fp.sfpCount = sfp1;
    if (sfp2 > 0) fp.sfp2Count = sfp2;
    const ss = trail(b1first); if (ss && ss !== copper + 1) fp.sfpStartNum = ss;          // riparte
    if (sfp2 > 0) { const qs = trail(b2first); if (qs && qs !== copper + b1 + 1) fp.sfp2StartNum = qs; }
  }
  if (mgmt > 0) fp.mgmtCount = Math.min(4, mgmt);
  return {
    ports, rackU: Math.max(1, parseInt(dt.u_height, 10) || 1),
    counts: { copper, sfp: b1, qsfp: b2, mgmt, fiberDropped: (b1 - sfp1) + (b2 - sfp2) },
    frontPanel: fp,
  };
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

// ---- discovery ricorsiva (device-types/<Vendor>/<model>.yaml) ---------------
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(fp));
    else if (/\.ya?ml$/i.test(e.name)) out.push(fp);
  }
  return out;
}

// ---- filtro RUOLO (--roles) ------------------------------------------------
// InfraNet documenta INFRASTRUTTURA di rete: teniamo switch/router/AP/firewall
// + UPS/PDU/ATS + NAS; scartiamo endpoint (telefoni/workstation/camere), server/
// blade e accessori/moduli. Nessuna dipendenza dal singolo vendor (Regola ③):
// la decisione nasce dai DATI (porte, prese elettriche) + pattern di modello
// generici. Ritorna { role, keep } — bias a TENERE gli apparati di rete.
function roleOf(dt, c) {
  const brand = String(dt.manufacturer || '').toLowerCase();
  const model = String(dt.model || '').toLowerCase();
  const nm = brand + ' ' + model;
  const rx = re => re.test(nm);
  const data = c.copper + c.sfp + c.qsfp;                 // porte dati totali
  const outlets = (dt['power-outlets'] || []).length;     // prese = PDU/UPS
  const bays = (dt['module-bays'] || []).length;          // schede -> chassis modulare
  const csPorts = (dt['console-server-ports'] || []).length; // porte seriali gestite -> console server (OOB)
  // 1) Alimentazione: UPS / PDU / ATS (prese elettriche o nome inequivocabile)
  if (outlets >= 1 || rx(/\b(ups|pdu|ats|rack ?pdu|transfer switch|automatic transfer|smart-?ups|symmetra|maintenance bypass|inrow)\b/))
    return { role: 'power', keep: true };
  // 2) NAS / storage appliance
  if (/(synology|qnap)/.test(brand) || rx(/\b(nas|diskstation|rackstation|powervault|nimble)\b/))
    return { role: 'nas', keep: true };
  // 2b) Console server / OOB (gestisce >=4 porte seriali) -> TIENI. Segnale data-driven
  // (non per-vendor): distingue un console server da un endpoint mono-porta ethernet.
  if (csPorts >= 4) return { role: 'console', keep: true };
  // 3) Endpoint / periferica / ACCESSORIO -> SCARTA (anche se ha porte, es. IP phone)
  if (rx(/\b(ip ?phone|phone|handset|voip|conference|deskphone|workstation|desktop|laptop|notebook|thin ?client|monitor|display|projector|webcam|camera|ipcam|nvr|dvr|doorbell|sensor|speaker|soundbar|headset|tablet|printer|scanner|kvm|dock|injector|media converter|transceiver|\bpsu\b|power supply|fan ?tray|rack ?(kit|mount|tray)|rail ?kit|slide ?rail|\d-?post|mounting|bracket|blank(ing)?|shelf)\b/))
    return { role: 'endpoint', keep: false };
  // 4) Access point / bridge wireless -> TIENI (anche con 0-2 porte). Famiglie AP note
  // di piu' vendor: Cisco Catalyst 91xx/Aironet, Aruba (I)AP, FortiAP, Ubiquiti air*, TP-Link WA/CPE.
  if (rx(/wireless|wi-?fi|access ?point|\bap-?\d|\bap\b|\buap\b|\biap-?\d|aironet|catalyst ?91\d\d|fortiap|airengine|\bapx\d|air-?(fiber|max|cube|grid|gateway)|nanostation|nanobeam|litebeam|powerbeam|\brocket\b|\bbullet\b|meraki mr|aruba ?ap|instant ?on|\bomada\b|\beap-?\d|\bwap-?\d|\bwax-?\d|\bews\d|tl-?wa\d|\bcpe-?\d|\bgwn7[6-9]\d\d/))
    return { role: 'ap', keep: true };
  // 5) Chassis modulare (porte fornite da line-card negli module-bays)
  if (bays >= 2 && data < 4 && !rx(/\b(server|blade|enclosure|poweredge|proliant|synergy)\b/))
    return { role: 'chassis', keep: true };
  // 6) Server / blade / compute -> SCARTA (fuori dalla lista scelta) se poche porte
  if (rx(/\b(server|poweredge|proliant|synergy|blade|apollo|superserver|ucs [cbxs]\d|thinksystem|primergy|cloudline|edgeline)\b/) && data < 6)
    return { role: 'server', keep: false };
  // 7) Apparato di rete per densita' di porte (switch/router/firewall)
  if (data >= 2) return { role: 'network', keep: true };
  // 8) Router/gateway mono-porta dichiarato -> TIENI
  if (data >= 1 && rx(/router|gateway|\bisr\b|\bvedge\b|\bsd-?wan\b/)) return { role: 'router', keep: true };
  // 9) Residuo -> SCARTA
  return { role: 'other', keep: false };
}

// ---- main ------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const SEED = args.includes('--seed');   // scrive le skin nello skin store (server/skins-store)
  const catFlag = args.find(a => a.startsWith('--catalog='));   // --catalog=data/device-types.json
  const catalogPath = catFlag ? catFlag.slice('--catalog='.length) : null;
  const pos = args.filter(a => !a.startsWith('--'));
  const inDir = pos[0] || path.join(__dirname, '..', 'skins-src', 'devicetype-samples');
  const outDir = pos[1] || path.join(__dirname, '..', 'skins-src', 'generated');
  if (!fs.existsSync(inDir)) { console.error('Input dir non trovata:', inDir); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });

  // --vendors=A,B : limita alle cartelle-vendor indicate (segmento subito sotto inDir)
  const vendFlag = args.find(a => a.startsWith('--vendors='));
  const vendSet = vendFlag ? new Set(vendFlag.slice('--vendors='.length).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) : null;
  const ROLES = args.includes('--roles');   // tieni solo switch/router/AP/firewall/UPS/NAS
  const vendorOf = fp => { const rel = path.relative(inDir, fp).split(/[\\/]/); return rel.length > 1 ? rel[0] : (path.basename(path.dirname(fp))); };

  let files = walk(inDir);                                            // ricorsivo (sottocartelle vendor)
  if (vendSet) files = files.filter(fp => vendSet.has(vendorOf(fp).toLowerCase()));

  const catalog = [], seedBatch = [];
  let okN = 0, skinFailN = 0, dropN = 0;
  const perVendor = {};   // vendor -> { total, kept, byRole:{}, samples:[] }
  console.log(`\nInput: ${inDir}\nOutput: ${outDir}\nFile: ${files.length}${vendSet ? '  vendors=' + [...vendSet].join(',') : ''}${ROLES ? '  [filtro ruolo ON]' : ''}\n`);

  for (const fp of files) {
    const dt = parseDeviceType(fs.readFileSync(fp, 'utf8'));
    const vend = vendorOf(fp) || dt.manufacturer || '?';
    const st = perVendor[vend] || (perVendor[vend] = { total: 0, kept: 0, byRole: {}, samples: [] });
    st.total++;
    const slug = dt.slug || path.basename(fp).replace(/\.ya?ml$/i, '').toLowerCase();
    const model = `${dt.manufacturer || '?'} ${dt.model || slug}`;
    const tmpl = buildTemplate(dt);                                   // conteggi + template nativo
    if (ROLES) {
      const r = roleOf(dt, tmpl.counts);
      if (!r.keep) {
        dropN++; st.byRole[r.role] = (st.byRole[r.role] || 0) + 1;
        if (st.samples.length < 5) st.samples.push(`${dt.model || slug} [${r.role}]`);
        continue;
      }
    }
    st.kept++; okN++;
    // TEMPLATE NATIVO (ports + frontPanel) = look esatto via renderer di default.
    // Il catalogo nativo NON dipende dalla skin: UPS/PDU/NAS con 0 porte dati
    // restano validi (identita' + altezza-U). La skin sotto e' solo per --seed.
    const entry = {
      slug, brand: dt.manufacturer || '', model: dt.model || '',
      partNumber: dt.part_number || '', rackU: tmpl.rackU,
      isFullDepth: dt.is_full_depth === 'true',
      ports: tmpl.ports, frontPanel: tmpl.frontPanel, counts: tmpl.counts
    };
    catalog.push(entry);
    // SKIN (best-effort): solo se ci sono porte da disegnare; il fallito non esclude.
    const built = buildSkin(dt);
    if (built.dataCount + built.mgmtCount > 0) {
      const parsed = parsePanelSkin(built.svg, {
        name: `${dt.manufacturer} ${dt.model}`, brand: dt.manufacturer, model: dt.model, face: 'front'
      });
      if (parsed.ok) {
        fs.writeFileSync(path.join(outDir, slug + '.svg'), built.svg, 'utf8');
        entry.skin = slug + '.svg';   // opzionale: artwork custom (non serve al look default)
        seedBatch.push({ name: `${dt.manufacturer} ${dt.model}`, brand: dt.manufacturer || '', model: dt.model || '', face: parsed.face, viewBox: parsed.viewBox, ports: parsed.ports, svg: parsed.svg });
        const okCounts = parsed.counts.data === built.dataCount && parsed.counts.mgmt === built.mgmtCount;
        if (!okCounts) console.log('  ! counts?', model.slice(0, 40));
      } else { skinFailN++; }
    }
  }

  // Report per vendor: tenuti vs scartati (con motivo + esempi) — trasparenza filtro
  if (ROLES) {
    console.log('\nVENDOR'.padEnd(22), 'TOT', 'TIENI', 'SCARTA (per ruolo)   | esempi scarto');
    console.log('-'.repeat(96));
    for (const [v, s] of Object.entries(perVendor).sort((a, b) => b[1].kept - a[1].kept)) {
      const roles = Object.entries(s.byRole).map(([r, n]) => `${r}:${n}`).join(' ');
      console.log(v.slice(0, 21).padEnd(22), String(s.total).padEnd(4), String(s.kept).padEnd(6),
        (roles || '-').padEnd(20), '| ' + (s.samples.slice(0, 3).join(' · ') || ''));
    }
    console.log('-'.repeat(96));
  }

  fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 2), 'utf8');
  console.log('-'.repeat(72));
  console.log(`\nTIENI: ${okN}  SCARTA: ${dropN}  (skin non generata: ${skinFailN})  ->  ${path.join(outDir, 'catalog.json')} (${catalog.length} voci)\n`);

  // VERIFICA NATIVA: il frontpanel PURO (lo stesso del renderer default) deriva
  // dai campi template gli stessi conteggi SFP/MGMT? Prova che il look sara' esatto.
  const { frontPanelState } = require('../lib/frontpanel');
  let vOk = 0, vBad = 0;
  for (const c of catalog) {
    const s = frontPanelState({ type: 'switch', ports: c.ports, frontPanel: c.frontPanel }, c.ports, true);
    const eSfp = Math.min(48, c.counts.sfp), eSfp2 = Math.min(48, c.counts.qsfp), eMg = Math.min(4, c.counts.mgmt);
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
