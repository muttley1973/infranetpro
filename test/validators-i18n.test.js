'use strict';
// ============================================================
// I VALIDATORI PURI NON PARLANO ITALIANO (né alcuna lingua)
// ============================================================
// lib/cable-validate.js, lib/wifi-spec.js e lib/cabling.js emettono SOLO
// { level, code, variant?, params? }: le parole le mette il renderer via i18n
// (src/app-issue-text.js). Prima i messaggi erano hardcoded in italiano dentro
// le lib e un utente EN leggeva banner che non poteva capire — invisibile al
// test di parità, che guarda solo il dizionario.
//
// Qui si presidiano le due metà del contratto:
//   1. nessuna PROSA esce dalle lib;
//   2. per ogni code emesso esistono le chiavi i18n, in ITALIANO e IN INGLESE.
const test = require('node:test');
const assert = require('node:assert');
const { validateCable } = require('../lib/cable-validate.js');
const { validateWifi } = require('../lib/wifi-spec.js');
const { validateCablingChain } = require('../lib/cabling.js');
const { _i18nDict } = require('../lib/i18n.js');

// Casi che, insieme, fanno scattare OGNI regola dei tre validatori.
const CABLE_CASES = [
  [{ medium: 'copper', cableCategory: 'OM4' }, {}],
  [{ medium: 'fiber', cableCategory: 'Cat6' }, {}],
  [{ medium: 'copper', connector: 'LC' }, {}],
  [{ medium: 'fiber', connector: 'RJ45' }, {}],
  [{ medium: 'copper', cableCategory: 'Cat5e', maxSpeed: '10G' }, {}],
  [{ medium: 'copper', cableCategory: 'Cat6', maxSpeed: '10G' }, {}],
  [{ medium: 'copper', cableCategory: 'Cat8', maxSpeed: '100G' }, {}],
  [{ medium: 'copper', cableCategory: 'Cat6', length: 130 }, {}],
  [{ medium: 'copper', cableCategory: 'Cat8', maxSpeed: '40G', length: 60 }, {}],
  [{ medium: 'dac', length: 30 }, {}],
  [{ medium: 'fiber', poe: '802.3at' }, {}],
  [{ medium: 'copper', cableCategory: 'Cat5e', poe: '802.3bt' }, {}],
  [{ medium: 'copper', maxSpeed: '1G' }, { snmpSpeedMbps: 10000 }],
  [{ medium: 'copper' }, { snmpMedium: 'fiber' }],
  [{}, { isTrunk: true, srcNative: 1, dstNative: 99 }],
];
const WIFI_CASES = [
  { band: '2.4', channel: 99 },
  { band: '6', security: 'wpa2-psk' },
  { security: 'open' },
  { standard: 'wifi5', band: '2.4' },
];
const CHAIN_CASES = [
  ['pc', 'voip', 'wallport', 'patchpanel', 'switch', 'switch', 'switch'],
  ['pc', 'switch', 'wallport'],
  ['pc', 'wallport', 'pc'],
  ['pc', 'wallport'],
  ['pc', 'patchpanel', 'wallport', 'switch'],
];

const _allCable = () => CABLE_CASES.flatMap(([l, o]) => validateCable(l, o));
const _allWifi = () => WIFI_CASES.flatMap((c) => validateWifi(c));
const _allChain = () => CHAIN_CASES.flatMap((c) => validateCablingChain(c).warnings);

test('le lib pure non emettono PAROLE: solo level/code/variant/params', () => {
  const issues = _allCable().concat(_allWifi());
  assert.ok(issues.length >= 15, 'i casi coprono davvero le regole: ' + issues.length);
  for (const i of issues) {
    for (const banned of ['title', 'why', 'msg', 'label', 'text']) {
      assert.ok(!(banned in i), `campo di testo «${banned}» in ${i.code}: la lib sta parlando`);
    }
    assert.equal(typeof i.code, 'string');
    assert.ok(i.level === 'error' || i.level === 'warn', 'livello dichiarato: ' + i.code);
  }
  for (const w of _allChain()) {
    assert.ok(!('msg' in w), `msg in ${w.code}: la lib sta parlando`);
    assert.equal(typeof w.code, 'string');
  }
});

test('ogni codice emesso ha le sue chiavi i18n in ENTRAMBE le lingue', () => {
  // Se domani si aggiunge una regola e ci si dimentica la traduzione, `t()`
  // mostrerebbe la CHIAVE all'utente: questo test lo intercetta prima.
  const need = new Set();
  for (const i of _allCable()) {
    const b = 'cbl.' + i.code + (i.variant ? '.' + i.variant : '');
    need.add(b + '.t'); need.add(b + '.w');
    if (i.params && i.params.tail) need.add(b + '.' + i.params.tail);
  }
  for (const i of _allWifi()) { need.add('wfi.' + i.code + '.t'); need.add('wfi.' + i.code + '.w'); }
  for (const w of _allChain()) need.add('chn.' + w.code);
  // Le etichette dei mezzi: params grezzi (copper/fiber/dac) resi a parole.
  for (const m of ['copper', 'fiber', 'dac']) need.add('cbl.medium.' + m);

  // Sigle e acronimi sono gli stessi in ogni lingua: non sono traduzioni saltate.
  const SAME_OK = new Set(['cbl.medium.dac']);

  assert.ok(need.size >= 30, 'chiavi attese: ' + need.size);
  for (const k of need) {
    assert.ok(_i18nDict.it[k], 'manca la chiave IT: ' + k);
    assert.ok(_i18nDict.en[k], 'manca la chiave EN: ' + k);
    if (!SAME_OK.has(k)) {
      assert.notEqual(_i18nDict.it[k], _i18nDict.en[k], 'IT ed EN identici (traduzione dimenticata?): ' + k);
    }
  }
});

test('i params bastano a comporre la frase: nessun {segnaposto} resta scoperto', () => {
  // Simula ciò che fa src/app-issue-text.js: interpola i params nella stringa.
  // Un segnaposto rimasto significa che la lib non passa un dato che la frase usa.
  const fill = (s, p) => String(s).replace(/\{(\w+)\}/g, (m, k) => (p[k] != null ? p[k] : m));
  const check = (key, params, where) => {
    for (const lang of ['it', 'en']) {
      const out = fill(_i18nDict[lang][key], params);
      assert.doesNotMatch(out, /\{\w+\}/, `segnaposto scoperto in ${lang}/${key} (${where}): ${out}`);
    }
  };
  for (const i of _allCable()) {
    const b = 'cbl.' + i.code + (i.variant ? '.' + i.variant : '');
    // Il renderer aggiunge le etichette localizzate del mezzo: le simulo.
    const p = Object.assign({}, i.params);
    if (i.code === 'medium-vs-snmp') { p.snmpL = 'x'; p.docL = 'y'; }
    check(b + '.t', p, i.code); check(b + '.w', p, i.code);
    if (p.tail) check(b + '.' + p.tail, p, i.code);
  }
  for (const i of _allWifi()) { check('wfi.' + i.code + '.t', i.params || {}, i.code); check('wfi.' + i.code + '.w', i.params || {}, i.code); }
  for (const w of _allChain()) check('chn.' + w.code, w.params || {}, w.code);
});
