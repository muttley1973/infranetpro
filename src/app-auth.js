// ============================================================
// AUTH FRONTEND
// Utente corrente, menu account, gestione utenti e cambio password.
// Estratto da app.js come secondo passo di modularizzazione.
// Migrato a modulo ESM (src/).
// ============================================================
import { expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML } from './app-util.js';
import { closeFloorMenu, closeRackMenu } from './app-search-zoom-rack.js';   // ritiro ponte: coda funzioni A (batch 2/2) (ex win.*)
import { switchLang } from './app.js';   // ASSE B: menu utente via data-act (ex win.switchLang)
import { registerClickActions } from './app-delegation.js';   // ASSE B: event delegation (data-act) — menu utente

// Stato condiviso: letto BARE da file ancora-legacy (app-core.js apiFetch,
// app.js _auditActor, export.js) → deve vivere su window, non module-local.
store._currentUser = store._currentUser || null; // { id, username, role }

// Stato transitorio del tab Token API (modale "Utenti e accessi"):
// _lastToken = segreto appena generato (per il bottone Copia, vive solo finché
// il modale è aperto); _tokensLoaded = lazy-load una volta per apertura.
let _lastToken = '';
let _tokensLoaded = false;

async function initAuth(){
    try {
        const r = await fetch('/api/auth/me');
        if(!r.ok){ window.location.href='/login'; return; }
        const d = await r.json();
        if(!d.ok){ window.location.href='/login'; return; }
        store._currentUser = d.user;
        _applyRoleUI();
    } catch(_){
        window.location.href='/login';
    }
}

function _applyRoleUI(){
    if(!store._currentUser) return;
    const lbl = document.getElementById('user-label');
    if(lbl) lbl.textContent = store._currentUser.username;
    const info = document.getElementById('user-info-row');
    if(info){
        const badge = `<span class="role-badge ${store._currentUser.role}">${store._currentUser.role==='admin'?'Amministratore':'Visualizzatore'}</span>`;
        info.innerHTML = `<b>${escapeHTML(store._currentUser.username)}</b> ${badge}`;
    }
    if(store._currentUser.role === 'viewer'){
        document.body.classList.add('viewer-mode');
        ['btn-save','btn-snmp-sync','btn-topology'].forEach(id=>{
            const el=document.getElementById(id);
            if(id==='btn-topology') return;
            if(el){ el.disabled=true; el.title='Richiede privilegi amministratore'; }
        });
        document.querySelectorAll('.admin-only').forEach(el=>{
            if(!el.classList.contains('viewer-ok')) el.style.display='none';
        });
        document.querySelectorAll('[class*="viewer-ok"]').forEach(el=>el.style.display='');
    }
}

async function doLogout(){
    closeUserMenu();
    await fetch('/api/auth/logout',{method:'POST'});
    window.location.href='/login';
}

function toggleUserMenu(){
    const d=document.getElementById('user-dropdown');
    if(d) d.style.display=d.style.display==='none'?'block':'none';
}

function closeUserMenu(){
    const d=document.getElementById('user-dropdown');
    if(d) d.style.display='none';
}

function toggleImpExpMenu(){
    const d=document.getElementById('impexp-dropdown');
    if(d) d.style.display=d.style.display==='none'?'block':'none';
}

function closeImpExpMenu(){
    const d=document.getElementById('impexp-dropdown');
    if(d) d.style.display='none';
}

function toggleReportMenu(){
    const d=document.getElementById('report-dropdown');
    if(d) d.style.display=d.style.display==='none'?'block':'none';
}
export function closeReportMenu(){
    const d=document.getElementById('report-dropdown');
    if(d) d.style.display='none';
}

document.addEventListener('click', e=>{
    if(!e.target.closest('#user-menu-wrap')) closeUserMenu();
    if(!e.target.closest('#impexp-menu-wrap')) closeImpExpMenu();
    if(!e.target.closest('#report-menu-wrap')) closeReportMenu();
    // Popover "Automazioni rete": chiudi cliccando fuori, ma il badge auto-poll
    // (#autopoll-badge, nell'area di stato) lo APRE → escludilo dalla chiusura.
    if(!e.target.closest('#automation-menu-wrap') && !e.target.closest('#autopoll-badge')){
        const a=document.getElementById('automation-dropdown'); if(a) a.style.display='none';
    }
    if(!e.target.closest('#rack-menu-wrap')) closeRackMenu();
    if(!e.target.closest('#floor-menu-wrap')) closeFloorMenu();
});

