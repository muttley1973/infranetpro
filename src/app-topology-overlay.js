import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML } from './app-util.js';
import { nodeById, getPortNodeId, _showToast } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)
import { _portDisplayName } from './app-ports.js';   // ritiro ponte: funzioni foglia UI/vlan/popup (ex win.*)
import { _getLinkTrunk } from './app-vlan-autopoll.js';   // ritiro ponte: funzioni foglia UI/vlan/popup (ex win.*)
import { _findPortByIfName } from './app-topology-discover.js';   // ritiro ponte: funzioni topo/discovery/vlan/snmp (ex win.*)
import { _getLinkVlan, toggleTopoTrunkFilter, toggleTopoEndpointFilter, toggleTopoWlanFilter, _linkMatchesVlanFilter, _rackPairMatchesVlan, _findProjectLinkByPorts, _drawFanoutLineDesc, _rectEdge, _showTopoTip, _hideTopoTip, _showPhysicalCablePath } from './app-popup.js';   // ritiro ponte: funzioni disc/props/vlan/hv (ex win.*)

// ============================================================
// TOPOLOGIA — OVERLAY SULLA PLANIMETRIA
// renderTopoOverlay (coalesced), legenda VLAN pillole, disegno linee.
// Estratto da app.js (refactoring R4). Plain script, scope globale.
//
// HARDENING (sessione 22): il "COSA disegnare" (pairMap a 3 passate,
// risoluzione colore, fanout, badge) e' calcolato da win.buildTopoLines
// (lib/topo-lines.js, PURA e testata). Qui resta solo il "COME":
// ancoraggio alle dimensioni DOM, creazione SVG, eventi.
// ============================================================

/**
 * Disegna i link LLDP/CDP scoperti direttamente sulla planimetria come linee
 * SVG colorate tra le icone rack (o tra i floor node se entrambi sono a pavimento).
 *
 * Colori:
 *   verde continuo  = link confermato (esiste già un cavo nel progetto)
 *   ciano tratteggiato  = link LLDP nuovo
 *   arancione tratteggiato = link CDP nuovo
 *
 * Deduplica: più link tra la stessa coppia rack → un'unica linea più spessa
 * con un cerchio-badge che mostra il conteggio.
 */
