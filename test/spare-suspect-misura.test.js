'use strict';
// ============================================================
//  «DATE LIBERE, MA ATTIVE» = LA MISURA DICE SU, NON `status`
// ============================================================
// Una porta senza cavo documentato che l'SNMP vede attiva è «sospetta» (lib/spare-ports.js):
// il documento dice libera, la rete dice in uso. Il controllo guardava `pi.status ===
// 'active'`, ma `status` non è una misura: lo scrivono anche il disegno di un cavo,
// l'editor di cablaggio, il segmento condiviso e l'import DCIM, e solo l'editor lo
// cancella quando il cavo sparisce. Verificato il 16/10 sul lab: SW-CORE aveva tre porte
// «libere ma attive» fatte del solo `{status:'active'}`, mai lette da nessuno (lo switch
// ha 8 interfacce su 24 porte dichiarate), e la riga si dichiarava «misurata».
//
// La misura che scade è `operUp` (lib/port-state.js la dimentica quando l'apparato tace):
// la regola sta in UNA funzione della lib, e i due costruttori del report (overlay e
// Dashboard) la chiamano invece di avere ognuno la propria copia.
//
// ⚠️ NON copre l'ETÀ della lettura: un poll riuscito 100 giorni fa e mai ripetuto conta
// ancora (`snmpStatus` resta `ok`). È una soglia da scegliere, non un difetto di questa
// regola — e questo cancello non lo dichiara risolto.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { portActiveFromRead, buildSpareReport } = require('../lib/spare-ports.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

// ── la regola, da sola ───────────────────────────────────────────────────────

test('portActiveFromRead: attiva solo se l\'apparato HA risposto e la porta è stata MISURATA su', () => {
  assert.equal(portActiveFromRead(true, { operUp: true, status: 'active' }), true);
  assert.equal(portActiveFromRead(true, { operUp: true }), true, 'lo stato non serve: la misura basta');
});

test('portActiveFromRead: `status` da solo non è una misura', () => {
  // È il difetto: un cavo disegnato e poi cancellato lascia `status:'active'` per sempre.
  assert.equal(portActiveFromRead(true, { status: 'active' }), false);
  assert.equal(portActiveFromRead(true, { status: 'active', ifName: 'Gi0/9' }), false, 'mappata ma non letta');
});

test('portActiveFromRead: misurata giù, spenta a mano o senza record → no', () => {
  assert.equal(portActiveFromRead(true, { operUp: false, status: 'inactive' }), false);
  assert.equal(portActiveFromRead(true, { operUp: false, adminDown: true }), false);
  assert.equal(portActiveFromRead(true, {}), false);
  assert.equal(portActiveFromRead(true, null), false);
  assert.equal(portActiveFromRead(true, undefined), false);
});

test('portActiveFromRead: un apparato che non ha risposto non dice niente, nemmeno con un operUp vecchio', () => {
  assert.equal(portActiveFromRead(false, { operUp: true, status: 'active' }), false);
  assert.equal(portActiveFromRead(undefined, { operUp: true }), false);
});

test('portActiveFromRead: «su» è il booleano vero, non una stringa o un numero', () => {
  // La misura è `true`/`false` (app-snmp `_snmpOperToUi`). Un valore truthy qualunque
  // — "true", 1 — arriverebbe da un progetto scritto a mano, non da una lettura.
  assert.equal(portActiveFromRead(true, { operUp: 'true' }), false);
  assert.equal(portActiveFromRead(true, { operUp: 1 }), false);
});

test('il report conta come sospetta solo la porta che la funzione dice attiva', () => {
  const dev = (ports) => ({ id: 'sw', type: 'switch', name: 'SW', ports });
  const mk = (pid, pi) => ({ pid, kind: 'access', cabled: false, activeSnmp: portActiveFromRead(true, pi) });
  const r = buildSpareReport([dev([mk('sw-1', { operUp: true }), mk('sw-2', { status: 'active' }), mk('sw-3', { operUp: false })])]);
  assert.equal(r.totals.suspect, 1);
  assert.deepEqual(r.suspectPids, ['sw-1']);
});

// ── la Dashboard vera, un caso alla volta ────────────────────────────────────

