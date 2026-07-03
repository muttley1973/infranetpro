// Test end-to-end del parsing SNMP: extractData() trasforma una mappa di
// varbind {oid: Buffer} in { hostname, interfaces, lags, vlans }.
// Riproduce in particolare il bug ArubaCX: dot3adAggPortListPorts come
// LISTA TESTUALE di nomi porta (non bitmap) -> i membri devono ricevere il
// lagId LOGICO dell'aggregatore (es. lag1 -> 1), non l'ifIndex.

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractData, OID } = require('../drivers/snmp.js')._internals;

// Helper: costruisce la chiave OID "<base>.<index>"
const at = (base, idx) => `${base}.${idx}`;
const u32 = n => Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);

test('extractData: ENTITY-MIB popola inventario hardware primario', () => {
  const vbs = {
    [at(OID.sysName, 0)]: Buffer.from('sw-entity', 'utf8'),
    [at(OID.entPhysicalDescr, 1)]: Buffer.from('Cisco Catalyst 9300-48P', 'utf8'),
    [at(OID.entPhysicalClass, 1)]: u32(3),
    [at(OID.entPhysicalMfgName, 1)]: Buffer.from('Cisco', 'utf8'),
    [at(OID.entPhysicalModelName, 1)]: Buffer.from('C9300-48P', 'utf8'),
    [at(OID.entPhysicalSerialNum, 1)]: Buffer.from('FOC1234ABCD', 'utf8'),
    [at(OID.entPhysicalSoftwareRev, 1)]: Buffer.from('IOS-XE 17.9.5', 'utf8'),
    [at(OID.entPhysicalDescr, 20)]: Buffer.from('Power Supply 1', 'utf8'),
    [at(OID.entPhysicalClass, 20)]: u32(6),
    [at(OID.entPhysicalSerialNum, 20)]: Buffer.from('PSU999', 'utf8'),
  };

  const r = extractData(vbs);

  assert.equal(r.inventory.brand, 'Cisco');
  assert.equal(r.inventory.model, 'C9300-48P');
  assert.equal(r.inventory.serialNumber, 'FOC1234ABCD');
  assert.equal(r.inventory.firmwareVer, 'IOS-XE 17.9.5');
  assert.equal(r.inventory.source, 'ENTITY-MIB');
  assert.equal(r.inventory.entityIndex, 1);
  assert.ok(r.inventory.entities.length >= 2);
});

test('extractData: vmVlan (CISCO-VLAN-MEMBERSHIP-MIB) come fallback VLAN access', () => {
  // Alcune immagini (es. Cisco vIOS) non popolano dot1qPvid con la VLAN access reale;
  // espongono pero' vmVlan (indicizzato per ifIndex). Standard-first: vmVlan riempie
  // SOLO dove il PVID standard manca o resta 1, e solo se da' una VLAN reale (>1).
  const vbs = {
    [at(OID.sysName, 0)]: Buffer.from('sw-vm', 'utf8'),
    [at(OID.ifDescr, 5)]: Buffer.from('GigabitEthernet0/5', 'utf8'),
    [at(OID.ifType, 5)]: u32(6),
    [at(OID.ifOperStatus, 5)]: u32(1),
    [at(OID.vmVlan, 5)]: u32(30),           // VLAN access via CISCO-VLAN-MEMBERSHIP-MIB
    // if 6: vmVlan=1 (default) -> NON deve forzare una VLAN (fallback solo per >1)
    [at(OID.ifDescr, 6)]: Buffer.from('GigabitEthernet0/6', 'utf8'),
    [at(OID.ifType, 6)]: u32(6),
    [at(OID.ifOperStatus, 6)]: u32(1),
    [at(OID.vmVlan, 6)]: u32(1),
    // niente dot1qPvid -> la VLAN access di Gi0/5 viene dal fallback vmVlan
  };
  const r = extractData(vbs);
  const gi5 = r.interfaces.find(i => i.name === 'GigabitEthernet0/5');
  assert.ok(gi5, 'interfaccia Gi0/5 presente');
  assert.equal(gi5.vlan, 30, 'la VLAN access viene da vmVlan quando dot1qPvid manca');
  const gi6 = r.interfaces.find(i => i.name === 'GigabitEthernet0/6');
  assert.notEqual(gi6 && gi6.vlan, 30, 'vmVlan=1 (default) non inventa una VLAN access');
});

