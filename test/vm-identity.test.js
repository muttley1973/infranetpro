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
const idx = () => buildVmIdentityIndex([hostA, hostB, { id: 'sw', name: 'Switch' }]);
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
  const senzaMac = buildVmIdentityIndex([{ id: 'h', vms: [{ id: 'x', name: 'x', nics: [{ id: 'nic1', ip: '10.9.9.9' }] }] }]);
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
  ]);
  assert.equal(findVmByIdentity(dup, { name: 'web', mac: 'aa:aa:aa:00:00:02' }).vm.id, 'b', 'per MAC prima di tutto');
  assert.equal(findVmByIdentity(dup, { name: 'web', mac: 'aa:aa:aa:00:00:99' }), null, 'nessuna delle due: MAC di un\'altra macchina');
});

test('un MAC di next-hop (gateway, VRRP) lo toglie dalla riga chi lo sa: senza MAC si ripiega sull\'IP', () => {
  // Il MAC di un gateway compare nell'ARP degli host che stanno dietro: non identifica la riga. Chi lo sa (Scopri, con le
  // guardie next-hop) lo toglie PRIMA di chiedere; qui si prova che, tolto, la VM si trova ancora dal suo indirizzo —
  // senza essere smentita dal MAC che non c'e' piu' — e che senza il blocco il MAC identifica.
  assert.equal(find({ mac: '', ips: ['10.0.0.9'] }), null, 'senza MAC e con un indirizzo che non e\' suo: niente');
  assert.equal(find({ mac: '', ips: ['10.0.0.1'] }).vm.id, 'v2', 'senza MAC, l\'IP della VM la trova');
  assert.equal(find({ mac: 'AA:BB:CC:00:00:01' }).vm.id, 'v2', 'col MAC (non bloccato) identifica');
});

test('una chiave vuota non combacia mai con un\'altra chiave vuota', () => {
  // VM senza MAC né IP, riga senza MAC né IP: «entrambi vuoti» non è un'identità.
  const vuota = buildVmIdentityIndex([{ id: 'h', vms: [{ id: 'z', name: '', nics: [{ id: 'nic1' }] }, { id: 'y' }] }]);
  assert.equal(findVmByIdentity(vuota, { mac: '', name: '', ips: ['', '  ', null] }), null);
  assert.equal(findVmByIdentity(vuota, { mac: 'non un mac', ips: ['non un ip'] }), null);
});

test('le VM col vecchio record piatto (senza nics[]) si trovano lo stesso', () => {
  const vecchio = buildVmIdentityIndex([{ id: 'h', vms: [{ id: 'old', name: 'old', ip: '10.1.1.1', mac: '00:11:22:33:44:55' }] }]);
  assert.equal(findVmByIdentity(vecchio, { mac: '001122334455' }).vm.id, 'old');
  assert.equal(findVmByIdentity(vecchio, { ips: ['10.1.1.1'] }).vm.id, 'old');
});

test('ingressi sbagliati non lanciano e non trovano niente', () => {
  for (const nodes of [null, undefined, 'x', 5, {}, [null, undefined, 3, { id: 'h', vms: 'no' }, { id: 'h2', vms: [null, 7] }]]) {
    const i = buildVmIdentityIndex(nodes);
    assert.equal(findVmByIdentity(i, { mac: 'AA:BB:CC:00:00:01', ips: ['10.0.0.1'], name: 'x' }), null);
  }
  assert.equal(findVmByIdentity(null, { mac: 'AA:BB:CC:00:00:01' }), null);
  assert.equal(findVmByIdentity(undefined, undefined), null);
  assert.equal(findVmByIdentity({}, { mac: 'AA:BB:CC:00:00:01' }), null, 'un indice che non è un indice non trova niente');
});

test('non muta i nodi: sola lettura', () => {
  const nodes = JSON.parse(JSON.stringify([hostA, hostB]));
  const before = JSON.stringify(nodes);
  const i = buildVmIdentityIndex(nodes);
  findVmByIdentity(i, { mac: '50:23:5F:00:2B:00', ips: ['192.168.1.234'], name: 'UNL' });
  assert.equal(JSON.stringify(nodes), before);
});

test('le chiavi sono quelle delle lib del progetto (macKey, addrKey): nessuna copia, anche in Node', () => {
  const i = buildVmIdentityIndex([hostA]);
  const { macKey } = require('../lib/mac-class.js');
  const { addrKey } = require('../lib/cidr.js');
  assert.deepEqual([typeof i.keys.mac, typeof i.keys.addr], ['function', 'function'], 'le chiavi stanno sull\'indice');
  for (const raw of ['5023.5F00.2B00', '50-23-5f-00-2b-00', '50235F002B00', 'non un mac', '']) {
    assert.equal(i.keys.mac(raw), macKey(raw), 'MAC «' + raw + '»: la stessa chiave di lib/mac-class.js');
  }
  for (const raw of ['192.168.001.234', '2001:DB8:0:20:0:0:0:1', '2001:db8:0:20::1', 'fe80::1', 'non un ip']) {
    assert.equal(i.keys.addr(raw), addrKey(raw), 'indirizzo «' + raw + '»: la stessa chiave di lib/cidr.js');
  }
  // e in Node, senza globali, un IPv6 in un'altra scrittura e' lo stesso indirizzo (il ripiego toLowerCase() non lo capiva)
  assert.equal(findVmByIdentity(i, { ips: ['2001:db8:0:20::1'] }).vm.id, 'v2');
  assert.equal(findVmByIdentity(i, { mac: '5023.5F00.2B00' }).vm.id, 'v1');
});

