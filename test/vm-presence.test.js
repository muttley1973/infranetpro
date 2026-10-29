'use strict';
// lib/vm-presence.js — «questa VM si vede in rete?»: le prove che reggono, il silenzio che non prova niente,
// e la regola che decide quando la rete può scrivere lo stato dichiarato.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/vm-presence.js');

const NOW = Date.parse('2026-10-29T10:00:00Z');
const HOUR = 3600e3;
const iso = ms => new Date(ms).toISOString();
const vmOf = (nics, extra) => Object.assign({ id: 'v1', name: 'vm', nics }, extra || {});
const mac = 'AA:BB:CC:00:00:01';
const macKey = 'aa:bb:cc:00:00:01';   // la forma canonica del progetto (lib/mac-class: minuscolo, con i due punti)

test('methodOfVia: ciò che scrive la sweep, in una definizione sola', () => {
  assert.equal(P.methodOfVia('ping'), 'ping');
  assert.equal(P.methodOfVia('icmp'), 'ping');
  assert.equal(P.methodOfVia('arp'), 'arp');
  assert.equal(P.methodOfVia('tcp:445'), 'tcp', 'la sweep scrive tcp:<porta>');
  assert.equal(P.methodOfVia('tcp'), 'tcp');
  assert.equal(P.methodOfVia('snmp'), 'snmp');
  for (const x of ['', null, undefined, 'carrier-pigeon']) assert.equal(P.methodOfVia(x), null);
});

test('vmTargets: solo IPv4 veri e MAC nella forma canonica del progetto', () => {
  const t = P.vmTargets(vmOf([
    { id: 'n1', ip: '10.0.0.5/24', mac: 'aabb.cc00.0001' },     // forma Cisco, prefisso in coda
    { id: 'n2', ip: '10.0.0.5', mac },                           // stessa macchina: nessun doppione
    { id: 'n3', ip: '999.1.1.1', ip6: 'fd00::5' },               // non è IPv4; l'IPv6 non entra
  ]));
  assert.deepEqual(t.ips, ['10.0.0.5']);
  assert.deepEqual(t.macs, [macKey]);
  assert.deepEqual(P.vmTargets(vmOf([])), { ips: [], macs: [] });
  assert.deepEqual(P.vmTargets(null), { ips: [], macs: [] });
});

test('vmSweepIps: gli IPv4 di tutte le VM di tutti gli host, una volta sola', () => {
  const nodes = [
    { id: 'h1', vms: [vmOf([{ id: 'n1', ip: '10.0.0.5' }]), vmOf([{ id: 'n1', ip: '10.0.0.6/24' }, { id: 'n2', ip: '10.0.0.5' }])] },
    { id: 'h2' },                                   // un nodo senza VM
    { id: 'h3', vms: [vmOf([{ id: 'n1', mac }])] }, // una VM senza IP non aggiunge niente
  ];
  assert.deepEqual(P.vmSweepIps(nodes).sort(), ['10.0.0.5', '10.0.0.6']);
  assert.deepEqual(P.vmSweepIps(null), []);
});

test('presenceSignals: chi risponde è viva, e il metodo è quello della sweep', () => {
  const vm = vmOf([{ id: 'n1', ip: '10.0.0.5' }]);
  const s = P.presenceSignals(vm, { reach: { '10.0.0.5': { alive: true, via: 'tcp:445' } } });
  assert.deepEqual(s, { reachable: true, attempted: true, absentEvidence: false, method: 'tcp' });
});

test('presenceSignals: un MAC nell\'ARP vivo della sweep basta, anche se l\'IP dichiarato non risponde', () => {
  const vm = vmOf([{ id: 'n1', ip: '10.0.0.5', mac }]);
  // IP cambiato dal DHCP: il vecchio indirizzo è provato assente, ma il MAC è al nuovo
  const s = P.presenceSignals(vm, { reach: { '10.0.0.5': { alive: false, absent: true } }, liveMacs: new Set([macKey]) });
  assert.equal(s.reachable, true);
  assert.equal(s.absentEvidence, false);
  assert.equal(s.method, 'arp');
});

