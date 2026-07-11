// ============================================================
// INPUT — DRAG & DROP + POINTER EVENTS              [modulo ESM, ex lib/app-pointer.js]
// onDragStart/handleDrop (palette → floor/rack), handlePointerDown/Move/Up
// (selezione, drag threshold 5px, pan, link RMB), dblclick manuali via timestamp,
// handleDoubleClick/handleFloorDoubleClick, _cancelLink/_tryFinishLink, trace() BFS.
// Tutto lo stato input (dragNode, linkStart, isPanning*, _spaceDown, ...) vive su
// window (var in app.js): scritto qui via win.*, bare-letto dai classic e da app.js.
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { nodeById, markDirty, getNodeByPortId, getPortNodeId, getNodeDisplayName, pushHistory, renderCables, _invalidateIdx, switchRightTab, _showToast, _linksForPort, _nextNodeId, _isRadioPid, logAudit } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { propagateVlans } from './app-vlan-autopoll.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderTopoOverlay } from './app-topology-overlay.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { showAlert } from './app-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderProps } from './app-properties.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)
import { absorbNodeAsVm } from './app-hypervisor.js';   // import di un tile come VM (drop sulla zona nel pannello host)
import { focusNode, renderRackTabs, switchRack, toggleRackPanel, updateTransforms } from './app-search-zoom-rack.js';   // ritiro ponte: funzioni rack/zoom/search (ex win.*)
import { closePop } from './app-popup.js';   // ritiro ponte: funzioni foglia UI/vlan/popup (ex win.*)

// soglia drag/click (px): unico lettore era questo modulo → module-local
const _DRAG_THRESHOLD_PX = 5;

// Doppio click su un nodo floor: rilevamento MANUALE via timestamp. Il dblclick
// nativo NON scatta sui nodi floor — il single click chiama renderAll→renderFloor
// che fa `innerHTML=''` e ricrea l'elemento del nodo TRA i due click, quindi il
// browser vede due click su elementi DIVERSI e non emette dblclick. Stesso schema
// gia' usato per il device rack (handlePointerDown) e le porte floor/rack.
let _floorDblId = null, _floorDblTime = 0;
const _FLOOR_DBL_MS = 350;
// Posizione del nodo floor PRIMA del drag: se il drag finisce in un'area "sbagliata"
// (pannello/sidebar/fuori, NON la zona import né la planimetria) il device ci torna,
// invece di restare "perso" sotto il pannello.
let _floorDragOrigin = null;
// Apre le Proprieta' di un nodo floor (doppio click): seleziona, evidenzia il run,
// intent esplicito (uniforme col rack) → switcha al pannello Proprieta'. Condiviso
// dal doppio click manuale (pointerdown) e da handleFloorDoubleClick (fallback) →
// l'unico `win._propsExplicit=true` del floor vive qui (niente +1 sul ponte).
function _openFloorNodeProps(id){
    store.dragNode = null;
    store.selType = 'node'; store.selId = id;
    store.highPath.clear(); _traceNodeFloor(id);   // evidenzia il run alla selezione nodo
    win._renderModeIndicator();
    win._propsExplicit = true;
    switchRightTab('props');
    renderProps();
}

// ── Import VM: trascina un tile sulla drop-zone del pannello host ─────
// Il bersaglio NON è un tile sul floor ma una "zona di rilascio" nel pannello
// Proprietà dell'host (sezione Macchine virtuali) → vale per host su floor E in
// rack, senza drag cross-vista. _vmDropHost = id host della zona sotto il cursore.
// Stato di MODULO (lo leggono solo move=set e up=commit) → niente ponte. Funziona
// perché afferrare un tile del floor NON ri-renderizza il pannello (selId cambia
// ma renderProps non parte durante un drag armato): la zona resta sotto il cursore.
// Manual-first: assorbe solo su gesto esplicito dell'utente.
let _vmDropHost = null;
function _vmDropZoneEl(hostId){ return document.querySelector(`[data-vm-dropzone][data-host-id="${hostId}"]`); }
function _setVmDropTarget(hostId){
    if(_vmDropHost === hostId) return;
    if(_vmDropHost){ const p = _vmDropZoneEl(_vmDropHost); if(p) p.classList.remove('active'); }
    _vmDropHost = hostId || null;
    if(_vmDropHost){ const el = _vmDropZoneEl(_vmDropHost); if(el) el.classList.add('active'); }
}
// "Fantasma" di trascinamento: il tile floor è clippato da #floorplan (overflow
// hidden) e #floor-canvas ha un transform → non può comparire SOPRA il pannello
// Proprietà (z-index più alto). Quando il cursore entra nel pannello mostriamo un
// piccolo chip fixed col nome del device, così si vede cosa stai trascinando sulla
// drop-zone (prima il device "spariva sotto" il pannello).
let _vmDragGhost = null;
function _vmShowGhost(e, n){
    if(!_vmDragGhost){
        _vmDragGhost = document.createElement('div');
        _vmDragGhost.className = 'vm-drag-ghost';
        _vmDragGhost.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> <span></span>';
        document.body.appendChild(_vmDragGhost);
    }
    _vmDragGhost.querySelector('span').textContent = getNodeDisplayName(n) || (n && n.name) || 'VM';
    _vmDragGhost.style.left = e.clientX + 'px';
    _vmDragGhost.style.top = e.clientY + 'px';
    _vmDragGhost.style.display = 'flex';
}
function _vmHideGhost(){ if(_vmDragGhost) _vmDragGhost.style.display = 'none'; }
function _clearVmDropTarget(){ _setVmDropTarget(null); _vmHideGhost(); }
// Durante il drag di un tile floor assorbibile (non-host, con MAC): se il cursore
// è sopra una drop-zone VM, evidenziala come bersaglio; e se è sopra il pannello
// (dove il tile clippa via) mostra il fantasma col nome. Altrimenti pulisci.
function _updateVmDropTarget(e, n, el){
    if(!_vmAbsorbEligible(n) || !el){ _clearVmDropTarget(); return; }
    const pe = el.style.pointerEvents; el.style.pointerEvents = 'none';   // elementFromPoint deve vedere ciò che sta SOTTO il tile
    const under = document.elementFromPoint(e.clientX, e.clientY);
    el.style.pointerEvents = pe;
    const dz = under && under.closest ? under.closest('[data-vm-dropzone]') : null;
    const overPanel = under && under.closest ? under.closest('#rack-view') : null;
    _setVmDropTarget(dz ? dz.getAttribute('data-host-id') : null);
    if(overPanel) _vmShowGhost(e, n); else _vmHideGhost();
}
// Una sorgente è "assorbibile" come VM solo se è un tile FLOOR con un MAC e NON è essa
// stessa un host né un passivo senza IP (no host-in-host, no patch panel/passacavo). Il
// vincolo isFloor preserva la semantica originaria (il rilevamento girava solo nel ramo
// floor del move) ora che il check di rilascio vale per qualunque drag.
function _vmAbsorbEligible(n){
    const def = n && TYPES[n.type];
    return !!(n && n.mac && def && def.isFloor && !def.hostsVms && !(def.isPassive && !def.hasIP));
}
// Hit-test AUTORITATIVO al pointerup. Nasconde un attimo il tile trascinato e il fantasma
// (entrambi sotto/vicino al cursore) e ispeziona il PUNTO DI RILASCIO. Ritorna:
//   • host    = id host se sotto c'è la sua drop-zone VM e la sorgente è idonea → assorbi;
//   • onFloor = true se sotto c'è la planimetria (#floorplan) → riposizionamento valido.
// Tutto il resto (pannello, sidebar, fuori finestra) = area "sbagliata" → il device torna
// a casa. È la verità sul "dove ho rilasciato", non lo stato dei move (su un drag veloce
// può restare "dentro la zona" anche se rilasci fuori).
function _vmDropTargetAtPoint(x, y, dragId){
    const restore = [];
    const tile = dragId ? document.querySelector(`[data-id="${(window.CSS && CSS.escape) ? CSS.escape(dragId) : dragId}"]`) : null;
    if(tile){ restore.push([tile, tile.style.pointerEvents]); tile.style.pointerEvents = 'none'; }
    if(_vmDragGhost){ restore.push([_vmDragGhost, _vmDragGhost.style.pointerEvents]); _vmDragGhost.style.pointerEvents = 'none'; }
    const under = document.elementFromPoint(x, y);
    for(const [node, prev] of restore) node.style.pointerEvents = prev;
    const dz = under && under.closest ? under.closest('[data-vm-dropzone]') : null;
    const onFloor = !!(under && under.closest && under.closest('#floorplan'));
    const host = (dz && _vmAbsorbEligible(nodeById(dragId))) ? dz.getAttribute('data-host-id') : null;
    return { host, onFloor };
}

