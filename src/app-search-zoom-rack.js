// ============================================================
// SEARCH, ZOOM & RACK UI FRONTEND
// Ricerca globale, zoom/pan, divider ridimensionabili,
// palette sidebar, menu rack/floor, gestione rack e import mappa.
// Estratto da app.js — migrato a modulo ESM (src/).
// I globali legacy si leggono via win.*; t (i18n) dal ponte.
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, uid, hexToRgba, normalizeStatus, normalizeNumber } from './app-util.js';
import { nodeById, markDirty, getNodeByPortId, getPortNodeId, getNodeDisplayName, pushHistory, renderCables, _showToast } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { showAlert } from './app-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderProps } from './app-properties.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES, typeName } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES) + nome localizzato

// Stato ricerca: module-local (prima era `let` in app.js, usato SOLO qui).
let searchResults = [], activeSearchIndex = -1;

// ---- Helper search ----------------------------------------------------------

function getSearchIcon(kind,type='') {
    if(kind==='port') return 'fa-ethernet';
    if(kind==='link') return 'fa-link';
    return TYPES[type]?.icon||(TYPES[type]?.isRack?'fa-server':'fa-cube');
}
function getPortSummary(pid) {
    const p=store.state.ports[pid]||{}, n=getNodeByPortId(pid);
    const parts=[getNodeDisplayName(n),pid,`status:${normalizeStatus(p.status)}`,
                 `vlan:${p.vlan||1}`,`speed:${p.speed||'1G'}`,`connections:${win.getPortConnectionCount(pid)}`];
    if(n?.rackId) parts.push(`rack:${win.getRackName(n.rackId)}`);
    return parts.join(' ');
}

// ============================================================
// SEARCH
// ============================================================
function buildSearchResults(query) {
    const q=query.trim().toLowerCase();
    if(q.length<2) return [];
    const results=[];

    store.state.nodes.forEach(node=>{
        const view = typeof win._nodeSpecView==='function' ? win._nodeSpecView(node) : node;
        const def=TYPES[node.type]; if(!def) return;
        const hay=[view.id,view.name,def.name,typeName(node.type),view.type,view.hostname,view.brand,view.model,view.ip,view.mac,
                   view.assignedUser,
                   view.rackId,win.getRackName(view.rackId),view.notes]
                  .filter(Boolean).join(' ').toLowerCase();
        if(hay.includes(q)){
            const loc=def.isRack?`${win.getRackName(node.rackId)} - U${node.rackU||'?'}`
                                 :`Floor ${Math.round(node.x||0)}, ${Math.round(node.y||0)}`;
            const userTag = view.assignedUser ? ` - 👤 ${view.assignedUser}` : '';
            results.push({kind:'device',id:node.id,icon:getSearchIcon('device',node.type),
                title:`${getNodeDisplayName(node)} (${typeName(node.type)})`,
                meta:`${loc} - ${win.getNodePortCount(node)} porte${userTag}`});
        }
        const pCount=win.getNodePortCount(node);
        for(let i=1;i<=pCount;i++){
            const pid=`${node.id}-${i}`;
            if(getPortSummary(pid).toLowerCase().includes(q))
                results.push({kind:'port',id:pid,icon:getSearchIcon('port'),
                    title:`${getNodeDisplayName(node)} - Porta ${i}`,
                    meta:`ID ${pid} - VLAN ${(store.state.ports[pid]||{}).vlan||1} - ${win.getPortConnectionCount(pid)} conn.`});
        }
    });

    store.state.links.forEach(link=>{
        const sn=getNodeByPortId(link.src), dn=getNodeByPortId(link.dst);
        const hay=[link.id,link.src,link.dst,getNodeDisplayName(sn),getNodeDisplayName(dn),
                   win.getRackName(sn?.rackId),win.getRackName(dn?.rackId),
                   `vlan:${(store.state.ports[link.src]||{}).vlan||1}`].filter(Boolean).join(' ').toLowerCase();
        if(hay.includes(q))
            results.push({kind:'link',id:link.id,icon:getSearchIcon('link'),
                title:`${link.src} → ${link.dst}`,
                meta:`${getNodeDisplayName(sn)} → ${getNodeDisplayName(dn)} - VLAN ${(store.state.ports[link.src]||{}).vlan||1}`});
    });
    return results.slice(0,40);
}

