'use strict';
// Un UPLINK DEDOTTO dalla sola FDB (protocol MAC-UPLINK) verso un apparato CIECO
// (switch senza SNMP, es. Zyxel GS1200) ha la porta remota messa a DEFAULT (`<node>-1`,
// cfr. lib/correlate.js buildFdbCandidates) e NESSUNA aggregazione osservata sul capo
// remoto. Anche quando la porta LOCALE e' un membro LAG (GS1900 LAG1 = porte 3+6), il
// cavo NON deve diventare un membro "LAG" CONFERMATO: deve restare UN solo cavo
// "Inferito · da verificare" (linkState 'ambiguous'), che l'utente conferma e completa
// indicando la porta reale sul GS1200 — che noi non conosciamo.
//
// Regressione reale GS1900<->GS1200 su LAG1. Usa la DOM-stub harness + fetch mockato
// che restituisce i suggestedLinks gia' correlati dal server (buildFdbCandidates).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');
const { linkState } = require('../lib/linkstate.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (uplink-lag-inferred)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

function mockSuggested(ctx, byNode) {
  ctx.fetch = (url, opts) => {
    let src = '';
    try { src = JSON.parse((opts && opts.body) || '{}').srcNodeId || ''; } catch (_) {}
    const d = byNode[src] || {};
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      ok: true, neighbors: d.neighbors || [], fdbTable: d.fdbTable || {}, arpTable: {},
      suggestedLinks: d.suggestedLinks || [],
    }) });
  };
}

test('uplink FDB inferito su porta LAG verso switch cieco → cavo "Inferito", non "LAG"', async () => {
  // Il server correla la FDB del GS1900 (il chassis-MAC del GS1200 appreso su LAG1) e
  // restituisce un candidato MAC-UPLINK con porta remota di default gs1200-1.
  mockSuggested(APP.ctx, { gs1900: {
    suggestedLinks: [{ src: 'gs1900-3', dst: 'gs1200-1', confidence: 0.82, protocol: 'MAC-UPLINK' }],
  }});
  run(APP.ctx, `
    state = _buildDefaultState();
    state.nodes.push(
      { id:'gs1900', type:'switch', name:'GS1900', ports:24, ip:'192.168.1.100', snmpStatus:'ok', integration:{ driver:'snmp-v2c', host:'192.168.1.100' } },
      { id:'gs1200', type:'switch', name:'GS1200', ports:8, ip:'192.168.1.50', mac:'aa:bb:cc:dd:ee:ff' }
    );
    // LAG1 sul GS1900 = porte 3+6 (membri di un aggregato SNMP)
    state.ports['gs1900-3'] = { status:'active', lagGroup:'snmp-lag-gs1900-1', ifName:'LAG1' };
    state.ports['gs1900-6'] = { status:'active', lagGroup:'snmp-lag-gs1900-1', ifName:'LAG1' };
    state.ports['gs1200-1'] = { status:'active' };
    if(typeof _invalidateIdx==='function') _invalidateIdx();
  `);
  await run(APP.ctx, `_autoDiscoverLinks(['gs1900'])`);
  const link = JSON.parse(run(APP.ctx, `JSON.stringify(
    state.links.find(l =>
      (l.src==='gs1900-3' && l.dst==='gs1200-1') || (l.src==='gs1200-1' && l.dst==='gs1900-3')
    ) || null
  )`));

  assert.ok(link, 'il cavo uplink GS1900<->GS1200 esiste (agganciato come inferito)');
  assert.equal(link.protocol, 'MAC-UPLINK', 'protocollo uplink FDB');
  assert.ok(!link.lagLogicalKey, 'NON deve avere lagLogicalKey: capo remoto cieco, porta remota dedotta');
  assert.ok(!link.lagMemberPair, 'NON deve avere lagMemberPair');
  assert.equal(linkState(link).key, 'ambiguous', 'linkState = "Inferito · da verificare", NON "lag"');
});
