'use strict';
// ============================================================
//  InfraNet Pro — SNMP Driver  (v1 / v2c / v3)
//  Usa la libreria net-snmp (https://github.com/markabrahams/node-net-snmp)
//
//  Esportato: async poll(cfg) → { hostname, interfaces[], lags[] }
//
//  Rilevazione LAG — strategia a tre livelli (il primo che trova dati vince):
//
//  L0 — ifStackTable (IF-MIB RFC 2863)
//       OID 1.3.6.1.2.1.31.1.2.1.2.{H}.{L} → RowStatus
//       H=aggregatore (ifType=161), L=porta fisica membro.
//       Funziona per LAG statico e LACP, tutto in spazio ifIndex.
//       Supportato da: Cisco IOS/NX-OS, Juniper, HP/Aruba, Dell...
//
//  L1 — dot3adAggMemberPorts bitmap (802.3ad MIB)
//       OID 1.2.840.10006.300.43.1.1.1.1.17.{aggIfIndex} → PortList
//       Bitmap delle bridge-port membro; richiede mappa bpToIf.
//       Funziona per LAG statico e LACP.
//
//  L2 — dot3adAggPortAttachedAggID + ActorOperState (802.3ad MIB)
//       OID .11 → lagId per porta (indicizzato per ifIndex)
//       OID .14 → bitmask LACP (bit3=Synchronization)
//       Logica adattiva:
//         anySync=true  (LACP attivo)    → filtra per bit Sync
//         anySync=false (LAG statico)    → usa solo cross-check ifType=161
//       Anti-falso-positivo Zyxel: se >90% delle porte fisiche riporta
//       lo stesso lagId, il firmware pre-assegna tutti → ignorato.
//
//  Nota Zyxel GS1900 LAG statico: nessuno dei tre livelli funziona
//  (firmware non implementa 802.3ad MIB correttamente, ifStackTable assente).
//  In tal caso lags[] contiene l'interfaccia aggregatore (ifType=161)
//  ma nessuna porta fisica viene marcata come membro.
// ============================================================

const snmp = require('net-snmp');

const SNMP_DEBUG = /^(1|true|yes|on)$/i.test(String(process.env.DEBUG_SNMP || process.env.SNMP_DEBUG || ''));
function snmpDebug(...args) { if (SNMP_DEBUG) console.log(...args); }
function snmpWarn(...args) { if (SNMP_DEBUG) console.warn(...args); }

// ---- Parametri di walk SNMP (brand-agnostici) ------------------------------
//
// CONCORRENZA — la causa radice del troncamento delle walk:
//   Interrogare tutti gli OID base in parallelo sulla STESSA sessione/socket
//   UDP sommerge i device con stack SNMP leggero (switch small-business: Zyxel,
//   TP-Link, Netgear, MikroTik...). Sotto carico perdono pacchetti UDP e le
//   GETBULK in volo vanno in timeout → le walk si troncano silenziosamente,
//   restituendo solo una parte delle righe (es. 25 porte invece di 26+).
//   Limitando il numero di walk simultanee il device non viene mai saturato,
//   indipendentemente da brand, velocità o densità di porte. È il comportamento
//   corretto verso un agente SNMP con risorse limitate.
//   Default conservativo = 4: test empirici su Zyxel GS1900 mostrano walk
//   complete e affidabili fino a ~6 simultanee, mentre da 8 in su il device
//   inizia a perdere pacchetti in modo non deterministico. 4 lascia un margine
//   di sicurezza 2x per coprire anche device più deboli (IoT, switch datati).
//   Alzabile via env (SNMP_WALK_CONCURRENCY) su reti con soli device robusti
//   per ridurre il tempo di poll.
const WALK_CONCURRENCY = Math.max(1, Math.min(parseInt(process.env.SNMP_WALK_CONCURRENCY, 10) || 4, 32));
//
// MAX-REPETITIONS — righe per singola GETBULK. Con la concorrenza limitata la
//   correttezza non dipende più da questo valore (anche 10 funziona); resta
//   solo un parametro di performance. Le walk sono single-column, quindi il
//   valore è PDU-safe. Valore standard di settore, override via env.
const WALK_MAX_REPS = Math.max(10, Math.min(parseInt(process.env.SNMP_MAX_REPS, 10) || 25, 256));
// CAP anti-runaway per SINGOLA walk: un agente che non ritorna mai endOfMibView
// (OID crescenti all'infinito) farebbe ciclare la subtree senza errori né
// timeout (ogni GETBULK risponde) → poll appeso. Oltre questa soglia si abortisce.
// Generoso per non troncare FDB/ARP grandi su switch enterprise. Override via env.
const WALK_MAX_VARBINDS = Math.max(2000, parseInt(process.env.SNMP_MAX_VARBINDS, 10) || 50000);

// Confronto OID per archi NUMERICI: `a` strettamente maggiore di `b`?
function _oidGt(a, b) {
  const A = String(a).split('.'), B = String(b).split('.');
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) { const x = +A[i], y = +B[i]; if (x !== y) return x > y; }
  return A.length > B.length;
}

// Esegue una lista di walk su `session` a batch di al massimo `concurrency`
// simultanee, accumulando i varbind validi in `result` (oid → value).
// Ritorna il numero di subtree che hanno terminato con errore.
//
// GUARD anti-loop (robustezza su device reali "scorretti"): la subtree si ferma
// se il feed-callback ritorna truthy (net-snmp: walkCb→doneCb). Si abortisce se
//  (a) l'OID NON cresce strettamente → walk-loop classico (agente ripete un OID);
//  (b) si superano WALK_MAX_VARBINDS → runaway a OID crescenti (es. agente senza
//      endOfMibView). Senza, un singolo device guasto può appendere /api/poll.
async function _runWalks(session, bases, result, label, concurrency = WALK_CONCURRENCY) {
  let errCount = 0;
  const walkOne = base => new Promise(resolve => {
    let count = 0, last = '', aborted = false;
    session.subtree(base, WALK_MAX_REPS,
      vbs => {
        for (const vb of vbs) {
          // GUARD su OGNI varbind (anche di ERRORE: un agente guasto può ripetere
          // un OID con valore noSuchInstance senza farlo avanzare → loop). Il check
          // va PRIMA del filtro isVarbindError, altrimenti il loop sfugge.
          if (last && !_oidGt(vb.oid, last)) { aborted = true; break; }   // (a) OID non crescente
          last = vb.oid;
          if (++count > WALK_MAX_VARBINDS) { aborted = true; break; }       // (b) runaway a OID crescenti
          if (!snmp.isVarbindError(vb)) result[vb.oid] = vbVal(vb);
        }
        if (aborted) { snmpWarn(`  [${label}] subtree ${base}: walk interrotta (loop/runaway, ~${count} varbind)`); errCount++; }
        return aborted;   // truthy → net-snmp ferma la subtree e chiama doneCb
      },
      err => { if (err) { snmpWarn(`  [${label}] subtree ${base}: ${err.message}`); errCount++; } resolve(); }
    );
  });
  const conc = Math.max(1, concurrency);
  for (let i = 0; i < bases.length; i += conc) {
    await Promise.all(bases.slice(i, i + conc).map(walkOne));
  }
  return errCount;
}

// ---- OID table -------------------------------------------------------------

const OID = {
  sysName:        '1.3.6.1.2.1.1.5',
  sysObjectID:    '1.3.6.1.2.1.1.2',
  // ---- Scalari di sistema universali (SNMPv2-MIB / RFC 1213) -----------------
  // Esposti da QUALSIASI agente SNMP (v1/v2c/v3, ogni vendor). Sola lettura →
  // documentazione "live" che non sovrascrive mai i campi manuali (manual-first).
  sysDescr:       '1.3.6.1.2.1.1.1',  // banner OS/firmware
  sysUpTime:      '1.3.6.1.2.1.1.3',  // TimeTicks (centesimi di secondo)
  sysContact:     '1.3.6.1.2.1.1.4',  // referente amministrativo
  sysLocation:    '1.3.6.1.2.1.1.6',  // posizione fisica dichiarata
  ifDescr:        '1.3.6.1.2.1.2.2.1.2',
  ifType:         '1.3.6.1.2.1.2.2.1.3',
  ifPhysAddress:  '1.3.6.1.2.1.2.2.1.6',  // MAC address — discriminatore fisico/virtuale
  ifOperStatus:   '1.3.6.1.2.1.2.2.1.8',
  ifSpeed:        '1.3.6.1.2.1.2.2.1.5',
  ifHighSpeed:    '1.3.6.1.2.1.31.1.1.1.15',
  ifAlias:        '1.3.6.1.2.1.31.1.1.1.18',
  ifStackStatus:  '1.3.6.1.2.1.31.1.2.1.2',        // L0: H.L → RowStatus
  bridgePortIf:   '1.3.6.1.2.1.17.1.4.1.2',
  dot1qPvid:             '1.3.6.1.2.1.17.7.1.4.5.1.1',
  dot1qVlanEgressPorts:  '1.3.6.1.2.1.17.7.1.4.2.1.4',   // per-VLAN egress portlist bitmap (tagged + untagged)
  dot1qVlanUntaggedPorts:'1.3.6.1.2.1.17.7.1.4.2.1.5',   // per-VLAN untagged portlist bitmap (access)
  dot1qVlanStaticName:   '1.3.6.1.2.1.17.7.1.4.3.1.1',   // Q-BRIDGE static VLAN name — indicizzato solo per VlanIndex
  vtpVlanName:          '1.3.6.1.4.1.9.9.46.1.3.1.1.2', // Cisco VTP: VLAN name — indice {domainIdx}.{vlanId} (funziona senza @vlan community)
  vlanTrunkPortDynState:'1.3.6.1.4.1.9.9.46.1.6.1.1.14', // Cisco: trunk dynamic state (1=on, 2=off/access, 3=desirable, 4=auto, 5=onNoNegotiate)
  vlanTrunkPortStatus:  '1.3.6.1.4.1.9.9.46.1.6.1.1.15', // Cisco: trunk operational status (1=trunking, 2=notTrunking) — ATTENZIONE: su IOS virtuale può essere 1 anche su porte access
  vlanTrunkPortVlans:   '1.3.6.1.4.1.9.9.46.1.6.1.1.4',  // Cisco: bitmap VLAN 0-1023 abilitate sul trunk per ifIndex — senza @vlan community
  // IEEE8023-LAG-MIB (corretto):
  //  dot3adAggPortListPorts     .1.2.840.10006.300.43.1.1.2.1.1
  //  dot3adAggPortAttachedAggID .1.2.840.10006.300.43.1.2.1.1.13
  //  dot3adAggPortActorOperState.1.2.840.10006.300.43.1.2.1.1.21
  aggMemberPorts: '1.2.840.10006.300.43.1.1.2.1.1', // L1: PortList bitmap per aggregatore
  lagAttached:    '1.2.840.10006.300.43.1.2.1.1.13', // L2: AttachedAggID per porta
  lagOperState:   '1.2.840.10006.300.43.1.2.1.1.21', // L2: ActorOperState bitmask (bit3=Sync)
  // ---- Mezzo fisico (MAU-MIB RFC 4836) ----------------------------------------
  mauType:        '1.3.6.1.2.1.26.2.1.1.3',  // ifMauType .{ifIndex} → OID del tipo MAU
  // ---- PoE (POWER-ETHERNET-MIB RFC 3621) --------------------------------------
  pethDetect:     '1.3.6.1.2.1.105.1.1.1.6', // pethPsePortDetectionStatus .{grp}.{port}
  pethClass:      '1.3.6.1.2.1.105.1.1.1.10',// pethPsePortPowerClassifications .{grp}.{port}
  // ---- Inventory hardware (ENTITY-MIB RFC 6933) ----------------------------
  entPhysicalDescr:       '1.3.6.1.2.1.47.1.1.1.1.2',
  entPhysicalClass:       '1.3.6.1.2.1.47.1.1.1.1.5',
  entPhysicalHardwareRev: '1.3.6.1.2.1.47.1.1.1.1.8',
  entPhysicalFirmwareRev: '1.3.6.1.2.1.47.1.1.1.1.9',
  entPhysicalSoftwareRev: '1.3.6.1.2.1.47.1.1.1.1.10',
  entPhysicalSerialNum:   '1.3.6.1.2.1.47.1.1.1.1.11',
  entPhysicalMfgName:     '1.3.6.1.2.1.47.1.1.1.1.12',
  entPhysicalModelName:   '1.3.6.1.2.1.47.1.1.1.1.13',
  entPhysicalAssetID:     '1.3.6.1.2.1.47.1.1.1.1.15',
};

