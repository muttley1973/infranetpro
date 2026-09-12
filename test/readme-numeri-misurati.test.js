'use strict';
// ============================================================
//  UN NUMERO MISURATO NEL README, SORVEGLIATO DA CHI LO MISURA
// ============================================================
// Il README dichiara tre numeri come MISURATI — quanti sorgenti parsa
// `npm run check`, quanti test ha la suite, quante pagine hanno i manuali — e
// finora nessuno li verificava. Il 12/09 due erano fuori: 541 file contro 546 e
// 3.685 test contro 3.724, entrambi scivolati nella stessa giornata in cui il
// prodotto e' cresciuto di cinque file e trentanove prove. Non e' distrazione:
// e' la classe «frasi che nessun cancello verifica», che si guasta PROPRIO
// QUANDO il prodotto migliora.
//
// ⚠️ QUESTO CANCELLO NE COPRE UNO SOLO, e dire quale conta quanto la prova:
//   ✅ `npm run check` — misurabile qui e adesso, riusando l'enumerazione VERA
//      di tools/check-syntax.js (non una copia: vedi sotto).
//   ⛔ il conteggio dei TEST — una prova che conta le prove e' circolare: il
//      numero cambierebbe scrivendo la prova che lo controlla. Lo puo' misurare
//      solo lo script di rilascio (STATO_PIANO, gruppo B), che gira DOPO la suite.
//   ⛔ le PAGINE dei manuali — i sorgenti vivono in `_local/manual-src/`, un repo
//      git separato e privato: un test di qui non li puo' leggere. Restano un
//      passo a mano della checklist di rilascio, come per la versione.
//      (⚠️ E si contano con i form-feed di `pdftotext`, che ne emette uno ANCHE
//      dopo l'ultima pagina: aggiungerne uno da' sempre N+1. Ci sono gia' cascato
//      il 12/09, e ho quasi «corretto» due numeri che erano giusti.)
//
// ⚠️ La regola su COSA e' sorgente NON si ricopia qui: si chiede a
// tools/check-syntax.js. Se la duplicassi, il numero sorvegliato e quello
// stampato potrebbero divergere in silenzio — cioe' il difetto da cui nasce
// questo cancello, rifatto dentro il cancello stesso.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { sourceFiles } = require('../tools/check-syntax.js');

const ROOT = path.join(__dirname, '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

// La frase del README, con il numero in grassetto. La regex e' ancorata al
// CONTESTO («npm run check» … «of them»), non al solo numero: cosi' non puo'
// agganciare per sbaglio un altro numero della pagina.
const RE_CHECK = /`npm run check`[^\n]*?\*\*([\d,.]+)\*\* of them/;

test('README: il numero di `npm run check` e\' quello vero', () => {
  const m = README.match(RE_CHECK);
  // ⚠️ Trappola gia' costata una volta al cancello della versione: una prova che
  // non trova niente passa. Se qualcuno riscrive la frase, questo deve ARROSSIRE
  // e non diventare silenziosamente un test che non controlla piu' nulla.
  assert.ok(m, 'la frase di «npm run check» nel README non ha piu\' la forma attesa: '
    + 'o e\' stata riscritta (aggiorna la regex QUI, non toglierla) o il numero e\' sparito');

  const dichiarato = Number(String(m[1]).replace(/[,.]/g, ''));
  const reale = sourceFiles().length;
  assert.equal(dichiarato, reale,
    'il README dice ' + dichiarato + ' sorgenti, ne conto ' + reale + '. '
    + 'Rimisura con `node tools/check-syntax.js` e scrivi il numero nel README — '
    + 'e\' un numero MISURATO, non una stima: se si lascia scivolare, la landing '
    + 'comincia a raccontare un prodotto che non esiste piu\'.');
});

test('il numero è del REPOSITORY, non del disco di chi sviluppa', () => {
  // ⚠️ È la prova che mancava, e la sua assenza è costata una CI rossa su un
  // commit GIÀ TAGGATO. Lo script camminava le cartelle saltando un elenco di
  // nomi: sulla macchina di chi sviluppa contava 548 file (c'è anche il modulo
  // governance, che è un repo separato, i driver a pagamento, i generatori di
  // reti di prova e il bundle), in un clone pulito 520. Il numero nel README non
  // descriveva il prodotto: descriveva un disco, e quale dei due dipendeva da chi
  // aveva lanciato il comando.
  // Ora «sorgente del prodotto» vuol dire «tracciato da git», e questo cancello
  // lo tiene: se un giorno l'elenco tornasse a pescare un file non tracciato, il
  // numero ricomincerebbe a dipendere dalla macchina e questa prova lo vede —
  // QUI, non in CI a rilascio fatto.
  const { execFileSync } = require('child_process');
  const tracciati = new Set(
    execFileSync('git', ['ls-files', '*.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
      .split('\n').filter(Boolean).map((f) => f.split('/').join(path.sep)),
  );
  const fuori = sourceFiles().filter((f) => !tracciati.has(f));
  assert.deepEqual(fuori, [],
    'questi file finiscono nel conteggio ma git non li traccia, quindi in un clone pulito non ci sono: '
    + 'il numero tornerebbe a dipendere dalla macchina. ' + fuori.slice(0, 6).join(', '));
});

test('README: il numero sta in UN posto solo', () => {
  // Due copie dello stesso numero divergono sempre: la seconda la aggiorna
  // nessuno. E' la stessa ragione per cui lo stato del progetto sta nella sola
  // testata dell'handoff.
  const quante = (README.match(RE_CHECK.source ? new RegExp(RE_CHECK.source, 'g') : RE_CHECK) || []).length;
  assert.equal(quante, 1, 'il conteggio dei sorgenti compare ' + quante + ' volte nel README: '
    + 'due copie di un numero misurato divergono sempre, perche\' la seconda non la aggiorna nessuno');
});
