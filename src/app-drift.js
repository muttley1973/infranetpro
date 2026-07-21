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
import { TYPES, _frontPanelPortLabel } from './app-types.js';   // catalogo tipi: distingue gli elementi passivi dall'audit di presenza
import { escapeHTML, normalizeMacAddress } from './app-util.js';
import { nodeById, markDirty, getNodeByPortId, getNodeDisplayName, pushHistory, logAudit, _cableAutoLabel } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { showAlert } from './app-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderAutomationMenu } from './app-vlan-autopoll.js';   // setAutoIpRenew aggiorna il popover Automazioni
import { ensureNodeRackVisible, focusNode, selectAndFocusNode } from './app-search-zoom-rack.js';   // ritiro ponte: funzioni rack/zoom/search (ex win.*)
import { trace } from './app-pointer.js';   // ritiro ponte: funzioni topo/discovery/vlan/snmp (ex win.*)
import { registerClickActions, registerChangeActions } from './app-delegation.js';   // ASSE B: pannello Drift (template dinamico) via event delegation
import { aiExplainDrift } from './app-ai.js';   // ASSE B: bottone «Spiega» del Drift (delegato qui, definito in app-ai)

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
    const pn = (n && typeof _frontPanelPortLabel === 'function') ? _frontPanelPortLabel(n, num, n.ports || 0) : num;
    const nm = n ? (getNodeDisplayName(n) || n.name || n.id) : pid;
    return `${nm} / P${pn}`;
}

// ── 1) Snapshot DOC (PRIMA del sync) ─────────────────────────────────
export function _driftBuildDocSnapshot(){
    const state = store.state;
    // Trasformazione PURA in lib/drift-snapshot.js (buildDocSnapshot); qui solo
    // raccolta-dati da stato + iniezione degli helper UI (etichette) e del catalogo.
    return buildDocSnapshot({
        nodes: state.nodes, links: state.links, ports: state.ports,
        portLabel: _driftPortLabel,
        nodeLabel: n => getNodeDisplayName(n) || n.name || n.id,
        cableLabel: l => l.label || _cableAutoLabel(l),
        normMac: _driftNorm,
        // Passivo SENZA IP proprio (presa a muro / patch panel / passacavi / quadro):
        // il MAC eventualmente stampato su di loro è del device a VALLE → fuori
        // dall'audit di presenza (altrimenti finirebbe sempre tra gli "assenti").
        // I passivi CON IP (PDU/ATS/media-converter) restano verificabili.
        isPassiveNoIp: n => { const def = TYPES[n.type]; return !!(def && def.isPassive && !def.hasIP); },
    });
}

// ── 4) Aggiorna lo streak "porta down" per le porte documentate ──────
function _driftUpdateStreaks(docSnap){
    const state = store.state;
    for(const pid of Object.keys(docSnap.ports)){
        const nodeId = String(pid).slice(0, String(pid).lastIndexOf('-'));
        const n = nodeById(nodeId);   // importato da app.js (guardia win.* ridondante rimossa)
        if(!n || n.snmpStatus !== 'ok') continue;           // device muto → non valutabile, non toccare
        const pi = state.ports[pid]; if(!pi) continue;
        // Solo le porte SNMP-mappate (con ifName) hanno uno stato affidabile per-porta.
        // Una porta cablata A MANO senza ifName NON e' verificabile per-porta (stesso
        // principio dello skip manual-first in applyPollResult): il suo `status` puo'
        // essere stantio o mis-mappato da un vecchio sync posizionale → NON deve
        // alimentare il "cavo fantasma" (falsi allarmi). Streak azzerato e saltato.
        if(!pi.ifName){ if(pi.downStreak) pi.downStreak = 0; continue; }
        if(pi.status === 'active') pi.downStreak = 0;
        else pi.downStreak = (pi.downStreak || 0) + 1;
    }
}

