// ============================================================
// PROPERTIES PANEL — renderer PORTA (selType===port)
// ============================================================
// MODULO ESM (migrato da lib/app-properties-port.js): foglia del dispatcher
// renderProps() (classic in app-properties.js, che lo chiama via window). Porta
// fisica o, se pid radio, delega a _renderRadioProps (app-wifi, già nel bundle).
// Builder condivisi del core (_buildPropsHeader) e i global legacy (state/TYPES/
// selId/porte/VLAN/LAG/segmento) via win.*; `t` dal ponte.
// ASSE B (ritiro ponte): gli handler inline del pannello passano a data-act/
// data-change/data-blur + event delegation. Le azioni CONDIVISE del dominio porta
// (port-field/port-speed) sono registrate in app-popup.js; qui si registrano solo
// quelle SPECIFICHE del pannello (col tail renderProps() o proprie: mode, trunk,
// lock, voce). NESSUN cambiamento di logica rispetto all'originale.

import { expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, normalizeStatus, hasPortStatus } from './app-util.js';
import { nodeById, getNodeByPortId, getPortNodeId, _isRadioPid, _enableManualValueInProps } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)
import { _effPortVlan, _getLinkTrunk, _parseTrunkVlans, _runActiveAnchor, _voipVoiceVlan, _portEffTrunk,
         setPortMode, setPortTrunkVlans, setNodeVoiceVlan } from './app-vlan-autopoll.js';   // ritiro ponte + ASSE B: funzioni foglia UI/vlan + azioni porta (ex win.*)
import { renderProps, _buildPropsHeader, _propsSectionIsOpen } from './app-properties.js';   // ritiro ponte + ASSE B: dispatcher + builder header (ex win.*)
import { _vlanLabel } from './app-popup.js';   // ritiro ponte: funzioni disc/props/vlan/hv (ex win.*) — carica anche le azioni CONDIVISE port-field/port-speed
import { _floorAccessVlanRow } from './app-properties-node-devices.js';   // ritiro ponte: coda funzioni A (batch 1/2) (ex win.*)
import { getPassivePortLagInfo, clearPortField, removePortFromLag, togglePortVlanLock } from './app-ports.js';   // ritiro ponte + ASSE B: fn del dominio porta (ex win.*)
import { registerClickActions, registerChangeActions, registerBlurActions } from './app-delegation.js';   // ASSE B: handler del pannello PORTA via event delegation (ex on* inline)
import { _renderRadioProps } from './app-wifi.js';   // ritiro ponte: coda funzioni A (batch 2/2) (ex win.*)
import { _sharedSegmentHtml } from './app-shared-segment.js';   // ritiro ponte: coda funzioni A (batch 2/2) (ex win.*)
import { normalizePduOutletCount, outletStatusText, pduOutletStatusState, pduOutletConnection } from '../lib/pdu-layout.js';
import { pduConnectionDeviceSelect } from './app-pdu-connection.js';

// ASSE B (ritiro ponte): azioni delegate SPECIFICHE del pannello Proprieta' PORTA.
// I campi stato/descrizione/velocita'/VLAN usano le azioni CONDIVISE port-field/
// port-speed (registrate in app-popup.js, che questo modulo importa → registrazione
// gia' eseguita). Qui solo quelle col tail renderProps() dopo la mutazione (il
// bottone/pannello va ri-reso) o proprie del pannello. pid in data-pid, campo in
// data-pfield, modo in data-mode, nodo VoIP in data-nid.
registerClickActions({
    'port-clear-render':      (el) => { clearPortField(el.dataset.pid, el.dataset.pfield); renderProps(); },
    'port-lag-remove-render': (el) => { removePortFromLag(el.dataset.pid); renderProps(); },
    'port-vlan-lock':         (el) => togglePortVlanLock(el.dataset.pid),
    'port-mode':              (el) => setPortMode(el.dataset.pid, el.dataset.mode),
});
registerChangeActions({
    'port-trunk-vlans': (el) => setPortTrunkVlans(el.dataset.pid, el.value),
    'node-voice-vlan':  (el) => setNodeVoiceVlan(el.dataset.nid, el.value),
});
registerBlurActions({
    'port-trunk-vlans': (el) => setPortTrunkVlans(el.dataset.pid, el.value),
});

