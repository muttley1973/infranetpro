'use strict';
// ============================================================
//  Primitive di rete e discovery a basso livello
//  (ping, ARP, vendor OUI, probe TCP/HTTP/NetBIOS/SMB).
//  Estratto da server.js senza modifiche di logica.
// ============================================================
const os    = require('os');
const http  = require('http');
const https = require('https');
const net   = require('net');
const dgram = require('dgram');
const { execFile } = require('child_process');
const {
  buildMdnsQuery, buildSsdpQuery, buildWsDiscoveryProbe, buildOnvifGetDeviceInfo,
  aggregateSweep, parseSsdpResponse, parseWsDiscovery,
  MDNS_ADDR, MDNS_PORT, SSDP_ADDR, SSDP_PORT, WSD_ADDR, WSD_PORT, MDNS_DEFAULT_QUERIES,
} = require('../lib/discovery-mdns');

// ---- Subnet expansion -------------------------------------------------------

function expandSubnet(input) {
  const str = (input || '').trim();

  // CIDR: 192.168.1.0/24
  const cidr = str.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (cidr) {
    const parts  = cidr[1].split('.').map(Number);
    if (parts.some(p => p < 0 || p > 255)) throw new Error('IP non valido');
    const prefix = parseInt(cidr[2]);
    if (prefix < 16 || prefix > 30)  throw new Error('Prefisso /16 - /30 supportato');
    const count = (1 << (32 - prefix)) - 2;
    if (count > 1024) throw new Error('Massimo 1024 host per scansione');
    const base = ((parts[0]<<24)|(parts[1]<<16)|(parts[2]<<8)|parts[3]) >>> 0;
    const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
    const net  = (base & mask) >>> 0;
    const ips  = [];
    for (let i = 1; i <= count; i++) {
      const n = (net + i) >>> 0;
      ips.push([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255].join('.'));
    }
    return ips;
  }

  // Range semplice: 192.168.1.1-254
  const range = str.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})-(\d{1,3})$/);
  if (range) {
    if (range[1].split('.').some(p => p !== '' && parseInt(p, 10) > 255)) throw new Error('IP non valido');
    const from = parseInt(range[2]), to = parseInt(range[3]);
    if (from > to || to > 254) throw new Error('Range non valido');
    if (to - from + 1 > 1024)  throw new Error('Massimo 1024 host per scansione');
    const ips = [];
    for (let i = from; i <= to; i++) ips.push(range[1] + i);
    return ips;
  }

  // IP singolo
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(str)) return [str];

  throw new Error('Formato non valido. Usa: 192.168.1.0/24 oppure 192.168.1.1-254');
}

function _execFileAsync(cmd, args, timeoutMs = 2500) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || ''), error });
    });
  });
}

// Decide se un risultato di `ping` indica un host DAVVERO vivo (task_977d2930).
// PERCHE' l'exit code NON basta: su Windows `ping.exe` restituisce exit code 0 anche
// quando un ROUTER intermedio risponde "Destination host unreachable" / "TTL expired"
// al posto del target -> l'host e' morto ma `!error` direbbe vivo (FALSO POSITIVO nello
// sweep, tipico scansionando una subnet instradata dietro un gateway). Un ECHO REPLY
// genuino contiene SEMPRE il "TTL=" nel testo, su OGNI OS e lingua (NON localizzato
// nemmeno su Windows IT: "byte=32 durata=1ms TTL=64"); gli errori ICMP intermedi NON
// hanno il TTL ("Host di destinazione non raggiungibile", "Destination host unreachable").
// Quindi:
//  - Windows: ci fidiamo SOLO della presenza dell'echo reply (TTL), MAI dell'exit code.
//  - Linux/macOS: l'exit code e' affidabile (unreachable -> exit != 0) -> lo teniamo,
//    col marker del reply come fallback (comportamento storico invariato).
function _pingResultIsAlive(platform, r) {
  const out = (String((r && r.stdout) || '') + '\n' + String((r && r.stderr) || '')).toLowerCase();
  const gotEcho = out.includes('ttl=') || out.includes('bytes from')
    || out.includes('1 received') || out.includes('1 packets received');
  if (platform === 'win32') return gotEcho;   // exit code inaffidabile su Windows
  return !!(r && r.ok) || gotEcho;
}

async function _pingHost(ip, timeoutMs = 800) {
  const plat = os.platform();
  timeoutMs = Math.max(250, Math.min(parseInt(timeoutMs || 800, 10), 1500));
  // Unità di timeout di `ping` diverse per OS — sbagliarle azzera la rilevazione:
  //  • Windows  : '-w' in MILLISECONDI
  //  • macOS/BSD: '-W' in MILLISECONDI
  //  • Linux    : '-W' in SECONDI
  // Passare i secondi anche su macOS dava ~1 ms di attesa → host con RTT > 1 ms non
  // rilevati (es. trovata una sola di due webcam identiche). Quindi differenziamo per OS.
  let args;
  if (plat === 'win32')        args = ['-n', '1', '-w', String(timeoutMs), ip];
  else if (plat === 'darwin')  args = ['-c', '1', '-W', String(timeoutMs), ip];
  else                         args = ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), ip];
  const r = await _execFileAsync('ping', args, timeoutMs + 500);
  return _pingResultIsAlive(plat, r);
}

