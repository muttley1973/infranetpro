import { win, expose } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { normalizeMacAddress } from './app-util.js';
import { getNodeByPortId } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)
import { _discExistingNode } from './app-discovery.js';   // ritiro ponte: coda funzioni A (batch 1/2) (ex win.*)
import { registerChangeActions } from './app-delegation.js';   // ASSE B: checkbox scansione profonda via data-change

// ============================================================
// DISCOVERY CLASSIFICATION — OUI vendor map, identity matching,
// class hints, confidence scoring, _guessType euristics.
// Estratto da app.js (refactoring R2). Plain script, scope globale.
// ============================================================

// ============================================================
// NETWORK DISCOVERY (subnet scan)
// ============================================================

const DISC_DEEP_SCAN_PREF_KEY = 'infranet.discovery.deepScan';
const DISC_CLASS_HINTS_PREF_KEY = 'infranet.discovery.classHints.v1';

// ── Vendor da MAC, lato client: due livelli ──────────────────────────────────
// (1) CACHE DI SESSIONE, riempita dai vendor che il SERVER ha risolto col registro
//     IEEE + i plugin per-vendor. È la fonte autorevole e viene interrogata PRIMA.
// (2) TABELLA LOCALE di primo soccorso, qui sotto. Serve dove una risposta pronta
//     conta più della completezza: il modale «Adotta» lavora su MAC presi dall'FDB
//     e deve mostrare una marca SUBITO, senza obbligare a una scansione.
//
// La contraddizione che l'audit V6 segnalava sta nel SERVER, ed è chiusa lì: era
// `row.vendor` — il primo anello letto da engine/fusion-scorer.js — a nascere da
// una tabella a mano, quindi un suo errore vinceva su sysObjectID, OS-fingerprint
// e registro messi insieme. Qui a valle non decide nessuna classificazione: è un
// ripiego di visualizzazione, e la cache lo scavalca appena il server ha parlato.
//
// ⚠️ 18:60:24 diceva «Hewlett Packard»: lo IEEE lo assegna a CANON. Corretto —
// una tabella di comodo può essere incompleta, non può essere falsa.
const DISC_OUI_VENDOR = {
    'D4:1A:D1': 'Zyxel',
    '08:26:97': 'Zyxel',
    'BC:CF:4F': 'Zyxel',
    '50:68:12': 'Cisco',
    '50:F8:B7': 'Cisco',
    '50:7A:19': 'Cisco',
    '50:9D:DD': 'Cisco',
    '08:00:09': 'Hewlett Packard',
    'F4:39:09': 'Hewlett Packard',
    '18:60:24': 'Canon',
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
const _discOuiCache = Object.create(null);

// Registra i vendor che il SERVER ha risolto, per prefisso OUI. Chiamata su ogni
// riga di scoperta: quella marca vale poi per tutta la sessione, anche dove non
// c'è una riga di scansione da cui leggerla.
export function _discRememberVendor(mac, vendor){
    const m = normalizeMacAddress(mac || '');
    const v = String(vendor == null ? '' : vendor).trim();
    if(m && v) _discOuiCache[m.substring(0, 8)] = v;
}

export function _discVendorFromMac(mac){
    const m = normalizeMacAddress(mac || '');
    if(!m) return '';
    const p = m.substring(0, 8);
    // Prima ciò che il registro ha detto in questa sessione, poi il ripiego locale.
    return _discOuiCache[p] || DISC_OUI_VENDOR[p] || '';
}

function _discClassHintKeys(row){
    const keys = [];
    const mac = normalizeMacAddress(row?.mac || '');
    const ip = String(row?.ip || '').trim().toLowerCase();
    const host = String(row?.hostname || row?.netbiosName || '').trim().toLowerCase();
    if(mac) keys.push('mac:' + mac);
    if(ip) keys.push('ip:' + ip);
    if(host) keys.push('host:' + host);
    return keys;
}

function _discLoadClassHints(){
    try{
        const raw = localStorage.getItem(DISC_CLASS_HINTS_PREF_KEY);
        const obj = raw ? JSON.parse(raw) : {};
        return obj && typeof obj === 'object' ? obj : {};
    }catch(_){ return {}; }
}

function _discSaveClassHints(hints){
    try{ localStorage.setItem(DISC_CLASS_HINTS_PREF_KEY, JSON.stringify(hints || {})); }
    catch(_){}
}

export function _discRememberClassHint(row, type){
    if(!type || !TYPES[type]) return;
    const keys = _discClassHintKeys(row);
    if(!keys.length) return;
    const hints = _discLoadClassHints();
    const rec = { type, ts: Date.now() };
    keys.forEach(k => { hints[k] = rec; });
    _discSaveClassHints(hints);
}

function _discGetClassHint(row){
    const hints = _discLoadClassHints();
    for(const key of _discClassHintKeys(row)){
        const rec = hints[key];
        if(rec?.type && TYPES[rec.type]) return rec.type;
    }
    return '';
}

function _isIpv4Address(v){
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(v || '').trim());
}

