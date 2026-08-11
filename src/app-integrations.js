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
    exclude: [], mapping: {}, decisions: {}, allowUnresolved: false,
  };
  _wiz.previewStale = false; _wiz.reconciliationGroups = [];
  _wiz.scopeMode = 'all'; _wiz.scopeKind = 'site'; _wiz.scopeSearch = '';
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
    allowUnresolved: false,
  },
  preview: null, previewStale: false, reconciliationGroups: [], loadingPreview: false, previewErr: '',
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
  if (scope.siteIds.length) parts.push(_scopeIsComplete('site') ? t('integrations.scopeAllSites') : t('integrations.scopeSitesSelected', { n: scope.siteIds.length }));
  if (scope.roleSlugs.length) parts.push(_scopeIsComplete('role') ? t('integrations.scopeAllRoles') : t('integrations.scopeRolesSelected', { n: scope.roleSlugs.length }));
  if (scope.tags.length) parts.push(_scopeIsComplete('tag') ? t('integrations.scopeAllTags') : t('integrations.scopeTagsSelected', { n: scope.tags.length }));
  const devices = _scopeItems('site').filter(site => scope.siteIds.includes(+site.id)).reduce((sum, site) => sum + Number(site.deviceCount || 0), 0);
  if (devices) parts.push(t('integrations.scopeDevicesSelected', { n: devices }));
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
        <button class="dcim-scope-choice is-primary" data-act="dcim-scope-all">
          <span class="dcim-scope-choice-icon"><i class="fas fa-globe"></i></span>
          <span class="dcim-scope-choice-copy"><strong>${escapeHTML(t('integrations.scopeAll'))}</strong><small>${escapeHTML(t('integrations.scopeAllDesc', { devices: totalDevices, sites: sc.sites.length }))}</small></span>
          <i class="fas fa-arrow-right dcim-scope-choice-arrow"></i>
        </button>
        <button class="dcim-scope-choice" data-act="dcim-scope-custom">
          <span class="dcim-scope-choice-icon"><i class="fas fa-sliders"></i></span>
          <span class="dcim-scope-choice-copy"><strong>${escapeHTML(t('integrations.scopeCustom'))}</strong><small>${escapeHTML(t('integrations.scopeCustomDesc'))}</small></span>
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
        <div class="dcim-dec-title">${escapeHTML(_tp('dcim.dec.review.title', group.count, { n: group.count }))}</div>
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

function _renderDecisionRow(row, index) {
  const isLoss = row.severity === 'loss';
  const options = (row.options || []).map(opt => {
    const on = row.chosen === opt.id;
    return `<label class="dcim-dec-opt${on ? ' is-on' : ''}">
      <input type="radio" name="dcim-dec-${index}" data-change="dcim-decision" data-code="${escapeHTML(row.code)}" data-option="${escapeHTML(opt.id)}"${on ? ' checked' : ''}>
      <span><span class="dcim-dec-opt-lab">${escapeHTML(_decisionText(row, opt.id))}</span>
      <span class="dcim-dec-opt-eff">${escapeHTML(_decisionText(row, opt.id + 'Eff'))}</span></span>
      ${opt.isDefault ? `<span class="dcim-dec-def">${escapeHTML(t('dcim.dec.default'))}</span>` : ''}
    </label>`;
  }).join('');
  return `<article class="dcim-dec is-${escapeHTML(row.severity)}">
    <div class="dcim-dec-stripe"></div>
    <div class="dcim-dec-body">
      <div class="dcim-dec-title">${escapeHTML(_decisionText(row, 'title'))}${isLoss ? `<span class="dcim-dec-loss">${escapeHTML(t('dcim.dec.lossTag'))}</span>` : ''}</div>
      <div class="dcim-dec-why">${escapeHTML(_decisionWhy(row))}</div>
      ${options ? `<div class="dcim-dec-opts">${options}</div>` : ''}
      ${_decisionDevices(row, index)}
    </div>
  </article>`;
}

