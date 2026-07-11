// ============================================================
// CATALOGO TIPI DISPOSITIVI + NODE SPEC + FRONT-PANEL WRAPPERS
//                                          [modulo ESM, ex lib/app-types.js]
// FOUNDATION: TYPES è una COSTANTE esportata (import { TYPES }). I moduli ESM la
// importano; resta anche su window.TYPES via expose() per i classic ancora-script
// (export.js, lib pure a runtime). Importato per PRIMO in main.js.
// NODE_ID_PREFIX esposto (lo legge _nextNodeId in app.js); il resto è module-local.
// ============================================================
import { win, expose, t } from './_bridge.js';

// Catalogo immutabile dei tipi di dispositivo. Costante: definita una volta,
// mai riassegnata → esportata come `const` (RITIRO PONTE fase 1, 2026-06-21).
// Resta pubblicata su window.TYPES (expose, in fondo) per i classic script.
export const TYPES = {
    // ── Floor passivi (senza IP) ──────────────────────────────────────────────
    wallport:    { isFloor:true, isPassive:true,  passThrough:'port', name:'Presa a muro',       icon:'fa-ethernet',    ports:1 },
    // ── Floor con interfaccia IP (hasIP:true → appaiono nella discovery) ─────
    printer:     { isFloor:true, isPassive:false, hasIP:true, name:'Stampante di rete',  icon:'fa-print',      ports:1 },
    ap:          { isFloor:true, isPassive:false, hasIP:true, wifiServe:true, name:'Access Point',        icon:'fa-wifi',       ports:1 },
    webcam:      { isFloor:true, isPassive:false, hasIP:true, name:'Webcam/CCTV',         icon:'fa-video',      ports:1 },
    voip:        { isFloor:true, isPassive:false, hasIP:true, passThrough:'port', name:'Telefono VoIP',       icon:'fa-phone',      ports:1 },
    pc:          { isFloor:true, isPassive:false, hasIP:true, name:'PC / Workstation',    icon:'fa-desktop',    ports:1 },
    mobile:      { isFloor:true, isPassive:false, hasIP:true, name:'Smartphone / Tablet', icon:'fa-mobile-screen-button', ports:1, brand:'Apple' },
    iot:         { isFloor:true, isPassive:false, hasIP:true, name:'Dispositivo IoT',     icon:'fa-microchip',  ports:1 },
    tv:          { isFloor:true, isPassive:false, hasIP:true, name:'Smart TV / Media Player', icon:'fa-tv',     ports:1 },
    customfloor: { isFloor:true, isPassive:false, hasIP:true, name:'Endpoint personalizzato', icon:'fa-cube',   ports:1 },
    homelab:     { isFloor:true, isPassive:false, hasIP:true, hostsVms:true, name:'Homelab', icon:'fa-cubes', ports:1 },
    nasdesktop:  { isFloor:true, isPassive:false, hasIP:true, name:'NAS (desktop)', icon:'fa-hard-drive', ports:1, brand:'Synology' },
    projector:   { isFloor:true, isPassive:false, hasIP:true, name:'Proiettore',          icon:'fa-chalkboard', ports:1 },
    badgereader: { isFloor:true, isPassive:false, hasIP:true, name:'Lettore badge',       icon:'fa-id-card',    ports:1 },
    doorctrl:    { isFloor:true, isPassive:false, hasIP:true, name:'Door Controller',     icon:'fa-door-open',  ports:1 },
    // ── Floor passivi strutturali (catena elettrica) ─────────────────────────
    panelboard:  { isFloor:true, isPassive:true,  name:'Quadro elettrico',    icon:'fa-bolt',       ports:0 },
    // ── Rack passivi senza IP ─────────────────────────────────────────────────
    patchpanel:  { isRack:true,  isPassive:true,  passThrough:'port', name:'Patch Panel',        icon:'fa-grip',          sizeU:2, ports:24, brand:'CommScope' },
    blankpanel:  { isRack:true,  isPassive:true,  name:'Pannello vuoto',     icon:'fa-minus',         sizeU:1, ports:0,  brand:''          },
    cablemanager:{ isRack:true,  isPassive:true,  name:'Passacavo',          icon:'fa-grip-lines',    sizeU:1, ports:0,  brand:''          },
    // ── Rack attivi (sempre hasIP) ────────────────────────────────────────────
    switch:      { isRack:true,  isActive:true,   mgmtEligible:true, stackEligible:true, name:'Switch',             icon:'fa-network-wired',   sizeU:1, ports:24, brand:'Cisco'     },
    router:      { isRack:true,  isActive:true,   mgmtEligible:true, haEligible:true, wifiServe:true, name:'Router',             icon:'fa-route',           sizeU:1, ports:8,  brand:'Juniper'   },
    firewall:    { isRack:true,  isActive:true,   mgmtEligible:true, haEligible:true, wifiServe:true, name:'Firewall',           icon:'fa-shield-halved',   sizeU:1, ports:4,  brand:'Fortinet'  },
    server:      { isRack:true,  isActive:true,   mgmtEligible:true, haEligible:true, name:'Server',             icon:'fa-server',          sizeU:2, ports:4,  brand:'Dell EMC'  },
    hypervisor:  { isRack:true,  isActive:true,   mgmtEligible:true, haEligible:true, hostsVms:true, name:'Hypervisor', icon:'fa-layer-group', sizeU:2, ports:4, brand:'VMware' },
    nas:         { isRack:true,  isActive:true,   mgmtEligible:true, haEligible:true, name:'Storage (SAN / RAID)', icon:'fa-database',       sizeU:2, ports:4,  brand:'Synology'  },
    kvm:         { isRack:true,  isActive:true,   mgmtEligible:true, name:'KVM Switch',         icon:'fa-keyboard',        sizeU:1, ports:8,  brand:'ATEN'      },
    pbx:         { isRack:true,  isActive:true,   mgmtEligible:true, name:'Centralino VoIP',    icon:'fa-phone-volume',    sizeU:1, ports:4,  brand:'Sangoma'   },
    consolesvr:  { isRack:true,  isActive:true,   mgmtEligible:true, haEligible:true, name:'Console Server',     icon:'fa-terminal',        sizeU:1, ports:8,  brand:'Opengear'  },
    wlanctrl:    { isRack:true,  isActive:true,   mgmtEligible:true, haEligible:true,                 name:'WLAN Controller',    icon:'fa-tower-broadcast', sizeU:1, ports:4,  brand:'Cisco'     },
    nvr:         { isRack:true,  isActive:true,   mgmtEligible:true, name:'NVR / Videosorveglianza', icon:'fa-record-vinyl', sizeU:2, ports:16, brand:'Hikvision' },
    sdwan:       { isRack:true,  isActive:true,   mgmtEligible:true, haEligible:true, wifiServe:true, name:'SD-WAN Edge',        icon:'fa-cloud-bolt',      sizeU:1, ports:8,  brand:'Meraki'    },
    vpncon:      { isRack:true,  isActive:true,   mgmtEligible:true, haEligible:true, name:'VPN Concentrator',   icon:'fa-user-shield',     sizeU:1, ports:4,  brand:'Cisco'     },
    customrack:  { isRack:true,  isActive:true,   mgmtEligible:true, name:'Dispositivo rack generico', icon:'fa-cube',     sizeU:1, ports:1, brand:''     },
    // ── Rack passivi MA con possibile interfaccia IP ──────────────────────────
    ups:         { isRack:true,  isPassive:true,  hasIP:true, name:'UPS',            icon:'fa-car-battery', sizeU:2, ports:1, brand:'APC'  },
    pdu:         { isRack:true,  isPassive:true,  hasIP:true, name:'PDU',            icon:'fa-plug',        sizeU:1, ports:1, brand:'APC'  },
    ats:         { isRack:true,  isPassive:true,  hasIP:true, name:'ATS — Transfer Switch', icon:'fa-shuffle', sizeU:1, ports:1, brand:'APC' },
    mediaconv:   { isRack:true,  isPassive:true,  hasIP:true, passThrough:'device', name:'Media Converter', icon:'fa-right-left', sizeU:1, ports:2, brand:'Moxa' },
    // ── Strutturale ───────────────────────────────────────────────────────────
    room:        { isFloor:true, isPassive:false, name:'Stanza', icon:'fa-vector-square', isStructural:true, defaultColor:'#16212b' }
};

