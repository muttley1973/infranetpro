'use strict';
// ============================================================
//  Router discovery: poll / discover / topology / crawl SSE.
//  Estratto da server.js senza modifiche di logica.
// ============================================================
const express = require('express');
const dns = require('dns').promises;
const os  = require('os');
const auth = require('../../auth');
const { DRIVERS } = require('../drivers');
const { buildNeighborCandidates, buildPortIndex, buildMacIndex, buildPortMacIndex, buildFdbCandidates, buildArpCandidates, locateMacsOnEdge } = require('../../lib/correlate');
const { expandSubnet, _execFileAsync, _pingHost, _pingHostRetry, _stealthDelayMs, _normMac, _parseArpTable, _readArpMap, _demoteStaleArpDup, _readLocalInterfaceMap, OUI_VENDOR, _vendorByMac, _extractTitle, _httpProbe, DEEP_TCP_PORTS, _tcpProbe, _deepScanHost, _parseNetbiosOutput, _netbiosProbe, _parseNetViewOutput, _smbSharesProbe, _deepIdentityScanHost, _mdnsSsdpSweep, _shuffled } = require('../netscan');
const { _cleanHostname, PEN_VENDOR, _penFromObjectId, _vendorByObjectId, _decodeSysServices, _classifyDiscoveredDevice, _buildDiscoveryMeta, _decorateDiscoveryRow } = require('../classify');
const { OuiEngine } = require('../../engine');
const { publicMdns } = require('../../lib/discovery-mdns');
const dhcpDrivers = require('../dhcp-drivers');
const { crawlNetwork } = require('../crawl-bfs');

// Concorrenza della fase deep/neighbor del crawl (probe+pollNeighbors di device GIA'
// scoperti e autenticati SNMP → non e' una firma di scansione). Default BASSO e Pi-safe:
// il footprint di socket = pool, e i test sul lab mostrano il ginocchio dei rendimenti a
// K~4-6 (oltre il guadagno e' nullo, il pavimento e' il device piu' lento). La scansione
// BASE degli host resta fuori di qui (sequenziale/anti-IDS). Override via CRAWL_POOL (1-32).
const CRAWL_POOL = Math.max(1, Math.min(parseInt(process.env.CRAWL_POOL, 10) || 4, 32));

// Singleton OUI engine used by the route. Lazy-initialized so the import of
// discovery.js does not cost the 57k IEEE entries parse at startup.
//
// `watch: false` + `signatureCheckIntervalMs: -1` disable both fs.watch and
// the per-lookup signature scan, which is critical here because the engine
// is invoked thousands of times during a topology crawl (once per MAC of
// every FDB). Plugins don't change at runtime in production; if you edit
// them, restart the process or call _routeOuiEngine.refresh() manually.
let _routeOuiEngine = null;
function _getRouteOuiEngine() {
  if (!_routeOuiEngine) {
    _routeOuiEngine = new OuiEngine({
      pluginDir: require('path').resolve(__dirname, '..', '..', 'plugins', 'oui'),
      watch: false,
      signatureCheckIntervalMs: -1,
      logger: console,
    });
  }
  return _routeOuiEngine;
}

// Bound predicate for buildFdbCandidates: returns true when the MAC belongs to
// a known virtual NIC (Docker veth, VMware vSwitch, Hyper-V, Xen, KVM/QEMU).
function _isVirtualMac(mac) {
  try { return _getRouteOuiEngine().isVirtual(mac); }
  catch (_) { return false; }
}

const router = express.Router();

// ---- Poll / integrazione dispositivi ----------------------------------------
// Solo admin (SNMP richiede credenziali di rete)

router.post('/api/poll', auth.requireAdmin, async (req, res) => {
  const cfg    = req.body ?? {};
  const driver = (cfg.driver || '').toLowerCase();
  const drv    = DRIVERS[driver];

  if (!drv) {
    return res.json({ ok: false, error: `Driver non supportato: ${driver}` });
  }

  try {
    const data = await drv.poll(cfg);
    res.json({ ok: true, ...data });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`  [POLL] ${driver} ${cfg.host}: ${msg}`);
    res.json({ ok: false, error: msg });
  }
});

// ---- Poll power: valori live UPS (UPS-MIB) / ATS (APC PowerNet) -------------
router.post('/api/poll-power', auth.requireAdmin, async (req, res) => {
  const cfg    = req.body ?? {};
  const kind   = (cfg.kind === 'ats') ? 'ats' : 'ups';
  const driver = (cfg.driver || '').toLowerCase();
  const drv    = DRIVERS[driver];
  if (!drv || typeof drv.pollPower !== 'function') {
    return res.json({ ok: false, error: `Driver non supportato: ${driver}` });
  }
  try {
    const data = await drv.pollPower(cfg, kind);
    res.json({ ok: true, ...data });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`  [POLL-POWER] ${driver} ${cfg.host}: ${msg}`);
    res.json({ ok: false, error: msg });
  }
});

