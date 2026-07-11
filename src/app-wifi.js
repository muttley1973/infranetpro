// ============================================================
// WI-FI — orchestratore + UI (interfacce radio per-device, documentazione-grade)
// ============================================================
// Modello "ibrido" (come NetBox): gli attributi Wi-Fi (SSID/banda/canale/
// sicurezza) vivono sulla singola RADIO del device (una voce di node.radios[]);
// l'associazione (l'onda / link) li EREDITA in sola lettura dalla radio a cui è
// collegata e aggiunge i suoi (segnale RSSI, distanza). Un device può avere fino
// a 8 interfacce radio (lib/radio.js). Validazioni pure in lib/wifi-spec.js.
//
// MODULO ESM (migrato da lib/app-wifi.js): legge i globali legacy + i lib puri
// script-tagged (radio.js, wifi-spec.js, wifi-vlan-check.js — UMD su window) via
// win.*; `t` dal ponte; pubblica la sua API con expose(). I nomi dentro gli
// onclick=""/onchange="" dell'HTML generato girano in scope PAGINA → restano bare.

import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML } from './app-util.js';
import { nodeById, markDirty, getNodeByPortId, getPortNodeId, getNodeDisplayName, pushHistory, _showToast, _invalidateIdx, _linksForPort, _nodeRadios, _isRadioPid } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { propagateVlans, _ensureVlanColor, _getLinkTrunk } from './app-vlan-autopoll.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderProps, _propsSectionIsOpen, _buildPropsHeader } from './app-properties.js';   // ritiro ponte fase 2+: funzioni/builder (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)

const _WIFI_BAND_LABELS = { '2.4': '2.4 GHz', '5': '5 GHz', '6': '6 GHz (Wi-Fi 6E)' };
const _WIFI_SEC_LABELS = {
    'open': 'Aperta (nessuna)', 'wpa2-psk': 'WPA2-Personal (PSK)', 'wpa2-ent': 'WPA2-Enterprise',
    'wpa3-personal': 'WPA3-Personal', 'wpa3-ent': 'WPA3-Enterprise', 'owe': 'Enhanced Open (OWE)',
};

// Solo l'INFRASTRUTTURA wireless con RADIO PROPRIE trasmette SSID (flag
// TYPES.wifiServe: ap, router, firewall, sdwan). Gli altri device con radio sono
// CLIENT (station): si associano a un SSID, non lo creano. Gate del modello + UI.
// NB: il `wlanctrl` (WLC) NON e' wifiServe: e' una centralina cablata, senza radio
// — le SSID le definisce ma le IRRADIANO gli AP (che hanno le radio); vedi anche
// _isWifiCapable, che non gli mostra la sezione Wi-Fi.
function _canServeSsid(node){
    return !!(node && typeof TYPES !== 'undefined' && TYPES[node.type] && TYPES[node.type].wifiServe);
}

// ── Setter config Wi-Fi di UNA radio (per indice) ────────────────────
function updateRadioCfg(nodeId, idx, field, value){
    const n = nodeById(nodeId); if(!n) return;
    const radios = (typeof _nodeRadios === 'function') ? _nodeRadios(n) : (n.radios || []);
    const cfg = radios[idx]; if(!cfg) return;
    const v = String(value == null ? '' : value).trim();
    // Canale: 'auto' resta testuale; un numero diventa intero; vuoto cancella.
    if(v) cfg[field] = (field === 'channel' && v !== 'auto') ? (parseInt(v, 10) || 'auto') : v;
    else delete cfg[field];
    // Cambiando banda, un canale non più valido va scartato (evita stati incoerenti).
    if(field === 'band' && cfg.channel && typeof win.channelsForBand === 'function'){
        if(!win.channelsForBand(cfg.band).includes(+cfg.channel)) delete cfg.channel;
    }
    // Cambiando standard, una banda non più supportata (e il suo canale) va scartata
    // — parallelo alla regola banda→canale, completa la cascata Standard→Banda→Canale.
    if(field === 'standard' && cfg.band && typeof win.standardSupportsBand === 'function'){
        if(!win.standardSupportsBand(cfg.standard, cfg.band)){ delete cfg.band; delete cfg.channel; }
    }
    markDirty(); renderProps(); if(typeof renderAll === 'function') renderAll();
}
function setRadioLabel(nodeId, idx, value){
    const n = nodeById(nodeId); if(!n) return;
    const radios = (typeof _nodeRadios === 'function') ? _nodeRadios(n) : (n.radios || []);
    const cfg = radios[idx]; if(!cfg) return;
    const v = String(value == null ? '' : value).trim();
    if(v) cfg.label = v; else delete cfg.label;
    markDirty(); renderProps(); if(typeof renderAll === 'function') renderAll();
}

