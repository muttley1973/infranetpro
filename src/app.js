import { win, projectFormat, expose, t, mergeLeaseSources } from './_bridge.js';
// lib PURA e STATELESS: import ESM diretto (meta ASSE A) invece di win.* (il ponte
// è al floor 268). Non è registrata come <script>, quindi la regola "non importare
// un lib-<script>" (motivata dallo STATO, es. i18n) non si applica: qui è tutto
// funzioni pure → nessuno snapshot congelato possibile. Il bundle la pubblica
// comunque su window (UMD) per eventuali consumatori classic.
import { canonicalizeIpv6 } from '../lib/ipv6.js';
import { nodeIdOfPort } from '../lib/port-id.js';
import { migrateIpam } from '../lib/ipam-model.js';   // la subnet esce dalla VLAN e diventa un prefisso: migrazione idempotente al load
import { migrateVmNics, VM_FLAT_NET_FIELDS, vmIps } from '../lib/vm-nics.js';   // migrazione vm.ip/mac/vlan → vm.nics[]; vmIps = IPv4 di tutte le vNIC
import { normalizePduOutletCount, normalizePduManagementMode, normalizePduPortCount, pduManagementPortCount } from '../lib/pdu-layout.js';
import { store, resetProjectRuntime } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, uid, normalizeNumber, normalizeStatus, normalizeMacAddress, _shadeHex, PORT_ANCHOR_SEL } from './app-util.js';   // helper puri estratti dal god-file + ancora visuale delle porte
import { TYPES, typeName, typeShort } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (prima letto dal global implicito) + nome localizzato
import { nodeLabelParts } from '../lib/node-label.js';   // lib pura importata ESM: come si LEGGE il nome di un device
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: chiamate prima bare-global
import { renderProps } from './app-properties.js';   // idem
import { showAlert, saveProject } from './app-core.js';   // saveProject: ASSE B, scorciatoia Ctrl+S (ex win.saveProject)
import { createSnapshot } from './app-snapshots.js';   // snapshot pre-import (ciclo benigno: solo a runtime)
import { registerClickActions, registerChangeActions, initDelegation } from './app-delegation.js';   // ASSE B: event delegation (ritiro onclick/onchange inline)
import { clearSearch } from './app-search-zoom-rack.js';   // ramo Escape: era una chiamata bare a una fn module-local → ReferenceError
import { closeTopToolModal, initModalA11y } from './app-modal-a11y.js';   // M9: a11y dei tool-modal (Esc chiude, focus-trap)
// ============================================================
// InfraNet Pro — app.js (core bootstrap + stato + eventi)
// Catalogo TYPES e node-spec: src/app-types.js (R1)
// ============================================================

// ============================================================
// STATO APPLICAZIONE
// ============================================================
const PROJECT_STATE_SCHEMA_VERSION = Number(projectFormat.PROJECT_STATE_SCHEMA_VERSION) || 1;
// `var` (non `let`) di proposito: così `state` vive su window.state ed è
// leggibile/riassegnabile dai moduli ESM convertiti (bundle esbuild) tramite il
// ponte di migrazione (src/_bridge.js → store.state). I classic script legacy lo
// vedono comunque come globale. Vedi build.js / src/main.js.
store.state = {
    schemaVersion: PROJECT_STATE_SCHEMA_VERSION,
    vlanColors:{}, vlanNames:{}, racks:[], currentRack:null,
    ipam:{ vlans:{} },
    floorView:{x:0,y:0,zoom:1}, rackView:{zoom:1},
    uiColors:{floorBg:'#0d1117',rackBg:'#ffffff'},
    bgImage:null, bgImageScale:1, bgImageLocked:false,
    autoPoll:{ enabled:false, interval:5 },
    discoveryHistory:{ observations:[] },
    guestVlans:[],          // VLAN "ospiti": i loro device escono dai "non documentati" (drift)
    mgmtVlans:[],           // VLAN di management: i non-documentati lì sono infra (mai BYOD) + segnale sicurezza
    lastSnmpSyncAt:0,       // timestamp ultimo Sync SNMP riuscito (chip freschezza toolbar)
    lastSnmpSyncResult:null, // esito ultimo TENTATIVO di Sync {ok,err,total,at} (chip + regola snmpDown)
    lastAutoLinkResult:null, // esito ultimo auto-link {created,updated,pruned,protocols,reasons,at} (riga subbar)
    nodes:[], links:[], ports:{},
    dhcpSources:[]   // lease DHCP persistiti per-fonte (multi-server) → set unito in store._dhcpLeases
};

store.currentProjectId = null;   // var: letto/scritto dal bundle app-core (projects) via win.*
store._isDirty = false;   // var: idem (switchProject guard)

// ============================================================
// STATE LOOKUP INDEXES — O(1) per node e link lookup
//
// Tenuti FUORI da `state` per non inquinare JSON.stringify/parse
// (undo/redo, salvataggio progetto).
//
// Invalidati da:
//   • markDirty()     → dopo ogni mutazione dati
//   • undo() / redo() → dopo il replace di state
//   • loadProject()   → dopo il caricamento da server
//
// Ricostruiti lazy al primo accesso successivo all'invalidazione.
// ============================================================

// STATE LOOKUP INDEXES + getter porta/nodo estratti in ./app-index.js (split app.js #4).
// Import+re-export: import per i call-site interni (es. _getUiModeMeta) e re-export per
// i molti consumatori ESM (nodeById 25, getNodeByPortId 16, getPortNodeId 13, ...).
import { _invalidateIdx, nodeById, _linksForPort, getPortNodeId, isPortOnNode, getNodeByPortId } from "./app-index.js";
export { _invalidateIdx, nodeById, _linksForPort, getPortNodeId, isPortOnNode, getNodeByPortId };

// selId/selType: var (non let) così sono proprietà di window e i moduli migrati
// del bundle (es. src/app-stack-ha.js) li leggono via store.selId/store.selType
// (REGOLA CRITICA: i globali letti dal ponte stanno su window).
store.selId=null; store.selType=null; store.highPath=new Set();
// var (non let): linkStart è letto dal bundle (src/app-ports.js) via store.linkStart
// → deve stare su window (REGOLA CRITICA). dragNode/resizeNode/
// _linkJustStarted seguono per coerenza (bare-read dai classic, invariato).
store.dragNode=null; store.resizeNode=null; store.linkStart=null; store._linkJustStarted=false;
// Rilevamento manuale doppio click su porte device floor: { pid, t (timestamp), timer (handle setTimeout) }
store._floorPortClick = null;   // var: stato input scritto dal bundle (app-pointer) via win.*
// Rilevamento manuale doppio click su porte device RACK in tab Rack
// (preventDefault del pointerdown blocca il dblclick nativo del browser).
store._rackPortDblPid = null; store._rackPortDblTime = 0;
// Rilevamento doppio click sull'ICONA rack in topologia: single press = drag
// (sposta il rack), doppio click = apri la rack window.
store._rackFloorDblId = null; store._rackFloorDblTime = 0;
store.dragRack=null;   // rack ID quando si trascina un'icona rack sulla planimetria (var: letto da app.js _renderModeIndicator + scritto dal bundle)
// var (non let): lagSelMode/lagSelPorts sono scritti dal bundle (src/app-ports.js)
// via win.* e bare-letti dai classic (app-pointer, app-render-core) → su window.
store.lagSelMode=false; store.lagSelPorts=new Set();   // modalità selezione multipla LAG
// INT-5: intent semantico "voglio vedere/editare le props" vs "ho solo
// selezionato/draggato". Sostituisce _rackPropsExplicitId (flag per-id).
// - false (default): le props dei device rack restano chiuse al click
//   singolo (UX scelta: troppo rumoroso aprirle ad ogni click).
// - true: alzato quando l'utente fa un'azione intenzionale "voglio vedere"
//   (doppio click, switchRightTab('props'), shortcut P, ecc.).
store._propsExplicit=false;
// ^ var (non let): il modulo bundle app-properties-node.js lo legge via
//   store._propsExplicit (guard render rack). I writer classic (app.js/app-pointer)
//   fanno bare-assign → cadono sulla stessa var di window.
store._rackDblTime=0; store._rackDblId=null;   // rilevazione manuale doppio click (dblclick non arriva con preventDefault)
store._prefixOpen=new Set();     // reti col dettaglio aperto in «Reti» (chiave = CIDR normalizzato)
store._netsBad='';               // testo scritto in «Reti» che non e' una rete: resta a schermo, in rosso
// ^ var (non let): il modulo bundle app-properties-floor.js lo legge via
//   store._prefixOpen (.has). Un let vivrebbe nel global lexical, invisibile al
//   bundle → .has di undefined. I writer classic (.add/.delete/.clear) mutano
//   la stessa unica Set su window.
store._snmpSyncing=false;   // true durante la sincronizzazione SNMP collettiva  (var: letto dal bundle src/app-topology-discover.js via store._snmpSyncing)
// _autoPollTimer/_autoPollTickTimer/_autoPollNextAt spostati come module-local in src/app-vlan-autopoll.js
store._discResults=[];   // risultati ultima discovery   (var: letto/scritto dal bundle src/app-discovery.js via win.*)
store._discRunning=false;   // true mentre discovery/crawl è in corso   (var: idem)
store._discImporting=false;   // true mentre importa i risultati selezionati   (var: idem)
store._discSelMap={};   // chiave device -> checkbox selezionata   (var: idem)
store._discTypeMap={};   // chiave device -> tipo scelto dall'utente   (var: idem)
store._paletteDragType='';   // tipo trascinato dalla libreria elementi (var: letto da app.js _renderModeIndicator)
store.dragOffset={x:0,y:0};
store.isPanningFloor=false; store.panStart={x:0,y:0};
// Pan del rack con Space+trascinamento (come il floor): il rack però usa lo
// SCROLL nativo del #rack-viewport, quindi qui memorizziamo scroll iniziale.
store.isPanningRack=false; store.rackPanStart={x:0,y:0,sl:0,st:0};
// Threshold drag/click: { x, y } posizione del pointerdown; _dragArmed=true
// solo dopo che il puntatore si e' spostato > 5px (evita micro-drag
// involontari su click brevi su rack/floor device).
store._dragDownPt=null; store._dragArmed=false;
// _DRAG_THRESHOLD_PX spostato come module-local in src/app-pointer.js (unico lettore)
store._spaceDown=false;   // Space tenuto → pan ovunque sulla mappa
let eventsBound=false;
// searchResults/activeSearchIndex spostati come module-local in src/app-search-zoom-rack.js

function _paletteTypeLabel(type){
    return typeName(type) || type || 'elemento';
}
function _getUiModeMeta(){
    if(_discRunning) return { icon:'fa-satellite-dish', tone:'warn', label:t('mode.discovery'), hint:t('mode.discoveryHint') };
    if(_paletteDragType) return { icon:'fa-hand', tone:'accent', label:t('mode.adding',{type:_paletteTypeLabel(_paletteDragType)}), hint:t('mode.addingHint') };
    if(isPanningFloor || _spaceDown) return { icon:'fa-hand-paper', tone:'accent', label:t('mode.pan'), hint:t('mode.panHint') };
    if(lagSelMode) return { icon:'fa-link', tone:'warn', label:t('mode.lag'), hint:t('mode.lagHint') };
    if(linkStart){
        const srcNode=getNodeByPortId(linkStart);
        const srcName=getNodeDisplayName(srcNode)||t('mode.fbPort');
        const srcPort=String(linkStart).split('-').slice(1).join('-');
        return { icon:'fa-ethernet', tone:'accent', label:t('mode.cabling'), hint:t('mode.cablingHint',{src:srcName,port:srcPort}) };
    }
    if(dragNode || dragRack) return { icon:'fa-arrows-up-down-left-right', tone:'accent', label:t('mode.positioning'), hint:t('mode.positioningHint') };
    if(resizeNode) return { icon:'fa-up-right-and-down-left-from-center', tone:'accent', label:t('mode.resize'), hint:t('mode.resizeHint') };
    if(_viewMode==='topology'){
        if(_physicalTraceActive && (highPath.size || selType==='link' || selType==='port')){
            return { icon:'fa-route', tone:'warn', label:t('mode.cablePath'), hint:t('mode.cablePathHint') };
        }
        return { icon:'fa-project-diagram', tone:'accent', label:t('mode.topology'), hint:t('mode.topologyHint') };
    }
    if(selType==='port'){
        const portNode=getNodeByPortId(selId);
        const portNum=String(selId||'').split('-').slice(1).join('-');
        if(_rightTab==='props' && selId && !isRackPort(selId)){
            return {
                icon:'fa-ethernet',
                tone:'accent',
                label:t('mode.portSel'),
                hint:t('mode.portSelHint',{name:getNodeDisplayName(portNode)||t('mode.fbDevice'),port:portNum})
            };
        }
        return { icon:'fa-ethernet', tone:'accent', label:t('mode.portSel'), hint:t('mode.portSelGenericHint') };
    }
    if(selType==='link') return { icon:'fa-link', tone:'accent', label:t('mode.linkSel'), hint:t('mode.linkSelHint') };
    if(selType==='node'){
        const node=nodeById(selId);
        return { icon:'fa-microchip', tone:'accent', label:t('mode.nodeSel'), hint:t('mode.nodeSelHint',{name:getNodeDisplayName(node)||t('mode.fbElement')}) };
    }
    return { icon:'fa-arrow-pointer', tone:'', label:t('mode.selection'), hint:t('mode.selectionHint') };
}
export function _renderModeIndicator(){
    const wrap=document.getElementById('ui-mode-indicator');
    const labelEl=document.getElementById('ui-mode-label');
    const hintEl=document.getElementById('ui-mode-hint');
    if(!wrap || !labelEl || !hintEl) return;
    const pill=wrap.querySelector('.ui-mode-pill');
    const iconEl=wrap.querySelector('.ui-mode-icon i');
    const mode=_getUiModeMeta();
    labelEl.textContent=mode.label;
    hintEl.textContent=mode.hint;
    if(iconEl) iconEl.className=`fas ${mode.icon||'fa-arrow-pointer'}`;
    if(pill){
        pill.classList.toggle('is-accent', mode.tone==='accent');
        pill.classList.toggle('is-warn', mode.tone==='warn');
    }
}

// ============================================================
// UNDO / REDO
// ============================================================
store._history=[]; store._histIdx=-1;   // var: reset dal bundle app-core (loadProject) via win.*

// STORICO/DIRTY/AUDIT estratti in ./app-history.js (split app.js #3). Import+re-export:
// import per i molti call-site interni (markDirty/pushHistory/logAudit/undo/redo) e
// re-export per i consumatori ESM che importano queste fn da ./app.js.
import { pushHistory, undo, redo, _updateHistoryBtns, _resetSelection, markDirty, _clearDirty, logAudit } from "./app-history.js";
export { pushHistory, undo, redo, _updateHistoryBtns, _resetSelection, markDirty, _clearDirty, logAudit };

// ============================================================
// API CLIENT
// ============================================================
// API client estratto in lib/app-core.js



export function _loadDefaultLocal() {
    state = _migrateState(_buildDefaultState());
    resetProjectRuntime();
    _restoreTopoSession();
    _prefixOpen.clear();
    document.getElementById('project-select').innerHTML =
        '<option value="0">— offline —</option>';
}

