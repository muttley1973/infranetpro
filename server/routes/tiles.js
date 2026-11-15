'use strict';
// ============================================================
//  Router delle tessere — lo sfondo della mappa, servito dal nostro server.
//  GET stato (c'è? attribuzione? zoom massimo) · GET una tessera.
//
//  Il browser chiede QUI, mai a un terzo (`img-src 'self'`): il server le prende
//  da OpenStreetMap (o dal servizio scelto) e le tiene su disco. La rotta sta
//  dopo il login come ogni altra: una mappa è di chi ha aperto l'app. Le
//  coordinate sono interi nel loro intervallo, o 400 — e non arrivano al proxy.
// ============================================================
const express = require('express');
const { createTileProxy, parseTile } = require('../tiles');

/** @param {{get:Function, config:Function}} proxy */
function makeRouter(proxy) {
  const router = express.Router();

  // Lo stato non rivela l'indirizzo completo del servizio, solo l'host: serve a
  // scrivere sotto la mappa DOVE vanno le richieste, e l'attribuzione richiesta.
  router.get('/api/tiles/status', (_req, res) => {
    const c = proxy.config();
    res.json({
      enabled: !!c.enabled,
      host: c.enabled ? (c.host || null) : null,
      attribution: c.enabled ? (c.attribution || '') : '',
      maxZoom: c.enabled ? (c.maxZoom || 19) : 0,
      reason: c.enabled ? null : (c.reason || null),
    });
  });

  router.get('/api/tiles/:z/:x/:y.png', async (req, res) => {
    const t = parseTile(req.params.z, req.params.x, req.params.y);
    if (!t) return res.status(400).json({ error: 'bad tile', code: 'bad-tile' });
    const r = await proxy.get(t.z, t.x, t.y);
    if (r.ok) {
      res.set('Content-Type', 'image/png');
      // Privata: la tessera è di chi ha il login. Un giorno nel browser, poi si richiede a noi (che la tiene sette).
      res.set('Cache-Control', 'private, max-age=86400');
      return res.send(r.body);
    }
    if (r.code === 'disabled') return res.status(404).json({ error: 'tiles disabled', code: 'disabled' });
    return res.status(503).json({ error: 'tile unavailable', code: 'unavailable' });
  });

  return router;
}

module.exports = makeRouter(createTileProxy({}));
module.exports.makeRouter = makeRouter;
