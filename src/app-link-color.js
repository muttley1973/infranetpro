// ============================================================
// COLORE DEL CAVO — l'UNICO posto dove si decide            [modulo ESM]
// ============================================================
// La decisione pura sta in lib/link-vlan-color.js («che VLAN SERVE questo
// cavo»); qui si raccolgono le letture di stato che le servono e si traduce
// l'esito in un colore. Prima questa stessa domanda aveva OTTO risposte sparse
// (app.js ×3, topo-lines ×2, export.js ×2, il picker delle Proprieta') e gia'
// divergevano: la topologia usava la «VLAN dominante», il rack la nativa. E' la
// classe di bug piu' ricorrente del progetto — chi aggiunge una vista NON
// riscriva la regola: chiami `_linkColor`.
//
// Tre indici si ricostruiscono da soli a ogni passata di `propagateVlans()`
// (che gira prima di ogni render e dopo ogni modifica che tocca le VLAN):
//   sotto-interfacce per porta genitore · cavi per nodo · VLAN dell'IP per nodo.
// ============================================================
import { expose, t } from './_bridge.js';
import { store } from './store.js';
import { isVlanAware } from './app-types.js';   // «classifica le VLAN?» ha UNA definizione, non tre
import { nodeById, getNodeByPortId, getPortNodeId } from './app.js';
import { _getLinkVlan } from './app-popup.js';
import { _getLinkTrunk, _siteNativeVlan } from './app-vlan-autopoll.js';
import { prefixForIp } from '../lib/ipam-model.js';
import { linkPaintVlan } from '../lib/link-vlan-color.js';   // la DECISIONE pura: solo questo modulo la usa → import ESM, non <script>

// Il neutro dei cavi SENZA un colore VLAN. Restano DUE stati, e sono entrambi
// affermazioni precise, non ignoranza: un trunk multi-VLAN (nessuna prevale) e un
// collegamento instradato (non sta in nessuna VLAN, nemmeno nella 1). Un cavo che
// COMMUTA ha sempre un colore: dove nessuno ha assegnato una VLAN vale la nativa
// di sito, perche' e' li' che ogni bridge mette cio' che non e' stato assegnato.
// NON e' il grigio della VLAN 1 (`vlanColors[1]`, che l'utente puo' cambiare):
// «nessuna VLAN» e «VLAN 1» sono due cose diverse e non devono somigliarsi.
// Grigio neutro dei cavi senza VLAN (trunk multi-VLAN, instradato). Tenuto un
// gradino piu' CHIARO del grigio delle porte inattive (--inactive-color): un
// cavo che passa SOPRA una porta a riposo deve restare visibile, non
// confondersi con lei. Diverso anche dal grigio della VLAN 1.
export const CABLE_NEUTRAL = '#a6aab1';

let _subIfIdx = null;    // parentPid → number[] VLAN delle sotto-interfacce
let _cableCnt = null;    // nodeId    → quanti cavi tocca il nodo
let _ipVlan   = null;    // nodeId    → VLAN del prefisso dichiarato che contiene il suo IP

/** Le tre cache si rifanno alla prossima lettura. Chiamata da propagateVlans(). */
export function _invalidateLinkColor() { _subIfIdx = null; _cableCnt = null; _ipVlan = null; }

// Le sotto-interfacce dot1Q (`logical:true`, con `parentPid`) sono la prova piu'
// diretta che esista: dichiarano una VLAN E la porta fisica su cui viaggia. Le
// portiamo nel modello dalla 2.10.1; nessuno le leggeva per il colore.
function _subIfs() {
    if (_subIfIdx) return _subIfIdx;
    _subIfIdx = Object.create(null);
    const ports = store.state.ports || {};
    for (const pid in ports) {
        const p = ports[pid];
        if (!p || !p.logical || !p.parentPid) continue;
        const v = parseInt(p.vlanOvr ?? p.vlan, 10);
        if (!(v >= 1 && v <= 4094)) continue;
        (_subIfIdx[p.parentPid] ??= []).push(v);
    }
    return _subIfIdx;
}

// Quanti cavi tocca un nodo. Serve a una sola domanda: l'IP di gestione di
// questo apparato parla di QUESTO cavo? Solo se il cavo e' l'unico che ha.
function _cables() {
    if (_cableCnt) return _cableCnt;
    _cableCnt = Object.create(null);
    for (const l of (store.state.links || [])) {
        const a = getPortNodeId(l.src), b = getPortNodeId(l.dst);
        if (a) _cableCnt[a] = (_cableCnt[a] || 0) + 1;
        if (b && b !== a) _cableCnt[b] = (_cableCnt[b] || 0) + 1;
    }
    return _cableCnt;
}

