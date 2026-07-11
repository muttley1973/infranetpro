// ============================================================
// SHARED SEGMENT — porta multi-MAC / segmento condiviso
// ============================================================
// Tutta la feature "porta con piu' MAC dietro" (hub/AP/uplink/guest): rilevazione
// righe MAC, info/badge per porta, marcatura ruolo (sharedSegmentRole), bind a un
// nodo esistente o creazione di un nodo intermedio. UI popup + setter di stato.
// Migrato a modulo ESM (src/) da lib/app-autolink.js (R9).
// Le funzioni di discovery-observation (_recordDiscoveryObservation, _nodeByMacMap)
// e l'engine auto-link restano in app-autolink.js (lette via win.*).
// NB: setPropsSectionState dentro ontoggle="" resta BARE (gira in scope pagina).
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, uid } from './app-util.js';
import { nodeById, markDirty, getNodeByPortId, getPortNodeId, getNodeDisplayName, pushHistory, renderCables, _showToast, _invalidateIdx, _linksForPort, _nextNodeId, getRackById, _promoteLinkToManual, canAddConnection, _createLinkRecord, getPortMaxConnections, _activatePropsTab } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderProps, _propsSectionIsOpen, setPropsSectionState } from './app-properties.js';   // ritiro ponte fase 2+: funzioni/builder (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES, typeName } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES) + nome localizzato
import { focusNode, renderRackTabs } from './app-search-zoom-rack.js';   // ritiro ponte: funzioni rack/zoom/search (ex win.*)
import { closePop, showPop } from './app-popup.js';   // ritiro ponte: funzioni foglia UI/vlan/popup (ex win.*)
import { _portDisplayName } from './app-ports.js';   // ritiro ponte: funzioni foglia UI/vlan/popup (ex win.*)
import { _isLeafEndpoint, _nodeByMacMap, _ensureDiscoveryHistory } from './app-autolink.js';   // ritiro ponte: funzioni nucleo/tipi/autolink (ex win.*)
import { _findFreeU } from './app-topology-crawl.js';   // ritiro ponte: funzioni getter/label/props/disc (ex win.*)

let _sharedBindState = null; // stato wizard bind (module-local, nessun lettore esterno)
function _macRowsForPort(pid, opts={}){
    const pi = store.state.ports[pid] || {};
    const node = getNodeByPortId(pid);
    if(!node || !TYPES[node.type]?.isActive) return null;
    const names = [pi.ifName, pi.alias, pi.desc].map(x=>String(x||'').trim()).filter(Boolean);
    if(!names.length) return null;
    const nameSet = new Set(names.map(x=>x.toLowerCase()));
    const byMac = _nodeByMacMap();
    const byKey = new Map();

    const add = (row) => {
        const mac = win._normMacKey(row.mac);
        if(!mac) return;
        const ep = byMac.get(mac) || null;
        const hist = _ensureDiscoveryHistory()
            .filter(x=>x.mac===mac)
            .sort((a,b)=>String(b.lastSeen||b.ts||'').localeCompare(String(a.lastSeen||a.ts||'')))[0] || null;
        const key = mac;
        const prev = byKey.get(key);
        const next = {
            mac,
            ifName: row.ifName || hist?.ifName || names[0],
            node: ep,
            label: ep ? (ep.name || ep.hostname || ep.ip || ep.id) : (hist?.ip || row.ip || mac),
            ip: ep?.ip || ep?.integration?.host || hist?.ip || row.ip || '',
            source: row.source || hist?.source || 'FDB',
            lastSeen: hist?.lastSeen || hist?.ts || '',
            count: hist?.count || 1
        };
        if(!prev || next.node || next.ip) byKey.set(key, next);
    };

    const fdb = store._topoFdbCache?.[node.id] || {};
    for(const [mac, ifNameRaw] of Object.entries(fdb)){
        const ifName = String(ifNameRaw || '').trim();
        if(!nameSet.has(ifName.toLowerCase())) continue;
        add({mac, ifName, source:'FDB'});
    }

    for(const h of _ensureDiscoveryHistory()){
        if(h.switchId !== node.id) continue;
        if(h.portId && h.portId !== pid) continue;
        if(!h.portId && h.ifName && !nameSet.has(String(h.ifName).toLowerCase())) continue;
        add({...h, source:h.source || 'history'});
    }

    const macs = [...byKey.values()];
    if(!macs.length) return null;
    macs.sort((a,b)=>{
        if(!!a.node !== !!b.node) return a.node ? -1 : 1;
        return String(a.label).localeCompare(String(b.label));
    });
    return macs;
}

function _sharedSegmentInfoForPort(pid, opts={}){
    const pi = store.state.ports[pid] || {};
    if(pi.sharedSegmentIgnored && !opts.includeIgnored) return null;
    const node = getNodeByPortId(pid);
    if(!node || !TYPES[node.type]?.isActive) return null;
    const macs = _macRowsForPort(pid) || [];
    if(!macs.length) return null;
    const names = [pi.ifName, pi.alias, pi.desc].map(x=>String(x||'').trim()).filter(Boolean);
    if(!names.length) return null;

    const threshold = Number(pi.sharedSegmentThreshold || 2);
    const role = String(pi.sharedSegmentRole || '').trim();
    const serverHint = !!pi.sharedSegmentHint;
    const isShared = macs.length >= threshold || !!role || serverHint;
    if(!isShared) return null;

    return {
        pid,
        node,
        port:pi,
        ifName:names[0],
        macs,
        endpoints:macs.filter(x=>x.node),
        unknownCount:macs.filter(x=>!x.node).length,
        threshold,
        role,
        ignored:!!pi.sharedSegmentIgnored,
        serverHint,
        serverMacCount: pi.sharedSegmentMacCount || 0,
    };
}

