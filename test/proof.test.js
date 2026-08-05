'use strict';
// ============================================================
// PROOF-STATE — test dello stato di prova unificato (lib/proof.js).
// Verifica le INVARIANTI D'ONESTA' (spec §9):
//   * irraggiungibile NON produce delete (la lib non cancella nulla — non muta input);
//   * un DEDOTTO non conta come 'proven' nel Truth Score;
//   * 'absent' solo con evidenza; remoto muto -> 'unverified';
//   * effConf DECADE con l'eta' dell'estremo (LLDP fresco ~0.97 -> muto 20g < 0.50 = ghost);
//   * Truth Score = breakdown, non collassa 'declared' in 'proven';
//   * ⚠️ IL DICHIARATO E' LEGGE: un cavo MANUALE verso un estremo muto/assente resta
//     'declared' (mai 'ghost') e nel bucket 'declared'; diventa 'declared-review'/'diverged'
//     SOLO con estremo 'diverged'. Lo STESSO cavo se autoLinked -> 'ghost'.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const P = require('../lib/proof.js');
const {
  freshness, nodeFreshness, baseConf, endpointFreshness, effConf,
  cableTier, cableProof, deriveNodeProof, truthBucket, truthScore, TRUTH_BUCKETS,
  FRESH_H, STALE_D, EXPIRE_D, GHOST_CONF, DEFAULT_DERIVED_CONF,
} = P;

const HOUR = 3600e3;
const DAY = 864e5;
const NOW = Date.UTC(2026, 7, 4); // orologio fisso
const iso = ms => new Date(ms).toISOString();
const ago = (ms) => iso(NOW - ms); // ISO di "ms fa"
const proven = (ms) => ({ status: 'proven', lastProvenAt: ago(ms) });
const close = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-9 : eps);

// ---- costanti -------------------------------------------------------------
test('costanti di default esportate', () => {
  assert.equal(FRESH_H, 6);
  assert.equal(STALE_D, 7);
  assert.equal(EXPIRE_D, 30);
  assert.equal(GHOST_CONF, 0.50);
  assert.equal(DEFAULT_DERIVED_CONF, 0.80);
  assert.deepEqual(TRUTH_BUCKETS, ['proven', 'declared', 'toVerify', 'stale', 'diverged', 'absent']);
});

// ---- freshness (rampa a tratti §4.1) --------------------------------------
test('freshness: <=6h fresco = 1.0', () => {
  assert.equal(freshness(0), 1.0);
  assert.equal(freshness(6 * HOUR), 1.0);
  assert.equal(freshness(HOUR), 1.0);
});

test('freshness: 6h..7g scende 1.0 -> 0.6', () => {
  assert.ok(close(freshness(7 * DAY), 0.6));
  const mid = freshness(6 * HOUR + (7 * DAY - 6 * HOUR) / 2);
  assert.ok(mid < 1.0 && mid > 0.6);
  assert.ok(close(mid, 0.8, 1e-6));
});

test('freshness: 7g..30g scende 0.6 -> 0.0', () => {
  assert.ok(close(freshness(30 * DAY), 0.0, 1e-9));
  const mid = freshness(7 * DAY + (30 * DAY - 7 * DAY) / 2);
  assert.ok(mid < 0.6 && mid > 0.0);
  assert.ok(close(mid, 0.3, 1e-6));
});

test('freshness: oltre 30g = 0; eta ignota = 0; futuro = 1.0', () => {
  assert.equal(freshness(31 * DAY), 0);
  assert.equal(freshness(365 * DAY), 0);
  assert.equal(freshness(null), 0);          // eta' ignota -> nessuna prova
  assert.equal(freshness(NaN), 0);
  assert.equal(freshness(undefined), 0);
  assert.equal(freshness(-HOUR), 1.0);       // clock skew -> "adesso"
});

