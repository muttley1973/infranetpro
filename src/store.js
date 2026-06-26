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
]);