function _sharedSegmentRoleLabel(role){
    return ({
        switch:t('pnl.seg.roleSwitch'),
        ap:t('pnl.seg.roleAp'),
        gateway:t('pnl.seg.roleGateway'),
        rackuplink:t('pnl.seg.roleRackUplink'),
        hypervisor:t('pnl.seg.roleHypervisor'),
        ignore:t('pnl.seg.roleIgnored')
    })[role] || t('pnl.seg.roleShared');
}


function _sharedExistingRoleLabel(role){
    return ({
        switch:t('pnl.seg.existSwitch'),
        ap:t('pnl.seg.existAp'),
        gateway:t('pnl.seg.existGateway'),
        hypervisor:t('pnl.seg.existHypervisor'),
    })[role] || t('pnl.seg.existDevice');
}

function _sharedSegmentResolvedLink(pid, nodeId){
    return store.state.links.find(l=>{
        if(!_linkTouchesPort(l, pid)) return false;
        const a = getPortNodeId(l.src), b = getPortNodeId(l.dst);
        return a === nodeId || b === nodeId;
    }) || null;
}

function _sharedSegmentNodeOpen(pid){
    const p = store.state.ports[pid] || {};
    const n = nodeById(p.sharedSegmentNodeId);
    if(!n) return;
    if(TYPES[n.type]?.isRack && n.rackId && n.rackId !== store.state.currentRack){
        store.state.currentRack = n.rackId;
        renderRackTabs();
    }
    store.selType = 'node';
    store.selId = n.id;
    renderAll();
    renderProps();
    if(typeof focusNode === 'function') focusNode(n);
    closePop();
}

function _sharedSegmentNodeMatchesRole(n, role){
    if(!n) return false;
    const customText = `${n.customCategory || ''} ${n.name || ''} ${n.hostname || ''}`.toLowerCase();
    const serverText = `${n.srvRole || ''} ${n.name || ''} ${n.hostname || ''} ${n.model || ''}`.toLowerCase();
    switch(role){
        case 'switch':
            return n.type === 'switch' || ((n.type === 'customrack' || n.type === 'customfloor') && /switch/.test(customText));
        case 'ap':
            return n.type === 'ap';
        case 'gateway':
            return n.type === 'router' || n.type === 'firewall' || ((n.type === 'customrack' || n.type === 'customfloor') && /gateway|router|firewall/.test(customText));
        case 'hypervisor':
            return n.type === 'server'
                || ((n.type === 'customrack' || n.type === 'customfloor') && /hypervisor|esxi|proxmox|vmware|hyper-v|server/.test(customText))
                || /hypervisor|esxi|proxmox|vmware|hyper-v/.test(serverText);
        default:
            return false;
    }
}

function _sharedSegmentNodeRoleScore(n, role){
    if(!n) return 0;
    const text = `${n.name || ''} ${n.hostname || ''} ${n.model || ''} ${n.brand || ''} ${n.customCategory || ''} ${n.srvRole || ''}`.toLowerCase();
    let score = 0;
    if(role === 'gateway' && /gateway|router|firewall|zywall|mikrotik|forti|pfsense|opnsense|usg|udm/.test(text)) score += 25;
    if(role === 'hypervisor' && /hypervisor|esxi|proxmox|vmware|hyper-v|vsphere/.test(text)) score += 25;
    if(role === 'switch' && /switch|core|dist|access|stack/.test(text)) score += 10;
    if(role === 'ap' && /ap|wifi|wireless|wlan/.test(text)) score += 10;
    return score;
}

function _sharedSegmentNodeLocation(n){
    if(!n) return '';
    if(TYPES[n.type]?.isRack){
        const rack = getRackById(n.rackId);
        return `${rack?.name || 'Rack'} · U${n.rackU || '?'}`;
    }
    if(TYPES[n.type]?.isFloor) return t('pnl.seg.floorPlan');
    return '';
}

function _sharedSegmentPortHintScore(pi, role){
    const text = `${pi.ifName || ''} ${pi.alias || ''} ${pi.desc || ''}`.toLowerCase();
    let score = 0;
    if(pi.sharedSegmentHint) score += 35;
    if(role === 'switch' && pi.sharedSegmentRole === 'rackuplink') score += 50;
    if(role === 'ap' && /ap|wifi|wlan|wireless/.test(text)) score += 25;
    if(role === 'gateway' && /wan|gateway|router|firewall|internet|edge|uplink/.test(text)) score += 25;
    if(role === 'hypervisor' && /esxi|proxmox|vm|hyper|server|host/.test(text)) score += 25;
    if(role === 'switch' && /uplink|trunk|core|dist|switch|stack|lag|po|port-channel/.test(text)) score += 25;
    return score;
}

