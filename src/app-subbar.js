// ============================================================
// SOTTO-HEADER — barra sotto l'<header>:
//   - SINISTRA  breadcrumb "percorso" (InfraNet Pro / <org> / <progetto> / <vista>)
//   - CENTRO    chip del filtro VLAN attivo (vuoto -> :empty, collassa via CSS)
//   - DESTRA    statistiche: completamento documentazione - device - salute SNMP
//
// Le statistiche sono lib/subbar-stats (puro): qui c'e' SOLO il rendering
// nell'elemento #modern-subbar (gia' nell'HTML).
//
// ⛔ NIENTE suggerimento «prossimo passo» in questa barra (tolto su richiesta,
// 2026-08-28). Il motore NON e' stato rimosso: `lib/onboarding.js` (`nextStep`)
// resta, perche' lo consuma l'ASSISTENTE in src/app-ai.js, che e' il posto dove
// un consiglio e' richiesto invece che imposto. Qui era un nudge permanente in
// cima allo schermo, sempre acceso anche a documentazione finita.
//
// Aggiornata a ogni renderAll (hook in app-render-core) -> sempre coerente col
// progetto/selezione correnti. Lib consumati come GLOBAL BARE (typeof-guard):
// nessun win.* nuovo (cricchetto invariato).
// ============================================================
import { expose, t } from './_bridge.js';
import { store } from './store.js';
import { TYPES } from './app-types.js';
import { _snmpFreshness } from './app-snmp.js';   // età "adesso/min/h/gg" per l'esito auto-link
import { snapFloor } from '../lib/floor-snap.js';   // aggancio alla griglia: stessa regola del drag (rispetta gridHidden)
import { FILTER_ROUTED } from './app-popup.js';     // il valore «instradato» del filtro ha UNA definizione, non una stringa ricopiata qui
import { orgContextFor, orgContextReady, orgContextLoad } from './app-org-context.js';

// Nome progetto: la fonte viva e' la <select> dell'header (si aggiorna al cambio
// progetto); fallback al nome nello store, poi a un segnaposto i18n.
//
// ⚠️ La tendina e' un DOM che viene RICOSTRUITO (loadProjectList la svuota e la
// ripopola). Un ridisegno della barra che capiti in quell'istante la trova senza
// opzioni: prima leggeva «Nessun progetto» e lo lasciava scritto fino al render
// successivo — che puo' non arrivare mai. Un progetto E' aperto (currentProjectId
// valorizzato) e chiamarlo «nessuno» e' falso, non prudente: si tiene l'ultimo
// nome noto, che e' vero. Il segnaposto resta per il caso reale in cui nessun
// progetto e' aperto.
let _lastProjName = '';

function _projectName() {
  try {
    const sel = document.getElementById('project-select');
    const o = sel && sel.selectedOptions && sel.selectedOptions[0];
    const txt = o && (o.textContent || '').trim();
    if (txt) { _lastProjName = txt; return txt; }
  } catch (_) {}
  const st = store.state || {};
  const nome = st.projectName && String(st.projectName).trim();
  if (nome) { _lastProjName = nome; return nome; }
  if (store.currentProjectId != null && _lastProjName) return _lastProjName;
  return t('subbar.noProject');
}

// ---- costruttori DOM (textContent ovunque -> zero injection) ----
function _sep() { const s = document.createElement('span'); s.className = 'sep'; s.textContent = '/'; return s; }

// L'organizzazione a cui il progetto aperto appartiene — se qualcuno l'ha
// DICHIARATO collegando una sede a questo progetto (`site.projectRef`).
//
// È il gradino che mancava: dalla mappa delle sedi si scendeva già dentro un
// progetto, ma una volta dentro nulla diceva da dove si veniva né come tornare
// su. Il segmento è un bottone e riporta esattamente là (il Back della
// Physical Workspace Bar di Packet Tracer, applicato a due DOCUMENTI diversi:
// qui salire non è uno zoom, è riaprire il piano di sopra).
//
// Assente finché la risposta non è arrivata (② di app-org-context): un percorso
// che appare e sparisce a ogni ridisegno sarebbe peggio di un percorso assente.
function _orgCrumb() {
  if (!orgContextReady()) {
    // Il primo ridisegno la chiede; quando arriva, si ridisegna UNA volta sola.
    // `renderSubbar` è locale a questo modulo: nessun global, nessun ciclo.
    orgContextLoad().then(() => { try { renderSubbar(); } catch (_) {} });
    return null;
  }
  return orgContextFor(store.currentProjectId);
}

