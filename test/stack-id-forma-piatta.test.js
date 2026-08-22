'use strict';
// ============================================================================
// Lo `stackId` si legge da UN posto solo — o la guardia e la lettura divergono
// ============================================================================
// `isInStack()` accetta DUE forme, e lo fa apposta: `node.spec.stackId` — quella
// che l'app scrive — e `node.stackId` piatto, che un progetto importato o
// modificato a mano può benissimo avere. Il pannello proprietà però leggeva solo
// dentro `spec`: su un nodo dichiarato in stack dalla guardia, ma con l'id scritto
// piatto, `n.spec` era `undefined` e la lettura lanciava.
//
// ⚠️ E non cadeva la sezione stack: cadeva l'INTERO pannello proprietà. Un nodo
// del genere diventava impossibile da aprire, e a schermo non appariva un errore —
// solo un pannello vuoto.
//
// È l'11° caso della classe che in questo progetto costa di più: lo stesso concetto
// definito in due strati, che col tempo divergono. Qui la divergenza era fra una
// GUARDIA generosa e una LETTURA stretta, che è la combinazione peggiore: fa
// passare esattamente i casi che dovrebbe fermare.
//
// La correzione non aggiunge un controllo: rende pubblici i lettori della lib
// (`stackIdOf`/`stackMemberIdOf`) perché chi interroga la guardia legga con la
// stessa definizione. Questi test difendono quell'accordo, e il fatto che il
// pannello si apra in entrambe le forme.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { isInStack, stackIdOf, stackMemberIdOf } = require('../lib/stack.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

// ---- l'accordo fra guardia e lettura ---------------------------------------
const SPEC  = { id: 'a', spec: { stackId: 'st1', stackMemberId: 2 } };
const PIATTO = { id: 'b', stackId: 'st1', stackMemberId: 2 };
const SOLO  = { id: 'c' };

test('la guardia accetta due forme, e il lettore le legge tutte e due', () => {
    for (const n of [SPEC, PIATTO]) {
        assert.equal(isInStack(n), true, `${n.id}: la guardia lo dichiara in stack`);
        assert.equal(stackIdOf(n), 'st1', `${n.id}: …e il lettore deve saperlo leggere`);
        assert.equal(stackMemberIdOf(n), 2);
    }
});

test('un nodo standalone: la guardia dice no e il lettore non inventa', () => {
    assert.equal(isInStack(SOLO), false);
    assert.equal(stackIdOf(SOLO), null);
    assert.equal(stackMemberIdOf(SOLO), null);
});

test('`spec` batte la forma piatta quando ci sono entrambe', () => {
    // Una sola precedenza, dichiarata: `spec` è dove l'app scrive, quindi è la
    // più recente. Il test la fissa perché un domani non si inverta in silenzio.
    assert.equal(stackIdOf({ stackId: 'vecchio', spec: { stackId: 'nuovo' } }), 'nuovo');
});

// ---- la prova che conta: il pannello si apre --------------------------------
let APP;
test('carica l’app nel DOM finto', () => {
    APP = loadApp(ROOT);
    assert.ok(APP.files.length > 10);
});

/** Rende le proprietà di uno switch dichiarato in stack nella forma data. */
function pannello(campi) {
    const r = JSON.parse(run(APP.ctx, `(() => { try {
        state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
        _propsExplicit = true;
        const rid = (state.racks && state.racks[0] && state.racks[0].id) || 'r1';
        state.nodes.push(Object.assign(
            {id:'swZ',type:'switch',name:'SW-Z',x:0,y:0,w:60,h:40,ports:24,rackId:rid,rackU:14,sizeU:1},
            ${JSON.stringify(campi)}));
        if(typeof _invalidateIdx==='function') _invalidateIdx();
        selType='node'; selId='swZ'; renderProps();
        const h = document.getElementById('props-panel').innerHTML || '';
        return JSON.stringify({ ok:true, len:h.length, diceLoStack: h.indexOf('st9') >= 0 });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.message||e) }); } })()`));
    return r;
}

test('forma PIATTA: il pannello si apre invece di esplodere', () => {
    const r = pannello({ stackId: 'st9', stackMemberId: 3 });
    assert.ok(r.ok, 'il pannello lancia ancora: ' + r.err);
    assert.ok(r.len > 1000, 'pannello troppo corto: non si è reso davvero');
    assert.ok(r.diceLoStack, 'lo stack dichiarato non compare nel pannello');
});

test('forma `spec`: nessuna regressione', () => {
    const r = pannello({ spec: { stackId: 'st9', stackMemberId: 3 } });
    assert.ok(r.ok, 'il pannello lancia: ' + r.err);
    assert.ok(r.diceLoStack);
});

test('switch standalone: si apre e non parla di stack', () => {
    const r = pannello({});
    assert.ok(r.ok, 'il pannello lancia: ' + r.err);
    assert.equal(r.diceLoStack, false);
});