export function _buildDefaultState() {
    return {
        schemaVersion: PROJECT_STATE_SCHEMA_VERSION,
        vlanColors:{10:'#00d4ff',20:'#ff00d4',30:'#39d353',40:'#f1e05a',99:'#f85149'},
        ipam:{ vlans:{} },
        racks:[{id:'rack_1',name:'Main Rack',sizeU:42}],
        currentRack:'rack_1',
        floorView:{x:0,y:0,zoom:1}, rackView:{zoom:1},
        uiColors:{floorBg:'#0d1117',rackBg:'#ffffff'},
        bgImage:null,
        discoveryHistory:{ observations:[] },
        nodes:[
            {id:'r1', type:'room',       x:40,  y:40,  w:360,h:440, name:'Server Room',  color:'#16212b'},
            {id:'wp1',type:'wallport',   x:260, y:160, name:'WA-01', ports:1},
            {id:'wp2',type:'wallport',   x:260, y:260, name:'WA-02', ports:1},
            {id:'pp1',type:'patchpanel', rackU:41,sizeU:2,ports:24, name:'PP-A',    brand:'CommScope',rackId:'rack_1'},
            {id:'sw1',type:'switch',     rackU:39,sizeU:1,ports:24, name:'SW-Core', brand:'Cisco',    rackId:'rack_1'}
        ],
        links:[
            {id:'l1',src:'wp1-1',dst:'pp1-1'},
            {id:'l2',src:'wp2-1',dst:'pp1-2'},
            {id:'l4',src:'pp1-1',dst:'sw1-1'}
        ],
        ports:{
            'wp1-1':{status:'active',speed:'1G',vlan:10},
            'wp2-1':{status:'active',speed:'1G',vlan:20},
            'pp1-1':{status:'active',vlan:10},
            'pp1-2':{status:'active',vlan:20},
            'sw1-1':{status:'active',vlan:10}
        }
    };
}

// ── Modello link/segmenti (PURO) → ESTRATTO in lib/link-model.js ──────────────
// _normalizeLinkMetadata · _normalizeLinkSegment · _normalizeLinkSegments ·
// _createLinkSegmentRecord · _getLinkSegmentPairs · _getLinkPortIds ·
// _linkTouchesPort · _linkAdjacentPorts · _linkOtherPort · _linkHasPair ·
// _getLinkDrawEndpoints. Sono funzioni PURE (solo l'oggetto link, niente state/DOM):
// vivono in lib/link-model.js, caricato come <script> (window-assign) PRIMA del
// bundle. app.js e il glue le usano come global bare / via il ponte (win.*),
// esattamente come prima. Vedi test/link-model.test.js.

// Wireless verso un device IN RACK: la radio vive nel pannello rack. Quando quel
// pannello è nascosto (tab Proprietà aperta), l'elemento radio non ha coordinate
// valide e l'onda "scappa" a sinistra. In quel caso soltanto, ancoriamo il lato
// rack all'ICONA del rack sulla planimetria (punto valido sul floor). In tab Rack
// l'onda resta puntata sul device specifico, com'era prima.
function _wlRackIconAnchor(pid){
    const n = getNodeByPortId(pid);
    if(n && TYPES[n.type]?.isRack && n.rackId)
        return document.querySelector(`.floor-rack[data-rackid="${n.rackId}"]`);
    return null;
}

export function _getPassThroughMode(pid){
    const t = getNodeByPortId(pid)?.type;
    return TYPES[t]?.passThrough || '';
}

export function _isLinearPassThroughPort(pid){
    return !!_getPassThroughMode(pid);
}

export function _getLinkPhysicalView(linkOrId){
    const selected = typeof linkOrId === 'string'
        ? state.links.find(l=>l.id===linkOrId)
        : linkOrId;
    if(!selected) return null;

    const explicitSegments = Array.isArray(selected.segments)
        ? selected.segments.filter(s=>s && s.from && s.to)
        : [];
    if(explicitSegments.length){
        return {
            mode: 'explicit',
            selectedLinkId: selected.id,
            selectedSegmentIndex: null,
            ambiguous: false,
            pathPids: [explicitSegments[0].from, ...explicitSegments.map(s=>s.to)].filter(Boolean),
            segments: explicitSegments.map((segment, idx)=>({
                ...segment,
                linkId: selected.id,
                isSelected: idx === 0 && explicitSegments.length === 1,
            }))
        };
    }

    const visited = new Set([selected.id]);
    const walk = (seedPort) => {
        const links = [];
        const path = [seedPort];
        let currentPort = seedPort;
        let currentLink = selected;
        let ambiguous = false;

        while(_isLinearPassThroughPort(currentPort)){
            const attached = _linksForPort(currentPort).filter(l=>l.id !== currentLink.id);
            if(attached.length > 1){
                ambiguous = true;
                break;
            }
            if(attached.length !== 1) break;
            const nextLink = attached[0];
            if(visited.has(nextLink.id)){
                ambiguous = true;
                break;
            }
            const nextPort = _linkOtherPort(nextLink, currentPort);
            if(!nextPort || nextPort === currentPort){
                ambiguous = true;
                break;
            }
            visited.add(nextLink.id);
            links.push(nextLink);
            path.push(nextPort);
            currentLink = nextLink;
            currentPort = nextPort;
        }
        return { links, path, ambiguous };
    };

    const left = walk(selected.src);
    const right = walk(selected.dst);
    const orderedLinks = [...left.links.slice().reverse(), selected, ...right.links];
    const pathPids = [...left.path.slice().reverse(), ...right.path];
    const segments = [];
    let cursor = pathPids[0] || selected.src;
    let invalid = false;

    for(const link of orderedLinks){
        if(!_linkTouchesPort(link, cursor)){
            invalid = true;
            break;
        }
        const nextPort = _linkOtherPort(link, cursor);
        if(!nextPort){
            invalid = true;
            break;
        }
        segments.push({
            linkId: link.id,
            from: cursor,
            to: nextPort,
            length: link.length,
            lengthM: link.lengthM,
            cableType: link.cableType,
            type: link.type,
            isPermanent: link.isPermanent,
            permanent: link.isPermanent,
            notes: link.notes,
            isSelected: link.id === selected.id,
        });
        cursor = nextPort;
    }

    if(invalid || !segments.length){
        return {
            mode: 'direct',
            selectedLinkId: selected.id,
            selectedSegmentIndex: 1,
            ambiguous: true,
            pathPids: [selected.src, selected.dst].filter(Boolean),
            segments: [{
                linkId: selected.id,
                from: selected.src,
                to: selected.dst,
                length: selected.length,
                lengthM: selected.lengthM,
                cableType: selected.cableType,
                type: selected.type,
                isPermanent: selected.isPermanent,
                permanent: selected.isPermanent,
                notes: selected.notes,
                isSelected: true,
            }]
        };
    }

    const selectedSegmentIndex = segments.findIndex(s=>s.isSelected);
    return {
        mode: segments.length > 1 ? 'inferred' : 'direct',
        selectedLinkId: selected.id,
        selectedSegmentIndex: selectedSegmentIndex >= 0 ? selectedSegmentIndex + 1 : null,
        ambiguous: !!(left.ambiguous || right.ambiguous),
        pathPids,
        segments,
    };
}

export function _createLinkRecord(src, dst, extra={}){
    return _normalizeLinkMetadata({ id:uid('l'), src, dst, ...extra });
}

function _isValidProjectPortId(s, pid){
    const raw = String(pid || '').trim();
    if(!raw || !Array.isArray(s.nodes)) return false;
    const nodeId = nodeIdOfPort(raw, s.nodes.map(n => n && n.id).filter(Boolean));
    return !!nodeId && raw !== nodeId && raw.slice(nodeId.length, nodeId.length + 1) === '-';
}

function _sanitizeProjectConnectivity(s){
    if(!s || typeof s !== 'object') return;
    if(!Array.isArray(s.nodes)) s.nodes = [];
    if(!Array.isArray(s.links)) s.links = [];
    if(!s.ports || typeof s.ports !== 'object' || Array.isArray(s.ports)) s.ports = {};

    Object.keys(s.ports).forEach(pid => {
        if(!_isValidProjectPortId(s, pid)) delete s.ports[pid];
    });

    s.links = s.links.filter(link =>
        link && _isValidProjectPortId(s, link.src) && _isValidProjectPortId(s, link.dst)
    );
}

// ── Lease DHCP: unione delle FONTI persistite → set unico per il motore ──────
// Le fonti (state.dhcpSources, una per DHCP server) sono la verità persistita; il
// motore Verifica legge un set UNITO e dedup per-MAC tramite store._dhcpLeases (cache
// derivata). Delega a mergeLeaseSources (lib/dhcp-lease.js): UN'UNICA autorità di
// ranking (_leaseRank) condivisa col dedup intra-fonte. Prima questa copia usava
// `expiry?Date.parse:0` e reintroduceva cross-fonte il bug S2.2 (la riserva statica a
// expiry infinito perdeva contro un lease datato/scaduto) — DRIFT-A3, audit 2026-07-21.
export function _dhcpMergeSources(sources) {
    return mergeLeaseSources(sources);
}
// Ricalcola la cache derivata dal valore CORRENTE di store.state.dhcpSources.
// La chiamano l'overlay «Lease DHCP» dopo ogni mutazione (_migrateState lo fa al load).
export function _dhcpSyncLeases() {
    store._dhcpLeases = _dhcpMergeSources(store.state && store.state.dhcpSources);
}

