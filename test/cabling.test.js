// Test per le primitive pure dell'editor segmenti cabling (lib/cabling.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitLinkThrough, mergeLinksThrough, eligibleMidPorts, portConnectionCount, cablingAdjacencyValid, cablingHierLevel, canRouteThrough, validMidTypes, validateCablingChain, chainAmbiguousLinkIds, chainVlanColorMap } = require('../lib/cabling.js');

let _n = 0;
const uid = (p) => `${p}-test-${++_n}`;
const isPT = (pid) => /^(wp|pp|mc)/.test(String(pid)); // wallport/patchpanel/mediaconv fittizi

// ---------- splitLinkThrough ----------

test('split: A↔B attraverso pp → due tratti con endpoint corretti', () => {
  const link = { id: 'l1', src: 'pc1-1', dst: 'sw1-5', vlan: 100, mode: 'access' };
  const r = splitLinkThrough(link, 'pp1-3', { uid, isPassThrough: isPT });
  assert.equal(r.ok, true);
  const [a, b] = r.links;
  assert.equal(a.src, 'pc1-1');  assert.equal(a.dst, 'pp1-3');
  assert.equal(b.src, 'pp1-3');  assert.equal(b.dst, 'sw1-5');
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, 'l1');
});

test('split: VLAN/mode/colore copiati su entrambi i tratti', () => {
  const link = { id: 'l1', src: 'pc1-1', dst: 'sw1-5', vlan: 100, mode: 'trunk', trunkVlans: '10,20', colorOvr: '#ff0000' };
  const r = splitLinkThrough(link, 'pp1-3', { uid, isPassThrough: isPT });
  for (const seg of r.links) {
    assert.equal(seg.vlan, 100);
    assert.equal(seg.mode, 'trunk');
    assert.equal(seg.trunkVlans, '10,20');
    assert.equal(seg.colorOvr, '#ff0000');
  }
});

test('split: default permanent SOLO fra due pass-through', () => {
  // wallport ↔ switch, spezzato sul patch panel:
  //   wp ↔ pp  → entrambi pass-through → permanent (posa fissa)
  //   pp ↔ sw  → switch attivo → patch cord (no isPermanent)
  const link = { id: 'l1', src: 'wp1-1', dst: 'sw1-5' };
  const r = splitLinkThrough(link, 'pp1-3', { uid, isPassThrough: isPT });
  const [a, b] = r.links;
  assert.equal(a.isPermanent, true,  'wp↔pp deve essere permanent');
  assert.equal(b.isPermanent, undefined, 'pp↔sw deve restare patch cord');
});

test('split: lunghezza NON copiata (non ripartibile), metadata documentali si', () => {
  const link = { id: 'l1', src: 'pc1-1', dst: 'sw1-5', lengthM: 30, cableType: 'Cat6', installedBy: 'Mario', notes: 'dorsale aula 2' };
  const r = splitLinkThrough(link, 'pp1-3', { uid, isPassThrough: isPT });
  for (const seg of r.links) {
    assert.equal(seg.lengthM, undefined);
    assert.equal(seg.length, undefined);
    assert.equal(seg.cableType, 'Cat6');
    assert.equal(seg.installedBy, 'Mario');
    assert.equal(seg.notes, 'dorsale aula 2');
  }
});

test('split: i tratti risultanti sono MANUALI (instradare = atto manuale, no autoLinked)', () => {
  // Principio "manuale ha sempre priorita'": instradare un cavo (anche inferito)
  // produce tratti MANUALI, protetti dai sync SNMP successivi. Niente
  // autoLinked/confidence/protocol ereditati dal cavo originale.
  const link = { id: 'l1', src: 'pc1-1', dst: 'sw1-5', autoLinked: true, confidence: 0.85, protocol: 'MAC' };
  const r = splitLinkThrough(link, 'pp1-3', { uid, isPassThrough: isPT });
  for (const seg of r.links) {
    assert.equal(seg.autoLinked, undefined);
    assert.equal(seg.confidence, undefined);
    assert.equal(seg.protocol, undefined);
  }
});

test('split: input non mutato', () => {
  const link = { id: 'l1', src: 'pc1-1', dst: 'sw1-5', vlan: 10 };
  const snapshot = JSON.stringify(link);
  splitLinkThrough(link, 'pp1-3', { uid, isPassThrough: isPT });
  assert.equal(JSON.stringify(link), snapshot);
});

