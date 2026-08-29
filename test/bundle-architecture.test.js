'use strict';
// ============================================================
// GUARD ARCHITETTURALE DEL BUNDLE (regola del ponte ESM)
// ============================================================
// Blocca alla radice la classe di bug del 2026-06-16: un lib puro già caricato
// come <script> in netmapper.html (i18n, spare-ports, audit-log, …) NON deve
// finire dentro dist/app.bundle.js. Se ci finisse, la sua UMD ri-eseguirebbe
// Object.assign(window,…) e — col bundle caricato per ULTIMO — sovrascriverebbe
// il global "vivo" con uno snapshot congelato al build (es. dizionario i18n
// stantio → chiavi letterali nei menu). I moduli src/ devono leggere quei lib
// dal ponte (win.* / forward in _bridge.js), non importarli da ../lib.
//
// Il test ricostruisce un bundle fresco (build ~15ms) così è deterministico
// anche in locale senza un `npm run build` precedente.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'dist', 'app.bundle.js');

execFileSync(process.execPath, ['build.js'], { cwd: ROOT, stdio: 'ignore' });
const bundle = fs.readFileSync(BUNDLE, 'utf8');

// Marker UNIVOCI dell'implementazione di ciascun lib <script> (non delle glue
// che li consumano): se compaiono nel bundle, il lib è stato ri-bundlato.
const FORBIDDEN = [
  { marker: "'common.save'", lib: 'i18n.js (dizionario)' },
  { marker: 'AUDIT_CAP_DEFAULT', lib: 'audit-log.js' },
  { marker: 'MS_PER_DAY', lib: 'discovery-history.js' },
];

test('bundle: i lib <script> non sono ri-bundlati (regola del ponte)', () => {
  for (const { marker, lib } of FORBIDDEN) {
    assert.ok(
      !bundle.includes(marker),
      `${lib} risulta dentro dist/app.bundle.js (marker ${marker}). ` +
      `Un modulo src/ lo importa da ../lib invece di leggerlo dal ponte: ` +
      `vedi la REGOLA in _bridge.js.`
    );
  }
});

test('bundle: contiene davvero i moduli migrati (build non vuota)', () => {
  // Sanity: se il bundle fosse vuoto/rotto, il guard sopra passerebbe a vuoto.
  assert.ok(bundle.includes('expose'), 'il bundle deve contenere il ponte expose()');
  assert.ok(bundle.length > 5000, `bundle troppo piccolo (${bundle.length}B): build rotta?`);
});

// ── Nessun sorgente è BINARIO per git ────────────────────────────────
// ⚠️ Successo davvero (2.8.2, lib/audit-log.js): un byte NUL scritto per sbaglio
// dentro una stringa — al posto della sua sequenza di escape — rende il file
// binario agli occhi di git. Il codice gira, i test passano, eslint tace: ma
// `git diff` dice «Binary files differ», `grep` salta il file e una revisione
// non può leggerlo. Si prende solo guardando i byte.
// ── C4 (audit 2026-08-20): il reset di progetto non demuove la Dashboard ─────
// `resetProjectRuntime()` azzera il runtime DI PROGETTO. La topologia ci sta —
// i suoi dati sono di quel progetto. La vista NO: e' una preferenza locale
// (src/app-overview.js `_saveView`) e il <body> resta in `view-overview` anche
// dopo il reset. Quando le due divergevano, `renderOverview` usciva subito a
// ogni passata e la Dashboard restava congelata alla schermata disegnata PRIMA
// che il progetto arrivasse: al caricamento dichiarava «la rete e' ancora vuota»
// su un documento pieno, e al cambio progetto mostrava i numeri del precedente.
// ⚠️ Guardia di SORGENTE, non di comportamento: la funzione non e' raggiungibile
// da Node (ESM di src/, dietro il ponte window) e l'e2e non riproduce l'ordine
// di boot che innesca il difetto — li' il progetto e' gia' caricato quando la
// vista viene ripristinata. Il comportamento e' stato verificato a mano sul
// server di sviluppo, prima e dopo il fix.
test('⚠️ resetProjectRuntime non azzera la vista Dashboard (C4)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'store.js'), 'utf8');
  const at = src.indexOf('export function resetProjectRuntime');
  assert.ok(at >= 0, 'resetProjectRuntime deve stare in src/store.js');
  const body = src.slice(at, src.indexOf('\n}', at));
  const line = body.split('\n').find(l => /store\._viewMode\s*=/.test(l));
  assert.ok(line, 'il reset deve dire qualcosa su _viewMode, anche solo per lasciarlo stare');
  assert.ok(/overview/.test(line),
    'il reset non deve riportare la vista a "map" senza guardare se la Dashboard e\' aperta: '
    + 'il <body> resterebbe in `view-overview` e la Panoramica smetterebbe di ridisegnarsi. '
    + 'Riga trovata: ' + line.trim());
});

