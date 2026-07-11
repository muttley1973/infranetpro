// ============================================================
// PROPERTIES PANEL — renderer CONTESTO PLANIMETRIA (ramo else, nessuna selezione)
// ============================================================
// MODULO ESM (migrato da lib/app-properties-floor.js): foglia del dispatcher
// renderProps() (ancora classic in app-properties.js, che lo chiama via window).
// Legge i builder condivisi del core (_buildPropsHeader/_propsSectionIsOpen) e i
// global legacy (state/IPAM/VLAN/voce) via win.*; `t` dal ponte. I nomi dentro gli
// onclick=""/ontoggle="" dell'HTML generato girano in scope PAGINA → restano bare.
// `store._vlanIpamOpen` è il Set condiviso var-ificato in app.js (i writer classic lo
// mutano, qui si legge). NESSUN cambiamento di logica rispetto all'originale.

import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, normalizeNumber } from './app-util.js';
import { _propsSectionIsOpen, _buildPropsHeader } from './app-properties.js';   // ritiro ponte: lettura stato sezioni (ex win.*)
import { _isVoiceVlan, _siteNativeVlan } from './app-vlan-autopoll.js';   // ritiro ponte: funzioni topo/discovery/vlan/snmp (ex win.*)
import { _enableManualValueInProps } from './app.js';   // ritiro ponte: funzioni disc/props/vlan/hv (ex win.*)

// Blocco "Occupazione" della card IPAM aperta: barra di capacità + ripartizione
// documentati / solo-DHCP / liberi (dati da _ipamUsageForVlan → lib/ipam.js,
// opzione A = realtà sul filo). La fonte "DHCP" appare solo se ci sono lease nel
// CIDR (manual-first: senza lease il blocco resta utile coi soli documentati).
// Solo numeri + stringhe t() fidate → nessun escape necessario.
function _ipamOccHtml(u, vid){
    const cap = u.capacity || 0;
    const near = cap > 0 && u.pct >= 90;                       // subnet quasi piena → ambra
    const docColor = near ? '#f5a623' : '#00d4ff';
    const docW = cap ? Math.min(100, (u.documentedCount / cap) * 100) : 0;
    const dhcpW = cap ? Math.min(Math.max(100 - docW, 0), (u.dhcpOnlyCount / cap) * 100) : 0;
    const legend = [`<span><i class="dot" style="background:${docColor}"></i>${t('floor.occDocumented',{n:u.documentedCount})}</span>`];
    if(u.dhcpOnlyCount) legend.push(`<span><i class="dot" style="background:#f5a623"></i>${t('floor.occDhcpOnly',{n:u.dhcpOnlyCount})}</span>`);
    legend.push(`<span><i class="dot dot-free"></i>${t('floor.occFree',{n:u.freeCount})}</span>`);
    return `<div class="vlan-ipam-occ${near?' near':''}" style="grid-column:1/-1">
                        <div class="vlan-ipam-occ-hd"><span>${t('floor.occupancy')}</span>${u.leaseInCidr?`<span class="vlan-ipam-occ-src">DHCP</span>`:''}</div>
                        <div class="vlan-ipam-occ-bar"><i style="width:${docW.toFixed(1)}%;background:${docColor}"></i><i style="width:${dhcpW.toFixed(1)}%;background:#f5a623"></i></div>
                        <div class="vlan-ipam-occ-meta">${u.usedCount} / ${cap} · ${u.pct}%</div>
                        <div class="vlan-ipam-occ-leg">${legend.join('')}</div>
                        ${!u.gatewayOk?`<div class="vlan-ipam-occ-warn">${t('floor.gwOutSubnet')}</div>`:''}
                        ${u.dhcpOnlyCount?`<div class="vlan-ipam-occ-adopt"><span><i class="fas fa-triangle-exclamation"></i> ${t('floor.occUndoc',{n:u.dhcpOnlyCount})}</span><button type="button" class="vlan-ipam-adopt-btn" onclick="openAdoptFromLeases(${vid})">${t('floor.occAdopt')}</button></div>`:''}
                      </div>`;
}

