// ============================================================
// HYPERVISOR / HOMELAB — host di virtualizzazione + editor "Macchine virtuali"
// ============================================================
// Due tipi condividono questo motore (flag TYPES.hostsVms): `hypervisor` (rack,
// datacenter) e `homelab` (floor, prosumer). Le VM vivono in `node.vms[]`
// TOP-LEVEL (come node.radios[] degli AP), NON nello spec: ogni VM dichiara la
// VLAN del suo port-group (vNIC). L'unione delle VLAN delle VM alimenta
// carriedVlans() (lib/vlan-trunk.js) → l'uplink dell'host diventa TRUNK derivato
// che porta tutte le VLAN, native = mgmtVlan. Stesso identico meccanismo dei BSS
// di un AP: nessuna logica di trunk nuova, solo una sorgente di VLAN in più.
//
// MODULO ESM: legge i globali legacy (nodeById, updateN, propagateVlans,
// renderAll/renderProps, _ensureVlanColor, parseVlanList) via win.*; `t` dal
// ponte; pubblica con expose(). Gli onclick/onchange dell'HTML girano in scope
// PAGINA → nomi bare; in JS si usa win.*.

import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: selId/selType dopo l'assorbimento
import { escapeHTML, normalizeMacAddress } from './app-util.js';
import { nodeById, markDirty, pushHistory, _invalidateIdx, getNodeDisplayName, _showToast, _removeNodeById } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { propagateVlans, _ensureVlanColor } from './app-vlan-autopoll.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderProps, _buildDeviceBrandModelPreview, _propsSectionIsOpen, _buildInventoryFieldsHtml } from './app-properties.js';   // ritiro ponte fase 2+: funzioni/builder (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES } from './app-types.js';   // catalogo tipi (hostsVms/isPassive/hasIP) per l'assorbimento VM

// Piattaforme datacenter (hypervisor) e homelab: liste diverse, stesso campo
// `hvPlatform`. Tutte on-prem (il cloud pubblico è un modello a sé, fuori scope).
const _HV_PLATFORMS = [
    ['esxi',       'VMware ESXi / vSphere'],
    ['hyperv',     'Microsoft Hyper-V'],
    ['azurelocal', 'Azure Local / Stack HCI'],
    ['proxmox',    'Proxmox VE'],
    ['xcpng',      'XenServer / XCP-ng'],
    ['nutanix',    'Nutanix AHV'],
    ['kvm',        'KVM / oVirt / RHV'],
    ['altro',      '—'],
];
const _LAB_PLATFORMS = [
    ['proxmox', 'Proxmox VE'],
    ['esxi',    'VMware ESXi'],
    ['truenas', 'TrueNAS Scale'],
    ['unraid',  'Unraid'],
    ['docker',  'Docker / Portainer'],
    ['hyperv',  'Hyper-V'],
    ['kvm',     'KVM / libvirt'],
    ['altro',   '—'],
];
const _VM_GUEST_OS = [
    ['win-srv',   'Windows Server'],
    ['win',       'Windows (client)'],
    ['linux',     'Linux'],
    ['bsd',       'BSD / pfSense / OPNsense'],
    ['appliance', 'Appliance (virtual)'],
    ['container', 'Container / Docker'],
    ['altro',     '—'],
];

// ── Modello: helper VM ───────────────────────────────────────────────
function _newVmId(seed){ return 'vm' + Date.now().toString(36) + (seed || 0); }
function _nodeVms(n){ return (n && Array.isArray(n.vms)) ? n.vms : []; }

// Aggiunge una VM vuota (running) all'host e ri-renderizza.
function addVm(nodeId){
    const n = nodeById(nodeId); if(!n) return;
    if(typeof pushHistory === 'function') pushHistory();
    if(!Array.isArray(n.vms)) n.vms = [];
    const id = _newVmId(n.vms.length);
    n.vms.push({ id, state: 'running' });
    markDirty(); renderProps(); if(typeof renderAll === 'function') renderAll();
    return id;
}

// Aggiorna un campo di una VM; se è la VLAN, garantisce i colori e ripropaga
// (l'uplink trunk derivato si aggiorna da solo via carriedVlans).
function updateVm(nodeId, vmId, field, value){
    const n = nodeById(nodeId); if(!n || !Array.isArray(n.vms)) return;
    const vm = n.vms.find(v => v && v.id === vmId); if(!vm) return;
    let v = String(value == null ? '' : value).trim();
    if(field === 'mac' && v) v = normalizeMacAddress(v);   // identità di rete della VM (vNIC)
    if(v) vm[field] = v; else delete vm[field];
    if(field === 'vlan'){
        const list = (typeof win.parseVlanList === 'function') ? win.parseVlanList(vm.vlan) : [];
        if(typeof _ensureVlanColor === 'function') list.forEach(x => { if(x > 1) _ensureVlanColor(x); });
        if(typeof _invalidateIdx === 'function') _invalidateIdx();
        if(typeof propagateVlans === 'function') propagateVlans();
    }
    markDirty(); renderProps(); if(typeof renderAll === 'function') renderAll();
}

