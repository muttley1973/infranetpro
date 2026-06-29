// ============================================================
// PORTS FRONTEND (migrato a ESM, esbuild)
// Tabella porte, tooltip, override manuali e LAG UI.
// ============================================================
// Tutte le dipendenze passano dal ponte (win.*): stato/glue legacy (state,
// renderAll, renderProps, propagateVlans, trace, showPop, …), TYPES, e gli
// helper LAG/stack/patch-panel letti con guardia `typeof win.X`.
//
// STATO CONDIVISO CROSS-BOUNDARY (vive su window, NON come binding di modulo):
//   • lagSelMode / lagSelPorts / linkStart / selId / selType / highPath →
//     dichiarati `var` in app.js (su window); qui letti/scritti via win.*.
//   • _lastPopPid/_lastPopX/_lastPopY e _focusedLagGroup/_focusedLagPorts erano
//     `let` di questo file ma sono SCRITTI anche dai classic non-strict
//     (app-popup.js, app-shared-segment.js → window.<g>) e LETTI da
//     app-render-core.js (_isLagFocusedPort). Devono quindi vivere su window:
//     il modulo li inizializza al load e li usa via win.*; i classic, essendo
//     non-strict, scrivono la stessa proprietà di window.
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, uid, normalizeStatus } from './app-util.js';
import { nodeById, markDirty, getNodeByPortId, getPortNodeId, pushHistory, renderCables } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { propagateVlans } from './app-vlan-autopoll.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderProps } from './app-properties.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)

// Init dello stato condiviso su window (il bundle gira ULTIMO; i classic li
// scrivono solo dentro handler, quindi qui sono ancora undefined → li seminiamo).
if(store._lastPopPid === undefined) store._lastPopPid = null;
if(store._lastPopX  === undefined) store._lastPopX  = 0;
if(store._lastPopY  === undefined) store._lastPopY  = 0;
if(win._focusedLagGroup === undefined) win._focusedLagGroup = null;
if(store._focusedLagPorts === undefined) store._focusedLagPorts = new Set();

function renderPortsTable(n){
    const state = store.state;
    const pc = n.ports !== undefined ? n.ports : 0;
    if(!pc) return '';
    const fmtSpd = s=>s>=1000 ? `${(s/1000).toFixed(s%1000?1:0)}G` : `${s}M`;
    let rows = '';
    let visibleCount = 0;
    for(let i=1;i<=pc;i++){
        const pid = `${n.id}-${i}`;
        const pi = state.ports[pid] || {};
        const hidden = !!pi.hidden;
        if(!hidden) visibleCount++;
        const effStatus = pi.statusOvr ?? normalizeStatus(pi.status) ?? 'inactive';
        const effVlan = win._effPortVlan(pid);
        const effSpeed = pi.speedOvr ?? pi.speed ?? null;
        const spdVal = effSpeed != null ? fmtSpd(effSpeed) : '';
        const spdPh = pi.speed ? fmtSpd(pi.speed) : '—';
        const descPh = pi.alias || pi.ifName || '';
        const macTip = pi.mac ? ` · MAC: ${pi.mac}` : '';
        const ifTip = pi.ifName ? `${pi.ifName}${macTip}` : (macTip || '');
        const hasOvr = pi.statusOvr!=null || pi.speedOvr!=null || pi.vlanOvr!=null || (pi.desc && pi.desc!=='');
        rows += `<div class="pt-row${hidden?' pt-row-hidden':''}" data-tip="${escapeHTML(ifTip)}">
  <span class="pt-num">${i}</span>
  <input value="${escapeHTML(pi.desc||'')}" placeholder="${escapeHTML(descPh)}"
         data-ovr-pid="${pid}" data-ovr-field="desc" ${hidden?'disabled':''}
         onchange="setPortField('${pid}','desc',this.value)">
  <select class="${pi.statusOvr?'ovr':''}"
          data-ovr-pid="${pid}" data-ovr-field="statusOvr" ${hidden?'disabled':''}
          onchange="setPortField('${pid}','statusOvr',this.value)">
    <option value="active"   ${effStatus==='active'  ?'selected':''}>▲ ACT</option>
    <option value="idle"     ${effStatus==='idle'    ?'selected':''}>◌ IDLE</option>
    <option value="inactive" ${effStatus==='inactive'?'selected':''}>OFF</option>
    <option value="fault"    ${effStatus==='fault'   ?'selected':''}>✕ ERR</option>
  </select>
  <input value="${escapeHTML(spdVal)}" placeholder="${escapeHTML(spdPh)}"
         class="${pi.speedOvr!=null?'ovr':''}"
         data-ovr-pid="${pid}" data-ovr-field="speedOvr" ${hidden?'disabled':''}
         onchange="setPortSpeed('${pid}',this.value)" data-tip="${t('pnl.dev.speedTip')}">
  <input type="number" min="1" max="4094" value="${effVlan}"
         class="${pi.vlanOvr!=null?'ovr':''}"
         data-ovr-pid="${pid}" data-ovr-field="vlanOvr" ${hidden?'disabled':''}
         onchange="setPortField('${pid}','vlanOvr',+this.value||1)">
  <button class="pt-rst${hasOvr?' has-ovr':''}" data-tip="${t('pnl.dev.resetPortOvr',{n:i})}"
          onclick="clearAllPortOverrides('${pid}')" data-ovr-rst="${pid}">↺</button>
  <button class="pt-hide${hidden?' pt-hide-on':''}" data-tip="${hidden?t('pnl.dev.showIface'):t('pnl.dev.hideIface')}"
          onclick="togglePortHidden('${pid}')">Hide</button>
</div>`;
    }
    const hiddenCount = pc - visibleCount;
    const hiddenNote = hiddenCount ? `<span style="color:var(--text-muted);font-size:0.7rem">${t('pnl.dev.hiddenCount',{n:hiddenCount})}</span>` : '';
    return `<div class="ports-section">
<h5>${t('pnl.dev.ports')} <span>${t('pnl.dev.physicalCount',{n:visibleCount})}${hiddenNote?'  '+hiddenNote:''}</span></h5>
<div class="pt-head"><span></span><span>${t('common.description')}</span><span>${t('common.status')}</span><span>${t('pnl.dev.speedAbbr')}</span><span>VLAN</span><span></span><span></span></div>
<div class="pt-body">${rows}</div>
</div>`;
}

