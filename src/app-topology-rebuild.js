// ============================================================
// TOPO-REBUILD — orchestratore "Ricostruisci topologia" (READ-ONLY)
// ============================================================
// Sequenzia: poll (/api/topology per ogni nodo infra) → correla (il server
// restituisce già suggestedLinks + suggestedSharedSegments) → assembla
// (lib/topology-plan.js assemblePlanInputs) → piano (buildTopologyPlan).
//
// NON muta nulla: produce e restituisce il TopologyPlan (salvato in
// store._topoPlan) per la review (FASE 4). L'apply idempotente è la FASE 5.
//
// Le primitive PURE (lib/correlate.js, lib/topology-plan.js, lib/netnames.js)
// sono globali del bundle (UMD → window): si leggono BARE (no-undef è off in
// src/), NON via win.* — il cricchetto del ponte è a saturazione (268/268).
// Guardie typeof difensive dove serve.
// ============================================================
import { expose, t } from './_bridge.js';
import { store } from './store.js';
import { nodeById, getPortNodeId, getNodeByPortId, getNodeDisplayName, markDirty, pushHistory, renderCables, _invalidateIdx, _createLinkRecord, _nextNodeId, _showToast } from './app.js';
import { renderAll } from './app-render-core.js';
import { TYPES } from './app-types.js';
import { _isLeafEndpoint } from './app-autolink.js';
import { _findPortByIfName } from './app-topology-discover.js';
import { escapeHTML } from './app-util.js';
import { registerClickActions, registerChangeActions } from './app-delegation.js';

const _norm = (m) => (typeof _normMacKey === 'function')
  ? _normMacKey(m)
  : String(m || '').trim().toLowerCase();

// Nodi infra da interrogare: driver SNMP + host, non marcati down al poll precedente.
function _rebuildTargets() {
  return store.state.nodes.filter(n => {
    const cfg = n.integration || {};
    if (!((cfg.driver || '').startsWith('snmp') && !!((cfg.host || n.ip || '').trim()))) return false;
    return n.snmpStatus !== 'err';
  });
}

// Contesto progetto per la correlazione server-side (stesso shape di
// _autoDiscoverLinks: il server calcola suggestedLinks/suggestedSharedSegments).
function _projectContext() {
  const nodes = store.state.nodes.map(n => ({
    id: n.id, type: n.type || '', hostname: n.hostname || '', name: n.name || '',
    ip: n.ip || '', ports: n.ports, mac: n.mac || '',
    isLeafEndpoint: _isLeafEndpoint(n.type),
    isPassive: !!TYPES[n.type]?.isPassive, isActive: !!TYPES[n.type]?.isActive,
    integration: { host: (n.integration?.host || '') },
  }));
  const ports = {};
  for (const [pid, pi] of Object.entries(store.state.ports)) {
    ports[pid] = {
      ifName: pi.ifName || '', alias: pi.alias || '', lagId: pi.lagId || 0,
      lagGroup: pi.lagGroup || '', mac: pi.mac || '', isTrunk: !!pi.isTrunk,
      sharedSegmentRole: pi.sharedSegmentRole || '',
    };
  }
  return { nodes, ports, lagGroups: store.state.lagGroups || {} };
}

