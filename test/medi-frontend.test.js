// Fix frontend dei rilievi MEDI del secondo smoke (STATO_PIANO gruppo H). I moduli
// src/ sono ESM per il browser (bundle esbuild) e non si caricano in node: si
// verifica il SORGENTE, come group-g-frontend / history-undo-dirty. Ogni asserzione
// riproduce il difetto che il fix chiude — e i due fix qui esistono proprio perché
// una guardia che il consumatore non usa non è una guardia.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');
const { _i18nDict: I18N } = require('../lib/i18n.js');

// ── L'organizzazione ha un marcatore di versione, e il client lo USA ─────────
test('il pannello multisito ripresenta l\'ETag come If-Match quando salva', () => {
  const src = read('app-inter-site.js');
  assert.match(src, /_captureOrgEtag/, 'la versione si prende dalla risposta');
  assert.match(src, /'If-Match':\s*_orgEtag/, 'e si ripresenta al PUT');
  const cap = /function _captureOrgEtag[\s\S]*?\n\}/.exec(src);
  assert.ok(cap, 'corpo trovato');
  assert.match(cap[0], /if\s*\(!res\s*\|\|\s*!res\.ok\)\s*return/,
    'SOLO dalle risposte riuscite: adottare l\'ETag del 409 disinnescherebbe la guardia');
});

test('il 409 si dice all\'utente e NON sovrascrive', () => {
  const src = read('app-inter-site.js');
  const save = /async function _save\(\)[\s\S]*?\n\}/.exec(src);
  assert.ok(save, 'corpo di _save trovato');
  assert.match(save[0], /status === 409/, 'il caso è trattato per nome');
  assert.match(save[0], /org\.saveStale/, 'e viene detto');
  // La riga del 409 sta PRIMA dell'adozione della risposta: dopo sarebbe tardi.
  assert.ok(save[0].indexOf('409') < save[0].indexOf('_adopt(j)'), 'si esce prima di adottare');
});

test('il messaggio del 409 esiste in tutt\'e due le lingue (e non è lo stesso testo)', () => {
  const it = I18N.it['org.saveStale'];
  const en = I18N.en['org.saveStale'];
  assert.ok(it && en, 'chiave presente in it e en');
  assert.notEqual(it, en, 'tradotta, non copiata');
});

// ── La scadenza dei token arriva fino a chi la deve dichiarare ──────────────
test('la creazione del token manda expiresInDays solo se è un numero > 0', () => {
  const src = read('app-auth.js');
  const f = /async function tkCreateToken\(\)[\s\S]*?\n\}/.exec(src);
  assert.ok(f, 'corpo trovato');
  assert.match(f[0], /tk-new-days/, 'il campo c\'è');
  assert.match(f[0], /Number\.isFinite\(days\)\s*&&\s*days\s*>\s*0/,
    'vuoto/0/non numero = nessuna scadenza, cioè il comportamento di sempre');
  assert.match(f[0], /body\.expiresInDays\s*=\s*days/);
});

test('la lista dei token distingue «non scade», «scade il…» e «SCADUTO»', () => {
  const src = read('app-auth.js');
  const f = /async function tkLoadTokens\(\)[\s\S]*?\n\}/.exec(src);
  assert.ok(f, 'corpo trovato');
  assert.match(f[0], /tk\.expired/, 'lo scaduto si vede: un token morto non deve far cercare il guasto altrove');
  assert.match(f[0], /tk\.expires/, 'e la data si legge');
  assert.match(f[0], /tk\.expired[\s\S]*?tk\.expires/, 'scaduto PRIMA di «scade il…»: chi è già morto non ha una data futura');
});

test('il campo giorni è nel markup, ed è dichiarato opzionale', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'netmapper.html'), 'utf8');
  assert.match(html, /id="tk-new-days"/, 'il campo esiste');
  assert.match(html, /data-i18n-ph="tk\.phDays"/, 'e il segnaposto è tradotto');
  for (const lang of ['it', 'en']) assert.ok(I18N[lang]['tk.phDays'], `tk.phDays in ${lang}`);
  assert.match(I18N.it['tk.phDays'], /vuoto/i, 'il segnaposto DICE che vuoto significa «non scade»');
  assert.match(I18N.en['tk.phDays'], /empty/i);
});

