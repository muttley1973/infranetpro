// ============================================================
// TOUCH — gesti a DUE DITA su mappa e rack                      [modulo ESM]
// ------------------------------------------------------------
// Il tocco a UN dito passa dai gestori dei Pointer Events di app-pointer.js, gli
// stessi del mouse: tap = selezione, trascinamento = sposta o panoramica. Qui c'e'
// solo cio' che un mouse non puo' fare: il PINCH (zoom + panoramica a due dita).
//
// Come si inserisce senza toccare il resto: un ascoltatore in fase di CATTURA su
// document vede ogni evento PRIMA dei gestori dell'app. Da un secondo dito in poi
// ferma l'evento (stopImmediatePropagation), cosi' l'app continua a pensare in
// termini di un puntatore solo e non deve sapere che esistono le dita.
//
//   • il PRIMO dito resta dell'app, finche' non entra un secondo dito;
//   • un secondo dito, se il gesto del primo non e' un trascinamento in corso,
//     FA DIVENTARE il gesto un pinch: la panoramica/trascinamento del primo viene
//     annullato (nessun apparato si sposta) e da li' in poi gli eventi non
//     arrivano piu' all'app;
//   • se il primo dito sta spostando un apparato o tirando un cavo, il secondo
//     dito viene ignorato: sarebbe uno sfioramento col palmo, non un intento;
//   • quando una delle due dita si alza il pinch finisce. Il dito rimasto da solo
//     non fa niente (il gesto che aveva era gia' stato annullato: la sua mossa
//     successiva non ha un gesto a cui arrivare), e se l'altro si riappoggia ne
//     comincia un NUOVO dal punto in cui si trova, senza salti.
//
// Vale solo se il primo dito e' atterrato sulla mappa o sul rack: altrove (pannelli
// che scorrono, finestre, bottoni) questo modulo non esiste.
// Solo puntatori di tipo 'touch': mouse e penna restano esattamente come prima.
// ============================================================
import { store } from './store.js';
import { markDirty } from './app-history.js';
import { pinchBegin, pinchApply, setTouchPinchActive } from './app-search-zoom-rack.js';
import { cancelTouchHold } from './app-pointer.js';

// Sotto questa distanza iniziale fra le dita il rapporto d/d0 e' un numero
// instabile (due dita quasi unite: un millimetro in piu' vale x10).
const MIN_PINCH_START_PX = 40;

const touches = new Map();   // pointerId → { x, y }: solo i puntatori 'touch' in contatto
let primary = null;          // id del primo dito (quello dell'app)
let primaryPane = null;      // 'floor' | 'rack' | null: dove e' atterrato il primo dito
let pinch = null;            // { a, b, snap, d0, m0, moved } mentre il pinch e' in corso
let raf = 0;

// Su quale "tela" sta questo elemento? I controlli sovrapposti alla mappa
// (zoom, barra vista, legenda) e l'intestazione del rack sono interfaccia, non tela.
function paneOf(el){
    if(!el || !el.closest) return null;
    if(el.closest('.zoom-controls, #map-view-bar, #topo-legend')) return null;
    if(el.closest('#floorplan')) return 'floor';
    if(el.closest('#rack-viewport') && !el.closest('.rack-header')) return 'rack';
    return null;
}

// Il primo dito aveva gia' avviato un gesto dell'app (panoramica, trascinamento
// non ancora "armato", maniglia di ridimensionamento): lo si chiude senza
// effetti. Sono gli stessi flag che handlePointerUp azzererebbe, ma senza il
// commit: la soglia di trascinamento non e' stata superata, quindi nulla si e' mosso.
function abortSingleFingerGesture(){
    store.isPanningFloor = false; store.isPanningRack = false;
    store.dragNode = null; store.dragRack = null; store.resizeNode = null;
    store._dragArmed = false; store._dragDownPt = null;
    cancelTouchHold();   // niente pressione lunga in attesa, niente apparato "sollevato" che resterebbe tale
    const fp = document.getElementById('floorplan'); if(fp) fp.style.cursor = '';
    const rv = document.getElementById('rack-viewport'); if(rv) rv.style.cursor = '';
}

