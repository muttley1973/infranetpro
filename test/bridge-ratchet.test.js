'use strict';
// ============================================================
// CRICCHETTO DEL PONTE window (ritiro incrementale — epic #23)
// ============================================================
// La migrazione ESM ha spostato la glue in src/, ma il RUNTIME resta in parte
// globale: i moduli leggono i legacy via win.* (il "ponte" di _bridge.js). Il
// debito vero è quel ponte. Questi guard lo rendono MONOTONO:
//   1) i simboli GIÀ ritirati non possono tornare a essere letti dal ponte;
//   2) il numero totale di letture win.* può solo CALARE (cap a cricchetto).
// Quando converti altri simboli a import ESM, abbassa MAX_WIN_REFS al nuovo
// valore stampato dal test (ricetta di ritiro del ponte).
//
// ── ⏸️ MIGRAZIONE SOSPESA (decisione 2026-07-14) ─────────────────────────────
// Il ritiro del ponte è PARCHEGGIATO come task "a tempo perso" (NON abbandonato).
// Questi cricchetti RESTANO come guardia ANTI-REGRESSIONE (il conteggio può solo
// TENERE o CALARE, mai crescere), ma ABBASSARLI NON è più un obiettivo attivo:
// abbassa un cap solo OPPORTUNISTICAMENTE, se tocchi comunque quel modulo. Un
// cricchetto fermo al valore attuale è ATTESO e OK. Vedi ARCHITECTURE.md §10.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js'));

// Conta le occorrenze di un pattern nel CODICE (commenti // e /* */ esclusi),
// così le note che citano win.* non falsano il cricchetto.
function countInCode(re, exceptFile) {
  let n = 0;
  for (const f of files) {
    if (exceptFile && f === exceptFile) continue;
    const raw = fs.readFileSync(path.join(SRC, f), 'utf8');
    const code = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    n += (code.match(re) || []).length;
  }
  return n;
}

// ── 1) Simboli ritirati: niente ricadute sul ponte ──────────────────────────
// Estratti nel modulo foglia src/app-util.js e ora IMPORTATI: nessun modulo deve
// tornare a leggerli da win.*. (Le occorrenze nei template inline onclick="" sono
// BARE e risolvono a window via expose() — non sono `win.X`, quindi non contano.)
const RETIRED = ['escapeHTML', 'uid', 'hexToRgba', '_shadeHex',
  'normalizeStatus', 'normalizeNumber', 'normalizeMacAddress'];
test('ponte: i simboli migrati non sono più letti da win.*', () => {
  for (const sym of RETIRED) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'));
    assert.equal(viaWin, 0,
      `win.${sym} è tornato nel codice src/: importa { ${sym} } from "./app-util.js"`);
  }
});

// ── 1c) COSTANTI ritirate: importate, non più lette dal ponte ────────────────
// Fase 1 ritiro ponte 2.0 (2026-06-21): TYPES era una COSTANTE su win.TYPES letta
// da 26 moduli → ora `export const TYPES` in app-types.js + `import { TYPES }` nei
// consumatori. Resta su window.TYPES via expose() per i classic (export.js, lib a
// runtime) + eventuali onclick="" bare. Nessun modulo src/ deve leggerla via win.*.
const RETIRED_CONST = ['TYPES'];
test('ponte: le costanti migrate non sono più lette da win.*', () => {
  for (const sym of RETIRED_CONST) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'));
    assert.equal(viaWin, 0,
      `win.${sym} è tornato nel codice src/: importa { ${sym} } from "./app-types.js"`);
  }
});

// ── 1b) Funzioni del NUCLEO (app.js) con CHIAMATE ritirate ───────────────────
// Esportate dal modulo-definitore app.js e ora IMPORTATE dai consumatori: nessuno
// deve più CHIAMARLE via ponte (`win.X(`). NB: restano lecite le guardie difensive
// `typeof win.X === 'function'` (lette dal ponte ma non chiamate) — verranno tolte
// in un giro dedicato; per ora sono ridondanti ma innocue (l'import garantisce X).
const CALLS_RETIRED = ['nodeById', 'markDirty', 'getNodeByPortId', 'getPortNodeId',
  'getNodeDisplayName', 'pushHistory', 'renderCables', '_showToast',
  '_invalidateIdx', 'switchRightTab',
  // Fase 2 ritiro ponte 2.0 (2026-06-21): batch di 6 funzioni ad alto conteggio,
  // ognuna con un solo modulo-definitore (export function) + import nei consumatori.
  // Restano sul ponte SOLO come non-chiamate (guardie typeof, value-pass in
  // requestAnimationFrame, alias-block in app-properties-node) → giro dedicato.
  'renderAll', 'renderProps', '_buildDeviceBrandModelPreview',
  'showAlert', 'renderTopoOverlay', 'propagateVlans'];
test('ponte: le funzioni del nucleo non sono più CHIAMATE via win.*', () => {
  for (const sym of CALLS_RETIRED) {
    const calls = countInCode(new RegExp('\\bwin\\.' + sym + '\\s*\\(', 'g'));
    assert.equal(calls, 0,
      `win.${sym}( è tornata: importa { ${sym} } from "./app.js" e chiama bare ${sym}(`);
  }
});

// ── 1d) STATO mutabile ritirato: solo store.js può proxarlo da win.* ─────────
// Fase 3 ritiro ponte 2.0 (2026-06-21): i globali mutabili/RIASSEGNATI (state,
// selId, selType, …) non sono import-abili (un binding ESM non si riassegna,
// `win.state` sì a ogni load) → vivono dietro src/store.js come coppie
// getter/setter che proxano window. I consumatori usano `store.X`; SOLO store.js
// può ancora nominare `win.X` (la cella di verità resta window.X per i classic).
// Vedi la decisione D18 (store.js, ritiro del ponte window).
const RETIRED_STATE = ['state', 'selId', 'selType', 'dragNode', 'currentProjectId',
  'linkStart', 'highPath', 'lagSelPorts', '_focusedLagPorts', '_viewMode',
  '_topoData', '_topoVisible', '_topoNeighborsCache', '_topoFdbCache',
  '_discResults', '_driftReport', '_dhcpLeases', '_filterVlan', '_rackCollapsed', '_spareActive',
  '_topoTrunkOnly', '_lastPopPid', '_lastPopX', '_lastPopY', '_currentUser',
  // Coda-stato di INTERAZIONE (ritiro ponte 2026-07-11): stato transitorio di
  // gesture/modalità, ora proxato da store.js come gli altri. Vedi store.js.
  'dragOffset', 'dragRack', '_dragArmed', 'lagSelMode',
  '_discRunning', '_discImporting', '_discSelMap', '_routingLinkId', '_vlanIpamOpen',
  // Coda-stato di INTERAZIONE, 2º giro (ritiro ponte 2026-07-11).
  'resizeNode', 'isPanningFloor', 'isPanningRack', 'rackPanStart', '_spaceDown',
  '_dragDownPt', '_hoverRackId', '_propsTabHold', '_floorPortClick',
  '_physicalTraceActive', '_propsExplicit', '_rightTab', '_snmpSyncing',
  '_topoHideEndpoints', '_topoHideWireless', '_topoFdbVlanCache', '_discTypeMap',
  '_focusedLagGroup',
  // Coda-stato di INTERAZIONE, 3º giro (ritiro ponte 2026-07-11).
  'panStart', '_linkJustStarted', '_topoTipTimer', '_history', '_histIdx',
  '_rackPortDblPid', '_rackPortDblTime', '_rackFloorDblId', '_rackFloorDblTime',
  '_rackDblId', '_rackDblTime', '_paletteDragType', '_isDirty', '_dragModalState'];