function _discNorm(v){
    return String(v || '').trim().toLowerCase();
}

function _discNodeMac(n){
    return normalizeMacAddress(n?.mac || n?.macAddress || n?.integration?.mac || '');
}
// TUTTI i MAC noti di un nodo (chassis + interfacce SNMP da store.state.ports). Usato
// per decidere match/conflitto senza dipendere dal solo node.mac (spesso vuoto
// sui device pollati). Delega al primitivo puro win.collectNodeMacs (correlate.js).
function _discNodeMacs(n){
    const list = (typeof win.collectNodeMacs === 'function')
        ? win.collectNodeMacs(n, store.state.ports, normalizeMacAddress)
        : [_discNodeMac(n)].filter(Boolean);
    return new Set(list);
}

// Memo dell'indice identita': da quando indicizza anche i MAC delle interfacce
// (fix "cambio IP" sess.25) costruirlo e' O(nodi+porte) — ricalcolarlo PER RIGA
// nella tabella discovery/crawl bloccava la UI per secondi su progetti grandi.
// Cache costruita on-demand, invalidata quando i nodi cambiano (_discIndexNode)
// e a ogni render della tabella (_discRenderTable).
let _discIdxCache = null;
export function _discInvalidateExistingIndexes(){ _discIdxCache = null; }
function _discExistingIndexes(){
    if(!_discIdxCache){
        _discIdxCache = _discBuildExistingIndexes();
        // F5: attacca le guardie di merge ANCHE all'indice di preview/render, non solo
        // a quello dell'import. Senza, _discExistingNode/_discReconcileInfo/_discSanitize-
        // DeviceClass fondevano un host remoto sul nodo-gateway (stesso MAC next-hop) →
        // tipo-del-gateway ereditato + badge Nuovo/Aggiorna che mentivano vs l'import.
        _discAttachMergeGuards(_discIdxCache);
    }
    return _discIdxCache;
}

export function _discBuildExistingIndexes(){
    const idx = { byMac:new Map(), byIp:new Map(), byHost:new Map() };
    (store.state.nodes || []).forEach(n => {
        const mac = _discNodeMac(n);
        const ip = _discNorm(n.ip || n.integration?.host);
        const hosts = [
            _discNorm(n.hostname),
            _discNorm(n.netbiosName),
            _discNorm(n.name),
        ].filter(Boolean);
        if(mac && !idx.byMac.has(mac)) idx.byMac.set(mac, n);
        if(ip && !idx.byIp.has(ip)) idx.byIp.set(ip, n);
        hosts.forEach(h => { if(!idx.byHost.has(h)) idx.byHost.set(h, n); });
    });
    // Includi anche i MAC delle INTERFACCE (ifPhysAddress da SNMP): un device
    // pollato ha i MAC nelle porte ma spesso `node.mac` vuoto. Senza questi un
    // cambio IP lo farebbe sembrare "Nuovo" nonostante il MAC sia già in mappa.
    // node.mac (sopra) ha precedenza; le porte riempiono i buchi.
    for(const pid in (store.state.ports || {})){
        const pm = normalizeMacAddress(store.state.ports[pid]?.mac || '');
        if(!pm || idx.byMac.has(pm)) continue;
        const owner = (typeof getNodeByPortId === 'function') ? getNodeByPortId(pid) : null;
        if(owner) idx.byMac.set(pm, owner);
    }
    return idx;
}

