// ============================================================
// CAVI — etichette, promozione a manuale, setter link  [modulo ESM, estratto da app.js]
// Split app.js #2 (Region A ETICHETTE CAVI). renderCables resta in app.js (renderer
// intrecciato con le view-state del floor/rack). expose() preserva la superficie window;
// i 9 export ESM restano raggiungibili da ./app.js (re-export), consumatori invariati.
// ============================================================
import { expose, t } from "./_bridge.js";
import { TYPES } from "./app-types.js";
import { renderAll } from "./app-render-core.js";
import { renderProps } from "./app-properties.js";
import { markDirty, pushHistory, getNodeByPortId, getNodeDisplayName, renderCables, _showToast } from "./app.js";   // cicli benigni: uso solo a runtime
import { parseRadioPid, radioLabelForPid } from "../lib/radio.js";   // il nome di una radio sta sul modello, non nel pid
// Bare globals (no-undef OFF): state - panelNumberOffset/panelChainReaches (lib/frontpanel.js) -
// abbreviateName (lib/abbrev.js) - _normalizeLinkMetadata (lib/link-model.js).

/**
 * Genera l'etichetta automatica di un cavo dagli endpoint.
 * Formato: "NomeSrc Pn → NomeDst Pn"
 * Non viene salvata nel progetto — si ricalcola sempre dagli endpoint,
 * così segue automaticamente i rinomina dei nodi.
 */
// Offset di numerazione progressiva di un patch panel (catena ppContinueFrom /
// startNum manuale). Ricostruisce i record dai patch panel del progetto e delega
// all'helper puro panelNumberOffset (lib/frontpanel.js). 0 = indipendente (1..N).
export function _patchPanelOffset(node){
    if(!node || node.type!=='patchpanel' || typeof panelNumberOffset!=='function') return 0;
    const recs={};
    for(const n of state.nodes){
        if(n.type!=='patchpanel') continue;
        const fp=n.frontPanel||{};
        recs[n.id]={
            ports: (n.ports!==undefined ? n.ports : (TYPES.patchpanel?.ports||0)),
            continueFrom: fp.ppContinueFrom||'',
            startNum: fp.ppStartNum,
        };
    }
    return panelNumberOffset(node.id, recs);
}
// Patch panel selezionabili come "continua da" per `node`: tutti gli altri patch
// panel che NON sono a valle di node nella catena (selezionarli creerebbe un
// ciclo). Usa panelChainReaches (lib/frontpanel.js).
export function _patchPanelChainOptions(node){
    if(!node) return [];
    const recs={};
    for(const n of state.nodes){
        if(n.type!=='patchpanel') continue;
        recs[n.id]={ continueFrom:(n.frontPanel||{}).ppContinueFrom||'' };
    }
    const out=[];
    for(const n of state.nodes){
        if(n.type!=='patchpanel' || n.id===node.id) continue;
        if(typeof panelChainReaches==='function' && panelChainReaches(n.id, node.id, recs)) continue;
        out.push(n);
    }
    return out;
}
// Numero di porta da mostrare in etichetta: applica l'offset progressivo solo ai
// patch panel (porte dati numeriche); ogni altro device resta invariato.
function _portNumForLabel(node, portNumStr){
    if(node && node.type==='patchpanel'){
        const num=parseInt(portNumStr,10);
        if(Number.isFinite(num) && String(num)===String(portNumStr)) return String(num + _patchPanelOffset(node));
    }
    return portNumStr;
}
// Nome per il DISPLAY: abbreviato se il toggle "Nomi abbreviati" e' attivo
// (scope: planimetria + etichette cavi). SOLO display — non muta n.name.
export function _dispName(name){
    return (state && state.abbrevNames && typeof abbreviateName==='function')
        ? abbreviateName(name) : (name==null ? '' : String(name));
}
// Toggle "Nomi abbreviati" (planimetria + etichette cavi). Solo display.
// ASSE B: export per la registrazione delegata nel pannello FLOOR (ex onchange inline).
export function toggleAbbrevNames(on){
    state.abbrevNames = !!on;
    markDirty();
    renderAll();
}

