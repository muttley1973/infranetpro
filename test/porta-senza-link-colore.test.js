'use strict';
// ============================================================================
// Il colore delle porte «off» è scritto in TRE posti, e devono coincidere
// ============================================================================
// `--shut-color` e `--nolink-color` vivono nel token CSS, e da lì li leggono il
// rack, il pannello porta e la skin vettoriale. Ma i due EXPORT — il dossier SVG
// (`export.js`) e il draw.io (`lib/drawio-export.js`) — scrivono file fuori dal
// browser, dove un token CSS non esiste: hanno la loro copia dello stesso hex.
//
// È la classe di bug che in questo progetto è già costata nove casi: lo stesso
// concetto definito due volte, le due copie divergono, e la differenza si vede
// solo mesi dopo — qui si vedrebbe su un PDF consegnato al cliente, con una
// porta di un colore a schermo e di un altro sulla carta.
//
// Unificare non si può (un `.css` non si importa da Node), quindi vale la
// seconda ricetta della casa: un test che confronta le copie.
//
// ⚠️ E una seconda cosa, che è il motivo per cui questo file nasce oggi: da
// quando «senza link» è AMBRA e non più grigio, deve restare distinguibile da
// `--idle-color`, l'ambra generica di avviso che vive in una trentina di punti
// dell'interfaccia (chip AI, righe di Verifica, campi con override). Due ambre
// che coincidono l'occhio le fonde, e il colore smette di dire qualcosa.
//
// ⚠️ Quel token NON è più uno stato porta: `idle` era la quarta tinta del LED e non
// c'è più (test/stato-porta-senza-idle.test.js spiega perché — una tinta che dopo tre
// Verifiche diventava proprio questa). Sulle porte l'ambra è UNA sola, ed è questa.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const leggi = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Primo valore del token nel blocco DARK (l'app è dark-only; il blocco chiaro
 *  è vestigiale e vive più in basso nello stesso file). */
function token(css, nome) {
    const m = new RegExp('--' + nome + ':\\s*(#[0-9a-fA-F]{3,8})').exec(css);
    assert.ok(m, `token --${nome} non trovato in 01-tokens.css`);
    return m[1].toLowerCase();
}
function costante(src, nome, file) {
    const m = new RegExp(nome + "\\s*=\\s*'(#[0-9a-fA-F]{3,8})'").exec(src);
    assert.ok(m, `costante ${nome} non trovata in ${file}`);
    return m[1].toLowerCase();
}

test('le tre copie del colore «senza link» dicono lo stesso hex', () => {
    const css = leggi('styles/01-tokens.css');
    const atteso = token(css, 'nolink-color');
    assert.equal(costante(leggi('export.js'), 'NOLINK_COLOR', 'export.js'), atteso,
        'export.js (dossier SVG) dipinge le porte senza link di un colore diverso dal rack');
    assert.equal(costante(leggi('lib/drawio-export.js'), 'NOLINK_COLOR', 'lib/drawio-export.js'), atteso,
        'lib/drawio-export.js dipinge le porte senza link di un colore diverso dal rack');
});

test('le tre copie del colore «spenta a mano» dicono lo stesso hex', () => {
    const css = leggi('styles/01-tokens.css');
    const atteso = token(css, 'shut-color');
    assert.equal(costante(leggi('export.js'), 'SHUT_COLOR', 'export.js'), atteso);
    assert.equal(costante(leggi('lib/drawio-export.js'), 'SHUT_COLOR', 'lib/drawio-export.js'), atteso);
});

// ⚠️ La regola che conta NON è quella di 04-floor-rack.css: il gemello in 06-panels.css
// porta `!important` e vince comunque. Un `box-shadow` scritto solo nel primo file non
// arriva allo schermo, e non lo si scopre guardando il file che si è appena modificato —
// è la stessa forma di difetto delle copie qui sopra, con in più il silenzio.
//
// L'invariante è l'ASSE: brilla ciò che chiede qualcosa (senza link = un sintomo da
// andare a guardare), non brilla ciò che è già deciso (spenta a mano). Se un giorno le
// due tornano uguali, uno dei due stati ha smesso di dire la sua.
function decl(css, selettore) {
    const i = css.indexOf(selettore + ' ');
    const j = css.indexOf('{', i);
    assert.ok(i >= 0 && j > i, `regola «${selettore}» non trovata`);
    return css.slice(j, css.indexOf('}', j) + 1);
}
const alone = (regola) => /box-shadow\s*:\s*(?!none)[^;}]+/.test(regola);

test('«senza link» ha l’alone in ENTRAMBE le copie, «spenta a mano» in nessuna', () => {
    for (const rel of ['styles/04-floor-rack.css', 'styles/06-panels.css']) {
        const css = leggi(rel);
        assert.ok(alone(decl(css, '.port-led.no-link')),
            `${rel}: «senza link» ha perso l’alone — se manca qui, lo schermo non ce l’ha`);
        assert.equal(alone(decl(css, '.port-led.admin-down')), false,
            `${rel}: «spenta a mano» ha preso un alone: è una decisione, non chiede niente`);
    }
});

test('controprova: il riconoscitore dell’alone distingue davvero', () => {
    assert.equal(alone('{ background:red; box-shadow:none; }'), false);
    assert.equal(alone('{ background:red; box-shadow:none !important; }'), false);
    assert.equal(alone('{ background:red; }'), false);
    assert.equal(alone('{ box-shadow:0 0 5px var(--nolink-color); }'), true);
    assert.equal(alone('{ box-shadow:0 0 5px var(--nolink-color) !important; }'), true);
});

test('l’ambra della porta non coincide con l’ambra generica di avviso', () => {
    const css = leggi('styles/01-tokens.css');
    assert.notEqual(token(css, 'nolink-color'), token(css, 'idle-color'),
        'l’ambra della porta («senza link da N verifiche») e quella generica di avviso ' +
        'si sono fuse: sullo stesso schermo non si distinguono più');
    // E nemmeno con gli altri tre stati del LED, per lo stesso motivo.
    for (const altro of ['active-color', 'fault-color', 'inactive-color', 'shut-color']) {
        assert.notEqual(token(css, 'nolink-color'), token(css, altro),
            `--nolink-color coincide con --${altro}`);
    }
});

test('il riconoscitore morde: un hex diverso nell’export viene visto', () => {
    // Controprova: senza questa, il test sopra potrebbe passare per non sapere
    // più dove guardare (una costante rinominata, una regex che non aggancia).
    const finto = "const SHUT_COLOR = '#0a0d11', NOLINK_COLOR = '#123456';";
    assert.equal(costante(finto, 'NOLINK_COLOR', 'finto'), '#123456');
    assert.throws(() => costante("const ALTRO = '#000000';", 'NOLINK_COLOR', 'finto'),
        /non trovata/, 'una costante sparita deve far fallire, non passare in silenzio');
});
