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
    'state', 'selId', 'selType', 'dragNode', 'currentProjectId',
    // ── interazioni canvas / cablaggio ───────────────────────────────────────
    'linkStart', 'highPath', 'lagSelPorts', '_focusedLagPorts',
    // ── viste topologia / discovery ──────────────────────────────────────────
    '_viewMode', '_topoData', '_topoVisible', '_topoNeighborsCache',
    '_topoFdbCache', '_discResults', '_driftReport', '_dhcpLeases', '_filterVlan',
    '_rackCollapsed', '_spareActive', '_topoTrunkOnly',
    // ── popup / sessione UI ──────────────────────────────────────────────────
    '_lastPopPid', '_lastPopX', '_lastPopY', '_currentUser',
    // ── coda-stato di INTERAZIONE (ritiro ponte 2026-07-11) ───────────────────
    // Stato transitorio di gesture/modalità: drag device/rack, selezione LAG,
    // discovery in corso/import, editor cavo-da-spezzare, IPAM-VLAN aperti. Tutti
    // falsy/vuoti al render iniziale → golden invariante. La cella di verità resta
    // window.X (per i bare-global self-ref in app.js e i writer classic).
    'dragOffset', 'dragRack', '_dragArmed', 'lagSelMode',
    '_discRunning', '_discImporting', '_discSelMap', '_routingLinkId', '_vlanIpamOpen',
    // ── coda-stato di INTERAZIONE, 2º giro (ritiro ponte 2026-07-11) ──────────
    // Altri flag/cache di gesture/vista: resize, pan floor/rack, spazio-premuto,
    // punto-mouse-down, hover-rack, tab-hold props, click-porta-floor, traccia fisica,
    // props-esplicito, tab destra, sync-SNMP in corso, toggle nascondi-topo,
    // cache FDB-VLAN topo, mappa-tipo discovery, gruppo-LAG focalizzato.
    'resizeNode', 'isPanningFloor', 'isPanningRack', 'rackPanStart', '_spaceDown',
    '_dragDownPt', '_hoverRackId', '_propsTabHold', '_floorPortClick',
    '_physicalTraceActive', '_propsExplicit', '_rightTab', '_snmpSyncing',
    '_topoHideEndpoints', '_topoHideWireless', '_topoFdbVlanCache', '_discTypeMap',
    '_focusedLagGroup', '_topoArpCache', '_topoNdCache',
    // ── coda-stato di INTERAZIONE, 3º giro (ritiro ponte 2026-07-11) ──────────
    // Storia undo/redo, flag dirty, rilevamento doppio-click manuale (rack/floor/
    // porta), drag/pan libreria, timer tooltip topo, link-appena-iniziato.
    'panStart', '_linkJustStarted', '_topoTipTimer', '_history', '_histIdx',
    '_rackPortDblPid', '_rackPortDblTime', '_rackFloorDblId', '_rackFloorDblTime',
    '_rackDblId', '_rackDblTime', '_paletteDragType', '_isDirty', '_dragModalState',
]);