function handleSearchInput(v) {
    searchResults=buildSearchResults(v); activeSearchIndex=searchResults.length?0:-1;
    renderSearchResults(v);
}
function handleSearchKey(e) {
    if(e.key==='Escape'){clearSearch();return;}
    if(!searchResults.length) return;
    if(e.key==='ArrowDown'){e.preventDefault();activeSearchIndex=(activeSearchIndex+1)%searchResults.length;renderSearchResults(document.getElementById('global-search').value);}
    if(e.key==='ArrowUp')  {e.preventDefault();activeSearchIndex=(activeSearchIndex-1+searchResults.length)%searchResults.length;renderSearchResults(document.getElementById('global-search').value);}
    if(e.key==='Enter'&&activeSearchIndex>=0){e.preventDefault();selectSearchResult(activeSearchIndex);}
}
function renderSearchResults(query) {
    const panel=document.getElementById('search-results'), clearBtn=document.getElementById('global-search-clear');
    clearBtn.style.display=query?'block':'none';
    if(!query||query.trim().length<2){panel.style.display='none';panel.innerHTML='';return;}
    panel.style.display='block';
    if(!searchResults.length){panel.innerHTML=`<div class="search-empty">${t('pnl.sys.noResults')}</div>`;return;}
    panel.innerHTML=searchResults.map((r,i)=>`
        <button class="search-result ${i===activeSearchIndex?'active':''}" onclick="selectSearchResult(${i})">
            <i class="fas ${escapeHTML(r.icon)}"></i>
            <span><span class="search-title">${escapeHTML(r.title)}</span><br><span class="search-meta">${escapeHTML(r.meta)}</span></span>
            <span class="search-kind">${escapeHTML(r.kind)}</span>
        </button>`).join('');
}
function clearSearch() {
    document.getElementById('global-search').value=''; searchResults=[]; activeSearchIndex=-1;
    document.getElementById('global-search-clear').style.display='none';
    document.getElementById('search-results').style.display='none';
    document.getElementById('search-results').innerHTML='';
}
function selectSearchResult(index) {
    const r=searchResults[index]; if(!r) return;
    clearSearch(); store.highPath.clear();
    if(r.kind==='device'){
        const n=nodeById(r.id); if(!n) return;
        selectAndFocusNode(n);
    } else if(r.kind==='port'){
        const n=getNodeByPortId(r.id); if(!n) return;
        ensureNodeRackVisible(n); store.selType='port'; store.selId=r.id;
        win.trace(r.id); renderAll(); focusNode(n);
    } else if(r.kind==='link'){
        const link=store.state.links.find(l=>l.id===r.id); if(!link) return;
        const sn=getNodeByPortId(link.src), dn=getNodeByPortId(link.dst);
        const rn=TYPES[sn?.type]?.isRack?sn:(TYPES[dn?.type]?.isRack?dn:null);
        ensureNodeRackVisible(rn); store.highPath.add(link.id); store.selType=null; store.selId=null;
        renderAll(); focusNode(rn||sn||dn);
    }
}
function ensureNodeRackVisible(n){
    if(n&&TYPES[n.type]?.isRack&&n.rackId&&n.rackId!==store.state.currentRack){
        store.state.currentRack=n.rackId; renderRackTabs();
    }
}
function selectAndFocusNode(n){ensureNodeRackVisible(n);store.selType='node';store.selId=n.id;renderAll();focusNode(n);}
function focusNode(n){
    if(!n) return;
    const def=TYPES[n.type];
    if(def?.isFloor){
        const fp=document.getElementById('floorplan').getBoundingClientRect();
        const tx=n.x+(def.isStructural?(n.w||200)/2:0), ty=n.y+(def.isStructural?(n.h||200)/2:0);
        store.state.floorView.x=fp.width/2-tx*store.state.floorView.zoom;
        store.state.floorView.y=fp.height/2-ty*store.state.floorView.zoom;
        updateTransforms();
    } else if(def?.isRack){
        const sU=n.sizeU!==undefined?n.sizeU:def.sizeU||1, rs=win.getNodeRackSize(n);
        const _U=(typeof win.rackUPx==='function')?win.rackUPx():24;
        // Pan via translate (lo zoom è transform:scale): porta il device a ~120px
        // dall'alto del viewport. Vedi updateTransforms / handlePointerMove.
        store.state.rackView.x=0;
        store.state.rackView.y=120-(rs-(n.rackU||1)-sU+1)*_U*store.state.rackView.zoom;
        updateTransforms();
    }
}

