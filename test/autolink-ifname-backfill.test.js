'use strict';
// Backfill ifName VENDOR-NEUTRAL, manual-first: quando un vicino LLDP/CDP identifica un
// nodo gia' collegato da un UNICO cavo MANUALE su una porta senza ifName, quella porta
// riceve l'ifName reale (in forma SNMP) e la porta che l'aveva preso per posizione lo
// perde. Ambiguo (LAG/multi-cavo) o gia' con ifName -> non tocca.
// Usa la DOM-stub harness + fetch mockato per /api/topology.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (autolink-backfill)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

function mockTopology(ctx, byNode) {
  ctx.fetch = (url, opts) => {
    let src = '';
    try { src = JSON.parse((opts && opts.body) || '{}').srcNodeId || ''; } catch (_) {}
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      ok: true, neighbors: byNode[src] || [], fdbTable: {}, arpTable: {},
    }) });
  };
}

test('backfill: porta manuale (no ifName) prende l ifName reale via vicino LLDP', async () => {
  mockTopology(APP.ctx, { sw1: [
    { localPort: 'Gi1/1', remoteDevice: 'RTR', remoteIP: '10.0.0.2', protocol: 'LLDP' },
  ]});
  run(APP.ctx, `
    state = _buildDefaultState();
    state.nodes.push(
      { id:'sw1', type:'switch', name:'SW1', ports:8, ip:'10.0.0.1', snmpStatus:'ok', integration:{ driver:'snmp-v2c', host:'10.0.0.1' } },
      { id:'rt1', type:'router', name:'RTR', ports:2, ip:'10.0.0.2' }
    );
    state.ports['sw1-5'] = { status:'active', vlan:99 };                     // porta VyOS manuale, NO ifName
    state.ports['sw1-6'] = { status:'active', ifName:'GigabitEthernet1/1', vlan:1 }; // posizionale con l ifName reale
    state.ports['rt1-1'] = { status:'active' };
    state.links.push({ id:'l1', src:'sw1-5', dst:'rt1-1' });                 // UNICO cavo manuale sw1<->rt1
    if(typeof _invalidateIdx==='function') _invalidateIdx();
  `);
  await run(APP.ctx, `_autoDiscoverLinks(['sw1'])`);
  const r = JSON.parse(run(APP.ctx, `JSON.stringify({
    manual: state.ports['sw1-5'].ifName || null,
    manualVlan: state.ports['sw1-5'].vlan,
    positional: state.ports['sw1-6'].ifName || null,
  })`));
  assert.equal(r.manual, 'GigabitEthernet1/1', 'la porta manuale prende l ifName reale in forma SNMP');
  assert.equal(r.positional, null, 'la porta posizionale perde l ifName (niente ambiguita)');
  assert.equal(r.manualVlan, 99, 'la VLAN documentata sulla porta manuale NON viene toccata (manual-first)');
});

test('backfill: NON tocca se il cavo manuale e ambiguo (LAG / 2 cavi verso lo stesso nodo)', async () => {
  mockTopology(APP.ctx, { sw1: [
    { localPort: 'Gi1/1', remoteDevice: 'PEER', remoteIP: '10.0.0.3', protocol: 'LLDP' },
  ]});
  run(APP.ctx, `
    state = _buildDefaultState();
    state.nodes.push(
      { id:'sw1', type:'switch', name:'SW1', ports:8, ip:'10.0.0.1', snmpStatus:'ok', integration:{ driver:'snmp-v2c', host:'10.0.0.1' } },
      { id:'sw9', type:'switch', name:'PEER', ports:8, ip:'10.0.0.3' }
    );
    state.ports['sw1-2'] = { status:'active' };  // due porte manuali (LAG) senza ifName verso sw9
    state.ports['sw1-3'] = { status:'active' };
    state.ports['sw9-1'] = { status:'active' };
    state.ports['sw9-2'] = { status:'active' };
    state.links.push(
      { id:'l1', src:'sw1-2', dst:'sw9-1' },
      { id:'l2', src:'sw1-3', dst:'sw9-2' }
    );
    if(typeof _invalidateIdx==='function') _invalidateIdx();
  `);
  await run(APP.ctx, `_autoDiscoverLinks(['sw1'])`);
  const r = JSON.parse(run(APP.ctx, `JSON.stringify({
    p2: state.ports['sw1-2'].ifName || null, p3: state.ports['sw1-3'].ifName || null,
  })`));
  assert.equal(r.p2, null, 'cavo ambiguo (2 verso lo stesso nodo) -> nessun backfill su sw1-2');
  assert.equal(r.p3, null, 'cavo ambiguo -> nessun backfill su sw1-3');
});
