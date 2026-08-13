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
test('il pannello: una /64 accanto a una /24, e una /30 senza VLAN', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[
      { id:'sw1', type:'switch', name:'SW1', ip:'192.168.20.10' },
    ], racks:[], links:[], ports:{}, vlanColors:{ 20:'#00d4ff' }, vlanNames:{ 20:'Uffici' },
      ipam:{ vlans:{}, prefixes:[] } });
    _prefixOpen.clear(); _netsBad = '';

    addDeclaredNetworks('192.168.20.0/24, 2001:db8:0:14::/64', 20);   // dual-stack: prima se ne perdeva una
    addDeclaredNetworks('10.0.0.0/30', null);                          // rete senza VLAN
    updatePrefixField(prefixKey('10.0.0.0/30'), 'name', 'punto-punto R1-R2');

    selType = null; selId = null; renderProps();
    const html = document.getElementById('props-panel').innerHTML;
    // Il pannello ha due superfici sulle stesse reti: la card VLAN (appartenenza)
    // e la sezione «Reti» (tutte). Ognuna va letta sulla SUA parte, o l'altra
    // renderebbe vera un'asserzione per il motivo sbagliato.
    const cut = html.indexOf('data-section="floor-nets"');
    const vlanPart = cut < 0 ? html : html.slice(0, cut);
    const nets = cut < 0 ? '' : html.slice(cut);
    return JSON.stringify({
      prefixes: state.ipam.prefixes,
      hasNetsSection: cut >= 0,
      // La card VLAN mostra le SUE due reti, e non la /30 che una VLAN non ce l'ha.
      vlanCardV4: vlanPart.includes('192.168.20.0/24'),
      vlanCardV6: vlanPart.includes('2001:db8:0:14::/64'),
      vlanCardHasP2P: vlanPart.includes('10.0.0.0/30'),
      // «Reti» le mostra tutte e tre, VLAN o no.
      netsHasAll: ['192.168.20.0/24','2001:db8:0:14::/64','10.0.0.0/30'].every(c => nets.includes(c)),
    });
  })()`);
  const r = JSON.parse(out);

  assert.strictEqual(r.prefixes.length, 3);
  assert.deepStrictEqual(r.prefixes.map(p => p.cidr),
    ['192.168.20.0/24', '2001:db8:0:14::/64', '10.0.0.0/30']);
  assert.deepStrictEqual(r.prefixes.map(p => p.vlan), [20, 20, null]);
  assert.strictEqual(r.prefixes[2].name, 'punto-punto R1-R2');

  assert.strictEqual(r.hasNetsSection, true, 'la sezione «Reti» c\'è');
  assert.strictEqual(r.vlanCardV4, true);
  assert.strictEqual(r.vlanCardV6, true, 'il dual-stack si vede: due chip sulla stessa VLAN');
  assert.strictEqual(r.vlanCardHasP2P, false, 'la /30 non appartiene a nessuna VLAN');
  assert.strictEqual(r.netsHasAll, true, '«Reti» le elenca tutte');
});

// ── La sezione «Reti»: tutte le reti, la VLAN e` un'etichetta ────────────────

