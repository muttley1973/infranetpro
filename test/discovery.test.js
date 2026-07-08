// Test di regressione per le funzioni pure di discovery in server.js.
// server.js avvia il listen solo con `require.main === module`, quindi qui
// (require) NON apre alcuna porta.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  _cleanHostname, _penFromObjectId, _vendorByObjectId, _decodeSysServices,
  _resolveSysObject, _resolveOsFingerprint, _classifyDiscoveredDevice, _buildDiscoveryMeta, _parseNetbiosOutput, _parseNetViewOutput,
} = require('../server.js')._internals;

test('_cleanHostname: trim e rimozione punto finale FQDN', () => {
  assert.equal(_cleanHostname('host.example.com.'), 'host.example.com');
  assert.equal(_cleanHostname('  sw1  '), 'sw1');
  assert.equal(_cleanHostname(null), '');
});

test('_penFromObjectId / _vendorByObjectId: PEN -> vendor', () => {
  assert.equal(_penFromObjectId('1.3.6.1.4.1.9.1.516'), 9);
  assert.equal(_penFromObjectId('1.3.6.1.2.1.1.1.0'), 0);   // non enterprise
  assert.equal(_penFromObjectId(''), 0);
  assert.equal(_vendorByObjectId('1.3.6.1.4.1.9.1.1'), 'Cisco');
  assert.equal(_vendorByObjectId('1.3.6.1.4.1.890.1.5.8'), 'Zyxel');
  assert.equal(_vendorByObjectId('1.3.6.1.4.1.2636.1.1'), 'Juniper');
  assert.equal(_vendorByObjectId('1.3.6.1.4.1.12356.101'), 'Fortinet');
  assert.equal(_vendorByObjectId('1.3.6.1.4.1.30065.1.1'), 'Arista'); // PEN Arista Networks
  assert.equal(_vendorByObjectId('1.3.6.1.4.1.99999.1'), ''); // sconosciuto
});

test('Arista EOS: PEN 30065 -> vendor + tipo switch (vEOS lab + hardware reale)', () => {
  // Il vEOS del lab presenta un MAC finto PNETLab (nessun OUI Arista) -> il vendor arriva
  // SOLO da SNMP (PEN 30065). Prima non usciva affatto: Arista era ignoto ovunque.
  assert.equal(_vendorByObjectId('1.3.6.1.4.1.30065.1.3011'), 'Arista');
  assert.equal(_classifyDiscoveredDevice({
    descr: 'Arista Networks EOS version 4.28.3M running on an Arista Networks vEOS',
    objectId: '1.3.6.1.4.1.30065.1.3011', snmpReachable: true, sysServices: 2, alive: true,
  }), 'switch');
});

test('_resolveSysObject: catalogo plugin arricchisce vendor/type', () => {
  const resolved = _resolveSysObject({
    objectId: '1.3.6.1.4.1.6574.1',
    descr: 'Synology DiskStation',
    hostname: 'nas-lab',
    sysServices: 72,
  });
  assert.equal(resolved.status, 'found');
  assert.equal(resolved.vendor, 'Synology');
  assert.equal(resolved.deviceType, 'nas');
  assert.equal(resolved.source.plugin, 'synology');
});

test('_resolveOsFingerprint: OS da segnali discovery senza sysObjectID', () => {
  const macos = _resolveOsFingerprint({ vendor: 'Apple', hostname: 'MacBook-Pro', alive: true });
  assert.equal(macos.os.family, 'macos');
  assert.equal(macos.deviceType, 'pc');

  const androidTv = _resolveOsFingerprint({ descr: 'Sony BRAVIA Android TV', alive: true });
  assert.equal(androidTv.os.family, 'android');
  assert.equal(androidTv.deviceType, 'tv');
});

