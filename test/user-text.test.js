'use strict';
// ============================================================
// USER TEXT — la forma di una stringa che l'utente sceglie.
//
// Nasce da una MISURA (sonda dell'08/09), non da un'intuizione: un nome da 2 MB
// veniva scritto per intero (file di progetto da 2.048 KB, `organization.json` da
// 4.096 KB, `api-tokens.json` da 2.048 KB), e `\r\n`, NUL ed ESC ci entravano tali
// e quali. La stessa regola esisteva già due moduli più in là, sul puntatore
// backup, che i caratteri di controllo li RIFIUTA dal primo giorno: era una regola
// applicata a metà, sul lato più ovvio — quello che l'utente digita.
//
// Le prove girano nei due versi: cosa deve passare INTATTO (il contenuto è suo) e
// cosa non deve entrare (la forma è nostra).
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanUserText, inspectUserText, USER_TEXT_MAX } = require('../lib/user-text.js');

test('il contenuto NON si tocca: accenti, maiuscole, simboli, altri alfabeti', () => {
  for (const s of ['Sede di Milano', 'CORE-SW #1', 'Ufficio 3° piano', 'Дом', '日本の拠点', 'a/b\\c "x" <y>']) {
    assert.equal(cleanUserText(s), s, `«${s}» deve restare com'è`);
  }
});

test('i caratteri di CONTROLLO non entrano — in un inventario un a-capo è una riga nuova', () => {
  assert.equal(cleanUserText('nome\r\ncon\u0000controlli\u001b[31m'), 'nomeconcontrolli[31m');
  assert.equal(cleanUserText('a\tb'), 'ab');
  assert.equal(cleanUserText('\u007fDEL'), 'DEL');
  // ⚠️ Il NUL è il peggiore: un file che lo contiene diventa invisibile a `grep`
  // e git lo tratta da binario (è già successo in questo repo, due volte).
  assert.equal(cleanUserText('x\u0000y'), 'xy', 'il NUL sparisce, il resto no');
});

test('c\'è un tetto, ed è quello dichiarato', () => {
  assert.equal(USER_TEXT_MAX, 200);
  assert.equal(cleanUserText('A'.repeat(2 * 1024 * 1024)).length, 200);
  assert.equal(cleanUserText('A'.repeat(500), 50).length, 50);
  // Il tetto conta i caratteri TENUTI, non quelli letti: una stringa di soli
  // controlli seguita da testo non deve consumare il tetto coi caratteri buttati.
  assert.equal(cleanUserText('\u0000'.repeat(300) + 'nome'), 'nome');
});

test('gli spazi ai bordi se ne vanno, quelli in mezzo restano', () => {
  assert.equal(cleanUserText('  Sala   macchine  '), 'Sala   macchine');
  assert.equal(cleanUserText('   '), '');
});

test('ritorna sempre una STRINGA: chi chiama scrive un campo', () => {
  for (const v of [null, undefined, 0, false, NaN, {}, []]) {
    assert.equal(typeof cleanUserText(v), 'string', `${JSON.stringify(v)} → stringa`);
  }
  assert.equal(cleanUserText(null), '');
  assert.equal(cleanUserText(42), '42');
});

test('inspectUserText DICE cosa ha tolto, per chi vuole avvisare invece di correggere', () => {
  const a = inspectUserText('nome\r\nsporco');
  assert.equal(a.value, 'nomesporco');
  assert.equal(a.hadControls, true);
  assert.equal(a.wasTooLong, false);
  const b = inspectUserText('A'.repeat(300));
  assert.equal(b.hadControls, false);
  assert.equal(b.wasTooLong, true);
  const c = inspectUserText('normale');
  assert.deepEqual(c, { value: 'normale', hadControls: false, wasTooLong: false });
});

// ── E dove è applicata ─────────────────────────────────────────────────────
// Non basta che la lib sia giusta: la prova che conta è che stia sulle vie di
// scrittura. Si guarda il SORGENTE, perché è una proprietà del collegamento —
// il comportamento dal vivo lo misura la sonda.
test('sta sulle vie di scrittura, e in una sola per ciascuna', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const leggi = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  // Progetti: nel COLLO DI BOTTIGLIA (saveProject), non nelle rotte — crea,
  // salva, copia e import DCIM passano tutti di lì.
  const store = leggi('server/projects-store.js');
  assert.match(store, /function saveProject[\s\S]{0,600}?name = cleanUserText\(name\)/);

  assert.match(leggi('server/api-tokens.js'), /label: cleanUserText\(label\)/);
  assert.match(leggi('server/skins-store.js'), /name:\s+cleanUserText\(meta\.name\)/);
  // Organizzazione: dentro `_str`, che è il passaggio obbligato di OGNI stringa
  // del modello (nomi di sede, etichette, provider) — una riga invece di dieci.
  assert.match(leggi('lib/inter-site.js'), /function _str\(v\)[\s\S]{0,200}?testo\.cleanUserText\(v\)/);
});