// ============================================================
// ZOOM & PAN
// ============================================================
function updateTransforms(){
    document.getElementById('floor-canvas').style.transform=`translate(${store.state.floorView.x}px,${store.state.floorView.y}px) scale(${store.state.floorView.zoom})`;
    document.getElementById('floor-zoom-lbl').innerText=Math.round(store.state.floorView.zoom*100)+'%';
    document.getElementById('rack-chassis-wrap').style.transform=`translate(${store.state.rackView.x||0}px,${store.state.rackView.y||0}px) scale(${store.state.rackView.zoom})`;
    document.getElementById('rack-zoom-lbl').innerText=Math.round(store.state.rackView.zoom*100)+'%';
    applyUiColors(); renderCables();
    // #rack-chassis-wrap ha transition:transform .1s in CSS (animazione zoom),
    // quindi le coordinate dei LED rack restano in movimento per ~100ms.
    // Il primo renderCables() ha disegnato i cavi alle coordinate iniziali
    // (sbagliate); rifa il render a transizione conclusa per riallineare i
    // cavi alle nuove posizioni dei LED. Coalescing in renderCables: se nel
    // frattempo c'e' gia' un rAF schedulato, questo non duplica.
    setTimeout(renderCables, 140);
}
function applyUiColors(){
    const c=store.state.uiColors||{};
    document.getElementById('floorplan').style.backgroundColor   = c.floorBg||'#0d1117';
    document.getElementById('rack-viewport').style.backgroundColor = c.rackBg||'#ffffff';
}
function zoomFloor(delta,ex=null,ey=null){
    const old=store.state.floorView.zoom;
    store.state.floorView.zoom=Math.max(0.05,Math.min(5,old+delta));
    const fp=document.getElementById('floorplan').getBoundingClientRect();
    if(ex!==null){
        const mx=ex-fp.left,my=ey-fp.top;
        store.state.floorView.x=mx-(mx-store.state.floorView.x)/old*store.state.floorView.zoom;
        store.state.floorView.y=my-(my-store.state.floorView.y)/old*store.state.floorView.zoom;
    } else {
        const cx=fp.width/2,cy=fp.height/2;
        store.state.floorView.x=cx-(cx-store.state.floorView.x)/old*store.state.floorView.zoom;
        store.state.floorView.y=cy-(cy-store.state.floorView.y)/old*store.state.floorView.zoom;
    }
    updateTransforms(); markDirty();
}
function zoomRack(delta){
    store.state.rackView.zoom=Math.max(0.3,Math.min(5,store.state.rackView.zoom+delta));
    updateTransforms(); markDirty();
}
function handleFloorZoom(e){e.preventDefault();zoomFloor(e.deltaY>0?-0.1:0.1,e.clientX,e.clientY);}
function handleRackZoom(e){e.preventDefault();zoomRack(e.deltaY>0?-0.1:0.1);}

// ---- Resize/collapse divider floor ↔ rack (orizzontale) --------------------
// _rackCollapsed deve stare su window: lo leggono BARE (anche senza typeof-guard,
// es. app-render-core renderFloor dblclick) file ancora-legacy + app.js. Tenerlo
// module-local `let` lo nasconderebbe nell'IIFE del bundle → ReferenceError.
store._rackCollapsed = store._rackCollapsed || false;

function toggleRackPanel(){
    const rv = document.getElementById('rack-view');
    const ic = document.getElementById('rack-collapse-icon');
    const dv = document.getElementById('floor-rack-divider');
    store._rackCollapsed = !store._rackCollapsed;
    rv.classList.toggle('collapsed', store._rackCollapsed);
    if(ic) ic.className = store._rackCollapsed ? 'fas fa-chevron-left' : 'fas fa-chevron-right';
    if(dv) dv.title = store._rackCollapsed ? 'Clic per mostrare rack' : 'Trascina per ridimensionare · Clic per nascondere rack';
    setTimeout(renderCables, 280); // dopo la transizione CSS
}

