'use strict';
// Parser ARP + normalizzazione MAC cross-platform.
// Regressione macOS: `arp` BSD stampa gli ottetti SENZA zeri iniziali
// (es. "0:1c:42:8:b:9") → vanno ri-paddati o il MAC (e quindi il vendor) si perde.
const { test } = require('node:test');
const assert = require('node:assert');
const { _parseArpTable, _normMac, DEEP_TCP_PORTS, _castProbe, _mdnsSsdpSweep } = require('../server/netscan');

test('DEEP_TCP_PORTS: include le porte Google Cast (8008/8009) per il rilevamento media', () => {
  const ports = DEEP_TCP_PORTS.map(p => p.port);
  assert.ok(ports.includes(8008), '8008 (Cast) presente');
  assert.ok(ports.includes(8009), '8009 (Cast TLS) presente');
  assert.equal(typeof _castProbe, 'function', '_castProbe esportato');
});

// ---- _mdnsSsdpSweep: strato IO con socket INIETTATO (nessun multicast reale) ----
function _encName(name) {
  const parts = [];
  for (const l of String(name).replace(/\.$/, '').split('.')) {
    const b = Buffer.from(l, 'utf8');
    parts.push(Buffer.from([b.length]), b);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}
function _rr(name, type, rdata) {
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0); head.writeUInt16BE(1, 2); head.writeUInt32BE(120, 4); head.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([_encName(name), head, rdata]);
}
function _mdnsGooglecast() {
  const header = Buffer.alloc(12); header.writeUInt16BE(0x8400, 2); header.writeUInt16BE(1, 6);
  return Buffer.concat([header, _rr('_googlecast._tcp.local', 12, _encName('Chromecast._googlecast._tcp.local'))]);
}

class _FakeSocket {
  constructor(onBind) { this._h = {}; this._onBind = onBind; }
  on(ev, cb) { (this._h[ev] = this._h[ev] || []).push(cb); return this; }
  _emit(ev, ...a) { for (const cb of (this._h[ev] || [])) cb(...a); }
  bind(port, iface, cb) { const done = typeof iface === 'function' ? iface : cb; setImmediate(() => { if (done) done(); if (this._onBind) this._onBind(this); }); }
  addMembership() {} setMulticastTTL() {} send() {} close() {}
}

test('_mdnsSsdpSweep: aggrega risposte mDNS + SSDP per IP (socket iniettato)', async () => {
  let n = 0;
  const ssdp = ['HTTP/1.1 200 OK', 'ST: urn:schemas-upnp-org:device:MediaRenderer:1', 'LOCATION: http://192.168.1.61:80/d.xml', ''].join('\r\n');
  const createSocket = () => {
    const idx = n++;
    return new _FakeSocket(sock => {
      if (idx === 0) sock._emit('message', _mdnsGooglecast(), { address: '192.168.1.60' });
      else sock._emit('message', Buffer.from(ssdp, 'utf8'), { address: '192.168.1.61' });
    });
  };
  const map = await _mdnsSsdpSweep({ createSocket, deadlineMs: 60 });
  assert.ok(map instanceof Map, 'ritorna una Map');
  assert.equal(map.get('192.168.1.60')?.type, 'tv', 'mDNS googlecast -> tv');
  assert.equal(map.get('192.168.1.60')?.strength, 'strong');
  assert.equal(map.get('192.168.1.61')?.type, 'tv', 'SSDP MediaRenderer -> tv');
  // Nessun socket reale creato: fetch XML disattivato con createSocket iniettato.
});

test('_mdnsSsdpSweep: nessuna risposta -> Map vuota, non lancia', async () => {
  const createSocket = () => new _FakeSocket(null);
  const map = await _mdnsSsdpSweep({ createSocket, deadlineMs: 40 });
  assert.equal(map.size, 0);
});

test('_mdnsSsdpSweep: cappa il flood di messaggi (guardia DoS) e completa comunque', async () => {
  const pkt = _mdnsGooglecast();
  const createSocket = () => new _FakeSocket(sock => {
    // flood: 6000 messaggi da IP diversi (oltre il tetto MAX_SWEEP_MSGS=5000)
    for (let i = 0; i < 6000; i++) sock._emit('message', pkt, { address: '10.0.0.' + (i % 254) });
  });
  const map = await _mdnsSsdpSweep({ createSocket, deadlineMs: 50 });
  assert.ok(map instanceof Map, 'completa senza hang/throw sotto flood');
  assert.ok(map.size > 0 && map.size <= 254, 'aggregazione limitata agli IP unici');
});

test('_normMac: formato Windows con trattini', () => {
  assert.equal(_normMac('AA-BB-CC-DD-EE-FF'), 'AA:BB:CC:DD:EE:FF');
});

test('_normMac: formato colon completo', () => {
  assert.equal(_normMac('aa:bb:cc:dd:ee:ff'), 'AA:BB:CC:DD:EE:FF');
});

test('_normMac: ottetti macOS/BSD senza zeri iniziali vengono ripadddati', () => {
  assert.equal(_normMac('0:1c:42:8:b:9'), '00:1C:42:08:0B:09');
  assert.equal(_normMac('f4:39:9:0:0:1'), 'F4:39:09:00:00:01');
  assert.equal(_normMac('8:0:9:a:b:c'), '08:00:09:0A:0B:0C');
});

test('_normMac: scarta input non validi', () => {
  assert.equal(_normMac('not-a-mac'), '');
  assert.equal(_normMac(''), '');
  assert.equal(_normMac('1:2:3'), '');
});

test('_parseArpTable: tabella Windows (arp -a)', () => {
  const out = [
    'Interface: 192.168.1.10 --- 0x5',
    '  Internet Address      Physical Address      Type',
    '  192.168.1.1           d4-1a-d1-aa-bb-cc     dynamic',
    '  192.168.1.20          00-0c-29-01-02-03     dynamic',
  ].join('\n');
  const m = _parseArpTable(out);
  assert.equal(m.get('192.168.1.1'), 'D4:1A:D1:AA:BB:CC');
  assert.equal(m.get('192.168.1.20'), '00:0C:29:01:02:03');
});

test('_parseArpTable: macOS arp -an con ottetti senza zeri', () => {
  const out = [
    '? (192.168.1.1) at d4:1a:d1:aa:bb:cc on en0 ifscope [ethernet]',
    '? (192.168.1.20) at 0:c:29:1:2:3 on en0 ifscope [ethernet]',
    '? (192.168.1.99) at (incomplete) on en0 ifscope [ethernet]',
  ].join('\n');
  const m = _parseArpTable(out);
  assert.equal(m.get('192.168.1.1'), 'D4:1A:D1:AA:BB:CC');
  assert.equal(m.get('192.168.1.20'), '00:0C:29:01:02:03'); // ripaddato
  assert.equal(m.has('192.168.1.99'), false);               // (incomplete) ignorato
});

test('_parseArpTable: Linux arp -an ([ether])', () => {
  const out = '? (10.0.0.5) at f4:39:09:00:00:01 [ether] on eth0';
  const m = _parseArpTable(out);
  assert.equal(m.get('10.0.0.5'), 'F4:39:09:00:00:01');
});
