'use strict';
// ============================================================
// IMPORT NETBOX — la NUMERAZIONE delle unita' del rack.
// Prima: la `position` di NetBox entrava com'era in `rackU`. Ma NetBox numera le unita' da `starting_unit` (>= 1) e, con
// `desc_units`, DALL'ALTO, mentre InfraNet conta sempre dal basso partendo da 1. In un rack che parte da 10, o numerato
// dall'alto, l'apparato finiva nella U sbagliata e il rapporto taceva (provato su un NetBox 4.6.7 vero: 7 apparati su 9,
// `_local/netbox/prova-rack-reale.js`). Qui: la conversione, i casi in cui NON si puo' dire (niente U inventata) e le due
// righe del rapporto.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const dcim = require('../lib/dcim-map.js');
const { buildDecisions } = require('../lib/dcim-decisions.js');
const i18n = require('../lib/i18n.js');

const N = 42;
const STD = { start: 1, desc: false, size: N };
const rack = (id, name, extra) => Object.assign({ id, name, u_height: N }, extra || {});
const dev = (id, name, rackId, position, h, extra) => Object.assign({
  id, name, role: { id: 40 }, rack: { id: rackId }, position, face: { value: 'front' },
  device_type: { id: 100 + (h || 0), model: 'M' + h, manufacturer: { name: 'ACME', slug: 'acme' }, u_height: h },
}, extra || {});
const importa = (racks, devices) => dcim.netboxToState({ deviceRoles: [{ id: 40, slug: 'switch', name: 'Switch' }], racks, devices, interfaces: [] });
const nodo = (r, id) => r.state.nodes.find((n) => n.id === 'nb-dev-' + id);
const issues = (r, code) => r.report.issues.filter((i) => i.code === code);

// ── la funzione pura ──────────────────────────────────────────────────────────────────────────
test('numerazione standard (da 1, dal basso): la posizione passa com\'e\', anche una mezza U, senza guardare il tetto', () => {
  assert.equal(dcim._physicalU(1, 2, STD), 1);
  assert.equal(dcim._physicalU(41, 2, STD), 41);
  assert.equal(dcim._physicalU(5.5, 0.5, STD), 5.5);
  assert.equal(dcim._physicalU(50, 2, STD), 50, 'come e\' sempre stato: lo standard non ha controllo del tetto');
  assert.equal(dcim._physicalU(7, null, STD), 7, 'senza l\'altezza si puo\' dire lo stesso, dal basso');
});

test('una posizione assente, zero o negativa non da una U', () => {
  for (const p of [null, undefined, 0, -3, 'x', NaN]) assert.equal(dcim._physicalU(p, 1, STD), null, String(p));
});

test('rack che parte da S: la U fisica e\' p - S + 1', () => {
  const n10 = { start: 10, desc: false, size: N };
  assert.equal(dcim._physicalU(10, 1, n10), 1);
  assert.equal(dcim._physicalU(20, 2, n10), 11);
  assert.equal(dcim._physicalU(50, 2, n10), 41, 'l\'ultima posizione utile di un rack da 42U che parte da 10 con un apparato da 2U');
  assert.equal(dcim._physicalU(2.5, 1, { start: 2, desc: false, size: N }), 1.5, 'mezza U');
});

test('rack numerato dall\'alto: la U fisica e\' N - (p - S) - h + 1', () => {
  const d = { start: 1, desc: true, size: N };
  assert.equal(dcim._physicalU(1, 2, d), 41, 'la posizione 1 e\' in cima');
  assert.equal(dcim._physicalU(41, 2, d), 1, 'l\'ultima e\' in fondo');
  assert.equal(dcim._physicalU(1, 1, d), 42);
  assert.equal(dcim._physicalU(10, 2, { start: 10, desc: true, size: N }), 41, 'dall\'alto E da 10');
});

test('quando NON si puo\' dire la risposta e\' null: mai una U inventata', () => {
  assert.equal(dcim._physicalU(1, null, { start: 1, desc: true, size: N }), null, 'dall\'alto serve l\'altezza dell\'apparato');
  assert.equal(dcim._physicalU(1, 0, { start: 1, desc: true, size: N }), null);
  assert.equal(dcim._physicalU(1, 2, { start: 1, desc: true, size: null }), null, 'dall\'alto serve l\'altezza del rack');
  assert.equal(dcim._physicalU(1, 2, { start: 10, desc: true, size: null }), null, 'senza l\'altezza del rack nemmeno una posizione bassa da una U (il controllo non e\' solo \'u >= 1\')');
  assert.equal(dcim._physicalU(3, 1, { start: 10, desc: false, size: N }), null, 'sotto la prima unita\' del rack');
  assert.equal(dcim._physicalU(9, 1, { start: 10, desc: false, size: N }), null, 'una sotto la prima: la U fisica sarebbe 0');
  assert.equal(dcim._physicalU(52, null, { start: 10, desc: false, size: N }), null, 'sopra la fine anche senza l\'altezza');
  assert.equal(dcim._physicalU(51, null, { start: 10, desc: false, size: N }), 42, 'l\'ultima U del rack, senza l\'altezza');
  assert.equal(dcim._physicalU(51, 2, { start: 10, desc: false, size: N }), null, 'sborda dall\'alto');
  assert.equal(dcim._physicalU(52, 1, { start: 10, desc: false, size: N }), null, 'sopra la fine del rack');
  assert.equal(dcim._physicalU(42, 2, { start: 1, desc: true, size: N }), null, 'dall\'alto: l\'apparato da 2U non ci sta');
});

