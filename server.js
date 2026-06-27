#!/usr/bin/env node
'use strict';
// ============================================================
//  InfraNet Pro - Server Node.js
//  Avvio:  node server.js
//  Apri:   http://localhost:8421
//
//  Struttura:
//    server.js          -> Express app, route CRUD progetti, route /api/poll
//    auth.js            -> autenticazione, sessioni, gestione utenti
//    drivers/snmp.js    -> driver SNMP v1/v2c/v3
//    drivers/<name>.js  -> futuri driver (Cisco RESTCONF, Aruba Central...)
// ============================================================

const express   = require('express');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const http      = require('http');
const https     = require('https');
const net       = require('net');
const dns       = require('dns').promises;
const { execFile } = require('child_process');
const auth      = require('./auth');
const { timestamp } = require('./utils');

const PORT         = parseInt(process.env.PORT || '8421', 10);
// Interfaccia di bind. Default 127.0.0.1 (solo loopback — non esposto in rete; vedi README).
// In container si imposta HOST=0.0.0.0 e si pubblica la porta SOLO su 127.0.0.1 dell'host.
const HOST         = process.env.HOST || '127.0.0.1';
const ROOT         = __dirname;

// ---- Persistenza progetti (server/projects-store.js) ------------------------
const { PROJECTS_DIR, nextId, saveProject, loadProject, listProjects } = require('./server/projects-store');

// ---- Driver registry (server/drivers.js) ------------------------------------
const { DRIVERS } = require('./server/drivers');

// ============================================================
// Express
// ============================================================

const app = express();

app.use(express.json({ limit: '20mb' }));

// Logging
app.use((req, res, next) => {
  const ts = new Date().toTimeString().substring(0, 8);
  console.log(`  [${ts}] ${req.method} ${req.path}`);
  next();
});

// ---- Frontend statico -------------------------------------------------------

// CSS modularizzato (cartella styles/): partial ordinate, caricate via <link>
// in netmapper.html. Solo .css, niente traversal.
app.get('/styles/:file', (req, res) => {
  if (!/^[a-zA-Z0-9_-]+\.css$/.test(req.params.file)) return res.status(404).end();
  res.sendFile(path.join(ROOT, 'styles', req.params.file));
});
app.get('/app.js', (_, res) => res.sendFile(path.join(ROOT, 'app.js')));
app.get('/export.js', (_, res) => res.sendFile(path.join(ROOT, 'export.js')));
// Bundle esbuild del frontend (cartella dist/): solo .js + .map, niente traversal.
app.get('/dist/:file', (req, res) => {
  if (!/^[a-zA-Z0-9_.-]+\.(js|map)$/.test(req.params.file)) return res.status(404).end();
  res.sendFile(path.join(ROOT, 'dist', req.params.file));
});
// Moduli condivisi browser/test (cartella lib/): solo file .js, niente traversal.
app.get('/lib/:file', (req, res) => {
  if (!/^[a-zA-Z0-9_-]+\.js$/.test(req.params.file)) return res.status(404).end();
  res.sendFile(path.join(ROOT, 'lib', req.params.file));
});

// Font Awesome 6 servito localmente da vendor/fontawesome (self-hosted, no CDN, no dep npm).
// Esposto solo: css/all.min.css + webfonts fa-*.woff2. Nessun traversal.
const FA_ROOT = path.join(ROOT, 'vendor', 'fontawesome');
app.get('/vendor/fontawesome/css/all.min.css', (_, res) => res.sendFile(path.join(FA_ROOT, 'css', 'all.min.css')));
app.get('/vendor/fontawesome/webfonts/:file', (req, res) => {
  if (!/^fa-[a-z0-9]+-\d+\.woff2$/i.test(req.params.file)) return res.status(404).end();
  res.sendFile(path.join(FA_ROOT, 'webfonts', req.params.file));
});

// ---- REST API v1 (server/routes/api-v1.js) ---------------------------------
// Read-only, gate a TOKEN Bearer. Montata PRIMA dell'auth di sessione: la
// superficie esterna NON passa dal requireAuth globale, si autentica solo col
// token e restituisce esclusivamente dati sanitizzati (lib/api-shape.js).
app.use(require('./server/routes/api-v1'));

