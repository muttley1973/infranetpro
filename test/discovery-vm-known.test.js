'use strict';
// ============================================================
// SCOPRI CONOSCE LE VM — un apparato già documentato come VM non è «Nuovo»
// ============================================================
// Il caso vero (progetto 24): UNL e ESKO-LIC-22 erano VM di un host, Scopri le riproponeva come
// «Nuovo», l'import creava un tile (`pc14`) e l'IPAM accusava lo stesso IP su due apparati. L'indice
// «esiste già?» (_discBuildExistingIndexes) leggeva nodi e porte ma non `node.vms[]`, mentre la Verifica
// (lib/drift-snapshot.js) i MAC delle VM li contava: due definizioni di «apparato noto».
// Qui si prova la RISPOSTA di _discFindExistingDevice; il giro intero (tabella e import) sta nell'e2e.
// Testato via la DOM-stub harness (bare global esposti da expose()).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (discovery-vm-known)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

const STATE = `window.state = {
  ports: {},
  nodes: [
    { id:'lab', type:'homelab', name:'MacPro5,1', ip:'192.168.1.150', mac:'E8:06:88:CB:DC:AA', x:10, y:10,
      vms: [
        { id:'v1', name:'UNL', nics:[{ id:'nic1', ip:'192.168.1.234', mac:'50:23:5F:00:2B:00' }] },
        { id:'v2', name:'ESKO-LIC-22', nics:[{ id:'nic1', ip:'192.168.1.192', mac:'02:11:32:2D:28:2B' }] },
      ] },
    { id:'pc1', type:'pc', name:'PC-uff', ip:'192.168.1.50', mac:'DE:AD:BE:EF:00:50', x:50, y:50 },
  ],
};
window._discResults = [];
if (typeof _discInvalidateExistingIndexes === 'function') _discInvalidateExistingIndexes();`;

const find = (row) => JSON.parse(run(APP.ctx, `(() => {
  const r = _discFindExistingDevice(${JSON.stringify(row)}, _discBuildExistingIndexes());
  return JSON.stringify({
    node: r.node ? r.node.id : null,
    matchedBy: r.matchedBy || '',
    conflict: !!r.conflict,
    vm: r.vm ? { host: r.vm.host.id, vm: r.vm.vm.id } : null,
    weak: r.vm ? !!r.vm.weak : null,
  });
})()`));

test('per MAC: la VM esiste già, e si dice di quale host', () => {
  run(APP.ctx, STATE);
  const r = find({ ip: '192.168.1.234', mac: '50:23:5f:00:2b:00', hostname: 'UNL' });
  assert.equal(r.node, null, 'non è un nodo: niente tile da aggiornare');
  assert.deepEqual(r.vm, { host: 'lab', vm: 'v1' });
  assert.equal(r.matchedBy, 'vm-mac');
});

test('per IP, quando il MAC non si vede (cross-subnet: l\'ARP si ferma al router)', () => {
  run(APP.ctx, STATE);
  const r = find({ ip: '192.168.1.192' });
  assert.deepEqual(r.vm, { host: 'lab', vm: 'v2' });
  assert.equal(r.matchedBy, 'vm-ip');
});

test('per nome, se niente lo smentisce: il match c\'è, ed è «debole» (solo per nome)', () => {
  run(APP.ctx, STATE);
  // La riga porta solo il nome (un nome mDNS, una riga senza indirizzo): né il MAC né un indirizzo lo smentiscono.
  const r = find({ hostname: 'esko-lic-22' });
  assert.deepEqual(r.vm, { host: 'lab', vm: 'v2' });
  assert.equal(r.matchedBy, 'vm-name');
  assert.equal(r.weak, true, 'nessun MAC o indirizzo lo conferma: chi lo mostra lo dice');
  // Con l'indirizzo della VM, il nome e' confermato: non e' piu' «solo per nome».
  const c = find({ hostname: 'esko-lic-22', ip: '192.168.1.192' });
  assert.equal(c.weak, false);
});

