// ============================================================
// PROPERTIES PANEL — catena device-specifica per-tipo (foglia di _renderNodeProps)
// ============================================================
// MODULO ESM (migrato da lib/app-properties-node-devices.js): _nodeDeviceChainHtml
// genera i blocchi per-tipo (h = device FLOOR, devSpec = accordion RACK/attivi).
// Chiamato da app-properties-node.js (ancora classic) via window; _floorAccessVlanRow
// è usato anche da app-properties-port (bundle) + _deviceAccessVlanPid da
// app-vlan-autopoll (classic) → expose(). Builder del core + legacy via win.*
// (selected/checked/_build*/_propsSectionIsOpen/_powerLiveHtml/escapeHTML/TYPES/state/
// _effPortVlan/radioPid/getWallPortLabel); t dal ponte; onclick="" restano bare.
// Nessun cambiamento di logica.
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML } from './app-util.js';
import { _buildDeviceBrandModelPreview, _propsSectionIsOpen, _buildInventoryFieldsHtml, _buildNetAccessHtml, _powerLiveHtml } from './app-properties.js';   // ritiro ponte fase 2+: funzioni/builder (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)
import { selected, checked, getWallPortLabel } from './app.js';   // ritiro ponte: helper option-selected/checked (ex win.*)
import { _effPortVlan } from './app-vlan-autopoll.js';   // ritiro ponte: funzioni foglia UI/vlan/popup (ex win.*)
import { _hvPanelHtml } from './app-hypervisor.js';   // ritiro ponte: funzioni disc/props/vlan/hv (ex win.*)

// ============================================================
// PROPERTIES PANEL — catena device-specifica per-tipo (estratta da
// app-properties-node.js per spezzare il renderer monolitico).
// _nodeDeviceChainHtml(n, d, _identityBlock) → { h, devSpec }
//   h       : contributo dei device FLOOR (layout inline, h+=)
//   devSpec : contributo dei device RACK/attivi (accordion device-spec,
//             _devSpecHtml+=), poi cucito nellassemblaggio rack del chiamante.
// Sequenza piatta di blocchi indipendenti if(n.type===...): un solo blocco
// scatta per render. Usa solo n, d, _identityBlock + helper globali
// (selected, t, escapeHTML, _build*Html, _powerLiveHtml, updateN, ...).
// Caricato in netmapper.html subito dopo app-properties-node.js.
// ============================================================
// VLAN access di un endpoint floor in SOLA LETTURA: è la VLAN EFFETTIVA della sua
// porta (_effPortVlan: propagata dallo switch a monte ?? override di porta ??
// nativa di sito), l'unica che il motore rispetta. Sostituisce i vecchi campi
// vlanPc/vlanIot/... scollegati dal modello. L'override si modifica sulla
// porta/switch a monte (i valori legacy sono migrati in _migrateState).
// Interfaccia che rappresenta la VLAN access del device: la prima COLLEGATA tra
// porte cablate e radio (preferenza alla cablata). Per un client SOLO-wireless è
// la radio (la sua VLAN effettiva = SSID propagato da monte), non la porta cablata
// inutilizzata. Per un device cablato resta la porta 1.
function _deviceAccessVlanPid(n){
    const cand = [];
    const pc = (n.ports !== undefined) ? n.ports : ((TYPES[n.type] && TYPES[n.type].ports) || 1);
    for(let i=1;i<=pc;i++) cand.push(`${n.id}-${i}`);
    if(Array.isArray(n.radios) && typeof win.radioPid === 'function')
        n.radios.forEach((r, idx) => cand.push(win.radioPid(n.id, idx)));
    const linked = cand.filter(pid => (store.state.links||[]).some(l => l && (l.src===pid || l.dst===pid)));
    return linked[0] || cand[0] || `${n.id}-1`;
}

// VLAN access di un endpoint floor. EDITABILE quando nessuno a monte la detta:
// l'input scrive il `vlanOvr` della porta access del device (setEndpointVlan →
// l'unica VLAN che il motore rispetta). Se invece lo switch a monte propaga una
// VLAN su questo run passivo (pi.vlanProp presente), quella PREVALE (manual-first
// = la realtà vince): mostriamo il badge in sola lettura con il rimando a monte,
// così l'utente sa dove cambiarla. Sostituisce i vecchi campi vlanPc/vlanIot/…
// (migrati in _migrateState verso il vlanOvr di porta).
function _floorAccessVlanRow(n, pid){
    pid = pid || _deviceAccessVlanPid(n);
    const pi  = (store.state.ports && store.state.ports[pid]) || {};
    const eff = (typeof _effPortVlan === 'function') ? _effPortVlan(pid) : 1;
    const name = (store.state.vlanNames && store.state.vlanNames[eff]) ? escapeHTML(store.state.vlanNames[eff]) : '';
    const col  = (store.state.vlanColors && store.state.vlanColors[eff]) || '#6e7681';
    // VLAN dettata da monte (propagata su run passivo) → sola lettura + rimando.
    if(pi.vlanProp != null){
        const hint = (typeof t === 'function') ? t('f.vlanDerived') : 'effettiva — assegnata a monte';
        return `<div style="display:flex;align-items:center;gap:7px;padding:5px 7px;background:var(--bg-color);border:1px solid var(--panel-border);border-radius:4px;font-size:var(--fs-lg)">
            <span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${col};flex-shrink:0;border:1px solid rgba(255,255,255,.18)"></span>
            <b>VLAN ${eff}</b>${name?`<span style="color:var(--text-muted)">— ${name}</span>`:''}
            <span style="font-size:.66rem;color:var(--text-muted);margin-left:auto;white-space:nowrap"><i class="fas fa-circle-info" style="margin-right:3px"></i>${hint}</span>
          </div>`;
    }
    // Editabile: scrive l'override di porta dell'endpoint, tenendo il nodo selezionato.
    const tip = (typeof t === 'function') ? t('f.vlanEndpointTip') : 'VLAN access del device (override di porta). Lo switch a monte, se presente, può prevalere.';
    const ovrCls = (pi.vlanOvr != null) ? 'ovr' : '';
    return `<div style="display:flex;align-items:center;gap:7px">
        <span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${col};flex-shrink:0;border:1px solid rgba(255,255,255,.18)"></span>
        <input type="number" min="1" max="4094" class="${ovrCls}" style="flex:1"
               value="${pi.vlanOvr != null ? pi.vlanOvr : ''}" placeholder="${eff}"
               data-tip="${tip}"
               onchange="setEndpointVlan('${n.id}','${pid}',this.value)">
      </div>`;
}

