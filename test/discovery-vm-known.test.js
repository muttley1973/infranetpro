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

test('per nome, se il MAC non lo smentisce', () => {
  run(APP.ctx, STATE);
  const r = find({ hostname: 'esko-lic-22', ip: '192.168.1.77' });
  assert.deepEqual(r.vm, { host: 'lab', vm: 'v2' });
  assert.equal(r.matchedBy, 'vm-name');
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
  assert.deepEqual(r, { node: null, matchedBy: '', conflict: false, vm: null });
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
