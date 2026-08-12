'use strict';
// ============================================================
// Formato 1 → 2 nell'app viva: la subnet esce dalla VLAN, ma a schermo non
// cambia niente.
// ============================================================
// Il modello puro ha i suoi test (test/ipam-model.test.js). Qui si verifica il
// GIUNTO: _migrateState al caricamento, e la scrittura dal pannello VLAN. È il
// punto dove un refactor del genere fa il danno vero — i dati si spostano e i
// lettori guardano ancora la casa vecchia, così la subnet sparisce dal pannello
// senza che nessun test puro se ne accorga.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
let APP;
test('load app (ipam-prefix)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

// Progetto in formato 2.8.x: la subnet è un campo della VLAN.
const LEGACY = `{
  schemaVersion: 1,
  nodes: [{ id:'sw1', type:'switch', name:'SW1', ip:'192.168.20.10' }],
  racks: [], links: [], ports: {},
  vlanColors: { 20:'#00d4ff' }, vlanNames: { 20:'Uffici' },
  ipam: { vlans: { 20: { subnet:'192.168.20.0/24', gateway:'192.168.20.1', dns:'1.1.1.1', gatewayNodeId:'sw1' } } }
}`;

test('_migrateState: la subnet diventa un prefisso e il riepilogo non cambia', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState(${LEGACY});
    return JSON.stringify({
      version: state.schemaVersion,
      prefixes: state.ipam.prefixes,
      leftOnVlan: state.ipam.vlans['20'],
      summary: _vlanIpamSummary(20),
      view: _vlanIpam(20),
      usageCidr: !!_ipamUsageForVlan(20).cidr,
    });
  })()`);
  const r = JSON.parse(out);

  assert.strictEqual(r.version, 2, 'lo schema sale a 2');
  assert.deepStrictEqual(r.prefixes, [
    { cidr: '192.168.20.0/24', vlan: 20, gateway: '192.168.20.1', dns: '1.1.1.1' },
  ]);
  // il binding SVI è per-VLAN: resta dov'era, non è un attributo del prefisso
  assert.deepStrictEqual(r.leftOnVlan, { gatewayNodeId: 'sw1' });
  // la VISTA ricompone quello che il pannello si aspetta di leggere
  assert.strictEqual(r.view.subnet, '192.168.20.0/24');
  assert.strictEqual(r.view.gateway, '192.168.20.1');
  assert.strictEqual(r.view.gatewayNodeId, 'sw1');
  // e a schermo la riga di riepilogo è quella di sempre
  assert.match(r.summary, /192\.168\.20\.0\/24/);
  assert.match(r.summary, /GW 192\.168\.20\.1/);
  assert.match(r.summary, /DNS 1\.1\.1\.1/);
  assert.strictEqual(r.usageCidr, true, 'l\'occupazione trova ancora il CIDR');
});

test('_migrateState: rieseguirlo su uno stato già migrato non duplica nulla', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState(${LEGACY});
    const first = JSON.stringify(state.ipam);
    state = _migrateState(state);
    return JSON.stringify({ same: JSON.stringify(state.ipam) === first, n: state.ipam.prefixes.length });
  })()`);
  const r = JSON.parse(out);
  assert.strictEqual(r.n, 1);
  assert.strictEqual(r.same, true);
});

