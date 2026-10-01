// ============================================================
// PANNELLO PROPRIETA: tab destra + valore manuale nelle select  [modulo ESM, ex app.js]
// Split app.js #5 (ultimo). switchRightTab/_activatePropsTab/_clearPropsTab governano
// le tab del pannello destro; _enableManualValueInProps (+ resolver) aggiunge
// la voce «Personalizzato...» alle select rileggendo il valore dal modello.
// _propsTabHold/_rightTab/selId/... sono window-globals (proxy store), letti/scritti bare.
// ============================================================
import { expose, t } from "./_bridge.js";
import { store } from "./store.js";
import { nodeById, renderCables } from "./app.js";   // cicli benigni: uso solo a runtime
import { renderProps } from "./app-properties.js";
// Bare globals (no-undef OFF): _propsTabHold/_rightTab/_propsExplicit/selId/selType/state
// (proxy store) - _cancelLink/_aiPanelOpen/_updateFloorToolbarVisibility/showPrompt (window,
// altri moduli) - console.

export function switchRightTab(tab){
    _propsTabHold = null;   // cambio tab esplicito → decade l'hold di selectPathSegment
    _rightTab = tab;
    // Cambiare tab verso Proprieta'/Assistente ABBANDONA un cavo in corso: la
    // rubber-band del link-mode (#temp-link) non deve restare come linea fantasma
    // sulla tela. Verso 'rack' il link-mode SOPRAVVIVE di proposito (serve per
    // completare i cavi floor->rack / cross-rack raggiungendo le porte del rack).
    if(tab !== 'rack' && store.linkStart && typeof _cancelLink === 'function') _cancelLink();
    const tabRack = document.getElementById('tab-rack');
    const tabProps = document.getElementById('tab-props');
    const tabAi = document.getElementById('tab-ai');   // 3ª tab «Assistente» (può mancare in HTML vecchio)
    tabRack.classList.toggle('active', tab==='rack');
    tabProps.classList.toggle('active', tab==='props');
    if(tabAi) tabAi.classList.toggle('active', tab==='ai');
    // a11y: role="tab" → aria-selected segue lo stato visivo.
    tabRack.setAttribute('aria-selected', String(tab==='rack'));
    tabProps.setAttribute('aria-selected', String(tab==='props'));
    if(tabAi) tabAi.setAttribute('aria-selected', String(tab==='ai'));
    document.getElementById('rack-viewport').style.display = tab==='rack' ? '' : 'none';
    // Il layer cavi (#cable-overlay, z-index 60) sta SOPRA il pannello destro
    // (#rack-view, 50) di proposito: sulla tab Rack i cavi cross-rack devono
    // poter raggiungere le porte del rack. Ma su Proprieta'/Assistente nessun
    // cavo deve finire sul pannello → lo alziamo sopra l'overlay, cosi' la
    // rubber-band del link-mode (che segue il cursore) non ci si disegna sopra.
    document.getElementById('rack-view').classList.toggle('rv-above-cables', tab !== 'rack');
    const pw = document.getElementById('props-panel-wrap');
    pw.classList.toggle('active', tab==='props');
    const aw = document.getElementById('ai-panel-wrap');
    if(aw) aw.classList.toggle('active', tab==='ai');
    // Tab Assistente: carica config + sincronizza empty-state/chat (glue app-ai.js,
    // bundle → chiamata bare con guardia typeof; no win.* sul ratchet).
    if(tab === 'ai' && typeof _aiPanelOpen === 'function') _aiPanelOpen();
    _updateFloorToolbarVisibility();
    renderCables();
    // INT-4: chi switcha a 'props' deve sempre vedere il pannello popolato.
    // INT-5: switchRightTab('props') = intent esplicito "voglio vedere".
    if(tab === 'props'){
        _propsExplicit = true;
        if(typeof renderProps === 'function') renderProps();
    }
}

// Hold legato alla SELEZIONE (non a tempo): selectPathSegment lo imposta al
// linkId del segmento quando l'utente sceglie un tratto che tocca una porta
// rack e l'app apre la tab Rack. Finche' QUEL link resta selezionato, i render
// (che richiamano sempre renderProps→_activatePropsTab) non devono ri-forzare
// 'props' — altrimenti la tab Rack si chiuderebbe da sola al primo re-render.
// L'hold decade da solo: cambio selezione (selId diverso) o switch tab
// esplicito (switchRightTab lo azzera).
store._propsTabHold = null;   // var: scritto da app-popup (selectPathSegment) e dal bundle render-core via win.*; bare-letto dai classic
export function _activatePropsTab(_label){
    if(_propsTabHold && selType === 'link' && selId === _propsTabHold) return;
    _propsTabHold = null;   // selezione cambiata → l'hold decade
    if(_rightTab !== 'props') switchRightTab('props');
}

export function _clearPropsTab(){
}

