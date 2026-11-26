'use strict';
// ============================================================
// NEIGHBOR STORE — i vicini LLDP/CDP che non si sentono piu'
// ============================================================
// Ogni caso sta qui perche' una versione sbagliata direbbe una cosa FALSA ma plausibile:
//   • un vicino «sparito» perche' una lettura e' FALLITA (non e' un silenzio, e' un buco nostro);
//   • la stessa lettura rimandata due volte che fa «sparire» un vicino;
//   • un vicino che si e' spostato di porta, o che ha due porte remote, contato come perso;
//   • un apparato che spegne LLDP: N righe di «vicino perso» invece di UN fatto;
//   • il primo giro che produce subito dei «spariti».
// Le letture sono SINTETICHE: scritte a mano, non catturate da un apparato.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../lib/neighbor-store.js');
const D = require('../drivers/snmp.js');

const HOUR = 3600 * 1000;
const T0 = Date.now() - 20 * HOUR;
const nb = (localPort, remote, o) => Object.assign({ localPort, remoteDevice: remote, remotePort: 'Gi0/1', remoteMac: '', remoteIP: '', protocol: 'LLDP' }, o || {});
// Una lettura sana di UN apparato all'istante `k` (k-esima ora): { nodes: { sw: { at, neighbors } } }.
const read = (k, neighbors, id) => N.neighborSanitizePut({ nodes: { [id || 'sw']: { at: T0 + k * HOUR, neighbors } } });
function folded(steps, id) {   // steps = [[neighbors], …]: una lettura per passo
  let f = null;
  steps.forEach((nbs, k) => { f = N.neighborFold(f, read(k, nbs, id), T0 + k * HOUR); });
  return f;
}
const slotOf = (f, id) => N.neighborDecodeFile(f)[id || 'sw'];
const summ = (f, o, id) => N.neighborSummarize(slotOf(f, id), o);

// ── Il vicino come lo vede la cache ──────────────────────────────────────────
test('vicino: l\'identita\' e\' il MAC se c\'e\' (il nome puo\' cambiare), poi il nome, poi l\'IP; minuscolo', () => {
  assert.equal(N.neighborObserved(nb('Gi1', 'SW-B', { remoteMac: 'AA:BB:CC:00:11:22' })).remoteId, 'aa:bb:cc:00:11:22');
  assert.equal(N.neighborObserved(nb('Gi1', 'SW-B')).remoteId, 'sw-b');
  assert.equal(N.neighborObserved(nb('Gi1', '', { remoteIP: '10.0.0.7' })).remoteId, '10.0.0.7');
});
test('vicino: il nome si tiene com\'e\' per mostrarlo, anche se l\'identita\' e\' il MAC', () => {
  const o = N.neighborObserved(nb('Gi1', 'SW-B', { remoteMac: 'aa:bb:cc:00:11:22' }));
  assert.equal(o.remoteName, 'SW-B');
  assert.equal(o.remotePort, 'Gi0/1');
});
test('vicino: senza identita\' (ne\' MAC ne\' nome ne\' IP) o senza porta locale non si registra — non si inventa una riga', () => {
  assert.equal(N.neighborObserved(nb('Gi1', '')), null);
  assert.equal(N.neighborObserved(nb('', 'SW-B')), null);
  for (const x of [null, undefined, 5, 'x', []]) assert.equal(N.neighborObserved(x), null);
});
test('vicino: solo i protocolli che si leggono (LLDP, CDP), anche in minuscolo; il resto no', () => {
  assert.equal(N.neighborObserved(nb('Gi1', 'B', { protocol: 'lldp' })).proto, 'LLDP');
  assert.equal(N.neighborObserved(nb('Gi1', 'B', { protocol: 'CDP' })).proto, 'CDP');
  assert.equal(N.neighborObserved(nb('Gi1', 'B', { protocol: 'FDB' })), null);
  assert.equal(N.neighborObserved(nb('Gi1', 'B', { protocol: undefined })), null);
});
test('vicino: i caratteri di controllo e le lunghezze si ripuliscono (il nome arriva dall\'apparato)', () => {
  const o = N.neighborObserved(nb('Gi1\u0000', 'B\u0007' + 'x'.repeat(300)));
  assert.equal(o.localIf, 'Gi1');
  assert.equal(o.remoteName.length, 128);
});
test('chiave: la porta remota ne fa parte (lo stesso apparato due volte sulla stessa porta locale sono DUE voci)', () => {
  const a = N.neighborObserved(nb('Gi1/3', 'CSR1000', { remotePort: 'Gi1' }));
  const b = N.neighborObserved(nb('Gi1/3', 'CSR1000', { remotePort: 'Gi1.99' }));
  assert.notEqual(N.neighborKey(a), N.neighborKey(b));
  assert.equal(N.neighborKey(a), N.neighborKey(N.neighborObserved(nb('GI1/3', 'csr1000', { remotePort: 'GI1' }))), 'maiuscole indifferenti');
});
test('chiave: il protocollo ne fa parte (LLDP e CDP dello stesso vicino sono due voci, poi si raggruppano nel riepilogo)', () => {
  assert.notEqual(N.neighborKey(N.neighborObserved(nb('Gi1', 'B'))), N.neighborKey(N.neighborObserved(nb('Gi1', 'B', { protocol: 'CDP' }))));
});

