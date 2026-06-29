// ============================================================
// VLAN, AUTO-POLL e LINK MODE FRONTEND
// Palette colori VLAN, propagazione a grafo, auto-poll SNMP, gestione VLAN/IPAM,
// link color, mode access/trunk, VLAN voce/guest. Migrato a modulo ESM (src/) —
// globali legacy via win.*, t (i18n) dal ponte.
// I typeof-guard per funzioni di QUESTO modulo restano bare (module-local).
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, normalizeNumber } from './app-util.js';
import { nodeById, markDirty, getNodeByPortId, getPortNodeId, pushHistory, renderCables, _showToast } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderProps } from './app-properties.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)

// Handle dei timer auto-poll: prima `let` in app.js, usati SOLO qui -> module-local.
let _autoPollTimer = null;     // handle setInterval auto-poll
let _autoPollTickTimer = null; // handle setInterval badge countdown
let _autoPollNextAt = 0;       // timestamp prossimo ciclo (ms epoch)

const _VPAL=['#00d4ff','#a371f7','#39d353','#f1e05a','#f85149','#ff9500','#ff6eb4','#00c8a0','#4fc3f7','#56b6c2','#e06c75','#e5c07b'];

/** Aggiunge la VLAN alla palette colori se non già presente. */
function _ensureVlanColor(vid){
    if(vid>1&&!store.state.vlanColors[vid])
        store.state.vlanColors[vid]=_VPAL[(vid*7)%_VPAL.length];
}

// ============================================================
// AUTO-POLL SNMP
// ============================================================

function setAutoPoll(enabled, interval){
    if(!store.state.autoPoll) store.state.autoPoll={enabled:false,interval:5};
    if(enabled !== null) store.state.autoPoll.enabled = !!enabled;
    if(interval !== null && interval > 0) store.state.autoPoll.interval = interval;
    markDirty();
    if(store.state.autoPoll.enabled){ _startAutoPoll(); } else { _stopAutoPoll(); }
    renderAutomationMenu(); // aggiorna toggle + bottoni intervallo nel popover
}

// ── Popover "Automazioni rete" ───────────────────────────────────────
// Raccoglie i due interruttori di automazione (auto-poll SNMP + rinnovo IP
// DHCP), prima sepolti nei collassabili di Proprietà planimetria, in un unico
// menu in header accanto all'area di stato. Il badge auto-poll lo apre.
function toggleAutomationMenu(){
    const d=document.getElementById('automation-dropdown');
    if(!d) return;
    if(d.style.display==='none' || !d.style.display){ renderAutomationMenu(); d.style.display='block'; }
    else d.style.display='none';
}
/** Ricostruisce il contenuto del popover dallo stato corrente. */
export function renderAutomationMenu(){
    const d=document.getElementById('automation-dropdown');
    if(!d) return;
    const st=store.state;
    const ap=st.autoPoll||{enabled:false,interval:5};
    const ipr=!!st.autoIpRenew;
    const dl=Array.isArray(store._dhcpLeases)?store._dhcpLeases:[];   // lease DHCP transitori in memoria
    const ivl=ap.interval||5;
    d.innerHTML = `
      <div class="autom-sec">
        <div class="autom-row">
          <span class="autom-title"><i class="fas fa-clock"></i>${escapeHTML(t('autom.poll'))}</span>
          <label class="toggle-sw" data-tip="${escapeHTML(t('autopoll.tip'))}">
            <input type="checkbox" ${ap.enabled?'checked':''} onchange="setAutoPoll(this.checked,null)">
            <span class="toggle-track"></span>
          </label>
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px;${ap.enabled?'':'opacity:.4;pointer-events:none'}">
          ${[1,5,10,15,30].map(m=>`<button class="toolbar-btn${ivl===m?' primary':''}" style="padding:3px 9px;font-size:0.75rem" onclick="setAutoPoll(null,${m})">${m}m</button>`).join('')}
        </div>
        <div class="autom-desc">${escapeHTML(t('autom.pollDesc'))}</div>
      </div>
      <div class="autom-sec">
        <div class="autom-grouphd"><i class="fas fa-network-wired"></i>${escapeHTML(t('autom.dhcpGroup'))}</div>
        <div class="autom-row">
          <span class="autom-title"><i class="fas fa-arrows-rotate"></i>${escapeHTML(t('autom.ipRenew'))}</span>
          <label class="toggle-sw" data-tip="${escapeHTML(t('autom.ipRenewTip'))}">
            <input type="checkbox" ${ipr?'checked':''} onchange="setAutoIpRenew(this.checked)">
            <span class="toggle-track"></span>
          </label>
        </div>
        <div class="autom-desc">${escapeHTML(t('autom.ipRenewDesc'))}</div>
        <div class="autom-row" style="margin-top:11px">
          <span class="autom-title"><i class="fas fa-table-list"></i>${escapeHTML(t('dhcp.title'))}</span>
          <button class="toolbar-btn" style="padding:3px 9px;font-size:0.75rem" onclick="openDhcpImport()"><i class="fas fa-folder-open"></i> ${escapeHTML(t('dhcp.load'))}</button>
        </div>
        <div class="autom-desc">${escapeHTML(dl.length ? t('dhcp.inMemory',{n:dl.length}) : t('dhcp.loadDesc'))}</div>
      </div>`;
}

function _startAutoPoll(){
    _stopAutoPoll();
    const mins = store.state.autoPoll?.interval || 5;
    _autoPollNextAt = Date.now() + mins * 60000;
    _autoPollTimer = setInterval(async ()=>{
        _autoPollNextAt = Date.now() + mins * 60000;
        await win.pollAllSNMP({ dataOnly:true });   // SOLO dati SNMP, niente auto-link topologia
    }, mins * 60000);
    // aggiorna il conto alla rovescia sul badge ogni 30 secondi
    _autoPollTickTimer = setInterval(_updateAutoPollBadge, 30000);
    _updateAutoPollBadge();
}

function _stopAutoPoll(){
    if(_autoPollTimer){ clearInterval(_autoPollTimer); _autoPollTimer=null; }
    if(_autoPollTickTimer){ clearInterval(_autoPollTickTimer); _autoPollTickTimer=null; }
    _autoPollNextAt=0;
    _updateAutoPollBadge();
}

function _updateAutoPollBadge(){
    const badge=document.getElementById('autopoll-badge'); if(!badge) return;
    if(!store.state.autoPoll?.enabled || !_autoPollNextAt){ badge.style.display='none'; return; }
    const diffMs=Math.max(0, _autoPollNextAt-Date.now());
    const mins=Math.floor(diffMs/60000);
    const secs=Math.floor((diffMs%60000)/1000);
    const label = mins>0 ? `${mins}m` : `${secs}s`;
    badge.style.display='inline-flex';
    badge.innerHTML=`<i class="fas fa-clock"></i> Auto ${label}`;
    badge.setAttribute('data-tip', (typeof t==='function') ? t('autopoll.titleLive',{m:mins,s:secs})
                                        : `Auto-poll attivo · prossimo ciclo tra ${mins}m ${secs}s`);
}