test('ponte: lo stato condiviso è letto solo via store.js (non win.* nei consumatori)', () => {
  for (const sym of RETIRED_STATE) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'), 'store.js');
    assert.equal(viaWin, 0,
      `win.${sym} fuori da store.js: usa store.${sym} (import { store } from "./store.js")`);
  }
});

// ── 1e) BUILDER del pannello proprietà ritirati (funzioni, import) ───────────
// Ritiro ponte 2026-07-10 (binario funzioni): i builder condivisi definiti in
// app-properties.js (`_propsSectionIsOpen`, `_buildInventoryFieldsHtml`,
// `_buildNetAccessHtml`) sono `export function` + `import` negli 8 consumatori;
// nessuno li chiama più via win.*. Restano in expose() per i classic (nessuno oggi).
const RETIRED_BUILDERS = ['_propsSectionIsOpen', '_buildInventoryFieldsHtml', '_buildNetAccessHtml'];
test('ponte: i builder del pannello proprietà non sono più letti da win.*', () => {
  for (const sym of RETIRED_BUILDERS) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'));
    assert.equal(viaWin, 0,
      `win.${sym} è tornato: importa { ${sym} } from "./app-properties.js"`);
  }
});

// ── 1f) HELPER option-selected/checked ritirati (funzioni, import) ────────────
// Ritiro ponte 2026-07-10: `selected(v,o)` e `checked(v)` (helper che rendono
// l'attributo selected/checked negli <option>/<input> generati) sono `export
// function` in app.js + `import` nei builder dei pannelli device; usati solo in
// interpolazioni build-time ${selected(...)}, mai negli handler inline. Restano in
// expose() per i classic.
const RETIRED_HELPERS = ['selected', 'checked'];
test('ponte: gli helper option-selected/checked non sono più letti da win.*', () => {
  for (const sym of RETIRED_HELPERS) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'));
    assert.equal(viaWin, 0,
      `win.${sym} è tornato: importa { ${sym} } from "./app.js"`);
  }
});

// ── 1g) Funzioni del nucleo (app.js) ritirate del tutto (reads + calls) ──────
// Ritiro ponte 2026-07-10 (binario funzioni, 2º giro): `_linksForPort`, `_nextNodeId`,
// `_nodeRadios`, `_isRadioPid`, `logAudit` — `export function` in app.js + `import`
// nei consumatori; convertite TUTTE le occorrenze `win.X` (chiamate E guardie typeof).
// Restano in expose() per i classic. A differenza di CALLS_RETIRED qui il ponte è a 0.
const RETIRED_CORE_FN = ['_linksForPort', '_nextNodeId', '_nodeRadios', '_isRadioPid', 'logAudit'];
test('ponte: le funzioni del nucleo del 2º giro non sono più lette da win.*', () => {
  for (const sym of RETIRED_CORE_FN) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'));
    assert.equal(viaWin, 0,
      `win.${sym} è tornato: importa { ${sym} } from "./app.js"`);
  }
});

// ── 1h) Funzioni-nucleo della 9ª sessione: chiuse anche le letture-non-chiamata ─
// Ritiro ponte 2026-07-10: le 10 funzioni ritirate come CHIAMATE nella 9ª (vedi
// CALLS_RETIRED) avevano ancora letture-non-chiamata residue (guardie `typeof win.X`,
// value-pass). Convertite tutte a bare (le import erano già presenti); ora il ponte è
// a 0 anche per queste. `_bridge.js` è escluso (definizione del ponte).
const RETIRED_CORE_FN0 = ['nodeById', 'markDirty', 'getNodeByPortId', 'getPortNodeId',
  'getNodeDisplayName', 'pushHistory', 'renderCables', '_showToast', '_invalidateIdx',
  'switchRightTab'];
test('ponte: le funzioni-nucleo della 9ª non hanno più letture win.* (fuori da _bridge.js)', () => {
  for (const sym of RETIRED_CORE_FN0) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'), '_bridge.js');
    assert.equal(viaWin, 0,
      `win.${sym} fuori da _bridge.js: importa { ${sym} } from "./app.js"`);
  }
});

// ── 1i) Funzioni rack/zoom/search ritirate del tutto (reads + calls) ─────────
// Ritiro ponte 2026-07-11: le 6 funzioni definite in app-search-zoom-rack.js
// (`toggleRackPanel`, `switchRack`, `renderRackTabs`, `focusNode`, `updateTransforms`,
// `ensureNodeRackVisible`) sono `export function` + `import` nei 10 consumatori;
// convertite TUTTE le occorrenze win.X (chiamate E guardie typeof). ASSE B ha poi
// ritirato del tutto toggleRackPanel/switchRack anche dagli handler inline (→ data-act/
// data-change, event delegation): non più in expose() né bare nell'HTML. Questo test
// resta valido: verifica solo che nessun win.X sia tornato nei sorgenti src/.
const RETIRED_RACK_FN = ['toggleRackPanel', 'switchRack', 'renderRackTabs',
  'focusNode', 'updateTransforms', 'ensureNodeRackVisible'];
test('ponte: le funzioni rack/zoom/search non sono più lette da win.*', () => {
  for (const sym of RETIRED_RACK_FN) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'));
    assert.equal(viaWin, 0,
      `win.${sym} è tornato: importa { ${sym} } from "./app-search-zoom-rack.js"`);
  }
});

// ── 1j) Funzioni foglia UI/vlan/popup ritirate del tutto (reads + calls) ─────
// Ritiro ponte 2026-07-11: 8 helper foglia definiti in 3 moduli — VLAN
// (`_effPortVlan`, `_getLinkTrunk`, `_ensureVlanColor` in app-vlan-autopoll.js),
// porte (`_portDisplayName`, `portTip` in app-ports.js) e popup (`showPop`,
// `closePop`, `_applyViewMode` in app-popup.js) — sono `export function` + `import`
// nei 14 consumatori (merge negli import esistenti dove presenti). Convertite TUTTE
// le win.X. Restano in expose() per i classic (export.js legge _effPortVlan/_getLinkTrunk).
const RETIRED_LEAF_FN = ['_effPortVlan', '_getLinkTrunk', '_ensureVlanColor',
  '_portDisplayName', 'portTip', 'showPop', 'closePop', '_applyViewMode'];