// VLAN DICHIARATA dall'utente per l'indirizzo di un apparato: il prefisso che lo
// contiene (piu' specifico vince, `lib/ipam-model.js`) e la VLAN che quel
// prefisso dichiara. Declare-first: se le reti non sono dichiarate resta muta —
// non si deduce una VLAN dai primi tre ottetti.
function _vlanOfNodeIp(nid) {
    if (!nid) return undefined;
    if (!_ipVlan) _ipVlan = Object.create(null);
    if (nid in _ipVlan) return _ipVlan[nid];
    const n = nodeById(nid);
    const px = (n && n.ip) ? prefixForIp(store.state, n.ip) : null;
    const v = (px && px.vlan != null) ? parseInt(px.vlan, 10) : undefined;
    _ipVlan[nid] = (v >= 1 && v <= 4094) ? v : undefined;
    return _ipVlan[nid];
}
function _end(pid) {
    const pi = store.state.ports[pid] || {};
    const nid = getPortNodeId(pid);
    const node = getNodeByPortId(pid);
    return {
        // «Classifica le VLAN?», non «e' di tipo attivo»: uno switch dichiarato NON
        // GESTITO commuta sul MAC e le VLAN non le conosce — il frame lo attraversa.
        active: isVlanAware(node),
        // Il mondo VLAN MISURATO dell'apparato (PVID+egress+trunk): decide se la
        // sua parola sulla VLAN vale. Chi conosce solo la 1 non sta commutando.
        deviceVlans: node?.integration?.vlans || [],
        ownsIp: !!pi.ownsIp,
        bridges: pi.bridges,
        // La MODALITA' dichiarata a mano, terzo valore accanto a access/trunk: la
        // porta e' un'interfaccia L3 e non sta in nessuna VLAN. E' una dichiarazione,
        // non una misura — per questo viaggia in un campo dal nome diverso da
        // `ownsIp`/`bridges`, che sono cio' che l'apparato ha risposto.
        declaredRouted: pi.mode === 'routed',
        vlanOvr: pi.vlanOvr,
        vlan: pi.vlan,
        vlanProp: pi.vlanProp,
        subIfVlans: _subIfs()[pid] || [],
        endpointVlan: _vlanOfNodeIp(nid),
        singleHomed: _cables()[nid] === 1,
    };
}

/**
 * Che cosa rappresenta questo cavo, e perche'.
 * @param {any} l link
 * @returns {{vlan:number|null, kind:string, source:string, known:boolean, vlans:number[]}}
 */
export function _linkPaintVlan(l) {
    if (!l) return { vlan: null, kind: 'undeclared', source: 'undeclared', known: false, vlans: [] };
    const tk = (typeof _getLinkTrunk === 'function') ? _getLinkTrunk(l) : null;
    return linkPaintVlan({
        mode: tk ? tk.mode : (l.mode === 'trunk' ? 'trunk' : 'access'),
        native: (typeof _getLinkVlan === 'function') ? _getLinkVlan(l) : undefined,
        // Il pavimento: la VLAN in cui finisce cio' che nessuno ha assegnato. 1 di
        // default — quella che esiste sempre e non si cancella — o quella che la
        // sede ha dichiarato, per chi lavora con la nativa spostata.
        siteNative: (typeof _siteNativeVlan === 'function') ? _siteNativeVlan() : 1,
        vlans: tk ? tk.vlans : [],
        src: _end(l.src),
        dst: _end(l.dst),
    });
}

/**
 * Colore del cavo. Manual-first: `colorOvr` vince sempre. Poi il colore della
 * VLAN, ma SOLO quando una VLAN sola si applica davvero; poi il colore ereditato
 * lungo la catena fisica; infine il NEUTRO — che non e' il grigio della VLAN 1 e
 * copre i due stati in cui una VLAN da dipingere non c'e': trunk multi-VLAN e
 * collegamento instradato. A distinguerli non e' la sfumatura ma cio' che il cavo
 * si porta dietro: le pastiglie delle VLAN trasportate ci sono solo sul trunk.
 * @param {any} l @param {Map<string,string>} [chainCol] mappa linkId → colore di catena
 */