const BASE_OIDS = Object.values(OID);

// ---- Printer-MIB (RFC 3805) + stato stampante (HOST-RESOURCES RFC 2790) ------
// Colonne usate da extractPrinter. DELIBERATAMENTE fuori da BASE_OIDS: gli stack
// SNMP leggeri delle stampanti (HP JetDirect) TRONCANO in modo non deterministico
// le colonne dei materiali sotto la walk concorrente multi-OID — verificato sul
// ferro reale (HP OfficeJet 8715): col poll completo i livelli/descrizioni/colore
// sparivano. Vanno lette in ISOLAMENTO (concorrenza 1) e SOLO sulle stampanti
// (cfg.printer), in un secondo passaggio dentro poll() → vedi PRINTER_BASES.
const PRT_OID = {
  prtSupplyColorant: '1.3.6.1.2.1.43.11.1.1.3.1', // prtMarkerSuppliesColorantIndex → colorante
  prtSupplyClass:    '1.3.6.1.2.1.43.11.1.1.4.1', // 3=consumato (toner/ink), 4=ricettacolo (scarico)
  prtSupplyType:     '1.3.6.1.2.1.43.11.1.1.5.1', // 3=toner, 4=wasteToner, 5=ink, 6=inkCartridge…
  prtSupplyDesc:     '1.3.6.1.2.1.43.11.1.1.6.1', // descrizione ("cyan ink HP F6U20A")
  prtSupplyMax:      '1.3.6.1.2.1.43.11.1.1.8.1', // capacità max (>0; -1=ignota, -2=illimitata)
  prtSupplyLevel:    '1.3.6.1.2.1.43.11.1.1.9.1', // livello attuale (-1/-2/-3 = valori speciali)
  prtColorantVal:    '1.3.6.1.2.1.43.12.1.1.4.1', // prtMarkerColorantValue ("cyan ink"…)
  prtLifeCount:      '1.3.6.1.2.1.43.10.2.1.4',   // prtMarkerLifeCount (contapagine totale)
  hrPrinterStatus:   '1.3.6.1.2.1.25.3.5.1.1',    // 1=other 2=unknown 3=idle 4=printing 5=warmup
  hrPrinterErr:      '1.3.6.1.2.1.25.3.5.1.2',    // hrPrinterDetectedErrorState (bitmap errori)
};

// Basi da walkare in ISOLAMENTO per le stampanti: la tabella supplies in UN
// solo walk (column-major, tutte le colonne) + colorante + contapagine + stato.
const PRINTER_BASES = [
  '1.3.6.1.2.1.43.11.1.1',   // prtMarkerSuppliesEntry (copre .3/.5/.6/.8/.9)
  PRT_OID.prtColorantVal,
  PRT_OID.prtLifeCount,
  PRT_OID.hrPrinterStatus,
  PRT_OID.hrPrinterErr,
];

// ---- HOST-RESOURCES-MIB (RFC 2790): CPU / RAM / dischi ----------------------
// Standard e source-agnostico (Linux/Windows/NAS/hypervisor). Fuori da BASE_OIDS:
// letto in un secondo passaggio SOLO sui device "compute" (cfg.hostResources) per
// non appesantire il poll della rete (switch/router non hanno una card CPU/RAM).
const HR_OID = {
  hrProcessorLoad: '1.3.6.1.2.1.25.3.3.1.2',  // load % per processore (0-100)
  hrStorageType:   '1.3.6.1.2.1.25.2.3.1.2',  // OID tipo: …25.2.1.{2=ram,3=virt,4=fixed,9=flash,10=net}
  hrStorageDescr:  '1.3.6.1.2.1.25.2.3.1.3',  // "Physical memory", "/", "/volume1"…
  hrStorageUnits:  '1.3.6.1.2.1.25.2.3.1.4',  // byte per unità di allocazione
  hrStorageSize:   '1.3.6.1.2.1.25.2.3.1.5',  // dimensione (in unità)
  hrStorageUsed:   '1.3.6.1.2.1.25.2.3.1.6',  // usato (in unità)
};
const HOSTRES_BASES = [
  HR_OID.hrProcessorLoad,
  '1.3.6.1.2.1.25.2.3.1',    // hrStorageEntry (copre .2/.3/.4/.5/.6 in un walk)
];

// ---- helpers ---------------------------------------------------------------

function vbVal(vb) { return vb.value; }

function bufToStr(v) {
  if (Buffer.isBuffer(v)) return v.toString('utf8').replace(/\0/g, '').trim();
  return String(v ?? '').trim();
}

function bufToInt(v) {
  if (Buffer.isBuffer(v)) {
    if (v.length === 1) return v[0];
    if (v.length === 2) return (v[0] << 8) | v[1];
    if (v.length === 4) return ((v[0] << 24) | (v[1] << 16) | (v[2] << 8) | v[3]) >>> 0;
    return parseInt(v.toString('utf8')) || 0;
  }
  return parseInt(v) || 0;
}

/**
 * Decodifica una PortList (OctetString bitmap IEEE 802.1D).
 * Byte 0 MSB = bridge port 1. Ritorna array di bridge port number (1-based).
 */
function decodePortList(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return [];
  const ports = [];
  for (let i = 0; i < buf.length; i++) {
    for (let bit = 7; bit >= 0; bit--) {
      if (buf[i] & (1 << bit)) ports.push(i * 8 + (8 - bit));
    }
  }
  return ports;
}

function lastIdx(oid) {
  return parseInt(oid.split('.').at(-1));
}

/**
 * Ritorna true se il buffer è un MAC Ethernet reale (6 byte, almeno un byte ≠ 0).
 * Interfacce virtuali (loopback, tun, docker bridge senza HW) hanno MAC nullo o assente.
 */
function isRealMac(v) {
  if (!Buffer.isBuffer(v) || v.length !== 6) return false;
  return v.some(b => b !== 0);
}

function macToStr(v) {
  if (!Buffer.isBuffer(v) || v.length !== 6) return '';
  return Array.from(v).map(b => b.toString(16).padStart(2,'0')).join(':');
}

function _firstNonEmpty(...values) {
  for (const value of values) {
    const str = bufToStr(value);
    if (str) return str;
  }
  return '';
}

function _entityFieldFromOid(oid, base) {
  return oid.startsWith(base + '.') ? oid.slice(base.length + 1) : '';
}

function extractEntityInventory(vbs) {
  const rows = {};
  const fields = [
    { base: OID.entPhysicalDescr,       field: 'description', conv: bufToStr },
    { base: OID.entPhysicalClass,       field: 'class',       conv: bufToInt },
    { base: OID.entPhysicalHardwareRev, field: 'hardwareRev', conv: bufToStr },
    { base: OID.entPhysicalFirmwareRev, field: 'firmwareRev', conv: bufToStr },
    { base: OID.entPhysicalSoftwareRev, field: 'softwareRev', conv: bufToStr },
    { base: OID.entPhysicalSerialNum,   field: 'serialNumber',conv: bufToStr },
    { base: OID.entPhysicalMfgName,     field: 'brand',       conv: bufToStr },
    { base: OID.entPhysicalModelName,   field: 'model',       conv: bufToStr },
    { base: OID.entPhysicalAssetID,     field: 'assetTag',    conv: bufToStr },
  ];

  for (const [oid, val] of Object.entries(vbs || {})) {
    for (const item of fields) {
      const index = _entityFieldFromOid(oid, item.base);
      if (!index) continue;
      const parsed = item.conv(val);
      if (parsed === '' || parsed === 0) continue;
      (rows[index] ??= { index: parseInt(index.split('.')[0], 10) || 0 })[item.field] = parsed;
      break;
    }
  }

  const entries = Object.entries(rows)
    .map(([index, row]) => ({ ...row, index: row.index || parseInt(index.split('.')[0], 10) || 0 }))
    .filter(row => row.description || row.brand || row.model || row.serialNumber || row.firmwareRev || row.softwareRev || row.hardwareRev || row.assetTag)
    .sort((a, b) => {
      const aScore = _entityPriorityScore(a);
      const bScore = _entityPriorityScore(b);
      if (bScore !== aScore) return bScore - aScore;
      return (a.index || 0) - (b.index || 0);
    });

  const primary = entries[0] || null;
  if (!primary) return null;

  const firmwareVer = _firstNonEmpty(primary.softwareRev, primary.firmwareRev, primary.hardwareRev);
  const inventory = {
    brand: primary.brand || '',
    model: primary.model || primary.description || '',
    serialNumber: primary.serialNumber || '',
    firmwareVer,
    hardwareRev: primary.hardwareRev || '',
    softwareRev: primary.softwareRev || '',
    assetTag: primary.assetTag || '',
    entityIndex: primary.index || 0,
    entityClass: primary.class || 0,
    source: 'ENTITY-MIB',
    entities: entries.slice(0, 24),
  };

  for (const key of Object.keys(inventory)) {
    if (inventory[key] === '' || inventory[key] === 0 || (Array.isArray(inventory[key]) && inventory[key].length === 0)) delete inventory[key];
  }
  return inventory;
}

/**
 * Formatta un valore TimeTicks (centesimi di secondo) in una stringa di uptime
 * compatta e neutra rispetto alla lingua (d/h/m, convenzione di settore).
 * Es. 12 giorni 4 ore 30 min → "12d 4h 30m".
 */
