'use strict';
// Identificatori LLDP letti dal SOTTOTIPO, non dalla lunghezza (IEEE 802.1AB).
//
// I casi non sono inventati: sono le risposte misurate sul banco il 2026-08-20.
// Lo stesso switch Cisco, letto da due agenti diversi, consegna lo stesso
// chassis-id in due codifiche — sei ottetti grezzi dall'Arista, diciassette byte
// di testo dal MikroTik — e la vecchia regola «sei byte ⇒ è un MAC» perdeva la
// seconda per intero. La stessa regola, al contrario, trasformava un nome di
// porta di sei caratteri in un indirizzo che non esiste.
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractNeighbors, N_OID, macFromText, lldpMac } = require('../drivers/snmp.js')._internals;

const B = s => Buffer.from(s, 'utf8');
const IDX = '0.2.2';                                    // timeFilter.localPortNum.remIdx
const CHASSIS_MAC_RAW = Buffer.from([0x50, 0x25, 0xc2, 0x00, 0x29, 0x00]);
const CHASSIS_MAC_TXT = B('50:25:C2:00:29:00');         // stesso indirizzo, dal MikroTik
const ATTESO = '50:25:c2:00:29:00';

function vbs(extra) {
  return Object.assign({ [`${N_OID.sysName}.0`]: B('R-EDGE') }, extra);
}
const primo = v => (extractNeighbors(v).neighbors || [])[0] || {};

// ── chassis-id ──────────────────────────────────────────────────────────────

test('chassis-id: MAC a sei ottetti col sottotipo macAddress → letto (Arista, dal banco)', () => {
  const n = primo(vbs({
    [`${N_OID.lldpRemChassisIdSubtype}.${IDX}`]: 4,
    [`${N_OID.lldpRemChassisId}.${IDX}`]:        CHASSIS_MAC_RAW,
    [`${N_OID.lldpRemSysName}.${IDX}`]:          B('SW-CORE'),
  }));
  assert.equal(n.remoteMac, ATTESO);
});

test('chassis-id: LO STESSO MAC scritto come testo → letto uguale (MikroTik, dal banco)', () => {
  const n = primo(vbs({
    [`${N_OID.lldpRemChassisIdSubtype}.${IDX}`]: 4,
    [`${N_OID.lldpRemChassisId}.${IDX}`]:        CHASSIS_MAC_TXT,
    [`${N_OID.lldpRemSysName}.${IDX}`]:          B('SW-CORE'),
  }));
  // Era '' — 17 byte non sono 6 — e con lui spariva l'unica identità che non cambia.
  assert.equal(n.remoteMac, ATTESO);
});

test('chassis-id: sottotipo local (7) di sei byte → NESSUN MAC, non se ne inventa uno', () => {
  const n = primo(vbs({
    [`${N_OID.lldpRemChassisIdSubtype}.${IDX}`]: 7,
    [`${N_OID.lldpRemChassisId}.${IDX}`]:        B('SW-001'),   // sei caratteri: un NOME
    [`${N_OID.lldpRemSysName}.${IDX}`]:          B('SW-001'),
  }));
  assert.equal(n.remoteMac, '', 'prima usciva 53:57:2d:30:30:31, un indirizzo di nessuno');
});

// ── port-id ─────────────────────────────────────────────────────────────────

test('port-id: nome di SEI caratteri col sottotipo interfaceName → resta il nome', () => {
  const n = primo(vbs({
    [`${N_OID.lldpRemPortIdSubtype}.${IDX}`]: 5,
    [`${N_OID.lldpRemPortId}.${IDX}`]:        B('Gi1/24'),
    [`${N_OID.lldpRemSysName}.${IDX}`]:       B('SW-ACC1'),
  }));
  assert.equal(n.remotePort, 'Gi1/24', 'prima diventava 47:69:31:2f:32:34');
  assert.equal(n.remotePortMac, '');
});

test('port-id: sottotipo macAddress → il MAC va nel suo campo, e il nome resta la descrizione', () => {
  const n = primo(vbs({
    [`${N_OID.lldpRemPortIdSubtype}.${IDX}`]: 3,
    [`${N_OID.lldpRemPortId}.${IDX}`]:        B('50:48:DE:00:1F:01'),  // MikroTik, dal banco
    [`${N_OID.lldpRemPortDesc}.${IDX}`]:      B('ether2'),
    [`${N_OID.lldpRemSysName}.${IDX}`]:       B('R-EDGE'),
  }));
  assert.equal(n.remotePortMac, '50:48:de:00:1f:01');
  assert.equal(n.remotePort, 'ether2');
  // Il MAC NON deve finire fra i nomi di porta: là non può combaciare con niente,
  // e la porta finirebbe dedotta invece che letta.
  assert.notEqual(n.remotePort, '50:48:DE:00:1F:01');
});

// ── agenti che il sottotipo non lo espongono ────────────────────────────────

test('senza colonna del sottotipo: comportamento storico invariato (sei ottetti = MAC)', () => {
  const n = primo(vbs({
    [`${N_OID.lldpRemChassisId}.${IDX}`]: CHASSIS_MAC_RAW,
    [`${N_OID.lldpRemPortId}.${IDX}`]:    B('Gi1/0/1'),
    [`${N_OID.lldpRemSysName}.${IDX}`]:   B('SW-CORE'),
  }));
  assert.equal(n.remoteMac, ATTESO);
  assert.equal(n.remotePort, 'Gi1/0/1');
});

test('senza colonna del sottotipo: un MAC scritto per esteso è comunque un MAC', () => {
  const n = primo(vbs({
    [`${N_OID.lldpRemChassisId}.${IDX}`]: CHASSIS_MAC_TXT,
    [`${N_OID.lldpRemSysName}.${IDX}`]:   B('SW-CORE'),
  }));
  assert.equal(n.remoteMac, ATTESO, 'sei gruppi esadecimali separati non possono essere altro');
});

// ── il riconoscitore, da solo ───────────────────────────────────────────────

test('macFromText: accetta le grafie vere, rifiuta ciò che MAC non è', () => {
  assert.equal(macFromText('50:25:C2:00:29:00'), '50:25:c2:00:29:00');
  assert.equal(macFromText('0:1a:2b:0:10:0'),    '00:1a:2b:00:10:00', 'grafia di net-snmp, senza zeri');
  assert.equal(macFromText('50-25-C2-00-29-00'), '50:25:c2:00:29:00', 'col trattino');
  assert.equal(macFromText('Gi1/24'), '');
  assert.equal(macFromText('Switch'), '');
  assert.equal(macFromText('50:25:C2:00:29'), '', 'cinque gruppi non sono un MAC');
  assert.equal(macFromText(''), '');
});

test('lldpMac: le due codifiche danno la stessa forma canonica', () => {
  assert.equal(lldpMac(CHASSIS_MAC_RAW), lldpMac(CHASSIS_MAC_TXT));
  assert.equal(lldpMac(B('non-e-un-mac')), '', 'ciò che non è né sei ottetti né un MAC scritto');
  // ⚠️ Sei ottetti restano un MAC anche quando somigliano a del testo: `lldpMac` si
  // chiama SOLO dove il sottotipo ha già dichiarato «questo è un indirizzo», e a
  // quel punto la dichiarazione batte l'apparenza. È la ragione per cui la lettura
  // del sottotipo non è un dettaglio: senza, «Switch» diventerebbe un indirizzo.
  assert.equal(lldpMac(B('Switch')), '53:77:69:74:63:68');
});