function _sharedSegmentPortChoices(node, role, sourcePid){
    const count = win.getNodePortCount(node);
    const out = [];
    for(let i=1;i<=count;i++){
        const pid = `${node.id}-${i}`;
        const links = _linksForPort(pid);
        const manualBusy = links.some(l=>!l.autoLinked && !_linkHasPair(l, sourcePid, pid));
        const conn = win.getPortConnectionCount(pid);
        const max = getPortMaxConnections(pid);
        if(manualBusy) continue;
        if(conn >= max && !links.some(l=>_linkHasPair(l, sourcePid, pid))) continue;
        const pi = store.state.ports[pid] || {};
        const score = _sharedSegmentPortHintScore(pi, role) + (conn === 0 ? 15 : 0) + (conn < max ? 10 : 0);
        out.push({
            pid,
            label: _portDisplayName(pid),
            desc: pi.desc || pi.alias || '',
            conn,
            max,
            score,
            hinted: !!pi.sharedSegmentHint || !!pi.sharedSegmentRole,
        });
    }
    out.sort((a,b)=>b.score-a.score || a.conn-b.conn || String(a.pid).localeCompare(String(b.pid)));
    return out;
}

function _closeSharedSegmentBind(){
    _sharedBindState = null;
    const ov = document.getElementById('shared-bind-overlay');
    if(ov) ov.classList.remove('open');
}

function _backSharedSegmentBind(){
    if(!_sharedBindState) return;
    _sharedBindState.step = 'nodes';
    _sharedBindState.nodeId = '';
    _sharedBindState.portChoices = [];
    _renderSharedSegmentBind();
}

function _renderSharedSegmentBind(){
    const ov = document.getElementById('shared-bind-overlay');
    const body = document.getElementById('shared-bind-body');
    const title = document.getElementById('shared-bind-title');
    const back = document.getElementById('shared-bind-back');
    if(!ov || !body || !title || !back || !_sharedBindState) return;
    const info = _sharedSegmentInfoForPort(_sharedBindState.pid, {includeIgnored:true});
    title.innerHTML = `<i class="fas fa-link"></i> ${escapeHTML(_sharedExistingRoleLabel(_sharedBindState.role))}`;
    back.style.display = _sharedBindState.step === 'ports' ? 'inline-flex' : 'none';
    const sourceNode = info?.node;
    const sourceText = sourceNode ? `${getNodeDisplayName(sourceNode)} / ${info.ifName}` : _sharedBindState.pid;
    const sourceMeta = info ? t('pnl.seg.macSeenOnPort',{n:info.macs.length || info.serverMacCount || 0}) : t('pnl.seg.sourcePort');
    const sourceHtml = `<div class="shared-bind-source"><strong>${escapeHTML(sourceText)}</strong><div class="shared-bind-card-meta">${escapeHTML(sourceMeta)}</div></div>`;

    if(_sharedBindState.step === 'nodes'){
        const cards = _sharedBindState.candidates.map(n=>{
            const count = win.getNodePortCount(n);
            const location = _sharedSegmentNodeLocation(n);
            const score = _sharedSegmentNodeRoleScore(n, _sharedBindState.role);
            const badge = score > 0 ? `<span class="shared-bind-badge">${t('pnl.seg.strongCandidate')}</span>` : '';
            return `<button class="shared-bind-card" onclick="_selectSharedSegmentBindNode('${n.id}')">
                <div class="shared-bind-card-head">
                  <div class="shared-bind-card-title"><i class="fas ${TYPES[n.type]?.icon || 'fa-cube'}"></i>${escapeHTML(getNodeDisplayName(n))}</div>
                  ${badge}
                </div>
                <div class="shared-bind-card-meta">${escapeHTML(typeName(n.type))} · ${escapeHTML(location || t('pnl.seg.locUnspecified'))} · ${count} ${count===1?t('pnl.seg.portWord'):t('pnl.seg.portsWord')}</div>
              </button>`;
        }).join('');
        body.innerHTML = `
            <div class="shared-bind-hint">${t('pnl.seg.bindNodesHint')}</div>
            ${sourceHtml}
            <div class="shared-bind-list">${cards || `<div class="shared-bind-empty">${t('pnl.seg.noCompatDevice')}</div>`}</div>`;
        return;
    }

    const node = nodeById(_sharedBindState.nodeId);
    const portCards = (_sharedBindState.portChoices || []).map(p=>`
        <button class="shared-bind-card" onclick="_confirmSharedSegmentBind('${_sharedBindState.nodeId}','${p.pid}')">
            <div class="shared-bind-card-head">
              <div class="shared-bind-card-title"><i class="fas fa-ethernet"></i>${escapeHTML(p.label || p.pid)}</div>
              ${p.hinted ? `<span class="shared-bind-badge">${t('pnl.seg.suggestedPort')}</span>` : ''}
            </div>
            <div class="shared-bind-card-meta">${escapeHTML(p.desc || t('pnl.seg.noDescription'))} · ${p.conn}/${p.max} ${t('pnl.seg.connectionsWord')} · score ${p.score}</div>
        </button>`).join('');
    body.innerHTML = `
        <div class="shared-bind-hint">${t('pnl.seg.bindPortsHint')}</div>
        ${sourceHtml}
        <div class="shared-bind-source"><strong>${escapeHTML(getNodeDisplayName(node))}</strong><div class="shared-bind-card-meta">${escapeHTML(_sharedSegmentNodeLocation(node) || '')}</div></div>
        <div class="shared-bind-list">${portCards || `<div class="shared-bind-empty">${t('pnl.seg.noPortAvailable')}</div>`}</div>`;
}

