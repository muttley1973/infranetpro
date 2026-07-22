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
import { registerClickActions, registerChangeActions } from './app-delegation.js';   // ASSE B: lista VM + scheda VM senza handler inline
import { _openMgmt } from './app-management.js';   // apertura console di management (stessa strategia dei device)

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
// (I sistemi guest vivono ora in app-properties-vm.js, dove si editano: la lista
// compatta dell'host non mostra piu' la select del sistema operativo.)

// Risorse allocate alla VM: campi NUMERICI dichiarati a mano (manual-first).
// Stessa triade dei modelli di riferimento del settore (NetBox: vcpus/memory/disk):
// servono al capitolo «Macchine virtuali» del dossier di consegna, dove il cliente
// vuole sapere quanto pesa ogni VM sull'host. ② no-invenzioni: nessun default —
// campo vuoto o non positivo = risorsa NON dichiarata, quindi cancellata dal record
// (il report stampa «—», non uno zero che sembrerebbe una misura).
const _VM_NUM_FIELDS = { vcpu: 'int', ramGb: 'float', diskGb: 'float' };

// ── Modello: helper VM ───────────────────────────────────────────────
function _newVmId(seed){ return 'vm' + Date.now().toString(36) + (seed || 0); }
export function _nodeVms(n){ return (n && Array.isArray(n.vms)) ? n.vms : []; }

// I bottoni/campi della sezione VM vivono NEL pannello dell'host: un click lì È
// intent esplicito su quell'host. Senza questo allineamento, dopo un single-click
// sul floor (che mette _propsExplicit=false) la guardia di _renderNodeProps
// bloccava il re-render → la VM eliminata restava a schermo fino al refresh.
// Stesso pattern di absorbNodeAsVm (guardia uniforme floor/rack).
function _propsIntentOnHost(nodeId){
    store.selId = nodeId; store.selType = 'node'; store._propsExplicit = true;
}

// Aggiunge una VM vuota (running) all'host e ri-renderizza.
function addVm(nodeId){
    const n = nodeById(nodeId); if(!n) return;
    if(typeof pushHistory === 'function') pushHistory();
    if(!Array.isArray(n.vms)) n.vms = [];
    const id = _newVmId(n.vms.length);
    n.vms.push({ id, state: 'running' });
    markDirty(); if(typeof renderAll === 'function') renderAll();
    // Una VM appena creata e' vuota: si apre subito la sua scheda, dove c'e' il
    // nome (nella lista comparirebbe come "(senza nome)"). openVmProps allinea
    // gia' selezione+intent e ri-renderizza il pannello.
    openVmProps(nodeId, id);
    return id;
}

// Aggiorna un campo di una VM; se è la VLAN, garantisce i colori e ripropaga
// (l'uplink trunk derivato si aggiorna da solo via carriedVlans).
function updateVm(nodeId, vmId, field, value){
    const n = nodeById(nodeId); if(!n || !Array.isArray(n.vms)) return;
    const vm = n.vms.find(v => v && v.id === vmId); if(!vm) return;
    let v = String(value == null ? '' : value).trim();
    if(field === 'mac' && v) v = normalizeMacAddress(v);   // identità di rete della VM (vNIC)
    if(_VM_NUM_FIELDS[field]){
        const num = _VM_NUM_FIELDS[field] === 'int' ? parseInt(v, 10) : parseFloat(v);
        if(Number.isFinite(num) && num > 0) vm[field] = num; else delete vm[field];
    }
    else if(v) vm[field] = v; else delete vm[field];
    if(field === 'vlan'){
        const list = (typeof win.parseVlanList === 'function') ? win.parseVlanList(vm.vlan) : [];
        if(typeof _ensureVlanColor === 'function') list.forEach(x => { if(x > 1) _ensureVlanColor(x); });
        if(typeof _invalidateIdx === 'function') _invalidateIdx();
        if(typeof propagateVlans === 'function') propagateVlans();
    }
    // Da DOVE stai editando cambia dove deve restare il pannello:
    //  · dalla SCHEDA della VM → si resta sulla scheda (realinearla all'host la
    //    chiuderebbe a ogni campo committato: si compilava un campo e si veniva
    //    sbattuti fuori);
    //  · dalla LISTA dell'host (bottone stato della riga) → vale l'intento
    //    sull'host, come per add/remove (guardia _propsExplicit, vedi 76ª).
    if(store.selType === 'vm' && store.selVmId === vmId && store.selId === nodeId) store._propsExplicit = true;
    else _propsIntentOnHost(nodeId);
    markDirty(); renderProps(); if(typeof renderAll === 'function') renderAll();
}

