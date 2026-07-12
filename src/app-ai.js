// ============================================================
// ASSISTENTE AI (advisory) — glue della 3ª tab del pannello destro   [modulo ESM]
// ============================================================
// Glue della tab «Assistente» + scheda AI in «Utenti e accessi». L'empty-state è
// HTML STATICO in netmapper.html (#ai-panel): bilingue via data-i18n, ruolo via
// .admin-only/.viewer-ok (_applyRoleUI in app-auth). Stato corrente:
//   L0 provider+config (server/ai/*, server/routes/ai.js) ✓ · L1 Q&A ✓ +
//   GROUNDING ✓ (liveFacts dal browser → ri-sanitizzati dal server; citazioni
//   cliccabili + controllo anti-invenzione via lib/ai-grounding).
// Prossimi: L2 trova-buchi/suggerisci · L3 bozza Ansible · L4 «Spiega» sul Drift.
// Vedi _local/notes/AI_ASSISTANT_SPEC_2026-06-29.md.
//
// Igiene ponte (ratchet 1804, può solo scendere): NESSUN nuovo win.*. La glue
// legacy rimasta (toggleRackPanel + var _rackCollapsed, del pannello destro) si
// chiama come GLOBALE BARE con guardia typeof — stesso idioma degli shortcut R/P
// in app.js. switchRightTab arriva via import ESM dal nucleo; openUserManager/
// umSwitchTab sono ora import ESM da app-auth (ASSE B: erano bareword-su-window,
// ma openUserManager non era mai in expose() → apertura modale non partiva).
import { expose, t, getLang } from './_bridge.js';
import { store } from './store.js';
import { switchRightTab, nodeById } from './app.js';
import { openUserManager, umSwitchTab } from './app-auth.js';
import { registerClickActions } from './app-delegation.js';

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
    openUserManager();
    umSwitchTab('ai');
}

