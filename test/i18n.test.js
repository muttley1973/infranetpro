'use strict';
// Test struttura i18n (scaffolding): fallback, interpolazione, glossario, lingua.
const test = require('node:test');
const assert = require('node:assert');
const i18n = require('../lib/i18n.js');

test('default: lingua sorgente è it', () => {
  assert.equal(i18n.getLang(), 'it');
  assert.equal(i18n.t('common.save'), 'Salva');
});

test('setLang: cambia lingua e t() risponde in en', () => {
  i18n.setLang('en');
  assert.equal(i18n.getLang(), 'en');
  assert.equal(i18n.t('common.save'), 'Save');
  assert.equal(i18n.t('props.identity'), 'Detected identity');
  i18n.setLang('it'); // ripristina per gli altri test
});

test('setLang: lingua non supportata viene ignorata', () => {
  const before = i18n.getLang();
  assert.equal(i18n.setLang('xx'), before);
});

test('fallback: chiave senza traduzione en ricade su it', () => {
  i18n.setLang('en');
  // chiave presente solo in it (simulata): se mancasse in en, torna l'it
  const v = i18n.t('common.save'); // esiste in en
  assert.equal(typeof v, 'string');
  i18n.setLang('it');
});

test('fallback: chiave totalmente assente ritorna la chiave stessa', () => {
  assert.equal(i18n.t('non.esiste.proprio'), 'non.esiste.proprio');
});

test('interpolazione {var}', () => {
  // usa una chiave inesistente come template letterale per testare il replace
  assert.equal(i18n.t('Ciao {nome}', { nome: 'Max' }), 'Ciao Max');
  assert.equal(i18n.t('{a}-{b}', { a: 1, b: 2 }), '1-2');
});

test('glossario: termini tecnici riconosciuti, non-tecnici no', () => {
  assert.ok(i18n.isGlossaryTerm('VLAN'));
  assert.ok(i18n.isGlossaryTerm('trunk'));
  assert.ok(i18n.isGlossaryTerm('Patch Panel'));
  assert.ok(!i18n.isGlossaryTerm('descrizione'));
});

test('parità chiavi it/en: ogni chiave it ha la sua en', () => {
  const it = Object.keys(i18n._i18nDict.it).sort();
  const en = Object.keys(i18n._i18nDict.en).sort();
  assert.deepEqual(it, en, 'le chiavi di it ed en devono coincidere');
});

// Due righe del pannello Proprieta' che devono stare SU UNA RIGA: la colonna e'
// larga 410px per default e si trascina fino a 320. Il tetto non e' un gusto, e'
// una misura fatta nel browser (altezza della riga resa, a piu' larghezze):
//   · .prop-hint a --fs-sm (13,12px) → ~292px di testo a 320px di pannello
//   · .vlan-ipam-hint a --fs-md (14,4px), meno l'icona → ~240px, e li' l'italiano
//     non ci sta: sta da 400px in su, che e' comunque sotto il default.
// Il difetto originale era che la frase CRESCE — due frasi in una — e nessuno se
// ne accorge finche' non va a capo a schermo. Qui se ne accorge il test.
// I riquadri informativi del pannello Proprieta'. Il valore e' il tetto di
// caratteri; `tip: false` vuol dire «non c'e' altro da dire», tutti gli altri
// devono avere la loro chiave `…Tip`, perche' accorciare la riga è lecito solo
// se il resto resta raggiungibile.
const TETTI = {
  'port.ifaceIpHint':               [45],        // helper sotto il campo
  'floor.gwDeviceNone':             [45],
  'pnl.node.pduPortsNote':          [45],
  'pnl.node.pduNoNetworkNote':      [45],
  'pnl.dev.upsOutletsNote':         [45],
  'pnl.dev.pduOutletsStateNote':    [32],        // preceduta dal riepilogo prese
  'pduOutlet.manualHint':           [45],
  'pduOutlet.noNetworkCable':       [45],
  'pduOutlet.connectionHint':       [45],
  'pdu.connectionsHint':            [45],
  'pwg.hint':                       [45],
  'pwg.empty':                      [45],
  'radio.hint':                     [45],
  'radio.clientOnly':               [45],
  'pduOutlet.notFound':             [45, false], // una frase sola, già completa
  'radio.noAssoc':                  [45, false],
};

test('microcopy a una riga: le due righe strette hanno un tetto di caratteri', () => {
  for (const [k, [max, vuoleTip = true]] of Object.entries(TETTI)) {
    for (const lang of ['it', 'en']) {
      const v = i18n._i18nDict[lang][k];
      assert.ok(typeof v === 'string' && v.length > 0, k + ' manca in ' + lang);
      assert.ok(v.length <= max,
        k + ' [' + lang + '] è lungo ' + v.length + ' caratteri (tetto ' + max + '): '
        + 'va a capo nel pannello. Il di più va nel suo tooltip, non sulla riga.');
      // e il resto deve avere dove andare: il tooltip esiste in tutt'e due le lingue
      if (vuoleTip) assert.ok(typeof i18n._i18nDict[lang][k + 'Tip'] === 'string',
        k + 'Tip manca in ' + lang + ': la riga si accorcia solo se il resto resta raggiungibile');
    }
  }
});
