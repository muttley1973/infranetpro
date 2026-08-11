'use strict';
// Presenza persistita fuori dal JSON di progetto (lib/presence-store.js).
// L'invariante che conta: la misura più FRESCA vince, e «assente» non sopravvive
// senza la prova che lo sostiene.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeProof, sanitizePresence, mergePresence, collectPresence } = require('../lib/presence-store');

const ABSENT = { status: 'absent', lastCheckedAt: '2026-08-11T16:52:00.000Z', lastProvenAt: '2026-08-11T08:47:44.000Z', method: 'ping', absentEvidence: true };
const PROVEN = { status: 'proven', lastCheckedAt: '2026-08-11T08:47:44.000Z', lastProvenAt: '2026-08-11T08:47:44.000Z', method: 'ping' };

test('⚠️ «assente» senza prova non si conserva', () => {
  assert.equal(sanitizeProof({ status: 'absent', lastCheckedAt: ABSENT.lastCheckedAt }), null, 'niente absentEvidence → si butta');
  assert.equal(sanitizeProof(Object.assign({}, ABSENT)).absentEvidence, true);
  // Il flag non si eredita da uno stato diverso.
  assert.equal('absentEvidence' in sanitizeProof(Object.assign({}, PROVEN, { absentEvidence: false })), false);
});

test('sanitizeProof: stati e metodi solo dalla whitelist, date solo se leggibili', () => {
  assert.equal(sanitizeProof({ status: 'inventato' }), null);
  assert.equal(sanitizeProof(null), null);
  assert.equal(sanitizeProof({ status: 'proven', method: 'telepatia' }).method, undefined);
  assert.equal(sanitizeProof({ status: 'proven', lastCheckedAt: 'ieri' }).lastCheckedAt, undefined);
  assert.equal(sanitizeProof({ status: 'unverified' }).status, 'unverified');
});

test('sanitizePresence accetta sia { nodes } sia la mappa nuda, e scarta il resto', () => {
  const a = sanitizePresence({ nodes: { pc7: ABSENT, x: { status: 'boh' } } });
  const b = sanitizePresence({ pc7: ABSENT, x: { status: 'boh' } });
  assert.deepEqual(Object.keys(a.nodes), ['pc7']);
  assert.deepEqual(a, b);
  assert.deepEqual(sanitizePresence(null).nodes, {});
  assert.deepEqual(sanitizePresence({ '': ABSENT }).nodes, {}, 'id vuoto scartato');
});

test('⚠️ vince la misura più fresca: il sidecar non riporta indietro il documento', () => {
  // Il caso vero: il documento salvato dice «visto vivo alle 08:47», la Verifica
  // delle 16:52 ha provato l'assenza → dopo il reload deve restare ROSSO.
  const state = { nodes: [{ id: 'pc7', proof: Object.assign({}, PROVEN) }] };
  const r = mergePresence(state, { nodes: { pc7: ABSENT } });
  assert.equal(state.nodes[0].proof.status, 'absent');
  assert.deepEqual(r, { applied: 1, skipped: 0 });

  // Direzione opposta: il documento è PIÙ recente del sidecar → non si tocca.
  const newer = { nodes: [{ id: 'pc7', proof: { status: 'proven', lastCheckedAt: '2026-08-11T18:00:00.000Z' } }] };
  const r2 = mergePresence(newer, { nodes: { pc7: ABSENT } });
  assert.equal(newer.nodes[0].proof.status, 'proven', 'una misura vecchia non cancella una nuova');
  assert.deepEqual(r2, { applied: 0, skipped: 1 });
});

test('merge: nodo senza proof lo riceve; nodo non citato resta intatto', () => {
  const state = { nodes: [{ id: 'a' }, { id: 'b', proof: Object.assign({}, PROVEN) }] };
  mergePresence(state, { nodes: { a: ABSENT } });
  assert.equal(state.nodes[0].proof.status, 'absent');
  assert.equal(state.nodes[1].proof.status, 'proven', 'chi non è nel sidecar non si tocca');
});

