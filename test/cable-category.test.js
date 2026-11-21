'use strict';
// ============================================================
// CABLE-CATEGORY — le categorie di un cavo, in un posto solo (lib/cable-category.js), e chi le usa.
// Il campo `cableCategory` lo scrive la tendina del pannello Cavo (quindici valori) ma anche l'import da NetBox, che
// le chiama `cat6a`, `mmf-om4`, `smf-os2`, `smf`. Prima l'import scriveva `cat6` e `fiber-sm`, il validatore cercava
// `Cat6` e `OS2`: le regole non scattavano sui cavi importati e la tendina mostrava «Non specificata» su un dato
// che c'era. Qui si prova che i tre pezzi parlano la stessa lingua.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const CC = require('../lib/cable-category.js');
const { validateCable } = require('../lib/cable-validate.js');
const dcim = require('../lib/dcim-map.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const ELENCO = ['Cat3', 'Cat5', 'Cat5e', 'Cat6', 'Cat6A', 'Cat7', 'Cat7A', 'Cat8', 'OS1', 'OS2', 'OM1', 'OM2', 'OM3', 'OM4', 'OM5'];

// ── la lib ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('le quindici categorie sono quelle della tendina del pannello Cavo, nello stesso ordine', () => {
  assert.deepEqual([...CC.CABLE_CATEGORIES], ELENCO);
  const src = fs.readFileSync(path.join(ROOT, 'src/app-properties-link.js'), 'utf8');
  const sel = /data-lprop="cableCategory"[^>]*>([\s\S]*?)<\/select>/.exec(src);
  assert.ok(sel, 'la tendina della categoria e\' cambiata di forma: aggiorna il test, non toglierlo');
  const opzioni = [...sel[1].matchAll(/<option value="([^"$]+)"/g)].map((m) => m[1]).filter(Boolean);
  assert.deepEqual(opzioni, ELENCO, 'la tendina offre esattamente le categorie della lib: una voce in piu\' o in meno e\' uno scarto');
});

test('canonicalCableCategory: ognuna delle quindici si riconosce, in qualunque scrittura', () => {
  for (const c of ELENCO) {
    assert.equal(CC.canonicalCableCategory(c), c);
    assert.equal(CC.canonicalCableCategory(c.toLowerCase()), c, c + ' minuscolo');
    assert.equal(CC.canonicalCableCategory(c.toUpperCase()), c, c + ' maiuscolo');
    assert.equal(CC.canonicalCableCategory('  ' + c + ' '), c, c + ' con spazi');
  }
  assert.equal(CC.canonicalCableCategory('CAT-6A'), 'Cat6A', 'anche con un separatore');
  assert.equal(CC.canonicalCableCategory('cat7a'), 'Cat7A', 'i gradi che NetBox ha e il pannello una volta no');
  for (const g of ['Cat3', 'Cat5', 'OS1', 'OM1', 'OM2']) assert.equal(CC.canonicalCableCategory(g.toLowerCase()), g, g);
});

test('canonicalCableCategory: quello che non e\' fra le quindici resta fuori, senza inventare un grado', () => {
  for (const x of ['fiber-sm', 'fiber-mm', 'smf', 'mmf', 'Cat9', 'Cat1', 'OM6', 'OS3', 'dac', 'aoc', 'mrj21-trunk', 'coaxial', '', null, undefined, 42, 'boh'])
    assert.equal(CC.canonicalCableCategory(x), '', String(x));
  for (const x of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) assert.equal(CC.canonicalCableCategory(x), '', `«${x}»: una chiave del prototipo non e' una categoria`);
});

test('cableCategoryKind: rame, fibra o niente — anche dove il grado non c\'e\'', () => {
  for (const x of ['Cat5e', 'cat6', 'Cat6A', 'Cat3', 'cat7a', 'CAT8']) assert.equal(CC.cableCategoryKind(x), 'copper', x);
  for (const x of ['OS2', 'os1', 'OM3', 'om1', 'OM5', 'fiber-sm', 'fiber-mm']) assert.equal(CC.cableCategoryKind(x), 'fiber', x);
  for (const x of ['dac', 'aoc', 'smf', 'mmf', '', null, undefined, 'categoria']) assert.equal(CC.cableCategoryKind(x), '', String(x));
});

test('cableCategoryFamily: monomodale o multimodale', () => {
  for (const x of ['OS1', 'os2', 'fiber-sm']) assert.equal(CC.cableCategoryFamily(x), 'sm', x);
  for (const x of ['OM1', 'om4', 'OM5', 'fiber-mm']) assert.equal(CC.cableCategoryFamily(x), 'mm', x);
  for (const x of ['Cat6', 'dac', '', null, 'smf']) assert.equal(CC.cableCategoryFamily(x), '', String(x));
});

