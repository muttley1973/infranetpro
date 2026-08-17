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
const { execFile } = require('child_process');
const auth = require('../../auth');
const { timestamp } = require('../../utils');
const dcimConfig = require('../dcim-config');
const capabilities = require('../dcim/capabilities');
const { DcimClient } = require('../dcim/client');
const { createPullCache } = require('../dcim/pull-cache');
const dcimMap = require('../../lib/dcim-map');
const deviceCatalog = require('../../lib/device-catalog');
const { nextId, saveProject } = require('../projects-store');

const router = express.Router();

// Bundle grezzo letto da NetBox, tenuto in MEMORIA per il tempo di una sessione di
// import. ⚠️ Non finisce mai nel JSON di progetto né su disco: è un accorgimento di
// velocità, non un dato. Vedi server/dcim/pull-cache.js per il perché della chiave.
const pullCache = createPullCache();

// Chi legge: istanza + utente (token e permessi sono suoi). In dev senza auth la
// sessione non c'è: una chiave costante va benissimo, l'utente è uno solo.
function _pullKey(req, selection) {
  const c = dcimConfig.getConfig();
  return pullCache.keyFor({
    instance: c && c.url,
    userId: (req.session && req.session.user && (req.session.user.id != null ? req.session.user.id : req.session.user.username)) || 'dev',
    scope: selection.scope,
    entities: selection.entities,
  });
}

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
let _catalogUpdateRunning = false;
function _catalogStatus() {
  const catalogFile = process.env.INFRANET_DEVICE_TYPES || path.join(__dirname, '..', '..', 'data', 'device-types.json');
  const manifestFile = path.join(__dirname, '..', '..', 'data', 'device-types-manifest.json');
  const canonicalFile = path.join(__dirname, '..', '..', 'data', 'device-types-canonical.json');
  const out = { available: false, source: null, generatedAt: null, catalogModels: 0, canonicalModels: 0, catalogVendors: 0, excludedModels: 0 };
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    out.available = true;
    out.source = manifest.source || null;
    out.sourceRef = manifest.sourceRef || (manifest.source && manifest.source.ref) || null;
    out.generatedAt = manifest.generatedAt || null;
    out.catalogModels = Number(manifest.catalogModels || 0);
    out.canonicalModels = Number(manifest.canonicalModels || 0);
    out.catalogVendors = Number(manifest.catalogVendors || 0);
    out.excludedModels = Number(manifest.excludedModels || 0);
    out.diff = manifest.diff || null;
  } catch (_) { /* manifest opzionale: lo stato resta locale/legacy */ }
  try { out.runtimeBytes = fs.statSync(catalogFile).size; } catch (_) { out.runtimeBytes = 0; }
  try { out.canonicalBytes = fs.statSync(canonicalFile).size; } catch (_) { out.canonicalBytes = 0; }
  return out;
}
function _catalogForImport() {
  const file = process.env.INFRANET_DEVICE_TYPES || path.join(__dirname, '..', '..', 'data', 'device-types.json');
  try {
    const st = fs.statSync(file);
    const manifestFile = path.join(__dirname, '..', '..', 'data', 'device-types-manifest.json');
    const aliasFile = path.join(__dirname, '..', '..', 'data', 'device-types-aliases.json');
    const fileKey = candidate => {
      try { const s = fs.statSync(candidate); return s.mtimeMs + ':' + s.size; } catch (_) { return 'missing'; }
    };
    const key = st.mtimeMs + ':' + st.size + '|' + fileKey(manifestFile) + '|' + fileKey(aliasFile);
    if (_catCache && key === _catCacheKey) return _catCache;
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entries = Array.isArray(arr) ? arr : [];
    const byKey = Object.create(null);
    for (const e of entries) {
      if (e && e.brand && e.model) byKey[(String(e.brand) + ' ' + String(e.model)).toLowerCase()] = e;
    }
    let aliases = Object.create(null);
    try {
      const rawAliases = JSON.parse(fs.readFileSync(aliasFile, 'utf8'));
      if (rawAliases && typeof rawAliases === 'object' && !Array.isArray(rawAliases)) aliases = rawAliases;
    } catch (_) { /* alias opzionali */ }
    let version = null;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      version = manifest.sourceRef || (manifest.source && manifest.source.ref) || manifest.generatedAt || null;
    } catch (_) { /* manifest opzionale */ }
    _catCache = { byKey, indexes: deviceCatalog.buildIndexes(entries), aliases, version };
    _catCacheKey = key;
    return _catCache;
  } catch (_) { return _catCache || { byKey: Object.create(null), indexes: null, aliases: Object.create(null), version: null }; }
}

