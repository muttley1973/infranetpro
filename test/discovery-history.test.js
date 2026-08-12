'use strict';
// ============================================================
// DISCOVERY-HISTORY — test del cuore puro estratto da src/app-autolink.js.
// pruneDiscoveryHistory (aging + tetto) e normalizeFdbVlan (mappa VLAN-per-MAC).
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const {
  pruneDiscoveryHistory, normalizeFdbVlan,
  observationKey, sanitizeObservation, foldObservations, mergeObservations, stripObservations,
  DISCOVERY_HISTORY_MAX, DISCOVERY_HISTORY_MAX_AGE_DAYS,
} = require('../lib/discovery-history.js');

const DAY = 864e5;
const iso = ms => new Date(ms).toISOString();

test('costanti di default esportate', () => {
  assert.equal(DISCOVERY_HISTORY_MAX, 1000);
  assert.equal(DISCOVERY_HISTORY_MAX_AGE_DAYS, 90);
});

test('pruneDiscoveryHistory: scarta le observation più vecchie del cutoff (lastSeen)', () => {
  const now = Date.UTC(2026, 5, 19);
  const list = [
    { mac: 'old', lastSeen: iso(now - 100 * DAY) },   // oltre 90gg → via
    { mac: 'fresh', lastSeen: iso(now - 10 * DAY) },   // recente → resta
    { mac: 'edge', lastSeen: iso(now - 89 * DAY) },    // appena dentro → resta
  ];
  const out = pruneDiscoveryHistory(list, { now });
  assert.equal(out, list, 'sfoltisce IN PLACE e ritorna lo stesso array');
  assert.deepEqual(list.map(r => r.mac), ['fresh', 'edge']);
});

test('pruneDiscoveryHistory: usa ts come fallback se manca lastSeen', () => {
  const now = Date.UTC(2026, 5, 19);
  const list = [
    { mac: 'a', ts: iso(now - 200 * DAY) },  // vecchio via ts → via
    { mac: 'b', ts: iso(now - 1 * DAY) },    // recente via ts → resta
  ];
  pruneDiscoveryHistory(list, { now });
  assert.deepEqual(list.map(r => r.mac), ['b']);
});

test('pruneDiscoveryHistory: tiene i record senza data valida (legacy)', () => {
  const now = Date.UTC(2026, 5, 19);
  const list = [
    { mac: 'legacy' },                       // nessuna data → tenuto
    { mac: 'old', lastSeen: iso(now - 365 * DAY) }, // vecchio → via
    { mac: 'baddate', lastSeen: 'non-una-data' },   // data invalida → tenuto
  ];
  pruneDiscoveryHistory(list, { now });
  assert.deepEqual(list.map(r => r.mac), ['legacy', 'baddate']);
});

test('pruneDiscoveryHistory: applica il tetto rigido tenendo le più recenti (in coda)', () => {
  const now = Date.now();
  const list = Array.from({ length: 10 }, (_, i) => ({ mac: 'm' + i, lastSeen: iso(now - i * 1000) }));
  pruneDiscoveryHistory(list, { now, max: 4, maxAgeDays: 99999 });
  assert.equal(list.length, 4);
  // splice(0, len-max) rimuove dalla TESTA → restano gli ultimi 4 (m6..m9)
  assert.deepEqual(list.map(r => r.mac), ['m6', 'm7', 'm8', 'm9']);
});

test('pruneDiscoveryHistory: input non-array → ritorna invariato', () => {
  assert.equal(pruneDiscoveryHistory(null), null);
  assert.equal(pruneDiscoveryHistory(undefined), undefined);
});

test('normalizeFdbVlan: parseInt + dedup, prima occorrenza vince', () => {
  const out = normalizeFdbVlan({ 'AA:BB': '10', 'aa:bb': '20', 'CC:DD': 30 });
  // chiave default = lowercase → 'aa:bb' duplicata, vince la prima (10)
  assert.deepEqual(out, { 'aa:bb': 10, 'cc:dd': 30 });
});

test('normalizeFdbVlan: scarta VLAN non numeriche e MAC vuoti', () => {
  const out = normalizeFdbVlan({ 'AA': 'x', '': 5, 'BB': 12 });
  assert.deepEqual(out, { bb: 12 });   // 'AA' scartata (VLAN non numerica), '' scartata (MAC vuoto)
});

test('normalizeFdbVlan: usa il normalizzatore MAC iniettato', () => {
  const stripColon = m => String(m).replace(/[:.-]/g, '').toLowerCase();
  const out = normalizeFdbVlan({ 'AA:BB:CC': 7 }, stripColon);
  assert.deepEqual(out, { aabbcc: 7 });
});