// Pulsante robot in toolbar (a destra di «Report»). Per gli ADMIN è l'accesso
// rapido alle Impostazioni dell'assistente (scheda «Utenti e accessi» → AI):
// sostituisce l'ingranaggio rimosso dalla testata della chat e garantisce che
// le impostazioni restino SEMPRE raggiungibili (anche solo per spegnerlo).
// Per i viewer (la config è admin-only) apre la chat. La conversazione resta
// comunque apribile da tutti: tab «Assistente» del pannello destro o tasto «A».
function openAssistantOrSettings(){
    const isAdmin = !!(store._currentUser && store._currentUser.role === 'admin');
    if (isAdmin) { openAiSettings(); return; }
    openAssistant();
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
        // Stessi liveFacts della chat → l'anteprima mostra ESATTAMENTE cosa uscirebbe.
        body: JSON.stringify({ projectId: pid, liveFacts: _aiCollectLiveFacts() }),
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
let _aiStepDismissed = null;  // id del «prossimo passo» chiuso dall'utente (per-passo)

const _aiEl = (id) => document.getElementById(id);

// ── L1: fatti VIVI dal runtime del browser (spec §5) ─────────────────────────
// drift e IPAM NON sono nel JSON persistito: vivono in pagina (store._driftReport,
// motore IPAM). Li raccogliamo qui e li alleghiamo alla POST; il SERVER li
// RI-SANITIZZA (allowlist _sanitizeFacts, gated da scope.drift) e li fonde nel
// contesto. Mappa la forma interna di store._driftReport → forma attesa dal
// server. Best-effort: ogni pezzo mancante è semplicemente omesso (mai throw).
// Niente win.*: nodeById è import ESM, _ipamUsageForVlan è global bare (typeof).
function _aiCollectLiveFacts(){
    const facts = {};
    try {
        const rep = (store._driftReport && typeof store._driftReport === 'object') ? store._driftReport : null;
        if(rep){
            const byId = (id) => { try { return id ? nodeById(id) : null; } catch(_){ return null; } };
            const drift = {};
            const absent = (Array.isArray(rep.macOrphan) ? rep.macOrphan : []).map(r => {
                const n = byId(r.nodeId);
                return _aiCompact({ id: r.nodeId, name: r.label || (n && n.name), ip: n && n.ip, mac: r.mac, vlan: (n && n.vlan != null) ? n.vlan : undefined });
            }).filter(e => Object.keys(e).length);
            const undoc = (Array.isArray(rep.undocumented) ? rep.undocumented : []).map(r =>
                _aiCompact({ mac: r.mac, vlan: (r.vlan != null) ? r.vlan : undefined, hostname: r.label })
            ).filter(e => Object.keys(e).length);
            const ipch = (Array.isArray(rep.ipChanged) ? rep.ipChanged : []).map(r => {
                const n = byId(r.nodeId);
                return _aiCompact({ id: r.nodeId, name: r.label || (n && n.name), mac: r.mac, from: r.oldIp, to: r.newIp });
            }).filter(e => Object.keys(e).length);
            if(absent.length) drift.absent = absent;
            if(undoc.length) drift.undocumented = undoc;
            if(ipch.length) drift.ipChanged = ipch;
            if(Object.keys(drift).length) facts.drift = drift;
        }
    } catch(_){}
    try {
        // VLAN reali: id da vlanColors/vlanNames (dichiarate) ∪ voci IPAM; subnet/gw
        // da state.ipam.vlans (NON da un array "vlans"). Le occupazioni le calcola il
        // motore puro via _ipamUsageForVlan (global bare). «InfraNet calcola, l'AI racconta».
        const st = store.state || {};
        const ipamVlans = (st.ipam && st.ipam.vlans) ? st.ipam.vlans : {};
        const vids = new Set();
        for(const k of Object.keys(st.vlanColors || {})) vids.add(+k);
        for(const k of Object.keys(st.vlanNames || {})) vids.add(+k);
        for(const k of Object.keys(ipamVlans)) vids.add(+k);
        const haveUsage = typeof _ipamUsageForVlan === 'function';
        const ipam = [], gaps = [];
        for(const vid of vids){
            if(!Number.isFinite(vid)) continue;
            const entry = ipamVlans[vid] || ipamVlans[String(vid)] || null;
            const subnet = entry && String(entry.subnet || '').trim();
            if(!subnet){
                // VLAN dichiarata (con nome) ma senza subnet → l'IPAM non può aiutare lì.
                if(st.vlanNames && st.vlanNames[vid]) gaps.push({ kind: 'vlan_no_subnet', vlan: vid });
                continue;
            }
            if(!haveUsage) continue;
            try {
                const u = _ipamUsageForVlan(vid);
                if(u && u.capacity){
                    ipam.push(_aiCompact({ vlan: vid, used: u.usedCount, free: u.freeCount, nextFree: u.nextFree }));
                    if(!u.gatewayOk) gaps.push({ kind: 'vlan_no_gateway', vlan: vid });
                    if(u.pct >= 90) gaps.push({ kind: 'vlan_ipam_high', vlan: vid });
                }
            } catch(_){}
            if(gaps.length >= 50) break;   // cap di sicurezza (budget token)
        }
        if(ipam.length) facts.ipam = ipam;
        if(gaps.length) facts.gaps = gaps;
    } catch(_){}
    return facts;
}
// Toglie le chiavi null/undefined/'' (snapshot compatto, gemello di context._compact).
function _aiCompact(obj){
    const out = {};
    for(const k of Object.keys(obj)){ const v = obj[k]; if(v === null || v === undefined || v === '') continue; out[k] = v; }
    return out;
}

// ── Onboarding «copilota» (spec §4d): chip «prossimo passo» + spotlight ──────
// «InfraNet calcola, l'AI racconta»: il passo più utile ORA è una REGOLA
// DETERMINISTICA (lib/onboarding, global bare) su un riassunto dello stato del
// progetto — NON il modello. Manual-first assoluto: il chip GUIDA (illumina il
// bottone vero o semina una domanda), non applica mai nulla. Riusa i conteggi già
// calcolati da _aiCollectLiveFacts (drift/gaps) → niente doppioni.
function _aiBuildSummary(){
    const st = (store.state && typeof store.state === 'object') ? store.state : {};
    const nodes = Array.isArray(st.nodes) ? st.nodes : [];
    let facts;
    try { facts = _aiCollectLiveFacts() || {}; } catch(_){ facts = {}; }
    const d = (facts.drift && typeof facts.drift === 'object') ? facts.drift : {};
    const len = (a) => Array.isArray(a) ? a.length : 0;
    let noSubnet = 0, noGateway = 0;
    for(const x of (Array.isArray(facts.gaps) ? facts.gaps : [])){
        if(x && x.kind === 'vlan_no_subnet') noSubnet++;
        else if(x && x.kind === 'vlan_no_gateway') noGateway++;
    }
    return {
        devices: nodes.length,
        verified: !!store._driftReport,
        drift: { absent: len(d.absent), undocumented: len(d.undocumented), ipChanged: len(d.ipChanged) },
        gaps: { noSubnet, noGateway },
    };
}

// Coach-mark: illumina il bottone REALE (alone ciano lampeggiante) e lo porta in
// vista. Resta acceso FINCHÉ l'utente non clicca il bottone illuminato (o finché
// non si chiede un altro spotlight). Un solo spotlight per volta. Niente win.*.
let _aiSpotEl = null, _aiSpotClear = null;
function _aiSpotClearNow(){
    if(_aiSpotEl){
        _aiSpotEl.classList.remove('coach-spotlight');
        if(_aiSpotClear){ try { _aiSpotEl.removeEventListener('click', _aiSpotClear); } catch(_){} }
    }
    _aiSpotEl = null; _aiSpotClear = null;
}
function _aiSpotlight(selector){
    try {
        _aiSpotClearNow();
        const el = selector ? document.querySelector(selector) : null;
        if(!el) return;
        el.classList.add('coach-spotlight');
        _aiSpotEl = el;
        // Si spegne SOLO quando l'utente clicca il bottone illuminato (once).
        _aiSpotClear = () => _aiSpotClearNow();
        el.addEventListener('click', _aiSpotClear, { once: true });
        // Scrolla SOLO se il bottone è davvero fuori dalla viewport (i bottoni
        // della toolbar sono già visibili) → non spostare mai la pagina.
        try {
            const r = el.getBoundingClientRect();
            const vh = window.innerHeight || document.documentElement.clientHeight;
            const vw = window.innerWidth || document.documentElement.clientWidth;
            if(r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw){
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            }
        } catch(_){}
    } catch(_){}
}

// Costruisce il chip «prossimo passo». allowAsk=false (empty-state non
// configurato) nasconde l'azione «Chiedi» (richiede l'assistente attivo); lo
// spotlight «Mostrami» funziona comunque. `refresh` = come ridisegnare dopo la
// chiusura. Ritorna null se non c'è un passo o se l'utente l'ha già chiuso.
function _aiNextStepEl(allowAsk, refresh){
    if(typeof nextStep !== 'function') return null;
    let step = null;
    try { step = nextStep(_aiBuildSummary()); } catch(_){ return null; }
    if(!step || !step.id || step.id === _aiStepDismissed) return null;
    const ok = step.id === 'allGood';
    const wrap = document.createElement('div');
    wrap.className = 'ai-nextstep' + (ok ? ' ai-nextstep-ok' : '');
    const ic = document.createElement('i');
    ic.className = 'fas ' + (ok ? 'fa-circle-check' : 'fa-circle-arrow-right');
    wrap.appendChild(ic);
    const txt = document.createElement('span');
    txt.className = 'ai-nextstep-txt';
    txt.textContent = t('onboard.' + step.id, step.data);   // textContent: zero injection
    wrap.appendChild(txt);
    if(step.target){
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'ai-nextstep-act';
        b.textContent = t('onboard.show');
        b.addEventListener('click', () => _aiSpotlight(step.target));
        wrap.appendChild(b);
    } else if(allowAsk && step.askKey){
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'ai-nextstep-act';
        b.textContent = t('onboard.ask');
        b.addEventListener('click', () => aiExplain(t(step.askKey, step.data)));
        wrap.appendChild(b);
    }
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'ai-nextstep-x';
    x.textContent = '×';
    x.title = t('onboard.dismiss');
    x.setAttribute('aria-label', t('onboard.dismiss'));
    x.addEventListener('click', () => { _aiStepDismissed = step.id; if(typeof refresh === 'function') refresh(); });
    wrap.appendChild(x);
    return wrap;
}

// Inietta (idempotente) il chip nell'empty-state non-configurato → l'onboarding
// guida Scopri/Verifica anche PRIMA di aver configurato un modello.
function _aiInjectEmptyNextStep(){
    const empty = _aiEl('ai-empty');
    if(!empty) return;
    let holder = _aiEl('ai-empty-step');
    if(!holder){
        holder = document.createElement('div');
        holder.id = 'ai-empty-step';
        const inner = empty.querySelector('.ai-empty');
        if(inner) inner.appendChild(holder); else empty.appendChild(holder);
    }
    holder.innerHTML = '';
    const chip = _aiNextStepEl(false, _aiApplyPanelState);
    if(chip) holder.appendChild(chip);
}

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
    else _aiInjectEmptyNextStep();   // onboarding anche da non-configurato
}

