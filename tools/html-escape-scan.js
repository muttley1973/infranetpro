'use strict';
// ============================================================
//  SCANNER DELL'ESCAPING HTML — analisi statica del frontend
// ============================================================
// L'app costruisce l'interfaccia con template literal e `innerHTML`: non c'e'
// un framework che escapi da solo. L'invariante «ogni valore interpolato in
// HTML passa da escapeHTML()» oggi regge su ~660 chiamate a mano, sparse in 33
// file. Una sola dimenticata e' una XSS — e l'input NON e' solo la tastiera
// dell'operatore: sysName, sysDescr, hostname DHCP, titoli HTTP e nomi dei
// vicini LLDP arrivano dagli APPARATI, cioe' da chiunque sia sulla rete.
//
// Questo modulo trova le interpolazioni `${...}` dentro i template che
// producono HTML e prova a DIMOSTRARLE sicure. Quello che non riesce a
// dimostrare finisce nel residuo, su cui test/html-escaping.test.js tiene un
// cricchetto (stessa ricetta di MAX_WIN_REFS: puo' solo calare).
//
// ── Cosa vale come «sicuro», e perche' ──────────────────────────────────────
//  · escapeHTML(...) e i suoi alias locali/importati        → per definizione
//  · t()/_dt()/... (i18n)   → la stringa viene dal dizionario AUTORIALE, non
//                             dalla rete (lib/i18n.js e' codice, non dato)
//  · letterali, numeri, .length, aritmetica                 → non stampano testo libero
//  · template annidati                                      → li scansiona questo stesso passaggio
//  · selected()/checked()   → tornano una parola chiave di attributo, non un valore
//  · i BUILDER HTML del corpus (regola COMPOSITIVA, vedi sotto)
//
// ── La regola compositiva ───────────────────────────────────────────────────
// Se una funzione definita in questi stessi file ritorna HTML, le SUE
// interpolazioni le controlla questo scanner. Fidarsi del suo valore di
// ritorno non e' allora un atto di fede: e' induzione sul corpus chiuso. La
// regola pero' e' sana SOLO se il corpo della funzione e' delimitato davvero
// (graffe bilanciate) e se l'HTML e' RITORNATO. Una prima versione guardava
// "i 4000 caratteri dopo la definizione": in un file dominato dall'HTML la
// finestra sconfina nelle funzioni vicine e finisce per promuovere a builder
// qualunque cosa — compreso chi ritorna una stringa GREZZA. Da lì il numero
// scendeva a 396 invece di 461: 65 casi nascosti da un bug dello scanner.
//
// ── Limiti dichiarati (non sono bug, sono il prezzo di non avere un parser) ─
//  · niente analisi INTERPROCEDURALE: un parametro di funzione (`label`,
//    `icon`, `col`) non e' risolvibile → resta nel residuo anche quando il
//    chiamante passa un valore gia' escapato. Buona parte dei 461 e' questo.
//  · risoluzione delle variabili locali solo per la PRIMA assegnazione.
//  · l'analisi e' testuale: se sbaglia, sbaglia in modo CONSERVATIVO (segnala
//    di piu', non di meno). L'unica direzione pericolosa e' il falso NEGATIVO,
//    ed e' per questo che il test tiene delle fixture di controllo.
//
// Uso a mano (elenca il residuo, file per file):   node tools/html-escape-scan.js
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// I file che compongono l'interfaccia. Il server non genera HTML per il
// browser (risponde JSON) tranne l'export PDF, che non passa da innerHTML.
const CORPUS_DIRS = ['src', 'lib'];
const CORPUS_EXTRA = ['export.js'];

// ────────────────────────────────────────────────────────────────────────────
// 1) PARSER — template literal e loro interpolazioni
// ────────────────────────────────────────────────────────────────────────────
// Serve un mini-parser e non una regex: i template si annidano (`${a ? `<b>` :
// ''}`), contengono stringhe con backtick e graffe, e una regex sbaglierebbe i
// confini proprio nei casi complicati, cioe' quelli che contano.

