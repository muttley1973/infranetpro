'use strict';
// L'identità hardware (ENTITY-MIB) non deve dipendere da QUANTO ci mettono le famiglie
// opzionali a fallire. Caso misurato dal vivo il 16/10 su uno switch Zyxel GS1900: tre
// famiglie che quell'agente non implementa (VTP Cisco, LACP IEEE, MAU) non rispondono
// «non esiste» ma restano MUTE, ognuna costa due timeout, il tetto di 25 s si esaurisce
// e le subtree rimaste — l'ENTITY-MIB, ultima della tabella — vengono saltate. Il poll
// riusciva (`snmpStatus: ok`) ma senza identità: marca, modello, matricola e firmware
// svuotati dall'utente non tornavano più, a ogni Sync. L'ENTITY-MIB sullo stesso
// apparato, letta da sola, risponde in pochi ms.
// Mock della sessione net-snmp: zero rete, orologio vero.
const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../drivers/snmp.js');
const { walkSession, OID, ENTITY_BASES, extractEntityInventory } = _internals;

const TIMEOUT = () => new Error('Request timed out');
const S = s => Buffer.from(s);

// Le righe che lo Zyxel pubblica davvero (stesso schema: «Stack» a indice basso, il chassis
// molto più in là). Una tabella per colonna: base → { indice: valore }.
const ENT_ROWS = {
  [OID.entPhysicalDescr]:       { 64: S('Stack'), 67108992: S('GS1900-24') },
  [OID.entPhysicalClass]:       { 64: 11, 67108992: 3 },
  [OID.entPhysicalSoftwareRev]: { 67108992: S('2.10.68857') },
  [OID.entPhysicalSerialNum]:   { 67108992: S('S202L27002866') },
  [OID.entPhysicalMfgName]:     { 67108992: S('ZyXEL, Inc.') },
  [OID.entPhysicalModelName]:   { 67108992: S('GS1900-24') },
};

// Agente «con le famiglie opzionali mute»: sysName e ENTITY-MIB rispondono subito, ogni
// altra subtree va in timeout dopo `silentMs`.
function mockMuteAgent(silentMs) {
  const calls = [];
  return {
    calls,
    subtree(base, maxReps, feedCb, doneCb) {
      calls.push(base);
      if (base === OID.sysName) {
        setImmediate(() => { feedCb([{ oid: OID.sysName + '.0', value: S('GS1900') }]); doneCb(null); });
        return;
      }
      if (ENT_ROWS[base] || ENTITY_BASES.includes(base)) {
        setImmediate(() => {
          const col = ENT_ROWS[base] || {};
          const vbs = Object.keys(col).map(i => ({ oid: `${base}.${i}`, value: col[i] }));
          if (vbs.length) feedCb(vbs);
          doneCb(null);
        });
        return;
      }
      setTimeout(() => doneCb(TIMEOUT()), silentMs);
    },
  };
}

test('ENTITY_BASES: sono TUTTE e SOLE le colonne entPhysical* della tabella OID (derivate, non elencate)', () => {
  const dalla = Object.keys(OID).filter(k => k.startsWith('entPhysical')).map(k => OID[k]);
  assert.ok(dalla.length >= 6, 'la tabella ha le colonne d\'identità');
  assert.deepEqual([...ENTITY_BASES].sort(), [...dalla].sort());
});

test('identità: con le famiglie opzionali mute e il budget che si esaurisce, il chassis arriva lo stesso', async () => {
  // Budget stretto rispetto al costo di UN solo gruppo di subtree mute (2 timeout + backoff
  // ≈ 2*80 + 120 = 280 ms): dopo il primo gruppo il tetto è passato e il resto viene saltato.
  const sess = mockMuteAgent(80);
  const vbs = await walkSession(sess, { deadline: Date.now() + 250 });
  const inv = extractEntityInventory(vbs);
  assert.ok(inv, 'una walk con il budget esaurito NON deve perdere l\'identità (era `null`)');
  assert.equal(inv.model, 'GS1900-24');
  assert.equal(inv.serialNumber, 'S202L27002866');
  assert.equal(inv.brand, 'ZyXEL, Inc.');
  assert.equal(inv.firmwareVer, '2.10.68857');
});

test('identità: l\'ENTITY-MIB si legge PRIMA di qualunque famiglia opzionale', async () => {
  const sess = mockMuteAgent(1);
  await walkSession(sess, { deadline: Date.now() + 5000 });
  const ultimaEnt = Math.max(...ENTITY_BASES.map(b => sess.calls.indexOf(b)));
  const altre = sess.calls.filter(b => b !== OID.sysName && !ENTITY_BASES.includes(b));
  assert.ok(altre.length > 0, 'le altre famiglie vengono interrogate');
  const primaDelleAltre = Math.min(...altre.map(b => sess.calls.indexOf(b)));
  assert.ok(ultimaEnt < primaDelleAltre, `ENTITY-MIB (ultima @${ultimaEnt}) prima delle altre (prima @${primaDelleAltre})`);
});

test('identità: ogni subtree è interrogata UNA volta sola (lo spostamento non ne duplica né ne perde)', async () => {
  const sess = mockMuteAgent(1);
  await walkSession(sess, { deadline: Date.now() + 5000 });
  const attese = new Set(Object.values(OID));
  const viste = new Set(sess.calls);
  assert.deepEqual([...viste].sort(), [...attese].sort(), 'stesse basi di prima: nessuna persa');
  for (const b of ENTITY_BASES) assert.equal(sess.calls.filter(c => c === b).length, 1, `${b} letta una volta`);
});

test('identità: un ENTITY-MIB che resta MUTO non affama il resto del poll (ha un sotto-budget)', async () => {
  // Agente che sull'ENTITY-MIB va in timeout (come lo Zyxel sul VTP) e risponde bene al
  // resto: l'identità non è un motivo per perdere le porte. Il tetto totale è 600 ms; il
  // passaggio d'identità può usarne al più un terzo.
  const calls = [];
  const sess = {
    calls,
    subtree(base, maxReps, feedCb, doneCb) {
      calls.push(base);
      if (base === OID.sysName) return setImmediate(() => { feedCb([{ oid: OID.sysName + '.0', value: S('x') }]); doneCb(null); });
      if (ENTITY_BASES.includes(base)) return setTimeout(() => doneCb(TIMEOUT()), 150);
      setImmediate(() => { feedCb([{ oid: base + '.1', value: S('ok') }]); doneCb(null); });
    },
  };
  const t0 = Date.now();
  const vbs = await walkSession(sess, { deadline: t0 + 600 });
  assert.ok(Object.keys(vbs).some(o => o.startsWith(OID.ifDescr + '.')), 'le interfacce sono state lette comunque');
  assert.ok(Date.now() - t0 < 700, `il poll resta nel tetto (misurato ${Date.now() - t0} ms)`);
});