// ── Cavi orfani alla riduzione porte (STATO_PIANO gruppo G, l'ultima aperta) ──
// Il difetto: abbassare il conteggio porte lascia i cavi sulle porte tolte. Non
// si vedono (nessuna ancora nel rack) ma ci sono. Qui NON si pota: si dice al
// momento in cui il danno si crea, e si conta nella Panoramica.
test('abbassare il conteggio porte AVVISA, e non cancella niente', () => {
  const src = read('app.js');
  const f = /export function messaggioCaviOrfani[\s\S]*?\n\}/.exec(src);
  assert.ok(f, 'la funzione esiste');
  assert.match(f[0], /orphansIfPortCount/, 'la domanda la fa la lib, non una seconda regola qui');
  assert.match(f[0], /ports\.orphanCables/, 'e il risultato si dice');
  // La prova che NON pota è puntuale: i cavi si leggono, non si riscrivono mai.
  // (Un `doesNotMatch` su «filter» sarebbe stato più largo del vero — la funzione
  // filtra gli id dei nodi, che coi cavi non c'entra: una guardia troppo larga
  // fallisce sul codice giusto, ed è così che la si disattiva.)
  assert.match(f[0], /store\.state\.links/, 'i cavi li legge');
  assert.doesNotMatch(f[0], /state\.links\s*=|links\.splice|delete .*links/, 'e non li riscrive mai');
  // Il tetto PRIMA della modifica va catturato prima dell'assegnazione, o non si
  // può sapere se è sceso — stessa disciplina di `_auditOldName`.
  assert.match(src, /const _tettoPrima=\(k==='ports'\) \? tettoPorteNumeriche\(n\) : null;/);
  assert.match(f[0], /tettoDopo >= tettoPrima\) return ''/, 'si parla solo quando il tetto SCENDE');
  assert.match(f[0], /tettoPrima == null \|\| tettoDopo == null/, '«non lo so» non accusa nessuno');
});

test('il tetto dei pid numerici passa dalla regola unica, con la PDU dichiarata', () => {
  const src = read('app.js');
  const f = /export function tettoPorteNumeriche[\s\S]*?\n\}/.exec(src);
  assert.ok(f, 'corpo trovato');
  assert.match(f[0], /numericPortCeiling/, 'la regola sta in lib/port-inventory.js');
  assert.match(f[0], /pduMgmtPorts: n\.type === 'pdu' \? pduManagementPortCount\(n\) : null/,
    'su una PDU i pid numerici sono le porte di RETE: `n.ports` conta altro');
});

// Regola cardine ③: il fix è della CLASSE, non del caso. Il conteggio porte si
// abbassa anche applicando un modello del catalogo — tre strade, stesso danno.
test('anche applicare un modello del catalogo avvisa, nella stessa frase', () => {
  const src = read('app-device-types.js');
  const chiamate = src.match(/applyTemplateToNode\(n, tmpl, getNodeRackSize\(n\)\);/g) || [];
  assert.equal(chiamate.length, 3, 'le strade che applicano un modello sono tre');
  // Ognuna misura il tetto PRIMA e compone il messaggio DOPO.
  assert.equal((src.match(/const _tetto = tettoPorteNumeriche\(n\);/g) || []).length, 3,
    'tutte e tre catturano il tetto prima di riscrivere le porte');
  assert.equal((src.match(/const _orfani = messaggioCaviOrfani\(n, _tetto\);/g) || []).length, 3);
  assert.equal((src.match(/_orfani \? ' ' \+ _orfani : ''/g) || []).length, 3,
    'e lo appendono all\'avviso che c\'è già: una conseguenza raccontata a parte sembra un altro fatto');
});

test('la Panoramica conta gli orfani nel glue e li mostra nella riga Cavi', () => {
  const src = read('app-overview.js');
  assert.match(src, /findOrphanPortRefs\(/, 'il conteggio si fa dove vivono TYPES e il modello PDU');
  assert.match(src, /orphanCables,/, 'ed entra nel modello che la lib compone');
  const caso = /case 'cables': \{[\s\S]*?\n {8}\}/.exec(src);
  assert.ok(caso, 'ramo della riga Cavi trovato');
  assert.match(caso[0], /ov\.st\.cableOrphan/, 'la sotto-riga lo dice');
  assert.match(caso[0], /orph > 0 \? ' · '/, 'in coda e SOLO se ce n\'è: uno zero perenne è rumore');
  assert.match(caso[0], /orph > 0\) \? 'warn'/, 'e tinge la riga: nessuno può accorgersene guardando il rack');
});

test('i due messaggi nuovi esistono in tutt\'e due le lingue', () => {
  for (const k of ['ports.orphanCables', 'ov.st.cableOrphan']) {
    assert.ok(I18N.it[k], `${k} in it`);
    assert.ok(I18N.en[k], `${k} in en`);
    assert.notEqual(I18N.it[k], I18N.en[k], `${k}: tradotta, non copiata`);
  }
  assert.match(I18N.it['ports.orphanCables'], /Non li ho tolti/, 'il messaggio DICE che non ha cancellato niente');
  assert.match(I18N.en['ports.orphanCables'], /not removed/);
});
