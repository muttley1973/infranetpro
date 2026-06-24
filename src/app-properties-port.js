// ============================================================
// PROPERTIES PANEL — renderer PORTA (selType===port)
// ============================================================
// MODULO ESM (migrato da lib/app-properties-port.js): foglia del dispatcher
// renderProps() (classic in app-properties.js, che lo chiama via window). Porta
// fisica o, se pid radio, delega a win._renderRadioProps (app-wifi, già nel bundle).
// Builder condivisi del core (_buildPropsHeader) e i global legacy (state/TYPES/
// selId/porte/VLAN/LAG/segmento) via win.*; `t` dal ponte. I nomi dentro gli
// onclick=""/onchange="" dell'HTML generato girano in scope PAGINA → restano bare.
// NESSUN cambiamento di logica rispetto all'originale.

import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, normalizeStatus } from './app-util.js';
import { nodeById, getNodeByPortId, getPortNodeId } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)
// NB: renderProps() qui è chiamato SOLO da un onclick="" (bare-in-template, scope
// pagina → window.renderProps via expose): nessun import ESM, sarebbe inutilizzato.

// Stato/velocità sono proprietà del LINK: uguali ai due capi (negoziati end-to-end).
// Una porta senza dati propri (endpoint floor, passivo) li EREDITA dalla porta
// ATTIVA a monte (lo switch) della tratta, attraversando gli eventuali passanti.
function _portInheritedLinkData(pid){
    if(typeof win._runActiveAnchor !== 'function') return {};
    const state = store.state;
    const links = (state.links || []).filter(l => l && (l.src === pid || l.dst === pid));
    for(const l of links){
        const anchor = win._runActiveAnchor(l);
        if(anchor && anchor !== pid){
            const ap = state.ports[anchor] || {};
            return { status: ap.statusOvr != null ? ap.statusOvr : ap.status,
                     speed:  ap.speedOvr  != null ? ap.speedOvr  : ap.speed };
        }
    }
    return {};
}

