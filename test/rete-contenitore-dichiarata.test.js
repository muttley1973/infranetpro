'use strict';
// ============================================================================
// «Questa rete è un contenitore» — e adesso puoi dirlo tu
// ============================================================================
// In un piano indirizzi vero un prefisso di sede contiene le proprie sottoreti:
// non ci si sovrappone, le CONTIENE. L'audit lo sapeva già, ma solo se a dirlo
// era il DCIM (`status: 'container'`, parola di NetBox). Un piano scritto a mano
// non aveva modo di dichiararlo, e ogni apertura del report ripeteva l'accusa.
//
// ⚠️ Il difetto non è il falso positivo in sé: è che era IMPOSSIBILE da chiudere.
// Un avviso vero-ma-voluto che torna per sempre insegna a chi legge a saltare
// tutti gli avvisi, compreso quello che un giorno conterà.
//
// La regola pura — chi è contenitore, e che cosa si salva quando lo dichiari —
// sta in `test/ipam-audit.test.js`. Qui si guarda lo SCHERMO, e una cosa sola:
// che l'interruttore mostri la RISPOSTA e non il campo grezzo, cioè che una rete
// importata come contenitore nasca già accesa senza che nessuno abbia dichiarato
// niente.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

test('l\'interruttore «rete contenitore» mostra la risposta, non il campo', () => {
  const APP = loadApp(ROOT);
  const out = run(APP.ctx, `(() => {
    state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
    _propsExplicit = true; selType=null; selId=null;
    state.ipam = { vlans:{}, prefixes:[
      { cidr:'172.20.0.0/16', vlan:null },                     // scritta a mano, non dichiara niente
      { cidr:'10.0.0.0/8', vlan:null, status:'container' },    // arrivata dal DCIM
      { cidr:'192.168.7.0/24', vlan:null, container:true },    // dichiarata da te
      { cidr:'10.9.0.0/16', vlan:null, status:'container', container:false },  // il DCIM lo dice, tu lo neghi
    ], addresses:[] };
    for(const p of state.ipam.prefixes) _prefixOpen.add(prefixKey(p.cidr));

    renderProps();
    const h = document.getElementById('props-panel').innerHTML || '';
    // L'interruttore di UNA rete: si isola sul suo data-key.
    const acceso = (cidr) => {
      const k = prefixKey(cidr);
      const i = h.indexOf('data-change="prefix-container" data-key="' + k + '"');
      if(i < 0) return null;
      return / checked/.test(h.slice(h.lastIndexOf('<input', i), i));
    };
    return {
      mano:   acceso('172.20.0.0/16'),
      dcim:   acceso('10.0.0.0/8'),
      tuo:    acceso('192.168.7.0/24'),
      negato: acceso('10.9.0.0/16'),
    };
  })()`);

  assert.notEqual(out.mano, null, 'ogni rete aperta ha il suo interruttore');
  assert.equal(out.mano, false, 'una rete scritta a mano non afferma niente finché non lo dici');
  // ⭐ Il punto: nasce accesa senza che nessuno abbia spuntato niente.
  assert.equal(out.dcim, true, 'contenitore secondo il DCIM = interruttore già acceso');
  assert.equal(out.tuo, true, 'e dichiarato da te, lo stesso');
  // ⭐ Manual-first nell'altro verso: la tua parola spegne quella dell'import.
  assert.equal(out.negato, false, 'negato a mano: spento, anche se il DCIM dice il contrario');
});