// Integrazione della VM: STESSO contenitore e STESSI nomi campo dei device
// (`node.integration` → `vm.integration`: driver/host/port/timeout/community e
// l'intero blocco v3 user/authProto/authPass/privProto/privPass/secLevel/context).
// Una forma sola per lo stesso concetto: il payload di poll si costruisce allo
// stesso modo, le etichette sono le stesse dell'accordion «Integrazione» del
// device, e chiunque consumi il progetto (API, contesto AI, export) trova un
// campo che conosce gia' invece di un secondo vocabolario.
// `host` VUOTO = usa l'IP della VM, come "(usa IP nodo)" sui device.
const _VM_INTG_NUM = { port: 161, timeout: 3 };
export function updateVmIntegration(nodeId, vmId, field, value){
    const n = nodeById(nodeId); if(!n) return;
    const vm = _nodeVms(n).find(v => v && v.id === vmId); if(!vm) return;
    const v = String(value == null ? '' : value).trim();
    if(!vm.integration) vm.integration = {};
    if(_VM_INTG_NUM[field] !== undefined){
        const num = parseInt(v, 10);
        if(Number.isFinite(num) && num > 0) vm.integration[field] = num; else delete vm.integration[field];
    }
    else if(v) vm.integration[field] = v;
    else delete vm.integration[field];
    if(!Object.keys(vm.integration).length) delete vm.integration;
    if(store.selType === 'vm' && store.selVmId === vmId && store.selId === nodeId) store._propsExplicit = true;
    markDirty(); renderProps();
}

// Config effettiva della VM. Il ripiego su `vm.snmp` copre i progetti toccati
// mentre la sezione portava ancora quel nome: una community gia' digitata non si
// perde. Nuove scritture vanno solo su `integration`.
export function _vmIntg(vm){ return (vm && (vm.integration || vm.snmp)) || {}; }

// Rimuove una VM dall'host.
function removeVm(nodeId, vmId){
    const n = nodeById(nodeId); if(!n || !Array.isArray(n.vms)) return;
    const i = n.vms.findIndex(v => v && v.id === vmId); if(i < 0) return;
    if(typeof pushHistory === 'function') pushHistory();
    n.vms.splice(i, 1);
    if(typeof _invalidateIdx === 'function') _invalidateIdx();
    if(typeof propagateVlans === 'function') propagateVlans();
    // Se era aperta la scheda della VM eliminata, si torna all'host: lasciare lo
    // scope 'vm' su un id inesistente mostrerebbe un pannello vuoto.
    if(store.selType === 'vm' && store.selVmId === vmId){ store.selVmId = null; store.selType = 'node'; }
    _propsIntentOnHost(nodeId);
    markDirty(); renderProps(); if(typeof renderAll === 'function') renderAll();
}

