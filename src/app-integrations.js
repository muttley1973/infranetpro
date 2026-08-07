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
import { closeImpExpMenu } from './app-auth.js';
import { showAlert, switchProject } from './app-core.js';
import { registerClickActions, registerChangeActions, registerInputActions } from './app-delegation.js';

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
    : kind === 'err' ? 'var(--danger-color)'
      : 'var(--text-muted)';
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
    _setStatus(t('integrations.notConnected'), '');
  } catch (_) { /* rete assente → campi come sono */ }
}

/** Apre il pannello Sincronizzazione, carica la config e prepara il wizard import. */
export function openDcimSync() {
  const ov = _el('dcim-overlay');
  if (!ov) return;
  ov.classList.add('open');
  _loadConfig();
  _wiz.step = 1; _wiz.preview = null; _wiz.previewErr = ''; _wiz.projectName = '';
  _showTab('import');
}
function closeDcimSync() {
  const ov = _el('dcim-overlay');
  if (ov) ov.classList.remove('open');
}

// Prova connessione: usa url+token dei campi (pre-salvataggio); se il token è
// vuoto ma già impostato, il server ricade su quello salvato. Errore SENZA token.
async function _test() {
  const url = _val('dcim-url');
  const token = (_el('dcim-token') ? _el('dcim-token').value : '');   // NON trim: il token può avere spazi? no, ma non lo tocchiamo
  const verifyTls = _checked('dcim-verifytls');
  if (!url) { _setStatus(t('integrations.needUrl'), 'err'); return; }
  _setStatus(t('integrations.testing'), '');
  const body = { url, verifyTls };
  if (token) body.token = token;
  try {
    const r = await fetch(API + '/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (j && j.ok) {
      _setStatus(t('integrations.connected') + (j.version ? ' · NetBox v' + j.version : ''), 'ok');
    } else {
      _setStatus(t('integrations.testFail') + (j && j.error ? ' — ' + j.error : ''), 'err');
    }
  } catch (_) { _setStatus(t('integrations.testFail'), 'err'); }
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
  selection: {
    entities: { devices: true, cabling: true, ipam: true, racks: true },
    scope: { siteIds: [], roleSlugs: [], tags: [] },
    exclude: [],
  },
  preview: null, loadingPreview: false, previewErr: '',
  projectName: '',
};

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

function _renderImport() {
  const b = _el('dcim-import-body');
  if (!b) return;
  const s = _wiz.step;
  const dot = (n, key) => `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:${n <= s ? 'var(--text-primary)' : 'var(--text-muted)'}">
    <span style="width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:0.5px solid var(--border-strong);${n <= s ? 'background:var(--text-accent);color:var(--surface-2)' : ''}">${n}</span>${escapeHTML(t(key))}</div>`;
  const stepper = `<div style="display:flex;align-items:center;gap:12px;margin:12px 0 14px">
    ${dot(1, 'integrations.wizStep1')}<div style="flex:1;height:0.5px;background:var(--border)"></div>
    ${dot(2, 'integrations.wizStep2')}<div style="flex:1;height:0.5px;background:var(--border)"></div>
    ${dot(3, 'integrations.wizStep3')}</div>`;
  const body = s === 1 ? _renderScopeStep() : s === 2 ? _renderEntityStep() : _renderPreviewStep();
  const nav = `<div style="display:flex;justify-content:space-between;margin-top:14px">
    <button class="um-btn" data-act="dcim-wiz-back"${s === 1 ? ' style="visibility:hidden"' : ''}><i class="fas fa-arrow-left"></i> ${escapeHTML(t('integrations.back'))}</button>
    ${s < 3 ? `<button class="um-btn primary" data-act="dcim-wiz-next">${escapeHTML(t('integrations.next'))} <i class="fas fa-arrow-right"></i></button>` : '<span></span>'}</div>`;
  b.innerHTML = stepper + body + nav;
}