// Snap-to-grid planimetria: aggancia alla griglia 20px SOLO se la griglia è
// visibile. Con la griglia disattivata (state.gridHidden) il posizionamento è
// libero al pixel — coerente col fatto che non c'è più nessuna griglia a cui
// agganciarsi. Usato da drop/drag/resize dei device floor e dei rack su mappa.
function _snapFloor(v){ return store.state.gridHidden ? Math.round(v) : Math.round(v/20)*20; }

// ============================================================
// DRAG & DROP
// ============================================================
function onDragStart(e){
    win._paletteDragType=e.target.dataset.type||'';
    win._renderModeIndicator();
    e.dataTransfer.setData('text/plain',e.target.dataset.type);
    e.dataTransfer.effectAllowed='copy';
}

function handleDrop(e,zone){
    const t=e.dataTransfer.getData('text/plain'); if(!t||!TYPES[t]) return;
    win._paletteDragType='';
    const d=TYPES[t];
    const n={id:_nextNodeId(t),type:t,name:d.name+' '+Math.floor(Math.random()*100),ports:d.ports};
    const spec=win._ensureNodeSpec(n);

    if(zone==='floor'&&d.isFloor){
        const r=document.getElementById('floorplan').getBoundingClientRect();
        let rx=(e.clientX-r.left-store.state.floorView.x)/store.state.floorView.zoom;
        let ry=(e.clientY-r.top -store.state.floorView.y)/store.state.floorView.zoom;
        if(d.isStructural){n.w=200;n.h=200;rx-=100;ry-=100;n.color=d.defaultColor;}
        if(t==='wallport'){const c=store.state.nodes.filter(x=>x.type==='wallport').length+1;n.name='A-'+c.toString().padStart(2,'0');n.portId=n.name;}
        if(t==='ap'){const c=store.state.nodes.filter(x=>x.type==='ap').length+1;n.name='AP-'+c.toString().padStart(2,'0');n.radios=[{}];}  // AP = sempre wireless
        if(t==='customfloor'){const c=store.state.nodes.filter(x=>x.type==='customfloor').length+1;n.name='EP-'+c.toString().padStart(2,'0');spec.customCategory='';}
        if(t==='webcam'){
            const c=store.state.nodes.filter(x=>x.type==='webcam').length+1;
            n.name='CAM-'+c.toString().padStart(2,'0');
            Object.assign(spec,{mountType:'ceiling',installHeight:2.8,powerType:'poe',resolution:'1080p',lens:'2.8mm / 110deg',coverageZone:'',recorder:'',installStatus:'planned',irEnabled:true,audioEnabled:false});
        }
        n.x=_snapFloor(rx); n.y=_snapFloor(ry);
        pushHistory(); store.state.nodes.push(n);
        // Endpoint trascinato: tenta l'auto-link (di norma vuoto → nessun link finché
        // non si compila il MAC; scatta poi da updateN). Innocuo se la cache è vuota.
        if(win._isLeafEndpoint(t)) win._autoLinkEndpoint(n.id);
    } else if(zone==='rack'&&d.isRack){
        if(!store.state.currentRack||!store.state.racks.length) return; // nessun rack presente
        const ch=document.getElementById('rack-chassis');
        const r=ch?ch.getBoundingClientRect():{top:0};
        // Subtract border-top (8px, scaled) so ry=0 is exactly the first inner grid row
        const ry=(e.clientY-r.top)/store.state.rackView.zoom - 8, rs=win.getRackSize();
        const u=rs-Math.floor(ry/win.rackUPx());
        n.sizeU=d.sizeU; n.rackU=Math.max(1,Math.min(rs-n.sizeU+1,u)); n.brand=d.brand; n.rackId=store.state.currentRack;
        if(t==='blankpanel'){
            n.name='Pannello vuoto';
            n.brand='';
            n.ports=0;
        }
        if(t==='cablemanager'){
            n.name='Passacavo';
            n.brand='';
            n.ports=0;
        }
        if(t==='customrack'){
            const c=store.state.nodes.filter(x=>x.type==='customrack').length+1;
            n.name='DEV-'+c.toString().padStart(2,'0');
            spec.customCategory='';
        }
        pushHistory(); store.state.nodes.push(n);
        // UPS/PDU managed sono endpoint foglia: tenta l'auto-link (vuoto al drop,
        // scatta quando si compila il MAC). Innocuo se la cache FDB è vuota.
        if(win._isLeafEndpoint(t)) win._autoLinkEndpoint(n.id);
    }
    // Evidenzia e inquadra il nodo appena inserito, così non sembra "sparito"
    // (specie se finisce in una zona del floor fuori dalla vista corrente).
    if(store.state.nodes.indexOf(n) !== -1 && typeof logAudit === 'function'){
        logAudit('device-add', { target:getNodeDisplayName(n)||n.name||n.id, summary:d.name });
    }
    store.selId=n.id; store.selType='node';
    renderAll(); markDirty();
    if(TYPES[n.type]?.isFloor && !TYPES[n.type]?.isStructural) focusNode(n);
}

