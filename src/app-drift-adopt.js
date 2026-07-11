// ============================================================
// DRIFT ADOPT — orchestratore + UI (migrato a ESM, esbuild)
// ============================================================
// Chiude il cerchio del Drift: dalla categoria "In rete, non documentati"
// (MAC visti nelle FDB ma assenti dal progetto) apre una schermata di selezione
// stile "Scopri" con vendor (OUI), VLAN e dove il MAC è stato visto, e li
// aggiunge alla mappa col tipo scelto.
//
// Tutte le dipendenze passano dal ponte (win.*): lib <script> (buildAdoptCandidates
// da drift-adopt.js; buildDriftReport da drift.js) e globali/glue legacy app.js,
// inclusi gli helper di discovery/drift letti con guardia `typeof win.X`. Lo stato
// condiviso `_driftReport` (var su window in app-drift.js) è letto E scritto via
// store._driftReport. `_adoptRows` resta privato del modulo.
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, uid, normalizeMacAddress } from './app-util.js';
import { markDirty, pushHistory, renderCables, _showToast, _invalidateIdx, _nextNodeId } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES, typeName } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES) + nome localizzato
import { _isLeafEndpoint, _autoLinkEndpoint } from './app-autolink.js';   // ritiro ponte: funzioni nucleo/tipi/autolink (ex win.*)
import { _discIndexNode, _discVendorFromMac, _discFindExistingDevice, _discBuildExistingIndexes } from './app-discovery-classify.js';   // ritiro ponte: funzioni topo/discovery/vlan/snmp (ex win.*)
import { _findFreeU } from './app-topology-crawl.js';   // ritiro ponte: funzioni getter/label/props/disc (ex win.*)
import { closeReportMenu } from './app-auth.js';   // ritiro ponte: coda funzioni A (batch 1/2) (ex win.*)
import { _driftBuildDocSnapshot, _driftBuildSnmpSnapshot, _renderDriftReport } from './app-drift.js';   // ritiro ponte: coda funzioni A (batch 1/2) (ex win.*)

let _adoptRows = [];           // candidati attualmente mostrati nel modal

// ── Costruzione candidati dal Drift report ───────────────────────────
function _adoptCandidates(filterKey){
    if(typeof store._driftReport === 'undefined' || !store._driftReport) return [];
    let rows = store._driftReport.undocumented || [];      // include infra + endpoint
    if(filterKey) rows = rows.filter(r => r.key === filterKey);
    return _adoptBuild(rows);
}

// Costruisce i candidati Adotta da righe stile drift.undocumented (FDB o lease):
// inietta vendor (OUI) e tipo indovinato. Punto unico → un solo aggancio al ponte
// (riusato da _adoptCandidates e openAdoptFromLeases).
function _adoptBuild(rows){
    return win.buildAdoptCandidates(rows, {
        vendorOf: m => (typeof _discVendorFromMac === 'function' ? _discVendorFromMac(m) : ''),
        guessType: v => (typeof win._guessType === 'function' ? win._guessType('', '', v, '', '') : ''),
    });
}

function _adoptTypeOptions(selType){
    return Object.entries(TYPES)
        .filter(([, v]) => v.isActive || v.hasIP)
        .map(([k]) => `<option value="${k}"${k === selType ? ' selected' : ''}>${escapeHTML(typeName(k))}</option>`)
        .join('');
}

// ── Overlay ──────────────────────────────────────────────────────────
function _adoptEnsureOverlay(){
    let ov = document.getElementById('adopt-overlay');
    if(!ov){
        ov = document.createElement('div');
        ov.id = 'adopt-overlay';
        ov.className = 'drift-overlay';
        ov.innerHTML = `<div class="drift-modal adopt-modal">
            <div class="drift-head"><span><i class="fas fa-plus-circle"></i> ${t('pnl.disc.addToMap')}</span>
                <button class="toolbar-btn" onclick="_closeAdoptModal()" data-tip="${t('pnl.disc.close')}"><i class="fas fa-times"></i></button></div>
            <div class="drift-body">
                <div class="adopt-intro">${t('pnl.disc.adoptIntro')}</div>
                <table class="adopt-table"><thead><tr>
                    <th><input type="checkbox" id="adopt-all" onchange="_adoptToggleAll(this.checked)" data-tip="${t('pnl.disc.selectAll')}"></th>
                    <th>MAC</th><th>Vendor</th><th>VLAN</th><th>${t('pnl.disc.seenOn')}</th><th>${t('pnl.disc.type')}</th>
                </tr></thead><tbody id="adopt-tbody"></tbody></table>
            </div>
            <div class="adopt-foot">
                <label class="adopt-autolink"><input type="checkbox" id="adopt-autolink" checked>
                    <i class="fas fa-link"></i> ${t('pnl.disc.linkToSeenPort')}</label>
                <button class="toolbar-btn primary" onclick="adoptApply()"><i class="fas fa-plus"></i> ${t('pnl.disc.addSelected')}</button>
            </div>
        </div>`;
        document.body.appendChild(ov);
        ov.addEventListener('mousedown', e => { if(e.target === ov) _closeAdoptModal(); });
    }
    return ov;
}
function _closeAdoptModal(){ const ov = document.getElementById('adopt-overlay'); if(ov) ov.style.display = 'none'; }
function _adoptToggleAll(on){ document.querySelectorAll('#adopt-tbody .adopt-chk').forEach(c => { c.checked = !!on; }); }

