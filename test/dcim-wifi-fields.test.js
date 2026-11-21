'use strict';
// ============================================================
// WIFI ↔ NETBOX — i campi che NetBox dichiara e InfraNet non aveva: WEP, larghezza di canale, potenza, ruolo RF,
// provenienza della WLAN (descrizione, gruppo, ambito, tenant) e gli attributi del collegamento radio (distanza, stato,
// descrizione, autenticazione). Misurato il 21/11 su un NetBox 4.6.7 vero e con un import simulato: tutto questo si
// perdeva SENZA una riga nel rapporto, e una rete WEP entrava senza sicurezza (ne' «aperta» ne' debole: l'audit taceva).
// Qui si prova ogni campo dal dato NetBox al pannello.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const dcim = require('../lib/dcim-map.js');
const W = require('../lib/wifi-spec.js');
const RADIO = require('../lib/radio.js');
const SRC = require('../lib/dcim-source-view.js');
const i18n = require('../lib/i18n.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const codici = (out) => out.map((i) => i.code);

// ── il vocabolario e le regole ─────────────────────────────────────────────────────────────
test('il vocabolario: WEP c\'e\' (dopo «aperta»), il ruolo RF e\' quello di NetBox (ap, station)', () => {
  assert.deepEqual([...W.WIFI_SECURITY], ['open', 'wep', 'wpa2-psk', 'wpa2-ent', 'wpa3-personal', 'wpa3-ent', 'owe']);
  assert.deepEqual([...W.WIFI_RF_ROLES], ['ap', 'station']);
});

test('WEP e\' un ERRORE (protezione ritirata e rotta); su 6 GHz anche la banda lo rifiuta; le altre sicurezze non cambiano', () => {
  assert.deepEqual(codici(W.validateWifi({ security: 'wep' })), ['wep']);
  assert.equal(W.validateWifi({ security: 'wep' })[0].level, 'error');
  assert.deepEqual(codici(W.validateWifi({ band: '5', security: 'wep' })), ['wep']);
  assert.deepEqual(codici(W.validateWifi({ band: '6', security: 'wep' })).sort(), ['band6-security', 'wep']);
  assert.deepEqual(codici(W.validateWifi({ band: '6', security: 'open' })).sort(), ['band6-security', 'open-network'], 'come prima');
  assert.deepEqual(W.validateWifi({ band: '6', security: 'wpa3-personal' }), []);
  assert.deepEqual(codici(W.validateWifi({ security: 'open' })), ['open-network']);
  assert.deepEqual(W.validateWifi({ security: 'wpa2-psk', cipher: 'aes' }), []);
});

test('le frasi esistono in italiano e in inglese (se manca l\'inglese t() ripiega sull\'italiano: si guarda il dizionario)', () => {
  const chiavi = ['wfi.wep.t', 'wfi.wep.w', 'radio.width', 'radio.txPower', 'radio.rfRole', 'radio.rfRole.ap', 'radio.rfRole.station',
    'radio.linkStatus', 'radio.linkSecurity', 'radio.linkNotes', 'src.group', 'src.scope', 'src.description'];
  for (const lang of ['it', 'en']) for (const k of chiavi) {
    assert.ok(typeof i18n._i18nDict[lang][k] === 'string' && i18n._i18nDict[lang][k], `${lang}: manca ${k}`);
  }
});

test('i campi fisici della radio passano al client associato (effBssCfg): larghezza, potenza, ruolo', () => {
  const radio = { band: '5', channel: 36, width: 80, txPower: 17, rfRole: 'ap', ssids: [{ id: 's1', ssid: 'X' }] };
  const cfg = RADIO.effBssCfg(radio, 's1');
  assert.equal(cfg.width, 80);
  assert.equal(cfg.txPower, 17);
  assert.equal(cfg.rfRole, 'ap');
});

// ── la provenienza della WLAN ──────────────────────────────────────────────────────────────────────
test('provenienza SSID: tenant, gruppo, ambito, descrizione, in quest\'ordine; i vuoti non fanno riga; null non rompe', () => {
  const righe = SRC.ssidSourceRows({ source: { description: 'Rete interna', group: 'Sede', scope: 'Milano', tenant: 'ACME' } });
  assert.deepEqual(righe.map((r) => [r.key, r.value]), [['tenant', 'ACME'], ['group', 'Sede'], ['scope', 'Milano'], ['description', 'Rete interna']]);
  assert.deepEqual(righe.map((r) => r.label), ['src.tenant', 'src.group', 'src.scope', 'src.description']);
  assert.deepEqual(SRC.ssidSourceRows({ source: { tenant: '  ', group: '', scope: null } }), []);
  assert.deepEqual(SRC.ssidSourceRows({ ssid: 'X' }), []);
  assert.deepEqual(SRC.ssidSourceRows(null), []);
  assert.deepEqual(SRC.ssidSourceRows({ source: 'testo' }), []);
});

// ── l'import: radio, SSID, collegamento ───────────────────────────────────────────────────────────
const IF = (id, device, name, role, extra) => Object.assign({ id, device: { id: device }, name, type: { value: 'ieee802.11ax' },
  rf_role: { value: role }, rf_channel: { value: '5g-36-5180-20' }, wireless_lans: [] }, extra || {});
const WLAN = (id, ssid, extra) => Object.assign({ id, ssid, status: { value: 'active' }, auth_type: { value: 'wpa-personal' }, auth_cipher: { value: 'aes' } }, extra || {});
const DEV = (id, name) => ({ id, name, role: { id: 40 }, site: { id: 1, name: 'S' } });
function importa(over) {
  return dcim.netboxToState(Object.assign({
    deviceRoles: [{ id: 40, slug: 'access-point', name: 'AP' }],
    devices: [DEV(310, 'AP-1'), DEV(311, 'AP-2')], interfaces: [], wirelessLans: [], wirelessLinks: [],
  }, over || {}));
}
const radioOf = (r, devId) => r.state.nodes.find((n) => n.id === 'nb-dev-' + devId).radios[0];
const unaRadio = (extra, chan) => radioOf(importa({ interfaces: [IF(900, 310, 'wlan0', 'ap', Object.assign({}, extra, chan ? { rf_channel: { value: chan } } : {}))] }), 310);

test('radio: la larghezza e\' quella del canale scelto («5g-42-5210-80» = 80), anche quando il canale primario non entra', () => {
  const r = unaRadio({}, '5g-42-5210-80');
  assert.equal(r.width, 80);
  assert.equal(r.channel, undefined, 'un blocco largo non da il canale primario: non si inventa');
  assert.equal(r.band, '5');
  assert.equal(unaRadio({}, '2.4g-1-2412-22').width, 22);
  assert.equal(unaRadio({}, '5g-36-5180-20').width, 20);
  assert.equal(unaRadio({}, '5g-36-5180-20').channel, 36, 'il canale a 20 MHz entra come prima');
});

test('radio: un canale scritto senza centro e larghezza («5g-36-5180», «2.4g-6-») entra come prima, senza larghezza', () => {
  const a = unaRadio({ rf_channel_width: null }, '5g-36-5180');
  assert.deepEqual([a.band, a.channel, a.width], ['5', 36, undefined]);
  const b = unaRadio({ rf_channel_width: null }, '2.4g-6-');
  assert.deepEqual([b.band, b.channel, b.width], ['2.4', 6, undefined]);
});

test('radio: `rf_channel_width` vince sul canale; un valore non valido vale «non detto»', () => {
  assert.equal(unaRadio({ rf_channel_width: 160 }, '5g-36-5180-20').width, 160);
  assert.equal(unaRadio({ rf_channel_width: '40' }, '5g-36-5180-20').width, 40, 'un decimale come testo');
  for (const bad of [0, -20, 'x', null, '', Infinity, undefined]) assert.equal(unaRadio({ rf_channel_width: bad }, '5g-36-5180-20').width, 20, 'ripiega sul canale: ' + String(bad));
});

test('radio: senza canale ne\' larghezza dichiarata la larghezza non c\'e\'', () => {
  const r = radioOf(importa({ interfaces: [IF(900, 310, 'wlan0', 'ap', { rf_channel: null, rf_channel_width: null })] }), 310);
  assert.equal(r.width, undefined);
  assert.equal(r.band, undefined);
});

test('radio: la potenza di trasmissione (dBm) entra come numero; 0 e\' una potenza; il resto vale «non detta»', () => {
  assert.equal(unaRadio({ tx_power: 17 }).txPower, 17);
  assert.equal(unaRadio({ tx_power: '23' }).txPower, 23);
  assert.equal(unaRadio({ tx_power: 0 }).txPower, 0, 'zero dBm e\' un valore');
  for (const bad of [null, undefined, '', -3, 'x']) assert.equal(unaRadio({ tx_power: bad }).txPower, undefined, String(bad));
});

test('radio: il ruolo RF entra se e\' ap o station (anche come oggetto); altro vale «non detto»', () => {
  assert.equal(unaRadio({ rf_role: { value: 'station' } }).rfRole, 'station');
  assert.equal(unaRadio({ rf_role: 'ap' }).rfRole, 'ap');
  assert.equal(unaRadio({ rf_role: { value: 'AP' } }).rfRole, 'ap', 'maiuscole');
  for (const bad of [null, '', { value: 'altro' }, 'router']) assert.equal(unaRadio({ rf_role: bad }).rfRole, undefined, JSON.stringify(bad));
});

const conWlan = (wl, ifExtra) => importa({ interfaces: [IF(900, 310, 'wlan0', 'ap', Object.assign({ wireless_lans: [{ id: wl.id }] }, ifExtra || {}))], wirelessLans: [wl] });
const bssOf = (r) => radioOf(r, 310).ssids[0];

test('SSID: una rete WEP entra come WEP, senza cifrario, e non viene «letta come WPA2»', () => {
  const r = conWlan(WLAN(701, 'Vecchia', { auth_type: { value: 'wep' }, auth_cipher: { value: 'tkip' } }));
  assert.equal(bssOf(r).security, 'wep');
  assert.equal('cipher' in bssOf(r), false, 'WEP non ha un cifrario da scegliere');
  assert.ok(!r.report.issues.some((i) => i.code === 'wifi.securityAssumed'), 'WEP non e\' un\'assunzione');
});

test('SSID: aperta resta aperta, WPA personale e\' WPA2 assunto (detto), un tipo sconosciuto non scrive la sicurezza', () => {
  assert.equal(bssOf(conWlan(WLAN(701, 'A', { auth_type: { value: 'open' } }))).security, 'open');
  const wpa = conWlan(WLAN(701, 'B'));
  assert.equal(bssOf(wpa).security, 'wpa2-psk');
  assert.equal(wpa.report.issues.find((i) => i.code === 'wifi.securityAssumed').n, 1);
  assert.equal('security' in bssOf(conWlan(WLAN(701, 'C', { auth_type: { value: 'qualcosa' } }))), false);
});

test('SSID: descrizione, gruppo, ambito e tenant entrano come PROVENIENZA (source), senza essere campi da compilare', () => {
  const r = conWlan(WLAN(701, 'Corp', { description: 'Rete interna', group: { name: 'Sede' }, scope_type: 'dcim.site', scope: { name: 'Milano' }, tenant: { name: 'ACME' } }));
  assert.deepEqual(bssOf(r).source, { description: 'Rete interna', group: 'Sede', scope: 'Milano', tenant: 'ACME' });
  const solo = conWlan(WLAN(701, 'Corp', { description: 'Solo descrizione' }));
  assert.deepEqual(bssOf(solo).source, { description: 'Solo descrizione' });
  assert.equal('source' in bssOf(conWlan(WLAN(701, 'Corp'))), false, 'niente da dire: niente oggetto');
  assert.equal('source' in bssOf(conWlan(WLAN(701, 'Corp', { description: '   ', group: null, scope: {}, tenant: { name: '' } }))), false);
});

test('SSID: gruppo, ambito e tenant si leggono anche dal nome breve (`display`)', () => {
  const r = conWlan(WLAN(701, 'Corp', { group: { display: 'G1' }, scope: { display: 'S1' }, tenant: { display: 'T1' } }));
  assert.deepEqual(bssOf(r).source, { group: 'G1', scope: 'S1', tenant: 'T1' });
});

const coppia = (wk) => importa({
  interfaces: [IF(900, 310, 'wlan0', 'ap', { wireless_lans: [] }), IF(901, 311, 'wlan0', 'station')],
  wirelessLinks: [Object.assign({ id: 1, interface_a: { id: 900 }, interface_b: { id: 901 }, status: { value: 'connected' } }, wk || {})],
});
const linkOf = (r) => r.state.links.find((l) => l.wireless);

test('collegamento: la distanza entra in METRI da qualunque unita\' di NetBox; senza unita\' vale metri; un\'unita\' ignota non scrive', () => {
  assert.equal(linkOf(coppia({ distance: 2.5, distance_unit: { value: 'km' } })).lengthM, 2500);
  assert.equal(linkOf(coppia({ distance: 300, distance_unit: 'm' })).lengthM, 300);
  assert.equal(linkOf(coppia({ distance: 100, distance_unit: { value: 'ft' } })).lengthM, 30.48);
  assert.equal(linkOf(coppia({ distance: 1, distance_unit: { value: 'mi' } })).lengthM, 1609.34);
  assert.equal(linkOf(coppia({ distance: 40 })).lengthM, 40);
  for (const wk of [{ distance: 5, distance_unit: 'furlong' }, { distance: 0 }, { distance: null }, {}]) assert.equal('lengthM' in linkOf(coppia(wk)), false, JSON.stringify(wk));
});

test('collegamento: lo stato di NetBox (connected = attivo, decommissioning = da sostituire; planned non entra)', () => {
  assert.equal(linkOf(coppia({ status: { value: 'connected' } })).cableStatus, 'active');
  assert.equal(linkOf(coppia({ status: { value: 'decommissioning' } })).cableStatus, 'to_replace');
  assert.equal('cableStatus' in linkOf(coppia({ status: null })), false, 'stato assente: non dichiarato');
  assert.equal(linkOf(coppia({ status: { value: 'planned' } })), undefined, 'un collegamento previsto resta fuori (e detto)');
});

test('collegamento: la descrizione di NetBox e\' la descrizione del collegamento (`notes`); vuota non scrive', () => {
  assert.equal(linkOf(coppia({ description: 'Ponte fra i due edifici' })).notes, 'Ponte fra i due edifici');
  assert.equal('notes' in linkOf(coppia({ description: '  ' })), false);
});

test('collegamento: l\'autenticazione PROPRIA (sicurezza e cifrario) entra; WEP e aperta non hanno cifrario; la chiave non entra MAI', () => {
  const wpa = linkOf(coppia({ auth_type: { value: 'wpa-personal' }, auth_cipher: { value: 'aes' }, auth_psk: 'SEGRETISSIMA-PSK' }));
  assert.equal(wpa.wifiSecurity, 'wpa2-psk');
  assert.equal(wpa.wifiCipher, 'aes');
  assert.ok(!JSON.stringify(wpa).includes('SEGRETISSIMA'), 'la PSK non entra nel documento');
  const wep = linkOf(coppia({ auth_type: { value: 'wep' }, auth_cipher: { value: 'tkip' } }));
  assert.equal(wep.wifiSecurity, 'wep');
  assert.equal('wifiCipher' in wep, false);
  const open = linkOf(coppia({ auth_type: { value: 'open' }, auth_cipher: { value: 'auto' } }));
  assert.equal(open.wifiSecurity, 'open');
  assert.equal('wifiCipher' in open, false);
  assert.equal('wifiSecurity' in linkOf(coppia({})), false, 'niente da dire: niente campo');
  assert.equal(linkOf(coppia({ auth_type: { value: 'wpa-enterprise' }, auth_cipher: { value: 'tkip' } })).wifiCipher, 'tkip');
  assert.equal('wifiCipher' in linkOf(coppia({ auth_type: { value: 'wpa-personal' }, auth_cipher: { value: 'zzz' } })), false, 'un cifrario fuori elenco non entra');
});

test('collegamento: la WPA assunta di un collegamento si somma a quella degli SSID nella riga «letta come WPA2»', () => {
  const r = importa({
    interfaces: [IF(900, 310, 'wlan0', 'ap', { wireless_lans: [{ id: 701 }] }), IF(901, 311, 'wlan0', 'station')],
    wirelessLans: [WLAN(701, 'Corp')],
    wirelessLinks: [{ id: 1, interface_a: { id: 900 }, interface_b: { id: 901 }, status: { value: 'connected' }, auth_type: { value: 'wpa-personal' } }],
  });
  assert.equal(r.report.issues.find((i) => i.code === 'wifi.securityAssumed').n, 2, 'un SSID + un collegamento');
});

// ── i pannelli, nel DOM finto ─────────────────────────────────────────────────────────────────────────
let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

const tag = (html, re) => (html.match(re) || [''])[0];
function pannelloRadio(radio) {
  return JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];
    state.nodes.push({ id:'ap1', type:'ap', name:'AP', ports:1, radios:[${JSON.stringify(radio)}] });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const el = document.createElement('div'); _renderRadioProps(el, 'ap1-radio');
    return JSON.stringify({ html: el.innerHTML || '' });
  })()`)).html;
}
function dopo(js) {
  return JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];
    state.nodes.push({ id:'ap1', type:'ap', name:'AP', ports:1, radios:[{ band:'5', ssids:[{ id:'s1', ssid:'Corp' }] }] });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    ${js}
    return JSON.stringify(nodeById('ap1').radios[0]);
  })()`));
}