// ============================================================
// POINTER EVENTS
// ============================================================
function handlePointerDown(e){
    if(e.target.closest('header')||e.target.closest('#sidebar-left')||e.target.closest('#sidebar-divider')||e.target.closest('#props-panel-wrap')||e.target.closest('#right-tab-bar')||e.target.closest('.zoom-controls')||e.target.closest('#modal-overlay')||e.target.closest('.tool-modal-overlay')||e.target.closest('#user-manager-overlay')||e.target.closest('#chpwd-overlay')||e.target.closest('#vlan-members-overlay')||e.target.closest('.rack-header')||e.target.closest('#popup')||e.target.closest('#lag-sel-banner')||e.target.closest('#topo-tip')||e.target.closest('#topo-legend')) return;
    // P1.5 — Modalita' instradamento cavo (editor segmenti, Opzione A):
    // SOLO il click su una porta agisce (spezza il cavo se la porta e'
    // evidenziata, avvisa altrimenti). Ogni altro click — area vuota mappa,
    // collasso pannello rack, pan, navigazione — passa al normale handling
    // SENZA uscire dalla modalita': l'utente deve poter sistemare la vista
    // (chiudere il rack per vedere la mappa, pannare) mentre cabla.
    // L'uscita esplicita avviene solo con Esc o il bottone Annulla del banner.
    if(typeof store._routingLinkId !== 'undefined' && store._routingLinkId && e.button === 0){
        const _rp = e.target.closest('[data-pid]');
        if(_rp){
            e.preventDefault(); e.stopPropagation();
            win._routingPickPort(_rp.dataset.pid);
            return;
        }
        // click non su porta → lascia passare (pan/navigazione), modalita' resta
    }
    // Scrollbar del rack viewport: trascinarla NON e' un gesto di selezione.
    // Quando si clicca la scrollbar, e.target e' #rack-viewport stesso e le
    // coordinate cadono OLTRE il client box (la scrollbar vive tra clientWidth
    // e il bordo). Senza questo guard il pointerdown cadeva nel branch
    // "click su area vuota → deseleziona": il cavo selezionato spariva
    // appena l'utente scrollava con lo slider. (Bug storico, pre-refactor.)
    if(e.target && e.target.id === 'rack-viewport'){
        const _r = e.target.getBoundingClientRect();
        if((e.clientX - _r.left) >= e.target.clientLeft + e.target.clientWidth ||
           (e.clientY - _r.top)  >= e.target.clientTop  + e.target.clientHeight) return;
    }
    // Threshold drag/click: memorizziamo la posizione del pointerdown e
    // marchiamo il drag come "non ancora armato". Sara' handlePointerMove
    // a sganciare il drag solo dopo > 5px di movimento.
    win._dragDownPt = { x: e.clientX, y: e.clientY };
    store._dragArmed = false;

    // Space + click sinistro → pan ovunque sulla mappa
    if(e.target.closest('#floorplan') && win._spaceDown && e.button===0){
        e.preventDefault();
        win.isPanningFloor=true;
        win.panStart={x:e.clientX-store.state.floorView.x, y:e.clientY-store.state.floorView.y};
        const fp=document.getElementById('floorplan');
        if(fp) fp.style.cursor='grabbing';
        return;
    }

    // Space + click sinistro sul rack → pan come il floor, ma via SCROLL nativo
    // del #rack-viewport (il rack non usa un transform translate). Lo Space ha la
    // precedenza sul pickup device, coerente col floor.
    if(e.target.closest('#rack-viewport') && win._spaceDown && e.button===0){
        e.preventDefault();
        win.isPanningRack=true;
        win.rackPanStart={x:e.clientX, y:e.clientY, x0:store.state.rackView.x||0, y0:store.state.rackView.y||0};
        document.body.classList.add('rack-panning');   // disattiva la transition durante il pan
        const rv=document.getElementById('rack-viewport'); if(rv) rv.style.cursor='grabbing';
        return;
    }

    const RMB=e.button===2;
    const LMB=e.button===0;

    // Tasto destro fuori da una porta → ignora (contextmenu già soppressa)
    if(RMB&&!e.target.closest('[data-pid]')) return;

    // I cavi gestiscono il proprio onclick (hit area) — non interferire con store.highPath/popup.
    // MA nel rack i cavi (soprattutto i cross-rack) attraversano il viewport: un DRAG che
    // parte su una banda-cavo deve comunque poter PANNARE (il click PURO resta gestito
    // dall'onclick del cavo → seleziona). Senza questo, con cavi visibili il pan senza-Space
    // sembrava bloccato perche' non si trovava area "pulita" da cui partire.
    if(e.target.closest('.cable-hit')){
        if(LMB && !win._spaceDown && !store.linkStart && e.target.closest('#rack-viewport')
           && !e.target.closest('[data-pid]') && !e.target.closest('.rack-device') && !e.target.closest('.rack-header')){
            e.preventDefault();
            win.isPanningRack=true;
            win.rackPanStart={x:e.clientX, y:e.clientY, x0:store.state.rackView.x||0, y0:store.state.rackView.y||0};
            document.body.classList.add('rack-panning');
            const rv=document.getElementById('rack-viewport'); if(rv) rv.style.cursor='grabbing';
        }
        return;   // in ogni caso non azzerare store.highPath/popup: il cavo ha il suo onclick
    }

    closePop(); store.highPath.clear(); win._physicalTraceActive=false;

    const port=e.target.closest('[data-pid]');
    const rackFloorEl=e.target.closest('.floor-rack');
    const floorEl=!rackFloorEl&&(e.target.closest('.floor-node')||e.target.closest('.floor-room'));
    const rackEl=e.target.closest('.rack-device');
    const resize=e.target.closest('.resize-handle');

    if(port){
        e.stopPropagation(); e.preventDefault();
        if(RMB){
            // ── TASTO DESTRO: crea collegamento ──
            if(store.linkStart){
                if(port.dataset.pid===store.linkStart){ _cancelLink(); renderAll(); }
                // Porta diversa → handlePointerUp chiuderà il link
            } else {
                store.linkStart=port.dataset.pid; win._linkJustStarted=true;
                document.body.classList.add('link-mode');
                store.selType='port'; store.selId=store.linkStart;
                trace(store.linkStart); renderAll();
            }
        } else if(LMB){
            // ── TASTO SINISTRO: LAG mode o seleziona e mostra popup ──
            if(store.lagSelMode){
                win._toggleLagPort(port.dataset.pid);
            } else {
                if(store.linkStart){ _cancelLink(); }
                const _pid=port.dataset.pid;
                const _pNode=getNodeByPortId(_pid);
                const _isFloor=_pNode&&TYPES[_pNode.type]?.isFloor;
                store.selType='port'; store.selId=_pid;
                trace(_pid);
                // Evidenzia in violetto (come il badge "Membro LAG") le porte
                // sorelle dello stesso LAG (locale + remoto). Prima era
                // agganciato solo a showPop (popup di porta);
                // rimosso il popup sulle porte rack, il focus va attivato qui sul
                // click, prima dei renderAll dei rami sotto. Su porta non-LAG la
                // funzione azzera il set e non evidenzia nulla.
                win._focusLagForPort(_pid);
                if(_isFloor){
                    // Le porte floor hanno DUE comportamenti distinti:
                    //   single click  → tab Proprieta porta (immediato)
                    //   doppio click  → override: switch al rack + tab Rack
                    // Il dblclick nativo del browser non funziona perche'
                    // renderAll() ricostruisce il DOM tra i due click.
                    // Detection manuale via timestamp: se un secondo click
                    // sulla stessa porta arriva entro 350ms, scatta il
                    // comportamento "rack" che sovrascrive il pannello props
                    // appena aperto dal single click. Tradeoff accettato:
                    // durante un vero doppio click vedi un breve "flash"
                    // del pannello Proprieta prima che subentri il Rack.
                    const _now = Date.now();
                    if(win._floorPortClick && win._floorPortClick.pid === _pid &&
                       (_now - win._floorPortClick.t) < 350){
                        // === DOPPIO CLICK === — override del single click
                        win._floorPortClick = null;
                        // Trova rack del cavo collegato dalla store.highPath
                        let _tgtRack=null;
                        for(const _lid of store.highPath){
                            const _lk=store.state.links.find(x=>x.id===_lid);
                            if(!_lk) continue;
                            const _a=getNodeByPortId(_lk.src), _b=getNodeByPortId(_lk.dst);
                            if(TYPES[_a?.type]?.isRack&&_a.rackId){_tgtRack=_a.rackId;break;}
                            if(TYPES[_b?.type]?.isRack&&_b.rackId){_tgtRack=_b.rackId;break;}
                        }
                        if(_tgtRack){
                            if(typeof store._rackCollapsed !== 'undefined' && store._rackCollapsed &&
                               typeof toggleRackPanel === 'function') toggleRackPanel();
                            if(_tgtRack !== store.state.currentRack){
                                store.state.currentRack = _tgtRack;
                                renderRackTabs();
                            }
                        }
                        switchRightTab('rack');
                        renderAll();
                    } else {
                        // === SINGLE CLICK === — esecuzione immediata
                        win._floorPortClick = { pid: _pid, t: _now };
                        switchRightTab('props');
                        renderAll();
                        renderProps();
                    }
                } else {
                    // Porta di un device rack: design pulito specularmente
                    // alla porta floor.
                    //  - SINGLE click in tab RACK: solo highlight del cavo
                    //    collegato (trace gia' fatto sopra). NIENTE popup:
                    //    le info di porta sono gia' nella tab Proprieta',
                    //    duplicarle in un popup volante era ridondante.
                    //  - SINGLE click in tab PROPS: switch al pannello
                    //    Proprieta' porta (uniforme con porta floor).
                    //  - DOUBLE click (qualunque tab): switch a tab Props
                    //    per editing — gestito in handleDoubleClick.
                    // Specularita' UX:
                    //   floor : single=props · doppio=switch al rack
                    //   rack  : single=highlight · doppio=switch a props
                    if (win._rightTab === 'rack') {
                        // Rilevamento manuale doppio click via timestamp (il
                        // dblclick nativo non scatta dopo preventDefault del
                        // pointerdown). Soglia 350ms come gia' fatto per le
                        // porte floor.
                        const _now = Date.now();
                        if (win._rackPortDblPid === _pid && (_now - win._rackPortDblTime) < 350) {
                            // === DOPPIO CLICK === → switch a tab Proprieta'
                            win._rackPortDblPid = null; win._rackPortDblTime = 0;
                            switchRightTab('props');
                            renderAll(); renderProps();
                        } else {
                            // === SINGLE CLICK === → solo highlight cavo
                            win._rackPortDblPid = _pid; win._rackPortDblTime = _now;
                            renderAll();
                        }
                    } else {
                        switchRightTab('props');
                        renderAll(); renderProps();
                    }
                    win._highlightTopoLinks(getPortNodeId(_pid));
                }
            }
        }
    } else if(LMB){
        // Tutto il resto solo con tasto sinistro
        if(resize){
            e.stopPropagation(); e.preventDefault();
            const _rn=nodeById(e.target.parentElement.dataset.id);
            if(_rn?.locked) return; // stanza bloccata: ignora resize
            win.resizeNode=e.target.parentElement.dataset.id;
        } else if(rackFloorEl){
            e.preventDefault();
            const rackId=rackFloorEl.dataset.rackid;
            const rack=store.state.racks.find(r=>r.id===rackId);
            if(!rack||rack.x===undefined) return;
            if(store._viewMode==='topology'){
                // Topologia: DOPPIO click = apri la rack window; SINGLE press =
                // arma il drag (sposta il rack). Rilevamento dblclick manuale via
                // timestamp (il dblclick nativo non scatta dopo preventDefault).
                const _now=Date.now();
                if(win._rackFloorDblId===rackId && (_now-win._rackFloorDblTime)<350){
                    win._rackFloorDblId=null; win._rackFloorDblTime=0;
                    if(store._rackCollapsed) toggleRackPanel();
                    win._hoverRackId=null;
                    switchRack(rackId);
                    switchRightTab('rack');
                    renderTopoOverlay();
                    return;
                }
                win._rackFloorDblId=rackId; win._rackFloorDblTime=_now;
                // (nessun ritorno: prosegue ad armare il drag come in map mode)
            }
            // Arma il potenziale drag senza switchare subito al rack.
            // Lo switchRack + apertura tab Rack sara' fatta in pointerup SOLO
            // se non c'e' stato trascinamento (threshold 5px). Cosi' il click
            // puro e' uniforme a Topology, e il drag continua a funzionare.
            store.dragRack=rackId;
            const fp=document.getElementById('floorplan').getBoundingClientRect();
            store.dragOffset={
                x:(e.clientX-fp.left-store.state.floorView.x)/store.state.floorView.zoom-rack.x,
                y:(e.clientY-fp.top -store.state.floorView.y)/store.state.floorView.zoom-rack.y
            };
        } else if(floorEl){
            e.preventDefault();
            const _fid=floorEl.dataset.id;
            const dn=nodeById(_fid);
            if(!dn||!TYPES[dn.type]) return;
            // Doppio click manuale (il dblclick nativo non scatta: renderFloor
            // ricostruisce il DOM del nodo tra i due click) → apre le Proprieta',
            // uniforme col device rack. Primo click = solo selezione (sotto).
            const _nowF=Date.now();
            if(_floorDblId===_fid && (_nowF-_floorDblTime)<_FLOOR_DBL_MS){
                _floorDblId=null; _floorDblTime=0;
                _openFloorNodeProps(_fid);
                return;
            }
            _floorDblId=_fid; _floorDblTime=_nowF;
            win._propsExplicit=false;   // single-click/drag = SOLO selezione; le proprietà si aprono col doppio click (uniforme col rack)
            // Stanza bloccata: seleziona ma non avvia drag
            if(TYPES[dn.type].isStructural && dn.locked){
                store.selType='node'; store.selId=_fid; renderAll(); return;
            }
            store.dragNode=_fid; store.selType='node'; store.selId=store.dragNode;
            _floorDragOrigin={x:dn.x,y:dn.y};   // per il "ritorno a casa" se rilasciato in area sbagliata
            _traceNodeFloor(_fid);   // evidenzia il run anche per prese/pass-through
            const r=floorEl.getBoundingClientRect();
            if(TYPES[dn.type].isStructural) store.dragOffset={x:(e.clientX-r.left)/store.state.floorView.zoom,y:(e.clientY-r.top)/store.state.floorView.zoom};
            else store.dragOffset={x:(e.clientX-(r.left+r.width/2))/store.state.floorView.zoom,y:(e.clientY-(r.top+r.height/2))/store.state.floorView.zoom};
            renderAll();
        } else if(rackEl){
            if(store.lagSelMode) return; // in selezione LAG: ignora click sul device body
            e.preventDefault();
            const _nid=rackEl.dataset.id;
            const _now=Date.now();
            // Rilevazione manuale doppio click (dblclick non arriva dopo preventDefault su pointerdown)
            if(_nid===win._rackDblId && _now-win._rackDblTime<350){
                win._rackDblTime=0; win._rackDblId=null;   // reset per il prossimo ciclo
                store.dragNode=null;
                store.selId=_nid; store.selType='node';
                win._propsExplicit=true;
                renderProps();
                return;
            }
            win._rackDblTime=_now; win._rackDblId=_nid;
            win._propsExplicit=false;
            store.dragNode=_nid; store.selType='node'; store.selId=store.dragNode;
            const r=rackEl.getBoundingClientRect();
            store.dragOffset={x:(e.clientX-r.left)/store.state.rackView.zoom,y:(e.clientY-r.top)/store.state.rackView.zoom};
            // Le props del device rack restano chiuse al click singolo grazie al
            // guard !win._propsExplicit in renderProps() (si aprono solo con intent
            // esplicito: doppio click, tasto P, oppure switchRightTab('props')).
            renderAll();
        } else if(e.target.closest('#rack-viewport') && !e.target.closest('.rack-header') && e.button===0 && !store.linkStart){
            // Area VUOTA del rack (no device, no controlli header, non in cabling)
            // → pan come il floor, senza Space (il rack non ha piu' scrollbar: il
            // drag E' la navigazione). Scroll programmatico anche con overflow:hidden.
            e.preventDefault();
            win.isPanningRack=true;
            win.rackPanStart={x:e.clientX, y:e.clientY, x0:store.state.rackView.x||0, y0:store.state.rackView.y||0};
            document.body.classList.add('rack-panning');
            const rv=document.getElementById('rack-viewport'); if(rv) rv.style.cursor='grabbing';
        } else if(e.target.closest('#floorplan')){
            win.isPanningFloor=true; win.panStart={x:e.clientX-store.state.floorView.x,y:e.clientY-store.state.floorView.y};
            store.selType=null; store.selId=null; win._clearTopoHighlight(); win._hideTopoTip();
            // Click area vuota mappa: se c'e' un filtro VLAN attivo, rimuovilo
            // (UX coerente: click "fuori" = reset filtro/selezione).
            if(store._filterVlan != null && typeof win.setVlanFilter === 'function') win.setVlanFilter(null);
            else renderAll();
        } else if(e.target.closest('#workspace')&&!e.target.closest('.cable-hit')){
            if(store.linkStart){ _cancelLink(); }
            store.selType=null; store.selId=null; win._clearTopoHighlight(); win._hideTopoTip();
            if(store._filterVlan != null && typeof win.setVlanFilter === 'function') win.setVlanFilter(null);
            else renderAll();
        }
    }
}

