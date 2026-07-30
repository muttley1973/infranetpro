'use strict';
// ============================================================
//  GOLDEN DEL CLASSIFICATORE (lato server, FusionScorer)
// ============================================================
//  Il tipo assegnato a un apparato era l'unica decisione importante del
//  prodotto senza uno snapshot: si poteva spostare un peso o togliere una
//  regex e accorgersi mesi dopo che una stampante era diventata uno switch.
//
//  Qui il corpus (test/fixtures/classify-corpus.js) passa nel classificatore
//  server e l'esito finisce in test/golden/classify-golden.json. Come per il
//  golden di rendering: quando diverge si LEGGE IL DIFF prima di rigenerare.
//  Il gemello lato client (`_guessType`, che vive nel browser) e' nel blocco
//  e2e omonimo di test/e2e/critical-flows.test.js.
//
//  Due livelli, diversi apposta:
//   · le righe `reg-*` sono INVARIANTI — asserite contro `expect`, non contro
//     il golden: sono i casi gia' a norma, e se si muovono e' una regressione
//     comunque, anche rigenerando;
//   · tutte le altre finiscono nel golden, che registra il comportamento di
//     OGGI — comprese le risposte sbagliate che i reperti V4/V5/V7 descrivono.
//     Il golden non certifica che siano giuste: certifica che, quando le
//     correggeremo, il movimento sara' visibile riga per riga.
// ============================================================

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { CORPUS } = require('./fixtures/classify-corpus.js');
const { _classifyDiscoveredDevice } = require('../server.js')._internals;

const GOLDEN_DIR = path.join(__dirname, 'golden');
const GOLDEN_FILE = path.join(GOLDEN_DIR, 'classify-golden.json');

function classifyAll() {
  const out = {};
  for (const c of CORPUS) {
    try { out[c.id] = _classifyDiscoveredDevice(c.row) || ''; }
    catch (e) { out[c.id] = '__ERR__ ' + (e && e.message); }
  }
  return out;
}

test('classificatore: il corpus non manda in errore nessuna riga', () => {
  const cur = classifyAll();
  const errs = Object.keys(cur).filter(k => String(cur[k]).startsWith('__ERR__'));
  assert.equal(errs.length, 0, 'righe in errore:\n' + errs.map(k => `  ${k}: ${cur[k]}`).join('\n'));
});

test('classificatore: gli invarianti `reg-*` non si muovono', () => {
  const cur = classifyAll();
  const bad = CORPUS.filter(c => c.id.startsWith('reg-') && cur[c.id] !== c.expect);
  assert.equal(bad.length, 0,
    'casi gia\' a norma che hanno cambiato tipo (regressione, non un aggiornamento del golden):\n' +
    bad.map(c => `  ${c.id}: atteso «${c.expect}», ottenuto «${cur[c.id] || '(nessuno)'}» — ${c.note}`).join('\n'));
});

test('classificatore: esito invariato vs golden', () => {
  const cur = classifyAll();

  if (process.env.UPDATE_CLASSIFY_GOLDEN || !fs.existsSync(GOLDEN_FILE)) {
    if (!fs.existsSync(GOLDEN_DIR)) fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(GOLDEN_FILE, JSON.stringify(cur, null, 1) + '\n');
    console.log(`classify golden: baseline scritta (${Object.keys(cur).length} righe) → test/golden/classify-golden.json`);
    return;
  }

  const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
  assert.deepEqual(Object.keys(cur).sort(), Object.keys(golden).sort(),
    'il set di righe del corpus e\' cambiato. Se voluto: UPDATE_CLASSIFY_GOLDEN=1 per rigenerare.');

  const byId = new Map(CORPUS.map(c => [c.id, c]));
  const diffs = Object.keys(cur)
    .filter(k => cur[k] !== golden[k])
    .map(k => `  ${k}: golden «${golden[k] || '(nessuno)'}» → ora «${cur[k] || '(nessuno)'}»` +
      `\n      atteso dai paletti: «${(byId.get(k) || {}).expect || '(nessuno)'}» — ${(byId.get(k) || {}).note || ''}`);

  assert.equal(diffs.length, 0,
    `\n${diffs.length} righe cambiano tipo rispetto al golden.\n` +
    'Guarda riga per riga se il movimento e\' quello voluto; se lo e\':\n' +
    'UPDATE_CLASSIFY_GOLDEN=1 node --test test/classify-golden.test.js\n' +
    diffs.join('\n'));
});
