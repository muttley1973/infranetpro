'use strict';
// ============================================================
// INTER-SEDE — test del modello multi-sede, Fase 0 (lib/inter-site.js).
//
// Le invarianti che questo modulo deve difendere:
//   ② no-invenzioni — un `kind` fuori vocabolario si RIFIUTA, non si corregge;
//      `reach` assente ≠ nessuna subnet; una subnet in due sedi resta ambigua;
//   ③ vendor-neutral — `reach` è UN concetto per tutti i `kind` (su un ipsec è
//      l'encryption domain), e nessun campo nomina un vendor;
//   · l'envelope sta SOLO sui campi misurabili (⚠️ cirMbps è contrattuale, mai ifSpeed);
//   · `state` non ha il valore 'declared': chi lo afferma è l'ORIGINE del fatto;
//   · le subnet si canonicalizzano con lib/cidr — mai confronti per stringa nuda;
//   · un dato reale e sbagliato (capo verso una sede inesistente) NON si nasconde.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const IS = require('../lib/inter-site.js');
const { factDeclared, factMeasured, factDerived } = require('../lib/provenance.js');

const {
  SITE_ROLES, INTER_SITE_STATES, WAN_ADDRESSING,
  INTER_SITE_TRANSPORTS, INTER_SITE_TUNNELS,
  normalizeSubnets, normalizeSite, normalizeWanUplink, normalizeInterSiteLink,
  normalizeOrganization,
  linkSites, linkPeerSite, linkReach, linkReachAt,
  uplinksOfSite, linksOfSite, siteById,
  subnetSiteIndex, siteOfSubnet,
} = IS;

const AT = '2026-08-28T00:00:00.000Z';

const ipsec = (over) => Object.assign({
  id: 'l1', aSiteId: 'hq', bSiteId: 'rm', kind: 'ipsec',
}, over || {});

// ── Vocabolari chiusi ──────────────────────────────────────────────────────
test('i vocabolari sono chiusi e contengono esattamente ciò che è stato deciso', () => {
  assert.deepStrictEqual(SITE_ROLES, ['hub', 'spoke', 'standalone']);
  // ⑨ `other` in FONDO: la porta di servizio non sta fra le scelte precise.
  // ⑲ L'ordine È il contenuto: è quello che si legge nella tendina, e cambiarlo
  // per sbaglio riordinerebbe un menu senza che nessuno se ne accorga.
  // ㉔ DUE vocabolari, non uno: su cosa viaggia, e cosa ci corre sopra.
  assert.deepStrictEqual(INTER_SITE_TRANSPORTS, [
    'internet', 'mpls', 'vpls', 'vpws', 'vxlan', 'evpn', 'directLink', 'other',
  ]);
  assert.deepStrictEqual(INTER_SITE_TUNNELS, [
    'none', 'ipsec', 'gre', 'wireguard', 'openvpn', 'l2tp', 'sdwan', 'other',
  ]);
  for (const v of [INTER_SITE_TRANSPORTS, INTER_SITE_TUNNELS]) {
    assert.equal(v[v.length - 1], 'other', 'other in fondo');
  }
  // ㉔ `sdwan` è un TUNNEL: una SD-WAN è un overlay, cioè ciò che corre sopra a
  // uno o più trasporti — ed è il motivo per cui `underlayUplinkIds` esiste.
  assert.ok(INTER_SITE_TUNNELS.indexOf('sdwan') >= 0 && INTER_SITE_TRANSPORTS.indexOf('sdwan') < 0);
  // ③ 'declared' NON è uno stato: è un'origine. Vedi la scelta ③ del modulo.
  assert.deepStrictEqual(INTER_SITE_STATES, ['up', 'down']);
  // ㉑ Tre modi, e sono i tre che cambiano cosa si digita sul router.
  assert.deepStrictEqual(WAN_ADDRESSING, ['static', 'dhcp', 'pppoe']);
});

// ── Subnet: canonicalizzazione, non confronto per stringa ──────────────────
test('le subnet si canonicalizzano con lib/cidr (host bits, netmask, spazi)', () => {
  assert.deepStrictEqual(
    normalizeSubnets(['10.1.0.5/24', ' 192.168.1.0/255.255.255.0 ', '2001:db8::/48']),
    ['10.1.0.0/24', '192.168.1.0/24', '2001:db8::/48']);
});

test('la stessa rete scritta in due modi è UNA subnet sola', () => {
  assert.deepStrictEqual(normalizeSubnets(['10.1.0.0/24', '10.1.0.7/24']), ['10.1.0.0/24']);
});

test('② ciò che non è una subnet cade, non viene indovinato', () => {
  assert.deepStrictEqual(normalizeSubnets(['garbage', '', null, undefined, {}, '10.1.0.0/24']),
    ['10.1.0.0/24']);
  assert.deepStrictEqual(normalizeSubnets(null), []);
  assert.deepStrictEqual(normalizeSubnets('10.1.0.0/24'), [], 'una stringa non è una lista');
});

// ── Sede ───────────────────────────────────────────────────────────────────
test('una sede senza id o senza nome non entra', () => {
  assert.strictEqual(normalizeSite(null), null);
  assert.strictEqual(normalizeSite({ name: 'HQ' }), null);
  assert.strictEqual(normalizeSite({ id: 'hq' }), null);
  assert.strictEqual(normalizeSite({ id: '  ', name: 'HQ' }), null);
});

test('una sede normalizza ruolo, riferimento al progetto e subnet', () => {
  assert.deepStrictEqual(
    normalizeSite({ id: ' hq ', name: ' Milano ', role: 'hub', projectRef: 'p-1', subnets: ['10.1.0.9/24'] }),
    { id: 'hq', name: 'Milano', role: 'hub', projectRef: 'p-1', address: null, subnets: ['10.1.0.0/24'] });
});

test('② un ruolo fuori vocabolario non si corregge in silenzio: standalone', () => {
  assert.strictEqual(normalizeSite({ id: 'x', name: 'X', role: 'HUB' }).role, 'standalone');
  assert.strictEqual(normalizeSite({ id: 'x', name: 'X', role: 'primario' }).role, 'standalone');
});

test('① il progetto-sede è un RIFERIMENTO, non una copia', () => {
  const s = normalizeSite({ id: 'hq', name: 'Milano', projectRef: 'p-1' });
  assert.strictEqual(s.projectRef, 'p-1');
  assert.ok(!('project' in s) && !('nodes' in s), 'la sede non porta dentro il progetto');
});

