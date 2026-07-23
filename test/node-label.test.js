'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { nodeLabelParts, normalizeVendor } = require('../lib/node-label.js');

// ── Il nome dichiarato vince sempre ──────────────────────────────────
test('un nome vero resta il nome, e l IP scende in seconda riga', () => {
    const r = nodeLabelParts({ name: 'SW-CORE', ip: '10.10.30.1', brand: 'Cisco' },
        { typeName: 'Switch' });
    assert.deepStrictEqual(r, { primary: 'SW-CORE', secondary: '10.10.30.1', derived: false });
});

test('un nome vero senza IP non inventa una seconda riga', () => {
    const r = nodeLabelParts({ name: 'PP-A' }, { typeName: 'Patch panel' });
    assert.deepStrictEqual(r, { primary: 'PP-A', secondary: '', derived: false });
});

// ── Il caso che motiva la lib: name === ip ───────────────────────────
test('quando il nome E la IP, la parte leggibile viene dal misurato', () => {
    const r = nodeLabelParts({ name: '192.168.1.110', ip: '192.168.1.110', brand: 'LaCie' },
        { typeName: 'NAS' });
    assert.deepStrictEqual(r, { primary: 'NAS-LaCie', secondary: '192.168.1.110', derived: true });
});

test('senza vendor resta il solo tipo', () => {
    const r = nodeLabelParts({ name: '10.10.10.100', ip: '10.10.10.100' },
        { typeName: 'PC / Workstation' });
    assert.deepStrictEqual(r, { primary: 'PC', secondary: '10.10.10.100', derived: true });
});

// ── I nomi-tipo del catalogo sono da tendina, non da nodo largo 60px ──
test('il tipo composto tiene solo la prima alternativa', () => {
    const p = t => nodeLabelParts({ ip: '10.0.0.1' }, { typeName: t }).primary;
    assert.strictEqual(p('Webcam / CCTV'), 'Webcam');
    assert.strictEqual(p('Smart TV / Media Player'), 'Smart TV');
    assert.strictEqual(p('NAS (desktop)'), 'NAS');
    assert.strictEqual(p('Dispositivo IoT'), 'Dispositivo IoT');   // niente da tagliare
});

test('un nome DICHIARATO non viene mai accorciato', () => {
    const r = nodeLabelParts({ name: 'PC / Sala riunioni', ip: '10.0.0.2' },
        { typeName: 'PC / Workstation' });
    assert.strictEqual(r.primary, 'PC / Sala riunioni');
    assert.strictEqual(r.derived, false);
});

// ── Vendor che non sono vendor (MAC randomizzato / BYOD) ─────────────
test('il segnaposto OUI «Private» non diventa una marca', () => {
    const r = nodeLabelParts({ name: '10.10.30.100', ip: '10.10.30.100', brand: 'Private' },
        { typeName: 'PC / Workstation' });
    assert.deepStrictEqual(r, { primary: 'PC', secondary: '10.10.30.100', derived: true });
});

test('gli altri segnaposto OUI sono filtrati allo stesso modo', () => {
    for (const junk of ['Unknown', 'unassigned', 'RESERVED', 'n/a', '-', 'Locally administered']) {
        const r = nodeLabelParts({ ip: '10.0.0.3', brand: junk }, { typeName: 'Switch' });
        assert.strictEqual(r.primary, 'Switch', `vendor «${junk}» non filtrato`);
    }
});

test('il vendor arriva normalizzato anche dentro l etichetta', () => {
    const r = nodeLabelParts({ ip: '10.0.0.4', brand: 'Hewlett Packard' }, { typeName: 'Stampante' });
    assert.strictEqual(r.primary, 'Stampante-HP');
});

// ── normalizeVendor: dalla ragione sociale IEEE alla marca ───────────
test('i suffissi societari cadono, la marca resta', () => {
    const n = normalizeVendor;
    assert.strictEqual(n('Cisco Systems, Inc.'), 'Cisco');
    assert.strictEqual(n('Juniper Networks'), 'Juniper');
    assert.strictEqual(n('AzureWave Technology Inc.'), 'AzureWave');
    assert.strictEqual(n('Zyxel Communications Corporation'), 'Zyxel');
    assert.strictEqual(n('Intel Corporate'), 'Intel');
    assert.strictEqual(n('Samsung Electronics Co., Ltd.'), 'Samsung');
    assert.strictEqual(n('Ubiquiti Networks Inc.'), 'Ubiquiti');
});