function _renderDecisions(p) {
  const model = buildDecisions(p, _wiz.selection.decisions);
  const o = model.outcome;
  const num = (key, value) => `<span class="dcim-out-n">${escapeHTML(_tp(key, value, { n: value }))}</span>`;
  // Il preventivo: l'unica riga che chi importa legge davvero.
  // Gli stack compaiono solo se ce ne sono: «0 stack» in un import che non ne ha
  // e' rumore, e per giunta suggerisce una perdita che non c'e' stata.
  const totals = [num('dcim.dec.oDevices', o.devices), num('dcim.dec.oCables', o.cables),
    num('dcim.dec.oVlans', o.vlans), num('dcim.dec.oRacks', o.racks)]
    .concat(o.stacks ? [num('dcim.dec.oStacks', o.stacks)] : [])
    .join('<i>·</i>');
  const costs = o.costs.map(cost => {
    const key = 'dcim.cost.' + cost.code + (cost.chosen ? '.' + cost.chosen : '');
    const label = _tp(key, cost.n, { n: cost.n });
    if (label === key) return '';   // nessuna etichetta breve = niente chip inventato
    return `<span class="dcim-cost is-${escapeHTML(cost.severity)}">${escapeHTML(label)}</span>`;
  }).filter(Boolean).join('');
  const outcome = `<div class="dcim-outcome">
    <div class="dcim-outcome-main"><span class="dcim-out-lead">${escapeHTML(t('dcim.dec.outcome'))}</span> ${totals}</div>
    ${costs ? `<div class="dcim-outcome-costs"><span>${escapeHTML(t('dcim.dec.costs'))}</span>${costs}</div>`
      : `<div class="dcim-outcome-costs is-clean"><i class="fas fa-circle-check"></i> ${escapeHTML(t('dcim.dec.clean'))}</div>`}
  </div>`;
  // Una PERDITA non ha alternative, ma non per questo è un dettaglio: sta in testa,
  // non sotto «non richiede scelte». Chi importa deve sapere subito cosa non entra.
  const losses = model.info.filter(row => row.severity === 'loss');
  const plain = model.info.filter(row => row.severity !== 'loss');
  let seq = 0;
  const block = (rows, label) => rows.length
    ? `<span class="dcim-dec-label">${escapeHTML(label)}</span>` + rows.map(row => _renderDecisionRow(row, seq++)).join('')
    : '';
  // I «tipi da confermare» sono decisioni a tutti gli effetti — e sono le uniche che
  // BLOCCANO la creazione del progetto: vanno per prime fra quelle da prendere.
  const review = _renderReviewRows(p, 0);
  const reviewCount = (_wiz.reconciliationGroups || []).length;
  const decisions = block(losses, t('dcim.dec.losses'))
    + ((review || model.decisions.length)
      ? `<span class="dcim-dec-label">${escapeHTML(t('dcim.dec.toDecide'))} · ${reviewCount + model.decisions.length}</span>`
        + review + model.decisions.map(row => _renderDecisionRow(row, seq++)).join('')
      : '');
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
  // Età del dato + rilettura esplicita. Ricalcolare una decisione riusa la lettura
  // già fatta (istantaneo): proprio per questo va detto DA QUANDO è quella lettura,
  // altrimenti un pannello che risponde subito si scambia per «NetBox adesso».
  const fresh = p.fetchedAt ? `<div class="dcim-dec-fresh">
    <span>${escapeHTML(t('dcim.dec.fetchedAt', { time: _clock(p.fetchedAt) }))}</span>
    <button class="um-btn um-btn-ghost" data-act="dcim-reread"><i class="fas fa-cloud-arrow-down"></i> ${escapeHTML(t('dcim.dec.reread'))}</button>
  </div>` : '';
  return `<section class="dcim-decisions" aria-labelledby="dcim-dec-title">
    <h4 id="dcim-dec-title"><i class="fas fa-scale-balanced"></i> ${escapeHTML(t('dcim.dec.heading'))}</h4>
    ${outcome}${decisions}${info}${truncated}${foot}${fresh}
  </section>`;
}