test('extractData: switch base — hostname, porta fisica, LAG aggregatore', () => {
  const vbs = {
    [at(OID.sysName, 0)]: Buffer.from('sw-fixture', 'utf8'),
    // if 1: porta fisica Gigabit up @1G con MAC reale
    [at(OID.ifDescr, 1)]: Buffer.from('GigabitEthernet0/1', 'utf8'),
    [at(OID.ifType, 1)]: u32(6),                       // ethernetCsmacd
    [at(OID.ifPhysAddress, 1)]: Buffer.from([0xaa, 0xbb, 0xcc, 0x11, 0x22, 0x33]),
    [at(OID.ifOperStatus, 1)]: u32(1),                 // up
    [at(OID.ifSpeed, 1)]: u32(1000000000),             // 1 Gbps -> 1000 Mbps
    // if 10: aggregatore LAG (ifType=161)
    [at(OID.ifDescr, 10)]: Buffer.from('Port-channel1', 'utf8'),
    [at(OID.ifType, 10)]: u32(161),
  };

  const r = extractData(vbs);

  assert.equal(r.hostname, 'sw-fixture');

  const gi = r.interfaces.find(i => i.name === 'GigabitEthernet0/1');
  assert.ok(gi, 'la porta fisica deve essere in interfaces');
  assert.equal(gi.speed, 1000);
  assert.equal(gi.operStatus, 1);
  assert.equal(gi.mac, 'aa:bb:cc:11:22:33');

  const lag = r.lags.find(l => l.name === 'Port-channel1');
  assert.ok(lag, 'l aggregatore (ifType=161) deve finire in lags');
});

test('extractData: LAG via lista NOMI porta (ArubaCX) -> membri con lagId logico', () => {
  // dot3adAggPortListPorts contiene "1/1/1,1/1/2,1/1/3" come ASCII, non bitmap.
  const aggIfIndex = 100;
  const vbs = {
    [at(OID.sysName, 0)]: Buffer.from('aruba-cx', 'utf8'),
    // aggregatore "lag1"
    [at(OID.ifDescr, aggIfIndex)]: Buffer.from('lag1', 'utf8'),
    [at(OID.ifType, aggIfIndex)]: u32(161),
  };
  // 3 porte membro fisiche con i nomi ArubaCX
  const members = { 1: '1/1/1', 2: '1/1/2', 3: '1/1/3' };
  for (const [idx, name] of Object.entries(members)) {
    vbs[at(OID.ifDescr, idx)] = Buffer.from(name, 'utf8');
    vbs[at(OID.ifType, idx)] = u32(6);
    vbs[at(OID.ifPhysAddress, idx)] = Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, Number(idx)]);
    vbs[at(OID.ifOperStatus, idx)] = u32(1);
  }
  // membership LAG come LISTA TESTUALE (il fix brand-agnostic la riconosce)
  vbs[at(OID.aggMemberPorts, aggIfIndex)] = Buffer.from('1/1/1,1/1/2,1/1/3', 'latin1');

  const r = extractData(vbs);

  // l'aggregatore deve essere classificato come LAG
  assert.ok(r.lags.find(l => l.name === 'lag1'), 'lag1 deve essere in lags');

  // i 3 membri devono riportare lagId LOGICO = 1 (da "lag1"), non l ifIndex 100
  for (const name of Object.values(members)) {
    const m = r.interfaces.find(i => i.name === name);
    assert.ok(m, `membro ${name} presente in interfaces`);
    assert.equal(m.lagId, 1, `${name} deve avere lagId logico 1`);
    assert.equal(m.lagIfIndex, aggIfIndex, `${name} deve puntare all ifIndex aggregatore`);
  }
});

// ── Modalita LACP auto-derivata dall'ActorState (.21) dei membri ─────────────
// Helper: costruisce un LAG a 2 membri (bitmap non serve, usiamo la lista nomi)
// con un ActorState assegnato a ciascun membro.
function _lagFixture(actorByMember) {
  const aggIfIndex = 100;
  const vbs = {
    [at(OID.sysName, 0)]: Buffer.from('sw', 'utf8'),
    [at(OID.ifDescr, aggIfIndex)]: Buffer.from('Po1', 'utf8'),
    [at(OID.ifType, aggIfIndex)]: u32(161),
  };
  const members = { 1: 'Gi0/1', 2: 'Gi0/2' };
  for (const [idx, name] of Object.entries(members)) {
    vbs[at(OID.ifDescr, idx)] = Buffer.from(name, 'utf8');
    vbs[at(OID.ifType, idx)] = u32(6);
    vbs[at(OID.ifPhysAddress, idx)] = Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, Number(idx)]);
    vbs[at(OID.ifOperStatus, idx)] = u32(1);
    if (actorByMember[idx] != null) vbs[at(OID.lagOperState, idx)] = Buffer.from([actorByMember[idx]]);
  }
  vbs[at(OID.aggMemberPorts, aggIfIndex)] = Buffer.from('Gi0/1,Gi0/2', 'latin1');
  return extractData(vbs);
}