function getLagGroupsForNode(nodeId){
    const state = store.state;
    const n = nodeById(nodeId);
    const pc = n ? n.ports || 0 : 0;
    const groups = {};
    for(let i=1;i<=pc;i++){
        const pid = `${nodeId}-${i}`;
        const g = (state.ports[pid] || {}).lagGroup;
        if(g){
            if(!groups[g]) groups[g] = [];
            groups[g].push({ pid, num:i });
        }
    }
    return groups;
}

function startLagMode(pid){
    win.closePop();
    if(store.linkStart) win._cancelLink();
    win.lagSelMode = true;
    store.lagSelPorts = new Set([pid]);
    store.selType = 'port';
    store.selId = pid;
    renderAll();
}

function _toggleLagPort(pid){
    if(!win.lagSelMode) return;
    const anchor = [...store.lagSelPorts][0];
    if(pid === anchor) return;
    if(store.lagSelPorts.has(pid)) store.lagSelPorts.delete(pid);
    else store.lagSelPorts.add(pid);
    renderAll();
}

function confirmLag(){
    const state = store.state;
    if(store.lagSelPorts.size < 2){
        cancelLag();
        return;
    }
    pushHistory();
    if(!state.lagGroups) state.lagGroups = {};
    const anchor = [...store.lagSelPorts][0];
    const existingGid = (state.ports[anchor] || {}).lagGroup;
    const gid = existingGid || uid('lg');
    if(!state.lagGroups[gid]){
        const n = Object.keys(state.lagGroups).length + 1;
        state.lagGroups[gid] = `LAG ${n}`;
    }
    for(const pid of store.lagSelPorts){
        if(!state.ports[pid]) state.ports[pid] = {};
        state.ports[pid].lagGroup = gid;
    }
    win.lagSelMode = false;
    store.lagSelPorts = new Set();
    markDirty();
    renderAll();
    renderProps();
}

function cancelLag(){
    win.lagSelMode = false;
    store.lagSelPorts = new Set();
    renderAll();
}

