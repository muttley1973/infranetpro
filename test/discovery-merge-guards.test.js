'use strict';
// ============================================================
// GUARDIE DI MERGE nella discovery (audit F4 + F5).
// Un MAC "next-hop" (gateway L3-lite documentato, o stesso MAC su piu' IP nel
// batch = cross-subnet) NON e' una chiave di identita' affidabile.
//   F4: _discFindExistingDevice deve trattare quel MAC come ASSENTE in TUTTA la
//       funzione — non solo nel lookup byMac — cosi' non genera falsi conflitti
//       ip-mac ne' rifiuta match per hostname legittimi.
//   F5: le stesse guardie (_discAttachMergeGuards) vanno anche sull'indice
//       memoizzato di preview/render, non solo su quello dell'import → un host
//       remoto non eredita piu' il tipo/nodo del gateway.
// Testato via la DOM-stub harness (bare global esposti da expose()).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (merge-guards)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

// ── F4 — il MAC bloccato e' trattato come assente in TUTTI i rami ─────────────

test('F4: MAC-gateway sullo stesso IP di un nodo noto NON crea un falso conflitto (match per IP)', () => {
  run(APP.ctx, `window.state = { nodes:[], ports:{} };`);
  const m = JSON.parse(run(APP.ctx, `(() => {
    // Chiavi indice nel formato di normalizeMacAddress: MAIUSCOLO con ':'.
    const host1 = { id:'host1', type:'pc', mac:'de:ad:be:ef:00:05', ip:'10.2.0.5' };
    const idx = {
      byMac: new Map([['DE:AD:BE:EF:00:05', host1]]),
      byIp:  new Map([['10.2.0.5', host1]]),
      byHost: new Map(),
      gatewayMacs: new Set(['AA:BB:CC:00:00:99']),   // MAC del gateway = bloccato
      sharedMacs: null,
    };
    // Ri-scoperta di host1: l'ARP ha risposto col MAC del next-hop (gateway).
    const r = _discFindExistingDevice({ ip:'10.2.0.5', mac:'aa:bb:cc:00:00:99' }, idx);
    return JSON.stringify({ matchedBy: r.matchedBy, nodeId: r.node && r.node.id });
  })()`));
  assert.equal(m.matchedBy, 'ip', 'niente conflitto ip-mac: fonde per IP');
  assert.equal(m.nodeId, 'host1');
});

test('F4: MAC-gateway non fa RIFIUTARE un match per hostname legittimo', () => {
  const m = JSON.parse(run(APP.ctx, `(() => {
    const host2 = { id:'host2', type:'pc', mac:'de:ad:be:ef:00:06', hostname:'myhost' };
    const idx = {
      byMac: new Map([['DE:AD:BE:EF:00:06', host2]]),
      byIp:  new Map(),
      byHost: new Map([['myhost', host2]]),
      gatewayMacs: new Set(['AA:BB:CC:00:00:99']),
      sharedMacs: null,
    };
    const r = _discFindExistingDevice({ hostname:'myhost', mac:'aa:bb:cc:00:00:99' }, idx);
    return JSON.stringify({ matchedBy: r.matchedBy, nodeId: r.node && r.node.id });
  })()`));
  assert.equal(m.matchedBy, 'hostname', 'il MAC-gateway bloccato non contraddice l\'hostname');
  assert.equal(m.nodeId, 'host2');
});

test('F4 (regressione): un MAC NON bloccato continua a matchare per MAC', () => {
  const m = JSON.parse(run(APP.ctx, `(() => {
    const host1 = { id:'host1', type:'pc', mac:'de:ad:be:ef:00:05', ip:'10.2.0.5' };
    const idx = { byMac:new Map([['DE:AD:BE:EF:00:05', host1]]), byIp:new Map(), byHost:new Map() };
    const r = _discFindExistingDevice({ mac:'de:ad:be:ef:00:05' }, idx);
    return JSON.stringify({ matchedBy: r.matchedBy, nodeId: r.node && r.node.id });
  })()`));
  assert.equal(m.matchedBy, 'mac');
  assert.equal(m.nodeId, 'host1');
});

