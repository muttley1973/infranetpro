'use strict';
// Il filtro dei RUOLI del catalogo CC0 (tools/import-device-types.js → roleOf): quali modelli della libreria NetBox
// entrano nel catalogo in uso e quali restano fuori. Le prove usano modelli INVENTATI (marchio «Acme»): il
// canonico vero pesa 45 MB, è fuori da git e nella CI non c'è. La misura sul catalogo vero (12.757 modelli) sta
// nel messaggio del commit, non qui.
//
// Cosa fissano:
//   · un punto di accesso di famiglia nuova ha UNA porta cablata e un nome senza parole di classe («U6 Lite»):
//     si riconosce dalle DUE radio, non dal nome;
//   · una radio sola non basta (Apple TV, Raspberry Pi, telecamera Wi-Fi): serve anche una parola di classe;
//   · le parole che scartano per nome (telecamera, stampante…) battono la radio: stanno PRIMA nel filtro;
//   · «voip» scarta con meno di 3 porte dati (un telefono), non un router con 7 porte che parla VoIP;
//   · un apparato già tenuto non cambia RUOLO (un router Wi-Fi con 4 porte resta «network», non diventa «ap»).
const test = require('node:test');
const assert = require('node:assert/strict');
const { roleOf, buildTemplate } = require('../tools/import-device-types.js');

const GE = n => Array.from({ length: n }, (_, i) => ({ name: 'eth' + i, type: '1000base-t' }));
const RADIO = (n, type) => Array.from({ length: n }, (_, i) => ({ name: 'wlan' + i, type: type || 'ieee802.11ax' }));

function role(model, interfaces, extra) {
  const dt = Object.assign({ slug: 'acme-x', manufacturer: 'Acme', model, interfaces }, extra || {});
  const r = roleOf(dt, buildTemplate(dt).counts);
  return r.role + (r.keep ? '' : '!');   // «!» = scartato
}

test('roleOf: due radio e una porta cablata = punto di accesso, anche se il nome non lo dice', () => {
  assert.equal(role('U6 Lite', GE(1).concat(RADIO(2))), 'ap');
  assert.equal(role('FlexHD', GE(1).concat(RADIO(2, 'ieee802.11ac'))), 'ap');
  assert.equal(role('Pro Max', GE(1).concat(RADIO(5))), 'ap');
});

test('roleOf: UNA radio non basta: Apple TV, Raspberry Pi e telecamere Wi-Fi restano fuori', () => {
  assert.equal(role('TV 4K', GE(1).concat(RADIO(1))), 'other!');
  assert.equal(role('Board 5', GE(1).concat(RADIO(1))), 'other!');
  assert.equal(role('IPC2122LB-WF', GE(1).concat(RADIO(1, 'ieee802.11ac'))), 'other!');
});

test('roleOf: una radio con una parola di CLASSE nel nome è un AP, un ripetitore, un extender', () => {
  assert.equal(role('Repeater 1200', GE(1).concat(RADIO(1, 'ieee802.11ac'))), 'ap');
  assert.equal(role('cAP ax', GE(1).concat(RADIO(1))), 'ap');
  assert.equal(role('wAP 60G', GE(1).concat(RADIO(1))), 'ap');
  assert.equal(role('DAP-1360', GE(1).concat(RADIO(1, 'ieee802.11n'))), 'ap');
  assert.equal(role('RBLtAP-2HnD', GE(1).concat(RADIO(1, 'ieee802.11n'))), 'ap');
  assert.equal(role('Building Bridge', GE(1).concat(RADIO(1, 'ieee802.11ac'))), 'ap');
});

test('roleOf: un modem cellulare conta come radio, ma serve comunque la parola di classe', () => {
  const lte = [{ name: 'mob1', type: 'lte' }];
  assert.equal(role('FortiExtender 40D', GE(1).concat(lte)), 'ap', 'extender + modem cellulare');
  assert.equal(role('IPC-B120-4G', GE(1).concat(lte)), 'other!', 'una telecamera 4G non è un AP');
  assert.equal(role('TRB140', GE(1).concat(lte)), 'other!', 'senza parola di classe resta fuori: limite noto, non lo si indovina');
});

test('roleOf: le parole che scartano per nome battono la radio (stanno PRIMA nel filtro)', () => {
  assert.equal(role('Duo Camera PoE', GE(1).concat(RADIO(2))), 'endpoint!');
  assert.equal(role('Color Printer X', GE(1).concat(RADIO(2))), 'endpoint!');
});

test('roleOf: senza porta cablata, o con la porta ma senza radio, non si recupera niente', () => {
  assert.equal(role('Radio Solo', RADIO(2)), 'other!');
  assert.equal(role('Sensore', GE(1)), 'other!');
});

test('roleOf: chi è già tenuto non cambia ruolo — un router Wi-Fi con 4 porte resta «network»', () => {
  assert.equal(role('Router AX', GE(4).concat(RADIO(2))), 'network');
  assert.equal(role('Switch 8', GE(8)), 'network');
});

test('roleOf: «voip» scarta con meno di 3 porte dati (un telefono), non un router con 7 porte', () => {
  assert.equal(role('883 VoIP', GE(7)), 'network', 'router/gateway che parla VoIP');
  assert.equal(role('IP Phone D120', GE(2)), 'endpoint!', 'un telefono ha la sua porta e quella del PC');
  assert.equal(role('Deskphone 7', GE(1)), 'endpoint!');
});

test('roleOf: le altre parole scartano a prescindere dalle porte (workstation, kit da rack)', () => {
  assert.equal(role('Rack Workstation 4U', GE(4)), 'endpoint!');
  assert.equal(role('Rack Kit 2U', GE(8)), 'endpoint!');
});