// ── La PUT ───────────────────────────────────────────────────────────────────
test('PUT: serve un istante e un ELENCO (anche vuoto: «sano e senza vicini» e\' una lettura); senza no', () => {
  const p = N.neighborSanitizePut({ nodes: { a: { at: T0, neighbors: [] }, b: { at: T0 }, c: { neighbors: [] }, d: { at: 'x', neighbors: [] }, e: { at: T0, neighbors: 'x' } } });
  assert.deepEqual(Object.keys(p.nodes), ['a']);
  assert.deepEqual(p.nodes.a.neighbors, []);
});
test('PUT: id che non sono id d\'app, corpo che non e\' un oggetto, e tetti', () => {
  assert.deepEqual(Object.keys(N.neighborSanitizePut({ nodes: { '<b>': { at: T0, neighbors: [] }, ok: { at: T0, neighbors: [] }, '__proto__': { at: T0, neighbors: [] } } }).nodes), ['ok']);
  for (const b of [null, undefined, 5, 'x', [], { nodes: null }, { nodes: 'x' }]) assert.deepEqual(N.neighborSanitizePut(b), { nodes: {} });
  const many = []; for (let i = 0; i < 700; i++) many.push(nb('Gi' + i, 'N' + i));
  assert.equal(N.neighborSanitizePut({ nodes: { a: { at: T0, neighbors: many } } }).nodes.a.neighbors.length, 512);
  const nodes = {}; for (let i = 0; i < 1500; i++) nodes['n' + i] = { at: T0, neighbors: [] };
  assert.equal(Object.keys(N.neighborSanitizePut({ nodes }).nodes).length, 1000);
});
test('PUT: la stessa voce due volte nella stessa lettura e\' una voce; le voci senza identita\' si saltano', () => {
  const p = N.neighborSanitizePut({ nodes: { a: { at: T0, neighbors: [nb('Gi1', 'B'), nb('GI1', 'b'), nb('Gi2', ''), null] } } });
  assert.equal(p.nodes.a.neighbors.length, 1);
});

