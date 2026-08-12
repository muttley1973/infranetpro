'use strict';
// ============================================================
//  Router STORICO progetto (timeline leggera — Fase 3)
// ============================================================
// Storico FUORI dal <id>.json, dietro l'interfaccia historyStore (SQLite-ready).
// Tutte le route sono admin-only, come il PUT progetto (server/routes/projects.js):
// lo storico è dato sensibile e l'autosave/Verifica che lo alimenta gira da admin.
//
// Fase 3: solo la timeline (una riga per Verifica). Le route snapshot (Fase 4)
// si aggiungeranno qui sulla stessa interfaccia.
const express = require('express');
const path = require('path');
const auth = require('../../auth');
const { timestamp } = require('../../utils');
const { PROJECTS_DIR, loadProject } = require('../projects-store');
const { createFsHistoryStore } = require('../history-store-fs');
const { sanitizePresence } = require('../../lib/presence-store');
const { foldObservations } = require('../../lib/discovery-history');
const { _sanitizeBackupRefs } = require('./projects');   // stessa redazione credenziali del PUT progetto

const router = express.Router();
const store  = createFsHistoryStore({ baseDir: path.join(PROJECTS_DIR, 'history') });

// Motivi ammessi per uno snapshot (whitelist = niente stringhe arbitrarie in meta).
const SNAP_REASONS = new Set(['manual', 'on-demand', 'save', 'pre-restore', 'pre-import', 'pre-adopt', 'pre-delete', 'daily']);
const _reason = (r) => SNAP_REASONS.has(r) ? r : 'manual';
const _label  = (l) => String(l || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);

// Chiavi di conteggio AMMESSE nella riga di timeline: i bucket del Drift Report
// (lib/drift-report.js) + gli endpoint non documentati. Whitelist = anti-bloat e
// anti-injection (il client non può gonfiare la riga con campi arbitrari).
const COUNT_KEYS = [
  'consistent', 'stateDrift', 'macOrphan', 'undocumented', 'undocumentedEndpoint',
  'ghostCable', 'ipChanged', 'unverified', 'identityDrift', 'identityFirmware',
];

function _projectExists(id) { return !!loadProject(id); }
function _user(req) {
  const u = req.session && req.session.user;
  return (u && (u.username || u.name)) || 'sistema';
}
// Solo numeri finiti, solo chiavi whitelisted (niente stringhe/oggetti = niente bloat né payload ostili).
function _sanitizeCounts(c) {
  const out = {};
  if (c && typeof c === 'object') for (const k of COUNT_KEYS) {
    const v = Number(c[k]);
    if (Number.isFinite(v)) out[k] = v;
  }
  return out;
}
function _sanitizeTotals(t) {
  const out = {};
  if (t && typeof t === 'object') for (const k of ['nodes', 'cables']) {
    const v = Number(t[k]);
    if (Number.isFinite(v)) out[k] = v;
  }
  return out;
}

// Append una riga di timeline (una Verifica, auto o manuale).
router.post('/api/projects/:id/history/timeline', auth.requireAdmin, (req, res) => {
  const id = +req.params.id;
  if (!_projectExists(id)) return res.status(404).json({ error: 'Project not found' });
  const b = req.body || {};
  const entry = {
    at:     timestamp(),                                 // server-stamped: ora autorevole
    by:     _user(req),                                  // server-stamped: utente di sessione
    verify: (b.verify === 'auto') ? 'auto' : 'manual',   // origine della Verifica
    counts: _sanitizeCounts(b.counts),                   // divergenze (solo numeri whitelisted)
    totals: _sanitizeTotals(b.totals),                   // dimensione rete (nodi/cavi)
  };
  store.appendTimeline(id, entry);
  res.json({ ok: true, at: entry.at });
});