test('split: rifiuta mid coincidente con un endpoint / link invalido', () => {
  assert.equal(splitLinkThrough({ src: 'a-1', dst: 'b-1' }, 'a-1', { uid }).ok, false);
  assert.equal(splitLinkThrough({ src: 'a-1', dst: 'b-1' }, '', { uid }).ok, false);
  assert.equal(splitLinkThrough(null, 'pp1-1', { uid }).ok, false);
  assert.equal(splitLinkThrough({ src: '', dst: 'b-1' }, 'pp1-1', { uid }).ok, false);
});

test('split: verifica capacita porta intermedia (max 2, servono 2 slot)', () => {
  const link = { id: 'l1', src: 'pc1-1', dst: 'sw1-5' };
  // pp1-3 gia' occupata da un altro cavo → 1 usato + 2 richiesti > 2
  const busy = [{ id: 'x', src: 'pp1-3', dst: 'sw9-1' }];
  const r = splitLinkThrough(link, 'pp1-3', { uid, isPassThrough: isPT, linksForCapacity: busy, maxConn: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'mid-port-full');
  // porta libera → ok
  const r2 = splitLinkThrough(link, 'pp1-4', { uid, isPassThrough: isPT, linksForCapacity: busy, maxConn: 2 });
  assert.equal(r2.ok, true);
});

// ---------- mergeLinksThrough ----------

test('merge: due tratti attraverso pp → un link diretto con gli outer end', () => {
  const a = { id: 'a', src: 'pc1-1', dst: 'pp1-3' };
  const b = { id: 'b', src: 'pp1-3', dst: 'sw1-5' };
  const r = mergeLinksThrough(a, b, 'pp1-3', { uid });
  assert.equal(r.ok, true);
  assert.equal(r.link.src, 'pc1-1');
  assert.equal(r.link.dst, 'sw1-5');
});

test('merge: orientamento indifferente (mid puo essere src o dst di entrambi)', () => {
  const a = { id: 'a', src: 'pp1-3', dst: 'pc1-1' };
  const b = { id: 'b', src: 'sw1-5', dst: 'pp1-3' };
  const r = mergeLinksThrough(a, b, 'pp1-3', { uid });
  assert.equal(r.ok, true);
  const ends = [r.link.src, r.link.dst].sort();
  assert.deepEqual(ends, ['pc1-1', 'sw1-5']);
});

test('merge: lunghezze sommate, cableType tenuto solo se concorde', () => {
  const a = { id: 'a', src: 'pc1-1', dst: 'pp1-3', lengthM: 3, cableType: 'Cat6' };
  const b = { id: 'b', src: 'pp1-3', dst: 'sw1-5', lengthM: 22, cableType: 'Cat6' };
  const r = mergeLinksThrough(a, b, 'pp1-3', { uid });
  assert.equal(r.link.lengthM, 25);
  assert.equal(r.link.cableType, 'Cat6');
  const r2 = mergeLinksThrough(
    { ...a, cableType: 'Cat6' }, { ...b, cableType: 'Cat5e' }, 'pp1-3', { uid });
  assert.equal(r2.link.cableType, undefined, 'cableType discorde → scartato');
});

test('merge: permanent solo se entrambi permanent · note concatenate', () => {
  const a = { id: 'a', src: 'pc1-1', dst: 'pp1-3', isPermanent: true, notes: 'tratta A' };
  const b = { id: 'b', src: 'pp1-3', dst: 'sw1-5', notes: 'tratta B' };
  const r = mergeLinksThrough(a, b, 'pp1-3', { uid });
  assert.equal(r.link.isPermanent, undefined);
  assert.equal(r.link.notes, 'tratta A | tratta B');
  const r2 = mergeLinksThrough({ ...a }, { ...b, isPermanent: true }, 'pp1-3', { uid });
  assert.equal(r2.link.isPermanent, true);
});

test('merge: rifiuta mid non condiviso e loop degeneri', () => {
  const a = { id: 'a', src: 'pc1-1', dst: 'pp1-3' };
  const c = { id: 'c', src: 'wp1-1', dst: 'sw1-5' };       // non tocca pp1-3
  assert.equal(mergeLinksThrough(a, c, 'pp1-3', { uid }).ok, false);
  const loopA = { id: 'a', src: 'pc1-1', dst: 'pp1-3' };
  const loopB = { id: 'b', src: 'pp1-3', dst: 'pc1-1' };   // outer uguali
  assert.equal(mergeLinksThrough(loopA, loopB, 'pp1-3', { uid }).ok, false);
});

// ---------- eligibleMidPorts / portConnectionCount ----------

test('portConnectionCount: conta i link che toccano la porta', () => {
  const links = [
    { src: 'pp1-1', dst: 'sw1-1' },
    { src: 'wp1-1', dst: 'pp1-1' },
    { src: 'pc1-1', dst: 'sw1-2' },
  ];
  assert.equal(portConnectionCount(links, 'pp1-1'), 2);
  assert.equal(portConnectionCount(links, 'sw1-2'), 1);
  assert.equal(portConnectionCount(links, 'mai-vista'), 0);
});

test('cablingAdjacencyValid: presa↔presa vietato, tutto il resto ammesso', () => {
  // Regola TIA-568: una presa a muro non si collega a un'altra presa a muro.
  assert.equal(cablingAdjacencyValid('wallport', 'wallport'), false);
  // Tutte le altre combinazioni valide
  assert.equal(cablingAdjacencyValid('wallport', 'patchpanel'), true);  // permanent link
  assert.equal(cablingAdjacencyValid('pc', 'wallport'), true);          // patch cord work-area
  assert.equal(cablingAdjacencyValid('patchpanel', 'switch'), true);    // patch cord rack
  assert.equal(cablingAdjacencyValid('patchpanel', 'patchpanel'), true);// cross-connect MDF/IDF
  assert.equal(cablingAdjacencyValid('pc', 'switch'), true);            // diretto
});

test('cablingHierLevel: livelli gerarchici TIA-568', () => {
  assert.equal(cablingHierLevel('pc'), 0);          // endpoint work-area
  assert.equal(cablingHierLevel('voip'), 0.5);      // P1.5-bis: telefono pass-through intermedio
  assert.equal(cablingHierLevel('wallport'), 1);    // telecom outlet
  assert.equal(cablingHierLevel('patchpanel'), 2);  // cross-connect
  assert.equal(cablingHierLevel('mediaconv'), 2);
  assert.equal(cablingHierLevel('switch'), 3);      // equipment (default)
  assert.equal(cablingHierLevel('router'), 3);
  assert.equal(cablingHierLevel('boh'), 3);         // sconosciuto → equipment
});

test('canRouteThrough: tappa valida solo se gerarchicamente TRA gli estremi', () => {
  // PC↔switch: presa(1) e patchpanel(2) entrambi tra 0 e 3 → validi
  assert.equal(canRouteThrough('pc', 'wallport', 'switch'), true);
  assert.equal(canRouteThrough('pc', 'patchpanel', 'switch'), true);
  // wallport↔switch: patchpanel(2) tra 1 e 3 → valido; altra presa(1) no
  assert.equal(canRouteThrough('wallport', 'patchpanel', 'switch'), true);
  assert.equal(canRouteThrough('wallport', 'wallport', 'switch'), false);
});

test('validMidTypes: quale tappa serve per quel cavo (per il toast context-aware)', () => {
  // wall port ↔ switch: SOLO il patch panel sta in mezzo (presa esclusa)
  assert.deepEqual(validMidTypes('wallport', 'switch'), ['patchpanel']);
  // PC ↔ switch: patch panel, presa a muro E telefono VoIP (PC pass-through, lvl 0.5)
  assert.deepEqual(validMidTypes('pc', 'switch').sort(), ['patchpanel', 'voip', 'wallport']);
  // wall port ↔ patch panel (livelli adiacenti 1↔2): nessuna tappa possibile
  assert.deepEqual(validMidTypes('wallport', 'patchpanel'), []);
  // switch ↔ switch (stesso livello attivo): nessuna tappa possibile → []
  assert.deepEqual(validMidTypes('switch', 'switch'), []);
});

test('canRouteThrough: NON allungare un segmento gia\' al suo posto', () => {
  // PC↔wallport (0↔1): niente sta in mezzo → non instradabile
  assert.equal(canRouteThrough('pc', 'patchpanel', 'wallport'), false);
  assert.equal(canRouteThrough('pc', 'wallport', 'wallport'), false);
  // patchpanel↔switch (2↔3): una presa(1) non sta tra 2 e 3 → bloccata
  assert.equal(canRouteThrough('patchpanel', 'wallport', 'switch'), false);
});

test('canRouteThrough: eccezione cross-connect patchpanel↔patchpanel (MDF/IDF)', () => {
  // patchpanel(IDF) ↔ switch: inserire patchpanel(MDF) = cross-connect backbone valido
  assert.equal(canRouteThrough('patchpanel', 'patchpanel', 'switch'), true);
  assert.equal(canRouteThrough('patchpanel', 'patchpanel', 'router'), true);
  // presa↔patchpanel attraverso un altro patchpanel NON è backbone (verso un
  // patch panel, non verso l'equipment): presa→pp→pp non ha senso fisico
  assert.equal(canRouteThrough('wallport', 'patchpanel', 'patchpanel'), false);
});

test('canRouteThrough: solo pass-through (wallport/patchpanel) come tappa', () => {
  assert.equal(canRouteThrough('pc', 'switch', 'router'), false);   // switch non è tappa
  assert.equal(canRouteThrough('pc', 'mediaconv', 'switch'), false); // mediaconv è 'device', non offerto
});

test('canRouteThrough: VoIP daisy-chain (P1.5-bis) — telefono tappa fra PC e presa', () => {
  // PC(0) → telefono(0.5) → presa(1): il telefono sta in mezzo → valido
  assert.equal(canRouteThrough('pc', 'voip', 'wallport'), true);
  // PC(0) → telefono(0.5) → switch(3): valido (telefono diretto a switch, PC dietro)
  assert.equal(canRouteThrough('pc', 'voip', 'switch'), true);
  // telefono NON sta fra due endpoint pari livello (PC↔PC, 0↔0)
  assert.equal(canRouteThrough('pc', 'voip', 'pc'), false);
  // un telefono non si inserisce fra presa(1) e switch(3): liv 0.5 < 1 = fuori range
  assert.equal(canRouteThrough('wallport', 'voip', 'switch'), false);
});

test('validateCablingChain: catena canonica = nessun warning', () => {
  // PC → telefono → presa → patch panel → switch (0, 0.5, 1, 2, 3) monotona
  let r = validateCablingChain(['pc', 'voip', 'wallport', 'patchpanel', 'switch']);
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 0);
  // diretto PC → switch
  r = validateCablingChain(['pc', 'switch']);
  assert.equal(r.ok, true);
  // permanent link presa → patch panel (1, 2)
  r = validateCablingChain(['wallport', 'patchpanel']);
  assert.equal(r.ok, true);
  // input degenere
  assert.equal(validateCablingChain([]).ok, true);
  assert.equal(validateCablingChain(['pc']).ok, true);
});