// Apertura della tab Assistente (da switchRightTab('ai')): conversazione legata
// al progetto (cambio progetto → riparti pulito), poi ricarica la config.
function _aiPanelOpen(){
    if(_aiConvoProject !== store.currentProjectId){ _aiConvo = []; _aiStepDismissed = null; _aiConvoProject = store.currentProjectId; }
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
        // Chip «prossimo passo» (onboarding §4d): sotto il saluto, prima degli
        // esempi. Solo a conversazione vuota → guida senza disturbare la chat.
        const step = _aiNextStepEl(true, _renderAiMessages);
        if(step) box.appendChild(step);
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
        // Ogni turno = RIGA orizzontale [corpo + iconcina «copia»], top-aligned: la
        // copia sta IN ALTO, allineata col bordo superiore del tile, sul lato OPPOSTO
        // alla bolla → a sinistra sull'input (utente, bolla a destra), a destra
        // sull'output (assistente, bolla a sinistra). Il corpo è avvolto in
        // .ai-msg-body così i segmenti (bolle/card/citazioni) restano impilati.
        const role = m.role === 'assistant' ? 'ai' : (m.role === 'user' ? 'user' : 'err');
        const row = document.createElement('div');
        row.className = 'ai-msg-row ai-msg-row-' + role;
        const body = document.createElement('div');
        body.className = 'ai-msg-body';
        if(m.role === 'assistant'){
            // Il corpo può contenere blocchi di codice (bozze Ansible) → li rende
            // come card-bozza (banner + Copia), il resto come bolle (lib/ai-draft).
            _aiRenderAssistantBody(body, m.content);
            // Sotto la risposta: citazioni cliccabili + ⚠ riferimenti non trovati
            // (controllo anti-invenzione, lib/ai-grounding).
            if(m.entities){ const cite = _aiCitationsEl(m.content, m.entities); if(cite) body.appendChild(cite); }
        } else {
            const d = document.createElement('div');
            d.className = 'ai-msg ' + (m.role === 'user' ? 'ai-msg-user' : 'ai-msg-err');
            d.textContent = m.content;   // textContent: nessuna HTML-injection
            body.appendChild(d);
        }
        // La copia vive DENTRO il corpo (assoluta in CSS) → è ancorata al frame del
        // tile e lo segue; il lato (sinistra input / destra output) lo decide il CSS.
        const copy = (m.role === 'error') ? null : _aiMsgCopyBtn(m.content);
        if(copy) body.appendChild(copy);
        row.appendChild(body);
        box.appendChild(row);
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
        // liveFacts = drift/IPAM dal runtime browser (ri-sanitizzati dal server).
        body: JSON.stringify({ projectId: pid, messages: _aiConvo.filter(m => m.role !== 'error'), lang: getLang(), liveFacts: _aiCollectLiveFacts() }),
    }).then(r => r.json().then(d => ({ ok: r.ok, d })).catch(() => ({ ok: r.ok, d: {} })))
      .then(({ ok, d }) => {
          if(ok && d && typeof d.content === 'string' && d.content.trim()){
              // entities = digest del contesto reale → controllo anti-invenzione lato client.
              _aiConvo.push({ role: 'assistant', content: d.content, entities: d.entities || null });
          } else {
              _aiConvo.push({ role: 'error', content: t('assistant.errProvider') });
          }
      })
      .catch(() => { _aiConvo.push({ role: 'error', content: t('assistant.errProvider') }); })
      .then(() => { _aiBusy = false; const b = _aiEl('ai-send-btn'); if(b) b.disabled = false; _renderAiMessages(); });
}