// ── Uplink WAN ─────────────────────────────────────────────────────────────
test('un uplink senza sede non entra', () => {
  assert.strictEqual(normalizeWanUplink({ id: 'u1' }), null);
  assert.strictEqual(normalizeWanUplink({ siteId: 'hq' }), null);
});

test('④ i campi dichiarati-per-costruzione restano nudi, i misurabili sono envelope', () => {
  const u = normalizeWanUplink({
    id: 'u1', siteId: 'hq',
    provider: 'Acme', serviceType: 'fiber', circuitId: 'CID-9', cirMbps: '100',
    publicIps: factMeasured(['203.0.113.7'], AT),
    wanIfRef: factDeclared('wan1'),
  });
  // dichiarati: nudi — un envelope qui direbbe una cosa in più che non c'è
  assert.strictEqual(u.provider, 'Acme');
  assert.strictEqual(u.circuitId, 'CID-9');
  // ⚠️ banda CONTRATTUALE, non ifSpeed
  assert.strictEqual(u.cirMbps, 100);
  // misurabili: envelope intatto, con la sua origine
  assert.deepStrictEqual(u.publicIps, { origin: 'measured', value: ['203.0.113.7'], at: AT });
  assert.deepStrictEqual(u.wanIfRef, { origin: 'declared', value: 'wan1' });
});

// ── ㉑ I campi con cui una linea si rimette su ─────────────────────────────
// La scheda esiste per la notte in cui la linea è giù: ogni campo qui sotto
// risponde a una domanda che si fa quella notte, e nessuno lo riempie un import.

test('㉑ indirizzamento, gateway, VLAN di consegna, MTU e contatto', () => {
  const u = normalizeWanUplink({
    id: 'u1', siteId: 'hq',
    addressing: 'pppoe', nextHop: '203.0.113.1', deliveryVlan: '835', mtu: '1492',
    supportRef: 'https://noc.example/ticket',
  });
  assert.strictEqual(u.addressing, 'pppoe');
  assert.strictEqual(u.nextHop, '203.0.113.1');
  assert.strictEqual(u.deliveryVlan, 835);
  assert.strictEqual(u.mtu, 1492);
  assert.strictEqual(u.supportRef, 'https://noc.example/ticket');
});

test('㉑ un modo d\'indirizzamento fuori vocabolario si RIFIUTA, non si corregge', () => {
  // ⑤ Meglio un campo vuoto che uno pieno di una parola che nessuno riconosce:
  // «non dichiarato» è una risposta, «unnumbered» letto come statico è una bugia.
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', addressing: 'unnumbered' }).addressing, null);
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', addressing: 'STATIC' }).addressing, null);
});

test('㉑ il gateway è un INDIRIZZO, e non diventa la sua rete', () => {
  // ⑦ La stessa trappola degli indirizzi pubblici: `subnetInputToCidr` farebbe
  // di 203.0.113.1 la 203.0.113.0/24 — un altro fatto, e più grande.
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', nextHop: '203.0.113.1' }).nextHop, '203.0.113.1');
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', nextHop: '203.0.113.0/24' }).nextHop, null);
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', nextHop: 'il router di sopra' }).nextHop, null);
  // IPv6: stessa strada, e in forma canonica
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', nextHop: '2001:DB8::1' }).nextHop, '2001:db8::1');
});

test('㉑ una VLAN di consegna sta fra 1 e 4094: 0 e 4095 sono RISERVATI', () => {
  const v = (x) => normalizeWanUplink({ id: 'u', siteId: 's', deliveryVlan: x }).deliveryVlan;
  assert.strictEqual(v(1), 1);
  assert.strictEqual(v(4094), 4094);
  assert.strictEqual(v(0), null);
  assert.strictEqual(v(4095), null, 'riservata: nessuno può consegnare lì');
  assert.strictEqual(v(1.5), null, 'una VLAN si conta, non si misura');
});

test('㉑ nessun tetto sull\'MTU, come per la banda: è materia dell\'audit', () => {
  // Un limite scelto oggi rifiuterebbe domani una consegna vera (paletto ③).
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', mtu: 9216 }).mtu, 9216);
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', mtu: 0 }).mtu, null);
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', mtu: 1500.5 }).mtu, null);
});

test('㉑ 🔒 il contatto dell\'operatore non porta credenziali', () => {
  // Stessa guardia di `node.backup.ref`, e non una seconda scritta qui: un
  // segreto in un campo che si stampa e si manda in giro è un segreto perso.
  const u = normalizeWanUplink({ id: 'u', siteId: 's', supportRef: 'https://tizio:segreto@noc.example/x' });
  assert.strictEqual(u.supportRef, null, 'con le credenziali dentro non si persiste niente');
});

test('㉓ la proposta di un tunnel: due frasi da ridigitare, e DOVE sta la chiave', () => {
  const l = normalizeInterSiteLink({
    id: 't1', aSiteId: 'a', bSiteId: 'b', kind: 'ipsec',
    phase1Proposal: 'aes256-sha256-modp2048 - 28800s',
    phase2Proposal: 'esp-aes256-sha256 - PFS group 14 - 3600s',
    pskRef: 'Bitwarden / VPN / MI-RM',
  });
  // ⚠️ Testo libero, e non dodici campi: ogni piattaforma scrive la proposta a
  // modo suo, e spezzarla obbligherebbe a normalizzare fra vendor (paletto ③).
  assert.strictEqual(l.phase1Proposal, 'aes256-sha256-modp2048 - 28800s');
  assert.strictEqual(l.phase2Proposal, 'esp-aes256-sha256 - PFS group 14 - 3600s');
  assert.strictEqual(l.pskRef, 'Bitwarden / VPN / MI-RM');
});

test('㉓ 🔒 il puntatore alla chiave non porta credenziali', () => {
  // Stessa guardia di `node.backup.ref`: un segreto in un campo che si stampa
  // e si manda in giro è un segreto perso.
  const l = normalizeInterSiteLink({ id: 't1', aSiteId: 'a', bSiteId: 'b', kind: 'ipsec',
    pskRef: 'https://vault:chiavesegreta@vault.example/kv/vpn' });
  assert.strictEqual(l.pskRef, null);
});