test('updateVlanIpam: scrive nel prefisso, non nella VLAN', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[], racks:[], links:[], ports:{},
                            vlanColors:{ 30:'#39d353' }, vlanNames:{}, ipam:{ vlans:{}, prefixes:[] } });
    updateVlanIpam(30, 'gateway', '10.0.30.1');      // gateway PRIMA della subnet
    const orphan = JSON.stringify(state.ipam);
    updateVlanIpam(30, 'subnet', '10.0.30.0/24');    // arriva la subnet
    const afterSubnet = JSON.parse(JSON.stringify(state.ipam));
    updateVlanIpam(30, 'subnet', '10.0.31.0/24');    // rinomina il CIDR
    const renamed = JSON.parse(JSON.stringify(state.ipam));
    updateVlanIpam(30, 'subnet', '');                // svuota
    return JSON.stringify({ orphan, afterSubnet, renamed, cleared: state.ipam.prefixes });
  })()`);
  const r = JSON.parse(out);

  // senza subnet non c'è un prefisso a cui appartenere: il gateway resta sulla VLAN
  assert.deepStrictEqual(JSON.parse(r.orphan), { vlans: { 30: { gateway: '10.0.30.1' } }, prefixes: [] });
  // appena la subnet arriva, il gateway orfano ci entra dentro e la VLAN si svuota
  assert.deepStrictEqual(r.afterSubnet.prefixes,
    [{ cidr: '10.0.30.0/24', vlan: 30, source: 'manual', gateway: '10.0.30.1' }]);
  assert.strictEqual(r.afterSubnet.vlans['30'], undefined);
  // rinominare il CIDR non butta via il gateway
  assert.strictEqual(r.renamed.prefixes.length, 1);
  assert.strictEqual(r.renamed.prefixes[0].cidr, '10.0.31.0/24');
  assert.strictEqual(r.renamed.prefixes[0].gateway, '10.0.30.1');
  // svuotare la subnet toglie il prefisso
  assert.deepStrictEqual(r.cleared, []);
});

test('cancellare una VLAN porta via la sua subnet, ma non le reti senza VLAN', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[], racks:[], links:[], ports:{},
      vlanColors:{ 20:'#00d4ff' }, vlanNames:{},
      ipam:{ vlans:{}, prefixes:[
        { cidr:'192.168.20.0/24', vlan:20 },
        { cidr:'10.0.0.0/30', vlan:null, name:'punto-punto R1-R2' },
      ] } });
    deleteVlanColor(20);
    return JSON.stringify(state.ipam.prefixes);
  })()`);
  assert.deepStrictEqual(JSON.parse(out), [{ cidr: '10.0.0.0/30', vlan: null, name: 'punto-punto R1-R2' }]);
});

// ── L'interfaccia: dichiarare le reti ───────────────────────────────────────
// Il criterio del piano, alla lettera: si dichiara una /64 accanto a una /24 e
// una /30 senza VLAN.
test('il pannello VLAN: una /64 accanto a una /24, e una /30 senza VLAN', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[
      { id:'sw1', type:'switch', name:'SW1', ip:'192.168.20.10' },
    ], racks:[], links:[], ports:{}, vlanColors:{ 20:'#00d4ff' }, vlanNames:{ 20:'Uffici' },
      ipam:{ vlans:{}, prefixes:[] } });

    addDeclaredPrefix('192.168.20.0/24', 20);
    addDeclaredPrefix('2001:db8:0:14::/64', 20);   // dual-stack: prima si perdeva
    addDeclaredPrefix('10.0.0.0/30', null);        // rete senza VLAN
    updatePrefixField(prefixKey('10.0.0.0/30'), 'name', 'punto-punto R1-R2');

    selType = null; selId = null; renderProps();
    const html = document.getElementById('props-panel').innerHTML;
    return JSON.stringify({
      prefixes: state.ipam.prefixes,
      hasNoVlanSection: html.includes('Reti senza VLAN'),
      plainCards: (html.match(/vlan-ipam-plain/g) || []).length,
      showsP2P: html.includes('10.0.0.0/30'),
      // la VLAN 20 e' CHIUSA: le sue due reti non si vedono finche' non la apri
      showsV6WhileClosed: html.includes('2001:db8:0:14::/64'),
    });
  })()`);
  const r = JSON.parse(out);

  assert.strictEqual(r.prefixes.length, 3);
  assert.deepStrictEqual(r.prefixes.map(p => p.cidr),
    ['192.168.20.0/24', '2001:db8:0:14::/64', '10.0.0.0/30']);
  assert.deepStrictEqual(r.prefixes.map(p => p.vlan), [20, 20, null]);
  assert.strictEqual(r.prefixes[2].name, 'punto-punto R1-R2');

  assert.strictEqual(r.hasNoVlanSection, true, 'la sezione «Reti senza VLAN» c\'è');
  assert.strictEqual(r.plainCards, 1, 'una sola card ridotta: la /30');
  assert.strictEqual(r.showsP2P, true);
  assert.strictEqual(r.showsV6WhileClosed, false, 'col cassetto VLAN chiuso le sue reti non si stampano');
});

test('il pannello VLAN: aperto il cassetto, le due reti della VLAN si vedono', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[], racks:[], links:[], ports:{},
      vlanColors:{ 20:'#00d4ff' }, vlanNames:{},
      ipam:{ vlans:{}, prefixes:[
        { cidr:'192.168.20.0/24', vlan:20, gateway:'192.168.20.1' },
        { cidr:'2001:db8:0:14::/64', vlan:20, source:'dcim', description:'Uffici v6' },
      ] } });
    _vlanIpamOpen.clear(); _prefixOpen.clear(); _vlanIpamOpen.add(20);
    selType = null; selId = null; renderProps();
    const html = document.getElementById('props-panel').innerHTML;
    return JSON.stringify({
      v4: html.includes('192.168.20.0/24'),
      v6: html.includes('2001:db8:0:14::/64'),
      dcimBadge: html.includes('drift-net-tag is-decl'),
      // la riga e' CHIUSA: gateway e descrizione stanno dietro il chevron
      gwHidden: !html.includes('data-field="gateway"'),
      descHidden: !html.includes('Uffici v6'),
    });
  })()`);
  const r = JSON.parse(out);
  assert.strictEqual(r.v4, true);
  assert.strictEqual(r.v6, true, 'il dual-stack si vede: due righe, non una');
  assert.strictEqual(r.dcimBadge, true, 'la provenienza DCIM si distingue');
  assert.strictEqual(r.gwHidden, true, 'riga compatta: il gateway è nella parte espansa');
  assert.strictEqual(r.descHidden, true);
});