// Legge il valore corrente di un campo manuale dato un RIFERIMENTO esplicito
// (kind + nodeId + field), senza parsare codice. È il percorso robusto usato
// quando la select porta data-mkind/data-mnode/data-mfield; rispecchia i 4
// pattern storici (node.spec/node · integration · port · link).
function _readManualByRef(kind, nodeId, field){
    if(!kind || !field) return undefined;
    if(kind === 'node'){
        const n = nodeById(nodeId || selId);
        return n ? ((n.spec && n.spec[field] !== undefined) ? n.spec[field] : n[field]) : undefined;
    }
    if(kind === 'integration'){ const n = nodeById(nodeId); return n?.integration?.[field]; }
    // Una VM non e' un nodo: vive in host.vms[]. Il riferimento e' "<hostId>:<vmId>"
    // perche' servono entrambi per raggiungerla.
    if(kind === 'vm'){
        const [hostId, vmId] = String(nodeId || '').split(':');
        const h = nodeById(hostId);
        const vm = (h && Array.isArray(h.vms)) ? h.vms.find(v => v && v.id === vmId) : null;
        return vm ? vm[field] : undefined;
    }
    if(kind === 'port'){ return state.ports?.[nodeId]?.[field]; }
    if(kind === 'link'){ const l = (state.links || []).find(x=>x.id===nodeId); return l ? l[field] : undefined; }
    return undefined;
}

function _resolveManualPropValue(sel){
    try{
        // Percorso per RIFERIMENTO: se la select dichiara data-mkind/-mnode/-mfield,
        // si risolve da quelli — nessun parsing di codice, nessun accoppiamento alla
        // firma di un handler. E' il percorso dei builder nuovi (le VM).
        if(sel.dataset && sel.dataset.mkind){
            const v = _readManualByRef(sel.dataset.mkind, sel.dataset.mnode, sel.dataset.mfield);
            if(v !== undefined && v !== null) return String(v);
        }
        // Select a event-delegation (`data-change="update-n" data-nfield=…`): senza questo
        // il resolver tornerebbe il default (`sel.value`) al re-render, PERDENDO il valore
        // custom appena salvato: la select ricade sul default (bug fba8d48). Si rilegge dal
        // modello con la STESSA regola spec/`n[key]` di updateN.
        //
        // ⚠️ Prima c'era un terzo ramo, che leggeva col regex il SORGENTE dell'`onchange`
        // inline (`updateN\('([^']+)'…`) per risalire al campo. Era codice MORTO: nessuna
        // select di src/ ha piu' un `onchange` (sono tutte `data-change`), quindi `oc` era
        // sempre la stringa vuota e nessun pattern combaciava. Era il compagno di un
        // `new Function` (anch'esso tolto) che rieseguiva quel testo, ed e' quello che teneva
        // in piedi il permesso `'unsafe-eval'` della CSP. Un campo nuovo dichiara da dove si
        // rilegge (`data-change` o `data-mkind`): niente da indovinare.
        if(sel.dataset && sel.dataset.change === 'update-n' && sel.dataset.nfield){
            const n = nodeById(selId);
            const key = sel.dataset.nfield;
            const v = n ? ((n.spec && n.spec[key] !== undefined && n.spec[key] !== null) ? n.spec[key] : n[key]) : undefined;
            if(v !== undefined && v !== null) return String(v);
        }
    }catch(_){}
    return String(sel.value ?? '');
}

export function _enableManualValueInProps(panel){
    if(!panel) return;
    const selects = [...panel.querySelectorAll('select')];
    selects.forEach(sel=>{
        if(sel.multiple) return;
        if(sel.dataset.noManual === '1') return;
        if(sel.dataset.manualEnhanced === '1') return;
        sel.dataset.manualEnhanced = '1';

        const customToken = '__custom_manual__';
        let customOpt = [...sel.options].find(o=>o.value===customToken);
        if(!customOpt){
            customOpt = document.createElement('option');
            customOpt.value = customToken;
            customOpt.textContent = (typeof t==='function') ? t('common.custom') : 'Personalizzato...';
            sel.appendChild(customOpt);
        }

        const fromState = _resolveManualPropValue(sel).trim();
        if(fromState && fromState !== customToken){
            let existing = [...sel.options].find(o=>o.value===fromState);
            if(!existing){
                existing = document.createElement('option');
                existing.value = fromState;
                existing.textContent = fromState;
                existing.dataset.custom = '1';
                sel.insertBefore(existing, customOpt);
            }
            sel.value = fromState;
            sel.dataset.prevValue = fromState;
        } else {
            sel.dataset.prevValue = sel.value || '';
        }

        sel.addEventListener('focus',()=>{ sel.dataset.prevValue = sel.value || ''; });
        sel.addEventListener('change',()=>{
            if(sel.value !== customToken){
                sel.dataset.prevValue = sel.value || '';
                return;
            }
            const prev = sel.dataset.prevValue || '';
            showPrompt('Inserisci valore personalizzato', prev, (val)=>{
                const manual = String(val || '').trim();
                if(!manual){ sel.value = prev; return; }
                let opt = [...sel.options].find(o=>o.value===manual);
                if(!opt){
                    opt = document.createElement('option');
                    opt.value = manual;
                    opt.textContent = manual;
                    opt.dataset.custom = '1';
                    sel.insertBefore(opt, customOpt);
                }
                sel.value = manual;
                sel.dataset.prevValue = manual;
                // L'assegnazione programmatica di .value NON emette 'change', quindi il
                // valore custom non arriverebbe mai al modello. Si emette l'evento vero,
                // che risale al listener delegato (data-change).
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            }, ()=>{
                sel.value = prev;
            });
        });
    });
}

// Superficie window: i 6 erano nell expose() di app.js; `_runInlineOnChange` e' uscito
// con il `new Function` che lo reggeva.
expose({ switchRightTab, _activatePropsTab, _clearPropsTab, _enableManualValueInProps,
         _resolveManualPropValue });
