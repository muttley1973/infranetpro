'use strict';
// ============================================================
//  test/certainty.test.js — lib/certainty.js (la notazione unica).
//
//  ⭐ QUESTA GUARDIA DERIVA, NON ENUMERA. È il punto di tutto il file.
//
//  Il difetto ricorrente piu' caro del progetto e' la definizione duplicata
//  motore↔renderer, nella sua variante peggiore: un lato DERIVA, l'altro
//  ELENCA — e si buca in silenzio, perche' l'elenco resta verde e cieco al
//  primo stato nuovo. `lib/certainty.js` per forza di cose ENUMERA (e' una
//  mappa), quindi la prova deve derivare gli insiemi di chiavi dai SORGENTI
//  VERI dei motori. Se domani qualcuno aggiunge un settimo tier temporale o un
//  nuovo stato di prova e non lo mappa, qui diventa rosso.
//
//  ⚠️ Le cinque estrazioni sono state MISURATE prima di scrivere la guardia:
//  due su cinque erano sbagliate al primo tentativo (`cls:` pescava mezza app,
//  e una virgoletta non ancorata restituiva frammenti di parola). Una guardia
//  che non si misura puo' essere verde per il motivo sbagliato.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  CERTAINTY_GRADES, CERTAINTY_MAP, NOT_A_CERTAINTY, certaintyOf, certaintyKeys,
} = require('../lib/certainty.js');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const uniq = (a) => [...new Set(a)].sort();

// ── LE DERIVAZIONI — ognuna legge dove il motore DAVVERO produce le chiavi ──

// linkstate: export vero del modulo, il caso migliore.
const derivedLinkstate = () =>
  Object.keys(require('../lib/linkstate.js').LINK_STATE_LABELS).sort();

