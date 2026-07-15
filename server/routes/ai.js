'use strict';
// ============================================================
//  server/routes/ai.js — Assistente AI (L0: config + «mostra cosa esce»).
//
//  Montata DOPO auth.register → tutte le route sono gate a SESSIONE (same-origin,
//  utente loggato), NON a token: la chat è una feature interna, non l'API esterna.
//    • GET  /api/ai/config   → config MASCHERATA (mai la chiave) — ogni utente.
//    • PUT  /api/ai/config   → aggiorna (enabled/endpoint/model/key) — solo ADMIN.
//    • POST /api/ai/preview  → contesto SANITIZZATO del progetto = «mostra cosa
//                              esce» (paletto SICUREZZA #1). NESSUN modello, nessuna
//                              chiave: prova che il tubo dati regge e cosa lascia.
//
//  Provider + POST /api/ai/chat arrivano nel prossimo incremento (con verifica
//  live dell'utente sulla propria key e il composer chat).
// ============================================================
const fs = require('fs');
const path = require('path');
const express = require('express');
const auth = require('../../auth');
const aiConfig = require('../ai-config');
const { buildAiContext } = require('../ai/context');
const { extractEntities } = require('../../lib/ai-grounding');
const { buildSystemPrompt } = require('../ai/prompt');
const { chatCompletion } = require('../ai/provider');
const { extractCatalog, catalogLines } = require('../../lib/ui-catalog');
const i18n = require('../../lib/i18n');
const { loadProject } = require('../projects-store');

const router = express.Router();

// Id progetto SICURO: intero positivo. `loadProject` fa
// path.join(PROJECTS_DIR, `${id}.json`) → senza coercizione un projectId come
// "../users" nel body uscirebbe dalla cartella projects/ (path traversal).
// Allinea al `+req.params.id` già usato dalle altre route. Ritorna l'intero o null.
function _safeProjectId(raw) {
  const n = Number(raw);
  return (Number.isInteger(n) && n > 0) ? n : null;
}

// ── Aiuto §4c: catalogo UI (pulsanti+tooltip) DERIVATO una volta da
// netmapper.html (single-source-of-truth) e risolto per lingua → l'assistente
// risponde a «come si fa X» citando l'etichetta REALE, senza inventare comandi.
// È metadato di UI generico (nessun dato utente / segreto) → fuori dallo scope.
let _uiCatalog = null;
function _helpLines(lang) {
  if (_uiCatalog === null) {
    try {
      const html = fs.readFileSync(path.join(__dirname, '..', '..', 'netmapper.html'), 'utf8');
      _uiCatalog = extractCatalog(html);
    } catch (_e) { _uiCatalog = []; }
  }
  try { return catalogLines(_uiCatalog, i18n._i18nDict, lang, { max: 60 }); }
  catch (_e) { return []; }
}

router.get('/api/ai/config', (_req, res) => {
  res.json(aiConfig.getConfig());
});

router.put('/api/ai/config', auth.requireAdmin, (req, res) => {
  try {
    res.json(aiConfig.setConfig(req.body || {}));
  } catch (_e) {
    res.status(500).json({ error: 'Impossibile salvare la configurazione AI' });
  }
});

router.post('/api/ai/preview', (req, res) => {
  const body = req.body || {};
  const pid = _safeProjectId(body.projectId);
  if (pid === null) {
    return res.status(400).json({ error: 'projectId mancante o non valido' });
  }
  const project = loadProject(pid);
  if (!project) return res.status(404).json({ error: 'Progetto non trovato' });
  // L'anteprima rispetta gli interruttori d'ambito → mostra ESATTAMENTE cosa uscirebbe.
  const context = buildAiContext(project, body.liveFacts, aiConfig.getConfig().scope);
  res.json({ context });
});

// POST chat — la conversazione vera. Assembla system-prompt (grounding) +
// contesto sanitizzato, poi chiama il provider OpenAI-compatibile (BYO key,
// server-side). La chiave NON compare mai nella risposta né negli errori.
router.post('/api/ai/chat', async (req, res) => {
  const cfg = aiConfig.getConfigWithKey();        // include la chiave (solo qui, server-side)
  if (!cfg.enabled) return res.status(409).json({ error: 'ai_disabled' });
  if (!cfg.endpoint) return res.status(409).json({ error: 'ai_no_endpoint' });

  const body = req.body || {};
  const pid = _safeProjectId(body.projectId);
  if (pid === null) {
    return res.status(400).json({ error: 'projectId mancante o non valido' });
  }
  const project = loadProject(pid);
  if (!project) return res.status(404).json({ error: 'Progetto non trovato' });

  const lang = (body.lang === 'en') ? 'en' : 'it';

  // Solo i turni user/assistant con testo (niente system/altro dal client).
  const history = Array.isArray(body.messages) ? body.messages : [];
  const turns = history
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: String(m.content) }));
  if (!turns.length) return res.status(400).json({ error: 'Nessun messaggio' });

  // Handler async: la costruzione di contesto/prompt e JSON.stringify va DENTRO un
  // try. Un throw qui, restando fuori, diventava una unhandledRejection (Express 4
  // non la cattura) -> nessuna risposta -> la richiesta del client restava appesa
  // fino al timeout del socket. Ora un errore di contesto -> 500 pulito.
  let context, system;
  try {
    // scope = ambito dati (cosa esce) · features = capacità abilitate (cosa fa).
    context = buildAiContext(project, body.liveFacts, cfg.scope);
    // system = grounding + capacità + AIUTO §4c (catalogo UI) + contesto del progetto.
    system = buildSystemPrompt(lang, cfg.features, _helpLines(lang)) + '\n\ncontext:\n' + JSON.stringify(context);
  } catch (e) {
    return res.status(500).json({ error: 'ai_context', detail: String((e && e.message) || e) });
  }

  try {
    const out = await chatCompletion({
      endpoint: cfg.endpoint, model: cfg.model, key: cfg.key,
      messages: [{ role: 'system', content: system }, ...turns],
    });
    // `entities` = digest delle entità REALI del contesto (id/nome/ip/mac/vlan)
    // → il client fa il controllo anti-invenzione (lib/ai-grounding) su ciò che
    // il modello ha visto DAVVERO (rispetta lo scope). Niente segreti: sono gli
    // stessi dati già sanitizzati del contesto.
    res.json({ content: out.content, entities: extractEntities(context) });
  } catch (e) {
    // e.message può citare host/HTTP status (utile a chi configura) ma MAI la chiave.
    res.status(502).json({ error: 'ai_provider', detail: String((e && e.message) || e) });
  }
});

router._safeProjectId = _safeProjectId;   // esportato per il test di sicurezza
module.exports = router;