test('«Reti»: una riga per rete, ordinate per indirizzo, VLAN come badge', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[], racks:[], links:[], ports:{},
      vlanColors:{ 20:'#00d4ff' }, vlanNames:{ 20:'Uffici' },
      ipam:{ vlans:{}, prefixes:[
        { cidr:'192.168.20.0/24', vlan:20 },
        { cidr:'2001:db8:0:14::/64', vlan:20 },
        { cidr:'10.0.0.0/30', vlan:null, source:'dcim' },
      ] } });
    _prefixOpen.clear(); _netsBad = '';
    selType = null; selId = null; renderProps();
    const html = document.getElementById('props-panel').innerHTML;
    const nets = html.slice(html.indexOf('data-section="floor-nets"'));
    // L'ordine a schermo, letto dalle righe del piano — che sono l'UNICO elenco:
    // i chip che ripetevano gli stessi prefissi sopra non ci sono piu'.
    const order = [...nets.matchAll(/class="net-prow-cidr">([^<]+)</g)].map(m => m[1]);
    return JSON.stringify({
      order,
      rows: (nets.match(/class="net-prow[ "]/g) || []).length,
      clickable: (nets.match(/class="net-prow[^"]*" data-act="prefix-expand"/g) || []).length,
      noChips: !nets.includes('net-chip-cidr'),
      vlanBadges: (nets.match(/net-chip-vlan/g) || []).length,
      dcimBadge: nets.includes('drift-net-tag is-decl'),
      // nessuna riga selezionata → nessun dettaglio aperto
      detailHidden: !nets.includes('net-detail'),
      // «Aggiungi rete» sta DOPO il piano
      addAfterPlan: nets.indexOf('net-addrow') > nets.lastIndexOf('class="net-prow'),
    });
  })()`);
  const r = JSON.parse(out);
  // Per INDIRIZZO, non per VLAN ne` per ordine di dichiarazione: prima le v4 in
  // ordine numerico, poi le v6.
  assert.deepStrictEqual(r.order, ['10.0.0.0/30', '192.168.20.0/24', '2001:db8:0:14::/64']);
  assert.strictEqual(r.rows, 3, 'una riga per rete, comprese quelle con VLAN');
  assert.strictEqual(r.clickable, 3, 'ogni riga apre il dettaglio della sua rete');
  assert.strictEqual(r.noChips, true, 'niente doppio elenco: i chip sono spariti');
  assert.strictEqual(r.vlanBadges, 2, 'la VLAN e` un badge, e la rete senza non ne ha');
  assert.strictEqual(r.dcimBadge, true, 'la provenienza dell\'import si vede sulla riga');
  assert.strictEqual(r.detailHidden, true);
  assert.strictEqual(r.addAfterPlan, true, '«Aggiungi rete» sta sotto il piano');
});