(function(){
    const divider = ()=>document.getElementById('floor-rack-divider');
    const rackView = ()=>document.getElementById('rack-view');
    let _dragging=false, _startX=0, _startW=0;

    document.addEventListener('mousedown', e=>{
        const d=divider();
        if(!d) return;
        const onDivider = e.target===d || (d.contains(e.target) && !e.target.closest('#rack-collapse-btn'));
        if(!onDivider) return;
        _dragging=true;
        _startX=e.clientX;
        _startW=rackView().getBoundingClientRect().width;
        d.classList.add('dragging');
        document.body.style.cursor='ew-resize';
        document.body.style.userSelect='none';
    });
    document.addEventListener('mousemove', e=>{
        if(!_dragging) return;
        const delta=_startX-e.clientX; // positivo → rack si allarga
        const newW=Math.min(Math.max(_startW+delta, 260), window.innerWidth*0.65);
        const rv=rackView();
        rv.style.width=newW+'px';
        rv.style.minWidth=newW+'px';
        renderCables();
    });
    document.addEventListener('mouseup', ()=>{
        if(!_dragging) return;
        _dragging=false;
        const d=divider();
        if(d) d.classList.remove('dragging');
        document.body.style.cursor='';
        document.body.style.userSelect='';
    });
}());

// ---- Resize/collapse divider sidebar sx ↔ floor (orizzontale) ---------------
let _sidebarCollapsed = false;

function toggleSidebarPanel(){
    const sb = document.getElementById('sidebar-left');
    const ic = document.getElementById('sidebar-collapse-icon');
    const dv = document.getElementById('sidebar-divider');
    _sidebarCollapsed = !_sidebarCollapsed;
    sb.classList.toggle('collapsed', _sidebarCollapsed);
    if(ic) ic.className = _sidebarCollapsed ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
    if(dv) dv.title = _sidebarCollapsed ? 'Clic per mostrare palette' : 'Trascina per ridimensionare · Clic per nascondere palette';
    setTimeout(renderCables, 280);
}

(function(){
    const divider = ()=>document.getElementById('sidebar-divider');
    const sidebar = ()=>document.getElementById('sidebar-left');
    let _dragging=false, _startX=0, _startW=0;

    document.addEventListener('mousedown', e=>{
        const d=divider();
        if(!d) return;
        const onDivider = e.target===d || (d.contains(e.target) && !e.target.closest('#sidebar-collapse-btn'));
        if(!onDivider) return;
        _dragging=true;
        _startX=e.clientX;
        _startW=sidebar().getBoundingClientRect().width;
        d.classList.add('dragging');
        document.body.style.cursor='ew-resize';
        document.body.style.userSelect='none';
    });
    document.addEventListener('mousemove', e=>{
        if(!_dragging) return;
        const delta=e.clientX-_startX; // positivo → sidebar si allarga
        const newW=Math.min(Math.max(_startW+delta, 180), window.innerWidth*0.45);
        const sb=sidebar();
        sb.style.width=newW+'px';
        sb.style.minWidth=newW+'px';
        renderCables();
    });
    document.addEventListener('mouseup', ()=>{
        if(!_dragging) return;
        _dragging=false;
        const d=divider();
        if(d) d.classList.remove('dragging');
        document.body.style.cursor='';
        document.body.style.userSelect='';
    });
}());

// ============================================================
// PALETTE UI
// ============================================================
const _PALETTE_GROUPS_PREF_KEY='infranet.palette.groups.v1';
const _PALETTE_GROUPS_DEFAULT={
    ambienti:true,
    floor_net:true,
    floor_endpoints:true,
    rack_passive:true,
    rack_active:true
};
let _paletteGroups={..._PALETTE_GROUPS_DEFAULT};

function _loadPaletteGroupPrefs(){
    try{
        const raw=localStorage.getItem(_PALETTE_GROUPS_PREF_KEY);
        if(!raw) return;
        const parsed=JSON.parse(raw);
        if(parsed && typeof parsed==='object'){
            _paletteGroups={..._PALETTE_GROUPS_DEFAULT,...parsed};
        }
    }catch(_){}
}

function _savePaletteGroupPrefs(){
    try{ localStorage.setItem(_PALETTE_GROUPS_PREF_KEY, JSON.stringify(_paletteGroups)); }catch(_){}
}