// Ping con ritentativo SPAZIATO: un host puo' perdere il PRIMO ICMP (VPCS, stack lenti,
// link congestionati, host che risvegliano l'ARP del gateway) → il singolo ping darebbe
// un FALSO negativo e l'host verrebbe mancato. Ritenta fino a `tries` volte, VIVO se ANCHE
// UNO risponde. Vendor-neutral: non e' specifico di un device — chiude i falsi negativi
// da perdita ICMP su qualunque host.
//
// SPAZIATURA (`gapMs`): la perdita ICMP su path lenti/rate-limited arriva a RAFFICHE
// (finestre di perdita correlate), quindi due ping ravvicinati cadono nella STESSA
// finestra e falliscono INSIEME — un ritento back-to-back e' quasi inutile. Misurato
// dal vivo: 2 ping immediati falliscono ENTRAMBI ~27% delle volte, ma spaziati di ~0.4s
// rispondono sempre. Una piccola pausa fa cadere il ritento FUORI dalla finestra. Costo
// SOLO sugli host che hanno gia' mancato il 1o tentativo (vivi flaky + morti), mai su un
// host che risponde subito. `_ping` e `_sleep` sono iniettabili per i test.
async function _pingHostRetry(ip, timeoutMs = 800, tries = 2, _ping = _pingHost, gapMs = 200, _sleep = (ms) => new Promise(r => setTimeout(r, ms))) {
  const n = Math.max(1, Math.min(parseInt(tries, 10) || 1, 5));
  const gap = Math.max(0, Math.min(parseInt(gapMs, 10) || 0, 1000));
  for (let i = 0; i < n; i++) {
    if (i > 0 && gap > 0) await _sleep(gap);   // spaziatura fuori dalla finestra di perdita a raffica
    if (await _ping(ip, timeoutMs).catch(() => false)) return true;
  }
  return false;
}

// Pacing "stealth" anti-IDS per la base sweep: ritardo tra i probe con JITTER. Un intervallo
// FISSO e' esso stesso una firma rilevabile (cadenza regolare) → il jitter lo spezza. Usato
// insieme alla SERIALIZZAZIONE (concorrenza 1): il packet-rate non spike, quindi le soglie
// rate-based dell'IDS (sfPortscan/rate rule) non scattano — il profilo "polite"/T2 di nmap.
//   base = ms del ritardo · jitterPct = frazione 0..1 (default 0.3 = +/-30%) · rand iniettabile.
// Ritorna un intero >= 0 (0 se base<=0 → pacing disattivato = comportamento veloce invariato).
function _stealthDelayMs(base, jitterPct = 0.3, rand = Math.random) {
  const b = Math.max(0, parseInt(base, 10) || 0);
  if (!b) return 0;
  const j = Math.max(0, Math.min(Number.isFinite(+jitterPct) ? +jitterPct : 0.3, 1));
  const delta = b * j * (rand() * 2 - 1);   // +/- jitterPct attorno a base
  return Math.max(0, Math.round(b + delta));
}

// Ordine di scansione RANDOMIZZATO (Furtiva). Un ordine sequenziale (.1,.2,.3...) e'
// esso stesso una firma di sweep, esattamente come un timing fisso: un IDS/analista
// legge "scan" dal pattern di IP a prescindere dal jitter. Fisher-Yates; ritorna una
// COPIA (non muta l'input); `rand` iniettabile per i test deterministici.
function _shuffled(arr, rand = Math.random) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function _normMac(mac) {
  // Windows usa '-' come separatore. macOS/BSD `arp` invece stampa i MAC TOGLIENDO gli
  // zeri iniziali di ogni ottetto (es. "0:1c:42:8:b:9" per "00:1C:42:08:0B:09"): senza
  // ripristinare il padding a 2 cifre, su Mac quasi tutti i MAC verrebbero scartati e
  // quindi nessun vendor verrebbe riconosciuto (il vendor deriva dall'OUI del MAC).
  let m = String(mac || '').trim().replace(/-/g, ':');
  if (m.includes(':')) {
    const parts = m.split(':');
    if (parts.length === 6 && parts.every(p => /^[0-9a-fA-F]{1,2}$/.test(p))) {
      m = parts.map(p => p.padStart(2, '0')).join(':');
    }
  }
  m = m.toUpperCase();
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(m) ? m : '';
}

function _parseArpTable(text) {
  const map = new Map();
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const mWin = line.match(/^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F:-]{17})\s+\w+/);
    if (mWin) {
      const mac = _normMac(mWin[2]);
      if (mac) map.set(mWin[1], mac);
      continue;
    }
    // macOS/Linux: "? (192.168.0.1) at 0:1c:42:8:b:9 on en0 …" — su macOS gli ottetti
    // perdono gli zeri iniziali → lunghezza variabile (NON 17 fissi); _normMac ri-padda.
    const mNix = line.match(/\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+((?:[0-9a-fA-F]{1,2}:){5}[0-9a-fA-F]{1,2})/);
    if (mNix) {
      const mac = _normMac(mNix[2]);
      if (mac) map.set(mNix[1], mac);
    }
  }
  return map;
}