function _orgCrumbEl(ctx) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'msb-up';
  // Un'organizzazione senza nome è normale (il campo è facoltativo): l'etichetta
  // generica dice comunque DOVE porta il bottone, che è il punto.
  b.textContent = ctx.orgName || t('subbar.org');
  b.title = t('subbar.upTip', { site: ctx.siteName || t('subbar.siteNoName') });
  const ico = document.createElement('i'); ico.className = 'fas fa-arrow-turn-up';
  b.insertBefore(ico, b.firstChild);
  // Apre il pannello «Sedi e collegamenti» cliccando il bottone REALE della
  // toolbar: una sola definizione di «come si apre», già registrata su data-act.
  b.addEventListener('click', () => {
    try { const el = document.getElementById('btn-org'); if (el) el.click(); } catch (_) {}
  });
  return b;
}

function _crumbEl() {
  const wrap = document.createElement('div');
  wrap.className = 'msb-crumb';
  const ico = document.createElement('i'); ico.className = 'fas fa-layer-group'; wrap.appendChild(ico);
  const brand = document.createElement('span'); brand.textContent = 'InfraNet Pro'; wrap.appendChild(brand);
  wrap.appendChild(_sep());
  const org = _orgCrumb();
  if (org) { wrap.appendChild(_orgCrumbEl(org)); wrap.appendChild(_sep()); }
  const proj = document.createElement('b'); proj.className = 'msb-proj'; proj.textContent = _projectName(); wrap.appendChild(proj);
  // Il nome del PROGETTO resta il segmento: è il documento davvero aperto. Quando
  // la sede si chiama diversamente, il nome dichiarato nell'organizzazione sta nel
  // tooltip — due nomi affiancati sarebbero rumore, uno solo sceglierebbe al posto
  // dell'utente quale dei due è «vero».
  if (org && org.siteName && org.siteName !== proj.textContent) {
    proj.title = t('subbar.siteIs', { site: org.siteName });
  }
  wrap.appendChild(_sep());
  // Il terzo segmento segue la VISTA attiva, non e' fisso su "Planimetria":
  // map → Planimetria · topology → Topologia · overview → Panoramica. Riusa le
  // etichette gia' esistenti (ov.label = bottone Panoramica, f.topology).
  const viewLabel = store._viewMode === 'overview' ? t('ov.label').trim()
    : store._viewMode === 'topology' ? t('f.topology')
    : t('subbar.floor');
  const view = document.createElement('span'); view.textContent = viewLabel; wrap.appendChild(view);
  return wrap;
}

