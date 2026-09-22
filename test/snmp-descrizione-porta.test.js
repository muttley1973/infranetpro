'use strict';
// ============================================================
// La descrizione di una porta (ifAlias) è una MISURA, e si dimentica come tale.
//
// Il difetto: il driver scriveva `alias: f.alias || ''`, cioè metteva nella stessa
// stringa vuota «l'apparato non l'ha detta» e «l'apparato dice che non c'è»; poi
// la glue, davanti al vuoto, teneva il valore PRECEDENTE. Due ripieghi in fila,
// e il risultato era una descrizione immortale: la cancellavi sullo switch
// (`no description`) e InfraNet continuava a mostrare la vecchia — nel pannello
// della porta, come segnaposto, nel report PDF, e nell'incrocio dei vicini LLDP
// che cercano una porta anche per alias.
//
// La regola è quella già scritta per la VLAN (test/snmp-vlan-misura-scaduta):
// una misura che il poll non riconferma non sopravvive alla prova che la reggeva.
// Tre stati sul filo, perché sono tre fatti diversi:
//   • testo  → è la descrizione;
//   • ''     → letta, e sull'apparato non c'è: si toglie;
//   • assente → non letta (colonna non pubblicata, walk troncata): nemmeno questa
//               la riconferma, quindi si toglie anche lei — ma resta distinguibile
//               per chi un giorno la confronterà col documento, dove «non l'ho
//               letta» e «lì non c'è scritto niente» non sono la stessa risposta.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { extractData, OID } = require('../drivers/snmp.js')._internals;
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const B = s => Buffer.from(s, 'utf8');

// ---- ① Il driver: tre stati, non due --------------------------------------

const porte = vbs => {
  const out = {};
  for (const p of extractData(vbs).interfaces) out[p.name] = p;
  return out;
};

test('driver: la descrizione letta arriva com\'è, ripulita dagli spazi', () => {
  const p = porte({
    [`${OID.sysName}.0`]: B('SW'),
    [`${OID.ifDescr}.1`]: B('Gi0/1'), [`${OID.ifType}.1`]: 6,
    [`${OID.ifAlias}.1`]: B('  A-12 | stampante  '),
  });
  assert.equal(p['Gi0/1'].alias, 'A-12 | stampante');
});

test('driver: letta VUOTA resta una stringa vuota — è una risposta', () => {
  const p = porte({
    [`${OID.sysName}.0`]: B('SW'),
    [`${OID.ifDescr}.1`]: B('Gi0/1'), [`${OID.ifType}.1`]: 6,
    [`${OID.ifAlias}.1`]: B(''),
  });
  assert.equal(p['Gi0/1'].alias, '');
});

test('driver: NON letta resta assente — non è una stringa vuota', () => {
  // La porta c'è (ifDescr), la colonna ifAlias no: l'agente non l'ha detta.
  const p = porte({
    [`${OID.sysName}.0`]: B('SW'),
    [`${OID.ifDescr}.1`]: B('Gi0/1'), [`${OID.ifType}.1`]: 6,
  });
  assert.equal(p['Gi0/1'].alias, undefined,
    '«non l\'ho letta» e «è vuota» sono due fatti: il vuoto li confondeva');
  assert.equal(JSON.parse(JSON.stringify(p['Gi0/1'])).alias, undefined,
    'e sul filo JSON l\'assenza resta assenza');
});

// ---- ② La glue: la misura si dimentica -------------------------------------

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (descrizione-porta)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

/** Un poll di uno switch a una porta; `campo` è il frammento con cui arriva l'alias. */
function dopoIlPoll(prima, campo) {
  return run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.ports = state.ports || {};
    state.nodes.push({ id:'sw1', type:'switch', name:'SW', ports:1, ip:'10.0.0.1' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    state.ports['sw1-1'] = ${JSON.stringify(prima)};
    applyPollResult('sw1', { ok:true, lags:[], vlans:[], interfaces:[
      { index:1, name:'Gi0/1', operStatus:1, speed:1000${campo} }
    ] }, { noHistory:true });
    const p = state.ports['sw1-1'];
    return { has: Object.prototype.hasOwnProperty.call(p, 'alias'), alias: p.alias, desc: p.desc };
  })()`);
}

test('cancellata sullo switch: la descrizione vecchia se ne va (il difetto)', () => {
  const out = dopoIlPoll({ ifName: 'Gi0/1', alias: 'A-12' }, `, alias:''`);
  assert.equal(out.has, false,
    'lo switch dice «nessuna descrizione»: tenere A-12 sarebbe affermare una cosa che non c\'è più');
});

test('cambiata sullo switch: vince la nuova', () => {
  const out = dopoIlPoll({ ifName: 'Gi0/1', alias: 'A-12' }, `, alias:'A-14'`);
  assert.equal(out.alias, 'A-14');
});

test('solo spazi è una descrizione vuota', () => {
  const out = dopoIlPoll({ ifName: 'Gi0/1', alias: 'A-12' }, `, alias:'   '`);
  assert.equal(out.has, false);
});

test('non letta in questo poll: non si riconferma, quindi si dimentica (regola della VLAN)', () => {
  const out = dopoIlPoll({ ifName: 'Gi0/1', alias: 'A-12' }, '');
  assert.equal(out.has, false,
    'una misura non sopravvive alla prova che la reggeva — stessa regola di p.vlan');
});

test('la descrizione SCRITTA IN INFRANET non si tocca: `desc` è documento, non misura', () => {
  const out = dopoIlPoll({ ifName: 'Gi0/1', alias: 'A-12', desc: 'presa A-12, ufficio 3' }, `, alias:''`);
  assert.equal(out.desc, 'presa A-12, ufficio 3');
  assert.equal(out.has, false);
});
