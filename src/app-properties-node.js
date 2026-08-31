// ============================================================
// PROPERTIES PANEL — renderer NODO (dispositivo/struttura, selType===node)
// ============================================================
// MODULO ESM (migrato da lib/app-properties-node.js): _renderNodeProps, l'ultima
// foglia del gruppo properties. Chiamato dal dispatcher renderProps (core, bundle)
// via window. ASSE B (Blocco 4, 2026-08-01): gli handler inline sono passati a
// EVENT DELEGATION — ogni on*= e' un attributo data-* + un'azione registrata in
// cima al modulo (vedi il blocco registerClickActions/ChangeActions/InputActions);
// le fn del dominio sono IMPORTATE, non piu' lette da window. Resta l'ALIAS-BLOCK
// solo per i pochi simboli lib-script (stack/ha-pair) ancora sul ponte + lo stato
// via store. selId/selType via store; t dal ponte. Nessun cambiamento di logica.
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, normalizeNumber } from './app-util.js';
import { nodeById, getNodeDisplayName, selected, _patchPanelOffset, _enableManualValueInProps, _activatePropsTab, getNodeRackSize, _patchPanelChainOptions, isRackTopNumbered, rackUToVisible, updateN, updateFrontPanel, getPortNodeId, deleteNode, visibleUToRackU, markDirty, logAudit } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderAll } from './app-render-core.js';   // P4: re-render dopo adozione/scarto del retype proposto
import { TYPES, typeName, _nodeSpecView, _fixedRackLabel, _frontPanelState } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES) + nome localizzato
import { _propsSectionIsOpen, _buildNetAccessHtml, renderProps, _buildPropsHeader, _propsIconForType, _buildPatchPanelPreview } from './app-properties.js';   // ritiro ponte: builder pannello (ex win.*)
import { osIconHtmlFor } from '../lib/os-icon.js';   // icona OS (accento colorato nell'intestazione device)
import { pduManagementPortCount } from '../lib/pdu-layout.js';
import { _discIdentityLabel } from './app-discovery-classify.js';   // ritiro ponte: alias-block sciolto (ex win.*)
import { _defaultStackName, setNodeStack, setNodeStackMemberId, removeNodeFromStack, acceptStackHint, dismissStackHint, setNodeHaPair, setNodeHaCluster, setNodeHaRole, setNodeHaMode, setNodeHaSync, removeNodeFromHa, _defaultHaGroupName } from './app-stack-ha.js';   // ritiro ponte: stacking/HA (ex win.*)
import { getLagGroupsForNode, setLagMode, setLagVlan, renameLag, dissolveLag } from './app-ports.js';   // ritiro ponte: alias-block sciolto + LAG manuali (ex win.*)
import { _nodeDeviceChainHtml } from './app-properties-node-devices.js';   // ritiro ponte: alias-block sciolto (ex win.*)
import { _l3SviSectionHtml } from './app-l3.js';   // ritiro ponte: alias-block sciolto (ex win.*)
import { _panelSkinSectionHtml } from './app-panel-skin.js';   // ritiro ponte: alias-block sciolto (ex win.*)
import { _deviceTypeApplyHtml } from './app-device-types.js';   // "Applica modello" (catalogo device-type)
import { registerClickActions, registerChangeActions, registerInputActions } from './app-delegation.js';   // ASSE B (Blocco 4): event delegation degli handler inline del pannello NODE
import { updateIntegration, pollSNMP } from './app-snmp.js';   // ritiro ponte: integrazione SNMP (ex win.*)
import { toggleRoomLock, _liveStructColor, _liveStructOpacity, moveNodeToRack } from './app-search-zoom-rack.js';   // ritiro ponte: lock stanza · colore/opacita' live · sposta rack (ex win.*)

// ── ASSE B (Blocco 4): event delegation degli handler del pannello NODE ──────
// Ogni on*= inline del renderer diventa un attributo data-* + un'azione qui. I
// parametri prima interpolati nell'handler (field, bounds, id nodo, gid LAG,
// ruolo/modalita' HA…) migrano in data-* e si leggono da el.dataset. Le fn del
// dominio (updateN/updateFrontPanel/updateIntegration/stack·HA/LAG…) sono
// IMPORTATE (niente window). I 3 bottoni espandi/comprimi/ripristina dell'header
// usano azioni CONDIVISE gia' registrate in app-properties.js.

// updateN(field, value): coercizione del valore in data-ncoerce — (assente)=stringa
//   · num=+value · int=normalizeNumber(v,def,min,max) · int-empty=''→undefined
//   · intdef=parseInt(v,10)||data-ndef · floatdef=parseFloat(v)||data-ndef · bool=el.checked
// intdef/floatdef/bool servono la catena device-spec (app-properties-node-devices.js,
// Blocco 5): preservano ESATTAMENTE il vecchio inline `parseInt(v)||N` / `parseFloat(v)||N`
// / `this.checked` — SENZA il clamp min/max di `int` (lì min/max erano solo hint HTML,
// mai applicati in JS: mapparli su `int` avrebbe cambiato il comportamento).
function _nVal(el){
    const c = el.dataset.ncoerce;
    if(c === 'num') return +el.value;
    if(c === 'bool') return el.checked;
    if(c === 'intdef')   return parseInt(el.value, 10) || +el.dataset.ndef;
    if(c === 'floatdef') return parseFloat(el.value)  || +el.dataset.ndef;
    // Paletto (2) «no invenzioni» — le coercizioni OPZIONALI. intdef/floatdef hanno il
    // default INVENTATO in data-ndef: svuotare il campo ci riscriveva quel numero, quindi
    // «non lo so» non era esprimibile. Le opzionali usano lo stesso parser con UN esito in
    // piu': vuoto (o non numerico) = NIENTE, e updateN cancella la chiave. Il numero
    // suggerito vive nel placeholder, dove si legge come proposta e non come dichiarazione.
    if(c === 'intopt'){   const v = parseInt(el.value, 10); return Number.isFinite(v) ? v : undefined; }
    if(c === 'floatopt'){ const v = parseFloat(el.value);   return Number.isFinite(v) ? v : undefined; }
    if(c === 'stropt'){   const v = String(el.value).trim(); return v || undefined; }
    if(c === 'int' || c === 'int-empty'){
        if(c === 'int-empty' && el.value === '') return undefined;
        return normalizeNumber(el.value, +el.dataset.ndef, +el.dataset.nmin, +el.dataset.nmax);
    }
    return el.value;
}
// updateFrontPanel(key, value): coercizione in data-fpcoerce — (assente)=stringa ·
//   lit=data-fpval (bottoni layout) · checked=el.checked · eq=el.value===data-fpeq
//   · int=normalizeNumber(...) · startnum=continued→''/restart→1/altrimenti
//   parseInt (numerazione progressiva SFP/porte).
function _fpVal(el){
    const c = el.dataset.fpcoerce;
    if(c === 'lit')      return el.dataset.fpval;
    if(c === 'checked')  return el.checked;
    if(c === 'eq')       return el.value === el.dataset.fpeq;
    if(c === 'int')      return normalizeNumber(el.value, +el.dataset.fpdef, +el.dataset.fpmin, +el.dataset.fpmax);
    if(c === 'startnum') return el.value === 'continued' ? '' : (el.value === 'restart' ? 1 : parseInt(el.value, 10));
    return el.value;
}
const _fp = (el) => updateFrontPanel(el.dataset.fpkey, _fpVal(el));

// P4 «proponi, non applicare»: adotta / ignora il TIPO suggerito dal Discovery su un
// nodo gia' documentato (la proposta vive in n.discoveryConflicts 'identity-shift', non
// e' mai stata applicata in silenzio). Adottare = scelta deliberata → pinna typeManual
// (il tipo non tornera' a oscillare) e pulisce la proposta; ignorare = tiene il tipo
// attuale e pulisce la proposta. Entrambe con audit.
function _adoptRetype(nid, newType){
    const n = nodeById(nid); if(!n) return;
    if(!TYPES[newType] || n.type === newType){ _dismissRetype(nid); return; }
    const prevType = n.type;
    n.type = newType;
    // Adotta le porte di default del nuovo tipo SOLO se il nodo aveva ancora quelle del
    // vecchio (o nessuna): non calpesta un conteggio porte gia' personalizzato/misurato.
    const prevDef = TYPES[prevType]?.ports || 0, nextDef = TYPES[newType]?.ports || 0;
    if(!n.ports || n.ports === prevDef) n.ports = nextDef || n.ports;
    n.typeManual = true;                       // adozione esplicita = pinnato (manual-first)
    n.possibleReplacement = false;
    if(Array.isArray(n.discoveryConflicts)) n.discoveryConflicts = n.discoveryConflicts.filter(c => !c || c.type !== 'identity-shift');
    logAudit('discovery-retype-adopt', { target: n.name || n.id, summary: `${prevType} → ${newType}` });
    markDirty(); renderAll(); renderProps();
}
function _dismissRetype(nid){
    const n = nodeById(nid); if(!n) return;
    n.possibleReplacement = false;
    if(Array.isArray(n.discoveryConflicts)) n.discoveryConflicts = n.discoveryConflicts.filter(c => !c || c.type !== 'identity-shift');
    logAudit('discovery-retype-dismiss', { target: n.name || n.id, summary: n.type });
    markDirty(); renderProps();
}

// P5 · adotta il conteggio porte MISURATO su un nodo con conteggio pinnato a mano.
// La proposta (`portsMeasured`) l'ha registrata l'SNMP (lib/ports-reconcile.js)
// senza toccare il disegno; qui l'utente decide di allineare il documento alla
// realta'. Il pin `portsManual` resta: e' comunque un valore deciso a mano (adozione
// esplicita). Le porte misurate in eccesso esistono gia' in `state.ports` (la sync
// le popola sempre): alzare il conteggio le fa semplicemente disegnare.
function _adoptPorts(nid){
    const n = nodeById(nid); if(!n || n.portsMeasured == null) return;
    const measured = n.portsMeasured;
    if(measured > (n.ports || 0)) n.ports = measured;
    delete n.portsMeasured;
    n.portsManual = true;
    logAudit('ports-adopt-measured', { target: n.name || n.id, summary: String(measured) });
    markDirty(); renderAll(); renderProps();
}

registerClickActions({
    'node-delete':        () => deleteNode(),
    'adopt-retype':       (el) => _adoptRetype(el.dataset.nid, el.dataset.type),
    'dismiss-retype':     (el) => _dismissRetype(el.dataset.nid),
    'adopt-ports':        (el) => _adoptPorts(el.dataset.nid),
    'update-n-clear':     (el) => updateN(el.dataset.nfield, ''),   // bottone Reset colore
    'update-fp':          _fp,   // bottoni layout base (value literal in data-fpval)
    'room-lock-toggle':   (el) => toggleRoomLock(el.dataset.nid),
    'snmp-poll':          (el) => pollSNMP(el.dataset.nid),
    'stack-hint-accept':  () => acceptStackHint(),
    'stack-hint-dismiss': () => dismissStackHint(),
    'stack-remove':       () => removeNodeFromStack(),
    'ha-remove':          () => removeNodeFromHa(),
    'lag-dissolve':       (el) => dissolveLag(el.dataset.gid),
});
registerChangeActions({
    'update-n':           (el) => updateN(el.dataset.nfield, _nVal(el)),
    'update-racku':       (el) => {
        const fromTop = el.dataset.fromtop === '1';
        const raw = fromTop ? visibleUToRackU(el.dataset.rackid, +el.value, +el.dataset.su) : +el.value;
        updateN('rackU', normalizeNumber(raw, 1, 1, +el.dataset.rs));
    },
    'update-hostname':    (el) => { updateN('hostname', el.value); updateN('hostnameManual', !!el.value.trim()); },
    'move-node-to-rack':  (el) => {
        if(el.value !== el.dataset.curr){
            if(moveNodeToRack(el.dataset.nid, el.value)) el.dataset.curr = el.value;
            else el.value = el.dataset.curr;
        }
    },
    'update-fp':          _fp,
    'update-intg':        (el) => updateIntegration(el.dataset.nid, el.dataset.ikey, el.dataset.icoerce === 'intdef' ? (+el.value || +el.dataset.idef) : el.value),
    'update-intg-host':   (el) => { updateIntegration(el.dataset.nid, 'host', el.value); updateIntegration(el.dataset.nid, 'hostManual', !!el.value.trim()); },
    'stack-mode-standalone': (el) => { if(el.checked) removeNodeFromStack(); },
    'stack-mode-member':  (el) => { if(el.checked) setNodeStack(el.dataset.stackname, 1); },
    'stack-set':          (el) => setNodeStack(el.value, +el.dataset.mid),
    'stack-member-id':    (el) => setNodeStackMemberId(parseInt(el.value, 10)),
    'ha-mode-standalone': (el) => { if(el.checked) removeNodeFromHa(); },
    'ha-mode-pair':       (el) => {
        if(!el.checked) return;
        const candidates = store.state.nodes.filter(x => x.id !== el.dataset.nid && TYPES[x.type]?.haEligible);
        if(candidates[0]) setNodeHaPair(candidates[0].id, 'active', 'active-passive');
        else alert(t('msg.ui.noHaPeer'));
    },
    'ha-mode-cluster':    (el) => { if(el.checked) setNodeHaCluster(_defaultHaGroupName(store.state.nodes.find(x => x.id === el.dataset.nid)), 'active', 'cluster-N'); },
    'ha-pair-peer':       (el) => setNodeHaPair(el.value, el.dataset.harole, el.dataset.hamode),
    'ha-role':            (el) => setNodeHaRole(el.value),
    'ha-mode':            (el) => setNodeHaMode(el.value),
    'ha-sync':            (el) => setNodeHaSync(el.value),
    'ha-cluster-name':    (el) => setNodeHaCluster(el.value, el.dataset.harole, el.dataset.hamode),
    'lag-mode-set':       (el) => setLagMode(el.dataset.gid, el.value),
    'lag-vlan-set':       (el) => setLagVlan(el.dataset.gid, el.value),
    'lag-rename':         (el) => renameLag(el.dataset.gid, el.value),
});
registerInputActions({
    'struct-color-live':   (el) => _liveStructColor(el.dataset.nid, el.value),
    'struct-opacity-live': (el) => _liveStructOpacity(el.dataset.nid, +el.value),
});

