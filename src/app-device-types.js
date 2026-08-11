// ============================================================
// DEVICE-TYPE CATALOG — "Applica modello" (look ESATTO via renderer di default)
// ============================================================
// Catalogo di template NATIVI (ports + frontPanel) generati da dati device-type
// pubblici (CC0) e serviti da GET /api/device-types. Applicare un
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
import { registerClickActions, registerChangeActions } from './app-delegation.js';

let _catalog = [];
let _byKey = {};   // "brand model" (lower) -> template
let _bySourceSlug = {};
let _catalogVersion = '';

/** Carica il catalogo device-type dal server nella cache (chiamata al boot). */
export async function loadDeviceTypes() {
    try {
        const r = await fetch('/api/device-types');   // route pubblica, sola lettura
        const list = r.ok ? await r.json() : [];
        _catalog = Array.isArray(list) ? list : [];
    } catch (_) {
        _catalog = [];   // catalogo assente -> il control non compare
    }
    try {
        const r = await fetch('/api/integrations/dcim/catalog', { headers: { Accept: 'application/json' } });
        const status = r.ok ? await r.json() : {};
        _catalogVersion = String(status.sourceRef || status.generatedAt || '');
    } catch (_) { _catalogVersion = ''; }
    _byKey = {};
    _bySourceSlug = {};
    _catalog.forEach(function (c) {
        _byKey[(c.brand + ' ' + c.model).toLowerCase()] = c;
        if (c.sourceSlug || c.slug) _bySourceSlug[String(c.sourceSlug || c.slug).toLowerCase()] = c;
    });
    _ensureDeviceTypeDatalist();
}

/** Costruisce UNA SOLA VOLTA (al boot) il <datalist> con le ~4000 opzioni del
 *  catalogo, come elemento condiviso in document.body. Prima veniva rigenerato
 *  (map di 4071 <option> + escapeHTML, ~200 KB di HTML) a OGNI renderProps del
 *  device selezionato — latenza a ogni tasto nel pannello Proprietà. Ora l'input
 *  "Applica modello" punta a questo datalist statico via `list=`. */
function _ensureDeviceTypeDatalist() {
    if (typeof document === 'undefined' || !document.body) return;
    let dl = document.getElementById('devtype-options');
    if (!dl) {
        dl = document.createElement('datalist');
        dl.id = 'devtype-options';
        document.body.appendChild(dl);
    }
    dl.innerHTML = _catalog.map(function (c) {
        return `<option value="${escapeHTML(c.brand + ' ' + c.model)}"></option>`;
    }).join('');
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
        // Clampa l'ALTEZZA al rack, come il percorso canonico updateN('sizeU'): un
        // modello 50U applicato a un rack 42U non deve traboccare (senza clamp la
        // posizione rackU crollava a 1 e il device usciva dal telaio).
        node.sizeU = rackTotalU ? Math.max(1, Math.min(tmpl.rackU, rackTotalU)) : Math.max(1, tmpl.rackU);
        if (rackTotalU) node.rackU = Math.max(1, Math.min(node.rackU || 1, rackTotalU - node.sizeU + 1));
    }
    return true;
}

/** HTML del control "Applica modello" per la sezione Layout porte. Vuoto se il
 *  catalogo non e' caricato (es. ambiente test/golden senza fetch). */