test('_decodeSysServices: bitmask L1..L7', () => {
  assert.deepEqual(_decodeSysServices(2), { raw:2, l1:false, l2:true, l3:false, l4:false, l5:false, l6:false, l7:false });
  const l2l3 = _decodeSysServices(6); // 110b
  assert.equal(l2l3.l2, true); assert.equal(l2l3.l3, true); assert.equal(l2l3.l4, false);
  assert.equal(_decodeSysServices(64).l7, true);
  assert.equal(_decodeSysServices(0).raw, 0);
});

test('_classifyDiscoveredDevice: casi ad alta confidenza', () => {
  assert.equal(_classifyDiscoveredDevice({ objectId:'1.3.6.1.4.1.12356.101.1' }), 'firewall'); // Fortinet
  assert.equal(_classifyDiscoveredDevice({ objectId:'1.3.6.1.4.1.6574.1' }), 'nas');            // Synology
  assert.equal(_classifyDiscoveredDevice({ descr:'HP LaserJet Pro MFP' }), 'printer');
  assert.equal(_classifyDiscoveredDevice({ descr:'Cisco IOS Software, Catalyst 2960' }), 'switch');
  assert.equal(_classifyDiscoveredDevice({ descr:'FortiGate-60F firewall' }), 'firewall');
  // PC senza alcun segnale di gestione, hostname Windows
  assert.equal(_classifyDiscoveredDevice({ hostname:'DESKTOP-ABC123' }), 'pc');
});

test('_classifyDiscoveredDevice: elettrodomestici -> iot (brand-agnostic, EN+IT)', () => {
  assert.equal(_classifyDiscoveredDevice({ descr: 'LG ThinQ Washing Machine', vendor: 'LG Electronics' }), 'iot');
  assert.equal(_classifyDiscoveredDevice({ hostname: 'lavatrice-cucina', vendor: 'LG Electronics', alive: true }), 'iot');
  assert.equal(_classifyDiscoveredDevice({ descr: 'Bosch Home Connect dishwasher' }), 'iot');
  assert.equal(_classifyDiscoveredDevice({ vendor: 'Haier', descr: 'hOn washer' }), 'iot');
  assert.equal(_classifyDiscoveredDevice({ descr: 'Daikin air conditioner' }), 'iot');
  assert.equal(_classifyDiscoveredDevice({ hostname: 'shelly1-aabbcc', httpTitle: 'Shelly' }), 'iot');
  assert.equal(_classifyDiscoveredDevice({ descr: 'Samsung washer', httpTitle: 'SmartThings' }), 'iot');
});

test('_classifyDiscoveredDevice: TV guidata da OS/funzione, non dal brand', () => {
  assert.equal(_classifyDiscoveredDevice({ descr: 'LG webOS TV', vendor: 'LG Electronics' }), 'tv');
  assert.equal(_classifyDiscoveredDevice({ descr: 'Samsung Smart TV', httpTitle: 'Tizen' }), 'tv');
  assert.equal(_classifyDiscoveredDevice({ descr: 'Sony BRAVIA Android TV' }), 'tv');
  // TV Samsung che espone SmartThings resta TV (non iot): vince il segnale TV.
  assert.equal(_classifyDiscoveredDevice({ descr: 'Samsung Smart TV Tizen', httpTitle: 'SmartThings' }), 'tv');
  // Stesso brand della TV ma natura diversa -> NON deve diventare TV.
  assert.notEqual(_classifyDiscoveredDevice({ descr: 'LG ThinQ Washing Machine' }), 'tv');
});