export function _discIndexNode(idx, n){
    if(!idx || !n) return;
    _discInvalidateExistingIndexes(); // i nodi sono cambiati → il memo non e' piu' valido
    const mac = _discNodeMac(n);
    const ip = _discNorm(n.ip || n.integration?.host);
    const hosts = [_discNorm(n.hostname), _discNorm(n.netbiosName), _discNorm(n.name)].filter(Boolean);
    if(mac) idx.byMac.set(mac, n);
    if(ip) idx.byIp.set(ip, n);
    hosts.forEach(h => idx.byHost.set(h, n));
    // Indicizza anche i MAC delle interfacce del nodo (coerente con _discBuildExistingIndexes)
    const _pfx = String(n.id || '') + '-';
    for(const pid in (store.state.ports || {})){
        if(pid.indexOf(_pfx) !== 0) continue;
        const pm = normalizeMacAddress(store.state.ports[pid]?.mac || '');
        if(pm && !idx.byMac.has(pm)) idx.byMac.set(pm, n);
    }
}

// MAC dei GATEWAY documentati (L3-lite: VLAN -> device che instrada, via
// _l3GatewayNodeIds). Un gateway e' un next-hop: il suo MAC compare nell'ARP per
// gli host remoti dietro di lui ma NON e' la loro impronta -> escluso dal merge
// per-MAC (deterministico e manual-first, complementare all'euristica sharedMacs).
function _discGatewayMacs(){
    try {
        const ids = (typeof _l3GatewayNodeIds === 'function') ? _l3GatewayNodeIds() : null;
        if(!ids || !ids.size || typeof gatewayMacSet !== 'function') return new Set();
        const byId = new Map((store.state.nodes || []).map(n => [String(n.id), n]));
        const nodes = [...ids].map(id => byId.get(String(id))).filter(Boolean);
        return gatewayMacSet(nodes, (n) => [..._discNodeMacs(n)], normalizeMacAddress);
    } catch(_){ return new Set(); }
}

// Attacca a un indice identita' le DUE guardie di merge lette da _discFindExistingDevice.
// Un MAC "next-hop" (gateway o condiviso) non e' una chiave affidabile. Chiamata sia
// dall'import sia dall'indice memoizzato di preview/render (F5) → i due percorsi decidono
// il match in modo IDENTICO (niente tipo-del-gateway ereditato, badge veritieri).
//   - gatewayMacs: DETERMINISTICO — MAC dei gateway L3-lite documentati.
//   - sharedMacs : EURISTICO sull'INTERO batch di discovery (store._discResults, non i
//                  soli selezionati): stesso MAC su piu' IP = next-hop. Sul batch pieno
//                  cosi' un singolo host remoto non "perde" la condivisione del MAC.
function _discAttachMergeGuards(idx){
    if(!idx || typeof idx !== 'object') return idx;
    idx.gatewayMacs = (typeof _discGatewayMacs === 'function') ? _discGatewayMacs() : null;
    const batch = (store && Array.isArray(store._discResults)) ? store._discResults : [];
    idx.sharedMacs = (batch.length && typeof sharedMacsInBatch === 'function')
        ? sharedMacsInBatch(batch, normalizeMacAddress) : null;
    return idx;
}

// Un MAC è "next-hop" (gateway L3-lite documentato o condiviso su più IP nel batch =
// proxy-ARP/VRRP/router) → NON identifica la riga: è il MAC dell'apparato di transito.
// Predicato UNICO condiviso dal match (F4/F5) e dalla SCRITTURA di node.mac (DISC-A1):
// senza guardia in scrittura, l'import salvava il MAC del firewall su tutti gli endpoint.
// Richiede un idx con guardie attaccate (_discAttachMergeGuards); senza → mai bloccato.
export function _discMacIsNextHop(rawMac, idx){
    const m = normalizeMacAddress(rawMac || '');
    if(!m || !idx) return false;
    return (idx.sharedMacs instanceof Set && idx.sharedMacs.has(m)) ||
           (idx.gatewayMacs instanceof Set && idx.gatewayMacs.has(m));
}

