'use strict';
// ============================================================================
// Lo stato porta ha TRE valori, e «idle» non è più uno di loro
// ============================================================================
// `idle` era la quarta tinta del LED, e diceva quattro cose diverse a seconda di
// chi la leggeva: l'etichetta prometteva «su ma senza traffico», l'SNMP ci
// scriveva `testing`/`dormant` che nella RFC 2863 sono l'opposto (non passano
// pacchetti), il generatore della demo la usava per «spenta a mano», e
// ARCHITECTURE.md la chiamava «Pronta», che è l'etichetta della STAMPANTE. Nessuno
// la leggeva per decidere qualcosa: era solo un colore.
//
// E un colore che si trasformava da solo. La stessa lettura che scriveva
// `status:'idle'` scriveva anche `operUp=false`, quindi la porta accumulava
// `downStreak` e dopo tre Verifiche passava dall'ambra di `--idle-color` a quella
// di `--nolink-color`. Un'ambra che dura tre poll e poi ne diventa un'altra non è
// uno stato: è rumore.
//
// La LETTURA però non si butta: la parola che l'apparato ha detto vive adesso in
// `pi.operWait` — una misura, con la sua scadenza, mostrata a parole nella barra
// SNMP accanto a «admin shutdown» e «senza link». Un dialer Cisco in spoofing e una
// NIC Linux che aspetta l'802.1X restano leggibili; semplicemente il LED non finge
// più di avere una tinta per loro.
//
// Le invarianti difese qui:
//   * il vocabolario è chiuso a tre, e un `'idle'` salvato su disco degrada da sé;
//   * la mappa ifOperStatus → stato non ha più un ramo che inventa una quarta tinta;
//   * `operWait` è una MISURA: nasce solo da 3/5, tace su 0/4, e scade con le altre;
//   * la parola `idle` non può rientrare di soppiatto in nessuno dei nove posti che
//     la portavano (tre tendine, il vocabolario, tre mappe-colore d'export, il CSS).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { forgetPortMeasure } = require('../lib/port-state.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const leggi = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** I commenti PARLANO di `idle` apposta (spiegano perché non c'è più): vanno tolti
 *  prima di cercare il codice, o il guardiano abbaia alla propria motivazione. */
const senzaCommentiCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

let APP;
test('carica l’app nel DOM finto', () => {
    APP = loadApp(ROOT);
    assert.ok(APP.files.length > 10);
});

function val(expr) {
    return JSON.parse(run(APP.ctx, `(() => { try { return JSON.stringify({ ok:true, v:(${expr}) }); }
        catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); } })()`));
}

// ---- il vocabolario è chiuso a tre ----------------------------------------
// ⚠️ `normalizePortStatus` NON si interroga dal globale: su `window` ce ne sono due con
// lo stesso nome e vocabolari diversi (questa delle porte, e quella dello stato
// operativo del device in lib/device-status.js, che risponde `''`). A runtime non si
// confondono — chi disegna le porte importa la sua via ESM — ma un test che chiama
// il globale misurerebbe l'altra. Si guarda quindi l'EFFETTO, sul render vero.
test('un «idle» salvato prima non ha bisogno di migrazione: rende come «inactive»', () => {
    // È il motivo per cui la rimozione non tocca `projects/`: il ramo di fallback
    // esisteva già, e `inactive` è esattamente ciò che l'apparato stava dicendo.
    const r = JSON.parse(run(APP.ctx, `(() => { try {
        state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
        _propsExplicit=true;
        state.nodes.push({id:'sw',type:'switch',name:'SW',x:0,y:0,w:60,h:40,ports:8});
        if(typeof _invalidateIdx==='function') _invalidateIdx();
        state.ports['sw-1'] = { status:'idle', ifName:'Gi0/1' };   // progetto vecchio
        selType='port'; selId='sw-1'; renderProps();
        const h = document.getElementById('props-panel').innerHTML;
        return JSON.stringify({ ok:true,
            inactiveSel: h.indexOf('<option value="inactive" selected>') >= 0,
            idleAnywhere: h.indexOf('idle') >= 0 });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); } })()`));
    assert.ok(r.ok, r.err);
    assert.ok(r.inactiveSel, 'un `status:"idle"` sul disco deve presentarsi come «Inattivo»');
    assert.equal(r.idleAnywhere, false, 'la parola «idle» è riaffiorata nel pannello');
});

// ---- ifOperStatus → stato: nessun ramo inventa una quarta tinta -----------
test('ifOperStatus: 2 down, 3 testing e 5 dormant finiscono tutti su «inactive»', () => {
    // Non è un'appiattimento arbitrario: `_snmpOperToUi` (la misura gemella, che
    // alimenta `downStreak`) collassa già gli stessi tre su `false`. Prima le due
    // funzioni dicevano cose diverse sulla stessa lettura.
    const r = val(`[2,3,5].map(n => _snmpOperToUiStatus(n, 'active'))`);
    assert.ok(r.ok, r.err);
    assert.deepEqual(r.v, ['inactive', 'inactive', 'inactive']);
    const g = val(`[2,3,5].map(n => _snmpOperToUi(n))`);
    assert.ok(g.ok, g.err);
    assert.deepEqual(g.v, [false, false, false], 'stato e misura devono concordare sulla stessa lettura');
});