test('㉓ la proposta è di IPsec: su un GRE non esiste un campo da riempire', () => {
  // ⑲ Chiedere una proposta IKE a un GRE sarebbe chiedere un dato che non esiste.
  const g = normalizeInterSiteLink({ id: 'g', aSiteId: 'a', bSiteId: 'b', kind: 'gre', phase1Proposal: 'x' });
  assert.strictEqual(g.phase1Proposal, undefined);
});

test('② un valore NUDO su un campo misurabile non viene promosso a fatto', () => {
  const u = normalizeWanUplink({ id: 'u1', siteId: 'hq', publicIps: ['203.0.113.7'] });
  assert.strictEqual(u.publicIps, null, 'senza envelope non sappiamo da dove viene: null');
});

// ── ⑦ Gli indirizzi pubblici sono PIÙ DI UNO ───────────────────────────────
test('⑦ un uplink porta un BLOCCO instradato, l\'IPv6 e gli indirizzi dei nodi', () => {
  // I tre casi ordinari per cui un campo solo era falso: la /29 del contratto,
  // l'IPv6 sulla stessa linea, e la coppia in HA con il suo VIP.
  const u = normalizeWanUplink({
    id: 'u1', siteId: 'hq',
    publicIps: factDeclared(['203.0.113.8/29', '2001:db8:1::1', '203.0.113.10', '203.0.113.11']),
  });
  assert.deepStrictEqual(u.publicIps.value,
    ['203.0.113.8/29', '2001:db8:1::1', '203.0.113.10', '203.0.113.11']);
});

test('⑦ un INDIRIZZO non diventa la sua rete', () => {
  // La trappola vera: passare un indirizzo per `subnetInputToCidr` lo
  // trasformerebbe in `203.0.113.0/24` — un altro fatto, e molto più grande.
  const u = normalizeWanUplink({ id: 'u1', siteId: 'hq', publicIps: factDeclared(['203.0.113.10']) });
  assert.deepStrictEqual(u.publicIps.value, ['203.0.113.10']);
});

test('⑦ un blocco SÌ si canonicalizza come rete, e i doppioni cadono', () => {
  const u = normalizeWanUplink({
    id: 'u1', siteId: 'hq',
    publicIps: factDeclared(['203.0.113.9/29', '203.0.113.8/29', 'non-un-indirizzo', '']),
  });
  assert.deepStrictEqual(u.publicIps.value, ['203.0.113.8/29'], 'stessa rete scritta in due modi = una');
});

test('⑦ l\'ORDINE dichiarato si conserva: il primo è l\'indirizzo dell\'interfaccia', () => {
  // A differenza delle subnet, che si ordinano: qui l'ordine è una convenzione
  // di chi scrive, e riordinare per fare pulizia la cancellerebbe in silenzio.
  const u = normalizeWanUplink({
    id: 'u1', siteId: 'hq', publicIps: factDeclared(['203.0.113.90', '203.0.113.10']),
  });
  assert.deepStrictEqual(u.publicIps.value, ['203.0.113.90', '203.0.113.10']);
});

test('⑦ il vecchio campo singolare `publicIp` non si perde: diventa il primo della lista', () => {
  // Retro-compatibilità a senso unico, e l'origine e la data NON cambiano:
  // migrare la forma di un valore non deve cambiare ciò che si sa di lui.
  const u = normalizeWanUplink({ id: 'u1', siteId: 'hq', publicIp: factMeasured('203.0.113.7', AT) });
  assert.deepStrictEqual(u.publicIps, { origin: 'measured', value: ['203.0.113.7'], at: AT });
  assert.ok(!('publicIp' in u), 'il campo vecchio non sopravvive accanto al nuovo');
});

test('cirMbps non numerico è null, non 0 (0 Mbps sarebbe un\'affermazione)', () => {
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', cirMbps: 'cento' }).cirMbps, null);
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', cirMbps: '' }).cirMbps, null);
  assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', cirMbps: undefined }).cirMbps, null);
});

test('⭐ ⑩ zero e i negativi non sono banda BASSA: non sono banda', () => {
  // Questa riga prima passava (`0 → 0`), sul ragionamento che uno zero SCRITTO
  // è una dichiarazione. Ma una linea da 0 Mbps non esiste, e il posto dove
  // finiva è la scheda di ripristino: là «Banda contrattuale: 0 Mbps» si legge
  // come un fatto misurato che dice «questa linea non porta niente».
  // Un trattino dice la verità — «non risulta» — e non manda nessuno fuori strada.
  const cir = (v) => normalizeWanUplink({ id: 'u', siteId: 's', cirMbps: v }).cirMbps;
  assert.strictEqual(cir(0), null, 'una linea da 0 Mbps non è una linea');
  assert.strictEqual(cir(-100), null);
  assert.strictEqual(cir('-100'), null, 'anche digitata: `min` non impedisce di scriverla');
  assert.strictEqual(cir(Infinity), null);
  assert.strictEqual(cir(-0), null);
  // ⚠️ E ciò che è banda resta intatto, incluse le frazioni (una 0.5 Mbps
  // esiste) e i numeri grandi: nessun tetto massimo inventato (paletto ③).
  assert.strictEqual(cir(100), 100);
  assert.strictEqual(cir('100'), 100);
  assert.strictEqual(cir(0.5), 0.5);
  assert.strictEqual(cir(400000), 400000, '400G è una linea vera, non un errore di battitura');
});

test('⭐ la stessa regola che l\'import applica da sempre — una sola definizione, due strade', () => {
  // `lib/dcim-wan.js` scarta `n <= 0` da prima che il pannello esistesse: il
  // difetto era che il percorso A MANO diceva un'altra cosa. Se un giorno le due
  // divergono di nuovo, è qui che si vede.
  const { _cirMbps } = require('../lib/dcim-wan.js');
  for (const kbps of [0, -1, -100000]) {
    assert.strictEqual(_cirMbps(kbps), null, 'import: ' + kbps);
    assert.strictEqual(normalizeWanUplink({ id: 'u', siteId: 's', cirMbps: kbps / 1000 }).cirMbps, null,
      'modello: ' + (kbps / 1000));
  }
});

