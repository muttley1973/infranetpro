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
const { removeProjectHistory, createFsHistoryStore } = require('../history-store-fs');
const { mergePresence, foldPresence, collectPresence, stripPresence } = require('../../lib/presence-store');
const { mergeObservations, foldObservations, stripObservations } = require('../../lib/discovery-history');
const { stripDerivedVlan } = require('../../lib/project-format');
const { mergeAudit, foldAudit, stripAudit } = require('../../lib/audit-log');
const { runProjectDeleteHooks } = require('../module-registry');
const { stripRefCreds } = require('../../lib/backup-ref.js');

const router = express.Router();
const HISTORY_DIR = path.join(PROJECTS_DIR, 'history');
// Presenza salvata: la scrive il router storico dopo ogni Verifica, e la rilegge la
// GET qui sotto. Questo router la tocca in scrittura in un solo caso — il Salva, che
// vi fa confluire la presenza dei progetti vecchi prima di toglierla dal documento.
// Stessa cartella, stessa interfaccia: un domani il backend SQLite subentra a entrambi.
const _history = createFsHistoryStore({ baseDir: HISTORY_DIR });

// ── La presenza non è documentazione ─────────────────────────────────
// `n.proof` è una MISURA (chi c'era, quando, con che prova): il documento lo scrive
// l'utente, la presenza la scrive la rete. Vive nel sidecar `history/<id>/presence.json`,
// dove la Verifica la salva da sé senza aspettare un Salva, e da dove la GET la
// rimette nello stato. Restava però anche DENTRO al `<id>.json`, perché il Salva
// rimandava indietro lo stato intero: due copie della stessa misura, tenute allineate
// da una regola di freschezza che esisteva solo per rimediare al doppione.
//
// Qui si chiude: prima di scrivere, la presenza CONFLUISCE nel sidecar (vince la più
// fresca) ed ESCE dallo stato. Sui progetti scritti prima d'ora è anche la migrazione
// — i loro rossi vengono promossi nel sidecar invece di sparire col primo Salva.
function _presenceOutOfDocument(id, state) {
  try {
    const folded = foldPresence(_history.readPresence(id), collectPresence(state));
    if (Object.keys(folded.nodes).length) _history.savePresence(id, folded);
  } catch (_) { /* best-effort: un sidecar che non si scrive non deve bloccare il Salva */ }
  stripPresence(state);
}

// ── Le osservazioni di scoperta nemmeno ──────────────────────────────
// Stessa natura, stesso trattamento: «questo MAC l'ho visto su questa porta, N
// volte, dal … al …» è ciò che ha visto la rete. Su un progetto con pochi
// apparati arrivava a pesare il 96% del file. Il fold tiene la storia più larga —
// primo avvistamento più antico, ultimo più recente, conteggio maggiore — perché
// è un dato che si ACCUMULA: una scansione sola non ricostruisce tre mesi di
// avvistamenti, ed è su quell'accumulo che `lib/temporal-confidence.js` misura
// quanto è «reale» un endpoint.
function _observationsOutOfDocument(id, state) {
  try {
    const folded = foldObservations(_history.readObservations(id), state && state.discoveryHistory);
    if (folded.observations.length) _history.saveObservations(id, folded);
  } catch (_) { /* best-effort, come sopra */ }
  stripObservations(state);
}

// ── E nemmeno il giornale delle modifiche ────────────────────────────
// ⚠️ Questo NON è una misura: è la storia del documento, «chi ha cambiato cosa».
// Esce per la ragione della timeline — è un giornale append-only che cresce da
// solo, e il codice lo trattava già da non-documento (fuori da undo e snapshot).
// La fusione è un'UNIONE senza duplicati: risalvare lo stesso stato due volte non
// deve raddoppiare il giornale, e nessuna voce deve andare persa.
function _auditOutOfDocument(id, state) {
  try {
    const folded = foldAudit(_history.readAudit(id), state && state.auditLog);
    if (folded.entries.length) _history.saveAudit(id, folded);
  } catch (_) { /* best-effort, come sopra */ }
  stripAudit(state);
}

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
  // Qui si toglie e basta, senza far confluire niente: una presenza che arriva
  // insieme a un progetto NUOVO (import di un export altrui) è la misura di
  // un'altra rete. Adottarla come nostra sarebbe un'invenzione.
  stripPresence(state);
  stripObservations(state);
  stripDerivedVlan(state);
  stripAudit(state);              // il giornale di un altro impianto non è la nostra storia
  saveProject(id, name, state, now, now);
  res.status(201).json(loadProject(id));
});

// Leggi
router.get('/api/projects/:id', (req, res) => {
  const id = +req.params.id;
  const p = loadProject(id);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  // La PRESENZA vive fuori dal <id>.json (come lo storico) perché è una misura, non
  // una modifica: la Verifica la salva da sé, senza aspettare che qualcuno prema
  // Salva. Qui torna dentro allo stato, così chi riapre il progetto ritrova gli
  // apparati spenti ancora rossi. Vince la misura più fresca (lib/presence-store).
  try { mergePresence(p.state, _history.readPresence(id)); } catch (_) { /* mai bloccare l'apertura */ }
  try { mergeObservations(p.state, _history.readObservations(id)); } catch (_) { /* idem */ }
  try { mergeAudit(p.state, _history.readAudit(id)); } catch (_) { /* idem */ }
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
  _presenceOutOfDocument(id, state);
  _observationsOutOfDocument(id, state);
  _auditOutOfDocument(id, state);
  // La propagazione VLAN si ricalcola a ogni render: nel file non ci va. Senza
  // questa riga, aprire un progetto e guardarlo bastava a farlo crescere.
  stripDerivedVlan(state);
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
  // La copia nasce senza presenza: il documento si duplica, la misura no — quei
  // rossi riguardano gli apparati dell'originale, non quelli della copia.
  stripPresence(src.state);
  stripObservations(src.state);
  stripDerivedVlan(src.state);
  stripAudit(src.state);          // la copia è un documento nuovo: la sua storia inizia ora
  saveProject(newId, name, src.state, now, now);
  res.status(201).json(loadProject(newId));
});

module.exports = router;
// Esposto per i test (SEC-M1): redazione dei segreti SNMP per lettori non-admin.
module.exports._redactSnmpSecrets = _redactSnmpSecrets;
module.exports._sanitizeBackupRefs = _sanitizeBackupRefs;
