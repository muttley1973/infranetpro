// ============================================================
// SINCRONIZZAZIONE DCIM/IPAM (adapter NetBox) — Fase A: connessione.
// ------------------------------------------------------------
// Pannello di configurazione (URL + token + verifica TLS) con «Prova connessione»
// e salvataggio, servito dai route session-gated /api/integrations/dcim/*.
// Import/Export arrivano nelle fasi successive (import gratis · export a pagamento).
//
// NB ratchet: nessun win.* (fetch diretto sui route) e nessun on*= inline (event
// delegation via data-act) → non fa crescere l'ASSE B. L'a11y (focus-trap/Esc) è
// automatica: il modale è un `.tool-modal-overlay` gestito da app-modal-a11y.js.
// ============================================================
import { t } from './_bridge.js';
import { escapeHTML } from './app-util.js';
import { store } from './store.js';
import { closeImpExpMenu } from './app-auth.js';
import { showAlert, switchProject } from './app-core.js';
import { registerClickActions, registerChangeActions, registerInputActions } from './app-delegation.js';
import { buildDecisions, sanitizeDecisions } from '../lib/dcim-decisions.js';

const API = '/api/integrations/dcim';

function _el(id) { return document.getElementById(id); }
function _val(id) { const e = _el(id); return e ? String(e.value || '').trim() : ''; }
function _checked(id) { const e = _el(id); return !!(e && e.checked); }

// Chip di stato della connessione: neutro / verde (ok) / rosso (errore).
function _setStatus(text, kind) {
  const s = _el('dcim-status');
  if (!s) return;
  s.textContent = text;
  s.style.color = kind === 'ok' ? 'var(--success-color)'
    : kind === 'warn' ? 'var(--warning-color)'
      : kind === 'err' ? 'var(--danger-color)'
      : 'var(--text-muted)';
}

// Colore del bottone «Prova connessione»: verde se la connessione risponde,
// rosso se fallisce, neutro altrimenti (in attesa o dopo una modifica dei campi).
function _setTestBtn(kind) {
  const btn = _el('dcim-test-btn');
  if (!btn) return;
  btn.classList.remove('ok', 'err');
  if (kind === 'ok' || kind === 'err') btn.classList.add(kind);
}

// GET config → popola i campi. Il token non torna mai dal server: se `tokenSet`
// il placeholder dice «impostato» e il campo resta vuoto (digitarne uno = cambiarlo).
async function _loadConfig() {
  try {
    const r = await fetch(API + '/config', { headers: { Accept: 'application/json' } });
    const c = r.ok ? await r.json() : {};
    const url = _el('dcim-url'); if (url) url.value = c.url || '';
    const tls = _el('dcim-verifytls'); if (tls) tls.checked = c.verifyTls !== false;
    const tok = _el('dcim-token');
    if (tok) {
      tok.value = '';
      tok.placeholder = c.tokenSet
        ? (c.tokenFromEnv ? t('integrations.tokenEnv') : t('integrations.tokenSetPh'))
        : t('integrations.tokenPh');
      tok.disabled = !!c.tokenFromEnv;
    }
    _setStatus(t('integrations.notConnected'), ''); _setTestBtn('');
  } catch (_) { /* rete assente → campi come sono */ }
}

// Chiusura al click sul backdrop, ma SOLO se il click è NATO sul backdrop. Una
// selezione di testo che parte da un input (nome progetto/token) e finisce fuori
// dal box produce un `click` col target = overlay → chiudeva il modale mentre
// selezionavi. Tracciamo il mousedown e chiudiamo solo se anche la pressione era
// sullo sfondo. (addEventListener locale sull'overlay: nessun win.*, nessun inline.)
let _pressOnBackdrop = false;
let _backdropWired = false;
function _wireBackdrop() {
  if (_backdropWired) return;
  const ov = _el('dcim-overlay');
  if (!ov) return;
  ov.addEventListener('mousedown', (e) => { _pressOnBackdrop = (e.target === ov); });
  _backdropWired = true;
}

/** Apre il pannello Sincronizzazione, carica la config e prepara il wizard import. */
export function openDcimSync() {
  const ov = _el('dcim-overlay');
  if (!ov) return;
  _wireBackdrop();
  ov.classList.add('open');
  _loadConfig();
  _loadCatalogStatus();
  _wiz.step = 1; _wiz.preview = null; _wiz.previewErr = ''; _wiz.projectName = '';
  _wiz.selection = {
    entities: { devices: true, cabling: true, ipam: true, racks: true },
    scope: { siteIds: [], roleSlugs: [], tags: [] },
    exclude: [], mapping: {}, decisions: {}, vlanRoleMap: {}, allowUnresolved: false,
  };
  _wiz.previewStale = false; _wiz.reconciliationGroups = [];
  _wiz.compare = { state: 'idle', result: null, error: '' };
  // ⭐ Il mago si apre sulla SCELTA DEL SITO, non su «importa tutto». Un sito = un
  // progetto è già la regola scritta nel manuale, ed è già il modo in cui si sceglie
  // il nome del progetto (un solo sito → quel sito; più siti → un nome neutro, cioè
  // il caso degenere). Aprendo sullo scarico globale la strada consigliata era
  // quella fuori strada: adesso «Avanti» resta spento finché non scegli, e
  // «Importa tutto il DCIM» è una deviazione dichiarata, non il punto di partenza.
  _wiz.scopeMode = 'custom'; _wiz.scopeKind = 'site'; _wiz.scopeSearch = '';
  _resetCommitState();
  _showTab('import');
}
function closeDcimSync() {
  _stopCommitProgressTimer();
  const ov = _el('dcim-overlay');
  if (ov) ov.classList.remove('open');
}

// Prova connessione: usa url+token dei campi (pre-salvataggio); se il token è
// vuoto ma già impostato, il server ricade su quello salvato. Errore SENZA token.
async function _test() {
  const url = _val('dcim-url');
  const token = (_el('dcim-token') ? _el('dcim-token').value : '');   // NON trim: il token può avere spazi? no, ma non lo tocchiamo
  const verifyTls = _checked('dcim-verifytls');
  if (!url) { _setStatus(t('integrations.needUrl'), 'err'); _setTestBtn('err'); return; }
  _setStatus(t('integrations.testing'), ''); _setTestBtn('');
  const body = { url, verifyTls };
  if (token) body.token = token;
  try {
    const r = await fetch(API + '/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (j && j.ok) {
      const authLabel = j.authMethod === 'v2' ? t('integrations.authV2')
        : j.authMethod === 'v1' ? t('integrations.authV1Legacy') : '';
      _setStatus(t('integrations.connected') + (j.version ? ' · NetBox v' + j.version : '') + (authLabel ? ' — ' + authLabel : ''), j.authMethod === 'v1' ? 'warn' : 'ok');
      _setTestBtn('ok');
    } else {
      _setStatus(t('integrations.testFail') + (j && j.error ? ' — ' + j.error : ''), 'err');
      _setTestBtn('err');
    }
  } catch (_) { _setStatus(t('integrations.testFail'), 'err'); _setTestBtn('err'); }
}

