'use strict';
// ============================================================
//  IL FRONTALE DEL CASSETTO OTTICO NEL RACK: UNA FILA DI SLOT, I FORI DICONO IL CONNETTORE
// ============================================================
// Il cassetto e' disegnato dallo stesso motore del patch panel e dello switch (`mkPort`, `.port-led` con i
// colori di stato), ma la sua porta e' uno SLOT verticale con i fori del connettore dentro, come nel disegno
// dell'utente (connettori ottici.svg): LC duplex = due fori piccoli, SC/ST/FC = uno grande. La fila e' UNA
// SOLA — i cassetti veri hanno gli slot affiancati, non a due piani come uno switch.
//
// Il connettore e' un campo DICHIARATO (`ppFiberConnector`, lo stesso del patch panel): non dichiarato =
// slot senza fori. Il disegno e' del cassetto: un patch panel con la fibra dichiarata resta com'e'.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

/** L'HTML del dispositivo `fd1` nel rack, con le proprieta' date (oltre a type/ports/rack). */
function frontale(extra, ports) {
  return run(APP.ctx, `(() => {
    state = _buildDefaultState();
    _propsExplicit = true;
    const node = Object.assign({ id: 'fd1', type: ${JSON.stringify((extra && extra.type) || 'fiberdrawer')}, name: 'ODF', rackId: state.currentRack,
      rackU: 1, sizeU: 1, ports: ${ports || 24} }, ${JSON.stringify(extra || {})});
    state.nodes.push(node);
    state.ports = Object.assign(state.ports || {}, ${JSON.stringify((extra && extra.__ports) || {})});
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    renderAll();
    const rack = document.getElementById('rack-chassis');
    const device = (rack.children || []).find(item => item.dataset && item.dataset.id === node.id);
    return device ? device.innerHTML : '';
  })()`);
}
const conta = (html, re) => (html.match(re) || []).length;
const SLOT_CONNETTORE = (kind) => new RegExp(`<div class="port-led fo-slot fo-${kind}[^"]*" data-pid="fd1-\\d+"`, 'g');

test('LC duplex: 24 slot in UNA fila, ognuno con DUE fori, e il pid resta sull\'elemento che si colora', () => {
  const html = frontale({ spec: { ppFiberConnector: 'lc-duplex' } });
  assert.equal(conta(html, SLOT_CONNETTORE('lc2')), 24, 'ventiquattro slot LC duplex, con data-pid sul .port-led');
  assert.equal(conta(html, /<circle /g), 48, 'due fori per slot');
  assert.equal(conta(html, /rack-ports-2row/g), 0, 'una fila sola, non due piani come uno switch');
  assert.equal(conta(html, /class="rack-ports[ "]/g), 1);
});

test('SC, ST e FC: un foro grande per slot', () => {
  for (const c of ['sc', 'st', 'fc']) {
    const html = frontale({ spec: { ppFiberConnector: c } });
    assert.equal(conta(html, SLOT_CONNETTORE('big')), 24, `${c}: slot dello stesso tipo`);
    assert.equal(conta(html, /<circle /g), 24, `${c}: un foro per slot`);
    assert.equal(conta(html, /r="52\.9"/g), 24, `${c}: il foro grande`);
  }
});

test('LC simplex: un foro piccolo; MPO: un\'apertura rettangolare', () => {
  const lc1 = frontale({ spec: { ppFiberConnector: 'lc-simplex' } });
  assert.equal(conta(lc1, SLOT_CONNETTORE('lc1')), 24);
  assert.equal(conta(lc1, /<circle /g), 24);
  assert.equal(conta(lc1, /r="32"/g), 24);
  for (const c of ['mpo-12', 'mpo-24']) {
    const mpo = frontale({ spec: { ppFiberConnector: c } });
    assert.equal(conta(mpo, SLOT_CONNETTORE('mpo')), 24, c);
    assert.equal(conta(mpo, /<rect /g), 48, `${c}: la bocca e la ferrula MT per slot`);
    assert.equal(conta(mpo, /class="fo-fer"/g), 24, `${c}: una ferrula per slot`);
    assert.equal(conta(mpo, /<circle /g), 0, c);
  }
});