test('validateCablingChain: ordine non monotono → warning', () => {
  // PC → patch panel → presa → switch (0, 2, 1, 3): scende 2→1
  const r = validateCablingChain(['pc', 'patchpanel', 'wallport', 'switch']);
  assert.equal(r.ok, false);
  assert.ok(r.warnings.some(w => w.code === 'non-monotone'));
});

test('validateCablingChain: endpoint che non raggiunge la rete → incomplete-chain', () => {
  // PC cablato solo fino a una presa (0,1) → run monco
  let r = validateCablingChain(['pc', 'wallport']);
  assert.ok(r.warnings.some(w => w.code === 'incomplete-chain'), 'pc→presa è incompleto');
  // telefono → presa, nulla a valle (0.5, 1)
  r = validateCablingChain(['voip', 'wallport']);
  assert.ok(r.warnings.some(w => w.code === 'incomplete-chain'), 'voip→presa è incompleto');
  // PC → telefono → presa (0, 0.5, 1): il run del telefono non raggiunge lo switch
  r = validateCablingChain(['pc', 'voip', 'wallport']);
  assert.ok(r.warnings.some(w => w.code === 'incomplete-chain'), 'pc→voip→presa è incompleto');
  // NON falsi positivi: permanent link presa↔patch e backbone attivo↔attivo
  assert.ok(!validateCablingChain(['wallport', 'patchpanel']).warnings.some(w => w.code === 'incomplete-chain'));
  assert.ok(!validateCablingChain(['switch', 'patchpanel', 'switch']).warnings.some(w => w.code === 'incomplete-chain'));
  // catena completa: nessun incomplete-chain
  assert.ok(!validateCablingChain(['pc', 'voip', 'wallport', 'patchpanel', 'switch']).warnings.some(w => w.code === 'incomplete-chain'));
});

