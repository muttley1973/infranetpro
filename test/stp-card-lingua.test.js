'use strict';
// ============================================================
// La scheda dello switch scrive data e numeri nella lingua dell'INTERFACCIA, non in italiano fisso.
//
// La card «Spanning-tree» (`letto il …`), la riga «ultimo poll» e il contapagine di una stampante usavano
// `toLocaleString('it-IT')`: in inglese la data usciva 17/11/2026 invece di 11/17/2026, e le migliaia
// 1.234.567 invece di 1,234,567. Le altre superfici (audit) leggono `getLang()`.
// Si prova sul pannello disegnato davvero, nello stub, nelle due lingue.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (stp-card-lingua)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

// Mezzogiorno UTC: il giorno non cambia in nessun fuso orario, quindi mese/giorno sono confrontabili.
const QUANDO = '2026-11-17T12:00:00.000Z';

function pannello(lang, esito = 'ok') {
  const out = run(APP.ctx, `(() => {
    try {
      setLang(${JSON.stringify(lang)});
      state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
      state.nodes.push({ id:'sw1', type:'switch', name:'SW1', rackId:state.currentRack, rackU:1, sizeU:1, ports:4, ip:'10.0.0.1',
        snmpStatus:${JSON.stringify(esito)}, snmpLastOk:${JSON.stringify(QUANDO)}, ${esito === 'err' ? "snmpError:'timeout'," : ''}
        integration:{ driver:'snmp-v2c', host:'10.0.0.1', lastPoll:${JSON.stringify(QUANDO)},
          stp:{ scope:'default', isRoot:true, rootMac:'02:00:00:00:00:01', rootPriority:32768, rootSysId:0, rootCost:0, blocked:[], at:${JSON.stringify(QUANDO)} },
          printer:{ pageCount:1234567, supplies:[] } } });
      if(typeof _invalidateIdx==='function') _invalidateIdx();
      _propsExplicit = true; selType='node'; selId='sw1'; renderProps();
      const html = document.getElementById('props-panel').innerHTML || '';
      setLang('it');
      return JSON.stringify({ ok:true, html });
    } catch(e){ try{ setLang('it'); }catch(_){} return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'il pannello lancia: ' + r.err);
  return r.html;
}

test('in ITALIANO: data giorno/mese/anno e migliaia col punto', () => {
  const html = pannello('it');
  assert.match(html, /17\/11\/2026/, 'la data nella lingua dell\'interfaccia (it)');
  assert.doesNotMatch(html, /11\/17\/2026/);
  assert.match(html, /1\.234\.567/, 'le migliaia in italiano');
});

test('in INGLESE: data mese/giorno/anno e migliaia con la virgola — in tutte e tre le righe', () => {
  const html = pannello('en');
  assert.match(html, /read 11\/17\/2026/, 'la card spanning-tree: «read <data>» nella lingua dell\'interfaccia (en)');
  assert.doesNotMatch(html, /17\/11\/2026/, 'nessuna data italiana in un\'interfaccia inglese (card STP e riga «ultimo poll»)');
  assert.match(html, /1,234,567/, 'le migliaia in inglese');
  assert.doesNotMatch(html, /1\.234\.567/);
});

test('apparato che NON risponde: l\'ora dell\'ultimo giro e quella dell\'ultimo riuscito seguono la lingua', () => {
  // E' la riga rossa («non risponde»): due date, `intg.lastPoll` e `snmpLastOk`. Un test sul solo caso «ok» non
  // la disegna, e una data italiana fissa sopravviveva in quel ramo.
  const en = pannello('en', 'err');
  assert.match(en, /11\/17\/2026/, 'almeno una data nella lingua inglese');
  assert.doesNotMatch(en, /17\/11\/2026/, 'nessuna data italiana nella riga «non risponde»');
  const it = pannello('it', 'err');
  assert.match(it, /17\/11\/2026/);
  assert.doesNotMatch(it, /11\/17\/2026/);
});
