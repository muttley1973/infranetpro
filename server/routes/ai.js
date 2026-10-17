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

// Id progetto SICURO: intero positivo, nella forma in cui lo scrive il nostro client — un numero
// o la sua scrittura decimale canonica. `loadProject` fa path.join(PROJECTS_DIR, `${id}.json`):
// senza coercizione un projectId come "../users" uscirebbe dalla cartella projects/ (path
// traversal). Il vecchio `Number(raw)` era piu' largo di quanto serviva: `true`, `[5]`, `'0x10'`
// e `'1e3'` diventavano 1, 5, 16 e 1000 — progetti che nessuno aveva chiesto.
// Ritorna l'intero o null.
function _safeProjectId(raw) {
  if (typeof raw === 'number') return (Number.isSafeInteger(raw) && raw > 0) ? raw : null;
  if (typeof raw === 'string') {
    const t = raw.trim();                      // gli spazi attorno erano gia' tollerati, e non fanno male
    if (/^[1-9]\d{0,14}$/.test(t)) { const n = Number(t); return Number.isSafeInteger(n) ? n : null; }
  }
  return null;
}

// Tetti sulla conversazione che il client manda al modello: il corpo puo' pesare fino a 20 MB
// (limite globale di express.json) e tutto cio' che arriva qui viene INOLTRATO al provider con la
// chiave dell'admin — cioe' pagato. Si tengono gli ultimi turni, ciascuno troncato, e un totale.
const MAX_TURNS = 40;
const MAX_TURN_CHARS = 8000;
const MAX_TOTAL_CHARS = 60000;
function _capTurns(turns) {
  let out = turns.slice(-MAX_TURNS).map(m => ({ role: m.role, content: m.content.slice(0, MAX_TURN_CHARS) }));
  let total = out.reduce((n, m) => n + m.content.length, 0);
  // Oltre il totale si scartano i turni piu' VECCHI, mai l'ultimo: e' la domanda a cui si risponde.
  while (out.length > 1 && total > MAX_TOTAL_CHARS) { total -= out[0].content.length; out = out.slice(1); }
  return out;
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

router.get('/api/ai/config', (req, res) => {
  const cfg = aiConfig.getConfig();
  // L'endpoint e' un dato di RETE (spesso un host interno: `http://10.0.4.7:11434`) e serve a chi lo
  // configura. Gli altri utenti ne ricavano solo `local` (il chip 🔒 Locale / ☁ Cloud).
  if (!req.session || !req.session.user || req.session.user.role !== 'admin') delete cfg.endpoint;
  res.json(cfg);
});

router.put('/api/ai/config', auth.requireAdmin, (req, res) => {
  try {
    res.json(aiConfig.setConfig(req.body || {}));
  } catch (e) {
    // Un campo sbagliato e' colpa di chi l'ha mandato, non del server: 400 col motivo, non un 500 muto.
    if (e && (e.code === 'endpoint_invalid' || e.code === 'key_invalid')) {
      return res.status(400).json({ error: e.code === 'endpoint_invalid' ? 'endpoint_invalid' : 'key_invalid', reason: e.reason || '' });
    }
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
// requireAdmin: la chat usa la chiave LLM dell'admin (a pagamento) e SPEDISCE il contesto
// di rete a un provider esterno — un egress. Ogni altra route con egress/scan (poll,
// discover, integrations/test) è admin-gated: senza questo, un viewer poteva prosciugare
// la chiave e forzare l'esfiltrazione della topologia.
// ✅ DECISIONE CONFERMATA (2026-08-14): la chat resta riservata agli AMMINISTRATORI.
// Non è un default provvisorio in attesa di qualcuno che lo allenti: è la scelta. Se un
// giorno la si vorrà dare ai viewer, la strada NON è togliere questo gate, ma aggiungere
// prima un rate-limit e un budget di spesa espliciti — senza quei due, «aperta ai viewer»
// significa una bolletta e una topologia in mano a chiunque abbia un account in lettura.
router.post('/api/ai/chat', auth.requireAdmin, async (req, res) => {
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
  const capped = _capTurns(turns);

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
      messages: [{ role: 'system', content: system }, ...capped],
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
router._capTurns = _capTurns;
router.CAPS = { MAX_TURNS, MAX_TURN_CHARS, MAX_TOTAL_CHARS };
module.exports = router;
