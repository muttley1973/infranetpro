// MODULO ESM (migrato da lib/app-properties-link.js): foglia del dispatcher
// renderProps() (classic in app-properties.js, che lo chiama via window). Builder
// del core + global legacy via win.*; lib guarded script-tagged (linkState/
// cable-validate/cabling) via win.*; _wifiAssocHtml esposto da app-wifi; t dal
// ponte. Gli handler del pannello sono data-act/data-change/data-blur (event
// delegation, registrati sopra). Nessun cambio logica.
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML } from './app-util.js';
import { getNodeByPortId, getNodeDisplayName, getWallPortLabel, _getLinkPhysicalView, _enableManualValueInProps, _activatePropsTab, _cableAutoLabel, promoteLinkToManual, setCableLabel, setLinkProp, deleteLink, _cableProofBadgeHtml } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderProps, _propsSectionIsOpen, _buildPropsHeader } from './app-properties.js';   // ritiro ponte fase 2+: funzioni/builder (ex win.*)
import { TYPES, _frontPanelPortLabel, _frontPanelIsUplink } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)
import { _effPortVlan, _getLinkTrunk, _parseTrunkVlans, _runActiveAnchor, setLinkNativeVlan, setLinkColor, setLinkMode, setLinkTrunkVlans } from './app-vlan-autopoll.js';   // ritiro ponte: funzioni foglia UI/vlan/popup (ex win.*)
import { _portDisplayName } from './app-ports.js';   // ritiro ponte: funzioni foglia UI/vlan/popup (ex win.*)
import { _getLinkVlan, selectPathSegment } from './app-popup.js';
import { _linkAutoColor, _linkPaintLabel } from './app-link-color.js';   // colore e MOTIVO del colore: una definizione sola
import { _routeHopRemovable, enterRoutingMode, removeRouteHop } from './app-cabling-editor.js';   // ritiro ponte: coda funzioni A (batch 1/2) (ex win.*)
import { _wifiAssocHtml } from './app-wifi.js';   // ritiro ponte: coda funzioni A (batch 2/2) (ex win.*)
import { cableIssueTexts, chainWarnTexts } from './app-issue-text.js';   // le PAROLE dei validatori puri (i18n), che le lib non hanno più
import { registerClickActions, registerChangeActions, registerBlurActions } from './app-delegation.js';   // ASSE B: handler del pannello cavo via event delegation (ex on* inline)

// ASSE B (ritiro ponte): gli handler inline del pannello CAVO passano a data-act/
// data-change/data-blur + azioni delegate registrate qui. Gli argomenti (id del
// link, nome campo, coercizione) viaggiano in data-*; le fn restano in expose()
// finche' altri pannelli/topologia le chiamano ancora inline. I 3 bottoni
// espandi/comprimi/ripristina dell'header sono azioni CONDIVISE (app-properties.js).
function _coerceLinkVal(el){
    const c = el.dataset.coerce;
    if(c === 'trim') return el.value.trim();
    if(c === 'num')  return el.value === '' ? '' : +el.value;
    return el.value;
}
registerClickActions({
    'link-color-reset': (el) => setLinkColor(el.dataset.lid, null),
    'link-promote':     (el) => promoteLinkToManual(el.dataset.lid),
    'link-del':         (el) => deleteLink(el.dataset.lid),
    'link-label-reset': (el) => { setCableLabel(el.dataset.lid, ''); renderProps(); },
    'link-mode':        (el) => setLinkMode(el.dataset.lid, el.dataset.mode),
    'link-remove-hop':  (el) => removeRouteHop(el.dataset.pid),
    'link-seg-pick':    (el) => selectPathSegment(el.dataset.seglink),
    'link-route':       (el) => enterRoutingMode(el.dataset.lid),
});
registerChangeActions({
    'link-label':       (el) => setCableLabel(el.dataset.lid, el.value),
    'link-native-vlan': (el) => setLinkNativeVlan(el.dataset.lid, el.value),
    'link-trunk-vlans': (el) => setLinkTrunkVlans(el.dataset.lid, el.value),
    'link-color':       (el) => setLinkColor(el.dataset.lid, el.value),
    'link-prop':        (el) => setLinkProp(el.dataset.lid, el.dataset.lprop, _coerceLinkVal(el)),
});
registerBlurActions({
    'link-trunk-vlans': (el) => setLinkTrunkVlans(el.dataset.lid, el.value),
});

// ============================================================
// PROPERTIES PANEL — renderer CAVO/LINK (selType===link)
// Estratto da app-properties.js (refactor: split del pannello proprieta per
// tipo di selezione). Pannello cavo: VLAN, trunk derivato, associazione wireless.
// Funzione glue chiamata dal dispatcher renderProps() a runtime: usa solo
// `panel` + i globali (selId/selType/state/TYPES) e i builder condivisi che
// restano in app-properties.js. Caricato in netmapper.html subito dopo
// app-properties.js. NESSUN cambiamento di logica rispetto alloriginale.
// ============================================================

// Descrittore leggibile dell'endpoint di un cavo per l'etichetta "Da/A".
// Usa la label SFP-aware del front panel (_frontPanelPortLabel: numerazione +
// prefisso) e indica esplicitamente SFP/MGMT — prima mostrava il numero grezzo
// del pid (es. "porta 1" anche su una SFP).
function _cablePortDesc(pid){
    const _porta = (typeof t==='function') ? t('common.portWord') : 'porta';
    const node = getNodeByPortId(pid);
    if(!node) return _porta + ' ' + String(pid).split('-').slice(1).join('-');
    const suffix = String(pid).slice(node.id.length + 1);
    const mm = /^mgmt(\d+)$/i.exec(suffix);
    if(mm) return 'MGMT ' + mm[1];
    const num = parseInt(suffix, 10);
    if(num >= 1 && String(num) === suffix){
        const pc = node.ports !== undefined ? node.ports : ((TYPES[node.type] && TYPES[node.type].ports) || 1);
        const lbl = (typeof _frontPanelPortLabel === 'function') ? _frontPanelPortLabel(node, num, pc) : suffix;
        const isSfp = (typeof _frontPanelIsUplink === 'function') && _frontPanelIsUplink(node, num, pc);
        // SFP: se la label e' numerica pura prepende "SFP "; se ha gia' un prefisso
        // (es. "SFP1", "Te1") lo lascia com'e' (niente doppione "SFP SFP1").
        if(isSfp) return /^\d/.test(lbl) ? ('SFP ' + lbl) : lbl;
        return _porta + ' ' + lbl;
    }
    return _porta + ' ' + suffix;   // radio o suffisso non numerico: invariato
}

// Proprieta' di un CAVO/link selezionato (selType==='link').
/**
 * Le VLAN trasportate rese come PASTIGLIE colorate, tutte allo stesso peso.
 * È la resa che sostituisce il colore sul cavo: su un trunk nessuna VLAN vince,
 * quindi invece di eleggerne una si mostrano tutte insieme — stesso linguaggio
 * delle pillole della legenda, che l'occhio già conosce. Una VLAN senza colore
 * assegnato prende il neutro invece di sparire.
 * @param {number[]} vlans @returns {string} HTML (stringa vuota se non c'è nulla da mostrare)
 */
