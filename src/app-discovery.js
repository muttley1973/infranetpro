import { win, expose } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, uid, normalizeMacAddress } from './app-util.js';
import { markDirty, pushHistory, renderCables, _showToast } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES, typeName } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES) + nome localizzato

// ============================================================
// DISCOVERY FRONTEND
// UI discovery, rendering risultati, crawl topology e import.
// Estratto da app.js lasciando in app.js gli helper condivisi
// con altre aree, come win._guessType.
// ============================================================

// i18n con fallback letterale. Legge win.t dal ponte (NON importa `t`: c'è un
// `const t` LOCALE in _discRenderTable che lo shadowa — vedi LEZIONE app-topology-crawl).
// _dt() resta chiamabile ovunque, anche nelle funzioni con shadowing.
function _dt(key, fallback, vars){ return (typeof win.t === 'function') ? win.t(key, vars) : fallback; }

// Nome localizzato del tipo device: punto unico in app-types.js (`typeName`).

function openDiscovery(){
    // Il driver resta su 'auto' (rilevamento unificato v2c + v3): NON lo
    // sovrascriviamo col driver di un device esistente, altrimenti un solo
    // device v2c già in mappa disabiliterebbe il rilevamento v3. Prefilliamo
    // solo la community (usata dal tentativo v2c).
    const sample = store.state.nodes.find(n=>n.integration?.driver?.startsWith('snmp'));
    if(sample && sample.integration.community){
        document.getElementById('disc-community').value = sample.integration.community;
    }
    const rack = store.state.racks.find(r=>r.id===store.state.currentRack);
    document.getElementById('disc-rack-name').textContent = rack?.name || _dt('pnl.disc.noRackSelected','(nessun rack selezionato)');
    document.getElementById('disc-progress').innerHTML='';
    document.getElementById('disc-results').style.display='none';
    document.getElementById('disc-scan-btn').style.display='';
    const deepOpt = document.getElementById('disc-deep-scan');
    if(deepOpt) deepOpt.checked = win._loadDeepScanPref();
    const ibtn = document.getElementById('disc-import-btn');
    if(ibtn) ibtn.disabled = true;
    store._discResults=[];
    win._discSelMap={};
    win._discTypeMap={};
    win._discRunning=false;
    win._discImporting=false;
    document.getElementById('disc-overlay').classList.add('open');
}

function closeDiscovery(){
    document.getElementById('disc-overlay').classList.remove('open');
    if(window._discScanAbort){ window._discScanAbort.abort(); window._discScanAbort=null; }
    if(window._discCrawlAbort){ window._discCrawlAbort.abort(); window._discCrawlAbort=null; }
    win._discRunning = false;
    win._discImporting = false;
}

// Wrapper chiamato dal click sull'overlay scuro (sfondo del modal).
// Se c'e' una scansione/import in corso, NON chiude e non aborta nulla:
// l'utente puo' aver cliccato fuori per sbaglio. Per interrompere
// esplicitamente serve usare il bottone "Annulla" o la X.
function _closeDiscoveryOverlayClick(){
    if(win._discRunning || win._discImporting){
        if(typeof win._showToast === 'function'){
            _showToast(_dt('msg.ui.scanInProgress','Scansione in corso. Usa "Annulla" per interrompere.'), 'warn', 3500);
        }
        return;
    }
    closeDiscovery();
}

async function runDiscovery(){
    if(win._discRunning) return;
    const subnet  = document.getElementById('disc-subnet').value.trim();
    // Scan universale: il motore prova v1/v2c/v3 e tiene chi risponde (i v3 senza
    // credenziali vengono rilevati e marcati "da configurare"). Niente selettore
    // versione nel dialogo: solo community (per v1/v2c) e timeout.
    const driver  = 'auto';
    const community = document.getElementById('disc-community').value.trim();
    const timeout = parseInt(document.getElementById('disc-timeout').value)||2;
    const safeMode = !!document.getElementById('disc-safe-mode')?.checked;
    const deepScan = !!document.getElementById('disc-deep-scan')?.checked;
    win._saveDeepScanPref(deepScan);
    const expandTopology = !!document.getElementById('disc-expand-topology')?.checked;
    if(!subnet){ document.getElementById('disc-progress').innerHTML=`<span class="tm-err">${_dt('disc.enterRange','Inserisci un range di rete.')}</span>`; return; }

    const btn = document.getElementById('disc-scan-btn');
    btn.disabled=true; btn.innerHTML=`<i class="fas fa-spinner fa-spin"></i> ${_dt('disc.scanning','Scansione…')}`;
    document.getElementById('disc-progress').innerHTML=_dt('pnl.disc.scanInProgress','Scansione in corso...');
    document.getElementById('disc-results').style.display='none';
    const ibtn = document.getElementById('disc-import-btn');
    if(ibtn) ibtn.disabled = true;
    win._discRunning = true;
    win._discSelMap = {};
    win._discTypeMap = {};

    let scanTimeout=null;
    try{
        const scanAbort = new AbortController();
        window._discScanAbort = scanAbort;
        scanTimeout = setTimeout(()=>scanAbort.abort(), deepScan ? 180000 : 90000);
        const r = await fetch('/api/discover',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ subnet, driver, community, timeout, safeMode, deepScan }),
            signal:scanAbort.signal});
        clearTimeout(scanTimeout);
        window._discScanAbort = null;
        const data = await r.json();
        if(!data.ok){ document.getElementById('disc-progress').innerHTML=`<span class="tm-err">${_dt('disc.error','Errore')}: ${escapeHTML(data.error)}</span>`; return; }

        store._discResults = (data.results || []).map(_discEnsureMeta);
        const found1 = store._discResults.filter(d=>d.alive).length;

        _discRenderTable();
        const baseSummary = _discSummaryHtml(store._discResults);
        if(found1===0){
            document.getElementById('disc-progress').innerHTML =
                `<span class="tm-err">${_dt('disc.noHostsOn','Nessun host marcato On. Controlla firewall/ICMP o abilita SNMP/HTTP sui dispositivi.')}</span>` + baseSummary;
            return;
        }
        if(!expandTopology){
            document.getElementById('disc-progress').innerHTML =
                `<span class="tm-ok">${_dt('disc.doneBase','Completato - {n} dispositivi trovati (solo discovery base)',{n:`<strong>${found1}</strong>`})}</span>${baseSummary}`;
        } else {
            document.getElementById('disc-progress').innerHTML =
                `<span class="tm-ok">${_dt('disc.phase1','Fase 1 - Scansionati {total} IP · {n} trovati',{total:data.total,n:`<strong>${found1}</strong>`})}</span>` +
                `<span style="color:var(--text-muted);margin-left:10px">${_dt('disc.phase2','Fase 2: espansione topologia LLDP/CDP…')}</span>${baseSummary}`;

            await _runCrawlPhase(store._discResults.filter(d=>d.snmpReachable).map(d=>d.ip), driver, community, timeout);

            const total = store._discResults.length;
            const newViaLldp = total - found1;
            document.getElementById('disc-progress').innerHTML =
                `<span class="tm-ok">${_dt('disc.doneTotal','Completato - {n} dispositivi',{n:`<strong>${total}</strong>`})}` +
                (newViaLldp > 0 ? ` ${_dt('disc.viaSplit','({scan} scan + {lldp} via LLDP/CDP)',{scan:found1,lldp:`<strong>${newViaLldp}</strong>`})}` : '') + `</span>${_discSummaryHtml(store._discResults)}`;
        }

    }catch(e){
        if(e.name==='AbortError'){
            document.getElementById('disc-progress').innerHTML=`<span class="tm-err">${_dt('disc.aborted','Scansione interrotta: il server non ha risposto entro 90 secondi.')}</span>`;
        } else {
            document.getElementById('disc-progress').innerHTML=`<span class="tm-err">${_dt('disc.error','Errore')}: ${escapeHTML(e.message)}</span>`;
        }
    }finally{
        if(scanTimeout) clearTimeout(scanTimeout);
        window._discScanAbort = null;
        win._discRunning = false;
        btn.disabled=false; btn.innerHTML=`<i class="fas fa-search"></i> ${_dt('disc.scan','Scansiona')}`;
        _discUpdateImportBtn();
    }
}