let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

/** Quante «Porte da verificare» dice la riga della Dashboard con UN solo apparato nello stato. */
function sospette(nodo, porta) {
  const r = JSON.parse(run(APP.ctx, `(() => { try {
    state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
    state.ports = state.ports || {};
    state.lastSnmpSyncAt = Date.now();
    state.nodes.push(Object.assign({ id:'zq1', type:'switch', name:'SW-Z', ports:4, x:10, y:10 }, ${JSON.stringify(nodo)}));
    ${porta ? `state.ports['zq1-1'] = ${JSON.stringify(porta)};` : ''}
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const rep = buildOverviewReport(); let row = null;
    const walk = (o) => { if(!o || typeof o!=='object' || row) return; if(Array.isArray(o)){ o.forEach(walk); return; } if(o.label==='Porte da verificare') row = o; Object.values(o).forEach(walk); };
    walk(rep);
    return JSON.stringify({ ok:true, v: row && row.value });
  } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.message||e) }); } })()`));
  assert.ok(r.ok, r.err);
  return Number(r.v);
}
/** Lo stesso stato senza porte sospette: il fondo da sottrarre (lo stato di default non è vuoto). */
let FONDO;
test('Dashboard: il riferimento senza porte sospette', () => { FONDO = sospette({ snmpStatus: 'err' }, null); assert.ok(Number.isFinite(FONDO)); });

test('Dashboard: una porta libera MISURATA su è sospetta (il vero positivo resta)', () => {
  assert.equal(sospette({ snmpStatus: 'ok' }, { status: 'active', operUp: true, ifName: 'Gi0/1' }) - FONDO, 1);
});

test('Dashboard: una porta libera con il solo `status:active` NON è sospetta (mai letta)', () => {
  assert.equal(sospette({ snmpStatus: 'ok' }, { status: 'active' }) - FONDO, 0, 'il caso di SW-CORE nel lab');
});

test('Dashboard: mappata a un\'interfaccia ma con stato non letto (oper sconosciuto) NON è sospetta', () => {
  // `_snmpOperToUiStatus` con oper=4 conserva il valore precedente: l'«active» può venire da prima.
  assert.equal(sospette({ snmpStatus: 'ok' }, { status: 'active', ifName: 'Virtual Interface' }) - FONDO, 0);
});

test('Dashboard: misurata giù, o senza record, o con l\'apparato muto → non sospetta', () => {
  assert.equal(sospette({ snmpStatus: 'ok' }, { status: 'inactive', operUp: false, ifName: 'Gi0/1' }) - FONDO, 0);
  assert.equal(sospette({ snmpStatus: 'ok' }, null) - FONDO, 0);
  assert.equal(sospette({ snmpStatus: 'err' }, { status: 'active', operUp: true, ifName: 'Gi0/1' }) - FONDO, 0);
});

// ── niente seconda copia ─────────────────────────────────────────────────────

test('ogni costruttore del report passa dalla funzione: nessuno rilegge `status` per conto suo', () => {
  // Erano DUE copie identiche (overlay in app-spare.js, Dashboard in app-overview.js) e
  // quando una cambia, l'altra no. L'elenco dei siti si DERIVA dal codice: se domani ne
  // nasce un terzo che scrive `activeSnmp`, deve usare la stessa funzione.
  const dir = path.join(ROOT, 'src');
  const siti = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
    const righe = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    righe.forEach((riga, i) => {
      const m = riga.match(/\bactiveSnmp\s*[:=]\s*([^\n]*)/);
      if (m && !/^\s*\/\//.test(riga)) siti.push({ f, riga: i + 1, expr: m[1] });
    });
  }
  assert.ok(siti.length >= 2, 'letti i costruttori veri dal codice: ' + siti.map(s => s.f).join(','));
  const abusivi = siti.filter(s => !/\bportActiveFromRead\s*\(/.test(s.expr));
  assert.deepEqual(abusivi.map(s => `${s.f}:${s.riga}`), [],
    'questi siti calcolano `activeSnmp` senza portActiveFromRead (lib/spare-ports.js): ' + abusivi.map(s => `${s.f}:${s.riga} → ${s.expr.trim()}`).join(' | '));
});
