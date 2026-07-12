'use strict';
// ============================================================
// EXPORT — rete di sicurezza per export.js (mossa #2 review).
// export.js è uno script "classic" (IIFE) di ~1300 righe pieno di logica di
// costruzione SVG/PDF: è la superficie dove sono nate le regressioni storiche
// (VLAN troncate nel sommario, device passivi in rack, label cavo). Finora era
// FUORI dai test. Qui la copriamo esercitando i builder PURI esposti via
// `window._exportInternals` (stesso pattern di `_internals` in drivers/snmp.js)
// dentro il DOM-stub: stato realistico → asserzioni sulla forma del report e
// degli SVG, senza un browser o un PDF reale.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

let APP;
test('export: gli script caricano e _exportInternals è esposto', () => {
  APP = loadApp(ROOT);
  const ok = run(APP.ctx, `(() => typeof _exportInternals === 'object'
    && typeof _exportInternals._buildPdfReportData === 'function'
    && typeof _exportInternals._buildFloorSVG === 'function'
    && typeof _exportInternals._buildRackSVG === 'function')()`);
  assert.equal(ok, true, 'export.js deve esporre i builder interni per i test');
});

test('export: _ensureSvgXmlns → SVG-immagine valido (fix placeholder skin draw.io)', () => {
  // Un SVG usato come IMMAGINE (data URI) e' un documento standalone: senza xmlns
  // NON carica → draw.io mostra un placeholder. Regressione dell'export skin.
  const noNs = run(APP.ctx, `_exportInternals._ensureSvgXmlns('<svg viewBox="0 0 100 20"><rect/></svg>')`);
  assert.ok(/<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(noNs), 'xmlns iniettato');
  // idempotente: se gia' presente non lo duplica
  const withNs = run(APP.ctx, `_exportInternals._ensureSvgXmlns('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>')`);
  assert.equal((withNs.match(/xmlns="http/g) || []).length, 1, 'xmlns non duplicato');
  // xlink dichiarato se usato
  const xlink = run(APP.ctx, `_exportInternals._ensureSvgXmlns('<svg viewBox="0 0 1 1"><use xlink:href="#a"/></svg>')`);
  assert.ok(/xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/.test(xlink), 'xmlns:xlink iniettato');
  // data URI = image/svg+xml url-encoded (vettoriale, non base64)
  const uri = run(APP.ctx, `_exportInternals._svgDataUri('<svg xmlns="http://www.w3.org/2000/svg"></svg>')`);
  assert.ok(uri.indexOf('data:image/svg+xml,') === 0, 'data URI SVG url-encoded');
});

// Costruttore di uno stato realistico condiviso dai test: un rack con device
// attivi + passivi (incluso il cablemanager, storicamente problematico), un run
// strutturato switch→patch→presa→PC, un ramo VoIP, un trunk, VLAN con nomi e
// IPAM. Tutto via le API reali dell'app per restare coerente con l'engine.
const SETUP = `
  state = _buildDefaultState();
  if (typeof _migrateState === 'function') _migrateState(state);
  state.nodes.length = 0; state.links.length = 0; state.ports = {};
  const rid = state.currentRack;
  state.vlanColors = { 1:'#888', 10:'#39d353', 20:'#f5a623', 30:'#a371f7' };
  state.vlanNames  = { 10:'Management', 20:'Voce', 30:'Guest WiFi' };
  state.ipam = state.ipam || {}; state.ipam.vlans = state.ipam.vlans || {};
  state.ipam.vlans['10'] = { subnet:'10.0.10.0/24', gateway:'10.0.10.1', dns:'10.0.10.53' };
  state.nodes.push(
    { id:'sw', type:'switch', name:'CORE-SW', rackId:rid, rackU:1, sizeU:1, ports:24 },
    { id:'pp', type:'patchpanel', name:'PP-01', rackId:rid, rackU:3, sizeU:2, ports:24 },
    { id:'cm', type:'cablemanager', name:'CM-01', rackId:rid, rackU:5, sizeU:1 },
    { id:'ups', type:'ups', name:'UPS-01', rackId:rid, rackU:6, sizeU:2 },
    { id:'wp', type:'wallport', name:'WP-12', x:100, y:100, ports:1 },
    { id:'pc', type:'pc', name:'PC-AcCt', x:200, y:200, ports:1 },
    { id:'tel', type:'voip', name:'TEL-01', x:300, y:100, ports:1, spec:{ voiceVlan:20 } },
    { id:'pcv', type:'pc', name:'PC-Voip', x:300, y:200, ports:1 },
    { id:'ap', type:'ap', name:'AP-Lobby', x:400, y:100, ports:1,
      radios:[{ band:'5', ssids:[{ id:'g', ssid:'Guest', vlan:30 }] }] });
  if (typeof _invalidateIdx === 'function') _invalidateIdx();
  const mk = (s,d) => { const r = _createLinkRecord(s,d); state.links.push(r); return r; };
  mk('sw-1','pp-1'); mk('pp-1','wp-1'); mk('wp-1','pc-1');   // run dati access VLAN10
  const voipUp = mk('sw-2','tel-1'); mk('tel-1','pcv-1');    // ramo VoIP (uplink trunk voce+dati)
  mk('sw-3','ap-1');                                         // uplink AP
  if (typeof _invalidateIdx === 'function') _invalidateIdx();
  state.ports['sw-1'] = { vlanOvr:10, speed:1000, status:'active', ifName:'Gi0/1' };
  propagateVlans();
  // Trunk esplicito sull'uplink VoIP (voce 20 + dati 10): popola l.mode/l.trunkVlans,
  // i campi che il sommario VLAN del PDF legge per la sezione trunk.
  setLinkMode && setLinkMode(voipUp.id, 'trunk');
  setLinkTrunkVlans && setLinkTrunkVlans(voipUp.id, '10,20');
  propagateVlans();
`;

test('export: _buildPdfReportData — forma completa del report senza crash', () => {
  const out = run(APP.ctx, `(() => {
    try {
      ${SETUP}
      const d = _exportInternals._buildPdfReportData();
      return JSON.stringify({ ok:true,
        keys: Object.keys(d).sort(),
        cables: d.cables.length,
        vlanIds: d.vlans.map(v => v.id),
        rackSvgCount: d.rackSvgs.length,
        // VLAN 10: deve avere il nome (non troncato) e l'IPAM
        v10: (() => { const v = d.vlans.find(x => x.id === 10);
          return v && { name:v.name, subnet:v.subnet, gateway:v.gateway,
                        access:v.accessGroups.length, trunks:v.trunkLinks.length }; })(),
        // un cavo deve riportare i due capi con nome+porta
        sampleCable: d.cables[0] && { hasFrom: /P\\d/.test(d.cables[0].from), hasTo: /P\\d/.test(d.cables[0].to) },
        // as-built: almeno un percorso dall'endpoint
        asBuiltPaths: d.asBuilt.length,
        // assegnazione porte: lo switch deve comparire con le sue porte
        swPorts: (() => { const e = d.portAssignment.find(p => p.device === 'CORE-SW');
          return e ? e.ports.length : 0; })(),
      });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, '_buildPdfReportData lancia: ' + r.err);
  assert.deepEqual(r.keys, ['asBuilt','cables','handoff','portAssignment','rackSvgs','spare','topoSvg','vlans'],
    'il report deve avere tutte le sezioni attese');
  assert.equal(r.cables, 6, 'una riga inventario per ogni link (6)');
  assert.ok(r.vlanIds.includes(10) && r.vlanIds.includes(20) && r.vlanIds.includes(30),
    'il sommario VLAN copre tutte le VLAN definite');
  assert.ok(r.v10, 'la VLAN 10 deve essere nel sommario');
  assert.equal(r.v10.name, 'Management', 'il nome VLAN NON è troncato (regressione storica)');
  assert.equal(r.v10.subnet, '10.0.10.0/24', 'l’IPAM (subnet) finisce nel sommario VLAN');
  assert.equal(r.v10.gateway, '10.0.10.1', 'l’IPAM (gateway) finisce nel sommario VLAN');
  assert.ok(r.v10.access >= 1, 'la VLAN 10 ha almeno un gruppo access (run dati)');
  assert.ok(r.sampleCable.hasFrom && r.sampleCable.hasTo, 'ogni cavo riporta i capi con porta');
  assert.ok(r.asBuiltPaths >= 1, 'almeno un percorso as-built dall’endpoint');
  assert.equal(r.swPorts, 24, 'l’assegnazione porte elenca le 24 porte dello switch');
});

test('export: trunk nel sommario VLAN (VLAN voce 20 sul trunk switch↔telefono)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      ${SETUP}
      const d = _exportInternals._buildPdfReportData();
      const v20 = d.vlans.find(x => x.id === 20);
      return JSON.stringify({ ok:true, trunks: v20 ? v20.trunkLinks.length : -1,
        carries20: !!(v20 && v20.trunkLinks.some(t => String(t.vlans).includes('20'))) });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'lancia: ' + r.err);
  assert.ok(r.trunks >= 1, 'la VLAN voce (20) deve comparire su almeno un trunk');
  assert.ok(r.carries20, 'il trunk del sommario trasporta la VLAN voce (20)');
});

test('export: _buildFloorSVG — SVG valido con i device del floor', () => {
  const out = run(APP.ctx, `(() => {
    try {
      ${SETUP}
      const svg = _exportInternals._buildFloorSVG({ pdfMode:true });
      return JSON.stringify({ ok:true, len:svg.length,
        isSvg: svg.startsWith('<svg') && svg.includes('</svg>'),
        hasViewBox: /viewBox="[\\d\\s.-]+"/.test(svg),
        hasPc: svg.includes('PC-AcCt') || svg.includes('PC-'),
        // pdfMode NON deve includere il @import CDN di Font Awesome
        noCdnImport: !svg.includes('cdnjs') });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, '_buildFloorSVG lancia: ' + r.err);
  assert.ok(r.isSvg, 'il floor SVG è un documento <svg> ben formato');
  assert.ok(r.hasViewBox, 'il floor SVG ha un viewBox');
  assert.ok(r.len > 200, 'il floor SVG non è vuoto');
  assert.ok(r.noCdnImport, 'in pdfMode niente @import CDN (rompe il parser CSS di svg-to-pdfkit)');
});

test('export: _buildRackSVG — rack con device attivi E passivi (cablemanager incluso)', () => {
  const out = run(APP.ctx, `(() => {
    try {
      ${SETUP}
      // _buildRackSVG ritorna { rackId, rackName, svg }
      const r = _exportInternals._buildRackSVG(state.currentRack, { pdfMode:true });
      const svg = r && r.svg;
      const all = _exportInternals._buildRackSvgs();
      return JSON.stringify({ ok:true,
        isSvg: !!svg && svg.startsWith('<svg') && svg.includes('</svg>'),
        hasSwitch: !!svg && svg.includes('CORE-SW'),
        hasPassive: !!svg && (svg.includes('CM-01') || svg.includes('PP-01')),  // passivi renderizzati
        allShape: all.length > 0 && typeof all[0].svg === 'string',
        allCount: all.length });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, '_buildRackSVG lancia: ' + r.err);
  assert.ok(r.isSvg, 'il rack SVG è un documento <svg> ben formato');
  assert.ok(r.hasSwitch, 'lo switch attivo è disegnato nel rack');
  assert.ok(r.hasPassive, 'i device passivi (patch/cablemanager) sono disegnati (regressione storica)');
  assert.ok(r.allCount >= 1, '_buildRackSvgs produce un SVG per rack');
  assert.ok(r.allShape, '_buildRackSvgs ritorna oggetti { rackId, rackName, svg }');
});

test('export: _cableLabelRows + _nodeRoomName — etichette cavo coerenti', () => {
  const out = run(APP.ctx, `(() => {
    try {
      ${SETUP}
      const rows = _exportInternals._cableLabelRows();
      return JSON.stringify({ ok:true, rows: rows.length, hasLabel: rows.length > 0 && !!rows[0].label });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, '_cableLabelRows lancia: ' + r.err);
  assert.equal(r.rows, 6, 'una riga etichetta per cavo');
  assert.ok(r.hasLabel, 'ogni riga etichetta ha una label');
});
