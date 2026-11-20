'use strict';
// ============================================================
//  «APPLICA MODELLO» PROPONE I MODELLI DEL TIPO GIUSTO: la classificazione del catalogo CC0 per tipo
// ============================================================
// La libreria NetBox dà il modello, non il tipo. Il ruolo strutturale (tools/import-device-types.js → roleOf) separa
// UPS/PDU, NAS, console server e AP dall'«apparato di rete»; per dire se questo è uno switch, un router o un firewall
// c'è solo il NOME, e `networkKind` decide SOLO dove il nome non può essere altro. Il resto è «non so» e si propone a
// tutti i tipi di rete: nascondere per errore il modello giusto è peggio di mostrarne uno di troppo.
// Qui: la regola sul nome, i confini (le eccezioni battono la regola larga), e quali modelli entrano in quale elenco.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../lib/device-model-kind.js');

const kind = (brand, model) => K.networkKind(brand, model);

test('firewall: la parola, le famiglie note e i marchi che fanno solo quel mestiere', () => {
  assert.equal(kind('Acme', 'Edge Firewall 100'), 'firewall', 'la parola «firewall»');
  assert.equal(kind('Fortinet', 'FortiGate 60F'), 'firewall');
  assert.equal(kind('Fortinet', 'FortiWiFi 40F'), 'firewall');
  assert.equal(kind('Fortinet', 'FG-100F'), 'firewall');
  assert.equal(kind('Cisco', 'ASA5516-X'), 'firewall');
  assert.equal(kind('Cisco', 'Firepower 2130'), 'firewall');
  assert.equal(kind('Cisco', 'Meraki MX68W'), 'firewall', 'Meraki MX: il modello ripete «Meraki»');
  assert.equal(kind('Palo Alto Networks', 'PA-440'), 'firewall');
  assert.equal(kind('Juniper', 'SRX320-POE'), 'firewall');
  assert.equal(kind('SonicWall', 'TZ370'), 'firewall');
  assert.equal(kind('WatchGuard', 'Firebox T40'), 'firewall');
  assert.equal(kind('Sophos', 'XGS 2100'), 'firewall');
  assert.equal(kind('Zyxel', 'USG FLEX 100'), 'firewall');
  assert.equal(kind('Check Point', 'Qualunque 1800'), 'firewall', 'marchio che fa solo gateway');
  assert.equal(kind('Stormshield', 'SN-S-Series-220'), 'firewall');
  assert.equal(kind('Netgate', '4200 Security Gateway'), 'firewall');
});

test('router: la parola, le famiglie note e i marchi che fanno solo quel mestiere', () => {
  assert.equal(kind('Acme', 'Edge Router 8'), 'router');
  assert.equal(kind('Cisco', 'ISR4331'), 'router');
  assert.equal(kind('Cisco', 'ASR-920-12SZ-D'), 'router');
  assert.equal(kind('Cisco', 'Catalyst 8300-1N1S-4T2X'), 'router', 'Catalyst 8000 è la linea router: batte «catalyst» = switch');
  assert.equal(kind('Cisco', 'C888-K9'), 'router');
  assert.equal(kind('Juniper', 'MX204'), 'router');
  assert.equal(kind('MikroTik', 'RB4011iGS+RM'), 'router');
  assert.equal(kind('MikroTik', 'CCR2004-16G-2S+'), 'router');
  assert.equal(kind('Ubiquiti', 'EdgeRouter 4'), 'router');
  assert.equal(kind('Huawei', 'NE40E-X8'), 'router');
  assert.equal(kind('HPE', 'FlexNetwork MSR3024 AC Router'), 'router');
  assert.equal(kind('Yamaha', 'RTX1300'), 'router');
  assert.equal(kind('TP-Link', 'Archer AX55'), 'router');
  assert.equal(kind('Draytek', 'Vigor 2927'), 'router', 'marchio che fa solo questo');
});