function _renderScopeStep() {
  if (_wiz.loadingScopes) return `<div>${_sp()}</div>`;
  if (_wiz.scopeErr) return `<div style="color:var(--danger-color);font-size:.9rem">${escapeHTML(_wiz.scopeErr)}
    <button class="um-btn" data-act="dcim-load-scopes" style="margin-left:8px">${escapeHTML(t('integrations.retry'))}</button></div>`;
  const sc = _wiz.scopes || { sites: [], roles: [], tags: [] };
  const row = (kind, id, label, count) => `<label class="row" style="display:flex;align-items:center;gap:10px;padding:7px 10px;border:0.5px solid var(--border);border-radius:var(--radius);margin-bottom:6px;font-size:13px">
    <input type="checkbox" data-change="dcim-scope" data-kind="${kind}" data-id="${escapeHTML(String(id))}"${_scopeChecked(kind, id) ? ' checked' : ''}>
    <span style="flex:1">${escapeHTML(label)}</span>${count != null ? `<span style="font-size:11px;color:var(--text-muted)">${escapeHTML(String(count))}</span>` : ''}</label>`;
  const sec = (title, items) => items.length ? `<div style="margin-bottom:10px"><div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">${escapeHTML(title)}</div>${items.join('')}</div>` : '';
  return `<p style="font-size:.85rem;color:var(--text-muted);margin:0 0 10px">${escapeHTML(t('integrations.scopeHint'))}</p>`
    + sec(t('integrations.sites'), sc.sites.map(x => row('site', x.id, x.name, t('integrations.devicesN', { n: x.deviceCount || 0 }))))
    + sec(t('integrations.roles'), sc.roles.map(x => row('role', x.slug, x.name, x.count || 0)))
    + sec(t('integrations.tags'), sc.tags.map(x => row('tag', x.slug, x.name, x.count || 0)));
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

function _renderPreviewStep() {
  if (_wiz.loadingPreview) return `<div>${_sp()}</div>`;
  if (_wiz.previewErr) return `<div style="color:var(--danger-color);font-size:.9rem">${escapeHTML(_wiz.previewErr)}</div>`;
  const p = _wiz.preview;
  if (!p) return `<div>${_sp()}</div>`;
  const c = p.counts || {};
  const mc = (v, l) => `<div style="background:var(--surface-2);border-radius:var(--radius);padding:8px 10px;text-align:center">
    <div style="font-size:20px;font-weight:500">${v || 0}</div><div style="font-size:11px;color:var(--text-secondary)">${escapeHTML(l)}</div></div>`;
  const cards = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
    ${mc(c.devices, t('integrations.cDevices'))}${mc(c.interfaces, t('integrations.cInterfaces'))}${mc(c.cables, t('integrations.cCables'))}${mc(c.vlans, t('integrations.cVlans'))}</div>`;
  const sm = p.samples || {};
  const warns = [];
  if (sm.unmappedRoles && sm.unmappedRoles.length) warns.push(t('integrations.warnRoles', { n: sm.unmappedRoles.length }));
  if (sm.unmatchedDeviceTypes && sm.unmatchedDeviceTypes.length) warns.push(t('integrations.warnDt', { n: sm.unmatchedDeviceTypes.length }));
  const warnHtml = warns.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${warns.map(w =>
    `<span style="font-size:11px;padding:2px 8px;border-radius:var(--radius);background:var(--bg-warning,rgba(227,179,65,.15));color:var(--warning-color,#e3b341)"><i class="fas fa-triangle-exclamation"></i> ${escapeHTML(w)}</span>`).join('')}</div>` : '';
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
  const commit = `<div style="display:flex;gap:10px;align-items:end;margin-top:12px">
    <div style="flex:1"><label style="font-size:12px;color:var(--text-secondary)">${escapeHTML(t('integrations.projectName'))}</label>
    <input type="text" id="dcim-name" data-input="dcim-name" value="${escapeHTML(nameVal)}" style="width:100%"></div>
    <button class="um-btn primary" data-act="dcim-commit"${c.devices ? '' : ' disabled'}><i class="fas fa-plus"></i> ${escapeHTML(t('integrations.createProject'))}</button></div>`;
  return cards + warnHtml + rows + commit;
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

async function _runPreview() {
  _wiz.loadingPreview = true; _wiz.previewErr = ''; _wiz.preview = null; _renderImport();
  try {
    const r = await fetch(API + '/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selection: _wiz.selection }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
    _wiz.preview = j;
    if (!_wiz.projectName) _wiz.projectName = j.proposedProjectName || '';
  } catch (e) { _wiz.previewErr = String((e && e.message) || e); }
  _wiz.loadingPreview = false; _renderImport();
}

async function _commit() {
  const name = _wiz.projectName || (_wiz.preview && _wiz.preview.proposedProjectName) || '';
  try {
    const r = await fetch(API + '/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commit: true, selection: _wiz.selection, projectName: name }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { showAlert(t('integrations.importFail') + (j.error ? ' — ' + j.error : '')); return; }
    closeDcimSync();
    showAlert(t('integrations.created', { name: name || ('#' + j.projectId) }));
    if (j.projectId != null) switchProject(j.projectId);
  } catch (_) { showAlert(t('integrations.importFail')); }
}

registerClickActions({
  'dcim-open': () => { openDcimSync(); closeImpExpMenu(); },
  'dcim-close': () => closeDcimSync(),
  'dcim-backdrop': (el, ev) => { if (ev.target === el) closeDcimSync(); },
  'dcim-test': () => _test(),
  'dcim-save': () => _save(),
  'dcim-tab': (el) => _showTab(el.dataset.tab),
  'dcim-wiz-next': () => { if (_wiz.step < 3) { _wiz.step++; if (_wiz.step === 3) _runPreview(); else _renderImport(); } },
  'dcim-wiz-back': () => { if (_wiz.step > 1) { _wiz.step--; _renderImport(); } },
  'dcim-load-scopes': () => _loadScopes(),
  'dcim-commit': () => _commit(),
});
registerChangeActions({
  'dcim-scope': (el) => _toggleScope(el.dataset.kind, el.dataset.id, el.checked),
  'dcim-ent': (el) => { _wiz.selection.entities[el.dataset.key] = el.checked; },
  'dcim-dev-row': (el) => {
    const key = el.dataset.key, ex = _wiz.selection.exclude, i = ex.indexOf(key);
    if (!el.checked && i < 0) ex.push(key);
    if (el.checked && i >= 0) ex.splice(i, 1);
  },
});
registerInputActions({
  'dcim-name': (el) => { _wiz.projectName = el.value; },
});
