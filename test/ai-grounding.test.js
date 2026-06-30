'use strict';
// ============================================================
//  test/ai-grounding.test.js — lib/ai-grounding.js (controllo anti-invenzione).
//
//  Paletto #2 «niente invenzioni»: verifica che extractEntities estragga le
//  entità REALI dal contesto §8b e che checkGrounding (a) citi i device/VLAN del
//  contesto effettivamente nominati e (b) segnali gli IP/MAC citati ma ASSENTI
//  dai dati (possibile invenzione), senza falsi positivi su CIDR/maschere/IP noti.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { extractEntities, checkGrounding } = require('../lib/ai-grounding.js');

function ctx() {
  return {
    project: { id: 2, name: 'Sede' },
    vlans: [
      { id: 20, name: 'Uffici', subnet: '10.0.20.0/24', gateway: '10.0.20.1' },
      { id: 30, name: 'IoT', subnet: '10.0.30.0/24' },
    ],
    devices: [
      { id: 'n1', name: 'SW-Core', ip: '10.0.20.2', mac: 'aa:bb:cc:dd:ee:ff', vlan: 20 },
      { id: 'n2', name: 'AP', ip: '10.0.20.5', mac: '11:22:33:44:55:66', vlan: 20 },
    ],
    facts: {
      drift: { undocumented: [{ ip: '10.0.20.50', mac: 'de:ad:be:ef:00:01', vlan: 20 }] },
      ipam: [{ vlan: 20, used: 38, free: 216, nextFree: '10.0.20.39' }],
    },
  };
}

test('extractEntities: raccoglie device/ip/mac/vlan dal contesto §8b', () => {
  const e = extractEntities(ctx());
  assert.equal(e.devices.length, 2);
  assert.ok(e.ips.includes('10.0.20.2'), 'IP device');
  assert.ok(e.ips.includes('10.0.20.1'), 'gateway VLAN');
  assert.ok(e.ips.includes('10.0.20.0'), 'indirizzo di rete (subnet base)');
  assert.ok(e.ips.includes('10.0.20.50'), 'IP non-documentato dai liveFacts');
  assert.ok(e.ips.includes('10.0.20.39'), 'nextFree IPAM');
  assert.ok(e.macs.includes('aa:bb:cc:dd:ee:ff') && e.macs.includes('de:ad:be:ef:00:01'));
  assert.ok(e.vlans.includes(20) && e.vlans.includes(30));
});

test('extractEntities: normalizza i MAC (lowercase, trattini → due punti)', () => {
  const e = extractEntities({ devices: [{ id: 'x', mac: 'AA-BB-CC-DD-EE-FF' }] });
  assert.deepEqual(e.macs, ['aa:bb:cc:dd:ee:ff']);
});

test('checkGrounding: cita il device nominato per NOME', () => {
  const r = checkGrounding('Lo switch SW-Core gestisce la VLAN 20.', extractEntities(ctx()));
  assert.ok(r.citations.some(c => c.kind === 'device' && c.id === 'n1'), 'SW-Core citato');
  assert.ok(r.citations.some(c => c.kind === 'vlan' && c.vlan === 20), 'VLAN 20 citata');
  assert.equal(r.unknownRefs.length, 0, 'nessuna invenzione');
});

test('checkGrounding: cita il device nominato per IP/MAC', () => {
  const e = extractEntities(ctx());
  const byIp = checkGrounding('Il nodo 10.0.20.2 risponde.', e);
  assert.ok(byIp.citations.some(c => c.id === 'n1'));
  assert.equal(byIp.unknownRefs.length, 0, 'IP documentato → non è invenzione');
  const byMac = checkGrounding('Vedo aa:bb:cc:dd:ee:ff in tabella.', e);
  assert.ok(byMac.citations.some(c => c.id === 'n1'));
});

test('checkGrounding: SEGNALA un IP inventato (assente dal contesto)', () => {
  const r = checkGrounding('Aggiungi anche il server 203.0.113.250.', extractEntities(ctx()));
  assert.ok(r.unknownRefs.some(u => u.kind === 'ip' && u.value === '203.0.113.250'), 'IP finto segnalato');
});

test('checkGrounding: SEGNALA un MAC inventato', () => {
  const r = checkGrounding('Risulta ca:fe:ba:be:00:99 sulla porta 3.', extractEntities(ctx()));
  assert.ok(r.unknownRefs.some(u => u.kind === 'mac' && u.value.toLowerCase() === 'ca:fe:ba:be:00:99'));
});

test('checkGrounding: NON segnala CIDR di rete né maschere', () => {
  const r = checkGrounding('La rete 10.0.30.0/24 usa maschera 255.255.255.0.', extractEntities(ctx()));
  assert.equal(r.unknownRefs.length, 0, 'CIDR e netmask non sono host inventati');
});

test('checkGrounding: NON scambia un OID SNMP per un IP inventato', () => {
  // Spezzoni come 1.3.6.1 / 2.1.43.11 dentro il Printer-MIB non sono host.
  const r = checkGrounding('Leggi il toner con l\'OID 1.3.6.1.2.1.43.11.1.1.9 via SNMP.', extractEntities(ctx()));
  assert.equal(r.unknownRefs.length, 0, 'gli ottetti interni a un OID non sono IP inventati');
  // L'argine sugli IP veri NON deve allentarsi: un host estraneo resta segnalato.
  const r2 = checkGrounding('Vedo l\'OID 1.3.6.1.2.1.1 ma anche il nodo 203.0.113.7.', extractEntities(ctx()));
  assert.ok(r2.unknownRefs.some(u => u.value === '203.0.113.7'), 'l\'IP estraneo resta segnalato');
  assert.ok(!r2.unknownRefs.some(u => u.value === '1.3.6.1'), 'l\'OID non è segnalato');
});

test('checkGrounding: NON segnala l\'IP non-documentato (è nel contesto via liveFacts)', () => {
  const r = checkGrounding('Il misterioso 10.0.20.50 è da adottare.', extractEntities(ctx()));
  assert.equal(r.unknownRefs.length, 0, 'IP presente nei liveFacts → noto, non invenzione');
});

test('checkGrounding: match a parola intera (nome corto non matcha dentro un\'altra parola)', () => {
  const e = extractEntities({ devices: [{ id: 'n2', name: 'AP', ip: '', mac: '' }] });
  assert.equal(checkGrounding('La parola APPLE non è un device.', e).citations.length, 0, 'AP dentro APPLE → no');
  assert.equal(checkGrounding('L\'AP è acceso.', e).citations.length, 1, 'AP come parola → sì');
});

test('checkGrounding: input vuoti/sporchi non lanciano e tornano vuoti', () => {
  assert.deepEqual(checkGrounding('', null), { citations: [], unknownRefs: [] });
  assert.deepEqual(checkGrounding(null, undefined), { citations: [], unknownRefs: [] });
  assert.deepEqual(checkGrounding('testo', { devices: 'x', ips: 5 }), { citations: [], unknownRefs: [] });
  assert.doesNotThrow(() => extractEntities(null));
  assert.doesNotThrow(() => extractEntities({ devices: 'nope', vlans: 3, facts: 7 }));
});