test('_buildDiscoveryMeta: switch SNMP -> confidenza alta, snmp-managed', () => {
  const meta = _buildDiscoveryMeta({
    snmpReachable: true,
    descr: 'Cisco IOS Catalyst 2960',
    objectId: '1.3.6.1.4.1.9.1.516',
    mac: '00:11:22:33:44:55',
    hostname: 'sw-core',
    alive: true,
  });
  assert.equal(meta.deviceClass, 'switch');
  assert.equal(meta.manageability, 'snmp-managed');
  assert.equal(meta.confidence.level, 'high');
  assert.ok(meta.confidence.score >= 70);
  assert.ok(meta.sources.some(s => s.id === 'snmp'));
  assert.ok(meta.reasonCodes.includes('snmp-probe'));
  assert.ok(meta.reasonCodes.includes('sysobject-plugin'));
  assert.ok(meta.sources.some(s => s.id === 'sysobject'));
  // le sorgenti sono ordinate per forza: la prima deve essere "high"
  assert.equal(meta.sources[0].strength, 'high');
});

test('_buildDiscoveryMeta: vicino LLDP aggiunge sorgente/reason ad alto peso', () => {
  const meta = _buildDiscoveryMeta(
    { alive: true, mac: 'aa:bb:cc:dd:ee:ff' },
    { viaProtocol: 'LLDP', viaFrom: '10.0.0.1', viaPort: 'Gi0/1' }
  );
  assert.ok(meta.sources.some(s => s.id === 'lldp'));
  assert.ok(meta.reasonCodes.includes('neighbor-lldp'));
});

test('_buildDiscoveryMeta: solo ping -> osservato, confidenza bassa', () => {
  const meta = _buildDiscoveryMeta({ alive: true, ip: '192.168.1.50' });
  assert.equal(meta.manageability, 'reachable');
  assert.equal(meta.confidence.level, 'low');
  assert.equal(meta.displayName, '192.168.1.50');
});

test('_buildDiscoveryMeta: OS fingerprint aggiunge evidenza senza UI dedicata', () => {
  const meta = _buildDiscoveryMeta({
    alive: true,
    hostname: 'DESKTOP-ABC123',
    netbiosName: 'DESKTOP-ABC123',
    services: [{ port: 3389, service: 'rdp' }],
  });
  assert.equal(meta.os.family, 'windows');
  assert.ok(meta.sources.some(s => s.id === 'os'));
  assert.ok(meta.reasonCodes.includes('os-fingerprint'));
});

test('_parseNetbiosOutput: estrae nome, gruppo, server SMB, MAC', () => {
  const out = [
    '   NetBIOS Remote Machine Name Table',
    '',
    '   Name               Type         Status',
    '---------------------------------------------',
    '   FILESERVER     <00>  UNIQUE      Registered',
    '   WORKGROUP      <00>  GROUP       Registered',
    '   FILESERVER     <20>  UNIQUE      Registered',
    '',
    '   MAC Address = 00-11-22-33-44-55',
  ].join('\n');
  const r = _parseNetbiosOutput(out);
  assert.ok(r, 'deve restituire un record');
  assert.equal(r.name, 'FILESERVER');
  assert.equal(r.group, 'WORKGROUP');
  assert.equal(r.smbServer, true);
  assert.ok(r.mac, 'MAC valorizzato');
  assert.equal(_parseNetbiosOutput('nessun dato utile'), null);
});

test('_parseNetViewOutput: estrae le condivisioni reali, filtra IPC$/ADMIN$', () => {
  const out = [
    'Shared resources at \\\\192.168.1.10',
    '',
    'Share name   Type   Used as  Comment',
    '',
    '-------------------------------------------------------------------------------',
    'Documents    Disk            Documenti condivisi',
    'Public       Disk',
    'IPC$         IPC             Remote IPC',
    'NETLOGON     Disk            Logon share',
    'The command completed successfully.',
  ].join('\n');
  const shares = _parseNetViewOutput(out);
  const names = shares.map(s => s.name);
  assert.deepEqual(names, ['Documents', 'Public', 'NETLOGON']); // IPC$ filtrato, stop al messaggio finale
  const doc = shares.find(s => s.name === 'Documents');
  assert.equal(doc.type, 'Disk');
  assert.equal(doc.comment, 'Documenti condivisi');
});

// ============================================================
// A — dispositivi tipici di una rete (classificazione)
// ============================================================