// Un '/' apre un REGEX (e non è una divisione) se l'ultimo carattere
// significativo prima è un operatore/apertura o una parola chiave. Senza questo
// il parser si desincronizza: `/[",;\n]/` contiene un apice doppio, che verrebbe
// letto come inizio di stringa e mangerebbe il resto del file fino all'apice
// successivo — spostando i confini dei template e falsando il conteggio.
function regexStartsAt(src, i) {
    let j = i - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j < 0) return true;
    const c = src[j];
    if ('(,=:[!&|?{};+-*%~^<>'.includes(c)) return true;
    if (/[\w$]/.test(c)) {
        let k = j;
        while (k >= 0 && /[\w$]/.test(src[k])) k--;
        return /^(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/.test(src.slice(k + 1, j + 1));
    }
    return false;
}
/** Salta un literal regex che inizia in `i` (che deve essere un '/'). */
function skipRegex(src, i) {
    let j = i + 1, inClass = false;
    while (j < src.length) {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '\n') return i + 1;                // non era un regex: sicurezza
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { j++; break; }
        j++;
    }
    while (j < src.length && /[gimsuyvd]/.test(src[j])) j++;
    return j;
}

function readTemplate(src, start) {
    let i = start + 1;
    const n = src.length;
    let raw = '';
    const parts = [];
    while (i < n) {
        const c = src[i];
        if (c === '\\') { raw += src.slice(i, i + 2); i += 2; continue; }
        if (c === '`') { i++; break; }
        if (c === '$' && src[i + 1] === '{') {
            const e = readExpr(src, i + 2);
            parts.push({ expr: e.text, at: i });
            i = e.end;
            continue;
        }
        raw += c; i++;
    }
    return { start, end: i, raw, parts };
}

function readExpr(src, start) {
    let i = start, depth = 0, text = '';
    const n = src.length;
    while (i < n) {
        const c = src[i];
        if (c === '}' && depth === 0) { i++; break; }
        if (c === '{' || c === '(' || c === '[') depth++;
        if (c === '}' || c === ')' || c === ']') depth--;
        if (c === "'" || c === '"') {
            const q = c; text += c; i++;
            while (i < n && src[i] !== q) { if (src[i] === '\\') { text += src[i]; i++; } text += src[i]; i++; }
            text += src[i]; i++; continue;
        }
        if (c === '`') { const t = readTemplate(src, i); text += src.slice(i, t.end); i = t.end; continue; }
        if (c === '/' && regexStartsAt(src, i)) { const e = skipRegex(src, i); text += src.slice(i, e); i = e; continue; }
        text += c; i++;
    }
    return { text, end: i };
}

/** Tutti i template literal di un sorgente (commenti, stringhe e regex esclusi). */
function scanTemplates(src) {
    const out = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
        if (c === "'" || c === '"') { const q = c; i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; continue; }
        if (c === '`') { const t = readTemplate(src, i); out.push(t); i = t.end; continue; }
        if (c === '/' && regexStartsAt(src, i)) { i = skipRegex(src, i); continue; }
        i++;
    }
    return out;
}

function balanced(s) {
    let d = 0;
    for (const c of s) { if ('([{'.includes(c)) d++; if (')]}'.includes(c)) d--; if (d < 0) return false; }
    return d === 0;
}

/** Spezza su operatori di livello superiore (fuori da parentesi e stringhe). */
function splitTop(expr, ops) {
    const parts = [];
    let depth = 0, cur = '', i = 0;
    while (i < expr.length) {
        const c = expr[i];
        if (c === '(' || c === '[' || c === '{') depth++;
        if (c === ')' || c === ']' || c === '}') depth--;
        if (c === "'" || c === '"' || c === '`') {
            const q = c; cur += c; i++;
            while (i < expr.length && expr[i] !== q) { if (expr[i] === '\\') { cur += expr[i]; i++; } cur += expr[i]; i++; }
            cur += expr[i]; i++; continue;
        }
        let m = null;
        if (depth === 0) for (const op of ops) if (expr.startsWith(op, i)) { m = op; break; }
        if (m) { parts.push(cur); cur = ''; i += m.length; continue; }
        cur += c; i++;
    }
    parts.push(cur);
    return parts;
}

/** Ternario di livello superiore → {cond, then, else} | null.
 *  Distingue il `?` del ternario da `?.` (optional chaining) e `??`. */
function splitTernary(expr) {
    let depth = 0, i = 0, q = -1;
    while (i < expr.length) {
        const c = expr[i];
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === "'" || c === '"' || c === '`') {
            const qc = c; i++;
            while (i < expr.length && expr[i] !== qc) { if (expr[i] === '\\') i++; i++; }
        } else if (c === '?' && depth === 0) {
            if (expr[i + 1] === '?' || expr[i + 1] === '.') { i += 2; continue; }
            q = i; break;
        }
        i++;
    }
    if (q < 0) return null;
    let d2 = 0, j = q + 1, colon = -1;
    while (j < expr.length) {
        const c = expr[j];
        if (c === '(' || c === '[' || c === '{') d2++;
        else if (c === ')' || c === ']' || c === '}') d2--;
        else if (c === "'" || c === '"' || c === '`') {
            const qc = c; j++;
            while (j < expr.length && expr[j] !== qc) { if (expr[j] === '\\') j++; j++; }
        } else if (c === '?' && d2 === 0 && expr[j + 1] !== '.' && expr[j + 1] !== '?') d2++;
        else if (c === ':' && d2 === 0) { colon = j; break; }
        j++;
    }
    if (colon < 0) return null;
    return { cond: expr.slice(0, q), then: expr.slice(q + 1, colon), else: expr.slice(colon + 1) };
}