test('ponte: gli helper foglia UI/vlan/popup non sono più letti da win.*', () => {
  for (const sym of RETIRED_LEAF_FN) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'));
    assert.equal(viaWin, 0,
      `win.${sym} è tornato: importa { ${sym} } dal suo modulo definitore`);
  }
});

// ── 1k) Funzioni nucleo/tipi/autolink ritirate del tutto (reads + calls) ─────
// Ritiro ponte 2026-07-11: 5 funzioni del nucleo (`_renderModeIndicator`,
// `_promoteLinkToManual`, `_createLinkRecord`, `getRackById`, `canAddConnection` in
// app.js) + `_ensureNodeSpec` (app-types.js) + `_isLeafEndpoint` (app-autolink.js)
// sono `export function` + `import` nei consumatori; convertite TUTTE le win.X.
// Restano in expose() per i classic (export.js legge getRackById).
const RETIRED_CORE_FN2 = ['_renderModeIndicator', '_promoteLinkToManual',
  '_createLinkRecord', 'getRackById', 'canAddConnection', '_ensureNodeSpec', '_isLeafEndpoint'];
test('ponte: le funzioni nucleo/tipi/autolink non sono più lette da win.*', () => {
  for (const sym of RETIRED_CORE_FN2) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'));
    assert.equal(viaWin, 0,
      `win.${sym} è tornato: importa { ${sym} } dal suo modulo definitore`);
  }
});

// ── 1l) Funzioni topo/discovery/vlan/snmp ritirate del tutto (reads + calls) ─
// Ritiro ponte 2026-07-11: 10 funzioni di 6 moduli — topologia (`_findPortByIfName`,
// `_restoreTopoSession` in app-topology-discover.js; `_renderTopoLegend` in
// app-topology-overlay.js), discovery (`_discVendorFromMac`, `_discIndexNode` in
// app-discovery-classify.js), interazione (`trace` in app-pointer.js), VLAN
// (`_parseTrunkVlans`, `_isVoiceVlan` in app-vlan-autopoll.js), autolink
// (`_autoLinkDiagText`) e SNMP (`_snmpFreshness`) — `export function` + `import` nei
// consumatori; convertite TUTTE le win.X. Restano in expose() (export.js legge
// _parseTrunkVlans). `trace` è nome corto ma senza binding locale in conflitto (verificato).
const RETIRED_MISC_FN = ['_findPortByIfName', '_restoreTopoSession', '_discVendorFromMac',
  '_discIndexNode', 'trace', '_parseTrunkVlans', '_isVoiceVlan', '_renderTopoLegend',
  '_autoLinkDiagText', '_snmpFreshness'];
test('ponte: le funzioni topo/discovery/vlan/snmp non sono più lette da win.*', () => {
  for (const sym of RETIRED_MISC_FN) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'));
    assert.equal(viaWin, 0,
      `win.${sym} è tornato: importa { ${sym} } dal suo modulo definitore`);
  }
});

// ── 1m) Funzioni getter/label/props/disc ritirate del tutto (reads + calls) ──
// Ritiro ponte 2026-07-11: 11 funzioni — getter di app.js (`getWallPortLabel`,
// `getRackName`, `getPortMaxConnections`, `_clearDirty`, `_patchPanelOffset`),
// `_findFreeU` (app-topology-crawl.js), `_autoLinkEndpoint` (app-autolink.js),
// `_frontPanelPortLabel` (app-types.js), `_buildPropsHeader` (app-properties.js),
// `_discIdentitySource`/`_discFindExistingDevice` (app-discovery-classify.js). `export
// function` + `import` nei consumatori. Trappola alias-block (app-properties-node.js:
// `_buildPropsHeader = win._buildPropsHeader`/`_patchPanelOffset = win._patchPanelOffset`)
// risolta rimuovendo i declaratori e importando (3ª ricorrenza dell'epic). Restano in
// expose() (export.js legge _autoLinkEndpoint via lib/drift-adopt). app-csv-import.js ha
// perso l'ultimo win → PRIMO modulo senza import `win` dal ponte.
const RETIRED_GETTER_FN = ['getWallPortLabel', 'getRackName', 'getPortMaxConnections',
  '_clearDirty', '_patchPanelOffset', '_findFreeU', '_autoLinkEndpoint',
  '_frontPanelPortLabel', '_buildPropsHeader', '_discIdentitySource', '_discFindExistingDevice'];
test('ponte: le funzioni getter/label/props/disc non sono più lette da win.*', () => {
  for (const sym of RETIRED_GETTER_FN) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'));
    assert.equal(viaWin, 0,
      `win.${sym} è tornato: importa { ${sym} } dal suo modulo definitore`);
  }
});

// ── 1n) Funzioni disc/props/vlan/hv ritirate del tutto (reads + calls) ───────
// Ritiro ponte 2026-07-11: 13 funzioni — discovery-index (`_discBuildExistingIndexes`,
// `_discTouchNodeIdentity`), `selectAndFocusNode` (app-search-zoom-rack.js), `rackUPx`
// (app-render-core.js), core-props (`_getLinkPhysicalView`, `_enableManualValueInProps`,
// `_activatePropsTab` in app.js), VLAN (`_siteNativeVlan`, `_runActiveAnchor`),
// popup-VLAN (`_vlanLabel`, `_getLinkVlan`), `_hvPanelHtml` (app-hypervisor.js),
// `_powerLiveHtml` (app-properties.js). `export function` + `import`. 4ª ricorrenza
// alias-block (app-properties-node.js: _enableManualValueInProps/_activatePropsTab)
// pre-risolta a mano. Restano in expose() (export.js legge _vlanLabel/_getLinkVlan).
const RETIRED_MIX_FN = ['_discBuildExistingIndexes', '_discTouchNodeIdentity',
  'selectAndFocusNode', 'rackUPx', '_getLinkPhysicalView', '_enableManualValueInProps',
  '_activatePropsTab', '_siteNativeVlan', '_runActiveAnchor', '_vlanLabel', '_getLinkVlan',
  '_hvPanelHtml', '_powerLiveHtml'];
test('ponte: le funzioni disc/props/vlan/hv non sono più lette da win.*', () => {
  for (const sym of RETIRED_MIX_FN) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'));
    assert.equal(viaWin, 0,
      `win.${sym} è tornato: importa { ${sym} } dal suo modulo definitore`);
  }
});

