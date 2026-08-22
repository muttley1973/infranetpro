'use strict';
// ============================================================================
// Un campo pre-compilato è un'AFFERMAZIONE — paletto ② «no invenzioni»
// ============================================================================
// I pannelli device nascevano col valore già scritto dentro: un proiettore con
// 3000 lumen, un NVR con 16 canali, un UPS da 1500 VA, un AP con la VLAN di
// gestione 1, una telecamera con un'ottica «2.8mm / 110deg». Nessuno li aveva
// dichiarati e nessuno li aveva misurati: erano scelte del renderer.
//
// ⚠️ Il danno non è estetico, è una CONTRADDIZIONE fra due strati. Il motore che
// costruisce il dossier (`lib/hw-capabilities.js`) legge quegli stessi campi con
// `_posNum`/`_str`, che scartano l'assente: nel report il proiettore non aveva
// luminosità. Quindi il pannello diceva «3000» e il dossier diceva «non risulta»,
// sulla stessa macchina, nello stesso momento. È il 12° caso della classe
// «stesso concetto in due strati» — qui fra ciò che si MOSTRA e ciò che si SA.
//
// E c'era il gemello: `data-ndef` faceva sì che SVUOTARE un campo ci riscrivesse
// il default (`parseInt('') || 3000`). Non solo il valore era inventato: non era
// nemmeno cancellabile. «Non lo so» non era esprimibile.
//
// Adesso il numero suggerito vive nel `placeholder` — dove si legge come proposta
// e non come dichiarazione — le tendine offrono «— non dichiarato —», e le
// coercizioni `intopt`/`floatopt`/`stropt` traducono il campo vuoto in NIENTE,
// con `updateN` che cancella la chiave invece di scriverci sopra.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

// I due file dove vivono le SPECIFICHE del device — cioè i campi che finiscono nel
// dossier, nel PDF e nel contesto dell'AI. È lì che un default inventato fa danno.
// (Fuori: `app-properties-node.js`, dove gli stessi `||` reggono la GEOMETRIA di ciò
// che si disegna — colore, larghezza, etichetta serigrafata — e i parametri con cui
// il TOOL si connette in SNMP: 161 non è una dichiarazione sull'apparato, è la porta
// che verrà interrogata.)
const PANNELLI = ['src/app-properties-node-devices.js', 'src/app-hypervisor.js'];

// STRUTTURALI, non dichiarazioni: un PDU con zero prese non esiste, e il conteggio
// genera le prese vere in `state.ports` (`normalizePduOutletCount` impone comunque
// un valore). Restano col default, e questo elenco è la dichiarazione del perché.
const STRUTTURALI = new Set(['pduEthernetPorts', 'pduSerialPorts', 'pduOutletCount', 'w', 'h']);

// Stessa ragione, sul lato tendine: la modalità di gestione del PDU crea e distrugge
// porte VERE in `state.ports` (`_cleanupPduNetworkPorts`), e `updateN` la normalizza
// comunque. «Nessuna» è già il neutro: non serve una via d'uscita in più.
const TENDINE_STRUTTURALI = new Set(['pduMgmtMode']);

function righe(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
}
/** Il letterale è «niente»? Vuoto e zero non affermano nulla: sono il neutro. */
const neutro = (v) => v === "''" || v === '""' || v === '0' || v === '0.0';

test('nessun campo device nasce con un valore inventato', () => {
    const colpe = [];
    for (const rel of PANNELLI) {
        righe(rel).forEach((ln, i) => {
            if (!/data-nfield=/.test(ln)) return;
            const nf = (ln.match(/data-nfield="([^"]+)"/) || [])[1];
            if (!nf || STRUTTURALI.has(nf)) return;
            const vm = ln.match(/value="\$\{([^"]*?)\}"/);
            if (!vm) return;
            const fb = vm[1].match(/(?:\|\||\?\?)\s*([^)]+)\)?\s*$/);
            if (!fb) return;
            const def = fb[1].trim().replace(/\)+$/, '');
            if (neutro(def)) return;
            colpe.push(rel + ':' + (i + 1) + '  ' + nf + ' = ' + def);
        });
    }
    assert.deepEqual(colpe, [],
        '\n' + colpe.length + ' campi si pre-compilano da soli. Il numero suggerito va nel ' +
        'placeholder e la coercizione diventa intopt/floatopt/stropt:\n' + colpe.join('\n'));
});

