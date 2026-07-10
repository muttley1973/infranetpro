// ============================================================
// SNMP / INTEGRAZIONE — poll singolo/collettivo + applyPollResult
// ============================================================
// Poll singolo (pollSNMP) e collettivo (pollAllSNMP), mapping campi SNMP->UI e
// applicazione risultati al progetto (applyPollResult). Migrato a modulo ESM
// (src/) — globali legacy via win.*, t (i18n) dal ponte.
// Manual-first: applyPollResult NON tocca mai gli override manuali
// (desc, statusOvr, speedOvr, vlanOvr, hostnameManual, lagGroup manuali).
// ============================================================
import { win, expose, t } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { nodeById, markDirty, pushHistory, renderCables, _showToast, switchRightTab, logAudit } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { showAlert } from './app-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderProps } from './app-properties.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES)
import { _driftBuildDocSnapshot, _driftComputeFromDoc } from './app-drift.js';   // presenza→grigio: ricalcolo Drift dopo il Sync

// Tipi per cui richiedere HOST-RESOURCES-MIB standard (CPU/RAM/dischi). Oltre agli
// host generici, includiamo gli apparati di rete spesso Linux-based (MikroTik,
// FortiGate, Aruba CX, OPNsense…): chi espone il MIB standard dà CPU/RAM/disco
// gratis, chi no resta semplicemente vuoto (innocuo). CPU-vendor e temperatura
// restano ai MIB del produttore (ENTITY-SENSOR/vendor → backlog).
const _HOST_RES_TYPES = ['server', 'pc', 'nas', 'homelab', 'switch', 'router', 'firewall', 'sdwan'];

function _hasSnmpIntegration(n){
    const drv=String(n?.integration?.driver||'').toLowerCase();
    return drv==='snmp-v1' || drv==='snmp-v2c' || drv==='snmp-v3';
}

// ---- Freschezza dati SNMP (chip toolbar + hint bottone Topologia) -----------
// Soglie comuni a chip e bottone, cosi' i due indicatori "raccontano" la stessa
// storia. fresh < 15m · aging < 6h · old oltre.
const _SNMP_FRESH_COLOR = { fresh:'#3fb950', aging:'#d29922', old:'#f85149', none:'#8b949e' };
function _snmpFreshness(ts){
    if(!ts) return { txt:t('snmp.fresh.never'), level:'none', color:_SNMP_FRESH_COLOR.none };
    const ms = Date.now() - ts;
    const m = Math.round(ms/60000);
    const txt = m < 1 ? t('snmp.fresh.now')
        : m < 60  ? t('snmp.fresh.min', {n:m})
        : m < 1440 ? t('snmp.fresh.h', {n:Math.round(m/60)})
        : t('snmp.fresh.d', {n:Math.round(m/1440)});
    const level = ms < 15*60000 ? 'fresh' : ms < 6*3600000 ? 'aging' : 'old';
    return { txt, level, color:_SNMP_FRESH_COLOR[level] };
}
// Timestamp dell'ultimo sync riuscito. Fallback per progetti pre-feature:
// deriva dal neighbors cache (il dato che alimenta la topologia).
function _lastSnmpSyncTs(){
    if(store.state.lastSnmpSyncAt) return store.state.lastSnmpSyncAt;
    const cache = (typeof store._topoNeighborsCache === 'object' && store._topoNeighborsCache) ? store._topoNeighborsCache : {};
    const tss = Object.values(cache).map(c => c && c.ts).filter(Boolean);
    return tss.length ? Math.max(...tss) : 0;
}
function _hasSnmpTargets(){
    return (store.state.nodes || []).some(n => {
        const cfg = n.integration || {};
        return (cfg.driver||'').startsWith('snmp') && !!((cfg.host||n.ip||'').trim());
    });
}
// Chip "● Sync Xm fa" accanto al bottone Sync: età SEMPRE visibile, color-coded.
function _renderSyncFreshness(){
    const el = document.getElementById('sync-fresh-badge');
    if(!el) return;
    if(!_hasSnmpTargets()){ el.style.display='none'; return; }   // niente SNMP → niente chip
    const f = _snmpFreshness(_lastSnmpSyncTs());
    el.style.display='inline-flex';
    // Tutt'uno col bottone Sync, diviso da un | : niente pallino né parola "Sync",
    // resta solo il tempo (color-coded per freschezza).
    el.innerHTML = `<span class="sync-fresh-sep">|</span><span style="color:${f.color}">${f.txt}</span>`;
    el.setAttribute('data-tip', f.level==='none'
        ? t('snmp.tip.never')
        : t('snmp.tip.ago', {age: f.txt}));
}

