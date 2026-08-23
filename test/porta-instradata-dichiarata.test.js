'use strict';
// ============================================================================
// «Instrada» si poteva misurare e non si poteva DIRE
// ============================================================================
// Fino alla 2.10.1 il verdetto «questo cavo instrada» nasceva solo da due misure
// SNMP (`ownsIp` + il veto `bridges`, v. porta-instradata-bridge.test.js). Chi
// disegnava un progetto a mano — un preventivo, una rete non ancora costruita —
// non poteva ottenerlo in nessun modo: il cavo fra due router scendeva fino al
// pavimento e usciva colorato come VLAN 1, cioè AFFERMANDO che commuta.
//
// Un ripiego è un'affermazione, e la cura è togliere il CASO. Il caso qui era
// «instradato non è dichiarabile», e si toglie dando alla porta la terza
// modalità accanto ad access e trunk: `ports[pid].mode === 'routed'`.
//
// ⭐ Perché il terzo valore di un campo che esiste, e non un flag nuovo: due
// controlli indipendenti sulla stessa domanda («che tipo di porta è?») possono
// contraddirsi, e prima o poi lo fanno. Un campo che ne porta uno solo non può.
//
// Le tre proprietà che questi test inchiodano:
//   ① la DICHIARAZIONE batte le misure, veto `bridges` compreso — manual-first
//      non si sospende quando fa comodo, e la contraddizione si SEGNALA;
//   ② batte anche la VLAN dichiarata sull'ALTRO capo, perché le due frasi non
//      parlano della stessa cosa: `vlanOvr` descrive il PVID di una porta,
//      «instrada» descrive il cavo;
//   ③ NON si applica ai trunk: un trunk per definizione commuta, e dove la
//      domanda non ha senso non si offre la risposta.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { isRoutedPort } = require('../lib/vlan-authority.js');
const { linkPaintVlan, PAINT_SOURCES } = require('../lib/link-vlan-color.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const paint = (i) => linkPaintVlan(i);
const ROOT = path.join(__dirname, '..');

/** Uno switch, un firewall e il cavo fra i due — lo scenario minimo che serve a tutti. */
function scena(extra) {
  const APP = loadApp(ROOT);
  return run(APP.ctx, `(() => {
    state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
    _propsExplicit = true; selType=null; selId=null;
    const sw={id:'sw',type:'switch',name:'SW',rackId:state.currentRack,rackU:1,sizeU:1,ports:8};
    const fw={id:'fw',type:'firewall',name:'FW',rackId:state.currentRack,rackU:2,sizeU:1,ports:4};
    state.nodes.push(sw,fw); if(typeof _invalidateIdx==='function') _invalidateIdx();
    const l=_createLinkRecord('fw-1','sw-3'); l.id='cavo'; state.links.push(l);
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    if(typeof propagateVlans==='function') propagateVlans();
    ${extra}
  })()`);
}

// ---- ① Il predicato: la parola dell'utente viene prima ----------------------

test('dichiarata L3: instrada anche senza nessuna misura addosso', () => {
  // Il caso del progetto disegnato a mano: nessun poll è mai passato di qui.
  assert.equal(isRoutedPort({ declaredRouted: true }), true);
  assert.equal(isRoutedPort({ declaredRouted: true, ownsIp: false }), true);
});

test('dichiarata L3: batte il VETO di bridges, che è una MISURA', () => {
  // L'apparato dice «è una porta del bridge», l'utente dice «instrada». In questa
  // app vince l'utente: la misura non si cancella e non si nasconde, ma non
  // riscrive la dichiarazione — il pannello mostra l'avviso (port.routedBridgeWarn).
  assert.equal(isRoutedPort({ declaredRouted: true, bridges: true }), true);
  assert.equal(isRoutedPort({ declaredRouted: true, bridges: true, ownsIp: true }), true);
});

test('senza dichiarazione il predicato è quello di prima, riga per riga', () => {
  // Guardia anti-regressione: la modalità nuova non deve spostare i tre esiti
  // già misurati sul banco.
  assert.equal(isRoutedPort({ ownsIp: true, bridges: undefined }), true);
  assert.equal(isRoutedPort({ ownsIp: true, bridges: true }), false);
  assert.equal(isRoutedPort({ ownsIp: false }), false);
  // E `declaredRouted` è un BOOLEANO dichiarato, non un valore truthy qualsiasi:
  // solo `true` conta, così un residuo nello stato non accende una modalità.
  assert.equal(isRoutedPort({ declaredRouted: 'routed' }), false);
  assert.equal(isRoutedPort({ declaredRouted: 1 }), false);
});

// ---- ② Il cavo: dove sta la dichiarazione nella scala -----------------------

test('il cavo esce instradato, e la fonte lo dice: ovr-routed', () => {
  const p = paint({ mode: 'access', vlans: [], src: { active: true, declaredRouted: true }, dst: { active: true } });
  assert.equal(p.kind, 'routed');
  assert.equal(p.vlan, null);
  assert.equal(p.known, false);
  assert.equal(p.source, 'ovr-routed', 'la fonte distingue il DICHIARATO dal misurato');
  assert.ok(PAINT_SOURCES.includes('ovr-routed'), 'la fonte è dichiarata nell’elenco');
});

test('basta UN capo: l’altro non deve saperne niente', () => {
  const a = paint({ mode: 'access', vlans: [], src: { declaredRouted: true }, dst: {} });
  const b = paint({ mode: 'access', vlans: [], src: {}, dst: { declaredRouted: true } });
  assert.equal(a.kind, 'routed');
  assert.equal(b.kind, 'routed');
});

test('batte la VLAN MISURATA sull’altro capo', () => {
  const p = paint({ mode: 'access', vlans: [],
    src: { active: true, declaredRouted: true }, dst: { active: true, vlan: 30, deviceVlans: [1, 30] } });
  assert.equal(p.kind, 'routed', 'una misura non riapre una dichiarazione');
});

test('batte la VLAN DICHIARATA sull’altro capo: le due frasi non parlano della stessa cosa', () => {
  // `vlanOvr` dice «il PVID di QUESTA PORTA è 20»; «instrada» dice «questo CAVO
  // non porta nessuna VLAN». Su un cavo solo, la frase che parla del cavo decide
  // il cavo. Sulla STESSA porta non possono coesistere: setPortMode('routed')
  // cancella vlanOvr (v. src/app-vlan-autopoll.js).
  const p = paint({ mode: 'access', vlans: [],
    src: { active: true, vlanOvr: 20 }, dst: { active: true, declaredRouted: true } });
  assert.equal(p.kind, 'routed');
  assert.equal(p.source, 'ovr-routed');
});

// ---- ③ Il ramo trunk resta intatto ------------------------------------------

test('su un TRUNK la dichiarazione non si guarda: lì il campo VLAN è la nativa', () => {
  const p = paint({ mode: 'trunk', vlans: [10, 20], native: 1,
    src: { active: true, declaredRouted: true }, dst: { active: true } });
  assert.equal(p.kind, 'trunk', 'un trunk commuta per definizione');
  assert.notEqual(p.source, 'ovr-routed');
});

// ---- ④ Nessuna dichiarazione: il pavimento è ancora lì -----------------------

test('senza dichiarazione e senza misure il cavo cade sul pavimento, come prima', () => {
  const p = paint({ mode: 'access', vlans: [], src: { active: true }, dst: { active: true } });
  assert.equal(p.kind, 'vlan');
  assert.equal(p.vlan, 1);
  assert.equal(p.source, 'site-native');
});

test('declaredRouted assente non è declaredRouted falso: nessuna delle due accende niente', () => {
  const senza = paint({ mode: 'access', vlans: [], src: { active: true, vlan: 30, deviceVlans: [1, 30] }, dst: { active: true } });
  const falso = paint({ mode: 'access', vlans: [], src: { active: true, vlan: 30, deviceVlans: [1, 30], declaredRouted: false }, dst: { active: true } });
  assert.equal(senza.kind, 'vlan');
  assert.equal(senza.vlan, 30);
  assert.deepEqual(falso, senza, 'dichiarare «no» equivale a non dichiarare');
});

// ---- ⑤ La resa: quello che si vede sullo schermo ---------------------------
// Il motore è coperto sopra; questi test guardano le TRE superfici che leggono la
// modalità, perché è lì che i difetti di questa famiglia si sono sempre visti.

test('il setter cancella le dichiarazioni incompatibili, e solo quelle', () => {
  const r = scena(`
    setPortField('fw-1','vlanOvr',55);
    state.ports['fw-1'].trunkVlans='10,20';
    state.ports['fw-1'].desc='verso il transito';
    state.ports['fw-1'].ip='10.255.0.1';
    setPortMode('fw-1','routed');
    return JSON.stringify(state.ports['fw-1']);`);
  const pi = JSON.parse(r);
  assert.equal(pi.mode, 'routed');
  assert.equal('vlanOvr' in pi, false, 'una porta L3 non ha un PVID');
  assert.equal('trunkVlans' in pi, false, 'né una lista di VLAN trasportate');
  // ⚠️ E NON tocca quello che con la modalità non c'entra: la descrizione e
  // l'indirizzo dell'interfaccia restano dove l'utente li ha scritti.
  assert.equal(pi.desc, 'verso il transito');
  assert.equal(pi.ip, '10.255.0.1');
});

test('uscire da L3 torna indietro davvero: niente residui', () => {
  // ⚠️ La rete si scrive nello stato invece che con `setPortRoutedNet`, che è un
  // export ESM e non un globale del ponte (e non lo diventa: il progetto sta
  // ritirando `window.*`, non allargandolo). Il percorso vero del setter — evento
  // `change` delegato → `port-routed-net` — è verificato nel browser; qui conta
  // l'invariante che quel percorso non può garantire da solo: uscendo dalla
  // modalità, il campo che la modalità giustificava se ne va con lei.
  const r = scena(`
    setPortMode('fw-1','routed');
    state.ports['fw-1'].routedNet='10.255.0.0/30';
    setPortMode('fw-1','access');
    return JSON.stringify(state.ports['fw-1']);`);
  const pi = JSON.parse(r);
  assert.equal(pi.mode, undefined, 'senza trunk misurato si torna a NON dichiarato');
  assert.equal('routedNet' in pi, false, 'la rete se ne va con la modalità che la giustificava');
});

test('il pannello porta: tre modalità, L3 accesa, e nessun campo VLAN da riempire', () => {
  const r = scena(`
    setPortMode('fw-1','routed');
    selType='port'; selId='fw-1'; renderProps();
    return document.getElementById('props-panel').innerHTML;`);
  const modi = [...r.matchAll(/data-act="port-mode"[^>]*data-mode="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(modi, ['access', 'trunk', 'routed'], 'le tre modalità, in quest’ordine');
  assert.ok(!/data-pfield="vlanOvr"/.test(r), 'il campo VLAN non si offre a una porta che non ne ha una');
  assert.ok(/data-change="port-routed-net"/.test(r), 'al suo posto c’è la scelta della rete');
});

test('⚠️ la scelta della rete NON accetta un valore digitato a mano', () => {
  // L'harness `_enableManualValueInProps` aggiunge «Personalizzato…» a ogni select
  // del pannello: qui sarebbe un difetto, non una comodità. Questo campo è un
  // RIFERIMENTO a una rete dichiarata — un CIDR digitato qui punterebbe a niente,
  // e sarebbe un secondo posto in cui una rete vive. Trovato guardando lo schermo.
  const r = scena(`
    setPortMode('fw-1','routed');
    selType='port'; selId='fw-1'; renderProps();
    return document.getElementById('props-panel').innerHTML;`);
  const sel = (r.match(/<select[^>]*data-change="port-routed-net"[^>]*>/) || [''])[0];
  assert.ok(sel, 'la select c’è');
  assert.ok(/data-no-manual="1"/.test(sel), 'e rifiuta l’harness del valore libero');
});

test('⚠️ la scelta elenca TUTTE le reti dichiarate, non solo quelle senza VLAN', () => {
  // Il primo taglio offriva le sole VLAN-less e sul banco il campo è uscito VUOTO:
  // il progetto vero dichiara cinque reti e hanno tutte la loro VLAN. Ed era
  // incoerente col percorso misurato, che instradata la dichiara anche quando
  // l'indirizzo cade in una rete con VLAN. Le senza-VLAN restano in CIMA (caso
  // tipico), le altre portano scritta la loro VLAN: si sceglie vedendo.
  const r = scena(`
    state.ipam = state.ipam || {}; state.ipam.prefixes = [
      { cidr:'192.168.20.0/24', vlan:20, name:'Uffici' },
      { cidr:'10.255.0.0/30', vlan:null, name:'Transito' }
    ];
    setPortMode('fw-1','routed');
    selType='port'; selId='fw-1'; renderProps();
    return document.getElementById('props-panel').innerHTML;`);
  const blocco = (r.match(/<select[^>]*port-routed-net[\s\S]*?<\/select>/) || [''])[0];
  const opz = [...blocco.matchAll(/<option[^>]*>([^<]*)</g)].map(m => m[1]);
  assert.deepEqual(opz, [
    '— nessuna rete —',
    '10.255.0.0/30 · Transito',
    '192.168.20.0/24 · Uffici · VLAN 20',
  ], 'senza-VLAN per prima, e la VLAN dell’altra scritta invece che nascosta');
});

test('⚠️ il caso che ha fatto sembrare rotta la modalità: reti tutte con VLAN', () => {
  // Le 5 reti VERE del gemello del banco. Prima di questa correzione il selettore
  // offriva solo «— nessuna rete —» e la riga sotto diceva di andare ad aggiungerne
  // una in «Reti» — cioè accusava l'utente di non aver dichiarato quello che AVEVA
  // dichiarato. Un campo vuoto che sembra un guasto è peggio di un campo assente.
  const r = scena(`
    state.ipam = state.ipam || {}; state.ipam.prefixes = [
      { cidr:'192.168.1.0/24', vlan:1 }, { cidr:'10.10.10.0/24', vlan:10 },
      { cidr:'10.10.20.0/24', vlan:20 }, { cidr:'10.10.30.0/24', vlan:30 },
      { cidr:'10.10.99.0/24', vlan:99 }
    ];
    setPortMode('fw-1','routed');
    selType='port'; selId='fw-1'; renderProps();
    return document.getElementById('props-panel').innerHTML;`);
  const blocco = (r.match(/<select[^>]*port-routed-net[\s\S]*?<\/select>/) || [''])[0];
  const opz = [...blocco.matchAll(/<option[^>]*>([^<]*)</g)].map(m => m[1]);
  assert.equal(opz.length, 6, 'le 5 reti dichiarate più «nessuna»');
  assert.ok(opz.includes('10.10.99.0/24 · VLAN 99'));
});

test('la riga compatta legge «L3» al posto del numero — e solo su quella porta', () => {
  const r = scena(`
    setPortMode('fw-1','routed');
    return renderPortsTable(state.nodes.find(n=>n.id==='fw'));`);
  assert.ok(/<span class="pt-l3"[^>]*>L3<\/span>/.test(r), 'la porta dichiarata mostra la sigla');
  const inputVlan = (r.match(/data-ovr-field="vlanOvr"/g) || []).length;
  assert.equal(inputVlan, 3, 'le altre 3 porte del firewall tengono il loro campo numerico');
});

test('il cavo esce instradato passando dal SETTER, non dallo stato scritto a mano', () => {
  const r = scena(`
    setPortMode('fw-1','routed');
    if(typeof _invalidateLinkColor==='function') _invalidateLinkColor();
    const p=_linkPaintVlan(state.links.find(l=>l.id==='cavo'));
    return JSON.stringify({kind:p.kind, source:p.source, colore:_linkColor(state.links.find(l=>l.id==='cavo'))});`);
  const o = JSON.parse(r);
  assert.equal(o.kind, 'routed');
  assert.equal(o.source, 'ovr-routed');
  assert.equal(o.colore, '#6b7d99', 'il neutro dei cavi, preso da CABLE_NEUTRAL');
});
