'use strict';
// ============================================================
//  UN VALORE SCRITTO A MANO NON SI RIDISCUTE A OGNI SCANSIONE
// ============================================================
// La Verifica confronta modello/matricola/firmware DICHIARATI con quelli letti
// dall'ENTITY-MIB e, se divergono, dice «apparato sostituito». Giusto finché il
// dichiarato è un dato dimenticato; sbagliato quando una persona lo ha corretto
// apposta (il modello commerciale invece della sigla dell'MIB, il firmware che ha
// scritto lei): la scansione successiva lo accusava di nuovo, e quella dopo
// ancora. Richiesta dell'utente il 16/10: «nel momento in cui uno modifica a mano
// interviene il lucchetto».
//
// La regola: scrivere a mano questi tre campi CHIUDE il loro lucchetto
// (`modelManual`, `serialNumberManual`, `firmwareVerManual`), svuotarli lo riapre,
// e chi accusa — la Verifica, la lente DR della Panoramica, il dossier — non
// confronta un campo bloccato. Il lucchetto dice CHI DECIDE; il punto
// «Dichiarato/Misurato» dice DA DOVE VIENE il valore: sono due assi.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ID = require('../lib/identity-reconcile.js');
const FP = require('../lib/field-provenance.js');
const { classifyField } = require('../lib/project-schema.js');
const { buildDocSnapshot, buildSnmpSnapshot } = require('../lib/drift-snapshot.js');
const { buildDriftReport } = require('../lib/drift-report.js');
const { buildOverview } = require('../lib/overview.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const CAMPI = ['model', 'serialNumber', 'firmwareVer'];
const LETTA = { brand: 'ZyXEL, Inc.', model: 'GS1900-24', serialNumber: 'S202L27002866', firmwareVer: '2.10.68857', source: 'ENTITY-MIB' };

// ── puro: il lucchetto e chi lo rispetta ─────────────────────────────────────

test('i tre campi hanno il loro lucchetto, e uno solo lo sa dire', () => {
  assert.deepEqual(ID.IDENTITY_LOCKS, { model: 'modelManual', serialNumber: 'serialNumberManual', firmwareVer: 'firmwareVerManual' });
  assert.equal(ID.isIdentityLocked({ modelManual: true }, 'model'), true);
  assert.equal(ID.isIdentityLocked({ modelManual: true }, 'serialNumber'), false, 'il lucchetto è per campo');
  assert.equal(ID.isIdentityLocked({ modelManual: false }, 'model'), false);
  assert.equal(ID.isIdentityLocked({}, 'model'), false);
  assert.equal(ID.isIdentityLocked(null, 'model'), false);
  assert.equal(ID.isIdentityLocked({ brandManual: true }, 'brand'), false, 'la marca ha il suo lucchetto, che non passa di qui');
});

test('registro e schema: il lucchetto è dichiarato e classificato come documento', () => {
  for (const f of CAMPI) {
    assert.equal(FP.FIELD_PROVENANCE.node[f].lock, ID.IDENTITY_LOCKS[f], `${f}: il registro non nomina il lucchetto`);
    assert.equal(classifyField('node', ID.IDENTITY_LOCKS[f]), 'document', `${ID.IDENTITY_LOCKS[f]}: lo scrive una persona, esce nell'export`);
  }
});

test('fillIdentityFromRead: un campo bloccato non lo riempie la lettura, uno libero sì', () => {
  const n = { id: 'sw', type: 'switch', modelManual: true };
  const scritti = ID.fillIdentityFromRead(n, LETTA, '');
  assert.ok(!scritti.includes('model'));
  assert.equal(n.model, undefined, 'bloccato: la lettura non scrive');
  assert.equal(n.serialNumber, 'S202L27002866', 'gli altri campi si riempiono come sempre');
  assert.ok(!(n.copiedFromRead || {}).model);
});

test('adoptIdentityFromRead: «Adotta» non scavalca un campo bloccato', () => {
  const n = { id: 'sw', model: 'MIO', modelManual: true, serialNumber: 'VECCHIO' };
  ID.adoptIdentityFromRead(n, { model: 'GS1900-24', serialNumber: 'NUOVO', firmwareVer: null });
  assert.equal(n.model, 'MIO', 'una riga vecchia nel pannello non riscrive ciò che hai bloccato dopo');
  assert.equal(n.serialNumber, 'NUOVO', 'il campo libero si adotta');
  assert.deepEqual(n.copiedFromRead, { serialNumber: true });
});

// ── la Verifica: lo snapshot porta il lucchetto, il report non confronta ─────

test('drift: un campo bloccato non produce nessuna riga, in nessuno dei tre campi', () => {
  const misurato = { serialNumber: 'XYZ999', model: 'GS1900-24', firmwareVer: '2.10' };
  const doc = { serialNumber: 'ABC123', model: 'Zyxel GS1900-24E', firmwareVer: '1.0' };
  const snmp = { responded: { sw1: true }, measuredIds: { sw1: misurato } };
  const riga = (locked) => ({ identities: [Object.assign({ nodeId: 'sw1', label: 'SW1' }, doc, locked ? { locked } : {})] });

  const libero = buildDriftReport(snmp, riga(null), [], {});
  assert.equal(libero.identityDrift.length, 1);
  assert.deepEqual(libero.identityDrift[0].diffs.map(d => d.field).sort(), ['firmwareVer', 'model', 'serialNumber'], 'controprova: senza lucchetti accusa tutti e tre');

  for (const f of CAMPI) {
    const r = buildDriftReport(snmp, riga({ [f]: true }), [], {});
    const campi = (r.identityDrift[0] ? r.identityDrift[0].diffs : []).map(d => d.field);
    assert.ok(!campi.includes(f), `${f} è bloccato e viene ancora confrontato`);
    assert.equal(campi.length, 2, `${f} bloccato: gli altri due restano confrontati`);
  }
  const tutti = buildDriftReport(snmp, riga({ model: true, serialNumber: true, firmwareVer: true }), [], {});
  assert.equal(tutti.identityDrift.length, 0);
  assert.equal(tutti.counts.identityDrift, 0);
  assert.equal(tutti.counts.identityFirmware, 0);
});

test('drift: dal nodo allo snapshot al report — il lucchetto viaggia e la realtà che cambia non lo apre da sola', () => {
  const lower = x => String(x == null ? '' : x).toLowerCase();
  const nodo = (extra) => Object.assign({ id: 'sw1', mac: 'AA:AA:AA:00:00:01', ip: '10.0.0.2', snmpStatus: 'ok',
    serialNumber: 'ABC123', model: 'Zyxel GS1900-24E', firmwareVer: '1.0',
    integration: { host: '10.0.0.2', inventory: { serialNumber: 'ABC123', model: 'GS1900-24', firmwareVer: '2.10' } } }, extra);
  const esito = (n) => {
    const nodes = [n];
    const doc = buildDocSnapshot({ nodes, links: [], ports: {}, normMac: lower, nodeLabel: x => x.id });
    const snmp = buildSnmpSnapshot({ nodes, docPorts: doc.ports, ports: {} });
    return buildDriftReport(snmp, doc, [], {});
  };
  assert.equal(esito(nodo({})).counts.identityDrift, 1, 'controprova: scritto a mano e non bloccato, il modello accusa');
  const bloccato = esito(nodo({ modelManual: true, firmwareVerManual: true }));
  assert.equal(bloccato.identityDrift.length, 0, 'bloccati modello e firmware: la scansione non li ridiscute');

  // Il lucchetto non è un salvacondotto: la matricola non è bloccata e il suo cambio resta una sostituzione vera.
  const sostituito = nodo({ modelManual: true, firmwareVerManual: true });
  sostituito.integration.inventory.serialNumber = 'NUOVO-999';
  const r = esito(sostituito);
  assert.equal(r.counts.identityDrift, 1);
  assert.deepEqual(r.identityDrift[0].diffs.map(d => d.field), ['serialNumber']);
});

test('docSnap: porta il lucchetto solo dei campi bloccati (lo snapshot non gonfia)', () => {
  const lower = x => String(x == null ? '' : x).toLowerCase();
  const d = buildDocSnapshot({ nodes: [
    { id: 'a', serialNumber: 'S', model: 'M', modelManual: true },
    { id: 'b', serialNumber: 'S', model: 'M' },
  ], links: [], ports: {}, normMac: lower, nodeLabel: n => n.id });
  assert.deepEqual(d.identities.find(x => x.nodeId === 'a').locked, { model: true });
  assert.ok(!('locked' in d.identities.find(x => x.nodeId === 'b')), 'nessun lucchetto, nessuna chiave');
});

// ── la Panoramica (lente DR) e il dossier ────────────────────────────────────

const DR_TYPES = { switch: { isActive: true, isRack: true } };
const drIdentita = (nodes) => buildOverview({ types: DR_TYPES, nodes, now: Date.parse('2026-07-29T00:00:00Z') })
  .recovery.rows.find(r => r.key === 'drIdentity');

test('Panoramica DR: una matricola bloccata non è «apparato sostituito»', () => {
  const at = '2026-07-20T00:00:00Z';
  const nodo = (extra) => Object.assign({ id: 'sw1', type: 'switch', rackId: 'r1', serialNumber: 'OLD999',
    integration: { inventory: { serialNumber: 'NEW111' } }, backup: { ref: 'x', at } }, extra);
  assert.equal(drIdentita([nodo({})]).extra.mismatch, 1, 'controprova: senza lucchetto accusa');
  const r = drIdentita([nodo({ serialNumberManual: true })]);
  assert.equal(r.extra.mismatch, 0, 'bloccata: la lente non accusa');
  assert.equal(r.value, 1, "l'apparato resta identificabile (la matricola dichiarata è nota)");
});

let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

const J = (code) => JSON.parse(run(APP.ctx, '(() => { try { ' + code + ' } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.message||e) }); } })()'));

test('dossier: «apparato sostituito» non si scrive per una matricola bloccata', () => {
  const r = J(`
    state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
    state.nodes.length = 0; state.links.length = 0; state.ports = {};
    state.nodes.push({ id:'sw', type:'switch', name:'CORE-SW', rackId:state.currentRack, rackU:1, sizeU:1, ports:24, serialNumber:'DICHIARATO-1',
      integration:{ inventory:{ serialNumber:'MISURATO-2' } } });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const di = () => _exportInternals._buildPdfReportData().recovery.devices.find(x => x.name === 'CORE-SW').identityMismatch;
    const libera = di();
    nodeById('sw').serialNumberManual = true;
    const bloccata = di();
    return JSON.stringify({ ok:true, libera, bloccata });`);
  assert.ok(r.ok, r.err);
  assert.equal(r.libera, true, 'controprova: senza lucchetto il dossier accusa');
  assert.equal(r.bloccata, false, 'bloccata: il dossier consegnato non accusa');
});

// ── scrivere a mano chiude il lucchetto ──────────────────────────────────────

test('updateN: scrivere a mano chiude il lucchetto del campo, svuotarlo lo riapre', () => {
  const r = J(`
    state = _buildDefaultState();
    state.nodes.push({ id:'swl', type:'switch', name:'Z', ports:2, ip:'10.0.0.8' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    selType='node'; selId='swl';
    const flag = () => { const n = nodeById('swl'); return { m:n.modelManual, s:n.serialNumberManual, f:n.firmwareVerManual }; };
    const prima = flag();
    updateN('model', 'Zyxel GS1900-24E');
    const dopoModello = flag();
    updateN('serialNumber', '  ');          // solo spazi: non e' un valore
    const dopoSpazi = flag();
    updateN('firmwareVer', '1.0');
    updateN('model', undefined);            // svuotato
    const dopoSvuota = flag();
    return JSON.stringify({ ok:true, prima, dopoModello, dopoSpazi, dopoSvuota });`);
  assert.ok(r.ok, r.err);
  assert.deepEqual(r.prima, {});
  assert.equal(r.dopoModello.m, true);
  assert.ok(!r.dopoModello.s && !r.dopoModello.f, 'scrivere il modello non blocca gli altri');
  assert.ok(!r.dopoSpazi.s, 'degli spazi non bloccano nulla');
  assert.equal(r.dopoSvuota.m, false, 'svuotato: torna a seguire la rete');
  assert.equal(r.dopoSvuota.f, true);
});

test('il lucchetto si commuta col clic, e il Sync non tocca un campo bloccato', () => {
  const r = J(`
    state = _buildDefaultState();
    state.nodes.push({ id:'sws', type:'switch', name:'Z', ports:2, ip:'10.0.0.9' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    selType='node'; selId='sws';
    updateN('model', 'Zyxel GS1900-24E');
    applyPollResult('sws', { ok:true, lags:[], vlans:[], interfaces:[], inventory:${JSON.stringify(LETTA)} }, { noHistory:true });
    const n = nodeById('sws');
    const dopoSync = { model:n.model, serial:n.serialNumber, bloccato:n.modelManual, copied:n.copiedFromRead };
    toggleNodeLock('model'); const sbloccato = nodeById('sws').modelManual;
    toggleNodeLock('model'); const richiuso = nodeById('sws').modelManual;
    return JSON.stringify({ ok:true, dopoSync, sbloccato, richiuso });`);
  assert.ok(r.ok, r.err);
  assert.equal(r.dopoSync.model, 'Zyxel GS1900-24E', 'manual-first: la lettura non riscrive');
  assert.equal(r.dopoSync.serial, 'S202L27002866', 'gli altri campi vuoti si riempiono');
  assert.equal(r.dopoSync.bloccato, true);
  assert.ok(!(r.dopoSync.copied || {}).model, 'il modello digitato non risulta copiato');
  assert.equal(r.sbloccato, false);
  assert.equal(r.richiuso, true);
});

// ── il pannello ──────────────────────────────────────────────────────────────

/** Il lucchetto che il pannello disegna accanto a un campo: { presente, premuto }. */
function lucchettoPannello(nodo, campo) {
  const r = J(`
    state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
    _propsExplicit = true;
    state.nodes.push(Object.assign({ id:'swp', type:'switch', name:'SW-P', ports:4, x:10, y:10 }, ${JSON.stringify(nodo)}));
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    selType='node'; selId='swp'; renderProps();
    return JSON.stringify({ ok:true, html: document.getElementById('props-panel').innerHTML || '' });`);
  assert.ok(r.ok, r.err);
  const m = r.html.match(new RegExp('<button[^>]*aria-pressed="(true|false)"[^>]*data-act="node-lock" data-field="' + campo + '"'));
  return m ? { presente: true, premuto: m[1] === 'true' } : { presente: false, premuto: false };
}

test('pannello: ogni campo ha il suo lucchetto, chiuso solo se lo è davvero', () => {
  // Ogni campo, una volta da solo: se un lucchetto leggesse il flag di un altro, o restasse sempre aperto, lo vedrebbe.
  for (const campo of CAMPI) {
    const nodo = { model: 'M', serialNumber: 'S1', firmwareVer: '1.0', [ID.IDENTITY_LOCKS[campo]]: true };
    for (const altro of CAMPI) {
      assert.deepEqual(lucchettoPannello(nodo, altro), { presente: true, premuto: altro === campo },
        `con bloccato solo «${campo}», il lucchetto di «${altro}» dovrebbe essere ${altro === campo ? 'chiuso' : 'aperto'}`);
    }
  }
});

// ── la regola contro il prossimo che accusa ──────────────────────────────────

test('chi confronta il dichiarato con il misurato consulta il lucchetto', () => {
  // Erano tre copie dello stesso confronto (Verifica, Panoramica, dossier): se domani ne nasce una quarta,
  // o se una delle tre smette di guardare il lucchetto, l'utente torna ad avere la stessa accusa a ogni scansione.
  const sorgenti = {
    'lib/drift-report.js': /locked/,
    'lib/drift-snapshot.js': /isIdentityLocked/,
    'lib/overview.js': /isIdentityLocked/,
    'export.js': /isIdentityLocked/,
  };
  for (const [file, rx] of Object.entries(sorgenti)) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(rx.test(src), `${file} confronta l'identità senza consultare il lucchetto`);
  }
  // E nessun altro file che confronta serialNumber dichiarato e misurato: l'elenco qui sopra è completo.
  const confronta = [];
  for (const dir of ['lib', 'src', 'drivers', '.']) {
    const base = path.join(ROOT, dir);
    for (const f of fs.readdirSync(base)) {
      if (!/\.js$/.test(f)) continue;
      const rel = dir === '.' ? f : dir + '/' + f;
      const src = fs.readFileSync(path.join(base, f), 'utf8');
      if (/inventory\.serialNumber|inv\.serialNumber/.test(src) && /(!==|!=)\s*_?meas|!==\s*mi\.|toLowerCase\(\) !==/.test(src)) confronta.push(rel);
    }
  }
  const attesi = ['lib/drift-report.js', 'lib/overview.js', 'export.js'];
  for (const f of confronta) assert.ok(attesi.includes(f) || Object.keys(sorgenti).includes(f), `${f} sembra confrontare la matricola dichiarata con la misurata: aggiungilo all'elenco sopra e fagli consultare il lucchetto`);
});