test('nodeFreshness: legge proof.lastProvenAt', () => {
  assert.equal(nodeFreshness(proven(HOUR), NOW), 1.0);
  assert.ok(close(nodeFreshness(proven(7 * DAY), NOW), 0.6));
  assert.equal(nodeFreshness({ status: 'proven', lastProvenAt: null }, NOW), 0);
  assert.equal(nodeFreshness(null, NOW), 0);
});

// ---- baseConf / effConf (decadimento §4.2) --------------------------------
test('baseConf: manuale = 1.0, dedotto = confidence, default 0.80', () => {
  assert.equal(baseConf({ autoLinked: false }), 1.0);
  assert.equal(baseConf({}), 1.0);                                  // niente autoLinked = manuale
  assert.equal(baseConf({ autoLinked: true, confidence: 0.97 }), 0.97);
  assert.equal(baseConf({ autoLinked: true }), 0.80);               // dedotto senza valore
  assert.equal(baseConf(null), 0);
});

test('endpointFreshness: prende il PEGGIORE dei due estremi', () => {
  assert.ok(close(endpointFreshness(proven(HOUR), proven(7 * DAY), NOW), 0.6));
  assert.equal(endpointFreshness(proven(HOUR), proven(HOUR), NOW), 1.0);
  assert.equal(endpointFreshness(proven(HOUR), null, NOW), 0);       // un capo mai provato
});

test('effConf: LLDP 0.97 fresco resta ~0.97, muto 20g crolla < 0.50', () => {
  const lldp = { autoLinked: true, confidence: 0.97, protocol: 'LLDP' };
  const fresh = effConf(lldp, proven(DAY), proven(DAY), NOW);       // estremo raggiunto ieri
  assert.ok(fresh > 0.90, `atteso ~0.97, ottenuto ${fresh}`);
  const mute = effConf(lldp, proven(20 * DAY), proven(DAY), NOW);   // un capo muto da 20g
  assert.ok(mute < GHOST_CONF, `atteso < 0.50, ottenuto ${mute}`);
});

// ---- cableTier (method-aware, vendor-neutral §4.3) ------------------------
test('cableTier: LLDP/CDP >=0.90 = strong; FDB/MAC/ARP = weak', () => {
  assert.equal(cableTier({ protocol: 'LLDP', confidence: 0.97 }), 'derived-strong');
  assert.equal(cableTier({ protocol: 'CDP', confidence: 0.90 }), 'derived-strong');
  assert.equal(cableTier({ protocol: 'LLDP+MAC', confidence: 0.92 }), 'derived-strong');
  assert.equal(cableTier({ protocol: 'LLDP', confidence: 0.85 }), 'derived-weak'); // conf bassa
  assert.equal(cableTier({ protocol: 'MAC', confidence: 0.72 }), 'derived-weak');
  assert.equal(cableTier({ protocol: 'MAC+ARP', confidence: 0.80 }), 'derived-weak');
  assert.equal(cableTier({ protocol: 'FDB', confidence: 0.72 }), 'derived-weak');
});

// ---- cableProof — IL DICHIARATO E' LEGGE (§4.3, invariante centrale) -------
test('cavo MANUALE verso estremo unverified/absent/stale -> resta declared (mai ghost)', () => {
  const manual = { autoLinked: false };
  assert.equal(cableProof(manual, { status: 'unverified' }, proven(HOUR), NOW), 'declared');
  assert.equal(cableProof(manual, { status: 'absent', absentEvidence: true }, proven(HOUR), NOW), 'declared');
  assert.equal(cableProof(manual, { status: 'stale' }, proven(HOUR), NOW), 'declared');
  assert.equal(cableProof(manual, null, null, NOW), 'declared');   // estremi mai verificati
});

test('cavo MANUALE diventa declared-review SOLO con estremo diverged', () => {
  const manual = { autoLinked: false };
  assert.equal(cableProof(manual, { status: 'diverged' }, proven(HOUR), NOW), 'declared-review');
  assert.equal(cableProof(manual, proven(HOUR), { status: 'diverged' }, NOW), 'declared-review');
});

