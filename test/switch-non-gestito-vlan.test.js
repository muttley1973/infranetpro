// ============================================================================
// Uno switch NON GESTITO è trasparente alle VLAN: il frame lo attraversa
// ============================================================================
// Il criterio è quello che usano gli apparati veri quando si passano i frame:
// **si segue il frame finché qualcuno lo riclassifica**. Chi ha un PVID decide
// (classificazione in ingresso 802.1Q); chi non classifica — patch panel, presa
// a muro, media converter, e uno switch NON GESTITO — lo lascia passare intatto;
// chi instrada lo consuma e la VLAN finisce lì.
//
// Uno switch non gestito è un bridge 802.1D puro: commuta guardando il MAC, non
// ha tabella VLAN, non aggiunge né toglie tag. La VLAN di tutto ciò che gli sta
// appeso la decide la porta VLAN-aware al suo bordo — e vale per TUTTE le sue
// prese, perché il suo interno è un dominio solo.
//
// ⚠️ Va DICHIARATO, non dedotto: uno switch gestito che non abbiamo mai
// interrogato è indistinguibile da uno non gestito, e indovinare vorrebbe dire
// far passare una VLAN attraverso un apparato che invece le separa. La
// dichiarazione esiste già nel pannello Switch (`swMgmt`), non la leggeva nessuno.
//
// Misurato prima di scrivere il codice: con la catena
// `switch gestito (VLAN 30) → non gestito → PC` il cavo a valle usciva
// «VLAN non dichiarata», perché la VLAN moriva sulla porta di uplink.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (switch-non-gestito)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

// Catena: SW-GESTITO porta 2 → [in mezzo] porta 1 · [in mezzo] porta 2 → PC.
const catena = (tipoMezzo, swMgmt, dbMonte, vlanMonte) => `(() => {
  state = _buildDefaultState();
  state.nodes = []; state.links = []; state.ports = {};
  state.ipam = { vlans:{}, prefixes:[], addresses:[] };
  state.nodes.push({ id:'sw1', type:'switch', name:'SW-GESTITO', ports:2, ip:'10.0.0.1',
                     integration:{ vlans:${JSON.stringify(dbMonte)} } });
  state.nodes.push({ id:'mid', type:'${tipoMezzo}', name:'IN-MEZZO', ports:4${swMgmt ? `, swMgmt:'${swMgmt}'` : ''} });
  state.nodes.push({ id:'pc1', type:'pc', name:'PC', ports:1 });
  state.links.push({ id:'l1', src:'sw1-2', dst:'mid-1' });
  state.links.push({ id:'l2', src:'mid-2', dst:'pc1-1' });
  state.ports['sw1-2'] = { ifName:'Gi1/1', vlan:${vlanMonte} };
  if(typeof _invalidateIdx==='function') _invalidateIdx();
  propagateVlans();
  const p1 = _linkPaintVlan(state.links[0]);
  const p2 = _linkPaintVlan(state.links[1]);
  return {
    monte: p1.vlan, monteFonte: p1.source,
    valle: p2.vlan, valleFonte: p2.source, valleKind: p2.kind,
    propUscita: state.ports['mid-2']?.vlanProp ?? null,
    effUscita: _effPortVlan('mid-2'),
  };
})()`;

// ---- ① Il predicato: chi classifica le VLAN --------------------------------

test('classifica: uno switch gestito sì, uno NON gestito no', () => {
  const out = run(APP.ctx, `(() => ({
    gestito:    isVlanAware({ type:'switch' }),
    esplicito:  isVlanAware({ type:'switch', swMgmt:'managed' }),
    smart:      isVlanAware({ type:'switch', swMgmt:'smart' }),
    nonGestito: isVlanAware({ type:'switch', swMgmt:'unmanaged' }),
    router:     isVlanAware({ type:'router' }),
    patchpanel: isVlanAware({ type:'patchpanel' }),
    niente:     isVlanAware(null),
  }))()`);
  assert.equal(out.gestito, true);
  assert.equal(out.esplicito, true);
  assert.equal(out.smart, true, 'uno smart-managed ha le VLAN: solo «unmanaged» è trasparente');
  assert.equal(out.nonGestito, false);
  assert.equal(out.router, true);
  assert.equal(out.patchpanel, false, 'un passivo non ha mai classificato niente');
  assert.equal(out.niente, false);
});

// ---- ② Il frame attraversa il non gestito ---------------------------------