test('connettore NON dichiarato: slot verticali senza fori (non si indovina cosa c\'e\' montato)', () => {
  const html = frontale({});
  assert.equal(conta(html, SLOT_CONNETTORE('blank')), 24);
  assert.equal(conta(html, /<circle |<rect /g), 0, 'nessun foro disegnato');
  assert.equal(conta(html, /rack-ports-2row/g), 0, 'anche senza connettore la fila e\' una');
});

test('il connettore puo\' stare anche sul nodo (progetti vecchi), non solo in spec', () => {
  const html = frontale({ ppFiberConnector: 'lc-duplex' });
  assert.equal(conta(html, SLOT_CONNETTORE('lc2')), 24, 'lo legge come fa il pannello Proprieta\'');
});

test('lo stato della porta colora lo slot: la classe sta sullo STESSO elemento del pid', () => {
  const html = frontale({ spec: { ppFiberConnector: 'lc-duplex' }, __ports: { 'fd1-3': { statusOvr: 'active' }, 'fd1-5': { statusOvr: 'fault' } } });
  assert.match(html, /<div class="port-led fo-slot fo-lc2 active[^"]*" data-pid="fd1-3"/);
  assert.match(html, /<div class="port-led fo-slot fo-lc2 fault[^"]*" data-pid="fd1-5"/);
});

test('12 porte: dodici slot nella stessa fila', () => {
  const html = frontale({ spec: { ppFiberConnector: 'lc-duplex' } }, 12);
  assert.equal(conta(html, SLOT_CONNETTORE('lc2')), 12);
  assert.equal(conta(html, /rack-ports-2row/g), 0);
});

test('chi sceglie le due righe a mano le ottiene, con i LED di sempre (a 1U due slot verticali non ci stanno)', () => {
  const html = frontale({ spec: { ppFiberConnector: 'lc-duplex' }, frontPanel: { baseLayout: 'alternating' } });
  assert.equal(conta(html, /rack-ports-2row/g), 1, 'due piani, come ha chiesto');
  assert.equal(conta(html, /fo-slot/g), 0, 'senza fori: sarebbero fuori misura');
  assert.equal(conta(html, /data-pid="fd1-\d+"/g), 24, 'le 24 porte ci sono tutte');
});

test('il disegno e\' del cassetto: un patch panel con la fibra dichiarata resta com\'e\'', () => {
  // sia a due righe (auto, 24 porte) sia in UNA fila (linear): la fila unica non basta a farlo passare per un cassetto
  for (const frontPanel of [undefined, { baseLayout: 'linear' }]) {
    const html = frontale({ type: 'patchpanel', ppMedia: 'fiber', spec: { ppFiberConnector: 'lc-duplex' }, frontPanel });
    assert.equal(conta(html, /fo-slot|<circle /g), 0, `patch panel, layout ${frontPanel ? 'linear' : 'auto'}`);
    assert.equal(conta(html, /data-pid="fd1-\d+"/g), 24);
  }
});

test('uno switch a 24 porte non cambia: due righe, LED quadrati', () => {
  const html = frontale({ type: 'switch' });
  assert.equal(conta(html, /rack-ports-2row/g), 1);
  assert.equal(conta(html, /fo-slot|<circle /g), 0);
});

// ── Il connettore si sceglie dal pannello Proprieta': e' un campo dichiarato, lo stesso del patch panel ──
function pannello(nodo) {
  return run(APP.ctx, `(() => {
    state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
    _propsExplicit = true;
    const n = Object.assign({ id: 'fd1', rackId: state.currentRack, rackU: 1, sizeU: 1, ports: 24, name: 'ODF' }, ${JSON.stringify(nodo)});
    state.nodes.push(n);
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    selType = 'node'; selId = 'fd1'; renderProps();
    return document.getElementById('props-panel').innerHTML || '';
  })()`);
}
// Le voci del cassetto: LC simplex NON c'e' (un LC singolo = LC duplex + «una porta e' un singolo connettore»); c'e' SC duplex.
const OPZIONI = ['lc-duplex', 'lc-quad', 'sc', 'sc-duplex', 'st', 'fc', 'mpo-12', 'mpo-24'];

