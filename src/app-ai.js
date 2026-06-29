// ============================================================
// ASSISTENTE AI (advisory) — glue della 3ª tab del pannello destro   [modulo ESM]
// ============================================================
// SCHELETRO (pre-L0). Per ora apre/attiva soltanto la tab «Assistente» del
// pannello destro e la scheda AI dell'overlay «Utenti e accessi». L'empty-state
// è HTML STATICO in netmapper.html (#ai-panel): bilingue via data-i18n, ruolo
// via .admin-only/.viewer-ok (lo gestisce _applyRoleUI in app-auth) → qui nessun
// render. I prossimi strati aggiungeranno la logica:
//   L0 provider+config (server/ai/*, server/routes/ai.js) · L1 Q&A+grounding ·
//   L2 trova-buchi/suggerisci · L3 bozza Ansible · L4 «Spiega» inline sul Drift.
// Vedi _local/notes/AI_ASSISTANT_SPEC_2026-06-29.md.
//
// Igiene ponte (ratchet 1804, può solo scendere): NESSUN nuovo win.*. Le funzioni
// glue legacy (toggleRackPanel, openUserManager, umSwitchTab) e la var
// _rackCollapsed si chiamano come GLOBALI BARE con guardia typeof — stesso idioma
// degli shortcut R/P in app.js. switchRightTab arriva via import ESM dal nucleo.
import { expose, t, getLang } from './_bridge.js';
import { store } from './store.js';
import { switchRightTab } from './app.js';

// Apre la tab «Assistente» (pulsante toolbar + shortcut «A»). Se il pannello
// destro è collassato lo ri-espande PRIMA dello switch, altrimenti l'utente non
// vedrebbe alcun feedback (come fanno gli shortcut R/P nel keydown di app.js).
function openAssistant(){
    if (typeof _rackCollapsed !== 'undefined' && _rackCollapsed &&
        typeof toggleRackPanel === 'function') toggleRackPanel();
    switchRightTab('ai');
}

// Dal pulsante «Configura» dell'empty-state: apre «Utenti e accessi» sulla
// scheda AI. Il pulsante è .admin-only → mostrato solo agli amministratori.
function openAiSettings(){
    if (typeof openUserManager === 'function') openUserManager();
    if (typeof umSwitchTab === 'function') umSwitchTab('ai');
}

// ── L0: scheda config «Assistente AI» nel modale «Utenti e accessi» ──────────
// Caricata da umSwitchTab('ai') (app-auth) a ogni apertura del pane. Niente win.*:
// stato via `store`, i18n via `t`, DOM via document → il ponte resta a 1804.
// Chiavi degli interruttori (mirror di server/ai-config.js): ambito dati + capacità.
const AI_SCOPE_KEYS = ['devices', 'ports', 'snmpHealth', 'topology', 'drift'];
const AI_FEATURE_KEYS = ['qa', 'diagnostics', 'gaps', 'suggestions', 'ansible'];

function _aiCfgMsg(txt, cls){
    const m = document.getElementById('ai-cfg-msg');
    if(m){ m.textContent = txt || ''; m.className = 'um-msg' + (cls ? ' ' + cls : ''); }
}

function _aiCfgKeyPlaceholder(cfg){
    if(cfg && cfg.keyFromEnv) return t('ai.cfgKeyEnv');
    if(cfg && cfg.keySet) return t('ai.cfgKeyConfigured');
    return t('ai.cfgKeyPh');
}

function _aiCfgLoad(){
    _aiCfgMsg('');
    const prev = document.getElementById('ai-cfg-preview'); if(prev) prev.style.display = 'none';
    fetch('/api/ai/config', { credentials: 'same-origin' })
        .then(r => r.json())
        .then(cfg => {
            const en = document.getElementById('ai-cfg-enabled');
            const ep = document.getElementById('ai-cfg-endpoint');
            const md = document.getElementById('ai-cfg-model');
            const key = document.getElementById('ai-cfg-key');
            if(en) en.checked = !!cfg.enabled;
            if(ep) ep.value = cfg.endpoint || '';
            if(md) md.value = cfg.model || '';
            if(key){ key.value = ''; key.placeholder = _aiCfgKeyPlaceholder(cfg); }   // write-only
            // Interruttori ambito + capacità (default ON: solo false esplicito spegne).
            const scope = cfg.scope || {};
            AI_SCOPE_KEYS.forEach(k => { const el = document.getElementById('ai-scope-' + k); if(el) el.checked = scope[k] !== false; });
            const feats = cfg.features || {};
            AI_FEATURE_KEYS.forEach(k => { const el = document.getElementById('ai-feat-' + k); if(el) el.checked = feats[k] !== false; });
            // Viewer = sola lettura (il bottone Salva è già .admin-only).
            const isAdmin = !!(store._currentUser && store._currentUser.role === 'admin');
            [en, ep, md, key].forEach(el => { if(el) el.disabled = !isAdmin; });
            AI_SCOPE_KEYS.forEach(k => { const el = document.getElementById('ai-scope-' + k); if(el) el.disabled = !isAdmin; });
            AI_FEATURE_KEYS.forEach(k => { const el = document.getElementById('ai-feat-' + k); if(el) el.disabled = !isAdmin; });
        })
        .catch(() => {});
}

