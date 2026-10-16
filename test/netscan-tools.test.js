'use strict';
// ============================================================
// Gli strumenti di sistema che MANCANO si dicono — e la tabella ARP si legge anche senza `arp`
// ============================================================
// La scoperta si regge su `ping` e sulla tabella dei vicini. In un container minimale o in un
// sandbox mancano; `_execFileAsync` ingoia ENOENT e risponde «non vivo», quindi la scansione
// finiva con «0 host» e nessuna spiegazione — indistinguibile da una rete vuota. Misurato nel
// banco di prova (nessun `ping`, nessun `arp`): sweep di una /24 con 0 vivi.
const test = require('node:test');
const assert = require('node:assert/strict');
const ns = require('../server/netscan.js');

const withPath = async (value, fn) => {
  const old = process.env.PATH;
  process.env.PATH = value;
  try { return await fn(); } finally { process.env.PATH = old; }
};

test('_parseProcNetArp: solo le voci complete, senza broadcast/multicast/MAC nullo', () => {
  const txt = [
    'IP address       HW type     Flags       HW address            Mask     Device',
    '10.0.0.1         0x1         0x2         aa:bb:cc:00:00:01     *        eth0',
    '10.0.0.2         0x1         0x0         00:00:00:00:00:00     *        eth0',   // incompleta
    '10.0.0.3         0x1         0x2         00:00:00:00:00:00     *        eth0',   // MAC nullo
    '10.0.0.255       0x1         0x2         ff:ff:ff:ff:ff:ff     *        eth0',   // broadcast
    '224.0.0.251      0x1         0x2         01:00:5e:00:00:fb     *        eth0',   // multicast
    '10.0.0.4         0x1         0x6         aa:bb:cc:00:00:04     *        eth0',   // 0x6 ha il bit 0x2
    'garbage line',
    '',
  ].join('\n');
  const m = ns._parseProcNetArp(txt);
  assert.deepEqual([...m.entries()], [['10.0.0.1', 'AA:BB:CC:00:00:01'], ['10.0.0.4', 'AA:BB:CC:00:00:04']]);
  assert.equal(ns._parseProcNetArp('').size, 0);
  assert.equal(ns._parseProcNetArp(null).size, 0);
});

test('_parseIpNeigh: lladdr presente e stato vivo; FAILED/INCOMPLETE e senza lladdr scartati', () => {
  const txt = [
    '10.0.0.1 dev eth0 lladdr aa:bb:cc:00:00:01 REACHABLE',
    '10.0.0.2 dev eth0 lladdr aa:bb:cc:00:00:02 STALE',
    '10.0.0.3 dev eth0  FAILED',
    '10.0.0.4 dev eth0 lladdr aa:bb:cc:00:00:04 INCOMPLETE',
    '10.0.0.5 dev eth0 router lladdr aa:bb:cc:00:00:05 DELAY',
    'fe80::1 dev eth0 lladdr aa:bb:cc:00:00:06 router STALE',          // IPv6: fuori
    '224.0.0.1 dev eth0 lladdr 01:00:5e:00:00:01 NOARP',
  ].join('\n');
  const m = ns._parseIpNeigh(txt);
  assert.deepEqual([...m.keys()], ['10.0.0.1', '10.0.0.2', '10.0.0.5']);
});

test('senza `ping` nel PATH: l\'host risulta non vivo, ma lo strumento mancante viene registrato', async () => {
  ns.resetToolWarnings();
  assert.deepEqual(ns.toolWarnings(), []);
  const r = await withPath('', () => ns._pingHost('127.0.0.1', 300));
  assert.equal(r.alive, false);
  assert.deepEqual(ns.toolWarnings(), [{ code: 'ping-missing', tool: 'ping' }]);
  ns.resetToolWarnings();
  assert.deepEqual(ns.toolWarnings(), [], 'si azzera a ogni scansione: installare `ping` fa sparire l\'avviso');
});

test('con `ping` presente nessun avviso (un host non rispondente non e\' uno strumento mancante)', async (t) => {
  const { execFileSync } = require('node:child_process');
  try { execFileSync('ping', ['-V'], { stdio: 'ignore' }); } catch (e) { if (e.code === 'ENOENT') return t.skip('ping non installato in questo ambiente'); }
  ns.resetToolWarnings();
  await ns._pingHost('192.0.2.1', 300);   // TEST-NET-1: non risponde
  assert.deepEqual(ns.toolWarnings(), []);
});

test('_readArpMap senza `arp` nel PATH: legge /proc/net/arp (Linux) invece di tacere', { skip: process.platform !== 'linux' }, async () => {
  ns.resetToolWarnings();
  const m = await withPath('', () => ns._readArpMap());
  assert.ok(m instanceof Map);
  // /proc/net/arp e' leggibile anche vuoto: NON e' uno strumento mancante.
  assert.deepEqual(ns.toolWarnings().filter(w => w.code === 'arp-missing'), []);
});
