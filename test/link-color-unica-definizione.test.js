// ============================================================
// GUARDIA — «di che colore è questo cavo» deve restare UNA domanda sola
// ============================================================
// La classe di bug più ricorrente del progetto: lo stesso concetto definito in
// due strati che poi divergono. Il colore del cavo ci era già finito dentro —
// otto punti che rispondevano da soli, e la topologia usava la «VLAN dominante»
// mentre il rack usava la nativa, quindi lo stesso cavo aveva due colori.
//
// Questa guardia non prova un comportamento: prova che la REGOLA non si sia
// duplicata. Non basta il golden — un nono punto che ricalcola il colore passa
// tutti i test finché non diverge, e a quel punto è già in produzione.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// L'unico modulo autorizzato a tradurre «VLAN del cavo» in un colore.
const PROPRIETARIO = 'src/app-link-color.js';

/** Tutti i sorgenti che compongono l'app (no dist/, no node_modules, no test). */
function sorgenti() {
    const out = [];
    const giro = (rel) => {
        for (const nome of fs.readdirSync(path.join(ROOT, rel))) {
            const r = rel ? rel + '/' + nome : nome;
            const st = fs.statSync(path.join(ROOT, r));
            if (st.isDirectory()) { if (!/^(node_modules|dist|\.git|\.worktrees|_local|projects|test)$/.test(nome)) giro(r); }
            else if (nome.endsWith('.js')) out.push(r);
        }
    };
    for (const d of ['src', 'lib', 'server']) giro(d);
    out.push('export.js');
    return out;
}

test('colore cavo: nessuno ricalcola «vlanColors[VLAN del cavo]» per conto suo', () => {
    const files = sorgenti();
    // Il cricchetto non deve poter passare a vuoto: se la scansione non trova
    // nulla, la guardia non sta guardando niente.
    assert.ok(files.length > 60, `corpus troppo piccolo (${files.length} file): la guardia sarebbe vacua`);
    assert.ok(files.includes('export.js') && files.some(f => f.startsWith('src/')),
        'la scansione deve coprire almeno export.js e src/');
    // Controprova del riconoscitore: la riga che il difetto produrrebbe DEVE essere
    // riconosciuta (altrimenti la guardia e\' verde perche\' non sa cosa cercare).
    const spia = "const col = state.vlanColors[_getLinkVlan(l)] || '#6e7681';";
    assert.ok(/vlanColors\s*\[/.test(spia) && /_getLinkVlan\s*\(|\blinkVlan\s*\(|paintVlan\s*\(/.test(spia),
        'il riconoscitore non vede piu\' la forma del difetto');

    const colpevoli = [];
    for (const rel of files) {
        if (rel === PROPRIETARIO) continue;
        const righe = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
        righe.forEach((riga, i) => {
            if (/^\s*(\/\/|\*)/.test(riga)) return;                 // commenti: parlano, non eseguono
            if (!/vlanColors\s*\[/.test(riga)) return;
            // Indicizzare la palette è legittimo (legenda, pannelli VLAN, pallini).
            // Non lo è farlo con la VLAN DI UN CAVO: quella è la domanda che ha già
            // una risposta in src/app-link-color.js.
            if (!/_getLinkVlan\s*\(|\blinkVlan\s*\(|paintVlan\s*\(/.test(riga)) return;
            colpevoli.push(`${rel}:${i + 1}  ${riga.trim().slice(0, 120)}`);
        });
    }
    assert.deepStrictEqual(colpevoli, [],
        'Il colore del cavo si chiede a `_linkColor(l)` (src/app-link-color.js), non si ricalcola:\n  '
        + colpevoli.join('\n  '));
});

test('colore cavo: il proprietario esiste e delega la DECISIONE al modulo puro', () => {
    const glue = fs.readFileSync(path.join(ROOT, PROPRIETARIO), 'utf8');
    // La guardia sopra sarebbe soddisfatta anche cancellando tutto: qui si verifica
    // che il proprietario ci sia davvero e non abbia riscritto la scala in casa.
    assert.match(glue, /from '\.\.\/lib\/link-vlan-color\.js'/, 'la scala di precedenza deve restare nel modulo PURO');
    for (const fn of ['_linkColor', '_linkAutoColor', '_linkPaintVlan', '_linkPaintLabel']) {
        assert.ok(glue.includes('export function ' + fn), PROPRIETARIO + ': manca ' + fn);
    }
    const puro = fs.readFileSync(path.join(ROOT, 'lib/link-vlan-color.js'), 'utf8');
    assert.ok(!/\bdocument\b|\bwindow\b|\bstore\b/.test(puro),
        'lib/link-vlan-color.js deve restare PURA: niente DOM, niente stato globale');
});

test('colore cavo: le viste chiedono al proprietario (nessuna si è sganciata)', () => {
    // Se una di queste smette di chiamarlo, il suo colore è tornato a vivere per
    // conto proprio — che è esattamente com'è cominciata la divergenza.
    const attesi = {
        'src/app.js': /_linkColor\(/,                       // rack, floor, cross-rack
        'export.js': /_linkColor\(/,                        // planimetria SVG/PDF + draw.io
        'src/app-topology-overlay.js': /linkPaintVlan:/,    // topologia (helper iniettato)
        'src/app-properties-link.js': /_linkAutoColor\(/,   // colore proposto dal picker
    };
    for (const [rel, re] of Object.entries(attesi)) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        assert.match(src, re, rel + ' non chiede piu\' il colore a src/app-link-color.js');
    }
});