// ── UNA funzione per tutti: findVmForRow prende la RIGA intera ────────────────────────────────────────────
const { probeOfRow, findVmForRow } = require('../lib/vm-nics.js');

// VM che il documento conosce per nome o per indirizzo, senza MAC (il caso di B1) — e una con solo il nome.
const hostC = {
  id: 'pve', name: 'PVE', vms: [
    { id: 'dc', name: 'dc01', nics: [{ id: 'nic1', ip: '10.0.0.5' }] },                // solo IP (e nome)
    { id: 'solo', name: 'plex', nics: [] },                                            // solo il nome
    { id: 'cidr', name: 'gw', nics: [{ id: 'nic1', ip: '10.0.1.1/24' }] },             // IP scritto con la lunghezza del prefisso
    { id: 'mgmt', name: 'monitor', nics: [{ id: 'nic1', ip: '10.0.2.10' }] },
  ],
};
const rowFind = (row, opts) => findVmForRow(buildVmIdentityIndex([hostC]), row, opts);

test('probeOfRow: ricava MAC, nomi e indirizzi dalla riga intera, qualunque ne sia la forma', () => {
  const p = probeOfRow({ mac: ' AA:BB:CC:00:00:01 ', hostname: 'H', netbiosName: 'N', name: 'Nome', ip: '10.0.0.5', ip6: '2001:db8::1', currentIp: '10.0.0.6', integration: { host: '10.0.0.7' } });
  assert.equal(p.mac, 'AA:BB:CC:00:00:01');
  assert.deepEqual(p.names, ['H', 'N', 'Nome']);
  assert.deepEqual(p.ips, ['10.0.0.5', '2001:db8::1', '10.0.0.6', '10.0.0.7']);
  assert.deepEqual(probeOfRow(null), { mac: '', names: [], ips: [] });
  assert.deepEqual(probeOfRow({ ip: null, integration: 'x' }), { mac: '', names: [], ips: [] });
});

test('una VM con IP e senza MAC si riconosce dalla riga: per IP, per hostname, per integration.host', () => {
  assert.equal(rowFind({ mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5', hostname: 'dc01' }).vm.id, 'dc', 'MAC sconosciuto alla VM ma la VM non ne ha: non la smentisce');
  assert.equal(rowFind({ mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5' }).by, 'ip');
  assert.equal(rowFind({ integration: { host: '10.0.0.5' } }).vm.id, 'dc', 'l\'host di gestione SNMP della riga conta come indirizzo');
  assert.equal(rowFind({ netbiosName: 'DC01' }).vm.id, 'dc', 'anche il nome NetBIOS');
});

test('solo per NOME: il match c\'è se niente lo smentisce, ma è «debole»; un indirizzo che non è il suo lo smentisce', () => {
  const solo = rowFind({ hostname: 'plex', ip: '10.0.9.9' });
  assert.equal(solo.vm.id, 'solo', 'la VM non ha indirizzi da confrontare: il nome è l\'unica identità che ha');
  assert.equal(solo.by, 'name');
  assert.equal(solo.weak, true, 'nessun MAC o indirizzo lo conferma');
  // Il server fisico «dc01» con un altro indirizzo NON è la VM «dc01» (che ha 10.0.0.5): non lo si scarta come già documentato.
  assert.equal(rowFind({ hostname: 'dc01', ip: '10.0.0.77', mac: 'AA:BB:CC:DD:EE:77' }), null);
  // Con l'indirizzo giusto il nome è CONFERMATO, non debole.
  const ok = rowFind({ hostname: 'dc01', ip: '10.0.0.5' });
  assert.equal(ok.vm.id, 'dc');
  assert.equal(ok.weak, false);
  // Nome senza indirizzo (un nome mDNS): niente lo smentisce, ma niente lo conferma.
  assert.equal(rowFind({ hostname: 'dc01' }).weak, true);
});

test('un IP scritto con la lunghezza del prefisso (10.0.1.1/24) è lo stesso indirizzo, da una parte e dall\'altra', () => {
  assert.equal(rowFind({ ip: '10.0.1.1' }).vm.id, 'cidr', 'vNIC con /24, riga senza');
  assert.equal(rowFind({ ip: '10.0.1.1/24' }).vm.id, 'cidr', 'e riga con /24');
  assert.equal(rowFind({ ip: '10.0.1.2' }), null, 'un altro indirizzo non combacia');
});

test('only:\'mac\' cerca solo per MAC (il primo passo di chi poi guarda i nodi)', () => {
  const i = buildVmIdentityIndex([hostA, hostB]);
  assert.equal(findVmForRow(i, { mac: '50:23:5F:00:2B:00', ip: '1.1.1.1' }, { only: 'mac' }).vm.id, 'v1');
  assert.equal(findVmForRow(i, { ip: '192.168.1.234', hostname: 'UNL' }, { only: 'mac' }), null, 'IP e nome non contano in questo passo');
});

test('più nomi sulla riga: basta uno; il nome si confronta intero e senza badare alle maiuscole', () => {
  assert.equal(rowFind({ hostname: 'altro', name: 'PLEX' }).vm.id, 'solo');
  assert.equal(rowFind({ hostname: 'ple' }), null);
});
