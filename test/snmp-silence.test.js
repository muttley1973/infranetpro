'use strict';
// ============================================================
//  test/snmp-silence.test.js — lib/snmp-silence.js
//
//  La regola che questo motore deve rispettare non è «trova i muti»: è «non
//  accusare nessuno». Marca SOLO chi era autorevolmente atteso a SNMP, e resta
//  zitto su tutto il resto — perché un badge su ogni host senza SNMP sarebbe
//  rumore, e il rumore su un segnale lo cancella.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { snmpSilence, countSnmpSilent } = require('../lib/snmp-silence.js');

// ── Le due autorità, e solo quelle ─────────────────────────────────────────
test('un vicino DICHIARATO da LLDP/CDP che non risponde è silenzioso alla chiave', () => {
  for (const proto of ['LLDP', 'CDP', 'lldp']) {
    const r = { ip: '10.0.5.1', viaProtocol: proto, snmpReachable: false };
    assert.deepEqual(snmpSilence(r), { why: 'neighbor' }, proto + ': un vicino xDP è un apparato gestito per definizione');
  }
  assert.deepEqual(snmpSilence({ ip: '10.0.5.2', _via: 'lldp', snmpReachable: false }), { why: 'neighbor' },
    'anche quando il protocollo esatto non è arrivato, la provenienza xDP basta');
});

test('un vicino annunciato NON deve anche essere vivo al ping: l\'annuncio è la prova', () => {
  // Chi lo annuncia lo sta vedendo su una sua porta adesso. Pretendere anche il
  // ping vorrebbe dire perdere ogni apparato dietro un firewall che filtra ICMP
  // — cioè quasi ogni apparato d'infrastruttura configurato bene.
  const r = { ip: '10.0.5.3', viaProtocol: 'LLDP', snmpReachable: false, alive: false, pingReachable: false };
  assert.deepEqual(snmpSilence(r), { why: 'neighbor' });
});

test('un apparato che il PROGETTO documenta con un driver SNMP, vivo e muto, è silenzioso alla chiave', () => {
  const r = { ip: '10.0.20.2', snmpReachable: false, alive: true };
  assert.deepEqual(snmpSilence(r, { documentedDriver: 'snmp-v2c' }), { why: 'declared' },
    'declare-first: che parli SNMP lo dice il documento, non una congettura sul vendor');
  assert.deepEqual(snmpSilence({ ip: '10.0.20.3', snmpReachable: false, pingReachable: true }, { documentedDriver: 'snmp' }),
    { why: 'declared' }, 'il ping da solo basta come prova di vita');
});

// ── Dove deve TACERE ───────────────────────────────────────────────────────
test('un apparato documentato ma SPENTO è assente, non silenzioso', () => {
  // ⚠️ La differenza non è accademica: «chiave sbagliata» manda a cercare una
  // credenziale, «assente» manda a cercare un alimentatore. Sbagliare la parola
  // manda una persona nel posto sbagliato.
  const r = { ip: '10.0.20.9', snmpReachable: false, alive: false, pingReachable: false };
  assert.equal(snmpSilence(r, { documentedDriver: 'snmp-v2c' }), null);
});

test('chi ha RISPOSTO non si marca, e il caso v3 resta a chi lo dice meglio', () => {
  assert.equal(snmpSilence({ snmpReachable: true, viaProtocol: 'LLDP' }), null, 'ha risposto');
  assert.equal(snmpSilence({ snmpReachable: false, viaProtocol: 'LLDP', needsCredentials: true }), null,
    'v3 ha già il suo badge 🔑 «agente vivo, servono credenziali»: due badge sulla stessa riga sono un badge di troppo');
});

test('un host qualunque senza SNMP NON si marca: sarebbe rumore, e il rumore cancella il segnale', () => {
  // Un PC, una stampante, un NAS senza SNMP sono CORRETTI così (stesso paletto dei
  // passivi: non è una lacuna). Nessuna autorità li attendeva a SNMP.
  for (const r of [
    { ip: '10.0.20.50', alive: true, mac: 'aa:bb:cc:dd:ee:ff', vendor: 'Hewlett Packard' },
    { ip: '10.0.20.51', alive: true, httpTitle: 'Router Login', services: [80, 443] },
    { ip: '10.0.20.52', alive: true, _via: 'arp' },
    { ip: '10.0.20.53', pingReachable: true, netbiosName: 'PC-MARIO' },
  ]) assert.equal(snmpSilence(r), null, JSON.stringify(r) + ' non era atteso a SNMP da nessuna autorità');
});

test('vendor-neutral: la marca non c\'entra, né in un senso né nell\'altro', () => {
  // ⚠️ Se un giorno qualcuno aggiunge un elenco di «marche da rete», questa prova
  // deve arrossire: sarebbe una regola sul lab travestita da classe generale.
  const base = { ip: '10.0.7.1', alive: true, snmpReachable: false };
  for (const vendor of ['Cisco Systems', 'Aruba', 'MikroTik', 'Zyxel', 'Acme Widgets', '']) {
    assert.equal(snmpSilence({ ...base, vendor }), null, vendor + ': senza autorità non si marca, qualunque marca sia');
    assert.deepEqual(snmpSilence({ ...base, vendor, viaProtocol: 'LLDP' }), { why: 'neighbor' },
      vendor + ': con autorità si marca, qualunque marca sia');
  }
});

test('ingressi storti non fanno rumore né esplodono', () => {
  for (const r of [null, undefined, 0, 'x', []]) assert.equal(snmpSilence(r), null);
  assert.equal(snmpSilence({ snmpReachable: false }, { documentedDriver: 'dcim' }), null, 'un driver non-SNMP non è un\'autorità SNMP');
  assert.equal(snmpSilence({ snmpReachable: false, alive: true }, null), null, 'senza opts non si inventa un driver documentato');
});

// ── Il conteggio, che è il vero destinatario ───────────────────────────────
test('countSnmpSilent: il numero in cima è quello che fa ripetere la scansione', () => {
  const rows = [
    { ip: '10.0.5.1', viaProtocol: 'LLDP', snmpReachable: false },      // neighbor
    { ip: '10.0.5.2', viaProtocol: 'CDP', snmpReachable: false },       // neighbor
    { ip: '10.0.20.2', snmpReachable: false, alive: true },             // declared (driver sotto)
    { ip: '10.0.20.7', snmpReachable: true },                           // ha risposto
    { ip: '10.0.20.50', alive: true },                                  // nessuna autorità
  ];
  const driverOf = (r) => (r.ip === '10.0.20.2' ? 'snmp-v2c' : '');
  assert.equal(countSnmpSilent(rows, driverOf), 3);
  assert.equal(countSnmpSilent(rows), 2, 'senza il driver documentato restano i due dichiarati dai vicini');
  assert.equal(countSnmpSilent(null), 0);
});