// ── Collegamento inter-sede ────────────────────────────────────────────────
test('㉔ un valore fuori vocabolario diventa «non dichiarato», e la riga RESTA', () => {
  // ⚠️ Il cambio più delicato dei due assi. Con `kind` il rifiuto aveva un
  // motivo: quel campo DISCRIMINAVA l'unione, e una natura ignota lasciava un
  // oggetto senza forma. Ora i due assi sono facoltativi come `role` o
  // `addressing`, e buttare via un collegamento intero — i due capi, le reti,
  // le linee spuntate — per una parola storta sarebbe peggio del male.
  // ⑲ `pptp` è un incapsulamento VERO di NetBox tenuto deliberatamente FUORI dal
  // nostro vocabolario: è l'esempio giusto, non un nome che nessuno scriverebbe.
  for (const brutto of ['pptp', 'IPSEC', 'eolo', undefined]) {
    const l = normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', tunnel: brutto });
    assert.ok(l, 'il collegamento non si perde per una parola storta');
    assert.strictEqual(l.tunnel, null, 'e la parola storta non entra: resta «non dichiarato»');
  }
  // Ma un collegamento senza IDENTITÀ o senza due capi diversi resta rifiutato:
  // quello non è un collegamento inter-sede, ed è un'altra cosa.
  assert.strictEqual(normalizeInterSiteLink({ aSiteId: 'a', bSiteId: 'b' }), null);
  assert.strictEqual(normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'a' }), null);
});

test('㉔ MIGRAZIONE: un `kind` di ieri finisce sull\'asse giusto, e l\'altro resta VUOTO', () => {
  // ⚠️ L'asse che il vecchio campo non nominava resta `null`, non un valore di
  // comodo: un `kind: 'ipsec'` diceva «c'è un IPsec» e NON diceva su cosa
  // corresse. Scrivere `transport: 'internet'` sarebbe inventare — e quel caso,
  // l'IPsec sopra l'MPLS, è esattamente ciò che questo cambio rende scrivibile.
  const t = normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'ipsec' });
  assert.strictEqual(t.tunnel, 'ipsec');
  assert.strictEqual(t.transport, null, 'il vecchio campo non diceva su cosa correva');

  const c = normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'mpls' });
  assert.strictEqual(c.transport, 'mpls');
  assert.strictEqual(c.tunnel, null, 'e non dichiarava «nessun tunnel»: non poteva dirlo');

  // ⑨ Il vecchio `kindLabel` è del TRASPORTO: un `other` era una cosa che PORTA
  // il collegamento — un servizio d'operatore senza nome, un ponte radio.
  const o = normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'other', kindLabel: 'ponte radio' });
  assert.strictEqual(o.transport, 'other');
  assert.strictEqual(o.transportLabel, 'ponte radio');

  // Idempotente: rileggere un documento GIÀ migrato non lo tocca.
  assert.deepStrictEqual(normalizeInterSiteLink(t), t);
  // E se i due assi sono già scritti, `kind` non li sovrascrive.
  const due = normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b',
    kind: 'ipsec', transport: 'mpls', tunnel: 'gre' });
  assert.strictEqual(due.transport, 'mpls');
  assert.strictEqual(due.tunnel, 'gre');
});

test('㉔ i DUE assi insieme: «IPsec sopra MPLS», che prima non si poteva scrivere', () => {
  const l = normalizeInterSiteLink({
    id: 'l', aSiteId: 'a', bSiteId: 'b', transport: 'mpls', tunnel: 'ipsec',
    vrf: 'CORP', service: 'L3VPN', phase1Name: 'P1',
  });
  assert.strictEqual(l.transport, 'mpls');
  assert.strictEqual(l.tunnel, 'ipsec');
  // e i campi propri dei DUE assi convivono, perché sono di due cose diverse
  assert.strictEqual(l.vrf, 'CORP');
  assert.strictEqual(l.phase1Name, 'P1');
});

test('㉔ `none` non è `null`: «guardato, non c\'è» ≠ «non l\'ho scritto»', () => {
  // È la stessa distinzione di `state` (③): un MPLS in chiaro è una SCELTA.
  const n = normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', transport: 'mpls', tunnel: 'none' });
  assert.strictEqual(n.tunnel, 'none');
  const v = normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', transport: 'mpls' });
  assert.strictEqual(v.tunnel, null);
});

test('un collegamento senza id o senza uno dei due capi non entra', () => {
  assert.strictEqual(normalizeInterSiteLink(ipsec({ id: '' })), null);
  assert.strictEqual(normalizeInterSiteLink(ipsec({ aSiteId: '' })), null);
  assert.strictEqual(normalizeInterSiteLink(ipsec({ bSiteId: '' })), null);
});

test('una sede non si collega a sé stessa: non è inter-sede', () => {
  assert.strictEqual(normalizeInterSiteLink(ipsec({ aSiteId: 'hq', bSiteId: 'hq' })), null);
});

test('ogni kind porta i suoi campi propri, e solo quelli', () => {
  const l = normalizeInterSiteLink(ipsec({
    endpointA: { deviceRef: 'fw-hq', peerIp: '198.51.100.1' },
    endpointB: { deviceRef: 'fw-rm', peerIp: '198.51.100.2' },
    phase1Name: 'HQ-to-RM', ikeVersion: 2,
  }));
  assert.strictEqual(l.tunnel, 'ipsec');
  assert.deepStrictEqual(l.endpointA, { deviceRef: 'fw-hq', deviceName: null, peerIp: '198.51.100.1' });
  assert.strictEqual(l.phase1Name, 'HQ-to-RM');
  assert.strictEqual(l.ikeVersion, 2);

  const m = normalizeInterSiteLink({ id: 'l2', aSiteId: 'hq', bSiteId: 'na', kind: 'mpls', vrf: 'CORP', service: 'L3VPN' });
  assert.strictEqual(m.vrf, 'CORP');
  assert.ok(!('phase1Name' in m) && !('ikeVersion' in m), 'niente campi ipsec su un mpls');

  const s = normalizeInterSiteLink({ id: 'l3', aSiteId: 'hq', bSiteId: 'na', kind: 'sdwan', overlay: 'ov1', underlayUplinkIds: ['u1', '', 'u2'] });
  assert.deepStrictEqual(s.underlayUplinkIds, ['u1', 'u2']);

  const d = normalizeInterSiteLink({ id: 'l4', aSiteId: 'hq', bSiteId: 'na', kind: 'directLink', media: 'fibra' });
  assert.strictEqual(d.media, 'fibra');
});

