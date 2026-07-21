'use strict';
// ============================================================
//  Router CRUD progetti (estratto da server.js, logica invariata).
// ============================================================
const express = require('express');
const fs   = require('fs');
const path = require('path');
const auth = require('../../auth');
const { timestamp } = require('../../utils');
const { PROJECTS_DIR, nextId, saveProject, loadProject, listProjects, removeBgAsset } = require('../projects-store');
const { runProjectDeleteHooks } = require('../module-registry');

const router = express.Router();

// SEC-M1 (audit 2026-07-21): il progetto grezzo contiene i segreti SNMP
// (community v1/v2c + passphrase v3) in node.integration. Un lettore NON-admin
// (ruolo viewer) non deve riceverli. loadProject ritorna un parse FRESCO → si può
// azzerare in-place sulla risposta senza toccare il disco né altre richieste. Il
// viewer non salva (PUT/copy sono admin-only) → nessuna perdita nel round-trip.
const SNMP_SECRET_KEYS = ['community', 'v3authPass', 'v3privPass'];
function _redactSnmpSecrets(project) {
  const nodes = project && project.state && project.state.nodes;
  if (!Array.isArray(nodes)) return project;
  for (const n of nodes) {
    const ig = n && n.integration;
    if (ig && typeof ig === 'object') {
      for (const k of SNMP_SECRET_KEYS) if (ig[k]) ig[k] = '';
    }
  }
  return project;
}

// Lista (solo metadati, senza state)
router.get('/api/projects', (_, res) => {
  res.json(listProjects());
});

// Crea - solo admin
router.post('/api/projects', auth.requireAdmin, (req, res) => {
  const name  = (req.body?.name || 'New Project').toString().trim() || 'New Project';
  const state = req.body?.state ?? {};
  const id    = nextId();
  const now   = timestamp();
  saveProject(id, name, state, now, now);
  res.status(201).json(loadProject(id));
});

// Leggi
router.get('/api/projects/:id', (req, res) => {
  const p = loadProject(+req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  if (req.session?.user?.role !== 'admin') _redactSnmpSecrets(p);   // SEC-M1
  return res.json(p);
});

// Aggiorna - solo admin
router.put('/api/projects/:id', auth.requireAdmin, (req, res) => {
  const id = +req.params.id;
  const p  = loadProject(id);
  if (!p) return res.status(404).json({ error: 'Project not found' });

  const name  = req.body?.name  ? (req.body.name.toString().trim() || p.name) : p.name;
  const state = req.body?.state !== undefined ? req.body.state : p.state;
  const now   = timestamp();
  saveProject(id, name, state, p.created_at, now);
  // Solo metadati: NON ricarichiamo il progetto (eviterebbe di ri-encodare l'asset
  // bgImage in base64 ad ogni Salva). Save leggero = obiettivo dell'estrazione asset.
  res.json({ id, name, updated_at: now });
});

// Elimina - solo admin
router.delete('/api/projects/:id', auth.requireAdmin, (req, res) => {
  const id   = +req.params.id;
  const file = path.join(PROJECTS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Project not found' });
  fs.unlinkSync(file);
  try { fs.unlinkSync(file + '.bak'); } catch (_) { /* best-effort */ }
  removeBgAsset(id);                               // rimuovi l'asset bgImage (niente orfani)
  runProjectDeleteHooks(id);                       // hook moduli: ogni modulo pulisce i propri sidecar
  res.json({ ok: true, deleted_id: id });
});

// Copia - solo admin
router.post('/api/projects/:id/copy', auth.requireAdmin, (req, res) => {
  const id  = +req.params.id;
  const src = loadProject(id);
  if (!src) return res.status(404).json({ error: 'Project not found' });

  const name  = (req.body?.name || `${src.name} (Copia)`).toString().trim();
  const newId = nextId();
  const now   = timestamp();
  saveProject(newId, name, src.state, now, now);
  res.status(201).json(loadProject(newId));
});

module.exports = router;
// Esposto per i test (SEC-M1): redazione dei segreti SNMP per lettori non-admin.
module.exports._redactSnmpSecrets = _redactSnmpSecrets;
