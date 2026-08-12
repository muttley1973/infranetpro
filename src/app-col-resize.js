// ============================================================
// COLONNE RIDIMENSIONABILI — collegamento fra tabella e regole pure
// ============================================================
// Le REGOLE (limiti, larghezza risultante da un trascinamento, forma del dato
// salvato) stanno in lib/col-widths.js e sono testate senza browser. Qui c'è
// solo ciò che tocca il DOM: la maniglia, il trascinamento, la persistenza.
//
// Come funziona la larghezza: ogni colonna ridimensionabile ha una VARIABILE CSS
// sulla tabella (`--<prefisso>-<n>`), e il CSS la legge con un default. Così il
// trascinamento scrive una proprietà sola e, finché nessuno trascina, l'aspetto
// resta esattamente quello di prima.
//
// ⚠️ Una colonna resta ELASTICA (nessuna larghezza, nessuna maniglia): assorbe lo
// spazio che avanza. Senza, quando la finestra è più larga della somma delle
// colonne lo spazio verrebbe spalmato su tutte e la tabella «ballerebbe» a ogni
// trascinamento. Nella tabella Scopri l'elastica è NOME, quella con i badge.
//
// Lo scorrimento orizzontale non è un pezzo separato: nasce dalla larghezza
// MINIMA della tabella. Quando la somma delle colonne supera il contenitore, il
// wrap (che ha già `overflow:auto`) si mette a scorrere da solo.
import { clampColWidth, resizedWidth, colVarName, tableMinWidth, parseColWidths, serializeColWidths } from '../lib/col-widths.js';

const _DONE = 'colResizeReady';

function _readStored(key) {
    if (!key) return {};
    try { return parseColWidths(localStorage.getItem(key)); }
    catch (_) { return {}; }   // storage negato: pazienza, si usano i default
}
function _writeStored(key, widths) {
    if (!key) return;
    try { localStorage.setItem(key, serializeColWidths(widths)); }
    catch (_) { /* storage negato: pazienza */ }
}

/**
 * Rende trascinabili le colonne di una tabella.
 *   table        elemento <table> con un <thead><tr> di <th>
 *   opts.defaults  { indice 1-based → px } delle colonne a larghezza fissa
 *   opts.elastic   indice della colonna che assorbe lo spazio (niente maniglia)
 *   opts.skip      indici da non rendere trascinabili (es. la colonna spunta)
 *   opts.varPrefix prefisso delle variabili CSS (deve combaciare col CSS)
 *   opts.storageKey chiave localStorage; assente = larghezze non ricordate
 *   opts.label     testo del `title` della maniglia (già tradotto)
 * Idempotente: richiamarla su una tabella già preparata non raddoppia le maniglie.
 */
export function enableColumnResize(table, opts) {
    if (!table || table.dataset[_DONE] === '1') return;
    opts = opts || {};
    const defaults = opts.defaults || {};
    const prefix = opts.varPrefix || 'col';
    const skip = new Set([].concat(opts.skip || [], opts.elastic != null ? [opts.elastic] : []).map(Number));
    const ths = table.tHead ? Array.from(table.tHead.rows[0] ? table.tHead.rows[0].cells : []) : [];
    if (!ths.length) return;

    const widths = _readStored(opts.storageKey);

    // ⚠️ L'idempotenza non si regge SOLO sul marcatore: se un domani il `<thead>`
    // venisse ridisegnato, o qualcuno rientrasse qui con il marcatore perso, le
    // maniglie si sommerebbero (due strisce sovrapposte, la seconda che vince).
    // Ripulire prima di aggiungere costa niente e toglie la classe di bug.
    // Rimuovere l'elemento porta via anche i suoi ascoltatori.
    for (const th of ths) for (const old of th.querySelectorAll('.col-resizer')) old.remove();

    const applyAll = () => {
        for (const k of Object.keys(defaults)) {
            const px = widths[k];
            if (px != null) table.style.setProperty(colVarName(k, prefix), px + 'px');
            else table.style.removeProperty(colVarName(k, prefix));
        }
        table.style.minWidth = tableMinWidth(defaults, widths, opts.elasticFloor) + 'px';
    };
    applyAll();

    ths.forEach((th, i) => {
        const idx = i + 1;                       // 1-based: lo stesso indice di nth-child
        if (skip.has(idx) || defaults[idx] == null) return;
        const grip = document.createElement('span');
        grip.className = 'col-resizer';
        grip.setAttribute('role', 'separator');
        grip.setAttribute('aria-orientation', 'vertical');
        if (opts.label) grip.title = opts.label;
        th.appendChild(grip);
        th.classList.add('col-resizable');

        let startX = 0, startW = 0;
        const onMove = (ev) => {
            widths[idx] = resizedWidth(startW, ev.clientX - startX);
            applyAll();
        };
        const onUp = (ev) => {
            grip.classList.remove('dragging');
            try { grip.releasePointerCapture(ev.pointerId); } catch (_) { /* già rilasciato */ }
            grip.removeEventListener('pointermove', onMove);
            grip.removeEventListener('pointerup', onUp);
            grip.removeEventListener('pointercancel', onUp);
            _writeStored(opts.storageKey, widths);   // si salva a trascinamento FINITO, non a ogni pixel
        };
        grip.addEventListener('pointerdown', (ev) => {
            // Solo tasto principale, e mai propagando: il click sull'intestazione
            // non deve diventare un click sulla tabella.
            if (ev.button !== 0) return;
            ev.preventDefault(); ev.stopPropagation();
            startX = ev.clientX;
            startW = clampColWidth(th.getBoundingClientRect().width);
            grip.classList.add('dragging');
            try { grip.setPointerCapture(ev.pointerId); } catch (_) { /* niente cattura: il drag funziona lo stesso */ }
            grip.addEventListener('pointermove', onMove);
            grip.addEventListener('pointerup', onUp);
            grip.addEventListener('pointercancel', onUp);
        });
        // Doppio clic sulla maniglia = torna al default di quella colonna.
        grip.addEventListener('dblclick', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            delete widths[idx];
            applyAll();
            _writeStored(opts.storageKey, widths);
        });
    });

    table.dataset[_DONE] = '1';
}