test('validateCablingChain: apparato attivo in mezzo → warning', () => {
  const r = validateCablingChain(['pc', 'switch', 'wallport']);
  assert.ok(r.warnings.some(w => w.code === 'active-mid'));
});

test('validateCablingChain: due endpoint ai capi → warning (manca apparato)', () => {
  const r = validateCablingChain(['pc', 'wallport', 'pc']);
  assert.ok(r.warnings.some(w => w.code === 'both-endpoints'));
});

test('validateCablingChain: trunk/backbone fra apparati ATTIVI = canonico (no both-active)', () => {
  // Ogni collegamento Ethernet termina su due dispositivi attivi: i capi
  // attivi NON sono un'anomalia. Trunk diretto switch↔switch:
  assert.equal(validateCablingChain(['switch', 'switch']).ok, true);
  assert.equal(validateCablingChain(['switch', 'router']).ok, true);
  // Backbone TIA-568 attraverso cross-connect (patch panel MDF/IDF):
  assert.equal(validateCablingChain(['switch', 'patchpanel', 'router']).ok, true);
  assert.equal(validateCablingChain(['switch', 'patchpanel', 'patchpanel', 'switch']).ok, true);
  // Edge switch in ufficio via cablaggio strutturato (presa → patch → switch):
  assert.equal(validateCablingChain(['switch', 'wallport', 'patchpanel', 'switch']).ok, true);
  // Il codice 'both-active' non deve piu' esistere
  for (const t of [['switch','switch'], ['switch','patchpanel','router']]) {
    assert.ok(!validateCablingChain(t).warnings.some(w => w.code === 'both-active'));
  }
});

