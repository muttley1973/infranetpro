// ============================================================
// L3 GATEWAY (lite) — orchestratore + UI (migrato a ESM, esbuild)
// ============================================================
// Collega lo state al modulo puro lib/l3-gateway.js. Promuove il "gateway"
// della VLAN (IPAM-lite) da stringa IP a RELAZIONE VLAN → device che instrada.
// Manual-first: l'aggancio per IP è solo un suggerimento; la scelta esplicita
// (state.ipam.vlans[vid].gatewayNodeId) vince e non viene mai sovrascritta.
//
// Dipendenze: t dal ponte (i18n <script>); buildL3Report (l3-gateway.js <script>)
// e _parseCidrInfo/_ipInCidr (cidr.js <script>) via win.; globali legacy app.js
// via win. (state, getNodeDisplayName, escapeHTML, updateVlanIpam,
// _ipamUsageForVlan, _propsSectionIsOpen, setPropsSectionState, closeReportMenu).
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML } from './app-util.js';
import { getNodeDisplayName, _ipamUsageForVlan } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { registerClickActions, registerChangeActions } from './app-delegation.js';   // ASSE B: voce menu Report + report L3 (template dinamico) via event delegation
import { _propsSectionIsOpen } from './app-properties.js';   // ritiro ponte: builder pannello (ex win.*)
import { closeReportMenu } from './app-auth.js';   // ritiro ponte: coda funzioni A (batch 1/2) (ex win.*)
import { updateVlanIpam } from './app-vlan-autopoll.js';   // ritiro ponte: coda funzioni A (batch 2/2) (ex win.*)
import { vmIps } from '../lib/vm-nics.js';   // lib pura importata ESM (come lib/ipv6.js): NON un globale su window
import { ipamByVidView, prefixesOf } from '../lib/ipam-model.js';   // vista per-VLAN derivata dall'autorità sui prefissi (+ l'autorità stessa, per l'audit)

// Tipi che possono fare da gateway L3 (per il dropdown di scelta).
const _L3_GATEWAY_TYPES = ['router', 'firewall', 'switch'];

// ── Modello per il modulo puro ───────────────────────────────────────
// Pseudo-nodi «IP di una VM»: le VM dichiarate sugli host (node.vms[]) hanno IP
// propri che finora NESSUN motore vedeva → un IP assegnato sia a una VM sia a un
// device fisico sfuggiva all'audit. Tutti i DCIM di riferimento tengono gli IP
// delle VM nello STESSO IPAM dei device fisici, e questo È il caso d'uso reale
// (un host ospita più VM sulla stessa subnet di management).
// L'id `vm:<host>:<vm>:<nic>` NON è un nodo del progetto: serve solo a dare
// identità stabile alla riga nel report duplicati.
// Una riga PER vNIC (78ª): una VM multi-homed ha un indirizzo per scheda, e un
// duplicato sulla seconda gamba è un conflitto vero quanto uno sulla prima.
// L'etichetta nomina la scheda solo quando ce n'è più d'una — con una sola
// vNIC (il caso normale) la riga resta identica a prima.
function _vmIpNodes(){
    const out = [];
    for(const n of (store.state.nodes || [])){
        if(!Array.isArray(n.vms)) continue;
        const hostName = getNodeDisplayName(n) || n.name || n.id;
        for(const vm of n.vms){
            const ips = vmIps(vm);
            for(const e of ips){
                const nicLabel = (ips.length > 1) ? ` · ${e.name || e.nicId}` : '';
                out.push({
                    id: `vm:${n.id}:${vm.id}:${e.nicId}`,
                    name: `${vm.name || 'VM'}${nicLabel} (VM · ${hostName})`,
                    ip: e.ip, type: 'vm',
                });
            }
        }
    }
    return out;
}