// ── Setter di UN BSS (SSID) dentro una radio: radios[idx].ssids[] ─────
// Il BSS è il livello LOGICO (ssid/vlan/security); una radio fisica ne ospita molti.
function _bssOf(nodeId, radioIdx, bssId){
    const n = nodeById(nodeId); if(!n) return null;
    const radio = ((typeof _nodeRadios==='function')?_nodeRadios(n):(n.radios||[]))[radioIdx];
    const list = (typeof win.radioSsids==='function') ? win.radioSsids(radio) : (radio && radio.ssids || []);
    return list.find(s => s && s.id === bssId) || null;
}
function updateBssCfg(nodeId, radioIdx, bssId, field, value){
    const bss = _bssOf(nodeId, radioIdx, bssId); if(!bss) return;
    const v = String(value == null ? '' : value).trim();
    if(v) bss[field] = (field === 'vlan') ? (parseInt(v, 10) || '') : v;
    else delete bss[field];
    if(field === 'vlan'){
        const vi = parseInt(bss.vlan, 10);
        if(vi > 1 && typeof _ensureVlanColor === 'function') _ensureVlanColor(vi);
        if(typeof _invalidateIdx === 'function') _invalidateIdx();
        if(typeof propagateVlans === 'function') propagateVlans();
    }
    markDirty(); renderProps(); if(typeof renderAll === 'function') renderAll();
}
// Aggiunge un BSS vuoto (o con VLAN preimpostata) a una radio e lo lascia da nominare.
function addBss(nodeId, radioIdx, vlan){
    const n = nodeById(nodeId); if(!n) return;
    if(!_canServeSsid(n)){ if(typeof _showToast==='function') _showToast(t('msg.ui.onlyApCanServeSsid'), 'warn', 3500); return; }
    const radio = ((typeof _nodeRadios==='function')?_nodeRadios(n):(n.radios||[]))[radioIdx]; if(!radio) return;
    if(typeof pushHistory === 'function') pushHistory();
    if(!Array.isArray(radio.ssids)) radio.ssids = [];
    const v = parseInt(vlan, 10);
    const id = (typeof win.newSsidId === 'function') ? win.newSsidId() : ('s' + Date.now().toString(36) + radio.ssids.length);
    radio.ssids.push((v >= 1 && v <= 4094) ? { id, vlan: v } : { id });
    if(v > 1 && typeof _ensureVlanColor === 'function') _ensureVlanColor(v);
    if(typeof _invalidateIdx === 'function') _invalidateIdx();
    if(typeof propagateVlans === 'function') propagateVlans();
    markDirty(); renderProps(); if(typeof renderAll === 'function') renderAll();
    return id;
}
// Rimuove un BSS; ripulisce i link wireless che lo referenziavano (l.bss).
function removeBss(nodeId, radioIdx, bssId){
    const n = nodeById(nodeId); if(!n) return;
    const radio = ((typeof _nodeRadios==='function')?_nodeRadios(n):(n.radios||[]))[radioIdx]; if(!radio || !Array.isArray(radio.ssids)) return;
    const i = radio.ssids.findIndex(s => s && s.id === bssId); if(i < 0) return;
    if(typeof pushHistory === 'function') pushHistory();
    radio.ssids.splice(i, 1);
    const state = store.state;
    for(const l of (state.links || [])){ if(l && l.bss === bssId) delete l.bss; }
    if(typeof _invalidateIdx === 'function') _invalidateIdx();
    if(typeof propagateVlans === 'function') propagateVlans();
    markDirty(); renderProps(); if(typeof renderAll === 'function') renderAll();
}
// Seleziona un'interfaccia radio (apre il suo pannello a destra).
function selectRadioIface(nodeId, idx){
    const pid = (typeof win.radioPid === 'function') ? win.radioPid(nodeId, idx) : `${nodeId}-radio${idx? idx+1 : ''}`;
    store.selType = 'port'; store.selId = pid;
    if(typeof renderAll === 'function') renderAll();
    renderProps();
}

// Crea un nuovo SSID/BSS su una VLAN — tipico dalle chip "VLAN sul trunk" non ancora
// assegnate. Aggiunge un BSS alla PRIMA radio fisica (creandola se manca) con la VLAN
// preimpostata, poi apre il pannello della radio per digitare il nome SSID. NON crea
// una radio nuova per ogni SSID: una radio fisica trasmette più SSID.
function addSsidForVlan(nodeId, vlan){
    const n = nodeById(nodeId); if(!n) return;
    if(!_canServeSsid(n)){ if(typeof _showToast==='function') _showToast(t('msg.ui.deviceIsWirelessClient'), 'warn', 3500); return; }
    if(!Array.isArray(n.radios) || !n.radios.length){
        if(typeof win.setRadioCount === 'function') win.setRadioCount(n, 1); else n.radios = [{}];
    }
    addBss(nodeId, 0, vlan);
    store.selType = 'port'; store.selId = (typeof win.radioPid==='function') ? win.radioPid(nodeId, 0) : `${nodeId}-radio`;
    if(typeof renderAll === 'function') renderAll();
    renderProps();
}