// ────────────────────────────────────────────────────────────────────────────
// 2) CONTESTO DI FILE — alias dell'escaper e variabili locali
// ────────────────────────────────────────────────────────────────────────────

function readRhs(src, start) {
    let i = start, depth = 0, text = '';
    const n = src.length;
    while (i < n) {
        const c = src[i];
        if (depth === 0 && c === ';') break;
        if (depth === 0 && c === '\n' && text.trim() && balanced(text) && !/[,+?:&|([{=*/-]\s*$/.test(text)) break;
        if (c === '(' || c === '[' || c === '{') depth++;
        if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
        if (c === "'" || c === '"') {
            const q = c; text += c; i++;
            while (i < n && src[i] !== q) { if (src[i] === '\\') { text += src[i]; i++; } text += src[i]; i++; }
            text += src[i]; i++; continue;
        }
        if (c === '`') { const t = readTemplate(src, i); text += src.slice(i, t.end); i = t.end; continue; }
        if (c === '/' && regexStartsAt(src, i)) { const e = skipRegex(src, i); text += src.slice(i, e); i = e; continue; }
        text += c; i++;
    }
    return text.trim();
}

// Gli escaper COMPLETI del repo. `escapeHTML` (src/app-util.js) copre i 5
// caratteri per l'HTML; `escapeXML` (lib/xml-escape.js) copre gli stessi 5 per
// i formati XML che usciamo — il .drawio e l'SVG della mappa inter-sede nel
// dossier: contesto diverso, ma escape completo, quindi vale.
// ⚠️ `_escXml` resta in elenco perché è il nome con cui lo chiama chi lo aveva
// in casa (`lib/drawio-export.js`): togliere un nome da qui non rende un file
// più sicuro, lo rende solo più rumoroso nel cricchetto.
const ESCAPERS = ['escapeHTML', 'escapeXML', '_escXml'];

function buildFileContext(src) {
    // Alias dell'escaper: sia `const esc = escapeHTML` sia `import { escapeHTML as esc }`.
    const escAliases = new Set(ESCAPERS);
    const escRe = new RegExp('\\b(?:' + ESCAPERS.join('|') + ')\\b');
    for (const m of src.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*([^;\n]*)/g)) {
        if (escRe.test(m[2]) && !/`/.test(m[2])) escAliases.add(m[1]);
    }
    for (const m of src.matchAll(/import\s*\{([^}]*)\}/g)) {
        for (const spec of m[1].split(',')) {
            const mm = spec.trim().match(new RegExp('^(?:' + ESCAPERS.join('|') + ')\\s+as\\s+([\\w$]+)$'));
            if (mm) escAliases.add(mm[1]);
        }
    }
    // Variabili locali: prima assegnazione (le riassegnazioni successive non
    // sono tracciate — limite dichiarato).
    const vars = new Map();
    for (const m of src.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*/g)) {
        const rhs = readRhs(src, m.index + m[0].length);
        if (rhs && !vars.has(m[1])) vars.set(m[1], rhs);
    }
    return { escAliases, vars };
}

// ────────────────────────────────────────────────────────────────────────────
// 3) BUILDER HTML DEL CORPUS (regola compositiva)
// ────────────────────────────────────────────────────────────────────────────

/** Corpo `{...}` che inizia subito dopo `from`, a graffe bilanciate. */
function functionBody(src, from) {
    let i = src.indexOf('{', from);
    if (i < 0 || i - from > 200) return '';        // niente corpo a blocco (arrow con espressione)
    let d = 0;
    const start = i;
    while (i < src.length) {
        const c = src[i];
        if (c === "'" || c === '"') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; continue; }
        if (c === '`') { const t = readTemplate(src, i); i = t.end; continue; }
        if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
        if (c === '/' && regexStartsAt(src, i)) { i = skipRegex(src, i); continue; }
        if (c === '{') d++;
        else if (c === '}') { d--; if (d === 0) return src.slice(start, i + 1); }
        i++;
    }
    return src.slice(start);
}

const RETURNS_HTML = /return\s*(?:\(\s*)?[^;]{0,400}?`[^`]{0,400}?<\/?[a-zA-Z]/s;
const FN_DEF = /(?:function\s+([\w$]+)\s*\([^)]*\)|(?:const|let|var)\s+([\w$]+)\s*=\s*(?:function\s*\([^)]*\)|\([^)]*\)\s*=>|[\w$]+\s*=>))/g;