// F4-P2: coalescing per renderTopoOverlay (stesso pattern di renderAll).
// Durante hover rapido del rack icon e drag su mappa la funzione veniva
// chiamata 60+ volte al secondo. Ora N chiamate ravvicinate collassano
// in 1 sola per frame. _renderTopoOverlayNow() forza render immediato.
let _topoOverlayPending = false;
export function renderTopoOverlay(){
    if(_topoOverlayPending) return;
    _topoOverlayPending = true;
    requestAnimationFrame(()=>{ _topoOverlayPending = false; _renderTopoOverlayNow(); });
}
// Legenda dinamica della vista topologia. Mostra pillole VLAN cliccabili
// per filtrare la mappa. Click su pillola = applica/rimuove filtro VLAN.
// Doppio click = apre modal win.showVlanMembers (porte access + trunk link).
let _topoLegendBound = false;
export function _renderTopoLegend(){
    const el = document.getElementById('topo-legend');
    if(!el) return;
    // Visibile in entrambe le viste:
    //  - Topology: pillole CLICCABILI (filtro), titolo "Filtra VLAN", hint con click/dblclick
    //  - Map     : pillole INERTI (solo info), titolo "Legenda VLAN", niente hint
    // Legenda SEMPRE attiva e interattiva, in entrambe le viste (Map +
    // Topologia): pillole VLAN cliccabili (filtro) + pillola TRUNK. Supera il
    // vecchio toggle opzionale "Legenda sulla mappa".
    const isInteractive = true;
    // Event delegation: un solo listener, sopravvive ai re-render del innerHTML.
    // Il listener stesso controlla isInteractive prima di agire.
    if(!_topoLegendBound){
        el.addEventListener('click', e => {
            if(!el.classList.contains('mode-interactive')) return;
            // Pillola TRUNK: evidenzia i collegamenti trunk (attenua il resto).
            if(e.target.closest('.topo-leg-trunk')){
                if(typeof toggleTopoTrunkFilter === 'function') toggleTopoTrunkFilter();
                return;
            }
            // Pillola ENDPOINT: nasconde le linee verso gli endpoint.
            if(e.target.closest('.topo-leg-endpoint')){
                if(typeof toggleTopoEndpointFilter === 'function') toggleTopoEndpointFilter();
                return;
            }
            // Pillola WLAN: nasconde tutte le connessioni wireless (onde).
            if(e.target.closest('.topo-leg-wlan')){
                if(typeof toggleTopoWlanFilter === 'function') toggleTopoWlanFilter();
                return;
            }
            const pill = e.target.closest('.topo-leg-vlan');
            if(!pill) return;
            const vid = parseInt(pill.dataset.vid, 10);
            if(isNaN(vid)) return;
            if(typeof win.setVlanFilter !== 'function') return;
            win.setVlanFilter(store._filterVlan === vid ? null : vid);
        });
        el.addEventListener('dblclick', e => {
            if(!el.classList.contains('mode-interactive')) return;
            const pill = e.target.closest('.topo-leg-vlan');
            if(!pill) return;
            e.stopPropagation();
            const vid = parseInt(pill.dataset.vid, 10);
            if(isNaN(vid)) return;
            if(typeof win.showVlanMembers === 'function') win.showVlanMembers(vid);
        });
        _topoLegendBound = true;
    }
    const vlanIds = Object.keys(store.state.vlanColors || {}).map(Number).filter(v=>!isNaN(v)).sort((a,b)=>a-b);
    const titleLabel = isInteractive ? t('pnl.disc.filterVlan') : t('pnl.disc.legendVlan');
    let html = `<div class="topo-leg-title"><i class="fas fa-filter"></i>${titleLabel}</div>`;
    if(!vlanIds.length){
        html += `<span class="topo-leg-empty">${t('pnl.disc.noVlanDefined')}</span>`;
    } else {
        html += `<div class="topo-leg-vlan-list">`;
        const guestSet = new Set((store.state.guestVlans || []).map(Number));
        vlanIds.forEach(vid => {
            const col = store.state.vlanColors[vid] || '#8b949e';
            const name = store.state.vlanNames?.[vid] || '';
            const isActive = isInteractive && store._filterVlan === vid;
            const isGuest = guestSet.has(vid);
            // Tratteggio = indicatore passivo "endpoint" (il toggle vive nel pannello VLAN).
            const tip = (name ? `VLAN ${vid} — ${name}` : `VLAN ${vid}`) + (isGuest ? ' · ' + t('pnl.disc.vlanGuestSuffix') : '');
            html += `<span class="topo-leg-vlan${isActive?' active':''}${isGuest?' guest':''}" data-vid="${vid}" data-tip="${escapeHTML(tip)}" data-tip-pos="bottom" style="background:${col}2e;color:${col}"><span class="vlan-dot" style="background:${col}"></span>${vid}</span>`;
        });
        html += `</div>`;
    }
    // Pillola TRUNK (solo in topologia): toggle che evidenzia i collegamenti
    // trunk attenuando il resto — stesso modello interattivo del filtro VLAN.
    if(isInteractive){
        // TRUNK / ENDPOINT / WLAN agiscono SOLO sulla topologia (win.buildTopoLines /
        // CSS .view-topology): sul floor non hanno effetto → mostrali solo in
        // topologia, così il filtro sul floor resta pulito. L'ex pillola "TRUNK SU
        // RACK" è stata rimossa qui: l'evidenza/mappa dei trunk vive in Topologia.
        const _inTopo = (typeof store._viewMode !== 'undefined') && store._viewMode === 'topology';
        if(_inTopo){
            // Separa le pillole VLAN dai toggle (il border-right della vlan-list è
            // stato tolto per non duplicare il | prima del bottone Topologia).
            html += `<span class="topo-leg-sep"></span>`;
            // TRUNK è un'AZIONE (evidenzia): grigio di default, si accende quando attivo.
            const trunkOn = (typeof store._topoTrunkOnly !== 'undefined') && store._topoTrunkOnly;
            html += `<span class="topo-leg-trunk${trunkOn?' active':''}" data-tip="${t('pnl.disc.tipTrunk')}" data-tip-pos="bottom"><i class="fas fa-code-branch"></i>TRUNK</span>`;
            // ENDPOINT e WLAN sono "mostra/nascondi": ACCESI di default (tutto mostrato),
            // grigi quando il filtro nasconde.
            html += `<span class="topo-leg-sep"></span>`;
            const epOff = (typeof store._topoHideEndpoints !== 'undefined') && store._topoHideEndpoints;
            html += `<span class="topo-leg-endpoint${!epOff?' active':''}" data-tip="${t('pnl.disc.tipEndpoint')}" data-tip-pos="bottom"><i class="fas fa-circle-nodes"></i>ENDPOINT</span>`;
            html += `<span class="topo-leg-sep"></span>`;
            const wlOff = (typeof store._topoHideWireless !== 'undefined') && store._topoHideWireless;
            html += `<span class="topo-leg-wlan${!wlOff?' active':''}" data-tip="${t('pnl.disc.tipWlan')}" data-tip-pos="bottom"><i class="fas fa-wifi"></i>WLAN</span>`;
        }
    }
    el.innerHTML = html;
    el.classList.add('visible');
    el.classList.toggle('mode-interactive', isInteractive);
}