export function _discFindExistingDevice(row, idx = _discExistingIndexes()){
    const rawMac = normalizeMacAddress(row?.mac || '');
    const ip = _discNorm(row?.ip);
    const host = _discNorm(row?.hostname || row?.netbiosName);

    // Un MAC che NON identifica un endpoint non e' una chiave di merge affidabile:
    //  - CONDIVISO nel batch (sharedMacsInBatch): stesso MAC su piu' IP remoti = next-hop;
    //  - GATEWAY documentato (idx.gatewayMacs, L3-lite): deterministico + manual-first.
    // In tal caso il MAC osservato e' quello del NEXT-HOP, non dell'host: non dice
    // NULLA sull'identita' della riga -> trattalo come ASSENTE in TUTTA la funzione
    // (F4). Cosi' non solo non si fonde per-MAC, ma il MAC del gateway (a) non fa piu'
    // RIFIUTARE un match per hostname legittimo, e (b) non genera un FALSO conflitto
    // ip-mac che duplicherebbe il nodo. Il gateway continua a matchare per il suo IP.
    const _macBlocked = _discMacIsNextHop(rawMac, idx);
    const mac = _macBlocked ? '' : rawMac;
    if(mac && idx.byMac.has(mac)) return { node:idx.byMac.get(mac), matchedBy:'mac' };

    if(host && idx.byHost.has(host)){
        const node = idx.byHost.get(host);
        const nodeMacs = _discNodeMacs(node);
        // match per hostname solo se il MAC non contraddice un MAC noto del nodo
        if(!mac || nodeMacs.size === 0 || nodeMacs.has(mac)) return { node, matchedBy:'hostname' };
    }

    if(ip && idx.byIp.has(ip)){
        const node = idx.byIp.get(ip);
        const nodeMacs = _discNodeMacs(node);
        // Stesso IP ma MAC diverso da TUTTI i MAC noti del nodo (chassis +
        // interfacce) → device SOSTITUITO, non lo stesso: segnala conflitto
        // (verrà importato come nuovo + marcato), non lo fonde col vecchio.
        if(mac && nodeMacs.size > 0 && !nodeMacs.has(mac)){
            return { node:null, matchedBy:'conflict', conflict:{ type:'ip-mac', existing:node, ip, oldMac:[...nodeMacs][0], newMac:mac } };
        }
        return { node, matchedBy:'ip' };
    }

    return { node:null, matchedBy:'' };
}

export function _discMarkIpMacConflict(existing, row){
    if(!existing) return;
    const now = new Date().toISOString();
    if(!Array.isArray(existing.discoveryConflicts)) existing.discoveryConflicts = [];
    existing.discoveryConflicts.push({
        type:'ip-mac',
        ip: row?.ip || '',
        existingMac: _discNodeMac(existing),
        seenMac: normalizeMacAddress(row?.mac || ''),
        seenHost: row?.hostname || row?.netbiosName || '',
        ts: now,
    });
    if(existing.discoveryConflicts.length > 20) existing.discoveryConflicts.splice(0, existing.discoveryConflicts.length - 20);
}