function handlePointerMove(e){
    // Threshold drag/click: finche' il puntatore non si e' mosso > 5px
    // dal pointerdown, blocchiamo l'avanzamento dei drag attivi (rack
    // device, floor node, rack icon, resize). Pan e link-trace non sono
    // soggetti al threshold (richiedono tracking immediato).
    if(!store._dragArmed && win._dragDownPt && (store.dragNode || store.dragRack || win.resizeNode)){
        const _dx = e.clientX - win._dragDownPt.x;
        const _dy = e.clientY - win._dragDownPt.y;
        if((_dx*_dx + _dy*_dy) < (_DRAG_THRESHOLD_PX * _DRAG_THRESHOLD_PX)) return;
        store._dragArmed = true;
        _floorDblId = null; _floorDblTime = 0;   // un drag NON è la 1ª metà di un doppio click → invalida il timer del doppio click floor
    }
    if(win.isPanningFloor){
        store.state.floorView.x=e.clientX-win.panStart.x; store.state.floorView.y=e.clientY-win.panStart.y;
        updateTransforms();
    } else if(win.isPanningRack){
        // Pan via TRANSFORM translate sul wrap, come il floor: lo zoom del rack e'
        // un transform:scale, quindi lo SCROLL non potrebbe muovere il contenuto
        // zoomato (ne' lateralmente ne' fino in fondo). Il contenuto segue il cursore.
        store.state.rackView.x=(win.rackPanStart.x0||0)+(e.clientX-win.rackPanStart.x);
        store.state.rackView.y=(win.rackPanStart.y0||0)+(e.clientY-win.rackPanStart.y);
        const wrap=document.getElementById('rack-chassis-wrap');
        if(wrap) wrap.style.transform=`translate(${store.state.rackView.x}px,${store.state.rackView.y}px) scale(${store.state.rackView.zoom})`;
        renderCables();
    } else if(store.dragNode){
        const n=nodeById(store.dragNode); if(!n) return;
        if(TYPES[n.type]?.isFloor){
            const fp=document.getElementById('floorplan').getBoundingClientRect();
            const rx=(e.clientX-fp.left-store.state.floorView.x)/store.state.floorView.zoom-store.dragOffset.x;
            const ry=(e.clientY-fp.top -store.state.floorView.y)/store.state.floorView.zoom-store.dragOffset.y;
            n.x=_snapFloor(rx); n.y=_snapFloor(ry);
            const el=document.querySelector(`[data-id="${n.id}"]`);
            if(el){el.style.left=n.x+'px';el.style.top=n.y+'px';}
            _updateVmDropTarget(e, n, el);   // tile sopra un host? evidenzia il bersaglio di rilascio
            renderCables();
            // In topologia le linee dell'overlay sono ancorate al DOM del node:
            // vanno ridisegnate durante il drag, altrimenti il cavo non segue.
            if(store._viewMode==='topology') renderTopoOverlay();
        } else if(TYPES[n.type]?.isRack){
            const ch=document.getElementById('rack-chassis').getBoundingClientRect();
            // Subtract border-top (8px) so ry is relative to the inner grid, not the chassis outer box
            const ry=(e.clientY-ch.top)/store.state.rackView.zoom - 8 - store.dragOffset.y;
            const rs=win.getNodeRackSize(n),sU=n.sizeU!==undefined?n.sizeU:TYPES[n.type].sizeU;
            n.rackU=Math.max(1,Math.min(rs-sU+1,rs-sU+1-Math.round(ry/win.rackUPx())));
            const el=document.querySelector(`[data-id="${n.id}"]`);
            if(el)el.style.gridRow=`${rs-n.rackU-sU+2}/span ${sU}`;
            renderCables();
        }
    } else if(store.dragRack){
        const rack=store.state.racks.find(r=>r.id===store.dragRack); if(!rack) return;
        const fp=document.getElementById('floorplan').getBoundingClientRect();
        const rx=(e.clientX-fp.left-store.state.floorView.x)/store.state.floorView.zoom-store.dragOffset.x;
        const ry=(e.clientY-fp.top -store.state.floorView.y)/store.state.floorView.zoom-store.dragOffset.y;
        rack.x=_snapFloor(rx); rack.y=_snapFloor(ry);
        const el=document.querySelector(`.floor-rack[data-rackid="${store.dragRack}"]`);
        if(el){el.style.left=rack.x+'px';el.style.top=rack.y+'px';}
        renderTopoOverlay();
    } else if(win.resizeNode){
        const n=nodeById(win.resizeNode); if(!n) return;
        const fp=document.getElementById('floorplan').getBoundingClientRect();
        const rx=(e.clientX-fp.left-store.state.floorView.x)/store.state.floorView.zoom;
        const ry=(e.clientY-fp.top -store.state.floorView.y)/store.state.floorView.zoom;
        n.w=Math.max(40,_snapFloor(rx-n.x)); n.h=Math.max(40,_snapFloor(ry-n.y));
        const el=document.querySelector(`[data-id="${n.id}"]`);
        if(el){
            el.style.width=n.w+'px'; el.style.height=n.h+'px';
            const sp=el.querySelector('span');
            if(sp) sp.style.fontSize=(n.fontSize!==undefined ? n.fontSize : Math.max(10,Math.min(Math.min(n.w,n.h)*0.1,36)))+'px';
        }
    } else if(store.linkStart){
        const st=document.querySelector(`[data-pid="${store.linkStart}"]`);
        const _lsp=store.state.ports[store.linkStart]||{};
        const color=store.state.vlanColors[_lsp.vlanOvr??_lsp.vlan??_lsp.vlanProp??1]||'#aaa';
        if(st){
            const sr=st.getBoundingClientRect();
            if(win.isRackPort(store.linkStart)){
                const vp=document.getElementById('rack-viewport').getBoundingClientRect();
                const x1=sr.left-vp.left+sr.width/2, y1=sr.top-vp.top+sr.height/2;
                const tl=document.getElementById('temp-link-rack');
                tl.setAttribute('d',win.getRackCablePath(x1,y1,e.clientX-vp.left,e.clientY-vp.top));
                tl.setAttribute('stroke',color);
                document.getElementById('temp-link').setAttribute('d','');
            } else {
                const ea=document.getElementById('export-area').getBoundingClientRect();
                const x1=sr.left-ea.left+sr.width/2, y1=sr.top-ea.top+sr.height/2;
                const tl=document.getElementById('temp-link');
                tl.setAttribute('d',win.getCablePath(x1,y1,e.clientX-ea.left,e.clientY-ea.top));
                tl.setAttribute('stroke',color);
                document.getElementById('temp-link-rack').setAttribute('d','');
            }
        }
    }
}