function _openSharedSegmentBind(pid, role){
    const info = _sharedSegmentInfoForPort(pid, {includeIgnored:true});
    if(!info) return;
    const sourceNodeId = getPortNodeId(pid);
    const candidates = store.state.nodes
        .filter(n=>n.id !== sourceNodeId && _sharedSegmentNodeMatchesRole(n, role))
        .sort((a,b)=>_sharedSegmentNodeRoleScore(b, role) - _sharedSegmentNodeRoleScore(a, role) || getNodeDisplayName(a).localeCompare(getNodeDisplayName(b)));
    if(!candidates.length){
        _showToast(t('msg.rack.noRoleFound',{role:_sharedExistingRoleLabel(role).toLowerCase()}), 'warn', 3500);
        return;
    }
    _sharedBindState = { pid, role, step:'nodes', nodeId:'', portChoices:[], candidates };
    _renderSharedSegmentBind();
    const ov = document.getElementById('shared-bind-overlay');
    if(ov) ov.classList.add('open');
}

function _selectSharedSegmentBindNode(nodeId){
    if(!_sharedBindState) return;
    const node = nodeById(nodeId);
    if(!node) return;
    const choices = _sharedSegmentPortChoices(node, _sharedBindState.role, _sharedBindState.pid);
    if(!choices.length){
        _showToast(t('msg.rack.noUsablePorts'), 'warn', 3800);
        return;
    }
    if(choices.length === 1){
        _confirmSharedSegmentBind(nodeId, choices[0].pid);
        return;
    }
    if(choices[0]?.score >= 40 && (!choices[1] || (choices[0].score - choices[1].score) >= 15)){
        _confirmSharedSegmentBind(nodeId, choices[0].pid);
        return;
    }
    _sharedBindState.step = 'ports';
    _sharedBindState.nodeId = nodeId;
    _sharedBindState.portChoices = choices;
    _renderSharedSegmentBind();
}

function _confirmSharedSegmentBind(nodeId, portId){
    const info = _sharedBindState ? _sharedSegmentInfoForPort(_sharedBindState.pid, {includeIgnored:true}) : null;
    const role = _sharedBindState?.role;
    const srcPid = _sharedBindState?.pid;
    const node = nodeById(nodeId);
    if(!info || !role || !srcPid || !node) return;

    const srcManualConflict = _linksForPort(srcPid).some(l=>!l.autoLinked && !_linkHasPair(l, srcPid, portId));
    const dstManualConflict = _linksForPort(portId).some(l=>!l.autoLinked && !_linkHasPair(l, srcPid, portId));
    if(srcManualConflict || dstManualConflict){
        _showToast(t('msg.rack.manualLinkExists'), 'warn', 4200);
        return;
    }

    const existing = store.state.links.find(l=>_linkHasPair(l, srcPid, portId));
    pushHistory();
    if(existing){
        if(existing.autoLinked && typeof _promoteLinkToManual === 'function') _promoteLinkToManual(existing);
    } else {
        store.state.links = store.state.links.filter(l => !(l.autoLinked && (_linkTouchesPort(l, srcPid) || _linkTouchesPort(l, portId))));
        _invalidateIdx();
        if(!canAddConnection(srcPid) || !canAddConnection(portId)){
            _showToast(t('msg.rack.portUnavailable'), 'warn', 3800);
            return;
        }
        _connectPortsSafe(srcPid, portId);
    }

    if(!store.state.ports[srcPid]) store.state.ports[srcPid] = {};
    store.state.ports[srcPid].sharedSegmentRole = role;
    store.state.ports[srcPid].sharedSegmentNodeId = nodeId;
    delete store.state.ports[srcPid].sharedSegmentIgnored;
    if(!store.state.ports[srcPid].desc){
        store.state.ports[srcPid].desc = getNodeDisplayName(node);
    }

    markDirty();
    renderAll();
    renderCables();
    renderProps();
    if(store._lastPopPid===srcPid && document.getElementById('popup').style.display!=='none'){
        showPop({clientX:store._lastPopX, clientY:store._lastPopY}, srcPid);
    }
    _closeSharedSegmentBind();
    _showToast(t('msg.rack.connectedTo',{name:getNodeDisplayName(node)}), 'ok', 3200);
}

function _sharedSegmentNotes(info, role){
    const title = _sharedSegmentRoleLabel(role);
    const lines = info.macs.slice(0, 30).map(x=>`- ${x.label}${x.ip ? ' ('+x.ip+')' : ''}: ${x.mac}`);
    const extra = info.macs.length > 30 ? `\n${t('pnl.seg.notesMore',{n:info.macs.length - 30})}` : '';
    return `${t('pnl.seg.notesHeader',{title:title,node:info.node.name || info.node.hostname || info.node.id,ifName:info.ifName})}\n${lines.join('\n')}${extra}`;
}