test('pannello del cassetto: connettore e classe di fibra, SENZA la scelta del tipo di cavo (e' + "'" + ' sempre fibra)', () => {
  const html = pannello({ type: 'fiberdrawer' });
  assert.match(html, /data-nfield="ppFiberConnector"/, 'il connettore si sceglie qui');
  assert.match(html, /data-nfield="ppFiberMode"/, 'e la classe della fibra');
  assert.doesNotMatch(html, /data-nfield="ppMedia"/, 'rame/fibra/misto non ha senso: e\' un cassetto OTTICO');
  assert.doesNotMatch(html, /data-nfield="ppCopper/, 'niente categoria di rame');
  for (const o of OPZIONI) assert.match(html, new RegExp(`<option value="${o}"`), `opzione ${o}`);
  assert.doesNotMatch(html, /<option value="lc-simplex"/, 'LC simplex non e\' una scelta del cassetto: e\' un caso della porta singola');
});

test('pannello del cassetto: nessun connettore e\' preselezionato (manual-first)', () => {
  const html = pannello({ type: 'fiberdrawer' });
  const sel = /<select data-change="update-n" data-nfield="ppFiberConnector">([\s\S]*?)<\/select>/.exec(html);
  assert.ok(sel, 'la tendina c\'e\'');
  assert.match(sel[1], /<option value=""\s+selected>/, '«non dichiarato» e\' la voce scelta');
  assert.doesNotMatch(sel[1], /<option value="[a-z0-9-]+"\s+selected>/, 'nessun connettore scelto al posto dell\'utente');
});

test('pannello del cassetto: il connettore dichiarato e\' quello selezionato, e il riassunto lo dice', () => {
  const html = pannello({ type: 'fiberdrawer', spec: { ppFiberConnector: 'lc-duplex', ppFiberMode: 'mm-om4' } });
  assert.match(html, /<option value="lc-duplex"\s+selected>/);
  assert.match(html, /OM4 LC duplex · 24p/, 'riassunto nella testata della sezione, come per il patch panel');
});

test('il pannello del patch panel in fibra resta com\'e\': stesse tendine, con la scelta del tipo di cavo', () => {
  const html = pannello({ type: 'patchpanel', ppMedia: 'fiber', spec: { ppFiberConnector: 'sc' } });
  assert.match(html, /data-nfield="ppMedia"/);
  assert.match(html, /data-nfield="ppFiberConnector"/);
  assert.match(html, /<option value="sc"\s+selected>/);
});

test('oltre 24 slot la fila unica non ci sta nel rack: due righe con i LED di sempre (24 e\' il limite, non 25)', () => {
  const ventiquattro = frontale({ spec: { ppFiberConnector: 'lc-duplex' } }, 24);
  assert.equal(conta(ventiquattro, /rack-ports-2row/g), 0, '24 slot: una fila');
  assert.equal(conta(ventiquattro, SLOT_CONNETTORE('lc2')), 24);
  for (const porte of [25, 36, 48]) {
    const html = frontale({ spec: { ppFiberConnector: 'lc-duplex' } }, porte);
    assert.equal(conta(html, /rack-ports-2row/g), 1, `${porte} porte: due righe, come un patch panel o uno switch`);
    assert.equal(conta(html, /fo-slot/g), 0, `${porte} porte: niente fori (fuori misura)`);
    assert.equal(conta(html, /data-pid="fd1-\d+"/g), porte, `${porte} porte: ci sono tutte`);
  }
});

test('chi forza UNA fila con 48 porte la ottiene, con gli slot: e\' una scelta dichiarata', () => {
  const html = frontale({ spec: { ppFiberConnector: 'lc-duplex' }, frontPanel: { baseLayout: 'linear' } }, 48);
  assert.equal(conta(html, /rack-ports-2row/g), 0);
  assert.equal(conta(html, SLOT_CONNETTORE('lc2')), 48);
});

// ── Moduli con PIU' porte: lo slot si divide in celle cliccabili, una per porta ──────────────────────────
// LC quad (4 LC) con la porta duplex = 2 celle da 2 fori; con la porta = singolo LC = 4 celle da 1 foro.
// LC duplex con la porta = singolo LC = 2 celle da 1 foro. Ogni cella e' un `.port-led` col SUO pid e col suo stato.
const CELLA = (kind) => new RegExp(`<div class="port-led fo-cell fo-${kind}[^"]*" data-pid="fd1-\\d+"`, 'g');
const MODULI = /<div class="rack-port-unit fo-module/g;

test('LC quad, porta duplex: 48 porte = 24 moduli da 2 celle (2 fori l\'una), in UNA fila', () => {
  const html = frontale({ spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'duplex' } }, 48);
  assert.equal(conta(html, MODULI), 24, 'ventiquattro moduli');
  assert.equal(conta(html, CELLA('lc2')), 48, 'quarantotto celle cliccabili, ognuna col suo pid');
  assert.equal(conta(html, /<circle /g), 96, 'quattro LC per modulo = 96 fori');
  assert.equal(conta(html, /rack-ports-2row/g), 0);
  assert.equal(conta(html, /fo-slot/g), 0, 'le celle non sono slot interi');
  assert.equal(conta(html, /fo-tall/g), 24, 'il modulo a 4 LC e\' piu\' alto');
});