function removePortFromLag(pid){
    const state = store.state;
    const pi = state.ports[pid] || {};
    const gid = pi.lagGroup;
    if(!gid) return;
    pushHistory();
    delete state.ports[pid].lagGroup;
    const remaining = Object.entries(state.ports).filter(([,f])=>f.lagGroup===gid);
    if(remaining.length < 2){
        for(const [p] of remaining) delete state.ports[p].lagGroup;
        if(state.lagGroups) delete state.lagGroups[gid];
    }
    markDirty();
    renderAll();
    renderProps();
}

function dissolveLag(gid){
    const state = store.state;
    pushHistory();
    for(const pi of Object.values(state.ports)){
        if(pi.lagGroup === gid) delete pi.lagGroup;
    }
    if(state.lagGroups) delete state.lagGroups[gid];
    markDirty();
    renderAll();
    renderProps();
}

/** Rinomina un gruppo LAG. Chiamato dal pannello proprieta. */
function renameLag(gid, name){
    const state = store.state;
    if(!gid) return;
    if(!state.lagGroups) state.lagGroups = {};
    state.lagGroups[gid] = (name||'').trim() || 'LAG';
    markDirty();
    renderAll();
}

function _updateLagBanner(){
    const b = document.getElementById('lag-sel-banner');
    if(!win.lagSelMode){
        b.classList.remove('show');
        return;
    }
    const n = store.lagSelPorts.size;
    b.innerHTML = `<i class="fas fa-layer-group" style="color:#00d4ff"></i>`
        + ` <strong>${t('pnl.dev.portsSelected',{n:n})}</strong>`
        + ` &nbsp;·&nbsp; ${t('pnl.dev.lagClickMore')}`
        + ` &nbsp;<button class="lag-confirm" onclick="confirmLag()">${t('pnl.dev.createLag')}</button>`
        + ` <button class="lag-cancel"  onclick="cancelLag()">${t('pnl.dev.cancel')}</button>`
        + ` <kbd>Esc</kbd>`;
    b.classList.add('show');
}

function computeLagCarrierPids(){
    const state = store.state;
    const carriers = new Set();
    for(const [pid,pi] of Object.entries(state.ports)){
        if(!pi.lagGroup) continue;
        const n = getNodeByPortId(pid);
        if(!n || !TYPES[n.type]?.isActive) continue;
        const visited = new Set([pid]);
        const queue = [pid];
        while(queue.length){
            const curr = queue.shift();
            for(const l of state.links){
                for(const other of win._linkAdjacentPorts(l, curr)){
                    if(!other || visited.has(other)) continue;
                    visited.add(other);
                    const on = getNodeByPortId(other);
                    if(!on) continue;
                    if(TYPES[on.type]?.isPassive){
                        carriers.add(other);
                        queue.push(other);
                    }
                }
            }
        }
    }
    return carriers;
}

function getPassivePortLagInfo(pid){
    const state = store.state;
    const visited = new Set([pid]);
    const queue = [pid];
    while(queue.length){
        const curr = queue.shift();
        for(const l of state.links){
            for(const other of win._linkAdjacentPorts(l, curr)){
                if(!other || visited.has(other)) continue;
                visited.add(other);
                const on = getNodeByPortId(other);
                if(!on) continue;
                if(TYPES[on.type]?.isActive){
                    const gid = (state.ports[other] || {}).lagGroup;
                    if(gid){
                        const gname = (state.lagGroups && state.lagGroups[gid]) || 'LAG';
                        return { gid, gname, nodeName:on.hostname || on.name || on.id };
                    }
                } else if(TYPES[on.type]?.isPassive){
                    queue.push(other);
                }
            }
        }
    }
    return null;
}

function togglePortHidden(pid){
    const state = store.state;
    if(!state.ports[pid]) state.ports[pid] = {};
    state.ports[pid].hidden = !state.ports[pid].hidden;
    markDirty();
    renderAll();
    renderProps();
}

function clearAllPortOverrides(pid){
    const state = store.state;
    if(!state.ports[pid]) return;
    delete state.ports[pid].statusOvr;
    delete state.ports[pid].speedOvr;
    delete state.ports[pid].vlanOvr;
    delete state.ports[pid].desc;
    const el = document.querySelector(`[data-pid="${pid}"]`);
    if(el){
        const pi = state.ports[pid] || {};
        const st = normalizeStatus(pi.statusOvr ?? pi.status);
        el.className = el.className.replace(/\b(active|inactive|fault|idle)\b/g,'').replace(/\s+/,' ').trim() + ' ' + st;
        el.title = portTip(pid);
    }
    propagateVlans();
    store.highPath.clear();
    win.trace(pid);
    store.selType = null;
    store.selId = null;
    renderCables();
    markDirty();
    _refreshPortRow(pid);
    if(store._lastPopPid===pid && document.getElementById('popup').style.display!=='none'){
        win.showPop({ clientX:store._lastPopX, clientY:store._lastPopY }, pid);
    }
}