// ---- Raggiungibilità multi-segnale (audit presenza per "Verifica documentazione")
// Data una lista di IP documentati, dice quali sono RAGGIUNGIBILI sulla rete
// SENZA SNMP: ARP (già nella tabella locale) → ping ICMP → fallback TCP su
// poche porte di management. Serve a stabilire la PRESENZA dei device che non
// parlano SNMP (PC, IoT, UPS, webcam…): presenti se rispondono a uno qualsiasi
// di questi segnali. Leggero e parallelo; nessuna walk.
router.post('/api/reachability', auth.requireAdmin, async (req, res) => {
  try {
    const { ips = [], timeout } = req.body ?? {};
    const list = [...new Set((Array.isArray(ips) ? ips : [])
      .map(x => String(x || '').trim())
      .filter(ip => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)))].slice(0, 1024);
    if (!list.length) return res.json({ ok: true, results: {} });

    const pingMs = Math.max(300, Math.min((parseInt(timeout, 10) || 1) * 1000, 2000));
    const arp = await _readArpMap().catch(() => new Map());   // ip -> mac (comunicazioni recenti)
    const TCP_PORTS = [{ port: 80, service: 'http' }, { port: 443, service: 'https' },
                       { port: 22, service: 'ssh' }, { port: 23, service: 'telnet' }];

    const checkOne = async (ip) => {
      // 1) ARP: già visto a L2 di recente → presente (anche se blocca ICMP)
      if (arp.has(ip)) return { ip, alive: true, via: 'arp' };
      // 2) ICMP ping con ritentativo (popola anche l'ARP, riletto a fine sweep per il MAC).
      // Ritenta: un device flaky che perde il 1° ICMP non deve risultare "assente".
      if (await _pingHostRetry(ip, pingMs, 2)) return { ip, alive: true, via: 'ping' };
      // 3) Fallback TCP: device che bloccano ICMP ma hanno web/mgmt aperto
      for (const def of TCP_PORTS) {
        if (await _tcpProbe(ip, def, Math.min(pingMs, 800))) return { ip, alive: true, via: 'tcp:' + def.port };
      }
      return { ip, alive: false, via: '' };
    };

    const results = {};
    const CONC = 24;
    for (let i = 0; i < list.length; i += CONC) {
      const part = await Promise.all(list.slice(i, i + CONC).map(checkOne));
      for (const r of part) results[r.ip] = { alive: r.alive, via: r.via, mac: '' };
    }
    // Ri-leggo l'ARP DOPO la sweep: ping/TCP hanno popolato la cache, così ho il
    // MAC anche dei device appena raggiunti. Serve all'audit per riconoscere un
    // device che ha cambiato IP (stesso MAC) e per la presenza per-MAC.
    const arp2 = await _readArpMap().catch(() => arp);
    for (const ip of Object.keys(results)) {
      if (results[ip].alive) results[ip].mac = arp2.get(ip) || arp.get(ip) || '';
    }
    // Tabella ARP COMPLETA del segmento (tutti gli ip→mac noti all'OS): serve a
    // riconoscere un device che ha CAMBIATO IP (stesso MAC ora a un IP NUOVO,
    // non documentato → non l'avremmo pingato). Cap difensivo.
    const arpTable = {};
    let cap = 0;
    for (const [ip, mac] of arp2) { if (cap++ >= 2048) break; if (mac && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) arpTable[ip] = mac; }
    const aliveCount = Object.values(results).filter(r => r.alive).length;
    console.log(`  [REACH] ${list.length} IP verificati, ${aliveCount} raggiungibili, ${Object.keys(arpTable).length} in ARP`);
    res.json({ ok: true, results, arpTable });
  } catch (err) {
    res.json({ ok: false, error: err?.message || String(err) });
  }
});

// ---- DHCP: pull LIVE dei lease dall'API del vendor (Fase 2, driver-pack) -----
// Gira lato server (il browser non raggiunge il firewall). Le credenziali sono
// d'uso singolo (non persistite). Stesso schema della Fase 1 → reconcile identico.
router.get('/api/dhcp-drivers', auth.requireAdmin, (req, res) => {
  res.json({ ok: true, drivers: dhcpDrivers.listDrivers() });
});
router.post('/api/dhcp-leases', auth.requireAdmin, async (req, res) => {
  try {
    const { vendor, ...cfg } = req.body ?? {};
    const out = await dhcpDrivers.fetchLeases(String(vendor || ''), cfg);
    console.log(`  [DHCP] ${vendor}@${cfg.host}: ${out.count} lease`);
    res.json({ ok: true, format: 'api:' + out.vendor, leases: out.leases, count: out.count });
  } catch (err) {
    res.json({ ok: false, error: err?.message || String(err) });
  }
});

// ---- Network auto-discovery (subnet scan via SNMP probe) --------------------