// ── 2/3) Snapshot REALTA' (DOPO il sync) ─────────────────────────────
// Trasformazione PURA in lib/drift-snapshot.js (buildSnmpSnapshot): tutte le
// regole (presenza multi-segnale, macAtIp da ARP, subnet osservate, classifica
// non-documentati, merge lease G1/G2) vivono lì e sono testate a tavolino. Qui:
// solo raccolta-dati da stato/cache + iniezione di etichette i18n e predicati MAC.
export function _driftBuildSnmpSnapshot(docSnap, reachable, arpTable){
    const state = store.state;
    const fdb = (typeof store._topoFdbCache === 'object' && store._topoFdbCache) ? store._topoFdbCache : {};
    const vlanCache = (typeof store._topoFdbVlanCache === 'object' && store._topoFdbVlanCache) ? store._topoFdbVlanCache : {};
    // Fase 2 — ARP dei router/switch L3 raccolto al Sync (store._topoArpCache, per-device):
    // appiattito in MAC→IP (first-wins) come fonte di presenza VIVA cross-subnet. Prova
    // che gli host sulle VLAN dietro il router sono vivi (adiacenza L3) → verde senza
    // pingarli. Sync-derivato → disponibile ANCHE nel Sync (non solo alla Verifica).
    const arpCache = (typeof store._topoArpCache === 'object' && store._topoArpCache) ? store._topoArpCache : {};
    const snmpArp = {};
    for(const dev of Object.values(arpCache)){
        if(!dev) continue;
        for(const [mac, ip] of Object.entries(dev)){ if(!snmpArp[mac]) snmpArp[mac] = ip; }
    }
    // ND discovery — Neighbor Discovery IPv6 dei router/switch L3 raccolta al Sync
    // (store._topoNdCache, per-device): appiattita in MAC→IPv6 (first-wins). Gemella di
    // snmpArp ma consumata SOLO come presenza VIVA cross-subnet (verde per-MAC): coglie
    // gli host IPv6-only/ARP-invecchiato che l'ARP IPv4 non vede. Sync-derivato.
    const ndCache = (typeof store._topoNdCache === 'object' && store._topoNdCache) ? store._topoNdCache : {};
    const snmpNd = {};
    for(const dev of Object.values(ndCache)){
        if(!dev) continue;
        for(const [mac, ip] of Object.entries(dev)){ if(!snmpNd[mac]) snmpNd[mac] = ip; }
    }
    return buildSnmpSnapshot({
        nodes: state.nodes,
        docPorts: docSnap.ports,
        ports: state.ports,
        fdb, vlanCache,
        reachable, arpTable, snmpArp, snmpNd,
        // Lease DHCP: fonte MAC→IP cross-VLAN (transitorio, store._dhcpLeases).
        leases: Array.isArray(store._dhcpLeases) ? store._dhcpLeases : [],
        // Opt-in: un lease RILASCIATO annota la voce unverified "probabilmente scollegato" (mai rosso).
        leaseReleasedHint: !!store.state.leaseReleasedHint,
        knownSigs: docSnap.deviceSigs,
        rejectedAutoLinks: state.rejectedAutoLinks || [],
        normMac: _driftNorm,
        isVirtualMac: mac => (typeof win.isVirtualMac === 'function') && win.isVirtualMac(mac),
        isRandomizedMac: mac => (typeof win.isRandomizedMac === 'function') && win.isRandomizedMac(mac),
        isLeaseStale: isLeaseStale,   // G2: predicato condiviso (lib/dhcp-lease.js)
        countMacsPerPort: (typeof win.countMacsPerPort === 'function') ? win.countMacsPerPort : undefined,
        fdbSeenLabel: (sw, ifName) => { const swNode = nodeById(sw); return `${t('pnl.seg.seenOn',{sw:(swNode && (swNode.name||swNode.id)) || sw})}${ifName ? ' · ' + ifName : ''}`; },
        leaseSeenLabel: (ip, hostname) => `${t('dhcp.seenLease',{ip})}${hostname ? ' · ' + hostname : ''}`,
    });
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
    if(_driftRunning || store._snmpSyncing) return;
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
        _driftAutoRenewIps();                           // opt-in: rinnova IP dei MAC noti (DHCP)
        markDirty();
        // renderAll SEMPRE (rAF-coalescato): subbar/nextStep e ingrigimento assenti
        // devono riflettere l'esito appena calcolato, non solo i rinnovi IP.
        renderAll();
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
    if(typeof logAudit === 'function') logAudit('drift-apply', { target: row.label, summary: (row.diffs || []).map(d => `${d.field}→${d.real}`).join(', ') });
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
    if(typeof logAudit === 'function') logAudit('drift-ipchange', { target: row.label || n.name || n.id, summary: `${oldIp || '?'} → ${row.newIp}` });
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
        if(n){ if(typeof ensureNodeRackVisible==='function') ensureNodeRackVisible(n); store.selType='port'; store.selId=row.pid; if(typeof trace==='function') trace(row.pid); renderAll(); if(typeof focusNode==='function') focusNode(n); }
    } else if(row.id){
        const l = state.links.find(x => x.id === row.id);
        if(l){ const n = getNodeByPortId(l.src) || getNodeByPortId(l.dst); if(typeof store.highPath!=='undefined' && store.highPath.add) store.highPath.add(row.id); store.selType=null; store.selId=null; if(n && typeof ensureNodeRackVisible==='function') ensureNodeRackVisible(n); renderAll(); if(n && typeof focusNode==='function') focusNode(n); }
    } else if(row.sig || row.mac){
        const sig = row.sig || _driftNorm(row.mac);
        const n = state.nodes.find(x => x.mac && _driftNorm(x.mac) === sig);
        if(n && typeof selectAndFocusNode==='function') selectAndFocusNode(n);
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
        ov.innerHTML = `<div class="drift-modal"><div class="drift-head"><span><i class="fas fa-clipboard-check"></i> <span id="drift-title">${_ttl}</span></span><button class="toolbar-btn" data-act="drift-close" data-tip="${_cls}"><i class="fas fa-times"></i></button></div><div class="drift-body" id="drift-body"></div></div>`;
        document.body.appendChild(ov);
        ov.addEventListener('mousedown', e => { if(e.target === ov) _closeDriftReport(); });
    }
    return ov;
}
function _closeDriftReport(){ const ov = document.getElementById('drift-overlay'); if(ov) ov.style.display = 'none'; }
function _driftRowHtml(cat, r){
    const esc = s => escapeHTML(String(s == null ? '' : s));
    let main = '', actions = '';
    const invBtn = `<button class="drift-act" data-act="drift-investigate" data-key="${esc(r.key)}" data-tip="${t('drift.tipOpen')}"><i class="fas fa-magnifying-glass"></i></button>`;
    const ignBtn = `<button class="drift-act" data-act="drift-ignore" data-key="${esc(r.key)}" data-tip="${t('drift.tipIgnore')}"><i class="fas fa-eye-slash"></i></button>`;
    // L4: «Spiega» con l'Assistente AI (semina la domanda sul caso → loop Verifica→capisci→agisci).
    const explBtn = `<button class="drift-act" data-act="drift-explain" data-cat="${esc(cat)}" data-key="${esc(r.key)}" data-tip="${t('assistant.explain')}"><i class="fas fa-robot"></i></button>`;
    if(cat === 'stateDrift'){
        const diffs = (r.diffs || []).map(d => `${esc(d.field)}: <s>${esc(d.doc)}</s> → <b>${esc(d.real)}</b>`).join(' · ');
        main = `<span class="drift-row-main">${esc(r.label)}</span><span class="drift-row-sub">${diffs}</span>`;
        actions = `<button class="drift-act apply" data-act="drift-apply-doc" data-key="${esc(r.key)}" data-tip="${t('drift.tipApply')}"><i class="fas fa-arrows-rotate"></i></button>${ignBtn}${invBtn}`;
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
        const upBtn = `<button class="drift-act apply" data-act="drift-apply-ip" data-key="${esc(r.key)}" data-tip="${t('drift.tipUpdateIp')}"><i class="fas fa-arrows-rotate"></i></button>`;
        actions = `${upBtn}${ignBtn}${invBtn}`;
    } else if(cat === 'unverified'){
        const ipStr = r.ip ? ` · ${esc(r.ip)}` : '';
        // Sfumatura debole (opt-in): lease rilasciato → sotto-testo "probabilmente scollegato".
        const subTxt = r.reason === 'leaseReleased' ? t('drift.unverifiedReleased') : t('drift.unverifiedSub');
        main = `<span class="drift-row-main">${esc(r.label || r.mac)}</span><span class="drift-row-sub">${esc(r.mac)}${ipStr} — ${subTxt}</span>`;
        actions = `${ignBtn}${invBtn}`;
    } else { // consistent
        main = `<span class="drift-row-main">${esc(r.label)}</span>`;
    }
    // «Spiega» su tutte le righe azionabili (non sulle consistenti = nessuna azione).
    const acts = (cat === 'consistent') ? actions : actions + explBtn;
    return `<div class="drift-row">${main}<span class="drift-row-acts">${acts}</span></div>`;
}

