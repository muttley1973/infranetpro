// Test per il modulo CIDR/IPv4 puro estratto da app.js (lib/cidr.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const { _parseIpv4Int, _parseCidrInfo, _ipInCidr, _cidrsOverlap, _intToIpv4, subnetInputToCidr,
        addrFamily, addrKey, addrIsLinkLocalV6, segmentKey } = require('../lib/cidr.js');

test('_parseIpv4Int: parsing e validazione ottetti', () => {
  assert.equal(_parseIpv4Int('0.0.0.0'), 0);
  assert.equal(_parseIpv4Int('255.255.255.255'), 0xffffffff);
  assert.equal(_parseIpv4Int('192.168.1.10'), ((192 << 24) >>> 0) + (168 << 16) + (1 << 8) + 10);
  assert.equal(_parseIpv4Int('192.168.1'), null);     // 3 ottetti
  assert.equal(_parseIpv4Int('192.168.1.256'), null); // fuori range
  assert.equal(_parseIpv4Int('a.b.c.d'), null);
  assert.equal(_parseIpv4Int(''), null);
});

test('_parseCidrInfo: rete/mask/broadcast corretti', () => {
  const c = _parseCidrInfo('192.168.10.0/24');
  assert.equal(c.prefix, 24);
  assert.equal(c.mask >>> 0, 0xffffff00);
  assert.equal(c.network, _parseIpv4Int('192.168.10.0'));
  assert.equal(c.broadcast, _parseIpv4Int('192.168.10.255'));

  const c30 = _parseCidrInfo('10.0.0.4 / 30'); // spazi tollerati
  assert.equal(c30.prefix, 30);
  assert.equal(c30.network, _parseIpv4Int('10.0.0.4'));
  assert.equal(c30.broadcast, _parseIpv4Int('10.0.0.7'));

  const c0 = _parseCidrInfo('0.0.0.0/0');
  assert.equal(c0.mask, 0);
  assert.equal(c0.network, 0);

  assert.equal(_parseCidrInfo('192.168.1.0'), null);    // senza prefisso
  assert.equal(_parseCidrInfo('192.168.1.0/33'), null); // prefisso non valido
  assert.equal(_parseCidrInfo(''), null);
});

test('_ipInCidr: appartenenza alla subnet', () => {
  const c = _parseCidrInfo('192.168.10.0/24');
  assert.equal(_ipInCidr('192.168.10.1', c), true);
  assert.equal(_ipInCidr('192.168.10.254', c), true);
  assert.equal(_ipInCidr('192.168.11.1', c), false);
  assert.equal(_ipInCidr('10.0.0.1', c), false);
  assert.equal(_ipInCidr('non-ip', c), false);
  assert.equal(_ipInCidr('192.168.10.1', null), false);

  const c30 = _parseCidrInfo('10.0.0.4/30'); // host validi .5 .6
  assert.equal(_ipInCidr('10.0.0.5', c30), true);
  assert.equal(_ipInCidr('10.0.0.8', c30), false);
});

test('_intToIpv4: intero -> dotted quad', () => {
  assert.equal(_intToIpv4(0), '0.0.0.0');
  assert.equal(_intToIpv4(0xffffffff), '255.255.255.255');
  assert.equal(_intToIpv4(_parseIpv4Int('192.168.10.0')), '192.168.10.0');
});

test('subnetInputToCidr: input di scansione -> subnet CIDR da dichiarare', () => {
  // CIDR: normalizzato all'indirizzo di rete, prefisso rispettato
  assert.equal(subnetInputToCidr('192.168.10.0/24'), '192.168.10.0/24');
  assert.equal(subnetInputToCidr('192.168.10.20/24'), '192.168.10.0/24');
  assert.equal(subnetInputToCidr('10.0.0.0/16'), '10.0.0.0/16');
  assert.equal(subnetInputToCidr(' 172.16.5.4 / 30 '), '172.16.5.4/30');
  // range senza prefisso -> la /24 che lo contiene
  assert.equal(subnetInputToCidr('192.168.10.1-254'), '192.168.10.0/24');
  assert.equal(subnetInputToCidr('192.168.10.50-99'), '192.168.10.0/24');
  // IP singolo -> la sua /24
  assert.equal(subnetInputToCidr('192.168.10.7'), '192.168.10.0/24');
  // non parsabile / vuoto -> ''
  assert.equal(subnetInputToCidr(''), '');
  assert.equal(subnetInputToCidr('non-una-rete'), '');
  assert.equal(subnetInputToCidr('999.1.1.1'), '');
});