test('LC quad, porta = singolo LC: 96 porte = 24 moduli da 4 celle (1 foro l\'una) — il cassetto da 96 fibre', () => {
  const html = frontale({ spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'single' } }, 96);
  assert.equal(conta(html, MODULI), 24);
  assert.equal(conta(html, CELLA('lc1')), 96);
  assert.equal(conta(html, /<circle /g), 96);
  assert.equal(conta(html, /rack-ports-2row/g), 0, 'una fila sola: 24 slot ci stanno');
  assert.equal(conta(html, /data-pid="fd1-\d+"/g), 96);
});

test('LC duplex, porta = singolo LC: 48 porte = 24 moduli da 2 celle; senza «porta singola» resta lo slot intero', () => {
  const html = frontale({ spec: { ppFiberConnector: 'lc-duplex', ppFiberPortUnit: 'single' } }, 48);
  assert.equal(conta(html, MODULI), 24);
  assert.equal(conta(html, CELLA('lc1')), 48);
  assert.equal(conta(html, /fo-tall/g), 0, 'il modulo duplex non e\' alto');
  const duplex = frontale({ spec: { ppFiberConnector: 'lc-duplex' } });
  assert.equal(conta(duplex, MODULI), 0, 'con la porta duplex nessun modulo: uno slot, una porta');
  assert.equal(conta(duplex, SLOT_CONNETTORE('lc2')), 24);
});

test('la numerazione va modulo per modulo, dall\'alto: la cella alta e\' la porta dispari, e sotto lo slot il numero della prima', () => {
  const html = frontale({ spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'single' } }, 96);
  const primo = /<div class="rack-port-unit fo-module[^>]*>([\s\S]*?)<\/div><span class="port-num"[^>]*>(\d+)<\/span>/.exec(html);
  assert.ok(primo, 'il primo modulo');
  assert.deepEqual([...primo[1].matchAll(/data-pid="fd1-(\d+)"/g)].map((m) => Number(m[1])), [1, 2, 3, 4], 'dall\'alto: 1, 2, 3, 4');
  assert.equal(primo[2], '1', 'il numero sotto lo slot e\' quello della prima porta');
  const etichette = [...html.matchAll(/<span class="port-num"[^>]*>(\d+)<\/span>/g)].map((m) => Number(m[1]));
  assert.deepEqual(etichette.slice(0, 4), [1, 5, 9, 13], 'un numero per modulo: il successivo parte dopo quattro porte');
  assert.equal(etichette.length, 24);
});