function _cancelLink(){
    document.getElementById('temp-link').setAttribute('d','');
    document.getElementById('temp-link-rack').setAttribute('d','');
    store.linkStart=null; win._linkJustStarted=false;
    document.body.classList.remove('link-mode');
    win._renderModeIndicator();
}

function _tryFinishLink(tgt){
    if(!tgt||tgt===store.linkStart) return false;
    const ext=store.state.links.find(l=>_linkHasPair(l, store.linkStart, tgt));
    if(ext){
        // Stesso collegamento già presente: se era automatico, la conferma manuale
        // lo "promuove" a manuale (così non verrà più toccato dall'auto-discovery).
        if(ext.autoLinked){ pushHistory(); win._promoteLinkToManual(ext); markDirty(); }
        _cancelLink(); renderAll(); return true;
    }
    // Priorità al collegamento MANUALE: rimuovi eventuali auto-link concorrenti
    // sulle stesse porte (un cavo manuale sostituisce quello dedotto automaticamente).
    const _isConcurrentAuto = l => l.autoLinked && (_linkTouchesPort(l, store.linkStart) || _linkTouchesPort(l, tgt));
    if(store.state.links.some(_isConcurrentAuto)){
        store.state.links = store.state.links.filter(l => !_isConcurrentAuto(l));
        _invalidateIdx();
    }
    const wpCheck = win._validateWallPortConnection(store.linkStart, tgt);
    if(!wpCheck.ok){
        showAlert(wpCheck.message);
        _cancelLink(); renderAll(); return true;
    }
    if(!win.canAddConnection(store.linkStart)||!win.canAddConnection(tgt)){
        const bp=!win.canAddConnection(store.linkStart)?store.linkStart:tgt;
        showAlert(t('msg.rack.portMaxConnections',{port:bp,max:win.getPortMaxConnections(bp)}));
        _cancelLink(); renderAll(); return true;
    }
    // Tipo di connessione dagli estremi (lib/radio.js): una porta radio si
    // collega SOLO a un'altra porta radio (associazione wireless = tipologia a
    // sé). Mix radio↔porta-di-rete = non ammesso → blocca con messaggio.
    const _srcRadio = typeof _isRadioPid==='function' && _isRadioPid(store.linkStart);
    const _dstRadio = typeof _isRadioPid==='function' && _isRadioPid(tgt);
    const _connKind = (typeof win.linkKind==='function')
        ? win.linkKind(_srcRadio, _dstRadio)
        : (_srcRadio && _dstRadio ? 'wireless' : (!_srcRadio && !_dstRadio ? 'cable' : 'invalid'));
    if(_connKind==='invalid'){
        showAlert(t('radio.onlyRadio'));
        _cancelLink(); renderAll(); return true;
    }
    pushHistory();
    const _newLink=win._createLinkRecord(store.linkStart,tgt);
    // Wireless = connessione radio↔radio (tipologia distinta dal cavo fisico).
    if(_connKind==='wireless') _newLink.wireless=true;
    store.state.links.push(_newLink);
    if(typeof logAudit==='function') logAudit('cable-add', { target:_newLink.label||win._cableAutoLabel(_newLink) });
    if(!store.state.ports[store.linkStart]) store.state.ports[store.linkStart]={};
    if(!store.state.ports[tgt])      store.state.ports[tgt]={};
    store.state.ports[store.linkStart].status='active';
    store.state.ports[tgt].status='active';
    // Associazione wireless: scegli il BSS (SSID) servito (auto se 1, menu se >1).
    if(_connKind==='wireless' && typeof win._assignWirelessBss==='function'){
        win._assignWirelessBss(_newLink);
        if(typeof _invalidateIdx==='function') _invalidateIdx();
        if(typeof propagateVlans==='function') propagateVlans();
    }
    markDirty();
    _cancelLink(); renderAll(); return true;
}