// ── Sezione "Reti del progetto" (estratte da device + lease DHCP) ────────────
// Risponde al workflow multi-subnet: "se ci sono device di subnet diverse, estrai
// le network dai device presenti e dì cosa fare". Puramente INFORMATIVA + un'azione
// esplicita per rete ("Scopri rete", che apre il modale Scopri pre-compilato con la
// cadenza anti-IDS): manual-first, nessuno scan automatico. La classificazione
// (covered/blocked/open) vive nella lib pura lib/project-networks.js.
function _driftNetworksSection(rep){
    // deriveProjectNetworks + annotateNetworksVerification: lib UMD-lite
    // (lib/project-networks.js), lette come bare-global (esposte su window dallo
    // <script>), come gli altri motori puri — NON via win.* (cricchetto fermo).
    if(typeof deriveProjectNetworks !== 'function') return '';
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const leases = Array.isArray(store._dhcpLeases) ? store._dhcpLeases : [];
    const { networks } = deriveProjectNetworks({ nodes: store.state.nodes, leases });
    if(!networks.length) return '';
    // Accorpamento: il join annota ogni /24 con la PRESENZA (la sweep ha osservato la
    // subnet?) e vi ANNIDA i device "non verificabili" → la sezione "Reti del progetto"
    // assorbe il vecchio bucket "Non verificabili" (stesso fatto, una sola vista).
    const joined = (rep && typeof annotateNetworksVerification === 'function')
        ? annotateNetworksVerification(networks, { sweepRan: rep.sweepRan, observedSubnets: rep.observedSubnets, unverified: rep.unverified })
        : { networks: networks.map(n => Object.assign({}, n, { observed:null, unverifiedDevices:[], unverifiedCount:0 })), orphanUnverified: [] };
    const nets = joined.networks;
    const META = {
        covered: { c:'#3fb950', i:'fa-circle-check',       hint:()=>t('net.hintCovered') },
        // "blocked" copre DUE realtà: switch vivo ma SNMP non autenticato vs switch
        // proprio non raggiunto. `snmpReachable` è lo stato dell'ULTIMO Sync (stantio):
        // affermare "raggiungibile" è onesto solo se la sweep ha osservato la subnet
        // (n.observed === true); altrimenti la copy dice che non è stato raggiunto.
        blocked: { c:'#d29922', i:'fa-triangle-exclamation', hint:(n)=>{ const sw=n.snmpSources.find(s=>s.type==='switch'&&!s.reachable); const ip = sw?sw.ip:'?'; return n.observed === true ? t('net.hintBlocked',{ip}) : t('net.hintBlockedUnreached',{ip}); } },
        open:    { c:'#6e7681', i:'fa-circle-question',     hint:()=>t('net.hintOpen') },
    };
    // Badge PRESENZA: solo dopo una sweep (observed !== null). Verde = subnet osservata;
    // grigio = non raggiunta (i suoi device stanno nel drill-down qui sotto).
    const presenceHtml = n =>
        n.observed === true  ? `<span class="drift-net-presence ok"><i class="fas fa-circle-check"></i> ${t('net.presenceOk')}</span>` :
        n.observed === false ? `<span class="drift-net-presence blind"><i class="fas fa-plug-circle-xmark"></i> ${t('net.presenceBlind')}</span>` : '';
    // Drill-down: i device non verificabili RIUSANO la riga drift (azioni ignora/
    // investiga/spiega intatte), ora sotto la loro rete invece che in una sezione a sé.
    const unverHtml = n => n.unverifiedCount > 0
        ? `<details class="drift-net-unver"><summary class="drift-net-unver-head"><i class="fas fa-plug-circle-xmark"></i> ${t('net.unverifiedGroup',{n:n.unverifiedCount})}</summary><div class="drift-net-unver-body">${n.unverifiedDevices.map(r => _driftRowHtml('unverified', r)).join('')}</div></details>`
        : '';
    const rowsHtml = nets.map(n => {
        const m = META[n.status] || META.open;
        const meta = t('net.devices',{n:n.deviceCount}) + (n.leaseCount ? ' · ' + t('net.leases',{n:n.leaseCount}) : '');
        const scanBtn = `<button class="toolbar-btn drift-net-scan" data-act="drift-scan-net" data-cidr="${esc(n.cidr)}" data-tip="${t('net.scanTip')}"><i class="fas fa-satellite-dish"></i> ${t('net.scan')}</button>`;
        return `<div class="drift-net-item"><div class="drift-net-row">
            <span class="drift-net-cidr"><i class="fas ${m.i}" style="color:${m.c}"></i> ${esc(n.cidr)}</span>
            <span class="drift-net-meta">${esc(meta)}</span>
            <span class="drift-net-hint">${esc(m.hint(n))}</span>
            ${presenceHtml(n)}
            ${scanBtn}
        </div>${unverHtml(n)}</div>`;
    }).join('');
    // Coda anti-perdita: eventuali non-verificabili su /24 senza riga rete (raro).
    const orphan = joined.orphanUnverified || [];
    const orphanHtml = orphan.length
        ? `<div class="drift-net-orphan"><div class="drift-net-orphan-head"><i class="fas fa-plug-circle-xmark"></i> ${t('drift.catUnverified')}</div>${orphan.map(r => _driftRowHtml('unverified', r)).join('')}</div>`
        : '';
    // Aperta di default se c'è una rete che richiede azione (blocked/open o non verificati).
    const needsAction = nets.some(n => n.status !== 'covered' || n.unverifiedCount > 0) || orphan.length > 0;
    return `<details class="props-collapsible drift-sec"${needsAction ? ' open' : ''}>
        <summary class="props-collapsible-head"><span><i class="fas fa-sitemap"></i> ${t('net.sectionTitle')}</span><span class="drift-count">${nets.length}</span></summary>
        <div class="props-collapsible-body drift-sec-body">${rowsHtml}${orphanHtml}</div></details>`;
}