test('⑥ i due capi valgono per OGNI kind, non solo per l\'IPsec', () => {
  // «Su quale apparato arriva questo collegamento» non è una domanda sulla
  // crittografia: su un MPLS o un VPLS il capo è il CE, che sta in un rack e ha
  // delle porte come tutti gli altri. Quando i capi vivevano solo su `ipsec`, la
  // domanda era inesprimibile proprio sui collegamenti d'operatore — cioè su
  // quelli dove serve di più, perché la scatola spesso non l'hai configurata tu.
  for (const kind of ['mpls', 'vpls', 'sdwan', 'directLink']) {
    const l = normalizeInterSiteLink({
      id: 'l-' + kind, aSiteId: 'hq', bSiteId: 'na', kind,
      endpointA: { deviceRef: 'ce-hq', peerIp: '10.255.0.1' },
      endpointB: { deviceRef: 'ce-na', peerIp: null },
    });
    assert.deepStrictEqual(l.endpointA, { deviceRef: 'ce-hq', deviceName: null, peerIp: '10.255.0.1' }, kind);
    assert.deepStrictEqual(l.endpointB, { deviceRef: 'ce-na', deviceName: null, peerIp: null }, kind);
  }
});

test('⑥ un collegamento senza capi dichiarati porta due capi VUOTI, non l\'assenza del campo', () => {
  // La forma è sempre la stessa: chi legge non deve difendersi da `undefined`,
  // e «non l'ho detto» si vede come `null` dentro un capo che c'è.
  const l = normalizeInterSiteLink({ id: 'x', aSiteId: 'hq', bSiteId: 'na', kind: 'vpls' });
  assert.deepStrictEqual(l.endpointA, { deviceRef: null, deviceName: null, peerIp: null });
  assert.deepStrictEqual(l.endpointB, { deviceRef: null, deviceName: null, peerIp: null });
});

// ── ⑨ La porta di servizio: `other` + le parole di chi documenta ───────────
test('⑨ un collegamento che non è nessuno dei cinque si documenta come `other`', () => {
  // Il caso vero: un ponte radio d'operatore, o un servizio che non rientra
  // nelle cinque nature. Prima bisognava mentire (scegliere «directLink») o
  // perdere la riga; adesso il software sa di NON sapere, e le parole le mette
  // chi documenta.
  const l = normalizeInterSiteLink({
    id: 'l1', aSiteId: 'hq', bSiteId: 'na', kind: 'other', kindLabel: 'FWA punto-punto',
  });
  assert.strictEqual(l.transport, 'other');
  assert.strictEqual(l.transportLabel, 'FWA punto-punto');
});

test('⑨ `other` è un collegamento come gli altri: capi, reach e stato ci sono tutti', () => {
  // Nessun ramo di codice ragiona su `other`: se perdesse i campi comuni,
  // sarebbe una seconda classe di collegamento invece di un nome mancante.
  const l = normalizeInterSiteLink({
    id: 'l1', aSiteId: 'hq', bSiteId: 'na', kind: 'other',
    state: factDeclared('up'), reach: factDeclared({ a: ['10.1.0.0/24'], b: [] }),
    endpointA: { deviceName: 'antenna tetto' },
  });
  assert.deepStrictEqual(linkReachAt(l, 'hq'), ['10.1.0.0/24']);
  assert.strictEqual(l.endpointA.deviceName, 'antenna tetto');
  assert.strictEqual(l.state.value, 'up');
});

test('⑩ operatore e codice del circuito valgono per OGNI kind, e restano nudi', () => {
  // Stessa lezione della ⑥: una domanda che è la stessa per tutte le nature si
  // modella una volta sola. Senza, un circuito inter-sede letto dal DCIM entrava
  // perdendo per strada le due cose che lo identificano.
  for (const kind of ['ipsec', 'mpls', 'vpls', 'sdwan', 'directLink', 'other']) {
    const l = normalizeInterSiteLink({
      id: 'l', aSiteId: 'a', bSiteId: 'b', kind,
      provider: '  CenturyLink ', circuitId: 'DEOW4921',
    });
    assert.strictEqual(l.provider, 'CenturyLink', kind + ': lo spazio in più non è un operatore diverso');
    assert.strictEqual(l.circuitId, 'DEOW4921', kind);
  }
  // ④ Sono DICHIARAZIONI per costruzione: nessun envelope, come sull'uplink.
  const nudo = normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'ipsec' });
  assert.strictEqual(nudo.provider, null, '«non c\'è un operatore» è una risposta');
  assert.strictEqual(nudo.circuitId, null);
});

test('⑪ un collegamento ha un NOME, e non è la sua natura', () => {
  // Un GRE letto da NetBox si chiama «GRE-LAB» ed È un GRE: due fatti diversi,
  // due campi. Prima il nome non aveva dove andare e andava perso — e due
  // tunnel fra le stesse due sedi diventavano indistinguibili.
  const l = normalizeInterSiteLink({
    id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'other',
    name: '  GRE-LAB ', kindLabel: 'GRE',
  });
  assert.strictEqual(l.name, 'GRE-LAB');
  assert.strictEqual(l.transportLabel, 'GRE');
  // Vale per OGNI natura, non solo per `other`.
  for (const kind of ['ipsec', 'mpls', 'vpls', 'sdwan', 'directLink']) {
    assert.strictEqual(normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind, name: 'X' }).name, 'X', kind);
  }
  assert.strictEqual(normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'ipsec' }).name, null);
});

test('⭐ ⑳ su quali linee CORRE vale per ogni kind, non solo per l\'SD-WAN', () => {
  // La quarta volta della stessa lezione (⑥, ⑩, ⑪), e stavolta il campo c'era
  // già: viveva nel solo `sdwan`, dove la parola «underlay» lo aveva fatto
  // sembrare un concetto da SD-WAN. Un IPsec esce da una linea, un MPLS ci viene
  // consegnato sopra: «è giù la linea di Milano, cosa cade con lei» è la stessa
  // domanda per tutti — ed è LA domanda del capitolo di ripristino.
  for (const kind of ['ipsec', 'gre', 'wireguard', 'openvpn', 'l2tp',
    'mpls', 'vpls', 'vpws', 'vxlan', 'evpn', 'sdwan', 'directLink', 'other']) {
    const l = normalizeInterSiteLink({
      id: 'l', aSiteId: 'a', bSiteId: 'b', kind, underlayUplinkIds: ['u1', 'u2'],
    });
    assert.deepStrictEqual(l.underlayUplinkIds, ['u1', 'u2'], kind);
  }
});

