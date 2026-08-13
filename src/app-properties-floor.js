// ============================================================
// PROPERTIES PANEL — renderer CONTESTO PLANIMETRIA (ramo else, nessuna selezione)
// ============================================================
// MODULO ESM (migrato da lib/app-properties-floor.js): foglia del dispatcher
// renderProps() (ancora classic in app-properties.js, che lo chiama via window).
// Legge i builder condivisi del core (_buildPropsHeader/_propsSectionIsOpen) e i
// global legacy (state/IPAM/VLAN/voce) via win.*; `t` dal ponte.
// ASSE B (ritiro ponte): TUTTI gli handler inline del pannello (onclick/onchange/
// oninput) sono passati a data-act/data-change/data-input + azioni delegate
// registrate QUI (le fn sono importate dai moduli che le possiedono; restano anche
// in expose() per i pannelli non ancora migrati). Le fisarmoniche usano gia'
// data-toggle="props-section"; i 3 bottoni header espandi/comprimi/ripristina sono
// azioni CONDIVISE registrate in app-properties.js.
// `store._prefixOpen` (chiave = CIDR normalizzato) è il Set condiviso var-ificato in
// app.js: dice quale rete ha il dettaglio aperto in «Reti». I writer classic lo
// mutano, qui si legge.

import { expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, normalizeNumber } from './app-util.js';
import { registerClickActions, registerChangeActions, registerInputActions } from './app-delegation.js';   // ASSE B: handler del pannello floor via event delegation (ex on* inline)
import { _propsSectionIsOpen, _buildPropsHeader, setPropsSectionState, renderProps } from './app-properties.js';   // ritiro ponte: lettura/scrittura stato sezioni + resa (ex win.*)
import { _isVoiceVlan, _siteNativeVlan,
         clearAllVlans, clearAllNetworks, toggleGuestVlan, toggleMgmtVlan, toggleSiteNativeVlan,
         toggleVoiceVlan, _openVoiceAssignDialog, deleteVlanColor, addVlanColor,
         updateVlanName, updateVlanColor, updateVlanIpam, updateUiColor } from './app-vlan-autopoll.js';   // ritiro ponte: funzioni vlan/snmp + azioni card VLAN (ex win.*)
import { _enableManualValueInProps, _vlanIpam, _clearPropsTab, toggleAbbrevNames } from './app.js';   // ritiro ponte: funzioni disc/props/vlan/hv (ex win.*)
import { toggleBgImageLock, scaleBgImage, scaleBgImageTo, fitBgImageToCanvas, clearMap, toggleFloorGrid, setBgImageOpacity } from './app-search-zoom-rack.js';   // ASSE B: azioni immagine di sfondo / griglia (ex on* inline)
import { openAdoptFromPrefix } from './app-drift-adopt.js';   // ASSE B: adotta lease non documentati (ex onclick inline)
import { _l3Compute, _l3GatewayBindingHtml, _l3DeviceForIp } from './app-l3.js';   // ritiro ponte: coda funzioni A (batch 1/2) (ex win.*) + «chi risponde a questo IP»
import { _ipamUsageForPrefix } from './app-ipam.js';   // occupazione di UN prefisso (non piu' di una VLAN)
import { addDeclaredNetworks, removeDeclaredPrefix, updatePrefixField, togglePrefixOpen } from './app-vlan-autopoll.js';   // scritture sulle reti dichiarate
import { prefixesOf, prefixesForVlan, prefixForIp, prefixKey } from '../lib/ipam-model.js';   // l'autorita' sui prefissi
// Bare globals dei <script> puri: `_parseCidrInfo` (lib/cidr.js), `compareCidr` e
// `findSubnetOverlaps` (lib/ipam-audit.js). SENZA typeof-guard: se una lib non c'e'
// la sezione «Reti» deve rompersi a voce alta, non ordinare a caso o dichiarare
// zero conflitti — un verdetto verde per un motore assente e' peggio di un errore.

// ASSE B (ritiro ponte): azioni delegate del pannello FLOOR. Gli argomenti (VLAN id,
// nome campo, delta, chiave colore UI) viaggiano in data-*; le fn sono importate dai
// moduli proprietari. I 3 bottoni espandi/comprimi/ripristina dell'header e le
// fisarmoniche (data-toggle) sono azioni CONDIVISE registrate in app-properties.js.
const _vid = (el) => +el.dataset.vid;   // il vid nel template e' numerico → ripristina il tipo
registerClickActions({
    // Adotta i «solo DHCP» di UNA rete: la chiave e' il prefisso, non la VLAN —
    // l'occupazione e' del prefisso, e una rete senza VLAN non aveva candidati.
    'adopt-from-leases':  (el) => openAdoptFromPrefix(el.dataset.key),
    'vlan-clear-all':     () => clearAllVlans(),
    'nets-clear-all':     () => clearAllNetworks(),
    'net-goto':           (el) => openNetInNets(el.dataset.key),
    'vlan-guest-toggle':  (el) => toggleGuestVlan(_vid(el)),
    'vlan-mgmt-toggle':   (el) => toggleMgmtVlan(_vid(el)),
    'vlan-native-toggle': (el) => toggleSiteNativeVlan(_vid(el)),
    'vlan-voice-toggle':  (el) => toggleVoiceVlan(_vid(el)),
    'vlan-voice-assign':  (el) => _openVoiceAssignDialog(_vid(el)),
    'vlan-delete':        (el) => deleteVlanColor(_vid(el)),
    'vlan-add':           () => addVlanColor(),
    // Le reti: le stesse tre azioni valgono dentro una VLAN e nella sezione senza
    // VLAN — cambia solo `data-vid`, assente = nessuna VLAN. Due nomi per la stessa
    // operazione sarebbero due definizioni destinate a divergere.
    'prefix-expand':      (el) => togglePrefixOpen(el.dataset.key),
    'prefix-del':         (el) => removeDeclaredPrefix(el.dataset.key),
    // Svuota un campo della rete (oggi il gateway, che si mostra a chip): stessa
    // scrittura di un campo lasciato vuoto, non una cancellazione della rete.
    'prefix-clear':       (el) => updatePrefixField(el.dataset.key, el.dataset.field, ''),
    // Il campo a chip di «Reti»: una lista separata da virgole in un colpo solo.
    'nets-add':           (el) => {
        const row = el.closest('.net-addrow');
        const input = row && row.querySelector('input');   // scoped alla riga, mai una query nuda
        if(!input) return;
        addDeclaredNetworks(input.value);
    },
    'map-upload':         () => document.getElementById('map-upload')?.click(),
    'bg-lock-toggle':     () => toggleBgImageLock(),
    'bg-scale-step':      (el) => scaleBgImage(+el.dataset.delta),
    'bg-scale-reset':     () => scaleBgImageTo(1),
    'bg-fit':             () => fitBgImageToCanvas(),
    'bg-clear':           () => clearMap(),
});
registerChangeActions({
    'vlan-name':       (el) => updateVlanName(_vid(el), el.value),
    'vlan-color':      (el) => updateVlanColor(_vid(el), el.value),
    'vlan-ipam-field': (el) => updateVlanIpam(_vid(el), el.dataset.field, el.value),
    'prefix-field':    (el) => updatePrefixField(el.dataset.key, el.dataset.field, el.value),
    'floor-grid':      (el) => toggleFloorGrid(el.checked),
    'ui-color':        (el) => updateUiColor(el.dataset.uikey, el.value),
    'abbrev-names':    (el) => toggleAbbrevNames(el.checked),
});
registerInputActions({
    'bg-scale':   (el) => scaleBgImageTo(+el.value),
    'bg-opacity': (el) => setBgImageOpacity(+el.value),
});

