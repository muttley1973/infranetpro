'use strict';
// Test della validazione smart cablaggio (lib/cable-validate.js, P1.4).
const test = require('node:test');
const assert = require('node:assert');
const { validateCable } = require('../lib/cable-validate.js');

const codes = r => r.map(x => x.code).sort();
const has = (r, code) => r.some(x => x.code === code);

test('cavo coerente → nessun problema', () => {
  const r = validateCable({ medium:'copper', cableCategory:'Cat6A', connector:'RJ45', maxSpeed:'10G', length:40 });
  assert.deepEqual(r, []);
});

test('mezzo rame + categoria fibra → error medium-cat', () => {
  const r = validateCable({ medium:'copper', cableCategory:'OM4' });
  assert.ok(has(r, 'medium-cat'));
  assert.equal(r.find(x=>x.code==='medium-cat').level, 'error');
});

test('mezzo fibra + categoria rame → error medium-cat', () => {
  assert.ok(has(validateCable({ medium:'fiber', cableCategory:'Cat6' }), 'medium-cat'));
});

test('connettore ottico (LC) su rame → error medium-conn', () => {
  assert.ok(has(validateCable({ medium:'copper', connector:'LC' }), 'medium-conn'));
});

test('RJ45 su fibra → error medium-conn', () => {
  assert.ok(has(validateCable({ medium:'fiber', connector:'RJ45' }), 'medium-conn'));
});

test('10G su Cat5e → warn speed-cat (con consiglio Cat6A)', () => {
  const r = validateCable({ medium:'copper', cableCategory:'Cat5e', maxSpeed:'10G' });
  const w = r.find(x=>x.code==='speed-cat');
  assert.ok(w && w.level==='warn');
  assert.equal(w.params.rec, 'Cat6A', 'la categoria consigliata e\' un DATO, non una frase');
  assert.equal(w.params.recReach, 100);
});

test('10G su Cat6 → warn speed-cat (coda con la nota dei 55m)', () => {
  const w = validateCable({ medium:'copper', cableCategory:'Cat6', maxSpeed:'10G' }).find(x=>x.code==='speed-cat');
  assert.ok(w);
  // La nota «su Cat6 il 10G regge solo fino a ~55m» e' una CODA scelta dalla lib
  // (params.tail) e resa dal renderer: qui si verifica la scelta, non la prosa.
  assert.equal(w.params.tail, 'recCat6');
  assert.equal(w.params.rec, 'Cat6A');
});

test('1G su Cat5e → nessun warn velocità', () => {
  assert.equal(has(validateCable({ medium:'copper', cableCategory:'Cat5e', maxSpeed:'1G' }), 'speed-cat'), false);
});

test('100G su Cat8 → messaggio con reach 30m, MAI "40G a 100m"', () => {
  // Cat8 è specificato a 30m per 25/40GBASE-T, non 100m: il messaggio speed-cat
  // non deve più dire "a 100m" per una categoria a corto raggio.
  const w = validateCable({ medium:'copper', cableCategory:'Cat8', maxSpeed:'100G' }).find(x=>x.code==='speed-cat');
  assert.ok(w);
  assert.equal(w.params.catReach, 30, 'la reach di Cat8 e\' 30m, non 100m');
  assert.equal(w.params.catMax, '40G');
  assert.equal(w.params.tail, 'noCopper', '100G non passa sul rame: nessuna categoria da consigliare');
  assert.equal(w.params.rec, '');
});

test('25G su Cat6 → consiglia Cat8 alla sua reach reale (30m)', () => {
  const w = validateCable({ medium:'copper', cableCategory:'Cat6', maxSpeed:'25G' }).find(x=>x.code==='speed-cat');
  assert.ok(w);
  assert.equal(w.params.rec, 'Cat8');
  assert.equal(w.params.recReach, 30, 'consigliata alla SUA reach reale, non a 100m');
  assert.equal(w.params.tail, 'rec');
});

test('rame > 100m → warn copper-length (TIA-568)', () => {
  const w = validateCable({ medium:'copper', cableCategory:'Cat6', length:130 }).find(x=>x.code==='copper-length');
  assert.ok(w && w.level==='warn');
  assert.equal(w.params.len, 130);
});

test('rame a 90m → nessun warn lunghezza', () => {
  assert.equal(has(validateCable({ medium:'copper', length:90 }), 'copper-length'), false);
});

