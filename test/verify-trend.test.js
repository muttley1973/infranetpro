'use strict';
// ============================================================
//  test/verify-trend.test.js — lib/verify-trend.js (Principio ③).
//
//  Quello che queste prove difendono non è «il numero è giusto»: è che il numero
//  non possa MIGLIORARE PER IL MOTIVO SBAGLIATO. Una metrica di maturità che si
//  alza quando si guarda meno è peggio di nessuna metrica, perché premia
//  esattamente il comportamento che dovrebbe scoraggiare.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { trendVerifiche, quoteDiUnaRiga } = require('../lib/verify-trend.js');
const { driftActionable } = require('../lib/drift-report.js');

// Una riga di timeline come la scrive server/routes/history.js.
function riga(at, counts, nodes, verify) {
  return { at, by: 'test', verify: verify || 'manual', counts, totals: { nodes: nodes || 100, cables: 50 } };
}

// ── I tre universi non si sommano ──────────────────────────────────────────
test('porte, apparati e cavi restano tre rapporti separati', () => {
  const q = quoteDiUnaRiga(riga('2026-09-01', {
    consistent: 90, stateDrift: 10,            // porte: 90/100
    macOrphan: 5, unverified: 5, ipChanged: 0, identityDrift: 0,   // apparati: 10 su 100
    ghostCable: 3,
  }, 100));
  assert.equal(q.porte, 0.9, 'le porte si contano fra porte');
  assert.equal(q.presenza, 0.9, 'gli apparati fra apparati (100 - 10 non confermati)');
  assert.equal(q.cecita, 0.5, 'e metà della non-conferma è cecità nostra, non assenza loro');
});

// ── LA regola: guardare meno non deve migliorare il voto ───────────────────
test('restringere la scansione NON fa salire la presenza', () => {
  // Stessa rete, stessi apparati mancanti: cambia solo che la sweep copre meno,
  // quindi quelli che prima risultavano assenti ora sono «non verificabili».
  const coperta   = quoteDiUnaRiga(riga('a', { consistent: 50, macOrphan: 20, unverified: 0 }, 100));
  const ristretta = quoteDiUnaRiga(riga('b', { consistent: 50, macOrphan: 0, unverified: 20 }, 100));
  assert.equal(coperta.presenza, ristretta.presenza,
    'spostare apparati da «assenti» a «non guardati» non è un miglioramento: se il numero sale, la metrica premia la cecità');
  assert.equal(ristretta.cecita, 1, 'e la cecità lo dice chiaro: tutta la non-conferma è nostra');
});

test('se la cecità cresce, il verdetto è «non-confrontabile» — non «migliora»', () => {
  const t = trendVerifiche([
    riga('2026-09-01', { consistent: 60, stateDrift: 10, macOrphan: 20, unverified: 2 }, 100),
    riga('2026-09-02', { consistent: 60, stateDrift: 10, macOrphan: 10, unverified: 12 }, 100),
    riga('2026-09-03', { consistent: 60, stateDrift: 10, macOrphan: 2,  unverified: 25 }, 100),
  ]);
  assert.equal(t.verdetto, 'non-confrontabile');
  assert.match(t.perche.join(' '), /NON si riesce a guardare/,
    'e deve DIRE perché: un miglioramento che viene dalla copertura persa non è un miglioramento');
});

// ── Comparabilità ──────────────────────────────────────────────────────────
test('un poll automatico e una Verifica manuale non sono lo stesso strumento', () => {
  const t = trendVerifiche([
    riga('2026-09-01', { consistent: 90, stateDrift: 10 }, 100, 'auto'),
    riga('2026-09-02', { consistent: 50, stateDrift: 50 }, 100, 'auto'),
    riga('2026-09-03', { consistent: 90, stateDrift: 10 }, 100, 'manual'),
  ]);
  assert.equal(t.strumento, 'manual', 'si confronta con lo strumento dell\'ultima misura');
  assert.equal(t.campioni, 1);
  assert.equal(t.scartate.length, 2);
  assert.match(t.scartate[0].perche, /strumento diverso/, 'e lo scarto si DICHIARA, non avviene in silenzio');
});

test('una Verifica cieca esce dalla tendenza, e si dice perché', () => {
  const t = trendVerifiche([
    riga('2026-09-01', { consistent: 90, stateDrift: 10, unverified: 1 }, 100),
    riga('2026-09-02', { consistent: 0, stateDrift: 0, unverified: 100 }, 100),   // cieca
    riga('2026-09-03', { consistent: 92, stateDrift: 8, unverified: 1 }, 100),
  ]);
  assert.equal(t.campioni, 2, 'la cieca non entra');
  assert.match(t.scartate.map(s => s.perche).join(' '), /non è avvenuta/,
    'una Verifica cieca non è andata male: non è avvenuta, e tenerla dentro farebbe crollare la curva per nulla');
});

