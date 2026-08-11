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
const { removeProjectHistory } = require('../history-store-fs');
const { runProjectDeleteHooks } = require('../module-registry');
const { stripRefCreds } = require('../../lib/backup-ref.js');

const router = express.Router();
const HISTORY_DIR = path.join(PROJECTS_DIR, 'history');

// SEC-M1 (audit 2026-07-21): il progetto grezzo contiene i segreti SNMP
// (community v1/v2c + passphrase v3) in node.integration. Un lettore NON-admin
// (ruolo viewer) non deve riceverli. loadProject ritorna un parse FRESCO → si può
// azzerare in-place sulla risposta senza toccare il disco né altre richieste. Il
// viewer non salva (PUT/copy sono admin-only) → nessuna perdita nel round-trip.
const SNMP_SECRET_KEYS = ['community', 'v3authPass', 'v3privPass'];
function _redactBag(bag) {
  if (bag && typeof bag === 'object') {
    for (const k of SNMP_SECRET_KEYS) if (bag[k]) bag[k] = '';
  }
}
function _redactSnmpSecrets(project) {
  const nodes = project && project.state && project.state.nodes;
  if (!Array.isArray(nodes)) return project;
  for (const n of nodes) {
    if (!n) continue;
    _redactBag(n.integration);
    // Le VM usano lo stesso contenitore dei device (`vm.integration`, più il
    // legacy `vm.snmp` dei progetti vecchi): stessi segreti, stessa redazione.
    if (Array.isArray(n.vms)) {
      for (const vm of n.vms) {
        if (!vm) continue;
        _redactBag(vm.integration);
        _redactBag(vm.snmp);
      }
    }
  }
  return project;
}

// 🔒 Il puntatore al backup (`node.backup.ref`) non deve MAI arrivare al disco con
// dentro una credenziale: da lì finisce nel DTO REST, nell'inventory Ansible e nel
// dossier PDF. Finora la barriera viveva solo nel client (lib/backup-ref.js sul
// campo che l'utente digita) — ma un PUT costruito a mano, o un progetto importato
// da JSON, la scavalcava. Qui NON si rifiuta il salvataggio: si toglie il segreto e
// si tiene il puntatore. Rifiutare farebbe perdere all'utente tutto il lavoro del
// progetto per un carattere in un campo, che è una punizione sproporzionata; il
// client, dove l'utente sta digitando, resta più severo e glielo dice.
function _sanitizeBackupRefs(state) {
  const nodes = state && state.nodes;
  if (!Array.isArray(nodes)) return 0;
  let stripped = 0;
  for (const n of nodes) {
    const ref = n && n.backup && n.backup.ref;
    if (!ref) continue;
    const clean = stripRefCreds(ref);
    if (clean !== String(ref).trim()) { n.backup.ref = clean; stripped++; }
  }
  return stripped;
}

// Lista (solo metadati, senza state)
router.get('/api/projects', (_, res) => {
  res.json(listProjects());
});

// Crea - solo admin
router.post('/api/projects', auth.requireAdmin, (req, res) => {
  const name  = (req.body?.name || 'New Project').toString().trim() || 'New Project';
  const state = req.body?.state ?? {};
  _sanitizeBackupRefs(state);
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
  _sanitizeBackupRefs(state);
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
  try { removeProjectHistory(HISTORY_DIR, id); }
  catch (e) { console.error(`[projects] impossibile rimuovere lo storico ${id}: ${e.message}`); }
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
module.exports._sanitizeBackupRefs = _sanitizeBackupRefs;
