'use strict';
// ============================================================
// ESCAPING HTML — cricchetto + guardia sullo scanner
// ============================================================
// L'interfaccia è costruita a mano con template literal e `innerHTML`: nessun
// framework escapa al posto nostro. L'invariante «ogni valore interpolato in
// HTML passa da un escaper» regge su più di mille chiamate scritte a mano (1064
// in 36 file, misurate il 2026-08-31), e non era imposta da niente. La cifra
// cresce col prodotto: conta l'ordine di grandezza, non il numero esatto.
// Una dimenticata è una XSS — e l'input NON è solo
// la tastiera dell'operatore: sysName, sysDescr, hostname dei lease DHCP,
// titoli HTTP e nomi dei vicini LLDP arrivano dagli APPARATI, cioè da chiunque
// stia sulla rete che si sta documentando.
//
// Lo scanner sta in tools/html-escape-scan.js (eseguibile a mano per l'elenco:
// `node tools/html-escape-scan.js --list`). Qui ci sono TRE guardie.
//
// ── 1) LO SCANNER MORDE ─────────────────────────────────────────────────────
// La più importante, e la meno ovvia. Lo scanner è EURISTICO: se una modifica
// lo rompesse in direzione permissiva, il cricchetto qui sotto continuerebbe a
// passare — verde per sempre, e cieco. Le fixture fissano il comportamento nei
// due sensi: quello che DEVE essere segnalato e quello che NON deve esserlo.
// Un guard senza questo test protegge sé stesso, non il codice.
//
// ── 2) CRICCHETTO PER FILE ──────────────────────────────────────────────────
// Stessa ricetta di MAX_WIN_REFS: il residuo può solo CALARE. È per FILE e non
// globale per due ragioni. La prima è il messaggio d'errore: dice subito DOVE
// è cresciuto. La seconda è che un tetto unico si lascia erodere — export.js
// da solo pesa 149 (coordinate SVG calcolate, rumore inevitabile) e in un
// totale unico coprirebbe l'aggiunta di un `${d.sysName}` crudo altrove.
//
// ── 3) UN SOLO ESCAPER ──────────────────────────────────────────────────────
// La classe di bug ricorrente del progetto: lo stesso concetto definito due
// volte, le due definizioni divergono, vince quella sbagliata. Al momento della
// scrittura ce n'erano tre: `escapeHTML` (completa), una locale in
// app-dhcp-import.js e due identiche in export.js — queste ultime coprivano 4
// caratteri su 5, fuori l'apice singolo. Nessuna apriva un buco vivo (i loro
// valori finiscono in testo o in attributi con doppi apici), ma è esattamente
// la trappola che si arma da sola: basta che il prossimo riusi quel nome
// dentro un attributo con apici singoli.
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const scan = require('../tools/html-escape-scan');

const ROOT = path.join(__dirname, '..');

// Scansiona un sorgente sintetico, raccogliendone i builder come farebbe il
// corpus vero (per file).
function scanFixture(lines) {
    const src = Array.isArray(lines) ? lines.join('\n') : lines;
    const builders = scan.collectHtmlBuilders([src]);
    return scan.scanSource(src, builders, 'fixture.js');
}
const countUnproven = (lines) => scanFixture(lines).unproven.length;

// ════════════════════════════════════════════════════════════════════════════
// 1) LO SCANNER MORDE — casi che DEVONO essere segnalati
// ════════════════════════════════════════════════════════════════════════════

test('scanner: valore crudo nel testo → segnalato', () => {
    assert.strictEqual(countUnproven('const h = `<div>${d.sysName}</div>`;'), 1);
});

test('scanner: valore crudo in un attributo → segnalato', () => {
    assert.strictEqual(countUnproven('const h = `<td title="${row.descr}">x</td>`;'), 1);
});

test('scanner: valore crudo passato per una variabile locale → segnalato', () => {
    assert.strictEqual(countUnproven([
        'const nome = d.hostname;',
        'const h = `<b>${nome}</b>`;',
    ]), 1);
});

test('scanner: ramo di || non escapato → segnalato (entrambi i rami finiscono a schermo)', () => {
    assert.strictEqual(countUnproven('const h = `<i>${escapeHTML(a) || d.vendor}</i>`;'), 1);
});

test('scanner: ramo di ternario non escapato → segnalato', () => {
    assert.strictEqual(countUnproven("const h = `<i>${vivo ? d.model : ''}</i>`;"), 1);
});

