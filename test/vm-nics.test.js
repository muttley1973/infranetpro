'use strict';
// Unit puri di lib/vm-nics.js — le interfacce di rete virtuali di una VM.
// Il cuore da difendere è la LETTURA TOLLERANTE: un progetto salvato prima
// della 78ª ha i campi piatti (vm.ip/mac/vlan) e deve continuare a essere letto
// identico da tutti i motori, senza che nessuno di loro sappia che esistono due
// forme.
const test = require('node:test');
const assert = require('node:assert');
const {
  vmNics, vmPrimaryNic, vmPrimaryIp, vmMacs, vmIps, vmIp6s, vmVlanValues,
  migrateVmNics, nextVmNicId,
} = require('../lib/vm-nics.js');

test('vm-nics: VM senza dati di rete → nessuna vNIC inventata', () => {
  assert.deepStrictEqual(vmNics({ id: 'vm1', name: 'dc01' }), []);
  assert.deepStrictEqual(vmNics(null), []);
  assert.strictEqual(vmPrimaryNic({ id: 'vm1' }), null);
  assert.strictEqual(vmPrimaryIp({ id: 'vm1' }), '');
});

test('vm-nics: campi piatti (progetto vecchio) → una vNIC implicita', () => {
  const vm = { id: 'vm1', ip: '192.168.1.10', mac: 'AA:BB:CC:DD:EE:01', vlan: '20' };
  const nics = vmNics(vm);
  assert.strictEqual(nics.length, 1);
  assert.strictEqual(nics[0].id, 'nic1');
  assert.strictEqual(nics[0].ip, '192.168.1.10');
  assert.strictEqual(nics[0].vlan, '20');
  // Il modello NON viene toccato dalla lettura (la lib è pura).
  assert.strictEqual(vm.nics, undefined);
});

test('vm-nics: basta UN campo piatto per la vNIC implicita (solo MAC)', () => {
  const nics = vmNics({ id: 'vm1', mac: 'AA:BB:CC:DD:EE:01' });
  assert.strictEqual(nics.length, 1);
  assert.strictEqual(nics[0].mac, 'AA:BB:CC:DD:EE:01');
  assert.strictEqual(nics[0].ip, undefined);   // ciò che manca resta assente
});

test('vm-nics: nics[] esplicito vince e i campi piatti residui vengono ignorati', () => {
  const vm = {
    id: 'vm1', ip: '10.0.0.9',                       // residuo non migrato
    nics: [{ id: 'nic1', name: 'LAN', ip: '192.168.1.10' }],
  };
  const nics = vmNics(vm);
  assert.strictEqual(nics.length, 1);
  assert.strictEqual(nics[0].ip, '192.168.1.10');    // mai la miscela delle due forme
});

test('vm-nics: nics[] vuoto = dichiarazione esplicita di "nessuna scheda"', () => {
  // Diverso da nics assente: qui l'utente ha cancellato l'ultima vNIC e i campi
  // piatti non devono resuscitare.
  assert.deepStrictEqual(vmNics({ id: 'vm1', nics: [], ip: '10.0.0.9' }), []);
});

test('vm-nics: id mancante o voce sporca → id posizionale, voce non-oggetto scartata', () => {
  const nics = vmNics({ id: 'vm1', nics: [{ ip: '10.0.0.1' }, null, 'x', { id: '', ip: '10.0.0.2' }] });
  assert.deepStrictEqual(nics.map(n => n.id), ['nic1', 'nic4']);
});

test('vm-nics: firewall virtuale a 3 gambe — tutti gli agganci vedono tutto', () => {
  const vm = { id: 'vm1', name: 'opnsense', nics: [
    { id: 'nic1', name: 'WAN', vlan: '10', ip: '10.0.0.1',   mac: 'AA:BB:CC:00:00:01' },
    { id: 'nic2', name: 'LAN', vlan: '20', ip: '192.168.1.1', mac: 'AA:BB:CC:00:00:02' },
    { id: 'nic3', name: 'DMZ', vlan: '30', ip: '172.16.0.1',  mac: 'AA:BB:CC:00:00:03', ip6: '2001:db8::1' },
  ] };
  assert.deepStrictEqual(vmVlanValues(vm), ['10', '20', '30']);
  assert.strictEqual(vmMacs(vm).length, 3);
  assert.deepStrictEqual(vmIps(vm).map(x => x.ip), ['10.0.0.1', '192.168.1.1', '172.16.0.1']);
  assert.deepStrictEqual(vmIp6s(vm).map(x => x.ip6), ['2001:db8::1']);
  assert.strictEqual(vmPrimaryIp(vm), '10.0.0.1');
  assert.strictEqual(vmPrimaryNic(vm).name, 'WAN');
});

test('vm-nics: la prima vNIC senza IP non blocca vmPrimaryIp', () => {
  // Caso reale: una scheda "heartbeat"/cluster senza IP dichiarato in cima alla
  // lista. L'host da interrogare via SNMP deve comunque essere trovato.
  const vm = { nics: [{ id: 'nic1', name: 'HB', mac: 'AA:BB:CC:00:00:09' }, { id: 'nic2', ip: '192.168.1.10' }] };
  assert.strictEqual(vmPrimaryIp(vm), '192.168.1.10');
});

test('vm-nics: MAC duplicati deduplicati case-insensitive', () => {
  const vm = { nics: [{ id: 'nic1', mac: 'aa:bb:cc:00:00:01' }, { id: 'nic2', mac: 'AA:BB:CC:00:00:01' }] };
  assert.deepStrictEqual(vmMacs(vm), ['aa:bb:cc:00:00:01']);
});

test('vm-nics: chiavi fuori catalogo non entrano (import ostile)', () => {
  const nics = vmNics({ nics: [{ id: 'nic1', ip: '10.0.0.1', community: 'segreto', linkState: 'up' }] });
  assert.strictEqual(nics[0].community, undefined);
  assert.strictEqual(nics[0].linkState, undefined);
});

test('vm-nics: migrateVmNics è pura e non ri-migra chi è già migrato', () => {
  const vm = { id: 'vm1', ip: '192.168.1.10', vlan: '20' };
  const nics = migrateVmNics(vm);
  assert.strictEqual(nics.length, 1);
  assert.strictEqual(vm.nics, undefined);                          // non muta
  assert.strictEqual(migrateVmNics({ id: 'v', nics: [] }), null);   // già in forma nuova
  assert.strictEqual(migrateVmNics({ id: 'v' }), null);             // niente da migrare
});

test('vm-nics: nextVmNicId riempie i buchi lasciati da una cancellazione', () => {
  assert.strictEqual(nextVmNicId({ nics: [] }), 'nic1');
  assert.strictEqual(nextVmNicId({ nics: [{ id: 'nic1' }, { id: 'nic2' }] }), 'nic3');
  assert.strictEqual(nextVmNicId({ nics: [{ id: 'nic1' }, { id: 'nic3' }] }), 'nic2');
});

test('vm-nics: spazi attorno ai valori normalizzati in lettura', () => {
  const nics = vmNics({ nics: [{ id: ' nic1 ', ip: '  192.168.1.10 ', name: '  LAN ' }] });
  assert.strictEqual(nics[0].id, 'nic1');
  assert.strictEqual(nics[0].ip, '192.168.1.10');
  assert.strictEqual(nics[0].name, 'LAN');
});