function _chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

// Fetch paginato batchando un filtro multi-valore (device_id/id) a blocchi di 50
// (limita la lunghezza dell'URL su istanze grandi). Unisce i risultati.
async function _batchByField(client, apiPath, field, ids, cap) {
  const uniq = [...new Set((ids || []).filter(x => x != null))];
  const out = []; let truncated = false;
  for (const chunk of _chunk(uniq, 50)) {
    const remaining = (cap || 20000) - out.length;
    if (remaining <= 0) { truncated = true; break; }
    const r = await client.getPaginated(apiPath, { [field]: chunk }, { cap: remaining });
    out.push(...r.results); if (r.truncated) truncated = true;
  }
  return { results: out, truncated };
}

async function _paginatedWithFallback(client, apiPath, query, opts) {
  try {
    return { ...(await client.getPaginated(apiPath, query, opts)), fallback: false };
  } catch (error) {
    if (!query || !Object.keys(query).length) throw error;
    const result = await client.getPaginated(apiPath, {}, opts);
    const filters = Object.keys(query).join(', ');
    return { ...result, fallback: true, warning: apiPath + ' non supporta i filtri (' + filters + '); importati i risultati disponibili' };
  }
}

function _assignedDeviceId(ip) {
  const assigned = ip && (ip.assigned_object || ip.assignedObject);
  if (assigned && assigned.device && assigned.device.id != null) return assigned.device.id;
  if (assigned && assigned.device_id != null) return assigned.device_id;
  if (ip && ip.device && ip.device.id != null) return ip.device.id;
  return ip && ip.device_id != null ? ip.device_id : null;
}

async function _pullIpAddresses(client, deviceIds) {
  const selected = new Set((deviceIds || []).filter(id => id != null).map(String));
  if (!selected.size) return { results: [], truncated: false };
  try {
    const scoped = await client.getPaginated('/api/ipam/ip-addresses/', { device_id: [...selected] }, { cap: 50000 });
    return { results: scoped.results, truncated: scoped.truncated };
  } catch (_) {
    const all = await client.getPaginated('/api/ipam/ip-addresses/', {}, { cap: 50000 });
    return {
      results: all.results.filter(ip => {
        const deviceId = _assignedDeviceId(ip);
        return deviceId != null && selected.has(String(deviceId));
      }),
      truncated: all.truncated,
    };
  }
}