// ---- Finder "v3 da configurare" -------------------------------------------
// Stato DERIVATO (niente flag da mantenere): device con driver snmp-v3 e utente
// USM ancora vuoto = rilevato dalla discovery senza credenziali. Si azzera da sé
// appena l'utente compila l'utente nel pannello Integrazione.
function _v3NeedsCreds(n){
    const intg = n && n.integration;
    return !!intg && intg.driver === 'snmp-v3' && !String(intg.v3user || '').trim();
}
function _v3PendingNodes(){
    return (store.state.nodes || []).filter(_v3NeedsCreds);
}
// Chip-contatore accanto al Sync: quanti device v3 restano da configurare.
function _renderV3PendingChip(){
    const el = document.getElementById('v3-pending-chip');
    if(!el) return;
    const n = _v3PendingNodes().length;
    if(!n){ el.style.display = 'none'; return; }
    el.style.display = 'inline-flex';
    el.innerHTML = `<i class="fas fa-key"></i> ${n}`;
    el.setAttribute('data-tip', t('intg.v3PendingTip', { n }));
}
// Salta al prossimo device da configurare (ciclo relativo alla selezione):
// lo seleziona, lo centra e apre il pannello Proprietà sull'Integrazione.
function _v3JumpNext(){
    const pend = _v3PendingNodes();
    if(!pend.length) return;
    const cur = pend.findIndex(n => n.id === store.selId);
    const next = pend[(cur + 1) % pend.length];
    if(typeof win.selectAndFocusNode === 'function') win.selectAndFocusNode(next);
    else { store.selType = 'node'; store.selId = next.id; renderAll(); }
    if(typeof switchRightTab === 'function') switchRightTab('props');
    if(typeof renderProps === 'function') renderProps();
}

function updateIntegration(nid, key, val){
    const n=nodeById(nid); if(!n) return;
    if(!n.integration) n.integration={};
    n.integration[key]=val;
    if(key==='driver'){
        const snmpOn=_hasSnmpIntegration(n);
        if(!snmpOn){
            // Rimuove immediatamente lo stato SNMP visuale quando il driver è disattivato
            delete n.snmpStatus;
            delete n.snmpError;
            delete n.snmpLastOk;
            if(n.integration) delete n.integration.lastPoll;
        }
        renderAll();
        renderProps();
    }
    // Stacking (P7.2): se il nodo e' master di uno stack, propaga
    // l'integrazione SNMP ai membri (UN solo IP/community per stack).
    win._propagateStackMasterIntegration(n);
    markDirty();
}

