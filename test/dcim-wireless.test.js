'use strict';
// ============================================================
// WIRELESS ↔ NETBOX — tre allineamenti: il CIFRARIO (auto, aes, tkip), le WLAN NON ATTIVE e i WIRELESS LINK.
// Prima: il cifrario di NetBox (`auth_cipher`) non esisteva in InfraNet, quindi un WPA/TKIP entrava come un WPA2 normale;
// una WLAN `disabled`, `deprecated` o `reserved` entrava come SSID vivo (e una riservata aperta faceva dire all'audit
// «rete aperta in uso»); i wireless link non venivano nemmeno scaricati. Qui si prova ognuno, dal dato NetBox al pannello.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const dcim = require('../lib/dcim-map.js');
const W = require('../lib/wifi-spec.js');
const RADIO = require('../lib/radio.js');
const { buildDecisions } = require('../lib/dcim-decisions.js');
const i18n = require('../lib/i18n.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const codici = (out) => out.map((i) => i.code);

// ── il cifrario nel modello e nelle regole ─────────────────────────────────────────────────────────────────────────
test('il vocabolario del cifrario e quello di NetBox: auto, aes, tkip', () => {
  assert.deepEqual([...W.WIFI_CIPHERS], ['auto', 'aes', 'tkip']);
});

test('TKIP con WPA2 e\' un avviso; con WPA3 un errore; su una rete aperta o con AES niente', () => {
  assert.deepEqual(codici(W.validateWifi({ security: 'wpa2-psk', cipher: 'tkip' })), ['tkip-weak']);
  assert.deepEqual(codici(W.validateWifi({ security: 'wpa2-ent', cipher: 'tkip' })), ['tkip-weak']);
  assert.deepEqual(codici(W.validateWifi({ cipher: 'tkip' })), ['tkip-weak'], 'sicurezza non detta: il cifrario dichiarato basta');
  assert.deepEqual(codici(W.validateWifi({ security: 'wpa3-personal', cipher: 'tkip' })), ['tkip-wpa3']);
  assert.deepEqual(codici(W.validateWifi({ security: 'wpa3-ent', cipher: 'tkip' })), ['tkip-wpa3']);
  assert.equal(W.validateWifi({ security: 'wpa3-personal', cipher: 'tkip' })[0].level, 'error');
  assert.equal(W.validateWifi({ security: 'wpa2-psk', cipher: 'tkip' })[0].level, 'warn');
  assert.deepEqual(codici(W.validateWifi({ security: 'open', cipher: 'tkip' })), ['open-network'], 'una rete aperta non ha cifrario di cui parlare');
  for (const c of ['aes', 'auto', '', undefined]) assert.deepEqual(W.validateWifi({ security: 'wpa2-psk', cipher: c }), [], String(c));
  assert.deepEqual(W.validateWifi({ security: 'wpa3-personal', cipher: 'aes' }), []);
});

test('le frasi dei due reperti esistono, in italiano e in inglese (se manca l\'inglese t() ripiega sull\'italiano: si guarda il dizionario)', () => {
  for (const lang of ['it', 'en']) {
    for (const k of ['wfi.tkip-weak.t', 'wfi.tkip-weak.w', 'wfi.tkip-wpa3.t', 'wfi.tkip-wpa3.w', 'radio.cipher']) {
      assert.ok(typeof i18n._i18nDict[lang][k] === 'string' && i18n._i18nDict[lang][k], `${lang}: manca ${k}`);
    }
  }
});

test('il modello: il cifrario sta nel BSS, scende dalla radio nella migrazione e lo trovano ssidById ed effBssCfg', () => {
  const n = { radios: [{ band: '5', ssid: 'Corp', security: 'wpa2-psk', cipher: 'tkip' }] };
  RADIO.migrateRadioSsids(n);
  assert.equal(n.radios[0].ssids[0].cipher, 'tkip');
  assert.equal('cipher' in n.radios[0], false, 'non resta sulla radio fisica');
  const id = n.radios[0].ssids[0].id;
  assert.equal(RADIO.ssidById(n, id).cipher, 'tkip');
  assert.equal(RADIO.effBssCfg(n.radios[0], id).cipher, 'tkip', 'il client eredita il cifrario del BSS');
});

// ── il pannello della radio (DOM finto) ────────────────────────────────────────────────────────────────────────────
let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

function pannello(ssid) {
  return JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];
    state.nodes.push({ id:'ap1', type:'ap', name:'AP', ports:1, radios:[{ band:'5', ssids:[Object.assign({ id:'s1' }, ${JSON.stringify(ssid)})] }] });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const el = document.createElement('div'); _renderRadioProps(el, 'ap1-radio');
    return JSON.stringify({ html: el.innerHTML || '' });
  })()`)).html;
}
const sel = (html, campo) => {
  const m = new RegExp('<select[^>]*data-field="' + campo + '">([\\s\\S]*?)</select>').exec(html);
  assert.ok(m, 'la tendina «' + campo + '» c\'e');
  return [...m[1].matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)].map((x) => ({ value: x[1], selected: !!x[2], label: x[3] }));
};

test('pannello: ogni SSID ha la tendina del cifrario — vuota, Auto, AES, TKIP — con la scelta fatta', () => {
  const o = sel(pannello({ ssid: 'Corp', security: 'wpa2-psk', cipher: 'aes' }), 'cipher');
  assert.deepEqual(o.map((x) => x.value), ['', 'auto', 'aes', 'tkip']);
  assert.deepEqual(o.filter((x) => x.selected).map((x) => x.value), ['aes']);
  assert.equal(o.find((x) => x.value === 'aes').label, 'AES (CCMP)');
  const nonDetto = sel(pannello({ ssid: 'Corp', security: 'wpa2-psk' }), 'cipher');
  assert.equal(nonDetto.filter((x) => x.selected).length, 0, 'non detto: nessuna voce scelta, e la prima (la vuota, «—») e quella che si vede');
  assert.equal(nonDetto[0].value, '');
});

test('pannello: TKIP con WPA2 mostra l\'avviso, con WPA3 l\'errore, con AES niente', () => {
  const weak = pannello({ ssid: 'Old', security: 'wpa2-psk', cipher: 'tkip' });
  assert.match(weak, /Cifrario TKIP: vecchio e debole/);
  assert.match(weak, /lvl-warn/);
  const wpa3 = pannello({ ssid: 'New', security: 'wpa3-personal', cipher: 'tkip' });
  assert.match(wpa3, /TKIP non è ammesso con WPA3/);
  assert.match(wpa3, /lvl-error/);
  const ok = pannello({ ssid: 'Ok', security: 'wpa2-psk', cipher: 'aes' });
  assert.doesNotMatch(ok, /Cifrario TKIP: vecchio e debole/);
  assert.doesNotMatch(ok, /TKIP non è ammesso/);
  assert.doesNotMatch(ok, /cable-validate-row/, 'nessun reperto');
});

test('pannello: scegliere il cifrario lo scrive nel BSS, svuotarlo lo toglie', () => {
  const r = JSON.parse(run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.nodes = []; state.links = [];
    state.nodes.push({ id:'ap1', type:'ap', name:'AP', ports:1, radios:[{ band:'5', ssids:[{ id:'s1', ssid:'Corp', security:'wpa2-psk' }] }] });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const bss = () => nodeById('ap1').radios[0].ssids[0];
    updateBssCfg('ap1', 0, 's1', 'cipher', 'tkip'); const dopo = bss().cipher;
    updateBssCfg('ap1', 0, 's1', 'cipher', ''); const svuotato = 'cipher' in bss();
    return JSON.stringify({ dopo, svuotato });
  })()`));
  assert.equal(r.dopo, 'tkip');
  assert.equal(r.svuotato, false);
});

