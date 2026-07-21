// ============================================================
// AUTO-LINK + DISCOVERY ENGINE FRONTEND
// Discovery multi-layer trasparente: LLDP/CDP/FDB/ARP, shared segment,
// refresh FDB/inventario, auto-link endpoint, Direct Connection Theorem.
// Migrato a modulo ESM (src/) — globali legacy via win.*.
// Le funzioni del segmento condiviso vivono in app-shared-segment.js (lette via win).
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { uid } from './app-util.js';
import { nodeById, markDirty, getNodeByPortId, getPortNodeId, renderCables, _showToast, _invalidateIdx, _linksForPort, canAddConnection, _createLinkRecord, _validateWallPortConnection } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)
import { _findPortByIfName } from './app-topology-discover.js';   // ritiro ponte: funzioni topo/discovery/vlan/snmp (ex win.*)
import { applyPollResult } from './app-snmp.js';   // ritiro ponte: coda funzioni A (batch 2/2) (ex win.*)
import { _vlansToRangeStr } from './app-vlan-autopoll.js';   // ritiro ponte: coda funzioni A (batch 2/2) (ex win.*)
import { materializeTopologyNodes } from './app-topology-rebuild.js';   // materializza i nodi mancanti (gateway annunciato + switch inferito) col poll già raccolto
import { pickBestIp6, canonicalizeIpv6 } from '../lib/ipv6.js';   // ND discovery: scelta ip6 rappresentativo (bundlato ESM, come app.js — NON un globale su window)
// ============================================================
// AUTO-LINK DISCOVERY — algoritmo multi-layer trasparente
//
// Livelli di confidenza (GAP scoring multi-source):
//   Layer 1 — LLDP (802.1AB)          0.97  → auto-crea
//   Layer 2 — CDP (Cisco)             0.90  → auto-crea
//   Layer 3 — MAC FDB cross-switch    graduata per MAC sulla porta:
//             1 MAC → 0.85 (auto-crea) · 2 MAC → 0.80 (auto-crea)
//             3-4 MAC → 0.68 (solo log) · >4 MAC → NESSUN candidato
//             (porta shared-segment: workflow "Segmento L2" dedicato)
//   GAP 1 — fusione: stessa coppia da LLDP/CDP + FDB indipendente →
//           conf +0.02, protocol 'LLDP+MAC'/'CDP+MAC' (resta "Scoperto")
//   GAP 2 — cross-check: FDB + ifPhysAddress remota + ARP concordi →
//           conf +0.05 (cap 0.93), protocol 'MAC+ARP' (resta "Inferito")
//
// Soglia auto-creazione: 0.80
// I cavi creati automaticamente vengono marcati {autoLinked, confidence, protocol}
// e possono essere modificati o eliminati manualmente come qualsiasi altro cavo.
// ============================================================

/**
 * Cerca nel progetto un nodo che corrisponda all'hostname/IP fornito.
 * Strategia a cascata (case-insensitive):
 *  1. Exact match su n.hostname
 *  2. Exact match su n.name
 *  3. Short-name match — ignora dominio ("router.example.lan" → "router")
 *  4. IP match su n.ip o n.integration.host
 */
function _matchNodeByIdent(hostname, ip){
    if(!hostname && !ip) return null;
    const h  = (hostname||'').toLowerCase().trim();
    const sH = h.split('.')[0];
    const ip4= (ip||'').trim();

    // Singolo passo su store.state.nodes (era 4 find() sequenziali).
    // Priorità: exact hostname > exact name > short-name > IP.
    // I match a priorità bassa vengono salvati e restituiti solo se non si trova niente di meglio.
    let byShortName = null, shortAmbiguous = false, byIp = null;
    for(const x of store.state.nodes){
        const nh = (x.hostname||'').toLowerCase();
        const nn = (x.name||'').toLowerCase();
        if(h && nh === h) return x;                          // P1 exact hostname
        if(h && nn === h) return x;                          // P2 exact name
        if(sH && (nh.split('.')[0]===sH || nn.split('.')[0]===sH)){
            if(!byShortName) byShortName = x;                // P3 short name
            else if(x !== byShortName) shortAmbiguous = true; // ≥2 nodi stesso short-name
        }
        if(ip4 && !byIp &&
           ((x.ip||'').trim()===ip4 || (x.integration?.host||'').trim()===ip4))
            byIp = x;                                        // P4 IP match
    }
    // Short-name ambiguo (es. "gw" con gw.siteA E gw.siteB): nessun aggancio è
    // meglio del primo dell'array a confidenza LLDP (gemello di lib/correlate.js).
    return (shortAmbiguous ? null : byShortName) || byIp || null;
}

// Endpoint foglia auto-collegabile via MAC table:
//  - ha un indirizzo IP/MAC (hasIP)
//  - NON è infrastruttura di switching/instradamento (!isActive)
//  - ha porta SINGOLA (ports===1) → collegabile a `${id}-1`
// Include: printer/AP/PC/webcam/voip/iot/tv/projector/badgereader (floor)
//          + UPS/PDU managed (rack, porta di management).
// Esclude: switch/router/server/nas… (isActive), media converter (2 porte,
//          dispositivo di passaggio), patch panel/prese (no IP).
export function _isLeafEndpoint(type){
    const d = TYPES[type];
    return !!(d && d.hasIP && !d.isActive && (d.ports === 1));
}

// Cronologia discovery: il cuore PURO (sfoltimento aging+cap e normalizzazione
// VLAN-per-MAC, con le costanti DISCOVERY_HISTORY_MAX/MAX_AGE_DAYS) vive in
// lib/discovery-history.js → letto dal ponte (win.pruneDiscoveryHistory /
// win.normalizeFdbVlan / win.DISCOVERY_HISTORY_MAX). Qui restano solo i wrapper
// che toccano lo stato (state.discoveryHistory).
export function _ensureDiscoveryHistory(){
    if(!store.state.discoveryHistory) store.state.discoveryHistory = { observations:[] };
    if(!Array.isArray(store.state.discoveryHistory.observations)) store.state.discoveryHistory.observations = [];
    return store.state.discoveryHistory.observations;
}

export function _recordDiscoveryObservation(obs){
    const mac = win._normMacKey(obs?.mac);
    const ip  = String(obs?.ip || '').trim();
    if(!mac && !ip) return false;
    const list = _ensureDiscoveryHistory();
    const now = new Date().toISOString();
    const rec = {
        ts: now,
        lastSeen: now,
        count: 1,
        mac,
        ip,
        switchId: obs.switchId || '',
        switchName: obs.switchName || '',
        portId: obs.portId || '',
        ifName: obs.ifName || '',
        source: obs.source || 'discovery',
        confidence: obs.confidence || 0
    };
    const key = [rec.mac, rec.ip, rec.switchId, rec.portId, rec.ifName, rec.source].join('|');
    const prev = [...list].reverse().find(x => [x.mac, x.ip, x.switchId, x.portId, x.ifName, x.source].join('|') === key);
    if(prev){
        prev.lastSeen = now;
        prev.count = (prev.count || 1) + 1;
        if(rec.confidence > (prev.confidence || 0)) prev.confidence = rec.confidence;
        return true;
    }
    list.push(rec);
    if(list.length > win.DISCOVERY_HISTORY_MAX) list.splice(0, list.length - win.DISCOVERY_HISTORY_MAX);
    return true;
}

function _recordDiscoveryBatch(rows){
    let n = 0;
    for(const r of rows || []) if(_recordDiscoveryObservation(r)) n++;
    // L'aging (O(n)) gira una volta a fine batch, non per singola observation.
    if(n) win.pruneDiscoveryHistory(_ensureDiscoveryHistory());
    return n;
}

export function _nodeByMacMap(){
    const out = new Map();
    for(const n of store.state.nodes || []){
        const mac = win._normMacKey(n.mac);
        if(mac) out.set(mac, n);
    }
    return out;
}

// Shared segment (porta multi-MAC: _macRowsForPort/_sharedSegment*/_createSharedSegmentNode): lib/app-shared-segment.js (R9)

// Raccoglie/aggiorna la cache FDB interrogando gli switch SNMP del progetto.
// Serve per l'auto-link endpoint quando la cache non è ancora stata popolata.
async function _refreshTopoFdbCache(force=false){
    const hasCache = Object.keys(store._topoFdbCache || {}).some(k => Object.keys(store._topoFdbCache[k] || {}).length > 0);
    if(hasCache && !force){
        return { ok:true, refreshed:0, withFdb:0, cached:true };
    }

    const targets = store.state.nodes.filter(n=>{
        const cfg = n.integration || {};
        if(!(cfg.driver || '').startsWith('snmp')) return false;
        // Non limitare solo ai type="switch": durante discovery alcuni switch
        // possono essere classificati come router/firewall.
        return !!((cfg.host || n.ip || '').trim());
    });
    if(!targets.length) return { ok:false, reason:'no-switch-targets', refreshed:0, withFdb:0 };

    let refreshed = 0, withFdb = 0;
    const _fetchFdb = async (n) => {
        const cfg = n.integration || {};
        const host = (cfg.host || n.ip || '').trim();
        try{
            const body = {
                driver: cfg.driver,
                host,
                port: cfg.port || 161,
                timeout: cfg.timeout || 5,
                community: cfg.community || 'public',
                v3user: cfg.v3user,
                v3authProto: cfg.v3authProto,
                v3authPass: cfg.v3authPass,
                v3privProto: cfg.v3privProto,
                v3privPass: cfg.v3privPass,
                v3secLevel: cfg.v3secLevel,
            };
            const r = await fetch('/api/topology', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body: JSON.stringify(body),
            });
            const data = await r.json();
            if(!data.ok) return;
            refreshed++;
            const norm = win._normalizeFdbTable(data.fdbTable || {});
            store._topoFdbCache[n.id] = norm;
            store._topoFdbVlanCache[n.id] = win.normalizeFdbVlan(data.fdbVlan || {}, win._normMacKey);
            if(Object.keys(norm).length) withFdb++;
        }catch(_){}
    };
    // Query SNMP parallele a blocchi di 5: O(n×timeout) → O(ceil(n/5)×timeout)
    const BATCH = 5;
    for(let b=0;b<targets.length;b+=BATCH){
        await Promise.all(targets.slice(b, b+BATCH).map(_fetchFdb));
    }
    return { ok:true, refreshed, withFdb, cached:false };
}

