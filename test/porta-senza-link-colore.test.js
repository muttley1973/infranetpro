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
// quando «senza link» è AMBRA e non più grigio, deve restare distinguibile
// dall'ambra di `--idle-color` («Pronta»). Sono due stati diversi — uno misurato
// e uno dichiarato — e due stati non possono condividere una tinta, o l'occhio
// li fonde e il colore smette di dire qualcosa.
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

test('«senza link» e «Pronta» non condividono la tinta: sono due stati diversi', () => {
    const css = leggi('styles/01-tokens.css');
    assert.notEqual(token(css, 'nolink-color'), token(css, 'idle-color'),
        'l’ambra misurata («senza link da N verifiche») e quella dichiarata («Pronta») ' +
        'si sono fuse: uno dei due stati ha smesso di essere leggibile');
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
