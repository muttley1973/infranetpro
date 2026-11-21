'use strict';
// ============================================================
// IL CASSETTO OTTICO NELLE TRE SUPERFICI CHE NESSUN TEST SORVEGLIAVA
//   1. la frase che dice quale tappa serve a un cavo (tabella `LBL` in src/app-cabling-editor.js);
//   2. il menu del tipo nell'import da NetBox (`_RECON_TYPES` in src/app-integrations.js);
//   3. l'aiuto dell'import CSV (l'elenco «Tipi validi» in netmapper.html) e l'import stesso.
// Il codice c'era ed era giusto: toglierlo per sbaglio non avrebbe fatto cadere niente. Qui ogni superficie ha la
// sua prova — la prima nel DOM-stub (la frase vera, in italiano e in inglese), le altre leggendo la sorgente e
// confrontandola col catalogo dei tipi e con i dizionari, che e' dove nasce lo scarto.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');
const i18n = require('../lib/i18n.js');

const ROOT = path.join(__dirname, '..');
const IT = i18n._i18nDict.it;
const EN = i18n._i18nDict.en;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

const dalCodice = (espressione) => JSON.parse(run(APP.ctx, `JSON.stringify((() => { try { return ${espressione}; } catch (e) { return { __err: String(e && e.message || e) }; } })())`));

// ── 1. la frase sulla tappa che manca ────────────────────────────────────────────────────────────────────────
// Un cavo fra due estremi per cui serve una tappa, e nessuna tappa libera: l'app dice QUALE tipo serve. I nomi
// vengono da una piccola tabella; una voce che manca farebbe uscire la parola tecnica («fiberdrawer») nella frase.
function fraseTappaMancante(lang, tipoA, tipoB) {
  return dalCodice(`(() => {
    setLang(${JSON.stringify(lang)});
    state = _buildDefaultState();
    if (typeof _migrateState === 'function') _migrateState(state);
    state.nodes.length = 0; state.links.length = 0; state.ports = {};
    const rid = state.currentRack;
    // (un cassetto con UNA sola porta, quella del cavo: altre porte libere dello stesso cassetto sarebbero tappe valide)
    const nodo = (id, type, rackU) => ({ id, type, name: id, rackId: rid, rackU, sizeU: 1, ports: type === 'fiberdrawer' ? 1 : 24, spec: type === 'fiberdrawer' ? { ppFiberConnector: 'lc-duplex' } : {} });
    state.nodes.push(nodo('a', ${JSON.stringify(tipoA)}, 1), nodo('b', ${JSON.stringify(tipoB)}, 5));
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    const l = _createLinkRecord('a-1', 'b-1'); state.links.push(l);
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    const pila = document.getElementById('toast-stack');
    const prima = pila.children.length;
    enterRoutingMode(l.id);
    const frasi = pila.children.slice(prima).map(box => box.children[0].textContent);
    setLang('it');
    return frasi;
  })()`);
}

test('cavo da un cassetto a uno switch, senza altra tappa: la frase dice «cassetto ottico» (IT) e «fiber drawer» (EN)', () => {
  const it = fraseTappaMancante('it', 'fiberdrawer', 'switch');
  assert.ok(Array.isArray(it) && it.length === 1, 'una frase: ' + JSON.stringify(it));
  assert.match(it[0], /cassetto ottico/, 'il nome della tappa che serve');
  assert.doesNotMatch(it[0], /fiberdrawer/, 'non la parola tecnica');
  const en = fraseTappaMancante('en', 'fiberdrawer', 'switch');
  assert.match(en[0], /fiber drawer/);
  assert.doesNotMatch(en[0], /fiberdrawer/);
});

test('e le tappe che c\'erano gia\' non cambiano: presa fino a switch chiede un patch panel, nella lingua giusta', () => {
  const it = fraseTappaMancante('it', 'wallport', 'switch');
  assert.match(it[0], /patch panel/);
  assert.doesNotMatch(it[0], /patchpanel|wallport/);
});

test('la tabella ha una voce per ogni tipo di tappa che la regola del cablaggio puo\' proporre', () => {
  // `validMidTypes` dice quali tipi possono stare in mezzo; ognuno deve avere un nome nella frase, altrimenti la
  // frase direbbe la parola tecnica. Si legge dalla regola vera, cosi' un tipo nuovo di tappa fa cadere il test.
  const proposti = dalCodice(`(() => { const out = new Set(); const tipi = Object.keys(TYPES);
    for (const a of tipi) for (const b of tipi) for (const m of validMidTypes(a, b)) out.add(m);
    return [...out].sort(); })()`);
  assert.ok(proposti.includes('fiberdrawer') && proposti.includes('patchpanel'), 'la regola propone anche il cassetto: ' + proposti);
  const sorgente = read('src/app-cabling-editor.js');
  const lbl = /const LBL = \{([^}]*)\}/.exec(sorgente);
  assert.ok(lbl, 'la tabella LBL e\' cambiata di forma: aggiorna il test, non toglierlo');
  for (const tipo of proposti) assert.match(lbl[1], new RegExp('\\b' + tipo + '\\s*:'), `LBL non nomina «${tipo}»: la frase direbbe la parola tecnica`);
});