function _discKey(d){
    return String(d?.ip || d?.hostname || '').trim().toLowerCase();
}

function _discEnsureMeta(d){
    const row = { ...(d || {}) };
    const ouiVendor = win._discVendorFromMac(row.mac);
    if(!row.vendor) row.vendor = ouiVendor;
    row.vendorHint = row.vendorHint || ouiVendor || '';
    if(!row.hostname && row.netbiosName) row.hostname = row.netbiosName;
    if(!row.displayName) row.displayName = row.hostname || row.ip || '';
    const serverClass = row.deviceClass || row.discovery?.deviceClass || '';
    const serverScore = parseInt(row?.confidence?.score ?? row?.discovery?.confidence?.score ?? 0, 10) || 0;
    const strongServerClass = !!(
        serverClass && (
            row.snmpReachable ||
            row.objectId ||
            serverScore >= 55
        )
    );
    if(strongServerClass){
        row.deviceClass = serverClass;
    } else {
        if(!row.deviceClass) row.deviceClass = win._guessType(row.descr, row.objectId, row.vendor, row.httpTitle||row.httpsTitle, row.hostname);
        row.deviceClass = win._discSanitizeDeviceClass(row) || row.deviceClass;
    }
    if(row.discovery) row.discovery.deviceClass = row.deviceClass;
    if(!row.manageability){
        row.manageability = row.snmpReachable ? 'snmp-managed'
            : (row.httpTitle || row.httpsTitle) ? 'web-managed'
            : row.pingReachable ? 'reachable'
            : (Array.isArray(row.smbShares) && row.smbShares.length) || row.netbiosName || row.netbiosGroup || (Array.isArray(row.services) && row.services.length) ? 'service-observed'
            : row.alive ? 'observed'
            : 'observed';
    }
    if(!Array.isArray(row.sources) || !row.sources.length){
        const sources = [];
        if(String(row?.viaProtocol || row?.protocol || '').toUpperCase()==='LLDP') sources.push({id:'lldp',label:'LLDP'});
        else if(String(row?.viaProtocol || row?.protocol || '').toUpperCase()==='CDP') sources.push({id:'cdp',label:'CDP'});
        else if(row.snmpReachable) sources.push({id:'snmp',label:'SNMP'});
        else if(Array.isArray(row.smbShares) && row.smbShares.length) sources.push({id:'smb',label:'SMB'});
        else if(row.netbiosName || row.netbiosGroup) sources.push({id:'netbios',label:'NBT'});
        else if(row.httpTitle || row.httpsTitle) sources.push({id:'http',label:'WEB'});
        else if(row.mac) sources.push({id:'arp',label:'ARP'});
        else if(row.pingReachable) sources.push({id:'ping',label:'PING'});
        row.sources = sources;
    }
    if(!Array.isArray(row.evidences)) row.evidences = [];
    if(!Array.isArray(row.reasonCodes)) row.reasonCodes = [];
    if(!row.confidence || !Number.isFinite(row.confidence.score)){
        const ci = _discConfidenceInfo({ ...row, confidence:null, discovery:null });
        row.confidence = { score: ci.score, level: ci.cls === 'high' ? 'high' : ci.cls === 'mid' ? 'mid' : 'low' };
    }
    row.identityConfidence = row.identityConfidence || row.confidence?.level || 'low';
    row.identitySource = row.identitySource || win._discIdentitySource(row);
    if(typeof row.possibleReplacement !== 'boolean') row.possibleReplacement = false;
    if(!Array.isArray(row.notes)) row.notes = [];
    if(!row.discovery) row.discovery = {
        displayName: row.displayName,
        deviceClass: row.deviceClass,
        manageability: row.manageability,
        sources: row.sources,
        evidences: row.evidences,
        confidence: row.confidence,
        identitySource: row.identitySource,
        identityConfidence: row.identityConfidence,
        vendorHint: row.vendorHint,
        possibleReplacement: row.possibleReplacement,
        notes: row.notes,
        reasonCodes: row.reasonCodes,
    };
    return row;
}