test('nessuna tendina device preseleziona un\'opzione inventata', () => {
    const colpe = [];
    for (const rel of PANNELLI) {
        righe(rel).forEach((ln, i) => {
            const m = ln.match(/selected\([^)]*?\|\|\s*'([^']+)'/);
            if (m) colpe.push(rel + ':' + (i + 1) + '  → \'' + m[1] + '\'');
        });
    }
    assert.deepEqual(colpe, [],
        '\n' + colpe.length + ' tendine scelgono al posto dell\'utente:\n' + colpe.join('\n'));
});

test('ogni tendina device offre «non dichiarato»', () => {
    // Togliere la preselezione senza offrire l'opzione vuota lascerebbe selezionato il
    // primo valore per conto del browser: la stessa invenzione, un gradino più in basso.
    //
    // ⚠️ Il riconoscimento del `<select>` NON si àncora alla fine riga: tre tendine
    // (`atsSourcePref`, `pduCurrentA`, `atsCurrentA`) portano altri attributi dopo
    // `data-nfield` ed erano sfuggite alla prima passata — trovate da questo test.
    const senza = [], interpolate = [];
    for (const rel of PANNELLI) {
        const rr = righe(rel);
        rr.forEach((ln, i) => {
            const m = ln.match(/<select data-change="update-n"[^>]*data-nfield="([^"]+)"[^>]*>/);
            if (!m || TENDINE_STRUTTURALI.has(m[1])) return;
            let corpo = ln.slice(ln.indexOf(m[0]) + m[0].length), j = i;
            while (!/<\/select>/.test(corpo) && ++j < rr.length) corpo += rr[j];
            const dove = rel + ':' + (i + 1) + '  ' + m[1];
            // Corpo costruito altrove (`${platOpts}`): qui non è giudicabile, e va
            // dichiarato invece di essere assolto in silenzio.
            if (/^\s*\$\{\w+\}\s*<\/select>/.test(corpo)) interpolate.push(m[1]);
            else if (!/<option value=""/.test(corpo)) senza.push(dove);
        });
    }
    assert.deepEqual(senza, [],
        '\n' + senza.length + ' tendine senza via d\'uscita:\n' + senza.join('\n'));
    assert.deepEqual(interpolate, ['hvPlatform'],
        'una tendina costruisce le opzioni fuori dal tag: va verificata a parte');
});

