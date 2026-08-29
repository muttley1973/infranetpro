// Test di lib/dcim-wan.js — i circuiti NetBox → le linee WAN dell'organizzazione.
// PURO: nessun server, nessuna rete, nessun DOM. Le forme sono quelle MISURATE su
// un NetBox 4.6.7 vero (29 circuiti) e quella ≤ 4.1, che è ancora là fuori.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { circuitsToWan, _termTarget, _cirMbps } = require('../lib/dcim-wan.js');

// Una terminazione nella forma 4.2+ (`termination_type` + `termination`).
const termSite = (id, name, extra) => Object.assign({
  termination_type: 'dcim.site', termination_id: id,
  termination: { id, name, slug: String(name).toLowerCase() },
}, extra || {});
const termCloud = (id, name) => ({
  termination_type: 'circuits.providernetwork', termination_id: id,
  termination: { id, name },
});
const cavoVerso = (device, iface) => ({
  cable: { id: 21 },
  link_peers_type: 'dcim.interface',
  link_peers: [{ id: 2, name: iface, device: { id: 1, name: device } }],
});

const circuito = (o) => Object.assign({
  id: 19, cid: 'ABC123',
  provider: { id: 2, name: 'CenturyLink', slug: 'centurylink' },
  type: { id: 1, name: 'Internet Access', slug: 'internet' },
  status: { value: 'active', label: 'Active' },
  commit_rate: null,
}, o);

test('un capo su una sede e l\'altro sul nulla → è un uplink di quella sede', () => {
  const out = circuitsToWan({
    circuits: [circuito({ termination_a: null, termination_z: termSite(2, 'DM-Akron') })],
  }, { siteIds: [2] });
  assert.equal(out.uplinks.length, 1);
  assert.equal(out.links.length, 0);
  const u = out.uplinks[0];
  assert.equal(u.netboxSiteId, 2);
  assert.equal(u.netboxSiteName, 'DM-Akron');
  assert.equal(u.provider, 'CenturyLink');
  assert.equal(u.serviceType, 'Internet Access');
  assert.equal(u.circuitId, 'ABC123');
  assert.equal(u.cirMbps, null);
  assert.equal(u.cloud, null);
});

test('④ il capo su una NUVOLA d\'operatore resta un uplink, e la nuvola si DICE', () => {
  // Tredici circuiti su ventinove, sul NetBox vero, finiscono così. Dedurne
  // adiacenze fra le sedi produrrebbe collegamenti che nessuno ha dichiarato.
  const out = circuitsToWan({
    circuits: [circuito({ termination_a: termCloud(1, 'Level3 MPLS'), termination_z: termSite(14, 'DM-Yonkers') })],
  }, { siteIds: [14] });
  assert.equal(out.links.length, 0, 'la nuvola non è un collegamento fra sedi');
  assert.equal(out.uplinks.length, 1);
  assert.equal(out.uplinks[0].cloud, 'Level3 MPLS');
  assert.ok(out.notes.some(n => n.code === 'wan.cloudNotModelled' && n.clouds.includes('Level3 MPLS')),
    'il limite del modello si dichiara, non si simula');
});

test('③ due capi su due SEDI diverse → è un collegamento, non due uplink', () => {
  const out = circuitsToWan({
    circuits: [circuito({
      cid: 'DF-001', type: { name: 'Dark Fiber' },
      termination_a: termSite(2, 'DM-Akron'), termination_z: termSite(14, 'DM-Yonkers'),
    })],
  }, { siteIds: [2] });
  assert.equal(out.uplinks.length, 0);
  assert.equal(out.links.length, 1);
  const l = out.links[0];
  assert.equal(l.aNetboxSiteId, 2);
  assert.equal(l.bNetboxSiteId, 14);
  assert.equal(l.circuitId, 'DF-001');
  assert.equal(l.provider, 'CenturyLink');
  // ⑤ la natura NON si deduce dal nome del tipo: quello è testo libero
  // dell'istanza, e riconoscerlo per stringa funzionerebbe solo su questa.
  assert.equal(l.kindLabel, 'Dark Fiber');
});

test('⑥ il cavo dalla terminazione dice QUALE porta di quale apparato è il capo WAN', () => {
  const out = circuitsToWan({
    circuits: [circuito({ id: 19 })],
    circuitTerminations: [{
      id: 23, circuit: { id: 19 }, term_side: 'Z',
      ...termSite(2, 'DM-Akron'),
      ...cavoVerso('dmi01-akron-rtr01', 'GigabitEthernet0/0/1'),
    }],
  }, { siteIds: [2] });
  assert.deepEqual(out.uplinks[0].wanPort, { deviceName: 'dmi01-akron-rtr01', ifaceName: 'GigabitEthernet0/0/1' });
});