test('validateCablingChain: PICCO interno → warning anche fra due attivi', () => {
  // switch → patchpanel → presa → patchpanel → switch va bene (valle 3,2,1,2,3)…
  assert.equal(validateCablingChain(['switch', 'patchpanel', 'wallport', 'patchpanel', 'switch']).ok, true);
  // …ma salire e poi RIDISCENDERE no: pc → patchpanel → presa → switch (0,2,1,3)
  const r = validateCablingChain(['pc', 'patchpanel', 'wallport', 'switch']);
  assert.ok(r.warnings.some(w => w.code === 'non-monotone'));
});

test('validateCablingChain: catena troppo lunga (> 6 nodi) → warning', () => {
  const r = validateCablingChain(['pc', 'voip', 'wallport', 'patchpanel', 'patchpanel', 'patchpanel', 'switch']);
  assert.ok(r.warnings.some(w => w.code === 'too-long'));
});

test('chainAmbiguousLinkIds: catena con ≥1 hop inferito → tutta inferita (P1.5-bis)', () => {
  // PC ↔ pp (manuale) + pp ↔ sw (inferito): condividono pp1-3 (pass-through)
  // → stessa catena → ENTRAMBI marcati inferiti finché non è tutto confermato.
  const links = [
    { id: 'a', src: 'pc1-1', dst: 'pp1-3' },                    // manuale
    { id: 'b', src: 'pp1-3', dst: 'sw1-5', autoLinked: true },  // inferito
  ];
  const isPT = pid => /^pp/.test(pid);            // solo il patch panel è pass-through
  const isAmb = l => !!l.autoLinked;
  const res = chainAmbiguousLinkIds(links, isPT, isAmb);
  assert.equal(res.has('a'), true);   // il tratto manuale resta inferito (catena non confermata)
  assert.equal(res.has('b'), true);
});

test('chainAmbiguousLinkIds: catena tutta confermata → nessuno inferito', () => {
  const links = [
    { id: 'a', src: 'pc1-1', dst: 'pp1-3' },
    { id: 'b', src: 'pp1-3', dst: 'sw1-5' },
  ];
  const res = chainAmbiguousLinkIds(links, pid => /^pp/.test(pid), l => !!l.autoLinked);
  assert.equal(res.size, 0);
});