export function _discTouchNodeIdentity(node, row, matchedBy='', idx=null){
    if(!node) return;
    const now = new Date().toISOString();
    const seenIp = String(row?.ip || '').trim();
    const seenMac = normalizeMacAddress(row?.mac || '');
    const oldIp = String(node.ip || node.integration?.host || '').trim();

    node.firstSeen = node.firstSeen || now;
    node.lastSeen = now;
    node.currentIp = seenIp || node.currentIp || oldIp || '';
    node.lastDiscoveryMatch = matchedBy || node.lastDiscoveryMatch || '';

    // Non adottare come identità un MAC di next-hop (gateway/proxy-ARP/VRRP): sarebbe
    // il MAC dell'apparato di transito, non del device (DISC-A1). Con idx guardato,
    // _discMacIsNextHop lo riconosce; senza idx il comportamento resta invariato.
    if(seenMac && !node.mac && !_discMacIsNextHop(seenMac, idx)) node.mac = seenMac;

    if(seenIp){
        if(!Array.isArray(node.ipHistory)) node.ipHistory = [];
        let rec = node.ipHistory.find(x => String(x.ip || '') === seenIp);
        if(!rec){
            rec = { ip:seenIp, firstSeen:now, lastSeen:now, count:0 };
            node.ipHistory.push(rec);
        }
        rec.lastSeen = now;
        rec.count = (rec.count || 0) + 1;
        if(node.ipHistory.length > 20) node.ipHistory.splice(0, node.ipHistory.length - 20);

        if(oldIp && oldIp !== seenIp && !node.previousIps?.includes(oldIp)){
            node.previousIps = Array.isArray(node.previousIps) ? node.previousIps : [];
            node.previousIps.push(oldIp);
            if(node.previousIps.length > 20) node.previousIps.splice(0, node.previousIps.length - 20);
        }

        // IP principale: aggiorna solo se non impostato manualmente dall'utente.
        if(!node.ipManual) node.ip = seenIp;
        if(!node.integration) node.integration = {};
        const ih = String(node.integration.host || '').trim();
        // Host SNMP override: aggiorna solo se non impostato manualmente e se era auto.
        if(!node.integration.hostManual && (!ih || ih === oldIp || _isIpv4Address(ih)))
            node.integration.host = seenIp;
    }
}

export function _discIdentitySource(row){
    if(!row) return 'observed';
    if(row.snmpReachable || row.objectId) return 'snmp';
    const proto = String(row.viaProtocol || row.protocol || '').toUpperCase();
    if(proto === 'LLDP' || proto === 'CDP') return proto.toLowerCase();
    if(Array.isArray(row.services) && row.services.length) return 'services';
    if(row.httpTitle || row.httpsTitle) return 'web';
    if(row.mdns && (row.mdns.type || (row.mdns.services||[]).length || row.mdns.model)) return 'mdns';
    if(row.netbiosName || row.netbiosGroup) return 'netbios';
    if(row.vendor && row.mac) return 'mac-oui';
    if(row.mac) return 'mac';
    if(row.hostname) return 'hostname';
    if(row.alive) return 'ping';
    return 'observed';
}

export function _discIdentityLabel(src){
    const map = {
        snmp:'SNMP confermato',
        lldp:'Neighbor LLDP',
        cdp:'Neighbor CDP',
        services:'Servizi rilevati',
        web:'Banner web',
        mdns:'mDNS/SSDP',
        netbios:'NetBIOS/SMB',
        'mac-oui':'MAC/OUI',
        mac:'MAC',
        hostname:'Hostname',
        ping:'Ping',
        observed:'Osservato',
    };
    return map[src] || src || 'Osservato';
}

