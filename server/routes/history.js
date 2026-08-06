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

const router = express.Router();
const store  = createFsHistoryStore({ baseDir: path.join(PROJECTS_DIR, 'history') });

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

// Lista la timeline (?limit=&from=&to=). Ordine cronologico.
router.get('/api/projects/:id/history/timeline', auth.requireAdmin, (req, res) => {
  const id = +req.params.id;
  if (!_projectExists(id)) return res.status(404).json({ error: 'Project not found' });
  const limit = Math.min(5000, Math.max(0, parseInt(req.query.limit, 10) || 0));
  const entries = store.listTimeline(id, { from: req.query.from, to: req.query.to, limit });
  res.json({ entries });
});

module.exports = router;