// Parsa "netsh interface ipv4 show neighbors" (Windows) tenendo SOLO le voci con un
// MAC valido nella colonna indirizzo-fisico. Le voci "Non raggiungibile"/"Incompleto"
// NON hanno un MAC (la colonna riporta lo stato localizzato) -> escluse SENZA matchare
// stringhe di stato localizzate (robusto per ogni lingua di Windows). Cosi' l'ARP-
// autorevole si fida solo delle presenze L2 REALI (Reachable/Stale), non delle voci
// morte che 'arp -a' trascina ancora col MAC stantio (falsi "Osservato" nello Scopri).
function _parseNeighbors(text) {
  const map = new Map();
  const MAC = /(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/;
  for (const line of String(text || '').split(/\r?\n/)) {
    const ipM = line.match(/^\s*(\d{1,3}(?:\.\d{1,3}){3})\s/);
    if (!ipM) continue;
    const macM = line.match(MAC);
    if (!macM) continue;                        // niente MAC = non raggiungibile/incompleta
    const mac = _normMac(macM[0]);
    if (!mac || mac === 'FF:FF:FF:FF:FF:FF' || mac === '00:00:00:00:00:00') continue;
    const ip = ipM[1];
    const first = parseInt(ip.split('.')[0], 10);
    if (first === 0 || first >= 224) continue;   // 0.x, multicast/broadcast (224-239, 255)
    if (ip.endsWith('.255')) continue;
    if (!map.has(ip)) map.set(ip, mac);
  }
  return map;
}

async function _readArpMap() {
  const isWin = os.platform() === 'win32';
  if (isWin) {
    // Preferisci 'netsh ... show neighbors' (ha lo STATO): scarta le voci morte che
    // 'arp -a' elenca ancora col MAC stantio -> niente falsi "Osservato" per IP che
    // non esistono piu'. Fallback a 'arp -a' solo se netsh manca/non da' nulla.
    try {
      const n = await _execFileAsync('netsh', ['interface', 'ipv4', 'show', 'neighbors'], 4000);
      const map = _parseNeighbors(n.stdout);
      if (map.size) return map;
    } catch (_) { /* fallback sotto */ }
    const r = await _execFileAsync('arp', ['-a'], 2500);
    return _parseArpTable(r.stdout);
  }
  const r = await _execFileAsync('arp', ['-an'], 2500);
  return _parseArpTable(r.stdout);
}

// Declassa le righe vive SOLO via ARP-autorevole (viaArp, senza ping/snmp) il cui MAC
// e' gia' presente su un'altra riga con presenza FORTE (ping/snmp) o in un lease DHCP,
// a un IP DIVERSO: e' lo stesso device visto a un IP stantio (es. cambio IP DHCP) ->
// il duplicato e' un fantasma. Puro: corregge solo i flag di presenza (alive/status),
// non cancella la riga (manual-first: resta visibile, "Inattivo", non pre-selezionata).
// `strongByMac` (opz.) = Map(macNormalizzato -> ip) da fonti forti esterne (lease DHCP).
function _ipToNum(ip) {
  const p = String(ip || '').split('.');
  if (p.length !== 4) return -1;
  let n = 0;
  for (const o of p) { const v = parseInt(o, 10); if (!(v >= 0 && v <= 255)) return -1; n = n * 256 + v; }
  return n;
}

function _demoteStaleArpDup(rows, strongByMac) {
  const strong = new Map(strongByMac || []);
  for (const r of (rows || [])) {
    if ((r.pingReachable || r.snmpReachable) && r.mac && !strong.has(r.mac)) strong.set(r.mac, r.ip);
  }
  const demoted = [];
  const isArpOnly = r => r.viaArp && !r.pingReachable && !r.snmpReachable && r.mac;
  // Pass 1 — ancoraggio forte: il MAC e' vivo (ping/snmp) o in un lease DHCP a un ALTRO
  // IP -> la riga ARP-only e' una voce di cache stantia dello stesso device -> Inattivo.
  for (const r of (rows || [])) {
    if (isArpOnly(r)) {
      const strongIp = strong.get(r.mac);
      if (strongIp && strongIp !== r.ip) {
        r.alive = false; r.status = 'Inattivo'; r.staleArpDup = true;
        demoted.push(r.ip);
      }
    }
  }
  // Pass 2 — doppio-fantasma: lo STESSO MAC compare su piu' righe ARP-only e NESSUN
  // ancoraggio forte esiste (ne' ping/snmp ne' DHCP). E' la stessa scheda vista a IP
  // diversi (tipico rinnovo DHCP con cache ARP stantia; frequente su MAC randomizzati/
  // BYOD e mobile). Ne teniamo UNA (IP piu' alto = deterministico, tipico dell'ultima
  // assegnazione) e declassiamo le altre a Inattivo -> niente doppioni "score basso".
  // Manual-first: restano visibili, l'utente puo' riattivarle.
  const groups = new Map();
  for (const r of (rows || [])) {
    if (!r.alive || r.staleArpDup || !isArpOnly(r) || strong.has(r.mac)) continue;
    if (!groups.has(r.mac)) groups.set(r.mac, []);
    groups.get(r.mac).push(r);
  }
  for (const grp of groups.values()) {
    if (new Set(grp.map(r => r.ip)).size < 2) continue; // una sola riga (o stesso IP) -> lascia
    const winner = grp.reduce((a, b) => (_ipToNum(b.ip) > _ipToNum(a.ip) ? b : a));
    for (const r of grp) {
      if (r === winner) continue;
      r.alive = false; r.status = 'Inattivo'; r.staleArpDup = true;
      demoted.push(r.ip);
    }
  }
  return demoted;
}

function _readLocalInterfaceMap() {
  const map = new Map();
  const ifaces = os.networkInterfaces?.() || {};
  for (const entries of Object.values(ifaces)) {
    for (const it of entries || []) {
      if (!it || it.family !== 'IPv4' || it.internal) continue;
      const mac = _normMac(it.mac);
      if (it.address && mac) map.set(it.address, mac);
    }
  }
  return map;
}

const OUI_VENDOR = {
  'D4:1A:D1': 'Zyxel',
  '08:26:97': 'Zyxel',
  'BC:CF:4F': 'Zyxel',
  '50:68:12': 'Cisco',
  '50:F8:B7': 'Cisco',
  '50:7A:19': 'Cisco',
  '50:9D:DD': 'Cisco',
  '08:00:09': 'Hewlett Packard',
  'F4:39:09': 'Hewlett Packard',
  '18:60:24': 'Hewlett Packard',
  '00:0C:C1': 'Eaton',
  '00:11:32': 'Synology',
  'EC:71:DB': 'Reolink',
  '00:0C:29': 'VMware',
  '00:50:56': 'VMware',
  '00:D0:4B': 'LaCie',
  '00:1C:42': 'Parallels',
  'F4:F5:E8': 'Google',
  'FC:F1:52': 'Sony',
  '00:04:4B': 'NVIDIA',
  'F0:03:8C': 'AzureWave',
  '40:9F:38': 'AzureWave',
  '7C:D5:66': 'Amazon',
  '60:F6:77': 'Intel',
  '08:00:27': 'PCS Systemtechnik',
  'F4:BF:80': 'Huawei',
  '4C:BC:E9': 'LG Innotek',
  '88:46:04': 'Xiaomi',
  '4C:E0:DB': 'Xiaomi',
  'F4:60:E2': 'Xiaomi',
  'A4:50:46': 'Xiaomi',
  '58:FD:B1': 'LG',
};

function _vendorByMac(mac) {
  const m = _normMac(mac);
  if (!m) return '';
  return OUI_VENDOR[m.substring(0, 8)] || '';
}

function _extractTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([^<]{1,120})<\/title>/i);
  return m ? m[1].trim() : '';
}

