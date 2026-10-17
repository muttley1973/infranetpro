'use strict';
// ============================================================
// IDENTITÀ DI UNA VM — «questa macchina è già documentata come VM di un host?»
// ============================================================
// Il caso vero (progetto 24, 17/10): UNL e ESKO-LIC-22 erano GIÀ VM di un host, ma Scopri cercava
// «esiste già?» solo fra i nodi e le porte, non dentro `node.vms[]`: la riproponeva come «Nuovo», l'import
// creava un tile e l'IPAM accusava lo stesso IP su due apparati. Questa è la parte PURA della risposta
// (lib/vm-nics.js); chi la usa — Scopri, il crawl, l'adozione dalla Verifica, l'assorbimento — è provato
// a parte (test/discovery-vm-known.test.js, e2e).
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildVmIdentityIndex, findVmByIdentity } = require('../lib/vm-nics.js');
const { addrKey } = require('../lib/cidr.js');

// Le chiavi che il browser ha come globali (`addrKey` di lib/cidr.js): nei test si iniettano.
const KEYS = { addr: addrKey };

const hostA = {
  id: 'lab', name: 'MacPro5,1', vms: [
    { id: 'v1', name: 'UNL', nics: [{ id: 'nic1', ip: '192.168.1.234', mac: '50:23:5F:00:2B:00' }] },
    { id: 'v2', name: 'Firewall', nics: [
      { id: 'nic1', ip: '10.0.0.1', mac: 'AA:BB:CC:00:00:01' },
      { id: 'nic2', ip: '172.16.0.1', ip6: '2001:DB8:0:20:0:0:0:1', mac: 'AA:BB:CC:00:00:02' },
    ] },
  ],
};
const hostB = {
  id: 'nas', name: 'Sinology', vms: [
    { id: 'v3', name: 'ESKO-LIC-22', nics: [{ id: 'nic1', ip: '192.168.1.192', mac: '02:11:32:2D:28:2B' }] },
  ],
};
const idx = () => buildVmIdentityIndex([hostA, hostB, { id: 'sw', name: 'Switch' }], KEYS);
const find = (probe, opts) => findVmByIdentity(idx(), probe, opts);

test('per MAC: stessa macchina in qualunque scrittura del MAC', () => {
  for (const mac of ['50:23:5F:00:2B:00', '50:23:5f:00:2b:00', '50-23-5F-00-2B-00', '50235F002B00', '5023.5F00.2B00']) {
    const hit = find({ mac });
    assert.ok(hit, mac + ' deve trovare la VM');
    assert.equal(hit.vm.id, 'v1');
    assert.equal(hit.host.id, 'lab', 'dice anche su quale host sta');
    assert.equal(hit.by, 'mac');
  }
});

test('una VM con più schede si trova da QUALUNQUE delle sue schede (MAC e IP)', () => {
  assert.equal(find({ mac: 'aa:bb:cc:00:00:02' }).vm.id, 'v2', 'MAC della seconda scheda');
  assert.equal(find({ ips: ['172.16.0.1'] }).vm.id, 'v2', 'IP della seconda scheda');
  assert.equal(find({ ips: ['2001:db8:0:20::1'] }).vm.id, 'v2', 'IPv6 della seconda scheda, scritto in un\'altra forma');
});

test('per IP: la stessa scrittura dell\'indirizzo non conta, la chiave sì (zeri iniziali, IPv6 canonico)', () => {
  assert.equal(find({ ips: ['192.168.001.234'] }).vm.id, 'v1', 'IPv4 con zeri iniziali = lo stesso indirizzo');
  assert.equal(find({ ips: ['2001:DB8:0:20::1'] }).by, 'ip', 'IPv6 abbreviato = lo stesso indirizzo');
  assert.equal(find({ ips: ['2001:DB8::1'] }), null, 'un altro IPv6 (zeri diversi) non combacia');
  assert.equal(find({ ips: ['192.168.1.2340'] }), null, 'un indirizzo diverso non combacia per prefisso di stringa');
});

test('per IP: un MAC che CONTRADDICE la VM vuol dire un\'altra macchina, non la stessa', () => {
  // Stesso IP, MAC diverso da quelli della VM: IP riusato (o apparato sostituito). Non si fonde: è proprio
  // il caso che l'audit IPAM deve poter segnalare come conflitto vero.
  assert.equal(find({ mac: '11:22:33:44:55:66', ips: ['192.168.1.234'] }), null);
  // Senza MAC da una parte (cross-subnet: l'ARP non attraversa il router), l'IP basta.
  assert.equal(find({ ips: ['192.168.1.234'] }).vm.id, 'v1');
  // E se è la VM a non avere MAC, il MAC della riga non la contraddice.
  const senzaMac = buildVmIdentityIndex([{ id: 'h', vms: [{ id: 'x', name: 'x', nics: [{ id: 'nic1', ip: '10.9.9.9' }] }] }], KEYS);
  assert.equal(findVmByIdentity(senzaMac, { mac: '11:22:33:44:55:66', ips: ['10.9.9.9'] }).vm.id, 'x');
});

test('per nome: uguale senza badare alle maiuscole, e solo se il MAC non lo smentisce', () => {
  assert.equal(find({ name: 'unl' }).vm.id, 'v1');
  assert.equal(find({ name: 'unl' }).by, 'name');
  assert.equal(find({ name: 'UNL', mac: '11:22:33:44:55:66' }), null, 'stesso nome ma MAC diverso: un\'altra macchina');
  assert.equal(find({ name: 'UN' }), null, 'il nome si confronta intero');
  assert.equal(find({ ips: ['10.250.250.250'] }), null);
});