// Stato/velocità sono proprietà del LINK: uguali ai due capi (negoziati end-to-end).
// Una porta senza dati propri (endpoint floor, passivo) li EREDITA dalla porta
// ATTIVA a monte (lo switch) della tratta, attraversando gli eventuali passanti.
function _pduOutletSelectionParts(selection){
    const raw = String(selection || '');
    const cut = raw.indexOf('::');
    if(cut <= 0) return null;
    const nodeId = raw.slice(0, cut);
    const key = raw.slice(cut + 2);
    return nodeId && key ? { nodeId, key } : null;
}

function _pduOutletSource(node){
    if(!node) return [];
    if(Array.isArray(node.powerOutlets)) return node.powerOutlets;
    if(Array.isArray(node.spec?.powerOutlets)) return node.spec.powerOutlets;
    if(Array.isArray(node.pduOutlets)) return node.pduOutlets;
    if(Array.isArray(node.spec?.pduOutlets)) return node.spec.pduOutlets;
    return [];
}

function _pduOutletEntry(selection, create=false){
    const parts = _pduOutletSelectionParts(selection);
    if(!parts) return null;
    const node = nodeById(parts.nodeId);
    if(!node || node.type !== 'pdu') return null;
    const source = _pduOutletSource(node);
    let index = source.findIndex((outlet, i) => String(outlet?.id ?? outlet?.name ?? i + 1) === parts.key);
    if(index < 0 && /^\d+$/.test(parts.key)) index = Number(parts.key) - 1;
    const count = normalizePduOutletCount(node.pduOutletCount ?? node.spec?.pduOutletCount ?? (source.length || 8));
    if(index < 0 || index >= count) return null;
    if(!create) return { node, outlet: source[index] || {}, index };

    if(!Array.isArray(node.powerOutlets)){
        node.powerOutlets = source.map(outlet => ({ ...(outlet || {}) }));
    }
    while(node.powerOutlets.length <= index){
        node.powerOutlets.push({ name:`P${node.powerOutlets.length + 1}` });
    }
    if(!node.powerOutlets[index] || typeof node.powerOutlets[index] !== 'object'){
        node.powerOutlets[index] = { name:`P${index + 1}` };
    }
    return { node, outlet: node.powerOutlets[index], index };
}

function _pduOutletLabel(outlet, index){
    return String(outlet?.label || outlet?.name || outlet?.display || `P${index + 1}`);
}