test('la numerazione di un rack: valori assenti o non validi valgono lo standard; solo `true` vuol dire dall\'alto', () => {
  assert.deepEqual(dcim._rackNumbering({ u_height: 42 }), { start: 1, desc: false, size: 42 });
  assert.deepEqual(dcim._rackNumbering(null), { start: 1, desc: false, size: null });
  for (const s of [0, -1, 'x', null, undefined]) assert.equal(dcim._rackNumbering({ starting_unit: s, u_height: 42 }).start, 1, String(s));
  assert.equal(dcim._rackNumbering({ starting_unit: 10, u_height: 42 }).start, 10);
  assert.equal(dcim._rackNumbering({ starting_unit: '5', u_height: 42 }).start, 5, 'una stringa numerica (un NetBox che manda decimali come testo)');
  for (const d of ['true', 1, 'yes', false, null]) assert.equal(dcim._rackNumbering({ desc_units: d, u_height: 42 }).desc, false, String(d));
  assert.equal(dcim._rackNumbering({ desc_units: true, u_height: 42 }).desc, true);
  for (const u of [0, -2, 'x', null]) assert.equal(dcim._rackNumbering({ u_height: u }).size, null, String(u));
});

// ── l'ORACOLO: il rack ridisegnato come lo disegna NetBox, indipendente dalla formula ────────────────────────────────
// NetBox elenca le righe DALL'ALTO verso il basso: con numerazione normale l'etichetta piu' alta e' in cima, con `desc_units`
// la piu' bassa. (Verificato su un NetBox 4.6.7 con la vista frontale `/api/dcim/racks/<id>/elevation/`.) La U fisica piu'
// bassa di un apparato e' N meno l'indice della sua riga piu' in basso.
test('la conversione coincide col rack disegnato alla maniera di NetBox, su tutta la griglia (S, dall\'alto, p, h)', () => {
  const Nn = 12;
  let casi = 0;
  for (let S = 1; S <= 5; S++) for (const desc of [false, true]) for (let h = 1; h <= 3; h++) for (let p = S; p + h - 1 <= S + Nn - 1; p++) {
    const labels = []; for (let l = S; l < S + Nn; l++) labels.push(l);
    const righe = desc ? labels : labels.slice().reverse();                  // dall'alto in basso
    const occupate = []; for (let l = p; l < p + h; l++) occupate.push(righe.indexOf(l));
    const atteso = Nn - Math.max(...occupate);
    assert.equal(dcim._physicalU(p, h, { start: S, desc, size: Nn }), atteso, `S=${S} ${desc ? 'dall\'alto' : 'dal basso'} p=${p} h=${h}`);
    casi++;
  }
  assert.ok(casi > 100, 'la griglia non e\' vuota: ' + casi);
});

// ── l'import dal dato NetBox ──────────────────────────────────────────────────────────────────
const RACKS = [
  rack(1, 'R-standard', { starting_unit: 1, desc_units: false }),
  rack(2, 'R-da-2', { starting_unit: 2, desc_units: false }),
  rack(3, 'R-dall-alto', { starting_unit: 1, desc_units: true }),
  rack(4, 'R-da-10', { starting_unit: 10, desc_units: false }),
];
const DEVS = [
  dev(11, 'A-basso', 1, 1, 2), dev(12, 'A-alto', 1, 41, 2),
  dev(21, 'B-pos2', 2, 2, 1), dev(22, 'B-pos3', 2, 3, 2), dev(23, 'B-pos42', 2, 42, 2),
  dev(31, 'C-pos1', 3, 1, 2), dev(32, 'C-pos41', 3, 41, 2),
  dev(41, 'D-pos10', 4, 10, 1), dev(42, 'D-pos20', 4, 20, 2),
];

test('import: ogni apparato finisce nella U fisica giusta, in tutti e quattro i tipi di rack', () => {
  const r = importa(RACKS, DEVS);
  const got = Object.fromEntries(DEVS.map((d) => [d.name, nodo(r, d.id).rackU]));
  assert.deepEqual(got, { 'A-basso': 1, 'A-alto': 41, 'B-pos2': 1, 'B-pos3': 2, 'B-pos42': 41, 'C-pos1': 41, 'C-pos41': 1, 'D-pos10': 1, 'D-pos20': 11 });
  assert.equal(issues(r, 'rack.unitUnplaced').length, 0, 'nessun apparato resta senza U');
});