test('il frame attraversa lo switch non gestito e arriva al PC con la sua VLAN', () => {
  const out = run(APP.ctx, catena('switch', 'unmanaged', [1, 30], 30));
  assert.equal(out.monte, 30, 'il cavo di uplink porta la VLAN misurata');
  assert.equal(out.valle, 30, 'e la stessa VLAN vale dall’altra parte della ciabatta');
  assert.equal(out.valleKind, 'vlan');
  assert.equal(out.propUscita, 30, 'la porta di uscita eredita: il suo interno è un dominio solo');
});

test('anche il pannello della porta dice la stessa VLAN (una definizione sola)', () => {
  // `_effPortVlan` componeva «attivo» per conto suo: senza unificare, il pannello
  // avrebbe detto la nativa di sito mentre il cavo diceva 30.
  const out = run(APP.ctx, catena('switch', 'unmanaged', [1, 30], 30));
  assert.equal(out.effUscita, 30);
});

// ---- ③ La trasparenza NON si estende a chi le VLAN le separa --------------

test('uno switch GESTITO in mezzo non fa passare niente: ogni sua porta ha la sua VLAN', () => {
  // La riprova del riconoscitore: se la trasparenza si applicasse a tutti gli
  // switch, questo test passerebbe per il motivo sbagliato.
  const out = run(APP.ctx, catena('switch', 'managed', [1, 30], 30));
  assert.equal(out.monte, 30);
  assert.notEqual(out.valle, 30, 'la VLAN di monte NON attraversa uno switch che classifica');
  assert.equal(out.propUscita, null);
});

test('un patch panel resta trasparente com’è sempre stato', () => {
  // ⚠️ Il patch panel è `passThrough:'port'`: fronte e retro sono LO STESSO pid,
  // e i due cavi si attaccano entrambi lì (è cosi' anche nei progetti veri). La
  // catena passa da sé, senza ponte interno — e deve continuare a passare.
  const out = run(APP.ctx, `(() => {
    state = _buildDefaultState();
    state.nodes = []; state.links = []; state.ports = {};
    state.ipam = { vlans:{}, prefixes:[], addresses:[] };
    state.nodes.push({ id:'sw1', type:'switch', name:'SW', ports:2, ip:'10.0.0.1', integration:{ vlans:[1,30] } });
    state.nodes.push({ id:'pp1', type:'patchpanel', name:'PP', ports:4 });
    state.nodes.push({ id:'pc1', type:'pc', name:'PC', ports:1 });
    state.links.push({ id:'l1', src:'sw1-2', dst:'pp1-1' });
    state.links.push({ id:'l2', src:'pp1-1', dst:'pc1-1' });
    state.ports['sw1-2'] = { ifName:'Gi1/1', vlan:30 };
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    propagateVlans();
    const p2 = _linkPaintVlan(state.links[1]);
    return { valle: p2.vlan, fonte: p2.source };
  })()`);
  assert.equal(out.valle, 30);
});

// ---- ④ Il non gestito non ha voce in capitolo sulla VLAN -------------------

test('un non gestito non dichiara VLAN nemmeno se il documento gliene attribuisce una', () => {
  // Un apparato senza tabella VLAN non può misurare una VLAN: se un import o una
  // vecchia lettura gliene ha lasciata una addosso, non deve comandare la catena.
  const out = run(APP.ctx, `(() => {
    state = _buildDefaultState();
    state.nodes = []; state.links = []; state.ports = {};
    state.ipam = { vlans:{}, prefixes:[], addresses:[] };
    state.nodes.push({ id:'sw1', type:'switch', name:'SW', ports:2, ip:'10.0.0.1', integration:{ vlans:[1,30] } });
    state.nodes.push({ id:'mid', type:'switch', name:'CIABATTA', ports:4, swMgmt:'unmanaged' });
    state.nodes.push({ id:'pc1', type:'pc', name:'PC', ports:1 });
    state.links.push({ id:'l1', src:'sw1-2', dst:'mid-1' });
    state.links.push({ id:'l2', src:'mid-2', dst:'pc1-1' });
    state.ports['sw1-2'] = { ifName:'Gi1/1', vlan:30 };
    state.ports['mid-2'] = { vlan:7 };            // residuo: non è una misura possibile
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    propagateVlans();
    const p = _linkPaintVlan(state.links[1]);
    return { vlan: p.vlan, source: p.source };
  })()`);
  assert.equal(out.vlan, 30, 'comanda lo switch che classifica, non la ciabatta');
});