// ── PRESENZA corrente (chi c'è / chi non c'è) ────────────────────────
// La Verifica la manda qui appena l'ha misurata, senza aspettare un Salva: NON è
// una modifica al documento, è una misura, e il monitoraggio automatico ne produce
// una ogni ora. Prima finiva solo in memoria e moriva al reload — un apparato
// spento tornava verde perché il file su disco raccontava l'ultimo salvataggio.
// Il merge alla riapertura sta in lib/presence-store.js (vince la misura più fresca).
router.put('/api/projects/:id/history/presence', auth.requireAdmin, (req, res) => {
  const id = +req.params.id;
  if (!_projectExists(id)) return res.status(404).json({ error: 'Project not found' });
  const clean = sanitizePresence(req.body);
  const rec = store.savePresence(id, clean);
  res.json({ ok: true, at: rec.at, nodes: Object.keys(clean.nodes).length });
});

// ── OSSERVAZIONI di scoperta ─────────────────────────────────────────
// Stessa storia della presenza: la scansione le manda appena finita, senza
// aspettare un Salva. Prima vivevano solo in memoria fino al salvataggio, e con
// l'autosave OFF di default una scoperta non salvata spariva al reload — proprio
// il dato su cui `lib/temporal-confidence.js` costruisce il «visto N volte».
// ⚠️ Si FONDE con quanto già su disco (vince la storia più larga, il conteggio si
// prende col massimo): un client con una lista parziale non deve poter azzerare
// l'accumulo di mesi.
router.put('/api/projects/:id/history/observations', auth.requireAdmin, (req, res) => {
  const id = +req.params.id;
  if (!_projectExists(id)) return res.status(404).json({ error: 'Project not found' });
  const folded = foldObservations(store.readObservations(id), req.body);
  const rec = store.saveObservations(id, folded);
  res.json({ ok: true, at: rec.at, observations: folded.observations.length });
});

// Lista la timeline (?limit=&from=&to=). Ordine cronologico.
router.get('/api/projects/:id/history/timeline', auth.requireAdmin, (req, res) => {
  const id = +req.params.id;
  if (!_projectExists(id)) return res.status(404).json({ error: 'Project not found' });
  const limit = Math.min(5000, Math.max(0, parseInt(req.query.limit, 10) || 0));
  const entries = store.listTimeline(id, { from: req.query.from, to: req.query.to, limit });
  res.json({ entries });
});

// ── SNAPSHOT completi ripristinabili (Fase 4) ────────────────────────
// Crea uno snapshot INTERO (gzip lato store). Il client invia lo `state` corrente
// (bgImage/auditLog esclusi, come pushHistory) → cattura anche le modifiche non
// salvate. Redazione credenziali come il PUT progetto.
router.post('/api/projects/:id/history/snapshots', auth.requireAdmin, (req, res) => {
  const id = +req.params.id;
  if (!_projectExists(id)) return res.status(404).json({ error: 'Project not found' });
  const b = req.body || {};
  const state = (b.state && typeof b.state === 'object') ? b.state : null;
  if (!state) return res.status(400).json({ error: 'state richiesto' });
  _sanitizeBackupRefs(state);
  const rec = store.putSnapshot(id, { at: timestamp(), by: _user(req), label: _label(b.label), reason: _reason(b.reason) }, state);
  res.status(201).json({ ok: true, snapshot: rec });
});

// Elenco meta degli snapshot (ordine cronologico). Niente stato = leggero.
router.get('/api/projects/:id/history/snapshots', auth.requireAdmin, (req, res) => {
  const id = +req.params.id;
  if (!_projectExists(id)) return res.status(404).json({ error: 'Project not found' });
  res.json({ snapshots: store.listSnapshots(id) });
});

// Uno snapshot COMPLETO (stato decompresso), per il ripristino lato client.
router.get('/api/projects/:id/history/snapshots/:sid', auth.requireAdmin, (req, res) => {
  const id = +req.params.id;
  if (!_projectExists(id)) return res.status(404).json({ error: 'Project not found' });
  const state = store.getSnapshot(id, req.params.sid);
  if (!state) return res.status(404).json({ error: 'Snapshot not found' });
  res.json({ state });
});

module.exports = router;