router.post('/api/discover', auth.requireAdmin, async (req, res) => {
  try {
    const {
      subnet, driver, community, port, timeout, concurrency,
      safeMode = true, detectWeb = true, detectDns = true, detectSnmp = true,
      deepScan = false, ...v3
    } = req.body ?? {};
    const drv = DRIVERS[(driver || 'snmp-v2c').toLowerCase()];

    let ips;
    try { ips = expandSubnet(subnet); }
    catch(e) { return res.json({ ok: false, error: e.message }); }

    const safe = String(safeMode) !== 'false';
    const defaultConc = safe ? 32 : 64;
    const maxConc = safe ? 48 : 96;
    const CONC = Math.min(parseInt(concurrency) || defaultConc, maxConc);
    const interBatchDelayMs = safe ? 40 : 0;
    const reqTimeoutMs = Math.max(500, Math.min(parseInt(timeout || 2, 10) * 1000, 4000));
    const pingTimeoutMs = safe ? Math.min(reqTimeoutMs, 700) : Math.min(reqTimeoutMs, 500);
    // Ritentativi ping: DEFAULT 1 (ping singolo, come nmap/fping — 1 giro veloce).
    // Il ping-multiplo spaziato costava ~pingTries×timeout su OGNI ip morto di una /24
    // (≈2× lo sweep → timeout lato client) senza portare valore: su una LAN la presenza
    // autorevole e' l'ARP (vedi passo 2, un host on-segment che perde l'ICMP viene
    // comunque marcato alive dalla sua voce ARP), non il martellamento ICMP. Resta
    // opt-in via `pingRetries` (1-4) per path patologici (es. lab cross-subnet
    // rate-limited dove l'ARP-SNMP non copre).
    const pingTries = Math.max(1, Math.min(parseInt(req.body?.pingRetries, 10) || 1, 4));
    // Modalita' STEALTH (anti-IDS): OPT-IN, default OFF → comportamento veloce invariato.
    // SERIALIZZA la base sweep (concorrenza 1) e distanzia i probe con JITTER, cosi' il
    // packet-rate non fa un picco e non scattano le soglie rate-based dell'IDS (profilo
    // "polite"/T2 di nmap). Vale SOLO per la base sweep di IP SCONOSCIUTI — la fase con
    // firma di scansione; il crawl/deep su device gia' noti resta parallelo (CRAWL_POOL),
    // che non e' una firma. Attivabile con { stealth:true } o { scanDelay:<ms> }.
    const stealth = String(req.body?.stealth) === 'true' || parseInt(req.body?.scanDelay, 10) > 0;
    const scanDelayMs = stealth ? Math.max(50, Math.min(parseInt(req.body?.scanDelay, 10) || 400, 5000)) : 0;
    // Concorrenza del base sweep. Furtiva = 1 (serializzato, uccide la firma di rate).
    // Normale/Sicura usano CONC, che e' GIA' scalato da `safe` (defaultConc 32 vs 64,
    // maxConc 48 vs 96, + interBatchDelayMs 40) -> la "concorrenza ridotta" di Sicura e'
    // gia' onorata a monte; NON ri-dimezzare qui (sarebbe over-throttle).
    const sweepConc = stealth ? 1 : CONC;
    const total = ips.length;
    // Furtiva: ordine di scansione RANDOMIZZATO. L'ordine sequenziale (.1,.2,.3...) e'
    // una firma di sweep quanto il timing fisso -> lo mescoliamo. Le righe restano
    // indicizzate per IP (output ordinato); cambia solo la SEQUENZA dei probe.
    const sweepOrder = stealth ? _shuffled(ips) : ips;
    const rows = ips.map(ip => ({
      ip,
      alive: false,
      pingReachable: false,
      status: 'Inattivo',
      hostname: '',
      descr: '',
      objectId: '',
      snmpReachable: false,
      snmpDriver: '',
      snmpVersions: [],          // TUTTE le versioni SNMP a cui il device risponde
      needsCredentials: false,   // v3 rilevato senza credenziali (da configurare)
      mac: '',
      vendor: '',
      httpTitle: '',
      httpsTitle: '',
      services: [],
      netbiosName: '',
      netbiosGroup: '',
      smbShares: [],
      cast: false,
    }));

    // 1) Ping sweep (stealth → serializzato + scan-delay con jitter; altrimenti a batch)
    for (let i = 0; i < total; i += sweepConc) {
      const batch = sweepOrder.slice(i, i + sweepConc);
      const results = await Promise.all(batch.map(ip => _pingHostRetry(ip, pingTimeoutMs, pingTries).catch(() => false)));
      results.forEach((ok, idx) => {
        const ip = batch[idx];
        const row = rows.find(r => r.ip === ip);
        if (!row) return;
        row.pingReachable = !!ok;
        row.alive = !!ok;
        row.status = ok ? 'On' : 'Inattivo';
      });
      if (i + sweepConc < total) {
        const gap = stealth
          ? _stealthDelayMs(scanDelayMs, 0.3)                                   // anti-IDS: ritardo jitterato
          : (interBatchDelayMs > 0 ? interBatchDelayMs + Math.floor(Math.random() * 60) : 0);
        if (gap > 0) await new Promise(r => setTimeout(r, gap));
      }
    }

    // 2) ARP/MAC+Vendor (passivo)
    let arpMap = new Map();
    try { arpMap = await _readArpMap(); }
    catch (e) { console.warn(`  [DISCOVER] ARP non disponibile: ${e.message}`); }
    const localIfaces = _readLocalInterfaceMap();
    rows.forEach(r => {
      const mac = arpMap.get(r.ip) || localIfaces.get(r.ip) || '';
      if (mac) {
        r.mac = mac;
        r.vendor = _vendorByMac(mac);
        // ARP autorevole (come nmap sulla LAN): un host on-segment con voce ARP locale
        // HA risposto all'ARP → e' presente sul filo anche se ha perso l'ICMP (ping
        // singolo, o host con ICMP filtrato/flaky). Lo marchiamo alive SENZA fingere un
        // ping: `pingReachable` resta false → niente evidenza ICMP, la presenza pesa
        // come ARP nello scoring. Cross-subnet la cache ARP locale contiene solo il
        // gateway (non i singoli host) → nessun falso positivo off-segment.
        if (!r.alive) { r.alive = true; r.status = 'On'; r.viaArp = true; }
      }
    });

    // 2b) mDNS (DNS-SD) + SSDP (UPnP) — OPT-IN. Sweep multicast del SEGMENTO LOCALE che
    // fa emergere i device a PORTE CHIUSE (telefoni, tablet, elettrodomestici smart, TV,
    // speaker): ignorano ping/SNMP/porte di gestione ma si ANNUNCIANO in multicast. Il
    // SERVIZIO pubblicato È il tipo (vendor-neutral) -> tipo+marca+modello MISURATI in
    // row.mdns, letti dal classificatore. Solo IP nel range scansionato (il multicast è
    // link-local: nessun risultato cross-subnet, onesto per design). Additivo, difensivo.
    const useMdns = String(req.body?.mdns) === 'true' || req.body?.mdns === true;
    if (useMdns) {
      try {
        const scannedSet = new Set(ips);
        const mdnsDeadline = stealth ? 4000 : (safe ? 3000 : 2500);
        const mdnsFound = await _mdnsSsdpSweep({ deadlineMs: mdnsDeadline });
        let mdnsN = 0;
        for (const [ip, identity] of mdnsFound) {
          if (!scannedSet.has(ip)) continue;              // solo il range richiesto (link-local)
          const row = rows.find(r => r.ip === ip);
          if (!row) continue;
          row.mdns = identity;
          if (identity.host && !row.hostname) row.hostname = _cleanHostname(identity.host);
          if (identity.manufacturer && !row.vendor) row.vendor = identity.manufacturer;
          if (!row.alive) { row.alive = true; row.status = 'On'; row.viaMdns = true; }
          mdnsN++;
        }
        if (mdnsN) console.log(`  [DISCOVER] ${subnet}: mDNS/SSDP ha annunciato ${mdnsN} device`);
      } catch (e) { console.warn(`  [DISCOVER] mDNS/SSDP: ${e.message}`); }
    }

    // 3) Enrichment solo sui candidati: ping OK o MAC visto in ARP.
    // Questo evita che una /24 resti bloccata per minuti su IP inesistenti.
    const scanRows = rows.filter(r => r.alive || r.mac);
    // Furtiva: stessa cura del ping sweep anche sull'arricchimento (una GET SNMP UDP 161
    // + probe TCP/DNS per candidato = anch'esso uno sweep). Serializza (conc 1), ordine
    // RANDOMIZZATO e pacing jitterato tra gli host -> niente seconda firma sequenziale.
    const enrichConc = stealth ? 1 : (safe ? 8 : 16);
    const enrichOrder = stealth ? _shuffled(scanRows) : scanRows;
    for (let i = 0; i < enrichOrder.length; i += enrichConc) {
      const batch = enrichOrder.slice(i, i + enrichConc);
      await Promise.all(batch.map(async row => {
        try {
          const jobs = [];
          if (detectDns) {
            jobs.push((async () => {
              try {
                const names = await Promise.race([
                  dns.reverse(row.ip),
                  new Promise((_, rej) => setTimeout(() => rej(new Error('dns-timeout')), 700)),
                ]);
                if (Array.isArray(names) && names[0]) row.hostname = _cleanHostname(names[0]);
              } catch (_) {}
            })());
          }
          if (detectWeb) {
            // Base = probe web AGGRESSIVO: lo scan normale resta veloce. I web server
            // embedded lenti (UPS/NAS/switch) che qui rispondono oltre soglia vengono
            // ri-provati con piu' pazienza in DEEP-SCAN (opt-in), non nel fast path.
            jobs.push(_httpProbe(row.ip, false, safe ? 650 : 450).then(v => { row.httpTitle = v; }).catch(() => {}));
            jobs.push(_httpProbe(row.ip, true, safe ? 650 : 450).then(v => { row.httpsTitle = v; }).catch(() => {}));
          }
          if (detectSnmp && drv?.probe) {
            jobs.push((async () => {
              try {
                const sn = await drv.probe({
                  driver: driver || 'snmp-v2c',
                  host: row.ip,
                  community: community || 'public',
                  port: port || 161,
                  timeout: Math.max(1, Math.min(parseInt(timeout || 2, 10), 2)),
                  ...v3,
                });
                if (sn?.reachable) {
                  row.snmpReachable = true;
                  row.descr = sn.descr || row.descr;
                  row.objectId = sn.objectId || row.objectId;
                  row.sysServices = parseInt(sn.sysServices || 0, 10) || 0;
                  if (sn.model) row.snmpModel = String(sn.model).trim();   // ENTITY-MIB modello esatto
                  row.snmpDriver = sn.driverUsed || row.snmpDriver;
                  row.snmpVersions = Array.isArray(sn.snmpVersions) ? sn.snmpVersions : (sn.driverUsed ? [sn.driverUsed] : []);
                  row.needsCredentials = !!sn.needsCredentials;
                  row.hostname = row.hostname || _cleanHostname(sn.hostname || '');
                  row.alive = true;
                  row.status = 'On';
                }
              } catch (_) {}
            })());
          }
          await Promise.all(jobs);
          if (row.httpTitle || row.httpsTitle) {
            row.alive = true;
            row.status = 'On';
          }
          if (!row.alive && row.mac) {
            // presenza in ARP locale: forte indizio di host presente di recente
            row.status = 'Inattivo';
          }
        } catch (e) {
          console.warn(`  [DISCOVER] enrichment ${row.ip}: ${e.message}`);
        }
      }));
      if (stealth && i + enrichConc < enrichOrder.length) {
        const gap = _stealthDelayMs(scanDelayMs, 0.3);   // anti-IDS: pacing jitterato tra host
        if (gap > 0) await new Promise(r => setTimeout(r, gap));
      }
    }

    const useDeepScan = String(deepScan) === 'true' || deepScan === true;

    // Nome dell'HOST LOCALE (la macchina che esegue InfraNet): `nbtstat -A` sul PROPRIO
    // IP fallisce ("Host non trovato") -> il nome del computer locale si prende da
    // os.hostname(). Nessun probe di rete: vale in OGNI cadenza e su ogni OS.
    {
      const localName = _cleanHostname(os.hostname() || '');
      if (localName) for (const r of rows) {
        if (r.alive && !r.hostname && localIfaces.has(r.ip)) r.hostname = localName;
      }
    }

    // Risoluzione nomi NetBIOS — SOLO in modalita' NORMALE (veloce) e senza deep-scan
    // (il deep-scan fa gia' nbtstat). Un PC Windows non parla SNMP ne' quasi mai annuncia
    // il nome via mDNS: `nbtstat -A` e' l'unica fonte affidabile del nome. Aggiunge pero'
    // una firma NetBIOS al footprint -> OFF nelle cadenze anti-IDS (Sicura/Furtiva).
    // Solo host VIVI ancora SENZA nome; solo se il server e' Windows (nbtstat esiste li').
    if (!safe && !useDeepScan && os.platform() === 'win32') {
      const nameTargets = rows.filter(r => r.alive && !r.hostname);
      const NBCONC = 12;   // veloce, in parallelo (coerente con "Normale")
      for (let i = 0; i < nameTargets.length; i += NBCONC) {
        await Promise.all(nameTargets.slice(i, i + NBCONC).map(async row => {
          try {
            const nb = await _netbiosProbe(row.ip);
            if (nb && nb.name) {
              row.netbiosName = nb.name;
              row.hostname = _cleanHostname(nb.name);
              if (nb.group) row.netbiosGroup = nb.group;
              if (nb.smbServer) row.netbiosServer = true;
              if (Array.isArray(nb.records) &&
                  nb.records.some(rc => rc.suffix === '1B' || (rc.suffix === '1C' && rc.kind === 'group')))
                row.netbiosDomainCtrl = true;
              if (!row.mac && nb.mac) row.mac = nb.mac;
            }
          } catch (_) {}
        }));
      }
    }

    if (useDeepScan && scanRows.length) {
      const deepConc = stealth ? 1 : (safe ? 3 : 6);   // stealth: deep-scan serializzato
      const deepTimeoutMs = safe ? 850 : 650;
      for (let i = 0; i < scanRows.length; i += deepConc) {
        const batch = scanRows.slice(i, i + deepConc);
        await Promise.all(batch.map(async row => {
          try {
            // Ri-prova web PAZIENTE (solo qui, in deep-scan): i web server embedded
            // (UPS Eaton, NAS LaCie, switch GS1200) rispondono lenti e il probe base
            // aggressivo puo' averli mancati. Piu' tempo -> titolo -> vendor+tipo. Solo
            // se il titolo manca ancora; gira in parallelo all'identity scan.
            const patientMs = safe ? 1200 : 900;
            const webJobs = [];
            if (detectWeb && !row.httpTitle) webJobs.push(_httpProbe(row.ip, false, patientMs).then(v => { if (v) row.httpTitle = v; }).catch(() => {}));
            if (detectWeb && !row.httpsTitle) webJobs.push(_httpProbe(row.ip, true, patientMs).then(v => { if (v) row.httpsTitle = v; }).catch(() => {}));
            const [deep] = await Promise.all([_deepIdentityScanHost(row.ip, safe, deepTimeoutMs), ...webJobs]);
            if (row.httpTitle || row.httpsTitle) { row.alive = true; row.status = 'On'; }
            const services = deep.services || [];
            if (services.length) {
              row.services = services;
              row.alive = true;
              row.status = 'On';
            }
            if (deep.netbios) {
              row.netbiosName = deep.netbios.name || row.netbiosName || '';
              row.netbiosGroup = deep.netbios.group || row.netbiosGroup || '';
              // Segnale di RUOLO NetBIOS per la classificazione: <20> (Server service =
              // file/print sharing attivo) e <1B>/<1C> (Domain (Controller)). Prima
              // veniva parsato ma SCARTATO — ora arriva al classificatore per distinguere
              // host Windows (pc/server) dagli apparati di rete. Vendor-neutral.
              if (deep.netbios.smbServer) row.netbiosServer = true;
              if (Array.isArray(deep.netbios.records) &&
                  deep.netbios.records.some(r => r.suffix === '1B' || (r.suffix === '1C' && r.kind === 'group')))
                row.netbiosDomainCtrl = true;
              if (!row.mac && deep.netbios.mac) row.mac = deep.netbios.mac;
              if (!row.hostname && deep.netbios.name) row.hostname = _cleanHostname(deep.netbios.name);
              row.alive = true;
              row.status = 'On';
            }
            if (Array.isArray(deep.smbShares) && deep.smbShares.length) {
              row.smbShares = deep.smbShares;
              row.alive = true;
              row.status = 'On';
            }
            if (deep.cast && deep.cast.cast) {
              // Confermato device Google Cast (protocollo, vendor-neutral): media
              // player / TV. Il nome "friendly" del device diventa hostname se manca.
              row.cast = true;
              if (deep.cast.name && !row.hostname) row.hostname = _cleanHostname(deep.cast.name);
              row.alive = true;
              row.status = 'On';
            }
          } catch (e) {
            console.warn(`  [DISCOVER] deep ${row.ip}: ${e.message}`);
          }
        }));
        if (safe && i + deepConc < scanRows.length) {
          await new Promise(r => setTimeout(r, 80 + Math.floor(Math.random() * 80)));
        }
      }
    }

    // Declassa i duplicati ARP stantii: una riga viva SOLO via ARP-autorevole il cui
    // MAC e' gia' vivo (ping/snmp) o in un lease DHCP a un ALTRO IP e' lo stesso device
    // visto a un IP vecchio (es. cambio IP DHCP) -> torna "Inattivo" (resta visibile,
    // manual-first). Le voci morte senza MAC gia' non arrivano qui (netsh in _readArpMap).
    const _dhcpStrong = new Map();
    for (const l of (Array.isArray(req.body?.dhcpLeases) ? req.body.dhcpLeases : [])) {
      const mac = _normMac(String(l?.mac || '')); const ip = String(l?.ip || '').trim();
      if (mac && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && !_dhcpStrong.has(mac)) _dhcpStrong.set(mac, ip);
    }
    const _staleDup = _demoteStaleArpDup(rows, _dhcpStrong);
    if (_staleDup.length) console.log(`  [DISCOVER] ${subnet}: ${_staleDup.length} duplicati ARP stantii -> Inattivo`);

    const results = rows
      .filter(r => r.alive || r.mac || r.hostname || r.httpTitle || r.httpsTitle || r.snmpReachable || r.netbiosName || (r.services && r.services.length) || (r.smbShares && r.smbShares.length) || r.mdns)
      .map(r => {
        const dec = _decorateDiscoveryRow(r);
        // Privacy (misurato != dichiarato): il classificatore ha GIA' consumato l'identita'
        // mDNS/SSDP completa DENTRO la decorazione, e host->hostname (ripulito) +
        // manufacturer->vendor sono gia' nei campi normali. Verso il client teniamo solo la
        // PROVENIENZA (tipo/servizi), non i NOMI dichiarati: un friendlyName UPnP o un TXT
        // possono contenere dati personali ("iPhone di Mario"). Non li esponiamo/salviamo.
        if (dec && dec.mdns) dec.mdns = publicMdns(dec.mdns);
        return dec;
      });

    // 4) DHCP come sorgente Scopri: i lease danno il binding IP<->MAC (+ hostname)
    // anche per host DORMIENTI (mobile/IoT in power-save) che ora non rispondono a
    // ping/ARP. Per ogni lease DENTRO la subnet scansionata e NON gia' trovato,
    // aggiungiamo una riga candidata decorata IDENTICA alle altre (vendor via OUI):
    // osservata, NON viva (manual-first, l'utente decide). Il frontend invia
    // store._dhcpLeases (import gratis incolla/file o pull live pack). Funziona
    // ANCHE a zero SNMP (rete dietro Synology/router). Vendor-neutral.
    const dhcpLeases = Array.isArray(req.body?.dhcpLeases) ? req.body.dhcpLeases : [];
    if (dhcpLeases.length) {
      const ipSet = new Set(ips);
      const haveIp = new Set(results.map(r => r.ip));
      let addedDhcp = 0;
      for (const lease of dhcpLeases) {
        const ip = String(lease?.ip || '').trim();
        const mac = String(lease?.mac || '').trim();
        if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) continue;
        if (!ipSet.has(ip) || haveIp.has(ip) || !mac) continue;
        haveIp.add(ip);
        results.push(_decorateDiscoveryRow(
          { ip, mac, hostname: _cleanHostname(lease.hostname || ''),
            alive: false, pingReachable: false, snmpReachable: false,
            status: 'Inattivo', dhcpLease: true },
          { viaProtocol: 'DHCP', viaFrom: lease.source || lease.subnet || '' }
        ));
        addedDhcp++;
      }
      if (addedDhcp) console.log(`  [DISCOVER] ${subnet}: +${addedDhcp} candidati da lease DHCP`);
    }

    const found = results.filter(r => r.alive).length;
    console.log(`  [DISCOVER] ${subnet}: scansionati ${total}, candidati ${results.length}, attivi ${found}, safe=${safe}, conc=${CONC}`);
    res.json({ ok: true, total, found, seen: results.length, results, safeMode: safe, concurrencyUsed: sweepConc, stealth, scanDelayMs });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`  [DISCOVER] errore non fatale: ${msg}`);
    console.error(err?.stack || err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: msg });
  }
});