test('il pannello VLAN: espansa, la riga mostra gateway, DNS e cio` che dichiara il DCIM', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[], racks:[], links:[], ports:{},
      vlanColors:{ 20:'#00d4ff' }, vlanNames:{},
      ipam:{ vlans:{}, prefixes:[
        { cidr:'192.168.20.0/24', vlan:20, gateway:'192.168.20.1', dns:'1.1.1.1',
          source:'dcim', status:'active', description:'Rete uffici' },
      ] } });
    _vlanIpamOpen.clear(); _prefixOpen.clear(); _vlanIpamOpen.add(20);
    togglePrefixOpen(prefixKey('192.168.20.0/24'));
    selType = null; selId = null; renderProps();
    const html = document.getElementById('props-panel').innerHTML;
    return JSON.stringify({
      gw: html.includes('192.168.20.1'), dns: html.includes('1.1.1.1'),
      status: html.includes('active'), desc: html.includes('Rete uffici'),
    });
  })()`);
  const r = JSON.parse(out);
  assert.strictEqual(r.gw, true);
  assert.strictEqual(r.dns, true);
  assert.strictEqual(r.status, true, 'lo stato dichiarato dal DCIM si legge qui');
  assert.strictEqual(r.desc, true);
});

test('il pannello VLAN: un gateway orfano non sparisce dalla vista', () => {
  // Vecchio progetto con il gateway scritto e la subnet no: la migrazione lo
  // lascia sul record VLAN, e il cassetto lo dice invece di ignorarlo.
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:1, nodes:[], racks:[], links:[], ports:{},
      vlanColors:{ 40:'#f1e05a' }, vlanNames:{},
      ipam:{ vlans:{ 40:{ gateway:'10.0.40.1' } } } });
    _vlanIpamOpen.clear(); _prefixOpen.clear(); _vlanIpamOpen.add(40);
    selType = null; selId = null; renderProps();
    return document.getElementById('props-panel').innerHTML.includes('10.0.40.1') ? 'visibile' : 'sparito';
  })()`);
  assert.strictEqual(out, 'visibile');
});
