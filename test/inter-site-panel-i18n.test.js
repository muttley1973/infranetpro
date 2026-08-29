'use strict';
// ============================================================
// SEDI E COLLEGAMENTI — le parole del pannello esistono davvero.
//
// La parità it/en (`test/i18n.test.js`) dimostra che i due dizionari hanno le
// STESSE chiavi. Non dimostra che le chiavi CHIAMATE dal renderer siano fra
// quelle: un `t('org.tabWam')` passa la parità, passa ESLint, passa `tsc` — e a
// schermo compare la chiave nuda. È la stessa classe di bug degli handler
// inline diventati muti dopo l'ESM: silenziosa fino a quando qualcuno guarda.
//
// Qui si legge il SORGENTE del pannello (e l'HTML del suo guscio), si raccolgono
// le chiavi `org.*` che nomina — comprese quelle costruite a pezzi su un
// vocabolario chiuso — e si controlla che ognuna abbia una voce in ENTRAMBE le
// lingue. E il contrario: una chiave `org.*` che nessuno usa più è peso morto,
// e va tolta invece di essere tradotta per sempre.
// ============================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'app-inter-site.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'netmapper.html'), 'utf8');

const i18n = require('../lib/i18n.js');
const IS = require('../lib/inter-site.js');
const { buildInterSiteAudit } = require('../lib/inter-site-audit.js');
const prov = require('../lib/provenance.js');

const DICT = i18n._i18nDict;

/**
 * Le chiavi che il pannello nomina. Due forme:
 *   · complete   — `t('org.tabMap')`, `data-i18n="org.title"`;
 *   · a pezzi    — `t('org.kind.' + e.kind)`, dove la coda è un vocabolario
 *                  CHIUSO: il prefisso si espande con tutti i suoi valori.
 * Espandere il vocabolario invece di elencare le chiavi a mano è ciò che rende
 * la guardia utile domani: aggiungere un `kind` al modello fa arrossare questo
 * test finché non ha la sua parola in tutt'e due le lingue.
 */
const CODE = {
  'org.kind.': IS.INTER_SITE_KINDS,
  'org.role.': IS.SITE_ROLES,
  'org.topo.': IS.INTER_SITE_TOPOLOGIES,
  // Le tre origini dell'envelope, chieste all'envelope: `provenance.js` non
  // esporta un elenco, ma esporta i tre costruttori, e l'origine è ciò che
  // ciascuno scrive. Leggerla così vuol dire che una quarta origine — se mai
  // arrivasse — verrebbe qui a chiedere le sue parole.
  'org.origin.': [prov.factDeclared(1), prov.factMeasured(1, '2026-01-01'), prov.factDerived(1, 'x')]
    .map(f => prov.factOrigin(f)),
  // `t('org.state' + (v === 'up' ? 'Up' : 'Down'))`: un prefisso senza punto,
  // perché il valore è già il vocabolario `INTER_SITE_STATES` con l'iniziale
  // maiuscola. Si deriva da quello, non si riscrive.
  'org.state': IS.INTER_SITE_STATES.map(s => s[0].toUpperCase() + s.slice(1)),
  // I nomi delle liste dell'audit non si scrivono qui: si CHIEDONO all'audit.
  // Così un controllo nuovo arriva con l'obbligo di avere delle parole.
  'org.a.': Object.keys(buildInterSiteAudit({})).filter(k => k !== 'notChecked'),
  // E lo stesso per i MOTIVI di `notChecked`, che a schermo erano sigle interne
  // (`spokesWithoutHub — no-hub`): si leggono dai sorgenti che li scrivono,
  // così aggiungerne uno senza parole fa arrossare questo test.
  'org.why.': _motiviNotChecked(),
  // E lo stesso per le note della lettura WAN dal DCIM: i codici li scrivono il
  // mapper e il pannello, e vengono letti da lì. Aggiungerne uno senza parole fa
  // arrossare questo test invece di stampare la chiave nuda a schermo.
  'org.wanNote.': _codiciNota('wan'),
  // I servizi L2 e i tunnel hanno la LORO famiglia di note: `wan.truncated` e
  // `vpn.truncated` sono due frasi diverse, e un solo spazio di chiavi ne
  // avrebbe fatta sparire una in silenzio.
  'org.vpnNote.': _codiciNota('vpn'),
};

/** I `code: '<fam>.…'` che possono finire nell'esito della lettura. */
function _codiciNota(famiglia) {
  const fonti = ['lib/dcim-wan.js', 'lib/dcim-vpn.js', 'src/app-inter-site.js', 'server/routes/integrations.js']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const out = new Set();
  for (const m of fonti.matchAll(new RegExp('code:\\s*\'' + famiglia + '\\.([A-Za-z0-9]+)\'', 'g'))) out.add(m[1]);
  return [...out].sort();
}