test('ifOperStatus: 1 resta «active», 6/7 restano «fault», 0 e 4 CONSERVANO', () => {
    const r = val(`({ up:_snmpOperToUiStatus(1,'fault'), np:_snmpOperToUiStatus(6,'active'),
        lld:_snmpOperToUiStatus(7,'active'), unknown:_snmpOperToUiStatus(4,'active'),
        mai:_snmpOperToUiStatus(0,'active'), vuoto:_snmpOperToUiStatus(4, undefined) })`);
    assert.ok(r.ok, r.err);
    assert.equal(r.v.up, 'active');
    assert.equal(r.v.np, 'fault');
    assert.equal(r.v.lld, 'fault');
    assert.equal(r.v.unknown, 'active', '4 = «non lo so»: conserva, non riscrive');
    assert.equal(r.v.mai, 'active', '0 = colonna mai letta: conserva');
    assert.equal(r.v.vuoto, 'inactive');
});

// ---- operWait: la parola dell'apparato, e solo quando l'ha detta ----------
test('operWait nasce SOLO da testing(3) e dormant(5), con la parola della RFC', () => {
    const r = val(`({ t:_snmpOperToWait(3), d:_snmpOperToWait(5) })`);
    assert.ok(r.ok, r.err);
    assert.equal(r.v.t, 'testing');
    assert.equal(r.v.d, 'dormant');
});

test('operWait tace su tutto il resto — e soprattutto su 0 e 4, che non sono letture', () => {
    const r = val(`[0,1,2,4,6,7,null,undefined,'x'].map(n => _snmpOperToWait(n) === undefined)`);
    assert.ok(r.ok, r.err);
    assert.deepEqual(r.v, [true, true, true, true, true, true, true, true, true]);
});

test('operWait è una MISURA: scade con le altre tre quando l’apparato tace', () => {
    // Senza questo sarebbe la stessa trappola di `idle`: un'affermazione forte che
    // sopravvive alla prova che la reggeva.
    const pi = { adminDown: true, operUp: false, downStreak: 4, operWait: 'dormant' };
    assert.equal(forgetPortMeasure(pi), true);
    assert.deepEqual(pi, { downStreak: 0 });
    assert.equal(forgetPortMeasure({ operWait: 'testing' }), true, 'da sola basta a far scadere');
    assert.equal(forgetPortMeasure({ ifName: 'Gi0/1' }), false, 'niente da dimenticare, niente da toccare');
});

// ---- a schermo: il LED tace, la barra SNMP cita ---------------------------
test('pannello porta: la tendina ha tre voci, e la parola dell’apparato sta nella barra SNMP', () => {
    const r = JSON.parse(run(APP.ctx, `(() => { try {
        state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
        _propsExplicit=true;
        state.nodes.push({id:'sw',type:'switch',name:'SW',x:0,y:0,w:60,h:40,ports:8});
        if(typeof _invalidateIdx==='function') _invalidateIdx();
        state.ports['sw-1'] = { ifName:'Gi0/1', operUp:false, operWait:'dormant' };
        selType='port'; selId='sw-1'; renderProps();
        const h = document.getElementById('props-panel').innerHTML;
        return JSON.stringify({ ok:true,
            idleOption: h.indexOf('value="idle"') >= 0,
            treVoci: (h.match(/<option value="(active|inactive|fault)"/g)||[]).length,
            barra: h.indexOf('snmp-bar') >= 0,
            parola: h.indexOf('>dormant<') >= 0 });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); } })()`));
    assert.ok(r.ok, r.err);
    assert.equal(r.idleOption, false, 'la voce «idle» è tornata nella tendina');
    assert.equal(r.treVoci, 3, 'la tendina deve offrire esattamente active/inactive/fault');
    assert.ok(r.barra, 'manca la barra SNMP');
    assert.ok(r.parola, 'la parola dichiarata dall’apparato («dormant») non compare da nessuna parte');
});

// ---- il guardiano: nove posti da cui «idle» non può rientrare -------------
test('la parola «idle» non è più uno stato porta in nessuno dei posti che la portavano', () => {
    for (const rel of ['src/app-ports.js', 'src/app-popup.js', 'src/app-properties-port.js']) {
        assert.doesNotMatch(leggi(rel), /value="idle"/, `${rel}: la voce «idle» è rientrata nella tendina`);
    }
    const util = /return \[([^\]]*)\]\.includes\(s\)/.exec(leggi('src/app-util.js'));
    assert.ok(util, 'normalizePortStatus non ha più la forma attesa: rivedi questo guardiano');
    assert.equal(util[1].replace(/[\s']/g, ''), 'inactive,active,fault');

    for (const rel of ['export.js', 'lib/drawio-export.js', 'server/pdf-report.js']) {
        assert.doesNotMatch(leggi(rel), /\bidle\s*:/, `${rel}: la mappa-colore ha di nuovo una tinta per «idle»`);
    }
    for (const rel of ['styles/04-floor-rack.css', 'styles/06-panels.css', 'styles/10-modern.css']) {
        assert.doesNotMatch(senzaCommentiCss(leggi(rel)), /\.idle\b/, `${rel}: un selettore .idle è rientrato`);
    }
});

test('controprova: il guardiano morde davvero', () => {
    // Un guardiano che non fallisce mai non sta guardando niente. Le stesse tre
    // sonde, sulle stringhe che devono far scattare.
    assert.match('<option value="idle" >x</option>', /value="idle"/);
    assert.match("  const SC = { active: '#1', idle: '#2' };", /\bidle\s*:/);
    assert.match(senzaCommentiCss('/* .idle qui è solo un discorso */\n.port-led.idle { color:red }'), /\.idle\b/);
    // …e non deve scattare sul commento che spiega perché `idle` non c'è più.
    assert.doesNotMatch(senzaCommentiCss('/* `.idle` aveva una seconda ambra */\n.port-led { color:red }'), /\.idle\b/);
});
