// Test del framework driver DHCP live (server/dhcp-drivers).
// I driver vendor sono il PACK A PAGAMENTO (server/dhcp-drivers/vendor/, gitignored):
// i test specifici girano SOLO se il pack è installato in locale, altrimenti si
// saltano — così la suite resta verde anche nel repo pubblico (senza i driver).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const drivers = require('../server/dhcp-drivers');
const { normalizeLeaseRecords } = require('../lib/dhcp-lease.js');

const D = drivers.DRIVERS;
const need = id => (D[id] ? false : `driver-pack non installato (${id})`);

test('framework: listDrivers è un array; fetchLeases vendor ignoto → errore', async () => {
  assert.ok(Array.isArray(drivers.listDrivers()));
  await assert.rejects(() => drivers.fetchLeases('nope', { host: 'x' }), /unknown vendor/);
});

test('framework: _httpRequest HTTP >= 400 → reject', async () => {
  const srv = http.createServer((req, res) => { res.statusCode = 404; res.end('nope'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    await assert.rejects(() => drivers._httpRequest({ protocol: 'http', host: '127.0.0.1', port, path: '/x' }), /HTTP 404/);
  } finally { srv.close(); }
});

test('FortiGate: buildRequest (Bearer) + parseLeases (results[])', { skip: need('fortigate') }, () => {
  const fg = D.fortigate;
  const r = fg.buildRequest({ token: 'XYZ' });
  assert.equal(r.path, '/api/v2/monitor/system/dhcp');
  assert.equal(r.headers.Authorization, 'Bearer XYZ');
  const body = JSON.stringify({ status: 'success', results: [{ ip: '10.0.20.50', mac: 'aa:bb:cc:dd:ee:ff', hostname: 'laptop', expire_time: 1750944000, status: 'leased' }] });
  const n = normalizeLeaseRecords(fg.parseLeases(body));
  assert.equal(n[0].mac, 'AA:BB:CC:DD:EE:FF');
  assert.equal(n[0].ip, '10.0.20.50');
});

test('PAN-OS: buildRequest (type=op + key) + parseLeases (<entry> XML)', { skip: need('panos') }, () => {
  const p = D.panos;
  assert.match(p.buildRequest({ apikey: 'K1' }).path, /type=op/);
  assert.match(p.buildRequest({ apikey: 'K1' }).path, /key=K1/);
  const body = '<response status="success"><result><entry><ip>10.0.20.51</ip><mac>11:22:33:44:55:66</mac><hostname>pc2</hostname></entry></result></response>';
  const n = normalizeLeaseRecords(p.parseLeases(body));
  assert.equal(n[0].ip, '10.0.20.51');
  assert.equal(n[0].mac, '11:22:33:44:55:66');
});

test('OPNsense: parseLeases rows[] con address/mac o hwaddr', { skip: need('opnsense') }, () => {
  const body = JSON.stringify({ rows: [
    { address: '10.0.40.20', mac: 'aa:bb:cc:00:00:20', hostname: 'nas' },
    { address: '10.0.40.21', hwaddr: 'aa:bb:cc:00:00:21' },
  ] });
  const n = normalizeLeaseRecords(D.opnsense.parseLeases(body));
  assert.equal(n.length, 2);
  assert.ok(n.find(x => x.mac === 'AA:BB:CC:00:00:21'), 'hwaddr come fallback del MAC');
});

test('MikroTik: parseLeases + fetchLeases end-to-end su HTTP locale', { skip: need('mikrotik') }, async () => {
  const payload = JSON.stringify([{ address: '10.0.50.30', 'mac-address': 'AA:BB:CC:DD:EE:30', 'host-name': 'pc-office', status: 'bound' }]);
  assert.equal(normalizeLeaseRecords(D.mikrotik.parseLeases(payload))[0].ip, '10.0.50.30');
  const srv = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(payload); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const out = await drivers.fetchLeases('mikrotik', { host: '127.0.0.1', port, protocol: 'http', user: 'a', pass: 'b' });
    assert.equal(out.count, 1);
    assert.equal(out.leases[0].mac, 'AA:BB:CC:DD:EE:30');
  } finally { srv.close(); }
});

test('parseLeases: body malformato → [] (nessun crash)', { skip: need('fortigate') }, () => {
  assert.deepEqual(D.fortigate.parseLeases('not json'), []);
  if (D.opnsense) assert.deepEqual(D.opnsense.parseLeases(''), []);
  if (D.panos) assert.deepEqual(D.panos.parseLeases('<response status="error"></response>'), []);
});