// ---- Topology discovery (LLDP / CDP) ----------------------------------------
// Solo admin

router.post('/api/topology', auth.requireAdmin, async (req, res) => {
  const cfg    = req.body ?? {};
  const driver = (cfg.driver || '').toLowerCase();
  const drv    = DRIVERS[driver];

  if (!drv) {
    return res.json({ ok: false, error: `Driver non supportato: ${driver}` });
  }
  if (typeof drv.pollNeighbors !== 'function') {
    return res.json({ ok: false, error: `Driver non supporta topology: ${driver}` });
  }

  try {
    const data = await drv.pollNeighbors(cfg);

    // Correlazione topologica lato server: se il browser ha inviato il contesto
    // progetto (srcNodeId + projectNodes + projectPorts), calcola i candidati
    // LLDP/CDP + FDB + ARP/FDB e li aggiunge al payload come suggestedLinks.
    // Additivo e non-breaking: il browser usa suggestedLinks se presenti,
    // altrimenti continua con il matching client-side.
    if (cfg.srcNodeId &&
        Array.isArray(cfg.projectNodes) && cfg.projectNodes.length &&
        cfg.projectPorts && typeof cfg.projectPorts === 'object') {
      try {
        const portIndex = buildPortIndex(cfg.projectPorts, cfg.projectLagGroups || {});
        const macIndex  = buildMacIndex(cfg.projectNodes, cfg.projectPorts);
        const portMacIndex = buildPortMacIndex(cfg.projectPorts);
        const cset = buildNeighborCandidates(
          cfg.srcNodeId,
          data.neighbors || [],
          cfg.projectNodes,
          portIndex,
          macIndex
        );
        const fdbRes = buildFdbCandidates(
          cfg.srcNodeId,
          data.fdbTable || {},
          data.arpTable || {},
          cfg.projectNodes,
          portIndex,
          portMacIndex,
          { isVirtualMac: _isVirtualMac }
        );
        for (const sl of fdbRes.cset.values()) cset.add(sl.src, sl.dst, sl.confidence, sl.protocol);
        data.suggestedLinks = cset.values();
        if (fdbRes.sharedSegments.length) data.suggestedSharedSegments = fdbRes.sharedSegments;
        console.log(`  [TOPO] ${cfg.host}: ${(data.neighbors||[]).length} vicini → ${data.suggestedLinks.length} link suggeriti`);
      } catch (e) {
        console.warn(`  [TOPO] suggestedLinks error (${cfg.srcNodeId}): ${e.message}`);
      }
    }

    res.json({ ok: true, ...data });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`  [TOPO] ${driver} ${cfg.host}: ${msg}`);
    res.json({ ok: false, error: msg });
  }
});