function _discCaptureUiState(){
    document.querySelectorAll('#disc-tbody tr').forEach(tr=>{
        const chk = tr.querySelector('.disc-chk');
        if(!chk) return;
        const idx = parseInt(chk.dataset.idx,10);
        const row = store._discResults[idx];
        const key = _discKey(row);
        if(!key) return;
        win._discSelMap[key] = !!chk.checked;
        const sel = tr.querySelector('.disc-type');
        if(sel) win._discTypeMap[key] = sel.value;
    });
}

function _discUpdateImportBtn(){
    const ibtn = document.getElementById('disc-import-btn');
    if(!ibtn) return;
    const selected = document.querySelectorAll('.disc-chk:checked').length;
    ibtn.disabled = selected===0 || win._discRunning || win._discImporting;
}

function _discOnRowToggle(chk){
    const idx = parseInt(chk?.dataset?.idx,10);
    const row = store._discResults[idx];
    const key = _discKey(row);
    if(key) win._discSelMap[key] = !!chk.checked;
    const all = document.querySelectorAll('.disc-chk');
    const selAll = document.getElementById('disc-selall');
    if(selAll) selAll.checked = all.length>0 && [...all].every(c=>c.checked);
    _discUpdateImportBtn();
}

function _discOnTypeChange(sel){
    _discUpdateDest(sel);
    const idx = parseInt(sel?.dataset?.idx,10);
    const row = store._discResults[idx];
    const key = _discKey(row);
    if(key) win._discTypeMap[key] = sel.value;
    win._discRememberClassHint(row, sel.value);
}

function _discDestIcon(type){
    return TYPES[type]?.isFloor
        ? `<i class="fas fa-map-location-dot" data-tip="${_dt('disc.tip.toFloor','Verrà inserito in PLANIMETRIA')}" style="color:#3fb950"></i>`
        : `<i class="fas fa-server" data-tip="${_dt('disc.tip.toRack','Verrà inserito nel RACK')}" style="color:#58a6ff"></i>`;
}

function _discUpdateDest(sel){
    const span = sel.parentElement.querySelector('.disc-dest');
    if(span) span.innerHTML = _discDestIcon(sel.value);
}

function _discSourceInfo(d){
    const srcList = Array.isArray(d?.sources) ? d.sources : Array.isArray(d?.discovery?.sources) ? d.discovery.sources : [];
    const first = srcList[0] || null;
    const reasonCodes = Array.isArray(d?.reasonCodes) ? d.reasonCodes : Array.isArray(d?.discovery?.reasonCodes) ? d.discovery.reasonCodes : [];
    if(first){
        const map = {
            'lldp': { label:'LLDP', cls:'lldp', title:_dt('disc.tip.lldp','Scoperto tramite LLDP da un apparato vicino') },
            'cdp': { label:'CDP', cls:'cdp', title:_dt('disc.tip.cdp','Scoperto tramite CDP da un apparato Cisco/vicino') },
            'xdp': { label:'xDP', cls:'xd', title:_dt('disc.tip.xdp','Scoperto tramite LLDP/CDP da un apparato vicino') },
            'snmp': { label:'SNMP', cls:'snmp', title:_dt('disc.tip.snmp','Risponde a SNMP: dati più affidabili') },
            'http': { label:'WEB', cls:'web', title:_dt('disc.tip.http','Rilevato tramite risposta web / titolo HTTP') },
            'https': { label:'WEB', cls:'web', title:_dt('disc.tip.https','Rilevato tramite risposta web / titolo HTTPS') },
            'deep': { label:'DEEP', cls:'deep', title:_dt('disc.tip.deep','Rilevato tramite scansione TCP profonda') },
            'netbios': { label:'NBT', cls:'deep', title:_dt('disc.tip.netbios','Nome NetBIOS rilevato') },
            'smb': { label:'SMB', cls:'deep', title:_dt('disc.tip.smb','Condivisioni SMB leggibili') },
            'dns': { label:'DNS', cls:'ping', title:_dt('disc.tip.dns','Hostname risolto o confermato') },
            'arp': { label:'ARP', cls:'arp', title:_dt('disc.tip.arp','Rilevato tramite ARP/MAC locale') },
            'ping': { label:'PING', cls:'ping', title:_dt('disc.tip.ping','Host raggiungibile ma senza dettagli di gestione') },
        };
        if(map[first.id]){
            const base = map[first.id];
            return {
                ...base,
                title: reasonCodes.length ? `${base.title} · ${reasonCodes.join(' · ')}` : base.title,
            };
        }
    }
    const proto = String(d?.viaProtocol || d?.protocol || '').toUpperCase();
    if(proto === 'LLDP') return { label:'LLDP', cls:'lldp', title:_dt('disc.tip.lldp','Scoperto tramite LLDP da un apparato vicino') };
    if(proto === 'CDP')  return { label:'CDP',  cls:'cdp',  title:_dt('disc.tip.cdp','Scoperto tramite CDP da un apparato Cisco/vicino') };
    if(d?._via === 'lldp') return { label:'xDP', cls:'xd', title:_dt('disc.tip.xdp','Scoperto tramite LLDP/CDP da un apparato vicino') };
    if(d?.snmpReachable){
        // Badge con la VERSIONE rilevata (v1/v2c/v3), così in fase di selezione
        // si vede subito se e come il device risponde a SNMP.
        const _ver = d.snmpDriver==='snmp-v3' ? 'SNMPv3' : d.snmpDriver==='snmp-v1' ? 'SNMPv1' : 'SNMPv2c';
        return { label:_ver, cls:'snmp', title:`${_dt('disc.tip.snmp','Risponde a SNMP: dati più affidabili')} (${_ver})` };
    }
    if(d?.httpTitle || d?.httpsTitle) return { label:'WEB', cls:'web', title:_dt('disc.tip.http','Rilevato tramite risposta web / titolo HTTP') };
    if(Array.isArray(d?.smbShares) && d.smbShares.length) return { label:'SMB', cls:'deep', title:`${_dt('disc.tip.smb','Condivisioni SMB leggibili')}: ${d.smbShares.map(s=>s.name||s).join(', ')}` };
    if(d?.netbiosName || d?.netbiosGroup) return { label:'NBT', cls:'deep', title:`NetBIOS: ${[d.netbiosName,d.netbiosGroup].filter(Boolean).join(' / ')}` };
    if(Array.isArray(d?.services) && d.services.length) return { label:'DEEP', cls:'deep', title:_dt('disc.tip.deepPorts','Porte TCP aperte rilevate') };
    if(d?.mac) return { label:'ARP', cls:'arp', title:_dt('disc.tip.arp','Rilevato tramite ARP/MAC locale') };
    if(d?.pingReachable) return { label:'PING', cls:'ping', title:_dt('disc.tip.pingIcmp','Host raggiungibile via ICMP/ping') };
    return { label:_dt('disc.reach.seen','VISTO'), cls:'seen', title:_dt('disc.tip.seen','Indizio presente ma host non confermato attivo') };
}