// ── Form di configurazione di UNA radio (cfg = node.radios[idx]) ──────
function _wifiCfgHtml(cfg, nodeId, idx){
    cfg = cfg || {};
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const opt = (val, sel, label) => `<option value="${esc(val)}"${String(sel) === String(val) ? ' selected' : ''}>${esc(label)}</option>`;
    // Bande filtrate per lo Standard scelto (cascata Standard→Banda): mostra solo
    // le bande supportate dallo standard (+ la banda già impostata, anche se
    // incoerente, così i dati legacy restano visibili e il warning li segnala).
    const _allBands = (typeof win.WIFI_BANDS !== 'undefined' ? win.WIFI_BANDS : []);
    const _bands = _allBands.filter(b =>
        (typeof win.standardSupportsBand !== 'function' || !cfg.standard || win.standardSupportsBand(cfg.standard, b))
        || String(cfg.band) === String(b));
    const bandOpts = ['<option value="">—</option>']
        .concat(_bands.map(b => opt(b, cfg.band, _WIFI_BAND_LABELS[b] || b))).join('');
    // 'Auto' = selezione automatica (default reale degli AP); poi i canali della
    // banda RAGGRUPPATI per sotto-banda (UNII/2.4) via <optgroup>, DFS marcato.
    const chSel = (cfg.channel == null || cfg.channel === '') ? 'auto' : cfg.channel;
    const chGroups = (typeof win.channelGroupsForBand === 'function' && cfg.band) ? win.channelGroupsForBand(cfg.band) : [];
    const chanOpts = opt('auto', chSel, 'Auto') + chGroups.map(g =>
        `<optgroup label="${esc(g.label)}${g.dfs ? ' · DFS' : ''}">${g.channels.map(c => opt(c, chSel, c)).join('')}</optgroup>`
    ).join('');
    const secOpts = ['<option value="">—</option>']
        .concat((typeof win.WIFI_SECURITY !== 'undefined' ? win.WIFI_SECURITY : []).map(s => opt(s, cfg.security, _WIFI_SEC_LABELS[s] || s))).join('');
    const stdOpts = ['<option value="">—</option>']
        .concat((typeof win.WIFI_STANDARDS !== 'undefined' ? win.WIFI_STANDARDS : []).map(s => opt(s.id, cfg.standard, s.label))).join('');
    // Banner PHY della radio (canale↔banda, standard↔banda); la sicurezza è per-BSS.
    const issues = (typeof win.validateWifi === 'function') ? win.validateWifi({ band: cfg.band, channel: cfg.channel, standard: cfg.standard }) : [];
    const banner = issues.length ? `<div class="cable-validate-banner">${issues.map(i => `
        <div class="cable-validate-row lvl-${i.level}">
          <i class="fas ${i.level === 'error' ? 'fa-circle-exclamation' : 'fa-triangle-exclamation'}"></i>
          <div class="cable-validate-txt"><b>${esc(i.title)}</b><span>${esc(i.why)}</span></div>
        </div>`).join('')}</div>` : '';
    const u = `'${nodeId}',${idx}`;   // argomenti comuni updateRadioCfg (campi PHY)
    const _t = t;
    // Livello FISICO della radio: standard/banda/canale (l'SSID/VLAN sta nei BSS sotto).
    return `<div class="wifi-cfg">
        <div class="prop-grid2">
          <div class="prop-group"><label>${esc(_t('pnl.feat.standard'))}</label><select onchange="updateRadioCfg(${u},'standard',this.value)">${stdOpts}</select></div>
          <div class="prop-group"><label>${esc(_t('pnl.feat.band'))}</label><select onchange="updateRadioCfg(${u},'band',this.value)">${bandOpts}</select></div>
        </div>
        <div class="prop-grid2">
          <div class="prop-group"><label>${esc(_t('pnl.feat.channel'))}</label><select onchange="updateRadioCfg(${u},'channel',this.value)">${chanOpts}</select></div>
          <div class="prop-group"></div>
        </div>
        ${banner}
        ${_radioSsidsHtml(cfg, nodeId, idx)}
      </div>`;
}

// Sotto-elenco dei BSS (SSID) di una radio: ogni riga = SSID + VLAN + Sicurezza +
// elimina; in fondo "Aggiungi SSID". È il livello LOGICO: una radio fisica trasmette
// più SSID, ciascuno su una VLAN (multi-SSID/BSSID, come un AP reale).
function _radioSsidsHtml(radio, nodeId, idx){
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const _t = t;
    const opt = (val, sel, label) => `<option value="${esc(val)}"${String(sel) === String(val) ? ' selected' : ''}>${esc(label)}</option>`;
    const secOpts = ['<option value="">—</option>']
        .concat((typeof win.WIFI_SECURITY !== 'undefined' ? win.WIFI_SECURITY : []).map(s => opt(s, '', _WIFI_SEC_LABELS[s] || s)));
    const list = (typeof win.radioSsids === 'function') ? win.radioSsids(radio) : (radio && radio.ssids || []);
    const rows = list.map(s => {
        const u = `'${nodeId}',${idx},'${esc(s.id)}'`;
        const sec = ['<option value="">—</option>']
            .concat((typeof win.WIFI_SECURITY !== 'undefined' ? win.WIFI_SECURITY : []).map(x => opt(x, s.security, _WIFI_SEC_LABELS[x] || x))).join('');
        const bssIssues = (typeof win.validateWifi === 'function') ? win.validateWifi({ band: radio.band, security: s.security }) : [];
        const bn = bssIssues.length ? `<div class="cable-validate-banner" style="margin-top:5px">${bssIssues.map(i => `
            <div class="cable-validate-row lvl-${i.level}"><i class="fas ${i.level === 'error' ? 'fa-circle-exclamation' : 'fa-triangle-exclamation'}"></i>
            <div class="cable-validate-txt"><b>${esc(i.title)}</b><span>${esc(i.why)}</span></div></div>`).join('')}</div>` : '';
        return `<div class="bss-row" style="border:1px solid var(--panel-border);border-radius:6px;padding:7px;margin-top:6px">
            <div class="prop-grid2">
              <div class="prop-group"><label>SSID</label><input value="${esc(s.ssid || '')}" placeholder="${esc(_t('pnl.feat.ssidPh'))}" onchange="updateBssCfg(${u},'ssid',this.value)"></div>
              <div class="prop-group"><label>VLAN</label><input type="number" min="1" max="4094" value="${esc(s.vlan || '')}" placeholder="1" onchange="updateBssCfg(${u},'vlan',this.value)" data-tip="${esc(_t('radio.vlanTip'))}"></div>
            </div>
            <div class="prop-grid2">
              <div class="prop-group"><label>${esc(_t('radio.security') || 'Sicurezza')}</label><select onchange="updateBssCfg(${u},'security',this.value)">${sec}</select></div>
              <div class="prop-group" style="display:flex;align-items:flex-end;justify-content:flex-end">
                <button class="toolbar-btn danger" onclick="removeBss(${u})" data-tip="${esc(_t('radio.removeSsid') || 'Rimuovi SSID')}"><i class="fas fa-trash"></i></button></div>
            </div>
            ${bn}
          </div>`;
    }).join('');
    // Fisarmonica coerente con le altre sezioni del pannello (details.props-collapsible):
    // header "SSID trasmessi" + anteprima col conteggio, corpo con i BSS e "Aggiungi SSID".
    const _ssN = list.filter(s => s && s.ssid).length;
    const _open = (typeof _propsSectionIsOpen === 'function') ? _propsSectionIsOpen('radio-ssids') : true;
    const _preview = _ssN ? `<span class="props-collapsible-preview">${_ssN} SSID</span>` : '';
    return `<details class="props-collapsible props-secondary" ${_open ? 'open' : ''} ontoggle="if(typeof setPropsSectionState==='function')setPropsSectionState('radio-ssids',this.open)">
        <summary class="props-collapsible-head"><span><i class="fas fa-broadcast-tower"></i> ${esc(_t('radio.ssidList') || 'SSID trasmessi')}</span>${_preview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
        <div class="props-collapsible-body">
          ${rows || `<div class="radio-assoc-empty">${esc(_t('radio.noSsid') || 'Nessun SSID')}</div>`}
          <button class="toolbar-btn" style="margin-top:7px" onclick="addBss('${nodeId}',${idx})"><i class="fas fa-plus"></i> ${esc(_t('radio.addSsid') || 'Aggiungi SSID')}</button>
        </div></details>`;
}