// Aggiorna inventario porte SNMP (ifName/alias/lag/trunk) per migliorare il
// match ifName→porta durante auto-link endpoint (riduce i "port-not-found").
async function _refreshSnmpPortInventory(force=false){
    const targets = store.state.nodes.filter(n=>{
        const cfg = n.integration || {};
        if(!(cfg.driver || '').startsWith('snmp')) return false;
        return !!((cfg.host || n.ip || '').trim());
    });
    if(!targets.length) return { ok:false, refreshed:0, skipped:0 };

    let refreshed=0, skipped=0;
    const _fetchInv = async (n) => {
        const hasPorts = Object.keys(store.state.ports || {}).some(pid => getPortNodeId(pid)===n.id);
        if(hasPorts && !force){ skipped++; return; }
        const cfg = n.integration || {};
        const host = (cfg.host || n.ip || '').trim();
        try{
            const body = JSON.stringify({
                driver: cfg.driver || 'snmp-v2c',
                host, port: cfg.port || 161, timeout: cfg.timeout || 3,
                community: cfg.community || 'public',
                v3user: cfg.v3user || '',
                v3authProto: cfg.v3authProto || 'SHA',
                v3authPass: cfg.v3authPass || '',
                v3privProto: cfg.v3privProto || 'AES',
                v3privPass: cfg.v3privPass || '',
                v3secLevel: cfg.v3secLevel || 'authPriv'
            });
            const r = await fetch('/api/poll', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body
            });
            const data = await r.json();
            if(!data.ok) return;
            applyPollResult(n.id, data, { noHistory:true, noRender:true });
            refreshed++;
        }catch(_){}
    };
    // Query SNMP parallele a blocchi di 5: O(n×timeout) → O(ceil(n/5)×timeout)
    const BATCH = 5;
    for(let b=0;b<targets.length;b+=BATCH){
        await Promise.all(targets.slice(b, b+BATCH).map(_fetchInv));
    }
    return { ok:true, refreshed, skipped };
}

/**
 * Risolve a quale porta-switch è collegato un endpoint, usando la cache FDB
 * (store._topoFdbCache) raccolta durante poll/topology — SENZA ri-pollare.
 *
 * Anti-ambiguità (collega solo quando il match è quasi certo):
 *  - il MAC dell'endpoint deve comparire nella FDB di UN SOLO switch
 *  - la porta-switch non deve essere un trunk
 *  - la porta-switch non deve essere un uplink (pochi MAC appresi su quella porta)
 *
 * @returns {ok:true, swId, ifName, swPid, confidence} | {ok:false, reason}
 */
// Porta di TRANSITO (trunk / LAG / uplink verso un altro apparato attivo):
// un MAC appreso qui e' appreso ATTRAVERSO il collegamento — l'endpoint sta
// dietro l'altro apparato, MAI direttamente su questa porta (es. la VM su una
// VLAN del trunk: il trunk ne trasporta il MAC, ma la VM non e' attaccata li').
// Usata dall'auto-link per ESCLUDERE i candidati, non solo penalizzarli.
function _isTransitPort(swPid, swId){
    const p = store.state.ports[swPid] || {};
    if(p.isTrunk) return true;
    // Porta classificata manualmente come uplink/hypervisor = transito:
    // l'auto-link non vi attacca endpoint (effetto derivato, reversibile).
    if(p.sharedSegmentRole === 'rackuplink' || p.sharedSegmentRole === 'hypervisor') return true;
    const lg = String(p.lagGroup || '');
    if(lg.startsWith('snmp-lag-') || lg.startsWith('lldp-lag-')) return true;
    for(const l of (store.state.links || [])){
        if(l.src !== swPid && l.dst !== swPid) continue;
        // Link documentato in modalita' TRUNK sulla porta → transito per definizione.
        if(l.mode === 'trunk') return true;
        const otherPid = (l.src === swPid) ? l.dst : l.src;
        const otherNid = getPortNodeId(otherPid);
        if(!otherNid || otherNid === swId) continue;
        const otherNode = nodeById(otherNid);
        if(otherNode && !_isLeafEndpoint(otherNode.type)) return true;
    }
    return false;
}

function _resolveEndpointSwitchPort(node){
    const mac = win._normMacKey(node?.mac);
    if(!mac) return { ok:false, reason:'no-mac' };
    const hits = [];
    for(const [swId, fdb] of Object.entries(store._topoFdbCache)){
        if(swId===node.id || !fdb) continue;
        if(fdb[mac]) hits.push({ swId, ifName: fdb[mac] });
    }
    if(!hits.length)  return { ok:false, reason:'mac-not-in-fdb' };

    const cands = [];
    let transit = null;   // primo hit scartato perche' su porta di transito
    for(const h of hits){
        let macsOnPort = 0;
        for(const v of Object.values(store._topoFdbCache[h.swId] || {})) if(v===h.ifName) macsOnPort++;
        // ESCLUSIONE DURA #0: un MAC appreso su un'interfaccia AGGREGATA
        // (LAG/Po/ae/Eth-Trunk/bond…) arriva DA un uplink — è dietro il
        // collegamento, MAI attaccato direttamente qui, a prescindere dal
        // conteggio MAC e ANCHE se il LAG non è modellato (swPid null). Cattura
        // il caso reale "Zyxel impara i MAC su LAG1": senza questo, con ≤4 MAC il
        // candidato passava. Vendor-neutral via _ifNameMeta.lagToken.
        const isLagUplink = (typeof _ifNameMeta === 'function') && !!_ifNameMeta(h.ifName).lagToken;
        const swPid = _findPortByIfName(h.swId, h.ifName);
        if(isLagUplink){
            if(!transit) transit = { swId:h.swId, ifName:h.ifName, swPid:swPid||null, macsOnPort };
            continue;
        }
        if(!swPid) continue;
        // ESCLUSIONE DURA: porta di transito (trunk/LAG/uplink) → il MAC e'
        // trasportato dal collegamento, l'endpoint non e' qui. Prima era solo
        // una penalita' di score: con pochi MAC dietro il trunk il candidato
        // vinceva comunque e l'endpoint (es. VM) veniva attaccato al trunk.
        if(_isTransitPort(swPid, h.swId)){
            if(!transit) transit = { swId:h.swId, ifName:h.ifName, swPid, macsOnPort };
            continue;
        }
        // Score: porta edge (per costruzione non trunk/non transito) + bonus MAC.
        let score = 6;
        if(macsOnPort <= 2) score += 2;
        else if(macsOnPort <= 8) score += 1;
        else if(macsOnPort > 24) score -= 1;
        cands.push({ ...h, swPid, macsOnPort, score });
    }
    if(!cands.length){
        // Tutte le porte che vedono il MAC sono di transito → l'endpoint e'
        // dietro un trunk/uplink: nessun attacco automatico, collega a mano.
        if(transit) return { ok:false, reason:'port-trunk', swId:transit.swId, ifName:transit.ifName, swPid:transit.swPid, macsOnPort:transit.macsOnPort };
        return { ok:false, reason:'port-not-found' };
    }

    cands.sort((a,b)=> b.score - a.score || a.macsOnPort - b.macsOnPort);
    const best = cands[0];
    const second = cands[1];
    // Ambiguo solo se due candidati hanno punteggio praticamente uguale.
    if(second && (best.score - second.score) <= 1) return { ok:false, reason:'mac-multi-switch' };
    // Se una porta vede molti MAC non è una connessione endpoint diretta:
    // dietro può esserci uno switch unmanaged, un gateway/router o un segmento condiviso.
    if(best.macsOnPort > 4){
        return { ok:false, reason:'port-uplink', swId:best.swId, ifName:best.ifName, swPid:best.swPid, macsOnPort:best.macsOnPort };
    }

    const conf = best.score >= 6 ? 0.92 : best.score >= 4 ? 0.88 : 0.84;
    return { ok:true, swId:best.swId, ifName:best.ifName, swPid:best.swPid, confidence:conf };
}

function _findWallPortBehindInfrastructurePort(infraPid, epPid){
    const visited = new Set([infraPid]);
    const queue = [infraPid];
    while(queue.length){
        const curr = queue.shift();
        for(const l of _linksForPort(curr)){
            for(const other of _linkAdjacentPorts(l, curr)){
                if(!other || visited.has(other)) continue;
                visited.add(other);
                const n = getNodeByPortId(other);
                if(!n) continue;
                if(n.type === 'wallport'){
                    const chk = epPid ? _validateWallPortConnection(other, epPid) : {ok:true};
                    if(chk.ok && canAddConnection(other)) return other;
                    continue;
                }
                if(TYPES[n.type]?.isPassive && !_isLeafEndpoint(n.type)){
                    queue.push(other);
                }
            }
        }
    }
    return '';
}