// ── La fusione ───────────────────────────────────────────────────────────────
test('fusione: la prima lettura registra i vicini con firstAt = lastAt e nessun mancato', () => {
  const r = slotOf(folded([[nb('Gi1', 'B')]])).rows[0];
  assert.deepEqual([r.firstAt, r.lastAt, r.misses], [T0, T0, 0]);
});
test('fusione: un vicino che non c\'e\' piu\' in una lettura SANA prende un mancato; se torna, si azzera e firstAt resta', () => {
  let f = folded([[nb('Gi1', 'B')], [], []]);
  assert.equal(slotOf(f).rows[0].misses, 2);
  f = N.neighborFold(f, read(3, [nb('Gi1', 'B')]), T0 + 3 * HOUR);
  const r = slotOf(f).rows[0];
  assert.deepEqual([r.misses, r.firstAt, r.lastAt], [0, T0, T0 + 3 * HOUR]);
});
test('fusione: la STESSA lettura rimandata non conta due volte (altrimenti rimandarla farebbe «sparire» un vicino)', () => {
  const f1 = folded([[nb('Gi1', 'B')], []]);
  const again = N.neighborFold(f1, read(1, []), T0 + HOUR);
  assert.deepEqual(again, f1);
  assert.equal(slotOf(again).rows[0].misses, 1);
});
test('fusione: una lettura PIU\' VECCHIA (un client rimasto indietro) non cambia niente', () => {
  const f1 = folded([[nb('Gi1', 'B')], [], []]);
  const old = N.neighborFold(f1, read(0, [nb('Gi1', 'B')]), T0 + 2 * HOUR);
  assert.deepEqual(old, f1);
});
test('fusione: un apparato che NON e\' nella PUT (lettura fallita) non prende nessun mancato', () => {
  let f = folded([[nb('Gi1', 'B')]], 'a');
  f = N.neighborFold(f, read(1, [], 'b'), T0 + HOUR);   // legge solo b
  f = N.neighborFold(f, read(2, [], 'b'), T0 + 2 * HOUR);
  assert.equal(slotOf(f, 'a').rows[0].misses, 0, 'a non e\' stato letto: nessun silenzio');
});
test('fusione: il nome del vicino si aggiorna (puo\' cambiare), l\'identita\' no', () => {
  const f = folded([[nb('Gi1', 'OLD', { remoteMac: 'aa:bb:cc:00:00:01' })], [nb('Gi1', 'NEW', { remoteMac: 'aa:bb:cc:00:00:01' })]]);
  assert.equal(slotOf(f).rows.length, 1);
  assert.equal(slotOf(f).rows[0].remoteName, 'NEW');
});
test('fusione: un vicino non sentito da 90 giorni cade', () => {
  const f = folded([[nb('Gi1', 'B')]]);
  const later = N.neighborFold(f, N.neighborSanitizePut({ nodes: { sw: { at: T0 + 100 * 24 * HOUR, neighbors: [] } } }), T0 + 100 * 24 * HOUR);
  assert.deepEqual(slotOf(later).rows, []);
});
test('fusione: un tetto di righe per apparato, restano prima i sentiti adesso', () => {
  const many = []; for (let i = 0; i < 400; i++) many.push(nb('Gi' + i, 'N' + i));
  let f = N.neighborFold(null, read(0, many), T0);
  const more = many.slice(0, 200).concat(Array.from({ length: 400 }, (_, i) => nb('Fa' + i, 'M' + i)));   // 400 nuovi
  f = N.neighborFold(f, read(1, more), T0 + HOUR);
  const rows = slotOf(f).rows;
  assert.equal(rows.length, 512);
  assert.equal(rows.filter(r => r.misses === 0).length, 512, 'i sentiti adesso hanno la precedenza sui vecchi (600 sentiti → 512 tenuti, tutti sentiti)');
});
test('fusione: ritorna un file NUOVO e non muta quello di prima', () => {
  const f0 = folded([[nb('Gi1', 'B')]]);
  const snap = JSON.stringify(f0);
  N.neighborFold(f0, read(1, []), T0 + HOUR);
  assert.equal(JSON.stringify(f0), snap);
});
test('disco: tuple di scalari nell\'ordine di NEIGHBOR_COLUMNS, e andata e ritorno', () => {
  const f = folded([[nb('Gi1', 'B', { remoteMac: 'aa:bb:cc:00:00:01', remotePort: 'Gi0/9' })]]);
  const tup = f.nodes.sw.r[0];
  assert.equal(tup.length, N.NEIGHBOR_COLUMNS.length);
  for (const v of tup) assert.ok(['string', 'number'].includes(typeof v));
  assert.deepEqual(N.neighborDecodeFile(f).sw.rows[0], { localIf: 'Gi1', proto: 'LLDP', remoteId: 'aa:bb:cc:00:00:01', remoteName: 'B', remotePort: 'Gi0/9', firstAt: T0, lastAt: T0, misses: 0 });
});
test('disco: un file illeggibile o strano non rompe la lettura', () => {
  for (const f of [null, undefined, 5, 'x', [], {}, { nodes: null }, { nodes: { a: null } }, { nodes: { a: { at: 'x', r: 5 } } }, { nodes: { '<b>': { at: T0, r: [] } } }]) {
    assert.deepEqual(N.neighborDecodeFile(f), {});
  }
});
test('righe piatte: una per vicino, con apparato e istante, solo scalari', () => {
  const flat = N.neighborFlatRows(folded([[nb('Gi1', 'B'), nb('Gi2', 'C')]]));
  assert.equal(flat.length, 2);
  for (const r of flat) {
    for (const c of ['node', 'readAt'].concat(N.NEIGHBOR_COLUMNS)) assert.ok(c in r, c);
    for (const v of Object.values(r)) assert.ok(['string', 'number'].includes(typeof v));
  }
});