test('switch: la parola, le famiglie note, le serie dei marchi', () => {
  assert.equal(kind('Acme', 'Gigabit Switch 24'), 'switch');
  assert.equal(kind('Dell', 'PowerSwitch N1524P'), 'switch', '«RackSwitch»/«PowerSwitch»: la parola senza confine');
  assert.equal(kind('Allied Telesis', 'SwitchBlade x8106'), 'switch');
  assert.equal(kind('Cisco', 'Catalyst 9300-48UN'), 'switch');
  assert.equal(kind('Cisco', 'Nexus 9332D-GX2B'), 'switch');
  assert.equal(kind('Cisco', 'WS-C2950-24'), 'switch');
  assert.equal(kind('Cisco', 'CBS350-24FP-4X'), 'switch');
  assert.equal(kind('Cisco', 'Meraki MS220-24P'), 'switch');
  assert.equal(kind('Arista', 'DCS-7050S-52-F'), 'switch');
  assert.equal(kind('Arista', 'CCS-720XP-48TXH-2C-S'), 'switch');
  assert.equal(kind('Juniper', 'EX4300-48T'), 'switch');
  assert.equal(kind('Juniper', 'QFX5120-48Y'), 'switch');
  assert.equal(kind('Ubiquiti', 'USW-Pro-24-PoE'), 'switch');
  assert.equal(kind('HPE', 'Aruba 2930M-24G-PoE+'), 'switch');
  assert.equal(kind('HPE', 'ProCurve 2520-24-PoE'), 'switch');
  assert.equal(kind('HPE', 'FlexNetwork 5130-24G-4SFP+ EI'), 'switch');
  assert.equal(kind('Huawei', 'S5735-L8T4X-A1'), 'switch');
  assert.equal(kind('Extreme Networks', 'X460-G2-24t-GE4'), 'switch');
  assert.equal(kind('TP-Link', 'TL-SG108PE'), 'switch');
  assert.equal(kind('Edgecore', 'AS4625-54T'), 'switch');
});

test('le eccezioni battono la regola larga: lo stesso prefisso, un altro mestiere', () => {
  assert.equal(kind('MikroTik', 'CRS326-24G-2S+RM'), 'switch', 'Cloud Router Switch: «CRS» non è un router');
  assert.equal(kind('MikroTik', 'CSS610-8G-2S+IN'), 'switch');
  assert.equal(kind('MikroTik', 'RB260GSP'), 'switch', '«RB» è la sigla delle RouterBOARD, ma RB260 è uno switch');
  assert.equal(kind('MikroTik', 'RB5009UG+S+IN'), 'router');
  assert.equal(kind('Acme', 'Cloud Router Switch 10'), 'switch', 'la parola «router» dentro «router switch» non vince');
  assert.equal(kind('Fortinet', 'FortiSwitch 124F'), 'switch', 'Fortinet non fa solo firewall');
  assert.equal(kind('Cisco', 'Meraki MS120-8'), 'switch');
  assert.equal(kind('Cisco', 'Meraki MX84'), 'firewall', 'stessa famiglia Meraki, altra sigla');
  assert.equal(kind('Juniper', 'MX480'), 'router', 'Juniper MX è un router; Meraki MX un firewall: conta il marchio');
  assert.equal(kind('Yamaha', 'SWX2310P-28GT'), 'switch');
  assert.equal(kind('Yamaha', 'FWX120'), 'firewall');
  assert.equal(kind('Eltex', 'MES2408CP'), 'switch');
  assert.equal(kind('Eltex', 'ESR-1000'), 'router');
});

test('né switch né router né firewall: server, storage, controllori industriali', () => {
  assert.equal(kind('Supermicro', 'SYS-6028TR-HTR'), 'other');
  assert.equal(kind('Supermicro', 'SSE-G3648B'), 'switch', 'ma lo switch di Supermicro è uno switch: la serie SSE batte il marchio');
  assert.equal(kind('Lenovo', 'ThinkSystem SR650'), 'other');
  assert.equal(kind('Dell', 'PowerEdge R740'), 'other');
  assert.equal(kind('HPE', 'Apollo R4200 Chassis'), 'other');
  assert.equal(kind('HPE', 'HPE ProLiant DL380'), 'other', 'il modello che ripete il marchio si legge senza la ripetizione');
  assert.equal(kind('Cisco', 'UCSB-5108-AC2'), 'other');
  assert.equal(kind('NetApp', 'AFF-A400'), 'other');
  assert.equal(kind('Rockwell Automation', 'ControlLogix 5580'), 'other');
});

test('il nome non dice niente: «non so» (null), mai un tipo tirato a indovinare', () => {
  for (const [b, m] of [['Acme', 'X1'], ['3Com', '2016'], ['LANCOM', '1793VAW'], ['Ciena', '5171 Platform'], ['Nokia', '7750 SR-1x-48D'], ['Acme', '']]) {
    assert.equal(kind(b, m), null, `${b} ${m}`);
  }
  for (const v of [undefined, null, 0, {}, []]) assert.equal(kind(v, v), null, 'ingressi che non sono testo');
  assert.equal(kind('Cisco', undefined), null);
});

test('un modello che ripete il marchio e uno che non lo ripete si leggono uguale', () => {
  assert.equal(kind('Cisco', 'Cisco WS-C2950G-12-EI'), kind('Cisco', 'WS-C2950G-12-EI'));
  assert.equal(kind('HPE', 'HPE Aruba 2530-48G-2SFP+'), 'switch');
  assert.equal(kind('Cisco', 'Ciscofoo'), null, 'ripetizione solo se è una parola intera');
  assert.equal(kind('Cisco', 'Ciscoswitch 24'), 'switch', '«Ciscoswitch» non è «Cisco» + «switch»: non si toglie niente e la parola «switch» vale');
});

