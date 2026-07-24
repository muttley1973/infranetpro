// MODULO ESM (migrato da lib/app-properties-link.js): foglia del dispatcher
// renderProps() (classic in app-properties.js, che lo chiama via window). Builder
// del core + global legacy via win.*; lib guarded script-tagged (linkState/
// cable-validate/cabling) via win.*; _wifiAssocHtml esposto da app-wifi; t dal
// ponte. I nomi dentro gli onclick=""/onchange="" restano bare. Nessun cambio logica.
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML } from './app-util.js';
import { getNodeByPortId, getNodeDisplayName, getWallPortLabel, _getLinkPhysicalView, _enableManualValueInProps, _activatePropsTab, _cableAutoLabel } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderProps, _propsSectionIsOpen, _buildPropsHeader } from './app-properties.js';   // ritiro ponte fase 2+: funzioni/builder (ex win.*)
import { TYPES, _frontPanelPortLabel, _frontPanelIsUplink } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)
import { _effPortVlan, _getLinkTrunk, _parseTrunkVlans, _runActiveAnchor } from './app-vlan-autopoll.js';   // ritiro ponte: funzioni foglia UI/vlan/popup (ex win.*)
import { _portDisplayName } from './app-ports.js';   // ritiro ponte: funzioni foglia UI/vlan/popup (ex win.*)
import { _getLinkVlan } from './app-popup.js';   // ritiro ponte: funzioni disc/props/vlan/hv (ex win.*)
import { _routeHopRemovable } from './app-cabling-editor.js';   // ritiro ponte: coda funzioni A (batch 1/2) (ex win.*)
import { _wifiAssocHtml } from './app-wifi.js';   // ritiro ponte: coda funzioni A (batch 2/2) (ex win.*)

// ============================================================
// PROPERTIES PANEL — renderer CAVO/LINK (selType===link)
// Estratto da app-properties.js (refactor: split del pannello proprieta per
// tipo di selezione). Pannello cavo: VLAN, trunk derivato, associazione wireless.
// Funzione glue chiamata dal dispatcher renderProps() a runtime: usa solo
// `panel` + i globali (selId/selType/state/TYPES) e i builder condivisi che
// restano in app-properties.js. Caricato in netmapper.html subito dopo
// app-properties.js. NESSUN cambiamento di logica rispetto alloriginale.
// ============================================================

// Descrittore leggibile dell'endpoint di un cavo per l'etichetta "Da/A".
// Usa la label SFP-aware del front panel (_frontPanelPortLabel: numerazione +
// prefisso) e indica esplicitamente SFP/MGMT — prima mostrava il numero grezzo
// del pid (es. "porta 1" anche su una SFP).
function _cablePortDesc(pid){
    const _porta = (typeof t==='function') ? t('common.portWord') : 'porta';
    const node = getNodeByPortId(pid);
    if(!node) return _porta + ' ' + String(pid).split('-').slice(1).join('-');
    const suffix = String(pid).slice(node.id.length + 1);
    const mm = /^mgmt(\d+)$/i.exec(suffix);
    if(mm) return 'MGMT ' + mm[1];
    const num = parseInt(suffix, 10);
    if(num >= 1 && String(num) === suffix){
        const pc = node.ports !== undefined ? node.ports : ((TYPES[node.type] && TYPES[node.type].ports) || 1);
        const lbl = (typeof _frontPanelPortLabel === 'function') ? _frontPanelPortLabel(node, num, pc) : suffix;
        const isSfp = (typeof _frontPanelIsUplink === 'function') && _frontPanelIsUplink(node, num, pc);
        // SFP: se la label e' numerica pura prepende "SFP "; se ha gia' un prefisso
        // (es. "SFP1", "Te1") lo lascia com'e' (niente doppione "SFP SFP1").
        if(isSfp) return /^\d/.test(lbl) ? ('SFP ' + lbl) : lbl;
        return _porta + ' ' + lbl;
    }
    return _porta + ' ' + suffix;   // radio o suffisso non numerico: invariato
}