// Salva la config (solo admin). Chiave: campo vuoto = invariata (non si tocca il
// segreto); valorizzato = nuova chiave. La chiave non torna mai indietro.
function aiCfgSave(){
    const en = document.getElementById('ai-cfg-enabled');
    const ep = document.getElementById('ai-cfg-endpoint');
    const md = document.getElementById('ai-cfg-model');
    const key = document.getElementById('ai-cfg-key');
    const body = {
        enabled: !!(en && en.checked),
        endpoint: ep ? ep.value.trim() : '',
        model: md ? md.value.trim() : '',
        scope: {},
        features: {},
    };
    AI_SCOPE_KEYS.forEach(k => { const el = document.getElementById('ai-scope-' + k); if(el) body.scope[k] = !!el.checked; });
    AI_FEATURE_KEYS.forEach(k => { const el = document.getElementById('ai-feat-' + k); if(el) body.features[k] = !!el.checked; });
    if(key && key.value) body.key = key.value;
    fetch('/api/ai/config', {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }).then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
          if(!ok){ _aiCfgMsg(t('ai.cfgSaveErr'), 'err'); return; }
          if(key){ key.value = ''; key.placeholder = _aiCfgKeyPlaceholder(d); }
          _aiCfgMsg(t('ai.cfgSaved'), 'ok');
          // Rifletti SUBITO nel pannello Assistente il nuovo stato (enabled →
          // empty-state↔chat, endpoint → chip 🔒/☁) senza dover cambiare tab.
          _aiCfgCache = d; _aiApplyPanelState();
      }).catch(() => _aiCfgMsg(t('ai.cfgSaveErr'), 'err'));
}

// «Mostra cosa esce»: anteprima del contesto SANITIZZATO del progetto corrente
// (paletto sicurezza #1). Nessuna chiamata al modello: solo i dati che uscirebbero.
function aiCfgPreview(){
    const pid = store.currentProjectId;
    if(pid === undefined || pid === null || pid === ''){ _aiCfgMsg(t('ai.cfgNoProject'), 'err'); return; }
    fetch('/api/ai/preview', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: pid }),
    }).then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
          if(!ok || !d.context){ _aiCfgMsg(t('ai.cfgPreviewErr'), 'err'); return; }
          _aiCfgMsg('');
          const out = document.getElementById('ai-cfg-preview-out');
          const box = document.getElementById('ai-cfg-preview');
          if(out) out.textContent = JSON.stringify(d.context, null, 2);   // textContent = niente HTML injection
          if(box) box.style.display = 'block';
      }).catch(() => _aiCfgMsg(t('ai.cfgPreviewErr'), 'err'));
}

// ── Chat (incremento «modello vivo») ────────────────────────────────────────
// La conversazione vive SOLO in sessione browser (project-global), mai nel JSON
// (spec §8d). Niente win.*: store/t/getLang/fetch/document.
let _aiCfgCache = null;       // ultima config nota (per render immediato senza flicker)
let _aiConvo = [];            // [{ role:'user'|'assistant'|'error', content }]
let _aiConvoProject = null;   // progetto a cui appartiene la conversazione corrente
let _aiBusy = false;

const _aiEl = (id) => document.getElementById(id);

function _aiChipStatus(cfg){
    const chip = _aiEl('ai-chip-status');
    if(!chip) return;
    const local = !!(cfg && cfg.local);
    chip.className = 'ai-chip ' + (local ? 'ai-chip-local' : 'ai-chip-cloud');
    chip.innerHTML = '<i class="fas fa-' + (local ? 'lock' : 'cloud') + '"></i> ' +
        (local ? t('assistant.chipLocal') : t('assistant.chipCloud'));
}