// ── il validatore legge cio' che scrive l'import ─────────────────────────────────────────────────────────────────
const ODF = (mode) => [{ name: 'ODF-1', mode: mode || '' }];
const codici = (out) => out.map((i) => i.code);

test('validatore: una categoria scritta in minuscolo da un import vale quanto quella del pannello (stessi reperti)', () => {
  for (const c of ELENCO) {
    for (const extra of [{ medium: 'copper' }, { medium: 'fiber' }, { medium: 'copper', maxSpeed: '10G', length: 80 }, {}]) {
      const opts = { fiberEnds: ODF('sm-os2') };
      assert.deepEqual(validateCable(Object.assign({ cableCategory: c.toLowerCase() }, extra), opts),
        validateCable(Object.assign({ cableCategory: c }, extra), opts), `${c.toLowerCase()} come ${c} (${JSON.stringify(extra)})`);
    }
  }
});

test('validatore: rame importato (cat6, cat3) su un pannello solo fibra → errore, come a mano', () => {
  for (const cat of ['cat6', 'Cat6', 'cat6a', 'cat3', 'cat7a']) {
    assert.deepEqual(codici(validateCable({ cableCategory: cat }, { fiberEnds: ODF() })), ['fiber-panel-medium'], cat);
  }
});

test('validatore: la famiglia basta, anche senza grado (fiber-sm, fiber-mm, OM1): monomodale contro multimodale → avviso', () => {
  assert.deepEqual(codici(validateCable({ cableCategory: 'fiber-sm' }, { fiberEnds: ODF('mm-om4') })), ['fiber-panel-class']);
  assert.deepEqual(codici(validateCable({ cableCategory: 'fiber-mm' }, { fiberEnds: ODF('sm-os2') })), ['fiber-panel-class']);
  assert.deepEqual(codici(validateCable({ cableCategory: 'OM1' }, { fiberEnds: ODF('sm-os2') })), ['fiber-panel-class']);
  assert.deepEqual(validateCable({ cableCategory: 'fiber-sm' }, { fiberEnds: ODF('sm-os2') }), [], 'stessa famiglia: niente');
  assert.deepEqual(validateCable({ cableCategory: 'fiber-mm' }, { fiberEnds: ODF('mm-om3') }), []);
  assert.deepEqual(validateCable({ cableCategory: 'fiber-sm' }, { fiberEnds: ODF('') }), [], 'pannello senza classe: non si confronta');
});

test('validatore: la fibra non e\' rame, anche scritta come l\'import: il mezzo dichiarato contro la categoria', () => {
  assert.ok(codici(validateCable({ medium: 'copper', cableCategory: 'fiber-sm' })).includes('medium-cat'));
  assert.ok(codici(validateCable({ medium: 'fiber', cableCategory: 'cat6' })).includes('medium-cat'));
  assert.deepEqual(codici(validateCable({ medium: 'fiber', cableCategory: 'fiber-mm' })), [], 'coerente: niente');
});

test('validatore: un valore che non e\' ne rame ne fibra (dac, testo libero) non fa dire niente', () => {
  for (const cat of ['dac', 'aoc', 'boh', 'smf']) assert.deepEqual(validateCable({ cableCategory: cat }, { fiberEnds: ODF('sm-os2') }), [], cat);
});

// ── l'import scrive le categorie del pannello ────────────────────────────────────────────────────────────────────
// I 33 tipi di CableTypeChoices di NetBox (netbox/dcim/choices.py, ramo main, novembre 2026).
const TIPI_NETBOX = ['cat3', 'cat5', 'cat5e', 'cat6', 'cat6a', 'cat7', 'cat7a', 'cat8', 'mrj21-trunk', 'dac-active', 'dac-passive',
  'coaxial', 'rg-6', 'rg-8', 'rg-11', 'rg-59', 'rg-62', 'rg-213', 'lmr-100', 'lmr-200', 'lmr-400',
  'mmf', 'mmf-om1', 'mmf-om2', 'mmf-om3', 'mmf-om4', 'mmf-om5', 'smf', 'smf-os1', 'smf-os2', 'aoc', 'power', 'usb'];
test('l\'elenco dei tipi di NetBox qui sotto e\' quello giusto: 33 tipi, nessuno ripetuto', () => {
  assert.equal(TIPI_NETBOX.length, 33);
  assert.equal(new Set(TIPI_NETBOX).size, 33);
});