function openUserManager(){
    document.getElementById('user-manager-overlay').classList.add('open');
    // Reset allo stato iniziale: tab Utenti, reveal token nascosto.
    _tokensLoaded = false;
    umSwitchTab('users');
    const rev = document.getElementById('tk-reveal'); if(rev) rev.classList.remove('show');
    umLoadUsers();
}

// Tab del modale "Utenti e accessi": Utenti ↔ Token API. I token si caricano
// pigramente alla prima apertura del tab (una volta per apertura del modale).
function umSwitchTab(name){
    const tabs = ['users', 'tokens', 'ai'];   // ai = scheletro (scheda Assistente)
    if(!tabs.includes(name)) name = 'users';
    for(const tn of tabs){
        const tab = document.getElementById('um-tab-' + tn);
        const pane = document.getElementById('um-pane-' + tn);
        if(tab) tab.classList.toggle('active', tn === name);
        if(pane) pane.classList.toggle('active', tn === name);
    }
    if(name === 'tokens' && !_tokensLoaded){ _tokensLoaded = true; tkLoadTokens(); }
    // Scheda Assistente AI: ricarica la config dal server a ogni apertura
    // (glue in app-ai.js, bundle → chiamata bare con guardia typeof).
    if(name === 'ai' && typeof _aiCfgLoad === 'function') _aiCfgLoad();
}

function closeUserManager(){
    document.getElementById('user-manager-overlay').classList.remove('open');
}

async function umLoadUsers(){
    const list = document.getElementById('um-user-list');
    list.innerHTML='<i class="fas fa-spinner fa-spin" style="color:var(--text-muted)"></i> Caricamento...';
    try {
        const r = await fetch('/api/auth/users');
        const users = await r.json();
        if(!users.length){ list.innerHTML=`<div style="color:var(--text-muted);font-size:.82rem">${t('pnl.sys.noUsers')}</div>`; return; }
        list.innerHTML = users.map(u=>`
            <div class="um-user-row">
                <span class="um-user-name">${escapeHTML(u.username)}
                    ${u.id===store._currentUser?.id?`<span style="font-size:9px;color:var(--text-muted)"> ${t('pnl.sys.youMarker')}</span>`:''}
                </span>
                <span class="role-badge ${u.role}">${u.role==='admin'?'Admin':'Viewer'}</span>
                <span class="um-user-date">${u.createdAt?.substring(0,10)||''}</span>
                ${u.id!==store._currentUser?.id?`
                <button class="um-btn ghost" style="padding:3px 8px;font-size:.75rem"
                    onclick="umToggleRole(${u.id},'${u.role==='admin'?'viewer':'admin'}',this)">
                    <i class="fas fa-exchange-alt"></i> ${u.role==='admin'?'-> Viewer':'-> Admin'}
                </button>
                <button class="um-btn danger" style="padding:3px 8px;font-size:.75rem"
                    onclick="umDeleteUser(${u.id},this)">
                    <i class="fas fa-trash"></i>
                </button>`:'<span style="width:100px"></span>'}
            </div>`).join('');
    } catch(_){ list.innerHTML=`<span style="color:#f85149">${t('pnl.sys.errLoadUsers')}</span>`; }
}

async function umCreateUser(){
    const user=document.getElementById('um-new-username').value.trim();
    const pwd =document.getElementById('um-new-password').value;
    const role=document.getElementById('um-new-role').value;
    const msg =document.getElementById('um-new-msg');
    msg.className='um-msg';
    if(!user||!pwd){ msg.textContent='Compila tutti i campi'; msg.className='um-msg err'; return; }
    try {
        const r=await fetch('/api/auth/users',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({username:user,password:pwd,role})});
        const d=await r.json();
        if(d.ok){
            msg.textContent=`Utente "${user}" creato con successo`; msg.className='um-msg ok';
            document.getElementById('um-new-username').value='';
            document.getElementById('um-new-password').value='';
            umLoadUsers();
        } else { msg.textContent=d.error||'Errore'; msg.className='um-msg err'; }
    } catch(_){ msg.textContent=t('pnl.sys.networkError'); msg.className='um-msg err'; }
}

