'use strict';
// ============================================================
//  server/routes/api-v1.js — REST API pubblica versionata (v1), READ-ONLY.
//
//  Destinata ai consumer esterni (Ansible, dashboard, wiki, automazioni). Gate a
//  TOKEN Bearer (server/middleware/api-auth.js); montata in server.js PRIMA del
//  requireAuth di sessione. Restituisce SOLO dati sanitizzati (lib/api-shape.js):
//  mai lo state grezzo, mai le community SNMP. Read-only di proposito (manual-first:
//  l'editing avviene dalla UI; l'API è per chi CONSUMA la fonte di verità).
// ============================================================
const express = require('express');
const { apiAuth } = require('../middleware/api-auth');
const { loadProject, listProjects } = require('../projects-store');
const shape = require('../../lib/api-shape');
const { buildOpenApi } = require('../openapi');

const router = express.Router();

// openapi.json — PUBBLICO (nessun token): è solo la descrizione dell'API, non
// contiene dati. Registrato prima del gate così non richiede autenticazione.
router.get('/api/v1/openapi.json', (_req, res) => res.json(buildOpenApi()));

// Tutto il resto di /api/v1 richiede un token Bearer valido.
router.use('/api/v1', apiAuth);

// Indice/discovery dell'API.
router.get('/api/v1', (_req, res) => res.json({
  name: 'InfraNet Pro API',
  version: 'v1',
  endpoints: [
    '/api/v1/projects',
    '/api/v1/projects/{id}',
    '/api/v1/projects/{id}/devices',
    '/api/v1/projects/{id}/ansible-inventory',
    '/api/v1/openapi.json',
  ],
}));

router.get('/api/v1/projects', (_req, res) => res.json({ projects: listProjects() }));

// Carica un progetto o risponde 404; ritorna null al chiamante in caso d'errore.
function _load(req, res) {
  const p = loadProject(+req.params.id);
  if (!p) { res.status(404).json({ error: 'Project not found' }); return null; }
  return p;
}

router.get('/api/v1/projects/:id', (req, res) => {
  const p = _load(req, res); if (p) res.json(shape.projectToInventory(p));
});

router.get('/api/v1/projects/:id/devices', (req, res) => {
  const p = _load(req, res); if (p) res.json({ devices: shape.projectToDevices(p) });
});

router.get('/api/v1/projects/:id/ansible-inventory', (req, res) => {
  const p = _load(req, res); if (p) res.json(shape.toAnsibleInventory(p));
});

module.exports = router;
