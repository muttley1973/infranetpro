// ============================================================
// PROPERTIES PANEL — renderer NODO (dispositivo/struttura, selType===node)
// ============================================================
// MODULO ESM (migrato da lib/app-properties-node.js): _renderNodeProps, l'ultima
// foglia del gruppo properties. Chiamato dal dispatcher renderProps (core, bundle)
// via window. Approccio ALIAS-BLOCK: i simboli legacy/core usati build-time sono
// aliasati a win.* in cima alla funzione, così gli onclick="" (che referenziano
// state/TYPES/handler a RUNTIME in scope pagina) restano testo bare. selId/selType
// (riassegnati) via win.*; t dal ponte; _propsExplicit var-ificato in app.js.
// Nessun cambiamento di logica.
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML } from './app-util.js';
import { nodeById, getNodeDisplayName } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { TYPES, typeName } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES) + nome localizzato

// ============================================================
// PROPERTIES PANEL — renderer NODO (dispositivo/struttura, selType===node)
// Estratto da app-properties.js (refactor: split del pannello proprieta per
// tipo di selezione). Il piu grande: switch per-tipo device.
// Funzione glue chiamata dal dispatcher renderProps() a runtime: usa solo
// `panel` + i globali (selId/selType/state/TYPES) e i builder condivisi che
// restano in app-properties.js. Caricato in netmapper.html subito dopo
// app-properties.js. NESSUN cambiamento di logica rispetto alloriginale.
// ============================================================

// Modalita LACP del LAG all'ALTRO CAPO (coerenza cross-end). Riusa
// _lagRepresentativeConnection (global bare, esposto da app-popup) per trovare
// la porta peer del bundle, poi ne legge il gruppo -> state.lagModes. Ritorna
// null se il peer non e un LAG con modalita nota (nessun giudizio = honest).
// Sola lettura, zero mutazioni.
function _lagPeerMode(members){
    if(typeof _lagRepresentativeConnection !== 'function') return null;
    const first = Array.isArray(members) && members.length ? members[0] : null;
    const rep = (first && first.pid) ? _lagRepresentativeConnection(first.pid) : null;
    if(!rep || !rep.remotePid) return null;
    const rpi = (store.state.ports && store.state.ports[rep.remotePid]) || {};
    const pgid = String(rpi.lagGroup || '').trim();
    if(pgid && store.state.lagModes && store.state.lagModes[pgid]) return store.state.lagModes[pgid];
    return null;
}

