// ============================================================
// MANAGEMENT PROTOCOLS — glue (migrato a ESM, esbuild)
// ============================================================
// Apre URL tipo https://, ssh://, rdp://, winbox:// delegando al browser o
// all'handler del sistema operativo. Le credenziali non vengono memorizzate:
// l'URL contiene solo schema + IP oppure un override manuale dell'utente.
//
// Dipendenze (legacy app.js via ponte): nodeById, escapeHTML, renderAll.
// Niente lib <script> importato qui. Stato MGMT_PROTOCOLS = privato del modulo
// (nessun lettore esterno) → persistito in localStorage.
import { expose, t } from './_bridge.js';   // (win non più necessario: ultima win.* ritirata in fase 2)
import { escapeHTML } from './app-util.js';
import { nodeById } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)

/** Lista default di fabbrica — usata come fallback e per il reset.
 *  Modificarla in codice e' valido per i nuovi utenti; chi ha gia'
 *  personalizzato vede la propria lista dal localStorage. */
const _DEFAULT_MGMT_PROTOCOLS = [
    { id:'https',  label:'HTTPS',  scheme:'https://'  },
    { id:'http',   label:'HTTP',   scheme:'http://'   },
    { id:'ssh',    label:'SSH',    scheme:'ssh://'    },
    { id:'telnet', label:'Telnet', scheme:'telnet://' },
    { id:'rdp',    label:'RDP',    scheme:'rdp://'    },
    { id:'vnc',    label:'VNC',    scheme:'vnc://'    },
    { id:'winbox', label:'WinBox', scheme:'winbox://' }, // MikroTik
];
const _MGMT_LS_KEY = 'infranet.mgmtProtocols';

function _loadMgmtProtocols(){
    try {
        const s = localStorage.getItem(_MGMT_LS_KEY);
        if(s){
            const arr = JSON.parse(s);
            if(Array.isArray(arr) && arr.length &&
               arr.every(p => p && typeof p.id==='string' && typeof p.label==='string' && typeof p.scheme==='string')){
                return arr;
            }
        }
    } catch(_){}
    return _DEFAULT_MGMT_PROTOCOLS.map(p => ({...p}));
}
function _saveMgmtProtocols(){
    try { localStorage.setItem(_MGMT_LS_KEY, JSON.stringify(MGMT_PROTOCOLS)); } catch(_){}
}
function _resetMgmtProtocols(){
    MGMT_PROTOCOLS = _DEFAULT_MGMT_PROTOCOLS.map(p => ({...p}));
    _saveMgmtProtocols();
}

let MGMT_PROTOCOLS = _loadMgmtProtocols();
function _mgmtProtoDef(id){
    return MGMT_PROTOCOLS.find(p=>p.id===id) || MGMT_PROTOCOLS[0];
}
function _mgmtBuildUrl(protoId, ip){
    if(!ip) return '';
    return _mgmtProtoDef(protoId).scheme + ip;
}

/** Apre un URL di management. Strategia per protocollo:
 *   - http(s):// → nuova tab (browser)
 *   - tutti gli altri scheme (ssh/telnet/rdp/vnc/...) → iframe nascosto:
 *     delega all'handler OS registrato (PuTTY, mRemoteNG, RealVNC,
 *     Royal TS, ecc.). Se l'handler NON e' registrato non succede
 *     niente (fallimento silenzioso) — scelta consapevole: zero popup,
 *     zero download, niente tab bianche.
 *  Chiamata dai pulsanti generati in _mgmtRow. Ritorna false così
 *  l'<a> non fa il navigate di default. */
function _openMgmt(url){
    if(!url) return false;
    if(/^https?:\/\//i.test(url)){
        window.open(url, '_blank', 'noopener');
        return false;
    }
    try {
        const ifr = document.createElement('iframe');
        ifr.style.display = 'none';
        ifr.src = url;
        document.body.appendChild(ifr);
        setTimeout(()=>{ try{ document.body.removeChild(ifr); }catch(_){} }, 2000);
    } catch(_){
        location.href = url;
    }
    return false;
}

/** Riga "Management" riutilizzabile nel pannello Properties.
 *  Modello dati sul nodo:
 *    n.mgmtProto  = protocollo primario ('https' default)
 *    n.mgmtUrl    = URL custom opzionale (override del costruito da proto+ip)
 *  url    = n.mgmtUrl
 *  autoIp = indirizzo IP del nodo (usato per costruire l'URL primario)
 *  nodeId = n.id per gli handler */