function _discReachabilityInfo(d){
    if(d?.snmpReachable || d?.pingReachable){
        return { label:'On', cls:'on', title:d?.snmpReachable ? _dt('disc.tip.onSnmp','Online confermato da SNMP') : _dt('disc.tip.onPing','Online confermato da ping') };
    }
    if(d?.alive){
        return { label:_dt('disc.reach.observed','Osservato'), cls:'seen', title:_dt('disc.tip.observed','Rilevato tramite servizio, web, NetBIOS/SMB o altra evidenza; ping/SNMP non confermati') };
    }
    return { label:_dt('disc.reach.inactive','Inattivo'), cls:'off', title:d?.mac ? _dt('disc.tip.inactiveArp','Visto passivamente via ARP/MAC, ma non confermato raggiungibile') : _dt('disc.tip.inactiveNone','Nessun segnale attivo confermato') };
}

function _discConfidenceInfo(d){
    const confObj = d?.confidence || d?.discovery?.confidence;
    if(confObj && Number.isFinite(confObj.score)){
        const cls = confObj.level === 'high' ? 'high' : confObj.level === 'mid' ? 'mid' : 'low';
        const evidences = Array.isArray(d?.evidences) ? d.evidences : Array.isArray(d?.discovery?.evidences) ? d.discovery.evidences : [];
        const reasonCodes = Array.isArray(d?.reasonCodes) ? d.reasonCodes : Array.isArray(d?.discovery?.reasonCodes) ? d.discovery.reasonCodes : [];
        const title = evidences.slice(0, 4).map(e => e.note || e.type || '').filter(Boolean).join(' · ') || reasonCodes.join(' · ') || _dt('disc.tip.estimated','confidenza stimata');
        return {
            label: cls === 'high' ? _dt('disc.conf.high','Alta') : cls === 'mid' ? _dt('disc.conf.mid','Media') : _dt('disc.conf.low','Bassa'),
            cls,
            score: Math.max(0, Math.min(100, parseInt(confObj.score, 10) || 0)),
            title,
        };
    }
    let score = 0;
    const reasons = [];
    const proto = String(d?.viaProtocol || d?.protocol || '').toUpperCase();
    if(proto === 'LLDP' || proto === 'CDP'){ score += 45; reasons.push(`neighbor ${proto}`); }
    else if(d?._via === 'lldp'){ score += 45; reasons.push('neighbor LLDP/CDP'); }
    if(d?.snmpReachable){ score += 35; reasons.push('SNMP ok'); }
    if(d?.hostname){ score += 12; reasons.push('hostname'); }
    if(d?.mac){ score += 12; reasons.push('MAC'); }
    if(d?.vendor){ score += 8; reasons.push('vendor'); }
    if(d?.netbiosName || d?.netbiosGroup){ score += 14; reasons.push('NetBIOS'); }
    if(Array.isArray(d?.smbShares) && d.smbShares.length){ score += Math.min(20, 10 + d.smbShares.length * 3); reasons.push('SMB'); }
    if(d?.httpTitle || d?.httpsTitle){ score += 8; reasons.push('web'); }
    if(Array.isArray(d?.services) && d.services.length){ score += Math.min(18, 6 + d.services.length * 2); reasons.push(_dt('disc.ev.tcpServices','servizi TCP')); }
    if(d?.pingReachable){ score += 10; reasons.push('ping ok'); }
    else if(d?.alive){ score += 4; reasons.push(_dt('disc.ev.serviceSeen','servizio osservato')); }
    score = Math.min(100, score);
    if(score >= 70) return { label:_dt('disc.conf.high','Alta'), cls:'high', score, title: reasons.join(' · ') };
    if(score >= 40) return { label:_dt('disc.conf.mid','Media'), cls:'mid', score, title: reasons.join(' · ') };
    return { label:_dt('disc.conf.low','Bassa'), cls:'low', score, title: reasons.join(' · ') || _dt('disc.tip.fewSignals','pochi segnali raccolti') };
}