function handlePointerUp(e){
    // Drag/resize: solo tasto sinistro
    if(e.button===0){
        if(win.isPanningFloor){
            win.isPanningFloor=false; markDirty();
            const fp=document.getElementById('floorplan');
            if(fp) fp.style.cursor=win._spaceDown?'grab':'';
            win._renderModeIndicator();
        }
        // Pan rack: lo scroll non e' stato persistito → niente markDirty.
        if(win.isPanningRack){
            win.isPanningRack=false; markDirty();
            document.body.classList.remove('rack-panning');
            const rv=document.getElementById('rack-viewport');
            if(rv) rv.style.cursor=win._spaceDown?'grab':'';
        }
        // Drag rack icon:
        //  - se il drag e' stato armato (movimento > threshold) → commit
        //    (markDirty) e basta, la posizione e' stata aggiornata in
        //    handlePointerMove.
        //  - se NON armato (click puro senza trascinamento) → apri la rack
        //    window a destra. Comportamento uniforme con Topology, dove il
        //    single click sull'icona rack apre subito il pannello.
        if(store.dragRack){
            if(store._dragArmed){
                markDirty();
            } else if(store._viewMode!=='topology'){
                // Map: single click puro apre la rack window.
                const _rid = store.dragRack;
                if(typeof store._rackCollapsed !== 'undefined' && store._rackCollapsed &&
                   typeof toggleRackPanel === 'function') toggleRackPanel();
                if(_rid !== store.state.currentRack && typeof switchRack === 'function'){
                    switchRack(_rid);
                }
                switchRightTab('rack');
                renderAll();
            } else {
                // Topologia: single click NON apre (apre il doppio click), ma
                // SELEZIONA il rack → diventa attivo e fa glow (come gli altri
                // device selezionati). Il single press resta libero per il drag.
                if(store.dragRack !== store.state.currentRack && typeof switchRack === 'function') switchRack(store.dragRack);
            }
            store.dragRack=null; win._renderModeIndicator();
        }
        if(store.dragNode||win.resizeNode){
            const _dn=store.dragNode?nodeById(store.dragNode):null;
            // Esito del drag deciso dal PUNTO DI RILASCIO (non dallo stato dei move, che su
            // un drag veloce può restare "dentro la zona" anche se rilasci fuori):
            //  • dentro la drop-zone di un host  → assorbi come VM;
            //  • sulla planimetria               → riposiziona (commit normale, sotto);
            //  • altrove (pannello/sidebar/fuori)→ AREA SBAGLIATA: il device torna a casa.
            const _drop = _vmDropTargetAtPoint(e.clientX, e.clientY, store.dragNode);
            _clearVmDropTarget();
            const _isFloorDrag = !!(_dn && TYPES[_dn.type]?.isFloor);
            if(_drop.host){
                // Rilascio DENTRO la drop-zone → assorbi (reversibile: pushHistory in
                // absorbNodeAsVm + toast con hint Ctrl+Z). NIENTE riposizionamento.
                const _src=store.dragNode;
                store.dragNode=null;
                absorbNodeAsVm(_src, _drop.host);
            } else if(_isFloorDrag && !_drop.onFloor && _floorDragOrigin){
                // Device floor rilasciato FUORI dalla planimetria e NON sulla zona import
                // → torna alla posizione di partenza + avviso (niente tile "perso" sotto
                // il pannello, niente riposizionamento accidentale fuori scena).
                const _n=nodeById(store.dragNode);
                if(_n){ _n.x=_floorDragOrigin.x; _n.y=_floorDragOrigin.y; }
                store.dragNode=null;   // (resizeNode è già null in un node-drag)
                renderAll();
                _showToast(t('hv.vmImportMissed'), 'info', 4000);
            } else {
                const _wasRackDrag=!!(_dn&&TYPES[_dn.type]?.isRack);
                // Commit del drag (resolveOverlap, pushHistory, markDirty, rerender)
                // solo se davvero ci si e' mossi oltre il threshold. Su un click
                // breve evitiamo history entries vuoti e renderAll() inutili.
                if(store._dragArmed){
                    if(_wasRackDrag) win._resolveRackOverlap(_dn);
                    if(store.dragNode) pushHistory();
                    markDirty();
                }
                const wasResize=!!win.resizeNode;
                store.dragNode=null; win.resizeNode=null;
                // F4-P3: resize stanza → refresh planimetria; _wasRackDrag → renderAll.
                if(store._dragArmed && _wasRackDrag) renderAll();
                else if(store._dragArmed && wasResize) win.renderScope('floor');
                else { win._renderModeIndicator(); renderCables(); }
            }
        }
        // Reset stato threshold per il prossimo ciclo
        store._dragArmed=false; win._dragDownPt=null;
    }
    // Completamento link: solo tasto destro
    if(e.button===2&&store.linkStart){
        const pel=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-pid]');
        const justStarted=win._linkJustStarted;
        win._linkJustStarted=false;
        if(pel&&pel.dataset.pid!==store.linkStart){
            _tryFinishLink(pel.dataset.pid);
        } else if(justStarted){
            // Primo click destro su porta: rimane in modalità collegamento
            renderCables();
        }
    }
}