export function _migrateState(s) {
    if(!s || typeof s !== 'object') s = _buildDefaultState();
    const incomingSchemaVersion = Number(s.schemaVersion);
    _sanitizeProjectConnectivity(s);
    if (Array.isArray(s.nodes)) s.nodes.forEach(_compactNodeSpec);
    // Migrazione VLAN endpoint floor: i vecchi campi spec (vlanPc/vlanIot/…) erano
    // scollegati dal motore. Spostiamo il valore documentato (>1) sull'override di
    // PORTA (state.ports[id-1].vlanOvr), l'unica VLAN che la propagazione rispetta;
    // il campo device diventa sola-lettura derivata da _effPortVlan. Idempotente.
    const _FLOOR_VLAN_FIELD = { pc:'vlanPc', iot:'vlanIot', printer:'vlanPrint', webcam:'vlanCctv',
        tv:'vlanTv', projector:'vlanProj', customfloor:'vlanCustom', doorctrl:'vlanAcl', badgereader:'vlanAccess' };
    if (Array.isArray(s.nodes)) {
        if(!s.ports || typeof s.ports !== 'object') s.ports = {};
        s.nodes.forEach(n => {
            const f = n && _FLOOR_VLAN_FIELD[n.type];
            if(!f || !n.spec) return;
            const v = parseInt(n.spec[f], 10);
            delete n.spec[f];                                   // il campo device sparisce in ogni caso
            if(!(v >= 2 && v <= 4094)) return;                  // 1/invalido = default → niente override
            const pid = `${n.id}-1`;
            if(!s.ports[pid]) s.ports[pid] = {};
            if(s.ports[pid].vlanOvr == null) s.ports[pid].vlanOvr = v;   // non sovrascrive un override già presente
        });
    }
    // Regola del modello: una presa a muro ha SEMPRE 1 sola porta (1 keystone
    // RJ45). Normalizza anche dati importati/legacy con ports != 1.
    if (Array.isArray(s.nodes)) s.nodes.forEach(n => { if(n && n.type === 'wallport') n.ports = 1; });
    // Migrazione interfacce radio: dal vecchio modello a singola radio
    // (n.wifiCfg/n.wifi) al nuovo n.radios[] (lib/radio.js, idempotente).
    if (Array.isArray(s.nodes)) s.nodes.forEach(n => {
        if(n && typeof migrateNodeRadios==='function') migrateNodeRadios(n, { defaultOn: n.type==='ap' });
        // AP = sempre wireless: garantisci almeno 1 radio anche su dati legacy a 0.
        if(n && n.type==='ap' && typeof setRadioCount==='function' && (!Array.isArray(n.radios) || n.radios.length===0)) setRadioCount(n, 1);
        // Modello a due livelli: ssid/vlan/security della radio scendono in ssids[].
        if(n && typeof migrateRadioSsids==='function') migrateRadioSsids(n);
    });
    // Migrazione interfacce delle VM: dai campi piatti (vm.ip/ip6/mac/vlan) al
    // nuovo vm.nics[] (lib/vm-nics.js). Stessa classe della migrazione radio qui
    // sopra: da "un solo esemplare" a "un elenco". Idempotente — una VM già in
    // forma nuova (anche con nics[] VUOTO, che significa "nessuna scheda") non
    // viene toccata. I campi piatti si cancellano SOLO dopo aver scritto le
    // schede, così un'interruzione non può perdere l'indirizzo.
    if (Array.isArray(s.nodes)) s.nodes.forEach(n => {
        if(!n || !Array.isArray(n.vms)) return;
        n.vms.forEach(vm => {
            if(!vm) return;
            const nics = migrateVmNics(vm);
            if(!nics) return;
            vm.nics = nics;
            VM_FLAT_NET_FIELDS.forEach(f => { delete vm[f]; });
        });
    });
    // Pulizia: un link wireless con bss orfano (BSS rimosso) torna a derivare dal
    // primo SSID del lato servente (niente riferimenti pendenti nel modello).
    if (Array.isArray(s.links) && typeof ssidById==='function' && typeof parseRadioPid==='function') {
        const _byId = {}; if(Array.isArray(s.nodes)) s.nodes.forEach(n=>{ if(n&&n.id) _byId[n.id]=n; });
        s.links.forEach(l => {
            if(!l || !l.wireless || l.bss==null) return;
            const ok = [l.src, l.dst].some(pid => { const p=parseRadioPid(pid); const nn=p?_byId[p.nodeId]:null; return nn && ssidById(nn, l.bss); });
            if(!ok) delete l.bss;
        });
    }
    if (Array.isArray(s.links)) s.links.forEach(_normalizeLinkMetadata);
    // Riparazione: vecchio bug del path di riuso (cabling editor) salvava il
    // tratto come SEGMENTO {from,to} senza src/dst/id → link "fantasma" grigio
    // ed escluso dalla propagazione VLAN. Risana spostando from/to su src/dst.
    if (Array.isArray(s.links)) s.links.forEach(l => {
        if (!l || typeof l !== 'object') return;
        if (!l.src && l.from) l.src = l.from;
        if (!l.dst && l.to)  l.dst = l.to;
        if (l.src && l.dst) { delete l.from; delete l.to; }
        if (l.src && l.dst && !l.id) l.id = (typeof uid === 'function') ? uid('l') : ('l-' + Math.random().toString(36).slice(2));
    });
    if (!s.racks || !s.racks.length) {
        s.racks = [{id:'rack_default',name:'Rack 1',sizeU:42}];
        s.currentRack = 'rack_default';
        (s.nodes||[]).forEach(n => { if (TYPES[n.type]?.isRack) n.rackId='rack_default'; });
    }
    // currentRack assente o "appeso" (rack eliminato, oppure progetto importato che
    // crea i rack ma non ne seleziona uno) → apri sul primo rack esistente, così la
    // vista Rack non è vuota. Stesso ripiego di app-csv-import (import CSV).
    if (s.racks.length && !s.racks.some(r => r && r.id === s.currentRack)) {
        s.currentRack = s.racks[0].id;
    }
    if (!s.floorView) s.floorView = {x:0,y:0,zoom:1};
    if (!s.rackView)  s.rackView  = {zoom:1};
    if (!s.uiColors)  s.uiColors  = {floorBg:'#0d1117',rackBg:'#ffffff'};
    // Migrazione: vecchi progetti con sfondo rack scuro → bianco
    if (s.uiColors.rackBg === '#0d1117') s.uiColors.rackBg = '#ffffff';
    if (!s.vlanColors || !Object.keys(s.vlanColors).length)
        s.vlanColors = {10:'#00d4ff',20:'#ff00d4',30:'#39d353',40:'#f1e05a',99:'#f85149'};
    // Sicurezza: i colori VLAN finiscono NUDI in `style="color:${c}"` (pannello VLAN,
    // cavi, topologia). Dalla UI vengono da <input type=color> (#rrggbb), ma un progetto
    // JSON IMPORTATO può portare un valore ostile (`red" onmouseover="…`) che esce
    // dall'attributo style e arma un handler = XSS stored. Qui, all'apertura, ogni colore
    // non conforme a #rrggbb torna al grigio neutro: un sink solo, chiuso a monte.
    if (s.vlanColors && typeof s.vlanColors === 'object')
        for (const k of Object.keys(s.vlanColors))
            if (!/^#[0-9a-fA-F]{6}$/.test(String(s.vlanColors[k] == null ? '' : s.vlanColors[k]).trim()))
                s.vlanColors[k] = '#8b949e';
    if(!s.vlanColors[1]) s.vlanColors[1] = '#8b949e';
    if (!s.vlanNames)     s.vlanNames = {};
    if (!s.ipam) s.ipam = { vlans:{} };
    if (!s.ipam.vlans || typeof s.ipam.vlans !== 'object') s.ipam.vlans = {};
    // schemaVersion 2: la subnet non e' piu' un campo della VLAN. `subnet`/`gateway`/
    // `dns` escono da ipam.vlans[<vid>] e diventano righe di ipam.prefixes[], dove la
    // VLAN e' un riferimento facoltativo — cosi' una rete senza VLAN esiste e una VLAN
    // dual-stack tiene tutti e due i prefissi. Idempotente: rieseguirla non fa nulla.
    // `ipam.vlans` RESTA: ci vivono il binding manuale all'SVI e i metadati DCIM.
    migrateIpam(s);
    if (!s.bgImageScale)       s.bgImageScale  = 1;
    if (s.bgImageLocked === undefined) s.bgImageLocked = false;
    if (!s.autoPoll) s.autoPoll = { enabled:false, interval:5 };
    if (!s.discoveryHistory) s.discoveryHistory = { observations:[] };
    if (!Array.isArray(s.discoveryHistory.observations)) s.discoveryHistory.observations = [];
    // Sfoltisce la cronologia discovery all'apertura (aging + tetto): i progetti
    // gia' gonfi si riducono al primo salvataggio successivo. pruneDiscoveryHistory
    // vive in lib/discovery-history.js (lib-script, scope globale condiviso).
    if (typeof win.pruneDiscoveryHistory === 'function') win.pruneDiscoveryHistory(s.discoveryHistory.observations);
    if (!Array.isArray(s.auditLog)) s.auditLog = [];   // N2: journal append-only (additivo)
    if (!Array.isArray(s.guestVlans)) s.guestVlans = []; // VLAN guest (additivo): filtro rumore drift
    if (!Array.isArray(s.mgmtVlans)) s.mgmtVlans = [];   // VLAN management (additivo): anti-guest + sicurezza
    // Lease DHCP persistiti per-FONTE (multi-server). Additivo: i progetti vecchi
    // partono senza fonti. Il set unito alimenta store._dhcpLeases (cache derivata
    // letta dal motore Verifica e dall'auto-poll VLAN).
    if (!Array.isArray(s.dhcpSources)) s.dhcpSources = [];
    store._dhcpLeases = _dhcpMergeSources(s.dhcpSources);
    // NIENTE back-fill di r.sizeU: un rack importato o creato via API non ha
    // dichiarato la propria altezza, e scrivergli 42U dentro lo renderebbe
    // indistinguibile da uno dichiarato 42U (② no-invenzioni). Il ripiego 42U
    // vive nei LETTORI (getRackSize e i suoi gemelli), che lo hanno già.
    _normalizeProjectNodeIds(s);
    _expandLagMemberLinks(s);
    _repairRackPlacements(s);
    if(typeof projectFormat.pruneProjectStateCaches === 'function') projectFormat.pruneProjectStateCaches(s);
    // Campi che nessuno legge piu': via all'apertura, il progetto se ne libera al
    // primo salvataggio. Elenco chiuso e motivato in lib/project-format.js.
    if(typeof projectFormat.dropObsoleteFields === 'function') projectFormat.dropObsoleteFields(s);
    s.schemaVersion = Number.isInteger(incomingSchemaVersion) && incomingSchemaVersion > PROJECT_STATE_SCHEMA_VERSION
        ? incomingSchemaVersion : PROJECT_STATE_SCHEMA_VERSION;
    return s;
}

// ============================================================
// BIND EVENTI
// ============================================================
export function bindEventsOnce() {
    if (eventsBound) return;
    eventsBound = true;
    // ASSE B (ritiro onclick inline): 1ª superficie migrata a event delegation =
    // i bottoni Annulla/Ripeti della toolbar (data-act="undo"/"redo"). Le fn sono
    // IMPORTATE, non più su window/expose. Le altre superfici seguiranno.
    registerClickActions({ undo: () => undo(), redo: () => redo() });
    // ASSE B: import JSON via file-input delegato (data-change="json-upload"); importJSON
    // esce da expose(), l'handler riceve l'elemento <input type=file>.
    registerChangeActions({
        'json-upload': (el) => importJSON(el),
        // Campo IPv6 nel pannello Proprietà (event delegation, non onclick inline).
        // Manual-first: se l'indirizzo è valido lo canonicalizza (RFC 5952) e lo
        // riflette nel campo; se non è un IPv6 valido conserva ciò che l'utente ha
        // scritto (non distruggo l'input). `updateN` è locale qui in app.js.
        'node-ip6': (el) => {
            const raw = (el.value || '').trim();
            if (!raw) { updateN('ip6', ''); updateN('ip6Manual', false); return; }
            const canon = canonicalizeIpv6(raw);
            if (canon) el.value = canon;
            updateN('ip6', canon || raw);
            updateN('ip6Manual', true);   // editato a mano → bloccato (come ipManual)
        },
    });
    initDelegation();
    initModalA11y();   // M9: focus-trap + focus iniziale/ripristino sui tool-modal
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup',   handlePointerUp);
    document.addEventListener('dragend', ()=>{ _paletteDragType=''; _renderModeIndicator(); });
    initDraggablePopups();
    // Sopprime il menu contestuale del browser su tutta l'app: il tasto destro è usato per i link
    window.addEventListener('contextmenu', e=>{ if(!e.target.closest('input,select,textarea')) e.preventDefault(); });
    document.getElementById('rack-chassis').addEventListener('dblclick', handleDoubleClick);
    // Doppio click sulla planimetria: nodo -> proprieta; area vuota -> menu Planimetria
    const _floorEl = document.getElementById('floorplan');
    if(_floorEl) _floorEl.addEventListener('dblclick', handleFloorDoubleClick);

    document.addEventListener('keydown', e => {
        const inInput = ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName);
        if ((e.ctrlKey||e.metaKey) && e.key==='z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if ((e.ctrlKey||e.metaKey) && (e.key==='y'||(e.shiftKey&&e.key==='z'))) { e.preventDefault(); redo(); return; }
        if ((e.ctrlKey||e.metaKey) && e.key==='s') { e.preventDefault(); saveProject(); return; }
        if (e.key==='Delete' && !inInput && selId && selType==='node') { deleteNode(); return; }
        if (e.key==='Delete' && !inInput && selId && selType==='link') { deleteLink(selId); return; }
        if (e.code==='Space' && !inInput && !e.repeat) {
            e.preventDefault();
            _spaceDown=true;
            const fp=document.getElementById('floorplan');
            if(fp) fp.style.cursor='grab';
            const rv=document.getElementById('rack-viewport');
            if(rv) rv.style.cursor='grab';
            _renderModeIndicator();
            return;
        }
        // ── Shortcut navigazione (Fase 1.5) ──────────────────────────
        // Tasti singoli senza modificatori: scelti per non confliggere
        // con OS/browser. Attivi solo se:
        //   - focus NON in input/select/textarea/contenteditable
        //   - nessun modale aperto
        //   - nessun modificatore Ctrl/Alt/Meta premuto (Shift ok per ?)
        // Pattern Gmail/Linear/GitHub. Documentati in MANUALE_TECNICO.
        if (!inInput && !e.ctrlKey && !e.altKey && !e.metaKey &&
            document.activeElement?.isContentEditable !== true) {
            const _modalOpen = (() => {
                const _mo = document.getElementById('modal-overlay');
                if (_mo && _mo.style.display && _mo.style.display !== 'none') return true;
                const _tools = document.querySelectorAll('.tool-modal-overlay');
                for (const el of _tools) {
                    const cs = el.style.display;
                    if (cs && cs !== 'none') return true;
                }
                return false;
            })();
            if (!_modalOpen) {
                // 1 → vista Map, 2 → vista Topology
                if (e.key === '1' && _viewMode !== 'map') {
                    e.preventDefault();
                    if (typeof toggleTopology === 'function' && _topoVisible) toggleTopology();
                    return;
                }
                if (e.key === '2' && _viewMode !== 'topology') {
                    e.preventDefault();
                    if (typeof toggleTopology === 'function' && !_topoVisible) toggleTopology();
                    return;
                }
                // R → tab Rack, P → tab Proprieta. In vista Topology il
                // pannello destro e' spesso collassato per dare spazio alla
                // panoramica: forziamo la riapertura PRIMA di switch tab,
                // altrimenti l'utente non vedrebbe alcun feedback.
                if (e.key === 'r' || e.key === 'R') {
                    e.preventDefault();
                    if (typeof _rackCollapsed !== 'undefined' && _rackCollapsed &&
                        typeof toggleRackPanel === 'function') toggleRackPanel();
                    if (_rightTab !== 'rack') switchRightTab('rack');
                    return;
                }
                if (e.key === 'p' || e.key === 'P') {
                    e.preventDefault();
                    if (typeof _rackCollapsed !== 'undefined' && _rackCollapsed &&
                        typeof toggleRackPanel === 'function') toggleRackPanel();
                    if (_rightTab !== 'props') switchRightTab('props');
                    return;
                }
                // A → tab Assistente (riusa openAssistant: ri-espande il pannello
                // se collassato, poi switcha). Guardia typeof: la glue vive in
                // app-ai.js (bundle), caricato dopo app.js.
                if (e.key === 'a' || e.key === 'A') {
                    e.preventDefault();
                    if (typeof openAssistant === 'function') openAssistant();
                    else if (_rightTab !== 'ai') switchRightTab('ai');
                    return;
                }
            }
        }
        if (e.key==='Escape') {
            // Il modale base alert/confirm/prompt è SEMPRE il livello più in alto
            // (può stare sopra un tool-modal, es. conferma "Elimina progetto"):
            // Esc = Annulla, e NIENT'ALTRO sotto viene toccato.
            const _mo = document.getElementById('modal-overlay');
            if (_mo && _mo.classList.contains('open')) { modalResolve(false); return; }
            // M9: un tool-modal (o un overlay dinamico .drift-overlay: Verifica,
            // Storia, Adotta, L3, Porte libere…) aperto cattura Escape e NIENT'ALTRO
            // (convenzione dialog: Esc chiude il livello in cima, non tocca ciò che
            // sta sotto). Chiude via la X reale del modale → gira il suo cleanup.
            if (closeTopToolModal()) return;
            clearSearch();
            // P1.5: Esc esce dalla modalita' instradamento cavo (ha priorita').
            if (typeof _routingLinkId !== 'undefined' && _routingLinkId &&
                typeof _exitRoutingMode === 'function') { _exitRoutingMode(); return; }
            if (lagSelMode) { cancelLag(); return; }
            if (linkStart) { _cancelLink(); renderCables(); return; }
            // Esc senza link/lag attivo: deseleziona qualunque elemento
            // (porta/nodo/link/rack) e pulisci eventuali highlight topologici.
            // Convenzione UX: Esc = "annulla / esci dalla selezione corrente".
            if (selId || selType || highPath.size) {
                selId = null; selType = null;
                highPath.clear();
                _physicalTraceActive = false;
                closePop();
                if (typeof _clearTopoHighlight === 'function') _clearTopoHighlight();
                if (typeof _hideTopoTip === 'function') _hideTopoTip();
                renderAll();
            }
        }
    });
    document.addEventListener('keyup', e => {
        if (e.code==='Space') {
            _spaceDown=false;
            const fp=document.getElementById('floorplan');
            if(fp) fp.style.cursor='';
            const rv=document.getElementById('rack-viewport');
            if(rv) rv.style.cursor='';
            _renderModeIndicator();
        }
    });

    document.getElementById('modal-input').addEventListener('keydown', e => {
        // stopPropagation: il keydown NON deve risalire al listener globale del
        // document (chiuderebbe/agirebbe DIETRO il modale dopo il resolve).
        if (e.key==='Enter')  { e.preventDefault(); e.stopPropagation(); modalResolve(true); }
        if (e.key==='Escape') { e.preventDefault(); e.stopPropagation(); modalResolve(false); }
    });
    document.getElementById('modal-overlay').addEventListener('click', e => {
        if (e.target===document.getElementById('modal-overlay')) modalResolve(false);
    });
}

// ============================================================
// POP-UP / MODAL TRASCINABILI
// ============================================================
store._dragModalState = null;   // var: letto dal bundle app-popup (_hideTopoTip guard) via store._dragModalState

function _isInteractiveDragTarget(el){
    return !!el?.closest?.('button,input,select,textarea,a,label,[contenteditable="true"]');
}

function _makeFloatingPanel(el){
    if(!el) return;
    const r = el.getBoundingClientRect();
    el.style.position = 'fixed';
    el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - Math.min(r.width, window.innerWidth) - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - Math.min(r.height, window.innerHeight) - 8))}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.margin = '0';
}

function _clampFloatingPanel(el){
    if(!el) return;
    const r = el.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - r.width - 8);
    const maxTop = Math.max(8, window.innerHeight - r.height - 8);
    const left = Math.max(8, Math.min(r.left, maxLeft));
    const top = Math.max(8, Math.min(r.top, maxTop));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
}

