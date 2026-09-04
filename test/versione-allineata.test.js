'use strict';
// ============================================================
// UNA VERSIONE SOLA, DETTA IN PIÙ POSTI (guard di rilascio)
// ============================================================
// Il numero di rilascio si scrive A MANO in più file e finora nessuno
// verificava che dicessero la stessa cosa. Preparando la 2.11.3 (2026-09-04)
// l'unico controllo è stato un grep del numero VECCHIO dopo il bump: quel grep
// non vede il posto DIMENTICATO — vede solo quelli già cambiati. Il posto
// dimenticato lo scopre l'utente a rilascio fatto: è già successo proprio al
// README, rimasto alla 2.11.1 mentre il resto era 2.11.2 (491db9a).
//
// I posti verificabili DA QUESTO REPO sono quattro (cinque campi):
//   ① package.json         → version
//   ② package-lock.json    → version di radice E packages[""].version
//   ③ login.html           → il letterale «InfraNet Pro vX.Y.Z» dentro .lf-app
//   ④ README.md            → il banner «What's new (vX.Y.Z)» della landing
// I due sorgenti del manuale (_local/manual-src/_manual_build.html e
// _manual_build_en.html: copertina + colophon) restano FUORI per forza — vivono
// in un repo git separato e privato, un test di qui non può leggerli. Restano
// un passo a mano della checklist di rilascio, e il messaggio d'errore lo dice.
//
// ⚠️ TRE TRAPPOLE, tutte già costate una volta:
//   A) login.html scrive «v2.11.3» e il README «(v2.11.3)»: fra la `v` e la
//      cifra NON c'è un confine di parola (`\b` sta fra un carattere di parola
//      e uno che non lo è, e qui sono parola tutt'e due). Una regex ancorata
//      con `v\b` non matcha MAI, e un guard che non trova niente è un guard che
//      non guarda. → test «trappola A».
//   B) in package-lock.json `"version": "…"` compare centinaia di volte, e
//      quasi tutte sono DIPENDENZE. Chi scandisce a tappeto le tocca: è già
//      successo, punycode portato a 2.4.0 con `resolved` e `integrity` fermi
//      alla 2.3.1 — un lockfile incoerente. Qui i due campi del PROGETTO si
//      leggono per STRUTTURA (JSON.parse), che è l'ancora più stretta che
//      esista ai due blocchi di primo livello. → test «trappola B».
//   C) nel README di versioni ce ne sono SEI, non una: sotto il banner corrente
//      stanno i banner delle release passate («📰 **v2.11.1 — …**»), che devono
//      restare al loro numero. L'ancora quindi non è «una vX.Y.Z nel README» ma
//      la formula del banner CORRENTE, «What's new (v…)», che è l'unica cosa a
//      distinguerlo dallo storico. → test «trappola C».
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const pkg = JSON.parse(read('package.json'));
const lockTxt = read('package-lock.json');
const lock = JSON.parse(lockTxt);
const loginTxt = read('login.html');
const readmeTxt = read('README.md');

// ③ L'ancora di login.html è il MARKUP che contiene il numero, non la `v`: così
// il guard legge QUEL posto e non una versione qualsiasi capitata nella pagina.
// Nessun `\b` dopo la `v` (trappola A).
const LOGIN_RE = /<div class="lf-app">\s*InfraNet Pro v(\d+\.\d+\.\d+)\s*<\/div>/;
// ④ L'ancora del README è la formula del banner CORRENTE: i banner storici qui
// sotto dicono «📰 **v2.11.1 — …**» e non devono essere letti (trappola C).
const README_RE = /What's new \(v(\d+\.\d+\.\d+)\)/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// I posti che il guard legge davvero, col nome che l'operatore deve cercare.
function letture() {
  const login = LOGIN_RE.exec(loginTxt);
  const readme = README_RE.exec(readmeTxt);
  const radice = lock.packages && lock.packages[''];
  return [
    { dove: 'package.json → "version"', valore: pkg.version },
    { dove: 'package-lock.json → "version" di radice', valore: lock.version },
    { dove: 'package-lock.json → packages[""].version', valore: radice && radice.version },
    { dove: 'login.html → <div class="lf-app">InfraNet Pro v…</div>', valore: login && login[1] },
    { dove: "README.md → banner «What's new (v…)»", valore: readme && readme[1] },
  ];
}

test('versione: i quattro posti (cinque campi) dicono lo stesso numero', () => {
  const posti = letture();

  // Prima di confrontare: ognuno deve aver LETTO qualcosa. Se il markup o la
  // forma del file cambiano sotto, il guard deve accorgersene e dire dove —
  // non passare a vuoto confrontando due undefined.
  for (const p of posti) {
    assert.ok(p.valore,
      `non ho trovato la versione in ${p.dove}: il formato è cambiato, ` +
      'aggiorna QUESTO guard (test/versione-allineata.test.js)');
    assert.match(p.valore, SEMVER_RE, `${p.dove} non è un X.Y.Z: «${p.valore}»`);
  }

  const atteso = pkg.version;
  const discordi = posti.filter((p) => p.valore !== atteso);
  assert.ok(discordi.length === 0,
    `versione disallineata — package.json dice ${atteso}, ma:\n` +
    discordi.map((p) => `  • ${p.dove} dice ${p.valore}`).join('\n') +
    '\nIl bump è a mano: sistema il posto qui sopra, e ricorda che FUORI da questo repo ' +
    'restano copertina e colophon dei due manuali (_local/manual-src/_manual_build.html e ' +
    '_manual_build_en.html), che nessun test può vedere.');
});