// Il pezzo «presa» dell'etichetta. Una porta numerica resta `P24`; una RADIO ha
// un nome proprio (scritto a mano o importato dal DCIM) e si stampa quello, senza
// la "P" che è la convenzione delle porte fisiche. Il nome lo risolve
// `radioLabelForPid` (lib/radio.js): qui il pid non si taglia a fette.
function _portTagForLabel(node, pid){
    const suffix = String(pid).split('-').slice(1).join('-');
    if(parseRadioPid(pid)) return radioLabelForPid(node, pid) || suffix;
    return `P${_portNumForLabel(node, suffix)}`;
}

export function _cableAutoLabel(l){
    const sn=getNodeByPortId(l.src), dn=getNodeByPortId(l.dst);
    return `${_dispName(sn ? getNodeDisplayName(sn) : l.src)} ${_portTagForLabel(sn, l.src)} → ${_dispName(dn ? getNodeDisplayName(dn) : l.dst)} ${_portTagForLabel(dn, l.dst)}`;
}

export function _promoteLinkToManual(link){
    if(!link?.autoLinked) return false;
    delete link.autoLinked;
    delete link.confidence;
    delete link.protocol;
    return true;
}

export function promoteLinkToManual(id){
    const l=state.links.find(x=>x.id===id); if(!l) return;
    if(!l.autoLinked) return;
    pushHistory();
    _promoteLinkToManual(l);
    markDirty();
    renderAll();
    renderCables();
    renderProps();
    _showToast(t('msg.ui.linkConfirmedManual'), 'ok', 2500);
}

/** Imposta o cancella l'etichetta manuale di un cavo. */
export function setCableLabel(id, val){
    const l=state.links.find(x=>x.id===id); if(!l) return;
    const v=val.trim();
    const nextLabel = v || undefined;
    if((l.label||undefined)===nextLabel && !l.autoLinked) return;
    pushHistory();
    _promoteLinkToManual(l);
    if(v) l.label=v; else delete l.label;
    markDirty();
    renderProps();
}

/**
 * Setter generico per le proprietà fisiche/documentali di un cavo.
 * Chiave vuota o stringa vuota → rimuove la proprietà dal JSON.
 * Chiama renderProps() per aggiornare i campi dinamici (es. categoria
 * cambia in base al mezzo scelto).
 */
export function setLinkProp(id, key, val){
    const l=state.links.find(x=>x.id===id); if(!l) return;
    let v=typeof val==='string'?val.trim():val;
    if(key==='isPermanent') v = (v==='permanent') ? true : (v==='patch') ? false : null;
    if(key==='installedAt' || key==='installedBy') v = typeof v==='string' ? v.trim() : v;
    const same = (v===''||v===null||v===undefined)
        ? !(key in l) && !l.autoLinked
        : l[key]===v && !l.autoLinked;
    if(same) return;
    pushHistory();
    _promoteLinkToManual(l);
    if(v===''||v===null||v===undefined) {
        delete l[key];
        if(key==='length') delete l.lengthM;
        if(key==='colorOvr') delete l.color;
    } else {
        l[key]=v;
        if(key==='length') l.lengthM = v;
        if(key==='colorOvr') l.color = v;
    }
    _normalizeLinkMetadata(l);
    markDirty();
    renderProps();
}

// Collegamento wireless (link.wireless): reso "a onda" e fuori dalla validazione
// cavo fisico. Setter dedicato perche' la GEOMETRIA cambia (serve renderCables,
// che setLinkProp non chiama).
function setLinkWireless(id, on){
    const l=state.links.find(x=>x.id===id); if(!l) return;
    const want=!!on;
    if(!!l.wireless===want) return;
    pushHistory();
    if(want) l.wireless=true; else delete l.wireless;
    markDirty(); renderAll(); renderCables(); renderProps();
}

// Superficie window invariata: gli 11 erano nell expose() di app.js.
expose({ _patchPanelOffset, _patchPanelChainOptions, _portNumForLabel, _dispName, toggleAbbrevNames,
         _cableAutoLabel, _promoteLinkToManual, promoteLinkToManual, setCableLabel, setLinkProp, setLinkWireless });