function _httpProbe(ip, secure, timeoutMs) {
  const mod = secure ? https : http;
  return new Promise(resolve => {
    const req = mod.request({
      host: ip,
      port: secure ? 443 : 80,
      path: '/',
      method: 'GET',
      rejectUnauthorized: false,
      timeout: timeoutMs,
      headers: { 'User-Agent': 'InfranetPro/1.0' },
    }, res => {
      let raw = '';
      res.on('data', d => { if (raw.length < 4096) raw += d.toString('utf8'); });
      res.on('end', () => {
        const title = _extractTitle(raw) || String(res.headers.server || '').trim();
        resolve(title || '');
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.on('error', () => resolve(''));
    req.end();
  });
}

const DEEP_TCP_PORTS = [
  { port: 21, service: 'ftp', banner: true },
  { port: 22, service: 'ssh', banner: true },
  { port: 23, service: 'telnet', banner: true },
  { port: 25, service: 'smtp', banner: true },
  { port: 53, service: 'dns-tcp', banner: false },
  { port: 80, service: 'http', banner: false },
  { port: 443, service: 'https', banner: false },
  { port: 445, service: 'smb', banner: false },
  { port: 502, service: 'modbus', banner: false },
  { port: 554, service: 'rtsp', banner: true, send: 'OPTIONS / RTSP/1.0\r\nCSeq: 1\r\n\r\n' },
  { port: 631, service: 'ipp', banner: false },
  { port: 1883, service: 'mqtt', banner: false },
  { port: 3389, service: 'rdp', banner: false },
  { port: 5357, service: 'wsdapi', banner: false },
  { port: 8000, service: 'http-alt', banner: false },
  { port: 8008, service: 'googlecast', banner: false },
  { port: 8009, service: 'googlecast-tls', banner: false },
  { port: 8080, service: 'http-alt', banner: false },
  { port: 8443, service: 'https-alt', banner: false },
  { port: 9100, service: 'jetdirect', banner: false },
];

function _tcpProbe(ip, def, timeoutMs) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    let done = false;
    let connected = false;
    let banner = '';
    const finish = open => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (_) {}
      resolve(open ? {
        port: def.port,
        service: def.service,
        banner: banner.replace(/[^\x20-\x7e\r\n\t]/g, '').trim().slice(0, 160),
      } : null);
    };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => {
      connected = true;
      if (def.send) {
        try { sock.write(def.send); } catch (_) {}
      }
      if (!def.banner) finish(true);
    });
    sock.on('data', chunk => {
      banner += chunk.toString('utf8');
      if (banner.length >= 160) finish(true);
    });
    sock.on('timeout', () => finish(connected && !!banner));
    sock.on('error', () => finish(false));
    sock.on('close', () => finish(connected && !!banner));
    try { sock.connect(def.port, ip); } catch (_) { finish(false); }
  });
}

async function _deepScanHost(ip, safe, timeoutMs) {
  const perPortTimeout = Math.max(350, Math.min(timeoutMs || 700, safe ? 850 : 650));
  const ports = DEEP_TCP_PORTS;
  const conc = safe ? 4 : 8;
  const open = [];
  for (let i = 0; i < ports.length; i += conc) {
    const batch = ports.slice(i, i + conc);
    const found = await Promise.all(batch.map(p => _tcpProbe(ip, p, perPortTimeout)));
    for (const item of found) if (item) open.push(item);
  }
  return open.sort((a, b) => a.port - b.port);
}