test('scanner: concatenazione con un valore crudo → segnalato', () => {
    assert.strictEqual(countUnproven("const h = `<i>${'MAC ' + d.mac}</i>`;"), 1);
});

test('scanner: funzione che ritorna una stringa GREZZA non passa per builder', () => {
    // È la regressione che conta: una prima versione della regola compositiva
    // guardava "i 4000 caratteri dopo la definizione" invece del corpo vero, e
    // in un file denso di HTML finiva per promuovere a builder qualunque
    // funzione — anche questa, che ritorna testo non escapato.
    assert.strictEqual(countUnproven([
        "function vendorLabel(d){ return d.vendor || '—'; }",
        'const h = `<td>${vendorLabel(d)}</td>`;',
    ]), 1);
});

test('scanner: un regex con apici non lo desincronizza', () => {
    // `/[",;\n]/` contiene un apice doppio: letto come inizio di stringa, il
    // parser si mangiava il resto del file e i template successivi sparivano —
    // 249 interpolazioni invisibili, quasi tutte in export.js e drawio-export.
    assert.strictEqual(countUnproven([
        'const csv = v => /[",;\\n]/.test(v) ? v : v;',
        'const h = `<div>${d.sysName}</div>`;',
    ]), 1);
});

// ── Il punto cieco dei TEMPLATE ANNIDATI (chiuso il 2026-08-31) ─────────────
// `isProvablySafe` assolve un'interpolazione che sia un template intero, con la
// motivazione che quel template «lo scansiona a parte». Per anni quella frase e'
// stata falsa: `readExpr` inghiottiva il template annidato come testo opaco, le
// sue interpolazioni non erano ne' classificate ne' CONTATE, e un valore a un
// livello di profondita' era invisibile. Queste fixture tengono vera la frase.

test('scanner: valore crudo dentro un template ANNIDATO → segnalato', () => {
    assert.strictEqual(countUnproven(
        'const h = `<div>${`<span>${d.userName}</span>`}</div>`;'
    ), 1);
});

test('scanner: valore crudo in un template annidato dentro un TERNARIO → segnalato', () => {
    assert.strictEqual(countUnproven(
        "const h = `<div>${cond ? `<span>${d.userName}</span>` : ''}</div>`;"
    ), 1);
});

test('scanner: due livelli di annidamento → segnalato lo stesso', () => {
    assert.strictEqual(countUnproven(
        'const h = `<div>${`<i>${`<b>${d.x}</b>`}</i>`}</div>`;'
    ), 1);
});

test('scanner: annidato senza tag propri → segnalato (l\'HTML lo mette il padre)', () => {
    // Il figlio non ha un tag suo, ma finisce dentro l'HTML del padre: il flag
    // «sono dentro HTML» si eredita, altrimenti ogni `.map(x => `${x.nome}`)`
    // resterebbe fuori dal conto.
    assert.strictEqual(countUnproven(
        "const h = `<ul>${items.map(i => `${i.nome}`).join('')}</ul>`;"
    ), 1);
});

test('scanner: un template annidato in un contesto NON html resta fuori', () => {
    assert.strictEqual(countUnproven('const q = `SELECT ${`${x}`}`;'), 0);
});

test('scanner: un apostrofo in un commento non fa sparire il template che segue', () => {
    // Il codice e i commenti sono in italiano: dentro un'interpolazione che
    // contiene un blocco (`${items.map(i => { … })}`) un solo `'` apriva una
    // stringa e mangiava il resto dell'espressione — template annidato incluso.
    const conApostrofo = [
        'const h = `<ul>${items.map(i => {',
        "    // un apostrofo solo: l'invariante",
        '    return `<li>${i.nome}</li>`;',
        "}).join('')}</ul>`;",
    ];
    const senzaApostrofo = [
        'const h = `<ul>${items.map(i => {',
        '    // nessun apostrofo qui',
        '    return `<li>${i.nome}</li>`;',
        "}).join('')}</ul>`;",
    ];
    // Stesso codice, stesso esito: il commento non deve contare.
    assert.strictEqual(countUnproven(conApostrofo), countUnproven(senzaApostrofo));
    assert.strictEqual(scanFixture(conApostrofo).interpolations,
        scanFixture(senzaApostrofo).interpolations);
    assert.strictEqual(countUnproven(conApostrofo), 1);
});

// ════════════════════════════════════════════════════════════════════════════
// 1-bis) LO SCANNER NON ABBAIA A VUOTO — casi che NON vanno segnalati
// ════════════════════════════════════════════════════════════════════════════