test('CONTRAPPUNTO: lo STESSO estremo muto, ma cavo DEDOTTO -> ghost', () => {
  const derived = { autoLinked: true, confidence: 0.97, protocol: 'LLDP' };
  assert.equal(cableProof(derived, { status: 'unverified' }, proven(HOUR), NOW), 'ghost');
  assert.equal(cableProof(derived, { status: 'absent' }, proven(HOUR), NOW), 'ghost');
});

test('cavo DEDOTTO fresco -> tier (non ghost)', () => {
  const strong = { autoLinked: true, confidence: 0.97, protocol: 'LLDP' };
  assert.equal(cableProof(strong, proven(DAY), proven(DAY), NOW), 'derived-strong');
  const weak = { autoLinked: true, confidence: 0.72, protocol: 'MAC' };
  assert.equal(cableProof(weak, proven(HOUR), proven(HOUR), NOW), 'derived-weak');
});

test('cavo DEDOTTO con confidence decaduta (estremo muto 20g) -> ghost', () => {
  const strong = { autoLinked: true, confidence: 0.97, protocol: 'LLDP' };
  assert.equal(cableProof(strong, proven(20 * DAY), proven(DAY), NOW), 'ghost');
});

test('cavo DEDOTTO verso estremi mai provati -> ghost (effConf 0)', () => {
  const derived = { autoLinked: true, confidence: 0.97, protocol: 'LLDP' };
  assert.equal(cableProof(derived, null, null, NOW), 'ghost');
});

test('MISCABLAGGIO: cavo MANUALE con l.miscabled -> declared-review anche con estremi provati', () => {
  // La porta annuncia un vicino diverso: contraddice QUESTO cavo, non l'estremo.
  const manual = { autoLinked: false, miscabled: { end: 'a-1', observed: 'z', declared: 'b' } };
  assert.equal(cableProof(manual, proven(HOUR), proven(HOUR), NOW), 'declared-review');
  // Senza miscabled, gli stessi estremi provati -> declared.
  assert.equal(cableProof({ autoLinked: false }, proven(HOUR), proven(HOUR), NOW), 'declared');
});

test('MISCABLAGGIO: cavo DEDOTTO con l.miscabled -> ghost anche se fresco', () => {
  const derived = { autoLinked: true, confidence: 0.97, protocol: 'LLDP', miscabled: { end: 'a-1', observed: 'z', declared: 'b' } };
  assert.equal(cableProof(derived, proven(DAY), proven(DAY), NOW), 'ghost');
});

test('PORTA DOWN: cavo DEDOTTO con l.portDown -> ghost anche se il device risponde (multi-homed)', () => {
  // Riconciliazione ghostCable: la porta d'accesso è down da >=N sync; il device è vivo
  // per altra via (estremi provati) ma QUESTO cavo non ha evidenza.
  const derived = { autoLinked: true, confidence: 0.97, protocol: 'LLDP', portDown: true };
  assert.equal(cableProof(derived, proven(HOUR), proven(HOUR), NOW), 'ghost');
});

test('PORTA DOWN: un cavo MANUALE con portDown resta declared (il dichiarato è legge)', () => {
  // portDown alimenta solo i DEDOTTI (ghostCable è dedotti-only); un manuale non lo prende
  // mai, ma anche se lo avesse: cablaggio != liveness -> resta Dichiarato.
  assert.equal(cableProof({ autoLinked: false, portDown: true }, { status: 'unverified' }, proven(HOUR), NOW), 'declared');
});

// ---- deriveNodeProof (§7.2: absent solo con prova; muto -> unverified) -----
test('deriveNodeProof: SNMP ok -> proven, lastProvenAt = now, method snmp', () => {
  const p = deriveNodeProof({ snmpOk: true }, NOW);
  assert.equal(p.status, 'proven');
  assert.equal(p.lastProvenAt, iso(NOW));
  assert.equal(p.lastCheckedAt, iso(NOW));
  assert.equal(p.method, 'snmp');
  assert.equal(p.absentEvidence, false);
});

