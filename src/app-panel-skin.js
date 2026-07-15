// Panel-skin — GLUE (migrato a ESM, esbuild): libreria skin (skin store
// per-modello) + render sul rack.
//
// La skin e' un asset CONDIVISO per-modello, salvato nello skin store lato server
// (skins/<id>.svg + index.json) e referenziato dal nodo con `node.skinId`. La
// cache client _skinStore viene popolata all'avvio (loadPanelSkinStore) cosi' il
// render e' sincrono. Retro-compat: i nodi del prototipo con `node.panelSkin`
// inline continuano a funzionare (risolti come fallback).
//
// Al render del rack, _panelSkinRackHtml clona l'SVG e inietta `data-pid` +
// classe di stato sulle forme-porta: il motore di cablaggio esistente
// (`closest('[data-pid]')`) le tratta come i LED generati. Niente skin → fallback
// TOTALE al layout porte generato.
//
// Dipendenze: t dal ponte (i18n <script>); parsePanelSkin, skinPortPid
// (panel-skin.js <script>) via win.; globali legacy app.js via win. (apiFetch,
// nodeById, renderAll, markDirty, renderProps, showAlert, state, selId, selType,
// normalizeStatus, portTip, escapeHTML, _propsSectionIsOpen, setPropsSectionState).
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, normalizeStatus } from './app-util.js';
import { nodeById, markDirty } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { showAlert } from './app-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderProps, _propsSectionIsOpen } from './app-properties.js';   // ritiro ponte fase 2+: funzioni/builder (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { portTip } from './app-ports.js';   // ritiro ponte: funzioni foglia UI/vlan/popup (ex win.*)

// ---- Cache client dello skin store -----------------------------------------
let _skinStore = [];   // [{id,name,brand,model,face,viewBox,ports,svg}]
let _skinById  = {};

/** Carica la libreria skin dal server nella cache (chiamata all'avvio). */
async function loadPanelSkinStore(){
    try {
        const list = await win.apiFetch('/api/skins');
        _skinStore = Array.isArray(list) ? list : [];
        _skinById = {};
        _skinStore.forEach(function(s){ _skinById[s.id] = s; });
    } catch(_){
        _skinStore = []; _skinById = {};   // store assente → fallback al layout generato
    }
}

/** Risolve la skin di un nodo: store (skinId) → inline legacy (panelSkin) → null. */
export function _resolveNodeSkin(n){
    if(!n) return null;
    if(n.skinId && _skinById[n.skinId]) return _skinById[n.skinId];
    if(n.panelSkin && n.panelSkin.svg) return n.panelSkin;   // retro-compat prototipo
    return null;
}

// ---- Sanitizzazione DOM (barriera autorevole lato render) -------------------
// lib/panel-skin.js sanitizza su STRINGA (difesa in profondita', gira anche in
// Node). Qui, dove il DOM c'e', ripuliamo l'SVG parsandolo DAVVERO prima di
// inserirlo: via elementi eseguibili e attributi handler/ref esterni. Cosi'
// nessun on*/script sopravvive al render, a prescindere da quoting/formattazione
// o da una skin gia' salvata prima dell'hardening del sanitizzatore.
const _SVG_BANNED_EL = { script: 1, foreignobject: 1, iframe: 1 };