test('lo stato di una porta colora la SUA cella, non il modulo intero', () => {
  const html = frontale({ spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'single' }, __ports: { 'fd1-2': { statusOvr: 'active' }, 'fd1-7': { statusOvr: 'fault' } } }, 96);
  assert.match(html, /<div class="port-led fo-cell fo-lc1 active[^"]*" data-pid="fd1-2"/);
  assert.match(html, /<div class="port-led fo-cell fo-lc1 fault[^"]*" data-pid="fd1-7"/);
  assert.equal(conta(html, /fo-cell fo-lc1 active/g), 1, 'una sola cella accesa');
});

test('porte che non riempiono l\'ultimo modulo: 25 porte quad/duplex = 13 moduli, l\'ultimo con una cella vuota', () => {
  const html = frontale({ spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'duplex' } }, 25);
  assert.equal(conta(html, MODULI), 13);
  assert.equal(conta(html, CELLA('lc2')), 25);
  assert.equal(conta(html, /fo-cell-empty/g), 1, 'la cella senza porta resta una vetrina vuota, non cliccabile');
  assert.equal(conta(html, /data-pid="fd1-\d+"/g), 25);
});

test('oltre 24 SLOT (non porte) la fila non entra: due righe di LED, anche con i moduli', () => {
  // 96 porte duplex su slot duplex = 96 slot
  const duplex96 = frontale({ spec: { ppFiberConnector: 'lc-duplex' } }, 96);
  assert.equal(conta(duplex96, /rack-ports-2row/g), 1);
  assert.equal(conta(duplex96, /fo-slot|fo-cell|fo-module/g), 0);
  // 96 porte quad/duplex = 48 slot
  const quad96 = frontale({ spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'duplex' } }, 96);
  assert.equal(conta(quad96, /rack-ports-2row/g), 1, '48 slot: non entrano');
  assert.equal(conta(quad96, /data-pid="fd1-\d+"/g), 96);
  // 49 porte quad/duplex = 25 slot: uno oltre il limite
  assert.equal(conta(frontale({ spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'duplex' } }, 49), /rack-ports-2row/g), 1);
  assert.equal(conta(frontale({ spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'duplex' } }, 48), /rack-ports-2row/g), 0, '24 slot: entrano');
});

test('Lineare a mano con i moduli: la fila unica vale anche oltre 24 slot (e\' una scelta dichiarata)', () => {
  const html = frontale({ spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'duplex' }, frontPanel: { baseLayout: 'linear' } }, 96);
  assert.equal(conta(html, MODULI), 48);
  assert.equal(conta(html, /rack-ports-2row/g), 0);
});

test('un patch panel con l\'unita\' dichiarata non diventa un cassetto', () => {
  const html = frontale({ type: 'patchpanel', ppMedia: 'fiber', spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'single' }, frontPanel: { baseLayout: 'linear' } }, 24);
  assert.equal(conta(html, /fo-module|fo-cell|fo-slot/g), 0);
});

// ── Il pannello: lc-quad, «una porta e'…», e il riassunto derivato ──────────────────────────────────────
const UNITA = /<select data-change="update-n" data-nfield="ppFiberPortUnit">([\s\S]*?)<\/select>/;

test('pannello del cassetto: LC quad fra i connettori, per il cassetto e per il patch panel (UNA lista)', () => {
  assert.match(pannello({ type: 'fiberdrawer' }), /<option value="lc-quad"/);
  assert.match(pannello({ type: 'patchpanel', ppMedia: 'fiber' }), /<option value="lc-quad"/);
});

