'use strict';
// ============================================================================
// La planimetria dice ciò che dice il rack: «senza link da N verifiche»
// ============================================================================
// Il rack chiedeva la misura a `_portStateCls` in tre punti; la planimetria in
// nessuno. Quindi l'ambra non è che «non si vedeva bene»: la classe non veniva
// proprio emessa, e nessun foglio di stile poteva rimediare. Su un nodo a una
// porta l'icona del dispositivo FA da spia — è documentato in `10-modern.css` —
// e taceva su un fatto che l'app conosceva.
//
// È la solita forma: lo stesso concetto in due strati, uno dei due si aggiorna.
// Le invarianti difese qui sono le tre che la fanno arrivare a schermo, perché
// basta che ne manchi una perché il colore non compaia e nessuno se ne accorga:
//   ① il RENDERER emette la classe (nodo a una porta e nodo a più porte);
//   ② il colore esiste, ed è scritto DOPO `.port.active`/`.port.fault`, o a
//      parità di specificità perde contro il documento che dice «attiva»;
//   ③ i selettori per TIPO di `10-modern.css` — più specifici di tutti — la
//      lasciano passare con `:not(.no-link)`, come già fanno per `.fault`.
// ⚠️ `admin-down` in planimetria NON si dipinge, ed è una scelta: nel rack il
// nero è un buco nello chassis, qui l'icona è il dispositivo e un nero su fondo
// scuro si legge «non disegnato». Il test lo pretende, così nessuno lo "corregge".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const leggi = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let APP;
test('carica l’app nel DOM finto', () => {
    APP = loadApp(ROOT);
    assert.ok(APP.files.length > 10);
});

/** Rende la planimetria con UN nodo in più e le porte date, e ritorna l'HTML delle
 *  tile prodotte. ⚠️ Non si legge `innerHTML` del contenitore: le tile le costruisce
 *  `_buildFloorNodeEl` con createElement + appendChild, e nel DOM finto un figlio
 *  appeso non ricompare nell'`innerHTML` del padre. Si scorrono i `children`, che è
 *  poi il markup vero che finirebbe a schermo. */
function floor(nodo, porte) {
    const r = JSON.parse(run(APP.ctx, `(() => { try {
        state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
        state.nodes.push(${JSON.stringify(nodo)});
        Object.assign(state.ports, ${JSON.stringify(porte)});
        if(typeof _invalidateIdx==='function') _invalidateIdx();
        renderAll();
        const fi = document.getElementById('floor-items');
        // ⚠️ …e si tengono solo le tile DI QUESTO nodo: nel DOM finto il contenitore non
        // si svuota fra un render e l'altro (un vero \`innerHTML=''\` porterebbe via i figli,
        // qui no), quindi senza filtro il test leggerebbe anche i nodi del test precedente.
        const mio = 'data-pid="${nodo.id}-';
        return JSON.stringify({ ok:true, h: (fi.children||[])
            .map(c => c.innerHTML||'').filter(h => h.indexOf(mio) >= 0).join('') });
    } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); } })()`));
    assert.ok(r.ok, r.err);
    assert.ok(r.h.length > 0, 'la planimetria non ha reso nulla: il test non starebbe misurando niente');
    return r.h;
}

// ---- ① il renderer emette la misura ---------------------------------------
const GIU = { operUp: false, downStreak: 4, status: 'active' };   // il doc dice «attiva», lo switch no

test('nodo a UNA porta: l’icona porta la classe, perché lì l’icona è la spia', () => {
    const h = floor({ id: 'pc1', type: 'pc', name: 'PC', x: 10, y: 10, w: 60, h: 40, ports: 1 }, { 'pc1-1': GIU });
    assert.match(h, /class="[^"]*\bport\b[^"]*\bno-link\b/, 'la classe no-link non arriva sull’icona');
});

test('nodo a PIÙ porte: la classe arriva sulle spie, e solo su quella giù', () => {
    // Un tipo FLOOR con più porte (uno switch finirebbe nel rack, non qui) — così si
    // esercita `getPortHTML`, che è l'altro punto da cui la misura può cadere.
    const h = floor({ id: 'nas1', type: 'nasdesktop', name: 'NAS', x: 10, y: 10, w: 60, h: 40, ports: 4 },
        { 'nas1-2': GIU });
    assert.equal((h.match(/\bno-link\b/g) || []).length, 1, 'una sola porta è giù: una sola spia ambra');
    assert.match(h, /data-pid="nas1-2"[^>]*>/, 'la spia esiste');
});

test('una porta chiusa a mano NON diventa ambra: è l’altro fatto', () => {
    const h = floor({ id: 'pc2', type: 'pc', name: 'PC', x: 10, y: 10, w: 60, h: 40, ports: 1 },
        { 'pc2-1': { adminDown: true, operUp: false, downStreak: 9, status: 'active' } });
    assert.doesNotMatch(h, /\bno-link\b/, '«spenta a mano» batte «senza link», come nel rack');
    assert.match(h, /\badmin-down\b/, 'la decisione viaggia lo stesso: è il CSS a scegliere di non dipingerla');
});

test('senza misure la planimetria non inventa niente', () => {
    const h = floor({ id: 'pc3', type: 'pc', name: 'PC', x: 10, y: 10, w: 60, h: 40, ports: 1 },
        { 'pc3-1': { status: 'active' } });
    assert.doesNotMatch(h, /\bno-link\b|\badmin-down\b/);
});

// ---- ② il colore, e il suo posto nella cascata -----------------------------
test('il colore c’è, viene DOPO «attiva» e «guasta», e «spenta a mano» non ce l’ha', () => {
    const css = leggi('styles/04-floor-rack.css');
    const iNoLink = css.indexOf('.port.no-link');
    const iActive = css.indexOf('.port.active');
    const iFault = css.indexOf('.port.fault');
    assert.ok(iNoLink > 0, 'manca la regola .port.no-link: in planimetria l’ambra non esiste');
    assert.ok(iNoLink > iActive && iNoLink > iFault,
        'scritta PRIMA di .port.active/.port.fault perde a parità di specificità: un documento ' +
        'che dice «attiva» coprirebbe la misura dello switch');
    assert.match(css.slice(iNoLink, iNoLink + 90), /var\(--nolink-color\)/, 'il colore va preso dal token');
    assert.equal(css.includes('.port.admin-down'), false,
        'in planimetria il nero non si dipinge: l’icona è il dispositivo, e sparirebbe');
});

// ---- ③ i selettori per tipo la lasciano passare ----------------------------
test('ogni selettore per tipo che protegge «guasta» protegge anche «senza link»', () => {
    // Sono più specifici di `.port.no-link` e vincerebbero: se un domani se ne
    // aggiunge uno per un tipo nuovo, questo test lo trova prima dello schermo.
    const css = leggi('styles/10-modern.css');
    const fault = (css.match(/:not\(\.fault\)/g) || []).length;
    const noLink = (css.match(/:not\(\.fault\):not\(\.no-link\)/g) || []).length;
    assert.ok(fault > 0, 'i selettori per tipo sono spariti: rivedi questo guardiano');
    assert.equal(noLink, fault,
        `${fault - noLink} selettore/i per tipo copre l’ambra della porta: aggiungi :not(.no-link)`);
});