function _vlanPills(vlans){
    const list = (Array.isArray(vlans) ? vlans : []).filter(v => v >= 1 && v <= 4094);
    if(!list.length) return '';
    // Taglia 160% rispetto a una pastiglia da elenco: qui non sono una
    // decorazione accanto a un testo, sono la RISPOSTA — su un trunk le VLAN
    // trasportate sono l'unica cosa che si possa dire del cavo, e la riga di
    // testo che le ripeteva se n'e' andata.
    // ⚠️ Il commento sta QUI e non dentro il map: lo scanner dell'escaping legge
    // il membro destro senza saltare i commenti, e un apostrofo la' dentro gli fa
    // perdere il filo — `${pills}` finiva nel residuo del cricchetto per un'apostrofe.
    const pills = list.map(v => {
        const col = store.state.vlanColors?.[v] || '#8b949e';
        const nome = store.state.vlanNames?.[v] || '';
        return `<span data-tip="${escapeHTML(nome ? `VLAN ${v} — ${nome}` : `VLAN ${v}`)}" data-tip-pos="bottom"
            style="display:inline-flex;align-items:center;gap:6px;padding:3px 11px;border-radius:var(--radius-md);
                   font-size:1.12rem;font-weight:700;background:${escapeHTML(col)}2e;color:${escapeHTML(col)}">
            <span style="width:11px;height:11px;border-radius:50%;background:${escapeHTML(col)};flex-shrink:0"></span>${Number(v)}</span>`;
    }).join('');
    return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:3px 0 10px">${pills}</div>`;
}