// ── 1o) Alias-block di app-properties-node.js sciolto (15 fn) ────────────────
// Ritiro ponte 2026-07-11: il grande alias-block `const X = win.X, …` in
// _renderNodeProps aliasava 26 globali. Le 15 DEFINITE come function in src/ sono
// passate a import ESM (getNodeRackSize/_patchPanelChainOptions/isRackTopNumbered/
// rackUToVisible di app.js; _nodeSpecView/_fixedRackLabel/_frontPanelState di
// app-types.js; _propsIconForType/_buildPatchPanelPreview di app-properties.js;
// _discIdentityLabel, _defaultStackName, getLagGroupsForNode, _nodeDeviceChainHtml,
// _l3SviSectionHtml, _panelSkinSectionHtml). Restano nel blocco SOLO i lib-script
// stack/ha (win.X). Chiude la fonte ricorrente della trappola TDZ dell'epic.
const RETIRED_ALIAS_FN = ['getNodeRackSize', '_patchPanelChainOptions', 'isRackTopNumbered',
  'rackUToVisible', '_nodeSpecView', '_fixedRackLabel', '_frontPanelState', '_propsIconForType',
  '_buildPatchPanelPreview', '_discIdentityLabel', '_defaultStackName', 'getLagGroupsForNode',
  '_nodeDeviceChainHtml', '_l3SviSectionHtml', '_panelSkinSectionHtml'];
test('ponte: le 15 funzioni dell\'alias-block props-node non sono più lette da win.*', () => {
  for (const sym of RETIRED_ALIAS_FN) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'));
    assert.equal(viaWin, 0,
      `win.${sym} è tornato: importa { ${sym} } dal suo modulo definitore`);
  }
});

// ── 1p) Coda funzioni A, batch 1/2 (62 fn) ───────────────────────────────────
// Ritiro ponte 2026-07-11: passata grande su tutte le funzioni ritirabili residue
// (def-once `function` in src/, escluso `_guessType` lasciato apposta), generata via
// mappa auto-dedotta simbolo→modulo. Include dispatcher render (_renderNodeProps/
// _renderPortProps/_renderLinkProps/_renderFloorProps) + fn inline (closeReportMenu/
// _saveDeepScanPref/_hideTopoTip: JS→import; _saveDeepScanPref poi migrata anche
// nell'handler inline via ASSE B (data-change="disc-deep-scan"), fuori da expose).
const RETIRED_TAIL_FN1 = [
  'closeReportMenu', '_ensureDiscoveryHistory', '_nodeByMacMap', '_recordDiscoveryObservation', '_paintRoutingTargets', '_routeHopRemovable',
  '_routingPickPort', 'showConfirm', 'showPrompt', '_discCanAutoRetype', '_discConfidenceScore', '_discHasStrongIdentity',
  '_discInvalidateExistingIndexes', '_discMarkIpMacConflict', '_discRememberClassHint', '_discSanitizeDeviceClass', '_loadDeepScanPref', '_saveDeepScanPref',
  '_discExistingNode', '_driftBuildDocSnapshot', '_driftBuildSnmpSnapshot', '_renderDriftReport', '_l3Compute', '_l3GatewayBindingHtml',
  '_l3GatewayNodeIds', '_mgmtRow', '_panelSkinRackHtml', '_resolveNodeSkin', '_cancelLink', '_drawFanoutLineDesc',
  '_findProjectLinkByPorts', '_getRackFloorLinks', '_hideTopoTip', '_linkMatchesVlanFilter', '_rackPairMatchesVlan', '_rectEdge',
  '_showPhysicalCablePath', '_showTopoTip', 'toggleTopoEndpointFilter', 'toggleTopoTrunkFilter', 'toggleTopoWlanFilter', '_focusLagForPort',
  '_isLagFocusedPort', '_portLagGid', '_toggleLagPort', '_updateLagBanner', 'getPassivePortLagInfo', '_renderFloorProps',
  '_renderLinkProps', '_deviceAccessVlanPid', '_floorAccessVlanRow', '_renderNodeProps', '_renderPortProps', 'setPropsSectionState',
  'getCablePath', 'getRackCablePath', 'isRackPort', 'renderNow', 'renderScope', '_updateFloorToolbarVisibility',
  '_updateRackFloorBtn', 'applyUiColors'];
test('ponte: la coda funzioni A batch 1 non è più letta da win.*', () => {
  for (const sym of RETIRED_TAIL_FN1) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'));
    assert.equal(viaWin, 0, `win.${sym} è tornato: importa { ${sym} } dal suo modulo definitore`);
  }
});

// ── 1q) Coda funzioni A, batch 2/2 (61 fn) ───────────────────────────────────
// Ritiro ponte 2026-07-11: seconda metà della passata grande. Include il grosso dei
// getter/helper di app.js + wifi/vlan/snmp/topo/types. Con questo ASSE A ha ritirato
// TUTTE le funzioni ritirabili (def-once function in src/) tranne `_guessType`. Dopo
// la conversione, 6 moduli hanno perso del tutto l'import `win` (app-auth/
// app-properties-floor/app-properties-port/app-search-zoom-rack/app-spare/app-csv-import).
const RETIRED_TAIL_FN2 = [
  'closeFloorMenu', 'closeRackMenu', 'initPaletteUi', '_sharedSegmentHtml', '_hasSnmpIntegration', '_lastSnmpSyncTs',
  '_renderSyncFreshness', '_renderV3PendingChip', '_v3NeedsCreds', 'applyPollResult', '_applySpareHighlight', '_resolveRackOverlap',
  '_clearTopoHighlight', '_highlightTopoLinks', '_refreshTopoBtnState', '_frontPanelIsUplink', '_frontPanelRows', '_frontPanelSfpGroups',
  '_frontPanelSfpPorts', '_linkIsTrunk', '_portEffTrunk', '_startAutoPoll', '_stopAutoPoll', '_vlansToRangeStr',
  '_voipVoiceVlan', 'setVlanFilter', 'showVlanMembers', 'updateVlanIpam', '_assignWirelessBss', '_radioIfacesHtml',
  '_renderRadioProps', '_wifiAssocHtml', '_buildDefaultState', '_cableAutoLabel', '_chainAmbiguousLinkIds', '_chainVlanColors',
  '_clearPropsTab', '_deviceHasWifi', '_dispName', '_ensureIpamState', '_getPassThroughMode', '_ipamEntry',
  '_ipamUsageForVlan', '_isLinearPassThroughPort', '_isWifiCapable', '_loadDefaultLocal', '_migrateState', '_propagateStackMasterIntegration',
  '_rackDeviceBg', '_repairRackPlacements', '_resetSelection', '_updateHistoryBtns', '_validateWallPortConnection', '_vlanIpamSummary',
  'bindEventsOnce', 'clampRackDevice', 'getNodePortCount', 'getPortConnectionCount', 'getRackSize', 'isPortOnNode',
  'removeNodePorts'];
