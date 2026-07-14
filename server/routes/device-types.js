'use strict';
// ============================================================
//  Router catalogo device-type — template NATIVI (ports + frontPanel) generati
//  da dati device-type pubblici (CC0) via tools/import-device-types.js
//  (--catalog). Serve SOLO questo file (mai la dir data/, che contiene segreti).
//  GET pubblica in sola lettura: e' un catalogo, non dati utente.
// ============================================================
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
// Override via INFRANET_DEVICE_TYPES (isolamento test); default invariato.
const CATALOG = process.env.INFRANET_DEVICE_TYPES || path.join(__dirname, '..', '..', 'data', 'device-types.json');

router.get('/api/device-types', (_, res) => {
  let list = [];
  try { const j = JSON.parse(fs.readFileSync(CATALOG, 'utf8')); if (Array.isArray(j)) list = j; } catch (_) { /* assente/illeggibile -> [] */ }
  res.json(list);
});

module.exports = router;