export function _renderLinkProps(panel){
        const l=store.state.links.find(x=>x.id===store.selId);
        if(!l){store.selType=null;store.selId=null;renderProps();return;}
        const isAuto = !!l.autoLinked;
        const lockAttr = isAuto ? ' disabled' : '';
        // ⚠️ `_getLinkVlan` risponde a una domanda DIVERSA: è la VLAN **nativa** del
        // collegamento, e come tale la usano il trunk e il modello. Il pannello la
        // usava per dire «di che VLAN è questo cavo» — che è la domanda del modello,
        // e la scala di `_getLinkVlan` non ha né la sotto-interfaccia né la rete
        // dichiarata dell'endpoint. Risultato misurato sul banco: quattro cavi
        // dipinti 99 o 30 mentre il pannello scriveva «VLAN 1». Nono punto della
        // stessa classe di bug, trovato ancora una volta guardando lo schermo.
        const vl=_getLinkVlan(l);              // la NATIVA — usata solo dove serve la nativa
        const _pl = (typeof _linkPaintLabel === 'function') ? _linkPaintLabel(l) : null;
        // Quello che il modello dice del cavo: è questo che il pannello deve mostrare.
        const _plVlan = (_pl && _pl.kind === 'vlan') ? _pl.vlan : null;
        // Colore proposto quando l'utente azzera il suo: la STESSA regola del canvas
        // (src/app-link-color.js), senza l'override manuale.
        const autoColor=(typeof _linkAutoColor==='function') ? _linkAutoColor(l) : (store.state.vlanColors[vl]||'#6e7681');
        // Il pallino accanto al NUMERO di VLAN mostra il colore DI QUEL numero: e' la
        // VLAN nativa, editabile qui. Il colore del CAVO puo' essere un altro (un trunk
        // e' dipinto dalla VLAN che rappresenta) e lo dice la riga «Colore» piu' sotto:
        // due significati, due posti — non un pallino che ne racconta un terzo.
        // Il pallino segue il CAVO, cioè il modello: se la mappa lo dipinge rosso,
        // qui non può esserci il grigio della VLAN 1.
        const vlDotColor=(_pl && _pl.color) || store.state.vlanColors[vl] || '#6e7681';
        const srcNode=getNodeByPortId(l.src), dstNode=getNodeByPortId(l.dst);
        const srcLbl=(srcNode?.name||'?')+' · '+_cablePortDesc(l.src);
        const dstLbl=(dstNode?.name||'?')+' · '+_cablePortDesc(l.dst);
        const rstBtn=l.colorOvr?`<button class="prst" style="font-size:0.85rem" data-tip="${t('pnl.gen.resetAutoColor')}" data-act="link-color-reset" data-lid="${l.id}">↺</button>`:'';
        const colorResetBtn = isAuto ? '' : rstBtn;
        // Stato esplicito link (lib/linkwin.state.js): 'ambiguous' = dedotto con
        // confidence < 0.80 (MAC/ARP/FDB). Va proposto all'utente per verifica.
        const _isAmbiguous = (typeof win.linkState === 'function') && win.linkState(l).key === 'ambiguous';
        // Due banner mutuamente esclusivi sopra le proprieta':
        //   - giallo CTA "da verificare" su link ambiguous: Conferma | Elimina
        //   - blu informativo su link autoLinked NON ambigui: Modifica (= promote)
        const verifyBanner = _isAmbiguous ? `<div class="link-verify-banner">
                <div class="link-verify-msg">
                    <i class="fas fa-circle-question"></i>
                    <span>${t('cable.verifyMsg')}</span>
                </div>
                <div class="link-verify-actions">
                    <button class="toolbar-btn primary" data-act="link-promote" data-lid="${l.id}"><i class="fas fa-check"></i> ${t('common.confirm')}</button>
                    <button class="toolbar-btn danger" data-act="link-del" data-lid="${l.id}"><i class="fas fa-trash"></i> ${t('common.delete')}</button>
                </div>
            </div>` : '';
        const autoEditBar = (isAuto && !_isAmbiguous) ? `<div style="margin-top:8px;padding:8px 10px;background:rgba(9,105,218,.06);border:1px solid rgba(9,105,218,.20);border-radius:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:0.78rem">
                <span style="color:var(--text-muted)">${t('cable.autoEditMsg')}</span>
                <button class="toolbar-btn primary" data-act="link-promote" data-lid="${l.id}"><i class="fas fa-pen"></i> ${t('common.edit')}</button>
            </div>` : '';
        // Trunk EFFETTIVO (derivato dalle VLAN trasportate da voce/SSID, o manuale).
        const tk = (typeof _getLinkTrunk==='function') ? _getLinkTrunk(l)
                 : { mode: l.mode==='trunk'?'trunk':'access', native: vl, vlans: (typeof _parseTrunkVlans==='function'?_parseTrunkVlans(l.trunkVlans||''):[]), carried:[], derived:false };
        const isTrunk = tk.mode === 'trunk';
        // «Perché questo colore»: si mostra solo quando AGGIUNGE qualcosa — il cavo
        // è dipinto da una VLAN diversa da quella scritta sopra, oppure non se ne
        // conosce nessuna, oppure la scelta è una convenzione e va dichiarata.
        // La riga «Questo cavo» compare quando aggiunge qualcosa alla riga sopra:
        // se il colore racconta un'altra storia (trunk, instradato, VLAN diversa
        // da quella mostrata) — e SEMPRE quando la VLAN è un DEFAULT invece di una
        // lettura. Il numero coincide, la provenienza no, ed è l'unica cosa che
        // distingue «VLAN 1 misurata» da «VLAN 1 perché nessuno ne ha assegnata
        // un'altra»: tacerla rimetterebbe un default a passare per una misura.
        const _presunta = _pl && (_pl.source === 'site-native' || _pl.source === 'untagged');
        // ⛔ Sul trunk quella riga direbbe una TERZA volta cio' che la pastiglia TRUNK
        // in alto e le VLAN trasportate qui sotto dicono gia'. Non e' una provenienza
        // nascosta: un trunk multi-VLAN non afferma nessuna VLAN, quindi non c'e'
        // nessun ripiego che possa passare per una misura. Ovunque altro la riga
        // resta, ed e' li' che serve davvero.
        // ⚠️ 'conflict' esce come 'trunk': la riga sopra PORTA GIA' tutto il messaggio
        // («i due capi non concordano — 20 da una parte, 30 dall'altra»), e ripeterla
        // sotto identica è la ripetizione che questa sezione ha già tolto una volta.
        const _paint = (_pl && _pl.kind !== 'trunk' && _pl.kind !== 'conflict' && (_presunta || _pl.kind !== 'vlan' || _pl.vlan !== vl)) ? _pl : null;
        const trunkVlans = l.trunkVlans || '';
        // Capo ATTIVO del trunk: la nativa è il PVID (vlanOvr) di quella porta →
        // editabile inline. Se nessun capo è attivo, la nativa arriva da monte.
        const _nativeActivePid = (TYPES[getNodeByPortId(l.src)?.type]?.isActive) ? l.src
                               : (TYPES[getNodeByPortId(l.dst)?.type]?.isActive) ? l.dst : null;
        // ⚠️ Il campo VLAN è EDITABILE e scrive un override sulla porta attiva:
        // pre-compilarlo con un ripiego afferma una cosa che nessuno ha detto, ed è
        // esattamente il «VLAN 1» che l'utente vedeva su un cavo dipinto 99. Porta
        // solo la DICHIARAZIONE; il resto vive nel placeholder, che non afferma.
        const _dichiarata = _nativeActivePid ? store.state.ports[_nativeActivePid]?.vlanOvr : undefined;
        // (La vecchia riga "Rilevato automaticamente" sotto la VLAN e' stata
        // rimossa: protocollo e confidence ora vivono come badge nella riga
        // Stato, accanto a Membro LAG/AUTO — UI uniforme.)
        // Il nome accompagna il numero che si mostra: se il cavo è in VLAN 99, il
        // nome è quello della 99, non quello della nativa.
        const _vlMostrata = _plVlan != null ? _plVlan : vl;
        const vlanName = store.state.vlanNames[_vlMostrata] ? escapeHTML(store.state.vlanNames[_vlMostrata]) : '';
        // La pastiglia TRUNK/ACCESS vive in alto, nella riga «Stato», insieme agli
        // altri badge del cavo: dice che cos'e' il COLLEGAMENTO, non che VLAN porta.
        // Qui sotto resta la sola forma ACCESS: la lettura del trunk (nativa +
        // trasportate) ripeteva parola per parola i due campi della sezione, e le
        // pastiglie colorate la dicono meglio di una riga di testo.
        const vlanBadge = `<span style="display:inline-flex;align-items:center;gap:6px">
                 <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${escapeHTML(vlDotColor)};flex-shrink:0;border:1px solid rgba(255,255,255,.18)"></span>
                 <b>${_pl ? escapeHTML(_pl.text) : `VLAN ${vl}`}</b>${vlanName?`<span style="color:var(--text-muted)">— ${vlanName}</span>`:''}
               </span>`;

        // Il riquadro di lettura in testa alla sezione. Su un ACCESS dice qual e' la
        // VLAN e la lascia dichiarare; su un TRUNK non dice piu' niente, e allora non
        // c'e' proprio — un gruppo vuoto lascerebbe uno spazio che sembra un errore.
        // ⚠️ Scritto a pezzi NOMINATI e non come funzione al volo: lo scanner
        // dell'escaping sa risolvere una variabile, non una IIFE, e cio' che non sa
        // dimostrare finisce nel residuo del cricchetto.
        const _vlanLettura = _nativeActivePid
            ? `<div style="display:flex;align-items:center;gap:8px">
                     <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${escapeHTML(vlDotColor)};flex-shrink:0;border:1px solid rgba(255,255,255,.18)"></span>
                     <input type="number" min="1" max="4094" value="${escapeHTML(_dichiarata != null ? _dichiarata : '')}"
                            placeholder="${escapeHTML(_vlMostrata)}" ${lockAttr} style="flex:1"
                            data-change="link-native-vlan" data-lid="${escapeHTML(l.id)}" data-tip="${t('cable.accessVlanTip')}">
                   </div>
                   ${vlanName?`<div style="font-size:0.7rem;color:var(--text-muted);margin-top:3px"><i class="fas fa-tag" style="font-size:0.6rem;margin-right:3px"></i>${vlanName}</div>`:''}`
            : `<div style="padding:4px 0;font-size:0.83rem;color:var(--text-main)">${vlanBadge}</div>`;
        const _vlanCorpo = isTrunk ? '' : _vlanLettura;
        const _vlanProv = _paint ? `<div style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:0.72rem;color:var(--text-muted)"
                     data-tip="${escapeHTML(_paint.tip || '')}" data-tip-pos="bottom">
                   <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${escapeHTML(_paint.color)};flex-shrink:0"></span>
                   ${t('cable.paintLabel')}: <b style="color:var(--text-main);font-weight:600">${escapeHTML(_paint.text)}</b>
                   ${_paint.why ? `<span>· ${escapeHTML(_paint.why)}</span>` : ''}
                 </div>` : '';
        const _vlanReadout = (_vlanCorpo || _vlanProv) ? `<div class="prop-group">${_vlanCorpo}${_vlanProv}</div>` : '';

        const autoLbl = _cableAutoLabel(l);
        const hasManualLbl = !!l.label;
        const linkHeaderTitle = l.label || autoLbl || l.id || (l.wireless ? 'Wireless' : t('cable.cable'));
        const linkHeaderSubtitle = l.wireless ? t('cable.wirelessAssoc') : (l.autoLinked ? t('cable.autoCable') : t('cable.cable'));

        // Stato esplicito del link (lib/linkwin.state.js) — derivato, sola lettura.
        // Per i cavi "inferiti" il badge usa label "AUTO" + colore arancione,
        // coerente con la convenzione visiva applicata in topology.
        const _ls = (typeof win.linkState === 'function') ? win.linkState(l) : null;
        const _lsCol = { manual:'#57606a', lag:'#a371f7', discovered:'#1a7f37', ambiguous:'#f5a623' };
        const _lsLabel = _ls && _ls.key === 'ambiguous' ? 'AUTO' : (_ls ? _ls.label : '');
        // Badge protocollo (LLDP blu / CDP arancio, incluse label fuse 'LLDP+MAC')
        // accanto al badge di stato, STESSA altezza/forma: UI uniforme. Sostituisce
        // la vecchia riga "Rilevato automaticamente" sotto la VLAN.
        const _lsProtoStr = _ls ? String(_ls.protocol||'') : '';
        const _lsProtoCol = _lsProtoStr.startsWith('LLDP') ? '#0969da' : _lsProtoStr.startsWith('CDP') ? '#e8640a' : '#57606a';
        // Badge STATO-DI-PROVA del cavo, accanto ai badge di provenienza (stessa
        // forma). Solo dopo una Verifica (≥1 nodo con proof): senza dati di prova
        // niente badge — non spacciamo per fantasma un cavo verso estremi mai
        // verificati. Il dichiarato resta «Dichiarato» (cablaggio ≠ liveness).
        const _pfOn = (typeof cableProof === 'function') && store.state.nodes.some(n => n && n.proof);
        const _pfBadge = _pfOn ? _cableProofBadgeHtml(cableProof(l, srcNode && srcNode.proof, dstNode && dstNode.proof)) : '';
        // Miscablaggio: la porta annuncia via LLDP/CDP un vicino diverso dal cavo →
        // dice COSA vede vs COSA dice il documento (spec Proof-State §4.3).
        const _misName = (id) => { const nn = (store.state.nodes || []).find(x => x && x.id === id); return (nn && getNodeDisplayName(nn)) || String(id || ''); };
        const miscabledBanner = l.miscabled ? `<div class="link-verify-banner" style="border-color:rgba(207,34,46,.40);background:rgba(207,34,46,.08)">
                <div class="link-verify-msg"><i class="fas fa-triangle-exclamation" style="color:#cf222e"></i>
                    <span>${t('cable.miscabledMsg', { obs: escapeHTML(_misName(l.miscabled.observed)), decl: escapeHTML(_misName(l.miscabled.declared)) })}</span>
                </div></div>` : '';
        // Modalita' della porta come PASTIGLIA, in testa ai badge del cavo: risponde
        // alla stessa domanda degli altri («che cos'e' questo collegamento») ed e' la
        // piu' generale, quindi viene prima. Stessa geometria dei vicini — il bordo
        // di 1px compensa 1px di padding — cosi' le altezze coincidono.
        // Un'associazione wireless non ha modalita' di porta: nessuna pastiglia.
        const _chipGeom = 'padding:2px 10px;border-radius:5px;font-weight:700;font-size:0.89rem';
        const _modeChip = l.wireless ? '' : (isTrunk
            ? `<span data-tip="${t('cable.portMode')}" style="${_chipGeom};background:#0e2233;border:1px solid #2d6a9f;color:#5ba3f5">TRUNK</span>`
            : `<span data-tip="${t('cable.portMode')}" style="${_chipGeom};background:rgba(110,118,129,.12);border:1px solid var(--panel-border);color:var(--text-muted)">ACCESS</span>`);
        // Larghezza NATURALE del gruppo (`flex-basis:auto` + `flex-grow:0`): i badge
        // occupano quel che serve loro su una riga sola. A cedere e' il campo Tipo, che
        // shrink-a 100 volte piu' in fretta — «Cavo (auto)» sta in poco, i badge no.
        // Se il pannello si stringe oltre il ragionevole i badge tornano a capo invece
        // di sfondare il pannello: e' l'ultimo ripiego, non il comportamento normale.
        const stateRow = (_ls || _modeChip) ? `<div class="prop-group" style="flex:0 1 auto;min-width:0;padding-right:10px"><label style="text-align:right">${t('common.status')}</label>
            <div class="link-state-badges" style="display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:4px 0;flex-wrap:wrap">
              ${_modeChip}
              ${_ls?`<span style="background:${escapeHTML(_lsCol[_ls.key]||'#57606a')};color:#fff;padding:3px 11px;border-radius:5px;font-weight:700;font-size:0.89rem">${escapeHTML(_lsLabel)}</span>`:''}
              ${_lsProtoStr?`<span style="background:${escapeHTML(_lsProtoCol)};color:#fff;padding:3px 11px;border-radius:5px;font-weight:700;font-size:0.89rem">${escapeHTML(_lsProtoStr)}</span>`:''}${_pfBadge}
              ${_ls&&_ls.confidence!=null?`<span style="font-size:0.88rem;color:var(--text-muted)">${Math.round(_ls.confidence*100)}%</span>`:''}
            </div></div>` : '';

        // Anteprima della fisarmonica chiusa: la risposta in una riga sola — quella
        // che il MODELLO da' al cavo, col suo colore davanti. Il CSS di casa la
        // nasconde da sola quando la sezione si apre, cosi' non si ripete mai.
        const _vlanPreview = `<span class="props-collapsible-preview"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${escapeHTML((_pl && _pl.color) || vlDotColor)};border:1px solid rgba(255,255,255,.18);margin-right:6px"></span>${escapeHTML(_pl ? _pl.text : `VLAN ${vl}`)}</span>`;

        const _linkDeleteTip = l.autoLinked ? t('cable.delTipAuto') : t('cable.delTip');
        panel.innerHTML=`
            ${_buildPropsHeader(
                linkHeaderTitle,
                linkHeaderSubtitle,
                'fa-link',
                `<span class="props-toggles"><button class="props-toggle-btn" data-act="props-expand-all" data-tip="${t('props.expandAll')}"><i class="fas fa-angles-down"></i></button><button class="props-toggle-btn" data-act="props-collapse-all" data-tip="${t('props.collapseAll')}"><i class="fas fa-angles-up"></i></button><button class="props-toggle-btn" data-act="props-reset-sections" data-tip="${t('props.resetSections')}"><i class="fas fa-rotate"></i></button><button class="props-toggle-btn danger" data-act="link-del" data-lid="${l.id}" data-tip="${_linkDeleteTip}"><i class="fas fa-trash"></i></button></span>`
            )}
            <div class="prop-row2">
              <div class="prop-group" style="flex:1 1 0;min-width:64px"><label>${t('common.type')}</label><input disabled style="width:100%;text-overflow:ellipsis" value="${escapeHTML(l.wireless?'Wireless':t('cable.cable'))}${l.autoLinked?' (auto)':''}"></div>
              ${stateRow}
            </div>
            <div class="prop-group"><label>${t('cable.from')}</label><input disabled value="${escapeHTML(srcLbl)}"></div>
            <div class="prop-group"><label>${t('cable.to')}</label><input disabled value="${escapeHTML(dstLbl)}"></div>
            <div class="prop-group">
              <label style="display:flex;align-items:center;gap:5px">
                ${t('cable.label')}
                ${hasManualLbl?`<button class="prst" data-tip="${t('pnl.gen.resetAutoLabel')}" data-act="link-label-reset" data-lid="${l.id}">↺</button>`:''}
              </label>
              <input type="text"
                     value="${escapeHTML(l.label||'')}"
                     placeholder="${escapeHTML(autoLbl)}"
                     style="width:100%"
                     ${lockAttr}
                     data-change="link-label" data-lid="${l.id}">
              ${hasManualLbl?`<div style="font-size:0.7rem;color:var(--text-muted);margin-top:3px"><i class="fas fa-arrow-right-arrow-left" style="font-size:0.6rem;margin-right:3px"></i>${escapeHTML(autoLbl)}</div>`:''}
            </div>
            ${verifyBanner}
            ${autoEditBar}${miscabledBanner}

            <details class="props-collapsible props-primary" ${_propsSectionIsOpen('link-vlan')?'open':''} data-toggle="props-section" data-section="link-vlan" style="margin-top:14px">
              <summary class="props-collapsible-head"><span><i class="fas fa-network-wired"></i> VLAN</span>${_vlanPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
              <div class="props-collapsible-body">
            ${_vlanReadout}

            <div class="prop-group" style="margin-top:10px;border-top:1px solid var(--panel-border);padding-top:10px">
              <label>${t('cable.portMode')}</label>
              <div style="display:flex;gap:6px;margin-top:4px">
                <button class="toolbar-btn${!isTrunk?' soft':''}" style="flex:1;padding:5px" ${lockAttr}
                  data-act="link-mode" data-lid="${l.id}" data-mode="access">
                  <i class="fas fa-circle" style="font-size:0.6rem"></i> Access
                </button>
                <button class="toolbar-btn${isTrunk?' soft':''}" style="flex:1;padding:5px" ${lockAttr}
                  data-act="link-mode" data-lid="${l.id}" data-mode="trunk">
                  <i class="fas fa-layer-group" style="font-size:0.7rem"></i> Trunk
                </button>
              </div>
            </div>

            ${isTrunk ? `
            <div class="prop-group">
              <label>${t('cable.trunkNativeLabel')}</label>
              ${_nativeActivePid
                ? `<input type="number" min="1" max="4094" value="${tk.native}" ${lockAttr}
                     data-change="link-native-vlan" data-lid="${l.id}"
                     data-tip="${t('cable.trunkNativeTip')}">`
                : `<div style="padding:4px 0;font-size:0.8rem;color:var(--text-muted)">VLAN ${tk.native} <span style="font-size:0.7rem">· ${t('cable.trunkNativeUpstream')}</span></div>`}
            </div>
            <div class="prop-group" id="trunk-vlans-group">
              <label style="display:flex;align-items:center;gap:5px">
                ${t('cable.trunkVlans')}
                <span style="font-size:0.68rem;color:var(--text-muted)">(es. 10,20,100-200)</span>
              </label>
              ${_vlanPills(tk.vlans)}
              ${tk.derived ? `
              <div class="trunk-derived"><i class="fas fa-wand-magic-sparkles"></i> ${t('cable.trunkAuto')}: <b>${tk.vlans.join(', ')}</b></div>
              <div style="font-size:0.7rem;color:var(--text-muted);margin:4px 0 6px">${t('cable.trunkAutoNote')}</div>
              <input type="text" value="" placeholder="${tk.vlans.join(',')}"
                style="width:100%" ${lockAttr}
                data-change="link-trunk-vlans" data-lid="${l.id}"
                data-blur="link-trunk-vlans">` : `
              <input type="text" value="${escapeHTML(trunkVlans)}" placeholder="1,10,20,100"
                style="width:100%" ${lockAttr}
                data-change="link-trunk-vlans" data-lid="${l.id}"
                data-blur="link-trunk-vlans">
              <div style="font-size:0.7rem;color:var(--text-muted);margin-top:3px">
                ${t('cable.vlansConfigured',{n:_parseTrunkVlans(trunkVlans).length})}
              </div>`}
            </div>` : ''}

            <div class="prop-group" style="margin-top:10px;border-top:1px solid var(--panel-border);padding-top:10px">
              <label style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                ${t('cable.colorOverride')}
                ${colorResetBtn}
              </label>
               <input type="color" value="${l.colorOvr||autoColor}"
                      style="width:100%;${l.colorOvr?'border-color:#e3b341':''}" ${lockAttr}
                      data-change="link-color" data-lid="${l.id}">
            </div>
              </div>
            </details>
            ${(()=>{
                // Wireless: nessun percorso FISICO (è un'associazione radio).
                // L'eventuale percorso via repeater/mesh è un concetto diverso (da fare).
                if(l.wireless) return '';
                const _physicalPath = typeof _getLinkPhysicalView === 'function' ? _getLinkPhysicalView(l) : null;
                const _segments = Array.isArray(_physicalPath?.segments) && _physicalPath.segments.length
                    ? _physicalPath.segments
                    : (Array.isArray(l.segments) ? l.segments.filter(s=>s && (s.from || s.to)) : []);
                const _isSegmented = _segments.length > 1;
                const _portPathLabel = (pid) => {
                    if(!pid) return '—';
                    const _node = getNodeByPortId(pid);
                    if(!_node) return escapeHTML(typeof _portDisplayName==='function' ? _portDisplayName(pid) : String(pid));
                    const _baseName = _node.type==='wallport'
                        ? (getWallPortLabel(_node) || getNodeDisplayName(_node) || _node.id)
                        : (getNodeDisplayName(_node) || _node.name || _node.id);
                    const _rawPort = String(pid).split('-').slice(1).join('/');
                    const _portName = typeof _portDisplayName==='function' ? _portDisplayName(pid) : _rawPort;
                    const _showPort = _node.type!=='wallport' && (
                        (Number(_node.ports || TYPES[_node.type]?.ports || 0) > 1) ||
                        TYPES[_node.type]?.isRack ||
                        (_portName && _portName !== '?' && _portName !== _rawPort)
                    );
                    return escapeHTML(_showPort ? `${_baseName} / ${_portName}` : _baseName);
                };
                const _pathPids = Array.isArray(_physicalPath?.pathPids) && _physicalPath.pathPids.length
                    ? _physicalPath.pathPids.filter(Boolean)
                    : (_segments.length
                        ? [_segments[0]?.from, ..._segments.map(s=>s.to)].filter(Boolean)
                        : [l.src, l.dst].filter(Boolean));
                // Hop con pid: serve per i bottoni "togli tappa" sulle tappe
                // intermedie pass-through (dedup consecutivo per label, tiene
                // il primo pid — i mediaconv 'device' producono 2 pid stessa label).
                const _pathHops = _pathPids
                    .map(pid => ({ pid, label: _portPathLabel(pid) }))
                    .filter(h => h.label)
                    .filter((h, idx, arr) => idx === 0 || h.label !== arr[idx-1].label);
                const _pathLabels = _pathHops.map(h => h.label);
                // Validazione INFORMATIVA della struttura complessiva (P1.5-bis):
                // tipi ordinati lungo il percorso → badge ⚠ se la catena e'
                // anomala (apparato in mezzo, ordine non monotono, troppi nodi…).
                // Non bloccante: l'editor impedisce gia' le tappe fuori posto.
                const _chainTypes = _pathHops.map(h => getNodeByPortId(h.pid)?.type).filter(Boolean);
                const _chainCheck = (typeof win.validateCablingChain === 'function')
                    ? win.validateCablingChain(_chainTypes)
                    : { ok: true, warnings: [] };
                const _chainWarnHtml = (!_chainCheck.ok && _chainCheck.warnings.length)
                    ? `<div class="prop-group" style="margin-top:10px;padding:8px 10px;border:1px solid #b8860b;border-radius:8px;background:rgba(245,197,24,.08)">
                         <div style="font-size:.82rem;font-weight:700;color:#f5c518;margin-bottom:4px"><i class="fas fa-triangle-exclamation"></i> ${t('cable.chainAnomaly')}</div>
                         <ul style="margin:0;padding-left:18px;font-size:.8rem;color:var(--text-muted);line-height:1.45">
                           ${chainWarnTexts(_chainCheck.warnings).map(m => `<li>${escapeHTML(m)}</li>`).join('')}
                         </ul>
                       </div>`
                    : '';
                const _chainWarnBadge = _chainWarnHtml
                    ? `<span class="props-collapsible-preview" style="color:#f5c518" data-tip="${t('cable.chainAnomaly')}"><i class="fas fa-triangle-exclamation"></i></span>`
                    : '';
                const _totalLength = _isSegmented
                    ? _segments.reduce((sum, s)=>{
                        const val = Number(s.length ?? s.lengthM);
                        return Number.isFinite(val) ? sum + val : sum;
                    }, 0)
                    : Number(l.length ?? l.lengthM);
                const _hasTotalLength = Number.isFinite(_totalLength) && _totalLength > 0;
                const _permanentCount = _isSegmented
                    ? _segments.filter(s=>s.isPermanent===true || s.permanent===true).length
                    : (l.isPermanent===true ? 1 : 0);
                const _patchCount = _isSegmented
                    ? _segments.filter(s=>s.isPermanent===false || s.permanent===false).length
                    : (l.isPermanent===false ? 1 : 0);
                const _selectedSegmentIndex = _physicalPath?.selectedSegmentIndex || _segments.findIndex(s=>s.isSelected) + 1 || null;
                const _pathPreviewBits = [];
                if(_isSegmented) _pathPreviewBits.push(t('cable.segmentsN',{n:_segments.length}));
                else _pathPreviewBits.push(t('pnl.gen.directShort'));
                if(_hasTotalLength) _pathPreviewBits.push(`${String(_totalLength).replace(/\\.0$/,'')} m`);
                const _pathPreview = _pathPreviewBits.length
                    ? `<span class="props-collapsible-preview">${_pathPreviewBits.join(' · ')}</span>`
                    : '';
                const _summaryBits = [];
                if(_isSegmented) _summaryBits.push(t('cable.segmentsN',{n:_segments.length}));
                else _summaryBits.push(t('cable.directLink'));
                if(_hasTotalLength) _summaryBits.push(t('cable.totalM',{n:String(_totalLength).replace(/\\.0$/,'')}));
                if(_permanentCount) _summaryBits.push(`${_permanentCount} permanent link${_permanentCount===1?'':'s'}`);
                if(_patchCount) _summaryBits.push(`${_patchCount} patch cord`);
                if(_isSegmented && _selectedSegmentIndex) _summaryBits.push(t('cable.segSelected',{n:_selectedSegmentIndex}));
                if(_physicalPath?.ambiguous) _summaryBits.push(t('cable.partialPath'));
                // Percorso renderizzato hop per hop: le tappe intermedie
                // pass-through con esattamente 2 cavi mostrano il bottone
                // "togli tappa" (✕) che fonde i 2 tratti in un cavo diretto.
                const _pathText = _pathHops.length
                    ? _pathHops.map((h, idx) => {
                        const isMid = idx > 0 && idx < _pathHops.length - 1;
                        const removable = isMid &&
                            typeof _routeHopRemovable === 'function' && _routeHopRemovable(h.pid);
                        const rm = removable
                            ? `<button class="toolbar-btn danger" style="padding:0 5px;margin:0 0 0 3px;font-size:.62rem;line-height:1.4;vertical-align:1px"
                                 data-tip="${t('pnl.gen.removeHopTip')}"
                                 data-act="link-remove-hop" data-pid="${escapeHTML(h.pid)}"><i class="fas fa-times"></i></button>`
                            : '';
                        return `<span style="white-space:nowrap">${h.label}${rm}</span>`;
                      }).join(' <span style="color:var(--active-color)">→</span> ')
                    : t('pnl.gen.pathUnavailable');
                const _segmentsHtml = _isSegmented ? _segments.map((s, idx)=>{
                    const _from = _portPathLabel(s.from);
                    const _to = _portPathLabel(s.to);
                    const _segBits = [];
                    if(s.cableType) _segBits.push(escapeHTML(String(s.cableType)));
                    else if(s.type) _segBits.push(escapeHTML(String(s.type)));
                    const _segLen = Number(s.length ?? s.lengthM);
                    if(Number.isFinite(_segLen) && _segLen > 0) _segBits.push(`${String(_segLen).replace(/\\.0$/,'')} m`);
                    _segBits.push((s.isPermanent===true || s.permanent===true) ? 'Permanent link' : (s.isPermanent===false || s.permanent===false) ? 'Patch cord' : t('common.unspecifiedM'));
                    const _selBadge = s.isSelected ? `<span style="font-size:.64rem;color:var(--active-color);font-weight:700">${t('cable.selected')}</span>` : '';
                    // Segmento selezionato: verde "OK" ben visibile sul fondo scuro
                    // (bordo verde pieno + sfondo verde tenue).
                    const _segBorder = s.isSelected ? 'var(--active-color)' : 'var(--panel-border)';
                    const _segBg = s.isSelected ? 'rgba(57,211,83,.12)' : 'rgba(255,255,255,.02)';
                    // Segmento cliccabile → seleziona quel tratto (link) per editarlo,
                    // mantenendo il percorso evidenziato (selectPathSegment).
                    // NB: niente secondo attributo style qui — l'elemento ha gia' lo
                    // style principale (bordo/sfondo); un secondo `style` verrebbe
                    // ignorato dal browser e annullerebbe bordo+sfondo. Il cursore
                    // pointer e' gia' nello style principale.
                    const _segClick = s.linkId ? ` data-act="link-seg-pick" data-seglink="${escapeHTML(s.linkId)}"` : '';
                    return `<div class="prop-group seg-pick${s.isSelected?' sel':''}"${_segClick} data-tip="${t('cable.segPickTip')}" style="margin-bottom:8px;padding:8px 10px;border:1px solid ${_segBorder};border-radius:8px;background:${_segBg}${s.linkId?';cursor:pointer':''}">
                        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:4px">
                          <div style="font-size:.9rem;font-weight:700;color:var(--text-main)">${s.isSelected?'<i class="fas fa-caret-right" style="color:var(--active-color);margin-right:4px"></i>':''}${t('cable.segmentN',{n:idx+1})}</div>
                          <div style="display:flex;align-items:center;gap:8px;font-size:.8rem;color:var(--text-muted)">${_selBadge}<span>${_segBits.join(' · ')}</span></div>
                        </div>
                        <div style="font-size:.88rem;color:var(--text-main);line-height:1.4">${_from} <span style="color:var(--active-color)">→</span> ${_to}</div>
                      </div>`;
                }).join('') : `
                    <div style="font-size:.88rem;color:var(--text-muted);line-height:1.45">
                      ${t('cable.directLinkDesc')}
                    </div>`;
                return `<details class="props-collapsible props-secondary" ${_propsSectionIsOpen('link-physical-path')?'open':''} data-toggle="props-section" data-section="link-physical-path" style="margin-top:14px">
                  <summary class="props-collapsible-head"><span><i class="fas fa-route"></i> ${t('cable.physicalPath')}</span>${_chainWarnBadge}${_pathPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
                  <div class="props-collapsible-body">
                    <div class="prop-group" style="padding:10px 12px;border:1px solid var(--panel-border);border-radius:8px;background:rgba(255,255,255,.02)">
                      <div style="font-size:.86rem;font-weight:700;color:var(--text-main);margin-bottom:6px">${t('cable.path')}</div>
                      <div style="font-size:.9rem;color:var(--text-main);line-height:1.45">${_pathText}</div>
                      <div style="font-size:.82rem;color:var(--text-muted);margin-top:8px">${_summaryBits.join(' · ')}</div>
                    </div>
                    ${_chainWarnHtml}
                    <div class="prop-group" style="margin-top:10px">
                      <button class="toolbar-btn soft" style="width:100%;justify-content:center;gap:8px"
                              data-tip="${t('cable.splitTip')}"
                              data-act="link-route" data-lid="${l.id}">
                        <i class="fas fa-route"></i> ${t('cable.routeThrough')}
                      </button>
                    </div>
                    <div style="margin-top:10px">${_segmentsHtml}</div>
                  </div>
                </details>`;
            })()}

            ${(()=>{
                // P1.4 — Validazioni smart incompatibilità: problemi calcolati 1 volta,
                // riusati per il badge ⚠ nel preview (visibile a sezione chiusa) e per
                // il banner educativo in cima al corpo. SNMP dai due estremi per i
                // cross-check realtà↔doc.
                const _vsp = store.state.ports[l.src] || {}, _vdp = store.state.ports[l.dst] || {};
                // Wireless: nessuna validazione cavo fisico (rame/fibra/lunghezza
                // non si applicano a un'associazione radio).
                const _wlOn = !!l.wireless;
                // Native VLAN mismatch: solo fra due apparati ATTIVI (switch↔switch);
                // su un AP/endpoint la nativa non è un PVID confrontabile.
                const _sAct = !!TYPES[getNodeByPortId(l.src)?.type]?.isActive;
                const _dAct = !!TYPES[getNodeByPortId(l.dst)?.type]?.isActive;
                const _bothActive = _sAct && _dAct;
                const _cableIssues = (!_wlOn && typeof win.validateCable === 'function')
                    ? win.validateCable(l, { snmpSpeedMbps: _vsp.speed || _vdp.speed || 0,
                                         snmpMedium: _vsp.snmpMedium || _vdp.snmpMedium || null,
                                         isTrunk: tk.mode === 'trunk',
                                         srcNative: _bothActive ? _effPortVlan(l.src) : null,
                                         dstNative: _bothActive ? _effPortVlan(l.dst) : null,
                                         // Le VLAN TRASPORTATE da ciascun capo, per il confronto delle
                                         // liste consentite. Si passa `trunkVlans` — cioe' cio' che QUEL
                                         // capo dichiara o misura — e non `trunkProp`, che e' propagata
                                         // dall'altro lato: confrontare una propagazione con la sua
                                         // sorgente farebbe sempre risultare i due capi d'accordo.
                                         srcVlans: _parseTrunkVlans(_vsp.trunkVlans || []),
                                         dstVlans: _parseTrunkVlans(_vdp.trunkVlans || []),
                                         // La contraddizione fra i due capi è già DECISA dal modello del
                                         // colore (`_linkPaintVlan`): qui si consegna il verdetto, non si
                                         // rifà il calcolo. Rifarlo sarebbe la solita coppia di strati che
                                         // un giorno rispondono diverso alla stessa domanda.
                                         vlanConflict: (_pl && _pl.kind === 'conflict') ? _pl : null })
                    : [];
                // Wireless = connessione radio↔radio (tipologia a sé, non un flag
                // attivabile su un cavo). Sezione dedicata, niente specifiche cavo.
                if(_wlOn){
                    return `<details class="props-collapsible props-secondary" open style="margin-top:14px">
              <summary class="props-collapsible-head"><span><i class="fas fa-wifi"></i> ${t('cable.wirelessAssoc')}</span><span class="props-collapsible-preview">${t('radio.single')}</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
              <div class="props-collapsible-body">
                ${typeof _wifiAssocHtml==='function' ? _wifiAssocHtml(l) : ''}
                <div class="link-wireless-note"><i class="fas fa-circle-info"></i> ${t('pnl.gen.wifiInheritNote')}</div>
              </div></details>`;
                }
                const _cableHasErr = _cableIssues.some(i => i.level === 'error');
                const _cableBadge = _cableIssues.length
                    ? `<span class="props-collapsible-preview cable-warn-pill ${_cableHasErr?'lvl-error':'lvl-warn'}" data-tip="${_cableHasErr?t('pnl.gen.incompatDetected'):t('pnl.gen.compatWarning')}"><i class="fas fa-triangle-exclamation"></i> ${_cableIssues.length}</span>`
                    : '';
                const _cableBanner = _cableIssues.length ? `<div class="cable-validate-banner">${cableIssueTexts(_cableIssues).map(i=>`
                    <div class="cable-validate-row lvl-${i.level}">
                      <i class="fas ${i.level==='error'?'fa-circle-exclamation':'fa-triangle-exclamation'}"></i>
                      <div class="cable-validate-txt"><b>${escapeHTML(i.title)}</b><span>${escapeHTML(i.why)}</span></div>
                    </div>`).join('')}</div>` : '';
                const _physPreviewBits = [];
                if(l.isPermanent===true) _physPreviewBits.push('Permanent');
                else if(l.isPermanent===false) _physPreviewBits.push('Patch');
                if(l.cableType) _physPreviewBits.push(escapeHTML(String(l.cableType)));
                if(l.medium) _physPreviewBits.push(escapeHTML(l.medium==='fiber' ? t('cable.fiber') : l.medium==='dac' ? 'DAC' : t('cable.copper')));
                if(l.length!=null && l.length!=='') _physPreviewBits.push(`${escapeHTML(String(l.length))} m`);
                if(l.installedAt) _physPreviewBits.push(escapeHTML(String(l.installedAt)));
                const _physPreview = _physPreviewBits.length
                    ? `<span class="props-collapsible-preview">${_physPreviewBits.join(' · ')}</span>`
                    : '';
                return `<details class="props-collapsible props-secondary" ${(_cableIssues.length || _propsSectionIsOpen('link-physical-specs'))?'open':''} data-toggle="props-section" data-section="link-physical-specs" style="margin-top:14px">
              <summary class="props-collapsible-head"><span><i class="fas fa-ethernet"></i> ${t('cable.physicalSpecs')}</span>${_cableBadge}${_physPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
              <div class="props-collapsible-body">
              ${_cableBanner}
              ${(()=>{
                // Helper: class ovr (bordo arancio) se il campo ha un valore manuale
                const ovr=(key)=>l[key]!=null&&l[key]!==''?'ovr':'';

                // ---- SNMP auto-values rilevati dal port state dei due estremi -----
                const _sp=store.state.ports[l.src]||{}, _dp=store.state.ports[l.dst]||{};
                // Velocità e PoE sono proprietà END-TO-END del run (uguali su tutta la
                // tratta): se i capi diretti sono passanti senza dati, eredita dalla
                // porta ATTIVA a monte (_runActiveAnchor) — coerente con la porta
                // endpoint. Il MEZZO invece resta per-segmento (può cambiare: dorsale
                // fibra + bretella rame), quindi NON eredita dall'ancora.
                const _anchorPid = (typeof _runActiveAnchor==='function') ? _runActiveAnchor(l) : null;
                const _ap = _anchorPid ? (store.state.ports[_anchorPid]||{}) : {};
                // Mezzo fisico: primo port che ha dato SNMP (per-segmento)
                const _snmpMedRaw = _sp.snmpMedium || _dp.snmpMedium || null;
                const _snmpMedLbl = {copper:t('cable.copper'),fiber:t('pnl.gen.opticalFiber'),dac:'DAC'}[_snmpMedRaw] || null;
                // Velocità: ifHighSpeed dei capi diretti, o dell'ancora a monte del run
                const _snmpSpMbps = _sp.speed || _dp.speed || _ap.speed || 0;
                const _spToLbl=s=>{
                    if(!s) return null;
                    if(s>=100000) return '100G'; if(s>=40000) return '40G';
                    if(s>=25000)  return '25G';  if(s>=10000) return '10G';
                    if(s>=5000)   return '5G';   if(s>=2500)  return '2.5G';
                    if(s>=1000)   return '1G';   if(s>=100)   return '100M';
                    return s+'M';
                };
                const _snmpSpLbl = _spToLbl(_snmpSpMbps);
                // PoE: cerca src (switch/PSE) poi dst, poi l'ancora attiva del run
                const _snmpPoeDet = _sp.snmpPoe != null ? _sp.snmpPoe
                                  : (_dp.snmpPoe != null ? _dp.snmpPoe
                                  : (_ap.snmpPoe   != null ? _ap.snmpPoe : null));
                const _snmpPoeLbl = {none:t('o.none'),'802.3af':'802.3af — 15 W',
                    '802.3at':'802.3at — 30 W','802.3bt':'802.3bt — 90 W'}[_snmpPoeDet] || null;
                // Badge: visibile solo se SNMP ha un valore e l'utente non ha ancora impostato un override manuale
                const _snmpBadge=(lbl,key)=>lbl&&!l[key]
                    ?`<div style="font-size:0.68rem;color:#5ba3f5;margin-top:2px"><i class="fas fa-satellite-dish" style="font-size:0.6rem;margin-right:3px"></i>SNMP: <b>${escapeHTML(String(lbl))}</b></div>`:'';
                // -------------------------------------------------------------------

                const catLabel = l.medium==='fiber' ? t('cable.fiberType') : t('cable.category');
                const _derivedCableType = [
                    l.medium==='fiber' ? t('cable.fiber') : l.medium==='dac' ? 'DAC' : l.medium==='copper' ? t('cable.copper') : '',
                    l.cableCategory || '',
                    l.connector || ''
                ].filter(Boolean).join(' · ');

                return `
              <div class="prop-group">
                <label>${t('cable.type')}</label>
                <input type="text"
                       class="${ovr('cableType')}"
                       value="${escapeHTML(l.cableType||'')}"
                       placeholder="${escapeHTML(_derivedCableType || t('pnl.gen.cableTypePh'))}" ${lockAttr}
                       data-change="link-prop" data-lid="${l.id}" data-lprop="cableType">
              </div>

              <div class="prop-group">
                <label>${t('cable.segmentType')}</label>
                <select class="${ovr('isPermanent')}" ${lockAttr} data-change="link-prop" data-lid="${l.id}" data-lprop="isPermanent">
                  <option value="" ${l.isPermanent==null?'selected':''}>${t('common.unspecifiedM')}</option>
                  <option value="patch" ${l.isPermanent===false?'selected':''}>${t('cable.patchCord')}</option>
                  <option value="permanent" ${l.isPermanent===true?'selected':''}>Permanent link</option>
                </select>
              </div>

              <div class="prop-group">
                <label>${t('common.status')}</label>
                <select class="${ovr('cableStatus')}" ${lockAttr} data-change="link-prop" data-lid="${l.id}" data-lprop="cableStatus">
                  <option value="" ${!l.cableStatus?'selected':''}>${t('common.unspecifiedM')}</option>
                  <option value="active"     ${l.cableStatus==='active'    ?'selected':''}>${t('port.statusActive')}</option>
                  <option value="inactive"   ${l.cableStatus==='inactive'  ?'selected':''}>${t('port.statusInactive')}</option>
                  <option value="to_replace" ${l.cableStatus==='to_replace'?'selected':''}>${t('cable.toReplace')}</option>
                </select>
              </div>

              <div class="prop-group">
                <label>${t('cable.medium')}</label>
                <select class="${ovr('medium')}" ${lockAttr} data-change="link-prop" data-lid="${l.id}" data-lprop="medium" data-coerce="trim">
                  <option value="" ${!l.medium?'selected':''}>${t('common.unspecifiedM')}</option>
                  <option value="copper" ${l.medium==='copper'?'selected':''}>${t('cable.copper')}</option>
                  <option value="fiber" ${l.medium==='fiber'?'selected':''}>${t('cable.fiber')}</option>
                  <option value="dac" ${l.medium==='dac'?'selected':''}>DAC (Direct Attach)</option>
                </select>
                ${_snmpBadge(_snmpMedLbl,'medium')}
              </div>

              <div class="prop-group">
                <label>${catLabel}</label>
                <select class="${ovr('cableCategory')}" ${lockAttr} data-change="link-prop" data-lid="${l.id}" data-lprop="cableCategory" data-coerce="trim">
                  <option value="" ${!l.cableCategory?'selected':''}>${t('common.unspecifiedF')}</option>
                  <option value="Cat5e" ${l.cableCategory==='Cat5e'?'selected':''}>Cat 5e</option>
                  <option value="Cat6" ${l.cableCategory==='Cat6'?'selected':''}>Cat 6</option>
                  <option value="Cat6A" ${l.cableCategory==='Cat6A'?'selected':''}>Cat 6A</option>
                  <option value="Cat7" ${l.cableCategory==='Cat7'?'selected':''}>Cat 7</option>
                  <option value="Cat8" ${l.cableCategory==='Cat8'?'selected':''}>Cat 8</option>
                  <option value="OS2" ${l.cableCategory==='OS2'?'selected':''}>OS2 — Monomodale</option>
                  <option value="OM3" ${l.cableCategory==='OM3'?'selected':''}>OM3 — Multimodale 10G</option>
                  <option value="OM4" ${l.cableCategory==='OM4'?'selected':''}>OM4 — Multimodale 40/100G</option>
                  <option value="OM5" ${l.cableCategory==='OM5'?'selected':''}>OM5 — Multimodale SWDM</option>
                </select>
              </div>

              <div class="prop-group">
                <label>${t('cable.connector')}</label>
                <select class="${ovr('connector')}" ${lockAttr} data-change="link-prop" data-lid="${l.id}" data-lprop="connector" data-coerce="trim">
                  <option value="" ${!l.connector?'selected':''}>${t('common.unspecifiedM')}</option>
                  <option value="RJ45" ${l.connector==='RJ45'?'selected':''}>RJ45</option>
                  <option value="LC" ${l.connector==='LC'?'selected':''}>LC</option>
                  <option value="SC" ${l.connector==='SC'?'selected':''}>SC</option>
                  <option value="MPO/MTP" ${l.connector==='MPO/MTP'?'selected':''}>MPO / MTP</option>
                  <option value="SFP" ${l.connector==='SFP'?'selected':''}>SFP</option>
                  <option value="SFP+" ${l.connector==='SFP+'?'selected':''}>SFP+</option>
                  <option value="QSFP" ${l.connector==='QSFP'?'selected':''}>QSFP</option>
                  <option value="QSFP+" ${l.connector==='QSFP+'?'selected':''}>QSFP+</option>
                  <option value="QSFP28" ${l.connector==='QSFP28'?'selected':''}>QSFP28</option>
                </select>
              </div>

              <div class="prop-group">
                <label>${t('cable.maxSpeed')}</label>
                <select class="${ovr('maxSpeed')}" ${lockAttr} data-change="link-prop" data-lid="${l.id}" data-lprop="maxSpeed" data-coerce="trim">
                  <option value="" ${!l.maxSpeed?'selected':''}>${t('common.unspecifiedF')}</option>
                  <option value="100M" ${l.maxSpeed==='100M'?'selected':''}>100 Mbps</option>
                  <option value="1G" ${l.maxSpeed==='1G'?'selected':''}>1 Gbps</option>
                  <option value="2.5G" ${l.maxSpeed==='2.5G'?'selected':''}>2.5 Gbps</option>
                  <option value="5G" ${l.maxSpeed==='5G'?'selected':''}>5 Gbps</option>
                  <option value="10G" ${l.maxSpeed==='10G'?'selected':''}>10 Gbps</option>
                  <option value="25G" ${l.maxSpeed==='25G'?'selected':''}>25 Gbps</option>
                  <option value="40G" ${l.maxSpeed==='40G'?'selected':''}>40 Gbps</option>
                  <option value="100G" ${l.maxSpeed==='100G'?'selected':''}>100 Gbps</option>
                  <option value="400G" ${l.maxSpeed==='400G'?'selected':''}>400 Gbps</option>
                </select>
                ${_snmpBadge(_snmpSpLbl,'maxSpeed')}
              </div>

              <div class="prop-group">
                <label>${t('cable.lengthM')}</label>
                <input type="number" min="0" step="0.5"
                       class="${ovr('length')}"
                       value="${l.length!=null?l.length:''}"
                       placeholder="${t('pnl.gen.lengthPh')}" ${lockAttr}
                       data-change="link-prop" data-lid="${l.id}" data-lprop="length" data-coerce="num">
              </div>

              <div class="prop-group">
                <label>${t('cable.installedAt')}</label>
                <input type="date"
                       class="${ovr('installedAt')}"
                       value="${escapeHTML(l.installedAt||'')}"
                       ${lockAttr}
                       data-change="link-prop" data-lid="${l.id}" data-lprop="installedAt">
              </div>

              <div class="prop-group">
                <label>${t('cable.installedBy')}</label>
                <input type="text"
                       class="${ovr('installedBy')}"
                       value="${escapeHTML(l.installedBy||'')}"
                       placeholder="${t('cable.installedByPh')}" ${lockAttr}
                       data-change="link-prop" data-lid="${l.id}" data-lprop="installedBy">
              </div>

              <div class="prop-group">
                <label>PoE</label>
                <select class="${ovr('poe')}" ${lockAttr} data-change="link-prop" data-lid="${l.id}" data-lprop="poe" data-coerce="trim">
                  <option value="" ${!l.poe?'selected':''}>${t('common.unspecifiedM')}</option>
                  <option value="none" ${l.poe==='none'?'selected':''}>${t('o.none')}</option>
                  <option value="802.3af" ${l.poe==='802.3af'?'selected':''}>802.3af — 15 W</option>
                  <option value="802.3at" ${l.poe==='802.3at'?'selected':''}>802.3at — 30 W</option>
                  <option value="802.3bt" ${l.poe==='802.3bt'?'selected':''}>802.3bt — 90 W</option>
                </select>
                ${_snmpBadge(_snmpPoeLbl,'poe')}
              </div>

              <div class="prop-group">
                <label>${t('common.description')}</label>
                <textarea rows="3"
                          class="${ovr('notes')}"
                          placeholder="${t('pnl.gen.freeDescPh')}"
                          style="width:100%;resize:vertical;padding:5px 7px;font-size:var(--fs-lg);background:var(--bg-color);border:1px solid var(--panel-border);border-radius:4px;color:var(--text-main)" ${lockAttr}
                          data-change="link-prop" data-lid="${l.id}" data-lprop="notes">${escapeHTML(l.notes||'')}</textarea>
              </div>`;
              })()}
              </div></details>`;
            })()}

            `;
        _enableManualValueInProps(panel);
        _activatePropsTab('Cavo');
        return;
}

// Chiamati dal dispatcher renderProps() (app-properties.js, classic).
expose({ _renderLinkProps, _cablePortDesc });
