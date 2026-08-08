'use strict';
// ============================================================
//  server/routes/integrations.js — Sincronizzazione DCIM/IPAM (adapter NetBox).
//
//  Montata DOPO auth.register → gate a SESSIONE (utente loggato), NON a token:
//  è una feature interna, non l'API esterna. Le mutazioni/segreti sono admin.
//    • GET  /api/integrations/dcim/config        → config MASCHERATA (mai il token)
//    • PUT  /api/integrations/dcim/config         → aggiorna (url/token/tls) — ADMIN
//    • POST /api/integrations/dcim/test           → prova connessione + versione — ADMIN
//    • GET  /api/integrations/dcim/capabilities   → { import, export } (feature-detect UI)
//
//  IMPORT (lettura → nuovo progetto) e le route di scoperta/anteprima arrivano in
//  Fase B; l'EXPORT (scrittura) vive nel modulo a pagamento modules/dcim-export/.
// ============================================================
const express = require('express');
const fs = require('fs');
const path = require('path');
const auth = require('../../auth');
const { timestamp } = require('../../utils');
const dcimConfig = require('../dcim-config');
const capabilities = require('../dcim/capabilities');
const { DcimClient } = require('../dcim/client');
const dcimMap = require('../../lib/dcim-map');
const { nextId, saveProject } = require('../projects-store');

const router = express.Router();

// Client DCIM dalle credenziali salvate (env > disco). Lancia se non configurato.
function _client() {
  const c = dcimConfig.getConfigWithToken();
  if (!c.url) throw new Error('Sincronizzazione DCIM non configurata (URL mancante)');
  return new DcimClient({ url: c.url, token: c.token, verifyTls: c.verifyTls, timeoutMs: 30000 });
}

// Catalogo device-type (data/device-types.json) → mappa per chiave "brand model".
// Cache mtime+size come server/routes/device-types.js. Serve alla riconciliazione
// del pannello nell'import (best-effort: assente = ripiego su porte misurate).
let _catCacheKey = '';
let _catCache = null;
function _catalogByKey() {
  const file = process.env.INFRANET_DEVICE_TYPES || path.join(__dirname, '..', '..', 'data', 'device-types.json');
  try {
    const st = fs.statSync(file);
    const key = st.mtimeMs + ':' + st.size;
    if (_catCache && key === _catCacheKey) return _catCache;
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    const m = Object.create(null);
    if (Array.isArray(arr)) for (const e of arr) if (e && e.brand && e.model) m[(String(e.brand) + ' ' + String(e.model)).toLowerCase()] = e;
    _catCache = m; _catCacheKey = key;
    return m;
  } catch (_) { return _catCache || Object.create(null); }
}

function _chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

// Fetch paginato batchando un filtro multi-valore (device_id/id) a blocchi di 50
// (limita la lunghezza dell'URL su istanze grandi). Unisce i risultati.
async function _batchByField(client, apiPath, field, ids, cap) {
  const uniq = [...new Set((ids || []).filter(x => x != null))];
  const out = []; let truncated = false;
  for (const chunk of _chunk(uniq, 50)) {
    const r = await client.getPaginated(apiPath, { [field]: chunk }, { cap: cap || 20000 });
    out.push(...r.results); if (r.truncated) truncated = true;
  }
  return { results: out, truncated };
}

// Scarica dalla DCIM il bundle per l'import, onorando la selezione: `scope`
// diventa filtri di query (fetch solo la fetta scelta); `entities` salta intere
// categorie. Ritorna la forma attesa da lib/dcim-map.js.
async function _pullForImport(client, sel) {
  sel = sel || {};
  const ent = sel.entities || {};
  const on = k => ent[k] !== false;                 // default ON
  const scope = sel.scope || {};
  const has = a => Array.isArray(a) && a.length;
  const nb = { truncated: false };

  nb.deviceRoles = (await client.getPaginated('/api/dcim/device-roles/', {}, { cap: 5000 })).results;

  const devQ = {};
  if (has(scope.siteIds)) devQ.site_id = scope.siteIds;
  if (has(scope.rackIds)) devQ.rack_id = scope.rackIds;
  if (has(scope.roleSlugs)) devQ.role = scope.roleSlugs;
  if (has(scope.tags)) devQ.tag = scope.tags;
  const dev = await client.getPaginated('/api/dcim/devices/', devQ, { cap: 20000 });
  nb.devices = dev.results; if (dev.truncated) nb.truncated = true;
  const deviceIds = nb.devices.map(d => d.id).filter(x => x != null);

  nb.deviceTypes = (await _batchByField(client, '/api/dcim/device-types/', 'id',
    nb.devices.map(d => d.device_type && d.device_type.id))).results;

  if (on('racks')) {
    nb.racks = (await _batchByField(client, '/api/dcim/racks/', 'id',
      nb.devices.map(d => d.rack && d.rack.id))).results;
  }
  if (on('devices')) {
    const itf = await _batchByField(client, '/api/dcim/interfaces/', 'device_id', deviceIds);
    nb.interfaces = itf.results; if (itf.truncated) nb.truncated = true;
    // Front port dei patch panel → slot passanti che permettono al cablaggio
    // strutturato di risolversi (switch → pp → pp → server). I rear port arrivano
    // via FK dal front (rear_port) → nessun fetch dedicato.
    const fp = await _batchByField(client, '/api/dcim/front-ports/', 'device_id', deviceIds);
    nb.frontPorts = fp.results; if (fp.truncated) nb.truncated = true;
  }
  if (on('cabling')) {
    const cab = await _batchByField(client, '/api/dcim/cables/', 'device_id', deviceIds);
    const seen = new Set();
    nb.cables = cab.results.filter(c => c && c.id != null && !seen.has(c.id) && seen.add(c.id));
  }
  if (on('ipam')) {
    const vq = {}; if (has(scope.siteIds)) vq.site_id = scope.siteIds;
    nb.vlans = (await client.getPaginated('/api/ipam/vlans/', vq, { cap: 20000 })).results;
    nb.prefixes = (await client.getPaginated('/api/ipam/prefixes/', vq, { cap: 20000 })).results;
  }
  return nb;
}