// ── Il riepilogo: cosa si puo' dire ──────────────────────────────────────────
test('riepilogo: il PRIMO giro non produce mai «spariti» (niente da confrontare)', () => {
  const s = summ(folded([[nb('Gi1', 'B'), nb('Gi2', 'C')]]));
  assert.deepEqual(s.groups, []);
  assert.equal(s.present, 2);
});
test('riepilogo: un solo mancato (o due) non e\' un silenzio — l\'anti-flap e\' di N = 3 letture sane di fila', () => {
  assert.equal(N.NEIGHBOR_SILENCE_READS, 3);
  const keep = nb('Gi2', 'C');
  assert.equal(summ(folded([[nb('Gi1', 'B'), keep], [keep]])).groups.length, 0);
  assert.equal(summ(folded([[nb('Gi1', 'B'), keep], [keep], [keep]])).groups.length, 0, 'due mancati');
  const s = summ(folded([[nb('Gi1', 'B'), keep], [keep], [keep], [keep]]));
  assert.equal(s.groups.length, 1, 'tre mancati: silenzioso');
  assert.equal(s.groups[0].localIf, 'Gi1');
  assert.equal(s.groups[0].misses, 3);
  assert.equal(s.groups[0].lastAt, T0);
});
test('riepilogo: la soglia si puo\' cambiare (opts.silence) e un valore assurdo ricade sul default', () => {
  const keep = nb('Gi2', 'C');
  const f = folded([[nb('Gi1', 'B'), keep], [keep]]);
  assert.equal(summ(f, { silence: 1 }).groups.length, 1);
  assert.equal(summ(f, { silence: 0 }).groups.length, 0);
  assert.equal(summ(f, { silence: 'x' }).groups.length, 0);
});
test('riepilogo: il vicino che torna dopo il silenzio non e\' piu\' silenzioso', () => {
  const keep = nb('Gi2', 'C');
  let f = folded([[nb('Gi1', 'B'), keep], [keep], [keep], [keep]]);
  f = N.neighborFold(f, read(4, [nb('Gi1', 'B'), keep]), T0 + 4 * HOUR);
  assert.equal(summ(f).groups.length, 0);
});
test('riepilogo: se lo STESSO apparato e\' ancora sentito (un\'altra porta, un altro protocollo) non e\' sparito — si e\' spostato', () => {
  const keep = nb('Gi9', 'C');
  const moved = folded([[nb('Gi1', 'B', { remoteMac: 'aa:bb:cc:00:00:01' }), keep], [nb('Gi7', 'B', { remoteMac: 'aa:bb:cc:00:00:01' }), keep], [nb('Gi7', 'B', { remoteMac: 'aa:bb:cc:00:00:01' }), keep], [nb('Gi7', 'B', { remoteMac: 'aa:bb:cc:00:00:01' }), keep]]);
  const s = summ(moved);
  assert.equal(s.groups.length, 0);
  assert.equal(s.counts.stillHeard, 1);
});
test('riepilogo: porta locale GIU\' → non si ripete qui (lo dicono le porte giu\' e il cavo fantasma), ma si conta', () => {
  const keep = nb('Gi2', 'C');
  const f = folded([[nb('Gi1', 'B'), keep], [keep], [keep], [keep]]);
  const s = summ(f, { portState: (p) => (p === 'Gi1' ? 'down' : 'up') });
  assert.equal(s.groups.length, 0);
  assert.equal(s.counts.linkDown, 1);
});
test('riepilogo: porta su → «up»; porta non letta → «unknown» (non si finge di saperlo); senza funzione → «unknown»', () => {
  const keep = nb('Gi2', 'C');
  const f = folded([[nb('Gi1', 'B'), keep], [keep], [keep], [keep]]);
  assert.equal(summ(f, { portState: () => 'up' }).groups[0].portState, 'up');
  assert.equal(summ(f, { portState: () => null }).groups[0].portState, 'unknown');
  assert.equal(summ(f).groups[0].portState, 'unknown');
});
test('riepilogo: se TUTTI i vicini noti tacciono insieme e\' UN fatto («non riferisce piu\' vicini»), non N righe', () => {
  const s = summ(folded([[nb('Gi1', 'B'), nb('Gi2', 'C'), nb('Gi3', 'D')], [], [], []]));
  assert.equal(s.deviceSilent, true);
  assert.equal(s.silentCount, 3);
  assert.deepEqual(s.groups, []);
  assert.equal(s.lastHeardAt, T0);
});
test('riepilogo: se ALMENO UNO e\' ancora sentito non e\' un apparato muto — sono i singoli vicini', () => {
  const s = summ(folded([[nb('Gi1', 'B'), nb('Gi2', 'C')], [nb('Gi2', 'C')], [nb('Gi2', 'C')], [nb('Gi2', 'C')]]));
  assert.equal(s.deviceSilent, false);
  assert.equal(s.groups.length, 1);
});
test('riepilogo: un apparato senza vicini noti non e\' «muto» (non c\'e\' niente che sia tacito)', () => {
  const s = summ(folded([[], [], [], []]));
  assert.equal(s.deviceSilent, false);
  assert.deepEqual(s.groups, []);
});
test('riepilogo: LLDP e CDP dello stesso vicino, e piu\' porte remote, sono UNA riga', () => {
  const keep = nb('Gi9', 'Z');
  const both = [nb('Gi1', 'B', { remoteMac: 'aa:bb:cc:00:00:01', remotePort: 'Gi1' }), nb('Gi1', 'B', { remoteMac: 'aa:bb:cc:00:00:01', remotePort: 'Gi1.99' }), nb('Gi1', 'B', { remoteMac: 'aa:bb:cc:00:00:01', protocol: 'CDP', remotePort: 'GigabitEthernet1' }), keep];
  const s = summ(folded([both, [keep], [keep], [keep]]));
  assert.equal(s.groups.length, 1);
  assert.deepEqual(s.groups[0].protos.sort(), ['CDP', 'LLDP']);
  assert.deepEqual(s.groups[0].ports.sort(), ['Gi1', 'Gi1.99', 'GigabitEthernet1']);
});
test('riepilogo: slot assente o vuoto → niente, senza eccezioni', () => {
  for (const s of [null, undefined, {}, { at: T0, rows: [] }, { at: T0, rows: 'x' }]) {
    const r = N.neighborSummarize(s);
    assert.deepEqual([r.groups.length, r.deviceSilent, r.present], [0, false, 0]);
  }
});
test('riepilogo: i silenziosi piu\' recenti prima', () => {
  const keep = nb('Gi9', 'Z');
  let f = N.neighborFold(null, read(0, [nb('Gi1', 'OLD'), keep]), T0);
  f = N.neighborFold(f, read(1, [nb('Gi2', 'NEW'), keep]), T0 + HOUR);
  for (let k = 2; k <= 5; k++) f = N.neighborFold(f, read(k, [keep]), T0 + k * HOUR);
  assert.deepEqual(summ(f).groups.map(g => g.remoteName), ['NEW', 'OLD']);
});