export function _renderPduOutletProps(panel){
    const entry = _pduOutletEntry(store.selId, false);
    if(!entry){
        panel.innerHTML = `<div class="pdu-port-model-note"><i class="fas fa-circle-exclamation"></i> ${t('pduOutlet.notFound')}</div>`;
        return;
    }
    const { node, outlet, index } = entry;
    const label = _pduOutletLabel(outlet, index);
    const status = pduOutletStatusState(outlet);
    const importedStatus = outletStatusText(outlet);
    const manualStatus = outlet.statusOvr != null && String(outlet.statusOvr).trim() !== '';
    const statusSourceClass = manualStatus ? 'manual' : (importedStatus ? 'netbox' : 'empty');
    const statusSourceLabel = manualStatus ? t('pdu.manual') : (importedStatus ? t('pdu.netbox') : t('pdu.notSet'));
    const statusReset = manualStatus
        ? `<button class="pdu-outlet-status-reset" type="button" data-act="pdu-outlet-status-reset" data-nid="${escapeHTML(node.id)}" data-pindex="${index}" title="${escapeHTML(t('pduOutlet.reset'))}" aria-label="${escapeHTML(t('pduOutlet.reset'))}"><i class="fas fa-rotate-left"></i></button>`
        : '';
    const connection = pduOutletConnection(outlet);
    const connectionSourceClass = connection.manual ? 'manual' : (connection.imported ? 'netbox' : 'empty');
    const connectionSourceLabel = connection.manual ? t('pdu.manual') : (connection.imported ? t('pdu.netbox') : t('pdu.notSet'));
    const connectionReset = connection.manual
        ? `<button class="pdu-connection-reset" type="button" data-act="pdu-connection-reset" data-nid="${escapeHTML(node.id)}" data-pindex="${index}" title="${escapeHTML(t('pdu.resetConnection'))}" aria-label="${escapeHTML(t('pdu.resetConnection'))}"><i class="fas fa-rotate-left"></i></button>`
        : '';
    const technical = [
        outlet.type ? `Tipo: ${outlet.type}` : '',
        outlet.feedLeg ? `Feed: ${outlet.feedLeg}` : '',
        outlet.powerPort ? `Power port: ${outlet.powerPort}` : '',
    ].filter(Boolean).join(' · ');
    const connectionHtml = `<details class="props-collapsible props-secondary pdu-outlet-connection-section" ${_propsSectionIsOpen('pdu-outlet-connection')?'open':''} data-toggle="props-section" data-section="pdu-outlet-connection">
        <summary class="props-collapsible-head"><span><i class="fas fa-bolt"></i> ${escapeHTML(t('pduOutlet.connection'))}</span><span class="pdu-connection-source ${connectionSourceClass}">${escapeHTML(connectionSourceLabel)}</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
        <div class="props-collapsible-body"><div>
            <div class="pdu-connection-hint"><i class="fas fa-circle-info"></i> ${escapeHTML(t('pduOutlet.connectionHint'))}</div>
            <div class="prop-row2 pdu-outlet-connection-fields">
                <div class="prop-group pdu-outlet-connection-field"><label>${escapeHTML(t('pduOutlet.connectedDevice'))}</label>${pduConnectionDeviceSelect({ nodeId:node.id, index, connection })}</div>
                <div class="prop-group pdu-outlet-connection-field"><label>${escapeHTML(t('pdu.connectionPort'))}</label><input class="${connection.manualPort ? 'ovr' : ''}" value="${escapeHTML(connection.portName)}" placeholder="${escapeHTML(t('pdu.notSet'))}" data-change="pdu-connection-field" data-nid="${escapeHTML(node.id)}" data-pindex="${index}" data-pfield="portName"></div>
            </div>
            ${connectionReset ? `<div class="pdu-outlet-connection-footer">${connectionReset}<span>${escapeHTML(t('pdu.resetConnection'))}</span></div>` : ''}
        </div></div>
    </details>`;
    panel.innerHTML = `
        ${_buildPropsHeader(
            `${node.name || node.hostname || node.id} — ${label}`,
            `${t('dev.pdu')} · ${t('pduOutlet.title')}`,
            'fa-plug'
        )}
        <div class="prop-group"><label>${t('pduOutlet.identifier')}</label><input disabled value="${escapeHTML(label)}"></div>
        ${connectionHtml}
        ${technical ? `<div class="snmp-bar" style="margin:0 0 10px"><span class="sb">NetBox</span>${escapeHTML(technical)}</div>` : ''}
        <div class="prop-group"><label>${t('common.status')}</label>
            <div class="pdu-outlet-status-editor">
                <select class="${manualStatus ? 'ovr' : ''}" data-change="pdu-outlet-field" data-nid="${escapeHTML(node.id)}" data-pindex="${index}" data-pfield="statusOvr">
                    <option value="inactive" ${status === 'inactive' ? 'selected' : ''}>${escapeHTML(t('port.statusInactive'))}</option>
                    <option value="active" ${status === 'active' ? 'selected' : ''}>${escapeHTML(t('port.statusActive'))}</option>
                    <option value="fault" ${status === 'fault' ? 'selected' : ''}>Fault</option>
                </select>
                ${statusReset}
            </div>
            <div class="pdu-outlet-status-meta"><span class="pdu-connection-source ${statusSourceClass}">${escapeHTML(statusSourceLabel)}</span> · ${t('pduOutlet.importedStatus')}: <strong>${escapeHTML(importedStatus || t('pduOutlet.statusNotDocumented'))}</strong></div>
        </div>
        <div class="pdu-port-model-note"><i class="fas fa-shield-halved"></i> ${t('pduOutlet.manualHint')}</div>
        <div class="pdu-port-model-note"><i class="fas fa-link-slash"></i> ${t('pduOutlet.noNetworkCable')}</div>`;
}

function _portInheritedLinkData(pid){
    if(typeof _runActiveAnchor !== 'function') return {};
    const state = store.state;
    const links = (state.links || []).filter(l => l && (l.src === pid || l.dst === pid));
    for(const l of links){
        const anchor = _runActiveAnchor(l);
        if(anchor && anchor !== pid){
            const ap = state.ports[anchor] || {};
            return { status: ap.statusOvr != null ? ap.statusOvr : ap.status,
                     speed:  ap.speedOvr  != null ? ap.speedOvr  : ap.speed };
        }
    }
    return {};
}

