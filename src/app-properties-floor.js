// ============================================================
// PROPERTIES PANEL — renderer CONTESTO PLANIMETRIA (ramo else, nessuna selezione)
// ============================================================
// MODULO ESM (migrato da lib/app-properties-floor.js): foglia del dispatcher
// renderProps() (ancora classic in app-properties.js, che lo chiama via window).
// Legge i builder condivisi del core (_buildPropsHeader/_propsSectionIsOpen) e i
// global legacy (state/IPAM/VLAN/voce) via win.*; `t` dal ponte.
// ASSE B (ritiro ponte): TUTTI gli handler inline del pannello (onclick/onchange/
// oninput) sono passati a data-act/data-change/data-input + azioni delegate
// registrate QUI (le fn sono importate dai moduli che le possiedono; restano anche
// in expose() per i pannelli non ancora migrati). Le fisarmoniche usano gia'
// data-toggle="props-section"; i 3 bottoni header espandi/comprimi/ripristina sono
// azioni CONDIVISE registrate in app-properties.js.
// `store._vlanIpamOpen` è il Set condiviso var-ificato in app.js (i writer classic lo
// mutano, qui si legge). NESSUN cambiamento di logica rispetto all'originale.

import { expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, normalizeNumber } from './app-util.js';
import { registerClickActions, registerChangeActions, registerInputActions } from './app-delegation.js';   // ASSE B: handler del pannello floor via event delegation (ex on* inline)
import { _propsSectionIsOpen, _buildPropsHeader } from './app-properties.js';   // ritiro ponte: lettura stato sezioni (ex win.*)
import { _isVoiceVlan, _siteNativeVlan,
         clearAllVlans, toggleVlanIpam, toggleGuestVlan, toggleMgmtVlan, toggleSiteNativeVlan,
         toggleVoiceVlan, _openVoiceAssignDialog, deleteVlanColor, addVlanColor,
         updateVlanName, updateVlanColor, updateVlanIpam, updateUiColor } from './app-vlan-autopoll.js';   // ritiro ponte: funzioni vlan/snmp + azioni card VLAN (ex win.*)
import { _enableManualValueInProps, _ipamUsageForVlan, _vlanIpam, _vlanIpamSummary, _clearPropsTab, toggleAbbrevNames } from './app.js';   // ritiro ponte: funzioni disc/props/vlan/hv (ex win.*)
import { toggleBgImageLock, scaleBgImage, scaleBgImageTo, fitBgImageToCanvas, clearMap, toggleFloorGrid, setBgImageOpacity } from './app-search-zoom-rack.js';   // ASSE B: azioni immagine di sfondo / griglia (ex on* inline)
import { openAdoptFromLeases } from './app-drift-adopt.js';   // ASSE B: adotta lease non documentati (ex onclick inline)
import { _l3Compute, _l3GatewayBindingHtml } from './app-l3.js';   // ritiro ponte: coda funzioni A (batch 1/2) (ex win.*)