// Quanti indirizzi NetBox DICHIARA, e quanti non sono agganciati a niente.
// Serve solo a poterlo DIRE: `_pullIpAddresses` filtra per `device_id`, quindi
// gli indirizzi liberi non tornano e non c'è modo di contarli dal bundle.
// Misurato su un NetBox vero: 180 dichiarati, 180 senza apparato, 0 importati —
// e l'anteprima scriveva «Indirizzi IP 0» accanto a «Prefissi 90», che è esatto
// ma si legge come un guasto.
// Costa DUE richieste, non 180 pagine: la risposta paginata porta `count`, e con
// `limit=1` si legge quello senza scaricare le righe.
// ⚠️ Il nome del filtro per «non agganciato» cambia fra le versioni di NetBox, e
// una versione che non lo conosce può IGNORARLO e rispondere col totale. Qui si
// raccoglie e basta; la guardia che scarta un conteggio impossibile sta nel
// mapper, dov'è pura e testabile. Se una delle due chiamate fallisce si tace:
// meglio nessun numero che un numero inventato.
// ⚠️ Il censimento è GLOBALE, l'import è PER AMBITO. Un indirizzo non agganciato
// non ha un sito proprio — ce l'ha solo attraverso il prefisso che lo contiene —
// quindi non c'è un filtro per sito da applicare qui: restringerlo costerebbe una
// chiamata `?parent=` per ogni rete importata. Finché resta globale, la frase
// della decisione DEVE dirlo («In tutto NetBox…», `dcim.dec.ip.unassigned.*`):
// misurato sul campo, importando un sito con 6 indirizzi liberi il pannello
// annunciava 186, che è vero dell'archivio e falso di ciò che stai importando.
async function _pullIpCensus(client) {
  const out = {};
  try {
    const all = await client.get('/api/ipam/ip-addresses/', { limit: 1 });
    if (all && Number.isFinite(+all.count)) out.total = +all.count;
  } catch (_) { /* nessun censimento: l'avviso non si stampa */ }
  try {
    // `limit=5` invece di 1: costa uguale e porta gli ESEMPI. Un numero da solo
    // non si giudica — «180 restano fuori» diventa una domanda, «180 restano
    // fuori, per esempio 10.0.5.7/24» diventa una risposta.
    const free = await client.get('/api/ipam/ip-addresses/', { limit: 5, assigned_to_interface: 'false' });
    if (free && Number.isFinite(+free.count)) out.unassigned = +free.count;
    if (free && Array.isArray(free.results)) {
      out.sample = free.results.map(r => (r && typeof r.address === 'string') ? r.address : '').filter(Boolean).slice(0, 5);
    }
  } catch (_) { /* filtro non supportato da questa versione: si tace */ }
  return out;
}

