'use strict';
// ============================================================
//  Router organizzazione multi-sede — il livello SOPRA i progetti.
//  GET stato (aperto, come i progetti) · PUT sostituisce (admin).
//
//  Il server è AUTOREVOLE sulla normalizzazione: ri-passa il body per
//  `normalizeOrganization` (lib/inter-site.js) e non si fida del client. Ciò che
//  non è modellabile non entra — e la risposta lo DICE, invece di far credere a
//  chi ha salvato che sia andato tutto dentro.
//
//  L'audit di coerenza (lib/inter-site-audit.js) è un modulo puro: lo può
//  chiamare tanto il client quanto questa rotta. Qui si aggiunge l'unica cosa
//  che il client non può sapere da solo — se i `projectRef` delle sedi puntano a
//  progetti che esistono davvero.
// ============================================================
const express = require('express');
const auth = require('../../auth');
const store = require('../organization-store');
const projects = require('../projects-store');
const { buildInterSiteAudit } = require('../../lib/inter-site-audit.js');

const router = express.Router();

// Gli id dei progetti esistenti, per il controllo sui `projectRef`. Se la lista
// non si può leggere si ritorna `null` (≠ lista vuota): «non lo so» non deve
// diventare «nessun progetto esiste», che accuserebbe ogni sede.
function _projectIds() {
  try {
    const list = projects.listProjects();
    if (!Array.isArray(list)) return null;
    return new Set(list.map(p => String((p && (p.id != null ? p.id : p)) || '')).filter(Boolean));
  } catch (_) { return null; }
}

// Sedi che puntano a un progetto inesistente. `null` = non verificabile.
function _unknownProjectRefs(org) {
  const ids = _projectIds();
  if (!ids) return null;
  return org.sites
    .filter(s => s.projectRef && !ids.has(String(s.projectRef)))
    .map(s => ({ siteId: s.id, projectRef: s.projectRef }));
}

// ── Tetti sulle liste ────────────────────────────────────────────────────────
// L'organizzazione è UNA per installazione e descrive le sedi di un'azienda: la
// forma per cui esiste è la PMI a 2-5 sedi. Senza tetto, un PUT con 5.000 sedi
// veniva scritto per intero (misurato: 787 KB in 35 ms) — e da lì ogni GET
// rilegge, normalizza e ne calcola l'audit, per sempre. Il tetto è LARGO apposta:
// non deve dire di no a nessun impianto vero, solo togliere il caso in cui il
// documento diventa una zavorra. Si RIFIUTA, non si tronca: un'organizzazione a
// cui mancano quattromila sedi senza dirlo sarebbe peggio dell'errore.
const MAX = { sites: 500, uplinks: 2000, links: 2000 };
function _troppo(body) {
  const fuori = [];
  for (const k of Object.keys(MAX)) {
    const v = body[k];
    if (Array.isArray(v) && v.length > MAX[k]) fuori.push({ list: k, count: v.length, max: MAX[k] });
  }
  return fuori;
}

// Il marcatore di versione di ciò che il client sta per tenere in mano. Viaggia
// nell'INTESTAZIONE, come per i progetti: il corpo è il documento, e un campo di
// trasporto lì dentro diventerebbe un campo del documento per chiunque lo legga.
function _tag(res) {
  const t = store.organizationEtag();
  if (t) res.set('ETag', t);
  return t;
}

// Stato corrente + audit. `exists` distingue «non c'è ancora» da «c'è ed è vuota».
router.get('/api/organization', (_, res) => {
  const organization = store.readOrganization();
  const audit = buildInterSiteAudit(organization);
  const unknownProjectRefs = _unknownProjectRefs(organization);
  if (unknownProjectRefs === null) {
    // Stessa disciplina di `notChecked` nell'audit: un controllo che non ha
    // potuto girare lo dice, non tace facendo credere di aver guardato.
    audit.notChecked.push({ check: 'unknownProjectRefs', reason: 'no-project-list' });
  }
  _tag(res);
  res.json({
    exists: store.hasOrganization(),
    organization,
    audit,
    unknownProjectRefs: unknownProjectRefs || [],
  });
});

// Sostituzione completa — solo admin, come il salvataggio di un progetto.
router.put('/api/organization', auth.requireAdmin, (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'body must be an organization object', code: 'bad-body' });
  }

  // ── La versione che il client crede di stare aggiornando ────────────────────
  // Stessa disciplina del PUT progetto: chi manda `If-Match` chiede «scrivi solo
  // se nel frattempo non ha scritto nessun altro», e se qualcuno ha scritto qui si
  // RIFIUTA con 409 invece di sovrascrivere rispondendo 200. Chi NON manda
  // l'intestazione ha il comportamento di prima, apposta: script e test non devono
  // imparare un protocollo per continuare a funzionare. `attuale === null` è «non
  // lo so» (file non interrogabile), non «non combacia»: su un dubbio nostro non
  // si blocca un salvataggio.
  const atteso  = req.get('If-Match');
  const attuale = store.organizationEtag();
  if (atteso && attuale && atteso !== attuale) {
    res.set('ETag', attuale);
    return res.status(409).json({
      error: 'Organization changed by another session',
      code: 'stale-organization',
      etag: attuale,
    });
  }

  const fuori = _troppo(body);
  if (fuori.length) {
    return res.status(400).json({ error: 'organization lists too long', code: 'too-many', lists: fuori });
  }

  let out;
  try {
    out = store.writeOrganization(body);
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e), code: 'write-failed' });
  }
  const audit = buildInterSiteAudit(out.organization);
  const unknownProjectRefs = _unknownProjectRefs(out.organization);
  if (unknownProjectRefs === null) {
    audit.notChecked.push({ check: 'unknownProjectRefs', reason: 'no-project-list' });
  }
  // Il marcatore NUOVO torna subito: senza, il client dovrebbe rileggere per poter
  // salvare una seconda volta, e il secondo Salva prenderebbe un 409 contro sé stesso.
  _tag(res);
  res.json({
    organization: out.organization,   // ciò che è stato SCRITTO, non ciò che è arrivato
    dropped: out.dropped,             // e cosa non è passato, così non sparisce in silenzio
    audit,
    unknownProjectRefs: unknownProjectRefs || [],
  });
});

module.exports = router;
// Esposti per i test: i tetti sono una politica, e una politica si prova.
module.exports._MAX = MAX;
module.exports._troppo = _troppo;