// ── Gestore delle interfacce radio (nel pannello del device) ─────────
// Controllo conteggio 0..8 + elenco delle radio (click → apre il pannello).
export function _radioIfacesHtml(n){
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const _t = t;
    const radios = (typeof _nodeRadios === 'function') ? _nodeRadios(n) : (n.radios || []);
    const rows = radios.map((r, i) => {
        const pid = (typeof win.radioPid === 'function') ? win.radioPid(n.id, i) : `${n.id}-radio${i? i+1 : ''}`;
        const sel = store.selType === 'port' && store.selId === pid;
        const lbl = r.label || `${_t('radio.iface')} ${i + 1}`;
        const _ssN = (typeof win.radioSsids === 'function' ? win.radioSsids(r) : (r.ssids || [])).filter(s => s && s.ssid).length;
        const sub = [r.band ? (_WIFI_BAND_LABELS[r.band] || r.band) : '', r.channel && r.channel !== 'auto' ? `ch ${r.channel}` : '',
            _ssN ? `${_ssN} SSID` : ''].filter(Boolean).join(' · ');
        const cnt = (typeof _linksForPort === 'function') ? _linksForPort(pid).length : 0;
        return `<div class="radio-iface-row${sel ? ' selected' : ''}" onclick="selectRadioIface('${n.id}',${i})">
            <i class="fas fa-wifi"></i>
            <span class="ri-name">${esc(lbl)}</span>
            <span class="ri-sub">${esc(sub) || '—'}</span>
            <span class="ri-cnt">${cnt ? `${cnt} ${esc(_t('radio.assocN'))}` : ''}</span>
          </div>`;
    }).join('');
    const _minRadios = (n.type === 'ap') ? 1 : 0;   // AP = sempre wireless: min 1
    // Chip "VLAN sul trunk": le VLAN che ARRIVANO sull'uplink cablato dell'AP
    // (_getLinkTrunk del link verso lo switch) UNITE a quelle mappate dalle radio.
    // Ogni chip mostra la VLAN (colore palette) e l'SSID assegnato, oppure
    // "non assegnata" se nessuna radio la serve ancora. Così vedi cosa entra anche
    // prima di mapparla su un SSID.
    const state = store.state;
    const _vc = (typeof state !== 'undefined' && state.vlanColors) ? state.vlanColors : {};
    let _trunkVlans = [];
    if(typeof _getLinkTrunk === 'function' && typeof getPortNodeId === 'function' && typeof _isRadioPid === 'function'){
        for(const l of (state.links || [])){
            if(!l || l.wireless) continue;
            const touches = (getPortNodeId(l.src) === n.id && !_isRadioPid(l.src)) || (getPortNodeId(l.dst) === n.id && !_isRadioPid(l.dst));
            if(!touches) continue;
            const tk = _getLinkTrunk(l);
            // TUTTE le VLAN in arrivo, nativa COMPRESA: anche l'untagged può servire
            // (es. un PC dell'IT sulla VLAN 1). L'utente decide cosa mappare su SSID.
            if(tk && tk.mode === 'trunk' && Array.isArray(tk.vlans)){ _trunkVlans = tk.vlans.slice(); break; }
        }
    }
    const _bssList = (typeof win.apSsidList === 'function') ? win.apSsidList(n) : [];
    const _ssidByVlan = {};
    _bssList.forEach(o => { if(o.vlan && o.ssid) _ssidByVlan[o.vlan] = String(o.ssid).trim(); });
    const _radioVlans = _bssList.map(o => o.vlan).filter(v => v >= 1 && v <= 4094);
    const _allVlans = Array.from(new Set([..._trunkVlans, ..._radioVlans])).sort((a, b) => a - b);
    // I chip "VLAN sul trunk" + "+" hanno senso SOLO su un device che trasmette SSID
    // (l'AP mappa le VLAN in arrivo su SSID); un client non distribuisce nulla.
    const _poolHtml = (_canServeSsid(n) && _allVlans.length) ? `<div class="prop-group">
        <label><i class="fas fa-wifi"></i> ${esc(_t('radio.trunkVlans'))}</label>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:3px">
          ${_allVlans.map(v => {
              const col = _vc[v] || '#6e7681';
              const ss = _ssidByVlan[v];
              const _add = ss ? '' : `<button onclick="addSsidForVlan('${n.id}',${v})" data-tip="${esc(_t('radio.createSsid'))}" style="border:0;background:transparent;color:var(--active-color);cursor:pointer;padding:0 0 0 2px;font-size:0.72rem;line-height:1"><i class="fas fa-plus-circle"></i></button>`;
              return `<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:11px;background:rgba(255,255,255,.04);border:1px solid var(--panel-border);font-size:0.72rem;white-space:nowrap">
                  <span style="width:9px;height:9px;border-radius:50%;background:${col};flex-shrink:0;border:1px solid rgba(255,255,255,.18)"></span>
                  <b>VLAN ${v}</b><span style="color:var(--text-muted)">${ss ? esc(ss) : esc(_t('radio.unassigned'))}</span>${_add}
                </span>`;
          }).join('')}
        </div></div>` : '';
    return `<div class="radio-ifaces">
        <div class="prop-group radio-count">
          <label><i class="fas fa-wifi"></i> ${_t('radio.count')}</label>
          <input type="number" min="${_minRadios}" max="8" value="${radios.length}" onchange="setNodeRadioCount('${n.id}',this.value)">
        </div>
        ${_poolHtml}
        ${rows}
      </div>`;
}