// Commuta empty-state ↔ chat in base alla config nota; aggiorna chip e messaggi.
function _aiApplyPanelState(){
    const empty = _aiEl('ai-empty');
    const chat = _aiEl('ai-chat');
    const enabled = !!(_aiCfgCache && _aiCfgCache.enabled);
    if(empty) empty.style.display = enabled ? 'none' : 'flex';
    if(chat) chat.style.display = enabled ? 'flex' : 'none';
    if(enabled){ _aiChipStatus(_aiCfgCache); _renderAiMessages(); }
}

// Apertura della tab Assistente (da switchRightTab('ai')): conversazione legata
// al progetto (cambio progetto → riparti pulito), poi ricarica la config.
function _aiPanelOpen(){
    if(_aiConvoProject !== store.currentProjectId){ _aiConvo = []; _aiConvoProject = store.currentProjectId; }
    _aiApplyPanelState();
    fetch('/api/ai/config', { credentials: 'same-origin' })
        .then(r => r.json())
        .then(cfg => { _aiCfgCache = cfg; _aiApplyPanelState(); })
        .catch(() => {});
}

function _renderAiMessages(){
    const box = _aiEl('ai-messages');
    if(!box) return;
    // Il cestino «Pulisci chat» ha senso solo a conversazione avviata.
    const clearBtn = _aiEl('ai-clear-btn');
    if(clearBtn) clearBtn.style.display = _aiConvo.length ? '' : 'none';
    box.innerHTML = '';
    if(!_aiConvo.length){
        const g = document.createElement('p');
        g.className = 'ai-greeting';
        g.textContent = t('assistant.greeting');
        box.appendChild(g);
        const chips = document.createElement('div');
        chips.className = 'ai-ex-chips';
        [t('assistant.ex1'), t('assistant.ex2'), t('assistant.ex3')].forEach(ex => {
            const c = document.createElement('button');
            c.className = 'ai-ex-chip'; c.type = 'button'; c.textContent = ex;
            c.addEventListener('click', () => { const i = _aiEl('ai-input'); if(i) i.value = ex; aiSend(); });
            chips.appendChild(c);
        });
        box.appendChild(chips);
        return;
    }
    for(const m of _aiConvo){
        const d = document.createElement('div');
        d.className = 'ai-msg ' + (m.role === 'user' ? 'ai-msg-user' : m.role === 'error' ? 'ai-msg-err' : 'ai-msg-ai');
        d.textContent = m.content;   // textContent: nessuna HTML-injection dall'output del modello
        box.appendChild(d);
    }
    if(_aiBusy){
        const ty = document.createElement('div');
        ty.className = 'ai-typing'; ty.textContent = t('assistant.thinking');
        box.appendChild(ty);
    }
    box.scrollTop = box.scrollHeight;
}

// Invia il turno: ottimistico (mostra subito la domanda + «sto pensando»), poi
// chiama /api/ai/chat. La risposta è advisory; gli errori diventano una bolla.
function aiSend(){
    if(_aiBusy) return;
    const input = _aiEl('ai-input');
    const text = input ? input.value.trim() : '';
    if(!text) return;
    const pid = store.currentProjectId;
    _aiConvo.push({ role: 'user', content: text });
    if(input) input.value = '';
    _aiBusy = true;
    const btn = _aiEl('ai-send-btn'); if(btn) btn.disabled = true;
    _renderAiMessages();
    fetch('/api/ai/chat', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: pid, messages: _aiConvo.filter(m => m.role !== 'error'), lang: getLang() }),
    }).then(r => r.json().then(d => ({ ok: r.ok, d })).catch(() => ({ ok: r.ok, d: {} })))
      .then(({ ok, d }) => {
          if(ok && d && typeof d.content === 'string' && d.content.trim()){
              _aiConvo.push({ role: 'assistant', content: d.content });
          } else {
              _aiConvo.push({ role: 'error', content: t('assistant.errProvider') });
          }
      })
      .catch(() => { _aiConvo.push({ role: 'error', content: t('assistant.errProvider') }); })
      .then(() => { _aiBusy = false; const b = _aiEl('ai-send-btn'); if(b) b.disabled = false; _renderAiMessages(); });
}

// Pulisce la conversazione corrente (cestino in testata). La chat vive solo in
// sessione browser (mai persistita), quindi è un semplice reset locale: torna al
// saluto + chip esempi e nasconde il cestino. Niente azzeramento mentre una
// risposta è in volo (come la guardia _aiBusy di aiSend).
function aiClearChat(){
    if(_aiBusy) return;
    _aiConvo = [];
    _renderAiMessages();
}

expose({ openAssistant, openAiSettings, _aiCfgLoad, aiCfgSave, aiCfgPreview, _aiPanelOpen, aiSend, aiClearChat });
