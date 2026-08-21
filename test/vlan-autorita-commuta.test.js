// ============================================================================
// Chi ha TITOLO per dire la VLAN di un cavo: non «un apparato attivo», ma
// «uno che COMMUTA VLAN».
// ============================================================================
// Il modello del colore chiedeva la VLAN al capo ATTIVO (switch/router/firewall/
// controller). Ma «attivo» e' una proprieta' del TIPO, non una misura, e non
// dice affatto che quell'apparato stia assegnando VLAN.
//
// Misurato sul banco il 2026-08-21, interrogando dal vivo: il controller
// wireless (`AIR-CTVM-K9`, 10.10.99.24) e lo switch EXOS (10.10.99.31)
// dichiarano `vlan=1` sulla PROPRIA porta e hanno un mondo VLAN di `[1]` —
// cioe' la loro interfaccia e' UNTAGGED, che non e' la stessa cosa di «sta in
// VLAN 1». Rispondono pero' su 10.10.99.x, quindi vivono in VLAN 99. Lo switch
// di fronte tace (il vIOS non pubblica i PVID delle access). Risultato: il cavo
// usciva VLAN 1 mentre la rete DICHIARATA dice 99.
//
// ⭐ Il discriminante e' gia' nel dato, ed e' vendor-neutral: un apparato il cui
// mondo VLAN e' `[1]` non sta commutando VLAN, e non puo' essere autorevole su
// una VLAN che non conosce. Un apparato che ne conosce altre, invece, quando
// dice «1» lo sta scegliendo.
//
// ⚠️ Stessa forma del difetto chiuso nella 2.10.1 ([[vlan-dichiarata-non-inventata]]):
// un «1» che sembra una misura e misura un'altra cosa.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { switchesVlans, authoritativeVlan } = require('../lib/vlan-authority.js');
const { linkPaintVlan } = require('../lib/link-vlan-color.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

// ---- ① Il predicato puro ---------------------------------------------------

test('commuta: un mondo VLAN con qualcosa oltre la 1 dice che l’apparato fa VLAN', () => {
  assert.equal(switchesVlans([1, 10, 20, 99]), true);
  assert.equal(switchesVlans([30]), true);
  assert.equal(switchesVlans([1, 1, 1]), false);
});

test('commuta: `[1]` e’ il mondo di chi NON fa VLAN — e cosi’ il vuoto e l’assenza', () => {
  // `[1]` = l'apparato ha nominato solo la VLAN di default. Non e' una scelta
  // fra VLAN: e' l'assenza di VLAN. Vuoto/assente = non ha nominato niente.
  assert.equal(switchesVlans([1]), false);
  assert.equal(switchesVlans([]), false);
  assert.equal(switchesVlans(null), false);
  assert.equal(switchesVlans(undefined), false);
  assert.equal(switchesVlans('1,10'), false, 'una stringa non e’ un mondo VLAN');
});

test('commuta: spazzatura e valori fuori range non contano come VLAN', () => {
  assert.equal(switchesVlans([0, 4095, 'x', null]), false);
  assert.equal(switchesVlans([1, 4094]), true, '4094 e’ l’ultima valida');
});

test('titolo: un capo PASSIVO non parla, qualunque cosa abbia sulla porta', () => {
  assert.equal(authoritativeVlan({ active: false, vlan: 30, deviceVlans: [1, 30] }), null);
});

test('titolo: l’override MANUALE parla sempre — manual-first, prima di ogni misura', () => {
  assert.equal(authoritativeVlan({ active: true, vlanOvr: 77, vlan: 1, deviceVlans: [1] }), 77);
});

test('titolo: una VLAN > 1 e’ sempre autorevole — nessuno la dichiara per sbaglio', () => {
  assert.equal(authoritativeVlan({ active: true, vlan: 30, deviceVlans: [] }), 30);
});

test('titolo: «1» vale SOLO se l’apparato conosce altre VLAN (allora la sta scegliendo)', () => {
  assert.equal(authoritativeVlan({ active: true, vlan: 1, deviceVlans: [1, 30, 99] }), 1);
  assert.equal(authoritativeVlan({ active: true, vlan: 1, deviceVlans: [1] }), null);
  assert.equal(authoritativeVlan({ active: true, vlan: 1, deviceVlans: [] }), null);
});

// ---- ② Il modello del colore ----------------------------------------------

test('il caso del banco: il controller dice «1» ma la rete dichiarata dice 99', () => {
  // WLC: attivo, mondo VLAN [1], un solo cavo, IP dentro il prefisso VLAN 99.
  // Di fronte lo switch tace. Prima usciva 1 «misurata»: la sua auto-dichiarazione
  // scavalcava la rete. Ora non ha titolo, e vince la rete DICHIARATA.
  const r = linkPaintVlan({
    mode: 'access', vlans: [1],
    src: { active: true, vlan: 1, deviceVlans: [1], singleHomed: true, endpointVlan: 99 },
    dst: { active: true, deviceVlans: [1, 30, 99] },
  });
  assert.equal(r.vlan, 99);
  assert.equal(r.source, 'declared-ip');
});

test('uno switch che conosce altre VLAN e dice «1» resta autorevole', () => {
  // Lo Zyxel del banco: mondo [1] no — qui [1,10,99]. Quel «1» e' una scelta fra
  // VLAN che conosce, quindi vince anche su una rete dichiarata diversa.
  const r = linkPaintVlan({
    mode: 'access', vlans: [1],
    src: { active: true, vlan: 1, deviceVlans: [1, 10, 99] },
    dst: { active: true, singleHomed: true, endpointVlan: 99 },
  });
  assert.equal(r.vlan, 1);
  assert.equal(r.source, 'measured');
});

test('senza titolo e senza altre fonti resta «1», ma dichiarato per quello che e’', () => {
  // Le due porte dell'EXOS del banco: e' multi-cablato, quindi il suo IP non
  // parla di QUESTO cavo, e nessun'altra fonte apre bocca. Il «1» torna — su una
  // rete piatta e' davvero l'unica VLAN che esiste — ma non come misura: la
  // provenienza dice «porta senza tag», che e' un'altra affermazione.
  const r = linkPaintVlan({
    mode: 'access', vlans: [1],
    src: { active: true, vlan: 1, deviceVlans: [1] },
    dst: { active: true, deviceVlans: [1, 10, 20, 30, 99] },
  });
  assert.equal(r.vlan, 1);
  assert.equal(r.source, 'untagged', 'non «measured»: nessuno ha misurato la VLAN di questo cavo');
});

test('senza titolo e senza NIENTE: si cade sul pavimento, non su una misura', () => {
  // Nessun capo dice «1». Il cavo commuta, quindi una VLAN ce l'ha per forza:
  // è la nativa. Ma la provenienza deve dirlo — un default non si spaccia mai
  // per una lettura, ed è quella la differenza che il difetto ① cancellava.
  const r = linkPaintVlan({
    mode: 'access', vlans: [],
    src: { active: true, deviceVlans: [1] },
    dst: { active: true, deviceVlans: [1] },
  });
  assert.equal(r.vlan, 1);
  assert.equal(r.source, 'site-native');
  assert.notEqual(r.source, 'measured');
});

test('una rete PIATTA continua a dire VLAN 1 (nessuno la trasforma in lacuna)', () => {
  // Il caso piu' comune di tutti: uno switch che conosce solo la VLAN 1, un PC
  // in fondo, nessuna rete dichiarata. Prima usciva 1; deve continuare a uscire
  // 1, o il difetto ① si sarebbe portato via la meta' sana del mondo.
  const r = linkPaintVlan({
    mode: 'access', vlans: [1],
    src: { active: true, vlan: 1, deviceVlans: [1] },
    dst: { active: false },
  });
  assert.equal(r.vlan, 1);
});

test('il titolo non scavalca il manuale: l’override sull’apparato muto vale', () => {
  const r = linkPaintVlan({
    mode: 'access', vlans: [1],
    src: { active: true, vlanOvr: 1, vlan: 1, deviceVlans: [1] },
    dst: { active: true, singleHomed: true, endpointVlan: 99 },
  });
  assert.equal(r.vlan, 1);
  assert.equal(r.source, 'ovr');
});

// ---- ③ La propagazione: lo stesso «1» non deve rientrare dalla finestra ----

test('la propagazione non semina il «1» di chi non commuta (percorso completo)', () => {
  // Se il seme resta, il «1» del controller attraversa il cavo come `vlanProp`
  // sulla porta dello switch e torna a vincere un gradino piu' in basso: la
  // stessa affermazione, laundered. Il difetto si chiude in un posto solo se
  // «chi ha titolo» ha UNA definizione — cf. definizioni-duplicate-motore-renderer.
  const APP = loadApp(ROOT);
  const out = run(APP.ctx, `(() => {
    state = _buildDefaultState();
    state.nodes = []; state.links = []; state.ports = {};
    state.ipam = { vlans:{}, prefixes:[{ cidr:'10.10.99.0/24', vlan:99 }], addresses:[] };
    state.nodes.push({ id:'sw1', type:'switch', name:'SW-ACC', ports:2, ip:'10.10.99.12' });
    state.nodes.push({ id:'wlc1', type:'wlanctrl', name:'WLC', ports:1, ip:'10.10.99.24' });
    state.nodes[0].integration = { vlans:[1,30,99] };
    state.nodes[1].integration = { vlans:[1] };
    state.links.push({ id:'l1', src:'sw1-2', dst:'wlc1-1' });
    state.ports['wlc1-1'] = { ifName:'Port 1', vlan:1 };   // il controller: untagged
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    propagateVlans();
    const p = _linkPaintVlan(state.links[0]);
    return { vlan: p.vlan, source: p.source, propSwitch: state.ports['sw1-2'].vlanProp ?? null };
  })()`);
  assert.equal(out.propSwitch, null, 'il «1» del controller non deve attraversare il cavo');
  assert.equal(out.vlan, 99);
  assert.equal(out.source, 'declared-ip');
});