function _discSummaryHtml(results, extra={}){
    const rows = results || [];
    const total = rows.length;
    const on = rows.filter(d=>_discReachabilityInfo(d).cls === 'on').length;
    const observed = rows.filter(d=>_discReachabilityInfo(d).cls === 'seen').length;
    const off = total - on - observed;
    const snmp = rows.filter(d=>d.snmpReachable).length;
    const v3cred = rows.filter(d=>d.needsCredentials).length;
    const mac = rows.filter(d=>d.mac).length;
    const web = rows.filter(d=>d.httpTitle || d.httpsTitle).length;
    const deep = rows.filter(d=>Array.isArray(d.services) && d.services.length).length;
    const nbt = rows.filter(d=>d.netbiosName || d.netbiosGroup).length;
    const smb = rows.filter(d=>Array.isArray(d.smbShares) && d.smbShares.length).length;
    const lldp = rows.filter(d=>String(d.viaProtocol || d.protocol || '').toUpperCase()==='LLDP').length;
    const cdp = rows.filter(d=>String(d.viaProtocol || d.protocol || '').toUpperCase()==='CDP').length;
    const xdp = rows.filter(d=>d._via === 'lldp' && !String(d.viaProtocol || d.protocol || '').trim()).length;
    const hi = rows.filter(d=>_discConfidenceInfo(d).cls === 'high').length;
    const mid = rows.filter(d=>_discConfidenceInfo(d).cls === 'mid').length;
    // [key, label, value]: la `key` è stabile (filtro/always-show), la `label` è
    // tradotta. I termini tecnici (On/SNMP/MAC-ARP/WEB/TCP/NetBIOS/SMB/LLDP/CDP/xDP)
    // restano invariati (glossario).
    const chips = [
        ['total', _dt('disc.chip.total','Totale'), total], ['on', 'On', on],
        ['observed', _dt('disc.chip.observed','Osservati'), observed], ['inactive', _dt('disc.chip.inactive','Inattivi'), off],
        ['snmp', 'SNMP', snmp], ['v3cred', _dt('disc.v3cred','v3 da configurare'), v3cred], ['mac', 'MAC/ARP', mac], ['web', 'WEB', web],
        ['deep', 'TCP deep', deep], ['nbt', 'NetBIOS', nbt], ['smb', 'SMB', smb], ['lldp', 'LLDP', lldp], ['cdp', 'CDP', cdp], ['xdp', 'xDP', xdp],
        ['hi', _dt('disc.chip.confHigh','Conf. alta'), hi], ['mid', _dt('disc.chip.confMid','Conf. media'), mid],
    ];
    if(extra.imported != null) chips.push(['imported', _dt('disc.chip.imported','Importati'), extra.imported]);
    if(extra.updated != null) chips.push(['updated', _dt('disc.chip.updated','Aggiornati'), extra.updated]);
    if(extra.autoLinked != null) chips.push(['autolink', _dt('disc.chip.autoLink','Link auto'), extra.autoLinked]);
    return `<div class="disc-summary-grid">${chips
        .filter(([key,label,value])=>Number(value) > 0 || key === 'total' || key === 'on')
        .map(([key,label,value])=>`<span><b>${escapeHTML(value)}</b>${escapeHTML(label)}</span>`)
        .join('')}</div>`;
}

function _discExistingNode(d){
    return win._discFindExistingDevice(d).node || null;
}

function _discReconcileInfo(d, type){
    const existing = _discExistingNode(d);
    if(!existing) return { label:_dt('disc.rec.new','Nuovo'), cls:'new', title:_dt('disc.tip.willCreate','Verrà creato un nuovo dispositivo') };
    const changes = [];
    const strongIdentity = win._discHasStrongIdentity(d);
    const typeNote = existing.type !== type ? _dt('disc.tip.typeDiff','Tipo selezionato diverso ({type}): non viene cambiato automaticamente',{type:typeName(type)}) : '';
    const autoRetypeNote = strongIdentity && win._discCanAutoRetype(existing.type, type)
        ? _dt('disc.tip.strongSignal','Segnale forte: tipo e identità possono essere aggiornati automaticamente')
        : '';
    if(!existing.ip && d.ip) changes.push(`IP: ${d.ip}`);
    if(!existing.hostname && d.hostname) changes.push(`hostname: ${d.hostname}`);
    if(!existing.mac && d.mac) changes.push(`MAC: ${normalizeMacAddress(d.mac)}`);
    if(!existing.integration?.host && d.ip) changes.push('SNMP host');
    const _ex = _dt('disc.tip.exists','Esiste già: {name}.',{name:existing.name || existing.hostname || existing.id});
    if(changes.length){
        return { label:_dt('disc.rec.update','Aggiorna'), cls:'update', title:`${_ex} ${_dt('disc.tip.proposedFields','Campi proposti: {list}',{list:changes.join(' - ')})}${autoRetypeNote ? ' - ' + autoRetypeNote : ''}${typeNote&&!autoRetypeNote?' - '+typeNote:''}` };
    }
    if(typeNote || autoRetypeNote) return { label:_dt('disc.rec.verify','Verifica'), cls:'check', title:`${_ex} ${autoRetypeNote || typeNote}` };
    return { label:_dt('disc.rec.same','Già presente'), cls:'same', title:`${_ex} ${_dt('disc.tip.noCritical','Nessun campo critico da aggiornare')}` };
}

