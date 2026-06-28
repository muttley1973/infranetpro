// ============================================================
// DRIFT REPORT — orchestratore + UI (migrato a ESM, esbuild)
// ============================================================
// Collega lo state dell'app al diff engine puro (lib/drift-report.js):
//   1) snapshot DOC catturato PRIMA del sync (il sync sovrascrive i campi base)
//   2) pollAllSNMP() riusato AS-IS (nessuna modifica al sync)
//   3) snapshot REALTA' da state.ports + _topoFdbCache dopo il sync
//   4) aggiorna downStreak per porta (regola "cavo fantasma")
//   5) buildDriftReport → render pannello
// Azioni 1-click: aggiorna doc (preview) / ignora (persistente) / investiga.
// Persistenza ADDITIVA: state.driftIgnores[] + state.ports[pid].downStreak.
//
// Tutte le dipendenze passano dal ponte: lib <script> (buildDriftReport da
// drift-report.js; isVirtualMac/isRandomizedMac da mac-class.js) e globali/glue
// legacy (state, pollAllSNMP, renderAll, …) via win.*; `t` dal ponte. Lo stato
// condiviso `_driftReport` vive su window (store._driftReport): è letto E scritto
// anche da src/app-drift-adopt.js, quindi NON è una variabile di modulo.
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { TYPES } from './app-types.js';   // catalogo tipi: distingue gli elementi passivi dall'audit di presenza
import { escapeHTML, normalizeMacAddress } from './app-util.js';
import { nodeById, markDirty, getNodeByPortId, getNodeDisplayName, pushHistory, logAudit } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { showAlert } from './app-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderAutomationMenu } from './app-vlan-autopoll.js';   // setAutoIpRenew aggiorna il popover Automazioni

// _driftReport è stato condiviso cross-boundary (scritto anche da
// app-drift-adopt.js) → vive su window, mai come binding di modulo.
if(typeof store._driftReport === 'undefined') store._driftReport = null;
let _driftRunning = false;
const DRIFT_DOWN_STREAK_N = 3;

function _driftNorm(mac){
    const s = (typeof normalizeMacAddress === 'function') ? normalizeMacAddress(mac) : String(mac || '');
    return String(s).toLowerCase();
}
// Classificazione MAC delegata a lib/mac-class.js (pura, testata): NIC virtuali
// (container/hypervisor) e MAC randomizzati/locally-administered (telefoni/BYOD).
function _driftPortLabel(pid){
    const n = getNodeByPortId(pid);   // importato da app.js (guardia win.* ridondante rimossa)
    const num = String(pid).slice(String(pid).lastIndexOf('-') + 1);
    const pn = (n && typeof win._frontPanelPortLabel === 'function') ? win._frontPanelPortLabel(n, num, n.ports || 0) : num;
    const nm = n ? (getNodeDisplayName(n) || n.name || n.id) : pid;
    return `${nm} / P${pn}`;
}

// ── 1) Snapshot DOC (PRIMA del sync) ─────────────────────────────────
export function _driftBuildDocSnapshot(){
    const state = store.state;
    const ports = {};
    const linkPids = new Set();
    for(const l of state.links){ if(l && l.src) linkPids.add(l.src); if(l && l.dst) linkPids.add(l.dst); }
    for(const pid of linkPids){
        const pi = state.ports[pid] || {};
        ports[pid] = {
            label: _driftPortLabel(pid),
            status: pi.statusOvr ?? pi.status ?? null,
            speed:  pi.speedOvr  ?? pi.speed  ?? null,
            duplex: pi.duplex ?? null,
            vlan:   pi.vlanOvr   ?? pi.vlan   ?? null,
        };
    }
    const macs = [];
    const deviceSigs = [];
    for(const n of state.nodes){
        // VM ospitate (node.vms[]): i loro MAC sono "noti" (documentati) → fuori dai
        // non-documentati alla prossima scansione. SOLO deviceSigs, NON macs: una VM
        // (magari spenta) non entra nell'audit di presenza, come i passivi.
        if(Array.isArray(n.vms)) for(const vm of n.vms){ if(vm && vm.mac) deviceSigs.push(_driftNorm(vm.mac)); }
        if(!n.mac) continue;
        deviceSigs.push(_driftNorm(n.mac));   // "noto" → escluso dai non-documentati (invariato)
        // Audit di PRESENZA: gli elementi passivi SENZA IP propria (prese a muro,
        // patch panel, passacavi, quadri elettrici) non hanno un'identità di rete
        // verificabile. Un MAC eventualmente stampato su di loro (visto a valle
        // durante il Sync) appartiene al device COLLEGATO, non alla presa: la presa
        // non risponde a ping/SNMP/ARP, quindi finirebbe SEMPRE tra gli "assenti"
        // (e verrebbe ingrigita). Si verifica ciò che ci sta DIETRO, non la presa.
        // I passivi CON IP (PDU/ATS/media-converter) restano verificabili.
        const def = TYPES[n.type];
        if(def && def.isPassive && !def.hasIP) continue;
        // nodeId: un device che ha risposto al sync non è "assente" anche senza FDB.
        // ip: per rilevare il CAMBIO INDIRIZZO (stesso MAC, IP diverso in rete).
        macs.push({ mac: n.mac, label: getNodeDisplayName(n) || n.name || n.id, nodeId: n.id, ip: ((n.integration && n.integration.host) || n.ip || '').trim(), ipManual: !!n.ipManual });
    }
    for(const pid of Object.keys(state.ports)){ const m = state.ports[pid] && state.ports[pid].mac; if(m) deviceSigs.push(_driftNorm(m)); }
    const cables = state.links.map(l => ({ id: l.id, label: (l.label || win._cableAutoLabel(l)), src: l.src, dst: l.dst }));
    return { ports, macs, deviceSigs, cables };
}