// Proprieta' di un DISPOSITIVO/struttura selezionato (selType==='node').
function _renderNodeProps(panel){
        // ── Alias verso lo scope legacy (build-time); gli onclick="" restano bare ──
        // TYPES non è più aliasato: arriva dall'import ESM in cima al modulo.
        const state = store.state,
            _nodeSpecView = win._nodeSpecView,
            _buildPropsHeader = win._buildPropsHeader, _propsIconForType = win._propsIconForType,
            _discIdentityLabel = win._discIdentityLabel,
            getNodeRackSize = win.getNodeRackSize, _fixedRackLabel = win._fixedRackLabel,
            _frontPanelState = win._frontPanelState, _patchPanelChainOptions = win._patchPanelChainOptions,
            _patchPanelOffset = win._patchPanelOffset,
            isInStack = win.isInStack, getStackMembers = win.getStackMembers,
            getStackSummary = win.getStackSummary, getAllStackIds = win.getAllStackIds,
            getEffectiveRole = win.getEffectiveRole, _defaultStackName = win._defaultStackName,
            isInHaPair = win.isInHaPair, isInHaCluster = win.isInHaCluster,
            getHaPeer = win.getHaPeer, getHaPartners = win.getHaPartners,
            getHaSummary = win.getHaSummary, getAllHaGroupIds = win.getAllHaGroupIds,
            _buildPatchPanelPreview = win._buildPatchPanelPreview, selected = win.selected,
            _buildNetAccessHtml = win._buildNetAccessHtml, _propsSectionIsOpen = win._propsSectionIsOpen,
            isRackTopNumbered = win.isRackTopNumbered, rackUToVisible = win.rackUToVisible,
            getLagGroupsForNode = win.getLagGroupsForNode, _enableManualValueInProps = win._enableManualValueInProps,
            _activatePropsTab = win._activatePropsTab, _nodeDeviceChainHtml = win._nodeDeviceChainHtml,
            _propsExplicit = win._propsExplicit, renderProps = win.renderProps,
            _l3SviSectionHtml = win._l3SviSectionHtml, _panelSkinSectionHtml = win._panelSkinSectionHtml;

        const _rawNode=nodeById(store.selId); if(!_rawNode) return;
        const n=_nodeSpecView(_rawNode);
        const d=TYPES[n.type]; if(!d){store.selId=null;store.selType=null;renderProps();return;}
        // UX uniforme rack + floor: click singolo/drag selezionano soltanto il
        // device; le proprieta' si aprono intenzionalmente col DOPPIO click. (Il
        // floor seguiva renderAll→renderProps senza guardia → switchava al singolo
        // click, rubando il pannello durante il drag-import VM. Ora come il rack.)
        if((d.isRack || d.isFloor) && !_propsExplicit) return;
        const _delTip = d.isStructural ? t('pnl.node.delObject') : t('pnl.node.delDevice');
        const _panelHeader = _buildPropsHeader(
            n.name || n.hostname || n.ip || d.name,
            d.name,
            _propsIconForType(n.type),
            `<span class="props-toggles"><button class="props-toggle-btn" onclick="_propsExpandAll()" data-tip="${t('pnl.node.expandAll')}"><i class="fas fa-angles-down"></i></button><button class="props-toggle-btn" onclick="_propsCollapseAll()" data-tip="${t('pnl.node.collapseAll')}"><i class="fas fa-angles-up"></i></button><button class="props-toggle-btn" onclick="_propsResetSections()" data-tip="${t('pnl.node.resetSections')}"><i class="fas fa-rotate"></i></button><button class="props-toggle-btn danger" onclick="deleteNode()" data-tip="${_delTip}"><i class="fas fa-trash"></i></button></span>`
        );
        let h=`${_panelHeader}`;
        if(d.isStructural){
            const _opacity  = n.opacity  !== undefined ? n.opacity  : 1;
            const _locked   = !!n.locked;
            // Font size: valore salvato oppure auto (calcolato da dimensioni)
            const _autoFs   = Math.max(10, Math.min(Math.min(n.w||200, n.h||200) * 0.1, 36));
            const _fontSize = n.fontSize !== undefined ? n.fontSize : '';
            h+=`<div class="prop-group">
                  <label>${t('f.roomName')}</label>
                  <input value="${escapeHTML(n.name||'')}" placeholder="${t('pnl.node.noNamePlaceholder')}"
                         onchange="updateN('name',this.value)">
                </div>
                <div class="prop-group">
                  <label style="display:flex;align-items:center;justify-content:space-between">
                    <span>${t('pnl.node.fontSize')}</span>
                    <span style="font-size:0.75rem;color:var(--text-muted)">${t('pnl.node.autoEquals',{n:Math.round(_autoFs)})}</span>
                  </label>
                  <input type="number" min="6" max="200" step="1"
                         value="${_fontSize}" placeholder="${t('pnl.node.autoPxPlaceholder',{n:Math.round(_autoFs)})}"
                         style="width:100%;box-sizing:border-box"
                         onchange="updateN('fontSize', this.value===''?undefined:normalizeNumber(this.value,${Math.round(_autoFs)},6,200))">
                </div>
                <div class="prop-group" style="margin-bottom:10px">
                  <button class="toolbar-btn${_locked?' primary':''}" style="width:100%;justify-content:center;gap:8px"
                          onclick="toggleRoomLock('${n.id}')">
                    <i class="fas ${_locked?'fa-lock':'fa-lock-open'}"></i>
                    ${_locked?t('pnl.node.roomLockedClickUnlock'):t('pnl.node.lockPosSize')}
                  </button>
                </div>
                <div class="prop-group">
                  <label style="display:flex;align-items:center;justify-content:space-between">
                    <span>${t('pnl.node.bgColor')}</span>
                    <input type="color" value="${n.color||d.defaultColor}"
                           style="width:38px;height:26px;padding:1px;cursor:pointer"
                           oninput="_liveStructColor('${n.id}',this.value)"
                           onchange="updateN('color',this.value)">
                  </label>
                </div>
                <div class="prop-group">
                  <label style="display:flex;align-items:center;justify-content:space-between">
                    <span>${t('pnl.node.bgOpacity')}</span>
                    <span id="struct-opacity-lbl">${Math.round(_opacity*100)}%</span>
                  </label>
                  <input type="range" min="0" max="1" step="0.05" value="${_opacity.toFixed(2)}"
                         oninput="_liveStructOpacity('${n.id}',+this.value)"
                         onchange="updateN('opacity',+this.value)">
                </div>
                <div class="prop-group"><label>${t('f.widthPx')}</label><input type="number" step="20" value="${n.w||200}" onchange="updateN('w',normalizeNumber(this.value,200,40,5000))"></div>
                <div class="prop-group"><label>${t('f.heightPx')}</label><input type="number" step="20" value="${n.h||200}" onchange="updateN('h',normalizeNumber(this.value,200,40,5000))"></div>
                <p class="prop-notes-header"><i class="fas fa-sticky-note"></i> ${t('common.notes')}</p>
                <div class="prop-group">
                  <textarea rows="3" placeholder="${t('pnl.node.notesPlaceholder')}"
                            onchange="updateN('notes',this.value)">${escapeHTML(n.notes||'')}</textarea>
                </div>
                `;
        } else {
            const _idSrc = String(n.identitySource || '').trim();
            const _idConf = String(n.identityConfidence || '').trim();
            const _idLabel = _discIdentityLabel(_idSrc);
            const _hintVendor = String(n.vendorHint || '').trim();
            const _pReconcile = Array.isArray(n.portReconcileConflicts) ? n.portReconcileConflicts.length : 0;
            const _showIdentity = !!(_idSrc || _hintVendor || n.possibleReplacement || _pReconcile);
            const _idColor = _idConf === 'high' ? '#39d353' : _idConf === 'mid' ? '#d29922' : '#8b949e';
            const _identityBlock = _showIdentity ? `<div style="margin:8px 0 12px;padding:8px 10px;background:color-mix(in srgb, var(--accent) 7%, transparent);border:1px solid color-mix(in srgb, var(--accent) 20%, transparent);border-radius:6px;display:flex;flex-direction:column;gap:5px;font-size:0.74rem">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span style="font-weight:600;color:var(--text-main)">${t('pnl.node.detectedIdentity')}</span>
                    ${_idSrc ? `<span style="padding:2px 6px;border-radius:999px;background:rgba(88,166,255,.12);color:#58a6ff;border:1px solid rgba(88,166,255,.25)">${escapeHTML(_idLabel)}</span>` : ''}
                    ${_idConf ? `<span style="padding:2px 6px;border-radius:999px;background:${_idColor}22;color:${_idColor};border:1px solid ${_idColor}55">${escapeHTML(_idConf)}</span>` : ''}
                    ${_hintVendor ? `<span style="color:var(--text-muted);opacity:.5">|</span><span style="color:var(--text-muted)">${t('pnl.node.vendorHintMacOui')} <strong style="color:var(--text-main)">${escapeHTML(_hintVendor)}</strong></span>` : ''}
                </div>
                ${n.possibleReplacement ? `<div style="color:#d29922"><i class="fas fa-triangle-exclamation" style="margin-right:4px"></i>${t('pnl.node.possibleReplacement')}</div>` : ''}
                ${_pReconcile ? `<div style="color:#d29922"><i class="fas fa-triangle-exclamation" style="margin-right:4px"></i>${t('pnl.node.portReconcile', {n:_pReconcile})}</div>` : ''}
            </div>` : '';
            // Sezioni del pannello accumulate in variabili separate per poter
            // controllare l'ordine finale (Device-specifico in alto, poi Rete &
            // Accesso, Layout porte, LAG, Integrazione). Usate solo per i RACK;
            // l'assemblaggio finale e' subito prima delle Note.
            let _layoutPortsHtml   = '';
            let _patchPanelHtml    = '';
            let _networkAccessHtml = '';
            let _devSpecHtml       = '';
            let _lagHtml           = '';
            let _inventoryHtml     = '';
            let _integrationHtml   = '';
            let _stackingHtml      = '';
            let _haHtml            = '';
            if(d.isRack){
                const rs=getNodeRackSize(n);
                const isRackFiller = (n.type==='blankpanel'||n.type==='cablemanager');
                const fixedName=_fixedRackLabel(n.type)||'';

                // ---- Layout porte ----
                if(!isRackFiller){
                    const fp = _frontPanelState(n, n.ports!==undefined ? n.ports : d.ports || 0);
                    const layout = fp.baseLayout || 'auto';
                    const sfpCount = Number.isFinite(fp.sfpCount) ? fp.sfpCount : (fp.separateSfp ? 4 : 0);
                    const maxSfp = Math.min(8, Math.max(0, fp.portCount));
                    const isPatch = n.type==='patchpanel';
                    const _portTot = n.ports!==undefined ? n.ports : (d.ports || 0);
                    const _sfpShown = fp.separateSfp && sfpCount > 0 ? sfpCount : 0;
                    const _lpPreview = _portTot
                        ? `<span class="props-collapsible-preview">${t('common.portsCount',{n:_portTot})}${_sfpShown?` · ${_sfpShown} SFP`:''}</span>`
                        : '';
                    _layoutPortsHtml = `<details class="props-collapsible" ${_propsSectionIsOpen('layout-ports')?'open':''} ontoggle="setPropsSectionState('layout-ports',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-grip-vertical"></i> ${t('sec.portLayout')}</span>${_lpPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
<div class="prop-row2">
  <div class="prop-group" style="grid-column:1/-1"><label>${t('field.portCount')}</label>
    <input type="number" min="0" max="96" value="${n.ports!==undefined?n.ports:d.ports}" onchange="updateN('ports',normalizeNumber(this.value,${d.ports},0,96))">
  </div>
</div>
<div class="prop-group" style="margin-top:6px"><label>${t('f.baseLayout')}</label>
  <div class="layout-thumbnails" role="radiogroup" aria-label="${t('pnl.node.basePortLayout')}">
    <button type="button" class="layout-thumb${layout==='linear'?' selected':''}" onclick="updateFrontPanel('baseLayout','linear')" data-tip="${t('pnl.node.layoutLinearTip')}" aria-pressed="${layout==='linear'?'true':'false'}" aria-label="${t('pnl.node.layoutLinear')}">
      <svg viewBox="0 0 80 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <text x="8"  y="10" font-size="7" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">1</text>
        <text x="20" y="10" font-size="7" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">2</text>
        <text x="32" y="10" font-size="7" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">3</text>
        <text x="46" y="10" font-size="7" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">4</text>
        <text x="58" y="10" font-size="7" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">5</text>
        <text x="70" y="10" font-size="7" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">6</text>
        <text x="40" y="18" font-size="5.5" font-family="system-ui,sans-serif" fill="currentColor" text-anchor="middle">${t('pnl.node.layoutLinear')}</text>
      </svg>
    </button>
    <button type="button" class="layout-thumb${layout==='sequential'?' selected':''}" onclick="updateFrontPanel('baseLayout','sequential')" data-tip="${t('pnl.node.layoutSequentialTip')}" aria-pressed="${layout==='sequential'?'true':'false'}" aria-label="${t('pnl.node.layoutSequential')}">
      <svg viewBox="0 0 80 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <text x="22" y="13" font-size="5.5" font-family="system-ui,sans-serif" fill="currentColor" text-anchor="middle">${t('pnl.node.layoutSequential')}</text>
        <text x="48" y="9"  font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">1</text>
        <text x="58" y="9"  font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">2</text>
        <text x="68" y="9"  font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">3</text>
        <text x="48" y="18" font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">4</text>
        <text x="58" y="18" font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">5</text>
        <text x="68" y="18" font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">6</text>
      </svg>
    </button>
    <button type="button" class="layout-thumb${layout==='alternating'?' selected':''}" onclick="updateFrontPanel('baseLayout','alternating')" data-tip="${t('pnl.node.layoutAlternatingTip')}" aria-pressed="${layout==='alternating'?'true':'false'}" aria-label="${t('pnl.node.layoutAlternating')}">
      <svg viewBox="0 0 80 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <text x="22" y="13" font-size="5.5" font-family="system-ui,sans-serif" fill="currentColor" text-anchor="middle">${t('pnl.node.layoutAlternating')}</text>
        <text x="48" y="9"  font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">1</text>
        <text x="58" y="9"  font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">3</text>
        <text x="68" y="9"  font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">5</text>
        <text x="48" y="18" font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">2</text>
        <text x="58" y="18" font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">4</text>
        <text x="68" y="18" font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">6</text>
      </svg>
    </button>
  </div>
</div>
<div class="prop-check-grid">
  <label class="prop-check" data-tip="${t('pnl.node.port1BottomTip')}"><input type="checkbox" ${fp.oneBottom?'checked':''} onchange="updateFrontPanel('oneBottom',this.checked)"> ${t('pnl.node.port1Bottom')}</label>
</div>
${isPatch ? '' : `<div class="prop-row2" style="margin-top:4px">
  <div class="prop-group"><label>${t('f.sfpPorts')}</label>
    <input type="number" min="0" max="${maxSfp}" value="${sfpCount}" onchange="updateFrontPanel('sfpCount',normalizeNumber(this.value,0,0,${maxSfp}))" data-tip="${t('pnl.node.sfpPortsTip')}">
  </div>
${sfpCount > 0 ? `  <div class="prop-group"><label>${t('f.sfpPos')}</label>
    <select onchange="updateFrontPanel('sfpRight',this.value==='right')">
      <option value="left"  ${!fp.sfpRight?'selected':''}>${t('o.left')}</option>
      <option value="right" ${ fp.sfpRight?'selected':''}>${t('o.rightDef')}</option>
    </select>
  </div>` : ''}
</div>
${sfpCount > 0 ? `<div class="prop-row2" style="margin-top:4px">
  <div class="prop-group"><label>${t('f.sfpNum')}</label>
    <select onchange="updateFrontPanel('sfpStartNum', this.value==='continued'? '' : (this.value==='restart' ? 1 : parseInt(this.value,10)))" data-tip="${t('pnl.node.sfpNumTip')}">
      <option value="continued" ${(fp.sfpStartNum===null||fp.sfpStartNum===undefined)?'selected':''}>${t('o.continuousEx')}</option>
      <option value="restart"   ${fp.sfpStartNum===1?'selected':''}>${t('o.restart1Ex')}</option>
      <option value="49"        ${fp.sfpStartNum===49?'selected':''}>${t('o.custom49cisco')}</option>
      <option value="25"        ${fp.sfpStartNum===25?'selected':''}>${t('o.custom25')}</option>
    </select>
  </div>
  <div class="prop-group"><label>${t('f.sfpPrefix')}</label>
    <input type="text" maxlength="6" value="${escapeHTML(fp.sfpPrefix||'')}" placeholder="${t('pnl.node.nonePlaceholder')}" onchange="updateFrontPanel('sfpPrefix', this.value)" data-tip="${t('pnl.node.sfpPrefixTip')}">
  </div>
</div>
<div class="prop-row2" style="margin-top:6px;padding-top:4px;border-top:1px dashed var(--panel-border)">
  <div class="prop-group" style="grid-column:1/-1"><label style="font-size:0.72rem;color:var(--text-muted);font-weight:600">${t('f.sfp2ndBlock')}</label></div>
</div>
<div class="prop-row2">
  <div class="prop-group"><label>${t('f.ports2block')}</label>
    <input type="number" min="0" max="${maxSfp}" value="${fp.sfp2Count||0}" onchange="updateFrontPanel('sfp2Count', normalizeNumber(this.value,0,0,${maxSfp}))" data-tip="${t('pnl.node.sfp2CountTip')}">
  </div>
${(fp.sfp2Count||0) > 0 ? `  <div class="prop-group"><label>${t('f.prefix2block')}</label>
    <input type="text" maxlength="6" value="${escapeHTML(fp.sfp2Prefix||'')}" placeholder="${t('pnl.node.nonePlaceholder')}" onchange="updateFrontPanel('sfp2Prefix', this.value)" data-tip="${t('pnl.node.sfp2PrefixTip')}">
  </div>` : ''}
</div>
${(fp.sfp2Count||0) > 0 ? `<div class="prop-row2" style="margin-top:4px">
  <div class="prop-group" style="grid-column:1/-1"><label>${t('f.num2block')}</label>
    <select onchange="updateFrontPanel('sfp2StartNum', this.value==='continued'? '' : (this.value==='restart' ? 1 : parseInt(this.value,10)))" data-tip="${t('pnl.node.sfp2NumTip')}">
      <option value="continued" ${(fp.sfp2StartNum===null||fp.sfp2StartNum===undefined)?'selected':''}>${t('o.continuous')}</option>
      <option value="restart"   ${fp.sfp2StartNum===1?'selected':''}>${t('o.restart1')}</option>
      <option value="49"        ${fp.sfp2StartNum===49?'selected':''}>${t('o.custom49')}</option>
      <option value="25"        ${fp.sfp2StartNum===25?'selected':''}>${t('o.custom25')}</option>
    </select>
  </div>
</div>` : ''}` : ''}`}
${isPatch ? (()=>{
    const _ppOpts = (typeof _patchPanelChainOptions==='function') ? _patchPanelChainOptions(n) : [];
    const _ppFrom = fp.ppContinueFrom || '';
    const _ppStart = fp.ppStartNum || '';
    const _ppOff = (typeof _patchPanelOffset==='function') ? _patchPanelOffset(n) : 0;
    const _ppPorts = n.ports!==undefined ? n.ports : (d.ports||0);
    const _ppPreview = _ppPorts>0 ? t('pnl.node.portsNumbered',{from:_ppOff+1,to:_ppOff+_ppPorts}) : '';
    return `<div class="prop-row2" style="margin-top:6px;padding-top:4px;border-top:1px dashed var(--panel-border)">
  <div class="prop-group" style="grid-column:1/-1"><label style="font-size:0.72rem;color:var(--text-muted);font-weight:600">${t('f.progNumbering')}</label></div>
</div>
<div class="prop-group"><label>${t('f.continueFrom')}</label>
  <select onchange="updateFrontPanel('ppContinueFrom',this.value)" data-tip="${t('pnl.node.ppContinueFromTip')}">
    <option value="" ${!_ppFrom?'selected':''}>${t('o.sepIndep')}</option>
    ${_ppOpts.map(p=>`<option value="${escapeHTML(p.id)}" ${_ppFrom===p.id?'selected':''}>${escapeHTML(getNodeDisplayName(p)||p.name||p.id)}</option>`).join('')}
  </select>
</div>
<div class="prop-group"><label>${t('f.orStartFrom')}</label>
  <input type="number" min="1" max="9999" value="${escapeHTML(String(_ppStart))}" placeholder="${t('pnl.node.autoPlaceholder')}" onchange="updateFrontPanel('ppStartNum',this.value)" data-tip="${t('pnl.node.ppStartNumTip')}">
</div>
${_ppPreview?`<div style="font-size:0.72rem;color:var(--text-muted);margin:2px 2px 0"><i class="fas fa-hashtag" style="margin-right:5px"></i>${_ppPreview}</div>`:''}`;
})() : ''}
${fp.mgmtEligible ? `<div class="prop-row2" style="margin-top:4px">
  <div class="prop-group"><label>${t('f.mgmtPorts')}</label>
    <input type="number" min="0" max="4" value="${fp.mgmtCount||0}" onchange="updateFrontPanel('mgmtCount',normalizeNumber(this.value,0,0,4))" data-tip="${t('pnl.node.mgmtPortsTip')}">
  </div>
${(fp.mgmtCount||0) > 0 ? `  <div class="prop-group"><label>${t('f.mgmtPos')}</label>
    <select onchange="updateFrontPanel('mgmtPosition',this.value)">
      <option value="left"  ${fp.mgmtPosition!=='right'?'selected':''}>${t('o.leftDef')}</option>
      <option value="right" ${fp.mgmtPosition==='right'?'selected':''}>${t('o.right')}</option>
    </select>
  </div>` : ''}
</div>
${(fp.mgmtCount||0) > 0 ? `<div class="prop-row2" style="margin-top:4px">
  <div class="prop-group" style="grid-column:1/-1"><label>${t('f.mgmtLabel')}</label>
    <input type="text" maxlength="10" value="${escapeHTML(fp.mgmtLabel||'MGMT')}" placeholder="MGMT" onchange="updateFrontPanel('mgmtLabel',this.value)" data-tip="${t('pnl.node.mgmtLabelTip')}">
  </div>
</div>` : ''}` : ''}
</div>
</details>`;
                }

                // ---- Stacking (P7.1) ----
                // Visibile solo su tipi `stackEligible` (switch). Modello tag-based
                // su `node.spec.stackId/stackMemberId`. Master = lowest memberId nello
                // stack; il fallback in getStackMaster gestisce buchi e auto-promote.
                if(d.stackEligible && !isRackFiller){
                    const _isIn = isInStack(n);
                    const _stackId = _isIn ? n.spec.stackId : '';
                    const _mid = _isIn ? (n.spec.stackMemberId||1) : 1;
                    const _members = _isIn ? getStackMembers(state.nodes, _stackId) : [];
                    const _summary = getStackSummary(state.nodes, n);
                    const _allStacks = getAllStackIds(state.nodes);
                    const _preview = _summary
                        ? `<span class="props-collapsible-preview">${escapeHTML(_summary)}${_isIn ? ` ${t('pnl.node.ofStack',{id:escapeHTML(_stackId)})}` : ''}</span>`
                        : `<span class="props-collapsible-preview muted">Standalone</span>`;
                    // Membri lista: nome / memberId / ruolo / "questo device"
                    const _renderMembersList = () => {
                        if(!_members.length) return `<div style="font-size:0.7rem;color:var(--text-muted);padding:4px 0">${t('pnl.node.noOtherMembers')}</div>`;
                        return `<div class="stack-members-list">${_members.map(m => {
                            const _role = getEffectiveRole(state.nodes, m);
                            const _mIsThis = m.id === n.id;
                            const _mLabel = `${escapeHTML(m.name || m.hostname || m.id)} · #${m.spec?.stackMemberId||'?'} ${_role === 'master' ? '(master)' : ''}`;
                            return `<div class="stack-member-row${_mIsThis ? ' is-this' : ''}">${_mLabel}${_mIsThis ? ` <span class="stack-this-marker">← ${t('pnl.node.thisMarker')}</span>` : ''}</div>`;
                        }).join('')}</div>`;
                    };
                    // Datalist per autocomplete stack esistenti
                    const _datalistOpts = _allStacks.map(s => `<option value="${escapeHTML(s)}"></option>`).join('');
                    // Banner auto-detection (P7.3): se l'ultimo SNMP poll ha
                    // rilevato pattern <M>/<S>/<P> su >=2 membri distinti,
                    // l'app propone di promuovere questo device a master.
                    const _hint = n.stackDetectionHint;
                    const _hintBanner = (_hint && !_isIn) ? `<div class="stack-hint-banner" role="alert">
  <div class="stack-hint-head"><i class="fas fa-magic-wand-sparkles"></i> ${t('pnl.node.detectedStackPre')} <strong>${_hint.memberIds.length}</strong> ${t('pnl.node.detectedStackPost',{fmt:escapeHTML(_hint.suggestedFormat||'pattern')})}</div>
  <div class="stack-hint-body">${t('pnl.node.membersFoundInPoll')} <strong>${_hint.memberIds.join(', ')}</strong>.<br>${t('pnl.node.exampleLabel')} <code>${escapeHTML(_hint.sampleNames.slice(0,3).join(' · '))}</code></div>
  <div class="stack-hint-actions">
    <button class="toolbar-btn" style="justify-content:center" onclick="acceptStackHint()"><i class="fas fa-layer-group"></i> ${t('pnl.node.promoteToMaster')}</button>
    <button class="toolbar-btn" style="justify-content:center" onclick="dismissStackHint()">${t('pnl.node.ignore')}</button>
  </div>
</div>` : '';
                    // Force-open la fisarmonica quando c'e' un hint da mostrare:
                    // l'utente deve vedere il banner senza dover cercare.
                    const _stackOpen = _propsSectionIsOpen('stacking') || (_hint && !_isIn);
                    _stackingHtml = `<details class="props-collapsible props-secondary" ${_stackOpen?'open':''} ontoggle="setPropsSectionState('stacking',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-layer-group"></i> ${t('sec.stacking')}</span>${_hint && !_isIn ? `<span class="props-collapsible-preview" style="color:var(--accent)">${t('pnl.node.detected')}</span>` : _preview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
${_hintBanner}
<div class="prop-check-grid" style="grid-template-columns:1fr 1fr;border-top:none;border-bottom:none;padding:0;margin-bottom:6px">
  <label class="prop-check" data-tip="${t('pnl.node.stackStandaloneTip')}"><input type="radio" name="stack-mode-${escapeHTML(n.id)}" ${!_isIn?'checked':''} onchange="if(this.checked) removeNodeFromStack()"> Standalone</label>
  <label class="prop-check" data-tip="${t('pnl.node.stackMemberTip')}"><input type="radio" name="stack-mode-${escapeHTML(n.id)}" ${_isIn?'checked':''} onchange="if(this.checked) setNodeStack('${escapeHTML(_allStacks[0]||_defaultStackName(n))}', 1)"> ${t('pnl.node.stackMember')}</label>
</div>
${_isIn ? `<div class="prop-row2">
  <div class="prop-group"><label>${t('f.stackName')}</label>
    <input type="text" list="stack-ids-${escapeHTML(n.id)}" value="${escapeHTML(_stackId)}" onchange="setNodeStack(this.value, ${_mid})" data-tip="${t('pnl.node.stackNameTip')}">
    <datalist id="stack-ids-${escapeHTML(n.id)}">${_datalistOpts}</datalist>
  </div>
  <div class="prop-group"><label>${t('f.role')}</label>
    <select onchange="setNodeStackMemberId(parseInt(this.value,10))" data-tip="${t('pnl.node.stackRoleTip')}">
${(function(){
    // Costruisce le opzioni: Primary (#1), Secondary (#2), Member #3..10.
    // Mostra "(libero)" sulle posizioni non occupate (esclude se stesso),
    // "(occupato: name)" sulle altre. Il selezionato resta selezionabile.
    const opts = [];
    const _label = (mid) => mid===1 ? 'Primary (master)' : mid===2 ? 'Secondary' : `Member #${mid}`;
    for(let i=1;i<=10;i++){
        const taker = _members.find(m => (m.spec?.stackMemberId||0) === i && m.id !== n.id);
        const isThis = i === _mid;
        const disabled = !!taker && !isThis;
        const suffix = taker
            ? (isThis ? '' : ` — ${escapeHTML(taker.name||taker.id)}`)
            : '';
        opts.push(`<option value="${i}" ${isThis?'selected':''} ${disabled?'disabled':''}>${_label(i)}${suffix}</option>`);
    }
    return opts.join('');
})()}
    </select>
  </div>
</div>
<div class="stack-members-title">${t('pnl.node.currentMembers',{n:_members.length})}</div>
${_renderMembersList()}
<button class="toolbar-btn danger" style="width:100%;margin-top:6px;justify-content:center" onclick="removeNodeFromStack()"><i class="fas fa-unlink"></i> ${t('pnl.node.removeFromStack')}</button>` : ''}
</div>
</details>`;
                }

                // ---- HA pair / cluster (P8.1) ----
                // Visibile solo su tipi `haEligible` (firewall, router, wlanctrl,
                // nas, server, vpncon, sdwan, consolesvr). Modello tag-based
                // su `node.spec.haPeer` (pair 1-1) o `haGroupId` (cluster N>2).
                if(d.haEligible && !isRackFiller){
                    const _haPairOn    = isInHaPair(n);
                    const _haClusterOn = isInHaCluster(n);
                    const _haOn        = _haPairOn || _haClusterOn;
                    const _haRole      = n.spec?.haRole || n.haRole || 'active';
                    const _haMode      = n.spec?.haMode || n.haMode || 'active-passive';
                    const _haSync      = n.spec?.haSync || n.haSync || 'state-full';
                    const _haPeerObj   = _haPairOn ? getHaPeer(state.nodes, n) : null;
                    const _haGroupId   = _haClusterOn ? (n.spec?.haGroupId || n.haGroupId || '') : '';
                    const _haPartners  = _haOn ? getHaPartners(state.nodes, n) : [];
                    const _haSummary   = getHaSummary(state.nodes, n);
                    const _haAllGroups = getAllHaGroupIds(state.nodes);
                    // Possibili peer per pair: tutti i device haEligible diversi da n
                    const _haPeerOptions = state.nodes
                        .filter(x => x.id !== n.id && TYPES[x.type]?.haEligible)
                        .map(x => `<option value="${escapeHTML(x.id)}" ${_haPeerObj?.id === x.id ? 'selected' : ''}>${escapeHTML(x.name || x.hostname || x.id)} (${escapeHTML(typeName(x.type))})</option>`)
                        .join('');
                    const _haDatalistOpts = _haAllGroups.map(g => `<option value="${escapeHTML(g)}"></option>`).join('');
                    const _haPreview = _haSummary
                        ? `<span class="props-collapsible-preview">${escapeHTML(_haSummary)}</span>`
                        : `<span class="props-collapsible-preview muted">Standalone</span>`;
                    // Lista peer/cluster members
                    const _renderHaPartnersList = () => {
                        if(!_haPartners.length) return `<div style="font-size:0.7rem;color:var(--text-muted);padding:4px 0">${t('pnl.node.noPeerConfigured')}</div>`;
                        return `<div class="ha-partners-list">${_haPartners.map(p => {
                            const _pRole = p.spec?.haRole || p.haRole || 'active';
                            const _pLabel = `${escapeHTML(p.name || p.hostname || p.id)} · ${escapeHTML(_pRole)}`;
                            return `<div class="ha-partner-row">${_pLabel}</div>`;
                        }).join('')}</div>`;
                    };
                    _haHtml = `<details class="props-collapsible props-secondary" ${_propsSectionIsOpen('ha')?'open':''} ontoggle="setPropsSectionState('ha',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-shield-halved"></i> ${t('sec.ha')}</span>${_haPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
<div class="prop-check-grid" style="grid-template-columns:1fr 1fr 1fr;border-top:none;border-bottom:none;padding:0;margin-bottom:6px;gap:4px">
  <label class="prop-check" data-tip="${t('pnl.node.haStandaloneTip')}"><input type="radio" name="ha-mode-${escapeHTML(n.id)}" ${!_haOn?'checked':''} onchange="if(this.checked) removeNodeFromHa()"> Standalone</label>
  <label class="prop-check" data-tip="${t('pnl.node.haPairTip')}"><input type="radio" name="ha-mode-${escapeHTML(n.id)}" ${_haPairOn?'checked':''} onchange="if(this.checked){ const candidates=state.nodes.filter(x=>x.id!=='${escapeHTML(n.id)}' && TYPES[x.type]?.haEligible); if(candidates[0]) setNodeHaPair(candidates[0].id, 'active', 'active-passive'); else alert(t('msg.ui.noHaPeer')); }"> Pair (1-1)</label>
  <label class="prop-check" data-tip="${t('pnl.node.haClusterTip')}"><input type="radio" name="ha-mode-${escapeHTML(n.id)}" ${_haClusterOn?'checked':''} onchange="if(this.checked) setNodeHaCluster(_defaultHaGroupName(state.nodes.find(x=>x.id==='${escapeHTML(n.id)}')), 'active', 'cluster-N')"> Cluster (N>2)</label>
</div>
${_haPairOn ? `<div class="prop-row2">
  <div class="prop-group"><label>${t('f.peerDevice')}</label>
    <select onchange="setNodeHaPair(this.value, '${escapeHTML(_haRole)}', '${escapeHTML(_haMode)}')" data-tip="${t('pnl.node.haPeerTip')}">
      ${_haPeerOptions || `<option disabled selected>${t('o.noEligible')}</option>`}
    </select>
  </div>
  <div class="prop-group"><label>${t('f.role')}</label>
    <select onchange="setNodeHaRole(this.value)" data-tip="${t('pnl.node.haRolePairTip')}">
      <option value="active"  ${_haRole==='active'?'selected':''}>Active</option>
      <option value="standby" ${_haRole==='standby'?'selected':''}>Standby</option>
    </select>
  </div>
</div>
<div class="prop-row2" style="margin-top:4px">
  <div class="prop-group"><label>${t('f.mode')}</label>
    <select onchange="setNodeHaMode(this.value)" data-tip="${t('pnl.node.haModePairTip')}">
      <option value="active-passive" ${_haMode==='active-passive'?'selected':''}>Active-Passive</option>
      <option value="active-active"  ${_haMode==='active-active' ?'selected':''}>Active-Active</option>
    </select>
  </div>
  <div class="prop-group"><label>Sync</label>
    <select onchange="setNodeHaSync(this.value)" data-tip="${t('pnl.node.haSyncTip')}">
      <option value="state-full"     ${_haSync==='state-full'    ?'selected':''}>State-full</option>
      <option value="config-only"    ${_haSync==='config-only'   ?'selected':''}>Config-only</option>
      <option value="failover-only"  ${_haSync==='failover-only' ?'selected':''}>Failover-only</option>
    </select>
  </div>
</div>` : ''}
${_haClusterOn ? `<div class="prop-row2">
  <div class="prop-group"><label>${t('f.clusterName')}</label>
    <input type="text" list="ha-groups-${escapeHTML(n.id)}" value="${escapeHTML(_haGroupId)}" onchange="setNodeHaCluster(this.value, '${escapeHTML(_haRole)}', '${escapeHTML(_haMode)}')" data-tip="${t('pnl.node.haClusterNameTip')}">
    <datalist id="ha-groups-${escapeHTML(n.id)}">${_haDatalistOpts}</datalist>
  </div>
  <div class="prop-group"><label>${t('f.role')}</label>
    <select onchange="setNodeHaRole(this.value)" data-tip="${t('pnl.node.haRoleClusterTip')}">
      <option value="active"  ${_haRole==='active'?'selected':''}>Active</option>
      <option value="standby" ${_haRole==='standby'?'selected':''}>Standby</option>
      <option value="member"  ${_haRole==='member' ?'selected':''}>Member</option>
    </select>
  </div>
</div>
<div class="prop-row2" style="margin-top:4px">
  <div class="prop-group"><label>${t('f.mode')}</label>
    <select onchange="setNodeHaMode(this.value)" data-tip="${t('pnl.node.haModeClusterTip')}">
      <option value="cluster-N"      ${_haMode==='cluster-N'     ?'selected':''}>Cluster-N</option>
      <option value="active-passive" ${_haMode==='active-passive'?'selected':''}>Active-Passive</option>
      <option value="active-active"  ${_haMode==='active-active' ?'selected':''}>Active-Active</option>
    </select>
  </div>
  <div class="prop-group"><label>Sync</label>
    <select onchange="setNodeHaSync(this.value)">
      <option value="state-full"     ${_haSync==='state-full'    ?'selected':''}>State-full</option>
      <option value="config-only"    ${_haSync==='config-only'   ?'selected':''}>Config-only</option>
      <option value="failover-only"  ${_haSync==='failover-only' ?'selected':''}>Failover-only</option>
    </select>
  </div>
</div>` : ''}
${_haOn ? `<div class="ha-partners-title">${t('pnl.node.peersMembers',{n:_haPartners.length})}</div>
${_renderHaPartnersList()}
<button class="toolbar-btn danger" style="width:100%;margin-top:6px;justify-content:center" onclick="removeNodeFromHa()"><i class="fas fa-unlink"></i> ${t('pnl.node.removeFromHa')}</button>` : ''}
</div>
</details>`;
                }

                // ---- Patch Panel typology (PRIMARY device-specific per patchpanel) ----
                if(n.type==='patchpanel'){
                    const media = n.ppMedia || 'copper';
                    const cat = n.ppCopperCat || 'cat6';
                    const shield = n.ppCopperShield || 'utp';
                    const conn = n.ppFiberConnector || 'lc-duplex';
                    const mode = n.ppFiberMode || 'mm-om4';
                    const showCopper = (media==='copper' || media==='mixed');
                    const showFiber  = (media==='fiber'  || media==='mixed');
                    _patchPanelHtml = `<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-patchpanel')?'open':''} ontoggle="setPropsSectionState('device-patchpanel',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-bars"></i> Patch Panel</span>${_buildPatchPanelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
<div class="prop-group"><label>${t('f.ppCategory')}</label>
  <select onchange="updateN('ppMedia',this.value)">
    <option value="copper" ${selected(media,'copper')}>${t('o.copperRj45')}</option>
    <option value="fiber"  ${selected(media,'fiber')}>${t('o.fiberOdf')}</option>
    <option value="mixed"  ${selected(media,'mixed')}>${t('o.mixedModular')}</option>
  </select>
</div>
${showCopper ? `<div class="prop-row2">
  <div class="prop-group"><label>${t('f.copperStd')}</label>
    <select onchange="updateN('ppCopperCat',this.value)">
      <option value="cat5e" ${selected(cat,'cat5e')}>Cat 5e</option>
      <option value="cat6"  ${selected(cat,'cat6')}>Cat 6</option>
      <option value="cat6a" ${selected(cat,'cat6a')}>Cat 6A</option>
      <option value="cat7"  ${selected(cat,'cat7')}>Cat 7</option>
      <option value="cat8"  ${selected(cat,'cat8')}>Cat 8</option>
    </select>
  </div>
  <div class="prop-group"><label>${t('f.shielding')}</label>
    <select onchange="updateN('ppCopperShield',this.value)">
      <option value="utp" ${selected(shield,'utp')}>${t('pnl.node.shieldUtp')}</option>
      <option value="ftp" ${selected(shield,'ftp')}>${t('pnl.node.shieldFtp')}</option>
      <option value="stp" ${selected(shield,'stp')}>${t('pnl.node.shieldStp')}</option>
    </select>
  </div>
</div>` : ''}
${showFiber ? `<div class="prop-row2">
  <div class="prop-group"><label>${t('f.fiberConn')}</label>
    <select onchange="updateN('ppFiberConnector',this.value)">
      <option value="lc-simplex" ${selected(conn,'lc-simplex')}>LC simplex</option>
      <option value="lc-duplex"  ${selected(conn,'lc-duplex')}>LC duplex</option>
      <option value="sc"         ${selected(conn,'sc')}>SC</option>
      <option value="st"         ${selected(conn,'st')}>ST</option>
      <option value="fc"         ${selected(conn,'fc')}>FC</option>
      <option value="mpo-12"     ${selected(conn,'mpo-12')}>MTP/MPO-12</option>
      <option value="mpo-24"     ${selected(conn,'mpo-24')}>MTP/MPO-24</option>
    </select>
  </div>
  <div class="prop-group"><label>${t('f.fiberMode')}</label>
    <select onchange="updateN('ppFiberMode',this.value)">
      <option value="sm-os1" ${selected(mode,'sm-os1')}>SM — OS1</option>
      <option value="sm-os2" ${selected(mode,'sm-os2')}>SM — OS2</option>
      <option value="mm-om1" ${selected(mode,'mm-om1')}>MM — OM1</option>
      <option value="mm-om2" ${selected(mode,'mm-om2')}>MM — OM2</option>
      <option value="mm-om3" ${selected(mode,'mm-om3')}>MM — OM3</option>
      <option value="mm-om4" ${selected(mode,'mm-om4')}>MM — OM4</option>
      <option value="mm-om5" ${selected(mode,'mm-om5')}>MM — OM5</option>
    </select>
  </div>
</div>` : ''}
</div></details>`;
                }

                // ---- Rete & Accesso ----
                if(!isRackFiller){
                    if(n.type==='patchpanel'){
                        // Patch panel passivo: solo hostname, niente IP/Mgmt/MAC
                        _networkAccessHtml = `<details class="props-collapsible" ${_propsSectionIsOpen('network-access')?'open':''} ontoggle="setPropsSectionState('network-access',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-link"></i> ${t('sec.netAccess')}</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                            <div class="prop-group"><label>Hostname</label><input value="${escapeHTML(n.hostname||'')}" placeholder="${escapeHTML(d.brand)}" onchange="updateN('hostname',this.value);updateN('hostnameManual',!!this.value.trim())"></div>
                        </div></details>`;
                    } else {
                        _networkAccessHtml = _buildNetAccessHtml(n, d);
                    }
                }

                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input ${isRackFiller?'disabled':''} value="${escapeHTML(isRackFiller?fixedName:(n.name||''))}" placeholder="${escapeHTML(d.name)}" onchange="updateN('name',this.value)"></div>
                    <div class="prop-group"><label>${t('f.sizeU')}</label><input type="number" min="1" max="${rs}" value="${n.sizeU!==undefined?n.sizeU:d.sizeU}" onchange="updateN('sizeU',normalizeNumber(this.value,${d.sizeU},1,${rs}))"></div>
                    ${(() => {
                        const fromTop = isRackTopNumbered(n.rackId);
                        const sU = n.sizeU!==undefined?n.sizeU:d.sizeU;
                        const shown = fromTop ? rackUToVisible(n.rackId, n.rackU, sU) : n.rackU;
                        const lbl = fromTop ? t('f.posUTop') : t('f.posUBottom');
                        return `<div class="prop-group"><label>${lbl}</label><input type="number" min="1" max="${rs}" value="${shown}" onchange="updateN('rackU',normalizeNumber(${fromTop?`visibleUToRackU('${n.rackId}',+this.value,${sU})`:`+this.value`},1,1,${rs}))"></div>`;
                    })()}
                    <div class="prop-group">
                      <label style="display:flex;align-items:center;justify-content:space-between">
                        <span>${t('pnl.node.deviceColor')}</span>
                        <span style="display:flex;align-items:center;gap:6px">
                          <input type="color" value="${n.color||'#4a4a4a'}"
                                 style="width:38px;height:26px;padding:1px;cursor:pointer"
                                 onchange="updateN('color',this.value)">
                          <button class="toolbar-btn" type="button" style="padding:3px 8px;font-size:0.72rem"
                                  onclick="updateN('color','')">Reset</button>
                        </span>
                      </label>
                    </div>
                    ${state.racks.length > 1 ? `<div class="prop-group"><label>${t('f.parentRack')}</label>
                        <select onchange="if(this.value!==this.dataset.curr){if(moveNodeToRack('${n.id}',this.value))this.dataset.curr=this.value;else this.value=this.dataset.curr;}" data-curr="${n.rackId||''}">
                            ${state.racks.map(r => `<option value="${r.id}" ${r.id===n.rackId?'selected':''}>${escapeHTML(r.name)} (${r.sizeU||42}U)</option>`).join('')}
                        </select>
                    </div>` : ''}
                    `;
                h += _identityBlock;
                // ---- sezione LAG manuali (assemblata in fondo) ----
                if(d.isRack&&d.isActive){
                    const _lagMap=getLagGroupsForNode(n.id);
                    const _lagGids=Object.keys(_lagMap);
                    if(_lagGids.length>0){
                        const _totPorts = _lagGids.reduce((acc,gid)=>acc+_lagMap[gid].length,0);
                        const _previewLag = `<span class="props-collapsible-preview">${t('lag.preview',{g:_lagGids.length,p:_totPorts})}</span>`;
                        let lagHtml=`<details class="props-collapsible props-secondary" ${_propsSectionIsOpen('lag-groups')?'open':''} ontoggle="setPropsSectionState('lag-groups',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-circle-nodes"></i> ${t('sec.lag')}</span>${_previewLag}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body"><div class="lag-groups-section">`;
                        for(const gid of _lagGids){
                            const gname=(state.lagGroups&&state.lagGroups[gid])||'LAG';
                            const members=_lagMap[gid].map(m=>`<span class="lag-chip">P${escapeHTML(String(m.num))}</span>`).join('');
                            const _curMode=(state.lagModes&&state.lagModes[gid])||'';
                            // Coerenza dei MEMBRI (velocità/VLAN) + coerenza CROSS-END della
                            // modalità LACP, via lib/lag-audit.js — global bare (no ponte win.*
                            // → cricchetto invariato). Warning solo se c'è un problema reale
                            // (giudica solo dati documentati, niente invenzioni).
                            const _bits=[];
                            try {
                                if(typeof checkLagMembers==='function'){
                                    const _mm=_lagMap[gid].map(m=>{
                                        const _pi=(state.ports&&state.ports[m.pid])||{};
                                        const _sp=_pi.speedOvr!=null?_pi.speedOvr:(_pi.speed!=null?_pi.speed:null);
                                        const _vl=(typeof _effPortVlan==='function')?_effPortVlan(m.pid):null;
                                        return { num:m.num, speed:_sp, vlan:_vl };
                                    });
                                    const _c=checkLagMembers(_mm);
                                    const _fmt=s=>s>=1000?`${(s/1000).toFixed(s%1000?1:0)}G`:`${s}M`;
                                    if(_c.speedMismatch) _bits.push(t('lag.warnSpeed',{list:_c.speeds.map(_fmt).join(', ')}));
                                    if(_c.vlanMismatch)  _bits.push(t('lag.warnVlan',{list:_c.vlans.join(', ')}));
                                }
                                if(_curMode && typeof checkLagPair==='function'){
                                    const _peerMode=_lagPeerMode(_lagMap[gid]);
                                    const _pair=_peerMode?checkLagPair(_curMode,_peerMode):null;
                                    if(_pair) _bits.push(_pair.issue==='both-passive'?t('lag.warnBothPassive'):t('lag.warnLacpStatic'));
                                }
                            } catch(_){}
                            const _lagWarn=_bits.length?`<div class="lag-warn" style="font-size:0.72rem;color:#d29922;padding:2px 0 6px">⚠ ${escapeHTML(_bits.join(' · '))}</div>`:'';
                            const _modeSel=`<select class="lag-group-mode" onchange="setLagMode('${gid}',this.value)" data-tip="${t('lag.modeTip')}">`
                              +`<option value="" ${!_curMode?'selected':''}>${escapeHTML(t('lag.modeUnset'))}</option>`
                              +`<option value="active" ${_curMode==='active'?'selected':''}>${escapeHTML(t('lag.modeActive'))}</option>`
                              +`<option value="passive" ${_curMode==='passive'?'selected':''}>${escapeHTML(t('lag.modePassive'))}</option>`
                              +`<option value="static" ${_curMode==='static'?'selected':''}>${escapeHTML(t('lag.modeStatic'))}</option>`
                              +`</select>`;
                            lagHtml+=`<div class="lag-group-row">
                              <input class="lag-group-name" value="${escapeHTML(gname)}" placeholder="${t('pnl.node.lagNamePlaceholder')}" onchange="renameLag('${gid}',this.value)" data-tip="${t('pnl.node.renameLagGroup')}">
                              <span class="lag-chips">${members}</span>
                              ${_modeSel}
                              <button class="lag-group-del" onclick="dissolveLag('${gid}')" data-tip="${t('pnl.node.dissolveGroup')}">✕</button>
                            </div>${_lagWarn}`;
                        }
                        lagHtml+='</div></div></details>';
                        _lagHtml = lagHtml;
                    }
                }
            }
                // ---- Integrazione SNMP: device con IP (rack attivi/power E floor
                // come stampante/AP/webcam/NAS) → un solo pannello per tutti.
                if(d.isActive || d.hasIP || (n.integration && n.integration.driver)){
                const intg=n.integration||{};
                const drv=intg.driver||'';
                const showSnmp=drv==='snmp-v1'||drv==='snmp-v2c'||drv==='snmp-v3';
                const isV3=drv==='snmp-v3';
                // v3 rilevato dalla discovery ma ancora senza credenziali: stato
                // DERIVATO (driver v3 + utente USM vuoto) → si azzera da sé appena
                // l'utente compila l'utente. Niente flag da mantenere.
                const v3NeedsCreds = isV3 && !String(intg.v3user||'').trim();
                const lp=intg.lastPoll?new Date(intg.lastPoll).toLocaleString('it-IT'):'';
                const snmpStatusBlock = showSnmp ? (() => {
                  const st = n.snmpStatus;
                  if(!st) return '';
                  const lastOkStr  = n.snmpLastOk  ? new Date(n.snmpLastOk).toLocaleString('it-IT')  : '—';
                  const lastErrMsg = n.snmpError   ? escapeHTML(n.snmpError) : '';
                  if(st === 'ok'){
                    return `<div style="display:flex;align-items:center;gap:6px;margin-top:10px;padding:6px 8px;background:rgba(57,211,83,.08);border:1px solid rgba(57,211,83,.25);border-radius:5px;font-size:0.72rem">` + `<span class="snmp-dot ok" style="flex-shrink:0"></span>` + `<span style="color:#39d353;font-weight:600">SNMP OK</span>` + `<span style="color:var(--text-muted);margin-left:auto"><i class="fas fa-clock" style="margin-right:3px"></i>${lastOkStr}</span>` + `</div>`;
                  } else {
                    return `<div style="display:flex;flex-direction:column;gap:4px;margin-top:10px;padding:6px 8px;background:rgba(248,81,73,.08);border:1px solid rgba(248,81,73,.3);border-radius:5px;font-size:0.72rem">` + `<div style="display:flex;align-items:center;gap:6px">` + `<i class="fas fa-circle-exclamation" style="color:#f85149;flex-shrink:0"></i>` + `<span style="color:#f85149;font-weight:600">${t('pnl.node.snmpNotResponding')}</span>` + `<span style="color:var(--text-muted);margin-left:auto"><i class="fas fa-clock" style="margin-right:3px"></i>${new Date(intg.lastPoll).toLocaleString('it-IT')}</span>` + `</div>` + (lastErrMsg ? `<div style="color:var(--text-muted);padding-left:18px">${lastErrMsg}</div>` : '') + (n.snmpLastOk ? `<div style="color:var(--text-muted);padding-left:18px">${t('pnl.node.lastOk',{when:lastOkStr})}</div>` : '') + `</div>`;
                  }
                })() : '';
                // Info di sistema live (sysLocation/sysContact/uptime) — card
                // di sola lettura, palette grigia neutra per distinguerla dallo
                // stato OK/errore. Compare solo dopo un import che le ha trovate.
                const snmpSystemBlock = (showSnmp && intg.system && typeof intg.system === 'object') ? (() => {
                  const sy = intg.system;
                  const _row = (icon, label, val) => `<div style="display:flex;gap:8px;align-items:baseline;line-height:1.45"><i class="fas ${icon}" style="width:13px;text-align:center;color:var(--text-muted);flex-shrink:0"></i><span style="color:var(--text-muted);flex-shrink:0">${label}</span><span style="margin-left:auto;text-align:right;color:var(--text-main);word-break:break-word">${escapeHTML(val)}</span></div>`;
                  const rows = [];
                  if(sy.sysLocation)   rows.push(_row('fa-location-dot', t('intg.sysLocation'), sy.sysLocation));
                  if(sy.sysContact)    rows.push(_row('fa-user',         t('intg.sysContact'),  sy.sysContact));
                  if(sy.sysUpTimeText) rows.push(_row('fa-clock',        t('intg.sysUptime'),   sy.sysUpTimeText));
                  if(!rows.length) return '';
                  return `<div style="display:flex;flex-direction:column;gap:5px;margin-top:8px;padding:7px 9px;background:rgba(139,148,158,.07);border:1px solid rgba(139,148,158,.25);border-radius:5px;font-size:0.72rem">${rows.join('')}</div>`;
                })() : '';
                // Stato stampante live (Printer-MIB): barre toner/inchiostro per
                // colore + contapagine + stato. Stessa card grigia neutra; i colori
                // delle barre sono i colori fisici dell'inchiostro (CMYK).
                const snmpPrinterBlock = (showSnmp && intg.printer && typeof intg.printer === 'object') ? (() => {
                  const pr = intg.printer;
                  const SW = { cyan:'#22b8cf', magenta:'#e64980', yellow:'#fab005', black:'#ced4da', other:'#8b949e' };
                  const rows = (pr.supplies||[]).map(s => {
                    const sw = SW[s.color] || SW.other;
                    const pct = (typeof s.pct === 'number') ? s.pct : null;
                    const pctCol = pct===null ? 'var(--text-muted)' : pct<10 ? '#f85149' : pct<25 ? '#d29922' : 'var(--text-main)';
                    const fill = pct===null ? '' : `<span style="display:block;height:100%;width:${pct}%;background:${sw}"></span>`;
                    const tip = s.desc ? ` data-tip="${escapeHTML(s.desc)}"` : '';
                    return `<div style="display:flex;align-items:center;gap:7px"${tip}><span style="width:9px;height:9px;border-radius:2px;background:${sw};border:1px solid rgba(201,209,217,.25);flex-shrink:0"></span><span style="color:var(--text-muted);width:80px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(s.name||'')}</span><span style="flex:1;height:5px;background:rgba(139,148,158,.18);border-radius:3px;overflow:hidden">${fill}</span><span style="color:${pctCol};min-width:30px;text-align:right">${pct===null?'—':pct+'%'}</span></div>`;
                  });
                  const foot = [];
                  if(pr.pageCount) foot.push(`<span><i class="fas fa-file-lines" style="margin-right:4px"></i>${t('prt.pages')}: <span style="color:var(--text-main)">${Number(pr.pageCount).toLocaleString('it-IT')}</span></span>`);
                  if(pr.status)    foot.push(`<span><i class="fas fa-circle" style="font-size:7px;vertical-align:1px;margin-right:4px;color:${pr.status==='idle'?'#39d353':pr.status==='printing'?'#58a6ff':'#8b949e'}"></i>${t('prt.st.'+pr.status)}</span>`);
                  if(pr.hasError)  foot.push(`<span style="color:#f85149"><i class="fas fa-triangle-exclamation" style="margin-right:4px"></i>${t('prt.error')}</span>`);
                  const footHtml = foot.length ? `<div style="display:flex;gap:12px;flex-wrap:wrap;color:var(--text-muted);padding-top:4px;border-top:1px solid rgba(139,148,158,.15);margin-top:1px">${foot.join('')}</div>` : '';
                  if(!rows.length && !footHtml) return '';
                  return `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;padding:8px 9px;background:rgba(139,148,158,.07);border:1px solid rgba(139,148,158,.25);border-radius:5px;font-size:0.72rem">${rows.join('')}${footHtml}</div>`;
                })() : '';
                // Risorse host live (HOST-RESOURCES): CPU/RAM/dischi con barre
                // colorate per occupazione. Stessa card grigia neutra.
                const snmpHostResBlock = (showSnmp && intg.hostResources && typeof intg.hostResources === 'object') ? (() => {
                  const hr = intg.hostResources;
                  const _fb = v => { if(!v) return '0'; const u=['B','KB','MB','GB','TB','PB']; let x=v,i=0; while(x>=1024&&i<u.length-1){x/=1024;i++;} return (x>=100?Math.round(x):x.toFixed(1))+' '+u[i]; };
                  const _uc = p => p>=90?'#f85149':p>=75?'#d29922':'#3fb950';
                  const _row = (icon,label,pct,right,tip) => { const c=_uc(pct); const w=Math.max(0,Math.min(100,pct));
                    return `<div style="display:flex;align-items:center;gap:7px"${tip?` data-tip="${escapeHTML(tip)}"`:''}><i class="fas ${icon}" style="width:13px;text-align:center;color:var(--text-muted);flex-shrink:0"></i><span style="color:var(--text-muted);width:62px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(label)}</span><span style="flex:1;height:5px;min-width:24px;background:rgba(139,148,158,.18);border-radius:3px;overflow:hidden"><span style="display:block;height:100%;width:${w}%;background:${c}"></span></span><span style="color:${c};min-width:30px;text-align:right">${pct}%</span>${right?`<span style="color:var(--text-muted);min-width:54px;text-align:right">${escapeHTML(right)}</span>`:''}</div>`; };
                  const rows = [];
                  if(typeof hr.cpuLoad==='number') rows.push(_row('fa-microchip','CPU',hr.cpuLoad,hr.cpuCores?`${hr.cpuCores} core`:'',null));
                  if(hr.ram) rows.push(_row('fa-memory','RAM',hr.ram.pct,_fb(hr.ram.totalBytes),`${_fb(hr.ram.usedBytes)} / ${_fb(hr.ram.totalBytes)}`));
                  (hr.volumes||[]).forEach(v=>rows.push(_row('fa-hard-drive',v.name,v.pct,_fb(v.totalBytes),`${_fb(v.usedBytes)} / ${_fb(v.totalBytes)}`)));
                  if(!rows.length) return '';
                  return `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;padding:8px 9px;background:rgba(139,148,158,.07);border:1px solid rgba(139,148,158,.25);border-radius:5px;font-size:0.72rem">${rows.join('')}</div>`;
                })() : '';
                const snmpImportBlock = showSnmp ? `<div style="margin-top:10px"><button class="toolbar-btn primary" style="width:100%;font-size:0.78rem;padding:5px 6px" id="snmp-poll-btn" onclick="pollSNMP('${n.id}')"><i class="fas fa-network-wired"></i> ${t('snmp.import')}</button></div>` : '';
                // Avviso: device SNMPv3 rilevato dalla discovery senza credenziali.
                const snmpV3CredWarn = v3NeedsCreds ? `<div style="display:flex;align-items:center;gap:6px;margin-top:10px;padding:6px 8px;background:rgba(210,153,34,.10);border:1px solid rgba(210,153,34,.35);border-radius:5px;font-size:0.72rem"><i class="fas fa-key" style="color:#d29922;flex-shrink:0"></i><span style="color:#d29922;font-weight:600">${t('intg.v3NeedsCreds')}</span></div>` : '';
                const _intgPreview = (() => {
                    if(!showSnmp) return `<span class="props-collapsible-preview muted">${t('intg.noDriver')}</span>`;
                    const _drvLbl = drv==='snmp-v1'?'SNMPv1':drv==='snmp-v2c'?'SNMPv2c':'SNMPv3';
                    const _st = n.snmpStatus;
                    const _stHtml = v3NeedsCreds ? ` · <span style="color:#d29922"><i class="fas fa-key"></i> ${t('intg.v3todo')}</span>`
                                  : _st==='ok'  ? ` · <span style="color:#39d353">OK</span>`
                                  : _st==='err' ? ` · <span style="color:#f85149">${t('common.error')}</span>`
                                  : '';
                    return `<span class="props-collapsible-preview">${_drvLbl}${_stHtml}</span>`;
                })();
                _integrationHtml = `<details class="snmp-section props-collapsible props-secondary" ${_propsSectionIsOpen('integration')?'open':''} ontoggle="setPropsSectionState('integration',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-plug"></i> ${t('sec.integration')}</span>${_intgPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body"><div class="prop-group"><label>Driver</label><select onchange="updateIntegration('${n.id}','driver',this.value)"><option value="" ${selected(drv,'')}>${t('o.sepNone')}</option><option value="snmp-v1" ${selected(drv,'snmp-v1')}>SNMP v1</option><option value="snmp-v2c"${selected(drv,'snmp-v2c')}>SNMP v2c</option><option value="snmp-v3" ${selected(drv,'snmp-v3')}>SNMP v3</option></select></div>${showSnmp?`<div class="prop-group"><label>${t('f.hostOverride')}</label><input value="${escapeHTML(intg.host||'')}" placeholder="${t('pnl.node.useNodeIpPlaceholder')}" onchange="updateIntegration('${n.id}','host',this.value);updateIntegration('${n.id}','hostManual',!!this.value.trim())"></div><div class="prop-row2"><div class="prop-group"><label>${t('intg.udpPort')}</label><input type="number" value="${intg.port||161}" onchange="updateIntegration('${n.id}','port',+this.value)"></div><div class="prop-group"><label>Timeout (s)</label><input type="number" value="${intg.timeout||3}" onchange="updateIntegration('${n.id}','timeout',+this.value)"></div></div>${!isV3?`<div class="prop-group"><label>Community</label><input value="${escapeHTML(intg.community||'public')}" onchange="updateIntegration('${n.id}','community',this.value)"></div>`:''}${isV3?`<div class="prop-group"><label>${t('intg.usmUser')}</label><input value="${escapeHTML(intg.v3user||'')}" onchange="updateIntegration('${n.id}','v3user',this.value)"></div><div class="prop-row2"><div class="prop-group" style="flex:0 0 72px"><label>Auth</label><select onchange="updateIntegration('${n.id}','v3authProto',this.value)"><option ${selected(intg.v3authProto||'SHA','MD5')}>MD5</option><option ${selected(intg.v3authProto||'SHA','SHA')}>SHA</option></select></div><div class="prop-group"><label>${t('f.authPass')}</label><input type="password" value="${escapeHTML(intg.v3authPass||'')}" autocomplete="new-password" onchange="updateIntegration('${n.id}','v3authPass',this.value)"></div></div><div class="prop-row2"><div class="prop-group" style="flex:0 0 72px"><label>Priv</label><select onchange="updateIntegration('${n.id}','v3privProto',this.value)"><option ${selected(intg.v3privProto||'AES','DES')}>DES</option><option ${selected(intg.v3privProto||'AES','AES')}>AES</option></select></div><div class="prop-group"><label>${t('f.privPass')}</label><input type="password" value="${escapeHTML(intg.v3privPass||'')}" autocomplete="new-password" onchange="updateIntegration('${n.id}','v3privPass',this.value)"></div></div><div class="prop-group"><label>Security level</label><select onchange="updateIntegration('${n.id}','v3secLevel',this.value)"><option value="noAuthNoPriv"${selected(intg.v3secLevel||'authPriv','noAuthNoPriv')}>noAuthNoPriv</option><option value="authNoPriv"  ${selected(intg.v3secLevel||'authPriv','authNoPriv'  )}>authNoPriv</option><option value="authPriv"    ${selected(intg.v3secLevel||'authPriv','authPriv'    )}>authPriv</option></select></div><div class="prop-group"><label>${t('intg.context')}</label><input value="${escapeHTML(intg.v3context||'')}" placeholder="${t('pnl.node.v3ContextPlaceholder')}" data-tip="${t('pnl.node.v3ContextTip')}" onchange="updateIntegration('${n.id}','v3context',this.value)"></div>`:''}`:''}</div></details>${snmpV3CredWarn}${snmpStatusBlock}${snmpSystemBlock}${snmpPrinterBlock}${snmpHostResBlock}${snmpImportBlock}`;
                // Inventario non e' piu' una fisarmonica separata: i 4 campi
                // (Marca/Modello/Seriale/Firmware-OS) vengono inseriti come
                // primi campi dentro la fisarmonica device-specifica via
                // _buildInventoryFieldsHtml(n, d).
                _inventoryHtml = '';
                } // fine Integrazione SNMP (rack attivi/power + floor con IP)
            // ---- Blocchi device-specifici per tipo (estratti) ----
            // La lunga catena if(n.type===...) vive in app-properties-node-devices.js.
            // Floor → contributo a h (layout inline); rack/attivi → contributo a
            // _devSpecHtml (accordion device-spec), cucito nellassemblaggio qui sotto.
            {
                const _dc = _nodeDeviceChainHtml(n, d, _identityBlock);
                h += _dc.h;
                _devSpecHtml += _dc.devSpec;
                // FLOOR: la fisarmonica "Rete & Accesso" viene catturata in _dc.net dal
                // device-chain e ri-emessa QUI, DOPO la fisarmonica device-specifica già
                // dentro _dc.h → la 1a fisarmonica resta sempre quella del device.
                // (Sui rack _dc.net è vuoto: l'ordine è gestito dall'assemblaggio sotto.)
                if(!d.isRack) h += _dc.net || '';
            }
            // ---- Assemblaggio finale ordine fisarmoniche per device RACK ----
            // Ordine: Device-specifico (incluso Patch Panel) → Rete & Accesso →
            // Layout porte → LAG → Integrazione. I floor non usano queste
            // variabili (rimangono nel loro flusso lineare con h+= diretto).
            if(d.isRack){
                // Inventario (Marca/Modello/Seriale/Firmware) e' ora dentro
                // ogni fisarmonica device-specifica come primi campi; la
                // variabile _inventoryHtml resta a stringa vuota e non viene
                // concatenata qui.
                h += _devSpecHtml
                   + _patchPanelHtml
                   + _networkAccessHtml
                   + _layoutPortsHtml
                   + _stackingHtml
                   + _haHtml
                   + _lagHtml
                   + _integrationHtml;
            }
            // ---- Porte di rete (floor multi-porta) ----
            // PC dual-NIC, AP dual-uplink, stampante con NIC+mgmt, endpoint custom:
            // piu' interfacce fisiche distinte. Ogni porta diventa un LED collegabile
            // a un cavo separato (render .floor-ports). Disponibile su TUTTI i device
            // floor tranne i passivi (presa a muro, quadro), i pass-through (presa/
            // voip: la doppia connessione e' gia' data da passThrough) e le strutture
            // (stanza). Cap basso (8): un endpoint non ha decine di NIC.
            if(!d.isRack && !d.isPassive && !d.isStructural && !d.passThrough){
                const _fpc = n.ports!==undefined ? n.ports : (d.ports||1);
                const _fpcPrev = `<span class="props-collapsible-preview">${_fpc===1?t('pnl.node.portCountOne',{n:_fpc}):t('pnl.node.portCountMany',{n:_fpc})}</span>`;
                h+=`<details class="props-collapsible" ${_propsSectionIsOpen('floor-ports')?'open':''} ontoggle="setPropsSectionState('floor-ports',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-ethernet"></i> ${t('sec.netPorts')}</span>${_fpcPrev}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('field.portCount')}</label>
                      <input type="number" min="1" max="8" value="${_fpc}" onchange="updateN('ports',normalizeNumber(this.value,${d.ports||1},1,8))" data-tip="${t('pnl.node.floorPortsTip')}">
                    </div>
                    <p style="font-size:0.72rem;color:var(--text-muted);margin:6px 2px 0;line-height:1.4"><i class="fas fa-circle-info" style="margin-right:5px"></i>${t('pnl.node.floorPortsInfo')}</p>
                </div></details>`;
            }
            // (Bottone "Tenta collegamento automatico" e' stato spostato dentro
            // l'accordion "Rete & Accesso" — sotto il campo MAC, da cui dipende.)
            // (Wi-Fi: spunta + config ora vivono in fondo a "Rete & Accesso",
            //  dentro _buildNetAccessHtml — un solo punto per tutti i tipi.)
            // L3-lite: sezione "Gateway L3 / SVI" — appare solo se il device
            // instrada >=1 VLAN (deriva dal binding gateway, read-only).
            // Integrazione SNMP per i floor con IP (stampante/AP/webcam/NAS…):
            // stesso pannello dei rack, montato qui nel flusso lineare dei floor
            // (per i rack è già cucito nell'assemblaggio sopra).
            if(!d.isRack) h += _integrationHtml;
            if(typeof _l3SviSectionHtml === 'function') h += _l3SviSectionHtml(n.id);
            // Skin pannello custom (prototipo): solo device rack (hanno un frontale).
            if(d.isRack && typeof _panelSkinSectionHtml === 'function') h += _panelSkinSectionHtml(n);
            const _notesLen = (n.notes||'').trim().length;
            const _notesPreview = _notesLen
                ? `<span class="props-collapsible-preview">${t('notes.chars',{n:_notesLen})}</span>`
                : `<span class="props-collapsible-preview muted">${t('common.empty')}</span>`;
            h+=`<details class="props-collapsible props-secondary" ${_propsSectionIsOpen('notes')?'open':''} ontoggle="setPropsSectionState('notes',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-sticky-note"></i> ${t('common.notes')}</span>${_notesPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                <div class="prop-group">
                  <textarea rows="3" placeholder="${t('notes.placeholder')}"
                            onchange="updateN('notes',this.value)">${escapeHTML(n.notes||'')}</textarea>
                </div>
            </div></details>`;
            // (bottone Elimina ora nel menu kebab dell'header del pannello)
        }
        panel.innerHTML=h;
        _enableManualValueInProps(panel);
        _activatePropsTab(n.name||d.name);
}

// Chiamato dal dispatcher renderProps (core, bundle).
expose({ _renderNodeProps });