const NODE_ID_PREFIX = {
    room: 'r',
    wallport: 'wp',
    ap: 'ap',
    webcam: 'cam',
    printer: 'prn',
    voip: 'tel',
    badgereader: 'br',
    doorctrl: 'door',
    panelboard: 'qel',
    pc: 'pc',
    mobile: 'mob',
    iot: 'iot',
    projector: 'prj',
    tv: 'tv',
    customfloor: 'ep',
    homelab: 'lab',
    nasdesktop: 'nasd',
    patchpanel: 'pp',
    blankpanel: 'bp',
    cablemanager: 'cm',
    switch: 'sw',
    router: 'rt',
    firewall: 'fw',
    server: 'srv',
    hypervisor: 'hv',
    nas: 'nas',
    kvm: 'kvm',
    ups: 'ups',
    pdu: 'pdu',
    ats: 'ats',
    pbx: 'pbx',
    consolesvr: 'con',
    wlanctrl: 'wlc',
    nvr: 'nvr',
    sdwan: 'sdw',
    vpncon: 'vpn',
    customrack: 'dev',
    mediaconv: 'mc',
};

const FIXED_RACK_LABELS = {
    blankpanel: 'Pannello vuoto',
    cablemanager: 'Passacavo',
};

function _fixedRackLabel(type){
    return FIXED_RACK_LABELS[type] || '';
}