// ── 4) Aggiorna lo streak "porta down" per le porte documentate ──────
function _driftUpdateStreaks(docSnap){
    const state = store.state;
    for(const pid of Object.keys(docSnap.ports)){
        const nodeId = String(pid).slice(0, String(pid).lastIndexOf('-'));
        const n = nodeById(nodeId);   // importato da app.js (guardia win.* ridondante rimossa)
        if(!n || n.snmpStatus !== 'ok') continue;           // device muto → non valutabile, non toccare
        const pi = state.ports[pid]; if(!pi) continue;
        if(pi.status === 'active') pi.downStreak = 0;
        else pi.downStreak = (pi.downStreak || 0) + 1;
    }
}

// ── 2/3) Snapshot REALTA' (DOPO il sync) ─────────────────────────────
function _driftBuildSnmpSnapshot(docSnap, reachable, arpTable){
    const state = store.state;
    const responded = {};
    for(const n of state.nodes){ if(n.snmpStatus === 'ok') responded[n.id] = true; }
    // Presenza MULTI-SEGNALE: un device è presente se ha risposto a SNMP OPPURE
    // se il suo IP è risultato raggiungibile dalla sweep (ping ICMP / ARP / TCP).
    // Così "Verifica documentazione" non dà per assenti i device vivi che NON
    // parlano SNMP (PC/IoT/UPS/webcam…). reachabilityChecked = la sweep ha girato
    // e ha trovato vivo almeno un host (vantaggio di osservabilità valido).
    const reach = (reachable && typeof reachable === 'object') ? reachable : null;
    // Osservabilità: la sweep ha girato se ha trovato vivo almeno un host OPPURE
    // se abbiamo una tabella ARP non vuota (anch'essa è una vista della rete).
    const reachabilityChecked = (!!reach && Object.values(reach).some(r => r && r.alive))
        || (!!arpTable && typeof arpTable === 'object' && Object.keys(arpTable).length > 0);
    const presentNodeIds = {};
    for(const n of state.nodes){
        if(n.snmpStatus === 'ok'){ presentNodeIds[n.id] = true; continue; }
        if(reach){
            const ip = ((n.integration||{}).host || n.ip || '').trim();
            if(ip && reach[ip] && reach[ip].alive) presentNodeIds[n.id] = true;
        }
    }
    // Mappa MAC→IP dalla tabella ARP COMPLETA del segmento: un MAC documentato
    // visto vivo a un IP è presente (anche se l'IP è cambiato); IP diverso da
    // quello documentato = "cambio IP". Usa l'ARP intero (non solo gli IP
    // documentati) così becca anche un device spostato a un IP NUOVO.
    const macAtIp = {};
    const arp = (arpTable && typeof arpTable === 'object') ? arpTable : null;
    if(arp){
        for(const ip of Object.keys(arp)){
            const k = String(arp[ip] || '').toLowerCase();
            if(k && !macAtIp[k]) macAtIp[k] = ip;
        }
    } else if(reach){   // fallback: MAC dai soli IP documentati raggiunti
        for(const ip of Object.keys(reach)){
            const info = reach[ip];
            if(info && info.alive && info.mac){
                const k = String(info.mac).toLowerCase();
                if(k && !macAtIp[k]) macAtIp[k] = ip;
            }
        }
    }
    // Subnet (/24) effettivamente OSSERVATE dalla sweep (fix falso "assente"
    // cross-subnet): un /24 è osservato se c'è un'entry ARP in quella subnet
    // (vista a L2 dal server) o un host raggiunto vivo. I device su subnet NON
    // incluse qui non vanno dichiarati assenti — la sweep era cieca lì.
    const _net24 = ip => { const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\./.exec(String(ip || '')); return m ? m[1] : null; };
    const observedSubnets = new Set();
    if(arp){ for(const ip of Object.keys(arp)){ const n = _net24(ip); if(n) observedSubnets.add(n); } }
    if(reach){ for(const ip of Object.keys(reach)){ if(reach[ip] && reach[ip].alive){ const n = _net24(ip); if(n) observedSubnets.add(n); } } }
    const ports = {};
    for(const pid of Object.keys(docSnap.ports)){
        const pi = state.ports[pid] || {};
        ports[pid] = { status: pi.status ?? null, speed: pi.speed ?? null, duplex: pi.duplex ?? null, vlan: pi.vlan ?? null };
    }
    const fdb = (typeof store._topoFdbCache === 'object' && store._topoFdbCache) ? store._topoFdbCache : {};
    // OSSERVABILITÀ: abbiamo almeno una MAC-table (FDB) popolata? Senza, non
    // sappiamo NULLA su chi è presente in rete → il motore non deve dichiarare
    // nessuno "assente" (vedi guardia macOrphan in drift-report.js). Tipico
    // quando il Sync fallisce su (quasi) tutti i device: FDB vuoto.
    const fdbObserved = Object.values(fdb).some(t => t && Object.keys(t).length > 0);
    const observedMacs = [];
    for(const sw of Object.keys(fdb)){ for(const mac of Object.keys(fdb[sw] || {})) observedMacs.push(mac); }
    for(const pid of Object.keys(state.ports)){ const m = state.ports[pid] && state.ports[pid].mac; if(m) observedMacs.push(m); }
    const known = new Set(docSnap.deviceSigs);
    const vlanCache = (typeof win._topoFdbVlanCache === 'object' && win._topoFdbVlanCache) ? win._topoFdbVlanCache : {};
    const observedDevices = [];
    const seen = new Set();
    for(const sw of Object.keys(fdb)){
        const swNode = nodeById(sw);   // importato da app.js (guardia win.* ridondante rimossa)
        const swFdb = fdb[sw] || {};
        const swVlan = vlanCache[sw] || {};
        // Conteggio MAC per porta dello switch: un uplink affollato (AP/hub/guest)
        // raccoglie tanti MAC su una sola ifName → tutti endpoint, non infrastruttura.
        const macsPerIf = (typeof win.countMacsPerPort === 'function') ? win.countMacsPerPort(swFdb) : {};
        for(const [mac, ifName] of Object.entries(swFdb)){
            const sig = _driftNorm(mac);
            if(!sig || seen.has(sig) || known.has(sig) || (typeof win.isVirtualMac === 'function' && win.isVirtualMac(mac))) continue;
            seen.add(sig);
            observedDevices.push({
                sig, mac,
                label: `${t('pnl.seg.seenOn',{sw:(swNode && (swNode.name||swNode.id)) || sw})}${ifName ? ' · ' + ifName : ''}`,
                vlan: (swVlan[mac] != null) ? swVlan[mac] : null,    // VLAN-first (se FDB VLAN-aware)
                portMacCount: macsPerIf[ifName] || 0,               // uplink affollato
                consumer: (typeof win.isRandomizedMac === 'function') && win.isRandomizedMac(mac), // telefono/BYOD
            });
        }
    }
    // rejectedAutoLinks → MAC delle porte coinvolte (un device gia' rifiutato non riappare)
    const rejectedSigs = [];
    for(const psig of (state.rejectedAutoLinks || [])){
        for(const pid of String(psig).split('||')){ const m = state.ports[pid] && state.ports[pid].mac; if(m) rejectedSigs.push(_driftNorm(m)); }
    }
    const portDownStreak = {};
    for(const pid of Object.keys(docSnap.ports)) portDownStreak[pid] = (state.ports[pid] && state.ports[pid].downStreak) || 0;
    // ── Lease DHCP come FONTE (cross-VLAN) ───────────────────────────────
    // Danno MAC→IP autorevole su TUTTE le VLAN — il pezzo che l'ARP locale non
    // vede dietro un firewall L3. Entrano negli stessi canali del motore:
    // presenza per-MAC, cambio IP, non documentati. L'ARP vivo locale resta
    // prioritario (più fresco); il lease riempie il resto. Transitorio
    // (store._dhcpLeases, non persistito): lo carica l'overlay "Lease DHCP".
    const _leases = Array.isArray(store._dhcpLeases) ? store._dhcpLeases : [];
    let _leaseChecked = false;
    // G2: un lease scaduto/rilasciato non prova né presenza né IP corrente (una
    // tabella incollata può contenerne). Predicato condiviso (lib/dhcp-lease.js,
    // riusato anche dall'occupazione IPAM) → un'unica fonte di verità.
    const _leaseStale = l => isLeaseStale(l);
    for(const l of _leases){
        const macLc = String((l && l.mac) || '').toLowerCase();
        const ip = String((l && l.ip) || '').trim();
        if(!macLc || !ip || _leaseStale(l)) continue;     // G2: ignora lease non più validi
        if(!macAtIp[macLc]) macAtIp[macLc] = ip;          // ARP vivo ha priorità
        observedMacs.push(l.mac);                          // il MAC col lease è "visto" (presenza per-MAC)
        // G1: un lease prova la presenza del SUO MAC e dà l'IP corrente (→ cambio IP
        // cross-VLAN), ma NON è una sweep di raggiungibilità: NON marca la subnet come
        // "osservata" per l'audit di assenza. Così un device documentato SENZA lease
        // resta "non verificabile", non "assente" (observedSubnets si popola solo da
        // ARP/ping reali). Assenza-da-lease ≠ device assente.
        const sig = _driftNorm(l.mac);
        if(sig && !known.has(sig) && !seen.has(sig)){
            seen.add(sig);
            observedDevices.push({ sig, mac: l.mac, label: `${t('dhcp.seenLease',{ip})}${l.hostname ? ' · ' + l.hostname : ''}`, vlan: (l && l.vlan != null) ? l.vlan : null, portMacCount: 0, consumer: false });
        }
        _leaseChecked = true;
    }

    return { responded, ports, observedMacs, observedDevices, rejectedSigs, portDownStreak, fdbObserved, presentNodeIds, reachabilityChecked: reachabilityChecked || _leaseChecked, macAtIp, observedSubnets: [...observedSubnets] };
}

