// ============================================================
// PROPERTIES PANEL — CORE (dispatcher renderProps + builder condivisi)
// ============================================================
// MODULO ESM (migrato da lib/app-properties.js): il cuore del pannello proprietà.
// Dispatcher renderProps() → delega ai 4 renderer (_renderNodeProps ancora classic;
// port/link/floor già nel bundle) via win.*. I builder condivisi (_buildPropsHeader,
// _buildNetAccessHtml, _propsSectionIsOpen, setPropsSectionState, _props*) sono usati
// da MOLTI file classic + dalle foglie + dagli onclick/ontoggle inline → expose().
// Stato sezioni (_propsSectionsState) è module-private (nessuno lo legge da fuori).
// Simboli legacy via win.*; t dal ponte; nomi negli onclick="" restano bare.
// Nessun cambiamento di logica rispetto all'originale.
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML } from './app-util.js';
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)

// ---- Preferenze apertura sezioni (fisarmoniche) — estratte da app.js (R1) ----
const _PROPS_SECTIONS_PREF_KEY = 'infranet.props.sections.v1';
let _propsSectionsState = { integration:true };

try{
    const saved = JSON.parse(localStorage.getItem(_PROPS_SECTIONS_PREF_KEY) || '{}');
    if(saved && typeof saved === 'object') _propsSectionsState = { ..._propsSectionsState, ...saved };
}catch(_){}

/** Default d'apertura per ID sezione del pannello proprieta.
 *  Le sezioni "ad alta frequenza" (Rete&Accesso, Layout porte, blocco
 *  specifico device) sono aperte; quelle "rare" (LAG, Integrazione)
 *  sono chiuse. L'utente puo' sempre cambiare e la scelta viene
 *  persistita in localStorage. */
const _PROPS_DEFAULT_CLOSED = new Set([
    'lag-groups',
    'integration',
    'notes',
    // Contesto planimetria: tieni aperte solo le 2 sezioni piu' usate
    // (Immagine, VLAN). Colori si apre on-demand. (Auto-poll e rinnovo IP
    // sono usciti dal pannello → popover "Automazioni rete" in header.)
    'floor-colors',
]);
export function _propsSectionIsOpen(key){
    if(key in _propsSectionsState) return _propsSectionsState[key] !== false;
    return !_PROPS_DEFAULT_CLOSED.has(key);
}

function setPropsSectionState(key, open){
    _propsSectionsState[key] = !!open;
    try{ localStorage.setItem(_PROPS_SECTIONS_PREF_KEY, JSON.stringify(_propsSectionsState)); }catch(_){}
}

/** Espande/comprime tutte le fisarmoniche del pannello proprieta correnti.
 *  Imposta l'attributo open e dispatcha 'toggle' cosi setPropsSectionState
 *  viene chiamato dall'ontoggle inline e lo stato persiste. */
function _propsExpandAll(){
    document.querySelectorAll('#props-panel details.props-collapsible:not([open])').forEach(d => {
        d.open = true; d.dispatchEvent(new Event('toggle'));
    });
}
function _propsCollapseAll(){
    document.querySelectorAll('#props-panel details.props-collapsible[open]').forEach(d => {
        d.open = false; d.dispatchEvent(new Event('toggle'));
    });
}
/** Ripristina lo stato d'apertura predefinito: cancella le preferenze
 *  utente e applica i default intelligenti (chiusi: LAG, Integrazione, Note;
 *  aperti: gli altri). */
function _propsResetSections(){
    _propsSectionsState = {};
    try{ localStorage.removeItem(_PROPS_SECTIONS_PREF_KEY); }catch(_){}
    renderProps();
}
/** Toggle del menu kebab dell'header del pannello proprieta. */
function _propsKebabToggle(e){
    if(e) e.stopPropagation();
    const m = document.getElementById('props-kebab-menu');
    if(!m) return;
    const open = m.style.display === 'block';
    m.style.display = open ? 'none' : 'block';
    if(!open){
        // chiusura sul click fuori (one-shot)
        setTimeout(()=>{
            const off = (ev)=>{
                if(!ev.target.closest('.props-kebab-wrap')){
                    _propsKebabClose();
                    document.removeEventListener('click', off);
                }
            };
            document.addEventListener('click', off);
        }, 10);
    }
}
function _propsKebabClose(){
    const m = document.getElementById('props-kebab-menu');
    if(m) m.style.display = 'none';
}

// ============================================================
// PROPERTIES PANEL FRONTEND
// Rendering pannello propriet? per nodi, porte, cavi e contesto floor.
// ============================================================