test('normalizeFdbVlan: input non-oggetto → mappa vuota', () => {
  assert.deepEqual(normalizeFdbVlan(null), {});
  assert.deepEqual(normalizeFdbVlan('x'), {});
});

// ============================================================
// Le osservazioni vivono FUORI dal documento: sanificazione, fusione, migrazione.
// ============================================================
const OBS = (over) => Object.assign({
  ts: '2026-05-01T10:00:00.000Z', lastSeen: '2026-08-01T10:00:00.000Z', count: 3,
  mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.50',
  switchId: 'sw1', switchName: 'Core', portId: 'sw1-4', ifName: 'Gi1/0/4',
  source: 'FDB', confidence: 0.8,
}, over || {});

test('sanitizeObservation: serve un MAC o un IP, e la FORMA del record non cambia', () => {
  assert.equal(sanitizeObservation(null), null);
  assert.equal(sanitizeObservation({ count: 9 }), null, 'senza mac e senza ip non identifica niente');
  const o = sanitizeObservation({ mac: ' aa:bb ', count: 0, confidence: 'x' });
  // I cinque campi testuali ci sono SEMPRE, anche vuoti: un round-trip non deve
  // cambiare la forma sotto ai lettori (chi confronta con '' smetterebbe di trovarli).
  for (const k of ['switchId', 'switchName', 'portId', 'ifName', 'source']) assert.equal(o[k], '');
  assert.equal(o.mac, 'aa:bb', 'trim sì, ri-normalizzazione del MAC NO');
  assert.equal(o.count, 1, 'un conteggio non valido vale 1, non 0');
  assert.equal(o.confidence, 0);
  assert.equal(sanitizeObservation({ ip: '10.0.0.1', ts: 'ieri' }).ts, undefined, 'data illeggibile scartata');
});

test('⚠️ fold: tiene la storia PIÙ LARGA (primo più antico, ultimo più recente, conteggio maggiore)', () => {
  const vecchia = OBS({ ts: '2026-01-01T00:00:00.000Z', lastSeen: '2026-02-01T00:00:00.000Z', count: 10, confidence: 0.4 });
  const nuova   = OBS({ ts: '2026-07-01T00:00:00.000Z', lastSeen: '2026-08-10T00:00:00.000Z', count: 2,  confidence: 0.9 });
  const { observations } = foldObservations({ observations: [vecchia] }, { observations: [nuova] });
  assert.equal(observations.length, 1, 'stessa chiave = una riga sola');
  const o = observations[0];
  assert.equal(o.ts, '2026-01-01T00:00:00.000Z', 'il primo avvistamento è il più antico');
  assert.equal(o.lastSeen, '2026-08-10T00:00:00.000Z', 'l\'ultimo è il più recente');
  assert.equal(o.count, 10);
  assert.equal(o.confidence, 0.9);
});

test('⚠️ fold IDEMPOTENTE: risalvare non gonfia il conteggio', () => {
  // Il conteggio alimenta il punteggio di lib/temporal-confidence.js: sommarlo a
  // ogni Salva trasformerebbe due salvataggi in una certezza inventata.
  const uno = foldObservations(null, { observations: [OBS()] });
  const due = foldObservations(uno, { observations: [OBS()] });
  const tre = foldObservations(due, uno);
  assert.equal(due.observations[0].count, 3);
  assert.equal(tre.observations[0].count, 3);
  assert.equal(tre.observations.length, 1);
});

test('fold: chiavi diverse restano righe diverse, e l\'aging vale sull\'unione', () => {
  const a = OBS();
  const b = OBS({ portId: 'sw1-9', ifName: 'Gi1/0/9' });
  assert.equal(observationKey(a) === observationKey(b), false);
  assert.equal(foldObservations({ observations: [a] }, { observations: [b] }).observations.length, 2);
  // Vecchia di 200 giorni → fuori per aging (tetto 90).
  const antica = OBS({ ts: iso(Date.now() - 200 * DAY), lastSeen: iso(Date.now() - 200 * DAY), mac: '11:22:33:44:55:66' });
  const out = foldObservations({ observations: [antica] }, { observations: [OBS({ lastSeen: iso(Date.now()) })] });
  assert.equal(out.observations.length, 1, 'l\'aging gira sull\'unione, non sui pezzi');
});

