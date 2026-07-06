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
  return p ? res.json(p) : res.status(404).json({ error: 'Project not found' });
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