function _l3BuildModel(withUsage, opts){
    const vlanColors = store.state.vlanColors || {};
    const vlans = Object.keys(vlanColors).map(v => {
        const vid = +v;
        return { vid, name: store.state.vlanNames?.[vid] || '', color: vlanColors[v] || '' };
    });
    // Vista derivata: `subnet`/`gateway`/`dns` dal prefisso principale della VLAN,
    // `gatewayNodeId` dal record VLAN. Il report L3 è per-VLAN perché l'interfaccia
    // SVI del router è una per VLAN — non una per prefisso.
    const ipamByVid = ipamByVidView(store.state);
    // «IP del device» = campo manuale n.ip OPPURE l'host di integrazione (SNMP).
    // Definizione uniforme al resto dei motori (lib/api-shape.js, drift-snapshot,
    // _collectKnownIps): senza questo un device SNMP-only (ip in integration.host)
    // risultava «gateway orfano» e i suoi IP duplicati sfuggivano all'audit IPAM.
    const nodes = (store.state.nodes || []).map(n => ({
        id: n.id, name: getNodeDisplayName(n) || n.name || n.id,
        ip: n.ip || (n.integration && n.integration.host) || '', type: n.type,
    }));
    // Gli IP delle VM entrano SOLO nell'audit igiene (duplicati), non nella
    // risoluzione del gateway: quel binding pilota badge e tendine sui nodi VERI
    // del progetto, e una VM non è un nodo. In coda alla lista, così un device
    // fisico con lo stesso IP resta comunque il primo match del gateway.
    if(opts && opts.withVmIps) nodes.push(..._vmIpNodes());
    const usageByVid = {};
    if(withUsage && typeof _ipamUsageForVlan === 'function'){
        for(const v of vlans){ try { usageByVid[String(v.vid)] = _ipamUsageForVlan(v.vid).usedCount; } catch(_){} }
    }
    // `prefixes` = l'autorità, non la vista: l'igiene IPAM confronta TUTTI i prefissi
    // dichiarati, comprese le reti senza VLAN e il secondo prefisso di una VLAN
    // dual-stack — che `ipamByVid` (uno per VLAN) non può mostrare. Il report L3
    // resta per-VLAN e ignora questo campo.
    return { vlans, ipamByVid, prefixes: prefixesOf(store.state), nodes, usageByVid, parseCidr: win._parseCidrInfo, ipInCidr: win._ipInCidr };
}
export function _l3Compute(withUsage){ return win.buildL3Report(_l3BuildModel(withUsage)); }

// Igiene IPAM (doc↔doc) per la Panoramica ② «Vero»: IP duplicati + overlap di
// subnet. Riusa QUESTO modello (stesso dell'overlay L3), che include gli IP delle
// VM dichiarate — così un IP condiviso VM↔fisico non sfugge come «0 duplicati».
// `buildIpamAudit` è il <script> lib/ipam-audit.js (globale, non ri-bundlato).
// Ritorna null se l'igiene NON è stata calcolata (lib assente o errore): «non
// valutato» ≠ «nessun conflitto». Prima il ripiego era una rete pulita, e un
// fallimento del motore usciva come verdetto VERDE (② no-invenzioni).
export function _ipamAuditReport(){
    try {
        if(typeof buildIpamAudit === 'function') return buildIpamAudit(_l3BuildModel(false, { withVmIps: true }));
    } catch(_){ /* niente errori in Panoramica: si degrada a «non valutato» */ }
    return null;
}

// Set dei node-id che fanno da gateway L3 (per il badge). Senza usage → leggero.
// Chiamato UNA volta per render (render-core lo calcola prima del loop nodi).
export function _l3GatewayNodeIds(){
    try { return new Set(_l3Compute(false).l3NodeIds.map(String)); }
    catch(_){ return new Set(); }
}