function _discRenderTable(){
    _discCaptureUiState();
    // Indice identita' fresco ma costruito UNA volta per render: senza questo,
    // win._guessType + _discReconcileInfo lo ricostruivano per OGNI riga (O(righe×porte),
    // secondi di UI bloccata su progetti grandi — regressione del fix sess.25).
    if(typeof win._discInvalidateExistingIndexes === 'function') win._discInvalidateExistingIndexes();
    const tbody = document.getElementById('disc-tbody');
    tbody.innerHTML = store._discResults.map((d,i)=>{
        const key = _discKey(d);
        const guessed = d.deviceClass || win._guessType(d.descr, d.objectId, d.vendor, d.httpTitle||d.httpsTitle, d.hostname);
        const t = win._discTypeMap[key] || guessed;
        const opts = Object.entries(TYPES)
            .filter(([,v])=>v.isActive || v.hasIP)
            .map(([k])=>[k, typeName(k)])
            .sort((a,b)=>a[1].localeCompare(b[1],undefined,{sensitivity:'base'}))
            .map(([k,label])=>`<option value="${k}"${k===t?' selected':''}>${escapeHTML(label)}</option>`)
            .join('');
        const src = _discSourceInfo(d);
        const conf = _discConfidenceInfo(d);
        const rec = _discReconcileInfo(d, t);
        const badges = ` <span class="disc-badge src-${src.cls}" data-tip="${escapeHTML(src.title)}">${escapeHTML(src.label)}</span>`
            + ` <span class="disc-badge conf-${conf.cls}" data-tip="${escapeHTML(conf.title)}">${escapeHTML(conf.label)} ${conf.score}%</span>`
            + ` <span class="disc-badge rec-${rec.cls}" data-tip="${escapeHTML(rec.title)}">${escapeHTML(rec.label)}</span>`
            + (d.needsCredentials
                ? ` <span class="disc-badge v3-cred" data-tip="${escapeHTML(_dt('disc.tip.v3cred','SNMPv3 rilevato senza credenziali — dopo l\'import configura utente/password nel pannello Integrazione, poi fai Sync'))}"><i class="fas fa-key"></i> ${escapeHTML(_dt('disc.v3cred','v3 da configurare'))}</span>`
                : '')
            // Dual-config: risponde a v2c (con dati) MA supporta anche v3 → lo
            // segnalo (e implicitamente che v2c è esposto). Niente 🔑: via v2c funziona.
            + (((d.snmpVersions||[]).includes('snmp-v3') && d.snmpDriver!=='snmp-v3' && !d.needsCredentials)
                ? ` <span class="disc-badge v3-also" data-tip="${escapeHTML(_dt('disc.tip.alsoV3','Supporta anche SNMPv3; interrogato via la versione con i dati. Attenzione: v2c è attivo/esposto — valuta di disattivarlo e passare a v3.'))}"><i class="fas fa-key"></i> ${escapeHTML(_dt('disc.alsoV3','+v3'))}</span>`
                : '');
        const reach = _discReachabilityInfo(d);
        const displayName = d.displayName || d.hostname || d.ip;
        const canImport = !!d.alive;
        const checked = Object.prototype.hasOwnProperty.call(win._discSelMap,key) ? !!win._discSelMap[key] : canImport;
        return `<tr class="${d.alive?'':'disc-off'}">
          <td><input type="checkbox" class="disc-chk" data-idx="${i}" onchange="_discOnRowToggle(this)" ${checked?'checked':''}></td>
          <td><span class="disc-st ${reach.cls}" data-tip="${escapeHTML(reach.title)}">${escapeHTML(reach.label)}</span></td>
          <td class="disc-host">${escapeHTML(displayName)}${badges}</td>
          <td class="disc-ip">${escapeHTML(d.ip)}</td>
          <td>${escapeHTML(d.vendor||'—')}</td>
          <td>${escapeHTML(d.mac||'—')}</td>
          <td><select class="disc-type" data-idx="${i}" onchange="_discOnTypeChange(this)">${opts}</select> <span class="disc-dest" data-idx="${i}">${_discDestIcon(t)}</span></td>
        </tr>`;
    }).join('');
    const on = store._discResults.filter(d=>_discReachabilityInfo(d).cls === 'on').length;
    const observed = store._discResults.filter(d=>_discReachabilityInfo(d).cls === 'seen').length;
    const off = store._discResults.length - on - observed;
    document.getElementById('disc-summary').textContent=_dt('disc.summaryLine','{on} online · {observed} osservati · {off} inattivi',{on,observed,off});
    const all = document.querySelectorAll('.disc-chk');
    document.getElementById('disc-selall').checked = all.length>0 && [...all].every(c=>c.checked);
    document.getElementById('disc-results').style.display='';
    _discUpdateImportBtn();
}

async function _runCrawlPhase(seeds, driver, community, timeout){
    if(!seeds.length) return;
    const knownIps = new Set(seeds);
    let crawlAbort = null;

    try{
        crawlAbort = new AbortController();
        window._discCrawlAbort = crawlAbort;

        const resp = await fetch('/api/discover/topology',{
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ seeds, driver, community, timeout, maxDepth:5 }),
            signal: crawlAbort.signal,
        });
        if(!resp.ok || !resp.headers.get('content-type')?.includes('text/event-stream')) return;

        const reader = resp.body.getReader();
        const dec    = new TextDecoder();
        let buf = '';

        while(true){
            const {done, value} = await reader.read();
            if(done) break;
            buf += dec.decode(value,{stream:true});
            const lines = buf.split('\n'); buf = lines.pop();
            for(const line of lines){
                if(!line.startsWith('data: ')) continue;
                let evt; try{ evt=JSON.parse(line.slice(6)); }catch(_){ continue; }
                if(evt.type==='found' && !knownIps.has(evt.device.ip)){
                    knownIps.add(evt.device.ip);
                    store._discResults.push(_discEnsureMeta({
                        ...evt.device, _via:'lldp',
                        viaProtocol: evt.device.viaProtocol || evt.protocol || '',
                        alive:true, status:'On', snmpReachable:true, mac:'', vendor:'', httpTitle:'', httpsTitle:''
                    }));
                    _discRenderTable();
                }
            }
        }
    }catch(e){
        if(e.name !== 'AbortError') console.warn('[CRAWL]', e.message);
    }finally{
        window._discCrawlAbort = null;
    }
}

function discSelectAll(val){
    document.querySelectorAll('.disc-chk').forEach(cb=>{
        cb.checked = val;
        const idx = parseInt(cb.dataset.idx,10);
        const key = _discKey(store._discResults[idx]);
        if(key) win._discSelMap[key] = !!val;
    });
    _discUpdateImportBtn();
}

