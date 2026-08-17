// Ri-lettura del DCIM: che cosa e' cambiato da quando hai importato.
// Il modulo non scrive niente — DICE — e i test guardano soprattutto le tre
// onesta' che lo giustificano: il lavoro a mano non e' una differenza, si
// confronta solo il dichiarato, e «diverso» non accusa nessuno.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diffAgainstProject } = require('../lib/dcim-diff');

function dev(id, extra) {
  return Object.assign({ id: 'nb-dev-' + id, name: 'SW-' + id, type: 'switch', placement: 'rack',
    brand: 'Cisco', model: 'C9200', source: { deviceId: id } }, extra || {});
}

function state(nodes, extra) {
  return Object.assign({ nodes: nodes || [], racks: [], ipam: { prefixes: [] }, vlanNames: {} }, extra || {});
}

test('nessuna differenza: due letture uguali danno un esito, non un pannello vuoto', () => {
  const a = state([dev(1), dev(2)]);
  const b = state([dev(1), dev(2)]);
  const r = diffAgainstProject(a, b);
  assert.equal(r.clean, true);
  assert.deepEqual(r.counts, { added: 0, removed: 0, changed: 0 });
});

test('apparato nuovo nel DCIM e apparato sparito dal DCIM', () => {
  const r = diffAgainstProject(state([dev(1), dev(3)]), state([dev(1), dev(2)]));
  assert.deepEqual(r.devices.added.map(x => x.id), ['3']);
  assert.deepEqual(r.devices.removed.map(x => x.id), ['2']);
  assert.equal(r.counts.added, 1);
  assert.equal(r.counts.removed, 1);
});

// ⭐ L'onesta' numero uno. Un apparato che hai aggiunto tu non ha un id NetBox:
// stamparlo fra «spariti dal DCIM» accuserebbe l'utente del proprio lavoro.
test('il lavoro fatto a mano NON e\' una differenza: si conta a parte', () => {
  const mio = { id: 'mio-1', name: 'Stampante corridoio', type: 'printer' };
  const r = diffAgainstProject(state([dev(1)]), state([dev(1), mio]));
  assert.equal(r.clean, true);
  assert.equal(r.devices.removed.length, 0);
  assert.equal(r.handmade.devices, 1);
});

test('campo cambiato: la riga porta i due valori, non un verdetto', () => {
  const r = diffAgainstProject(state([dev(1, { name: 'SW-CORE-01' })]), state([dev(1, { name: 'SW-1' })]));
  const row = r.devices.changed[0];
  assert.equal(row.id, '1');
  assert.deepEqual(row.fields, [{ field: 'name', dcim: 'SW-CORE-01', doc: 'SW-1' }]);
});

// ⭐ L'onesta' numero tre. Non si sa CHI ha cambiato — tranne quando il documento
// porta il flag che dice «questo l'ho scritto io»: quello e' un fatto.
test('un valore scritto a mano si dichiara tale, e la differenza resta', () => {
  const r = diffAgainstProject(state([dev(1, { name: 'SW-CORE-01' })]),
    state([dev(1, { name: 'Switch di sala', nameManual: true })]));
  const f = r.devices.changed[0].fields[0];
  assert.equal(f.manual, true);
  assert.equal(f.doc, 'Switch di sala');
});

// ⭐ L'onesta' numero due. Le misure non si confrontano: cambiano da sole e non
// dicono niente sul DCIM. Se una entrasse nella lista, ogni ri-lettura di un
// progetto vivo produrrebbe decine di righe che non chiedono niente.
test('le misure non entrano nel confronto', () => {
  const r = diffAgainstProject(
    state([dev(1, { snmpStatus: 'ok', x: 100, y: 200, proof: { state: 'verified' } })]),
    state([dev(1, { snmpStatus: 'err', x: 900, y: 900, proof: { state: 'declared' } })]));
  assert.equal(r.clean, true);
});

test('il silenzio del DCIM non e\' una differenza', () => {
  // NetBox non dichiara la matricola; il documento ce l'ha (SNMP, o scritta a mano).
  const r = diffAgainstProject(state([dev(1)]), state([dev(1, { serialNumber: 'ABC123' })]));
  assert.equal(r.clean, true);
});

test('il rack si confronta per NOME, non per un id generato dall\'import', () => {
  const a = state([dev(1, { rackId: 'nb-rack-9' })], { racks: [{ id: 'nb-rack-9', name: 'Rack A', sizeU: 42 }] });
  const b = state([dev(1, { rackId: 'r-777' })], { racks: [{ id: 'r-777', name: 'Rack A', sizeU: 42 }] });
  assert.equal(diffAgainstProject(a, b).clean, true);
  const c = state([dev(1, { rackId: 'r-777' })], { racks: [{ id: 'r-777', name: 'Rack B', sizeU: 42 }] });
  const r = diffAgainstProject(a, c);
  assert.equal(r.devices.changed[0].fields.find(f => f.field === 'rack').dcim, 'Rack A');
  assert.equal(r.racks.added.length, 1);      // «Rack A» non c'e' piu' nel documento
  assert.equal(r.racks.removed.length, 1);    // e «Rack B» il DCIM non lo conosce
});

test('prefissi: identita\' = id NetBox, e una rete scritta a mano non manca da nessuna parte', () => {
  const pf = (id, cidr, extra) => Object.assign({ id, cidr, source: 'dcim' }, extra || {});
  const a = state([], { ipam: { prefixes: [pf(70, '10.0.0.0/24'), pf(71, '10.1.0.0/24')] } });
  const b = state([], { ipam: { prefixes: [pf(70, '10.0.0.0/23'), { cidr: '192.168.9.0/24' }] } });
  const r = diffAgainstProject(a, b);
  assert.deepEqual(r.prefixes.added.map(x => x.name), ['10.1.0.0/24']);
  assert.equal(r.prefixes.removed.length, 0);
  assert.deepEqual(r.prefixes.changed[0].fields, [{ field: 'cidr', dcim: '10.0.0.0/24', doc: '10.0.0.0/23' }]);
  assert.equal(r.handmade.prefixes, 1);
});

test('VLAN: identita\' = il vid, che e\' l\'identita\' vera', () => {
  const a = state([], { vlanNames: { 10: 'Mgmt', 20: 'Voce' } });
  const b = state([], { vlanNames: { 10: 'Management', 30: 'Ospiti' } });
  const r = diffAgainstProject(a, b);
  assert.deepEqual(r.vlans.added.map(x => x.id), ['20']);
  assert.deepEqual(r.vlans.removed.map(x => x.id), ['30']);
  assert.equal(r.vlans.changed[0].fields[0].dcim, 'Mgmt');
});

test('un documento senza niente di importato: tutto e\' suo, niente e\' una differenza', () => {
  const mio = { id: 'a', name: 'Switch', type: 'switch' };
  const r = diffAgainstProject(state([]), state([mio, { id: 'b', name: 'AP', type: 'ap' }]));
  assert.equal(r.clean, true);
  assert.equal(r.handmade.devices, 2);
});

test('argomenti vuoti o malformati non fanno esplodere niente', () => {
  assert.equal(diffAgainstProject(null, null).clean, true);
  assert.equal(diffAgainstProject({}, {}).clean, true);
  assert.equal(diffAgainstProject({ nodes: 'boh' }, { nodes: null }).clean, true);
});