test('presenceSignals: le tabelle di vicinato sono un RICORDO — valgono, ma non contro una prova fresca', () => {
  const vm = vmOf([{ id: 'n1', ip: '10.0.0.5', mac }]);
  const neighborMacs = new Set([macKey]);
  assert.equal(P.presenceSignals(vm, { reach: { '10.0.0.5': { alive: false } }, neighborMacs }).reachable, true,
    'silenzio sull\'IP e MAC nel router: la macchina si vede');
  const proved = P.presenceSignals(vm, { reach: { '10.0.0.5': { alive: false, absent: true } }, neighborMacs });
  assert.equal(proved.reachable, false, 'la sweep ha provato l\'IP assente: la MAC-table non la rianima');
  assert.equal(proved.absentEvidence, true);
  // senza sweep (Sync), il ricordo resta l\'unica voce e vale
  assert.equal(P.presenceSignals(vm, { neighborMacs }).reachable, true);
});

test('presenceSignals: l\'assenza vale solo se TUTTI gli indirizzi sono provati assenti', () => {
  const vm = vmOf([{ id: 'n1', ip: '10.0.0.5' }, { id: 'n2', ip: '10.0.0.6' }]);
  const solo1 = P.presenceSignals(vm, { reach: { '10.0.0.5': { alive: false, absent: true }, '10.0.0.6': { alive: false } } });
  assert.equal(solo1.absentEvidence, false, 'l\'altra scheda tace soltanto: non si sa');
  assert.equal(solo1.attempted, true);
  assert.equal(solo1.reachable, false);
  const entrambi = P.presenceSignals(vm, { reach: { '10.0.0.5': { alive: false, absent: true }, '10.0.0.6': { alive: false, absent: true } } });
  assert.equal(entrambi.absentEvidence, true);
  // una scheda che risponde vince su un\'altra assente
  const una = P.presenceSignals(vm, { reach: { '10.0.0.5': { alive: false, absent: true }, '10.0.0.6': { alive: true, via: 'ping' } } });
  assert.equal(una.reachable, true);
});

test('presenceSignals: senza niente da cercare, o senza niente che sia stato guardato, non si dice nulla', () => {
  assert.equal(P.presenceSignals(vmOf([]), { reach: {} }).attempted, false, 'nessun indirizzo');
  const vm = vmOf([{ id: 'n1', ip: '10.0.0.5' }]);
  assert.equal(P.presenceSignals(vm, { reach: { '10.9.9.9': { alive: true, via: 'ping' } } }).attempted, false, 'la sweep non ha guardato questo IP');
  assert.equal(P.presenceSignals(vm, { reach: null }).attempted, false, 'sweep fallita');
  const soloMac = vmOf([{ id: 'n1', mac }]);
  assert.equal(P.presenceSignals(soloMac, { neighborMacs: new Set() }).attempted, false, 'tabelle vuote: nessuna osservabilità');
  const visto = P.presenceSignals(soloMac, { neighborMacs: new Set(['11:22:33:44:55:66']) });
  assert.equal(visto.attempted, true, 'tabelle piene, la VM non c\'è: guardata e non trovata');
  assert.equal(visto.absentEvidence, false, 'e questo NON è un\'assenza');
});

test('evaluateVmPresence: la vocabolario di prova dei nodi — proven, unverified, absent', () => {
  const vm = vmOf([{ id: 'n1', ip: '10.0.0.5' }]);
  const up = P.evaluateVmPresence(vm, { reach: { '10.0.0.5': { alive: true, via: 'ping' } } }, NOW);
  assert.equal(up.fresh, true);
  assert.equal(up.proof.status, 'proven');
  assert.equal(up.proof.lastProvenAt, iso(NOW));
  assert.equal(up.proof.method, 'ping');

  // dopo, tace: «non verificata», e la memoria di quando fu vista resta
  vm.proof = up.proof;
  const quiet = P.evaluateVmPresence(vm, { reach: { '10.0.0.5': { alive: false } } }, NOW + HOUR);
  assert.equal(quiet.proof.status, 'unverified');
  assert.equal(quiet.proof.lastProvenAt, iso(NOW));
  assert.equal(quiet.fresh, true);

  const gone = P.evaluateVmPresence(vm, { reach: { '10.0.0.5': { alive: false, absent: true } } }, NOW + 2 * HOUR);
  assert.equal(gone.proof.status, 'absent');
  assert.equal(gone.proof.absentEvidence, true);
  assert.equal(gone.proof.lastProvenAt, iso(NOW), 'quando la vidi viva non si cancella');

  const unseen = P.evaluateVmPresence(vm, { reach: null }, NOW + 3 * HOUR);
  assert.equal(unseen.fresh, false, 'non guardata in questo giro: la prova di prima che invecchia, non un\'osservazione');
});

