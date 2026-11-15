'use strict';
// ============================================================
//  Router «Trova» — dall'indirizzo di una sede a un punto PROPOSTO.
//  GET stato (se il servizio c'è e quale) · POST cerca (admin).
//
//  La rotta non scrive niente e non conosce nessuna sede: passa la query a
//  `server/geocoder.js` e restituisce i candidati. Il punto sulla sede lo mette
//  l'utente, nel pannello, con un clic (paletto ②). Solo chi può SALVARE
//  l'organizzazione può cercare: la ricerca esce verso Internet, e non deve
//  poterla far partire chiunque abbia aperto il pannello in sola lettura.
//
//  Il corpo è JSON (`{ q }`), non una query string: l'indirizzo di una sede non
//  deve finire negli access log di un proxy davanti all'applicazione.
// ============================================================
const express = require('express');
const auth = require('../../auth');
const { createGeocoder } = require('../geocoder');

/** Il codice HTTP di ogni esito: il guasto ha un nome, e il nome ha uno stato. */
const STATUS = {
  'bad-query': 400,
  'disabled': 409,
  'too-fast': 429,
  'unreachable': 502,
  'upstream': 502,
  'upstream-busy': 502,
  'bad-response': 502,
};

/** @param {{search:Function, config:Function}} geocoder */
function makeRouter(geocoder) {
  const router = express.Router();

  // Il servizio c'è? Serve al pannello per scrivere sul bottone DOVE va l'indirizzo
  // (o per non offrirlo affatto): chi preme deve sapere chi lo riceve.
  router.get('/api/geocode/status', (_req, res) => {
    const c = geocoder.config();
    res.json({ enabled: !!c.enabled, host: c.host || null, reason: c.reason || null });
  });

  router.post('/api/geocode', auth.requireAdmin, async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'body must be { q }', code: 'bad-query' });
    }
    const r = await geocoder.search(body.q);
    if (r.ok) return res.json({ candidates: r.candidates, cached: !!r.cached, host: r.host || null });
    if (r.code === 'too-fast') res.set('Retry-After', String(Math.max(1, Math.ceil((r.retryAfterMs || 1000) / 1000))));
    return res.status(STATUS[r.code] || 502).json({
      error: r.code, code: r.code,
      ...(r.retryAfterMs ? { retryAfterMs: r.retryAfterMs } : {}),
      ...(r.reason ? { reason: r.reason } : {}),
    });
  });

  return router;
}

module.exports = makeRouter(createGeocoder({}));
module.exports.makeRouter = makeRouter;
module.exports._STATUS = STATUS;