test('le terminazioni lette a parte BATTONO quelle annidate: solo loro portano il cavo', () => {
  const out = circuitsToWan({
    circuits: [circuito({ id: 19, termination_z: termSite(2, 'DM-Akron') })],
    circuitTerminations: [{
      id: 23, circuit: { id: 19 }, term_side: 'z',
      ...termSite(2, 'DM-Akron'),
      ...cavoVerso('rtr01', 'Gi0/0/1'),
    }],
  }, { siteIds: [2] });
  assert.equal(out.uplinks.length, 1);
  assert.equal(out.uplinks[0].wanPort.deviceName, 'rtr01');
});

test('un capo su un pannello di permutazione non dice quale apparato è: niente porta WAN', () => {
  const out = circuitsToWan({
    circuits: [circuito({ id: 19 })],
    circuitTerminations: [{
      id: 23, circuit: { id: 19 }, term_side: 'z', ...termSite(2, 'DM-Akron'),
      cable: { id: 9 }, link_peers_type: 'dcim.frontport', link_peers: [{ id: 5, name: '1' }],
    }],
  }, { siteIds: [2] });
  assert.equal(out.uplinks[0].wanPort, null);
});

test('② un circuito che non è ATTIVO non diventa un uplink, e si dice perché', () => {
  // Un `WanUplink` non ha un campo stato: importarne uno `decommissioned` lo
  // renderebbe indistinguibile da una linea in esercizio.
  const out = circuitsToWan({
    circuits: [
      circuito({ id: 1, cid: 'VECCHIO', status: { value: 'decommissioned' }, termination_z: termSite(2, 'S') }),
      circuito({ id: 2, cid: 'FUTURO', status: 'planned', termination_z: termSite(2, 'S') }),
      circuito({ id: 3, cid: 'VIVO', termination_z: termSite(2, 'S') }),
    ],
  }, { siteIds: [2] });
  assert.deepEqual(out.uplinks.map(u => u.circuitId), ['VIVO']);
  const n = out.notes.find(x => x.code === 'wan.notActive');
  assert.equal(n.n, 2);
  assert.deepEqual(n.rows.map(r => r.status).sort(), ['decommissioned', 'planned']);
});

test('① `commit_rate` è in kbps e diventa Mbps — `port_speed` NON è un ripiego', () => {
  const out = circuitsToWan({
    circuits: [
      circuito({ id: 1, cid: 'A', commit_rate: 20000, termination_z: termSite(2, 'S') }),
      circuito({ id: 2, cid: 'B', commit_rate: 1544, termination_z: termSite(2, 'S') }),
      circuito({ id: 3, cid: 'C', commit_rate: null, termination_z: termSite(2, 'S') }),
    ],
    circuitTerminations: [
      // La porta va a 1 Gbps: è l'ifSpeed, e non è la banda contrattuale.
      { id: 9, circuit: { id: 3 }, term_side: 'z', ...termSite(2, 'S'), port_speed: 1000000, upstream_speed: 1000000 },
    ],
  }, { siteIds: [2] });
  const per = Object.fromEntries(out.uplinks.map(u => [u.circuitId, u.cirMbps]));
  assert.equal(per.A, 20);
  assert.equal(per.B, 1.544);
  assert.equal(per.C, null, 'la velocità della porta non riempie la banda garantita');
  assert.equal(out.notes.find(n => n.code === 'wan.cirMissing').n, 1);
});

test('la banda mancante si conta solo sugli UPLINK: un collegamento non ha quel campo', () => {
  // Misurato a schermo: su una sede con soli circuiti punto-punto l'avviso
  // diceva «3 linee non dichiarano la banda garantita, il campo resta vuoto» —
  // di un campo che sul collegamento non esiste, e che quindi nessuno potrà mai
  // riempire. Un avviso che non si può togliere è rumore.
  const out = circuitsToWan({
    circuits: [circuito({ termination_a: termSite(2, 'A'), termination_z: termSite(3, 'B') })],
  }, { siteIds: [2] });
  assert.equal(out.links.length, 1);
  assert.equal(out.notes.some(n => n.code === 'wan.cirMissing'), false);
});