test('Cat8 40G a 60m → warn cat-reach (limite 30m)', () => {
  const w = validateCable({ medium:'copper', cableCategory:'Cat8', maxSpeed:'40G', length:60 }).find(x=>x.code==='cat-reach');
  assert.ok(w && w.level==='warn');
  assert.equal(w.params.max, 30);
  assert.equal(w.params.len, 60);
  assert.equal(w.params.cat, 'Cat8');
});

test('Cat8 a 25m → nessun warn cat-reach (entro il limite)', () => {
  assert.equal(has(validateCable({ medium:'copper', cableCategory:'Cat8', maxSpeed:'40G', length:25 }), 'cat-reach'), false);
});

test('Cat8 a 130m → solo copper-length, non cat-reach (oltre i 100m parla la #4)', () => {
  const r = validateCable({ medium:'copper', cableCategory:'Cat8', length:130 });
  assert.ok(has(r, 'copper-length'));
  assert.equal(has(r, 'cat-reach'), false);
});

test('Cat6A a 80m → nessun cat-reach (reach 100m)', () => {
  assert.equal(has(validateCable({ medium:'copper', cableCategory:'Cat6A', maxSpeed:'10G', length:80 }), 'cat-reach'), false);
});

test('DAC > 10m → warn dac-length', () => {
  assert.ok(has(validateCable({ medium:'dac', length:15 }), 'dac-length'));
});

test('PoE su fibra → error poe-fiber', () => {
  const e = validateCable({ medium:'fiber', poe:'802.3at' }).find(x=>x.code==='poe-fiber');
  assert.ok(e && e.level==='error');
});

test('PoE none su fibra → nessun problema PoE', () => {
  assert.equal(has(validateCable({ medium:'fiber', poe:'none', cableCategory:'OM4' }), 'poe-fiber'), false);
});

test('802.3bt su Cat5e → warn poe-cat', () => {
  assert.ok(has(validateCable({ medium:'copper', cableCategory:'Cat5e', poe:'802.3bt' }), 'poe-cat'));
});

test('cross-check: porta negozia 10G ma cavo dichiarato 1G → warn speed-vs-snmp', () => {
  const w = validateCable({ medium:'copper', maxSpeed:'1G' }, { snmpSpeedMbps:10000 }).find(x=>x.code==='speed-vs-snmp');
  assert.ok(w);
  assert.equal(w.params.real, '10G', 'la velocita\' misurata, gia\' in etichetta leggibile');
  assert.equal(w.params.doc, '1G');
});

test('cross-check mezzo: SNMP fibra vs doc rame → warn medium-vs-snmp', () => {
  const w = validateCable({ medium:'copper' }, { snmpMedium:'fiber' }).find(x=>x.code==='medium-vs-snmp');
  assert.ok(w);
  // I mezzi restano CHIAVI: «Rame»/«Fibra» sono parole, e le mette il renderer.
  assert.equal(w.params.snmp, 'fiber');
  assert.equal(w.params.doc, 'copper');
});

test('lengthM come fallback di length', () => {
  assert.ok(has(validateCable({ medium:'copper', lengthM:120 }), 'copper-length'));
});

test('native VLAN mismatch su trunk fra apparati attivi → error', () => {
  const r = validateCable({}, { isTrunk:true, srcNative:1, dstNative:99 });
  const e = r.find(x => x.code === 'native-mismatch');
  assert.ok(e && e.level === 'error');
  assert.equal(e.params.a, 1);
  assert.equal(e.params.b, 99);
  // nativa coincidente → nessun problema
  assert.ok(!has(validateCable({}, { isTrunk:true, srcNative:10, dstNative:10 }), 'native-mismatch'));
  // non trunk, o un capo non attivo (native null) → niente check
  assert.ok(!has(validateCable({}, { isTrunk:false, srcNative:1, dstNative:99 }), 'native-mismatch'));
  assert.ok(!has(validateCable({}, { isTrunk:true, srcNative:1, dstNative:null }), 'native-mismatch'));
});

test('campi vuoti / link nullo → nessun crash, nessun problema', () => {
  assert.deepEqual(validateCable(null), []);
  assert.deepEqual(validateCable({}), []);
});