const FRONT_PANEL_LAYOUTS = {
    auto:         { label:'Automatico' },
    linear:       { label:'Lineare' },
    sequential:   { label:'2 righe sequenziale' },
    alternating:  { label:'2 righe alternata' },
};

const NODE_SPEC_FIELDS = new Set([
    'ppMedia','ppCopperCat','ppCopperShield','ppFiberConnector','ppFiberMode',
    'ssid','band','wifiStd','channel24','channel5','apController','powerType','mgmtVlan','mountType','installHeight','coverageRadius',
    'lens','coverageZone','recorder','installStatus','irEnabled','audioEnabled',
    'printProto','vlanPrint','colorPrint','duplexPrint',
    'extension','voipProto','pbxHost','audioCodec','voiceVlan',
    'zone','readerType','readerProto','accessController','vlanAccess',
    'assignedUser','osType','vlanPc',
    'iotType','iotProto','iotBroker','vlanIot',
    'lumens','projCtrl','vlanProj',
    'pbxTrunk','pstnGateway','pbxExtensions','pbxTrunkLines','pbxSoftware',
    'oobIp','serialPorts','serialBaud','accessSsh','accessHttps','accessTelnet',
    'apManaged','apCapacity','wlcLicenses','wlcPlatform',
    'fiberType','fiberConnector','linkSpeed','wavelength','fiberMaxKm',
    'nvrPlatform','nvrChannels','nvrChannelsUsed','nvrStorageTb','nvrRetentionDays','nvrCodec','vlanCctv',
    'sdwanPlatform','sdwanUplinks','sdwanThroughputMbps','sdwanMode','sdwanController',
    'vpnPlatform','vpnMode','vpnProtoIpsec','vpnProtoSsl','vpnProtoWg','vpnProtoL2tp','vpnMaxSessions','vpnLicenses',
    'doorPlatform','doorCount','doorReader','poe','vlanAcl',
    'panelPhase','panelCurrent','panelModules','panelUpstream','panelHasRcd','panelHasSpd','panelFeedsUps','panelNotes',
    'tvUsage','screenSize','tvOs','vlanTv',
    'customCategory','vlanCustom',
    'swMgmt','swLayer','swRole','swPoeBudgetW',
    'rtRole','rtWanType','rtRoutingProtos','rtAsn',
    'fwDeployMode','fwHa','fwThroughputMbps','fwServices',
    'srvRole','srvCpu','srvRamGb','srvOs','srvStorageTb',
    'hvPlatform','hvCluster','hvManager','hvCpuSockets','hvCores','hvRamGb','hvStorageTb',
    'nasType','nasCapacityTb','nasRaid','nasProtocols','nasPlatform',
    'kvmType','kvmMaxRes','kvmConnectedServers','kvmRemoteAccess',
    'upsTopology','upsVa','upsW','upsAutonomyMin','upsHotSwap',
    'pduType','pduPhase','pduCurrentA','pduOrientation','pduOutletCount',
    'atsSourcePref','atsInputV','atsCurrentA','atsOutletCount',
    'stackId','stackMemberId','stackRole',
    'haPeer','haGroupId','haRole','haMode','haSync',
]);