test('pannello radio: larghezza, potenza e ruolo si vedono col loro valore', () => {
  const html = pannelloRadio({ band: '5', channel: 36, width: 80, txPower: 17, rfRole: 'station', ssids: [] });
  assert.match(tag(html, /<input[^>]*data-field="width"[^>]*>/), /value="80"/);
  assert.match(tag(html, /<input[^>]*data-field="txPower"[^>]*>/), /value="17"/);
  assert.match(html, /<option value="station" selected>/, 'il ruolo scelto');
  assert.doesNotMatch(html, /<option value="ap" selected>/);
  const vuoto = pannelloRadio({ band: '5', ssids: [] });
  assert.match(tag(vuoto, /<input[^>]*data-field="width"[^>]*>/), /value=""/);
  assert.match(tag(vuoto, /<input[^>]*data-field="txPower"[^>]*>/), /value=""/);
  assert.match(pannelloRadio({ band: '5', txPower: 0, ssids: [] }).match(/<input[^>]*data-field="txPower"[^>]*>/)[0], /value="0"/, 'zero dBm si vede');
});

test('pannello radio: scrivere la larghezza e la potenza salva NUMERI; un valore non valido toglie il campo', () => {
  assert.equal(dopo(`updateRadioCfg('ap1', 0, 'width', '80');`).width, 80);
  assert.equal(dopo(`updateRadioCfg('ap1', 0, 'width', '80'); updateRadioCfg('ap1', 0, 'width', '');`).width, undefined);
  for (const bad of ['0', '-20', 'abc', 'Infinity']) assert.equal(dopo(`updateRadioCfg('ap1', 0, 'width', '80'); updateRadioCfg('ap1', 0, 'width', '${bad}');`).width, undefined, 'larghezza ' + bad);
  assert.equal(dopo(`updateRadioCfg('ap1', 0, 'txPower', '20');`).txPower, 20);
  assert.equal(dopo(`updateRadioCfg('ap1', 0, 'txPower', '0');`).txPower, 0, 'zero dBm e\' una potenza');
  for (const bad of ['-1', 'abc', '', 'Infinity']) assert.equal(dopo(`updateRadioCfg('ap1', 0, 'txPower', '20'); updateRadioCfg('ap1', 0, 'txPower', '${bad}');`).txPower, undefined, 'potenza ' + bad);
  assert.equal(dopo(`updateRadioCfg('ap1', 0, 'rfRole', 'station');`).rfRole, 'station');
  assert.equal(dopo(`updateRadioCfg('ap1', 0, 'rfRole', 'station'); updateRadioCfg('ap1', 0, 'rfRole', '');`).rfRole, undefined);
});