// Blocco "Occupazione" del dettaglio di una rete: barra di capacità + ripartizione
// documentati / solo-DHCP / liberi (dati da _ipamUsageForPrefix → lib/ipam.js,
// opzione A = realtà sul filo). La fonte "DHCP" appare solo se ci sono lease nel
// CIDR (manual-first: senza lease il blocco resta utile coi soli documentati).
// Solo numeri + stringhe t() fidate → nessun escape necessario.
//
// Su IPv6 la capacità NON esiste: 2^64 indirizzi non sono una barra di riempimento,
// e `lib/ipam.js` restituisce apposta 0 invece di un numero plausibile. Senza questa
// uscita anticipata il blocco stampava «0 / 0 · null%» sotto una barra vuota — una
// cifra inventata al posto di un «non si conta».
function _ipamOccHtml(u, vid, key){
    const cap = u.capacity || 0;
    if(!cap) return `<div class="vlan-ipam-occ" style="grid-column:1/-1">
                        <div class="vlan-ipam-occ-hd"><span>${t('floor.occupancy')}</span>${u.leaseInCidr?`<span class="vlan-ipam-occ-src">DHCP</span>`:''}</div>
                        <div class="vlan-ipam-occ-meta">${t('floor.ipDetected',{n:u.usedCount})}</div>
                        ${!u.gatewayOk?`<div class="vlan-ipam-occ-warn">${t('floor.gwOutSubnet')}</div>`:''}
                      </div>`;
    const near = u.pct >= 90;                                  // subnet quasi piena → ambra
    const docColor = near ? '#f5a623' : '#00d4ff';
    const docW = Math.min(100, (u.documentedCount / cap) * 100);
    const dhcpW = Math.min(Math.max(100 - docW, 0), (u.dhcpOnlyCount / cap) * 100);
    const legend = [`<span><i class="dot" style="background:${docColor}"></i>${t('floor.occDocumented',{n:u.documentedCount})}</span>`];
    if(u.dhcpOnlyCount) legend.push(`<span><i class="dot" style="background:#f5a623"></i>${t('floor.occDhcpOnly',{n:u.dhcpOnlyCount})}</span>`);
    legend.push(`<span><i class="dot dot-free"></i>${t('floor.occFree',{n:u.freeCount})}</span>`);
    return `<div class="vlan-ipam-occ${near?' near':''}" style="grid-column:1/-1">
                        <div class="vlan-ipam-occ-hd"><span>${t('floor.occupancy')}</span>${u.leaseInCidr?`<span class="vlan-ipam-occ-src">DHCP</span>`:''}</div>
                        <div class="vlan-ipam-occ-bar"><i style="width:${docW.toFixed(1)}%;background:${docColor}"></i><i style="width:${dhcpW.toFixed(1)}%;background:#f5a623"></i></div>
                        <div class="vlan-ipam-occ-meta">${Number(u.usedCount)} / ${Number(cap)} · ${Number(u.pct)}%</div>
                        <div class="vlan-ipam-occ-leg">${legend.join('')}</div>
                        ${!u.gatewayOk?`<div class="vlan-ipam-occ-warn">${t('floor.gwOutSubnet')}</div>`:''}
                        ${u.dhcpOnlyCount?`<div class="vlan-ipam-occ-adopt"><span><i class="fas fa-triangle-exclamation"></i> ${t('floor.occUndoc',{n:u.dhcpOnlyCount})}</span><button type="button" class="vlan-ipam-adopt-btn" data-act="adopt-from-leases" data-key="${escapeHTML(key)}">${t('floor.occAdopt')}</button></div>`:''}
                      </div>`;
}