// Salva la config (PUT admin). Il token viaggia solo se l'utente ne ha digitato
// uno: campo vuoto → il server mantiene quello salvato (undefined = invariato).
async function _save() {
  const url = _val('dcim-url');
  const token = (_el('dcim-token') ? _el('dcim-token').value : '');
  const verifyTls = _checked('dcim-verifytls');
  const body = { url, verifyTls };
  if (token) body.token = token;
  try {
    const r = await fetch(API + '/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) { showAlert(t('integrations.saveFail')); return; }
    await _loadConfig();
    showAlert(t('integrations.saved'));
  } catch (_) { showAlert(t('integrations.saveFail')); }
}

// ── Wizard di importazione (Ambito → Entità → Anteprima → commit) ───────────
const _wiz = {
  step: 1,
  scopes: null, loadingScopes: false, scopeErr: '',
  scopeMode: 'all', scopeKind: 'site', scopeSearch: '',
  selection: {
    entities: { devices: true, cabling: true, ipam: true, racks: true },
    scope: { siteIds: [], roleSlugs: [], tags: [] },
    exclude: [],
    mapping: {},
    decisions: {},
    // Ruolo IPAM di NetBox → dichiarazione InfraNet ('mgmt'|'voice'|'guest'|'native').
    // Vuoto di proposito: il motore non indovina, e finché non c'è una scelta qui
    // dentro le liste di VLAN del documento restano quelle scritte a mano.
    vlanRoleMap: {},
    allowUnresolved: false,
  },
  preview: null, previewStale: false, reconciliationGroups: [], loadingPreview: false, previewErr: '',
  // Ri-lettura: che cosa è cambiato nel DCIM da quando hai importato. È una
  // LETTURA — non scrive niente nel documento — e vive accanto all'anteprima
  // perché usa lo stesso ambito: si confronta quel che si importerebbe.
  compare: { state: 'idle', result: null, error: '' },
  projectName: '',
  commit: { state: 'idle', stage: 0, result: null, error: '', name: '' },
};

let _catalogStatus = null;
let _catalogActionBusy = '';

function _renderCatalogStatus() {
  const el = _el('dcim-catalog-summary');
  if (!el) return;
  const c = _catalogStatus;
  if (!c) { el.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${escapeHTML(t('integrations.catalogLoading'))}`; return; }
  if (!c.available) {
    const actions = store._currentUser && store._currentUser.role === 'admin'
      ? `<div class="dcim-catalog-actions">
          <button class="um-btn" data-act="dcim-catalog-check"${_catalogActionBusy ? ' disabled' : ''}><i class="fas ${_catalogActionBusy === 'check' ? 'fa-spinner fa-spin' : 'fa-rotate'}"></i> ${escapeHTML(_catalogActionBusy === 'check' ? t('integrations.catalogChecking') : t('integrations.catalogCheck'))}</button>
          <button class="um-btn" data-act="dcim-catalog-update"${_catalogActionBusy ? ' disabled' : ''}><i class="fas ${_catalogActionBusy === 'update' ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}"></i> ${escapeHTML(_catalogActionBusy === 'update' ? t('integrations.catalogUpdating') : t('integrations.catalogUpdate'))}</button>
        </div>`
      : `<span style="margin-left:10px">${escapeHTML(t('integrations.catalogViewer'))}</span>`;
    el.innerHTML = `<i class="fas fa-circle-info"></i> ${escapeHTML(t('integrations.catalogLegacy'))}${actions}`;
    return;
  }
  const ref = String(c.generatedAt || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || t('integrations.catalogLocal');
  const actions = store._currentUser && store._currentUser.role === 'admin'
    ? `<div class="dcim-catalog-actions">
        <button class="um-btn" data-act="dcim-catalog-check"${_catalogActionBusy ? ' disabled' : ''}><i class="fas ${_catalogActionBusy === 'check' ? 'fa-spinner fa-spin' : 'fa-rotate'}"></i> ${escapeHTML(_catalogActionBusy === 'check' ? t('integrations.catalogChecking') : t('integrations.catalogCheck'))}</button>
        <button class="um-btn" data-act="dcim-catalog-diff"><i class="fas fa-code-compare"></i> ${escapeHTML(t('integrations.catalogDiff'))}</button>
        <button class="um-btn" data-act="dcim-catalog-update"${_catalogActionBusy ? ' disabled' : ''}><i class="fas ${_catalogActionBusy === 'update' ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}"></i> ${escapeHTML(_catalogActionBusy === 'update' ? t('integrations.catalogUpdating') : t('integrations.catalogUpdate'))}</button>
      </div>`
    : `<span style="margin-left:10px">${escapeHTML(t('integrations.catalogViewer'))}</span>`;
  el.innerHTML = `<i class="fas fa-database" style="color:var(--success-color)"></i> <strong>${escapeHTML(t('integrations.catalogTitle'))}</strong>
    <span style="margin-left:8px">${escapeHTML(t('integrations.catalogStats', { canonical: c.canonicalModels || 0, runtime: c.catalogModels || 0, vendors: c.catalogVendors || 0, excluded: c.excludedModels || 0 }))}</span>
    <span style="margin-left:8px">${escapeHTML(t('integrations.catalogVersion', { version: ref }))}</span>${actions}`;
}

async function _loadCatalogStatus() {
  _catalogStatus = null; _renderCatalogStatus();
  try {
    const r = await fetch(API + '/catalog', { headers: { Accept: 'application/json' } });
    _catalogStatus = r.ok ? await r.json() : { available: false };
  } catch (_) { _catalogStatus = { available: false }; }
  _renderCatalogStatus();
}

async function _catalogAction(action) {
  if (_catalogActionBusy) return;
  _catalogActionBusy = action; _renderCatalogStatus();
  try {
    const r = await fetch(API + '/catalog/' + action, { method: 'POST', headers: { Accept: 'application/json' } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.ok) throw new Error(body.error || ('HTTP ' + r.status));
    await _loadCatalogStatus();
    if (action === 'update' && typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new Event('infranet:catalog-updated'));
    }
    showAlert(action === 'update' ? t('integrations.catalogUpdated') : body.available ? t('integrations.catalogAvailable') : t('integrations.catalogUpToDate'));
  } catch (e) {
    showAlert(String((e && e.message) || e || t('integrations.catalogUpdateFail')));
  }
  _catalogActionBusy = ''; _renderCatalogStatus();
}

async function _showCatalogDiff() {
  try {
    const r = await fetch(API + '/catalog/diff', { headers: { Accept: 'application/json' } });
    const body = await r.json().catch(() => ({}));
    const counts = body.diff && body.diff.counts;
    if (!counts) return showAlert(t('integrations.catalogUpToDate'));
    showAlert(t('integrations.catalogDiffSummary', {
      added: counts.added || 0,
      removed: counts.removed || 0,
      metadata: counts.metadataChanged || 0,
      template: counts.templateChanged || 0,
    }));
  } catch (_) { showAlert(t('integrations.catalogUpdateFail')); }
}

let _commitProgressTimer = null;
const _commitStages = [
  { icon: 'fa-plug', key: 'integrations.commitStageConnect' },
  { icon: 'fa-cloud-arrow-down', key: 'integrations.commitStageRead' },
  { icon: 'fa-diagram-project', key: 'integrations.commitStageBuild' },
  { icon: 'fa-floppy-disk', key: 'integrations.commitStageSave' },
];

function _stopCommitProgressTimer() {
  if (_commitProgressTimer) clearTimeout(_commitProgressTimer);
  _commitProgressTimer = null;
}

function _resetCommitState() {
  _stopCommitProgressTimer();
  _wiz.commit = { state: 'idle', stage: 0, result: null, error: '', name: '' };
}

function _scheduleCommitProgress() {
  _stopCommitProgressTimer();
  const advance = () => {
    if (_wiz.commit.state !== 'running') return;
    _wiz.commit.stage = Math.min(_wiz.commit.stage + 1, _commitStages.length - 2);
    _renderImport();
    _commitProgressTimer = setTimeout(advance, 1600);
  };
  _commitProgressTimer = setTimeout(advance, 1600);
}

const _sp = () => `<i class="fas fa-spinner fa-spin" style="color:var(--text-muted)"></i> ${escapeHTML(t('integrations.loading'))}`;

function _showTab(tab) {
  const isImp = tab !== 'export';
  const imp = _el('dcim-import-pane'), exp = _el('dcim-export-pane');
  const ti = _el('dcim-tab-import'), te = _el('dcim-tab-export');
  if (imp) imp.style.display = isImp ? '' : 'none';
  if (exp) exp.style.display = isImp ? 'none' : '';
  if (ti) ti.classList.toggle('active', isImp);
  if (te) te.classList.toggle('active', !isImp);
  if (isImp) { _renderImport(); if (!_wiz.scopes && !_wiz.loadingScopes) _loadScopes(); }
  else _renderExport();
}

function _renderExport() {
  const b = _el('dcim-export-body');
  if (b) b.innerHTML = `<div style="padding:14px;border:0.5px dashed var(--border-strong);border-radius:var(--radius);color:var(--text-secondary);font-size:.9rem">
    <i class="fas fa-lock" style="margin-right:6px"></i>${escapeHTML(t('integrations.exportUpsell'))}</div>`;
}

function _scopeChecked(kind, id) {
  const sc = _wiz.selection.scope;
  if (kind === 'site') return sc.siteIds.includes(+id);
  if (kind === 'role') return sc.roleSlugs.includes(String(id));
  if (kind === 'tag') return sc.tags.includes(String(id));
  return false;
}
function _toggleScope(kind, id, checked) {
  const sc = _wiz.selection.scope;
  const arr = kind === 'site' ? sc.siteIds : kind === 'role' ? sc.roleSlugs : sc.tags;
  const val = kind === 'site' ? +id : String(id);
  const i = arr.indexOf(val);
  if (checked && i < 0) arr.push(val);
  if (!checked && i >= 0) arr.splice(i, 1);
}

function _scopeItems(kind) {
  const scopes = _wiz.scopes || { sites: [], roles: [], tags: [] };
  return kind === 'site' ? scopes.sites : kind === 'role' ? scopes.roles : scopes.tags;
}

function _scopeItemMatches(item) {
  const query = String(_wiz.scopeSearch || '').trim().toLowerCase();
  if (!query) return true;
  return [item.name, item.slug].filter(Boolean).some(value => String(value).toLowerCase().includes(query));
}

function _scopeSelectionCount() {
  const scope = _wiz.selection.scope;
  return (scope.siteIds.length || 0) + (scope.roleSlugs.length || 0) + (scope.tags.length || 0);
}

function _scopeIsComplete(kind) {
  const items = _scopeItems(kind);
  if (!items.length) return false;
  const selected = kind === 'site' ? _wiz.selection.scope.siteIds.map(String) : kind === 'role' ? _wiz.selection.scope.roleSlugs.map(String) : _wiz.selection.scope.tags.map(String);
  const ids = items.map(item => String(kind === 'site' ? item.id : item.slug));
  return selected.length >= ids.length && ids.every(id => selected.includes(id));
}

function _selectionForRequest() {
  const selection = Object.assign({}, _wiz.selection, { scope: Object.assign({}, _wiz.selection.scope) });
  if (_scopeIsComplete('site')) selection.scope.siteIds = [];
  if (_scopeIsComplete('role')) selection.scope.roleSlugs = [];
  if (_scopeIsComplete('tag')) selection.scope.tags = [];
  // Solo le scelte che il motore sa applicare, e mai quelle lasciate al default:
  // la richiesta descrive cosa l'utente ha CAMBIATO, non lo stato del pannello.
  selection.decisions = sanitizeDecisions(_wiz.selection.decisions);
  return selection;
}

function _scopeSelectionSummary() {
  const scope = _wiz.selection.scope;
  const parts = [];
  // Singolare/plurale come nel pannello delle decisioni: «1 siti» fa sembrare
  // improvvisata tutta la schermata, e questa riga adesso si legge anche nel
  // confronto, dove dice l'ambito di ciò che è stato messo a paragone.
  if (scope.siteIds.length) parts.push(_scopeIsComplete('site') ? t('integrations.scopeAllSites') : _tp('integrations.scopeSitesSelected', scope.siteIds.length, { n: scope.siteIds.length }));
  if (scope.roleSlugs.length) parts.push(_scopeIsComplete('role') ? t('integrations.scopeAllRoles') : _tp('integrations.scopeRolesSelected', scope.roleSlugs.length, { n: scope.roleSlugs.length }));
  if (scope.tags.length) parts.push(_scopeIsComplete('tag') ? t('integrations.scopeAllTags') : _tp('integrations.scopeTagsSelected', scope.tags.length, { n: scope.tags.length }));
  const devices = _scopeItems('site').filter(site => scope.siteIds.includes(+site.id)).reduce((sum, site) => sum + Number(site.deviceCount || 0), 0);
  if (devices) parts.push(_tp('integrations.scopeDevicesSelected', devices, { n: devices }));
  return parts.length ? parts.join(' · ') : t('integrations.scopeSummaryEmpty');
}

function _renderImport() {
  const b = _el('dcim-import-body');
  if (!b) return;
  // La modale non si allarga più a 1080px quando c'è da riconciliare: serviva alla
  // tabella a quattro colonne del vecchio pannello. Ora quelle scelte sono righe come
  // le altre, e a piena larghezza le spiegazioni diventavano righe da 140 caratteri.
  if (_wiz.commit.state === 'running') { b.innerHTML = _renderCommitProgress(); return; }
  if (_wiz.commit.state === 'done') { b.innerHTML = _renderCommitResult(); return; }
  if (_wiz.commit.state === 'error') { b.innerHTML = _renderCommitError(); return; }
  // Il confronto prende tutta la modale: è una lettura a sé, non un pezzo
  // dell'anteprima, e mescolarlo coi passi dell'import confonderebbe due intenti
  // diversi — «crea una fotocopia» e «dimmi che cosa è cambiato».
  if (_wiz.compare.state !== 'idle') { b.innerHTML = _renderCompare(); return; }
  const s = _wiz.step;
  const dot = (n, key) => `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:${n <= s ? 'var(--text-primary)' : 'var(--text-muted)'}">
    <span style="width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:0.5px solid var(--border-strong);${n <= s ? 'background:var(--text-accent);color:var(--surface-2)' : ''}">${n}</span>${escapeHTML(t(key))}</div>`;
  const stepper = `<div style="display:flex;align-items:center;gap:12px;margin:12px 0 14px">
    ${dot(1, 'integrations.wizStep1')}<div style="flex:1;height:0.5px;background:var(--border)"></div>
    ${dot(2, 'integrations.wizStep2')}<div style="flex:1;height:0.5px;background:var(--border)"></div>
    ${dot(3, 'integrations.wizStep3')}</div>`;
  const body = s === 1 ? _renderScopeStep() : s === 2 ? _renderEntityStep() : _renderPreviewStep();
  const scopeReady = _wiz.scopeMode !== 'custom' || _scopeSelectionCount() > 0;
  const nav = `<div style="display:flex;justify-content:space-between;margin-top:14px">
    <button class="um-btn" data-act="dcim-wiz-back"${s === 1 ? ' style="visibility:hidden"' : ''}><i class="fas fa-arrow-left"></i> ${escapeHTML(t('integrations.back'))}</button>
    ${s < 3 ? `<button class="um-btn primary" data-act="dcim-wiz-next"${s === 1 && !scopeReady ? ' disabled' : ''}>${escapeHTML(t('integrations.next'))} <i class="fas fa-arrow-right"></i></button>` : '<span></span>'}</div>`;
  b.innerHTML = stepper + body + nav;
}

// ── Ri-lettura: che cosa è cambiato nel DCIM ────────────────────────────────
// Una riga = un oggetto che è cambiato, con i due valori affiancati. Il pannello
// NON offre un «applica»: applicare vuol dire decidere chi vince campo per campo,
// ed è una decisione che non si prende dentro un elenco. Qui si legge, e si
// corregge a mano — che è come funziona tutto il resto del documento.
const _CMP_GROUPS = [
  { key: 'devices', icon: 'fa-server' },
  { key: 'racks', icon: 'fa-layer-group' },
  { key: 'prefixes', icon: 'fa-sitemap' },
  { key: 'vlans', icon: 'fa-tags' },
];

function _cmpFieldLabel(field) {
  const key = 'dcim.cmp.f.' + field;
  const s = t(key);
  return s === key ? field : s;
}

// Un confronto largo può produrre centinaia di righe — misurato: leggendo TUTTO
// NetBox contro un progetto di un sito solo ne escono 181, e sono tutte vere.
// Un muro di righe però non si legge: si mostrano le prime e si DICE quante
// restano, come per gli apparati nella lista di decisioni.
const _CMP_ROWS_SHOWN = 25;

function _cmpMore(n) {
  if (n <= 0) return '';
  return `<div class="dcim-cmp-more">${escapeHTML(t('dcim.cmp.andMore', { n }))}</div>`;
}

function _cmpRows(list, kind, groupKey) {
  return list.slice(0, _CMP_ROWS_SHOWN).map(item => {
    const fields = (item.fields || []).map(f => {
      const manual = f.manual ? ` <span class="dcim-cmp-manual">${escapeHTML(t('dcim.cmp.yours'))}</span>` : '';
      return `<div class="dcim-cmp-field"><span class="dcim-cmp-fname">${escapeHTML(_cmpFieldLabel(f.field))}</span>
        <span class="dcim-cmp-doc">${escapeHTML(f.doc || t('dcim.cmp.empty'))}${manual}</span>
        <i class="fas fa-arrow-right-long"></i>
        <span class="dcim-cmp-dcim">${escapeHTML(f.dcim)}</span></div>`;
    }).join('');
    return `<article class="dcim-cmp-row is-${escapeHTML(kind)}">
      <div class="dcim-cmp-head"><span class="dcim-cmp-tag">${escapeHTML(t('dcim.cmp.' + kind))}</span>
        <strong>${escapeHTML(item.name)}</strong></div>
      ${fields}
    </article>`;
  }).join('') + _cmpMore(list.length - _CMP_ROWS_SHOWN);
}

// ⚠️ Questi tre sono FUNZIONI e non variabili locali di proposito. Trasportano
// HTML già composto, quindi non si possono avvolgere in escapeHTML() — e lo
// scanner dell'escaping sa dimostrare una CHIAMATA (guarda dentro il corpo), non
// una locale (non fa analisi interprocedurale). Scritti come `const x = …` erano
// cinque interpolazioni non provate e un tetto da alzare; così sono zero.
// L'ambito del confronto ha DUE autorità possibili, e la differenza cambia come si
// leggono i numeri. Se il progetto sa da dove viene (dalla 2.9.2 lo registra), è lui
// a dettarlo e il confronto è esatto. Se non lo sa — progetto importato prima — si
// ricade sulla scelta fatta a mano, e va detto invece di lasciarlo credere.
//
// ⚠️ Ambito vuoto non vuol dire «niente»: nel passo 1 vuol dire «importa tutto».
// `_scopeSelectionSummary` risponde «Nessun ambito selezionato», che nell'anteprima
// è giusto — non hai ancora scelto — e qui sarebbe l'esatto contrario del vero,
// proprio nella riga che serve a spiegare perché il DCIM risulta pieno di novità.
function _cmpScopeRow(r) {
  const sc = (r && r.scope) || {};
  if (sc.fromProject) {
    const names = (Array.isArray(sc.sites) ? sc.sites : []).map(s => s && s.name).filter(Boolean);
    return `<div class="dcim-cmp-scope is-exact"><i class="fas fa-crosshairs"></i> ${escapeHTML(t('dcim.cmp.scopeProject', { sites: names.join(' · ') }))}</div>`;
  }
  const scope = _scopeSelectionCount() > 0 ? _scopeSelectionSummary() : t('dcim.cmp.scopeAll');
  return `<div class="dcim-cmp-scope"><i class="fas fa-filter"></i> ${escapeHTML(t('dcim.cmp.scope', { scope }))}</div>`;
}

function _cmpHandmade(hm) {
  const h = hm || {};
  if (!h.devices && !h.prefixes) return '';
  return `<div class="dcim-cmp-note"><i class="fas fa-hand"></i> ${escapeHTML(t('dcim.cmp.handmade', { devices: h.devices || 0, prefixes: h.prefixes || 0 }))}</div>`;
}

function _cmpGroup(grp, g) {
  const group = grp || {};
  const count = (group.changed || []).length + (group.added || []).length + (group.removed || []).length;
  if (!count) return '';
  return `<div class="dcim-cmp-group"><span class="dcim-dec-label"><i class="fas ${escapeHTML(g.icon)}"></i> ${escapeHTML(t('dcim.cmp.g.' + g.key))} · ${escapeHTML(String(count))}</span>${_cmpRows(group.changed || [], 'changed', g.key)}${_cmpRows(group.added || [], 'added', g.key)}${_cmpRows(group.removed || [], 'removed', g.key)}</div>`;
}

function _cmpFresh(r) {
  if (!r || !r.fetchedAt) return '';
  return `<div class="dcim-dec-fresh"><span>${escapeHTML(t('dcim.dec.fetchedAt', { time: _clock(r.fetchedAt) }))}</span>
    <button class="um-btn um-btn-ghost" data-act="dcim-compare-reread"><i class="fas fa-cloud-arrow-down"></i> ${escapeHTML(t('dcim.dec.reread'))}</button></div>`;
}

function _compareButton() {
  // Compare solo se un progetto è aperto: senza, non c'è niente con cui
  // confrontarsi e un bottone inerte è peggio di un bottone assente.
  if (store.currentProjectId == null) return '<span></span>';
  const busy = _wiz.compare.state === 'running';
  return `<button class="um-btn" data-act="dcim-compare"${busy ? ' disabled' : ''}><i class="fas ${busy ? 'fa-spinner fa-spin' : 'fa-code-compare'}"></i> ${escapeHTML(t('dcim.cmp.action'))}</button>`;
}

function _renderCompare() {
  const c = _wiz.compare;
  const back = `<button class="um-btn" data-act="dcim-compare-back"><i class="fas fa-arrow-left"></i> ${escapeHTML(t('dcim.cmp.back'))}</button>`;
  if (c.state === 'running') {
    return `<section class="dcim-cmp"><div class="dcim-cmp-lead"><i class="fas fa-spinner fa-spin"></i> ${escapeHTML(t('dcim.cmp.running'))}</div></section>`;
  }
  if (c.state === 'error') {
    return `<section class="dcim-cmp"><div class="dcim-preview-status is-blocked"><i class="fas fa-triangle-exclamation"></i> ${escapeHTML(c.error || t('dcim.cmp.failed'))}</div>
      <div style="margin-top:12px">${back}</div></section>`;
  }
  const r = c.result || {};
  const d = r.diff || {};
  const n = d.counts || { added: 0, removed: 0, changed: 0 };
  // Il preventivo del confronto, con lo stesso peso del preventivo dell'import:
  // è la riga che si legge davvero.
  const head = `<div class="dcim-outcome">
    <div class="dcim-outcome-main"><span class="dcim-out-lead">${escapeHTML(t('dcim.cmp.outcome', { name: r.projectName || '' }))}</span>
      <span class="dcim-out-n">${escapeHTML(_tp('dcim.cmp.nChanged', n.changed, { n: n.changed }))}</span><i>·</i>
      <span class="dcim-out-n">${escapeHTML(_tp('dcim.cmp.nAdded', n.added, { n: n.added }))}</span><i>·</i>
      <span class="dcim-out-n">${escapeHTML(_tp('dcim.cmp.nRemoved', n.removed, { n: n.removed }))}</span></div>
    ${d.clean ? `<div class="dcim-outcome-costs is-clean"><i class="fas fa-circle-check"></i> ${escapeHTML(t('dcim.cmp.clean'))}</div>` : ''}
  </div>`;
  // Il lavoro fatto a mano NON è una differenza: è la ragione per cui questo
  // pannello non applica niente da solo. Va detto sempre, anche a zero differenze.
  const groups = _CMP_GROUPS.map(g => _cmpGroup(d[g.key], g)).join('');
  return `<section class="dcim-cmp">
    <div class="dcim-cmp-lead"><i class="fas fa-code-compare"></i> ${escapeHTML(t('dcim.cmp.lead'))}</div>
    ${_cmpScopeRow(r)}
    ${head}${_cmpHandmade(d.handmade)}${groups}${_cmpFresh(r)}
    <div style="margin-top:12px">${back}</div>
  </section>`;
}

function _renderCommitProgress() {
  const stage = Math.min(_wiz.commit.stage, _commitStages.length - 1);
  const steps = _commitStages.map((item, index) => {
    const state = index < stage ? 'is-done' : index === stage ? 'is-active' : '';
    const marker = index < stage ? '<i class="fas fa-check"></i>' : `<i class="fas ${item.icon}"></i>`;
    return `<li class="dcim-progress-step ${state}"><span class="dcim-progress-marker">${marker}</span><span>${escapeHTML(t(item.key))}</span></li>`;
  }).join('');
  return `<section class="dcim-import-progress" aria-live="polite">
    <div class="dcim-progress-hero"><span class="dcim-progress-icon"><i class="fas fa-server fa-pulse"></i></span>
      <div><h4>${escapeHTML(t('integrations.commitTitle'))}</h4><p>${escapeHTML(t('integrations.commitHint'))}</p></div></div>
    <div class="dcim-progress-track" role="progressbar" aria-label="${escapeHTML(t('integrations.commitTitle'))}"><span></span></div>
    <ol class="dcim-progress-steps">${steps}</ol>
    <div class="dcim-progress-live"><i class="fas fa-spinner fa-spin"></i> ${escapeHTML(t(_commitStages[stage].key))}</div>
  </section>`;
}

function _renderCommitResult() {
  const result = _wiz.commit.result || {};
  const c = result.counts || {};
  const name = _wiz.commit.name || ('#' + (result.projectId ?? ''));
  const count = (value, key) => `<div class="dcim-result-count"><strong>${Number(value || 0)}</strong><span>${escapeHTML(t(key))}</span></div>`;
  return `<section class="dcim-import-result" aria-live="polite">
    <div class="dcim-result-hero"><span class="dcim-result-icon"><i class="fas fa-circle-check"></i></span>
      <div><h4>${escapeHTML(t('integrations.commitDone'))}</h4><p>${escapeHTML(t('integrations.created', { name }))}</p></div></div>
    <div class="dcim-result-grid">${count(c.devices, 'integrations.cDevices')}${count(c.interfaces, 'integrations.cInterfaces')}${count(c.cables, 'integrations.cCables')}${count(c.vlans, 'integrations.cVlans')}</div>
    <div class="dcim-result-actions"><button class="um-btn primary" data-act="dcim-open-created"${result.projectId == null ? ' disabled' : ''}><i class="fas fa-arrow-up-right-from-square"></i> ${escapeHTML(t('integrations.openProject'))}</button>
      <button class="um-btn ghost" data-act="dcim-close">${escapeHTML(t('integrations.progressClose'))}</button></div>
  </section>`;
}

function _renderCommitError() {
  return `<section class="dcim-import-result dcim-import-result-error" aria-live="assertive">
    <div class="dcim-result-hero"><span class="dcim-result-icon"><i class="fas fa-circle-exclamation"></i></span>
      <div><h4>${escapeHTML(t('integrations.commitFailed'))}</h4><p>${escapeHTML(_wiz.commit.error || t('integrations.importFail'))}</p></div></div>
    <div class="dcim-result-actions"><button class="um-btn primary" data-act="dcim-commit-retry"><i class="fas fa-rotate-right"></i> ${escapeHTML(t('integrations.retry'))}</button></div>
  </section>`;
}

function _renderScopeStep() {
  if (_wiz.loadingScopes) return `<div>${_sp()}</div>`;
  if (_wiz.scopeErr) return `<div style="color:var(--danger-color);font-size:.9rem">${escapeHTML(_wiz.scopeErr)}
    <button class="um-btn" data-act="dcim-load-scopes" style="margin-left:8px">${escapeHTML(t('integrations.retry'))}</button></div>`;
  const sc = _wiz.scopes || { sites: [], roles: [], tags: [] };
  const totalDevices = sc.sites.reduce((sum, site) => sum + Number(site.deviceCount || 0), 0);
  if (_wiz.scopeMode !== 'custom') {
    return `<section class="dcim-scope-quick" aria-labelledby="dcim-scope-title">
      <p class="dcim-scope-hint" id="dcim-scope-title">${escapeHTML(t('integrations.scopeHint'))}</p>
      <div class="dcim-scope-choice-grid">
        <button class="dcim-scope-choice is-primary" data-act="dcim-scope-custom">
          <span class="dcim-scope-choice-icon"><i class="fas fa-building"></i></span>
          <span class="dcim-scope-choice-copy"><strong>${escapeHTML(t('integrations.scopeCustom'))}</strong><small>${escapeHTML(t('integrations.scopeCustomDesc'))}</small></span>
          <i class="fas fa-arrow-right dcim-scope-choice-arrow"></i>
        </button>
        <button class="dcim-scope-choice" data-act="dcim-scope-all">
          <span class="dcim-scope-choice-icon"><i class="fas fa-globe"></i></span>
          <span class="dcim-scope-choice-copy"><strong>${escapeHTML(t('integrations.scopeAll'))}</strong><small>${escapeHTML(t('integrations.scopeAllDesc', { devices: totalDevices, sites: sc.sites.length }))}</small></span>
          <i class="fas fa-arrow-right dcim-scope-choice-arrow"></i>
        </button>
      </div>
    </section>`;
  }

  const kind = _wiz.scopeKind || 'site';
  const kinds = [
    { key: 'site', label: t('integrations.sites'), icon: 'fa-building' },
    { key: 'role', label: t('integrations.roles'), icon: 'fa-user-tag' },
    { key: 'tag', label: t('integrations.tags'), icon: 'fa-tag' },
  ];
  const items = _scopeItems(kind);
  const filteredItems = items.filter(_scopeItemMatches);
  const row = item => {
    const id = kind === 'site' ? item.id : kind === 'role' ? item.slug : item.slug;
    const count = kind === 'site' ? t('integrations.devicesN', { n: item.deviceCount || 0 }) : t('integrations.scopeItemsN', { n: item.count || 0 });
    const searchText = [item.name, item.slug].filter(Boolean).join(' ');
    return `<label class="dcim-scope-option" data-scope-option data-search="${escapeHTML(searchText)}">
      <input type="checkbox" data-change="dcim-scope" data-kind="${kind}" data-id="${escapeHTML(String(id))}"${_scopeChecked(kind, id) ? ' checked' : ''}>
      <span class="dcim-scope-option-name">${escapeHTML(item.name)}</span>
      <span class="dcim-scope-option-count">${escapeHTML(String(count))}</span>
    </label>`;
  };
  const tabs = kinds.map(item => `<button class="dcim-scope-tab${item.key === kind ? ' is-active' : ''}" data-act="dcim-scope-kind" data-kind="${item.key}" role="tab" aria-selected="${item.key === kind ? 'true' : 'false'}"><i class="fas ${item.icon}"></i>${escapeHTML(item.label)}<span>${_scopeItems(item.key).length}</span></button>`).join('');
  const rows = filteredItems.map(row).join('');
  return `<section class="dcim-scope-custom" aria-labelledby="dcim-scope-custom-title">
    <div class="dcim-scope-custom-head">
      <div><h4 id="dcim-scope-custom-title"><i class="fas fa-sliders"></i> ${escapeHTML(t('integrations.scopeCustom'))}</h4><p>${escapeHTML(t('integrations.scopeCustomDesc'))}</p></div>
      <button class="um-btn ghost dcim-scope-all-link" data-act="dcim-scope-all"><i class="fas fa-globe"></i> ${escapeHTML(t('integrations.scopeBackToAll'))}</button>
    </div>
    <div class="dcim-scope-summary"><i class="fas fa-filter"></i><span>${escapeHTML(_scopeSelectionSummary())}</span></div>
    <div class="dcim-scope-tabs" role="tablist">${tabs}</div>
    <div class="dcim-scope-toolbar">
      <label class="dcim-scope-search"><i class="fas fa-search"></i><input type="search" data-input="dcim-scope-search" value="${escapeHTML(_wiz.scopeSearch)}" placeholder="${escapeHTML(t('integrations.scopeSearch'))}" autocomplete="off"></label>
      <div class="dcim-scope-actions"><button class="um-btn" data-act="dcim-scope-select-all"><i class="fas fa-check-double"></i> ${escapeHTML(t('integrations.scopeSelectAll'))}</button><button class="um-btn" data-act="dcim-scope-clear"><i class="fas fa-xmark"></i> ${escapeHTML(t('integrations.scopeClear'))}</button></div>
    </div>
    <div class="dcim-scope-list" id="dcim-scope-list" role="tabpanel">${rows}<div class="dcim-scope-empty"${filteredItems.length ? ' hidden' : ''}><i class="fas fa-magnifying-glass"></i> ${escapeHTML(t('integrations.scopeEmpty'))}</div></div>
  </section>`;
}

function _renderEntityStep() {
  const e = _wiz.selection.entities;
  const tog = (key, icon, label) => `<label class="row" style="display:flex;align-items:center;gap:10px;padding:9px 11px;border:0.5px solid var(--border);border-radius:var(--radius);margin-bottom:7px;font-size:13px">
    <input type="checkbox" data-change="dcim-ent" data-key="${key}"${e[key] !== false ? ' checked' : ''}>
    <i class="fas ${icon}" style="color:var(--text-secondary)"></i><span style="flex:1">${escapeHTML(label)}</span></label>`;
  return `<p style="font-size:.85rem;color:var(--text-muted);margin:0 0 10px">${escapeHTML(t('integrations.entHint'))}</p>`
    + tog('devices', 'fa-server', t('integrations.entDevices'))
    + tog('cabling', 'fa-network-wired', t('integrations.entCabling'))
    + tog('ipam', 'fa-sitemap', t('integrations.entIpam'))
    + tog('racks', 'fa-layer-group', t('integrations.entRacks'));
}

const _RECON_TYPES = [
  'switch', 'router', 'firewall', 'server', 'hypervisor', 'nas', 'kvm', 'ups', 'pdu', 'ats',
  'patchpanel', 'ap', 'webcam', 'tv', 'iot', 'pc', 'mobile', 'voip', 'printer', 'projector',
  'doorctrl', 'consolesvr', 'pbx', 'nvr', 'wlanctrl', 'customfloor', 'customrack',
];

function _reconcileTypeLabel(type) {
  const key = 'type.' + type;
  const label = t(key);
  return label === key ? type : label;
}

function _reconciliationGroups(details) {
  const groups = new Map();
  for (const detail of Array.isArray(details) ? details : []) {
    if (!detail || !detail.reviewRequired) continue;
    const key = [detail.brand || '', detail.model || '', detail.roleSlug || '', detail.type || '', detail.placement || '', detail.status || ''].join('\u001f');
    let group = groups.get(key);
    if (!group) {
      group = { brand: detail.brand || '', model: detail.model || '', sourceSlug: detail.sourceSlug || '', role: detail.roleName || detail.roleSlug || '', type: detail.type || 'customrack', placement: detail.placement || 'floor', status: detail.status || 'unmatched', strategy: detail.strategy || 'unmatched', ids: [], count: 0 };
      groups.set(key, group);
    }
    group.ids.push(detail.deviceId);
    group.count++;
  }
  _wiz.reconciliationGroups = Array.from(groups.values());
  return _wiz.reconciliationGroups;
}

// Riga di decisione «tipo da confermare»: è ciò che restava del pannello
// «Riconciliazione manuale», assorbito qui. Aveva le decisioni vere ma viveva in un
// blocco separato che si contendeva la scena con gli avvisi — e compariva vuoto
// («0 casi») a ogni ricalcolo. Ora è una riga come le altre, con le sue due tendine
// al posto dei bottoni-radio: stessa gerarchia, stesso posto, un pannello solo.
function _renderReviewRows(p, startIndex) {
  const groups = _reconciliationGroups(p.catalogMatches && p.catalogMatches.details || []);
  if (!groups.length) return '';
  // Queste sono le SOLE righe che bloccano la creazione, e lo dicono addosso —
  // al posto del vecchio banner giallo, che lo diceva da un'altra parte e con un
  // altro conteggio (apparati, non decisioni). La valvola «importa comunque» in
  // fondo spegne il blocco, e con lui il tag.
  const blocksTag = _wiz.selection.allowUnresolved === true ? ''
    : `<span class="dcim-dec-blocks">${escapeHTML(t('dcim.dec.blocks'))}</span>`;
  return groups.map((group, index) => {
    const firstMapping = _wiz.selection.mapping && _wiz.selection.mapping[String(group.ids[0])];
    const selectedType = (firstMapping && firstMapping.type) || group.type;
    const selectedPlacement = (firstMapping && firstMapping.placement) || group.placement;
    const typeOptions = _RECON_TYPES.map(type => `<option value="${type}"${type === selectedType ? ' selected' : ''}>${escapeHTML(_reconcileTypeLabel(type))}</option>`).join('');
    const placementOptions = ['rack', 'floor'].map(value => `<option value="${value}"${value === selectedPlacement ? ' selected' : ''}>${escapeHTML(t('dcim.dec.placement.' + value))}</option>`).join('');
    const model = [group.brand, group.model].filter(Boolean).join(' ');
    const why = [
      t('dcim.dec.review.why'),
      model ? t('dcim.dec.models', { list: model }) : '',
      group.role ? t('dcim.dec.roles', { list: group.role }) : '',
    ].filter(Boolean).join(' ');
    return `<article class="dcim-dec is-choice" id="dcim-dec-review-${startIndex + index}">
      <div class="dcim-dec-stripe"></div>
      <div class="dcim-dec-body">
        <div class="dcim-dec-title">${escapeHTML(_tp('dcim.dec.review.title', group.count, { n: group.count }))}` + blocksTag + `</div>
        <div class="dcim-dec-why">${escapeHTML(why)}</div>
        <div class="dcim-dec-selects">
          <label>${escapeHTML(t('integrations.reconcileType'))}
            <select data-change="dcim-map-type" data-group="${index}">${typeOptions}</select></label>
          <label>${escapeHTML(t('integrations.reconcilePlacement'))}
            <select data-change="dcim-map-placement" data-group="${index}">${placementOptions}</select></label>
        </div>
      </div>
    </article>`;
  }).join('');
}

// Righe di abbinamento dei ruoli IPAM. NetBox sa che la VLAN 200 ha ruolo
// «Access - Voice»; InfraNet ha la lista `voiceVlans` e oggi la si compila a mano.
// Fra le due c'è una parola scritta da chi ha popolato l'archivio, e nient'altro:
// per questo la scelta sta QUI, una volta per ruolo, e non in una tabella di
// sinonimi dentro il motore. «Access - Wireless» non è la rete ospiti, e nessuna
// regola automatica avrebbe saputo distinguerla senza chiederlo.
const _VLAN_ROLE_TARGETS = ['', 'mgmt', 'voice', 'guest', 'native'];

function _vlanRoleOptions(role, chosen) {
  return _VLAN_ROLE_TARGETS.map(id =>
    `<option value="${escapeHTML(id)}"${id === chosen ? ' selected' : ''}>${escapeHTML(t('dcim.dec.vlanRole.t.' + (id || 'none')))}</option>`).join('');
}

// Riga a fisarmonica: non scegliere è un esito legittimo (le liste restano come
// sono), quindi la riga chiusa DICE l'esito corrente invece di reclamare spazio.
function _renderVlanRoleRows(p) {
  const roles = Array.isArray(p.vlanRoles) ? p.vlanRoles : [];
  if (!roles.length) return '';
  return roles.map((role) => {
    const chosen = String((_wiz.selection.vlanRoleMap || {})[role.slug] || '');
    const vids = role.vids || [];
    const why = [
      t('dcim.dec.vlanRole.why'),
      t('dcim.dec.vlanRole.vids', { list: vids.slice(0, 8).join(' · ') + (vids.length > 8 ? ' +' + (vids.length - 8) : '') }),
    ].join(' ');
    const chosenLabel = t('dcim.dec.vlanRole.t.' + (chosen || 'none')) + (chosen ? '' : ' · ' + t('dcim.dec.default'));
    return `<details class="dcim-dec dcim-dec-fold is-choice">
      <summary>
        <span class="dcim-dec-fold-title">${escapeHTML(_tp('dcim.dec.vlanRole.title', vids.length, { role: role.name, n: vids.length }))}</span>
        <span class="dcim-dec-fold-chosen">${escapeHTML(chosenLabel)}</span>
        <i class="fas fa-chevron-down"></i>
      </summary>
      <div class="dcim-dec-body">
        <div class="dcim-dec-why">${escapeHTML(why)}</div>
        <div class="dcim-dec-selects">
          <label>${escapeHTML(t('dcim.dec.vlanRole.pick'))}
            <select data-change="dcim-vlan-role" data-slug="${escapeHTML(role.slug)}">${_vlanRoleOptions(role, chosen)}</select></label>
        </div>
      </div>
    </details>`;
  }).join('');
}

// ── Riconciliazione: una riga = una DECISIONE, mai un apparato ──────────────
// Sostituisce la lista di «Avvisi tecnici», che ripeteva la stessa frase una volta
// per apparato e non chiedeva niente. Qui ogni riga porta la conseguenza, le
// alternative e il default già scelto: chi ha fretta legge il preventivo in testa e
// importa, chi vuole controllare apre l'elenco degli apparati (per NOME).
// Il raggruppamento vive in lib/dcim-decisions.js e lavora sui CODICI degli avvisi
// strutturati del mapper — nessuna frase viene più ri-letta con una regex.

// Singolare/plurale senza una macchina dei plurali: se il conteggio è 1 si cerca
// prima la variante `…One`. «1 apparati» è il genere di dettaglio che fa sembrare
// improvvisata tutta la schermata, e costa una chiave.
function _tp(key, n, vars) {
  if (n === 1) { const one = key + 'One'; const s = t(one, vars); if (s !== one) return s; }
  return t(key, vars);
}

// Testo della riga. Un codice sconosciuto (motore più nuovo dell'interfaccia) non
// rompe il pannello: esce con la sua etichetta grezza e il conteggio.
function _decisionText(row, suffix) {
  const key = 'dcim.dec.' + row.code + '.' + suffix;
  const vars = Object.assign({ n: row.count, code: row.code }, row.data || {});
  const text = suffix === 'title' ? _tp(key, row.count, vars) : t(key, vars);
  if (text !== key) return text;
  return suffix === 'title' ? _tp('dcim.dec.unknown.title', row.count, vars) : '';
}

// Ora locale HH:MM da un ISO. Solo l'orario: la lettura vive una manciata di
// minuti, la data sarebbe rumore. ISO illeggibile → stringa vuota, mai «Invalid Date».
function _clock(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function _decisionWhy(row) {
  const parts = [];
  const why = _decisionText(row, (row.data && row.data.mixed) ? 'whyMixed' : 'why');
  if (why) parts.push(why);
  if (row.models && row.models.length) parts.push(t('dcim.dec.models', { list: row.models.slice(0, 6).join(' · ') }));
  if (row.roles && row.roles.length) parts.push(t('dcim.dec.roles', { list: row.roles.slice(0, 6).join(' · ') }));
  if (row.kinds && row.kinds.length) {
    const list = row.kinds.map(k => { const key = 'dcim.dec.kind.' + k; const s = t(key); return s === key ? k : s; });
    // `kinds` trasporta valori distinti di natura diversa a seconda della riga: tipi
    // di cavo, ma anche nomi di tenant o stati NetBox. «Tipi: Dunder-Mifflin, Inc.»
    // e' sbagliato — quindi l'etichetta puo' essere specializzata per codice, e
    // ricade su quella generica quando non lo e'.
    const lblKey = 'dcim.dec.' + row.code + '.kinds';
    const lbl = t(lblKey, { list: list.join(' · ') });
    parts.push(lbl === lblKey ? t('dcim.dec.kinds', { list: list.join(' · ') }) : lbl);
  }
  // Gli esempi per ultimi: la riga dice prima QUANTI e PERCHÉ, poi mostra tre casi.
  // Senza, «180 indirizzi restano fuori» resta un numero su cui non si può decidere
  // niente; con, si riconosce al volo se è roba che serve o zavorra.
  if (row.sample && row.sample.length) parts.push(t('dcim.dec.sample', { list: row.sample.slice(0, 3).join(' · ') }));
  return parts.join(' ');
}

// Elenco degli apparati coinvolti: chiuso di default (è il dettaglio, non la
// decisione) e cappato — mille nomi non aiutano nessuno a scegliere.
function _decisionDevices(row, index) {
  if (!row.devices || !row.devices.length) return '';
  const shown = row.devices.slice(0, 40);
  const rest = row.devices.length - shown.length;
  return `<details class="dcim-dec-devices"><summary>${escapeHTML(_tp('dcim.dec.showDevices', row.devices.length, { n: row.devices.length }))}</summary>
    <div class="dcim-dec-devlist" id="dcim-dec-dev-${index}">${shown.map(d => escapeHTML(d.name)).join(' · ')}${rest > 0 ? ' <span>' + escapeHTML(t('dcim.dec.andMore', { n: rest })) + '</span>' : ''}</div></details>`;
}

function _decisionOptions(row, index) {
  return (row.options || []).map(opt => {
    const on = row.chosen === opt.id;
    return `<label class="dcim-dec-opt${on ? ' is-on' : ''}">
      <input type="radio" name="dcim-dec-${index}" data-change="dcim-decision" data-code="${escapeHTML(row.code)}" data-option="${escapeHTML(opt.id)}"${on ? ' checked' : ''}>
      <span><span class="dcim-dec-opt-lab">${escapeHTML(_decisionText(row, opt.id))}</span>
      <span class="dcim-dec-opt-eff">${escapeHTML(_decisionText(row, opt.id + 'Eff'))}</span></span>
      ${opt.isDefault ? `<span class="dcim-dec-def">${escapeHTML(t('dcim.dec.default'))}</span>` : ''}
    </label>`;
  }).join('');
}

// `fold` = riga a fisarmonica. Con le opzioni, la riga chiusa dichiara la
// scelta corrente (titolo a sinistra, scelta a destra) e si apre solo per
// cambiarla. Senza opzioni — perdite e limiti — la riga chiusa tiene il titolo
// e il tag «dato perso»: il fatto resta annunciato (per le perdite anche dal
// chip nel preventivo), la spiegazione aspetta di essere chiesta. Aperti
// restano solo i tipi da confermare, in _renderReviewRows. Una riga senza
// niente da rivelare non finge la tendina: resta un articolo secco.
// L'id serve ai chip del preventivo per arrivare qui.
function _renderDecisionRow(row, index, fold) {
  const isLoss = row.severity === 'loss';
  const opts = _decisionOptions(row, index);
  const lossTag = isLoss ? `<span class="dcim-dec-loss">${escapeHTML(t('dcim.dec.lossTag'))}</span>` : '';
  const why = _decisionWhy(row);
  const devices = _decisionDevices(row, index);
  if (fold && opts) {
    const chosenOpt = (row.options || []).find(opt => opt.id === row.chosen);
    const chosenLabel = chosenOpt
      ? _decisionText(row, chosenOpt.id) + (chosenOpt.isDefault ? ' · ' + t('dcim.dec.default') : '')
      : '';
    return `<details class="dcim-dec dcim-dec-fold is-${escapeHTML(row.severity)}" id="dcim-dec-row-${escapeHTML(row.code)}">
      <summary>
        <span class="dcim-dec-fold-title">${escapeHTML(_decisionText(row, 'title'))}</span>
        <span class="dcim-dec-fold-chosen">${escapeHTML(chosenLabel)}</span>
        <i class="fas fa-chevron-down"></i>
      </summary>
      <div class="dcim-dec-body">
        ` + (why ? `<div class="dcim-dec-why">${escapeHTML(why)}</div>` : '') + `
        <div class="dcim-dec-opts">` + opts + `</div>
        ` + devices + `
      </div>
    </details>`;
  }
  if (fold && (why || devices)) {
    return `<details class="dcim-dec dcim-dec-fold is-${escapeHTML(row.severity)}" id="dcim-dec-row-${escapeHTML(row.code)}">
      <summary>
        <span class="dcim-dec-fold-title">${escapeHTML(_decisionText(row, 'title'))}</span>
        ` + lossTag + `
        <i class="fas fa-chevron-down"></i>
      </summary>
      <div class="dcim-dec-body">
        ` + (why ? `<div class="dcim-dec-why">${escapeHTML(why)}</div>` : '') + devices + `
      </div>
    </details>`;
  }
  return `<article class="dcim-dec is-${escapeHTML(row.severity)}" id="dcim-dec-row-${escapeHTML(row.code)}">
    <div class="dcim-dec-stripe"></div>
    <div class="dcim-dec-body">
      <div class="dcim-dec-title">${escapeHTML(_decisionText(row, 'title'))}` + lossTag + `</div>
      ` + (why ? `<div class="dcim-dec-why">${escapeHTML(why)}</div>` : '') + `
      ` + (opts ? `<div class="dcim-dec-opts">` + opts + '</div>' : '') + `
      ` + devices + `
    </div>
  </article>`;
}

// Chip del preventivo: un chip = un codice con la sua etichetta breve. Nessuna
// etichetta = niente chip inventato. È un bottone: porta alla riga che spiega.
function _costChip(cost) {
  const key = 'dcim.cost.' + cost.code + (cost.chosen ? '.' + cost.chosen : '');
  const label = _tp(key, cost.n, { n: cost.n });
  if (label === key) return '';
  return `<button type="button" class="dcim-cost is-${escapeHTML(cost.severity)}" data-act="dcim-dec-goto" data-code="${escapeHTML(cost.code)}">${escapeHTML(label)}</button>`;
}

// Le PERDITE stanno nel preventivo: la riga «Importerò…» dice subito anche che
// cosa NON entra, con un chip per voce. Due strisce separate perché hanno due
// nature diverse: «non entra» è un fatto senza alternative, «con le scelte
// attuali» è una conseguenza reversibile. Prima dei chip etichettati le perdite
// finivano nel silenzio e la striscia diceva «nessuna perdita» — mentiva.
function _outcomeCosts(o) {
  const losses = (o.costs || []).filter(c => c.severity === 'loss').map(_costChip).filter(Boolean).join('');
  const rest = (o.costs || []).filter(c => c.severity !== 'loss').map(_costChip).filter(Boolean).join('');
  if (!losses && !rest) return `<div class="dcim-outcome-costs is-clean"><i class="fas fa-circle-check"></i> ${escapeHTML(t('dcim.dec.clean'))}</div>`;
  return (losses ? `<div class="dcim-outcome-costs"><span>${escapeHTML(t('dcim.dec.notIn'))}</span>` + losses + '</div>' : '')
    + (rest ? `<div class="dcim-outcome-costs"><span>${escapeHTML(t('dcim.dec.costs'))}</span>` + rest + '</div>' : '');
}

function _outcomeDetail(icon, text) {
  return `<span><i class="fas ${escapeHTML(icon)}"></i> ${escapeHTML(text)}</span>`;
}

// I numeri di seconda fila (interfacce, prefissi, IP…) non ripetono il
// preventivo: dicono cose che sopra non ci sono. Ma non decidono niente, quindi
// stanno dietro una tendina — erano una striscia di nove chip sempre visibile.
function _outcomeDetails(p) {
  const c = p.counts || {};
  const excluded = Object.values(p.excluded || {}).reduce((sum, values) => sum + (Array.isArray(values) ? values.length : 0), 0);
  const items = [
    _outcomeDetail('fa-network-wired', t('integrations.cInterfaces') + ' ' + (c.interfaces || 0)),
    _outcomeDetail('fa-diagram-project', t('integrations.cPrefixes') + ' ' + (c.prefixes || 0)),
    _outcomeDetail('fa-location-dot', t('integrations.cIps') + ' ' + (c.ips || 0)),
  ];
  if (c.radios) items.push(_outcomeDetail('fa-wifi', t('integrations.cRadios', { n: c.radios, ssids: c.ssids || 0 })));
  items.push(_outcomeDetail('fa-server', t('integrations.cRackFloor', { rack: c.devicesRack || 0, floor: c.devicesFloor || 0 })));
  if (excluded) items.push(_outcomeDetail('fa-filter-circle-xmark', t('integrations.cExcluded', { n: excluded })));
  return `<details class="dcim-outcome-details"><summary><i class="fas fa-chevron-down"></i> ${escapeHTML(t('integrations.previewDetails'))}</summary>
    <div class="dcim-outcome-detail-list">` + items.join('') + '</div></details>';
}

function _renderDecisions(p) {
  const model = buildDecisions(p, _wiz.selection.decisions);
  const o = model.outcome;
  const num = (key, value) => `<span class="dcim-out-n">${escapeHTML(_tp(key, value, { n: value }))}</span>`;
  // Il preventivo: l'unica riga che chi importa legge davvero — e l'unica
  // dichiarazione di numeri della schermata: le card KPI e la striscia di chip
  // che lo ripetevano sopra non ci sono più.
  // Gli stack compaiono solo se ce ne sono: «0 stack» in un import che non ne ha
  // e' rumore, e per giunta suggerisce una perdita che non c'e' stata.
  const totals = [num('dcim.dec.oDevices', o.devices), num('dcim.dec.oCables', o.cables),
    num('dcim.dec.oVlans', o.vlans), num('dcim.dec.oRacks', o.racks)]
    .concat(o.stacks ? [num('dcim.dec.oStacks', o.stacks)] : [])
    .concat(o.vms ? [num('dcim.dec.oVms', o.vms)] : [])
    .join('<i>·</i>');
  const outcome = `<div class="dcim-outcome">
    <div class="dcim-outcome-main"><span class="dcim-out-lead">${escapeHTML(t('dcim.dec.outcome'))}</span> ` + totals + '</div>'
    + _outcomeCosts(o) + _outcomeDetails(p) + '</div>';
  // Le perdite hanno il loro chip nel preventivo, quindi le righe che le
  // spiegano stanno DOPO le scelte: su una perdita non c'è niente da fare, su
  // una scelta sì — prima ciò che aspetta una risposta, poi ciò che si legge.
  const losses = model.info.filter(row => row.severity === 'loss');
  const plain = model.info.filter(row => row.severity !== 'loss');
  let seq = 0;
  const block = (rows, label) => rows.length
    ? `<span class="dcim-dec-label">${escapeHTML(label)}</span>` + rows.map(row => _renderDecisionRow(row, seq++, true)).join('')
    : '';
  // I «tipi da confermare» sono decisioni a tutti gli effetti — e sono le uniche che
  // BLOCCANO la creazione del progetto: vanno per prime fra quelle da prendere.
  const review = _renderReviewRows(p, 0);
  const reviewCount = (_wiz.reconciliationGroups || []).length;
  // Gli abbinamenti dei ruoli IPAM stanno fra le scelte, ma DOPO i tipi da
  // confermare: quelli bloccano la creazione del progetto, questi no — non
  // sceglierli significa lasciare le liste come sono, che è un esito legittimo.
  const vlanRoles = _renderVlanRoleRows(p);
  const vlanRoleCount = (Array.isArray(p.vlanRoles) ? p.vlanRoles : []).length;
  const decisions = (review || vlanRoles || model.decisions.length)
    ? `<span class="dcim-dec-label">${escapeHTML(t('dcim.dec.toDecide'))} · ${reviewCount + vlanRoleCount + model.decisions.length}</span>`
      + review + vlanRoles + model.decisions.map(row => _renderDecisionRow(row, seq++, true)).join('')
    : '';
  const lossBlock = block(losses, t('dcim.dec.losses'));
  const info = block(plain, t('dcim.dec.info'));
  // Coda del pannello: la valvola «importa comunque» e il ricalcolo, che stavano nel
  // vecchio blocco Riconciliazione. Compaiono solo se c'è qualcosa da confermare o
  // l'anteprima è da rifare — un pannello non deve mostrare comandi inerti.
  const foot = (reviewCount || _wiz.previewStale) ? `<div class="dcim-dec-foot">
    <label class="dcim-dec-allow"><input type="checkbox" data-change="dcim-allow-unresolved"${_wiz.selection.allowUnresolved === true ? ' checked' : ''}>
      <span>${escapeHTML(t('integrations.reconcileAllow'))}<small>${escapeHTML(t('integrations.reconcileAllowHint'))}</small></span></label>
    <div class="dcim-dec-foot-actions">
      <button class="um-btn" data-act="dcim-reconcile-preview"><i class="fas fa-rotate"></i> ${escapeHTML(t('integrations.reconcileRebuild'))}</button>
      ${_wiz.previewStale ? `<span class="dcim-dec-pending">${escapeHTML(t('integrations.reconcilePending'))}</span>` : ''}
    </div>
  </div>` : '';
  const truncated = model.truncated
    ? `<div class="dcim-dec-truncated">${escapeHTML(t('dcim.dec.truncated', { n: (p.issues || []).length, total: p.issuesTotal || 0 }))}</div>` : '';
  // Età del dato + rilettura esplicita, in TESTA accanto al titolo: qualifica i
  // numeri del preventivo. Ricalcolare una decisione riusa la lettura già fatta
  // (istantaneo): proprio per questo va detto DA QUANDO è quella lettura,
  // altrimenti un pannello che risponde subito si scambia per «NetBox adesso».
  const fresh = p.fetchedAt ? `<span class="dcim-dec-fresh dcim-dec-fresh-head">
    <span>${escapeHTML(t('dcim.dec.fetchedAt', { time: _clock(p.fetchedAt) }))}</span>
    <button class="um-btn um-btn-ghost" data-act="dcim-reread"><i class="fas fa-cloud-arrow-down"></i> ${escapeHTML(t('dcim.dec.reread'))}</button>
  </span>` : '';
  return `<section class="dcim-decisions" aria-labelledby="dcim-dec-title">
    <h4 id="dcim-dec-title"><i class="fas fa-scale-balanced"></i> ${escapeHTML(t('dcim.dec.heading'))}` + fresh + '</h4>'
    + outcome + decisions + lossBlock + info + truncated + foot + '</section>';
}

function _renderPreviewStep() {
  if (_wiz.loadingPreview) return `<div>${_sp()}</div>`;
  if (_wiz.previewErr) return `<div style="color:var(--danger-color);font-size:.9rem">${escapeHTML(_wiz.previewErr)}</div>`;
  const p = _wiz.preview;
  if (!p) return `<div>${_sp()}</div>`;
  const c = p.counts || {};
  const sm = p.samples || {};
  // Niente più riga di contesto, card KPI, striscia di chip né banner giallo
  // «Richiede attenzione»: ogni numero stava già nel preventivo (o non decideva
  // niente, e ora vive nella tendina «Vedi dettagli» del preventivo), e il
  // banner era un secondo semaforo con un conteggio diverso — contava apparati
  // mentre «Da decidere» conta decisioni, e i due numeri sembravano in
  // contraddizione. La schermata è: preventivo → decisioni → esclusioni → stato.
  const previewWarningHtml = _renderDecisions(p);
  const devs = sm.devices || [];
  const rows = devs.length
    ? `<p style="font-size:.85rem;color:var(--text-muted);margin:0 0 6px">${escapeHTML(t('integrations.excludeHint'))}</p>` + devs.map(d => {
      const checked = !_wiz.selection.exclude.includes(d.key);
      return `<label class="row" style="display:flex;align-items:center;gap:10px;padding:6px 10px;border:0.5px solid var(--border);border-radius:var(--radius);margin-bottom:5px;font-size:13px">
        <input type="checkbox" data-change="dcim-dev-row" data-key="${escapeHTML(d.key)}"${checked ? ' checked' : ''}>
        <span style="flex:1">${escapeHTML(d.name)}${d.model ? ` <span style="color:var(--text-muted)">· ${escapeHTML(d.model)}</span>` : ''}</span></label>`;
    }).join('')
    : `<p style="color:var(--text-muted);font-size:.9rem">${escapeHTML(t('integrations.previewEmpty'))}</p>`;
  const nameVal = _wiz.projectName || p.proposedProjectName || '';
  const reconciliationBlocked = p.reconciliation && !_wiz.selection.allowUnresolved && (
    p.reconciliation.required > 0 || (Array.isArray(p.reconciliation.invalid) && p.reconciliation.invalid.length > 0)
  );
  const blocked = _wiz.previewStale || reconciliationBlocked;
  const previewStatus = blocked ? `<div class="dcim-preview-status is-blocked"><i class="fas fa-circle-info"></i> ${escapeHTML(_wiz.previewStale ? t('integrations.previewNeedsRebuild') : t('integrations.reconcileBlocked'))}</div>` : c.devices ? `<div class="dcim-preview-status is-ready"><i class="fas fa-circle-check"></i> ${escapeHTML(t('integrations.previewReady'))}</div>` : `<div class="dcim-preview-status"><i class="fas fa-circle-info"></i> ${escapeHTML(t('integrations.noDevicesSelected'))}</div>`;
  // Campo nome nello stile nativo InfraNet (.prop-group: etichetta sopra, controllo
  // a tutta larghezza col bordo/sfondo del tema), bottone «Crea progetto» su riga a sé.
  const commit = `<div class="prop-group" style="margin-top:14px">
      <label>${escapeHTML(t('integrations.projectName'))}</label>
      <input type="text" id="dcim-name" data-input="dcim-name" value="${escapeHTML(nameVal)}" autocomplete="off">
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px">
      ${_compareButton()}
      <button class="um-btn primary" data-act="dcim-commit"${c.devices && !blocked ? '' : ' disabled'} title="${blocked ? escapeHTML(t('integrations.reconcileBlocked')) : ''}"><i class="fas fa-plus"></i> ${escapeHTML(t('integrations.createProject'))}</button>
    </div>`;
  return previewWarningHtml + rows + previewStatus + commit;
}

// Confronto col progetto APERTO. Non tocca il documento: la rotta legge il
// progetto da disco e restituisce differenze. `refresh` è l'unico modo di pagare
// una lettura nuova di NetBox — altrimenti riusa quella dell'anteprima.
async function _runCompare(refresh) {
  const projectId = store.currentProjectId;
  if (projectId == null) return;
  _wiz.compare = { state: 'running', result: null, error: '' };
  _renderImport();
  try {
    const body = { projectId, selection: _selectionForRequest() };
    if (refresh) body.refresh = true;
    const r = await fetch(API + '/compare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
    _wiz.compare = { state: 'done', result: j, error: '' };
  } catch (e) {
    _wiz.compare = { state: 'error', result: null, error: String((e && e.message) || e) };
  }
  _renderImport();
}

async function _loadScopes() {
  _wiz.loadingScopes = true; _wiz.scopeErr = ''; _renderImport();
  try {
    const r = await fetch(API + '/import/scopes', { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    _wiz.scopes = await r.json();
  } catch (_) { _wiz.scopeErr = t('integrations.notConfigured'); }
  _wiz.loadingScopes = false; _renderImport();
}

// `refresh` = rileggi da NetBox anche se il server ha già il bundle in memoria.
// Senza, ricalcolare una decisione costa millisecondi invece di un pull intero:
// è ciò che rende praticabile il «prova l'altra opzione e guarda cosa cambia».
async function _runPreview(refresh) {
  _wiz.loadingPreview = true; _wiz.previewErr = ''; _wiz.preview = null; _renderImport();
  try {
    const body = { selection: _selectionForRequest() };
    if (refresh) body.refresh = true;
    const r = await fetch(API + '/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
    _wiz.preview = j;
    _wiz.previewStale = false;
    if (!_wiz.projectName) _wiz.projectName = j.proposedProjectName || '';
  } catch (e) { _wiz.previewErr = String((e && e.message) || e); }
  _wiz.loadingPreview = false; _renderImport();
}

async function _commit() {
  if (_wiz.commit.state === 'running') return;
  const name = _wiz.projectName || (_wiz.preview && _wiz.preview.proposedProjectName) || '';
  _wiz.commit = { state: 'running', stage: 0, result: null, error: '', name };
  _renderImport();
  _scheduleCommitProgress();
  try {
    const r = await fetch(API + '/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commit: true, selection: _selectionForRequest(), projectName: name }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409 && j.reconciliation) {
      _stopCommitProgressTimer();
      _wiz.commit = { state: 'idle', stage: 0, result: null, error: '', name };
      await _runPreview();
      return;
    }
    if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
    _wiz.commit.stage = _commitStages.length;
    _wiz.commit.state = 'done';
    _wiz.commit.result = j;
    _stopCommitProgressTimer();
    _renderImport();
  } catch (e) {
    _stopCommitProgressTimer();
    _wiz.commit.state = 'error';
    _wiz.commit.error = String((e && e.message) || e || t('integrations.importFail'));
    _renderImport();
  }
}

registerClickActions({
  'dcim-open': () => { openDcimSync(); closeImpExpMenu(); },
  'dcim-close': () => closeDcimSync(),
  'dcim-backdrop': (el, ev) => { if (ev.target === el && _pressOnBackdrop) closeDcimSync(); },
  'dcim-test': () => _test(),
  'dcim-catalog-check': () => _catalogAction('check'),
  'dcim-catalog-diff': () => _showCatalogDiff(),
  'dcim-catalog-update': () => _catalogAction('update'),
  'dcim-save': () => { if (_wiz.commit.state !== 'running') _save(); },
  'dcim-tab': (el) => { if (_wiz.commit.state !== 'running') _showTab(el.dataset.tab); },
  'dcim-wiz-next': () => { if (_wiz.commit.state === 'idle' && _wiz.step < 3 && (_wiz.step !== 1 || _wiz.scopeMode !== 'custom' || _scopeSelectionCount() > 0)) { _wiz.step++; if (_wiz.step === 3) _runPreview(); else _renderImport(); } },
  'dcim-wiz-back': () => { if (_wiz.commit.state === 'idle' && _wiz.step > 1) { _wiz.step--; _renderImport(); } },
  'dcim-load-scopes': () => _loadScopes(),
  'dcim-scope-all': () => {
    _wiz.scopeMode = 'all'; _wiz.scopeSearch = '';
    _wiz.selection.scope = { siteIds: [], roleSlugs: [], tags: [] };
    _wiz.previewStale = true; _renderImport();
  },
  'dcim-scope-custom': () => { _wiz.scopeMode = 'custom'; _wiz.scopeKind = 'site'; _wiz.scopeSearch = ''; _renderImport(); },
  'dcim-scope-kind': (el) => { _wiz.scopeKind = el.dataset.kind || 'site'; _wiz.scopeSearch = ''; _renderImport(); },
  'dcim-scope-select-all': () => {
    for (const item of _scopeItems(_wiz.scopeKind).filter(_scopeItemMatches)) {
      const id = _wiz.scopeKind === 'site' ? item.id : item.slug;
      _toggleScope(_wiz.scopeKind, id, true);
    }
    _wiz.previewStale = true; _renderImport();
  },
  'dcim-scope-clear': () => {
    for (const item of _scopeItems(_wiz.scopeKind)) {
      const id = _wiz.scopeKind === 'site' ? item.id : item.slug;
      _toggleScope(_wiz.scopeKind, id, false);
    }
    _wiz.previewStale = true; _renderImport();
  },
  // Chip del preventivo → la sua riga: il numero in testa è cliccabile e porta
  // alla spiegazione, aprendo la fisarmonica se la riga è ripiegata.
  'dcim-dec-goto': (el) => {
    const row = document.getElementById('dcim-dec-row-' + (el.dataset.code || ''));
    if (!row) return;
    if (row.tagName === 'DETAILS') row.open = true;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },
  'dcim-reconcile-preview': () => _runPreview(),          // ricalcola sulla lettura in memoria
  'dcim-reread': () => _runPreview(true),                  // rilegge davvero da NetBox
  'dcim-compare': () => _runCompare(),
  'dcim-compare-reread': () => _runCompare(true),
  'dcim-compare-back': () => { _wiz.compare = { state: 'idle', result: null, error: '' }; _renderImport(); },
  'dcim-commit': () => _commit(),
  'dcim-commit-retry': () => { _resetCommitState(); _renderImport(); },
  'dcim-open-created': () => { const id = _wiz.commit.result && _wiz.commit.result.projectId; if (id != null) { switchProject(id); closeDcimSync(); } },
});
registerChangeActions({
  'dcim-scope': (el) => { _wiz.scopeMode = 'custom'; _toggleScope(el.dataset.kind, el.dataset.id, el.checked); _wiz.previewStale = true; _renderImport(); },
  'dcim-ent': (el) => { _wiz.selection.entities[el.dataset.key] = el.checked; _wiz.previewStale = true; _renderImport(); },
  'dcim-dev-row': (el) => {
    const key = el.dataset.key, ex = _wiz.selection.exclude, i = ex.indexOf(key);
    if (!el.checked && i < 0) ex.push(key);
    if (el.checked && i >= 0) ex.splice(i, 1);
    _wiz.previewStale = true;
    _renderImport();
  },
  // La scelta cambia l'ESITO dell'import, quindi l'anteprima va rifatta: si marca
  // stale come per ogni altra modifica alla selezione, non si finge un aggiornamento.
  'dcim-decision': (el) => {
    const code = el.dataset.code, option = el.dataset.option;
    if (!code || !option) return;
    _wiz.selection.decisions[code] = option;
    _wiz.previewStale = true;
    _renderImport();
  },
  'dcim-map-type': (el) => {
    const group = _wiz.reconciliationGroups[Number(el.dataset.group)];
    if (!group) return;
    for (const id of group.ids) _wiz.selection.mapping[String(id)] = Object.assign({}, _wiz.selection.mapping[String(id)] || {}, { type: el.value });
    _wiz.previewStale = true;
    _renderImport();
  },
  'dcim-map-placement': (el) => {
    const group = _wiz.reconciliationGroups[Number(el.dataset.group)];
    if (!group) return;
    for (const id of group.ids) _wiz.selection.mapping[String(id)] = Object.assign({}, _wiz.selection.mapping[String(id)] || {}, { placement: el.value });
    _wiz.previewStale = true;
    _renderImport();
  },
  // L'abbinamento cambia l'esito (le liste di VLAN del progetto), quindi l'anteprima
  // va rifatta come per ogni altra scelta. Valore vuoto = si toglie la chiave, non
  // si scrive una stringa vuota che poi il motore dovrebbe interpretare.
  'dcim-vlan-role': (el) => {
    const slug = el.dataset.slug;
    if (!slug) return;
    const map = _wiz.selection.vlanRoleMap || (_wiz.selection.vlanRoleMap = {});
    if (el.value) map[slug] = el.value; else delete map[slug];
    _wiz.previewStale = true;
    _renderImport();
  },
  'dcim-allow-unresolved': (el) => { _wiz.selection.allowUnresolved = !!el.checked; _renderImport(); },
});
registerInputActions({
  'dcim-name': (el) => { _wiz.projectName = el.value; },
  'dcim-scope-search': (el) => {
    _wiz.scopeSearch = el.value;
    const query = String(el.value || '').trim().toLowerCase();
    const rows = [...document.querySelectorAll('#dcim-scope-list [data-scope-option]')];
    let visible = 0;
    for (const row of rows) {
      const match = !query || String(row.dataset.search || '').toLowerCase().includes(query);
      row.hidden = !match;
      if (match) visible++;
    }
    const empty = document.querySelector('#dcim-scope-list .dcim-scope-empty');
    if (empty) empty.hidden = visible > 0;
  },
  // Modifica di URL/token → l'esito precedente non vale più: bottone e chip neutri.
  'dcim-cfg': () => { _setTestBtn(''); _setStatus(t('integrations.notConnected'), ''); },
});
