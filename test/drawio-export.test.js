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

// Estrae il blocco <UserObject ... id="...">...</UserObject> (archi bundle dei cavi).
function uobjOf(xml, id) {
  const re = new RegExp(`<UserObject\\b[^>]*\\bid="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?</UserObject>`);
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

test('nessuna tacca di stato SNMP: e un indicatore LIVE, l export e STATICO', () => {
  const xml = build({
    nodes: [
      { id: 'sw1', type: 'switch', rackId: 'r1', rackU: 12, ports: 24, name: 'A', snmpStatus: 'ok' },
      { id: 'sw2', type: 'switch', rackId: 'r1', rackU: 8, ports: 24, name: 'B', snmpStatus: 'err' },
      { id: 'sw3', type: 'switch', rackId: 'r1', rackU: 4, ports: 24, name: 'C' },
    ],
  });
  assert.equal(cellOf(xml, 'sw1__snmp'), null);
  assert.equal(cellOf(xml, 'sw2__snmp'), null);
  assert.equal((xml.match(/__snmp"/g) || []).length, 0, 'nessuna cella __snmp emessa');
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
  // nome interno omesso (device value vuoto), nessuna tacca SNMP
  assert.match(cellOf(xml, 'sw1'), /id="sw1" value=""/);
  assert.equal(cellOf(xml, 'sw1__snmp'), null);
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

test('porte compatte: gap limitato + blocco centrato (non spalmate su tutta la larghezza)', () => {
  // 4 porte su un device largo devono stare in un blocco compatto (come InfraNet),
  // NON sparse su ~192px. Regressione: prima usavo pitch=w/n (spalmava).
  const xml = build({ nodes: [{ id: 'sw1', type: 'switch', rackId: 'r1', rackU: 12, sizeU: 1, ports: 4, name: 'A' }] });
  const xs = [1, 2, 3, 4].map(i => +(cellOf(xml, 'sw1-' + i).match(/<mxGeometry x="([\d.]+)"/)[1]));
  const span = Math.max(...xs) - Math.min(...xs);
  assert.ok(span > 0 && span < 60, 'porte compatte, span=' + span);
  // numero DENTRO il LED (value = numero) quando il LED e' abbastanza grande
  assert.match(cellOf(xml, 'sw1-1'), /value="1"/);
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

test('cablemanager e ports=0: nessuna porta, solo faccia + nome esterno', () => {
  const xml = build({
    nodes: [{ id: 'cm1', type: 'cablemanager', rackId: 'r1', rackU: 6, sizeU: 1, name: 'CM' }],
  });
  assert.ok(cellOf(xml, 'cm1'), 'faccia presente');
  assert.ok(cellOf(xml, 'cm1__name'), 'nome esterno presente');
  assert.equal(cellOf(xml, 'cm1__snmp'), null, 'nessuna tacca SNMP');
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
  // il nome vive ora nell'etichetta ESTERNA (device interno senza nome)
  assert.match(cellOf(xml, 'sw1__name'), /value="Nod&amp;e"/);
  // niente < o & grezzi dentro un value
  assert.doesNotMatch(xml, /value="[^"]*A&B/);
});

test('nome device: etichetta ESTERNA a destra del cabinet, device interno senza nome', () => {
  const xml = build();
  // device interno: value vuoto -> la faccia resta libera per le porte
  assert.match(cellOf(xml, 'sw1'), /id="sw1" value=""/);
  // etichetta-nome esterna, figlia del layer root '1' (NON del cabinet)
  const lbl = cellOf(xml, 'sw1__name');
  assert.ok(lbl, 'etichetta nome presente');
  assert.match(lbl, /value="Core-01"/);
  assert.match(lbl, /parent="1"/);
  assert.match(lbl, /text;html=0/);   // <text> puro: niente artefatti
  assert.match(lbl, /fontColor=#f8fafc/);   // BIANCO (dark-only, come la vista live)
  assert.match(lbl, /labelBackgroundColor=#0d1117/);   // sfondo dietro al testo: leggibile su ogni tema
  // X oltre il bordo destro del cabinet: 40 + (33+260+9) + 10 = 352
  assert.match(lbl, /<mxGeometry x="352"/);
  // Y allineata al device sw1 (in cima): 40 + 21 = 61
  assert.match(lbl, /y="61"/);
  // srv1 (rackU=1, sizeU=2): y interno 221 -> assoluto 261, altezza 40
  assert.match(cellOf(xml, 'srv1__name'), /<mxGeometry x="352" y="261" width="170" height="40"/);
});

test('porte INVARIATE dopo lo spostamento del nome (namePad preservato)', () => {
  // Regressione: spostare il nome fuori NON deve muovere le porte. namePad resta
  // 56, quindi l'area dati e lo span delle porte sono identici a prima.
  const xml = build({ nodes: [{ id: 'sw1', type: 'switch', rackId: 'r1', rackU: 12, sizeU: 1, ports: 4, name: 'A' }] });
  const xs = [1, 2, 3, 4].map(i => +(cellOf(xml, 'sw1-' + i).match(/<mxGeometry x="([\d.]+)"/)[1]));
  const span = Math.max(...xs) - Math.min(...xs);
  assert.ok(span > 0 && span < 60, 'porte compatte, span=' + span);
});

test('cavi: un arco per cavo su layer attivabile; porta<->porta; colore rispettato', () => {
  const xml = build({
    links: [
      { id: 'L1', src: 'sw1-1', dst: 'srv1-2' },
      { id: 'L2', src: 'sw1-3', dst: 'srv1-4', color: '#39d353' },
    ],
  });
  // layer cavi: figlio della root '0', inizialmente NASCOSTO (visible=0), nome "Cavi"
  assert.match(xml, /<mxCell id="cbl_layer_r1" value="Cavi" parent="0" visible="0"\/>/);
  // un arco per cavo (2 link -> 2 archi, niente bundle)
  assert.equal((xml.match(/edge="1"/g) || []).length, 2);
  const e1 = cellOf(xml, 'cbl_L1');
  assert.ok(e1, 'arco L1 presente');
  assert.match(e1, /edge="1"/);
  assert.match(e1, /parent="cbl_layer_r1"/);
  assert.match(e1, /source="sw1-1"/);           // porta<->porta (precisione per cavo)
  assert.match(e1, /target="srv1-2"/);
  assert.match(e1, /endArrow=none/);            // un cavo non ha verso
  assert.match(e1, /strokeColor=#9aa5b1/);      // default argento
  assert.match(cellOf(xml, 'cbl_L2'), /strokeColor=#39d353/);   // colore esplicito rispettato
});

test('cavi: tabella per VLAN + click-riga evidenzia il cavo (custom action link)', () => {
  const xml = build({
    links: [
      { id: 'La', src: 'sw1-1', dst: 'srv1-1', vlan: 10 },
      { id: 'Lb', src: 'sw1-2', dst: 'srv1-2', vlan: 20 },
    ],
    helpers: { types: TYPES, linkVlan: l => l.vlan, vlanName: vid => ({ 10: 'Voce', 20: 'Dati' }[vid] || '') },
  });
  // header tabella = UserObject sul layer della VLAN, col nome VLAN; click header = AZZERA
  // (Set Style strokeWidth base su tutti i cavi della VLAN)
  const t10 = uobjOf(xml, 'cbltbl_cbl_v10_r1');
  assert.ok(t10, 'header tabella VLAN 10');
  assert.match(t10, /label="Voce"/);
  assert.match(t10, /parent="cbl_v10_r1"/);
  assert.match(t10, /link="data:action\/json/);
  assert.match(t10, /strokeWidth/);                       // reset spessore
  // riga La: custom action link -> evidenzia PERSISTENTE (Set Style spessore) + lampeggio + scroll
  const rowLa = uobjOf(xml, 'cblrow_cbl_La');
  assert.ok(rowLa, 'riga La');
  assert.match(rowLa, /link="data:action\/json/);
  assert.match(rowLa, /style/);                           // Set Style = evidenziazione persistente
  assert.match(rowLa, /strokeWidth/);
  assert.match(rowLa, /highlight/);                       // lampeggio di conferma
  assert.match(rowLa, /cbl_La/);                          // bersaglio dell'azione = il cavo
  assert.match(rowLa, /scroll/);
  assert.match(rowLa, /Core-01/);                         // etichetta far-end: nome/porta sorgente
  assert.match(rowLa, /ESX-01/);                          // ... e destinazione
  assert.match(rowLa, /parent="cbl_v10_r1"/);             // riga sul layer della sua VLAN
  // la riga della VLAN 20 sta sul layer VLAN 20
  assert.match(uobjOf(xml, 'cblrow_cbl_Lb'), /parent="cbl_v20_r1"/);
});

test('cavi: evidenziazione PERSISTENTE a radio (riga ingrossa a 5, azzera tutti a 1.5; header solo reset)', () => {
  const xml = build({
    links: [
      { id: 'La', src: 'sw1-1', dst: 'srv1-1' },
      { id: 'Lb', src: 'sw1-2', dst: 'srv1-2' },
    ],
  });
  const decode = s => s.replace(/&quot;/g, '"');
  const rowLa = decode(uobjOf(xml, 'cblrow_cbl_La'));
  // radio: prima azzera lo spessore di TUTTI i cavi (cbl_La e cbl_Lb) a base 1.5...
  assert.match(rowLa, /"style":\{"cells":\["cbl_La","cbl_Lb"\],"key":"strokeWidth","value":"1.5"\}/);
  // ...poi ingrossa SOLO cbl_La a 5 (persistente)
  assert.match(rowLa, /"style":\{"cells":\["cbl_La"\],"key":"strokeWidth","value":"5"\}/);
  // header: SOLO reset (azzera), niente ingrossamento
  const hdr = decode(uobjOf(xml, 'cbltbl_cbl_layer_r1'));
  assert.match(hdr, /"value":"1.5"/);
  assert.doesNotMatch(hdr, /"value":"5"/);
});

test('A4: pagina 827x1169 e TUTTO il contenuto entro la larghezza A4 (anche con tabelle VLAN)', () => {
  const xml = build({
    links: [
      { id: 'La', src: 'sw1-1', dst: 'srv1-1', vlan: 10 },
      { id: 'Lb', src: 'sw1-2', dst: 'srv1-2', vlan: 20 },
      { id: 'Lc', src: 'sw1-3', dst: 'srv1-3', vlan: 30 },
    ],
    helpers: { types: TYPES, linkVlan: l => l.vlan, vlanName: () => '' },
  });
  // pagina A4 verticale
  assert.match(xml, /pageWidth="827" pageHeight="1169"/);
  // ogni geometria (vertici) sta entro la larghezza A4: x + width <= 827
  const geos = [...xml.matchAll(/<mxGeometry x="([\d.-]+)" y="[\d.-]+" width="([\d.]+)"/g)];
  assert.ok(geos.length > 3, 'ci sono geometrie da controllare');
  geos.forEach(m => {
    const right = parseFloat(m[1]) + parseFloat(m[2]);
    assert.ok(right <= 827, 'contenuto entro A4: right=' + right);
  });
  // 3 tabelle VLAN, tutte allo STESSO x (non affiancate) -> ancora entro A4
  const hdrX = [...xml.matchAll(/id="cbltbl_[^"]+">[\s\S]*?<mxGeometry x="([\d.]+)"/g)].map(m => +m[1]);
  assert.equal(hdrX.length, 3);
  assert.equal(new Set(hdrX).size, 1, 'tutte le tabelle allo stesso ancoraggio');
});

test('A3: se il contenuto non entra in A4 la pagina passa ad A3 (rack alto)', () => {
  const tall = build({
    racks: [{ id: 'r1', name: 'R', sizeU: 60 }],
    nodes: [{ id: 'sw1', type: 'switch', rackId: 'r1', rackU: 1, sizeU: 1, ports: 4, name: 'A' }],
  });
  assert.match(tall, /pageWidth="1169" pageHeight="1654"/);   // A3 verticale
  // rack basso -> resta A4
  const small = build({ racks: [{ id: 'r1', name: 'R', sizeU: 12 }], nodes: [] });
  assert.match(small, /pageWidth="827" pageHeight="1169"/);
});

test('A3: VLAN con moltissimi cavi (tabella lunga oltre A4) -> pagina A3', () => {
  // 80 cavi su una sola VLAN -> tabella alta ~ 40+20+80*16 = 1340 > 1169 -> A3
  const nodes = [
    { id: 'sw1', type: 'switch', rackId: 'r1', rackU: 20, sizeU: 1, ports: 96, name: 'Core' },
    { id: 'pp1', type: 'patchpanel', rackId: 'r1', rackU: 1, sizeU: 4, ports: 96, name: 'PP' },
  ];
  const links = [];
  for (let i = 1; i <= 80; i++) links.push({ id: 'c' + i, src: 'sw1-' + i, dst: 'pp1-' + i, vlan: 10 });
  const xml = build({ racks: [{ id: 'r1', name: 'R', sizeU: 24 }], nodes, links,
    helpers: { types: TYPES, linkVlan: l => l.vlan, vlanName: () => '' } });
  assert.match(xml, /pageWidth="1169" pageHeight="1654"/);
});

test('cavi: anti-sovrapposizione = corsia dedicata (2 waypoint, exit/entry sinistra, corsie X distinte)', () => {
  const xml = build({
    nodes: [
      { id: 'sw1', type: 'switch', rackId: 'r1', rackU: 12, sizeU: 1, ports: 24, name: 'A' },
      { id: 'sw2', type: 'switch', rackId: 'r1', rackU: 6, sizeU: 1, ports: 24, name: 'B' },
      { id: 'srv1', type: 'server', rackId: 'r1', rackU: 1, sizeU: 2, name: 'S' },
    ],
    links: [
      { id: 'La', src: 'sw1-1', dst: 'srv1-1' },   // range Y alto..basso
      { id: 'Lb', src: 'sw2-1', dst: 'srv1-2' },   // range Y sovrapposto ad La (condividono srv1)
    ],
  });
  const eA = cellOf(xml, 'cbl_La'), eB = cellOf(xml, 'cbl_Lb');
  // 2 waypoint a X di corsia (instradato a corsia, non porta-porta diretto)
  assert.match(eA, /<Array as="points"><mxPoint x="[\d.-]+" y="[\d.-]+"\/><mxPoint x="[\d.-]+" y="[\d.-]+"\/><\/Array>/);
  assert.match(eA, /exitX=0;exitY=0.5/);        // esce dal lato sinistro della porta
  assert.match(eA, /entryX=0;entryY=0.5/);
  // corsie: cavi con Y sovrapposti -> X di corsia DIVERSE (nessuna sovrapposizione)
  const laneX = e => +(e.match(/<mxPoint x="([\d.-]+)"/)[1]);
  assert.notEqual(laneX(eA), laneX(eB));
  assert.ok(laneX(eA) < 40 && laneX(eB) < 40);
  // SFALSAMENTO: entrambi i cavi toccano srv1 sul lato dst -> entryDy diversi
  const entryDy = e => +(e.match(/entryDy=([\d.-]+)/)[1]);
  assert.notEqual(entryDy(eA), entryDy(eB));
});

test('cavi: device DENSO -> passo verticale MIN garantito (niente blocco compatto, sfora l\'altezza)', () => {
  // sw1 sorgente di 12 cavi (4 -> srv1, 8 -> pp1): dentro 1U (h=29) non ci stanno con
  // gap decente -> il passo scende al MIN garantito e il ventaglio esce dai bordi.
  const links = [];
  for (let i = 1; i <= 4; i++) links.push({ id: 'cA' + i, src: 'sw1-' + i, dst: 'srv1-' + i });
  for (let i = 1; i <= 8; i++) links.push({ id: 'cB' + i, src: 'sw1-' + (i + 4), dst: 'pp1-' + i });
  const xml = build({
    nodes: [
      { id: 'sw1',  type: 'switch',     rackId: 'r1', rackU: 12, sizeU: 1, ports: 24, name: 'Core' },
      { id: 'srv1', type: 'server',     rackId: 'r1', rackU: 1,  sizeU: 2, ports: 4,  name: 'ESX' },
      { id: 'pp1',  type: 'patchpanel', rackId: 'r1', rackU: 4,  sizeU: 2, ports: 24, name: 'PP' },
    ],
    links,
  });
  assert.equal((xml.match(/edge="1"/g) || []).length, 12);   // un arco per cavo
  const dys = links
    .map(l => cellOf(xml, 'cbl_' + l.id).match(/exitDy=([\d.-]+)/)[1])
    .map(Number).sort((a, b) => a - b);
  assert.equal(new Set(dys).size, dys.length);               // ogni cavo a Y di uscita distinta
  for (let i = 1; i < dys.length; i++) assert.ok(dys[i] - dys[i - 1] >= 4 - 1e-6, 'gap >= H_STAGGER_MIN');
  assert.ok(dys[dys.length - 1] - dys[0] > 25, 'spread oltre l\'altezza device');
});

test('cavi: un layer per VLAN nominato col nome VLAN; ogni cavo sul suo layer', () => {
  const xml = build({
    links: [
      { id: 'La', src: 'sw1-1', dst: 'srv1-1', vlan: 10 },
      { id: 'Lb', src: 'sw1-2', dst: 'srv1-2', vlan: 20 },
      { id: 'Lc', src: 'sw1-3', dst: 'srv1-3', vlan: 10 },
    ],
    helpers: {
      types: TYPES,
      linkVlan: l => l.vlan,
      vlanName: vid => ({ 10: 'Voce', 20: 'Dati' }[vid] || ''),
    },
  });
  assert.match(xml, /<mxCell id="cbl_v10_r1" value="Voce" parent="0" visible="0"\/>/);
  assert.match(xml, /<mxCell id="cbl_v20_r1" value="Dati" parent="0" visible="0"\/>/);
  assert.doesNotMatch(xml, /value="Cavi"/);   // niente layer generico quando c'e' la VLAN
  assert.match(cellOf(xml, 'cbl_La'), /parent="cbl_v10_r1"/);
  assert.match(cellOf(xml, 'cbl_Lb'), /parent="cbl_v20_r1"/);
  assert.match(cellOf(xml, 'cbl_Lc'), /parent="cbl_v10_r1"/);
});

test('cavi: VLAN senza nome -> layer "VLAN <id>"', () => {
  const xml = build({
    links: [{ id: 'Lx', src: 'sw1-1', dst: 'srv1-1', vlan: 99 }],
    helpers: { types: TYPES, linkVlan: l => l.vlan, vlanName: () => '' },
  });
  assert.match(xml, /<mxCell id="cbl_v99_r1" value="VLAN 99" parent="0" visible="0"\/>/);
  assert.match(cellOf(xml, 'cbl_Lx'), /parent="cbl_v99_r1"/);
});

test('cavi: capo fuori pagina o su altro rack NON disegnato (niente archi penzolanti ne tabella)', () => {
  const xml = build({
    links: [
      { id: 'Lx', src: 'sw1-1', dst: 'ZZZ-9' },   // dst inesistente
      { id: 'Ly', src: 'sw9-1', dst: 'srv1-1' },  // src su un device di un altro rack
    ],
  });
  assert.doesNotMatch(xml, /edge="1"/);          // nessun cavo
  assert.doesNotMatch(xml, /<UserObject/);       // nessuna riga tabella
  assert.doesNotMatch(xml, /cbl_layer_/);        // nessun link valido -> nessun layer
});

test('cavi: link verso una porta NASCOSTA non produce arco', () => {
  const xml = build({
    ports: { 'sw1-5': { hidden: true } },
    links: [{ id: 'Lh', src: 'sw1-5', dst: 'srv1-1' }],
  });
  assert.doesNotMatch(xml, /edge="1"/);
  assert.doesNotMatch(xml, /cbl_layer_/);
});

test('cavi: nessun link -> nessun layer, base 0/1 invariata', () => {
  const xml = build();
  assert.doesNotMatch(xml, /cbl_layer_/);
  assert.doesNotMatch(xml, /edge="1"/);
  assert.match(xml, /<mxCell id="0"\/><mxCell id="1" parent="0"\/>/);
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

test('ZERO artefatti anche con cavi + TABELLE per VLAN (righe = UserObject html=0)', () => {
  const xml = build({
    links: [
      { id: 'La', src: 'sw1-1', dst: 'srv1-1', vlan: 10 },
      { id: 'Lb', src: 'sw1-2', dst: 'srv1-2', vlan: 20 },
    ],
    helpers: { types: TYPES, linkVlan: l => l.vlan, vlanName: vid => ({ 10: 'Voce', 20: 'Dati' }[vid] || '') },
  });
  assert.doesNotMatch(xml, /foreignObject/i);
  assert.doesNotMatch(xml, /whiteSpace=wrap/);
  assert.doesNotMatch(xml, /html=1/);
  assert.doesNotMatch(xml, /<image\b/);
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