/** Costruisce la fisarmonica "Rete & Accesso" (Hostname/IP/Mgmt/MAC)
 *  usata uniformemente da rack e floor.
 *  Opzioni:
 *    - includeHostname (bool, default true)
 *    - ipPlaceholder   (string, default '192.168...')
 *    - showMac         (bool, default true)
 *    - macLabel        (string, default 'MAC address')
 *    - macPlaceholder  (string, default '00:11:22:33:44:55')
 *  Ritorna stringa HTML, o '' se il device non ha senso di esporlo. */
/** Genera i 4 campi inventario standard (Marca, Modello, Seriale, Firmware/OS)
 *  da inserire come PRIMI campi dentro la fisarmonica device-specifica.
 *  Sostituisce la vecchia fisarmonica "Inventario" separata: cosi' tutte le
 *  informazioni del device stanno in un unico posto coerente.
 *  Il placeholder degli input usa quello che ENTITY-MIB ha popolato in
 *  `n.integration.inventory` (se presente) cosi' l'utente vede il valore
 *  rilevato dall'SNMP anche quando non ha ancora confermato manualmente. */
function _buildInventoryFieldsHtml(n, d){
    const inventory = (n.integration && n.integration.inventory) || {};
    const placeholders = {
        brand:        escapeHTML(inventory.brand || (d && d.brand) || ''),
        model:        escapeHTML(inventory.model || ''),
        serialNumber: escapeHTML(inventory.serialNumber || ''),
        firmwareVer:  escapeHTML(inventory.firmwareVer || ''),
    };
    return `<div class="prop-row2">
        <div class="prop-group"><label>${t('field.brand')}</label><input value="${escapeHTML(n.brand||'')}" placeholder="${placeholders.brand}" onchange="updateN('brand',this.value)"></div>
        <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="${placeholders.model}" onchange="updateN('model',this.value)"></div>
    </div>
    <div class="prop-row2">
        <div class="prop-group"><label>${t('field.serial')}</label><input value="${escapeHTML(n.serialNumber||'')}" placeholder="${placeholders.serialNumber}" onchange="updateN('serialNumber',this.value)"></div>
        <div class="prop-group"><label>Firmware / OS</label><input value="${escapeHTML(n.firmwareVer||'')}" placeholder="${placeholders.firmwareVer}" onchange="updateN('firmwareVer',this.value)"></div>
    </div>`;
}

/** Genera lo `<span class="props-collapsible-preview">` con Marca + Modello
 *  da inserire nell'header delle fisarmoniche device-specifiche, cosi' a
 *  fisarmonica chiusa l'utente vede subito "Cisco · Catalyst 2960" senza
 *  doverla espandere. Ritorna '' quando ne' brand ne' model sono impostati,
 *  cosi' i device passivi/senza inventario (wallport, panelboard...) non
 *  mostrano rumore visivo. */
export function _buildDeviceBrandModelPreview(n){
    const brand = String((n && n.brand) || '').trim();
    const model = String((n && n.model) || '').trim();
    const parts = [brand, model].filter(Boolean);
    if(!parts.length) return '';
    return `<span class="props-collapsible-preview">${escapeHTML(parts.join(' · '))}</span>`;
}

// Mapping dei valori interni del patchpanel → etichette stampabili con
// abbreviazioni ISO/IEC 11801 (rame: U/UTP/F/UTP/S/FTP) e IEC 61754 (connettori).
const _PP_COPPER_CAT_LABEL = {
    'cat5e':'Cat 5e','cat6':'Cat 6','cat6a':'Cat 6A','cat7':'Cat 7','cat8':'Cat 8',
};
const _PP_COPPER_SHIELD_ISO = {
    'utp':'U/UTP','ftp':'F/UTP','stp':'S/FTP',
};
const _PP_FIBER_MODE_LABEL = {
    'sm-os1':'OS1','sm-os2':'OS2',
    'mm-om1':'OM1','mm-om2':'OM2','mm-om3':'OM3','mm-om4':'OM4','mm-om5':'OM5',
};
const _PP_FIBER_CONN_LABEL = {
    'lc-simplex':'LC simplex','lc-duplex':'LC duplex',
    'sc':'SC','st':'ST','fc':'FC',
    'mpo-12':'MTP-12','mpo-24':'MTP-24',
};