// ── Corpo della risposta: testo + bozze Ansible (lib/ai-draft, global bare) ──
// Segmenta in bolle di testo e card-bozza (blocco di codice). Fallback a una
// singola bolla se il lib non è caricato. Tutto via textContent (zero injection).
function _aiRenderAssistantBody(box, content){
    let segs = null;
    try { if(typeof splitDraftBlocks === 'function') segs = splitDraftBlocks(content); } catch(_){ segs = null; }
    if(!segs || !segs.length) segs = [{ type: 'text', content: content }];
    for(const seg of segs){
        if(seg.type === 'code'){ box.appendChild(_aiDraftCard(seg)); continue; }
        const d = document.createElement('div');
        d.className = 'ai-msg ai-msg-ai';
        d.textContent = seg.content;
        box.appendChild(d);
    }
}

// Card di una bozza: banner ambra «non applicata» (solo per linguaggi di
// automazione), codice mono, bottone Copia. InfraNet non esegue: è testo.
function _aiDraftCard(seg){
    const card = document.createElement('div');
    card.className = 'ai-draft' + (seg.draft ? ' ai-draft-warn' : '');
    if(seg.draft){
        const head = document.createElement('div');
        head.className = 'ai-draft-head';
        const ic = document.createElement('i'); ic.className = 'fas fa-triangle-exclamation';
        const sp = document.createElement('span'); sp.textContent = t('assistant.draftBanner');
        head.appendChild(ic); head.appendChild(sp);
        card.appendChild(head);
    }
    const pre = document.createElement('pre');
    pre.className = 'ai-draft-code';
    const code = document.createElement('code');
    code.textContent = seg.content;
    pre.appendChild(code);
    card.appendChild(pre);
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'ai-draft-copy';
    copy.textContent = t('assistant.copy');
    copy.addEventListener('click', () => _aiCopy(seg.content, copy));
    card.appendChild(copy);
    return card;
}