test('merge difensivo: stato vuoto, sidecar vuoto, nodi senza id', () => {
  assert.deepEqual(mergePresence(null, null), { applied: 0, skipped: 0 });
  assert.deepEqual(mergePresence({ nodes: [] }, { nodes: { a: ABSENT } }), { applied: 0, skipped: 0 });
  assert.deepEqual(mergePresence({ nodes: [null, {}] }, { nodes: { a: ABSENT } }), { applied: 0, skipped: 0 });
});

test('collectPresence prende solo i nodi con una presenza vera', () => {
  const state = { nodes: [
    { id: 'pc7', proof: ABSENT },
    { id: 'srv1', proof: PROVEN },
    { id: 'r1', proof: { status: 'declared' } },
    { id: 'pdu1' },                                        // nessun proof
    { id: 'bad', proof: { status: 'absent' } },            // assenza senza prova
  ] };
  const out = collectPresence(state);
  assert.deepEqual(Object.keys(out.nodes).sort(), ['pc7', 'r1', 'srv1']);
  assert.equal(out.nodes.pc7.absentEvidence, true);
});

test('il giro completo non perde e non inventa niente', () => {
  const measured = { nodes: [{ id: 'pc7', proof: ABSENT }, { id: 'srv1', proof: PROVEN }] };
  const onDisk = sanitizePresence(collectPresence(measured));       // salvataggio
  const reloaded = { nodes: [{ id: 'pc7', proof: PROVEN }, { id: 'srv1', proof: PROVEN }] };
  mergePresence(reloaded, onDisk);                                   // riapertura
  assert.equal(reloaded.nodes[0].proof.status, 'absent', 'lo spento resta spento dopo il reload');
  assert.equal(reloaded.nodes[1].proof.status, 'proven');
});

// ── Aggancio: route + wizard ─────────────────────────────────────────────────
// La catena che rende la misura persistente ha tre anelli e basta romperne uno per
// riavere il bug: la Verifica manda, la route salva, la GET del progetto rifonde.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const R_HISTORY = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'history.js'), 'utf8');
const R_PROJECTS = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'projects.js'), 'utf8');
const DRIFT = fs.readFileSync(path.join(ROOT, 'src', 'app-drift.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'netmapper.html'), 'utf8');

test('la Verifica manda la presenza appena misurata, senza aspettare un Salva', () => {
  assert.match(DRIFT, /_persistPresence\(\);/, 'chiamata dentro il flusso della Verifica');
  assert.match(DRIFT, /history\/presence`, \{\s*\n?\s*method:'PUT'/, 'PUT al sidecar');
  // Ordine: prima si scrive n.proof, poi si spedisce — altrimenti si manda il vecchio.
  assert.ok(DRIFT.indexOf('_driftWriteProofState(sweep') < DRIFT.indexOf('_persistPresence();'),
    'la misura si spedisce DOPO averla calcolata');
  assert.match(HTML, /lib\/presence-store\.js/, 'la lib deve essere caricata nella pagina');
});

test('la route salva solo ciò che è stato sanificato, e solo per un progetto che esiste', () => {
  assert.match(R_HISTORY, /router\.put\('\/api\/projects\/:id\/history\/presence', auth\.requireAdmin/);
  assert.match(R_HISTORY, /const clean = sanitizePresence\(req\.body\)/, 'mai il body grezzo sul disco');
  assert.match(R_HISTORY, /store\.savePresence\(id, clean\)/);
  assert.match(R_HISTORY, /if \(!_projectExists\(id\)\) return res\.status\(404\)/);
});

test('riaprire il progetto rifonde la presenza, e un errore non blocca l\'apertura', () => {
  assert.match(R_PROJECTS, /mergePresence\(p\.state, _history\.readPresence\(id\)\)/);
  assert.match(R_PROJECTS, /try \{ mergePresence[^}]*\} catch \(_\) \{/, 'best-effort: il progetto si apre comunque');
});