function _parseNetbiosOutput(text) {
  const out = String(text || '');
  const result = { name: '', group: '', mac: '', smbServer: false, records: [] };
  const macMatch = out.match(/(?:MAC Address|Indirizzo MAC)\s*=\s*([0-9a-fA-F:-]{17})/i);
  if (macMatch) result.mac = _normMac(macMatch[1]);

  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^(.{1,20}?)\s+<([0-9A-Fa-f]{2})>\s+([A-Za-z]+)\s+/);
    if (!m) continue;
    const name = m[1].trim();
    const suffix = m[2].toUpperCase();
    const kind = m[3].toLowerCase();
    if (!name || /^__msbrowse__/i.test(name)) continue;
    const isGroup = /group|gruppo/.test(kind);
    result.records.push({ name, suffix, kind: isGroup ? 'group' : 'unique' });
    if (suffix === '20' && !isGroup) result.smbServer = true;
    if (suffix === '00' && !isGroup && !result.name) result.name = name;
    if ((suffix === '00' || suffix === '1C' || suffix === '1E') && isGroup && !result.group) result.group = name;
  }

  if (!result.name) {
    const rec = result.records.find(r => r.kind === 'unique' && r.suffix === '20')
      || result.records.find(r => r.kind === 'unique');
    if (rec) result.name = rec.name;
  }
  return result.name || result.group || result.mac ? result : null;
}

// NBSTAT (NetBIOS Node Status) DIRETTO via UDP 137 — un pacchetto verso UN target, ~1s.
// Perche': la CLI `nbtstat -A` interroga il target su OGNI interfaccia locale e aspetta il
// timeout su quelle morte (VMnet/Bluetooth/…) → su una macchina con molte NIC virtuali
// arriva a 10-30s, oltre ogni timeout ragionevole del probe. La query UDP diretta e'
// **cross-platform** e non ha quel ritardo (verificato dal vivo: 38ms vs 10-30s).
// Nome NetBIOS "wildcard": "*" + 15 null, first-level encoding (ogni byte -> 2 char A-P).
function _buildNbstatQuery(txId = 0x1337) {
  const header = Buffer.from([(txId >> 8) & 0xff, txId & 0xff, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const nb = Buffer.alloc(16); nb[0] = 0x2A;                 // '*' + 15 * 0x00
  const enc = Buffer.alloc(32);
  for (let i = 0; i < 16; i++) { enc[i * 2] = 0x41 + (nb[i] >> 4); enc[i * 2 + 1] = 0x41 + (nb[i] & 0x0F); }
  const q = Buffer.concat([Buffer.from([0x20]), enc, Buffer.from([0x00, 0x00, 0x21, 0x00, 0x01])]);  // len + name + NUL + QTYPE NBSTAT + QCLASS IN
  return Buffer.concat([header, q]);
}
// Parsa la risposta NBSTAT (binaria) nella STESSA forma di _parseNetbiosOutput:
// { name, group, mac, smbServer, records:[{name,suffix(hex UPPER),kind}] } | null.
function _parseNbstatResponse(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 43) return null;
  let off = 12;                                              // salta l'header
  if ((buf[off] & 0xC0) === 0xC0) off += 2;                  // nome RR = puntatore
  else if (buf[off] === 0x20) off += 34;                     // nome codificato (0x20 + 32 + NUL)
  else { while (off < buf.length && buf[off] !== 0) off += 1 + buf[off]; off += 1; }
  off += 10;                                                 // TYPE(2)+CLASS(2)+TTL(4)+RDLENGTH(2)
  if (off >= buf.length) return null;
  const num = buf[off]; off += 1;
  const out = { name: '', group: '', mac: '', smbServer: false, records: [] };
  for (let i = 0; i < num && off + 18 <= buf.length; i++) {
    const nm = buf.slice(off, off + 15).toString('latin1').replace(/\0+$/, '').trimEnd();
    const suffix = buf[off + 15];
    const isGroup = !!(buf.readUInt16BE(off + 16) & 0x8000);
    off += 18;
    if (!nm || /^__MSBROWSE__/i.test(nm)) continue;
    const sHex = suffix.toString(16).padStart(2, '0').toUpperCase();
    out.records.push({ name: nm, suffix: sHex, kind: isGroup ? 'group' : 'unique' });
    if (suffix === 0x20 && !isGroup) out.smbServer = true;
    if (suffix === 0x00 && !isGroup && !out.name) out.name = nm;
    if ((suffix === 0x00 || suffix === 0x1C || suffix === 0x1E) && isGroup && !out.group) out.group = nm;
  }
  if (!out.name) { const rec = out.records.find(r => r.kind === 'unique' && r.suffix === '20') || out.records.find(r => r.kind === 'unique'); if (rec) out.name = rec.name; }
  if (off + 6 <= buf.length) { const m = buf.slice(off, off + 6); if (m.some(b => b)) out.mac = _normMac([...m].map(b => b.toString(16).padStart(2, '0')).join(':')); }
  return (out.name || out.group || out.mac) ? out : null;
}
function _nbstatUdp(ip, timeoutMs = 1500, createSocket = dgram.createSocket) {
  return new Promise(resolve => {
    let done = false; let sock; let to;
    const fin = v => { if (done) return; done = true; clearTimeout(to); try { sock && sock.close(); } catch (_) {} resolve(v); };
    try { sock = createSocket({ type: 'udp4' }); } catch (_) { return fin(null); }
    sock.on('message', msg => fin(_parseNbstatResponse(msg)));
    sock.on('error', () => fin(null));
    to = setTimeout(() => fin(null), Math.max(300, Math.min(parseInt(timeoutMs, 10) || 1500, 4000)));
    try { const q = _buildNbstatQuery(); sock.send(q, 0, q.length, 137, ip, err => { if (err) fin(null); }); }
    catch (_) { fin(null); }
  });
}
async function _netbiosProbe(ip, timeoutMs = 1800) {
  // UDP NBSTAT prima (veloce, cross-platform, niente ritardo multi-interfaccia della CLI).
  const udp = await _nbstatUdp(ip, Math.max(500, Math.min(timeoutMs, 1800))).catch(() => null);
  if (udp && (udp.name || udp.group)) return udp;
  if (os.platform() !== 'win32') return udp;                 // fuori da Windows: solo UDP, niente CLI
  try {
    const r = await _execFileAsync('nbtstat', ['-A', ip], timeoutMs);
    const parsed = _parseNetbiosOutput(`${r.stdout}\n${r.stderr}`);
    return parsed && (parsed.name || parsed.group || parsed.mac) ? parsed : udp;
  } catch (_) { return udp; }
}

function _parseNetViewOutput(text) {
  const shares = [];
  let inTable = false;
  const seen = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    const low = line.toLowerCase();
    if (!line.trim()) continue;
    if (/^-{4,}/.test(line.trim())) { inTable = true; continue; }
    if (!inTable) continue;
    if (/command completed|comando completato|there are no entries|non ci sono|errore|error/.test(low)) break;
    if (/share name|nome condivisione|risorse condivise|shared resources/.test(low)) continue;
    const m = line.match(/^(.+?)(?:\s{2,}|\t+)(.*)$/)
      || line.match(/^(\S+)\s+(Disk|Disco|Print|Stampa|IPC|Remote|Remoto)\b(.*)$/i);
    if (!m) continue;
    const name = m[1].trim();
    const rest = m.length >= 4 ? `${m[2]} ${m[3] || ''}`.trim() : m[2].trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    if (/^(ipc\$|print\$|admin\$)$/i.test(name)) continue;
    const typeMatch = rest.match(/^(Disk|Disco|Print|Stampa|IPC|Remote|Remoto)\b/i);
    shares.push({
      name,
      type: typeMatch ? typeMatch[1] : '',
      comment: typeMatch ? rest.slice(typeMatch[0].length).trim() : rest,
    });
    seen.add(name.toLowerCase());
  }
  return shares.slice(0, 20);
}