/** I `reason` che l'audit e la rotta possono mettere in `notChecked`. */
function _motiviNotChecked() {
  const fonti = ['lib/inter-site-audit.js', 'server/routes/organization.js']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const out = new Set();
  for (const m of fonti.matchAll(/reason:\s*'([^']+)'/g)) out.add(m[1]);
  return [...out].sort();
}

/** Ogni `'org.…'` che compare nel sorgente o nell'HTML del pannello. */
function chiaviNominate() {
  const trovate = new Set();
  // ⚠️ Le CIFRE fanno parte di una chiave (`org.phase1`): senza `0-9` la
  // classe si fermava a `org.phase` e la chiave vera restava invisibile —
  // l'estrattore avrebbe assolto proprio ciò che doveva controllare.
  for (const m of SRC.matchAll(/'(org\.[A-Za-z0-9.]*)'/g)) trovate.add(m[1]);
  for (const m of HTML.matchAll(/data-i18n(?:-tip|-ph|-aria)?="(org\.[A-Za-z0-9.]+)"/g)) trovate.add(m[1]);
  return trovate;
}

/** Le chiavi COMPLETE che il pannello finirà per chiedere a `t()`. */
function chiaviAttese() {
  const out = new Set();
  for (const k of chiaviNominate()) {
    if (Object.prototype.hasOwnProperty.call(CODE, k)) {
      for (const coda of CODE[k]) out.add(k + coda);      // prefisso → vocabolario
    } else if (!k.endsWith('.')) {
      out.add(k);
    }
  }
  return out;
}

test('ogni chiave org.* chiamata dal pannello esiste in italiano e in inglese', () => {
  const mancanti = [];
  for (const k of [...chiaviAttese()].sort()) {
    for (const lang of ['it', 'en']) {
      if (typeof DICT[lang][k] !== 'string') mancanti.push(`${k} [${lang}]`);
    }
  }
  assert.deepEqual(mancanti, [],
    'chiavi chiamate dal pannello e assenti dal dizionario (a schermo comparirebbe la chiave nuda):\n  '
    + mancanti.join('\n  '));
});

test('il vocabolario CHIUSO del modello è tradotto per intero', () => {
  // Non passa dal sorgente: interroga il modello. Se domani `inter-site.js`
  // guadagna un `kind`, la mappa e il form lo offrirebbero senza una parola.
  for (const [prefisso, valori] of Object.entries(CODE)) {
    assert.ok(valori.length > 0, prefisso + ' si è svuotato: il vocabolario non si legge più');
    for (const v of valori) {
      for (const lang of ['it', 'en']) {
        assert.equal(typeof DICT[lang][prefisso + v], 'string',
          `manca ${prefisso}${v} in ${lang}`);
      }
    }
  }
});

test('nessuna chiave org.* rimasta senza chi la usa', () => {
  const attese = chiaviAttese();
  const orfane = Object.keys(DICT.it).filter(k => k.startsWith('org.') && !attese.has(k));
  assert.deepEqual(orfane, [],
    'chiavi tradotte che nessuno chiede più — vanno tolte, non mantenute:\n  ' + orfane.join('\n  '));
});

test('le due lingue dicono cose diverse dove devono (non è una copia incollata)', () => {
  // Una traduzione dimenticata si vede: la voce `en` identica all'italiana. Su
  // nomi propri e sigle (IPsec, MPLS, Hub) l'uguaglianza è invece giusta, ed è
  // il motivo per cui il controllo guarda le frasi, non le etichette corte.
  const sospette = [...chiaviAttese()]
    .filter(k => typeof DICT.it[k] === 'string' && DICT.it[k].length > 25 && DICT.it[k] === DICT.en[k]);
  assert.deepEqual(sospette, [], 'frasi lunghe identiche in it ed en: probabile traduzione mancante');
});

test('la sonda regge: una chiave inventata verrebbe vista', () => {
  // Se l'estrattore smettesse di trovare le chiamate (una virgoletta diversa,
  // un refactor), i tre test sopra passerebbero sempre e non guarderebbero più
  // niente. Questo è il loro controllo di vita.
  assert.ok(chiaviNominate().has('org.title'), 'l\'estrattore non vede più le chiavi del sorgente');
  assert.ok(chiaviAttese().has('org.kind.ipsec'), 'i prefissi non si espandono più sul vocabolario');
  assert.ok(chiaviAttese().size > 60, 'trovate troppe poche chiavi: l\'estrattore è cieco');
  // Una chiave con una CIFRA è il caso che l'estrattore aveva davvero perso.
  assert.ok(chiaviAttese().has('org.phase1'), 'le chiavi con una cifra tornano invisibili');
});