// Rimuove una VM dall'host.
function removeVm(nodeId, vmId){
    const n = nodeById(nodeId); if(!n || !Array.isArray(n.vms)) return;
    const i = n.vms.findIndex(v => v && v.id === vmId); if(i < 0) return;
    if(typeof pushHistory === 'function') pushHistory();
    n.vms.splice(i, 1);
    if(typeof _invalidateIdx === 'function') _invalidateIdx();
    if(typeof propagateVlans === 'function') propagateVlans();
    markDirty(); renderProps(); if(typeof renderAll === 'function') renderAll();
}

// ── UI: una riga VM ──────────────────────────────────────────────────
function _vmRowHtml(vm, nodeId){
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const u = `'${nodeId}','${esc(vm.id)}'`;
    const opt = (val, sel, label) => `<option value="${esc(val)}"${String(sel) === String(val) ? ' selected' : ''}>${esc(label)}</option>`;
    const osOpts = ['<option value="">—</option>'].concat(_VM_GUEST_OS.map(o => opt(o[0], vm.guestOs, o[1]))).join('');
    const running = (vm.state || 'running') === 'running';
    const stateBtn = `<button type="button" class="toolbar-btn" onclick="updateVm(${u},'state','${running ? 'stopped' : 'running'}')" `
        + `data-tip="${esc(running ? t('hv.running') : t('hv.stopped'))}" style="color:${running ? 'var(--ok-color)' : 'var(--text-soft)'}">`
        + `<i class="fas ${running ? 'fa-circle-play' : 'fa-circle-stop'}"></i></button>`;
    return `<div class="vm-row" style="border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:8px">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
            <input value="${esc(vm.name || '')}" placeholder="${esc(t('hv.vmNamePh'))}" onchange="updateVm(${u},'name',this.value)" style="flex:1">
            ${stateBtn}
            <button type="button" class="toolbar-btn" onclick="removeVm(${u})" data-tip="${esc(t('common.delete'))}" style="color:var(--fault-color)"><i class="fas fa-trash-alt"></i></button>
        </div>
        <div class="prop-grid2">
            <div class="prop-group"><label>${t('f.os')}</label><select onchange="updateVm(${u},'guestOs',this.value)">${osOpts}</select></div>
            <div class="prop-group"><label>VLAN</label><input value="${esc(vm.vlan || '')}" placeholder="${esc(t('pnl.feat.vlanPh'))}" inputmode="numeric" onchange="updateVm(${u},'vlan',this.value)"></div>
        </div>
        <div class="prop-grid2">
            <div class="prop-group"><label>IP</label><input value="${esc(vm.ip || '')}" placeholder="${esc(t('pnl.feat.optional'))}" onchange="updateVm(${u},'ip',this.value)"></div>
            <div class="prop-group"><label>MAC</label><input value="${esc(vm.mac || '')}" placeholder="${esc(t('pnl.feat.optional'))}" onchange="updateVm(${u},'mac',this.value)"></div>
        </div>
        <div class="prop-group"><label>${t('hv.vmRole')}</label><input value="${esc(vm.role || '')}" placeholder="${esc(t('hv.vmRolePh'))}" onchange="updateVm(${u},'role',this.value)"></div>
    </div>`;
}