/**
 * BFS sui link: propaga la VLAN dai port "autorevoli" (SNMP o override manuale)
 * verso tutti i port fisicamente collegati in catena.
 * Salva il risultato in pi.vlanProp (non sovrascrive vlanOvr né vlan SNMP).
 * Replica il comportamento reale: access-port switch → patch panel → wall port → AP.
 */
// Grafo di adiacenza porta→[porte connesse]. Oltre ai link, aggiunge il PONTE
// INTERNO dei passanti "a device" (media converter: fibra↔rame): le 2 porte
// IN/OUT sono trasparenti a L1 → VLAN nativa e trunk le attraversano. Usato sia
// dal motore (propagateVlans) sia dall'ancora-run (_runActiveAnchor) → identici.
function _buildPortAdjacency(){
    const adj={};
    const edge=(a,b)=>{ (adj[a]||(adj[a]=[])).push(b); };
    store.state.links.forEach(l=>{ edge(l.src,l.dst); edge(l.dst,l.src); });
    store.state.nodes.forEach(n=>{
        const d=TYPES[n.type]; if(!d || d.passThrough!=='device') return;
        const pc = n.ports!==undefined ? n.ports : d.ports;
        const first=`${n.id}-1`;
        for(let i=2;i<=pc;i++){ const p=`${n.id}-${i}`; edge(first,p); edge(p,first); }
    });
    return adj;
}

export function propagateVlans(){
    // 1. Grafo di adiacenza porta→[porte connesse] (+ ponte interno media conv.)
    const adj=_buildPortAdjacency();

    // 2. Azzera propagazioni precedenti (nativa + trunk-membership di run)
    Object.values(store.state.ports).forEach(p=>{ delete p.vlanProp; delete p.trunkProp; delete p.isTrunkProp; });

    const _active = pid => !!TYPES[getNodeByPortId(pid)?.type]?.isActive;

    // BFS riutilizzabile. Regola: un dispositivo ATTIVO (switch/router) è
    // AUTOREVOLE per la VLAN e blocca la sovrascrittura; una porta PASSIVA
    // (patch panel, presa a muro, AP) non ha VLAN propria → riceve SEMPRE la
    // VLAN propagata dallo switch a monte, anche se ha un override manuale.
    function bfs(queue){
        const visited=new Set(queue.map(s=>s.pid));
        let head=0;
        while(head<queue.length){
            const {pid,vlan}=queue[head++];
            (adj[pid]||[]).forEach(npid=>{
                if(visited.has(npid)) return;
                visited.add(npid);
                if(!store.state.ports[npid]) store.state.ports[npid]={};
                const npi=store.state.ports[npid];
                const nActive=_active(npid);
                // Autorevole solo se ATTIVO con override o vlan SNMP
                const nAuth = nActive && (npi.vlanOvr!=null || npi.vlan>1);
                if(!nAuth) npi.vlanProp=vlan;
                const nextVlan = (nActive&&npi.vlanOvr!=null) ? npi.vlanOvr
                               : (nActive&&npi.vlan>=1)       ? npi.vlan
                               :                                vlan;
                queue.push({pid:npid, vlan:nextVlan});
            });
        }
    }

    // 3a. Pass 1 — seed FORTI: porte di dispositivi ATTIVI (override > vlan SNMP).
    //     Lo switch comanda l'intera catena a valle: patch panel → presa → AP.
    const strong=[];
    store.state.nodes.forEach(n=>{
        const def=TYPES[n.type]; if(!def||!def.isActive) return;
        const pc=n.ports!==undefined?n.ports:def.ports;
        for(let i=1;i<=pc;i++){
            const pid=`${n.id}-${i}`;
            const pi=store.state.ports[pid]||{};
            const auth = pi.vlanOvr!=null ? pi.vlanOvr : (pi.vlan>=1 ? pi.vlan : null);
            if(auth!=null) strong.push({pid,vlan:auth});
        }
    });
    // Seed FORTI dalle ASSOCIAZIONI wireless, BSS-aware. Una radio AP trasmette
    // PIÙ SSID (è un trunk di BSS), quindi non si semina la radio: per ogni link
    // wireless si risolve il BSS scelto (`link.bss`) sul lato SERVENTE (la radio che
    // ha SSID) e si semina la sua VLAN sul lato CLIENT (la stazione). Il client
    // eredita così la VLAN del suo SSID, come un endpoint access via cavo.
    if(typeof win.ssidById==='function' && typeof win.parseRadioPid==='function' && typeof win.apSsidList==='function'){
        for(const l of (store.state.links||[])){
            if(!l || !l.wireless) continue;
            const ends=[l.src, l.dst];
            // Lato SERVENTE = il NODO che distribuisce SSID (win.apSsidList non vuota, su una
            // QUALSIASI sua radio), non solo la radio fisicamente linkata: un client
            // agganciato a una radio "nuda" dell'AP eredita comunque la VLAN dell'SSID.
            let sn=null, servingPid=null;
            for(const pid of ends){
                const rp=win.parseRadioPid(pid); if(!rp) continue;
                const n=nodeById(rp.nodeId); if(!n) continue;
                if(win.apSsidList(n).length){ sn=n; servingPid=pid; break; }
            }
            if(!sn) continue;
            const clientPid=(ends[0]===servingPid)?ends[1]:ends[0];
            // BSS scelto sul link; fallback al primo SSID del NODO servente (qualsiasi radio).
            let bss = (l.bss!=null) ? win.ssidById(sn, l.bss) : null;
            if(!bss){ const pool=win.apSsidList(sn); if(pool.length) bss=win.ssidById(sn, pool[0].id); }
            const v=bss?parseInt(bss.vlan,10):NaN;
            if(v>=1 && v<=4094){
                // Il client È l'endpoint dell'associazione: la VLAN del BSS si applica
                // direttamente a lui (bfs imposta solo i vicini, non il seme). Un client
                // ATTIVO con VLAN propria non viene sovrascritto. Poi entra nel BFS come
                // seme, così propaga a valle se fa da bridge.
                if(!(typeof _active==='function' && _active(clientPid))){
                    store.state.ports[clientPid]=store.state.ports[clientPid]||{};
                    store.state.ports[clientPid].vlanProp=v;
                }
                strong.push({ pid: clientPid, vlan: v });
            }
        }
    }
    bfs(strong);

    // 3b. Pass 2 — seed DEBOLI: override manuale su porte PASSIVE, valido SOLO
    //     per catene non già governate da un dispositivo attivo (vlanProp assente).
    const weak=[];
    for(const [pid,pi] of Object.entries(store.state.ports)){
        if(_active(pid)) continue;
        if(pi.vlanOvr!=null && pi.vlanProp==null) weak.push({pid,vlan:pi.vlanOvr});
    }
    bfs(weak);

    // 4. Trunk-membership di RUN: un trunk è una proprietà dell'INTERFACCIA
    //    attiva (switchport), non del singolo cavo. I passanti L1 (patch panel,
    //    presa a muro, media converter) trasportano la membership in modo
    //    trasparente → l'intera tratta switch→patch→presa→device riflette il
    //    trunk dell'interfaccia, esattamente come una rete reale.
    _propagateTrunkMembership(adj);

    // 5. Auto-registra tutte le VLAN risultanti nella palette colori
    Object.values(store.state.ports).forEach(p=>{
        const vid=p.vlanProp??p.vlanOvr??p.vlan;
        if(vid) _ensureVlanColor(vid);
        if(Array.isArray(p.trunkProp)) p.trunkProp.forEach(v=>{ if(v>1) _ensureVlanColor(v); });
    });
}

