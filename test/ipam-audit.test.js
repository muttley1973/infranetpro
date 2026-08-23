// Test puri per lib/ipam-audit.js — igiene IPAM (IP duplicati + overlap subnet).
// Nessun DOM, nessuno stato: input espliciti → output.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildIpamAudit, findDuplicateIps, findSubnetOverlaps, findExpectedOverlaps, findAddressesOutsidePlan, isContainerPrefix, containerDeclarationFor } = require('../lib/ipam-audit.js');
const { _parseCidrInfo } = require('../lib/cidr.js');

// ---- findDuplicateIps -------------------------------------------------------

test('findDuplicateIps: stesso IP su due nodi → segnalato con entrambi', () => {
  const dups = findDuplicateIps([
    { id: 'a', name: 'SW1', ip: '192.168.1.10' },
    { id: 'b', name: 'AP2', ip: '192.168.1.10' },
    { id: 'c', name: 'PC3', ip: '192.168.1.11' },
  ]);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].ip, '192.168.1.10');
  assert.deepEqual(dups[0].nodes.map(n => n.name).sort(), ['AP2', 'SW1']);
});

test('findDuplicateIps: IP unici → nessun duplicato', () => {
  assert.deepEqual(findDuplicateIps([
    { id: 'a', name: 'SW1', ip: '10.0.0.1' },
    { id: 'b', name: 'SW2', ip: '10.0.0.2' },
  ]), []);
});

test('findDuplicateIps: IP vuoti/mancanti ignorati (non contano come duplicato)', () => {
  assert.deepEqual(findDuplicateIps([
    { id: 'a', name: 'senza-ip-1', ip: '' },
    { id: 'b', name: 'senza-ip-2' },
    { id: 'c', name: 'con-ip', ip: '  10.0.0.5  ' },
  ]), []);
});

test('findDuplicateIps: ordinamento numerico "umano" (.10 dopo .2)', () => {
  const dups = findDuplicateIps([
    { id: '1', name: 'x', ip: '10.0.0.10' }, { id: '2', name: 'y', ip: '10.0.0.10' },
    { id: '3', name: 'p', ip: '10.0.0.2' },  { id: '4', name: 'q', ip: '10.0.0.2' },
  ]);
  assert.deepEqual(dups.map(d => d.ip), ['10.0.0.2', '10.0.0.10']);
});

// ---- findDuplicateIps: IPv6 --------------------------------------------------
// Un device dual-stack dichiara due indirizzi. Prima si guardava solo `ip`: un
// IPv6 ricopiato su due apparati non risultava duplicato, mai.

test('findDuplicateIps: stesso IPv6 su due nodi → segnalato', () => {
  const dups = findDuplicateIps([
    { id: 'a', name: 'SRV', ip: '192.168.20.10', ip6: '2001:db8:0:20::10' },
    { id: 'b', name: 'NAS', ip: '192.168.20.11', ip6: '2001:db8:0:20::10' },
  ]);
  assert.equal(dups.length, 1);
  assert.deepEqual(dups[0].nodes.map(n => n.name).sort(), ['NAS', 'SRV']);
});

test('findDuplicateIps: lo stesso IPv6 scritto in due forme è UN indirizzo', () => {
  // Il caso vero: uno arriva da SNMP in forma canonica, l'altro l'ha battuto una
  // persona. Col confronto testuale erano due indirizzi diversi.
  const dups = findDuplicateIps([
    { id: 'a', name: 'SRV', ip6: '2001:db8:0:20::10' },
    { id: 'b', name: 'NAS', ip6: '2001:DB8:0:20:0:0:0:10' },
  ]);
  assert.equal(dups.length, 1);
  assert.deepEqual(dups[0].nodes.map(n => n.name).sort(), ['NAS', 'SRV']);
});

test('findDuplicateIps: un nodo che ripete se stesso non è un duplicato', () => {
  // Stesso indirizzo nei due campi dello STESSO nodo: strano, ma non è un
  // conflitto fra apparati — e il conflitto è quello che questo audit cerca.
  assert.deepEqual(findDuplicateIps([
    { id: 'a', name: 'strano', ip: '2001:db8::1', ip6: '2001:DB8::1' },
  ]), []);
});