test('«Reti»: il conflitto si vede nell\'elenco, e le famiglie diverse non lo sono', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[], racks:[], links:[], ports:{},
      vlanColors:{ 20:'#00d4ff', 30:'#39d353' }, vlanNames:{},
      ipam:{ vlans:{}, prefixes:[
        { cidr:'10.50.0.0/24', vlan:20 },
        { cidr:'10.50.0.128/25', vlan:30 },      // dentro la precedente: conflitto
        { cidr:'2001:db8::/64', vlan:20 },       // dual-stack sulla 20: NON e' un conflitto
      ] } });
    _prefixOpen.clear(); _netsBad = '';
    selType = null; selId = null; renderProps();
    const html = document.getElementById('props-panel').innerHTML;
    const nets = html.slice(html.indexOf('data-section="floor-nets"'));
    return JSON.stringify({
      clashRows: (nets.match(/net-prow clash/g) || []).length,
      notes: (nets.match(/net-clashnote/g) || []).length,
      preview: /props-collapsible-preview warn">([^<]*)</.exec(nets)?.[1] || '',
    });
  })()`);
  const r = JSON.parse(out);
  assert.strictEqual(r.clashRows, 2, 'le due che si pestano i piedi, non la terza');
  assert.strictEqual(r.notes, 1, 'una nota sola, sotto la seconda delle due');
  assert.match(r.preview, /3 dichiarate/);
  assert.match(r.preview, /1 in conflitto/);
});

test('«Reti»: la riga aperta mostra il dettaglio sotto di se`, e la × cancella davvero', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[], racks:[], links:[], ports:{},
      vlanColors:{ 20:'#00d4ff' }, vlanNames:{},
      ipam:{ vlans:{}, prefixes:[{ cidr:'192.168.20.0/24', vlan:20, gateway:'192.168.20.1', dns:'1.1.1.1' }] } });
    _prefixOpen.clear(); _netsBad = '';
    selType = null; selId = null;
    togglePrefixOpen(prefixKey('192.168.20.0/24'));
    let html = document.getElementById('props-panel').innerHTML;
    let nets = html.slice(html.indexOf('data-section="floor-nets"'));
    const open = {
      detail: nets.includes('net-detail'),
      // il dettaglio si apre SOTTO la sua riga, non in fondo alla lista
      underItsRow: nets.indexOf('net-detail') > nets.indexOf('class="net-prow'),
      rowSelected: /class="net-prow[^"]*\bsel\b/.test(nets),
      vlanSelect: nets.includes('data-field="vlan"'),
      gwChip: nets.includes('192.168.20.1'),
      dnsField: nets.includes('data-field="dns"'),
      // La chiusura si VEDE: un chevron nell'intestazione del dettaglio, non solo
      // il ri-clic sulla riga. E non è una ×, che qui cancellerebbe la rete.
      // (niente backtick in questo blocco: è dentro un template literal)
      closeBtn: /class="net-detail-x"[^>]*data-act="prefix-expand"/.test(nets),
      closeIsNotAnX: !/class="net-detail-x"[^>]*><i class="fas fa-times/.test(nets),
    };
    // Il chevron chiude e basta: la rete resta.
    togglePrefixOpen(prefixKey('192.168.20.0/24'));
    const afterClose = document.getElementById('props-panel').innerHTML;
    const closed = {
      noDetail: !afterClose.slice(afterClose.indexOf('data-section="floor-nets"')).includes('net-detail'),
      stillThere: state.ipam.prefixes.length,
    };
    removeDeclaredPrefix(prefixKey('192.168.20.0/24'));
    return JSON.stringify({ open, closed, left: state.ipam.prefixes.length });
  })()`);
  const r = JSON.parse(out);
  assert.strictEqual(r.open.detail, true, 'il dettaglio si apre sotto il campo');
  assert.strictEqual(r.open.vlanSelect, true, 'la VLAN si cambia da qui');
  assert.strictEqual(r.open.gwChip, true, 'il gateway e` a chip');
  assert.strictEqual(r.open.dnsField, true, 'il DNS resta un campo');
  assert.strictEqual(r.open.closeBtn, true, 'il dettaglio ha un modo VISIBILE di chiudersi');
  assert.strictEqual(r.open.closeIsNotAnX, true, 'e non e` una ×, che qui cancella la rete');
  assert.strictEqual(r.closed.noDetail, true, 'chiuso, il dettaglio sparisce');
  assert.strictEqual(r.closed.stillThere, 1, 'chiudere non cancella');
  assert.strictEqual(r.left, 0, 'la × di «Reti» cancella la rete dal documento');
});

test('«Reti»: la lista a virgole entra tutta, e cio` che non si parsa resta nel campo', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[], racks:[], links:[], ports:{},
      vlanColors:{}, vlanNames:{}, ipam:{ vlans:{}, prefixes:[] } });
    _prefixOpen.clear(); _netsBad = '';
    selType = null; selId = null;
    addDeclaredNetworks('192.168.20.7/24, 2001:db8::/32, non-una-rete', null);
    const html = document.getElementById('props-panel').innerHTML;
    const nets = html.slice(html.indexOf('data-section="floor-nets"'));
    return JSON.stringify({
      cidrs: state.ipam.prefixes.map(p => p.cidr),
      vlans: state.ipam.prefixes.map(p => p.vlan),
      bad: _netsBad,
      fieldKeepsBad: nets.includes('non-una-rete'),
      fieldIsRed: nets.includes('net-addrow bad'),
    });
  })()`);
  const r = JSON.parse(out);
  // Host azzerato: chi scrive .7/24 intende la /24.
  assert.deepStrictEqual(r.cidrs, ['192.168.20.0/24', '2001:db8::/32']);
  assert.deepStrictEqual(r.vlans, [null, null], 'da «Reti» si dichiara senza VLAN');
  assert.strictEqual(r.bad, 'non-una-rete');
  assert.strictEqual(r.fieldKeepsBad, true, 'quello che non si parsa RESTA nel campo');
  assert.strictEqual(r.fieldIsRed, true);
});

test('«Reti»: il selettore VLAN produce null, mai «VLAN 0»', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[], racks:[], links:[], ports:{},
      vlanColors:{ 20:'#00d4ff' }, vlanNames:{},
      ipam:{ vlans:{}, prefixes:[{ cidr:'192.168.20.0/24', vlan:20 }] } });
    _prefixOpen.clear(); _netsBad = '';
    selType = null; selId = null;
    const k = prefixKey('192.168.20.0/24');
    updatePrefixField(k, 'vlan', '');          // «—» dalla tendina
    const detached = state.ipam.prefixes[0].vlan;
    updatePrefixField(k, 'vlan', '30');        // una VLAN che non e' in palette
    const reattached = state.ipam.prefixes[0].vlan;
    return JSON.stringify({ detached, reattached, typeOf: typeof reattached, inPalette: !!state.vlanColors[30] });
  })()`);
  const r = JSON.parse(out);
  assert.strictEqual(r.detached, null, '«—» stacca: null, non 0');
  assert.strictEqual(r.reattached, 30);
  assert.strictEqual(r.typeOf, 'number', 'un numero, come lo scrive l\'import DCIM');
  assert.strictEqual(r.inPalette, true, 'una VLAN scelta e non in palette entra nella palette');
});

