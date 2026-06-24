// Test per la logica PURA delle interfacce radio (lib/radio.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/radio.js');

test('radioPid: idx 0 mantiene il suffisso storico -radio', () => {
  assert.equal(R.radioPid('n5', 0), 'n5-radio');
  assert.equal(R.radioPid('n5', 1), 'n5-radio2');
  assert.equal(R.radioPid('n5', 7), 'n5-radio8');
  assert.equal(R.radioPid('n5'),    'n5-radio');   // idx mancante = 0
});

test('parseRadioPid: round-trip e casi limite', () => {
  for (let i = 0; i < R.MAX_RADIOS; i++) {
    const pid = R.radioPid('node-12', i);
    assert.deepEqual(R.parseRadioPid(pid), { nodeId: 'node-12', idx: i }, pid);
  }
  assert.equal(R.parseRadioPid('n5-3'), null);      // porta fisica
  assert.equal(R.parseRadioPid('n5'), null);        // nessuna radio
  assert.equal(R.parseRadioPid('n5-radio1'), null); // '-radio1' non è valido (lo è '-radio')
  assert.equal(R.parseRadioPid(''), null);
  assert.equal(R.parseRadioPid('-radio'), null);    // nodeId vuoto
});

test('linkKind: radio↔radio=wireless, rete↔rete=cable, mix=invalid', () => {
  assert.equal(R.linkKind(true,  true),  'wireless');
  assert.equal(R.linkKind(false, false), 'cable');
  assert.equal(R.linkKind(true,  false), 'invalid');  // radio↔rete non ammesso
  assert.equal(R.linkKind(false, true),  'invalid');
});

test('radioAnchorSlots: 4 angoli poi 4 centri-lato, clamp a 8', () => {
  assert.deepEqual(R.radioAnchorSlots(0), []);
  assert.deepEqual(R.radioAnchorSlots(4), ['tr', 'tl', 'br', 'bl']);
  assert.deepEqual(R.radioAnchorSlots(8), ['tr', 'tl', 'br', 'bl', 'tc', 'bc', 'lc', 'rc']);
  assert.equal(R.radioAnchorSlots(99).length, 8);  // clamp
  assert.deepEqual(R.radioAnchorSlots(-3), []);
});

test('radioAnchorVector: vettore d’angolo per idx/conteggio', () => {
  // count=4 → ['tr','tl','br','bl']
  assert.deepEqual(R.radioAnchorVector(0, 4), [1, -1]);   // tr
  assert.deepEqual(R.radioAnchorVector(3, 4), [-1, 1]);   // bl
  // count=8 → aggiunge i centri-lato
  assert.deepEqual(R.radioAnchorVector(4, 8), [0, -1]);   // tc
  assert.deepEqual(R.radioAnchorVector(7, 8), [1, 0]);    // rc
  assert.equal(R.radioAnchorVector(5, 4), null);          // idx oltre il conteggio
});

test('radioCount: dimensione effettiva clampata a 8', () => {
  assert.equal(R.radioCount(null), 0);
  assert.equal(R.radioCount({}), 0);
  assert.equal(R.radioCount({ radios: [{}, {}, {}] }), 3);
  assert.equal(R.radioCount({ radios: new Array(20).fill({}) }), 8);
});

test('setRadioCount: crea, tronca, idempotente; 0 rimuove la chiave', () => {
  const n = {};
  R.setRadioCount(n, 3);
  assert.equal(n.radios.length, 3);
  R.setRadioCount(n, 5);
  assert.equal(n.radios.length, 5);
  R.setRadioCount(n, 2);
  assert.equal(n.radios.length, 2);
  R.setRadioCount(n, 99);
  assert.equal(n.radios.length, R.MAX_RADIOS);  // clamp
  R.setRadioCount(n, 0);
  assert.equal(n.radios, undefined);            // azzera → niente chiave
});

test('setRadioCount: non distrugge la config delle radio esistenti', () => {
  const n = { radios: [{ ssid: 'A', band: '5' }] };
  R.setRadioCount(n, 2);
  assert.equal(n.radios[0].ssid, 'A');          // la #0 resta intatta
  assert.deepEqual(n.radios[1], {});            // la nuova è vuota
});

test('migrateNodeRadios: da wifiCfg legacy a una radio', () => {
  const n = { type: 'ap', wifiCfg: { ssid: 'Aziendale', band: '5', channel: 44 } };
  R.migrateNodeRadios(n);
  assert.equal(n.radios.length, 1);
  assert.equal(n.radios[0].ssid, 'Aziendale');
  assert.equal(n.radios[0].channel, 44);
});

test('migrateNodeRadios: AP senza dati parte con 1 radio se defaultOn', () => {
  const ap = { type: 'ap' };
  R.migrateNodeRadios(ap, { defaultOn: true });
  assert.equal(R.radioCount(ap), 1);

  const pc = { type: 'pc' };
  R.migrateNodeRadios(pc);          // niente wifi, niente default → niente radio
  assert.equal(R.radioCount(pc), 0);
});

test('migrateNodeRadios: idempotente, non tocca radios già presenti', () => {
  const n = { radios: [{ ssid: 'X' }], wifiCfg: { ssid: 'Y' } };
  R.migrateNodeRadios(n);
  assert.equal(n.radios.length, 1);
  assert.equal(n.radios[0].ssid, 'X');   // invariato
});

