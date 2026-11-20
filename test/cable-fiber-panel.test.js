'use strict';
// ============================================================
//  IL CAVO E IL PANNELLO SOLO-FIBRA: due contraddizioni che il pannello del cavo ora nomina
// ============================================================
// Un cassetto ottico (e un patch panel dichiarato «fibra») accetta solo fibra, e dichiara la CLASSE della sua fibra
// (monomodale OS1/OS2, multimodale OM1…OM5). Il cavo ha il suo mezzo (rame/fibra/DAC) e la sua categoria (Cat…/OS2/OM…), ma
// i due non si parlavano: un cavo in rame attaccato a una porta del cassetto, o un cavo multimodale su un cassetto
// monomodale, passava senza una parola. Due reperti, entrambi SOLO su dati dichiarati da una persona (nessun mezzo, nessuna
// classe, niente da dire): «cavo non ottico su un pannello ottico» (error, come «RJ45 su fibra») e «classe diversa»
// (warn: da fuori non si distingue una scelta voluta da una svista).
// Non si confronta il CONNETTORE: un cordone LC-SC e' un prodotto comune e il cavo ha un connettore solo per i due capi.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { validateCable } = require('../lib/cable-validate.js');
const { fiberOnlyPanel } = require('../lib/fiber-slot.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

// ── La definizione unica: quale nodo e' un pannello solo-fibra ─────────────────────────────────────────────
test('fiberOnlyPanel: il cassetto ottico lo e\' sempre, col suo modo (spec o nodo vecchio)', () => {
  assert.deepEqual(fiberOnlyPanel({ type: 'fiberdrawer' }), { mode: '' });
  assert.deepEqual(fiberOnlyPanel({ type: 'fiberdrawer', spec: { ppFiberMode: 'sm-os2' } }), { mode: 'sm-os2' });
  assert.deepEqual(fiberOnlyPanel({ type: 'fiberdrawer', ppFiberMode: 'mm-om4' }), { mode: 'mm-om4' }, 'progetti vecchi: il campo sta sul nodo');
  assert.deepEqual(fiberOnlyPanel({ type: 'fiberdrawer', ppFiberMode: 'mm-om3', spec: { ppFiberMode: 'sm-os1' } }), { mode: 'sm-os1' }, 'la spec vince');
});

test('fiberOnlyPanel: un patch panel solo se e\' dichiarato «fibra» — «misto» e «rame» no, e nemmeno «non dichiarato»', () => {
  assert.deepEqual(fiberOnlyPanel({ type: 'patchpanel', spec: { ppMedia: 'fiber', ppFiberMode: 'mm-om4' } }), { mode: 'mm-om4' });
  assert.deepEqual(fiberOnlyPanel({ type: 'patchpanel', ppMedia: 'fiber' }), { mode: '' });
  for (const media of ['mixed', 'copper', '', undefined]) {
    assert.equal(fiberOnlyPanel({ type: 'patchpanel', spec: { ppMedia: media } }), null, `ppMedia ${String(media)}: non e' detto che sia fibra`);
  }
});

test('fiberOnlyPanel: gli altri nodi non lo sono, e un dato mancante non rompe', () => {
  for (const type of ['switch', 'router', 'wallport', 'blankpanel', 'cablemanager', 'server']) assert.equal(fiberOnlyPanel({ type, spec: { ppMedia: 'fiber' } }), null, type);
  assert.equal(fiberOnlyPanel(null), null);
  assert.equal(fiberOnlyPanel(undefined), null);
  assert.equal(fiberOnlyPanel({}), null);
});

// ── Le regole ──────────────────────────────────────────────────────────────────────────────────────────────
const ODF = (mode) => [{ name: 'ODF-1', mode: mode || '' }];
const codici = (issues) => issues.map((i) => i.code);

test('un cavo che non e\' su un pannello ottico non prende questi reperti (le regole di prima non cambiano)', () => {
  for (const link of [{ medium: 'copper' }, { medium: 'fiber', cableCategory: 'OM4' }, { medium: 'dac' }, {}]) {
    assert.deepEqual(codici(validateCable(link, {})).filter((c) => /^fiber-panel/.test(c)), []);
    assert.deepEqual(codici(validateCable(link, { fiberEnds: [] })).filter((c) => /^fiber-panel/.test(c)), []);
  }
});

test('rame o DAC su un pannello ottico → error fiber-panel-medium, col nome del pannello e il mezzo', () => {
  const rame = validateCable({ medium: 'copper' }, { fiberEnds: ODF() }).filter((i) => i.code === 'fiber-panel-medium');
  assert.deepEqual(rame, [{ level: 'error', code: 'fiber-panel-medium', params: { name: 'ODF-1', doc: 'copper' } }]);
  const dac = validateCable({ medium: 'dac' }, { fiberEnds: ODF() }).filter((i) => i.code === 'fiber-panel-medium');
  assert.equal(dac[0].params.doc, 'dac');
});

test('senza mezzo dichiarato ma con una categoria di RAME (dichiarata) → lo stesso reperto: e\' un fatto scritto dalla persona', () => {
  const r = validateCable({ cableCategory: 'Cat6' }, { fiberEnds: ODF() }).filter((i) => i.code === 'fiber-panel-medium');
  assert.equal(r.length, 1);
  assert.equal(r[0].params.doc, 'copper');
});

test('mezzo non dichiarato e nessuna categoria di rame → niente da dire (non si indovina)', () => {
  assert.deepEqual(validateCable({}, { fiberEnds: ODF('sm-os2') }), []);
  assert.deepEqual(validateCable({ connector: 'RJ45' }, { fiberEnds: ODF('sm-os2') }).filter((i) => /^fiber-panel/.test(i.code)), [], 'il connettore non decide: c\'e\' gia\' «RJ45 su fibra»');
  assert.deepEqual(validateCable({ cableCategory: 'OM4' }, { fiberEnds: ODF('mm-om4') }), []);
});

test('un cavo in fibra su un pannello ottico non prende il reperto del mezzo', () => {
  assert.deepEqual(validateCable({ medium: 'fiber' }, { fiberEnds: ODF() }), []);
  assert.deepEqual(validateCable({ medium: 'fiber', cableCategory: 'OS2' }, { fiberEnds: ODF('sm-os2') }), []);
});

test('un cavo rame + categoria ottica e\' gia\' incoerente da se\': la classe non si confronta sopra un mezzo sbagliato', () => {
  const c = codici(validateCable({ medium: 'copper', cableCategory: 'OM4' }, { fiberEnds: ODF('sm-os2') }));
  assert.ok(c.includes('medium-cat') && c.includes('fiber-panel-medium'));
  assert.ok(!c.includes('fiber-panel-class'));
});

test('monomodale contro multimodale → warn fiber-panel-class, per entrambi i versi', () => {
  const a = validateCable({ medium: 'fiber', cableCategory: 'OM4' }, { fiberEnds: ODF('sm-os2') }).filter((i) => i.code === 'fiber-panel-class');
  assert.deepEqual(a, [{ level: 'warn', code: 'fiber-panel-class', params: { name: 'ODF-1', mode: 'OS2', cat: 'OM4', panelFam: 'sm', cableFam: 'mm' } }]);
  const b = validateCable({ medium: 'fiber', cableCategory: 'OS2' }, { fiberEnds: ODF('mm-om3') }).filter((i) => i.code === 'fiber-panel-class');
  assert.deepEqual(b, [{ level: 'warn', code: 'fiber-panel-class', params: { name: 'ODF-1', mode: 'OM3', cat: 'OS2', panelFam: 'mm', cableFam: 'sm' } }]);
  assert.equal(validateCable({ cableCategory: 'OM5' }, { fiberEnds: ODF('sm-os1') }).filter((i) => i.code === 'fiber-panel-class').length, 1, 'anche senza mezzo: la categoria ottica e\' dichiarata');
});

test('OM1 e OM2 sono multimodali, OS1 e OS2 monomodali: ogni classe del pannello ha la sua famiglia', () => {
  for (const mode of ['mm-om1', 'mm-om2', 'mm-om3', 'mm-om4', 'mm-om5']) {
    assert.equal(validateCable({ medium: 'fiber', cableCategory: 'OS2' }, { fiberEnds: ODF(mode) }).filter((i) => i.code === 'fiber-panel-class').length, 1, `${mode} contro OS2`);
  }
  for (const mode of ['sm-os1', 'sm-os2']) {
    assert.equal(validateCable({ medium: 'fiber', cableCategory: 'OM3' }, { fiberEnds: ODF(mode) }).filter((i) => i.code === 'fiber-panel-class').length, 1, `${mode} contro OM3`);
  }
});

test('stessa famiglia, grado diverso → niente (OM3 su OM4 non e\' una contraddizione: al piu\' cala la portata)', () => {
  for (const [cat, mode] of [['OM3', 'mm-om4'], ['OM4', 'mm-om3'], ['OM5', 'mm-om1'], ['OS2', 'sm-os1'], ['OS2', 'sm-os2']]) {
    assert.deepEqual(validateCable({ medium: 'fiber', cableCategory: cat }, { fiberEnds: ODF(mode) }), [], `${cat} su ${mode}`);
  }
});

test('classe del pannello o categoria del cavo non dichiarate → niente da confrontare', () => {
  assert.deepEqual(validateCable({ medium: 'fiber', cableCategory: 'OM4' }, { fiberEnds: ODF('') }), []);
  assert.deepEqual(validateCable({ medium: 'fiber' }, { fiberEnds: ODF('sm-os2') }), []);
  assert.deepEqual(validateCable({ medium: 'fiber', cableCategory: 'OM4' }, { fiberEnds: ODF('boh') }), [], 'una classe che non e\' nell\'elenco non si inventa');
});

test('due pannelli ottici ai due capi: un reperto per ciascuno, col suo nome', () => {
  const ends = [{ name: 'ODF-1', mode: 'sm-os2' }, { name: 'ODF-2', mode: 'mm-om4' }];
  const r = validateCable({ medium: 'fiber', cableCategory: 'OM4' }, { fiberEnds: ends }).filter((i) => i.code === 'fiber-panel-class');
  assert.deepEqual(r.map((i) => i.params.name), ['ODF-1'], 'solo quello che contraddice');
  const m = validateCable({ medium: 'copper' }, { fiberEnds: ends }).filter((i) => i.code === 'fiber-panel-medium');
  assert.deepEqual(m.map((i) => i.params.name), ['ODF-1', 'ODF-2']);
});

test('opts.fiberEnds malformato non rompe il validatore', () => {
  for (const bad of [null, undefined, 'x', 7, {}, [null], [undefined], [{}], [{ name: 5 }]]) {
    assert.doesNotThrow(() => validateCable({ medium: 'copper', cableCategory: 'OM4' }, { fiberEnds: bad }));
  }
});

// ── Il pannello del cavo, nel progetto vero ────────────────────────────────────────────────────────────────
// Due capi: uno switch e il pannello (cassetto, o patch panel). Il cavo e' l'oggetto selezionato.
function pannelloCavo(nodoPannello, cavo) {
  const APP = loadApp(ROOT);
  const r = run(APP.ctx, `(() => {
    state = _buildDefaultState();
    state.nodes = []; state.links = []; state.ports = {};
    state.ipam = { vlans:{}, prefixes:[], addresses:[] };
    state.vlanNames = {}; state.vlanColors = state.vlanColors || {};
    state.nodes.push({ id:'sw1', type:'switch', name:'SW-A', ports:4 });
    state.nodes.push(Object.assign({ id:'pp1', name:'ODF-1', ports:4 }, ${JSON.stringify(nodoPannello)}));
    state.links.push(Object.assign({ id:'l1', src:'sw1-1', dst:'pp1-1' }, ${JSON.stringify(cavo)}));
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    propagateVlans();
    _propsExplicit = true; selType = 'link'; selId = 'l1'; renderProps();
    const html = document.getElementById('props-panel').innerHTML || '';
    return {
      html,
      medio: html.indexOf(t('cbl.fiber-panel-medium.t')) >= 0,
      classe: html.indexOf(t('cbl.fiber-panel-class.t')) >= 0,
      tMedio: t('cbl.fiber-panel-medium.t'), tClasse: t('cbl.fiber-panel-class.t'),
    };
  })()`);
  // Non-vacuita': un «niente reperto» vale solo se la sezione del cavo e' stata davvero disegnata (non un pannello vuoto).
  // Wireless ha la sua sezione (nessuna fisica): li' non c'e' da aspettarsela.
  if (!(cavo && cavo.wireless)) assert.ok(r.html.indexOf('data-section="link-physical-specs"') >= 0, 'la sezione fisica del cavo e\' stata disegnata');
  return r;
}

test('pannello del cavo: rame su una porta del cassetto → il reperto compare, col nome del cassetto', () => {
  const r = pannelloCavo({ type: 'fiberdrawer' }, { medium: 'copper' });
  assert.equal(r.medio, true);
  assert.equal(r.classe, false);
  assert.match(r.html, /ODF-1 accetta solo fibra ottica, ma questo cavo è dichiarato come Rame\./, 'la frase composta: QUALE pannello e QUALE mezzo, a parole');
  assert.doesNotMatch(r.tMedio, /^cbl\./, 'la frase e\' reale, non la chiave');
  assert.match(pannelloCavo({ type: 'fiberdrawer' }, { medium: 'dac' }).html, /dichiarato come DAC\./);
});

test('pannello del cavo: fibra multimodale su un cassetto monomodale → il reperto di classe, e solo quello', () => {
  const r = pannelloCavo({ type: 'fiberdrawer', spec: { ppFiberMode: 'sm-os2' } }, { medium: 'fiber', cableCategory: 'OM4' });
  assert.equal(r.classe, true);
  assert.equal(r.medio, false);
  assert.match(r.html, /ODF-1 è dichiarato monomodale \(OS2\), il cavo è multimodale \(OM4\)\./, 'la frase composta, ognuno dei due dal suo lato');
  const v = pannelloCavo({ type: 'fiberdrawer', spec: { ppFiberMode: 'mm-om3' } }, { medium: 'fiber', cableCategory: 'OS2' });
  assert.match(v.html, /ODF-1 è dichiarato multimodale \(OM3\), il cavo è monomodale \(OS2\)\./, 'e al contrario');
});

test('pannello del cavo: tutto coerente (fibra, stessa famiglia) → nessuno dei due reperti', () => {
  const r = pannelloCavo({ type: 'fiberdrawer', spec: { ppFiberMode: 'mm-om4' } }, { medium: 'fiber', cableCategory: 'OM3' });
  assert.equal(r.medio, false);
  assert.equal(r.classe, false);
});

test('pannello del cavo: un cavo con niente di dichiarato non prende niente, nemmeno su un cassetto', () => {
  const r = pannelloCavo({ type: 'fiberdrawer', spec: { ppFiberMode: 'sm-os2' } }, {});
  assert.equal(r.medio, false);
  assert.equal(r.classe, false);
});

test('pannello del cavo: lo stesso vale per un patch panel dichiarato «fibra»; «misto» e «rame» no', () => {
  assert.equal(pannelloCavo({ type: 'patchpanel', spec: { ppMedia: 'fiber' } }, { medium: 'copper' }).medio, true);
  assert.equal(pannelloCavo({ type: 'patchpanel', spec: { ppMedia: 'mixed' } }, { medium: 'copper' }).medio, false, 'misto: ci sono anche le porte in rame');
  assert.equal(pannelloCavo({ type: 'patchpanel', spec: { ppMedia: 'copper' } }, { medium: 'copper' }).medio, false);
  assert.equal(pannelloCavo({ type: 'patchpanel' }, { medium: 'copper' }).medio, false, 'non dichiarato: non si indovina');
});

test('pannello del cavo: il nome del pannello viene dai dati e si ESCAPA', () => {
  const r = pannelloCavo({ type: 'fiberdrawer', name: '<img src=x onerror=alert(1)>' }, { medium: 'copper' });
  assert.equal(r.medio, true);
  assert.doesNotMatch(r.html, /<img src=x onerror/, 'niente markup dai dati');
  assert.match(r.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('pannello del cavo: un cavo fra due porte dello STESSO cassetto non ripete il reperto', () => {
  const APP = loadApp(ROOT);
  const n = run(APP.ctx, `(() => {
    state = _buildDefaultState();
    state.nodes = []; state.links = []; state.ports = {};
    state.ipam = { vlans:{}, prefixes:[], addresses:[] };
    state.vlanNames = {}; state.vlanColors = state.vlanColors || {};
    state.nodes.push({ id:'pp1', type:'fiberdrawer', name:'ODF-1', ports:4 });
    state.links.push({ id:'l1', src:'pp1-1', dst:'pp1-2', medium:'copper' });
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    propagateVlans();
    _propsExplicit = true; selType = 'link'; selId = 'l1'; renderProps();
    const html = document.getElementById('props-panel').innerHTML || '';
    return html.split(t('cbl.fiber-panel-medium.t')).length - 1;
  })()`);
  assert.equal(n, 1);
});

test('pannello del cavo: un cavo wireless non prende reperti fisici (come prima)', () => {
  const r = pannelloCavo({ type: 'fiberdrawer' }, { medium: 'copper', wireless: true });
  assert.equal(r.medio, false);
});