test('observedPowerState: solo le due prove che reggono', () => {
  assert.equal(P.observedPowerState({ status: 'proven' }), 'running');
  assert.equal(P.observedPowerState({ status: 'absent', absentEvidence: true }), 'stopped');
  for (const p of [{ status: 'unverified' }, { status: 'stale' }, { status: 'declared' }, { status: 'absent', absentEvidence: false }, null, undefined]) {
    assert.equal(P.observedPowerState(p), null, JSON.stringify(p));
  }
});

test('vmStateConflict: dichiarata una cosa, la rete ne dice un\'altra — con una prova fresca', () => {
  const seen = { status: 'proven', lastProvenAt: iso(NOW - HOUR), lastCheckedAt: iso(NOW - HOUR) };
  assert.equal(P.vmStateConflict({ state: 'stopped', proof: seen }, NOW), 'aliveButStopped');
  assert.equal(P.vmStateConflict({ state: 'running', proof: seen }, NOW), null, 'd\'accordo');
  assert.equal(P.vmStateConflict({ proof: seen }, NOW), null, 'non dichiarata: niente da smentire');

  const gone = { status: 'absent', absentEvidence: true, lastProvenAt: null, lastCheckedAt: iso(NOW - HOUR) };
  assert.equal(P.vmStateConflict({ state: 'running', proof: gone }, NOW), 'goneButRunning',
    'mai vista viva (lastProvenAt vuoto) non vuol dire prova vecchia: conta il controllo');
  assert.equal(P.vmStateConflict({ state: 'stopped', proof: gone }, NOW), null);

  const old = { status: 'proven', lastProvenAt: iso(NOW - 3 * 24 * HOUR), lastCheckedAt: iso(NOW - 3 * 24 * HOUR) };
  assert.equal(P.vmStateConflict({ state: 'stopped', proof: old }, NOW), null, 'una VM vista tre giorni fa non smentisce niente');
  assert.equal(P.vmStateConflict({ state: 'stopped', proof: { status: 'unverified', lastProvenAt: iso(NOW) } }, NOW), null, 'il silenzio non smentisce');
  assert.equal(P.vmStateConflict({ state: 'stopped' }, NOW), null);
});

test('followedState: il dichiarato è legge — si scrive solo su un campo vuoto o scritto dalla rete', () => {
  assert.equal(P.followedState({}, 'running'), 'running');
  assert.equal(P.followedState({ state: 'stopped', stateAuto: true }, 'running'), 'running', 'l\'aveva scritto la rete: la rete lo aggiorna');
  assert.equal(P.followedState({ state: 'stopped' }, 'running'), null, 'l\'ha messo una persona');
  assert.equal(P.followedState({ state: 'running', stateAuto: true }, 'running'), null, 'già così');
  assert.equal(P.followedState({}, null), null, 'nessuna osservazione');
  assert.equal(P.followedState(null, 'running'), null);
});

// ── Un giro intero ─────────────────────────────────────────────────────────
function progetto() {
  const alive = vmOf([{ id: 'n1', ip: '10.0.0.5' }], { id: 'alive' });
  const handStopped = vmOf([{ id: 'n1', ip: '10.0.0.6' }], { id: 'hand', state: 'stopped' });
  const gone = vmOf([{ id: 'n1', ip: '10.0.0.7' }], { id: 'gone', state: 'running', stateAuto: true });
  const handRunning = vmOf([{ id: 'n1', ip: '10.0.0.8' }], { id: 'handrun', state: 'running' });
  const silent = vmOf([{ id: 'n1', ip: '10.0.0.9' }], { id: 'silent', state: 'running', stateAuto: true });
  const notLooked = vmOf([{ id: 'n1', ip: '10.9.9.9' }], { id: 'nolook' });
  const noAddr = vmOf([], { id: 'noaddr' });
  return { nodes: [{ id: 'h', vms: [alive, handStopped, gone, handRunning, silent, notLooked, noAddr] }, { id: 'sw' }],
    vm: { alive, handStopped, gone, handRunning, silent, notLooked, noAddr } };
}
const reach = {
  '10.0.0.5': { alive: true, via: 'ping' },
  '10.0.0.6': { alive: true, via: 'arp' },
  '10.0.0.7': { alive: false, absent: true },
  '10.0.0.8': { alive: false, absent: true },
  '10.0.0.9': { alive: false },
};

