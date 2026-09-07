// Fix frontend dallo smoke test 06/09 (STATO_PIANO gruppo G). I moduli src/ sono
// ESM per il browser (bundle esbuild) e non si caricano in node: si verifica il
// SORGENTE, come history-undo-dirty.test.js / bridge-ratchet. Ogni asserzione
// riproduce il difetto che il fix chiude.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');

// ── VLAN 0/4095: rifiutare all'ingresso, non clampare ───────────────────────
test('isValidVlanId: intervallo 802.1Q utilizzabile (1..4094), interi', () => {
  const src = read('app-util.js');
  assert.match(src, /export function isValidVlanId/, 'esiste ed è esportata');
  const m = /export function isValidVlanId[\s\S]*?\n\}/.exec(src);
  assert.ok(m, 'corpo trovato');
  assert.match(m[0], /Number\.isInteger/, 'solo interi');
  assert.match(m[0], />=\s*1\s*&&/, 'estremo inferiore 1 (0 riservato)');
  assert.match(m[0], /<=\s*4094/, 'estremo superiore 4094 (4095 riservato)');
});

test('addVlanColor rifiuta la VLAN fuori range invece di clamparla', () => {
  const src = read('app-vlan-autopoll.js');
  assert.match(src, /isValidVlanId\(raw\)/, 'la validità decide, e rifiuta');
  assert.doesNotMatch(src, /normalizeNumber\(document\.getElementById\('new-vlan-id'\)/,
    'niente più clamp silenzioso del vecchio normalizeNumber sull\'id VLAN');
});

// ── Cancellare un rack passa per la via unica _removeNodeById ────────────────
test('deleteCurrentRack delega a _removeNodeById (topoCache/discovery/haPeer inclusi)', () => {
  const src = read('app-search-zoom-rack.js');
  assert.match(src, /ids\.forEach\(id => _removeNodeById\(id\)\)/, 'delega la rimozione, una via sola');
  assert.doesNotMatch(src, /store\.state\.links=store\.state\.links\.filter\(l=>!ids\.has\(getPortNodeId/,
    'niente più rimozione inline che saltava le pulizie');
});

test('_removeNodeById azzera il partner HA sopravvissuto', () => {
  const src = read('app.js');
  const m = /export function _removeNodeById[\s\S]*?\n\}/.exec(src);
  assert.ok(m, 'corpo di _removeNodeById trovato');
  assert.match(m[0], /String\(other\.spec\.haPeer\) === String\(rid\)/, 'trova il partner che punta al nodo rimosso');
  assert.match(m[0], /delete other\.spec\.haPeer/, 'e ne rompe il riferimento');
});

// ── Import da discovery: registrato nel giornale del documento ──────────────
test('importDiscovered scrive nel giornale (logAudit), non solo pushHistory', () => {
  const src = read('app-discovery.js');
  assert.match(src, /logAudit\('discovery-import'/, 'evento strutturale nel giornale');
});

// ── beforeunload: avviso se ci sono modifiche non salvate ───────────────────
test('la chiusura scheda avvisa quando isDirty()', () => {
  const src = read('app.js');
  assert.match(src, /addEventListener\('beforeunload'/, 'registra la guardia');
  assert.match(src, /if \(isDirty\(\)\) \{ e\.preventDefault\(\); e\.returnValue = ''; \}/, 'gated sul dirty, non sempre');
});
