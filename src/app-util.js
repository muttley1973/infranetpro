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

/** Lo stato di questa porta è NOTO? (dichiarato dall'utente o misurato via SNMP)
 *  `normalizeStatus(undefined)` vale 'inactive' — un default deliberato per
 *  DISEGNARE (il grigio neutro), che però non va mai spacciato per un fatto:
 *  una porta mai osservata non è «spenta», è NON DETERMINATA. Chi scrive una
 *  parola o preseleziona un campo dichiarato deve chiedere prima a questa. */
export function hasPortStatus(pi) {
    const p = pi || {};
    return p.statusOvr != null || (p.status != null && p.status !== '');
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

// ─────────────────────────────────────────────────────────────
// ANCORE VISUALI — quale ELEMENTO rappresenta una porta o un apparato
// ─────────────────────────────────────────────────────────────
// `data-pid` e `data-id` sono DUAL-USE: oltre al LED della porta nel rack e al
// tile sulla planimetria, li portano anche i controlli del pannello Proprietà
// (input/select/button che modificano QUELLA porta). Un
// `document.querySelector('[data-pid=…]')` nudo restituisce il PRIMO del
// documento — e con il pannello Proprietà renderizzato quel primo è un controllo
// del pannello, che quando la scheda attiva è un'altra ha rect 0×0 a (0,0): chi
// disegna un cavo lo tira dall'angolo, chi evidenzia una porta illumina un bottone.
// Chi cerca la POSIZIONE o l'ASPETTO di una porta deve passare da qui.
export const PORT_ANCHOR_SEL = '.floor-node [data-pid], .rack-device [data-pid]';

function _cssEsc(v) {
    const s = String(v == null ? '' : v);
    return (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(s) : s;
}

/** L'ancora visuale di una porta: il LED nel rack o il pin sul tile. Mai un controllo del pannello. */
export function portAnchorEl(pid) {
    if (pid == null || pid === '') return null;
    const e = _cssEsc(pid);
    return document.querySelector(`.floor-node [data-pid="${e}"], .rack-device [data-pid="${e}"]`);
}

/** Il tile di un apparato sulla planimetria. */
export function floorNodeEl(id) {
    if (id == null || id === '') return null;
    return document.querySelector(`.floor-node[data-id="${_cssEsc(id)}"]`);
}

/** L'apparato dentro il telaio del rack. */
export function rackDeviceEl(id) {
    if (id == null || id === '') return null;
    return document.querySelector(`.rack-device[data-id="${_cssEsc(id)}"]`);
}

/** Un elemento è disegnabile qui e ora? Nascosto o fuori vista = rect 0×0: non ci si ancora nulla. */
export function isDrawable(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
}

// Ponte legacy: i classic script (export.js usa normalizeStatus/normalizeNumber)
// e gli onclick="" inline leggono questi helper dallo scope globale. Sparirà a
// ritiro del ponte completato.
expose({ escapeHTML, uid, normalizeNumber, normalizeStatus, hasPortStatus, normalizeMacAddress, hexToRgba, _shadeHex });