function _sharedSegmentPropsWrapV2(previewHtml, bodyHtml){
    const preview = previewHtml
        ? `<span class="props-collapsible-preview">${previewHtml}</span>`
        : '';
    return `<details id="props-shared-segment" class="props-collapsible props-secondary" ${_propsSectionIsOpen('shared-segment')?'open':''} ontoggle="setPropsSectionState('shared-segment',this.open)" style="margin-top:14px">
      <summary class="props-collapsible-head"><span><i class="fas fa-diagram-project"></i> ${t('pnl.seg.l2Shared')}</span>${preview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
      <div class="props-collapsible-body">${bodyHtml}</div>
    </details>`;
}

function _openSharedSegmentProps(pid){
    if(!pid) return;
    store.selType = 'port';
    store.selId = pid;
    setPropsSectionState('shared-segment', true);
    renderProps();
    if(typeof _activatePropsTab === 'function') _activatePropsTab('Proprietà');
    if(typeof closePop === 'function') closePop();
    setTimeout(()=>{
        const section = document.getElementById('props-shared-segment');
        if(!section) return;
        section.open = true;
        section.dispatchEvent(new Event('toggle'));
        try{ section.scrollIntoView({ block:'nearest', behavior:'smooth' }); }catch(_){}
    }, 20);
}