test('⑳ chi non lo dichiara porta una lista VUOTA, non l\'assenza del campo', () => {
  // Stessa forma dei capi (⑥) e degli uplink di una sede: chi legge non si deve
  // difendere da `undefined`. E vuoto vuol dire «non dichiarato», non «non corre
  // su niente» — su una fibra fra due capannoni il vuoto è la risposta giusta.
  for (const kind of ['ipsec', 'mpls', 'sdwan', 'directLink']) {
    assert.deepStrictEqual(
      normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind }).underlayUplinkIds, [], kind);
  }
});

test('⑳ la stessa linea dichiarata due volte è UNA linea', () => {
  // Non si perde niente: la stessa linea due volte è la stessa linea. Sulla
  // scheda di ripristino comparirebbe due volte, facendo credere a due accessi
  // dove ce n'è uno — e chi legge quella scheda sta decidendo dove telefonare.
  const l = normalizeInterSiteLink({
    id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'ipsec',
    underlayUplinkIds: ['u1', 'u2', 'u1', '', null, 'u2'],
  });
  assert.deepStrictEqual(l.underlayUplinkIds, ['u1', 'u2']);
});

test('⑳ l\'SD-WAN non perde niente: overlay suo, linee comuni', () => {
  // La generalizzazione non deve togliere il campo a chi ce l'aveva: `overlay`
  // resta dell'SD-WAN (su un IPsec non vuol dire niente), le linee no.
  const l = normalizeInterSiteLink({
    id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'sdwan',
    overlay: 'Corporate', underlayUplinkIds: ['u1'],
  });
  assert.strictEqual(l.overlay, 'Corporate');
  assert.deepStrictEqual(l.underlayUplinkIds, ['u1']);
  assert.ok(!('overlay' in normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'ipsec' })),
    'e l\'overlay NON è diventato di tutti per simmetria');
});

test('⑨ l\'etichetta può mancare: «non so come chiamarlo» è già un\'informazione', () => {
  assert.strictEqual(normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'other' }).transportLabel, null);
});

test('⑨ la porta di servizio NON apre il vocabolario: un kind inventato resta rifiutato', () => {
  // È la differenza fra `other` e una stringa libera: quest'ultima avrebbe rotto
  // in silenzio traduzioni, icone e ogni futura logica per-natura.
  assert.strictEqual(normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'eolo' }).transport, null);
  assert.strictEqual(normalizeInterSiteLink({ id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'Other' }).transport, null);
});

// ── ⑧ L'apparato di un capo: riferimento OPPURE nome scritto a mano ────────
test('⑧ un apparato che nel progetto non c\'è si può scrivere a mano', () => {
  // Il caso vero: il CE di un MPLS è spesso la scatola dell'operatore, che
  // nessuno ha documentato come nodo. Obbligare a sceglierlo da un elenco
  // avrebbe reso impossibile documentare proprio il collegamento d'operatore.
  const l = normalizeInterSiteLink({
    id: 'l1', aSiteId: 'hq', bSiteId: 'na', kind: 'mpls',
    endpointA: { deviceName: 'CE Fastweb (rack 2)' },
  });
  assert.deepStrictEqual(l.endpointA, { deviceRef: null, deviceName: 'CE Fastweb (rack 2)', peerIp: null });
});

test('⑧ riferimento e nome a mano si ESCLUDONO: se c\'è il nodo, il nome lo dà il progetto', () => {
  // Tenerli tutti e due sarebbe una seconda definizione dello stesso nome, che
  // diverge al primo rinomino del nodo.
  const l = normalizeInterSiteLink({
    id: 'l1', aSiteId: 'hq', bSiteId: 'na', kind: 'ipsec',
    endpointA: { deviceRef: 'n_abc', deviceName: 'un nome vecchio' },
  });
  assert.strictEqual(l.endpointA.deviceRef, 'n_abc');
  assert.strictEqual(l.endpointA.deviceName, null, 'il riferimento vince, il nome copiato cade');
});

test('ikeVersion accetta solo 1 o 2', () => {
  const ike = (v) => normalizeInterSiteLink(ipsec({ ikeVersion: v })).ikeVersion;
  assert.strictEqual(ike(1), 1);
  assert.strictEqual(ike('2'), 2);
  assert.strictEqual(ike(3), null);
  assert.strictEqual(ike('ikev2'), null);
});

// ── state: il valore dice COSA, l'envelope dice CHI lo afferma ─────────────
test('③ uno stato dichiarato e uno misurato hanno lo STESSO valore, origine diversa', () => {
  const dec = normalizeInterSiteLink(ipsec({ state: factDeclared('up') }));
  const mea = normalizeInterSiteLink(ipsec({ state: factMeasured('up', AT) }));
  assert.deepStrictEqual(dec.state, { origin: 'declared', value: 'up' });
  assert.deepStrictEqual(mea.state, { origin: 'measured', value: 'up', at: AT });
});

test('② uno stato fuori vocabolario, o nudo, non entra', () => {
  for (const bad of [factDeclared('flapping'), factDeclared('declared'), 'up', null, factDeclared(null)]) {
    assert.strictEqual(normalizeInterSiteLink(ipsec({ state: bad })).state, null);
  }
});

test('`state` assente ≠ giù: è «non pronunciato»', () => {
  assert.strictEqual(normalizeInterSiteLink(ipsec({})).state, null);
});

// ── reach: UN concetto per tutti i kind ────────────────────────────────────
test('② reach canonicalizza le subnet dei due capi, mantenendo l\'origine', () => {
  const l = normalizeInterSiteLink(ipsec({
    reach: factMeasured({ a: ['10.1.0.9/24', '10.1.0.0/24'], b: ['10.2.0.0/255.255.255.0'] }, AT),
  }));
  assert.deepStrictEqual(l.reach, {
    origin: 'measured', at: AT,
    value: { a: ['10.1.0.0/24'], b: ['10.2.0.0/24'] },
  });
});