test('pannello SSID: WEP e\' nella tendina, ha il suo errore, e la provenienza del DCIM si legge ma non si modifica', () => {
  const html = pannelloRadio({ band: '5', ssids: [{ id: 's1', ssid: 'Vecchia', security: 'wep', source: { description: 'Rete interna', group: 'Sede', scope: 'Milano', tenant: 'ACME' } }] });
  assert.match(html, /<option value="wep" selected>WEP \(obsoleto\)<\/option>/);
  assert.match(html, /cable-validate-row lvl-error/);
  assert.ok(html.includes(i18n._i18nDict.it['wfi.wep.t']), 'il titolo dell\'errore WEP');
  assert.ok(html.includes(i18n._i18nDict.it['src.header']), 'intestazione «Dichiarato dal DCIM»');
  for (const v of ['ACME', 'Sede', 'Milano', 'Rete interna']) assert.ok(html.includes(v), 'provenienza: ' + v);
  for (const k of ['src.tenant', 'src.group', 'src.scope', 'src.description']) assert.ok(html.includes(i18n._i18nDict.it[k]), k);
  assert.doesNotMatch(html, /data-field="(tenant|group|scope|source|description)"/, 'non e\' un campo da compilare');
  const senza = pannelloRadio({ band: '5', ssids: [{ id: 's1', ssid: 'Corp', security: 'wpa2-psk' }] });
  assert.ok(!senza.includes(i18n._i18nDict.it['src.header']), 'niente da dire: niente intestazione');
});

