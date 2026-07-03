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
const { execFile } = require('child_process');

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
  if (r.ok) return true;
  const out = (r.stdout + '\n' + r.stderr).toLowerCase();
  return out.includes('ttl=') || out.includes('bytes from') || out.includes('1 received');
}

// Ping con ritentativo: un host puo' perdere il PRIMO ICMP (VPCS, stack lenti, link
// congestionati, host che risvegliano l'ARP del gateway) → il singolo ping darebbe un
// FALSO negativo e l'host verrebbe mancato. Ritenta fino a `tries` volte, VIVO se ANCHE
// UNO risponde. Vendor-neutral: non e' specifico di un device — chiude i falsi negativi
// da perdita ICMP occasionale su qualunque host. Un host vivo di solito risponde al 1°
// tentativo (costo minimo); uno realmente morto costa `tries` ping (bounded). Il param
// `_ping` e' iniettabile per i test.
async function _pingHostRetry(ip, timeoutMs = 800, tries = 2, _ping = _pingHost) {
  const n = Math.max(1, Math.min(parseInt(tries, 10) || 1, 5));
  for (let i = 0; i < n; i++) {
    if (await _ping(ip, timeoutMs).catch(() => false)) return true;
  }
  return false;
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

async function _readArpMap() {
  const isWin = os.platform() === 'win32';
  const r = await _execFileAsync(isWin ? 'arp' : 'arp', isWin ? ['-a'] : ['-an'], 2500);
  return _parseArpTable(r.stdout);
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

async function _netbiosProbe(ip, timeoutMs = 1800) {
  if (os.platform() !== 'win32') return null;
  const r = await _execFileAsync('nbtstat', ['-A', ip], timeoutMs);
  const parsed = _parseNetbiosOutput(`${r.stdout}\n${r.stderr}`);
  return parsed && (parsed.name || parsed.group || parsed.mac) ? parsed : null;
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

async function _deepIdentityScanHost(ip, safe, timeoutMs) {
  const services = await _deepScanHost(ip, safe, timeoutMs);
  const identityTimeout = safe ? 2200 : 1600;
  let netbios = null;
  let smbShares = [];
  try { netbios = await _netbiosProbe(ip, identityTimeout); } catch (_) {}
  const hasSmb = services.some(s => parseInt(s.port, 10) === 445) || !!netbios?.smbServer;
  if (hasSmb) {
    try { smbShares = await _smbSharesProbe(ip, safe ? 2800 : 2000); } catch (_) {}
  }
  return { services, netbios, smbShares };
}

module.exports = { expandSubnet, _execFileAsync, _pingHost, _pingHostRetry, _normMac, _parseArpTable, _readArpMap, _readLocalInterfaceMap, OUI_VENDOR, _vendorByMac, _extractTitle, _httpProbe, DEEP_TCP_PORTS, _tcpProbe, _deepScanHost, _parseNetbiosOutput, _netbiosProbe, _parseNetViewOutput, _smbSharesProbe, _deepIdentityScanHost };
