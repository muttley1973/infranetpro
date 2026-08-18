// Il gruppo scritto nel NOME della presa (lib/power-groups.js) e il travaso del
// catalogo nel nodo (applyTemplateToNode). Due regole d'onestà governano tutto:
// il nome si legge, la posizione non si indovina; e quello che hai scritto tu
// sopravvive all'applicazione di un modello.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../lib/power-groups.js');

test('parser: legge il gruppo dai nomi che i costruttori usano davvero', () => {
  const p = G.parseOutletGroupName.bind(G);
  // APC, Eaton: gruppo numerato — la forma più diffusa.
  assert.deepEqual(p('Group 1 Outlet 3'), { key: 'group1', label: 'Group 1', switching: 'switched' });
  assert.deepEqual(p('Group 2 - Output 1'), { key: 'group2', label: 'Group 2', switching: 'switched' });
  // Bastion, SNR: nessun separatore, e un underscore dopo il numero.
  assert.deepEqual(p('Segment1_3'), { key: 'segment1', label: 'Segment 1', switching: 'switched' });
  assert.deepEqual(p('Segment2-1'), { key: 'segment2', label: 'Segment 2', switching: 'switched' });
  // Eaton «Primary», Vertiv «Non Programmable»: il gruppo SEMPRE ACCESO.
  assert.equal(p('Primary Group - Outlet1').switching, 'always');
  assert.equal(p('Power Outlet - Non Programmable 1').switching, 'always',
    '«non programmable» va riconosciuto PRIMA di «programmable», che ci sta dentro');
  assert.equal(p('Power Outlet - Programmable 2').switching, 'switched');
  // CyberPower, Ubiquiti: l'asse del soccorso.
  assert.equal(p('Surge Only 2').backup, 'surge');
  assert.equal(p('Battery Backup/Surge 4').backup, 'battery',
    '«Battery Backup/Surge» contiene la parola surge: vince «battery», perché solo «surge only» nega la batteria');
  // Quello che non dice niente resta senza gruppo: la posizione non è un indizio.
  assert.equal(p('Outlet 5'), null);
  assert.equal(p('16A Outlet 1'), null);
  assert.equal(p(''), null);
  assert.equal(p(null), null);
});

test('deriveOutletGroups: id stabili nell\'ordine di comparsa, tetto a 8', () => {
  const d = G.deriveOutletGroups([
    { name: 'Group 1 Outlet 1' }, { name: 'Group 1 Outlet 2' },
    { name: 'Group 2 Outlet 1' }, { name: 'Outlet 9' },
    { name: 'Primary Group - Outlet1' },
  ]);
  assert.deepEqual(d.groups.map(g => [g.id, g.name, g.switching]), [
    ['g1', 'Group 1', 'switched'], ['g2', 'Group 2', 'switched'], ['g3', 'Primary', 'always'],
  ]);
  assert.deepEqual(d.assign, ['g1', 'g1', 'g2', '', 'g3']);

  // `backup` si emette SOLO se il nome lo dichiara: dedurre «batteria» da un nome
  // muto sarebbe inventare la risposta alla domanda per cui esiste un UPS.
  assert.equal(d.groups[0].backup, undefined);
  assert.equal(G.deriveOutletGroups([{ name: 'Surge Only 1' }]).groups[0].backup, 'surge');

  const troppi = G.deriveOutletGroups(Array.from({ length: 12 }, (_, i) => ({ name: 'Group ' + (i + 1) + ' Outlet 1' })));
  assert.equal(troppi.groups.length, G.MAX_POWER_GROUPS);
  assert.deepEqual(troppi.assign.slice(8), ['', '', '', ''], 'oltre il tetto la presa resta senza gruppo, non ne prende uno a caso');
});

test('deriveOutletGroups: elenco vuoto o prese senza nome → nessun gruppo', () => {
  assert.deepEqual(G.deriveOutletGroups([]), { groups: [], assign: [] });
  assert.deepEqual(G.deriveOutletGroups(null), { groups: [], assign: [] });
  assert.deepEqual(G.deriveOutletGroups([{}, { name: '' }]).assign, ['', '']);
});