// Contesto progetto / nessuna selezione (ramo else).
function _renderFloorProps(panel){
        const state = store.state;
        // ─────────────────────────────────────────────────────────────
        // Contesto progetto — pannello a fisarmoniche.
        // Pattern uniforme con gli altri pannelli proprieta'.
        // Default open: Immagine, VLAN. Default closed: Colori, Etichette.
        // NB: auto-poll SNMP e rinnovo IP (DHCP) vivono ora nel popover
        // "Automazioni rete" in header (renderAutomationMenu), non qui.
        // Stato persistito in localStorage via setPropsSectionState.
        // ─────────────────────────────────────────────────────────────
        const _vlanCount = Object.keys(state.vlanColors).length;
        const _bgPreview = state.bgImage
            ? `<span class="props-collapsible-preview" style="color:var(--active-color)">${t('floor.mapLoaded')}${state.bgImageLocked?' · 🔒':''}</span>`
            : `<span class="props-collapsible-preview" style="color:var(--text-muted)">${t('floor.noMap')}</span>`;
        const _vlanPreview = `<span class="props-collapsible-preview">${t('floor.vlanCount',{n:_vlanCount})}</span>`;
        const _panelHeader = _buildPropsHeader(
            t('floor.title'),
            t('floor.subtitle'),
            'fa-map',
            `<span class="props-toggles"><button class="props-toggle-btn" onclick="_propsExpandAll()" data-tip="${t('props.expandAll')}"><i class="fas fa-angles-down"></i></button><button class="props-toggle-btn" onclick="_propsCollapseAll()" data-tip="${t('props.collapseAll')}"><i class="fas fa-angles-up"></i></button><button class="props-toggle-btn" onclick="_propsResetSections()" data-tip="${t('props.resetSections')}"><i class="fas fa-rotate"></i></button></span>`,
            'props-title-upper'
        );
        let h = `${_panelHeader}
            <details class="props-collapsible props-primary" ${_propsSectionIsOpen('floor-bgimage')?'open':''} ontoggle="setPropsSectionState('floor-bgimage',this.open)">
              <summary class="props-collapsible-head"><span><i class="fas fa-map"></i> ${t('floor.imgSection')}</span>${_bgPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
              <div class="props-collapsible-body">
                <div class="prop-group" style="margin-bottom:10px">
                  <button class="toolbar-btn primary" style="width:100%;justify-content:center;gap:8px"
                          onclick="document.getElementById('map-upload').click()">
                    <i class="fas fa-upload"></i>
                    ${state.bgImage?t('floor.replaceMap'):t('floor.importMap')}
                  </button>
                </div>
                ${state.bgImage?`
                <div class="prop-group" style="margin-bottom:10px">
                  <button class="toolbar-btn${state.bgImageLocked?' primary':''}" style="width:100%;justify-content:center;gap:8px"
                          onclick="toggleBgImageLock()">
                    <i class="fas ${state.bgImageLocked?'fa-lock':'fa-lock-open'}"></i>
                    ${state.bgImageLocked?t('floor.mapLocked'):t('floor.lockScale')}
                  </button>
                </div>
                <div class="prop-group" style="${state.bgImageLocked?'opacity:0.38;pointer-events:none':''}">
                  <label>${t('f.bgScale')}</label>
                  <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
                    <button class="zoom-btn" style="background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:4px;padding:4px 9px" onclick="scaleBgImage(-0.05)"><i class="fas fa-minus"></i></button>
                    <input id="bg-scale-slider" type="range" min="0.1" max="5" step="0.05"
                           value="${(state.bgImageScale||1).toFixed(2)}"
                           style="flex:1;accent-color:var(--accent)"
                           oninput="scaleBgImageTo(+this.value)">
                    <button class="zoom-btn" style="background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:4px;padding:4px 9px" onclick="scaleBgImage(0.05)"><i class="fas fa-plus"></i></button>
                    <span id="bg-scale-lbl" style="font-size:0.78rem;min-width:42px;text-align:right">${Math.round((state.bgImageScale||1)*100)}%</span>
                  </div>
                  <button class="toolbar-btn" style="width:100%;margin-top:6px;font-size:0.75rem" onclick="scaleBgImageTo(1)"><i class="fas fa-undo" style="margin-right:4px"></i>${t('floor.reset100')}</button>
                </div>
                <div class="prop-group" style="margin-bottom:10px">
                  <label>${t('floor.mapOpacity')}</label>
                  <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
                    <i class="fas fa-circle-half-stroke" style="color:var(--text-muted);font-size:0.8rem"></i>
                    <input id="bg-opacity-slider" type="range" min="0.05" max="1" step="0.05"
                           value="${(state.bgImageOpacity ?? 0.4).toFixed(2)}"
                           style="flex:1;accent-color:var(--accent)"
                           oninput="setBgImageOpacity(+this.value)">
                    <span id="bg-opacity-lbl" style="font-size:0.78rem;min-width:42px;text-align:right">${Math.round((state.bgImageOpacity ?? 0.4) * 100)}%</span>
                  </div>
                </div>
                <div style="display:flex;gap:6px">
                  <button class="toolbar-btn" style="flex:1" ${state.bgImageLocked?'disabled':''} onclick="fitBgImageToCanvas()"><i class="fas fa-expand-arrows-alt"></i> ${t('floor.fitCanvas')}</button>
                  <button class="toolbar-btn danger" style="flex:1" onclick="clearMap()"><i class="fas fa-trash"></i> ${t('floor.removeMap')}</button>
                </div>`:''}
                <div class="prop-group" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;border-top:1px solid var(--panel-border);padding-top:10px">
                  <label style="margin:0">${t('floor.grid')}</label>
                  <label class="toggle-sw">
                    <input type="checkbox" ${state.gridHidden?'':'checked'} onchange="toggleFloorGrid(this.checked)">
                    <span class="toggle-track"></span>
                  </label>
                </div>
                <div class="prop-notes-header"><i class="fas fa-palette"></i> ${t('floor.colorsSection')}</div>
                <div class="prop-group"><label>${t('f.floorBg')}</label><input type="color" value="${escapeHTML(state.uiColors?.floorBg||'#0d1117')}" onchange="updateUiColor('floorBg',this.value)"></div>
                <div class="prop-group"><label>${t('f.rackBg')}</label><input type="color" value="${escapeHTML(state.uiColors?.rackBg||'#ffffff')}" onchange="updateUiColor('rackBg',this.value)"></div>
                <div class="prop-notes-header"><i class="fas fa-tag"></i> ${t('floor.labelsSection')}</div>
                <div class="prop-group" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
                  <label style="margin:0">${t('f.abbrevNames')}</label>
                  <label class="toggle-sw" data-tip="${t('f.abbrevNamesTip')}">
                    <input type="checkbox" ${state.abbrevNames?'checked':''} onchange="toggleAbbrevNames(this.checked)">
                    <span class="toggle-track"></span>
                  </label>
                </div>
              </div>
            </details>
            <details class="props-collapsible props-primary" ${_propsSectionIsOpen('floor-vlan')?'open':''} ontoggle="setPropsSectionState('floor-vlan',this.open)">
              <summary class="props-collapsible-head"><span><i class="fas fa-network-wired"></i> VLAN</span>${_vlanPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
              <div class="props-collapsible-body">
                <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
                  <button class="toolbar-btn" style="padding:4px 10px;margin:0;font-size:0.74rem;background:var(--accent-soft);border-color:var(--accent);color:var(--text-main)" data-tip="${t('floor.clearAllVlansTip')}" onclick="clearAllVlans()"><i class="fas fa-trash-alt" style="margin-right:6px;color:var(--fault-color)"></i>${t('floor.clearAllVlans')}</button>
                </div>
                <div style="max-height:640px;overflow-y:auto;padding-right:4px">`;
        // F6: memo IPAM per-frame — _l3Compute e OGNI card VLAN chiamano _ipamUsageForVlan/
        // _vlanIpamSummary, e ciascuna ri-scandisce tutti i nodi + lease. Le accentro in
        // 1 sola scansione per questa resa (sincrona) → poi il memo si azzera nel finally,
        // niente staleness fuori. Bare + typeof guard: se assente, resa piu' lenta ma
        // corretta.
        if(typeof _ipamMemoBegin === 'function') _ipamMemoBegin();
        try {
        // L3-lite: righe gateway calcolate UNA volta (non per card) per la
        // riga "Device gateway" dentro ogni IPAM aperta.
        const _l3rows = {};
        try { if(typeof win._l3Compute === 'function') (win._l3Compute(false).rows || []).forEach(r => { _l3rows[r.vid] = r; }); } catch(_){}
        const _siteNat = (typeof _siteNativeVlan==='function') ? _siteNativeVlan() : 1;
        Object.keys(state.vlanColors).sort((a,b)=>+a-+b).forEach(v=>{
            const vid=normalizeNumber(v,1,1,4094);
            const _isNative = _siteNat === vid;
            const vname=escapeHTML(state.vlanNames?.[vid]||'');
            const usage=win._ipamUsageForVlan(vid);
            const ipam=win._ipamEntry(vid);
            const ipamOpen=store._vlanIpamOpen.has(vid);
            const ipamSummary=escapeHTML(win._vlanIpamSummary(vid));
            const ipamWarn=(!usage.cidr && ipam?.subnet) || (usage.cidr && !usage.gatewayOk);
            const nearFull=!!(usage.cidr && usage.capacity && usage.pct>=90);   // subnet quasi piena → ambra a colpo d'occhio
            const summaryWarn=ipamWarn || nearFull;
            h+=`<div class="vlan-ipam-card${ipamOpen?' open':''}">
                  <div class="vlan-ipam-row">
                    <label style="margin:0;width:68px;font-size:0.78rem;flex-shrink:0;white-space:nowrap;font-weight:700;color:${escapeHTML(state.vlanColors[v]||'#8b949e')}">VLAN ${vid}</label>
                    <input type="text" value="${vname}" placeholder="${t('vlan.namePlaceholder')}"
                           style="flex:1;min-width:0;max-width:400px;padding:5px 7px;font-size:var(--fs-lg);background:var(--bg-color);border:1px solid var(--panel-border);border-radius:4px;color:var(--text-main)"
                           onchange="updateVlanName(${vid},this.value)">
                    <input type="color" value="${escapeHTML(state.vlanColors[v])}" onchange="updateVlanColor(${vid},this.value)" style="width:32px;flex-shrink:0;padding:2px">
                    <button class="toolbar-btn${ipamOpen?' primary':''}" style="padding:3px 6px;margin:0" data-tip="${t('floor.ipamTip',{vid})}" onclick="toggleVlanIpam(${vid})"><i class="fas fa-network-wired"></i></button>
                    <button class="toolbar-btn${(Array.isArray(state.guestVlans)&&state.guestVlans.map(Number).includes(vid))?' primary':''}" style="padding:3px 6px;margin:0" data-tip="${(Array.isArray(state.guestVlans)&&state.guestVlans.map(Number).includes(vid))?t('floor.guestOn'):t('floor.guestOff')}" onclick="toggleGuestVlan(${vid})"><i class="fas fa-user-group"></i></button>
                    <button class="toolbar-btn${(Array.isArray(state.mgmtVlans)&&state.mgmtVlans.map(Number).includes(vid))?' primary':''}" style="padding:3px 6px;margin:0" data-tip="${(Array.isArray(state.mgmtVlans)&&state.mgmtVlans.map(Number).includes(vid))?t('floor.mgmtOn'):t('floor.mgmtOff')}" onclick="toggleMgmtVlan(${vid})"><i class="fas fa-screwdriver-wrench"></i></button>
                    <button class="toolbar-btn${_isNative?' primary':''}" style="padding:3px 6px;margin:0" data-tip="${_isNative?t('vlan.nativeUnmark'):t('vlan.nativeMark')}" onclick="toggleSiteNativeVlan(${vid})"><i class="fas fa-house"></i></button>
                    <button class="toolbar-btn${(typeof _isVoiceVlan==='function'&&_isVoiceVlan(vid))?' primary':''}" style="padding:3px 6px;margin:0" data-tip="${(typeof _isVoiceVlan==='function'&&_isVoiceVlan(vid))?t('voice.unmark'):t('voice.mark')}" onclick="toggleVoiceVlan(${vid})"><i class="fas fa-phone"></i></button>
                    ${(typeof _isVoiceVlan==='function'&&_isVoiceVlan(vid))?`<button class="toolbar-btn" style="padding:3px 6px;margin:0" data-tip="${t('voice.assignTip')}" onclick="_openVoiceAssignDialog(${vid})"><i class="fas fa-arrow-right-to-bracket"></i></button>`:''}
                    <button class="toolbar-btn" style="padding:3px 6px;margin:0" onclick="deleteVlanColor(${vid})"><i class="fas fa-times"></i></button>
                  </div>
                  ${(ipamSummary || ipamOpen) ? `<div class="vlan-ipam-summary${summaryWarn?' warn':''}">${ipamSummary ? `${ipamSummary}${nearFull?` · ${usage.pct}% — ${t('floor.occNearFull')}`:''}` : t('floor.noNetInfo')}</div>` : ''}
                  ${ipamOpen ? `<div class="vlan-ipam-fields">
                      <div class="prop-group">
                        <label>${t('floor.subnetCidr')}</label>
                        <input value="${escapeHTML(ipam?.subnet||'')}" placeholder="${t('floor.phSubnet',{vid})}" onchange="updateVlanIpam(${vid},'subnet',this.value)">
                      </div>
                      <div class="prop-group">
                        <label>${t('f.gatewayIp')}</label>
                        <input value="${escapeHTML(ipam?.gateway||'')}" placeholder="${t('floor.phGateway',{vid})}" onchange="updateVlanIpam(${vid},'gateway',this.value)">
                      </div>
                      <div class="prop-group" style="grid-column:1/-1">
                        <label>DNS</label>
                        <input value="${escapeHTML(ipam?.dns||'')}" placeholder="${t('floor.phDns')}" onchange="updateVlanIpam(${vid},'dns',this.value)">
                      </div>
                      ${(typeof win._l3GatewayBindingHtml==='function') ? win._l3GatewayBindingHtml(vid, _l3rows[vid]) : ''}
                      ${!ipam?.subnet ? `<div class="vlan-ipam-hint">${t('floor.hintNoSubnet')}</div>`
                        : !usage.cidr ? `<div class="vlan-ipam-hint warn">${t('floor.hintBadCidr')}</div>`
                        : _ipamOccHtml(usage, vid)}
                    </div>` : ''}
                </div>`;
        });
        } finally {
            if(typeof _ipamMemoEnd === 'function') _ipamMemoEnd();
        }
        h+=`</div>
                <div style="display:flex;gap:5px;margin-top:12px;border-top:1px solid var(--panel-border);padding-top:10px">
                  <input type="number" id="new-vlan-id" placeholder="ID" style="width:55px">
                  <input type="color" id="new-vlan-color" value="#00d4ff" style="flex:1">
                  <button class="toolbar-btn primary" style="padding:4px 9px;margin:0" onclick="addVlanColor()">${t('common.add')}</button>
                </div>
              </div>
            </details>`;
        panel.innerHTML=h;
        _enableManualValueInProps(panel);
        win._clearPropsTab();
}

// Chiamato dal dispatcher renderProps() (app-properties.js, ancora classic).
expose({ _renderFloorProps });
