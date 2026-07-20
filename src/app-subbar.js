// ============================================================
// SOTTO-HEADER — barra sotto l'<header>:
//   - SINISTRA  breadcrumb "percorso" (InfraNet Pro / <progetto> / Planimetria)
//   - CENTRO    suggerimento prossimo-passo: solo scritta + pulsante
//   - DESTRA    statistiche: completamento documentazione - device - salute SNMP
//
// "InfraNet calcola, l'AI racconta": il suggerimento e' il passo DETERMINISTICO
// di lib/onboarding (nextStep), le statistiche sono lib/subbar-stats (puro). Qui
// c'e' SOLO il rendering nell'elemento #modern-subbar (gia' nell'HTML). Manual-first:
// il pulsante GUIDA (clicca il bottone reale, o semina la domanda nell'assistente),
// non applica mai nulla da solo.
//
// Aggiornata a ogni renderAll (hook in app-render-core) -> sempre coerente col
// progetto/selezione correnti. Lib consumati come GLOBAL BARE (typeof-guard):
// nessun win.* nuovo (cricchetto invariato).
// ============================================================
import { expose, t } from './_bridge.js';
import { store } from './store.js';
import { TYPES } from './app-types.js';
import { _snmpFreshness } from './app-snmp.js';   // età "adesso/min/h/gg" per l'esito auto-link

// Nome progetto: la fonte viva e' la <select> dell'header (si aggiorna al cambio
// progetto); fallback al nome nello store, poi a un segnaposto i18n.
function _projectName() {
  try {
    const sel = document.getElementById('project-select');
    const o = sel && sel.selectedOptions && sel.selectedOptions[0];
    const txt = o && (o.textContent || '').trim();
    if (txt) return txt;
  } catch (_) {}
  const st = store.state || {};
  return (st.projectName && String(st.projectName).trim()) || t('subbar.noProject');
}

// Riassunto per nextStep: riusa quello dell'assistente (unica fonte, include
// drift/gaps live) se disponibile; altrimenti fallback minimo (devices+verified),
// che copre comunque i due nudge principali Scopri/Verifica.
function _summary() {
  if (typeof _aiBuildSummary === 'function') {
    try { return _aiBuildSummary(); } catch (_) {}
  }
  const st = store.state || {};
  const nodes = Array.isArray(st.nodes) ? st.nodes : [];
  let snmpDown = 0;
  if (typeof computeSubbarStats === 'function') {
    try { snmpDown = computeSubbarStats(nodes, TYPES).snmpDown || 0; } catch (_) {}
  }
  let portConflicts = 0;
  for (const n of nodes) portConflicts += Array.isArray(n && n.portReconcileConflicts) ? n.portReconcileConflicts.length : 0;
  const rep = (store._driftReport && typeof store._driftReport === 'object') ? store._driftReport : {};
  return {
    devices: nodes.length, verified: !!store._driftReport, snmpDown, portConflicts,
    drift: { unverified: Array.isArray(rep.unverified) ? rep.unverified.length : 0 }, gaps: {},
  };
}

// I due soli step "a bottone reale" mappano a un'etichetta d'azione dedicata;
// gli altri (a domanda) usano l'etichetta generica "Chiedi".
const _TARGET_BTN = { discover: 'subbar.doDiscover', verify: 'subbar.doVerify' };

// Traduce lo step in { ok, text, btnLabel, onClick } | null.
function _suggest() {
  if (typeof nextStep !== 'function') return null;
  let step;
  try { step = nextStep(_summary()); } catch (_) { return null; }
  if (!step || !step.id) return null;
  const ok = step.id === 'allGood';
  const text = t('onboard.' + step.id, step.data);
  if (step.target) {
    return {
      ok, text,
      btnLabel: t(_TARGET_BTN[step.id] || 'subbar.show'),
      onClick: () => { try { const el = document.querySelector(step.target); if (el) el.click(); } catch (_) {} },
    };
  }
  if (step.askKey && typeof aiExplain === 'function') {
    return {
      ok, text,
      btnLabel: t('subbar.ask'),
      onClick: () => {
        try {
          if (typeof openAssistant === 'function') openAssistant();
          aiExplain(t(step.askKey, step.data));
        } catch (_) {}
      },
    };
  }
  return { ok, text, btnLabel: null, onClick: null };
}

// ---- costruttori DOM (textContent ovunque -> zero injection) ----
function _sep() { const s = document.createElement('span'); s.className = 'sep'; s.textContent = '/'; return s; }