// Un PASSANTE L1 (conduit): patch panel, presa a muro, media converter. È
// passivo e attraversabile (passThrough) → non termina un trunk, lo trasporta.
// NB: il VoIP è passThrough ma NON passivo (tagga la voce e passa i dati al PC)
// → è un endpoint che ORIGINA membership, non un conduit trasparente.
function _isVlanConduit(pid){
    const d = TYPES[getNodeByPortId(pid)?.type];
    return !!(d && d.isPassive && d.passThrough);
}

// Trunk EFFETTIVO di un'interfaccia (manual-first): il `mode` manuale VINCE
// (access/trunk), altrimenti vale il trunk rilevato da SNMP (`isTrunk`). Unico
// punto di verità usato da UI (pannello porta), toggle e motore: così una porta
// vista trunk dallo SNMP appare e si comporta da trunk anche senza mode manuale.
function _portEffTrunk(pi){
    pi = pi || {};
    if(pi.mode==='trunk') return true;
    if(pi.mode==='access') return false;   // override manuale ad access vince sullo SNMP
    return !!pi.isTrunk;
}

// "Seme" di trunk di una porta ATTIVA: l'interfaccia è effettivamente in trunk
// (mode manuale o isTrunk da SNMP). Ritorna { vlans:[…] } anche con lista vuota
// (un trunk senza VLAN elencate resta un trunk: trasporta almeno la nativa).
function _portTrunkSeed(pid){
    const pi = store.state.ports[pid] || {};
    return _portEffTrunk(pi) ? { vlans: _parseTrunkVlans(pi.trunkVlans||[]) } : null;
}

// Propaga la trunk-membership lungo i SOLI passanti L1, seminata dalle
// interfacce attive in trunk e dalle VLAN trasportate dai device (SSID radio,
// voce VoIP). Scrive su ogni porta-passante: trunkProp (set VLAN) e, per i trunk
// veri d'interfaccia, isTrunkProp (flag che forza il trunk anche con sola nativa).
function _propagateTrunkMembership(adj){
    const seeds = []; // { pid, vlans:[…], flag:bool }
    // a) interfacce attive in trunk (manuale o SNMP) — flag = trunk forzato
    for(const pid of Object.keys(store.state.ports)){
        const s = _portTrunkSeed(pid);
        if(s) seeds.push({ pid, vlans:s.vlans, flag:true });
    }
    // b) VLAN trasportate dai device (radio/voce) sulle loro porte dati: la
    //    membership sale lungo il run verso lo switch (no flag: è trunk solo se
    //    l'unione supera la nativa, deciso da win.effLinkVlans a valle).
    store.state.nodes.forEach(n=>{
        const cv = (typeof win.carriedVlans==='function') ? win.carriedVlans(n) : [];
        if(!cv.length) return;
        const def = TYPES[n.type]; if(!def) return;
        const pc = n.ports!==undefined ? n.ports : def.ports;
        for(let i=1;i<=pc;i++) seeds.push({ pid:`${n.id}-${i}`, vlans:cv, flag:false });
    });
    if(!seeds.length) return;

    const _add = (pid, vlans, flag) => {
        if(!store.state.ports[pid]) store.state.ports[pid] = {};
        const cur = store.state.ports[pid].trunkProp || [];
        store.state.ports[pid].trunkProp = Array.from(new Set(cur.concat(vlans))).sort((a,b)=>a-b);
        if(flag) store.state.ports[pid].isTrunkProp = true;
    };
    // BFS dai vicini PASSANTI di ogni seme; si ferma al primo device non-passante
    // (attivo o foglia): quel segmento è trunk, ma oltre il device non si propaga.
    for(const seed of seeds){
        const visited = new Set([seed.pid]);
        const queue = [];
        (adj[seed.pid]||[]).forEach(npid=>{
            if(visited.has(npid) || !_isVlanConduit(npid)) return;
            visited.add(npid); _add(npid, seed.vlans, seed.flag); queue.push(npid);
        });
        let head=0;
        while(head<queue.length){
            const cur = queue[head++];
            (adj[cur]||[]).forEach(npid=>{
                if(visited.has(npid)) return;
                visited.add(npid);
                if(_isVlanConduit(npid)){ _add(npid, seed.vlans, seed.flag); queue.push(npid); }
            });
        }
    }
}

// Porta ATTIVA (switchport) a monte/valle del RUN che contiene questo link,
// attraversata la catena di passanti L1. È l'ancora del trunk: la modalità
// access/trunk vive lì (come una rete reale), non sul singolo cavo. null se il
// run non tocca alcuna interfaccia attiva (catena di soli passivi/foglie).
function _runActiveAnchor(link){
    if(!link) return null;
    const _isActive = pid => !!TYPES[getNodeByPortId(pid)?.type]?.isActive;
    if(_isActive(link.src)) return link.src;
    if(_isActive(link.dst)) return link.dst;
    const adj=_buildPortAdjacency();
    const visited = new Set([link.src, link.dst]);
    const queue = [link.src, link.dst].filter(_isVlanConduit);
    let head=0;
    while(head<queue.length){
        const cur = queue[head++];
        for(const npid of (adj[cur]||[])){
            if(visited.has(npid)) continue;
            visited.add(npid);
            if(_isActive(npid)) return npid;
            if(_isVlanConduit(npid)) queue.push(npid);
        }
    }
    return null;
}

/** VLAN effettiva di una porta per la VISUALIZZAZIONE (LED, popup, tabella).
 *  Porta ATTIVA (switch/router): override manuale > vlan SNMP > propagata.
 *  Porta PASSIVA (patch panel, presa, AP): la VLAN propagata dallo switch a
 *  monte ha priorità sull'override locale — un patch panel non ha VLAN propria. */
function _effPortVlan(pid){
    const pi=store.state.ports[pid]||{};
    const active=!!TYPES[getNodeByPortId(pid)?.type]?.isActive;
    if(active) return pi.vlanOvr ?? (pi.vlan>=1?pi.vlan:undefined) ?? pi.vlanProp ?? _siteNativeVlan();
    return pi.vlanProp ?? pi.vlanOvr ?? (pi.vlan>=1?pi.vlan:undefined) ?? _siteNativeVlan();
}

