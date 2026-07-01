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
  return { devices: nodes.length, verified: !!store._driftReport, drift: {}, gaps: {} };
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

function _statEl(icon, value, label, tip) {
  const s = document.createElement('span'); s.className = 'msb-stat'; if (tip) s.title = tip;
  if (icon) { const i = document.createElement('i'); i.className = 'fas ' + icon; s.appendChild(i); }
  const v = document.createElement('b'); v.textContent = value; s.appendChild(v);
  const l = document.createElement('span'); l.className = 'msb-stat-l'; l.textContent = label; s.appendChild(l);
  return s;
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
  bar.appendChild(_statsEl(stats));
}

expose({ renderSubbar });