// Nome progetto proposto: se tutti i device sono di UN solo sito → quel sito,
// altrimenti un nome neutro. L'utente può cambiarlo prima del commit.
function _proposedName(nb) {
  const sites = new Set((nb.devices || []).map(d => d.site && d.site.name).filter(Boolean));
  if (sites.size === 1) return [...sites][0];
  return 'Importazione DCIM';
}

router.get('/api/integrations/dcim/config', (_req, res) => {
  res.json(dcimConfig.getConfig());
});

router.put('/api/integrations/dcim/config', auth.requireAdmin, (req, res) => {
  try {
    res.json(dcimConfig.setConfig(req.body || {}));
  } catch (_e) {
    res.status(500).json({ error: 'Impossibile salvare la configurazione DCIM' });
  }
});

// Prova connessione: usa le credenziali del body (pre-salvataggio) se presenti,
// altrimenti quelle salvate (env > disco). Non tocca lo stato. L'errore non
// contiene mai il token (il client lo tiene solo nell'header).
router.post('/api/integrations/dcim/test', auth.requireAdmin, async (req, res) => {
  const body = req.body || {};
  const stored = dcimConfig.getConfigWithToken();
  const url = (typeof body.url === 'string' && body.url.trim()) ? body.url.trim() : stored.url;
  const token = (typeof body.token === 'string' && body.token) ? body.token : stored.token;
  const verifyTls = (typeof body.verifyTls === 'boolean') ? body.verifyTls : stored.verifyTls;
  if (!url) return res.status(400).json({ ok: false, error: 'URL DCIM mancante' });
  try {
    const client = new DcimClient({ url, token, verifyTls, timeoutMs: 12000 });
    const r = await client.probe();
    res.json(r);
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
});

router.get('/api/integrations/dcim/capabilities', (_req, res) => {
  res.json({ import: true, export: capabilities.isExportAvailable() });
});

// Scoperta ambiti: siti/rack/ruoli/tag con conteggi, per il passo «Ambito» del
// wizard (l'utente sceglie prima di scaricare la fetta). Tag best-effort.
router.get('/api/integrations/dcim/import/scopes', auth.requireAdmin, async (_req, res) => {
  let client;
  try { client = _client(); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const [sites, racks, roles] = await Promise.all([
      client.getPaginated('/api/dcim/sites/', {}, { cap: 5000 }),
      client.getPaginated('/api/dcim/racks/', {}, { cap: 10000 }),
      client.getPaginated('/api/dcim/device-roles/', {}, { cap: 5000 }),
    ]);
    let tags = { results: [] };
    try { tags = await client.getPaginated('/api/extras/tags/', {}, { cap: 5000 }); } catch (_) { /* tag opzionali */ }
    res.json({
      sites: sites.results.map(s => ({ id: s.id, name: s.name, deviceCount: s.device_count || 0 })),
      racks: racks.results.map(r => ({ id: r.id, name: r.name, site: (r.site && r.site.name) || null, deviceCount: r.device_count || 0 })),
      roles: roles.results.map(r => ({ slug: r.slug, name: r.name, count: r.device_count || 0 })),
      tags: tags.results.map(t => ({ slug: t.slug, name: t.name, count: t.tagged_items || 0 })),
    });
  } catch (e) { res.status(502).json({ error: String((e && e.message) || e) }); }
});

// Import: dry-run (anteprima) di default, oppure commit → NUOVO progetto.
// Manual-first: mai merge su un progetto esistente (nessun rischio di clobber).
router.post('/api/integrations/dcim/import', auth.requireAdmin, async (req, res) => {
  const body = req.body || {};
  const selection = (body.selection && typeof body.selection === 'object') ? body.selection : {};
  let client;
  try { client = _client(); } catch (e) { return res.status(400).json({ error: e.message }); }

  let nb;
  try { nb = await _pullForImport(client, selection); }
  catch (e) { return res.status(502).json({ error: String((e && e.message) || e) }); }

  const { state, report } = dcimMap.netboxToState(nb, { catalogByKey: _catalogByKey(), selection });
  const proposedName = _proposedName(nb);

  if (!body.commit) {
    return res.json({
      ok: true,
      counts: report.counts,
      proposedProjectName: proposedName,
      samples: {
        devices: state.nodes.slice(0, 12).map(n => ({
          key: 'device:' + String(n.id).replace('nb-dev-', ''),
          name: n.name, type: n.type, brand: n.brand || null, model: n.model || null,
        })),
        vlans: Object.keys(state.vlanNames).slice(0, 20).map(v => ({ vid: +v, name: state.vlanNames[v] })),
        unmappedRoles: report.unmappedRoles,
        unmatchedDeviceTypes: report.unmatchedDeviceTypes.slice(0, 20),
      },
      warnings: report.warnings.slice(0, 50),
      truncated: report.truncated,
    });
  }

  const name = (typeof body.projectName === 'string' && body.projectName.trim()) ? body.projectName.trim() : proposedName;
  const id = nextId();
  const now = timestamp();
  saveProject(id, name, state, now, now);
  res.status(201).json({ ok: true, projectId: id, counts: report.counts });
});

module.exports = router;
