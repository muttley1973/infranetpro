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
const { loadProject, listProjects, safeProjectId } = require('../projects-store');
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
//
// ⚠️ L'id passa da `safeProjectId` — la STESSA funzione che usano le rotte AI e
// integrations — e non da un `+` scritto qui. **Oggi rispondono uguale**, e va
// detto invece di far credere il contrario: `safeProjectId` usa a sua volta
// `Number()`, quindi `01`, `1.0`, ` 1 `, `1e0`, `0x1` e `+1` continuano a dare il
// progetto 1 (misurato prima e dopo — nessuno dei due è un buco: un numero non può
// contenere un `/`). Quello che cambia è che la definizione di «id di progetto»
// adesso è UNA: se un domani si decide che l'unica grafia buona è `^[1-9]\d*$`, si
// stringe in un posto e stringe per tutti, invece di lasciare la superficie
// esterna indietro — che è esattamente come nascono le regole applicate a metà.
function _load(req, res) {
  const id = safeProjectId(req.params.id);
  const p = id === null ? null : loadProject(id);
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

// ⚠️ Tutto ciò che sta sotto /api/v1 e NON è una rotta si ferma qui, invece di
// scivolare nello stack sotto. Senza, un `POST /api/v1/projects/1` — o un percorso
// inesistente — arrivava fino al gate di SESSIONE e rispondeva **401**: a un
// consumer esterno che ha in mano un token valido quel 401 dice «la tua chiave non
// va bene», mentre la verità è «questo verbo non esiste qui». Uno script rifà il
// login all'infinito invece di correggere il metodo — e intanto la risposta rivela
// che dietro c'è un'autenticazione di un altro tipo. Misurato: POST/PUT/PATCH/
// DELETE davano tutti 401 col token buono.
// Il 405 vale per QUALUNQUE percorso v1, e non è un'approssimazione: l'API è
// read-only per decisione, quindi nessuna rotta accetta una scrittura.
// (Express 4: il carattere jolly è `*`, e `/api/v1` da solo non ci rientra — va
// nominato, o un POST sull'indice scivolerebbe via lo stesso.)
router.all(['/api/v1', '/api/v1/*'], (req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.status(404).json({ error: 'Not found', code: 'no-route' });
  }
  res.set('Allow', 'GET, HEAD');
  res.status(405).json({ error: 'The v1 API is read-only', code: 'read-only' });
});

module.exports = router;