// Filtro VLAN attivo: chip centrato nella sotto-header (spostato qui dal
// #status-cluster dell'header, su richiesta). Sorgente di verita' = store._filterVlan,
// non un DOM da sincronizzare: renderSubbar gira a ogni renderAll (setVlanFilter lo
// chiama). Assente il filtro -> elemento vuoto (:empty collassa via CSS). Clic o
// Invio/Spazio rimuove il filtro (setVlanFilter(null), global esposto da app-vlan-autopoll).
function _vlanFilterEl() {
  const wrap = document.createElement('div');
  wrap.className = 'msb-vlan';
  const vid = store._filterVlan;
  if (vid == null) return wrap;                     // :empty -> nascosto
  wrap.setAttribute('role', 'button');
  wrap.setAttribute('tabindex', '0');
  wrap.title = t('vlanfilter.tip');
  const ico = document.createElement('i'); ico.className = 'fas fa-filter'; wrap.appendChild(ico);
  // Il filtro «instradato» abita la stessa variabile del filtro VLAN, ma non È una
  // VLAN: scriverci davanti «VLAN» direbbe l'esatto contrario di quello che filtra.
  const lbl = (vid === FILTER_ROUTED)
    ? t('legend.routedLink')
    : 'VLAN ' + ((typeof _vlanLabel === 'function') ? _vlanLabel(vid) : String(vid));
  const txt = document.createElement('span'); txt.className = 'msb-vlan-txt'; txt.textContent = lbl;
  wrap.appendChild(txt);
  const x = document.createElement('i'); x.className = 'fas fa-times msb-vlan-x'; wrap.appendChild(x);
  const clear = () => { if (typeof setVlanFilter === 'function') setVlanFilter(null); };
  wrap.addEventListener('click', clear);
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clear(); } });
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
  if (res.created > 0) txt.textContent = t('subbar.autoLinkOk', { n: res.created, age });
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
  // Centro della viewport planimetria, come toggleRackOnFloor (stesso aggancio:
  // lib/floor-snap.js, che rispetta l'interruttore Griglia).
  const fv = st.floorView || { x: 0, y: 0, zoom: 1 };
  const zoom = fv.zoom || 1;
  const fp = document.getElementById('floorplan');
  let cx = 200, cy = 200;
  if (fp) { cx = (fp.clientWidth / 2 - (fv.x || 0)) / zoom; cy = (fp.clientHeight / 2 - (fv.y || 0)) / zoom; }
  const snap = (v) => snapFloor(v, st.gridHidden);
  // Sfalsa a destra dei rack GIA' piazzati, cosi' i nuovi non si accavallano.
  const base = racks.filter((r) => r && r.x !== undefined).length;
  const GAP = 200;
  todo.forEach((r, i) => { r.x = snap(cx + (base + i) * GAP); r.y = snap(cy); });
  if (typeof markDirty === 'function') markDirty();
  if (typeof renderAll === 'function') renderAll();   // ridisegna floor + overlay -> linee visibili
  if (typeof _showToast === 'function') _showToast(t('subbar.topoPlaced', { n: todo.length }), 'ok');
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
  // Device totali (il tooltip dichiara i passivi quando ci sono: schema ⑤)
  wrap.appendChild(_statEl('fa-network-wired', String(stats.devices), t('subbar.devices'),
    stats.passive > 0
      ? t('subbar.devicesTipMixed', { n: stats.devices, passive: stats.passive })
      : t('subbar.devicesTip', { n: stats.devices })));
  // Salute SNMP (pallino colorato + ok/totale)
  const snmp = _statEl(
    null,
    stats.snmpTotal ? (stats.snmpOk + '/' + stats.snmpTotal) : '—',
    t('subbar.snmp'),
    // Il pallino ingiallisce anche quando rispondono TUTTI, se l'ultima risposta
    // non è recente: il tooltip deve dire perché, altrimenti l'ambra sembra un
    // guasto. `_snmpFreshness` dà l'età nella stessa unità del chip in toolbar.
    stats.snmpTotal
      ? t('subbar.snmpTip', { ok: stats.snmpOk, total: stats.snmpTotal })
        + (stats.snmpStale ? ' · ' + t('subbar.snmpStale', {
            n: stats.snmpStale, age: _snmpFreshness(stats.snmpNewestOk).txt }) : '')
      : t('subbar.snmpNone'),
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
  // Zona centrale: il solo chip del filtro VLAN. Si appende SEMPRE — senza filtro
  // e' un div vuoto che il CSS collassa (`:empty`) — invece che condizionarne
  // l'aggiunta: cosi' il numero e l'ordine dei figli non cambiano fra un
  // ridisegno e l'altro, e il chip resta nella stessa posizione quando compare.
  bar.appendChild(_vlanFilterEl());
  bar.appendChild(_autoLinkEl());
  bar.appendChild(_topoWarnEl(_topoWarn()));
  bar.appendChild(_statsEl(stats));
}

expose({ renderSubbar });