// Il cassetto IPAM della card VLAN non c'e' piu': al suo posto un campo di sola
// APPARTENENZA. I fatti che i test qui sotto verificavano restano veri — cambia
// dove si leggono.

test('la card VLAN: le due reti della VLAN sono chip, senza aprire niente', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[], racks:[], links:[], ports:{},
      vlanColors:{ 20:'#00d4ff' }, vlanNames:{},
      ipam:{ vlans:{}, prefixes:[
        { cidr:'192.168.20.0/24', vlan:20, gateway:'192.168.20.1' },
        { cidr:'2001:db8:0:14::/64', vlan:20, source:'dcim', description:'Uffici v6' },
      ] } });
    _prefixOpen.clear(); _netsBad = '';
    selType = null; selId = null; renderProps();
    const html = document.getElementById('props-panel').innerHTML;
    const vlanPart = html.slice(0, html.indexOf('data-section="floor-nets"'));
    return JSON.stringify({
      v4: vlanPart.includes('192.168.20.0/24'),
      v6: vlanPart.includes('2001:db8:0:14::/64'),
      dcimBadge: vlanPart.includes('drift-net-tag is-decl'),
      // appartenenza e basta: com'e' fatta la rete si dice da «Reti»
      noGwField: !vlanPart.includes('data-field="gateway"'),
      noDesc: !vlanPart.includes('Uffici v6'),
      // il cassetto e il suo interruttore non esistono piu'
      noDrawer: !html.includes('vlan-ipam-toggle'),
    });
  })()`);
  const r = JSON.parse(out);
  assert.strictEqual(r.v4, true);
  assert.strictEqual(r.v6, true, 'il dual-stack si vede: due chip, non uno');
  assert.strictEqual(r.dcimBadge, true, 'la provenienza DCIM si distingue');
  assert.strictEqual(r.noGwField, true, 'dalla VLAN si dice QUALI reti, non come sono fatte');
  assert.strictEqual(r.noDesc, true);
  assert.strictEqual(r.noDrawer, true, 'niente piu` cassetto IPAM da aprire');
});

