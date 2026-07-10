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
  '_topoTrunkOnly', '_lastPopPid', '_lastPopX', '_lastPopY', '_currentUser'];
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
const MAX_WIN_REFS = 1134;

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
