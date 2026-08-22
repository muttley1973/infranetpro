'use strict';
// ============================================================================
// L'anello di stato non deve essere ridipinto da un vicino — e ci dev'essere
// un modo di rivedere tutto il rack
// ============================================================================
// Un apparato assente porta un ANELLO rosso: è l'avviso «documentato qui, in rete
// non c'è». È un `box-shadow` che esce dal riquadro, e i device del rack sono tutti
// `position:relative` senza `z-index` — quindi a parità di livello vince l'ORDINE
// DEL DOM, e il vicino più in basso nell'elenco ridipinge sopra l'alone di chi viene
// prima. Misurato sul banco: l'assente era il figlio n.3, il pannello patch attaccato
// sotto il n.16 → il lato inferiore dell'anello spariva.
//
// ⚠️ Il sintomo è ingannevole: resta UNA riga rossa orizzontale, che non si legge
// come un contorno ma come un artefatto di rendering. È così che è stato segnalato.
//
// E c'è il secondo pezzo: il chassis ha una larghezza sua (356px) mentre la finestra
// dipende dal pannello, quindi oltre un certo zoom i fianchi finiscono fuori
// dall'`overflow:hidden` del viewport. Zoomare è il gesto normale per leggere le
// porte; quello che mancava era la via di RITORNO, perché i controlli erano solo
// −/+ a passi del 10%. Ora la percentuale è il comando «adatta alla larghezza» e
// si colora quando stai guardando solo una parte.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const leggi = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CSS = leggi('styles/04-floor-rack.css');
const HTML = leggi('netmapper.html');
const ZOOM = leggi('src/app-search-zoom-rack.js');

// Gli stati che portano un anello sul device del rack. `node-unverified` non c'è:
// attenua e basta (opacity), non disegna contorni.
const STATI = ['node-absent', 'node-absent-expected', 'node-status-conflict'];

test('ogni stato con anello sta sopra i vicini del rack', () => {
    // Il blocco che alza lo z-index deve nominarli tutti: se ne nasce un quarto e
    // qualcuno scorda questa riga, il suo anello torna a farsi coprire in silenzio.
    const blocco = CSS.match(/((?:\s*\.rack-device\.[a-z-]+,)*\s*\.rack-device\.[a-z-]+\s*\{\s*z-index:\s*\d+\s*;\s*\})/g) || [];
    const conZ = blocco.join(' ');
    for (const st of STATI) {
        assert.ok(conZ.includes('.rack-device.' + st),
            st + ' non alza lo z-index: un vicino può ridipingergli sopra l\'anello');
    }
});

test('…ma sotto la selezione, che deve restare riconoscibile', () => {
    const zSel = +(CSS.match(/\.rack-device\.selected\s*\{[^}]*z-index:\s*(\d+)/) || [])[1];
    const zStato = +(CSS.match(/\.rack-device\.node-absent[^{]*\{\s*z-index:\s*(\d+)/) || [])[1];
    assert.ok(Number.isFinite(zSel) && Number.isFinite(zStato), 'z-index non leggibili');
    assert.ok(zStato < zSel,
        'lo stato (' + zStato + ') non deve superare la selezione (' + zSel + '): ' +
        'selezionando un assente il contorno della selezione sparirebbe');
});

test('gli anelli di stato hanno tutti la STESSA geometria', () => {
    // Il principio è scritto nel CSS: cambia il COLORE, che è la notizia — non la
    // forma. Due stati con spessori diversi sembrano due decorazioni scorrelate.
    const spessori = [...CSS.matchAll(/\.(?:floor-node|rack-device)\.(?:node-absent|node-absent-expected|node-status-conflict|snmp-fault)[^{]*\{[^}]*box-shadow:\s*0 0 0 (\d+)px/g)]
        .map((m) => m[1]);
    assert.ok(spessori.length >= 4, 'trovati solo ' + spessori.length + ' anelli: il riconoscitore non riconosce più');
    assert.equal(new Set(spessori).size, 1,
        'spessori diversi fra gli stati: ' + [...new Set(spessori)].join(', ') + 'px');
});

test('l\'etichetta dello zoom del rack È il comando «adatta alla larghezza»', () => {
    const tag = HTML.match(/<(\w+)[^>]*id="rack-zoom-lbl"[^>]*>/);
    assert.ok(tag, 'etichetta dello zoom rack non trovata');
    assert.equal(tag[1], 'button',
        'deve essere un <button>: da <span> non ci arrivi con la tastiera');
    assert.match(tag[0], /data-act="rack-fit"/, 'manca l\'azione delegata');
    assert.match(tag[0], /data-i18n-tip="rack\.fitTip"/, 'manca il tooltip tradotto');
    assert.match(ZOOM, /'rack-fit':\s*\(\)\s*=>\s*fitRack\(\)/,
        'l\'azione non è registrata: il bottone sarebbe muto');
});

test('il pareggio si misura sulla larghezza di LAYOUT, non sul rettangolo scalato', () => {
    // ⚠️ Trappola pagata: `#rack-chassis-wrap` ha `transition:transform .1s`, quindi
    // durante l'animazione dello zoom `getBoundingClientRect()` restituisce una via di
    // mezzo — e per giunta è già moltiplicato dallo scale. `offsetWidth` no.
    const fn = ZOOM.match(/export function rackFitZoom\(\)\{[\s\S]*?\n\}/);
    assert.ok(fn, 'rackFitZoom non trovata');
    // ⚠️ Il commento della funzione NOMINA getBoundingClientRect per dire di non usarlo:
    // si guarda il codice, non la prosa, o il test accusa la propria documentazione.
    const codice = fn[0].split(/\r?\n/).filter((r) => !/^\s*\/\//.test(r)).join('\n');
    assert.match(codice, /offsetWidth/, 'deve misurare la larghezza di layout');
    assert.ok(codice.indexOf('getBoundingClientRect') < 0,
        'usa il rettangolo scalato: durante la transizione misura un numero che non esiste');
    assert.match(codice, /return null/, 'deve poter dire «non lo so» invece di inventare uno zoom');
});

test('adattare non porta fuori dalla scala dello zoom', () => {
    const fn = ZOOM.match(/export function rackFitZoom\(\)\{[\s\S]*?\n\}/)[0];
    const estremi = fn.match(/Math\.max\(([\d.]+),\s*Math\.min\((\d+)/);
    assert.ok(estremi, 'nessun limite: adattare potrebbe uscire dagli estremi di zoomRack');
    const zr = ZOOM.match(/function zoomRack\(delta\)\{[\s\S]*?Math\.max\(([\d.]+),\s*Math\.min\((\d+)/);
    assert.equal(estremi[1], zr[1], 'estremo minimo diverso da zoomRack');
    assert.equal(estremi[2], zr[2], 'estremo massimo diverso da zoomRack');
});

test('il tooltip esiste in tutt\'e due le lingue', () => {
    const i18n = leggi('lib/i18n.js');
    assert.equal((i18n.match(/'rack\.fitTip':/g) || []).length, 2,
        'rack.fitTip deve esserci in italiano E in inglese');
});