test('versione: trappola A — un `\\b` dopo la `v` non troverebbe niente', () => {
  // Documenta il perché delle due regex qui sopra: la forma «naturale» è cieca.
  assert.ok(!/InfraNet Pro v\b\d/.test(loginTxt),
    'sorpresa: `v\\b` ha matchato in login.html. Vuol dire che il letterale non è più ' +
    'attaccato («v 2.11.3»?) — rileggi la regex del guard prima di fidartene.');
  assert.ok(!/new \(v\b\d/.test(readmeTxt),
    'sorpresa: `v\\b` ha matchato nel README. Vuol dire che il banner non è più ' +
    'scritto «(v2.11.3)» — rileggi la regex del guard prima di fidartene.');

  assert.ok(LOGIN_RE.test(loginTxt),
    'la regex del guard non trova più il letterale in login.html: senza quella lettura ' +
    'il confronto del test qui sopra non verificherebbe niente.');
  assert.ok(README_RE.test(readmeTxt),
    'la regex del guard non trova più il banner nel README: senza quella lettura ' +
    'il confronto del test qui sopra non verificherebbe niente.');

  // E in login.html il posto è UNO SOLO: se ne comparisse un secondo, il guard
  // leggerebbe il primo e lascerebbe l'altro libero di dire un altro numero.
  const quante = (loginTxt.match(/InfraNet Pro v/g) || []).length;
  assert.strictEqual(quante, 1,
    `login.html cita la versione ${quante} volte: il guard ne controlla una sola. ` +
    'Ancora tutte le occorrenze oppure riducile a una.');
});

test('versione: trappola B — il lockfile si legge per struttura, non a tappeto', () => {
  const tutte = [...lockTxt.matchAll(/"version":\s*"([^"]+)"/g)].map((m) => m[1]);
  // La misura che spiega il divieto: una scansione nuda non sta guardando il
  // progetto, sta guardando l'albero delle dipendenze.
  assert.ok(tutte.length > 2,
    `atteso un lockfile popolato: "version" compare ${tutte.length} volte. ` +
    'Se fossero davvero 2, questo non è più un lockfile completo.');
  assert.ok(new Set(tutte).size > 2,
    'valori di "version" tutti uguali nel lockfile: sospetta una riscrittura a tappeto.');

  // I due campi che contano sono quelli del pacchetto di radice, e si
  // riconoscono dal NOME, non dalla posizione nel testo.
  assert.strictEqual(lock.name, pkg.name, 'il lockfile di radice non è di questo pacchetto');
  assert.strictEqual(lock.packages[''].name, pkg.name, 'packages[""] non è il pacchetto di radice');
});

test('versione: trappola C — nel README il banner corrente è UNO, lo storico non si tocca', () => {
  // Il README elenca anche le release passate: cercarci «una vX.Y.Z» prenderebbe
  // sei numeri, cinque dei quali DEVONO restare vecchi.
  const banner = (readmeTxt.match(/What's new \(v/g) || []).length;
  assert.strictEqual(banner, 1,
    `il README ha ${banner} banner «What's new (v…)»: il guard ne legge uno solo. ` +
    'A ogni rilascio il banner precedente va riscritto nella forma storica ' +
    '(«📰 **vX.Y.Z — …**»), altrimenti resta un secondo numero corrente non controllato.');

  const tutte = (readmeTxt.match(/v\d+\.\d+\.\d+/g) || []).length;
  assert.ok(tutte > 1,
    'atteso anche lo storico dei rilasci nel README: se le versioni citate fossero una ' +
    'sola, questo test non starebbe più difendendo niente — ricontrolla il file.');
});

test('versione: nel lockfile ogni dipendenza concorda col suo `resolved`', () => {
  // Firma dell'incidente punycode: `version` riscritta, tarball no. Un lockfile
  // così è incoerente e la reinstallazione tira giù il pacchetto SBAGLIATO.
  const incoerenti = [];
  for (const [percorso, entry] of Object.entries(lock.packages)) {
    if (!percorso || !entry || !entry.version || !entry.resolved) continue;
    if (!entry.resolved.endsWith('.tgz')) continue; // git/link: niente versione nell'URL
    if (!entry.resolved.endsWith(`-${entry.version}.tgz`)) {
      incoerenti.push(`  • ${percorso}: version=${entry.version} ma resolved=${entry.resolved}`);
    }
  }
  assert.ok(incoerenti.length === 0,
    'lockfile incoerente (version ≠ tarball in `resolved`) — è la firma di una ' +
    'riscrittura a tappeto di "version" nel testo:\n' + incoerenti.join('\n'));
});