test('le maiuscole interne della marca non vengono ricostruite ma preservate', () => {
    const n = normalizeVendor;
    assert.strictEqual(n('MikroTik'), 'MikroTik');
    assert.strictEqual(n('LaCie'), 'LaCie');
    assert.strictEqual(n('AzureWave'), 'AzureWave');
    assert.strictEqual(n('Net-SNMP'), 'Net-SNMP');
});

test('i casi che la regola generale non risolve stanno negli alias', () => {
    const n = normalizeVendor;
    assert.strictEqual(n('Hewlett Packard'), 'HP');
    assert.strictEqual(n('Hewlett-Packard'), 'HP');
    assert.strictEqual(n('Hewlett Packard Enterprise'), 'HPE');
    assert.strictEqual(n('Hangzhou Hikvision Digital Technology Co.,Ltd.'), 'Hikvision');
    assert.strictEqual(n('ASUSTek COMPUTER INC.'), 'ASUS');
});

test('una parola-suffisso DENTRO il nome non viene toccata', () => {
    const n = normalizeVendor;
    assert.strictEqual(n('Western Digital'), 'Western Digital', 'Digital non è un suffisso');
    assert.strictEqual(n('Dell EMC'), 'Dell EMC');
    assert.strictEqual(n('LG Innotek'), 'LG Innotek');
    assert.strictEqual(n('Palo Alto Networks'), 'Palo Alto');
});

test('un vendor che si chiama SOLO come un suffisso non sparisce', () => {
    assert.strictEqual(normalizeVendor('Systems'), 'Systems');
    assert.strictEqual(normalizeVendor('Corp.'), 'Corp');
});

test('vuoto e spazzatura non lanciano', () => {
    assert.strictEqual(normalizeVendor(''), '');
    assert.strictEqual(normalizeVendor(null), '');
    assert.strictEqual(normalizeVendor('   '), '');
});

test('nome assente del tutto: stessa strada del nome-uguale-a-IP', () => {
    const r = nodeLabelParts({ ip: '192.168.1.101', brand: 'Eaton' }, { typeName: 'Dispositivo IoT' });
    assert.deepStrictEqual(r,
        { primary: 'Dispositivo IoT-Eaton', secondary: '192.168.1.101', derived: true });
});

test('il confronto vale anche sull IPv6', () => {
    const r = nodeLabelParts({ name: 'fe80::1', ip6: 'fe80::1', brand: 'MikroTik' },
        { typeName: 'Router' });
    assert.deepStrictEqual(r, { primary: 'Router-MikroTik', secondary: 'fe80::1', derived: true });
});

test('senza IPv4 la seconda riga usa l IPv6', () => {
    const r = nodeLabelParts({ name: 'NAS-1', ip6: '2001:db8::5' }, { typeName: 'NAS' });
    assert.strictEqual(r.secondary, '2001:db8::5');
});

// ── Niente da cui derivare: l'indirizzo da solo, mai una riga vuota ──
test('senza tipo ne vendor resta l indirizzo, e non e marcato derivato', () => {
    const r = nodeLabelParts({ name: '10.0.0.9', ip: '10.0.0.9' }, {});
    assert.deepStrictEqual(r, { primary: '10.0.0.9', secondary: '', derived: false });
});

test('un nodo vuoto non lancia e non produce testo', () => {
    assert.deepStrictEqual(nodeLabelParts({}, {}),
        { primary: '', secondary: '', derived: false });
});

test('nessun argomento non lancia', () => {
    assert.deepStrictEqual(nodeLabelParts(),
        { primary: '', secondary: '', derived: false });
});

// ── Igiene ──────────────────────────────────────────────────────────
test('gli spazi non contano nel confronto nome/indirizzo', () => {
    const r = nodeLabelParts({ name: '  192.168.1.5 ', ip: '192.168.1.5', brand: ' HP ' },
        { typeName: ' Stampante ' });
    assert.deepStrictEqual(r, { primary: 'Stampante-HP', secondary: '192.168.1.5', derived: true });
});

test('il vendor esplicito batte node.brand', () => {
    const r = nodeLabelParts({ name: '10.0.0.4', ip: '10.0.0.4', brand: 'Zyxel' },
        { typeName: 'Switch', vendor: '' });
    assert.deepStrictEqual(r, { primary: 'Switch', secondary: '10.0.0.4', derived: true });
});

test('un nome che CONTIENE l IP non e l IP', () => {
    const r = nodeLabelParts({ name: 'AP-192.168.1.5', ip: '192.168.1.5' }, { typeName: 'Access Point' });
    assert.strictEqual(r.derived, false);
    assert.strictEqual(r.primary, 'AP-192.168.1.5');
});