// Poll dedicato UPS/ATS: legge i valori live (UPS-MIB / ATS) e li salva in
// n.powerLive (sola lettura, separati dai campi di documentazione manuali).
async function _pollPowerNode(nodeId){
    const n=nodeById(nodeId); if(!n) return;
    const cfg=n.integration||{};
    const host=(cfg.host||n.ip||'').trim();
    if(!host){ showAlert(t('msg.net.needHost')); return; }
    const btn=document.getElementById('snmp-poll-btn');
    if(btn){ btn.disabled=true; btn.className='toolbar-btn'; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Polling…'; }
    const body=JSON.stringify({
        driver: cfg.driver||'snmp-v2c', host, port: cfg.port||161, timeout: cfg.timeout||3,
        community: cfg.community||'public',
        v3user: cfg.v3user||'', v3authProto: cfg.v3authProto||'SHA', v3authPass: cfg.v3authPass||'',
        v3privProto: cfg.v3privProto||'AES', v3privPass: cfg.v3privPass||'', v3secLevel: cfg.v3secLevel||'authPriv',
        v3context: cfg.v3context||'',
        kind: n.type==='ats'?'ats':'ups'
    });
    const _reset=()=>{ if(btn){ btn.className='toolbar-btn primary'; btn.innerHTML=`<i class="fas fa-network-wired"></i> ${(typeof t==='function'?t('snmp.import'):'Importa SNMP')}`; } };
    try{
        const r=await fetch('/api/poll-power',{method:'POST',headers:{'Content-Type':'application/json'},body});
        const data=await r.json();
        if(data.ok && data.live){
            n.powerLive=data.live; n.powerLiveAt=new Date().toISOString();
            n.snmpStatus='ok'; n.snmpLastOk=n.powerLiveAt;
            markDirty(); renderAll(); renderProps();
            if(btn){ btn.disabled=false; btn.className='toolbar-btn poll-btn-ok'; btn.innerHTML=`<i class="fas fa-check"></i> ${(typeof t==='function'?t('snmp.imported'):'Importato')}`; }
            setTimeout(()=>{ if(btn&&!btn.disabled) _reset(); },3000);
        } else {
            n.snmpStatus='err'; markDirty(); renderProps();
            showAlert(t('msg.net.errSnmp')+(data.error||t('msg.net.errUnknown')));
            if(btn){ btn.disabled=false; btn.className='toolbar-btn poll-btn-err'; btn.innerHTML='<i class="fas fa-exclamation-triangle"></i> Errore'; }
            setTimeout(_reset,3000);
        }
    }catch(e){
        n.snmpStatus='err'; markDirty(); renderProps();
        showAlert(t('msg.net.errConn')+e.message);
        if(btn){ btn.disabled=false; _reset(); }
    }
}

async function pollSNMP(nodeId){
    const n=nodeById(nodeId); if(!n) return;
    // UPS/ATS: percorso power dedicato (valori live UPS-MIB / ATS).
    if(n.type==='ups' || n.type==='ats'){ return _pollPowerNode(nodeId); }
    const cfg=n.integration||{};
    const host=(cfg.host||n.ip||'').trim();
    if(!host){ showAlert(t('msg.net.needHost')); return; }
    const btn=document.getElementById('snmp-poll-btn');
    if(btn){ btn.disabled=true; btn.className='toolbar-btn'; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Polling…'; }
    const body=JSON.stringify({
        driver:   cfg.driver   ||'snmp-v2c',
        host, port: cfg.port||161, timeout: cfg.timeout||3,
        community:  cfg.community ||'public',
        v3user:     cfg.v3user    ||'',
        v3authProto:cfg.v3authProto||'SHA',
        v3authPass: cfg.v3authPass ||'',
        v3privProto:cfg.v3privProto||'AES',
        v3privPass: cfg.v3privPass ||'',
        v3secLevel: cfg.v3secLevel ||'authPriv',
        v3context:  cfg.v3context  ||'',
        // Stampante: il driver legge il Printer-MIB in isolamento (vedi poll()).
        printer:    n.type==='printer',
        // Compute: HOST-RESOURCES (CPU/RAM/dischi) in passaggio supplementare.
        hostResources: _HOST_RES_TYPES.includes(n.type)
    });
    try{
        const r=await fetch('/api/poll',{method:'POST',headers:{'Content-Type':'application/json'},body});
        const data=await r.json();
        applyPollResult(nodeId, data); // aggiorna snmpStatus sempre (ok o err)
        if(data.ok){
            if(btn){ btn.disabled=false; btn.className='toolbar-btn poll-btn-ok';
                     btn.innerHTML=`<i class="fas fa-check"></i> ${(typeof t==='function'?t('snmp.imported'):'Importato')}`; }
            setTimeout(()=>{ if(btn&&!btn.disabled){ btn.className='toolbar-btn primary';
                btn.innerHTML=`<i class="fas fa-network-wired"></i> ${(typeof t==='function'?t('snmp.import'):'Importa SNMP')}`; } },3000);
            // Auto-link discovery dopo import singolo
            const _ld=await win._autoDiscoverLinks([nodeId]);
            if(_ld.created>0 || _ld.updated>0 || _ld.lagGroups>0 || _ld.pruned>0){
                renderAll(); renderCables();
                if(_ld.created>0){
                    const ps=_ld.protocols?.size>0?[..._ld.protocols].join('/'):'auto';
                    const dx = win._autoLinkDiagText(_ld.diag);
                    _showToast(t('msg.net.autoLinkCreated',{n:_ld.created,proto:ps})+(dx?' - '+dx:''),'ok',6500);
                } else if(_ld.pruned>0){
                    _showToast(t('msg.net.linkPruned',{n:_ld.pruned}),'ok',3500);
                }
            } else if(Array.isArray(_ld.diag?.reasons) && _ld.diag.reasons.length){
                _showToast(t('msg.net.noAutoLink')+win._autoLinkDiagText(_ld.diag),'warn',6500);
            } else {
                const dx = win._autoLinkDiagText(_ld.diag);
                if(dx) _showToast(t('msg.net.autoLinkPrefix')+dx,'warn',6500);
            }
        } else {
            showAlert(t('msg.net.errSnmp')+(data.error||t('msg.net.errUnknown')));
            if(btn){ btn.disabled=false; btn.className='toolbar-btn poll-btn-err';
                     btn.innerHTML='<i class="fas fa-exclamation-triangle"></i> Errore'; }
            setTimeout(()=>{ if(btn){ btn.className='toolbar-btn primary';
                btn.innerHTML=`<i class="fas fa-network-wired"></i> ${(typeof t==='function'?t('snmp.import'):'Importa SNMP')}`; } },3000);
        }
    }catch(e){
        // Errore di rete (fetch fallita) — aggiorna comunque lo stato
        applyPollResult(nodeId, {ok:false, error:e.message}, {noHistory:true});
        showAlert(t('msg.net.errConn')+e.message);
        if(btn){ btn.disabled=false; btn.className='toolbar-btn primary';
                 btn.innerHTML=`<i class="fas fa-network-wired"></i> ${(typeof t==='function'?t('snmp.import'):'Importa SNMP')}`; }
    }
}

// opts.dataOnly: poll dei SOLI dati SNMP (porte/VLAN/stato/toner/CPU/UPS) SENZA
// auto-link topologia. Lo usa il polling automatico (proprietà floor): refresh
// leggero in background, niente scoperta cavi (quella resta sul bottone Sync /
// Topologia, che fanno l'auto-link "al volo").
async function pollAllSNMP(opts){
    if(win._snmpSyncing) return;
    const dataOnly = !!(opts && opts.dataOnly);
    // Raccoglie SOLO i nodi con driver SNMP (snmp-v1/v2c/v3) e host/IP configurato:
    // niente poll su device senza integrazione SNMP.
    const targets=store.state.nodes.filter(n=>{
        const cfg=n.integration||{};
        if(!(cfg.driver||'').startsWith('snmp')) return false;
        return !!((cfg.host||n.ip||'').trim());
    });
    if(!targets.length){
        showAlert(t('msg.net.noSnmpDevicesPanel'));
        return;
    }

    win._snmpSyncing=true;
    const syncBtn=document.getElementById('btn-snmp-sync');
    // L'etichetta vive in uno span interno: gli stati transitori del sync
    // aggiornano SOLO questo, cosi' il timer (#sync-fresh-badge, anch'esso dentro
    // il bottone) sopravvive. Durante il sync il timer e' nascosto.
    const syncLbl=document.getElementById('snmp-sync-label')||syncBtn;
    const syncBadge=document.getElementById('sync-fresh-badge');
    if(syncBadge) syncBadge.style.display='none';
    const saveBtn=document.getElementById('btn-save');
    if(saveBtn){ saveBtn.disabled=true; }

    // try/finally: qualunque errore imprevisto nella raccolta o nell'auto-link NON
    // deve lasciare il Sync "appeso". Prima, un throw dopo win._snmpSyncing=true
    // lasciava il flag a true (ogni Sync successivo usciva subito) e il bottone
    // bloccato su "Topology...". Il ripristino stato vive ora nel finally.
    try{
    pushHistory(); // un solo punto di undo per tutto il sync

    // Snapshot del DOCUMENTATO prima del poll (i campi base verranno sovrascritti):
    // serve a ricalcolare la PRESENZA dopo il Sync → i device assenti si ingrigiscono
    // (.node-absent) anche dal Sync, non solo da Verifica doc. Solo su Sync pieno.
    const _presenceDoc = !dataOnly ? _driftBuildDocSnapshot() : null;

    let ok=0, err=0;
    const total=targets.length;

    // Helper: interroga un singolo nodo SNMP e applica il risultato
    const _pollOne = async n => {
        const cfg=n.integration||{};
        const host=(cfg.host||n.ip||'').trim();
        const body=JSON.stringify({
            driver:      cfg.driver      ||'snmp-v2c',
            host, port:  cfg.port        ||161,
            timeout:     cfg.timeout     ||3,
            community:   cfg.community   ||'public',
            v3user:      cfg.v3user      ||'',
            v3authProto: cfg.v3authProto ||'SHA',
            v3authPass:  cfg.v3authPass  ||'',
            v3privProto: cfg.v3privProto ||'AES',
            v3privPass:  cfg.v3privPass  ||'',
            v3secLevel:  cfg.v3secLevel  ||'authPriv',
            v3context:   cfg.v3context   ||'',
            printer:     n.type==='printer',
            hostResources: _HOST_RES_TYPES.includes(n.type)
        });
        // UPS/ATS: niente walk interfacce, ma valori live via UPS-MIB / ATS.
        if(n.type==='ups' || n.type==='ats'){
            try{
                const pr=await fetch('/api/poll-power',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(body), kind:n.type==='ats'?'ats':'ups'})});
                const pd=await pr.json();
                if(pd.ok && pd.live){ n.powerLive=pd.live; n.powerLiveAt=new Date().toISOString(); n.snmpStatus='ok'; n.snmpLastOk=n.powerLiveAt; ok++; }
                else{ err++; n.snmpStatus='err'; console.warn(`[SNMP Sync] ${n.name||n.id}: ${pd.error||'no live'}`); }
            }catch(e){ err++; n.snmpStatus='err'; console.warn(`[SNMP Sync] ${n.name||n.id}: ${e.message}`); }
            return;
        }
        try{
            const r=await fetch('/api/poll',{method:'POST',headers:{'Content-Type':'application/json'},body});
            const data=await r.json();
            applyPollResult(n.id, data, {noHistory:true, noRender:true});
            if(data.ok){ ok++; } else{ err++; console.warn(`[SNMP Sync] ${n.name||n.id}: ${data.error}`); }
        }catch(e){
            err++;
            applyPollResult(n.id, {ok:false, error:e.message}, {noHistory:true, noRender:true});
            console.warn(`[SNMP Sync] ${n.name||n.id}: ${e.message}`);
        }
    };

    // Polling parallelo a blocchi di 5: riduce i tempi da O(n×timeout) a O(ceil(n/5)×timeout)
    const BATCH=5;
    for(let b=0;b<total;b+=BATCH){
        const slice=targets.slice(b, b+BATCH);
        const bEnd=Math.min(b+BATCH, total);
        if(syncLbl) syncLbl.innerHTML=`<i class="fas fa-spinner fa-spin"></i> Sync ${b+1}–${bEnd}/${total}…`;
        await Promise.all(slice.map(_pollOne));
    }

    // Render unico al termine del polling
    renderAll(); renderCables(); renderProps();

    // ---- Auto-link discovery: LLDP / CDP / MAC FDB -------------------------
    // Saltato in dataOnly (polling automatico): solo refresh dati, niente topologia.
    if(ok > 0 && !dataOnly){
        if(syncLbl) syncLbl.innerHTML=`<i class="fas fa-spinner fa-spin"></i> Topology…`;
        const _ld = await win._autoDiscoverLinks(null);
        if(_ld.created>0 || _ld.updated>0 || _ld.lagGroups>0 || _ld.pruned>0){
            renderAll(); renderCables();
            if(_ld.created>0){
                const protoSet=_ld.protocols?.size>0?[..._ld.protocols].join('/'):'auto';
                const dx = win._autoLinkDiagText(_ld.diag);
                _showToast(t('msg.net.autoLinkCreated',{n:_ld.created,proto:protoSet})+(dx?' - '+dx:''),'ok',6500);
            } else if(_ld.pruned>0){
                _showToast(t('msg.net.linkPruned',{n:_ld.pruned}),'ok',3500);
            }
        } else if(Array.isArray(_ld.diag?.reasons) && _ld.diag.reasons.length){
            _showToast(t('msg.net.noAutoLink')+win._autoLinkDiagText(_ld.diag),'warn',6500);
        } else {
            const dx = win._autoLinkDiagText(_ld.diag);
            if(dx) _showToast(t('msg.net.autoLinkPrefix')+dx,'warn',6500);
        }
    }

    // Presenza → grigio: ricalcola il Drift (SENZA sweep di raggiungibilità) coi dati
    // appena raccolti (SNMP risposto + FDB/ARP dall'auto-link). NON apre report né chip:
    // serve solo a far ingrigire i device assenti (.node-absent) anche dopo un Sync.
    // Deferito (off critical-path) + render per applicare il grigio. La guardia
    // observability in buildDriftReport evita falsi "assenti" se manca l'FDB.
    if(_presenceDoc){
        setTimeout(()=>{ try{ _driftComputeFromDoc(_presenceDoc); renderAll(); }catch(_){} }, 0);
    }

    logAudit('snmp-sync', {
        target: (typeof t==='function') ? t('audit.snmpDevices',{ok,total}) : `${ok}/${total} dispositivi`,
        summary: err ? ((typeof t==='function') ? t('audit.snmpErrors',{n:err}) : `${err} in errore`)
                     : ((typeof t==='function') ? t('audit.snmpAllOk') : 'tutti raggiungibili')
    });

    if(syncBtn){
        if(err===0){
            syncBtn.className='toolbar-btn poll-btn-ok';
            syncLbl.innerHTML=`<i class="fas fa-check"></i> Sync OK ${ok}/${total}`;
        } else {
            syncBtn.className='toolbar-btn poll-btn-err';
            syncLbl.innerHTML=`<i class="fas fa-exclamation-triangle"></i> Sync ${ok}/${total} (${err} err)`;
        }
        setTimeout(()=>{
            syncBtn.className='toolbar-btn';
            syncLbl.innerHTML=`<i class="fas fa-network-wired"></i> Sync`;
            // Ripristina il timer dentro il bottone (ora "adesso").
            if(typeof _renderSyncFreshness === 'function') _renderSyncFreshness();
        }, 4000);
    }
    } finally {
        // Ripristino stato SEMPRE eseguito (successo o errore): sblocca il flag di
        // sync, riabilita il salvataggio e riallinea il bottone Topologia.
        win._snmpSyncing=false;
        if(saveBtn){ saveBtn.disabled=false; }
        // Aggiorna stato pulsante Topologia: la cache neighbors e' ora fresca
        // (se almeno un device ha risposto), quindi il bottone diventa cliccabile.
        if(typeof win._refreshTopoBtnState === 'function') win._refreshTopoBtnState();
    }
}

