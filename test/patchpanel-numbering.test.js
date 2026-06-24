'use strict';
// Test della numerazione progressiva patch panel (helper puri di lib/frontpanel.js).
const test = require('node:test');
const assert = require('node:assert');
const { panelNumberOffset, patchPanelPortLabel, panelChainReaches } = require('../lib/frontpanel.js');

// Helper: costruisce recordsById da una lista compatta.
function recs(list) {
    const m = {};
    for (const r of list) m[r.id] = { ports: r.ports, continueFrom: r.continueFrom || '', startNum: r.startNum };
    return m;
}

test('pannello indipendente → offset 0 (1..N storico)', () => {
    const m = recs([{ id: 'A', ports: 24 }]);
    assert.equal(panelNumberOffset('A', m), 0);
    assert.equal(patchPanelPortLabel('A', 1, m), '1');
    assert.equal(patchPanelPortLabel('A', 24, m), '24');
});

test('catena A→B→C: offset cumulativo per porte dei predecessori', () => {
    const m = recs([
        { id: 'A', ports: 24 },
        { id: 'B', ports: 24, continueFrom: 'A' },
        { id: 'C', ports: 12, continueFrom: 'B' },
    ]);
    assert.equal(panelNumberOffset('B', m), 24);          // B parte da 25
    assert.equal(patchPanelPortLabel('B', 1, m), '25');
    assert.equal(panelNumberOffset('C', m), 48);          // C parte da 49 (24+24)
    assert.equal(patchPanelPortLabel('C', 1, m), '49');
    assert.equal(patchPanelPortLabel('C', 12, m), '60');
});

test('startNum manuale vince sulla catena (porta 1 = startNum)', () => {
    const m = recs([
        { id: 'A', ports: 24 },
        { id: 'B', ports: 24, continueFrom: 'A', startNum: 101 },
    ]);
    assert.equal(panelNumberOffset('B', m), 100);
    assert.equal(patchPanelPortLabel('B', 1, m), '101');
    assert.equal(patchPanelPortLabel('B', 24, m), '124');
});

test('predecessore eliminato → torna indipendente (offset 0)', () => {
    const m = recs([{ id: 'B', ports: 24, continueFrom: 'GHOST' }]);
    assert.equal(panelNumberOffset('B', m), 0);
});

test('ciclo A→B→A → troncato a 0, nessun loop infinito', () => {
    const m = recs([
        { id: 'A', ports: 24, continueFrom: 'B' },
        { id: 'B', ports: 24, continueFrom: 'A' },
    ]);
    // non deve andare in stack overflow; ritorna un numero finito
    assert.equal(Number.isFinite(panelNumberOffset('A', m)), true);
    assert.equal(Number.isFinite(panelNumberOffset('B', m)), true);
});

test('ports del predecessore mancanti/non numerici → contati come 0', () => {
    const m = recs([
        { id: 'A', ports: undefined, continueFrom: '' },
        { id: 'B', ports: 24, continueFrom: 'A' },
    ]);
    assert.equal(panelNumberOffset('B', m), 0);
});

test('panelChainReaches: B (continua da A) raggiunge A, A non raggiunge B', () => {
    const m = recs([
        { id: 'A', ports: 24 },
        { id: 'B', ports: 24, continueFrom: 'A' },
    ]);
    assert.equal(panelChainReaches('B', 'A', m), true);   // B è a valle di A
    assert.equal(panelChainReaches('A', 'B', m), false);  // A è a monte → selezionabile
    assert.equal(panelChainReaches('A', 'A', m), true);   // sé stesso
});