test('la card VLAN: ⊘ STACCA la rete, non la cancella', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[], racks:[], links:[], ports:{},
      vlanColors:{ 20:'#00d4ff' }, vlanNames:{},
      ipam:{ vlans:{}, prefixes:[{ cidr:'192.168.20.0/24', vlan:20, gateway:'192.168.20.1', dns:'1.1.1.1' }] } });
    _prefixOpen.clear(); _netsBad = '';
    selType = null; selId = null; renderProps();
    const html = document.getElementById('props-panel').innerHTML;
    const vlanPart = html.slice(0, html.indexOf('data-section="floor-nets"'));
    // Il bottone del chip nella card VLAN passa da prefix-clear su 'vlan': una
    // funzione che svuota un campo e non sa nemmeno rimuovere una riga.
    const detaches = /data-act="prefix-clear"[^>]*data-field="vlan"/.test(vlanPart);
    updatePrefixField(prefixKey('192.168.20.0/24'), 'vlan', '');
    const p = state.ipam.prefixes[0];
    return JSON.stringify({ detaches, left: state.ipam.prefixes.length, vlan: p && p.vlan, gw: p && p.gateway, dns: p && p.dns });
  })()`);
  const r = JSON.parse(out);
  assert.strictEqual(r.detaches, true, 'il bottone della card VLAN non puo` cancellare');
  assert.strictEqual(r.left, 1, 'la rete resta nel documento');
  assert.strictEqual(r.vlan, null);
  assert.strictEqual(r.gw, '192.168.20.1', 'e si porta dietro il suo gateway');
  assert.strictEqual(r.dns, '1.1.1.1');
});

test('la card VLAN: si dichiara una rete da qui e nasce gia` su questa VLAN', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[], racks:[], links:[], ports:{},
      vlanColors:{ 20:'#00d4ff' }, vlanNames:{}, ipam:{ vlans:{}, prefixes:[] } });
    _prefixOpen.clear(); _netsBad = '';
    selType = null; selId = null;
    addDeclaredNetworks('192.168.20.0/24, 2001:db8:0:14::/64', 20);
    return JSON.stringify(state.ipam.prefixes.map(p => [p.cidr, p.vlan]));
  })()`);
  assert.deepStrictEqual(JSON.parse(out), [
    ['192.168.20.0/24', 20], ['2001:db8:0:14::/64', 20],
  ]);
});

test('la card VLAN: un gateway orfano non sparisce dalla vista', () => {
  // Vecchio progetto con il gateway scritto e la subnet no: la migrazione lo
  // lascia sul record VLAN, e la card lo dice invece di ignorarlo.
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:1, nodes:[], racks:[], links:[], ports:{},
      vlanColors:{ 40:'#f1e05a' }, vlanNames:{},
      ipam:{ vlans:{ 40:{ gateway:'10.0.40.1' } } } });
    _prefixOpen.clear(); _netsBad = '';
    selType = null; selId = null; renderProps();
    const html = document.getElementById('props-panel').innerHTML;
    const vlanPart = html.slice(0, html.indexOf('data-section="floor-nets"'));
    return vlanPart.includes('10.0.40.1') ? 'visibile' : 'sparito';
  })()`);
  assert.strictEqual(out, 'visibile');
});

test('la card VLAN: il legame con l\'SVI resta qui — e` un device, non un attributo della rete', () => {
  const out = run(APP.ctx, `(() => {
    state = _migrateState({ schemaVersion:2, nodes:[{ id:'rt1', type:'router', name:'RT1', ip:'192.168.20.1' }],
      racks:[], links:[], ports:{}, vlanColors:{ 20:'#00d4ff' }, vlanNames:{},
      ipam:{ vlans:{ 20:{ gatewayNodeId:'rt1' } }, prefixes:[{ cidr:'192.168.20.0/24', vlan:20, gateway:'192.168.20.1' }] } });
    _prefixOpen.clear(); _netsBad = '';
    selType = null; selId = null; renderProps();
    const html = document.getElementById('props-panel').innerHTML;
    const vlanPart = html.slice(0, html.indexOf('data-section="floor-nets"'));
    return JSON.stringify({
      bindingInCard: vlanPart.includes('data-change="l3-gw-select"'),
      keptOnVlan: state.ipam.vlans['20'].gatewayNodeId,
    });
  })()`);
  const r = JSON.parse(out);
  assert.strictEqual(r.bindingInCard, true, 'il selettore del device gateway sta nella card VLAN');
  assert.strictEqual(r.keptOnVlan, 'rt1', 'e il legame resta sul record della VLAN');
});