function handleDoubleClick(e){
    // Priorita 1: porta. Differenziazione per contesto:
    //  - Porta di device FLOOR (wallport, AP, webcam, ecc.) → la scorciatoia
    //    naturale e' "portami al rack collegato per vedere il cavo": switch
    //    al rack corretto, apri il pannello rack (tab Rack), evidenzia trace.
    //  - Porta di device RACK → apri il pannello Proprieta porta (scorciatoia
    //    per evitare il popup e arrivare direttamente all'editor).
    const port = e.target.closest('[data-pid]');
    if(port){
        e.stopPropagation();
        closePop();
        const _pid = port.dataset.pid;
        const _pNode = getNodeByPortId(_pid);
        const _isFloor = _pNode && TYPES[_pNode.type]?.isFloor;
        store.selType='port'; store.selId=_pid;
        trace(_pid);
        win._renderModeIndicator();
        if(_isFloor){
            // Trova il rack collegato dalla store.highPath e ci salta sopra
            let _tgtRack=null;
            for(const _lid of store.highPath){
                const _lk=store.state.links.find(x=>x.id===_lid);
                if(!_lk) continue;
                const _a=getNodeByPortId(_lk.src), _b=getNodeByPortId(_lk.dst);
                if(TYPES[_a?.type]?.isRack&&_a.rackId){_tgtRack=_a.rackId;break;}
                if(TYPES[_b?.type]?.isRack&&_b.rackId){_tgtRack=_b.rackId;break;}
            }
            if(_tgtRack){
                if(typeof store._rackCollapsed !== 'undefined' && store._rackCollapsed &&
                   typeof toggleRackPanel === 'function') toggleRackPanel();
                if(_tgtRack !== store.state.currentRack){
                    store.state.currentRack = _tgtRack;
                    renderRackTabs();
                }
            }
            switchRightTab('rack');
            renderAll();
            return;
        }
        // Porta rack: pannello Proprieta porta come scorciatoia diretta
        switchRightTab('props');
        renderAll(); renderProps();
        return;
    }
    // Priorita 2: device rack — apre le sue proprieta nel pannello a destra
    const el = e.target.closest('.rack-device');
    if(el){
        store.selId = el.dataset.id; store.selType = 'node';
        win._propsExplicit = true;
        win._renderModeIndicator();
        switchRightTab('props');
        renderProps();
    }
}

