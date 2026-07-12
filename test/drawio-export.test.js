// Test per il builder puro dell'export draw.io / mxGraph (lib/drawio-export.js).
const test   = require('node:test');
const assert = require('node:assert/strict');

const { buildDrawioXml, _escXml } = require('../lib/drawio-export.js');

// Catalogo tipi minimale (solo i flag che il builder legge).
const TYPES = {
  switch:     { isRack: true, ports: 24, sizeU: 1, mgmtEligible: true },
  patchpanel: { isRack: true, ports: 24, sizeU: 2 },
  server:     { isRack: true, ports: 4,  sizeU: 2 },
  cablemanager:{ isRack: true, ports: 0, sizeU: 1 },
  ap:         { isFloor: true },
};

function build(over) {
  const m = {
    racks: [{ id: 'r1', name: 'Main Rack', sizeU: 12 }],
    nodes: [
      { id: 'sw1', type: 'switch', rackId: 'r1', rackU: 12, sizeU: 1, ports: 24, name: 'Core-01' },
      { id: 'srv1', type: 'server', rackId: 'r1', rackU: 1, sizeU: 2, name: 'ESX-01' },
    ],
    ports: {},
    helpers: { types: TYPES, hasSnmpIntegration: n => !!n.snmpStatus },
  };
  return buildDrawioXml(Object.assign(m, over || {}));
}

// Estrae il blocco <mxCell ...>...</mxCell> con un dato id.
function cellOf(xml, id) {
  const re = new RegExp(`<mxCell id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?</mxCell>`);
  const m = xml.match(re);
  return m ? m[0] : null;
}

test('root: <mxfile> con host', () => {
  const xml = build();
  assert.match(xml, /^<mxfile host="InfraNetPro">/);
  assert.match(xml, /<\/mxfile>$/);
});

test('una <diagram> per rack (multi-pagina)', () => {
  const xml = build({
    racks: [
      { id: 'r1', name: 'Rack A', sizeU: 12 },
      { id: 'r2', name: 'Rack B', sizeU: 24 },
    ],
    nodes: [],
  });
  const pages = xml.match(/<diagram /g) || [];
  assert.equal(pages.length, 2);
  assert.match(xml, /<diagram name="Rack A" id="pg_r1">/);
  assert.match(xml, /<diagram name="Rack B" id="pg_r2">/);
});

test('cabinet: shape rack nativo con snap + numerazione, titolo con U', () => {
  const xml = build();
  const cab = cellOf(xml, 'rk_r1');
  assert.ok(cab, 'cabinet presente');
  assert.match(cab, /shape=mxgraph\.rackGeneral\.rackCabinet3/);
  assert.match(cab, /childLayout=rack/);
  assert.match(cab, /rackUnitSize=20/);
  assert.match(cab, /numDisp=ascend/);
  assert.match(cab, /value="Main Rack \(12U\)"/);
});

test('numDisp=descend quando uNumberFromTop', () => {
  const xml = build({ racks: [{ id: 'r1', name: 'R', sizeU: 12, uNumberFromTop: true }], nodes: [] });
  assert.match(cellOf(xml, 'rk_r1'), /numDisp=descend/);
});

test('solo i nodi isRack del rack entrano nel cabinet', () => {
  const xml = build({
    nodes: [
      { id: 'sw1', type: 'switch', rackId: 'r1', rackU: 10, ports: 24, name: 'SW' },
      { id: 'ap1', type: 'ap', rackId: 'r1', name: 'AP (floor)' },       // isFloor -> escluso
      { id: 'sw9', type: 'switch', rackId: 'rZ', rackU: 1, ports: 24 },  // altro rack -> escluso
    ],
  });
  assert.ok(cellOf(xml, 'sw1'), 'switch in rack incluso');
  assert.equal(cellOf(xml, 'ap1'), null, 'floor escluso');
  assert.equal(cellOf(xml, 'sw9'), null, 'altro rack escluso');
});

test('formula Y: device in cima (rackU=rs) a y=marginTop', () => {
  // rs=12, sw1 rackU=12 sizeU=1 -> y = 21 + (12-12-1+1)*20 = 21
  const cab = build();
  assert.match(cellOf(cab, 'sw1'), /<mxGeometry x="33" y="21" width="260" height="20"/);
});

test('formula Y: device 2U in fondo (rackU=1) e altezza sizeU*U', () => {
  // rs=12, srv1 rackU=1 sizeU=2 -> y = 21 + (12-1-2+1)*20 = 221, h = 40
  assert.match(cellOf(build(), 'srv1'), /<mxGeometry x="33" y="221" width="260" height="40"/);
});

test('una cella-porta per porta dati (id = pid), figlia del device', () => {
  const xml = build();
  const portCells = xml.match(/id="sw1-\d+"/g) || [];
  assert.equal(portCells.length, 24);
  // le porte sono figlie del device sw1
  assert.match(xml, /<mxCell id="sw1-1"[^>]*parent="sw1"/);
});