test('la piattaforma dell\'hypervisor non si deduce dal fatto che sia un homelab', () => {
    // Era `isLab ? 'proxmox' : 'esxi'`: una deduzione dal TIPO, non una lettura.
    const src = fs.readFileSync(path.join(ROOT, 'src/app-hypervisor.js'), 'utf8');
    assert.ok(src.indexOf('platDefault') < 0, 'la piattaforma di ripiego è tornata');
    assert.match(src, /platOpts = `<option value=""\$\{n\.hvPlatform \? '' : ' selected'\}/,
        'la lista deve aprirsi su «non dichiarato» quando nessuno l\'ha detto');
});

// ---- la prova a schermo -----------------------------------------------------
let APP;
test('carica l’app nel DOM finto', () => {
    APP = loadApp(ROOT);
    assert.ok(APP.files.length > 10);
});

/** Rende il pannello di un device del tipo dato, coi campi passati. */
function pannello(tipo, campi) {
    return JSON.parse(run(APP.ctx, '(() => { try {' +
        'state = _buildDefaultState(); if(typeof _migrateState==="function") _migrateState(state);' +
        '_propsExplicit = true;' +
        'state.nodes.push(Object.assign({id:"dz1",type:' + JSON.stringify(tipo) + ',name:"D-1",x:10,y:10},' +
        JSON.stringify(campi) + '));' +
        'if(typeof _invalidateIdx==="function") _invalidateIdx();' +
        'selType="node"; selId="dz1"; renderProps();' +
        'return JSON.stringify({ ok:true, html: document.getElementById("props-panel").innerHTML || "" });' +
        '} catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.message||e) }); } })()'));
}
/** Il valore che il campo `nf` mostra davvero (stringa vuota = non dichiarato). */
function valore(html, nf) {
    const tag = (html.match(new RegExp('<input[^>]*data-nfield="' + nf + '"[^>]*>')) || [])[0] || '';
    const m = tag.match(/value="([^"]*)"/);
    return m ? m[1] : null;
}

test('un proiettore mai compilato non dichiara 3000 lumen', () => {
    const r = pannello('projector', {});
    assert.ok(r.ok, 'il pannello lancia: ' + r.err);
    assert.equal(valore(r.html, 'lumens'), '', 'il campo mostra un valore che nessuno ha dichiarato');
    assert.match(r.html, /placeholder="3000"[^>]*data-nfield="lumens"/,
        'il 3000 resta come SUGGERIMENTO — sparire del tutto toglierebbe l\'ordine di grandezza');
});

test('…e uno compilato mostra il numero vero', () => {
    const r = pannello('projector', { spec: { lumens: 4200 } });
    assert.ok(r.ok, 'il pannello lancia: ' + r.err);
    assert.equal(valore(r.html, 'lumens'), '4200');
});

test('una telecamera appena posata non ha un\'ottica', () => {
    const r = pannello('webcam', {});
    assert.ok(r.ok, 'il pannello lancia: ' + r.err);
    assert.equal(valore(r.html, 'lens'), '', 'l\'ottica era «2.8mm / 110deg» per tutti');
    assert.equal(valore(r.html, 'installHeight'), '', 'l\'altezza era 2.8 m per tutti');
    assert.match(r.html, /<option value="" selected>— non dichiarato —<\/option>/,
        'il montaggio deve poter restare non dichiarato');
});

test('svuotare un campo lo CANCELLA, non ci riscrive il default', () => {
    const r = JSON.parse(run(APP.ctx, '(() => { try {' +
        'state = _buildDefaultState(); if(typeof _migrateState==="function") _migrateState(state);' +
        'state.nodes.push({id:"dz2",type:"projector",name:"P-1",x:0,y:0});' +
        'if(typeof _invalidateIdx==="function") _invalidateIdx();' +
        'selType="node"; selId="dz2";' +
        'updateN("lumens", 4200);' +
        'const scritto = (nodeById("dz2").spec||{}).lumens;' +
        'updateN("lumens", undefined);' +
        'const spec = nodeById("dz2").spec || {};' +
        'return JSON.stringify({ ok:true, scritto,' +
        ' restaLaChiave: Object.prototype.hasOwnProperty.call(spec,"lumens") });' +
        '} catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.message||e) }); } })()'));
    assert.ok(r.ok, 'updateN lancia: ' + r.err);
    assert.equal(r.scritto, 4200, 'la scrittura normale deve continuare a funzionare');
    assert.equal(r.restaLaChiave, false,
        'la chiave resta nel modello: un lettore che guarda hasOwnProperty vede una ' +
        'dichiarazione dove non c\'è');
});

test('la telecamera trascinata non si auto-specifica', () => {
    // Il seed alla creazione era l'invenzione PERSISTITA: finiva davvero nel JSON del
    // progetto, quindi anche nell'export, nel PDF e nel registro asset.
    const src = fs.readFileSync(path.join(ROOT, 'src/app-pointer.js'), 'utf8');
    const seed = (src.match(/if\(t==='webcam'\)\{[\s\S]*?\n\s*\}/) || [''])[0];
    assert.ok(seed, 'il ramo webcam non si trova più: aggiorna questo test');
    for (const inventato of ['2.8mm', 'installHeight', 'resolution', 'powerType', 'mountType']) {
        assert.ok(seed.indexOf(inventato) < 0,
            'la CAM appena posata si dichiara «' + inventato + '» da sola');
    }
    assert.match(seed, /installStatus\s*=\s*'planned'/,
        'una CAM trascinata è PIANIFICATA: quello sì, è l\'atto dell\'utente');
});