test('ponte: la coda funzioni A batch 2 non è più letta da win.*', () => {
  for (const sym of RETIRED_TAIL_FN2) {
    const viaWin = countInCode(new RegExp('\\bwin\\.' + sym + '\\b', 'g'));
    assert.equal(viaWin, 0, `win.${sym} è tornato: importa { ${sym} } dal suo modulo definitore`);
  }
});

// ── 2) Cricchetto sul totale: il ponte può solo restringersi ────────────────
// Conteggio SOLO-CODICE (commenti esclusi) delle letture win.*. Tetto stretto al
// valore reale corrente: abbassalo al numero che il test stampa ([ratchet] …)
// quando converti altri simboli; alzarlo richiede una decisione consapevole.
//
// RIALZO CONSAPEVOLE (2026-06-21): 3455 → 3463 (+8 netti). Nuovo modulo
// src/app-sync-summary.js (chip "cosa è cambiato" dopo il Sync, opzione A):
// avvolge pollAllSNMP e riusa _driftComputeFromDoc/summarizeDriftReport, che
// vivono in altri moduli/lib → raggiunti dal ponte (win.*). Già compensato
// ritirando 3 guardie win.* ridondanti in app-drift.js. Le call cross-modulo
// passeranno a import ESM nel giro di ritiro dedicato.
//
// +1 (3463 → 3464, 2026-06-21): audit presenza multi-segnale in "Verifica
// documentazione" (_driftReachabilitySweep legge win.state per gli IP documentati).
// +6 (3464 → 3470, 2026-06-21): rilevamento CAMBIO IP (stesso MAC) + azione
// driftApplyIpChange (legge win._driftReport/showAlert/logAudit/renderAll dal ponte).
//
// −169 (3470 → 3301, 2026-06-21): FASE 1 ritiro ponte 2.0 — ritiro `win.TYPES`.
// Costante (catalogo tipi) ora `export const TYPES` in app-types.js + import nei 26
// consumatori; resta su window.TYPES via expose() per i classic. Trappola incontrata:
// un alias-block mid-list (`const state=win.state, TYPES=win.TYPES, …` in
// app-properties-node.js) → la conversione cieca aveva prodotto `TYPES = TYPES`
// (TDZ a runtime, intercettato dallo smoke renderProps). Rimosso il clause: l'import
// fornisce TYPES. Vedi RETIRED_CONST sopra.
//
// −277 (3301 → 3024, 2026-06-21): FASE 2 ritiro ponte 2.0 — batch di 6 funzioni
// (renderAll, renderProps, _buildDeviceBrandModelPreview, showAlert,
// renderTopoOverlay, propagateVlans). `export function` nei definitori + import nei
// consumatori; restano in expose() per inline/classic. Convertite TUTTE le chiamate
// `win.X(`; rese coerenti anche le chiamate bare-global pre-esistenti in app.js
// (renderAll/renderProps/showAlert) e app-properties-port.js (renderProps), ora import
// espliciti. Cicli render-core↔properties: innocui (funzioni hoisted chiamate a runtime).
//
// −1212 (3024 → 1812, 2026-06-21): FASE 3 ritiro ponte 2.0 — STATO via src/store.js
// (getter/setter che proxano window). 23 simboli pure-data (state 709, selId, selType,
// linkStart, highPath, _topoData, _driftReport, _viewMode, dragNode, …) convertiti
// win.X→store.X in 35 file (1241 conversioni); window.X resta vivo per export.js/inline.
// Vedi D18 + RETIRED_STATE sopra. SCOPERTA della verifica: selected/checked/
// _propsSectionIsOpen erano etichettati "stato" nell'handoff ma sono FUNZIONI (binario
// ritiro-funzioni), non toccate qui. I win.* residui (1812) sono funzioni + guardie typeof.
//
// −6 (1812 → 1806, 2026-06-21): rimosso il chip drift dopo il Sync (modulo
// src/app-sync-summary.js). Il Sync resta "poll + auto-link" (topologia al volo) ma
// rinominato "Sync"; le differenze di progetto si vedono in Report → Verifica doc.
//
// −9 (1806 → 1797, 2026-06-22): commit 3eda193 (TRUNK solo-topologia, −4) +
// declutter header (lingua nel menu utente, −altri).
//
// −7 (1797 → 1790, 2026-06-22): `_topoTrunkOnly` spostato in src/store.js (stato di
// vista, come _viewMode/_filterVlan) → win._topoTrunkOnly (app-popup + topology-overlay)
// convertiti a store._topoTrunkOnly; ripristinata in shouldRenderLink la visibilità dei
// trunk nel rack MA gated a _viewMode==='topology' (no carryover). _linkIsTrunk reso
// export (import in app-render-core invece di win.*). Vedi RETIRED_STATE sopra.
//
// +17 (1790 → 1807, 2026-06-22) — RIALZO CONSAPEVOLE: nuovo tipo floor `nasdesktop`
// (NAS da scrivania Synology/QNAP) → nuovo pannello proprietà device in
// app-properties-node-devices.js. Usa gli STESSI helper sul ponte dei pannelli-device
// gemelli (win.selected/win.checked/win._buildNetAccessHtml/win._buildInventoryFieldsHtml/
// win._propsSectionIsOpen): selected/checked sono FUNZIONI non ancora ritirate (binario
// "ritiro funzioni"), quindi la crescita è inevitabile e coerente col file finché non si
// ritirano quegli helper. Nessuna conversione possibile a parità di pattern.
// 2026-06-23: +26 per il nuovo tipo floor 'mobile' (Smartphone / Tablet) — blocco
// campi device con win.selected (formato/brand/OS/ownership/MDM/connessione), stesso
// pattern degli altri ~21 tipi → 1807→1833.
//
// +2 (1833 → 1835, 2026-06-26) — RIALZO CONSAPEVOLE: feature "Import lease DHCP".
// Il glue src/app-dhcp-import.js NON usa win.* (tutto via import). I +2 sono i due
// forward dei lib puri in _bridge.js (parseDhcpLeases/reconcileDhcpLeases da
// lib/dhcp-lease.js, caricato come <script>): stesso pattern di buildSpareReport/
// auditToCsv — leggono l'unica istanza viva, niente ri-bundle. Crescita inevitabile
// e coerente con la regola "lib <script> letti dal ponte".
// +3 (1835 → 1838) — RIALZO CONSAPEVOLE: UX uniforme floor=rack. Le proprietà di
// un device floor ora si aprono solo con intent ESPLICITO (doppio click), come il
// rack, via la guardia `_propsExplicit` (prima il floor switchava al singolo click
// — renderAll→renderProps senza guardia — rubando il pannello durante il drag-import
// VM). I +3 sono `win._propsExplicit=...`: single-click floor=false (app-pointer),
// doppio click floor=true (app-pointer), e re-show host dopo l'import (app-hypervisor).
// _propsExplicit è var su window (non store-proxata) → resta sul ponte come gli altri
// 3 set esistenti. Crescita inevitabile per estendere la guardia al floor.
//
// −34 (1838 → 1804, 2026-06-29): RITIRO PONTE — estratte 11 funzioni PURE del modello
// link/segmenti da src/app.js → lib/link-model.js (UMD-lite, <script> window-assign
// caricato PRIMA del bundle, +21 test in test/link-model.test.js). I 9 consumatori che
// le chiamavano via win._link*/win._getLink*/win._normalizeLink* sono passati a
// bare-global (il lib le espone su window): app-shared-segment 11, app-autolink 5,
// app-pointer 4, app-cabling-editor 3, app-popup 3, app-ports 2, app-render-core 2,
// app-topology-discover 2, app-vlan-autopoll 2. Behavior-identical (golden invariato,
// smoke + e2e 62/62 verdi). NB: win._linksForPort resta sul ponte (definita in app.js,
// NON estratta perché legge state).
//
// −79 (1804 → 1725, 2026-07-10): RITIRO PONTE — binario funzioni, batch builder del
// pannello proprietà. `_propsSectionIsOpen`(44), `_buildInventoryFieldsHtml`(20),
// `_buildNetAccessHtml`(15) da app-properties.js: `export function` + `import` negli 8
// consumatori (win.X(→X(); restano in expose() per i classic. Trappola TDZ colta: un
// alias-block mid-list in app-properties-node.js era diventato `X = X` (auto-ref, TDZ a
// runtime) → rimosso il declaratore, l'import lo fornisce. Vedi RETIRED_BUILDERS sopra.
//
// −427 (1725 → 1298, 2026-07-10): RITIRO PONTE — helper option-selected/checked.
// `selected`(392) e `checked`(35), `export function` in app.js, erano usati SOLO in
// interpolazioni build-time ${win.selected(...)} nei builder dei pannelli device
// (app-properties-node-devices 391+35 + un alias mid-list in app-properties-node) →
// `import { selected, checked } from './app.js'`. Nessun handler inline li usa; restano
// in expose() per i classic. Vedi RETIRED_HELPERS sopra.
//
// −77 (1298 → 1221, 2026-07-10): RITIRO PONTE — 5 funzioni del nucleo app.js
// (`_linksForPort`, `_nextNodeId`, `_nodeRadios`, `_isRadioPid`, `logAudit`), tutte
// già in expose() e senza uso in handler inline → `export function` + merge negli
// import `from './app.js'` dei 15 consumatori (convertite chiamate E guardie typeof).
// Restano in expose() per i classic. Vedi RETIRED_CORE_FN sopra.
//
// −55 (1221 → 1166, 2026-07-10): RITIRO PONTE — chiuse le letture-non-chiamata delle
// 10 funzioni-nucleo della 9ª (nodeById, markDirty, getNodeByPortId, getPortNodeId,
// getNodeDisplayName, pushHistory, renderCables, _showToast, _invalidateIdx,
// switchRightTab): guardie `typeof win.X` e value-pass convertite a bare (import già
// presenti), `_bridge.js` escluso. Vedi RETIRED_CORE_FN0. (Il transform ne toccò 62
// ma 7 erano in commenti, esclusi dal conteggio.)
//
// −32 (1166 → 1134, 2026-07-10): RITIRO PONTE — chiuse le letture-non-chiamata delle
// funzioni ritirate della Fase 2 (renderAll, renderProps, _buildDeviceBrandModelPreview,
// renderTopoOverlay, propagateVlans) dai rispettivi moduli-definitori (merger
// multi-sorgente). Trappola alias-block ricorrente: `renderProps = win.renderProps` in
// app-properties-node.js → `renderProps = renderProps` (auto-ref) → rimosso, import
// da app-properties.js. Ora TUTTE le funzioni già in CALLS_RETIRED hanno ponte a 0.
//
// −83 (1134 → 1051, 2026-07-11): RITIRO PONTE — binario STATO, coda-stato di
// INTERAZIONE. 9 globali di gesture/modalità (dragOffset, dragRack, _dragArmed,
// lagSelMode, _discRunning, _discImporting, _discSelMap, _routingLinkId,
// _vlanIpamOpen) spostati in src/store.js come coppie getter/setter; 86 `win.X`
// convertiti a `store.X` in 9 file (app-pointer 31, app-discovery 24, app.js 9,
// app-cabling-editor 7, app-ports/app-vlan-autopoll 5, app-core/app-properties-floor 2,
// app-render-core 1). I bare-global self-ref in app.js (`if(lagSelMode)`,
// `_vlanIpamOpen.clear()`) restano bare — leggono window.X, tenuto vivo dal setter.
// Golden invariante (stato falsy/vuoto al render); e2e 69/69 (drag rack, pan rack,
// flusso LAG cross-boundary). Il delta è 83 non 86: 3 win.X erano in commenti (già
// esclusi dal cricchetto). Vedi RETIRED_STATE sopra + store.js.
//
// −51 (1051 → 1000, 2026-07-11): RITIRO PONTE — binario FUNZIONI, cluster rack/zoom/
// search di app-search-zoom-rack.js. 6 funzioni (toggleRackPanel, switchRack,
// renderRackTabs, focusNode, updateTransforms, ensureNodeRackVisible): `export function`
// + `import` nei 10 consumatori (app-pointer 17, app-core/app-drift 8, app-render-core/
// app-popup/app-shared-segment 4, app-discovery/app-topology-discover/app-cabling-editor 2,
// app-topology-crawl 1) = 52 win.X → bare (chiamate E guardie typeof). Due cicli
// hoisted-safe: app-core↔ e app-render-core↔app-search-zoom-rack (fn chiamate a runtime).
// Restano in expose() (inline toggleRackPanel/switchRack). Golden invariante; e2e 69/69.
// Delta 51 non 52: 1 win.X era in commento. Vedi RETIRED_RACK_FN sopra.
//
// −70 (1000 → 930, 2026-07-11): RITIRO PONTE — binario FUNZIONI, 8 helper foglia di 3
// moduli: VLAN (_effPortVlan, _getLinkTrunk, _ensureVlanColor), porte (_portDisplayName,
// portTip), popup (showPop, closePop, _applyViewMode). `export function` + `import` nei
// 14 consumatori (merger table-driven con merge negli import esistenti); 72 win.X → bare.
// app-ports e app-popup sono definitori-di-alcuni e consumatori-di-altri (self-import
// escluso). Cicli hoisted-safe (app-ports↔app-popup, app-render-core↔app-vlan-autopoll).
// Restano in expose() (export.js legge _effPortVlan/_getLinkTrunk bare→window). Golden
// invariante; e2e 69/69. Delta 70 non 72: 2 win.X erano in commenti. Vedi RETIRED_LEAF_FN.
//
// −61 (930 → 869, 2026-07-11): RITIRO PONTE — binario FUNZIONI, nucleo/tipi/autolink.
// 5 fn di app.js (_renderModeIndicator, _promoteLinkToManual, _createLinkRecord,
// getRackById, canAddConnection) + _ensureNodeSpec (app-types.js) + _isLeafEndpoint
// (app-autolink.js): `export function` + `import` merge nei consumatori (app-pointer 17,
// app-shared-segment/app-stack-ha/app-vlan-autopoll 8/10, …); 61 win.X → bare.
// app-autolink è definitore-di-uno e consumatore-di-altri (self-import escluso). Cicli
// hoisted-safe. Restano in expose() (export.js legge getRackById). Golden invariante;
// e2e 69/69. Delta = 61 (nessun win.X in commento stavolta). Vedi RETIRED_CORE_FN2.
//
// −125 (869 → 744, 2026-07-11): RITIRO PONTE — binario STATO, 2º giro coda-interazione.
// 18 celle di stato di gesture/vista (resizeNode, isPanningFloor/Rack, rackPanStart,
// _spaceDown, _dragDownPt, _hoverRackId, _propsTabHold, _floorPortClick,
// _physicalTraceActive, _propsExplicit, _rightTab, _snmpSyncing, _topoHideEndpoints/
// Wireless, _topoFdbVlanCache, _discTypeMap, _focusedLagGroup) spostate in store.js;
// 131 win.X → store.X su tutto src/. Escluse le 4 funzioni-lib guardate da
// `typeof win.X === 'function'` (isInStack/isInHaGroup/linkState/carriedVlans → restano).
// Golden invariante; e2e 69/69 (drag/pan/hover). Delta 125 non 131: 6 win.X in commenti.
//
// −61 (744 → 683, 2026-07-11): RITIRO PONTE — binario FUNZIONI, topo/discovery/vlan/snmp.
// 10 funzioni di 6 moduli (_findPortByIfName/_restoreTopoSession/_renderTopoLegend topo,
// _discVendorFromMac/_discIndexNode discovery, trace pointer, _parseTrunkVlans/_isVoiceVlan
// vlan, _autoLinkDiagText autolink, _snmpFreshness snmp): `export function` + `import` merge
// nei consumatori; 63 win.X → bare. Vari file definitori-di-uno e consumatori-di-altri
// (cicli hoisted-safe). `trace` (nome corto) verificato senza binding locale in conflitto.
// Restano in expose() (export.js legge _parseTrunkVlans). Golden invariante; e2e 69/69.
// Delta 61 non 63: 2 win.X in commenti. Vedi RETIRED_MISC_FN.
//
// −51 (683 → 632, 2026-07-11): RITIRO PONTE — binario FUNZIONI, getter/label/props/disc.
// 11 funzioni (5 getter di app.js + _findFreeU/_autoLinkEndpoint/_frontPanelPortLabel/
// _buildPropsHeader/_discIdentitySource/_discFindExistingDevice). `export function` +
// `import` merge; 52 win.X via merger + 2 via fix alias-block manuale (app-properties-node.js:
// declaratori `X = win.X` rimossi + import — 3ª ricorrenza della trappola TDZ). Rimosso
// l'import `win` ora inutilizzato da app-csv-import.js (PRIMO modulo senza ponte). Golden
// invariante (tocca _buildPropsHeader/_frontPanelPortLabel); e2e 69/69. Vedi RETIRED_GETTER_FN.
//
// −52 (632 → 580, 2026-07-11): RITIRO PONTE — binario FUNZIONI, disc/props/vlan/hv.
// 13 funzioni (_discBuildExistingIndexes/_discTouchNodeIdentity, selectAndFocusNode, rackUPx,
// _getLinkPhysicalView/_enableManualValueInProps/_activatePropsTab, _siteNativeVlan/
// _runActiveAnchor, _vlanLabel/_getLinkVlan, _hvPanelHtml, _powerLiveHtml). 53 win.X → bare.
// 4ª ricorrenza alias-block (app-properties-node.js) pre-risolta a mano. Restano in expose()
// (export.js legge _vlanLabel/_getLinkVlan). Golden invariante; e2e 69/69. Vedi RETIRED_MIX_FN.
//
// −23 (580 → 557, 2026-07-11): RITIRO PONTE — SCIOLTO l'alias-block di app-properties-node.js.
// Il grande `const X = win.X, …` in _renderNodeProps aliasava 26 globali; le 15 def-function
// in src/ → import ESM (rimossi i declaratori a mano + import; il merger ha convertito solo 8
// win.X negli altri consumatori — il grosso era nel blocco). Restano nel blocco i soli
// lib-script stack/ha. CHIUDE la fonte ricorrente della trappola TDZ. Golden invariante;
// e2e 69/69. Vedi RETIRED_ALIAS_FN.
//
// −112 (557 → 445, 2026-07-11): RITIRO PONTE — coda funzioni A, batch 1/2 (62 fn).
// Passata GRANDE su tutte le funzioni ritirabili residue (mappa auto-dedotta simbolo→modulo,
// `xform-json.js`), sciolta la trappola alias-block → nessun abort. 112 win.X → bare in 19
// file. Include dispatcher render + fn inline (JS→import, bare-inline resta). Golden
// invariante; e2e 69/69. Vedi RETIRED_TAIL_FN1.
//
// −123 (445 → 322, 2026-07-11): RITIRO PONTE — coda funzioni A, batch 2/2 (61 fn).
// Seconda metà: getter/helper di app.js + wifi/vlan/snmp/topo/types. 126 win.X → bare in
// 20 file. **ASSE A: ritirate TUTTE le funzioni ritirabili (def-once in src/) tranne
// `_guessType`.** 6 moduli hanno perso l'import `win` (app-auth/app-properties-floor/-port/
// app-search-zoom-rack/app-spare, +app-csv-import già dalla 47ª). Il residuo ~322 = lib-script
// + guardie typeof di lib-fn + stato residuo + inline non ritirabili. Golden invariante;
// e2e 69/69. Vedi RETIRED_TAIL_FN2.
//
// −54 (322 → 268, 2026-07-11): RITIRO PONTE — binario STATO, 3º giro. 14 celle residue
// (panStart, _linkJustStarted, _topoTipTimer, _history/_histIdx undo-redo, rilevamento
// doppio-click _rack{,Floor,Port}Dbl{Id,Time,Pid}, _paletteDragType, _isDirty,
// _dragModalState) → store.js; 55 win.X → store.X in 5 file. store.js proxa ora 64 celle.
// Golden invariante; e2e 69/69 (drag/pan/dblclick/undo). Vedi RETIRED_STATE (3º giro).
//
// +1 (268 → 269, 2026-07-21): ND DISCOVERY — src/app-autolink.js normalizza le chiavi
// MAC dei vicini Neighbor Discovery IPv6 del router (store._topoNdCache) col GLOBALE
// win._normalizeFdbTable, identico al ramo ARP 6 righe sopra (deve produrre la STESSA
// forma-MAC per combaciare coi documentati). Gli helper ip6 (pickBestIp6/canonicalizeIpv6)
// sono import ESM (0 letture ponte). Aumento MOTIVATO di 1 lib-script read (categoria
// "resta per design", ASSE A sospeso §2.2). Nessuna funzione/stato nuovo sul ponte.
// +1 (269 → 270, 2026-07-21): DRIFT-A3 (audit 72ª) — la fusione multi-fonte dei lease
// DHCP delega a `mergeLeaseSources` di lib/dhcp-lease.js (caricato come <script>), per
// avere UN'UNICA autorità di ranking (_leaseRank) condivisa col dedup intra-fonte ed
// evitare la ricomparsa cross-fonte del bug S2.2. Il forward in _bridge.js
// (`win.mergeLeaseSources`) è un lib-script read, STESSA categoria di parseDhcpLeases/
// reconcileDhcpLeases/buildSpareReport (legge l'unica istanza viva, niente ri-bundle).
// Aumento MOTIVATO di 1; nessuna funzione/stato nuovo sul ponte (ASSE A sospeso §2.2).
const MAX_WIN_REFS = 270;