// ---- Model per win.buildTopoLines (lib/topo-lines.js, pura) ----------------------
// Snapshot plain-data + helper iniettati. Il "cosa disegnare" e' calcolato
// dalla lib testabile; ogni nuova regola di visibilita'/colore va li' (con
// test), NON nel codice di disegno qui sotto.
function _buildTopoModel(){
    return {
        nodes: store.state.nodes, links: store.state.links, racks: store.state.racks,
        types: TYPES,
        topoData: store._topoData,
        currentRack: store.state.currentRack,
        hoverRackId: store._hoverRackId,
        filterVlan: store._filterVlan,
        trunkOnly: (typeof store._topoTrunkOnly !== 'undefined') && store._topoTrunkOnly,
        hideEndpoints: (typeof store._topoHideEndpoints !== 'undefined') && store._topoHideEndpoints,
        hideWireless: (typeof store._topoHideWireless !== 'undefined') && store._topoHideWireless,
        physicalTrace: (typeof store._physicalTraceActive !== 'undefined') && store._physicalTraceActive,
        vlanColors: store.state.vlanColors || {},
        highPathIds: store.highPath,
        selectedLinkId: (store.selType === 'link') ? store.selId : null,
        helpers: {
            portNodeId: getPortNodeId,
            portDisplayName: _portDisplayName,
            linkVlan: _getLinkVlan,
            // Trunk EFFETTIVO (anche derivato da voce/SSID): i trunk derivati si
            // comportano da trunk in topologia (pillola, toggle "solo trunk").
            linkIsTrunk: (typeof win._linkIsTrunk==='function') ? win._linkIsTrunk : null,
            linkTrunkVlans: (typeof _getLinkTrunk==='function') ? (l=>_getLinkTrunk(l).vlans.join(',')) : null,
            linkMatchesVlanFilter: _linkMatchesVlanFilter,
            rackPairMatchesVlan: _rackPairMatchesVlan,
            isAmbiguousLink: l => typeof win.linkState === 'function' && win.linkState(l).key === 'ambiguous',
            chainAmbiguousIds: (typeof win._chainAmbiguousLinkIds === 'function') ? win._chainAmbiguousLinkIds() : null,
            chainColors: (typeof win._chainVlanColors === 'function') ? win._chainVlanColors() : null,
            findPortByIfName: _findPortByIfName,
            findProjectLinkByPorts: _findProjectLinkByPorts,
        }
    };
}

