// Test per «che cosa rappresenta questo cavo» (lib/link-vlan-color.js).
//
// La regola di fondo, decisa dopo aver guardato i dati veri: **su un trunk
// nessuna VLAN vince**. Tutte servono, e ogni criterio che ne elegge una dice
// una cosa falsa — il controesempio che chiude la questione è un'interfaccia
// che fa gestione E VLAN 30: non ha una risposta, non è che sia difficile
// calcolarla. Quindi un trunk multi-VLAN resta NEUTRO e le mostra tutte.
//
// I casi sono quelli MISURATI sul banco (progetto 10): il CSR con la
// sotto-interfaccia Gi1.99, il server SRV-LINUX con l'IP in VLAN 30 dichiarata,
// i trunk fra switch che portano 10/20/30/99 con nativa 1, e la porta Gi0/0 di
// SW-CORE che possiede 10.99.0.2 e quindi instrada invece di commutare.
const test = require('node:test');
const assert = require('node:assert/strict');
const { linkPaintVlan } = require('../lib/link-vlan-color.js');

const paint = (o) => linkPaintVlan(o);

// ---- Manual-first ----------------------------------------------------------

test('ovr: override manuale su capo attivo vince su tutto (access e trunk)', () => {
  const src = { active: true, vlanOvr: 77, vlan: 5, vlanProp: 9, subIfVlans: [99] };
  for (const mode of ['access', 'trunk']) {
    const r = paint({ mode, native: 1, vlans: [1, 10, 20], src, dst: {} });
    assert.equal(r.vlan, 77);
    assert.equal(r.kind, 'vlan');
    assert.equal(r.source, 'ovr');
  }
});

test('ovr: l’override su porta PASSIVA non prevale (lo switch comanda)', () => {
  const r = paint({ mode: 'access', native: 30, vlans: [30],
    src: { active: false, vlanOvr: 77 }, dst: { active: true, vlan: 30 } });
  assert.equal(r.vlan, 30);
  assert.equal(r.source, 'measured');
});

// ---- Il cavo INSTRADA: non sta in nessuna VLAN, nemmeno nella 1 ------------

test('routed: una porta che possiede un IP non appartiene a nessuna VLAN', () => {
  // SW-CORE Gi0/0 dichiara 10.99.0.2: `no switchport` + indirizzo → livello 3.
  // La VLAN 1 è il default dei port COMMUTATI, non un ripiego universale.
  const r = paint({ mode: 'access', native: 1, vlans: [1],
    src: { active: true, routed: true }, dst: { active: true } });
  assert.equal(r.kind, 'routed');
  assert.equal(r.vlan, null);
  assert.equal(r.known, false);
});

test('routed: NON batte una VLAN che si applica davvero', () => {
  // Se lo switch dice che la porta è in VLAN 30, il cavo è in VLAN 30 — anche se
  // all'altro capo c'è un apparato con un indirizzo sulla sua interfaccia.
  const r = paint({ mode: 'access', native: 1, vlans: [1],
    src: { active: true, vlan: 30 }, dst: { active: true, routed: true } });
  assert.equal(r.kind, 'vlan');
  assert.equal(r.vlan, 30);
});

test('routed: un HOST con l’IP sulla NIC resta un endpoint dentro la sua VLAN', () => {
  // Misurato sul banco: mettendo il controllo `routed` in cima alla scala, il
  // router VyOS e il controller wireless — appesi a porte access in VLAN 99 —
  // uscivano «instradati». Possedere un indirizzo è normale per QUALSIASI host:
  // non dice niente su come lo switch tratta quel cavo.
  const vyos = paint({ mode: 'access', native: 1, vlans: [1],
    src: { active: true },                                             // switch muto sul PVID
    dst: { active: true, routed: true, endpointVlan: 99, singleHomed: true } });
  assert.equal(vyos.kind, 'vlan');
  assert.equal(vyos.vlan, 99, 'la rete dichiarata dell’endpoint si applica prima di «instradato»');

  const wlc = paint({ mode: 'access', native: 1, vlans: [1],
    src: { active: true, vlan: 1 },                                    // lo switch la misura
    dst: { active: true, routed: true } });
  assert.equal(wlc.vlan, 1, 'la misura dello switch vince su un IP di NIC');
});

