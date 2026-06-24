// ============================================================
// UTIL — helper PURI di stringa/HTML/id     [modulo ESM foglia, ex app.js]
// ============================================================
// Estratti dal god-file app.js (riduzione monolite) per dare loro una casa ESM
// SENZA dipendenze: i moduli src/ li IMPORTANO (niente più lettura dal ponte
// win.escapeHTML / win.uid), mentre restano esposti su window per i consumatori
// CLASSIC (export.js) e gli handler inline dell'HTML.
//
// Modulo FOGLIA puro → non importa nessun altro modulo glue → nessun ciclo:
// è il primo passo-template del ritiro del ponte.
// ============================================================
import { expose } from './_bridge.js';

/** Escape dei 5 caratteri pericolosi prima dell'inserimento in HTML. */
export function escapeHTML(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** ID univoco con prefisso: timestamp base36 + 3 caratteri casuali. */
export function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** parseInt tollerante con fallback e clamp [min,max]. */
export function normalizeNumber(v, fb, min = -Infinity, max = Infinity) {
    let n = parseInt(v, 10); if (Number.isNaN(n)) n = fb; return Math.max(min, Math.min(max, n));
}

/** Normalizza uno stato porta/device a uno dei valori ammessi. */
export function normalizeStatus(s) {
    return ['inactive', 'active', 'fault', 'idle'].includes(s) ? s : 'inactive';
}

/** Normalizza un MAC a formato AA:BB:CC:DD:EE:FF (accetta i formati comuni). */
export function normalizeMacAddress(v) {
    const raw = String(v || '').trim();
    if (!raw) return '';
    // Supporta: aabbccddeeff, aa-bb-cc-dd-ee-ff, aa:bb:cc:dd:ee:ff, aabb.ccdd.eeff
    const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (hex.length === 12) return hex.match(/.{1,2}/g).join(':');
    return raw.toUpperCase();
}

/** Converte colore hex (#rrggbb) + valore alpha (0-1) in rgba(...). */
export function hexToRgba(hex, alpha) {
    if (!hex || !hex.startsWith('#')) return hex || 'transparent';
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    return `rgba(${r},${g},${b},${alpha})`;
}

/** Schiarisce/scurisce un hex (#rrggbb) di un fattore moltiplicativo. */
export function _shadeHex(hex, factor) {
    if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return '';
    const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
    const r = clamp((parseInt(hex.slice(1, 3), 16) || 0) * factor);
    const g = clamp((parseInt(hex.slice(3, 5), 16) || 0) * factor);
    const b = clamp((parseInt(hex.slice(5, 7), 16) || 0) * factor);
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// Ponte legacy: i classic script (export.js usa normalizeStatus/normalizeNumber)
// e gli onclick="" inline leggono questi helper dallo scope globale. Sparirà a
// ritiro del ponte completato.
expose({ escapeHTML, uid, normalizeNumber, normalizeStatus, normalizeMacAddress, hexToRgba, _shadeHex });
