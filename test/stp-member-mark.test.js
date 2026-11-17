'use strict';
// ============================================================
// STP sul RACK — dal POLL al LED (percorso VERO, non uno stato seminato).
//
// Un Port-channel e' UNA porta per lo spanning-tree: la lettura arriva sull'aggregatore, e sul rack il Po
// logico non ha un LED, i membri si'. Il driver porta lo stato dell'aggregato sui membri (appartenenza
// MISURATA, `lagIfIndex`); `_applySnmpBasePortFields` lo scrive su ogni porta come `stpBlocked`; il frontale
// legge quel campo e nient'altro.
//
// ⚠️ Questo file prima SEMINAVA un record `swx-po` con `stpBlocked` e faceva ereditare ai membri per NOME del
// gruppo. Era verde su uno stato che nessun poll produce (l'aggregatore sta in `lags`, non in `interfaces`):
// provava il disegno, non la funzione — e dal vivo i LED restavano spenti mentre la card diceva «bloccato».
// Un test con lo stato seminato non chiude una funzione: serve quello che parte da `extractData`.
//
// Fixture SINTETICA (v. test/fixtures/stp-poll.js): nessuna cattura reale ha un Port-channel bloccato.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');
const { extractData } = require('../drivers/snmp.js')._internals;
const { ciscoPoll, sc } = require('./fixtures/stp-poll.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (stp-member-mark)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

// Il poll come arriva al client: un JSON (i Buffer non passano il server).
const poll = (nodeId, opts, muta) => {
  const v = ciscoPoll(opts);
  if (muta) muta(v);
  return { nodeId, data: JSON.parse(JSON.stringify(extractData(v))) };
};

/** Due switch nello stesso rack (SWX, SWY, 5 porte l'una), una sequenza di poll, poi il disegno. */
function sulRack(sequenza, prima = '') {
  const out = run(APP.ctx, `(() => {
    try {
      state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
      for (const [id, u] of [['swx', 1], ['swy', 3]])
        state.nodes.push({ id, type:'switch', name:id.toUpperCase(), rackId:state.currentRack, rackU:u, sizeU:1, ports:5, ip:'10.0.0.'+u });
      if(typeof _invalidateIdx==='function') _invalidateIdx();
      ${prima}
      for (const s of ${JSON.stringify(sequenza)}) applyPollResult(s.nodeId, s.data, { noHistory:true });
      renderAll();
      const ch = document.getElementById('rack-chassis');
      const html = {};
      for (const id of ['swx', 'swy']) {
        const dev = (ch && ch.children ? Array.prototype.slice.call(ch.children) : []).find(e => e.dataset && e.dataset.id===id);
        html[id] = dev ? (dev.innerHTML||'') : null;
      }
      const marcata = (id, n) => { const m = new RegExp('class="([^"]*)"\\\\s+data-pid="'+id+'-'+n+'"').exec(html[id]||''); return m ? /\\bstp-blocked\\b/.test(m[1]) : null; };
      const led = {}, campo = {};
      for (const id of ['swx', 'swy']) for (let n = 1; n <= 5; n++) {
        led[id+'-'+n] = marcata(id, n);
        const p = state.ports[id+'-'+n]; campo[id+'-'+n] = p ? (p.stpBlocked || null) : null;
      }
      return JSON.stringify({ ok:true, found: !!(html.swx && html.swy), led, campo });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); }
  })()`);
  const r = JSON.parse(out);
  assert.ok(r.ok, 'il render lancia: ' + r.err);
  assert.ok(r.found, 'i due device devono comparire nel rack');
  return r;
}

test('dal poll: i MEMBRI del Port-channel bloccato si accendono, le altre porte no', () => {
  const r = sulRack([poll('swx', { po1State: 2 })]);
  assert.equal(r.led['swx-1'], true, 'Gi0/1 e\' membro del Po1 bloccato');
  assert.equal(r.led['swx-2'], true, 'Gi0/2 pure');
  assert.equal(r.led['swx-3'], false, 'la porta radice non e\' in nessun LAG');
  assert.equal(r.led['swx-4'], false, 'membro del Po2, che inoltra');
  assert.equal(r.led['swx-5'], false);
});

test('due switch con un "Port-channel1" ciascuno: il blocco dell\'uno NON passa all\'altro', () => {
  // Tutti i primi aggregati si chiamano uguale (Port-channel1, Po1, ae0…): confrontare per NOME fra porte
  // di apparati diversi fa contagiare. Lo stato viaggia con la misura della porta, quindi resta al suo nodo.
  const r = sulRack([poll('swx', { po1State: 2 }), poll('swy', { po1State: 5 })]);
  assert.equal(r.led['swx-1'], true);
  for (let n = 1; n <= 5; n++) assert.equal(r.led['swy-' + n], false, `swy-${n} e' di un altro apparato, dove il Po1 inoltra`);
});

test('il blocco scade: un poll in cui il Port-channel inoltra toglie il segno dai membri', () => {
  const r = sulRack([poll('swx', { po1State: 2 }), poll('swx', { po1State: 5 })]);
  assert.equal(r.led['swx-1'], false);
  assert.equal(r.led['swx-2'], false);
  assert.equal(r.campo['swx-1'], null, 'anche il campo misurato se ne va');
});

test('una lettura STP non valida (non letto) non lascia il segno di un poll precedente', () => {
  const r = sulRack([poll('swx', { po1State: 2 }), poll('swx', { po1State: 2 }, (v) => { delete v[sc(5)]; })]);
  assert.equal(r.led['swx-1'], false, 'la radice non si legge piu\': «bloccato» non si sa piu\'');
  assert.equal(r.campo['swx-1'], null);
});

test('il frontale legge il campo della PORTA e nient\'altro: ne\' un record-aggregato ne\' il nome del gruppo fanno ereditare', () => {
  // La regola «per nome» e' tolta apposta: due nodi con lo stesso nome di gruppo si sarebbero contagiati, e un
  // gruppo rinominato a mano («Uplink Core») avrebbe perso il segno. Se un domani una fonte vuole marcare i
  // membri, lo fa scrivendo il campo sui membri (e ci si porta dietro la scadenza), non con una ricerca.
  const r = sulRack([], `
    state.ports['swx-po'] = { ifName:'Port-channel1', stpBlocked:'blocking' };
    state.ports['swx-1'] = { ifName:'Gi0/1', lagGroup:'g1' };
    state.ports['swx-2'] = { ifName:'Gi0/2', stpBlocked:'blocking' };
    state.lagGroups = { g1:'Port-channel1' };`);
  assert.equal(r.led['swx-1'], false, 'un membro senza il PROPRIO campo non si accende per il nome del gruppo');
  assert.equal(r.led['swx-2'], true, 'una porta con il campo si accende (regressione: la bloccata di suo)');
});