test('applyPresence senza «segui»: scrive la prova e non tocca MAI lo stato dichiarato', () => {
  const { nodes, vm } = progetto();
  let announced = 0;
  const r = P.applyPresence(nodes, { reach }, { now: NOW, follow: false, beforeStateWrite: () => announced++ });
  assert.equal(announced, 0);
  assert.equal(vm.alive.state, undefined);
  assert.equal(vm.handStopped.state, 'stopped');
  assert.equal(vm.gone.state, 'running');
  assert.equal(vm.alive.proof.status, 'proven');
  assert.equal(vm.handStopped.proof.status, 'proven');
  assert.equal(vm.gone.proof.status, 'absent');
  assert.equal(vm.silent.proof.status, 'unverified');
  assert.equal(vm.noAddr.proof, undefined, 'senza indirizzi e mai guardata: nessun oggetto prova');
  assert.equal(vm.notLooked.proof, undefined, 'fuori dalla sweep: idem');
  assert.equal(r.changes.length, 0);
  assert.equal(r.checked, 5, 'cinque guardate: la VM fuori dalla sweep e quella senza indirizzi no');
  assert.equal(r.seen, 2);
});

test('applyPresence con «segui»: scrive dove è lecito, una foto prima sola, e lascia stare ciò che è di una persona', () => {
  const { nodes, vm } = progetto();
  let announced = 0;
  const r = P.applyPresence(nodes, { reach }, { now: NOW, follow: true, beforeStateWrite: () => announced++ });
  assert.equal(announced, 1, 'la «foto prima» dell\'annulla è una sola, per tutto il lotto');
  assert.equal(vm.alive.state, 'running');
  assert.equal(vm.alive.stateAuto, true, 'si ricorda che l\'ha scritto la rete');
  assert.equal(vm.gone.state, 'stopped', 'scritto dalla rete e ora provato assente: lo aggiorna');
  assert.equal(vm.handStopped.state, 'stopped', 'l\'ha messo una persona: resta, anche se la VM risponde');
  assert.equal(vm.handStopped.stateAuto, undefined);
  assert.equal(vm.handRunning.state, 'running', 'idem per «accesa» a mano su una VM provata assente');
  assert.equal(vm.silent.state, 'running', 'il silenzio non spegne nessuno');
  assert.equal(vm.notLooked.state, undefined);
  assert.deepEqual(r.changes.map(c => [c.vm.id, c.from, c.to]).sort(), [['alive', '', 'running'], ['gone', 'running', 'stopped']]);
  // i due che la rete contraddice restano visibili come discrepanza
  assert.equal(P.vmStateConflict(vm.handStopped, NOW), 'aliveButStopped');
  assert.equal(P.vmStateConflict(vm.handRunning, NOW), 'goneButRunning');
});

test('applyPresence: un secondo giro uguale non scrive niente di nuovo', () => {
  const { nodes } = progetto();
  P.applyPresence(nodes, { reach }, { now: NOW, follow: true });
  let announced = 0;
  const r = P.applyPresence(nodes, { reach }, { now: NOW + HOUR, follow: true, beforeStateWrite: () => announced++ });
  assert.equal(r.changes.length, 0);
  assert.equal(announced, 0, 'nessuna scrittura, nessun punto di annulla');
});

test('applyPresence: una VM non guardata in questo giro resta com\'è, e la sua prova non diventa un\'osservazione', () => {
  const vm = vmOf([{ id: 'n1', ip: '10.0.0.5' }], { state: 'stopped', stateAuto: true,
    proof: { status: 'proven', lastProvenAt: iso(NOW - 2 * HOUR), lastCheckedAt: iso(NOW - 2 * HOUR), method: 'ping', absentEvidence: false } });
  const r = P.applyPresence([{ id: 'h', vms: [vm] }], { reach: null }, { now: NOW, follow: true });
  assert.equal(r.checked, 0);
  assert.equal(r.changes.length, 0);
  assert.equal(vm.state, 'stopped', 'una prova di due ore fa non riscrive lo stato in un giro che non ha guardato');
});