export function _discSanitizeDeviceClass(row, opts){
    const vendor = String(row?.vendor || '').toLowerCase();
    const host = String(row?.hostname || row?.netbiosName || '').toLowerCase();
    const banner = String(`${row?.httpTitle || ''} ${row?.httpsTitle || ''}`).toLowerCase();
    const descr = String(row?.descr || '').toLowerCase();
    const services = (row?.services || []).map(s => `${s.port || ''} ${s.service || ''} ${s.banner || ''}`).join(' ').toLowerCase();
    const shares = (row?.smbShares || []).map(s => `${s.name || s} ${s.type || ''} ${s.comment || ''}`).join(' ').toLowerCase();
    const text = `${vendor} ${host} ${banner} ${descr} ${services} ${shares}`.toLowerCase();
    const conf = parseInt(row?.confidence?.score ?? row?.discovery?.confidence?.score ?? 0, 10) || 0;
    const weak = conf < 45 && !row?.snmpReachable && !row?.objectId;

    // B3 — la ri-classificazione a regex del CLIENT gira SOLO quando il server non
    // aveva una classe sicura (`manualOnly` falso). Con `manualOnly` si applicano
    // solo gli override manual-first (nodo esistente / hint), MAI le regex, cosi' il
    // client non scavalca piu' la classe autorevole del server (fonte della divergenza).
    if(!opts || !opts.manualOnly){
        // Pattern dalla lib CONDIVISA (device-patterns.js) = ESATTAMENTE la stessa
        // tabella del FusionScorer server -> il fallback client non diverge piu' (B3).
        // Segnali SPECIFICI (printer/webcam/nas/tv/elettrodomestico) PRIMA del check
        // generico switch/gs\d: una TV/stampante col nome di uno switch vicino (es.
        // "GS1900") NON deve diventare switch. L'ordine e' il fix del bug di ordinamento.
        if(PRINTER_RE.test(text)) return 'printer';
        if(WEBCAM_RE.test(text)) return 'webcam';
        if(NAS_RE.test(text)) return 'nas';
        if(APPLIANCE_RE.test(text) || SMART_HOME_RE.test(text)) return 'iot';
        if(TV_SIGNAL_RE.test(text) || MEDIA_PLAYER_RE.test(text)) return 'tv';
        if(FIREWALL_RE.test(text)) return 'firewall';
        if(WLANCTRL_RE.test(text)) return 'wlanctrl';
        if(AP_RE.test(text)) return 'ap';
        if(VOIP_RE.test(text)) return 'voip';
        if(PDU_RE.test(text)) return 'pdu';
        if(UPS_RE.test(text)) return 'ups';
        if(IOT_EMBED_RE.test(text) && !/\bups\b|\bpdu\b|power/.test(text)) return 'iot';
        if(ROUTER_VENDOR_RE.test(text)) return 'router';
        if(SWITCH_VENDOR_RE.test(text) || SWITCH_WORDS_RE.test(text)){
            if(ROUTER_WORDS_RE.test(text) && !SWITCH_WORDS_RE.test(text)) return 'router';
            return 'switch';
        }
        if(/google|chromecast/.test(text)) return 'iot';
        if(/desktop-|^win|windows 10|workgroup|parallels|intel|pcs systemtechnik/.test(text)) return 'pc';
        if(HYPERVISOR_RE.test(text)) return 'hypervisor';
        if(SERVER_VIRT_RE.test(text)) return 'server';
    }

    const existing = _discExistingNode(row);
    if(existing?.type && TYPES[existing.type]) return existing.type;

    const hinted = _discGetClassHint(row);
    if(hinted && (weak || row?.deviceClass === 'pc' || row?.deviceClass === 'server')) return hinted;

    if(weak && row?.deviceClass === 'server') return 'pc';
    return (opts && opts.manualOnly) ? '' : (row?.deviceClass || '');
}

export function _discConfidenceScore(row){
    return parseInt(row?.confidence?.score ?? row?.discovery?.confidence?.score ?? 0, 10) || 0;
}

export function _discHasStrongIdentity(row){
    const score = _discConfidenceScore(row);
    return !!(
        row?.snmpReachable ||
        row?.objectId ||
        score >= 70 ||
        (score >= 55 && (row?.hostname || row?.netbiosName) && row?.vendor)
    );
}

export function _discCanAutoRetype(existingType, nextType){
    if(!existingType || !nextType || existingType === nextType) return false;
    const prev = TYPES[existingType];
    const next = TYPES[nextType];
    if(!prev || !next) return false;
    return !!prev.isRack === !!next.isRack && !!prev.isFloor === !!next.isFloor;
}

export function _loadDeepScanPref(){
    try{ return localStorage.getItem(DISC_DEEP_SCAN_PREF_KEY) === '1'; }
    catch(_){ return false; }
}

export function _saveDeepScanPref(enabled){
    try{ localStorage.setItem(DISC_DEEP_SCAN_PREF_KEY, enabled ? '1' : '0'); }
    catch(_){}
}