// Le PRENOTAZIONI dell'IPAM: indirizzi che NetBox dichiara e non aggancia a
// nessuna interfaccia. Non sono apparati e non entrano come tali — ma sono
// indirizzi che NON SI POSSONO ASSEGNARE, e questo InfraNet deve saperlo: senza,
// «prossimo IP libero» proponeva un indirizzo che qualcuno aveva già impegnato
// (misurato: rete importata da NetBox con .1–.30 prenotati, suggerimento .1).
// UNA chiamata paginata con un tetto, non una per rete: quali cadano dentro le
// reti importate lo decide l'aritmetica CIDR del mapper, che è pura e già scritta.
// ⚠️ GUARDIA, e non è teorica: NetBox IGNORA IN SILENZIO un parametro di query
// che non conosce — non risponde 400, risponde TUTTO. Se `assigned_to_interface`
// non esiste in questa versione tornerebbero anche gli indirizzi DEGLI APPARATI,
// e li marcheremmo come prenotazioni. Si ricontrolla riga per riga: passa solo
// ciò che davvero non ha un `assigned_object`.
async function _pullIpReservations(client) {
  try {
    const res = await client.getPaginated('/api/ipam/ip-addresses/', { assigned_to_interface: 'false' }, { cap: 20000 });
    const rows = (res.results || []).filter(r => r && !(r.assigned_object || r.assignedObject));
    return { results: rows, truncated: res.truncated, filterHeld: rows.length === (res.results || []).length };
  } catch (_) {
    return { results: [], truncated: false, filterHeld: true };   // niente prenotazioni, nessuna invenzione
  }
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

  const rolesPromise = client.getPaginated('/api/dcim/device-roles/', {}, { cap: 5000 });

  const devQ = {};
  if (has(scope.siteIds)) devQ.site_id = scope.siteIds;
  if (has(scope.rackIds)) devQ.rack_id = scope.rackIds;
  if (has(scope.roleSlugs)) devQ.role = scope.roleSlugs;
  if (has(scope.tags)) devQ.tag = scope.tags;
  const [roles, dev] = await Promise.all([
    rolesPromise,
    client.getPaginated('/api/dcim/devices/', devQ, { cap: 20000 }),
  ]);
  nb.deviceRoles = roles.results;
  nb.devices = dev.results; if (dev.truncated) nb.truncated = true;
  const deviceIds = nb.devices.map(d => d.id).filter(x => x != null);

  const typeIds = nb.devices.map(d => d.device_type && d.device_type.id);
  const [deviceTypes, racks] = await Promise.all([
    _batchByField(client, '/api/dcim/device-types/', 'id', typeIds),
    on('racks') ? _batchByField(client, '/api/dcim/racks/', 'id', nb.devices.map(d => d.rack && d.rack.id)) : Promise.resolve({ results: [], truncated: false }),
  ]);
  nb.deviceTypes = deviceTypes.results;
  if (deviceTypes.truncated) nb.truncated = true;

  if (on('racks')) {
    nb.racks = racks.results;
    if (racks.truncated) nb.truncated = true;
  }
  if (on('devices')) {
    const [itf, fp, powerOutlets, powerPorts, consolePorts] = await Promise.all([
      _batchByField(client, '/api/dcim/interfaces/', 'device_id', deviceIds),
      _batchByField(client, '/api/dcim/front-ports/', 'device_id', deviceIds),
      _batchByField(client, '/api/dcim/power-outlets/', 'device_id', deviceIds),
      _batchByField(client, '/api/dcim/power-ports/', 'device_id', deviceIds),
      _batchByField(client, '/api/dcim/console-ports/', 'device_id', deviceIds),
    ]);
    nb.interfaces = itf.results; if (itf.truncated) nb.truncated = true;
    // Front port dei patch panel → slot passanti che permettono al cablaggio
    // strutturato di risolversi (switch → pp → pp → server). I rear port arrivano
    // via FK dal front (rear_port) → nessun fetch dedicato.
    nb.frontPorts = fp.results; if (fp.truncated) nb.truncated = true;
    nb.powerOutlets = powerOutlets.results; if (powerOutlets.truncated) nb.truncated = true;
    nb.powerPorts = powerPorts.results; if (powerPorts.truncated) nb.truncated = true;
    nb.consolePorts = consolePorts.results; if (consolePorts.truncated) nb.truncated = true;
  }
  // Le WLAN dichiarate: SSID, cifratura, VLAN. L'interfaccia radio porta solo il
  // riferimento (id + ssid), quindi senza questa lettura si saprebbe COME si
  // chiama la rete e non CHE COS'È — che è il pezzo che serve all'audit. Sta
  // sotto `devices` perché senza interfacce radio non c'è dove appenderle.
  if (on('devices')) {
    try {
      const wl = await client.getPaginated('/api/wireless/wireless-lans/', {}, { cap: 10000 });
      nb.wirelessLans = wl.results;
      if (wl.truncated) nb.truncated = true;
    } catch (_) {
      // NetBox senza il modulo wireless (o troppo vecchio): nessuna WLAN, e le
      // radio entrano lo stesso con banda e canale. Niente da inventare.
      nb.wirelessLans = [];
    }
  }
  // Le macchine virtuali. Vivono in un'applicazione a parte di NetBox
  // (`virtualization/`) e si agganciano all'host in due modi diversi: `device`
  // (la macchina fisica, esplicito) e `cluster`. Si chiede per ENTRAMBI e si
  // unisce, perche' un archivio vero usa l'uno o l'altro a seconda di come e'
  // stato popolato. Sta sotto `devices` perche' senza l'host importato una VM
  // non ha dove atterrare.
  if (on('devices')) {
    try {
      const clusterIds = nb.devices.map(d => d.cluster && d.cluster.id);
      const [byDevice, byCluster] = await Promise.all([
        _batchByField(client, '/api/virtualization/virtual-machines/', 'device_id', deviceIds),
        _batchByField(client, '/api/virtualization/virtual-machines/', 'cluster_id', clusterIds),
      ]);
      // ⚠️ Seconda cintura, come per le prenotazioni IPAM: NetBox risponde a un
      // filtro che non conosce restituendo TUTTO il database. Qui dentro non
      // deve entrare una VM che non appartenga a un apparato o a un cluster del
      // perimetro — altrimenti un import di un sito si porterebbe le VM di
      // tutta l'azienda.
      const wantDevice = new Set(deviceIds.map(String));
      const wantCluster = new Set(clusterIds.filter(x => x != null).map(String));
      const seen = new Set();
      const vms = [];
      for (const vm of [...byDevice.results, ...byCluster.results]) {
        if (!vm || vm.id == null || seen.has(vm.id)) continue;
        const dv = vm.device && vm.device.id;
        const cl = vm.cluster && vm.cluster.id;
        if (!(dv != null && wantDevice.has(String(dv))) && !(cl != null && wantCluster.has(String(cl)))) continue;
        seen.add(vm.id); vms.push(vm);
      }
      nb.virtualMachines = vms;
      if (byDevice.truncated || byCluster.truncated) nb.truncated = true;
      // Censimento: quante VM esistono in TUTTO NetBox. Serve a poter dire «ne
      // sono entrate 4 su 184» invece di mostrare un elenco vuoto e lasciare
      // credere a un difetto — che e' esattamente la domanda da cui nasce
      // questa funzione. Una chiamata sola, `limit=5`: il conteggio e cinque
      // nomi d'esempio.
      try {
        const all = await client.get('/api/virtualization/virtual-machines/', { limit: 5 });
        if (all && Number.isFinite(+all.count)) {
          nb.vmCensus = {
            total: +all.count,
            sample: (all.results || []).map(v => String((v && v.name) || '')).filter(Boolean).slice(0, 5),
          };
        }
      } catch (_) { /* il censimento e' un di piu': senza, si tace invece di stimare */ }
      if (vms.length) {
        const vmIds = vms.map(v => v.id);
        const [vif, vip] = await Promise.all([
          _batchByField(client, '/api/virtualization/interfaces/', 'virtual_machine_id', vmIds),
          _batchByField(client, '/api/ipam/ip-addresses/', 'virtual_machine_id', vmIds),
        ]);
        nb.vmInterfaces = vif.results; if (vif.truncated) nb.truncated = true;
        nb.vmIpAddresses = vip.results; if (vip.truncated) nb.truncated = true;
      }
    } catch (_) {
      // NetBox senza l'app di virtualizzazione (o permessi che non la coprono):
      // gli apparati entrano lo stesso, semplicemente senza VM. Niente da
      // inventare e niente da far fallire.
      nb.virtualMachines = [];
    }
  }
  if (on('cabling')) {
    const cab = await _batchByField(client, '/api/dcim/cables/', 'device_id', deviceIds);
    const seen = new Set();
    nb.cables = cab.results.filter(c => c && c.id != null && !seen.has(c.id) && seen.add(c.id));
    if (cab.truncated) nb.truncated = true;
  }
  if (on('ipam')) {
    const vq = {}; if (has(scope.siteIds)) vq.site_id = scope.siteIds;
    const [vlans, prefixes, ips, census, reservations] = await Promise.all([
      _paginatedWithFallback(client, '/api/ipam/vlans/', vq, { cap: 20000 }),
      _paginatedWithFallback(client, '/api/ipam/prefixes/', vq, { cap: 20000 }),
      _pullIpAddresses(client, deviceIds),
      _pullIpCensus(client),
      _pullIpReservations(client),
    ]);
    nb.vlans = vlans.results; if (vlans.truncated) nb.truncated = true;
    if (vlans.warning) (nb.warnings || (nb.warnings = [])).push(vlans.warning);
    nb.prefixes = prefixes.results; if (prefixes.truncated) nb.truncated = true;
    if (prefixes.warning) (nb.warnings || (nb.warnings = [])).push(prefixes.warning);
    nb.ipAddresses = ips.results; if (ips.truncated) nb.truncated = true;
    if (census && (census.total != null || census.unassigned != null)) nb.ipCensus = census;
    nb.ipReservations = reservations.results; if (reservations.truncated) nb.truncated = true;
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
    const saved = dcimConfig.setConfig(req.body || {});
    // Cambiata l'istanza o il token: quello che c'è in memoria è stato letto con
    // credenziali che non valgono più. Si butta tutto, non solo la chiave di
    // questo utente — un token nuovo può vedere una fetta diversa.
    pullCache.clear();
    res.json(saved);
  } catch (e) {
    res.status(400).json({ error: String((e && e.message) || 'Configurazione DCIM non valida') });
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

// Stato del catalogo locale: leggibile nella UI, senza esporre la sorgente YAML.
// L'aggiornamento resta un'operazione amministrativa esplicita e non entra nel
// percorso runtime dell'importazione.
router.get('/api/integrations/dcim/catalog', (_req, res) => {
  res.json(_catalogStatus());
});

router.get('/api/integrations/dcim/catalog/diff', (_req, res) => {
  const file = path.join(__dirname, '..', '..', 'data', 'device-types-diff.json');
  try {
    const diff = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json({ ok: true, diff });
  } catch (_) {
    res.json({ ok: true, diff: null });
  }
});

function _runCatalogUpdater(checkOnly) {
  if (_catalogUpdateRunning) return Promise.reject(new Error('Aggiornamento catalogo già in corso'));
  _catalogUpdateRunning = true;
  const script = path.join(__dirname, '..', '..', 'scripts', 'update-device-types.js');
  const args = [script, '--quiet'];
  if (checkOnly) args.push('--check');
  const env = Object.assign({}, process.env);
  if (env.Path && !env.PATH) env.PATH = env.Path;
  delete env.Path;
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, {
      cwd: path.join(__dirname, '..', '..'),
      timeout: 120000,
      windowsHide: true,
      env,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      _catalogUpdateRunning = false;
      if (checkOnly && error && error.code === 2) {
        return resolve({ available: true, output: String(stdout || stderr || '').trim() });
      }
      if (error) return reject(new Error(String(stderr || stdout || error.message || error).trim()));
      resolve({ available: false, output: String(stdout || '').trim() });
    });
  });
}