// ── UI: pannello completo dell'host (inventario + host fields + lista VM) ──
// Chiamato dallo switch del pannello device per i tipi con TYPES.hostsVms.
function _hvPanelHtml(n, d){
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const isLab = n.type === 'homelab';
    const icon = isLab ? 'fa-cubes' : 'fa-layer-group';
    const secId = 'device-' + n.type;
    const open = (typeof _propsSectionIsOpen === 'function' && _propsSectionIsOpen(secId)) ? 'open' : '';
    const title = esc(isLab ? t('dev.homelab') : t('dev.hypervisor'));
    const plats = isLab ? _LAB_PLATFORMS : _HV_PLATFORMS;
    const platDefault = isLab ? 'proxmox' : 'esxi';
    const platOpts = plats.map(p => `<option value="${esc(p[0])}"${String(n.hvPlatform || platDefault) === p[0] ? ' selected' : ''}>${esc(p[1])}</option>`).join('');
    const vms = _nodeVms(n);
    const running = vms.filter(v => (v.state || 'running') === 'running').length;
    const inv = (typeof _buildInventoryFieldsHtml === 'function') ? _buildInventoryFieldsHtml(n, d) : '';
    const preview = (typeof _buildDeviceBrandModelPreview === 'function') ? _buildDeviceBrandModelPreview(n) : '';
    const vmRows = vms.length
        ? vms.map(vm => _vmRowHtml(vm, n.id)).join('')
        : `<div class="drift-empty" style="padding:8px 4px">${esc(t('hv.noVms'))}</div>`;

    return `<details class="props-collapsible props-primary" ${open} ontoggle="setPropsSectionState('${secId}',this.open)"><summary class="props-collapsible-head"><span><i class="fas ${icon}"></i> ${title}</span>${preview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
        ${inv}
        <div class="prop-group"><label>${t('hv.platform')}</label><select onchange="updateN('hvPlatform',this.value)">${platOpts}</select></div>
        <div class="prop-grid2">
            <div class="prop-group"><label>${t('hv.cluster')}</label><input value="${esc(n.hvCluster || '')}" placeholder="${esc(t('pnl.feat.optional'))}" onchange="updateN('hvCluster',this.value)"></div>
            <div class="prop-group"><label>${t('hv.manager')}</label><input value="${esc(n.hvManager || '')}" placeholder="vCenter / Prism…" onchange="updateN('hvManager',this.value)"></div>
        </div>
        <div class="prop-grid2">
            <div class="prop-group"><label>RAM (GB)</label><input type="number" min="1" max="65536" value="${n.hvRamGb || 64}" onchange="updateN('hvRamGb',parseInt(this.value)||64)"></div>
            <div class="prop-group"><label>Storage (TB)</label><input type="number" min="0" max="10000" step="0.5" value="${n.hvStorageTb || 1}" onchange="updateN('hvStorageTb',parseFloat(this.value)||0)"></div>
        </div>
        <div class="prop-group"><label>${t('hv.mgmtVlan')}</label><input type="number" min="1" max="4094" value="${n.mgmtVlan || 1}" data-tip="${esc(t('hv.mgmtVlanTip'))}" onchange="updateN('mgmtVlan',parseInt(this.value)||1)"></div>
        <details class="props-collapsible props-secondary" ${(typeof _propsSectionIsOpen==='function' && _propsSectionIsOpen('hv-vms')) ? 'open' : ''} ontoggle="setPropsSectionState('hv-vms',this.open)">
            <summary class="props-collapsible-head"><span><i class="fas fa-display"></i> ${t('hv.section')}</span><span class="props-count-badge">${running}/${vms.length}</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
            <div class="props-collapsible-body">
                ${vmRows}
                <button type="button" class="toolbar-btn" style="width:100%;justify-content:center;margin-top:4px" onclick="addVm('${n.id}')"><i class="fas fa-plus"></i> ${t('hv.addVm')}</button>
                <div class="vm-import-dz" data-vm-dropzone data-host-id="${esc(n.id)}"><i class="fas fa-arrow-down-to-bracket"></i> ${esc(t('hv.vmImportHint'))}</div>
            </div>
        </details>
    </div></details>`;
}

// ── Assorbi un tile (device scoperto) come VM dell'host ──────────────
// Gesto: drag&drop di un tile NON-host (con MAC) sopra un host nel floor (vedi
// app-pointer). Il tile È quella VM — tipicamente bridged, quindi vista in rete
// come device a sé: la fondiamo in host.vms[] ereditandone l'identità
// (nome/IP/MAC) e rimuovendo il tile sciolto (col suo cavo di discovery). Il MAC
// rende la VM "documentata" nel Drift → non riappare come non-documentata.
// Manual-first: parte SOLO da un gesto dell'utente; undo via pushHistory.
export function absorbNodeAsVm(srcId, hostId){
    const host = nodeById(hostId), src = nodeById(srcId);
    if(!host || !src || host.id === src.id) return false;
    const hostDef = TYPES[host.type], srcDef = TYPES[src.type];
    if(!hostDef || !hostDef.hostsVms) return false;                                      // il bersaglio deve ospitare VM
    if(srcDef && (srcDef.hostsVms || (srcDef.isPassive && !srcDef.hasIP))) return false; // no host-in-host / passivi senza IP
    pushHistory();
    if(!Array.isArray(host.vms)) host.vms = [];
    const name = getNodeDisplayName(src) || src.name || '';
    const ip = ((src.integration && src.integration.host) || src.ip || '').trim();
    const mac = normalizeMacAddress(String(src.mac || ''));
    const vm = { id: _newVmId(host.vms.length), state: 'running' };
    if(name) vm.name = name;
    if(ip) vm.ip = ip;
    if(mac) vm.mac = mac;                         // identità → chiude il cerchio col Drift
    host.vms.push(vm);
    _removeNodeById(src.id);                      // via il tile sciolto + il suo cavo di discovery
    propagateVlans();                            // l'uplink trunk dell'host assorbe la VLAN della VM
    _invalidateIdx();
    store.selId = host.id; store.selType = 'node';   // mostra l'host: la VM appena aggiunta è lì
    win._propsExplicit = true;                        // intent esplicito → il pannello host si ri-renderizza (guardia uniforme floor/rack)
    markDirty();
    renderAll();
    renderProps();
    _showToast(t('hv.vmAbsorbed', { name: name || mac || 'VM', host: getNodeDisplayName(host) || host.name || host.id }), 'ok');
    return true;
}

// ── Pubblicazione sul ponte ──────────────────────────────────────────
expose({ addVm, updateVm, removeVm, _hvPanelHtml, _vmRowHtml, _nodeVms, absorbNodeAsVm });