// ── C1: l'eccezione a corto raggio è NORMA, non un errore da segnalare ──────
test('10G su Cat6 a ≤55m NON è un problema: 802.3an/TSB-155 lo ammette', () => {
  // Un avviso su una posa conforme insegna a ignorare gli avvisi. La lunghezza
  // deve essere DICHIARATA: senza, non si può sapere se sta dentro i 55m.
  const corta = validateCable({ medium: 'copper', cableCategory: 'Cat6', maxSpeed: '10G', length: 40 });
  assert.equal(has(corta, 'speed-cat'), false, '40m: dentro la clausola dei 55m');
  const alLimite = validateCable({ medium: 'copper', cableCategory: 'Cat6', maxSpeed: '10G', length: 55 });
  assert.equal(has(alLimite, 'speed-cat'), false, '55m esatti: ancora ammesso');
  const lunga = validateCable({ medium: 'copper', cableCategory: 'Cat6', maxSpeed: '10G', length: 70 });
  assert.equal(has(lunga, 'speed-cat'), true, '70m: oltre la clausola, il warn resta');
  const senzaLen = validateCable({ medium: 'copper', cableCategory: 'Cat6', maxSpeed: '10G' });
  assert.equal(has(senzaLen, 'speed-cat'), true, 'lunghezza non dichiarata: non si può assumere che sia corta');
  // L'eccezione vale per QUELLA coppia, non per il rame in generale.
  assert.equal(has(validateCable({ medium: 'copper', cableCategory: 'Cat5e', maxSpeed: '10G', length: 20 }), 'speed-cat'),
    true, 'Cat5e a 10G non ha nessuna clausola a corto raggio');
});

// ── C2: la tratta in FIBRA non era validata affatto ─────────────────────────
test('fibra oltre la portata della sua classe ottica → warn fiber-reach', () => {
  const om3 = validateCable({ medium: 'fiber', cableCategory: 'OM3', maxSpeed: '10G', length: 400 });
  const w = om3.find(x => x.code === 'fiber-reach');
  assert.ok(w, 'OM3 a 400m con 10G: oltre i 300m di portata');
  assert.equal(w.level, 'warn');
  assert.equal(w.params.max, 300);
  assert.equal(w.params.cat, 'OM3');
  assert.equal(w.params.rec, 'OM4', 'consiglia la classe che ci arriva');
  assert.equal(has(validateCable({ medium: 'fiber', cableCategory: 'OM3', maxSpeed: '10G', length: 250 }), 'fiber-reach'),
    false, '250m su OM3 a 10G: dentro la portata');
});

test('fibra: la portata dipende dalla VELOCITÀ, non solo dalla classe', () => {
  // È il punto per cui una tabella «OM3 = 300m» sarebbe stata sbagliata: a 40G
  // la stessa fibra arriva a 100m. Stessa posa, stesso cavo, esito diverso.
  const a10 = validateCable({ medium: 'fiber', cableCategory: 'OM3', maxSpeed: '10G', length: 150 });
  const a40 = validateCable({ medium: 'fiber', cableCategory: 'OM3', maxSpeed: '40G', length: 150 });
  assert.equal(has(a10, 'fiber-reach'), false, '150m a 10G: ci sta');
  assert.equal(has(a40, 'fiber-reach'), true, '150m a 40G: NON ci sta (OM3 = 100m)');
});

test('fibra: senza classe, senza velocità o senza lunghezza NON si inventa un verdetto', () => {
  for (const l of [
    { medium: 'fiber', maxSpeed: '10G', length: 5000 },                       // classe non dichiarata
    { medium: 'fiber', cableCategory: 'OM3', length: 5000 },                  // velocità non dichiarata
    { medium: 'fiber', cableCategory: 'OM3', maxSpeed: '10G' },               // lunghezza non dichiarata
    { medium: 'fiber', cableCategory: 'OM3', maxSpeed: '400G', length: 5000 },// velocità fuori tabella
  ]) {
    assert.equal(has(validateCable(l), 'fiber-reach'), false, JSON.stringify(l));
  }
  // OS2 monomodale: 10 km di portata LR/LX, una dorsale di campus non la supera.
  assert.equal(has(validateCable({ medium: 'fiber', cableCategory: 'OS2', maxSpeed: '10G', length: 2000 }), 'fiber-reach'), false);
});