function _renderTopoOverlayNow(){
    _renderTopoLegend();
    const svg=document.getElementById('topo-floor-overlay');
    if(!svg) return;
    svg.innerHTML='';
    if(!store._topoVisible || store._viewMode!=='topology') return;

    const NS='http://www.w3.org/2000/svg';
    // App dark-only oggi; theme-aware per il futuro: se `data-theme="light"` e'
    // attivo (scheletro), i rami isDark?: del rendering SVG passano al chiaro.
    const isDark = document.documentElement.dataset.theme !== 'light';

    // PERF: indici DOM O(1) costruiti UNA sola volta per render e PASSATI ai draw come
    // argomento (niente nuovi globali-ponte). Prima ogni coppia/fanout faceva 2x
    // document.querySelector('.floor-node[data-id=...]') = O(DOM) ciascuno → migliaia di
    // scansioni del documento su reti grandi. first-wins come querySelector.
    const els = { nodes: new Map(), racks: new Map() };
    for(const el of document.querySelectorAll('.floor-node[data-id]')){ const id=el.getAttribute('data-id'); if(!els.nodes.has(id)) els.nodes.set(id, el); }
    for(const el of document.querySelectorAll('.floor-rack[data-rackid]')){ const id=el.getAttribute('data-rackid'); if(!els.racks.has(id)) els.racks.set(id, el); }

    const { pairs, fanout, rackAlerts } = win.buildTopoLines(_buildTopoModel());
    // PERF: si disegna in un DocumentFragment (STACCATO dal DOM live) e si appende UNA
    // volta sola alla fine → niente layout-thrashing. Le letture offsetWidth nel loop NON
    // forzano piu' un reflow a ogni append, perche' il DOM live non viene toccato fino
    // all'append finale. Output SVG identico (stessi elementi, stesso ordine). web.dev.
    const frag=document.createDocumentFragment();
    for(const p of pairs) _drawTopoPair(p, frag, NS, isDark, els);
    for(const f of fanout) _drawFanoutLineDesc(f, frag, NS, els);
    for(const a of rackAlerts) _drawRackAlert(a, frag, NS, isDark, els);
    svg.appendChild(frag);
}