// ASSE B (ritiro ponte): azioni delegate del pannello FLOOR. Gli argomenti (VLAN id,
// nome campo, delta, chiave colore UI) viaggiano in data-*; le fn sono importate dai
// moduli proprietari. I 3 bottoni espandi/comprimi/ripristina dell'header e le
// fisarmoniche (data-toggle) sono azioni CONDIVISE registrate in app-properties.js.
const _vid = (el) => +el.dataset.vid;   // il vid nel template e' numerico → ripristina il tipo
registerClickActions({
    'adopt-from-leases':  (el) => openAdoptFromLeases(_vid(el)),
    'vlan-clear-all':     () => clearAllVlans(),
    'vlan-ipam-toggle':   (el) => toggleVlanIpam(_vid(el)),
    'vlan-guest-toggle':  (el) => toggleGuestVlan(_vid(el)),
    'vlan-mgmt-toggle':   (el) => toggleMgmtVlan(_vid(el)),
    'vlan-native-toggle': (el) => toggleSiteNativeVlan(_vid(el)),
    'vlan-voice-toggle':  (el) => toggleVoiceVlan(_vid(el)),
    'vlan-voice-assign':  (el) => _openVoiceAssignDialog(_vid(el)),
    'vlan-delete':        (el) => deleteVlanColor(_vid(el)),
    'vlan-add':           () => addVlanColor(),
    'map-upload':         () => document.getElementById('map-upload')?.click(),
    'bg-lock-toggle':     () => toggleBgImageLock(),
    'bg-scale-step':      (el) => scaleBgImage(+el.dataset.delta),
    'bg-scale-reset':     () => scaleBgImageTo(1),
    'bg-fit':             () => fitBgImageToCanvas(),
    'bg-clear':           () => clearMap(),
});
registerChangeActions({
    'vlan-name':       (el) => updateVlanName(_vid(el), el.value),
    'vlan-color':      (el) => updateVlanColor(_vid(el), el.value),
    'vlan-ipam-field': (el) => updateVlanIpam(_vid(el), el.dataset.field, el.value),
    'floor-grid':      (el) => toggleFloorGrid(el.checked),
    'ui-color':        (el) => updateUiColor(el.dataset.uikey, el.value),
    'abbrev-names':    (el) => toggleAbbrevNames(el.checked),
});
registerInputActions({
    'bg-scale':   (el) => scaleBgImageTo(+el.value),
    'bg-opacity': (el) => setBgImageOpacity(+el.value),
});

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
                        ${u.dhcpOnlyCount?`<div class="vlan-ipam-occ-adopt"><span><i class="fas fa-triangle-exclamation"></i> ${t('floor.occUndoc',{n:u.dhcpOnlyCount})}</span><button type="button" class="vlan-ipam-adopt-btn" data-act="adopt-from-leases" data-vid="${vid}">${t('floor.occAdopt')}</button></div>`:''}
                      </div>`;
}

// Contesto progetto / nessuna selezione (ramo else).
export function _renderFloorProps(panel){
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
            `<span class="props-toggles"><button class="props-toggle-btn" data-act="props-expand-all" data-tip="${t('props.expandAll')}"><i class="fas fa-angles-down"></i></button><button class="props-toggle-btn" data-act="props-collapse-all" data-tip="${t('props.collapseAll')}"><i class="fas fa-angles-up"></i></button><button class="props-toggle-btn" data-act="props-reset-sections" data-tip="${t('props.resetSections')}"><i class="fas fa-rotate"></i></button></span>`,
            'props-title-upper'
        );
        let h = `${_panelHeader}
            <details class="props-collapsible props-primary" ${_propsSectionIsOpen('floor-vlan')?'open':''} data-toggle="props-section" data-section="floor-vlan">
              <summary class="props-collapsible-head"><span><i class="fas fa-network-wired"></i> VLAN</span>${_vlanPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
              <div class="props-collapsible-body">
                <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
                  <button class="toolbar-btn" style="padding:4px 10px;margin:0;font-size:0.74rem;background:var(--accent-soft);border-color:var(--accent);color:var(--text-main)" data-tip="${t('floor.clearAllVlansTip')}" data-act="vlan-clear-all"><i class="fas fa-trash-alt" style="margin-right:6px;color:var(--fault-color)"></i>${t('floor.clearAllVlans')}</button>
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
        try { if(typeof _l3Compute === 'function') (_l3Compute(false).rows || []).forEach(r => { _l3rows[r.vid] = r; }); } catch(_){}
        const _siteNat = (typeof _siteNativeVlan==='function') ? _siteNativeVlan() : 1;
        Object.keys(state.vlanColors).sort((a,b)=>+a-+b).forEach(v=>{
            const vid=normalizeNumber(v,1,1,4094);
            const _isNative = _siteNat === vid;
            const vname=escapeHTML(state.vlanNames?.[vid]||'');
            const usage=_ipamUsageForVlan(vid);
            const ipam=_vlanIpam(vid);
            const ipamOpen=store._vlanIpamOpen.has(vid);
            const ipamSummary=escapeHTML(_vlanIpamSummary(vid));
            const ipamWarn=(!usage.cidr && ipam?.subnet) || (usage.cidr && !usage.gatewayOk);
            const nearFull=!!(usage.cidr && usage.capacity && usage.pct>=90);   // subnet quasi piena → ambra a colpo d'occhio
            const summaryWarn=ipamWarn || nearFull;
            h+=`<div class="vlan-ipam-card${ipamOpen?' open':''}">
                  <div class="vlan-ipam-row">
                    <label style="margin:0;width:68px;font-size:0.78rem;flex-shrink:0;white-space:nowrap;font-weight:700;color:${escapeHTML(state.vlanColors[v]||'#8b949e')}">VLAN ${vid}</label>
                    <input type="text" value="${vname}" placeholder="${t('vlan.namePlaceholder')}"
                           style="flex:1;min-width:0;max-width:400px;padding:5px 7px;font-size:var(--fs-lg);background:var(--bg-color);border:1px solid var(--panel-border);border-radius:4px;color:var(--text-main)"
                           data-change="vlan-name" data-vid="${vid}">
                    <input type="color" value="${escapeHTML(state.vlanColors[v])}" data-change="vlan-color" data-vid="${vid}" style="width:32px;flex-shrink:0;padding:2px">
                    <button class="toolbar-btn${ipamOpen?' primary':''}" style="padding:3px 6px;margin:0" data-tip="${t('floor.ipamTip',{vid})}" data-act="vlan-ipam-toggle" data-vid="${vid}"><i class="fas fa-network-wired"></i></button>
                    <button class="toolbar-btn${(Array.isArray(state.guestVlans)&&state.guestVlans.map(Number).includes(vid))?' primary':''}" style="padding:3px 6px;margin:0" data-tip="${(Array.isArray(state.guestVlans)&&state.guestVlans.map(Number).includes(vid))?t('floor.guestOn'):t('floor.guestOff')}" data-act="vlan-guest-toggle" data-vid="${vid}"><i class="fas fa-user-group"></i></button>
                    <button class="toolbar-btn${(Array.isArray(state.mgmtVlans)&&state.mgmtVlans.map(Number).includes(vid))?' primary':''}" style="padding:3px 6px;margin:0" data-tip="${(Array.isArray(state.mgmtVlans)&&state.mgmtVlans.map(Number).includes(vid))?t('floor.mgmtOn'):t('floor.mgmtOff')}" data-act="vlan-mgmt-toggle" data-vid="${vid}"><i class="fas fa-screwdriver-wrench"></i></button>
                    <button class="toolbar-btn${_isNative?' primary':''}" style="padding:3px 6px;margin:0" data-tip="${_isNative?t('vlan.nativeUnmark'):t('vlan.nativeMark')}" data-act="vlan-native-toggle" data-vid="${vid}"><i class="fas fa-house"></i></button>
                    <button class="toolbar-btn${(typeof _isVoiceVlan==='function'&&_isVoiceVlan(vid))?' primary':''}" style="padding:3px 6px;margin:0" data-tip="${(typeof _isVoiceVlan==='function'&&_isVoiceVlan(vid))?t('voice.unmark'):t('voice.mark')}" data-act="vlan-voice-toggle" data-vid="${vid}"><i class="fas fa-phone"></i></button>
                    ${(typeof _isVoiceVlan==='function'&&_isVoiceVlan(vid))?`<button class="toolbar-btn" style="padding:3px 6px;margin:0" data-tip="${t('voice.assignTip')}" data-act="vlan-voice-assign" data-vid="${vid}"><i class="fas fa-arrow-right-to-bracket"></i></button>`:''}
                    <button class="toolbar-btn" style="padding:3px 6px;margin:0" data-act="vlan-delete" data-vid="${vid}"><i class="fas fa-times"></i></button>
                  </div>
                  ${(ipamSummary || ipamOpen) ? `<div class="vlan-ipam-summary${summaryWarn?' warn':''}">${ipamSummary ? `${ipamSummary}${nearFull?` · ${usage.pct}% — ${t('floor.occNearFull')}`:''}` : t('floor.noNetInfo')}</div>` : ''}
                  ${ipamOpen ? `<div class="vlan-ipam-fields">
                      <div class="prop-group">
                        <label>${t('floor.subnetCidr')}</label>
                        <input value="${escapeHTML(ipam?.subnet||'')}" placeholder="${t('floor.phSubnet',{vid})}" data-change="vlan-ipam-field" data-vid="${vid}" data-field="subnet">
                      </div>
                      <div class="prop-group">
                        <label>${t('f.gatewayIp')}</label>
                        <input value="${escapeHTML(ipam?.gateway||'')}" placeholder="${t('floor.phGateway',{vid})}" data-change="vlan-ipam-field" data-vid="${vid}" data-field="gateway">
                      </div>
                      <div class="prop-group" style="grid-column:1/-1">
                        <label>DNS</label>
                        <input value="${escapeHTML(ipam?.dns||'')}" placeholder="${t('floor.phDns')}" data-change="vlan-ipam-field" data-vid="${vid}" data-field="dns">
                      </div>
                      ${(typeof _l3GatewayBindingHtml==='function') ? _l3GatewayBindingHtml(vid, _l3rows[vid]) : ''}
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
                  <button class="toolbar-btn primary" style="padding:4px 9px;margin:0" data-act="vlan-add">${t('common.add')}</button>
                </div>
              </div>
            </details>
            <details class="props-collapsible props-primary" ${_propsSectionIsOpen('floor-bgimage')?'open':''} data-toggle="props-section" data-section="floor-bgimage">
              <summary class="props-collapsible-head"><span><i class="fas fa-map"></i> ${t('floor.imgSection')}</span>${_bgPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
              <div class="props-collapsible-body">
                <div class="prop-group" style="margin-bottom:10px">
                  <button class="panel-skin-btn primary" style="width:100%"
                          data-act="map-upload">
                    <i class="fas fa-upload"></i>
                    ${state.bgImage?t('floor.replaceMap'):t('floor.importMap')}
                  </button>
                </div>
                ${state.bgImage?`
                <div class="prop-group" style="${state.bgImageLocked?'opacity:0.38;pointer-events:none':''}">
                  <label>${t('f.bgScale')}</label>
                  <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
                    <button class="zoom-btn" style="background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:4px;padding:4px 9px" data-act="bg-scale-step" data-delta="-0.05"><i class="fas fa-minus"></i></button>
                    <input id="bg-scale-slider" type="range" min="0.1" max="5" step="0.05"
                           value="${(state.bgImageScale||1).toFixed(2)}"
                           style="flex:1;accent-color:var(--accent)"
                           data-input="bg-scale">
                    <button class="zoom-btn" style="background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:4px;padding:4px 9px" data-act="bg-scale-step" data-delta="0.05"><i class="fas fa-plus"></i></button>
                    <span id="bg-scale-lbl" style="font-size:0.78rem;min-width:42px;text-align:right">${Math.round((state.bgImageScale||1)*100)}%</span>
                  </div>
                  <button class="toolbar-btn" style="width:100%;margin-top:6px;font-size:0.75rem" data-act="bg-scale-reset"><i class="fas fa-undo" style="margin-right:4px"></i>${t('floor.reset100')}</button>
                </div>
                <div class="prop-group" style="margin-bottom:10px">
                  <button class="panel-skin-btn primary" style="width:100%"
                          data-act="bg-lock-toggle">
                    <i class="fas ${state.bgImageLocked?'fa-lock':'fa-lock-open'}"></i>
                    ${state.bgImageLocked?t('floor.mapLocked'):t('floor.lockScale')}
                  </button>
                </div>
                <div class="prop-group" style="margin-bottom:10px">
                  <label>${t('floor.mapOpacity')}</label>
                  <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
                    <i class="fas fa-circle-half-stroke" style="color:var(--text-muted);font-size:0.8rem"></i>
                    <input id="bg-opacity-slider" type="range" min="0.05" max="1" step="0.05"
                           value="${(state.bgImageOpacity ?? 0.4).toFixed(2)}"
                           style="flex:1;accent-color:var(--accent)"
                           data-input="bg-opacity">
                    <span id="bg-opacity-lbl" style="font-size:0.78rem;min-width:42px;text-align:right">${Math.round((state.bgImageOpacity ?? 0.4) * 100)}%</span>
                  </div>
                </div>
                <div style="display:flex;gap:6px">
                  <button class="toolbar-btn" style="flex:1" ${state.bgImageLocked?'disabled':''} data-act="bg-fit"><i class="fas fa-expand-arrows-alt"></i> ${t('floor.fitCanvas')}</button>
                  <button class="toolbar-btn danger" style="flex:1" data-act="bg-clear"><i class="fas fa-trash"></i> ${t('floor.removeMap')}</button>
                </div>`:''}
                <div class="prop-group" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;border-top:1px solid var(--panel-border);padding-top:10px">
                  <label style="margin:0">${t('floor.grid')}</label>
                  <label class="toggle-sw">
                    <input type="checkbox" ${state.gridHidden?'':'checked'} data-change="floor-grid">
                    <span class="toggle-track"></span>
                  </label>
                </div>
                <div class="prop-notes-header"><i class="fas fa-palette"></i> ${t('floor.colorsSection')}</div>
                <div class="prop-group"><label>${t('f.floorBg')}</label><input type="color" value="${escapeHTML(state.uiColors?.floorBg||'#0d1117')}" data-change="ui-color" data-uikey="floorBg"></div>
                <div class="prop-group"><label>${t('f.rackBg')}</label><input type="color" value="${escapeHTML(state.uiColors?.rackBg||'#ffffff')}" data-change="ui-color" data-uikey="rackBg"></div>
                <div class="prop-notes-header"><i class="fas fa-tag"></i> ${t('floor.labelsSection')}</div>
                <div class="prop-group" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
                  <label style="margin:0">${t('f.abbrevNames')}</label>
                  <label class="toggle-sw" data-tip="${t('f.abbrevNamesTip')}">
                    <input type="checkbox" ${state.abbrevNames?'checked':''} data-change="abbrev-names">
                    <span class="toggle-track"></span>
                  </label>
                </div>
              </div>
            </details>`;
        panel.innerHTML=h;
        _enableManualValueInProps(panel);
        _clearPropsTab();
}

// Chiamato dal dispatcher renderProps() (app-properties.js, ancora classic).
expose({ _renderFloorProps });
