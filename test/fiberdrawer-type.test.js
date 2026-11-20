'use strict';
// ============================================================
//  IL CASSETTO OTTICO E' UN PASSIVO DI RACK, NEL MENU DEI PASSIVI
// ============================================================
// Un cassetto ottico (sliding fiber drawer / ODF da 19", 1U) e' un pannello di terminazione: ha porte
// pass-through come un patch panel, ma le porte sono adattatori in fibra. Si trascina dal menu a sinistra,
// gruppo «Rack · Passivi», e deve nascere come un passivo vero: senza IP, in rack, a 1U.
//
// Qui si prova solo la REGISTRAZIONE del tipo — dove vive, cosa dice di se' —, non le sue proprieta' (che
// sono un passo successivo, dopo il frontale). Le attese si ricavano dal codice e dal menu: l'icona del menu
// deve essere quella del tipo, e il testo italiano del menu quello del dizionario, altrimenti la stessa voce
// racconta due cose a due centimetri di distanza.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');
const i18n = require('../lib/i18n.js');

const ROOT = path.join(__dirname, '..');
const IT = i18n._i18nDict.it;
const EN = i18n._i18nDict.en;
let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

const dalCodice = (espressione) => JSON.parse(run(APP.ctx, `JSON.stringify((() => { try { return ${espressione}; } catch (e) { return { __err: String(e && e.message || e) }; } })())`));

/** Le voci del gruppo «Rack · Passivi» del menu, nell'ordine: [{ type, icon, key, testo }]. */
function vociPassivi() {
  const html = fs.readFileSync(path.join(ROOT, 'netmapper.html'), 'utf8');
  const m = /<section class="palette-group" data-palette-group="rack_passive">([\s\S]*?)<\/section>/.exec(html);
  assert.ok(m, 'il gruppo «rack_passive» non e\' piu\' nel menu: aggiorna il test, non toglierlo');
  return [...m[1].matchAll(/<div class="equip-item"[^>]*data-type="(\w+)"[^>]*><i class="fas (fa-[\w-]+)"><\/i> <span data-i18n="([\w.]+)">([^<]*)<\/span>/g)]
    .map((x) => ({ type: x[1], icon: x[2], key: x[3], testo: x[4] }));
}

test('il tipo esiste ed e\' un passivo di rack a 1U, pass-through sulla porta, senza IP', () => {
  const t = dalCodice('TYPES.fiberdrawer');
  assert.ok(t && !t.__err, 'TYPES.fiberdrawer: ' + JSON.stringify(t));
  assert.equal(t.isRack, true, 'sta in un rack');
  assert.equal(t.isPassive, true, 'e\' passivo: niente IP, niente MAC, niente SNMP');
  assert.equal(t.passThrough, 'port', 'ogni adattatore e\' una tappa, come le porte di un patch panel');
  assert.equal(t.sizeU, 1, 'un cassetto estraibile da 19" e\' alto 1U');
  assert.equal(t.ports, 24, '24 adattatori LC duplex = 48 fibre: la configurazione piu\' comune');
  assert.ok(!t.isActive && !t.hasIP, 'nessun flag che lo faccia passare per un apparato');
});

test('compare nel menu «Rack · Passivi», subito dopo il Patch Panel, con l\'icona del tipo', () => {
  const voci = vociPassivi();
  const tipi = voci.map((v) => v.type);
  assert.ok(tipi.includes('fiberdrawer'), 'voci del gruppo: ' + tipi.join(', '));
  assert.equal(tipi[tipi.indexOf('patchpanel') + 1], 'fiberdrawer', 'sta accanto al pannello di cui e\' parente');
  const v = voci.find((x) => x.type === 'fiberdrawer');
  assert.equal(v.icon, dalCodice('TYPES.fiberdrawer.icon'), 'l\'icona del menu e\' quella del tipo');
  assert.equal(v.key, 'dev.fiberdrawer');
  assert.equal(v.testo, IT['dev.fiberdrawer'], 'il testo statico del menu e\' quello del dizionario italiano');
});

test('il nome si dice in italiano e in inglese, e dice che e\' 1U', () => {
  for (const [lingua, d] of [['it', IT], ['en', EN]]) {
    for (const k of ['dev.fiberdrawer', 'type.fiberdrawer']) {
      assert.ok(typeof d[k] === 'string' && d[k].trim().length > 0, `${lingua}: manca ${k}`);
    }
    assert.match(d['dev.fiberdrawer'], /\(1U\)/, `${lingua}: la voce del menu dice l'altezza, come le sorelle`);
  }
  assert.equal(IT['type.fiberdrawer'], 'Cassetto ottico');
  assert.equal(dalCodice('typeName("fiberdrawer")'), 'Cassetto ottico', 'la funzione che nomina il tipo lo trova');
});

test('i nodi del tipo prendono un id col loro prefisso, distinto da quello di ogni altro tipo', () => {
  const pre = dalCodice('NODE_ID_PREFIX');
  assert.equal(pre.fiberdrawer, 'fd');
  const altri = Object.entries(pre).filter(([k]) => k !== 'fiberdrawer').map(([, v]) => v);
  assert.ok(!altri.includes('fd'), 'il prefisso «fd» non e\' di nessun altro tipo');
});

test('l\'assistente AI lo conta fra i passivi senza IP (non lo scambia per un apparato da interrogare)', () => {
  const { _PASSIVE_NO_IP_TYPES } = require('../server/ai/context.js');
  assert.ok(_PASSIVE_NO_IP_TYPES.has('fiberdrawer'));
  assert.ok(_PASSIVE_NO_IP_TYPES.has('patchpanel'), 'e il parente di rame c\'e\' ancora');
});