test('chainAmbiguousLinkIds: cavi su porte diverse dello stesso device NON sono in catena', () => {
  // a tocca pp1-3, b tocca pp1-7: stesso patch panel ma jack diversi → catene
  // separate. b inferito non deve contagiare a.
  const links = [
    { id: 'a', src: 'pc1-1', dst: 'pp1-3' },
    { id: 'b', src: 'pp1-7', dst: 'sw1-5', autoLinked: true },
  ];
  const res = chainAmbiguousLinkIds(links, pid => /^pp/.test(pid), l => !!l.autoLinked);
  assert.equal(res.has('a'), false);
  assert.equal(res.has('b'), true);
});

test('chainAmbiguousLinkIds: la catena NON attraversa un endpoint/apparato (non pass-through)', () => {
  // a ↔ sw e sw ↔ b condividono sw1-1, ma lo switch NON è pass-through → due
  // catene distinte: un cavo inferito su un lato non contagia l'altro.
  const links = [
    { id: 'a', src: 'pc1-1', dst: 'sw1-1', autoLinked: true },
    { id: 'b', src: 'sw1-1', dst: 'pc2-1' },
  ];
  const res = chainAmbiguousLinkIds(links, () => false, l => !!l.autoLinked);
  assert.equal(res.has('a'), true);
  assert.equal(res.has('b'), false);
});

test('chainVlanColorMap: segmento untagged eredita il colore VLAN della catena (P1.5-bis)', () => {
  // PC ↔ presa (untagged, nessun colore) + presa ↔ switch (VLAN 20 verde):
  // condividono wp1-1 (pass-through) → stessa catena → il tratto PC↔presa
  // eredita il verde dal tratto verso la sorgente.
  const links = [
    { id: 'a', src: 'pc1-1', dst: 'wp1-1' },                 // untagged
    { id: 'b', src: 'wp1-1', dst: 'sw1-5' },                 // VLAN 20
  ];
  const isPT = pid => /^wp/.test(pid);
  const colorOf = l => l.id === 'b' ? '#3fb950' : null;      // solo 'b' ha colore
  const res = chainVlanColorMap(links, isPT, colorOf);
  assert.equal(res.get('a'), '#3fb950');   // PC↔presa eredita il verde
  assert.equal(res.get('b'), '#3fb950');
});

test('chainVlanColorMap: catena senza alcun colore → nessuna voce', () => {
  const links = [
    { id: 'a', src: 'pc1-1', dst: 'wp1-1' },
    { id: 'b', src: 'wp1-1', dst: 'sw1-5' },
  ];
  const res = chainVlanColorMap(links, pid => /^wp/.test(pid), () => null);
  assert.equal(res.size, 0);
});

test('chainVlanColorMap: catene separate non si contagiano il colore', () => {
  const links = [
    { id: 'a', src: 'pc1-1', dst: 'wp1-1' },                 // catena 1 (no colore)
    { id: 'b', src: 'wp1-1', dst: 'sw1-5' },                 // catena 1 (no colore)
    { id: 'c', src: 'pc2-1', dst: 'wp2-1' },                 // catena 2
    { id: 'd', src: 'wp2-1', dst: 'sw1-9' },                 // catena 2 (VLAN verde)
  ];
  const colorOf = l => l.id === 'd' ? '#3fb950' : null;
  const res = chainVlanColorMap(links, pid => /^wp/.test(pid), colorOf);
  assert.equal(res.has('a'), false);       // catena 1 resta senza colore
  assert.equal(res.get('c'), '#3fb950');   // catena 2 colorata
  assert.equal(res.get('d'), '#3fb950');
});

test('eligibleMidPorts: solo porte con almeno 2 slot liberi', () => {
  const links = [{ src: 'pp1-1', dst: 'sw1-1' }];     // pp1-1: 1 usato su 2 → 1 libero
  const res = eligibleMidPorts({
    links,
    ports: ['pp1-1', 'pp1-2', 'wp1-1'],
    maxConnOf: () => 2,
  });
  const pids = res.map(x => x.pid);
  assert.deepEqual(pids, ['pp1-2', 'wp1-1']);          // pp1-1 esclusa
  assert.equal(res[0].free, 2);
});
