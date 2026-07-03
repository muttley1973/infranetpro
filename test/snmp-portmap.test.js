'use strict';
// ============================================================
// MANUAL-FIRST della mappatura interfaccia SNMP -> porta (applyPollResult).
// Regressione dei 2 comportamenti scoperti dal vivo sul lab PnetLab:
//   1) la mappatura POSIZIONALE (idx -> `${nodeId}-${idx+1}`) clobberava una porta
//      documentata a mano: un cavo verso un endpoint (PC) finiva su una porta
//      trunk/LAG (era la 2a porta del bundle mappata sulla porta dell'endpoint);
//   2) sui ri-sync l'abbinamento deve avvenire per ifName, non per indice.
// Usa la DOM-stub harness (carica tutta l'app, come smoke-app.test.js).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

let APP;
test('load app (snmp-portmap)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

test('applyPollResult: porta cablata a mano (no ifName) NON diventa trunk/LAG posizionale', () => {
  const out = run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.ports = state.ports || {};
    state.nodes.push(
      { id:'sw1', type:'switch', name:'SW', ports:8, ip:'10.0.0.1' },
      { id:'pc1', type:'pc', name:'PC', ports:1, ip:'10.0.0.100' }
    );
    state.ports['sw1-3'] = { status:'active', vlan:10 };   // access VLAN10 (PC1), niente ifName
    state.ports['pc1-1'] = { status:'active', vlan:10 };
    state.links.push({ id:'l1', src:'pc1-1', dst:'sw1-3' }); // cavo MANUALE (no autoLinked)
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    // SNMP: l'interfaccia in 3a posizione (idx 2) e' un membro trunk del Port-channel.
    // Con la mappatura posizionale storica finirebbe su sw1-3 (la porta di PC1).
    const data = { ok:true, interfaces:[
      { name:'GigabitEthernet0/0', operStatus:1, vlan:1,  speed:1000 },
      { name:'GigabitEthernet0/1', operStatus:1, isTrunk:true, trunkVlans:[10,20,99], lagId:1, speed:1000 },
      { name:'GigabitEthernet0/2', operStatus:1, isTrunk:true, trunkVlans:[10,20,99], lagId:1, speed:1000 },
      { name:'GigabitEthernet0/3', operStatus:1, vlan:10, speed:1000 },
    ], lags:[{ index:1, lagId:1, name:'Port-channel1', isTrunk:true, trunkVlans:[10,20,99] }], vlans:[1,10,20,99] };
    applyPollResult('sw1', data, { noHistory:true });
    const p = state.ports['sw1-3'] || {};
    return JSON.stringify({ isTrunk: !!p.isTrunk, vlan: p.vlan, lag: p.lagGroup || null });
  })()`);
  const p = JSON.parse(out);
  assert.equal(p.isTrunk, false, 'sw1-3 (PC1) non deve diventare trunk');
  assert.equal(p.vlan, 10, 'sw1-3 deve restare access VLAN10');
  assert.equal(p.lag, null, 'sw1-3 non deve entrare in un LAG SNMP');
});

test('applyPollResult: ri-sync abbina per ifName, non per posizione', () => {
  const out = run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.ports = state.ports || {};
    state.nodes.push({ id:'sw1', type:'switch', name:'SW', ports:4, ip:'10.0.0.1' });
    state.ports['sw1-1'] = { status:'active', ifName:'GigabitEthernet0/1', vlan:1 };
    state.ports['sw1-2'] = { status:'active', ifName:'GigabitEthernet0/3', vlan:10 };
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    // SNMP ritorna le interfacce in ordine INVERTITO: Gi0/3 per prima (idx 0).
    // Per posizione andrebbe su sw1-1; per ifName deve andare su sw1-2.
    const data = { ok:true, interfaces:[
      { name:'GigabitEthernet0/3', operStatus:1, vlan:20, speed:1000 },
      { name:'GigabitEthernet0/1', operStatus:1, vlan:1,  speed:1000 },
    ], lags:[], vlans:[1,10,20] };
    applyPollResult('sw1', data, { noHistory:true });
    return JSON.stringify({ sw1_2_vlan: state.ports['sw1-2'].vlan, sw1_1_vlan: state.ports['sw1-1'].vlan });
  })()`);
  const r = JSON.parse(out);
  assert.equal(r.sw1_2_vlan, 20, 'Gi0/3 deve mappare su sw1-2 (per ifName), portando vlan 20');
  assert.equal(r.sw1_1_vlan, 1, 'Gi0/1 resta su sw1-1');
});