test('stesso NOME ma un altro INDIRIZZO: è un\'altra macchina, resta «Nuovo» (un server fisico omonimo non sparisce)', () => {
  run(APP.ctx, STATE);
  // La VM ha 192.168.1.192; la riga e' a .77 con lo stesso nome. Prima il nome bastava (la VM non aveva il MAC da
  // smentire) e la macchina fisica veniva scartata come «gia' documentata»: errore silenzioso. Ora l'indirizzo la smentisce.
  const r = find({ hostname: 'esko-lic-22', ip: '192.168.1.77' });
  assert.equal(r.vm, null);
  assert.equal(r.node, null);
  assert.equal(r.matchedBy, '');
});

test('stesso IP ma MAC DIVERSO da quello della VM: è un\'altra macchina, resta «Nuovo»', () => {
  run(APP.ctx, STATE);
  const r = find({ ip: '192.168.1.234', mac: '11:22:33:44:55:66' });
  assert.equal(r.vm, null, 'non si fonde un apparato su una VM che ha un altro MAC');
  assert.equal(r.node, null);
});

test('un apparato che non è nel documento resta «Nuovo»', () => {
  run(APP.ctx, STATE);
  const r = find({ ip: '192.168.1.99', mac: '00:00:5E:00:53:01', hostname: 'altro' });
  assert.deepEqual(r, { node: null, matchedBy: '', conflict: false, vm: null, weak: null });
});

test('un nodo con lo stesso MAC vince sulla VM: l\'aggiornamento del tile non cambia', () => {
  run(APP.ctx, STATE.replace("{ id:'pc1', type:'pc'", "{ id:'pc14', type:'pc', name:'UNL', ip:'192.168.1.234', mac:'50:23:5F:00:2B:00', x:5, y:5 },\n    { id:'pc1', type:'pc'"));
  const r = find({ ip: '192.168.1.234', mac: '50:23:5f:00:2b:00', hostname: 'UNL' });
  assert.equal(r.node, 'pc14', 'il tile già presente resta il riferimento');
  assert.equal(r.vm, null, 'e non si segnala anche la VM: la risposta è una sola');
  assert.equal(r.matchedBy, 'mac');
});

test('il MAC di un host non è quello di una sua VM: l\'host resta un nodo', () => {
  run(APP.ctx, STATE);
  const r = find({ ip: '192.168.1.150', mac: 'E8:06:88:CB:DC:AA', hostname: 'MacPro5,1' });
  assert.equal(r.node, 'lab');
  assert.equal(r.vm, null);
});

test('un MAC di next-hop (gateway) non identifica la VM: si ripiega sull\'IP', () => {
  run(APP.ctx, STATE);
  const r = JSON.parse(run(APP.ctx, `(() => {
    const idx = _discBuildExistingIndexes();
    idx.gatewayMacs = new Set(['02:11:32:2D:28:2B']);   // il MAC della VM, ma visto come next-hop
    idx.sharedMacs = null;
    const m = _discFindExistingDevice({ ip:'192.168.1.77', mac:'02:11:32:2d:28:2b' }, idx);
    const m2 = _discFindExistingDevice({ ip:'192.168.1.192', mac:'02:11:32:2d:28:2b' }, idx);
    return JSON.stringify({ byMacBlocked: m.vm ? m.vm.vm.id : null, byIp: m2.vm ? m2.vm.vm.id : null, by: m2.matchedBy });
  })()`));
  assert.equal(r.byMacBlocked, null, 'MAC bloccato: nessun match per MAC');
  assert.equal(r.byIp, 'v2', 'ma l\'IP della VM ripiega, senza essere smentito dal MAC bloccato');
  assert.equal(r.by, 'vm-ip');
});

test('un indice costruito a mano, senza il capitolo VM, non rompe niente (le guardie degli altri test)', () => {
  run(APP.ctx, STATE);
  const r = JSON.parse(run(APP.ctx, `(() => {
    const idx = { byMac:new Map(), byIp:new Map(), byHost:new Map() };
    const m = _discFindExistingDevice({ ip:'192.168.1.234', mac:'50:23:5f:00:2b:00' }, idx);
    return JSON.stringify({ node: m.node ? m.node.id : null, vm: m.vm ? 1 : null });
  })()`));
  assert.deepEqual(r, { node: null, vm: null });
});

