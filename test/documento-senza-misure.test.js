'use strict';
// ============================================================================
// Un documento fatto SOLO a mano non deve affermare ciò che nessuno ha detto
// ============================================================================
// InfraNet è anche un editor: si può disegnare una rete intera senza interrogare
// nulla, e il documento che ne esce deve restare distinguibile da uno misurato.
// La verifica del 23/08 ha costruito una LAN completa a mano — nove apparati,
// otto cavi, passanti e wireless — e il modello ha retto: ogni cavo ha ricevuto
// un verdetto che risale a una dichiarazione, nessuno è caduto sul pavimento per
// mancanza di dati.
//
// Ma sono usciti due punti in cui il documento parlava al posto dell'utente, ed
// è la stessa famiglia di sempre: **un valore di ripiego è un'affermazione**.
//   ① la tabella porte scriveva `1` nel campo VLAN dove il pannello lasciava
//      vuoto — due strati, una domanda, risposte diverse;
//   ② il report L3 elencava come «VLAN dichiarata» le cinque VLAN che un
//      progetto NUOVO si trova nella palette senza che nessuno le abbia scritte.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');
const { buildL3Report } = require('../lib/l3-gateway.js');

const ROOT = path.join(__dirname, '..');

function scena(extra) {
  const APP = loadApp(ROOT);
  return run(APP.ctx, `(() => {
    state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
    _propsExplicit = true;
    state.nodes.length = 0; state.links.length = 0; state.ports = {};
    const sw={id:'sw',type:'switch',name:'SW',rackId:state.currentRack,rackU:1,sizeU:1,ports:8};
    const srv={id:'srv',type:'server',name:'SRV',rackId:state.currentRack,rackU:2,sizeU:1,ports:2};
    state.nodes.push(sw,srv); if(typeof _invalidateIdx==='function') _invalidateIdx();
    const l=_createLinkRecord('sw-3','srv-1'); l.id='cavo'; state.links.push(l);
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    propagateVlans();
    ${extra}
  })()`);
}

// ---- ① Il campo VLAN: pannello e tabella devono dire la stessa cosa ---------

test('VLAN mai dichiarata: né il pannello né la tabella porte scrivono un numero', () => {
  const r = JSON.parse(scena(`
    selType='port'; selId='srv-1'; renderProps();
    const pan = document.getElementById('props-panel').innerHTML;
    const campo = (pan.match(/<input[^>]*data-pfield="vlanOvr"[^>]*>/)||[''])[0];
    const cella = (renderPortsTable(srv).match(/<input type="number"[^>]*>/)||[''])[0];
    const val = s => (s.match(/value="([^"]*)"/)||[null,null])[1];
    const ph  = s => (s.match(/placeholder="([^"]*)"/)||[null,null])[1];
    return JSON.stringify({ pv: val(campo), pp: ph(campo), cv: val(cella), cp: ph(cella) });`));
  assert.equal(r.pv, '', 'il pannello lascia il campo vuoto');
  assert.equal(r.cv, '', 'e la tabella porte anche — era qui il difetto');
  // ⭐ La nativa di sito resta VISIBILE, ma come proposta: nel segnaposto, dove
  // non è un valore che qualcuno ha scritto.
  assert.equal(r.pp, '1');
  assert.equal(r.cp, '1', 'il numero si propone, non si afferma');
});

test('VLAN dichiarata a mano: allora il numero c’è, in tutt’e due', () => {
  const r = JSON.parse(scena(`
    setPortField('srv-1','vlanOvr',20);
    selType='port'; selId='srv-1'; renderProps();
    const pan = document.getElementById('props-panel').innerHTML;
    const campo = (pan.match(/<input[^>]*data-pfield="vlanOvr"[^>]*>/)||[''])[0];
    const cella = (renderPortsTable(srv).match(/<input type="number"[^>]*>/)||[''])[0];
    const val = s => (s.match(/value="([^"]*)"/)||[null,null])[1];
    return JSON.stringify({ pv: val(campo), cv: val(cella), ovr: /class="ovr"/.test(cella) });`));
  assert.equal(r.pv, '20');
  assert.equal(r.cv, '20');
  assert.equal(r.ovr, true, 'e il bordo ambra dice che l’hai scritto tu');
});