test('findDuplicateIps: v4 e v6 non si mescolano, e gli IPv4 restano in testa', () => {
  const dups = findDuplicateIps([
    { id: '1', name: 'a', ip: '10.0.0.2', ip6: '2001:db8::10' },
    { id: '2', name: 'b', ip: '10.0.0.2', ip6: '2001:db8::10' },
  ]);
  assert.deepEqual(dups.map(d => d.ip), ['10.0.0.2', '2001:db8::10']);
});

// ---- findSubnetOverlaps -----------------------------------------------------

// L'input è `ipam.prefixes[]`, l'autorità: la VLAN è un attributo facoltativo del
// prefisso, non la chiave con cui si confronta.
const P = (cidr, vlan) => ({ cidr, vlan: vlan === undefined ? null : vlan });

test('findSubnetOverlaps: due /24 identiche su VLAN diverse → identical:true', () => {
  const ov = findSubnetOverlaps([P('192.168.1.0/24', 10), P('192.168.1.0/24', 20)], _parseCidrInfo);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].a.vlan, 10);
  assert.equal(ov[0].b.vlan, 20);
  assert.equal(ov[0].identical, true);
});

test('findSubnetOverlaps: containment (/25 dentro /24) → overlap, non identical', () => {
  const ov = findSubnetOverlaps([P('10.0.0.0/24', 10), P('10.0.0.0/25', 20)], _parseCidrInfo);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].identical, false);
});

test('findSubnetOverlaps: subnet disgiunte → nessun overlap', () => {
  assert.deepEqual(findSubnetOverlaps([P('10.0.0.0/24', 10), P('10.0.1.0/24', 20)], _parseCidrInfo), []);
});

test('findSubnetOverlaps: CIDR mancante o non valido → prefisso saltato', () => {
  const ov = findSubnetOverlaps([P('10.0.0.0/24', 10), P('non-un-cidr', 20), P('', 30), null], _parseCidrInfo);
  assert.deepEqual(ov, []);
});

test('findSubnetOverlaps: senza parseCidr → array vuoto (nessun crash)', () => {
  assert.deepEqual(findSubnetOverlaps([P('10.0.0.0/24', 10)], null), []);
});

// ---- le sovrapposizioni che NON sono un errore -------------------------------
// Misurato su un piano tipo NetBox (contenitore di sito + le /24 dentro, piu' lo
// stesso spazio in due VRF): 7 reti producevano 8 «conflitti», nessuno vero. La
// gerarchia e la separazione per VRF sono il modo NORMALE di scrivere un piano, e
// il documento gia' le dichiarava — le leggeva solo nessuno.
const C = (cidr, extra) => Object.assign({ cidr, vlan: null }, extra || {});

test('overlap: un contenitore e le reti che contiene NON sono un conflitto', () => {
  const rows = [C('10.0.0.0/8', { status: 'container' }), C('10.10.10.0/24', { status: 'active' })];
  assert.deepEqual(findSubnetOverlaps(rows, _parseCidrInfo), [], 'niente da accusare');
  const exp = findExpectedOverlaps(rows, _parseCidrInfo);
  assert.equal(exp.length, 1);
  assert.equal(exp[0].reason, 'hierarchy');
});

test('overlap: lo sconto vale solo per il contenitore PIU\' LARGO, non per chi sta dentro', () => {
  // Una /25 marcata contenitore dentro una /24 normale: la /24 non ha dichiarato
  // niente, quindi la sovrapposizione resta un fatto da guardare.
  const rows = [C('10.0.0.0/24', { status: 'active' }), C('10.0.0.0/25', { status: 'container' })];
  assert.equal(findSubnetOverlaps(rows, _parseCidrInfo).length, 1);
});

test('overlap: due contenitori IDENTICI restano un conflitto (e\' la stessa rete due volte)', () => {
  const rows = [C('10.0.0.0/8', { status: 'container' }), C('10.0.0.0/8', { status: 'container' })];
  const ov = findSubnetOverlaps(rows, _parseCidrInfo);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].identical, true);
});

test('overlap: lo stesso spazio in due VRF DICHIARATE e diverse non e\' un doppione', () => {
  const rows = [C('192.168.1.0/24', { vrfId: 1 }), C('192.168.1.0/24', { vrfId: 2 })];
  assert.deepEqual(findSubnetOverlaps(rows, _parseCidrInfo), []);
  assert.equal(findExpectedOverlaps(rows, _parseCidrInfo)[0].reason, 'vrf');
});