test('il nome non si usa se la riga non lo porta (l\'assorbimento cerca per identità di rete, non per nome)', () => {
  assert.equal(find({ mac: '', ips: [] }), null);
  assert.equal(find({}), null);
});

test('ordine: il MAC batte il nome e l\'IP', () => {
  // La riga ha il MAC di v3 ma il nome e l'IP di v1: è v3.
  const hit = find({ mac: '02:11:32:2D:28:2B', name: 'UNL', ips: ['192.168.1.234'] });
  assert.equal(hit.vm.id, 'v3');
  assert.equal(hit.by, 'mac');
});

test('lo stesso nome su due host: sceglie la VM che NON contraddice il MAC', () => {
  const dup = buildVmIdentityIndex([
    { id: 'h1', vms: [{ id: 'a', name: 'web', nics: [{ id: 'nic1', mac: 'AA:AA:AA:00:00:01' }] }] },
    { id: 'h2', vms: [{ id: 'b', name: 'web', nics: [{ id: 'nic1', mac: 'AA:AA:AA:00:00:02' }] }] },
  ], KEYS);
  assert.equal(findVmByIdentity(dup, { name: 'web', mac: 'aa:aa:aa:00:00:02' }).vm.id, 'b', 'per MAC prima di tutto');
  assert.equal(findVmByIdentity(dup, { name: 'web', mac: 'aa:aa:aa:00:00:99' }), null, 'nessuna delle due: MAC di un\'altra macchina');
});

test('un MAC bloccato (next-hop: gateway, VRRP) vale come assente', () => {
  // Il MAC di un gateway compare nell'ARP degli host che stanno dietro: non identifica la riga.
  const blocked = (k) => k === 'aa:bb:cc:00:00:01';
  assert.equal(find({ mac: 'AA:BB:CC:00:00:01' }, { ignoreMac: blocked }), null, 'MAC bloccato: nessun match per MAC');
  assert.equal(find({ mac: 'AA:BB:CC:00:00:01', ips: ['10.0.0.1'] }, { ignoreMac: blocked }).vm.id, 'v2', 'ma l\'IP ripiega, senza essere smentito dal MAC');
  assert.equal(find({ mac: 'AA:BB:CC:00:00:01' }).vm.id, 'v2', 'senza il blocco il MAC identifica');
});

test('una chiave vuota non combacia mai con un\'altra chiave vuota', () => {
  // VM senza MAC né IP, riga senza MAC né IP: «entrambi vuoti» non è un'identità.
  const vuota = buildVmIdentityIndex([{ id: 'h', vms: [{ id: 'z', name: '', nics: [{ id: 'nic1' }] }, { id: 'y' }] }], KEYS);
  assert.equal(findVmByIdentity(vuota, { mac: '', name: '', ips: ['', '  ', null] }), null);
  assert.equal(findVmByIdentity(vuota, { mac: 'non un mac', ips: ['non un ip'] }), null);
});

test('le VM col vecchio record piatto (senza nics[]) si trovano lo stesso', () => {
  const vecchio = buildVmIdentityIndex([{ id: 'h', vms: [{ id: 'old', name: 'old', ip: '10.1.1.1', mac: '00:11:22:33:44:55' }] }], KEYS);
  assert.equal(findVmByIdentity(vecchio, { mac: '001122334455' }).vm.id, 'old');
  assert.equal(findVmByIdentity(vecchio, { ips: ['10.1.1.1'] }).vm.id, 'old');
});

test('ingressi sbagliati non lanciano e non trovano niente', () => {
  for (const nodes of [null, undefined, 'x', 5, {}, [null, undefined, 3, { id: 'h', vms: 'no' }, { id: 'h2', vms: [null, 7] }]]) {
    const i = buildVmIdentityIndex(nodes, KEYS);
    assert.equal(findVmByIdentity(i, { mac: 'AA:BB:CC:00:00:01', ips: ['10.0.0.1'], name: 'x' }), null);
  }
  assert.equal(findVmByIdentity(null, { mac: 'AA:BB:CC:00:00:01' }), null);
  assert.equal(findVmByIdentity(undefined, undefined), null);
  assert.equal(findVmByIdentity({}, { mac: 'AA:BB:CC:00:00:01' }), null, 'un indice che non è un indice non trova niente');
});

test('non muta i nodi: sola lettura', () => {
  const nodes = JSON.parse(JSON.stringify([hostA, hostB]));
  const before = JSON.stringify(nodes);
  const i = buildVmIdentityIndex(nodes, KEYS);
  findVmByIdentity(i, { mac: '50:23:5F:00:2B:00', ips: ['192.168.1.234'], name: 'UNL' });
  assert.equal(JSON.stringify(nodes), before);
});

test('senza chiavi iniettate funziona lo stesso (MAC canonico, indirizzo in minuscolo)', () => {
  const i = buildVmIdentityIndex([hostA]);
  assert.equal(findVmByIdentity(i, { mac: '5023.5F00.2B00' }).vm.id, 'v1');
  assert.equal(findVmByIdentity(i, { ips: ['192.168.1.234'] }).vm.id, 'v1');
});