test('⑦ la forma ≤ 4.1 (`site` / `provider_network` nudi) si legge come la 4.2+', () => {
  const out = circuitsToWan({
    circuits: [circuito({
      termination_a: { provider_network: { id: 1, name: 'Level3 MPLS' } },
      termination_z: { site: { id: 2, name: 'DM-Akron' } },
    })],
  }, { siteIds: [2] });
  assert.equal(out.uplinks.length, 1);
  assert.equal(out.uplinks[0].netboxSiteName, 'DM-Akron');
  assert.equal(out.uplinks[0].cloud, 'Level3 MPLS');
});

test('una terminazione su una REGIONE non è una sede: si dice, non si arrotonda', () => {
  const out = circuitsToWan({
    circuits: [circuito({
      termination_a: { termination_type: 'dcim.region', termination_id: 3, termination: { id: 3, name: 'Nord-Est' } },
      termination_z: termSite(2, 'DM-Akron'),
    })],
  }, { siteIds: [2] });
  assert.equal(out.uplinks.length, 1, 'il capo su una sede resta un uplink');
  assert.ok(out.notes.some(n => n.code === 'wan.terminationNotSite' && n.type === 'dcim.region'));
});

test('⚠️ CINTURA: NetBox ignora un filtro che non conosce e risponde con TUTTO', () => {
  // Misurato sul NetBox vero: un filtro inventato torna 29 circuiti su 29. Senza
  // questo ricontrollo, un import di una sede si porterebbe le linee di tutte.
  const out = circuitsToWan({
    circuits: [
      circuito({ id: 1, cid: 'MIO', termination_z: termSite(2, 'Mia') }),
      circuito({ id: 2, cid: 'ALTRUI', termination_z: termSite(77, 'Di un altro') }),
    ],
  }, { siteIds: [2] });
  assert.deepEqual(out.uplinks.map(u => u.circuitId), ['MIO']);
  assert.equal(out.scopeHeld, false, 'e si dice che la cintura ha dovuto mordere');
  assert.equal(out.notes.find(n => n.code === 'wan.outOfScope').n, 1);
});

test('senza ambito non si filtra niente: si legge tutto quello che è arrivato', () => {
  const out = circuitsToWan({
    circuits: [
      circuito({ id: 1, cid: 'A', termination_z: termSite(2, 'Uno') }),
      circuito({ id: 2, cid: 'B', termination_z: termSite(77, 'Due') }),
    ],
  });
  assert.equal(out.uplinks.length, 2);
  assert.equal(out.scopeHeld, true);
});

test('i due capi nello STESSO sito non sono né un uplink né un collegamento', () => {
  const out = circuitsToWan({
    circuits: [circuito({ termination_a: termSite(2, 'S'), termination_z: termSite(2, 'S') })],
  }, { siteIds: [2] });
  assert.equal(out.uplinks.length, 0);
  assert.equal(out.links.length, 0);
  assert.ok(out.notes.some(n => n.code === 'wan.sameSite'));
});

test('un circuito senza nessun capo su una sede non si arrotonda a nulla', () => {
  const out = circuitsToWan({ circuits: [circuito({ termination_a: null, termination_z: null })] });
  assert.equal(out.uplinks.length, 0);
  assert.ok(out.notes.some(n => n.code === 'wan.noSite'));
});

test('la lettura troncata si dichiara', () => {
  const out = circuitsToWan({ circuits: [], truncated: true });
  assert.ok(out.notes.some(n => n.code === 'wan.truncated'));
});

test('un bundle vuoto, assurdo o assente non esplode e non inventa', () => {
  for (const x of [null, undefined, {}, { circuits: null }, 'boh', 42]) {
    const out = circuitsToWan(x, { siteIds: [1] });
    assert.deepEqual(out.uplinks, []);
    assert.deepEqual(out.links, []);
  }
});

test('_cirMbps: zero e valori assurdi restano `null`, non diventano 0 Mbps', () => {
  assert.equal(_cirMbps(0), null);
  assert.equal(_cirMbps(-5), null);
  assert.equal(_cirMbps('boh'), null);
  assert.equal(_cirMbps(null), null);
  assert.equal(_cirMbps(100000), 100);
});

test('_termTarget risponde `none` a ciò che non è una terminazione', () => {
  assert.equal(_termTarget(null).what, 'none');
  assert.equal(_termTarget({}).what, 'none');
  assert.equal(_termTarget('x').what, 'none');
});

test('la mappatura non muta il bundle che le è stato dato', () => {
  const nb = {
    circuits: [circuito({ termination_z: termSite(2, 'S') })],
    circuitTerminations: [{ id: 1, circuit: { id: 19 }, term_side: 'z', ...termSite(2, 'S') }],
  };
  const prima = JSON.stringify(nb);
  circuitsToWan(nb, { siteIds: [2] });
  assert.equal(JSON.stringify(nb), prima);
});