/** Genera la preview per la fisarmonica device-patchpanel: tipologia fisica
 *  + numero porte. La tipologia usa le sigle ISO/IEC standard (Cat 6A,
 *  U/UTP, OS2, OM4, MTP-12, ecc.) cosi' chi cabla riconosce il prodotto
 *  reale. Es: "Cat 6A · F/UTP · 24p", "OM4 LC duplex · 12p". */
function _buildPatchPanelPreview(n){
    if(!n) return '';
    const media = n.ppMedia || 'copper';
    const portCount = n.ports !== undefined ? n.ports : 24;
    const parts = [];
    if(media === 'copper'){
        const cat = _PP_COPPER_CAT_LABEL[n.ppCopperCat || 'cat6'] || 'Cat 6';
        const shield = _PP_COPPER_SHIELD_ISO[n.ppCopperShield || 'utp'] || 'U/UTP';
        parts.push(cat, shield);
    } else if(media === 'fiber'){
        const mode = _PP_FIBER_MODE_LABEL[n.ppFiberMode || 'mm-om4'] || 'OM4';
        const conn = _PP_FIBER_CONN_LABEL[n.ppFiberConnector || 'lc-duplex'] || 'LC duplex';
        parts.push(`${mode} ${conn}`);
    } else { // mixed
        parts.push(t('pnl.gen.copperFiber'));
    }
    if(portCount) parts.push(`${portCount}p`);
    return `<span class="props-collapsible-preview">${escapeHTML(parts.join(' · '))}</span>`;
}

