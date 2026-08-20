// ============================================================
// STORE — boundary unico per lo STATO MUTABILE condiviso (ex win.*)
//                                       [ritiro ponte 2.0, fase 3 — vedi D18]
// ------------------------------------------------------------
// I globali mutabili/RIASSEGNATI (state, selId, selType, …) non si possono
// ritirare con un `import { state }`: un binding ESM non è riassegnabile e
// `win.state` viene RIASSEGNATO a ogni load progetto (app-core.js:
// `store.state = _migrateState(proj.state)`). Qui vivono come coppie
// getter/setter che PROXANO window: i moduli src/ usano `store.X`, mentre il
// classic export.js e gli onclick="" continuano a leggere `window.X` — che il
// setter tiene VIVO. Una sola cella di verità (window.X) finché anche i classic
// non migrano; behavior-identico al vecchio `win.X` (pura rinomina).
//
// NB: NON mettere qui le FUNZIONI (selected/checked/_propsSectionIsOpen sono
// helper di rendering, non stato — vanno sul binario "ritiro funzioni").
// ============================================================
import { win } from './_bridge.js';

// Genera una coppia get/set che proxa window[name] per ogni simbolo di stato.
function proxy(names) {
    const o = {};
    for (const name of names) {
        Object.defineProperty(o, name, {
            enumerable: true,
            get() { return win[name]; },
            set(v) { win[name] = v; },
        });
    }
    return o;
}

export const store = proxy([
    // ── selezione + documento ────────────────────────────────────────────────
    // selVmId: 2o livello di selezione per lo scope 'vm' (la VM non e' un nodo del
    // progetto — vive in host.vms[]). selId resta l'HOST, cosi' l'evidenziazione a
    // schermo e tutto cio' che risolve nodeById(selId) continuano a funzionare.
    'state', 'selId', 'selType', 'selVmId', 'dragNode', 'currentProjectId',
    // ── interazioni canvas / cablaggio ───────────────────────────────────────
    'linkStart', 'highPath', 'lagSelPorts', '_focusedLagPorts',
    // ── viste topologia / discovery ──────────────────────────────────────────
    '_viewMode', '_topoData', '_topoVisible', '_topoNeighborsCache',
    '_topoFdbCache', '_discResults', '_driftReport', '_dhcpLeases', '_filterVlan',
    '_rackCollapsed', '_spareActive', '_topoTrunkMode',
    // ── popup / sessione UI ──────────────────────────────────────────────────
    '_lastPopPid', '_lastPopX', '_lastPopY', '_currentUser',
    // ── coda-stato di INTERAZIONE (ritiro ponte 2026-07-11) ───────────────────
    // Stato transitorio di gesture/modalità: drag device/rack, selezione LAG,
    // discovery in corso/import, editor cavo-da-spezzare, IPAM-VLAN aperti. Tutti
    // falsy/vuoti al render iniziale → golden invariante. La cella di verità resta
    // window.X (per i bare-global self-ref in app.js e i writer classic).
    'dragOffset', 'dragRack', '_dragArmed', 'lagSelMode',
    '_discRunning', '_discImporting', '_discSelMap', '_routingLinkId', '_prefixOpen',
    '_netsBad',
    // ── coda-stato di INTERAZIONE, 2º giro (ritiro ponte 2026-07-11) ──────────
    // Altri flag/cache di gesture/vista: resize, pan floor/rack, spazio-premuto,
    // punto-mouse-down, hover-rack, tab-hold props, click-porta-floor, traccia fisica,
    // props-esplicito, tab destra, sync-SNMP in corso, toggle nascondi-topo,
    // cache FDB-VLAN topo, mappa-tipo discovery, gruppo-LAG focalizzato.
    'resizeNode', 'isPanningFloor', 'isPanningRack', 'rackPanStart', '_spaceDown',
    '_dragDownPt', '_hoverRackId', '_propsTabHold', '_floorPortClick',
    '_physicalTraceActive', '_propsExplicit', '_rightTab', '_snmpSyncing',
    '_topoHideEndpoints', '_topoMedium', '_topoFdbVlanCache', '_discTypeMap',
    '_focusedLagGroup', '_topoArpCache', '_topoNdCache', '_topoWifiIfsCache', '_topoWifiNbrCache',
    // ── coda-stato di INTERAZIONE, 3º giro (ritiro ponte 2026-07-11) ──────────
    // Storia undo/redo, flag dirty, rilevamento doppio-click manuale (rack/floor/
    // porta), drag/pan libreria, timer tooltip topo, link-appena-iniziato.
    'panStart', '_linkJustStarted', '_topoTipTimer', '_history', '_histIdx',
    '_rackPortDblPid', '_rackPortDblTime', '_rackFloorDblId', '_rackFloorDblTime',
    '_rackDblId', '_rackDblTime', '_paletteDragType', '_isDirty', '_dragModalState',
]);

export function resetProjectRuntime() {
    store.selId = null;
    store.selType = null;
    store.selVmId = null;
    if (store.highPath && typeof store.highPath.clear === 'function') store.highPath.clear();
    else store.highPath = new Set();
    store.linkStart = null;
    store.dragNode = null;
    store.dragRack = null;
    // ⚠️ La TOPOLOGIA è runtime di progetto e si spegne al cambio: i suoi dati
    // sono di quel progetto. La DASHBOARD no — è una preferenza locale che
    // sopravvive al cambio progetto (src/app-overview.js `_saveView`), e i suoi
    // numeri si ricalcolano dal documento nuovo. Demuoverla a 'map' faceva
    // divergere il flag dal <body>, che resta in `view-overview`: da lì
    // `renderOverview` usciva subito (guardia su `_viewMode`) e la Dashboard
    // restava ferma a com'era PRIMA che il progetto arrivasse — al caricamento
    // dichiarava «la rete è ancora vuota» su un documento pieno, e al cambio
    // progetto mostrava i numeri di quello precedente (audit 2026-08-20, C4).
    store._viewMode = (store._viewMode === 'overview') ? 'overview' : 'map';
    store._topoData = null;
    store._topoVisible = false;
    store._topoNeighborsCache = {};
    store._topoFdbCache = {};
    store._topoFdbVlanCache = {};
    store._topoArpCache = {};
    store._topoNdCache = {};
    store._topoWifiIfsCache = {};
    store._topoWifiNbrCache = {};
    store._discResults = [];
    store._discSelMap = {};
    store._discTypeMap = {};
    store._driftReport = null;
    store._filterVlan = null;
    store._topoTrunkMode = 'all';
    store._topoHideEndpoints = false;
    store._topoMedium = 'all';
    store._physicalTraceActive = false;
    store._snmpSyncing = false;
    // Righe-rete espanse (chiave = CIDR normalizzato): stato di INTERAZIONE, come
    // sopra. Vuoto al render iniziale → il golden non lo vede.
    if (store._prefixOpen && typeof store._prefixOpen.clear === 'function') store._prefixOpen.clear();
    else store._prefixOpen = new Set();
    // Quello che l'utente ha scritto nel campo «Reti» e che non e' una rete: resta
    // a schermo, in rosso, finche' non lo corregge. Stato di INTERAZIONE, vuoto al
    // render iniziale → il golden non lo vede.
    store._netsBad = '';
}