function _refreshPortRow(pid){
    const state = store.state;
    const pi = state.ports[pid] || {};
    const hasOvr = pi.statusOvr!=null || pi.speedOvr!=null || pi.vlanOvr!=null || (pi.desc && pi.desc!=='');
    document.querySelectorAll(`[data-ovr-pid="${pid}"]`).forEach(el=>{
        const f = el.dataset.ovrField;
        if(f==='statusOvr') el.classList.toggle('ovr', pi.statusOvr!=null);
        else if(f==='speedOvr') el.classList.toggle('ovr', pi.speedOvr!=null);
        else if(f==='vlanOvr') el.classList.toggle('ovr', pi.vlanOvr!=null);
    });
    const rst = document.querySelector(`[data-ovr-rst="${pid}"]`);
    if(rst) rst.className = `pt-rst${hasOvr?' has-ovr':''}`;
}

function portTip(pid){
    const state = store.state;
    const pi = state.ports[pid] || {};
    const portNum = pid.split('-').slice(1).join('-');
    // Stacking (P7.2): per porte numeriche su switch in stack mostro la
    // numerazione qualificata `<member>/0/<port>` (convenzione Cisco IOS-XE
    // / Aruba CX / Juniper VC). Le porte MGMT (`mgmt1`...) e altre non
    // numeriche non vengono qualificate.
    let portLabel = portNum;
    const _nid = (typeof win.getPortNodeId === 'function') ? getPortNodeId(pid) : null;
    const _node = _nid && typeof win.nodeById === 'function' ? nodeById(_nid) : null;
    if(_node && typeof win.isInStack === 'function' && win.isInStack(_node)){
        const numeric = parseInt(portNum, 10);
        if(Number.isFinite(numeric) && String(numeric) === portNum){
            portLabel = win.getQualifiedPortName(_node, numeric);
        }
    }
    // Patch panel con numerazione progressiva (catena ppContinueFrom / startNum):
    // il tooltip mostra lo stesso numero del frontale e dell'etichetta cavo.
    if(_node && _node.type==='patchpanel' && typeof win._patchPanelOffset==='function'){
        const numeric = parseInt(portNum, 10);
        if(Number.isFinite(numeric) && String(numeric) === portNum){
            portLabel = String(numeric + win._patchPanelOffset(_node));
        }
    }
    const parts = [t('pnl.dev.portN',{n:portLabel})];
    const desc = pi.desc || (pi.alias && pi.alias!==pi.ifName ? pi.alias : '') || pi.ifName || '';
    if(desc) parts.push(desc);
    const spd = pi.speedOvr ?? pi.speed;
    if(spd){
        const s = spd>=1000 ? `${(spd/1000).toFixed(spd%1000?1:0)}G` : `${spd}M`;
        parts.push(s);
    }
    const vlan = win._effPortVlan(pid);
    if(vlan && vlan>1) parts.push(`VLAN ${win._vlanLabel(vlan)}`);
    // LAG con hint cross-stack quando la LAG attraversa piu' membri dello
    // stesso stack (caso reale: Port-channel1 con Gi1/0/24 + Gi2/0/24).
    const _hasLag = (pi.lagId && pi.lagId>0) || !!_portLagGid(pid);
    if(_hasLag){
        let lagStr = pi.lagId>0 ? `LAG ${pi.lagId}` : 'LAG';
        if(typeof win.getLagCrossMemberInfo === 'function'){
            const members = _getLagMembersOf(pid);
            if(members.size > 1){
                const info = win.getLagCrossMemberInfo(state.nodes, Array.from(members), win.getPortNodeId);
                if(info.isCross) lagStr += ' · cross-stack';
            }
        }
        parts.push(lagStr);
    }
    return parts.join(' · ');
}

function _portDisplayName(pid){
    const pi = store.state.ports[pid] || {};
    const raw = pid.split('-').slice(1).join('/');
    return pi.ifName || pi.alias || pi.desc || raw || '?';
}