// VLAN, auto-poll e link mode estratti in lib/app-vlan-autopoll.js

// Discovery classification (OUI vendor, _disc*, _guessType): lib/app-discovery-classify.js (R2)

// VLAN propagateVlans/_effPortVlan estratti in lib/app-vlan-autopoll.js

function _snmpOperToUiStatus(v, prev){
    const n = Number(v);
    if(n === 1) return 'active';
    if(n === 2) return 'inactive';
    if(n === 3 || n === 4 || n === 5) return 'idle';
    if(n === 6 || n === 7) return 'fault';
    return prev ?? 'inactive';
}
function _snmpSpeedToUi(v, prev){
    const n = Number(v);
    if(Number.isFinite(n) && n >= 0) return n;
    return prev ?? 0;
}
function _snmpVlanToUi(v, prev){
    const n = Number(v);
    // Manual-first: una lettura SNMP di VLAN 1 (default/native, o VLAN access NON
    // leggibile via SNMP su certe immagini — es. Cisco vIOS senza dot1qPvid ne' vmVlan)
    // NON deve sovrascrivere una VLAN documentata a mano non-default. Una VLAN reale >1
    // letta da SNMP vince invece sempre (aggiorna il documento). Vale su QUALSIASI vendor.
    if(n === 1 && Number.isFinite(prev) && prev > 1) return prev;
    if(Number.isFinite(n) && n > 0) return n;
    return prev ?? 1;
}
function _snmpNameToUi(v, prev){
    const s = String(v || '').trim();
    return s || prev || '';
}
function _snmpAliasToUi(v, prev){
    const s = String(v || '').trim();
    return s || prev || '';
}
function _snmpLagToUi(v, prev){
    const n = Number(v);
    if(Number.isFinite(n) && n >= 0) return n;
    return prev ?? 0;
}
function _snmpMacToUi(v, prev){
    const s = String(v || '').trim();
    return s || prev || '';
}
function _applySnmpBasePortFields(pid, iface){
    const p = store.state.ports[pid] || (store.state.ports[pid] = {});
    p.status = _snmpOperToUiStatus(iface.operStatus, p.status);
    p.vlan   = _snmpVlanToUi(iface.vlan, p.vlan);
    p.speed  = _snmpSpeedToUi(iface.speed, p.speed);
    p.ifName = _snmpNameToUi(iface.name, p.ifName);
    p.alias  = _snmpAliasToUi(iface.alias, p.alias);
    p.lagId  = _snmpLagToUi(iface.lagId, p.lagId);
    p.lagIfIndex = _snmpLagToUi(iface.lagIfIndex, p.lagIfIndex);
    const mac = _snmpMacToUi(iface.mac, p.mac);
    if(mac) p.mac = mac;
    if(iface.isTrunk !== undefined){
        p.isTrunk = iface.isTrunk;
        p.trunkVlans = iface.trunkVlans || [];
    }
}

