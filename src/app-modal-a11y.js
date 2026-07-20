// ============================================================
// A11Y DEI TOOL-MODAL (M9) + FAMIGLIA DINAMICA `.drift-overlay`
// ------------------------------------------------------------
// Rende accessibili gli overlay `.tool-modal-overlay` (statici in netmapper.html)
// E gli overlay dinamici `.drift-overlay` (Verifica/Drift, Storia modifiche,
// Adotta, Mappa L3, Porte libere, WiFi…, creati lazy dai loro moduli e appesi a
// document.body) SENZA riscrivere le coppie apri/chiudi sparse nei moduli
// (che restano la fonte di verità):
//
//   • focus-trap  — Tab/Shift+Tab restano dentro il modale aperto. Listener
//                   delegato sul document: nessun hook sulle open() esistenti.
//   • focus iniziale + ripristino — un MutationObserver guarda class/style degli
//                   overlay: quando uno si apre salva il focus precedente e lo
//                   porta dentro; quando si chiude lo ripristina dov'era.
//   • Escape      — `closeTopToolModal()` (chiamata dal ramo Escape in app.js)
//                   clicca il pulsante X REALE del modale, così gira la sua
//                   logica di chiusura (cleanup dei campi), non un mero hide.
//
// Perché così e non un helper `openToolModal/closeToolModal` da cablare ovunque:
// le open/close vivono in molti moduli diversi e fanno cleanup specifici. Un
// osservatore esterno ottiene lo STESSO risultato a rischio molto minore, senza
// behavior-change su nessun flusso esistente. Vale finché la convenzione regge:
// overlay > box (`.tool-modal`/`.drift-modal`) > header (`.tool-modal-header`/
// `.drift-head`) > X (fa-times).
//
// ARIA: per i tool-modal statici gli attributi stanno in netmapper.html; per la
// famiglia dinamica `.drift-overlay` vengono STAMPATI qui alla registrazione
// (`_ensureAria`, skip se già presenti) — un punto solo invece di 8 builder.
// ============================================================
import { expose } from './_bridge.js';

const SEL_OVERLAY = '.tool-modal-overlay, .drift-overlay';
const SEL_FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

// Visibile = ha un box renderizzato. Copre SIA la classe `.open` (display:flex da
// CSS) SIA lo `style="display:none"` inline: i modali usano entrambi i meccanismi.
function _visible(el) {
    if (!el) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

/** Il tool-modal aperto in cima (ultimo nel DOM = sopra, stesso z-index). null se nessuno. */
export function topOpenToolModal() {
    const open = Array.from(document.querySelectorAll(SEL_OVERLAY)).filter(_visible);
    return open.length ? open[open.length - 1] : null;
}

function _focusables(root) {
    return Array.from(root.querySelectorAll(SEL_FOCUSABLE)).filter(_visible);
}

// Pulsante di chiusura: convenzione = il bottone dell'header con l'icona fa-times.
function _closeBtn(ov) {
    const hdr = ov.querySelector('.tool-modal-header, .drift-head');
    if (!hdr) return null;
    return Array.from(hdr.querySelectorAll('button')).find(b => b.querySelector('.fa-times')) || null;
}

// ARIA per gli overlay dinamici (`.drift-overlay`): role/aria-modal sul box,
// aria-labelledby sul primo id "*-title" disponibile, aria-label sulla X dal suo
// data-tip (già i18n al momento della build del markup). Skip se già presenti,
// così i tool-modal statici (ARIA in netmapper.html) non vengono toccati.
function _ensureAria(ov) {
    const box = ov.querySelector('.tool-modal, .drift-modal');
    if (box && !box.getAttribute('role')) {
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        const title = box.querySelector('[id$="-title"]');
        if (title && !box.getAttribute('aria-labelledby')) box.setAttribute('aria-labelledby', title.id);
    }
    const x = _closeBtn(ov);
    if (x && !x.getAttribute('aria-label')) {
        x.setAttribute('aria-label', x.getAttribute('data-tip') || x.getAttribute('title') || 'Chiudi');
    }
}

/**
 * Chiude il tool-modal in cima cliccandone la X reale (così gira il suo cleanup).
 * @returns {boolean} true se un modale era aperto ed è stato chiuso.
 */
export function closeTopToolModal() {
    const ov = topOpenToolModal();
    if (!ov) return false;
    const btn = _closeBtn(ov);
    if (btn) { btn.click(); return true; }
    // Fallback (modale senza X): nasconde comunque, senza cleanup specifico.
    ov.classList.remove('open');
    ov.style.display = 'none';
    return true;
}

// ---- focus-trap -------------------------------------------------------------
function _onKeydown(e) {
    if (e.key !== 'Tab') return;
    const ov = topOpenToolModal();
    if (!ov) return;
    const f = _focusables(ov);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    const active = document.activeElement;
    // Focus fuori dal modale (o sul body) → riportalo dentro.
    if (!ov.contains(active)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
}

// ---- focus iniziale + ripristino --------------------------------------------
let _prevFocus = null;

function _syncFocus(ov) {
    const open = _visible(ov);
    if (open && !ov._a11yOpen) {
        ov._a11yOpen = true;
        _prevFocus = document.activeElement;
        const f = _focusables(ov);
        if (f.length && typeof f[0].focus === 'function') f[0].focus();
    } else if (!open && ov._a11yOpen) {
        ov._a11yOpen = false;
        // Ripristina il focus solo se l'elemento è ancora nel documento.
        if (_prevFocus && document.contains(_prevFocus) && typeof _prevFocus.focus === 'function') {
            _prevFocus.focus();
        }
        _prevFocus = null;
    }
}

let _inited = false;
/** Aggancia focus-trap + osservatore del focus. Idempotente (una volta sola). */
export function initModalA11y() {
    if (_inited) return;
    _inited = true;
    if (typeof document === 'undefined') return;
    document.addEventListener('keydown', _onKeydown);
    if (typeof MutationObserver !== 'function') return;
    const obs = new MutationObserver(muts => {
        const seen = new Set();
        for (const m of muts) {
            const ov = m.target;
            if (seen.has(ov)) continue;
            seen.add(ov);
            _syncFocus(ov);
        }
    });
    // assumeClosed: gli overlay lazy arrivano dal body-observer GIÀ visibili —
    // partire da "chiuso" fa scattare il focus-init di _syncFocus alla prima apertura.
    const reg = (ov, assumeClosed) => {
        obs.observe(ov, { attributes: true, attributeFilter: ['class', 'style'] });
        ov._a11yOpen = assumeClosed ? false : _visible(ov);
        _ensureAria(ov);
    };
    for (const ov of document.querySelectorAll(SEL_OVERLAY)) reg(ov, false);
    // Gli overlay `.drift-overlay` sono creati LAZY (appesi a document.body alla
    // prima apertura): un secondo observer li registra appena compaiono, così
    // ricevono ARIA + focus-init/restore senza toccare i builder.
    const bodyObs = new MutationObserver(muts => {
        for (const m of muts) {
            for (const n of m.addedNodes) {
                if (n.nodeType !== 1 || typeof n.matches !== 'function') continue;
                if (n.matches(SEL_OVERLAY)) { reg(n, true); _syncFocus(n); }
            }
        }
    });
    bodyObs.observe(document.body, { childList: true });
}

// Esposti per i test e2e (page.evaluate); app.js li importa via ESM.
expose({ closeTopToolModal, topOpenToolModal, initModalA11y });
