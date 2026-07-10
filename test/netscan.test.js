'use strict';
// Parser ARP + normalizzazione MAC cross-platform.
// Regressione macOS: `arp` BSD stampa gli ottetti SENZA zeri iniziali
// (es. "0:1c:42:8:b:9") → vanno ri-paddati o il MAC (e quindi il vendor) si perde.
const { test } = require('node:test');
const assert = require('node:assert');
const { _parseArpTable, _normMac, DEEP_TCP_PORTS, _castProbe, _mdnsSsdpSweep, _shuffled, _buildNbstatQuery, _parseNbstatResponse } = require('../server/netscan');

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

// ---- _shuffled: ordine di scansione randomizzato (Furtiva anti-IDS) ----
test('_shuffled: permutazione (stessi elementi), ritorna una COPIA (non muta l\'input)', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = _shuffled(input, () => 0.42);
  assert.deepEqual([...out].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8], 'stessi elementi');
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8], 'input NON mutato');
  assert.notStrictEqual(out, input, 'ritorna un nuovo array');
});

test('_shuffled: deterministico con rand iniettato (Fisher-Yates, rand=0 -> j=0)', () => {
  // [A,B,C,D]: i=3 swap(3,0)->[D,B,C,A]; i=2 swap(2,0)->[C,B,D,A]; i=1 swap(1,0)->[B,C,D,A]
  assert.deepEqual(_shuffled(['A', 'B', 'C', 'D'], () => 0), ['B', 'C', 'D', 'A']);
});

test('_shuffled: rand vicino a 1 -> identita\' (nessuno swap effettivo)', () => {
  assert.deepEqual(_shuffled([1, 2, 3], () => 0.999), [1, 2, 3]);
});

test('_shuffled: input difensivi non lanciano', () => {
  assert.deepEqual(_shuffled([]), []);
  assert.deepEqual(_shuffled(), []);
  assert.deepEqual(_shuffled(null), []);
});

// ---- NBSTAT diretto via UDP 137 (nome NetBIOS Windows, bypassa la CLI lenta) ----
test('_buildNbstatQuery: pacchetto NBSTAT valido (50B, QTYPE 0x0021, nome "*" codificato)', () => {
  const q = _buildNbstatQuery(0x1337);
  assert.equal(q.length, 50, '12 header + 34 nome + 4 QTYPE/QCLASS');
  assert.equal(q.readUInt16BE(0), 0x1337, 'transaction id');
  assert.equal(q.readUInt16BE(4), 0x0001, 'QDCOUNT = 1');
  assert.equal(q[12], 0x20, 'lunghezza nome codificato = 32');
  assert.equal(q[13], 0x43, '"*" (0x2A) -> nibble alto 2 -> "C" (0x43)');
  assert.equal(q[14], 0x4B, '"*" (0x2A) -> nibble basso A -> "K" (0x4B)');
  assert.equal(q.readUInt16BE(46), 0x0021, 'QTYPE = NBSTAT');
  assert.equal(q.readUInt16BE(48), 0x0001, 'QCLASS = IN');
});

function _nbEntry(name, suffix, group) {
  const b = Buffer.alloc(18, 0x20);            // area nome riempita di spazi
  b.write(name, 0, 'latin1');
  b[15] = suffix;
  b.writeUInt16BE(group ? 0x8000 : 0x0400, 16);  // bit 15 = GROUP
  return b;
}

test('_parseNbstatResponse: estrae nome <00> unico + gruppo + MAC (forma = _parseNetbiosOutput)', () => {
  const header = Buffer.alloc(12); header.writeUInt16BE(0x1337, 0); header.writeUInt16BE(0x8400, 2); header.writeUInt16BE(1, 6);
  const rrName = Buffer.from([0xC0, 0x0C]);     // puntatore di compressione
  const rrMeta = Buffer.alloc(10); rrMeta.writeUInt16BE(0x0021, 0); rrMeta.writeUInt16BE(0x0001, 2);
  const num = Buffer.from([3]);
  const e1 = _nbEntry('DESKTOP-JH2S14O', 0x00, false);   // workstation (unico)
  const e2 = _nbEntry('DESKTOP-JH2S14O', 0x20, false);   // file server (unico) -> smbServer
  const e3 = _nbEntry('WORKGROUP', 0x00, true);          // gruppo
  const mac = Buffer.from([0x00, 0x23, 0x8b, 0x2e, 0x13, 0x03]);
  const resp = Buffer.concat([header, rrName, rrMeta, num, e1, e2, e3, mac]);
  const r = _parseNbstatResponse(resp);
  assert.equal(r.name, 'DESKTOP-JH2S14O');
  assert.equal(r.group, 'WORKGROUP');
  assert.equal(r.smbServer, true, '<20> unico -> file/print sharing');
  assert.equal(r.mac, '00:23:8B:2E:13:03');
  assert.equal(r.records.length, 3);
  assert.ok(r.records.some(x => x.suffix === '20' && x.kind === 'unique'));
});

test('_parseNbstatResponse: buffer troppo corto / spazzatura -> null (nessun crash)', () => {
  assert.equal(_parseNbstatResponse(Buffer.alloc(10)), null);
  assert.equal(_parseNbstatResponse(Buffer.from('non-una-risposta')), null);
  assert.equal(_parseNbstatResponse(null), null);
});