// ── Il travaso dal catalogo al nodo ────────────────────────────────────────
// applyTemplateToNode vive in un modulo ESM del browser; qui se ne riprova la
// regola con la stessa logica pura, perché è quella a dover reggere: il modello
// porta l'hardware, il tuo lavoro resta.
test('catalogo → nodo: il modello porta l\'hardware, la tua parola resta', () => {
  const tmpl = {
    powerOutlets: [
      { name: 'Group 1 Outlet 1', type: 'iec-60320-c13', group: 'g1' },
      { name: 'Group 1 Outlet 2', type: 'iec-60320-c13', group: 'g1' },
      { name: 'Group 2 Outlet 1', type: 'iec-60320-c19', group: 'g2' },
    ],
    powerGroups: [
      { id: 'g1', name: 'Group 1', switching: 'switched' },
      { id: 'g2', name: 'Group 2', switching: 'switched' },
    ],
  };
  // Un nodo con del lavoro già fatto sopra: una presa collegata a mano e una
  // presa in più documentata che il modello non prevede.
  const node = {
    type: 'ups',
    powerOutlets: [
      { name: 'vecchio nome', connectionOvr: { deviceName: 'Server-01' }, groupOvr: 'gX' },
      {},
      {},
      { name: 'Presa aggiunta a mano', statusOvr: 'active' },
    ],
  };
  // Riproduce _applyTemplateOutlets (src/app-device-types.js).
  const KEEP = ['id', 'groupOvr', 'statusOvr', 'connectionOvr', 'connectedTo', 'connectedDeviceId',
    'connectedDeviceName', 'connectedPortName', 'connected', 'rawStatus', 'status'];
  const merged = tmpl.powerOutlets.map((tpl, i) => {
    const prev = node.powerOutlets[i] || null;
    const next = { name: tpl.name };
    if (tpl.type) next.type = tpl.type;
    if (tpl.group) next.group = tpl.group;
    if (prev) for (const k of KEEP) if (prev[k] !== undefined) next[k] = prev[k];
    return next;
  });
  for (let i = tmpl.powerOutlets.length; i < node.powerOutlets.length; i++) merged.push(node.powerOutlets[i]);
  node.powerOutlets = merged;
  if (tmpl.powerGroups.length && !G.powerGroups(node).length) node.powerGroups = tmpl.powerGroups.map(g => ({ ...g }));

  assert.equal(node.powerOutlets.length, 4, 'la presa documentata in più non si cancella');
  assert.equal(node.powerOutlets[0].name, 'Group 1 Outlet 1', 'il nome viene dal modello: è hardware');
  assert.equal(node.powerOutlets[0].type, 'iec-60320-c13');
  assert.deepEqual(node.powerOutlets[0].connectionOvr, { deviceName: 'Server-01' }, 'il collegamento dichiarato sopravvive');
  assert.equal(node.powerOutlets[0].groupOvr, 'gX', 'e anche il gruppo che gli avevi dato tu');
  assert.equal(node.powerOutlets[3].name, 'Presa aggiunta a mano');
  assert.deepEqual(G.powerGroups(node).map(g => g.id), ['g1', 'g2']);

  // La presa 0 punta a un gruppo che non esiste: la vista lo dichiara ORFANO
  // invece di contarla fra le non assegnate — è il tuo dato, sbagliato, e va visto.
  const v = G.powerGroupView(node, node.powerOutlets);
  assert.deepEqual(v.orphan, [{ index: 0, id: 'gx' }]);
  assert.deepEqual(v.groups.map(g => g.outlets), [[1], [2]]);
});

test('catalogo → nodo: i gruppi già dichiarati NON vengono ribattezzati', () => {
  const node = { type: 'ups', powerGroups: [{ id: 'g1', name: 'Critici', switching: 'always' }] };
  const tmpl = { powerGroups: [{ id: 'g1', name: 'Group 1', switching: 'switched' }] };
  if (tmpl.powerGroups.length && !G.powerGroups(node).length) node.powerGroups = tmpl.powerGroups.map(g => ({ ...g }));
  assert.equal(G.powerGroups(node)[0].name, 'Critici');
  assert.equal(G.powerGroups(node)[0].switching, 'always');
});
