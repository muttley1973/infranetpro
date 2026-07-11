// ============================================================
// TOPOLOGY CRAWL FRONTEND (scoperta LLDP/CDP + import risultati)
// ============================================================
// MODULO ESM (migrato da lib/app-topology-crawl.js): dialog di crawl topologico.
// Legge i global legacy via win.* (state, escapeHTML, TYPES, _showToast, _guessType
// e gli helper _disc* di app-discovery-classify, uid/_nextNodeId/normalizeMacAddress,
// markDirty/renderAll/renderCables/switchRack/pushHistory/normalizeNumber). NON usa
// i18n (ha un `const t` locale). Stato modulo _tdResults/_tdAbort privato. I nomi
// negli onclick="" della netmapper.html (runTopoCrawl/closeTopoCrawl/…) sono esposti.
// _findFreeU/_resolveRackOverlap sono utility rack CONDIVISE (csv-import, discovery,
// shared-segment, pointer, app-drift-adopt) → esposte. Nessun cambiamento di logica.
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, uid, normalizeNumber, normalizeMacAddress } from './app-util.js';
import { markDirty, pushHistory, renderCables, _showToast, _nextNodeId } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES, typeName } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES) + nome localizzato
import { switchRack } from './app-search-zoom-rack.js';   // ritiro ponte: funzioni rack/zoom/search (ex win.*)
import { _discIndexNode, _discFindExistingDevice } from './app-discovery-classify.js';   // ritiro ponte: funzioni topo/discovery/vlan/snmp (ex win.*)

// ============================================================
// TOPOLOGY CRAWL FRONTEND
// UI per scoperta topologica via LLDP/CDP e import risultati.
// ============================================================

let _tdResults = [];
let _tdAbort   = null;

function openTopoCrawl(){
    const sample = store.state.nodes.find(n=>n.integration?.driver?.startsWith('snmp'));
    if(sample){
        const cfg = sample.integration;
        document.getElementById('td-driver').value    = cfg.driver==='snmp-v1' ? 'snmp-v2c' : (cfg.driver || 'snmp-v2c');
        document.getElementById('td-community').value = cfg.community || 'public';
    }
    const log = document.getElementById('td-log');
    log.innerHTML = '';
    log.style.display = 'none';
    document.getElementById('td-results').style.display = 'none';
    document.getElementById('td-scan-btn').style.display = '';
    document.getElementById('td-import-btn').style.display = 'none';
    _tdResults = [];
    document.getElementById('topodisc-overlay').classList.add('open');
}

function closeTopoCrawl(){
    document.getElementById('topodisc-overlay').classList.remove('open');
    if(_tdAbort){
        _tdAbort.abort();
        _tdAbort = null;
    }
}

// Wrapper chiamato dal click sull'overlay scuro (sfondo del modal).
// Se c'e' un crawl in corso, NON chiude e non aborta. Per interrompere
// esplicitamente serve usare il bottone "Chiudi" o la X.
function _closeTopoCrawlOverlayClick(){
    if(_tdAbort){
        if(typeof _showToast === 'function'){
            _showToast(t('msg.net.crawlInProgress'), 'warn', 3500);
        }
        return;
    }
    closeTopoCrawl();
}