function _crumbEl() {
  const wrap = document.createElement('div');
  wrap.className = 'msb-crumb';
  const ico = document.createElement('i'); ico.className = 'fas fa-layer-group'; wrap.appendChild(ico);
  const brand = document.createElement('span'); brand.textContent = 'InfraNet Pro'; wrap.appendChild(brand);
  wrap.appendChild(_sep());
  const proj = document.createElement('b'); proj.className = 'msb-proj'; proj.textContent = _projectName(); wrap.appendChild(proj);
  wrap.appendChild(_sep());
  const view = document.createElement('span'); view.textContent = t('subbar.floor'); wrap.appendChild(view);
  return wrap;
}

function _suggestEl(sug) {
  const wrap = document.createElement('div');
  wrap.className = 'msb-suggest' + (sug && sug.ok ? ' msb-ok' : '');
  if (!sug) return wrap;
  const ico = document.createElement('i');
  ico.className = 'fas ' + (sug.ok ? 'fa-circle-check' : 'fa-wand-magic-sparkles');
  wrap.appendChild(ico);
  const txt = document.createElement('span'); txt.className = 'msb-txt'; txt.textContent = sug.text; wrap.appendChild(txt);
  if (sug.btnLabel && sug.onClick) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'msb-btn';
    b.textContent = sug.btnLabel;
    b.addEventListener('click', sug.onClick);
    wrap.appendChild(b);
  }
  return wrap;
}

// Esito dell'ultimo auto-link (persistito dal Sync in state.lastAutoLinkResult):
// riga informativa che NON evapora come il toast. Vuota (:empty → nascosta via
// CSS) finché un Sync/import non registra un esito. La diagnostica «perché
// niente link» vive nel tooltip (testo già reso al momento del Sync).
function _autoLinkEl() {
  const wrap = document.createElement('div');
  wrap.className = 'msb-autolink';
  const res = (store.state || {}).lastAutoLinkResult;
  if (!res || !res.at) return wrap;
  const age = _snmpFreshness(res.at).txt;
  const ico = document.createElement('i'); ico.className = 'fas fa-diagram-project'; wrap.appendChild(ico);
  const txt = document.createElement('span'); txt.className = 'msb-autolink-txt';
  if (res.created > 0) txt.textContent = t('subbar.autoLinkOk', { n: res.created, proto: res.protocols || 'auto', age });
  else if (res.pruned > 0) txt.textContent = t('subbar.autoLinkPruned', { n: res.pruned, age });
  else txt.textContent = t('subbar.autoLinkNone', { age });
  wrap.appendChild(txt);
  if (res.reasons) wrap.title = res.reasons;
  return wrap;
}

function _statEl(icon, value, label, tip) {
  const s = document.createElement('span'); s.className = 'msb-stat'; if (tip) s.title = tip;
  if (icon) { const i = document.createElement('i'); i.className = 'fas ' + icon; s.appendChild(i); }
  const v = document.createElement('b'); v.textContent = value; s.appendChild(v);
  const l = document.createElement('span'); l.className = 'msb-stat-l'; l.textContent = label; s.appendChild(l);
  return s;
}

// Avviso contestuale alla vista Topologia: cavi documentati che NON compaiono
// perche' il rack coinvolto non e' sulla planimetria (diagnosi 61ª: "ci sono i
// cavi ma la topologia e' vuota"). Calcolo puro in lib/subbar-stats.js. Vuoto
// (elemento :empty -> display:none) quando non siamo in Topologia o non c'e'
// nulla di nascosto -> nessun impatto sulle altre viste.
function _topoWarn() {
  if (store._viewMode !== 'topology') return null;
  if (typeof computeTopoHiddenCables !== 'function') return null;
  const st = store.state || {};
  try { return computeTopoHiddenCables(st.nodes, st.links, st.racks, TYPES); }
  catch (_) { return null; }
}

