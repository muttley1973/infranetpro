'use strict';
// ============================================================
// Formato 1 → 2 nell'app viva: la subnet esce dalla VLAN, ma a schermo non
// cambia niente.
// ============================================================
// Il modello puro ha i suoi test (test/ipam-model.test.js). Qui si verifica il
// GIUNTO: _migrateState al caricamento, e la scrittura dal pannello VLAN. È il
// punto dove un refactor del genere fa il danno vero — i dati si spostano e i
// lettori guardano ancora la casa vecchia, così la subnet sparisce dal pannello
// senza che nessun test puro se ne accorga.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (ipam-prefix)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

// Progetto in formato 2.8.x: la subnet è un campo della VLAN.
const LEGACY = `{
  schemaVersion: 1,
  nodes: [{ id:'sw1', type:'switch', name:'SW1', ip:'192.168.20.10' }],
  racks: [], links: [], ports: {},
  vlanColors: { 20:'#00d4ff' }, vlanNames: { 20:'Uffici' },
  ipam: { vlans: { 20: { subnet:'192.168.20.0/24', gateway:'192.168.20.1', dns:'1.1.1.1', gatewayNodeId:'sw1' } } }
}`;

test('_migrateState: la subnet diventa un prefisso e il riepilogo non cambia', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState(${LEGACY});
    return JSON.stringify({
      version: state.schemaVersion,
      prefixes: state.ipam.prefixes,
      leftOnVlan: state.ipam.vlans['20'],
      summary: _vlanIpamSummary(20),
      view: _vlanIpam(20),
      usageCidr: !!_ipamUsageForVlan(20).cidr,
    });
  })()`);
  const r = JSON.parse(out);

  assert.strictEqual(r.version, 2, 'lo schema sale a 2');
  assert.deepStrictEqual(r.prefixes, [
    { cidr: '192.168.20.0/24', vlan: 20, gateway: '192.168.20.1', dns: '1.1.1.1' },
  ]);
  // il binding SVI è per-VLAN: resta dov'era, non è un attributo del prefisso
  assert.deepStrictEqual(r.leftOnVlan, { gatewayNodeId: 'sw1' });
  // la VISTA ricompone quello che il pannello si aspetta di leggere
  assert.strictEqual(r.view.subnet, '192.168.20.0/24');
  assert.strictEqual(r.view.gateway, '192.168.20.1');
  assert.strictEqual(r.view.gatewayNodeId, 'sw1');
  // e a schermo la riga di riepilogo è quella di sempre
  assert.match(r.summary, /192\.168\.20\.0\/24/);
  assert.match(r.summary, /GW 192\.168\.20\.1/);
  assert.match(r.summary, /DNS 1\.1\.1\.1/);
  assert.strictEqual(r.usageCidr, true, 'l\'occupazione trova ancora il CIDR');
});

test('_migrateState: rieseguirlo su uno stato già migrato non duplica nulla', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState(${LEGACY});
    const first = JSON.stringify(state.ipam);
    state = _migrateState(state);
    return JSON.stringify({ same: JSON.stringify(state.ipam) === first, n: state.ipam.prefixes.length });
  })()`);
  const r = JSON.parse(out);
  assert.strictEqual(r.n, 1);
  assert.strictEqual(r.same, true);
});

test('updateVlanIpam: scrive nel prefisso, non nella VLAN', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[], racks:[], links:[], ports:{},
                            vlanColors:{ 30:'#39d353' }, vlanNames:{}, ipam:{ vlans:{}, prefixes:[] } });
    updateVlanIpam(30, 'gateway', '10.0.30.1');      // gateway PRIMA della subnet
    const orphan = JSON.stringify(state.ipam);
    updateVlanIpam(30, 'subnet', '10.0.30.0/24');    // arriva la subnet
    const afterSubnet = JSON.parse(JSON.stringify(state.ipam));
    updateVlanIpam(30, 'subnet', '10.0.31.0/24');    // rinomina il CIDR
    const renamed = JSON.parse(JSON.stringify(state.ipam));
    updateVlanIpam(30, 'subnet', '');                // svuota
    return JSON.stringify({ orphan, afterSubnet, renamed, cleared: state.ipam.prefixes });
  })()`);
  const r = JSON.parse(out);

  // senza subnet non c'è un prefisso a cui appartenere: il gateway resta sulla VLAN
  assert.deepStrictEqual(JSON.parse(r.orphan), { vlans: { 30: { gateway: '10.0.30.1' } }, prefixes: [] });
  // appena la subnet arriva, il gateway orfano ci entra dentro e la VLAN si svuota
  assert.deepStrictEqual(r.afterSubnet.prefixes,
    [{ cidr: '10.0.30.0/24', vlan: 30, source: 'manual', gateway: '10.0.30.1' }]);
  assert.strictEqual(r.afterSubnet.vlans['30'], undefined);
  // rinominare il CIDR non butta via il gateway
  assert.strictEqual(r.renamed.prefixes.length, 1);
  assert.strictEqual(r.renamed.prefixes[0].cidr, '10.0.31.0/24');
  assert.strictEqual(r.renamed.prefixes[0].gateway, '10.0.30.1');
  // svuotare la subnet toglie il prefisso
  assert.deepStrictEqual(r.cleared, []);
});

test('cancellare una VLAN porta via la sua subnet, ma non le reti senza VLAN', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[], racks:[], links:[], ports:{},
      vlanColors:{ 20:'#00d4ff' }, vlanNames:{},
      ipam:{ vlans:{}, prefixes:[
        { cidr:'192.168.20.0/24', vlan:20 },
        { cidr:'10.0.0.0/30', vlan:null, name:'punto-punto R1-R2' },
      ] } });
    deleteVlanColor(20);
    return JSON.stringify(state.ipam.prefixes);
  })()`);
  assert.deepStrictEqual(JSON.parse(out), [{ cidr: '10.0.0.0/30', vlan: null, name: 'punto-punto R1-R2' }]);
});