function _tdLog(cls, html){
    const log = document.getElementById('td-log');
    log.style.display = '';
    const div = document.createElement('div');
    div.className = cls;
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

async function runTopoCrawl(){
    const seed = document.getElementById('td-seed').value.trim();
    const driver = document.getElementById('td-driver').value;
    const community = document.getElementById('td-community').value.trim();
    const maxDepth = parseInt(document.getElementById('td-depth').value, 10) || 5;
    const timeout = parseInt(document.getElementById('td-timeout').value, 10) || 3;

    if(!seed){
        _tdLog('td-log-warn', t('pnl.disc.enterSeedIp'));
        return;
    }

    const btn = document.getElementById('td-scan-btn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${t('pnl.disc.discovering')}`;

    const log = document.getElementById('td-log');
    log.innerHTML = '';
    log.style.display = '';
    document.getElementById('td-results').style.display = 'none';
    document.getElementById('td-import-btn').style.display = 'none';
    _tdResults = [];

    _tdAbort = new AbortController();
    try{
        const resp = await fetch('/api/discover/topology', {
            method:'POST',
            headers:{ 'Content-Type':'application/json' },
            body: JSON.stringify({ seed, driver, community, maxDepth, timeout }),
            signal: _tdAbort.signal,
        });
        if(!resp.ok || !resp.headers.get('content-type')?.includes('text/event-stream')){
            const err = await resp.json().catch(()=>({ error:t('pnl.disc.invalidResponse') }));
            _tdLog('td-log-warn', t('pnl.disc.errorPrefix') + escapeHTML(err.error || t('pnl.disc.unknown')));
            return;
        }

        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = '';

        while(true){
            const { done, value } = await reader.read();
            if(done) break;
            buf += dec.decode(value, { stream:true });
            const lines = buf.split('\n');
            buf = lines.pop();
            for(const line of lines){
                if(line.startsWith('data: ')){
                    try{
                        _tdHandleEvent(JSON.parse(line.slice(6)));
                    }catch(_){}
                }
            }
        }
    }catch(e){
        if(e.name !== 'AbortError'){
            _tdLog('td-log-warn', t('pnl.disc.errorPrefix') + escapeHTML(e.message));
        }
    }finally{
        _tdAbort = null;
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-satellite-dish"></i> ${t('pnl.disc.discoverNetwork')}`;
    }
}

function _tdHandleEvent(data){
    switch(data.type){
        case 'start':
            _tdLog('td-log-info', '▶ ' + t('pnl.disc.startFrom',{seed:`<b>${escapeHTML(data.seed)}</b>`}));
            break;
        case 'probing':
            _tdLog(
                'td-log-miss',
                '  ⟳ ' + escapeHTML(data.ip) +
                ` <span style="color:#555">${t('pnl.disc.probingMeta',{depth:data.depth,queued:data.queued,found:data.found})}</span>`
            );
            break;
        case 'found':
            _tdResults.push(data.device);
            _tdLog(
                'td-log-ok',
                '  ✓ <b>' + escapeHTML(data.device.ip) + '</b>' +
                (data.device.hostname ? ' — ' + escapeHTML(data.device.hostname) : '') +
                ' <span style="color:#555">[' + data.total + ']</span>'
            );
            break;
        case 'miss':
            _tdLog(
                'td-log-miss',
                '  ✗ ' + escapeHTML(data.ip) +
                ' <span style="color:#555">' + escapeHTML(data.error || '') + '</span>'
            );
            break;
        case 'queued':
            _tdLog(
                'td-log-miss',
                '    → ' + escapeHTML(data.neighbor) +
                ' (' + escapeHTML(data.protocol || '') +
                ' via ' + escapeHTML(data.port || '') +
                (data.name ? ' · ' + escapeHTML(data.name) : '') + ')'
            );
            break;
        case 'dup':
            _tdLog('td-log-dup', '  ≈ ' + t('pnl.disc.dupKnownAs',{ip:escapeHTML(data.ip),name:escapeHTML(data.name)}));
            break;
        case 'skip':
            _tdLog('td-log-miss', '  ⤷ ' + escapeHTML(data.ip) + ' — ' + t('pnl.disc.maxDepth'));
            break;
        case 'warn':
            _tdLog('td-log-warn', '  ⚠ ' + escapeHTML(data.ip) + ': ' + escapeHTML(data.message));
            break;
        case 'done':
            _tdLog('td-log-info', '■ ' + t('pnl.disc.crawlDone',{n:`<b>${data.total}</b>`}));
            if(data.total > 0) _tdShowResults();
            break;
    }
}

function _tdShowResults(){
    const tbody = document.getElementById('td-tbody');
    tbody.innerHTML = _tdResults.map((d, i)=>{
        const t = win._guessType(d.descr, d.objectId);
        const opts = Object.entries(TYPES)
            .filter(([,v])=>v.isActive || v.hasIP)
            .map(([k])=>`<option value="${k}"${k===t ? ' selected' : ''}>${escapeHTML(typeName(k))}</option>`)
            .join('');
        return `<tr>
          <td><input type="checkbox" class="td-chk" data-idx="${i}" checked></td>
          <td>${escapeHTML(d.ip)}</td>
          <td>${escapeHTML(d.hostname || '—')}</td>
          <td><select class="disc-type td-type" data-idx="${i}">${opts}</select></td>
          <td class="disc-descr" data-tip="${escapeHTML(d.descr || '')}">${escapeHTML((d.descr || '—').substring(0,55))}</td>
          <td style="text-align:center;color:var(--text-muted)">${d.depth}</td>
        </tr>`;
    }).join('');
    document.getElementById('td-summary').textContent = t('pnl.disc.devicesFound',{n:_tdResults.length});
    document.getElementById('td-selall').checked = true;
    document.getElementById('td-results').style.display = '';
    document.getElementById('td-import-btn').style.display = '';
}

function tdSelectAll(val){
    document.querySelectorAll('.td-chk').forEach(cb=>cb.checked = val);
}

function importTopoCrawl(){
    const rows = document.querySelectorAll('#td-tbody tr');
    if(!rows.length) return;
    const toImport = [];
    rows.forEach(tr=>{
        const chk = tr.querySelector('.td-chk');
        if(!chk?.checked) return;
        const idx = parseInt(chk.dataset.idx, 10);
        const type = tr.querySelector('.td-type')?.value || 'switch';
        toImport.push({ ...(_tdResults[idx] || {}), type });
    });
    if(!toImport.length){
        _showToast(t('msg.net.noDeviceSelected'), 'warn');
        return;
    }

    pushHistory();
    const driver = document.getElementById('td-driver')?.value || 'snmp-v2c';
    const community = document.getElementById('td-community')?.value || 'public';
    const usedNodeIds = new Set((store.state.nodes || []).map(n=>String(n.id || '')));

    let rackId = store.state.currentRack;
    if(!rackId || !store.state.racks.find(r=>r.id===rackId)){
        rackId = uid('rack');
        store.state.racks.push({ id:rackId, name:'Rack Topology', sizeU:42 });
        store.state.currentRack = rackId;
    }

    const existingIdx = win._discBuildExistingIndexes();

    let imported = 0;
    let updated = 0;
    let floorCount = 0;
    let conflicts = 0;
    const fvp = store.state.floorView || { x:0, y:0, zoom:1 };
    const fpEl = document.getElementById('floorplan');
    const fpW = fpEl ? fpEl.clientWidth : 800;
    const fpH = fpEl ? fpEl.clientHeight : 600;
    const baseX = Math.round((-fvp.x + fpW / 2) / (fvp.zoom || 1));
    const baseY = Math.round((-fvp.y + fpH / 2) / (fvp.zoom || 1));

    toImport.forEach(d=>{
        const def = TYPES[d.type];
        if(!def) return;
        const match = _discFindExistingDevice(d, existingIdx);
        if(match.conflict?.existing){
            win._discMarkIpMacConflict(match.conflict.existing, d);
            conflicts++;
        }
        const existing = match.node;
        if(existing){
            win._discTouchNodeIdentity(existing, d, match.matchedBy);
            existing.hostname = existing.hostname || d.hostname || '';
            existing.mac = existing.mac || normalizeMacAddress(d.mac || '');
            if(!existing.name || existing.name === existing.type) existing.name = d.hostname || d.ip || existing.name;
            if(!existing.integration) existing.integration = {};
            const hasDriverChoice = Object.prototype.hasOwnProperty.call(existing.integration, 'driver');
            if(!hasDriverChoice || existing.integration.driver == null){
                existing.integration.driver = driver;
            }
            existing.integration.host = existing.integration.host || d.ip || '';
            existing.integration.community = existing.integration.community || community;
            _discIndexNode(existingIdx, existing);
            updated++;
            return;
        }
        const integration = { driver, host:d.ip || '', community };
        let n;
        if(def.isFloor){
            const col = floorCount % 5;
            const row = Math.floor(floorCount / 5);
            n = {
                id: _nextNodeId(d.type, usedNodeIds),
                type: d.type,
                name: d.hostname || d.ip || d.type,
                hostname: d.hostname || '',
                ip: d.ip || '',
                mac: normalizeMacAddress(d.mac || ''),
                x: baseX - 200 + col * 120,
                y: baseY - 100 + row * 120,
                ports: def.ports || 1,
                integration,
            };
            floorCount++;
        } else {
            const sU = def.sizeU || 1;
            const rackU = _findFreeU(rackId, sU);
            n = {
                id: _nextNodeId(d.type, usedNodeIds),
                type: d.type,
                name: d.hostname || d.ip || d.type,
                hostname: d.hostname || '',
                ip: d.ip || '',
                mac: normalizeMacAddress(d.mac || ''),
                rackId,
                rackU,
                sizeU: sU,
                ports: def.ports || 0,
                integration,
            };
        }
        win._discTouchNodeIdentity(n, d, match.matchedBy || 'new');
        if(match.conflict?.existing){
            n.discoveryConflicts = [{
                type:'ip-mac',
                ip:d.ip || '',
                existingNodeId:match.conflict.existing.id || '',
                existingMac:match.conflict.oldMac || '',
                seenMac:normalizeMacAddress(d.mac || ''),
                ts:new Date().toISOString(),
            }];
        }
        store.state.nodes.push(n);
        _discIndexNode(existingIdx, n);
        imported++;
    });

    markDirty();
    renderAll();
    renderCables();
    closeTopoCrawl();
    if(imported - floorCount > 0) switchRack(rackId);
    const parts = [];
    if(imported - floorCount > 0) parts.push(`${imported - floorCount} in rack`);
    if(floorCount > 0) parts.push(`${floorCount} in planimetria`);
    if(updated > 0) parts.push(`${updated} aggiornati`);
    if(conflicts > 0) parts.push(`${conflicts} conflitti IP/MAC`);
    _showToast(parts.join(' · ') || t('msg.net.noChanges'), imported || updated ? 'ok' : 'warn');
}

export function _findFreeU(rackId, sizeU){
    const rack = store.state.racks.find(r=>r.id===rackId);
    if(!rack) return 1;
    const rs = rack.sizeU || 42;
    const occ = new Set();
    store.state.nodes.filter(n=>n.rackId===rackId).forEach(n=>{
        const s = n.sizeU !== undefined ? n.sizeU : (TYPES[n.type]?.sizeU || 1);
        for(let u = n.rackU; u < n.rackU + s; u++) occ.add(u);
    });
    for(let u = rs - sizeU + 1; u >= 1; u--){
        let fits = true;
        for(let i = 0; i < sizeU; i++){
            if(occ.has(u + i)){
                fits = false;
                break;
            }
        }
        if(fits) return u;
    }
    return 1;
}

function _resolveRackOverlap(node){
    if(!node || !TYPES[node.type]?.isRack || !node.rackId) return;
    const rack = store.state.racks.find(r=>r.id===node.rackId);
    if(!rack) return;
    const rs = rack.sizeU || 42;
    const sU = node.sizeU !== undefined ? node.sizeU : (TYPES[node.type]?.sizeU || 1);
    const occ = new Set();
    for(const o of store.state.nodes){
        if(o === node || o.rackId !== node.rackId || !TYPES[o.type]?.isRack) continue;
        const os = o.sizeU !== undefined ? o.sizeU : (TYPES[o.type]?.sizeU || 1);
        for(let u = o.rackU; u < o.rackU + os; u++) occ.add(u);
    }
    const fits = (base)=>{
        if(base < 1 || base + sU - 1 > rs) return false;
        for(let i = 0; i < sU; i++){
            if(occ.has(base + i)) return false;
        }
        return true;
    };
    const start = normalizeNumber(node.rackU, 1, 1, Math.max(1, rs - sU + 1));
    if(fits(start)){
        node.rackU = start;
        return;
    }
    for(let d = 1; d <= rs; d++){
        if(fits(start - d)){
            node.rackU = start - d;
            return;
        }
        if(fits(start + d)){
            node.rackU = start + d;
            return;
        }
    }
}

// Handler inline (netmapper.html) + utility rack condivise da altri file.
expose({
    openTopoCrawl, closeTopoCrawl, _closeTopoCrawlOverlayClick, runTopoCrawl,
    tdSelectAll, importTopoCrawl, _findFreeU, _resolveRackOverlap,
});