// Click sul pill: piazza sulla planimetria i rack coinvolti (stessa operazione di
// "Piazza su planimetria"), sfalsati per non sovrapporsi, in UN'UNICA mossa
// annullabile (pushHistory) -> le linee compaiono subito e il pill sparisce.
// Non tocca dati documentati (solo la posizione del rack sul piano): manual-first.
function _placeHiddenRacks(rackIds) {
  const st = store.state || {};
  const racks = Array.isArray(st.racks) ? st.racks : [];
  const ids = Array.isArray(rackIds) ? rackIds : [];
  const todo = ids.map((id) => racks.find((r) => r && r.id === id)).filter((r) => r && r.x === undefined);
  if (!todo.length) return;
  if (typeof pushHistory === 'function') pushHistory();
  // Centro della viewport planimetria, come toggleRackOnFloor (snap 20px).
  const fv = st.floorView || { x: 0, y: 0, zoom: 1 };
  const zoom = fv.zoom || 1;
  const fp = document.getElementById('floorplan');
  let cx = 200, cy = 200;
  if (fp) { cx = (fp.clientWidth / 2 - (fv.x || 0)) / zoom; cy = (fp.clientHeight / 2 - (fv.y || 0)) / zoom; }
  const snap = (v) => Math.round(v / 20) * 20;
  // Sfalsa a destra dei rack GIA' piazzati, cosi' i nuovi non si accavallano.
  const base = racks.filter((r) => r && r.x !== undefined).length;
  const GAP = 200;
  todo.forEach((r, i) => { r.x = snap(cx + (base + i) * GAP); r.y = snap(cy); });
  if (typeof markDirty === 'function') markDirty();
  if (typeof renderAll === 'function') renderAll();   // ridisegna floor + overlay -> linee visibili
  if (typeof _showToast === 'function') _showToast(t('subbar.topoPlaced', { n: todo.length }), 'ok', 3500);
}

function _topoWarnEl(info) {
  const wrap = document.createElement('div');
  wrap.className = 'msb-warn';
  if (!info || !info.hidden) return wrap;   // :empty -> nascosto via CSS
  const ico = document.createElement('i'); ico.className = 'fas fa-triangle-exclamation'; wrap.appendChild(ico);
  const n = info.hidden;
  const txt = document.createElement('span'); txt.className = 'msb-warn-txt';
  txt.textContent = t(n === 1 ? 'subbar.topoHidden1' : 'subbar.topoHiddenN', { n });
  wrap.appendChild(txt);
  const racks = Array.isArray(info.racks) ? info.racks : [];
  const names = racks.slice(0, 3).join(', ') + (racks.length > 3 ? '…' : '');
  wrap.title = t('subbar.topoHiddenTip', { racks: names });
  // Cliccabile: piazza i rack coinvolti in un colpo solo (accessibile da tastiera).
  wrap.classList.add('msb-warn-btn');
  wrap.setAttribute('role', 'button');
  wrap.setAttribute('tabindex', '0');
  const act = () => _placeHiddenRacks(info.rackIds || []);
  wrap.addEventListener('click', act);
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
  return wrap;
}

function _statsEl(stats) {
  const wrap = document.createElement('div');
  wrap.className = 'msb-stats';
  if (!stats) return wrap;
  // Documentazione (% device indirizzabili con IP; '—' se non ce ne sono)
  wrap.appendChild(_statEl(
    'fa-file-lines',
    stats.docPct == null ? '—' : stats.docPct + '%',
    t('subbar.doc'),
    stats.docPct == null ? t('subbar.docNone') : t('subbar.docTip', { withIp: stats.withIp, addr: stats.addressable }),
  ));
  // Device totali
  wrap.appendChild(_statEl('fa-network-wired', String(stats.devices), t('subbar.devices'), t('subbar.devicesTip', { n: stats.devices })));
  // Salute SNMP (pallino colorato + ok/totale)
  const snmp = _statEl(
    null,
    stats.snmpTotal ? (stats.snmpOk + '/' + stats.snmpTotal) : '—',
    t('subbar.snmp'),
    stats.snmpTotal ? t('subbar.snmpTip', { ok: stats.snmpOk, total: stats.snmpTotal }) : t('subbar.snmpNone'),
  );
  const dot = document.createElement('span'); dot.className = 'msb-dot msb-dot-' + stats.snmpHealth;
  snmp.insertBefore(dot, snmp.firstChild);
  wrap.appendChild(snmp);
  return wrap;
}

// Render idempotente della barra: ricostruisce i tre blocchi a ogni chiamata.
export function renderSubbar() {
  const bar = document.getElementById('modern-subbar');
  if (!bar) return;
  const st = store.state || {};
  const nodes = Array.isArray(st.nodes) ? st.nodes : [];
  const stats = (typeof computeSubbarStats === 'function') ? computeSubbarStats(nodes, TYPES) : null;
  bar.innerHTML = '';
  bar.appendChild(_crumbEl());
  bar.appendChild(_suggestEl(_suggest()));
  bar.appendChild(_autoLinkEl());
  bar.appendChild(_topoWarnEl(_topoWarn()));
  bar.appendChild(_statsEl(stats));
}

expose({ renderSubbar });