async function importDiscovered(){
    if(win._discRunning || win._discImporting) return;
    win._discImporting = true;
    _discUpdateImportBtn();
    const ibtn = document.getElementById('disc-import-btn');
    const sbtn = document.getElementById('disc-scan-btn');
    if(ibtn) ibtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${_dt('pnl.disc.adding','Aggiungo...')}`;
    if(sbtn) sbtn.disabled = true;
    const rows = document.querySelectorAll('#disc-tbody tr');
    if(!rows.length){
        win._discImporting=false;
        if(ibtn) ibtn.innerHTML = `<i class="fas fa-file-import"></i> ${_dt('pnl.disc.addSelected','Aggiungi selezionati')}`;
        if(sbtn) sbtn.disabled = false;
        _discUpdateImportBtn();
        return;
    }
    const toImport=[];
    rows.forEach(tr=>{
        const chk=tr.querySelector('.disc-chk'); if(!chk?.checked) return;
        const idx=parseInt(chk.dataset.idx);
        const type=tr.querySelector('.disc-type')?.value||'switch';
        const base = store._discResults[idx]||{};
        win._discRememberClassHint(base, type);
        toImport.push({ ...base, type });
    });
    if(!toImport.length){
        win._discImporting=false;
        if(ibtn) ibtn.innerHTML = `<i class="fas fa-file-import"></i> ${_dt('pnl.disc.addSelected','Aggiungi selezionati')}`;
        if(sbtn) sbtn.disabled = false;
        _discUpdateImportBtn();
        _showToast(_dt('msg.ui.noDeviceSelected','Nessun dispositivo selezionato'),'warn');
        return;
    }

    try{
        pushHistory();
        // Driver di FALLBACK per i device importati che NON hanno risposto a SNMP
        // (quelli che rispondono usano d.snmpDriver concreto, v1/v2c/v3). Il dialogo
        // non ha più un selettore versione (scan universale): default v2c.
        const driver = 'snmp-v2c';
        const community = document.getElementById('disc-community')?.value || 'public';
        const usedNodeIds = new Set((store.state.nodes || []).map(n => String(n.id || '')));
        let rackId = store.state.currentRack;
        if(!rackId || !store.state.racks.find(r=>r.id===rackId)){
            rackId = uid('rack');
            store.state.racks.push({ id:rackId, name:'Rack Discovery', sizeU:42 });
            store.state.currentRack = rackId;
        }

        const existingIdx = win._discBuildExistingIndexes();

        let imported=0, updated=0, floorCount=0, conflicts=0;
        const _importedEndpoints=[];
        const fvp = store.state.floorView || {x:0,y:0,zoom:1};
        const fpEl = document.getElementById('floorplan');
        const fpW  = fpEl ? fpEl.clientWidth  : 800;
        const fpH  = fpEl ? fpEl.clientHeight : 600;
        const baseX = Math.round((-fvp.x + fpW/2) / (fvp.zoom||1));
        const baseY = Math.round((-fvp.y + fpH/2) / (fvp.zoom||1));

        toImport.forEach(d=>{
            const def=TYPES[d.type]; if(!def) return;
            // SNMP attivo SOLO sui device che hanno risposto a SNMP durante lo Scopri
            // (d.snmpReachable). Chi non risponde viene importato SENZA driver SNMP: il
            // Sync non lo interroga (niente fail su chi non parla SNMP) e resta comunque
            // abilitabile a mano dal pannello Proprieta'. Chi risponde usa il driver
            // concreto rilevato (v1/v2c/v3); v2c solo come ripiego se la versione manca.
            const importDriver = d.snmpReachable ? (d.snmpDriver || driver) : '';
            const match = win._discFindExistingDevice(d, existingIdx);
            if(match.conflict?.existing){
                win._discMarkIpMacConflict(match.conflict.existing, d);
                conflicts++;
            }
            const foundExisting = match.node;
            if(foundExisting){
                const strongIdentity = win._discHasStrongIdentity(d);
                const score = win._discConfidenceScore(d);
                const autoName = String(foundExisting.name || '').trim().toLowerCase();
                const autoHost = String(foundExisting.hostname || '').trim().toLowerCase();
                const autoIp = String(foundExisting.ip || foundExisting.currentIp || foundExisting.integration?.host || '').trim().toLowerCase();
                const shouldRefreshIdentity = strongIdentity && (match.matchedBy === 'ip' || match.matchedBy === 'hostname');
                const incomingReplacement = shouldRefreshIdentity && (
                    (!!d.vendor && !!foundExisting.brand && d.vendor !== foundExisting.brand) ||
                    (!!d.hostname && !!foundExisting.hostname && d.hostname !== foundExisting.hostname) ||
                    win._discCanAutoRetype(foundExisting.type, d.type)
                );

                win._discTouchNodeIdentity(foundExisting, d, match.matchedBy);
                foundExisting.vendorHint = d.vendorHint || win._discVendorFromMac(d.mac) || foundExisting.vendorHint || '';
                foundExisting.identitySource = win._discIdentitySource(d);
                foundExisting.identityConfidence = d.identityConfidence || d.confidence?.level || foundExisting.identityConfidence || 'low';
                if(incomingReplacement){
                    foundExisting.possibleReplacement = true;
                    if(!Array.isArray(foundExisting.discoveryConflicts)) foundExisting.discoveryConflicts = [];
                    foundExisting.discoveryConflicts.push({
                        type:'identity-shift',
                        ip:d.ip || '',
                        oldType:foundExisting.type || '',
                        newType:d.type || '',
                        oldBrand:foundExisting.brand || '',
                        newBrand:d.vendor || '',
                        source:foundExisting.identitySource || '',
                        confidence:score,
                        ts:new Date().toISOString(),
                    });
                    if(foundExisting.discoveryConflicts.length > 20) foundExisting.discoveryConflicts.splice(0, foundExisting.discoveryConflicts.length - 20);
                }
                if(!foundExisting.hostname || shouldRefreshIdentity){
                    foundExisting.hostname = d.hostname || foundExisting.hostname || '';
                }
                foundExisting.mac = foundExisting.mac || normalizeMacAddress(d.mac||'');
                if(d.vendor && (!foundExisting.brand || shouldRefreshIdentity || score >= 70)){
                    foundExisting.brand = d.vendor;
                }
                foundExisting.netbiosName = foundExisting.netbiosName || d.netbiosName || '';
                foundExisting.netbiosGroup = foundExisting.netbiosGroup || d.netbiosGroup || '';
                if(!Array.isArray(foundExisting.smbShares) || !foundExisting.smbShares.length) foundExisting.smbShares = Array.isArray(d.smbShares) ? d.smbShares : [];
                if(
                    win._discCanAutoRetype(foundExisting.type, d.type) &&
                    shouldRefreshIdentity &&
                    score >= 70
                ){
                    const prevType = foundExisting.type;
                    foundExisting.type = d.type;
                    const prevDefaultPorts = TYPES[prevType]?.ports || 0;
                    const nextDefaultPorts = TYPES[d.type]?.ports || 0;
                    if(!foundExisting.ports || foundExisting.ports === prevDefaultPorts){
                        foundExisting.ports = nextDefaultPorts || foundExisting.ports;
                    }
                }
                if(
                    !foundExisting.name ||
                    autoName === autoHost ||
                    autoName === autoIp ||
                    autoName === String(TYPES[foundExisting.type]?.name || '').trim().toLowerCase()
                ){
                    foundExisting.name = d.hostname || d.ip || foundExisting.name;
                }
                if(!foundExisting.integration) foundExisting.integration = {};
                const hasDriverChoice = Object.prototype.hasOwnProperty.call(foundExisting.integration,'driver');
                // Solo se il device ha risposto a SNMP (importDriver valorizzato) e il nodo
                // non ha gia' una scelta driver: non sovrascriviamo mai una config manuale
                // ne' scriviamo un driver SNMP vuoto su un nodo gia' esistente.
                if(importDriver && (!hasDriverChoice || foundExisting.integration.driver==null)){
                    foundExisting.integration.driver = importDriver;
                    foundExisting.integration.community = foundExisting.integration.community || community;
                }
                foundExisting.integration.host   = foundExisting.integration.host   || d.ip || '';
                win._discIndexNode(existingIdx, foundExisting);
                win._recordDiscoveryObservation({
                    mac:d.mac, ip:d.ip, switchId:'', portId:'', ifName:'',
                    source:_discSourceInfo(d).label, confidence:_discConfidenceInfo(d).score/100
                });
                updated++; return;
            }
            // Responder SNMP -> driver + community; non-responder -> solo host, cosi'
            // il Sync lo salta finche' l'utente non abilita SNMP a mano dal pannello.
            const integration = importDriver
                ? { driver: importDriver, host: d.ip||'', community }
                : { host: d.ip||'' };
            let n;
            if(def.isFloor){
                const col = floorCount % 5, row = Math.floor(floorCount / 5);
                n = {
                    id: win._nextNodeId(d.type, usedNodeIds), type: d.type,
                    name: d.hostname||d.ip||d.type, hostname: d.hostname||'', ip: d.ip||'',
                    mac: normalizeMacAddress(d.mac||''),
                    brand: d.vendor || def.brand || '',
                    vendorHint: d.vendorHint || win._discVendorFromMac(d.mac) || '',
                    identitySource: win._discIdentitySource(d),
                    identityConfidence: d.identityConfidence || d.confidence?.level || 'low',
                    possibleReplacement: !!d.possibleReplacement,
                    netbiosName: d.netbiosName || '',
                    netbiosGroup: d.netbiosGroup || '',
                    smbShares: Array.isArray(d.smbShares) ? d.smbShares : [],
                    x: baseX - 200 + col * 120,
                    y: baseY - 100 + row * 120,
                    ports: def.ports||1, integration,
                };
                floorCount++;
            } else {
                const sU   = def.sizeU||1;
                const rackU = win._findFreeU(rackId, sU);
                n = {
                    id: win._nextNodeId(d.type, usedNodeIds), type: d.type,
                    name: d.hostname||d.ip||d.type, hostname: d.hostname||'', ip: d.ip||'',
                    mac: normalizeMacAddress(d.mac||''),
                    brand: d.vendor || def.brand || '',
                    vendorHint: d.vendorHint || win._discVendorFromMac(d.mac) || '',
                    identitySource: win._discIdentitySource(d),
                    identityConfidence: d.identityConfidence || d.confidence?.level || 'low',
                    possibleReplacement: !!d.possibleReplacement,
                    netbiosName: d.netbiosName || '',
                    netbiosGroup: d.netbiosGroup || '',
                    smbShares: Array.isArray(d.smbShares) ? d.smbShares : [],
                    rackId, rackU, sizeU: sU, ports: def.ports||0, integration,
                };
            }
            win._discTouchNodeIdentity(n, d, match.matchedBy || 'new');
            if(match.conflict?.existing){
                n.discoveryConflicts = [{
                    type:'ip-mac',
                    ip:d.ip || '',
                    existingNodeId:match.conflict.existing.id || '',
                    existingMac:match.conflict.oldMac || '',
                    seenMac:normalizeMacAddress(d.mac || ''),
                    ts:new Date().toISOString(),
                }];
            }
            store.state.nodes.push(n);
            win._recordDiscoveryObservation({
                mac:d.mac, ip:d.ip, switchId:'', portId:'', ifName:'',
                source:_discSourceInfo(d).label, confidence:_discConfidenceInfo(d).score/100
            });
            win._discIndexNode(existingIdx, n);
            if(win._isLeafEndpoint(d.type)) _importedEndpoints.push(n);
            imported++;
        });

        let autoLinked=0;
        const hasFdbCache = Object.values(store._topoFdbCache || {}).some(fdb => Object.keys(fdb || {}).length > 0);
        if(hasFdbCache){
            for(const ep of _importedEndpoints){
                if(win._autoLinkEndpoint(ep.id).ok) autoLinked++;
            }
        }

        markDirty(); renderAll(); renderCables();
        closeDiscovery();
        if(_importedEndpoints.length){
            const first=_importedEndpoints[0];
            selId=first.id; selType='node';
            renderAll();
            win.focusNode(first);
        } else if(imported - floorCount > 0){
            win.switchRack(rackId);
        }
        const parts = [];
        if(imported - floorCount > 0) parts.push(_dt('disc.imp.inRack','{n} in rack',{n:imported - floorCount}));
        if(floorCount > 0)            parts.push(_dt('disc.imp.inFloor','{n} in planimetria',{n:floorCount}));
        if(updated > 0)               parts.push(_dt('disc.imp.updated','{n} aggiornati',{n:updated}));
        if(autoLinked > 0)            parts.push(_dt('disc.imp.autoLinked','{n} collegati auto',{n:autoLinked}));
        if(conflicts > 0)             parts.push(_dt('disc.imp.conflicts','{n} conflitti IP/MAC',{n:conflicts}));
        const progress = document.getElementById('disc-progress');
        if(progress){
            progress.innerHTML = `<span class="tm-ok">${escapeHTML(_dt('disc.imp.done','Import completato - {parts}',{parts:parts.join(' · ') || _dt('disc.imp.nothing','nessuna novità')}))}</span>`
                + _discSummaryHtml(store._discResults, { imported, updated, autoLinked });
        }
        _showToast(parts.join(' · ') || _dt('msg.ui.nothingNew','Nessuna novità'), imported||updated ? 'ok' : 'warn');
    } finally {
        win._discImporting=false;
        if(ibtn) ibtn.innerHTML = `<i class="fas fa-file-import"></i> ${_dt('pnl.disc.addSelected','Aggiungi selezionati')}`;
        if(sbtn) sbtn.disabled = false;
        _discUpdateImportBtn();
    }
}

expose({
    openDiscovery, closeDiscovery, _closeDiscoveryOverlayClick, runDiscovery,
    discSelectAll, importDiscovered, _discOnRowToggle, _discOnTypeChange,
    _discExistingNode, _discRenderTable,
});