// temporal: i tier nascono da una catena di if, non da una mappa esportabile →
// si estraggono le assegnazioni `tier = '...'` dal sorgente.
const derivedTemporal = () =>
  uniq([...rd('lib/temporal-confidence.js').matchAll(/tier\s*=\s*['"]([a-z]+)['"]/g)].map((m) => m[1]));

// proof: gli stati che il MOTORE restituisce davvero — i letterali dei `return`
// delle due funzioni che li producono (`cableTier` e `cableProof`).
// ⭐ Prima questa derivazione leggeva le chiavi di `_CABLE_PROOF_BADGE`, una mappa
//    di COLORI in src/app.js. Ha funzionato finche' quel badge e' esistito: il
//    04/09 e' stato ritirato (era il sesto vocabolario della certezza) e la
//    guardia e' andata rossa dicendo «ancora non trovata» — cioe' ha fatto
//    esattamente il suo mestiere, rifiutando di diventare cieca. La correzione non
//    e' rimetterla dov'era: e' ancorarla al MOTORE, che e' dove gli stati nascono
//    e l'unico posto che non puo' sparire senza che spariscano anche loro.
// ⚠️ Il taglio parte da `return`, non dalla riga: cosi' le condizioni che citano
//    altri vocabolari (`worst === 'diverged'`) restano fuori dall'insieme.
const derivedProof = () => {
  const src = rd('lib/proof.js');
  const corpo = (da, a) => {
    const i = src.indexOf(da), j = src.indexOf(a, i);
    assert.ok(i > -1 && j > i, `ancora non trovata in lib/proof.js: ${da} … ${a}`);
    return src.slice(i, j);
  };
  const zona = corpo('function cableTier(', 'function _worst(')
             + corpo('function cableProof(', 'function deriveNodeProof(');
  return uniq([...zona.matchAll(/return[^;]*;/g)]
    .flatMap((m) => [...m[0].matchAll(/'([a-z][a-z-]*)'/g)].map((q) => q[1])));
};

// disc: la classe di confidenza si riconosce dalle chiavi i18n `disc.conf.*`
// citate nel sorgente. ⚠️ NON da `cls:`, che nella Scoperta nomina anche
// protocolli e azioni (arp, ping, snmp, update...): sarebbe un insieme falso.
const derivedDisc = () =>
  uniq([...rd('src/app-discovery.js').matchAll(/disc\.conf\.([a-z]+)/g)].map((m) => m[1]));

// prov: le provenienze scritte sulle righe di Panoramica. ⚠️ Virgoletta
// ANCORATA e confine di parola, o si raccolgono frammenti di altre parole.
const derivedProv = () =>
  uniq([...rd('lib/overview.js').matchAll(/\bprov\s*:\s*['"]([a-z]+)['"]/g)].map((m) => m[1]));

const VOCABS = {
  linkstate: derivedLinkstate,
  temporal:  derivedTemporal,
  proof:     derivedProof,
  disc:      derivedDisc,
  prov:      derivedProv,
};

test('notazione unica della certezza', async (t) => {

  await t.test('le derivazioni pescano qualcosa (se no la guardia non prova niente)', () => {
    for (const [vocab, derive] of Object.entries(VOCABS)) {
      const keys = derive();
      assert.ok(keys.length >= 3, `${vocab}: derivate ${keys.length} chiavi — l'estrazione e' rotta`);
    }
  });

  await t.test('ogni chiave che un motore produce e\' mappata, o dichiarata non-certezza', () => {
    for (const [vocab, derive] of Object.entries(VOCABS)) {
      const mapped = new Set(certaintyKeys(vocab));
      const notCert = new Set(Object.keys(NOT_A_CERTAINTY[vocab] || {}));
      for (const key of derive()) {
        assert.ok(
          mapped.has(key) || notCert.has(key),
          `${vocab}.${key} non ha un grado e non e' dichiarata non-certezza: ` +
          'aggiungila a CERTAINTY_MAP o a NOT_A_CERTAINTY in lib/certainty.js',
        );
      }
    }
  });

  await t.test('e nessuna chiave mappata e\' morta (refusi e voci stantie)', () => {
    for (const [vocab, derive] of Object.entries(VOCABS)) {
      const real = new Set(derive());
      for (const key of certaintyKeys(vocab)) {
        assert.ok(real.has(key), `${vocab}.${key} e' mappata ma nessun motore la produce piu'`);
      }
      for (const key of Object.keys(NOT_A_CERTAINTY[vocab] || {})) {
        assert.ok(real.has(key), `${vocab}.${key} e' dichiarata non-certezza ma non esiste piu'`);
      }
    }
  });

  await t.test('ogni grado usato esiste nell\'alfabeto, e l\'alfabeto e\' di SEI segni', () => {
    // ⚠️ Sei e non cinque: le due assenze sono separate. «non dichiarato» manca
    // di una tua scrittura, «non risulta» manca di una lettura — chiedono a due
    // persone diverse di muoversi, e la Panoramica le confondeva su `prov:'none'`
    // (la riga `verify` diceva «non dichiarato» di una VERIFICA mai fatta).
    assert.deepStrictEqual(
      CERTAINTY_GRADES,
      ['measured', 'declared', 'derived', 'contradicted', 'undeclared', 'unread'],
    );
    for (const [vocab, table] of Object.entries(CERTAINTY_MAP)) {
      for (const [key, grade] of Object.entries(table)) {
        assert.ok(CERTAINTY_GRADES.includes(grade), `${vocab}.${key} → grado ignoto «${grade}»`);
      }
    }
  });

  await t.test('«Fantasma» e\' ASSENZA, non contraddizione (decisione utente, 04/09)', () => {
    // Il documento di proposta aveva un segno solo per «nessuna evidenza O
    // evidenza contraddetta». La 2.11.2 ha separato il grigio «non so» dal
    // rosso «guasto»; qui `ghost` sta col grigio: e' un'inferenza che ha PERSO
    // l'evidenza, non un'evidenza che dice il contrario.
    assert.strictEqual(certaintyOf('proof', 'ghost').grade, 'unread');   // manca una LETTURA, non una tua dichiarazione
    assert.notStrictEqual(certaintyOf('proof', 'ghost').grade, 'contradicted');
    // e i due segni restano distinti: chi contraddice chiede un intervento.
    assert.strictEqual(certaintyOf('proof', 'declared-review').grade, 'contradicted');
    assert.strictEqual(certaintyOf('proof', 'declared-shut').grade, 'contradicted');
  });

  await t.test('«lag» non riceve un grado: non e\' una certezza, e lo dice', () => {
    const r = certaintyOf('linkstate', 'lag');
    assert.strictEqual(r.grade, null);
    assert.strictEqual(r.axis, 'identity');   // dice COS'E' il link, non quanto ci fidiamo
  });

  await t.test('una chiave sconosciuta non si inventa un grado', () => {
    const r = certaintyOf('proof', 'chiave-che-non-esiste');
    assert.strictEqual(r.grade, null);
    assert.strictEqual(r.axis, 'unknown');    // ⚠️ 'unknown' ≠ 'identity': il silenzio
    assert.strictEqual(certaintyOf('vocabolario-inesistente', 'x').axis, 'unknown');
  });

  await t.test('la label e\' una CHIAVE i18n, e nessun colore esce da qui', () => {
    assert.strictEqual(certaintyOf('prov', 'measured').labelKey, 'cty.measured');
    // Il colore lo decide il foglio di stile dai token: se un giorno rientrasse
    // qui, tornerebbe il difetto dei badge scritti a mano in `_lsCol`.
    const src = rd('lib/certainty.js');
    const hex = src.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.deepStrictEqual(hex, [], `lib/certainty.js non deve contenere colori: ${hex.join(', ')}`);
  });

  await t.test('il cavo: vince la Verifica quando c\'e\', se no come e\' nato', () => {
    const { certaintyForCable } = require('../lib/certainty.js');
    // Con la Verifica: parla `proof`, ed e' lui la notizia datata piu' fresca.
    assert.deepStrictEqual(certaintyForCable('derived-strong', 'ambiguous'),
      { grade: 'measured', labelKey: 'cty.measured', source: 'proof' });
    // ⭐ Il caso che conta: i due motori DISSENTONO — il cavo e' nato da LLDP
    // (discovered) ma all'ultima Verifica l'evidenza non c'era piu' (ghost).
    // Vince proof, ed e' giusto: «e' nato bene» non e' una notizia di oggi.
    assert.deepStrictEqual(certaintyForCable('ghost', 'discovered'),
      { grade: 'unread', labelKey: 'cty.unread', source: 'proof' });
    // Senza Verifica: parla `linkstate`, ed e' tutto quello che sappiamo.
    assert.deepStrictEqual(certaintyForCable(null, 'manual'),
      { grade: 'declared', labelKey: 'cty.declared', source: 'linkstate' });
    // Ne' l'uno ne' l'altro: nessun grado inventato.
    assert.strictEqual(certaintyForCable(null, null).grade, null);
    assert.strictEqual(certaintyForCable(null, 'lag').grade, null);   // lag non e' una certezza
  });

  await t.test('il campo: chi ha scritto vince, e il vuoto non si inventa', () => {
    const { certaintyForField } = require('../lib/certainty.js');
    // Scritto da una persona → è legge, anche se una scansione dice altro.
    assert.deepStrictEqual(certaintyForField('Catalyst 2960', 'C2960-24TC-L'),
      { grade: 'declared', labelKey: 'cty.declared', source: 'typed' });
    // ⛔ E NON accusa di contraddizione: manual-first dice che il dichiarato è
    // legge, e per accusare servirebbe una misura CONFERMATA che qui non c'è.
    assert.notStrictEqual(certaintyForField('Catalyst 2960', 'ALTRO').grade, 'contradicted');
    // Nessuno ha scritto, ma la scansione ha letto → misurato.
    assert.deepStrictEqual(certaintyForField('', 'C2960-24TC-L'),
      { grade: 'measured', labelKey: 'cty.measured', source: 'read' });
    // Né l'uno né l'altra → assenza, non zero e non verde.
    assert.strictEqual(certaintyForField('', '').grade, 'undeclared');
    assert.strictEqual(certaintyForField(null, undefined).grade, 'undeclared');
    // ⚠️ Uno spazio non è un valore: era il modo più facile per far sembrare
    // «dichiarato» un campo che nessuno ha compilato.
    assert.strictEqual(certaintyForField('   ', '').grade, 'undeclared');
    assert.strictEqual(certaintyForField('  ', 'letto').grade, 'measured');
  });

  await t.test('Scoperta: il grado viene dai SEGNALI, mai dal punteggio', () => {
    const { certaintyForDiscovery } = require('../lib/certainty.js');
    // ⭐ La correzione del 04/09. Alta/Media/Bassa NON sono gradi: sono la forza
    // di un voto additivo, e si arriva a «Alta» (≥70) senza SNMP e senza LLDP —
    // NetBIOS 14 + SMB 20 + servizi 18 + hostname 12 + MAC 12 + ping 10 = 86.
    for (const lvl of ['high', 'mid', 'low']) {
      assert.strictEqual(certaintyOf('disc', lvl).grade, null, `disc.${lvl} non è un grado`);
      assert.strictEqual(certaintyOf('disc', lvl).axis, 'strength');
    }
    // Parla qualcosa di autorevole (SNMP ha risposto, o un vicino l'ha dichiarato).
    assert.deepStrictEqual(certaintyForDiscovery(true),
      { grade: 'measured', labelKey: 'cty.measured', source: 'authoritative' });
    // Solo osservazioni SU di lui: per quanto siano tante, restano un'inferenza.
    assert.deepStrictEqual(certaintyForDiscovery(false),
      { grade: 'derived', labelKey: 'cty.derived', source: 'inference' });
    // ⚠️ E «Non risulta» qui non capita mai: una riga di Scoperta esiste perché
    // QUALCOSA l'ha vista. Un terzo stato irraggiungibile marcirebbe e basta.
    for (const v of [true, false, undefined, null, 0, 1]) {
      assert.ok(['measured','derived'].includes(certaintyForDiscovery(v).grade));
    }
  });

  await t.test('linkState: i due assi separati, e `key` invariato', () => {
    const { linkState } = require('../lib/linkstate.js');
    // ⚠️ La prova che il refactor NON cambia comportamento: `key` esce come prima
    // in tutti e quattro i casi. Se cambiasse, mezzo prodotto lo leggerebbe diverso.
    assert.strictEqual(linkState({ autoLinked: false }).key, 'manual');
    assert.strictEqual(linkState({ autoLinked: true, protocol: 'LLDP' }).key, 'discovered');
    assert.strictEqual(linkState({ autoLinked: true, protocol: 'MAC' }).key, 'ambiguous');
    assert.strictEqual(linkState({ autoLinked: true, protocol: 'LLDP', lagLogicalKey: 'po1' }).key, 'lag');
    // ⭐ E la novita': sotto il LAG la certezza non sparisce piu'. Prima, di un
    // membro di bundle non si sapeva se era stato VISTO da LLDP o DEDOTTO da un MAC.
    assert.strictEqual(linkState({ autoLinked: true, protocol: 'LLDP', lagLogicalKey: 'po1' }).certaintyKey, 'discovered');
    assert.strictEqual(linkState({ autoLinked: true, protocol: 'MAC', lagLogicalKey: 'po1' }).certaintyKey, 'ambiguous');
    // e sui non-LAG i due assi coincidono, come deve essere.
    for (const l of [{ autoLinked: false }, { autoLinked: true, protocol: 'CDP' }, { autoLinked: true, protocol: 'ARP-MAC' }]) {
      const r = linkState(l);
      assert.strictEqual(r.key, r.certaintyKey, 'senza LAG i due assi non possono divergere');
    }
  });

  await t.test('presenza: le classi si DERIVANO da lib/presence.js, e sono tutte mappate', () => {
    const { certaintyForPresence, PRESENCE_CLASSES } = require('../lib/certainty.js');
    // Derivate dal sorgente, non elencate: se domani nasce una quinta classe di
    // presenza e nessuno le dà un grado, questa va rossa.
    const derivate = [...new Set(
      [...rd('lib/presence.js').matchAll(/['"]\s+(node-[a-z-]+)['"]/g)].map((m) => m[1]),
    )].sort();
    assert.ok(derivate.length >= 4, `derivate solo ${derivate.length} classi: l'estrazione è rotta`);
    for (const c of derivate) {
      assert.ok(PRESENCE_CLASSES.includes(c), `${c} non ha un grado in lib/certainty.js`);
      assert.ok(certaintyForPresence(' ' + c).grade, `${c} non produce un grado`);
    }
    // E nessuna mappata di troppo (refusi, voci stantie).
    for (const c of PRESENCE_CLASSES) assert.ok(derivate.includes(c), `${c} è mappata ma nessuno la produce`);

    // ⭐ I due grigi NON sono la stessa cosa, ed è il punto di tutta la superficie.
    assert.strictEqual(certaintyForPresence(' node-unverified').grade, 'unread');        // non ci sono arrivato
    assert.strictEqual(certaintyForPresence(' node-absent-expected').grade, 'declared'); // l'avevi detto tu
    assert.strictEqual(certaintyForPresence(' node-absent').grade, 'contradicted');      // sondato, e non c'è
    assert.strictEqual(certaintyForPresence(' node-status-conflict').grade, 'contradicted');

    // ⚠️ La stringa vuota non è «Misurato»: nodePresenceClass la restituisce sia
    // per «ha risposto da poco» sia per «non c'è niente da dire». Dedurne una
    // lettura sarebbe inventarla.
    assert.strictEqual(certaintyForPresence('').grade, null);
    assert.strictEqual(certaintyForPresence(undefined).grade, null);
  });

  await t.test('LA GUARDIA MORDE: una chiave nuova non mappata la fa fallire', () => {
    // ⭐ Prova per assurdo. Senza questo caso, i test sopra potrebbero passare
    // perche' non controllano niente, e nessuno se ne accorgerebbe.
    const finto = ['stable', 'tier-inventato-oggi'];
    const mapped = new Set(certaintyKeys('temporal'));
    const notCert = new Set(Object.keys(NOT_A_CERTAINTY.temporal || {}));
    const scoperte = finto.filter((k) => !mapped.has(k) && !notCert.has(k));
    assert.deepStrictEqual(scoperte, ['tier-inventato-oggi'],
      'il controllo non riconosce una chiave non mappata: la guardia non prova niente');
  });

});