test('applyPollResult: segnala il conflitto sul nodo (porta manuale vs interfaccia trunk SNMP)', () => {
  const out = run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.ports = state.ports || {};
    state.nodes.push(
      { id:'sw1', type:'switch', name:'SW', ports:8, ip:'10.0.0.1' },
      { id:'pc1', type:'pc', name:'PC', ports:1, ip:'10.0.0.100' }
    );
    state.ports['sw1-3'] = { status:'active', vlan:10 }; // PC1, access, no ifName
    state.ports['pc1-1'] = { status:'active', vlan:10 };
    state.links.push({ id:'l1', src:'pc1-1', dst:'sw1-3' }); // cavo MANUALE
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    // idx 2 (posizionale = sw1-3) e' un membro trunk/LAG -> conflitto reale da segnalare
    const data = { ok:true, interfaces:[
      { name:'GigabitEthernet0/0', operStatus:1, vlan:1, speed:1000 },
      { name:'GigabitEthernet0/1', operStatus:1, isTrunk:true, trunkVlans:[10,20,99], lagId:1, speed:1000 },
      { name:'GigabitEthernet0/2', operStatus:1, isTrunk:true, trunkVlans:[10,20,99], lagId:1, speed:1000 },
    ], lags:[{ index:1, lagId:1, name:'Port-channel1', isTrunk:true, trunkVlans:[10,20,99] }], vlans:[1,10,20,99] };
    applyPollResult('sw1', data, { noHistory:true });
    const n = nodeById('sw1');
    const c = (n.portReconcileConflicts || []);
    return JSON.stringify({ count: c.length, pid: (c[0]||{}).pid, trunk: (c[0]||{}).trunk });
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.count >= 1, 'deve registrare almeno un conflitto porta');
  assert.equal(r.pid, 'sw1-3', 'il conflitto e sulla porta cablata a mano sw1-3');
  assert.equal(r.trunk, true, 'l interfaccia SNMP corrispondente e trunk');
});

test('applyPollResult: NON segnala conflitto su un membro LAG manuale (doc trunk = realta trunk)', () => {
  // Refinement: l'avviso deve scattare SOLO sul mismatch access-vs-trunk. Un membro LAG
  // documentato a mano (trunk) che collide posizionalmente con un'interfaccia trunk NON
  // e' un conflitto (documento e realta' concordano) -> niente falso allarme.
  const out = run(APP.ctx, `(() => {
    state = _buildDefaultState(); state.ports = state.ports || {};
    state.nodes.push(
      { id:'sw1', type:'switch', name:'CORE', ports:8, ip:'10.0.0.1' },
      { id:'sw2', type:'switch', name:'ACC',  ports:8, ip:'10.0.0.2' },
      { id:'pc1', type:'pc', name:'PC', ports:1, ip:'10.0.0.100' }
    );
    // sw1-1: membro LAG DOCUMENTATO A MANO (trunk), no ifName -> idx0 (trunk) = concorde
    state.ports['sw1-1'] = { status:'active', isTrunk:true, lagGroup:'lag-core-1' };
    state.ports['sw2-1'] = { status:'active', isTrunk:true, lagGroup:'lag-acc-1' };
    // sw1-2: endpoint ACCESS documentato a mano -> idx1 (trunk) = mismatch reale
    state.ports['sw1-2'] = { status:'active', vlan:10 };
    state.ports['pc1-1'] = { status:'active', vlan:10 };
    state.links.push(
      { id:'l1', src:'sw1-1', dst:'sw2-1' },   // cavo MANUALE (membro LAG)
      { id:'l2', src:'pc1-1', dst:'sw1-2' }    // cavo MANUALE (endpoint)
    );
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const data = { ok:true, interfaces:[
      { name:'GigabitEthernet0/0', operStatus:1, isTrunk:true, trunkVlans:[10,20], lagId:1, speed:1000 }, // idx0 -> sw1-1
      { name:'GigabitEthernet0/1', operStatus:1, isTrunk:true, trunkVlans:[10,20], lagId:1, speed:1000 }, // idx1 -> sw1-2
    ], lags:[{ index:1, lagId:1, name:'Port-channel1', isTrunk:true, trunkVlans:[10,20] }], vlans:[1,10,20] };
    applyPollResult('sw1', data, { noHistory:true });
    const n = nodeById('sw1');
    const c = (n.portReconcileConflicts || []);
    const m = state.ports['sw1-1'] || {};
    const e = state.ports['sw1-2'] || {};
    return JSON.stringify({
      count: c.length,
      pids: c.map(x=>x.pid),
      memberPreserved: (!!m.isTrunk && m.lagGroup==='lag-core-1'),
      endpointStillAccess: (e.vlan===10 && !e.isTrunk && !e.lagGroup)
    });
  })()`);
  const r = JSON.parse(out);
  assert.equal(r.count, 1, 'un solo conflitto: solo l endpoint, non il membro LAG');
  assert.deepEqual(r.pids, ['sw1-2'], 'conflitto SOLO su sw1-2 (endpoint access), non sw1-1 (membro LAG)');
  assert.ok(r.memberPreserved, 'il membro LAG manuale resta preservato (trunk + lagGroup)');
  assert.ok(r.endpointStillAccess, 'l endpoint resta access VLAN10, non trunk/LAG');
});