export function _deviceTypeApplyHtml(node) {
    if (!_catalog.length) return '';
    // Il <datalist id="devtype-options"> e' costruito UNA volta al boot in
    // document.body (vedi _ensureDeviceTypeDatalist): qui solo l'input che lo
    // referenzia via `list=`, cosi' il pannello non ri-emette 4071 <option> a
    // ogni render.
    const sourceSlug = node && node.catalogMatch && node.catalogMatch.sourceSlug;
    const currentTemplate = sourceSlug && _bySourceSlug[String(sourceSlug).toLowerCase()];
    const stale = !!(node && node.catalogMatch && node.catalogMatch.catalogVersion && _catalogVersion
        && node.catalogMatch.catalogVersion !== _catalogVersion);
    const update = stale && currentTemplate ? `<div style="display:flex;align-items:center;gap:7px;margin-top:6px;padding:6px 8px;border:0.5px solid var(--warning-color,#e3b341);border-radius:var(--radius);color:var(--warning-color,#e3b341);font-size:11px">
        <i class="fas fa-arrows-rotate"></i><span style="flex:1">${escapeHTML(t('devtype.updated'))}</span>
        <button type="button" class="um-btn" data-act="apply-current-device-type" style="padding:2px 7px;font-size:11px">${escapeHTML(t('devtype.applyCurrent'))}</button>
      </div>` : '';
    return `<div class="prop-group" style="margin-top:6px"><label>${t('devtype.apply')}</label>
      <input type="text" list="devtype-options" placeholder="${escapeHTML(t('devtype.placeholder'))}" data-change="apply-device-type" data-tip="${escapeHTML(t('devtype.tip'))}">
    </div>${update}`;
}

function _catalogTemplateForNode(node) {
    if (!node) return null;
    const sourceSlug = node.catalogMatch && node.catalogMatch.sourceSlug;
    return (sourceSlug && _bySourceSlug[String(sourceSlug).toLowerCase()])
        || _byKey[(String(node.brand || '') + ' ' + String(node.model || '')).trim().toLowerCase()]
        || null;
}

function _markCatalogApplied(node, tmpl, strategy) {
    if (!node || !tmpl) return;
    node.catalogMatch = {
        strategy: strategy || 'manual',
        sourceSlug: tmpl.sourceSlug || tmpl.slug || null,
        catalogVersion: _catalogVersion || null,
        manual: true,
    };
    if (node.source && typeof node.source === 'object') {
        node.source.catalogMatch = 'manual-override';
        if (_catalogVersion) node.source.catalogVersion = _catalogVersion;
    }
}

/** Risolve "Brand Model" -> template -> applica al device selezionato. */
function applyDeviceType(value) {
    const tmpl = _byKey[String(value || '').trim().toLowerCase()];
    const n = nodeById(store.selId);
    if (!tmpl || !n) return;
    applyTemplateToNode(n, tmpl, getNodeRackSize(n));
    _markCatalogApplied(n, tmpl, 'manual');
    renderAll(); markDirty(); renderProps();
    // Modelli DC ad altissima densità: le porte in fibra oltre il cap 48/blocco
    // vengono troncate dal generatore (counts.fiberDropped). Prima sparivano in
    // silenzio: ora l'utente sa che quelle porte non sono cablabili sul pannello.
    const dropped = (tmpl.counts && tmpl.counts.fiberDropped > 0) ? tmpl.counts.fiberDropped : 0;
    showAlert(t('devtype.applied', { model: tmpl.brand + ' ' + tmpl.model })
        + (dropped ? ' ' + t('devtype.fiberDropped', { n: dropped }) : ''));
}

function applyCurrentDeviceType() {
    const n = nodeById(store.selId);
    const tmpl = _catalogTemplateForNode(n);
    if (!tmpl || !n) return;
    applyTemplateToNode(n, tmpl, getNodeRackSize(n));
    _markCatalogApplied(n, tmpl, 'manual-update');
    renderAll(); markDirty(); renderProps();
    showAlert(t('devtype.updatedApplied', { model: tmpl.brand + ' ' + tmpl.model }));
}

// Delega: il change sull'input "Applica modello" (data-change) chiama l'handler.
registerChangeActions({ 'apply-device-type': (el) => applyDeviceType(el.value) });
registerClickActions({ 'apply-current-device-type': () => applyCurrentDeviceType() });

if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('infranet:catalog-updated', () => {
        loadDeviceTypes().then(() => renderProps()).catch(() => {});
    });
}