export function _nodeDeviceChainHtml(n, d, _identityBlock){
    let h = '';
    let _devSpecHtml = '';
    // Le fisarmoniche FLOOR mettono la device-specifica PRIMA di "Rete & Accesso"
    // (es. per un VoIP la 1a fisarmonica è "Voip phone", poi rete/SNMP). Ogni blocco
    // floor CATTURA qui l'HTML di _buildNetAccessHtml — l'espressione `(_floorNet=…, '')`
    // valuta a stringa vuota nel template, così la rete NON viene emessa inline — e il
    // chiamante (_renderNodeProps) lo ri-emette DOPO la fisarmonica device. Sui rack
    // resta '' (lì l'ordine è già gestito dall'assemblaggio in app-properties-node.js).
    let _floorNet = '';
            if(n.type==='ap'){
                h+=`${_identityBlock}
                    <div class="prop-group"><label>${t('f.apId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="AP-01" onchange="updateFloorId(this.value)"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false, macLabel:'MAC / BSSID'}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-ap')?'open':''} ontoggle="setPropsSectionState('device-ap',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-wifi"></i> ${t('dev.ap')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <!-- Config Wi-Fi (SSID/banda/canale/standard/sicurezza/VLAN) unificata
                         con il router: vive nella fisarmonica WIRELESS (interfacce radio
                         n.radios[]). I campi legacy a singola radio sono stati rimossi. -->
                    <h4 style="margin:0 0 8px;color:var(--text-main);border-bottom:1px solid var(--panel-border);padding-bottom:4px">${t('pnl.dev.mgmtPower')}</h4>
                    <div class="prop-group"><label>Controller</label><select onchange="updateN('apController',this.value)">
                        <option value="standalone"  ${selected(n.apController||'standalone','standalone')}>Standalone</option>
                        <option value="unifi"       ${selected(n.apController,'unifi')}>UniFi Controller</option>
                        <option value="omada"       ${selected(n.apController,'omada')}>TP-Link Omada</option>
                        <option value="aruba"       ${selected(n.apController,'aruba')}>Aruba Central / Mobility</option>
                        <option value="cisco-wlc"   ${selected(n.apController,'cisco-wlc')}>Cisco WLC</option>
                        <option value="meraki"      ${selected(n.apController,'meraki')}>Cisco Meraki</option>
                        <option value="ruckus"      ${selected(n.apController,'ruckus')}>Ruckus SmartZone</option>
                        <option value="fortinet"    ${selected(n.apController,'fortinet')}>FortiAP / FortiLAN</option>
                        <option value="other"       ${selected(n.apController,'other')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.power')}</label><select onchange="updateN('powerType',this.value)">
                        <option value="poe"     ${selected(n.powerType||'poe','poe')}>PoE (802.3af — 15.4W)</option>
                        <option value="poe+"    ${selected(n.powerType,'poe+')}>PoE+ (802.3at — 30W)</option>
                        <option value="poe++"   ${selected(n.powerType,'poe++')}>PoE++ (802.3bt — 60W)</option>
                        <option value="dc"      ${selected(n.powerType,'dc')}>${t('o.dcAdapter')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.vlanMgmt')}</label><input type="number" min="1" max="4094" value="${n.mgmtVlan||1}" placeholder="1" onchange="updateN('mgmtVlan',parseInt(this.value)||1)"></div>
                    <h4 style="margin:12px 0 8px;color:var(--text-main);border-bottom:1px solid var(--panel-border);padding-bottom:4px">${t('pnl.dev.installation')}</h4>
                    <div class="prop-group"><label>${t('f.mounting')}</label><select onchange="updateN('mountType',this.value)">
                        <option value="ceiling"  ${selected(n.mountType||'ceiling','ceiling')}>${t('o.mountCeiling')}</option>
                        <option value="wall"     ${selected(n.mountType,'wall')}>${t('o.mountWall')}</option>
                        <option value="outdoor-pole"  ${selected(n.mountType,'outdoor-pole')}>${t('o.outdoorPole')}</option>
                        <option value="outdoor-wall"  ${selected(n.mountType,'outdoor-wall')}>${t('o.outdoorWall')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.installHeight')}</label><input type="number" min="0" max="30" step="0.1" value="${n.installHeight??3.0}" onchange="updateN('installHeight',parseFloat(this.value)||0)"></div>
                    <div class="prop-group"><label>${t('f.estCoverage')}</label><input type="number" min="1" max="500" value="${n.coverageRadius||15}" onchange="updateN('coverageRadius',parseInt(this.value)||15)"></div>
                </div></details>`;
            }
            if(n.type==='webcam'){
                h+=`<div class="prop-group"><label>${t('f.cameraId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="CAM-01" onchange="updateFloorId(this.value)"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false, macLabel:'MAC'}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-webcam')?'open':''} ontoggle="setPropsSectionState('device-webcam',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-video"></i> ${t('dev.webcam')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('f.mounting')}</label><select onchange="updateN('mountType',this.value)">
                        <option value="ceiling" ${selected(n.mountType||'ceiling','ceiling')}>${t('o.ceiling')}</option>
                        <option value="wall"    ${selected(n.mountType,'wall')}>${t('o.wall')}</option>
                        <option value="pole"    ${selected(n.mountType,'pole')}>${t('o.pole')}</option>
                        <option value="desk"    ${selected(n.mountType,'desk')}>${t('o.deskShelf')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.installHeight')}</label><input type="number" min="0" max="20" step="0.1" value="${n.installHeight??2.8}" onchange="updateN('installHeight',parseFloat(this.value)||0)"></div>
                    <div class="prop-group"><label>${t('field.power')}</label><select onchange="updateN('powerType',this.value)">
                        <option value="poe"      ${selected(n.powerType||'poe','poe')}>PoE</option>
                        <option value="poe-plus" ${selected(n.powerType,'poe-plus')}>PoE+</option>
                        <option value="dc"       ${selected(n.powerType,'dc')}>DC Adapter</option>
                        <option value="usb"      ${selected(n.powerType,'usb')}>USB</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.resolution')}</label><select onchange="updateN('resolution',this.value)">
                        <option value="1080p" ${selected(n.resolution||'1080p','1080p')}>1080p</option>
                        <option value="2k"    ${selected(n.resolution,'2k')}>2K</option>
                        <option value="4k"    ${selected(n.resolution,'4k')}>4K</option>
                        <option value="8mp"   ${selected(n.resolution,'8mp')}>8 MP</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.lensFov')}</label><input value="${escapeHTML(n.lens||'2.8mm / 110deg')}" onchange="updateN('lens',this.value)"></div>
                    <div class="prop-group"><label>${t('f.coverageZone')}</label><input value="${escapeHTML(n.coverageZone||'')}" placeholder="${t('pnl.dev.phEntranceCorridor')}" onchange="updateN('coverageZone',this.value)"></div>
                    <div class="prop-group"><label>NVR / VMS</label><input value="${escapeHTML(n.recorder||'')}" placeholder="NVR-01 / VMS" onchange="updateN('recorder',this.value)"></div>
                    <div class="prop-group"><label>${t('f.installStatus')}</label><select onchange="updateN('installStatus',this.value)">
                        <option value="planned"    ${selected(n.installStatus||'planned','planned')}>${t('o.planned')}</option>
                        <option value="cabled"     ${selected(n.installStatus,'cabled')}>${t('o.wired')}</option>
                        <option value="mounted"    ${selected(n.installStatus,'mounted')}>${t('o.mounted')}</option>
                        <option value="configured" ${selected(n.installStatus,'configured')}>${t('o.configured')}</option>
                        <option value="tested"     ${selected(n.installStatus,'tested')}>${t('o.tested')}</option>
                    </select></div>
                    <div class="prop-group"><label><input type="checkbox" ${checked(n.irEnabled)}    onchange="updateN('irEnabled',this.checked)"    style="width:auto;margin-right:6px"> IR / Night Vision</label></div>
                    <div class="prop-group"><label><input type="checkbox" ${checked(n.audioEnabled)} onchange="updateN('audioEnabled',this.checked)" style="width:auto;margin-right:6px"> ${t('pnl.dev.audioEnabled')}</label></div>
                </div></details>`;
            }
            if(n.type==='wallport'){
                h+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-wallport')?'open':''} ontoggle="setPropsSectionState('device-wallport',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-ethernet"></i> ${t('dev.wallport')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('f.socketId')}</label><input value="${escapeHTML(getWallPortLabel(n))}" placeholder="A-01" onchange="updateWallPortId(this.value)"></div>
                </div></details>`;
            }
            if(n.type==='printer'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="PRN-01" onchange="updateFloorId(this.value)"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-printer')?'open':''} ontoggle="setPropsSectionState('device-printer',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-print"></i> ${t('dev.printer')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('field.brand')}</label><input value="${escapeHTML(n.brand||'')}" placeholder="HP, Canon, Epson, Ricoh…" onchange="updateN('brand',this.value)"></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="LaserJet Pro M404dn…" onchange="updateN('model',this.value)"></div>
                    <h4 style="margin:12px 0 8px;color:var(--text-main);border-bottom:1px solid var(--panel-border);padding-bottom:4px">${t('pnl.dev.networkPrint')}</h4>
                    <div class="prop-group"><label>${t('field.connection')}</label><select onchange="updateN('connection',this.value)">
                        <option value="wired"    ${selected(n.connection||'wired','wired')}>${t('o.wiredEth')}</option>
                        <option value="wireless" ${selected(n.connection,'wireless')}>Wireless (Wi-Fi)</option>
                        <option value="both"     ${selected(n.connection,'both')}>${t('o.wiredWifi')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.printProto')}</label><select onchange="updateN('printProto',this.value)">
                        <option value="raw9100" ${selected(n.printProto||'raw9100','raw9100')}>${t('pnl.dev.rawPort9100')}</option>
                        <option value="ipp"     ${selected(n.printProto,'ipp')}>IPP / IPPS</option>
                        <option value="smb"     ${selected(n.printProto,'smb')}>SMB / Windows Share</option>
                        <option value="lpd"     ${selected(n.printProto,'lpd')}>LPD / LPR</option>
                    </select></div>                    <div class="prop-group"><label><input type="checkbox" ${checked(n.colorPrint)} onchange="updateN('colorPrint',this.checked)" style="width:auto;margin-right:6px"> ${t('pnl.dev.colorPrint')}</label></div>
                    <div class="prop-group"><label><input type="checkbox" ${checked(n.duplexPrint)} onchange="updateN('duplexPrint',this.checked)" style="width:auto;margin-right:6px"> ${t('pnl.dev.duplexPrint')}</label></div>
                </div></details>`;
            }
            if(n.type==='voip'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="TEL-01" onchange="updateFloorId(this.value)"></div>
                    <div class="prop-group"><label>${t('f.extNumber')}</label><input value="${escapeHTML(n.extension||'')}" placeholder="201" onchange="updateN('extension',this.value)"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-voip')?'open':''} ontoggle="setPropsSectionState('device-voip',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-phone"></i> ${t('dev.voip')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('field.brand')}</label><select onchange="updateN('brand',this.value)">
                        <option value="Cisco"       ${selected(n.brand||'Cisco','Cisco')}>Cisco</option>
                        <option value="Yealink"     ${selected(n.brand,'Yealink')}>Yealink</option>
                        <option value="Snom"        ${selected(n.brand,'Snom')}>Snom</option>
                        <option value="Grandstream" ${selected(n.brand,'Grandstream')}>Grandstream</option>
                        <option value="Polycom"     ${selected(n.brand,'Polycom')}>Poly / Polycom</option>
                        <option value="Fanvil"      ${selected(n.brand,'Fanvil')}>Fanvil</option>
                        <option value="Avaya"       ${selected(n.brand,'Avaya')}>Avaya</option>
                        <option value="Altro"       ${selected(n.brand,'Altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="T46U, CP8841…" onchange="updateN('model',this.value)"></div>
                    <h4 style="margin:12px 0 8px;color:var(--text-main);border-bottom:1px solid var(--panel-border);padding-bottom:4px">${t('pnl.dev.voipConfig')}</h4>
                    <div class="prop-group"><label>${t('f.protocol')}</label><select onchange="updateN('voipProto',this.value)">
                        <option value="SIP"   ${selected(n.voipProto||'SIP','SIP')}>SIP</option>
                        <option value="SCCP"  ${selected(n.voipProto,'SCCP')}>SCCP (Cisco Skinny)</option>
                        <option value="H.323" ${selected(n.voipProto,'H.323')}>H.323</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.pbxHost')}</label><input value="${escapeHTML(n.pbxHost||'')}" placeholder="${t('pnl.dev.phPbxHost')}" onchange="updateN('pbxHost',this.value)"></div>
                    <div class="prop-group"><label>${t('f.prefCodec')}</label><select onchange="updateN('audioCodec',this.value)">
                        <option value="G.711u" ${selected(n.audioCodec||'G.711u','G.711u')}>G.711 µ-law (PCMU)</option>
                        <option value="G.711a" ${selected(n.audioCodec,'G.711a')}>G.711 a-law (PCMA)</option>
                        <option value="G.722"  ${selected(n.audioCodec,'G.722')}>G.722 (HD audio)</option>
                        <option value="G.729"  ${selected(n.audioCodec,'G.729')}>${t('pnl.dev.g729LowBw')}</option>
                        <option value="Opus"   ${selected(n.audioCodec,'Opus')}>Opus</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.power')}</label><select onchange="updateN('powerType',this.value)">
                        <option value="poe"  ${selected(n.powerType||'poe','poe')}>PoE (802.3af — 15.4W)</option>
                        <option value="poe+" ${selected(n.powerType,'poe+')}>PoE+ (802.3at — 30W)</option>
                        <option value="dc"   ${selected(n.powerType,'dc')}>${t('o.dcAdapter')}</option>
                    </select></div>
                </div></details>`;
            }
            if(n.type==='badgereader'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="BADGE-01" onchange="updateFloorId(this.value)"></div>
                    <div class="prop-group"><label>${t('f.zonePort')}</label><input value="${escapeHTML(n.zone||'')}" placeholder="${t('pnl.dev.phZoneExample')}" onchange="updateN('zone',this.value)"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-badgereader')?'open':''} ontoggle="setPropsSectionState('device-badgereader',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-id-card"></i> ${t('dev.badgereader')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('field.brand')}</label><select onchange="updateN('brand',this.value)">
                        <option value="HID"     ${selected(n.brand||'HID','HID')}>HID Global</option>
                        <option value="Axis"    ${selected(n.brand,'Axis')}>Axis</option>
                        <option value="Lenel"   ${selected(n.brand,'Lenel')}>Lenel / Carrier</option>
                        <option value="Bosch"   ${selected(n.brand,'Bosch')}>Bosch</option>
                        <option value="IDEMIA"  ${selected(n.brand,'IDEMIA')}>IDEMIA (Morpho)</option>
                        <option value="Suprema" ${selected(n.brand,'Suprema')}>Suprema</option>
                        <option value="Altro"   ${selected(n.brand,'Altro')}>${t('o.other')}</option>
                    </select></div>
                    <h4 style="margin:12px 0 8px;color:var(--text-main);border-bottom:1px solid var(--panel-border);padding-bottom:4px">${t('pnl.dev.accessControlConfig')}</h4>
                    <div class="prop-group"><label>${t('f.readerType')}</label><select onchange="updateN('readerType',this.value)">
                        <option value="rfid-125"  ${selected(n.readerType||'rfid-125','rfid-125')}>RFID 125 kHz (EM/HID Prox)</option>
                        <option value="rfid-mifare"${selected(n.readerType,'rfid-mifare')}>RFID 13.56 MHz (MIFARE / iCLASS)</option>
                        <option value="bio-finger" ${selected(n.readerType,'bio-finger')}>${t('o.bioFinger')}</option>
                        <option value="bio-face"   ${selected(n.readerType,'bio-face')}>${t('o.bioFace')}</option>
                        <option value="pin-badge"  ${selected(n.readerType,'pin-badge')}>PIN + badge</option>
                        <option value="pin-only"   ${selected(n.readerType,'pin-only')}>${t('o.pinOnly')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.ifaceProto')}</label><select onchange="updateN('readerProto',this.value)">
                        <option value="wiegand26" ${selected(n.readerProto||'wiegand26','wiegand26')}>Wiegand 26-bit</option>
                        <option value="wiegand34" ${selected(n.readerProto,'wiegand34')}>Wiegand 34-bit</option>
                        <option value="osdp"      ${selected(n.readerProto,'osdp')}>OSDP v2</option>
                        <option value="rs485"     ${selected(n.readerProto,'rs485')}>RS-485</option>
                        <option value="tcpip"     ${selected(n.readerProto,'tcpip')}>${t('pnl.dev.tcpipDirect')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.ctrlPanel')}</label><input value="${escapeHTML(n.accessController||'')}" placeholder="${t('pnl.dev.phCtrlIpHost')}" onchange="updateN('accessController',this.value)"></div>                    <div class="prop-group"><label>${t('field.power')}</label><select onchange="updateN('powerType',this.value)">
                        <option value="poe"   ${selected(n.powerType||'poe','poe')}>PoE (802.3af)</option>
                        <option value="dc12"  ${selected(n.powerType,'dc12')}>DC 12V</option>
                        <option value="dc24"  ${selected(n.powerType,'dc24')}>DC 24V</option>
                    </select></div>
                </div></details>`;
            }
            if(n.type==='pc'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="PC-MARIO, WS-01" onchange="updateFloorId(this.value)"></div>
                    <div class="prop-group"><label>${t('f.assignedUser')}</label><input value="${escapeHTML(n.assignedUser||'')}" placeholder="Mario Rossi" onchange="updateN('assignedUser',this.value)"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-pc')?'open':''} ontoggle="setPropsSectionState('device-pc',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-desktop"></i> ${t('dev.pc')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('field.brand')}</label><select onchange="updateN('brand',this.value)">
                        <option value="Dell"    ${selected(n.brand||'Dell','Dell')}>Dell</option>
                        <option value="HP"      ${selected(n.brand,'HP')}>HP</option>
                        <option value="Lenovo"  ${selected(n.brand,'Lenovo')}>Lenovo</option>
                        <option value="Apple"   ${selected(n.brand,'Apple')}>Apple</option>
                        <option value="Acer"    ${selected(n.brand,'Acer')}>Acer</option>
                        <option value="Asus"    ${selected(n.brand,'Asus')}>Asus</option>
                        <option value="Custom"  ${selected(n.brand,'Custom')}>${t('o.assembled')}</option>
                        <option value="Altro"   ${selected(n.brand,'Altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="OptiPlex 7090, ThinkCentre…" onchange="updateN('model',this.value)"></div>
                    <div class="prop-group"><label>${t('f.os')}</label><select onchange="updateN('osType',this.value)">
                        <option value="win11"   ${selected(n.osType||'win11','win11')}>Windows 11</option>
                        <option value="win10"   ${selected(n.osType,'win10')}>Windows 10</option>
                        <option value="win-srv" ${selected(n.osType,'win-srv')}>Windows Server</option>
                        <option value="ubuntu"  ${selected(n.osType,'ubuntu')}>Ubuntu / Debian</option>
                        <option value="rhel"    ${selected(n.osType,'rhel')}>RHEL / CentOS</option>
                        <option value="macos"   ${selected(n.osType,'macos')}>macOS</option>
                        <option value="altro"   ${selected(n.osType,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.connection')}</label><select onchange="updateN('connection',this.value)">
                        <option value="wired"    ${selected(n.connection||'wired','wired')}>${t('o.wiredEth')}</option>
                        <option value="wireless" ${selected(n.connection,'wireless')}>Wireless (Wi-Fi)</option>
                        <option value="both"     ${selected(n.connection,'both')}>${t('o.wiredWifi')}</option>
                    </select></div>                </div></details>`;
            }
            if(n.type==='mobile'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="PHONE-MARIO, IPAD-01" onchange="updateFloorId(this.value)"></div>
                    <div class="prop-group"><label>${t('f.assignedUser')}</label><input value="${escapeHTML(n.assignedUser||'')}" placeholder="Mario Rossi" onchange="updateN('assignedUser',this.value)"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false, ipPlaceholder:'192.168... (se IP)'}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-mobile')?'open':''} ontoggle="setPropsSectionState('device-mobile',this.open)"><summary class="props-collapsible-head"><span><i class="fas ${escapeHTML(d.icon)}"></i> ${t('dev.mobile')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('f.formFactor')}</label><select onchange="updateN('formFactor',this.value)">
                        <option value="smartphone" ${selected(n.formFactor||'smartphone','smartphone')}>Smartphone</option>
                        <option value="tablet"     ${selected(n.formFactor,'tablet')}>Tablet</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.brand')}</label><select onchange="updateN('brand',this.value)">
                        <option value="Apple"     ${selected(n.brand||'Apple','Apple')}>Apple</option>
                        <option value="Samsung"   ${selected(n.brand,'Samsung')}>Samsung</option>
                        <option value="Google"    ${selected(n.brand,'Google')}>Google</option>
                        <option value="Xiaomi"    ${selected(n.brand,'Xiaomi')}>Xiaomi</option>
                        <option value="Huawei"    ${selected(n.brand,'Huawei')}>Huawei</option>
                        <option value="Lenovo"    ${selected(n.brand,'Lenovo')}>Lenovo</option>
                        <option value="Microsoft" ${selected(n.brand,'Microsoft')}>Microsoft</option>
                        <option value="Altro"     ${selected(n.brand,'Altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="iPhone 15, iPad Air, Galaxy…" onchange="updateN('model',this.value)"></div>
                    <div class="prop-group"><label>${t('f.os')}</label><select onchange="updateN('osType',this.value)">
                        <option value="ios"     ${selected(n.osType||'ios','ios')}>iOS</option>
                        <option value="ipados"  ${selected(n.osType,'ipados')}>iPadOS</option>
                        <option value="android" ${selected(n.osType,'android')}>Android</option>
                        <option value="windows" ${selected(n.osType,'windows')}>Windows</option>
                        <option value="altro"   ${selected(n.osType,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.ownership')}</label><select onchange="updateN('ownership',this.value)">
                        <option value="corporate" ${selected(n.ownership||'corporate','corporate')}>${t('o.corporate')}</option>
                        <option value="byod"      ${selected(n.ownership,'byod')}>${t('o.byod')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.mdm')}</label><select onchange="updateN('mdm',this.value)">
                        <option value="none"         ${selected(n.mdm||'none','none')}>${t('o.mdmNone')}</option>
                        <option value="intune"       ${selected(n.mdm,'intune')}>Microsoft Intune</option>
                        <option value="jamf"         ${selected(n.mdm,'jamf')}>Jamf</option>
                        <option value="workspaceone" ${selected(n.mdm,'workspaceone')}>Workspace ONE</option>
                        <option value="google"       ${selected(n.mdm,'google')}>Google Endpoint</option>
                        <option value="altro"        ${selected(n.mdm,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.connection')}</label><select onchange="updateN('connection',this.value)">
                        <option value="wireless" ${selected(n.connection||'wireless','wireless')}>Wireless (Wi-Fi)</option>
                        <option value="cellular" ${selected(n.connection,'cellular')}>${t('o.cellular')}</option>
                        <option value="both"     ${selected(n.connection,'both')}>${t('o.wifiCellular')}</option>
                    </select></div>
                </div></details>`;
            }
            if(n.type==='nasdesktop'){
                const protos = Array.isArray(n.nasProtocols) ? n.nasProtocols : [];
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="NAS-01, DS920+" onchange="updateFloorId(this.value)"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-nasdesktop')?'open':''} ontoggle="setPropsSectionState('device-nasdesktop',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-hard-drive"></i> ${t('dev.nasdesktop')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.swPlatform')}</label><select onchange="updateN('nasPlatform',this.value)">
                        <option value="dsm"     ${selected(n.nasPlatform||'dsm','dsm')}>DSM (Synology)</option>
                        <option value="qts"     ${selected(n.nasPlatform,'qts')}>QTS (QNAP)</option>
                        <option value="truenas" ${selected(n.nasPlatform,'truenas')}>TrueNAS Core/Scale</option>
                        <option value="unraid"  ${selected(n.nasPlatform,'unraid')}>Unraid</option>
                        <option value="altro"   ${selected(n.nasPlatform,'altro')}>${t('o.otherProprietary')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.usableCap')}</label>
                        <input type="number" min="0.1" max="100000" step="0.1" value="${n.nasCapacityTb||4}" onchange="updateN('nasCapacityTb',parseFloat(this.value)||4)"></div>
                    <div class="prop-group"><label>RAID</label><select onchange="updateN('nasRaid',this.value)">
                        <option value="shr"    ${selected(n.nasRaid||'shr','shr')}>SHR (Synology Hybrid)</option>
                        <option value="raid1"  ${selected(n.nasRaid,'raid1')}>RAID 1 (mirror)</option>
                        <option value="raid5"  ${selected(n.nasRaid,'raid5')}>RAID 5</option>
                        <option value="raid6"  ${selected(n.nasRaid,'raid6')}>RAID 6</option>
                        <option value="raid10" ${selected(n.nasRaid,'raid10')}>RAID 10</option>
                        <option value="jbod"   ${selected(n.nasRaid,'jbod')}>${t('o.jbod')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.exposedProtocols')}</label>
                        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:2px">
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('smb'))}   onchange="_toggleArrayField('${n.id}','nasProtocols','smb',this.checked)"   style="width:auto;margin-right:6px">SMB</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('nfs'))}   onchange="_toggleArrayField('${n.id}','nasProtocols','nfs',this.checked)"   style="width:auto;margin-right:6px">NFS</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('iscsi'))} onchange="_toggleArrayField('${n.id}','nasProtocols','iscsi',this.checked)" style="width:auto;margin-right:6px">iSCSI</label>
                        </div>
                    </div>
                </div></details>`;
            }
            if(n.type==='iot'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="IOT-01, SENSOR-TEMP-A" onchange="updateFloorId(this.value)"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false, ipPlaceholder:'192.168... (se IP)'}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-iot')?'open':''} ontoggle="setPropsSectionState('device-iot',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-microchip"></i> ${t('dev.iot')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('f.deviceType')}</label><select onchange="updateN('iotType',this.value)">
                        <option value="temp"      ${selected(n.iotType||'temp','temp')}>${t('o.iotTemp')}</option>
                        <option value="temp-hum"  ${selected(n.iotType,'temp-hum')}>${t('o.iotTempHum')}</option>
                        <option value="motion"    ${selected(n.iotType,'motion')}>${t('o.iotMotion')}</option>
                        <option value="smoke"     ${selected(n.iotType,'smoke')}>${t('o.iotSmoke')}</option>
                        <option value="smartplug" ${selected(n.iotType,'smartplug')}>${t('o.iotSmartplug')}</option>
                        <option value="gateway"   ${selected(n.iotType,'gateway')}>${t('o.iotGateway')}</option>
                        <option value="ups-mon"   ${selected(n.iotType,'ups-mon')}>${t('o.iotUpsMon')}</option>
                        <option value="altro"     ${selected(n.iotType,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.protocol')}</label><select onchange="updateN('iotProto',this.value)">
                        <option value="mqtt"    ${selected(n.iotProto||'mqtt','mqtt')}>MQTT</option>
                        <option value="http"    ${selected(n.iotProto,'http')}>HTTP / REST</option>
                        <option value="zigbee"  ${selected(n.iotProto,'zigbee')}>Zigbee</option>
                        <option value="zwave"   ${selected(n.iotProto,'zwave')}>Z-Wave</option>
                        <option value="modbus"  ${selected(n.iotProto,'modbus')}>Modbus TCP/RTU</option>
                        <option value="bacnet"  ${selected(n.iotProto,'bacnet')}>BACnet</option>
                        <option value="snmp"    ${selected(n.iotProto,'snmp')}>SNMP</option>
                        <option value="altro"   ${selected(n.iotProto,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.brokerGw')}</label><input value="${escapeHTML(n.iotBroker||'')}" placeholder="${t('pnl.dev.phMqttHost')}" onchange="updateN('iotBroker',this.value)"></div>                    <div class="prop-group"><label>${t('field.power')}</label><select onchange="updateN('powerType',this.value)">
                        <option value="poe"      ${selected(n.powerType||'poe','poe')}>PoE</option>
                        <option value="dc"       ${selected(n.powerType,'dc')}>${t('o.dcAdapter')}</option>
                        <option value="battery"  ${selected(n.powerType,'battery')}>${t('o.battery')}</option>
                        <option value="usb"      ${selected(n.powerType,'usb')}>USB</option>
                    </select></div>
                </div></details>`;
            }
            if(n.type==='projector'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="${t('pnl.dev.phProjName')}" onchange="updateFloorId(this.value)"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-projector')?'open':''} ontoggle="setPropsSectionState('device-projector',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-chalkboard"></i> ${t('dev.projector')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('field.brand')}</label><select onchange="updateN('brand',this.value)">
                        <option value="Epson"    ${selected(n.brand||'Epson','Epson')}>Epson</option>
                        <option value="BenQ"     ${selected(n.brand,'BenQ')}>BenQ</option>
                        <option value="Sony"     ${selected(n.brand,'Sony')}>Sony</option>
                        <option value="Panasonic"${selected(n.brand,'Panasonic')}>Panasonic</option>
                        <option value="NEC"      ${selected(n.brand,'NEC')}>NEC / Sharp</option>
                        <option value="Optoma"   ${selected(n.brand,'Optoma')}>Optoma</option>
                        <option value="Barco"    ${selected(n.brand,'Barco')}>Barco</option>
                        <option value="Altro"    ${selected(n.brand,'Altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="EB-2250U, VPL-FHZ85…" onchange="updateN('model',this.value)"></div>
                    <div class="prop-group"><label>${t('f.resolution')}</label><select onchange="updateN('resolution',this.value)">
                        <option value="1080p" ${selected(n.resolution||'1080p','1080p')}>Full HD 1080p</option>
                        <option value="4k"    ${selected(n.resolution,'4k')}>4K UHD</option>
                        <option value="wxga"  ${selected(n.resolution,'wxga')}>WXGA (1280×800)</option>
                        <option value="xga"   ${selected(n.resolution,'xga')}>XGA (1024×768)</option>
                        <option value="wuxga" ${selected(n.resolution,'wuxga')}>WUXGA (1920×1200)</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.brightness')}</label><input type="number" min="500" max="50000" step="500" value="${n.lumens||3000}" onchange="updateN('lumens',parseInt(this.value)||3000)"></div>
                    <div class="prop-group"><label>${t('f.netConn')}</label><select onchange="updateN('connection',this.value)">
                        <option value="wired"    ${selected(n.connection||'wired','wired')}>${t('o.wiredEth')}</option>
                        <option value="wireless" ${selected(n.connection,'wireless')}>Wireless (Wi-Fi)</option>
                        <option value="none"     ${selected(n.connection,'none')}>${t('o.noneHdmi')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.remoteProto')}</label><select onchange="updateN('projCtrl',this.value)">
                        <option value="pjlink"   ${selected(n.projCtrl||'pjlink','pjlink')}>PJLink (TCP 4352)</option>
                        <option value="crestron" ${selected(n.projCtrl,'crestron')}>Crestron</option>
                        <option value="amx"      ${selected(n.projCtrl,'amx')}>AMX</option>
                        <option value="http"     ${selected(n.projCtrl,'http')}>${t('pnl.dev.httpRestProprietary')}</option>
                        <option value="rs232"    ${selected(n.projCtrl,'rs232')}>${t('o.rs232serial')}</option>
                        <option value="none"     ${selected(n.projCtrl,'none')}>${t('o.none')}</option>
                    </select></div>                </div></details>`;
            }
            if(n.type==='pbx'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-pbx')?'open':''} ontoggle="setPropsSectionState('device-pbx',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-phone-volume"></i> ${t('dev.pbx')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.trunkProto')}</label><select onchange="updateN('pbxTrunk',this.value)">
                        <option value="sip"       ${selected(n.pbxTrunk||'sip','sip')}>SIP Trunk</option>
                        <option value="isdn-pri"  ${selected(n.pbxTrunk,'isdn-pri')}>ISDN PRI (E1/T1)</option>
                        <option value="isdn-bri"  ${selected(n.pbxTrunk,'isdn-bri')}>ISDN BRI</option>
                        <option value="fxo"       ${selected(n.pbxTrunk,'fxo')}>${t('o.analogFxo')}</option>
                        <option value="gsm"       ${selected(n.pbxTrunk,'gsm')}>Gateway GSM</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.pstnGw')}</label>
                        <input value="${escapeHTML(n.pstnGateway||'')}" placeholder="${t('pnl.dev.phPstnGw')}" onchange="updateN('pstnGateway',this.value)"></div>
                    <div class="prop-group"><label>${t('f.maxExtensions')}</label>
                        <input type="number" min="1" max="10000" value="${n.pbxExtensions||50}" onchange="updateN('pbxExtensions',parseInt(this.value)||50)"></div>
                    <div class="prop-group"><label>${t('f.externalLines')}</label>
                        <input type="number" min="1" max="1000" value="${n.pbxTrunkLines||8}" onchange="updateN('pbxTrunkLines',parseInt(this.value)||8)"></div>
                    <div class="prop-group"><label>${t('f.software')}</label><select onchange="updateN('pbxSoftware',this.value)">
                        <option value="3cx"        ${selected(n.pbxSoftware||'3cx','3cx')}>3CX</option>
                        <option value="asterisk"   ${selected(n.pbxSoftware,'asterisk')}>Asterisk / FreePBX</option>
                        <option value="sangoma"    ${selected(n.pbxSoftware,'sangoma')}>Sangoma</option>
                        <option value="audiocodes" ${selected(n.pbxSoftware,'audiocodes')}>AudioCodes</option>
                        <option value="cisco-cucm" ${selected(n.pbxSoftware,'cisco-cucm')}>Cisco CUCM</option>
                        <option value="avaya"      ${selected(n.pbxSoftware,'avaya')}>Avaya</option>
                        <option value="altro"      ${selected(n.pbxSoftware,'altro')}>${t('o.other')}</option>
                    </select></div>
                </div></details>`;
            }
            if(n.type==='consolesvr'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-consolesvr')?'open':''} ontoggle="setPropsSectionState('device-consolesvr',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-terminal"></i> ${t('dev.consolesvr')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.oobIp')}</label>
                        <input value="${escapeHTML(n.oobIp||'')}" placeholder="${t('pnl.dev.phOobIp')}" onchange="updateN('oobIp',this.value)"></div>
                    <div class="prop-group"><label>${t('f.serialPorts')}</label>
                        <input type="number" min="1" max="96" value="${n.serialPorts||8}" onchange="updateN('serialPorts',parseInt(this.value)||8)"></div>
                    <div class="prop-group"><label>${t('f.serialBaud')}</label><select onchange="updateN('serialBaud',this.value)">
                        <option value="9600"   ${selected(n.serialBaud||'9600','9600')}>9600</option>
                        <option value="19200"  ${selected(n.serialBaud,'19200')}>19200</option>
                        <option value="38400"  ${selected(n.serialBaud,'38400')}>38400</option>
                        <option value="57600"  ${selected(n.serialBaud,'57600')}>57600</option>
                        <option value="115200" ${selected(n.serialBaud,'115200')}>115200</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.accessProtocols')}</label>
                        <div style="display:flex;flex-direction:column;gap:4px;margin-top:2px">
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(n.accessSsh!==false)}  onchange="updateN('accessSsh',this.checked)"   style="width:auto;margin-right:6px">SSH</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(n.accessHttps)}        onchange="updateN('accessHttps',this.checked)" style="width:auto;margin-right:6px">HTTPS Web UI</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(n.accessTelnet)}       onchange="updateN('accessTelnet',this.checked)" style="width:auto;margin-right:6px">${t('pnl.dev.telnetDeprecated')}</label>
                        </div>
                    </div>
                </div></details>`;
            }
            if(n.type==='wlanctrl'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-wlanctrl')?'open':''} ontoggle="setPropsSectionState('device-wlanctrl',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-wifi"></i> ${t('dev.wlanctrl')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.apManagedCur')}</label>
                        <input type="number" min="0" max="10000" value="${n.apManaged||0}" onchange="updateN('apManaged',parseInt(this.value)||0)"></div>
                    <div class="prop-group"><label>${t('f.maxApCap')}</label>
                        <input type="number" min="1" max="10000" value="${n.apCapacity||50}" onchange="updateN('apCapacity',parseInt(this.value)||50)"></div>
                    <div class="prop-group"><label>${t('f.licenses')}</label>
                        <input value="${escapeHTML(n.wlcLicenses||'')}" placeholder="${t('pnl.dev.phWlcLicenses')}" onchange="updateN('wlcLicenses',this.value)"></div>
                    <div class="prop-group"><label>${t('f.platform')}</label><select onchange="updateN('wlcPlatform',this.value)">
                        <option value="cisco-wlc"  ${selected(n.wlcPlatform||'cisco-wlc','cisco-wlc')}>Cisco WLC / DNA Center</option>
                        <option value="aruba"      ${selected(n.wlcPlatform,'aruba')}>Aruba Mobility Controller</option>
                        <option value="unifi"      ${selected(n.wlcPlatform,'unifi')}>Ubiquiti UniFi</option>
                        <option value="ruckus"     ${selected(n.wlcPlatform,'ruckus')}>Ruckus SmartZone</option>
                        <option value="fortinet"   ${selected(n.wlcPlatform,'fortinet')}>Fortinet FortiAP</option>
                        <option value="omada"      ${selected(n.wlcPlatform,'omada')}>TP-Link Omada</option>
                        <option value="altro"      ${selected(n.wlcPlatform,'altro')}>${t('o.other')}</option>
                    </select></div>
                </div></details>`;
            }
            if(n.type==='mediaconv'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-mediaconv')?'open':''} ontoggle="setPropsSectionState('device-mediaconv',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-right-left"></i> ${t('dev.mediaconv')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.fiberType')}</label><select onchange="updateN('fiberType',this.value)">
                        <option value="sm"  ${selected(n.fiberType||'sm','sm')}>Single-mode (SM)</option>
                        <option value="mm"  ${selected(n.fiberType,'mm')}>Multi-mode (MM)</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.fiberConn')}</label><select onchange="updateN('fiberConnector',this.value)">
                        <option value="lc"  ${selected(n.fiberConnector||'lc','lc')}>LC</option>
                        <option value="sc"  ${selected(n.fiberConnector,'sc')}>SC</option>
                        <option value="st"  ${selected(n.fiberConnector,'st')}>ST</option>
                        <option value="fc"  ${selected(n.fiberConnector,'fc')}>FC</option>
                        <option value="mpo" ${selected(n.fiberConnector,'mpo')}>MPO / MTP</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.speed')}</label><select onchange="updateN('linkSpeed',this.value)">
                        <option value="100m"  ${selected(n.linkSpeed||'1g','100m')}>100 Mbps</option>
                        <option value="1g"    ${selected(n.linkSpeed||'1g','1g')}>1 Gbps</option>
                        <option value="10g"   ${selected(n.linkSpeed,'10g')}>10 Gbps</option>
                        <option value="25g"   ${selected(n.linkSpeed,'25g')}>25 Gbps</option>
                        <option value="100g"  ${selected(n.linkSpeed,'100g')}>100 Gbps</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.wavelength')}</label><select onchange="updateN('wavelength',this.value)">
                        <option value="850"  ${selected(n.wavelength||'1310','850')}>850 nm (MM)</option>
                        <option value="1310" ${selected(n.wavelength||'1310','1310')}>1310 nm (SM/MM)</option>
                        <option value="1550" ${selected(n.wavelength,'1550')}>${t('pnl.dev.wl1550')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.maxDistance')}</label>
                        <input type="number" min="0.1" max="200" step="0.1" value="${n.fiberMaxKm||10}" onchange="updateN('fiberMaxKm',parseFloat(this.value)||10)"></div>
                </div></details>`;
            }
            if(n.type==='nvr'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-nvr')?'open':''} ontoggle="setPropsSectionState('device-nvr',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-record-vinyl"></i> ${t('devh.nvr')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.platform')}</label><select onchange="updateN('nvrPlatform',this.value)">
                        <option value="hikvision" ${selected(n.nvrPlatform||'hikvision','hikvision')}>Hikvision</option>
                        <option value="dahua"     ${selected(n.nvrPlatform,'dahua')}>Dahua</option>
                        <option value="axis"      ${selected(n.nvrPlatform,'axis')}>Axis Camera Station</option>
                        <option value="milestone" ${selected(n.nvrPlatform,'milestone')}>Milestone XProtect</option>
                        <option value="synology"  ${selected(n.nvrPlatform,'synology')}>Synology Surveillance Station</option>
                        <option value="ubiquiti"  ${selected(n.nvrPlatform,'ubiquiti')}>Ubiquiti UniFi Protect</option>
                        <option value="genetec"   ${selected(n.nvrPlatform,'genetec')}>Genetec</option>
                        <option value="altro"     ${selected(n.nvrPlatform,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.totalChannels')}</label>
                        <input type="number" min="1" max="512" value="${n.nvrChannels||16}" onchange="updateN('nvrChannels',parseInt(this.value)||16)"></div>
                    <div class="prop-group"><label>${t('f.usedChannels')}</label>
                        <input type="number" min="0" max="512" value="${n.nvrChannelsUsed||0}" onchange="updateN('nvrChannelsUsed',parseInt(this.value)||0)"></div>
                    <div class="prop-group"><label>${t('f.storageCap')}</label>
                        <input type="number" min="0.5" max="500" step="0.5" value="${n.nvrStorageTb||8}" onchange="updateN('nvrStorageTb',parseFloat(this.value)||8)"></div>
                    <div class="prop-group"><label>${t('f.retention')}</label>
                        <input type="number" min="1" max="3650" value="${n.nvrRetentionDays||30}" onchange="updateN('nvrRetentionDays',parseInt(this.value)||30)"></div>
                    <div class="prop-group"><label>Codec</label><select onchange="updateN('nvrCodec',this.value)">
                        <option value="h265plus" ${selected(n.nvrCodec||'h265plus','h265plus')}>H.265+ / Smart</option>
                        <option value="h265"     ${selected(n.nvrCodec,'h265')}>H.265 (HEVC)</option>
                        <option value="h264plus" ${selected(n.nvrCodec,'h264plus')}>H.264+</option>
                        <option value="h264"     ${selected(n.nvrCodec,'h264')}>H.264 (AVC)</option>
                    </select></div>                </div></details>`;
            }
            if(n.type==='sdwan'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-sdwan')?'open':''} ontoggle="setPropsSectionState('device-sdwan',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-cloud-bolt"></i> ${t('dev.sdwan')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.platform')}</label><select onchange="updateN('sdwanPlatform',this.value)">
                        <option value="meraki"     ${selected(n.sdwanPlatform||'meraki','meraki')}>Cisco Meraki MX</option>
                        <option value="velocloud"  ${selected(n.sdwanPlatform,'velocloud')}>VMware VeloCloud</option>
                        <option value="versa"      ${selected(n.sdwanPlatform,'versa')}>Versa Networks</option>
                        <option value="fortinet"   ${selected(n.sdwanPlatform,'fortinet')}>Fortinet Secure SD-WAN</option>
                        <option value="aruba-ec"   ${selected(n.sdwanPlatform,'aruba-ec')}>Aruba EdgeConnect (Silver Peak)</option>
                        <option value="paloalto"   ${selected(n.sdwanPlatform,'paloalto')}>Palo Alto Prisma SD-WAN</option>
                        <option value="catonet"    ${selected(n.sdwanPlatform,'catonet')}>Cato Networks</option>
                        <option value="peplink"    ${selected(n.sdwanPlatform,'peplink')}>Peplink</option>
                        <option value="altro"      ${selected(n.sdwanPlatform,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.wanUplinks')}</label>
                        <input type="number" min="1" max="8" value="${n.sdwanUplinks||2}" onchange="updateN('sdwanUplinks',parseInt(this.value)||2)"></div>
                    <div class="prop-group"><label>${t('f.maxThroughput')}</label>
                        <input type="number" min="10" max="100000" value="${n.sdwanThroughputMbps||500}" onchange="updateN('sdwanThroughputMbps',parseInt(this.value)||500)"></div>
                    <div class="prop-group"><label>${t('f.mode')}</label><select onchange="updateN('sdwanMode',this.value)">
                        <option value="active-active"   ${selected(n.sdwanMode||'active-active','active-active')}>Active / Active</option>
                        <option value="active-standby"  ${selected(n.sdwanMode,'active-standby')}>Active / Standby</option>
                        <option value="single"          ${selected(n.sdwanMode,'single')}>${t('o.singleUplink')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.cloudCtrl')}</label>
                        <input value="${escapeHTML(n.sdwanController||'')}" placeholder="${t('pnl.dev.phSdwanCtrl')}" onchange="updateN('sdwanController',this.value)"></div>
                </div></details>`;
            }
            if(n.type==='vpncon'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-vpncon')?'open':''} ontoggle="setPropsSectionState('device-vpncon',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-key"></i> ${t('dev.vpncon')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.platform')}</label><select onchange="updateN('vpnPlatform',this.value)">
                        <option value="cisco-asa"      ${selected(n.vpnPlatform||'cisco-asa','cisco-asa')}>Cisco ASA / Firepower</option>
                        <option value="cisco-anyconn"  ${selected(n.vpnPlatform,'cisco-anyconn')}>Cisco AnyConnect</option>
                        <option value="fortigate"      ${selected(n.vpnPlatform,'fortigate')}>FortiGate SSL/IPsec</option>
                        <option value="paloalto-gp"    ${selected(n.vpnPlatform,'paloalto-gp')}>Palo Alto GlobalProtect</option>
                        <option value="pulse"          ${selected(n.vpnPlatform,'pulse')}>Pulse Connect / Ivanti</option>
                        <option value="openvpn-as"     ${selected(n.vpnPlatform,'openvpn-as')}>OpenVPN Access Server</option>
                        <option value="wireguard"      ${selected(n.vpnPlatform,'wireguard')}>WireGuard</option>
                        <option value="strongswan"     ${selected(n.vpnPlatform,'strongswan')}>strongSwan</option>
                        <option value="altro"          ${selected(n.vpnPlatform,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.mode')}</label><select onchange="updateN('vpnMode',this.value)">
                        <option value="both"           ${selected(n.vpnMode||'both','both')}>Site-to-site + Remote access</option>
                        <option value="remote-access"  ${selected(n.vpnMode,'remote-access')}>${t('o.remoteOnly')}</option>
                        <option value="site-to-site"   ${selected(n.vpnMode,'site-to-site')}>${t('o.s2sOnly')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.protocols')}</label>
                        <div style="display:flex;flex-direction:column;gap:4px;margin-top:2px">
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(n.vpnProtoIpsec!==false)}  onchange="updateN('vpnProtoIpsec',this.checked)"   style="width:auto;margin-right:6px">IPsec (IKEv2)</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(n.vpnProtoSsl)}            onchange="updateN('vpnProtoSsl',this.checked)"     style="width:auto;margin-right:6px">SSL/TLS</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(n.vpnProtoWg)}             onchange="updateN('vpnProtoWg',this.checked)"      style="width:auto;margin-right:6px">WireGuard</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(n.vpnProtoL2tp)}           onchange="updateN('vpnProtoL2tp',this.checked)"    style="width:auto;margin-right:6px">L2TP/IPsec</label>
                        </div>
                    </div>
                    <div class="prop-group"><label>${t('f.maxSessions')}</label>
                        <input type="number" min="1" max="100000" value="${n.vpnMaxSessions||100}" onchange="updateN('vpnMaxSessions',parseInt(this.value)||100)"></div>
                    <div class="prop-group"><label>${t('f.licenses')}</label>
                        <input value="${escapeHTML(n.vpnLicenses||'')}" placeholder="${t('pnl.dev.phVpnLicenses')}" onchange="updateN('vpnLicenses',this.value)"></div>
                </div></details>`;
            }
            if(n.type==='doorctrl'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="DOOR-ENTR-01, ACL-PIANO2" onchange="updateFloorId(this.value)"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-doorctrl')?'open':''} ontoggle="setPropsSectionState('device-doorctrl',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-door-open"></i> ${t('dev.doorctrl')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('f.platform')}</label><select onchange="updateN('doorPlatform',this.value)">
                        <option value="hid"        ${selected(n.doorPlatform||'hid','hid')}>HID Global (VertX/Aero)</option>
                        <option value="axis"       ${selected(n.doorPlatform,'axis')}>Axis Communications</option>
                        <option value="suprema"    ${selected(n.doorPlatform,'suprema')}>Suprema</option>
                        <option value="zkteco"     ${selected(n.doorPlatform,'zkteco')}>ZKTeco</option>
                        <option value="genetec"    ${selected(n.doorPlatform,'genetec')}>Genetec Synergis</option>
                        <option value="paxton"     ${selected(n.doorPlatform,'paxton')}>Paxton</option>
                        <option value="bft"        ${selected(n.doorPlatform,'bft')}>BFT / Came</option>
                        <option value="altro"      ${selected(n.doorPlatform,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.managedPorts')}</label>
                        <input type="number" min="1" max="32" value="${n.doorCount||2}" onchange="updateN('doorCount',parseInt(this.value)||2)"></div>
                    <div class="prop-group"><label>${t('f.readerTech')}</label><select onchange="updateN('doorReader',this.value)">
                        <option value="mifare"     ${selected(n.doorReader||'mifare','mifare')}>RFID 13.56MHz (Mifare/DESFire)</option>
                        <option value="prox125"    ${selected(n.doorReader,'prox125')}>RFID 125kHz (HID Prox)</option>
                        <option value="nfc-mobile" ${selected(n.doorReader,'nfc-mobile')}>NFC / Mobile credentials</option>
                        <option value="biometric"  ${selected(n.doorReader,'biometric')}>${t('o.bioBoth')}</option>
                        <option value="pin"        ${selected(n.doorReader,'pin')}>${t('o.pinKeypad')}</option>
                        <option value="mixed"      ${selected(n.doorReader,'mixed')}>${t('pnl.dev.multiTech')}</option>
                    </select></div>
                    <label class="prop-check"><input type="checkbox" ${checked(n.poe)} onchange="updateN('poe',this.checked)" style="width:auto;margin-right:6px">${t('pnl.dev.poePowered')}</label>                </div></details>`;
            }
            if(n.type==='panelboard'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="QE-CED, QE-PIANO2" onchange="updateFloorId(this.value)"></div>
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-panelboard')?'open':''} ontoggle="setPropsSectionState('device-panelboard',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-bolt"></i> ${t('dev.panelboard')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('f.powerType')}</label><select onchange="updateN('panelPhase',this.value)">
                        <option value="single-230" ${selected(n.panelPhase||'single-230','single-230')}>${t('o.single230sp')}</option>
                        <option value="three-400"  ${selected(n.panelPhase,'three-400')}>${t('o.three400sp')}</option>
                        <option value="three-690"  ${selected(n.panelPhase,'three-690')}>${t('o.three690')}</option>
                        <option value="dc-48"      ${selected(n.panelPhase,'dc-48')}>DC -48 V (telco)</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.ratedCurrent')}</label>
                        <input type="number" min="6" max="6300" value="${n.panelCurrent||63}" onchange="updateN('panelCurrent',parseInt(this.value)||63)"></div>
                    <div class="prop-group"><label>${t('f.dinModules')}</label>
                        <input type="number" min="2" max="288" value="${n.panelModules||36}" onchange="updateN('panelModules',parseInt(this.value)||36)"></div>
                    <div class="prop-group"><label>${t('f.upstreamOf')}</label><select onchange="updateN('panelUpstream',this.value)">
                        <option value="contatore"   ${selected(n.panelUpstream||'contatore','contatore')}>${t('o.mainMeter')}</option>
                        <option value="qe-generale" ${selected(n.panelUpstream,'qe-generale')}>${t('o.otherPanel')}</option>
                        <option value="ats"         ${selected(n.panelUpstream,'ats')}>ATS / Transfer switch</option>
                        <option value="gruppo"      ${selected(n.panelUpstream,'gruppo')}>${t('o.generator')}</option>
                    </select></div>
                    <label class="prop-check"><input type="checkbox" ${checked(n.panelHasRcd!==false)} onchange="updateN('panelHasRcd',this.checked)" style="width:auto;margin-right:6px">${t('pnl.dev.mainRcd')}</label>
                    <label class="prop-check"><input type="checkbox" ${checked(n.panelHasSpd)}        onchange="updateN('panelHasSpd',this.checked)"  style="width:auto;margin-right:6px">${t('pnl.dev.spdSurge')}</label>
                    <label class="prop-check"><input type="checkbox" ${checked(n.panelFeedsUps)}      onchange="updateN('panelFeedsUps',this.checked)" style="width:auto;margin-right:6px">${t('pnl.dev.feedsUpsRack')}</label>
                    <div class="prop-group"><label>${t('common.notes')}</label>
                        <input value="${escapeHTML(n.panelNotes||'')}" placeholder="${t('pnl.dev.phPanelNotes')}" onchange="updateN('panelNotes',this.value)"></div>
                </div></details>`;
            }
            if(n.type==='tv'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="TV-SALA-A, DISPLAY-01" onchange="updateFloorId(this.value)"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-tv')?'open':''} ontoggle="setPropsSectionState('device-tv',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-tv"></i> ${t('dev.tv')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('f.usage')}</label><select onchange="updateN('tvUsage',this.value)">
                        <option value="meeting"   ${selected(n.tvUsage||'meeting','meeting')}>${t('o.meetingRoom')}</option>
                        <option value="signage"   ${selected(n.tvUsage,'signage')}>Digital signage</option>
                        <option value="reception" ${selected(n.tvUsage,'reception')}>Reception / lobby</option>
                        <option value="workarea"  ${selected(n.tvUsage,'workarea')}>${t('o.workArea')}</option>
                        <option value="monitor"   ${selected(n.tvUsage,'monitor')}>${t('o.netMonitor')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.brand')}</label><select onchange="updateN('brand',this.value)">
                        <option value="Samsung"  ${selected(n.brand||'Samsung','Samsung')}>Samsung</option>
                        <option value="LG"       ${selected(n.brand,'LG')}>LG</option>
                        <option value="Sony"     ${selected(n.brand,'Sony')}>Sony</option>
                        <option value="Philips"  ${selected(n.brand,'Philips')}>Philips</option>
                        <option value="Panasonic"${selected(n.brand,'Panasonic')}>Panasonic</option>
                        <option value="Altro"    ${selected(n.brand,'Altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="QE55Q80C, OLED65C3…" onchange="updateN('model',this.value)"></div>
                    <div class="prop-group"><label>${t('f.diagonal')}</label><input type="number" min="24" max="110" value="${n.screenSize||55}" onchange="updateN('screenSize',parseInt(this.value)||55)"></div>
                    <div class="prop-group"><label>${t('f.resolution')}</label><select onchange="updateN('resolution',this.value)">
                        <option value="4k"    ${selected(n.resolution||'4k','4k')}>4K UHD</option>
                        <option value="1080p" ${selected(n.resolution,'1080p')}>Full HD 1080p</option>
                        <option value="8k"    ${selected(n.resolution,'8k')}>8K</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.os')}</label><select onchange="updateN('tvOs',this.value)">
                        <option value="tizen"      ${selected(n.tvOs||'tizen','tizen')}>Tizen (Samsung)</option>
                        <option value="webos"      ${selected(n.tvOs,'webos')}>webOS (LG)</option>
                        <option value="android-tv" ${selected(n.tvOs,'android-tv')}>Android TV</option>
                        <option value="google-tv"  ${selected(n.tvOs,'google-tv')}>Google TV</option>
                        <option value="altro"      ${selected(n.tvOs,'altro')}>${t('o.otherProprietary')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.connection')}</label><select onchange="updateN('connection',this.value)">
                        <option value="wired"    ${selected(n.connection||'wired','wired')}>${t('o.wiredEth')}</option>
                        <option value="wireless" ${selected(n.connection,'wireless')}>Wireless (Wi-Fi)</option>
                        <option value="both"     ${selected(n.connection,'both')}>${t('o.wiredWifi')}</option>
                    </select></div>                </div></details>`;
            }
            if(n.type==='customfloor'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="Endpoint-01" onchange="updateFloorId(this.value)"></div>
                    <div class="prop-group"><label>${t('f.category')}</label><input value="${escapeHTML(n.customCategory||'')}" placeholder="${t('pnl.dev.phCustomCatFloor')}" onchange="updateN('customCategory',this.value)"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-customfloor')?'open':''} ontoggle="setPropsSectionState('device-customfloor',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-cube"></i> ${t('dev.customfloor')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('field.brand')}</label><input value="${escapeHTML(n.brand||'')}" placeholder="NVIDIA, Google, Sony, custom..." onchange="updateN('brand',this.value)"></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="Shield TV, Chromecast, appliance..." onchange="updateN('model',this.value)"></div>
                    <div class="prop-group"><label>${t('field.connection')}</label><select onchange="updateN('connection',this.value)">
                        <option value="wired"    ${selected(n.connection||'wired','wired')}>${t('o.wiredEth')}</option>
                        <option value="wireless" ${selected(n.connection,'wireless')}>Wireless (Wi-Fi)</option>
                        <option value="both"     ${selected(n.connection,'both')}>${t('o.wiredWifi')}</option>
                    </select></div>                </div></details>`;
            }
            if(n.type==='customrack'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-customrack')?'open':''} ontoggle="setPropsSectionState('device-customrack',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-cube"></i> ${t('dev.customrack')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.category')}</label><input value="${escapeHTML(n.customCategory||'')}" placeholder="${t('pnl.dev.phCustomCatRack')}" onchange="updateN('customCategory',this.value)"></div>
                    <div class="prop-group"><label>${t('field.brand')}</label><input value="${escapeHTML(n.brand||'')}" placeholder="${t('pnl.dev.phVendorMaker')}" onchange="updateN('brand',this.value)"></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="${t('pnl.dev.phModelSku')}" onchange="updateN('model',this.value)"></div>
                </div></details>`;
            }
            if(n.type==='switch'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-switch')?'open':''} ontoggle="setPropsSectionState('device-switch',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-network-wired"></i> Switch</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.mgmtType')}</label><select onchange="updateN('swMgmt',this.value)">
                        <option value="managed"   ${selected(n.swMgmt||'managed','managed')}>Managed</option>
                        <option value="smart"     ${selected(n.swMgmt,'smart')}>Smart-managed (Web UI)</option>
                        <option value="unmanaged" ${selected(n.swMgmt,'unmanaged')}>Unmanaged</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.netLevel')}</label><select onchange="updateN('swLayer',this.value)">
                        <option value="l2"         ${selected(n.swLayer||'l2','l2')}>Layer 2</option>
                        <option value="l3"         ${selected(n.swLayer,'l3')}>Layer 3</option>
                        <option value="multilayer" ${selected(n.swLayer,'multilayer')}>Multilayer</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.topoRole')}</label><select onchange="updateN('swRole',this.value)">
                        <option value="standalone"   ${selected(n.swRole||'standalone','standalone')}>Standalone</option>
                        <option value="core"         ${selected(n.swRole,'core')}>Core</option>
                        <option value="distribution" ${selected(n.swRole,'distribution')}>Distribution</option>
                        <option value="access"       ${selected(n.swRole,'access')}>Access</option>
                        <option value="tor"          ${selected(n.swRole,'tor')}>Top-of-Rack (ToR)</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.poeBudget')}</label>
                        <input type="number" min="0" max="10000" value="${n.swPoeBudgetW||0}" onchange="updateN('swPoeBudgetW',parseInt(this.value)||0)"></div>
                </div></details>`;
            }
            if(n.type==='router'){
                const protos = Array.isArray(n.rtRoutingProtos) ? n.rtRoutingProtos : [];
                const hasBgp = protos.includes('bgp');
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-router')?'open':''} ontoggle="setPropsSectionState('device-router',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-route"></i> Router</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.role')}</label><select onchange="updateN('rtRole',this.value)">
                        <option value="edge"       ${selected(n.rtRole||'edge','edge')}>Edge / WAN</option>
                        <option value="inter-vlan" ${selected(n.rtRole,'inter-vlan')}>Inter-VLAN</option>
                        <option value="branch"     ${selected(n.rtRole,'branch')}>${t('o.branchRemote')}</option>
                        <option value="core"       ${selected(n.rtRole,'core')}>Core</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.wanType')}</label><select onchange="updateN('rtWanType',this.value)">
                        <option value="fiber"     ${selected(n.rtWanType||'fiber','fiber')}>${t('o.fiberFtth')}</option>
                        <option value="dsl"       ${selected(n.rtWanType,'dsl')}>xDSL</option>
                        <option value="coax"      ${selected(n.rtWanType,'coax')}>${t('o.coax')}</option>
                        <option value="cellular"  ${selected(n.rtWanType,'cellular')}>4G / 5G</option>
                        <option value="mpls"      ${selected(n.rtWanType,'mpls')}>MPLS</option>
                        <option value="multi-wan" ${selected(n.rtWanType,'multi-wan')}>Multi-WAN (failover/load-balancing)</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.routingProtocols')}</label>
                        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:2px">
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('static'))} onchange="_toggleArrayField('${n.id}','rtRoutingProtos','static',this.checked)" style="width:auto;margin-right:6px">Static</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('ospf'))}   onchange="_toggleArrayField('${n.id}','rtRoutingProtos','ospf',this.checked)"   style="width:auto;margin-right:6px">OSPF</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(hasBgp)}                   onchange="_toggleArrayField('${n.id}','rtRoutingProtos','bgp',this.checked)"    style="width:auto;margin-right:6px">BGP</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('eigrp'))}  onchange="_toggleArrayField('${n.id}','rtRoutingProtos','eigrp',this.checked)"  style="width:auto;margin-right:6px">EIGRP</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('rip'))}    onchange="_toggleArrayField('${n.id}','rtRoutingProtos','rip',this.checked)"    style="width:auto;margin-right:6px">RIP</label>
                        </div>
                    </div>
                    ${hasBgp ? `<div class="prop-group"><label>ASN (BGP)</label>
                        <input type="number" min="1" max="4294967295" value="${n.rtAsn||''}" placeholder="${t('pnl.dev.phAsn')}" onchange="updateN('rtAsn',parseInt(this.value)||0)"></div>` : ''}
                </div></details>`;
            }
            if(n.type==='firewall'){
                const svcs = Array.isArray(n.fwServices) ? n.fwServices : [];
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-firewall')?'open':''} ontoggle="setPropsSectionState('device-firewall',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-shield-halved"></i> Firewall</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.deployMode')}</label><select onchange="updateN('fwDeployMode',this.value)">
                        <option value="routed"      ${selected(n.fwDeployMode||'routed','routed')}>Routed (L3)</option>
                        <option value="transparent" ${selected(n.fwDeployMode,'transparent')}>Transparent (bridge)</option>
                        <option value="vwire"       ${selected(n.fwDeployMode,'vwire')}>Virtual wire</option>
                    </select></div>
                    <div class="prop-group"><label>High Availability</label><select onchange="updateN('fwHa',this.value)">
                        <option value="standalone"      ${selected(n.fwHa||'standalone','standalone')}>Standalone</option>
                        <option value="active-passive"  ${selected(n.fwHa,'active-passive')}>Active / Passive</option>
                        <option value="active-active"   ${selected(n.fwHa,'active-active')}>Active / Active</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.maxThroughput')}</label>
                        <input type="number" min="10" max="1000000" value="${n.fwThroughputMbps||1000}" onchange="updateN('fwThroughputMbps',parseInt(this.value)||1000)"></div>
                    <div class="prop-group"><label>${t('f.activeServices')}</label>
                        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:2px">
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(svcs.includes('vpn'))}    onchange="_toggleArrayField('${n.id}','fwServices','vpn',this.checked)"    style="width:auto;margin-right:6px">VPN</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(svcs.includes('ips'))}    onchange="_toggleArrayField('${n.id}','fwServices','ips',this.checked)"    style="width:auto;margin-right:6px">IPS</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(svcs.includes('av'))}     onchange="_toggleArrayField('${n.id}','fwServices','av',this.checked)"     style="width:auto;margin-right:6px">Antivirus</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(svcs.includes('web'))}    onchange="_toggleArrayField('${n.id}','fwServices','web',this.checked)"    style="width:auto;margin-right:6px">Web filter</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(svcs.includes('sdwan'))}  onchange="_toggleArrayField('${n.id}','fwServices','sdwan',this.checked)"  style="width:auto;margin-right:6px">SD-WAN</label>
                        </div>
                    </div>
                </div></details>`;
            }
            if(n.type==='server'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-server')?'open':''} ontoggle="setPropsSectionState('device-server',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-server"></i> Server</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.role')}</label><select onchange="updateN('srvRole',this.value)">
                        <option value="hypervisor"  ${selected(n.srvRole||'hypervisor','hypervisor')}>Hypervisor</option>
                        <option value="bare-metal"  ${selected(n.srvRole,'bare-metal')}>Bare-metal</option>
                        <option value="db"          ${selected(n.srvRole,'db')}>Database</option>
                        <option value="web"         ${selected(n.srvRole,'web')}>Web / Application</option>
                        <option value="file"        ${selected(n.srvRole,'file')}>File server</option>
                        <option value="dc"          ${selected(n.srvRole,'dc')}>Domain Controller</option>
                        <option value="backup"      ${selected(n.srvRole,'backup')}>Backup</option>
                        <option value="altro"       ${selected(n.srvRole,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>CPU</label>
                        <input value="${escapeHTML(n.srvCpu||'')}" placeholder="${t('pnl.dev.phSrvCpu')}" onchange="updateN('srvCpu',this.value)"></div>
                    <div class="prop-group"><label>RAM (GB)</label>
                        <input type="number" min="1" max="65536" value="${n.srvRamGb||64}" onchange="updateN('srvRamGb',parseInt(this.value)||64)"></div>
                    <div class="prop-group"><label>${t('f.os')}</label><select onchange="updateN('srvOs',this.value)">
                        <option value="win-srv"  ${selected(n.srvOs||'win-srv','win-srv')}>Windows Server</option>
                        <option value="rhel"     ${selected(n.srvOs,'rhel')}>RHEL / Rocky / Alma</option>
                        <option value="ubuntu"   ${selected(n.srvOs,'ubuntu')}>Ubuntu / Debian</option>
                        <option value="proxmox"  ${selected(n.srvOs,'proxmox')}>Proxmox VE</option>
                        <option value="esxi"     ${selected(n.srvOs,'esxi')}>VMware ESXi</option>
                        <option value="hyperv"   ${selected(n.srvOs,'hyperv')}>Hyper-V</option>
                        <option value="altro"    ${selected(n.srvOs,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.localStorage')}</label>
                        <input type="number" min="0" max="10000" step="0.5" value="${n.srvStorageTb||2}" onchange="updateN('srvStorageTb',parseFloat(this.value)||0)"></div>
                </div></details>`;
            }
            // Hypervisor (rack) + Homelab (floor): motore VM condiviso (src/app-hypervisor.js).
            // Il pannello host (inventario/piattaforma/VM) va nel bucket GIUSTO secondo la
            // collocazione: rack → _devSpecHtml (cucito nel ramo rack del chiamante); floor →
            // flusso inline `h` come gli altri device floor (nome + Rete&Accesso + pannello),
            // altrimenti per il floor il device-spec verrebbe calcolato ma mai concatenato.
            if(n.type==='hypervisor' && typeof _hvPanelHtml === 'function'){
                _devSpecHtml += _hvPanelHtml(n, d);
            }
            if(n.type==='homelab' && typeof _hvPanelHtml === 'function'){
                h += `<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="homelab-01" onchange="updateFloorId(this.value)"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    ${_hvPanelHtml(n, d)}`;
            }
            if(n.type==='nas'){
                const protos = Array.isArray(n.nasProtocols) ? n.nasProtocols : [];
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-nas')?'open':''} ontoggle="setPropsSectionState('device-nas',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-database"></i> ${t('dev.nas')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.typology')}</label><select onchange="updateN('nasType',this.value)">
                        <option value="file"    ${selected(n.nasType||'file','file')}>NAS — file storage</option>
                        <option value="block"   ${selected(n.nasType,'block')}>SAN — block storage</option>
                        <option value="unified" ${selected(n.nasType,'unified')}>Unified (file + block)</option>
                        <option value="object"  ${selected(n.nasType,'object')}>Object storage</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.usableCap')}</label>
                        <input type="number" min="0.1" max="100000" step="0.1" value="${n.nasCapacityTb||10}" onchange="updateN('nasCapacityTb',parseFloat(this.value)||10)"></div>
                    <div class="prop-group"><label>RAID level</label><select onchange="updateN('nasRaid',this.value)">
                        <option value="raid1"   ${selected(n.nasRaid||'raid5','raid1')}>RAID 1 (mirror)</option>
                        <option value="raid5"   ${selected(n.nasRaid,'raid5')}>RAID 5</option>
                        <option value="raid6"   ${selected(n.nasRaid,'raid6')}>RAID 6</option>
                        <option value="raid10"  ${selected(n.nasRaid,'raid10')}>RAID 10</option>
                        <option value="raidz1"  ${selected(n.nasRaid,'raidz1')}>RAIDZ1 (ZFS)</option>
                        <option value="raidz2"  ${selected(n.nasRaid,'raidz2')}>RAIDZ2 (ZFS)</option>
                        <option value="raidz3"  ${selected(n.nasRaid,'raidz3')}>RAIDZ3 (ZFS)</option>
                        <option value="jbod"    ${selected(n.nasRaid,'jbod')}>${t('o.jbod')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.exposedProtocols')}</label>
                        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:2px">
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('smb'))}   onchange="_toggleArrayField('${n.id}','nasProtocols','smb',this.checked)"   style="width:auto;margin-right:6px">SMB</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('nfs'))}   onchange="_toggleArrayField('${n.id}','nasProtocols','nfs',this.checked)"   style="width:auto;margin-right:6px">NFS</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('iscsi'))} onchange="_toggleArrayField('${n.id}','nasProtocols','iscsi',this.checked)" style="width:auto;margin-right:6px">iSCSI</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('fc'))}    onchange="_toggleArrayField('${n.id}','nasProtocols','fc',this.checked)"    style="width:auto;margin-right:6px">FC</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('s3'))}    onchange="_toggleArrayField('${n.id}','nasProtocols','s3',this.checked)"    style="width:auto;margin-right:6px">S3</label>
                        </div>
                    </div>
                    <div class="prop-group"><label>${t('f.swPlatform')}</label><select onchange="updateN('nasPlatform',this.value)">
                        <option value="dsm"      ${selected(n.nasPlatform||'dsm','dsm')}>DSM (Synology)</option>
                        <option value="truenas"  ${selected(n.nasPlatform,'truenas')}>TrueNAS Core/Scale</option>
                        <option value="unraid"   ${selected(n.nasPlatform,'unraid')}>Unraid</option>
                        <option value="qts"      ${selected(n.nasPlatform,'qts')}>QTS (QNAP)</option>
                        <option value="win-stor" ${selected(n.nasPlatform,'win-stor')}>Windows Storage Server</option>
                        <option value="netapp"   ${selected(n.nasPlatform,'netapp')}>NetApp ONTAP</option>
                        <option value="emc"      ${selected(n.nasPlatform,'emc')}>Dell EMC</option>
                        <option value="altro"    ${selected(n.nasPlatform,'altro')}>${t('o.otherProprietary')}</option>
                    </select></div>
                </div></details>`;
            }
            if(n.type==='kvm'){
                const isIp = (n.kvmType||'analog')==='ip';
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-kvm')?'open':''} ontoggle="setPropsSectionState('device-kvm',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-keyboard"></i> ${t('dev.kvm')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.type')}</label><select onchange="updateN('kvmType',this.value)">
                        <option value="analog"   ${selected(n.kvmType||'analog','analog')}>${t('o.analogVga')}</option>
                        <option value="digital"  ${selected(n.kvmType,'digital')}>${t('o.digitalCat')}</option>
                        <option value="ip"       ${selected(n.kvmType,'ip')}>KVM-over-IP</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.maxResolution')}</label><select onchange="updateN('kvmMaxRes',this.value)">
                        <option value="1080p"  ${selected(n.kvmMaxRes||'1080p','1080p')}>Full HD 1080p</option>
                        <option value="1440p"  ${selected(n.kvmMaxRes,'1440p')}>QHD 1440p</option>
                        <option value="4k"     ${selected(n.kvmMaxRes,'4k')}>4K UHD</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.connectedServers')}</label>
                        <input type="number" min="0" max="256" value="${n.kvmConnectedServers||0}" onchange="updateN('kvmConnectedServers',parseInt(this.value)||0)"></div>
                    ${isIp ? `<label class="prop-check"><input type="checkbox" ${checked(n.kvmRemoteAccess!==false)} onchange="updateN('kvmRemoteAccess',this.checked)" style="width:auto;margin-right:6px">${t('pnl.dev.remoteAccessBrowser')}</label>` : ''}
                </div></details>`;
            }
            if(n.type==='ups'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-ups')?'open':''} ontoggle="setPropsSectionState('device-ups',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-car-battery"></i> UPS</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.topology')}</label><select onchange="updateN('upsTopology',this.value)">
                        <option value="standby"  ${selected(n.upsTopology||'line-interactive','standby')}>Standby (offline)</option>
                        <option value="line-interactive" ${selected(n.upsTopology||'line-interactive','line-interactive')}>Line-interactive</option>
                        <option value="online"   ${selected(n.upsTopology,'online')}>${t('o.upsOnline')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.apparentPower')}</label>
                        <input type="number" min="100" max="500000" value="${n.upsVa||1500}" onchange="updateN('upsVa',parseInt(this.value)||1500)"></div>
                    <div class="prop-group"><label>${t('f.activePower')}</label>
                        <input type="number" min="100" max="500000" value="${n.upsW||1000}" onchange="updateN('upsW',parseInt(this.value)||1000)"></div>
                    <div class="prop-group"><label>${t('f.estRuntime')}</label>
                        <input type="number" min="1" max="600" value="${n.upsAutonomyMin||10}" onchange="updateN('upsAutonomyMin',parseInt(this.value)||10)"></div>
                    <label class="prop-check"><input type="checkbox" ${checked(n.upsHotSwap)} onchange="updateN('upsHotSwap',this.checked)" style="width:auto;margin-right:6px">${t('pnl.dev.hotSwapBatteries')}</label>
                    ${typeof _powerLiveHtml==='function' ? _powerLiveHtml(n) : ''}
                </div></details>`;
            }
            if(n.type==='pdu'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-pdu')?'open':''} ontoggle="setPropsSectionState('device-pdu',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-plug"></i> PDU</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.type')}</label><select onchange="updateN('pduType',this.value)">
                        <option value="basic"            ${selected(n.pduType||'basic','basic')}>${t('o.basicDistrib')}</option>
                        <option value="metered"          ${selected(n.pduType,'metered')}>${t('o.pduMetered')}</option>
                        <option value="switched"         ${selected(n.pduType,'switched')}>${t('o.pduSwitched')}</option>
                        <option value="switched-metered" ${selected(n.pduType,'switched-metered')}>Switched + Metered</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.phases')}</label><select onchange="updateN('pduPhase',this.value)">
                        <option value="single" ${selected(n.pduPhase||'single','single')}>${t('o.single230')}</option>
                        <option value="three"  ${selected(n.pduPhase,'three')}>${t('o.three400')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.ratedCurrent')}</label><select onchange="updateN('pduCurrentA',parseInt(this.value)||16)">
                        <option value="16" ${selected(String(n.pduCurrentA||16),'16')}>16 A</option>
                        <option value="32" ${selected(String(n.pduCurrentA||16),'32')}>32 A</option>
                        <option value="63" ${selected(String(n.pduCurrentA||16),'63')}>63 A</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.orientation')}</label><select onchange="updateN('pduOrientation',this.value)">
                        <option value="vertical-0u"   ${selected(n.pduOrientation||'vertical-0u','vertical-0u')}>${t('o.vert0u')}</option>
                        <option value="horizontal-1u" ${selected(n.pduOrientation,'horizontal-1u')}>${t('o.horiz1u')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.totalSockets')}</label>
                        <input type="number" min="1" max="96" value="${n.pduOutletCount||8}" onchange="updateN('pduOutletCount',parseInt(this.value)||8)"></div>
                </div></details>`;
            }
            if(n.type==='ats'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-ats')?'open':''} ontoggle="setPropsSectionState('device-ats',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-shuffle"></i> ATS — Transfer Switch</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.prefSource')}</label><select onchange="updateN('atsSourcePref',this.value)" data-tip="${t('pnl.dev.atsPrefSourceTip')}">
                        <option value="A" ${selected(n.atsSourcePref||'A','A')}>${t('o.sourceAprim')}</option>
                        <option value="B" ${selected(n.atsSourcePref,'B')}>${t('o.sourceBprim')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.ratedVoltage')}</label><select onchange="updateN('atsInputV',this.value)">
                        <option value="230" ${selected(String(n.atsInputV||'230'),'230')}>${t('o.v230eu')}</option>
                        <option value="208" ${selected(String(n.atsInputV||'230'),'208')}>208 V</option>
                        <option value="120" ${selected(String(n.atsInputV||'230'),'120')}>120 V</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.ratedCurrent')}</label><select onchange="updateN('atsCurrentA',parseInt(this.value)||16)">
                        <option value="10" ${selected(String(n.atsCurrentA||16),'10')}>10 A</option>
                        <option value="16" ${selected(String(n.atsCurrentA||16),'16')}>16 A</option>
                        <option value="20" ${selected(String(n.atsCurrentA||16),'20')}>20 A</option>
                        <option value="32" ${selected(String(n.atsCurrentA||16),'32')}>32 A</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.outputSockets')}</label>
                        <input type="number" min="1" max="48" value="${n.atsOutletCount||9}" onchange="updateN('atsOutletCount',parseInt(this.value)||9)"></div>
                    ${typeof _powerLiveHtml==='function' ? _powerLiveHtml(n) : ''}
                </div></details>`;
            }
    return { h: h, devSpec: _devSpecHtml, net: _floorNet };
}

// Chiamati da app-properties-node (classic), app-properties-port (bundle),
// app-vlan-autopoll (classic).
expose({ _nodeDeviceChainHtml, _floorAccessVlanRow, _deviceAccessVlanPid });