function _startPopupDrag(e, panel, handle){
    if(e.button !== 0 || !panel || _isInteractiveDragTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if(panel.id === 'topo-tip') panel.dataset.userPlaced = '1';
    _makeFloatingPanel(panel);
    const r = panel.getBoundingClientRect();
    _dragModalState = {
        panel,
        dx: e.clientX - r.left,
        dy: e.clientY - r.top,
    };
    panel.classList.add('dragging-modal');
    handle?.classList.add('drag-handle-active');
    try{ handle?.setPointerCapture?.(e.pointerId); }catch(_){}
}

function _movePopupDrag(e){
    if(!_dragModalState) return;
    e.preventDefault();
    const { panel, dx, dy } = _dragModalState;
    const r = panel.getBoundingClientRect();
    const left = Math.max(8, Math.min(e.clientX - dx, window.innerWidth - r.width - 8));
    const top = Math.max(8, Math.min(e.clientY - dy, window.innerHeight - r.height - 8));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
}

function _endPopupDrag(){
    if(!_dragModalState) return;
    _dragModalState.panel.classList.remove('dragging-modal');
    document.querySelectorAll('.drag-handle-active').forEach(x=>x.classList.remove('drag-handle-active'));
    _dragModalState = null;
}

function _bindDraggablePanel(panel, handle){
    if(!panel || !handle || handle.dataset.dragBound === '1') return;
    handle.dataset.dragBound = '1';
    handle.classList.add('modal-drag-handle');
    handle.addEventListener('pointerdown', e => _startPopupDrag(e, panel, handle));
}

function initDraggablePopups(){
    document.querySelectorAll('.tool-modal').forEach(panel=>{
        _bindDraggablePanel(panel, panel.querySelector('.tool-modal-header'));
    });
    _bindDraggablePanel(document.getElementById('user-manager-modal'), document.querySelector('#user-manager-modal .um-header'));
    _bindDraggablePanel(document.querySelector('#chpwd-overlay > div'), document.querySelector('#chpwd-overlay .um-header'));
    _bindDraggablePanel(document.querySelector('#vlan-members-overlay > div'), document.querySelector('#vlan-members-overlay .um-header'));
    _bindDraggablePanel(document.getElementById('modal-box'), document.getElementById('modal-msg'));

    document.addEventListener('pointerdown', e=>{
        const h = e.target.closest?.('#popup h4');
        if(h) _startPopupDrag(e, document.getElementById('popup'), h);
        const th = e.target.closest?.('#topo-tip .topotip-header');
        if(th) _startPopupDrag(e, document.getElementById('topo-tip'), th);
    }, true);
    window.addEventListener('pointermove', _movePopupDrag);
    window.addEventListener('pointerup', _endPopupDrag);
    window.addEventListener('resize', ()=>{
        document.querySelectorAll('.tool-modal,#user-manager-modal,#chpwd-overlay > div,#vlan-members-overlay > div,#modal-box,#popup,#topo-tip')
            .forEach(_clampFloatingPanel);
    });
}

// ============================================================
// MODAL
// ============================================================


// ============================================================
//  ETICHETTE CAVI — helper e setter
// ============================================================

// ETICHETTE CAVI estratte in ./app-cables.js (split app.js #2). Import+re-export:
// import per la chiamata interna a _cableAutoLabel (logAudit cable-remove) e re-export
// per i consumatori ESM che importano queste fn da ./app.js.
import { _patchPanelOffset, _patchPanelChainOptions, _dispName, toggleAbbrevNames, _cableAutoLabel, _promoteLinkToManual, promoteLinkToManual, setCableLabel, setLinkProp } from "./app-cables.js";
export { _patchPanelOffset, _patchPanelChainOptions, _dispName, toggleAbbrevNames, _cableAutoLabel, _promoteLinkToManual, promoteLinkToManual, setCableLabel, setLinkProp };

// ============================================================
// JSON IMPORT (locale, indipendente dal server)
// ============================================================
function importJSON(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            const parsed = JSON.parse(ev.target.result);
            const imported = typeof projectFormat.unwrapProjectState === 'function' ? projectFormat.unwrapProjectState(parsed) : parsed;
            const valid = typeof projectFormat.isProjectState === 'function'
                ? projectFormat.isProjectState(imported) : !!(imported && imported.nodes && imported.racks);
            if (!valid) throw new Error('struttura non valida');
            createSnapshot('', 'pre-import');   // rete di sicurezza: cattura lo stato PRIMA di rimpiazzarlo
            pushHistory();
            state = _migrateState(imported);
            resetProjectRuntime();
            _restoreTopoSession();
            _resetSelection(); renderRackTabs(); updateTransforms(); renderAll();
            markDirty();
        } catch(e) {
            showAlert(t('msg.ui.invalidImportFile'));
        }
        input.value='';
    };
    reader.readAsText(file);
}

// ============================================================
// UTILS
// ============================================================
// escapeHTML / uid: estratti nel modulo foglia ./app-util.js (importati sopra),
// così i moduli src/ li importano invece di leggerli dal ponte win.*.

function _idPrefixForType(type){
    return NODE_ID_PREFIX[type] || 'n';
}

export function _nextNodeId(type, usedIds){
    const used = usedIds || new Set((state.nodes || []).map(n => String(n.id || '')));
    const prefix = _idPrefixForType(type);
    let max = 0;
    const rx = new RegExp(`^${prefix}(\\d+)$`);
    for (const id of used) {
        const m = String(id).match(rx);
        if (!m) continue;
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > max) max = n;
    }
    let seq = max + 1;
    let candidate = `${prefix}${seq}`;
    while (used.has(candidate)) {
        seq++;
        candidate = `${prefix}${seq}`;
    }
    used.add(candidate);
    return candidate;
}

function _normalizeProjectNodeIds(s){
    if (!s || !Array.isArray(s.nodes) || !s.nodes.length) return;

    const idMap = Object.create(null);
    const oldNodeIds = new Set(s.nodes.map(n => String(n?.id || '')).filter(Boolean));
    const used  = new Set();
    const counters = Object.create(null);
    const toReassign = [];

    // 1) Mantiene gli ID già coerenti con il tipo (es. wp1, sw2), se univoci.
    for (const n of s.nodes) {
        const type = n?.type || 'node';
        const prefix = _idPrefixForType(type);
        const oldId = String(n?.id || '');
        const rx = new RegExp(`^${prefix}(\\d+)$`);
        const m = oldId.match(rx);

        if (m && !used.has(oldId)) {
            const idx = parseInt(m[1], 10);
            if (Number.isFinite(idx)) counters[prefix] = Math.max(counters[prefix] || 0, idx);
            idMap[oldId] = oldId;
            used.add(oldId);
            continue;
        }
        toReassign.push({ n, oldId, prefix });
    }

    // 2) Rigenera solo gli ID non coerenti/duplicati.
    for (const item of toReassign) {
        const { n, oldId, prefix } = item;
        counters[prefix] = (counters[prefix] || 0) + 1;
        let next = `${prefix}${counters[prefix]}`;
        while (used.has(next)) {
            counters[prefix]++;
            next = `${prefix}${counters[prefix]}`;
        }
        idMap[oldId] = next;
        used.add(next);
        n.id = next;
    }

    const remapPid = (pid) => {
        const p = String(pid || '');
        const oldNodeId = nodeIdOfPort(p, oldNodeIds);
        if (!oldNodeId || oldNodeId === p) return idMap[p] || p;
        const suffix = p.slice(oldNodeId.length + 1);
        const newNodeId = idMap[oldNodeId] || oldNodeId;
        return `${newNodeId}-${suffix}`;
    };
    const escRx = v => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const remapIdTokens = value => {
        let out = String(value || '');
        const entries = Object.entries(idMap)
            .filter(([oldId,newId]) => oldId && newId && oldId !== newId)
            .sort((a,b)=>b[0].length-a[0].length);
        for(const [oldId,newId] of entries){
            out = out.replace(new RegExp(`(^|[^A-Za-z0-9_])${escRx(oldId)}(?=$|[^A-Za-z0-9_])`, 'g'), `$1${newId}`);
        }
        return out;
    };
    // Rimappa un identificatore di LAG group con UNA sola logica, usata SIA per le
    // chiavi di state.lagGroups SIA per i riferimenti ports[].lagGroup: i due lati
    // devono restare allineati dopo la rinumerazione degli ID, altrimenti il LAG si
    // perde (porta con ref dangling / gruppo orfano). Il formato SNMP tiene il nodeId
    // in posizione nota; ogni altro formato (`lag-<nodeId>-poN`, `lldp-lag-a||b`,
    // `lg-<uid>`) passa dal remap per-token (no-op se non contiene un id rinominato).
    const remapLagId = (gid) => {
        if (typeof gid === 'string' && gid.startsWith('snmp-lag-')) {
            const m = gid.match(/^snmp-lag-(.+)-(\d+)$/);
            if (m) {
                const mapped = idMap[m[1]];
                return remapIdTokens(mapped ? `snmp-lag-${mapped}-${m[2]}` : gid);
            }
        }
        return remapIdTokens(gid);
    };

    // 3) remap link endpoints
    if (Array.isArray(s.links)) {
        s.links.forEach(l => {
            if (!l) return;
            l.src = remapPid(l.src);
            l.dst = remapPid(l.dst);
            if(l.lagLogicalKey) l.lagLogicalKey = remapIdTokens(l.lagLogicalKey);
            if(Array.isArray(l.lagMembers)){
                const remapped = [];
                for(const pair of l.lagMembers){
                    const parts = String(pair||'').split('||');
                    const val = parts.length===2
                        ? [remapPid(parts[0]), remapPid(parts[1])].sort().join('||')
                        : remapIdTokens(pair);
                    if(val && !remapped.includes(val)) remapped.push(val);
                }
                l.lagMembers = remapped;
            }
        });
    }

    // 4) remap chiavi state.ports
    const oldPorts = (s.ports && typeof s.ports === 'object') ? s.ports : {};
    const newPorts = {};
    for (const [oldPid, portData] of Object.entries(oldPorts)) {
        const newPid = remapPid(oldPid);
        newPorts[newPid] = portData;
    }
    s.ports = newPorts;

    // 5) riallinea i riferimenti lagGroup SULLE PORTE con la STESSA fn delle chiavi
    // mappa (step 6). Qualunque formato che incorpora un nodeId rinominato
    // (`lag-<nodeId>-poN`, `snmp-lag-…`, `lldp-lag-a||b`) va rimappato: se qui si
    // trattasse solo `snmp-lag-` mentre lo step 6 rimappa tutto, i due lati
    // divergerebbero e il LAG andrebbe perso al caricamento.
    for (const pi of Object.values(s.ports)) {
        if (pi && pi.lagGroup) pi.lagGroup = remapLagId(pi.lagGroup);
    }

    // 6) riallinea le CHIAVI di state.lagGroups (etichette LAG) con la STESSA fn
    // usata sulle porte (step 5): applicando `remapLagId` a entrambi i lati, chiave
    // e riferimento restano per costruzione allineati.
    if (s.lagGroups && typeof s.lagGroups === 'object') {
        const remappedLagGroups = {};
        for (const [gid, gname] of Object.entries(s.lagGroups)) {
            remappedLagGroups[remapLagId(gid)] = gname;
        }
        s.lagGroups = remappedLagGroups;
    }
}

function _expandLagMemberLinks(s){
    if(!s || !Array.isArray(s.links)) return;
    // Igiene LAG su load (lib/lag-reconcile.js): (1) un cavo verso un device PASSIVO
    // o PASS-THROUGH (patch panel, presa, VoIP, media converter) non e' un LAG ->
    // togli il tag spurio PRIMA dell'espansione, cosi' non viene trattato come membro.
    // L'invariante è giusto (non si aggrega verso una presa a muro), ma la
    // mutazione era MUTA: se avevi marcato tu quel LAG, il marcatore spariva a ogni
    // load senza che nulla lo dicesse — e non c'era modo di capire perché non
    // «tenesse». La funzione il conteggio lo restituiva già: ora lo si racconta.
    const _lagTypeOfPort = pid => (TYPES[getNodeByPortId(pid)?.type] || null);
    if(typeof stripLagOnPassive==='function'){
        const _stripped = stripLagOnPassive(s.links, _lagTypeOfPort);
        if(_stripped > 0 && typeof _showToast === 'function')
            setTimeout(() => _showToast(t('msg.lag.strippedPassive', { n: _stripped }), 'warn', 7000), 800);
    }
    const seen = Object.create(null);
    const out = [];
    const pairSig = (a,b) => [String(a||''), String(b||'')].sort().join('||');
    const score = l => (l?.autoLinked ? 0 : 2) + (l?.confidence || 0) + (l?.mode === 'trunk' ? 0.05 : 0);
    const add = l => {
        if(!l?.src || !l?.dst || l.src===l.dst) return;
        const key = pairSig(l.src,l.dst);
        const prevIdx = seen[key];
        if(prevIdx === undefined){
            seen[key] = out.length;
            out.push(l);
            return;
        }
        if(score(l) > score(out[prevIdx])) out[prevIdx] = l;
    };

    for(const l of s.links){
        const members = Array.isArray(l?.lagMembers) ? l.lagMembers : [];
        if(l?.lagLogicalKey && members.length>1 && !l.lagMemberPair){
            for(const raw of members){
                const parts = String(raw||'').split('||');
                if(parts.length!==2) continue;
                const clone = { ...l, id:uid('l'), src:parts[0], dst:parts[1], lagMemberPair:pairSig(parts[0],parts[1]) };
                add(clone);
            }
            continue;
        }
        if(l?.lagLogicalKey && !l.lagMemberPair) l.lagMemberPair = pairSig(l.src,l.dst);
        add(l);
    }
    // (2) Una porta ATTIVA termina UN solo membro LAG: se piu' cavi-membro AUTO se la
    // contendono, tieni il piu' affidabile (manuale batte auto; LLDP/CDP > MAC/FDB).
    // Non tocca segmenti condivisi non-LAG (piu' device a valle) ne' pass-through.
    if(typeof reconcileLagMemberConflicts==='function'){
        out.length && out.splice(0, out.length, ...reconcileLagMemberConflicts(out, { typeOfPort:_lagTypeOfPort }).keep);
    }
    // (3) Ricostruisci lagMembers[] dai soli cavi sopravvissuti (niente riferimenti stale).
    if(typeof rebuildLagMembers==='function') rebuildLagMembers(out, pairSig);
    s.links = out;
}

export function _repairRackPlacements(s){
    if(!s || !Array.isArray(s.nodes) || !Array.isArray(s.racks)) return;
    const rackById = Object.fromEntries(s.racks.map(r=>[r.id,r]));
    const byRack = {};
    for(const n of s.nodes){
        if(!TYPES[n.type]?.isRack || !n.rackId || !rackById[n.rackId]) continue;
        (byRack[n.rackId] ??= []).push(n);
    }
    for(const [rackId, nodes] of Object.entries(byRack)){
        const rs = normalizeNumber(rackById[rackId]?.sizeU, 42, 6, 60);
        const occupied = new Set();
        const ordered = nodes
            .map((n,idx)=>({n,idx}))
            .sort((a,b)=>(b.n.rackU||0)-(a.n.rackU||0) || a.idx-b.idx);

        const fitsAt = (base, sizeU) => {
            if(base < 1 || base + sizeU - 1 > rs) return false;
            for(let i=0;i<sizeU;i++) if(occupied.has(base+i)) return false;
            return true;
        };
        const occupy = (base, sizeU) => {
            for(let i=0;i<sizeU;i++) occupied.add(base+i);
        };

        for(const item of ordered){
            const n = item.n;
            const sizeU = normalizeNumber(n.sizeU ?? TYPES[n.type]?.sizeU ?? 1, 1, 1, rs);
            n.sizeU = sizeU;
            const preferred = normalizeNumber(n.rackU, Math.max(1, rs-sizeU+1), 1, Math.max(1, rs-sizeU+1));
            let placed = null;
            for(let u=preferred; u>=1; u--) {
                if(fitsAt(u, sizeU)){ placed = u; break; }
            }
            if(placed == null){
                for(let u=preferred+1; u<=rs-sizeU+1; u++) {
                    if(fitsAt(u, sizeU)){ placed = u; break; }
                }
            }
            n.rackU = placed ?? preferred;
            occupy(n.rackU, sizeU);
        }
    }
}

// getPortNodeId/isPortOnNode/getNodeByPortId estratti in ./app-index.js (split app.js #4, re-export sopra).