// Device candidati come gateway (per il dropdown della card IPAM). Include
// sempre il nodo gia' legato, anche se di tipo fuori lista (binding esplicito
// dell'utente: non lo nascondiamo).
function _l3CandidateNodes(currentId){
    const cur = currentId ? String(currentId) : '';
    return (store.state.nodes || [])
        .filter(n => _L3_GATEWAY_TYPES.includes(n.type) || String(n.id) === cur)
        .map(n => ({ id: n.id, name: getNodeDisplayName(n) || n.name || n.id, ip: n.ip || '' }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// ── Setter binding (manual-first) ────────────────────────────────────
function updateVlanGatewayNode(vid, nodeId){
    // Riusa updateVlanIpam: stringa vuota → cancella il campo.
    updateVlanIpam(+vid, 'gatewayNodeId', nodeId || '');
}

// Quale apparato documentato risponde a un indirizzo. Serve accanto all'INDIRIZZO
// del gateway, nel dettaglio della rete: è lì che l'indirizzo si scrive, quindi è
// lì che deve comparire «a questo indirizzo non risponde nessuno».
// Riusa `findNodeByIp` (lib/l3-gateway.js, globale bare) e la stessa definizione di
// «IP di un device» del report L3 — quella di `_l3BuildModel`, che include l'host
// SNMP. Diversamente da `rows[vid]`, che guarda solo il prefisso PRINCIPALE della
// VLAN, questa risponde per QUALSIASI prefisso: anche il v6 e quelli senza VLAN.
export function _l3DeviceForIp(ip){
    const addr = String(ip || '').trim();
    if(!addr) return null;
    try { return findNodeByIp(_l3BuildModel(false).nodes, addr) || null; }
    catch(_){ return null; }
}

// ── UI: binding nella card VLAN (riga "Instradata da") ────────────────
// Il DEVICE che instrada la VLAN — non il suo indirizzo, che sta sul prefisso e si
// scrive nel dettaglio della rete. Qui resta perché `gatewayNodeId` è per-VLAN:
// l'interfaccia SVI è una sola anche quando porta due indirizzi (dual-stack).
// row = riga gia' calcolata dal report (passata da renderProps per non
// ricalcolare il report per ogni card).
export function _l3GatewayBindingHtml(vid, row){
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const cands = _l3CandidateNodes(row && row.status === 'bound' ? row.nodeId : null);
    const selId = (row && row.status === 'bound') ? String(row.nodeId) : '';
    const opts = [`<option value="">${t('l3.noneIpOnly')}</option>`]
        .concat(cands.map(c => `<option value="${esc(c.id)}"${String(c.id) === selId ? ' selected' : ''}>${esc(c.name)}${c.ip ? ' · ' + esc(c.ip) : ''}</option>`))
        .join('');
    let hint = '', warn = false;
    if(row){
        if(row.status === 'bound') hint = `<i class="fas fa-check"></i> ${t('l3.hintBound',{name:`<b>${esc(row.nodeName)}</b>`})}`;
        // «Dedotto da <ip>»: l'indirizzo che ha prodotto l'aggancio si NOMINA, o la
        // riga afferma un legame senza dire da dove viene — e l'indirizzo, ora, sta
        // in un'altra sezione.
        else if(row.status === 'auto') hint = `<i class="fas fa-wand-magic-sparkles"></i> ${t('l3.hintAuto',{ip:`<b>${esc(row.gateway)}</b>`, name:`<b>${esc(row.nodeName)}</b>`})} <button class="toolbar-btn" style="padding:1px 6px;margin:0 0 0 4px;font-size:0.7rem" data-act="l3-gw-confirm" data-vid="${+vid}" data-node="${esc(row.nodeId)}">${t('common.confirm')}</button>`;
        else if(row.warnings && row.warnings.includes('staleBinding')){ warn = true; hint = `<i class="fas fa-triangle-exclamation"></i> ${t('l3.hintStale')}`; }
        // Lo stato «orfano» (c'è un indirizzo, non risponde nessun apparato) NON si
        // dice più qui: parlava di un valore che da questa sezione non si vede né si
        // corregge. Vive accanto all'indirizzo, nel dettaglio della rete.
    }
    return `<div class="prop-group" style="grid-column:1/-1">
        <label>${t('l3.gwDevice')} <span style="font-weight:400;color:var(--text-muted)">${t('l3.gwDeviceSub')}</span></label>
        <select data-change="l3-gw-select" data-vid="${+vid}">${opts}</select>
        ${hint ? `<div class="vlan-l3-hint${warn ? ' warn' : ''}">${hint}</div>` : ''}
      </div>`;
}

// ── UI: sezione "Gateway L3 / SVI" nel pannello del device ────────────
// Mostrata solo se il device instrada ≥1 VLAN. Read-only: deriva dal binding.
export function _l3SviSectionHtml(nodeId){
    const esc = s => escapeHTML(String(s == null ? '' : s));
    let rep; try { rep = _l3Compute(true); } catch(_){ return ''; }
    const dev = (rep.l3Devices || []).find(d => String(d.id) === String(nodeId));
    if(!dev || !dev.vlans.length) return '';
    const rowsByVid = {}; (rep.rows || []).forEach(r => { rowsByVid[r.vid] = r; });
    const items = dev.vlans
        .slice()
        .sort((a, b) => a.vid - b.vid)
        .map(v => {
            const r = rowsByVid[v.vid] || {};
            const color = r.color || '#8b949e';
            const oos = r.warnings && r.warnings.includes('gatewayOutOfSubnet');
            return `<div class="l3-svi-row">
                <span class="l3-svi-vlan" style="color:${esc(color)}">VLAN ${v.vid}</span>
                <span class="l3-svi-name">${esc(r.name || '')}</span>
                <span class="l3-svi-gw">${esc(v.gateway || '—')}${r.subnet ? ` <span class="l3-svi-sub">${esc(r.subnet)}</span>` : ''}${oos ? ` <span class="l3-svi-warn" data-tip="${esc(t('pnl.feat.gwOutOfSubnet'))}">⚠</span>` : ''}</span>
              </div>`;
        }).join('');
    return `<details class="props-collapsible props-secondary" ${_propsSectionIsOpen('node-l3') ? 'open' : ''} data-toggle="props-section" data-section="node-l3">
        <summary class="props-collapsible-head"><span><i class="fas fa-route"></i> ${t('l3.sviSection')}</span><span class="props-collapsible-preview">${dev.vlans.length} VLAN</span><i class="fas fa-chevron-down props-collapsible-chevron"></i></summary>
        <div class="props-collapsible-body">
          <div class="l3-svi-intro">${t('l3.sviIntro')}</div>
          ${items}
        </div>
      </details>`;
}

// ── Overlay "Mappa L3" (stile Drift/Porte libere) ────────────────────
let _l3Report = null;
function _l3EnsureOverlay(){
    let ov = document.getElementById('l3-overlay');
    if(!ov){
        ov = document.createElement('div');
        ov.id = 'l3-overlay';
        ov.className = 'drift-overlay';   // riusa il guscio modale del Drift
        const _ttl = t('report.l3');
        const _cls = t('common.close');
        ov.innerHTML = `<div class="drift-modal"><div class="drift-head"><span><i class="fas fa-route"></i> <span id="l3-title">${_ttl}</span></span><button class="toolbar-btn" data-act="l3-close" data-tip="${_cls}"><i class="fas fa-times"></i></button></div><div class="drift-body" id="l3-body"></div></div>`;
        document.body.appendChild(ov);
        ov.addEventListener('mousedown', e => { if(e.target === ov) _closeL3Report(); });
    }
    return ov;
}
function _closeL3Report(){ const ov = document.getElementById('l3-overlay'); if(ov) ov.style.display = 'none'; }

function _l3StatusBadge(row){
    if(row.status === 'bound') return `<span class="l3-st l3-st-ok" data-tip="${t('l3.tipBound')}"><i class="fas fa-check"></i> gateway</span>`;
    if(row.status === 'auto') return `<span class="l3-st l3-st-auto" data-tip="${t('l3.tipAuto')}"><i class="fas fa-wand-magic-sparkles"></i> auto</span>`;
    if(row.warnings.includes('staleBinding')) return `<span class="l3-st l3-st-warn" data-tip="${t('l3.tipStale')}">⚠ ${t('l3.reassign')}</span>`;
    if(row.status === 'orphan') return `<span class="l3-st l3-st-warn" data-tip="${t('l3.tipOrphan')}">⚠ ${t('l3.orphan')}</span>`;
    return '<span class="l3-st l3-st-none">—</span>';
}

// Sezione "Igiene IPAM" del report L3: IP duplicati + overlap di subnet (doc↔doc,
// non doc↔realta' che e' il Drift). Stringa vuota quando la rete e' pulita. I valori
// interpolati sono gia' escapati (nomi device = input utente).
function _l3HygieneHtml(audit, esc){
    if(!audit || (!audit.duplicateIps.length && !audit.subnetOverlaps.length)) return '';
    const rs = 'style="font-size:0.8rem;color:var(--text-muted);padding:2px 0"';
    const rows = [];
    for(const d of audit.duplicateIps){
        rows.push(`<div ${rs}>⚠ ${t('l3.dupIpRow',{ip:`<b>${esc(d.ip)}</b>`, names:esc(d.nodes.map(n=>n.name).join(', '))})}</div>`);
    }
    // La riga nomina i PREFISSI, non le VLAN: una rete senza VLAN non ha un numero
    // da citare, e due prefissi della stessa VLAN che si intersecano non si
    // distinguerebbero. La VLAN va in coda al prefisso, e solo se c'è.
    const netLabel = x => `<b>${esc(x.cidr)}</b>${x.vlan != null ? ` (VLAN ${+x.vlan})` : ''}`;
    for(const o of audit.subnetOverlaps){
        rows.push(`<div ${rs}>⚠ ${t(o.identical?'l3.overlapRowSame':'l3.overlapRow',{sa:netLabel(o.a), sb:netLabel(o.b)})}</div>`);
    }
    return `<div class="l3-hygiene" style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">`
        + `<div style="font-weight:600;margin-bottom:4px"><i class="fas fa-triangle-exclamation" style="color:#d29922"></i> ${t('l3.ipamHygiene')}</div>`
        + rows.join('') + `</div>`;
}

function openL3Report(){
    const rep = _l3Report = _l3Compute(true);
    // Global bare (risolve a window via la lib UMD-lite ipam-audit.js): non passa
    // dal ponte win.* (cricchetto invariato). Ripiego "rete pulita" se non caricata.
    let audit = { duplicateIps: [], subnetOverlaps: [] };
    try { if(typeof buildIpamAudit === 'function') audit = buildIpamAudit(_l3BuildModel(false, { withVmIps: true })); } catch(_){ /* ripiego */ }
    const ov = _l3EnsureOverlay();
    ov.style.display = 'flex';
    const esc = s => escapeHTML(String(s == null ? '' : s));
    const tot = rep.totals;
    const _l3t = document.getElementById('l3-title'); if(_l3t) _l3t.textContent = t('report.l3');
    const warnBits = [];
    if(tot.orphan) warnBits.push(`<span class="l3-sum-warn">⚠ ${t('l3.orphanGw',{n:tot.orphan})}</span>`);
    if(tot.noGateway) warnBits.push(`<span class="l3-sum-warn">⚠ ${t('l3.vlanNoGw',{n:tot.noGateway})}</span>`);
    if(tot.outOfSubnet) warnBits.push(`<span class="l3-sum-warn">⚠ ${t('l3.outSubnet',{n:tot.outOfSubnet})}</span>`);
    if(audit.duplicateIps.length) warnBits.push(`<span class="l3-sum-warn">⚠ ${t('l3.dupIpChip',{n:audit.duplicateIps.length})}</span>`);
    if(audit.subnetOverlaps.length) warnBits.push(`<span class="l3-sum-warn">⚠ ${t('l3.overlapChip',{n:audit.subnetOverlaps.length})}</span>`);
    const header = `<div class="spare-summary">
        <div class="spare-summary-hdr">
            <div class="spare-summary-big">${t('l3.summary',{dev:`<b>${tot.l3Devices}</b>`,gw:`<b>${tot.withGateway}</b>`,vlans:tot.vlans})}</div>
            <button class="toolbar-btn" style="margin-left:auto" data-act="l3-export" data-tip="${t('l3.csvTip')}"><i class="fas fa-file-csv"></i> CSV</button>
        </div>
        <div class="spare-summary-sub">${warnBits.length ? warnBits.join(' · ') : t('l3.noIssues')}</div>
    </div>`;
    const renderRow = r => `<div class="l3-row${r.warnings.length ? ' has-warn' : ''}">
        <span class="l3-row-vlan" style="color:${esc(r.color || '#8b949e')}">VLAN ${r.vid}</span>
        <span class="l3-row-name">${esc(r.name || '')}</span>
        <span class="l3-row-sub">${esc(r.subnet || '—')}${!r.cidrValid && r.subnet ? ` <span class="l3-svi-warn" data-tip="${esc(t('pnl.feat.invalidCidr'))}">⚠</span>` : ''}</span>
        <span class="l3-row-gw">${esc(r.gateway || '—')}${r.warnings.includes('gatewayOutOfSubnet') ? ` <span class="l3-svi-warn" data-tip="${esc(t('pnl.feat.outOfSubnet'))}">⚠</span>` : r.warnings.includes('gatewayReserved') ? ` <span class="l3-svi-warn" data-tip="${esc(t('pnl.feat.gwReserved'))}">⚠</span>` : ''}</span>
        <span class="l3-row-dev">${r.nodeName ? esc(r.nodeName) : '<span class="l3-st-none">—</span>'}</span>
        <span class="l3-row-st">${_l3StatusBadge(r)}</span>
      </div>`;
    const head = `<div class="l3-row l3-row-head">
        <span class="l3-row-vlan">VLAN</span><span class="l3-row-name">${t('common.name')}</span>
        <span class="l3-row-sub">Subnet</span><span class="l3-row-gw">Gateway</span>
        <span class="l3-row-dev">Device</span><span class="l3-row-st">${t('common.status')}</span></div>`;
    const body = rep.rows.length
        ? head + rep.rows.map(renderRow).join('')
        : `<div class="drift-empty">${t('l3.empty')}</div>`;
    document.getElementById('l3-body').innerHTML = header + `<div class="l3-table">${body}</div>` + _l3HygieneHtml(audit, esc);
    if(typeof closeReportMenu === 'function') closeReportMenu();
}

// ── Export CSV ────────────────────────────────────────────────────────
function l3ExportCsv(){
    const rep = _l3Report || _l3Compute(true);
    // Intestazioni e note seguono la lingua: un CSV si apre in Excel e lo legge una
    // persona. Il codice del warning resta la chiave (`l3.csv.<code>`), così una
    // regola nuova senza traduzione si vede subito invece di uscire in italiano.
    const rows = [t('l3.csv.cols').split(';')];
    const noteOf = r => r.warnings.map(w => { const k = 'l3.csv.' + w; const s = t(k); return s === k ? w : s; }).join(', ');
    rep.rows.forEach(r => rows.push([
        r.vid, r.name, r.subnet, r.gateway, r.nodeName || '', r.status, r.usedCount, r.dns, noteOf(r),
    ]));
    const esc = v => { const s = String(v == null ? '' : v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = '﻿' + rows.map(r => r.map(esc).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mappa-l3-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Superficie pubblica: openL3Report (menu Report, inline), _l3GatewayNodeIds
// (app-render-core.js), _l3GatewayBindingHtml (app-properties-floor.js),
// _l3SviSectionHtml (app-properties-node.js) + handler inline onclick/onchange
// (updateVlanGatewayNode, l3ExportCsv, _closeL3Report).
expose({
    _l3GatewayNodeIds, _l3GatewayBindingHtml, _l3SviSectionHtml, _l3Compute,
});

// ASSE B — report L3 (overlay + righe VLAN dinamiche): chiudi/export + scelta
// gateway VLAN via event delegation. Le 3 fn escono da expose(); vid/nodeId
// viaggiano in data-vid/data-node, il select legge el.value.
registerClickActions({
    'l3-close':      () => _closeL3Report(),
    'l3-export':     () => l3ExportCsv(),
    'l3-gw-confirm': (el) => updateVlanGatewayNode(+el.dataset.vid, el.dataset.node),
});
registerChangeActions({
    'l3-gw-select':  (el) => updateVlanGatewayNode(+el.dataset.vid, el.value),
});

// ASSE B: voce "Mappa L3" del menu Report via data-act (ex win.openL3Report).
// Nota: l'onclick originale NON chiudeva il dropdown → comportamento preservato.
// UX: il report «Mappa L3 / Gateway» e' ASSORBITO nella Dashboard — si lancia dal
// drill-down del tile Gateway (lente ① Completo), non piu' dal menu header. openL3Report
// chiude comunque il menu internamente (no-op quando parte dalla Dashboard). Il CTA e'
// reso da app-overview.js (_REPORT_CTA); l'azione vive qui, col report.
registerClickActions({ 'overview-l3-report': () => openL3Report() });