function _buildNetAccessHtml(n, d, opts){
    opts = opts || {};
    const includeHostname  = opts.includeHostname !== false;
    const ipPlaceholder    = opts.ipPlaceholder || '192.168...';
    const showMac          = opts.showMac !== false && (d.isActive || d.hasIP);
    const macLabel         = opts.macLabel || 'MAC address';
    const macPlaceholder   = opts.macPlaceholder || '00:11:22:33:44:55';
    // Preview inline su summary chiuso: IP · MAC (o hostname se mancano)
    const _previewBits = [];
    if(n.ip)  _previewBits.push(escapeHTML(n.ip));
    if(n.mac) _previewBits.push(escapeHTML(String(n.mac).toLowerCase()));
    if(!n.ip && !n.mac && n.hostname) _previewBits.push(escapeHTML(n.hostname));
    const _previewHtml = _previewBits.length
        ? `<span class="props-collapsible-preview">${_previewBits.join(' · ')}</span>`
        : '';
    // Stacking (P7.2): se il nodo e' un MEMBRO di uno stack (non master),
    // i campi hostname/ip/mac sono read-only — vengono ereditati dal master
    // (UN solo identita logica di management per stack). Mostriamo un hint.
    const _isStackMember = typeof win.isInStack === 'function' && win.isInStack(n)
        && typeof win.getEffectiveRole === 'function'
        && win.getEffectiveRole(store.state.nodes, n) === 'member';
    const _stackMaster = _isStackMember && typeof win.getStackMaster === 'function'
        ? win.getStackMaster(store.state.nodes, n.spec?.stackId || n.stackId)
        : null;
    const _stackHint = _isStackMember && _stackMaster
        ? `<div style="margin:4px 0 6px;padding:6px 8px;border-radius:3px;background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.4);font-size:0.75rem;color:var(--text-main);line-height:1.3"><i class="fas fa-info-circle" style="color:var(--accent);margin-right:4px"></i>${t('pnl.gen.stackInheritHint',{master:`<strong>${escapeHTML(_stackMaster.name || _stackMaster.hostname || _stackMaster.id)}</strong>`})}</div>`
        : '';
    const _ro = _isStackMember ? 'readonly disabled' : '';
    // Endpoint foglia: il bottone "Tenta collegamento automatico" sta DENTRO
    // l'accordion perche' dipende direttamente dal MAC (co-locality).
    // Nascosto per stack member (campi readonly: il link e' gestito dal master).
    const _showAutoLink = showMac
        && !_isStackMember
        && typeof win._isLeafEndpoint === 'function'
        && win._isLeafEndpoint(n.type);
    const _autoLinkBtn = _showAutoLink
        ? `<div class="prop-group" style="margin-top:8px"><button class="toolbar-btn" style="width:100%" onclick="_autoLinkEndpointUI()" data-tip="${t('autolink.tip')}"><i class="fas fa-wand-magic-sparkles"></i> ${t('autolink.btn')}</button></div>`
        : '';
    // Wi-Fi: sui device capaci (AP/router/firewall) la spunta + la config Wi-Fi
    // vivono QUI, in fondo a "Rete & Accesso" (un solo punto per tutti i tipi:
    // il Wi-Fi è accesso di rete). Nessuna fisarmonica separata.
    // In Rete & Accesso resta SOLO il toggle "Dotato di connessione wireless".
    // Le interfacce radio vivono nella fisarmonica dedicata WIRELESS (sotto),
    // visibile solo quando il toggle è attivo.
    const _wifiCapable = (typeof win._isWifiCapable === 'function' && win._isWifiCapable(n.type));
    // L'AP è wireless PER DEFINIZIONE: niente toggle (non è un'opzione attivabile),
    // la fisarmonica WIRELESS è sempre presente. Per gli altri capaci resta il toggle.
    const _wifiMandatory = (n.type === 'ap');
    const _wifiOn = _wifiCapable && (_wifiMandatory || (typeof win._deviceHasWifi==='function' && win._deviceHasWifi(n)));
    const _wifiToggle = (_wifiCapable && !_wifiMandatory)
        ? `<div class="netaccess-wifi">
             <label class="link-wireless-toggle"><input type="checkbox" ${_wifiOn?'checked':''} onchange="setDeviceWifi('${n.id}',this.checked)"> <i class="fas fa-wifi"></i> ${t('wifi.capable')}</label>
           </div>`
        : '';
    // Fisarmonica WIRELESS separata (fuori da Rete & Accesso): sempre per l'AP,
    // altrimenti solo col toggle attivo.
    const _wirelessAccordion = _wifiOn
        ? `<details class="props-collapsible props-primary" ${_propsSectionIsOpen('wireless')?'open':''} ontoggle="setPropsSectionState('wireless',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-wifi"></i> ${t('sec.wireless')}</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
             ${(typeof win._radioIfacesHtml==='function') ? win._radioIfacesHtml(n) : ''}
           </div></details>`
        : '';
    return `<details class="props-collapsible" ${_propsSectionIsOpen('network-access')?'open':''} ontoggle="setPropsSectionState('network-access',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-link"></i> ${t('sec.netAccess')}</span>${_previewHtml}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
        ${_stackHint}
        ${includeHostname ? `<div class="prop-group"><label>Hostname</label><input value="${escapeHTML(n.hostname||'')}" placeholder="${escapeHTML(d.brand||'')}" ${_ro} onchange="updateN('hostname',this.value);updateN('hostnameManual',!!this.value.trim())"></div>` : ''}
        <div class="prop-group"><label>${t('net.ip')}</label><input value="${escapeHTML(n.ip||'')}" placeholder="${escapeHTML(ipPlaceholder)}" ${_ro} onchange="updateN('ip',this.value);updateN('ipManual',!!this.value.trim())"></div>
        ${win._mgmtRow(n.mgmtUrl||'', n.ip||'', n.id)}
        ${showMac ? `<div class="prop-group"><label>${escapeHTML(macLabel)}</label><input value="${escapeHTML(n.mac||'')}" placeholder="${escapeHTML(macPlaceholder)}" ${_ro} onchange="updateN('mac',this.value)"></div>` : ''}
        ${_autoLinkBtn}
        ${_wifiToggle}
    </div></details>${_wirelessAccordion}`;
}