test('_classifyDiscoveredDevice: router Zyxel gateway (.1)', () => {
  // IP gateway + vendor Zyxel → router via networkVendorGateway
  assert.equal(_classifyDiscoveredDevice({ ip:'192.168.1.1', vendor:'Zyxel', snmpReachable:true, sysServices:4, alive:true }), 'router');
  // Zyxel con keyword "zywall" esplicita nella descrizione
  assert.equal(_classifyDiscoveredDevice({ descr:'ZyXEL ZyWALL 2 Plus', vendor:'Zyxel', snmpReachable:true }), 'router');
});

test('_classifyDiscoveredDevice: switch Zyxel GS1200-8 (L2, sysDescr)', () => {
  assert.equal(_classifyDiscoveredDevice({
    descr:'GS1200-8HP v2 Switch', vendor:'Zyxel',
    snmpReachable:true, sysServices:2, alive:true,
  }), 'switch');
  // hostname contiene "switch" + sysServices L2
  assert.equal(_classifyDiscoveredDevice({
    hostname:'switch1900.example.lan', vendor:'Zyxel',
    snmpReachable:true, sysServices:2,
  }), 'switch');
});

test('_classifyDiscoveredDevice: stampante HP OfficeJet (sysDescr)', () => {
  assert.equal(_classifyDiscoveredDevice({ descr:'HP OFFICEJET PRO 8710', vendor:'Hewlett Packard' }), 'printer');
  // sysObjectID HP printer (PEN 11)
  assert.equal(_classifyDiscoveredDevice({ objectId:'1.3.6.1.4.1.11.2.3.9.4.2.1.1' }), 'printer');
});

test('_classifyDiscoveredDevice: webcam Reolink (hostname + RTSP)', () => {
  assert.equal(_classifyDiscoveredDevice({
    hostname:'reolink-cam1', httpTitle:'Reolink',
    services:[{port:554, service:'rtsp'}], alive:true,
  }), 'webcam');
});

test('_classifyDiscoveredDevice: TV Sony Bravia e LG webOS', () => {
  assert.equal(_classifyDiscoveredDevice({ descr:'Sony BRAVIA Android TV', httpTitle:'BRAVIA', alive:true }), 'tv');
  assert.equal(_classifyDiscoveredDevice({ descr:'LG webOS TV', vendor:'LG Electronics' }), 'tv');
  // LG con webOS deve rimanere TV anche se SmartThings è presente
  assert.equal(_classifyDiscoveredDevice({ descr:'LG webOS TV', vendor:'LG Electronics', httpTitle:'SmartThings' }), 'tv');
});

test('_classifyDiscoveredDevice: media player NVIDIA Shield', () => {
  assert.equal(_classifyDiscoveredDevice({
    hostname:'NVIDIA-SHIELD-TV', httpTitle:'NVIDIA SHIELD', alive:true,
  }), 'tv');
});

test('_classifyDiscoveredDevice: NAS Synology e LaCie', () => {
  assert.equal(_classifyDiscoveredDevice({ objectId:'1.3.6.1.4.1.6574.1.2', hostname:'DiskStation', snmpReachable:true }), 'nas');
  assert.equal(_classifyDiscoveredDevice({ hostname:'LaCie-2big', httpTitle:'LaCie Dashboard', alive:true }), 'nas');
});

test('_classifyDiscoveredDevice: UPS Eaton (sysObjectID)', () => {
  assert.equal(_classifyDiscoveredDevice({ objectId:'1.3.6.1.4.1.534.6.6.7', descr:'Eaton 5PX 1500i', snmpReachable:true }), 'ups');
});

test('_classifyDiscoveredDevice: switch ArubaCX (sysObjectID + L2)', () => {
  assert.equal(_classifyDiscoveredDevice({
    descr:'AOS-CX 10.06.0010', objectId:'1.3.6.1.4.1.14823.2.3.3.1',
    snmpReachable:true, sysServices:2,
  }), 'switch');
});