test('pannello del cassetto: «Una porta e\'» compare solo per i moduli LC e parte dal duplex', () => {
  for (const c of ['lc-duplex', 'lc-quad']) {
    const sel = UNITA.exec(pannello({ type: 'fiberdrawer', spec: { ppFiberConnector: c } }));
    assert.ok(sel, `${c}: la tendina c'e'`);
    assert.match(sel[1], /<option value="duplex"\s+selected>/, `${c}: il duplex e' la scelta di partenza (il modello di InfraNet)`);
    assert.match(sel[1], /<option value="single"\s*>/);
    assert.doesNotMatch(sel[1], /<option value=""/, 'niente «non dichiarato»: e\' un\'unita\' di conto, non un fatto fisico');
  }
  for (const c of ['', 'sc', 'st', 'fc', 'lc-simplex', 'mpo-12']) {
    const spec = c ? { ppFiberConnector: c } : {};
    assert.doesNotMatch(pannello({ type: 'fiberdrawer', spec }), UNITA, `«${c}»: la porta e' il connettore, niente da scegliere`);
  }
  const single = UNITA.exec(pannello({ type: 'fiberdrawer', spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'single' } }));
  assert.match(single[1], /<option value="single"\s+selected>/);
});

test('pannello del patch panel: nessuna scelta di unita\' (i patch panel contano le porte e basta)', () => {
  assert.doesNotMatch(pannello({ type: 'patchpanel', ppMedia: 'fiber', spec: { ppFiberConnector: 'lc-duplex' } }), UNITA);
});

test('pannello del cassetto: riga derivata «porte · slot · fibre», solo col connettore dichiarato', () => {
  const quad = pannello({ type: 'fiberdrawer', ports: 96, spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'single' } });
  assert.match(quad, /96 porte · 24 slot · 96 fibre/);
  const quad2 = pannello({ type: 'fiberdrawer', ports: 48, spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'duplex' } });
  assert.match(quad2, /48 porte · 24 slot · 96 fibre/);
  assert.match(pannello({ type: 'fiberdrawer', spec: { ppFiberConnector: 'lc-duplex' } }), /24 porte · 24 slot · 48 fibre/);
  assert.doesNotMatch(pannello({ type: 'fiberdrawer' }), /porte · \d+ slot/, 'senza connettore non si dice quante fibre');
});

test('pannello del cassetto: oltre 24 slot PER U lo dice, perche\' le file non entrano', () => {
  assert.match(pannello({ type: 'fiberdrawer', ports: 96, spec: { ppFiberConnector: 'lc-duplex' } }), /Oltre 24 slot \(1U × 24\)[^<]*alta densità[^<]*senza i fori/);
  assert.match(pannello({ type: 'fiberdrawer', ports: 96, sizeU: 2, spec: { ppFiberConnector: 'lc-duplex' } }), /Oltre 48 slot \(2U × 24\)[^<]*alta densità/, 'a 2U il limite e\' 48');
  assert.doesNotMatch(pannello({ type: 'fiberdrawer', ports: 24, spec: { ppFiberConnector: 'lc-duplex' } }), /Oltre \d+ slot/);
  assert.doesNotMatch(pannello({ type: 'fiberdrawer', ports: 96, sizeU: 2, spec: { ppFiberConnector: 'lc-duplex', ppFiberPortUnit: 'single' } }), /Oltre \d+ slot/, '96 porte da un LC su slot duplex = 48 slot: a 2U entrano');
});

// ── L'ALTEZZA U: una fila di slot per ogni U, 24 slot a fila — il 96 sta su 2U ───────────────────────────
const RIGHE_SLOT = (html) => html.split('<div class="rack-ports-row"').slice(1);

test('2U: 48 slot = DUE file da 24, riempite dall\'alto (la prima fila ha gli slot 1-24)', () => {
  const html = frontale({ sizeU: 2, spec: { ppFiberConnector: 'lc-duplex' } }, 48);
  const righe = RIGHE_SLOT(html);
  assert.equal(righe.length, 2, 'una fila per U');
  assert.equal(conta(html, SLOT_CONNETTORE('lc2')), 48, 'tutte e 48 le porte sono slot disegnati');
  assert.deepEqual(righe.map((r) => conta(r, /data-pid="fd1-\d+"/g)), [24, 24]);
  assert.match(righe[0], /data-pid="fd1-1"/);
  assert.match(righe[0], /data-pid="fd1-24"/);
  assert.match(righe[1], /data-pid="fd1-25"/, 'la seconda fila riparte dopo la prima: numerazione per file, non a pettine');
  assert.doesNotMatch(righe[0], /data-pid="fd1-25"/);
});