// ============================================================
// IPv6 — una VLAN dual-stack ha un /24 E un /64: entrambi devono essere
// dichiarabili. L'espansione dell'indirizzo arriva da lib/ipv6.js.
// ============================================================

test('_parseCidrInfo: la famiglia e` esplicita, non dedotta dal chiamante', () => {
  assert.equal(_parseCidrInfo('192.168.10.0/24').family, 4);
  assert.equal(_parseCidrInfo('2001:db8:0:14::/64').family, 6);
  // Sull'oggetto v6 i campi a 32 bit NON esistono: chi fa aritmetica deve
  // guardare `family` prima, e senza il campo se ne accorge subito.
  const c6 = _parseCidrInfo('2001:db8:0:14::/64');
  assert.equal(c6.network, undefined);
  assert.equal(c6.broadcast, undefined);
  assert.equal(c6.mask, undefined);
});

test('_parseCidrInfo: IPv6, indirizzo di rete e prefisso', () => {
  const c = _parseCidrInfo('2001:db8:0:14::/64');
  assert.equal(c.prefix, 64);
  assert.deepEqual(c.network6, [0x2001, 0x0db8, 0, 0x14, 0, 0, 0, 0]);

  // la parte host viene azzerata, esattamente come per l'IPv4
  assert.deepEqual(_parseCidrInfo('2001:db8:0:14::5/64').network6, c.network6);
  assert.deepEqual(_parseCidrInfo('2001:DB8:0:14:aaaa:bbbb:cccc:dddd/64').network6, c.network6);

  // prefisso non allineato alle word (10 bit -> maschera dentro la prima word)
  assert.deepEqual(_parseCidrInfo('fe80::/10').network6, [0xfe80, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(_parseCidrInfo('febf::1/10').network6, [0xfe80, 0, 0, 0, 0, 0, 0, 0]);

  // estremi
  assert.deepEqual(_parseCidrInfo('::1/128').network6, [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(_parseCidrInfo('2001:db8::1/0').network6, [0, 0, 0, 0, 0, 0, 0, 0]);
  // zone-id: non fa parte dell'indirizzo, si scarta
  assert.deepEqual(_parseCidrInfo('fe80::1%eth0/64').network6, [0xfe80, 0, 0, 0, 0, 0, 0, 0]);
});

test('_parseCidrInfo: IPv6 malformato -> null (mai un indirizzo inventato)', () => {
  assert.equal(_parseCidrInfo('2001:db8::/129'), null);   // prefisso fuori range
  assert.equal(_parseCidrInfo('2001:db8::'), null);       // senza prefisso
  assert.equal(_parseCidrInfo('gggg::/64'), null);        // hextet non valido
  assert.equal(_parseCidrInfo('2001:db8::1::2/64'), null); // due compressioni
  assert.equal(_parseCidrInfo('2001:db8:0:14/64'), null); // troppo poche word
  // regressione: un IPv4 con prefisso fuori range non deve scivolare nel ramo v6
  assert.equal(_parseCidrInfo('192.168.1.0/33'), null);
  assert.equal(_parseCidrInfo('192.168.1.0/128'), null);
});

test('_ipInCidr: IPv6 e famiglie che non si mescolano', () => {
  const c64 = _parseCidrInfo('2001:db8:0:14::/64');
  assert.equal(_ipInCidr('2001:db8:0:14::1', c64), true);
  assert.equal(_ipInCidr('2001:db8:0:14:ffff:ffff:ffff:ffff', c64), true);
  assert.equal(_ipInCidr('2001:db8:0:15::1', c64), false);
  assert.equal(_ipInCidr('non-un-ip', c64), false);

  const cLl = _parseCidrInfo('fe80::/10');
  assert.equal(_ipInCidr('fe80::1', cLl), true);
  assert.equal(_ipInCidr('febf::1', cLl), true);
  assert.equal(_ipInCidr('fec0::1', cLl), false);

  // v4 dentro un prefisso v6 e viceversa: sempre false, mai un match casuale
  assert.equal(_ipInCidr('192.168.10.1', c64), false);
  assert.equal(_ipInCidr('2001:db8:0:14::1', _parseCidrInfo('192.168.10.0/24')), false);
});

test('_cidrsOverlap: intersezione e contenimento, mai fra famiglie diverse', () => {
  const C = _parseCidrInfo;
  // stessa rete
  assert.equal(_cidrsOverlap(C('192.168.10.0/24'), C('192.168.10.0/24')), true);
  // contenimento in tutte e due le direzioni (l'ordine non conta)
  assert.equal(_cidrsOverlap(C('192.168.10.0/24'), C('192.168.10.128/25')), true);
  assert.equal(_cidrsOverlap(C('192.168.10.128/25'), C('192.168.10.0/24')), true);
  assert.equal(_cidrsOverlap(C('10.0.0.0/8'), C('10.20.30.0/24')), true);
  // adiacenti ma disgiunte
  assert.equal(_cidrsOverlap(C('192.168.10.0/25'), C('192.168.10.128/25')), false);
  assert.equal(_cidrsOverlap(C('192.168.10.0/24'), C('192.168.11.0/24')), false);

  // IPv6: stessa matematica
  assert.equal(_cidrsOverlap(C('2001:db8::/32'), C('2001:db8:0:14::/64')), true);
  assert.equal(_cidrsOverlap(C('2001:db8:0:14::/64'), C('2001:db8:0:15::/64')), false);

  // ⚠️ Famiglie diverse: un /24 IPv4 e un /64 IPv6 sulla stessa VLAN sono
  // dual-stack, NON un conflitto di indirizzamento.
  assert.equal(_cidrsOverlap(C('192.168.10.0/24'), C('2001:db8:0:14::/64')), false);
  assert.equal(_cidrsOverlap(null, C('10.0.0.0/8')), false);
  assert.equal(_cidrsOverlap(C('10.0.0.0/8'), null), false);
});

test('subnetInputToCidr: IPv6 -> prefisso canonico da dichiarare', () => {
  assert.equal(subnetInputToCidr('2001:db8:0:14::/64'), '2001:db8:0:14::/64');
  assert.equal(subnetInputToCidr('2001:db8:0:14::5/64'), '2001:db8:0:14::/64');
  assert.equal(subnetInputToCidr('2001:DB8:0:14:aaaa::5 / 64'), '2001:db8:0:14::/64');
  // IPv6 nudo -> la sua /64 (SLAAC, RFC 4291), gemello del "IP singolo -> /24"
  assert.equal(subnetInputToCidr('2001:db8:0:14::5'), '2001:db8:0:14::/64');
  // v4 invariato anche ora che il ramo v6 esiste
  assert.equal(subnetInputToCidr('192.168.10.7'), '192.168.10.0/24');
  assert.equal(subnetInputToCidr('gggg::/64'), '');
});

// ---- addrFamily / addrKey ---------------------------------------------------
// L'identita' di un INDIRIZZO (non di un prefisso). Vivono qui, con l'aritmetica
// degli indirizzi, e le usano lib/l3-gateway.js e lib/ipam-audit.js: la stessa
// regola scritta in due strati diverge al primo ritocco.
test('addrFamily: riconosce la specie, e dice null su cio\' che non e\' un indirizzo', () => {
  assert.equal(addrFamily('192.168.1.1'), 4);
  assert.equal(addrFamily('2001:db8::1'), 6);
  assert.equal(addrFamily('fe80::1%eth0'), 6);       // lo zone-id non fa parte dell'indirizzo
  assert.equal(addrFamily('::ffff:192.168.1.1'), 6); // IPv4-mapped: e' comunque un IPv6
  assert.equal(addrFamily(''), null);
  assert.equal(addrFamily(null), null);
  assert.equal(addrFamily('192.168.1.999'), null, 'ottetto fuori range: non e\' un IPv4');
  assert.equal(addrFamily('gggg::1'), null, 'non e\' esadecimale: non e\' un IPv6');
  assert.equal(addrFamily('switch-01'), null, 'un hostname non e\' un indirizzo');
});

test('addrKey: due scritture dello stesso IPv6 hanno la STESSA chiave', () => {
  assert.equal(addrKey('2001:DB8:0:20:0:0:0:1'), addrKey('2001:db8:0:20::1'));
  assert.equal(addrKey('2001:db8:0:20::1'), '2001:db8:0:20::1');
  // Indirizzi diversi restano diversi: la normalizzazione non collassa nulla.
  assert.notEqual(addrKey('2001:db8:0:20::1'), addrKey('2001:db8:0:20::2'));
  // IPv4: la stringa e' gia' la sua forma canonica, e non va toccata.
  assert.equal(addrKey('192.168.1.1'), '192.168.1.1');
  assert.equal(addrKey('  192.168.1.1  '), '192.168.1.1');
  assert.equal(addrKey(''), '');
  assert.equal(addrKey(null), '');
  // Cio' che non si parsa fa da chiave a se' stesso: niente collassi fra stringhe
  // diverse (due hostname non diventano lo stesso "indirizzo").
  assert.equal(addrKey('gggg::1'), 'gggg::1');
  assert.notEqual(addrKey('gggg::1'), addrKey('hhhh::1'));
});

// ---- AUDIT 2026-08-13: fix F1 (addrKey v4 canonico) + F5 (link-local) ------
test('addrKey: IPv4 con zeri iniziali collassa sulla forma canonica (F1)', () => {
  // Il validatore accetta "192.168.001.005" (decimale) → la chiave dev\'essere la
  // stessa di "192.168.1.5", altrimenti due grafie contano come due indirizzi.
  assert.equal(addrKey('192.168.001.005'), addrKey('192.168.1.5'));
  assert.equal(addrKey('192.168.001.005'), '192.168.1.5');
  assert.equal(addrKey('10.0.0.1'), '10.0.0.1');          // già canonico: invariato
  assert.equal(addrKey('switch-01'), 'switch-01');        // non-IPv4 senza ':' → sé stesso
});

test('addrIsLinkLocalV6: riconosce fe80::/10, non il global/ULA (F5)', () => {
  assert.equal(addrIsLinkLocalV6('fe80::1'), true);
  assert.equal(addrIsLinkLocalV6('febf::1'), true);        // ancora dentro /10
  assert.equal(addrIsLinkLocalV6('fec0::1'), false);       // fuori /10
  assert.equal(addrIsLinkLocalV6('2001:db8::1'), false);
  assert.equal(addrIsLinkLocalV6('fd00::1'), false);       // ULA, non link-local
  assert.equal(addrIsLinkLocalV6('10.0.0.1'), false);
  assert.equal(addrIsLinkLocalV6(''), false);
});

// ── D2: il segmento di un indirizzo, definito UNA volta ─────────────────────
// «I primi tre ottetti» era riscritto in cinque punti, e in due di quelli
// l'assunzione /24 DECIDEVA un verdetto (assenza provata, on/off-segment).
// Qui l'assunzione resta, ma dichiarata, e il prefisso DICHIARATO la batte.
test('segmentKey: senza prefissi resta la convenzione storica (/24 v4, /64 v6)', () => {
  assert.equal(segmentKey('10.0.1.7'), '10.0.1');
  assert.equal(segmentKey('192.168.1.250'), '192.168.1');
  assert.equal(segmentKey('2001:db8:0:14::5'), '2001:db8:0:14::/64');
  assert.equal(segmentKey('mela'), '');
  assert.equal(segmentKey(''), '');
});

test('segmentKey: una /22 dichiarata tiene insieme quattro /24 (niente confine inventato)', () => {
  const P = [{ cidr: '10.0.0.0/22' }];
  assert.equal(segmentKey('10.0.1.7', P), '10.0.0.0/22');
  assert.equal(segmentKey('10.0.3.9', P), '10.0.0.0/22');
  assert.equal(segmentKey('10.0.1.7', P), segmentKey('10.0.3.9', P), 'stessa rete = stesso segmento');
  assert.notEqual(segmentKey('10.9.9.9', P), '10.0.0.0/22', 'fuori dalla rete dichiarata');
});

test('segmentKey: due /25 dentro una /24 restano DUE segmenti (era la copertura sovrastimata)', () => {
  const P = [{ cidr: '192.168.1.0/25' }, { cidr: '192.168.1.128/25' }];
  const bassa = segmentKey('192.168.1.10', P);
  const alta = segmentKey('192.168.1.130', P);
  assert.equal(bassa, '192.168.1.0/25');
  assert.equal(alta, '192.168.1.128/25');
  assert.notEqual(bassa, alta, 'sondare una metà non prova nulla sull\'altra');
});

test('segmentKey: vince il prefisso PIÙ SPECIFICO, come per la VLAN di un IP', () => {
  const P = [{ cidr: '10.0.0.0/16' }, { cidr: '10.0.5.0/24' }];
  assert.equal(segmentKey('10.0.5.7', P), '10.0.5.0/24');
  assert.equal(segmentKey('10.0.9.7', P), '10.0.0.0/16');
});

test('segmentKey: accetta i prefissi come stringhe o come righe IPAM, e ignora il rumore', () => {
  assert.equal(segmentKey('10.0.1.7', ['10.0.0.0/22']), '10.0.0.0/22');
  assert.equal(segmentKey('10.0.1.7', [null, {}, { cidr: '' }, { cidr: 'mela' }]), '10.0.1');
  assert.equal(segmentKey('10.0.1.7', 'non-un-elenco'), '10.0.1');
});