// ── Calcolo Drift dallo stato CORRENTE (SENZA ri-pollare) ────────────
// Usa il docSnap catturato PRIMA del refresh (i campi base sono già stati
// sovrascritti dal poll). Riusato da: runDriftCheck (dopo pollAllSNMP) e dal
// chip "cosa è cambiato" del Sync (che ha già fatto il poll, FDB incluso).
// Scrive store._driftReport e lo ritorna. NON apre l'overlay.
export function _driftComputeFromDoc(docSnap, opts){
    const state = store.state;
    _driftUpdateStreaks(docSnap);
    const snmpSnap = _driftBuildSnmpSnapshot(docSnap, opts && opts.reachable, opts && opts.arpTable);
    if(!Array.isArray(state.driftIgnores)) state.driftIgnores = [];
    store._driftReport = win.buildDriftReport(snmpSnap, docSnap, state.driftIgnores, {
        downStreakN: DRIFT_DOWN_STREAK_N,
        guestVlans: state.guestVlans || [],   // VLAN marcate guest sulla barra VLAN
        mgmtVlans: state.mgmtVlans || [],     // VLAN di management: non-doc lì = infra + segnale sicurezza
        endpointPortThreshold: 5,             // ≥5 MAC su una porta = uplink AP/hub/guest
    });
    return store._driftReport;
}