// ============================================================
//  _guessType — RETE DI SICUREZZA, non un secondo classificatore
// ============================================================
//  Il classificatore autorevole e' il FusionScorer lato server: vede tutti i
//  segnali misurati (sysServices, porte, banner, mDNS, SMB) e pesa ciascuno.
//  Questa funzione gira SOLO quando il server non produce alcuna classe — un
//  device muto, o un MAC preso dall'FDB senza una riga di scansione.
//
//  Aveva una PROPRIA scala di regex, divergente dalla tabella che l'header di
//  lib/device-patterns.js dichiara «unica fonte»: `cisco` nudo -> switch,
//  `sony` -> tv, `apc` -> ups, `daikin` -> iot, `huawei` -> pc. Sullo stesso
//  apparato server e browser rispondevano diverso (17 righe su 53 del corpus),
//  e correggere una regola in un posto lasciava l'altro sbagliato.
//
//  Ora legge la STESSA tabella, nello stesso ordine di specificita' del
//  FusionScorer: prima la funzione dichiarata nel testo misurato, poi le firme
//  sysObjectID, poi i segnali deboli, e in fondo la catena endpoint. Le
//  divergenze che restano sono solo quelle STRUTTURALI (il server pesa e somma,
//  qui si prende il primo che matcha) — non piu' due tabelle diverse.
// ============================================================
function _guessType(descr, objectId, vendor='', banner='', host=''){
    const d=(descr||'').toLowerCase();
    const oid=(objectId||'');
    const vhb = `${vendor||''} ${banner||''} ${host||''}`.toLowerCase();
    // Un testo solo, come `fullText` del FusionScorer: separare descr da
    // vendor/banner/host obbligava a duplicare ogni regola su due scale, ed e'
    // esattamente da li' che nasceva la divergenza.
    const text = `${d} ${vhb}`;
    // Firme OID dalla tabella CONDIVISA (lib/device-signatures): stessa priorita'
    // di prima (chiesta a posizione), ma senza ripetere qui la lista dei prefissi.
    const _oidIs = (type) => typeof oidIsType === 'function' && oidIsType(oid, type);
    const _has = (re) => !!(re && re.test && re.test(text));

    // ── 1. Funzione DICHIARATA nel testo misurato (i voti 85-90 del server) ──
    if(_has(PRINTER_RE) || _oidIs('printer')) return 'printer';
    // NVR prima di webcam: l'aggregatore che si dichiara NVR sopprime il gemello
    // endpoint (WEBCAM_RE contiene gia' \bnvr\b), come fa il server.
    if(_has(NVR_RE)) return 'nvr';
    if(_has(WEBCAM_RE) || _oidIs('webcam')) return 'webcam';
    if(_has(NAS_RE) || _oidIs('nas')) return 'nas';
    if(_has(APPLIANCE_RE)) return 'iot';
    if(_has(FIREWALL_RE) || _has(SRX_FIREWALL_RE)) return 'firewall';
    if(_has(WLANCTRL_RE)) return 'wlanctrl';
    if(_has(AP_RE) || _oidIs('ap')) return 'ap';
    if(_has(PROJECTOR_RE)) return 'projector';
    // ATS prima di UPS (il transfer switch APC diceva "ups" per via del marchio,
    // ora che il marchio e' uscito da UPS_RE conta la funzione) e PDU prima
    // ancora, perche' APC numera i due tipi diversamente.
    if(_has(ATS_RE)) return 'ats';
    if(_has(PDU_RE) || _oidIs('pdu')) return 'pdu';
    if(_has(UPS_RE) || _oidIs('ups')) return 'ups';
    if(_has(VPNCON_RE)) return 'vpncon';
    if(_has(CONSOLESVR_RE)) return 'consolesvr';
    if(_has(KVM_RE)) return 'kvm';
    if(_has(DOORCTRL_RE)) return 'doorctrl';
    // PBX prima di voip: il centralino non e' un telefono.
    if(_has(PBX_RE)) return 'pbx';
    if(_has(VOIP_RE) || _oidIs('voip')) return 'voip';
    if(_has(IOT_EMBED_RE) && !/\bups\b|\bpdu\b|power/.test(text)) return 'iot';

    // ── 1-bis. sysObjectID per i tipi che NON hanno una regex sopra ─────────
    // La firma OID e' un'identita' ANNUNCIATA dall'apparato: piu' forte di
    // qualunque parola nel testo. Sopra e' gia' stata chiesta tipo per tipo, in
    // posizione; qui si prende quel che resta (firewall, switch, router, sdwan,
    // hypervisor, server…), che prima il client ignorava del tutto — un Fortinet
    // riconosciuto dal suo sysObjectID usciva «switch» dal ripiego finale.
    const _oidBest = (typeof oidType === 'function') ? (oidType(oid) || '') : '';
    if(_oidBest && TYPES[_oidBest]) return _oidBest;

    // ── 2. TV / media / domotica ────────────────────────────────────────────
    // Prima del check switch/router: il nome di uno switch vicino ("GS1900")
    // finito nel testo non deve riscrivere una TV a switch. Il guard nega i
    // segnali di rete, come il server.
    const _netish = _has(SWITCH_WORDS_RE) || _has(ROUTER_WORDS_RE);
    if(!_netish && (_has(TV_SIGNAL_RE) || _has(MEDIA_PLAYER_RE) || /chromecast|google ?cast/.test(text))) return 'tv';
    if(!_netish && _has(SMART_HOME_RE)) return 'iot';

    // ── 3. Virtualizzazione e server ────────────────────────────────────────
    if(_has(HYPERVISOR_RE)) return 'hypervisor';
    if(_has(SERVER_VIRT_RE)) return 'server';

    // ── 4. Apparati di rete: modello/linea prima, parole generiche poi ──────
    const _notNetSwitch = _has(NOT_A_NET_SWITCH_RE);
    const _switchWords = _has(SWITCH_WORDS_RE) && !_notNetSwitch;
    if(_has(CARRIER_ROUTER_RE)) return 'router';
    if(_has(ROUTER_VENDOR_RE) && !_switchWords) return 'router';
    if(_switchWords || (_has(SWITCH_VENDOR_RE) && !_notNetSwitch)) return 'switch';
    if(_has(ROUTER_WORDS_RE)) return 'router';
    if(_has(SERVER_LINUX_RE)) return 'server';

    // ── 5. Catena endpoint (nessun segnale di funzione) ─────────────────────
    // La convenzione hostname Windows e' un segnale piu' forte del nome del
    // sistema operativo nel testo: viene prima.
    if(PC_HOSTNAME_RE.test(String(host || ''))) return 'pc';
    // `ios` e' un OS, non una funzione: vale solo qui in fondo, quando nessun
    // segnale di funzione ha parlato — la stessa retrocessione fatta nel motore.
    if(/\bios\b/.test(text) && !/switch|catalyst/.test(text)) return 'router';
    if(_has(PC_VENDOR_RE)) return 'pc';
    if((banner||'').trim()) return 'iot';
    // Senza alcun segnale di gestione (niente sysDescr/sysObjectID/banner) e'
    // quasi certamente un ENDPOINT: un apparato managed espone SNMP.
    // CON un segnale di gestione ma nessuna regola che risponde, la risposta e'
    // «apparato gestito, funzione ignota» — non 'switch', che era il ripiego
    // storico e faceva uscire switch un PC Windows, una TV e una lavatrice. Il
    // tipo generico e' gestito e piazzabile in rack esattamente come prima:
    // cambia solo che non gli si attribuisce una funzione mai misurata.
    const hasMgmtSignal = (descr||'').trim() || (objectId||'').trim();
    return hasMgmtSignal ? 'customrack' : 'pc';
}
expose({
    _discVendorFromMac, _discRememberVendor, _discRememberClassHint, _discInvalidateExistingIndexes,
    _discBuildExistingIndexes, _discIndexNode, _discFindExistingDevice, _discGatewayMacs,
    _discAttachMergeGuards, _discMacIsNextHop,
    _discMarkIpMacConflict, _discTouchNodeIdentity, _discIdentitySource,
    _discIdentityLabel, _discSanitizeDeviceClass, _discConfidenceScore,
    _discHasStrongIdentity, _discCanAutoRetype, _loadDeepScanPref,
    _guessType,
});

// ASSE B — checkbox "Scansione profonda TCP": onchange inline -> data-change.
// _saveDeepScanPref resta export (import ESM da app-discovery.js), esce da expose().
registerChangeActions({
    'disc-deep-scan': (el) => _saveDeepScanPref(el.checked),
});
