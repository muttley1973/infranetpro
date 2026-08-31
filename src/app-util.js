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

/** Normalizza uno stato porta a uno dei TRE valori ammessi.
 *  ⚠️ `idle` non c'e' piu': una porta o passa pacchetti, o non li passa, o e' guasta.
 *  Il quarto valore raccontava quattro storie diverse (l'etichetta diceva «su ma senza
 *  traffico», l'SNMP ci scriveva dormant/testing che sono l'opposto, la demo ci
 *  scriveva «spenta a mano») e nessuno lo leggeva per decidere qualcosa: era solo una
 *  tinta. Il fatto misurato vive adesso in `pi.operWait`, con la parola dell'apparato.
 *  I progetti salvati prima non hanno bisogno di migrazione: un `'idle'` sul disco
 *  cade nel ramo di sinistra e diventa `'inactive'`, che e' esattamente cio' che
 *  l'apparato stava dicendo. */
export function normalizePortStatus(s) {
    return ['inactive', 'active', 'fault'].includes(s) ? s : 'inactive';
}

/** Lo stato di questa porta è NOTO? (dichiarato dall'utente o misurato via SNMP)
 *  `normalizePortStatus(undefined)` vale 'inactive' — un default deliberato per
 *  DISEGNARE (il grigio neutro), che però non va mai spacciato per un fatto:
 *  una porta mai osservata non è «spenta», è NON DETERMINATA. Chi scrive una
 *  parola o preseleziona un campo dichiarato deve chiedere prima a questa. */
export function hasPortStatus(pi) {
    const p = pi || {};
    return p.statusOvr != null || (p.status != null && p.status !== '');
}

/**
 * La VLAN di questa porta è DETERMINATA? Cioè: qualcuno l'ha dichiarata, oppure
 * misurata, oppure è arrivata propagata da monte.
 *
 * ⚠️ Serve perché `_effPortVlan()` una risposta la dà SEMPRE: senza nessuna fonte
 * scende sulla nativa di sito, che è la risposta giusta per il CAVO — un cavo che
 * commuta sta sempre in una VLAN — ma non è una risposta sulla PORTA. Chi disegna
 * un campo editabile deve distinguere le due cose: un valore scritto dentro un
 * input è un'affermazione, e qui l'affermazione non c'è.
 *
 * ⭐ Sta qui, esportata, perché la usano il pannello Proprietà e la tabella porte
 * del device. Erano due, e dicevano cose diverse: il pannello lasciava il campo
 * vuoto col numero come segnaposto, la tabella ci scriveva `1` — stessa porta,
 * stesso istante, due risposte. Gemella di `hasPortStatus` sopra, stessa forma.
 */