test('migrateNodeRadios: wifi=false esplicito non crea radio', () => {
  const n = { type: 'ap', wifi: false };
  R.migrateNodeRadios(n, { defaultOn: true });
  assert.equal(R.radioCount(n), 0);
});

test('inheritRadioCfgForLink: preferisce l’estremo che serve BSS + risolve link.bss', () => {
  const radios = {
    'ap-radio': { node: { id: 'ap' }, radio: { band: '5', channel: 36, ssids: [
      { id: 'b1', ssid: 'Office', vlan: 10 }, { id: 'b2', ssid: 'Guest', vlan: 20 } ] } },
    'cl-radio': { node: { id: 'cl' }, radio: { ssids: [] } },   // station senza BSS
  };
  const lookup = pid => radios[pid] || null;
  const link = { src: 'cl-radio', dst: 'ap-radio', bss: 'b2' };
  const got = R.inheritRadioCfgForLink(link, lookup);
  assert.equal(got.cfg.ssid, 'Guest');   // il BSS scelto da link.bss
  assert.equal(got.cfg.vlan, 20);
  assert.equal(got.cfg.band, '5');        // PHY ereditata dalla radio
});

test('inheritRadioCfgForLink: bss assente → primo BSS con SSID; nessun estremo radio → null', () => {
  const radios = {
    'a-radio': { node: { id: 'a' }, radio: { band: '5', ssids: [{ id: 'x', ssid: 'Net', vlan: 30 }] } },
    'b-radio': { node: { id: 'b' }, radio: { ssids: [] } },
  };
  const lookup = pid => radios[pid] || null;
  const got = R.inheritRadioCfgForLink({ src: 'a-radio', dst: 'b-radio' }, lookup);
  assert.equal(got.cfg.ssid, 'Net');
  assert.equal(R.inheritRadioCfgForLink({ src: 'x-1', dst: 'y-1' }, lookup), null);
});

test('migrateRadioSsids: flatten ssid/vlan/security → ssids[], PHY restano, idempotente', () => {
  const n = { radios: [{ ssid: 'Office', vlan: 10, security: 'wpa2-psk', band: '5', channel: 36 }] };
  R.migrateRadioSsids(n);
  const r = n.radios[0];
  assert.equal(r.ssid, undefined);              // sceso nel BSS
  assert.equal(r.band, '5');                    // PHY resta sulla radio
  assert.equal(r.ssids.length, 1);
  assert.equal(r.ssids[0].ssid, 'Office');
  assert.equal(r.ssids[0].vlan, 10);
  assert.ok(r.ssids[0].id);                     // id stabile assegnato
  const id0 = r.ssids[0].id;
  R.migrateRadioSsids(n);                        // seconda passata = no-op
  assert.equal(n.radios[0].ssids.length, 1);
  assert.equal(n.radios[0].ssids[0].id, id0);   // id invariato
});

test('migrateRadioSsids: radio vuota (stazione) non riceve ssids', () => {
  const n = { radios: [{}, { band: '5' }] };
  R.migrateRadioSsids(n);
  assert.equal(n.radios[0].ssids, undefined);
  assert.equal(n.radios[1].ssids, undefined);
});

test('apSsidList: enumera TUTTI i BSS di TUTTE le radio (radioIdx, id, vlan, band)', () => {
  const n = { radios: [
    { band: '2.4', ssids: [{ id: 'a', ssid: 'Office', vlan: 10 }] },
    { band: '5',   ssids: [{ id: 'b', ssid: 'Guest', vlan: 20 }, { id: 'c', ssid: 'VoIP', vlan: 30 }] },
  ] };
  const list = R.apSsidList(n);
  assert.equal(list.length, 3);
  assert.deepEqual(list.map(o => o.ssid), ['Office', 'Guest', 'VoIP']);
  assert.deepEqual(list.map(o => o.radioIdx), [0, 1, 1]);
  assert.equal(list[1].band, '5');
  assert.equal(list[2].vlan, 30);
});

test('ssidById: risolve il BSS su tutto il device; vlan fuori range torna grezza', () => {
  const n = { radios: [{ band: '5', channel: 44, ssids: [{ id: 'g', ssid: 'Guest', vlan: 20 }] }] };
  const s = R.ssidById(n, 'g');
  assert.equal(s.ssid, 'Guest');
  assert.equal(s.radioIdx, 0);
  assert.equal(s.band, '5');
  assert.equal(s.channel, 44);
  assert.equal(R.ssidById(n, 'nope'), null);
});

test('effBssCfg: unisce PHY radio + BSS scelto; fallback al primo BSS', () => {
  const radio = { band: '5', channel: 36, standard: 'ax', ssids: [
    { id: 'b1', ssid: 'Office', vlan: 10 }, { id: 'b2', ssid: 'Guest', vlan: 20 } ] };
  const a = R.effBssCfg(radio, 'b2');
  assert.equal(a.ssid, 'Guest'); assert.equal(a.vlan, 20); assert.equal(a.band, '5');
  const b = R.effBssCfg(radio, 'missing');
  assert.equal(b.ssid, 'Office');   // fallback primo BSS con SSID
});