test('extractData: LACP attivo → lag.mode=active (Aggregation+Activity nell ActorState)', () => {
  // 0x0D = Activity(0x01) + Aggregation(0x04) + Sync(0x08)
  const r = _lagFixture({ 1: 0x0D, 2: 0x0D });
  const lag = r.lags.find(l => l.name === 'Po1');
  assert.equal(lag.mode, 'active');
});

test('extractData: LACP passivo → lag.mode=passive (Aggregation senza Activity)', () => {
  // 0x0C = Aggregation(0x04) + Sync(0x08), Activity=0
  const r = _lagFixture({ 1: 0x0C, 2: 0x0C });
  const lag = r.lags.find(l => l.name === 'Po1');
  assert.equal(lag.mode, 'passive');
});

test('extractData: nessun ActorState → nessuna modalita (statico/non esposto = manuale)', () => {
  const r = _lagFixture({ 1: null, 2: null });
  const lag = r.lags.find(l => l.name === 'Po1');
  assert.ok(!('mode' in lag), 'senza evidenza LACP la modalita NON va inventata');
});

test('extractData: ActorState senza Aggregation → nessuna modalita (LACP non in gestione)', () => {
  // 0x01 = solo Activity, ma senza Aggregation non consideriamo LACP attiva
  const r = _lagFixture({ 1: 0x01, 2: 0x01 });
  const lag = r.lags.find(l => l.name === 'Po1');
  assert.ok(!('mode' in lag), 'senza Aggregation non etichettiamo la modalita');
});

test('extractData: una PortList BINARIA non viene scambiata per lista nomi', () => {
  // Bitmap reale (non ASCII stampabile come nomi porta validi): deve NON
  // produrre membri via name-list. Verifica che il ramo bitmap non crashi.
  const vbs = {
    [at(OID.sysName, 0)]: Buffer.from('sw-bin', 'utf8'),
    [at(OID.ifDescr, 50)]: Buffer.from('Po1', 'utf8'),
    [at(OID.ifType, 50)]: u32(161),
    [at(OID.aggMemberPorts, 50)]: Buffer.from([0x00, 0x00, 0x80]), // bitmap, bridge port 17
  };
  const r = extractData(vbs);
  assert.ok(r.lags.find(l => l.name === 'Po1'));
  // nessun crash, nessun membro inventato dai byte binari
  assert.equal(r.interfaces.filter(i => i.lagId > 0).length, 0);
});

// ---- Scalari di sistema universali (sysLocation/sysContact/sysUpTime) -------
const { extractSystem, _formatUptime } = require('../drivers/snmp.js')._internals;

test('extractSystem: estrae sysLocation/sysContact/sysUpTime/sysDescr', () => {
  const vbs = {
    [at(OID.sysName, 0)]:     Buffer.from('nas-1', 'utf8'),
    [at(OID.sysDescr, 0)]:    Buffer.from('Linux nas-1 5.10 #1 SMP x86_64', 'utf8'),
    [at(OID.sysLocation, 0)]: Buffer.from('Camera', 'utf8'),
    [at(OID.sysContact, 0)]:  Buffer.from('admin@azienda.local', 'utf8'),
    // 12 giorni 4 ore 30 min in TimeTicks (centesimi di secondo)
    [at(OID.sysUpTime, 0)]:   u32(((12 * 86400) + (4 * 3600) + (30 * 60)) * 100),
  };
  const sy = extractSystem(vbs);
  assert.equal(sy.sysLocation, 'Camera');
  assert.equal(sy.sysContact, 'admin@azienda.local');
  assert.equal(sy.sysDescr, 'Linux nas-1 5.10 #1 SMP x86_64');
  assert.equal(sy.sysUpTimeText, '12d 4h 30m');
  assert.ok(sy.sysUpTimeTicks > 0);
});

test('extractSystem: ritorna null quando l agente non espone scalari di sistema', () => {
  const vbs = { [at(OID.sysName, 0)]: Buffer.from('sw', 'utf8') }; // sysName non è in system
  assert.equal(extractSystem(vbs), null);
});

test('extractData: include system con i campi quick-win', () => {
  const vbs = {
    [at(OID.sysName, 0)]:     Buffer.from('sw-sys', 'utf8'),
    [at(OID.sysLocation, 0)]: Buffer.from('Rack A1', 'utf8'),
  };
  const r = extractData(vbs);
  assert.ok(r.system, 'extractData deve esporre system');
  assert.equal(r.system.sysLocation, 'Rack A1');
});