test('_classifyDiscoveredDevice: switch e router Cisco virtuali PNETLab', () => {
  // IOSvL2 = switch (L2)
  assert.equal(_classifyDiscoveredDevice({
    descr:'Cisco IOS Software, IOSvL2 Software (VIOS_L2-ADVENTERPRISEK9-M)',
    snmpReachable:true, sysServices:2,
  }), 'switch');
  // IOSv = router (L3)
  assert.equal(_classifyDiscoveredDevice({
    descr:'Cisco IOS Software, IOSv Software (VIOS-ADVENTERPRISEK9-M)',
    snmpReachable:true, sysServices:4,
  }), 'router');
});

test('_classifyDiscoveredDevice: hypervisor VMware ESXi (sysObjectID 6876)', () => {
  // L'HOST ESXi (sysObjectID VMware) è un hypervisor, non un server generico.
  assert.equal(_classifyDiscoveredDevice({
    descr:'VMware ESXi 7.0.3', objectId:'1.3.6.1.4.1.6876.4.1', snmpReachable:true,
  }), 'hypervisor');
  // Anche Proxmox/Hyper-V riconosciuti dal sysDescr → hypervisor.
  assert.equal(_classifyDiscoveredDevice({ descr:'Proxmox VE 8.1 Linux', snmpReachable:true }), 'hypervisor');
  // PNETLab (lab/orchestrazione) e Windows Server restano `server`, non hypervisor.
  assert.equal(_classifyDiscoveredDevice({ httpTitle:'PNETLab', hostname:'pnetlab', alive:true }), 'server');
  // KVM switch (keyboard/video) NON è un hypervisor: 'kvm' non finisce nella regex.
  assert.notEqual(_classifyDiscoveredDevice({ descr:'ATEN KVM over IP', snmpReachable:true }), 'hypervisor');
});

test('_classifyDiscoveredDevice: PC Windows (hostname/NetBIOS)', () => {
  assert.equal(_classifyDiscoveredDevice({ hostname:'DESKTOP-ABC123', alive:true }), 'pc');
});

// ============================================================
// B — confidence contestuale (_buildDiscoveryMeta)
// ============================================================

test('_buildDiscoveryMeta: vicino LLDP -> confidenza HIGH (identità quasi certa)', () => {
  // LLDP annuncia hostname + porta esatta: confidenza deve raggiungere 'high'
  const meta = _buildDiscoveryMeta(
    { alive: true, mac: 'aa:bb:cc:dd:ee:ff' },
    { viaProtocol: 'LLDP', viaFrom: '192.168.1.100', viaPort: 'Gi0/1' }
  );
  assert.equal(meta.confidence.level, 'high', 'LLDP discovery deve dare high confidence');
  assert.ok(meta.reasonCodes.includes('neighbor-lldp'));
});

test('_buildDiscoveryMeta: SNMP + sysServices concorda con classe -> confidenza HIGH', () => {
  // Switch con sysServices L2 (only) confermato da SNMP
  const sw = _buildDiscoveryMeta({
    snmpReachable: true, sysServices: 2,
    descr: 'Cisco IOS Catalyst 2960', alive: true,
  });
  assert.equal(sw.deviceClass, 'switch');
  assert.equal(sw.confidence.level, 'high', 'SNMP + L2 sysServices deve dare high confidence');
  assert.ok(sw.reasonCodes.includes('snmp-class-confirmed'));

  // Router con sysServices L3 confermato da SNMP
  const rt = _buildDiscoveryMeta({
    snmpReachable: true, sysServices: 4,
    descr: 'Cisco IOS Software, IOSv (VIOS)', alive: true,
  });
  assert.equal(rt.deviceClass, 'router');
  assert.equal(rt.confidence.level, 'high', 'SNMP + L3 sysServices deve dare high confidence');
  assert.ok(rt.reasonCodes.includes('snmp-class-confirmed'));
});