function setPortField(pid, field, val){
    const state = store.state;
    if(!state.ports[pid]) state.ports[pid] = {};
    if(val===null || val===undefined || val==='') delete state.ports[pid][field];
    else state.ports[pid][field] = val;
    if(field==='vlanOvr'){
        const vid = parseInt(val, 10) || 1;
        if(vid>1) win._ensureVlanColor(vid);
        propagateVlans();
        store.highPath.clear();
        win.trace(pid);
        store.selType = null;
        store.selId = null;
        requestAnimationFrame(function(){
            renderCables();
            if(store._lastPopPid===pid && document.getElementById('popup').style.display!=='none'){
                win.showPop({ clientX:store._lastPopX, clientY:store._lastPopY }, pid);
            }
        });
        _refreshPortRow(pid);
        markDirty();
        return;
    }
    const el = document.querySelector(`[data-pid="${pid}"]`);
    if(el){
        const pi = state.ports[pid] || {};
        const st = normalizeStatus(pi.statusOvr ?? pi.status);
        el.className = el.className.replace(/\b(active|inactive|fault|idle)\b/g,'').replace(/\s+/,' ').trim() + ' ' + st;
        el.title = portTip(pid);
    }
    _refreshPortRow(pid);
    renderCables();
    markDirty();
}

function clearPortField(pid, field){
    const state = store.state;
    if(state.ports[pid]) delete state.ports[pid][field];
    if(field==='vlanOvr'){
        propagateVlans();
        store.highPath.clear();
        win.trace(pid);
        store.selType = null;
        store.selId = null;
        renderCables();
        _refreshPortRow(pid);
        if(store._lastPopPid===pid && document.getElementById('popup').style.display!=='none'){
            win.showPop({ clientX:store._lastPopX, clientY:store._lastPopY }, pid);
        }
        markDirty();
        return;
    }
    const el = document.querySelector(`[data-pid="${pid}"]`);
    if(el){
        const pi = state.ports[pid] || {};
        const st = normalizeStatus(pi.statusOvr ?? pi.status);
        el.className = el.className.replace(/\b(active|inactive|fault|idle)\b/g,'').replace(/\s+/,' ').trim() + ' ' + st;
        el.title = portTip(pid);
    }
    _refreshPortRow(pid);
    renderCables();
    markDirty();
    if(store._lastPopPid===pid && document.getElementById('popup').style.display!=='none'){
        win.showPop({ clientX:store._lastPopX, clientY:store._lastPopY }, pid);
    }
}

function setPortSpeed(pid, valStr){
    const s = valStr.trim().toUpperCase();
    if(!s){
        clearPortField(pid, 'speedOvr');
        return;
    }
    let mbps;
    if(s.endsWith('G')) mbps = parseFloat(s) * 1000;
    else if(s.endsWith('M')) mbps = parseFloat(s);
    else mbps = parseFloat(s) * 1000;
    setPortField(pid, 'speedOvr', (!isNaN(mbps) && mbps>0) ? Math.round(mbps) : null);
}

function _portLagGid(pid){
    const pi = store.state.ports[pid] || {};
    const gid = String(pi.lagGroup || '').trim();
    if(gid) return gid;
    const lid = parseInt(pi.lagId || 0, 10);
    return lid>0 ? `snmp-lag-${getPortNodeId(pid)}-${lid}` : '';
}

function _samePortLag(a,b){
    const ga = _portLagGid(a), gb = _portLagGid(b);
    if(ga && gb) return ga===gb;
    const state = store.state;
    const pa = state.ports[a] || {}, pb = state.ports[b] || {};
    const la = parseInt(pa.lagId || 0, 10), lb = parseInt(pb.lagId || 0, 10);
    return la>0 && lb>0 && la===lb && getPortNodeId(a)===getPortNodeId(b);
}