test('③ reach è lo stesso concetto su ogni kind (su un ipsec È l\'encryption domain)', () => {
  const r = factDeclared({ a: ['10.1.0.0/24'], b: ['10.2.0.0/24'] });
  // ㉔ Su ogni valore di TUTT'E DUE gli assi: `reach` è una domanda sola.
  for (const [asse, voci] of [['transport', INTER_SITE_TRANSPORTS], ['tunnel', INTER_SITE_TUNNELS]]) {
    for (const v of voci) {
      const l = normalizeInterSiteLink({ id: 'l', aSiteId: 'hq', bSiteId: 'rm', [asse]: v, reach: r });
      assert.deepStrictEqual(linkReach(l), { a: ['10.1.0.0/24'], b: ['10.2.0.0/24'] },
        `reach deve leggersi allo stesso modo su ${asse}=${v}`);
    }
  }
});

test('② reach ASSENTE non è «nessuna subnet»: la distinzione resta leggibile', () => {
  const l = normalizeInterSiteLink(ipsec({}));
  assert.strictEqual(l.reach, null, 'il campo dice «non lo sappiamo»');
  assert.deepStrictEqual(linkReach(l), { a: [], b: [] }, 'l\'accessore dà una forma usabile');
});

test('reach preserva anche l\'origine `derived`', () => {
  const l = normalizeInterSiteLink(ipsec({ reach: factDerived({ a: ['10.1.0.0/24'], b: [] }, 'inetCidrRouteTable') }));
  assert.strictEqual(l.reach.origin, 'derived');
  assert.strictEqual(l.reach.from, 'inetCidrRouteTable');
});

// ── Accessori neutri ───────────────────────────────────────────────────────
test('linkSites, linkPeerSite e linkReachAt rispondono per capo, non per «locale/remoto»', () => {
  const l = normalizeInterSiteLink(ipsec({
    reach: factDeclared({ a: ['10.1.0.0/24'], b: ['10.2.0.0/24'] }),
  }));
  assert.deepStrictEqual(linkSites(l), ['hq', 'rm']);
  assert.strictEqual(linkPeerSite(l, 'hq'), 'rm');
  assert.strictEqual(linkPeerSite(l, 'rm'), 'hq');
  assert.strictEqual(linkPeerSite(l, 'na'), null, 'una sede non toccata non ha un «altro capo»');
  assert.deepStrictEqual(linkReachAt(l, 'hq'), ['10.1.0.0/24']);
  assert.deepStrictEqual(linkReachAt(l, 'rm'), ['10.2.0.0/24']);
  assert.deepStrictEqual(linkReachAt(l, 'na'), []);
});

test('gli accessori reggono il null senza esplodere', () => {
  assert.deepStrictEqual(linkSites(null), []);
  assert.strictEqual(linkPeerSite(null, 'hq'), null);
  assert.deepStrictEqual(linkReach(null), { a: [], b: [] });
  assert.deepStrictEqual(linkReachAt(null, 'hq'), []);
  assert.deepStrictEqual(uplinksOfSite(null, 'hq'), []);
  assert.deepStrictEqual(linksOfSite(null, 'hq'), []);
  assert.strictEqual(siteById(null, 'hq'), null);
  assert.deepStrictEqual(Object.keys(subnetSiteIndex(null)), []);
  assert.strictEqual(siteOfSubnet(null, '10.1.0.0/24'), null);
});

// ── Organizzazione: le 3 sedi da cui è nata InfraNet ───────────────────────
const ORG = {
  id: 'org-1', name: 'Acme',
  sites: [
    { id: 'hq', name: 'Milano', role: 'hub', projectRef: 'p-mi', subnets: ['10.1.0.0/24'] },
    { id: 'rm', name: 'Roma', role: 'spoke', projectRef: 'p-rm', subnets: ['10.2.0.0/24'] },
    { id: 'na', name: 'Napoli', role: 'spoke', projectRef: 'p-na', subnets: ['10.3.0.0/24'] },
    { name: 'senza id' },
  ],
  uplinks: [
    { id: 'u-hq', siteId: 'hq', provider: 'Acme Fiber', cirMbps: 200 },
    { id: 'u-rm', siteId: 'rm', provider: 'Acme Fiber', cirMbps: 100 },
    { siteId: 'na' },
  ],
  links: [
    { id: 'hq-rm', aSiteId: 'hq', bSiteId: 'rm', kind: 'ipsec', topology: 'hub-and-spoke', state: factMeasured('up', AT), reach: factDeclared({ a: ['10.1.0.0/24'], b: ['10.2.0.0/24'] }) },
    { id: 'hq-na', aSiteId: 'hq', bSiteId: 'na', kind: 'ipsec', topology: 'hub-and-spoke', state: factDeclared('up') },
    // ㉔ Ciò che NON è modellabile non è più «una natura che non conosco» — quella
    // entra come «non dichiarata» — ma un collegamento senza IDENTITÀ: senza id
    // niente a valle può indicizzarlo, e la mappa ne disegnerebbe uno a caso.
    { aSiteId: 'hq', bSiteId: 'rm', tunnel: 'ipsec' },
  ],
};

test('l\'organizzazione normalizza le tre liste e scarta ciò che non è modellabile', () => {
  const org = normalizeOrganization(ORG);
  assert.strictEqual(org.name, 'Acme');
  assert.deepStrictEqual(org.sites.map(s => s.id), ['hq', 'rm', 'na']);
  assert.deepStrictEqual(org.uplinks.map(u => u.id), ['u-hq', 'u-rm']);
  assert.deepStrictEqual(org.links.map(l => l.id), ['hq-rm', 'hq-na']);
});

test('normalizeOrganization su un input vuoto o assurdo dà un\'organizzazione vuota', () => {
  for (const bad of [null, undefined, 'x', 42, []]) {
    assert.deepStrictEqual(normalizeOrganization(bad), { id: '', name: '', sites: [], uplinks: [], links: [] });
  }
});

test('un capo verso una sede INESISTENTE non viene nascosto (è un dato reale e sbagliato)', () => {
  const org = normalizeOrganization({
    sites: [{ id: 'hq', name: 'Milano' }],
    links: [{ id: 'orfano', aSiteId: 'hq', bSiteId: 'fantasma', kind: 'ipsec' }],
    uplinks: [{ id: 'u', siteId: 'fantasma' }],
  });
  assert.strictEqual(org.links.length, 1, 'il collegamento resta: la diagnostica è Fase 1');
  assert.strictEqual(org.uplinks.length, 1);
  assert.strictEqual(siteById(org, 'fantasma'), null);
});