// Display SOLA LETTURA della config Wi-Fi+VLAN ereditata dall'SSID servente,
// per le radio CLIENT (station): il client non configura SSID/VLAN, li riceve.
function _wifiInheritedRO(info){
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const _t = t;
    const c = info.cfg || {};
    const name = (typeof getNodeDisplayName === 'function' ? getNodeDisplayName(info.node) : '') || info.node.name || info.node.id;
    const ro = inner => `<div style="padding:5px 7px;background:var(--bg-color);border:1px solid var(--panel-border);border-radius:4px;font-size:var(--fs-lg);color:var(--text-main)">${inner}</div>`;
    const bits = [];
    if(c.band) bits.push(_WIFI_BAND_LABELS[c.band] || c.band);
    if(c.channel) bits.push('ch ' + (c.channel === 'auto' ? 'Auto' : c.channel));
    if(c.security) bits.push(_WIFI_SEC_LABELS[c.security] || c.security);
    return `<div class="wifi-cfg">
        <div class="prop-grid2">
          <div class="prop-group"><label>SSID</label>${ro(esc(c.ssid || '—'))}</div>
          <div class="prop-group"><label>VLAN</label>${ro(esc(c.vlan || '—'))}</div>
        </div>
        ${bits.length ? `<div class="prop-group"><label>Wi-Fi</label>${ro(esc(bits.join(' · ')))}</div>` : ''}
        <div class="radio-hint" style="margin-top:6px"><i class="fas fa-circle-info"></i> ${esc(_t('radio.clientInherit'))} <b>${esc(name)}</b></div>
      </div>`;
}

// Il BSS servente di una radio CLIENT (station): la radio non ha SSID propri ed è
// associata (wireless) a una radio CHE TRASMETTE SSID. Risolve il BSS scelto via
// link.bss (effBssCfg). Ritorna { cfg, node, apPid, link, bssId } o null.
function _radioServingSsid(pid, ownRadio, links){
    const _has = (typeof win.radioSsids === 'function') ? win.radioSsids(ownRadio).length : (ownRadio && ownRadio.ssids || []).length;
    if(_has) return null;                            // ha BSS propri → è servente, non client
    for(const l of (links || [])){
        if(!l.wireless) continue;
        const other = (l.src === pid) ? l.dst : l.src;
        if(typeof _isRadioPid === 'function' && _isRadioPid(other) && typeof win.parseRadioPid === 'function'){
            const op = win.parseRadioPid(other);
            const on = op ? nodeById(op.nodeId) : null;
            const oradio = (on && typeof _nodeRadios === 'function') ? _nodeRadios(on)[op.idx] : null;
            const oHas = oradio && ((typeof win.radioSsids === 'function') ? win.radioSsids(oradio).length : (oradio.ssids || []).length);
            if(oHas){
                const cfg = (typeof win.effBssCfg === 'function') ? win.effBssCfg(oradio, l.bss) : oradio;
                return { cfg, node: on, apPid: other, link: l, bssId: cfg && cfg.id };
            }
        }
    }
    return null;
}