test('import NetBox: i tipi con un grado diventano la categoria del pannello, e il mezzo che il tipo dichiara', () => {
  const att = { cat3: ['Cat3', 'copper'], cat5: ['Cat5', 'copper'], cat5e: ['Cat5e', 'copper'], cat6: ['Cat6', 'copper'], cat6a: ['Cat6A', 'copper'], cat7: ['Cat7', 'copper'], cat7a: ['Cat7A', 'copper'], cat8: ['Cat8', 'copper'],
    'mmf-om1': ['OM1', 'fiber'], 'mmf-om2': ['OM2', 'fiber'], 'mmf-om3': ['OM3', 'fiber'], 'mmf-om4': ['OM4', 'fiber'], 'mmf-om5': ['OM5', 'fiber'], 'smf-os1': ['OS1', 'fiber'], 'smf-os2': ['OS2', 'fiber'] };
  for (const [nb, [cat, medium]] of Object.entries(att)) assert.deepEqual(dcim._cableFields(nb), { cableCategory: cat, medium }, nb);
  assert.deepEqual(dcim._cableFields({ value: 'smf-os2', label: 'SMF OS2' }), { cableCategory: 'OS2', medium: 'fiber' }, 'NetBox lo manda anche come oggetto {value,label}');
  assert.deepEqual(dcim._cableFields('SMF-OS2'), { cableCategory: 'OS2', medium: 'fiber' }, 'maiuscole');
});

test('import NetBox: dove NetBox dice di meno o di piu\', la categoria resta VUOTA e il testo di NetBox va in «Tipo di cavo»; il mezzo c\'e quando il tipo lo dichiara', () => {
  const mezzo = { smf: 'fiber', mmf: 'fiber', aoc: 'fiber', 'dac-active': 'dac', 'dac-passive': 'dac', 'mrj21-trunk': 'copper' };
  for (const [nb, medium] of Object.entries(mezzo)) assert.deepEqual(dcim._cableFields(nb), { cableType: nb, medium }, nb);
  // coassiale, alimentazione, USB: nessun mezzo in InfraNet, quindi niente — solo il testo
  for (const nb of ['coaxial', 'rg-6', 'rg-59', 'lmr-400', 'power', 'usb']) assert.deepEqual(dcim._cableFields(nb), { cableType: nb }, nb);
  for (const nb of [undefined, null, '', { value: '' }, {}]) assert.deepEqual(dcim._cableFields(nb), {}, JSON.stringify(nb));
});

test('import NetBox: per ognuno dei 33 tipi di cavo di NetBox: mai una categoria fuori dall\'elenco, e mai un mezzo che non sia dei tre', () => {
  for (const nb of TIPI_NETBOX) {
    const f = dcim._cableFields(nb);
    if (f.medium !== undefined) assert.ok(['copper', 'fiber', 'dac'].includes(f.medium), `${nb} → ${f.medium}`);
    if (f.cableCategory !== undefined) assert.ok(ELENCO.includes(f.cableCategory), `${nb} → ${f.cableCategory}`);
    assert.ok((f.cableCategory === undefined) !== (f.cableType === undefined), `${nb}: o la categoria o il tipo, non tutti e due ne nessuno`);
  }
});

// Il giro intero, dalla domanda dell'utente: un cassetto che arriva da NetBox, e i cavi che ci sono attaccati.
function importa(tipoCavo) {
  const nb = {
    deviceRoles: [{ id: 30, slug: 'fiber-drawer', name: 'Fiber drawer' }, { id: 31, slug: 'switch', name: 'Switch' }],
    racks: [{ id: 31, name: 'R1', u_height: 42 }],
    devices: [{ id: 301, name: 'ODF-A', role: { id: 30 }, rack: { id: 31 }, position: 10 }, { id: 302, name: 'SW-A', role: { id: 31 }, rack: { id: 31 }, position: 20 }],
    frontPorts: [{ id: 101, name: '1', type: { value: 'lc' }, device: { id: 301 } }],
    interfaces: [{ id: 900, name: 'Gi0/1', type: { value: '1000base-x-sfp' }, device: { id: 302 } }],
    cables: [{ id: 1, type: { value: tipoCavo }, a_terminations: [{ object_type: 'dcim.frontport', object_id: 101 }], b_terminations: [{ object_type: 'dcim.interface', object_id: 900 }] }],
  };
  const r = dcim.netboxToState(nb);
  assert.equal(r.state.links.length, 1, 'il cavo entra');
  assert.equal(r.state.nodes.find((n) => n.id === 'nb-dev-301').type, 'fiberdrawer');
  return r.state.links[0];
}