function _syncPaletteGroupUi(){
    document.querySelectorAll('#sidebar-left .palette-group').forEach(group=>{
        const key=group.dataset.paletteGroup;
        const open=_paletteGroups[key]!==false;
        group.classList.toggle('collapsed', !open);
        const head=group.querySelector('.palette-group-head');
        if(head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
}

function togglePaletteGroup(groupKey){
    _paletteGroups[groupKey]=!(_paletteGroups[groupKey]!==false);
    _savePaletteGroupPrefs();
    _syncPaletteGroupUi();
}

function setPaletteGroupsExpanded(expanded){
    document.querySelectorAll('#sidebar-left .palette-group').forEach(group=>{
        _paletteGroups[group.dataset.paletteGroup]=!!expanded;
    });
    _savePaletteGroupPrefs();
    _syncPaletteGroupUi();
}

function filterPaletteItems(raw){
    const q=String(raw||'').trim().toLowerCase();
    document.querySelectorAll('#sidebar-left .equip-item').forEach(item=>{
        const txt=(item.textContent||'').trim().toLowerCase();
        const show=!q || txt.includes(q);
        item.style.display=show ? '' : 'none';
    });
    document.querySelectorAll('#sidebar-left .palette-group').forEach(group=>{
        const hasVisible=[...group.querySelectorAll('.equip-item')]
            .some(item=>item.style.display!=='none');
        group.classList.toggle('empty', !hasVisible);
        if(!q) return;
        group.classList.toggle('collapsed', !hasVisible);
        const head=group.querySelector('.palette-group-head');
        if(head) head.setAttribute('aria-expanded', hasVisible ? 'true' : 'false');
    });
    if(!q) _syncPaletteGroupUi();
    const clearBtn=document.getElementById('palette-search-clear');
    if(clearBtn) clearBtn.style.visibility=q ? 'visible' : 'hidden';
}

function clearPaletteFilter(){
    const input=document.getElementById('palette-search');
    if(input){ input.value=''; input.focus(); }
    filterPaletteItems('');
}

function initPaletteUi(){
    _loadPaletteGroupPrefs();
    _syncPaletteGroupUi();
    filterPaletteItems('');
}

// ============================================================
// MENU RACK / FLOOR
// ============================================================
function toggleRackMenu(){
    const d=document.getElementById('rack-menu-dropdown');
    if(!d) return;
    d.style.display=d.style.display==='none'?'block':'none';
    if(d.style.display==='block' && typeof _updateRackUNumLabel==='function') _updateRackUNumLabel();
}
function closeRackMenu(){
    const d=document.getElementById('rack-menu-dropdown');
    if(d) d.style.display='none';
}
function toggleFloorMenu(){
    const d=document.getElementById('floor-menu-dropdown');
    if(!d) return;
    d.style.display=d.style.display==='none'?'block':'none';
}
function closeFloorMenu(){
    const d=document.getElementById('floor-menu-dropdown');
    if(d) d.style.display='none';
}
function _setMenuItemDisabled(id, disabled){
    const el=document.getElementById(id);
    if(!el) return;
    if(disabled) el.setAttribute('disabled','disabled');
    else el.removeAttribute('disabled');
}
function _updateFloorMenuState(){
    const hasMap=!!store.state.bgImage;
    const up=document.getElementById('floor-menu-upload-label');
    const li=document.getElementById('floor-menu-lock-icon');
    const ll=document.getElementById('floor-menu-lock-label');
    const cta=document.getElementById('floor-menu-cta');
    const hint=document.getElementById('floorplan-toolbar-hint');
    if(up) up.textContent=hasMap?'Sostituisci mappa':'Importa mappa';
    if(li) li.className=`fas ${store.state.bgImageLocked?'fa-lock-open':'fa-lock'}`;
    if(ll) ll.textContent=store.state.bgImageLocked?'Sblocca scala mappa':'Blocca scala mappa';
    if(cta) cta.textContent=hasMap?'Azioni':'Importa mappa';
    if(hint) hint.style.display=hasMap?'none':'block';
    _setMenuItemDisabled('floor-menu-lock-btn', !hasMap);
    _setMenuItemDisabled('floor-menu-fit-btn', !hasMap || !!store.state.bgImageLocked);
    _setMenuItemDisabled('floor-menu-reset-btn', !hasMap || !!store.state.bgImageLocked);
    _setMenuItemDisabled('floor-menu-clear-btn', !hasMap);
}
function _updateFloorToolbarVisibility(){
    const wrap=document.getElementById('floorplan-toolbar-wrap');
    if(!wrap) return;
    const show=store._viewMode==='map';
    wrap.style.display=show?'block':'none';
    if(!show) closeFloorMenu();
    _updateFloorMenuState();
}

// ============================================================
// RACK MANAGEMENT
// ============================================================
function _updateRackFloorBtn(){
    const btn=document.getElementById('btn-rack-floor'); if(!btn) return;
    const rack=store.state.racks.find(r=>r.id===store.state.currentRack);
    const onFloor=rack&&rack.x!==undefined;
    const _t=(typeof t==='function')?t:(k=>k);
    btn.setAttribute('data-tip', onFloor?_t('rack.titleRemove'):_t('rack.titlePlace'));
    btn.innerHTML=`<i class="fas ${onFloor?'fa-map-marker-alt':'fa-map-pin'}"></i> ${onFloor?_t('rack.offFloor'):_t('rack.onFloor')}`;
    btn.className=`rack-menu-item${onFloor?' primary':''}`;
    btn.style.cssText='';
}

function toggleRackOnFloor(){
    const rack=store.state.racks.find(r=>r.id===store.state.currentRack); if(!rack) return;
    pushHistory();
    if(rack.x!==undefined){
        delete rack.x; delete rack.y;
    } else {
        // Centra nella viewport corrente della planimetria
        const fp=document.getElementById('floorplan');
        const cx=(fp.clientWidth/2-store.state.floorView.x)/store.state.floorView.zoom;
        const cy=(fp.clientHeight/2-store.state.floorView.y)/store.state.floorView.zoom;
        rack.x=Math.round(cx/20)*20;
        rack.y=Math.round(cy/20)*20;
    }
    renderAll(); markDirty();
}

function renderRackTabs(){
    const sel=document.getElementById('rack-select'); sel.innerHTML='';
    store.state.racks.forEach(r=>{
        if(!r.sizeU)r.sizeU=42;
        const opt=document.createElement('option');
        opt.value=r.id; opt.innerText=r.name;
        if(r.id===store.state.currentRack)opt.selected=true;
        sel.appendChild(opt);
    });
    document.getElementById('rack-size-input').value=win.getRackSize();
    _updateRackFloorBtn();
}
function switchRack(id){
    store.state.currentRack=id;
    // Non azzeriamo store.linkStart: consente di completare un collegamento cross-rack
    // cambiando rack e cliccando la porta destinazione
    if(!store.linkStart) store.selId=null;
    renderRackTabs(); renderAll(); markDirty();
}
function addRack(){
    win.showPrompt('Nome del rack:','Rack '+(store.state.racks.length+1),name=>{
        if(!name||!name.trim()) return;
        pushHistory();
        store.state.racks.push({id:uid('rack'),name:name.trim(),sizeU:42});
        store.state.currentRack=store.state.racks[store.state.racks.length-1].id;
        renderRackTabs();renderAll();markDirty();
    });
}
function renameRack(){
    const rack=win.getRackById(store.state.currentRack); if(!rack) return;
    win.showPrompt('Rinomina rack:',rack.name,name=>{
        if(!name||!name.trim()) return;
        pushHistory();
        rack.name=name.trim();
        renderRackTabs();markDirty();
    });
}
// Sposta un device rack da un rack all'altro. Trova lo spazio libero nel
// rack destinazione; se non c'e' spazio sufficiente, mostra alert e non
// esegue lo spostamento. Restituisce true se lo spostamento e' avvenuto.
function moveNodeToRack(nodeId, newRackId){
    const n = nodeById(nodeId);
    if(!n || !TYPES[n.type]?.isRack) return false;
    if(n.rackId === newRackId) return false;            // nessun cambio
    const destRack = win.getRackById(newRackId);
    if(!destRack){ showAlert(t('msg.rack.destNotFound')); return false; }

    const sU = normalizeNumber(n.sizeU, TYPES[n.type]?.sizeU || 1, 1, 60);
    const destSize = normalizeNumber(destRack.sizeU, 42, 6, 60);

    // L'apparato deve fisicamente entrare nel rack destinazione
    if(sU > destSize){
        showAlert(t('msg.rack.tooTall',{sU:sU,name:destRack.name,destSize:destSize}));
        return false;
    }

    // Cerca uno slot libero nel rack destinazione
    const occupied = new Set();
    store.state.nodes.filter(x => x.rackId === newRackId).forEach(x => {
        const s = normalizeNumber(x.sizeU, TYPES[x.type]?.sizeU || 1, 1, destSize);
        for(let u = x.rackU; u < x.rackU + s; u++) occupied.add(u);
    });
    let freeU = null;
    for(let u = destSize - sU + 1; u >= 1; u--){
        let fits = true;
        for(let i = 0; i < sU; i++) if(occupied.has(u + i)){ fits = false; break; }
        if(fits){ freeU = u; break; }
    }
    if(freeU === null){
        showAlert(t('msg.rack.noSpace',{name:destRack.name,sU:sU}));
        return false;
    }

    pushHistory();
    n.rackId = newRackId;
    n.rackU  = freeU;
    markDirty();
    renderAll();
    if(typeof _showToast === 'function'){
        _showToast(t('msg.rack.movedTo',{name:destRack.name,u:freeU}), 'ok', 3500);
    }
    return true;
}

function updateRackSize(value){
    const rack=win.getRackById(store.state.currentRack); if(!rack) return;
    const newSize = normalizeNumber(value, 42, 6, 60);
    const oldSize = rack.sizeU || 42;

    // Validazione riduzione: verifica che gli apparati esistenti ci stiano.
    if(newSize < oldSize){
        const devices = store.state.nodes.filter(n => TYPES[n.type]?.isRack && n.rackId === rack.id);
        let totalU = 0, maxU = 0;
        for(const n of devices){
            const su = normalizeNumber(n.sizeU, TYPES[n.type]?.sizeU || 1, 1, oldSize);
            totalU += su;
            if(su > maxU) maxU = su;
        }
        const _restoreInput = () => {
            const inp = document.getElementById('rack-size-input');
            if(inp) inp.value = oldSize;
        };
        if(maxU > newSize){
            showAlert(t('msg.rack.shrinkMaxU',{newSize:newSize,maxU:maxU}));
            _restoreInput();
            return;
        }
        if(totalU > newSize){
            showAlert(t('msg.rack.shrinkTotalU',{newSize:newSize,totalU:totalU}));
            _restoreInput();
            return;
        }
    }

    pushHistory();
    rack.sizeU = newSize;
    // win._repairRackPlacements ridistribuisce con algoritmo no-overlap:
    // sostituisce il vecchio clampRackDevice che causava sovrapposizioni.
    win._repairRackPlacements(store.state);
    renderRackTabs(); renderAll(); markDirty();
}
function toggleRackUNumbering(){
    const rack = win.getRackById(store.state.currentRack); if(!rack) return;
    pushHistory();
    rack.uNumberFromTop = !rack.uNumberFromTop;
    renderAll(); markDirty();
    _updateRackUNumLabel();
}
function _updateRackUNumLabel(){
    const lbl = document.getElementById('btn-rack-unum-label');
    if(!lbl) return;
    const r = win.getRackById(store.state.currentRack);
    const _t = (typeof t==='function') ? t : (k=>k);
    lbl.textContent = r?.uNumberFromTop ? _t('rack.uNumFromBottom') : _t('rack.uNumFromTop');
}
function deleteCurrentRack(){
    if(store.state.racks.length<=1){showAlert(t('msg.rack.cannotDeleteOnly'));return;}
    win.showConfirm('Eliminare questo rack e tutti i suoi apparati?',()=>{
        pushHistory();
        const ids=new Set(store.state.nodes.filter(n=>TYPES[n.type]?.isRack&&n.rackId===store.state.currentRack).map(n=>n.id));
        store.state.nodes=store.state.nodes.filter(n=>!ids.has(n.id));
        store.state.links=store.state.links.filter(l=>!ids.has(getPortNodeId(l.src))&&!ids.has(getPortNodeId(l.dst)));
        win.removeNodePorts(ids);
        store.state.racks=store.state.racks.filter(r=>r.id!==store.state.currentRack);
        store.state.currentRack=store.state.racks[0].id;
        win._resetSelection(); renderRackTabs();renderAll();markDirty();
    });
}

// ============================================================
// MAP IMPORT
// ============================================================
function handleMapUpload(input){
    const file=input.files[0]; if(!file) return;
    if(file.name.toLowerCase().endsWith('.pdf')){
        showAlert(t('msg.rack.pdfNotSupported'));
        input.value=''; return;
    }
    const reader=new FileReader();
    reader.onload=ev=>{pushHistory();store.state.bgImage=ev.target.result;renderAll();_updateFloorMenuState();markDirty();input.value='';};
    reader.readAsDataURL(file);
}
function clearMap(){pushHistory();store.state.bgImage=null;store.state.bgImageScale=1;renderAll();_updateFloorMenuState();markDirty();}

function scaleBgImageTo(val){
    if(store.state.bgImageLocked) return;
    store.state.bgImageScale=Math.max(0.1,Math.min(5,+val||1));
    const bg=document.getElementById('floor-bg-img');
    if(bg) bg.style.transform=`scale(${store.state.bgImageScale})`;
    markDirty();
    // Aggiorna slider e label senza re-render completo
    const slider=document.getElementById('bg-scale-slider');
    const lbl=document.getElementById('bg-scale-lbl');
    if(slider) slider.value=store.state.bgImageScale.toFixed(2);
    if(lbl) lbl.textContent=Math.round(store.state.bgImageScale*100)+'%';
}
function scaleBgImage(delta){ scaleBgImageTo(store.state.bgImageScale+delta); }

/** Mostra/nasconde la griglia della planimetria (per-progetto) */
function toggleFloorGrid(show){
    store.state.gridHidden = !show;
    const g=document.getElementById('floorplan-grid');
    if(g) g.style.display = show ? '' : 'none';
    markDirty();
}

/** Regola l'opacità della mappa di sfondo (per-progetto, default 0.4) */
function setBgImageOpacity(val){
    store.state.bgImageOpacity=Math.max(0.05,Math.min(1,+val||0.4));
    const bg=document.getElementById('floor-bg-img');
    if(bg) bg.style.opacity=store.state.bgImageOpacity;
    markDirty();
    const lbl=document.getElementById('bg-opacity-lbl');
    if(lbl) lbl.textContent=Math.round(store.state.bgImageOpacity*100)+'%';
}

/** Blocca / sblocca la scala dell'immagine di sfondo */
function toggleBgImageLock(){
    store.state.bgImageLocked=!store.state.bgImageLocked;
    _updateFloorMenuState();
    markDirty(); renderProps();
}

/** Blocca / sblocca posizione e dimensioni di una stanza */
function toggleRoomLock(nodeId){
    const n=nodeById(nodeId); if(!n) return;
    n.locked=!n.locked;
    markDirty(); renderAll();
}

/** Aggiorna live il colore sfondo di una stanza (senza re-render) */
function _liveStructColor(nodeId, col){
    const n=nodeById(nodeId); if(!n) return;
    const alpha=n.opacity !== undefined ? n.opacity : 1;
    const el=document.querySelector(`.floor-room[data-id="${nodeId}"]`);
    if(el) el.style.backgroundColor = alpha<1 ? hexToRgba(col,alpha) : col;
}
/** Aggiorna live l'opacità sfondo di una stanza (senza re-render) */
function _liveStructOpacity(nodeId, val){
    const lbl=document.getElementById('struct-opacity-lbl');
    if(lbl) lbl.textContent=Math.round(val*100)+'%';
    const n=nodeById(nodeId); if(!n) return;
    const col=n.color||TYPES[n.type]?.defaultColor||'#16212b';
    const el=document.querySelector(`.floor-room[data-id="${nodeId}"]`);
    if(el) el.style.backgroundColor = val<1 ? hexToRgba(col,val) : col;
}

function fitBgImageToCanvas(){
    /* Calcola la scala che fa coincidere l'immagine con la viewport floor visibile */
    const bg=document.getElementById('floor-bg-img');
    if(!bg||!bg.naturalWidth) return;
    const fp=document.getElementById('floorplan');
    if(store.state.bgImageLocked) return;
    const sx=fp.clientWidth  / (bg.naturalWidth  * store.state.floorView.zoom);
    const sy=fp.clientHeight / (bg.naturalHeight * store.state.floorView.zoom);
    scaleBgImageTo(Math.min(sx,sy));
    _updateFloorMenuState();
    renderProps(); // aggiorna slider
}

expose({
    // search
    getSearchIcon, getPortSummary, buildSearchResults,
    handleSearchInput, handleSearchKey, renderSearchResults, clearSearch,
    selectSearchResult, ensureNodeRackVisible, selectAndFocusNode, focusNode,
    // zoom & pan
    updateTransforms, applyUiColors, zoomFloor, zoomRack,
    handleFloorZoom, handleRackZoom,
    // divider
    toggleRackPanel, toggleSidebarPanel,
    // palette
    togglePaletteGroup, setPaletteGroupsExpanded, filterPaletteItems,
    clearPaletteFilter, initPaletteUi,
    // menu rack/floor
    toggleRackMenu, closeRackMenu, toggleFloorMenu, closeFloorMenu,
    _updateFloorMenuState, _updateFloorToolbarVisibility,
    // rack management
    _updateRackFloorBtn, toggleRackOnFloor, renderRackTabs, switchRack,
    addRack, renameRack, moveNodeToRack, updateRackSize,
    toggleRackUNumbering, _updateRackUNumLabel, deleteCurrentRack,
    // map import
    handleMapUpload, clearMap, scaleBgImageTo, scaleBgImage, setBgImageOpacity, toggleFloorGrid,
    toggleBgImageLock, toggleRoomLock, _liveStructColor, _liveStructOpacity,
    fitBgImageToCanvas,
});