// Ri-aggancia l'associazione wireless di una radio CLIENT a un altro BSS dell'AP.
// Imposta link.bss (id del BSS) e ri-punta l'estremo AP alla RADIO che ospita quel
// BSS (l'ancora resta coerente). La VLAN del client deriva: sempre valida by-design.
function setClientAssoc(clientPid, bssId){
    const state = store.state;
    const l = (state.links || []).find(x => x && x.wireless && (x.src === clientPid || x.dst === clientPid));
    if(!l) return;
    if(typeof pushHistory === 'function') pushHistory();
    if(bssId){
        const apPid = (l.src === clientPid) ? l.dst : l.src;
        const ap = (typeof getPortNodeId === 'function') ? nodeById(getPortNodeId(apPid)) : null;
        const s = (ap && typeof win.ssidById === 'function') ? win.ssidById(ap, bssId) : null;
        if(s){
            const newApPid = (typeof win.radioPid === 'function') ? win.radioPid(ap.id, s.radioIdx) : apPid;
            if(l.src === clientPid) l.dst = newApPid; else l.src = newApPid;
            l.bss = bssId;
        }
    } else { delete l.bss; }
    if(typeof _invalidateIdx === 'function') _invalidateIdx();
    if(typeof propagateVlans === 'function') propagateVlans();
    markDirty();
    if(typeof renderAll === 'function') renderAll();
    renderProps();
}

// ── Associazione: scelta del BSS al momento del disegno dell'onda ────
// Dopo aver creato un link wireless: se la radio servente trasmette UN solo SSID
// lo assegna in automatico (link.bss); se ne ha PIÙ d'uno apre un menu colorato
// per VLAN per scegliere. Se non ha SSID nominati, link.bss resta vuoto (si sceglie
// poi dal pannello del client). Chiamato dal pointer alla fine di _tryFinishLink.
export function _assignWirelessBss(link){
    if(!link || !link.wireless) return;
    for(const pid of [link.src, link.dst]){
        if(typeof _isRadioPid !== 'function' || !_isRadioPid(pid)) continue;
        const p = win.parseRadioPid(pid); const n = p ? nodeById(p.nodeId) : null;
        // SSID offerti dall'INTERO nodo servente (qualsiasi sua radio), non solo quella
        // fisicamente toccata: così l'associazione si aggancia a un BSS valido comunque.
        const pool = (n && typeof win.apSsidList === 'function') ? win.apSsidList(n) : [];
        if(pool.length){
            if(pool.length === 1){ link.bss = pool[0].id; }
            else { _openBssMenu(link.id, n); }
            return;
        }
    }
}
function _closeBssMenu(){ const ov = document.getElementById('bss-menu-overlay'); if(ov) ov.style.display = 'none'; }
function _openBssMenu(linkId, node){
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const _t = t;
    const named = (typeof win.apSsidList === 'function') ? win.apSsidList(node) : [];
    if(!named.length) return;
    const state = store.state;
    const vc = (typeof state !== 'undefined' && state.vlanColors) ? state.vlanColors : {};
    let ov = document.getElementById('bss-menu-overlay');
    if(!ov){
        ov = document.createElement('div'); ov.id = 'bss-menu-overlay'; ov.className = 'drift-overlay';
        document.body.appendChild(ov);
        ov.addEventListener('mousedown', e => { if(e.target === ov) _closeBssMenu(); });
    }
    const rows = named.map(s => {
        const col = (s.vlan && vc[s.vlan]) || '#6e7681';
        const band = s.band ? ` · ${esc(_WIFI_BAND_LABELS[s.band] || s.band)}` : '';
        return `<button class="bss-pick" onclick="_pickBss('${esc(linkId)}','${esc(s.id)}')" style="display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:1px solid var(--panel-border);background:rgba(255,255,255,.03);border-radius:7px;padding:9px 11px;margin-top:6px;cursor:pointer;color:var(--text-main)">
            <span style="width:11px;height:11px;border-radius:50%;background:${col};flex-shrink:0;border:1px solid rgba(255,255,255,.18)"></span>
            <b>${esc(s.ssid)}</b>${s.vlan ? `<span style="color:var(--text-muted)">VLAN ${s.vlan}${band}</span>` : ''}</button>`;
    }).join('');
    ov.innerHTML = `<div class="drift-modal" style="max-width:340px"><div class="drift-head"><span><i class="fas fa-wifi"></i> ${esc(_t('radio.pickBss'))}</span>`
        + `<button class="toolbar-btn" onclick="_closeBssMenu()" data-tip="${esc(_t('common.close'))}"><i class="fas fa-times"></i></button></div>`
        + `<div class="drift-body" style="padding:12px">${rows}</div></div>`;
    ov.style.display = 'flex';
}
function _pickBss(linkId, bssId){
    const state = store.state;
    const l = (state.links || []).find(x => x && x.id === linkId);
    if(l){ l.bss = bssId; if(typeof _invalidateIdx === 'function') _invalidateIdx(); if(typeof propagateVlans === 'function') propagateVlans(); markDirty(); if(typeof renderAll === 'function') renderAll(); }
    _closeBssMenu();
}