// Doppio click su planimetria:
//  - su un nodo floor (device/room/rack) → apre il pannello proprieta del nodo
//  - su area vuota o sfondo immagine    → apre il pannello "Contesto progetto"
// NOTA: le porte device floor sono gestite manualmente in handlePointerDown
// con rilevamento dblclick via timestamp (il dblclick nativo non scatta
// perche' il single click ridisegna il DOM tra i due click).
function handleFloorDoubleClick(e){
    // Stessi guard di handlePointerDown per non interferire con UI overlays
    if(e.target.closest('.zoom-controls')||e.target.closest('#floorplan-toolbar-wrap')||
       e.target.closest('#floor-menu-dropdown')||e.target.closest('#topo-legend')||
       e.target.closest('#ui-mode-indicator')) return;
    // Se il target e' una porta floor, lascia gestire al pointerdown handler
    // (rilevamento manuale via timestamp): qui ignoriamo per evitare doppia logica.
    const port = e.target.closest('[data-pid]');
    if(port){
        const _pNode = getNodeByPortId(port.dataset.pid);
        if(_pNode && TYPES[_pNode.type]?.isFloor) return;
    }
    // NOTA: il rack icon e' uniformato tra Map e Topology: il SINGLE click
    // (gestito in handlePointerUp se non armato dal threshold drag) apre la
    // rack window. Qui niente da fare.
    const nodeEl = e.target.closest('.floor-node, .floor-room');
    if(nodeEl && nodeEl.dataset.id){
        e.stopPropagation();
        // Fallback: di norma il doppio click sul nodo floor lo intercetta gia' il
        // rilevamento manuale in handlePointerDown (il dblclick nativo non scatta
        // perche' renderFloor ricostruisce il DOM tra i click). Stessa azione.
        _openFloorNodeProps(nodeEl.dataset.id);
        return;
    }
    // Area vuota della planimetria (sfondo o canvas vuoto): apre il pannello
    // "Contesto progetto" a destra (Mappa + VLAN + IPAM + colori workspace
    // + polling SNMP). Equivale a deselezionare e attivare la tab Proprieta.
    // Il menu dropdown "Planimetria" nell'header resta accessibile come prima.
    if(e.target.closest('#floorplan')){
        e.stopPropagation();
        closePop();
        store.selType = null; store.selId = null;
        win._renderModeIndicator();
        switchRightTab('props');
        renderProps();
    }
}

// Evidenzia il percorso fisico di TUTTE le interfacce (porte + radio) di un nodo
// floor. Usato alla selezione del NODO, così anche una presa a muro / device
// pass-through mostra il run completo come fanno gli endpoint (che colpiscono il
// LED-porta). Strutture (stanze) escluse.
function _traceNodeFloor(nodeId){
    const n = (typeof nodeById==='function') ? nodeById(nodeId) : null;
    const def = n ? TYPES[n.type] : null;
    if(!def || def.isStructural) return;
    const pc = n.ports!==undefined ? n.ports : (def.ports||0);
    for(let i=1;i<=pc;i++) trace(`${nodeId}-${i}`);
    if(Array.isArray(n.radios) && typeof win.radioPid==='function')
        n.radios.forEach((r, idx) => trace(win.radioPid(nodeId, idx)));
}

function trace(start){
    const q=[start],vis=new Set();
    while(q.length){
        const curr=q.shift(); if(vis.has(curr))continue; vis.add(curr);
        // La radio Wi-Fi è un TERMINALE (l'AP): il percorso fisico di un client
        // finisce lì e NON prosegue verso gli altri client che condividono la
        // stessa radio. Eccezione: se parto PROPRIO dalla radio, mostro tutti i
        // suoi client (selezione della radio = tutte le associazioni).
        if(curr!==start && typeof _isRadioPid==='function' && _isRadioPid(curr)) continue;
        for(const l of _linksForPort(curr)){
            const nextPorts = _linkAdjacentPorts(l, curr);
            if(!nextPorts.length) continue;
            store.highPath.add(l.id);
            nextPorts.forEach(nxt=>{ if(!vis.has(nxt)) q.push(nxt); });
        }
    }
}

expose({
    onDragStart, handleDrop, handlePointerDown, handlePointerMove, handlePointerUp,
    handleDoubleClick, handleFloorDoubleClick, _cancelLink, _tryFinishLink, trace,
    _traceNodeFloor,
});