// ── Provenienza: gli OID dei protocolli sono quelli che il driver legge davvero ──────────
test('provenienza: la radice di LLDP e CDP e\' la stessa del driver (una definizione sola, non una copia che puo\' divergere)', () => {
  const O = D._internals.N_OID;
  assert.ok(O.lldpRemChassisId.startsWith(N.NEIGHBOR_PROTOCOLS.LLDP.oid + '.'), 'LLDP');
  assert.ok(O.lldpRemPortId.startsWith(N.NEIGHBOR_PROTOCOLS.LLDP.oid + '.'), 'LLDP');
  const cdpKeys = Object.keys(O).filter(k => /^cdp[A-Z]/.test(k));
  assert.ok(cdpKeys.length > 0, 'il driver legge la cache CDP');
  for (const k of cdpKeys) assert.ok(O[k].startsWith(N.NEIGHBOR_PROTOCOLS.CDP.oid + '.'), k);
});

// ── Due buchi trovati dai mutanti ────────────────────────────────────────────
test('invecchiamento: anche un apparato che NON e\' nella PUT perde i vicini non sentiti da 90 giorni', () => {
  const f0 = folded([[nb('Gi1', 'B')]], 'vecchio');
  const later = T0 + 100 * 24 * HOUR;
  const f1 = N.neighborFold(f0, N.neighborSanitizePut({ nodes: { altro: { at: later, neighbors: [nb('Gi1', 'X')] } } }), later);
  assert.deepEqual(slotOf(f1, 'vecchio') ? slotOf(f1, 'vecchio').rows : [], [], 'le righe vecchie sono cadute');
  assert.equal(slotOf(f1, 'altro').rows.length, 1);
});
test('riepilogo: DUE vicini diversi silenziosi sulla stessa porta locale (un hub, un uplink con due dietro) sono DUE righe', () => {
  const keep = nb('Gi9', 'Z');
  const s = summ(folded([[nb('Gi1', 'B', { remoteMac: 'aa:bb:cc:00:00:01' }), nb('Gi1', 'C', { remoteMac: 'aa:bb:cc:00:00:02' }), keep], [keep], [keep], [keep]]));
  assert.equal(s.groups.length, 2);
  assert.deepEqual(s.groups.map(g => g.remoteName).sort(), ['B', 'C']);
});

// ── La riga della Verifica e' il SOLO posto dei vicini silenziosi ───────────────────────────
// Il pannello dell'apparato non ha piu' una scheda (decisione dell'utente: «lo lasciamo solo dentro a dashboard»): quello che la scheda
// diceva — che il silenzio non e' una contraddizione — deve stare nel suggerimento della riga, altrimenti la Verifica direbbe «vicino
// non riferito» senza dire che NON e' un cavo tolto.
test('il suggerimento della riga della Verifica dice da dove viene e che il silenzio non e\' una contraddizione (IT e EN)', () => {
  const I = require('../lib/i18n.js');
  try {
    for (const [lang, re] of [['it', /Silenzio non è contraddizione: non dice che il cavo sia stato tolto/], ['en', /Silence is not contradiction: it does not say a cable was removed/]]) {
      I.setLang(lang);
      const tip = I.t('nb.drift.tip', { proto: 'LLDP', oid: '1.0.8802.1.1.2.1.4.1', when: 'x', n: '3', port: 'p' });
      assert.match(tip, re, lang);
      assert.match(tip, /1\.0\.8802\.1\.1\.2\.1\.4\.1/, lang + ': dice da quale OID lo sa');
    }
  } finally { I.setLang('it'); }
});
