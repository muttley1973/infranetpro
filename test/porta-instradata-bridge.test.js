'use strict';
// ============================================================================
// «Instrada» non è «possiede un indirizzo»: è «non è una porta del bridge»
// ============================================================================
// Il campo prometteva più di quanto misurasse. `routed` diceva «questa porta
// instrada», ma leggeva soltanto la tabella indirizzo→interfaccia: possedere un
// indirizzo IP è normale per QUALSIASI host, e infatti scattava anche sulla NIC
// di un controller wireless, che commuta eccome.
//
// La domanda vera è quella che decide se una VLAN esiste: **questa porta fa da
// BRIDGE?** La prova è standard e vendor-neutral — `dot1dBasePortIfIndex`
// (BRIDGE-MIB) — ed era già sul filo e già letta: il driver la walka da sempre
// per tradurre i PVID, che sono indicizzati per bridge-port e non per ifIndex.
//
// ⚠️ Ma la prova è ASIMMETRICA, e va trattata come tale. Misurato sul banco il
// 2026-08-21:
//   • WLC Cisco  → `GigabitEthernet0/0/1` È bridge-port (bp 1, PVID 1) e possiede
//     10.10.99.24. Il positivo è affidabile: quella porta COMMUTA, punto.
//   • SW-ACC1 (vIOS) → pubblica la tabella per **2 porte su 8**; SW-CORE, stessa
//     immagine, per NESSUNA. L'assenza dalla tabella NON prova che la porta non
//     commuti: prova solo che l'agente non lo dice.
// Quindi: essere bridge-port è un VETO su «instrada»; non esserlo non è una prova
// di niente, e si ricade sul possesso dell'indirizzo come indizio — che è quanto
// si faceva prima, ma ora dichiarato per quello che è.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isRoutedPort } = require('../lib/vlan-authority.js');
const { linkPaintVlan } = require('../lib/link-vlan-color.js');
const { extractData, OID } = require('../drivers/snmp.js')._internals;

const B = s => Buffer.from(s, 'utf8');

// ---- ① Il predicato ---------------------------------------------------------

test('instrada: possedere un indirizzo, da solo, resta un INDIZIO e vale', () => {
  // SW-CORE Gi0/0: `no switchport` con 10.99.0.2. Il vIOS non pubblica la
  // tabella delle bridge-port, quindi `bridges` è ignoto — e l'indizio è tutto
  // quello che abbiamo. Toglierlo perderebbe l'unica porta instradata del banco.
  assert.equal(isRoutedPort({ ownsIp: true, bridges: undefined }), true);
});

test('instrada: essere bridge-port è un VETO — quella porta commuta', () => {
  // La NIC del WLC: possiede 10.10.99.24 ED è bridge-port con PVID 1. Prima
  // usciva «instradata» per il solo fatto di avere un indirizzo.
  assert.equal(isRoutedPort({ ownsIp: true, bridges: true }), false);
});

test('instrada: fuori dalla tabella e con un indirizzo è la prova piena', () => {
  assert.equal(isRoutedPort({ ownsIp: true, bridges: false }), true);
});

test('instrada: senza indirizzo non si instrada, comunque sia il bridge', () => {
  for (const bridges of [true, false, undefined]) {
    assert.equal(isRoutedPort({ ownsIp: false, bridges }), false);
  }
  assert.equal(isRoutedPort(null), false);
});

// ---- ② Il modello del colore ------------------------------------------------

test('il cavo del WLC non è più «instradato»: quella porta è nel bridge', () => {
  const r = linkPaintVlan({ mode: 'access', vlans: [], siteNative: 1,
    src: { active: true, ownsIp: true, bridges: true },   // WLC: indirizzo E bridge-port
    dst: { active: true } });
  assert.notEqual(r.kind, 'routed');
  assert.equal(r.vlan, 1, 'commuta, quindi una VLAN ce l’ha: il pavimento');
});

test('il cavo di SW-CORE Gi0/0 resta instradato (agente muto sul bridge)', () => {
  const r = linkPaintVlan({ mode: 'access', vlans: [], siteNative: 1,
    src: { active: true, ownsIp: true }, dst: { active: true } });
  assert.equal(r.kind, 'routed');
  assert.equal(r.vlan, null);
});

// ---- ③ Il driver: tre stati, non due ---------------------------------------

const base = () => ({
  [`${OID.sysName}.0`]: B('SW'),
  [`${OID.ifDescr}.1`]: B('Gi0/0'), [`${OID.ifType}.1`]: 6,
  [`${OID.ifDescr}.2`]: B('Gi0/1'), [`${OID.ifType}.2`]: 6,
});
const porte = vbs => {
  const out = {};
  for (const p of extractData(vbs).interfaces) out[p.name] = p;
  return out;
};

test('driver: chi è nella tabella bridge esce `bridges:true`, chi manca `false`', () => {
  const p = porte(Object.assign(base(), {
    [`${OID.bridgePortIf}.1`]: 2,                 // bridge-port 1 → ifIndex 2
    [`${OID.ipAdEntIfIndex}.10.99.0.2`]: 1,       // Gi0/0 possiede un indirizzo
  }));
  assert.equal(p['Gi0/1'].bridges, true);
  assert.equal(p['Gi0/0'].bridges, false, 'la tabella c’è e non lo elenca');
  assert.equal(p['Gi0/0'].ownsIp, true);
  assert.equal(p['Gi0/1'].ownsIp, false);
});

test('driver: se l’agente NON pubblica la tabella, `bridges` resta ASSENTE', () => {
  // ⚠️ Il silenzio non è un «no». Su vIOS la tabella è parziale o assente: se lo
  // leggessimo come «non commuta», ogni porta con un indirizzo diventerebbe
  // instradata — l'errore che stiamo togliendo, riscritto al contrario.
  const p = porte(Object.assign(base(), { [`${OID.ipAdEntIfIndex}.10.99.0.2`]: 1 }));
  assert.equal(p['Gi0/0'].bridges, undefined);
  assert.equal(p['Gi0/1'].bridges, undefined);
  assert.equal(p['Gi0/0'].ownsIp, true);
});

test('driver: il campo si chiama come cio’ che misura — `routed` non esiste piu’', () => {
  const p = porte(Object.assign(base(), { [`${OID.ipAdEntIfIndex}.10.99.0.2`]: 1 }));
  assert.equal('routed' in p['Gi0/0'], false, 'un nome che promette piu’ della misura è una trappola');
  assert.equal('ownsIp' in p['Gi0/0'], true);
});