// Trunk EFFETTIVO di un link, derivato dalle "VLAN trasportate" dei device agli
// estremi (voce per il VoIP, VLAN-per-SSID per l'AP). Nativa = VLAN access già
// propagata (win._getLinkVlan). Le VLAN trasportate da un capo valgono solo se
// l'ALTRO capo NON è un leaf endpoint (salgono verso lo switch, non scendono
// verso il PC). Manual-first: un trunkVlans impostato a mano vince. Logica pura
// in lib/vlan-trunk.js. Ritorna { mode, native, vlans[], carried[], derived }.
function _getLinkTrunk(l){
    if(!l || typeof win.effLinkVlans!=='function') return { mode:'access', native:1, vlans:[1], carried:[], derived:true };
    const native = (typeof win._getLinkVlan==='function') ? win._getLinkVlan(l) : 1;
    const srcNode = getNodeByPortId(l.src), dstNode = getNodeByPortId(l.dst);
    const _isLeaf = n => !!(n && typeof win._isLeafEndpoint==='function' && win._isLeafEndpoint(n.type));
    let carried = [];
    if(srcNode && !_isLeaf(dstNode) && typeof win.carriedVlans==='function') carried = carried.concat(win.carriedVlans(srcNode));
    if(dstNode && !_isLeaf(srcNode) && typeof win.carriedVlans==='function') carried = carried.concat(win.carriedVlans(dstNode));
    // SNMP: il trunk REALE polled sulla porta (pi.trunkVlans/isTrunk) alimenta il
    // derivato — vale su ENTRAMBI i capi del link fisico (non leaf-gated: è la
    // membership di quel cavo). Manual-first resta: un l.trunkVlans/access a mano
    // vince comunque in win.effLinkVlans (questo entra solo nel ramo derivato).
    const _sp = store.state.ports[l.src] || {}, _dp = store.state.ports[l.dst] || {};
    // VLAN taggate "viste" su un capo del cavo: interfaccia attiva in trunk
    // (mode manuale o isTrunk SNMP) + trunkProp propagata lungo il run passivo.
    const _portTagged = pi => {
        const arr = [];
        if(_portEffTrunk(pi)) for(const v of _parseTrunkVlans(pi.trunkVlans||[])) arr.push(v);
        if(Array.isArray(pi.trunkProp)) for(const v of pi.trunkProp) arr.push(v);
        return arr;
    };
    carried = carried.concat(_portTagged(_sp), _portTagged(_dp));
    // Trunk forzato (anche con sola nativa): interfaccia in trunk (mode manuale o
    // isTrunk SNMP) o membership trunk propagata lungo il run (isTrunkProp).
    const snmpTrunk = !!(_portEffTrunk(_sp) || _portEffTrunk(_dp) || _sp.isTrunkProp || _dp.isTrunkProp);
    return win.effLinkVlans({ manualMode:l.mode, manualTrunkVlans:l.trunkVlans, native, carried, snmpTrunk });
}
export function _linkIsTrunk(l){ return _getLinkTrunk(l).mode === 'trunk'; }

// Imposta la VLAN NATIVA (untagged/PVID) di un trunk scrivendo il `vlanOvr` del
// capo ATTIVO del link (switch/router) — la nativa È il PVID di quella porta,
// nessun modello nuovo. Su switch↔switch scrive il capo attivo trovato. Tiene il
// link selezionato (a differenza di setPortField, che deseleziona).
function setLinkNativeVlan(linkId, val){
    const l = store.state.links.find(x=>x.id===linkId); if(!l) return;
    const _act = pid => !!TYPES[getNodeByPortId(pid)?.type]?.isActive;
    const pid = _act(l.src) ? l.src : (_act(l.dst) ? l.dst : null);
    if(!pid) return;   // nessun capo attivo: la nativa arriva da monte (non editabile qui)
    if(!store.state.ports[pid]) store.state.ports[pid] = {};
    const v = parseInt(val, 10);
    if(v>=1 && v<=4094){ store.state.ports[pid].vlanOvr = v; if(v>1 && typeof _ensureVlanColor==='function') _ensureVlanColor(v); }
    else delete store.state.ports[pid].vlanOvr;
    if(typeof propagateVlans==='function') propagateVlans();
    markDirty(); renderAll(); renderProps();
}

// Imposta la VLAN access di un ENDPOINT floor (pc/iot/printer/webcam/…) dal suo
// pannello, scrivendo il `vlanOvr` della sua interfaccia access — l'unica VLAN
// che il motore rispetta — e MANTENENDO il nodo selezionato (a differenza di
// setPortField, che deseleziona). Vuoto/1/invalido = nessun override (torna alla
// nativa di sito). Manual-first resta: se lo switch a monte propaga una VLAN su
// questo run passivo, _effPortVlan la fa comunque prevalere sull'override locale
// (per questo l'editor compare solo quando NESSUNO a monte la detta).
function setEndpointVlan(nodeId, pid, val){
    const n = (typeof win.nodeById==='function') ? nodeById(nodeId) : null; if(!n) return;
    if(!pid) pid = (typeof win._deviceAccessVlanPid==='function') ? win._deviceAccessVlanPid(n) : `${nodeId}-1`;
    if(!store.state.ports[pid]) store.state.ports[pid] = {};
    const v = parseInt(val, 10);
    if(v>=2 && v<=4094){ store.state.ports[pid].vlanOvr = v; if(typeof _ensureVlanColor==='function') _ensureVlanColor(v); }
    else delete store.state.ports[pid].vlanOvr;   // 1/vuoto/invalido = nessuna VLAN dedicata
    if(typeof propagateVlans==='function') propagateVlans();
    markDirty(); renderAll(); renderProps();
}

// VLAN VOCE di un telefono IP, impostata dal pannello PORTA/interfaccia (la voce è
// una proprietà dell'interfaccia: il telefono la tagga sull'uplink). Scrive
// node.voiceVlan e tiene selezionata la porta (win.renderProps ridisegna il pannello).
function setNodeVoiceVlan(nodeId, val){
    const n = (typeof win.nodeById==='function') ? nodeById(nodeId) : null; if(!n) return;
    const v = parseInt(val, 10);
    if(v>1 && v<=4094){
        // Fonte CANONICA: node.spec.voiceVlan (come updateN / assegnazione in blocco).
        if(typeof _setVoipVoiceVlan==='function') _setVoipVoiceVlan(n, v);
        else { (n.spec || (n.spec = {})).voiceVlan = v; delete n.voiceVlan; }
        if(typeof _ensureVlanColor==='function') _ensureVlanColor(v);
    } else {
        // 1/vuoto/invalido = nessuna voce dedicata → pulisci entrambe le sedi
        if(n.spec) delete n.spec.voiceVlan;
        delete n.voiceVlan;
    }
    if(typeof propagateVlans==='function') propagateVlans();
    markDirty(); renderAll(); renderProps();
}

// VLAN nativa PREDEFINITA di sito (default 1): sostituisce il magico "1" come
// nativa/untagged quando nessuna porta la specifica. Cambiarla (es. 1→99) sposta
// l'untagged di default ovunque non sia documentato esplicitamente (come il
// "native vlan" di sito su un device reale). Override per-porta/-trunk vincono.
function _siteNativeVlan(){
    const v = parseInt(store.state && store.state.nativeVlan, 10);
    return (v>=1 && v<=4094) ? v : 1;
}
function setSiteNativeVlan(val){
    const v = parseInt(val, 10);
    if(v>1 && v<=4094){ store.state.nativeVlan = v; if(typeof _ensureVlanColor==='function') _ensureVlanColor(v); }
    else delete store.state.nativeVlan;   // 1 o invalido = default → niente chiave salvata
    if(typeof propagateVlans==='function') propagateVlans();
    markDirty(); renderAll(); renderProps();
}
// Toggle dalla riga VLAN (stile guest/voce): clic su una VLAN la rende nativa di
// sito; ri-clic sulla stessa torna al default (1). Riusa setSiteNativeVlan, quindi
// resta solo un fallback per le porte NON documentate — non tocca PVID SNMP/override.
function toggleSiteNativeVlan(vid){
    const cur = (typeof _siteNativeVlan==='function') ? _siteNativeVlan() : 1;
    setSiteNativeVlan(cur === vid ? 1 : vid);
}