function _sharedSegmentHtml(pid, context='popup'){
    const portState = store.state.ports[pid] || {};
    const roleKey = String(portState.sharedSegmentRole || '').trim();
    const resolvedNode = nodeById(portState.sharedSegmentNodeId);
    const compact = context === 'popup';

    if(resolvedNode && roleKey && ['switch','ap','gateway','hypervisor'].includes(roleKey)){
        const resolvedLink = _sharedSegmentResolvedLink(pid, resolvedNode.id);
        const targetPid = resolvedLink ? _linkOtherPort(resolvedLink, pid) : '';
        const targetPort = targetPid ? _portDisplayName(targetPid) : '';
        const targetLine = targetPort ? `${getNodeDisplayName(resolvedNode)} / ${targetPort}` : getNodeDisplayName(resolvedNode);
        if(compact){
            return `<div class="shared-seg-ignored">
            <span><i class="fas fa-circle-info" style="color:var(--active-color)"></i> ${t('pnl.seg.l2SharedConfirmed')}</span>
            <button class="toolbar-btn" onclick="_openSharedSegmentProps('${pid}')"><i class="fas fa-sliders"></i> ${t('pnl.seg.manageInProps')}</button>
          </div>`;
        }
        return _sharedSegmentPropsWrapV2(
            `${t('pnl.seg.statusConfirmed')} · ${escapeHTML(_sharedExistingRoleLabel(roleKey))}`,
            `<div class="shared-seg-ignored">
            <span><i class="fas fa-check-circle" style="color:var(--active-color)"></i> ${t('pnl.seg.linkedToExisting')} · ${escapeHTML(targetLine)}</span>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="toolbar-btn" onclick="_sharedSegmentNodeOpen('${pid}')"><i class="fas fa-arrow-up-right-from-square"></i> ${t('pnl.seg.open')}</button>
                <button class="toolbar-btn" onclick="_clearSharedSegmentRole('${pid}')"><i class="fas fa-rotate-left"></i> ${t('pnl.seg.undo')}</button>
            </div>
          </div>`
        );
    }

    if(roleKey === 'rackuplink' || roleKey === 'hypervisor'){
        if(compact){
            return `<div class="shared-seg-ignored">
            <span><i class="fas fa-circle-info" style="color:var(--active-color)"></i> ${t('pnl.seg.l2SharedClassified')}</span>
            <button class="toolbar-btn" onclick="_openSharedSegmentProps('${pid}')"><i class="fas fa-sliders"></i> ${t('pnl.seg.manageInProps')}</button>
          </div>`;
        }
        return _sharedSegmentPropsWrapV2(
            `${t('pnl.seg.statusClassified')} · ${escapeHTML(_sharedSegmentRoleLabel(roleKey))}`,
            `<div class="shared-seg-ignored">
            <span><i class="fas fa-check-circle" style="color:var(--active-color)"></i> ${t('pnl.seg.transitPort')} · ${escapeHTML(_sharedSegmentRoleLabel(roleKey))}</span>
            <button class="toolbar-btn" onclick="_clearSharedSegmentRole('${pid}')"><i class="fas fa-rotate-left"></i> ${t('pnl.seg.undo')}</button>
          </div>`
        );
    }

    const isIgnored = !!portState.sharedSegmentIgnored;
    const ignoredHtml = isIgnored
        ? `<div class="shared-seg-ignored">
            ${t('pnl.seg.segmentIgnored')}
            <button class="toolbar-btn" onclick="_restoreSharedSegment('${pid}')"><i class="fas fa-eye"></i> ${t('pnl.seg.showAgain')}</button>
          </div>`
        : '';
    const info = _sharedSegmentInfoForPort(pid, {includeIgnored:isIgnored});
    if(!info) return compact ? ignoredHtml : (ignoredHtml ? _sharedSegmentPropsWrapV2(t('pnl.seg.roleIgnored'), ignoredHtml) : '');
    if(isIgnored) return compact ? ignoredHtml : _sharedSegmentPropsWrapV2(t('pnl.seg.roleIgnored'), ignoredHtml);

    // Compact (popup): solo prime 5 + "+N altri", per non rompere il layout.
    // Full (pannello proprieta): TUTTI i MAC visibili, scroll interno se necessario.
    const _macSlice = compact ? info.macs.slice(0, 5) : info.macs;
    const rows = _macSlice.map(x=>{
        const known = !!x.node;
        const icon = known ? (TYPES[x.node.type]?.icon || 'fa-desktop') : 'fa-question';
        const ip = x.ip ? `<span>${escapeHTML(x.ip)}</span>` : '';
        return `<div class="shared-seg-row">
            <i class="fas ${icon}"></i>
            <div><b>${escapeHTML(x.label)}</b>${ip}</div>
            <code>${escapeHTML(x.mac)}</code>
        </div>`;
    }).join('');
    const more = (compact && info.macs.length > 5)
        ? `<div class="shared-seg-more">${t('pnl.seg.moreMacOnPort',{n:info.macs.length - 5})}</div>`
        : '';
    const roleHtml = info.role ? `<span class="shared-seg-role">${escapeHTML(_sharedSegmentRoleLabel(info.role))}</span>` : '';
    const serverBadge = (info.serverHint && !info.macs.length)
        ? `<div class="shared-seg-server-hint">
               <i class="fas fa-server" style="opacity:.6"></i>
               ${t('pnl.seg.serverHint',{n:info.serverMacCount})}
           </div>`
        : '';
    const macCount = info.macs.length || (info.serverHint ? info.serverMacCount : 0);

    if(compact){
        return `<div class="shared-seg-box">
        <div class="shared-seg-head">
            <span><i class="fas fa-triangle-exclamation"></i> ${t('pnl.seg.l2Shared')}</span>
            <strong>${macCount} MAC</strong>
        </div>
        <div class="shared-seg-desc">
            ${t('pnl.seg.compactDesc')}
            ${roleHtml}
        </div>${serverBadge}
        <div class="shared-seg-actions">
            <button class="toolbar-btn primary" onclick="_openSharedSegmentProps('${pid}')"><i class="fas fa-sliders"></i> ${t('pnl.seg.manageInProps')}</button>
            <button class="toolbar-btn danger" onclick="_ignoreSharedSegment('${pid}')"><i class="fas fa-eye-slash"></i> ${t('pnl.seg.ignore')}</button>
        </div>
    </div>`;
    }

    // ---- UI semplificata: prima il TIPO (chip), poi solo le azioni pertinenti.
    // Le 2 dimensioni (cosa c'e' dietro × cosa farne) erano appiattite in 10
    // tasti; ora chip-tipo + azioni contestuali (mostra/nascondi via :has CSS).
    // Smart-default: pre-seleziona il tipo gia' suggerito (o 'switch').
    const _ssSuggest = (info.role === 'ap' || info.role === 'gateway' || info.role === 'hypervisor')
        ? info.role : (info.role === 'rackuplink' ? 'uplink' : 'switch');
    const _ssChip = (type, icon, label) =>
        `<input type="radio" name="ss-${pid}" id="ss-${pid}-${type}" value="${type}" class="ss-radio"${_ssSuggest===type?' checked':''}>`
      + `<label for="ss-${pid}-${type}" class="ss-chip"><i class="fas ${icon}"></i> ${label}</label>`;
    const _ssRouting = `<div class="ss-routing">
        <div class="ss-q">${t('pnl.seg.whatBehindPort')}</div>
        <div class="ss-chips">
            ${_ssChip('switch','fa-network-wired','Switch')}
            ${_ssChip('ap','fa-wifi','Access point')}
            ${_ssChip('gateway','fa-route','Gateway')}
            ${_ssChip('hypervisor','fa-cubes','Hypervisor')}
            ${_ssChip('uplink','fa-arrow-up',t('pnl.seg.chipUplinkTransit'))}
        </div>
        <div class="ss-acts">
            <div class="ss-act" data-for="switch">
                <button class="toolbar-btn primary" onclick="_createSharedSegmentNode('${pid}','switch')"><i class="fas fa-plus"></i> ${t('pnl.seg.createSwitch')}</button>
                <button class="toolbar-btn" onclick="_openSharedSegmentBind('${pid}','switch')"><i class="fas fa-link"></i> ${t('pnl.seg.linkToExisting')}</button>
            </div>
            <div class="ss-act" data-for="ap">
                <button class="toolbar-btn primary" onclick="_createSharedSegmentNode('${pid}','ap')"><i class="fas fa-plus"></i> ${t('pnl.seg.createAp')}</button>
                <button class="toolbar-btn" onclick="_openSharedSegmentBind('${pid}','ap')"><i class="fas fa-link"></i> ${t('pnl.seg.linkToExisting')}</button>
            </div>
            <div class="ss-act" data-for="gateway">
                <button class="toolbar-btn primary" onclick="_createSharedSegmentNode('${pid}','gateway')"><i class="fas fa-plus"></i> ${t('pnl.seg.createGateway')}</button>
                <button class="toolbar-btn" onclick="_openSharedSegmentBind('${pid}','gateway')"><i class="fas fa-link"></i> ${t('pnl.seg.linkToExisting')}</button>
            </div>
            <div class="ss-act" data-for="hypervisor">
                <button class="toolbar-btn primary" onclick="_openSharedSegmentBind('${pid}','hypervisor')"><i class="fas fa-link"></i> ${t('pnl.seg.linkToHypervisor')}</button>
                <button class="toolbar-btn" onclick="_markSharedSegmentRole('${pid}','hypervisor')"><i class="fas fa-arrow-up"></i> ${t('pnl.seg.markAsTransit')}</button>
            </div>
            <div class="ss-act" data-for="uplink">
                <button class="toolbar-btn primary" onclick="_markSharedSegmentRole('${pid}','rackuplink')"><i class="fas fa-arrow-up"></i> ${t('pnl.seg.markPortAsTransit')}</button>
            </div>
            <button class="toolbar-btn danger ss-ignore-act" onclick="_ignoreSharedSegment('${pid}')"><i class="fas fa-eye-slash"></i> ${t('pnl.seg.ignoreSegment')}</button>
        </div>
    </div>`;
    return _sharedSegmentPropsWrapV2(
        `${macCount} MAC${info.role?` · ${escapeHTML(_sharedSegmentRoleLabel(info.role))}`:''}`,
        `<div class="shared-seg-box" style="margin-top:0">
        <div class="shared-seg-desc">
            ${t('pnl.seg.fullDesc')}
            ${roleHtml}
        </div>${serverBadge}
        <div class="shared-seg-list" style="max-height:280px">${rows}${more}</div>
        ${_ssRouting}
    </div>`
    );
}