function _isNodeSpecField(key){
    return NODE_SPEC_FIELDS.has(String(key || ''));
}

export function _ensureNodeSpec(node){
    if(!node || typeof node !== 'object') return {};
    if(!node.spec || typeof node.spec !== 'object' || Array.isArray(node.spec)) node.spec = {};
    return node.spec;
}

function _compactNodeSpec(node){
    if(!node || typeof node !== 'object') return;
    const spec = _ensureNodeSpec(node);
    for(const key of NODE_SPEC_FIELDS){
        if(node[key] === undefined) continue;
        if(spec[key] === undefined) spec[key] = node[key];
        delete node[key];
    }
    if(!Object.keys(spec).length) delete node.spec;
}

function _nodeSpecView(node){
    if(!node || typeof node !== 'object') return node;
    return new Proxy(node, {
        get(target, prop, receiver){
            if(prop === '__raw') return target;
            if(typeof prop === 'string' && prop !== 'spec' && target.spec && Object.prototype.hasOwnProperty.call(target.spec, prop)){
                return target.spec[prop];
            }
            return Reflect.get(target, prop, receiver);
        },
        has(target, prop){
            if(typeof prop === 'string' && prop !== 'spec' && target.spec && Object.prototype.hasOwnProperty.call(target.spec, prop)) return true;
            return Reflect.has(target, prop);
        }
    });
}

// Wrapper underscore-prefixed: la logica vive in lib/frontpanel.js
// (caricato come UMD-lite, espone `win.frontPanelState` e `win.frontPanelLegacyState`
// come globali su window). Qui aggiungiamo solo il lookup TYPES-specifico per
// `mgmtEligible` perche' la lib resta pura e non conosce il catalogo TYPES.
function _frontPanelLegacyState(fp = {}, portCount = 0){
    return win.frontPanelLegacyState(fp, portCount);
}

function _frontPanelState(node, portCount){
    const mgmtEligible = !!(node && TYPES[node.type] && TYPES[node.type].mgmtEligible);
    return win.frontPanelState(node, portCount, mgmtEligible);
}

function _frontPanelSfpPorts(node, portCount){
    // Include porte di ENTRAMBI i blocchi SFP (sfp1 + sfp2) come array piatto.
    // Usato dal data-port row filter per escluderle dal grid principale.
    const mgmtEligible = !!(node && TYPES[node.type] && TYPES[node.type].mgmtEligible);
    const groups = win.frontPanelSfpGroups(node, portCount, mgmtEligible);
    const out = [];
    for(const g of groups) out.push(...g.ports);
    return out;
}
function _frontPanelSfpGroups(node, portCount){
    const mgmtEligible = !!(node && TYPES[node.type] && TYPES[node.type].mgmtEligible);
    return win.frontPanelSfpGroups(node, portCount, mgmtEligible);
}

function _frontPanelRows(node, portCount){
    const fp = _frontPanelState(node, portCount);
    const pc = fp.portCount;
    if(pc <= 0) return [];
    const sfpPorts = new Set(_frontPanelSfpPorts(node, portCount));
    const list = Array.from({ length:pc }, (_, idx) => idx + 1).filter(i => !sfpPorts.has(i));
    if(fp.baseLayout === 'linear') return [list];
    if(fp.baseLayout === 'sequential'){
        const split = Math.ceil(list.length / 2);
        const top = list.slice(0, split);
        const bottom = list.slice(split);
        return fp.numberTop ? [top, bottom] : [bottom, top];
    }
    if(fp.baseLayout === 'alternating'){
        const odd = list.filter(i => i % 2 === 1);
        const even = list.filter(i => i % 2 === 0);
        return fp.oddTop ? [odd, even] : [even, odd];
    }
    // auto: switch con >8 porte usano 2 righe alternate dispari-sopra
    // (comportamento storico standard pannello switch). <=8 porte: 1 riga.
    if(list.length > 8){
        return [
            list.filter(i => i % 2 === 1),
            list.filter(i => i % 2 === 0),
        ];
    }
    return [list];
}