function updateVlanColor(v,c){store.state.vlanColors[v]=c;renderAll();markDirty();}
function updateVlanName(v,name){
    if(!store.state.vlanNames) store.state.vlanNames={};
    const n=name.trim();
    if(n) store.state.vlanNames[v]=n; else delete store.state.vlanNames[v];
    markDirty();
}
function toggleVlanIpam(v){
    const vid = +v;
    if(win._vlanIpamOpen.has(vid)) win._vlanIpamOpen.delete(vid);
    else win._vlanIpamOpen.add(vid);
    renderProps();
}
function updateVlanIpam(v, field, value){
    const vid = +v;
    const entry = win._ipamEntry(vid, true);
    const val = String(value||'').trim();
    if(val) entry[field] = val;
    else delete entry[field];
    if(!Object.keys(entry).length) delete win._ensureIpamState()[String(vid)];
    markDirty();
    renderProps();
}
function deleteVlanColor(v){
    pushHistory();
    delete store.state.vlanColors[v];
    if(store.state.vlanNames) delete store.state.vlanNames[v];
    if(store.state.ipam?.vlans) delete store.state.ipam.vlans[String(v)];
    win._vlanIpamOpen.delete(+v);
    if(store._filterVlan===+v) setVlanFilter(null);
    renderAll(); markDirty();
}

/** Rimuove tutte le VLAN dalla palette lasciando solo VLAN 1 (default implicito). */
function clearAllVlans(){
    if(!confirm(t('msg.ui.clearVlans'))) return;
    pushHistory();
    store.state.vlanColors = {};
    store.state.vlanNames  = {};
    store.state.ipam = { vlans:{} };
    win._vlanIpamOpen.clear();
    if(store._filterVlan && store._filterVlan !== 1) setVlanFilter(null);
    renderAll(); markDirty();
}

// ---- Filtro VLAN sulla planimetria -----------------------------------------

function setVlanFilter(vid){
    store._filterVlan = vid;
    const badge=document.getElementById('vlan-filter-badge');
    if(badge){
        if(vid){
            badge.querySelector('span').textContent='VLAN '+win._vlanLabel(vid);
            badge.style.display='inline-flex';
        } else {
            badge.style.display='none';
        }
    }
    renderAll(); renderCables();
}

// Marca/smarca una VLAN come "guest". Classificazione PERSISTENTE (dato di
// progetto, non un filtro di vista): i device visti solo su VLAN guest escono
// dalla categoria "device non documentati" del Drift Report (rumore tipico:
// telefoni/BYOD sulla guest WiFi). Toggle con win.markDirty come driftIgnore —
// non genera una voce di undo, ma viaggia negli snapshot successivi.
function toggleGuestVlan(vid){
    vid = parseInt(vid, 10);
    if(isNaN(vid)) return;
    if(!Array.isArray(store.state.guestVlans)) store.state.guestVlans = [];
    const i = store.state.guestVlans.indexOf(vid);
    if(i >= 0) store.state.guestVlans.splice(i, 1);
    else store.state.guestVlans.push(vid);
    markDirty();
    if(typeof win.renderProps === 'function') renderProps();       // pannello VLAN: aggiorna il pulsante
    if(typeof win._renderTopoLegend === 'function') win._renderTopoLegend(); // barra: aggiorna il tratteggio
}

// ---- VLAN di management (classificazione PERSISTENTE, come guestVlans) -------
// L'OPPOSTO della guest: i non-documentati su questa VLAN NON sono BYOD da
// nascondere ma infrastruttura (o intrusi) → restano 'infra', visibili nel Drift
// con un segnale di sicurezza, e l'Adozione li propone come device di rete. Più
// VLAN di management sono ammesse (array). Non cambia il modello L2/L3.
function toggleMgmtVlan(vid){
    vid = parseInt(vid, 10);
    if(isNaN(vid)) return;
    if(!Array.isArray(store.state.mgmtVlans)) store.state.mgmtVlans = [];
    const i = store.state.mgmtVlans.indexOf(vid);
    if(i >= 0) store.state.mgmtVlans.splice(i, 1);
    else store.state.mgmtVlans.push(vid);
    markDirty();
    if(typeof renderProps === 'function') renderProps();   // pannello VLAN: aggiorna il pulsante
}

// ---- VLAN voce (classificazione + assegnazione in blocco ai telefoni) -------
// Classificazione PERSISTENTE (come guestVlans): segna una VLAN come "voce" dal
// pannello VLAN. NON cambia il modello (la voce resta per-device su node.spec.
// voiceVlan): è metadato/intento + abilita l'assegnazione in blocco ai telefoni.
// Più VLAN voce sono supportate (array).
function _isVoiceVlan(vid){ return Array.isArray(store.state.voiceVlans) && store.state.voiceVlans.map(Number).includes(+vid); }

function toggleVoiceVlan(vid){
    vid = parseInt(vid, 10);
    if(isNaN(vid)) return;
    if(!Array.isArray(store.state.voiceVlans)) store.state.voiceVlans = [];
    const i = store.state.voiceVlans.indexOf(vid);
    if(i >= 0) store.state.voiceVlans.splice(i, 1);
    else store.state.voiceVlans.push(vid);
    markDirty();
    if(typeof win.renderProps === 'function') renderProps();
}

// Tutti i telefoni VoIP del progetto.
function _voipNodes(){ return (store.state.nodes || []).filter(n => n.type === 'voip'); }
// Voce EFFETTIVA di un telefono: top-level o spec (updateN scrive in spec).
function _voipVoiceVlan(n){
    const v = (n && n.voiceVlan != null) ? n.voiceVlan : (n && n.spec ? n.spec.voiceVlan : undefined);
    const x = parseInt(v, 10);
    return (x >= 1 && x <= 4094) ? x : null;
}
// Scrive la voce sul telefono come fa updateN (spec field, top-level rimosso).
function _setVoipVoiceVlan(n, vid){
    const spec = (typeof win._ensureNodeSpec === 'function') ? win._ensureNodeSpec(n) : (n.spec || (n.spec = {}));
    spec.voiceVlan = vid;
    delete n.voiceVlan;
}

// Conteggio telefoni che VERREBBERO modificati per dato ambito+politica (per il
// preview live del dialogo). policy: 'empty' = solo senza voce valida; 'all' = tutti.
function _voiceAssignTargets(vid, scope, policy){
    vid = parseInt(vid, 10);
    let list = _voipNodes();
    if(scope === 'selected'){
        const sel = (store.selType === 'node' && typeof win.nodeById === 'function') ? nodeById(store.selId) : null;
        list = (sel && sel.type === 'voip') ? [sel] : [];
    }
    return list.filter(n => {
        const cur = _voipVoiceVlan(n);
        if(policy === 'empty' && cur != null && cur > 1) return false;   // ha già una voce valida
        return cur !== vid;                                              // già su questa VLAN → no-op
    });
}