async function umToggleRole(id, newRole, btn){
    btn.disabled=true;
    try {
        const r=await fetch(`/api/auth/users/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({role:newRole})});
        const d=await r.json();
        if(d.ok) umLoadUsers();
        else { alert(d.error); btn.disabled=false; }
    } catch(_){ btn.disabled=false; }
}

async function umDeleteUser(id, btn){
    if(!confirm(t('msg.ui.deleteUser'))) return;
    btn.disabled=true;
    try {
        const r=await fetch(`/api/auth/users/${id}`,{method:'DELETE'});
        const d=await r.json();
        if(d.ok) umLoadUsers();
        else { alert(d.error); btn.disabled=false; }
    } catch(_){ btn.disabled=false; }
}

function openChangePassword(){
    const ov=document.getElementById('chpwd-overlay');
    ov.style.display='flex';
    ['chpwd-old','chpwd-new','chpwd-confirm'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
    const msg=document.getElementById('chpwd-msg'); if(msg) msg.className='um-msg';
}

function closeChangePassword(){
    document.getElementById('chpwd-overlay').style.display='none';
}

async function umChangePassword(){
    const oldPwd = document.getElementById('chpwd-old').value;
    const newPwd = document.getElementById('chpwd-new').value;
    const confirm= document.getElementById('chpwd-confirm').value;
    const msg    = document.getElementById('chpwd-msg');
    msg.className='um-msg';
    if(!oldPwd||!newPwd||!confirm){ msg.textContent='Compila tutti i campi'; msg.className='um-msg err'; return; }
    if(newPwd!==confirm){ msg.textContent='Le nuove password non coincidono'; msg.className='um-msg err'; return; }
    if(newPwd.length<6){ msg.textContent='La password deve avere almeno 6 caratteri'; msg.className='um-msg err'; return; }
    try {
        const check=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({username:store._currentUser.username,password:oldPwd})});
        const cd=await check.json();
        if(!cd.ok){ msg.textContent='Password attuale non corretta'; msg.className='um-msg err'; return; }
        const r=await fetch(`/api/auth/users/${store._currentUser.id}`,{method:'PUT',
            headers:{'Content-Type':'application/json'},body:JSON.stringify({password:newPwd})});
        const d=await r.json();
        if(d.ok){ msg.textContent='Password aggiornata'; msg.className='um-msg ok'; }
        else { msg.textContent=d.error||'Errore'; msg.className='um-msg err'; }
    } catch(_){ msg.textContent=t('pnl.sys.networkError'); msg.className='um-msg err'; }
}

// ===== Token API (tab del modale "Utenti e accessi") =====

async function tkLoadTokens(){
    const list = document.getElementById('tk-list');
    if(!list) return;
    list.innerHTML='<i class="fas fa-spinner fa-spin" style="color:var(--text-muted)"></i>';
    try {
        const r = await fetch('/api/auth/tokens');
        const tokens = await r.json();
        if(!Array.isArray(tokens) || !tokens.length){
            list.innerHTML=`<div style="color:var(--text-muted);font-size:.82rem">${t('tk.none')}</div>`; return;
        }
        list.innerHTML = tokens.map(tk=>`
            <div class="tk-row">
                <i class="fas fa-key tk-key"></i>
                <div class="tk-main">
                    <div class="tk-label">${escapeHTML(tk.label)}</div>
                    <div class="tk-prefix">${escapeHTML(tk.prefix||'')}…</div>
                </div>
                <div class="tk-meta">
                    <div>${t('tk.created2')} ${tk.createdAt?escapeHTML(tk.createdAt.substring(0,10)):''}</div>
                    ${tk.lastUsedAt
                        ? `<div class="tk-used">${t('tk.lastUse')} ${escapeHTML(tk.lastUsedAt.substring(0,10))}</div>`
                        : `<div style="opacity:.7">${t('tk.never')}</div>`}
                </div>
                <button class="um-btn danger" style="padding:5px 9px;font-size:.75rem"
                    onclick="tkRevokeToken(${tk.id},this)" title="${escapeHTML(t('tk.revoke'))}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>`).join('');
    } catch(_){ list.innerHTML=`<span style="color:#f85149">${t('tk.errLoad')}</span>`; }
}

async function tkCreateToken(){
    const labelEl = document.getElementById('tk-new-label');
    const label = labelEl.value.trim();
    const msg = document.getElementById('tk-new-msg');
    msg.className='um-msg';
    if(!label){ msg.textContent=t('tk.labelRequired'); msg.className='um-msg err'; return; }
    try {
        const r = await fetch('/api/auth/tokens',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({label})});
        const d = await r.json();
        if(d && d.token){
            _lastToken = d.token;
            document.getElementById('tk-reveal-code').textContent = d.token;
            document.getElementById('tk-reveal').classList.add('show');
            const cb = document.getElementById('tk-copy-btn');
            if(cb) cb.innerHTML=`<i class="fas fa-copy"></i> ${escapeHTML(t('tk.copy'))}`;
            labelEl.value='';
            tkLoadTokens();
        } else { msg.textContent=(d&&d.error)||t('tk.errCreate'); msg.className='um-msg err'; }
    } catch(_){ msg.textContent=t('pnl.sys.networkError'); msg.className='um-msg err'; }
}