test('overlap: una VRF sola non compra il silenzio (non sapere non e\' sapere)', () => {
  assert.equal(findSubnetOverlaps([C('192.168.1.0/24', { vrfId: 1 }), C('192.168.1.0/24')], _parseCidrInfo).length, 1);
  assert.equal(findSubnetOverlaps([C('192.168.1.0/24', { vrfId: 7 }), C('192.168.1.0/24', { vrfId: 7 })], _parseCidrInfo).length, 1);
});

test('overlap: «Container» e «container» sono la stessa cosa (vocabolario del DCIM)', () => {
  const rows = [C('10.0.0.0/8', { status: 'Container' }), C('10.10.10.0/24', {})];
  assert.deepEqual(findSubnetOverlaps(rows, _parseCidrInfo), []);
});

// ---- e la stessa cosa DETTA DA TE -------------------------------------------
// Il contenitore lo diceva solo il DCIM. Una gerarchia scritta a mano — un /16 di
// sede con le sue /24 dentro, che è il modo normale di scrivere un piano — non
// aveva modo di dichiararsi: restava accusata a ogni apertura del report, per
// sempre. ⚠️ Un avviso vero-ma-voluto che non si può chiudere è il modo più
// rapido per insegnare a chi legge a ignorare TUTTI gli avvisi.

test('un contenitore DICHIARATO A MANO vale quanto quello del DCIM', () => {
  const rows = [C('172.20.0.0/16', { container: true }), C('172.20.10.0/24')];
  assert.deepEqual(findSubnetOverlaps(rows, _parseCidrInfo), [], 'la gerarchia dichiarata non si accusa');
  assert.equal(findExpectedOverlaps(rows, _parseCidrInfo)[0].reason, 'hierarchy');
});

test('e vale ANCHE AL CONTRARIO: la tua parola nega quella del DCIM', () => {
  // Manual-first in entrambi i versi: chi documenta ha visto la rete, l'import ha
  // letto un altro archivio. Se dici che NON è un contenitore, torna un conflitto.
  const rows = [C('10.0.0.0/8', { status: 'container', container: false }), C('10.10.10.0/24')];
  assert.equal(findSubnetOverlaps(rows, _parseCidrInfo).length, 1, 'negato a mano = di nuovo un fatto da guardare');
  assert.deepEqual(findExpectedOverlaps(rows, _parseCidrInfo), []);
});

test('la chiave ASSENTE non è una negazione: parla la sorgente', () => {
  assert.equal(isContainerPrefix({ status: 'container' }), true, 'nessuna dichiarazione → decide il DCIM');
  assert.equal(isContainerPrefix({}), false, 'e senza nessuna delle due, non lo è');
  assert.equal(isContainerPrefix({ container: true }), true);
  assert.equal(isContainerPrefix({ container: false, status: 'container' }), false);
  assert.equal(isContainerPrefix(null), false, 'input sporco non lancia');
});

test('l\'interruttore salva la DIFFERENZA rispetto alla sorgente, non il suo stato', () => {
  // La casella mostra la risposta, quindi una rete importata come contenitore
  // nasce accesa: lasciarla accesa non è una dichiarazione, è un accordo.
  const daDcim = { cidr: '10.0.0.0/8', status: 'container' };
  const aMano = { cidr: '172.20.0.0/16' };
  assert.equal(containerDeclarationFor(daDcim, true), '', 'd\'accordo col DCIM: niente da salvare');
  assert.equal(containerDeclarationFor(daDcim, false), false, 'in disaccordo: la negazione resta scritta');
  assert.equal(containerDeclarationFor(aMano, true), true, 'lo dichiari tu: si scrive');
  assert.equal(containerDeclarationFor(aMano, false), '', 'e tornare indietro TOGLIE la chiave');
  // ⚠️ Senza questa regola ogni rete che apri porterebbe a casa un `container:false`
  // che non afferma niente: la zavorra dei campi che si pre-compilavano da soli.
  assert.equal(containerDeclarationFor(null, false), '', 'input sporco non lancia');
});

test('anche dichiarato, lo sconto resta solo del PIÙ LARGO', () => {
  // La regola non cambia con la sorgente: una /25 dichiarata contenitore dentro
  // una /24 che non ha dichiarato niente resta una sovrapposizione da guardare.
  const rows = [C('10.0.0.0/24'), C('10.0.0.0/25', { container: true })];
  assert.equal(findSubnetOverlaps(rows, _parseCidrInfo).length, 1);
});

