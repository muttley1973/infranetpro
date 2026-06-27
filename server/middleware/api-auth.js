'use strict';
// ============================================================
//  server/middleware/api-auth.js — gate a TOKEN per la REST API v1.
//
//  La superficie /api/v1/* è destinata ai CONSUMER ESTERNI e va raggiunta SENZA
//  sessione-cookie → si autentica SOLO con `Authorization: Bearer <token>`.
//  È montata PRIMA del requireAuth globale (server.js) proprio per non passare
//  dal gate di sessione; per questo il token è l'unica via d'accesso, e l'API
//  restituisce esclusivamente dati sanitizzati (lib/api-shape.js), mai lo state grezzo.
// ============================================================
const apiTokens = require('../api-tokens');

function apiAuth(req, res, next) {
  const hdr = (req.get('authorization') || '').trim();
  const m = /^Bearer\s+(.+)$/i.exec(hdr);
  if (!m) {
    res.set('WWW-Authenticate', 'Bearer realm="InfraNet API"');
    return res.status(401).json({ error: 'Token API mancante. Header richiesto: Authorization: Bearer <token>' });
  }
  const rec = apiTokens.verifyToken(m[1].trim());
  if (!rec) {
    res.set('WWW-Authenticate', 'Bearer realm="InfraNet API", error="invalid_token"');
    return res.status(401).json({ error: 'Token API non valido o revocato' });
  }
  req.apiToken = rec;            // principal read-only (nessun ruolo admin → niente scrittura)
  next();
}

module.exports = { apiAuth };