async function _smbSharesProbe(ip, timeoutMs = 2500) {
  if (os.platform() !== 'win32') return [];
  const r = await _execFileAsync('net', ['view', `\\\\${ip}`, '/all'], timeoutMs);
  return _parseNetViewOutput(`${r.stdout}\n${r.stderr}`);
}

// Google Cast device-info probe. Cast (Chromecast, Nvidia Shield, Android TV, Nest,
// cast-enabled TVs/speakers) answers a device-info request on :8008 regardless of
// brand — a PROTOCOL signal, like RTSP for cameras or IPP for printers, so it stays
// vendor-neutral. Returns { cast:true, name } only when the eureka_info payload is a
// genuine Cast response (carries a cast/build revision), else null.
function _castProbe(ip, timeoutMs = 900) {
  return new Promise(resolve => {
    let done = false;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    let body = '';
    const req = http.get({ host: ip, port: 8008, path: '/setup/eureka_info', timeout: timeoutMs }, res => {
      res.on('data', d => { body += d; if (body.length > 16384) { req.destroy(); fin(null); } });
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j && (j.cast_build_revision || j.build_version || j.ssdp_udn)) {
            fin({ cast: true, name: String(j.name || '').trim().slice(0, 64) });
            return;
          }
        } catch (_) { /* not JSON / not cast */ }
        fin(null);
      });
    });
    req.on('timeout', () => { req.destroy(); fin(null); });
    req.on('error', () => fin(null));
  });
}

async function _deepIdentityScanHost(ip, safe, timeoutMs) {
  const services = await _deepScanHost(ip, safe, timeoutMs);
  const identityTimeout = safe ? 2200 : 1600;
  let netbios = null;
  let smbShares = [];
  let cast = null;
  // Confirm Cast only when a cast control port is open (avoids probing every host).
  const hasCastPort = services.some(s => { const p = parseInt(s.port, 10); return p === 8008 || p === 8009; });
  if (hasCastPort) {
    try { cast = await _castProbe(ip, safe ? 1200 : 900); } catch (_) {}
  }
  try { netbios = await _netbiosProbe(ip, identityTimeout); } catch (_) {}
  const hasSmb = services.some(s => parseInt(s.port, 10) === 445) || !!netbios?.smbServer;
  if (hasSmb) {
    try { smbShares = await _smbSharesProbe(ip, safe ? 2800 : 2000); } catch (_) {}
  }
  return { services, netbios, smbShares, cast };
}

// Fetch bounded UPnP description XML (unicast HTTP GET of an SSDP LOCATION) for
// manufacturer/model. Best-effort like _castProbe: never throws, size+time capped.
function _fetchUpnpXml(locationUrl, timeoutMs = 1200) {
  return new Promise(resolve => {
    let done = false;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    let u;
    try { u = new URL(locationUrl); } catch (_) { return fin(null); }
    if (u.protocol !== 'http:') return fin(null);   // le descrizioni UPnP sono HTTP
    let body = '';
    const req = http.get({ host: u.hostname, port: u.port || 80, path: (u.pathname || '/') + (u.search || ''), timeout: timeoutMs }, res => {
      res.on('data', d => { body += d; if (body.length > 65536) { req.destroy(); fin({ ip: u.hostname, xml: body }); } });
      res.on('end', () => fin({ ip: u.hostname, xml: body }));
    });
    req.on('timeout', () => { req.destroy(); fin(null); });
    req.on('error', () => fin(null));
  });
}