export function hasPortVlan(pi) {
    const p = pi || {};
    return p.vlanOvr != null || p.vlan >= 1 || p.vlanProp != null;
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

/**
 * L'inchiostro leggibile sopra un fondo pieno: bianco sui fondi scuri, lo scuro
 * di pagina sui fondi chiari. REGOLA, non elenco di casi.
 *
 * ⚠️ Nasce da una misura. I badge a fondo pieno scrivevano `color:#fff` fisso, e
 * quattro dei dodici colori non reggevano la soglia AA (4,5:1) col bianco sopra:
 * `#f5a623` «Inferito · da verificare» a **2,03:1** — cioè il badge che dice
 * «non fidarti di questo cavo» era il meno leggibile di tutti — poi `#bf8700`
 * (3,14), `#a371f7` (3,35), `#e8640a` (3,36). Girando l'inchiostro invece del
 * fondo diventano 9,34 · 6,02 · 5,64 · 5,64 **senza cambiare un colore dell'app**.
 *
 * Il fondo resta la decisione di chi disegna; il contrasto smette di esserlo.
 *
 * ⚠️ NESSUNA SOGLIA DI LUMINANZA, di proposito: si CONFRONTANO i due contrasti e
 * vince il maggiore. Una soglia è un numero da azzeccare, e il primo che avevo
 * scritto (0,45) ne correggeva uno su quattro — lasciando `#bf8700` a 3,14 con la
 * guardia contenta. Il punto di pareggio vero sta a 0,204 di luminanza, ma
 * scriverlo vorrebbe dire ricalcolarlo a mano ogni volta che cambia INK_DARK.
 *
 * Un colore non-hex (rgba, var(), un nome CSS) NON si può misurare qui: si
 * risponde bianco, cioè quello che il codice faceva prima.
 * @param {string} hex fondo del badge, forma #rrggbb
 * @returns {string} il colore del testo
 */
const INK_DARK = '#0d1117';   // = --bg-color del tema scuro
const INK_LIGHT = '#fff';
export function badgeInk(hex) {
    if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return INK_LIGHT;
    return _contrast(INK_DARK, hex) > _contrast(INK_LIGHT, hex) ? INK_DARK : INK_LIGHT;
}

/** Luminanza relativa WCAG 2.1 di un hex #rgb o #rrggbb. */
function _relLuminance(hex) {
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const chan = (i) => {
        const c = (parseInt(h.slice(i * 2, i * 2 + 2), 16) || 0) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * chan(0) + 0.7152 * chan(1) + 0.0722 * chan(2);
}

/** Rapporto di contrasto WCAG 2.1 fra due colori hex. */
function _contrast(a, b) {
    const la = _relLuminance(a), lb = _relLuminance(b);
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
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

/**
 * Ogni oggetto-nodo sulla planimetria: il tile di un apparato (`.floor-node`)
 * oppure un contenitore disegnato (`.floor-struct` — stanza, piano, e qualunque
 * altro nasca domani).
 *
 * ⚠️ Qui c'era l'elenco dei contenitori scritto a mano — `.floor-node,
 * .floor-room` — nato quando la stanza era l'unico contenitore esistente. Ha
 * fatto danno DUE volte:
 *   1ª — il trascinamento delle stanze: chi cercava solo i tile tornava null su
 *        una stanza e saltava il proprio lavoro senza dirlo. Il dato si spostava,
 *        il rettangolo restava fermo, e sembrava che si incollasse alla griglia.
 *   2ª — il giorno in cui è nato il PIANO l'elenco non l'ha seguito. Il piano si
 *        disegnava e si ridimensionava (la maniglia risale al `parentElement`,
 *        non passa di qui) ma non si poteva né spostare né cancellare: senza
 *        selezione `deleteNode()` esce alla prima riga.
 * Un selettore che non trova niente non si lamenta — nessun errore, nessun rosso.
 * Perciò il renderer marchia i contenitori con una classe COMUNE e qui si cerca
 * quella: un tipo nuovo non deve più bussare a questa porta.
 */
export const FLOOR_NODE_SEL = '.floor-node, .floor-struct';

export function floorNodeEl(id) {
    if (id == null || id === '') return null;
    const e = _cssEsc(id);
    return document.querySelector(`.floor-node[data-id="${e}"], .floor-struct[data-id="${e}"]`);
}

/**
 * Solo il rettangolo di un contenitore (stanza/piano), mai il tile di un
 * apparato: lo usa chi cambia l'aspetto di una STRUTTURA dal vivo, dove
 * colpire un device sarebbe un errore silenzioso.
 */
export function floorStructEl(id) {
    if (id == null || id === '') return null;
    return document.querySelector(`.floor-struct[data-id="${_cssEsc(id)}"]`);
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

// Ponte legacy: i classic script (export.js usa normalizePortStatus/normalizeNumber)
// e gli onclick="" inline leggono questi helper dallo scope globale. Sparirà a
// ritiro del ponte completato.
expose({ escapeHTML, uid, normalizeNumber, normalizePortStatus, hasPortStatus, normalizeMacAddress, hexToRgba, _shadeHex });