function _mgmtRow(url, autoIp, nodeId){
    const n        = nodeById(nodeId);
    const proto    = n?.mgmtProto || 'https';
    const custom   = (url||'').trim();
    const primary  = custom || _mgmtBuildUrl(proto, autoIp);
    const canOpen  = !!primary;
    const primDef  = _mgmtProtoDef(proto);
    const protoOpts = MGMT_PROTOCOLS.map(p =>
        `<option value="${p.id}" ${p.id===proto?'selected':''}>${p.label}</option>`).join('');
    return `<div class="prop-group mgmt-block">
      <label style="display:flex;align-items:center;justify-content:space-between">
        <span>Management</span>
        <a href="${escapeHTML(primary)}"
           onclick="return _openMgmt(this.href)"
           id="mgmt-open-${nodeId}"
           class="mgmt-open-btn"
           style="${canOpen?'':'opacity:.35;pointer-events:none'}"
           data-tip="${t('pnl.misc.openOn',{label:primDef.label,ip:autoIp||'?'})}">
          <i class="fas fa-external-link-alt" style="font-size:0.65rem;margin-right:3px"></i>${t('pnl.misc.open',{label:primDef.label})}
        </a>
      </label>
      <div class="mgmt-row-main">
        <select class="mgmt-proto-sel" onchange="updateN('mgmtProto',this.value)" data-tip="${t('pnl.misc.mgmtProtoApp')}">${protoOpts}</select>
        <input value="${escapeHTML(url||'')}"
               placeholder="${escapeHTML(_mgmtBuildUrl(proto, autoIp)||'es. https://192.168.1.1')}"
               oninput="_updateMgmtRow('${nodeId}',this.value)"
               onchange="updateN('mgmtUrl',this.value)"
               data-tip="${t('pnl.misc.urlOptionalOverride')}">
        <button type="button" class="mgmt-proto-edit" onclick="_openMgmtProtoEditor()" data-tip="${t('pnl.misc.manageProtocols')}"><i class="fas fa-cog"></i></button>
      </div>
    </div>`;
}

// ---- Editor protocolli management --------------------------------------
function _openMgmtProtoEditor(){
    const ov = document.getElementById('mgmt-proto-overlay');
    if(!ov) return;
    _renderMgmtProtoEditor();
    ov.style.display = 'flex';
}
function _closeMgmtProtoEditor(){
    const ov = document.getElementById('mgmt-proto-overlay');
    if(ov) ov.style.display = 'none';
    renderAll(); // ricostruisce il dropdown nel pannello proprieta
}
function _renderMgmtProtoEditor(){
    const tb = document.getElementById('mgmt-proto-tbody');
    if(!tb) return;
    tb.innerHTML = MGMT_PROTOCOLS.map((p,i) => `
        <tr>
            <td><input value="${escapeHTML(p.label)}" oninput="_updateMgmtProtoField(${i},'label',this.value)"></td>
            <td><input value="${escapeHTML(p.scheme)}" oninput="_updateMgmtProtoField(${i},'scheme',this.value)" placeholder="es. winbox://"></td>
            <td><code style="font-size:0.7rem;color:var(--text-muted)">${escapeHTML(p.id)}</code></td>
            <td><button class="toolbar-btn" onclick="_deleteMgmtProto(${i})" data-tip="${t('pnl.misc.remove')}" style="padding:2px 7px"><i class="fas fa-trash"></i></button></td>
        </tr>
    `).join('');
}
function _updateMgmtProtoField(idx, field, val){
    if(!MGMT_PROTOCOLS[idx]) return;
    MGMT_PROTOCOLS[idx][field] = val;
    _saveMgmtProtocols();
}
function _addMgmtProto(){
    const id = 'p_' + Math.random().toString(36).slice(2,8);
    MGMT_PROTOCOLS.push({ id, label:'Nuovo', scheme:'app://' });
    _saveMgmtProtocols();
    _renderMgmtProtoEditor();
}
function _deleteMgmtProto(idx){
    if(!MGMT_PROTOCOLS[idx]) return;
    if(MGMT_PROTOCOLS.length <= 1){ alert(t('msg.ui.minOneProtocol')); return; }
    MGMT_PROTOCOLS.splice(idx, 1);
    _saveMgmtProtocols();
    _renderMgmtProtoEditor();
}
function _resetMgmtProtoEditor(){
    if(!confirm(t('msg.ui.resetProtocols'))) return;
    _resetMgmtProtocols();
    _renderMgmtProtoEditor();
}

function _updateMgmtRow(nodeId, val){
    /* Aggiorna in tempo reale href e label del pulsante Apri senza re-render */
    const a = document.getElementById('mgmt-open-'+nodeId);
    if(!a) return;
    const n = nodeById(nodeId);
    const proto = n?.mgmtProto || 'https';
    const fallback = n?.ip ? _mgmtBuildUrl(proto, n.ip) : '';
    const target = val.trim() || fallback;
    if(target){ a.href=target; a.style.opacity='1'; a.style.pointerEvents=''; }
    else       { a.removeAttribute('href'); a.style.opacity='.35'; a.style.pointerEvents='none'; }
}

// Esposti su window: _mgmtRow (chiamato da app-properties.js) + tutti gli
// handler inline onclick/oninput delle HTML generate e dei pulsanti overlay.
expose({
    _mgmtRow, _openMgmt, _openMgmtProtoEditor, _closeMgmtProtoEditor,
    _updateMgmtRow, _updateMgmtProtoField, _addMgmtProto, _deleteMgmtProto,
    _resetMgmtProtoEditor,
});