/** Nomi delle funzioni definite in UN sorgente che RITORNANO HTML. */
function collectHtmlBuilders(sourceTexts) {
    const names = new Set();
    for (const src of sourceTexts) {
        for (const m of src.matchAll(FN_DEF)) {
            const name = m[1] || m[2];
            if (!name) continue;
            const body = functionBody(src, m.index + m[0].length);
            if (body && RETURNS_HTML.test(body)) names.add(name);
        }
    }
    return names;
}

/** `import { a, b as c } from './x.js'` → [{ local, orig, from }]. */
function parseImports(src) {
    const out = [];
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
        for (const spec of m[1].split(',')) {
            const s = spec.trim();
            if (!s) continue;
            const as = s.match(/^([\w$]+)\s+as\s+([\w$]+)$/);
            out.push(as ? { local: as[2], orig: as[1], from: m[2] } : { local: s, orig: s, from: m[2] });
        }
    }
    return out;
}

/** Builder VISIBILI in un file: quelli suoi + quelli che vi importa.
 *  Un insieme globale per NOME sarebbe sbagliato: nomi corti e ricorrenti come
 *  `esc`, `row`, `_f` sono definiti in mezzo repo, e basta che UNO ritorni HTML
 *  perché quel nome venga assolto OVUNQUE — anche dove ritorna una stringa
 *  grezza. È un falso negativo silenzioso: esattamente ciò che un guard di
 *  sicurezza non si può permettere. */
function buildersVisibleIn(rel, perFile) {
    const own = perFile.get(rel) || new Set();
    const visible = new Set(own);
    const src = perFile.__texts && perFile.__texts.get(rel);
    if (!src) return visible;
    const dir = path.posix.dirname(rel);
    for (const imp of parseImports(src)) {
        if (!imp.from.startsWith('.')) continue;
        let target = path.posix.normalize(path.posix.join(dir, imp.from));
        if (!target.endsWith('.js')) target += '.js';
        const set = perFile.get(target);
        if (set && set.has(imp.orig)) visible.add(imp.local);
    }
    return visible;
}

// ────────────────────────────────────────────────────────────────────────────
// 4) CLASSIFICAZIONE
// ────────────────────────────────────────────────────────────────────────────

// Funzioni i18n: la stringa esce dal dizionario autoriale, non dalla rete.
const I18N_FNS = new Set(['t', 'tf', '_dt', '_t', 'tHtml', 'tt']);
// Helper che tornano una parola chiave di attributo ('selected' / 'checked' / '').
const ATTR_HELPERS = new Set(['selected', 'checked', 'disabled']);