// Proprieta' di una PORTA selezionata (selType==='port').
function _renderPortProps(panel){
        const state = store.state;
        const pid=store.selId;
        // Interfaccia radio selezionata → pannello dedicato (config per-radio).
        if(typeof win._isRadioPid==='function' && win._isRadioPid(pid) && typeof win._renderRadioProps==='function'){
            return win._renderRadioProps(panel, pid);
        }
        const pi=state.ports[pid]||{};
        const portNode=getNodeByPortId(pid);
        // Coupler L1 PASSIVO (presa a muro, patch panel, media converter): non ha
        // stato/velocità/VLAN propri — sono determinati dallo switch a monte e
        // propagati. Per non confondere, su questi NON si mostrano quei campi.
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
        const _leafStatus = normalizeStatus(_rawStatus);
        const _leafSpeedVal = pi.speedOvr ?? pi.speed ?? _inh.speed ?? null;
        const _leafSpd = _leafSpeedVal!=null ? (_leafSpeedVal>=1000?`${(_leafSpeedVal/1000).toFixed(_leafSpeedVal%1000?1:0)}G`:`${_leafSpeedVal}M`) : '';
        const portNum=pid.split('-').slice(1).join('-');
        const effStatus=pi.statusOvr??normalizeStatus(pi.status)??'inactive';
        const effVlan=win._effPortVlan(pid);
        const effSpeed=pi.speedOvr??pi.speed??null;
        const spdDisplay=effSpeed!=null?(effSpeed>=1000?`${(effSpeed/1000).toFixed(effSpeed%1000?1:0)}G`:`${effSpeed}M`):'';
        const spdPh=pi.speed!=null?(pi.speed>=1000?`${(pi.speed/1000).toFixed(pi.speed%1000?1:0)}G`:`${pi.speed}M`):t('pnl.dev.phSpeedEg');
        const snmpParts=[];
        if(pi.ifName) snmpParts.push(pi.ifName);
        if(pi.alias&&pi.alias!==pi.ifName) snmpParts.push(pi.alias);
        if(pi.speed) snmpParts.push(pi.speed>=1000?`${(pi.speed/1000).toFixed(pi.speed%1000?1:0)}G`:`${pi.speed}M`);
        if(pi.vlan&&pi.vlan>1) snmpParts.push(`VLAN ${win._vlanLabel(pi.vlan)}`);
        if(pi.lagId&&pi.lagId>0) snmpParts.push(`LAG ${pi.lagId}`);
        const snmpBar=snmpParts.length?`<div class="snmp-bar" style="margin:0 0 10px"><span class="sb">SNMP</span>${escapeHTML(snmpParts.join(' · '))}</div>`:'';
        const rst=(f,lbl)=>pi[f]!=null?`<button class="toolbar-btn" style="padding:2px 6px;margin:0;font-size:0.7rem" data-tip="${t('pnl.dev.restoreField',{field:lbl})}" onclick="clearPortField('${pid}','${f}');renderProps()">↺</button>`:'';
        // Chip "Membro LAG" (viola, identico al badge del cavo) + chip delle porte
        // del bonding (porta corrente evidenziata), quando la porta e' in LAG.
        const _lagHead = (()=>{
            const gid = pi.lagGroup; if(!gid) return '';
            const nodeId = getPortNodeId(pid);
            const nn = nodeById(nodeId);
            const pc = nn ? nn.ports || 0 : 0;
            const chips = [];
            for(let i=1;i<=pc;i++){
                const mpid = `${nodeId}-${i}`;
                if((state.ports[mpid]||{}).lagGroup===gid)
                    chips.push(`<span class="lag-chip${mpid===pid?' self':''}">P${i}</span>`);
            }
            return `<div class="props-lag-head">
                <span style="background:#a371f7;color:#fff;padding:2px 9px;border-radius:4px;font-weight:700;font-size:0.74rem">${t('pnl.dev.lagMember')}</span>
                <span class="lag-chips">${chips.join('')}</span>
            </div>`;
        })();
        panel.innerHTML=`
            ${win._buildPropsHeader(
                (portNode?.name || portNode?.hostname || portNode?.ip || pid),
                t('pnl.dev.portN',{n:portNum}),
                'fa-ethernet'
            )}
            ${_lagHead}
            <div class="prop-group"><label>Port ID</label><input disabled value="${escapeHTML(pid)}"></div>
            ${snmpBar}
            <div class="prop-group"><label>${t('common.description')}</label>
              <input value="${escapeHTML(pi.desc||'')}" placeholder="${escapeHTML(pi.alias||pi.ifName||t('pnl.dev.phDescEg'))}"
                     onchange="setPortField('${pid}','desc',this.value)">
            </div>
            ${_passiveConduit ? '' : (_floorLeaf ? `<div class="prop-group"><label>${t('common.status')}</label>
              ${_roBox(escapeHTML(_statusLabel(_leafStatus)))}
            </div>
            <div class="prop-group"><label>${t('port.speed')}</label>
              ${_roBox(_leafSpd ? escapeHTML(_leafSpd) : '—')}
            </div>` : `<div class="prop-group"><label>${t('common.status')}</label>
              <div style="display:flex;gap:5px">
                <select class="${pi.statusOvr?'ovr':''} " style="flex:1" onchange="setPortField('${pid}','statusOvr',this.value)">
                  <option value="active"   ${effStatus==='active'  ?'selected':''}>${t('port.statusActive')}</option>
                  <option value="idle"     ${effStatus==='idle'    ?'selected':''}>${t('port.statusIdle')}</option>
                  <option value="inactive" ${effStatus==='inactive'?'selected':''}>${t('port.statusInactive')}</option>
                  <option value="fault"    ${effStatus==='fault'   ?'selected':''}>Fault</option>
                </select>${rst('statusOvr',t('pnl.dev.fieldStatus'))}
              </div>
            </div>
            <div class="prop-group"><label>${t('port.speed')}</label>
              <div style="display:flex;gap:5px">
                <input value="${escapeHTML(spdDisplay)}" placeholder="${escapeHTML(spdPh)}"
                       class="${pi.speedOvr!=null?'ovr':''}" style="flex:1"
                       onchange="setPortSpeed('${pid}',this.value)" data-tip="${t('pnl.dev.speedTip')}">
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
                    const _lk = (typeof win._getLinkTrunk==='function')
                        ? (_portLinks.find(l => win._getLinkTrunk(l).mode==='trunk') || _portLinks[0])
                        : _portLinks[0];
                    const _tk = (_lk && typeof win._getLinkTrunk==='function') ? win._getLinkTrunk(_lk) : null;
                    if(_tk && _tk.mode==='trunk'){
                        const _tg = _tk.vlans.filter(v => v !== _tk.native);
                        const _inner = `<span style="background:#0e2233;border:1px solid #2d6a9f;border-radius:4px;padding:1px 8px;font-weight:700;color:#5ba3f5">TRUNK</span>`
                          + ` <span style="color:var(--text-muted)">${t('cable.trunkNative')}</span> <b>VLAN ${_tk.native}</b>`
                          + (_tg.length ? ` <span style="color:var(--text-muted)">· ${t('cable.trunkCarried')}</span> <b>${_tg.join(', ')}</b>` : '');
                        // VoIP: la VLAN VOCE (taggata) è una proprietà dell'interfaccia → editabile QUI;
                        // la nativa/dati arriva dallo switch a monte (resta nel badge read-only sopra).
                        const _voiceRow = (portNode && portNode.type==='voip') ? (()=>{
                            // Lettura CANONICA (stessa fonte di carriedVlans/propagazione): node.spec.voiceVlan
                            const _vv = (typeof win._voipVoiceVlan==='function') ? (win._voipVoiceVlan(portNode) || 1)
                                      : ((portNode.voiceVlan!=null) ? portNode.voiceVlan : ((portNode.spec&&portNode.spec.voiceVlan)||1));
                            return `<div class="prop-group" style="margin-top:6px"><label>${t('f.vlanVoice')}</label>
                                <input type="number" min="1" max="4094" value="${_vv}" class="${_vv>1?'ovr':''}" style="flex:1"
                                       onchange="setNodeVoiceVlan('${portNode.id}',this.value)" data-tip="${t('f.vlanVoiceTip')}"></div>`;
                        })() : '';
                        return `<div class="prop-group"><label>VLAN</label>${_roBox(_inner)}</div>${_voiceRow}`;
                    }
                    return `<div class="prop-group"><label>VLAN</label>${(typeof win._floorAccessVlanRow==='function')?win._floorAccessVlanRow(portNode,pid):_roBox('VLAN '+effVlan)}</div>`;
                }
                // Campo VLAN/nativa editabile (scrive il PVID = vlanOvr). Riutilizzato
                // sia dalle porte passive sia dallo switchport (con label diversa).
                const _vlanField = (label) => `<div class="prop-group"><label>${label}</label>
                    <div style="display:flex;gap:5px">
                      <input type="number" min="1" max="4094" value="${effVlan}" class="${pi.vlanOvr!=null?'ovr':''}" style="flex:1"
                             onchange="setPortField('${pid}','vlanOvr',+this.value||1)">
                      ${rst('vlanOvr','VLAN')}
                    </div>
                    ${state.vlanNames?.[effVlan]?`<div style="font-size:0.73rem;color:var(--text-muted);margin-top:3px;padding-left:2px"><i class="fas fa-tag" style="font-size:0.65rem;margin-right:4px"></i>${escapeHTML(state.vlanNames[effVlan])}</div>`:''}
                  </div>`;

                // Porta passiva (patch/presa/…): solo il campo VLAN semplice.
                if(!portNode || !TYPES[portNode.type]?.isActive) return _vlanField('VLAN');

                // Switchport (interfaccia ATTIVA): GUI UNIFORME al pannello cavo —
                // badge TRUNK/access · nativa · trasportate → Modalità porta →
                // VLAN nativa (untagged/PVID) → VLAN trasportate. La nativa È il PVID.
                const _isTrunk = (typeof win._portEffTrunk==='function') ? win._portEffTrunk(pi) : (pi.mode==='trunk');
                const _tvArr   = win._parseTrunkVlans(pi.trunkVlans||[]);
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
                      <button class="toolbar-btn${!_isTrunk?' soft':''}" style="flex:1;padding:5px" onclick="setPortMode('${pid}','access')"><i class="fas fa-circle" style="font-size:0.6rem"></i> Access</button>
                      <button class="toolbar-btn${_isTrunk?' soft':''}" style="flex:1;padding:5px" onclick="setPortMode('${pid}','trunk')"><i class="fas fa-layer-group" style="font-size:0.7rem"></i> Trunk</button>
                    </div>
                  </div>
                  ${_vlanField(_isTrunk ? t('cable.trunkNativeLabel') : 'VLAN')}
                  ${_isTrunk?`<div class="prop-group">
                    <label style="display:flex;align-items:center;gap:5px">${t('cable.trunkVlans')}
                      <span style="font-size:0.68rem;color:var(--text-muted)">${t('pnl.dev.egVlanRange')}</span></label>
                    <input type="text" value="${escapeHTML(_tvStr)}" placeholder="1,10,20,100"
                           style="width:100%;font-family:monospace;font-size:0.82rem"
                           onchange="setPortTrunkVlans('${pid}',this.value)" onblur="setPortTrunkVlans('${pid}',this.value)">
                    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:3px">
                      ${_fromSnmp?`<span style="color:#5ba3f5"><i class="fas fa-satellite-dish" style="font-size:0.6rem;margin-right:3px"></i>SNMP</span> · `:''}${t('cable.vlansConfigured',{n:_tvArr.length})} · ${t('port.trunkPropNote')}
                    </div>
                  </div>`:''}`;
            })()}
            ${(()=>{
                // Dispositivo ATTIVO in LAG: il bonding e' ora mostrato nell'header.
                const portNode2=getNodeByPortId(pid);
                if(portNode2&&TYPES[portNode2.type]?.isActive) return '';
                // Dispositivo passivo: info LAG traversal se presente.
                const info=win.getPassivePortLagInfo(pid);
                if(!info) return '';
                return `<div style="border-top:1px solid var(--panel-border);margin-top:8px;padding-top:7px;font-size:0.72rem;color:var(--text-muted)">
                  <span style="color:var(--accent);margin-right:5px">🔗</span>
                  ${t('pnl.dev.path')} <strong style="color:var(--accent)">${escapeHTML(info.gname)}</strong> · ${escapeHTML(info.nodeName)}
                </div>`;
            })()}`;
        // I MAC visti sulla porta vengono ora elencati interamente dentro il
        // blocco "Segmento L2 condiviso" (non piu' duplicati in due box adiacenti).
        panel.innerHTML += win._sharedSegmentHtml(pid,'props');
        win._enableManualValueInProps(panel);
}

// Chiamato dal dispatcher renderProps() (app-properties.js, classic);
// _portInheritedLinkData è esercitato direttamente dallo smoke.
expose({ _renderPortProps, _portInheritedLinkData });