export function _linkColor(l, chainCol) {
    if (l && l.colorOvr) return l.colorOvr;
    return _linkAutoColor(l, chainCol);
}

/** Come `_linkColor` ma IGNORA l'override manuale: e' il colore che il picker
 *  delle Proprieta' propone quando l'utente azzera il suo. */
export function _linkAutoColor(l, chainCol) {
    const p = _linkPaintVlan(l);
    if (p.known) {
        const c = store.state.vlanColors?.[p.vlan];
        if (c) return c;
    }
    const chain = (chainCol && typeof chainCol.get === 'function') ? chainCol.get(l?.id) : null;
    return chain || CABLE_NEUTRAL;
}

// Perche' il cavo e' cosi'. Le prime sei righe dicono da DOVE viene la VLAN; le
// ultime tre dicono perche' una VLAN non c'e' — e sono tre motivi diversi, non
// tre modi di dire «non lo so».
const _SRC_KEY = {
    'ovr':         'cable.paintOvr',
    'measured':    'cable.paintMeasured',
    'prop':        'cable.paintProp',
    'subif':       'cable.paintSubif',
    'declared-ip': 'cable.paintDeclaredIp',
    'passive':     'cable.paintPassive',
    'untagged':    'cable.paintUntagged',
    'site-native': 'cable.paintSiteNative',
    'single-vlan': 'cable.paintSingleVlan',
    'multi-vlan':  'cable.paintMultiTip',
    'routed':      'cable.paintRoutedTip',
    'ends-disagree': 'cable.paintConflictTip',
    'undeclared':  'cable.paintUndeclaredTip',
};

/**
 * Riga «che cos'e' questo cavo», pronta da mostrare.
 * @param {any} l
 * @returns {{vlan:number|null, kind:string, known:boolean, text:string, why:string, tip:string, color:string, vlans:number[]}}
 */
export function _linkPaintLabel(l) {
    const p = _linkPaintVlan(l);
    const color = _linkAutoColor(l);
    const tip = _SRC_KEY[p.source] ? t(_SRC_KEY[p.source]) : '';
    // `source` viaggia con l'etichetta: chi la mostra deve poter distinguere una
    // VLAN LETTA da una VLAN di DEFAULT anche quando il numero è lo stesso.
    // `ends` viaggia con l'etichetta per la stessa ragione di `source`: i due numeri
    // in contraddizione servono anche FUORI dalla riga — al validatore del cavo, che
    // ne fa un reperto — e farglieli ricalcolare vorrebbe dire due strati che
    // decidono la stessa cosa. Su ogni altro esito `ends` non esiste, e infatti resta
    // `undefined`: nessun esito diverso dalla contesa ha due capi da nominare.
    const base = { vlan: p.vlan, kind: p.kind, source: p.source, known: p.known, color, vlans: p.vlans, ends: p.ends, tip };
    // `why` sta nella riga, `tip` nel tooltip: quando coincidono si tiene solo il
    // tooltip, o la stessa frase compare due volte a un dito di distanza.
    if (p.kind === 'vlan')   return Object.assign(base, { text: 'VLAN ' + p.vlan, why: tip });
    // ⚠️ Il conteggio filtrava la 1, e su un trunk [1,99] scriveva «1 VLAN,
    // nessuna prevale» — una riga che si contraddice da sé. Si conta come conta
    // la decisione: la nativa e' una VLAN come le altre.
    if (p.kind === 'trunk')  return Object.assign(base, { text: t('cable.paintTrunk', { n: p.vlans.length }), why: '' });
    if (p.kind === 'routed') return Object.assign(base, { text: t('cable.paintRouted'), why: '' });
    // I due capi si contraddicono: la riga dice QUALI sono i due numeri, perche' e'
    // l'unica informazione che serve per andare a guardare — «non lo so» da solo
    // manderebbe l'utente a cercare cosa, dove.
    if (p.kind === 'conflict') return Object.assign(base,
        { text: t('cable.paintConflict', { a: (p.ends || [])[0], b: (p.ends || [])[1] }), why: '' });
    return Object.assign(base, { text: t('cable.paintUndeclared'), why: '' });
}

expose({ _linkPaintVlan, _linkPaintLabel, _linkColor, _linkAutoColor, _invalidateLinkColor, CABLE_NEUTRAL });