// ---- Disegno di una coppia aggregata (rack↔rack o floor↔floor) ----------------
function _drawTopoPair(p, svg, NS, isDark, els){
    // Ancoraggio al bordo esterno dell'icona (non al centro): usa le dimensioni
    // DOM correnti (offsetWidth/offsetHeight) — l'unica informazione che la lib
    // pura non puo' conoscere.
    let [x1,y1]=[p.sx,p.sy], [x2,y2]=[p.dx,p.dy];
    const GAP=4; // pixel di margine oltre il bordo
    const elA = p.kind==='rack-rack'
        ? els?.racks.get(p.rackAId)
        : els?.nodes.get(p.nodeAId);
    const elB = p.kind==='rack-rack'
        ? els?.racks.get(p.rackBId)
        : els?.nodes.get(p.nodeBId);
    if(elA){
        const hw=elA.offsetWidth/2+GAP, hh=elA.offsetHeight/2+GAP;
        [x1,y1]=_rectEdge(p.sx,p.sy,hw,hh,p.dx-p.sx,p.dy-p.sy);
    }
    if(elB){
        const hw=elB.offsetWidth/2+GAP, hh=elB.offsetHeight/2+GAP;
        [x2,y2]=_rectEdge(p.dx,p.dy,hw,hh,p.sx-p.dx,p.sy-p.dy);
    }

    // Wireless floor↔floor: l'onda parte dall'ANCORA della radio associata (non
    // dal bordo generico del tile). Dal pid radio dell'edge → indice → slot
    // perimetrale → vettore d'angolo, applicato a mezza-dimensione DOM del tile.
    if(p.wireless && p.kind==='floor-floor' && typeof win.parseRadioPid==='function'){
        const _edge = (p.edges||[]).find(e=>e && (e.srcPid||e.dstPid)) || null;
        const _radioPt = (nodeId, el, cx, cy) => {
            if(!_edge || !el) return null;
            const pid = [_edge.srcPid,_edge.dstPid].find(pp => pp && typeof getPortNodeId==='function' && getPortNodeId(pp)===nodeId);
            const pr = pid ? win.parseRadioPid(pid) : null;
            if(!pr) return null;
            const cnt = (typeof win.radioCount==='function') ? win.radioCount(nodeById(nodeId)) : 0;
            const v = (typeof win.radioAnchorVector==='function') ? win.radioAnchorVector(pr.idx, cnt) : null;
            if(!v) return null;
            return [cx + v[0]*(el.offsetWidth/2+GAP), cy + v[1]*(el.offsetHeight/2+GAP)];
        };
        const _a = _radioPt(p.nodeAId, elA, p.sx, p.sy);
        const _b = _radioPt(p.nodeBId, elB, p.dx, p.dy);
        if(_a){ x1=_a[0]; y1=_a[1]; }
        if(_b){ x2=_b[0]; y2=_b[1]; }
    }

    // Linea trasparente allargata per facilitare l'hover (hit area)
    const hit=document.createElementNS(NS,'line');
    hit.setAttribute('x1',x1); hit.setAttribute('y1',y1);
    hit.setAttribute('x2',x2); hit.setAttribute('y2',y2);
    hit.setAttribute('stroke','transparent');
    hit.setAttribute('stroke-width','18');
    hit.setAttribute('style','pointer-events:visibleStroke;cursor:pointer');
    hit.setAttribute('data-pair',p.key);

    // Linea visibile. tfl-hl (glow) viene aggiunto SOLO su hover: il glow e'
    // un feedback di hover, non uno stato persistente di selezione.
    // Wireless: linea "a onda" (path sinusoidale) invece di retta.
    const _wl = p.wireless && typeof win.buildWavePath === 'function';
    const line=document.createElementNS(NS, _wl ? 'path' : 'line');
    if(_wl){ line.setAttribute('d', win.buildWavePath(x1,y1,x2,y2,{ amplitude:4, wavelength:20 })); }
    else { line.setAttribute('x1',x1); line.setAttribute('y1',y1); line.setAttribute('x2',x2); line.setAttribute('y2',y2); }
    line.setAttribute('class',`tfl topo-selected-cable${p.ambiguous?' tfl-ambiguous':''}${_wl?' tfl-wireless':''}`);
    line.setAttribute('stroke-width',p.width.toFixed(1));
    line.setAttribute('opacity', (p.selected && !p.trunkDim) ? '1' : (p.trunkDim ? '0.12' : '0.88'));   // selected (percorso fisico) acceso; toggle TRUNK attenua le non-trunk
    line.setAttribute('style',`pointer-events:none;stroke:${p.color};color:${p.color}${_wl?';fill:none':''}`);
    line.setAttribute('data-pair',p.key);

    // Struttura tipData per il tooltip
    const td={
        pairKey:p.key, rackAId:p.rackAId, rackBId:p.rackBId,
        srcName:p.srcName, dstName:p.dstName,
        protocol:p.protocol, confirmed:p.confirmed, edges:p.edges
    };

    // Event handlers sulla hit area
    hit.addEventListener('pointerenter', ev=>{
        clearTimeout(win._topoTipTimer);
        _showTopoTip(ev, td);
        line.classList.add('tfl-hl');
    });
    hit.addEventListener('pointermove', ev=>{
        const tip=document.getElementById('topo-tip');
        if(tip&&tip.style.display!=='none'&&tip.dataset.userPlaced!=='1'){
            tip.style.left=(ev.clientX+14)+'px';
            tip.style.top=(ev.clientY-10)+'px';
            requestAnimationFrame(()=>{
                const r=tip.getBoundingClientRect();
                if(r.right>window.innerWidth-8) tip.style.left=(ev.clientX-r.width-14)+'px';
                if(r.bottom>window.innerHeight-8) tip.style.top=(ev.clientY-r.height+10)+'px';
            });
        }
    });
    hit.addEventListener('pointerleave', ()=>{
        win._topoTipTimer=setTimeout(_hideTopoTip, 300);
        line.classList.remove('tfl-hl');
    });
    hit.addEventListener('pointerdown', ev=>{
        ev.stopPropagation();
    });
    hit.addEventListener('click', ev=>{
        ev.stopPropagation();
        _showTopoTip(ev, td);
        // (niente glow persistente al click: il glow e' solo feedback di hover)
    });
    // Doppio click → percorso fisico del cavo (rack+floor+catena evidenziati);
    // da lì l'utente clicca il segmento da editare (lo seleziona → Proprietà).
    hit.addEventListener('dblclick', ev=>{
        ev.stopPropagation(); ev.preventDefault();
        const lid = p.edges.find(e=>e.linkId)?.linkId;
        if(lid && typeof _showPhysicalCablePath==='function') _showPhysicalCablePath(lid);
        else _showToast(t('msg.ui.cableNotInProject'), 'warn', 3500);
    });

    // Gruppo
    const g=document.createElementNS(NS,'g');
    g.appendChild(line);
    g.appendChild(hit);
    svg.appendChild(g);

    // Badge conteggio (se >1 link tra stessa coppia)
    if(p.count>1){
        const mx=(x1+x2)/2, my=(y1+y2)/2;
        const badgeOp = p.trunkDim ? '0.12' : '1';
        const circ=document.createElementNS(NS,'circle');
        circ.setAttribute('cx',mx); circ.setAttribute('cy',my);
        circ.setAttribute('r','9');
        circ.setAttribute('fill',p.color);
        circ.setAttribute('stroke', isDark?'#0d1117':'#f0f2f5');
        circ.setAttribute('stroke-width','1.5');
        circ.setAttribute('opacity',badgeOp);
        circ.setAttribute('style','pointer-events:none');
        svg.appendChild(circ);
        const txt=document.createElementNS(NS,'text');
        txt.setAttribute('x',mx); txt.setAttribute('y',my);
        txt.setAttribute('class','tfl-badge');
        txt.setAttribute('opacity',badgeOp);
        txt.setAttribute('style','pointer-events:none');
        txt.textContent=String(p.count);
        svg.appendChild(txt);
    }
}