test('2U, LC quad, porta = singolo LC: 96 porte = 24 moduli, che stanno in UNA fila: l\'altezza non cambia il disegno', () => {
  const html = frontale({ sizeU: 2, spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'single' } }, 96);
  assert.equal(conta(html, MODULI), 24);
  assert.equal(conta(html, /rack-ports-2row/g), 0, '24 slot: una fila, anche se il cassetto e\' alto 2U');
});

test('2U, LC quad, porta duplex: 96 porte = 48 moduli in DUE file (il cassetto da 192 fibre)', () => {
  const html = frontale({ sizeU: 2, spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'duplex' } }, 96);
  assert.equal(conta(html, MODULI), 48);
  assert.equal(conta(html, CELLA('lc2')), 96);
  const righe = RIGHE_SLOT(html);
  assert.deepEqual(righe.map((r) => conta(r, MODULI)), [24, 24]);
  assert.equal(conta(righe[0], /data-pid="fd1-48"/g), 1, 'la prima fila finisce alla porta 48');
  assert.equal(conta(righe[1], /data-pid="fd1-49"/g), 1);
});

test('2U, 96 porte duplex = 96 slot: servono 4 file, ce ne sono 2: LED di sempre', () => {
  const html = frontale({ sizeU: 2, spec: { ppFiberConnector: 'lc-duplex' } }, 96);
  assert.equal(conta(html, /fo-slot|fo-cell|fo-module/g), 0);
  assert.equal(conta(html, /data-pid="fd1-\d+"/g), 96);
});

test('i confini: 2U entra con 48 slot e non con 49; 3U con 72; le file avanzano di 24', () => {
  const quad = (u, porte) => frontale({ sizeU: u, spec: { ppFiberConnector: 'lc-quad', ppFiberPortUnit: 'duplex' } }, porte);
  assert.equal(conta(quad(2, 96), MODULI), 48, '2U: 48 slot');
  assert.equal(conta(quad(2, 97), MODULI), 0, '49 slot in 2U: non entrano');
  assert.equal(conta(quad(3, 144), MODULI), 72, '3U: 72 slot');
  assert.equal(RIGHE_SLOT(quad(3, 144)).length, 3);
  assert.equal(conta(quad(1, 48), MODULI), 24, '1U: 24 slot');
  assert.equal(conta(quad(1, 50), MODULI), 0, '25 slot in 1U: non entrano');
});

test('2U con le due righe scelte a mano (sequenziale/alternata) torna ai LED: e\' la scelta di chi le vuole', () => {
  for (const baseLayout of ['sequential', 'alternating']) {
    const html = frontale({ sizeU: 2, spec: { ppFiberConnector: 'lc-duplex' }, frontPanel: { baseLayout } }, 48);
    assert.equal(conta(html, /fo-slot|fo-cell|fo-module/g), 0, baseLayout);
  }
});

// ── SC DUPLEX, LC simplex come caso della porta singola, e il messaggio del pannello ad alta densita' ─────────
test('SC duplex, porta duplex: 24 slot alti con DUE fori grandi (la famiglia «SC duplex footprint», 48 fibre)', () => {
  const html = frontale({ spec: { ppFiberConnector: 'sc-duplex' } }, 24);
  assert.equal(conta(html, SLOT_CONNETTORE('big2')), 24);
  assert.equal(conta(html, /<circle /g), 48);
  assert.equal(conta(html, /r="52\.9"/g), 48, 'il foro grande');
  assert.equal(conta(html, /fo-slot fo-big2 fo-tall/g), 24, 'lo slot SC duplex e\' alto');
  assert.equal(conta(html, /rack-ports-2row/g), 0);
  assert.equal(conta(html, MODULI), 0, 'con la porta duplex nessun modulo');
});