test('uplinksOfSite e linksOfSite filtrano per sede, i collegamenti da entrambi i capi', () => {
  const org = normalizeOrganization(ORG);
  assert.deepStrictEqual(uplinksOfSite(org, 'hq').map(u => u.id), ['u-hq']);
  assert.deepStrictEqual(uplinksOfSite(org, 'na'), []);
  assert.deepStrictEqual(linksOfSite(org, 'hq').map(l => l.id), ['hq-rm', 'hq-na'], 'l\'hub li tocca entrambi');
  assert.deepStrictEqual(linksOfSite(org, 'rm').map(l => l.id), ['hq-rm'], 'lo spoke è il capo B');
  assert.strictEqual(siteById(org, 'rm').name, 'Roma');
});

// ── Subnet → sede ──────────────────────────────────────────────────────────
test('l\'indice subnet→sede usa il CIDR canonico come chiave', () => {
  const org = normalizeOrganization(ORG);
  const idx = subnetSiteIndex(org);
  assert.deepStrictEqual(Object.assign({}, idx), {
    '10.1.0.0/24': ['hq'], '10.2.0.0/24': ['rm'], '10.3.0.0/24': ['na'],
  });
  // L'indice è SENZA PROTOTIPO di proposito: è una tabella costruita da dati, e
  // una chiave `__proto__`/`constructor` in un oggetto normale non si comporta
  // come una chiave. Qui le chiavi sono CIDR canonici, quindi la difesa è
  // teorica — ma il costo è zero e la regola resta vera anche domani.
  assert.strictEqual(Object.getPrototypeOf(idx), null);
});

test('siteOfSubnet trova la sede scrivendo la subnet in QUALSIASI forma valida', () => {
  const org = normalizeOrganization(ORG);
  for (const form of ['10.2.0.0/24', '10.2.0.44/24', ' 10.2.0.0/255.255.255.0 ']) {
    assert.strictEqual(siteOfSubnet(org, form), 'rm', `doveva risolvere ${form}`);
  }
  assert.strictEqual(siteOfSubnet(org, '10.9.0.0/24'), null, 'una subnet che non sta da nessuna parte');
  assert.strictEqual(siteOfSubnet(org, 'garbage'), null);
});

test('② una subnet in DUE sedi resta ambigua: nessuno sceglie per te', () => {
  const org = normalizeOrganization({
    sites: [
      { id: 'hq', name: 'Milano', subnets: ['10.1.0.0/24'] },
      { id: 'rm', name: 'Roma', subnets: ['10.1.0.0/24'] },
    ],
  });
  assert.deepStrictEqual(subnetSiteIndex(org)['10.1.0.0/24'], ['hq', 'rm'], 'la sovrapposizione si VEDE');
  assert.strictEqual(siteOfSubnet(org, '10.1.0.0/24'), null, 'scegliere la prima sarebbe un ripiego');
});

// ── Purezza & persistenza ──────────────────────────────────────────────────
test('la normalizzazione non muta l\'input', () => {
  const before = JSON.stringify(ORG);
  normalizeOrganization(ORG);
  assert.strictEqual(JSON.stringify(ORG), before);
});

test('un\'organizzazione normalizzata è stabile al giro JSON e ri-normalizzabile', () => {
  const once = normalizeOrganization(ORG);
  const twice = normalizeOrganization(JSON.parse(JSON.stringify(once)));
  assert.deepStrictEqual(twice, once, 'normalizzare due volte deve dare lo stesso risultato');
});

// ── ⑪ Un id ripetuto non identifica ────────────────────────────────────────
test('⭐ due sedi con lo stesso id: entra la prima, la seconda CADE (e si conta)', () => {
  const org = normalizeOrganization({
    sites: [
      { id: 'mi', name: 'Milano', role: 'hub', subnets: ['10.0.0.0/24'] },
      { id: 'mi', name: 'Milano (vecchia)', role: 'spoke', subnets: ['10.9.0.0/24'] },
      { id: 'rm', name: 'Roma', role: 'spoke', subnets: ['10.1.0.0/24'] },
    ],
  });
  assert.strictEqual(org.sites.length, 2);
  assert.deepStrictEqual(org.sites.map(s => s.name), ['Milano', 'Roma'], 'vince la prima');
  // Il difetto che questo chiude: la mappa indicizza per id e ne disegnava UNA
  // sola, quindi la seconda spariva dallo schermo restando nei conti del report.
  // Ora i due numeri non possono più discordare, perché la lista è una sola.
  assert.strictEqual(siteById(org, 'mi').name, 'Milano');
});

test('un id ripetuto cade anche fra gli uplink e fra i collegamenti', () => {
  const org = normalizeOrganization({
    sites: [{ id: 'a', name: 'A', role: 'hub' }, { id: 'b', name: 'B', role: 'spoke' }],
    uplinks: [{ id: 'u', siteId: 'a', provider: 'TIM' }, { id: 'u', siteId: 'b', provider: 'Fastweb' }],
    links: [
      { id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'ipsec' },
      { id: 'l', aSiteId: 'a', bSiteId: 'b', kind: 'gre' },
    ],
  });
  assert.strictEqual(org.uplinks.length, 1);
  assert.strictEqual(org.uplinks[0].provider, 'TIM');
  assert.strictEqual(org.links.length, 1);
  assert.strictEqual(org.links[0].tunnel, 'ipsec');
});

test('⚠️ e NIENTE cade quando gli id sono diversi: più collegamenti fra le stesse due sedi restano', () => {
  // Il caso vero: fra due sedi si mettono un MPLS primario e un IPsec di scorta.
  // Una deduplica fatta sulla COPPIA invece che sull'id li avrebbe fusi.
  const org = normalizeOrganization({
    sites: [{ id: 'a', name: 'A', role: 'hub' }, { id: 'b', name: 'B', role: 'spoke' }],
    links: [
      { id: 'l1', aSiteId: 'a', bSiteId: 'b', kind: 'mpls' },
      { id: 'l2', aSiteId: 'a', bSiteId: 'b', kind: 'ipsec' },
      { id: 'l3', aSiteId: 'b', bSiteId: 'a', kind: 'gre' },
    ],
  });
  assert.strictEqual(org.links.length, 3, 'sono tre collegamenti veri, non tre copie');
});