// Copia negli appunti (azione locale, avviata dall'utente). Feedback breve.
function _aiCopy(text, btn){
    try {
        navigator.clipboard.writeText(text).then(() => {
            const prev = btn.textContent;
            btn.textContent = t('assistant.copied');
            setTimeout(() => { btn.textContent = prev; }, 1500);
        }).catch(() => {});
    } catch(_){}
}

// Pulsante «copia messaggio» (stile chat Claude): iconcina che compare su hover
// sotto la bolla e copia il testo del SINGOLO turno (input utente o output AI).
function _aiMsgCopyBtn(text){
    const bar = document.createElement('div');
    bar.className = 'ai-msg-actions';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ai-msg-copy';
    b.title = t('assistant.copyMsg');
    b.setAttribute('aria-label', t('assistant.copyMsg'));
    const ic = document.createElement('i'); ic.className = 'fas fa-copy';
    b.appendChild(ic);
    b.addEventListener('click', () => _aiCopyIcon(String(text == null ? '' : text), b, ic));
    bar.appendChild(b);
    return bar;
}

// Variante a icona di _aiCopy: copia + feedback ✓ breve (ripristina al re-render).
function _aiCopyIcon(text, btn, icon){
    try {
        navigator.clipboard.writeText(text).then(() => {
            icon.className = 'fas fa-check';
            btn.classList.add('copied');
            setTimeout(() => { icon.className = 'fas fa-copy'; btn.classList.remove('copied'); }, 1400);
        }).catch(() => {});
    } catch(_){}
}

