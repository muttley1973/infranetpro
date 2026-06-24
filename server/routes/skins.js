'use strict';
// ============================================================
//  Router skin store — libreria condivisa di skin SVG del pannello.
//  GET lista (con svg, per la cache client) · POST crea (admin) · DELETE (admin).
//  Il server e' AUTOREVOLE sulla sanitizzazione: ri-valida e sanitizza l'SVG con
//  lib/panel-skin.js (non si fida del client) e salva la versione pulita.
// ============================================================
const express = require('express');
const auth = require('../../auth');
const { parsePanelSkin } = require('../../lib/panel-skin');
const store = require('../skins-store');

const router = express.Router();

// Lista completa (metadati + svg) → popola la cache client in un colpo.
router.get('/api/skins', (_, res) => {
  res.json(store.listSkinsFull());
});

// Crea — solo admin.
router.post('/api/skins', auth.requireAdmin, (req, res) => {
  const b = req.body || {};
  const parsed = parsePanelSkin(b.svg, { name: b.name, brand: b.brand, model: b.model, face: b.face });
  if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: parsed.errorCode });
  const rec = store.saveSkin({
    name:  (b.name || '').toString().trim() || 'skin',
    brand: (b.brand || '').toString().trim(),
    model: (b.model || '').toString().trim(),
    face:  parsed.face,
    viewBox: parsed.viewBox,
    ports: parsed.ports
  }, parsed.svg);   // salva l'svg SANITIZZATO dal parser
  res.status(201).json(Object.assign({}, rec, { svg: parsed.svg, warnings: parsed.warnings }));
});

// Elimina — solo admin.
router.delete('/api/skins/:id', auth.requireAdmin, (req, res) => {
  const ok = store.deleteSkin(req.params.id);
  return ok ? res.json({ ok: true, deleted_id: req.params.id })
            : res.status(404).json({ error: 'Skin not found' });
});

module.exports = router;