function _frontPanelIsUplink(node, portNum, portCount){
    return _frontPanelSfpPorts(node, portCount).includes(portNum);
}

function _frontPanelShortIfName(v){
    const raw = String(v || '').trim();
    if(!raw) return '';
    const compact = raw.replace(/\s+/g, '');
    let m = compact.match(/^GigabitEthernet(.+)$/i);
    if(m) return `Gi${m[1]}`;
    m = compact.match(/^FastEthernet(.+)$/i);
    if(m) return `Fa${m[1]}`;
    m = compact.match(/^TenGigabitEthernet(.+)$/i);
    if(m) return `Te${m[1]}`;
    m = compact.match(/^TwentyFiveGigE(.+)$/i);
    if(m) return `Twe${m[1]}`;
    m = compact.match(/^FortyGigabitEthernet(.+)$/i);
    if(m) return `Fo${m[1]}`;
    m = compact.match(/^HundredGigE(.+)$/i);
    if(m) return `Hu${m[1]}`;
    m = compact.match(/^Ethernet(.+)$/i);
    if(m) return `Eth${m[1]}`;
    m = compact.match(/^Port-?channel(.+)$/i);
    if(m) return `Po${m[1]}`;
    m = compact.match(/^Eth-?Trunk(.+)$/i);
    if(m) return `Trk${m[1]}`;
    m = compact.match(/^lag(.+)$/i);
    if(m) return `LAG${m[1]}`;
    return compact;
}

function _frontPanelPortLabel(node, portNum, portCount){
    // Delega a win.frontPanelPortLabel (lib/frontpanel.js) che gestisce la
    // numerazione SFP custom (sfpStartNum + sfpPrefix). Aggiungiamo il
    // lookup mgmtEligible da TYPES come per _frontPanelState.
    const mgmtEligible = !!(node && TYPES[node.type] && TYPES[node.type].mgmtEligible);
    // Patch panel: applica l'offset di numerazione progressiva (catena
    // ppContinueFrom / startNum manuale). win._patchPanelOffset vive in app.js e
    // conosce lo state globale; la logica di calcolo e' pura (panelNumberOffset).
    if(node && node.type==='patchpanel' && typeof win._patchPanelOffset==='function'){
        const off = win._patchPanelOffset(node);
        const num = parseInt(portNum, 10);
        if(off && Number.isFinite(num) && String(num)===String(portNum)) return String(num + off);
    }
    return win.frontPanelPortLabel(node, portNum, portCount, mgmtEligible);
}

// Nome localizzato di un tipo device. Chiave i18n `type.<k>`; se manca (o senza
// bridge in Node) ripiega sul nome del catalogo (TYPES[k].name, italiano).
// Usa `t` dal bridge (NON win.t) → non fa crescere il ratchet del ponte.
// Punto unico: ogni resa UI del nome-tipo deve passare di qui (no TYPES[x].name nudo).
export function typeName(k){
    const key = 'type.' + k;
    const s = t(key);
    return (s === key) ? ((TYPES[k] && TYPES[k].name) || k) : s;
}

expose({
    TYPES, typeName,
    NODE_ID_PREFIX,
    _fixedRackLabel, _isNodeSpecField, _ensureNodeSpec, _compactNodeSpec, _nodeSpecView,
    _frontPanelLegacyState, _frontPanelState, _frontPanelSfpPorts, _frontPanelSfpGroups,
    _frontPanelRows, _frontPanelIsUplink, _frontPanelShortIfName, _frontPanelPortLabel,
});