test('scanner: escapeHTML esplicito → pulito', () => {
    assert.strictEqual(countUnproven('const h = `<div>${escapeHTML(d.sysName)}</div>`;'), 0);
});

test('scanner: alias locale dell\'escaper → pulito', () => {
    assert.strictEqual(countUnproven([
        'const esc = s => escapeHTML(String(s == null ? "" : s));',
        'const h = `<div>${esc(d.sysName)}</div>`;',
    ]), 0);
});

test('scanner: alias importato dell\'escaper → pulito', () => {
    assert.strictEqual(countUnproven([
        "import { escapeHTML as esc } from './app-util.js';",
        'const h = `<div>${esc(d.hostname)}</div>`;',
    ]), 0);
});

test('scanner: stringa i18n → pulito (viene dal dizionario, non dalla rete)', () => {
    assert.strictEqual(countUnproven("const h = `<div>${t('pnl.title')}</div>`;"), 0);
});

test('scanner: numeri e .length → pulito', () => {
    assert.strictEqual(countUnproven('const h = `<span>${n.ports.length}</span>`;'), 0);
});

test('scanner: ternario fra letterali → pulito, e la CONDIZIONE non conta', () => {
    // La condizione non finisce nell'output: chiederle l'escape sarebbe rumore.
    assert.strictEqual(countUnproven("const h = `<i class=\"${d.sysName ? 'on' : 'off'}\"></i>`;"), 0);
});

test('scanner: map+join di template annidati → pulito (i pezzi li scansiona lui)', () => {
    assert.strictEqual(countUnproven(
        "const h = `<ul>${items.map(x => `<li>${escapeHTML(x)}</li>`).join('')}</ul>`;"
    ), 0);
});

test('scanner: builder HTML dello stesso file → pulito (regola compositiva)', () => {
    assert.strictEqual(countUnproven([
        'function rigaHtml(d){ return `<tr><td>${escapeHTML(d.ip)}</td></tr>`; }',
        'const h = `<table>${rigaHtml(d)}</table>`;',
    ]), 0);
});

test('scanner: template ARGOMENTO di un escaper → pulito (lo escapa chi lo contiene)', () => {
    // La discesa nei template annidati non deve entrare qui dentro: quel
    // template esce gia' protetto dalla chiamata che lo avvolge.
    assert.strictEqual(countUnproven(
        'const h = `<div t="${escapeHTML(`VLAN ${v} — ${nome}`)}">x</div>`;'
    ), 0);
});

test('scanner: template ARGOMENTO di un builder → pulito (il rosso scatta nel builder)', () => {
    // Un argomento e' un INGRESSO di una funzione il cui corpo lo scanner
    // gia' controlla: se quel builder interpolasse il parametro crudo, il
    // rilievo comparirebbe a casa sua. E' la stessa regola compositiva dei
    // valori di ritorno, e allinea i template al trattamento che gli argomenti
    // NON template hanno sempre avuto (non contano come interpolazione).
    assert.strictEqual(countUnproven([
        'function intestazione(t){ return `<h3>${escapeHTML(t)}</h3>`; }',
        'const h = `<div>${intestazione(`${node.name} — ${label}`)}</div>`;',
    ]), 0);
});

test('scanner: t() NON escapa i suoi parametri → il valore dentro va segnalato', () => {
    // `t('k', {n: …})` sostituisce {n} nella stringa del dizionario SENZA
    // escaparla: una funzione i18n non e' un escaper, e non deve diventarlo
    // per sbaglio quando si esclude la discesa negli argomenti altrui.
    assert.strictEqual(countUnproven(
        "const h = `<div>${t('k', {n: `<b>${found}</b>`})}</div>`;"
    ), 1);
});

test('scanner: il corpus non è vuoto (il cricchetto non è vacuo)', () => {
    // Se un refactor spostasse i file o rompesse il parser, `unproven` andrebbe
    // a zero e tutti i tetti passerebbero: verde per il motivo sbagliato.
    const { interpolations, unproven, files } = scan.scanCorpus();
    assert.ok(files.length >= 100, `corpus troppo piccolo: ${files.length} file`);
    assert.ok(interpolations > 2000, `interpolazioni HTML = ${interpolations}: lo scanner non sta leggendo il frontend`);
    assert.ok(unproven.length > 0, 'zero residuo: sospetto, lo scanner ha smesso di guardare');
});