function isProvablySafe(expr, ctx, builders, seen) {
    seen = seen || new Set();
    let e = String(expr).trim();
    if (!e) return true;
    while (/^\(.*\)$/s.test(e) && balanced(e.slice(1, -1))) e = e.slice(1, -1).trim();
    if (!e) return true;

    if (/^-?[\d.]+$/.test(e) || /^(true|false|null|undefined)$/.test(e)) return true;
    if (/^'[^'\\]*'$/.test(e) || /^"[^"\\]*"$/.test(e)) return true;
    if (/^`/.test(e) && balanced(e)) return true;             // template annidato → scansionato a parte

    // TERNARIO: la condizione NON finisce a schermo, solo i due rami.
    const tern = splitTernary(e);
    if (tern) return isProvablySafe(tern.then, ctx, builders, seen) && isProvablySafe(tern.else, ctx, builders, seen);

    // `a && b`: se `a` e' falsy stampa false/0/''/null — mai HTML. Conta solo l'ultimo.
    const andParts = splitTop(e, ['&&']);
    if (andParts.length > 1) return isProvablySafe(andParts[andParts.length - 1], ctx, builders, seen);

    // `a || b`, `a ?? b`, `a + b`: TUTTI i rami possono finire a schermo.
    for (const ops of [['??'], ['||'], ['+']]) {
        const parts = splitTop(e, ops);
        if (parts.length > 1) return parts.every(p => isProvablySafe(p, ctx, builders, seen));
    }

    const call = e.match(/^([\w.$?]+)\s*\(/);
    if (call && e.endsWith(')') && balanced(e)) {
        const fn = call[1].replace(/\?\./g, '.');
        const base = fn.split('.').pop();
        if (ctx.escAliases.has(fn) || ctx.escAliases.has(base)) return true;
        if (I18N_FNS.has(fn) || I18N_FNS.has(base)) return true;
        if (ATTR_HELPERS.has(fn) || ATTR_HELPERS.has(base)) return true;
        if (builders.has(fn) || builders.has(base)) return true;
        if (/^(Number|parseInt|parseFloat)$/.test(fn)) return true;
        if (/^Math\./.test(fn)) return true;
        if (/^(toFixed|toLocaleString|padStart|padEnd)$/.test(base)) return true;
    }
    // `.join(...)` chiude una catena di pezzi che sono template gia' scansionati.
    if (/\.join\s*\(/.test(e) && balanced(e)) return true;
    if (/^[\w.\s+\-*/%()?:$]+$/.test(e) && /\.(length|size)\b/.test(e)) return true;

    // Variabile locale risolvibile → si guarda cosa ci hanno messo dentro.
    if (/^[\w$]+$/.test(e) && ctx.vars.has(e) && !seen.has(e)) {
        seen.add(e);
        return isProvablySafe(ctx.vars.get(e), ctx, builders, seen);
    }
    return false;
}

const HTMLISH = /<\/?[a-zA-Z][a-zA-Z0-9-]*(\s|>|\/)/;

/** Scansiona UN sorgente. `builders` = insieme dei builder del corpus. */
function scanSource(src, builders, label) {
    const ctx = buildFileContext(src);
    const set = builders || new Set();
    let interpolations = 0;
    const unproven = [];
    for (const tpl of scanTemplates(src)) {
        if (!HTMLISH.test(tpl.raw)) continue;
        for (const part of tpl.parts) {
            interpolations++;
            if (isProvablySafe(part.expr, ctx, set)) continue;
            unproven.push({
                file: label || '(source)',
                line: src.slice(0, part.at).split('\n').length,
                expr: part.expr.replace(/\s+/g, ' ').trim(),
            });
        }
    }
    return { interpolations, unproven };
}

/** Elenco dei file del corpus, relativi alla radice del repo. */
function corpusFiles() {
    const files = [];
    for (const dir of CORPUS_DIRS) {
        const abs = path.join(ROOT, dir);
        if (!fs.existsSync(abs)) continue;
        for (const f of fs.readdirSync(abs).sort()) if (f.endsWith('.js')) files.push(`${dir}/${f}`);
    }
    for (const f of CORPUS_EXTRA) if (fs.existsSync(path.join(ROOT, f))) files.push(f);
    return files;
}

/** Scansiona tutto il frontend. */
function scanCorpus() {
    const files = corpusFiles();
    const texts = new Map();
    for (const rel of files) texts.set(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    // Builder PER FILE, poi resi visibili altrove solo attraverso gli import.
    const perFile = new Map();
    for (const [rel, src] of texts) perFile.set(rel, collectHtmlBuilders([src]));
    perFile.__texts = texts;
    let interpolations = 0;
    let builderCount = 0;
    const unproven = [];
    for (const [rel, src] of texts) {
        const visible = buildersVisibleIn(rel, perFile);
        builderCount += (perFile.get(rel) || new Set()).size;
        const r = scanSource(src, visible, rel);
        interpolations += r.interpolations;
        unproven.push(...r.unproven);
    }
    return { files, builderCount, interpolations, unproven };
}

module.exports = {
    scanCorpus, scanSource, collectHtmlBuilders, corpusFiles, parseImports,
    // esportati per i test dello scanner stesso
    scanTemplates, splitTernary, splitTop, isProvablySafe, buildFileContext, HTMLISH,
};

// ---- CLI: elenca il residuo, per chi lo deve bonificare ---------------------
if (require.main === module) {
    const { interpolations, unproven, builderCount } = scanCorpus();
    const byFile = new Map();
    for (const u of unproven) byFile.set(u.file, (byFile.get(u.file) || 0) + 1);
    console.log(`builder HTML del corpus: ${builderCount}`);
    console.log(`interpolazioni in HTML:  ${interpolations}`);
    console.log(`NON provate sicure:      ${unproven.length}\n`);
    for (const [f, c] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`${String(c).padStart(4)}  ${f}`);
    }
    if (process.argv.includes('--list')) {
        console.log('\n--- dettaglio ---');
        for (const u of unproven) console.log(`${u.file}:${u.line}  ${u.expr.slice(0, 120)}`);
    } else {
        console.log('\n(--list per il dettaglio riga per riga)');
    }
}
