import { win, expose } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { normalizeMacAddress } from './app-util.js';
import { getNodeByPortId } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)

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

export function _discVendorFromMac(mac){
    const m = normalizeMacAddress(mac || '');
    if(!m) return '';
    return DISC_OUI_VENDOR[m.substring(0, 8)] || '';
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

function _discRememberClassHint(row, type){
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
function _discInvalidateExistingIndexes(){ _discIdxCache = null; }
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

function _discBuildExistingIndexes(){
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
    const _macBlocked = rawMac && (
        (idx.sharedMacs instanceof Set && idx.sharedMacs.has(rawMac)) ||
        (idx.gatewayMacs instanceof Set && idx.gatewayMacs.has(rawMac))
    );
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

function _discMarkIpMacConflict(existing, row){
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

function _discTouchNodeIdentity(node, row, matchedBy=''){
    if(!node) return;
    const now = new Date().toISOString();
    const seenIp = String(row?.ip || '').trim();
    const seenMac = normalizeMacAddress(row?.mac || '');
    const oldIp = String(node.ip || node.integration?.host || '').trim();

    node.firstSeen = node.firstSeen || now;
    node.lastSeen = now;
    node.currentIp = seenIp || node.currentIp || oldIp || '';
    node.lastDiscoveryMatch = matchedBy || node.lastDiscoveryMatch || '';

    if(seenMac && !node.mac) node.mac = seenMac;

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

function _discIdentityLabel(src){
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

function _discSanitizeDeviceClass(row, opts){
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

    const existing = win._discExistingNode(row);
    if(existing?.type && TYPES[existing.type]) return existing.type;

    const hinted = _discGetClassHint(row);
    if(hinted && (weak || row?.deviceClass === 'pc' || row?.deviceClass === 'server')) return hinted;

    if(weak && row?.deviceClass === 'server') return 'pc';
    return (opts && opts.manualOnly) ? '' : (row?.deviceClass || '');
}

function _discConfidenceScore(row){
    return parseInt(row?.confidence?.score ?? row?.discovery?.confidence?.score ?? 0, 10) || 0;
}

function _discHasStrongIdentity(row){
    const score = _discConfidenceScore(row);
    return !!(
        row?.snmpReachable ||
        row?.objectId ||
        score >= 70 ||
        (score >= 55 && (row?.hostname || row?.netbiosName) && row?.vendor)
    );
}

function _discCanAutoRetype(existingType, nextType){
    if(!existingType || !nextType || existingType === nextType) return false;
    const prev = TYPES[existingType];
    const next = TYPES[nextType];
    if(!prev || !next) return false;
    return !!prev.isRack === !!next.isRack && !!prev.isFloor === !!next.isFloor;
}

function _loadDeepScanPref(){
    try{ return localStorage.getItem(DISC_DEEP_SCAN_PREF_KEY) === '1'; }
    catch(_){ return false; }
}

function _saveDeepScanPref(enabled){
    try{ localStorage.setItem(DISC_DEEP_SCAN_PREF_KEY, enabled ? '1' : '0'); }
    catch(_){}
}


function _guessType(descr, objectId, vendor='', banner='', host=''){
    const d=(descr||'').toLowerCase();
    const oid=(objectId||'');
    const vhb = `${vendor||''} ${banner||''} ${host||''}`.toLowerCase();
    // Firme OID dalla tabella CONDIVISA (lib/device-signatures): stessa priorita'
    // di prima (chiesta a posizione), ma senza ripetere qui la lista dei prefissi.
    const _oidIs = (type) => typeof oidIsType === 'function' && oidIsType(oid, type);

    if(/reolink|hikvision|dahua|vivotek|camera|cctv/.test(vhb)) return 'webcam';
    if(/synology|sinology|qnap|nas|lacie/.test(vhb)) return 'nas';
    if(/officejet|laserjet|printer|epson|xerox|ricoh|kyocera/.test(vhb)) return 'printer';
    if(/^hp[0-9a-f]{6}$/i.test(host || '') && /hewlett packard/i.test(vendor || '')) return 'printer';
    if(/keil-eweb|embedded web|webrelay|modbus|plc|eaton corporation|azurewave|daikin/.test(vhb) && !/\bups\b|\bpdu\b|power/.test(vhb)) return 'iot';
    if(/fortigate|fortinet|palo\s?alto|pan-os|sonicwall|watchguard|checkpoint|sophos.*firewall|pfsense|opnsense|firewall/.test(vhb)) return 'firewall';
    if(/wireless\s*lan\s*controller|wlan\s*controller|mobility\s*controller|\bwlc\b|air-?ct[0-9]|cisco\s*controller|aire-?os|catalyst\s*9800|\bc9800/.test(vhb)) return 'wlanctrl';
    // TV/media PRIMA del check generico switch/gs\d (evita che il nome di uno switch
    // vicino — es. "GS1900" — riscriva una TV a "switch").
    if(/lgwebos|webos|bravia|sony|google tv|chromecast|nvidia shield|\bshield\b|android tv|smart.?tv|television/.test(vhb)) return 'tv';
    if(/gateway|router|zywall|web-based configurator/.test(vhb) && !/switch|gs\d{3,4}|xgs\d{3,4}/.test(vhb)) return 'router';
    if(/mikrotik|routeros|edgerouter|edgeos|unifi gateway|\busg\b|\budm\b|dream machine|tp-link.*router|netgear.*router|d-link.*router|openwrt|vyos/.test(vhb)) return 'router';
    if(/aruba|cisco|juniper.*(?:ex|qfx)|brocade|extreme|dell.*powerconnect|switch|gs\d{3,4}|xgs\d{3,4}/.test(vhb)) return 'switch';
    if(/google|chromecast/.test(vhb) && !/server|workgroup|desktop|win/.test(vhb)) return 'iot';
    if(/ups|apc/.test(vhb)) return 'ups';

    // --- Stampanti di rete (prima di server: HP/Ricoh/Xerox spesso riportano Linux) ---
    if(/jetdirect|laserjet|officejet|deskjet|pagewide|designjet|colorlaserjet|printserver|hp.*print|print.*hp|ricoh\b|aficio|nashuatec|\bxerox\b|phaser|workcentre|versalink|altalink|\bcanon\b.*print|imagerunner|imageclass|kyocera|ecosys|taskalfa|konica.?minolta|bizhub|\blexmark\b|\bbrother\b.*mfc|\bmfc-[0-9]|\bdcp-[0-9]|\bhl-[0-9]|workforce.*epson|epson.*print|\bsharp\b.*mx|\bsharp\b.*ar|oc[eé]\b|develop.*ineo/.test(d)) return 'printer';
    if(_oidIs('printer')) return 'printer'; // HP/Epson/Canon/Ricoh/Xerox/Kyocera/Brother/Konica/Lexmark

    // --- IP Camera / CCTV ---
    if(/hikvision|dahua\b|hanwha|vivotek|uniview|reolink|\bcctv\b|ip.?camera|\bnvr\b|\bdvr\b|bosch.*security|axis.*camera|camera.*axis/.test(d)) return 'webcam';
    if(_oidIs('webcam')) return 'webcam'; // Hikvision / Axis

    // --- Telefoni VoIP / SIP ---
    if(/cisco.*phone|ip.?phone.*cisco|polycom|yealink|grandstream|\bsnom\b|\bmitel\b|\baastra\b|\bhtek\b|\bfanvil\b|gigaset.*sip|sip.*phone|voip.*phone/.test(d)) return 'voip';
    if(_oidIs('voip')) return 'voip'; // Yealink / Grandstream

    // --- Access Point (pattern specifici prima del check generico "aruba" in switch) ---
    if(/\baironet\b|air-ap[0-9]|unifi.*ap|\buap-|airmax|nanostation|litebeam|nanobeam|ruckus\b|zoneflex|unleashed|aruba.*iap|aruba.*rap|\biap-[0-9]|\brap-[0-9]|meraki\s*mr|omada.*ap|eap[0-9]{3,4}|wlan controller/.test(d)) return 'ap';
    if(_oidIs('ap')) return 'ap'; // Ubiquiti UniFi / Cisco Aironet / Ruckus

    // --- PDU (prima di UPS: APC numera i due tipi diversamente) ---
    if(/\bpdu\b|power.?distribution|metered.*outlet|switched.*outlet|raritan|servertech|\bgeist\b|power.?iq/.test(d)) return 'pdu';
    if(_oidIs('pdu')) return 'pdu'; // Raritan / APC rPDU

    // --- Switch (prima dei router, per IOS/vIOS L2) ---
    if(/switch|catalyst|nexus|procurve|aruba|comware|vios_l2|ios[_-]?l2|l2iol/.test(d)) return 'switch';

    // --- Firewall / UTM ---
    if(/firewall|fortigate|fortinet|pfsense|asa\b|checkpoint|palo\s?alto|pan-os|sonicwall|watchguard|opnsense|sophos.*firewall|stormshield|barracuda.*firewall/.test(d)) return 'firewall';

    // --- UPS (prima di server: APC/Eaton a volte riportano Linux in sysDescr) ---
    if(/\bups\b|\bapc\b|\beaton\b|powerware|cyberpower|riello|liebert|vertiv|\bmge\b/.test(d)) return 'ups';
    if(_oidIs('ups')) return 'ups';  // APC (generico) / Eaton

    // --- NAS / Storage (prima di server: Synology/QNAP girano su Linux) ---
    if(/\bnas\b|synology|sinology|qnap|freenas|truenas|netapp|readynas|buffalo|drobo|iomega|dell\s*emc|powerstore|isilon|infinidat|hitachi\s*vsp|hpe\s*nimble|hpe\s*msa|storeonce|wd\s*my\s*cloud|seagate\s*nas|asustor|terramaster|openmediavault/.test(d)) return 'nas';
    if(_oidIs('nas')) return 'nas';  // Synology / QNAP

    // --- Server / virtualizzazione ---
    if(/vmware\s*esx|esxi|proxmox|hyper.?v|xcp-ng|xenserver|nutanix|\bahv\b/.test(d)) return 'hypervisor';
    if(/windows server|pnetlab|eve-ng|unetlab|openstack|kubernetes|k8s|docker|ubuntu server|debian|centos|red\s?hat|fedora|suse|freebsd|rocky linux|alma linux|oracle linux/.test(d)) return 'server';

    // --- Router ---
    if(/router|gateway|junos|mikrotik|routeros|vyos|openwrt|edgerouter|edgeos|unifi gateway|\busg\b|\budm\b|dream machine|zywall|web-based configurator|tp-link.*router|netgear.*router|d-link.*router/.test(d) && !/switch|gs\d{3,4}|xgs\d{3,4}/.test(d)) return 'router';
    if(/\bios\b/.test(d) && !/switch|catalyst/.test(d)) return 'router';

    // --- Fallback ---
    // Se il device risponde SOLO a ping/ARP, senza alcun segnale di gestione
    // (nessun sysDescr/sysObjectID SNMP, nessun banner web), è quasi certamente
    // un ENDPOINT, non un apparato managed: un vero switch/router espone SNMP.
    // → PC (planimetria). Tipico dei nodi VPCS/host in lab tipo PNETLab.
    // Se invece c'è un segnale di gestione ma non riconosciuto, resta 'switch'.
    if(/^desktop-|^win[0-9-]|^win-|workstation|laptop|notebook/i.test(host || '')) return 'pc';
    if(/android|xiaomi|huawei|parallels|intel|pcs systemtechnik/.test(vhb)) return 'pc';
    if((banner||'').trim()) return 'iot';
    const hasMgmtSignal = (descr||'').trim() || (objectId||'').trim();
    return hasMgmtSignal ? 'switch' : 'pc';
}

expose({
    _discVendorFromMac, _discRememberClassHint, _discInvalidateExistingIndexes,
    _discBuildExistingIndexes, _discIndexNode, _discFindExistingDevice, _discGatewayMacs,
    _discAttachMergeGuards,
    _discMarkIpMacConflict, _discTouchNodeIdentity, _discIdentitySource,
    _discIdentityLabel, _discSanitizeDeviceClass, _discConfidenceScore,
    _discHasStrongIdentity, _discCanAutoRetype, _loadDeepScanPref,
    _saveDeepScanPref, _guessType,
});