// ── 2. il menu del tipo nell'import da NetBox ──────────────────────────────────────────────────────────────────
// Per ogni gruppo di apparati che NetBox non sa classificare, l'utente sceglie da un menu in cosa diventano.
function elencoTipiImportNetBox() {
  const m = /const _RECON_TYPES = \[([\s\S]*?)\];/.exec(read('src/app-integrations.js'));
  assert.ok(m, 'l\'elenco _RECON_TYPES e\' cambiato di forma: aggiorna il test, non toglierlo');
  return [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
}

test('import NetBox: il menu del tipo offre il cassetto ottico, accanto al patch panel', () => {
  const tipi = elencoTipiImportNetBox();
  assert.ok(tipi.includes('fiberdrawer'), 'senza, il cassetto non si puo\' scegliere nell\'import');
  assert.ok(tipi.includes('patchpanel'));
  assert.equal(new Set(tipi).size, tipi.length, 'nessun tipo ripetuto');
});

test('import NetBox: ogni voce del menu e\' un tipo vero e ha un nome in italiano e in inglese (se manca, il menu mostra la chiave)', () => {
  const veri = new Set(dalCodice('Object.keys(TYPES)'));
  for (const tipo of elencoTipiImportNetBox()) {
    assert.ok(veri.has(tipo), `«${tipo}» non e\' un tipo del catalogo: il menu offrirebbe qualcosa che l'import non sa creare`);
    for (const [lingua, dizionario] of [['it', IT], ['en', EN]]) {
      assert.ok(dizionario['type.' + tipo], `manca «type.${tipo}» in ${lingua}: nel menu comparirebbe «${tipo}»`);
    }
  }
});

// La scelta fatta nel menu arriva a `netboxToState` come `selection.mapping[<id apparato>] = { type }`. Se quel tipo
// non e' fra quelli che la mappatura a mano accetta (`_MANUAL_TYPES` in lib/dcim-map.js), la scelta viene ignorata in
// silenzio: l'utente sceglie «Cassetto ottico» e l'apparato entra comunque come un'altra cosa.
const NB_RUOLO_IGNOTO = { deviceRoles: [{ id: 90, slug: 'misc-gear', name: 'Misc' }], racks: [{ id: 31, name: 'R1', u_height: 42 }],
  devices: [{ id: 302, name: 'FIBRA-A', role: { id: 90 }, rack: { id: 31 }, position: 10 }] };
const tipoImportato = (tipo) => require('../lib/dcim-map.js')
  .netboxToState(NB_RUOLO_IGNOTO, tipo ? { selection: { mapping: { 302: { type: tipo } } } } : undefined).state.nodes[0].type;

test('import NetBox: scelto «Cassetto ottico» nel menu, un apparato di un ruolo che NetBox non classifica diventa un cassetto', () => {
  assert.notEqual(tipoImportato(null), 'fiberdrawer', 'senza la scelta il ruolo non dice «cassetto»: e il caso in cui il menu serve');
  assert.equal(tipoImportato('fiberdrawer'), 'fiberdrawer');
  assert.equal(tipoImportato('patchpanel'), 'patchpanel', 'e il patch panel resta com\'e\'');
});

test('import NetBox: ogni tipo che il menu offre viene accettato dalla scelta a mano (nessuna voce che non fa niente)', () => {
  for (const tipo of elencoTipiImportNetBox()) assert.equal(tipoImportato(tipo), tipo, `il menu offre «${tipo}» ma la mappatura lo ignora`);
});

// ── 3. l'import CSV e il suo aiuto ──────────────────────────────────────────────────────────────────────────────
function tipiValidiDellAiuto() {
  const m = /Tipi validi:\s*([^<\n]+)/.exec(read('netmapper.html'));
  assert.ok(m, 'l\'elenco «Tipi validi» non e\' piu\' nell\'aiuto del CSV: aggiorna il test, non toglierlo');
  return m[1].split('·').map((s) => s.trim()).filter(Boolean);
}

test('aiuto CSV: elenca il cassetto ottico accanto al patch panel', () => {
  const tipi = tipiValidiDellAiuto();
  assert.ok(tipi.includes('fiberdrawer'), 'chi legge l\'aiuto non sa che puo\' scrivere «fiberdrawer»: ' + tipi.join(' · '));
  assert.ok(tipi.includes('patchpanel'));
  assert.equal(new Set(tipi).size, tipi.length);
});

test('aiuto CSV: non promette tipi che l\'import rifiuta (ogni parola e\' un tipo del catalogo)', () => {
  const veri = new Set(dalCodice('Object.keys(TYPES)'));
  for (const tipo of tipiValidiDellAiuto()) assert.ok(veri.has(tipo), `l'aiuto dice «${tipo}» valido ma l'import lo scarterebbe (tipo non valido)`);
});

test('import CSV: una riga «fiberdrawer» entra come cassetto ottico (1U, 24 porte), una riga con un tipo sbagliato resta fuori', () => {
  const r = dalCodice(`(() => {
    state = _buildDefaultState();
    if (typeof _migrateState === 'function') _migrateState(state);
    state.nodes.length = 0; state.links.length = 0; state.ports = {};
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    document.getElementById('csv-textarea').value = 'name,type\\nFD-CSV,fiberdrawer\\nSW-CSV,switch\\nXX-CSV,cassettoottico';
    importCsvNodes();
    return state.nodes.map(n => ({ name: n.name, type: n.type, sizeU: n.sizeU, ports: n.ports, rack: !!n.rackId }));
  })()`);
  assert.ok(Array.isArray(r), 'l\'import lancia: ' + JSON.stringify(r));
  const fd = r.find((n) => n.name === 'FD-CSV');
  assert.ok(fd, 'il cassetto e entrato: ' + JSON.stringify(r));
  assert.equal(fd.type, 'fiberdrawer');
  assert.equal(fd.sizeU, 1);
  assert.equal(fd.ports, 24);
  assert.equal(fd.rack, true, 'e sta in un rack');
  assert.ok(r.find((n) => n.name === 'SW-CSV'), 'lo switch della stessa tabella entra');
  assert.equal(r.find((n) => n.name === 'XX-CSV'), undefined, 'il tipo sbagliato no');
});