// Proprieta' di una PORTA selezionata (selType==='port').
export function _renderPortProps(panel){
        const state = store.state;
        const pid=store.selId;
        // Interfaccia radio selezionata → pannello dedicato (config per-radio).
        if(typeof _isRadioPid==='function' && _isRadioPid(pid) && typeof _renderRadioProps==='function'){
            return _renderRadioProps(panel, pid);
        }
        const pi=state.ports[pid]||{};
        const portNode=getNodeByPortId(pid);
        // Coupler L1 PASSIVO (presa a muro, patch panel, media converter): velocità
        // e VLAN non sono suoi — li determina lo switch a monte e si propagano, quindi
        // quei campi restano fuori.
        // Lo STATO invece SI', ed è editabile: su una tappa passiva «attiva» non vuol
        // dire link-up, vuol dire OCCUPATA DA UN CAVO, che è un fatto del pannello e
        // non dello switch. Lo scrive già da sé chi collega (app-pointer.js,
        // app-cabling-editor.js `_markPortActive`) e lo cancella chi scollega; il campo
        // serve per i casi che l'app non può vedere — una bretella posata ma non
        // documentata, una porta rotta. Nasconderlo lasciava una porta col cavo dentro
        // indistinguibile da una libera, senza modo di correggerla (paletto ①).
        const _passiveConduit = !!(portNode && TYPES[portNode.type] && TYPES[portNode.type].isPassive && TYPES[portNode.type].passThrough);
        // Device FLOOR con IP non-attivo (PC, stampante, IoT, AP, webcam, TV, VoIP…):
        // consumer/tagger di rete. La VLAN la determina lo SWITCH a monte (access
        // propagata) o gli SSID/voce (trunk sull'uplink); stato/velocità arrivano dal
        // lato switch. Quindi qui sono in SOLA LETTURA. Include il VoIP (passThrough
        // tagger: uplink trunk voce+dati) — la sua porta mostra il trunk, non una
        // VLAN singola editabile.
        const _floorLeaf = !!(portNode && TYPES[portNode.type] && TYPES[portNode.type].isFloor
            && TYPES[portNode.type].hasIP && !TYPES[portNode.type].isActive);
        const _roBox = inner => `<div style="padding:5px 7px;background:var(--bg-color);border:1px solid var(--panel-border);border-radius:4px;font-size:var(--fs-lg);color:var(--text-main)">${inner}</div>`;
        const _statusLabel = s => ({active:t('port.statusActive'),idle:t('port.statusIdle'),inactive:t('port.statusInactive'),fault:'Fault'}[s] || s);
        // Endpoint floor: stato/velocità EREDITATI dalla porta switch a monte (sono
        // proprietà del link). Così un device collegato replica i dati della porta.
        const _inh = _floorLeaf ? _portInheritedLinkData(pid) : {};
        // normalizeStatus(undefined) ritorna 'inactive': quindi NON si può usare ?? a
        // valle. Scegliamo prima il valore GREZZO (proprio se presente, altrimenti
        // ereditato dallo switch), poi normalizziamo.
        const _rawStatus = (pi.statusOvr != null) ? pi.statusOvr
                         : (pi.status != null && pi.status !== '') ? pi.status
                         : _inh.status;
        // Endpoint: se nessuno dei tre (proprio dichiarato · proprio misurato ·
        // ereditato dallo switch) dice qualcosa, lo stato è IGNOTO — e un riquadro
        // in sola lettura che dice «Inattiva» sarebbe un'affermazione inventata.
        const _leafKnown = _rawStatus != null && _rawStatus !== '';
        const _leafStatus = normalizeStatus(_rawStatus);
        const _leafSpeedVal = pi.speedOvr ?? pi.speed ?? _inh.speed ?? null;
        const _leafSpd = _leafSpeedVal!=null ? (_leafSpeedVal>=1000?`${(_leafSpeedVal/1000).toFixed(_leafSpeedVal%1000?1:0)}G`:`${_leafSpeedVal}M`) : '';
        const portNum=pid.split('-').slice(1).join('-');
        const _stKnown=hasPortStatus(pi);
        const effStatus=_stKnown?(pi.statusOvr??normalizeStatus(pi.status)):'';
        const effVlan=_effPortVlan(pid);
        const effSpeed=pi.speedOvr??pi.speed??null;
        const spdDisplay=effSpeed!=null?(effSpeed>=1000?`${(effSpeed/1000).toFixed(effSpeed%1000?1:0)}G`:`${effSpeed}M`):'';
        const spdPh=pi.speed!=null?(pi.speed>=1000?`${(pi.speed/1000).toFixed(pi.speed%1000?1:0)}G`:`${pi.speed}M`):t('pnl.dev.phSpeedEg');
        const snmpParts=[];
        if(pi.ifName) snmpParts.push(pi.ifName);
        if(pi.alias&&pi.alias!==pi.ifName) snmpParts.push(pi.alias);
        if(pi.speed) snmpParts.push(pi.speed>=1000?`${(pi.speed/1000).toFixed(pi.speed%1000?1:0)}G`:`${pi.speed}M`);
        if(pi.vlan&&pi.vlan>1) snmpParts.push(`VLAN ${_vlanLabel(pi.vlan)}`);
        if(pi.lagId&&pi.lagId>0) snmpParts.push(`LAG ${pi.lagId}`);
        const snmpBar=snmpParts.length?`<div class="snmp-bar" style="margin:0 0 10px"><span class="sb">SNMP</span>${escapeHTML(snmpParts.join(' · '))}</div>`:'';
        const rst=(f,lbl)=>pi[f]!=null?`<button class="toolbar-btn" style="padding:2px 6px;margin:0;font-size:0.7rem" data-tip="${t('pnl.dev.restoreField',{field:lbl})}" data-act="port-clear-render" data-pid="${pid}" data-pfield="${f}">↺</button>`:'';
        // Select dello STATO dichiarabile. Una sola definizione, usata sia dallo
        // switchport sia dalla tappa passiva: due copie delle stesse cinque voci
        // divergono al primo che ne aggiunge una.
        const _statusSelect = ()=>`<div style="display:flex;gap:5px">
                  <select class="${pi.statusOvr?'ovr':''} " style="flex:1" data-change="port-field" data-pid="${pid}" data-pfield="statusOvr">
                    <option value=""         ${effStatus===''        ?'selected':''}>${t('port.statusUnknown')}</option>
                    <option value="active"   ${effStatus==='active'  ?'selected':''}>${t('port.statusActive')}</option>
                    <option value="idle"     ${effStatus==='idle'    ?'selected':''}>${t('port.statusIdle')}</option>
                    <option value="inactive" ${effStatus==='inactive'?'selected':''}>${t('port.statusInactive')}</option>
                    <option value="fault"    ${effStatus==='fault'   ?'selected':''}>Fault</option>
                  </select>${rst('statusOvr',t('pnl.dev.fieldStatus'))}
                </div>`;
        // Chip "Membro LAG" (viola, identico al badge del cavo) + chip delle porte
        // del bonding (porta corrente evidenziata), quando la porta e' in LAG.
        const _lagHead = (()=>{
            const gid = pi.lagGroup; if(!gid) return '';
            const gname = escapeHTML(state.lagGroups && state.lagGroups[gid] ? state.lagGroups[gid] : 'LAG');
            const nodeId = getPortNodeId(pid);
            const nn = nodeById(nodeId);
            const pc = nn ? nn.ports || 0 : 0;
            const chips = [];
            for(let i=1;i<=pc;i++){
                const mpid = `${nodeId}-${i}`;
                if((state.ports[mpid]||{}).lagGroup===gid)
                    chips.push(`<span class="lag-chip${mpid===pid?' self':''}">P${i}</span>`);
            }
            // Chip "Membro LAG" + porte del bonding + azione Rimuovi. L'ingresso
            // LAG (aggiungi/rimuovi) vive QUI nel pannello Proprieta': il vecchio
            // popup porta che lo ospitava non viene piu' aperto (click porta ->
            // Proprieta), quindi era rimasto orfano.
            return `<div class="props-lag-head">
                <span style="background:#a371f7;color:#fff;padding:2px 9px;border-radius:4px;font-weight:700;font-size:0.74rem" data-tip="${gname}">${t('pnl.dev.lagMember')}</span>
                <span class="lag-chips">${chips.join('')}</span>
                <button class="toolbar-btn danger" style="padding:3px 9px;font-size:0.72rem" data-act="port-lag-remove-render" data-pid="${pid}">${t('pnl.misc.remove')}</button>
            </div>`;
        })();
        panel.innerHTML=`
            ${_buildPropsHeader(
                (portNode?.name || portNode?.hostname || portNode?.ip || pid),
                t('pnl.dev.portN',{n:portNum}),
                'fa-ethernet'
            )}
            ${_lagHead}
            <div class="prop-group"><label>Port ID</label><input disabled value="${escapeHTML(pid)}"></div>
            ${snmpBar}
            <div class="prop-group"><label>${t('common.description')}</label>
              <input value="${escapeHTML(pi.desc||'')}" placeholder="${escapeHTML(pi.alias||pi.ifName||t('pnl.dev.phDescEg'))}"
                     data-change="port-field" data-pid="${pid}" data-pfield="desc">
            </div>
            ${_passiveConduit ? `<div class="prop-group"><label>${t('common.status')}</label>
              ${_statusSelect()}
              <div style="font-size:0.73rem;color:var(--text-muted);margin-top:4px;padding-left:2px;line-height:1.4">${t('port.passiveStatusHint')}</div>
            </div>` : (_floorLeaf ? `<div class="prop-group"><label>${t('common.status')}</label>
              ${_roBox(_leafKnown ? escapeHTML(_statusLabel(_leafStatus)) : `<span style="color:var(--text-muted)">${t('port.statusUnknown')}</span>`)}
            </div>
            <div class="prop-group"><label>${t('port.speed')}</label>
              ${_roBox(_leafSpd ? escapeHTML(_leafSpd) : '—')}
            </div>` : `<div class="prop-group"><label>${t('common.status')}</label>
              ${_statusSelect()}
            </div>
            <div class="prop-group"><label>${t('port.speed')}</label>
              <div style="display:flex;gap:5px">
                <input value="${escapeHTML(spdDisplay)}" placeholder="${escapeHTML(spdPh)}"
                       class="${pi.speedOvr!=null?'ovr':''}" style="flex:1"
                       data-change="port-speed" data-pid="${pid}" data-tip="${t('pnl.dev.speedTip')}">
                ${rst('speedOvr',t('pnl.dev.fieldSpeed'))}
              </div>
            </div>`)}
            ${_passiveConduit ? '' : (()=>{
                // Endpoint floor: VLAN access in SOLA LETTURA (derivata da _effPortVlan,
                // assegnata dallo switch a monte) — coerente col pannello nodo.
                if(_floorLeaf){
                    // Se la porta è l'uplink di un TAGGER (AP multi-SSID, ecc.) il suo
                    // link è un TRUNK: mostralo (nativa + trasportate) in sola lettura,
                    // invece di una singola VLAN access. La VLAN degli SSID si imposta
                    // sulle radio; la nativa sullo switch a monte.
                    // La porta può avere più link (es. VoIP passThrough: switch trunk
                    // + PC access). Preferisci il link in TRUNK per il display.
                    const _portLinks = (state.links||[]).filter(l => l && (l.src===pid || l.dst===pid));
                    const _lk = (typeof _getLinkTrunk==='function')
                        ? (_portLinks.find(l => _getLinkTrunk(l).mode==='trunk') || _portLinks[0])
                        : _portLinks[0];
                    const _tk = (_lk && typeof _getLinkTrunk==='function') ? _getLinkTrunk(_lk) : null;
                    if(_tk && _tk.mode==='trunk'){
                        const _tg = _tk.vlans.filter(v => v !== _tk.native);
                        const _inner = `<span style="background:#0e2233;border:1px solid #2d6a9f;border-radius:4px;padding:1px 8px;font-weight:700;color:#5ba3f5">TRUNK</span>`
                          + ` <span style="color:var(--text-muted)">${t('cable.trunkNative')}</span> <b>VLAN ${_tk.native}</b>`
                          + (_tg.length ? ` <span style="color:var(--text-muted)">· ${t('cable.trunkCarried')}</span> <b>${_tg.join(', ')}</b>` : '');
                        // VoIP: la VLAN VOCE (taggata) è una proprietà dell'interfaccia → editabile QUI;
                        // la nativa/dati arriva dallo switch a monte (resta nel badge read-only sopra).
                        const _voiceRow = (portNode && portNode.type==='voip') ? (()=>{
                            // Lettura CANONICA (stessa fonte di carriedVlans/propagazione): node.spec.voiceVlan
                            const _vv = (typeof _voipVoiceVlan==='function') ? (_voipVoiceVlan(portNode) || 1)
                                      : ((portNode.voiceVlan!=null) ? portNode.voiceVlan : ((portNode.spec&&portNode.spec.voiceVlan)||1));
                            return `<div class="prop-group" style="margin-top:6px"><label>${t('f.vlanVoice')}</label>
                                <input type="number" min="1" max="4094" value="${_vv}" class="${_vv>1?'ovr':''}" style="flex:1"
                                       data-change="node-voice-vlan" data-nid="${portNode.id}" data-tip="${t('f.vlanVoiceTip')}"></div>`;
                        })() : '';
                        return `<div class="prop-group"><label>VLAN</label>${_roBox(_inner)}</div>${_voiceRow}`;
                    }
                    return `<div class="prop-group"><label>VLAN</label>${(typeof _floorAccessVlanRow==='function')?_floorAccessVlanRow(portNode,pid):_roBox('VLAN '+effVlan)}</div>`;
                }
                // Campo VLAN/nativa editabile (scrive il PVID = vlanOvr). Riutilizzato
                // sia dalle porte passive sia dallo switchport (con label diversa).
                // Onesto: mostra un VALORE solo se la VLAN è DETERMINATA (override
                // manuale, misurata via SNMP, o propagata da monte); altrimenti il
                // campo è vuoto con la nativa di sito come placeholder — non afferma
                // "VLAN 1" su una porta il cui PVID non è mai stato osservato (schema ①).
                const _vlanDet = pi.vlanOvr != null || (pi.vlan >= 1) || pi.vlanProp != null;
                const _vlanField = (label) => `<div class="prop-group"><label>${label}</label>
                    <div style="display:flex;gap:5px">
                      <input type="number" min="1" max="4094" value="${_vlanDet ? effVlan : ''}" placeholder="${effVlan}" class="${pi.vlanOvr!=null?'ovr':''}" style="flex:1"
                             data-change="port-field" data-pid="${pid}" data-pfield="vlanOvr">
                      <button type="button" class="toolbar-btn" style="padding:2px 7px;margin:0;font-size:0.78rem;line-height:1${pi.vlanOvr!=null?';color:var(--accent);border-color:var(--accent)':''}" data-tip="${t(pi.vlanOvr!=null?'lock.locked':'lock.unlocked')}" aria-label="${t(pi.vlanOvr!=null?'lock.locked':'lock.unlocked')}" aria-pressed="${pi.vlanOvr!=null?'true':'false'}" data-act="port-vlan-lock" data-pid="${pid}"><i class="fas fa-lock${pi.vlanOvr!=null?'':'-open'}"></i></button>
                    </div>
                    ${state.vlanNames?.[effVlan]?`<div style="font-size:0.73rem;color:var(--text-muted);margin-top:3px;padding-left:2px"><i class="fas fa-tag" style="font-size:0.65rem;margin-right:4px"></i>${escapeHTML(state.vlanNames[effVlan])}</div>`:''}
                  </div>`;

                // Porta passiva (patch/presa/…): solo il campo VLAN semplice.
                if(!portNode || !TYPES[portNode.type]?.isActive) return _vlanField('VLAN');

                // Switchport (interfaccia ATTIVA): GUI UNIFORME al pannello cavo —
                // badge TRUNK/access · nativa · trasportate → Modalità porta →
                // VLAN nativa (untagged/PVID) → VLAN trasportate. La nativa È il PVID.
                const _isTrunk = (typeof _portEffTrunk==='function') ? _portEffTrunk(pi) : (pi.mode==='trunk');
                const _tvArr   = _parseTrunkVlans(pi.trunkVlans||[]);
                const _tagged  = _tvArr.filter(v=>v!==effVlan);
                const _tvStr   = Array.isArray(pi.trunkVlans) ? pi.trunkVlans.join(',') : (pi.trunkVlans || '');
                const _fromSnmp= _isTrunk && pi.mode!=='trunk' && pi.isTrunk;
                const _color   = state.vlanColors[effVlan] || '#6e7681';
                const _vlanName= state.vlanNames?.[effVlan] ? escapeHTML(state.vlanNames[effVlan]) : '';
                const _badge = _isTrunk
                  ? `<span style="background:#0e2233;border:1px solid #2d6a9f;border-radius:4px;padding:2px 10px;font-size:0.78rem;font-weight:700;color:#5ba3f5">TRUNK</span>
                     <span style="margin-left:6px;font-size:0.75rem;color:var(--text-muted)">${t('cable.trunkNative')}&nbsp;<b style="color:var(--text-main)">VLAN ${effVlan}</b></span>
                     ${_tagged.length?`<span style="margin-left:6px;font-size:0.75rem;color:var(--text-muted)">· ${t('cable.trunkCarried')}&nbsp;<b style="color:var(--text-main)">${_tagged.join(', ')}</b></span>`:''}
                     ${_fromSnmp?`<span style="margin-left:6px;font-size:0.68rem;color:#5ba3f5"><i class="fas fa-satellite-dish"></i> SNMP</span>`:''}`
                  : `<span style="display:inline-flex;align-items:center;gap:6px">
                       <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${_color};flex-shrink:0;border:1px solid rgba(255,255,255,.18)"></span>
                       <b>VLAN ${effVlan}</b>${_vlanName?`<span style="color:var(--text-muted)">— ${_vlanName}</span>`:''}
                     </span>`;
                return `
                  <div class="prop-group" style="margin-top:6px"><label>VLAN</label>
                    <div style="padding:4px 0;font-size:0.83rem;color:var(--text-main)">${_badge}</div>
                  </div>
                  <div class="prop-group" style="margin-top:8px;border-top:1px solid var(--panel-border);padding-top:8px">
                    <label>${t('cable.portMode')}</label>
                    <div style="display:flex;gap:6px;margin-top:4px">
                      <button class="toolbar-btn${!_isTrunk?' soft':''}" style="flex:1;padding:5px" data-act="port-mode" data-pid="${pid}" data-mode="access"><i class="fas fa-circle" style="font-size:0.6rem"></i> Access</button>
                      <button class="toolbar-btn${_isTrunk?' soft':''}" style="flex:1;padding:5px" data-act="port-mode" data-pid="${pid}" data-mode="trunk"><i class="fas fa-layer-group" style="font-size:0.7rem"></i> Trunk</button>
                    </div>
                  </div>
                  ${_vlanField(_isTrunk ? t('cable.trunkNativeLabel') : 'VLAN')}
                  ${_isTrunk?`<div class="prop-group">
                    <label style="display:flex;align-items:center;gap:5px">${t('cable.trunkVlans')}
                      <span style="font-size:0.68rem;color:var(--text-muted)">${t('pnl.dev.egVlanRange')}</span></label>
                    <input type="text" value="${escapeHTML(_tvStr)}" placeholder="1,10,20,100"
                           style="width:100%;font-family:monospace;font-size:0.82rem"
                           data-change="port-trunk-vlans" data-pid="${pid}" data-blur="port-trunk-vlans">
                    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:3px">
                      ${_fromSnmp?`<span style="color:#5ba3f5"><i class="fas fa-satellite-dish" style="font-size:0.6rem;margin-right:3px"></i>SNMP</span> · `:''}${t('cable.vlansConfigured',{n:_tvArr.length})} · ${t('port.trunkPropNote')}
                    </div>
                  </div>`:''}`;
            })()}
            ${(()=>{
                const portNode2=getNodeByPortId(pid);
                // Switchport ATTIVO non ancora in un LAG: ingresso per crearlo /
                // aggiungersi a uno (ex pulsante del popup porta, ora orfano). Se
                // e' gia' in LAG, membership + Rimuovi sono nell'header (_lagHead).
                if(portNode2&&TYPES[portNode2.type]?.isActive){
                    if((state.ports[pid]||{}).lagGroup) return '';
                    return `<div style="border-top:1px solid var(--panel-border);margin-top:8px;padding-top:8px">
                  <button class="toolbar-btn" style="width:100%;padding:6px;font-size:0.8rem" data-act="port-lag-add" data-pid="${pid}">⛓ ${t('pnl.misc.addToLag')}</button>
                </div>`;
                }
                // Dispositivo passivo: info LAG traversal se presente.
                const info=getPassivePortLagInfo(pid);
                if(!info) return '';
                return `<div style="border-top:1px solid var(--panel-border);margin-top:8px;padding-top:7px;font-size:0.72rem;color:var(--text-muted)">
                  <span style="color:var(--accent);margin-right:5px">🔗</span>
                  ${t('pnl.dev.path')} <strong style="color:var(--accent)">${escapeHTML(info.gname)}</strong> · ${escapeHTML(info.nodeName)}
                </div>`;
            })()}`;
        // I MAC visti sulla porta vengono ora elencati interamente dentro il
        // blocco "Segmento L2 condiviso" (non piu' duplicati in due box adiacenti).
        panel.innerHTML += _sharedSegmentHtml(pid,'props');
        _enableManualValueInProps(panel);
}

// Chiamato dal dispatcher renderProps() (app-properties.js, classic);
// _portInheritedLinkData è esercitato direttamente dallo smoke.
expose({ _renderPortProps, _portInheritedLinkData });