// ── l'import: cifrario, WLAN non attive, wireless link ─────────────────────────────────────────────────────────────
const IF = (id, device, name, role, extra) => Object.assign({ id, device: { id: device }, name, type: { value: 'ieee802.11ax' },
  rf_role: { value: role }, rf_channel: { value: '5g-36-5180-20' }, wireless_lans: [] }, extra || {});
const WLAN = (id, ssid, extra) => Object.assign({ id, ssid, status: { value: 'active' }, auth_type: { value: 'wpa-personal' }, auth_cipher: { value: 'aes' } }, extra || {});
const DEV = (id, name, role, pos) => ({ id, name, role: { id: role }, rack: { id: 31 }, position: pos });
function importa(over) {
  const nb = Object.assign({
    deviceRoles: [{ id: 40, slug: 'access-point', name: 'AP' }, { id: 41, slug: 'pc', name: 'PC' }],
    racks: [{ id: 31, name: 'R', u_height: 42 }],
    devices: [DEV(310, 'AP-1', 40, 5), DEV(311, 'AP-2', 40, 9), DEV(312, 'CLI', 41, 12)],
    wirelessLans: [], interfaces: [], wirelessLinks: [],
  }, over || {});
  return dcim.netboxToState(nb);
}
const ssidsOf = (r, devId) => (r.state.nodes.find((n) => n.id === 'nb-dev-' + devId).radios[0].ssids || []);
const issue = (r, code) => r.report.issues.find((i) => i.code === code);