// Riepilogo di UNA riga (HTML gia' scappato): riempie lo spazio accanto al nome
// coi fatti che distinguono una VM dall'altra — ruolo, RISORSE, indirizzo.
//
// Le risorse preferiscono il valore MISURATO via SNMP a quello dichiarato, e in
// quel caso la riga porta l'icona della parabola: chi legge deve sapere se sta
// guardando una misura o una dichiarazione (② no-invenzioni). Nessun placeholder:
// cio' che non c'e' non occupa spazio.
//
// L'IP compare solo se DIVERSO dal nome mostrato: una VM assorbita da un tile
// scoperto si chiama spesso come il suo indirizzo, e ripeterlo sprecava tutta la
// larghezza utile della riga.
function _vmSummaryHtml(vm, displayName){
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const seen = vm.snmpSeen || {};
    const pick = (measured, declared) => (measured != null ? { v: measured, m: true }
                                        : (declared != null ? { v: declared, m: false } : null));
    const cpu  = pick(seen.cpuCores, vm.vcpu);
    const ram  = pick(seen.ramGb,   vm.ramGb);
    const disk = pick(seen.diskGb,  vm.diskGb);
    const res  = [cpu && `${cpu.v} vCPU`, ram && `${ram.v} GB`, disk && `${disk.v} GB`]
        .filter(Boolean).join(' / ');
    const fromSnmp = [cpu, ram, disk].some(x => x && x.m);

    const bits = [];
    if(vm.role) bits.push(esc(vm.role));
    if(res) bits.push((fromSnmp
        ? `<i class="fas fa-satellite-dish vm-row-measured" title="${esc(t('hv.vmSnmpMeasured'))}"></i> `
        : '') + esc(res));
    const ip = String(vm.ip || '').trim();
    if(ip && ip !== String(displayName || '').trim()) bits.push(esc(ip));
    return bits.join(' · ');
}

// ── UI: una riga VM (COMPATTA) ───────────────────────────────────────
// La riga elenca, non edita: pallino stato + nome + riepilogo + modifica/elimina
// (stessa grammatica delle righe VLAN). L'editing completo vive nella scheda
// dedicata (scope 'vm' del pannello Proprieta', app-properties-vm.js): una riga
// per VM resta leggibile anche con 20 VM su un host, dove il vecchio blocco
// espanso rendeva la lista impraticabile.
function _vmRowHtml(vm, nodeId){
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const running = (vm.state || 'running') === 'running';
    // Verde = accesa · rosso = spenta (decisione utente 76ª). NB: niente --ok-color,
    // il token non esiste (il fallback ereditato rendeva il bottone bianco):
    // si usano i token semantici definiti in ENTRAMBI i temi.
    const dotColor = running ? 'var(--active-color)' : 'var(--fault-color)';
    const ref = `data-vm-host="${esc(nodeId)}" data-vm-id="${esc(vm.id)}"`;
    const displayName = vm.name || t('hv.vmUnnamed');
    return `<div class="vm-row" ${ref} data-act="vm-open" role="button" tabindex="0" data-tip="${esc(t('hv.vmEdit'))}">
        <i class="fas fa-circle vm-row-dot" style="color:${dotColor}" title="${esc(running ? t('hv.running') : t('hv.stopped'))}"></i>
        <span class="vm-row-name">${esc(displayName)}</span>
        <span class="vm-row-sum">${_vmSummaryHtml(vm, displayName)}</span>
        <button type="button" class="toolbar-btn vm-row-btn" ${ref} data-act="vm-open" data-tip="${esc(t('hv.vmEdit'))}" aria-label="${esc(t('hv.vmEdit'))}"><i class="fas fa-pen"></i></button>
        <button type="button" class="toolbar-btn vm-row-btn" ${ref} data-act="vm-remove" data-tip="${esc(t('common.delete'))}" aria-label="${esc(t('common.delete'))}" style="color:var(--fault-color)"><i class="fas fa-trash-alt"></i></button>
    </div>`;
}