test('F4 (regressione): un conflitto ip-mac GENUINO (device sostituito) resta rilevato', () => {
  run(APP.ctx, `window.state = { nodes:[], ports:{} };`);
  const m = JSON.parse(run(APP.ctx, `(() => {
    const host1 = { id:'host1', type:'pc', mac:'de:ad:be:ef:00:05', ip:'10.2.0.5' };
    const idx = { byMac:new Map([['deadbeef0005', host1]]), byIp:new Map([['10.2.0.5', host1]]), byHost:new Map() };
    // MAC reale DIVERSO (non bloccato) sullo stesso IP = device sostituito.
    const r = _discFindExistingDevice({ ip:'10.2.0.5', mac:'11:22:33:44:55:66' }, idx);
    return JSON.stringify({ matchedBy: r.matchedBy, hasConflict: !!r.conflict });
  })()`));
  assert.equal(m.matchedBy, 'conflict', 'device sostituito → conflitto reale preservato');
  assert.equal(m.hasConflict, true);
});

// ── F5 — le guardie sono anche sull'indice di preview/render ──────────────────

test('F5: _discAttachMergeGuards calcola sharedMacs sull\'INTERO batch (store._discResults)', () => {
  run(APP.ctx, `
    window.state = { nodes:[], ports:{} };
    window._discResults = [
      { ip:'10.2.0.5', mac:'aa:bb:cc:00:00:01' },   // gateway MAC su 3 IP → condiviso
      { ip:'10.2.0.6', mac:'aa:bb:cc:00:00:01' },
      { ip:'10.2.0.7', mac:'aa:bb:cc:00:00:01' },
      { ip:'10.0.0.9', mac:'de:ad:be:ef:00:09' }    // endpoint reale: MAC unico
    ];
  `);
  const r = JSON.parse(run(APP.ctx, `(() => {
    const idx = { byMac:new Map(), byIp:new Map(), byHost:new Map() };
    _discAttachMergeGuards(idx);
    return JSON.stringify({
      sharedIsSet: idx.sharedMacs instanceof Set,
      sharedSize:  idx.sharedMacs ? idx.sharedMacs.size : -1,
      gwIsSet:     idx.gatewayMacs instanceof Set,
    });
  })()`));
  assert.equal(r.sharedIsSet, true);
  assert.equal(r.sharedSize, 1, 'solo il MAC su piu\' IP e\' condiviso (l\'unico no)');
  assert.equal(r.gwIsSet, true, 'gatewayMacs sempre un Set (vuoto se nessun gateway L3)');
});

test('F5: sul percorso di preview/render un host remoto col MAC-gateway NON si fonde sul gateway', () => {
  run(APP.ctx, `
    window.state = { nodes:[{ id:'gw', type:'router', name:'GW', mac:'aa:bb:cc:00:00:01', ip:'10.2.0.1' }], ports:{} };
    window._discResults = [
      { ip:'10.2.0.5', mac:'aa:bb:cc:00:00:01' },
      { ip:'10.2.0.6', mac:'aa:bb:cc:00:00:01' },
      { ip:'10.2.0.7', mac:'aa:bb:cc:00:00:01' }
    ];
    if(typeof _discInvalidateExistingIndexes==='function') _discInvalidateExistingIndexes();
  `);
  // Default idx = _discExistingIndexes() → ora porta le guardie (F5). Il gateway
  // e' indicizzato byMac; senza guardia l'host remoto (stesso MAC) collasserebbe su
  // di lui. Con la guardia il MAC e' bloccato → nessun match → "Nuovo".
  const nodeId = run(APP.ctx, `(() => {
    const m = _discFindExistingDevice({ ip:'10.2.0.5', mac:'aa:bb:cc:00:00:01', hostname:'remoteX' });
    return m.node ? m.node.id : 'NULL';
  })()`);
  assert.equal(nodeId, 'NULL', 'host remoto col MAC-gateway = Nuovo, non fuso sul gateway');
});

test('F5: il gateway stesso continua a matchare per il suo IP (non lo perdiamo)', () => {
  const nodeId = run(APP.ctx, `(() => {
    const m = _discFindExistingDevice({ ip:'10.2.0.1', mac:'aa:bb:cc:00:00:01', hostname:'GW' });
    return m.node ? m.node.id : 'NULL';
  })()`);
  assert.equal(nodeId, 'gw', 'il gateway matcha per il proprio IP (il suo MAC bloccato non lo esclude)');
});
