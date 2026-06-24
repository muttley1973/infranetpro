// ============================================================
// AUTH FRONTEND
// Utente corrente, menu account, gestione utenti e cambio password.
// Estratto da app.js come secondo passo di modularizzazione.
// Migrato a modulo ESM (src/).
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML } from './app-util.js';

// Stato condiviso: letto BARE da file ancora-legacy (app-core.js apiFetch,
// app.js _auditActor, export.js) → deve vivere su window, non module-local.
store._currentUser = store._currentUser || null; // { id, username, role }

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
function closeReportMenu(){
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
    if(!e.target.closest('#rack-menu-wrap')) win.closeRackMenu();
    if(!e.target.closest('#floor-menu-wrap')) win.closeFloorMenu();
});

function openUserManager(){
    document.getElementById('user-manager-overlay').classList.add('open');
    umLoadUsers();
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

expose({
    initAuth, doLogout,
    toggleUserMenu, closeUserMenu,
    toggleImpExpMenu, closeImpExpMenu,
    toggleReportMenu, closeReportMenu,
    openUserManager, closeUserManager,
    umLoadUsers, umCreateUser, umToggleRole, umDeleteUser,
    openChangePassword, closeChangePassword, umChangePassword,
});
