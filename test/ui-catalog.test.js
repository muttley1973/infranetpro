'use strict';
// ============================================================
//  test/ui-catalog.test.js — lib/ui-catalog.js (catalogo UI per l'aiuto, §4c).
//
//  Verifica l'estrazione dei comandi DOCUMENTATI (bottoni con tooltip) e la
//  risoluzione i18n in righe «"Etichetta" — cosa fa». Test sintetico (HTML
//  inline) + smoke sul vero netmapper.html (deriva il catalogo reale).
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { extractCatalog, catalogLines, buildCatalogLines, _handler } = require('../lib/ui-catalog.js');

const DICT = {
  it: { 'discover.label': 'Scopri', 'discover.tip': 'Scansiona la rete via SNMP', 'verify.label': 'Verifica' },
  en: { 'discover.label': 'Discover', 'discover.tip': 'Scan the network via SNMP', 'verify.label': 'Verify' },
};

const SAMPLE = `
  <button class="toolbar-btn" id="btn-discover" onclick="openDiscovery()"
          data-i18n-tip="discover.tip" data-tip="Scansiona la rete">
    <i class="fas fa-satellite-dish"></i><span class="btn-label" data-i18n="discover.label"> Scopri</span>
  </button>
  <button class="toolbar-btn primary" id="btn-drift" onclick="runDriftCheck()"
          data-tip="Controllo del mattino">
    <i class="fas fa-clipboard-check"></i><span class="btn-label" data-i18n="verify.label"> Verifica</span>
  </button>
  <button onclick="closeModal()">Chiudi</button>
  <button onclick="openDiscovery()" data-tip="duplicato dello stesso handler">x</button>
`;

test('estrae solo i bottoni con tooltip, dedup per handler', () => {
  const cat = extractCatalog(SAMPLE);
  const actions = cat.map(e => e.action);
  assert.deepEqual(actions, ['openDiscovery', 'runDriftCheck'], 'closeModal escluso (no tooltip), openDiscovery una volta sola');
});

test('ASSE B: cattura i bottoni delegati (data-act) quando non c\'è onclick', () => {
  const html = `
    <button data-act="project-save" data-i18n-tip="save.tip" data-tip="Salva">
      <i class="fas fa-save"></i><span data-i18n="save.label">Salva</span>
    </button>
    <button data-act="report-menu-toggle" data-tip="Report">Report</button>
    <button data-act="noop">senza tooltip</button>`;
  const cat = extractCatalog(html);
  assert.deepEqual(cat.map(e => e.action), ['project-save', 'report-menu-toggle'],
    'data-act è l\'azione citabile; il bottone senza tooltip resta escluso');
  assert.equal(cat[0].labelKey, 'save.label', 'labelKey preso dallo span annidato anche coi bottoni delegati');
});

test('cattura labelKey (span annidato), tipKey e fallback testuali', () => {
  const cat = extractCatalog(SAMPLE);
  const disc = cat.find(e => e.action === 'openDiscovery');
  assert.equal(disc.labelKey, 'discover.label', 'data-i18n preso dallo span annidato');
  assert.equal(disc.tipKey, 'discover.tip');
  assert.equal(disc.tipText, 'Scansiona la rete');
  const drift = cat.find(e => e.action === 'runDriftCheck');
  assert.equal(drift.tipKey, null, 'nessun data-i18n-tip → tipKey null');
  assert.equal(drift.tipText, 'Controllo del mattino', 'usa data-tip come fallback');
});

test('_handler estrae il primo identificatore della chiamata', () => {
  assert.equal(_handler('pollAllSNMP()'), 'pollAllSNMP');
  assert.equal(_handler('openAdopt(x); closeMenu()'), 'openAdopt');
  assert.equal(_handler('  runDriftCheck( ) '), 'runDriftCheck');
  assert.equal(_handler('no call here'), null);
});

test('catalogLines risolve nella lingua UI (IT) con fallback', () => {
  const lines = catalogLines(extractCatalog(SAMPLE), DICT, 'it');
  assert.ok(lines.some(l => /"Scopri" — Scansiona la rete via SNMP/.test(l)), 'IT: label + tip risolti dal dict: ' + lines.join(' | '));
  // verify.tip non è nel dict → fallback al data-tip dell'HTML
  assert.ok(lines.some(l => /"Verifica" — Controllo del mattino/.test(l)));
});

test('catalogLines in EN usa il dizionario inglese', () => {
  const lines = catalogLines(extractCatalog(SAMPLE), DICT, 'en');
  assert.ok(lines.some(l => /"Discover" — Scan the network via SNMP/.test(l)), 'EN risolto: ' + lines.join(' | '));
});

test('salta le etichette senza un nome reale (solo «…»/simboli)', () => {
  const html = '<button onclick="openAccount()" data-tip="Account">…</button>';
  const lines = catalogLines(extractCatalog(html), DICT, 'it');
  assert.deepEqual(lines, [], 'un\'etichetta «…» non è citabile → riga scartata');
});

test('cap max rispettato', () => {
  const lines = catalogLines(extractCatalog(SAMPLE), DICT, 'it', { max: 1 });
  assert.equal(lines.length, 1);
});

test('smoke sul vero netmapper.html: deriva un catalogo reale non vuoto e cita Scopri/Verifica', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'netmapper.html'), 'utf8');
  const i18n = require('../lib/i18n.js');
  const lines = buildCatalogLines(html, i18n._i18nDict, 'it');
  assert.ok(lines.length >= 10, 'almeno una decina di comandi documentati estratti: ' + lines.length);
  const joined = lines.join('\n');
  assert.match(joined, /Scopri/, 'il catalogo reale include il comando Scopri');
  assert.match(joined, /Verifica/, 'il catalogo reale include il comando Verifica');
  // Nessuna riga vuota / senza etichetta.
  assert.ok(lines.every(l => /^"[^"]+"/.test(l)), 'ogni riga inizia con un\'etichetta tra virgolette');
});
