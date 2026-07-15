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

// Cache in-memory della stringa JSON grezza. Il catalogo e' ~1.4 MB: leggerlo e
// parsarlo a OGNI richiesta bloccava l'event-loop (stallo per gli altri client:
// SSE discovery, poll...). Qui lo si legge/valida UNA volta e si riserve la
// stringa cachata; si rilegge solo se il file cambia (mtime+size come chiave).
// Si serve la stringa grezza (send) invece di res.json(parsed) per saltare anche
// la ri-serializzazione. Su file assente/illeggibile/non-array -> '[]'.
let _cacheStr = null;
let _cacheKey = '';
function _catalogJson() {
  try {
    const st = fs.statSync(CATALOG);
    const key = `${st.mtimeMs}:${st.size}`;
    if (_cacheStr !== null && key === _cacheKey) return _cacheStr;
    const raw = fs.readFileSync(CATALOG, 'utf8');
    _cacheStr = Array.isArray(JSON.parse(raw)) ? raw : '[]';   // valida: dev'essere un array
    _cacheKey = key;
    return _cacheStr;
  } catch (_) {
    return _cacheStr !== null ? _cacheStr : '[]';               // assente/illeggibile -> ultima valida o []
  }
}

router.get('/api/device-types', (_, res) => res.type('application/json').send(_catalogJson()));

module.exports = router;
