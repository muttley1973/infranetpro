'use strict';
// «Sincronizza ora» durante lo SWEEP della Verifica non parte in parallelo.
//
// La Verifica (runDriftCheck) ha due fasi: la lettura SNMP (pollAllSNMP, con `_snmpSyncing` acceso) e, dopo, lo sweep di
// raggiungibilita' (10-45 s a fine giro) — durante il quale `_snmpSyncing` e' SPENTO e `_driftRunning` acceso. Il tasto
// «Sincronizza ora» e il tasto destro su Topologia guardavano solo `_snmpSyncing`: un clic nello sweep partiva in
// PARALLELO, senza avviso, e leggeva gli stessi apparati una seconda volta (contro la regola «mai due sweep SNMP insieme»
// che lo scheduler rispetta con `isBlocked`).
//
// La prova riproduce la corsa nel browser finto: `/api/poll` risponde subito, `/api/reachability` resta APPESA (siamo
// nello sweep) e, finche' lo e', si prova a far partire una lettura. La Verifica stessa deve invece poter leggere: e'
// lei a tenere `_driftRunning`, e un controllo ingenuo la bloccherebbe con se' stessa (opts.byVerify).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const prossimoGiro = () => new Promise((r) => setImmediate(r));
async function finche(cond, msg) {
  for (let i = 0; i < 400; i++) { if (cond()) return; await prossimoGiro(); }
  assert.fail(msg);
}

test('durante lo sweep della Verifica, «Sincronizza ora» e il refresh di Topologia non leggono la rete una seconda volta', async () => {
  const { ctx } = loadApp(ROOT);
  const chiamate = { poll: 0, reach: 0 };
  let sbloccaSweep;
  const sweepAppeso = new Promise((r) => { sbloccaSweep = r; });
  ctx.fetch = (url) => {
    const risposta = (corpo) => Promise.resolve({ ok: true, json: () => Promise.resolve(corpo), text: () => Promise.resolve('') });
    if (/\/api\/poll(\?|$)/.test(url)) { chiamate.poll++; return risposta({ ok: false, error: 'nessuna risposta' }); }
    if (/\/api\/reachability/.test(url)) { chiamate.reach++; return sweepAppeso.then(() => ({ ok: true, json: () => Promise.resolve({ ok: true, results: {}, arpTable: {} }), text: () => Promise.resolve('') })); }
    return risposta({ ok: true });
  };
  run(ctx, `state.nodes.length = 0; state.links.length = 0;
    state.nodes.push({ id: 'sw1', type: 'switch', name: 'SW1', x: 10, y: 10, ports: 4, ip: '10.0.0.1',
      integration: { driver: 'snmp-v2c', host: '10.0.0.1', community: 'public' } });
    _history = []; _histIdx = -1;`);

  // Parte la Verifica (programmata, come dal monitoraggio): legge, poi entra nello sweep e ci resta.
  const verifica = run(ctx, 'runDriftCheck({ silent: true })');
  await finche(() => chiamate.reach === 1, 'la Verifica non e\' arrivata allo sweep di raggiungibilita\'');
  assert.ok(chiamate.poll >= 1, 'la Verifica ha letto l\'apparato PRIMA dello sweep: byVerify le lascia passare');
  assert.equal(run(ctx, '_snmpSyncing'), false, 'nello sweep la lettura è finita: _snmpSyncing è spento (ed è proprio il buco)');

  // Nello sweep: nessun'altra lettura.
  const lettureFinoAdesso = chiamate.poll;
  await run(ctx, 'pollAllSNMP()');                       // «Sincronizza ora»
  assert.equal(chiamate.poll, lettureFinoAdesso, '«Sincronizza ora» durante lo sweep NON legge la rete');
  assert.equal(run(ctx, '_snmpSyncing'), false, 'e non lascia il lucchetto della lettura acceso');
  await run(ctx, 'discoverTopology(true)');              // tasto destro su Topologia
  assert.equal(chiamate.poll, lettureFinoAdesso, 'il refresh di Topologia durante lo sweep NON legge la rete');

  // Finito lo sweep la Verifica chiude, e da li' in poi la lettura a richiesta torna a funzionare.
  sbloccaSweep();
  await verifica;
  const dopoLaVerifica = chiamate.poll;
  await run(ctx, 'pollAllSNMP()');
  assert.ok(chiamate.poll > dopoLaVerifica, 'a Verifica finita «Sincronizza ora» legge di nuovo');
});

test('una Verifica che ne trova un\'altra in corso non parte, come prima', async () => {
  const { ctx } = loadApp(ROOT);
  let sbloccaSweep;
  const sweepAppeso = new Promise((r) => { sbloccaSweep = r; });
  let reach = 0;
  ctx.fetch = (url) => {
    if (/\/api\/reachability/.test(url)) { reach++; return sweepAppeso.then(() => ({ ok: true, json: () => Promise.resolve({ ok: true, results: {}, arpTable: {} }), text: () => Promise.resolve('') })); }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: 'x' }), text: () => Promise.resolve('') });
  };
  run(ctx, `state.nodes.length = 0; state.nodes.push({ id: 'sw1', type: 'switch', name: 'SW1', x: 1, y: 1, ports: 4, ip: '10.0.0.1',
    integration: { driver: 'snmp-v2c', host: '10.0.0.1', community: 'public' } });`);
  const prima = run(ctx, 'runDriftCheck({ silent: true })');
  await finche(() => reach === 1, 'la prima Verifica non e\' arrivata allo sweep');
  await run(ctx, 'runDriftCheck({ silent: true })');      // la seconda esce subito
  assert.equal(reach, 1, 'la seconda Verifica non ha avviato un secondo sweep');
  sbloccaSweep();
  await prima;
});
