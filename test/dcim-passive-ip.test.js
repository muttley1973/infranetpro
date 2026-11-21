'use strict';
// ============================================================
// DCIM — un pannello passivo non ha un IP, e l'import lo DICE invece di scriverne uno nascosto.
// Un patch panel o un cassetto ottico ha, nel documento, solo l'hostname (il suo pannello Proprieta' non mostra IP).
// NetBox puo' dichiarargli un IP primario: prima entrava in `node.ip`, invisibile nel pannello ma presente negli
// export, nelle ricerche e nell'audit; ora non entra e il rapporto dell'import lo dice, come per le porte console.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const dcim = require('../lib/dcim-map.js');
const { buildDecisions } = require('../lib/dcim-decisions.js');
const i18n = require('../lib/i18n.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const RUOLI = [{ id: 30, slug: 'fiber-drawer', name: 'Fiber drawer' }, { id: 22, slug: 'patch-panel', name: 'Patch panel' }, { id: 31, slug: 'switch', name: 'Switch' }];
const dev = (id, role, extra) => Object.assign({ id, name: 'D' + id, role: { id: role }, rack: { id: 31 }, position: id % 40 + 1 }, extra || {});
const importa = (devices, selection) => dcim.netboxToState({ deviceRoles: RUOLI, racks: [{ id: 31, name: 'R1', u_height: 42 }], devices },
  selection ? { selection } : undefined);
const nodo = (r, id) => r.state.nodes.find((n) => n.id === 'nb-dev-' + id);
const IP4 = { address: '10.0.0.5/24' }, IP6 = { address: 'fd00::5/64' };

test('un cassetto o un patch panel con un IP in NetBox: l\'IP non entra nel nodo', () => {
  const r = importa([dev(301, 30, { primary_ip4: IP4 }), dev(302, 22, { primary_ip4: IP4, primary_ip6: IP6 })]);
  assert.equal(nodo(r, 301).type, 'fiberdrawer');
  assert.equal(nodo(r, 302).type, 'patchpanel');
  for (const id of [301, 302]) {
    assert.ok(!nodo(r, id).ip, `l'IPv4 di ${id} non entra`);
    assert.ok(!nodo(r, id).ip6, `l'IPv6 di ${id} non entra`);
  }
});

test('…e il rapporto lo dice: una riga per apparato, col numero degli indirizzi, e il testo fra gli avvisi', () => {
  const r = importa([dev(301, 30, { primary_ip4: IP4 }), dev(302, 22, { primary_ip4: IP4, primary_ip6: IP6 })]);
  const righe = r.report.issues.filter((i) => i.code === 'ip.passiveIgnored');
  assert.deepEqual(righe.map((i) => [i.deviceId, i.found]), [[301, 1], [302, 2]]);
  assert.equal(righe[0].deviceName, 'D301');
  assert.ok(r.report.warnings.some((w) => /device 301 \(fiberdrawer\)/.test(w)), 'e un avviso leggibile');
});

test('anche un SOLO indirizzo IPv6 su un pannello passivo non entra, ed e\' una riga', () => {
  const r = importa([dev(320, 30, { primary_ip6: IP6 }), dev(321, 22, { primary_ip6: IP6 })]);
  for (const id of [320, 321]) {
    assert.ok(!nodo(r, id).ip6, `l'IPv6 di ${id} non entra`);
    assert.ok(!nodo(r, id).ip);
  }
  assert.deepEqual(r.report.issues.filter((i) => i.code === 'ip.passiveIgnored').map((i) => [i.deviceId, i.found]), [[320, 1], [321, 1]]);
});

test('uno switch con un IP lo tiene, un cassetto senza IP non produce nessuna riga', () => {
  const r = importa([dev(310, 31, { primary_ip4: IP4 }), dev(311, 30)]);
  assert.equal(nodo(r, 310).ip, '10.0.0.5');
  assert.ok(!r.report.issues.some((i) => i.code === 'ip.passiveIgnored'));
});

test('la scelta fatta a mano nel menu conta: un apparato di un ruolo ignoto reso «Cassetto ottico» perde l\'IP, lasciato com\'e lo tiene', () => {
  const ignoto = { deviceRoles: [{ id: 90, slug: 'misc-gear', name: 'Misc' }], racks: [{ id: 31, name: 'R1', u_height: 42 }],
    devices: [{ id: 330, name: 'X', role: { id: 90 }, rack: { id: 31 }, position: 5, primary_ip4: IP4 }] };
  const com = dcim.netboxToState(ignoto).state.nodes[0];
  assert.notEqual(com.type, 'fiberdrawer');
  assert.equal(com.ip, '10.0.0.5', 'un apparato generico tiene il suo IP');
  const scelto = dcim.netboxToState(ignoto, { selection: { mapping: { 330: { type: 'fiberdrawer' } } } }).state.nodes[0];
  assert.equal(scelto.type, 'fiberdrawer');
  assert.ok(!scelto.ip, 'una volta cassetto, niente IP');
});

test('l\'elenco dei pannelli senza IP e quello del catalogo dei tipi (`patchLike`): se ne nasce uno, qui lo si sa', () => {
  const APP = loadApp(ROOT);
  const nelCatalogo = JSON.parse(run(APP.ctx, 'JSON.stringify(Object.keys(TYPES).filter(k => TYPES[k].patchLike).sort())'));
  assert.deepEqual([...dcim._PATCH_LIKE_TYPES].sort(), nelCatalogo);
});

test('il rapporto: una riga di PERDITA (qualcosa di dichiarato resta fuori), contata per apparato, con le frasi in italiano e in inglese', () => {
  const issues = [{ code: 'ip.passiveIgnored', deviceId: 1, deviceName: 'A', found: 1 }, { code: 'ip.passiveIgnored', deviceId: 2, deviceName: 'B', found: 2 }];
  const r = buildDecisions({ issues, counts: {} });
  const riga = r.info.find((x) => x.code === 'ip.passiveIgnored');
  assert.ok(riga, 'compare fra le righe informative');
  assert.equal(riga.severity, 'loss');
  assert.equal(riga.count, 2);
  assert.ok(r.outcome.costs.some((c) => c.code === 'ip.passiveIgnored' && c.n === 2), 'e fra le voci del preventivo');
  for (const lang of ['it', 'en']) {
    i18n.setLang(lang);
    const vars = Object.assign({ n: riga.count, code: riga.code }, riga.data);
    for (const key of ['dcim.dec.ip.passiveIgnored.title', 'dcim.dec.ip.passiveIgnored.titleOne', 'dcim.dec.ip.passiveIgnored.why',
      'dcim.cost.ip.passiveIgnored', 'dcim.cost.ip.passiveIgnoredOne']) {
      // (`t()` ripiega sull'italiano se in inglese manca: la presenza si guarda nel dizionario, non nel risultato)
      assert.ok(typeof i18n._i18nDict[lang][key] === 'string' && i18n._i18nDict[lang][key], `${lang}: manca ${key}`);
      const s = i18n.t(key, vars);
      assert.notEqual(s, key, `${lang}: manca ${key}`);
      assert.ok(!/\{[a-zA-Z]+\}/.test(s), `${lang}/${key}: graffa non sostituita in «${s}»`);
    }
  }
  i18n.setLang('it');
});
