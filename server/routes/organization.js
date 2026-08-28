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
  res.json({
    organization: out.organization,   // ciò che è stato SCRITTO, non ciò che è arrivato
    dropped: out.dropped,             // e cosa non è passato, così non sparisce in silenzio
    audit,
    unknownProjectRefs: unknownProjectRefs || [],
  });
});

module.exports = router;