// ONVIF GetDeviceInformation (SOAP POST) al device service di una telecamera, per il
// MODELLO COMMERCIALE ("RLC-810A") che lo scope WS-Discovery non porta. Best-effort come
// _fetchUpnpXml (mai lancia, size/time cap); NON autenticato (molte cam lo permettono,
// altre rispondono con un fault -> nessun modello, si ripiega sullo scope hardware).
function _onvifGetDeviceInfo(xaddrUrl, timeoutMs = 1500) {
  return new Promise(resolve => {
    let done = false;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    let u;
    try { u = new URL(xaddrUrl); } catch (_) { return fin(null); }
    if (u.protocol !== 'http:') return fin(null);
    const body = buildOnvifGetDeviceInfo();
    let resp = '';
    const req = http.request({
      host: u.hostname, port: u.port || 80, path: (u.pathname || '/') + (u.search || ''), method: 'POST',
      timeout: timeoutMs, headers: { 'Content-Type': 'application/soap+xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      res.on('data', d => { resp += d; if (resp.length > 65536) { req.destroy(); fin({ ip: u.hostname, xml: resp }); } });
      res.on('end', () => fin({ ip: u.hostname, xml: resp }));
    });
    req.on('timeout', () => { req.destroy(); fin(null); });
    req.on('error', () => fin(null));
    req.write(body); req.end();
  });
}

// Multicast discovery sweep of the LOCAL segment: sends one mDNS PTR query
// (224.0.0.251:5353) and one SSDP M-SEARCH (239.255.255.250:1900), listens for a
// wall-clock deadline, and returns Map<ip, identity> (identity = resolveDiscovery-
// Identity: type/strength/points + model/manufacturer + services). Subnet-level,
// NOT per-host: multicast is link-local (mDNS TTL 1) so only same-segment devices
// answer — honest by design. Defensive: never throws; a bind/socket failure just
// yields fewer results. `opts.createSocket` is injectable for tests (a fake socket
// also disables the real UPnP XML fetch). opts: { deadlineMs, iface, mdnsQueries,
// ssdpSt, fetchUpnpXml, createSocket }.
async function _mdnsSsdpSweep(opts = {}) {
  const deadlineMs = Math.max(50, Math.min(parseInt(opts.deadlineMs, 10) || 3000, 8000));
  const iface = opts.iface || undefined;
  const createSocket = opts.createSocket || dgram.createSocket;
  const doFetchXml = opts.fetchUpnpXml !== false && !opts.createSocket;
  const messages = [];
  // Tetto anti-flood: un attaccante sullo stesso segmento potrebbe inondare il multicast
  // per gonfiare la memoria durante la finestra. Cappiamo il NUMERO di datagrammi e la
  // DIMENSIONE di ciascuno (coerente con i tetti 64KB/slice(24) gia' presenti nel file).
  const MAX_SWEEP_MSGS = 5000;
  const MAX_MSG_BYTES = 4096;   // mDNS/SSDP utili sono ben sotto; oltre = probabile abuso
  const _push = (ip, kind, buf) => {
    if (messages.length >= MAX_SWEEP_MSGS || !ip) return;
    messages.push({ ip, kind, data: buf.length > MAX_MSG_BYTES ? Buffer.from(buf.subarray(0, MAX_MSG_BYTES)) : buf });
  };
  const socks = [];
  const closeAll = () => { for (const s of socks) { try { s.close(); } catch (_) {} } };

  await new Promise(resolve => {
    let settled = false;
    let timer = null;
    const finish = () => { if (settled) return; settled = true; if (timer) clearTimeout(timer); closeAll(); resolve(); };
    // mDNS: bind 5353 + join the group so multicast responses are received.
    try {
      const m = createSocket({ type: 'udp4', reuseAddr: true });
      socks.push(m);
      m.on('message', (buf, rinfo) => { if (rinfo && rinfo.address) _push(rinfo.address, 'mdns', buf); });
      m.on('error', () => {});
      m.bind(opts.mdnsBindPort != null ? opts.mdnsBindPort : MDNS_PORT, iface, () => {
        try { m.addMembership(MDNS_ADDR, iface); } catch (_) {}
        try { m.setMulticastTTL(1); } catch (_) {}
        try { const q = buildMdnsQuery(opts.mdnsQueries || MDNS_DEFAULT_QUERIES); m.send(q, 0, q.length, MDNS_PORT, MDNS_ADDR); } catch (_) {}
      });
    } catch (_) {}
    // mDNS via UNICAST-RESPONSE (QU): bind su porta EFFIMERA + chiedi risposta unicast, cosi'
    // si ricevono le risposte anche quando la 5353 e' occupata (Windows: Bonjour) e il socket
    // multicast sopra non riceve nulla. RFC 6762 §5.4 — cattura la gran parte dei device
    // (Chromecast col suo `md`, stampanti, telefoni) senza dover vincere la porta 5353.
    try {
      const mu = createSocket({ type: 'udp4', reuseAddr: true });
      socks.push(mu);
      mu.on('message', (buf, rinfo) => { if (rinfo && rinfo.address) _push(rinfo.address, 'mdns', buf); });
      mu.on('error', () => {});
      mu.bind(0, iface, () => {
        try { mu.setMulticastTTL(1); } catch (_) {}
        try { const q = buildMdnsQuery(opts.mdnsQueries || MDNS_DEFAULT_QUERIES, true); mu.send(q, 0, q.length, MDNS_PORT, MDNS_ADDR); } catch (_) {}
      });
    } catch (_) {}
    // SSDP: M-SEARCH replies come back UNICAST to our ephemeral port.
    try {
      const s = createSocket({ type: 'udp4', reuseAddr: true });
      socks.push(s);
      s.on('message', (buf, rinfo) => { if (rinfo && rinfo.address) _push(rinfo.address, 'ssdp', buf); });
      s.on('error', () => {});
      s.bind(0, iface, () => {
        try { const q = buildSsdpQuery(opts.ssdpSt); s.send(q, 0, q.length, SSDP_PORT, SSDP_ADDR); } catch (_) {}
      });
    } catch (_) {}
    // WS-Discovery (ONVIF): Probe SOAP multicast su :3702; i ProbeMatch tornano UNICAST alla
    // porta effimera. Fa emergere il MODELLO delle IP-cam/NVR (scope onvif hardware/name).
    try {
      const w = createSocket({ type: 'udp4', reuseAddr: true });
      socks.push(w);
      w.on('message', (buf, rinfo) => { if (rinfo && rinfo.address) _push(rinfo.address, 'wsd', buf); });
      w.on('error', () => {});
      w.bind(0, iface, () => {
        try { const q = buildWsDiscoveryProbe(opts.wsdMessageId); w.send(q, 0, q.length, WSD_PORT, WSD_ADDR); } catch (_) {}
      });
    } catch (_) {}
    // Deadline: finestra di ascolto a tempo. NON usare .unref() qui: questo timer E'
    // il meccanismo che risolve la Promise. Se fosse unref'd e restasse l'unico handle
    // del loop (path a socket INIETTATI nei test: nessun handle reale), il loop
    // uscirebbe senza attenderlo -> finish mai chiamato -> Promise mai risolta ->
    // in node:test i test pendenti diventano "cancelled" (CI Node 18/20). In produzione
    // i socket UDP reali tengono comunque vivo il loop, quindi non e' emerso finora.
    timer = setTimeout(finish, deadlineMs);
  });

  // Best-effort: dereference SSDP LOCATIONs (unicast) for manufacturer/model.
  if (doFetchXml) {
    const locByIp = new Map();
    for (const msg of messages) {
      if (msg.kind !== 'ssdp') continue;
      try {
        const p = parseSsdpResponse(msg.data.toString('utf8'));
        if (!p || !p.location) continue;
        // Guardia SSRF: la descrizione si recupera SOLO dal device che ha risposto —
        // l'host della LOCATION deve coincidere con l'IP sorgente del responder. Cosi'
        // un responder malevolo sul segmento non puo' dirottare la GET del server verso
        // un host interno arbitrario (metadata cloud, servizi interni…). Un IP per volta.
        let host = '';
        try { host = new URL(p.location).hostname; } catch (_) {}
        if (host && host === msg.ip && !locByIp.has(msg.ip)) locByIp.set(msg.ip, p.location);
      } catch (_) {}
    }
    const entries = [...locByIp.values()].slice(0, 24);
    const xmls = await Promise.all(entries.map(u => _fetchUpnpXml(u).catch(() => null)));
    for (const r of xmls) if (r && r.ip && r.xml) messages.push({ ip: r.ip, kind: 'upnpxml', data: r.xml });

    // ONVIF: per ogni ProbeMatch ONVIF (XAddrs verso il SUO stesso IP: guardia SSRF)
    // chiedi GetDeviceInformation -> modello commerciale della telecamera.
    const onvifByIp = new Map();
    for (const msg of messages) {
      if (msg.kind !== 'wsd') continue;
      try {
        const w = parseWsDiscovery(msg.data.toString('utf8'));
        if (!w || !w.xaddrs || !(w.scopes || []).some(s => /onvif:/i.test(String(s)))) continue;
        const xaddr = String(w.xaddrs).split(/\s+/)[0];
        let host = ''; try { host = new URL(xaddr).hostname; } catch (_) {}
        if (host && host === msg.ip && !onvifByIp.has(msg.ip)) onvifByIp.set(msg.ip, xaddr);
      } catch (_) {}
    }
    const infos = await Promise.all([...onvifByIp.values()].slice(0, 24).map(x => _onvifGetDeviceInfo(x).catch(() => null)));
    for (const r of infos) if (r && r.ip && r.xml) messages.push({ ip: r.ip, kind: 'onvifinfo', data: r.xml });
  }

  return aggregateSweep(messages);
}

module.exports = { expandSubnet, _execFileAsync, _pingHost, _pingResultIsAlive, _pingHostRetry, _stealthDelayMs, _normMac, _parseArpTable, _parseNeighbors, _readArpMap, _ipToNum, _demoteStaleArpDup, _readLocalInterfaceMap, OUI_VENDOR, _vendorByMac, _extractTitle, _httpProbe, DEEP_TCP_PORTS, _tcpProbe, _deepScanHost, _castProbe, _parseNetbiosOutput, _netbiosProbe, _parseNetViewOutput, _smbSharesProbe, _deepIdentityScanHost, _mdnsSsdpSweep, _fetchUpnpXml, _shuffled, _buildNbstatQuery, _parseNbstatResponse, _nbstatUdp };