test('pannello SSID: la provenienza escapa il testo che arriva dal DCIM', () => {
  const html = pannelloRadio({ band: '5', ssids: [{ id: 's1', ssid: 'X', source: { tenant: '<img src=x onerror=alert(1)>' } }] });
  assert.ok(!html.includes('<img src=x'), 'tag grezzo');
  assert.ok(html.includes('&lt;img'), 'escapato');
});

function pannelloLink(link, nodes) {
  return JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.links = [];
    state.nodes = ${JSON.stringify(nodes || [{ id: 'ap1', type: 'ap', name: 'AP', ports: 1, radios: [{ band: '5', width: 80, ssids: [{ id: 's1', ssid: 'Corp' }] }] }, { id: 'ap2', type: 'ap', name: 'AP2', ports: 1, radios: [{}] }])};
    state.links.push(${JSON.stringify(link)});
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    return JSON.stringify({ html: _wifiAssocHtml(state.links[0]) });
  })()`)).html;
}
const LNK = (extra) => Object.assign({ id: 'l1', src: 'ap1-radio', dst: 'ap2-radio', wireless: true }, extra || {});

test('pannello collegamento radio: stato, sicurezza, cifrario, descrizione e distanza si vedono', () => {
  const html = pannelloLink(LNK({ cableStatus: 'to_replace', wifiSecurity: 'wpa2-psk', wifiCipher: 'aes', notes: 'Ponte fra i due edifici', lengthM: 2500 }));
  assert.match(html, /<option value="to_replace" selected>/);
  assert.match(html, /<option value="wpa2-psk" selected>/);
  assert.match(html, /<option value="aes" selected>/);
  assert.match(tag(html, /<textarea[^>]*data-lprop="notes"[^>]*>[^<]*<\/textarea>/), /Ponte fra i due edifici/);
  assert.match(tag(html, /<input[^>]*data-lprop="length"[^>]*>/), /value="2500"/, 'la distanza dell\'import (lengthM) si legge');
  for (const p of ['cableStatus', 'wifiSecurity', 'wifiCipher', 'notes']) assert.match(html, new RegExp('data-lprop="' + p + '"'), p);
});

test('pannello collegamento radio: la distanza scritta a mano (`length`) vince su quella importata; senza niente il campo e\' vuoto', () => {
  assert.match(tag(pannelloLink(LNK({ length: 12, lengthM: 2500 })), /<input[^>]*data-lprop="length"[^>]*>/), /value="12"/);
  assert.match(tag(pannelloLink(LNK()), /<input[^>]*data-lprop="length"[^>]*>/), /value=""/);
});

test('pannello collegamento radio: WEP sul collegamento da errore; il 6 GHz non ammette WPA2; il testo del DCIM e\' escapato', () => {
  assert.match(pannelloLink(LNK({ wifiSecurity: 'wep' })), /cable-validate-row lvl-error/);
  const sei = pannelloLink(LNK({ wifiSecurity: 'wpa2-psk' }), [{ id: 'ap1', type: 'ap', name: 'AP', ports: 1, radios: [{ band: '6', ssids: [{ id: 's1', ssid: 'Corp' }] }] }, { id: 'ap2', type: 'ap', name: 'AP2', ports: 1, radios: [{}] }]);
  assert.ok(sei.includes(i18n._i18nDict.it['wfi.band6-security.t']), 'la regola della banda vale anche per il collegamento');
  assert.doesNotMatch(pannelloLink(LNK({ wifiSecurity: 'wpa3-personal' })), /cable-validate-row/, 'WPA3 su 5 GHz: nessun reperto');
  const xss = pannelloLink(LNK({ notes: '</textarea><script>alert(1)</script>' }));
  assert.ok(!xss.includes('<script>'), 'tag grezzo');
});

test('pannello collegamento radio: scegliere sicurezza e cifrario li scrive sul link, svuotare li toglie; lo stato non toglie la distanza', () => {
  const r = JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = [];
    state.links = [{ id:'l1', src:'ap1-radio', dst:'ap2-radio', wireless:true, lengthM: 300 }];
    setLinkProp('l1', 'wifiSecurity', 'wpa3-personal'); setLinkProp('l1', 'wifiCipher', 'aes'); setLinkProp('l1', 'cableStatus', 'active');
    const scritto = Object.assign({}, state.links[0]);
    setLinkProp('l1', 'wifiSecurity', ''); setLinkProp('l1', 'wifiCipher', '');
    return JSON.stringify({ scritto, dopo: state.links[0] });
  })()`));
  assert.equal(r.scritto.wifiSecurity, 'wpa3-personal');
  assert.equal(r.scritto.wifiCipher, 'aes');
  assert.equal(r.scritto.cableStatus, 'active');
  assert.equal(r.scritto.lengthM, 300);
  assert.equal('wifiSecurity' in r.dopo, false);
  assert.equal('wifiCipher' in r.dopo, false);
});

test('pannello client: la larghezza del canale del servente si vede nell\'ereditato, nel collegamento e nel pannello della radio client', () => {
  assert.match(pannelloLink(LNK()), /80 MHz/);
  const html = JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.links = [];
    state.nodes = [{ id:'ap1', type:'ap', name:'AP', ports:1, radios:[{ band:'5', width:80, ssids:[{ id:'s1', ssid:'Corp' }] }] },
                   { id:'cl1', type:'pc', name:'Client', ports:1, radios:[{}] }];
    state.links.push({ id:'l1', src:'ap1-radio', dst:'cl1-radio', wireless:true, bss:'s1' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const el = document.createElement('div'); _renderRadioProps(el, 'cl1-radio');
    return JSON.stringify({ html: el.innerHTML || '' });
  })()`)).html;
  assert.match(html, /5 GHz · ch [^<]*80 MHz|80 MHz/, 'il pannello della radio del client mostra la larghezza ereditata');
});
