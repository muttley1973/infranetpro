// ============================================================
// PROPERTIES PANEL — catena device-specifica per-tipo (foglia di _renderNodeProps)
// ============================================================
// MODULO ESM (migrato da lib/app-properties-node-devices.js): _nodeDeviceChainHtml
// genera i blocchi per-tipo (h = device FLOOR, devSpec = accordion RACK/attivi).
// Chiamato da app-properties-node.js; _floorAccessVlanRow è usato anche da
// app-properties-port (bundle) + _deviceAccessVlanPid da app-vlan-autopoll (classic)
// → expose(). Builder del core + legacy via win.* (selected/checked/_build*/
// _propsSectionIsOpen/_powerLiveHtml/escapeHTML/TYPES/state/_effPortVlan/radioPid/
// getWallPortLabel); t dal ponte.
// ── ASSE B (Blocco 5): gli onchange inline della catena device-spec sono passati a
//    event delegation (data-change="..."), vedi il blocco registerChangeActions sotto.
//    Nessun cambiamento di logica.
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML } from './app-util.js';
import { _buildDeviceBrandModelPreview, _propsSectionIsOpen, _buildInventoryFieldsHtml, _buildNetAccessHtml, _powerLiveHtml, renderProps } from './app-properties.js';   // ritiro ponte fase 2+: funzioni/builder (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)
import { MAX_PDU_OUTLETS, normalizePduOutletCount, pduManagementMode, pduManagementPortCount, pduSerialPortCount, pduAuxiliaryPortCount, outletStatusText, pduOutletStatusState, pduOutletConnection, hasPowerOutlets, rendersOutletGrid } from '../lib/pdu-layout.js';
import { MAX_POWER_GROUPS, powerGroups, powerGroupView, nextGroupId, normalizeGroupId, normalizeSwitching, normalizeBackup } from '../lib/power-groups.js';   // gruppi di prese: due assi soli, dichiarati
import { nodeById, getNodeDisplayName, markDirty, selected, checked, getWallPortLabel, updateFloorId, updateWallPortId, _toggleArrayField } from './app.js';   // ritiro ponte: helper option-selected/checked + (ASSE B) setter ex-onchange
import { renderAll } from './app-render-core.js';
import { _effPortVlan, setEndpointVlan } from './app-vlan-autopoll.js';   // ritiro ponte: funzioni foglia UI/vlan/popup + (ASSE B) setEndpointVlan (ex onchange)
import { _hvPanelHtml, _vmSectionHtml } from './app-hypervisor.js';   // ritiro ponte: funzioni disc/props/vlan/hv (ex win.*)
import { registerClickActions, registerChangeActions } from './app-delegation.js';   // ASSE B (Blocco 5): event delegation degli onchange inline della catena device-spec
import { pduConnectionDeviceSelect } from './app-pdu-connection.js';

// ── ASSE B (Blocco 5): azioni delegate della catena device-spec ─────────────
// Gli onchange inline di questo modulo diventano UN attributo data-change + una
// azione registrata qui. updateFloorId/updateWallPortId/_toggleArrayField/
// setEndpointVlan sono usati SOLO da questa superficie → registrazione LOCALE.
// I 163 updateN inline passano invece a data-change="update-n" (azione + coercizioni
// intdef/floatdef/bool registrate in app-properties-node.js, che possiede update-n).
// _toggleArrayField legge id/campo/valore da data-taid/-tafield/-taval; setEndpointVlan
// da data-nid/-pid; entrambi il flag da el.checked / il testo da el.value.
registerChangeActions({
    'floor-id':      (el) => updateFloorId(el.value),
    'wallport-id':   (el) => updateWallPortId(el.value),
    'toggle-array':  (el) => _toggleArrayField(el.dataset.taid, el.dataset.tafield, el.dataset.taval, el.checked),
    'endpoint-vlan': (el) => setEndpointVlan(el.dataset.nid, el.dataset.pid, el.value),
});

registerClickActions({
    'pdu-connection-reset': (el) => clearPduConnection(el.dataset.nid, +el.dataset.pindex),
    'pdu-outlet-status-reset': (el) => clearPduOutletStatus(el.dataset.nid, +el.dataset.pindex),
});

registerChangeActions({
    'pdu-connection-field': (el) => setPduConnectionField(el.dataset.nid, +el.dataset.pindex, el.dataset.pfield, el.value),
    'pdu-outlet-field': (el) => setPduOutletField(el.dataset.nid, +el.dataset.pindex, el.dataset.pfield, el.value),
});

// ── GRUPPI DI PRESE — la parola dell'utente, scritta sul nodo ───────────────
// Un gruppo dice due cose e basta (lib/power-groups.js): se si puo' spegnere da
// solo e se la batteria lo tiene. Qui si SCRIVE; a leggerlo e normalizzarlo
// pensa la lib, cosi' pannello, rack e dossier non si scrivono tre regole loro.
function _ensurePowerGroupList(n){
    if(!n || !hasPowerOutlets(n.type)) return null;
    if(!Array.isArray(n.powerGroups)) n.powerGroups = powerGroups(n).map(g => ({ ...g }));
    return n.powerGroups;
}

function addPowerGroup(nodeId){
    const n = nodeById(nodeId);
    const list = _ensurePowerGroupList(n);
    if(!list || list.length >= MAX_POWER_GROUPS) return;
    const id = nextGroupId(n);
    if(!id) return;
    list.push({ id, name: t('pwg.defaultName', { n: list.length + 1 }), switching:'switched', backup:'battery' });
    markDirty();
    _pduConnectionRerender();
}

function removePowerGroup(nodeId, groupId){
    const n = nodeById(nodeId);
    const list = _ensurePowerGroupList(n);
    if(!list) return;
    const id = normalizeGroupId(groupId);
    const i = list.findIndex(g => g && normalizeGroupId(g.id) === id);
    if(i < 0) return;
    list.splice(i, 1);
    // Le prese che ci puntavano tornano SENZA gruppo. Lasciarle appese a un id
    // cancellato sarebbe un dato falso: l'utente ha deciso che quel gruppo non
    // esiste, e una presa non puo' appartenere a qualcosa che non c'e' piu'.
    for(const outlet of (Array.isArray(n.powerOutlets) ? n.powerOutlets : [])){
        if(outlet && normalizeGroupId(outlet.groupOvr) === id) outlet.groupOvr = '';
    }
    if(!list.length) delete n.powerGroups;
    markDirty();
    _pduConnectionRerender();
}

function setPowerGroupField(nodeId, groupId, field, value){
    if(!['name', 'switching', 'backup'].includes(field)) return;
    const n = nodeById(nodeId);
    const list = _ensurePowerGroupList(n);
    if(!list) return;
    const g = list.find(x => x && normalizeGroupId(x.id) === normalizeGroupId(groupId));
    if(!g) return;
    if(field === 'name') g.name = String(value == null ? '' : value).trim();
    else if(field === 'switching') g.switching = normalizeSwitching(value);
    else g.backup = normalizeBackup(value);
    markDirty();
    _pduConnectionRerender();
}

// Assegnazione presa -> gruppo. Scrive in `groupOvr`, non in `group`: il primo
// e' la tua parola, il secondo restera' al catalogo quando sapra' leggere «Group
// 2 - Output 1» dal nome della presa. Cosi' il giorno che arriva non ti sovrascrive.
function setPduOutletGroup(nodeId, index, groupId){
    const n = nodeById(nodeId);
    const outlet = _ensurePduOutletEntry(n, index);
    if(!outlet) return;
    outlet.groupOvr = normalizeGroupId(groupId);
    markDirty();
    _pduConnectionRerender();
}

registerClickActions({
    'power-group-add': (el) => addPowerGroup(el.dataset.nid),
    'power-group-del': (el) => removePowerGroup(el.dataset.nid, el.dataset.gid),
});

registerChangeActions({
    'power-group-field': (el) => setPowerGroupField(el.dataset.nid, el.dataset.gid, el.dataset.gfield, el.value),
    'pdu-outlet-group': (el) => setPduOutletGroup(el.dataset.nid, +el.dataset.pindex, el.value),
});


function _pduOutletStatusLabel(status){
    return ({
        active: t('port.statusActive'),
        fault: 'Fault',
        inactive: t('port.statusInactive'),
    })[status] || status;
}

function _pduOutletStateHtml(n){
    const outlets = Array.isArray(n && n.powerOutlets) ? n.powerOutlets : [];
    if(!outlets.length) return '';
    const counts = { active:0, fault:0, inactive:0 };
    const colors = { active:'var(--active-color)', fault:'var(--fault-color)', inactive:'var(--inactive-color)' };
    const chips = outlets.slice(0, MAX_PDU_OUTLETS).map((outlet, index) => {
        const status = pduOutletStatusState(outlet);
        counts[status] = (counts[status] || 0) + 1;
        const label = String(outlet.label || outlet.name || `P${index + 1}`);
        const raw = outlet.rawStatus || outletStatusText(outlet);
        const title = [label, _pduOutletStatusLabel(status), raw && raw !== status ? raw : ''].filter(Boolean).join(' · ');
        return `<span title="${escapeHTML(title)}" style="display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border:1px solid var(--panel-border);border-radius:4px;font-size:.8rem;color:var(--text-main);background:var(--bg-color)"><i class="fas fa-square" style="font-size:.65rem;color:${colors[status]||colors.inactive}"></i>${escapeHTML(label)}</span>`;
    }).join('');
    const summary = Object.entries(counts).filter(([, count]) => count > 0).map(([status, count]) => `<span style="color:${colors[status]}">${count} ${escapeHTML(_pduOutletStatusLabel(status))}</span>`).join(' · ');
    return `<div class="prop-group"><label>${escapeHTML(t('pnl.dev.pduOutletsState'))}</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${chips}</div>
        <div class="pdu-port-model-note" data-tip="${escapeHTML(t('pnl.dev.pduOutletsStateNoteTip'))}" data-tip-wrap><i class="fas fa-circle-info"></i> ${summary} · ${escapeHTML(t('pnl.dev.pduOutletsStateNote'))}</div>
    </div>`;
}

function _pduOutletSource(n){
    if(!n) return [];
    if(Array.isArray(n.powerOutlets)) return n.powerOutlets;
    if(Array.isArray(n.spec?.powerOutlets)) return n.spec.powerOutlets;
    if(Array.isArray(n.pduOutlets)) return n.pduOutlets;
    if(Array.isArray(n.spec?.pduOutlets)) return n.spec.pduOutlets;
    return [];
}

function _ensurePduOutletEntry(n, index){
    if(!n || !hasPowerOutlets(n.type) || !Number.isInteger(index) || index < 0 || index >= MAX_PDU_OUTLETS) return null;
    const source = _pduOutletSource(n);
    if(!Array.isArray(n.powerOutlets)) n.powerOutlets = source.map(outlet => ({ ...(outlet || {}) }));
    while(n.powerOutlets.length <= index) n.powerOutlets.push({ name:`P${n.powerOutlets.length + 1}` });
    if(!n.powerOutlets[index] || typeof n.powerOutlets[index] !== 'object') n.powerOutlets[index] = { name:`P${index + 1}` };
    return n.powerOutlets[index];
}

function _pduConnectionRerender(){
    renderAll();
    renderProps();
}

function setPduConnectionField(nodeId, index, field, value){
    if(!['deviceId', 'deviceName', 'portName'].includes(field)) return;
    const node = nodeById(nodeId);
    const outlet = _ensurePduOutletEntry(node, index);
    if(!outlet) return;
    if(!outlet.connectionOvr || typeof outlet.connectionOvr !== 'object') outlet.connectionOvr = {};
    const next = String(value == null ? '' : value).trim();
    if(field === 'deviceId'){
        if(!next){
            delete outlet.connectionOvr.deviceId;
            delete outlet.connectionOvr.deviceName;
        }else if(next !== '__current__'){
            const selected = nodeById(next);
            if(!selected) return;
            outlet.connectionOvr.deviceId = String(selected.id);
            outlet.connectionOvr.deviceName = String(getNodeDisplayName(selected) || selected.name || selected.hostname || selected.id);
        }
    }else if(next) outlet.connectionOvr[field] = next;
    else delete outlet.connectionOvr[field];
    if(!Object.keys(outlet.connectionOvr).length) delete outlet.connectionOvr;
    markDirty();
    _pduConnectionRerender();
}

function clearPduConnection(nodeId, index){
    const node = nodeById(nodeId);
    const outlet = _ensurePduOutletEntry(node, index);
    if(!outlet) return;
    if(outlet.connectionOvr && typeof outlet.connectionOvr === 'object') delete outlet.connectionOvr;
    markDirty();
    _pduConnectionRerender();
}

function setPduOutletField(nodeId, index, field, value){
    if(field !== 'statusOvr') return;
    const node = nodeById(nodeId);
    const outlet = _ensurePduOutletEntry(node, index);
    if(!outlet) return;
    const next = String(value == null ? '' : value).trim().toLowerCase();
    if(['active', 'inactive', 'fault'].includes(next)) outlet.statusOvr = next;
    else delete outlet.statusOvr;
    markDirty();
    _pduConnectionRerender();
}

function clearPduOutletStatus(nodeId, index){
    const node = nodeById(nodeId);
    const outlet = _ensurePduOutletEntry(node, index);
    if(!outlet) return;
    delete outlet.statusOvr;
    markDirty();
    _pduConnectionRerender();
}

// Le opzioni del menu «gruppo». `selected()` torna una parola chiave di
// attributo, non un valore: e' per questo che si usa lui e non un ternario.
function _powerGroupOptionsHtml(groups, current){
    let out = `<option value="">${escapeHTML(t('pwg.noGroup'))}</option>`;
    for(const g of groups){
        out += `<option value="${escapeHTML(g.id)}" ${selected(current, g.id)}>${escapeHTML(g.name)}</option>`;
    }
    return out;
}

// Il campo «gruppo» nella riga di una presa. Vuoto finche' nessun gruppo esiste:
// un menu con la sola voce «nessun gruppo» sarebbe una scelta senza conseguenza.
function _pduOutletGroupFieldHtml(n, index, outlet, groups){
    if(!groups.length) return '';
    const current = normalizeGroupId(outlet && outlet.groupOvr !== undefined ? outlet.groupOvr : (outlet && outlet.group));
    return `<label class="pdu-connection-field"><span>${escapeHTML(t('pwg.group'))}</span>`
        + `<select data-change="pdu-outlet-group" data-nid="${escapeHTML(n.id)}" data-pindex="${escapeHTML(String(index))}">`
        + _powerGroupOptionsHtml(groups, current)
        + '</select></label>';
}