// Restituisce tutti i pid appartenenti allo stesso LAG di `pid` (incluso `pid`).
// Combina ports locali + porte cross-device via state.links (lagLogicalKey).
// Usato per il rilevamento LAG cross-member nel tooltip (P7.2).
function _getLagMembersOf(pid){
    const state = store.state;
    const out = new Set();
    const gid = _portLagGid(pid);
    if(!gid) return out;
    out.add(pid);
    const nodeId = getPortNodeId(pid);
    // Membri sullo stesso device
    for(const p of Object.keys(state.ports || {})){
        if(getPortNodeId(p)===nodeId && _samePortLag(p,pid)) out.add(p);
    }
    // Membri cross-device via lagLogicalKey sui link
    const keys = new Set();
    for(const l of state.links || []){
        if(l.src!==pid && l.dst!==pid) continue;
        if(l.lagLogicalKey) keys.add(l.lagLogicalKey);
        _collectLagMemberPortsFromLink(l, out);
    }
    if(keys.size){
        for(const l of state.links || []){
            if(l.lagLogicalKey && keys.has(l.lagLogicalKey)){
                _collectLagMemberPortsFromLink(l, out);
                out.add(l.src);
                out.add(l.dst);
            }
        }
    }
    return out;
}

function _collectLagMemberPortsFromLink(l, out){
    if(!l) return;
    const pairs = Array.isArray(l.lagMembers) && l.lagMembers.length
        ? l.lagMembers
        : [`${l.src}||${l.dst}`];
    for(const pair of pairs){
        const parts = String(pair || '').split('||');
        if(parts.length===2){
            out.add(parts[0]);
            out.add(parts[1]);
        }
    }
}

function _focusLagForPort(pid){
    const state = store.state;
    store._focusedLagPorts = new Set();
    const gid = _portLagGid(pid);
    win._focusedLagGroup = gid || null;
    if(!gid) return;

    const nodeId = getPortNodeId(pid);
    for(const p of Object.keys(state.ports || {})){
        if(getPortNodeId(p)===nodeId && _samePortLag(p,pid)) store._focusedLagPorts.add(p);
    }

    const keys = new Set();
    for(const l of state.links || []){
        if(l.src!==pid && l.dst!==pid) continue;
        if(l.lagLogicalKey) keys.add(l.lagLogicalKey);
        _collectLagMemberPortsFromLink(l, store._focusedLagPorts);
    }
    if(keys.size){
        for(const l of state.links || []){
            if(l.lagLogicalKey && keys.has(l.lagLogicalKey)){
                _collectLagMemberPortsFromLink(l, store._focusedLagPorts);
                store._focusedLagPorts.add(l.src);
                store._focusedLagPorts.add(l.dst);
            }
        }
    }
}

function _isLagFocusedPort(pid){
    return store._focusedLagPorts.has(pid) || (!!win._focusedLagGroup && _samePortLag(pid,store._lastPopPid));
}

// Lock manual-first VISIBILE sulla VLAN della porta. NON è un meccanismo nuovo:
// usa l'override `vlanOvr` già esistente che il Sync NON tocca (app-snmp.js
// "NON toccare … vlanOvr") e che il Drift confronta con la realtà. Bloccare =
// congela la VLAN attuale in vlanOvr; sbloccare = rimuove l'override → la porta
// torna a seguire la VLAN live. NON deseleziona (a differenza di set/clearPortField
// sul percorso vlanOvr): tiene aperto il pannello con lo stato lock aggiornato.
function togglePortVlanLock(pid){
    const state = store.state;
    const pi = state.ports[pid] || (state.ports[pid] = {});
    if(pi.vlanOvr != null) delete pi.vlanOvr;                 // sblocca → segue la VLAN live
    else pi.vlanOvr = (pi.vlan != null ? pi.vlan : 1);        // blocca → congela il valore attuale
    propagateVlans();
    markDirty();
    renderAll();
    renderProps();
}

// Superficie pubblica: tutta l'API del modulo (handler inline onclick generati:
// setPortField/setPortSpeed/clearAllPortOverrides/togglePortHidden/confirmLag/
// cancelLag + funzioni chiamate dai file classic: renderPortsTable [props],
// portTip/_isLagFocusedPort/_focusLagForPort [render/popup], LAG UI, ecc).
expose({
    togglePortVlanLock,
    renderPortsTable, getLagGroupsForNode, startLagMode, _toggleLagPort,
    confirmLag, cancelLag, removePortFromLag, dissolveLag, renameLag,
    _updateLagBanner, computeLagCarrierPids, getPassivePortLagInfo,
    togglePortHidden, clearAllPortOverrides, _refreshPortRow, portTip,
    _portDisplayName, setPortField, clearPortField, setPortSpeed,
    _portLagGid, _samePortLag, _getLagMembersOf, _collectLagMemberPortsFromLink,
    _focusLagForPort, _isLagFocusedPort,
});