function _renderPreviewStep() {
  if (_wiz.loadingPreview) return `<div>${_sp()}</div>`;
  if (_wiz.previewErr) return `<div style="color:var(--danger-color);font-size:.9rem">${escapeHTML(_wiz.previewErr)}</div>`;
  const p = _wiz.preview;
  if (!p) return `<div>${_sp()}</div>`;
  const c = p.counts || {};
  const sm = p.samples || {};
  const review = (p.catalogMatches && p.catalogMatches.details || []).filter(x => x.reviewRequired).slice(0, 20);
  const reviewHtml = review.length ? `<details style="margin-bottom:10px"><summary style="cursor:pointer;font-size:12px;color:var(--warning-color,#e3b341)"><i class="fas fa-list-check"></i> ${escapeHTML(t('integrations.reviewMatches', { n: review.length }))}</summary>
    <div style="margin-top:7px;max-height:150px;overflow:auto">${review.map(x => `<div style="padding:4px 0;border-bottom:0.5px solid var(--border)"><strong>${escapeHTML(x.name || ('#' + x.deviceId))}</strong> <span style="color:var(--text-muted)">· ${escapeHTML(x.strategy || 'unmatched')}${x.sourceSlug ? ' · ' + escapeHTML(x.sourceSlug) : ''}</span></div>`).join('')}</div></details>` : '';
  const previewExcluded = Object.values(p.excluded || {}).reduce((sum, values) => sum + (Array.isArray(values) ? values.length : 0), 0);
  const previewMatched = (p.catalogMatches && p.catalogMatches.matched) || 0;
  const previewUnmatched = (p.catalogMatches && p.catalogMatches.unmatched) || 0;
  const previewReviewDetails = (p.catalogMatches && p.catalogMatches.details || []).filter(x => x && x.reviewRequired);
  const previewReconciliation = p.reconciliation || {};
  const previewReviewCount = Number.isFinite(Number(previewReconciliation.required)) ? Number(previewReconciliation.required) : previewReviewDetails.length;
  const previewKpi = (value, label, icon) => `<div class="dcim-preview-kpi"><i class="fas ${icon}"></i><strong>${escapeHTML(String(value || 0))}</strong><span>${escapeHTML(label)}</span></div>`;
  const previewContext = `<div class="dcim-preview-context"><strong>${escapeHTML(p.proposedProjectName || t('integrations.previewTitle'))}</strong><span>${escapeHTML(t('integrations.previewContext', { devices: c.devices || 0, rack: c.devicesRack || 0, floor: c.devicesFloor || 0 }))}</span></div>`;
  const previewKpis = `<div class="dcim-preview-kpis">
    ${previewKpi(c.devices, t('integrations.cDevices'), 'fa-server')}
    ${previewKpi(c.directLinks, t('integrations.previewDirect'), 'fa-link')}
    ${previewKpi(c.passThroughLinks, t('integrations.previewPassThrough'), 'fa-route')}
    ${previewKpi(previewMatched, t('integrations.previewMatched'), 'fa-check')}
  </div>`;
  const previewSecondary = `<div class="dcim-preview-secondary" aria-label="${escapeHTML(t('integrations.previewDetails'))}">
    <span><i class="fas fa-network-wired"></i> ${escapeHTML(t('integrations.cInterfaces'))} ${c.interfaces || 0}</span>
    <span><i class="fas fa-plug"></i> ${escapeHTML(t('integrations.cCables'))} ${c.cables || 0}</span>
    <span><i class="fas fa-layer-group"></i> ${escapeHTML(t('integrations.cVlans'))} ${c.vlans || 0}</span>
    <span><i class="fas fa-diagram-project"></i> ${escapeHTML(t('integrations.cPrefixes'))} ${c.prefixes || 0}</span>
    <span><i class="fas fa-location-dot"></i> ${escapeHTML(t('integrations.cIps'))} ${c.ips || 0}</span>
    <span><i class="fas fa-server"></i> ${escapeHTML(t('integrations.cRackFloor', { rack: c.devicesRack || 0, floor: c.devicesFloor || 0 }))}</span>
    <span><i class="fas fa-question"></i> ${escapeHTML(t('integrations.cToReview', { n: previewUnmatched }))}</span>
    <span><i class="fas fa-filter-circle-xmark"></i> ${escapeHTML(t('integrations.cExcluded', { n: previewExcluded }))}</span>
  </div>`;
  const previewAttention = previewReviewCount > 0 ? `<section class="dcim-preview-attention" aria-labelledby="dcim-preview-attention-title">
    <div class="dcim-preview-attention-main"><i class="fas fa-triangle-exclamation"></i><div><strong id="dcim-preview-attention-title">${escapeHTML(t('integrations.previewAttention'))}</strong><span>${escapeHTML(t('integrations.reconcileCases', { n: previewReviewCount }))}</span></div></div>
    <button class="um-btn" data-act="dcim-reconcile-focus"><i class="fas fa-list-check"></i> ${escapeHTML(t('integrations.previewResolve'))}</button>
  </section>` : '';
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
  const blockHint = blocked ? `<div style="margin-top:10px;padding:7px 9px;border-radius:var(--radius);background:var(--bg-warning,rgba(227,179,65,.1));color:var(--warning-color,#e3b341);font-size:12px"><i class="fas fa-circle-info"></i> ${escapeHTML(_wiz.previewStale ? t('integrations.previewNeedsRebuild') : t('integrations.reconcileBlocked'))}</div>` : (!c.devices ? `<div style="margin-top:10px;color:var(--text-muted);font-size:12px"><i class="fas fa-circle-info"></i> ${escapeHTML(t('integrations.noDevicesSelected'))}</div>` : '');
  // Campo nome nello stile nativo InfraNet (.prop-group: etichetta sopra, controllo
  // a tutta larghezza col bordo/sfondo del tema), bottone «Crea progetto» su riga a sé.
  const commit = `<div class="prop-group" style="margin-top:14px">
      <label>${escapeHTML(t('integrations.projectName'))}</label>
      <input type="text" id="dcim-name" data-input="dcim-name" value="${escapeHTML(nameVal)}" autocomplete="off">
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:10px">
      <button class="um-btn primary" data-act="dcim-commit"${c.devices && !blocked ? '' : ' disabled'} title="${blocked ? escapeHTML(t('integrations.reconcileBlocked')) : ''}"><i class="fas fa-plus"></i> ${escapeHTML(t('integrations.createProject'))}</button>
    </div>`;
  return previewContext + previewKpis + previewSecondary + previewAttention + previewWarningHtml + rows + previewStatus + commit;
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
  'dcim-reconcile-focus': () => {
    const panel = document.querySelector('#dcim-import-body .dcim-decisions');
    if (!panel) return;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.setAttribute('tabindex', '-1');
    panel.focus({ preventScroll: true });
  },
  'dcim-reconcile-preview': () => _runPreview(),          // ricalcola sulla lettura in memoria
  'dcim-reread': () => _runPreview(true),                  // rilegge davvero da NetBox
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