// ============================================================
// PROPERTIES PANEL — renderer NODO (dispositivo/struttura, selType===node)
// Estratto da app-properties.js (refactor: split del pannello proprieta per
// tipo di selezione). Il piu grande: switch per-tipo device.
// Funzione glue chiamata dal dispatcher renderProps() a runtime: usa solo
// `panel` + i globali (selId/selType/state/TYPES) e i builder condivisi che
// restano in app-properties.js. Caricato in netmapper.html subito dopo
// app-properties.js. NESSUN cambiamento di logica rispetto alloriginale.
// ============================================================

// Modalita LACP del LAG all'ALTRO CAPO (coerenza cross-end). Riusa
// _lagRepresentativeConnection (global bare, esposto da app-popup) per trovare
// la porta peer del bundle, poi ne legge il gruppo -> state.lagModes. Ritorna
// null se il peer non e un LAG con modalita nota (nessun giudizio = honest).
// Sola lettura, zero mutazioni.
function _lagPeerMode(members){
    if(typeof _lagRepresentativeConnection !== 'function') return null;
    const first = Array.isArray(members) && members.length ? members[0] : null;
    const rep = (first && first.pid) ? _lagRepresentativeConnection(first.pid) : null;
    if(!rep || !rep.remotePid) return null;
    const rpi = (store.state.ports && store.state.ports[rep.remotePid]) || {};
    const pgid = String(rpi.lagGroup || '').trim();
    if(pgid && store.state.lagModes && store.state.lagModes[pgid]) return store.state.lagModes[pgid];
    return null;
}