// ════════════════════════════════════════════════════════════════════════════
// 2) CRICCHETTO PER FILE
// ════════════════════════════════════════════════════════════════════════════
// Come abbassarli: bonifica un file (avvolgi in escapeHTML, o estrai un
// builder), rilancia `node tools/html-escape-scan.js` e riporta qui il numero
// nuovo. Il test stampa da solo i file scesi. Alzare un tetto è ammesso solo
// con una RAGIONE scritta accanto alla riga — come si fa con MAX_WIN_REFS.
//
// Cosa c'è dentro, in ordine di peso: coordinate SVG calcolate (export.js),
// identificatori generati (`n.id`, `l.id`, `pid`), contatori di ciclo, e
// soprattutto PARAMETRI DI FUNZIONE (`label`, `icon`, `col`) — che uno scanner
// senza analisi interprocedurale non può risolvere nemmeno quando il chiamante
// passa un valore già escapato. Sono «non dimostrati», non «sbagliati».
// ⚠️ RIBASATI IL 2026-08-31, e non per una regressione: lo scanner ha smesso di
// essere CIECO su due punti, e i tetti sono saliti di conseguenza.
//
//   ① I TEMPLATE ANNIDATI non venivano guardati. `isProvablySafe` assolveva
//      un'interpolazione che fosse un template scrivendo «scansionato a parte»,
//      e quella scansione non esisteva: un valore a UN livello di profondita'
//      era invisibile — e nemmeno CONTATO.
//   ② I COMMENTI dentro un'espressione desincronizzavano il parser: un solo
//      apostrofo in un `//` italiano apriva una stringa e faceva sparire il
//      template che seguiva.
//
// Misurato sulle STESSE sorgenti, per isolare il cambio dello scanner dal codice:
// interpolazioni contate **3810 → 4922**, residuo **624 → 788**. Quei 164 non
// sono peggiorati oggi: erano li' e non si vedevano. Sette rilievi risultano
// invece assorbiti, tutti legittimi — con i commenti gestiti, `readRhs` risolve
// l'assegnazione intera e la regola del `.join()` diventa applicabile *perche'*
// adesso i pezzi che unisce vengono davvero scansionati.
//
// Delle 160 voci emerse, UNA sola meritava una correzione invece di un tetto:
// `spec.stackMemberId` nella lista membri dello stack, ora escapato come il nome
// che gli sta accanto (src/app-properties-node.js). Le altre sono numeri, id
// generati, frammenti gia' controllati dove nascono, o il limite dichiarato dello
// scanner sui parametri di funzione.
const CAPS = {
    'export.js': 149,
    'lib/drawio-export.js': 21,
    // La mappa inter-sede del dossier (2.11). I 25 residui sono NUMERI, tutti:
    // le coordinate passano da `_n()` — arrotondamento a 0.01 — e la misura del
    // viewBox da `W`/`H`, che vengono dal layout puro (lib/inter-site-layout.js,
    // sotto test). Nessun testo di nessuno le attraversa. Ciò che è TESTO passa
    // invece da `_esc`, cioè dall'escaper XML condiviso, e lo scanner lo prova.
    'lib/inter-site-svg.js': 25,
    'src/app-audit.js': 3,
    'src/app-auth.js': 6,
    // L'unico residuo e' `${c}` nelle intestazioni dell'anteprima CSV, dove `c`
    // scorre un ARRAY DI LETTERALI scritto due righe sopra ('name','hostname',…).
    // I dati del file caricato — quelli si' non fidati — passano da escapeHTML().
    'src/app-csv-import.js': 1,
    'src/app-discovery.js': 14,
    'src/app-drift-adopt.js': 3,
    'src/app-drift.js': 15,
    'src/app-hypervisor.js': 9,
    'src/app-integrations.js': 27,
    // Sedi e collegamenti (2.11, layer multi-sede). Tutto cio' che arriva
    // dall'utente o dal server passa da escapeHTML(), e le coordinate SVG da
    // Number(): questi sette residui sono composizione, che lo scanner non
    // risolve per costruzione.
    //   · `interSiteEdgePath(e)` costruisce "M x y Q .. L .." da numeri gia'
    //     arrotondati in lib/inter-site-layout.js (sotto test): nessun testo di
    //     nessuno lo attraversa;
    //   · `_siteOptions`/`_projectOptions`/`_deviceOptions` sono .map(_opt) e
    //     concatenazioni, e _opt e' un builder riconosciuto che escapa valore ed
    //     etichetta (le sole altre stringhe sono le `<optgroup label>`, escapate
    //     a mano) — ma una funzione che RITORNA una concatenazione non contiene
    //     un template HTML, quindi non entra nell'elenco dei builder;
    //   · `_renderBody()` e `_deviceStatus()` ritornano il risultato di un'ALTRA
    //     builder (rispettivamente la render della scheda e un helper `hint` che
    //     escapa il testo): non contengono un template HTML in proprio, quindi
    //     restano fuori dall'elenco dei builder pur non emettendo mai testo crudo;
    //   · `drop` e' una variabile che tiene un template gia' scansionato.
    'src/app-inter-site.js': 20,
    'src/app-l3.js': 9,
    'src/app-management.js': 9,
    'src/app-panel-skin.js': 3,
    'src/app-pdu-connection.js': 2,
    'src/app-popup.js': 21,
    'src/app-ports.js': 2,
    'src/app-properties-floor.js': 13,
    // −3 (2.10.1, da 15): la sezione VLAN del pannello cavo e' stata riscritta e i
    // valori che finiscono dentro style="…" e value="…" — colore del pallino, colore
    // della provenienza, VLAN dichiarata e mostrata, id del link — ora passano
    // dall'escaper invece di essere interpolati crudi. Il colore arriva dal color
    // picker dell'utente: era il piu' esposto dei quattro.
    'src/app-properties-link.js': 57,
    'src/app-properties-node-devices.js': 87,
    // −3 (2.10.1, da 49): la riga del gruppo LAG ha guadagnato il campo VLAN del
    // bundle, e nel farlo i quattro `data-gid` di quella riga sono passati
    // dall'escaper. Non e' cosmesi: per un LAG scoperto via SNMP il gid e'
    // costruito dal nome dell'apparato, cioe' testo che arriva dalla rete e
    // finiva crudo dentro un attributo.
    'src/app-properties-node.js': 79,
    'src/app-properties-port.js': 45,
    'src/app-properties-vm.js': 16,
    'src/app-properties.js': 15,
    'src/app-render-core.js': 38,
    'src/app-shared-segment.js': 25,
    'src/app-snmp.js': 2,
    'src/app-spare.js': 8,
    'src/app-topology-crawl.js': 4,
    'src/app-topology-discover.js': 1,
    // +1 (2.10.1): `${CABLE_VLAN_UNKNOWN}` nella pillola «VLAN non rilevata» della
    // legenda. È una COSTANTE esportata da src/app-link-color.js (un hex scritto nel
    // sorgente), non un valore che arriva da fuori — lo scanner non risolve gli import
    // e non può dimostrarlo. Avvolgerla in escapeHTML() fingerebbe un rischio che non
    // c'è; le `${col}` accanto, già sotto il tetto, sono dato UTENTE e quindi più
    // esposte di questa.
    'src/app-topology-overlay.js': 10,
    'src/app-vlan-autopoll.js': 19,
    'src/app-wifi.js': 29,
    // +1 (2026-08-31): `${badgeInk(m.color)}` nel badge di stato-di-prova del cavo.
    // `badgeInk` (src/app-util.js) ritorna UNO DI DUE LETTERALI scritti nel sorgente
    // ('#fff' o '#0d1117') e nient'altro: non è una funzione che possa restituire
    // testo libero. Lo scanner dichiara di non fare analisi interprocedurale, quindi
    // non può dimostrarlo. Avvolgerla in escapeHTML() fingerebbe un rischio che non
    // c'è — stesso ragionamento già scritto sopra per CABLE_VLAN_UNKNOWN.
    'src/app.js': 3,
};

