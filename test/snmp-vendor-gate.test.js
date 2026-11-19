'use strict';
// Le MIB di UN fornitore si leggono dove l'apparato dice di essere di quel fornitore.
//
// `OID` contiene famiglie proprietarie di Cisco (VTP, VLAN-MEMBERSHIP, VLAN-IFTABLE: tutte sotto
// 1.3.6.1.4.1.9) e ogni apparato le camminava, Cisco o no. Su un agente che le implementa sono
// tabelle; su uno che NON le implementa la risposta giusta e' `endOfMibView` (un attimo) — ma
// alcuni agenti non rispondono affatto e la subtree costa quattro timeout (due nel net-snmp, due nel
// retry adattivo della walk). Misurato il 19/11/2026 su uno Zyxel GS1900 reale (PEN 890): il poll
// durava 30 s contro un tetto di 25, con lo STP — l'ultima famiglia dell'elenco — letto per un
// soffio. Nessun altro mondo lo risolve con una cache: Checkmk e Observium NON chiedono la MIB di
// un fornitore a chi non e' di quel fornitore (detect su sysObjectID / elenco di MIB per OS).
//
// La regola e' derivata dall'OID stesso, senza elenchi di marche: una base dentro
// `1.3.6.1.4.1.<PEN>.…` si legge solo se il sysObjectID dell'apparato e' di quel PEN. Se il
// sysObjectID non c'e' o non ha la forma `…4.1.<PEN>…` NON c'e' una prova contraria: si legge
// come prima (mai perdere una lettura per un'assenza di evidenza). Mock della sessione net-snmp.
const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../drivers/snmp.js');
const { walkSession, OID } = _internals;

const TIMEOUT = () => new Error('Request timed out');
const isEnterprise = (b) => /^1\.3\.6\.1\.4\.1\.\d+(\.|$)/.test(b);
const PROPRIETARIE = Object.values(OID).filter(isEnterprise);

// Agente che risponde a tutto subito, TRANNE le famiglie proprietarie se `mute`: quelle restano
// silenziose `silentMs` (come lo Zyxel sul VTP). `sysObjectID`: il valore che pubblica (o niente).
function agente({ sysObjectID, mute = false, silentMs = 150 } = {}) {
  const calls = [];
  return {
    calls,
    subtree(base, maxReps, feedCb, doneCb) {
      calls.push(base);
      if (base === OID.sysName) return setImmediate(() => { feedCb([{ oid: base + '.0', value: Buffer.from('SW') }]); doneCb(null); });
      if (base === OID.sysObjectID) return setImmediate(() => { if (sysObjectID !== undefined) feedCb([{ oid: base + '.0', value: sysObjectID }]); doneCb(null); });
      if (mute && isEnterprise(base)) return setTimeout(() => doneCb(TIMEOUT()), silentMs);
      setImmediate(() => { feedCb([{ oid: base + '.1', value: Buffer.from('ok') }]); doneCb(null); });
    },
  };
}
const walk = async (a, ms = 5000) => walkSession(a, { deadline: Date.now() + ms });
const chieste = (a) => [...new Set(a.calls)];

test('la tabella OID ha famiglie proprietarie (se un giorno non ne ha, questo file non prova piu\' niente)', () => {
  assert.ok(PROPRIETARIE.length >= 5, `famiglie sotto 1.3.6.1.4.1: ${PROPRIETARIE.length}`);
  assert.ok(PROPRIETARIE.every((b) => b.startsWith('1.3.6.1.4.1.9.')), 'oggi sono tutte Cisco (PEN 9)');
});

test('apparato di un ALTRO fornitore (PEN 890): nessuna base proprietaria Cisco viene interrogata', async () => {
  const a = agente({ sysObjectID: '1.3.6.1.4.1.890.1.15' });
  await walk(a);
  assert.deepEqual(chieste(a).filter(isEnterprise), [], 'le MIB di Cisco non si chiedono a chi non e\' Cisco');
});

test('apparato di un altro fornitore: perde SOLO le proprietarie — ogni altra base resta, una volta sola', async () => {
  const a = agente({ sysObjectID: '1.3.6.1.4.1.890.1.15' });
  await walk(a);
  const attese = Object.values(OID).filter((b) => !isEnterprise(b));
  assert.deepEqual(chieste(a).sort(), [...attese].sort());
  for (const b of attese) assert.equal(a.calls.filter((c) => c === b).length, 1, `${b} letta una volta`);
});

test('apparato Cisco (PEN 9): le legge TUTTE, una volta sola (nessuna lettura perduta)', async () => {
  const a = agente({ sysObjectID: '1.3.6.1.4.1.9.1.1745' });
  await walk(a);
  assert.deepEqual(chieste(a).sort(), Object.values(OID).sort());
  for (const b of PROPRIETARIE) assert.equal(a.calls.filter((c) => c === b).length, 1, `${b} letta una volta`);
});

test('il PEN si confronta INTERO: 98 e 90 non sono 9', async () => {
  for (const pen of ['98', '90', '900', '19']) {
    const a = agente({ sysObjectID: `1.3.6.1.4.1.${pen}.1.2` });
    await walk(a);
    assert.deepEqual(chieste(a).filter(isEnterprise), [], `PEN ${pen}: non e' Cisco`);
  }
});