test('buildIpamAudit: le attese escono a parte, non spariscono', () => {
  const a = buildIpamAudit({
    prefixes: [C('10.0.0.0/8', { status: 'container' }), C('10.10.10.0/24'), C('172.16.0.0/24'), C('172.16.0.0/25')],
    nodes: [], parseCidr: _parseCidrInfo,
  });
  assert.equal(a.subnetOverlaps.length, 1, 'resta solo il conflitto vero');
  assert.equal(a.subnetOverlaps[0].a.cidr, '172.16.0.0/24');
  assert.equal(a.subnetOverlapsExpected.length, 1, 'e la gerarchia e\' contata, non nascosta');
});

// ---- il 57% che prima era invisibile ----------------------------------------

test('findSubnetOverlaps: due reti SENZA VLAN che si sovrappongono → conflitto, vlan null', () => {
  const ov = findSubnetOverlaps([P('172.16.0.0/16'), P('172.16.5.0/24')], _parseCidrInfo);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].a.cidr, '172.16.0.0/16');   // ordine di indirizzo: la più larga prima
  assert.equal(ov[0].b.cidr, '172.16.5.0/24');
  assert.equal(ov[0].a.vlan, null);
  assert.equal(ov[0].b.vlan, null);
  assert.equal(ov[0].identical, false);
});

test('findSubnetOverlaps: una con VLAN e una senza → conflitto (prima era invisibile)', () => {
  const ov = findSubnetOverlaps([P('192.168.1.0/24', 10), P('192.168.1.128/25')], _parseCidrInfo);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].a.vlan, 10);
  assert.equal(ov[0].b.vlan, null);
});

test('findSubnetOverlaps: vlan 0 non è vlan null (`+null === 0`)', () => {
  const ov = findSubnetOverlaps([P('192.168.1.0/24', 0), P('192.168.1.0/24')], _parseCidrInfo);
  assert.equal(ov.length, 1);
  const vlans = [ov[0].a.vlan, ov[0].b.vlan];
  assert.ok(vlans.includes(0), 'la VLAN 0 dichiarata resta 0');
  assert.ok(vlans.includes(null), 'la rete senza VLAN resta null');
});

// ---- L2 ≠ L3: la stessa VLAN, due spazi di indirizzi ------------------------

test('findSubnetOverlaps: dual-stack v4+v6 sulla stessa VLAN → NESSUN conflitto', () => {
  const ov = findSubnetOverlaps([P('192.168.20.0/24', 20), P('2001:db8:0:14::/64', 20)], _parseCidrInfo);
  assert.deepEqual(ov, []);
});

test('findSubnetOverlaps: due v4 sulla stessa VLAN che si intersecano → conflitto', () => {
  // Indirizzo secondario sulla stessa SVI: legittimo finché non si sovrappone.
  const ov = findSubnetOverlaps([P('10.10.0.0/24', 20), P('10.10.0.0/25', 20)], _parseCidrInfo);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].a.vlan, 20);
  assert.equal(ov[0].b.vlan, 20);
});

test('findSubnetOverlaps: due v4 disgiunte sulla stessa VLAN → nessun conflitto', () => {
  assert.deepEqual(findSubnetOverlaps([P('10.10.0.0/24', 20), P('10.10.1.0/24', 20)], _parseCidrInfo), []);
});

test('findSubnetOverlaps: due /64 v6 annidate → conflitto anche fra IPv6', () => {
  const ov = findSubnetOverlaps([P('2001:db8::/32'), P('2001:db8:0:14::/64')], _parseCidrInfo);
  assert.equal(ov.length, 1);
  assert.equal(ov[0].a.cidr, '2001:db8::/32');
  assert.equal(ov[0].identical, false);
});

test('findSubnetOverlaps: ordinato per indirizzo, non per ordine di dichiarazione', () => {
  const ov = findSubnetOverlaps([
    P('192.168.1.0/24', 30), P('10.0.0.0/8', 10), P('192.168.1.64/26', 40), P('10.1.2.0/24', 20),
  ], _parseCidrInfo);
  assert.deepEqual(ov.map(o => [o.a.cidr, o.b.cidr]), [
    ['10.0.0.0/8', '10.1.2.0/24'],
    ['192.168.1.0/24', '192.168.1.64/26'],
  ]);
});