// ── Selezione: apri/chiudi la scheda completa di una VM ───────────────
// selId resta l'HOST (evidenziazione a schermo + nodeById invariati), la VM e' il
// 2o livello in selVmId. _propsExplicit: la scheda e' un intent esplicito, come
// il doppio click su un device floor (guardia uniforme di _renderNodeProps).
export function openVmProps(hostId, vmId){
    const n = nodeById(hostId); if(!n) return;
    if(!_nodeVms(n).some(v => v && v.id === vmId)) return;
    store.selId = hostId; store.selType = 'vm'; store.selVmId = vmId; store._propsExplicit = true;
    renderProps();
}
// Torna all'host che ospita la VM (breadcrumb della scheda).
export function closeVmProps(){
    const hostId = store.selId;
    store.selType = 'node'; store.selVmId = null; store._propsExplicit = true;
    if(hostId) store.selId = hostId;
    renderProps();
}

// ── UI: pannello completo dell'host (inventario + host fields + lista VM) ──
// Chiamato dallo switch del pannello device per i tipi con TYPES.hostsVms.
export function _hvPanelHtml(n, d){
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
        ${''/* Drop-zone VM: il bersaglio (data-vm-dropzone) è TUTTA la sezione — con
             tante VM la vecchia zona in fondo alla lista usciva dallo scrollport del
             pannello dopo ogni re-render (scroll azzerato) e i drop morivano. La zona
             tratteggiata resta come invito visivo ma SOPRA la lista: posizione stabile
             (non scende di una riga a ogni import), visibile a pannello appena aperto. */}
        <details class="props-collapsible props-secondary" data-vm-dropzone data-host-id="${esc(n.id)}" ${(typeof _propsSectionIsOpen==='function' && _propsSectionIsOpen('hv-vms')) ? 'open' : ''} ontoggle="setPropsSectionState('hv-vms',this.open)">
            <summary class="props-collapsible-head"><span><i class="fas fa-display"></i> ${t('hv.section')}</span><span class="props-count-badge">${running}/${vms.length}</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
            <div class="props-collapsible-body">
                <div class="vm-import-dz"><i class="fas fa-arrow-down-to-bracket"></i> ${esc(t('hv.vmImportHint'))}</div>
                ${vmRows}
                <button type="button" class="toolbar-btn" style="width:100%;justify-content:center;margin-top:4px" onclick="addVm('${n.id}')"><i class="fas fa-plus"></i> ${t('hv.addVm')}</button>
            </div>
        </details>
    </div></details>`;
}

// ── Gestione SNMP della VM: dati MISURATI, distinti dal dichiarato ────
// Molte VM (Windows Server, Linux, appliance) espongono un agente SNMP sul
// PROPRIO indirizzo: si interrogano come qualsiasi altro host, riusando la rotta
// /api/poll dei device (nessuna API nuova). Cio' che torna e' una MISURA e resta
// separato da cio' che hai dichiarato: non sovrascrive mai i tuoi campi: il
// travaso e' un gesto esplicito (bottone «Usa questi valori»).
//
// ⚠️ Onestà del segnale (stessa regola dei colori di presenza): una risposta SNMP
// DIMOSTRA che la VM è accesa in quel momento → lo stato diventa 'running'.
// Il silenzio NON dimostra il contrario (agente non installato, community
// sbagliata, UDP filtrato): non si scrive mai 'stopped' da un timeout.
function _bytesToGb(b){ return (Number.isFinite(b) && b > 0) ? Math.round(b / 1073741824 * 10) / 10 : null; }

export async function pollVmSnmp(hostId, vmId){
    const n = nodeById(hostId); if(!n) return false;
    const vm = _nodeVms(n).find(v => v && v.id === vmId); if(!vm) return false;
    const cfg = _vmIntg(vm);
    // Stessa regola dei device: l'host override vince, altrimenti si usa l'IP.
    const host = String(cfg.host || vm.ip || '').trim();
    if(!host){ _showToast(t('hv.vmSnmpNoIp'), 'warn', 5000); return false; }
    const body = JSON.stringify({
        driver: cfg.driver || 'snmp-v2c',
        host, port: cfg.port || 161, timeout: cfg.timeout || 3,
        community: cfg.community || 'public',
        v3user: cfg.v3user || '', v3authProto: cfg.v3authProto || 'SHA', v3authPass: cfg.v3authPass || '',
        v3privProto: cfg.v3privProto || 'AES', v3privPass: cfg.v3privPass || '', v3secLevel: cfg.v3secLevel || 'authPriv',
        v3context: cfg.v3context || '',
        hostResources: true,          // CPU/RAM/dischi: e' il senso di interrogare una VM
    });
    let data;
    try {
        const r = await fetch('/api/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        data = await r.json();
    } catch(e){ data = { ok: false, error: String(e && e.message || e) }; }
    if(!data || !data.ok){
        // Niente conclusioni sullo stato: si annota solo il tentativo fallito.
        vm.snmpError = String((data && data.error) || 'timeout');
        markDirty(); renderProps();
        _showToast(t('hv.vmSnmpFail', { err: vm.snmpError }), 'warn', 7000);
        return false;
    }
    const sys = data.system || {};
    const hr  = data.hostResources || {};
    const seen = { at: new Date().toISOString() };
    if(data.hostname)        seen.sysName   = String(data.hostname);
    if(sys.sysDescr)         seen.sysDescr  = String(sys.sysDescr);
    if(sys.sysUpTimeText)    seen.uptime    = String(sys.sysUpTimeText);
    if(Number.isFinite(hr.cpuCores)) seen.cpuCores = hr.cpuCores;
    if(hr.ram && Number.isFinite(hr.ram.totalBytes)) seen.ramGb = _bytesToGb(hr.ram.totalBytes);
    if(Array.isArray(hr.volumes) && hr.volumes.length){
        const tot = hr.volumes.reduce((a, v) => a + (Number.isFinite(v.totalBytes) ? v.totalBytes : 0), 0);
        const gb = _bytesToGb(tot); if(gb) seen.diskGb = gb;
    }
    // MAC della vNIC (ifPhysAddress). E' il dato che CHIUDE IL CERCHIO col Drift:
    // il MAC di una VM entra in deviceSigs, quindi la macchina non riappare come
    // "non documentata" nella Verifica. Conta soprattutto per le VM assorbite
    // CROSS-SUBNET, che un MAC non ce l'hanno mai (l'ARP si ferma al router).
    // ⚠️ Le interfacce del poll NON trasportano gli indirizzi IP, quindi non si
    // puo' appaiare la scheda all'host interrogato: si accetta il MAC solo se e'
    // UNIVOCO (una sola vNIC con MAC reale — il caso normale). Con piu' schede si
    // annota quante sono e si lascia vuoto, invece di indovinare quale sia quella
    // "giusta" (② no-invenzioni).
    const _macs = [...new Set((data.interfaces || [])
        .map(i => String((i && i.mac) || '').trim().toUpperCase())
        .filter(m => m && !/^(?:00[:-]){5}00$/.test(m)))];
    if(_macs.length === 1) seen.mac = _macs[0];
    else if(_macs.length > 1) seen.macCount = _macs.length;
    vm.snmpSeen = seen;
    delete vm.snmpError;
    vm.state = 'running';             // ha risposto: prova che e' accesa (misurata)
    markDirty(); renderProps(); if(typeof renderAll === 'function') renderAll();
    _showToast(t('hv.vmSnmpOk', { name: seen.sysName || vm.name || 'VM' }), 'ok', 5000);
    return true;
}

// Travaso MISURATO → DICHIARATO, solo su gesto esplicito: e' l'utente a decidere
// che la misura diventa documentazione (manual-first). Undo con Ctrl+Z.
export function applyVmSnmpValues(hostId, vmId){
    const n = nodeById(hostId); if(!n) return;
    const vm = _nodeVms(n).find(v => v && v.id === vmId); if(!vm || !vm.snmpSeen) return;
    const s = vm.snmpSeen;
    if(typeof pushHistory === 'function') pushHistory();
    if(s.sysName && !vm.hostname) vm.hostname = s.sysName;
    // Il MAC entra SOLO se il campo e' vuoto: un MAC gia' documentato e' una
    // scelta tua (o l'eredita' dell'assorbimento) e non si sovrascrive.
    if(s.mac && !vm.mac) vm.mac = normalizeMacAddress(s.mac);
    if(Number.isFinite(s.cpuCores)) vm.vcpu   = s.cpuCores;
    if(Number.isFinite(s.ramGb))    vm.ramGb  = s.ramGb;
    if(Number.isFinite(s.diskGb))   vm.diskGb = s.diskGb;
    markDirty(); renderProps();
    _showToast(t('hv.vmSnmpApplied'), 'ok', 4000);
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
    store._propsExplicit = true;                        // intent esplicito → il pannello host si ri-renderizza (guardia uniforme floor/rack)
    markDirty();
    renderAll();
    renderProps();
    _showToast(t('hv.vmAbsorbed', { name: name || mac || 'VM', host: getNodeDisplayName(host) || host.name || host.id }), 'ok');
    return true;
}

// ── ASSE B: superficie della lista VM + scheda VM via event delegation ──
// Nata SENZA onclick inline (la riga compatta e la scheda sostituiscono il
// vecchio blocco espanso, che ne aveva 8): i riferimenti host/VM viaggiano nei
// data-* dell'elemento, non concatenati in una stringa di handler.
registerClickActions({
    'vm-open':   (el) => openVmProps(el.dataset.vmHost, el.dataset.vmId),
    'vm-remove': (el) => removeVm(el.dataset.vmHost, el.dataset.vmId),
    'vm-back':   () => closeVmProps(),
    'vm-state':  (el) => updateVm(el.dataset.vmHost, el.dataset.vmId, 'state', el.dataset.vmNext),
    'vm-snmp-read':  (el) => pollVmSnmp(el.dataset.vmHost, el.dataset.vmId),
    'vm-snmp-apply': (el) => applyVmSnmpValues(el.dataset.vmHost, el.dataset.vmId),
    // Apertura console di management: stessa strategia per-protocollo dei device
    // (http/https in tab, ssh/rdp/vnc all'handler del sistema operativo).
    'vm-mgmt-open':  (el, ev) => { if(ev) ev.preventDefault(); _openMgmt(el.getAttribute('href')); },
});
// Sentinella dell'harness «Personalizzato…» (app.js `_enableManualValueInProps`):
// NON e' un valore, e' la voce che apre il prompt. Va ignorata su DUE fronti:
// scriverla nel modello salverebbe la stringa-token, e — peggio — il re-render
// che ne segue distruggerebbe la select MENTRE il prompt e' ancora aperto, cosi'
// alla conferma l'harness scriverebbe su un elemento ormai staccato dal DOM e il
// valore digitato andrebbe perso in silenzio.
// Il pannello device non ha il problema perche' `updateN` chiama renderAll() ma
// NON renderProps(): li' la select sopravvive al prompt.
const _CUSTOM_TOKEN = '__custom_manual__';

registerChangeActions({
    // Un solo punto di scrittura per OGNI campo della scheda: il nome del campo
    // sta in data-vm-field, il valore lo si legge dall'elemento.
    'vm-field': (el) => { if(el.value === _CUSTOM_TOKEN) return;
        updateVm(el.dataset.vmHost, el.dataset.vmId, el.dataset.vmField, el.value); },
    // Integrazione della VM: vive in vm.integration{}, non fra i campi piatti.
    'vm-intg': (el) => { if(el.value === _CUSTOM_TOKEN) return;
        updateVmIntegration(el.dataset.vmHost, el.dataset.vmId, el.dataset.vmField, el.value); },
});

// ── Pubblicazione sul ponte ──────────────────────────────────────────
expose({ addVm, updateVm, removeVm, _hvPanelHtml, _vmRowHtml, _nodeVms, absorbNodeAsVm,
         openVmProps, closeVmProps, updateVmIntegration, pollVmSnmp, applyVmSnmpValues });