test('import: UNA riga dice quanti rack hanno una numerazione diversa, coi nomi; il rack standard non c\'e\'', () => {
  const r = importa(RACKS, DEVS);
  const righe = issues(r, 'rack.numbering');
  assert.equal(righe.length, 1);
  assert.equal(righe[0].n, 3);
  assert.deepEqual([...righe[0].sample].sort(), ['R-da-10', 'R-da-2', 'R-dall-alto']);
});

test('import: un rack non standard SENZA apparati in posizione non fa nascere la riga', () => {
  const r = importa([rack(2, 'R-da-2', { starting_unit: 2 }), rack(3, 'R-dall-alto', { desc_units: true })], [dev(21, 'Libero', 2, null, 1), dev(31, 'Zero', 3, 0, 1)]);
  assert.equal(issues(r, 'rack.numbering').length, 0);
  assert.equal(issues(r, 'rack.unitUnplaced').length, 0, 'senza posizione non c\'e\' niente da piazzare');
  assert.equal(nodo(r, 21).rackU, undefined);
});

test('import: un rack SENZA i due campi (un NetBox piu\' vecchio) si comporta come sempre, senza riga', () => {
  const r = importa([rack(1, 'Vecchio')], [dev(11, 'X', 1, 5, 2), dev(12, 'Sopra', 1, 60, 2)]);
  assert.equal(nodo(r, 11).rackU, 5);
  assert.equal(nodo(r, 12).rackU, 60, 'lo standard non guarda il tetto: com\'era');
  assert.equal(issues(r, 'rack.numbering').length + issues(r, 'rack.unitUnplaced').length, 0);
});

test('import: dall\'alto senza l\'altezza dell\'apparato resta nel rack SENZA U, e il rapporto lo nomina', () => {
  const r = importa([rack(3, 'R-dall-alto', { desc_units: true })], [dev(31, 'SenzaAltezza', 3, 5, undefined, { device_type: { id: 9, model: 'X', manufacturer: { name: 'ACME', slug: 'acme' } } })]);
  const n = nodo(r, 31);
  assert.equal(n.rackId, 'nb-rack-3', 'resta nel rack');
  assert.equal(n.rackU, undefined, 'senza una U inventata');
  const righe = issues(r, 'rack.unitUnplaced');
  assert.deepEqual(righe.map((x) => [x.deviceId, x.deviceName, x.rackName]), [[31, 'SenzaAltezza', 'R-dall-alto']]);
});

test('import: una posizione fuori dal rack con quella numerazione resta senza U e si dice', () => {
  const r = importa([rack(4, 'R-da-10', { starting_unit: 10 })], [dev(41, 'Sopra', 4, 60, 2), dev(42, 'Dentro', 4, 50, 2)]);
  assert.equal(nodo(r, 41).rackU, undefined);
  assert.equal(nodo(r, 42).rackU, 41);
  assert.deepEqual(issues(r, 'rack.unitUnplaced').map((x) => x.deviceId), [41]);
});

test('import: il rack con apparati su ENTRAMBI i lati diventa due rack; il retro usa la stessa numerazione', () => {
  const r = importa([rack(3, 'R', { desc_units: true })], [dev(31, 'Davanti', 3, 1, 2), dev(32, 'Dietro', 3, 1, 2, { face: { value: 'rear' } })]);
  assert.equal(nodo(r, 31).rackU, 41);
  assert.equal(nodo(r, 32).rackU, 41);
  assert.notEqual(nodo(r, 31).rackId, nodo(r, 32).rackId, 'il retro sta nell\'altro rack');
  assert.equal(issues(r, 'rack.numbering')[0].n, 1, 'e\' UN rack di NetBox, non due');
});

// ── le due righe nel preventivo, e le parole ──────────────────────────────────────────────────
test('le due righe sono «loss», con titolo e perche\' in italiano e in inglese, al singolare e al plurale', () => {
  const r = importa(RACKS, DEVS.concat([dev(43, 'Fuori', 4, 99, 1)]));
  const out = buildDecisions(r.report, {});
  for (const code of ['rack.numbering', 'rack.unitUnplaced']) {
    const riga = out.info.find((x) => x.code === code);
    assert.ok(riga, code + ' nelle righe informative');
    assert.equal(riga.severity, 'loss');
    assert.ok(out.outcome.costs.some((c) => c.code === code && c.severity === 'loss'), code + ' nel preventivo');
    for (const lang of ['it', 'en']) {
      for (const k of ['dcim.dec.' + code + '.title', 'dcim.dec.' + code + '.titleOne', 'dcim.dec.' + code + '.why', 'dcim.cost.' + code, 'dcim.cost.' + code + 'One']) {
        assert.ok(typeof i18n._i18nDict[lang][k] === 'string' && i18n._i18nDict[lang][k], lang + ': manca ' + k);
      }
    }
  }
  assert.equal(out.info.find((x) => x.code === 'rack.numbering').count, 3);
  assert.equal(out.info.find((x) => x.code === 'rack.unitUnplaced').count, 1);
});