// Proprieta' di un CAVO/link selezionato (selType==='link').
export function _renderLinkProps(panel){
        const l=store.state.links.find(x=>x.id===store.selId);
        if(!l){store.selType=null;store.selId=null;renderProps();return;}
        const isAuto = !!l.autoLinked;
        const lockAttr = isAuto ? ' disabled' : '';
        const vl=_getLinkVlan(l);
        const autoColor=store.state.vlanColors[vl]||'#6e7681';
        const srcNode=getNodeByPortId(l.src), dstNode=getNodeByPortId(l.dst);
        const srcLbl=(srcNode?.name||'?')+' · '+_cablePortDesc(l.src);
        const dstLbl=(dstNode?.name||'?')+' · '+_cablePortDesc(l.dst);
        const rstBtn=l.colorOvr?`<button class="prst" style="font-size:0.85rem" data-tip="${t('pnl.gen.resetAutoColor')}" onclick="setLinkColor('${l.id}',null)">↺</button>`:'';
        const colorResetBtn = isAuto ? '' : rstBtn;
        // Stato esplicito link (lib/linkwin.state.js): 'ambiguous' = dedotto con
        // confidence < 0.80 (MAC/ARP/FDB). Va proposto all'utente per verifica.
        const _isAmbiguous = (typeof win.linkState === 'function') && win.linkState(l).key === 'ambiguous';
        // Due banner mutuamente esclusivi sopra le proprieta':
        //   - giallo CTA "da verificare" su link ambiguous: Conferma | Elimina
        //   - blu informativo su link autoLinked NON ambigui: Modifica (= promote)
        const verifyBanner = _isAmbiguous ? `<div class="link-verify-banner">
                <div class="link-verify-msg">
                    <i class="fas fa-circle-question"></i>
                    <span>${t('cable.verifyMsg')}</span>
                </div>
                <div class="link-verify-actions">
                    <button class="toolbar-btn primary" onclick="promoteLinkToManual('${l.id}')"><i class="fas fa-check"></i> ${t('common.confirm')}</button>
                    <button class="toolbar-btn danger" onclick="deleteLink('${l.id}')"><i class="fas fa-trash"></i> ${t('common.delete')}</button>
                </div>
            </div>` : '';
        const autoEditBar = (isAuto && !_isAmbiguous) ? `<div style="margin-top:8px;padding:8px 10px;background:rgba(9,105,218,.06);border:1px solid rgba(9,105,218,.20);border-radius:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:0.78rem">
                <span style="color:var(--text-muted)">${t('cable.autoEditMsg')}</span>
                <button class="toolbar-btn primary" onclick="promoteLinkToManual('${l.id}')"><i class="fas fa-pen"></i> ${t('common.edit')}</button>
            </div>` : '';
        // Trunk EFFETTIVO (derivato dalle VLAN trasportate da voce/SSID, o manuale).
        const tk = (typeof _getLinkTrunk==='function') ? _getLinkTrunk(l)
                 : { mode: l.mode==='trunk'?'trunk':'access', native: vl, vlans: (typeof _parseTrunkVlans==='function'?_parseTrunkVlans(l.trunkVlans||''):[]), carried:[], derived:false };
        const isTrunk = tk.mode === 'trunk';
        const trunkVlans = l.trunkVlans || '';
        // Capo ATTIVO del trunk: la nativa è il PVID (vlanOvr) di quella porta →
        // editabile inline. Se nessun capo è attivo, la nativa arriva da monte.
        const _nativeActivePid = (TYPES[getNodeByPortId(l.src)?.type]?.isActive) ? l.src
                               : (TYPES[getNodeByPortId(l.dst)?.type]?.isActive) ? l.dst : null;
        // (La vecchia riga "Rilevato automaticamente" sotto la VLAN e' stata
        // rimossa: protocollo e confidence ora vivono come badge nella riga
        // Stato, accanto a Membro LAG/AUTO — UI uniforme.)
        const vlanName = store.state.vlanNames[vl] ? escapeHTML(store.state.vlanNames[vl]) : '';
        const _tkTagged = tk.vlans.filter(v=>v!==tk.native);
        const vlanBadge = isTrunk
            ? `<span style="background:#0e2233;border:1px solid #2d6a9f;border-radius:4px;padding:2px 10px;font-size:0.78rem;font-weight:700;color:#5ba3f5">TRUNK</span>
               <span style="margin-left:6px;font-size:0.75rem;color:var(--text-muted)">${t('cable.trunkNative')}&nbsp;<b style="color:var(--text-main)">VLAN ${tk.native}</b></span>
               ${_tkTagged.length?`<span style="margin-left:6px;font-size:0.75rem;color:var(--text-muted)">· ${t('cable.trunkCarried')}&nbsp;<b style="color:var(--text-main)">${_tkTagged.join(', ')}</b></span>`:''}
               ${tk.derived?`<span style="margin-left:6px;font-size:0.68rem;color:#5ba3f5"><i class="fas fa-wand-magic-sparkles"></i> auto</span>`:''}`
            : `<span style="display:inline-flex;align-items:center;gap:6px">
                 <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${autoColor};flex-shrink:0;border:1px solid rgba(255,255,255,.18)"></span>
                 <b>VLAN ${vl}</b>${vlanName?`<span style="color:var(--text-muted)">— ${vlanName}</span>`:''}
               </span>`;

        const autoLbl = _cableAutoLabel(l);
        const hasManualLbl = !!l.label;
        const linkHeaderTitle = l.label || autoLbl || l.id || (l.wireless ? 'Wireless' : t('cable.cable'));
        const linkHeaderSubtitle = l.wireless ? t('cable.wirelessAssoc') : (l.autoLinked ? t('cable.autoCable') : t('cable.cable'));

        // Stato esplicito del link (lib/linkwin.state.js) — derivato, sola lettura.
        // Per i cavi "inferiti" il badge usa label "AUTO" + colore arancione,
        // coerente con la convenzione visiva applicata in topology.
        const _ls = (typeof win.linkState === 'function') ? win.linkState(l) : null;
        const _lsCol = { manual:'#57606a', lag:'#a371f7', discovered:'#1a7f37', ambiguous:'#f5a623' };
        const _lsLabel = _ls && _ls.key === 'ambiguous' ? 'AUTO' : (_ls ? _ls.label : '');
        // Badge protocollo (LLDP blu / CDP arancio, incluse label fuse 'LLDP+MAC')
        // accanto al badge di stato, STESSA altezza/forma: UI uniforme. Sostituisce
        // la vecchia riga "Rilevato automaticamente" sotto la VLAN.
        const _lsProtoStr = _ls ? String(_ls.protocol||'') : '';
        const _lsProtoCol = _lsProtoStr.startsWith('LLDP') ? '#0969da' : _lsProtoStr.startsWith('CDP') ? '#e8640a' : '#57606a';
        const stateRow = _ls ? `<div class="prop-group" style="flex:0 0 45%;padding-right:10px"><label style="text-align:right">${t('common.status')}</label>
            <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:4px 0;flex-wrap:wrap">
              <span style="background:${_lsCol[_ls.key]||'#57606a'};color:#fff;padding:2px 9px;border-radius:4px;font-weight:700;font-size:0.74rem">${escapeHTML(_lsLabel)}</span>
              ${_lsProtoStr?`<span style="background:${_lsProtoCol};color:#fff;padding:2px 9px;border-radius:4px;font-weight:700;font-size:0.74rem">${escapeHTML(_lsProtoStr)}</span>`:''}
              ${_ls.confidence!=null?`<span style="font-size:0.73rem;color:var(--text-muted)">${Math.round(_ls.confidence*100)}%</span>`:''}
            </div></div>` : '';

        const _linkDeleteTip = l.autoLinked ? t('cable.delTipAuto') : t('cable.delTip');
        panel.innerHTML=`
            ${_buildPropsHeader(
                linkHeaderTitle,
                linkHeaderSubtitle,
                'fa-link',
                `<span class="props-toggles"><button class="props-toggle-btn" onclick="_propsExpandAll()" data-tip="${t('props.expandAll')}"><i class="fas fa-angles-down"></i></button><button class="props-toggle-btn" onclick="_propsCollapseAll()" data-tip="${t('props.collapseAll')}"><i class="fas fa-angles-up"></i></button><button class="props-toggle-btn" onclick="_propsResetSections()" data-tip="${t('props.resetSections')}"><i class="fas fa-rotate"></i></button><button class="props-toggle-btn danger" onclick="deleteLink('${l.id}')" data-tip="${_linkDeleteTip}"><i class="fas fa-trash"></i></button></span>`
            )}
            <div class="prop-row2">
              <div class="prop-group" style="flex:0 0 55%"><label>${t('common.type')}</label><input disabled value="${l.wireless?'Wireless':t('cable.cable')}${l.autoLinked?' (auto)':''}"></div>
              ${stateRow}
            </div>
            <div class="prop-group"><label>${t('cable.from')}</label><input disabled value="${escapeHTML(srcLbl)}"></div>
            <div class="prop-group"><label>${t('cable.to')}</label><input disabled value="${escapeHTML(dstLbl)}"></div>
            <div class="prop-group">
              <label style="display:flex;align-items:center;gap:5px">
                ${t('cable.label')}
                ${hasManualLbl?`<button class="prst" data-tip="${t('pnl.gen.resetAutoLabel')}" onclick="setCableLabel('${l.id}','');renderProps()">↺</button>`:''}
              </label>
              <input type="text"
                     value="${escapeHTML(l.label||'')}"
                     placeholder="${escapeHTML(autoLbl)}"
                     style="width:100%"
                     ${lockAttr}
                     onchange="setCableLabel('${l.id}',this.value)">
              ${hasManualLbl?`<div style="font-size:0.7rem;color:var(--text-muted);margin-top:3px"><i class="fas fa-arrow-right-arrow-left" style="font-size:0.6rem;margin-right:3px"></i>${escapeHTML(autoLbl)}</div>`:''}
            </div>
            <div class="prop-group" style="margin-top:6px">
              <label>VLAN</label>
              ${(!isTrunk && _nativeActivePid)
                ? `<div style="display:flex;align-items:center;gap:8px">
                     <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${autoColor};flex-shrink:0;border:1px solid rgba(255,255,255,.18)"></span>
                     <input type="number" min="1" max="4094" value="${vl}" ${lockAttr} style="flex:1"
                            onchange="setLinkNativeVlan('${l.id}',this.value)" data-tip="${t('cable.accessVlanTip')}">
                   </div>
                   ${vlanName?`<div style="font-size:0.7rem;color:var(--text-muted);margin-top:3px"><i class="fas fa-tag" style="font-size:0.6rem;margin-right:3px"></i>${vlanName}</div>`:''}`
                : `<div style="padding:4px 0;font-size:0.83rem;color:var(--text-main)">${vlanBadge}</div>`}
            </div>
            ${verifyBanner}
            ${autoEditBar}

            <div class="prop-group" style="margin-top:10px;border-top:1px solid var(--panel-border);padding-top:10px">
              <label>${t('cable.portMode')}</label>
              <div style="display:flex;gap:6px;margin-top:4px">
                <button class="toolbar-btn${!isTrunk?' soft':''}" style="flex:1;padding:5px" ${lockAttr}
                  onclick="setLinkMode('${l.id}','access')">
                  <i class="fas fa-circle" style="font-size:0.6rem"></i> Access
                </button>
                <button class="toolbar-btn${isTrunk?' soft':''}" style="flex:1;padding:5px" ${lockAttr}
                  onclick="setLinkMode('${l.id}','trunk')">
                  <i class="fas fa-layer-group" style="font-size:0.7rem"></i> Trunk
                </button>
              </div>
            </div>

            ${isTrunk ? `
            <div class="prop-group">
              <label>${t('cable.trunkNativeLabel')}</label>
              ${_nativeActivePid
                ? `<input type="number" min="1" max="4094" value="${tk.native}" ${lockAttr}
                     onchange="setLinkNativeVlan('${l.id}',this.value)"
                     data-tip="${t('cable.trunkNativeTip')}">`
                : `<div style="padding:4px 0;font-size:0.8rem;color:var(--text-muted)">VLAN ${tk.native} <span style="font-size:0.7rem">· ${t('cable.trunkNativeUpstream')}</span></div>`}
            </div>
            <div class="prop-group" id="trunk-vlans-group">
              <label style="display:flex;align-items:center;gap:5px">
                ${t('cable.trunkVlans')}
                <span style="font-size:0.68rem;color:var(--text-muted)">(es. 10,20,100-200)</span>
              </label>
              ${tk.derived ? `
              <div class="trunk-derived"><i class="fas fa-wand-magic-sparkles"></i> ${t('cable.trunkAuto')}: <b>${tk.vlans.join(', ')}</b></div>
              <div style="font-size:0.7rem;color:var(--text-muted);margin:4px 0 6px">${t('cable.trunkAutoNote')}</div>
              <input type="text" value="" placeholder="${tk.vlans.join(',')}"
                style="width:100%" ${lockAttr}
                onchange="setLinkTrunkVlans('${l.id}',this.value)"
                onblur="setLinkTrunkVlans('${l.id}',this.value)">` : `
              <input type="text" value="${escapeHTML(trunkVlans)}" placeholder="1,10,20,100"
                style="width:100%" ${lockAttr}
                onchange="setLinkTrunkVlans('${l.id}',this.value)"
                onblur="setLinkTrunkVlans('${l.id}',this.value)">
              <div style="font-size:0.7rem;color:var(--text-muted);margin-top:3px">
                ${t('cable.vlansConfigured',{n:_parseTrunkVlans(trunkVlans).length})}
              </div>`}
            </div>` : ''}

            <div class="prop-group" style="margin-top:10px;border-top:1px solid var(--panel-border);padding-top:10px">
              <label style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                ${t('cable.colorOverride')}
                ${colorResetBtn}
              </label>
               <input type="color" value="${l.colorOvr||autoColor}"
                      style="width:100%;${l.colorOvr?'border-color:#e3b341':''}" ${lockAttr}
                      onchange="setLinkColor('${l.id}',this.value)">
            </div>
            ${(()=>{
                // Wireless: nessun percorso FISICO (è un'associazione radio).
                // L'eventuale percorso via repeater/mesh è un concetto diverso (da fare).
                if(l.wireless) return '';
                const _physicalPath = typeof _getLinkPhysicalView === 'function' ? _getLinkPhysicalView(l) : null;
                const _segments = Array.isArray(_physicalPath?.segments) && _physicalPath.segments.length
                    ? _physicalPath.segments
                    : (Array.isArray(l.segments) ? l.segments.filter(s=>s && (s.from || s.to)) : []);
                const _isSegmented = _segments.length > 1;
                const _portPathLabel = (pid) => {
                    if(!pid) return '—';
                    const _node = getNodeByPortId(pid);
                    if(!_node) return escapeHTML(typeof _portDisplayName==='function' ? _portDisplayName(pid) : String(pid));
                    const _baseName = _node.type==='wallport'
                        ? (getWallPortLabel(_node) || getNodeDisplayName(_node) || _node.id)
                        : (getNodeDisplayName(_node) || _node.name || _node.id);
                    const _rawPort = String(pid).split('-').slice(1).join('/');
                    const _portName = typeof _portDisplayName==='function' ? _portDisplayName(pid) : _rawPort;
                    const _showPort = _node.type!=='wallport' && (
                        (Number(_node.ports || TYPES[_node.type]?.ports || 0) > 1) ||
                        TYPES[_node.type]?.isRack ||
                        (_portName && _portName !== '?' && _portName !== _rawPort)
                    );
                    return escapeHTML(_showPort ? `${_baseName} / ${_portName}` : _baseName);
                };
                const _pathPids = Array.isArray(_physicalPath?.pathPids) && _physicalPath.pathPids.length
                    ? _physicalPath.pathPids.filter(Boolean)
                    : (_segments.length
                        ? [_segments[0]?.from, ..._segments.map(s=>s.to)].filter(Boolean)
                        : [l.src, l.dst].filter(Boolean));
                // Hop con pid: serve per i bottoni "togli tappa" sulle tappe
                // intermedie pass-through (dedup consecutivo per label, tiene
                // il primo pid — i mediaconv 'device' producono 2 pid stessa label).
                const _pathHops = _pathPids
                    .map(pid => ({ pid, label: _portPathLabel(pid) }))
                    .filter(h => h.label)
                    .filter((h, idx, arr) => idx === 0 || h.label !== arr[idx-1].label);
                const _pathLabels = _pathHops.map(h => h.label);
                // Validazione INFORMATIVA della struttura complessiva (P1.5-bis):
                // tipi ordinati lungo il percorso → badge ⚠ se la catena e'
                // anomala (apparato in mezzo, ordine non monotono, troppi nodi…).
                // Non bloccante: l'editor impedisce gia' le tappe fuori posto.
                const _chainTypes = _pathHops.map(h => getNodeByPortId(h.pid)?.type).filter(Boolean);
                const _chainCheck = (typeof win.validateCablingChain === 'function')
                    ? win.validateCablingChain(_chainTypes)
                    : { ok: true, warnings: [] };
                const _chainWarnHtml = (!_chainCheck.ok && _chainCheck.warnings.length)
                    ? `<div class="prop-group" style="margin-top:10px;padding:8px 10px;border:1px solid #b8860b;border-radius:8px;background:rgba(245,197,24,.08)">
                         <div style="font-size:.82rem;font-weight:700;color:#f5c518;margin-bottom:4px"><i class="fas fa-triangle-exclamation"></i> ${t('cable.chainAnomaly')}</div>
                         <ul style="margin:0;padding-left:18px;font-size:.8rem;color:var(--text-muted);line-height:1.45">
                           ${_chainCheck.warnings.map(w => `<li>${escapeHTML(w.msg)}</li>`).join('')}
                         </ul>
                       </div>`
                    : '';
                const _chainWarnBadge = _chainWarnHtml
                    ? `<span class="props-collapsible-preview" style="color:#f5c518" data-tip="${t('cable.chainAnomaly')}"><i class="fas fa-triangle-exclamation"></i></span>`
                    : '';
                const _totalLength = _isSegmented
                    ? _segments.reduce((sum, s)=>{
                        const val = Number(s.length ?? s.lengthM);
                        return Number.isFinite(val) ? sum + val : sum;
                    }, 0)
                    : Number(l.length ?? l.lengthM);
                const _hasTotalLength = Number.isFinite(_totalLength) && _totalLength > 0;
                const _permanentCount = _isSegmented
                    ? _segments.filter(s=>s.isPermanent===true || s.permanent===true).length
                    : (l.isPermanent===true ? 1 : 0);
                const _patchCount = _isSegmented
                    ? _segments.filter(s=>s.isPermanent===false || s.permanent===false).length
                    : (l.isPermanent===false ? 1 : 0);
                const _selectedSegmentIndex = _physicalPath?.selectedSegmentIndex || _segments.findIndex(s=>s.isSelected) + 1 || null;
                const _pathPreviewBits = [];
                if(_isSegmented) _pathPreviewBits.push(t('cable.segmentsN',{n:_segments.length}));
                else _pathPreviewBits.push(t('pnl.gen.directShort'));
                if(_hasTotalLength) _pathPreviewBits.push(`${String(_totalLength).replace(/\\.0$/,'')} m`);
                const _pathPreview = _pathPreviewBits.length
                    ? `<span class="props-collapsible-preview">${_pathPreviewBits.join(' · ')}</span>`
                    : '';
                const _summaryBits = [];
                if(_isSegmented) _summaryBits.push(t('cable.segmentsN',{n:_segments.length}));
                else _summaryBits.push(t('cable.directLink'));
                if(_hasTotalLength) _summaryBits.push(t('cable.totalM',{n:String(_totalLength).replace(/\\.0$/,'')}));
                if(_permanentCount) _summaryBits.push(`${_permanentCount} permanent link${_permanentCount===1?'':'s'}`);
                if(_patchCount) _summaryBits.push(`${_patchCount} patch cord`);
                if(_isSegmented && _selectedSegmentIndex) _summaryBits.push(t('cable.segSelected',{n:_selectedSegmentIndex}));
                if(_physicalPath?.ambiguous) _summaryBits.push(t('cable.partialPath'));
                // Percorso renderizzato hop per hop: le tappe intermedie
                // pass-through con esattamente 2 cavi mostrano il bottone
                // "togli tappa" (✕) che fonde i 2 tratti in un cavo diretto.
                const _pathText = _pathHops.length
                    ? _pathHops.map((h, idx) => {
                        const isMid = idx > 0 && idx < _pathHops.length - 1;
                        const removable = isMid &&
                            typeof _routeHopRemovable === 'function' && _routeHopRemovable(h.pid);
                        const rm = removable
                            ? `<button class="toolbar-btn danger" style="padding:0 5px;margin:0 0 0 3px;font-size:.62rem;line-height:1.4;vertical-align:1px"
                                 data-tip="${t('pnl.gen.removeHopTip')}"
                                 onclick="removeRouteHop('${escapeHTML(h.pid)}')"><i class="fas fa-times"></i></button>`
                            : '';
                        return `<span style="white-space:nowrap">${h.label}${rm}</span>`;
                      }).join(' <span style="color:var(--active-color)">→</span> ')
                    : t('pnl.gen.pathUnavailable');
                const _segmentsHtml = _isSegmented ? _segments.map((s, idx)=>{
                    const _from = _portPathLabel(s.from);
                    const _to = _portPathLabel(s.to);
                    const _segBits = [];
                    if(s.cableType) _segBits.push(escapeHTML(String(s.cableType)));
                    else if(s.type) _segBits.push(escapeHTML(String(s.type)));
                    const _segLen = Number(s.length ?? s.lengthM);
                    if(Number.isFinite(_segLen) && _segLen > 0) _segBits.push(`${String(_segLen).replace(/\\.0$/,'')} m`);
                    _segBits.push((s.isPermanent===true || s.permanent===true) ? 'Permanent link' : (s.isPermanent===false || s.permanent===false) ? 'Patch cord' : t('common.unspecifiedM'));
                    const _selBadge = s.isSelected ? `<span style="font-size:.64rem;color:var(--active-color);font-weight:700">${t('cable.selected')}</span>` : '';
                    // Segmento selezionato: verde "OK" ben visibile sul fondo scuro
                    // (bordo verde pieno + sfondo verde tenue).
                    const _segBorder = s.isSelected ? 'var(--active-color)' : 'var(--panel-border)';
                    const _segBg = s.isSelected ? 'rgba(57,211,83,.12)' : 'rgba(255,255,255,.02)';
                    // Segmento cliccabile → seleziona quel tratto (link) per editarlo,
                    // mantenendo il percorso evidenziato (selectPathSegment).
                    // NB: niente secondo attributo style qui — l'elemento ha gia' lo
                    // style principale (bordo/sfondo); un secondo `style` verrebbe
                    // ignorato dal browser e annullerebbe bordo+sfondo. Il cursore
                    // pointer e' gia' nello style principale.
                    const _segClick = s.linkId ? ` onclick="selectPathSegment('${escapeHTML(s.linkId)}')"` : '';
                    return `<div class="prop-group seg-pick${s.isSelected?' sel':''}"${_segClick} data-tip="${t('cable.segPickTip')}" style="margin-bottom:8px;padding:8px 10px;border:1px solid ${_segBorder};border-radius:8px;background:${_segBg}${s.linkId?';cursor:pointer':''}">
                        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:4px">
                          <div style="font-size:.9rem;font-weight:700;color:var(--text-main)">${s.isSelected?'<i class="fas fa-caret-right" style="color:var(--active-color);margin-right:4px"></i>':''}${t('cable.segmentN',{n:idx+1})}</div>
                          <div style="display:flex;align-items:center;gap:8px;font-size:.8rem;color:var(--text-muted)">${_selBadge}<span>${_segBits.join(' · ')}</span></div>
                        </div>
                        <div style="font-size:.88rem;color:var(--text-main);line-height:1.4">${_from} <span style="color:var(--active-color)">→</span> ${_to}</div>
                      </div>`;
                }).join('') : `
                    <div style="font-size:.88rem;color:var(--text-muted);line-height:1.45">
                      ${t('cable.directLinkDesc')}
                    </div>`;
                return `<details class="props-collapsible props-secondary" ${_propsSectionIsOpen('link-physical-path')?'open':''} ontoggle="setPropsSectionState('link-physical-path',this.open)" style="margin-top:14px">
                  <summary class="props-collapsible-head"><span><i class="fas fa-route"></i> ${t('cable.physicalPath')}</span>${_chainWarnBadge}${_pathPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
                  <div class="props-collapsible-body">
                    <div class="prop-group" style="padding:10px 12px;border:1px solid var(--panel-border);border-radius:8px;background:rgba(255,255,255,.02)">
                      <div style="font-size:.86rem;font-weight:700;color:var(--text-main);margin-bottom:6px">${t('cable.path')}</div>
                      <div style="font-size:.9rem;color:var(--text-main);line-height:1.45">${_pathText}</div>
                      <div style="font-size:.82rem;color:var(--text-muted);margin-top:8px">${_summaryBits.join(' · ')}</div>
                    </div>
                    ${_chainWarnHtml}
                    <div class="prop-group" style="margin-top:10px">
                      <button class="toolbar-btn soft" style="width:100%;justify-content:center;gap:8px"
                              data-tip="${t('cable.splitTip')}"
                              onclick="enterRoutingMode('${l.id}')">
                        <i class="fas fa-route"></i> ${t('cable.routeThrough')}
                      </button>
                    </div>
                    <div style="margin-top:10px">${_segmentsHtml}</div>
                  </div>
                </details>`;
            })()}

            ${(()=>{
                // P1.4 — Validazioni smart incompatibilità: problemi calcolati 1 volta,
                // riusati per il badge ⚠ nel preview (visibile a sezione chiusa) e per
                // il banner educativo in cima al corpo. SNMP dai due estremi per i
                // cross-check realtà↔doc.
                const _vsp = store.state.ports[l.src] || {}, _vdp = store.state.ports[l.dst] || {};
                // Wireless: nessuna validazione cavo fisico (rame/fibra/lunghezza
                // non si applicano a un'associazione radio).
                const _wlOn = !!l.wireless;
                // Native VLAN mismatch: solo fra due apparati ATTIVI (switch↔switch);
                // su un AP/endpoint la nativa non è un PVID confrontabile.
                const _sAct = !!TYPES[getNodeByPortId(l.src)?.type]?.isActive;
                const _dAct = !!TYPES[getNodeByPortId(l.dst)?.type]?.isActive;
                const _bothActive = _sAct && _dAct;
                const _cableIssues = (!_wlOn && typeof win.validateCable === 'function')
                    ? win.validateCable(l, { snmpSpeedMbps: _vsp.speed || _vdp.speed || 0,
                                         snmpMedium: _vsp.snmpMedium || _vdp.snmpMedium || null,
                                         isTrunk: tk.mode === 'trunk',
                                         srcNative: _bothActive ? _effPortVlan(l.src) : null,
                                         dstNative: _bothActive ? _effPortVlan(l.dst) : null })
                    : [];
                // Wireless = connessione radio↔radio (tipologia a sé, non un flag
                // attivabile su un cavo). Sezione dedicata, niente specifiche cavo.
                if(_wlOn){
                    return `<details class="props-collapsible props-secondary" open style="margin-top:14px">
              <summary class="props-collapsible-head"><span><i class="fas fa-wifi"></i> ${t('cable.wirelessAssoc')}</span><span class="props-collapsible-preview">${t('radio.single')}</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
              <div class="props-collapsible-body">
                ${typeof _wifiAssocHtml==='function' ? _wifiAssocHtml(l) : ''}
                <div class="link-wireless-note"><i class="fas fa-circle-info"></i> ${t('pnl.gen.wifiInheritNote')}</div>
              </div></details>`;
                }
                const _cableHasErr = _cableIssues.some(i => i.level === 'error');
                const _cableBadge = _cableIssues.length
                    ? `<span class="props-collapsible-preview cable-warn-pill ${_cableHasErr?'lvl-error':'lvl-warn'}" data-tip="${_cableHasErr?t('pnl.gen.incompatDetected'):t('pnl.gen.compatWarning')}"><i class="fas fa-triangle-exclamation"></i> ${_cableIssues.length}</span>`
                    : '';
                const _cableBanner = _cableIssues.length ? `<div class="cable-validate-banner">${_cableIssues.map(i=>`
                    <div class="cable-validate-row lvl-${i.level}">
                      <i class="fas ${i.level==='error'?'fa-circle-exclamation':'fa-triangle-exclamation'}"></i>
                      <div class="cable-validate-txt"><b>${escapeHTML(i.title)}</b><span>${escapeHTML(i.why)}</span></div>
                    </div>`).join('')}</div>` : '';
                const _physPreviewBits = [];
                if(l.isPermanent===true) _physPreviewBits.push('Permanent');
                else if(l.isPermanent===false) _physPreviewBits.push('Patch');
                if(l.cableType) _physPreviewBits.push(escapeHTML(String(l.cableType)));
                if(l.medium) _physPreviewBits.push(escapeHTML(l.medium==='fiber' ? t('cable.fiber') : l.medium==='dac' ? 'DAC' : t('cable.copper')));
                if(l.length!=null && l.length!=='') _physPreviewBits.push(`${escapeHTML(String(l.length))} m`);
                if(l.installedAt) _physPreviewBits.push(escapeHTML(String(l.installedAt)));
                const _physPreview = _physPreviewBits.length
                    ? `<span class="props-collapsible-preview">${_physPreviewBits.join(' · ')}</span>`
                    : '';
                return `<details class="props-collapsible props-secondary" ${(_cableIssues.length || _propsSectionIsOpen('link-physical-specs'))?'open':''} ontoggle="setPropsSectionState('link-physical-specs',this.open)" style="margin-top:14px">
              <summary class="props-collapsible-head"><span><i class="fas fa-ethernet"></i> ${t('cable.physicalSpecs')}</span>${_cableBadge}${_physPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
              <div class="props-collapsible-body">
              ${_cableBanner}
              ${(()=>{
                // Helper: class ovr (bordo arancio) se il campo ha un valore manuale
                const ovr=(key)=>l[key]!=null&&l[key]!==''?'ovr':'';

                // ---- SNMP auto-values rilevati dal port state dei due estremi -----
                const _sp=store.state.ports[l.src]||{}, _dp=store.state.ports[l.dst]||{};
                // Velocità e PoE sono proprietà END-TO-END del run (uguali su tutta la
                // tratta): se i capi diretti sono passanti senza dati, eredita dalla
                // porta ATTIVA a monte (_runActiveAnchor) — coerente con la porta
                // endpoint. Il MEZZO invece resta per-segmento (può cambiare: dorsale
                // fibra + bretella rame), quindi NON eredita dall'ancora.
                const _anchorPid = (typeof _runActiveAnchor==='function') ? _runActiveAnchor(l) : null;
                const _ap = _anchorPid ? (store.state.ports[_anchorPid]||{}) : {};
                // Mezzo fisico: primo port che ha dato SNMP (per-segmento)
                const _snmpMedRaw = _sp.snmpMedium || _dp.snmpMedium || null;
                const _snmpMedLbl = {copper:t('cable.copper'),fiber:t('pnl.gen.opticalFiber'),dac:'DAC'}[_snmpMedRaw] || null;
                // Velocità: ifHighSpeed dei capi diretti, o dell'ancora a monte del run
                const _snmpSpMbps = _sp.speed || _dp.speed || _ap.speed || 0;
                const _spToLbl=s=>{
                    if(!s) return null;
                    if(s>=100000) return '100G'; if(s>=40000) return '40G';
                    if(s>=25000)  return '25G';  if(s>=10000) return '10G';
                    if(s>=5000)   return '5G';   if(s>=2500)  return '2.5G';
                    if(s>=1000)   return '1G';   if(s>=100)   return '100M';
                    return s+'M';
                };
                const _snmpSpLbl = _spToLbl(_snmpSpMbps);
                // PoE: cerca src (switch/PSE) poi dst, poi l'ancora attiva del run
                const _snmpPoeDet = _sp.snmpPoe != null ? _sp.snmpPoe
                                  : (_dp.snmpPoe != null ? _dp.snmpPoe
                                  : (_ap.snmpPoe   != null ? _ap.snmpPoe : null));
                const _snmpPoeLbl = {none:t('o.none'),'802.3af':'802.3af — 15 W',
                    '802.3at':'802.3at — 30 W','802.3bt':'802.3bt — 90 W'}[_snmpPoeDet] || null;
                // Badge: visibile solo se SNMP ha un valore e l'utente non ha ancora impostato un override manuale
                const _snmpBadge=(lbl,key)=>lbl&&!l[key]
                    ?`<div style="font-size:0.68rem;color:#5ba3f5;margin-top:2px"><i class="fas fa-satellite-dish" style="font-size:0.6rem;margin-right:3px"></i>SNMP: <b>${escapeHTML(String(lbl))}</b></div>`:'';
                // -------------------------------------------------------------------

                const catLabel = l.medium==='fiber' ? t('cable.fiberType') : t('cable.category');
                const _derivedCableType = [
                    l.medium==='fiber' ? t('cable.fiber') : l.medium==='dac' ? 'DAC' : l.medium==='copper' ? t('cable.copper') : '',
                    l.cableCategory || '',
                    l.connector || ''
                ].filter(Boolean).join(' · ');

                return `
              <div class="prop-group">
                <label>${t('cable.type')}</label>
                <input type="text"
                       class="${ovr('cableType')}"
                       value="${escapeHTML(l.cableType||'')}"
                       placeholder="${escapeHTML(_derivedCableType || t('pnl.gen.cableTypePh'))}" ${lockAttr}
                       onchange="setLinkProp('${l.id}','cableType',this.value)">
              </div>

              <div class="prop-group">
                <label>${t('cable.segmentType')}</label>
                <select class="${ovr('isPermanent')}" ${lockAttr} onchange="setLinkProp('${l.id}','isPermanent',this.value)">
                  <option value="" ${l.isPermanent==null?'selected':''}>${t('common.unspecifiedM')}</option>
                  <option value="patch" ${l.isPermanent===false?'selected':''}>${t('cable.patchCord')}</option>
                  <option value="permanent" ${l.isPermanent===true?'selected':''}>Permanent link</option>
                </select>
              </div>

              <div class="prop-group">
                <label>${t('common.status')}</label>
                <select class="${ovr('cableStatus')}" ${lockAttr} onchange="setLinkProp('${l.id}','cableStatus',this.value)">
                  <option value="" ${!l.cableStatus?'selected':''}>${t('common.unspecifiedM')}</option>
                  <option value="active"     ${l.cableStatus==='active'    ?'selected':''}>${t('port.statusActive')}</option>
                  <option value="inactive"   ${l.cableStatus==='inactive'  ?'selected':''}>${t('port.statusInactive')}</option>
                  <option value="to_replace" ${l.cableStatus==='to_replace'?'selected':''}>${t('cable.toReplace')}</option>
                </select>
              </div>

              <div class="prop-group">
                <label>${t('cable.medium')}</label>
                <select class="${ovr('medium')}" ${lockAttr} onchange="setLinkProp('${l.id}','medium',this.value.trim())">
                  <option value="" ${!l.medium?'selected':''}>${t('common.unspecifiedM')}</option>
                  <option value="copper" ${l.medium==='copper'?'selected':''}>${t('cable.copper')}</option>
                  <option value="fiber" ${l.medium==='fiber'?'selected':''}>${t('cable.fiber')}</option>
                  <option value="dac" ${l.medium==='dac'?'selected':''}>DAC (Direct Attach)</option>
                </select>
                ${_snmpBadge(_snmpMedLbl,'medium')}
              </div>

              <div class="prop-group">
                <label>${catLabel}</label>
                <select class="${ovr('cableCategory')}" ${lockAttr} onchange="setLinkProp('${l.id}','cableCategory',this.value.trim())">
                  <option value="" ${!l.cableCategory?'selected':''}>${t('common.unspecifiedF')}</option>
                  <option value="Cat5e" ${l.cableCategory==='Cat5e'?'selected':''}>Cat 5e</option>
                  <option value="Cat6" ${l.cableCategory==='Cat6'?'selected':''}>Cat 6</option>
                  <option value="Cat6A" ${l.cableCategory==='Cat6A'?'selected':''}>Cat 6A</option>
                  <option value="Cat7" ${l.cableCategory==='Cat7'?'selected':''}>Cat 7</option>
                  <option value="Cat8" ${l.cableCategory==='Cat8'?'selected':''}>Cat 8</option>
                  <option value="OS2" ${l.cableCategory==='OS2'?'selected':''}>OS2 — Monomodale</option>
                  <option value="OM3" ${l.cableCategory==='OM3'?'selected':''}>OM3 — Multimodale 10G</option>
                  <option value="OM4" ${l.cableCategory==='OM4'?'selected':''}>OM4 — Multimodale 40/100G</option>
                  <option value="OM5" ${l.cableCategory==='OM5'?'selected':''}>OM5 — Multimodale SWDM</option>
                </select>
              </div>

              <div class="prop-group">
                <label>${t('cable.connector')}</label>
                <select class="${ovr('connector')}" ${lockAttr} onchange="setLinkProp('${l.id}','connector',this.value.trim())">
                  <option value="" ${!l.connector?'selected':''}>${t('common.unspecifiedM')}</option>
                  <option value="RJ45" ${l.connector==='RJ45'?'selected':''}>RJ45</option>
                  <option value="LC" ${l.connector==='LC'?'selected':''}>LC</option>
                  <option value="SC" ${l.connector==='SC'?'selected':''}>SC</option>
                  <option value="MPO/MTP" ${l.connector==='MPO/MTP'?'selected':''}>MPO / MTP</option>
                  <option value="SFP" ${l.connector==='SFP'?'selected':''}>SFP</option>
                  <option value="SFP+" ${l.connector==='SFP+'?'selected':''}>SFP+</option>
                  <option value="QSFP" ${l.connector==='QSFP'?'selected':''}>QSFP</option>
                  <option value="QSFP+" ${l.connector==='QSFP+'?'selected':''}>QSFP+</option>
                  <option value="QSFP28" ${l.connector==='QSFP28'?'selected':''}>QSFP28</option>
                </select>
              </div>

              <div class="prop-group">
                <label>${t('cable.maxSpeed')}</label>
                <select class="${ovr('maxSpeed')}" ${lockAttr} onchange="setLinkProp('${l.id}','maxSpeed',this.value.trim())">
                  <option value="" ${!l.maxSpeed?'selected':''}>${t('common.unspecifiedF')}</option>
                  <option value="100M" ${l.maxSpeed==='100M'?'selected':''}>100 Mbps</option>
                  <option value="1G" ${l.maxSpeed==='1G'?'selected':''}>1 Gbps</option>
                  <option value="2.5G" ${l.maxSpeed==='2.5G'?'selected':''}>2.5 Gbps</option>
                  <option value="5G" ${l.maxSpeed==='5G'?'selected':''}>5 Gbps</option>
                  <option value="10G" ${l.maxSpeed==='10G'?'selected':''}>10 Gbps</option>
                  <option value="25G" ${l.maxSpeed==='25G'?'selected':''}>25 Gbps</option>
                  <option value="40G" ${l.maxSpeed==='40G'?'selected':''}>40 Gbps</option>
                  <option value="100G" ${l.maxSpeed==='100G'?'selected':''}>100 Gbps</option>
                  <option value="400G" ${l.maxSpeed==='400G'?'selected':''}>400 Gbps</option>
                </select>
                ${_snmpBadge(_snmpSpLbl,'maxSpeed')}
              </div>

              <div class="prop-group">
                <label>${t('cable.lengthM')}</label>
                <input type="number" min="0" step="0.5"
                       class="${ovr('length')}"
                       value="${l.length!=null?l.length:''}"
                       placeholder="${t('pnl.gen.lengthPh')}" ${lockAttr}
                       onchange="setLinkProp('${l.id}','length',this.value===''?'':+this.value)">
              </div>

              <div class="prop-group">
                <label>${t('cable.installedAt')}</label>
                <input type="date"
                       class="${ovr('installedAt')}"
                       value="${escapeHTML(l.installedAt||'')}"
                       ${lockAttr}
                       onchange="setLinkProp('${l.id}','installedAt',this.value)">
              </div>

              <div class="prop-group">
                <label>${t('cable.installedBy')}</label>
                <input type="text"
                       class="${ovr('installedBy')}"
                       value="${escapeHTML(l.installedBy||'')}"
                       placeholder="${t('cable.installedByPh')}" ${lockAttr}
                       onchange="setLinkProp('${l.id}','installedBy',this.value)">
              </div>

              <div class="prop-group">
                <label>PoE</label>
                <select class="${ovr('poe')}" ${lockAttr} onchange="setLinkProp('${l.id}','poe',this.value.trim())">
                  <option value="" ${!l.poe?'selected':''}>${t('common.unspecifiedM')}</option>
                  <option value="none" ${l.poe==='none'?'selected':''}>${t('o.none')}</option>
                  <option value="802.3af" ${l.poe==='802.3af'?'selected':''}>802.3af — 15 W</option>
                  <option value="802.3at" ${l.poe==='802.3at'?'selected':''}>802.3at — 30 W</option>
                  <option value="802.3bt" ${l.poe==='802.3bt'?'selected':''}>802.3bt — 90 W</option>
                </select>
                ${_snmpBadge(_snmpPoeLbl,'poe')}
              </div>

              <div class="prop-group">
                <label>${t('common.description')}</label>
                <textarea rows="3"
                          class="${ovr('notes')}"
                          placeholder="${t('pnl.gen.freeDescPh')}"
                          style="width:100%;resize:vertical;padding:5px 7px;font-size:var(--fs-lg);background:var(--bg-color);border:1px solid var(--panel-border);border-radius:4px;color:var(--text-main)" ${lockAttr}
                          onchange="setLinkProp('${l.id}','notes',this.value)">${escapeHTML(l.notes||'')}</textarea>
              </div>`;
              })()}
              </div></details>`;
            })()}

            `;
        _enableManualValueInProps(panel);
        _activatePropsTab('Cavo');
        return;
}

// Chiamati dal dispatcher renderProps() (app-properties.js, classic).
expose({ _renderLinkProps, _cablePortDesc });
