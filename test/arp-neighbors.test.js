'use strict';
// Lettura ARP "state-aware" su Windows: _readArpMap usa `netsh interface ipv4 show
// neighbors` (che ha lo STATO) e _parseNeighbors tiene SOLO le voci con un MAC valido.
// Le voci "Non raggiungibile"/"Incompleto" hanno la colonna indirizzo-fisico con lo
// STATO (non un MAC) -> escluse senza matchare stringhe localizzate. Cosi' l'ARP-
// autorevole non marca piu' "Osservato" gli IP morti che `arp -a` trascina col MAC
// stantio. + _demoteStaleArpDup declassa i duplicati ARP (stesso MAC vivo/DHCP altrove).
const test = require('node:test');
const assert = require('node:assert/strict');
const { _parseNeighbors, _demoteStaleArpDup } = require('../server/netscan.js');

// Output reale di netsh su Windows italiano (colonna fisica = MAC se risolto, altrimenti
// riporta lo stato localizzato).
const NETSH_IT = `
Interfaccia 12: Ethernet

Indirizzo Internet                            Indirizzo fisico   Tipo
--------------------------------------------  -----------------  -----------
192.168.1.1                                   d4-1a-d1-82-11-20  Raggiungibile
192.168.1.2                                   Non raggiungibile  Non raggiungibile
192.168.1.100                                 00-04-4b-b4-b0-d4  Aggiornato
192.168.1.141                                 Non raggiungibile  Non raggiungibile
192.168.1.255                                 ff-ff-ff-ff-ff-ff  Permanente
224.0.0.22                                    01-00-5e-00-00-16  Permanente
`;

const NETSH_EN = `
Internet Address                              Physical Address   Type
--------------------------------------------  -----------------  -----------
192.168.1.1                                   d4-1a-d1-82-11-20  Reachable
192.168.1.2                                   Unreachable        Unreachable
192.168.1.50                                  e8-06-88-cb-f4-1f  Stale
`;

test('_parseNeighbors: tiene solo le voci con MAC (Reachable/Stale), scarta le Unreachable', () => {
  const m = _parseNeighbors(NETSH_IT);
  assert.equal(m.get('192.168.1.1'), 'D4:1A:D1:82:11:20', 'Raggiungibile col MAC -> tenuta');
  assert.equal(m.get('192.168.1.100'), '00:04:4B:B4:B0:D4', 'Aggiornato/Stale col MAC -> tenuta');
  assert.equal(m.has('192.168.1.2'), false, 'Non raggiungibile (MAC vuoto) -> scartata');
  assert.equal(m.has('192.168.1.141'), false, 'il fantasma .141 senza MAC -> scartato');
  assert.equal(m.has('192.168.1.255'), false, 'broadcast ff:ff -> scartato');
  assert.equal(m.has('224.0.0.22'), false, 'IP multicast -> scartato');
});

test('_parseNeighbors: funziona in inglese (Unreachable) — nessun match di stato localizzato', () => {
  const m = _parseNeighbors(NETSH_EN);
  assert.equal(m.get('192.168.1.1'), 'D4:1A:D1:82:11:20');
  assert.equal(m.get('192.168.1.50'), 'E8:06:88:CB:F4:1F', 'Stale col MAC -> tenuta');
  assert.equal(m.has('192.168.1.2'), false, 'Unreachable -> scartata');
});

test('_parseNeighbors: robusto a qualsiasi lingua (matcha il MAC, non lo stato)', () => {
  // Stato in una lingua qualsiasi: conta solo la presenza del MAC.
  const de = `10.0.0.5   a0-b1-c2-d3-e4-f5   Erreichbar\n10.0.0.6   Nicht erreichbar   Nicht erreichbar`;
  const m = _parseNeighbors(de);
  assert.equal(m.get('10.0.0.5'), 'A0:B1:C2:D3:E4:F5');
  assert.equal(m.has('10.0.0.6'), false);
});

test('_parseNeighbors: input vuoto/garbage -> mappa vuota', () => {
  assert.equal(_parseNeighbors('').size, 0);
  assert.equal(_parseNeighbors(null).size, 0);
  assert.equal(_parseNeighbors('nessun ip qui\n---').size, 0);
});

test('_demoteStaleArpDup: declassa il duplicato ARP il cui MAC e\' vivo (ping/snmp) altrove', () => {
  const rows = [
    { ip: '192.168.1.10', mac: 'AA:BB:CC:00:00:01', pingReachable: true, snmpReachable: false, alive: true, status: 'On' },
    { ip: '192.168.1.141', mac: 'AA:BB:CC:00:00:01', viaArp: true, pingReachable: false, snmpReachable: false, alive: true, status: 'On' },
  ];
  const demoted = _demoteStaleArpDup(rows, null);
  assert.deepEqual(demoted, ['192.168.1.141']);
  assert.equal(rows[1].alive, false, 'il duplicato ARP torna non-vivo');
  assert.equal(rows[1].status, 'Inattivo');
  assert.equal(rows[1].staleArpDup, true);
  assert.equal(rows[0].alive, true, 'la riga viva vera resta intatta');
});

test('_demoteStaleArpDup: declassa anche se il MAC e\' in un lease DHCP a un altro IP', () => {
  const rows = [
    { ip: '192.168.1.141', mac: '50:23:5F:00:2B:00', viaArp: true, pingReachable: false, snmpReachable: false, alive: true },
  ];
  const dhcpStrong = new Map([['50:23:5F:00:2B:00', '192.168.1.235']]);
  const demoted = _demoteStaleArpDup(rows, dhcpStrong);
  assert.deepEqual(demoted, ['192.168.1.141'], '.141 e\' stantio: il device e\' a .235 via DHCP');
  assert.equal(rows[0].alive, false);
});

test('_demoteStaleArpDup: NON tocca una riga ARP se il MAC non e\' forte altrove, o e\' lo stesso IP', () => {
  const rows = [
    { ip: '192.168.1.77', mac: 'DE:AD:BE:EF:00:01', viaArp: true, pingReachable: false, snmpReachable: false, alive: true },  // nessun forte -> resta
    { ip: '192.168.1.88', mac: 'DE:AD:BE:EF:00:02', pingReachable: true, alive: true },                                         // forte a se stesso
    { ip: '192.168.1.88', mac: 'DE:AD:BE:EF:00:02', viaArp: true, pingReachable: false, snmpReachable: false, alive: true },   // stesso IP -> non e' un duplicato
  ];
  const demoted = _demoteStaleArpDup(rows, null);
  assert.equal(demoted.length, 0, 'nessun declassamento');
  assert.equal(rows[0].alive, true, 'ARP osservato legittimo resta vivo');
});