// Dal chip della card VLAN alla rete: apre «Reti», apre il dettaglio di QUELLA rete
// e ci porta sopra. Sola NAVIGAZIONE — non scrive niente nel documento:
// l'appartenenza si cambia dalla tendina del dettaglio, che è il posto dove il
// campo vive.
export function openNetInNets(key){
    if(!key) return;
    setPropsSectionState('floor-nets', true);
    store._prefixOpen.add(key);
    renderProps();
    // Query SCOPED al pannello appena riscritto (mai una nuda sul documento).
    // Lo scorrimento è cosmetico: se non trova la riga, la rete è comunque aperta.
    const panel = document.getElementById('props-panel');
    const row = (panel && typeof panel.querySelector === 'function')
        ? panel.querySelector(`.net-prow[data-key="${key.replace(/"/g, '\\"')}"]`) : null;
    if(row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' });
}

// ── Card VLAN: le reti che la CITANO, in sola lettura ───────────────────────
// Un prefisso ha AL MASSIMO una VLAN: e' una relazione molti-a-uno, e il campo
// esiste da un lato solo — sulla rete. Scriverla anche da qui voleva dire dare
// semantica «aggiungi/togli» a un campo singolo, ed e' da li' che nasceva
// l'ambiguita' fra ⊘ (stacca) e × (cancella): due gesti a un centimetro l'uno
// dall'altro, che sono servite tre righe di manuale a distinguere.
// Ora la card MOSTRA le sue reti e ci porta. Cambiarle si fa dove il campo vive,
// cioe' nel dettaglio della rete in «Reti»: un'assegnazione, un posto.
// (Il legame con l'SVI resta invece qui: `gatewayNodeId` e' della VLAN davvero.)
function _vlanNetsHtml(vid, prefixes){
    const chips = prefixes.map(p => {
        const key = prefixKey(p.cidr);
        const u = _ipamUsageForPrefix(p.cidr, p.gateway || '');
        const occ = !u.cidr ? t('floor.hintBadCidr')
            : u.capacity ? `${u.usedCount}/${u.capacity}`
            : `${Number(u.usedCount)} IP`;   // v6: nessuna capacita', solo gli indirizzi visti
        return `<button type="button" class="net-chip${u.cidr?'':' bad'}" data-act="net-goto" data-key="${escapeHTML(key)}" data-tip="${t('floor.netGoto')}">
                    <span class="net-chip-cidr">${escapeHTML(p.cidr||'')}</span>
                    <span class="net-chip-occ">${escapeHTML(occ)}</span>
                    ${p.source==='dcim'?`<span class="drift-net-tag is-decl" data-tip="${t('floor.netFromDcim')}"><i class="fas fa-database"></i></span>`:''}
                  </button>`;
    }).join('');
    return chips ? `<div class="net-chipfield">${chips}</div>`
                 : `<div class="vlan-ipam-hint">${t('floor.netNone')}</div>`;
}

// ── Sezione «Reti» ──────────────────────────────────────────────────────────
// TUTTE le reti dichiarate, non solo quelle che una VLAN non ce l'hanno: il
// prefisso e' di primo livello e la VLAN e' un suo attributo FACOLTATIVO. Una
// sezione che contenesse solo le orfane le nominerebbe per cio' che NON hanno —
// e su un IPAM vero sono la maggioranza del piano.
// Qui la × cancella davvero: e' la porta dove una rete esiste o non esiste.
//
// L'ordine e' quello dello SPAZIO DEGLI INDIRIZZI (`compareCidr`, la stessa
// funzione che ordina le coppie in conflitto): due reti che si sovrappongono
// finiscono vicine, ed e' l'unico modo per vederle. Per VLAN sarebbero lontane.
// Quello che non si parsa va in fondo, non sparisce.
function _sortedPrefixes(state){
    return prefixesOf(state).slice().sort((a, b) => {
        const ia = _parseCidrInfo(a.cidr), ib = _parseCidrInfo(b.cidr);
        if(!ia || !ib) return ia ? -1 : (ib ? 1 : 0);
        return compareCidr(ia, ib) || String(a.cidr).localeCompare(String(b.cidr));
    });
}

// La VLAN di una rete, o null. `+null === 0`: il null va escluso PRIMA della
// conversione, o una rete senza VLAN diventa «VLAN 0».
function _netVid(p){ return (p.vlan == null || !Number.isFinite(+p.vlan)) ? null : +p.vlan; }

// Il badge della VLAN col colore della palette. Una definizione sola: lo usano il
// chip e la riga del piano, e due badge per la stessa cosa divergono al primo
// ritocco. `Number(vid)` non e' ridondante — e' la prova, visibile al guard di
// escaping, che a schermo finisce un numero.
//
// Il colore sta nella PASTIGLIA, non nel testo. Scritto in colore, «VLAN 99»
// (rossa nella palette) e' indistinguibile da un errore, in un elenco che i
// conflitti li segna davvero in rosso: la tinta della palette e' arbitraria
// (`(vid*7)%_VPAL.length`) e non dice niente sulla salute della rete. La
// pastiglia e' la stessa forma che la VLAN ha gia' nella legenda della topologia
// e nei popup — stesso concetto, stesso segno.
function _vlanBadgeHtml(vid){
    if(vid == null) return '';
    const col = store.state.vlanColors[String(vid)] || '#8b949e';
    return `<span class="net-chip-vlan"><i class="vlan-dot" style="background:${escapeHTML(col)}"></i>VLAN ${Number(vid)}</span>`;
}

// L'occupazione della riga: una barra in miniatura piu' la frazione. E' la
// STESSA misura del blocco «Occupazione» del dettaglio, con gli stessi colori e
// la stessa soglia d'ambra — piccola e grande devono restare la stessa cosa, o
// il colpo d'occhio dell'elenco e il numero del dettaglio finiscono per
// smentirsi (→ definizioni duplicate motore/renderer).
//
// Perche' una barra: sei frazioni con denominatori diversi (2/254, 7/254,
// 21/254, 0/126) non si confrontano a occhio, e la domanda dell'elenco e'
// «dove sto stretto». La barra risponde senza leggere una cifra.
//
// Su IPv6 la capacita' NON esiste (lib/ipam.js torna 0 apposta): niente barra.
// Una traccia vuota sotto un denominatore che non c'e' e' la stessa bugia di
// «0 / 0 · null%» — resta il conteggio, che e' l'unica cosa misurata.
// Il tooltip della riga. Sta sulla RIGA e non sulla cella perche' il tooltip di
// quest'app e' puro CSS (`[data-tip]:hover::after`): annidarne uno dentro un
// bottone che ne ha gia' uno li accende tutti e due insieme. Una riga, un
// tooltip — e visto che il gesto ormai si vede (la riga e' un bottone), quel
// tooltip lo si spende per il dato, non per istruzioni sull'uso.
function _netRowTip(u, p){
    const occ = (!u || !u.cidr) ? t('floor.hintBadCidr')
        : u.capacity ? t('floor.netsOccTip',{used:Number(u.usedCount), cap:Number(u.capacity), pct:Number(u.pct)})
        : t('floor.netsOccTipV6',{n:Number(u.usedCount)});
    return p && p.source === 'dcim' ? `${occ} · ${t('floor.netFromDcim')}` : occ;
}

function _netOccCellHtml(u){
    if(!u || !u.cidr) return `<span class="net-prow-bar empty"></span><span class="net-prow-occ bad"><i class="fas fa-triangle-exclamation"></i></span>`;
    const cap = u.capacity || 0;
    if(!cap) return `<span class="net-prow-bar empty"></span><span class="net-prow-occ">${Number(u.usedCount)} IP</span>`;
    const near = u.pct >= 90;
    const docColor = near ? '#f5a623' : '#00d4ff';
    // Minimo visibile: sotto l'1% (una /24 con due host) il riempimento sarebbe
    // sub-pixel, e «quasi vuota» diventerebbe indistinguibile da «vuota». 2px e'
    // la convenzione del segno minimo, non un arrotondamento del dato: la cifra
    // accanto resta quella vera, e il tooltip pure.
    const pxDoc = u.documentedCount ? Math.max(2, Math.round((u.documentedCount / cap) * 64)) : 0;
    const pxDhcp = u.dhcpOnlyCount ? Math.max(2, Math.round((u.dhcpOnlyCount / cap) * 64)) : 0;
    return `<span class="net-prow-bar${near?' near':''}"><i style="width:${Number(pxDoc)}px;background:${docColor}"></i><i style="width:${Number(pxDhcp)}px;background:#f5a623"></i></span>
                    <span class="net-prow-occ">${Number(u.usedCount)}/${Number(cap)}</span>`;
}

// Quello che il DCIM dichiara di una rete importata: stato e descrizione, se ci
// sono. Condivisa fra la riga compatta della card VLAN e il dettaglio di «Reti».
function _netDcimHintHtml(p){
    if(p.source !== 'dcim' || (!p.status && !p.description)) return '';
    const st = p.status ? `${t('floor.netStatus')}: <span>${escapeHTML(p.status)}</span>` : '';
    const de = p.description ? `${t('floor.netDesc')}: <span>${escapeHTML(p.description)}</span>` : '';
    return `<div class="vlan-ipam-hint">${st}${(st&&de)?' · ':''}${de}</div>`;
}

// Le opzioni della tendina VLAN: `—` piu' la palette. Una VLAN dichiarata ma fuori
// palette resta in elenco — nasconderla farebbe sparire il valore alla prima resa.
function _netVlanOptionsHtml(vid){
    const vids = Object.keys(store.state.vlanColors).map(Number).filter(Number.isFinite);
    if(vid != null && !vids.includes(vid)) vids.push(vid);
    vids.sort((a,b)=>a-b);
    return [`<option value=""${vid==null?' selected':''}>${t('floor.netNoVlanOpt')}</option>`]
        .concat(vids.map(v => `<option value="${Number(v)}"${v===vid?' selected':''}>VLAN ${Number(v)}${store.state.vlanNames?.[v]?` · ${escapeHTML(store.state.vlanNames[v])}`:''}</option>`))
        .join('');
}

// Chi risponde all'INDIRIZZO del gateway. Sta qui e non nella card VLAN perché è
// qui che l'indirizzo si scrive: dire «non risponde nessuno» in una sezione dove
// quel valore non si vede è un avviso che non si può eseguire.
// L'apparato è un'altra cosa dall'indirizzo — il primo lo si va ad aprire, il
// secondo lo si scrive nei client — e la card VLAN lo dichiara col suo selettore.
function _netGwDeviceHtml(gw){
    if(!gw) return '';
    const dev = _l3DeviceForIp(gw);
    return dev
        ? `<div class="vlan-ipam-hint"><i class="fas fa-server"></i> ${t('floor.gwDeviceIs',{name:`<span>${escapeHTML(dev.name || dev.id || '')}</span>`})}</div>`
        : `<div class="vlan-ipam-hint warn"><i class="fas fa-triangle-exclamation"></i> ${t('floor.gwDeviceNone')}</div>`;
}

// Il dettaglio della rete aperta: com'e' fatta. La VLAN e' una tendina (— = nessuna),
// il gateway un chip, il DNS un campo — perche' un gateway la sua rete la trova per
// CONTENIMENTO, e 1.1.1.1 non cade dentro la rete che serve.
function _netDetailHtml(p, usage){
    const key = prefixKey(p.cidr);
    const vid = _netVid(p);
    const gw = String(p.gateway||'').trim();
    // Dove cade DAVVERO il gateway: `prefixForIp` vince col piu' specifico, come una
    // tabella di routing. Se non e' questa rete, si dice quale — e' una
    // misconfigurazione vera, non un capriccio dell'interfaccia.
    const gwHome = (gw && !usage.gatewayOk) ? prefixForIp(store.state, gw) : null;
    return `<div class="net-detail">
                  <div class="net-detail-hd">
                    <span>${t('floor.netDetailOf',{cidr:`<b>${escapeHTML(p.cidr||'')}</b>`})}</span>
                    <button type="button" class="net-detail-x" data-act="prefix-expand" data-key="${escapeHTML(key)}" data-tip="${t('floor.netDetailClose')}"><i class="fas fa-chevron-up"></i></button>
                  </div>
                  <div class="vlan-ipam-fields" style="margin-left:0">
                    <div class="prop-group" style="grid-column:1/-1">
                      <label data-tip="${t('floor.netCidrTip')}" data-tip-wrap>${t('floor.netCidr')}</label>
                      <input value="${escapeHTML(p.cidr||'')}" placeholder="192.168.20.0/24" inputmode="text"
                             data-change="prefix-field" data-key="${escapeHTML(key)}" data-field="cidr">
                    </div>
                    <div class="prop-group">
                      <label>VLAN</label>
                      <select data-change="prefix-field" data-key="${escapeHTML(key)}" data-field="vlan">${_netVlanOptionsHtml(vid)}</select>
                    </div>
                    <div class="prop-group">
                      <label>${t('floor.netName')}</label>
                      <input value="${escapeHTML(p.name||'')}" placeholder="${t('floor.netPhName')}" data-change="prefix-field" data-key="${escapeHTML(key)}" data-field="name">
                    </div>
                    <div class="prop-group" style="grid-column:1/-1">
                      <label>${t('f.gatewayIp')}</label>
                      ${gw ? `<div class="net-chipfield">
                          <span class="net-chip${usage.gatewayOk?'':' bad'}">
                            <span class="net-chip-cidr">${escapeHTML(gw)}</span>
                            <button type="button" class="net-chip-x" data-act="prefix-clear" data-key="${escapeHTML(key)}" data-field="gateway" data-tip="${t('floor.netGwClear')}"><i class="fas fa-times"></i></button>
                          </span>
                        </div>
                        ${usage.gatewayOk?'':`<div class="vlan-ipam-hint warn">${gwHome ? t('floor.gwInOther',{ip:`<b>${escapeHTML(gw)}</b>`,cidr:`<b>${escapeHTML(gwHome.cidr)}</b>`}) : t('floor.gwInNone',{ip:`<b>${escapeHTML(gw)}</b>`})}</div>`}
                        ${_netGwDeviceHtml(gw)}`
                        : `<input value="" placeholder="${t('floor.phGateway',{vid:vid==null?'':vid})}" data-change="prefix-field" data-key="${escapeHTML(key)}" data-field="gateway">`}
                    </div>
                    <div class="prop-group" style="grid-column:1/-1">
                      <label>DNS</label>
                      <input value="${escapeHTML(p.dns||'')}" placeholder="${t('floor.phDns')}" data-change="prefix-field" data-key="${escapeHTML(key)}" data-field="dns">
                    </div>
                    ${_netDcimHintHtml(p)}
                    ${usage.cidr ? _ipamOccHtml(usage, vid, key) : ''}
                  </div>
                </div>`;
}

// L'elenco del piano: una riga per rete, ordinata per indirizzo, con la nota di
// conflitto sotto la SECONDA delle due che si sovrappongono. Le stringhe sono
// quelle del report L3 (`l3.overlapRow*`): stesso fatto, stesse parole — due
// formulazioni dello stesso conflitto divergerebbero alla prima modifica.
// Ogni riga e' CLICCABILE e apre il dettaglio della sua rete, che si espande
// subito sotto: l'elenco e' l'unico posto dove le reti si vedono, e una seconda
// lista degli stessi prefissi (i chip che stavano sopra) diceva due volte la
// stessa cosa senza aggiungerci niente.
// Ordine dentro una riga aperta: la riga, l'eventuale conflitto (una sola frase),
// poi il dettaglio — cosi` l'avviso resta attaccato alla coppia che descrive.
function _netPlanHtml(rows, usageByKey, overlaps){
    const clash = new Set();
    const noteAfter = new Map();   // chiave della SECONDA rete → conflitti da stampare sotto
    for(const o of overlaps){
        const ka = prefixKey(o.a.cidr), kb = prefixKey(o.b.cidr);
        clash.add(ka); clash.add(kb);
        if(!noteAfter.has(kb)) noteAfter.set(kb, []);
        noteAfter.get(kb).push(o);
    }
    // L'intestazione: nominare le colonne e' cio' che rende leggibile «2/254»
    // senza spenderci una frase sotto. La regola d'ordinamento vive sul titolo
    // della colonna che ordina — dove serve, quando serve.
    // Ogni riga finisce con una X per cancellare quella rete (come le card VLAN).
    // Header e righe condividono la stessa griglia `1fr auto`: nell'header, al posto
    // della X, un pulsante-fantasma INVISIBILE riserva la stessa larghezza → le colonne
    // restano allineate senza numeri magici.
    const _ghostDel = `<button type="button" class="net-prow-del toolbar-btn" style="visibility:hidden" tabindex="-1" aria-hidden="true"><i class="fas fa-times"></i></button>`;
    const out = [`<div class="net-pline net-phead-line">
                    <div class="net-phead">
                      <span data-tip="${t('floor.netsPlanHint')}" data-tip-wrap>${t('floor.netsColNet')}</span>
                      <span>VLAN</span>
                      <span class="net-phead-occ">${t('floor.netsColOcc')}</span>
                    </div>${_ghostDel}
                  </div>`];
    for(const p of rows){
        const key = prefixKey(p.cidr);
        const vid = _netVid(p);
        const u = usageByKey.get(key) || {};
        const sel = store._prefixOpen.has(key);
        // La provenienza sta DENTRO la cella dell'indirizzo — dentro lo <span>,
        // non accanto. E' un attributo dell'identita' della rete, non un dato da
        // incolonnare; ma soprattutto: da fratello sarebbe un SECONDO figlio
        // della griglia, e le righe importate dal DCIM avrebbero VLAN, barra e
        // frazione slittate di una colonna rispetto a tutte le altre.
        out.push(`<div class="net-pline">
                    <button type="button" class="net-prow${clash.has(key)?' clash':''}${sel?' sel':''}${u.cidr?'':' bad'}" data-act="prefix-expand" data-key="${escapeHTML(key)}" data-tip="${escapeHTML(_netRowTip(u, p))}" data-tip-wrap>
                      <span class="net-prow-cidr">${escapeHTML(p.cidr||'')}${p.source==='dcim'?`<span class="drift-net-tag is-decl"><i class="fas fa-database"></i></span>`:''}</span>
                      ${vid!=null?_vlanBadgeHtml(vid):`<span class="net-prow-novlan">—</span>`}
                      ${_netOccCellHtml(u)}
                    </button>
                    <button type="button" class="net-prow-del toolbar-btn" data-act="prefix-del" data-key="${escapeHTML(key)}" data-tip="${t('floor.netDelete')}"><i class="fas fa-times"></i></button>
                  </div>`);
        for(const o of (noteAfter.get(key) || [])){
            out.push(`<div class="net-clashnote">⚠ ${t(o.identical?'l3.overlapRowSame':'l3.overlapRow',{sa:`<b>${escapeHTML(o.a.cidr)}</b>`, sb:`<b>${escapeHTML(o.b.cidr)}</b>`})}</div>`);
        }
        if(sel) out.push(_netDetailHtml(p, u));
    }
    return out.join('');
}

// La fisarmonica intera. Va costruita DENTRO il memo IPAM per-frame: calcola
// l'occupazione per ogni rete, e senza memo ognuna ri-scandirebbe nodi e lease.
function _netsSectionHtml(state){
    const rows = _sortedPrefixes(state);
    const usageByKey = new Map();
    for(const p of rows) usageByKey.set(prefixKey(p.cidr), _ipamUsageForPrefix(p.cidr, p.gateway || ''));
    const overlaps = findSubnetOverlaps(rows, _parseCidrInfo);
    const bad = String(store._netsBad || '');
    const preview = `${t('floor.netsCount',{n:rows.length})}${overlaps.length?` · ${t('floor.netsConflicts',{n:overlaps.length})}`:''}`;
    // L'ordine e' quello del gesto: leggi il piano, poi ne aggiungi una. Il campo
    // sta in fondo perche' e' l'ultima cosa che serve, non la prima.
    return `<details class="props-collapsible props-primary" ${_propsSectionIsOpen('floor-nets')?'open':''} data-toggle="props-section" data-section="floor-nets">
              <summary class="props-collapsible-head"><span><i class="fas fa-diagram-project"></i> ${t('floor.netsSection')}</span><span class="props-collapsible-preview${overlaps.length?' warn':''}">${preview}</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
              <div class="props-collapsible-body">
                ${rows.length?`<div style="display:flex;justify-content:flex-end;margin-bottom:6px">
                  <button class="toolbar-btn" style="padding:4px 10px;margin:0;font-size:0.74rem;background:var(--accent-soft);border-color:var(--accent);color:var(--text-main)" data-tip="${t('floor.clearAllNetsTip')}" data-act="nets-clear-all"><i class="fas fa-trash-alt" style="margin-right:6px;color:var(--fault-color)"></i>${t('floor.clearAllNets')}</button>
                </div>`:''}
                ${rows.length?`<div class="net-plan">
                  ${_netPlanHtml(rows, usageByKey, overlaps)}
                </div>`:''}
                <div class="net-addrow${bad?' bad':''}">
                  <input type="text" value="${escapeHTML(bad)}" placeholder="${t('floor.netsPh')}">
                  <button class="toolbar-btn primary" data-act="nets-add"><i class="fas fa-plus"></i> ${t('floor.netAdd')}</button>
                </div>
                ${bad?`<div class="vlan-ipam-hint warn">${t('floor.netsBad')}</div>`:''}
              </div>
            </details>`;
}

// Contesto progetto / nessuna selezione (ramo else).
export function _renderFloorProps(panel){
        const state = store.state;
        // ─────────────────────────────────────────────────────────────
        // Contesto progetto — pannello a fisarmoniche.
        // Pattern uniforme con gli altri pannelli proprieta'.
        // Default open: Immagine, VLAN. Default closed: Colori, Etichette.
        // NB: auto-poll SNMP e rinnovo IP (DHCP) vivono ora nel popover
        // "Automazioni rete" in header (renderAutomationMenu), non qui.
        // Stato persistito in localStorage via setPropsSectionState.
        // ─────────────────────────────────────────────────────────────
        const _vlanCount = Object.keys(state.vlanColors).length;
        const _bgPreview = state.bgImage
            ? `<span class="props-collapsible-preview" style="color:var(--active-color)">${t('floor.mapLoaded')}${state.bgImageLocked?' · 🔒':''}</span>`
            : `<span class="props-collapsible-preview" style="color:var(--text-muted)">${t('floor.noMap')}</span>`;
        const _vlanPreview = `<span class="props-collapsible-preview">${t('floor.vlanCount',{n:_vlanCount})}</span>`;
        const _panelHeader = _buildPropsHeader(
            t('floor.title'),
            t('floor.subtitle'),
            'fa-map',
            `<span class="props-toggles"><button class="props-toggle-btn" data-act="props-expand-all" data-tip="${t('props.expandAll')}"><i class="fas fa-angles-down"></i></button><button class="props-toggle-btn" data-act="props-collapse-all" data-tip="${t('props.collapseAll')}"><i class="fas fa-angles-up"></i></button><button class="props-toggle-btn" data-act="props-reset-sections" data-tip="${t('props.resetSections')}"><i class="fas fa-rotate"></i></button></span>`,
            'props-title-upper'
        );
        let h = _panelHeader;
        // Il blocco VLAN si costruisce a parte e si incolla DOPO «Reti»: il piano
        // di indirizzamento e' il documento, la VLAN e' un'etichetta che una rete
        // puo' avere. Chi apre il contesto progetto cerca prima «dove stanno gli
        // indirizzi», e solo dopo come sono etichettati.
        let _vlanHtml = `<details class="props-collapsible props-primary" ${_propsSectionIsOpen('floor-vlan')?'open':''} data-toggle="props-section" data-section="floor-vlan">
              <summary class="props-collapsible-head"><span><i class="fas fa-network-wired"></i> VLAN</span>${_vlanPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
              <div class="props-collapsible-body">
                <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
                  <button class="toolbar-btn" style="padding:4px 10px;margin:0;font-size:0.74rem;background:var(--accent-soft);border-color:var(--accent);color:var(--text-main)" data-tip="${t('floor.clearAllVlansTip')}" data-act="vlan-clear-all"><i class="fas fa-trash-alt" style="margin-right:6px;color:var(--fault-color)"></i>${t('floor.clearAllVlans')}</button>
                </div>
                <div style="max-height:640px;overflow-y:auto;padding-right:4px">`;
        // F6: memo IPAM per-frame — _l3Compute, OGNI chip di OGNI card VLAN e OGNI rete
        // di «Reti» chiamano _ipamUsageForPrefix, e ciascuna ri-scandisce tutti i nodi
        // + lease. Le accentro in
        // 1 sola scansione per questa resa (sincrona) → poi il memo si azzera nel finally,
        // niente staleness fuori. Bare + typeof guard: se assente, resa piu' lenta ma
        // corretta.
        if(typeof _ipamMemoBegin === 'function') _ipamMemoBegin();
        try {
        // L3-lite: il report calcolato UNA volta (non per card) per la riga
        // "Instradata da" dentro ogni card VLAN. Si legge `byVlan`, la vista
        // per-VLAN derivata dalle righe per-rete: la card chiede «chi instrada
        // questa VLAN», e l'SVI è una sola anche quando la VLAN porta un IPv4 e
        // un IPv6 — due righe nel report, una risposta qui.
        let _l3rows = {};
        try { if(typeof _l3Compute === 'function') _l3rows = _l3Compute(false).byVlan || {}; } catch(_){}
        const _siteNat = (typeof _siteNativeVlan==='function') ? _siteNativeVlan() : 1;
        Object.keys(state.vlanColors).sort((a,b)=>+a-+b).forEach(v=>{
            const vid=normalizeNumber(v,1,1,4094);
            const _isNative = _siteNat === vid;
            const vname=escapeHTML(state.vlanNames?.[vid]||'');
            const ipam=_vlanIpam(vid);
            const _vlanPrefixes=prefixesForVlan(state, vid);
            // Un gateway rimasto sul record della VLAN significa che era stato scritto
            // quando la subnet non c'era: senza un prefisso non ha una casa, e senza
            // questa riga sparirebbe dalla vista pur restando nel file.
            const _orphanGw=(!_vlanPrefixes.length && (ipam?.gateway||ipam?.dns))
                ? [ipam.gateway, ipam.dns].filter(Boolean).join(' · ') : '';
            _vlanHtml+=`<div class="vlan-ipam-card">
                  <div class="vlan-ipam-row">
                    <label style="margin:0;width:68px;font-size:0.78rem;flex-shrink:0;white-space:nowrap;font-weight:700;color:${escapeHTML(state.vlanColors[v]||'#8b949e')}">VLAN ${vid}</label>
                    <input type="text" value="${vname}" placeholder="${t('vlan.namePlaceholder')}"
                           style="flex:1;min-width:0;max-width:400px;padding:5px 7px;font-size:var(--fs-lg);background:var(--bg-color);border:1px solid var(--panel-border);border-radius:4px;color:var(--text-main)"
                           data-change="vlan-name" data-vid="${vid}">
                    <input type="color" value="${escapeHTML(state.vlanColors[v])}" data-change="vlan-color" data-vid="${vid}" style="width:32px;flex-shrink:0;padding:2px">
                    <button class="toolbar-btn${(Array.isArray(state.guestVlans)&&state.guestVlans.map(Number).includes(vid))?' primary':''}" style="padding:3px 6px;margin:0" data-tip="${(Array.isArray(state.guestVlans)&&state.guestVlans.map(Number).includes(vid))?t('floor.guestOn'):t('floor.guestOff')}" data-act="vlan-guest-toggle" data-vid="${vid}"><i class="fas fa-user-group"></i></button>
                    <button class="toolbar-btn${(Array.isArray(state.mgmtVlans)&&state.mgmtVlans.map(Number).includes(vid))?' primary':''}" style="padding:3px 6px;margin:0" data-tip="${(Array.isArray(state.mgmtVlans)&&state.mgmtVlans.map(Number).includes(vid))?t('floor.mgmtOn'):t('floor.mgmtOff')}" data-act="vlan-mgmt-toggle" data-vid="${vid}"><i class="fas fa-screwdriver-wrench"></i></button>
                    <button class="toolbar-btn${_isNative?' primary':''}" style="padding:3px 6px;margin:0" data-tip="${_isNative?t('vlan.nativeUnmark'):t('vlan.nativeMark')}" data-act="vlan-native-toggle" data-vid="${vid}"><i class="fas fa-house"></i></button>
                    <button class="toolbar-btn${(typeof _isVoiceVlan==='function'&&_isVoiceVlan(vid))?' primary':''}" style="padding:3px 6px;margin:0" data-tip="${(typeof _isVoiceVlan==='function'&&_isVoiceVlan(vid))?t('voice.unmark'):t('voice.mark')}" data-act="vlan-voice-toggle" data-vid="${vid}"><i class="fas fa-phone"></i></button>
                    ${(typeof _isVoiceVlan==='function'&&_isVoiceVlan(vid))?`<button class="toolbar-btn" style="padding:3px 6px;margin:0" data-tip="${t('voice.assignTip')}" data-act="vlan-voice-assign" data-vid="${vid}"><i class="fas fa-arrow-right-to-bracket"></i></button>`:''}
                    <button class="toolbar-btn" style="padding:3px 6px;margin:0" data-act="vlan-delete" data-vid="${vid}"><i class="fas fa-times"></i></button>
                  </div>
                  ${_vlanNetsHtml(vid, _vlanPrefixes)}
                  ${_orphanGw ? `<div class="vlan-ipam-hint warn">${t('floor.gwNoNet')} <span>${escapeHTML(_orphanGw)}</span></div>` : ''}
                  <div class="vlan-ipam-fields">
                    ${(typeof _l3GatewayBindingHtml==='function') ? _l3GatewayBindingHtml(vid, _l3rows[vid]) : ''}
                  </div>
                </div>`;
        });
        _vlanHtml+=`</div>
                <div style="display:flex;gap:5px;margin-top:12px;border-top:1px solid var(--panel-border);padding-top:10px">
                  <input type="number" id="new-vlan-id" placeholder="ID" style="width:55px">
                  <input type="color" id="new-vlan-color" value="#00d4ff" style="flex:1">
                  <button class="toolbar-btn primary" style="padding:4px 9px;margin:0" data-act="vlan-add">${t('common.add')}</button>
                </div>
              </div>
            </details>`;
        // «Reti» PRIMA, le VLAN dopo. Il calcolo resta dentro lo stesso memo: e'
        // solo l'ordine a schermo a cambiare, non quante volte si scandiscono
        // nodi e lease.
        h += _netsSectionHtml(state) + _vlanHtml;
        // Fin qui, tutto dentro il memo IPAM per-frame: il ciclo VLAN, le reti senza
        // VLAN e «Reti», che calcola l'occupazione di OGNI prefisso. Una sola
        // scansione di nodi e lease per resa — senza, ogni card ne rifarebbe una.
        } finally {
            if(typeof _ipamMemoEnd === 'function') _ipamMemoEnd();
        }
        h+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('floor-bgimage')?'open':''} data-toggle="props-section" data-section="floor-bgimage">
              <summary class="props-collapsible-head"><span><i class="fas fa-map"></i> ${t('floor.imgSection')}</span>${_bgPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
              <div class="props-collapsible-body">
                <div class="prop-group" style="margin-bottom:10px">
                  <button class="panel-skin-btn primary" style="width:100%"
                          data-act="map-upload">
                    <i class="fas fa-upload"></i>
                    ${state.bgImage?t('floor.replaceMap'):t('floor.importMap')}
                  </button>
                </div>
                ${state.bgImage?`
                <div class="prop-group" style="${state.bgImageLocked?'opacity:0.38;pointer-events:none':''}">
                  <label>${t('f.bgScale')}</label>
                  <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
                    <button class="zoom-btn" style="background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:4px;padding:4px 9px" data-act="bg-scale-step" data-delta="-0.05"><i class="fas fa-minus"></i></button>
                    <input id="bg-scale-slider" type="range" min="0.1" max="5" step="0.05"
                           value="${(state.bgImageScale||1).toFixed(2)}"
                           style="flex:1;accent-color:var(--accent)"
                           data-input="bg-scale">
                    <button class="zoom-btn" style="background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:4px;padding:4px 9px" data-act="bg-scale-step" data-delta="0.05"><i class="fas fa-plus"></i></button>
                    <span id="bg-scale-lbl" style="font-size:0.78rem;min-width:42px;text-align:right">${Math.round((state.bgImageScale||1)*100)}%</span>
                  </div>
                  <button class="toolbar-btn" style="width:100%;margin-top:6px;font-size:0.75rem" data-act="bg-scale-reset"><i class="fas fa-undo" style="margin-right:4px"></i>${t('floor.reset100')}</button>
                </div>
                <div class="prop-group" style="margin-bottom:10px">
                  <button class="panel-skin-btn primary" style="width:100%"
                          data-act="bg-lock-toggle">
                    <i class="fas ${state.bgImageLocked?'fa-lock':'fa-lock-open'}"></i>
                    ${state.bgImageLocked?t('floor.mapLocked'):t('floor.lockScale')}
                  </button>
                </div>
                <div class="prop-group" style="margin-bottom:10px">
                  <label>${t('floor.mapOpacity')}</label>
                  <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
                    <i class="fas fa-circle-half-stroke" style="color:var(--text-muted);font-size:0.8rem"></i>
                    <input id="bg-opacity-slider" type="range" min="0.05" max="1" step="0.05"
                           value="${(state.bgImageOpacity ?? 0.4).toFixed(2)}"
                           style="flex:1;accent-color:var(--accent)"
                           data-input="bg-opacity">
                    <span id="bg-opacity-lbl" style="font-size:0.78rem;min-width:42px;text-align:right">${Math.round((state.bgImageOpacity ?? 0.4) * 100)}%</span>
                  </div>
                </div>
                <div style="display:flex;gap:6px">
                  <button class="toolbar-btn" style="flex:1" ${state.bgImageLocked?'disabled':''} data-act="bg-fit"><i class="fas fa-expand-arrows-alt"></i> ${t('floor.fitCanvas')}</button>
                  <button class="toolbar-btn danger" style="flex:1" data-act="bg-clear"><i class="fas fa-trash"></i> ${t('floor.removeMap')}</button>
                </div>`:''}
                <div class="prop-group" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;border-top:1px solid var(--panel-border);padding-top:10px">
                  <label style="margin:0">${t('floor.grid')}</label>
                  <label class="toggle-sw">
                    <input type="checkbox" ${state.gridHidden?'':'checked'} data-change="floor-grid">
                    <span class="toggle-track"></span>
                  </label>
                </div>
                <div class="prop-notes-header"><i class="fas fa-palette"></i> ${t('floor.colorsSection')}</div>
                <div class="prop-group"><label>${t('f.floorBg')}</label><input type="color" value="${escapeHTML(state.uiColors?.floorBg||'#0d1117')}" data-change="ui-color" data-uikey="floorBg"></div>
                <div class="prop-group"><label>${t('f.rackBg')}</label><input type="color" value="${escapeHTML(state.uiColors?.rackBg||'#ffffff')}" data-change="ui-color" data-uikey="rackBg"></div>
                <div class="prop-notes-header"><i class="fas fa-tag"></i> ${t('floor.labelsSection')}</div>
                <div class="prop-group" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
                  <label style="margin:0">${t('f.abbrevNames')}</label>
                  <label class="toggle-sw" data-tip="${t('f.abbrevNamesTip')}">
                    <input type="checkbox" ${state.abbrevNames?'checked':''} data-change="abbrev-names">
                    <span class="toggle-track"></span>
                  </label>
                </div>
              </div>
            </details>`;
        panel.innerHTML=h;
        _enableManualValueInProps(panel);
        _clearPropsTab();
}

// Chiamato dal dispatcher renderProps() (app-properties.js, ancora classic).
expose({ _renderFloorProps, openNetInNets });