// ── Pannello di UNA radio selezionata (selType==='port', pid radio) ───
export function _renderRadioProps(panel, pid){
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const _t = t;
    const p = (typeof win.parseRadioPid === 'function') ? win.parseRadioPid(pid) : null;
    const n = p ? nodeById(p.nodeId) : null;
    const radios = (n && typeof _nodeRadios === 'function') ? _nodeRadios(n) : [];
    const cfg = (p && radios[p.idx]) ? radios[p.idx] : null;
    if(!n || !cfg){ store.selType = null; store.selId = null; renderProps(); return; }
    const devName = (typeof getNodeDisplayName === 'function' ? getNodeDisplayName(n) : '') || n.name || n.id;
    const lbl = cfg.label || `${_t('radio.iface')} ${p.idx + 1}`;
    // Associazioni/cavi su questa radio.
    const links = (typeof _linksForPort === 'function') ? _linksForPort(pid) : [];
    const assocRows = links.map(l => {
        const other = (l.src === pid) ? l.dst : l.src;
        const on = (typeof getNodeByPortId === 'function') ? getNodeByPortId(other) : null;
        const nm = on ? ((typeof getNodeDisplayName === 'function' ? getNodeDisplayName(on) : '') || on.name || on.id) : other;
        const kind = l.wireless ? _t('cable.wirelessAssoc') : _t('cable.cable');
        const ico = l.wireless ? 'fa-wifi' : 'fa-ethernet';
        return `<div class="radio-assoc-row" onclick="selType='link';selId='${l.id}';renderAll();renderProps()">
            <i class="fas ${ico}"></i><span class="ra-name">${esc(nm)}</span><span class="ra-kind">${esc(kind)}</span></div>`;
    }).join('');
    const assocBlock = links.length
        ? `<div class="radio-assocs"><div class="prop-subhead">${esc(_t('radio.assocList'))}</div>${assocRows}</div>`
        : `<div class="radio-assoc-empty">${esc(_t('radio.noAssoc'))}</div>`;
    panel.innerHTML = `
        ${_buildPropsHeader(devName, lbl, 'fa-wifi')}
        <div class="prop-group"><label>${esc(_t('radio.label'))}</label>
          <input value="${esc(cfg.label || '')}" placeholder="${esc(_t('radio.iface'))} ${p.idx + 1}" onchange="setRadioLabel('${p.nodeId}',${p.idx},this.value)"></div>
        ${(() => {
            const _srv = _radioServingSsid(pid, cfg, links);
            if(!_srv){
                // Device INFRASTRUTTURA (wifiServe) → editor SSID/PHY completo.
                if(_canServeSsid(n)) return _wifiCfgHtml(cfg, p.nodeId, p.idx);
                // CLIENT non ancora associato: niente creazione SSID, solo l'invito a
                // collegare l'onda a un AP (l'SSID/VLAN si erediteranno dall'associazione).
                return `<div class="radio-hint" style="margin-top:6px"><i class="fas fa-circle-info"></i> ${esc(_t('radio.clientOnly'))}</div>`;
            }
            // Client: SCEGLIE il BSS offerto dall'AP (tutti i suoi SSID, su ogni radio);
            // la VLAN deriva dal BSS → sempre valida. value = id BSS (link.bss).
            const _opts = (typeof win.apSsidList === 'function') ? win.apSsidList(_srv.node) : [];
            const _cur = _srv.bssId;
            const _picker = (_opts.length > 1)
                ? `<div class="prop-group"><label>${esc(_t('radio.assocSsid'))}</label>
                    <select onchange="setClientAssoc('${pid}', this.value)">
                      ${_opts.map(o => `<option value="${esc(o.id)}"${o.id === _cur ? ' selected' : ''}>${esc(o.ssid)}${o.vlan ? ` · VLAN ${o.vlan}` : ''}${o.band ? ` · ${esc(_WIFI_BAND_LABELS[o.band] || o.band)}` : ''}</option>`).join('')}
                    </select></div>`
                : '';
            return _picker + _wifiInheritedRO(_srv);
        })()}
        ${assocBlock}
        <div class="radio-hint"><i class="fas fa-circle-info"></i> ${esc(_t('radio.hint'))}</div>`;
}

// ── Pannello "associazione" wireless (il link/onda) ──────────────────
// Risale alla radio all'altro capo (preferendo quella con SSID = serving) e ne
// mostra il Wi-Fi EREDITATO (read-only), più i campi propri (RSSI, distanza).
function _wifiCfgForLink(l){
    const lookup = pid => {
        if(typeof _isRadioPid === 'function' && _isRadioPid(pid)){
            const p = (typeof win.parseRadioPid === 'function') ? win.parseRadioPid(pid) : null;
            const n = p ? nodeById(p.nodeId) : null;
            const radios = (n && typeof _nodeRadios === 'function') ? _nodeRadios(n) : [];
            const radio = (p && radios[p.idx]) ? radios[p.idx] : {};
            if(n) return { node: n, radio };
        }
        return null;
    };
    if(typeof win.inheritRadioCfgForLink === 'function') return win.inheritRadioCfgForLink(l, lookup);
    // Fallback: primo capo radio (config effettiva del suo BSS, secondo link.bss).
    for(const pid of [l.src, l.dst]){
        const r = lookup(pid);
        if(r) return { node: r.node, cfg: (typeof win.effBssCfg === 'function') ? win.effBssCfg(r.radio, l.bss) : r.radio };
    }
    return null;
}