function tkCopyToken(){
    const btn = document.getElementById('tk-copy-btn');
    const done = ()=>{ if(btn){ btn.innerHTML=`<i class="fas fa-check"></i> ${escapeHTML(t('tk.copied'))}`;
        setTimeout(()=>{ btn.innerHTML=`<i class="fas fa-copy"></i> ${escapeHTML(t('tk.copy'))}`; },1500); } };
    try { const p = navigator.clipboard.writeText(_lastToken); if(p&&p.then) p.then(done,done); else done(); }
    catch(_){ done(); }
}

async function tkRevokeToken(id, btn){
    if(!confirm(t('tk.revokeConfirm'))) return;
    btn.disabled=true;
    try {
        const r = await fetch(`/api/auth/tokens/${id}`,{method:'DELETE'});
        const d = await r.json();
        if(d && d.ok) tkLoadTokens();
        else { alert((d&&d.error)||'Error'); btn.disabled=false; }
    } catch(_){ btn.disabled=false; }
}

expose({
    initAuth,
    toggleImpExpMenu, closeImpExpMenu,
    closeUserManager, umSwitchTab,
    umLoadUsers, umCreateUser, umToggleRole, umDeleteUser,
    tkLoadTokens, tkCreateToken, tkRevokeToken, tkCopyToken,
    closeChangePassword, umChangePassword,
});

// ── ASSE B (ritiro onclick inline): superfici MENU UTENTE + MENU REPORT ───────
// I toggle dei due dropdown e le voci del menu utente non sono più su window: i
// bottoni le chiamano via `data-act` (event delegation). doLogout chiude già il
// menu da sé; switchLang è importata da app.js. Le VOCI del menu report sono
// registrate ognuna nel MODULO che possiede la funzione (app-audit/spare/l3/wifi),
// importando `closeReportMenu` da qui — quel modulo è il proprietario del report.
// Il listener document di chiusura-fuori-click qui sopra resta valido (i bottoni
// data-act sono DENTRO il rispettivo #*-menu-wrap → non lo attivano).
registerClickActions({
    'user-menu-toggle':  () => toggleUserMenu(),
    'user-manager-open': () => { openUserManager(); closeUserMenu(); },
    'change-password':   () => { openChangePassword(); closeUserMenu(); },
    'lang-switch':       (el) => switchLang(el.dataset.lang),
    'logout':            () => doLogout(),
    'report-menu-toggle': () => toggleReportMenu(),
});