test('fold difensivo: ingressi nulli, malformati, non-array', () => {
  assert.deepEqual(foldObservations(null, null), { observations: [] });
  assert.deepEqual(foldObservations({ observations: 'no' }, undefined), { observations: [] });
  assert.deepEqual(foldObservations([OBS()], null).observations.length, 1, 'accetta anche l\'array nudo');
});

test('merge rimette nello stato, strip lo toglie — e il documento non si tocca', () => {
  // Progetto vecchio: le osservazioni se le trascina DENTRO, il sidecar non c'è.
  const state = { nodes: [{ id: 'sw1', name: 'Core' }], discoveryHistory: { observations: [OBS()] } };
  assert.equal(mergeObservations(state, null), 1, 'quelle del documento non si perdono');
  assert.equal(mergeObservations(state, { observations: [OBS({ mac: '11:22:33:44:55:66' })] }), 2, 'unione con il sidecar');
  assert.equal(stripObservations(state), 2);
  assert.equal('discoveryHistory' in state, false);
  assert.equal(state.nodes[0].name, 'Core', 'il dichiarato resta');
  assert.equal(stripObservations(state), 0, 'idempotente');
  assert.equal(stripObservations(null), 0);
  assert.equal(mergeObservations(null, { observations: [OBS()] }), 0);
});

// ── Aggancio alla route ──────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const R_PROJECTS = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'projects.js'), 'utf8');

test('⚠️ il Salva fa confluire le osservazioni PRIMA di scrivere il progetto', () => {
  assert.match(R_PROJECTS, /_observationsOutOfDocument\(id, state\);/);
  assert.ok(R_PROJECTS.indexOf('_observationsOutOfDocument(id, state);') <
            R_PROJECTS.indexOf('saveProject(id, name, state, p.created_at, now)'),
    'prima nel sidecar, poi il documento: al contrario la migrazione non finisce mai');
  assert.match(R_PROJECTS, /mergeObservations\(p\.state, _history\.readObservations\(id\)\)/, 'la GET le rimette');
  assert.match(R_PROJECTS, /stripObservations\(state\);/, 'progetto NUOVO: si toglie e basta');
  assert.match(R_PROJECTS, /stripObservations\(src\.state\);/, 'la copia nasce senza');
});

const R_HISTORY = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'history.js'), 'utf8');
const AUTOLINK = fs.readFileSync(path.join(__dirname, '..', 'src', 'app-autolink.js'), 'utf8');
const DISCOVERY = fs.readFileSync(path.join(__dirname, '..', 'src', 'app-discovery.js'), 'utf8');

test('⚠️ la scansione manda le osservazioni appena finita, senza aspettare un Salva', () => {
  // Tre anelli, e basta romperne uno per riavere il bug: la scansione manda, la
  // route fonde e salva, la GET del progetto le rimette (già asserita sopra).
  assert.match(AUTOLINK, /export function _persistObservations\(\)/);
  assert.match(AUTOLINK, /history\/observations`, \{\s*\n?\s*method:'PUT'/, 'PUT al sidecar');
  // Fine giro dell'auto-scoperta: si spedisce DOPO aver raccolto, non prima.
  assert.ok(AUTOLINK.indexOf('if(historyAdded > 0){') > AUTOLINK.indexOf('let historyAdded'),
    'lo scarico sta a fine funzione, dopo la raccolta');
  assert.match(AUTOLINK, /if\(historyAdded > 0\)\{ win\.pruneDiscoveryHistory\(_ensureDiscoveryHistory\(\)\); _persistObservations\(\); \}/);
  // Fine import dei device scoperti.
  assert.match(DISCOVERY, /if\(imported > 0 \|\| updated > 0\) _persistObservations\(\);/);
  assert.ok(DISCOVERY.indexOf('_persistObservations();') > DISCOVERY.lastIndexOf('_recordDiscoveryObservation({'),
    'si spedisce dopo aver registrato');
});

test('la route fonde invece di sovrascrivere: una lista parziale non azzera l\'accumulo', () => {
  assert.match(R_HISTORY, /router\.put\('\/api\/projects\/:id\/history\/observations', auth\.requireAdmin/);
  assert.match(R_HISTORY, /foldObservations\(store\.readObservations\(id\), req\.body\)/, 'fold col salvato, mai il body nudo');
  assert.match(R_HISTORY, /if \(!_projectExists\(id\)\) return res\.status\(404\)/);
});

test('_recordDiscoveryBatch non esiste più (era morto: nessun chiamante)', () => {
  assert.equal(/_recordDiscoveryBatch/.test(AUTOLINK), false);
});