test('una VM aggiunta DOPO la costruzione dell\'indice si vede alla ricostruzione (nessuna cache vecchia)', () => {
  run(APP.ctx, STATE);
  assert.equal(find({ ip: '10.5.5.5', mac: '00:AA:00:AA:00:AA' }).vm, null);
  run(APP.ctx, `window.state.nodes[0].vms.push({ id:'v9', name:'nuova', nics:[{ id:'nic1', ip:'10.5.5.5', mac:'00:AA:00:AA:00:AA' }] });
                _discInvalidateExistingIndexes();`);
  assert.deepEqual(find({ ip: '10.5.5.5', mac: '00:AA:00:AA:00:AA' }).vm, { host: 'lab', vm: 'v9' });
});

test('l\'indirizzo si confronta per CHIAVE (come il resto del progetto), non per stringa: IPv6 in un\'altra scrittura, IPv4 con zeri iniziali', () => {
  run(APP.ctx, STATE);
  run(APP.ctx, `window.state.nodes[0].vms.push({ id:'v6', name:'solo-v6', nics:[{ id:'nic1', ip6:'2001:DB8:0:20:0:0:0:1' }] });
                _discInvalidateExistingIndexes();`);
  const v6 = find({ ip: '2001:db8:0:20::1' });
  assert.deepEqual(v6.vm, { host: 'lab', vm: 'v6' }, 'lo stesso IPv6 scritto in forma abbreviata');
  assert.equal(v6.matchedBy, 'vm-ip');
  const v4 = find({ ip: '192.168.001.234' });
  assert.deepEqual(v4.vm, { host: 'lab', vm: 'v1' }, 'lo stesso IPv4 con gli zeri iniziali');
  assert.equal(find({ ip: '2001:db8:0:20::2' }).vm, null, 'un altro IPv6 non combacia');
});

// ── B4: il MAC di una VM non vince su tutto ──────────────────────────────────────────────────────────────────────
test('B4(a): un nodo con quell\'IP e un ALTRO MAC è un conflitto vero, e non si perde perché il MAC combacia con una VM', () => {
  run(APP.ctx, STATE);
  // La riga ha il MAC di UNL (VM) ma l'IP di PC-uff (nodo con un altro MAC): prima vinceva la VM e il conflitto spariva.
  const r = find({ ip: '192.168.1.50', mac: '50:23:5f:00:2b:00' });
  assert.equal(r.conflict, true, 'IP di un nodo con un MAC diverso = apparato sostituito / IP riusato');
  assert.equal(r.matchedBy, 'conflict');
  assert.equal(r.vm, null);
  // Senza il conflitto (l'IP è quello della VM) la risposta resta la VM.
  assert.deepEqual(find({ ip: '192.168.1.234', mac: '50:23:5f:00:2b:00' }).vm, { host: 'lab', vm: 'v1' });
});

const GUARDED = (row, withGateway) => JSON.parse(run(APP.ctx, `(() => {
  ${withGateway ? "window.state.ipam = { vlans:{}, prefixes:[{ cidr:'192.168.1.0/24', vlan:null, gateway:'192.168.1.234' }] };" : 'window.state.ipam = { vlans:{}, prefixes:[] };'}
  _discInvalidateExistingIndexes();
  const idx = _discBuildExistingIndexes();
  _discAttachMergeGuards(idx, []);
  const m = _discFindExistingDevice(${JSON.stringify(row)}, idx);
  return JSON.stringify({ gw: [...(idx.gatewayMacs || [])], node: m.node ? m.node.id : null, vm: m.vm ? m.vm.vm.id : null, by: m.matchedBy });
})()`));

test('B4(b): il MAC di un GATEWAY VIRTUALE (la VM che fa da gateway di un prefisso) non assorbe un altro host', () => {
  run(APP.ctx, STATE);
  // UNL (192.168.1.234) è dichiarata gateway del prefisso: il suo MAC compare nell'ARP di ogni host dietro di lei.
  const dietro = { ip: '192.168.5.20', mac: '50:23:5f:00:2b:00', hostname: 'host-dietro' };
  const senza = GUARDED(dietro, false);
  assert.equal(senza.vm, 'v1', 'senza il gateway dichiarato il MAC identifica la VM (il comportamento di sempre)');
  const con = GUARDED(dietro, true);
  assert.deepEqual(con.gw, ['50:23:5F:00:2B:00'], 'il MAC della VM gateway è un next-hop');
  assert.equal(con.vm, null, 'l\'host dietro il gateway NON è la VM');
  assert.equal(con.by, '', 'e resta «Nuovo»');
  // Il gateway stesso si riconosce ancora, dal suo indirizzo.
  assert.equal(GUARDED({ ip: '192.168.1.234', mac: '50:23:5f:00:2b:00' }, true).vm, 'v1');
});