// ---- Auth (sessioni + login page + route /api/auth/*) ----------------------
// Deve essere registrato PRIMA delle route protette.
auth.register(app);

// ---- Gestione token API (server/routes/api-tokens.js) ----------------------
// Solo admin (sessione). Mintare/revocare i token usati dall'API v1 qui sopra.
app.use(require('./server/routes/api-tokens'));

// ---- Frontend protetto ------------------------------------------------------

app.get('/', (_, res) => res.sendFile(path.join(ROOT, 'netmapper.html')));

// ---- Progetti (server/routes/projects.js) -----------------------------------
app.use(require('./server/routes/projects'));

// ---- Skin store (server/routes/skins.js) ------------------------------------
app.use(require('./server/routes/skins'));

// ---- Primitive di rete / discovery (server/netscan.js) ----------------------
const { expandSubnet, _execFileAsync, _pingHost, _normMac, _parseArpTable, _readArpMap, _readLocalInterfaceMap, OUI_VENDOR, _vendorByMac, _extractTitle, _httpProbe, DEEP_TCP_PORTS, _tcpProbe, _deepScanHost, _parseNetbiosOutput, _netbiosProbe, _parseNetViewOutput, _smbSharesProbe, _deepIdentityScanHost } = require('./server/netscan');

// ---- Classificazione device / discovery meta (server/classify.js) ----------
const { _cleanHostname, PEN_VENDOR, _penFromObjectId, _vendorByObjectId, _decodeSysServices, _resolveSysObject, _resolveOsFingerprint, _classifyDiscoveredDevice, _buildDiscoveryMeta, _decorateDiscoveryRow } = require('./server/classify');

// ---- Discovery: poll/discover/topology/crawl (server/routes/discovery.js) ---
app.use(require('./server/routes/discovery'));

// ---- Export PDF (server/routes/export.js) -----------------------------------
app.use(require('./server/routes/export'));

// ---- 404 catch-all ----------------------------------------------------------

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ---- Start ------------------------------------------------------------------

// Avvia il listen SOLO se eseguito direttamente (node server.js).
// Quando il file viene richiesto da un test (require), NON apre la porta.
if (require.main === module) {
  const server = app.listen(PORT, HOST, () => {
    const shownHost = (HOST === '0.0.0.0' || HOST === '::') ? 'localhost' : HOST;
    console.log('');
    console.log('  ================================================');
    console.log(`    InfraNet Pro  ->  http://${shownHost}:${PORT}`);
    console.log(`    Progetti in:   ${PROJECTS_DIR}`);
    console.log('    Premi Ctrl+C per fermare il server');
    console.log('  ================================================');
    console.log('');
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  [ERRORE] La porta ${PORT} è già occupata.`);
      console.error('  Chiudi l\'altra istanza del server (finestra PowerShell o Node.js) e riprova.\n');
    } else {
      console.error(`\n  [ERRORE] ${err.message}\n`);
    }
    process.exit(1);
  });
}

// ---- Gestori errori globali - evitano crash silenti -----------------------

process.on('uncaughtException', err => {
  console.error(`\n  [FATAL] Eccezione non catturata: ${err.message}`);
  console.error(err.stack);
  // App locale: logga l'errore ma non chiudere il server durante workflow lunghi
  // come discovery/SNMP. Le route principali rispondono gia con errori JSON.
});

process.on('unhandledRejection', reason => {
  console.error(`\n  [WARNING] Promise rifiutata non gestita: ${reason}`);
});

// Funzioni pure di discovery esposte SOLO per i test di regressione.
// Additivo: nessun effetto sul comportamento runtime.
module.exports = {
  app,
  _internals: {
    _parseNetbiosOutput, _parseNetViewOutput, _cleanHostname,
    _penFromObjectId, _vendorByObjectId, _decodeSysServices,
    _resolveSysObject, _resolveOsFingerprint,
    _classifyDiscoveredDevice, _buildDiscoveryMeta,
  },
};