// ── Citazioni + controllo anti-invenzione (lib/ai-grounding, global bare) ────
// Costruisce la riga sotto la risposta: chip device CLICCABILI (saltano al nodo
// sulla mappa), chip VLAN informative, chip ⚠ per gli IP/MAC citati ma assenti
// dai dati (possibile invenzione). Tutto via DOM+textContent (zero injection).
function _aiCitationsEl(content, entities){
    if(typeof checkGrounding !== 'function') return null;
    let res;
    try { res = checkGrounding(content, entities); } catch(_){ return null; }
    if(!res || (!res.citations.length && !res.unknownRefs.length)) return null;
    const wrap = document.createElement('div');
    wrap.className = 'ai-citations';
    for(const c of res.citations){
        if(c.kind === 'device'){
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'ai-cite-chip';
            chip.textContent = c.name || c.id;
            chip.title = t('assistant.citationTip');
            chip.addEventListener('click', () => _aiJumpToNode(c.id));
            wrap.appendChild(chip);
        } else if(c.kind === 'vlan'){
            const chip = document.createElement('span');
            chip.className = 'ai-cite-chip ai-cite-vlan';
            chip.textContent = 'VLAN ' + c.vlan;
            wrap.appendChild(chip);
        }
    }
    for(const u of res.unknownRefs){
        const chip = document.createElement('span');
        chip.className = 'ai-cite-chip ai-cite-unknown';
        chip.textContent = '⚠ ' + u.value;
        chip.title = t('assistant.unknownRefTip');
        wrap.appendChild(chip);
    }
    return wrap;
}

// Salta al device citato sulla mappa: seleziona + centra (riusa il motore di
// ricerca esistente). selectAndFocusNode è global bare (typeof) → niente win.*.
function _aiJumpToNode(id){
    let n = null;
    try { n = nodeById(id); } catch(_){}
    if(!n) return;
    if(typeof selectAndFocusNode === 'function') selectAndFocusNode(n);
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

// ── L4: «Spiega» dalle righe della Verifica (loop Verifica→capisci→agisci) ───
// Apre la tab Assistente, semina la domanda e la invia. Se l'assistente non è
// configurato, aiSend è un no-op (input assente) → al massimo apre la tab.
function aiExplain(question){
    const q = (question == null ? '' : String(question)).trim();
    if(!q) return;
    openAssistant();
    const i = _aiEl('ai-input');
    if(!i) return;          // non configurato / chat non montata → solo apertura tab
    i.value = q;
    aiSend();
}

// Costruisce la domanda dalla riga del Drift (store._driftReport) e la inoltra.
// Le risposte sono GROUNDED: i fatti del Drift sono già nel contesto (liveFacts).
export function aiExplainDrift(cat, key){   // ASSE B: importata da app-drift.js (data-act="drift-explain"), non più su window
    let row = null;
    try {
        const rep = store._driftReport;
        const list = rep && rep[cat];
        row = Array.isArray(list) ? list.find(r => r && r.key === key) : null;
    } catch(_){}
    aiExplain(_aiDriftQuestion(cat, row));
}

function _aiDriftQuestion(cat, row){
    const r = row || {};
    const name = (r.label || r.mac || '').toString().trim() || (r.mac || '');
    const vlan = (r.vlan != null) ? (', VLAN ' + r.vlan) : '';
    if(cat === 'macOrphan' || cat === 'unverified') return t('assistant.qAbsent', { name });
    if(cat === 'ipChanged') return t('assistant.qIpChange', { name: name || (r.mac || ''), from: r.oldIp || '?', to: r.newIp || '?' });
    if(cat === 'stateDrift') return t('assistant.qDrift', { name });
    if(cat === 'undocumented' || cat === 'undocumentedEndpoint') return t('assistant.qUndoc', { mac: r.mac || name, vlan });
    if(cat === 'ghostCable') return t('assistant.qGhost', { name });
    return t('assistant.qGeneric', { name });
}

expose({ openAssistant, _aiCfgLoad, _aiPanelOpen, aiExplain, _aiBuildSummary });   // aiExplainDrift: ASSE B, delegata dal template Drift (data-act="drift-explain")

// ASSE B — superficie assistente AI via event delegation (data-act) invece di
// onclick inline. Queste 6 funzioni escono da expose(): non le legge nessun altro
// modulo (chiamate interne restano in module-scope). Vedi [[frontend-architettura-stato]].
registerClickActions({
    'assistant-open':  () => openAssistantOrSettings(),
    'ai-settings-open': () => openAiSettings(),
    'ai-clear':        () => aiClearChat(),
    'ai-send':         () => aiSend(),
    'ai-cfg-save':     () => aiCfgSave(),
    'ai-cfg-preview':  () => aiCfgPreview(),
});