test('VLAN PROPAGATA da monte: è determinata, quindi si mostra', () => {
  // Propagata non è dichiarata, ma non è nemmeno un ripiego: qualcuno l'ha detta
  // a monte e il modello l'ha portata fin qui. Il campo la mostra.
  const r = JSON.parse(scena(`
    setPortField('sw-3','vlanOvr',30); propagateVlans();
    const cella = (renderPortsTable(srv).match(/<input type="number"[^>]*>/)||[''])[0];
    return JSON.stringify({ prop: state.ports['srv-1'].vlanProp,
      cv: (cella.match(/value="([^"]*)"/)||[null,null])[1] });`));
  assert.equal(r.prop, 30);
  assert.equal(r.cv, '30');
});

// ---- ② Il report L3 non chiama «dichiarata» una VLAN della palette ----------

const modello = (extra) => Object.assign({
  prefixes: [{ cidr: '192.168.1.0/24', vlan: 1, name: 'Gestione', gateway: '192.168.1.1' }],
  // la palette che un progetto NUOVO si trova addosso, senza che nessuno l'abbia scritta
  vlans: [1, 10, 20, 30, 40, 99].map(vid => ({ vid, name: '', color: '#00d4ff' })),
  ipamByVid: {}, nodes: [{ id: 'fw', name: 'FW', ip: '192.168.1.1', type: 'firewall' }],
  vlanNames: {}, vlansInUse: {}, siteNativeVlan: 1,
}, extra || {});

test('una VLAN che ha SOLO un colore non si guadagna una riga', () => {
  const rep = buildL3Report(modello());
  const vidi = rep.rows.map(r => r.vid);
  assert.deepEqual(vidi.filter(v => [10, 30, 40, 99].includes(v)), [],
    'la palette non è un piano: nessuno le ha dichiarate');
  assert.ok(vidi.includes(1), 'la VLAN con una rete resta');
});

test('una VLAN con un NOME resta, anche senza rete', () => {
  // È il caso per cui la riga esiste: «VLAN dichiarata, nessuna rete — non c'è
  // niente da instradare». Dare un nome è un atto.
  const m = modello();
  m.vlans = m.vlans.map(v => v.vid === 20 ? { ...v, name: 'Uffici' } : v);
  const rep = buildL3Report(m);
  const r20 = rep.rows.find(r => r.vid === 20);
  assert.ok(r20, 'la VLAN nominata resta in elenco');
  assert.equal(r20.cidr, '', 'senza rete');
  assert.equal(r20.name, 'Uffici');
});

test('una VLAN di cui hai scelto CHI la instrada resta, anche senza nome', () => {
  // Scegliere l'apparato in «Instradata da» è un atto quanto darle un nome.
  const rep = buildL3Report(modello({ ipamByVid: { '40': { gatewayNodeId: 'fw' } } }));
  const r40 = rep.rows.find(r => r.vid === 40);
  assert.ok(r40, 'il binding esplicito la rende dichiarata');
  assert.equal(r40.status, 'bound');
});

test('⚠️ la palette resta INTERA: un prefisso che cita una VLAN tiene il suo colore', () => {
  // Si stringe chi si guadagna una RIGA, non chi entra nella tavolozza: togliere
  // la VLAN dalla palette lascerebbe senza colore la rete che la cita.
  const m = modello();
  m.prefixes = m.prefixes.concat([{ cidr: '10.10.40.0/24', vlan: 40, name: 'Ospiti', gateway: '10.10.40.1' }]);
  const rep = buildL3Report(m);
  const r40 = rep.rows.find(r => r.cidr === '10.10.40.0/24');
  assert.ok(r40, 'la rete c’è');
  assert.equal(r40.color, '#00d4ff', 'e ha il colore della palette');
});