// ---- buildIpamAudit (integrazione) ------------------------------------------

test('buildIpamAudit: aggrega duplicati + overlap dallo stesso modello', () => {
  const out = buildIpamAudit({
    prefixes: [P('192.168.1.0/24', 10), P('192.168.1.128/25', 20)],
    nodes: [
      { id: 'a', name: 'SW1', ip: '192.168.1.1' },
      { id: 'b', name: 'SW2', ip: '192.168.1.1' },
    ],
    parseCidr: _parseCidrInfo,
  });
  assert.equal(out.duplicateIps.length, 1);
  assert.equal(out.duplicateIps[0].ip, '192.168.1.1');
  assert.equal(out.subnetOverlaps.length, 1);
  assert.equal(out.subnetOverlaps[0].identical, false);
});

test('buildIpamAudit: rete pulita → entrambi vuoti', () => {
  const out = buildIpamAudit({
    prefixes: [P('10.0.0.0/24', 10), P('10.0.1.0/24', 20)],
    nodes: [{ id: 'a', name: 'SW1', ip: '10.0.0.1' }, { id: 'b', name: 'SW2', ip: '10.0.1.1' }],
    parseCidr: _parseCidrInfo,
  });
  assert.deepEqual(out.duplicateIps, []);
  assert.deepEqual(out.subnetOverlaps, []);
});

test('buildIpamAudit: modello vuoto → nessun crash', () => {
  const out = buildIpamAudit({});
  assert.deepEqual(out.duplicateIps, []);
  assert.deepEqual(out.subnetOverlaps, []);
});

// ---- AUDIT 2026-08-13: fix F5 (link-local per-link) + F1 (v4 canonico) ------
test('findDuplicateIps: fe80::1 su due nodi NON è un duplicato (RFC 4007, per-link)', () => {
  const dup = findDuplicateIps([
    { id: 'rt1', name: 'router-A', ip: '10.0.0.1', ip6: 'fe80::1' },
    { id: 'rt2', name: 'router-B', ip: '10.0.1.1', ip6: 'fe80::1' },
  ]);
  assert.equal(dup.length, 0, 'stesso link-local su segmenti diversi è legale');
});

test('findDuplicateIps: un IPv6 GLOBAL su due nodi resta un duplicato', () => {
  const dup = findDuplicateIps([
    { id: 'a', name: 'A', ip6: '2001:db8::10' },
    { id: 'b', name: 'B', ip6: '2001:DB8:0:0:0:0:0:10' },   // stessa identità, altra grafia
  ]);
  assert.equal(dup.length, 1);
});

test('findDuplicateIps: IPv4 con grafie diverse (zeri iniziali) è un duplicato', () => {
  const dup = findDuplicateIps([
    { id: 'a', name: 'A', ip: '192.168.1.5' },
    { id: 'b', name: 'B', ip: '192.168.001.005' },
  ]);
  assert.equal(dup.length, 1, 'stesso IPv4 scritto in due modi = un conflitto');
});

// ---- findAddressesOutsidePlan ----------------------------------------------
// Il piano IPAM è l'autorità (declare-first): un apparato che vive fuori da tutte
// le reti dichiarate o ha un indirizzo sbagliato, o sta su una rete che nessuno ha
// mai scritto. Sono due conclusioni diverse e la scelta è di chi legge — qui si
// difende solo che la domanda venga posta, e che non venga posta a sproposito.

const PLAN = [{ cidr: '10.0.10.0/24', vlan: 10 }, { cidr: '10.0.20.0/24', vlan: 20 }];
const fuori = (nodes, prefixes) => findAddressesOutsidePlan(nodes, prefixes || PLAN, _parseCidrInfo);

test('fuori dal piano: un indirizzo che non cade in nessuna rete dichiarata', () => {
  const r = fuori([{ id: 'a', name: 'SW', ip: '10.0.10.1' }, { id: 'b', name: 'PC', ip: '192.168.77.5' }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].ip, '192.168.77.5');
  assert.equal(r[0].family, 4);
  assert.deepEqual(r[0].node, { id: 'b', name: 'PC' });
});

test('dentro il piano: nessuna accusa', () => {
  assert.deepEqual(fuori([{ id: 'a', name: 'SW', ip: '10.0.10.1' }, { id: 'b', name: 'PC', ip: '10.0.20.99' }]), []);
});

