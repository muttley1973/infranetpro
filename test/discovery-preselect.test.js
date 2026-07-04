'use strict';
// ============================================================
// PRE-SELEZIONE Scopri per confidenza (soglia DISC_PRESELECT_MIN_CONF=15).
// I "fantasmi" solo-ping (~10%, artefatto ping-sweep gateway-unreachable) NON
// devono essere pre-spuntati: restano visibili (riga .disc-lowconf, in grigio) e
// selezionabili a mano. I device reali (>=20%: endpoint on-seg ~40%, SNMP >=57%)
// restano pre-selezionati. Le righe ARP-SNMP off-segment (alive:false) non sono
// pre-selezionate di loro (osservate) ma NON sono "fantasmi" → niente grigio.
// Reso testato via la DOM-stub harness leggendo l'innerHTML di #disc-tbody.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (disc-preselect)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

function renderRows() {
  const out = run(APP.ctx, `(() => {
    state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
    window._discTypeMap = {}; window._discSelMap = {};
    window._discResults = [
      { ip:'192.168.1.85', alive:true, confidence:{score:10,level:'low'} },                                                       // fantasma ping-only
      { ip:'192.168.1.86', alive:true, confidence:{score:14,level:'low'} },                                                       // appena sotto soglia
      { ip:'192.168.1.90', alive:true, mac:'00:50:79:66:68:23', vendor:'Famatech', confidence:{score:40,level:'mid'} },          // endpoint reale
      { ip:'192.168.1.1',  alive:true, mac:'D4:1A:D1:82:11:20', vendor:'Zyxel', snmpReachable:true, confidence:{score:100,level:'high'} }, // SNMP
      { ip:'10.10.10.100', alive:false, mac:'00:50:79:00:00:01', _via:'arp', confidence:{score:20,level:'low'} },                // ARP-SNMP off-seg
    ];
    _discRenderTable();
    const html = document.getElementById('disc-tbody').innerHTML || '';
    const rows = html.split(/<tr /).slice(1);
    return JSON.stringify(rows.map(r => ({
      ip: (r.match(/class="disc-ip">([^<]*)</)||[])[1] || '?',
      checked: /class="disc-chk"[^>]*\\schecked/.test(r),
      lowconf: /^[^>]*disc-lowconf/.test(r),
    })));
  })()`);
  return JSON.parse(out);
}

test('fantasma ping-only (10%) NON pre-selezionato, riga in grigio', () => {
  const rows = renderRows();
  const ghost = rows.find(r => r.ip === '192.168.1.85');
  assert.ok(ghost, 'riga presente (visibile, non nascosta)');
  assert.equal(ghost.checked, false, 'non pre-spuntato');
  assert.equal(ghost.lowconf, true, 'riga marcata disc-lowconf (grigio)');
});

test('riga a 14% (appena sotto 15) deselezionata; 40% e 100% pre-selezionate', () => {
  const rows = renderRows();
  const at14 = rows.find(r => r.ip === '192.168.1.86');
  const at40 = rows.find(r => r.ip === '192.168.1.90');
  const at100 = rows.find(r => r.ip === '192.168.1.1');
  assert.equal(at14.checked, false, '14% < soglia → non spuntato');
  assert.equal(at14.lowconf, true);
  assert.equal(at40.checked, true, 'endpoint reale 40% pre-selezionato');
  assert.equal(at40.lowconf, false);
  assert.equal(at100.checked, true, 'SNMP 100% pre-selezionato');
});

test('ARP-SNMP off-segment (alive:false, 20%): non spuntato ma NON grigio (osservato, non fantasma)', () => {
  const rows = renderRows();
  const arp = rows.find(r => r.ip === '10.10.10.100');
  assert.equal(arp.checked, false, 'osservato → non pre-selezionato');
  assert.equal(arp.lowconf, false, 'non e un fantasma ping-only -> niente grigio da bassa-conf');
});