test('deriveNodeProof: reachable alive -> proven', () => {
  const p = deriveNodeProof({ reachable: true, method: 'ping' }, NOW);
  assert.equal(p.status, 'proven');
  assert.equal(p.lastProvenAt, iso(NOW));
  assert.equal(p.method, 'ping');
});

test('deriveNodeProof: remoto MUTO (tentato, nessuna evidenza) -> unverified, MAI absent', () => {
  const p = deriveNodeProof({ attempted: true, reachable: false }, NOW);
  assert.equal(p.status, 'unverified');
  assert.equal(p.absentEvidence, false);
  assert.equal(p.lastCheckedAt, iso(NOW));
});

test('deriveNodeProof: ASSENTE solo con evidenza dura (ARP-miss locale)', () => {
  const p = deriveNodeProof({ attempted: true, absentEvidence: true }, NOW);
  assert.equal(p.status, 'absent');
  assert.equal(p.absentEvidence, true);
});

test('deriveNodeProof: diverged vince su tutto; conserva lastProvenAt precedente', () => {
  const prev = { status: 'proven', lastProvenAt: ago(DAY), lastCheckedAt: ago(DAY) };
  const p = deriveNodeProof({ diverged: true, snmpOk: true, prev }, NOW);
  assert.equal(p.status, 'diverged');
  assert.equal(p.lastProvenAt, ago(DAY)); // non "prova" l'identita' giusta: la contraddice
  assert.equal(p.lastCheckedAt, iso(NOW));
});

test('deriveNodeProof: non tentato + prova vecchia (>30g) -> stale; fresca -> resta', () => {
  const stale = deriveNodeProof({ prev: { status: 'proven', lastProvenAt: ago(40 * DAY) } }, NOW);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.lastProvenAt, ago(40 * DAY)); // conserva quando fu l'ultima prova
  const fresh = deriveNodeProof({ prev: { status: 'proven', lastProvenAt: ago(DAY) } }, NOW);
  assert.equal(fresh.status, 'proven');
});

test('deriveNodeProof: nessun segnale e nessun prev -> declared (non inventa)', () => {
  const p = deriveNodeProof({}, NOW);
  assert.equal(p.status, 'declared');
  assert.equal(p.lastProvenAt, null);
});

test('deriveNodeProof: NON muta prev (irraggiungibile != cancellato)', () => {
  const prev = Object.freeze({ status: 'proven', lastProvenAt: ago(DAY), lastCheckedAt: ago(DAY) });
  const p = deriveNodeProof({ attempted: true, reachable: false, prev }, NOW);
  assert.notEqual(p, prev);                 // oggetto nuovo
  assert.equal(prev.status, 'proven');      // originale intatto
  assert.equal(p.lastProvenAt, ago(DAY));   // eredita la prova precedente
});

// ---- truthBucket ----------------------------------------------------------
test('truthBucket: mappa canonica onesta', () => {
  assert.equal(truthBucket('proven'), 'proven');
  assert.equal(truthBucket('declared'), 'declared');
  assert.equal(truthBucket('derived-strong'), 'toVerify');
  assert.equal(truthBucket('derived-weak'), 'toVerify');
  assert.equal(truthBucket('ghost'), 'toVerify');
  assert.equal(truthBucket('unverified'), 'toVerify');
  assert.equal(truthBucket('declared-review'), 'diverged');
  assert.equal(truthBucket('diverged'), 'diverged');
  assert.equal(truthBucket('stale'), 'stale');
  assert.equal(truthBucket('absent'), 'absent');
  assert.equal(truthBucket('qualcosa-di-ignoto'), 'declared'); // conservativo
  assert.equal(truthBucket(undefined), 'declared');
});

