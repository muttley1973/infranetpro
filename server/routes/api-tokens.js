'use strict';
// ============================================================
//  server/routes/api-tokens.js — gestione token REST API (solo ADMIN, sessione).
//
//  Mintare/elencare/revocare i token che autenticano l'API v1. Montata DOPO
//  auth.register (richiede sessione admin): l'admin crea i token dalla UI, i
//  consumer esterni li usano poi via Bearer. Il segreto in chiaro è restituito
//  SOLO alla creazione (POST) e mai più recuperabile.
// ============================================================
const express = require('express');
const auth = require('../../auth');
const apiTokens = require('../api-tokens');

const router = express.Router();

router.get('/api/auth/tokens', auth.requireAdmin, (_req, res) => {
  res.json(apiTokens.listTokens());
});

router.post('/api/auth/tokens', auth.requireAdmin, (req, res) => {
  const label = (req.body && req.body.label) || '';
  const { token, record } = apiTokens.createToken(label);
  // `token` in chiaro: disponibile SOLO ORA. Il client deve mostrarlo all'utente
  // e poi dimenticarlo (a riposo c'è solo lo hash).
  res.status(201).json({ token, record });
});

router.delete('/api/auth/tokens/:id', auth.requireAdmin, (req, res) => {
  const ok = apiTokens.revokeToken(+req.params.id);
  return ok
    ? res.json({ ok: true, deleted_id: +req.params.id })
    : res.status(404).json({ ok: false, error: 'Token non trovato' });
});

module.exports = router;