// Blocco read-only "Stato live (SNMP)" per UPS/ATS. Popolato da n.powerLive
// (dal poll /api/poll-power). Vuoto finché non c'è un poll: i campi di
// documentazione manuali restano indipendenti (manual-first).
function _powerLiveHtml(n){
    const live = n && n.powerLive;
    if(!live) return '';
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const when = n.powerLiveAt ? new Date(n.powerLiveAt).toLocaleString() : '';
    const rows = [];
    if(n.type === 'ats'){
        if(live.selectedSource != null) rows.push([t('pwr.activeSource'), `<b>${t('pwr.sourceX',{x:esc(live.selectedSource)})}</b>`]);
        if(live.redundant != null) rows.push([t('pwr.redundancy'), live.redundant
            ? `<span style="color:var(--active-color)">${t('pwr.redundant')}</span>`
            : `<span style="color:#e3b341">${t('pwr.lost')}</span>`]);
        if(live.overCurrent) rows.push([t('pwr.overCurrent'), `<span style="color:#f85149">${t('pwr.yes')}</span>`]);
    } else {
        if(live.outputSource != null) rows.push([t('field.power'), live.onBattery
            ? `<span style="color:#e3b341;font-weight:700">${t('pwr.onBattery')} ⚠</span>`
            : (live.outputSource === 'bypass' ? 'bypass' : `<span style="color:var(--active-color)">${t('pwr.mains')}</span>`)]);
        if(live.batteryPct != null) rows.push([t('pwr.battery'), `${esc(live.batteryPct)} %`]);
        if(live.runtimeMin != null){
            const crit = (typeof win.upsRuntimeCritical === 'function') && win.upsRuntimeCritical(live);
            rows.push([t('pwr.runtime'), `<span style="${crit?'color:#f85149;font-weight:700':''}">${esc(live.runtimeMin)} min${crit?' ⚠':''}</span>`]);
        }
        if(live.batteryStatus && live.batteryStatus !== 'normal') rows.push([t('pwr.batteryStatus'), `<span style="color:#e3b341">${esc(live.batteryStatus)}</span>`]);
        if(live.loadPct != null) rows.push([t('pwr.outputLoad'), `${esc(live.loadPct)} %`]);
        if(live.inputV) rows.push([t('pwr.inputV'), `${esc(live.inputV)} V`]);
        if(live.outputV) rows.push([t('pwr.outputV'), `${esc(live.outputV)} V`]);
        if(live.batteryTempC != null) rows.push([t('pwr.batteryTemp'), `${esc(live.batteryTempC)} °C`]);
    }
    if(!rows.length) return '';
    const body = rows.map(([k, v]) => `<div class="power-live-row"><span>${esc(k)}</span><span>${v}</span></div>`).join('');
    return `<div class="power-live"><div class="power-live-head"><i class="fas fa-bolt"></i> ${t('pwr.liveStatus')}${when ? `<span class="power-live-ts">${esc(when)}</span>` : ''}</div>${body}</div>`;
}

function _propsIconForType(type){
    // Fonte UNICA del glifo per-tipo: TYPES[type].icon (in app-types.js).
    // La vecchia mappa locale è stata rimossa per evitare divergenze (es. il
    // passacavo che mostrava grip-lines nell'export e ellipsis-h nel pannello).
    return TYPES[type]?.icon || 'fa-cube';
}

function _buildPropsHeader(title, subtitle, iconClass, actionsHtml=''){
    return `<div class="props-selected-title"><span class="props-selected-main"><i class="fas ${escapeHTML(iconClass||'fa-cube')} props-selected-icon"></i><span class="props-selected-text">${escapeHTML(title||t('pnl.gen.element'))}<small class="props-selected-subtitle">${escapeHTML(subtitle||'')}</small></span></span>${actionsHtml}</div>`;
}

export function renderProps(){
    win._updateFloorToolbarVisibility();
    const panel=document.getElementById('props-panel');
    // R10: dispatcher. Ogni ramo (scope di selezione) e\u0027 un renderer dedicato,
    // move VERBATIM qui sotto; usano solo panel + globali (selId/selType/state/TYPES).
    if(selType==='node'&&selId){ win._renderNodeProps(panel); }
    else if(selType==='port'&&selId){ win._renderPortProps(panel); }
    else if(selType==='link'&&selId){ win._renderLinkProps(panel); }
    else { win._renderFloorProps(panel); }
}

// ─────────────────────────────────────────────────────────────
// I 4 renderer di dettaglio sono in file dedicati (stesso scope globale),
// caricati subito dopo questo in netmapper.html:
//   app-properties-node.js   → _renderNodeProps   (dispositivo/struttura)
//   app-properties-port.js   → _renderPortProps   (porta / radio)
//   app-properties-link.js   → _renderLinkProps   (cavo / associazione)
//   app-properties-floor.js  → _renderFloorProps  (contesto planimetria)
// I builder condivisi (_buildNetAccessHtml, _buildInventoryFieldsHtml,
// _powerLiveHtml, _propsIconForType, _buildPropsHeader…) restano QUI.
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Pubblicazione sul ponte: dispatcher + tutti i builder condivisi + i comandi
// fisarmonica (chiamati da onclick/ontoggle inline, dai file node classic e dalle
// foglie già migrate via win.*).
// ─────────────────────────────────────────────────────────────
expose({
    renderProps, _propsSectionIsOpen, setPropsSectionState,
    _propsExpandAll, _propsCollapseAll, _propsResetSections,
    _propsKebabToggle, _propsKebabClose,
    _buildInventoryFieldsHtml, _buildDeviceBrandModelPreview, _buildPatchPanelPreview,
    _buildNetAccessHtml, _powerLiveHtml, _propsIconForType, _buildPropsHeader,
});
