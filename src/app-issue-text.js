// ============================================================
// ISSUE TEXT — le PAROLE dei validatori puri (cavo · Wi-Fi · catena)
// ============================================================
// Le lib pure (lib/cable-validate.js, lib/wifi-spec.js, lib/cabling.js) non
// parlano nessuna lingua: emettono { level, code, variant?, params? }. Qui si
// compone la frase via i18n, così lo stesso reperto esce in italiano o in
// inglese secondo la lingua attiva — prima i banner erano hardcoded in italiano
// dentro le lib e un utente EN leggeva messaggi che non capiva.
//
// Chiavi: `cbl.<code>[.<variant>].t|.w` · `wfi.<code>.t|.w` · `chn.<code>`.
// Il code arriva in kebab-case dalla lib ed è usato TALE E QUALE nella chiave:
// nessuna tabella di conversione da tenere allineata a mano.
import { t } from './_bridge.js';

// Il testo composto per un reperto di cavo/Wi-Fi: { level, title, why }.
// `ns` = 'cbl' (cable-validate) oppure 'wfi' (wifi-spec).
function _issueText(ns, issue) {
    const i = issue || {};
    const base = ns + '.' + i.code + (i.variant ? '.' + i.variant : '');
    const p = _localizedParams(ns, i);
    return { level: i.level, title: t(base + '.t', p), why: _why(ns, base, p) };
}

// Alcuni params sono CHIAVI da tradurre, non valori da stampare: il mezzo
// (copper/fiber/dac) esce dalla lib come chiave — «Rame»/«Copper» è una parola,
// e le parole si decidono qui. Gli altri params passano intatti.
function _localizedParams(ns, i) {
    const p = Object.assign({}, i.params);
    if (ns === 'cbl' && i.code === 'medium-vs-snmp') {
        p.snmpL = t('cbl.medium.' + p.snmp);
        p.docL = t('cbl.medium.' + p.doc);
    }
    return p;
}

// Il «perché» di norma è una chiave sola. Unica eccezione: speed-cat, dove la
// coda cambia col caso (categoria consigliata · nota Cat6@10G · rame insufficiente):
// la lib sceglie QUALE coda con params.tail, qui si concatena la frase giusta.
function _why(ns, base, p) {
    const w = t(base + '.w', p);
    if (!p.tail) return w;
    return w + ' ' + t(base + '.' + p.tail, p);
}

/** Reperti di lib/cable-validate.js → [{level,title,why}] nella lingua attiva. */
export function cableIssueTexts(issues) {
    return (Array.isArray(issues) ? issues : []).map((i) => _issueText('cbl', i));
}

/** Reperti di lib/wifi-spec.js → [{level,title,why}] nella lingua attiva. */
export function wifiIssueTexts(issues) {
    return (Array.isArray(issues) ? issues : []).map((i) => _issueText('wfi', i));
}

/** Warning di lib/cabling.js (catena) → [stringa] nella lingua attiva. */
export function chainWarnTexts(warnings) {
    return (Array.isArray(warnings) ? warnings : []).map((w) => t('chn.' + (w && w.code), (w && w.params) || {}));
}