// Apre "Scopri" pre-compilato con la subnet scelta (chiude prima il report Verifica).
// _closeDriftReport è locale a questo modulo; openDiscovery è bare-global (esposta
// da src/app-discovery.js) — nessuna lettura via win.* (cricchetto invariato).
function _driftScanNetwork(cidr){
    _closeDriftReport();
    if(typeof openDiscovery === 'function') openDiscovery(cidr);
}

export function _renderDriftReport(){
    const rep = store._driftReport;
    const ov = _driftEnsureOverlay();
    ov.style.display = 'flex';
    const body = document.getElementById('drift-body');
    if(!rep){ body.innerHTML = `<div class="drift-empty">${t('common.noData')}</div>`; return; }
    // Header overlay reattivo al cambio lingua (l'overlay è creato una volta).
    const _ttl = document.getElementById('drift-title'); if(_ttl) _ttl.textContent = t('report.drift');
    const total = _DRIFT_CATS.reduce((a, c) => a + ((c.k === 'consistent' || c.k === 'unverified') ? 0 : rep.counts[c.k]), 0);
    // Banner a 3 vie: anomalie · "cieca" (niente verificato) · allineata. Niente
    // falso "tutto a posto" quando in realtà non si è potuto verificare nulla.
    const kind = (typeof driftBannerKind === 'function') ? driftBannerKind(rep.counts) : (total > 0 ? 'discrepancies' : 'aligned');
    const unver = rep.counts.unverified || 0;
    let header;
    if(kind === 'discrepancies'){
        header = `<div class="drift-summary">${t('drift.toVerify',{n:total})}</div>`;
    } else if(kind === 'blind'){
        header = `<div class="drift-blind"><i class="fas fa-plug-circle-xmark"></i> ${t('drift.allUnverified',{n:unver})}</div>`;
    } else {
        const note = unver > 0 ? ` <span class="drift-allok-note">${t('drift.someUnverified',{n:unver})}</span>` : '';
        header = `<div class="drift-allok"><i class="fas fa-circle-check"></i> ${t('drift.allOk')}${note}</div>`;
    }
    // "unverified" NON è più una sezione a sé: è accorpato in "Reti del progetto"
    // (annidato sotto la /24 non raggiunta). Il conteggio resta nel banner in alto.
    const sections = _DRIFT_CATS.filter(c => c.k !== 'unverified').map(c => {
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
                    ? `<label class="drift-ep-toggle" data-tip="${t('drift.showEndpointsTip')}"><input type="checkbox" data-change="drift-show-endpoints"${showEp ? ' checked' : ''}> ${t('drift.showEndpoints')}</label>`
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
    body.innerHTML = header + _driftNetworksSection(rep) + sections;
}

// Superficie pubblica:
//   • ASSE B: le 7 azioni 1-click del pannello Drift (close/investigate/ignore/
//     apply-doc/apply-ip/scan-net/show-endpoints) sono DELEGATE (data-act/data-change,
//     vedi registerClick/ChangeActions sopra) → non più su window. runDriftCheck
//     resta esposta (bottone Verifica statico);
//   • lette da src/app-drift-adopt.js via win.*: _driftBuildDocSnapshot,
//     _driftBuildSnmpSnapshot, _renderDriftReport, DRIFT_DOWN_STREAK_N;
//   • esercitate dall'E2E (copertura spostata dallo smoke).
// Lo stato `_driftReport` NON è qui: vive direttamente su window (store._driftReport).
expose({
    runDriftCheck,
    setAutoIpRenew, _driftAutoRenewIps,
    _renderDriftReport,
    _driftBuildDocSnapshot, _driftBuildSnmpSnapshot, _driftComputeFromDoc,
    DRIFT_DOWN_STREAK_N,
});

// ASSE B — superficie DINAMICA del pannello Drift (righe/bottoni resi da
// _renderDriftReport a runtime). onclick/onchange inline -> data-act/data-change:
// le 7 fn locali escono da expose(); gli argomenti (chiave riga, CIDR) viaggiano in
// data-key/data-cidr. Restano inline (cross-module, migrati coi loro cluster):
// aiExplainDrift (app-ai) e openAdoptModal (app-drift-adopt).
registerClickActions({
    'drift-close':       () => _closeDriftReport(),
    'drift-investigate': (el) => driftInvestigate(el.dataset.key),
    'drift-ignore':      (el) => driftIgnore(el.dataset.key),
    'drift-apply-doc':   (el) => driftApplyDoc(el.dataset.key),
    'drift-apply-ip':    (el) => driftApplyIpChange(el.dataset.key),
    'drift-scan-net':    (el) => _driftScanNetwork(el.dataset.cidr),
    'drift-explain':     (el) => aiExplainDrift(el.dataset.cat, el.dataset.key),   // «Spiega» con l'assistente AI
});
registerChangeActions({
    'drift-show-endpoints': (el) => setDriftShowEndpoints(el.checked),
});