// ── B1: la VM si cerca con la riga intera (anche dove si cercava per solo MAC) ───────────────────────────────────
test('_discFindVm: la stessa funzione per chi tratta i nodi a modo suo (l\'adozione): MAC, hostname e IP della riga', () => {
  run(APP.ctx, STATE.replace("{ id:'v2', name:'ESKO-LIC-22'", "{ id:'dc', name:'dc01', nics:[{ id:'nic1', ip:'10.0.0.5' }] },\n        { id:'v2', name:'ESKO-LIC-22'"));
  const vm = (row) => JSON.parse(run(APP.ctx, `(() => { _discInvalidateExistingIndexes(); const r = _discFindVm(${JSON.stringify(row)}); return JSON.stringify(r ? { host: r.host.id, vm: r.vm.id, by: r.by, weak: r.weak } : null); })()`));
  assert.deepEqual(vm({ mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5', hostname: 'dc01' }), { host: 'lab', vm: 'dc', by: 'name', weak: false }, 'una VM con solo nome e IP, senza MAC');
  assert.equal(vm({ mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.5' }).by, 'ip');
  assert.equal(vm({ mac: 'AA:BB:CC:DD:EE:77', ip: '10.0.0.77', hostname: 'dc01' }), null, 'stesso nome, un altro indirizzo: un\'altra macchina');
  assert.equal(vm({ mac: '50:23:5f:00:2b:00' }).vm, 'v1', 'per MAC, come sempre');
});

// ── B6: i minori ─────────────────────────────────────────────────────────────────────────────────────────────────
test('B6: il driver che il documento dichiara vale anche per una VM (il badge «muto a questa chiave» compare)', () => {
  run(APP.ctx, STATE);
  run(APP.ctx, `window.state.nodes[0].vms[0].integration = { driver:'snmp-v2c', host:'192.168.1.234' };
                window.state.nodes[1].integration = { driver:'snmp-v3' };
                _discInvalidateExistingIndexes();`);
  const drv = (row) => run(APP.ctx, `_discDocumentedDriver(${JSON.stringify(row)})`);
  assert.equal(drv({ ip: '192.168.1.234', mac: '50:23:5f:00:2b:00' }), 'snmp-v2c', 'una VM documentata come apparato SNMP');
  assert.equal(drv({ ip: '192.168.1.50', mac: 'DE:AD:BE:EF:00:50' }), 'snmp-v3', 'un nodo, come prima');
  assert.equal(drv({ ip: '192.168.1.192', mac: '02:11:32:2d:28:2b' }), '', 'una VM senza integrazione: nessun driver dichiarato');
  assert.equal(drv({ ip: '10.9.9.9' }), '', 'una riga sconosciuta');
});

test('B6: la cache dell\'indice non resta vecchia quando una VM sparisce (annulla, rimozione) o lo stato è sostituito', () => {
  run(APP.ctx, STATE);
  // l'indice di default è memoizzato: lo si interroga SENZA ricostruirlo a mano (come fa la tabella di Scopri)
  const trova = () => run(APP.ctx, `(() => { const r = _discFindExistingDevice({ ip:'192.168.1.234', mac:'50:23:5f:00:2b:00' }); return r.vm ? r.vm.vm.id : ''; })()`);
  run(APP.ctx, '_discInvalidateExistingIndexes()');
  assert.equal(trova(), 'v1');
  run(APP.ctx, 'window.state.nodes[0].vms.shift();');               // la VM viene rimossa: nessuno invalida il memo
  assert.equal(trova(), '', 'la VM tolta non e\' piu\' «gia\' presente»');
  run(APP.ctx, STATE);                                              // lo stato e' sostituito INTERO (come fa un annulla)
  assert.equal(trova(), 'v1', 'e lo stato nuovo e\' quello che si legge');
});