test('⚠️ nessun sorgente contiene byte di controllo: git li tratterebbe da binari', () => {
  const files = execFileSync('git', ['ls-files', '*.js', '*.json', '*.css', '*.html', '*.md'],
    { cwd: ROOT, encoding: 'utf8' }).split('\n').map(s => s.trim()).filter(Boolean);
  const bad = [];
  for (const rel of files) {
    let buf;
    try { buf = fs.readFileSync(path.join(ROOT, rel)); } catch (_) { continue; }
    const at = buf.indexOf(0);
    if (at >= 0) bad.push(`${rel} (byte NUL a offset ${at})`);
    // ⚠️ E il CR SOLITARIO, che non è un caso di scuola: successo il 23/08 in
    // lib/i18n.js, generato da uno script che ricuciva una riga già terminata
    // (`riga + NL`) e poi ri-splittava su '\n' — il '\r\n' diventava '\r\r\n'.
    // UN solo byte, e git ha smesso di considerare il file testo: `git add` non
    // ha più normalizzato i fine-riga e il commit conteneva l'INTERO file
    // riscritto, 10.896 righe di rumore attorno a 6 righe vere. Nessun controllo
    // abituale lo vede — il codice gira, eslint tace, i test passano — e il
    // contatore dei fine-riga nemmeno, perché quel '\n' un '\r' davanti ce l'ha.
    const cr = _crSolitario(buf);
    if (cr >= 0) bad.push(`${rel} (CR senza LF a offset ${cr}: git lo tratta da binario)`);
    // ⚠️ E la DOPPIA CODIFICA: un testo UTF-8 letto come latin-1 e riscritto in
    // UTF-8 lascia `Â` o `Ã` davanti al carattere vero. Nessuno se ne accorge
    // finché sta in un commento — ma in `styles/07-modals.css` era finita dentro
    // un `content:'·'`, e il puntino che separa le due sedi dalla natura del
    // collegamento si leggeva raddoppiato in cima a OGNI riga del pannello. Il
    // codice gira, eslint tace, i test passano: la vede solo l'occhio, e solo
    // se guarda quel pannello.
    // In it/en `Â` e `Ã` non compaiono mai per davvero, quindi qui sono sempre
    // un errore di codifica.
    // ⚠️ `data/` è ESCLUSO da questo controllo, e non per comodità: lì dentro ci
    // sono i registri scaricati (OUI dello IEEE, PEN dello IANA), e la doppia
    // codifica sta nel dato di ORIGINE — un nome spagnolo del registro ha la prima
    // parola giusta e la seconda rotta, il che dimostra che non è il nostro
    // lettore a sbagliare (sbaglierebbe tutte e due). Raddrizzarla vorrebbe dire
    // indovinare come si chiama un'azienda. Si lascia il nome come lo dichiara
    // chi lo ha registrato, e lo si dice qui invece di far arrossire un cancello
    // su una cosa che non possiamo sapere.
    const mj = rel.startsWith('data/') ? -1 : _doppiaCodifica(buf);
    if (mj >= 0) bad.push(`${rel} (doppia codifica UTF-8 a offset ${mj}: una testa latin-1 davanti al carattere vero)`);
  }
  assert.deepEqual(bad, [], 'usa la sequenza di escape, non il carattere:\n' + bad.join('\n'));
});

test('⚠️ la sonda della doppia codifica regge: il caso VERO viene visto', () => {
  // Senza questa prova la guardia sopra è una promessa. La prima versione era
  // verde su tutto il repo *e* sul difetto che doveva prendere — cercava un byte
  // di continuazione dove c'è un `C2`. Una guardia che non si prova è una
  // guardia che dice sempre di sì.
  // ⚠️ I casi rotti si scrivono con le SEQUENZE DI ESCAPE, non con i caratteri:
  // scritti per esteso, questo file sarebbe il primo a far arrossire la guardia
  // che sta provando — la prova si mangerebbe la cosa provata.
  const rotto = Buffer.from('content:\'\u00c2\u00b7\';', 'utf8');   // com'era in 07-modals.css
  assert.ok(_doppiaCodifica(rotto) >= 0, 'il separatore rotto del CSS deve essere visto');
  assert.ok(_doppiaCodifica(Buffer.from('x \u00e2\u20ac\u201d y', 'utf8')) >= 0,
    'e anche il trattino lungo rotto, che \u00e8 la forma a tre byte');
  // …e NON deve arrossire su un accento vero, che in questo repo è ovunque.
  assert.equal(_doppiaCodifica(Buffer.from("content:'·'; perché, però, città, è", 'utf8')), -1);
  assert.equal(_doppiaCodifica(Buffer.from('un trattino — vero e «virgolette» vere', 'utf8')), -1);
});

/**
 * Primo punto di doppia codifica, oppure -1.
 *
 * ⚠️ La firma NON è «`Â` seguito da un byte di continuazione»: quella è la
 * prima cosa che viene in mente, ed è sbagliata — la guardia scritta così è
 * andata VERDE sul caso vero. Il giro è questo: `·` è `C2 B7`; letto come
 * latin-1 diventa due caratteri (`Â`, `·`); riscritto in UTF-8 diventa
 * `C3 82  C2 B7`. Il terzo byte è quindi la RICODIFICA del secondo byte
 * originale, che stando fra 0x80 e 0xBF finisce sempre in `C2 xx` — mai un byte
 * di continuazione nudo.
 * Si cercano le due teste che in italiano e in inglese non compaiono mai:
 * `C3 82`/`C3 83` seguiti da `C2`/`C3`, e `C3 A2 E2 82`, che è la stessa cosa per i caratteri a
 * tre byte (trattini lunghi, virgolette tipografiche).
 */
function _doppiaCodifica(buf) {
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === 0xc3 && (buf[i + 1] === 0x82 || buf[i + 1] === 0x83)
        && (buf[i + 2] === 0xc2 || buf[i + 2] === 0xc3)) return i;
    if (buf[i] === 0xc3 && buf[i + 1] === 0xa2 && buf[i + 2] === 0xe2 && buf[i + 3] === 0x82) return i;
  }
  return -1;
}

// Primo CR non seguito da LF, oppure -1. Sui byte: un file misto va guardato per
// com'è scritto sul disco, non per come lo decodifica una stringa.
function _crSolitario(buf) {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] !== 0x0a) return i;
  }
  return -1;
}