test('se la rete cambia taglia, la serie si SPEZZA invece di mentire', () => {
  const t = trendVerifiche([
    riga('2026-09-01', { consistent: 90, stateDrift: 10, macOrphan: 2 }, 100),
    riga('2026-09-02', { consistent: 91, stateDrift: 9, macOrphan: 2 }, 100),
    riga('2026-09-03', { consistent: 40, stateDrift: 60, macOrphan: 2 }, 400),   // altro ambiente
    riga('2026-09-04', { consistent: 45, stateDrift: 55, macOrphan: 2 }, 400),
    riga('2026-09-05', { consistent: 50, stateDrift: 50, macOrphan: 2 }, 400),
  ]);
  assert.ok(t.rottura, 'la rottura esiste');
  assert.equal(t.campioni, 3, 'si confronta solo il tratto che descrive la rete di adesso');
  assert.match(t.perche.join(' '), /due reti diverse non si confrontano/);
});

// ── Il verdetto, e il suo PERCHÉ ───────────────────────────────────────────
test('con meno di tre campioni non c\'è tendenza, e lo si dice all\'utente', () => {
  const t = trendVerifiche([
    riga('2026-09-01', { consistent: 80, stateDrift: 20 }, 100),
    riga('2026-09-02', { consistent: 90, stateDrift: 10 }, 100),
  ]);
  assert.equal(t.verdetto, 'non-confrontabile');
  assert.match(t.perche.join(' '), /matura con l'uso/,
    'è il SECONDO must del principio: comunicare che la percentuale matura, non è istantanea');
});

test('«stagna» porta sempre il bucket che tiene ferma la coda: senza, non è azionabile', () => {
  const c = { consistent: 90, stateDrift: 2, macOrphan: 1, undocumented: 40, unverified: 1 };
  const t = trendVerifiche([riga('2026-09-01', c, 100), riga('2026-09-02', c, 100), riga('2026-09-03', c, 100)]);
  assert.equal(t.verdetto, 'stagna');
  assert.match(t.perche.join(' '), /undocumented/,
    '«la coda non cala perché 40 non-documentati non sono mai stati decisi» è una frase su cui si agisce; «stagna» no');
});

test('migliora solo se la presenza sale E la coda non peggiora', () => {
  const su = trendVerifiche([
    riga('2026-09-01', { consistent: 80, stateDrift: 20, macOrphan: 20, undocumented: 5 }, 100),
    riga('2026-09-02', { consistent: 85, stateDrift: 15, macOrphan: 12, undocumented: 3 }, 100),
    riga('2026-09-03', { consistent: 90, stateDrift: 10, macOrphan: 4, undocumented: 1 }, 100),
  ]);
  assert.equal(su.verdetto, 'migliora');

  // Conoscere meglio e non smaltire NIENTE resta una stagnazione per chi paga.
  const codaSu = trendVerifiche([
    riga('2026-09-01', { consistent: 80, stateDrift: 20, macOrphan: 20, undocumented: 5 }, 100),
    riga('2026-09-02', { consistent: 85, stateDrift: 15, macOrphan: 12, undocumented: 30 }, 100),
    riga('2026-09-03', { consistent: 90, stateDrift: 10, macOrphan: 4, undocumented: 60 }, 100),
  ]);
  assert.notEqual(codaSu.verdetto, 'migliora',
    'il principio parla della PERCEZIONE di chi guarda la coda, non solo della conoscenza della rete');
});

// ── Una definizione sola per «coda» ────────────────────────────────────────
test('la coda usa la definizione del Drift Report, non una seconda somma', () => {
  const c = { stateDrift: 1, macOrphan: 2, undocumented: 3, ghostCable: 4, ipChanged: 5, identityDrift: 6,
              shutCable: 99, undocumentedEndpoint: 99, unverified: 99, identityFirmware: 99, consistent: 10 };
  assert.equal(quoteDiUnaRiga(riga('a', c, 100)).coda, driftActionable(c),
    'due posti che contano «la coda» con due somme diverse sono due verità sullo stesso numero');
  assert.equal(driftActionable(c), 21, 'e chi resta fuori ci resta per un motivo: spento a mano, rumore endpoint, non guardato, informativo');
});

// ── Il bucket che la timeline buttava via ──────────────────────────────────
test('la whitelist della timeline non deve perdere bucket per strada', () => {
  // ⚠️ Derivata, non ricopiata: l'elenco vero sono i counts del Drift Report.
  // Era così che «shutCable» spariva — due elenchi a mano che non combaciavano.
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'history.js'), 'utf8');
  const m = src.match(/const COUNT_KEYS = \[([\s\S]*?)\];/);
  assert.ok(m, 'la whitelist deve esistere');
  const whitelist = new Set((m[1].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1)));
  const testata = require('fs').readFileSync(path.join(__dirname, '..', 'lib', 'drift-report.js'), 'utf8');
  const bucket = (testata.match(/out\.counts = \{([\s\S]*?)\n {4}\};/) || [])[1] || '';
  const emessi = (bucket.match(/^\s{6}(\w+):/gm) || []).map(s => s.trim().replace(':', ''));
  assert.ok(emessi.length >= 10, 'letti i bucket veri dal report: ' + emessi.join(','));
  for (const k of emessi) {
    assert.ok(whitelist.has(k), 'il Drift Report emette «' + k + '» e la timeline lo butta via in silenzio');
  }
});