// Un fetch /api/topology per un nodo → payload normalizzato per assemblePlanInputs.
async function _fetchTopo(n, ctx) {
  const cfg = n.integration || {};
  const host = (cfg.host || n.ip || '').trim();
  const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (_) { /* noop */ } }, 60000) : null;
  try {
    const r = await fetch('/api/topology', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl ? ctrl.signal : undefined,
      body: JSON.stringify({
        driver: cfg.driver || 'snmp-v2c', host, port: cfg.port || 161, timeout: cfg.timeout || 5,
        community: cfg.community || 'public',
        v3user: cfg.v3user || '', v3authProto: cfg.v3authProto || 'SHA', v3authPass: cfg.v3authPass || '',
        v3privProto: cfg.v3privProto || 'AES', v3privPass: cfg.v3privPass || '', v3secLevel: cfg.v3secLevel || 'authPriv',
        srcNodeId: n.id,
        projectNodes: ctx.nodes, projectPorts: ctx.ports, projectLagGroups: ctx.lagGroups,
      }),
    });
    const data = await r.json();
    if (!data || !data.ok) return null;
    return {
      nodeId: n.id,
      fdbTable: data.fdbTable || {},
      neighbors: data.neighbors || [],
      suggestedLinks: data.suggestedLinks || [],
      suggestedSharedSegments: data.suggestedSharedSegments || [],
    };
  } catch (e) {
    console.warn(`[TopoRebuild] fetch ${n.name || host}: ${e.message}`);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Mappa MAC normalizzato → { nodeId, type } dai nodi/porte noti del progetto:
// serve a etichettare gli endpoint "dietro" e ad applicare la regola type-aware
// dell'inferenza (es. coppia VoIP+PC ≠ switch).
function _macInfoMap() {
  const idx = {};
  for (const n of store.state.nodes) {
    const m = _norm(n.mac);
    if (m && !idx[m]) idx[m] = { nodeId: n.id, type: n.type || null };
  }
  for (const [pid, pi] of Object.entries(store.state.ports)) {
    const m = _norm(pi.mac);
    if (!m || idx[m]) continue;
    const nid = getPortNodeId(pid);
    const nd = nodeById(nid);
    idx[m] = { nodeId: nid, type: nd ? (nd.type || null) : null };
  }
  return idx;
}

/**
 * Ricostruisce il piano di topologia (READ-ONLY): poll→correla→assembla→piano.
 * Ritorna { ok, plan } e salva il piano in store._topoPlan. NON crea/rimuove
 * cavi né nodi: la review (FASE 4) e l'apply (FASE 5) sono passi separati.
 * @returns {Promise<{ok:boolean, plan?:object, reason?:string}>}
 */
export async function rebuildTopologyPlan() {
  if (typeof assemblePlanInputs !== 'function' ||
      typeof buildTopologyPlan !== 'function' ||
      typeof buildPortIndex !== 'function') {
    return { ok: false, reason: 'engine-missing' };
  }
  const targets = _rebuildTargets();
  if (!targets.length) return { ok: false, reason: 'no-snmp-targets' };

  const ctx = _projectContext();
  const pollResults = [];
  const BATCH = 5;   // I/O di rete a blocchi (come il Sync): O(ceil(n/5)×timeout).
  for (let b = 0; b < targets.length; b += BATCH) {
    const chunk = await Promise.all(targets.slice(b, b + BATCH).map(n => _fetchTopo(n, ctx)));
    for (const res of chunk) if (res) pollResults.push(res);
  }
  if (!pollResults.length) return { ok: false, reason: 'no-poll-data' };

  const macInfo = _macInfoMap();
  const inputs = assemblePlanInputs(pollResults, {
    findPort: (nid, ifn) => _findPortByIfName(nid, ifn),
    macInfo: (m) => macInfo[_norm(m)] || null,
  });
  const portIndex = buildPortIndex(store.state.ports, store.state.lagGroups || {});
  const plan = buildTopologyPlan({
    candidates: inputs.candidates,
    portIndex,
    nodes: store.state.nodes,
    existingLinks: store.state.links,
    sharedSegments: inputs.sharedSegments,
    portEndpoints: inputs.portEndpoints,
  });
  store._topoPlan = plan;
  return { ok: true, plan };
}

// ============================================================
// UX review READ-ONLY (FASE 4): modale #toporebuild-overlay
// ============================================================
const _trFilter = { lldp: true, fdb: true, arp: true, inferred: true };

function openTopoRebuild() {
  const ov = document.getElementById('toporebuild-overlay');
  if (!ov) return;
  const planEl = document.getElementById('tr-plan'); if (planEl) planEl.innerHTML = '';
  const filt = document.getElementById('tr-filters'); if (filt) filt.style.display = 'none';
  const st = document.getElementById('tr-status'); if (st) st.textContent = '';
  ov.classList.add('open');
  const a = document.getElementById('automation-dropdown'); if (a) a.style.display = 'none';
}

function closeTopoRebuild() {
  const ov = document.getElementById('toporebuild-overlay');
  if (ov) ov.classList.remove('open');
}

async function runTopoRebuild() {
  const btn = document.getElementById('tr-run-btn');
  const st = document.getElementById('tr-status');
  const planEl = document.getElementById('tr-plan');
  const filt = document.getElementById('tr-filters');
  if (btn) btn.disabled = true;
  if (st) st.textContent = t('toporebuild.polling');
  if (planEl) planEl.innerHTML = '';
  let res;
  try { res = await rebuildTopologyPlan(); }
  catch (e) { res = { ok: false, reason: 'error', error: e.message }; }
  if (btn) btn.disabled = false;
  if (st) st.textContent = '';
  if (!res || !res.ok) {
    const msg = (res && res.reason === 'no-snmp-targets') ? t('toporebuild.noTargets') : t('toporebuild.error');
    if (planEl) planEl.innerHTML = `<div class="tr-empty">${escapeHTML(msg)}</div>`;
    return;
  }
  if (filt) filt.style.display = 'flex';
  document.querySelectorAll('#tr-filters input[data-tier]').forEach(cb => { cb.checked = !!_trFilter[cb.dataset.tier]; });
  _renderTopoPlanReview(res.plan);
  const hasOps = (res.plan.links || []).length || (res.plan.inferredNodes || []).length;
  const applyBtn = document.getElementById('tr-apply-btn');
  if (applyBtn) applyBtn.style.display = hasOps ? 'inline-flex' : 'none';
}

function _trNodeName(id) { const n = nodeById(id); return n ? getNodeDisplayName(n) : String(id || ''); }

function _trPortLabel(pid) {
  const nid = getPortNodeId(pid);
  const num = String(pid).slice(String(nid).length + 1);
  return num ? `${_trNodeName(nid)}:${num}` : _trNodeName(nid);
}

function _trReasonText(r) {
  if (!r) return '';
  const v = r.vars || {};
  if (r.code === 'lldp') return `${t('toporebuild.reasonLldp')} → ${_trNodeName(v.dstNode)}`;
  if (r.code === 'fdb') return t('toporebuild.reasonFdb');
  if (r.code === 'arp') return t('toporebuild.reasonArp');
  if (r.code === 'inferred') return t('toporebuild.reasonInferred', { count: v.count });
  return '';
}

function _trBadge(status) {
  const map = { 'new': ['new', 'statusNew'], 'exists': ['exists', 'statusExists'], 'conflict-manual': ['conflict', 'statusConflict'] };
  const m = map[status] || map.new;
  return `<span class="tr-badge ${m[0]}">${escapeHTML(t('toporebuild.' + m[1]))}</span>`;
}

function _trRow(conf, endsHtml, reason, badgeHtml, extraCls) {
  const pct = Math.round((conf || 0) * 100);
  return `<div class="tr-row${extraCls ? ' ' + extraCls : ''}">`
    + `<div class="tr-conf" title="${pct}%"><div class="tr-conf-fill" style="width:${pct}%"></div></div>`
    + `<div class="tr-main">${endsHtml}<div class="tr-reason">${escapeHTML(reason)} · ${pct}%</div></div>`
    + badgeHtml + `</div>`;
}

// Render PURO del piano nel DOM del modale. Nessuna mutazione del progetto.
function _renderTopoPlanReview(plan) {
  const el = document.getElementById('tr-plan');
  if (!el) return;
  if (!plan) { el.innerHTML = ''; return; }
  const links = plan.links || [];
  const inferred = plan.inferredNodes || [];
  const s = plan.summary || {};
  if (!links.length && !inferred.length) {
    el.innerHTML = `<div class="tr-empty">${escapeHTML(t('toporebuild.empty'))}</div>`;
    return;
  }

  let html = `<div class="tr-summary">${escapeHTML(t('toporebuild.summary', { links: links.length, inferred: inferred.length, conflicts: s.conflicts || 0 }))}</div>`;

  const byTier = { lldp: [], fdb: [], arp: [] };
  for (const l of links) (byTier[l.tier] || (byTier[l.tier] = [])).push(l);

  for (const sec of [{ tier: 'lldp', key: 'secLldp' }, { tier: 'fdb', key: 'secFdb' }, { tier: 'arp', key: 'secArp' }]) {
    const rows = byTier[sec.tier] || [];
    if (!_trFilter[sec.tier] || !rows.length) continue;
    html += `<div class="tr-sec"><div class="tr-sec-hd">${escapeHTML(t('toporebuild.' + sec.key))} <span class="tr-count">${rows.length}</span></div>`;
    for (const l of rows) {
      const ends = `<div class="tr-ends">${escapeHTML(_trPortLabel(l.src))} ↔ ${escapeHTML(_trPortLabel(l.dst))}${l.corroborated ? ' ✚' : ''}</div>`;
      html += _trRow(l.confidence, ends, _trReasonText(l.reason), _trBadge(l.status));
    }
    html += `</div>`;
  }

  if (_trFilter.inferred && inferred.length) {
    html += `<div class="tr-sec"><div class="tr-sec-hd">${escapeHTML(t('toporebuild.secInferred'))} <span class="tr-count">${inferred.length}</span></div>`;
    for (const inf of inferred) {
      const ends = `<div class="tr-kind">${escapeHTML(t('toporebuild.unmanagedSwitch'))} — ${escapeHTML(_trPortLabel(inf.onUplinkPid))}</div>`
        + `<div class="tr-behind">${escapeHTML(t('toporebuild.behind'))}: ${escapeHTML((inf.behindMacs || []).join(', '))}</div>`;
      const badge = `<span class="tr-badge new">${escapeHTML(t('toporebuild.confirm'))}</span>`;
      html += _trRow(inf.confidence, ends, _trReasonText(inf.reason), badge, 'tr-inferred');
    }
    html += `</div>`;
  }

  el.innerHTML = html;
}

function _trTierToggle(el) {
  const tier = el && el.dataset ? el.dataset.tier : null;
  if (!tier || !(tier in _trFilter)) return;
  _trFilter[tier] = !!el.checked;
  if (store._topoPlan) _renderTopoPlanReview(store._topoPlan);
}

// ============================================================
// APPLY idempotente + reconcile/self-heal (FASE 5)
// ============================================================

// Crea il nodo "switch/AP non gestito" inferito sulla PLANIMETRIA (customfloor
// multiport), vicino all'uplink, dimensionato a uplink + N endpoint dietro.
function _createInferredSwitch(m) {
  const behind = (m.behindNodeIds || []).length;
  const ports = Math.max(2, behind + 1);
  const usedIds = new Set(store.state.nodes.map(n => String(n.id || '')));
  const id = (typeof _nextNodeId === 'function') ? _nextNodeId('customfloor', usedIds) : ('ep_' + store.state.nodes.length);
  const up = nodeById(getPortNodeId(m.onUplinkPid));
  let x, y;
  if (up && typeof up.x === 'number') { x = up.x + 140; y = up.y || 0; }
  else {
    const fvp = store.state.floorView || { x: 0, y: 0, zoom: 1 };
    const fp = document.getElementById('floorplan');
    const w = fp ? fp.clientWidth : 800, h = fp ? fp.clientHeight : 600;
    x = Math.round((-fvp.x + w / 2) / (fvp.zoom || 1));
    y = Math.round((-fvp.y + h / 2) / (fvp.zoom || 1));
  }
  const n = {
    id, type: 'customfloor', name: t('toporebuild.unmanagedSwitch'),
    x, y, ports, multiPort: true,
    inferred: true, identitySource: 'inferred', identityConfidence: 'low',
  };
  store.state.nodes.push(n);
  return n;
}

function _mkLink(src, dst, meta) {
  if (typeof _createLinkRecord === 'function') return _createLinkRecord(src, dst, meta);
  return Object.assign({ id: 'l_' + src + '_' + dst, src, dst }, meta);
}

/**
 * Applica il piano corrente (store._topoPlan): crea i cavi nuovi, materializza i
 * nodi inferiti, rimuove gli auto-link superati (self-heal). Manual-first,
 * idempotente (re-run = no-op), annullabile (pushHistory). Ritorna i conteggi.
 */
function applyTopologyPlan(planArg) {
  const plan = planArg || store._topoPlan;
  if (!plan) return { ok: false, reason: 'no-plan' };
  if (typeof buildApplyOps !== 'function' || typeof buildPortIndex !== 'function') return { ok: false, reason: 'engine-missing' };

  // Uplink già dotati di uno switch inferito (idempotenza): porte collegate a un nodo inferred.
  const materializedUplinks = new Set();
  for (const l of store.state.links) {
    for (const end of [l.src, l.dst]) {
      const nd = (typeof getNodeByPortId === 'function') ? getNodeByPortId(end) : null;
      if (nd && nd.inferred) materializedUplinks.add(l.src === end ? l.dst : l.src);
    }
  }

  const portIndex = buildPortIndex(store.state.ports, store.state.lagGroups || {});
  const ops = buildApplyOps(plan, {
    existingLinks: store.state.links,
    portIndex,
    tiers: _trFilter,
    materializedUplinks,
    isLeafNode: (nid) => { const n = nodeById(nid); return !!(n && _isLeafEndpoint(n.type)); },
    resolveEndpoint: (nid) => {
      if (typeof _resolveEndpointSwitchPort !== 'function') return { ok: true };
      try { return _resolveEndpointSwitchPort(nodeById(nid)); } catch (_) { return { ok: true }; }
    },
  });

  if (!ops.addLinks.length && !ops.materialize.length && !ops.pruneLinkIds.length) {
    return { ok: true, added: 0, nodes: 0, pruned: 0, noop: true };
  }

  pushHistory();
  const pruneSet = new Set(ops.pruneLinkIds);
  if (pruneSet.size) store.state.links = store.state.links.filter(l => !pruneSet.has(l.id));

  const proto = { lldp: 'LLDP', fdb: 'MAC', arp: 'ARP-MAC' };
  let added = 0;
  for (const a of ops.addLinks) {
    store.state.links.push(_mkLink(a.src, a.dst, { autoLinked: true, confidence: a.confidence, protocol: proto[a.tier] || 'AUTO' }));
    if (!store.state.ports[a.src]) store.state.ports[a.src] = {};
    if (!store.state.ports[a.dst]) store.state.ports[a.dst] = {};
    added++;
  }

  let nodes = 0;
  for (const m of ops.materialize) {
    const sw = _createInferredSwitch(m); nodes++;
    const upPid = `${sw.id}-1`;
    if (!store.state.ports[upPid]) store.state.ports[upPid] = {};
    if (!store.state.ports[m.onUplinkPid]) store.state.ports[m.onUplinkPid] = {};
    store.state.links.push(_mkLink(m.onUplinkPid, upPid, { autoLinked: true, confidence: m.confidence, protocol: 'INFERRED' }));
    added++;
    let pn = 2;
    for (const nid of (m.behindNodeIds || [])) {
      const epPid = `${nid}-1`;
      // manual-first: se l'endpoint ha già un cavo manuale, non ricablarlo attraverso lo switch.
      if (store.state.links.some(l => !l.autoLinked && (l.src === epPid || l.dst === epPid))) continue;
      const swPid = `${sw.id}-${pn++}`;
      if (!store.state.ports[swPid]) store.state.ports[swPid] = {};
      if (!store.state.ports[epPid]) store.state.ports[epPid] = {};
      store.state.links.push(_mkLink(swPid, epPid, { autoLinked: true, confidence: m.confidence, protocol: 'INFERRED' }));
      added++;
    }
  }

  if (typeof _invalidateIdx === 'function') _invalidateIdx();
  markDirty();
  if (typeof renderAll === 'function') renderAll();
  if (typeof renderCables === 'function') renderCables();
  if (typeof renderTopoOverlay === 'function') renderTopoOverlay();
  return { ok: true, added, nodes, pruned: pruneSet.size };
}

function runApplyPlan() {
  const res = applyTopologyPlan();
  if (!res || !res.ok) { if (typeof _showToast === 'function') _showToast(t('toporebuild.error'), 'warn'); return; }
  if (res.noop) { if (typeof _showToast === 'function') _showToast(t('toporebuild.applyNoop'), 'ok'); return; }
  if (typeof _showToast === 'function') _showToast(t('toporebuild.applied', { added: res.added, nodes: res.nodes, pruned: res.pruned }), 'ok');
  closeTopoRebuild();
}

registerClickActions({
  'toporebuild-open':     () => openTopoRebuild(),
  'toporebuild-close':    () => closeTopoRebuild(),
  'toporebuild-backdrop': (el, ev) => { if (ev.target === el) closeTopoRebuild(); },
  'toporebuild-run':      () => runTopoRebuild(),
  'toporebuild-apply':    () => runApplyPlan(),
});
registerChangeActions({
  'toporebuild-tier': (el) => _trTierToggle(el),
});

expose({ rebuildTopologyPlan, openTopoRebuild, closeTopoRebuild, runTopoRebuild, _renderTopoPlanReview, applyTopologyPlan });