// ── Sweep di raggiungibilità (audit presenza multi-segnale) ──────────
// Interroga il server (ping ICMP / ARP / TCP) sugli IP documentati: stabilisce
// la PRESENZA dei device che NON parlano SNMP. Ritorna { ip: { alive, via } } o
// null se non c'è nulla da verificare / errore. Usata SOLO da "Verifica
// documentazione" (non dal Sync veloce, per non rallentarlo).
async function _driftReachabilitySweep(){
    const state = store.state;
    const ips = [...new Set((state.nodes || [])
        .map(n => ((n.integration || {}).host || n.ip || '').trim())
        .filter(ip => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)))];
    if(!ips.length) return null;
    try{
        const r = await fetch('/api/reachability', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ ips }),
        });
        const d = await r.json();
        return (d && d.ok) ? { reachable: d.results || {}, arpTable: d.arpTable || {} } : null;
    }catch(_){ return null; }
}

// ── Entry point: bottone "Verifica documentazione" ───────────────────
async function runDriftCheck(){
    const state = store.state;
    if(_driftRunning || win._snmpSyncing) return;
    const hasSnmp = state.nodes.some(n => String((n.integration||{}).driver||'').startsWith('snmp') && String((n.integration||{}).host||n.ip||'').trim());
    // I lease DHCP sono una fonte valida anche senza SNMP (rete dietro firewall):
    // se ce ne sono, la Verifica gira lo stesso (il poll SNMP viene saltato).
    const hasLeases = Array.isArray(store._dhcpLeases) && store._dhcpLeases.length > 0;
    if(!hasSnmp && !hasLeases){ showAlert(t('msg.net.noSnmpDevicesDoc')); return; }
    _driftRunning = true;
    const btn = document.getElementById('btn-drift');
    if(btn){ btn.disabled = true; btn.dataset._lbl = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    try {
        const docSnap = _driftBuildDocSnapshot();      // PRIMA del sync (i campi base verranno sovrascritti)
        if(hasSnmp) await win.pollAllSNMP();             // riuso, immutato; saltato se solo-lease
        const sweep = await _driftReachabilitySweep();  // presenza multi-segnale (ping/ARP/TCP) + tabella ARP
        _driftComputeFromDoc(docSnap, sweep || {});     // streaks + snapshot realtà + buildDriftReport
        const _renewed = _driftAutoRenewIps();          // opt-in: rinnova IP dei MAC noti (DHCP)
        markDirty();
        if(_renewed) renderAll();                        // riflette i nuovi IP su floor/rack
        _renderDriftReport();
    } catch(e){
        showAlert(t('msg.net.docCheckFailed') + (e && e.message || e));
    } finally {
        _driftRunning = false;
        if(btn){ btn.disabled = false; if(btn.dataset._lbl){ btn.innerHTML = btn.dataset._lbl; delete btn.dataset._lbl; } }
    }
}

// ── Azioni 1-click ───────────────────────────────────────────────────
function _driftAllRows(){
    const rep = store._driftReport;
    if(!rep) return [];
    return [].concat(rep.stateDrift, rep.macOrphan, rep.undocumented, rep.ghostCable, rep.ipChanged || [], rep.unverified || []);
}
function _driftFindRow(key){ return _driftAllRows().find(r => r.key === key) || null; }
function _driftDropRow(key){
    const rep = store._driftReport;
    if(!rep) return;
    for(const cat of ['stateDrift','macOrphan','undocumented','ghostCable','ipChanged','unverified']){
        if(!Array.isArray(rep[cat])) continue;
        rep[cat] = rep[cat].filter(r => r.key !== key);
        if(cat === 'undocumented'){
            // counts.undocumented resta "solo infra"; gli endpoint hanno il loro conteggio.
            rep.counts.undocumented = rep.undocumented.filter(r => r.cls !== 'endpoint').length;
            rep.counts.undocumentedEndpoint = rep.undocumented.filter(r => r.cls === 'endpoint').length;
        } else {
            rep.counts[cat] = rep[cat].length;
        }
    }
}
function driftIgnore(key){
    const state = store.state;
    if(!key) return;
    if(!Array.isArray(state.driftIgnores)) state.driftIgnores = [];
    if(!state.driftIgnores.includes(key)){ state.driftIgnores.push(key); markDirty(); }
    _driftDropRow(key);
    _renderDriftReport();
}
function driftApplyDoc(key){
    const state = store.state;
    const row = (store._driftReport && store._driftReport.stateDrift || []).find(r => r.key === key);
    if(!row || !row.patch) return;
    const { pid, status, speed, duplex, vlan } = row.patch;
    pushHistory();
    if(!state.ports[pid]) state.ports[pid] = {};
    // allinea la DOC alla realta': scrivo i valori reali come nuovi valori base
    // e rimuovo gli override divergenti (cosi' al re-check doc == realta').
    if(status != null) state.ports[pid].status = status;
    if(speed  != null) state.ports[pid].speed  = speed;
    if(duplex != null) state.ports[pid].duplex = duplex;
    if(vlan   != null) state.ports[pid].vlan   = vlan;
    delete state.ports[pid].statusOvr;
    delete state.ports[pid].speedOvr;
    delete state.ports[pid].vlanOvr;
    if(typeof win.logAudit === 'function') win.logAudit('drift-apply', { target: row.label, summary: (row.diffs || []).map(d => `${d.field}→${d.real}`).join(', ') });
    markDirty(); renderAll();
    _driftDropRow(key);
    _renderDriftReport();
}
// Applica il cambio IP rilevato (stesso MAC, IP diverso in rete): aggiorna l'IP
// principale del nodo (e l'host SNMP se era l'IP vecchio), registra in audit.
function driftApplyIpChange(key){
    const row = (store._driftReport && store._driftReport.ipChanged || []).find(r => r.key === key);
    if(!row || !row.newIp) return;
    const n = row.nodeId ? nodeById(row.nodeId) : null;
    if(!n){ showAlert(t('msg.net.nodeNotFoundIp')); return; }
    // G3 manual-first: un IP fissato a mano non si sovrascrive in silenzio →
    // conferma esplicita prima di sbloccare il pin manuale.
    if(n.ipManual && !window.confirm(t('drift.ipManualConfirm',{ip:row.newIp}))) return;
    pushHistory();
    const oldIp = row.oldIp || '';
    n.ip = row.newIp;
    n.ipManual = false;                       // ora deriva dalla rete (verificata)
    if(!n.integration) n.integration = {};
    const ih = String(n.integration.host || '').trim();
    if(!ih || ih === oldIp) n.integration.host = row.newIp;
    if(typeof win.logAudit === 'function') win.logAudit('drift-ipchange', { target: row.label || n.name || n.id, summary: `${oldIp || '?'} → ${row.newIp}` });
    markDirty(); renderAll();
    _driftDropRow(key);
    _renderDriftReport();
}
// ── Auto-rinnovo IP (DHCP) per MAC noto — opt-in, default OFF ─────────
// Quando `state.autoIpRenew` è attivo, i cambi IP rilevati da "Verifica
// documentazione" (MAC documentato visto VIVO a un IP diverso) sui nodi con
// IP NON fissato a mano (`ipManual` falsy) vengono applicati da soli: l'identità
// è il MAC, l'IP è un attributo effimero del DHCP. Gli IP pinnati a mano restano
// in tabella per revisione umana → manual-first preservato dove conta davvero.
// Ritorna quanti ne ha rinnovati. Agisce SOLO da runDriftCheck (il Sync non ha
// la mappa MAC→IP-vivo, quindi `ipChanged` lì è vuoto).
function _driftAutoRenewIps(){
    if(!store.state.autoIpRenew) return 0;
    const rep = store._driftReport;
    const rows = (rep && rep.ipChanged) || [];
    if(!rows.length) return 0;
    let applied = 0;
    for(const row of rows.slice()){
        if(!row.newIp || !row.nodeId) continue;
        const n = nodeById(row.nodeId);
        if(!n || n.ipManual) continue;            // IP statico/manuale: non si tocca
        if(applied === 0) pushHistory();          // un solo punto di undo per il lotto
        const oldIp = row.oldIp || '';
        n.ip = row.newIp;
        n.ipManual = false;                       // deriva dalla rete (verificata)
        if(!n.integration) n.integration = {};
        const ih = String(n.integration.host || '').trim();
        if(!ih || ih === oldIp) n.integration.host = row.newIp;
        logAudit('drift-ipchange-auto', { target: row.label || n.name || n.id, summary: `${oldIp || '?'} → ${row.newIp}` });
        _driftDropRow(row.key);
        applied++;
    }
    return applied;
}
// Toggle per-progetto del rinnovo automatico IP (UI in proprietà floor).
function setAutoIpRenew(on){
    store.state.autoIpRenew = !!on;
    markDirty();
    renderAutomationMenu();
}
// Toggle per-progetto: mostra i dispositivi utente/BYOD in chiaro invece di
// collassarli nel gruppo grigio (controllo manuale puro). Default OFF = storico.
function setDriftShowEndpoints(on){
    store.state.driftShowEndpoints = !!on;
    markDirty();
    _renderDriftReport();
}
function driftInvestigate(key){
    const state = store.state;
    const row = _driftFindRow(key);
    if(!row) return;
    _closeDriftReport();
    if(row.pid){
        const n = getNodeByPortId(row.pid);
        if(n){ if(typeof win.ensureNodeRackVisible==='function') win.ensureNodeRackVisible(n); store.selType='port'; store.selId=row.pid; if(typeof win.trace==='function') win.trace(row.pid); renderAll(); if(typeof win.focusNode==='function') win.focusNode(n); }
    } else if(row.id){
        const l = state.links.find(x => x.id === row.id);
        if(l){ const n = getNodeByPortId(l.src) || getNodeByPortId(l.dst); if(typeof store.highPath!=='undefined' && store.highPath.add) store.highPath.add(row.id); store.selType=null; store.selId=null; if(n && typeof win.ensureNodeRackVisible==='function') win.ensureNodeRackVisible(n); renderAll(); if(n && typeof win.focusNode==='function') win.focusNode(n); }
    } else if(row.sig || row.mac){
        const sig = row.sig || _driftNorm(row.mac);
        const n = state.nodes.find(x => x.mac && _driftNorm(x.mac) === sig);
        if(n && typeof win.selectAndFocusNode==='function') win.selectAndFocusNode(n);
        else showAlert(t('msg.net.macSeenUnassociated',{mac:row.mac || sig}));
    }
}

// ── Rendering del pannello (overlay) ─────────────────────────────────
// tk = chiave i18n risolta a render-time (t(c.tk)), così il cambio lingua si
// riflette riaprendo l'overlay.
const _DRIFT_CATS = [
    { k:'consistent',   tk:'drift.catConsistent',   i:'fa-circle-check',         c:'#39d353', collapsed:true },
    { k:'stateDrift',   tk:'drift.catStateDrift',   i:'fa-triangle-exclamation', c:'#d29922' },
    { k:'ipChanged',    tk:'drift.catIpChanged',    i:'fa-right-left',           c:'#39c5ff' },
    { k:'macOrphan',    tk:'drift.catMacOrphan',    i:'fa-ghost',                c:'#8b949e' },
    { k:'unverified',   tk:'drift.catUnverified',   i:'fa-plug-circle-xmark',    c:'#6e7681' },
    { k:'undocumented', tk:'drift.catUndocumented', i:'fa-circle-question',      c:'#58a6ff' },
    { k:'ghostCable',   tk:'drift.catGhost',        i:'fa-link-slash',           c:'#f85149' },
];
function _driftEnsureOverlay(){
    let ov = document.getElementById('drift-overlay');
    if(!ov){
        ov = document.createElement('div');
        ov.id = 'drift-overlay';
        ov.className = 'drift-overlay';
        const _ttl = t('report.drift');
        const _cls = t('common.close');
        ov.innerHTML = `<div class="drift-modal"><div class="drift-head"><span><i class="fas fa-clipboard-check"></i> <span id="drift-title">${_ttl}</span></span><button class="toolbar-btn" onclick="_closeDriftReport()" data-tip="${_cls}"><i class="fas fa-times"></i></button></div><div class="drift-body" id="drift-body"></div></div>`;
        document.body.appendChild(ov);
        ov.addEventListener('mousedown', e => { if(e.target === ov) _closeDriftReport(); });
    }
    return ov;
}
function _closeDriftReport(){ const ov = document.getElementById('drift-overlay'); if(ov) ov.style.display = 'none'; }
function _driftRowHtml(cat, r){
    const esc = s => escapeHTML(String(s == null ? '' : s));
    let main = '', actions = '';
    const invBtn = `<button class="drift-act" onclick="driftInvestigate('${esc(r.key)}')" data-tip="${t('drift.tipOpen')}"><i class="fas fa-magnifying-glass"></i></button>`;
    const ignBtn = `<button class="drift-act" onclick="driftIgnore('${esc(r.key)}')" data-tip="${t('drift.tipIgnore')}"><i class="fas fa-eye-slash"></i></button>`;
    if(cat === 'stateDrift'){
        const diffs = (r.diffs || []).map(d => `${esc(d.field)}: <s>${esc(d.doc)}</s> → <b>${esc(d.real)}</b>`).join(' · ');
        main = `<span class="drift-row-main">${esc(r.label)}</span><span class="drift-row-sub">${diffs}</span>`;
        actions = `<button class="drift-act apply" onclick="driftApplyDoc('${esc(r.key)}')" data-tip="${t('drift.tipApply')}"><i class="fas fa-arrows-rotate"></i></button>${ignBtn}${invBtn}`;
    } else if(cat === 'macOrphan'){
        main = `<span class="drift-row-main">${esc(r.label || r.mac)}</span><span class="drift-row-sub">${esc(r.mac)} — ${t('drift.notSeen')}</span>`;
        actions = `${ignBtn}${invBtn}`;
    } else if(cat === 'undocumented' || cat === 'undocumentedEndpoint'){
        const vlanStr = r.vlan != null ? ` · VLAN ${esc(r.vlan)}` : '';
        // Trasparenza: un tag per ogni segnale BYOD scattato → "perché è nascosto".
        // Etichetta in linguaggio comune (capibile dai non-tecnici); il dettaglio
        // tecnico preciso sta nel tooltip nativo (title=). Infra → reasons vuoto.
        const whyMap = {
            guestVlan:   [t('drift.whyGuestVlan'),   t('drift.whyGuestVlanTip')],
            crowdedPort: [t('drift.whyCrowdedPort'), t('drift.whyCrowdedPortTip', { n: r.portMacCount })],
            randomMac:   [t('drift.whyRandomMac'),   t('drift.whyRandomMacTip')],
        };
        const why = (Array.isArray(r.reasons) ? r.reasons : []).map(rs => whyMap[rs] || [rs, '']);
        const whyStr = why.length
            ? `<span class="drift-why">${why.map(([l, tip]) => `<span class="drift-why-tag" title="${esc(tip)}">${esc(l)}</span>`).join('')}</span>`
            : '';
        // Segnale sicurezza: device sconosciuto su VLAN di management (anti-guest).
        const mgmtStr = r.onMgmt
            ? `<span class="drift-why"><span class="drift-why-tag drift-mgmt" title="${esc(t('drift.onMgmtVlanTip'))}"><i class="fas fa-shield-halved"></i> ${esc(t('drift.onMgmtVlan'))}</span></span>`
            : '';
        main = `<span class="drift-row-main">${esc(r.mac)}</span><span class="drift-row-sub">${esc(r.label)}${vlanStr}</span>${whyStr}${mgmtStr}`;
        const addBtn = `<button class="drift-act add" onclick="openAdoptModal('${esc(r.key)}')" data-tip="${t('drift.tipAddMap')}"><i class="fas fa-plus"></i></button>`;
        actions = `${addBtn}${ignBtn}${invBtn}`;
    } else if(cat === 'ghostCable'){
        main = `<span class="drift-row-main">${esc(r.label)}</span><span class="drift-row-sub">${t('drift.portDown',{n:esc(r.downStreak)})}</span>`;
        actions = `${ignBtn}${invBtn}`;
    } else if(cat === 'ipChanged'){
        // G3: segnala se l'IP era fissato a mano → applicarlo sblocca il pin.
        const manualTag = r.manual ? `<span class="drift-why"><span class="drift-why-tag" title="${t('drift.ipManualTip')}">${t('drift.ipManualBadge')}</span></span>` : '';
        main = `<span class="drift-row-main">${esc(r.label || r.mac)}</span><span class="drift-row-sub">${esc(r.mac)} · <s>${esc(r.oldIp)}</s> → <b>${esc(r.newIp)}</b></span>${manualTag}`;
        const upBtn = `<button class="drift-act apply" onclick="driftApplyIpChange('${esc(r.key)}')" data-tip="${t('drift.tipUpdateIp')}"><i class="fas fa-arrows-rotate"></i></button>`;
        actions = `${upBtn}${ignBtn}${invBtn}`;
    } else if(cat === 'unverified'){
        const ipStr = r.ip ? ` · ${esc(r.ip)}` : '';
        main = `<span class="drift-row-main">${esc(r.label || r.mac)}</span><span class="drift-row-sub">${esc(r.mac)}${ipStr} — ${t('drift.unverifiedSub')}</span>`;
        actions = `${ignBtn}${invBtn}`;
    } else { // consistent
        main = `<span class="drift-row-main">${esc(r.label)}</span>`;
    }
    return `<div class="drift-row">${main}<span class="drift-row-acts">${actions}</span></div>`;
}
function _renderDriftReport(){
    const rep = store._driftReport;
    const ov = _driftEnsureOverlay();
    ov.style.display = 'flex';
    const body = document.getElementById('drift-body');
    if(!rep){ body.innerHTML = `<div class="drift-empty">${t('common.noData')}</div>`; return; }
    // Header overlay reattivo al cambio lingua (l'overlay è creato una volta).
    const _ttl = document.getElementById('drift-title'); if(_ttl) _ttl.textContent = t('report.drift');
    const total = _DRIFT_CATS.reduce((a, c) => a + ((c.k === 'consistent' || c.k === 'unverified') ? 0 : rep.counts[c.k]), 0);
    const header = total === 0
        ? `<div class="drift-allok"><i class="fas fa-circle-check"></i> ${t('drift.allOk')}</div>`
        : `<div class="drift-summary">${t('drift.toVerify',{n:total})}</div>`;
    const sections = _DRIFT_CATS.map(c => {
        const allRows = rep[c.k] || [];
        const n = rep.counts[c.k];
        let rows = allRows, extra = '', topBar = '', openWhen = (c.k !== 'consistent' && c.k !== 'unverified' && n > 0);
        if(c.k === 'undocumented'){
            // I candidati infrastruttura in chiaro; il rumore endpoint/guest
            // (telefoni/BYOD su VLAN guest, dietro uplink affollati, MAC random)
            // collassato in un gruppo grigio espandibile — a meno che l'utente
            // non scelga di mostrarli in chiaro (toggle driftShowEndpoints).
            const epRows = allRows.filter(r => r.cls === 'endpoint');
            const epN = epRows.length;
            const showEp = !!(store.state && store.state.driftShowEndpoints);
            if(showEp){
                rows = allRows;   // tutto in chiaro (ogni endpoint mostra comunque il "perché")
            } else {
                rows = allRows.filter(r => r.cls !== 'endpoint');
                if(epN){
                    const epBody = epRows.map(r => _driftRowHtml('undocumentedEndpoint', r)).join('');
                    extra = `<details class="drift-endpoint-group">
                        <summary class="drift-endpoint-head"><i class="fas fa-user-group"></i> ${t('drift.hiddenUsers',{n:epN})}<span class="drift-endpoint-hint"></span></summary>
                        <div class="drift-endpoint-body">${epBody}</div></details>`;
                }
            }
            openWhen = (rows.length + (showEp ? 0 : epN)) > 0;   // apri anche se ci sono solo endpoint
            if(allRows.length){
                // Toggle trasparenza (mostra utente/BYOD in chiaro) + scorciatoia
                // "Chiudi il cerchio": dal gap all'azione (schermata Adotta).
                const epToggle = epN
                    ? `<label class="drift-ep-toggle" data-tip="${t('drift.showEndpointsTip')}"><input type="checkbox" onchange="setDriftShowEndpoints(this.checked)"${showEp ? ' checked' : ''}> ${t('drift.showEndpoints')}</label>`
                    : '';
                topBar = `<div class="drift-adopt-bar">${epToggle}<button class="toolbar-btn" onclick="openAdoptModal()" data-tip="${t('drift.addMapTip')}"><i class="fas fa-plus-circle"></i> ${t('drift.addMap')}</button></div>`;
            }
        }
        const open = openWhen ? ' open' : '';
        const rowsHtml = rows.length ? rows.map(r => _driftRowHtml(c.k, r)).join('') : '';
        const secBody = (rowsHtml || extra) ? (topBar + rowsHtml + extra) : '<div class="drift-empty">—</div>';
        return `<details class="props-collapsible drift-sec"${open}>
            <summary class="props-collapsible-head"><span><i class="fas ${c.i}" style="color:${c.c}"></i> ${t(c.tk)}</span><span class="drift-count" style="background:${c.c}22;color:${c.c}">${n}</span></summary>
            <div class="props-collapsible-body drift-sec-body">${secBody}</div></details>`;
    }).join('');
    body.innerHTML = header + sections;
}

// Superficie pubblica:
//   • handler inline HTML: runDriftCheck (btn-drift), _closeDriftReport,
//     driftInvestigate, driftIgnore, driftApplyDoc (onclick="" generati);
//   • lette da src/app-drift-adopt.js via win.*: _driftBuildDocSnapshot,
//     _driftBuildSnmpSnapshot, _renderDriftReport, DRIFT_DOWN_STREAK_N;
//   • esercitate dall'E2E (copertura spostata dallo smoke).
// Lo stato `_driftReport` NON è qui: vive direttamente su window (store._driftReport).
expose({
    runDriftCheck, driftIgnore, driftApplyDoc, driftApplyIpChange, driftInvestigate,
    setAutoIpRenew, setDriftShowEndpoints, _driftAutoRenewIps,
    _closeDriftReport, _renderDriftReport,
    _driftBuildDocSnapshot, _driftBuildSnmpSnapshot, _driftComputeFromDoc,
    DRIFT_DOWN_STREAK_N,
});