test('nessuna PROVA contraria = si legge come prima (sysObjectID assente, o senza la forma enterprise)', async () => {
  for (const [nome, v] of [['assente', undefined], ['vuoto', ''], ['non enterprise', '1.3.6.1.2.1.1.2.0'], ['testo', 'non-un-oid'], ['solo il prefisso', '1.3.6.1.4.1']]) {
    const a = agente({ sysObjectID: v });
    await walk(a);
    assert.deepEqual(chieste(a).sort(), Object.values(OID).sort(), `sysObjectID ${nome}: tutte le basi`);
  }
});

test('il sysObjectID si legge NELLA PRIMA ondata, con sysName, e UNA volta sola', async () => {
  const a = agente({ sysObjectID: '1.3.6.1.4.1.890.1.15' });
  await walk(a);
  assert.deepEqual(a.calls.slice(0, 2).sort(), [OID.sysName, OID.sysObjectID].sort(), 'le prime due richieste');
  assert.equal(a.calls.filter((c) => c === OID.sysObjectID).length, 1);
});

test('il costo che si toglie e\' QUELLO MISURATO: proprietarie mute, apparato di un altro fornitore -> nessun timeout pagato', async () => {
  // 7 basi proprietarie sparse in 3 ondate. Senza il filtro ogni ondata muta costa 2 timeout + backoff
  // (≈ 2*150 + 120 = 420 ms): ≥ 1,2 s. Col filtro: zero.
  const a = agente({ sysObjectID: '1.3.6.1.4.1.890.1.15', mute: true });
  const t0 = Date.now();
  const vbs = await walk(a);
  const ms = Date.now() - t0;
  assert.ok(ms < 500, `il poll non paga le famiglie altrui (misurato ${ms} ms)`);
  assert.ok(Object.keys(vbs).some((o) => o.startsWith(OID.dot1dStp + '.')), 'lo STP, ultima famiglia, arriva');
  assert.ok(Object.keys(vbs).some((o) => o.startsWith(OID.ifDescr + '.')), 'le interfacce arrivano');
});

test('stesso agente muto sulle proprietarie ma Cisco: le paga (il filtro non le salta a chi le ha)', async () => {
  const a = agente({ sysObjectID: '1.3.6.1.4.1.9.1.1745', mute: true });
  const t0 = Date.now();
  await walk(a);
  assert.ok(Date.now() - t0 >= 400, 'un agente Cisco silenzioso paga il timeout: e\' il suo');
});

// ---- La regola, da sola ----
const { _basePen, _baseApplies, _enterpriseOf } = _internals;
const CISCO = '1.3.6.1.4.1.9.9.46.1.6.1.1.13';
const FORTI = '1.3.6.1.4.1.12356.101.13';
const STD = '1.3.6.1.2.1.2.2.1.2';

test('_basePen: il proprietario sta nell\'OID; le MIB standard non ne hanno', () => {
  assert.equal(_basePen(CISCO), '9');
  assert.equal(_basePen(FORTI), '12356');
  assert.equal(_basePen('1.3.6.1.4.1.9'), '9', 'anche la radice dell\'enterprise');
  assert.equal(_basePen(STD), null);
  assert.equal(_basePen('1.3.6.1.4.1'), null, 'senza il numero non c\'e\' proprietario');
  assert.equal(_basePen('1.3.6.1.4.19.1'), null, 'non e\' 4.1.<PEN>: 4.19 e\' un\'altra cosa');
  assert.equal(_basePen(undefined), null);
});

test('_baseApplies: solo un PEN DIVERSO e NOTO fa saltare; standard e ignoto si leggono', () => {
  assert.equal(_baseApplies(STD, '890'), true, 'MIB standard: la implementa chiunque');
  assert.equal(_baseApplies(CISCO, '890'), false);
  assert.equal(_baseApplies(CISCO, '9'), true);
  assert.equal(_baseApplies(CISCO, 9), true, 'il PEN puo\' arrivare come numero');
  assert.equal(_baseApplies(CISCO, '98'), false, 'confronto INTERO, non per prefisso');
  assert.equal(_baseApplies(CISCO, null), true, 'PEN ignoto: nessuna prova contraria');
  assert.equal(_baseApplies(CISCO, undefined), true);
  assert.equal(_baseApplies(FORTI, '9'), false, 'vale per QUALUNQUE fornitore, non solo Cisco');
  assert.equal(_baseApplies(FORTI, '12356'), true);
});

test('_enterpriseOf: legge il PEN del sysObjectID nella forma di walkSession, e solo se e\' testo', () => {
  assert.equal(_enterpriseOf({ [`${OID.sysObjectID}.0`]: '1.3.6.1.4.1.890.1.15' }), '890');
  assert.equal(_enterpriseOf({ [`${OID.sysObjectID}.0`]: Buffer.from('1.3.6.1.4.1.890') }), null, 'un Buffer non e\' un OID');
  assert.equal(_enterpriseOf({}), null);
  assert.equal(_enterpriseOf(null), null);
});