test('SC duplex, porta = singolo connettore: 48 porte = 24 moduli da 2 celle con un foro grande l\'una', () => {
  const html = frontale({ spec: { ppFiberConnector: 'sc-duplex', ppFiberPortUnit: 'single' } }, 48);
  assert.equal(conta(html, MODULI), 24);
  assert.equal(conta(html, CELLA('big')), 48);
  assert.equal(conta(html, /fo-tall/g), 24, 'il modulo SC duplex e\' alto');
  assert.equal(conta(html, /<circle /g), 48);
});

test('LC simplex (dato vecchio): resta disegnato com\'era, ma «LC duplex + porta singola» da lo stesso foro per porta', () => {
  const vecchio = frontale({ spec: { ppFiberConnector: 'lc-simplex' } }, 24);
  assert.equal(conta(vecchio, SLOT_CONNETTORE('lc1')), 24);
  const nuovo = frontale({ spec: { ppFiberConnector: 'lc-duplex', ppFiberPortUnit: 'single' } }, 24);
  assert.equal(conta(nuovo, CELLA('lc1')), 24, 'ventiquattro porte da un LC, in 12 moduli');
  assert.equal(conta(nuovo, MODULI), 12);
});

test('pannello del cassetto: SC duplex fra i connettori, e «una porta e\'» anche per lui; il riassunto conta 2 fibre per porta', () => {
  assert.match(pannello({ type: 'fiberdrawer' }), /<option value="sc-duplex"/);
  assert.match(pannello({ type: 'patchpanel', ppMedia: 'fiber' }), /<option value="sc-duplex"/, 'la lista e\' una sola: il patch panel la condivide');
  const sel = UNITA.exec(pannello({ type: 'fiberdrawer', spec: { ppFiberConnector: 'sc-duplex' } }));
  assert.ok(sel, 'un modulo con 2 connettori: la porta e\' da scegliere');
  assert.match(pannello({ type: 'fiberdrawer', ports: 24, spec: { ppFiberConnector: 'sc-duplex' } }), /24 porte · 24 slot · 48 fibre/);
  assert.doesNotMatch(pannello({ type: 'fiberdrawer', spec: { ppFiberConnector: 'sc' } }), UNITA, 'l\'SC simplex: la porta e\' il connettore');
});

test('pannello del cassetto: LC simplex non e\' una voce della lista, ma se il dato c\'e\' resta visibile e selezionato', () => {
  assert.doesNotMatch(pannello({ type: 'fiberdrawer' }), /<option value="lc-simplex"/);
  assert.doesNotMatch(pannello({ type: 'fiberdrawer', spec: { ppFiberConnector: 'lc-duplex' } }), /<option value="lc-simplex"/);
  assert.match(pannello({ type: 'fiberdrawer', spec: { ppFiberConnector: 'lc-simplex' } }), /<option value="lc-simplex"\s+selected>/, 'un dato vecchio non sparisce dal pannello');
  assert.match(pannello({ type: 'patchpanel', ppMedia: 'fiber' }), /<option value="lc-simplex"/, 'il patch panel la tiene, com\'era');
});

test('pannello del cassetto: l\'avviso oltre i 24 slot per U dice che e\' un pannello ad alta densita\' disegnato senza i fori', () => {
  const html = pannello({ type: 'fiberdrawer', ports: 72, spec: { ppFiberConnector: 'lc-duplex' } });
  assert.match(html, /Oltre 24 slot \(1U × 24\): pannello ad alta densità \(a cassette\), disegnato in modo semplificato, senza i fori/);
  assert.match(pannello({ type: 'fiberdrawer', ports: 24, spec: { ppFiberConnector: 'lc-duplex' } }), /24 porte · 24 slot · 48 fibre/);
});