function _formatUptime(ticks) {
  let s = Math.floor((Number(ticks) || 0) / 100);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600);  s -= h * 3600;
  const m = Math.floor(s / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (d || h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

/**
 * Estrae gli scalari di sistema universali (sysDescr/sysContact/sysLocation/
 * sysUpTime) da una mappa di varbind. Pura: nessun side-effect, testabile.
 * Ritorna null se l'agente non espone nessuno di questi (così il chiamante
 * non salva un oggetto vuoto). v2c e v3 espongono gli STESSI OID.
 */
function extractSystem(vbs) {
  let descr = '', contact = '', location = '', upTicks = 0;
  for (const [oid, val] of Object.entries(vbs || {})) {
    if (!descr && oid.startsWith(OID.sysDescr + '.'))          descr    = bufToStr(val);
    else if (!contact && oid.startsWith(OID.sysContact + '.'))  contact  = bufToStr(val);
    else if (!location && oid.startsWith(OID.sysLocation + '.')) location = bufToStr(val);
    else if (!upTicks && oid.startsWith(OID.sysUpTime + '.'))   upTicks  = bufToInt(val);
  }
  const out = {};
  if (descr)    out.sysDescr    = descr;
  if (contact)  out.sysContact  = contact;
  if (location) out.sysLocation = location;
  if (upTicks > 0) {
    out.sysUpTimeTicks = upTicks;
    out.sysUpTimeText  = _formatUptime(upTicks);
  }
  return Object.keys(out).length ? out : null;
}

// ---- Printer-MIB ----------------------------------------------------------
const _PRT_STATUS = { 1: 'other', 2: 'unknown', 3: 'idle', 4: 'printing', 5: 'warmup' };
const _PRT_TYPE   = { 3: 'toner', 4: 'wasteToner', 5: 'ink', 6: 'inkCartridge', 8: 'opc',
                      9: 'developer', 10: 'fuserOil', 21: 'wasteInk' };

// Deriva la chiave colore (cyan/magenta/yellow/black/other) dal nome colorante
// o dalla descrizione. Brand-agnostico; la UI mappa la chiave allo swatch.
function _supplyColorKey(label) {
  const s = String(label || '').toLowerCase();
  if (/black|nero|\bk\b/.test(s))   return 'black';
  if (/cyan|ciano/.test(s))         return 'cyan';
  if (/magenta/.test(s))            return 'magenta';
  if (/yellow|giallo/.test(s))      return 'yellow';
  return 'other';
}

/**
 * Estrae i dati Printer-MIB (materiali di consumo + contapagine + stato) da una
 * mappa di varbind. Pura/testabile. Ritorna null se l'agente non è una stampante
 * (nessun supply, nessun contapagine, nessuno stato) → niente card sui non-printer.
 * % toner = livello / capacità-max (entrambi >0); i valori speciali (-1 ignoto,
 * -2 illimitato, -3 "resta qualcosa") lasciano pct assente.
 */
function extractPrinter(vbs) {
  const sup = {};        // supplyIdx → { desc, type, cls, colorantIdx, max, level }
  const colorants = {};  // colorantIdx → nome
  let pageCount = 0, status = 0, hasError = false;

  for (const [oid, val] of Object.entries(vbs || {})) {
    if (oid.startsWith(PRT_OID.prtSupplyDesc + '.'))          (sup[lastIdx(oid)] ??= {}).desc        = bufToStr(val);
    else if (oid.startsWith(PRT_OID.prtSupplyType + '.'))     (sup[lastIdx(oid)] ??= {}).type        = bufToInt(val);
    else if (oid.startsWith(PRT_OID.prtSupplyClass + '.'))    (sup[lastIdx(oid)] ??= {}).cls         = bufToInt(val);
    else if (oid.startsWith(PRT_OID.prtSupplyColorant + '.')) (sup[lastIdx(oid)] ??= {}).colorantIdx = bufToInt(val);
    else if (oid.startsWith(PRT_OID.prtSupplyMax + '.'))      (sup[lastIdx(oid)] ??= {}).max         = bufToInt(val);
    else if (oid.startsWith(PRT_OID.prtSupplyLevel + '.'))    (sup[lastIdx(oid)] ??= {}).level       = bufToInt(val);
    else if (oid.startsWith(PRT_OID.prtColorantVal + '.'))    colorants[lastIdx(oid)]                = bufToStr(val);
    else if (oid.startsWith(PRT_OID.prtLifeCount + '.'))      { if (!pageCount) pageCount = bufToInt(val); }
    else if (oid.startsWith(PRT_OID.hrPrinterStatus + '.'))   { if (!status) status = bufToInt(val); }
    else if (oid.startsWith(PRT_OID.hrPrinterErr + '.'))      { if (Buffer.isBuffer(val) && val.some(b => b !== 0)) hasError = true; }
  }

  const supplies = Object.entries(sup).map(([idx, r]) => {
    const colorant = (r.colorantIdx && colorants[r.colorantIdx]) || '';
    const label = colorant || r.desc || `Supply ${idx}`;
    const max = Number(r.max), level = Number(r.level);
    const o = { index: parseInt(idx, 10) || 0, name: label, color: _supplyColorKey(label || r.desc) };
    if (r.desc && r.desc !== label) o.desc = r.desc;
    if (max > 0 && level >= 0) o.pct = Math.round((level / max) * 100);
    if (Number.isFinite(level)) o.level = level;
    if (Number.isFinite(max))   o.max = max;
    if (_PRT_TYPE[r.type])      o.type = _PRT_TYPE[r.type];
    if (r.type === 4 || r.cls === 4) o.isWaste = true;
    return o;
  }).sort((a, b) => a.index - b.index);

  const out = {};
  if (supplies.length) out.supplies = supplies;
  if (pageCount > 0)   out.pageCount = pageCount;
  if (status > 0)      out.status = _PRT_STATUS[status] || 'other';
  if (hasError)        out.hasError = true;
  return (supplies.length || pageCount > 0 || status > 0) ? out : null;
}

// ---- HOST-RESOURCES -------------------------------------------------------
const _HR_STORAGE = { 1: 'other', 2: 'ram', 3: 'virtualMemory', 4: 'fixedDisk',
                      5: 'removableDisk', 6: 'floppyDisk', 7: 'compactDisc',
                      8: 'ramDisk', 9: 'flashMemory', 10: 'networkDisk' };
// Pseudo-filesystem da scartare (tmpfs/kernel) — rumore su Linux/NAS.
const _HR_PSEUDO_RE = /^\/(dev|sys|proc|run|tmp)(\/|$)/i;

// `a` è prefisso-di-path di `b` (o viceversa)? Per de-duplicare bind-mount e
// sottovolumi (es. /volume1 ⊃ /volume1/@docker). La root "/" non assorbe nulla.
function _isPathPrefix(a, b) {
  if (!a || !b) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (l === s) return true;
  if (s === '/') return false;
  return l.startsWith(s + '/');
}

/**
 * Estrae CPU (media hrProcessorLoad), RAM e dischi (hrStorageTable) da una mappa
 * di varbind. Pura/testabile. Ritorna null se l'agente non espone HOST-RESOURCES.
 * Filtra le pseudo-fs e de-duplica i bind-mount/sottovolumi; % = usato/dimensione.
 */
function extractHostResources(vbs) {
  const cpu = [];
  const st = {};   // storageIdx → { typeCode, descr, units, size, used }
  for (const [oid, val] of Object.entries(vbs || {})) {
    if (oid.startsWith(HR_OID.hrProcessorLoad + '.')) { const n = bufToInt(val); if (n >= 0 && n <= 100) cpu.push(n); }
    else if (oid.startsWith(HR_OID.hrStorageType + '.'))  (st[lastIdx(oid)] ??= {}).typeCode = parseInt(String(bufToStr(val)).split('.').pop(), 10) || 0;
    else if (oid.startsWith(HR_OID.hrStorageDescr + '.')) (st[lastIdx(oid)] ??= {}).descr = bufToStr(val);
    else if (oid.startsWith(HR_OID.hrStorageUnits + '.')) (st[lastIdx(oid)] ??= {}).units = bufToInt(val);
    else if (oid.startsWith(HR_OID.hrStorageSize + '.'))  (st[lastIdx(oid)] ??= {}).size  = bufToInt(val);
    else if (oid.startsWith(HR_OID.hrStorageUsed + '.'))  (st[lastIdx(oid)] ??= {}).used  = bufToInt(val);
  }
  const rows = Object.values(st);

  // RAM (type 2) — prima riga utile
  let ram = null;
  const ramRow = rows.find(r => r.typeCode === 2 && r.size > 0);
  if (ramRow) {
    const u = ramRow.units || 1;
    ram = { pct: Math.round((ramRow.used / ramRow.size) * 100),
            usedBytes: ramRow.used * u, totalBytes: ramRow.size * u };
  }

  // Volumi (fixedDisk/flash/networkDisk), senza pseudo-fs, dedup bind-mount.
  let vols = rows.filter(r => [4, 9, 10].includes(r.typeCode) && r.size > 0 && !_HR_PSEUDO_RE.test(r.descr || ''));
  vols.sort((a, b) => (a.descr || '').length - (b.descr || '').length); // i genitori prima
  vols = vols.filter((r, i) => !vols.some((o, j) =>
    j < i && o.size === r.size && o.used === r.used && _isPathPrefix(o.descr, r.descr)));
  const volumes = vols.map(r => {
    const u = r.units || 1;
    return { name: r.descr || '?', kind: _HR_STORAGE[r.typeCode] || 'disk',
             pct: Math.round((r.used / r.size) * 100),
             usedBytes: r.used * u, totalBytes: r.size * u };
  }).sort((a, b) => b.totalBytes - a.totalBytes).slice(0, 6);

  const out = {};
  if (cpu.length) { out.cpuLoad = Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length); out.cpuCores = cpu.length; }
  if (ram) out.ram = ram;
  if (volumes.length) out.volumes = volumes;
  return (out.cpuLoad !== undefined || out.ram || out.volumes) ? out : null;
}

function _entityPriorityScore(row) {
  let score = 0;
  if (row.class === 3) score += 100;      // chassis
  else if (row.class === 9) score += 75;  // module
  else if (row.class === 10) score += 70; // port/module-like on some agents
  else if (row.class === 1) score += 45;  // other
  if (row.brand) score += 12;
  if (row.model) score += 12;
  if (row.serialNumber) score += 10;
  if (row.softwareRev || row.firmwareRev) score += 8;
  if (row.description && !/power supply|fan|sensor|transceiver|sfp|slot|port/i.test(row.description)) score += 4;
  return score;
}

function logicalLagIdFromName(name) {
  const m = String(name || '').trim().match(/^(?:port-?channel|po|lag|trk|eth-?trunk|bundle-?ether|bridge-?aggregation|bond|ae|reth|bagg)\s*[-_/]?\s*(\d+)$/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Nomi di interfacce virtuale/software noti.
 * Usato come fallback quando il MAC non è disponibile o il vendor
 * assegna MAC reali anche alle interfacce bridge (es. Docker su Linux).
 */
const VIRTUAL_IF_RE = /^(docker|br-|veth|virbr|tun|tap|dummy|sit|ip6tnl|ovs|lxc|lxd|flannel|cni|calic|weave|cilium|vlan|macvlan|ipvlan|gre|wg)/;

// ---- walk ------------------------------------------------------------------

async function walkSession(session) {
  const result = {};
  // Fail-fast: interroga prima il solo sysName come test di raggiungibilità.
  // Se non risponde, il device è giù → esci subito (evita di attendere il
  // timeout di tutte le altre walk, che con la concorrenza limitata si
  // sommerebbero in sequenza allungando enormemente l'attesa su host morti).
  await _runWalks(session, [OID.sysName], result, 'SNMP');
  const hasSysName = Object.keys(result).some(oid => oid.startsWith(OID.sysName + '.'));
  if (!hasSysName) {
    throw new Error('Host irraggiungibile o SNMP non risponde (sysName non risponde)');
  }
  // Device raggiungibile: interroga il resto degli OID a concorrenza limitata,
  // così non si sommerge l'agente SNMP (root-cause del troncamento delle walk).
  const rest = BASE_OIDS.filter(b => b !== OID.sysName);
  await _runWalks(session, rest, result, 'SNMP');
  return result;
}

// ---- data extraction -------------------------------------------------------

function extractData(vbs) {
  const ifaces = {};
  const bpToIf = {};
  let hostname  = '';

  // tabelle scalari per interfaccia
  const tables = [
    { base: OID.ifDescr,       field: 'name',    conv: bufToStr },
    { base: OID.ifType,        field: 'type',    conv: bufToInt },
    { base: OID.ifPhysAddress, field: 'macBuf',  conv: v => v },   // raw buffer per isRealMac()
    { base: OID.ifOperStatus,  field: 'oper',    conv: bufToInt },
    { base: OID.ifSpeed,       field: 'speed',
      conv: v => { const s = bufToInt(v); return s >= 0xFFFFFFFF ? 0 : Math.round(s / 1_000_000); } },
    { base: OID.ifHighSpeed,   field: 'hispeed', conv: bufToInt },
    { base: OID.ifAlias,       field: 'alias',   conv: bufToStr },
  ];

  // Per-port VLAN membership (trunk detection)
  const portEgress   = {};
  const portUntagged = {};
  // PVID raw: bridgePort → vlanId — risolto dopo che bpToIf è completo
  const rawPvid = {};
  // Tutti gli ID VLAN definiti sullo switch (da OID key dot1qVlanEgressPorts.{vlanId})
  // — include anche VLAN senza porte assegnate (bitmap vuota)
  const allVlanIds = new Set();
  // Cisco VTP trunk port table (fallback per Q-BRIDGE vuoto senza @vlan community)
  const ciscoDynState    = {}; // ifIdx → number: 1=on, 2=off/access, 3=desirable, 4=auto, 5=onNoNeg
  const ciscoTrunkActive = {}; // ifIdx → boolean: true=trunking (operativo) — su IOS virtuale può essere true anche per porte access!
  const ciscoTrunkVlans  = {}; // ifIdx → Set<vlanId> (VLAN abilitate sul trunk)

  // MAU type (RFC 4836): ifIndex → last OID suffix (encodes physical medium)
  const mauTypes = {}; // e.g. mauTypes[3] = 14 → dot3MauType100BaseTX
  // PoE (RFC 3621): "grp.portIdx" suffix → { status, class }
  const poeMap   = {};

  // ---- Singolo passo su tutti i VarBind -------------------------------------
  // Sostituisce 11 iterazioni separate:
  //   hostname (×1) + tabelle scalari (×7) + bridgePortIf (×1)
  //   + dot1qPvid (×1) + VLAN bitmaps egress/untagged (×1)
  // I livelli LAG (L0/L1/L2) rimangono passi separati poiché condizionali
  // e richiedono ifaces già popolato.
  // --------------------------------------------------------------------------
  for (const [oid, val] of Object.entries(vbs)) {
    // sysName — prendiamo il primo match
    if (!hostname && oid.startsWith(OID.sysName + '.')) {
      hostname = bufToStr(val); continue;
    }

    // tabelle scalari per-interfaccia (7 prefissi, uscita anticipata al primo match)
    let hit = false;
    for (const t of tables) {
      if (oid.startsWith(t.base + '.')) {
        const idx = lastIdx(oid);
        (ifaces[idx] ??= {})[t.field] = t.conv(val);
        hit = true; break;
      }
    }
    if (hit) continue;

    // bridge port → ifIndex
    if (oid.startsWith(OID.bridgePortIf + '.')) {
      bpToIf[lastIdx(oid)] = bufToInt(val); continue;
    }

    // PVID — raccolto raw, risolto dopo (bpToIf potrebbe non essere ancora completo)
    if (oid.startsWith(OID.dot1qPvid + '.')) {
      rawPvid[lastIdx(oid)] = bufToInt(val) || 1; continue;
    }

    // VLAN egress / untagged bitmaps (trunk detection)
    const isEg = oid.startsWith(OID.dot1qVlanEgressPorts + '.');
    if (isEg || oid.startsWith(OID.dot1qVlanUntaggedPorts + '.')) {
      const vlanId = lastIdx(oid);
      if (vlanId && vlanId <= 4094) {
        // L'ID VLAN è nel suffisso OID: catturato anche se la bitmap è vuota
        // (VLAN definita sullo switch ma non ancora assegnata a nessuna porta)
        if (isEg) allVlanIds.add(vlanId);
        const bits = decodePortList(Buffer.isBuffer(val) ? val : Buffer.alloc(0));
        const tgt  = isEg ? portEgress : portUntagged;
        for (const bp of bits) (tgt[bp] ??= new Set()).add(vlanId);
      }
      continue;
    }

    // dot1qVlanStaticName — tabella statica Q-BRIDGE, indicizzata solo per VlanIndex.
    // NON aggiungiamo a allVlanIds qui: su Cisco IOS restituisce tutte le 1023 VLAN
    // predefinite del dominio VTP, gonfiando l'elenco con VLAN inutilizzate.
    // Le VLAN reali vengono raccolte dai PVID delle porte e dai trunk VLAN.
    if (oid.startsWith(OID.dot1qVlanStaticName + '.')) {
      continue;
    }

    // vtpVlanName — Cisco VTP MIB proprietario, indice {domainIdx}.{vlanId}.
    // NON aggiungiamo a allVlanIds qui: il dominio VTP Cisco pre-crea 1023 VLAN
    // di default → si ritroverebbero VLAN 1-1023 nell'elenco anche se inutilizzate.
    // Le VLAN reali vengono raccolte dai PVID delle porte e dai trunk VLAN.
    if (oid.startsWith(OID.vtpVlanName + '.')) {
      continue;
    }

    // vlanTrunkPortDynamicState — Cisco: stato configurato del trunk per ifIndex.
    // 1=on (trunk esplicito), 2=off (access esplicito), 3=desirable, 4=auto, 5=onNoNegotiate.
    // Più affidabile di vlanTrunkPortStatus su dispositivi Cisco virtuali (IOSv/VIOS)
    // dove status=1 viene restituito erroneamente anche per porte access.
    if (oid.startsWith(OID.vlanTrunkPortDynState + '.')) {
      ciscoDynState[lastIdx(oid)] = bufToInt(val);
      continue;
    }

    // vlanTrunkPortDynamicStatus — Cisco: stato operativo trunking (1=trunking, 2=notTrunking).
    // ATTENZIONE: su Cisco IOSv/VIOS restituisce 1 anche per porte access → usare come
    // indicatore secondario solo quando vlanTrunkPortDynamicState non è disponibile.
    if (oid.startsWith(OID.vlanTrunkPortStatus + '.')) {
      ciscoTrunkActive[lastIdx(oid)] = bufToInt(val) === 1;
      continue;
    }

    // vlanTrunkPortVlansEnabled — Cisco: bitmap 128 byte delle VLAN 0-1023 abilitate per ifIndex.
    // MSB del byte 0 = VLAN 0 (mai usata); bit successivo = VLAN 1 ecc.
    // Con decodePortList: decoded è 1-based con offset VLAN0 → vlanId = decoded - 1.
    if (oid.startsWith(OID.vlanTrunkPortVlans + '.')) {
      const ifIdx = lastIdx(oid);
      const bits  = decodePortList(Buffer.isBuffer(val) ? val : Buffer.alloc(0));
      if (!ciscoTrunkVlans[ifIdx]) ciscoTrunkVlans[ifIdx] = new Set();
      for (const b of bits) {
        const vId = b - 1; // offset: decoded=1→VLAN0, decoded=2→VLAN1, ...
        if (vId >= 1 && vId <= 1023) ciscoTrunkVlans[ifIdx].add(vId);
      }
      continue;
    }

    // MAU type — ifMauType OID value returned as an OID string "1.3.6.1.2.1.26.4.X"
    // Last suffix integer encodes the physical medium type (RFC 4836 §4)
    if (oid.startsWith(OID.mauType + '.')) {
      const ifIdx   = lastIdx(oid);
      const valStr  = Buffer.isBuffer(val) ? val.toString('ascii') : String(val ?? '');
      const mauCode = parseInt(valStr.split('.').pop()) || 0;
      if (mauCode > 0) mauTypes[ifIdx] = mauCode;
      continue;
    }

    // PoE — pethPsePortDetectionStatus indexed by grp.portIdx (grp is almost always 1)
    if (oid.startsWith(OID.pethDetect + '.')) {
      const sfx = oid.slice(OID.pethDetect.length + 1);
      (poeMap[sfx] ??= {}).status = bufToInt(val);
      continue;
    }

    // PoE — pethPsePortPowerClassifications indexed by grp.portIdx
    if (oid.startsWith(OID.pethClass + '.')) {
      const sfx = oid.slice(OID.pethClass.length + 1);
      (poeMap[sfx] ??= {}).class = bufToInt(val);
      continue;
    }
  }

  // ---- Post-processing: risolvi PVID e costruisci ifToBp -------------------
  for (const [bpStr, vlanId] of Object.entries(rawPvid)) {
    const ix = bpToIf[parseInt(bpStr, 10)];
    if (ix !== undefined) (ifaces[ix] ??= {}).vlan = vlanId;
  }

  // ifIndex → bridge port (reverse, needed for trunk detection)
  const ifToBp = {};
  for (const [bp, ix] of Object.entries(bpToIf)) ifToBp[ix] = parseInt(bp, 10);

  // ==========================================================================
  // L0 — ifStackTable (primario)
  // Entrata OID: ifStackStatus.{H}.{L} → RowStatus=1 (active)
  // H con ifType=161 → aggregatore LAG; L → porta fisica membro.
  // ==========================================================================
  let l0Found = false;

  for (const [oid, val] of Object.entries(vbs)) {
    if (!oid.startsWith(OID.ifStackStatus + '.')) continue;
    if (bufToInt(val) !== 1) continue;
    const suffix = oid.slice(OID.ifStackStatus.length + 1);
    const dot    = suffix.indexOf('.');
    if (dot < 0) continue;
    const H = parseInt(suffix.slice(0, dot));
    const L = parseInt(suffix.slice(dot + 1));
    if (!H || !L) continue;
    if (((ifaces[H] && ifaces[H].type) || 0) !== 161) continue;
    if (!ifaces[L]) ifaces[L] = {};
    ifaces[L].lagId  = H;
    ifaces[L].lagSrc = 'stack';
    l0Found = true;
  }

  // ==========================================================================
  // L1 — dot3adAggMemberPorts bitmap (secondario, solo se L0 vuoto)
  // ==========================================================================
  let l1Found = false;
  // Indice nome-interfaccia → ifIndex (per i vendor che elencano i membri LAG per nome).
  const ifIndexByName = {};
  for (const [ixStr, f] of Object.entries(ifaces)) if (f.name) ifIndexByName[f.name] = Number(ixStr);

  if (!l0Found) {
    for (const [oid, val] of Object.entries(vbs)) {
      if (!oid.startsWith(OID.aggMemberPorts + '.')) continue;
      const aggIfIndex = lastIdx(oid);
      const buf = Buffer.isBuffer(val) ? val : Buffer.alloc(0);

      // Rilevamento BRAND-AGNOSTICO del formato di dot3adAggPortListPorts.
      // Lo standard prevede una PortList binaria, ma diversi vendor (es. ArubaCX)
      // restituiscono una STRINGA testuale dei nomi porta ("1/1/1,1/1/2,1/1/3",
      // "Gi0/1 Gi0/2", ecc.). Invece di indovinare dai separatori, proviamo a
      // interpretarlo come lista di nomi e lo accettiamo SOLO se i token
      // corrispondono a interfacce reali del device — test indipendente da
      // vendor, separatore e formato del nome. Una PortList binaria contiene
      // byte non-ASCII (o token che non matchano alcun ifName) → cade nel ramo
      // bitmap standard.
      let memberIxs = null;
      if (buf.length > 0 && /^[\x20-\x7e]+$/.test(buf.toString('latin1'))) {
        const tokens = buf.toString('latin1').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
        const matched = tokens.map(t => ifIndexByName[t]).filter(ix => ix !== undefined);
        // È una lista di nomi se almeno la metà dei token sono interfacce reali.
        if (tokens.length && matched.length >= Math.ceil(tokens.length / 2)) memberIxs = matched;
      }

      if (memberIxs) {
        for (const ix of memberIxs) {
          if (!ifaces[ix]) ifaces[ix] = {};
          ifaces[ix].lagId  = aggIfIndex;
          ifaces[ix].lagSrc = 'memberlist';
          l1Found = true;
        }
        continue;
      }

      // PortList binaria standard (IEEE 802.1D): bit → bridge port → ifIndex.
      const memberPorts = decodePortList(buf);
      if (memberPorts.length === 0) continue;
      for (const bp of memberPorts) {
        const ix = bpToIf[bp];
        if (ix === undefined) continue;
        if (!ifaces[ix]) ifaces[ix] = {};
        ifaces[ix].lagId  = aggIfIndex;
        ifaces[ix].lagSrc = 'bitmap';
        l1Found = true;
      }
    }
  }

  // ==========================================================================
  // L2 — AttachedAggID (.11) + ActorOperState (.14)  (solo se L0+L1 vuoti)
  //
  // Logica adattiva sul bit Synchronization:
  //   anySync=true  → LACP attivo → richiedi Sync=1 per confermare membership
  //   anySync=false → LAG statico → non richiedere Sync
  //
  // Anti-falso-positivo: se >90% delle porte fisiche riporta lo stesso lagId
  // tramite .11, è un bug firmware (vendor pre-assegna l'aggregatore a tutte
  // le porte). In questo caso l'intera rilevazione L2 viene scartata.
  // ==========================================================================

  if (!l0Found && !l1Found) {

    // Leggi .11
    for (const [oid, val] of Object.entries(vbs)) {
      if (!oid.startsWith(OID.lagAttached + '.')) continue;
      const ix    = lastIdx(oid);
      const lagId = bufToInt(val);
      if (lagId > 0) {
        if (!ifaces[ix]) ifaces[ix] = {};
        ifaces[ix].lagId  = lagId;
        ifaces[ix].lagSrc = 'attached';
      }
    }

    // Anti-falso-positivo: conta quante porte fisiche per ogni lagId
    const physIfaces = Object.entries(ifaces)
      .filter(([, f]) => [6, 62, 117].includes(f.type || 6));
    const physCount = physIfaces.length;

    if (physCount > 0) {
      const lagIdCounts = {};
      for (const [, f] of physIfaces) {
        if (f.lagId && f.lagSrc === 'attached') {
          lagIdCounts[f.lagId] = (lagIdCounts[f.lagId] || 0) + 1;
        }
      }
      for (const [lagId, count] of Object.entries(lagIdCounts)) {
        if (count / physCount > 0.9) {
          // Bug firmware: aggregatore pre-assegnato a quasi tutte le porte
          snmpWarn(
            `  [SNMP] LAG falso-positivo: lagId=${lagId} su ${count}/${physCount} porte fisiche` +
            ` (>${Math.round(count/physCount*100)}%) — ignorato. Probabile firmware non standard.`
          );
          for (const [, f] of physIfaces) {
            if (f.lagId === +lagId && f.lagSrc === 'attached') {
              f.lagId  = 0;
              f.lagSrc = undefined;
            }
          }
        }
      }
    }

    // Leggi .14 ActorOperState — solo se rimangono porte con lagSrc='attached'
    const anyAttached = physIfaces.some(([, f]) => f.lagSrc === 'attached');
    if (anyAttached) {
      let anySync = false;
      for (const [oid, val] of Object.entries(vbs)) {
        if (!oid.startsWith(OID.lagOperState + '.')) continue;
        const ix      = lastIdx(oid);
        const rawByte = Buffer.isBuffer(val) ? val[0] : (bufToInt(val) & 0xFF);
        const sync    = !!(rawByte & 0x08);
        if (!ifaces[ix]) ifaces[ix] = {};
        ifaces[ix].lagOperSync = sync;
        if (sync) anySync = true;
      }
      // Propaga il flag globale LACP alle porte attached
      for (const [, f] of physIfaces) {
        if (f.lagSrc === 'attached') f.lacpActive = anySync;
      }
    }
  }

  // ==========================================================================
  // Separazione fisici / LAG + validazione lagId finale
  // ==========================================================================

  const lagIfIndexes = new Set();
  for (const [idxStr, f] of Object.entries(ifaces)) {
    if ((f.type || 0) === 161) lagIfIndexes.add(Number(idxStr));
  }

  // ---- Diagnostica completa interfacce con bridge port o trunk ----------------
  snmpDebug(`  [IFACES] ${hostname||'?'}: totale ifaces=${Object.keys(ifaces).length}, bridge ports trovati=${Object.keys(ifToBp).length}`);
  for (const [idxStr, f] of Object.entries(ifaces)) {
    const idx = Number(idxStr);
    const bp  = ifToBp[idx];
    if (bp === undefined) continue; // mostra solo quelle con bridge port
    const eg = portEgress[bp]   || new Set();
    const un = portUntagged[bp] || new Set();
    const trunk = [...eg].some(v => !un.has(v));
    snmpDebug(`    ifIdx=${idx} name="${f.name||'?'}" type=${f.type||6} bp=${bp} egress=[${[...eg].join(',')}] untagged=[${[...un].join(',')}] isTrunk=${trunk}`);
  }
  // ----------------------------------------------------------------------------

  // MAU-MIB physical medium lookup (RFC 4836 §4 type codes):
  // Copper (twisted pair / coax) suffixes:
  const _MAU_COPPER = new Set([1,2,3,7,8,9,12,13,14,17,18,25,26,27,28,40,41,52,55,95,100]);
  // DAC / Twinax suffixes:
  const _MAU_DAC    = new Set([39,96,101]);
  // All other known suffixes are treated as fiber (SX/LX/ZX/ER/SR/LR/…)

  const physical = [], lags = [];
  const _classify = []; // diagnostica: decisione di classificazione per ogni ifIndex
  const lagLogicalByIfIndex = {};
  for (const [idxStr, f] of Object.entries(ifaces)) {
    const idx = Number(idxStr);
    const logical = logicalLagIdFromName(f.name);
    if (logical > 0) lagLogicalByIfIndex[idx] = logical;
  }

  for (const idx of Object.keys(ifaces).map(Number).sort((a, b) => a - b)) {
    const f     = ifaces[idx];
    const t     = f.type || 6;
    const speed = f.hispeed > 0 ? f.hispeed : (f.speed || 0);

    let lagId = 0;
    const rawLagId = f.lagId || 0;

    if (rawLagId > 0) {
      switch (f.lagSrc) {
        case 'stack':       // ifStackTable (RFC 2863): config esplicita
        case 'bitmap':      // dot3adAggPortListPorts: bitmap binaria standard
        case 'memberlist':  // dot3adAggPortListPorts: lista testuale nomi porta (es. ArubaCX)
          lagId = rawLagId; // autoritative
          break;
        case 'attached': {
          const aggOk  = lagIfIndexes.size === 0 || lagIfIndexes.has(rawLagId);
          // Se LACP attivo richiedi Sync; se statico non richiederlo
          const syncOk = !f.lacpActive || (f.lagOperSync === true);
          if (aggOk && syncOk) lagId = rawLagId;
          break;
        }
      }
    }
    const lagIfIndex = lagId;
    const lagLogicalId = lagLogicalByIfIndex[lagIfIndex] || logicalLagIdFromName(f.name) || lagId;

    const mac = macToStr(f.macBuf);

    // Trunk / access dal dot1q VLAN membership (solo se bridge port noto)
    let isTrunk    = false;
    let trunkVlans = [];
    const bp = ifToBp[idx];
    if (bp !== undefined) {
      const eg = portEgress[bp]   || new Set();
      const un = portUntagged[bp] || new Set();
      // Trunk se almeno un VLAN è tagged (egress ma non untagged)
      isTrunk = [...eg].some(v => !un.has(v));
      if (isTrunk) trunkVlans = [...eg].sort((a, b) => a - b);
    }

    // SNMP-detected physical medium (MAU-MIB RFC 4836)
    const _mauSuf    = mauTypes[idx] || 0;
    const snmpMedium = _mauSuf
      ? (_MAU_DAC.has(_mauSuf) ? 'dac' : _MAU_COPPER.has(_mauSuf) ? 'copper' : 'fiber')
      : null;

    // SNMP-detected PoE standard (POWER-ETHERNET-MIB RFC 3621)
    // poeMap keyed by "grp.portIdx"; grp=1 in practice.
    // Try exact ifIndex match first, then positional fallback (1-based physical order).
    const _poeOrder = physical.length + 1;
    const _poeEntry = poeMap[`1.${idx}`] || poeMap[`1.${_poeOrder}`] || null;
    let snmpPoe = null;
    if (_poeEntry?.status !== undefined) {
      snmpPoe = _poeEntry.status === 3  // 3 = deliveringPower
        ? ((_poeEntry.class ?? 0) <= 3 ? '802.3af'
          : (_poeEntry.class ?? 0) === 4 ? '802.3at' : '802.3bt')
        : 'none';
    }

    const obj = { index: idx, name: f.name || `if${idx}`, alias: f.alias || '',
                  operStatus: f.oper || 2, speed, vlan: f.vlan || 1, lagId: lagLogicalId, lagIfIndex, mac,
                  isTrunk, trunkVlans };
    if (snmpMedium)    obj.snmpMedium = snmpMedium;
    if (snmpPoe !== null) obj.snmpPoe = snmpPoe;

    if ([6, 62, 117].includes(t)) {
      /*
       * Strategia a cascata MAC → nome per distinguere fisiche da virtuali.
       *
       * 1. MAC reale + nome NON virtuale → fisica          ✅ includi
       * 2. MAC reale + nome virtuale     → bridge con MAC  ❌ escludi
       *    (docker0, br-* su Linux hanno MAC reale ma sono software)
       * 3. Nessun MAC + nome NON virtuale → fisica su vendor
       *    che non espongono ifPhysAddress (fallback)       ✅ includi
       * 4. Nessun MAC + nome virtuale    → sicuramente virtuale ❌ escludi
       */
      const hasMac   = isRealMac(f.macBuf);
      const virtName = VIRTUAL_IF_RE.test((f.name || '').toLowerCase());

      if (!virtName) { physical.push(obj); _classify.push({ idx, name: obj.name, type: t, mac: mac||'-', r: 'PHYS' }); }
      else _classify.push({ idx, name: obj.name, type: t, mac: mac||'-', r: 'SKIP nome-virtuale' });
      // caso 2 e 4: nome virtuale → escludi (indipendentemente dal MAC)
    }
    else if (t === 161) { lags.push(obj); _classify.push({ idx, name: obj.name, type: t, mac: mac||'-', r: 'LAG (ifType=161)' }); }
    // Aggiungi anche aggregatori con tipo=53 (propVirtual) il cui nome corrisponde
    // a pattern di aggregazione (Cisco Port-channel, Linux bond, Juniper ae, ecc.)
    else if (t === 53 && /^(port-?channel|bond\d*|ae\d|po\d+$|lag\d)/i.test(f.name||'')) { lags.push(obj); _classify.push({ idx, name: obj.name, type: t, mac: mac||'-', r: 'LAG (ifType=53)' }); }
    else _classify.push({ idx, name: obj.name, type: t, mac: mac||'-', r: `SKIP ifType=${t} (non fisico)` });
  }

  // ---- Diagnostica classificazione: quante e quali interfacce incluse/scartate ----
  // Attivabile con DEBUG_SNMP=1. Utile quando il conteggio porte non corrisponde
  // al numero reale (es. una SFP con ifType anomalo o un nome che matcha un
  // pattern virtuale viene scartata).
  const _skipped = _classify.filter(c => c.r.startsWith('SKIP'));
  snmpDebug(`  [CLASSIFY] ${hostname||'?'}: ${_classify.length} ifaces → ${physical.length} fisiche, ${lags.length} LAG, ${_skipped.length} scartate`);
  _classify.forEach(c => snmpDebug(`    ifIdx=${String(c.idx).padStart(3)} type=${String(c.type).padStart(3)} mac=${c.mac.padEnd(17)} "${c.name}" → ${c.r}`));

  // ---- Cisco VTP trunk fallback (per porte senza bridge port o con Q-BRIDGE vuota) ----
  //
  // Logica di decisione a 3 livelli:
  //
  //   Livello A — vlanTrunkPortDynamicState (stato CONFIGURATO, più affidabile):
  //     dynState=1 (on) o 5 (onNoNegotiate) → trunk esplicito → isTrunk=true
  //     dynState=2 (off/access)              → access esplicito → salta
  //
  //   Livello B — DTP dinamico (dynState=3/4): usa status + conta VLAN
  //     status=trunking AND 2 ≤ vlCount ≤ 500 → trunk DTP negoziato
  //     vlCount>500 → bitmap "all VLANs" su porta access → falso positivo → salta
  //
  //   Livello C — dynState assente (OID non supportata, device non-Cisco):
  //     → nessun fallback Cisco (la Q-BRIDGE detection standard è già stata fatta sopra)
  //
  for (const p of [...physical, ...lags]) {
    if (p.isTrunk) continue; // già rilevato da Q-BRIDGE

    const dynState  = ciscoDynState[p.index]    || 0;  // 0 = OID non risponde
    const dynStatus = ciscoTrunkActive[p.index]  || false;
    const vlSet     = ciscoTrunkVlans[p.index];
    const vlCount   = vlSet ? vlSet.size : 0;

    const isCiscoTrunk =
      // A: porta configurata esplicitamente come trunk
      dynState === 1 || dynState === 5 ||
      // B: DTP dinamico che ha negoziato trunk + VLAN set specifico (non bitmap "all")
      ((dynState === 3 || dynState === 4) && dynStatus && vlCount >= 2 && vlCount <= 500);

    if (isCiscoTrunk) {
      p.isTrunk    = true;
      p.trunkVlans = vlSet ? [...vlSet].filter(v => v >= 1).sort((a, b) => a - b) : [];
      if (p.trunkVlans.length) p.trunkVlans.forEach(v => allVlanIds.add(v));
    }
  }

  // ---- Propaga trunk info dall'aggregatore alle porte fisiche membro ----------
  // Quando le porte sono in LACP bonding, il bridge mappa solo l'aggregatore
  // (ifType=161) nelle tabelle VLAN — le porte fisiche non hanno bridge port.
  // Soluzione: se una porta fisica ha lagId>0, eredita isTrunk/trunkVlans/vlan
  // dall'aggregatore corrispondente (se non già rilevati direttamente).
  const lagByIdx = {};
  for (const l of lags) lagByIdx[l.index] = l;
  for (const p of physical) {
    if (p.lagId > 0 && lagByIdx[p.lagId]) {
      const agg = lagByIdx[p.lagId];
      if (!p.isTrunk && agg.isTrunk) {
        p.isTrunk    = true;
        p.trunkVlans = agg.trunkVlans;
      }
      // Eredita anche il PVID se la porta fisica non ne ha uno proprio
      if (p.vlan === 1 && agg.vlan > 1) p.vlan = agg.vlan;
    }
  }

  // ---- Raccolta PVID delle porte fisiche → allVlanIds -------------------------
  // Fonte primaria per VLAN access: il PVID (dot1qPvid) di ogni porta.
  // Questo evita di dipendere da vtpVlanName / dot1qVlanStaticName che su Cisco
  // restituiscono tutte le 1023 VLAN predefinite del dominio VTP.
  for (const p of physical) {
    if (p.vlan >= 1) allVlanIds.add(p.vlan);
  }
  // ---------------------------------------------------------------------------

  // ---- Diagnostica LAG -------------------------------------------------------
  const lagPorts = physical.filter(p => p.lagId > 0);
  if (lags.length > 0 || lagPorts.length > 0) {
    snmpDebug(`  [LAG] ${hostname||'?'}: aggregatori=${lags.length}, porte-membro=${lagPorts.length}`);
    lags.forEach(l => snmpDebug(`    aggregatore ifIdx=${l.index} name="${l.name}" isTrunk=${l.isTrunk} trunkVlans=${JSON.stringify(l.trunkVlans)}`));
    lagPorts.forEach(p => snmpDebug(`    membro: ifIdx=${p.index} name="${p.name}" lagId=${p.lagId} lagSrc=${ifaces[p.index]?.lagSrc||'?'}`));
  } else {
    snmpDebug(`  [LAG] ${hostname||'?'}: nessun LAG rilevato — L0:${l0Found} L1:${l1Found}`);
    const nStack  = Object.keys(vbs).filter(o => o.startsWith(OID.ifStackStatus  + '.')).length;
    const nAgg    = Object.keys(vbs).filter(o => o.startsWith(OID.aggMemberPorts + '.')).length;
    const nAtt    = Object.keys(vbs).filter(o => o.startsWith(OID.lagAttached    + '.')).length;
    snmpDebug(`    OID presenti: ifStackStatus=${nStack}  aggMemberPorts=${nAgg}  lagAttached=${nAtt}`);
  }
  // Stampa tutte le interfacce fisiche con isTrunk=true per diagnostica trunk
  const trunkPhysical = physical.filter(p => p.isTrunk);
  snmpDebug(`  [TRUNK] ${hostname||'?'}: interfacce trunk in physical=${trunkPhysical.length}`);
  trunkPhysical.forEach(p => snmpDebug(`    trunk: ifIdx=${p.index} name="${p.name}" lagId=${p.lagId} vlans=${JSON.stringify(p.trunkVlans)}`));
  const trunkLags = lags.filter(l => l.isTrunk);
  if(trunkLags.length > 0) trunkLags.forEach(l => snmpDebug(`    trunk-lag: ifIdx=${l.index} name="${l.name}" vlans=${JSON.stringify(l.trunkVlans)}`))
  // ---------------------------------------------------------------------------

  const vlansOut = [...allVlanIds].sort((a, b) => a - b);
  const inventory = extractEntityInventory(vbs);
  const system = extractSystem(vbs);
  const printer = extractPrinter(vbs);
  const hostResources = extractHostResources(vbs);
  snmpDebug(`  [VLANS] ${hostname||'?'}: ${vlansOut.length} VLAN rilevate (PVID+egress+trunk): [${vlansOut.join(',')}]`);
  return { hostname, interfaces: physical, lags, vlans: vlansOut, inventory, system, printer, hostResources };
}

// ---- Session factory -------------------------------------------------------

/**
 * Crea una sessione SNMP v1/v2c/v3.
 *
 * @param {string} driver   — 'snmp-v1' | 'snmp-v2c' | 'snmp-v3'
 * @param {string} host
 * @param {number} port
 * @param {number} timeout  — già in millisecondi
 * @param {object} cfg      — opzioni driver (community, v3user, v3authProto, …)
 * @param {number} retries  — tentativi dopo il primo (default 1; probe usa 0)
 * @returns {snmp.Session}
 * @throws {Error} per driver non supportato
 */
function _createSnmpSession(driver, host, port, timeout, cfg, retries = 1) {
  // 'auto' è un valore SOLO per probe() (prova v1/v2c/v3). Ovunque altro (poll,
  // crawl neighbour) non ha senso una sessione "auto" → fallback a v2c+community.
  if (driver === 'auto') driver = 'snmp-v2c';
  if (driver === 'snmp-v1' || driver === 'snmp-v2c') {
    return snmp.createSession(host, cfg.community || 'public', {
      port, timeout,
      version: driver === 'snmp-v1' ? snmp.Version1 : snmp.Version2c,
      retries,
    });
  }

  if (driver === 'snmp-v3') {
    const levelMap = {
      noAuthNoPriv: snmp.SecurityLevel.noAuthNoPriv,
      authNoPriv:   snmp.SecurityLevel.authNoPriv,
      authPriv:     snmp.SecurityLevel.authPriv,
    };
    const authMap = {
      MD5:    snmp.AuthProtocols.md5,
      SHA:    snmp.AuthProtocols.sha,
      SHA224: snmp.AuthProtocols.sha224,
      SHA256: snmp.AuthProtocols.sha256,
      SHA384: snmp.AuthProtocols.sha384,
      SHA512: snmp.AuthProtocols.sha512,
    };
    const privMap = {
      DES:    snmp.PrivProtocols.des,
      AES:    snmp.PrivProtocols.aes,
      AES256: snmp.PrivProtocols.aes256b,
    };
    return snmp.createV3Session(host, {
      name:         cfg.v3user || '',
      level:        levelMap[cfg.v3secLevel]                          ?? snmp.SecurityLevel.authPriv,
      authProtocol: authMap[(cfg.v3authProto || '').toUpperCase()]    ?? snmp.AuthProtocols.sha,
      authKey:      cfg.v3authPass || '',
      privProtocol: privMap[(cfg.v3privProto || '').toUpperCase()]    ?? snmp.PrivProtocols.aes,
      privKey:      cfg.v3privPass || '',
      // Context name SNMPv3: necessario su alcuni agenti (es. stampanti HP
      // JetDirect → context "jetdirect"). Vuoto = context di default.
    }, { port, timeout, retries, context: cfg.v3context || '' });
  }

  throw new Error(`Driver non supportato: ${driver}`);
}

// ---- public API ------------------------------------------------------------

async function poll(cfg) {
  const host    = (cfg.host || '').trim();
  const port    = parseInt(cfg.port)    || 161;
  const timeout = (parseInt(cfg.timeout) || 3) * 1000;
  const driver  = (cfg.driver || '').toLowerCase();

  if (!host) throw new Error('Host/IP mancante');

  let session;
  try {
    session = _createSnmpSession(driver, host, port, timeout, cfg);
    const vbs = await walkSession(session);
    // Stampanti: secondo passaggio in ISOLAMENTO (concorrenza 1) per il
    // Printer-MIB. Gli stack SNMP deboli (HP JetDirect) troncano i materiali
    // sotto la walk concorrente multi-OID; letti da soli e in sequenza tornano
    // completi. Gate su cfg.printer (la UI sa che è una stampante) → costo zero
    // sugli altri device. Sovrascrive eventuali dati parziali della walk.
    if (cfg.printer) {
      await _runWalks(session, PRINTER_BASES, vbs, 'SNMP-PRT', 1);
    }
    // Device "compute" (server/pc/nas/homelab): HOST-RESOURCES (CPU/RAM/dischi)
    // in un passaggio supplementare. Stack robusti → concorrenza di default ok.
    if (cfg.hostResources) {
      await _runWalks(session, HOSTRES_BASES, vbs, 'SNMP-HR');
    }
    return extractData(vbs);
  } finally {
    try { session?.close(); } catch (_) { /* ignore */ }
  }
}

// ============================================================
//  Neighbor Discovery — LLDP (802.1AB) + CDP (Cisco)
//
//  LLDP OID index format: timeFilter.localPortNum.remoteIndex
//    lldpLocPortDesc .localPortNum          → local port name
//    lldpRemSysName  .0.localPortNum.remIdx → remote hostname
//    lldpRemPortId   .0.localPortNum.remIdx → remote port id
//    lldpRemPortDesc .0.localPortNum.remIdx → remote port description
//
//  CDP OID index format: localIfIndex.remoteIndex
//    cdpCacheDeviceId   .ifIdx.remIdx → remote device name
//    cdpCacheDevicePort .ifIdx.remIdx → remote port name
//    cdpCacheAddressType.ifIdx.remIdx → tipo indirizzo (1=IPv4)
//    cdpCacheAddress    .ifIdx.remIdx → remote IP (su alcuni device 4 byte IPv4 puri)
// ============================================================

const N_OID = {
  sysName:        '1.3.6.1.2.1.1.5',
  ifDescr:        '1.3.6.1.2.1.2.2.1.2',
  lldpLocPortDesc:'1.0.8802.1.1.2.1.3.7.1.3',
  // LLDP-MIB lldpRemEntry (1.0.8802.1.1.2.1.4.1.1.N) — colonne corrette:
  //   .5 ChassisId · .7 PortId · .8 PortDesc · .9 SysName
  lldpRemChassisId:'1.0.8802.1.1.2.1.4.1.1.5', // chassis-id (spesso MAC) → match-by-MAC
  lldpRemPortId:  '1.0.8802.1.1.2.1.4.1.1.7',
  lldpRemPortDesc:'1.0.8802.1.1.2.1.4.1.1.8',
  lldpRemSysName: '1.0.8802.1.1.2.1.4.1.1.9',
  cdpDeviceId:    '1.3.6.1.4.1.9.9.23.1.2.1.1.6',
  cdpDevicePort:  '1.3.6.1.4.1.9.9.23.1.2.1.1.7',
  cdpAddressType: '1.3.6.1.4.1.9.9.23.1.2.1.1.3',
  cdpAddress:     '1.3.6.1.4.1.9.9.23.1.2.1.1.4',
  // LLDP management addresses (IEEE 802.1AB) — IP di management dei vicini LLDP
  // Indice: .1.{col}.{timeFilter}.{localPortNum}.{remIdx}.{addrSubtype}.{addrLen}.{addr bytes}
  lldpRemManAddr: '1.0.8802.1.1.2.1.4.2',
  // MAC FDB — cross-switch inference (Layer 3)
  bridgePortIf:   '1.3.6.1.2.1.17.1.4.1.2',   // bridge port → ifIndex
  fdbPort:        '1.3.6.1.2.1.17.4.3.1.2',    // dot1dTpFdbPort:   MAC → bridge port
  fdbStatus:      '1.3.6.1.2.1.17.4.3.1.3',    // dot1dTpFdbStatus: 3=learned
  // Q-BRIDGE-MIB (VLAN-aware FDB): index = dot1qFdbId + MAC(6)
  qfdbPort:       '1.3.6.1.2.1.17.7.1.2.2.1.2', // dot1qTpFdbPort
  qfdbStatus:     '1.3.6.1.2.1.17.7.1.2.2.1.3', // dot1qTpFdbStatus
  // ARP / IP→MAC (RFC1213 IP-MIB, IPv4)
  arpPhys:        '1.3.6.1.2.1.4.22.1.2', // ipNetToMediaPhysAddress
  arpIp:          '1.3.6.1.2.1.4.22.1.3', // ipNetToMediaNetAddress
  arpType:        '1.3.6.1.2.1.4.22.1.4', // ipNetToMediaType (3=dynamic,4=static)
};

const NEIGHBOR_OIDS = Object.values(N_OID);

async function walkNeighbors(session) {
  const result = {};
  // Fail-fast sulla raggiungibilità (come walkSession): se sysName non
  // risponde, evita di attendere il timeout di tutte le altre walk.
  await _runWalks(session, [N_OID.sysName], result, 'SNMP-NBR');
  const hasSysName = Object.keys(result).some(oid => oid.startsWith(N_OID.sysName + '.'));
  if (!hasSysName) return result; // device giù → nessun vicino (gestito a monte)
  const rest = NEIGHBOR_OIDS.filter(b => b !== N_OID.sysName);
  await _runWalks(session, rest, result, 'SNMP-NBR');
  return result;
}

function extractNeighbors(vbs) {
  const neighbors = [];

  // --- sysName ---
  let hostname = '';
  for (const [oid, val] of Object.entries(vbs)) {
    if (oid.startsWith(N_OID.sysName + '.')) { hostname = bufToStr(val); break; }
  }

  // --- ifDescr: ifIndex → interface name (used for CDP local port) ---
  const ifName = {};
  for (const [oid, val] of Object.entries(vbs)) {
    if (!oid.startsWith(N_OID.ifDescr + '.')) continue;
    ifName[lastIdx(oid)] = bufToStr(val);
  }

  // --- LLDP local port descriptions: localPortNum → portName ---
  const locPortName = {};
  for (const [oid, val] of Object.entries(vbs)) {
    if (!oid.startsWith(N_OID.lldpLocPortDesc + '.')) continue;
    locPortName[lastIdx(oid)] = bufToStr(val);
  }

  // --- LLDP remote entries: collect per (localPortNum, remoteIndex) ---
  const lldpMap = {};

  function lldpEntry(base, setter) {
    for (const [oid, val] of Object.entries(vbs)) {
      if (!oid.startsWith(base + '.')) continue;
      const parts = oid.slice(base.length + 1).split('.');
      // Expect at least 3 parts: timeFilter, localPortNum, remoteIndex
      if (parts.length < 3) continue;
      const localPortNum = parts[parts.length - 2];
      const remoteIndex  = parts[parts.length - 1];
      const key = `${localPortNum}.${remoteIndex}`;
      if (!lldpMap[key]) lldpMap[key] = { localPortNum, remoteIndex };
      setter(lldpMap[key], val);
    }
  }

  // Un identificatore LLDP (chassis-id / port-id) può essere un MAC raw (6 byte):
  // in tal caso va formattato come MAC, non come stringa (che risulterebbe binaria).
  const lldpId = v => (Buffer.isBuffer(v) && v.length === 6) ? macToStr(v) : bufToStr(v);
  lldpEntry(N_OID.lldpRemSysName,   (e, v) => { e.remoteDevice = bufToStr(v); });
  lldpEntry(N_OID.lldpRemChassisId, (e, v) => { e.remoteMac = (Buffer.isBuffer(v) && v.length === 6) ? macToStr(v) : ''; });
  lldpEntry(N_OID.lldpRemPortId,    (e, v) => { if (!e.remotePort) e.remotePort = lldpId(v); });
  lldpEntry(N_OID.lldpRemPortDesc,  (e, v) => { if (!e.remotePort) e.remotePort = bufToStr(v); });

  // --- LLDP management addresses → IP raggiungibile del vicino ---
  // lldpRemManAddrTable (IEEE 802.1AB): l'IP è codificato nell'indice OID, non nel valore.
  // Formato indice: .1.{col}.{timeFilter}.{localPortNum}.{remIdx}.{addrSubtype}.{addrLen}.{b1}.{b2}.{b3}.{b4}
  // addrSubtype=1 → IPv4 (4 byte); tutti gli altri sottotipi vengono ignorati.
  const LLDP_MAN_PFX = N_OID.lldpRemManAddr + '.1.';
  for (const [oid] of Object.entries(vbs)) {
    if (!oid.startsWith(LLDP_MAN_PFX)) continue;
    const parts = oid.slice(LLDP_MAN_PFX.length).split('.');
    // parts: [col, timeFilter, localPortNum, remIdx, addrSubtype, addrLen, b1, b2, b3, b4]
    if (parts.length < 10) continue;
    const addrSubtype = parseInt(parts[4]);
    const addrLen     = parseInt(parts[5]);
    if (addrSubtype !== 1 || addrLen !== 4) continue;   // solo IPv4
    const b = parts.slice(6, 10).map(Number);
    if (b.some(isNaN) || b[0] === 0 || b[0] === 127) continue;       // skip 0.x e loopback
    if (b[0] === 169 && b[1] === 254) continue;                       // skip link-local
    const ip  = b.join('.');
    const key = `${parts[2]}.${parts[3]}`;                            // localPortNum.remIdx
    if (!lldpMap[key]) lldpMap[key] = { localPortNum: parts[2], remoteIndex: parts[3] };
    if (!lldpMap[key].remoteIP) lldpMap[key].remoteIP = ip;
  }

  for (const entry of Object.values(lldpMap)) {
    // Identità del vicino: preferisci il SysName (hostname); se assente (es. device
    // che annunciano solo il chassis-id, come alcuni Zyxel) usa il MAC del chassis,
    // così resta agganciabile via match-by-MAC nel frontend.
    const dev = entry.remoteDevice || entry.remoteMac;
    if (!dev) continue;
    const lpn = parseInt(entry.localPortNum);
    neighbors.push({
      localPort:    locPortName[lpn] || ifName[lpn] || `port${lpn}`,
      remoteDevice: dev,
      remotePort:   entry.remotePort  || '',
      remoteIP:     entry.remoteIP    || '',
      remoteMac:    entry.remoteMac   || '',
      protocol:     'LLDP',
    });
  }

  // --- CDP remote entries ---
  const cdpMap = {};

  function cdpEntry(base, setter) {
    for (const [oid, val] of Object.entries(vbs)) {
      if (!oid.startsWith(base + '.')) continue;
      const parts = oid.slice(base.length + 1).split('.');
      if (parts.length < 2) continue;
      const localIfIndex = parts[0];
      const remoteIndex  = parts[1];
      const key = `${localIfIndex}.${remoteIndex}`;
      if (!cdpMap[key]) cdpMap[key] = { localIfIndex, remoteIndex };
      setter(cdpMap[key], val);
    }
  }

  cdpEntry(N_OID.cdpDeviceId,   (e, v) => { e.remoteDevice = bufToStr(v); });
  cdpEntry(N_OID.cdpDevicePort, (e, v) => { e.remotePort   = bufToStr(v); });
  cdpEntry(N_OID.cdpAddressType,(e, v) => { e.remoteAddrType = bufToInt(v); });
  cdpEntry(N_OID.cdpAddress,    (e, v) => {
    // cdpCacheAddress:
    //  - molti device: 4 byte IPv4 puri
    //  - alcuni Cisco: 1 byte type + 4 byte IPv4
    const buf = Buffer.isBuffer(v) ? v : Buffer.alloc(0);
    if (buf.length === 4) {
      e.remoteIP = `${buf[0]}.${buf[1]}.${buf[2]}.${buf[3]}`;
    } else if (buf.length >= 5 && buf[0] === 1) {
      e.remoteIP = `${buf[1]}.${buf[2]}.${buf[3]}.${buf[4]}`;
    } else if ((e.remoteAddrType === 1) && buf.length >= 4) {
      e.remoteIP = `${buf[0]}.${buf[1]}.${buf[2]}.${buf[3]}`;
    }
  });

  for (const entry of Object.values(cdpMap)) {
    if (!entry.remoteDevice) continue;
    const ix = parseInt(entry.localIfIndex);
    neighbors.push({
      localPort:    ifName[ix] || `ifIndex:${ix}`,
      remoteDevice: entry.remoteDevice,
      remotePort:   entry.remotePort || '',
      remoteIP:     entry.remoteIP   || '',
      protocol:     'CDP',
    });
  }

  // ---- MAC FDB table (Layer 3: cross-switch inference) ----------------------
  //
  // Builds: fdbTable = { "aa:bb:cc:dd:ee:ff" → "GigabitEthernet0/1", ... }
  // Only includes dynamically learned MACs (dot1dTpFdbStatus = 3).
  // The frontend can cross-reference these MACs with known interface MACs
  // (from /api/poll ifPhysAddress) to infer physical adjacency.

  // Step 1 – bridge port number → ifIndex
  const bpToIf = {};
  for (const [oid, val] of Object.entries(vbs)) {
    if (!oid.startsWith(N_OID.bridgePortIf + '.')) continue;
    bpToIf[lastIdx(oid)] = bufToInt(val);
  }

  // Step 2a – BRIDGE-MIB status map: mac → status
  const fdbStatusMap = {};
  for (const [oid, val] of Object.entries(vbs)) {
    if (!oid.startsWith(N_OID.fdbStatus + '.')) continue;
    const suffix = oid.slice(N_OID.fdbStatus.length + 1).split('.');
    if (suffix.length !== 6) continue;
    const mac = suffix.map(b => parseInt(b, 10).toString(16).padStart(2, '0')).join(':');
    fdbStatusMap[mac] = bufToInt(val);
  }

  // Step 2b – Q-BRIDGE status map: "fdbId|mac" → status
  const qfdbStatusMap = {};
  for (const [oid, val] of Object.entries(vbs)) {
    if (!oid.startsWith(N_OID.qfdbStatus + '.')) continue;
    const suffix = oid.slice(N_OID.qfdbStatus.length + 1).split('.');
    if (suffix.length < 7) continue; // fdbId + 6 byte MAC
    const fdbId = parseInt(suffix[0], 10);
    if (!Number.isFinite(fdbId)) continue;
    const mac = suffix.slice(-6).map(b => parseInt(b, 10).toString(16).padStart(2, '0')).join(':');
    qfdbStatusMap[`${fdbId}|${mac}`] = bufToInt(val);
  }

  // Alcuni vendor restituiscono nella FDB il bridge-port number (standard),
  // altri direttamente l'ifIndex. Supportiamo entrambe le codifiche.
  const resolveIfIdxFromFdbPort = bpNum => {
    if (!Number.isFinite(bpNum) || bpNum <= 0) return undefined;
    if (bpToIf[bpNum] !== undefined) return bpToIf[bpNum];  // bridge-port → ifIndex
    if (ifName[bpNum] !== undefined) return bpNum;          // già ifIndex
    return undefined;
  };

  // Step 3a – BRIDGE-MIB fdbTable: mac → ifName (only status=3, learned)
  const fdbTable = {};
  for (const [oid, val] of Object.entries(vbs)) {
    if (!oid.startsWith(N_OID.fdbPort + '.')) continue;
    const suffix = oid.slice(N_OID.fdbPort.length + 1).split('.');
    if (suffix.length !== 6) continue;
    const mac = suffix.map(b => parseInt(b, 10).toString(16).padStart(2, '0')).join(':');
    if (fdbStatusMap[mac] !== 3) continue;   // only dynamically learned
    const bpNum = bufToInt(val);
    const ifIdx = resolveIfIdxFromFdbPort(bpNum);
    if (ifIdx !== undefined && ifName[ifIdx]) {
      fdbTable[mac] = ifName[ifIdx];
    }
  }

  // Step 3b – Q-BRIDGE fallback/merge (VLAN-aware, solo se learned).
  // fdbVlan: MAC → VLAN id. La Q-BRIDGE FDB e' indicizzata per fdbId, che con
  // IVL (Independent VLAN Learning, default sugli switch enterprise) coincide con
  // la VLAN; con SVL puo' non coincidere (best-effort, lato client c'e' fallback).
  const fdbVlan = {};
  for (const [oid, val] of Object.entries(vbs)) {
    if (!oid.startsWith(N_OID.qfdbPort + '.')) continue;
    const suffix = oid.slice(N_OID.qfdbPort.length + 1).split('.');
    if (suffix.length < 7) continue; // fdbId + 6 byte MAC
    const fdbId = parseInt(suffix[0], 10);
    if (!Number.isFinite(fdbId)) continue;
    const mac = suffix.slice(-6).map(b => parseInt(b, 10).toString(16).padStart(2, '0')).join(':');
    if (qfdbStatusMap[`${fdbId}|${mac}`] !== 3) continue; // only dynamically learned
    if (fdbVlan[mac] === undefined) fdbVlan[mac] = fdbId;  // VLAN del MAC (best-effort)
    const bpNum = bufToInt(val);
    const ifIdx = resolveIfIdxFromFdbPort(bpNum);
    if (ifIdx !== undefined && ifName[ifIdx]) {
      if (!fdbTable[mac]) fdbTable[mac] = ifName[ifIdx];
    }
  }

  // ---- ARP table (Layer 3 fallback: MAC → IP) -------------------------------
  // ipNetToMediaEntry index: { ifIndex, ipAddress }.
  // Usiamo sia l'IP dal valore (arpIp) sia, come fallback, dall'indice OID.
  const arpIpByKey = {};
  const arpMacByKey = {};
  const arpTypeByKey = {};
  const _isIPv4Str = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(s || '').trim());

  for (const [oid, val] of Object.entries(vbs)) {
    if (oid.startsWith(N_OID.arpIp + '.')) {
      const parts = oid.slice(N_OID.arpIp.length + 1).split('.');
      if (parts.length < 5) continue; // ifIndex + 4 ottetti IPv4
      const ifIdx = parseInt(parts[0], 10);
      if (!Number.isFinite(ifIdx)) continue;
      const key = parts.join('.');
      // Valore può essere stringa ip oppure OctetString(4)
      let ip = '';
      if (Buffer.isBuffer(val) && val.length >= 4) ip = `${val[0]}.${val[1]}.${val[2]}.${val[3]}`;
      else ip = String(val || '').trim();
      if (!_isIPv4Str(ip)) ip = parts.slice(-4).join('.');
      if (_isIPv4Str(ip)) arpIpByKey[key] = ip;
      continue;
    }
    if (oid.startsWith(N_OID.arpPhys + '.')) {
      const parts = oid.slice(N_OID.arpPhys.length + 1).split('.');
      if (parts.length < 5) continue; // ifIndex + 4 ottetti IPv4
      const key = parts.join('.');
      const mac = macToStr(Buffer.isBuffer(val) ? val : Buffer.alloc(0));
      if (mac) arpMacByKey[key] = mac;
      continue;
    }
    if (oid.startsWith(N_OID.arpType + '.')) {
      const parts = oid.slice(N_OID.arpType.length + 1).split('.');
      if (parts.length < 5) continue;
      const key = parts.join('.');
      arpTypeByKey[key] = bufToInt(val);
      continue;
    }
  }

  const arpTable = {};
  for (const [key, ip] of Object.entries(arpIpByKey)) {
    const mac = arpMacByKey[key];
    if (!mac) continue;
    const t = arpTypeByKey[key] || 0;
    // Preferisci entry dinamiche, ma accetta statiche se non c'è alternativa.
    if (!(t === 3 || t === 4 || t === 0)) continue;
    if (!arpTable[mac]) arpTable[mac] = ip;
  }

  return { hostname, neighbors, fdbTable, fdbVlan, arpTable };
}

// ---- public API: neighbour discovery ----------------------------------------

async function pollNeighbors(cfg) {
  const host    = (cfg.host || '').trim();
  const port    = parseInt(cfg.port)    || 161;
  const timeout = (parseInt(cfg.timeout) || 5) * 1000;
  const driver  = (cfg.driver || '').toLowerCase();

  if (!host) throw new Error('Host/IP mancante');

  let session;
  try {
    session = _createSnmpSession(driver, host, port, timeout, cfg);
    const vbs = await walkNeighbors(session);
    return extractNeighbors(vbs);
  } finally {
    try { session?.close(); } catch (_) { /* ignore */ }
  }
}

// ---- public API: lightweight probe (per discovery subnet) -------------------
// Esegue solo un GET su sysDescr/sysName/sysObjectID — nessuna walk completa.
// Restituisce { reachable, hostname, descr, objectId } in max timeout secondi.
//
// Per v1/v2c: invia entrambe le versioni in parallelo e accetta la prima che
// risponde. Questo gestisce router (es. Cisco IOS/VIOS) configurati con solo
// una versione, senza aumentare il tempo di scansione.

async function probe(cfg) {
  const host    = (cfg.host || '').trim();
  const port    = parseInt(cfg.port)    || 161;
  const timeout = Math.min((parseInt(cfg.timeout) || 2), 5) * 1000;
  const driver  = (cfg.driver || 'snmp-v2c').toLowerCase();

  if (!host) return { reachable: false, error: 'Host mancante' };

  const OIDS_PROBE = [
    '1.3.6.1.2.1.1.1.0', // sysDescr
    '1.3.6.1.2.1.1.5.0', // sysName
    '1.3.6.1.2.1.1.2.0', // sysObjectID
    '1.3.6.1.2.1.1.7.0', // sysServices
  ];

  // Ogni probe ritorna un handle { promise, close }. close() interrompe SUBITO
  // la sessione (libera il socket UDP) ed è chiamato sui probe PERDENTI appena un
  // altro vince in anticipo: così le sessioni non si accumulano durante lo scan
  // (era la causa dello stallo — con l'early-return le sessioni v1/v3 orfane
  // restavano aperte fino al loro timeout → esaurimento socket). Un GUARD
  // garantisce inoltre che OGNI probe si risolva entro timeout+margine: net-snmp
  // v3 a volte non richiama la callback e senza guard la Promise resterebbe
  // pendente per sempre (hang del batch → server non risponde).
  function _mkProbe(drv, v3detect) {
    let session = null, guard = null, resolveFn = null;
    const handle = { promise: null, close: null, isV3: !!v3detect, settled: false, result: null };
    const done = (r) => {
      if (handle.settled) return; handle.settled = true; handle.result = r;
      if (guard) clearTimeout(guard);
      try { session && session.close(); } catch(_) {}
      if (resolveFn) resolveFn(r);
    };
    handle.promise = new Promise(resolve => {
      resolveFn = resolve;
      const sessCfg = v3detect ? { v3user: '', v3secLevel: 'noAuthNoPriv' } : cfg;
      try { session = _createSnmpSession(v3detect ? 'snmp-v3' : drv, host, port, timeout, sessCfg, 0); }
      catch (e) { return done({ reachable: false, error: e.message }); }
      guard = setTimeout(() => done({ reachable: false, error: 'guard' }), timeout + 600);
      try {
        session.get(OIDS_PROBE, (err, vbs) => {
          if (err) {
            // v3 detect: timeout = non v3; QUALSIASI altra risposta (report USM)
            // = agente v3 vivo ma senza credenziali. v1/v2c: errore = non raggiungibile.
            if (v3detect && !(err instanceof snmp.RequestTimedOutError))
              return done({ reachable: true, driverUsed: 'snmp-v3', needsCredentials: true });
            return done({ reachable: false, error: err.message });
          }
          const hasData = Array.isArray(vbs) && vbs.some(vb => !snmp.isVarbindError(vb));
          if (!hasData) {
            // v3 detect: ha risposto ma senza dati leggibili (noAuthNoPriv) → v3 da configurare.
            if (v3detect) return done({ reachable: true, driverUsed: 'snmp-v3', needsCredentials: true });
            return done({ reachable: false, error: 'No data' });
          }
          done({
            reachable: true, driverUsed: v3detect ? 'snmp-v3' : drv,
            descr:    bufToStr(vbs[0]?.value || ''),
            hostname: bufToStr(vbs[1]?.value || ''),
            objectId: String(vbs[2]?.value  || ''),
            sysServices: bufToInt(vbs[3]?.value || 0),
          });
        });
      } catch (e) { done({ reachable: false, error: e.message }); }
    });
    handle.close = () => done({ reachable: false, error: 'aborted' });
    return handle;
  }

  // v3 esplicito: solo rilevamento engineID, nessuna credenziale.
  if (driver === 'snmp-v3') return _mkProbe(null, true).promise;

  // v1/v2c: i router Cisco IOS/VIOS possono parlare solo una delle due. 'auto'
  // aggiunge il rilevamento v3 (fallback). PERFORMANCE: ritorna appena UNA
  // versione risponde CON DATI (no attesa dei timeout altrui) e CHIUDE subito i
  // perdenti. Se nessuna dà dati si attende tutto e si tiene il migliore (per
  // 'auto': l'eventuale device v3 rilevato senza credenziali = "da configurare").
  const handles = (driver === 'snmp-v1')
    ? [_mkProbe('snmp-v1', false)]
    : [_mkProbe('snmp-v2c', false), _mkProbe('snmp-v1', false)];
  if (driver === 'auto') handles.push(_mkProbe(null, true));

  // RILEVAMENTO MULTI-VERSIONE + performance:
  // - ritorna appena v2c/v1 danno DATI (no attesa dei timeout altrui);
  // - ma concede una piccola GRAZIA al rilevamento v3 (che fa 2 RTT, più lento di
  //   v2c) per dichiararsi → i device dual-config v2c+v3 mostrano ENTRAMBE le
  //   versioni senza pagare il timeout v3 pieno (gli host non-v3 aspettano solo
  //   la grazia, poche centinaia di ms);
  // - se nessuna versione dà dati, attende tutto e tiene il migliore (per 'auto':
  //   l'eventuale device v3 rilevato senza credenziali = "da configurare").
  const GRACE_MS = Math.min(300, Math.floor(timeout / 2));
  const v3h = handles.find(h => h.isV3) || null;
  return new Promise(resolve => {
    let remaining = handles.length, done = false, best = { reachable: false }, dataResult = null, grace = null;
    const seen = [];
    const versionsOf = () => [...new Set(seen.filter(x => x && x.reachable && x.driverUsed).map(x => x.driverUsed))];
    const finish = () => {
      if (done) return; done = true; if (grace) clearTimeout(grace);
      handles.forEach(h => h.close());   // chiude probe ancora aperti (no socket leak)
      const r = dataResult || best;
      const vers = versionsOf();
      resolve({ ...r, snmpVersions: vers.length ? vers : (r.driverUsed ? [r.driverUsed] : []) });
    };
    handles.forEach(h => h.promise.then(r => {
      seen.push(r);
      if (r && r.reachable && !r.needsCredentials && !dataResult) {
        dataResult = r;                          // dati (v2c/v1) presi...
        grace = setTimeout(finish, GRACE_MS);    // ...ma diamo una grazia al v3
      }
      if (r && r.reachable && !best.reachable) best = r;
      // chiudi se: ho i dati E il v3 si è già pronunciato (o non c'è probe v3); o tutto risolto
      if (dataResult && (!v3h || v3h.settled)) return finish();
      if (--remaining === 0) return finish();
    }).catch(() => { if (--remaining === 0) finish(); }));
  });
}

// ---- Power: UPS (UPS-MIB RFC 1628) / ATS (APC PowerNet) --------------------
// GET sugli OID scalari (non una walk: i power device non hanno interfacce utili)
// e normalizzazione via lib/power-mib.js (pura). kind = 'ups' | 'ats'.
const POWER_MIB = require('../lib/power-mib.js');

async function pollPower(cfg, kind) {
  const host    = (cfg.host || '').trim();
  const port    = parseInt(cfg.port) || 161;
  const timeout = Math.min((parseInt(cfg.timeout) || 3), 8) * 1000;
  const driver  = (cfg.driver || 'snmp-v2c').toLowerCase();
  if (!host) throw new Error('Host/IP mancante');

  const oidMap = POWER_MIB.POWER_OIDS[kind === 'ats' ? 'ats' : 'ups'];
  const keys = Object.keys(oidMap);
  const oids = keys.map(k => oidMap[k]);

  let session;
  try { session = _createSnmpSession(driver, host, port, timeout, cfg, 0); }
  catch (e) { throw new Error(e.message); }

  const raw = await new Promise((resolve, reject) => {
    session.get(oids, (err, vbs) => {
      try { session.close(); } catch (_) {}
      if (err) return reject(err);
      const out = {};
      vbs.forEach((vb, i) => {
        if (snmp.isVarbindError(vb)) return;   // OID assente su questo device: salta
        const k = keys[i];
        out[k] = (k === 'mfr' || k === 'model') ? bufToStr(vb.value) : bufToInt(vb.value);
      });
      resolve(out);
    });
  });

  const live = (kind === 'ats') ? POWER_MIB.parseAts(raw) : POWER_MIB.parseUps(raw);
  return { kind: kind === 'ats' ? 'ats' : 'ups', live };
}

module.exports = { poll, pollNeighbors, probe, pollPower };

// Funzioni pure interne esposte SOLO per i test di regressione (node --test).
// Additivo: non altera il comportamento runtime del driver.
module.exports._internals = {
  bufToStr, bufToInt, decodePortList, isRealMac, macToStr,
  logicalLagIdFromName, lastIdx, extractData, extractEntityInventory,
  extractSystem, _formatUptime, extractPrinter, _supplyColorKey,
  extractHostResources, _isPathPrefix, OID, PRT_OID, HR_OID, _oidGt,
};