/**
 * Tenta di collegare automaticamente un endpoint alla porta-switch corretta.
 * - Rispetta i link MANUALI: se l'endpoint ne ha già uno, non fa nulla.
 * - Può creare o aggiornare solo i propri auto-link.
 * Usa esclusivamente la cache FDB (nessun fetch). Non renderizza né marca dirty:
 * è il chiamante a decidere (così è componibile in batch all'import).
 * @returns {ok:bool, reason?, swId?, ifName?, created?:bool}
 */
export function _autoLinkEndpoint(nodeId){
    const node = nodeById(nodeId);
    if(!node) return { ok:false, reason:'no-node' };
    // Solo endpoint foglia a porta singola (printer/AP/PC/webcam/voip/…/UPS/PDU).
    // Switch/router/server si collegano via LLDP/CDP/FDB nel motore principale.
    if(!_isLeafEndpoint(node.type)) return { ok:false, reason:'tipo-non-endpoint' };
    const epPid = `${nodeId}-1`;
    const existing = store.state.links.find(l => _linkTouchesPort(l, epPid));
    if(existing && !existing.autoLinked) return { ok:false, reason:'manual-link' };
    const res = _resolveEndpointSwitchPort(node);
    if(!res.ok) return res;
    const wallPid = _findWallPortBehindInfrastructurePort(res.swPid, epPid);
    const attachPid = wallPid || res.swPid;
    if(existing){
        existing.src = attachPid; existing.dst = epPid;
        existing.autoLinked = true; existing.confidence = res.confidence; existing.protocol = wallPid ? 'MAC-WALLPORT' : 'MAC';
        _invalidateIdx();
        return { ok:true, swId:res.swId, ifName:res.ifName, wallPort:wallPid, created:false };
    }
    store.state.links.push(typeof _createLinkRecord === 'function'
        ? _createLinkRecord(attachPid, epPid, { autoLinked:true, confidence:res.confidence, protocol:wallPid ? 'MAC-WALLPORT' : 'MAC' })
        : { id:uid('l'), src:attachPid, dst:epPid, autoLinked:true, confidence:res.confidence, protocol:wallPid ? 'MAC-WALLPORT' : 'MAC' });
    _invalidateIdx();
    if(!store.state.ports[attachPid]) store.state.ports[attachPid] = {};
    if(!store.state.ports[epPid])     store.state.ports[epPid]     = {};
    return { ok:true, swId:res.swId, ifName:res.ifName, wallPort:wallPid, created:true };
}

// Handler del pulsante "Tenta collegamento automatico" (pannello proprietà endpoint).
// Esito esplicito via toast; aggiorna la vista solo se ha creato/modificato un link.
async function _autoLinkEndpointUI(){
    if(!store.selId){ return; }
    const node = nodeById(store.selId);
    // Prima assicura inventario porte SNMP (ifName/alias) per il matching.
    await _refreshSnmpPortInventory(false);
    let r = _autoLinkEndpoint(store.selId);
    // Se la cache FDB è assente/stantia, aggiorna on-demand e ritenta una volta.
    if(!r.ok && (r.reason==='mac-not-in-fdb' || r.reason==='port-not-found')){
        const info = await _refreshTopoFdbCache(true);
        if(info.refreshed > 0){
            await _refreshSnmpPortInventory(false);
            r = _autoLinkEndpoint(store.selId);
        }
    }
    if(r.ok){
        const sw = nodeById(r.swId);
        markDirty(); renderAll(); renderCables();
        _showToast(t('msg.net.linkedTo',{sw:sw?.name||sw?.hostname||r.swId,ifName:r.ifName}), 'ok');
        return;
    }
    const msg = {
        'no-mac':            t('msg.net.alNoMac'),
        'mac-not-in-fdb':    t('msg.net.alMacNotInFdb'),
        'mac-multi-switch':  t('msg.net.alMacMultiSwitch'),
        'port-trunk':        t('msg.net.alPortTrunk'),
        'port-uplink':       t('msg.net.alPortUplink'),
        'port-not-found':    t('msg.net.alPortNotFound'),
        'manual-link':       t('msg.net.alManualLink'),
        'tipo-non-endpoint': t('msg.net.alNotEndpoint'),
    }[r.reason] || t('msg.net.alFailed');
    _showToast(msg, r.reason==='manual-link' ? 'ok' : 'warn', 4000);
}

export function _autoLinkDiagText(diag){
    if(!diag) return '';
    const parts = [];
    if(diag.candidatesTotal != null) parts.push(`${diag.candidatesOverThr||0}/${diag.candidatesTotal} candidati sopra soglia`);
    if(diag.endpointReasons){
        const labels = {
            'no-mac':'senza MAC',
            'mac-not-in-fdb':'MAC non in FDB',
            'mac-multi-switch':'MAC su piu switch',
            'port-uplink':'porta con molti MAC',
            'port-trunk':'MAC dietro trunk/uplink',
            'port-not-found':'porta non risolta',
            'manual-link':'link manuale',
            'tipo-non-endpoint':'non endpoint'
        };
        const top = Object.entries(diag.endpointReasons)
            .sort((a,b)=>b[1]-a[1])
            .slice(0,3)
            .map(([k,v])=>`${labels[k]||k}: ${v}`);
        if(top.length) parts.push(top.join(' · '));
    }
    if(Array.isArray(diag.reasons) && diag.reasons.length) parts.push(diag.reasons.slice(0,2).join(' · '));
    return parts.join(' · ');
}

/**
 * Scoperta automatica e trasparente dei collegamenti fisici.
 *
 * Algoritmo multi-layer:
 *  1. Costruisce indice MAC globale da dati SNMP già importati (ifPhysAddress)
 *  2. Per ogni nodo SNMP: interroga /api/topology (LLDP + CDP + MAC FDB + ARP)
 *  3. Layer LLDP/CDP: trova nodo remoto + porte → confidence 0.97/0.90
 *  4. Layer MAC FDB : MAC appreso → interfaccia remota nota → confidence 0.72
 *  5. Layer ARP-MAC : MAC da FDB + ARP IP→MAC (router/L3) → endpoint a 1 porta
 *  6. Deduplica candidati (A↔B == B↔A, tiene la confidence più alta)
 *  7. Applica candidati ≥ 0.80: crea cavi {autoLinked, confidence, protocol}
 *     senza toccare i cavi creati manualmente
 *
 * @param {string[]|null} nodeIds — null = tutti i nodi SNMP del progetto
 * @returns {{ created: number, updated: number, lagGroups: number, protocols: Set<string>, pruned: number }}
 */