test('import: il cifrario di NetBox (aes, tkip, auto) arriva sul BSS; su una rete aperta non si scrive', () => {
  const r = importa({
    wirelessLans: [WLAN(1, 'A', { auth_cipher: { value: 'aes' } }), WLAN(2, 'T', { auth_cipher: { value: 'tkip' } }), WLAN(3, 'U', { auth_cipher: { value: 'auto' } }),
      WLAN(4, 'O', { auth_type: { value: 'open' }, auth_cipher: { value: 'auto' } }), WLAN(5, 'N', { auth_cipher: undefined }), WLAN(6, 'X', { auth_cipher: { value: 'des' } })],
    interfaces: [IF(900, 310, 'wlan0', 'ap', { wireless_lans: [1, 2, 3, 4, 5, 6].map((id) => ({ id })) })],
  });
  const per = Object.fromEntries(ssidsOf(r, 310).map((s) => [s.ssid, s.cipher]));
  assert.deepEqual(per, { A: 'aes', T: 'tkip', U: 'auto', O: undefined, N: undefined, X: undefined });
  assert.ok(!('cipher' in ssidsOf(r, 310).find((s) => s.ssid === 'O')));
  // il cifrario letto come stringa nuda (non {value}) vale lo stesso
  const r2 = importa({ wirelessLans: [WLAN(1, 'S', { auth_cipher: 'tkip' })], interfaces: [IF(900, 310, 'wlan0', 'ap', { wireless_lans: [{ id: 1 }] })] });
  assert.equal(ssidsOf(r2, 310)[0].cipher, 'tkip');
});

test('import: una WLAN TKIP con WPA2 entra e il validatore la segnala (la perdita non e\' piu silenziosa)', () => {
  const r = importa({ wirelessLans: [WLAN(1, 'Old', { auth_cipher: { value: 'tkip' } })], interfaces: [IF(900, 310, 'wlan0', 'ap', { wireless_lans: [{ id: 1 }] })] });
  const s = ssidsOf(r, 310)[0];
  assert.deepEqual(codici(W.validateWifi({ band: '5', security: s.security, cipher: s.cipher })), ['tkip-weak']);
});