test('ponte: le letture win.* totali non superano il tetto a cricchetto', () => {
  const total = countInCode(/\bwin\./g);
  assert.ok(total <= MAX_WIN_REFS,
    `letture win.* = ${total} > tetto ${MAX_WIN_REFS}: il ponte è CRESCIUTO. ` +
    `Converti a import ESM o motiva l'aumento. Se invece è CALATO, abbassa ` +
    `MAX_WIN_REFS a ${total} per fissare il progresso.`);
  // Promemoria non-bloccante quando si scende: tieni il cricchetto stretto.
  if (total < MAX_WIN_REFS) {
    console.log(`[ratchet] win.* = ${total} < tetto ${MAX_WIN_REFS}: abbassa MAX_WIN_REFS a ${total}.`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ASSE B — CRICCHETTO SUGLI HANDLER INLINE (on*="…")
// ════════════════════════════════════════════════════════════════════════════
// Il ritiro del ponte ha DUE assi (vedi ARCHITECTURE.md §10):
//   • ASSE A = letture win.* → import ESM      (MAX_WIN_REFS sopra, pavimento 268)
//   • ASSE B = handler inline (onclick/onchange/oninput/ontoggle/ondragstart/…)
//     → event delegation (data-act/data-change/data-input/… in app-delegation.js)
// Gli handler inline sono IL motivo per cui il ponte esiste ancora: risolvono i
// nomi nello scope lessicale di pagina (window via expose()). Finché l'ASSE B non
// è finito, `_bridge.js`/`expose()` non si possono cancellare.
//
// Questo guard rende l'ASSE B MISURATO e MONOTONO come MAX_WIN_REFS ha fatto per
// l'ASSE A: il conteggio può solo CALARE. È la differenza tra un grind senza fine
// e una migrazione che CONVERGE.
//
// TRAGUARDO: il PAVIMENTO STRUTTURALE, non necessariamente 0. Alcuni handler
// restano inline per scelta (es. l'ingranaggio che apre l'editor protocolli VIVE
// nel pannello proprietà GOLDEN → migrarlo cambierebbe lo snapshot; i classic
// export.js sono fuori-ASSE per design). Quando il pavimento vero emergerà lo si
// fissa qui, come MAX_WIN_REFS=268.
//
// RICETTA: quando migri un cluster (on*="key" → data-act/data-change="key" +
// register*Actions nel modulo che POSSIEDE la funzione) il conteggio cala →
// abbassa MAX_INLINE_HANDLERS al numero stampato da [ratchet-B].
//
// AMBITO: src/*.js (handler nei template runtime) + netmapper.html (statici).
// export.js (classic, 1 handler) è ESCLUSO per design. Le assegnazioni JS di
// proprietà (`el.onload = fn`, `reader.onload=ev=>…`) NON contano: il pattern
// richiede un apice dopo `=` (`on*="` / `on*='`), che solo l'attributo inline ha.
const INLINE_HANDLER_RE = /\bon[a-z]+=["']/g;
function stripHtmlComments(s) { return s.replace(/<!--[\s\S]*?-->/g, ''); }
function countInlineHandlers() {
  let n = 0;
  // handler nei template runtime dei moduli ESM (stesso strip-commenti di countInCode)
  for (const f of files) {
    const raw = fs.readFileSync(path.join(SRC, f), 'utf8');
    const code = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    n += (code.match(INLINE_HANDLER_RE) || []).length;
  }
  // shell statico
  const html = stripHtmlComments(fs.readFileSync(path.join(__dirname, '..', 'netmapper.html'), 'utf8'));
  n += (html.match(INLINE_HANDLER_RE) || []).length;
  return n;
}
// −50 (627 → 577, 2026-07-12): ASSE B — cluster statico netmapper.html, giro 1.
// 38 ondragstart="onDragStart(event)" IDENTICI della palette → data-dragstart="equip"
// (harness esteso col tipo `dragstart`, che fa bubbling; register in app-pointer.js) +
// i modali IMPORTA CSV (5) e LEASE DHCP (7): backdrop/chiudi/scegli-file/azioni → data-act,
// register nei moduli proprietari (app-csv-import.js / app-dhcp-import.js, già con blocco).
// Restano statici: menu header import/export + automazioni, toolbar, dialoghi discovery/
// export-PDF/label/vlan-members/shared-segment, e gli handler canvas (wheel/drop/scroll/
// mouse/contextmenu → servono nuovi tipi harness). Golden invariato (chrome, non #props-panel).
//
// −1 (577 → 576, 2026-07-21): il toggle «Lease rilasciato» spostato da «Automazioni rete»
// (onchange inline) alla modale Import DHCP (data-change delegation, app-dhcp-import.js) →
// un inline handler in meno, allineato ad ASSE B.
const MAX_INLINE_HANDLERS = 576;
test('ponte ASSE B: gli handler inline on*= non superano il tetto a cricchetto', () => {
  const total = countInlineHandlers();
  assert.ok(total <= MAX_INLINE_HANDLERS,
    `handler inline on*= = ${total} > tetto ${MAX_INLINE_HANDLERS}: l'ASSE B è ` +
    `CRESCIUTO. Usa data-act/data-change + event delegation (app-delegation.js), ` +
    `non un nuovo onclick="". Se invece è CALATO, abbassa MAX_INLINE_HANDLERS a ` +
    `${total} per fissare il progresso.`);
  if (total < MAX_INLINE_HANDLERS) {
    console.log(`[ratchet-B] handler inline = ${total} < tetto ${MAX_INLINE_HANDLERS}: abbassa MAX_INLINE_HANDLERS a ${total}.`);
  }
});