test('_buildDiscoveryMeta: convergenza 3+ sorgenti -> bonus confidenza', () => {
  // ping + ARP + DNS + HTTP = 4 sorgenti indipendenti, nessun SNMP
  const meta = _buildDiscoveryMeta({
    alive: true, mac: 'de:ad:be:ef:00:01',
    hostname: 'printer-hp', httpTitle: 'HP OfficeJet',
  });
  assert.ok(meta.sources.length >= 3, 'deve avere 3+ sorgenti');
  // Con convergenza lo score deve essere più alto del solo sum-lineare
  assert.ok(meta.confidence.score > 40, `score ${meta.confidence.score} deve superare 40 con 3+ sorgenti`);
});

test('_vendorFromHostname: brand BYOD dal nome host/mDNS (grounded, no falsi positivi)', () => {
  const { _vendorFromHostname, _decorateDiscoveryRow } = require('../server/classify.js');
  assert.equal(_vendorFromHostname('iPhone-di-Mario'), 'Apple');
  assert.equal(_vendorFromHostname('Marys-iPad'), 'Apple');
  assert.equal(_vendorFromHostname('Galaxy-S23'), 'Samsung');
  assert.equal(_vendorFromHostname('Pixel-7'), 'Google');
  assert.equal(_vendorFromHostname('HUAWEI-P30'), 'Huawei');
  assert.equal(_vendorFromHostname('redmi-note-12'), 'Xiaomi');
  // niente falsi positivi
  assert.equal(_vendorFromHostname('DESKTOP-ABC123'), '');
  assert.equal(_vendorFromHostname('sw-core'), '');
  assert.equal(_vendorFromHostname('reddit'), '');   // NON deve matchare "redmi"
  assert.equal(_vendorFromHostname(''), '');
  // Un BYOD con MAC randomizzato ma hostname parlante ottiene il brand (prima: vuoto)
  const d = _decorateDiscoveryRow({ ip: '192.168.1.50', alive: true, mac: '3A:42:5E:10:70:89', hostname: 'iPhone-di-Anna' });
  assert.equal(d.vendor, 'Apple');
  // Randomizzato SENZA altri segnali: nessuna invenzione lato server (resta vuoto)
  const d2 = _decorateDiscoveryRow({ ip: '192.168.1.51', alive: true, mac: '2A:50:30:1F:8C:AB' });
  assert.equal(d2.vendor || '', '');
});

test('_classifyDiscoveredDevice: IoT — Daikin condizionatore e lavatrice LG', () => {
  // Daikin/AzureWave condizionatore (keyword in smartHomePlatform)
  assert.equal(_classifyDiscoveredDevice({ hostname:'DaikinAP012345', vendor:'AzureWave Technology', alive:true }), 'iot');
  // Lavatrice LG: i device ThinQ si identificano via httpTitle/descr "ThinQ" o "washer"
  // — hostname con underscore non ha word-boundary, quindi usiamo descr con spazi
  assert.equal(_classifyDiscoveredDevice({ descr:'LG ThinQ washer WM5000HVA', vendor:'LG Electronics', alive:true }), 'iot');
  // Variante con solo httpTitle ThinQ (caso reale: no SNMP, solo HTTP banner)
  assert.equal(_classifyDiscoveredDevice({ httpTitle:'LG ThinQ', vendor:'LG Electronics', alive:true }), 'iot');
  // Chromecast / Google Cast -> media endpoint = tv (policy: ogni segnale Cast -> tv;
  // il protocollo Cast e' vendor-neutral, come RTSP->camera). L'utente puo' correggere
  // un cast audio-only a mano (manual-first).
  assert.equal(_classifyDiscoveredDevice({ hostname:'Chromecast-Audio', httpTitle:'Chromecast', vendor:'Google', alive:true }), 'tv');
});