function _findFreeFloorSpot(){
    const fp = document.getElementById('floorplan');
    const r = fp ? fp.getBoundingClientRect() : {width:1200,height:800};
    const x = (-store.state.floorView.x + r.width * 0.45) / (store.state.floorView.zoom || 1);
    const y = (-store.state.floorView.y + r.height * 0.45) / (store.state.floorView.zoom || 1);
    return { x:Math.round(x/20)*20, y:Math.round(y/20)*20 };
}

function _connectPortsSafe(src, dst, meta={}){
    if(!src || !dst) return false;
    const exists = store.state.links.some(l=>_linkHasPair(l, src, dst));
    if(exists) return false;
    store.state.links.push(typeof _createLinkRecord === 'function'
        ? _createLinkRecord(src, dst, meta)
        : { id:uid('l'), src, dst, ...meta });
    if(!store.state.ports[src]) store.state.ports[src] = {};
    if(!store.state.ports[dst]) store.state.ports[dst] = {};
    store.state.ports[src].status = store.state.ports[src].status || 'active';
    store.state.ports[dst].status = store.state.ports[dst].status || 'active';
    return true;
}

function _markSharedSegmentRole(pid, role){
    const info = _sharedSegmentInfoForPort(pid, {includeIgnored:true});
    if(!info) return;
    pushHistory();
    if(!store.state.ports[pid]) store.state.ports[pid] = {};
    store.state.ports[pid].sharedSegmentRole = role;
    delete store.state.ports[pid].sharedSegmentNodeId;
    delete store.state.ports[pid].sharedSegmentIgnored;
    if(!store.state.ports[pid].desc){
        store.state.ports[pid].desc = _sharedSegmentRoleLabel(role);
    }
    markDirty(); renderAll(); renderProps();
    if(store._lastPopPid===pid && document.getElementById('popup').style.display!=='none'){
        showPop({clientX:store._lastPopX, clientY:store._lastPopY}, pid);
    }
    _showToast(t('msg.rack.portClassified',{role:_sharedSegmentRoleLabel(role)}), 'ok');
}

function _ignoreSharedSegment(pid){
    pushHistory();
    if(!store.state.ports[pid]) store.state.ports[pid] = {};
    store.state.ports[pid].sharedSegmentIgnored = true;
    delete store.state.ports[pid].sharedSegmentRole;
    delete store.state.ports[pid].sharedSegmentNodeId;
    markDirty(); renderProps();
    if(store._lastPopPid===pid && document.getElementById('popup').style.display!=='none'){
        showPop({clientX:store._lastPopX, clientY:store._lastPopY}, pid);
    }
}

function _restoreSharedSegment(pid){
    pushHistory();
    if(store.state.ports[pid]) delete store.state.ports[pid].sharedSegmentIgnored;
    markDirty(); renderProps();
    if(store._lastPopPid===pid && document.getElementById('popup').style.display!=='none'){
        showPop({clientX:store._lastPopX, clientY:store._lastPopY}, pid);
    }
}

// Annulla una classificazione annotativa (uplink/hypervisor): cancella l'unico
// campo sharedSegmentRole -> l'effetto derivato su topologia/auto-link sparisce
// automaticamente. Rimuove la desc solo se era quella automatica del ruolo.
function _clearSharedSegmentRole(pid){
    pushHistory();
    const p = store.state.ports[pid];
    if(p){
        const lbl = _sharedSegmentRoleLabel(p.sharedSegmentRole);
        delete p.sharedSegmentRole;
        delete p.sharedSegmentNodeId;
        if(p.desc === lbl) delete p.desc;
    }
    markDirty(); renderAll(); renderProps();
    if(store._lastPopPid===pid && document.getElementById('popup').style.display!=='none'){
        showPop({clientX:store._lastPopX, clientY:store._lastPopY}, pid);
    }
}