test('routed: vale quando NESSUNA VLAN si applica — è lì che spiega il perché', () => {
  // Il caso vero: SW-CORE Gi0/0 è `no switchport` con 10.99.0.2, l'altro capo è
  // un router fuori da ogni prefisso dichiarato. Nessuna fonte dice una VLAN, e
  // la ragione non è che non la sappiamo: è che non ce n'è una.
  const r = paint({ mode: 'access', vlans: [],
    src: { active: true, routed: true }, dst: { active: true } });
  assert.equal(r.kind, 'routed');
  assert.equal(r.vlan, null);
});

test('routed: NON è la stessa cosa di «non dichiarata»', () => {
  const instradato = paint({ mode: 'access', vlans: [], src: { routed: true }, dst: {} });
  const muto       = paint({ mode: 'access', vlans: [], src: { active: true }, dst: {} });
  assert.equal(instradato.kind, 'routed');
  assert.equal(muto.kind, 'undeclared');
  assert.notEqual(instradato.kind, muto.kind, 'un fatto e una lacuna non sono lo stesso stato');
});

test('routed: un override manuale resta piu’ forte (l’utente sa cosa scrive)', () => {
  const r = paint({ mode: 'access', vlans: [],
    src: { active: true, vlanOvr: 42, routed: true }, dst: {} });
  assert.equal(r.kind, 'vlan');
  assert.equal(r.vlan, 42);
});

// ---- Cavo ACCESS: una VLAN sola si applica, si cerca QUALE -----------------

test('access: la VLAN misurata sul capo attivo vince sulle fonti dichiarate', () => {
  // Uno switch che risponde «VLAN 1» su una porta il cui endpoint ha un IP in
  // VLAN 30: vince la MISURA. La contraddizione la segnala l'audit, non il colore.
  const r = paint({ mode: 'access', native: 1, vlans: [1],
    src: { active: true, vlan: 1 },
    dst: { endpointVlan: 30, singleHomed: true } });
  assert.equal(r.vlan, 1);
  assert.equal(r.source, 'measured');
});

test('access: senza misura, la propagata a monte batte le dichiarazioni', () => {
  const r = paint({ mode: 'access', native: 20, vlans: [20],
    src: { vlanProp: 20 }, dst: { endpointVlan: 30, singleHomed: true } });
  assert.equal(r.vlan, 20);
  assert.equal(r.source, 'prop');
});

test('access: SRV-LINUX — nessuna misura, IP nel prefisso dichiarato VLAN 30', () => {
  const r = paint({ mode: 'access', native: 1, vlans: [1],
    src: { active: true },                                  // switch muto sul PVID
    dst: { endpointVlan: 30, singleHomed: true } });
  assert.equal(r.vlan, 30);
  assert.equal(r.source, 'declared-ip');
});

test('access: l’IP di un endpoint MULTI-cablato non dice nulla su QUESTO cavo', () => {
  const r = paint({ mode: 'access', native: 1, vlans: [1],
    src: { active: true },
    dst: { endpointVlan: 30, singleHomed: false } });
  assert.equal(r.kind, 'undeclared');
});

test('access: due capi mono-cablati che si contraddicono ⇒ non si arbitra', () => {
  const r = paint({ mode: 'access', native: 1, vlans: [1],
    src: { endpointVlan: 10, singleHomed: true },
    dst: { endpointVlan: 30, singleHomed: true } });
  assert.equal(r.kind, 'undeclared');
});

test('access: cavo fra due passivi muti ⇒ non dichiarata, NON «VLAN 1»', () => {
  const r = paint({ mode: 'access', native: 1, vlans: [1], src: {}, dst: {} });
  assert.equal(r.kind, 'undeclared');
  assert.equal(r.vlan, null);
});

// ---- Cavo TRUNK: nessuna VLAN vince ---------------------------------------

