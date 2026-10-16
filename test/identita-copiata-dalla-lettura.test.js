'use strict';
// ============================================================
//  UN VALORE COPIATO DALLA LETTURA NON È «SCRITTO DA UNA PERSONA»
// ============================================================
// Il Sync riempie marca/modello/matricola/firmware VUOTI copiando la lettura
// dell'ENTITY-MIB dentro `n.model`, `n.serialNumber`… — gli stessi campi in cui
// scrive una persona. Dopo la copia il campo è pieno e non porta più traccia di
// DA DOVE viene, quindi il segno del pannello (lib/certainty.js) diceva
// «Dichiarato — Scritto da una persona: non invecchia» anche su un valore che
// nessuno ha digitato. Visto il 16/10 sullo Zyxel, subito dopo aver sistemato la
// walk (f8c9de5): il Sync li ripopolava, e il punto era quello sbagliato.
//
// La regola: la copia registra la sua provenienza (`node.copiedFromRead[campo]`),
// la modifica a mano la cancella, e il segno dice «Misurato» SOLO finché il campo
// è marcato E coincide ancora con la lettura corrente. Se l'apparato viene
// sostituito e la lettura cambia, il valore copiato torna «Dichiarato» e la
// Verifica fa il suo mestiere.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ID = require('../lib/identity-reconcile.js');
const { certaintyForField } = require('../lib/certainty.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const LETTA = { brand: 'ZyXEL, Inc.', model: 'GS1900-24', serialNumber: 'S202L27002866', firmwareVer: '2.10.68857', source: 'ENTITY-MIB' };

// ── puro: la copia e la sua provenienza ──────────────────────────────────────

test('fillIdentityFromRead: copia nei campi VUOTI e ne registra la provenienza, campo per campo', () => {
  const n = { id: 'sw', type: 'switch' };
  const scritti = ID.fillIdentityFromRead(n, LETTA, '');
  assert.deepEqual([...scritti].sort(), ['brand', 'firmwareVer', 'model', 'serialNumber']);
  assert.equal(n.model, 'GS1900-24');
  assert.deepEqual(n.copiedFromRead, { brand: true, model: true, serialNumber: true, firmwareVer: true });
});

test('fillIdentityFromRead: un campo che una persona ha già compilato non si tocca e non si marca', () => {
  const n = { id: 'sw', type: 'switch', model: 'IL MIO MODELLO', serialNumber: '   ' };
  const scritti = ID.fillIdentityFromRead(n, LETTA, '');
  assert.equal(n.model, 'IL MIO MODELLO', 'manual-first: il dichiarato è legge');
  assert.ok(!scritti.includes('model'));
  assert.ok(!(n.copiedFromRead || {}).model, 'il modello digitato NON deve risultare copiato');
  assert.equal(n.serialNumber, 'S202L27002866', 'degli spazi non sono un valore: si riempie');
});

test('fillIdentityFromRead: la marca segue le regole di sempre (lucchetto, default del catalogo, scelta a mano)', () => {
  // Equivalenza con il vecchio `canFillBrand` di app-snmp.js.
  const bloccata = { brandManual: true };
  ID.fillIdentityFromRead(bloccata, LETTA, 'Generic');
  assert.equal(bloccata.brand, undefined, 'brandManual: la lettura non riscrive una marca scelta');
  const aDefault = { brand: 'Generic' };
  ID.fillIdentityFromRead(aDefault, LETTA, 'Generic');
  assert.equal(aDefault.brand, 'ZyXEL, Inc.', 'la marca di default del catalogo è un\'ipotesi: la lettura la sostituisce');
  assert.equal(aDefault.copiedFromRead.brand, true);
  const scelta = { brand: 'Altro' };
  ID.fillIdentityFromRead(scelta, LETTA, 'Generic');
  assert.equal(scelta.brand, 'Altro', 'una marca scritta a mano non si tocca');
  assert.ok(!(scelta.copiedFromRead || {}).brand);
});

test('fillIdentityFromRead: senza identità letta non scrive nulla e non crea il campo', () => {
  for (const inv of [null, undefined, {}, { source: 'ENTITY-MIB', entityIndex: 64 }, 'x']) {
    const n = { id: 'sw' };
    assert.deepEqual(ID.fillIdentityFromRead(n, inv, ''), []);
    assert.ok(!('copiedFromRead' in n), 'nessun oggetto vuoto lasciato sul nodo');
  }
});

test('forgetCopiedFromRead: toglie il campo e, se era l\'ultimo, l\'intero oggetto', () => {
  const n = { copiedFromRead: { model: true, brand: true } };
  ID.forgetCopiedFromRead(n, 'model');
  assert.deepEqual(n.copiedFromRead, { brand: true });
  ID.forgetCopiedFromRead(n, 'brand');
  assert.ok(!('copiedFromRead' in n), 'un oggetto vuoto non si persiste');
  ID.forgetCopiedFromRead(n, 'model');                       // già vuoto: nessun errore
  ID.forgetCopiedFromRead(null, 'model');
});

test('copiedStillRead: vero SOLO se marcato, letto, e ancora uguale (trim + maiuscole)', () => {
  const n = { model: 'GS1900-24', copiedFromRead: { model: true } };
  assert.equal(ID.copiedStillRead(n, 'model', 'GS1900-24'), true);
  assert.equal(ID.copiedStillRead(n, 'model', '  gs1900-24 '), true, 'padding e maiuscole dell\'ENTITY-MIB non contano');
  assert.equal(ID.copiedStillRead(n, 'model', 'ALTRO'), false, 'l\'apparato è cambiato: il copiato torna dichiarato');
  assert.equal(ID.copiedStillRead(n, 'model', ''), false, 'nessuna lettura: niente da confermare');
  assert.equal(ID.copiedStillRead(n, 'model', undefined), false);
  const digitato = { model: 'GS1900-24' };                    // stesso valore, ma scritto da una persona
  assert.equal(ID.copiedStillRead(digitato, 'model', 'GS1900-24'), false, 'senza marca resta dichiarato');
  assert.equal(ID.copiedStillRead({ model: 'x', copiedFromRead: { serialNumber: true } }, 'model', 'x'), false, 'la marca è per campo');
});

test('adoptIdentityFromRead: «Adotta» dalla Verifica copia dalla misura e lo registra', () => {
  const n = { id: 'sw', serialNumber: 'VECCHIO', model: 'VECCHIO', firmwareVer: '1.0' };
  ID.adoptIdentityFromRead(n, { serialNumber: 'NUOVO', model: null, firmwareVer: '2.0' });
  assert.equal(n.serialNumber, 'NUOVO');
  assert.equal(n.model, 'VECCHIO', 'un campo assente nel patch non si tocca (come prima)');
  assert.equal(n.firmwareVer, '2.0');
  assert.deepEqual(n.copiedFromRead, { serialNumber: true, firmwareVer: true });
});

// ── il grado ─────────────────────────────────────────────────────────────────

test('certaintyForField: un copiato ancora uguale alla lettura è «Misurato»; il resto resta come prima', () => {
  assert.deepEqual(certaintyForField('GS1900-24', 'GS1900-24', { copiedFromRead: true }),
    { grade: 'measured', labelKey: 'cty.measured', source: 'read' });
  // senza il verdetto, o con verdetto falso: il pieno è dichiarato, come ha sempre detto il test dei campi
  assert.equal(certaintyForField('GS1900-24', 'GS1900-24').grade, 'declared');
  assert.equal(certaintyForField('GS1900-24', 'GS1900-24', { copiedFromRead: false }).grade, 'declared');
  assert.equal(certaintyForField('GS1900-24', 'GS1900-24', {}).grade, 'declared');
  // il verdetto «una lettura l'ha scritto o lo conferma» NON richiede una lettura di adesso: l'apparato ha detto
  // quel valore, e un apparato che tace (o la cui lettura e' stantia) non lo smentisce
  assert.equal(certaintyForField('GS1900-24', '', { copiedFromRead: true }).grade, 'measured');
  assert.equal(certaintyForField('GS1900-24', undefined, { copiedFromRead: true }).grade, 'measured');
  // campo vuoto: invariato, il verdetto non conta
  assert.equal(certaintyForField('', 'GS1900-24', { copiedFromRead: true }).grade, 'measured');
  assert.equal(certaintyForField('', '', { copiedFromRead: true }).grade, 'undeclared');
});

// ── nel browser finto: chi scrive, chi cancella, cosa si vede ────────────────

let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

const J = (code) => JSON.parse(run(APP.ctx, '(() => { try { ' + code + ' } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.message||e) }); } })()'));

test('applyPollResult: il Sync marca ciò che ha copiato e solo quello', () => {
  const r = J(`
    state = _buildDefaultState();
    state.nodes.push({ id:'sw5', type:'switch', name:'Z', ports:2, ip:'10.0.0.5', model:'MIO MODELLO' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    applyPollResult('sw5', { ok:true, lags:[], vlans:[], interfaces:[], inventory:${JSON.stringify(LETTA)} }, { noHistory:true });
    const n = nodeById('sw5');
    return JSON.stringify({ ok:true, model:n.model, serial:n.serialNumber, fw:n.firmwareVer, brand:n.brand, copied:n.copiedFromRead||null });`);
  assert.ok(r.ok, r.err);
  assert.equal(r.model, 'MIO MODELLO', 'il modello digitato non si tocca');
  assert.equal(r.serial, 'S202L27002866');
  assert.deepEqual(r.copied, { brand: true, serialNumber: true, firmwareVer: true }, 'marcati i tre copiati, non il modello digitato');
});

test('updateN: riscrivere o svuotare un campo copiato ne cancella la provenienza', () => {
  const r = J(`
    state = _buildDefaultState();
    state.nodes.push({ id:'sw6', type:'switch', name:'Z', ports:2, ip:'10.0.0.6' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    applyPollResult('sw6', { ok:true, lags:[], vlans:[], interfaces:[], inventory:${JSON.stringify(LETTA)} }, { noHistory:true });
    selType='node'; selId='sw6';
    const prima = JSON.stringify(nodeById('sw6').copiedFromRead);
    updateN('model', 'GS1900-24');                       // lo stesso valore, ma adesso lo scrive una persona
    const dopoModello = JSON.stringify(nodeById('sw6').copiedFromRead);
    updateN('serialNumber', undefined);                  // svuotato
    const dopoSeriale = JSON.stringify(nodeById('sw6').copiedFromRead);
    updateN('brand', 'Altro');
    updateN('firmwareVer', 'x');
    const finale = nodeById('sw6').copiedFromRead;
    return JSON.stringify({ ok:true, prima, dopoModello, dopoSeriale, finale: finale === undefined ? 'assente' : finale });`);
  assert.ok(r.ok, r.err);
  assert.deepEqual(JSON.parse(r.prima), { brand: true, model: true, serialNumber: true, firmwareVer: true });
  assert.deepEqual(JSON.parse(r.dopoModello), { brand: true, serialNumber: true, firmwareVer: true }, 'digitare toglie la marca di quel campo');
  assert.deepEqual(JSON.parse(r.dopoSeriale), { brand: true, firmwareVer: true });
  assert.equal(r.finale, 'assente', 'tolti tutti: sul nodo non resta nemmeno l\'oggetto vuoto');
});

test('svuotato e rimportato: il campo si ripopola e torna a risultare copiato', () => {
  const r = J(`
    state = _buildDefaultState();
    state.nodes.push({ id:'sw7', type:'switch', name:'Z', ports:2, ip:'10.0.0.7' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const dati = { ok:true, lags:[], vlans:[], interfaces:[], inventory:${JSON.stringify(LETTA)} };
    applyPollResult('sw7', dati, { noHistory:true });
    selType='node'; selId='sw7';
    for (const k of ['brand','model','serialNumber','firmwareVer']) updateN(k, undefined);
    const vuoto = JSON.stringify({ m:nodeById('sw7').model||'', c:nodeById('sw7').copiedFromRead||null });
    applyPollResult('sw7', dati, { noHistory:true });
    const n = nodeById('sw7');
    return JSON.stringify({ ok:true, vuoto, model:n.model, copied:n.copiedFromRead });`);
  assert.ok(r.ok, r.err);
  assert.deepEqual(JSON.parse(r.vuoto), { m: '', c: null });
  assert.equal(r.model, 'GS1900-24');
  assert.deepEqual(r.copied, { brand: true, model: true, serialNumber: true, firmwareVer: true });
});

/** Il grado che il pannello disegna sull'etichetta di un campo dell'inventario (null = nessun segno). */
function segnoPannello(nodo, campo) {
  const r = J(`
    state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
    _propsExplicit = true;
    state.nodes.push(Object.assign({ id:'swp', type:'switch', name:'SW-P', ports:4, x:10, y:10 }, ${JSON.stringify(nodo)}));
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    selType='node'; selId='swp'; renderProps();
    return JSON.stringify({ ok:true, html: document.getElementById('props-panel').innerHTML || '' });`);
  assert.ok(r.ok, r.err);
  const re = new RegExp('<label>[^<]*(?:<span class="cty-mark cty-(\\w+)"[^>]*></span>)?\\s*</label><input[^>]*data-field="' + campo + '"');
  const m = r.html.match(re);
  assert.ok(m, 'il campo ' + campo + ' non è nel pannello');
  return m[1] || null;
}

test('pannello: copiato e ancora uguale alla lettura → «Misurato»', () => {
  const nodo = { model: 'GS1900-24', copiedFromRead: { model: true }, integration: { inventory: { model: 'GS1900-24' } } };
  assert.equal(segnoPannello(nodo, 'model'), 'measured');
});

test("pannello: uguale a ciò che dice l'apparato → «Misurato» anche se nessuno l'aveva marcato (i dati copiati prima delle marche guariscono)", () => {
  // Una lettura che trova nel campo lo stesso valore lo CONFERMA. Vale per un valore copiato da una versione dell'app
  // che non teneva ancora la provenienza — i progetti salvati ne sono pieni — e vale, per forza, anche per uno scritto
  // a mano che per caso coincide: l'apparato lo dice, e questo e' cio' che il punto afferma.
  const nodo = { model: 'GS1900-24', integration: { inventory: { model: 'GS1900-24' } } };
  assert.equal(segnoPannello(nodo, 'model'), 'measured');
});

test("pannello: scritto a mano e DIVERSO da ciò che dice l'apparato → «Dichiarato»", () => {
  const nodo = { model: 'GS1900-24', integration: { inventory: { model: 'GS1900-48' } } };
  assert.equal(segnoPannello(nodo, 'model'), 'declared');
});

test("pannello: marcato e l'apparato adesso tace (nessun inventory) → resta «Misurato»", () => {
  const nodo = { model: 'GS1900-24', copiedFromRead: { model: true } };
  assert.equal(segnoPannello(nodo, 'model'), 'measured', "letto da un apparato: se poi tace non è stato scritto da una persona");
});

test("pannello: la marca, scritta dall'OUI, non è smentita da un altro nome dell'ENTITY-MIB", () => {
  // La Discovery scrive «Cisco» dall'OUI, l'ENTITY-MIB dice «Cisco Systems Inc»: due fonti, due ortografie, nessuna
  // contraddizione. (Per modello/matricola/firmware, che hanno UNA fonte, una lettura diversa invece declassa.)
  const nodo = { brand: 'Cisco', copiedFromRead: { brand: true }, integration: { inventory: { brand: 'Cisco Systems Inc' } } };
  assert.equal(segnoPannello(nodo, 'brand'), 'measured');
  const modello = { model: 'A', copiedFromRead: { model: true }, integration: { inventory: { model: 'B' } } };
  assert.equal(segnoPannello(modello, 'model'), 'declared', "il modello letto da due apparati diversi nel tempo: l'apparato è cambiato");
});

test('pannello: copiato ma l\'apparato adesso dice altro → torna «Dichiarato» (non si finge una conferma)', () => {
  const nodo = { model: 'GS1900-24', copiedFromRead: { model: true }, integration: { inventory: { model: 'GS1900-48' } } };
  assert.equal(segnoPannello(nodo, 'model'), 'declared');
});

test('pannello: la marca è per campo — il seriale copiato non promuove il modello digitato', () => {
  const nodo = { model: 'MIO', serialNumber: 'S1', copiedFromRead: { serialNumber: true },
    integration: { inventory: { model: 'ALTRO', serialNumber: 'S1' } } };
  assert.equal(segnoPannello(nodo, 'serialNumber'), 'measured');
  assert.equal(segnoPannello(nodo, 'model'), 'declared');
});

// ── la regola contro il prossimo scrittore ───────────────────────────────────

test('nessun nuovo scrittore di marca/modello/matricola/firmware dimentica la provenienza', () => {
  // Il difetto è nato perché la copia non diceva da dove veniva. Se domani un altro
  // pezzo di src/ scrive questi campi a partire da una lettura, questo deve ARROSSIRE
  // e costringere a scegliere: passa da `fillIdentityFromRead`/`adoptIdentityFromRead`
  // (che marcano), oppure si dichiara qui come scrittura di una persona.
  const ECCEZIONI = {
    // L'utente sceglie un modello dal CATALOGO: è una sua decisione, quindi dichiarato.
    'app-device-types.js': 'catalogo scelto dall\'utente',
  };
  const dir = path.join(ROOT, 'src');
  const trovati = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/\b[nN]ode\.(model|serialNumber|firmwareVer)\s*=[^=]|\bn\.(model|serialNumber|firmwareVer)\s*=[^=]/.test(src)) trovati.push(f);
  }
  const fuori = trovati.filter(f => !ECCEZIONI[f]);
  assert.deepEqual(fuori, [],
    'questi file scrivono model/serialNumber/firmwareVer direttamente: usa fillIdentityFromRead/adoptIdentityFromRead (che registrano la provenienza) o aggiungi un\'eccezione motivata: ' + fuori.join(', '));
});