test('dal DCIM al cassetto: un cavo cat6 importato su un cassetto prende l\'errore «non e\' fibra», uno smf-os2 su un cassetto multimodale l\'avviso di classe', () => {
  assert.deepEqual(codici(validateCable(importa('cat6'), { fiberEnds: ODF('') })), ['fiber-panel-medium'], 'rame su fibra');
  assert.deepEqual(codici(validateCable(importa('smf-os2'), { fiberEnds: ODF('mm-om3') })), ['fiber-panel-class'], 'monomodale su multimodale');
  assert.deepEqual(validateCable(importa('smf-os2'), { fiberEnds: ODF('sm-os2') }), [], 'coerente: niente');
  assert.deepEqual(validateCable(importa('smf'), { fiberEnds: ODF('mm-om3') }), [], 'senza grado ne famiglia dichiarata: non si inventa (il testo di NetBox e solo un testo)');
  assert.equal(importa('smf').cableType, 'smf', 'e il testo di NetBox c\'e');
});

// ── la tendina mostra cio' che c'e' ───────────────────────────────────────────────────────────────────────────────
function tendina(cableCategory) {
  const APP = loadApp(ROOT);
  const html = run(APP.ctx, `(() => {
    state = _buildDefaultState();
    state.nodes = []; state.links = []; state.ports = {};
    state.ipam = { vlans:{}, prefixes:[], addresses:[] }; state.vlanNames = {}; state.vlanColors = state.vlanColors || {};
    state.nodes.push({ id:'sw1', type:'switch', name:'SW-A', ports:4 }, { id:'sw2', type:'switch', name:'SW-B', ports:4 });
    state.links.push({ id:'l1', src:'sw1-1', dst:'sw2-1', cableCategory:${JSON.stringify(cableCategory)} });
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    propagateVlans();
    _propsExplicit = true; selType = 'link'; selId = 'l1'; renderProps();
    return document.getElementById('props-panel').innerHTML || '';
  })()`);
  const m = /data-lprop="cableCategory"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  assert.ok(m, 'la tendina della categoria e\' stata disegnata');
  return [...m[1].matchAll(/<option value="([^"]*)"\s*(selected)?[^>]*>/g)].map((x) => ({ value: x[1], selected: !!x[2] }));
}
const scelte = (opts) => opts.filter((o) => o.selected).map((o) => o.value);

test('tendina: una categoria scritta in minuscolo dall\'import seleziona la voce giusta', () => {
  assert.deepEqual(scelte(tendina('cat6a')), ['Cat6A']);
  assert.deepEqual(scelte(tendina('os2')), ['OS2']);
  assert.deepEqual(scelte(tendina('OM4')), ['OM4']);
});

test('tendina: un valore che non e\' fra le quindici si MOSTRA com\'e\', non sembra «non specificata»', () => {
  const o = tendina('fiber-sm');
  assert.deepEqual(scelte(o), ['fiber-sm'], 'una voce in piu\', scelta, col valore che c\'e');
  assert.equal(o.find((x) => x.value === '').selected, false, '«non specificata» NON e scelta');
  assert.equal(o.length, 17, 'le quindici, «non specificata» e quella in piu\'');
  assert.deepEqual(scelte(tendina('')), [''], 'senza valore: «non specificata»');
  assert.equal(tendina('').length, 16, 'e nessuna voce in piu\'');
});

test('tendina: un valore con del markup dentro si escapa', () => {
  const html = run(loadApp(ROOT).ctx, `(() => {
    state = _buildDefaultState();
    state.nodes = []; state.links = []; state.ports = {};
    state.ipam = { vlans:{}, prefixes:[], addresses:[] }; state.vlanNames = {}; state.vlanColors = state.vlanColors || {};
    state.nodes.push({ id:'sw1', type:'switch', name:'SW-A', ports:4 }, { id:'sw2', type:'switch', name:'SW-B', ports:4 });
    state.links.push({ id:'l1', src:'sw1-1', dst:'sw2-1', cableCategory:'"><img src=x onerror=alert(1)>' });
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    propagateVlans();
    _propsExplicit = true; selType = 'link'; selId = 'l1'; renderProps();
    return document.getElementById('props-panel').innerHTML || '';
  })()`);
  assert.doesNotMatch(html, /<img src=x/, 'il valore non diventa un tag');
  assert.match(html, /&lt;img src=x/);
});