test('import: solo le WLAN `active` (o senza stato) entrano; reserved, disabled, deprecated restano fuori', () => {
  const r = importa({
    wirelessLans: [WLAN(1, 'Viva'), WLAN(2, 'Spenta', { status: { value: 'disabled' } }), WLAN(3, 'Ritirata', { status: { value: 'deprecated' } }),
      WLAN(4, 'Riservata', { status: { value: 'reserved' }, auth_type: { value: 'open' } }), WLAN(5, 'SenzaStato', { status: undefined }), WLAN(6, 'Testo', { status: 'active' }), WLAN(7, 'TestoSpenta', { status: 'disabled' })],
    interfaces: [IF(900, 310, 'wlan0', 'ap', { wireless_lans: [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id })) })],
  });
  assert.deepEqual(ssidsOf(r, 310).map((s) => s.ssid), ['Viva', 'SenzaStato', 'Testo']);
  assert.equal(r.report.counts.ssids, 3, 'il conteggio e\' quello che atterra');
  const i = issue(r, 'wifi.inactiveSkipped');
  assert.equal(i.n, 4);
  assert.deepEqual(i.sample, ['Spenta (disabled)', 'Ritirata (deprecated)', 'Riservata (reserved)', 'TestoSpenta (disabled)']);
  // una riservata APERTA non diventa una «rete aperta in uso»
  assert.ok(!ssidsOf(r, 310).some((s) => s.security === 'open'));
});

test('import: una radio le cui WLAN sono tutte non attive entra lo stesso, senza SSID', () => {
  const r = importa({ wirelessLans: [WLAN(1, 'Spenta', { status: { value: 'disabled' } })], interfaces: [IF(900, 310, 'wlan0', 'ap', { wireless_lans: [{ id: 1 }] })] });
  const radio = r.state.nodes.find((n) => n.id === 'nb-dev-310').radios[0];
  assert.equal(radio.band, '5');
  assert.ok(!radio.ssids);
  assert.equal(r.report.counts.radios, 1);
});

test('import: nessuna WLAN non attiva, nessuna riga di rapporto', () => {
  const r = importa({ wirelessLans: [WLAN(1, 'Viva')], interfaces: [IF(900, 310, 'wlan0', 'ap', { wireless_lans: [{ id: 1 }] })] });
  assert.equal(issue(r, 'wifi.inactiveSkipped'), undefined);
});

const WL = (id, a, b, extra) => Object.assign({ id, interface_a: { id: a }, interface_b: { id: b }, status: { value: 'connected' } }, extra || {});
const ifs = () => [IF(900, 310, 'wlan0', 'ap', { wireless_lans: [{ id: 1 }] }), IF(901, 311, 'wlan0', 'ap'), IF(902, 312, 'wlan0', 'station'), IF(903, 312, 'wlan1', 'station')];

test('wireless link: ogni link fra due radio entrate diventa un collegamento radio↔radio (wireless:true, fra le due prese)', () => {
  const r = importa({ wirelessLans: [WLAN(1, 'Corp')], interfaces: ifs(), wirelessLinks: [WL(7, 902, 900, { ssid: 'Corp' })] });
  assert.equal(r.state.links.length, 1);
  const l = r.state.links[0];
  assert.equal(l.id, 'nb-wlink-7');
  assert.equal(l.wireless, true);
  assert.deepEqual([l.src, l.dst], ['nb-dev-312-radio', 'nb-dev-310-radio']);
  assert.equal(l.source, 'netbox');
  assert.equal(l.sourceWirelessLinkId, 7);
  assert.equal(r.report.counts.wirelessLinks, 1);
  assert.equal(issue(r, 'wifi.linksImported').n, 1);
  assert.equal(issue(r, 'wifi.linkSkipped'), undefined);
});

test('wireless link: le prese sono quelle vere (la seconda radio ha il pid -radio2) e i capi come numero nudo valgono', () => {
  const r = importa({ interfaces: ifs(), wirelessLinks: [WL(8, 903, 901), WL(9, 903, 900, { interface_a: 903, interface_b: 900 })] });
  const [a, b] = r.state.links;
  assert.deepEqual([a.src, a.dst], ['nb-dev-312-radio2', 'nb-dev-311-radio']);
  assert.deepEqual([b.src, b.dst], ['nb-dev-312-radio2', 'nb-dev-310-radio']);
  // ogni pid indica una radio che esiste nel nodo
  for (const l of r.state.links) for (const pid of [l.src, l.dst]) {
    const p = RADIO.parseRadioPid(pid);
    const n = r.state.nodes.find((x) => x.id === p.nodeId);
    assert.ok(n && n.radios[p.idx], pid);
  }
});

