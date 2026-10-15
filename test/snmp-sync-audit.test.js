'use strict';
// La riga di Storia dopo un Sync (lib/snmp-sync-audit.js).
//
// Nasce da una domanda: «la storia dice ancora che tutti sono raggiungibili, ma molti sono
// offline». La riga leggeva «18/18 dispositivi · tutti raggiungibili», e il progetto aveva 47
// apparati: i 18 erano quelli con integrazione SNMP, gli unici che il Sync interroga. Una frase
// vera su un sottoinsieme, scritta come se parlasse del tutto.
//
// Qui si usano i testi VERI (it/en) e la VERA computeSubbarStats: il conteggio dei «non letti»
// e' quello che l'app usa per dire cos'e' un apparato, non una copia scritta nel test.
const test = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../lib/i18n.js');
const { computeSubbarStats } = require('../lib/subbar-stats.js');
const { describeSnmpSync } = require('../lib/snmp-sync-audit.js');

// Il pezzo del catalogo che serve: attivi, endpoint con IP, passivi puri, UPS (passivo MA con IP), stanze.
const TYPES = {
  switch: { isActive: true }, router: { isActive: true },
  pc: { hasIP: true }, webcam: { hasIP: true }, iot: { hasIP: true },
  ups: { isPassive: true, hasIP: true },
  wallport: { isPassive: true }, patchpanel: { isPassive: true },
  room: { isStructural: true },
};

// Un progetto come il lab: 18 apparati con SNMP; 25 senza (che il Sync non tocca); 4 passivi puri; 1 stanza.
function labProject() {
  const nodes = [];
  for (let i = 0; i < 18; i++) nodes.push({ id: 'sw' + i, type: 'switch', ip: '10.0.0.' + (i + 1), integration: { driver: 'snmp-v2c', host: '10.0.0.' + (i + 1) } });
  for (let i = 0; i < 8; i++) nodes.push({ id: 'pc' + i, type: 'pc', ip: '10.0.1.' + i });
  for (let i = 0; i < 8; i++) nodes.push({ id: 'cam' + i, type: 'webcam', ip: '10.0.2.' + i });
  for (let i = 0; i < 8; i++) nodes.push({ id: 'iot' + i, type: 'iot' });
  nodes.push({ id: 'ups1', type: 'ups', ip: '10.0.3.1' });          // passivo CON ip: e' un apparato, non un passivo puro
  for (let i = 0; i < 3; i++) nodes.push({ id: 'wp' + i, type: 'wallport' });
  nodes.push({ id: 'pp1', type: 'patchpanel' });
  nodes.push({ id: 'room1', type: 'room' });
  return nodes;
}
const statsOf = (nodes) => computeSubbarStats(nodes, TYPES);

test('il caso del lab: 18 su 18 letti, e 25 apparati senza SNMP detti «non letti»', () => {
  i18n.setLang('it');
  const r = describeSnmpSync({ ok: 18, err: 0, total: 18 }, statsOf(labProject()), i18n.t);
  assert.equal(r.target, '18/18 apparati SNMP letti');
  // 8 pc + 8 webcam + 8 iot + 1 UPS = 25. Le 4 prese/patch e la stanza NON contano.
  assert.equal(r.summary, 'nessun errore di lettura · 25 senza SNMP, non letti');
});

test('la riga non dice MAI «raggiungibili»: parla di letture, non dello stato del progetto', () => {
  // Era la frase sbagliata: valeva per i soli apparati SNMP e si leggeva come «tutto il progetto risponde».
  for (const lang of ['it', 'en']) {
    i18n.setLang(lang);
    for (const [ok, err] of [[18, 0], [10, 8], [0, 18]]) {
      const r = describeSnmpSync({ ok, err, total: 18 }, statsOf(labProject()), i18n.t);
      assert.doesNotMatch(r.target + ' ' + r.summary, /raggiungibil|reachable/i, `${lang} ${ok}/${err}: ${r.target} · ${r.summary}`);
    }
  }
  i18n.setLang('it');
});

test('con errori: il numero dei falliti resta, e i non letti si aggiungono', () => {
  i18n.setLang('it');
  const r = describeSnmpSync({ ok: 16, err: 2, total: 18 }, statsOf(labProject()), i18n.t);
  assert.equal(r.target, '16/18 apparati SNMP letti');
  assert.equal(r.summary, '2 in errore · 25 senza SNMP, non letti');
});

test('stanze e passivi puri di cablaggio non sono mai «non letti»; un UPS (passivo con IP) si', () => {
  i18n.setLang('it');
  // Solo apparati SNMP, passivi e una stanza: non c'e' nulla che il Sync lasci fuori.
  const soloSnmp = [
    { id: 'a', type: 'switch', ip: '10.0.0.1', integration: { driver: 'snmp-v2c', host: '10.0.0.1' } },
    { id: 'p1', type: 'wallport' }, { id: 'p2', type: 'patchpanel' }, { id: 'r', type: 'room' },
  ];
  assert.equal(describeSnmpSync({ ok: 1, err: 0, total: 1 }, statsOf(soloSnmp), i18n.t).summary, 'nessun errore di lettura',
    'niente coda quando non resta fuori nessun apparato');
  // Aggiungo UN UPS con IP: e' un apparato che il Sync non legge.
  const conUps = soloSnmp.concat([{ id: 'u', type: 'ups', ip: '10.0.3.1' }]);
  assert.equal(describeSnmpSync({ ok: 1, err: 0, total: 1 }, statsOf(conUps), i18n.t).summary, 'nessun errore di lettura · 1 senza SNMP, non letti');
});

test('senza statistiche (la libreria non e\' caricata) non lancia e non inventa un conteggio', () => {
  i18n.setLang('it');
  const r = describeSnmpSync({ ok: 3, err: 0, total: 3 }, null, i18n.t);
  assert.equal(r.summary, 'nessun errore di lettura');
  assert.equal(r.target, '3/3 apparati SNMP letti');
});

test('in inglese dice le stesse cose', () => {
  i18n.setLang('en');
  const r = describeSnmpSync({ ok: 18, err: 0, total: 18 }, statsOf(labProject()), i18n.t);
  assert.equal(r.target, '18/18 SNMP devices read');
  assert.equal(r.summary, 'no read errors · 25 without SNMP, not read');
  const e = describeSnmpSync({ ok: 16, err: 2, total: 18 }, statsOf(labProject()), i18n.t);
  assert.equal(e.summary, '2 failed · 25 without SNMP, not read');
  i18n.setLang('it');
});