// ── Interfacce radio Wi-Fi (collegamenti wireless senza porta fisica) ──
// Un device espone 0..8 interfacce radio (n.radios[]). Ogni radio è un
// endpoint POLIMORFICO: radio↔radio = associazione wireless (onda),
// radio↔porta-di-rete = cavo. La radio #0 mantiene il pid storico
// `${id}-radio` (back-compat); le successive sono `${id}-radio2`…`-radio8`.
// Una radio NON conta come porta fisica (resta fuori da Porte libere).
// Logica pura e testabile in lib/radio.js.
const _WIFI_TYPES = ['ap', 'router', 'firewall'];
// Quali tipi possono ESPORRE interfacce radio (mostrano il controllo conteggio):
// qualunque device floor + i classici AP/router/firewall (anche in rack).
export function _isWifiCapable(type){
    return _WIFI_TYPES.includes(type) || !!(typeof TYPES!=='undefined' && TYPES[type] && TYPES[type].isFloor);
}
function _radioCountOf(n){
    return (typeof radioCount==='function') ? radioCount(n) : (Array.isArray(n && n.radios) ? Math.min(n.radios.length,8) : 0);
}
export function _nodeRadios(n){ return (n && Array.isArray(n.radios)) ? n.radios : []; }
// Il device espone almeno una radio? Sorgente di verità = n.radios.
export function _deviceHasWifi(n){ return _radioCountOf(n) > 0; }
// Glue: imposta il numero di interfacce radio del device (0..8).
function setNodeRadioCount(id, k){
    const n = nodeById(id); if(!n) return;
    let kk = parseInt(k, 10) || 0;
    if(n.type === 'ap') kk = Math.max(1, kk);   // AP = sempre wireless: min 1 radio
    if(typeof setRadioCount === 'function') setRadioCount(n, kk);   // puro (lib/radio.js)
    markDirty(); renderAll(); renderProps();
}
// Compat: vecchio toggle "Wireless" → 0/1 radio.
function setDeviceWifi(id, on){ setNodeRadioCount(id, on ? Math.max(1, _radioCountOf(nodeById(id))) : 0); }
// Modalità AP opt-in: un device wifi-capable NON nativamente AP (pc/server/…) che fa da
// hotspot può TRASMETTERE SSID senza cambiare tipo → sblocca l'editor SSID (_canServeSsid).
// Spegnendola cancella i BSS orfani (niente "SSID fantasma" su un client); undoable via pushHistory.
function setDeviceApMode(id, on){
    const n = nodeById(id); if(!n) return;
    if(typeof pushHistory === 'function') pushHistory();
    if(on){ n.apMode = true; }
    else { delete n.apMode; if(Array.isArray(n.radios)) n.radios.forEach(r => { if(r) delete r.ssids; }); }
    markDirty(); renderAll(); renderProps();
}
function _radioPid(nodeId, idx){ return (typeof radioPid==='function') ? radioPid(nodeId, idx) : `${nodeId}-radio`; }
export function _isRadioPid(pid){
    const p = (typeof parseRadioPid==='function') ? parseRadioPid(pid) : null;
    if(!p) return false;
    return _radioCountOf(nodeById(p.nodeId)) > p.idx;   // solo pid entro le radio reali del nodo
}

export function getPortMaxConnections(pid)  {
    // Radio Wi-Fi: associazioni praticamente illimitate, nessuna porta fisica.
    if(_isRadioPid(pid)) return 9999;
    // Le porte pass-through 'port' (patch panel, presa a muro, telefono VoIP
    // — 1 punto fisico con 2 lati: work-area + uplink) accettano 2 cavi.
    // I 'device' (mediaconv: IN/OUT distinti) e gli endpoint restano a 1.
    return _getPassThroughMode(pid)==='port' ? 2 : 1;
}
export function getPortConnectionCount(pid) { return _linksForPort(pid).length; }
export function canAddConnection(pid)       { return getPortConnectionCount(pid)<getPortMaxConnections(pid); }

function _wallPortConnectionRole(wpPid, otherPid){
    const wp = getNodeByPortId(wpPid);
    const other = getNodeByPortId(otherPid);
    if(wp?.type !== 'wallport') return null;
    if(!other || other.type === 'wallport') return 'invalid';
    if(TYPES[other.type]?.isRack || TYPES[other.type]?.isActive || TYPES[other.type]?.isPassive) return 'infrastructure';
    if(_isLeafEndpoint(other.type, other)) return 'endpoint';
    return 'invalid';
}

function _wallPortHasRole(wpPid, role, ignoreLinkId=''){
    return _linksForPort(wpPid).some(l=>{
        if(ignoreLinkId && l.id===ignoreLinkId) return false;
        return _linkAdjacentPorts(l, wpPid).some(other => _wallPortConnectionRole(wpPid, other) === role);
    });
}

export function _validateWallPortConnection(aPid, bPid, ignoreLinkId=''){
    for(const [wpPid, otherPid] of [[aPid,bPid],[bPid,aPid]]){
        if(getNodeByPortId(wpPid)?.type !== 'wallport') continue;
        const role = _wallPortConnectionRole(wpPid, otherPid);
        if(role === 'invalid'){
            return {ok:false, message:'Una presa a muro puo collegare solo un endpoint e un collegamento infrastrutturale.'};
        }
        if(role && _wallPortHasRole(wpPid, role, ignoreLinkId)){
            const side = role === 'endpoint' ? 'lato stanza' : 'lato infrastruttura';
            return {ok:false, message:`La presa ${getWallPortLabel(getNodeByPortId(wpPid))||wpPid} ha gia occupato il ${side}.`};
        }
    }
    return {ok:true};
}

export function removeNodePorts(nodeIds) {
    Object.keys(state.ports).forEach(pid=>{ if(nodeIds.has(getPortNodeId(pid))) delete state.ports[pid]; });
}

// normalizeNumber/normalizeStatus/normalizeMacAddress/hexToRgba/_shadeHex:
// estratti nel modulo foglia ./app-util.js (importati sopra). selected() resta
// qui: è l'helper option-selected, da non confondere con lo stato win.selected.
export function selected(v,o)  { return v===o?'selected':''; }