test('wireless link: l\'SSID del link diventa `bss` solo se la radio SERVENTE (ruolo ap) lo trasmette', () => {
  const base = { wirelessLans: [WLAN(1, 'Corp')], interfaces: ifs() };
  assert.equal(importa(Object.assign({ wirelessLinks: [WL(7, 902, 900, { ssid: 'Corp' })] }, base)).state.links[0].bss, 'nb-wl-1', 'SSID che l\'AP trasmette');
  assert.equal(importa(Object.assign({ wirelessLinks: [WL(7, 900, 902, { ssid: 'Corp' })] }, base)).state.links[0].bss, 'nb-wl-1', 'e dall\'altro verso');
  assert.ok(!('bss' in importa(Object.assign({ wirelessLinks: [WL(7, 902, 900, { ssid: 'Altra' })] }, base)).state.links[0]), 'SSID che l\'AP non trasmette: nessun BSS inventato');
  assert.ok(!('bss' in importa(Object.assign({ wirelessLinks: [WL(7, 902, 900)] }, base)).state.links[0]), 'link senza SSID');
  assert.ok(!('bss' in importa(Object.assign({ wirelessLinks: [WL(7, 900, 901, { ssid: 'Corp' })] }, base)).state.links[0]), 'due AP: chi serve non e\' deciso');
  assert.ok(!('bss' in importa(Object.assign({ wirelessLinks: [WL(7, 902, 903, { ssid: 'Corp' })] }, base)).state.links[0]), 'due stazioni: nessun servente');
});

test('wireless link: `planned` non entra (non e\' ancora un\'associazione), `decommissioning` si', () => {
  const r = importa({ interfaces: ifs(), wirelessLinks: [WL(7, 902, 900, { status: { value: 'planned' } }), WL(8, 903, 901, { status: { value: 'decommissioning' } }), WL(9, 902, 901, { status: 'planned' })] });
  assert.deepEqual(r.state.links.map((l) => l.id), ['nb-wlink-8']);
  assert.deepEqual([issue(r, 'wifi.linkSkipped').n, issue(r, 'wifi.linkSkipped').planned, issue(r, 'wifi.linkSkipped').unresolved], [2, 2, 0]);
});

test('wireless link: un capo che non e\' entrato (interfaccia sconosciuta, o radio oltre il tetto di 8) lascia il link fuori, e lo dice', () => {
  const nove = Array.from({ length: 9 }, (_, k) => IF(2000 + k, 310, 'wlan' + k, 'ap'));
  const r = importa({ interfaces: nove.concat([IF(902, 312, 'wlan0', 'station')]), wirelessLinks: [WL(7, 902, 2008), WL(8, 902, 9999), WL(9, 902, 2000)] });
  assert.deepEqual(r.state.links.map((l) => l.id), ['nb-wlink-9'], 'solo la nona radio (indice 8) e l\'interfaccia ignota restano fuori');
  const s = issue(r, 'wifi.linkSkipped');
  assert.deepEqual([s.n, s.planned, s.unresolved], [2, 0, 2]);
  assert.equal(r.report.counts.radios, 9, 'ogni apparato ha il suo tetto di 8: 8 radio sull\'apparato con nove interfacce + 1 della stazione');
  assert.equal(r.report.issues.find((i) => i.code === 'wifi.radiosCapped').n, 1, 'e la nona e\' dichiarata, come prima');
});

test('wireless link: un link fra una radio e se stessa non entra', () => {
  const r = importa({ interfaces: ifs(), wirelessLinks: [WL(7, 900, 900)] });
  assert.equal(r.state.links.length, 0);
  assert.equal(issue(r, 'wifi.linkSkipped').unresolved, 1);
});

