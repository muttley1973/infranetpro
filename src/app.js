import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, uid, normalizeNumber, normalizeStatus, normalizeMacAddress, _shadeHex } from './app-util.js';   // helper puri estratti dal god-file
import { TYPES, typeName } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (prima letto dal global implicito) + nome localizzato
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: chiamate prima bare-global
import { renderProps } from './app-properties.js';   // idem
import { showAlert, saveProject } from './app-core.js';   // saveProject: ASSE B, scorciatoia Ctrl+S (ex win.saveProject)
import { registerClickActions, registerChangeActions, initDelegation } from './app-delegation.js';   // ASSE B: event delegation (ritiro onclick/onchange inline)
// ============================================================
// InfraNet Pro — app.js (core bootstrap + stato + eventi)
// Catalogo TYPES e node-spec: src/app-types.js (R1)
// ============================================================

// ============================================================
// STATO APPLICAZIONE
// ============================================================
// `var` (non `let`) di proposito: così `state` vive su window.state ed è
// leggibile/riassegnabile dai moduli ESM convertiti (bundle esbuild) tramite il
// ponte di migrazione (src/_bridge.js → store.state). I classic script legacy lo
// vedono comunque come globale. Vedi build.js / src/main.js.
store.state = {
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

let _idxDirty      = true;
let _nodeByIdMap   = Object.create(null); // nodeId  → node
let _linksByPortMap = Object.create(null); // portId → Link[]

export function _invalidateIdx() { _idxDirty = true; }

function _rebuildIdx() {
    _nodeByIdMap   = Object.create(null);
    _linksByPortMap = Object.create(null);
    for (const n of state.nodes) _nodeByIdMap[n.id] = n;
    for (const l of state.links) {
        for(const pid of _getLinkPortIds(l)){
            (_linksByPortMap[pid] ??= []).push(l);
        }
    }
    _idxDirty = false;
}

/**
 * Cerca un nodo per ID in O(1).
 * Sostituisce: state.nodes.find(x => x.id === id)
 */
export function nodeById(id) {
    if (_idxDirty) _rebuildIdx();
    return _nodeByIdMap[id] ?? null;
}

/**
 * Restituisce i link che toccano la porta `pid` in O(1).
 * Sostituisce: state.links.filter(l => l.src===pid || l.dst===pid)
 */
export function _linksForPort(pid) {
    if (_idxDirty) _rebuildIdx();
    return _linksByPortMap[pid] ?? [];
}

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
store._vlanIpamOpen=new Set();   // VLAN con dettagli IPAM aperti nel pannello floor
// ^ var (non let): il modulo bundle app-properties-floor.js lo legge via
//   store._vlanIpamOpen (.has). Un let vivrebbe nel global lexical, invisibile al
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

export function pushHistory() {
    _history = _history.slice(0, _histIdx+1);
    // bgImage è base64 (spesso >1 MB): escluso dagli snapshot per non saturare la RAM.
    // Undo/redo riagganciano sempre il bgImage corrente — l'immagine di sfondo
    // non è un'operazione annullabile (ha il proprio pulsante "Rimuovi mappa").
    // auditLog è append-only: escluso dagli snapshot così l'undo non lo riscrive
    // (la storia "chi/quando/cosa" sopravvive a undo/redo).
    const bg = state.bgImage;
    const audit = state.auditLog;
    state.bgImage = null;
    state.auditLog = undefined;
    _history.push(JSON.stringify(state));
    state.bgImage = bg;
    state.auditLog = audit;
    if (_history.length > 60) _history.shift(); else _histIdx++;
    _updateHistoryBtns();
}

export function undo() {
    if (_histIdx <= 0) return;
    const bg = state.bgImage;                  // preserva il background corrente
    const audit = state.auditLog;              // append-only: non si annulla
    state = JSON.parse(_history[--_histIdx]);
    state.bgImage = bg;                        // riaggancia (non è in snapshot)
    state.auditLog = audit;
    _invalidateIdx();
    _resetSelection(); renderRackTabs(); updateTransforms(); renderAll();
    _updateHistoryBtns();
}

export function redo() {
    if (_histIdx >= _history.length-1) return;
    const bg = state.bgImage;                  // preserva il background corrente
    const audit = state.auditLog;              // append-only: non si annulla
    state = JSON.parse(_history[++_histIdx]);
    state.bgImage = bg;                        // riaggancia (non è in snapshot)
    state.auditLog = audit;
    _invalidateIdx();
    _resetSelection(); renderRackTabs(); updateTransforms(); renderAll();
    _updateHistoryBtns();
}

export function _updateHistoryBtns() {
    document.getElementById('btn-undo').disabled = _histIdx <= 0;
    document.getElementById('btn-redo').disabled = _histIdx >= _history.length-1;
}

export function _resetSelection() { selId=null; selType=null; highPath.clear(); }

// ============================================================
// DIRTY FLAG (sostituisce saveState)
// ============================================================
export function markDirty() {
    _invalidateIdx();
    _isDirty = true;
    const dot = document.getElementById('save-dot');
    const btn = document.getElementById('btn-save');
    if (dot) dot.style.display = 'inline-block';
    if (btn) { btn.classList.add('save-dirty'); btn.classList.remove('primary'); }
}

export function _clearDirty() {
    _isDirty = false;
    const dot = document.getElementById('save-dot');
    const btn = document.getElementById('btn-save');
    if (dot) dot.style.display = 'none';
    if (btn) { btn.classList.remove('save-dirty'); btn.classList.add('primary'); }
}

// ── Audit trail (N2): journal append-only "chi / quando / cosa" ──────
// Registra solo eventi STRUTTURALI (device/cavi/VLAN/sync/doc), non ogni
// micro-edit (per quello c'è l'undo). Append + cap a 1000; auditLog è
// escluso dagli snapshot di undo (sopravvive a undo/redo).
export function logAudit(action, info){
    info = info || {};
    if(typeof appendAudit !== 'function') return;
    if(!Array.isArray(state.auditLog)) state.auditLog = [];
    const user = (typeof _currentUser === 'object' && _currentUser && _currentUser.username) ? _currentUser.username : 'sistema';
    appendAudit(state.auditLog, { user, action, target: info.target, summary: info.summary }, 1000);
    markDirty();
}

// ============================================================
// API CLIENT
// ============================================================
// API client estratto in lib/app-core.js



export function _loadDefaultLocal() {
    state = _migrateState(_buildDefaultState());
    _restoreTopoSession();
    _vlanIpamOpen.clear();
    document.getElementById('project-select').innerHTML =
        '<option value="0">— offline —</option>';
}

export function _buildDefaultState() {
    return {
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
            {id:'wp1',type:'wallport',   x:260, y:160, name:'A-01', ports:1},
            {id:'wp2',type:'wallport',   x:260, y:260, name:'A-02', ports:1},
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
    const cut = raw.lastIndexOf('-');
    if(cut <= 0 || cut >= raw.length - 1) return false;
    const nodeId = raw.slice(0, cut);
    return Array.isArray(s.nodes) && s.nodes.some(n => n.id === nodeId);
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
// motore Verifica legge un set UNITO e dedup per-MAC (scadenza più recente vince)
// tramite store._dhcpLeases, cache derivata. Identità = MAC (come lib/dhcp-lease.js).
export function _dhcpMergeSources(sources) {
    const byMac = new Map();
    for (const src of (Array.isArray(sources) ? sources : [])) {
        for (const l of ((src && Array.isArray(src.leases)) ? src.leases : [])) {
            if (!l || !l.mac) continue;
            const prev = byMac.get(l.mac);
            if (!prev) { byMac.set(l.mac, l); continue; }
            const a = prev.expiry ? Date.parse(prev.expiry) : 0;
            const b = l.expiry ? Date.parse(l.expiry) : 0;
            if (b >= a) byMac.set(l.mac, l);
        }
    }
    return [...byMac.values()];
}
// Ricalcola la cache derivata dal valore CORRENTE di store.state.dhcpSources.
// La chiamano l'overlay «Lease DHCP» dopo ogni mutazione (_migrateState lo fa al load).
export function _dhcpSyncLeases() {
    store._dhcpLeases = _dhcpMergeSources(store.state && store.state.dhcpSources);
}

export function _migrateState(s) {
    if(!s || typeof s !== 'object') s = _buildDefaultState();
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
    if (!s.floorView) s.floorView = {x:0,y:0,zoom:1};
    if (!s.rackView)  s.rackView  = {zoom:1};
    if (!s.uiColors)  s.uiColors  = {floorBg:'#0d1117',rackBg:'#ffffff'};
    // Migrazione: vecchi progetti con sfondo rack scuro → bianco
    if (s.uiColors.rackBg === '#0d1117') s.uiColors.rackBg = '#ffffff';
    if (!s.vlanColors || !Object.keys(s.vlanColors).length)
        s.vlanColors = {10:'#00d4ff',20:'#ff00d4',30:'#39d353',40:'#f1e05a',99:'#f85149'};
    if(!s.vlanColors[1]) s.vlanColors[1] = '#8b949e';
    if (!s.vlanNames)     s.vlanNames = {};
    if (!s.ipam) s.ipam = { vlans:{} };
    if (!s.ipam.vlans || typeof s.ipam.vlans !== 'object') s.ipam.vlans = {};
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
    s.racks.forEach(r => { if (!r.sizeU) r.sizeU=42; });
    _normalizeProjectNodeIds(s);
    _expandLagMemberLinks(s);
    _repairRackPlacements(s);
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
    registerChangeActions({ 'json-upload': (el) => importJSON(el) });
    initDelegation();
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
        if (e.key==='Enter')  { e.preventDefault(); modalResolve(true); }
        if (e.key==='Escape') { e.preventDefault(); modalResolve(false); }
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

/**
 * Genera l'etichetta automatica di un cavo dagli endpoint.
 * Formato: "NomeSrc Pn → NomeDst Pn"
 * Non viene salvata nel progetto — si ricalcola sempre dagli endpoint,
 * così segue automaticamente i rinomina dei nodi.
 */
// Offset di numerazione progressiva di un patch panel (catena ppContinueFrom /
// startNum manuale). Ricostruisce i record dai patch panel del progetto e delega
// all'helper puro panelNumberOffset (lib/frontpanel.js). 0 = indipendente (1..N).
export function _patchPanelOffset(node){
    if(!node || node.type!=='patchpanel' || typeof panelNumberOffset!=='function') return 0;
    const recs={};
    for(const n of state.nodes){
        if(n.type!=='patchpanel') continue;
        const fp=n.frontPanel||{};
        recs[n.id]={
            ports: (n.ports!==undefined ? n.ports : (TYPES.patchpanel?.ports||0)),
            continueFrom: fp.ppContinueFrom||'',
            startNum: fp.ppStartNum,
        };
    }
    return panelNumberOffset(node.id, recs);
}
// Patch panel selezionabili come "continua da" per `node`: tutti gli altri patch
// panel che NON sono a valle di node nella catena (selezionarli creerebbe un
// ciclo). Usa panelChainReaches (lib/frontpanel.js).
export function _patchPanelChainOptions(node){
    if(!node) return [];
    const recs={};
    for(const n of state.nodes){
        if(n.type!=='patchpanel') continue;
        recs[n.id]={ continueFrom:(n.frontPanel||{}).ppContinueFrom||'' };
    }
    const out=[];
    for(const n of state.nodes){
        if(n.type!=='patchpanel' || n.id===node.id) continue;
        if(typeof panelChainReaches==='function' && panelChainReaches(n.id, node.id, recs)) continue;
        out.push(n);
    }
    return out;
}
// Numero di porta da mostrare in etichetta: applica l'offset progressivo solo ai
// patch panel (porte dati numeriche); ogni altro device resta invariato.
function _portNumForLabel(node, portNumStr){
    if(node && node.type==='patchpanel'){
        const num=parseInt(portNumStr,10);
        if(Number.isFinite(num) && String(num)===String(portNumStr)) return String(num + _patchPanelOffset(node));
    }
    return portNumStr;
}
// Nome per il DISPLAY: abbreviato se il toggle "Nomi abbreviati" e' attivo
// (scope: planimetria + etichette cavi). SOLO display — non muta n.name.
export function _dispName(name){
    return (state && state.abbrevNames && typeof abbreviateName==='function')
        ? abbreviateName(name) : (name==null ? '' : String(name));
}
// Toggle "Nomi abbreviati" (planimetria + etichette cavi). Solo display.
function toggleAbbrevNames(on){
    state.abbrevNames = !!on;
    markDirty();
    renderAll();
}

export function _cableAutoLabel(l){
    const sn=getNodeByPortId(l.src), dn=getNodeByPortId(l.dst);
    const sp=_portNumForLabel(sn, l.src.split('-').slice(1).join('-'));
    const dp=_portNumForLabel(dn, l.dst.split('-').slice(1).join('-'));
    return `${_dispName(sn?.name||l.src)} P${sp} → ${_dispName(dn?.name||l.dst)} P${dp}`;
}

export function _promoteLinkToManual(link){
    if(!link?.autoLinked) return false;
    delete link.autoLinked;
    delete link.confidence;
    delete link.protocol;
    return true;
}

function promoteLinkToManual(id){
    const l=state.links.find(x=>x.id===id); if(!l) return;
    if(!l.autoLinked) return;
    pushHistory();
    _promoteLinkToManual(l);
    markDirty();
    renderAll();
    renderCables();
    renderProps();
    _showToast(t('msg.ui.linkConfirmedManual'), 'ok', 2500);
}

/** Imposta o cancella l'etichetta manuale di un cavo. */
function setCableLabel(id, val){
    const l=state.links.find(x=>x.id===id); if(!l) return;
    const v=val.trim();
    const nextLabel = v || undefined;
    if((l.label||undefined)===nextLabel && !l.autoLinked) return;
    pushHistory();
    _promoteLinkToManual(l);
    if(v) l.label=v; else delete l.label;
    markDirty();
    renderProps();
}

/**
 * Setter generico per le proprietà fisiche/documentali di un cavo.
 * Chiave vuota o stringa vuota → rimuove la proprietà dal JSON.
 * Chiama renderProps() per aggiornare i campi dinamici (es. categoria
 * cambia in base al mezzo scelto).
 */
function setLinkProp(id, key, val){
    const l=state.links.find(x=>x.id===id); if(!l) return;
    let v=typeof val==='string'?val.trim():val;
    if(key==='isPermanent') v = v ? true : null;
    if(key==='installedAt' || key==='installedBy') v = typeof v==='string' ? v.trim() : v;
    const same = (v===''||v===null||v===undefined)
        ? !(key in l) && !l.autoLinked
        : l[key]===v && !l.autoLinked;
    if(same) return;
    pushHistory();
    _promoteLinkToManual(l);
    if(v===''||v===null||v===undefined) {
        delete l[key];
        if(key==='length') delete l.lengthM;
        if(key==='colorOvr') delete l.color;
    } else {
        l[key]=v;
        if(key==='length') l.lengthM = v;
        if(key==='colorOvr') l.color = v;
    }
    _normalizeLinkMetadata(l);
    markDirty();
    renderProps();
}

// Collegamento wireless (link.wireless): reso "a onda" e fuori dalla validazione
// cavo fisico. Setter dedicato perche' la GEOMETRIA cambia (serve renderCables,
// che setLinkProp non chiama).
function setLinkWireless(id, on){
    const l=state.links.find(x=>x.id===id); if(!l) return;
    const want=!!on;
    if(!!l.wireless===want) return;
    pushHistory();
    if(want) l.wireless=true; else delete l.wireless;
    markDirty(); renderAll(); renderCables(); renderProps();
}

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
            if (!parsed.nodes||!parsed.racks) throw new Error('struttura non valida');
            pushHistory();
            state = _migrateState(parsed);
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
        const cut = p.lastIndexOf('-');
        if (cut <= 0) {
            const onlyNode = idMap[p] || p;
            return onlyNode;
        }
        const oldNodeId = p.slice(0, cut);
        const suffix = p.slice(cut + 1);
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
    const _lagTypeOfPort = pid => (TYPES[getNodeByPortId(pid)?.type] || null);
    if(typeof stripLagOnPassive==='function') stripLagOnPassive(s.links, _lagTypeOfPort);
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

export function getPortNodeId(pid)          {
    const p = String(pid || '');
    const cut = p.lastIndexOf('-');
    return cut > 0 ? p.slice(0, cut) : p;
}
export function isPortOnNode(pid,nodeId)    { return getPortNodeId(pid)===nodeId; }
export function getNodeByPortId(pid)        { return nodeById(getPortNodeId(pid)); }

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
    if(_isLeafEndpoint(other.type)) return 'endpoint';
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
export function getNodeDisplayName(n) {
    if(!n) return 'Unknown';
    return n.name||typeName(n.type)||n.id||'Unknown';
}

export function _ensureIpamState(){
    if(!state.ipam) state.ipam = { vlans:{} };
    if(!state.ipam.vlans || typeof state.ipam.vlans !== 'object') state.ipam.vlans = {};
    return state.ipam.vlans;
}

export function _ipamEntry(vid, create=false){
    const vlans = _ensureIpamState();
    const key = String(vid);
    if(!vlans[key] && create) vlans[key] = {};
    return vlans[key] || null;
}

// _parseIpv4Int, _parseCidrInfo, _ipInCidr sono ora in /lib/cidr.js
// (caricato come <script> prima di app.js, esposto come globali).

// F6 — memo IPAM per-frame. _renderFloorProps chiama _ipamUsageForVlan/_vlanIpamSummary
// per OGNI VLAN, e ognuna rifà _collectKnownIps()/_activeLeaseIps() (scan di TUTTI i nodi
// + lease). Con V VLAN il costo era ~O(V·nodi) a ogni resa. Durante UNA singola resa
// sincrona del pannello i nodi/lease non cambiano → si calcolano una volta sola. Il memo
// vive SOLO tra _ipamMemoBegin() e _ipamMemoEnd() (chiamate sincrone da _renderFloorProps)
// → nessuna staleness fuori dalla resa: le altre chiamate (Assistente AI, L3) girano con
// memo nullo e ricalcolano fresco.
let _ipamFrameMemo = null;
function _ipamMemoBegin(){ _ipamFrameMemo = { known:null, leases:null }; }
function _ipamMemoEnd(){ _ipamFrameMemo = null; }

function _collectKnownIps(){
    if(_ipamFrameMemo && _ipamFrameMemo.known) return _ipamFrameMemo.known;
    const seen = new Map();
    for(const n of state.nodes || []){
        const ips = [n.ip, n.integration?.host]
            .map(x => String(x||'').trim())
            .filter(Boolean);
        for(const ip of ips){
            if(_parseIpv4Int(ip) == null) continue;
            if(!seen.has(ip)) seen.set(ip, { ip, nodes:[] });
            seen.get(ip).nodes.push(getNodeDisplayName(n));
        }
    }
    const _res = [...seen.values()].sort((a,b)=>a.ip.localeCompare(b.ip, undefined, { numeric:true }));
    if(_ipamFrameMemo) _ipamFrameMemo.known = _res;
    return _res;
}

// IP dei lease DHCP ATTIVI in cache (store._dhcpLeases): scartati gli stale
// (isLeaseStale = G2, stesso criterio del Drift) e i duplicati. Alimentano
// l'occupazione IPAM (lib/ipam.js). Transitori, non persistiti.
function _activeLeaseIps(){
    if(_ipamFrameMemo && _ipamFrameMemo.leases) return _ipamFrameMemo.leases;
    const leases = Array.isArray(store._dhcpLeases) ? store._dhcpLeases : [];
    const out = [], seen = new Set();
    for(const l of leases){
        const ip = String((l && l.ip) || '').trim();
        if(!ip || seen.has(ip) || isLeaseStale(l)) continue;
        seen.add(ip);
        out.push(ip);
    }
    if(_ipamFrameMemo) _ipamFrameMemo.leases = out;
    return out;
}

export function _ipamUsageForVlan(vid){
    const entry = _ipamEntry(vid);
    const gateway = String(entry?.gateway || '').trim();
    const known = _collectKnownIps();
    // Motore puro (opzione A: documentati + solo-DHCP = realtà sul filo).
    const u = computeIpamUsage({
        subnet: entry?.subnet || '',
        gateway,
        documentedIps: known.map(x => x.ip),
        leaseIps: _activeLeaseIps(),
        parseCidr: _parseCidrInfo,
        ipInCidr: _ipInCidr,
    });
    // Dettaglio documentati con label (per il campione mostrato nella card).
    const usedDetailed = u.cidr ? known.filter(x => _ipInCidr(x.ip, u.cidr)) : [];
    return {
        hasData: !!(entry && Object.keys(entry).length),
        cidr: u.cidr,
        gateway,
        gatewayOk: u.gatewayOk,
        usedCount: u.usedCount,
        used: usedDetailed,
        sample: usedDetailed.slice(0,3),
        // Occupazione (lib/ipam.js): capacità, ripartizione, liberi, percentuale.
        capacity: u.capacity,
        documentedCount: u.documentedCount,
        dhcpOnlyCount: u.dhcpOnlyCount,
        freeCount: u.freeCount,
        pct: u.pct,
        leaseInCidr: u.leaseInCidr,
        dhcpOnly: u.dhcpOnly,
        nextFree: u.nextFree,        // «prossimo IP libero» (suggerimento IPAM / Assistente AI)
    };
}

// Lease "solo DHCP" di una VLAN come righe stile drift.undocumented, per il flusso
// Adotta dalla card IPAM (NON richiede una Verifica). Stessa base dell'ambra nella
// barra (usage.dhcpOnly = IP nel CIDR non documentati), mappata al lease per portare
// MAC + IP + hostname nell'adozione → il device adottato nasce già documentato (esce
// dall'ambra). Manual-first: sola lettura, nessun side-effect.
function _dhcpUndocumentedForVlan(vid){
    const usage = _ipamUsageForVlan(vid);
    const want = new Set(Array.isArray(usage.dhcpOnly) ? usage.dhcpOnly : []);
    if(!usage.cidr || !want.size) return [];
    const leases = Array.isArray(store._dhcpLeases) ? store._dhcpLeases : [];
    // Sulla VLAN di management un lease è infrastruttura (interfaccia di gestione),
    // non un endpoint → default 'infra' (switch/rack) invece di 'pc'/floor.
    const onMgmt = (state.mgmtVlans || []).map(String).includes(String(vid));
    const out = [], seen = new Set();
    for(const l of leases){
        const ip = String((l && l.ip) || '').trim();
        if(!want.has(ip) || isLeaseStale(l)) continue;
        const mac = normalizeMacAddress(String((l && l.mac) || ''));
        if(!mac || seen.has(mac)) continue; seen.add(mac);
        const host = String((l && l.hostname) || '').trim();
        out.push({
            key: `dhcp:${mac}`, sig: mac, mac, ip, hostname: host,
            label: host ? `${host} · ${ip}` : ip,
            cls: onMgmt ? 'infra' : 'endpoint',               // mgmt → infra; altrove un lease è quasi sempre un endpoint
            vlan: (l && l.vlan != null) ? l.vlan : (Number.isFinite(+vid) ? +vid : null),
        });
    }
    return out;
}

export function _vlanIpamSummary(vid){
    const entry = _ipamEntry(vid);
    const usage = _ipamUsageForVlan(vid);
    if(!entry && !usage.usedCount) return '';
    const parts = [];
    if(entry?.subnet) parts.push(entry.subnet);
    if(entry?.gateway) parts.push(`GW ${entry.gateway}`);
    if(entry?.dns) parts.push(`DNS ${entry.dns}`);
    if(usage.cidr && usage.capacity) parts.push(`${usage.usedCount}/${usage.capacity} IP`);
    else if(usage.usedCount) parts.push(`${usage.usedCount} IP`);
    if(!usage.cidr && entry?.subnet) parts.push('CIDR non valido');
    if(usage.cidr && !usage.gatewayOk) parts.push('gateway fuori subnet');
    return parts.join(' · ');
}
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

    // Mappa pid→element costruita una sola volta: evita N×2 querySelector per N cavi
    const pidMap={};
    document.querySelectorAll('[data-pid]').forEach(el=>{ pidMap[el.dataset.pid]=el; });

    // --- Cavi normali (stessa posizione logica) ---
    state.links.forEach(l=>{
        if(!shouldRenderLink(l)) return;
        const ends = _getLinkDrawEndpoints(l);
        if(!ends.src || !ends.dst) return;
        if(suppressRackOverlays && !l.wireless && (isRackPort(ends.src) || isRackPort(ends.dst))) return;
        // Nascondi il cavo se uno dei due nodi floor è fuori dalla VLAN filtro
        const _snId=getPortNodeId(ends.src), _dnId=getPortNodeId(ends.dst);
        if(_floorNodeHiddenByVlan(_snId)||_floorNodeHiddenByVlan(_dnId)) return;
        if(_filterVlan&&!_linkMatchesVlanFilter(l)) return;
        let src=pidMap[ends.src];
        let dst=pidMap[ends.dst];
        // Wireless + pannello rack nascosto (tab Proprietà): ancora il lato rack
        // all'icona del rack sul floor, così l'onda non scappa a sinistra.
        if(l.wireless && suppressRackOverlays){
            const sa=_wlRackIconAnchor(ends.src); if(sa) src=sa;
            const da=_wlRackIconAnchor(ends.dst); if(da) dst=da;
        }
        if(!src||!dst) return;                       // cross-rack: uno dei due manca → gestito sotto
        const sr=src.getBoundingClientRect(), dr=dst.getBoundingClientRect();
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
        // Toggle TRUNK (pillola legenda, solo topologia): i cavi trunk mostrati dal
        // toggle vanno EVIDENZIATI (glow/spessore .highlight) come in topologia — non
        // lasciati come cavo spento. shouldRenderLink ne governa già la VISIBILITÀ
        // (gated a topologia); qui ne allineiamo gli ATTRIBUTI a un cavo "acceso".
        const _trunkEmph = (typeof _topoTrunkOnly!=='undefined' && _topoTrunkOnly && _viewMode==='topology' && (typeof _linkIsTrunk==='function' ? _linkIsTrunk(l) : l.mode==='trunk'));
        const _emph = highPath.has(l.id) ? ' highlight' : isSelected ? ' sel' : (_trunkEmph ? ' highlight' : '');
        const cls=`cable${_amb}${_wl}${_emph}`;
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
        const _trunkEmphX = (typeof _topoTrunkOnly!=='undefined' && _topoTrunkOnly && _viewMode==='topology' && (typeof _linkIsTrunk==='function' ? _linkIsTrunk(l) : l.mode==='trunk'));
        const _emphX = isSelected ? ' sel' : (isTrace || _trunkEmphX) ? ' highlight' : '';
        cable.setAttribute('class',`cable-xrack${_ambX}${_emphX}`);
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

export function switchRightTab(tab){
    _propsTabHold = null;   // cambio tab esplicito → decade l'hold di selectPathSegment
    _rightTab = tab;
    // Cambiare tab verso Proprieta'/Assistente ABBANDONA un cavo in corso: la
    // rubber-band del link-mode (#temp-link) non deve restare come linea fantasma
    // sulla tela. Verso 'rack' il link-mode SOPRAVVIVE di proposito (serve per
    // completare i cavi floor->rack / cross-rack raggiungendo le porte del rack).
    if(tab !== 'rack' && store.linkStart && typeof _cancelLink === 'function') _cancelLink();
    const tabRack = document.getElementById('tab-rack');
    const tabProps = document.getElementById('tab-props');
    const tabAi = document.getElementById('tab-ai');   // 3ª tab «Assistente» (può mancare in HTML vecchio)
    tabRack.classList.toggle('active', tab==='rack');
    tabProps.classList.toggle('active', tab==='props');
    if(tabAi) tabAi.classList.toggle('active', tab==='ai');
    // a11y: role="tab" → aria-selected segue lo stato visivo.
    tabRack.setAttribute('aria-selected', String(tab==='rack'));
    tabProps.setAttribute('aria-selected', String(tab==='props'));
    if(tabAi) tabAi.setAttribute('aria-selected', String(tab==='ai'));
    document.getElementById('rack-viewport').style.display = tab==='rack' ? '' : 'none';
    // Il layer cavi (#cable-overlay, z-index 60) sta SOPRA il pannello destro
    // (#rack-view, 50) di proposito: sulla tab Rack i cavi cross-rack devono
    // poter raggiungere le porte del rack. Ma su Proprieta'/Assistente nessun
    // cavo deve finire sul pannello → lo alziamo sopra l'overlay, cosi' la
    // rubber-band del link-mode (che segue il cursore) non ci si disegna sopra.
    document.getElementById('rack-view').classList.toggle('rv-above-cables', tab !== 'rack');
    const pw = document.getElementById('props-panel-wrap');
    pw.classList.toggle('active', tab==='props');
    const aw = document.getElementById('ai-panel-wrap');
    if(aw) aw.classList.toggle('active', tab==='ai');
    // Tab Assistente: carica config + sincronizza empty-state/chat (glue app-ai.js,
    // bundle → chiamata bare con guardia typeof; no win.* sul ratchet).
    if(tab === 'ai' && typeof _aiPanelOpen === 'function') _aiPanelOpen();
    _updateFloorToolbarVisibility();
    renderCables();
    // INT-4: chi switcha a 'props' deve sempre vedere il pannello popolato.
    // INT-5: switchRightTab('props') = intent esplicito "voglio vedere".
    if(tab === 'props'){
        _propsExplicit = true;
        if(typeof renderProps === 'function') renderProps();
    }
}

// Hold legato alla SELEZIONE (non a tempo): selectPathSegment lo imposta al
// linkId del segmento quando l'utente sceglie un tratto che tocca una porta
// rack e l'app apre la tab Rack. Finche' QUEL link resta selezionato, i render
// (che richiamano sempre renderProps→_activatePropsTab) non devono ri-forzare
// 'props' — altrimenti la tab Rack si chiuderebbe da sola al primo re-render.
// L'hold decade da solo: cambio selezione (selId diverso) o switch tab
// esplicito (switchRightTab lo azzera).
store._propsTabHold = null;   // var: scritto da app-popup (selectPathSegment) e dal bundle render-core via win.*; bare-letto dai classic
export function _activatePropsTab(label){
    if(_propsTabHold && selType === 'link' && selId === _propsTabHold) return;
    _propsTabHold = null;   // selezione cambiata → l'hold decade
    if(_rightTab !== 'props') switchRightTab('props');
}

export function _clearPropsTab(){
}

function _resolveManualPropValue(sel){
    try{
        const oc = String(sel.getAttribute('onchange') || '');
        let m = oc.match(/updateN\('([^']+)',\s*this\.value\)/);
        if(m){
            const n = nodeById(selId);
            const key = m[1];
            // I campi device-specifici vivono in n.spec[key]: updateN ci salva il
            // valore e CANCELLA n[key]. Senza leggere prima lo spec, il valore
            // custom appena impostato non viene riconosciuto al re-render → la
            // select torna al default (bug "non riesco ad approvare il custom").
            const v = n ? ((n.spec && n.spec[key] !== undefined) ? n.spec[key] : n[key]) : undefined;
            if(v !== undefined && v !== null) return String(v);
        }
        m = oc.match(/updateIntegration\('([^']+)','([^']+)',\s*this\.value\)/);
        if(m){
            const n = nodeById(m[1]);
            const v = n?.integration?.[m[2]];
            if(v !== undefined && v !== null) return String(v);
        }
        m = oc.match(/setPortField\('([^']+)','([^']+)',\s*this\.value\)/);
        if(m){
            const v = state.ports?.[m[1]]?.[m[2]];
            if(v !== undefined && v !== null) return String(v);
        }
        m = oc.match(/setLinkProp\('([^']+)','([^']+)',\s*this\.value(?:\.trim\(\))?\)/);
        if(m){
            const l = (state.links || []).find(x=>x.id===m[1]);
            const v = l ? l[m[2]] : undefined;
            if(v !== undefined && v !== null) return String(v);
        }
    }catch(_){}
    return String(sel.value ?? '');
}

function _runInlineOnChange(el, inlineCode){
    const code = String(inlineCode || el.getAttribute('onchange') || '').trim();
    if(!code) return;
    try { new Function(code).call(el); }
    catch(err){ console.warn('[props-manual]', err?.message || err); }
}

export function _enableManualValueInProps(panel){
    if(!panel) return;
    const selects = [...panel.querySelectorAll('select')];
    selects.forEach(sel=>{
        if(sel.multiple) return;
        if(sel.dataset.noManual === '1') return;
        if(sel.dataset.manualEnhanced === '1') return;
        sel.dataset.manualEnhanced = '1';

        const originalChange = sel.getAttribute('onchange') || '';
        const customToken = '__custom_manual__';
        let customOpt = [...sel.options].find(o=>o.value===customToken);
        if(!customOpt){
            customOpt = document.createElement('option');
            customOpt.value = customToken;
            customOpt.textContent = (typeof t==='function') ? t('common.custom') : 'Personalizzato...';
            sel.appendChild(customOpt);
        }

        const fromState = _resolveManualPropValue(sel).trim();
        if(fromState && fromState !== customToken){
            let existing = [...sel.options].find(o=>o.value===fromState);
            if(!existing){
                existing = document.createElement('option');
                existing.value = fromState;
                existing.textContent = fromState;
                existing.dataset.custom = '1';
                sel.insertBefore(existing, customOpt);
            }
            sel.value = fromState;
            sel.dataset.prevValue = fromState;
        } else {
            sel.dataset.prevValue = sel.value || '';
        }

        sel.addEventListener('focus',()=>{ sel.dataset.prevValue = sel.value || ''; });
        sel.addEventListener('change',()=>{
            if(sel.value !== customToken){
                sel.dataset.prevValue = sel.value || '';
                return;
            }
            const prev = sel.dataset.prevValue || '';
            showPrompt('Inserisci valore personalizzato', prev, (val)=>{
                const manual = String(val || '').trim();
                if(!manual){ sel.value = prev; return; }
                let opt = [...sel.options].find(o=>o.value===manual);
                if(!opt){
                    opt = document.createElement('option');
                    opt.value = manual;
                    opt.textContent = manual;
                    opt.dataset.custom = '1';
                    sel.insertBefore(opt, customOpt);
                }
                sel.value = manual;
                sel.dataset.prevValue = manual;
                _runInlineOnChange(sel, originalChange);
            }, ()=>{
                sel.value = prev;
            });
        });
    });
}

function updateN(k,v){
    const n=nodeById(selId); if(!n) return;
    const _auditOldName=(k==='name') ? String(n.name||'') : null;
    const fixedRackLabel=_fixedRackLabel(n.type);
    if(n.type==='wallport'&&k==='ports') v=1;
    if(n.type==='blankpanel'&&k==='ports') v=0;
    if(n.type==='cablemanager'&&k==='ports') v=0;
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
    // Tipo scelto a mano = pinnato (manual-first): Discovery/Verifica non lo ricambiano.
    if(k==='type') n.typeManual = true;
    if(k==='name' && _auditOldName!=null && v && String(v)!==_auditOldName){
        logAudit('device-rename', { target:String(v), summary:_auditOldName?((typeof t==='function')?t('audit.wasNamed',{name:_auditOldName}):`era «${_auditOldName}»`):'' });
    }
    // Aggiornato un identificatore di un endpoint foglia → ritenta l'auto-link
    // (es. ho appena incollato il MAC su una presa/AP/UPS).
    if((k==='mac'||k==='ip'||k==='hostname') && _isLeafEndpoint(n.type)){
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
        const cnt = Math.max(0, Math.min(24, parseInt(v, 10) || 0));
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
            const pid = `${n.id}-mgmt${i}`;
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
    renderAll(); markDirty();
}
function updateFloorId(value){
    const n=nodeById(selId); if(!n) return;
    n.name=value.trim()||n.name||n.type;
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
function deleteLink(id){
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
    // Aggiorna lo stato iniziale del pulsante Topologia (default: 'stale' = no cache)
    _refreshTopoBtnState();
    // Check periodico ogni 60s per disabilitare il pulsante quando la cache scade
    setInterval(_refreshTopoBtnState, 60 * 1000);
}

// ============================================================
// EXPOSE — tutte le funzioni top-level del nucleo su window, come quando
// app.js era un classic script (handler inline onclick, export.js classico,
// e gli altri moduli del bundle le leggono via win.*). Nessuna collisione.
// ============================================================
expose({
  _activatePropsTab, _bindDraggablePanel, _buildDefaultState, _cableAutoLabel, _chainAmbiguousLinkIds, _chainVlanColors,
  _clampFloatingPanel, _clearDirty, _clearPropsTab, _collectKnownIps, _createLinkRecord,
  _deviceHasWifi, _dispName, _enableManualValueInProps, _endPopupDrag, _ensureIpamState, _expandLagMemberLinks,
  _getLinkPhysicalView, _getPassThroughMode, _getUiModeMeta,
  _idPrefixForType, _invalidateIdx, _dhcpUndocumentedForVlan, _ipamEntry, _ipamMemoBegin, _ipamMemoEnd, _ipamUsageForVlan, _isInteractiveDragTarget, _isLinearPassThroughPort,
  _isRadioPid, _isValidProjectPortId, _isWifiCapable,
  _linksForPort, _loadDefaultLocal, _makeFloatingPanel, _migrateState, _movePopupDrag,
  _nextNodeId, _nodeRadios, _normalizeProjectNodeIds,
  _paletteTypeLabel, _patchPanelChainOptions, _patchPanelOffset, _portNumForLabel, _promoteLinkToManual, _propagateStackMasterIntegration,
  _rackDeviceBg, _radioCountOf, _radioPid, _rebuildIdx, _renderCablesNow, _renderModeIndicator,
  _repairRackPlacements, _resetSelection, _resolveManualPropValue, _runInlineOnChange, _sanitizeProjectConnectivity,
  _showToast, _startPopupDrag, _toggleArrayField, _updateHistoryBtns, _validateWallPortConnection, _vlanIpamSummary,
  _wallPortConnectionRole, _wallPortHasRole, _wlRackIconAnchor, applyStaticI18n, bindEventsOnce, canAddConnection,
  checked, clampRackDevice, deleteLink, deleteNode, getNodeByPortId,
  getNodeDisplayName, getNodePortCount, getNodeRackSize, getPortConnectionCount, getPortMaxConnections, getPortNodeId,
  getRackById, getRackName, getRackSize, getWallPortLabel,
  init, initDraggablePopups, isPortOnNode, isRackTopNumbered, logAudit, markDirty,
  nodeById, promoteLinkToManual, pushHistory,
  rackUToVisible, registerModuleNav, removeNodePorts, renderCables, selected, setCableLabel,
  setDeviceWifi, setLinkProp, setLinkWireless, setNodeRadioCount, switchRightTab,
  toggleAbbrevNames, toggleNodeLock, updateFloorId, updateFrontPanel, updateN,
  updateP, updateWallPortId, visibleUToRackU,
});

window.onload = init;