// Proprieta' di un DISPOSITIVO/struttura selezionato (selType==='node').
export function _renderNodeProps(panel){
        // ── Alias verso lo scope legacy (build-time) ──
        // Gli handler NON sono piu' inline (Blocco 4: event delegation) → niente
        // testo bare da preservare. TYPES arriva dall'import ESM in cima al modulo.
        // Alias RESIDUI = solo lib-script (stack/ha-pair, <script>: restano sul ponte)
        // + stato via store. Le funzioni definite in src/ arrivano dagli import ESM in cima.
        const state = store.state,
            isInStack = win.isInStack, getStackMembers = win.getStackMembers,
            getStackSummary = win.getStackSummary, getAllStackIds = win.getAllStackIds,
            getEffectiveRole = win.getEffectiveRole,
            isInHaPair = win.isInHaPair, isInHaCluster = win.isInHaCluster,
            getHaPeer = win.getHaPeer, getHaPartners = win.getHaPartners,
            getHaSummary = win.getHaSummary, getAllHaGroupIds = win.getAllHaGroupIds,
            _propsExplicit = store._propsExplicit;

        const _rawNode=nodeById(store.selId); if(!_rawNode) return;
        const n=_nodeSpecView(_rawNode);
        const d=TYPES[n.type]; if(!d){store.selId=null;store.selType=null;renderProps();return;}
        // UX uniforme rack + floor: click singolo/drag selezionano soltanto il
        // device; le proprieta' si aprono intenzionalmente col DOPPIO click. (Il
        // floor seguiva renderAll→renderProps senza guardia → switchava al singolo
        // click, rubando il pannello durante il drag-import VM. Ora come il rack.)
        if((d.isRack || d.isFloor) && !_propsExplicit) return;
        const _delTip = d.isStructural ? t('pnl.node.delObject') : t('pnl.node.delDevice');
        // Accento colorato: logo OS dal campo dichiarato — server/pc/mobile/tv
        // (srvOs/osType/tvOs) oppure la PIATTAFORMA di un hypervisor/homelab
        // (hvPlatform: ESXi→VMware, Proxmox, Docker, TrueNAS). Vuoto sui nodi
        // strutturali (rack/floor/room: nessun campo OS) → nessuna icona.
        const _osIco = osIconHtmlFor({ nodeOs: n.srvOs || n.osType || n.tvOs, hvPlatform: n.hvPlatform }, { accent: true, size: 20 });
        const _panelHeader = _buildPropsHeader(
            n.name || n.hostname || n.ip || d.name,
            d.name,
            _propsIconForType(n.type),
            `<span class="props-toggles"><button class="props-toggle-btn" data-act="props-expand-all" data-tip="${t('pnl.node.expandAll')}"><i class="fas fa-angles-down"></i></button><button class="props-toggle-btn" data-act="props-collapse-all" data-tip="${t('pnl.node.collapseAll')}"><i class="fas fa-angles-up"></i></button><button class="props-toggle-btn" data-act="props-reset-sections" data-tip="${t('pnl.node.resetSections')}"><i class="fas fa-rotate"></i></button><button class="props-toggle-btn danger" data-act="node-delete" data-tip="${_delTip}"><i class="fas fa-trash"></i></button></span>`,
            '', _osIco
        );
        let h=`${_panelHeader}`;
        if(d.isStructural){
            const _opacity  = n.opacity  !== undefined ? n.opacity  : 1;
            const _locked   = !!n.locked;
            // Font size: valore salvato oppure auto (calcolato da dimensioni)
            const _autoFs   = Math.max(10, Math.min(Math.min(n.w||200, n.h||200) * 0.1, 36));
            const _fontSize = n.fontSize !== undefined ? n.fontSize : '';
            h+=`<div class="prop-group">
                  <label>${t('f.structName')}</label>
                  <input value="${escapeHTML(n.name||'')}" placeholder="${t('pnl.node.noNamePlaceholder')}"
                         data-change="update-n" data-nfield="name">
                </div>
                <div class="prop-group">
                  <label style="display:flex;align-items:center;justify-content:space-between">
                    <span>${t('pnl.node.fontSize')}</span>
                    <span style="font-size:var(--fs-xs);color:var(--text-muted)">${t('pnl.node.autoEquals',{n:Math.round(_autoFs)})}</span>
                  </label>
                  <input type="number" min="6" max="200" step="1"
                         value="${_fontSize}" placeholder="${t('pnl.node.autoPxPlaceholder',{n:Math.round(_autoFs)})}"
                         style="width:100%;box-sizing:border-box"
                         data-change="update-n" data-nfield="fontSize" data-ncoerce="int-empty" data-ndef="${Math.round(_autoFs)}" data-nmin="6" data-nmax="200">
                </div>
                <div class="prop-group" style="margin-bottom:10px">
                  <button class="toolbar-btn${_locked?' primary':''}" style="width:100%;justify-content:center;gap:8px"
                          data-act="room-lock-toggle" data-nid="${n.id}">
                    <i class="fas ${_locked?'fa-lock':'fa-lock-open'}"></i>
                    ${_locked?t('pnl.node.roomLockedClickUnlock'):t('pnl.node.lockPosSize')}
                  </button>
                </div>
                <div class="prop-group">
                  <label style="display:flex;align-items:center;justify-content:space-between">
                    <span>${t('pnl.node.bgColor')}</span>
                    <input type="color" value="${n.color||d.defaultColor}"
                           style="width:38px;height:26px;padding:1px;cursor:pointer"
                           data-input="struct-color-live" data-nid="${n.id}"
                           data-change="update-n" data-nfield="color">
                  </label>
                </div>
                <div class="prop-group">
                  <label style="display:flex;align-items:center;justify-content:space-between">
                    <span>${t('pnl.node.bgOpacity')}</span>
                    <span id="struct-opacity-lbl">${Math.round(_opacity*100)}%</span>
                  </label>
                  <input type="range" min="0" max="1" step="0.05" value="${_opacity.toFixed(2)}"
                         data-input="struct-opacity-live" data-nid="${n.id}"
                         data-change="update-n" data-nfield="opacity" data-ncoerce="num">
                </div>
                <div class="prop-group"><label>${t('f.widthPx')}</label><input type="number" step="20" value="${n.w||200}" data-change="update-n" data-nfield="w" data-ncoerce="int" data-ndef="200" data-nmin="40" data-nmax="5000"></div>
                <div class="prop-group"><label>${t('f.heightPx')}</label><input type="number" step="20" value="${n.h||200}" data-change="update-n" data-nfield="h" data-ncoerce="int" data-ndef="200" data-nmin="40" data-nmax="5000"></div>
                <p class="prop-notes-header"><i class="fas fa-sticky-note"></i> ${t('common.notes')}</p>
                <div class="prop-group">
                  <textarea rows="3" placeholder="${t('pnl.node.notesPlaceholder')}"
                            data-change="update-n" data-nfield="notes">${escapeHTML(n.notes||'')}</textarea>
                </div>
                `;
        } else {
            const _idSrc = String(n.identitySource || '').trim();
            const _idConf = String(n.identityConfidence || '').trim();
            const _idLabel = _discIdentityLabel(_idSrc);
            const _hintVendor = String(n.vendorHint || '').trim();
            const _pReconcile = Array.isArray(n.portReconcileConflicts) ? n.portReconcileConflicts.length : 0;
            // P4 «proponi, non applicare»: proposta di RI-TIPIZZAZIONE dal Discovery
            // (identity-shift con un tipo valido diverso dall'attuale). NON e' stata applicata:
            // si adotta o si ignora a mano qui sotto. Prendo la piu' recente.
            const _typeShift = (Array.isArray(n.discoveryConflicts) ? n.discoveryConflicts : [])
                .filter(c => c && c.type === 'identity-shift' && c.newType && c.newType !== n.type && TYPES[c.newType])
                .slice(-1)[0] || null;
            const _showIdentity = !!(_idSrc || _hintVendor || n.possibleReplacement || _pReconcile || _typeShift);
            const _idColor = _idConf === 'high' ? '#39d353' : _idConf === 'mid' ? '#d29922' : '#8b949e';
            const _identityBlock = _showIdentity ? `<div style="margin:8px 0 12px;padding:8px 10px;background:color-mix(in srgb, var(--accent) 7%, transparent);border:1px solid color-mix(in srgb, var(--accent) 20%, transparent);border-radius:6px;display:flex;flex-direction:column;gap:5px;font-size:0.74rem">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span style="font-weight:600;color:var(--text-main)">${t('pnl.node.detectedIdentity')}</span>
                    ${_idSrc ? `<span style="padding:2px 6px;border-radius:999px;background:rgba(88,166,255,.12);color:#58a6ff;border:1px solid rgba(88,166,255,.25)">${escapeHTML(_idLabel)}</span>` : ''}
                    ${_idConf ? `<span style="padding:2px 6px;border-radius:999px;background:${_idColor}22;color:${_idColor};border:1px solid ${_idColor}55">${escapeHTML(_idConf)}</span>` : ''}
                    ${_hintVendor ? `<span style="color:var(--text-muted);opacity:.5">|</span><span style="color:var(--text-muted)">${t('pnl.node.vendorHintMacOui')} <strong style="color:var(--text-main)">${escapeHTML(_hintVendor)}</strong></span>` : ''}
                </div>
                ${n.possibleReplacement ? `<div style="color:#d29922"><i class="fas fa-triangle-exclamation" style="margin-right:4px"></i>${t('pnl.node.possibleReplacement')}</div>` : ''}
                ${_typeShift ? `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:#d29922">
                    <i class="fas fa-arrows-rotate"></i>
                    <span>${t('pnl.node.retypeSuggest', { type: escapeHTML(typeName(_typeShift.newType)) })}${Number.isFinite(_typeShift.confidence) ? ` · ${_typeShift.confidence}%` : ''}</span>
                    <button type="button" data-act="adopt-retype" data-nid="${escapeHTML(n.id)}" data-type="${escapeHTML(_typeShift.newType)}" style="padding:2px 8px;border-radius:4px;border:1px solid #d29922;background:#d2992222;color:#e3b341;cursor:pointer">${t('pnl.node.retypeAdopt')}</button>
                    <button type="button" data-act="dismiss-retype" data-nid="${escapeHTML(n.id)}" style="padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer">${t('pnl.node.retypeDismiss')}</button>
                </div>` : ''}
                ${_pReconcile ? `<div style="color:#d29922"><i class="fas fa-triangle-exclamation" style="margin-right:4px"></i>${t('pnl.node.portReconcile', {n:_pReconcile})}</div>` : ''}
            </div>` : '';
            // «Identità rilevata» IN CIMA, subito sotto l'intestazione e PRIMA di
            // Nome/ID. E' il contesto con cui si legge tutto il resto del pannello —
            // chi dice che questo apparato e' questo apparato, e quanto ci crede — e
            // sotto i campi finiva a valle delle cose che serve a interpretare.
            // Emesso QUI una volta sola, per QUALUNQUE tipo: prima lo stampava il
            // ramo rack a meta' pannello e, fra i floor, solo l'AP.
            h += _identityBlock;
            // Sezioni del pannello accumulate in variabili separate per poter
            // controllare l'ordine finale (Device-specifico in alto, poi Rete &
            // Accesso, Layout porte, LAG, Integrazione). Usate solo per i RACK;
            // l'assemblaggio finale e' subito prima delle Note.
            let _layoutPortsHtml   = '';
            let _patchPanelHtml    = '';
            let _networkAccessHtml = '';
            let _devSpecHtml       = '';
            let _lagHtml           = '';
            let _inventoryHtml     = '';
            let _integrationHtml   = '';
            let _backupHtml        = '';
            let _stackingHtml      = '';
            let _haHtml            = '';
            if(d.isRack){
                const rs=getNodeRackSize(n);
                const isRackFiller = (n.type==='blankpanel'||n.type==='cablemanager');
                const fixedName=_fixedRackLabel(n.type)||'';

                // ---- Layout porte ----
                if(!isRackFiller){
                    const fp = _frontPanelState(n, n.ports!==undefined ? n.ports : d.ports || 0);
                    const mgmtCount = n.type==='pdu' ? pduManagementPortCount(n) : fp.mgmtCount;
                    const layout = fp.baseLayout || 'auto';
                    const sfpCount = Number.isFinite(fp.sfpCount) ? fp.sfpCount : (fp.separateSfp ? 4 : 0);
                    const maxSfp = Math.min(48, Math.max(0, fp.portCount));
                    const isPatch = n.type==='patchpanel';
                    const _portTot = n.ports!==undefined ? n.ports : (d.ports || 0);
                    const _sfpShown = fp.separateSfp && sfpCount > 0 ? sfpCount : 0;
                    const _lpPreview = n.type==='pdu' ? '' : (_portTot
                        ? `<span class="props-collapsible-preview">${t('common.portsCount',{n:_portTot})}${_sfpShown?` · ${_sfpShown} SFP`:''}</span>`
                        : '');
                    _layoutPortsHtml = `<details class="props-collapsible" ${_propsSectionIsOpen('layout-ports')?'open':''} data-toggle="props-section" data-section="layout-ports"><summary class="props-collapsible-head"><span><i class="fas fa-grip-vertical"></i> ${t('sec.portLayout')}</span>${_lpPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">${(typeof _deviceTypeApplyHtml==='function' && !isPatch) ? _deviceTypeApplyHtml(n) : ''}
${n.type==='pdu' ? '' : `<div class="prop-row2">
  <div class="prop-group" style="grid-column:1/-1"><label>${t('field.portCount')}</label>
    <input type="number" min="0" max="96" value="${n.ports!==undefined?n.ports:d.ports}" data-change="update-n" data-nfield="ports" data-ncoerce="int" data-ndef="${d.ports}" data-nmin="0" data-nmax="96">${n.portsReal?`<div style="font-size:0.78rem;color:#e3b341;margin-top:3px" data-tip="${escapeHTML(t('field.portCount.driftTip'))}"><i class="fas fa-triangle-exclamation"></i> ${escapeHTML(t('field.portCount.drift',{n:n.portsReal}))}</div>`:''}${n.portsMeasured?`<div style="font-size:0.78rem;margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span style="color:#e3b341" data-tip="${escapeHTML(t('field.portCount.measuredTip'))}"><i class="fas fa-satellite-dish"></i> ${escapeHTML(t('field.portCount.measured',{n:n.portsMeasured}))}</span><button type="button" data-act="adopt-ports" data-nid="${escapeHTML(n.id)}" style="padding:2px 8px;border-radius:4px;border:1px solid #d29922;background:#d2992222;color:#e3b341;cursor:pointer">${escapeHTML(t('field.portCount.adopt'))}</button></div>`:''}
  </div>
</div>`}
<div class="prop-group" style="margin-top:6px"><label>${t('f.baseLayout')}</label>
  <div class="layout-thumbnails" role="radiogroup" aria-label="${t('pnl.node.basePortLayout')}">
    <button type="button" class="layout-thumb${layout==='linear'?' selected':''}" data-act="update-fp" data-fpkey="baseLayout" data-fpcoerce="lit" data-fpval="linear" data-tip="${t('pnl.node.layoutLinearTip')}" aria-pressed="${layout==='linear'?'true':'false'}" aria-label="${t('pnl.node.layoutLinear')}">
      <svg viewBox="0 0 80 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <text x="8"  y="10" font-size="7" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">1</text>
        <text x="20" y="10" font-size="7" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">2</text>
        <text x="32" y="10" font-size="7" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">3</text>
        <text x="46" y="10" font-size="7" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">4</text>
        <text x="58" y="10" font-size="7" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">5</text>
        <text x="70" y="10" font-size="7" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">6</text>
        <text x="40" y="18" font-size="5.5" font-family="system-ui,sans-serif" fill="currentColor" text-anchor="middle">${t('pnl.node.layoutLinear')}</text>
      </svg>
    </button>
    <button type="button" class="layout-thumb${layout==='sequential'?' selected':''}" data-act="update-fp" data-fpkey="baseLayout" data-fpcoerce="lit" data-fpval="sequential" data-tip="${t('pnl.node.layoutSequentialTip')}" aria-pressed="${layout==='sequential'?'true':'false'}" aria-label="${t('pnl.node.layoutSequential')}">
      <svg viewBox="0 0 80 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <text x="22" y="13" font-size="5.5" font-family="system-ui,sans-serif" fill="currentColor" text-anchor="middle">${t('pnl.node.layoutSequential')}</text>
        <text x="48" y="9"  font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">1</text>
        <text x="58" y="9"  font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">2</text>
        <text x="68" y="9"  font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">3</text>
        <text x="48" y="18" font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">4</text>
        <text x="58" y="18" font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">5</text>
        <text x="68" y="18" font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">6</text>
      </svg>
    </button>
    <button type="button" class="layout-thumb${layout==='alternating'?' selected':''}" data-act="update-fp" data-fpkey="baseLayout" data-fpcoerce="lit" data-fpval="alternating" data-tip="${t('pnl.node.layoutAlternatingTip')}" aria-pressed="${layout==='alternating'?'true':'false'}" aria-label="${t('pnl.node.layoutAlternating')}">
      <svg viewBox="0 0 80 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <text x="22" y="13" font-size="5.5" font-family="system-ui,sans-serif" fill="currentColor" text-anchor="middle">${t('pnl.node.layoutAlternating')}</text>
        <text x="48" y="9"  font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">1</text>
        <text x="58" y="9"  font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">3</text>
        <text x="68" y="9"  font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">5</text>
        <text x="48" y="18" font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">2</text>
        <text x="58" y="18" font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">4</text>
        <text x="68" y="18" font-size="6.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">6</text>
      </svg>
    </button>
  </div>
</div>
<div class="prop-check-grid">
  <label class="prop-check" data-tip="${t('pnl.node.port1BottomTip')}"><input type="checkbox" ${fp.oneBottom?'checked':''} data-change="update-fp" data-fpkey="oneBottom" data-fpcoerce="checked"> ${t('pnl.node.port1Bottom')}</label>
</div>
${isPatch ? '' : `<div class="prop-row2" style="margin-top:4px">
  <div class="prop-group"><label>${t('f.sfpPorts')}</label>
    <input type="number" min="0" max="${maxSfp}" value="${sfpCount}" data-change="update-fp" data-fpkey="sfpCount" data-fpcoerce="int" data-fpdef="0" data-fpmin="0" data-fpmax="${maxSfp}" data-tip="${t('pnl.node.sfpPortsTip')}">
  </div>
${sfpCount > 0 ? `  <div class="prop-group"><label>${t('f.sfpPos')}</label>
    <select data-change="update-fp" data-fpkey="sfpRight" data-fpcoerce="eq" data-fpeq="right">
      <option value="left"  ${!fp.sfpRight?'selected':''}>${t('o.left')}</option>
      <option value="right" ${ fp.sfpRight?'selected':''}>${t('o.rightDef')}</option>
    </select>
  </div>` : ''}
</div>
${sfpCount > 0 ? `<div class="prop-row2" style="margin-top:4px">
  <div class="prop-group"><label>${t('f.sfpNum')}</label>
    <select data-change="update-fp" data-fpkey="sfpStartNum" data-fpcoerce="startnum" data-tip="${t('pnl.node.sfpNumTip')}">
      <option value="continued" ${(fp.sfpStartNum===null||fp.sfpStartNum===undefined)?'selected':''}>${t('o.continuousEx')}</option>
      <option value="restart"   ${fp.sfpStartNum===1?'selected':''}>${t('o.restart1Ex')}</option>
      <option value="49"        ${fp.sfpStartNum===49?'selected':''}>${t('o.custom49')}</option>
      <option value="25"        ${fp.sfpStartNum===25?'selected':''}>${t('o.custom25')}</option>
    </select>
  </div>
  <div class="prop-group"><label>${t('f.sfpPrefix')}</label>
    <input type="text" maxlength="6" value="${escapeHTML(fp.sfpPrefix||'')}" placeholder="${t('pnl.node.nonePlaceholder')}" data-change="update-fp" data-fpkey="sfpPrefix" data-tip="${t('pnl.node.sfpPrefixTip')}">
  </div>
</div>
<div class="prop-row2" style="margin-top:6px;padding-top:4px;border-top:1px dashed var(--panel-border)">
  <div class="prop-group" style="grid-column:1/-1"><label style="font-size:var(--fs-2xs);color:var(--text-muted);font-weight:600">${t('f.sfp2ndBlock')}</label></div>
</div>
<div class="prop-row2">
  <div class="prop-group"><label>${t('f.ports2block')}</label>
    <input type="number" min="0" max="${maxSfp}" value="${fp.sfp2Count||0}" data-change="update-fp" data-fpkey="sfp2Count" data-fpcoerce="int" data-fpdef="0" data-fpmin="0" data-fpmax="${maxSfp}" data-tip="${t('pnl.node.sfp2CountTip')}">
  </div>
${(fp.sfp2Count||0) > 0 ? `  <div class="prop-group"><label>${t('f.prefix2block')}</label>
    <input type="text" maxlength="6" value="${escapeHTML(fp.sfp2Prefix||'')}" placeholder="${t('pnl.node.nonePlaceholder')}" data-change="update-fp" data-fpkey="sfp2Prefix" data-tip="${t('pnl.node.sfp2PrefixTip')}">
  </div>` : ''}
</div>
${(fp.sfp2Count||0) > 0 ? `<div class="prop-row2" style="margin-top:4px">
  <div class="prop-group" style="grid-column:1/-1"><label>${t('f.num2block')}</label>
    <select data-change="update-fp" data-fpkey="sfp2StartNum" data-fpcoerce="startnum" data-tip="${t('pnl.node.sfp2NumTip')}">
      <option value="continued" ${(fp.sfp2StartNum===null||fp.sfp2StartNum===undefined)?'selected':''}>${t('o.continuous')}</option>
      <option value="restart"   ${fp.sfp2StartNum===1?'selected':''}>${t('o.restart1')}</option>
      <option value="49"        ${fp.sfp2StartNum===49?'selected':''}>${t('o.custom49')}</option>
      <option value="25"        ${fp.sfp2StartNum===25?'selected':''}>${t('o.custom25')}</option>
    </select>
  </div>
</div>` : ''}` : ''}`}
${isPatch ? (()=>{
    const _ppOpts = (typeof _patchPanelChainOptions==='function') ? _patchPanelChainOptions(n) : [];
    const _ppFrom = fp.ppContinueFrom || '';
    const _ppStart = fp.ppStartNum || '';
    const _ppOff = (typeof _patchPanelOffset==='function') ? _patchPanelOffset(n) : 0;
    const _ppPorts = n.ports!==undefined ? n.ports : (d.ports||0);
    const _ppPreview = _ppPorts>0 ? t('pnl.node.portsNumbered',{from:_ppOff+1,to:_ppOff+_ppPorts}) : '';
    return `<div class="prop-row2" style="margin-top:6px;padding-top:4px;border-top:1px dashed var(--panel-border)">
  <div class="prop-group" style="grid-column:1/-1"><label style="font-size:var(--fs-2xs);color:var(--text-muted);font-weight:600">${t('f.progNumbering')}</label></div>
</div>
<div class="prop-group"><label>${t('f.continueFrom')}</label>
  <select data-change="update-fp" data-fpkey="ppContinueFrom" data-tip="${t('pnl.node.ppContinueFromTip')}">
    <option value="" ${!_ppFrom?'selected':''}>${t('o.sepIndep')}</option>
    ${_ppOpts.map(p=>`<option value="${escapeHTML(p.id)}" ${_ppFrom===p.id?'selected':''}>${escapeHTML(getNodeDisplayName(p)||p.name||p.id)}</option>`).join('')}
  </select>
</div>
<div class="prop-group"><label>${t('f.orStartFrom')}</label>
  <input type="number" min="1" max="9999" value="${escapeHTML(String(_ppStart))}" placeholder="${t('pnl.node.autoPlaceholder')}" data-change="update-fp" data-fpkey="ppStartNum" data-tip="${t('pnl.node.ppStartNumTip')}">
</div>
${_ppPreview?`<div style="font-size:var(--fs-2xs);color:var(--text-muted);margin:2px 2px 0"><i class="fas fa-hashtag" style="margin-right:5px"></i>${_ppPreview}</div>`:''}`;
})() : ''}
${fp.mgmtEligible && n.type!=='pdu' ? `<div class="prop-row2" style="margin-top:4px">
  <div class="prop-group"><label>${t('f.mgmtPorts')}</label>
    <input type="number" min="0" max="4" value="${mgmtCount||0}" data-change="update-fp" data-fpkey="mgmtCount" data-fpcoerce="int" data-fpdef="0" data-fpmin="0" data-fpmax="4" data-tip="${t('pnl.node.mgmtPortsTip')}">
  </div>
${mgmtCount > 0 ? `  <div class="prop-group"><label>${t('f.mgmtPos')}</label>
    <select data-change="update-fp" data-fpkey="mgmtPosition">
      <option value="left"  ${fp.mgmtPosition!=='right'?'selected':''}>${t('o.leftDef')}</option>
      <option value="right" ${fp.mgmtPosition==='right'?'selected':''}>${t('o.right')}</option>
    </select>
  </div>` : ''}
</div>
${mgmtCount > 0 ? `<div class="prop-row2" style="margin-top:4px">
  <div class="prop-group" style="grid-column:1/-1"><label>${t('f.mgmtLabel')}</label>
    <input type="text" maxlength="10" value="${escapeHTML(fp.mgmtLabel||'MGMT')}" placeholder="MGMT" data-change="update-fp" data-fpkey="mgmtLabel" data-tip="${t('pnl.node.mgmtLabelTip')}">
  </div>
</div>` : ''}` : ''}
</div>
</details>`;
                }

                // ---- Stacking (P7.1) ----
                // Visibile solo su tipi `stackEligible` (switch). Modello tag-based
                // su `node.spec.stackId/stackMemberId`. Master = lowest memberId nello
                // stack; il fallback in getStackMaster gestisce buchi e auto-promote.
                if(d.stackEligible && !isRackFiller){
                    const _isIn = isInStack(n);
                    // ⚠️ Il valore si legge con lo STESSO lettore della guardia qui sopra
                    // (lib/stack.js): `isInStack` accetta anche lo `stackId` scritto piatto
                    // sul nodo, e leggerlo da `n.spec` faceva esplodere l'INTERO pannello
                    // proprietà — non la sezione stack, tutto — su un nodo che la guardia
                    // aveva appena approvato.
                    const _stackId = _isIn ? (stackIdOf(n) || '') : '';
                    const _mid = _isIn ? (stackMemberIdOf(n) || 1) : 1;
                    const _members = _isIn ? getStackMembers(state.nodes, _stackId) : [];
                    const _summary = getStackSummary(state.nodes, n);
                    const _allStacks = getAllStackIds(state.nodes);
                    const _preview = _summary
                        ? `<span class="props-collapsible-preview">${escapeHTML(_summary)}${_isIn ? ` ${t('pnl.node.ofStack',{id:escapeHTML(_stackId)})}` : ''}</span>`
                        : `<span class="props-collapsible-preview muted">Standalone</span>`;
                    // Membri lista: nome / memberId / ruolo / "questo device"
                    const _renderMembersList = () => {
                        if(!_members.length) return `<div style="font-size:var(--fs-2xs);color:var(--text-muted);padding:4px 0">${t('pnl.node.noOtherMembers')}</div>`;
                        return `<div class="stack-members-list">${_members.map(m => {
                            const _role = getEffectiveRole(state.nodes, m);
                            const _mIsThis = m.id === n.id;
                            // ⚠️ stackMemberId e' escapato come il nome accanto, anche se OGGI ogni
                            // scrittore lo riduce a un intero (parseInt in app-stack-ha.js,
                            // +dev.vc_position nell'import DCIM). L'invariante «e' un numero» e'
                            // garantito lontano da qui, e questa riga finisce GREZZA nella
                            // interpolazione di _mLabel piu' sotto: un progetto scritto a mano, o un
                            // writer futuro senza coercizione, arriverebbe fin qui. Escape a costo zero.
                            // ⚠️ NIENTE apici inversi in questo commento: alcuni passaggi dello
                            // scanner html-escape sono testuali, e un backtick di troppo qui dentro
                            // gli sposta i confini dei template piu' avanti nel file.
                            const _mLabel = `${escapeHTML(m.name || m.hostname || m.id)} · #${escapeHTML(m.spec?.stackMemberId||'?')} ${_role === 'master' ? '(master)' : ''}`;
                            return `<div class="stack-member-row${_mIsThis ? ' is-this' : ''}">${_mLabel}${_mIsThis ? ` <span class="stack-this-marker">← ${t('pnl.node.thisMarker')}</span>` : ''}</div>`;
                        }).join('')}</div>`;
                    };
                    // Datalist per autocomplete stack esistenti
                    const _datalistOpts = _allStacks.map(s => `<option value="${escapeHTML(s)}"></option>`).join('');
                    // Banner auto-detection (P7.3): se l'ultimo SNMP poll ha
                    // rilevato pattern <M>/<S>/<P> su >=2 membri distinti,
                    // l'app propone di promuovere questo device a master.
                    const _hint = n.stackDetectionHint;
                    const _hintBanner = (_hint && !_isIn) ? `<div class="stack-hint-banner" role="alert">
  <div class="stack-hint-head"><i class="fas fa-magic-wand-sparkles"></i> ${t('pnl.node.detectedStackPre')} <strong>${_hint.memberIds.length}</strong> ${t('pnl.node.detectedStackPost',{fmt:escapeHTML(_hint.suggestedFormat||'pattern')})}</div>
  <div class="stack-hint-body">${t('pnl.node.membersFoundInPoll')} <strong>${_hint.memberIds.join(', ')}</strong>.<br>${t('pnl.node.exampleLabel')} <code>${escapeHTML(_hint.sampleNames.slice(0,3).join(' · '))}</code></div>
  <div class="stack-hint-actions">
    <button class="toolbar-btn" style="justify-content:center" data-act="stack-hint-accept"><i class="fas fa-layer-group"></i> ${t('pnl.node.promoteToMaster')}</button>
    <button class="toolbar-btn" style="justify-content:center" data-act="stack-hint-dismiss">${t('pnl.node.ignore')}</button>
  </div>
</div>` : '';
                    // Force-open la fisarmonica quando c'e' un hint da mostrare:
                    // l'utente deve vedere il banner senza dover cercare.
                    const _stackOpen = _propsSectionIsOpen('stacking') || (_hint && !_isIn);
                    _stackingHtml = `<details class="props-collapsible props-secondary" ${_stackOpen?'open':''} data-toggle="props-section" data-section="stacking"><summary class="props-collapsible-head"><span><i class="fas fa-layer-group"></i> ${t('sec.stacking')}</span>${_hint && !_isIn ? `<span class="props-collapsible-preview" style="color:var(--accent)">${t('pnl.node.detected')}</span>` : _preview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
${_hintBanner}
<div class="prop-check-grid" style="grid-template-columns:1fr 1fr;border-top:none;border-bottom:none;padding:0;margin-bottom:6px">
  <label class="prop-check" data-tip="${t('pnl.node.stackStandaloneTip')}"><input type="radio" name="stack-mode-${escapeHTML(n.id)}" ${!_isIn?'checked':''} data-change="stack-mode-standalone"> Standalone</label>
  <label class="prop-check" data-tip="${t('pnl.node.stackMemberTip')}"><input type="radio" name="stack-mode-${escapeHTML(n.id)}" ${_isIn?'checked':''} data-change="stack-mode-member" data-stackname="${escapeHTML(_allStacks[0]||_defaultStackName(n))}"> ${t('pnl.node.stackMember')}</label>
</div>
${_isIn ? `<div class="prop-row2">
  <div class="prop-group"><label>${t('f.stackName')}</label>
    <input type="text" list="stack-ids-${escapeHTML(n.id)}" value="${escapeHTML(_stackId)}" data-change="stack-set" data-mid="${_mid}" data-tip="${t('pnl.node.stackNameTip')}">
    <datalist id="stack-ids-${escapeHTML(n.id)}">${_datalistOpts}</datalist>
  </div>
  <div class="prop-group"><label>${t('f.role')}</label>
    <select data-change="stack-member-id" data-tip="${t('pnl.node.stackRoleTip')}">
${(function(){
    // Costruisce le opzioni: Primary (#1), Secondary (#2), Member #3..10.
    // Mostra "(libero)" sulle posizioni non occupate (esclude se stesso),
    // "(occupato: name)" sulle altre. Il selezionato resta selezionabile.
    const opts = [];
    const _label = (mid) => mid===1 ? 'Primary (master)' : mid===2 ? 'Secondary' : `Member #${mid}`;
    for(let i=1;i<=10;i++){
        const taker = _members.find(m => (m.spec?.stackMemberId||0) === i && m.id !== n.id);
        const isThis = i === _mid;
        const disabled = !!taker && !isThis;
        const suffix = taker
            ? (isThis ? '' : ` — ${escapeHTML(taker.name||taker.id)}`)
            : '';
        opts.push(`<option value="${i}" ${isThis?'selected':''} ${disabled?'disabled':''}>${_label(i)}${suffix}</option>`);
    }
    return opts.join('');
})()}
    </select>
  </div>
</div>
<div class="stack-members-title">${t('pnl.node.currentMembers',{n:_members.length})}</div>
${_renderMembersList()}
<button class="toolbar-btn danger" style="width:100%;margin-top:6px;justify-content:center" data-act="stack-remove"><i class="fas fa-unlink"></i> ${t('pnl.node.removeFromStack')}</button>` : ''}
</div>
</details>`;
                }

                // ---- HA pair / cluster (P8.1) ----
                // Visibile solo su tipi `haEligible` (firewall, router, wlanctrl,
                // nas, server, vpncon, sdwan, consolesvr). Modello tag-based
                // su `node.spec.haPeer` (pair 1-1) o `haGroupId` (cluster N>2).
                if(d.haEligible && !isRackFiller){
                    const _haPairOn    = isInHaPair(n);
                    const _haClusterOn = isInHaCluster(n);
                    const _haOn        = _haPairOn || _haClusterOn;
                    const _haRole      = n.spec?.haRole || n.haRole || '';   // ruolo NON dichiarato ≠ "active" (schema ①): una coppia A-P mostrerebbe 2 Active
                    const _haMode      = n.spec?.haMode || n.haMode || 'active-passive';
                    const _haSync      = n.spec?.haSync || n.haSync || 'state-full';
                    const _haPeerObj   = _haPairOn ? getHaPeer(state.nodes, n) : null;
                    const _haGroupId   = _haClusterOn ? (n.spec?.haGroupId || n.haGroupId || '') : '';
                    const _haPartners  = _haOn ? getHaPartners(state.nodes, n) : [];
                    const _haSummary   = getHaSummary(state.nodes, n);
                    const _haAllGroups = getAllHaGroupIds(state.nodes);
                    // Possibili peer per pair: tutti i device haEligible diversi da n
                    const _haPeerOptions = state.nodes
                        .filter(x => x.id !== n.id && TYPES[x.type]?.haEligible)
                        .map(x => `<option value="${escapeHTML(x.id)}" ${_haPeerObj?.id === x.id ? 'selected' : ''}>${escapeHTML(x.name || x.hostname || x.id)} (${escapeHTML(typeName(x.type))})</option>`)
                        .join('');
                    const _haDatalistOpts = _haAllGroups.map(g => `<option value="${escapeHTML(g)}"></option>`).join('');
                    const _haPreview = _haSummary
                        ? `<span class="props-collapsible-preview">${escapeHTML(_haSummary)}</span>`
                        : `<span class="props-collapsible-preview muted">Standalone</span>`;
                    // Lista peer/cluster members
                    const _renderHaPartnersList = () => {
                        if(!_haPartners.length) return `<div style="font-size:var(--fs-2xs);color:var(--text-muted);padding:4px 0">${t('pnl.node.noPeerConfigured')}</div>`;
                        return `<div class="ha-partners-list">${_haPartners.map(p => {
                            const _pRole = p.spec?.haRole || p.haRole || '';
                            const _pLabel = `${escapeHTML(p.name || p.hostname || p.id)} · ${escapeHTML(_pRole || t('common.unspecifiedM'))}`;
                            return `<div class="ha-partner-row">${_pLabel}</div>`;
                        }).join('')}</div>`;
                    };
                    _haHtml = `<details class="props-collapsible props-secondary" ${_propsSectionIsOpen('ha')?'open':''} data-toggle="props-section" data-section="ha"><summary class="props-collapsible-head"><span><i class="fas fa-shield-halved"></i> ${t('sec.ha')}</span>${_haPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
<div class="prop-check-grid" style="grid-template-columns:1fr 1fr 1fr;border-top:none;border-bottom:none;padding:0;margin-bottom:6px;gap:4px">
  <label class="prop-check" data-tip="${t('pnl.node.haStandaloneTip')}"><input type="radio" name="ha-mode-${escapeHTML(n.id)}" ${!_haOn?'checked':''} data-change="ha-mode-standalone"> Standalone</label>
  <label class="prop-check" data-tip="${t('pnl.node.haPairTip')}"><input type="radio" name="ha-mode-${escapeHTML(n.id)}" ${_haPairOn?'checked':''} data-change="ha-mode-pair" data-nid="${escapeHTML(n.id)}"> Pair (1-1)</label>
  <label class="prop-check" data-tip="${t('pnl.node.haClusterTip')}"><input type="radio" name="ha-mode-${escapeHTML(n.id)}" ${_haClusterOn?'checked':''} data-change="ha-mode-cluster" data-nid="${escapeHTML(n.id)}"> Cluster (N>2)</label>
</div>
${_haPairOn ? `<div class="prop-row2">
  <div class="prop-group"><label>${t('f.peerDevice')}</label>
    <select data-change="ha-pair-peer" data-harole="${escapeHTML(_haRole)}" data-hamode="${escapeHTML(_haMode)}" data-tip="${t('pnl.node.haPeerTip')}">
      ${_haPeerOptions || `<option disabled selected>${t('o.noEligible')}</option>`}
    </select>
  </div>
  <div class="prop-group"><label>${t('f.role')}</label>
    <select data-change="ha-role" data-tip="${t('pnl.node.haRolePairTip')}">
      <option value=""        ${_haRole===''?'selected':''}>${t('common.unspecifiedM')}</option>
      <option value="active"  ${_haRole==='active'?'selected':''}>Active</option>
      <option value="standby" ${_haRole==='standby'?'selected':''}>Standby</option>
    </select>
  </div>
</div>
<div class="prop-row2" style="margin-top:4px">
  <div class="prop-group"><label>${t('f.mode')}</label>
    <select data-change="ha-mode" data-tip="${t('pnl.node.haModePairTip')}">
      <option value="active-passive" ${_haMode==='active-passive'?'selected':''}>Active-Passive</option>
      <option value="active-active"  ${_haMode==='active-active' ?'selected':''}>Active-Active</option>
    </select>
  </div>
  <div class="prop-group"><label>Sync</label>
    <select data-change="ha-sync" data-tip="${t('pnl.node.haSyncTip')}">
      <option value="state-full"     ${_haSync==='state-full'    ?'selected':''}>State-full</option>
      <option value="config-only"    ${_haSync==='config-only'   ?'selected':''}>Config-only</option>
      <option value="failover-only"  ${_haSync==='failover-only' ?'selected':''}>Failover-only</option>
    </select>
  </div>
</div>` : ''}
${_haClusterOn ? `<div class="prop-row2">
  <div class="prop-group"><label>${t('f.clusterName')}</label>
    <input type="text" list="ha-groups-${escapeHTML(n.id)}" value="${escapeHTML(_haGroupId)}" data-change="ha-cluster-name" data-harole="${escapeHTML(_haRole)}" data-hamode="${escapeHTML(_haMode)}" data-tip="${t('pnl.node.haClusterNameTip')}">
    <datalist id="ha-groups-${escapeHTML(n.id)}">${_haDatalistOpts}</datalist>
  </div>
  <div class="prop-group"><label>${t('f.role')}</label>
    <select data-change="ha-role" data-tip="${t('pnl.node.haRoleClusterTip')}">
      <option value=""        ${_haRole===''?'selected':''}>${t('common.unspecifiedM')}</option>
      <option value="active"  ${_haRole==='active'?'selected':''}>Active</option>
      <option value="standby" ${_haRole==='standby'?'selected':''}>Standby</option>
      <option value="member"  ${_haRole==='member' ?'selected':''}>Member</option>
    </select>
  </div>
</div>
<div class="prop-row2" style="margin-top:4px">
  <div class="prop-group"><label>${t('f.mode')}</label>
    <select data-change="ha-mode" data-tip="${t('pnl.node.haModeClusterTip')}">
      <option value="cluster-N"      ${_haMode==='cluster-N'     ?'selected':''}>Cluster-N</option>
      <option value="active-passive" ${_haMode==='active-passive'?'selected':''}>Active-Passive</option>
      <option value="active-active"  ${_haMode==='active-active' ?'selected':''}>Active-Active</option>
    </select>
  </div>
  <div class="prop-group"><label>Sync</label>
    <select data-change="ha-sync">
      <option value="state-full"     ${_haSync==='state-full'    ?'selected':''}>State-full</option>
      <option value="config-only"    ${_haSync==='config-only'   ?'selected':''}>Config-only</option>
      <option value="failover-only"  ${_haSync==='failover-only' ?'selected':''}>Failover-only</option>
    </select>
  </div>
</div>` : ''}
${_haOn ? `<div class="ha-partners-title">${t('pnl.node.peersMembers',{n:_haPartners.length})}</div>
${_renderHaPartnersList()}
<button class="toolbar-btn danger" style="width:100%;margin-top:6px;justify-content:center" data-act="ha-remove"><i class="fas fa-unlink"></i> ${t('pnl.node.removeFromHa')}</button>` : ''}
</div>
</details>`;
                }

                // ---- Patch Panel typology (PRIMARY device-specific per patchpanel) ----
                if(n.type==='patchpanel'){
                    // Manual-first: nessun default preselezionato. Un pannello mai
                    // compilato mostra «non dichiarato», non «Cat 6 · U/UTP»: la
                    // tendina che si apre gia' su un valore lo fa diventare un dato
                    // del documento senza che nessuno l'abbia scelto.
                    const media = n.ppMedia || '';
                    const cat = n.ppCopperCat || '';
                    const shield = n.ppCopperShield || '';
                    const conn = n.ppFiberConnector || '';
                    const mode = n.ppFiberMode || '';
                    const showCopper = (media==='copper' || media==='mixed');
                    const showFiber  = (media==='fiber'  || media==='mixed');
                    const _ppUnset = `<option value="" ${selected(media,'')}>${t('o.notDeclared')}</option>`;
                    _patchPanelHtml = `<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-patchpanel')?'open':''} data-toggle="props-section" data-section="device-patchpanel"><summary class="props-collapsible-head"><span><i class="fas fa-bars"></i> Patch Panel</span>${_buildPatchPanelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
<div class="prop-group"><label>${t('f.ppCategory')}</label>
  <select data-change="update-n" data-nfield="ppMedia">
    ${_ppUnset}
    <option value="copper" ${selected(media,'copper')}>${t('o.copperRj45')}</option>
    <option value="fiber"  ${selected(media,'fiber')}>${t('o.fiberOdf')}</option>
    <option value="mixed"  ${selected(media,'mixed')}>${t('o.mixedModular')}</option>
  </select>
</div>
${showCopper ? `<div class="prop-row2">
  <div class="prop-group"><label>${t('f.copperStd')}</label>
    <select data-change="update-n" data-nfield="ppCopperCat">
      <option value="" ${selected(cat,'')}>${t('o.notDeclared')}</option>
      <option value="cat5e" ${selected(cat,'cat5e')}>Cat 5e</option>
      <option value="cat6"  ${selected(cat,'cat6')}>Cat 6</option>
      <option value="cat6a" ${selected(cat,'cat6a')}>Cat 6A</option>
      <option value="cat7"  ${selected(cat,'cat7')}>Cat 7</option>
      <option value="cat8"  ${selected(cat,'cat8')}>Cat 8</option>
    </select>
  </div>
  <div class="prop-group"><label>${t('f.shielding')}</label>
    <select data-change="update-n" data-nfield="ppCopperShield">
      <option value="" ${selected(shield,'')}>${t('o.notDeclared')}</option>
      <option value="utp" ${selected(shield,'utp')}>${t('pnl.node.shieldUtp')}</option>
      <option value="ftp" ${selected(shield,'ftp')}>${t('pnl.node.shieldFtp')}</option>
      <option value="stp" ${selected(shield,'stp')}>${t('pnl.node.shieldStp')}</option>
    </select>
  </div>
</div>` : ''}
${showFiber ? `<div class="prop-row2">
  <div class="prop-group"><label>${t('f.fiberConn')}</label>
    <select data-change="update-n" data-nfield="ppFiberConnector">
      <option value="" ${selected(conn,'')}>${t('o.notDeclared')}</option>
      <option value="lc-simplex" ${selected(conn,'lc-simplex')}>LC simplex</option>
      <option value="lc-duplex"  ${selected(conn,'lc-duplex')}>LC duplex</option>
      <option value="sc"         ${selected(conn,'sc')}>SC</option>
      <option value="st"         ${selected(conn,'st')}>ST</option>
      <option value="fc"         ${selected(conn,'fc')}>FC</option>
      <option value="mpo-12"     ${selected(conn,'mpo-12')}>MTP/MPO-12</option>
      <option value="mpo-24"     ${selected(conn,'mpo-24')}>MTP/MPO-24</option>
    </select>
  </div>
  <div class="prop-group"><label>${t('f.fiberMode')}</label>
    <select data-change="update-n" data-nfield="ppFiberMode">
      <option value="" ${selected(mode,'')}>${t('o.notDeclared')}</option>
      <option value="sm-os1" ${selected(mode,'sm-os1')}>SM — OS1</option>
      <option value="sm-os2" ${selected(mode,'sm-os2')}>SM — OS2</option>
      <option value="mm-om1" ${selected(mode,'mm-om1')}>MM — OM1</option>
      <option value="mm-om2" ${selected(mode,'mm-om2')}>MM — OM2</option>
      <option value="mm-om3" ${selected(mode,'mm-om3')}>MM — OM3</option>
      <option value="mm-om4" ${selected(mode,'mm-om4')}>MM — OM4</option>
      <option value="mm-om5" ${selected(mode,'mm-om5')}>MM — OM5</option>
    </select>
  </div>
</div>` : ''}
</div></details>`;
                }

                // ---- Rete & Accesso ----
                if(!isRackFiller){
                    if(n.type==='patchpanel'){
                        // Patch panel passivo: solo hostname, niente IP/Mgmt/MAC
                        _networkAccessHtml = `<details class="props-collapsible" ${_propsSectionIsOpen('network-access')?'open':''} data-toggle="props-section" data-section="network-access"><summary class="props-collapsible-head"><span><i class="fas fa-link"></i> ${t('sec.netAccess')}</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                            <div class="prop-group"><label>Hostname</label><input value="${escapeHTML(n.hostname||'')}" placeholder="${escapeHTML(d.brand)}" data-change="update-hostname"></div>
                        </div></details>`;
                    } else if(n.type==='pdu' && pduManagementPortCount(n)===0){
                        _networkAccessHtml = `<details class="props-collapsible" ${_propsSectionIsOpen('network-access')?'open':''} data-toggle="props-section" data-section="network-access"><summary class="props-collapsible-head"><span><i class="fas fa-link"></i> ${t('sec.netAccess')}</span><span class="props-collapsible-preview muted">${t('o.pduMgmtNone')}</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body"><div class="pdu-port-model-note" data-tip="${escapeHTML(t('pnl.node.pduNoNetworkNoteTip'))}" data-tip-wrap><i class="fas fa-circle-info"></i> ${t('pnl.node.pduNoNetworkNote')}</div></div></details>`;
                    } else {
                        _networkAccessHtml = _buildNetAccessHtml(n, d);
                    }
                }

                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input ${isRackFiller?'disabled':''} value="${escapeHTML(isRackFiller?fixedName:(n.name||''))}" placeholder="${escapeHTML(d.name)}" data-change="update-n" data-nfield="name"></div>
                    <div class="prop-group"><label>${t('f.sizeU')}</label><input type="number" min="1" max="${rs}" value="${n.sizeU!==undefined?n.sizeU:d.sizeU}" data-change="update-n" data-nfield="sizeU" data-ncoerce="int" data-ndef="${d.sizeU}" data-nmin="1" data-nmax="${rs}"></div>
                    ${(() => {
                        const fromTop = isRackTopNumbered(n.rackId);
                        const sU = n.sizeU!==undefined?n.sizeU:d.sizeU;
                        const shown = fromTop ? rackUToVisible(n.rackId, n.rackU, sU) : n.rackU;
                        const lbl = fromTop ? t('f.posUTop') : t('f.posUBottom');
                        return `<div class="prop-group"><label>${lbl}</label><input type="number" min="1" max="${rs}" value="${shown}" data-change="update-racku" data-fromtop="${fromTop?'1':'0'}" data-rackid="${n.rackId}" data-su="${sU}" data-rs="${rs}"></div>`;
                    })()}
                    <div class="prop-group">
                      <label style="display:flex;align-items:center;justify-content:space-between">
                        <span>${t('pnl.node.deviceColor')}</span>
                        <span style="display:flex;align-items:center;gap:6px">
                          <input type="color" value="${n.color||'#4a4a4a'}"
                                 style="width:38px;height:26px;padding:1px;cursor:pointer"
                                 data-change="update-n" data-nfield="color">
                          <button class="toolbar-btn" type="button" style="padding:3px 8px;font-size:var(--fs-2xs)"
                                  data-act="update-n-clear" data-nfield="color">Reset</button>
                        </span>
                      </label>
                    </div>
                    ${state.racks.length > 1 ? `<div class="prop-group"><label>${t('f.parentRack')}</label>
                        <select data-change="move-node-to-rack" data-nid="${n.id}" data-curr="${n.rackId||''}">
                            ${state.racks.map(r => `<option value="${r.id}" ${r.id===n.rackId?'selected':''}>${escapeHTML(r.name)} (${r.sizeU||42}U)</option>`).join('')}
                        </select>
                    </div>` : ''}
                    `;
                // ---- sezione LAG manuali (assemblata in fondo) ----
                if(d.isRack&&d.isActive){
                    const _lagMap=getLagGroupsForNode(n.id);
                    const _lagGids=Object.keys(_lagMap);
                    if(_lagGids.length>0){
                        const _totPorts = _lagGids.reduce((acc,gid)=>acc+_lagMap[gid].length,0);
                        const _previewLag = `<span class="props-collapsible-preview">${t('lag.preview',{g:_lagGids.length,p:_totPorts})}</span>`;
                        let lagHtml=`<details class="props-collapsible props-secondary" ${_propsSectionIsOpen('lag-groups')?'open':''} data-toggle="props-section" data-section="lag-groups"><summary class="props-collapsible-head"><span><i class="fas fa-circle-nodes"></i> ${t('sec.lag')}</span>${_previewLag}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body"><div class="lag-groups-section">`;
                        // Intestazione di colonna: una volta sola, invece di quattro
                        // etichette ripetute su ogni riga. È qui che «VLAN» dice di che
                        // numero si tratta — il placeholder non può farlo, perché porta
                        // già ciò che VALE (il numero effettivo, o «misti»).
                        lagHtml+=`<div class="lag-group-head">
                          <span class="lag-col-name">${t('lag.colName')}</span>
                          <span class="lag-col-ports">${t('lag.colPorts')}</span>
                          <span class="lag-col-vlan">VLAN</span>
                          <span class="lag-col-mode">${t('lag.colMode')}</span>
                          <span class="lag-col-del"></span>
                        </div>`;
                        for(const gid of _lagGids){
                            const gname=(state.lagGroups&&state.lagGroups[gid])||'LAG';
                            const members=_lagMap[gid].map(m=>`<span class="lag-chip">P${escapeHTML(String(m.num))}</span>`).join('');
                            const _curMode=(state.lagModes&&state.lagModes[gid])||'';
                            // Coerenza dei MEMBRI (velocità/VLAN) + coerenza CROSS-END della
                            // modalità LACP, via lib/lag-audit.js — global bare (no ponte win.*
                            // → cricchetto invariato). Warning solo se c'è un problema reale
                            // (giudica solo dati documentati, niente invenzioni).
                            const _bits=[];
                            let _lagVlans=[];      // VLAN EFFICACE dei membri, distinte (dall'audit)
                            try {
                                if(typeof checkLagMembers==='function'){
                                    const _mm=_lagMap[gid].map(m=>{
                                        const _pi=(state.ports&&state.ports[m.pid])||{};
                                        const _sp=_pi.speedOvr!=null?_pi.speedOvr:(_pi.speed!=null?_pi.speed:null);
                                        const _vl=(typeof _effPortVlan==='function')?_effPortVlan(m.pid):null;
                                        return { num:m.num, speed:_sp, vlan:_vl };
                                    });
                                    const _c=checkLagMembers(_mm);
                                    _lagVlans=Array.from(_c.vlans||[]);
                                    const _fmt=s=>s>=1000?`${(s/1000).toFixed(s%1000?1:0)}G`:`${s}M`;
                                    if(_c.speedMismatch) _bits.push(t('lag.warnSpeed',{list:_c.speeds.map(_fmt).join(', ')}));
                                    if(_c.vlanMismatch)  _bits.push(t('lag.warnVlan',{list:_c.vlans.join(', ')}));
                                }
                                // DOVE stanno i membri e QUANTI sono (lib/lag-audit.js).
                                // ⚠️ Si guarda il gruppo in TUTTO il progetto e non solo su
                                // questo apparato: la sezione LAG è per-device, ma è proprio
                                // l'attraversamento fra apparati la cosa che si vuole vedere,
                                // e da qui non si vedrebbe mai.
                                if(typeof checkLagPlacement==='function'){
                                    const _pids=[];
                                    for(const _k of Object.keys(state.ports||{})){
                                        const _p=state.ports[_k];
                                        if(_p && _p.lagGroup===gid) _pids.push(_k);
                                    }
                                    // «Quegli apparati sono un solo switch logico?» lo decide
                                    // lib/stack.js, dove quella definizione vive già (il
                                    // cross-stack EtherChannel). Non se ne scrive una seconda.
                                    // Se la lib non risponde resta «non si sa», e non si accusa:
                                    // un LAG su due apparati può benissimo essere un MLAG.
                                    let _uno=null;
                                    if(_pids.length>1 && typeof getLagCrossMemberInfo==='function'){
                                        _uno = !!getLagCrossMemberInfo(state.nodes, _pids, getPortNodeId).isCross;
                                    }
                                    const _pl=checkLagPlacement(_pids.map(p=>({ nodeId:getPortNodeId(p) })), { oneChassis:_uno });
                                    if(_pl.singleMember) _bits.push(t('lag.warnSingle'));
                                    if(_pl.crossChassis) _bits.push(t('lag.warnCrossChassis',{n:_pl.nodes.length}));
                                }
                                if(_curMode && typeof checkLagPair==='function'){
                                    const _peerMode=_lagPeerMode(_lagMap[gid]);
                                    const _pair=_peerMode?checkLagPair(_curMode,_peerMode):null;
                                    if(_pair) _bits.push(_pair.issue==='both-passive'?t('lag.warnBothPassive'):t('lag.warnLacpStatic'));
                                }
                            } catch(_){}
                            const _lagWarn=_bits.length?`<div class="lag-warn" style="font-size:var(--fs-2xs);color:#d29922;padding:2px 0 6px">⚠ ${escapeHTML(_bits.join(' · '))}</div>`:'';
                            // VLAN del BUNDLE. Il campo porta la DICHIARAZIONE — e solo
                            // se e' la stessa su tutti i membri, perche' un numero solo
                            // non puo' rappresentarne due; quando divergono resta vuoto e
                            // il placeholder dice cosa vale davvero. Stessa forma del
                            // pannello porta: valore = cio' che hai detto, placeholder =
                            // cio' che si applica, e un placeholder non afferma niente.
                            const _lagOvr = _lagMap[gid].map(m => ((state.ports&&state.ports[m.pid])||{}).vlanOvr);
                            const _lagOvrUnici = [...new Set(_lagOvr.map(v => v==null ? '' : String(v)))];
                            const _lagVlanVal = _lagOvrUnici.length===1 ? _lagOvrUnici[0] : '';
                            const _lagVlanPh = _lagVlans.length===1 ? String(_lagVlans[0]) : t('lag.vlanMixed');
                            const _lagVlanInp = `<input type="number" min="1" max="4094" class="lag-group-vlan"
                              value="${escapeHTML(_lagVlanVal)}" placeholder="${escapeHTML(_lagVlanPh)}"
                              data-change="lag-vlan-set" data-gid="${escapeHTML(gid)}" data-tip="${t('lag.vlanTip')}">`;
                            const _modeSel=`<select class="lag-group-mode" data-change="lag-mode-set" data-gid="${escapeHTML(gid)}" data-tip="${t('lag.modeTip')}">`
                              +`<option value="" ${!_curMode?'selected':''}>${escapeHTML(t('lag.modeUnset'))}</option>`
                              +`<option value="active" ${_curMode==='active'?'selected':''}>${escapeHTML(t('lag.modeActive'))}</option>`
                              +`<option value="passive" ${_curMode==='passive'?'selected':''}>${escapeHTML(t('lag.modePassive'))}</option>`
                              +`<option value="static" ${_curMode==='static'?'selected':''}>${escapeHTML(t('lag.modeStatic'))}</option>`
                              +`</select>`;
                            lagHtml+=`<div class="lag-group-row">
                              <input class="lag-group-name" value="${escapeHTML(gname)}" placeholder="${t('pnl.node.lagNamePlaceholder')}" data-change="lag-rename" data-gid="${escapeHTML(gid)}" data-tip="${t('pnl.node.renameLagGroup')}">
                              <span class="lag-chips">${members}</span>
                              ${_lagVlanInp}
                              ${_modeSel}
                              <button class="lag-group-del" data-act="lag-dissolve" data-gid="${escapeHTML(gid)}" data-tip="${t('pnl.node.dissolveGroup')}">✕</button>
                            </div>${_lagWarn}`;
                        }
                        lagHtml+='</div></div></details>';
                        _lagHtml = lagHtml;
                    }
                }
            }
                // ---- Integrazione SNMP: device con IP (rack attivi/power E floor
                // come stampante/AP/webcam/NAS) → un solo pannello per tutti.
                if(d.isActive || ((d.hasIP && !(n.type==='pdu' && pduManagementPortCount(n)===0)) || (n.integration && n.integration.driver))){
                const intg=n.integration||{};
                const drv=intg.driver||'';
                const showSnmp=drv==='snmp-v1'||drv==='snmp-v2c'||drv==='snmp-v3';
                const isV3=drv==='snmp-v3';
                // v3 rilevato dalla discovery ma ancora senza credenziali: stato
                // DERIVATO (driver v3 + utente USM vuoto) → si azzera da sé appena
                // l'utente compila l'utente. Niente flag da mantenere.
                const v3NeedsCreds = isV3 && !String(intg.v3user||'').trim();
                const lp=intg.lastPoll?new Date(intg.lastPoll).toLocaleString('it-IT'):'';
                const snmpStatusBlock = showSnmp ? (() => {
                  const st = n.snmpStatus;
                  if(!st) return '';
                  const lastOkStr  = n.snmpLastOk  ? new Date(n.snmpLastOk).toLocaleString('it-IT')  : '—';
                  const lastErrMsg = n.snmpError   ? escapeHTML(n.snmpError) : '';
                  if(st === 'ok'){
                    return `<div style="display:flex;align-items:center;gap:6px;margin-top:10px;padding:6px 8px;background:rgba(57,211,83,.08);border:1px solid rgba(57,211,83,.25);border-radius:5px;font-size:var(--fs-2xs)">` + `<span class="snmp-dot ok" style="flex-shrink:0"></span>` + `<span style="color:#39d353;font-weight:600">SNMP OK</span>` + `<span style="color:var(--text-muted);margin-left:auto"><i class="fas fa-clock" style="margin-right:3px"></i>${lastOkStr}</span>` + `</div>`;
                  } else {
                    return `<div style="display:flex;flex-direction:column;gap:4px;margin-top:10px;padding:6px 8px;background:rgba(248,81,73,.08);border:1px solid rgba(248,81,73,.3);border-radius:5px;font-size:var(--fs-2xs)">` + `<div style="display:flex;align-items:center;gap:6px">` + `<i class="fas fa-circle-exclamation" style="color:#f85149;flex-shrink:0"></i>` + `<span style="color:#f85149;font-weight:600">${t('pnl.node.snmpNotResponding')}</span>` + `<span style="color:var(--text-muted);margin-left:auto"><i class="fas fa-clock" style="margin-right:3px"></i>${intg.lastPoll ? new Date(intg.lastPoll).toLocaleString('it-IT') : '—'}</span>` + `</div>` + (lastErrMsg ? `<div style="color:var(--text-muted);padding-left:18px">${lastErrMsg}</div>` : '') + (n.snmpLastOk ? `<div style="color:var(--text-muted);padding-left:18px">${t('pnl.node.lastOk',{when:lastOkStr})}</div>` : '') + `</div>`;
                  }
                })() : '';
                // Info di sistema live (sysLocation/sysContact/uptime) — card
                // di sola lettura, palette grigia neutra per distinguerla dallo
                // stato OK/errore. Compare solo dopo un import che le ha trovate.
                const snmpSystemBlock = (showSnmp && intg.system && typeof intg.system === 'object') ? (() => {
                  const sy = intg.system;
                  const _row = (icon, label, val) => `<div style="display:flex;gap:8px;align-items:baseline;line-height:1.45"><i class="fas ${icon}" style="width:13px;text-align:center;color:var(--text-muted);flex-shrink:0"></i><span style="color:var(--text-muted);flex-shrink:0">${label}</span><span style="margin-left:auto;text-align:right;color:var(--text-main);word-break:break-word">${escapeHTML(val)}</span></div>`;
                  const rows = [];
                  if(sy.sysLocation)   rows.push(_row('fa-location-dot', t('intg.sysLocation'), sy.sysLocation));
                  if(sy.sysContact)    rows.push(_row('fa-user',         t('intg.sysContact'),  sy.sysContact));
                  if(sy.sysUpTimeText) rows.push(_row('fa-clock',        t('intg.sysUptime'),   sy.sysUpTimeText));
                  if(!rows.length) return '';
                  return `<div style="display:flex;flex-direction:column;gap:5px;margin-top:8px;padding:7px 9px;background:rgba(139,148,158,.07);border:1px solid rgba(139,148,158,.25);border-radius:5px;font-size:var(--fs-2xs)">${rows.join('')}</div>`;
                })() : '';
                // Stato stampante live (Printer-MIB): barre toner/inchiostro per
                // colore + contapagine + stato. Stessa card grigia neutra; i colori
                // delle barre sono i colori fisici dell'inchiostro (CMYK).
                const snmpPrinterBlock = (showSnmp && intg.printer && typeof intg.printer === 'object') ? (() => {
                  const pr = intg.printer;
                  const SW = { cyan:'#22b8cf', magenta:'#e64980', yellow:'#fab005', black:'#ced4da', other:'#8b949e' };
                  const rows = (pr.supplies||[]).map(s => {
                    const sw = SW[s.color] || SW.other;
                    const pct = (typeof s.pct === 'number') ? s.pct : null;
                    const pctCol = pct===null ? 'var(--text-muted)' : pct<10 ? '#f85149' : pct<25 ? '#d29922' : 'var(--text-main)';
                    const fill = pct===null ? '' : `<span style="display:block;height:100%;width:${pct}%;background:${sw}"></span>`;
                    const tip = s.desc ? ` data-tip="${escapeHTML(s.desc)}"` : '';
                    return `<div style="display:flex;align-items:center;gap:7px"${tip}><span style="width:9px;height:9px;border-radius:2px;background:${sw};border:1px solid rgba(201,209,217,.25);flex-shrink:0"></span><span style="color:var(--text-muted);width:80px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(s.name||'')}</span><span style="flex:1;height:5px;background:rgba(139,148,158,.18);border-radius:3px;overflow:hidden">${fill}</span><span style="color:${pctCol};min-width:30px;text-align:right">${pct===null?'—':pct+'%'}</span></div>`;
                  });
                  const foot = [];
                  if(pr.pageCount) foot.push(`<span><i class="fas fa-file-lines" style="margin-right:4px"></i>${t('prt.pages')}: <span style="color:var(--text-main)">${Number(pr.pageCount).toLocaleString('it-IT')}</span></span>`);
                  if(pr.status)    foot.push(`<span><i class="fas fa-circle" style="font-size:7px;vertical-align:1px;margin-right:4px;color:${pr.status==='idle'?'#39d353':pr.status==='printing'?'#58a6ff':'#8b949e'}"></i>${t('prt.st.'+pr.status)}</span>`);
                  if(pr.hasError)  foot.push(`<span style="color:#f85149"><i class="fas fa-triangle-exclamation" style="margin-right:4px"></i>${t('prt.error')}</span>`);
                  const footHtml = foot.length ? `<div style="display:flex;gap:12px;flex-wrap:wrap;color:var(--text-muted);padding-top:4px;border-top:1px solid rgba(139,148,158,.15);margin-top:1px">${foot.join('')}</div>` : '';
                  if(!rows.length && !footHtml) return '';
                  return `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;padding:8px 9px;background:rgba(139,148,158,.07);border:1px solid rgba(139,148,158,.25);border-radius:5px;font-size:var(--fs-2xs)">${rows.join('')}${footHtml}</div>`;
                })() : '';
                // Risorse host live (HOST-RESOURCES): CPU/RAM/dischi con barre
                // colorate per occupazione. Stessa card grigia neutra.
                const snmpHostResBlock = (showSnmp && intg.hostResources && typeof intg.hostResources === 'object') ? (() => {
                  const hr = intg.hostResources;
                  const _fb = v => { if(!v) return '0'; const u=['B','KB','MB','GB','TB','PB']; let x=v,i=0; while(x>=1024&&i<u.length-1){x/=1024;i++;} return (x>=100?Math.round(x):x.toFixed(1))+' '+u[i]; };
                  const _uc = p => p>=90?'#f85149':p>=75?'#d29922':'#3fb950';
                  const _row = (icon,label,pct,right,tip) => { const c=_uc(pct); const w=Math.max(0,Math.min(100,pct));
                    return `<div style="display:flex;align-items:center;gap:7px"${tip?` data-tip="${escapeHTML(tip)}"`:''}><i class="fas ${icon}" style="width:13px;text-align:center;color:var(--text-muted);flex-shrink:0"></i><span style="color:var(--text-muted);width:62px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(label)}</span><span style="flex:1;height:5px;min-width:24px;background:rgba(139,148,158,.18);border-radius:3px;overflow:hidden"><span style="display:block;height:100%;width:${w}%;background:${c}"></span></span><span style="color:${c};min-width:30px;text-align:right">${pct}%</span>${right?`<span style="color:var(--text-muted);min-width:54px;text-align:right">${escapeHTML(right)}</span>`:''}</div>`; };
                  const rows = [];
                  if(typeof hr.cpuLoad==='number') rows.push(_row('fa-microchip','CPU',hr.cpuLoad,hr.cpuCores?`${hr.cpuCores} core`:'',null));
                  if(hr.ram) rows.push(_row('fa-memory','RAM',hr.ram.pct,_fb(hr.ram.totalBytes),`${_fb(hr.ram.usedBytes)} / ${_fb(hr.ram.totalBytes)}`));
                  (hr.volumes||[]).forEach(v=>rows.push(_row('fa-hard-drive',v.name,v.pct,_fb(v.totalBytes),`${_fb(v.usedBytes)} / ${_fb(v.totalBytes)}`)));
                  if(!rows.length) return '';
                  return `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;padding:8px 9px;background:rgba(139,148,158,.07);border:1px solid rgba(139,148,158,.25);border-radius:5px;font-size:var(--fs-2xs)">${rows.join('')}</div>`;
                })() : '';
                const snmpImportBlock = showSnmp ? `<div style="margin-top:10px"><button class="toolbar-btn primary" style="width:100%;font-size:0.78rem;padding:5px 6px" id="snmp-poll-btn" data-act="snmp-poll" data-nid="${n.id}"><i class="fas fa-network-wired"></i> ${t('snmp.import')}</button></div>` : '';
                // Avviso: device SNMPv3 rilevato dalla discovery senza credenziali.
                const snmpV3CredWarn = v3NeedsCreds ? `<div style="display:flex;align-items:center;gap:6px;margin-top:10px;padding:6px 8px;background:rgba(210,153,34,.10);border:1px solid rgba(210,153,34,.35);border-radius:5px;font-size:var(--fs-2xs)"><i class="fas fa-key" style="color:#d29922;flex-shrink:0"></i><span style="color:#d29922;font-weight:600">${t('intg.v3NeedsCreds')}</span></div>` : '';
                const _intgPreview = (() => {
                    if(!showSnmp) return `<span class="props-collapsible-preview muted">${t('intg.noDriver')}</span>`;
                    const _drvLbl = drv==='snmp-v1'?'SNMPv1':drv==='snmp-v2c'?'SNMPv2c':'SNMPv3';
                    const _st = n.snmpStatus;
                    const _stHtml = v3NeedsCreds ? ` · <span style="color:#d29922"><i class="fas fa-key"></i> ${t('intg.v3todo')}</span>`
                                  : _st==='ok'  ? ` · <span style="color:#39d353">OK</span>`
                                  : _st==='err' ? ` · <span style="color:#f85149">${t('common.error')}</span>`
                                  : '';
                    return `<span class="props-collapsible-preview">${_drvLbl}${_stHtml}</span>`;
                })();
                _integrationHtml = `<details class="snmp-section props-collapsible props-secondary" ${_propsSectionIsOpen('integration')?'open':''} data-toggle="props-section" data-section="integration"><summary class="props-collapsible-head"><span><i class="fas fa-plug"></i> ${t('sec.integration')}</span>${_intgPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body"><div class="prop-group"><label>Driver</label><select data-change="update-intg" data-nid="${n.id}" data-ikey="driver"><option value="" ${selected(drv,'')}>${t('o.sepNone')}</option><option value="snmp-v1" ${selected(drv,'snmp-v1')}>SNMP v1</option><option value="snmp-v2c"${selected(drv,'snmp-v2c')}>SNMP v2c</option><option value="snmp-v3" ${selected(drv,'snmp-v3')}>SNMP v3</option></select></div>${showSnmp?`<div class="prop-group"><label>${t('f.hostOverride')}</label><input value="${escapeHTML(intg.host||'')}" placeholder="${t('pnl.node.useNodeIpPlaceholder')}" data-change="update-intg-host" data-nid="${n.id}"></div><div class="prop-row2"><div class="prop-group"><label>${t('intg.udpPort')}</label><input type="number" value="${intg.port||161}" data-change="update-intg" data-nid="${n.id}" data-ikey="port" data-icoerce="intdef" data-idef="161"></div><div class="prop-group"><label>Timeout (s)</label><input type="number" value="${intg.timeout||3}" data-change="update-intg" data-nid="${n.id}" data-ikey="timeout" data-icoerce="intdef" data-idef="3"></div></div>${!isV3?`<div class="prop-group"><label>Community</label><input type="password" autocomplete="new-password" value="${escapeHTML(intg.community||'public')}" data-change="update-intg" data-nid="${n.id}" data-ikey="community"></div>`:''}${isV3?`<div class="prop-group"><label>${t('intg.usmUser')}</label><input value="${escapeHTML(intg.v3user||'')}" data-change="update-intg" data-nid="${n.id}" data-ikey="v3user"></div><div class="prop-row2"><div class="prop-group" style="flex:0 0 72px"><label>Auth</label><select data-change="update-intg" data-nid="${n.id}" data-ikey="v3authProto"><option ${selected(intg.v3authProto||'SHA','MD5')}>MD5</option><option ${selected(intg.v3authProto||'SHA','SHA')}>SHA</option></select></div><div class="prop-group"><label>${t('f.authPass')}</label><input type="password" value="${escapeHTML(intg.v3authPass||'')}" autocomplete="new-password" data-change="update-intg" data-nid="${n.id}" data-ikey="v3authPass"></div></div><div class="prop-row2"><div class="prop-group" style="flex:0 0 72px"><label>Priv</label><select data-change="update-intg" data-nid="${n.id}" data-ikey="v3privProto"><option ${selected(intg.v3privProto||'AES','DES')}>DES</option><option ${selected(intg.v3privProto||'AES','AES')}>AES</option></select></div><div class="prop-group"><label>${t('f.privPass')}</label><input type="password" value="${escapeHTML(intg.v3privPass||'')}" autocomplete="new-password" data-change="update-intg" data-nid="${n.id}" data-ikey="v3privPass"></div></div><div class="prop-group"><label>Security level</label><select data-change="update-intg" data-nid="${n.id}" data-ikey="v3secLevel"><option value="noAuthNoPriv"${selected(intg.v3secLevel||'authPriv','noAuthNoPriv')}>noAuthNoPriv</option><option value="authNoPriv"  ${selected(intg.v3secLevel||'authPriv','authNoPriv'  )}>authNoPriv</option><option value="authPriv"    ${selected(intg.v3secLevel||'authPriv','authPriv'    )}>authPriv</option></select></div><div class="prop-group"><label>${t('intg.context')}</label><input value="${escapeHTML(intg.v3context||'')}" placeholder="${t('pnl.node.v3ContextPlaceholder')}" data-tip="${t('pnl.node.v3ContextTip')}" data-change="update-intg" data-nid="${n.id}" data-ikey="v3context"></div>`:''}`:''}</div></details>${snmpV3CredWarn}${snmpStatusBlock}${snmpSystemBlock}${snmpPrinterBlock}${snmpHostResBlock}${snmpImportBlock}`;
                // Inventario non e' piu' una fisarmonica separata: i 4 campi
                // (Marca/Modello/Seriale/Firmware-OS) vengono inseriti come
                // primi campi dentro la fisarmonica device-specifica via
                // _buildInventoryFieldsHtml(n, d).
                _inventoryHtml = '';
                // ---- Backup configurazione (puntatore, NON il config) ----
                // Campo DR: DOVE vive il backup della running-config + metodo + data.
                // 🔒 Il ref è validato (niente credenziali) dal setter; qui è solo input.
                {
                    const _bk = (n.backup && typeof n.backup === 'object') ? n.backup : {};
                    const _bMethod = _bk.method || '';
                    const _bAtMs = _bk.at ? Date.parse(_bk.at) : NaN;
                    const _bAtOk = !isNaN(_bAtMs);
                    const _bAge = _bAtOk ? (Date.now() - _bAtMs) / 86400000 : Infinity;
                    const _bColor = !_bAtOk ? '#6e7681' : (_bAge <= 30 ? '#3fb950' : '#d29922');
                    const _bAtLabel = _bAtOk ? new Date(_bAtMs).toLocaleDateString() : t('backup.never');
                    const _bPreview = _bk.ref
                        ? `<span class="props-collapsible-preview">${_bAtOk ? escapeHTML(_bAtLabel) : t('backup.set')}</span>`
                        : `<span class="props-collapsible-preview muted">${t('backup.none')}</span>`;
                    const _mOpt = (v, lbl) => `<option value="${v}" ${selected(_bMethod, v)}>${lbl}</option>`;
                    _backupHtml = `<details class="props-collapsible props-secondary" ${_propsSectionIsOpen('backup') ? 'open' : ''} data-toggle="props-section" data-section="backup"><summary class="props-collapsible-head"><span><i class="fas fa-database"></i> ${t('sec.backup')}</span>${_bPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">`
                        + `<div class="prop-group"><label>${t('backup.ref')}</label><input value="${escapeHTML(_bk.ref || '')}" placeholder="${t('backup.refPlaceholder')}" data-tip="${t('backup.refTip')}" data-change="backup-ref" data-node="${n.id}"></div>`
                        + `<div class="prop-group"><label>${t('backup.method')}</label><select data-change="backup-method" data-node="${n.id}">${_mOpt('', t('o.sepNone'))}${_mOpt('ansible', 'Ansible')}${_mOpt('rancid', 'RANCID')}${_mOpt('oxidized', 'Oxidized')}${_mOpt('git', 'Git')}${_mOpt('manual', t('backup.methodManual'))}</select></div>`
                        + `<div class="prop-group"><label>${t('backup.last')}</label><div style="display:flex;align-items:center;gap:8px"><span style="color:${_bColor};font-size:0.78rem;font-weight:600">${escapeHTML(_bAtLabel)}</span><button type="button" class="toolbar-btn" style="font-size:var(--fs-2xs);padding:3px 8px" data-act="backup-mark-now" data-node="${n.id}" data-tip="${t('backup.markNowTip')}"><i class="fas fa-check"></i> ${t('backup.markNow')}</button></div></div>`
                        + `</div></details>`;
                }
                } // fine Integrazione SNMP (rack attivi/power + floor con IP)
            // ---- Blocchi device-specifici per tipo (estratti) ----
            // La lunga catena if(n.type===...) vive in app-properties-node-devices.js.
            // Floor → contributo a h (layout inline); rack/attivi → contributo a
            // _devSpecHtml (accordion device-spec), cucito nellassemblaggio qui sotto.
            {
                const _dc = _nodeDeviceChainHtml(n, d);
                h += _dc.h;
                _devSpecHtml += _dc.devSpec;
                // FLOOR: la fisarmonica "Rete & Accesso" viene catturata in _dc.net dal
                // device-chain e ri-emessa QUI, DOPO la fisarmonica device-specifica già
                // dentro _dc.h → la 1a fisarmonica resta sempre quella del device.
                // (Sui rack _dc.net è vuoto: l'ordine è gestito dall'assemblaggio sotto.)
                if(!d.isRack) h += _dc.net || '';
            }
            // ---- Assemblaggio finale ordine fisarmoniche per device RACK ----
            // Ordine: Device-specifico (incluso Patch Panel) → Rete & Accesso →
            // Layout porte → LAG → Integrazione. I floor non usano queste
            // variabili (rimangono nel loro flusso lineare con h+= diretto).
            if(d.isRack){
                // Inventario (Marca/Modello/Seriale/Firmware) e' ora dentro
                // ogni fisarmonica device-specifica come primi campi; la
                // variabile _inventoryHtml resta a stringa vuota e non viene
                // concatenata qui.
                h += _devSpecHtml
                   + _patchPanelHtml
                   + _networkAccessHtml
                   + _layoutPortsHtml
                   + _stackingHtml
                   + _haHtml
                   + _lagHtml
                   + _integrationHtml
                   + _backupHtml;
            }
            // ---- Porte di rete (floor multi-porta) ----
            // PC dual-NIC, AP dual-uplink, stampante con NIC+mgmt, endpoint custom:
            // piu' interfacce fisiche distinte. Ogni porta diventa un LED collegabile
            // a un cavo separato (render .floor-ports). Disponibile su TUTTI i device
            // floor tranne i passivi (presa a muro, quadro), i pass-through (presa/
            // voip: la doppia connessione e' gia' data da passThrough) e le strutture
            // (stanza). Cap basso (8): un endpoint non ha decine di NIC.
            if(!d.isRack && !d.isPassive && !d.isStructural && !d.passThrough){
                const _fpc = n.ports!==undefined ? n.ports : (d.ports||1);
                const _fpcPrev = `<span class="props-collapsible-preview">${_fpc===1?t('pnl.node.portCountOne',{n:_fpc}):t('pnl.node.portCountMany',{n:_fpc})}</span>`;
                h+=`<details class="props-collapsible" ${_propsSectionIsOpen('floor-ports')?'open':''} data-toggle="props-section" data-section="floor-ports"><summary class="props-collapsible-head"><span><i class="fas fa-ethernet"></i> ${t('sec.netPorts')}</span>${_fpcPrev}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('field.portCount')}</label>
                      <input type="number" min="1" max="8" value="${_fpc}" data-change="update-n" data-nfield="ports" data-ncoerce="int" data-ndef="${d.ports||1}" data-nmin="1" data-nmax="8" data-tip="${t('pnl.node.floorPortsTip')}">
                    </div>
                    <p style="font-size:var(--fs-2xs);color:var(--text-muted);margin:6px 2px 0;line-height:1.4"><i class="fas fa-circle-info" style="margin-right:5px"></i>${t('pnl.node.floorPortsInfo')}</p>
                </div></details>`;
            }
            // (Bottone "Tenta collegamento automatico" e' stato spostato dentro
            // l'accordion "Rete & Accesso" — sotto il campo MAC, da cui dipende.)
            // (Wi-Fi: spunta + config ora vivono in fondo a "Rete & Accesso",
            //  dentro _buildNetAccessHtml — un solo punto per tutti i tipi.)
            // L3-lite: sezione "Gateway L3 / SVI" — appare solo se il device
            // instrada >=1 VLAN (deriva dal binding gateway, read-only).
            // Integrazione SNMP per i floor con IP (stampante/AP/webcam/NAS…):
            // stesso pannello dei rack, montato qui nel flusso lineare dei floor
            // (per i rack è già cucito nell'assemblaggio sopra).
            if(!d.isRack) h += _integrationHtml + _backupHtml;
            if(typeof _l3SviSectionHtml === 'function') h += _l3SviSectionHtml(n.id);
            // Skin pannello custom (prototipo): solo device rack (hanno un frontale).
            if(d.isRack && typeof _panelSkinSectionHtml === 'function') h += _panelSkinSectionHtml(n);
            const _notesLen = (n.notes||'').trim().length;
            const _notesPreview = _notesLen
                ? `<span class="props-collapsible-preview">${t('notes.chars',{n:_notesLen})}</span>`
                : `<span class="props-collapsible-preview muted">${t('common.empty')}</span>`;
            h+=`<details class="props-collapsible props-secondary" ${_propsSectionIsOpen('notes')?'open':''} data-toggle="props-section" data-section="notes"><summary class="props-collapsible-head"><span><i class="fas fa-sticky-note"></i> ${t('common.notes')}</span>${_notesPreview}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                <div class="prop-group">
                  <textarea rows="3" placeholder="${t('notes.placeholder')}"
                            data-change="update-n" data-nfield="notes">${escapeHTML(n.notes||'')}</textarea>
                </div>
            </div></details>`;
            // (bottone Elimina ora nel menu kebab dell'header del pannello)
        }
        panel.innerHTML=h;
        _enableManualValueInProps(panel);
        _activatePropsTab(n.name||d.name);
}

// Chiamato dal dispatcher renderProps (core, bundle).
expose({ _renderNodeProps });