test('⚠️ nessuna rete di quella FAMIGLIA → non si giudica quella famiglia', () => {
  // Il piano è tutto IPv4: se ogni IPv6 documentato risultasse «fuori dal piano»
  // non sarebbe una scoperta, sarebbe il rumore di un confronto contro il nulla.
  const r = fuori([{ id: 'a', name: 'R', ip: '10.0.10.1', ip6: '2001:db8::9' }]);
  assert.deepEqual(r, []);
  // …e appena una rete v6 c'è, la domanda torna ad avere senso.
  const r2 = fuori([{ id: 'a', name: 'R', ip6: '2001:db8::9' }], PLAN.concat([{ cidr: '2001:db8:1::/64' }]));
  assert.equal(r2.length, 1);
  assert.equal(r2[0].family, 6);
});

test('nessuna rete dichiarata → nessuno è fuori da niente', () => {
  assert.deepEqual(fuori([{ id: 'a', name: 'PC', ip: '192.168.77.5' }], []), []);
});

test('il link-local IPv6 non appartiene a nessun piano e non si accusa', () => {
  const r = fuori([{ id: 'a', name: 'R', ip6: 'fe80::1' }], [{ cidr: '2001:db8::/32' }]);
  assert.deepEqual(r, []);
});

test('un campo scritto male non è «fuori dal piano»: è un problema diverso', () => {
  assert.deepEqual(fuori([{ id: 'a', name: 'X', ip: 'non-un-indirizzo' }]), []);
});

test('senza il lettore dei CIDR non si inventa un esito', () => {
  assert.deepEqual(findAddressesOutsidePlan([{ id: 'a', ip: '192.168.77.5' }], PLAN, null), []);
});

// ---- notChecked -------------------------------------------------------------
// ⭐ «Non ho potuto controllare» e «ho controllato e non c'è niente» uscivano
// identici: una lista vuota. In un disegno è un difetto; in un audit è peggio,
// perché un audit che tace viene creduto.

test('tutto controllabile → notChecked vuoto', () => {
  const a = buildIpamAudit({ nodes: [{ id: 'a', ip: '10.0.10.1' }], prefixes: PLAN, parseCidr: _parseCidrInfo });
  assert.deepEqual(a.notChecked, []);
});

test('senza lettore CIDR: sovrapposizioni e fuori-piano si dichiarano NON eseguiti', () => {
  const a = buildIpamAudit({ nodes: [{ id: 'a', ip: '192.168.77.5' }], prefixes: PLAN });
  assert.deepEqual(a.subnetOverlaps, [], 'la lista resta vuota…');
  const chi = a.notChecked.map(x => x.check).sort();
  assert.deepEqual(chi, ['addressesOutsidePlan', 'subnetOverlaps'], '…ma adesso si sa perché');
  assert.ok(a.notChecked.every(x => x.reason === 'no-parser'));
});

test('nessun piano dichiarato: il fuori-piano si dichiara non eseguito, non «pulito»', () => {
  const a = buildIpamAudit({ nodes: [{ id: 'a', ip: '192.168.77.5' }], prefixes: [], parseCidr: _parseCidrInfo });
  assert.deepEqual(a.addressesOutsidePlan, []);
  assert.deepEqual(a.notChecked, [{ check: 'addressesOutsidePlan', reason: 'no-plan' }]);
});

test('un prefisso senza CIDR non conta come piano', () => {
  const a = buildIpamAudit({ nodes: [], prefixes: [{ vlan: 10 }, { cidr: '  ' }], parseCidr: _parseCidrInfo });
  assert.equal(a.notChecked.some(x => x.check === 'addressesOutsidePlan' && x.reason === 'no-plan'), true);
});

test('buildIpamAudit espone il fuori-piano accanto agli altri due', () => {
  const a = buildIpamAudit({
    nodes: [{ id: 'a', name: 'SW', ip: '10.0.10.1' }, { id: 'b', name: 'PC', ip: '172.16.5.5' }],
    prefixes: PLAN, parseCidr: _parseCidrInfo });
  assert.equal(a.addressesOutsidePlan.length, 1);
  assert.equal(a.addressesOutsidePlan[0].ip, '172.16.5.5');
  assert.deepEqual(a.notChecked, []);
});