function openAdoptModal(filterKey){
    _adoptRows = _adoptCandidates(filterKey);
    _adoptShowModal();
}

// Adozione dei "solo DHCP" di una VLAN dalla card IPAM: candidati costruiti
// DIRETTAMENTE dai lease in cache nella subnet (no Verifica richiesta). Portano
// IP + hostname → il device adottato nasce già documentato (esce dall'ambra).
function openAdoptFromLeases(vid){
    const rows = (typeof _dhcpUndocumentedForVlan === 'function') ? _dhcpUndocumentedForVlan(vid) : [];
    _adoptRows = _adoptBuild(rows);
    _adoptShowModal();
}

function _adoptShowModal(){
    const ov = _adoptEnsureOverlay();
    ov.style.display = 'flex';
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const tbody = document.getElementById('adopt-tbody');
    if(!_adoptRows.length){
        tbody.innerHTML = `<tr><td colspan="6" class="adopt-empty">${t('pnl.disc.adoptEmpty')}</td></tr>`;
        const all = document.getElementById('adopt-all'); if(all) all.checked = false;
        return;
    }
    tbody.innerHTML = _adoptRows.map((c, i) => `<tr class="adopt-row${c.cls === 'endpoint' ? ' is-endpoint' : ''}">
        <td><input type="checkbox" class="adopt-chk" data-idx="${i}" checked></td>
        <td class="adopt-mac">${esc(c.mac)}</td>
        <td>${esc(c.vendor || '—')}</td>
        <td>${c.vlan != null ? esc(c.vlan) : '—'}</td>
        <td class="adopt-seen">${esc(c.seenOn || '—')}</td>
        <td><select class="adopt-type" data-idx="${i}">${_adoptTypeOptions(c.typeDefault)}</select></td>
    </tr>`).join('');
    const all = document.getElementById('adopt-all'); if(all) all.checked = true;
    if(typeof closeReportMenu === 'function') closeReportMenu();
}

// ── Aggiunta ─────────────────────────────────────────────────────────
function adoptApply(){
    const trs = document.querySelectorAll('#adopt-tbody tr');
    const picks = [];
    trs.forEach(tr => {
        const chk = tr.querySelector('.adopt-chk'); if(!chk || !chk.checked) return;
        const idx = parseInt(chk.dataset.idx, 10);
        const cand = _adoptRows[idx]; if(!cand) return;
        const type = tr.querySelector('.adopt-type')?.value || cand.typeDefault;
        picks.push({ cand, type });
    });
    if(!picks.length){ _showToast(t('msg.net.noDeviceSelected'), 'warn'); return; }

    const autoLink = !!document.getElementById('adopt-autolink')?.checked;
    const res = _adoptCreateNodes(picks, autoLink);

    markDirty();
    if(typeof renderAll === 'function') renderAll();
    if(typeof renderCables === 'function') renderCables();
    if(typeof renderProps === 'function') renderProps();   // rinfresca la card IPAM: l'ambra "solo DHCP" cala dopo l'adozione
    _closeAdoptModal();
    _adoptRecomputeDrift();   // le righe adottate spariscono dal Drift (feedback "si vede")

    const parts = [];
    if(res.added) parts.push(`${res.added} aggiunt${res.added === 1 ? 'o' : 'i'}`);
    if(res.autoLinked) parts.push(`${res.autoLinked} collegat${res.autoLinked === 1 ? 'o' : 'i'} auto`);
    if(res.skipped) parts.push(`${res.skipped} già present${res.skipped === 1 ? 'e' : 'i'}`);
    if(typeof _showToast === 'function') _showToast(parts.join(' · ') || t('msg.net.noChanges'), res.added ? 'ok' : 'warn');
}