// Una riga per gruppo: nome, i due assi, quante prese ci stanno, e il cestino.
function _powerGroupRowHtml(n, group, count){
    return `<div class="pwg-row">
        <span class="pwg-dot pg-${escapeHTML(String(group.index + 1))}"></span>
        <input class="pwg-name" value="${escapeHTML(group.name)}" placeholder="${escapeHTML(t('pwg.namePh'))}" data-change="power-group-field" data-nid="${escapeHTML(n.id)}" data-gid="${escapeHTML(group.id)}" data-gfield="name">
        <select class="pwg-sel pwg-sel-sw" title="${escapeHTML(t('pwg.switching'))}" data-change="power-group-field" data-nid="${escapeHTML(n.id)}" data-gid="${escapeHTML(group.id)}" data-gfield="switching">
            <option value="switched" ${selected(group.switching, 'switched')}>${escapeHTML(t('pwg.switched'))}</option>
            <option value="always" ${selected(group.switching, 'always')}>${escapeHTML(t('pwg.always'))}</option>
        </select>
        <select class="pwg-sel pwg-sel-bk" title="${escapeHTML(t('pwg.backup'))}" data-change="power-group-field" data-nid="${escapeHTML(n.id)}" data-gid="${escapeHTML(group.id)}" data-gfield="backup">
            <option value="battery" ${selected(group.backup, 'battery')}>${escapeHTML(t('pwg.battery'))}</option>
            <option value="surge" ${selected(group.backup, 'surge')}>${escapeHTML(t('pwg.surge'))}</option>
        </select>
        <span class="pwg-count">${escapeHTML(t('pwg.outletsN', { n: count }))}</span>
        <button class="pwg-del" type="button" title="${escapeHTML(t('pwg.remove'))}" aria-label="${escapeHTML(t('pwg.remove'))}" data-act="power-group-del" data-nid="${escapeHTML(n.id)}" data-gid="${escapeHTML(group.id)}"><i class="fas fa-trash"></i></button>
    </div>`;
}

// La sezione «Gruppi di prese». Vale per chiunque abbia prese — UPS e barre: il
// gruppo non e' una stranezza dell'UPS, e' come si organizzano le prese. Si
// costruisce per CONCATENAZIONE perche' una variabile locale che trasporta HTML
// lo scanner dell'escaping non la sa dimostrare, e finirebbe nel residuo.
function _powerGroupsHtml(n){
    const view = powerGroupView(n, _pduOutletSource(n));
    const groups = view.groups;
    const preview = groups.length
        ? t('pwg.preview', { groups: groups.length, ungrouped: view.ungrouped.length })
        : t('pwg.previewNone');
    const openAttr = _propsSectionIsOpen('power-groups') ? 'open' : '';
    let html = `<details class="props-collapsible props-secondary pwg-section" ${escapeHTML(openAttr)} data-toggle="props-section" data-section="power-groups">
        <summary class="props-collapsible-head"><span><i class="fas fa-layer-group"></i> ${escapeHTML(t('pwg.title'))}</span><span class="props-collapsible-preview">${escapeHTML(preview)}</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
        <div class="props-collapsible-body"><div>
            <div class="pdu-connection-hint" data-tip="${escapeHTML(t('pwg.hintTip'))}" data-tip-wrap><i class="fas fa-circle-info"></i> ${escapeHTML(t('pwg.hint'))}</div>`;
    if(!groups.length) html += `<div class="pwg-empty" data-tip="${escapeHTML(t('pwg.emptyTip'))}" data-tip-wrap>${escapeHTML(t('pwg.empty'))}</div>`;
    html += '<div class="pwg-list">';
    for(const g of groups) html += _powerGroupRowHtml(n, g, g.outlets.length);
    html += '</div>';
    if(view.orphan.length) html += `<div class="pwg-orphan"><i class="fas fa-triangle-exclamation"></i> ${escapeHTML(t('pwg.orphan', { n: view.orphan.length }))}</div>`;
    const addDisabled = groups.length >= MAX_POWER_GROUPS ? 'disabled' : '';
    html += `<button class="pwg-add" type="button" ${escapeHTML(addDisabled)} data-act="power-group-add" data-nid="${escapeHTML(n.id)}"><i class="fas fa-plus"></i> ${escapeHTML(t('pwg.add'))}</button>`;
    // Il ritorno chiude con un template, non con una stringa: e' cosi' che lo
    // scanner dell'escaping riconosce un BUILDER e si fida del suo valore.
    return html + `</div></div></details>`;
}

function _pduPowerConnectionsHtml(n){
    const source = _pduOutletSource(n);
    const configured = n && n.pduOutletCount != null ? n.pduOutletCount : (source.length || 8);
    const count = normalizePduOutletCount(configured);
    const entries = Array.from({ length:count }, (_, index) => source[index] || { name:`P${index + 1}` });
    const connected = entries.reduce((total, outlet) => total + (pduOutletConnection(outlet).connected ? 1 : 0), 0);
    const _groupsForOutlets = powerGroups(n);   // il menu «gruppo» compare solo se un gruppo esiste
    const rows = entries.map((outlet, index) => {
        const connection = pduOutletConnection(outlet);
        const label = String(outlet.label || outlet.name || `P${index + 1}`);
        const status = pduOutletStatusState(outlet);
        const portClass = connection.manualPort ? 'ovr' : '';
        const sourceClass = connection.manual ? 'manual' : (connection.imported ? 'netbox' : 'empty');
        const sourceLabel = connection.manual ? t('pdu.manual') : (connection.imported ? t('pdu.netbox') : t('pdu.notSet'));
        const reset = connection.manual
            ? `<button class="pdu-connection-reset" type="button" data-act="pdu-connection-reset" data-nid="${escapeHTML(n.id)}" data-pindex="${index}" title="${escapeHTML(t('pdu.resetConnection'))}" aria-label="${escapeHTML(t('pdu.resetConnection'))}"><i class="fas fa-rotate-left"></i></button>`
            : '';
        return `<div class="pdu-connection-row">
            <div class="pdu-connection-head"><span class="pdu-connection-outlet"><i class="fas fa-plug"></i>${escapeHTML(label)}</span><span class="pdu-connection-status ${status}">${escapeHTML(_pduOutletStatusLabel(status))}</span><span class="pdu-connection-source ${sourceClass}">${escapeHTML(sourceLabel)}</span>${reset}</div>
            <div class="pdu-connection-fields">
                <label class="pdu-connection-field"><span>${escapeHTML(t('pdu.connectionDevice'))}</span>${pduConnectionDeviceSelect({ nodeId:n.id, index, connection })}</label>
                <label class="pdu-connection-field"><span>${escapeHTML(t('pdu.connectionPort'))}</span><input class="${portClass}" value="${escapeHTML(connection.portName)}" placeholder="${escapeHTML(t('pdu.notSet'))}" data-change="pdu-connection-field" data-nid="${escapeHTML(n.id)}" data-pindex="${index}" data-pfield="portName"></label>
                ${_pduOutletGroupFieldHtml(n, index, outlet, _groupsForOutlets)}
            </div>
        </div>`;
    }).join('');
    return `<details class="props-collapsible props-secondary pdu-connections-section" ${_propsSectionIsOpen('pdu-power-connections')?'open':''} data-toggle="props-section" data-section="pdu-power-connections">
        <summary class="props-collapsible-head"><span><i class="fas fa-bolt"></i> ${escapeHTML(t('pdu.connectionsTitle'))}</span><span class="props-collapsible-preview">${escapeHTML(t('pdu.connectionsPreview',{connected,total:count}))}</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
        <div class="props-collapsible-body"><div>
            <div class="pdu-connection-hint" data-tip="${escapeHTML(t('pdu.connectionsHintTip'))}" data-tip-wrap><i class="fas fa-circle-info"></i> ${escapeHTML(t('pdu.connectionsHint'))}</div>
            <div class="pdu-connection-list">${rows}</div>
        </div></div>
    </details>`;
}

// ============================================================
// PROPERTIES PANEL — catena device-specifica per-tipo (estratta da
// app-properties-node.js per spezzare il renderer monolitico).
// _nodeDeviceChainHtml(n, d) → { h, devSpec }
//   h       : contributo dei device FLOOR (layout inline, h+=)
//   devSpec : contributo dei device RACK/attivi (accordion device-spec,
//             _devSpecHtml+=), poi cucito nellassemblaggio rack del chiamante.
// ⚠️ Il blocco «Identità rilevata» NON passa piu' di qui: lo emette il chiamante
// in cima al pannello, una volta sola e per ogni tipo. Qui dentro lo stampava
// solo il ramo `ap`, quindi su tutti gli altri floor non si vedeva affatto.
// Sequenza piatta di blocchi indipendenti if(n.type===...): un solo blocco
// scatta per render. Usa solo n, d + helper globali
// (selected, t, escapeHTML, _build*Html, _powerLiveHtml, updateN, ...).
// Caricato in netmapper.html subito dopo app-properties-node.js.
// ============================================================
// VLAN access di un endpoint floor in SOLA LETTURA: è la VLAN EFFETTIVA della sua
// porta (_effPortVlan: propagata dallo switch a monte ?? override di porta ??
// nativa di sito), l'unica che il motore rispetta. Sostituisce i vecchi campi
// vlanPc/vlanIot/... scollegati dal modello. L'override si modifica sulla
// porta/switch a monte (i valori legacy sono migrati in _migrateState).
// Interfaccia che rappresenta la VLAN access del device: la prima COLLEGATA tra
// porte cablate e radio (preferenza alla cablata). Per un client SOLO-wireless è
// la radio (la sua VLAN effettiva = SSID propagato da monte), non la porta cablata
// inutilizzata. Per un device cablato resta la porta 1.
export function _deviceAccessVlanPid(n){
    const cand = [];
    const pc = (n.ports !== undefined) ? n.ports : ((TYPES[n.type] && TYPES[n.type].ports) || 1);
    for(let i=1;i<=pc;i++) cand.push(`${n.id}-${i}`);
    if(Array.isArray(n.radios) && typeof win.radioPid === 'function')
        n.radios.forEach((r, idx) => cand.push(win.radioPid(n.id, idx)));
    const linked = cand.filter(pid => (store.state.links||[]).some(l => l && (l.src===pid || l.dst===pid)));
    return linked[0] || cand[0] || `${n.id}-1`;
}

// VLAN access di un endpoint floor. EDITABILE quando nessuno a monte la detta:
// l'input scrive il `vlanOvr` della porta access del device (setEndpointVlan →
// l'unica VLAN che il motore rispetta). Se invece lo switch a monte propaga una
// VLAN su questo run passivo (pi.vlanProp presente), quella PREVALE (manual-first
// = la realtà vince): mostriamo il badge in sola lettura con il rimando a monte,
// così l'utente sa dove cambiarla. Sostituisce i vecchi campi vlanPc/vlanIot/…
// (migrati in _migrateState verso il vlanOvr di porta).
export function _floorAccessVlanRow(n, pid){
    pid = pid || _deviceAccessVlanPid(n);
    const pi  = (store.state.ports && store.state.ports[pid]) || {};
    const eff = (typeof _effPortVlan === 'function') ? _effPortVlan(pid) : 1;
    const name = (store.state.vlanNames && store.state.vlanNames[eff]) ? escapeHTML(store.state.vlanNames[eff]) : '';
    const col  = (store.state.vlanColors && store.state.vlanColors[eff]) || '#6e7681';
    // VLAN dettata da monte (propagata su run passivo) → sola lettura + rimando.
    if(pi.vlanProp != null){
        const hint = (typeof t === 'function') ? t('f.vlanDerived') : 'effettiva — assegnata a monte';
        return `<div style="display:flex;align-items:center;gap:7px;padding:5px 7px;background:var(--bg-color);border:1px solid var(--panel-border);border-radius:4px;font-size:var(--fs-lg)">
            <span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${col};flex-shrink:0;border:1px solid rgba(255,255,255,.18)"></span>
            <b>VLAN ${eff}</b>${name?`<span style="color:var(--text-muted)">— ${name}</span>`:''}
            <span style="font-size:.66rem;color:var(--text-muted);margin-left:auto;white-space:nowrap"><i class="fas fa-circle-info" style="margin-right:3px"></i>${hint}</span>
          </div>`;
    }
    // Editabile: scrive l'override di porta dell'endpoint, tenendo il nodo selezionato.
    const tip = (typeof t === 'function') ? t('f.vlanEndpointTip') : 'VLAN access del device (override di porta). Lo switch a monte, se presente, può prevalere.';
    const ovrCls = (pi.vlanOvr != null) ? 'ovr' : '';
    return `<div style="display:flex;align-items:center;gap:7px">
        <span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${col};flex-shrink:0;border:1px solid rgba(255,255,255,.18)"></span>
        <input type="number" min="1" max="4094" class="${ovrCls}" style="flex:1"
               value="${pi.vlanOvr != null ? pi.vlanOvr : ''}" placeholder="${eff}"
               data-tip="${tip}"
               data-change="endpoint-vlan" data-nid="${n.id}" data-pid="${pid}">
      </div>`;
}