test('wireless link: senza link (o senza il campo) niente di niente', () => {
  const r = importa({ interfaces: ifs() });
  assert.equal(r.report.counts.wirelessLinks, 0);
  assert.equal(issue(r, 'wifi.linksImported'), undefined);
  assert.equal(issue(r, 'wifi.linkSkipped'), undefined);
  const nb = { deviceRoles: [{ id: 40, slug: 'access-point', name: 'AP' }], racks: [{ id: 31, name: 'R', u_height: 42 }], devices: [DEV(310, 'AP-1', 40, 5)], interfaces: [IF(900, 310, 'wlan0', 'ap')] };
  assert.doesNotThrow(() => dcim.netboxToState(nb));
});

test('wireless link: i cavi e i wireless link convivono, e i link wireless non finiscono fra i cavi', () => {
  const nb = {
    deviceRoles: [{ id: 40, slug: 'access-point', name: 'AP' }, { id: 31, slug: 'switch', name: 'Switch' }], racks: [{ id: 31, name: 'R', u_height: 42 }],
    devices: [DEV(310, 'AP-1', 40, 5), DEV(311, 'SW', 31, 9), DEV(312, 'AP-2', 40, 12)],
    interfaces: [IF(900, 310, 'wlan0', 'ap'), IF(901, 312, 'wlan0', 'station'),
      { id: 950, device: { id: 310 }, name: 'Gi0/1', type: { value: '1000base-t' } }, { id: 951, device: { id: 311 }, name: 'Gi0/1', type: { value: '1000base-t' } }],
    cables: [{ id: 1, type: { value: 'cat6' }, a_terminations: [{ object_type: 'dcim.interface', object_id: 950 }], b_terminations: [{ object_type: 'dcim.interface', object_id: 951 }] }],
    wirelessLinks: [WL(7, 901, 900)],
  };
  const r = dcim.netboxToState(nb);
  assert.equal(r.state.links.length, 2);
  assert.equal(r.state.links.filter((l) => l.wireless).length, 1);
  assert.equal(r.report.counts.cables, 1, 'il cavo e\' uno');
  assert.equal(r.report.counts.wirelessLinks, 1);
});

// ── il rapporto ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('il rapporto: le tre righe nuove hanno gravita\' e frasi in italiano e in inglese, senza graffe rimaste', () => {
  const issues = [
    { code: 'wifi.inactiveSkipped', n: 2, sample: ['A (disabled)', 'B (reserved)'] },
    { code: 'wifi.linksImported', n: 3 },
    { code: 'wifi.linkSkipped', n: 2, planned: 1, unresolved: 1 },
  ];
  const r = buildDecisions({ issues, counts: {} });
  const riga = (c) => r.info.find((x) => x.code === c);
  assert.equal(riga('wifi.inactiveSkipped').severity, 'loss');
  assert.equal(riga('wifi.linkSkipped').severity, 'loss');
  assert.equal(riga('wifi.linksImported').severity, 'info');
  assert.equal(riga('wifi.inactiveSkipped').count, 2);
  for (const c of ['wifi.inactiveSkipped', 'wifi.linkSkipped']) assert.ok(r.outcome.costs.some((x) => x.code === c), c + ' e\' fra le voci del preventivo');
  for (const lang of ['it', 'en']) {
    i18n.setLang(lang);
    for (const c of ['wifi.inactiveSkipped', 'wifi.linksImported', 'wifi.linkSkipped']) {
      const row = riga(c);
      const vars = Object.assign({ n: row.count, code: row.code }, row.data);
      const chiavi = ['dcim.dec.' + c + '.title', 'dcim.dec.' + c + '.titleOne', 'dcim.dec.' + c + '.why'];
      if (row.severity === 'loss') chiavi.push('dcim.cost.' + c, 'dcim.cost.' + c + 'One');
      for (const k of chiavi) {
        assert.ok(i18n._i18nDict[lang][k], `${lang}: manca ${k}`);
        const s = i18n.t(k, vars);
        assert.ok(!/\{[a-zA-Z]+\}/.test(s), `${lang}/${k}: graffa non sostituita in «${s}»`);
      }
    }
    assert.ok(i18n._i18nDict[lang]['integrations.cWirelessLinks'], `${lang}: manca integrations.cWirelessLinks`);
  }
  i18n.setLang('it');
});