test('si legge il MODELLO: un marchio con «switch» o «router» nel nome non fa di ogni suo modello uno switch o un router', () => {
  assert.equal(kind('Switchmaster Inc', 'X1'), null);
  assert.equal(kind('Router Corp', 'Alpha'), null);
  assert.equal(kind('Firewall Systems', 'Gamma 4'), null);
  assert.equal(kind('Switchmaster Inc', ''), null, 'e un modello vuoto non combacia con niente');
  assert.equal(kind('Check Point', ''), null, 'nemmeno per un marchio che fa solo gateway');
  assert.equal(kind('Switchmaster Inc', 'X1 Switch'), 'switch', 'la parola nel modello vale');
});

// ── Quale elenco propone «Applica modello» per un tipo di dispositivo ──────────────────────────────────────────────
test('elenco per tipo: switch, router e firewall hanno il loro; alimentazione, NAS, console e wireless idem', () => {
  assert.equal(K.modelListFor('switch'), 'switch');
  assert.equal(K.modelListFor('router'), 'router');
  assert.equal(K.modelListFor('firewall'), 'firewall');
  for (const t of ['ups', 'pdu', 'ats']) assert.equal(K.modelListFor(t), 'power', t);
  assert.equal(K.modelListFor('nas'), 'nas');
  assert.equal(K.modelListFor('consolesvr'), 'console');
  assert.equal(K.modelListFor('wlanctrl'), 'ap');
});

test('un tipo senza una classe propria nel catalogo non si restringe: vede tutti i modelli', () => {
  for (const t of ['server', 'hypervisor', 'kvm', 'pbx', 'nvr', 'sdwan', 'vpncon', 'mediaconv', 'customrack', 'patchpanel', 'fiberdrawer', '', undefined, null, 'constructor', '__proto__', 'toString']) {
    assert.equal(K.modelListFor(t), null, String(t));
  }
});

test('chi sta in quale elenco: il proprio ruolo, e i modelli che il catalogo non sa classificare stanno in tutti quelli di rete', () => {
  const e = (role) => ({ brand: 'A', model: 'B', role });
  // un firewall noto: solo nel suo elenco (e in quelli non ristretti, che non passano di qui)
  assert.deepEqual(['switch', 'router', 'firewall', 'power', 'nas', 'console', 'ap'].filter((l) => K.modelInList(e('firewall'), l)), ['firewall']);
  assert.deepEqual(['switch', 'router', 'firewall', 'power', 'nas', 'console', 'ap'].filter((l) => K.modelInList(e('switch'), l)), ['switch']);
  assert.deepEqual(['switch', 'router', 'firewall', 'power', 'nas', 'console', 'ap'].filter((l) => K.modelInList(e('router'), l)), ['router']);
  // non classificato (nessun segnale nel nome) e chassis: a ogni tipo di rete, a nessun altro
  for (const r of ['network', 'chassis']) {
    assert.deepEqual(['switch', 'router', 'firewall', 'power', 'nas', 'console', 'ap'].filter((l) => K.modelInList(e(r), l)), ['switch', 'router', 'firewall'], r);
  }
  // server/storage/controllore: in nessun elenco di rete
  assert.deepEqual(['switch', 'router', 'firewall'].filter((l) => K.modelInList(e('other'), l)), []);
  for (const r of ['power', 'nas', 'console', 'ap']) assert.deepEqual(['switch', 'router', 'firewall', 'power', 'nas', 'console', 'ap'].filter((l) => K.modelInList(e(r), l)), [r], r);
});

test('un catalogo vecchio (modelli senza `role`) non nasconde niente: ogni modello sta in ogni elenco', () => {
  for (const entry of [{ brand: 'A', model: 'B' }, { brand: 'A', model: 'B', role: '' }, { brand: 'A', model: 'B', role: 7 }, {}, null, undefined]) {
    for (const l of ['switch', 'router', 'firewall', 'power', 'nas', 'console', 'ap']) assert.equal(K.modelInList(entry, l), true, `${JSON.stringify(entry)} in ${l}`);
  }
});

test('un ruolo ignoto sta nel proprio nome e basta: non entra a caso in un elenco di rete', () => {
  assert.equal(K.modelInList({ role: 'qualcosa' }, 'switch'), false);
  assert.equal(K.modelInList({ role: 'qualcosa' }, 'qualcosa'), true);
  assert.deepEqual([...K.NETWORK_ROLES].sort(), ['chassis', 'firewall', 'network', 'other', 'router', 'switch']);
});