function _createSharedSegmentNode(pid, role){
    const info = _sharedSegmentInfoForPort(pid, {includeIgnored:true});
    if(!info) return;
    const existingManual = _linksForPort(pid).some(l=>!l.autoLinked);
    if(existingManual){
        _showToast(t('msg.rack.portHasManualLink'), 'warn', 4500);
        return;
    }

    pushHistory();
    if(!store.state.ports[pid]) store.state.ports[pid] = {};
    store.state.ports[pid].sharedSegmentRole = role;
    delete store.state.ports[pid].sharedSegmentIgnored;

    // Rimuove solo vecchi auto-link FDB/ARP diretti dalla porta ambigua
    // (inclusa la variante cross-checked 'MAC+ARP': resta un'inferenza).
    store.state.links = store.state.links.filter(l => {
        const touchesPort = l.src === pid || l.dst === pid;
        return !(touchesPort && l.autoLinked && (l.protocol === 'MAC' || l.protocol === 'ARP-MAC' || l.protocol === 'MAC+ARP'));
    });

    const used = new Set((store.state.nodes || []).map(n=>String(n.id || '')));
    const epCount = info.endpoints.length;
    let n = null;
    if(role === 'ap'){
        const pos = _findFreeFloorSpot();
        const c = store.state.nodes.filter(x=>x.type==='ap').length + 1;
        n = { id:_nextNodeId('ap', used), type:'ap', name:`AP-${String(c).padStart(2,'0')}`, ports:1, x:pos.x, y:pos.y, notes:_sharedSegmentNotes(info, role) };
    } else {
        const type = role === 'gateway' ? 'router' : role === 'hypervisor' ? 'server' : 'switch';
        const def = TYPES[type];
        let rackId = store.state.currentRack;
        if(!rackId || !store.state.racks.some(r=>r.id===rackId)){
            rackId = uid('rack');
            store.state.racks.push({id:rackId, name:'Rack Segmenti', sizeU:42});
            store.state.currentRack = rackId;
        }
        const ports = role === 'switch'
            ? Math.min(48, Math.max(8, epCount + 1))
            : Math.max(def.ports || 1, 1);
        n = {
            id:_nextNodeId(type, used),
            type,
            name: role === 'switch' ? `Switch unmanaged ${info.ifName}` : _sharedSegmentRoleLabel(role),
            brand: role === 'switch' ? 'Unmanaged' : def.brand,
            ports,
            sizeU:def.sizeU || 1,
            rackId,
            rackU:_findFreeU(rackId, def.sizeU || 1),
            notes:_sharedSegmentNotes(info, role)
        };
    }

    store.state.nodes.push(n);
    // Garantisce che il nuovo apparato non si sovrapponga ad altri nel rack
    // (il fallback di _findFreeU su rack pieno potrebbe restituire una U occupata).
    if(TYPES[n.type]?.isRack) win._resolveRackOverlap(n);
    _connectPortsSafe(pid, `${n.id}-1`, {autoLinked:true, confidence:0.7, protocol:'FDB-SEGMENT'});

    if(role === 'switch'){
        let idx = 2;
        for(const item of info.endpoints){
            const ep = item.node;
            if(!ep || !_isLeafEndpoint(ep.type)) continue;
            const epPid = `${ep.id}-1`;
            const existing = store.state.links.find(l=>_linkTouchesPort(l, epPid));
            if(existing && !existing.autoLinked) continue;
            if(existing && existing.autoLinked) store.state.links = store.state.links.filter(l=>l!==existing);
            if(idx <= n.ports){
                _connectPortsSafe(`${n.id}-${idx}`, epPid, {autoLinked:true, confidence:0.7, protocol:'FDB-SEGMENT'});
                idx++;
            }
        }
    }

    store.state.ports[pid].sharedSegmentNodeId = n.id;
    store.selType = 'node'; store.selId = n.id;
    markDirty(); renderAll(); renderCables(); renderProps();
    if(TYPES[n.type]?.isFloor) focusNode(n);
    closePop();
    _showToast(t('msg.rack.intermediateCreated',{role:_sharedSegmentRoleLabel(role)}), 'ok', 4200);
}

expose({
    _macRowsForPort, _sharedSegmentInfoForPort, _sharedSegmentRoleLabel,
    _sharedExistingRoleLabel, _sharedSegmentResolvedLink, _sharedSegmentNodeOpen,
    _sharedSegmentNodeMatchesRole, _sharedSegmentNodeRoleScore, _sharedSegmentNodeLocation,
    _sharedSegmentPortHintScore, _sharedSegmentPortChoices, _closeSharedSegmentBind,
    _backSharedSegmentBind, _renderSharedSegmentBind, _openSharedSegmentBind,
    _selectSharedSegmentBindNode, _confirmSharedSegmentBind, _sharedSegmentNotes,
    _sharedSegmentPropsWrapV2, _openSharedSegmentProps, _sharedSegmentHtml,
    _findFreeFloorSpot, _connectPortsSafe, _markSharedSegmentRole, _ignoreSharedSegment,
    _restoreSharedSegment, _clearSharedSegmentRole, _createSharedSegmentNode,
});
