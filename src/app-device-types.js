// ============================================================
// DEVICE-TYPE CATALOG — "Applica modello" (look ESATTO via renderer di default)
// ============================================================
// Catalogo di template NATIVI (ports + frontPanel) generati dai dati device-type
// devicetype-library (CC0) e serviti da GET /api/device-types. Applicare un
// modello setta i campi nativi del nodo -> il renderer di default disegna
// porte/SFP/MGMT ESATTE (numeri + gabbie), niente skin/approssimazioni.
// NB ratchet ponte: niente win.* (fetch diretto sul route pubblico) e niente
// on*= inline (event delegation via data-change) -> non fa crescere l'ASSE B.
import { t } from './_bridge.js';
import { store } from './store.js';
import { escapeHTML } from './app-util.js';
import { nodeById, markDirty, getNodeRackSize } from './app.js';
import { showAlert } from './app-core.js';
import { renderAll } from './app-render-core.js';
import { renderProps } from './app-properties.js';
import { registerChangeActions } from './app-delegation.js';

let _catalog = [];
let _byKey = {};   // "brand model" (lower) -> template

/** Carica il catalogo device-type dal server nella cache (chiamata al boot). */
export async function loadDeviceTypes() {
    try {
        const r = await fetch('/api/device-types');   // route pubblica, sola lettura
        const list = r.ok ? await r.json() : [];
        _catalog = Array.isArray(list) ? list : [];
    } catch (_) {
        _catalog = [];   // catalogo assente -> il control non compare
    }
    _byKey = {};
    _catalog.forEach(function (c) { _byKey[(c.brand + ' ' + c.model).toLowerCase()] = c; });
}

/** PURA: applica un template ai campi NATIVI del nodo. Ritorna true se applicato.
 *  Sostituisce ports + frontPanel (reset al layout del modello) e aggiorna
 *  brand/model/altezza-U. Non tocca porte/VLAN gia' configurate a valle. */
export function applyTemplateToNode(node, tmpl, rackTotalU) {
    if (!node || !tmpl) return false;
    node.ports = tmpl.ports;
    node.frontPanel = Object.assign({}, tmpl.frontPanel || {});
    if (tmpl.brand) node.brand = tmpl.brand;
    if (tmpl.model) node.model = tmpl.model;
    // ALTEZZA del device = node.sizeU. NON node.rackU (che e' la POSIZIONE nel rack:
    // sovrascriverla lo faceva sparire). Dopo un cambio altezza ri-clampo la posizione
    // perche' il device resti dentro il rack (mirror di updateN('sizeU') in app.js).
    if (tmpl.rackU) {
        node.sizeU = tmpl.rackU;
        if (rackTotalU) node.rackU = Math.max(1, Math.min(node.rackU || 1, rackTotalU - node.sizeU + 1));
    }
    return true;
}

/** HTML del control "Applica modello" per la sezione Layout porte. Vuoto se il
 *  catalogo non e' caricato (es. ambiente test/golden senza fetch). */
export function _deviceTypeApplyHtml() {
    if (!_catalog.length) return '';
    const opts = _catalog.map(function (c) { return `<option value="${escapeHTML(c.brand + ' ' + c.model)}">`; }).join('');
    return `<div class="prop-group" style="margin-top:6px"><label>${t('devtype.apply')}</label>
      <input type="text" list="devtype-options" placeholder="${escapeHTML(t('devtype.placeholder'))}" data-change="apply-device-type" data-tip="${escapeHTML(t('devtype.tip'))}">
      <datalist id="devtype-options">${opts}</datalist>
    </div>`;
}

/** Risolve "Brand Model" -> template -> applica al device selezionato. */
function applyDeviceType(value) {
    const tmpl = _byKey[String(value || '').trim().toLowerCase()];
    const n = nodeById(store.selId);
    if (!tmpl || !n) return;
    applyTemplateToNode(n, tmpl, getNodeRackSize(n));
    renderAll(); markDirty(); renderProps();
    showAlert(t('devtype.applied', { model: tmpl.brand + ' ' + tmpl.model }));
}

// Delega: il change sull'input "Applica modello" (data-change) chiama l'handler.
registerChangeActions({ 'apply-device-type': (el) => applyDeviceType(el.value) });