// Applica la VLAN voce ai telefoni dell'ambito secondo la politica. Manual-first:
// con policy 'empty' non tocca mai una voce impostata a mano.
function applyVoiceVlanBulk(vid, scope, policy){
    vid = parseInt(vid, 10);
    if(!(vid >= 1 && vid <= 4094)) return;
    const targets = _voiceAssignTargets(vid, scope, policy);
    if(!targets.length){
        if(typeof win._showToast === 'function') _showToast(_tV('voice.noPhones','Nessun telefono da modificare in questo ambito.'), 'warn', 3500);
        return;
    }
    if(typeof win.pushHistory === 'function') pushHistory();
    targets.forEach(n => _setVoipVoiceVlan(n, vid));
    if(!_isVoiceVlan(vid)) toggleVoiceVlan(vid);   // assegnare implica classificarla voce
    if(typeof propagateVlans === 'function') propagateVlans();
    if(typeof _ensureVlanColor === 'function' && vid > 1) _ensureVlanColor(vid);
    markDirty();
    if(typeof win.renderAll === 'function') renderAll();
    if(typeof win.renderProps === 'function') renderProps();
    if(typeof win._showToast === 'function') _showToast(_tV('voice.done','VLAN voce {vid} assegnata a {n} telefoni.', {vid, n:targets.length}), 'ok', 3500);
}

// i18n con fallback letterale (no shadowing in questo scope).
function _tV(key, fallback, vars){ return (typeof t === 'function') ? t(key, vars) : fallback; }

// ---- Dialogo "Assegna VLAN voce ai telefoni" (chiedi ogni volta) ------------
let _voiceAssignVid = null;

function _openVoiceAssignDialog(vid){
    _voiceAssignVid = parseInt(vid, 10);
    if(!(_voiceAssignVid >= 1)) return;
    let ov = document.getElementById('voice-assign-overlay');
    if(!ov){
        ov = document.createElement('div');
        ov.id = 'voice-assign-overlay';
        ov.className = 'drift-overlay';
        document.body.appendChild(ov);
        ov.addEventListener('mousedown', e => { if(e.target === ov) _closeVoiceAssign(); });
    }
    ov.innerHTML = _voiceAssignHtml();
    ov.style.display = 'flex';
    _voiceAssignPreview();
}
function _closeVoiceAssign(){ const ov = document.getElementById('voice-assign-overlay'); if(ov) ov.style.display = 'none'; }

function _voiceAssignHtml(){
    const vid = _voiceAssignVid;
    const selVoip = (store.selType === 'node' && typeof win.nodeById === 'function' && nodeById(store.selId) && nodeById(store.selId).type === 'voip') ? nodeById(store.selId) : null;
    const total = _voipNodes().length;
    return `<div class="drift-modal" style="max-width:440px">
      <div class="drift-head"><span><i class="fas fa-phone"></i> ${_tV('voice.assignTitle','Assegna VLAN voce {vid} ai telefoni',{vid})}</span>
        <button class="toolbar-btn" onclick="_closeVoiceAssign()" data-tip="${_tV('common.close','Chiudi')}"><i class="fas fa-times"></i></button></div>
      <div class="drift-body" style="padding:14px">
        <div class="prop-group"><label>${_tV('voice.scope','Ambito')}</label>
          <label class="prop-check"><input type="radio" name="va-scope" value="all" checked onchange="_voiceAssignPreview()"> ${_tV('voice.scopeAll','Tutti i telefoni')} (${total})</label>
          <label class="prop-check"${selVoip?'':' style="opacity:.45"'}><input type="radio" name="va-scope" value="selected" ${selVoip?'':'disabled'} onchange="_voiceAssignPreview()"> ${_tV('voice.scopeSelected','Solo il telefono selezionato')}</label>
        </div>
        <div class="prop-group" style="margin-top:8px"><label>${_tV('voice.policy','Telefoni già configurati')}</label>
          <label class="prop-check"><input type="radio" name="va-policy" value="empty" checked onchange="_voiceAssignPreview()"> ${_tV('voice.policyEmpty','Solo telefoni senza voce')}</label>
          <label class="prop-check"><input type="radio" name="va-policy" value="all" onchange="_voiceAssignPreview()"> ${_tV('voice.policyAll','Sovrascrivi tutti')}</label>
        </div>
        <div id="voice-assign-count" style="margin-top:10px;font-size:.85rem;color:var(--text-muted)"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button class="toolbar-btn" onclick="_closeVoiceAssign()">${_tV('common.cancel','Annulla')}</button>
          <button class="toolbar-btn primary" onclick="_voiceAssignConfirm()"><i class="fas fa-phone"></i> ${_tV('voice.apply','Assegna')}</button>
        </div>
      </div>
    </div>`;
}
function _voiceAssignRead(){
    const ov = document.getElementById('voice-assign-overlay');
    const get = name => { const el = ov && ov.querySelector(`input[name="${name}"]:checked`); return el ? el.value : null; };
    return { scope: get('va-scope') || 'all', policy: get('va-policy') || 'empty' };
}
function _voiceAssignPreview(){
    const el = document.getElementById('voice-assign-count'); if(!el) return;
    const { scope, policy } = _voiceAssignRead();
    const n = _voiceAssignTargets(_voiceAssignVid, scope, policy).length;
    el.textContent = _tV('voice.affected','{n} telefoni interessati',{n});
}
function _voiceAssignConfirm(){
    const { scope, policy } = _voiceAssignRead();
    applyVoiceVlanBulk(_voiceAssignVid, scope, policy);
    _closeVoiceAssign();
}

// ---- Membership VLAN --------------------------------------------------------

// Capacita' di ORIGINARE/taggare una VLAN 802.1Q per tipo device. I tag
// nascono sui trunk dei device VLAN-aware; gli access port verso gli endpoint
// sono untagged (la VLAN gliela assegna lo switch, non la generano).
//   'source'  = apparato VLAN-aware: tagga/instrada/definisce la VLAN
//               (switch, router, firewall, controller wireless, SD-WAN, VPN,
//               AP multi-SSID, telefono IP con voice VLAN)
//   'capable' = puo' taggare SOLO se NIC/OS/hypervisor lo supporta
//               (server, NAS, PBX, PC con driver 802.1Q / ESXi-VST / Proxmox)
//   (tutto il resto) = endpoint access puro: riceve la VLAN, non la origina
const _VLAN_TAG_ROLE = {
    switch:'source', router:'source', firewall:'source', wlanctrl:'source',
    sdwan:'source', vpncon:'source', ap:'source', voip:'source',
    server:'capable', nas:'capable', pbx:'capable', pc:'capable',
};
function _vlanTagRole(type){ return _VLAN_TAG_ROLE[type] || 'access'; }