test('_formatUptime: d/h/m, omette giorni/ore se zero', () => {
  assert.equal(_formatUptime(0), '0m');
  assert.equal(_formatUptime(45 * 60 * 100), '45m');
  assert.equal(_formatUptime((2 * 3600 + 5 * 60) * 100), '2h 5m');
  assert.equal(_formatUptime((3 * 86400) * 100), '3d 0h 0m');
});

// ---- Printer-MIB (RFC 3805): toner %, contapagine, stato -------------------
// Fixture dai valori REALI letti dalla HP OfficeJet 8715 (192.168.1.13).
const { _supplyColorKey, PRT_OID } = require('../drivers/snmp.js')._internals;

test('extractPrinter: HP OfficeJet — toner CMYK %, contapagine, stato idle', () => {
  const P = PRT_OID;
  const vbs = {
    [at(OID.sysName, 0)]: Buffer.from('hp-officejet', 'utf8'),
    [at(P.prtColorantVal, 1)]: Buffer.from('cyan ink', 'utf8'),
    [at(P.prtColorantVal, 2)]: Buffer.from('magenta ink', 'utf8'),
    [at(P.prtColorantVal, 3)]: Buffer.from('yellow ink', 'utf8'),
    [at(P.prtColorantVal, 4)]: Buffer.from('black ink', 'utf8'),
    [at(P.prtSupplyColorant, 1)]: u32(1), [at(P.prtSupplyColorant, 2)]: u32(2),
    [at(P.prtSupplyColorant, 3)]: u32(3), [at(P.prtSupplyColorant, 4)]: u32(4),
    [at(P.prtSupplyType, 1)]: u32(5), [at(P.prtSupplyType, 2)]: u32(5),
    [at(P.prtSupplyType, 3)]: u32(5), [at(P.prtSupplyType, 4)]: u32(5),
    [at(P.prtSupplyDesc, 1)]: Buffer.from('cyan ink HP F6U20A', 'utf8'),
    [at(P.prtSupplyMax, 1)]: u32(298), [at(P.prtSupplyMax, 2)]: u32(299),
    [at(P.prtSupplyMax, 3)]: u32(299), [at(P.prtSupplyMax, 4)]: u32(845),
    [at(P.prtSupplyLevel, 1)]: u32(134), [at(P.prtSupplyLevel, 2)]: u32(278),
    [at(P.prtSupplyLevel, 3)]: u32(143), [at(P.prtSupplyLevel, 4)]: u32(718),
    [`${P.prtLifeCount}.1.1`]: u32(2939),
    [at(P.hrPrinterStatus, 1)]: u32(3),
  };
  const r = extractData(vbs);
  assert.ok(r.printer, 'extractData deve esporre printer');
  assert.equal(r.printer.pageCount, 2939);
  assert.equal(r.printer.status, 'idle');
  assert.equal(r.printer.supplies.length, 4);
  const cyan = r.printer.supplies.find(s => s.color === 'cyan');
  assert.equal(cyan.pct, 45);  // 134/298
  assert.equal(cyan.name, 'cyan ink');
  assert.equal(r.printer.supplies.find(s => s.color === 'black').pct, 85); // 718/845
});

test('extractPrinter: livello speciale (-2/-3) → pct assente, scarico marcato isWaste', () => {
  const P = PRT_OID;
  const vbs = {
    [at(P.prtSupplyDesc, 1)]: Buffer.from('waste ink tank', 'utf8'),
    [at(P.prtSupplyType, 1)]: u32(4),   // wasteToner
    [at(P.prtSupplyMax, 1)]: -2,        // illimitato
    [at(P.prtSupplyLevel, 1)]: -3,      // "resta qualcosa"
  };
  const r = extractData(vbs);
  const w = r.printer.supplies[0];
  assert.equal(w.pct, undefined, 'nessuna percentuale per valori speciali');
  assert.equal(w.isWaste, true);
});

test('extractPrinter: non-stampante → printer null', () => {
  assert.equal(extractData({ [at(OID.sysName, 0)]: Buffer.from('sw', 'utf8') }).printer, null);
});

test('_supplyColorKey: deriva CMYK da nome/descrizione', () => {
  assert.equal(_supplyColorKey('black ink HP F6U23A'), 'black');
  assert.equal(_supplyColorKey('Ciano'), 'cyan');
  assert.equal(_supplyColorKey('Tn-512 Magenta'), 'magenta');
  assert.equal(_supplyColorKey('drum unit'), 'other');
});