test('cricchetto: nessun file supera il suo tetto di interpolazioni non provate', () => {
    const { unproven } = scan.scanCorpus();
    const byFile = new Map();
    for (const u of unproven) byFile.set(u.file, (byFile.get(u.file) || 0) + 1);

    const cresciuti = [];
    for (const [file, n] of byFile) {
        const cap = CAPS[file] || 0;
        if (n > cap) {
            // Si elencano TUTTE le interpolazioni non provate del file, non «le
            // ultime n-cap»: senza una linea di base non si sa quale sia quella
            // nuova, e indicare righe a caso manderebbe a caccia di fantasmi.
            const righe = unproven.filter(u => u.file === file);
            cresciuti.push(`  ${file}: ${n} > ${cap}  (+${n - cap})\n` +
                `    tutte le non provate del file — la nuova è fra queste:\n` +
                righe.slice(0, 25).map(u => `      riga ${u.line}: \${${u.expr.slice(0, 80)}}`).join('\n') +
                (righe.length > 25 ? `\n      …e altre ${righe.length - 25}` : ''));
        }
    }
    assert.strictEqual(cresciuti.length, 0,
        'interpolazioni in HTML non dimostrate sicure, sopra il tetto:\n' + cresciuti.join('\n') +
        '\n\n  Avvolgi il valore in escapeHTML(), oppure — se è davvero sicuro — spiega perché\n' +
        '  e alza il tetto in test/html-escaping.test.js. Elenco completo:\n' +
        '      node tools/html-escape-scan.js --list');

    // Promemoria non bloccante: quando un file cala, stringi il tetto.
    const scesi = Object.keys(CAPS)
        .filter(f => (byFile.get(f) || 0) < CAPS[f])
        .map(f => `${f}: ${byFile.get(f) || 0} < ${CAPS[f]}`);
    if (scesi.length) console.log(`[ratchet] escaping, tetti da abbassare → ${scesi.join(' · ')}`);
});