// ---- truthScore (§4.4: breakdown, non collassa) ---------------------------
test('truthScore: un DEDOTTO non conta come proven', () => {
  const s = truthScore([{ status: 'derived-strong', effConf: 0.9 }], NOW);
  assert.equal(s.proven, 0);
  assert.ok(s.toVerify > 0);
});

test('truthScore: NON collassa declared in proven', () => {
  const s = truthScore([
    { status: 'proven' }, { status: 'proven' }, { status: 'proven' },
    { status: 'declared' },
  ], NOW);
  assert.equal(s.proven, 3);
  assert.equal(s.declared, 1);
  assert.equal(s.total, 4);
  assert.equal(s.provenPct, 75);
  assert.equal(s.pct.declared, 25);
});

test('truthScore: dedotto pesa w x effConf in toVerify, residuo in stale (somma = w)', () => {
  const s = truthScore([{ status: 'derived-weak', effConf: 0.3 }], NOW);
  assert.ok(close(s.toVerify, 0.3));
  assert.ok(close(s.stale, 0.7));
  assert.equal(s.total, 1);
});

test('truthScore: ghost (effConf ~0) pesa quasi tutto in stale', () => {
  const s = truthScore([{ status: 'ghost', effConf: 0.05 }], NOW);
  assert.ok(s.toVerify < 0.1);
  assert.ok(s.stale > 0.9);
});

test('truthScore: declared-review conta come diverged', () => {
  const s = truthScore([{ status: 'declared-review' }], NOW);
  assert.equal(s.diverged, 1);
  assert.equal(s.declared, 0);
});

test('truthScore: rispetta i pesi w; i bucket sommano a TOTAL', () => {
  const els = [
    { status: 'proven', w: 3 },
    { status: 'declared', w: 2 },
    { status: 'derived-strong', effConf: 1.0, w: 1 },
    { status: 'diverged', w: 1 },
    { status: 'absent', w: 1 },
  ];
  const s = truthScore(els, NOW);
  assert.equal(s.total, 8);
  const sum = s.proven + s.declared + s.toVerify + s.stale + s.diverged + s.absent;
  assert.ok(close(sum, s.total), `bucket ${sum} != total ${s.total}`);
});

test('truthScore: le percentuali sommano ESATTAMENTE a 100 (largest-remainder)', () => {
  const els = [
    { status: 'proven' }, { status: 'proven' }, { status: 'declared' },
    { status: 'derived-weak', effConf: 0.5 }, { status: 'diverged' },
    { status: 'absent' }, { status: 'stale' },
  ];
  const s = truthScore(els, NOW);
  const sumPct = TRUTH_BUCKETS.reduce((a, k) => a + s.pct[k], 0);
  assert.equal(sumPct, 100);
});

test('truthScore: vuoto -> total 0, tutte le pct 0 (nessuna divisione per zero)', () => {
  const s = truthScore([], NOW);
  assert.equal(s.total, 0);
  assert.equal(s.provenPct, 0);
  TRUTH_BUCKETS.forEach(k => assert.equal(s.pct[k], 0));
});

test('truthScore: ignora elementi nulli e peso <=0', () => {
  const s = truthScore([null, { status: 'proven', w: 0 }, { status: 'proven', w: -5 }, { status: 'proven' }], NOW);
  assert.equal(s.total, 1);
  assert.equal(s.proven, 1);
});

// ---- invariante: nessun delete (la lib e' pura) ---------------------------
test('la lib non cancella: irraggiungibile non rimuove il record (input intatto)', () => {
  const link = Object.freeze({ autoLinked: true, confidence: 0.9, protocol: 'LLDP', id: 'l1' });
  const st = cableProof(link, { status: 'absent' }, { status: 'proven', lastProvenAt: ago(DAY) }, NOW);
  assert.equal(st, 'ghost');       // marcato fantasma...
  assert.equal(link.id, 'l1');     // ...ma il cavo esiste ancora, immutato
  assert.equal(link.autoLinked, true);
});