function _svgSanitizeInPlace(el){
    if(!el || el.nodeType !== 1) return;
    const attrs = el.attributes;
    if(attrs){
        for(let i = attrs.length - 1; i >= 0; i--){
            const name = (attrs[i].name || '').toLowerCase();
            const val  = attrs[i].value || '';
            if(name.indexOf('on') === 0){ el.removeAttribute(attrs[i].name); continue; }   // handler evento
            if(name === 'href' || name === 'src' || name === 'xlink:href' || /(^|:)href$/.test(name)){
                if(!/^\s*#/.test(val)){ el.removeAttribute(attrs[i].name); continue; }      // solo ref locali #…
            }
            if(/javascript:/i.test(val)) el.removeAttribute(attrs[i].name);
        }
    }
    Array.prototype.slice.call(el.childNodes || []).forEach(function(k){
        if(k.nodeType !== 1) return;
        if(_SVG_BANNED_EL[String(k.localName || k.nodeName || '').toLowerCase()]){
            if(k.parentNode) k.parentNode.removeChild(k);
            return;
        }
        _svgSanitizeInPlace(k);
    });
}

/** Ripulisce un SVG (stringa) via DOM → markup sicuro, o '' se non parsabile /
 *  DOM assente (il chiamante fa fallback). */
function _sanitizeSvgMarkup(svgText){
    if(typeof DOMParser === 'undefined') return '';
    try {
        const doc = new DOMParser().parseFromString(String(svgText || ''), 'image/svg+xml');
        if(doc.getElementsByTagName('parsererror').length) return '';
        const svg = doc.documentElement;
        if(!svg || String(svg.localName).toLowerCase() !== 'svg') return '';
        _svgSanitizeInPlace(svg);
        return new XMLSerializer().serializeToString(svg);
    } catch(_){ return ''; }
}

// ---- Sezione "Skin pannello" nel pannello Proprieta -------------------------
export function _panelSkinSectionHtml(n){
    const cur = _resolveNodeSkin(n);
    const curId = (n && n.skinId) || '';
    const brand = ((n && n.brand) || '').toString().toLowerCase();
    const model = ((n && n.model) || '').toString().toLowerCase();
    const isMatch = function(s){
        return (brand || model) && (s.brand||'').toLowerCase()===brand && (s.model||'').toLowerCase()===model;
    };
    const opts = [`<option value="">${t('skin.none')}</option>`]
        .concat(_skinStore.map(function(s){
            return `<option value="${escapeHTML(s.id)}" ${s.id===curId?'selected':''}>`
                 + `${escapeHTML(s.name||s.id)}${s.face==='rear'?t('skin.rear'):''}${isMatch(s)?' ✓':''}</option>`;
        }));
    // Anteprima: MAI l'svg grezzo in innerHTML. Passa dalla sanitizzazione DOM
    // (rimuove handler/script anche da skin salvate prima dell'hardening) → era
    // il sink della XSS stored (skin importata → pannello Proprieta di chiunque).
    const safePreview = (cur && cur.svg) ? _sanitizeSvgMarkup(cur.svg) : '';
    const preview = safePreview ? `<div class="panel-skin-preview">${safePreview}</div>` : '';
    const legacyNote = (cur && n && cur===n.panelSkin)
        ? `<p class="panel-skin-meta">${t('skin.legacyNote')}</p>` : '';
    const body = `${preview}${legacyNote}
        <div class="prop-group"><label>${t('skin.fromLib')}</label>
          <select onchange="assignNodeSkin(this.value)">${opts.join('')}</select>
        </div>
        <div class="prop-row2">
          <label class="panel-skin-btn primary" data-tip="${t('skin.uploadTip')}"><i class="fas fa-upload"></i> ${t('skin.uploadBtn')}<input type="file" accept=".svg,image/svg+xml" style="display:none" onchange="uploadPanelSkin(this)"></label>
          ${curId?`<button type="button" class="panel-skin-btn" onclick="assignNodeSkin('')" data-tip="${t('skin.detachTip')}"><i class="fas fa-link-slash"></i> ${t('skin.detachBtn')}</button>`:''}
        </div>
        ${curId?`<button type="button" class="panel-skin-btn danger" style="width:100%;margin-top:6px" onclick="deleteLibrarySkin('${escapeHTML(curId)}')" data-tip="${t('skin.deleteTip')}"><i class="fas fa-trash"></i> ${t('skin.deleteBtn')}</button>`:''}`;
    const prev = cur ? `<span class="props-collapsible-preview">${escapeHTML(cur.name||t('skin.active'))}</span>`
                     : `<span class="props-collapsible-preview muted">${t('skin.noSkin')}</span>`;
    return `<details class="props-collapsible props-secondary" ${_propsSectionIsOpen('panel-skin')?'open':''} ontoggle="setPropsSectionState('panel-skin',this.open)"><summary class="props-collapsible-head"><span><i class="fas fa-vector-square"></i> ${t('skin.section')}</span>${prev}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">${body}</div></details>`;
}

/** Upload: valida lato client (feedback) → POST allo store → cache → assegna. */
function uploadPanelSkin(inputEl){
    const f = inputEl && inputEl.files && inputEl.files[0];
    if(!f) return;
    const rd = new FileReader();
    rd.onload = async function(){
        const raw = String(rd.result || '');
        let d;
        try { d = win.parsePanelSkin(raw, { name: f.name.replace(/\.svg$/i,'') }); }
        catch(e){ showAlert(t('skin.errRead', {msg: e && e.message || e})); return; }
        if(!d.ok){ showAlert(t('skin.errInvalid', {msg: d.error})); return; }
        const n = nodeById(store.selId);
        try {
            const rec = await win.apiFetch('/api/skins', { method:'POST', body: JSON.stringify({
                name: d.name, brand: (n && n.brand) || '', model: (n && n.model) || '', face: d.face, svg: raw
            })});
            _skinStore.push(rec); _skinById[rec.id] = rec;
            if(n){ n.skinId = rec.id; delete n.panelSkin; }
            renderAll(); markDirty(); renderProps();
            if(rec.warnings && rec.warnings.length){
                showAlert(t('skin.warnLoaded', {list: rec.warnings.join('\n• ')}));
            }
        } catch(e){ showAlert(t('skin.errUpload', {msg: e.message})); }
    };
    rd.onerror = function(){ showAlert(t('skin.errFile')); };
    rd.readAsText(f);
}

/** Assegna (o stacca, con id vuoto) una skin della libreria al device corrente. */
function assignNodeSkin(skinId){
    const n = nodeById(store.selId); if(!n) return;
    if(skinId){ n.skinId = skinId; delete n.panelSkin; }
    else { delete n.skinId; delete n.panelSkin; }
    renderAll(); markDirty(); renderProps();
}

/** Retro-compat: il vecchio pulsante "Rimuovi" stacca la skin dal device. */
function clearPanelSkin(){ assignNodeSkin(''); }

/** Elimina una skin dalla libreria (server) e la stacca da tutti i device. */
async function deleteLibrarySkin(skinId){
    if(!skinId) return;
    try {
        await win.apiFetch('/api/skins/' + encodeURIComponent(skinId), { method:'DELETE' });
        _skinStore = _skinStore.filter(function(s){ return s.id !== skinId; });
        delete _skinById[skinId];
        (store.state.nodes||[]).forEach(function(nd){ if(nd.skinId === skinId) delete nd.skinId; });
        renderAll(); markDirty(); renderProps();
    } catch(e){ showAlert(t('skin.errDelete', {msg: e.message})); }
}

/** SVG del pannello con data-pid + stato iniettati, pronto per il render del
 *  device rack. Ritorna '' se nessuna skin o SVG non parsabile (→ fallback). */
export function _panelSkinRackHtml(n){
    const sk = _resolveNodeSkin(n);
    if(!sk || !sk.svg) return '';
    if(typeof DOMParser === 'undefined') return '';
    try {
        const doc = new DOMParser().parseFromString(sk.svg, 'image/svg+xml');
        if(doc.getElementsByTagName('parsererror').length) return '';
        const svg = doc.documentElement;
        if(!svg || String(svg.tagName).toLowerCase() !== 'svg') return '';
        // Difesa in profondita': via handler/script/ref-esterni dal DOM parsato
        // PRIMA di ri-serializzarlo nel rack (un handler ben formato sopravvivrebbe
        // al parse XML e verrebbe reinserito via innerHTML del render).
        _svgSanitizeInPlace(svg);
        svg.setAttribute('class', ((svg.getAttribute('class')||'') + ' panel-skin-svg').trim());
        // meet = mantieni le proporzioni reali senza mai ritagliare l'artwork. Il
        // rack ora e' in scala reale (var --ru-h), quindi una skin disegnata a 1U
        // (≈10.86:1) riempie lo slot con margine ~0; se la proporzione e' un filo
        // diversa resta un bordo minimo (mai distorsione, mai taglio).
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.removeAttribute('width'); svg.removeAttribute('height');
        (sk.ports||[]).forEach(function(p){
            const pid = win.skinPortPid(n.id, p);
            let el = doc.getElementById(p.id);
            if(!el){ el = svg.querySelector('[data-' + (p.kind==='mgmt'?'mgmt':'port') + '="' + p.num + '"]'); }
            if(!el) return;
            el.setAttribute('data-pid', pid);
            const pi = (store.state.ports && store.state.ports[pid]) || {};
            const stt = normalizeStatus(pi.statusOvr != null ? pi.statusOvr : pi.status);
            const selCls = (store.selType==='port' && store.selId===pid) ? ' selected' : '';
            el.setAttribute('class', ((el.getAttribute('class')||'') + ' skin-port ' + stt + selCls).trim());
            // togli il fill proprio della forma E delle forme annidate (Illustrator
            // spesso mette <g id="port-N"><rect fill="..."/></g>) → il colore di
            // stato lo da la CSS su .skin-port e .skin-port *
            const paintable = [el].concat(Array.prototype.slice.call(el.querySelectorAll('*')));
            paintable.forEach(function(g){ g.removeAttribute('fill'); if(g.style) g.style.removeProperty('fill'); });
            const tip = (typeof portTip==='function') ? portTip(pid) : pid;
            if(tip){
                const tEl = doc.createElementNS('http://www.w3.org/2000/svg','title');
                tEl.textContent = tip;
                el.insertBefore(tEl, el.firstChild);
            }
        });
        return '<div class="rack-skin-wrap">' + new XMLSerializer().serializeToString(svg) + '</div>';
    } catch(e){ return ''; }
}

/** Drag del badge radio su un device con skin: lo sposta sul box (frazioni 0..1
 *  salvate su radio.bx/by). Click senza movimento = seleziona la radio. Solo per
 *  device con skin (il render aggancia questo handler solo lì). */
function _onSkinRadioPointerDown(ev, nodeId, ridx, pid){
    ev.preventDefault();        // sopprime il mousedown di drag del device/cablaggio
    ev.stopPropagation();
    const badge = ev.currentTarget;
    const dev = badge.closest('.rack-device');
    const n = nodeById(nodeId);
    const r = n && n.radios && n.radios[ridx];
    if(!dev || !r) return;
    const sx = ev.clientX, sy = ev.clientY;
    let moved = false, fx = null, fy = null;
    const onMove = function(e){
        if(!moved && (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy)) < 4) return;
        moved = true;
        const rect = dev.getBoundingClientRect();           // box scalato dallo zoom
        fx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        fy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        badge.style.left = (fx * 100).toFixed(2) + '%';
        badge.style.top  = (fy * 100).toFixed(2) + '%';
        badge.style.right = 'auto'; badge.style.bottom = 'auto';
    };
    const onUp = function(){
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if(moved && fx != null){
            r.bx = +fx.toFixed(4); r.by = +fy.toFixed(4);
            markDirty(); renderAll();
        } else {
            store.selType = 'port'; store.selId = pid; renderProps(); renderAll();   // click = seleziona la radio
        }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
}

// Superficie pubblica: boot (loadPanelSkinStore), render (_resolveNodeSkin,
// _panelSkinRackHtml, _onSkinRadioPointerDown da app-render-core.js), pannello
// (_panelSkinSectionHtml da app-properties-node.js) + handler inline onchange/
// onclick (uploadPanelSkin, assignNodeSkin, clearPanelSkin, deleteLibrarySkin).
expose({
    loadPanelSkinStore, _resolveNodeSkin, _panelSkinSectionHtml, _panelSkinRackHtml,
    _onSkinRadioPointerDown, uploadPanelSkin, assignNodeSkin, clearPanelSkin,
    deleteLibrarySkin,
});
