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
  fiberdrawer:{ isRack: true, ports: 24, sizeU: 1 },
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

test('porte: lo spanning-tree in blocco disegna una diagonale (da H.stpBlocked)', () => {
  // In draw.io una porta è una scatola: il blocco è un mxCell «linea» a parte, da vertice a vertice.
  // Chi è bloccato lo dice H.stpBlocked (nel prodotto = lib/port-state.js sul campo della porta; i membri
  // di un Port-channel bloccato lo portano dal poll — v. test/export.test.js): qui lo stub ne blocca una
  // sola, e la diagonale compare solo su quella.
  const xml = build({
    helpers: { types: TYPES, hasSnmpIntegration: n => !!n.snmpStatus, stpBlocked: pid => pid === 'sw1-2' },
  });
  assert.match(xml, /id="sw1-2__stp"/, 'la porta bloccata ha la diagonale');
  assert.match(cellOf(xml, 'sw1-2__stp') || '', /strokeColor=#11161c/, 'la diagonale è scura come sul rack');
  assert.match(cellOf(xml, 'sw1-2__stp') || '', /edge="1"/, 'è una linea, non una scatola');
  assert.doesNotMatch(xml, /id="sw1-1__stp"/, 'una porta non bloccata non porta il segno');
});

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
      'sw1-4': { statusOvr: 'inactive', status: 'active' },  // override vince
    },
  });
  assert.match(cellOf(xml, 'sw1-1'), /fillColor=#39d353/);
  assert.match(cellOf(xml, 'sw1-2'), /fillColor=#f85149/);
  assert.match(cellOf(xml, 'sw1-3'), /fillColor=#00d4ff/);
  assert.match(cellOf(xml, 'sw1-4'), /fillColor=#6e7681/);
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
      { id: 'L2', src: 'sw1-3', dst: 'srv1-4', colorOvr: '#39d353' },
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

test('cavi: il colore del cavo (`color`, un dato del DCIM) non dipinge l\'arco: lo fa solo `colorOvr`', () => {
  // Stessa regola della mappa: la linea ha il colore che una persona ha scelto per lei, non quello
  // che NetBox sa della guaina.
  const xml = build({ links: [{ id: 'L1', src: 'sw1-1', dst: 'srv1-2', color: '#2196f3' }] });
  assert.match(cellOf(xml, 'cbl_L1'), /strokeColor=#9aa5b1/);
  assert.doesNotMatch(cellOf(xml, 'cbl_L1'), /#2196f3/);
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

// ── Porte spente a mano / senza link (lib/port-state.js) ────────────────────
// Il diagramma esportato deve dire la STESSA cosa del rack a schermo. È la classe
// di bug più cara del progetto: due strati che colorano lo stesso concetto con
// criteri propri e col tempo divergono. Qui la regola arriva per iniezione
// (`helpers.portShade`), così il builder resta puro ma non se la riscrive.
const { portShade } = require('../lib/port-state.js');

test('draw.io: porta spenta a mano -> quasi nera, anche se il documento la dice attiva', () => {
  const xml = build({
    ports: {
      'sw1-1': { status: 'active', adminDown: true },   // shutdown misurato
      'sw1-2': { status: 'active' },                    // di controllo
    },
    helpers: { types: TYPES, portShade },
  });
  assert.match(cellOf(xml, 'sw1-1'), /#0a0d11/, 'la misura dello switch batte lo stato dichiarato');
  assert.match(cellOf(xml, 'sw1-2'), /#39d353/, 'la porta accanto resta verde');
});

test('draw.io: porta senza link da >=N verifiche -> grigio scuro', () => {
  const xml = build({
    ports: { 'sw1-1': { status: 'inactive', downStreak: 4 }, 'sw1-2': { status: 'inactive', downStreak: 1 } },
    helpers: { types: TYPES, portShade },
  });
  assert.match(cellOf(xml, 'sw1-1'), /#d29922/);
  assert.match(cellOf(xml, 'sw1-2'), /#6e7681/, 'un blip sotto soglia resta grigio neutro');
});

test('draw.io: la misura batte anche il ciano del LAG', () => {
  const xml = build({
    ports: { 'sw1-1': { status: 'active', lagGroup: 'lag1', adminDown: true } },
    helpers: { types: TYPES, portShade },
  });
  assert.match(cellOf(xml, 'sw1-1'), /#0a0d11/);
  assert.doesNotMatch(cellOf(xml, 'sw1-1'), /#00d4ff/);
});

test('draw.io: manual-first — se l\'utente ha dichiarato lo stato, la misura non lo riscrive', () => {
  const xml = build({
    ports: { 'sw1-1': { adminDown: true, statusOvr: 'active' } },
    helpers: { types: TYPES, portShade },
  });
  assert.match(cellOf(xml, 'sw1-1'), /#39d353/);
});

test('draw.io: senza portShade iniettato il diagramma perde i grigi ma non ne inventa altri', () => {
  // Degrado esplicito: un chiamante vecchio non deve produrre colori a caso.
  const xml = build({ ports: { 'sw1-1': { status: 'active', adminDown: true } } });
  assert.match(cellOf(xml, 'sw1-1'), /#39d353/);
  assert.doesNotMatch(xml, /#0a0d11/);
});

// ── Il cassetto ottico: slot verticali coi fori, come il rack dal vivo e il PDF ─────────────────────────────────
// La geometria (dove sta ogni slot, cella e foro) la decide lib/fiber-slot.js e arriva come helper iniettato
// `fiberFront` — questa lib emette soltanto celle native. Qui l'helper e' composto con le lib vere, come fa la glue
// di export.js (provata in test/export-fiberdrawer.test.js).
const FS = require('../lib/fiber-slot.js');
const FP = require('../lib/frontpanel.js');
const fiberFront = (n, sizeU, box, hidden) => {
  const fp = FP.frontPanelState(n, n.ports !== undefined ? n.ports : 24, false);
  return FS.fiberFront(n, { portCount: fp.portCount, baseLayout: fp.baseLayout, sizeU, box, hidden });
};
const drawer = (over) => Object.assign({ id: 'fd1', type: 'fiberdrawer', rackId: 'r1', rackU: 12, sizeU: 1, ports: 24, name: 'FD-1',
  spec: { ppFiberConnector: 'lc-duplex' } }, over || {});
const fdBuild = (node, over) => build(Object.assign({ nodes: [node],
  helpers: { types: TYPES, fiberFront } }, over || {}));
const geom = (cell) => { const m = /<mxGeometry x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(cell); return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] }; };

test('cassetto: ogni porta e una scatola VERTICALE con id = pid, due fori ellittici sopra (LC duplex)', () => {
  const xml = fdBuild(drawer());
  for (let i = 1; i <= 24; i++) {
    const g = geom(cellOf(xml, 'fd1-' + i));
    assert.ok(g.h > g.w, `la porta ${i} e uno slot in piedi, non un quadrato (${g.w} x ${g.h})`);
    assert.match(cellOf(xml, 'fd1-' + i), /parent="fd1"/);
    assert.match(cellOf(xml, `fd1-${i}__h0`), /^<mxCell [^>]*style="ellipse;fillColor=#0b0f14;strokeColor=none;connectable=0;"/);
    assert.ok(cellOf(xml, `fd1-${i}__h1`), 'il secondo foro');
    assert.equal(cellOf(xml, `fd1-${i}__h2`), null, 'LC duplex = due fori');
  }
  assert.equal((xml.match(/style="ellipse/g) || []).length, 48);
  // ogni cella ha un id suo: niente porte disegnate due volte (slot e LED insieme)
  const ids = xml.match(/<mxCell id="[^"]*"/g) || [];
  assert.equal(new Set(ids).size, ids.length, 'id di cella tutti diversi');
  assert.equal((xml.match(/<mxCell id="fd1-\d+"/g) || []).length, 24);
});

test('cassetto: slot e fori stanno dentro la faccia del device, e i fori dentro il loro slot', () => {
  const xml = fdBuild(drawer({ ports: 48, spec: { ppFiberConnector: 'lc-quad' } }));
  const dev = geom(cellOf(xml, 'fd1'));
  for (let i = 1; i <= 48; i++) {
    const g = geom(cellOf(xml, 'fd1-' + i));
    assert.ok(g.x >= 0 && g.y >= 0 && g.x + g.w <= dev.w + 0.01 && g.y + g.h <= dev.h + 0.01, `porta ${i} dentro la faccia`);
    assert.ok(g.x + g.w <= 260 - 56 + 0.01, `porta ${i}: la riserva del nome (56) resta libera, come per le porte generate`);
    for (const k of [0, 1]) {
      const h = geom(cellOf(xml, `fd1-${i}__h${k}`));
      assert.ok(h.x >= g.x - 0.01 && h.y >= g.y - 0.01 && h.x + h.w <= g.x + g.w + 0.01 && h.y + h.h <= g.y + g.h + 0.01, `foro ${k} della porta ${i} dentro lo slot`);
      assert.ok(Math.abs((h.x + h.w / 2) - (g.x + g.w / 2)) < 0.03, `foro ${k} della porta ${i} al centro dello slot (un'ellisse e posizionata dall'angolo, non dal centro)`);
    }
  }
});

test('cassetto: SC un foro, MPO una bocca rettangolare con la ferrula, non dichiarato nessun foro', () => {
  const sc = fdBuild(drawer({ spec: { ppFiberConnector: 'sc' } }));
  assert.equal((sc.match(/style="ellipse/g) || []).length, 24);
  assert.equal(cellOf(sc, 'fd1-1__h1'), null);
  const mpo = fdBuild(drawer({ spec: { ppFiberConnector: 'mpo-12' } }));
  assert.equal((mpo.match(/style="ellipse/g) || []).length, 0, 'l\'MPO non ha fori tondi');
  assert.match(cellOf(mpo, 'fd1-1__h0'), /rounded=1;arcSize=\d+;fillColor=#0b0f14/);
  assert.match(cellOf(mpo, 'fd1-1__h1'), /fillColor=#4b5563/, 'la ferrula MT, piu chiara');
  const none = fdBuild(drawer({ spec: {} }));
  assert.equal((none.match(/style="ellipse/g) || []).length, 0);
  assert.ok(cellOf(none, 'fd1-1'), 'ma lo slot c\'e');
});

test('cassetto: il colore dello slot e quello della porta (stato, LAG), i fori non lo cambiano', () => {
  const xml = fdBuild(drawer(), { ports: { 'fd1-1': { status: 'active' }, 'fd1-2': { status: 'fault' }, 'fd1-3': { lagGroup: 'g' } } });
  assert.match(cellOf(xml, 'fd1-1'), /fillColor=#39d353/);
  assert.match(cellOf(xml, 'fd1-2'), /fillColor=#f85149/);
  assert.match(cellOf(xml, 'fd1-3'), /fillColor=#00d4ff/);
  assert.match(cellOf(xml, 'fd1-4'), /fillColor=#6e7681/, 'non dichiarata: grigio');
});

test('cassetto: porta nascosta = nessuna cella ne fori, e il cavo verso di lei non produce arco', () => {
  const xml = fdBuild(drawer(), {
    nodes: [drawer(), { id: 'sw1', type: 'switch', rackId: 'r1', rackU: 8, ports: 24, name: 'SW' }],
    ports: { 'fd1-4': { hidden: true } },
    links: [{ id: 'L1', src: 'fd1-4', dst: 'sw1-1' }, { id: 'L2', src: 'fd1-5', dst: 'sw1-2' }],
  });
  assert.equal(cellOf(xml, 'fd1-4'), null);
  assert.equal(cellOf(xml, 'fd1-4__h0'), null);
  assert.ok(cellOf(xml, 'fd1-5'));
  assert.equal(cellOf(xml, 'cbl_L1'), null, 'verso una porta nascosta: niente arco penzolante');
  assert.match(cellOf(xml, 'cbl_L2'), /source="fd1-5"/, 'un cavo su una porta del cassetto si aggancia alla sua cella');
});

test('cassetto: lo spanning-tree in blocco disegna la diagonale sulla porta bloccata, solo su quella', () => {
  const xml = fdBuild(drawer(), { helpers: { types: TYPES, fiberFront, stpBlocked: pid => pid === 'fd1-2' } });
  assert.match(cellOf(xml, 'fd1-2__stp') || '', /strokeColor=#11161c/);
  assert.doesNotMatch(xml, /id="fd1-1__stp"/);
});

test('cassetto: i numeri sotto gli slot dove c\'e posto (la faccia di draw.io e piu alta del 1U del PDF)', () => {
  const xml = fdBuild(drawer());
  const nums = xml.match(/id="fd1__num\d+"/g) || [];
  assert.equal(nums.length, 24);
  assert.match(cellOf(xml, 'fd1__num1'), /value="1"/);
  assert.match(cellOf(xml, 'fd1__num1'), /^<mxCell [^>]*style="text;html=0;/);
  // il quad: il numero e quello della PRIMA porta di ogni slot
  const q = fdBuild(drawer({ ports: 48, spec: { ppFiberConnector: 'lc-quad' } }));
  assert.match(cellOf(q, 'fd1__num2'), /value="3"/);
});

test('cassetto composto: lastra cieca e cella senza porta sono scatole scure senza id di porta', () => {
  const xml = fdBuild(drawer({ ports: 5, spec: { ppFiberConnector: 'lc-duplex', fdSlots: ['lc-duplex', 'blank', 'lc-quad', 'mpo-12'] } }),
    { ports: { 'fd1-3': { hidden: true } } });
  assert.ok(cellOf(xml, 'fd1__plate2'), 'la lastra e il secondo slot');
  assert.match(cellOf(xml, 'fd1__plate2'), /fillColor=#1a1a1a/);
  assert.ok(cellOf(xml, 'fd1-2') && cellOf(xml, 'fd1-4'));
  assert.equal(cellOf(xml, 'fd1-3'), null, 'la cella nascosta del quad non e una porta');
  assert.match(xml, /id="fd1__empty3_1"/, 'ma resta vuota nello slot');
});

test('cassetto: senza l\'helper (chiamante vecchio) o se non si disegnano slot, vale il disegno di sempre', () => {
  const noHelper = build({ nodes: [drawer()], helpers: { types: TYPES } });
  assert.equal((noHelper.match(/style="ellipse/g) || []).length, 0);
  assert.equal((noHelper.match(/id="fd1-\d+"/g) || []).length, 24, 'le porte ci sono, come LED quadrati');
  const g = geom(cellOf(noHelper, 'fd1-1'));
  assert.equal(g.w, g.h, 'quadrato');
  // 25 slot a 1U non entrano: l'helper risponde null e si ripiega sul generico
  const tooMany = fdBuild(drawer({ ports: 25 }));
  assert.equal((tooMany.match(/style="ellipse/g) || []).length, 0);
  assert.equal((tooMany.match(/id="fd1-\d+"/g) || []).length, 25);
});

test('cassetto: 48 slot a 2U sono due file, e uno switch accanto resta com\'era', () => {
  const two = drawer({ ports: 48, sizeU: 2, spec: { ppFiberConnector: 'sc' } });
  const xml = fdBuild(two, { nodes: [two, { id: 'sw1', type: 'switch', rackId: 'r1', rackU: 6, ports: 24, name: 'SW' }] });
  const ys = new Set(Array.from({ length: 48 }, (_, i) => geom(cellOf(xml, 'fd1-' + (i + 1))).y));
  assert.equal(ys.size, 2, 'due file');
  assert.equal((xml.match(/style="ellipse/g) || []).length, 48, 'e sono slot coi fori, non LED: a 2U le U arrivano alla lib');
  assert.ok(geom(cellOf(xml, 'fd1-1')).h > geom(cellOf(xml, 'fd1-1')).w);
  const sw = geom(cellOf(xml, 'sw1-1'));
  assert.equal(sw.w, sw.h, 'il LED dello switch e ancora quadrato');
});

test('cassetto: ZERO artefatti anche con i fori (niente image, foreignObject, html=1, whiteSpace=wrap)', () => {
  const xml = fdBuild(drawer({ ports: 48, spec: { ppFiberConnector: 'lc-quad' } }));
  assert.doesNotMatch(xml, /shape=image|<image\b|foreignObject|whiteSpace=wrap|html=1/);
  assert.doesNotMatch(xml, /NaN|undefined|Infinity/);
});