function applyPollResult(nodeId, data, opts={}){
    const n=nodeById(nodeId); if(!n) return;
    if(!opts.noHistory) pushHistory();
    // Hostname: aggiorna solo se l'utente non ha impostato un valore manuale.
    if(data.hostname && data.hostname.trim() && !n.hostnameManual) n.hostname=data.hostname.trim();
    const inv = data.inventory || null;
    if(inv && typeof inv === 'object'){
        const defBrand = TYPES[n.type]?.brand || '';
        const canFillBrand = !String(n.brand || '').trim() || String(n.brand || '').trim() === defBrand;
        if(inv.brand && canFillBrand) n.brand = inv.brand;
        if(inv.model && !String(n.model || '').trim()) n.model = inv.model;
        if(inv.serialNumber && !String(n.serialNumber || '').trim()) n.serialNumber = inv.serialNumber;
        if(inv.firmwareVer && !String(n.firmwareVer || '').trim()) n.firmwareVer = inv.firmwareVer;
    }
    // --- Mappatura interfaccia SNMP -> porta del nodo (MANUAL-FIRST) -----------
    // Storicamente POSIZIONALE (idx -> `${nodeId}-${idx+1}`). Se il layout delle
    // porte e' stato documentato A MANO con un ordine != ifIndex reale del device,
    // la sync riscriveva gli attributi sulle porte sbagliate: un cavo verso un
    // endpoint (PC/server) finiva su una porta trunk/LAG. Ora:
    //   1) match per ifName quando la porta esiste gia' con quel nome -> ri-sync
    //      stabile e corretto (richiede ifIndex stabili: `snmp-server ifindex persist`);
    //   2) una porta cablata A MANO e SENZA ifName pregresso NON viene riscritta
    //      posizionalmente -> si preserva la topologia manuale (l'SNMP arricchisce
    //      solo le porte libere). Il flusso discovery-first (porte con ifName + cavi
    //      auto) resta invariato: match per ifName, nessuna porta "protetta".
    const _normIf = s => String(s || '').trim().toLowerCase();
    const _ifPidMap = {};
    const _manualPids = new Set();
    for(const pid of Object.keys(store.state.ports)){
        if(pid.slice(0, pid.lastIndexOf('-')) !== nodeId) continue;
        const k = _normIf(store.state.ports[pid].ifName);
        if(k && !_ifPidMap[k]) _ifPidMap[k] = pid;
    }
    for(const l of (store.state.links || [])){
        if(!l || l.autoLinked) continue;
        if(l.src && l.src.slice(0, l.src.lastIndexOf('-')) === nodeId) _manualPids.add(l.src);
        if(l.dst && l.dst.slice(0, l.dst.lastIndexOf('-')) === nodeId) _manualPids.add(l.dst);
    }
    const _pidByIdx = [], _skipByIdx = [], _portConflicts = [];
    (data.interfaces || []).forEach((iface, idx) => {
        const k = _normIf(iface.name);
        const byIf = k && _ifPidMap[k];
        const pid = byIf || `${nodeId}-${idx+1}`;
        _pidByIdx[idx] = pid;
        // Salta SOLO una porta posizionale cablata a mano e senza ifName pregresso.
        const skip = !byIf && _manualPids.has(pid) && !(store.state.ports[pid] && store.state.ports[pid].ifName);
        _skipByIdx[idx] = skip;
        // Conflitto REALE da segnalare (non silenziare!): la porta cablata a mano viene
        // preservata, ma l'interfaccia SNMP che le corrisponderebbe risulta membro
        // trunk/LAG -> "realta' != documento" (cavo spostato? porta riconfigurata?).
        // MA solo se il DOCUMENTO dice access: se la porta manuale e' GIA' trunk/LAG e
        // l'SNMP conferma trunk/LAG, documento e realta' concordano -> nessun conflitto
        // (niente falsi allarmi sui membri LAG manuali che collidono posizionalmente con
        // un'interfaccia trunk). Scatta solo sul vero mismatch endpoint-access-vs-trunk.
        const _mp = store.state.ports[pid] || {};
        const _docTrunkLag = !!_mp.isTrunk || !!_mp.lagGroup || (parseInt(_mp.lagId || 0, 10) > 0);
        if(skip && (iface.isTrunk || (iface.lagId || 0) > 0) && !_docTrunkLag){
            _portConflicts.push({ pid, ifName: String(iface.name || ''), trunk: !!iface.isTrunk, lagId: iface.lagId || 0 });
        }
    });

    if(data.interfaces && data.interfaces.length>0) n.ports = Math.max(n.ports || 0, data.interfaces.length);
    (data.interfaces||[]).forEach((iface,idx)=>{
        if(_skipByIdx[idx]) return; // porta manuale preservata (manual-first)
        const pid = _pidByIdx[idx];
        if(!store.state.ports[pid]) store.state.ports[pid]={};
        // Aggiorna i campi SNMP senza azzerare valori validi precedenti
        // quando una risposta parziale non include tutti gli OID.
        _applySnmpBasePortFields(pid, iface);
        if(iface.snmpMedium) store.state.ports[pid].snmpMedium = iface.snmpMedium;
        if(iface.snmpPoe != null) store.state.ports[pid].snmpPoe = iface.snmpPoe;
        // NON toccare: desc, statusOvr, speedOvr, vlanOvr, hidden (override manuali)
    });
    // Auto-deriva lagGroup da lagId SNMP — tutte le porte dello stesso aggregatore
    // ricevono lo stesso identificatore di gruppo → LED blu + visualizzazione LAG in props.
    // Non sovrascrive lagGroup impostati manualmente su porte che l'SNMP NON ha marcato come LAG.
    const _snmpLagMap = {};
    const _lagNameById = {};
    for(const lag of (data.lags||[])){
        const logical = _snmpLagToUi(lag.lagId || lag.index, 0);
        if(logical > 0 && lag.name) _lagNameById[logical] = lag.name;
        if(lag.index > 0 && lag.name) _lagNameById[lag.index] = lag.name;
    }
    (data.interfaces||[]).forEach((iface,idx)=>{
        if(_skipByIdx[idx]) return; // porta manuale preservata: mai in snmp-lag
        const pid = _pidByIdx[idx];
        const lid = iface.lagId||0;
        if(lid > 0){
            if(!_snmpLagMap[lid]) _snmpLagMap[lid] = `snmp-lag-${nodeId}-${lid}`;
            if(!store.state.ports[pid]) store.state.ports[pid]={};
            store.state.ports[pid].lagGroup = _snmpLagMap[lid];
            if(_lagNameById[lid]){
                if(!store.state.lagGroups) store.state.lagGroups={};
                store.state.lagGroups[_snmpLagMap[lid]] = _lagNameById[lid];
            }
        } else if(store.state.ports[pid]?.lagGroup?.startsWith('snmp-lag-')){
            // SNMP dice che questa porta non è più in LAG → rimuovi il gruppo auto
            delete store.state.ports[pid].lagGroup;
        }
    });
    // Auto-registra le VLAN SNMP nella palette colori:
    // 1) PVID di ogni interfaccia (access VLAN)
    (data.interfaces||[]).forEach(iface=>win._ensureVlanColor(parseInt(iface.vlan)||1));
    // 2) Tutte le VLAN definite nello switch (trunk-only, appena create, bitmap anche vuota)
    (data.vlans||[]).forEach(vid=>win._ensureVlanColor(vid));
    if(!n.integration) n.integration={};
    n.integration.lags     = data.lags||[];
    n.integration.vlans    = data.vlans||[];   // tutte le VLAN definite (da dot1qVlanStaticName)
    n.integration.inventory = inv || null;
    // Info di sistema live (sysLocation/sysContact/sysUpTime/sysDescr): SOLA
    // LETTURA, mostrate nel pannello Integrazione. Non toccano alcun campo
    // manuale (manual-first, D5) — sono dati "vivi" come powerLive/snmpStatus.
    n.integration.system   = (data.system && typeof data.system === 'object') ? data.system : null;
    // Stato stampante live (Printer-MIB: toner/inchiostro %, contapagine, stato):
    // stessa logica sola-lettura del system. Popolato solo per le stampanti.
    n.integration.printer  = (data.printer && typeof data.printer === 'object') ? data.printer : null;
    // Risorse host live (HOST-RESOURCES: CPU/RAM/dischi) per server/pc/nas/homelab.
    n.integration.hostResources = (data.hostResources && typeof data.hostResources === 'object') ? data.hostResources : null;
    n.integration.lastPoll = new Date().toISOString();
    // Auto-nome gruppi snmp-lag dall'aggregatore (es. "Port-channel1", "bond0", "LAG1")
    if(!store.state.lagGroups) store.state.lagGroups={};
    if(!store.state.lagModes) store.state.lagModes={};
    for(const lag of (data.lags||[])){
        const logical = _snmpLagToUi(lag.lagId || lag.index, lag.index);
        const gid = _snmpLagMap[logical] || _snmpLagMap[lag.index];
        if(gid && lag.name && !store.state.lagGroups[gid]){
            store.state.lagGroups[gid] = lag.name;
        }
        // Modalita LACP auto-derivata dall'SNMP (active/passive dall'ActorState).
        // MANUAL-FIRST: riempie SOLO se l'utente non l'ha gia impostata a mano
        // (come il nome del gruppo qui sopra). Lo statico non arriva mai dall'SNMP
        // (derivazione conservativa nel driver) → resta scelta manuale.
        if(gid && (lag.mode==='active'||lag.mode==='passive') && !store.state.lagModes[gid]){
            store.state.lagModes[gid] = lag.mode;
        }
    }
    n.snmpStatus = data.ok === false ? 'err' : 'ok';
    if(n.snmpStatus === 'ok'){
        n.snmpLastOk = n.integration.lastPoll;
        // Freschezza globale dei dati SNMP: timestamp dell'ultimo poll riuscito
        // (qualsiasi device/via — singolo, sync, drift). Persistito col progetto
        // → il chip toolbar resta veritiero anche dopo riapertura.
        store.state.lastSnmpSyncAt = Date.now();
    }
    if(n.snmpStatus === 'err') n.snmpError  = data.error || t('pnl.sys.unknownError');
    else delete n.snmpError;
    // Riconciliazione porte (manual-first): porte cablate a mano che l'SNMP vede
    // come trunk/LAG -> avviso sul nodo (banner pannello). Aggiorna solo su poll
    // riuscito, cosi' un fail non alza/abbassa il segnale a sproposito.
    if(data.ok !== false){
        if(_portConflicts.length) n.portReconcileConflicts = _portConflicts;
        else delete n.portReconcileConflicts;
    }
    // Stacking auto-detection (P7.3): se il device e' stackEligible (switch) e
    // non gia' in stack, analizza i pattern ifDescr/ifName cercando il pattern
    // `<M>/<S>/<P>` con M>=1 su >=2 valori distinti — indicatore tipico di
    // Cisco StackWise / Aruba VSF / Juniper VC / Arista 7300+. Se rilevato,
    // imposta n.stackDetectionHint (consumato dal banner UI in proprieta).
    if(TYPES[n.type]?.stackEligible && !win.isInStack(n) && data.ok !== false){
        const names = (data.interfaces || [])
            .map(i => i?.ifDescr || i?.ifName)
            .filter(s => typeof s === 'string' && s.trim());
        const hint = win.detectStackFromInterfaces(names);
        if(hint.stackDetected){
            n.stackDetectionHint = {
                memberIds: hint.memberIds,
                sampleNames: hint.sampleNames,
                suggestedFormat: hint.suggestedFormat,
                detectedAt: new Date().toISOString(),
            };
        } else if(n.stackDetectionHint){
            // Detection precedente non piu' valida (es. utente ha rimosso device)
            delete n.stackDetectionHint;
        }
    }
    markDirty();
    if(!opts.noRender){ renderAll(); renderCables(); renderProps(); }
}

expose({
    _hasSnmpIntegration, _snmpFreshness, _lastSnmpSyncTs, _hasSnmpTargets,
    _renderSyncFreshness, _renderV3PendingChip, _v3JumpNext, _v3NeedsCreds, _v3PendingNodes,
    updateIntegration, _pollPowerNode, pollSNMP, pollAllSNMP,
    _snmpOperToUiStatus, _snmpSpeedToUi, _snmpVlanToUi, _snmpNameToUi, _snmpAliasToUi,
    _snmpLagToUi, _snmpMacToUi, _applySnmpBasePortFields, applyPollResult,
});