// ---- Badge alert sul rack con cavi INTRA-rack inferiti ------------------------
// La topology mostra solo le connessioni inter-rack: i cavi inferiti dentro lo
// stesso rack non avrebbero rappresentazione, quindi badge giallo "!" in alto a
// destra → l'utente capisce di dover entrare nella rack view di quel rack.
function _drawRackAlert(a, svg, NS, isDark, els){
    const rackEl = els?.racks.get(a.rackId);
    if(!rackEl) return;
    const hw = rackEl.offsetWidth / 2;
    const hh = rackEl.offsetHeight / 2;
    // Badge in alto a destra del rack icon
    const cx = a.x + hw - 4;
    const cy = a.y - hh + 4;
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'topo-rack-alert');
    g.setAttribute('transform', `translate(${cx} ${cy})`);
    g.style.cursor = 'pointer';
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('r', '10');
    circle.setAttribute('fill', '#e3b341');
    circle.setAttribute('stroke', isDark ? '#1a1d24' : '#ffffff');
    circle.setAttribute('stroke-width', '1.8');
    g.appendChild(circle);
    const txt = document.createElementNS(NS, 'text');
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('dominant-baseline', 'central');
    txt.setAttribute('fill', '#1a1d24');
    txt.setAttribute('font-size', '13');
    txt.setAttribute('font-weight', '700');
    txt.setAttribute('y', '0.5');
    txt.textContent = '!';
    g.appendChild(txt);
    const title = document.createElementNS(NS, 'title');
    title.textContent = t('pnl.disc.rackIntraCableAlert',{name:a.name});
    g.appendChild(title);
    svg.appendChild(g);
}

expose({ renderTopoOverlay, _renderTopoLegend });