test('tacca SNMP: colore da snmpStatus', () => {
  const xml = build({
    nodes: [
      { id: 'sw1', type: 'switch', rackId: 'r1', rackU: 12, ports: 24, name: 'A', snmpStatus: 'ok' },
      { id: 'sw2', type: 'switch', rackId: 'r1', rackU: 8, ports: 24, name: 'B', snmpStatus: 'err' },
      { id: 'sw3', type: 'switch', rackId: 'r1', rackU: 4, ports: 24, name: 'C' }, // no snmp -> grigio
    ],
  });
  assert.match(cellOf(xml, 'sw1__snmp'), /fillColor=#39d353/);
  assert.match(cellOf(xml, 'sw2__snmp'), /fillColor=#f85149/);
  assert.match(cellOf(xml, 'sw3__snmp'), /fillColor=#6e7681/);
});

test('node.color: gradiente metallo ombreggiato (fill chiaro + grad scuro)', () => {
  const xml = build({
    nodes: [{ id: 'sw1', type: 'switch', rackId: 'r1', rackU: 12, ports: 24, name: 'A', color: '#808080' }],
  });
  const cab = cellOf(xml, 'sw1');
  assert.match(cab, /fillColor=#8a8a8a/);      // 128*1.08 -> 138
  assert.match(cab, /gradientColor=#575757/);  // 128*0.68 -> 87
});

test('node.color assente: metallo di default', () => {
  assert.match(cellOf(build(), 'sw1'), /fillColor=#3a3a3a;gradientColor=#2b2b2b/);
});

test('isAbsent: device attenuato con opacity=50 (guardia lato chiamante)', () => {
  const xml = build({ helpers: { types: TYPES, isAbsent: n => n.id === 'sw1' } });
  assert.match(cellOf(xml, 'sw1'), /opacity=50/);
  assert.doesNotMatch(cellOf(xml, 'srv1'), /opacity=50/);
});

test('skin: faccia = immagine + porte native, niente grid generato, nome omesso', () => {
  const xml = build({
    nodes: [{ id: 'sw1', type: 'switch', rackId: 'r1', rackU: 12, sizeU: 1, ports: 24, name: 'Skinned' }],
    ports: { 'sw1-1': { status: 'active' } },
    skins: {
      sw1: {
        image: 'data:image/svg+xml,%3Csvg%3E', aspect: 13, ports: [
          { pid: 'sw1-1', xf: 0.1, yf: 0.4, wf: 0.05, hf: 0.2 },
          { pid: 'sw1-2', xf: 0.2, yf: 0.4, wf: 0.05, hf: 0.2 },
        ],
      },
    },
  });
  // faccia come immagine (data URI URL-encoded)
  assert.match(cellOf(xml, 'sw1__skin'), /shape=image;image=data:image\/svg\+xml,%3Csvg%3E;imageAspect=1/);
  // porte native dallo skin: box 260x20, aspect 13 = box aspect -> nessun letterbox
  assert.match(cellOf(xml, 'sw1-1'), /fillColor=#39d353/);   // stato active
  assert.match(cellOf(xml, 'sw1-1'), /<mxGeometry x="26" y="8" width="13" height="4"/);
  assert.match(cellOf(xml, 'sw1-2'), /<mxGeometry x="52" y="8" width="13" height="4"/);
  // NIENTE grid generato: solo le 2 porte skin (non 24)
  assert.equal((xml.match(/id="sw1-\d+"/g) || []).length, 2);
  // nome omesso (device value vuoto) + tacca SNMP mantenuta
  assert.match(cellOf(xml, 'sw1'), /id="sw1" value=""/);
  assert.ok(cellOf(xml, 'sw1__snmp'));
});

test('skin con letterbox: porte scalate e centrate sull\'aspetto', () => {
  // box 260x20 (aspect 13); skin aspect 26 (piu larga) -> altezza render = 260/26 = 10,
  // centrata verticalmente: offY = (20-10)/2 = 5.
  const xml = build({
    nodes: [{ id: 'sw1', type: 'switch', rackId: 'r1', rackU: 12, sizeU: 1, ports: 8, name: 'S' }],
    skins: { sw1: { image: 'data:image/svg+xml,X', aspect: 26, ports: [{ pid: 'sw1-1', xf: 0, yf: 0, wf: 0.1, hf: 1 }] } },
  });
  // x=0, y=offY=5, w=0.1*260=26, h=1*10=10
  assert.match(cellOf(xml, 'sw1-1'), /<mxGeometry x="0" y="5" width="26" height="10"/);
});

test('skin senza porte localizzate: solo immagine (degradato)', () => {
  const xml = build({
    nodes: [{ id: 'sw1', type: 'switch', rackId: 'r1', rackU: 12, ports: 24, name: 'S' }],
    skins: { sw1: { image: 'data:image/svg+xml,X', aspect: 10, ports: [] } },
  });
  assert.ok(cellOf(xml, 'sw1__skin'));
  assert.equal((xml.match(/id="sw1-\d+"/g) || []).length, 0);
});

test('colore porta: stato + LAG (ciano)', () => {
  const xml = build({
    ports: {
      'sw1-1': { status: 'active' },
      'sw1-2': { status: 'fault' },
      'sw1-3': { lagGroup: 'po1' },
      'sw1-4': { statusOvr: 'idle', status: 'active' },  // override vince
    },
  });
  assert.match(cellOf(xml, 'sw1-1'), /fillColor=#39d353/);
  assert.match(cellOf(xml, 'sw1-2'), /fillColor=#f85149/);
  assert.match(cellOf(xml, 'sw1-3'), /fillColor=#00d4ff/);
  assert.match(cellOf(xml, 'sw1-4'), /fillColor=#f5a623/);
});

test('porta nascosta (hidden) non viene emessa', () => {
  const xml = build({ ports: { 'sw1-5': { hidden: true } } });
  assert.equal(cellOf(xml, 'sw1-5'), null);
  assert.equal((xml.match(/id="sw1-\d+"/g) || []).length, 23);
});

test('SFP: le porte piu alte vanno nel blocco laterale; MGMT ha pid -mgmtN', () => {
  const xml = build({
    nodes: [{
      id: 'sw1', type: 'switch', rackId: 'r1', rackU: 12, ports: 24, name: 'SW',
      frontPanel: { separateSfp: true, sfpCount: 2, mgmtCount: 1 },
    }],
  });
  // 24 porte totali - 2 sfp = 22 data (1..22) + 2 sfp (23,24) + 1 mgmt
  assert.ok(cellOf(xml, 'sw1-23'), 'sfp 23 presente');
  assert.ok(cellOf(xml, 'sw1-24'), 'sfp 24 presente');
  assert.ok(cellOf(xml, 'sw1-mgmt1'), 'mgmt1 presente');
  // 24 celle numeriche totali (22 data + 2 sfp), tutte con id sw1-<n>
  assert.equal((xml.match(/id="sw1-\d+"/g) || []).length, 24);
});

test('cablemanager e ports=0: nessuna porta, solo faccia + tacca', () => {
  const xml = build({
    nodes: [{ id: 'cm1', type: 'cablemanager', rackId: 'r1', rackU: 6, sizeU: 1, name: 'CM' }],
  });
  assert.ok(cellOf(xml, 'cm1'), 'faccia presente');
  assert.ok(cellOf(xml, 'cm1__snmp'), 'tacca presente');
  assert.equal((xml.match(/id="cm1-\d+"/g) || []).length, 0);
});

test('getRackSize: fallback clampa sizeU 6..60', () => {
  const xml = build({ racks: [{ id: 'r1', name: 'Big', sizeU: 999 }], nodes: [] });
  assert.match(cellOf(xml, 'rk_r1'), /value="Big \(60U\)"/);
});

test('escaping XML nei valori (nome rack/device)', () => {
  const xml = build({
    racks: [{ id: 'r1', name: 'A&B <"x">', sizeU: 12 }],
    nodes: [{ id: 'sw1', type: 'switch', rackId: 'r1', rackU: 12, ports: 24, name: 'Nod&e' }],
  });
  assert.match(xml, /value="A&amp;B &lt;&quot;x&quot;&gt; \(12U\)"/);
  assert.match(cellOf(xml, 'sw1'), /value="Nod&amp;e"/);
  // niente < o & grezzi dentro un value
  assert.doesNotMatch(xml, /value="[^"]*A&B/);
});

test('ZERO artefatti: niente image/foreignObject/whiteSpace=wrap/html=1', () => {
  const xml = build();
  assert.doesNotMatch(xml, /shape=image/);
  assert.doesNotMatch(xml, /<image\b/);
  assert.doesNotMatch(xml, /foreignObject/i);
  assert.doesNotMatch(xml, /whiteSpace=wrap/);
  assert.doesNotMatch(xml, /html=1/);
  // ogni container (cabinet + device) deve avere collapsible=0
  const containers = xml.match(/container=1[^"]*/g) || [];
  assert.ok(containers.length >= 3, 'almeno cabinet + 2 device sono container');
  containers.forEach(s => assert.match(s, /collapsible=0/));
});

test('base cells 0 e 1 presenti per ogni pagina', () => {
  const xml = build();
  assert.match(xml, /<mxCell id="0"\/><mxCell id="1" parent="0"\/>/);
});

test('_escXml: entita basilari', () => {
  assert.equal(_escXml('a&b<c>"d\'e'), 'a&amp;b&lt;c&gt;&quot;d&apos;e');
  assert.equal(_escXml(null), '');
});

test('racks vuoti: mxfile vuoto valido', () => {
  assert.equal(buildDrawioXml({ racks: [], nodes: [] }), '<mxfile host="InfraNetPro"></mxfile>');
});