// ---- Topology crawl - BFS via LLDP/CDP (SSE streaming) ---------------------
// Parte da un dispositivo seme e segue i link LLDP/CDP ricorsivamente.
// Usa Server-Sent Events per inviare aggiornamenti in tempo reale al client.
// Solo admin.

router.post('/api/discover/topology', auth.requireAdmin, async (req, res) => {
  const {
    seed, seeds: seedsArr,
    driver = 'snmp-v2c', community = 'public',
    port = 161, timeout = 3, maxDepth = 5, maxDevices = 100, scanCidr, ...v3
  } = req.body ?? {};

  const drv = DRIVERS[(driver || 'snmp-v2c').toLowerCase()];
  if (!drv) return res.status(400).json({ ok: false, error: 'Driver non supportato' });

  // Accetta seeds[] (multi-source) o seed (singolo) - backward compatible
  const seeds = (Array.isArray(seedsArr) ? seedsArr : [seed])
    .map(s => (s || '').trim())
    .filter(s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s));
  if (seeds.length === 0) return res.status(400).json({ ok: false, error: 'Nessun IP seme valido' });

  // --- SSE headers ---
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let aborted = false;
  // Disconnessione del client → stop. Si ascolta su `res` (ciclo di vita della RISPOSTA
  // SSE), NON su `req`: `req.on('close')` scatta gia' quando il body della richiesta e'
  // stato consumato (client ancora connesso) → falso abort che troncava il crawl al 1o
  // livello. `res.on('close')` scatta solo alla reale chiusura della connessione.
  res.on('close', () => { aborted = true; });

  // Heartbeat ogni 15 s per evitare timeout di proxy intermedi
  const hb = setInterval(() => { if (!aborted) res.write(':hb\n\n'); }, 15000);

  const send = obj => { if (!aborted) res.write(`data: ${JSON.stringify(obj)}\n\n`); };

  const cfg      = { driver, community, port, timeout, ...v3 };
  // ARP-SNMP: raccogliamo la ipNetToMediaTable di OGNI device SNMP del crawl per
  // proporre gli host visti a L2/L3 ma MUTI a ping/SNMP/LLDP (VPCS, off-segment).
  // Attivo SOLO se il client passa la subnet scansionata (`scanCidr`) → filtro
  // anti-rumore: si propongono solo IP dentro quella subnet (niente dump ARP di
  // un core-router). Vive dentro il crawl → gia' gated dal toggle "Espandi LLDP/CDP".
  let scanSet = null;
  try { if (scanCidr) scanSet = new Set(expandSubnet(scanCidr)); }
  catch (_) { scanSet = null; }

  // Fase deep/neighbor: BFS livello-sincrono con pool bounded (server/crawl-bfs.js).
  // La scansione BASE degli host resta altrove (sequenziale/anti-IDS); qui si
  // interrogano SOLO device gia' scoperti e autenticati. Determinismo garantito
  // (barriera + ordine IP): pool=1 e pool=N danno lo STESSO risultato (provato in
  // test/crawl-bfs.test.js). Le fasi ARP-SNMP e macsuck qui sotto lavorano su cio'
  // che crawlNetwork restituisce (results/arpTables/fdbTables/visited).
  let crawlOut;
  try {
    crawlOut = await crawlNetwork({
      seeds, maxDepth, maxDevices, pool: CRAWL_POOL, collectArp: !!scanSet,
      probe: ip => drv.probe({ ...cfg, host: ip }),
      pollNeighbors: ip => drv.pollNeighbors({ ...cfg, host: ip }),
      decorate: _decorateDiscoveryRow,
      emit: send,
      isAborted: () => aborted,
    });
  } finally {
    clearInterval(hb);
  }
  const { results, arpTables, fdbTables, visited } = crawlOut;

  // --- ARP-SNMP: proponi gli host off-segment visti nelle ARP raccolte ---------
  // Host presenti nell'ARP di uno switch/router SNMP ma non trovati via SNMP/LLDP:
  // il loro IP+MAC (quindi il vendor OUI) e' noto senza ICMP. Bassa confidenza,
  // osservati, mai pre-selezionati (lo decide il client). Dedup + cap anti-rumore.
  if (scanSet && arpTables.length && !aborted) {
    const knownIps = new Set(visited);
    for (const r of results) { if (r && r.ip) knownIps.add(r.ip); }
    // Subnet ON-SEGMENT del collector: li' la sua ARP LOCALE e' autorevole, quindi
    // NON si resuscitano IP morti dall'ARP (spesso stantia) di un NAS/router on-segment
    // (es. la ipNetToMediaTable di una Synology piena di voci dormienti). L'ARP-SNMP
    // resta per gli host OFF-SEGMENT, il suo scopo.
    let localSubnets = null;
    try {
      const loc = _readLocalInterfaceMap();
      localSubnets = new Set();
      for (const lip of loc.keys()) {
        const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\./.exec(lip);
        if (m) localSubnets.add(m[1]);
      }
    } catch (_) { localSubnets = null; }
    const arpMap = new Map();   // ip -> { ip, mac, viaFrom } (dedup cross-device)
    for (const { table, fromIp } of arpTables) {
      for (const c of buildArpCandidates(table, { scanSet, knownIps, fromIp, localSubnets })) {
        if (!arpMap.has(c.ip)) arpMap.set(c.ip, c);
      }
    }
    const CAP = 256;
    const total = arpMap.size;
    let list = [...arpMap.values()];
    const truncated = list.length > CAP;
    if (truncated) list = list.slice(0, CAP);
    for (const c of list) {
      if (aborted) break;
      const device = _decorateDiscoveryRow(
        { ip: c.ip, mac: c.mac, snmpReachable: false, alive: false,
          viaProtocol: 'ARP', viaFrom: c.viaFrom },
        { viaProtocol: 'ARP', viaFrom: c.viaFrom }
      );
      results.push(device);
      send({ type: 'arp', device, from: c.viaFrom });
    }
    console.log(`  [CRAWL] ARP-SNMP: ${total} candidati off-segment in ${scanCidr}${truncated ? ` (mostrati i primi ${CAP})` : ''}`);
    if (truncated) send({ type: 'warn', message: `ARP: ${total} host visti, mostrati i primi ${CAP}` });
  }

  // --- macsuck: localizza i MAC scoperti sulla loro porta di accesso -----------
  // Dalla FDB raccolta: per ogni MAC noto (device del crawl + candidati ARP +
  // gli host gia' scoperti dal client via sweep, passati come targetMacs) trova
  // la porta edge (min MAC co-appresi = accesso; uplink/trunk scartati). UN solo
  // evento 'located' → il client applica l'edge a TUTTE le sue righe, comprese
  // quelle dello sweep on-segment. Manual-first: e' un indizio, non un cavo.
  if (fdbTables.length && !aborted) {
    const targets = new Set();
    for (const r of results) {
      const m = String((r && r.mac) || '').trim().toLowerCase();
      if (m) targets.add(m);
    }
    const bodyMacs = Array.isArray(req.body?.targetMacs) ? req.body.targetMacs : [];
    for (const m of bodyMacs) {
      const mm = String(m || '').trim().toLowerCase();
      if (mm) targets.add(mm);
    }
    const edges = locateMacsOnEdge(fdbTables, {
      targets: targets.size ? targets : null,
      isVirtualMac: _isVirtualMac,
    });
    const located = Object.keys(edges).length;
    if (located) send({ type: 'located', edges });
    console.log(`  [CRAWL] macsuck: ${located} MAC localizzati su porta da ${fdbTables.length} switch`);
  }

  send({ type: 'done', total: results.length, results });
  res.end();
});

module.exports = router;