test('applyPresence tollera dati sporchi senza lanciare', () => {
  assert.doesNotThrow(() => P.applyPresence(null, {}, {}));
  assert.doesNotThrow(() => P.applyPresence([null, { vms: [null, 3, 'x', {}] }, { vms: 'no' }], undefined, undefined));
});

test('applyPresence: la «foto prima» precede OGNI modifica, anche la prova della prima VM in elenco', () => {
  const { nodes, vm } = progetto();
  let visto = null;
  P.applyPresence(nodes, { reach }, {
    now: NOW, follow: true,
    beforeStateWrite: () => { visto = { proofs: Object.values(vm).filter(v => v.proof).length, alive: vm.alive.state }; },
  });
  assert.deepEqual(visto, { proofs: 0, alive: undefined }, 'al momento della foto non è stato scritto niente');
});

test('presenceView: racconta solo quanto si sa — «si vede adesso» vale per un\'osservazione fresca, poi è «ultima volta»', () => {
  const at = iso(NOW - HOUR);
  const old = iso(NOW - 2 * 24 * HOUR);
  assert.deepEqual(P.presenceView({ status: 'proven', lastProvenAt: at, method: 'tcp' }, NOW), { kind: 'seen', at, last: null, via: 'tcp' });
  assert.deepEqual(P.presenceView({ status: 'proven', lastProvenAt: old, method: 'tcp' }, NOW), { kind: 'last', at: old, last: null, via: null },
    'vista due giorni fa e mai riguardata: non si dice che si vede adesso');
  assert.deepEqual(P.presenceView({ status: 'unverified', lastCheckedAt: at, lastProvenAt: old }, NOW), { kind: 'silent', at, last: old, via: null });
  assert.equal(P.presenceView({ status: 'unverified', lastCheckedAt: at, lastProvenAt: null }, NOW).last, null, 'mai vista viva: niente «ultima volta»');
  assert.deepEqual(P.presenceView({ status: 'absent', absentEvidence: true, lastCheckedAt: at, lastProvenAt: old }, NOW), { kind: 'gone', at, last: old, via: null });
  assert.equal(P.presenceView({ status: 'absent', absentEvidence: false, lastCheckedAt: at }, NOW), null, 'un\'assenza senza prova non si racconta');
  assert.deepEqual(P.presenceView({ status: 'stale', lastProvenAt: old }, NOW), { kind: 'last', at: old, last: null, via: null });
  assert.equal(P.presenceView({ status: 'unverified', lastCheckedAt: old, lastProvenAt: null }, NOW), null, 'tace da giorni e non è mai stata vista: niente da dire');
  for (const x of [null, undefined, {}, { status: 'declared' }, 'x']) assert.equal(P.presenceView(x, NOW), null);
});

test('export portatile: la prova della rete e il segno «scritto dalla Verifica» non viaggiano; lo stato sì', () => {
  const { sanitizePortableState } = require('../lib/project-format.js');
  const out = sanitizePortableState({
    nodes: [{ id: 'h', type: 'server', vms: [{
      id: 'v1', name: 'vm', state: 'running', stateAuto: true,
      proof: { status: 'proven', lastProvenAt: '2026-10-29T09:00:00.000Z', method: 'ping' },
      nics: [{ id: 'nic1', ip: '10.0.0.5' }],
    }] }],
  });
  const vm = out.nodes[0].vms[0];
  assert.equal(vm.proof, undefined, 'cosa vedeva QUELLA rete non è del file');
  assert.equal(vm.stateAuto, undefined);
  assert.equal(vm.state, 'running', 'lo stato è una dichiarazione del progetto e resta');
  assert.equal(vm.nics[0].ip, '10.0.0.5');
});

test('una definizione sola di «via → metodo»: la Verifica non ne riscrive una', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app-drift.js'), 'utf8');
  const copia = /===\s*'icmp'/;
  assert.match(src, /import \{[^}]*\bmethodOfVia\b[^}]*\} from '\.\.\/lib\/vm-presence\.js'/, 'app-drift importa methodOfVia');
  assert.ok(!copia.test(src), 'app-drift non riscrive la mappa via → metodo (era `tcp:445` → «ping» per un host visto su TCP)');
  // controprova: il riconoscitore vede la forma del difetto com'era
  assert.ok(copia.test("const _method = via => { const v = String(via || '').toLowerCase(); return v === 'icmp' ? 'ping' : null; };"));
});