test('trunk: piu’ VLAN trasportate ⇒ NEUTRO, nessuna diventa il colore', () => {
  const r = paint({ mode: 'trunk', native: 1, vlans: [1, 10, 20, 30, 99],
    src: { active: true, vlan: 1 }, dst: { active: true, vlan: 1 } });
  assert.equal(r.kind, 'trunk');
  assert.equal(r.vlan, null);
  assert.equal(r.source, 'multi-vlan');
  assert.deepEqual(r.vlans, [1, 10, 20, 30, 99], 'le porta con sé: si mostrano tutte insieme');
});

test('trunk: la gestione NON vince piu’ per il fatto di stare su ogni trunk', () => {
  // Era la regola vecchia: entrambi i capi gestiti in 99 → colore 99. Ma la VLAN
  // di gestione sta su OGNI trunk per definizione, quindi dipingeva tutti i cavi
  // dello stesso colore — l'informazione meno utile che quel cavo avesse.
  const r = paint({ mode: 'trunk', native: 1, vlans: [1, 10, 20, 99],
    src: { active: true, endpointVlan: 99 },
    dst: { active: true, endpointVlan: 99 } });
  assert.equal(r.kind, 'trunk');
});

test('trunk: nemmeno la sotto-interfaccia elegge una vincitrice', () => {
  // Il CSR dichiara Gi1.99 sulla porta cablata, ma se il cavo porta anche la 30
  // allora servono entrambe: constatare non è scegliere.
  const r = paint({ mode: 'trunk', native: 1, vlans: [1, 30, 99],
    src: { active: true, subIfVlans: [99], singleHomed: true },
    dst: { active: true, vlan: 1 } });
  assert.equal(r.kind, 'trunk');
});

test('trunk: UNA sola VLAN trasportata ⇒ si constata, non si sceglie', () => {
  const r = paint({ mode: 'trunk', native: 1, vlans: [1, 20], src: { active: true }, dst: { active: true } });
  assert.equal(r.kind, 'vlan');
  assert.equal(r.vlan, 20);
  assert.equal(r.source, 'single-vlan');
});

test('trunk: nessuna taggata e nativa NOTA ⇒ quella è l’unica VLAN che passa', () => {
  const r = paint({ mode: 'trunk', native: 50, vlans: [50], src: { active: true }, dst: { active: true } });
  assert.equal(r.vlan, 50);
  assert.equal(r.source, 'single-vlan');
  // e vale anche quando l'unica è la 1: è una misura, non un ripiego
  assert.equal(paint({ mode: 'trunk', native: 1, vlans: [1], src: {}, dst: {} }).vlan, 1);
});

test('trunk: nessuna VLAN nota affatto ⇒ non dichiarata', () => {
  const r = paint({ mode: 'trunk', vlans: [], src: { active: true }, dst: { active: true } });
  assert.equal(r.kind, 'undeclared');
});

// ---- Igiene ---------------------------------------------------------------

test('valori fuori range o spazzatura sono ASSENZA, non zero', () => {
  const r = paint({ mode: 'access', native: 0, vlans: [0, 5000, 'x', 30],
    src: { active: true, vlan: 5000 }, dst: { active: true, vlanOvr: 'abc' } });
  assert.equal(r.kind, 'undeclared');
  assert.deepEqual(r.vlans, [30]);
});

test('input vuoto non lancia', () => {
  assert.equal(paint(undefined).kind, 'undeclared');
  assert.equal(paint({}).known, false);
});

test('un colore si chiede SOLO quando kind vale «vlan»', () => {
  for (const r of [
    paint({ mode: 'trunk', vlans: [1, 10, 20], src: {}, dst: {} }),
    paint({ mode: 'access', vlans: [], src: { routed: true }, dst: {} }),
    paint({ mode: 'access', vlans: [], src: {}, dst: {} }),
  ]) {
    assert.equal(r.known, false);
    assert.equal(r.vlan, null, 'niente VLAN fuori dallo stato «vlan»: chi dipinge non deve indovinare');
  }
});