export function _nodeDeviceChainHtml(n, d){
    let h = '';
    let _devSpecHtml = '';
    // Le fisarmoniche FLOOR mettono la device-specifica PRIMA di "Rete & Accesso"
    // (es. per un VoIP la 1a fisarmonica è "Voip phone", poi rete/SNMP). Ogni blocco
    // floor CATTURA qui l'HTML di _buildNetAccessHtml — l'espressione `(_floorNet=…, '')`
    // valuta a stringa vuota nel template, così la rete NON viene emessa inline — e il
    // chiamante (_renderNodeProps) lo ri-emette DOPO la fisarmonica device. Sui rack
    // resta '' (lì l'ordine è già gestito dall'assemblaggio in app-properties-node.js).
    let _floorNet = '';
            if(n.type==='ap'){
                h+=`<div class="prop-group"><label>${t('f.apId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="AP-01" data-change="floor-id"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false, macLabel:'MAC / BSSID'}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-ap')?'open':''} data-toggle="props-section" data-section="device-ap"><summary class="props-collapsible-head"><span><i class="fas fa-wifi"></i> ${t('dev.ap')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <!-- Config Wi-Fi (SSID/banda/canale/standard/sicurezza/VLAN) unificata
                         con il router: vive nella fisarmonica WIRELESS (interfacce radio
                         n.radios[]). I campi legacy a singola radio sono stati rimossi. -->
                    <h4 style="margin:0 0 8px;color:var(--text-main);border-bottom:1px solid var(--panel-border);padding-bottom:4px">${t('pnl.dev.mgmtPower')}</h4>
                    <div class="prop-group"><label>Controller</label><select data-change="update-n" data-nfield="apController" data-ncoerce="stropt">
                        <option value="" ${selected(n.apController||'','')}>${t('o.notDeclared')}</option>
                        <option value="standalone"  ${selected(n.apController,'standalone')}>Standalone</option>
                        <option value="unifi"       ${selected(n.apController,'unifi')}>UniFi Controller</option>
                        <option value="omada"       ${selected(n.apController,'omada')}>TP-Link Omada</option>
                        <option value="aruba"       ${selected(n.apController,'aruba')}>Aruba Central / Mobility</option>
                        <option value="cisco-wlc"   ${selected(n.apController,'cisco-wlc')}>Cisco WLC</option>
                        <option value="meraki"      ${selected(n.apController,'meraki')}>Cisco Meraki</option>
                        <option value="ruckus"      ${selected(n.apController,'ruckus')}>Ruckus SmartZone</option>
                        <option value="fortinet"    ${selected(n.apController,'fortinet')}>FortiAP / FortiLAN</option>
                        <option value="other"       ${selected(n.apController,'other')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.power')}</label><select data-change="update-n" data-nfield="powerType" data-ncoerce="stropt">
                        <option value="" ${selected(n.powerType||'','')}>${t('o.notDeclared')}</option>
                        <option value="poe"     ${selected(n.powerType,'poe')}>PoE (802.3af — 15.4W)</option>
                        <option value="poe+"    ${selected(n.powerType,'poe+')}>PoE+ (802.3at — 30W)</option>
                        <option value="poe++"   ${selected(n.powerType,'poe++')}>PoE++ (802.3bt — 60W)</option>
                        <option value="dc"      ${selected(n.powerType,'dc')}>${t('o.dcAdapter')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.vlanMgmt')}</label><input type="number" min="1" max="4094" value="${n.mgmtVlan ?? ''}" placeholder="1" data-change="update-n" data-nfield="mgmtVlan" data-ncoerce="intopt"></div>
                    <h4 style="margin:12px 0 8px;color:var(--text-main);border-bottom:1px solid var(--panel-border);padding-bottom:4px">${t('pnl.dev.installation')}</h4>
                    <div class="prop-group"><label>${t('f.mounting')}</label><select data-change="update-n" data-nfield="mountType" data-ncoerce="stropt">
                        <option value="" ${selected(n.mountType||'','')}>${t('o.notDeclared')}</option>
                        <option value="ceiling"  ${selected(n.mountType,'ceiling')}>${t('o.mountCeiling')}</option>
                        <option value="wall"     ${selected(n.mountType,'wall')}>${t('o.mountWall')}</option>
                        <option value="outdoor-pole"  ${selected(n.mountType,'outdoor-pole')}>${t('o.outdoorPole')}</option>
                        <option value="outdoor-wall"  ${selected(n.mountType,'outdoor-wall')}>${t('o.outdoorWall')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.installHeight')}</label><input type="number" min="0" max="30" step="0.1" value="${n.installHeight ?? ''}" placeholder="3.0" data-change="update-n" data-nfield="installHeight" data-ncoerce="floatopt"></div>
                    <div class="prop-group"><label>${t('f.estCoverage')}</label><input type="number" min="1" max="500" value="${n.coverageRadius ?? ''}" placeholder="15" data-change="update-n" data-nfield="coverageRadius" data-ncoerce="intopt"></div>
                </div></details>`;
            }
            if(n.type==='webcam'){
                h+=`<div class="prop-group"><label>${t('f.cameraId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="CAM-01" data-change="floor-id"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false, macLabel:'MAC'}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-webcam')?'open':''} data-toggle="props-section" data-section="device-webcam"><summary class="props-collapsible-head"><span><i class="fas fa-video"></i> ${t('dev.webcam')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('f.mounting')}</label><select data-change="update-n" data-nfield="mountType" data-ncoerce="stropt">
                        <option value="" ${selected(n.mountType||'','')}>${t('o.notDeclared')}</option>
                        <option value="ceiling" ${selected(n.mountType,'ceiling')}>${t('o.ceiling')}</option>
                        <option value="wall"    ${selected(n.mountType,'wall')}>${t('o.wall')}</option>
                        <option value="pole"    ${selected(n.mountType,'pole')}>${t('o.pole')}</option>
                        <option value="desk"    ${selected(n.mountType,'desk')}>${t('o.deskShelf')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.installHeight')}</label><input type="number" min="0" max="20" step="0.1" value="${n.installHeight ?? ''}" placeholder="2.8" data-change="update-n" data-nfield="installHeight" data-ncoerce="floatopt"></div>
                    <div class="prop-group"><label>${t('field.power')}</label><select data-change="update-n" data-nfield="powerType" data-ncoerce="stropt">
                        <option value="" ${selected(n.powerType||'','')}>${t('o.notDeclared')}</option>
                        <option value="poe"      ${selected(n.powerType,'poe')}>PoE</option>
                        <option value="poe-plus" ${selected(n.powerType,'poe-plus')}>PoE+</option>
                        <option value="dc"       ${selected(n.powerType,'dc')}>DC Adapter</option>
                        <option value="usb"      ${selected(n.powerType,'usb')}>USB</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.resolution')}</label><select data-change="update-n" data-nfield="resolution" data-ncoerce="stropt">
                        <option value="" ${selected(n.resolution||'','')}>${t('o.notDeclared')}</option>
                        <option value="1080p" ${selected(n.resolution,'1080p')}>1080p</option>
                        <option value="2k"    ${selected(n.resolution,'2k')}>2K</option>
                        <option value="4k"    ${selected(n.resolution,'4k')}>4K</option>
                        <option value="8mp"   ${selected(n.resolution,'8mp')}>8 MP</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.lensFov')}</label><input value="${escapeHTML(n.lens ?? '')}" placeholder="2.8mm / 110deg" data-change="update-n" data-nfield="lens" data-ncoerce="stropt"></div>
                    <div class="prop-group"><label>${t('f.coverageZone')}</label><input value="${escapeHTML(n.coverageZone||'')}" placeholder="${t('pnl.dev.phEntranceCorridor')}" data-change="update-n" data-nfield="coverageZone"></div>
                    <div class="prop-group"><label>NVR / VMS</label><input value="${escapeHTML(n.recorder||'')}" placeholder="NVR-01 / VMS" data-change="update-n" data-nfield="recorder"></div>
                    <div class="prop-group"><label>${t('f.installStatus')}</label><select data-change="update-n" data-nfield="installStatus" data-ncoerce="stropt">
                        <option value="" ${selected(n.installStatus||'','')}>${t('o.notDeclared')}</option>
                        <option value="planned"    ${selected(n.installStatus,'planned')}>${t('o.planned')}</option>
                        <option value="cabled"     ${selected(n.installStatus,'cabled')}>${t('o.wired')}</option>
                        <option value="mounted"    ${selected(n.installStatus,'mounted')}>${t('o.mounted')}</option>
                        <option value="configured" ${selected(n.installStatus,'configured')}>${t('o.configured')}</option>
                        <option value="tested"     ${selected(n.installStatus,'tested')}>${t('o.tested')}</option>
                    </select></div>
                    <div class="prop-group"><label><input type="checkbox" ${checked(n.irEnabled)}    data-change="update-n" data-nfield="irEnabled" data-ncoerce="bool"    style="width:auto;margin-right:6px"> IR / Night Vision</label></div>
                    <div class="prop-group"><label><input type="checkbox" ${checked(n.audioEnabled)} data-change="update-n" data-nfield="audioEnabled" data-ncoerce="bool" style="width:auto;margin-right:6px"> ${t('pnl.dev.audioEnabled')}</label></div>
                </div></details>`;
            }
            if(n.type==='wallport'){
                h+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-wallport')?'open':''} data-toggle="props-section" data-section="device-wallport"><summary class="props-collapsible-head"><span><i class="fas fa-ethernet"></i> ${t('dev.wallport')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('f.socketId')}</label><input value="${escapeHTML(getWallPortLabel(n))}" placeholder="WA-01" data-change="wallport-id"></div>
                </div></details>`;
            }
            if(n.type==='printer'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="PRN-01" data-change="floor-id"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-printer')?'open':''} data-toggle="props-section" data-section="device-printer"><summary class="props-collapsible-head"><span><i class="fas fa-print"></i> ${t('dev.printer')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('field.brand')}</label><input value="${escapeHTML(n.brand||'')}" placeholder="HP, Canon, Epson, Ricoh…" data-change="update-n" data-nfield="brand"></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="LaserJet Pro M404dn…" data-change="update-n" data-nfield="model"></div>
                    <h4 style="margin:12px 0 8px;color:var(--text-main);border-bottom:1px solid var(--panel-border);padding-bottom:4px">${t('pnl.dev.networkPrint')}</h4>
                    <div class="prop-group"><label>${t('field.connection')}</label><select data-change="update-n" data-nfield="connection" data-ncoerce="stropt">
                        <option value="" ${selected(n.connection||'','')}>${t('o.notDeclared')}</option>
                        <option value="wired"    ${selected(n.connection,'wired')}>${t('o.wiredEth')}</option>
                        <option value="wireless" ${selected(n.connection,'wireless')}>Wireless (Wi-Fi)</option>
                        <option value="both"     ${selected(n.connection,'both')}>${t('o.wiredWifi')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.printProto')}</label><select data-change="update-n" data-nfield="printProto" data-ncoerce="stropt">
                        <option value="" ${selected(n.printProto||'','')}>${t('o.notDeclared')}</option>
                        <option value="raw9100" ${selected(n.printProto,'raw9100')}>${t('pnl.dev.rawPort9100')}</option>
                        <option value="ipp"     ${selected(n.printProto,'ipp')}>IPP / IPPS</option>
                        <option value="smb"     ${selected(n.printProto,'smb')}>SMB / Windows Share</option>
                        <option value="lpd"     ${selected(n.printProto,'lpd')}>LPD / LPR</option>
                    </select></div>                    <div class="prop-group"><label><input type="checkbox" ${checked(n.colorPrint)} data-change="update-n" data-nfield="colorPrint" data-ncoerce="bool" style="width:auto;margin-right:6px"> ${t('pnl.dev.colorPrint')}</label></div>
                    <div class="prop-group"><label><input type="checkbox" ${checked(n.duplexPrint)} data-change="update-n" data-nfield="duplexPrint" data-ncoerce="bool" style="width:auto;margin-right:6px"> ${t('pnl.dev.duplexPrint')}</label></div>
                </div></details>`;
            }
            if(n.type==='voip'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="TEL-01" data-change="floor-id"></div>
                    <div class="prop-group"><label>${t('f.extNumber')}</label><input value="${escapeHTML(n.extension||'')}" placeholder="201" data-change="update-n" data-nfield="extension"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-voip')?'open':''} data-toggle="props-section" data-section="device-voip"><summary class="props-collapsible-head"><span><i class="fas fa-phone"></i> ${t('dev.voip')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('field.brand')}</label><select data-change="update-n" data-nfield="brand" data-ncoerce="stropt">
                        <option value=""            ${selected(n.brand||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="Cisco"       ${selected(n.brand,'Cisco')}>Cisco</option>
                        <option value="Yealink"     ${selected(n.brand,'Yealink')}>Yealink</option>
                        <option value="Snom"        ${selected(n.brand,'Snom')}>Snom</option>
                        <option value="Grandstream" ${selected(n.brand,'Grandstream')}>Grandstream</option>
                        <option value="Polycom"     ${selected(n.brand,'Polycom')}>Poly / Polycom</option>
                        <option value="Fanvil"      ${selected(n.brand,'Fanvil')}>Fanvil</option>
                        <option value="Avaya"       ${selected(n.brand,'Avaya')}>Avaya</option>
                        <option value="Altro"       ${selected(n.brand,'Altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="T46U, CP8841…" data-change="update-n" data-nfield="model"></div>
                    <h4 style="margin:12px 0 8px;color:var(--text-main);border-bottom:1px solid var(--panel-border);padding-bottom:4px">${t('pnl.dev.voipConfig')}</h4>
                    <div class="prop-group"><label>${t('f.protocol')}</label><select data-change="update-n" data-nfield="voipProto" data-ncoerce="stropt">
                        <option value="" ${selected(n.voipProto||'','')}>${t('o.notDeclared')}</option>
                        <option value="SIP"   ${selected(n.voipProto,'SIP')}>SIP</option>
                        <option value="SCCP"  ${selected(n.voipProto,'SCCP')}>SCCP (Cisco Skinny)</option>
                        <option value="H.323" ${selected(n.voipProto,'H.323')}>H.323</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.pbxHost')}</label><input value="${escapeHTML(n.pbxHost||'')}" placeholder="${t('pnl.dev.phPbxHost')}" data-change="update-n" data-nfield="pbxHost"></div>
                    <div class="prop-group"><label>${t('f.prefCodec')}</label><select data-change="update-n" data-nfield="audioCodec" data-ncoerce="stropt">
                        <option value="" ${selected(n.audioCodec||'','')}>${t('o.notDeclared')}</option>
                        <option value="G.711u" ${selected(n.audioCodec,'G.711u')}>G.711 µ-law (PCMU)</option>
                        <option value="G.711a" ${selected(n.audioCodec,'G.711a')}>G.711 a-law (PCMA)</option>
                        <option value="G.722"  ${selected(n.audioCodec,'G.722')}>G.722 (HD audio)</option>
                        <option value="G.729"  ${selected(n.audioCodec,'G.729')}>${t('pnl.dev.g729LowBw')}</option>
                        <option value="Opus"   ${selected(n.audioCodec,'Opus')}>Opus</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.power')}</label><select data-change="update-n" data-nfield="powerType" data-ncoerce="stropt">
                        <option value="" ${selected(n.powerType||'','')}>${t('o.notDeclared')}</option>
                        <option value="poe"  ${selected(n.powerType,'poe')}>PoE (802.3af — 15.4W)</option>
                        <option value="poe+" ${selected(n.powerType,'poe+')}>PoE+ (802.3at — 30W)</option>
                        <option value="dc"   ${selected(n.powerType,'dc')}>${t('o.dcAdapter')}</option>
                    </select></div>
                </div></details>`;
            }
            if(n.type==='badgereader'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="BADGE-01" data-change="floor-id"></div>
                    <div class="prop-group"><label>${t('f.zonePort')}</label><input value="${escapeHTML(n.zone||'')}" placeholder="${t('pnl.dev.phZoneExample')}" data-change="update-n" data-nfield="zone"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-badgereader')?'open':''} data-toggle="props-section" data-section="device-badgereader"><summary class="props-collapsible-head"><span><i class="fas fa-id-card"></i> ${t('dev.badgereader')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('field.brand')}</label><select data-change="update-n" data-nfield="brand" data-ncoerce="stropt">
                        <option value=""        ${selected(n.brand||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="HID"     ${selected(n.brand,'HID')}>HID Global</option>
                        <option value="Axis"    ${selected(n.brand,'Axis')}>Axis</option>
                        <option value="Lenel"   ${selected(n.brand,'Lenel')}>Lenel / Carrier</option>
                        <option value="Bosch"   ${selected(n.brand,'Bosch')}>Bosch</option>
                        <option value="IDEMIA"  ${selected(n.brand,'IDEMIA')}>IDEMIA (Morpho)</option>
                        <option value="Suprema" ${selected(n.brand,'Suprema')}>Suprema</option>
                        <option value="Altro"   ${selected(n.brand,'Altro')}>${t('o.other')}</option>
                    </select></div>
                    <h4 style="margin:12px 0 8px;color:var(--text-main);border-bottom:1px solid var(--panel-border);padding-bottom:4px">${t('pnl.dev.accessControlConfig')}</h4>
                    <div class="prop-group"><label>${t('f.readerType')}</label><select data-change="update-n" data-nfield="readerType" data-ncoerce="stropt">
                        <option value="" ${selected(n.readerType||'','')}>${t('o.notDeclared')}</option>
                        <option value="rfid-125"  ${selected(n.readerType,'rfid-125')}>RFID 125 kHz (EM/HID Prox)</option>
                        <option value="rfid-mifare"${selected(n.readerType,'rfid-mifare')}>RFID 13.56 MHz (MIFARE / iCLASS)</option>
                        <option value="bio-finger" ${selected(n.readerType,'bio-finger')}>${t('o.bioFinger')}</option>
                        <option value="bio-face"   ${selected(n.readerType,'bio-face')}>${t('o.bioFace')}</option>
                        <option value="pin-badge"  ${selected(n.readerType,'pin-badge')}>PIN + badge</option>
                        <option value="pin-only"   ${selected(n.readerType,'pin-only')}>${t('o.pinOnly')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.ifaceProto')}</label><select data-change="update-n" data-nfield="readerProto" data-ncoerce="stropt">
                        <option value="" ${selected(n.readerProto||'','')}>${t('o.notDeclared')}</option>
                        <option value="wiegand26" ${selected(n.readerProto,'wiegand26')}>Wiegand 26-bit</option>
                        <option value="wiegand34" ${selected(n.readerProto,'wiegand34')}>Wiegand 34-bit</option>
                        <option value="osdp"      ${selected(n.readerProto,'osdp')}>OSDP v2</option>
                        <option value="rs485"     ${selected(n.readerProto,'rs485')}>RS-485</option>
                        <option value="tcpip"     ${selected(n.readerProto,'tcpip')}>${t('pnl.dev.tcpipDirect')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.ctrlPanel')}</label><input value="${escapeHTML(n.accessController||'')}" placeholder="${t('pnl.dev.phCtrlIpHost')}" data-change="update-n" data-nfield="accessController" data-ncoerce="stropt"></div>                    <div class="prop-group"><label>${t('field.power')}</label><select data-change="update-n" data-nfield="powerType">
                        <option value="" ${selected(n.powerType||'','')}>${t('o.notDeclared')}</option>
                        <option value="poe"   ${selected(n.powerType,'poe')}>PoE (802.3af)</option>
                        <option value="dc12"  ${selected(n.powerType,'dc12')}>DC 12V</option>
                        <option value="dc24"  ${selected(n.powerType,'dc24')}>DC 24V</option>
                    </select></div>
                </div></details>`;
            }
            if(n.type==='pc'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="PC-MARIO, WS-01" data-change="floor-id"></div>
                    <div class="prop-group"><label>${t('f.assignedUser')}</label><input value="${escapeHTML(n.assignedUser||'')}" placeholder="Mario Rossi" data-change="update-n" data-nfield="assignedUser"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-pc')?'open':''} data-toggle="props-section" data-section="device-pc"><summary class="props-collapsible-head"><span><i class="fas fa-desktop"></i> ${t('dev.pc')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('field.brand')}</label><select data-change="update-n" data-nfield="brand" data-ncoerce="stropt">
                        <option value=""        ${selected(n.brand||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="Dell"    ${selected(n.brand,'Dell')}>Dell</option>
                        <option value="HP"      ${selected(n.brand,'HP')}>HP</option>
                        <option value="Lenovo"  ${selected(n.brand,'Lenovo')}>Lenovo</option>
                        <option value="Apple"   ${selected(n.brand,'Apple')}>Apple</option>
                        <option value="Acer"    ${selected(n.brand,'Acer')}>Acer</option>
                        <option value="Asus"    ${selected(n.brand,'Asus')}>Asus</option>
                        <option value="Custom"  ${selected(n.brand,'Custom')}>${t('o.assembled')}</option>
                        <option value="Altro"   ${selected(n.brand,'Altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="OptiPlex 7090, ThinkCentre…" data-change="update-n" data-nfield="model"></div>
                    <div class="prop-group"><label>${t('f.os')}</label><select data-change="update-n" data-nfield="osType" data-ncoerce="stropt">
                        <option value=""        ${selected(n.osType||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="win11"   ${selected(n.osType,'win11')}>Windows 11</option>
                        <option value="win10"   ${selected(n.osType,'win10')}>Windows 10</option>
                        <option value="win-srv" ${selected(n.osType,'win-srv')}>Windows Server</option>
                        <option value="ubuntu"  ${selected(n.osType,'ubuntu')}>Ubuntu</option>
                        <option value="debian"  ${selected(n.osType,'debian')}>Debian</option>
                        <option value="fedora"  ${selected(n.osType,'fedora')}>Fedora</option>
                        <option value="rhel"    ${selected(n.osType,'rhel')}>RHEL / CentOS</option>
                        <option value="suse"    ${selected(n.osType,'suse')}>openSUSE</option>
                        <option value="linux"   ${selected(n.osType,'linux')}>Linux (altro)</option>
                        <option value="macos"   ${selected(n.osType,'macos')}>macOS</option>
                        <option value="altro"   ${selected(n.osType,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.connection')}</label><select data-change="update-n" data-nfield="connection" data-ncoerce="stropt">
                        <option value="" ${selected(n.connection||'','')}>${t('o.notDeclared')}</option>
                        <option value="wired"    ${selected(n.connection,'wired')}>${t('o.wiredEth')}</option>
                        <option value="wireless" ${selected(n.connection,'wireless')}>Wireless (Wi-Fi)</option>
                        <option value="both"     ${selected(n.connection,'both')}>${t('o.wiredWifi')}</option>
                    </select></div>                </div></details>`;
            }
            if(n.type==='mobile'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="PHONE-MARIO, IPAD-01" data-change="floor-id"></div>
                    <div class="prop-group"><label>${t('f.assignedUser')}</label><input value="${escapeHTML(n.assignedUser||'')}" placeholder="Mario Rossi" data-change="update-n" data-nfield="assignedUser"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false, ipPlaceholder:'192.168... (se IP)'}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-mobile')?'open':''} data-toggle="props-section" data-section="device-mobile"><summary class="props-collapsible-head"><span><i class="fas ${escapeHTML(d.icon)}"></i> ${t('dev.mobile')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('f.formFactor')}</label><select data-change="update-n" data-nfield="formFactor" data-ncoerce="stropt">
                        <option value="" ${selected(n.formFactor||'','')}>${t('o.notDeclared')}</option>
                        <option value="smartphone" ${selected(n.formFactor,'smartphone')}>Smartphone</option>
                        <option value="tablet"     ${selected(n.formFactor,'tablet')}>Tablet</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.brand')}</label><select data-change="update-n" data-nfield="brand" data-ncoerce="stropt">
                        <option value=""          ${selected(n.brand||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="Apple"     ${selected(n.brand,'Apple')}>Apple</option>
                        <option value="Samsung"   ${selected(n.brand,'Samsung')}>Samsung</option>
                        <option value="Google"    ${selected(n.brand,'Google')}>Google</option>
                        <option value="Xiaomi"    ${selected(n.brand,'Xiaomi')}>Xiaomi</option>
                        <option value="Huawei"    ${selected(n.brand,'Huawei')}>Huawei</option>
                        <option value="Lenovo"    ${selected(n.brand,'Lenovo')}>Lenovo</option>
                        <option value="Microsoft" ${selected(n.brand,'Microsoft')}>Microsoft</option>
                        <option value="Altro"     ${selected(n.brand,'Altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="iPhone 15, iPad Air, Galaxy…" data-change="update-n" data-nfield="model"></div>
                    <div class="prop-group"><label>${t('f.os')}</label><select data-change="update-n" data-nfield="osType" data-ncoerce="stropt">
                        <option value=""        ${selected(n.osType||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="ios"     ${selected(n.osType,'ios')}>iOS</option>
                        <option value="ipados"  ${selected(n.osType,'ipados')}>iPadOS</option>
                        <option value="android" ${selected(n.osType,'android')}>Android</option>
                        <option value="windows" ${selected(n.osType,'windows')}>Windows</option>
                        <option value="altro"   ${selected(n.osType,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.ownership')}</label><select data-change="update-n" data-nfield="ownership" data-ncoerce="stropt">
                        <option value="" ${selected(n.ownership||'','')}>${t('o.notDeclared')}</option>
                        <option value="corporate" ${selected(n.ownership,'corporate')}>${t('o.corporate')}</option>
                        <option value="byod"      ${selected(n.ownership,'byod')}>${t('o.byod')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.mdm')}</label><select data-change="update-n" data-nfield="mdm" data-ncoerce="stropt">
                        <option value="" ${selected(n.mdm||'','')}>${t('o.notDeclared')}</option>
                        <option value="none"         ${selected(n.mdm,'none')}>${t('o.mdmNone')}</option>
                        <option value="intune"       ${selected(n.mdm,'intune')}>Microsoft Intune</option>
                        <option value="jamf"         ${selected(n.mdm,'jamf')}>Jamf</option>
                        <option value="workspaceone" ${selected(n.mdm,'workspaceone')}>Workspace ONE</option>
                        <option value="google"       ${selected(n.mdm,'google')}>Google Endpoint</option>
                        <option value="altro"        ${selected(n.mdm,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.connection')}</label><select data-change="update-n" data-nfield="connection" data-ncoerce="stropt">
                        <option value="" ${selected(n.connection||'','')}>${t('o.notDeclared')}</option>
                        <option value="wireless" ${selected(n.connection,'wireless')}>Wireless (Wi-Fi)</option>
                        <option value="cellular" ${selected(n.connection,'cellular')}>${t('o.cellular')}</option>
                        <option value="both"     ${selected(n.connection,'both')}>${t('o.wifiCellular')}</option>
                    </select></div>
                </div></details>`;
            }
            if(n.type==='nasdesktop'){
                const protos = Array.isArray(n.nasProtocols) ? n.nasProtocols : [];
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="NAS-01, DS920+" data-change="floor-id"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-nasdesktop')?'open':''} data-toggle="props-section" data-section="device-nasdesktop"><summary class="props-collapsible-head"><span><i class="fas fa-hard-drive"></i> ${t('dev.nasdesktop')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.swPlatform')}</label><select data-change="update-n" data-nfield="nasPlatform" data-ncoerce="stropt">
                        <option value=""        ${selected(n.nasPlatform||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="dsm"     ${selected(n.nasPlatform,'dsm')}>DSM (Synology)</option>
                        <option value="qts"     ${selected(n.nasPlatform,'qts')}>QTS (QNAP)</option>
                        <option value="truenas" ${selected(n.nasPlatform,'truenas')}>TrueNAS Core/Scale</option>
                        <option value="unraid"  ${selected(n.nasPlatform,'unraid')}>Unraid</option>
                        <option value="altro"   ${selected(n.nasPlatform,'altro')}>${t('o.otherProprietary')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.usableCap')}</label>
                        <input type="number" min="0.1" max="100000" step="0.1" value="${n.nasCapacityTb ?? ''}" placeholder="4" data-change="update-n" data-nfield="nasCapacityTb" data-ncoerce="floatopt"></div>
                    <div class="prop-group"><label>RAID</label><select data-change="update-n" data-nfield="nasRaid" data-ncoerce="stropt">
                        <option value="" ${selected(n.nasRaid||'','')}>${t('o.notDeclared')}</option>
                        <option value="shr"    ${selected(n.nasRaid,'shr')}>SHR (Synology Hybrid)</option>
                        <option value="raid1"  ${selected(n.nasRaid,'raid1')}>RAID 1 (mirror)</option>
                        <option value="raid5"  ${selected(n.nasRaid,'raid5')}>RAID 5</option>
                        <option value="raid6"  ${selected(n.nasRaid,'raid6')}>RAID 6</option>
                        <option value="raid10" ${selected(n.nasRaid,'raid10')}>RAID 10</option>
                        <option value="jbod"   ${selected(n.nasRaid,'jbod')}>${t('o.jbod')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.exposedProtocols')}</label>
                        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:2px">
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('smb'))}   data-change="toggle-array" data-taid="${n.id}" data-tafield="nasProtocols" data-taval="smb"   style="width:auto;margin-right:6px">SMB</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('nfs'))}   data-change="toggle-array" data-taid="${n.id}" data-tafield="nasProtocols" data-taval="nfs"   style="width:auto;margin-right:6px">NFS</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('iscsi'))} data-change="toggle-array" data-taid="${n.id}" data-tafield="nasProtocols" data-taval="iscsi" style="width:auto;margin-right:6px">iSCSI</label>
                        </div>
                    </div>
                    ${_vmSectionHtml(n)}
                </div></details>`;
            }
            if(n.type==='iot'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="IOT-01, SENSOR-TEMP-A" data-change="floor-id"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false, ipPlaceholder:'192.168... (se IP)'}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-iot')?'open':''} data-toggle="props-section" data-section="device-iot"><summary class="props-collapsible-head"><span><i class="fas fa-microchip"></i> ${t('dev.iot')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('f.deviceType')}</label><select data-change="update-n" data-nfield="iotType" data-ncoerce="stropt">
                        <option value="" ${selected(n.iotType||'','')}>${t('o.notDeclared')}</option>
                        <option value="temp"      ${selected(n.iotType,'temp')}>${t('o.iotTemp')}</option>
                        <option value="temp-hum"  ${selected(n.iotType,'temp-hum')}>${t('o.iotTempHum')}</option>
                        <option value="motion"    ${selected(n.iotType,'motion')}>${t('o.iotMotion')}</option>
                        <option value="smoke"     ${selected(n.iotType,'smoke')}>${t('o.iotSmoke')}</option>
                        <option value="smartplug" ${selected(n.iotType,'smartplug')}>${t('o.iotSmartplug')}</option>
                        <option value="gateway"   ${selected(n.iotType,'gateway')}>${t('o.iotGateway')}</option>
                        <option value="ups-mon"   ${selected(n.iotType,'ups-mon')}>${t('o.iotUpsMon')}</option>
                        <option value="altro"     ${selected(n.iotType,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.protocol')}</label><select data-change="update-n" data-nfield="iotProto" data-ncoerce="stropt">
                        <option value="" ${selected(n.iotProto||'','')}>${t('o.notDeclared')}</option>
                        <option value="mqtt"    ${selected(n.iotProto,'mqtt')}>MQTT</option>
                        <option value="http"    ${selected(n.iotProto,'http')}>HTTP / REST</option>
                        <option value="zigbee"  ${selected(n.iotProto,'zigbee')}>Zigbee</option>
                        <option value="zwave"   ${selected(n.iotProto,'zwave')}>Z-Wave</option>
                        <option value="modbus"  ${selected(n.iotProto,'modbus')}>Modbus TCP/RTU</option>
                        <option value="bacnet"  ${selected(n.iotProto,'bacnet')}>BACnet</option>
                        <option value="snmp"    ${selected(n.iotProto,'snmp')}>SNMP</option>
                        <option value="altro"   ${selected(n.iotProto,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.brokerGw')}</label><input value="${escapeHTML(n.iotBroker||'')}" placeholder="${t('pnl.dev.phMqttHost')}" data-change="update-n" data-nfield="iotBroker" data-ncoerce="stropt"></div>                    <div class="prop-group"><label>${t('field.power')}</label><select data-change="update-n" data-nfield="powerType">
                        <option value="" ${selected(n.powerType||'','')}>${t('o.notDeclared')}</option>
                        <option value="poe"      ${selected(n.powerType,'poe')}>PoE</option>
                        <option value="dc"       ${selected(n.powerType,'dc')}>${t('o.dcAdapter')}</option>
                        <option value="battery"  ${selected(n.powerType,'battery')}>${t('o.battery')}</option>
                        <option value="usb"      ${selected(n.powerType,'usb')}>USB</option>
                    </select></div>
                </div></details>`;
            }
            if(n.type==='projector'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="${t('pnl.dev.phProjName')}" data-change="floor-id"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-projector')?'open':''} data-toggle="props-section" data-section="device-projector"><summary class="props-collapsible-head"><span><i class="fas fa-chalkboard"></i> ${t('dev.projector')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('field.brand')}</label><select data-change="update-n" data-nfield="brand" data-ncoerce="stropt">
                        <option value=""         ${selected(n.brand||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="Epson"    ${selected(n.brand,'Epson')}>Epson</option>
                        <option value="BenQ"     ${selected(n.brand,'BenQ')}>BenQ</option>
                        <option value="Sony"     ${selected(n.brand,'Sony')}>Sony</option>
                        <option value="Panasonic"${selected(n.brand,'Panasonic')}>Panasonic</option>
                        <option value="NEC"      ${selected(n.brand,'NEC')}>NEC / Sharp</option>
                        <option value="Optoma"   ${selected(n.brand,'Optoma')}>Optoma</option>
                        <option value="Barco"    ${selected(n.brand,'Barco')}>Barco</option>
                        <option value="Altro"    ${selected(n.brand,'Altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="EB-2250U, VPL-FHZ85…" data-change="update-n" data-nfield="model"></div>
                    <div class="prop-group"><label>${t('f.resolution')}</label><select data-change="update-n" data-nfield="resolution" data-ncoerce="stropt">
                        <option value="" ${selected(n.resolution||'','')}>${t('o.notDeclared')}</option>
                        <option value="1080p" ${selected(n.resolution,'1080p')}>Full HD 1080p</option>
                        <option value="4k"    ${selected(n.resolution,'4k')}>4K UHD</option>
                        <option value="wxga"  ${selected(n.resolution,'wxga')}>WXGA (1280×800)</option>
                        <option value="xga"   ${selected(n.resolution,'xga')}>XGA (1024×768)</option>
                        <option value="wuxga" ${selected(n.resolution,'wuxga')}>WUXGA (1920×1200)</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.brightness')}</label><input type="number" min="500" max="50000" step="500" value="${n.lumens ?? ''}" placeholder="3000" data-change="update-n" data-nfield="lumens" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.netConn')}</label><select data-change="update-n" data-nfield="connection" data-ncoerce="stropt">
                        <option value="" ${selected(n.connection||'','')}>${t('o.notDeclared')}</option>
                        <option value="wired"    ${selected(n.connection,'wired')}>${t('o.wiredEth')}</option>
                        <option value="wireless" ${selected(n.connection,'wireless')}>Wireless (Wi-Fi)</option>
                        <option value="none"     ${selected(n.connection,'none')}>${t('o.noneHdmi')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.remoteProto')}</label><select data-change="update-n" data-nfield="projCtrl" data-ncoerce="stropt">
                        <option value="" ${selected(n.projCtrl||'','')}>${t('o.notDeclared')}</option>
                        <option value="pjlink"   ${selected(n.projCtrl,'pjlink')}>PJLink (TCP 4352)</option>
                        <option value="crestron" ${selected(n.projCtrl,'crestron')}>Crestron</option>
                        <option value="amx"      ${selected(n.projCtrl,'amx')}>AMX</option>
                        <option value="http"     ${selected(n.projCtrl,'http')}>${t('pnl.dev.httpRestProprietary')}</option>
                        <option value="rs232"    ${selected(n.projCtrl,'rs232')}>${t('o.rs232serial')}</option>
                        <option value="none"     ${selected(n.projCtrl,'none')}>${t('o.none')}</option>
                    </select></div>                </div></details>`;
            }
            if(n.type==='pbx'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-pbx')?'open':''} data-toggle="props-section" data-section="device-pbx"><summary class="props-collapsible-head"><span><i class="fas fa-phone-volume"></i> ${t('dev.pbx')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.trunkProto')}</label><select data-change="update-n" data-nfield="pbxTrunk" data-ncoerce="stropt">
                        <option value="" ${selected(n.pbxTrunk||'','')}>${t('o.notDeclared')}</option>
                        <option value="sip"       ${selected(n.pbxTrunk,'sip')}>SIP Trunk</option>
                        <option value="isdn-pri"  ${selected(n.pbxTrunk,'isdn-pri')}>ISDN PRI (E1/T1)</option>
                        <option value="isdn-bri"  ${selected(n.pbxTrunk,'isdn-bri')}>ISDN BRI</option>
                        <option value="fxo"       ${selected(n.pbxTrunk,'fxo')}>${t('o.analogFxo')}</option>
                        <option value="gsm"       ${selected(n.pbxTrunk,'gsm')}>Gateway GSM</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.pstnGw')}</label>
                        <input value="${escapeHTML(n.pstnGateway||'')}" placeholder="${t('pnl.dev.phPstnGw')}" data-change="update-n" data-nfield="pstnGateway"></div>
                    <div class="prop-group"><label>${t('f.maxExtensions')}</label>
                        <input type="number" min="1" max="10000" value="${n.pbxExtensions ?? ''}" placeholder="50" data-change="update-n" data-nfield="pbxExtensions" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.externalLines')}</label>
                        <input type="number" min="1" max="1000" value="${n.pbxTrunkLines ?? ''}" placeholder="8" data-change="update-n" data-nfield="pbxTrunkLines" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.software')}</label><select data-change="update-n" data-nfield="pbxSoftware" data-ncoerce="stropt">
                        <option value=""           ${selected(n.pbxSoftware||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="3cx"        ${selected(n.pbxSoftware,'3cx')}>3CX</option>
                        <option value="asterisk"   ${selected(n.pbxSoftware,'asterisk')}>Asterisk / FreePBX</option>
                        <option value="sangoma"    ${selected(n.pbxSoftware,'sangoma')}>Sangoma</option>
                        <option value="audiocodes" ${selected(n.pbxSoftware,'audiocodes')}>AudioCodes</option>
                        <option value="cisco-cucm" ${selected(n.pbxSoftware,'cisco-cucm')}>Cisco CUCM</option>
                        <option value="avaya"      ${selected(n.pbxSoftware,'avaya')}>Avaya</option>
                        <option value="altro"      ${selected(n.pbxSoftware,'altro')}>${t('o.other')}</option>
                    </select></div>
                </div></details>`;
            }
            if(n.type==='consolesvr'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-consolesvr')?'open':''} data-toggle="props-section" data-section="device-consolesvr"><summary class="props-collapsible-head"><span><i class="fas fa-terminal"></i> ${t('dev.consolesvr')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.oobIp')}</label>
                        <input value="${escapeHTML(n.oobIp||'')}" placeholder="${t('pnl.dev.phOobIp')}" data-change="update-n" data-nfield="oobIp"></div>
                    <div class="prop-group"><label>${t('f.serialPorts')}</label>
                        <input type="number" min="1" max="96" value="${n.serialPorts ?? ''}" placeholder="8" data-change="update-n" data-nfield="serialPorts" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.serialBaud')}</label><select data-change="update-n" data-nfield="serialBaud" data-ncoerce="stropt">
                        <option value="" ${selected(n.serialBaud||'','')}>${t('o.notDeclared')}</option>
                        <option value="9600"   ${selected(n.serialBaud,'9600')}>9600</option>
                        <option value="19200"  ${selected(n.serialBaud,'19200')}>19200</option>
                        <option value="38400"  ${selected(n.serialBaud,'38400')}>38400</option>
                        <option value="57600"  ${selected(n.serialBaud,'57600')}>57600</option>
                        <option value="115200" ${selected(n.serialBaud,'115200')}>115200</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.accessProtocols')}</label>
                        <div style="display:flex;flex-direction:column;gap:4px;margin-top:2px">
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(n.accessSsh!==false)}  data-change="update-n" data-nfield="accessSsh" data-ncoerce="bool"   style="width:auto;margin-right:6px">SSH</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(n.accessHttps)}        data-change="update-n" data-nfield="accessHttps" data-ncoerce="bool" style="width:auto;margin-right:6px">HTTPS Web UI</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(n.accessTelnet)}       data-change="update-n" data-nfield="accessTelnet" data-ncoerce="bool" style="width:auto;margin-right:6px">${t('pnl.dev.telnetDeprecated')}</label>
                        </div>
                    </div>
                </div></details>`;
            }
            if(n.type==='wlanctrl'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-wlanctrl')?'open':''} data-toggle="props-section" data-section="device-wlanctrl"><summary class="props-collapsible-head"><span><i class="fas fa-wifi"></i> ${t('dev.wlanctrl')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.apManagedCur')}</label>
                        <input type="number" min="0" max="10000" value="${n.apManaged||0}" data-change="update-n" data-nfield="apManaged" data-ncoerce="intdef" data-ndef="0"></div>
                    <div class="prop-group"><label>${t('f.maxApCap')}</label>
                        <input type="number" min="1" max="10000" value="${n.apCapacity ?? ''}" placeholder="50" data-change="update-n" data-nfield="apCapacity" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.licenses')}</label>
                        <input value="${escapeHTML(n.wlcLicenses||'')}" placeholder="${t('pnl.dev.phWlcLicenses')}" data-change="update-n" data-nfield="wlcLicenses"></div>
                    <div class="prop-group"><label>${t('f.platform')}</label><select data-change="update-n" data-nfield="wlcPlatform" data-ncoerce="stropt">
                        <option value=""           ${selected(n.wlcPlatform||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="cisco-wlc"  ${selected(n.wlcPlatform,'cisco-wlc')}>Cisco WLC / DNA Center</option>
                        <option value="aruba"      ${selected(n.wlcPlatform,'aruba')}>Aruba Mobility Controller</option>
                        <option value="unifi"      ${selected(n.wlcPlatform,'unifi')}>Ubiquiti UniFi</option>
                        <option value="ruckus"     ${selected(n.wlcPlatform,'ruckus')}>Ruckus SmartZone</option>
                        <option value="fortinet"   ${selected(n.wlcPlatform,'fortinet')}>Fortinet FortiAP</option>
                        <option value="omada"      ${selected(n.wlcPlatform,'omada')}>TP-Link Omada</option>
                        <option value="altro"      ${selected(n.wlcPlatform,'altro')}>${t('o.other')}</option>
                    </select></div>
                </div></details>`;
            }
            if(n.type==='mediaconv'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-mediaconv')?'open':''} data-toggle="props-section" data-section="device-mediaconv"><summary class="props-collapsible-head"><span><i class="fas fa-right-left"></i> ${t('dev.mediaconv')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.fiberType')}</label><select data-change="update-n" data-nfield="fiberType" data-ncoerce="stropt">
                        <option value="" ${selected(n.fiberType||'','')}>${t('o.notDeclared')}</option>
                        <option value="sm"  ${selected(n.fiberType,'sm')}>Single-mode (SM)</option>
                        <option value="mm"  ${selected(n.fiberType,'mm')}>Multi-mode (MM)</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.fiberConn')}</label><select data-change="update-n" data-nfield="fiberConnector" data-ncoerce="stropt">
                        <option value="" ${selected(n.fiberConnector||'','')}>${t('o.notDeclared')}</option>
                        <option value="lc"  ${selected(n.fiberConnector,'lc')}>LC</option>
                        <option value="sc"  ${selected(n.fiberConnector,'sc')}>SC</option>
                        <option value="st"  ${selected(n.fiberConnector,'st')}>ST</option>
                        <option value="fc"  ${selected(n.fiberConnector,'fc')}>FC</option>
                        <option value="mpo" ${selected(n.fiberConnector,'mpo')}>MPO / MTP</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.speed')}</label><select data-change="update-n" data-nfield="linkSpeed" data-ncoerce="stropt">
                        <option value="" ${selected(n.linkSpeed||'','')}>${t('o.notDeclared')}</option>
                        <option value="100m"  ${selected(n.linkSpeed,'100m')}>100 Mbps</option>
                        <option value="1g"    ${selected(n.linkSpeed,'1g')}>1 Gbps</option>
                        <option value="10g"   ${selected(n.linkSpeed,'10g')}>10 Gbps</option>
                        <option value="25g"   ${selected(n.linkSpeed,'25g')}>25 Gbps</option>
                        <option value="100g"  ${selected(n.linkSpeed,'100g')}>100 Gbps</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.wavelength')}</label><select data-change="update-n" data-nfield="wavelength" data-ncoerce="stropt">
                        <option value="" ${selected(n.wavelength||'','')}>${t('o.notDeclared')}</option>
                        <option value="850"  ${selected(n.wavelength,'850')}>850 nm (MM)</option>
                        <option value="1310" ${selected(n.wavelength,'1310')}>1310 nm (SM/MM)</option>
                        <option value="1550" ${selected(n.wavelength,'1550')}>${t('pnl.dev.wl1550')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.maxDistance')}</label>
                        <input type="number" min="0.1" max="200" step="0.1" value="${n.fiberMaxKm ?? ''}" placeholder="10" data-change="update-n" data-nfield="fiberMaxKm" data-ncoerce="floatopt"></div>
                </div></details>`;
            }
            if(n.type==='nvr'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-nvr')?'open':''} data-toggle="props-section" data-section="device-nvr"><summary class="props-collapsible-head"><span><i class="fas fa-record-vinyl"></i> ${t('devh.nvr')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.platform')}</label><select data-change="update-n" data-nfield="nvrPlatform" data-ncoerce="stropt">
                        <option value=""          ${selected(n.nvrPlatform||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="hikvision" ${selected(n.nvrPlatform,'hikvision')}>Hikvision</option>
                        <option value="dahua"     ${selected(n.nvrPlatform,'dahua')}>Dahua</option>
                        <option value="axis"      ${selected(n.nvrPlatform,'axis')}>Axis Camera Station</option>
                        <option value="milestone" ${selected(n.nvrPlatform,'milestone')}>Milestone XProtect</option>
                        <option value="synology"  ${selected(n.nvrPlatform,'synology')}>Synology Surveillance Station</option>
                        <option value="ubiquiti"  ${selected(n.nvrPlatform,'ubiquiti')}>Ubiquiti UniFi Protect</option>
                        <option value="genetec"   ${selected(n.nvrPlatform,'genetec')}>Genetec</option>
                        <option value="altro"     ${selected(n.nvrPlatform,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.totalChannels')}</label>
                        <input type="number" min="1" max="512" value="${n.nvrChannels ?? ''}" placeholder="16" data-change="update-n" data-nfield="nvrChannels" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.usedChannels')}</label>
                        <input type="number" min="0" max="512" value="${n.nvrChannelsUsed||0}" data-change="update-n" data-nfield="nvrChannelsUsed" data-ncoerce="intdef" data-ndef="0"></div>
                    <div class="prop-group"><label>${t('f.storageCap')}</label>
                        <input type="number" min="0.5" max="500" step="0.5" value="${n.nvrStorageTb ?? ''}" placeholder="8" data-change="update-n" data-nfield="nvrStorageTb" data-ncoerce="floatopt"></div>
                    <div class="prop-group"><label>${t('f.retention')}</label>
                        <input type="number" min="1" max="3650" value="${n.nvrRetentionDays ?? ''}" placeholder="30" data-change="update-n" data-nfield="nvrRetentionDays" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>Codec</label><select data-change="update-n" data-nfield="nvrCodec" data-ncoerce="stropt">
                        <option value="" ${selected(n.nvrCodec||'','')}>${t('o.notDeclared')}</option>
                        <option value="h265plus" ${selected(n.nvrCodec,'h265plus')}>H.265+ / Smart</option>
                        <option value="h265"     ${selected(n.nvrCodec,'h265')}>H.265 (HEVC)</option>
                        <option value="h264plus" ${selected(n.nvrCodec,'h264plus')}>H.264+</option>
                        <option value="h264"     ${selected(n.nvrCodec,'h264')}>H.264 (AVC)</option>
                    </select></div>                </div></details>`;
            }
            if(n.type==='sdwan'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-sdwan')?'open':''} data-toggle="props-section" data-section="device-sdwan"><summary class="props-collapsible-head"><span><i class="fas fa-cloud-bolt"></i> ${t('dev.sdwan')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.platform')}</label><select data-change="update-n" data-nfield="sdwanPlatform" data-ncoerce="stropt">
                        <option value=""           ${selected(n.sdwanPlatform||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="meraki"     ${selected(n.sdwanPlatform,'meraki')}>Cisco Meraki MX</option>
                        <option value="velocloud"  ${selected(n.sdwanPlatform,'velocloud')}>VMware VeloCloud</option>
                        <option value="versa"      ${selected(n.sdwanPlatform,'versa')}>Versa Networks</option>
                        <option value="fortinet"   ${selected(n.sdwanPlatform,'fortinet')}>Fortinet Secure SD-WAN</option>
                        <option value="aruba-ec"   ${selected(n.sdwanPlatform,'aruba-ec')}>Aruba EdgeConnect (Silver Peak)</option>
                        <option value="paloalto"   ${selected(n.sdwanPlatform,'paloalto')}>Palo Alto Prisma SD-WAN</option>
                        <option value="catonet"    ${selected(n.sdwanPlatform,'catonet')}>Cato Networks</option>
                        <option value="peplink"    ${selected(n.sdwanPlatform,'peplink')}>Peplink</option>
                        <option value="altro"      ${selected(n.sdwanPlatform,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.wanUplinks')}</label>
                        <input type="number" min="1" max="8" value="${n.sdwanUplinks ?? ''}" placeholder="2" data-change="update-n" data-nfield="sdwanUplinks" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.maxThroughput')}</label>
                        <input type="number" min="10" max="100000" value="${n.sdwanThroughputMbps ?? ''}" placeholder="500" data-change="update-n" data-nfield="sdwanThroughputMbps" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.mode')}</label><select data-change="update-n" data-nfield="sdwanMode" data-ncoerce="stropt">
                        <option value="" ${selected(n.sdwanMode||'','')}>${t('o.notDeclared')}</option>
                        <option value="active-active"   ${selected(n.sdwanMode,'active-active')}>Active / Active</option>
                        <option value="active-standby"  ${selected(n.sdwanMode,'active-standby')}>Active / Standby</option>
                        <option value="single"          ${selected(n.sdwanMode,'single')}>${t('o.singleUplink')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.cloudCtrl')}</label>
                        <input value="${escapeHTML(n.sdwanController||'')}" placeholder="${t('pnl.dev.phSdwanCtrl')}" data-change="update-n" data-nfield="sdwanController"></div>
                </div></details>`;
            }
            if(n.type==='vpncon'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-vpncon')?'open':''} data-toggle="props-section" data-section="device-vpncon"><summary class="props-collapsible-head"><span><i class="fas fa-key"></i> ${t('dev.vpncon')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.platform')}</label><select data-change="update-n" data-nfield="vpnPlatform" data-ncoerce="stropt">
                        <option value=""               ${selected(n.vpnPlatform||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="cisco-asa"      ${selected(n.vpnPlatform,'cisco-asa')}>Cisco ASA / Firepower</option>
                        <option value="cisco-anyconn"  ${selected(n.vpnPlatform,'cisco-anyconn')}>Cisco AnyConnect</option>
                        <option value="fortigate"      ${selected(n.vpnPlatform,'fortigate')}>FortiGate SSL/IPsec</option>
                        <option value="paloalto-gp"    ${selected(n.vpnPlatform,'paloalto-gp')}>Palo Alto GlobalProtect</option>
                        <option value="pulse"          ${selected(n.vpnPlatform,'pulse')}>Pulse Connect / Ivanti</option>
                        <option value="openvpn-as"     ${selected(n.vpnPlatform,'openvpn-as')}>OpenVPN Access Server</option>
                        <option value="wireguard"      ${selected(n.vpnPlatform,'wireguard')}>WireGuard</option>
                        <option value="strongswan"     ${selected(n.vpnPlatform,'strongswan')}>strongSwan</option>
                        <option value="altro"          ${selected(n.vpnPlatform,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.mode')}</label><select data-change="update-n" data-nfield="vpnMode" data-ncoerce="stropt">
                        <option value="" ${selected(n.vpnMode||'','')}>${t('o.notDeclared')}</option>
                        <option value="both"           ${selected(n.vpnMode,'both')}>Site-to-site + Remote access</option>
                        <option value="remote-access"  ${selected(n.vpnMode,'remote-access')}>${t('o.remoteOnly')}</option>
                        <option value="site-to-site"   ${selected(n.vpnMode,'site-to-site')}>${t('o.s2sOnly')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.protocols')}</label>
                        <div style="display:flex;flex-direction:column;gap:4px;margin-top:2px">
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(n.vpnProtoIpsec!==false)}  data-change="update-n" data-nfield="vpnProtoIpsec" data-ncoerce="bool"   style="width:auto;margin-right:6px">IPsec (IKEv2)</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(n.vpnProtoSsl)}            data-change="update-n" data-nfield="vpnProtoSsl" data-ncoerce="bool"     style="width:auto;margin-right:6px">SSL/TLS</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(n.vpnProtoWg)}             data-change="update-n" data-nfield="vpnProtoWg" data-ncoerce="bool"      style="width:auto;margin-right:6px">WireGuard</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(n.vpnProtoL2tp)}           data-change="update-n" data-nfield="vpnProtoL2tp" data-ncoerce="bool"    style="width:auto;margin-right:6px">L2TP/IPsec</label>
                        </div>
                    </div>
                    <div class="prop-group"><label>${t('f.maxSessions')}</label>
                        <input type="number" min="1" max="100000" value="${n.vpnMaxSessions ?? ''}" placeholder="100" data-change="update-n" data-nfield="vpnMaxSessions" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.licenses')}</label>
                        <input value="${escapeHTML(n.vpnLicenses||'')}" placeholder="${t('pnl.dev.phVpnLicenses')}" data-change="update-n" data-nfield="vpnLicenses"></div>
                </div></details>`;
            }
            if(n.type==='doorctrl'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="DOOR-ENTR-01, ACL-PIANO2" data-change="floor-id"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-doorctrl')?'open':''} data-toggle="props-section" data-section="device-doorctrl"><summary class="props-collapsible-head"><span><i class="fas fa-door-open"></i> ${t('dev.doorctrl')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('f.platform')}</label><select data-change="update-n" data-nfield="doorPlatform" data-ncoerce="stropt">
                        <option value=""           ${selected(n.doorPlatform||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="hid"        ${selected(n.doorPlatform,'hid')}>HID Global (VertX/Aero)</option>
                        <option value="axis"       ${selected(n.doorPlatform,'axis')}>Axis Communications</option>
                        <option value="suprema"    ${selected(n.doorPlatform,'suprema')}>Suprema</option>
                        <option value="zkteco"     ${selected(n.doorPlatform,'zkteco')}>ZKTeco</option>
                        <option value="genetec"    ${selected(n.doorPlatform,'genetec')}>Genetec Synergis</option>
                        <option value="paxton"     ${selected(n.doorPlatform,'paxton')}>Paxton</option>
                        <option value="bft"        ${selected(n.doorPlatform,'bft')}>BFT / Came</option>
                        <option value="altro"      ${selected(n.doorPlatform,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.managedPorts')}</label>
                        <input type="number" min="1" max="32" value="${n.doorCount ?? ''}" placeholder="2" data-change="update-n" data-nfield="doorCount" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.readerTech')}</label><select data-change="update-n" data-nfield="doorReader" data-ncoerce="stropt">
                        <option value="" ${selected(n.doorReader||'','')}>${t('o.notDeclared')}</option>
                        <option value="mifare"     ${selected(n.doorReader,'mifare')}>RFID 13.56MHz (Mifare/DESFire)</option>
                        <option value="prox125"    ${selected(n.doorReader,'prox125')}>RFID 125kHz (HID Prox)</option>
                        <option value="nfc-mobile" ${selected(n.doorReader,'nfc-mobile')}>NFC / Mobile credentials</option>
                        <option value="biometric"  ${selected(n.doorReader,'biometric')}>${t('o.bioBoth')}</option>
                        <option value="pin"        ${selected(n.doorReader,'pin')}>${t('o.pinKeypad')}</option>
                        <option value="mixed"      ${selected(n.doorReader,'mixed')}>${t('pnl.dev.multiTech')}</option>
                    </select></div>
                    <label class="prop-check"><input type="checkbox" ${checked(n.poe)} data-change="update-n" data-nfield="poe" data-ncoerce="bool" style="width:auto;margin-right:6px">${t('pnl.dev.poePowered')}</label>                </div></details>`;
            }
            if(n.type==='panelboard'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="QE-CED, QE-PIANO2" data-change="floor-id"></div>
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-panelboard')?'open':''} data-toggle="props-section" data-section="device-panelboard"><summary class="props-collapsible-head"><span><i class="fas fa-bolt"></i> ${t('dev.panelboard')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('f.powerType')}</label><select data-change="update-n" data-nfield="panelPhase" data-ncoerce="stropt">
                        <option value="" ${selected(n.panelPhase||'','')}>${t('o.notDeclared')}</option>
                        <option value="single-230" ${selected(n.panelPhase,'single-230')}>${t('o.single230sp')}</option>
                        <option value="three-400"  ${selected(n.panelPhase,'three-400')}>${t('o.three400sp')}</option>
                        <option value="three-690"  ${selected(n.panelPhase,'three-690')}>${t('o.three690')}</option>
                        <option value="dc-48"      ${selected(n.panelPhase,'dc-48')}>DC -48 V (telco)</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.ratedCurrent')}</label>
                        <input type="number" min="6" max="6300" value="${n.panelCurrent ?? ''}" placeholder="63" data-change="update-n" data-nfield="panelCurrent" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.dinModules')}</label>
                        <input type="number" min="2" max="288" value="${n.panelModules ?? ''}" placeholder="36" data-change="update-n" data-nfield="panelModules" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.upstreamOf')}</label><select data-change="update-n" data-nfield="panelUpstream" data-ncoerce="stropt">
                        <option value="" ${selected(n.panelUpstream||'','')}>${t('o.notDeclared')}</option>
                        <option value="contatore"   ${selected(n.panelUpstream,'contatore')}>${t('o.mainMeter')}</option>
                        <option value="qe-generale" ${selected(n.panelUpstream,'qe-generale')}>${t('o.otherPanel')}</option>
                        <option value="ats"         ${selected(n.panelUpstream,'ats')}>ATS / Transfer switch</option>
                        <option value="gruppo"      ${selected(n.panelUpstream,'gruppo')}>${t('o.generator')}</option>
                    </select></div>
                    <label class="prop-check"><input type="checkbox" ${checked(n.panelHasRcd!==false)} data-change="update-n" data-nfield="panelHasRcd" data-ncoerce="bool" style="width:auto;margin-right:6px">${t('pnl.dev.mainRcd')}</label>
                    <label class="prop-check"><input type="checkbox" ${checked(n.panelHasSpd)}        data-change="update-n" data-nfield="panelHasSpd" data-ncoerce="bool"  style="width:auto;margin-right:6px">${t('pnl.dev.spdSurge')}</label>
                    <label class="prop-check"><input type="checkbox" ${checked(n.panelFeedsUps)}      data-change="update-n" data-nfield="panelFeedsUps" data-ncoerce="bool" style="width:auto;margin-right:6px">${t('pnl.dev.feedsUpsRack')}</label>
                    <div class="prop-group"><label>${t('common.notes')}</label>
                        <input value="${escapeHTML(n.panelNotes||'')}" placeholder="${t('pnl.dev.phPanelNotes')}" data-change="update-n" data-nfield="panelNotes"></div>
                </div></details>`;
            }
            if(n.type==='tv'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="TV-SALA-A, DISPLAY-01" data-change="floor-id"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-tv')?'open':''} data-toggle="props-section" data-section="device-tv"><summary class="props-collapsible-head"><span><i class="fas fa-tv"></i> ${t('dev.tv')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('f.usage')}</label><select data-change="update-n" data-nfield="tvUsage" data-ncoerce="stropt">
                        <option value="" ${selected(n.tvUsage||'','')}>${t('o.notDeclared')}</option>
                        <option value="meeting"   ${selected(n.tvUsage,'meeting')}>${t('o.meetingRoom')}</option>
                        <option value="signage"   ${selected(n.tvUsage,'signage')}>Digital signage</option>
                        <option value="reception" ${selected(n.tvUsage,'reception')}>Reception / lobby</option>
                        <option value="workarea"  ${selected(n.tvUsage,'workarea')}>${t('o.workArea')}</option>
                        <option value="monitor"   ${selected(n.tvUsage,'monitor')}>${t('o.netMonitor')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.brand')}</label><select data-change="update-n" data-nfield="brand" data-ncoerce="stropt">
                        <option value=""         ${selected(n.brand||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="Samsung"  ${selected(n.brand,'Samsung')}>Samsung</option>
                        <option value="LG"       ${selected(n.brand,'LG')}>LG</option>
                        <option value="Sony"     ${selected(n.brand,'Sony')}>Sony</option>
                        <option value="Philips"  ${selected(n.brand,'Philips')}>Philips</option>
                        <option value="Panasonic"${selected(n.brand,'Panasonic')}>Panasonic</option>
                        <option value="Altro"    ${selected(n.brand,'Altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="QE55Q80C, OLED65C3…" data-change="update-n" data-nfield="model"></div>
                    <div class="prop-group"><label>${t('f.diagonal')}</label><input type="number" min="24" max="110" value="${n.screenSize ?? ''}" placeholder="55" data-change="update-n" data-nfield="screenSize" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.resolution')}</label><select data-change="update-n" data-nfield="resolution" data-ncoerce="stropt">
                        <option value="" ${selected(n.resolution||'','')}>${t('o.notDeclared')}</option>
                        <option value="4k"    ${selected(n.resolution,'4k')}>4K UHD</option>
                        <option value="1080p" ${selected(n.resolution,'1080p')}>Full HD 1080p</option>
                        <option value="8k"    ${selected(n.resolution,'8k')}>8K</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.os')}</label><select data-change="update-n" data-nfield="tvOs" data-ncoerce="stropt">
                        <option value=""           ${selected(n.tvOs||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="tizen"      ${selected(n.tvOs,'tizen')}>Tizen (Samsung)</option>
                        <option value="webos"      ${selected(n.tvOs,'webos')}>webOS (LG)</option>
                        <option value="android-tv" ${selected(n.tvOs,'android-tv')}>Android TV</option>
                        <option value="google-tv"  ${selected(n.tvOs,'google-tv')}>Google TV</option>
                        <option value="altro"      ${selected(n.tvOs,'altro')}>${t('o.otherProprietary')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('field.connection')}</label><select data-change="update-n" data-nfield="connection" data-ncoerce="stropt">
                        <option value="" ${selected(n.connection||'','')}>${t('o.notDeclared')}</option>
                        <option value="wired"    ${selected(n.connection,'wired')}>${t('o.wiredEth')}</option>
                        <option value="wireless" ${selected(n.connection,'wireless')}>Wireless (Wi-Fi)</option>
                        <option value="both"     ${selected(n.connection,'both')}>${t('o.wiredWifi')}</option>
                    </select></div>                </div></details>`;
            }
            if(n.type==='customfloor'){
                h+=`<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="Endpoint-01" data-change="floor-id"></div>
                    <div class="prop-group"><label>${t('f.category')}</label><input value="${escapeHTML(n.customCategory||'')}" placeholder="${t('pnl.dev.phCustomCatFloor')}" data-change="update-n" data-nfield="customCategory"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    <details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-customfloor')?'open':''} data-toggle="props-section" data-section="device-customfloor"><summary class="props-collapsible-head"><span><i class="fas fa-cube"></i> ${t('dev.customfloor')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    <div class="prop-group"><label>${t('field.brand')}</label><input value="${escapeHTML(n.brand||'')}" placeholder="NVIDIA, Google, Sony, custom..." data-change="update-n" data-nfield="brand"></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="Shield TV, Chromecast, appliance..." data-change="update-n" data-nfield="model"></div>
                    <div class="prop-group"><label>${t('field.connection')}</label><select data-change="update-n" data-nfield="connection" data-ncoerce="stropt">
                        <option value="" ${selected(n.connection||'','')}>${t('o.notDeclared')}</option>
                        <option value="wired"    ${selected(n.connection,'wired')}>${t('o.wiredEth')}</option>
                        <option value="wireless" ${selected(n.connection,'wireless')}>Wireless (Wi-Fi)</option>
                        <option value="both"     ${selected(n.connection,'both')}>${t('o.wiredWifi')}</option>
                    </select></div>                </div></details>`;
            }
            if(n.type==='customrack'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-customrack')?'open':''} data-toggle="props-section" data-section="device-customrack"><summary class="props-collapsible-head"><span><i class="fas fa-cube"></i> ${t('dev.customrack')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.category')}</label><input value="${escapeHTML(n.customCategory||'')}" placeholder="${t('pnl.dev.phCustomCatRack')}" data-change="update-n" data-nfield="customCategory"></div>
                    <div class="prop-group"><label>${t('field.brand')}</label><input value="${escapeHTML(n.brand||'')}" placeholder="${t('pnl.dev.phVendorMaker')}" data-change="update-n" data-nfield="brand"></div>
                    <div class="prop-group"><label>${t('field.model')}</label><input value="${escapeHTML(n.model||'')}" placeholder="${t('pnl.dev.phModelSku')}" data-change="update-n" data-nfield="model"></div>
                </div></details>`;
            }
            if(n.type==='switch'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-switch')?'open':''} data-toggle="props-section" data-section="device-switch"><summary class="props-collapsible-head"><span><i class="fas fa-network-wired"></i> Switch</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.mgmtType')}</label><select data-change="update-n" data-nfield="swMgmt" data-ncoerce="stropt">
                        <option value="" ${selected(n.swMgmt||'','')}>${t('o.notDeclared')}</option>
                        <option value="managed"   ${selected(n.swMgmt,'managed')}>Managed</option>
                        <option value="smart"     ${selected(n.swMgmt,'smart')}>Smart-managed (Web UI)</option>
                        <option value="unmanaged" ${selected(n.swMgmt,'unmanaged')}>Unmanaged</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.netLevel')}</label><select data-change="update-n" data-nfield="swLayer" data-ncoerce="stropt">
                        <option value="" ${selected(n.swLayer||'','')}>${t('o.notDeclared')}</option>
                        <option value="l2"         ${selected(n.swLayer,'l2')}>Layer 2</option>
                        <option value="l3"         ${selected(n.swLayer,'l3')}>Layer 3</option>
                        <option value="multilayer" ${selected(n.swLayer,'multilayer')}>Multilayer</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.topoRole')}</label><select data-change="update-n" data-nfield="swRole" data-ncoerce="stropt">
                        <option value="" ${selected(n.swRole||'','')}>${t('o.notDeclared')}</option>
                        <option value="standalone"   ${selected(n.swRole,'standalone')}>Standalone</option>
                        <option value="core"         ${selected(n.swRole,'core')}>Core</option>
                        <option value="distribution" ${selected(n.swRole,'distribution')}>Distribution</option>
                        <option value="access"       ${selected(n.swRole,'access')}>Access</option>
                        <option value="tor"          ${selected(n.swRole,'tor')}>Top-of-Rack (ToR)</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.poeBudget')}</label>
                        <input type="number" min="0" max="10000" value="${n.swPoeBudgetW||0}" data-change="update-n" data-nfield="swPoeBudgetW" data-ncoerce="intdef" data-ndef="0"></div>
                </div></details>`;
            }
            if(n.type==='router'){
                const protos = Array.isArray(n.rtRoutingProtos) ? n.rtRoutingProtos : [];
                const hasBgp = protos.includes('bgp');
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-router')?'open':''} data-toggle="props-section" data-section="device-router"><summary class="props-collapsible-head"><span><i class="fas fa-route"></i> Router</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.role')}</label><select data-change="update-n" data-nfield="rtRole" data-ncoerce="stropt">
                        <option value="" ${selected(n.rtRole||'','')}>${t('o.notDeclared')}</option>
                        <option value="edge"       ${selected(n.rtRole,'edge')}>Edge / WAN</option>
                        <option value="inter-vlan" ${selected(n.rtRole,'inter-vlan')}>Inter-VLAN</option>
                        <option value="branch"     ${selected(n.rtRole,'branch')}>${t('o.branchRemote')}</option>
                        <option value="core"       ${selected(n.rtRole,'core')}>Core</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.wanType')}</label><select data-change="update-n" data-nfield="rtWanType" data-ncoerce="stropt">
                        <option value="" ${selected(n.rtWanType||'','')}>${t('o.notDeclared')}</option>
                        <option value="fiber"     ${selected(n.rtWanType,'fiber')}>${t('o.fiberFtth')}</option>
                        <option value="dsl"       ${selected(n.rtWanType,'dsl')}>xDSL</option>
                        <option value="coax"      ${selected(n.rtWanType,'coax')}>${t('o.coax')}</option>
                        <option value="cellular"  ${selected(n.rtWanType,'cellular')}>4G / 5G</option>
                        <option value="mpls"      ${selected(n.rtWanType,'mpls')}>MPLS</option>
                        <option value="multi-wan" ${selected(n.rtWanType,'multi-wan')}>Multi-WAN (failover/load-balancing)</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.routingProtocols')}</label>
                        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:2px">
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('static'))} data-change="toggle-array" data-taid="${n.id}" data-tafield="rtRoutingProtos" data-taval="static" style="width:auto;margin-right:6px">Static</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('ospf'))}   data-change="toggle-array" data-taid="${n.id}" data-tafield="rtRoutingProtos" data-taval="ospf"   style="width:auto;margin-right:6px">OSPF</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(hasBgp)}                   data-change="toggle-array" data-taid="${n.id}" data-tafield="rtRoutingProtos" data-taval="bgp"    style="width:auto;margin-right:6px">BGP</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('eigrp'))}  data-change="toggle-array" data-taid="${n.id}" data-tafield="rtRoutingProtos" data-taval="eigrp"  style="width:auto;margin-right:6px">EIGRP</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('rip'))}    data-change="toggle-array" data-taid="${n.id}" data-tafield="rtRoutingProtos" data-taval="rip"    style="width:auto;margin-right:6px">RIP</label>
                        </div>
                    </div>
                    ${hasBgp ? `<div class="prop-group"><label>ASN (BGP)</label>
                        <input type="number" min="1" max="4294967295" value="${n.rtAsn||''}" placeholder="${t('pnl.dev.phAsn')}" data-change="update-n" data-nfield="rtAsn" data-ncoerce="intdef" data-ndef="0"></div>` : ''}
                </div></details>`;
            }
            if(n.type==='firewall'){
                const svcs = Array.isArray(n.fwServices) ? n.fwServices : [];
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-firewall')?'open':''} data-toggle="props-section" data-section="device-firewall"><summary class="props-collapsible-head"><span><i class="fas fa-shield-halved"></i> Firewall</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.deployMode')}</label><select data-change="update-n" data-nfield="fwDeployMode" data-ncoerce="stropt">
                        <option value="" ${selected(n.fwDeployMode||'','')}>${t('o.notDeclared')}</option>
                        <option value="routed"      ${selected(n.fwDeployMode,'routed')}>Routed (L3)</option>
                        <option value="transparent" ${selected(n.fwDeployMode,'transparent')}>Transparent (bridge)</option>
                        <option value="vwire"       ${selected(n.fwDeployMode,'vwire')}>Virtual wire</option>
                    </select></div>
                    <div class="prop-group"><label>High Availability</label><select data-change="update-n" data-nfield="fwHa" data-ncoerce="stropt">
                        <option value="" ${selected(n.fwHa||'','')}>${t('o.notDeclared')}</option>
                        <option value="standalone"      ${selected(n.fwHa,'standalone')}>Standalone</option>
                        <option value="active-passive"  ${selected(n.fwHa,'active-passive')}>Active / Passive</option>
                        <option value="active-active"   ${selected(n.fwHa,'active-active')}>Active / Active</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.maxThroughput')}</label>
                        <input type="number" min="10" max="1000000" value="${n.fwThroughputMbps ?? ''}" placeholder="1000" data-change="update-n" data-nfield="fwThroughputMbps" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.activeServices')}</label>
                        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:2px">
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(svcs.includes('vpn'))}    data-change="toggle-array" data-taid="${n.id}" data-tafield="fwServices" data-taval="vpn"    style="width:auto;margin-right:6px">VPN</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(svcs.includes('ips'))}    data-change="toggle-array" data-taid="${n.id}" data-tafield="fwServices" data-taval="ips"    style="width:auto;margin-right:6px">IPS</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(svcs.includes('av'))}     data-change="toggle-array" data-taid="${n.id}" data-tafield="fwServices" data-taval="av"     style="width:auto;margin-right:6px">Antivirus</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(svcs.includes('web'))}    data-change="toggle-array" data-taid="${n.id}" data-tafield="fwServices" data-taval="web"    style="width:auto;margin-right:6px">Web filter</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(svcs.includes('sdwan'))}  data-change="toggle-array" data-taid="${n.id}" data-tafield="fwServices" data-taval="sdwan"  style="width:auto;margin-right:6px">SD-WAN</label>
                        </div>
                    </div>
                </div></details>`;
            }
            if(n.type==='server'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-server')?'open':''} data-toggle="props-section" data-section="device-server"><summary class="props-collapsible-head"><span><i class="fas fa-server"></i> Server</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.role')}</label><select data-change="update-n" data-nfield="srvRole" data-ncoerce="stropt">
                        <option value="" ${selected(n.srvRole||'','')}>${t('o.notDeclared')}</option>
                        <option value="hypervisor"  ${selected(n.srvRole,'hypervisor')}>Hypervisor</option>
                        <option value="bare-metal"  ${selected(n.srvRole,'bare-metal')}>Bare-metal</option>
                        <option value="db"          ${selected(n.srvRole,'db')}>Database</option>
                        <option value="web"         ${selected(n.srvRole,'web')}>Web / Application</option>
                        <option value="file"        ${selected(n.srvRole,'file')}>File server</option>
                        <option value="dc"          ${selected(n.srvRole,'dc')}>Domain Controller</option>
                        <option value="backup"      ${selected(n.srvRole,'backup')}>Backup</option>
                        <option value="altro"       ${selected(n.srvRole,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>CPU</label>
                        <input value="${escapeHTML(n.srvCpu||'')}" placeholder="${t('pnl.dev.phSrvCpu')}" data-change="update-n" data-nfield="srvCpu"></div>
                    <div class="prop-group"><label>RAM (GB)</label>
                        <input type="number" min="1" max="65536" value="${n.srvRamGb ?? ''}" placeholder="64" data-change="update-n" data-nfield="srvRamGb" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.os')}</label><select data-change="update-n" data-nfield="srvOs" data-ncoerce="stropt">
                        <option value=""         ${selected(n.srvOs||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="win-srv"  ${selected(n.srvOs,'win-srv')}>Windows Server</option>
                        <option value="ubuntu"   ${selected(n.srvOs,'ubuntu')}>Ubuntu</option>
                        <option value="debian"   ${selected(n.srvOs,'debian')}>Debian</option>
                        <option value="rhel"     ${selected(n.srvOs,'rhel')}>RHEL / Rocky / Alma</option>
                        <option value="fedora"   ${selected(n.srvOs,'fedora')}>Fedora</option>
                        <option value="suse"     ${selected(n.srvOs,'suse')}>openSUSE / SLES</option>
                        <option value="bsd"      ${selected(n.srvOs,'bsd')}>FreeBSD / TrueNAS</option>
                        <option value="proxmox"  ${selected(n.srvOs,'proxmox')}>Proxmox VE</option>
                        <option value="esxi"     ${selected(n.srvOs,'esxi')}>VMware ESXi</option>
                        <option value="hyperv"   ${selected(n.srvOs,'hyperv')}>Hyper-V</option>
                        <option value="altro"    ${selected(n.srvOs,'altro')}>${t('o.other')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.localStorage')}</label>
                        <input type="number" min="0" max="10000" step="0.5" value="${n.srvStorageTb ?? ''}" placeholder="2" data-change="update-n" data-nfield="srvStorageTb" data-ncoerce="floatopt"></div>
                    ${_vmSectionHtml(n)}
                </div></details>`;
            }
            // Hypervisor (rack) + Homelab (floor): motore VM condiviso (src/app-hypervisor.js).
            // Il pannello host (inventario/piattaforma/VM) va nel bucket GIUSTO secondo la
            // collocazione: rack → _devSpecHtml (cucito nel ramo rack del chiamante); floor →
            // flusso inline `h` come gli altri device floor (nome + Rete&Accesso + pannello),
            // altrimenti per il floor il device-spec verrebbe calcolato ma mai concatenato.
            if(n.type==='hypervisor' && typeof _hvPanelHtml === 'function'){
                _devSpecHtml += _hvPanelHtml(n, d);
            }
            if(n.type==='homelab' && typeof _hvPanelHtml === 'function'){
                h += `<div class="prop-group"><label>${t('field.nameId')}</label><input value="${escapeHTML(n.name||'')}" placeholder="homelab-01" data-change="floor-id"></div>
                    ${(_floorNet = _buildNetAccessHtml(n, d, {includeHostname:false}), '')}
                    ${_hvPanelHtml(n, d)}`;
            }
            if(n.type==='nas'){
                const protos = Array.isArray(n.nasProtocols) ? n.nasProtocols : [];
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-nas')?'open':''} data-toggle="props-section" data-section="device-nas"><summary class="props-collapsible-head"><span><i class="fas fa-database"></i> ${t('dev.nas')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.typology')}</label><select data-change="update-n" data-nfield="nasType" data-ncoerce="stropt">
                        <option value="" ${selected(n.nasType||'','')}>${t('o.notDeclared')}</option>
                        <option value="file"    ${selected(n.nasType,'file')}>NAS — file storage</option>
                        <option value="block"   ${selected(n.nasType,'block')}>SAN — block storage</option>
                        <option value="unified" ${selected(n.nasType,'unified')}>Unified (file + block)</option>
                        <option value="object"  ${selected(n.nasType,'object')}>Object storage</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.usableCap')}</label>
                        <input type="number" min="0.1" max="100000" step="0.1" value="${n.nasCapacityTb ?? ''}" placeholder="10" data-change="update-n" data-nfield="nasCapacityTb" data-ncoerce="floatopt"></div>
                    <div class="prop-group"><label>RAID level</label><select data-change="update-n" data-nfield="nasRaid" data-ncoerce="stropt">
                        <option value="" ${selected(n.nasRaid||'','')}>${t('o.notDeclared')}</option>
                        <option value="raid1"   ${selected(n.nasRaid,'raid1')}>RAID 1 (mirror)</option>
                        <option value="raid5"   ${selected(n.nasRaid,'raid5')}>RAID 5</option>
                        <option value="raid6"   ${selected(n.nasRaid,'raid6')}>RAID 6</option>
                        <option value="raid10"  ${selected(n.nasRaid,'raid10')}>RAID 10</option>
                        <option value="raidz1"  ${selected(n.nasRaid,'raidz1')}>RAIDZ1 (ZFS)</option>
                        <option value="raidz2"  ${selected(n.nasRaid,'raidz2')}>RAIDZ2 (ZFS)</option>
                        <option value="raidz3"  ${selected(n.nasRaid,'raidz3')}>RAIDZ3 (ZFS)</option>
                        <option value="jbod"    ${selected(n.nasRaid,'jbod')}>${t('o.jbod')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.exposedProtocols')}</label>
                        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:2px">
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('smb'))}   data-change="toggle-array" data-taid="${n.id}" data-tafield="nasProtocols" data-taval="smb"   style="width:auto;margin-right:6px">SMB</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('nfs'))}   data-change="toggle-array" data-taid="${n.id}" data-tafield="nasProtocols" data-taval="nfs"   style="width:auto;margin-right:6px">NFS</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('iscsi'))} data-change="toggle-array" data-taid="${n.id}" data-tafield="nasProtocols" data-taval="iscsi" style="width:auto;margin-right:6px">iSCSI</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('fc'))}    data-change="toggle-array" data-taid="${n.id}" data-tafield="nasProtocols" data-taval="fc"    style="width:auto;margin-right:6px">FC</label>
                            <label style="font-size:0.82rem"><input type="checkbox" ${checked(protos.includes('s3'))}    data-change="toggle-array" data-taid="${n.id}" data-tafield="nasProtocols" data-taval="s3"    style="width:auto;margin-right:6px">S3</label>
                        </div>
                    </div>
                    <div class="prop-group"><label>${t('f.swPlatform')}</label><select data-change="update-n" data-nfield="nasPlatform" data-ncoerce="stropt">
                        <option value=""         ${selected(n.nasPlatform||'','')}>${t('common.unspecifiedM')}</option>
                        <option value="dsm"      ${selected(n.nasPlatform,'dsm')}>DSM (Synology)</option>
                        <option value="truenas"  ${selected(n.nasPlatform,'truenas')}>TrueNAS Core/Scale</option>
                        <option value="unraid"   ${selected(n.nasPlatform,'unraid')}>Unraid</option>
                        <option value="qts"      ${selected(n.nasPlatform,'qts')}>QTS (QNAP)</option>
                        <option value="win-stor" ${selected(n.nasPlatform,'win-stor')}>Windows Storage Server</option>
                        <option value="netapp"   ${selected(n.nasPlatform,'netapp')}>NetApp ONTAP</option>
                        <option value="emc"      ${selected(n.nasPlatform,'emc')}>Dell EMC</option>
                        <option value="altro"    ${selected(n.nasPlatform,'altro')}>${t('o.otherProprietary')}</option>
                    </select></div>
                    ${_vmSectionHtml(n)}
                </div></details>`;
            }
            if(n.type==='kvm'){
                const isIp = (n.kvmType||'analog')==='ip';
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-kvm')?'open':''} data-toggle="props-section" data-section="device-kvm"><summary class="props-collapsible-head"><span><i class="fas fa-keyboard"></i> ${t('dev.kvm')}</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.type')}</label><select data-change="update-n" data-nfield="kvmType" data-ncoerce="stropt">
                        <option value="" ${selected(n.kvmType||'','')}>${t('o.notDeclared')}</option>
                        <option value="analog"   ${selected(n.kvmType,'analog')}>${t('o.analogVga')}</option>
                        <option value="digital"  ${selected(n.kvmType,'digital')}>${t('o.digitalCat')}</option>
                        <option value="ip"       ${selected(n.kvmType,'ip')}>KVM-over-IP</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.maxResolution')}</label><select data-change="update-n" data-nfield="kvmMaxRes" data-ncoerce="stropt">
                        <option value="" ${selected(n.kvmMaxRes||'','')}>${t('o.notDeclared')}</option>
                        <option value="1080p"  ${selected(n.kvmMaxRes,'1080p')}>Full HD 1080p</option>
                        <option value="1440p"  ${selected(n.kvmMaxRes,'1440p')}>QHD 1440p</option>
                        <option value="4k"     ${selected(n.kvmMaxRes,'4k')}>4K UHD</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.connectedServers')}</label>
                        <input type="number" min="0" max="256" value="${n.kvmConnectedServers||0}" data-change="update-n" data-nfield="kvmConnectedServers" data-ncoerce="intdef" data-ndef="0"></div>
                    ${isIp ? `<label class="prop-check"><input type="checkbox" ${checked(n.kvmRemoteAccess!==false)} data-change="update-n" data-nfield="kvmRemoteAccess" data-ncoerce="bool" style="width:auto;margin-right:6px">${t('pnl.dev.remoteAccessBrowser')}</label>` : ''}
                </div></details>`;
            }
            if(n.type==='ups'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-ups')?'open':''} data-toggle="props-section" data-section="device-ups"><summary class="props-collapsible-head"><span><i class="fas fa-car-battery"></i> UPS</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.topology')}</label><select data-change="update-n" data-nfield="upsTopology" data-ncoerce="stropt">
                        <option value="" ${selected(n.upsTopology||'','')}>${t('o.notDeclared')}</option>
                        <option value="standby"  ${selected(n.upsTopology,'standby')}>Standby (offline)</option>
                        <option value="line-interactive" ${selected(n.upsTopology,'line-interactive')}>Line-interactive</option>
                        <option value="online"   ${selected(n.upsTopology,'online')}>${t('o.upsOnline')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.apparentPower')}</label>
                        <input type="number" min="100" max="500000" value="${n.upsVa ?? ''}" placeholder="1500" data-change="update-n" data-nfield="upsVa" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.activePower')}</label>
                        <input type="number" min="100" max="500000" value="${n.upsW ?? ''}" placeholder="1000" data-change="update-n" data-nfield="upsW" data-ncoerce="intopt"></div>
                    <div class="prop-group"><label>${t('f.estRuntime')}</label>
                        <input type="number" min="1" max="600" value="${n.upsAutonomyMin ?? ''}" placeholder="10" data-change="update-n" data-nfield="upsAutonomyMin" data-ncoerce="intopt"></div>
                    <label class="prop-check"><input type="checkbox" ${checked(n.upsHotSwap)} data-change="update-n" data-nfield="upsHotSwap" data-ncoerce="bool" style="width:auto;margin-right:6px">${t('pnl.dev.hotSwapBatteries')}</label>
                    <div class="prop-group"><label>${t('f.totalSockets')}</label>
                        <input type="number" min="0" max="${escapeHTML(String(MAX_PDU_OUTLETS))}" value="${escapeHTML(String(n.pduOutletCount||''))}" placeholder="0" data-change="update-n" data-nfield="pduOutletCount" data-ncoerce="intdef" data-ndef="0"></div>
                    <div class="pdu-port-model-note" data-tip="${escapeHTML(t('pnl.dev.upsOutletsNoteTip'))}" data-tip-wrap><i class="fas fa-circle-info"></i> ${t('pnl.dev.upsOutletsNote')}</div>
                    ${_pduOutletStateHtml(n)}
                    ${rendersOutletGrid(n) ? _powerGroupsHtml(n) : ''}
                    ${rendersOutletGrid(n) ? _pduPowerConnectionsHtml(n) : ''}
                    ${typeof _powerLiveHtml==='function' ? _powerLiveHtml(n) : ''}
                </div></details>`;
            }
            // ⚠️ La PDU NON ha un campo «Orientamento» (rimosso in 2.8.2): InfraNet
            // la monta solo in ORIZZONTALE, nel telaio a unità del rack. Il campo
            // offriva «Verticale 0U» — e per giunta come predefinito — promettendo un
            // montaggio che il render non sa disegnare: una scelta senza conseguenza,
            // cioè peggio di nessuna scelta. Il giorno che il verticale 0U si disegna
            // davvero, il campo torna INSIEME al render, non prima.
            if(n.type==='pdu'){
                const _pduMgmtMode = pduManagementMode(n);
                const _pduHasEthernet = _pduMgmtMode === 'ethernet' || _pduMgmtMode === 'ethernet-serial';
                const _pduHasSerial = _pduMgmtMode === 'serial' || _pduMgmtMode === 'ethernet-serial';
                const _pduEthPorts = pduManagementPortCount(n);
                const _pduSerialPorts = pduSerialPortCount(n);
                const _pduSensorPorts = pduAuxiliaryPortCount(n, 'pduSensorPorts', 2);
                const _pduUsbPorts = pduAuxiliaryPortCount(n, 'pduUsbPorts', 3);
                const _pduExpansionPorts = pduAuxiliaryPortCount(n, 'pduExpansionPorts', 2);
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-pdu')?'open':''} data-toggle="props-section" data-section="device-pdu"><summary class="props-collapsible-head"><span><i class="fas fa-plug"></i> PDU</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.type')}</label><select data-change="update-n" data-nfield="pduType" data-ncoerce="stropt">
                        <option value="" ${selected(n.pduType||'','')}>${t('o.notDeclared')}</option>
                        <option value="basic"            ${selected(n.pduType,'basic')}>${t('o.basicDistrib')}</option>
                        <option value="metered"          ${selected(n.pduType,'metered')}>${t('o.pduMetered')}</option>
                        <option value="switched"         ${selected(n.pduType,'switched')}>${t('o.pduSwitched')}</option>
                        <option value="switched-metered" ${selected(n.pduType,'switched-metered')}>Switched + Metered</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.pduMgmtType')}</label><select data-change="update-n" data-nfield="pduMgmtMode" data-ncoerce="stropt" data-tip="${t('pnl.node.pduMgmtTypeTip')}">
                        <option value="none"            ${selected(_pduMgmtMode,'none')}>${t('o.pduMgmtNone')}</option>
                        <option value="ethernet"        ${selected(_pduMgmtMode,'ethernet')}>${t('o.pduMgmtEthernet')}</option>
                        <option value="serial"          ${selected(_pduMgmtMode,'serial')}>${t('o.pduMgmtSerial')}</option>
                        <option value="ethernet-serial"  ${selected(_pduMgmtMode,'ethernet-serial')}>${t('o.pduMgmtEthernetSerial')}</option>
                    </select></div>
                    ${_pduHasEthernet ? `<div class="prop-group"><label>${t('f.pduEthernetPorts')}</label>
                        <input type="number" min="1" max="2" value="${_pduEthPorts||1}" data-change="update-n" data-nfield="pduEthernetPorts" data-ncoerce="intdef" data-ndef="1"></div>` : ''}
                    ${_pduHasSerial ? `<div class="prop-group"><label>${t('f.pduConsolePorts')}</label>
                        <input type="number" min="1" max="2" value="${_pduSerialPorts||1}" data-change="update-n" data-nfield="pduSerialPorts" data-ncoerce="intdef" data-ndef="1"></div>` : ''}
                    <div class="prop-row2">
                        <div class="prop-group"><label>${t('f.pduSensorPorts')}</label>
                            <input type="number" min="0" max="2" value="${_pduSensorPorts}" data-change="update-n" data-nfield="pduSensorPorts" data-ncoerce="intdef" data-ndef="0"></div>
                        <div class="prop-group"><label>${t('f.pduUsbPorts')}</label>
                            <input type="number" min="0" max="3" value="${_pduUsbPorts}" data-change="update-n" data-nfield="pduUsbPorts" data-ncoerce="intdef" data-ndef="0"></div>
                    </div>
                    <div class="prop-group"><label>${t('f.pduExpansionPorts')}</label>
                        <input type="number" min="0" max="2" value="${_pduExpansionPorts}" data-change="update-n" data-nfield="pduExpansionPorts" data-ncoerce="intdef" data-ndef="0"></div>
                    <div class="pdu-port-model-note" data-tip="${escapeHTML(t('pnl.node.pduPortsNoteTip'))}" data-tip-wrap><i class="fas fa-circle-info"></i> ${t('pnl.node.pduPortsNote')}</div>
                    <div class="prop-group"><label>${t('f.phases')}</label><select data-change="update-n" data-nfield="pduPhase" data-ncoerce="stropt">
                        <option value="" ${selected(n.pduPhase||'','')}>${t('o.notDeclared')}</option>
                        <option value="single" ${selected(n.pduPhase,'single')}>${t('o.single230')}</option>
                        <option value="three"  ${selected(n.pduPhase,'three')}>${t('o.three400')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.ratedCurrent')}</label><select data-change="update-n" data-nfield="pduCurrentA" data-ncoerce="intopt">
                        <option value="" ${selected(String(n.pduCurrentA||''),'')}>${t('o.notDeclared')}</option>
                        <option value="16" ${selected(String(n.pduCurrentA||''),'16')}>16 A</option>
                        <option value="32" ${selected(String(n.pduCurrentA||''),'32')}>32 A</option>
                        <option value="63" ${selected(String(n.pduCurrentA||''),'63')}>63 A</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.totalSockets')}</label>
                        <input type="number" min="1" max="${MAX_PDU_OUTLETS}" value="${n.pduOutletCount||8}" data-change="update-n" data-nfield="pduOutletCount" data-ncoerce="intdef" data-ndef="8"></div>
                    ${_pduOutletStateHtml(n)}
                    ${_powerGroupsHtml(n)}
                    ${_pduPowerConnectionsHtml(n)}
                </div></details>`;
            }
            if(n.type==='ats'){
                _devSpecHtml+=`<details class="props-collapsible props-primary" ${_propsSectionIsOpen('device-ats')?'open':''} data-toggle="props-section" data-section="device-ats"><summary class="props-collapsible-head"><span><i class="fas fa-shuffle"></i> ATS — Transfer Switch</span>${_buildDeviceBrandModelPreview(n)}<i class="fas fa-chevron-down props-collapsible-chevron"></i></summary><div class="props-collapsible-body">
                    ${_buildInventoryFieldsHtml(n, d)}
                    <div class="prop-group"><label>${t('f.prefSource')}</label><select data-change="update-n" data-nfield="atsSourcePref" data-ncoerce="stropt" data-tip="${t('pnl.dev.atsPrefSourceTip')}">
                        <option value="" ${selected(n.atsSourcePref||'','')}>${t('o.notDeclared')}</option>
                        <option value="A" ${selected(n.atsSourcePref,'A')}>${t('o.sourceAprim')}</option>
                        <option value="B" ${selected(n.atsSourcePref,'B')}>${t('o.sourceBprim')}</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.ratedVoltage')}</label><select data-change="update-n" data-nfield="atsInputV" data-ncoerce="stropt">
                        <option value="" ${selected(n.atsInputV||'','')}>${t('o.notDeclared')}</option>
                        <option value="230" ${selected(String(n.atsInputV),'230')}>${t('o.v230eu')}</option>
                        <option value="208" ${selected(String(n.atsInputV),'208')}>208 V</option>
                        <option value="120" ${selected(String(n.atsInputV),'120')}>120 V</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.ratedCurrent')}</label><select data-change="update-n" data-nfield="atsCurrentA" data-ncoerce="intopt">
                        <option value="" ${selected(String(n.atsCurrentA||''),'')}>${t('o.notDeclared')}</option>
                        <option value="10" ${selected(String(n.atsCurrentA||''),'10')}>10 A</option>
                        <option value="16" ${selected(String(n.atsCurrentA||''),'16')}>16 A</option>
                        <option value="20" ${selected(String(n.atsCurrentA||''),'20')}>20 A</option>
                        <option value="32" ${selected(String(n.atsCurrentA||''),'32')}>32 A</option>
                    </select></div>
                    <div class="prop-group"><label>${t('f.outputSockets')}</label>
                        <input type="number" min="1" max="48" value="${n.atsOutletCount ?? ''}" placeholder="9" data-change="update-n" data-nfield="atsOutletCount" data-ncoerce="intopt"></div>
                    ${typeof _powerLiveHtml==='function' ? _powerLiveHtml(n) : ''}
                </div></details>`;
            }
    return { h: h, devSpec: _devSpecHtml, net: _floorNet };
}

// Chiamati da app-properties-node (classic), app-properties-port (bundle),
// app-vlan-autopoll (classic).
expose({ _nodeDeviceChainHtml, _floorAccessVlanRow, _deviceAccessVlanPid });