function onDown(e){
    if(e.pointerType !== 'touch') return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if(touches.size === 1){
        primary = e.pointerId; primaryPane = paneOf(e.target);
        return;
    }
    if(!primaryPane) return;              // il primo dito era altrove: non e' affar nostro
    e.stopImmediatePropagation();         // da qui un secondo dito NON arriva mai all'app
    if(pinch || touches.size > 2) return;
    if(paneOf(e.target) !== primaryPane) return;
    // Il primo dito sta gia' spostando qualcosa (apparato, rack, cavo): il secondo
    // dito e' un tocco involontario, non l'inizio di un pinch.
    if(store._dragArmed || store.linkStart) return;

    if(primaryPane === 'rack') document.body.classList.add('rack-panning');   // niente transition .1s: il rect deve essere quello vero
    const snap = pinchBegin(primaryPane);
    if(!snap){ document.body.classList.remove('rack-panning'); return; }
    // L'altro dito a contatto: di norma il primo, ma se quello si era alzato e questo
    // e' il terzo arrivato, e' quello che e' rimasto.
    const other = [...touches.keys()].find((k) => k !== e.pointerId);
    const A = touches.get(other), B = touches.get(e.pointerId);
    if(!A || !B){ document.body.classList.remove('rack-panning'); return; }
    abortSingleFingerGesture();
    pinch = {
        a: other, b: e.pointerId, snap, moved: false,
        d0: Math.max(MIN_PINCH_START_PX, Math.hypot(A.x - B.x, A.y - B.y)),
        m0: { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 },
    };
    setTouchPinchActive(true);
}

function apply(){
    raf = 0;
    if(!pinch) return;
    const A = touches.get(pinch.a), B = touches.get(pinch.b);
    if(!A || !B) return;
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    pinchApply(pinch.snap, Math.hypot(A.x - B.x, A.y - B.y) / pinch.d0, pinch.m0.x, pinch.m0.y, mx, my);
    pinch.moved = true;
}

function onMove(e){
    if(e.pointerType !== 'touch') return;
    const p = touches.get(e.pointerId);
    if(!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if(pinch || (primaryPane && e.pointerId !== primary)){
        e.stopImmediatePropagation();
        // Un frame, una applicazione: due dita mandano due pointermove per frame.
        if(pinch && (e.pointerId === pinch.a || e.pointerId === pinch.b) && !raf) raf = requestAnimationFrame(apply);
    }
}

function endPinch(){
    if(raf){ cancelAnimationFrame(raf); raf = 0; apply(); }   // l'ultima posizione, prima che un dito sparisca dalla mappa
    // Il pan/zoom fa parte del progetto (state.floorView / rackView): un pinch vero
    // e' una modifica, due dita appoggiate e alzate no (stessa regola dei pan).
    if(pinch.moved) markDirty();
    if(pinch.snap.pane === 'rack') document.body.classList.remove('rack-panning');
    pinch = null;
    setTouchPinchActive(false);
}

function onUp(e){
    if(e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
    let swallow = false;
    if(pinch){
        swallow = true;
        if(e.pointerId === pinch.a || e.pointerId === pinch.b) endPinch();
    } else if(primaryPane && e.pointerId !== primary){
        swallow = true;
    }
    touches.delete(e.pointerId);
    if(e.pointerId === primary) primary = null;
    if(touches.size === 0){ primary = null; primaryPane = null; }
    if(swallow) e.stopImmediatePropagation();
}

// Se la pagina sparisce con le dita giu' (chiamata, cambio app) il rilascio puo' non
// arrivare mai: senza questo, un registro di dita fantasma bloccherebbe il primo
// tocco del giro dopo.
function reset(){
    if(pinch) endPinch();
    touches.clear(); primary = null; primaryPane = null;
}

// ⚠️ Su `document` e non su `window`: la fase di cattura di `document` viene PRIMA di
// ogni elemento e di tutta la fase di bolla, dove stanno i gestori dell'app (window),
// quindi fermare l'evento qui basta. E i test "smoke" caricano il bundle in node:vm con
// un DOM finto che un `document.addEventListener` ce l'ha e un `window.addEventListener`
// no: un listener di window registrato a livello di modulo farebbe cadere la suite intera.
document.addEventListener('pointerdown',   onDown, true);
document.addEventListener('pointermove',   onMove, true);
document.addEventListener('pointerup',     onUp,   true);
document.addEventListener('pointercancel', onUp,   true);
document.addEventListener('visibilitychange', () => { if(document.hidden) reset(); });