function showVlanMembers(vid){
    // Raccoglie porte con questo VLAN ID (access) — letta dall'interfaccia
    const accessPorts=[];
    for(const [pid, pi] of Object.entries(store.state.ports)){
        const eff=_effPortVlan(pid);
        if(eff===vid){
            const nid=getPortNodeId(pid);
            const n=nodeById(nid);
            if(n) accessPorts.push({pid, nid, nodeType:n.type, nodeName:n.name||n.type, portNum:pid.split('-').slice(1).join('/')});
        }
    }
    // Raggruppa per device, poi tieni SOLO i device che possono originare la
    // VLAN (sorgenti Tier 1 + capaci Tier 2): gli endpoint access puri
    // (stampanti, camere, IoT, UPS…) ricevono la VLAN dallo switch e sono solo
    // rumore qui → contati ma nascosti.
    const allByDevice=new Map(); // nid → { name, type, ports:[portNum…] }
    accessPorts.forEach(p=>{
        if(!allByDevice.has(p.nid)) allByDevice.set(p.nid, { name:p.nodeName, type:p.nodeType, ports:[] });
        allByDevice.get(p.nid).ports.push(p.portNum);
    });
    const srcDevices=[]; let hiddenAccess=0;
    for(const [nid, d] of allByDevice){
        const role=_vlanTagRole(d.type);
        if(role==='access'){ hiddenAccess++; continue; }
        srcDevices.push({ nid, name:d.name, type:d.type, ports:d.ports, role });
    }
    // Sorgenti (source) prima, poi capaci (capable), poi per nome.
    srcDevices.sort((a,b)=>{
        if(a.role!==b.role) return a.role==='source' ? -1 : 1;
        return String(a.name).localeCompare(String(b.name), undefined, {numeric:true});
    });
    // Raccoglie trunk link che trasportano questo VLAN ID
    const trunkLinks=[];
    for(const l of store.state.links){
        if(l.mode==='trunk'){
            const vlans=_parseTrunkVlans(l.trunkVlans||'');
            if(vlans.includes(vid)){
                const sNid=getPortNodeId(l.src), dNid=getPortNodeId(l.dst);
                const sn=nodeById(sNid);
                const dn=nodeById(dNid);
                trunkLinks.push({
                    linkId:l.id,
                    srcName:(sn?.name||sNid)+' p'+(l.src.split('-').slice(1).join('/')),
                    dstName:(dn?.name||dNid)+' p'+(l.dst.split('-').slice(1).join('/'))
                });
            }
        }
    }

    const color=store.state.vlanColors[vid]||'#8b949e';
    const label=win._vlanLabel(vid);
    const isFiltered=store._filterVlan===vid;

    const _devCount=srcDevices.length;
    let body=`<div class="vm-section"><h4><i class="fas fa-tag" style="color:${color};margin-right:6px"></i>${escapeHTML(t('pnl.feat.vlanSources',{n:_devCount}))}</h4>`;
    if(srcDevices.length){
        // Una fisarmonica per device sorgente: header con icona/nome/ruolo/porte,
        // corpo con l'elenco delle porte. Aperta se un solo device.
        body+=`<div class="vm-dev-groups">`;
        srcDevices.forEach(d=>{
            const ic=TYPES[d.type]?.icon || (TYPES[d.type]?.isRack ? 'fa-server' : 'fa-microchip');
            const ports=d.ports.slice().sort((a,b)=>String(a).localeCompare(String(b), undefined, {numeric:true}));
            const portsHtml=ports.map(pn=>`<li><i class="fas fa-circle-dot" style="color:${color};font-size:9px;margin-right:6px"></i><span class="vm-port">${escapeHTML(t('pnl.feat.portN',{n:pn}))}</span></li>`).join('');
            const roleBadge = d.role==='source'
                ? `<span class="vm-dev-role src" data-tip="${escapeHTML(t('pnl.feat.roleSourceTip'))}">${escapeHTML(t('pnl.feat.roleSource'))}</span>`
                : `<span class="vm-dev-role cap" data-tip="${escapeHTML(t('pnl.feat.roleCapableTip'))}">${escapeHTML(t('pnl.feat.roleCapable'))}</span>`;
            const _portsLbl = ports.length===1 ? t('pnl.feat.portCountSing',{n:ports.length}) : t('pnl.feat.portCountPlur',{n:ports.length});
            body+=`<details class="vm-dev-group"${_devCount===1?' open':''}>
                    <summary><i class="fas ${ic}" style="color:${color};margin-right:7px"></i><span class="vm-dev-name">${escapeHTML(d.name)}</span>${roleBadge}<span class="vm-dev-count">${escapeHTML(_portsLbl)}</span></summary>
                    <ul class="vm-list">${portsHtml}</ul>
                  </details>`;
        });
        body+=`</div>`;
        if(hiddenAccess) body+=`<p class="vm-empty" style="margin-top:7px">${escapeHTML(t('pnl.feat.hiddenAccess',{n:hiddenAccess}))}</p>`;
    } else {
        body+=`<p class="vm-empty">${escapeHTML(hiddenAccess?t('pnl.feat.noSourceWithAccess',{n:hiddenAccess}):t('pnl.feat.noSource'))}</p>`;
    }
    body+=`</div>`;

    body+=`<div class="vm-section"><h4><i class="fas fa-code-branch" style="color:${color};margin-right:6px"></i>${escapeHTML(t('pnl.feat.trunkLinks',{n:trunkLinks.length}))}</h4>`;
    if(trunkLinks.length){
        body+=`<ul class="vm-list">`;
        trunkLinks.forEach(l=>{ body+=`<li><i class="fas fa-arrows-left-right" style="color:${color};font-size:9px;margin-right:6px"></i>${escapeHTML(l.srcName)} ↔ ${escapeHTML(l.dstName)}</li>`; });
        body+=`</ul>`;
    } else { body+=`<p class="vm-empty">${escapeHTML(t('pnl.feat.noTrunkLink'))}</p>`; }
    body+=`</div>`;

    document.getElementById('vm-title').textContent='VLAN '+label;
    document.getElementById('vm-body').innerHTML=body;
    const btnFilter=document.getElementById('vm-btn-filter');
    btnFilter.textContent=isFiltered?t('pnl.feat.removeFilter'):t('pnl.feat.highlightOnMap');
    btnFilter.onclick=()=>{ setVlanFilter(isFiltered?null:vid); closeVlanMembers(); };
    document.getElementById('vlan-members-overlay').style.display='flex';
}

function closeVlanMembers(){
    document.getElementById('vlan-members-overlay').style.display='none';
}
function setLinkColor(id,color){
    const l=store.state.links.find(x=>x.id===id); if(!l) return;
    const same = color===null ? !('colorOvr' in l) && !l.autoLinked : l.colorOvr===color && !l.autoLinked;
    if(same) return;
    pushHistory();
    if(typeof win._promoteLinkToManual==='function') win._promoteLinkToManual(l);
    if(color===null){ delete l.colorOvr; delete l.color; }
    else { l.colorOvr=color; l.color=color; }
    if(typeof _normalizeLinkMetadata==='function') _normalizeLinkMetadata(l);
    renderCables(); renderProps(); markDirty();
}

// ---- Modalità Access / Trunk ------------------------------------------------