router.post('/api/integrations/dcim/catalog/check', auth.requireAdmin, async (_req, res) => {
  try {
    const result = await _runCatalogUpdater(true);
    res.json({ ok: true, available: result.available, status: _catalogStatus() });
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
});

router.post('/api/integrations/dcim/catalog/update', auth.requireAdmin, async (_req, res) => {
  try {
    await _runCatalogUpdater(false);
    _catCache = null; _catCacheKey = '';
    res.json({ ok: true, status: _catalogStatus() });
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
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

  // La lettura da NetBox si paga UNA VOLTA per sessione di import: cambiare una
  // decisione ricalcola soltanto la mappatura (funzione pura, millisecondi).
  // `refresh: true` forza la rilettura — è il comando esplicito «rileggi da NetBox».
  // ⚠️ Il commit usa la stessa voce di cache: così il progetto creato è ESATTAMENTE
  // quello dell'anteprima approvata, non una seconda lettura che nel frattempo può
  // essere cambiata sotto i piedi.
  const cacheKey = _pullKey(req, selection);
  const hit = body.refresh ? null : pullCache.get(cacheKey);
  const fromCache = !!hit;
  let nb = hit ? hit.value : null;
  let fetchedAt = hit ? hit.at : null;
  if (!nb) {
    try { nb = await _pullForImport(client, selection); }
    catch (e) { return res.status(502).json({ error: String((e && e.message) || e) }); }
    fetchedAt = pullCache.set(cacheKey, nb).at;
  }

  const catalog = _catalogForImport();
  const { state, report } = dcimMap.netboxToState(nb, {
    catalogByKey: catalog.byKey,
    catalogIndexes: catalog.indexes,
    catalogAliases: catalog.aliases,
    catalogVersion: catalog.version,
    selection,
  });
  const proposedName = _proposedName(nb);

  if (!body.commit) {
    return res.json({
      ok: true,
      counts: report.counts,
      proposedProjectName: proposedName,
      // Quando è stata letta NetBox, e se questa risposta viene da una lettura
      // riusata. Va DETTO: un'anteprima istantanea che non dice di essere una
      // fotografia di dieci minuti fa si legge come «NetBox adesso».
      fetchedAt: fetchedAt != null ? new Date(fetchedAt).toISOString() : null,
      fromCache,
      samples: {
        devices: state.nodes.slice(0, 12).map(n => ({
          key: 'device:' + String(n.id).replace('nb-dev-', ''),
          name: n.name, type: n.type, placement: n.placement, brand: n.brand || null, model: n.model || null,
        })),
        vlans: Object.keys(state.vlanNames).slice(0, 20).map(v => ({ vid: +v, name: state.vlanNames[v] })),
        unmappedRoles: report.unmappedRoles,
        unmatchedDeviceTypes: report.unmatchedDeviceTypes.slice(0, 20),
        catalogMatches: report.catalogMatches.details.slice(0, 100),
        unresolvedCables: report.cables.unresolved.slice(0, 100),
        excluded: report.excluded,
      },
      warnings: report.warnings.slice(0, 50),
      // Forma strutturata degli stessi eventi: e' quella su cui il pannello di
      // riconciliazione costruisce le decisioni. Cappata perche' un sito grande puo'
      // produrne una per apparato; `issuesTotal` dice quante sono davvero, cosi' il
      // conteggio a schermo resta vero anche quando l'elenco e' troncato.
      issues: report.issues.slice(0, 2000),
      issuesTotal: report.issues.length,
      catalogVersion: catalog.version,
      // I ruoli IPAM letti dalle VLAN, con quante VLAN tocca ciascuno. Non sono un
      // avviso: sono le righe di abbinamento del pannello, e restano vuote finché
      // l'utente non sceglie. Sono pochi per costruzione (un archivio vero ne ha
      // una manciata), quindi passano interi e non cappati.
      vlanRoles: report.vlanRoles || [],
      catalogMatches: report.catalogMatches,
      cableReport: report.cables,
      excluded: report.excluded,
      reconciliation: {
        required: report.reviewRequired.length,
        resolved: report.manualMappings.applied.length,
        invalid: report.manualMappings.invalid,
      },
      truncated: report.truncated,
    });
  }

  if ((report.reviewRequired.length || report.manualMappings.invalid.length) && selection.allowUnresolved !== true) {
    return res.status(409).json({
      ok: false,
      error: 'Conferma i casi di riconciliazione prima di creare il progetto',
      reconciliationRequired: report.reviewRequired,
      reconciliation: {
        required: report.reviewRequired.length,
        resolved: report.manualMappings.applied.length,
        invalid: report.manualMappings.invalid,
      },
    });
  }

  const name = (typeof body.projectName === 'string' && body.projectName.trim()) ? body.projectName.trim() : proposedName;
  const id = nextId();
  const now = timestamp();
  // ⚠️ `state` e basta: nel progetto va il documento di rete, MAI il bundle grezzo
  // da cui è nato. La cache resta in memoria e muore qui — il prossimo import è
  // un'altra sessione e rilegge, perché nel frattempo il DCIM può essere cambiato.
  saveProject(id, name, state, now, now);
  pullCache.invalidate(cacheKey);
  res.status(201).json({ ok: true, projectId: id, counts: report.counts });
});

module.exports = router;