async function _autoDiscoverLinks(nodeIds){
    const CONF_LLDP = 0.97;
    const CONF_CDP  = 0.90;
    const CONF_MAC  = 0.72;   // sotto soglia: non auto-crea
    const THRESHOLD = 0.80;
    console.log(`[AutoLink] avviato - nodeIds=${nodeIds?nodeIds.join(','):'tutti'}`);
    const _findNodeByIp = ip => store.state.nodes.find(x => ((x.ip||'').trim()===ip) || ((x.integration?.host||'').trim()===ip)) || null;
    const _isIPv4 = ip => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip||'').trim());
    const diag = {
        targets:0, topoOk:0, neighborsSeen:0, fdbEntries:0, arpEntries:0,
        candidatesTotal:0, candidatesOverThr:0, byProto:{}, endpointReasons:{}, reasons:[]
    };

    const _portNodeId = pid => getPortNodeId(pid);
    const _pairSig = win.pairSig; // lib/correlate.js (logica invariata)
    const _hasLagPrefix = g => g.startsWith('snmp-lag-') || g.startsWith('lldp-lag-');
    const _lagRefByPort = pid => {
        const p = store.state.ports[pid] || {};
        const nid = _portNodeId(pid);
        const g = String(p.lagGroup || '').trim();
        if(g && _hasLagPrefix(g)) return { key: `${nid}::${g}`, gid: g };
        const lid = parseInt(p.lagId || 0, 10);
        if(lid > 0){
            const sg = `snmp-lag-${nid}-${lid}`;
            return { key: `${nid}::${sg}`, gid: sg };
        }
        return null;
    };
    const _logicalRefByPort = pid => {
        const lag = _lagRefByPort(pid);
        return lag ? { ref:`L:${lag.key}`, isLag:true } : { ref:`P:${pid}`, isLag:false };
    };
    const _candLogicalMeta = cand => {
        const s = _logicalRefByPort(cand.src);
        const d = _logicalRefByPort(cand.dst);
        const sn = _portNodeId(cand.src);
        const dn = _portNodeId(cand.dst);
        // Un LAG (LACP/EtherChannel) aggrega su DUE apparati ATTIVI. Se un capo e'
        // passivo o pass-through (patch panel, presa, VoIP, media converter) il link
        // NON e' un membro LAG: al piu' trasporta un cavo-membro tra gli switch.
        const _lagEnds = (typeof isLagEligibleType==='function')
            ? (isLagEligibleType(TYPES[nodeById(sn)?.type]) && isLagEligibleType(TYPES[nodeById(dn)?.type]))
            : true;
        let key;
        if(s.isLag && d.isLag) key = _pairSig(s.ref, d.ref);
        else if(s.isLag)       key = _pairSig(s.ref, `N:${dn}`);
        else if(d.isLag)       key = _pairSig(`N:${sn}`, d.ref);
        else                   key = _pairSig(s.ref, d.ref);
        return {
            key,
            lagLogical: !!(s.isLag || d.isLag) && _lagEnds,
        };
    };
    const _getNodeTrunkVlans = nodeId => {
        const n = nodeById(nodeId);
        if(!n || !n.integration) return [];
        const agg = (n.integration.lags || []).find(a => a.isTrunk && a.trunkVlans && a.trunkVlans.length);
        if(agg) return agg.trunkVlans;
        return n.integration.vlans || [];
    };
    const _applyLinkTrunkMeta = (linkObj, srcPid, dstPid) => {
        const srcPi = store.state.ports[srcPid] || {};
        const dstPi = store.state.ports[dstPid] || {};
        let autoTrunk = !!(srcPi.isTrunk || dstPi.isTrunk);
        let fromLag = [];

        const srcLag = _lagRefByPort(srcPid);
        const dstLag = _lagRefByPort(dstPid);
        if(srcLag || dstLag){
            const vSrc = _getNodeTrunkVlans(_portNodeId(srcPid));
            const vDst = _getNodeTrunkVlans(_portNodeId(dstPid));
            if(vSrc.length || vDst.length){
                autoTrunk = true;
                fromLag = [...new Set([ ...vSrc, ...vDst ])].sort((a,b)=>a-b);
            }
        }

        if(!autoTrunk) return;
        linkObj.mode = 'trunk';
        const allV = [...new Set([
            ...(srcPi.trunkVlans || []),
            ...(dstPi.trunkVlans || []),
            ...fromLag,
        ])].sort((a,b)=>a-b);
        if(allV.length) linkObj.trunkVlans = _vlansToRangeStr(allV);
    };

    let _skippedDown = 0;
    const targets = store.state.nodes.filter(n => {
        if(nodeIds && !nodeIds.includes(n.id)) return false;
        const cfg = n.integration || {};
        if(!((cfg.driver || '').startsWith('snmp') && !!((cfg.host || n.ip || '').trim()))) return false;
        // Salta i device già risultati irraggiungibili al Sync precedente: una walk
        // topologia su un host morto costa ~10s di timeout a vuoto. snmpStatus è
        // aggiornato dal poll che precede sempre l'auto-discovery.
        if(n.snmpStatus === 'err'){ _skippedDown++; return false; }
        return true;
    });
    diag.targets = targets.length;
    diag.skippedDown = _skippedDown;
    if(_skippedDown) console.log(`[AutoLink] saltati ${_skippedDown} device irraggiungibili (snmpStatus=err)`);
    if(!targets.length){
        diag.reasons.push(t('pnl.sys.diagNoSnmpHost'));
        return { created:0, updated:0, lagGroups:0, protocols:new Set(), pruned:0, diag };
    }

    // ---- Layer 0: indice MAC globale da porte SNMP gia importate ------------
    // macMap: { "aa:bb:cc:dd:ee:ff" -> { nodeId, portId } }
    const macMap = {};
    for(const [pid, pi] of Object.entries(store.state.ports)){
        const mac = String(pi?.mac || '').toLowerCase();
        if(!mac || mac === '00:00:00:00:00:00') continue;
        macMap[mac] = { nodeId:_portNodeId(pid), portId:pid };
    }
    const arpByMac = {};

    // ---- Contesto progetto minimale per correlazione lato server ---------------
    // Inviato a ogni chiamata /api/topology: il server esegue buildNeighborCandidates
    // e restituisce suggestedLinks già pronti. Solo i campi necessari per il match.
    const _projCtxNodes = store.state.nodes.map(n => ({
        id:       n.id,
        type:     n.type || '',
        hostname: n.hostname || '',
        name:     n.name     || '',
        ip:       n.ip       || '',
        ports:    n.ports,
        mac:      n.mac      || '',
        isLeafEndpoint: _isLeafEndpoint(n.type),
        isPassive: !!TYPES[n.type]?.isPassive,
        isActive: !!TYPES[n.type]?.isActive,
        integration: { host: (n.integration?.host || '') },
    }));
    const _projCtxPorts = {};
    for(const [pid, pi] of Object.entries(store.state.ports)){
        _projCtxPorts[pid] = {
            ifName:   pi.ifName   || '',
            alias:    pi.alias    || '',
            lagId:    pi.lagId    || 0,
            lagGroup: pi.lagGroup || '',
            mac:      pi.mac      || '',
            isTrunk:  !!pi.isTrunk,
            sharedSegmentRole: pi.sharedSegmentRole || '',
        };
    }
    const _projCtxLagGroups = store.state.lagGroups || {};

    // ---- Candidati fisici deduplicati per coppia porta-porta -----------------
    // Accumulatore puro in lib/correlate.js (dedup per coppia, miglior confidenza).
    const _cset = win.createCandidateSet();
    let historyAdded = 0;
    const addCandidate = (srcPort, dstPort, conf, proto) => _cset.add(srcPort, dstPort, conf, proto);

    // ---- Layer 1+2: LLDP/CDP + Layer 3: MAC FDB ------------------------------
    // Le /api/topology sono I/O di RETE: girano in PARALLELO a blocchi (come la
    // fase di poll) → un device SNMP lento non sequenzializza piu' l'intero Sync.
    // Root cause storica: un firewall che risponde a sysName ma va in timeout su
    // OGNI tabella costava da solo ~70s (ora cappato lato server a ~15-18s); in
    // sequenza su N device bloccava la ricostruzione della topologia. L'ELABORAZIONE
    // dei risultati resta SEQUENZIALE, in ordine di `targets`, cosi' le accumulazioni
    // (candidati, backfill ifName, cache FDB) restano DETERMINISTICHE (golden invariato).
    // AbortController: un endpoint appeso non puo' incollare il Sync all'infinito
    // (il server ha il proprio deadline; qui c'e' la cintura lato client).
    const _TOPO_BATCH = 5;
    const _TOPO_FETCH_TIMEOUT_MS = 60000;
    const _fetchTopoFor = async n => {
        const cfg  = n.integration || {};
        const host = (cfg.host || n.ip || '').trim();
        const ctrl  = (typeof AbortController === 'function') ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => { try{ ctrl.abort(); }catch(_){} }, _TOPO_FETCH_TIMEOUT_MS) : null;
        try{
            const r = await fetch('/api/topology', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                signal: ctrl ? ctrl.signal : undefined,
                body: JSON.stringify({
                    driver:  cfg.driver  || 'snmp-v2c',
                    host,
                    port:    cfg.port    || 161,
                    timeout: cfg.timeout || 5,
                    community:  cfg.community  || 'public',
                    v3user:     cfg.v3user     || '',
                    v3authProto:cfg.v3authProto|| 'SHA',
                    v3authPass: cfg.v3authPass || '',
                    v3privProto:cfg.v3privProto|| 'AES',
                    v3privPass: cfg.v3privPass || '',
                    v3secLevel: cfg.v3secLevel || 'authPriv',
                    // Contesto progetto per correlazione lato server
                    srcNodeId:        n.id,
                    projectNodes:     _projCtxNodes,
                    projectPorts:     _projCtxPorts,
                    projectLagGroups: _projCtxLagGroups,
                })
            });
            return { n, host, data: await r.json() };
        } catch(e) {
            console.warn(`[AutoLink] fetch ${n.name||host}: ${e.message}`);
            return { n, host, data: null };
        } finally {
            if(timer) clearTimeout(timer);
        }
    };
    const _topoResults = [];
    for(let _b=0; _b<targets.length; _b+=_TOPO_BATCH){
        const _chunk = await Promise.all(targets.slice(_b, _b+_TOPO_BATCH).map(_fetchTopoFor));
        for(const _res of _chunk) _topoResults.push(_res);
    }

    for(const { n, host, data } of _topoResults){
        if(!data || !data.ok) continue;
        diag.topoOk++;
        diag.neighborsSeen += (data.neighbors || []).length;
        const arpTableRaw = win._normalizeFdbTable(data.arpTable || {});
        // Fase 2 (presenza onesta cross-subnet): l'ARP di questo router/switch L3
        // (ipNetToMedia/ipNetToPhysicalTable) prova che gli host sulle SUE VLAN sono
        // VIVI (adiacenza L3) → li rende verdi anche cross-subnet SENZA pingarli. Lo
        // persistiamo per-device in store._topoArpCache (come _topoFdbCache) così la
        // passata di presenza (buildSnmpSnapshot) può consumarlo senza ri-pollare.
        const arpDev = {};
        for(const [mac, ip] of Object.entries(arpTableRaw)){
            const ip4 = String(ip || '').trim();
            if(!_isIPv4(ip4)) continue;
            if(!arpByMac[mac]) arpByMac[mac] = ip4;
            arpDev[mac] = ip4;
        }
        store._topoArpCache[n.id] = arpDev;
        diag.arpEntries += Object.keys(arpTableRaw).length;

        // ND discovery (presenza onesta cross-subnet, gemella dell'ARP sopra ma IPv6):
        // i vicini ND di questo router/switch L3 (ipNetToPhysicalTable, data.ndTable
        // = { mac -> [ip6…] }) provano che quei MAC sono VIVI dietro di lui → verdi
        // cross-subnet SENZA pingarli, anche IPv6-only. Riduco a MAC→ip6 rappresentativo
        // (pickBestIp6 = preferisci global/ULA; fallback al 1° canonico così un vicino
        // solo link-local conta comunque come "MAC vivo") e normalizzo le chiavi MAC
        // con lo STESSO _normalizeFdbTable del ramo ARP, così combaciano coi MAC
        // documentati. La passata di presenza consuma questo SOLO come observedMacs.
        const ndDev = {};
        for(const [mac, list] of Object.entries((data.ndTable && typeof data.ndTable === 'object') ? data.ndTable : {})){
            if(!Array.isArray(list) || !list.length) continue;
            ndDev[mac] = pickBestIp6(list) || canonicalizeIpv6(list[0]) || '';
        }
        store._topoNdCache[n.id] = win._normalizeFdbTable(ndDev);
        diag.ndEntries = (diag.ndEntries || 0) + Object.keys(ndDev).length;

        // Backfill ifName VENDOR-NEUTRAL (manual-first): allinea la porta DOCUMENTATA
        // all'interfaccia reale usando il vicino LLDP/CDP come segnale AUTOREVOLE, non
        // posizionale. Se con il nodo remoto esiste un UNICO cavo MANUALE su una porta di
        // n SENZA ifName, quella porta E' <nb.localPort> → le assegna l'ifName reale e
        // libera la porta che l'aveva preso per POSIZIONE (applyPollResult arricchisce le
        // porte libere per indice; l'ifName vero puo' finire su quella sbagliata). Cosi' i
        // Sync successivi combaciano per ifName → stato/porta autorevoli su QUALSIASI
        // vendor (nessuna assunzione di lab/vendor: usa la normalizzazione nomi cross-
        // vendor _ifNameMeta + LLDP/CDP standard). NON tocca la topologia (il cavo resta)
        // ne' i campi manuali (vlan/status). Ambiguo (LAG/multi-cavo verso lo stesso nodo)
        // o gia' allineato o senza prova → non tocca. Bare-global + typeof (ratchet).
        if(typeof _ifNameMeta === 'function' && typeof _findPortByIfName === 'function'){
            for(const nb of (data.neighbors || [])){
                const rem = _matchNodeByIdent(nb.remoteDevice, nb.remoteIP);
                if(!rem || !nb.localPort) continue;
                const meta = _ifNameMeta(nb.localPort);
                if(!meta || meta.isMac) continue;               // port-id MAC → non abbinabile
                let pManual = null, manualCount = 0;
                for(const l of (store.state.links || [])){
                    if(!l || l.autoLinked || !l.src || !l.dst) continue;
                    const sN = _portNodeId(l.src), dN = _portNodeId(l.dst);
                    let myPort = null;
                    if(sN === n.id && dN === rem.id) myPort = l.src;
                    else if(dN === n.id && sN === rem.id) myPort = l.dst;
                    if(!myPort) continue;
                    const pi = store.state.ports[myPort];
                    if(!pi || !String(pi.ifName || '').trim()){ pManual = myPort; manualCount++; }
                }
                if(manualCount !== 1) continue;                 // 0 o >1 → ambiguo, non toccare
                const posPid = _findPortByIfName(n.id, nb.localPort);
                if(posPid === pManual) continue;                // gia' allineato
                // Usa l'ifName in FORMA SNMP: applyPollResult confronta gli ifName per
                // match ESATTO (lowercase), non con la normalizzazione vendor-neutral, quindi
                // il nome BREVE LLDP ("Gi1/1") non combacerebbe con quello SNMP
                // ("GigabitEthernet1/1"). La porta posizionale (posPid) ha gia' la forma
                // SNMP giusta → la si sposta; senza posPid si ripiega sul nome LLDP.
                const realIfName = (posPid && store.state.ports[posPid] && store.state.ports[posPid].ifName) || nb.localPort;
                if(posPid && store.state.ports[posPid]){        // libera la porta posizionale
                    const pp = store.state.ports[posPid];
                    for(const k of ['ifName','mac','isTrunk','trunkVlans','lagId','lagIfIndex','speed']) delete pp[k];
                }
                if(!store.state.ports[pManual]) store.state.ports[pManual] = {};
                store.state.ports[pManual].ifName = realIfName;   // backfill autorevole (forma SNMP)
                diag.ifNameBackfills = (diag.ifNameBackfills || 0) + 1;
            }
        }

        // Layer 1+2: LLDP/CDP — usa i candidati già calcolati dal server se disponibili,
        // altrimenti esegue il matching client-side (fallback, comportamento precedente).
        if(Array.isArray(data.suggestedLinks) && data.suggestedLinks.length > 0){
            for(const sl of data.suggestedLinks){
                addCandidate(sl.src, sl.dst, sl.confidence, sl.protocol);
            }
        } else {
            // Fallback: matching LLDP/CDP lato browser
            for(const nb of (data.neighbors || [])){
                let remNode = _matchNodeByIdent(nb.remoteDevice, nb.remoteIP);
                // Fallback match-by-MAC: alcuni device (es. Zyxel) annunciano i vicini
                // solo col chassis-id MAC, senza sysName/IP.
                if(!remNode){
                    const cand = [nb.remoteMac, nb.remoteDevice].map(win._normMacKey).find(Boolean);
                    if(cand){
                        const hit = macMap[cand];
                        remNode = hit ? nodeById(hit.nodeId) : store.state.nodes.find(x=>win._normMacKey(x.mac)===cand);
                    }
                }
                if(!remNode){
                    console.log(`[AutoLink] remoto non trovato "${nb.remoteDevice}" / "${nb.remoteIP}" / mac:"${nb.remoteMac||''}"`);
                    continue;
                }
                const lp = _findPortByIfName(n.id, nb.localPort);
                let rp = _findPortByIfName(remNode.id, nb.remotePort);
                if(!rp){
                    const remPorts = remNode.ports !== undefined ? remNode.ports : (TYPES[remNode.type]?.ports || 0);
                    if(remPorts === 1 || _isLeafEndpoint(remNode.type)) rp = `${remNode.id}-1`;
                }
                const conf = nb.protocol === 'LLDP' ? CONF_LLDP : nb.protocol === 'CDP' ? CONF_CDP : 0.70;
                addCandidate(lp, rp, conf, nb.protocol);
            }
        }

        const fdbTable = win._normalizeFdbTable(data.fdbTable || {});
        store._topoFdbCache[n.id] = fdbTable; // cache per auto-link endpoint on-demand (senza ri-poll)
        store._topoFdbVlanCache[n.id] = win.normalizeFdbVlan(data.fdbVlan || {}, win._normMacKey); // VLAN-per-MAC (Drift guest)
        // Cache neighbors LLDP/CDP: il pulsante Topologia la riuserà senza rifare le chiamate
        store._topoNeighborsCache[n.id] = {
            ts: Date.now(),
            deviceHostname: data.hostname || host,
            deviceIP: host,
            neighbors: data.neighbors || [],
        };
        // Persistenza manual-first: la cache viaggia col progetto (store.state.topoCache,
        // stesso oggetto della variabile di sessione) → alla riapertura la
        // topologia e' subito disponibile senza rifare il Sync.
        if(store.state.topoCache !== store._topoNeighborsCache) store.state.topoCache = store._topoNeighborsCache;
        diag.fdbEntries += Object.keys(fdbTable).length;
        // Quanti MAC sono appresi su ciascuna porta dello switch: una porta con
        // pochi MAC è "access" (connessione diretta probabile), una con molti è
        // un uplink/trunk (ambiguo) → usata per la confidence adattiva.
        const macsPerIf = {};
        for(const ifn of Object.values(fdbTable)) macsPerIf[ifn] = (macsPerIf[ifn]||0)+1;
        for(const [mac, ifNameOnSwitch] of Object.entries(fdbTable)){
            const remEntry = macMap[String(mac || '').toLowerCase()];
            const lp = _findPortByIfName(n.id, ifNameOnSwitch);
            if(!lp) continue;
            const learnedOnPort = macsPerIf[ifNameOnSwitch] || 0;
            const ipFromArp = arpByMac[String(mac || '').toLowerCase()] || '';
            if(_recordDiscoveryObservation({
                mac,
                ip: ipFromArp,
                switchId: n.id,
                switchName: n.name || n.hostname || host,
                portId: lp,
                ifName: ifNameOnSwitch,
                source: ipFromArp ? 'FDB+ARP' : 'FDB',
                confidence: learnedOnPort <= 2 ? 0.83 : CONF_MAC
            })) historyAdded++;
            // GAP 3 — porta shared-segment (>4 MAC): dietro c'è quasi certamente
            // uno switch non gestito/AP. Nessuna inferenza punto-punto da qui:
            // i device NON sono collegati direttamente, sono DIETRO il segmento.
            // (L'osservazione discovery sopra resta registrata per la history;
            // il workflow dedicato è "Segmento L2 condiviso".)
            // NOTA: stesso comportamento del pure layer buildFdbCandidates —
            // questo mirror è necessario perché il cset tiene la confidence
            // MASSIMA per coppia: senza mirror il client riallargherebbe le
            // soglie strette applicate dal server.
            if(learnedOnPort > 4) continue;

            // Porta di TRANSITO (trunk/LAG/uplink verso altro apparato): il MAC
            // e' trasportato dal collegamento (es. VM su una VLAN del trunk) —
            // nessun candidato punto-punto da qui, anche con pochi MAC appresi.
            // (L'osservazione discovery sopra resta registrata per la history.)
            if(_isTransitPort(lp, n.id)) continue;

            // GAP 3 — soglie graduate (specchio di lib/correlate.js):
            //   1 MAC → 0.85 · 2 MAC → 0.80 · 3-4 MAC → 0.68 (sotto soglia 0.80)
            const confByCount = learnedOnPort <= 1 ? 0.85
                              : learnedOnPort === 2 ? 0.80
                              : 0.68;

            if(remEntry){
                if(remEntry.nodeId === n.id) continue;
                if(!remEntry.portId) continue;
                let conf = confByCount;
                let proto = 'MAC';
                // GAP 2 — cross-check bidirezionale: FDB + ifPhysAddress remota
                // + ARP che risolve allo stesso nodo → tre sorgenti concordi.
                if(ipFromArp){
                    const ipNode = _findNodeByIp(ipFromArp);
                    if(ipNode && ipNode.id === remEntry.nodeId){
                        conf = Math.min(0.93, conf + 0.05);
                        proto = 'MAC+ARP';
                    }
                }
                addCandidate(lp, remEntry.portId, conf, proto);
                continue;
            }
            // Fallback ARP (L3): MAC appreso in FDB, IP appreso da ARP su router/L3.
            if(!ipFromArp) continue;
            const remNode = _findNodeByIp(ipFromArp);
            if(!remNode || remNode.id === n.id) continue;
            let rp = null;
            const remPorts = remNode.ports !== undefined ? remNode.ports : (TYPES[remNode.type]?.ports || 0);
            if(remPorts === 1 || _isLeafEndpoint(remNode.type)) rp = `${remNode.id}-1`;
            if(!rp) continue;
            addCandidate(lp, rp, Math.max(0.5, confByCount - 0.01), 'ARP-MAC');
        }

        // ---- Server shared-segment hints -----------------------------------
        // Porta con >4 MAC rilevata lato server: marca la porta in store.state.ports
        // così _sharedSegmentInfoForPort e l'UI la mostrano subito, anche senza
        // discoveryHistory locale. Non sovrascrive classificazioni manuali.
        if(Array.isArray(data.suggestedSharedSegments)){
            for(const seg of data.suggestedSharedSegments){
                if(!seg.portId) continue;
                if(!store.state.ports[seg.portId]) store.state.ports[seg.portId] = {};
                const p = store.state.ports[seg.portId];
                if(!p.sharedSegmentRole && !p.sharedSegmentIgnored){
                    p.sharedSegmentHint = true;
                    p.sharedSegmentMacCount = Math.max(p.sharedSegmentMacCount || 0, seg.macCount || 0);
                    if(!p.ifName && seg.ifName) p.ifName = seg.ifName;
                }
            }
            diag.sharedSegmentHints = (diag.sharedSegmentHints || 0) + data.suggestedSharedSegments.length;
        }
    }

    // ---- Layer 4: endpoint passivi via FDB (printer/AP/PC/webcam con MAC noto) ----
    // Ora che store._topoFdbCache contiene la MAC-table di TUTTI gli switch interrogati,
    // collega gli endpoint il cui MAC compare in modo non ambiguo (vedi
    // _resolveEndpointSwitchPort: un solo switch, porta access, non uplink).
    let prunedEndpointLinks = 0;
    for(const node of store.state.nodes){
        if(!_isLeafEndpoint(node.type)) continue; // endpoint foglia a porta singola (incl. UPS/PDU)
        if(!win._normMacKey(node.mac)) continue;
        const epPid = `${node.id}-1`;
        // non sovrascrivere un link manuale già presente sull'endpoint
        const ex = store.state.links.find(l => _linkTouchesPort(l, epPid));
        if(ex && !ex.autoLinked){
            diag.endpointReasons['manual-link'] = (diag.endpointReasons['manual-link']||0) + 1;
            continue;
        }
        const res = _resolveEndpointSwitchPort(node);
        if(res.ok) addCandidate(res.swPid, epPid, res.confidence, 'MAC');
        else {
            if(res.reason) diag.endpointReasons[res.reason] = (diag.endpointReasons[res.reason]||0) + 1;
            // Pruning degli auto-link MAC ora riconosciuti errati: porta con
            // troppi MAC (port-uplink) O porta di transito trunk/LAG/uplink
            // (port-trunk, es. VM attaccata a torto alla porta del trunk).
            if((res.reason === 'port-uplink' || res.reason === 'port-trunk') && ex?.autoLinked && (ex.protocol === 'MAC' || ex.protocol === 'ARP-MAC' || ex.protocol === 'MAC+ARP')){
                store.state.links = store.state.links.filter(l => l !== ex);
                prunedEndpointLinks++;
            }
        }
    }

    // ---- Layer 5: Direct Connection Theorem — link switch<->switch via FDB ----
    // Inferisce i collegamenti tra switch confrontando le MAC table, anche SENZA
    // LLDP/CDP (caso tipico dei lab tipo PNETLab). Riferimento: Lowekamp et al.,
    // "Topology Discovery for Large Ethernet Networks", SIGCOMM 2001.
    //
    // Teorema: le porte x (su switch A) e y (su switch B) sono DIRETTAMENTE
    // connesse se gli insiemi di MAC appresi dietro x e dietro y sono complementari
    // — cioè non condividono alcun MAC (oltre ai MAC degli switch stessi). Se un
    // terzo switch C fosse in mezzo, il suo MAC comparirebbe dietro entrambe le
    // porte → intersezione non vuota → scartato.
    let dctLinks = 0;
    try{
        // MAC di ogni nodo (dalle porte SNMP importate)
        const nodeMacs = {};
        for(const [mac, e] of Object.entries(macMap)){
            (nodeMacs[e.nodeId] ??= new Set()).add(mac);
        }
        // Per ogni switch con FDB: ifName -> Set(MAC) appresi su quella porta
        const portMacs = {};
        for(const [swId, fdb] of Object.entries(store._topoFdbCache)){
            const pm = portMacs[swId] = {};
            for(const [mac, ifn] of Object.entries(fdb)){
                (pm[ifn] ??= new Set()).add(String(mac).toLowerCase());
            }
        }
        const swIds = Object.keys(portMacs);
        for(let i=0;i<swIds.length;i++){
            for(let j=i+1;j<swIds.length;j++){
                const A=swIds[i], B=swIds[j];
                const macsA=nodeMacs[A], macsB=nodeMacs[B];
                if(!macsA?.size || !macsB?.size) continue; // servono i MAC dei due switch
                // porta x di A che "vede" un MAC di B, e porta y di B che vede un MAC di A
                const findPort = (pm, macs) => {
                    for(const [ifn,set] of Object.entries(pm)) if([...macs].some(m=>set.has(m))) return ifn;
                    return null;
                };
                const portX = findPort(portMacs[A], macsB);
                const portY = findPort(portMacs[B], macsA);
                if(!portX || !portY) continue;
                // Complementarità: nessun MAC comune dietro le due porte, esclusi i
                // MAC degli switch A e B stessi → garantisce assenza di switch in mezzo.
                const exclude = new Set([...macsA, ...macsB]);
                const Fby = portMacs[B][portY];
                const overlap = [...portMacs[A][portX]].some(m => !exclude.has(m) && Fby.has(m));
                if(overlap) continue;
                const pa=_findPortByIfName(A,portX), pb=_findPortByIfName(B,portY);
                if(pa && pb){ addCandidate(pa, pb, 0.85, 'FDB-DCT'); dctLinks++; }
            }
        }
    }catch(e){ console.warn('[AutoLink] DCT:', e.message); }

    // ---- Diagnostica: conteggio candidati per metodo (per capire i "0 link") --
    {
        const byProto = {};
        for(const c of _cset.values()) byProto[c.protocol]=(byProto[c.protocol]||0)+1;
        const overThr = _cset.values().filter(c=>c.confidence>=THRESHOLD).length;
        diag.byProto = byProto;
        diag.candidatesTotal = _cset.size();
        diag.candidatesOverThr = overThr;
        console.log(`[AutoLink] candidati: ${_cset.size()} totali, ${overThr} sopra soglia ${THRESHOLD} · per metodo ${JSON.stringify(byProto)} · DCT switch↔switch: ${dctLinks}`);
    }

    // ---- Inferenza LAG + trunk dalle adiacenze ad alta confidenza ------------
    let lagGroups = 0;
    try{
        const byPair = {};
        const candList = _cset.values();
        for(const cand of candList){
            if(cand.confidence < CONF_CDP) continue; // LLDP + CDP
            const a = _portNodeId(cand.src), b = _portNodeId(cand.dst);
            if(!a || !b || a === b) continue;
            const key = a < b ? `${a}||${b}` : `${b}||${a}`;
            (byPair[key] ??= []).push(cand);
        }

        for(const [key, pairs] of Object.entries(byPair)){
            if(pairs.length < 2) continue;
            const groupId = `lldp-lag-${key}`;
            if(!store.state.lagGroups) store.state.lagGroups = {};
            if(!store.state.lagGroups[groupId]){
                const [na, nb] = key.split('||');
                const nA = nodeById(na), nB = nodeById(nb);
                // Porte di QUESTA coppia su un dato nodo (per scegliere l'aggregatore GIUSTO,
                // non il primo qualsiasi: uno switch puo' avere piu' Port-channel).
                const portsOfNode = nid => pairs.map(p =>
                    _portNodeId(p.src) === nid ? p.src : (_portNodeId(p.dst) === nid ? p.dst : null)
                ).filter(Boolean);
                const pickAggNameFor = (node, pids) => {
                    const lags = (node && node.integration && node.integration.lags) || [];
                    if(!lags.length) return null;
                    const vlans = new Set(); let lagId = 0;
                    for(const pid of pids){
                        const pp = store.state.ports[pid]; if(!pp) continue;
                        if(pp.lagId) lagId = pp.lagId;
                        (pp.trunkVlans || []).forEach(v => vlans.add(v));
                    }
                    // 1) match preciso per lagId del bundle
                    if(lagId){
                        const byId = lags.find(l => l.name && (l.lagId === lagId || l.index === lagId));
                        if(byId) return byId.name;
                    }
                    // 2) match per set esatto di VLAN trunk trasportate
                    if(vlans.size){
                        const byVlan = lags.find(l => l.name && Array.isArray(l.trunkVlans)
                            && l.trunkVlans.length === vlans.size && l.trunkVlans.every(v => vlans.has(v)));
                        if(byVlan) return byVlan.name;
                    }
                    // 3) fallback storico: primo aggregatore con nome
                    const any = lags.find(l => l.name);
                    return any ? any.name : null;
                };
                const autoName = pickAggNameFor(nA, portsOfNode(na)) || pickAggNameFor(nB, portsOfNode(nb));
                if(autoName) store.state.lagGroups[groupId] = autoName;
            }

            let changed = 0;
            for(const p of pairs){
                if(!store.state.ports[p.src]) store.state.ports[p.src] = {};
                if(!store.state.ports[p.dst]) store.state.ports[p.dst] = {};
                const sLag = String(store.state.ports[p.src].lagGroup || '');
                const dLag = String(store.state.ports[p.dst].lagGroup || '');
                if(!sLag.startsWith('snmp-lag-') && sLag !== groupId){ store.state.ports[p.src].lagGroup = groupId; changed++; }
                if(!dLag.startsWith('snmp-lag-') && dLag !== groupId){ store.state.ports[p.dst].lagGroup = groupId; changed++; }
                if(!store.state.ports[p.src].isTrunk){ store.state.ports[p.src].isTrunk = true; changed++; }
                if(!store.state.ports[p.dst].isTrunk){ store.state.ports[p.dst].isTrunk = true; changed++; }
            }

            const nodesInLag = new Set();
            for(const p of pairs){
                nodesInLag.add(_portNodeId(p.src));
                nodesInLag.add(_portNodeId(p.dst));
            }
            for(const nid of nodesInLag){
                const node = nodeById(nid);
                const aggs = (node && node.integration && node.integration.lags) || [];
                const trunkAgg = aggs.find(a => a.isTrunk && a.trunkVlans && a.trunkVlans.length > 0);
                let dedupVlans = [];
                if(trunkAgg){
                    dedupVlans = Array.from(new Set(trunkAgg.trunkVlans)).sort((a,b)=>a-b);
                } else {
                    const vlSet = [];
                    for(const [pid, pp] of Object.entries(store.state.ports)){
                        if(_portNodeId(pid) !== nid) continue;
                        if(pp.isTrunk && pp.trunkVlans && pp.trunkVlans.length){
                            pp.trunkVlans.forEach(v => vlSet.push(v));
                        }
                    }
                    if(vlSet.length){
                        dedupVlans = Array.from(new Set(vlSet)).sort((a,b)=>a-b);
                    } else {
                        const nodeVlans = (node && node.integration && node.integration.vlans) || [];
                        dedupVlans = Array.from(new Set(nodeVlans)).sort((a,b)=>a-b);
                    }
                }

                if(!dedupVlans.length) continue;
                for(const p of pairs){
                    if(_portNodeId(p.src) === nid && !(store.state.ports[p.src].trunkVlans || []).length){
                        store.state.ports[p.src].trunkVlans = dedupVlans;
                        changed++;
                    }
                    if(_portNodeId(p.dst) === nid && !(store.state.ports[p.dst].trunkVlans || []).length){
                        store.state.ports[p.dst].trunkVlans = dedupVlans;
                        changed++;
                    }
                }
            }

            if(changed > 0) lagGroups++;
        }
    } catch(lagErr){
        console.error('[AutoLink] LAG inference errore:', lagErr);
    }

    // Un UPLINK dedotto dalla sola FDB (MAC-UPLINK) ha la porta remota messa a DEFAULT
    // (`<node>-1`, cfr. lib/correlate.js): il capo remoto e la sua eventuale aggregazione
    // NON sono osservati — tipicamente un apparato CIECO senza SNMP (es. Zyxel GS1200) di
    // cui NON conosciamo la porta. Anche se la porta LOCALE e' un membro LAG, non deve
    // diventare un membro LAG "confermato": resta UN solo cavo "Inferito · da verificare"
    // (protocol → linkState 'ambiguous'), che l'utente conferma e completa. Senza
    // lagLogicalKey linkState() non lo promuove a 'lag'. Vendor-neutral: chiave sul
    // protocollo, non sul vendor.
    const _isInferredUplinkProto = p => String(p || '').toUpperCase() === 'MAC-UPLINK';

    // ---- Candidati fisici: ogni membro LAG resta un cavo porta-porta ----------
    const physicalCandidates = {};
    for(const cand of _cset.values()){
        if(!cand?.src || !cand?.dst) continue;
        const meta = _candLogicalMeta(cand);
        const pair = _pairSig(cand.src, cand.dst);
        const key = pair;
        const proto = cand.protocol || 'AUTO';
        const lagLogical = meta.lagLogical && !_isInferredUplinkProto(proto);
        const ex = physicalCandidates[key];
        if(!ex){
            physicalCandidates[key] = {
                src: cand.src,
                dst: cand.dst,
                confidence: cand.confidence,
                protocol: proto,
                logicalKey: lagLogical ? meta.key : '',
                lagLogical: lagLogical,
                memberPairs: new Set([pair]),
                protocols: new Set([proto]),
                _repPair: pair,
            };
            continue;
        }
        ex.memberPairs.add(pair);
        ex.protocols.add(proto);
        const better = cand.confidence > ex.confidence ||
            (cand.confidence === ex.confidence && pair < ex._repPair);
        if(better){
            ex.src = cand.src;
            ex.dst = cand.dst;
            ex.confidence = cand.confidence;
            ex.protocol = proto;
            ex._repPair = pair;
        }
    }
    console.log(`[AutoLink] candidati fisici=${_cset.size()}, applicabili=${Object.keys(physicalCandidates).length}`);

    // ---- Applica candidati fisici con confidence >= THRESHOLD ----------------
    let created = 0, updated = 0;
    const protocols = new Set();
    const existingByPair = Object.create(null);

    for(const l of store.state.links){
        const pKey = _pairSig(l.src, l.dst);
        if(!existingByPair[pKey]) existingByPair[pKey] = l;
    }

    // Lista nera utente: coppie di porte rifiutate con "Elimina" su cavi
    // ambigui (vedi deleteLink in app.js). Le saltiamo prima di crearne uno.
    // Un Ctrl+Z dopo l'eliminazione svuota anche la blacklist (pushHistory).
    // Coerente col pattern industriale (SolarWinds Ignore List, Broadcom NFA).
    const _rejected = Array.isArray(store.state.rejectedAutoLinks) ? store.state.rejectedAutoLinks : [];

    for(const cand of Object.values(physicalCandidates)){
        if(cand.confidence < THRESHOLD){
            console.log(`[AutoLink] skip conf ${(cand.confidence*100).toFixed(0)}% ${cand.src} <-> ${cand.dst}`);
            continue;
        }

        const pairKey = _pairSig(cand.src, cand.dst);

        if(_rejected.includes(pairKey)){
            console.log(`[AutoLink] skip rejected by user: ${cand.src} <-> ${cand.dst}`);
            continue;
        }

        const existing = existingByPair[pairKey] || null;

        if(existing){
            if(existing.autoLinked){
                existing.src = cand.src;
                existing.dst = cand.dst;
                existing.confidence = cand.confidence;
                existing.protocol = cand.protocol;
                if(cand.lagLogical){
                    existing.lagLogicalKey = cand.logicalKey;
                    existing.lagMembers = Array.from(cand.memberPairs);
                    existing.lagMemberPair = pairKey;
                } else {
                    delete existing.lagLogicalKey;
                    delete existing.lagMembers;
                    delete existing.lagMemberPair;
                }
                _applyLinkTrunkMeta(existing, cand.src, cand.dst);
                for(const p of cand.protocols) protocols.add(p);
                updated++;
            }
            continue; // manual link: non toccare
        }

        const linkObj = {
            id: uid('l'),
            src: cand.src,
            dst: cand.dst,
            autoLinked: true,
            confidence: cand.confidence,
            protocol: cand.protocol,
        };
        if(cand.lagLogical){
            linkObj.lagLogicalKey = cand.logicalKey;
            linkObj.lagMembers = Array.from(cand.memberPairs);
            linkObj.lagMemberPair = _pairSig(cand.src, cand.dst);
        }
        _applyLinkTrunkMeta(linkObj, cand.src, cand.dst);

        store.state.links.push(typeof _normalizeLinkMetadata === 'function' ? _normalizeLinkMetadata(linkObj) : linkObj);
        existingByPair[_pairSig(linkObj.src, linkObj.dst)] = linkObj;
        for(const p of cand.protocols) protocols.add(p);
        created++;
    }

    // ---- A2 (audit 2026-07-20): un'adiacenza = un solo cavo ------------------
    // Sopprime i link AUTO non-trusted (INFERRED/MAC/…) la cui porta fisica ha
    // GIÀ un link trusted (manuale o LLDP/CDP) verso lo stesso nodo remoto: era
    // il "doppio cavo + porta fantasma" col port-id annunciato come MAC. Pure
    // (lib/correlate.js), consumata come global bare con typeof-guard.
    if(typeof suppressInferredDuplicates === 'function'){
        const supp = suppressInferredDuplicates(store.state.links, _portNodeId);
        if(supp.removed.length){
            store.state.links = supp.links;
            for(const rl of supp.removed){
                delete existingByPair[_pairSig(rl.src, rl.dst)];
                console.log(`[AutoLink] soppresso duplicato inferito ${rl.src} <-> ${rl.dst} (adiacenza già coperta da un link trusted)`);
            }
        }
    }

    // Pulizia duplicati residui: conserva un solo link per coppia porta-porta.
    let pruned = prunedEndpointLinks, expanded = 0;
    const keepIdxByPair = Object.create(null);
    const cleanedLinks = [];
    const _logicalMetaFromLink = l => {
        return _candLogicalMeta({ src:l.src, dst:l.dst });
    };
    const _scoreKeepLink = l => {
        // Preferisci link manuali, poi maggiore confidence, poi metadata LAG.
        return (l?.autoLinked ? 0 : 2)
            + (l?.confidence || 0)
            + (l?.lagLogicalKey ? 0.25 : 0)
            + (Array.isArray(l?.lagMembers) && l.lagMembers.length ? 0.1 : 0)
            + (l?.mode === 'trunk' ? 0.05 : 0)
            + (l?.label ? 0.01 : 0);
    };
    const _mergeLagMembers = (target, sourceArr) => {
        if(!Array.isArray(target.lagMembers)) target.lagMembers = [];
        if(!Array.isArray(sourceArr)) return;
        for(const p of sourceArr){
            if(!target.lagMembers.includes(p)) target.lagMembers.push(p);
        }
    };
    const _pairsForLink = l => {
        const out = [];
        const add = (a,b) => {
            if(!a||!b||a===b) return;
            const p = _pairSig(a,b);
            if(!out.includes(p)) out.push(p);
        };
        if(l.lagMemberPair){
            const parts = String(l.lagMemberPair||'').split('||');
            if(parts.length===2) add(parts[0],parts[1]);
            if(out.length) return out;
        }
        add(l.src,l.dst);
        if(Array.isArray(l.lagMembers)){
            for(const raw of l.lagMembers){
                const parts = String(raw||'').split('||');
                if(parts.length===2) add(parts[0],parts[1]);
            }
        }
        return out;
    };
    const _refreshLagMeta = l => {
        const meta = _logicalMetaFromLink(l);
        // Stessa regola della creazione: un uplink FDB inferito (MAC-UPLINK) non viene
        // ri-promosso a LAG durante il dedup, altrimenti linkState() lo mostrerebbe "LAG".
        if(meta.lagLogical && !_isInferredUplinkProto(l.protocol)){
            l.lagLogicalKey = meta.key;
            l.lagMemberPair = _pairSig(l.src,l.dst);
        } else {
            delete l.lagLogicalKey;
            delete l.lagMemberPair;
            delete l.lagMembers;
        }
        return meta;
    };
    const _addCleanLink = l => {
        const pair = _pairSig(l.src,l.dst);
        _refreshLagMeta(l);
        const prevIdx = keepIdxByPair[pair];
        if(prevIdx === undefined){
            keepIdxByPair[pair] = cleanedLinks.length;
            cleanedLinks.push(l);
            return;
        }
        const prev = cleanedLinks[prevIdx];
        const prevScore = _scoreKeepLink(prev);
        const currScore = _scoreKeepLink(l);
        _mergeLagMembers(prev, l.lagMembers);
        if(currScore > prevScore){
            _mergeLagMembers(l, prev.lagMembers);
            cleanedLinks[prevIdx] = l;
        }
        pruned++;
    };

    for(const l of store.state.links){
        const pairs = _pairsForLink(l);
        if(l.lagLogicalKey && pairs.length>1) expanded += pairs.length-1;
        for(let i=0;i<pairs.length;i++){
            const parts = pairs[i].split('||');
            const next = i===0 ? l : { ...l, id:uid('l') };
            next.src = parts[0];
            next.dst = parts[1];
            _addCleanLink(next);
        }
    }

    const membersByLagKey = Object.create(null);
    for(const l of cleanedLinks){
        if(!l.lagLogicalKey) continue;
        const pair = _pairSig(l.src,l.dst);
        (membersByLagKey[l.lagLogicalKey] ??= new Set()).add(pair);
    }
    for(const l of cleanedLinks){
        if(!l.lagLogicalKey) continue;
        l.lagMembers = Array.from(membersByLagKey[l.lagLogicalKey] || []);
        if(!l.lagMemberPair) l.lagMemberPair = _pairSig(l.src,l.dst);
    }

    // Una porta ATTIVA termina UN solo membro LAG: se piu' cavi-membro AUTO se la
    // contendono (tipico dell'inferenza FDB, il MAC del LAG appare su piu' porte),
    // tieni il piu' affidabile (manuale > LLDP/CDP > MAC/FDB). Non tocca segmenti
    // condivisi non-LAG ne' pass-through (lib/lag-reconcile.js, condivisa col load).
    if(typeof reconcileLagMemberConflicts === 'function'){
        const _lagType = pid => (TYPES[nodeById(getPortNodeId(pid))?.type] || null);
        const _rec = reconcileLagMemberConflicts(cleanedLinks, { typeOfPort: _lagType });
        if(_rec.dropped.length){
            cleanedLinks.length = 0;
            cleanedLinks.push(..._rec.keep);
            pruned += _rec.dropped.length;
        }
    }

    if(pruned > 0 || expanded > 0){
        store.state.links = cleanedLinks;
        if(expanded > 0){
            created += expanded;
            console.log(`[AutoLink] link fisici LAG espansi: ${expanded}`);
        }
        if(pruned > 0) console.log(`[AutoLink] duplicati porta-porta rimossi: ${pruned}`);
    }

    // ---- Materializzazione nodi mancanti (gateway annunciato + switch inferito) ----
    // Unico gap che il Sync non copriva: creare i NODI che prima nessuno creava.
    // Riusa i pollResults GIÀ raccolti (_topoResults) → nessun doppio poll. Le hint
    // di segmento condiviso e il self-heal sono già fatti sopra: qui NON si ripetono.
    try {
        if(typeof materializeTopologyNodes === 'function'){
            const _pollForMat = _topoResults
                .filter(r => r && r.data && r.data.ok)
                .map(r => ({ nodeId: r.n.id, srcIp: (r.n && r.n.ip) || '', fdbTable: r.data.fdbTable || {},
                             neighbors: r.data.neighbors || [], suggestedSharedSegments: r.data.suggestedSharedSegments || [] }));
            const _mat = materializeTopologyNodes(_pollForMat);
            if(_mat.nodes || _mat.links){
                created += _mat.links;
                pruned  += _mat.pruned;
                diag.materializedNodes = (diag.materializedNodes || 0) + _mat.nodes;
                console.log(`[AutoLink] materializzati ${_mat.nodes} nodi (gateway/switch inferiti) + ${_mat.links} cavi`);
            }
        }
    } catch(e){ console.warn(`[AutoLink] materializzazione: ${e.message}`); }

    if(created > 0 || updated > 0 || lagGroups > 0 || pruned > 0 || historyAdded > 0) markDirty();
    if(created===0 && updated===0){
        if(diag.topoOk===0) diag.reasons.push(t('pnl.sys.diagNoTopoResp'));
        if(diag.neighborsSeen===0) diag.reasons.push(t('pnl.sys.diagNoNeighbors'));
        if(diag.fdbEntries===0) diag.reasons.push(t('pnl.sys.diagNoFdb'));
        if(diag.arpEntries===0) diag.reasons.push(t('pnl.sys.diagNoArp'));
        if(diag.candidatesTotal===0) diag.reasons.push(t('pnl.sys.diagNoCandidates'));
        else if(diag.candidatesOverThr===0) diag.reasons.push(`Candidati presenti ma sotto soglia ${THRESHOLD}.`);
    }
    return { created, updated, lagGroups, protocols, pruned, diag };
}

expose({
    _matchNodeByIdent, _isLeafEndpoint, _ensureDiscoveryHistory,
    _recordDiscoveryObservation, _recordDiscoveryBatch, _nodeByMacMap,
    _refreshTopoFdbCache, _refreshSnmpPortInventory, _isTransitPort,
    _resolveEndpointSwitchPort, _findWallPortBehindInfrastructurePort, _autoLinkEndpoint,
    _autoLinkEndpointUI, _autoLinkDiagText, _autoDiscoverLinks,
    // pruneDiscoveryHistory / normalizeFdbVlan / DISCOVERY_HISTORY_MAX* → lib/discovery-history.js
});