// Modello reale: la modalità access/trunk è una proprietà dell'INTERFACCIA
// attiva (switchport), non del cavo. Impostare il trunk su un qualunque segmento
// del run scrive sulla porta attiva a monte (come setLinkNativeVlan fa per la
// nativa/PVID); il motore la propaga a tutti i segmenti passivi della tratta.
// Solo se il run non tocca alcuna interfaccia attiva si ricade sull'override del
// cavo (catena di soli passivi: nessun switchport che possa "possedere" il trunk).
function setLinkMode(id, mode){
    const l=store.state.links.find(x=>x.id===id); if(!l) return;
    const anchor = (typeof _runActiveAnchor==='function') ? _runActiveAnchor(l) : null;
    if(anchor){
        const cur = _portEffTrunk(store.state.ports[anchor]) ? 'trunk' : 'access';
        if(cur===mode && store.state.ports[anchor] && store.state.ports[anchor].mode) return;
        pushHistory();
        if(!store.state.ports[anchor]) store.state.ports[anchor] = {};
        if(mode==='trunk'){ store.state.ports[anchor].mode='trunk'; }
        else if(store.state.ports[anchor].isTrunk){ store.state.ports[anchor].mode='access'; }  // override vs SNMP
        else { delete store.state.ports[anchor].mode; delete store.state.ports[anchor].trunkVlans; }
        if(l.mode) delete l.mode;                 // l'override legacy sul cavo non serve più
        if(mode==='access') delete l.trunkVlans;
        if(typeof propagateVlans==='function') propagateVlans();
        markDirty(); renderAll(); renderProps();
        return;
    }
    // Fallback legacy: run di soli passivi → override sul cavo.
    if(l.mode===mode && !l.autoLinked) return;
    pushHistory();
    if(typeof win._promoteLinkToManual==='function') win._promoteLinkToManual(l);
    l.mode = mode;
    if(mode==='access') delete l.trunkVlans;
    renderProps(); markDirty();
}

function setLinkTrunkVlans(id, raw){
    const l=store.state.links.find(x=>x.id===id); if(!l) return;
    const next = raw.trim();
    const anchor = (typeof _runActiveAnchor==='function') ? _runActiveAnchor(l) : null;
    if(anchor){
        pushHistory();
        if(!store.state.ports[anchor]) store.state.ports[anchor] = {};
        store.state.ports[anchor].mode = 'trunk';
        if(next) store.state.ports[anchor].trunkVlans = next; else delete store.state.ports[anchor].trunkVlans;
        if(l.trunkVlans) delete l.trunkVlans;     // pulizia override legacy
        if(typeof propagateVlans==='function') propagateVlans();
        markDirty(); renderAll(); renderProps();
        return;
    }
    if((l.trunkVlans||'')===next && !l.autoLinked) return;
    pushHistory();
    if(typeof win._promoteLinkToManual==='function') win._promoteLinkToManual(l);
    l.trunkVlans = next;
    renderProps(); markDirty();
}

// Switchport diretto: imposta la modalità access/trunk di un'INTERFACCIA ATTIVA
// dal pannello Porta. La nativa resta il PVID (vlanOvr). Il motore propaga il
// trunk lungo il run. Usato dal blocco Access/Trunk del pannello porta.
function setPortMode(pid, mode){
    const node = getNodeByPortId(pid);
    if(!node || !TYPES[node.type]?.isActive) return;
    if(!store.state.ports[pid]) store.state.ports[pid] = {};
    const cur = _portEffTrunk(store.state.ports[pid]) ? 'trunk' : 'access';
    // No-op solo se la scelta coincide ED è già fissata a mano: se il trunk è
    // solo da SNMP, cliccarlo lo "fissa" come manuale (intento esplicito).
    if(cur===mode && store.state.ports[pid].mode) return;
    pushHistory();
    if(mode==='trunk') store.state.ports[pid].mode='trunk';
    else if(store.state.ports[pid].isTrunk) store.state.ports[pid].mode='access';  // override esplicito vs SNMP
    else { delete store.state.ports[pid].mode; delete store.state.ports[pid].trunkVlans; }
    if(typeof propagateVlans==='function') propagateVlans();
    markDirty(); renderAll(); renderProps();
}

function setPortTrunkVlans(pid, raw){
    const node = getNodeByPortId(pid);
    if(!node || !TYPES[node.type]?.isActive) return;
    if(!store.state.ports[pid]) store.state.ports[pid] = {};
    const next = String(raw||'').trim();
    store.state.ports[pid].mode = 'trunk';
    if(next) store.state.ports[pid].trunkVlans = next; else delete store.state.ports[pid].trunkVlans;
    if(typeof propagateVlans==='function') propagateVlans();
    markDirty(); renderAll(); renderProps();
}


/**
 * Parsa una stringa VLAN tipo "1,10,20,100-200,300" → array di numeri unici ordinati.
 * Supporta singoli ID e range (es. 100-200).
 */
function _parseTrunkVlans(raw){
    // Parser canonico unico: lib/vlan-trunk.js (puro, testato). Niente duplicato.
    return (typeof win.parseVlanList === 'function') ? win.parseVlanList(raw) : [];
}

/**
 * Converte un array ordinato di VLAN ID in stringa compatta con range.
 * Es. [1,10,11,12,20,100,101] → "1,10-12,20,100-101"
 */
function _vlansToRangeStr(sorted){
    if(!sorted||!sorted.length) return '';
    const ranges=[];
    let s=sorted[0], e=sorted[0];
    for(let i=1;i<=sorted.length;i++){
        if(i<sorted.length && sorted[i]===e+1){ e=sorted[i]; }
        else{ ranges.push(s===e?`${s}`:`${s}-${e}`); if(i<sorted.length){s=sorted[i];e=sorted[i];} }
    }
    return ranges.join(',');
}

function updateUiColor(k,c){if(!store.state.uiColors)store.state.uiColors={};store.state.uiColors[k]=c;win.applyUiColors();markDirty();}
function addVlanColor(){
    const v=normalizeNumber(document.getElementById('new-vlan-id').value,NaN,1,4094);
    const c=document.getElementById('new-vlan-color').value;
    if(!Number.isNaN(v)&&c){pushHistory();store.state.vlanColors[v]=c;renderAll();markDirty();}
}

expose({
    _ensureVlanColor, setAutoPoll, _startAutoPoll, _stopAutoPoll, _updateAutoPollBadge,
    toggleAutomationMenu, renderAutomationMenu,
    _buildPortAdjacency, propagateVlans, _isVlanConduit, _portEffTrunk, _portTrunkSeed,
    _propagateTrunkMembership, _runActiveAnchor, _effPortVlan, _getLinkTrunk, _linkIsTrunk,
    setLinkNativeVlan, setEndpointVlan, setNodeVoiceVlan, _siteNativeVlan, setSiteNativeVlan,
    toggleSiteNativeVlan, updateVlanColor, updateVlanName, toggleVlanIpam, updateVlanIpam,
    deleteVlanColor, clearAllVlans, setVlanFilter, toggleGuestVlan, toggleMgmtVlan, _isVoiceVlan,
    toggleVoiceVlan, _voipNodes, _voipVoiceVlan, _setVoipVoiceVlan, _voiceAssignTargets,
    applyVoiceVlanBulk, _tV, _openVoiceAssignDialog, _closeVoiceAssign, _voiceAssignHtml,
    _voiceAssignRead, _voiceAssignPreview, _voiceAssignConfirm, _vlanTagRole, showVlanMembers,
    closeVlanMembers, setLinkColor, setLinkMode, setLinkTrunkVlans, setPortMode,
    setPortTrunkVlans, _parseTrunkVlans, _vlansToRangeStr, updateUiColor, addVlanColor,
});