export function _wifiAssocHtml(l){
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const info = _wifiCfgForLink(l);
    let inh = '';
    if(info){
        const c = info.cfg || {};
        const stdLabel = (typeof win.WIFI_STANDARDS !== 'undefined' && c.standard)
            ? (win.WIFI_STANDARDS.find(s => s.id === c.standard) || {}).label : '';
        const bits = [];
        if(c.ssid) bits.push(`SSID <b>${esc(c.ssid)}</b>`);
        if(c.band) bits.push(esc(_WIFI_BAND_LABELS[c.band] || c.band));
        if(c.channel) bits.push(`ch ${c.channel === 'auto' ? 'Auto' : esc(c.channel)}`);
        if(c.security) bits.push(esc(_WIFI_SEC_LABELS[c.security] || c.security));
        if(stdLabel) bits.push(esc(stdLabel.replace(/ \(.*/, '')));
        const name = getNodeDisplayName(info.node) || info.node.name || info.node.id;
        inh = `<div class="wifi-inherited"><i class="fas fa-wifi"></i> ${bits.length ? bits.join(' · ') : t('pnl.feat.apNoWifiData')}<span class="wifi-inh-from"> · ${t('pnl.feat.fromName',{name:esc(name)})}</span></div>`;
    }
    const rssi = (l.rssi != null && l.rssi !== '') ? l.rssi : '';
    const dist = (l.length != null && l.length !== '') ? l.length : '';
    return `${inh}
        <div class="prop-grid2">
          <div class="prop-group"><label>${esc(t('pnl.feat.rssiSignal'))}</label><input type="number" max="0" min="-100" value="${esc(rssi)}" placeholder="${esc(t('pnl.feat.rssiPh'))}" onchange="setLinkProp('${l.id}','rssi',this.value)"></div>
          <div class="prop-group"><label>${esc(t('pnl.feat.distance'))}</label><input type="number" min="0" value="${esc(dist)}" placeholder="${esc(t('pnl.feat.distancePh'))}" onchange="setLinkProp('${l.id}','length',this.value)"></div>
        </div>`;
}

// ── Report "Coerenza VLAN wireless" ──────────────────────────────────
// Raccoglie i descrittori (puro lib/wifi-vlan-check.js fa il confronto):
//  - per ogni AP: SSID/VLAN distribuiti + le VLAN PERMESSE sul trunk dell'uplink
//    cablato (solo se lo switch a monte le dichiara via SNMP isTrunk/trunkVlans);
//  - per ogni radio CLIENT con VLAN propria: la VLAN e il pool dell'AP servente.
function _buildWifiVlanInput(){
    const state = store.state;
    const aps = [], clients = [];
    const _name = n => (typeof getNodeDisplayName==='function' ? getNodeDisplayName(n) : '') || n.name || n.id;
    for(const n of (state.nodes || [])){
        const pool = (typeof win.apSsidList==='function') ? win.apSsidList(n) : [];
        if(pool.length){
            let uplinkAllowed = null;
            for(const l of (state.links || [])){
                if(!l || l.wireless) continue;
                let other = null;
                if(getPortNodeId(l.src)===n.id && !_isRadioPid(l.src)) other = l.dst;
                else if(getPortNodeId(l.dst)===n.id && !_isRadioPid(l.dst)) other = l.src;
                if(!other) continue;
                const op = state.ports[other] || {};
                if(op.isTrunk && Array.isArray(op.trunkVlans)){ uplinkAllowed = op.trunkVlans.slice(); break; }
            }
            aps.push({ id:n.id, name:_name(n), ssids:pool.map(o=>({ssid:o.ssid, vlan:o.vlan})), uplinkAllowed });
        }
    }
    // Nota: i client non producono più issue "vlan-not-distributed": con il picker
    // SSID la VLAN del client DERIVA dal BSS servente, quindi è sempre nel pool
    // dell'AP by-design. Il report resta focalizzato sul lato AP (ssid-not-in-trunk).
    return { aps, clients };
}
function _wifiVlanIssues(){ return (typeof win.wifiVlanIssues==='function') ? win.wifiVlanIssues(_buildWifiVlanInput()) : []; }

function _closeWifiVlanReport(){ const ov=document.getElementById('wifivlan-overlay'); if(ov) ov.style.display='none'; }
function openWifiVlanReport(){
    const _t = t;
    let ov = document.getElementById('wifivlan-overlay');
    if(!ov){
        ov = document.createElement('div'); ov.id='wifivlan-overlay'; ov.className='drift-overlay';
        document.body.appendChild(ov);
        ov.addEventListener('mousedown', e => { if(e.target===ov) _closeWifiVlanReport(); });
    }
    const issues = _wifiVlanIssues();
    const body = issues.length ? issues.map(is => {
        const msg = is.kind==='ssid-not-in-trunk'
            ? _t('wifi.issueSsidTrunk', { ssid:is.ssid, vlan:is.vlan, ap:is.ap })
            : _t('wifi.issueClientVlan', { client:is.client, vlan:is.vlan, ap:is.ap });
        return `<div class="cable-validate-row lvl-warn"><i class="fas fa-triangle-exclamation"></i><div class="cable-validate-txt"><span>${escapeHTML(msg)}</span></div></div>`;
    }).join('') : `<div class="drift-empty">${escapeHTML(_t('wifi.coherenceOk'))}</div>`;
    ov.innerHTML = `<div class="drift-modal"><div class="drift-head"><span><i class="fas fa-wifi"></i> ${escapeHTML(_t('report.wifiVlan'))}</span>`
        + `<button class="toolbar-btn" onclick="_closeWifiVlanReport()" data-tip="${escapeHTML(_t('common.close'))}"><i class="fas fa-times"></i></button></div>`
        + `<div class="drift-body" style="padding:12px">${body}</div></div>`;
    ov.style.display='flex';
}

// ── Pubblicazione sul ponte ──────────────────────────────────────────
// Handler inline (onclick/onchange dell'HTML generato), chiamanti cross-file
// (app-pointer, app-properties*, netmapper.html) e le due funzioni interne che lo
// smoke esercita direttamente (_wifiCfgHtml, _wifiVlanIssues).
expose({
    updateRadioCfg, setRadioLabel, updateBssCfg, addBss, removeBss, selectRadioIface,
    addSsidForVlan, setClientAssoc, _pickBss, _closeBssMenu, _closeWifiVlanReport,
    openWifiVlanReport, _assignWirelessBss, _renderRadioProps, _wifiAssocHtml,
    _radioIfacesHtml, _wifiCfgHtml, _wifiVlanIssues,
});
