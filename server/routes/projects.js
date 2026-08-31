'use strict';
// ============================================================
//  Router CRUD progetti (estratto da server.js, logica invariata).
// ============================================================
const express = require('express');
const fs   = require('fs');
const path = require('path');
const auth = require('../../auth');
const { timestamp } = require('../../utils');
const { PROJECTS_DIR, nextId, saveProject, loadProject, listProjects, removeBgAsset, projectEtag } = require('../projects-store');
const { removeProjectHistory, createFsHistoryStore } = require('../history-store-fs');
const { mergePresence, foldPresence, collectPresence, stripPresence } = require('../../lib/presence-store');
const { mergeObservations, foldObservations, stripObservations } = require('../../lib/discovery-history');
const { stripDerivedVlan, redactSecretBag } = require('../../lib/project-format');
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
// ⚠️ QUALI siano i segreti non si decide qui. Era un elenco di tre nomi, gemello di
// quello in `lib/project-format.js`, dentro un contenitore che `lib/project-schema.js`
// dichiarava `secret` per intero: due copie della stessa verita', e nessuna delle due
// derivata. Un quarto campo segreto sarebbe uscito in chiaro verso un lettore non-admin
// lasciando la suite VERDE, perche' anche le prove enumeravano quei tre nomi.
// Adesso i nomi stanno nello scope `integration` della classifica e questo file li
// chiede, con la stessa funzione che usa l'export portatile.
function _redactSnmpSecrets(project) {
  const nodes = project && project.state && project.state.nodes;
  if (!Array.isArray(nodes)) return project;
  for (const n of nodes) {
    if (!n) continue;
    redactSecretBag(n.integration);
    // Le VM usano lo stesso contenitore dei device (`vm.integration`, più il
    // legacy `vm.snmp` dei progetti vecchi): stessi segreti, stessa redazione.
    if (Array.isArray(n.vms)) {
      for (const vm of n.vms) {
        if (!vm) continue;
        redactSecretBag(vm.integration);
        redactSecretBag(vm.snmp);
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

// ── Chi ha in mano quale versione ────────────────────────────────────────────
// L'ETag viaggia nell'INTESTAZIONE, non nel corpo: il corpo di GET/POST/copia è il
// DTO del progetto, che esce anche dalla REST API v1 e dall'inventario Ansible, e
// un campo di trasporto lì dentro diventerebbe un campo del documento per chiunque
// legga di là. Chi non manda `If-Match` non se ne accorge e continua a funzionare
// come prima (l'import, gli script, i test): la guardia è per chi la chiede.
function _tag(res, id) {
  const t = projectEtag(id);
  if (t) res.set('ETag', t);
  return t;
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
  _tag(res, id);
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
  _tag(res, id);   // versione di ciò che il client sta per tenere in mano
  return res.json(p);
});

// Aggiorna - solo admin
router.put('/api/projects/:id', auth.requireAdmin, (req, res) => {
  const id = +req.params.id;
  const p  = loadProject(id);
  if (!p) return res.status(404).json({ error: 'Project not found' });

  // ── La versione che il client crede di stare aggiornando ───────────────────
  // Chi manda `If-Match` chiede: «scrivi solo se nel frattempo non ha scritto
  // nessun altro». Se qualcuno ha scritto, qui si RIFIUTA con 409 invece di
  // sovrascrivere e rispondere 200 — che è ciò che faceva sparire il lavoro
  // dell'altra sessione senza che nessuna delle due vedesse un errore.
  // Chi NON manda l'intestazione ha il comportamento di prima, apposta: l'import
  // DCIM, gli script e i test non devono imparare un protocollo per continuare a
  // funzionare, e una guardia che rompe i suoi chiamanti non viene adottata.
  // `attuale === null` = il file non si è potuto interrogare: non è «non
  // combacia», è «non lo so», e su un dubbio nostro non si blocca un salvataggio.
  const atteso  = req.get('If-Match');
  const attuale = projectEtag(id);
  if (atteso && attuale && atteso !== attuale) {
    res.set('ETag', attuale);
    return res.status(409).json({
      error: 'Project changed by another session',
      code: 'stale-project',
      updated_at: p.updated_at,
      etag: attuale,
    });
  }

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
  // L'ETag NUOVO torna subito: senza, il client dovrebbe rileggere il progetto
  // intero per poter salvare una seconda volta, e il secondo Salva prenderebbe un
  // 409 contro sé stesso.
  _tag(res, id);
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
  _tag(res, newId);
  res.status(201).json(loadProject(newId));
});

module.exports = router;
// Esposto per i test (SEC-M1): redazione dei segreti SNMP per lettori non-admin.
module.exports._redactSnmpSecrets = _redactSnmpSecrets;
module.exports._sanitizeBackupRefs = _sanitizeBackupRefs;