// ════════════════════════════════════════════════════════════════════════════
// 3) UN SOLO ESCAPER
// ════════════════════════════════════════════════════════════════════════════

test('escaping: nel frontend esiste UNA sola definizione di escape HTML', () => {
    // Firma di un escaper: un replace su una classe di caratteri che contiene
    // sia & sia < (chi ne cita uno solo sta facendo altro).
    const FIRMA = /replace\(\s*\/\[[^\]]*&[^\]]*<[^\]]*\]/;
    // Variante a catena: .replace(/&/g, …).replace(/</g, …)
    const FIRMA_CATENA = /replace\(\s*\/&\/g[^)]*\)\s*\.\s*replace\(\s*\/<\/g/;

    const trovati = [];
    for (const rel of scan.corpusFiles()) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        if (FIRMA.test(code) || FIRMA_CATENA.test(code)) trovati.push(rel);
    }

    // app-util.js = l'escaper HTML condiviso.
    // xml-escape.js = l'escaper XML condiviso: escape COMPLETO sui 5 caratteri,
    //   entità XML (&apos; invece di &#39;). Concetto diverso da quello HTML, e
    //   legittimamente separato — ma UNO SOLO anche lui. Stava dentro
    //   `lib/drawio-export.js` finché il formato XML che uscivamo era uno; col
    //   secondo (l'SVG della mappa inter-sede nel dossier, 2.11) è diventato un
    //   modulo invece di una seconda copia identica. Lo consumano drawio-export
    //   e inter-site-svg.
    assert.deepStrictEqual(trovati.sort(), ['lib/xml-escape.js', 'src/app-util.js'],
        'è comparsa una nuova definizione di escape. Usa escapeHTML di src/app-util.js\n' +
        '  (o importalo con un alias): due definizioni dello stesso concetto divergono,\n' +
        '  e vince sempre quella incompleta.');
});

test('escaping: escapeHTML neutralizza tutti e cinque i caratteri', () => {
    // Si prova l'implementazione VERA, estratta dal file ed eseguita: una copia
    // riscritta qui proverebbe soltanto che so scrivere due volte la stessa
    // regex. app-util.js è ESM e non si può `require` da qui, quindi si isola
    // la funzione e la si compila.
    const src = fs.readFileSync(path.join(ROOT, 'src', 'app-util.js'), 'utf8');
    const from = src.indexOf('export function escapeHTML');
    assert.ok(from >= 0, 'escapeHTML non è più dichiarata in src/app-util.js');
    const body = src.slice(from, src.indexOf('/** ID univoco', from)).replace('export ', '');
    const escapeHTML = new Function(`${body}; return escapeHTML;`)();

    assert.strictEqual(escapeHTML('<img src=x onerror=\'alert(1)\'>'),
        '&lt;img src=x onerror=&#39;alert(1)&#39;&gt;');
    // Uscita ESATTA per ciascuno dei cinque. Non «non contiene il carattere»:
    // per la & sarebbe falso comunque, visto che &amp; una & ce l'ha dentro.
    const ATTESI = { '&': 'x&amp;y', '<': 'x&lt;y', '>': 'x&gt;y', '"': 'x&quot;y', "'": 'x&#39;y' };
    for (const [ch, atteso] of Object.entries(ATTESI)) {
        assert.strictEqual(escapeHTML(`x${ch}y`), atteso, `escapeHTML sbaglia su ${ch}`);
    }
    // Null/undefined non devono diventare la stringa "null"/"undefined".
    assert.strictEqual(escapeHTML(null), '');
    assert.strictEqual(escapeHTML(undefined), '');
});