// Crea i nodi dai pick espliciti (testabile senza DOM). picks = [{cand, type}].
// Ritorna { added, skipped, floorCount, autoLinked }.
function _adoptCreateNodes(picks, autoLink){
    if(!Array.isArray(picks) || !picks.length) return { added:0, skipped:0, floorCount:0, autoLinked:0 };
    pushHistory();

    const usedNodeIds = new Set((store.state.nodes || []).map(n => String(n.id || '')));
    const existingIdx = (typeof _discBuildExistingIndexes === 'function') ? _discBuildExistingIndexes() : null;

    // Placement: rack corrente (creane uno se serve) per gli infra; floor centrato per gli endpoint.
    let rackId = store.state.currentRack;
    const needRack = picks.some(p => !TYPES[p.type]?.isFloor);
    if(needRack && (!rackId || !store.state.racks.find(r => r.id === rackId))){
        rackId = uid('rack');
        store.state.racks.push({ id: rackId, name: 'Rack Discovery', sizeU: 42 });
        store.state.currentRack = rackId;
    }
    const fvp = store.state.floorView || { x: 0, y: 0, zoom: 1 };
    const fpEl = document.getElementById('floorplan');
    const fpW = fpEl ? fpEl.clientWidth : 800, fpH = fpEl ? fpEl.clientHeight : 600;
    const baseX = Math.round((-fvp.x + fpW / 2) / (fvp.zoom || 1));
    const baseY = Math.round((-fvp.y + fpH / 2) / (fvp.zoom || 1));

    let added = 0, skipped = 0, floorCount = 0, autoLinked = 0;
    const newEndpoints = [];

    picks.forEach(({ cand, type }) => {
        const def = TYPES[type]; if(!def) return;
        const macN = (typeof normalizeMacAddress === 'function') ? normalizeMacAddress(cand.mac || '') : (cand.mac || '');
        // Dedup: se il MAC è già documentato, non duplicare.
        if(existingIdx){
            const match = _discFindExistingDevice({ mac: macN }, existingIdx);
            if(match && match.node){ skipped++; return; }
        }
        const name = cand.hostname || cand.vendor || macN || def.name;   // il nome dal lease (se c'è) vince
        const nid = (typeof _nextNodeId === 'function') ? _nextNodeId(type, usedNodeIds) : uid(type);
        let n;
        if(def.isFloor){
            const col = floorCount % 5, row = Math.floor(floorCount / 5);
            n = {
                id: nid, type, name, hostname: cand.hostname || '', ip: cand.ip || '', mac: macN,
                brand: cand.vendor || def.brand || '', vendorHint: cand.vendor || '',
                identitySource: 'fdb', identityConfidence: 'low',
                x: baseX - 200 + col * 120, y: baseY - 100 + row * 120,
                ports: def.ports || 1,
            };
            floorCount++;
        } else {
            const sU = def.sizeU || 1;
            const rackU = (typeof _findFreeU === 'function') ? _findFreeU(rackId, sU) : 1;
            n = {
                id: nid, type, name, hostname: cand.hostname || '', ip: cand.ip || '', mac: macN,
                brand: cand.vendor || def.brand || '', vendorHint: cand.vendor || '',
                identitySource: 'fdb', identityConfidence: 'low',
                rackId, rackU, sizeU: sU, ports: def.ports || 0,
            };
        }
        store.state.nodes.push(n);
        if(existingIdx && typeof _discIndexNode === 'function') _discIndexNode(existingIdx, n);
        if(typeof _isLeafEndpoint === 'function' && _isLeafEndpoint(type)) newEndpoints.push(n);
        added++;
    });

    if(typeof _invalidateIdx === 'function') _invalidateIdx();

    // Auto-link alla porta FDB (riusa la logica testata; salta trunk/uplink/ambigui).
    if(autoLink && typeof _autoLinkEndpoint === 'function'){
        for(const ep of newEndpoints){ try { if(_autoLinkEndpoint(ep.id).ok) autoLinked++; } catch(_){} }
    }
    return { added, skipped, floorCount, autoLinked };
}

// Ricalcola il Drift SENZA re-polling (usa la snapshot SNMP già in cache): i
// device appena adottati diventano "documentati" → escono dai non documentati.
function _adoptRecomputeDrift(){
    if(typeof store._driftReport === 'undefined' || !store._driftReport) return;
    if(typeof _driftBuildDocSnapshot !== 'function' || typeof _driftBuildSnmpSnapshot !== 'function' || typeof win.buildDriftReport !== 'function') return;
    try {
        const docSnap = _driftBuildDocSnapshot();
        const snmpSnap = _driftBuildSnmpSnapshot(docSnap);
        if(!Array.isArray(store.state.driftIgnores)) store.state.driftIgnores = [];
        store._driftReport = win.buildDriftReport(snmpSnap, docSnap, store.state.driftIgnores, {
            downStreakN: (typeof win.DRIFT_DOWN_STREAK_N !== 'undefined') ? win.DRIFT_DOWN_STREAK_N : 3,
            guestVlans: store.state.guestVlans || [],
            mgmtVlans: store.state.mgmtVlans || [],
            endpointPortThreshold: 5,
        });
        if(typeof _renderDriftReport === 'function') _renderDriftReport();
    } catch(_){}
}

// Superficie pubblica: openAdoptModal (chiamato da app-drift.js) + handler inline
// onclick/onchange (_closeAdoptModal, _adoptToggleAll, adoptApply) + le funzioni
// "testabili" esercitate dall'E2E (_adoptCandidates, _adoptCreateNodes).
expose({
    openAdoptModal, openAdoptFromLeases, adoptApply, _closeAdoptModal, _adoptToggleAll,
    _adoptCandidates, _adoptCreateNodes,
});