export function _rackDeviceBg(value){
    if(!value || !/^#[0-9a-f]{6}$/i.test(value)) return '';
    const top = _shadeHex(value, 1.08) || value;
    const bottom = _shadeHex(value, 0.68) || value;
    return `linear-gradient(180deg, ${top}, ${bottom})`;
}

/** Protocolli supportati per il management dei device.
 *  Lista minima: ogni voce usa uno scheme URI standard che il browser
 *  inoltra al gestore registrato dall'OS (es. PuTTY/OpenSSH per ssh://,
 */
// Management protocols extracted in lib/app-management.js

export function checked(v)     { return v?'checked':''; }

export function getWallPortLabel(n) { return n?.portId||n?.name||''; }
export function getRackName(rid)    { return state.racks.find(r=>r.id===rid)?.name||rid||''; }
export function getRackById(rid)    { return state.racks.find(r=>r.id===rid); }
export function getRackSize(rid=state.currentRack) { return normalizeNumber(getRackById(rid)?.sizeU,42,6,60); }
export function getNodeRackSize(n)  { return getRackSize(n?.rackId||state.currentRack); }
// Numerazione U: internamente rackU=1 e' sempre la riga piu' in basso (EIA-310).
// Quando rack.uNumberFromTop e' true (rack telco/ETSI) tutte le visualizzazioni
// mostrano i numeri invertiti (1 in alto). La conversione e' bidirezionale e
// non tocca il dato persistito.
export function isRackTopNumbered(rid){ return !!getRackById(rid)?.uNumberFromTop; }
// Da rackU interno (1=basso) al numero da mostrare per la base del device.
export function rackUToVisible(rid, rackU, sizeU=1){
    const rs = getRackSize(rid);
    if(!isRackTopNumbered(rid)) return rackU;
    return rs - rackU - (sizeU - 1) + 1; // top edge of device when counting from top
}
// Da numero mostrato (input utente) a rackU interno (1=basso).
function visibleUToRackU(rid, visU, sizeU=1){
    const rs = getRackSize(rid);
    if(!isRackTopNumbered(rid)) return visU;
    return rs - visU - (sizeU - 1) + 1;
}

export function clampRackDevice(n) {
    if(!n||!TYPES[n.type]?.isRack) return;
    const rs=getNodeRackSize(n), su=normalizeNumber(n.sizeU,TYPES[n.type]?.sizeU||1,1,rs);
    n.sizeU=su; n.rackU=normalizeNumber(n.rackU,1,1,rs-su+1);
}

export function getNodePortCount(n) {
    if(n.type==='wallport') return 1;
    return n.ports!==undefined?n.ports:TYPES[n.type]?.ports||0;
}
// Nome LEGGIBILE del device, unico per tutte le superfici (drift, audit, mappa
// L3, cablaggio, dossier, ricerca…). L'intento era gia' "nome, altrimenti il
// tipo", ma il ramo di fallback non scattava MAI: l'import dello Scopri, senza
// hostname, scrive l'IP dentro `n.name` (`_discDisplayName`), quindi il nome
// c'era sempre — ed era un numero. Ora la scelta la fa lib/node-label.js, che
// riconosce il nome-uguale-all-indirizzo e compone tipo+marca dal MISURATO.
// Resta di solo DISPLAY: `n.name` non viene mai riscritto.
export function getNodeDisplayName(n) {
    if(!n) return 'Unknown';
    const p = nodeLabelParts(n, { typeName: typeShort(n.type) });
    return p.primary || n.id || 'Unknown';
}

// IPAM estratto in ./app-ipam.js (split app.js #1). Re-export per i consumatori
// che importano da ./app.js (app-vlan-autopoll, app-discovery, app-properties-floor, app-l3):
export { _ensureIpamState, _vlanRecord, _vlanIpam, _ipamUsageForVlan, _ipamUsageForPrefix } from "./app-ipam.js";
// Search, zoom, rack management e palette estratti in lib/app-search-zoom-rack.js

// Render core (renderAll/renderScope/renderFloor/cable paths): lib/app-render-core.js (R3)

// SNMP / Integrazione (pollSNMP/pollAllSNMP/applyPollResult): lib/app-snmp.js (R6)


// P1.5-bis — Ambiguità "per catena" (chain-aware): un cavo instradato attraverso
// pass-through resta visivamente INFERITO (animato) finché ANCHE UN SOLO hop
// della sua catena fisica è inferito; diventa solido solo quando TUTTA la catena
// è confermata (manuale). La logica di grafo è pura/testata in lib/cabling.js
// (chainAmbiguousLinkIds); qui iniettiamo i predicati che dipendono da
// TYPES/linkState. Calcolato 1 volta per render.
export function _chainAmbiguousLinkIds(){
    if(typeof linkState !== 'function' || typeof chainAmbiguousLinkIds !== 'function') return new Set();
    return chainAmbiguousLinkIds(
        state.links || [],
        pid => !!TYPES[getNodeByPortId(pid)?.type]?.passThrough,
        l => linkState(l).key === 'ambiguous');
}

// Colore VLAN ereditato lungo la catena fisica: un segmento untagged a valle
// prende il colore VLAN del segmento che arriva dalla sorgente (P1.5-bis).
export function _chainVlanColors(){
    if(typeof chainVlanColorMap !== 'function') return new Map();
    return chainVlanColorMap(
        state.links || [],
        pid => !!TYPES[getNodeByPortId(pid)?.type]?.passThrough,
        l => { const vl = _getLinkVlan(l); return vl > 1 ? (state.vlanColors[vl] || null) : null; });
}

// Proof-State del cavo -> classe SVG (spec Proof-State unificato §5.2). Il cavo
// EREDITA lo stato dagli estremi: dedotto = tratteggio (fitto/rado per tier),
// fantasma = attenuato+tratteggio (evidenza persa). Il DICHIARATO resta pieno
// (nessuna classe): un cavo manuale verso un device muto NON si attenua — il
// segnale d'irraggiungibilita' sta sul NODO, non sul cavo (cablaggio != liveness).
const _CABLE_PROOF_CLS = {
    'declared':        '',
    'declared-review': ' cable-review',   // la realta' contraddice QUESTO cavo: marker d'attenzione
    'declared-shut':   ' cable-shut',     // porta spenta a mano sotto un cavo dichiarato
    'derived-strong':  ' cable-derived',
    'derived-weak':    ' cable-derived cable-weak',
    'ghost':           ' cable-ghost',
};

// Badge dello STATO-DI-PROVA del cavo — pillola compatta accanto ai badge di
// provenienza (LLDP/CDP/MAC), STESSA misura/forma (padding/border-radius/font).
// Reso sia nell'header Proprietà cavo sia nella lista Cavi della Panoramica. Il
// dichiarato NON millanta liveness: resta «Dichiarato» (cablaggio ≠ liveness).
const _CABLE_PROOF_BADGE = {
    'derived-strong':  { key: 'fresh',    color: '#1a7f37' },   // inferenza con evidenza FRESCA
    'derived-weak':    { key: 'weak',     color: '#bf8700' },   // inferenza debole/che invecchia
    'ghost':           { key: 'ghost',    color: '#6e7681' },   // inferenza che ha PERSO l'evidenza
    'declared-review': { key: 'review',   color: '#cf222e' },   // la realtà contraddice il cavo
    'declared-shut':   { key: 'shut',     color: '#cf222e' },   // porta in shutdown: due dichiarazioni in conflitto
    'declared':        { key: 'declared', color: '#57606a' },   // asserito a mano, nessun claim di liveness
};
// state (output di cableProof) → HTML della pillola, o '' se lo stato è ignoto
// (nessuna Verifica → nessun badge, non spacciamo per fantasma un cavo mai provato).
export function _cableProofBadgeHtml(state){
    const m = _CABLE_PROOF_BADGE[state];
    if(!m) return '';
    return `<span class="cable-proof-badge" style="background:${m.color};color:#fff;padding:2px 9px;border-radius:4px;font-weight:700;font-size:0.74rem" data-tip="${t('proof.badge.tip')}">${t('proof.badge.' + m.key)}</span>`;
}

let _renderCablesRaf = 0;
export function renderCables(){
    if(_renderCablesRaf) return;
    _renderCablesRaf = requestAnimationFrame(()=>{
        _renderCablesRaf = 0;
        _renderCablesNow();
    });
}

function _renderCablesNow(){
    const ov=document.getElementById('cable-overlay');
    const rov=document.getElementById('rack-cable-overlay');
    if(!ov||!rov) return;
    Array.from(ov.children).forEach(c=>{if(c.id!=='temp-link')ov.removeChild(c);});
    Array.from(rov.children).forEach(c=>{if(c.id!=='temp-link-rack')rov.removeChild(c);});
    // Ambiguità per-catena (chain-aware): un solo calcolo per render, usato sia
    // dai cavi floor/rack sia da quelli cross-rack.
    const _chainAmb = _chainAmbiguousLinkIds();
    // Colore VLAN ereditato lungo la catena (segmento untagged a valle → colore
    // del tratto dalla sorgente VLAN). Un solo calcolo per render.
    const _chainCol = _chainVlanColors();
    const tempFloor=document.getElementById('temp-link');
    const tempRack=document.getElementById('temp-link-rack');
    if(tempFloor) tempFloor.setAttribute('d','');
    if(tempRack) tempRack.setAttribute('d','');
    const banner=document.getElementById('cross-rack-banner');
    // Vero quando il #rack-viewport e' NASCOSTO (display:none), cioe' su OGNI tab
    // non-Rack (Proprieta' E Assistente; vedi switchRightTab). Le porte del rack
    // nascosto danno getBoundingClientRect azzerato (0,0): senza questo, i cavi/onde
    // verso porte rack verrebbero disegnati verso l'angolo alto-sinistra ("svirgolano
    // a sinistra"). NB: era '=== props' e ignorava la tab Assistente (3a tab aggiunta
    // dopo) -> bug dello swerve passando all'Assistente.
    const suppressRackOverlays = _rightTab !== 'rack';
    if(suppressRackOverlays && banner) banner.classList.remove('show');
    const hasSelectedCable = highPath.size > 0 || (selType === 'link' && !!selId) || (selType === 'port' && !!selId);
    // In topologia il percorso fisico si mostra con l'OVERLAY topologia (linee
    // fanout + coppie, filtrate ai segmenti del percorso), non coi cavi reali:
    // cosi' si vede anche il tratto rack↔presa. Quindi niente cable-overlay in topo.
    const hasCableTrace = _viewMode === 'topology' ? false : hasSelectedCable;
    document.body.classList.toggle('cable-trace-active', hasCableTrace);
    document.body.classList.toggle('physical-trace-active', _physicalTraceActive && _viewMode === 'topology');
    const ea=document.getElementById('export-area').getBoundingClientRect();
    const vpEl=document.getElementById('rack-viewport');
    const vp=vpEl.getBoundingClientRect();
    // FIX scroll rack: #rack-cable-overlay e' position:absolute DENTRO il
    // contenuto scrollabile di #rack-viewport (position:relative), quindi
    // scrolla via insieme al contenuto. Le coordinate dei cavi pero' sono
    // calcolate relative alla viewport (clientRect LED - clientRect viewport):
    // con scrollTop S i cavi finivano disegnati S px sopra i LED reali.
    // Ri-ancoriamo l'overlay all'angolo visibile della viewport ad ogni
    // render: renderCables gira gia' su onscroll, quindi il pin segue lo
    // scroll. (Bug storico, slegato dal refactoring R1-R5.)
    rov.style.top=vpEl.scrollTop+'px';
    rov.style.left=vpEl.scrollLeft+'px';

    // Mappa pid→element costruita una sola volta: evita N×2 querySelector per N cavi.
    // Limitare la mappa agli ancoraggi visuali delle porte: il pannello Proprietà
    // usa lo stesso data-pid su input/select/button per modificare una porta. Se
    // quei controlli finiscono nella mappa, l'ultimo elemento può essere nascosto
    // e il cavo viene calcolato verso il suo rect 0×0.
    const pidMap={};
    document.querySelectorAll(PORT_ANCHOR_SEL).forEach(el=>{
        pidMap[el.dataset.pid]=el;
    });

    // Proof-State ATTIVO solo se il progetto e' stato verificato almeno una volta
    // (>=1 nodo con n.proof): senza dati di prova NON tratteggiamo nulla — un cavo
    // dedotto verso estremi mai verificati resterebbe altrimenti sempre "fantasma".
    // Calcolato UNA volta per render.
    const _proofOn = (typeof cableProof==='function') && state.nodes.some(n=>n&&n.proof);

    // --- Cavi normali (stessa posizione logica) ---
    state.links.forEach(l=>{
        if(!shouldRenderLink(l)) return;
        const ends = _getLinkDrawEndpoints(l);
        if(!ends.src || !ends.dst) return;
        // Nascondi il cavo se uno dei due nodi floor è fuori dalla VLAN filtro
        const _snId=getPortNodeId(ends.src), _dnId=getPortNodeId(ends.dst);
        if(_floorNodeHiddenByVlan(_snId)||_floorNodeHiddenByVlan(_dnId)) return;
        if(_filterVlan&&!_linkMatchesVlanFilter(l)) return;
        let src=pidMap[ends.src];
        let dst=pidMap[ends.dst];
        // Un capo su una porta di RACK NON disegnabile in questa vista — pannello rack
        // nascosto (tab Proprietà/Assistente) o RACK DIVERSO da quello mostrato → il LED
        // è display:none (rect 0×0) o assente. Senza intervento il cavo veniva TIRATO
        // all'origine («passa per 0.0», la tratta che non tocca la presa a muro) oppure
        // SALTATO del tutto («manca la tratta verso il device»). Come già succedeva SOLO
        // per il wireless, àncora il capo-rack all'ICONA del rack sulla planimetria: così
        // il cavo device↔rack (cablato o wireless) resta visibile e punta al rack giusto,
        // invece di sparire o finire a (0,0). Solo per cavi MISTI floor↔rack; i rack↔rack
        // tengono il ramo vp-relativo qui sotto.
        const _srcRack = isRackPort(ends.src), _dstRack = isRackPort(ends.dst);
        const _undrawable = el => !el || (()=>{ const r=el.getBoundingClientRect(); return r.width===0 && r.height===0; })();
        if(_srcRack !== _dstRack){
            if(_srcRack && _undrawable(src)){ const a=_wlRackIconAnchor(ends.src); if(a && !_undrawable(a)) src=a; }
            if(_dstRack && _undrawable(dst)){ const a=_wlRackIconAnchor(ends.dst); if(a && !_undrawable(a)) dst=a; }
        }
        if(!src||!dst) return;                       // cross-rack: uno dei due manca → gestito sotto
        const sr=src.getBoundingClientRect(), dr=dst.getBoundingClientRect();
        // Un capo-RACK ancora a 0×0 (rack non piazzato sulla planimetria → niente icona,
        // o rack↔rack verso un rack non mostrato): salta invece di puntarlo a (0,0). NON
        // si controllano i capi FLOOR: un cavo device↔presa non va mai perso per un rect
        // transitorio (era la causa di «manca la tratta verso il device»).
        if((_srcRack && sr.width===0 && sr.height===0) || (_dstRack && dr.width===0 && dr.height===0)) return;
        const vl=_getLinkVlan(l);
        const autoColor=state.vlanColors[vl]||_chainCol.get(l.id)||'#6e7681';
        const color=l.colorOvr||autoColor;
        const isSelected=selType==='link'&&selId===l.id;
        // Segnala visivamente i cavi "inferiti" (MAC/ARP/FDB) anche in rack/floor:
        // l'utente che arriva dalla topology deve poterli identificare per agire.
        // Chain-aware: inferito se la CATENA del cavo ha ≥1 hop inferito.
        const _amb=_chainAmb.has(l.id)?' ambiguous':'';
        // Wireless (link.wireless): reso "a onda" (lib/wave-path.js) e classe
        // dedicata, per distinguerlo a colpo d'occhio dal cavo fisico.
        const _wl=l.wireless?' wireless':'';
        // Pillola TRUNK/ACCESS (solo topologia): il cavo che il filtro MOSTRA va
        // EVIDENZIATO — non lasciato come cavo spento. shouldRenderLink ne governa
        // già la VISIBILITÀ; qui ne allineiamo gli ATTRIBUTI a un cavo "acceso".
        // Vale in TUTTI e tre gli stati: «solo trunk» ingrossa i trunk, «solo access»
        // ingrossa le access, «trunk + access» ingrossa entrambi — così un cavo non
        // cambia spessore solo perché si passa dalla vista filtrata a quella piena.
        // Classe PROPRIA (.mode-emph = 2.5px), non `.highlight`: quella dice gia'
        // «questo e' il cavo che stai seguendo» (percorso fisico), e due significati
        // con un aspetto solo si rendono illeggibili a vicenda. Si SOMMA a
        // highlight/sel invece di escluderle: un cavo selezionato non deve uscire
        // piu' sottile di quelli che gli stanno intorno.
        const _modeEmph = (typeof _topoTrunkMode!=='undefined' && _viewMode==='topology' && (()=>{
            const _t = (typeof _linkIsTrunk==='function') ? _linkIsTrunk(l) : l.mode==='trunk';
            return _topoTrunkMode==='all'
                || (_topoTrunkMode==='trunk' && _t) || (_topoTrunkMode==='access' && !_t);
        })());
        const _emph = highPath.has(l.id) ? ' highlight' : isSelected ? ' sel' : '';
        // Eredita' del Proof-State sul disegno: il cavo prende lo stato dai due
        // estremi (_snId/_dnId gia' risolti sopra). Solo dasharray/opacity: colore
        // VLAN e glow di selezione restano governati da _emph/color qui accanto.
        const _proofCls = _proofOn
            ? (_CABLE_PROOF_CLS[cableProof(l, (nodeById(_snId)||{}).proof, (nodeById(_dnId)||{}).proof)] || '')
            : '';
        const cls=`cable${_amb}${_wl}${_emph}${_modeEmph?' mode-emph':''}${_proofCls}`;
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('class',cls);
        path.setAttribute('stroke',color);
        path.style.color=color;   // currentColor = colore cavo → glow del drop-shadow colorato
        path.dataset.linkId=l.id;
        // Path invisibile largo (hit area) — riceve i click al posto del cavo visibile
        const hit=document.createElementNS('http://www.w3.org/2000/svg','path');
        // Wireless: area-click più larga — l'onda oscilla oltre la linea dritta,
        // quindi serve una banda più ampia per centrarla facilmente.
        hit.setAttribute('class', l.wireless ? 'cable-hit cable-hit-wireless' : 'cable-hit');
        hit.dataset.linkId=l.id;
        const _cableOnClick=(e)=>{
            e.stopPropagation();
            closePop();
            // Durante il percorso fisico: clic su un segmento lo seleziona MA
            // mantiene il percorso evidenziato (coerente con selectPathSegment).
            if(!_physicalTraceActive) highPath.clear();
            selType='link'; selId=l.id;
            renderAll(); renderProps();
        };
        hit.onclick=_cableOnClick;
        if(isRackPort(ends.src)&&isRackPort(ends.dst)){
            const x1=sr.left-vp.left+sr.width/2, y1=sr.top-vp.top+sr.height/2;
            const x2=dr.left-vp.left+dr.width/2, y2=dr.top-vp.top+dr.height/2;
            const d=getRackCablePath(x1,y1,x2,y2);
            // Visibile: onda se wireless. Hit: per i wireless segue la RETTA
            // dell'onda (non il bezier, che curva di lato → click a vuoto).
            path.setAttribute('d', l.wireless && typeof buildWavePath==='function' ? buildWavePath(x1,y1,x2,y2) : d);
            hit.setAttribute('d', l.wireless ? `M ${x1} ${y1} L ${x2} ${y2}` : d);
            rov.appendChild(path); rov.appendChild(hit);
        } else {
            // Ancora il cavo al BORDO del tile verso l'altro capo (non al
            // centro): quando due cavi toccano lo stesso nodo (es. presa a
            // muro con entra+esce dopo l'instradamento) escono da lati
            // diversi e non formano il "nodo" sovrapposto al centro.
            const cx1=sr.left-ea.left+sr.width/2, cy1=sr.top-ea.top+sr.height/2;
            const cx2=dr.left-ea.left+dr.width/2, cy2=dr.top-ea.top+dr.height/2;
            const [x1,y1]=_rectEdge(cx1,cy1, sr.width/2, sr.height/2, cx2-cx1, cy2-cy1);
            const [x2,y2]=_rectEdge(cx2,cy2, dr.width/2, dr.height/2, cx1-cx2, cy1-cy2);
            const d=getCablePath(x1,y1,x2,y2);
            // Visibile: onda se wireless. Hit: per i wireless segue la RETTA
            // dell'onda (non il bezier, che curva di lato → click a vuoto).
            path.setAttribute('d', l.wireless && typeof buildWavePath==='function' ? buildWavePath(x1,y1,x2,y2) : d);
            hit.setAttribute('d', l.wireless ? `M ${x1} ${y1} L ${x2} ${y2}` : d);
            ov.appendChild(path); ov.appendChild(hit);
        }
    });

    // --- Cavi cross-rack: sinuosi, visibili solo quando la porta/link è selezionato ---
    if(suppressRackOverlays) return;
    const chassisRect=document.getElementById('rack-chassis').getBoundingClientRect();
    const xExit=chassisRect.right-vp.left;  // bordo destro esterno del telaio
    const xEnd =vp.width-6;                 // esce verso il bordo dx del viewport
    state.links.forEach(l=>{
        if(!shouldRenderLink(l)) return;    // visibile solo su selezione, come tutti i cavi
        if(_filterVlan&&!_linkMatchesVlanFilter(l)) return;
        const sn=getNodeByPortId(l.src), dn=getNodeByPortId(l.dst);
        if(!sn||!dn) return;
        if(!TYPES[sn.type]?.isRack||!TYPES[dn.type]?.isRack) return;
        const srcCur=sn.rackId===state.currentRack, dstCur=dn.rackId===state.currentRack;
        if(srcCur===dstCur) return;

        const localPid=srcCur?l.src:l.dst;
        const localEl=pidMap[localPid];
        if(!localEl) return;

        const sr=localEl.getBoundingClientRect();
        const x1=sr.left-vp.left+sr.width/2;
        const y1=sr.top -vp.top +sr.height/2;

        // Scende sotto il dispositivo per non tagliare le altre porte,
        // poi esce sinuoso verso destra
        const deviceEl=localEl.closest('.rack-device');
        const dr=deviceEl?deviceEl.getBoundingClientRect():sr;
        const yDip=dr.bottom-vp.top+10;   // 10px sotto il bordo inferiore del device

        const vl=_getLinkVlan(l);
        const col=l.colorOvr||state.vlanColors[vl]||_chainCol.get(l.id)||'#6e7681';
        const isSelected=selType==='link'&&selId===l.id;
        const isTrace=highPath.has(l.id);

        // Bezier cubico sinuoso: LED → scende sotto il device → esce a destra del viewport
        // CP1 sotto il LED, CP2 a destra del chassis alla stessa quota del dip → curva naturale
        if(_filterVlan&&!_linkMatchesVlanFilter(l)) return;
        const xrD=`M${x1},${y1} C${x1},${yDip} ${xEnd},${yDip} ${xEnd},${yDip-10}`;
        const cable=document.createElementNS('http://www.w3.org/2000/svg','path');
        // Segnala anche cavi cross-rack inferiti per coerenza con la rack view.
        const _ambX=_chainAmb.has(l.id)?' ambiguous':'';
        // Stesse regole del floor: evidenzia cio' che il filtro MOSTRA, in tutti e tre
        // gli stati (anche «trunk + access»); la traccia resta `.highlight` e le classi si sommano.
        const _modeEmphX = (typeof _topoTrunkMode!=='undefined' && _viewMode==='topology' && (()=>{
            const _t = (typeof _linkIsTrunk==='function') ? _linkIsTrunk(l) : l.mode==='trunk';
            return _topoTrunkMode==='all'
                || (_topoTrunkMode==='trunk' && _t) || (_topoTrunkMode==='access' && !_t);
        })());
        const _emphX = isSelected ? ' sel' : isTrace ? ' highlight' : '';
        cable.setAttribute('class',`cable-xrack${_ambX}${_emphX}${_modeEmphX?' mode-emph':''}`);
        cable.setAttribute('stroke',col);
        cable.style.color=col;   // currentColor = colore cavo → glow colorato
        cable.setAttribute('d',xrD);
        cable.dataset.linkId=l.id;
        cable.style.pointerEvents='none';
        // Hit area invisibile per cavo cross-rack
        const xrHit=document.createElementNS('http://www.w3.org/2000/svg','path');
        xrHit.setAttribute('class','cable-hit');
        xrHit.setAttribute('d',xrD);
        xrHit.dataset.linkId=l.id;
        // Click su cavo cross-rack: SELEZIONA il link e mostra il pannello Proprietà
        // (stesso gesto dei cavi intra-rack/floor). Niente più popup dedicato: era un
        // doppione di quello che mostra già il pannello Proprietà.
        xrHit.onclick=e=>{e.stopPropagation();closePop();if(!_physicalTraceActive)highPath.clear();selType='link';selId=l.id;renderAll();renderProps();};
        rov.appendChild(cable);
        rov.appendChild(xrHit);
    });

    // --- Banner cross-rack in sospeso ---
    if(linkStart&&isRackPort(linkStart)){
        const lsNode=getNodeByPortId(linkStart);
        if(lsNode&&lsNode.rackId!==state.currentRack){
            const fromRack=getRackById(lsNode.rackId);
            const portN=linkStart.split('-').pop();
            banner.innerHTML=`<i class="fas fa-link" style="color:#39d353"></i>`
                +` Collegamento da <strong>${escapeHTML(lsNode.name||typeName(lsNode.type))}</strong>`
                +` / P${portN} <em>(${escapeHTML(fromRack?.name||'?')})</em>`
                +` — seleziona porta destinazione &nbsp;·&nbsp; <kbd>Esc</kbd> per annullare`;
            banner.classList.add('show');
        } else { banner.classList.remove('show'); }
    } else { banner.classList.remove('show'); }
}

// ============================================================
// PROPERTIES PANEL
// ============================================================
// ---- Tab destra: Rack / Proprietà ------------------------------------------
store._rightTab = 'rack';   // 'rack' | 'props' (var: letto bare da app-pointer/app-popup/app-render-core/cabling-editor)

// Tab del pannello proprieta + valore manuale estratti in ./app-props-tabs.js (split app.js #5).
// Import+re-export: import per i call-site interni (shortcut P, ecc.) e re-export per i
// consumatori ESM (switchRightTab 6, _enableManualValueInProps 5, _activatePropsTab 3, ...).
import { switchRightTab, _activatePropsTab, _clearPropsTab, _enableManualValueInProps } from "./app-props-tabs.js";
export { switchRightTab, _activatePropsTab, _clearPropsTab, _enableManualValueInProps };

function _cleanupPduNetworkPorts(n){
    const keep = pduManagementPortCount(n);
    for(let i = keep + 1; i <= 4; i++){
        const pid = `${n.id}-${i}`;
        if(state.ports && state.ports[pid]) delete state.ports[pid];
        if(Array.isArray(state.links)) state.links = state.links.filter(l => l && l.src !== pid && l.dst !== pid);
    }
}

function updateN(k,v){
    // Sentinella dell'harness manual-value (_enableManualValueInProps): NON persistere
    // mai il token. Scegliendo «Personalizzato…» il change delegato arriva qui col token
    // PRIMA del prompt; la conferma poi ri-emette il change col valore vero. Senza questa
    // guardia il token finirebbe nel modello (e ci resterebbe su Annulla).
    if(v === '__custom_manual__') return;
    const n=nodeById(selId); if(!n) return;
    const _auditOldName=(k==='name') ? String(n.name||'') : null;
    const fixedRackLabel=_fixedRackLabel(n.type);
    if(n.type==='wallport'&&k==='ports') v=1;
    if(n.type==='blankpanel'&&k==='ports') v=0;
    if(n.type==='cablemanager'&&k==='ports') v=0;
    if(n.type==='pdu'&&k==='pduOutletCount') v=normalizePduOutletCount(v);
    if(n.type==='pdu'&&k==='pduMgmtMode') v=normalizePduManagementMode(v);
    if(n.type==='pdu'&&k==='pduEthernetPorts') v=normalizePduPortCount(v, 2, 1);
    if(n.type==='pdu'&&k==='pduSerialPorts') v=normalizePduPortCount(v, 2, 1);
    if(n.type==='pdu'&&k==='pduSensorPorts') v=normalizePduPortCount(v, 2, 0);
    if(n.type==='pdu'&&k==='pduUsbPorts') v=normalizePduPortCount(v, 3, 0);
    if(n.type==='pdu'&&k==='pduExpansionPorts') v=normalizePduPortCount(v, 2, 0);
    if(fixedRackLabel&&k==='name') v=fixedRackLabel;
    if(k==='mac') v=normalizeMacAddress(v);
    if(k==='sizeU'){const rs=getNodeRackSize(n);v=normalizeNumber(v,TYPES[n.type]?.sizeU||1,1,rs);n.rackU=normalizeNumber(n.rackU,1,1,rs-v+1);}
    if(k==='rackU'){const su=n.sizeU!==undefined?n.sizeU:TYPES[n.type]?.sizeU||1,rs=getNodeRackSize(n);v=normalizeNumber(v,1,1,rs-su+1);}
    if(_isNodeSpecField(k)){
        const spec = _ensureNodeSpec(n);
        spec[k] = v;
        delete n[k];
    } else {
        n[k]=v;
    }
    if(n.type==='pdu' && (k==='pduMgmtMode' || k==='pduEthernetPorts')) _cleanupPduNetworkPorts(n);
    // Tipo scelto a mano = pinnato (manual-first): Discovery/Verifica non lo ricambiano.
    if(k==='type') n.typeManual = true;
    if(k==='brand') n.brandManual = !!String(v).trim();
    // Nome scelto a mano = pinnato (manual-first), gemello di typeManual/hostnameManual:
    // Discovery non rinomina piu' un nome deliberato, nemmeno se coincide con host/IP/tipo.
    // Vuoto = sblocca (torna a seguire l'auto-naming), come il campo Hostname.
    if(k==='name') n.nameManual = !!String(v).trim();
    // Conteggio porte scelto a mano = pinnato (manual-first, gemello di typeManual):
    // l'SNMP non alza piu' `ports` in silenzio, propone «Adotta porte rilevate»
    // (src/app-snmp.js via lib/ports-reconcile.js). Se riscrivi il conteggio a >=
    // della misura pendente, la proposta non ha piu' senso → la togli.
    if(k==='ports'){ n.portsManual = true; if(n.portsMeasured != null && Number(v) >= n.portsMeasured) delete n.portsMeasured; }
    if(k==='name' && _auditOldName!=null && v && String(v)!==_auditOldName){
        logAudit('device-rename', { target:String(v), summary:_auditOldName?((typeof t==='function')?t('audit.wasNamed',{name:_auditOldName}):`era «${_auditOldName}»`):'' });
    }
    // Aggiornato un identificatore di un endpoint foglia → ritenta l'auto-link
    // (es. ho appena incollato il MAC su una presa/AP/UPS).
    if((k==='mac'||k==='ip'||k==='hostname') && _isLeafEndpoint(n.type, n)){
        _autoLinkEndpoint(n.id);
    }
    // Stacking (P7.2): se il nodo e' master di uno stack e si tocca uno dei
    // campi shared (hostname/ip/mac), propaga ai membri. Lo stack ha UN
    // logical management identity quindi i membri ereditano dal master.
    if(STACK_SHARED_FIELDS.includes(k) && isInStack(n) && getEffectiveRole(state.nodes, n) === 'master'){
        propagateMasterToMembers(state.nodes, n);
    }
    renderAll(); markDirty();
}

// ── Backup configurazione (node.backup = { ref, method, at, by }) ────────────
// Puntatore a DOVE vive il backup della running-config (NON il config: InfraNet
// resta un registro). 🔒 Il `ref` è validato da lib/backup-ref.js: un valore con
// credenziali embedded è RIFIUTATO (mai persistito). `by` = tracciamento d'audit.
function setNodeBackup(nid, key, val){
    const n = nodeById(nid); if(!n) return;
    if(!n.backup) n.backup = {};
    if(key === 'ref'){
        const v = (typeof validateBackupRef === 'function') ? validateBackupRef(val) : { ok:true, value:String(val==null?'':val).trim() };
        if(!v.ok && v.reason === 'credentials'){
            if(typeof showAlert === 'function') showAlert(t('backup.credWarn'));
            renderAll();                       // rifiutato → il campo torna al valore salvato
            return;
        }
        n.backup.ref = v.value;
    } else if(key === 'method'){
        n.backup.method = String(val==null?'':val).trim();
    } else { return; }
    n.backup.by = 'user';
    // Audit SENZA il valore del path (potrebbe essere sensibile): solo l'esito.
    if(typeof logAudit === 'function') logAudit('backup-ref', { target: n.name||n.id, summary: key==='ref' ? (n.backup.ref ? 'ref set' : 'ref cleared') : ('method: '+(n.backup.method||'—')) });
    if(!n.backup.ref && !n.backup.method && !n.backup.at) delete n.backup;   // tutto vuoto → niente oggetto
    markDirty(); renderAll();
}
// Segna «backup fatto ora» (finché non arriva l'auto-update dall'API premium).
function markNodeBackupNow(nid){
    const n = nodeById(nid); if(!n) return;
    if(!n.backup) n.backup = {};
    n.backup.at = new Date().toISOString();
    n.backup.by = 'user';
    if(typeof logAudit === 'function') logAudit('backup-mark', { target: n.name||n.id, summary: n.backup.at });
    markDirty(); renderAll();
}
registerChangeActions({
    'backup-ref':    (el) => setNodeBackup(el.dataset.node, 'ref', el.value),
    'backup-method': (el) => setNodeBackup(el.dataset.node, 'method', el.value),
    // Campo semplice del device selezionato, per delegation invece che con un
    // onchange inline (ASSE B: il ponte non deve crescere). `data-field` dice
    // QUALE campo; updateN decide poi se vive sul nodo o nel suo spec.
    'node-field':    (el) => updateN(el.dataset.field, el.value),
    // Campo identità con flag *Manual gemello (ip→ipManual, hostname→hostnameManual):
    // scrive il valore E marca il campo come manual-first (il vecchio inline a doppia
    // updateN dei builder «Rete & Accesso»). Generico come node-field, `data-field` sceglie.
    'node-field-manual': (el) => { updateN(el.dataset.field, el.value); updateN(el.dataset.field + 'Manual', !!el.value.trim()); },
    // Toggle wireless dei builder condivisi (ex onchange="setDeviceWifi/ApMode(id,checked)").
    'device-wifi':   (el) => setDeviceWifi(el.dataset.nid, el.checked),
    'device-ap-mode':(el) => setDeviceApMode(el.dataset.nid, el.checked),
});
registerClickActions({
    'backup-mark-now': (el) => markNodeBackupNow(el.dataset.node),
    // Coda ASSE B (netmapper.html static): le 3 tab del pannello destro (rack/props/ai).
    'right-tab':       (el) => switchRightTab(el.dataset.tab),
});

// Lock manual-first VISIBILE: fissa/sblocca un campo identità del device (IP /
// hostname). NON è un meccanismo nuovo: commuta i flag *Manual già esistenti che
// Sync e Discovery rispettano (app-snmp.js / app-discovery-classify.js) e che il
// Drift evidenzia (ipChanged.manual). Bloccato = la Verifica segnala se la rete
// diverge; sbloccato = il campo torna a seguire la rete.
function toggleNodeLock(field){
    const n=nodeById(selId); if(!n) return;
    const flag=field+'Manual';   // ipManual / hostnameManual
    n[flag]=!n[flag];
    markDirty();
}

// Stacking (P7.2): wrapper per updateIntegration / setter SNMP che propaga
// ai membri quando si edita il master. Da chiamare dopo ogni mutazione di
// integration.* sul master.
export function _propagateStackMasterIntegration(node){
    if(!node) return;
    if(!isInStack(node)) return;
    if(getEffectiveRole(state.nodes, node) !== 'master') return;
    propagateMasterToMembers(state.nodes, node);
}
/** Toggle di un valore in un array stored sul nodo.
 *  Usato dai checkbox multi-selezione nei pannelli proprieta
 *  (es. router.rtRoutingProtos, firewall.fwServices, nas.nasProtocols). */
function _toggleArrayField(nodeId, field, value, on){
    const n = nodeById(nodeId); if(!n) return;
    const holder = _isNodeSpecField(field) ? _ensureNodeSpec(n) : n;
    if(!Array.isArray(holder[field])) holder[field] = [];
    const i = holder[field].indexOf(value);
    if(on && i<0) holder[field].push(value);
    if(!on && i>=0) holder[field].splice(i,1);
    if(_isNodeSpecField(field)) delete n[field];
    renderAll(); markDirty();
}
function updateFrontPanel(k,v){
    const n=nodeById(selId); if(!n) return;
    const d=TYPES[n.type];
    if(!d?.isRack) return;
    if(!n.frontPanel || typeof n.frontPanel!=='object') n.frontPanel={};
    n.frontPanel[k]=v;
    if(k==='separateSfp' && !v) n.frontPanel.sfpCount = 0;
    if(k==='separateSfp' && v && !(parseInt(n.frontPanel.sfpCount,10)>0)){
        const totalPorts = Number.isFinite(Number(n.ports)) ? Number(n.ports) : Number(d?.ports || 0);
        n.frontPanel.sfpCount = Math.min(4, Math.max(1, totalPorts));
    }
    // sfpCount governa direttamente separateSfp (l'UI non ha piu' un check):
    // count=0 -> separateSfp=false, count>0 -> separateSfp=true.
    if(k==='sfpCount'){
        const cnt = parseInt(v, 10) || 0;
        n.frontPanel.separateSfp = cnt > 0;
    }
    // sfpStartNum: null/empty -> rimuovi (numerazione continuata default);
    // valore valido -> intero positivo 1..999; altrimenti rimuovi.
    if(k==='sfpStartNum'){
        if(v === '' || v === null || v === undefined){
            delete n.frontPanel.sfpStartNum;
        } else {
            const s = parseInt(v, 10);
            if(Number.isFinite(s) && s >= 1 && s <= 999) n.frontPanel.sfpStartNum = s;
            else delete n.frontPanel.sfpStartNum;
        }
    }
    // sfpPrefix: trim + clamp 6 caratteri; vuoto -> rimuovi
    if(k==='sfpPrefix'){
        const s = (typeof v === 'string' ? v.trim().slice(0, 6) : '');
        if(s) n.frontPanel.sfpPrefix = s;
        else delete n.frontPanel.sfpPrefix;
    }
    // sfp2Count: 0..24, 0 rimuove anche sfp2StartNum/sfp2Prefix per cleanup
    if(k==='sfp2Count'){
        const cnt = Math.max(0, Math.min(48, parseInt(v, 10) || 0));
        n.frontPanel.sfp2Count = cnt;
        if(cnt === 0){
            delete n.frontPanel.sfp2StartNum;
            delete n.frontPanel.sfp2Prefix;
        }
    }
    if(k==='sfp2StartNum'){
        if(v === '' || v === null || v === undefined){
            delete n.frontPanel.sfp2StartNum;
        } else {
            const s = parseInt(v, 10);
            if(Number.isFinite(s) && s >= 1 && s <= 999) n.frontPanel.sfp2StartNum = s;
            else delete n.frontPanel.sfp2StartNum;
        }
    }
    if(k==='sfp2Prefix'){
        const s = (typeof v === 'string' ? v.trim().slice(0, 6) : '');
        if(s) n.frontPanel.sfp2Prefix = s;
        else delete n.frontPanel.sfp2Prefix;
    }
    // Setting the unified `oneBottom` cleans the legacy fields so the saved
    // model has only one source of truth going forward.
    if(k==='oneBottom'){
        delete n.frontPanel.numberTop;
        delete n.frontPanel.oddTop;
    }
    // MGMT count: clamp 0..4 e cleanup dei pid eccedenti (state.ports + links)
    // cosi' i cavi non rimangono attaccati a slot rimossi. Quando count=0
    // ripuliamo anche posizione/etichetta come reset completo.
    if(k==='mgmtCount'){
        const newCount = Math.max(0, Math.min(4, parseInt(v, 10) || 0));
        n.frontPanel.mgmtCount = newCount;
        // Migrazione soft: rimuovi il vecchio flag boolean se presente.
        delete n.frontPanel.mgmtPort;
        // Rimuovi pid sopra il nuovo count (1..4 max range)
        for(let i = newCount + 1; i <= 4; i++){
            const pid = n.type==='pdu' ? `${n.id}-${i}` : `${n.id}-mgmt${i}`;
            if(state.ports && state.ports[pid]) delete state.ports[pid];
            if(Array.isArray(state.links)){
                state.links = state.links.filter(l => l && l.src !== pid && l.dst !== pid);
            }
        }
        if(newCount === 0){
            delete n.frontPanel.mgmtPosition;
            delete n.frontPanel.mgmtLabel;
        }
    }
    if(k==='mgmtLabel'){
        const s = (typeof v === 'string' ? v.trim() : '');
        if(!s) delete n.frontPanel.mgmtLabel;
        else n.frontPanel.mgmtLabel = s;
    }
    // Patch panel — numerazione progressiva. ppContinueFrom (id del pannello da
    // cui continuare) e ppStartNum (numero di partenza manuale) sono MUTUAMENTE
    // ESCLUSIVI: impostarne uno azzera l'altro. Vuoto = indipendente (1..N).
    if(k==='ppContinueFrom'){
        if(v){ n.frontPanel.ppContinueFrom = v; delete n.frontPanel.ppStartNum; }
        else delete n.frontPanel.ppContinueFrom;
    }
    if(k==='ppStartNum'){
        if(v === '' || v === null || v === undefined){
            delete n.frontPanel.ppStartNum;
        } else {
            const s = parseInt(v, 10);
            if(Number.isFinite(s) && s >= 1 && s <= 9999){ n.frontPanel.ppStartNum = s; delete n.frontPanel.ppContinueFrom; }
            else delete n.frontPanel.ppStartNum;
        }
    }
    renderAll(); markDirty();
}
function updateWallPortId(value){
    const n=nodeById(selId); if(!n||n.type!=='wallport') return;
    n.portId=value.trim()||n.name||'Presa'; n.name=n.portId;
    n.nameManual = !!value.trim();   // ID presa scelto a mano = pinnato (manual-first)
    renderAll(); markDirty();
}
function updateFloorId(value){
    const n=nodeById(selId); if(!n) return;
    n.name=value.trim()||n.name||n.type;
    n.nameManual = !!value.trim();   // nome deliberato = pinnato (manual-first); vuoto = sblocca
    renderAll(); markDirty();
}
function updateP(k,v){
    if(!state.ports[selId])state.ports[selId]={};
    if(k==='status')v=normalizeStatus(v);
    if(k==='speed'&&!['10M','100M','1G','10G'].includes(v))v='1G';
    const _auditOldVlan=(k==='vlan')?state.ports[selId].vlan:null;
    state.ports[selId][k]=v;
    if(k==='vlan'){
        const vid=parseInt(v);
        if(!state.vlanColors[vid]){const cols=['#00d4ff','#ff00d4','#39d353','#f1e05a','#f85149','#a371f7'];state.vlanColors[vid]=cols[vid%cols.length]||'#fff';}
        if(String(v)!==String(_auditOldVlan==null?'':_auditOldVlan)){
            const _pn=getNodeByPortId(selId), _num=String(selId).split('-').slice(1).join('-');
            logAudit('vlan-change', { target:`${_pn?(getNodeDisplayName(_pn)||_pn.name||selId):selId} / P${_num}`, summary:`VLAN ${vid||v}` });
        }
    }
    renderAll(); markDirty();
}
// Rimozione "core" di un nodo: nodo + cavi che lo toccano + porte. SENZA
// history/render/audit (li gestisce il chiamante). Riusato da deleteNode
// (selezione) e dall'assorbimento di un tile come VM (app-hypervisor).
export function _removeNodeById(rid){
    if(!rid) return;
    state.nodes=state.nodes.filter(n=>n.id!==rid);
    state.links=state.links.filter(l=>!isPortOnNode(l.src,rid)&&!isPortOnNode(l.dst,rid));
    removeNodePorts(new Set([rid]));
    if(state.topoCache && typeof state.topoCache === 'object' && !Array.isArray(state.topoCache)) delete state.topoCache[rid];
    if(state.discoveryHistory && Array.isArray(state.discoveryHistory.observations)) {
        state.discoveryHistory.observations = state.discoveryHistory.observations.filter(obs => {
            if(!obs || typeof obs !== 'object') return false;
            if(String(obs.switchId || '') === String(rid)) return false;
            return !String(obs.portId || '').startsWith(String(rid) + '-');
        });
    }
}
function deleteNode(){
    if(!selId) return;
    pushHistory();
    const rid=selId;
    const _dn=nodeById(rid);
    if(_dn) logAudit('device-remove', { target:getNodeDisplayName(_dn)||_dn.name||rid, summary:TYPES[_dn.type]?.name||_dn.type });
    _removeNodeById(rid);
    selId=null;selType=null; renderAll(); markDirty();
}
export function deleteLink(id){
    const lid=id||selId; if(!lid) return;
    const link=state.links.find(x=>x.id===lid);
    pushHistory();
    // Se il cavo era auto-rilevato (autoLinked), ricorda il rifiuto: signature
    // simmetrica (A||B == B||A) salvata in state.rejectedAutoLinks. Il prossimo
    // _autoDiscoverLinks la consultera' e saltera' la ricreazione. Un Ctrl+Z
    // ripristina lo stato precedente (state.rejectedAutoLinks incluso, perche'
    // pushHistory() ha gia' snapshotato tutto). Per i cavi manuali non serve:
    // sono gia' protetti dal flusso autolink esistente.
    if(link && link.autoLinked && typeof pairSig === 'function'){
        const sig = pairSig(link.src, link.dst);
        if(!Array.isArray(state.rejectedAutoLinks)) state.rejectedAutoLinks = [];
        if(!state.rejectedAutoLinks.includes(sig)){
            state.rejectedAutoLinks.push(sig);
        }
        if(typeof _showToast === 'function'){
            _showToast(t('msg.ui.cableDeleted'), 'ok', 3500);
        }
    }
    if(link) logAudit('cable-remove', { target: link.label || _cableAutoLabel(link) });
    state.links=state.links.filter(x=>x.id!==lid);
    selType=null; selId=null; renderAll(); markDirty();
}

// Stacking + HA pair (setter setNodeStack/setNodeHaPair/_defaultStackName...): lib/app-stack-ha.js (R8)
// VLAN mgmt, link mode, trunk VLAN estratti in lib/app-vlan-autopoll.js

// Drag&drop + pointer events + dblclick + trace: lib/app-pointer.js (R5)


// Topologia: sessione, pulsante, discoverTopology, grafo, applyTopologyToProject: lib/app-topology-discover.js (R7)

// ---- Toast ------------------------------------------------------------------

// Durata minima di lettura: anche i toast piu' corti restano qualche secondo
// in piu' a fondo finestra (richiesta UX). Click sul toast per chiuderlo subito.
const TOAST_MIN_MS = 5500;

export function _showToast(msg,type='',dur=3000){
    let t=document.getElementById('topo-toast');
    if(!t){
        t=document.createElement('div'); t.id='topo-toast';
        t.style.cursor='pointer';
        t.addEventListener('click',()=>{ clearTimeout(t._tmr); t.classList.remove('topo-toast-in'); });
        document.body.appendChild(t);
    }
    t.textContent=msg;
    t.className=`topo-toast topo-toast-${type} topo-toast-in`;
    clearTimeout(t._tmr);
    t._tmr=setTimeout(()=>t.classList.remove('topo-toast-in'), Math.max(dur, TOAST_MIN_MS));
}


// Topology overlay (renderTopoOverlay, legenda VLAN, pairMap 3 passate): lib/app-topology-overlay.js (R4)

// ============================================================
// AUTH — utente corrente, menu, gestione utenti
// ============================================================



// Applica le traduzioni alle stringhe in HTML STATICO (header, menu, tab):
//   data-i18n="key"      → textContent
//   data-i18n-tip="key"  → attributo data-tip (tooltip)
//   data-i18n-ph="key"   → placeholder
// Le stringhe generate dai template JS usano invece t('key') inline.
function applyStaticI18n(){
    if(typeof t!=='function' || !document.querySelectorAll) return;
    document.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = t(el.getAttribute('data-i18n')); });
    // data-i18n-html: per testi con markup interno (<code>, <strong>…). I valori
    // sono stringhe del dizionario scritte da noi (nessun input utente) → sicuro.
    document.querySelectorAll('[data-i18n-html]').forEach(el=>{ el.innerHTML = t(el.getAttribute('data-i18n-html')); });
    document.querySelectorAll('[data-i18n-tip]').forEach(el=>{ el.setAttribute('data-tip', t(el.getAttribute('data-i18n-tip'))); });
    document.querySelectorAll('[data-i18n-ph]').forEach(el=>{ el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    // data-i18n-aria → attributo aria-label (accessibilità su tablist/icon-button)
    document.querySelectorAll('[data-i18n-aria]').forEach(el=>{ el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
}

// Evidenzia la lingua attiva tra i pulsanti IT/EN nel menu utente (ex
// #lang-select in toolbar; spostato dentro il menu account nel declutter).
function _syncLangButtons(){
    if(typeof getLang!=='function') return;
    const lg=getLang();
    document.querySelectorAll('.lang-opt').forEach(b=>b.classList.toggle('active', b.dataset.lang===lg));
}
// Cambio lingua UI: applica la lingua (i18n persiste in localStorage),
// aggiorna l'HTML statico e ri-renderizza i pannelli traducibili.
// ASSE B: importata da app-auth.js (menu utente via data-act), non più su window.
export function switchLang(l){
    if(typeof setLang!=='function') return;
    setLang(l);
    _syncLangButtons();
    applyStaticI18n();
    if(typeof _refreshTopoBtnState==='function') _refreshTopoBtnState(); // bottone topologia: innerHTML JS
    if(typeof renderNow==='function') renderNow();
    if(typeof renderProps==='function') renderProps();
    if(typeof renderCables==='function') renderCables();
}

// ============================================================
// Moduli a pagamento (plugin generici): se il server ha caricato dei moduli,
// ognuno dichiara una voce di menu via GET /api/modules. La mostriamo
// nell'header. Il core resta ignaro di quale modulo sia (contratto neutro).
// ============================================================
function registerModuleNav(entry){
    const slot = document.getElementById('modules-nav-slot');
    if(!slot || !entry || !entry.path) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toolbar-btn';
    if(entry.icon){ const ic = document.createElement('i'); ic.className = entry.icon; btn.appendChild(ic); }
    const span = document.createElement('span');
    span.className = 'btn-label';
    span.textContent = (entry.icon ? ' ' : '') + (entry.label || 'Module');
    btn.appendChild(span);
    btn.addEventListener('click', () => { window.location.href = entry.path; });
    slot.appendChild(btn);   // append: piu' moduli convivono nella stessa slot
}
async function _loadModuleNav(){
    try{
        const r = await fetch('/api/modules', { headers: { Accept: 'application/json' } });
        if(!r || !r.ok) return;
        const list = await r.json();
        if(Array.isArray(list)) list.forEach(registerModuleNav);
    }catch(_){ /* nessun modulo / non raggiungibile: la slot resta vuota */ }
}

async function init(){
    await initAuth();
    _initApp();
    // Sincronizza il selettore lingua con la lingua salvata (i18n) e applica
    // le traduzioni all'HTML statico (header/menu/tab).
    _syncLangButtons();
    applyStaticI18n();
    _loadModuleNav();   // moduli a pagamento: popola l'eventuale voce di menu (no-op se nessuno)
    _viewMode='map';
    _applyViewMode();
    // Vista di sintesi: si riapre se l'utente l'aveva lasciata attiva. La
    // preferenza vive in localStorage, NON nel progetto — cambiare vista non
    // deve sporcare il documento (vedi src/app-overview.js).
    if(typeof restoreOverviewView === 'function') restoreOverviewView();
    // Aggiorna lo stato iniziale del pulsante Topologia (default: 'stale' = no cache)
    _refreshTopoBtnState();
    // Check periodico ogni 60s per disabilitare il pulsante quando la cache scade
    setInterval(_refreshTopoBtnState, 60 * 1000);
}

// ASSE B (ritiro ponte): il pannello NODE (app-properties-node.js) importa queste
// per registrarle come azioni delegate (ex onchange/onclick inline). Restano anche
// in expose() finche' le superfici non migrate le usano.
export { updateN, updateFrontPanel, deleteNode, visibleUToRackU };
// ASSE B (Blocco 5): la catena device-spec (app-properties-node-devices.js) importa queste
// per registrarle come azioni delegate (ex onchange inline updateFloorId/updateWallPortId/
// _toggleArrayField). Restano anche in expose() per le superfici non migrate.
export { updateFloorId, updateWallPortId, _toggleArrayField };
// ASSE B (coda, builder condivisi): il lucchetto manual-first di «Rete & Accesso»
// (app-properties.js) importa toggleNodeLock per la sua azione delegata (ex
// onclick="toggleNodeLock(field);renderProps()"). Resta in expose() per i non migrati.
export { toggleNodeLock };
// ASSE B (coda, pannello wireless): app-wifi.js importa setNodeRadioCount per l'azione
// delegata «numero radio» (ex onchange="setNodeRadioCount(id,this.value)"). Resta in expose().
export { setNodeRadioCount };

// ============================================================
// EXPOSE — tutte le funzioni top-level del nucleo su window, come quando
// app.js era un classic script (handler inline onclick, export.js classico,
// e gli altri moduli del bundle le leggono via win.*). Nessuna collisione.
// ============================================================
expose({
  _bindDraggablePanel, _buildDefaultState, _chainAmbiguousLinkIds, _chainVlanColors,
  _clampFloatingPanel, _createLinkRecord,
  _deviceHasWifi, _endPopupDrag, _expandLagMemberLinks,
  _getLinkPhysicalView, _getPassThroughMode, _getUiModeMeta,
  _idPrefixForType, _isInteractiveDragTarget, _isLinearPassThroughPort,
  _isRadioPid, _isValidProjectPortId, _isWifiCapable,
  _loadDefaultLocal, _makeFloatingPanel, _migrateState, _movePopupDrag,
  _nextNodeId, _nodeRadios, _normalizeProjectNodeIds,
  _paletteTypeLabel, _propagateStackMasterIntegration,
  _rackDeviceBg, _radioCountOf, _radioPid, _renderCablesNow, _renderModeIndicator,
  _repairRackPlacements, _sanitizeProjectConnectivity,
  _showToast, _startPopupDrag, _toggleArrayField, _validateWallPortConnection,
  _wallPortConnectionRole, _wallPortHasRole, _wlRackIconAnchor, applyStaticI18n, bindEventsOnce, canAddConnection,
  checked, clampRackDevice, deleteLink, deleteNode,
  getNodeDisplayName, getNodePortCount, getNodeRackSize, getPortConnectionCount, getPortMaxConnections,
  getRackById, getRackName, getRackSize, getWallPortLabel,
  init, initDraggablePopups, isRackTopNumbered,
  rackUToVisible, registerModuleNav, removeNodePorts, renderCables, selected,
  setDeviceApMode, setDeviceWifi, setNodeRadioCount,
  toggleNodeLock, updateFloorId, updateFrontPanel, updateN,
  updateP, updateWallPortId, visibleUToRackU,
});

window.onload = init;