// ---- HOST-RESOURCES (RFC 2790): CPU / RAM / dischi -------------------------
// Fixture dai valori REALI del Synology NAS (192.168.1.120): 4 core, RAM 99%,
// più la fuffa Linux/NAS da filtrare (tmpfs, bind-mount /volume1/@docker…).
const { HR_OID, _isPathPrefix } = require('../drivers/snmp.js')._internals;

test('extractHostResources: Synology — CPU media, RAM %, volumi filtrati e dedotti', () => {
  const H = HR_OID;
  const typeOid = code => `1.3.6.1.2.1.25.2.1.${code}`; // valore = OID del tipo storage
  const vbs = {
    [at(OID.sysName, 0)]: Buffer.from('nas', 'utf8'),
    // 4 processori al 3% → media 3, 4 core
    [`${H.hrProcessorLoad}.196608`]: u32(3), [`${H.hrProcessorLoad}.196609`]: u32(3),
    [`${H.hrProcessorLoad}.196610`]: u32(3), [`${H.hrProcessorLoad}.196611`]: u32(3),
    // RAM (idx 1)
    [at(H.hrStorageType, 1)]: typeOid(2), [at(H.hrStorageDescr, 1)]: Buffer.from('Physical memory', 'utf8'),
    [at(H.hrStorageUnits, 1)]: u32(1024), [at(H.hrStorageSize, 1)]: u32(12105740), [at(H.hrStorageUsed, 1)]: u32(11958964),
    // pseudo-fs da scartare: /run (tmpfs)
    [at(H.hrStorageType, 38)]: typeOid(4), [at(H.hrStorageDescr, 38)]: Buffer.from('/run', 'utf8'),
    [at(H.hrStorageUnits, 38)]: u32(4096), [at(H.hrStorageSize, 38)]: u32(1513217), [at(H.hrStorageUsed, 38)]: u32(100),
    // volume reale /volume1
    [at(H.hrStorageType, 56)]: typeOid(4), [at(H.hrStorageDescr, 56)]: Buffer.from('/volume1', 'utf8'),
    [at(H.hrStorageUnits, 56)]: u32(4096), [at(H.hrStorageSize, 56)]: u32(1000000), [at(H.hrStorageUsed, 56)]: u32(250000),
    // bind-mount duplicato (stessa size+used, path figlio) → va dedotto via
    [at(H.hrStorageType, 60)]: typeOid(4), [at(H.hrStorageDescr, 60)]: Buffer.from('/volume1/@docker', 'utf8'),
    [at(H.hrStorageUnits, 60)]: u32(4096), [at(H.hrStorageSize, 60)]: u32(1000000), [at(H.hrStorageUsed, 60)]: u32(250000),
    // root "/" (volume reale piccolo, dimensione diversa → resta separato)
    [at(H.hrStorageType, 31)]: typeOid(4), [at(H.hrStorageDescr, 31)]: Buffer.from('/', 'utf8'),
    [at(H.hrStorageUnits, 31)]: u32(4096), [at(H.hrStorageSize, 31)]: u32(596382), [at(H.hrStorageUsed, 31)]: u32(244000),
  };
  const r = extractData(vbs);
  assert.ok(r.hostResources, 'extractData deve esporre hostResources');
  assert.equal(r.hostResources.cpuLoad, 3);
  assert.equal(r.hostResources.cpuCores, 4);
  assert.equal(r.hostResources.ram.pct, 99); // 11958964/12105740
  const vols = r.hostResources.volumes;
  const names = vols.map(v => v.name);
  assert.ok(!names.includes('/run'), 'pseudo-fs /run escluso');
  assert.ok(!names.includes('/volume1/@docker'), 'bind-mount duplicato dedotto');
  assert.ok(names.includes('/volume1') && names.includes('/'), 'restano i volumi reali');
  assert.equal(vols[0].name, '/volume1', 'ordinato per dimensione decrescente');
  assert.equal(vols.find(v => v.name === '/volume1').pct, 25); // 250000/1000000
});

test('extractHostResources: non-compute (solo sysName) → hostResources null', () => {
  assert.equal(extractData({ [at(OID.sysName, 0)]: Buffer.from('sw', 'utf8') }).hostResources, null);
});

test('_isPathPrefix: bind-mount sì, root "/" non assorbe, percorsi distinti no', () => {
  assert.equal(_isPathPrefix('/volume1', '/volume1/@docker'), true);
  assert.equal(_isPathPrefix('/', '/volume1'), false);   // root non è prefisso-assorbente
  assert.equal(_isPathPrefix('/data', '/datastore'), false); // non è confine di path
});
