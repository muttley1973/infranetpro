import { win, expose } from './_bridge.js';
import { store } from './store.js';   // ritiro ponte fase 3: stato condiviso (ex win.*)
import { escapeHTML, uid, normalizeMacAddress } from './app-util.js';
import { markDirty, pushHistory, renderCables, _showToast, _nextNodeId } from './app.js';   // ritiro ponte: funzioni del nucleo (ex win.*)
import { renderAll } from './app-render-core.js';   // ritiro ponte fase 2: funzioni (ex win.*)
import { TYPES, typeName } from './app-types.js';   // ritiro ponte fase 1: catalogo tipi (ex TYPES) + nome localizzato
import { focusNode, switchRack } from './app-search-zoom-rack.js';   // ritiro ponte: funzioni rack/zoom/search (ex win.*)
import { _isLeafEndpoint } from './app-autolink.js';   // ritiro ponte: funzioni nucleo/tipi/autolink (ex win.*)
import { _discIndexNode, _discVendorFromMac } from './app-discovery-classify.js';   // ritiro ponte: funzioni topo/discovery/vlan/snmp (ex win.*)

// Nome DISPLAY per la tabella Scopri e per il nome del nodo importato. L'utente legge la
// RIGA (Nome -> Vendor -> Tipo, gia' in colonne separate) e fa l'abbinamento da solo:
// quindi il Nome deve essere l'IDENTIFICATIVO piu' specifico del device, e MAI il tipo
// (ridondante) ne' il vendor (colonna Vendor). Il MODELLO ha PRIORITA' sull'hostname:
// e' l'identita' di PRODOTTO (SHIELD, RLC-810A, Mediapad M5) mentre l'hostname e' spesso
// un default generico (SRV mDNS "Android.local", name ONVIF "IPC-BO") che lo mascherava.
//   1. MODELLO annunciato, ripulito (mDNS `md`/`ty`, UPnP modelName, ONVIF hardware):
//      "SHIELD Android TV"->"Shield", "HUAWEI Mediapad M5"->"Mediapad M5", "RLC-810A".
//   2. hostname REALE se leggibile (Sinology.local, GS1900) — non UUID/blob/auto-ID/generico
//   3. l'IP come riferimento stabile e univoco quando non c'e' ne' modello ne' hostname.
function _discIsJunkHost(h){
    const s = String(h||'').trim().toLowerCase().replace(/\.local\.?$/,'').replace(/\.$/,'');
    if(!s) return true;
    if(/^[0-9a-f]{2,}(-[0-9a-f]{2,})+$/.test(s)) return true;   // UUID / gruppi esadecimali (mDNS)
    if(/^[0-9a-f]{12,}$/.test(s)) return true;                  // blob esadecimale lungo
    // Hostname AUTO-GENERATO dal device: codice-brand corto + seriale/MAC esadecimale, senza
    // separatori/parole (HP "HPF4390962F234", Brother "BRW008077...", ESP, ...). Vendor-neutral:
    // e' lo SCHEMA (poche lettere + molti hex) a non essere leggibile, non un marchio specifico.
    // NB: "GS1900" (modello, 4 cifre) e "DESKTOP-ABC123" (separatore) NON matchano -> restano.
    if(/^[a-z]{2,6}[0-9a-f]{8,}$/.test(s)) return true;
    return false;
}
// Descrittori di CLASSE/SERVIZIO generici (UPnP/DLNA) — "WPS Access Point", "Internet Gateway
// Device", "MediaRenderer": la funzione del device, NON la sua identita' -> non usarli come nome.
// Vendor-neutral (termini standard). Tieni in sync con lib/discovery-mdns.js isGenericDeviceName.
const _DISC_GENERIC_NAMES = new Set([
    'accesspoint','wpsaccesspoint','ap','wirelessap','wirelessaccesspoint',
    'gateway','gatewaydevice','internetgatewaydevice','residentialgateway','homegateway',
    'broadbandgateway','router','wirelessrouter','broadbandrouter','wandevice','landevice',
    'mediarenderer','mediaserver','digitalmediarenderer','digitalmediaserver','dmr','dms',
    'dlna','dlnarenderer','dlnaserver','upnpdevice','upnprootdevice','rootdevice',
    'basicdevice','wfadevice','device','unknown','generic','network','localhost',
    'smarttv','tv','printer','scanner','camera','ipcamera',
    'android','androidtv','raspberrypi','localdomain','esp','esp32','esp8266',
    // valori-icona Bonjour `_device-info` (NON modelli reali; i Mac veri hanno il suffisso versione)
    'xserve','rackmac','macpro','powermac','macmini','imac','macbook','appletv',
]);
function _discIsGenericName(s){
    const x = String(s||'').toLowerCase().replace(/\.local\.?$/,'').replace(/[^a-z0-9]/g,'');
    return !x || _DISC_GENERIC_NAMES.has(x);
}
// Ripulisce il modello per usarlo come NOME: toglie il vendor iniziale (gia' in colonna,
// es. "NVIDIA SHIELD"->"SHIELD", "HUAWEI Mediapad M5"->"Mediapad M5") e i descrittori di
// TIPO in coda (ridondanti con la colonna Tipo, es. "SHIELD Android TV"->"SHIELD").
function _discCleanModel(model, vendor){
    let m = String(model||'').trim();
    if(!m) return '';
    // Prefissi-vendor da togliere (il vendor e' gia' in colonna): la PRIMA parola del vendor
    // ("Hewlett Packard"->"Hewlett") E l'ACRONIMO se multi-parola ("Hewlett Packard"->"HP").
    // Derivati dalla stringa vendor -> vendor-neutral, nessun marchio hardcoded.
    const _esc = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const vWords = String(vendor||'').trim().split(/\s+/).filter(Boolean);
    const prefixes = [];
    if(vWords[0]) prefixes.push(vWords[0]);
    if(vWords.length >= 2) prefixes.push(vWords.map(w=>w[0]).join(''));
    for(const p of prefixes){
        if(p.length >= 2) m = m.replace(new RegExp('^\\s*'+_esc(p)+'\\b[\\s-]*', 'i'), '');
    }
    m = m.replace(/\s+(android\s*tv|google\s*tv|smart\s*tv|media\s*player|streaming\s*(?:stick|player|box)|network\s*camera|ip\s*camera|webcam|printer|scanner)\s*$/i, '');
    return m.trim();
}
function _discDisplayName(d){
    if(!d) return '';
    // Modello ESATTO: SNMP ENTITY-MIB (switch/router/NAS che lo espongono) o mDNS/UPnP/ONVIF.
    const model = _discCleanModel(d.snmpModel || (d.mdns && d.mdns.model) || '', d.vendor);
    if(model && !_discIsGenericName(model)) return model;
    const host = String(d.hostname || d.netbiosName || '').trim();
    if(host && !_discIsJunkHost(host) && !_discIsGenericName(host)) return host;
    return String(d.ip || '').trim();
}

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

// Pre-selezione: NON spuntare di default le righe a confidenza bassissima — i
// "fantasmi" solo-ping (~10%) prodotti dall'artefatto ping-sweep quando il gateway
// risponde "host unreachable" con exit-code 0 (task_977d2930). Restano VISIBILI (in
// grigio) e selezionabili a mano, ma fuori dall'import di default. Verificato sul lab
// con lo scorer reale: i device reali stanno >=20% (endpoint on-segment ~40%, SNMP
// >=57%, off-segment ARP-SNMP ~20%), i fantasmi ping-only ESATTAMENTE a 10% → 15
// separa senza falsi negativi. Un host con anche solo un MAC (ARP) parte da ~22%.
const DISC_PRESELECT_MIN_CONF = 15;

function openDiscovery(prefillCidr){
    // Il driver resta su 'auto' (rilevamento unificato v2c + v3): NON lo
    // sovrascriviamo col driver di un device esistente, altrimenti un solo
    // device v2c già in mappa disabiliterebbe il rilevamento v3. Prefilliamo
    // solo la community (usata dal tentativo v2c).
    // prefillCidr (opzionale): quando l'utente lancia "Scopri rete" dalla sezione
    // "Reti del progetto" del report Verifica, la subnet arriva già compilata — resta
    // comunque una scansione ESPLICITA (l'utente preme Scansiona, con la sua cadenza
    // anti-IDS). Manual-first: nessuno scan parte da solo.
    if(prefillCidr){
        const sub = document.getElementById('disc-subnet');
        if(sub) sub.value = String(prefillCidr).trim();
    }
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
    store._discSelMap={};
    store._discTypeMap={};
    store._discRunning=false;
    store._discImporting=false;
    document.getElementById('disc-overlay').classList.add('open');
}

function closeDiscovery(){
    document.getElementById('disc-overlay').classList.remove('open');
    if(window._discScanAbort){ window._discScanAbort.abort(); window._discScanAbort=null; }
    if(window._discCrawlAbort){ window._discCrawlAbort.abort(); window._discCrawlAbort=null; }
    store._discRunning = false;
    store._discImporting = false;
}

// Wrapper chiamato dal click sull'overlay scuro (sfondo del modal).
// Se c'e' una scansione/import in corso, NON chiude e non aborta nulla:
// l'utente puo' aver cliccato fuori per sbaglio. Per interrompere
// esplicitamente serve usare il bottone "Annulla" o la X.
function _closeDiscoveryOverlayClick(){
    if(store._discRunning || store._discImporting){
        if(typeof _showToast === 'function'){
            _showToast(_dt('msg.ui.scanInProgress','Scansione in corso. Usa "Annulla" per interrompere.'), 'warn', 3500);
        }
        return;
    }
    closeDiscovery();
}

async function runDiscovery(){
    if(store._discRunning) return;
    const subnet  = document.getElementById('disc-subnet').value.trim();
    // Scan universale: il motore prova v1/v2c/v3 e tiene chi risponde (i v3 senza
    // credenziali vengono rilevati e marcati "da configurare"). Niente selettore
    // versione nel dialogo: solo community (per v1/v2c) e timeout.
    const driver  = 'auto';
    const community = document.getElementById('disc-community').value.trim();
    const timeout = parseInt(document.getElementById('disc-timeout').value)||2;
    // Cadenza scansione a 3 livelli: normal (veloce) · safe (throttle leggero, default) ·
    // stealth (serializzata + jitter = anti-IDS vero, ma lenta). Mappa ai flag del backend:
    // safe copre normal+stealth per i timeout gentili; stealth forza la serializzazione.
    const scanMode = document.getElementById('disc-scan-mode')?.value || 'safe';
    const safeMode = scanMode !== 'normal';
    const stealth  = scanMode === 'stealth';
    const deepScan = !!document.getElementById('disc-deep-scan')?.checked;
    win._saveDeepScanPref(deepScan);
    // mDNS/SSDP: ascolto multicast del segmento locale per i device a porte chiuse. Opt-in.
    const mdns = !!document.getElementById('disc-mdns')?.checked;
    const expandTopology = !!document.getElementById('disc-expand-topology')?.checked;
    if(!subnet){ document.getElementById('disc-progress').innerHTML=`<span class="tm-err">${_dt('disc.enterRange','Inserisci un range di rete.')}</span>`; return; }

    const btn = document.getElementById('disc-scan-btn');
    btn.disabled=true; btn.innerHTML=`<i class="fas fa-spinner fa-spin"></i> ${_dt('disc.scanning','Scansione…')}`;
    document.getElementById('disc-progress').innerHTML=_dt('pnl.disc.scanInProgress','Scansione in corso...');
    document.getElementById('disc-results').style.display='none';
    const ibtn = document.getElementById('disc-import-btn');
    if(ibtn) ibtn.disabled = true;
    store._discRunning = true;
    store._discSelMap = {};
    store._discTypeMap = {};

    let scanTimeout=null;
    try{
        const scanAbort = new AbortController();
        window._discScanAbort = scanAbort;
        // Furtiva = serializzata + pause: molto piu' lenta → timeout client generoso (10 min)
        // altrimenti abortirebbe su subnet non piccole.
        scanTimeout = setTimeout(()=>scanAbort.abort(), stealth ? 600000 : (deepScan ? 180000 : 90000));
        const r = await fetch('/api/discover',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ subnet, driver, community, timeout, safeMode, stealth, deepScan, mdns,
                dhcpLeases: Array.isArray(store._dhcpLeases) ? store._dhcpLeases : [] }),
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

            // Il crawl LLDP/CDP puo' durare decine di secondi (poll SNMP per switch +
            // macsuck a fine giro): il pulsante resta in "Espansione…" con la rotella e
            // il progress fa da battito-cardiaco, cosi' NON sembra finito (l'utente stava
            // per chiudere la finestra). La label distinta dalla "Scansione…" della fase 1.
            btn.innerHTML=`<i class="fas fa-spinner fa-spin"></i> ${_dt('disc.expanding','Espansione…')}`;
            await _runCrawlPhase(store._discResults.filter(d=>d.snmpReachable).map(d=>d.ip), driver, community, timeout, subnet);

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
        store._discRunning = false;
        btn.disabled=false; btn.innerHTML=`<i class="fas fa-search"></i> ${_dt('disc.scan','Scansiona')}`;
        _discUpdateImportBtn();
    }
}

function _discKey(d){
    return String(d?.ip || d?.hostname || '').trim().toLowerCase();
}

// Etichetta Vendor per la tabella. Se il server ha risolto un vendor (incluso il
// "Private" degli OUI IEEE riservati) lo mostra invariato. Se e' VUOTO ma il MAC e'
// randomizzato (bit locally-administered 0x02, tipico dei BYOD/telefoni con privacy
// MAC) mostra un'etichetta ONESTA invece di "—": non esiste un OUI reale, ma diciamo
// perche'. isRandomizedMac = lib mac-class (window global, caricato prima del bundle).
function _discVendorLabel(d){
    if(d && d.vendor) return d.vendor;
    if(d && d.mac && typeof isRandomizedMac === 'function' && isRandomizedMac(d.mac))
        return _dt('disc.vendor.random','Privato · MAC casuale');
    return '—';
}

function _discEnsureMeta(d){
    const row = { ...(d || {}) };
    // MAC in forma canonica (MAIUSCOLO con ':') per TUTTE le sorgenti: lo sweep lo
    // dava gia' maiuscolo, l'ARP-SNMP/crawl minuscolo → in tabella si vedevano case
    // miste e (peggio) lo stesso device sfuggiva a un eventuale dedup per-MAC.
    if(row.mac) row.mac = normalizeMacAddress(row.mac) || row.mac;
    // Sorgente DHCP (lease importato): il server marca dhcpLease/viaProtocol=DHCP.
    // La marchiamo _via:'dhcp' per badge sorgente + stato "Osservato" coerenti.
    if(!row._via && (row.dhcpLease === true || String(row.viaProtocol||'').toUpperCase()==='DHCP')) row._via = 'dhcp';
    const ouiVendor = _discVendorFromMac(row.mac);
    if(!row.vendor) row.vendor = ouiVendor;
    row.vendorHint = row.vendorHint || ouiVendor || '';
    if(!row.hostname && row.netbiosName) row.hostname = row.netbiosName;
    if(!row.displayName) row.displayName = row.hostname || row.ip || '';
    // CONSOLIDAZIONE — un solo classificatore autorevole. Il SERVER (FusionScorer +
    // engine sysObjectID/OUI + guardrail vendor≠tipo) è ora il motore di riferimento:
    // ci si fida della sua classe ogni volta che ha trovato un segnale REALE — SNMP/
    // objectId, score meta alto, O una confidenza fusion SOPRA il floor dei fallback
    // baseline (15/20/25 = "non so"). Il `_guessType` client resta SOLO come rete di
    // sicurezza quando il server è a livello baseline (device muto/sconosciuto); la
    // `_discSanitizeDeviceClass` resta un raffinamento manual-first (ramo AP, declass).
    // B3 — un SOLO classificatore autorevole: il SERVER. Il FusionScorer restituisce
    // SEMPRE una classe (anche il fallback a bassa confidenza) usando TUTTI i segnali
    // misurati + il guardrail vendor≠tipo; è per costruzione >= dell'euristica sottile
    // del client. Quindi ci si fida della classe server ogni volta che c'è, e il client
    // NON ri-classifica piu' con le sue tabelle regex (era la fonte della divergenza:
    // es. una TV a bassa confidenza riscritta a "switch"). `_guessType` resta SOLO per
    // il caso-limite in cui il server non produce alcuna classe. Gli override
    // MANUAL-FIRST (nodo già nel progetto / hint salvato) vincono sempre, sopra tutto.
    const serverClass = row.deviceClass || row.discovery?.deviceClass || '';
    if(serverClass){
        row.deviceClass = serverClass;
    } else if(!row.deviceClass){
        row.deviceClass = win._guessType(row.descr, row.objectId, row.vendor, row.httpTitle||row.httpsTitle, row.hostname);
    }
    // Override manual-first (tipo di un nodo già esistente / hint utente) — sempre,
    // anche sopra la classe server. Se il server non era autorevole, applica anche il
    // raffinamento regex (ramo AP/declass) come rete di sicurezza sui device muti.
    const _srvSure = !!(row.snmpReachable || row.objectId || (parseInt(row?.classification?.confidence ?? 0,10)||0) > 25);
    const _refined = win._discSanitizeDeviceClass(row, { manualOnly: _srvSure });
    if(_refined) row.deviceClass = _refined;
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
        store._discSelMap[key] = !!chk.checked;
        const sel = tr.querySelector('.disc-type');
        if(sel) store._discTypeMap[key] = sel.value;
    });
}

function _discUpdateImportBtn(){
    const ibtn = document.getElementById('disc-import-btn');
    if(!ibtn) return;
    const selected = document.querySelectorAll('.disc-chk:checked').length;
    ibtn.disabled = selected===0 || store._discRunning || store._discImporting;
}

function _discOnRowToggle(chk){
    const idx = parseInt(chk?.dataset?.idx,10);
    const row = store._discResults[idx];
    const key = _discKey(row);
    if(key) store._discSelMap[key] = !!chk.checked;
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
    if(key) store._discTypeMap[key] = sel.value;
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
    // Candidato ARP-SNMP: badge dedicato (host visto nell'ARP di uno switch, non locale).
    if(d?._via === 'arp') return { label:'ARP', cls:'arp', title:_dt('disc.tip.arpSnmp','Visto nell\'ARP SNMP di uno switch/router — host off-segment, non confermato via ping/SNMP diretto') };
    // Candidato da lease DHCP importato: binding IP/MAC (+ hostname) su tutte le VLAN.
    if(d?._via === 'dhcp') return { label:'DHCP', cls:'dhcp', title:_dt('disc.tip.dhcpSrc','Da un lease DHCP importato — binding IP/MAC autorevole su tutte le VLAN; host non confermato attivo ora (mobile/IoT che puo\' essere in standby)') };
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
    if(d?._via === 'arp'){
        return { label:_dt('disc.reach.observed','Osservato'), cls:'seen', title:_dt('disc.tip.arpObserved','Host presente nell\'ARP di uno switch/router SNMP; ping/SNMP diretti non confermati') };
    }
    if(d?._via === 'dhcp'){
        return { label:_dt('disc.reach.observed','Osservato'), cls:'seen', title:_dt('disc.tip.dhcpObserved','Presente in un lease DHCP; ping/SNMP diretti non confermati (host mobile/IoT che puo\' essere in standby)') };
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
        const t = store._discTypeMap[key] || guessed;
        const opts = Object.entries(TYPES)
            .filter(([,v])=>v.isActive || v.hasIP)
            .map(([k])=>[k, typeName(k)])
            .sort((a,b)=>a[1].localeCompare(b[1],undefined,{sensitivity:'base'}))
            .map(([k,label])=>`<option value="${k}"${k===t?' selected':''}>${escapeHTML(label)}</option>`)
            .join('');
        const src = _discSourceInfo(d);
        const conf = _discConfidenceInfo(d);
        const rec = _discReconcileInfo(d, t);
        // Flag SNMP-versione (🔑 v3 da configurare / +v3): breve e SUBITO dopo la
        // sorgente SNMP (sono attributi della sorgente) → niente badge lungo che va a
        // capo. Il testo esteso resta nel tooltip.
        const _v3cred = d.needsCredentials
            ? ` <span class="disc-badge v3-cred" data-tip="${escapeHTML(_dt('disc.tip.v3cred','SNMPv3 rilevato senza credenziali — dopo l\'import configura utente/password nel pannello Integrazione, poi fai Sync'))}"><i class="fas fa-key"></i> ${escapeHTML(_dt('disc.v3cred','v3'))}</span>`
            : '';
        // Dual-config: risponde a v2c (con dati) MA supporta anche v3 → lo segnalo
        // (e implicitamente che v2c è esposto). Niente 🔑: via v2c funziona.
        const _v3also = ((d.snmpVersions||[]).includes('snmp-v3') && d.snmpDriver!=='snmp-v3' && !d.needsCredentials)
            ? ` <span class="disc-badge v3-also" data-tip="${escapeHTML(_dt('disc.tip.alsoV3','Supporta anche SNMPv3; interrogato via la versione con i dati. Attenzione: v2c è attivo/esposto — valuta di disattivarlo e passare a v3.'))}"><i class="fas fa-key"></i> ${escapeHTML(_dt('disc.alsoV3','+v3'))}</span>`
            : '';
        const badges = ` <span class="disc-badge src-${src.cls}" data-tip="${escapeHTML(src.title)}">${escapeHTML(src.label)}</span>`
            + _v3cred + _v3also
            + ` <span class="disc-badge conf-${conf.cls}" data-tip="${escapeHTML(conf.title)}">${escapeHTML(conf.label)} ${conf.score}%</span>`
            + ` <span class="disc-badge rec-${rec.cls}" data-tip="${escapeHTML(rec.title)}">${escapeHTML(rec.label)}</span>`
            + _discEdgeBadge(d);
        const reach = _discReachabilityInfo(d);
        const displayName = _discDisplayName(d);
        // Pre-selezione = vivo E confidenza sopra la soglia fantasmi (i solo-ping a
        // ~10% NON si spuntano di default). L'utente puo' sempre spuntarli a mano.
        const _lowConf = !!d.alive && (conf.score || 0) < DISC_PRESELECT_MIN_CONF;
        const canImport = !!d.alive && (conf.score || 0) >= DISC_PRESELECT_MIN_CONF;
        const checked = Object.prototype.hasOwnProperty.call(store._discSelMap,key) ? !!store._discSelMap[key] : canImport;
        const _rowCls = [d.alive ? '' : 'disc-off', _lowConf ? 'disc-lowconf' : ''].filter(Boolean).join(' ');
        return `<tr class="${_rowCls}">
          <td><input type="checkbox" class="disc-chk" data-idx="${i}" onchange="_discOnRowToggle(this)" ${checked?'checked':''}></td>
          <td><span class="disc-st ${reach.cls}" data-tip="${escapeHTML(reach.title)}">${escapeHTML(reach.label)}</span></td>
          <td class="disc-host">${escapeHTML(displayName)}${badges}</td>
          <td class="disc-ip">${escapeHTML(d.ip)}</td>
          <td class="disc-vendor">${escapeHTML(_discVendorLabel(d))}</td>
          <td class="disc-mac">${escapeHTML(d.mac||'—')}</td>
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

// Riga-risultato per un device scoperto via CRAWL LLDP/CDP. Preserva i campi GIA'
// risolti dal backend (vendor da sysObjectID, hostname, deviceClass, objectId...) e
// mette a default SOLO i campi realmente assenti. Il BUG storico era `vendor:''`
// (e `mac:''`) messi DOPO lo spread `...device`: azzeravano il vendor gia' dedotto
// dal backend (es. Cisco da PEN 9) su OGNI vicino LLDP/CDP → colonna Vendor "—".
// Puro e testabile (nessun IO/DOM); il chiamante lo passa a _discEnsureMeta.
function _discCrawlRow(device, protocol){
    const d = device || {};
    return {
        ...d, _via:'lldp',
        viaProtocol: d.viaProtocol || protocol || '',
        alive:true, status:'On', snmpReachable:true,
        mac: d.mac || '', vendor: d.vendor || '',
        httpTitle: d.httpTitle || '', httpsTitle: d.httpsTitle || '',
    };
}

// Riga-risultato per un candidato "solo ARP": host visto nella ipNetToMediaTable
// di uno switch/router SNMP ma muto a ping/SNMP/LLDP (VPCS, off-segment). Il
// backend l'ha gia' decorato (vendor OUI, tipo, sorgenti); qui lo marchiamo
// _via:'arp', teniamo snmpReachable/alive a false (osservato, NON pre-selezionato)
// e lo RIFINIAMO con i lease DHCP gia' importati (store._dhcpLeases): se il MAC/IP
// e' in un lease -> hostname reale + un filo di confidenza in piu' (visto in ARP E
// in DHCP = host vero, non voce ARP stantia). Puro, testabile.
function _discArpRow(device){
    const d = device || {};
    const row = { ...d, _via:'arp', snmpReachable:false, alive:false };
    const leases = Array.isArray(store._dhcpLeases) ? store._dhcpLeases : [];
    if(leases.length){
        const mac = String(row.mac||'').toLowerCase();
        const ip  = String(row.ip||'');
        const hit = leases.find(l => (mac && String(l.mac||'').toLowerCase()===mac) || (ip && String(l.ip||'')===ip));
        if(hit){
            if(!row.hostname && hit.hostname) row.hostname = hit.hostname;
            row._dhcpMatched = true;
            if(row.confidence && Number.isFinite(row.confidence.score)){
                const score = Math.min(100, row.confidence.score + 15);
                row.confidence = { score, level: score>=70?'high':score>=35?'mid':'low' };
            }
            row.reasonCodes = [...(Array.isArray(row.reasonCodes)?row.reasonCodes:[]), 'dhcp-lease'];
        }
    }
    return _discEnsureMeta(row);
}

// macsuck: applica gli edge (MAC -> porta di accesso switch) alle righe scoperte,
// match per MAC normalizzato lowercase. Indizio MANUAL-FIRST (reso come badge; su
// import diventera' il suggerimento di cavo). Ritorna quante righe localizzate.
function _discApplyEdges(edges){
    if(!edges || typeof edges !== 'object') return 0;
    let n = 0;
    for(const d of (store._discResults || [])){
        const m = String((d && d.mac) || '').trim().toLowerCase();
        if(m && edges[m]){ d.edge = edges[m]; n++; }
    }
    return n;
}

// Badge "porta di accesso" dal macsuck (es. SW-CORE · Gi0/5). ambiguous → tinta
// d'avviso. Il MAC compare su piu' porte allo stesso peso = da verificare.
function _discEdgeBadge(d){
    const e = d && d.edge;
    if(!e || !e.ifName) return '';
    const sw = e.switchName || e.switchIp || _dt('disc.edge.switch','switch');
    // SHARED: il MAC pende DIETRO questa porta (AP/switch non gestito, molti MAC) →
    // indizio piu' debole, badge "dietro …" tenue. Non e' un cavo diretto.
    if(e.shared){
        const tip = _dt('disc.tip.edgeShared','Visto DIETRO questa porta (segmento condiviso: {n} MAC, probabile AP o switch non gestito) — non un collegamento diretto',{n:e.macCount});
        return ` <span class="disc-badge loc loc-shared" data-tip="${escapeHTML(tip)}"><i class="fas fa-diagram-project"></i> ${escapeHTML(_dt('disc.edge.behind','dietro') + ' ' + sw + ' · ' + e.ifName)}</span>`;
    }
    // EDGE: collegamento diretto (o quasi) a questa porta.
    const tip = e.ambiguous
        ? _dt('disc.tip.edgeAmb','Porta di accesso dedotta dalla MAC-table (FDB), ma il MAC compare su piu\' porte allo stesso peso — verifica')
        : _dt('disc.tip.edge','Porta di accesso dedotta dalla MAC-table (FDB) dello switch');
    return ` <span class="disc-badge loc${e.ambiguous?' loc-amb':''}" data-tip="${escapeHTML(tip)}"><i class="fas fa-location-dot"></i> ${escapeHTML(sw + ' · ' + e.ifName)}</span>`;
}

async function _runCrawlPhase(seeds, driver, community, timeout, scanCidr){
    if(!seeds.length) return;
    // Dedup: parti dagli IP GIA' presenti (semi + tutto lo sweep principale in
    // store._discResults). Senza gli IP dello sweep, un host gia' trovato e poi
    // ripescato dalla ARP-SNMP di uno switch (o annunciato via LLDP/CDP) veniva
    // RI-proposto come riga duplicata (es. .178 sweep "HP" + .178 ARP-SNMP "Canon").
    const knownIps = new Set(seeds);
    // macsuck: passo al server i MAC gia' scoperti (sweep) come targetMacs → li
    // localizza sulla porta switch e rimanda un evento 'located'. Lowercase per
    // combaciare con le chiavi normalizzate del server.
    const targetMacs = [];
    for(const d of (store._discResults || [])){
        if(d && d.ip) knownIps.add(String(d.ip).trim());
        const m = String((d && d.mac) || '').trim().toLowerCase();
        if(m) targetMacs.push(m);
    }
    // Battito-cardiaco fase 2: aggiorna il progress a ogni evento del crawl (device
    // interrogato + quanti localizzati su porta) → attivita' VISIBILE per i ~30s del
    // crawl, cosi' non sembra bloccato/finito.
    let _foundN = 0, _locatedN = 0, _lastIp = '';
    const _prog = document.getElementById('disc-progress');
    const _hb = ip => {
        if(ip) _lastIp = String(ip);
        if(!_prog) return;
        _prog.innerHTML = `<span class="tm-ok"><i class="fas fa-spinner fa-spin"></i> ` +
            _dt('disc.expandingLive','Espansione LLDP/CDP… {ip} · {n} via LLDP/CDP · {m} localizzati su porta',{ip:_lastIp,n:_foundN,m:_locatedN}) + `</span>`;
    };
    let crawlAbort = null;

    try{
        crawlAbort = new AbortController();
        window._discCrawlAbort = crawlAbort;

        const resp = await fetch('/api/discover/topology',{
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ seeds, driver, community, timeout, maxDepth:5, scanCidr,
                targetMacs, dhcpLeases: Array.isArray(store._dhcpLeases) ? store._dhcpLeases : [] }),
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
                    store._discResults.push(_discEnsureMeta(_discCrawlRow(evt.device, evt.protocol)));
                    _foundN++; _discRenderTable(); _hb(evt.device.ip);
                } else if(evt.type==='arp' && evt.device && !knownIps.has(evt.device.ip)){
                    // Candidato off-segment dalla ARP-SNMP di uno switch (no ping/SNMP diretto).
                    knownIps.add(evt.device.ip);
                    store._discResults.push(_discArpRow(evt.device));
                    _foundN++; _discRenderTable(); _hb(evt.device.ip);
                } else if(evt.type==='located' && evt.edges){
                    // macsuck: il server ha localizzato i MAC scoperti su porta switch.
                    _discApplyEdges(evt.edges);
                    _locatedN = Object.keys(evt.edges).length;
                    _discRenderTable(); _hb();
                } else if(evt.type==='probing'){
                    // Battito: mostra il device che sto interrogando (poll SNMP lento).
                    _hb(evt.ip);
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
        if(key) store._discSelMap[key] = !!val;
    });
    _discUpdateImportBtn();
}

async function importDiscovered(){
    if(store._discRunning || store._discImporting) return;
    store._discImporting = true;
    _discUpdateImportBtn();
    const ibtn = document.getElementById('disc-import-btn');
    const sbtn = document.getElementById('disc-scan-btn');
    if(ibtn) ibtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${_dt('pnl.disc.adding','Aggiungo...')}`;
    if(sbtn) sbtn.disabled = true;
    const rows = document.querySelectorAll('#disc-tbody tr');
    if(!rows.length){
        store._discImporting=false;
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
        // Tipo scelto a mano = dropdown diverso dal tipo indovinato per quella riga
        // (stesso calcolo del render, ~riga 438). Serve a pinnare node.typeManual
        // (manual-first): le Verifiche/import futuri non lo ricambieranno da soli.
        const guessed = base.deviceClass || (typeof _guessType==='function'
            ? _guessType(base.descr, base.objectId, base.vendor, base.httpTitle||base.httpsTitle, base.hostname) : '');
        win._discRememberClassHint(base, type);
        toImport.push({ ...base, type, _typeManual: !!guessed && type !== guessed });
    });
    if(!toImport.length){
        store._discImporting=false;
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
        // Guardie di merge (F5): un MAC "next-hop" — gateway L3-lite documentato, oppure
        // stesso MAC su piu' IP nel batch di Scopri (cross-subnet) — NON e' una chiave di
        // identita' affidabile → non fondere per-MAC su di esso, ripiega su hostname/IP
        // (il gateway stesso matcha per il suo IP). Sono le STESSE guardie del percorso di
        // preview/render (_discAttachMergeGuards): sharedMacs e' calcolato sull'INTERO
        // batch (store._discResults), cosi' un singolo host remoto non perde la
        // condivisione del MAC-gateway e badge preview ↔ esito import coincidono.
        if(typeof _discAttachMergeGuards === 'function') _discAttachMergeGuards(existingIdx);

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
                foundExisting.vendorHint = d.vendorHint || _discVendorFromMac(d.mac) || foundExisting.vendorHint || '';
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
                // Hostname manual-first come il Sync (app-snmp.js:453): mai sovrascrivere
                // un hostname pinnato a mano (hostnameManual). Riempi se vuoto, o aggiorna
                // su identita' forte solo quando NON e' bloccato.
                if(!foundExisting.hostnameManual && (!foundExisting.hostname || shouldRefreshIdentity)){
                    foundExisting.hostname = d.hostname || foundExisting.hostname || '';
                }
                foundExisting.mac = foundExisting.mac || normalizeMacAddress(d.mac||'');
                // Brand fill-if-empty (o se e' ancora il brand di default del tipo) come il
                // Sync (app-snmp.js:457-458): il vendor OUI/SNMP non clobbera mai un brand
                // scritto a mano. L'eventuale cambio vendor su identita' forte resta
                // tracciato in discoveryConflicts/possibleReplacement (sopra), non applicato.
                if(d.vendor){
                    const _defBrand = TYPES[foundExisting.type]?.brand || '';
                    const _brandNow = String(foundExisting.brand || '').trim();
                    if(!_brandNow || _brandNow === _defBrand) foundExisting.brand = d.vendor;
                }
                foundExisting.netbiosName = foundExisting.netbiosName || d.netbiosName || '';
                foundExisting.netbiosGroup = foundExisting.netbiosGroup || d.netbiosGroup || '';
                if(!Array.isArray(foundExisting.smbShares) || !foundExisting.smbShares.length) foundExisting.smbShares = Array.isArray(d.smbShares) ? d.smbShares : [];
                // Tipo: manual-first. Se l'utente ha scelto il tipo a mano nel dialogo
                // (_typeManual) vince ed e' pinnato -> Verifiche/import futuri non lo
                // ricambiano. Altrimenti l'auto-retype euristico agisce solo su un tipo
                // NON pinnato (rispetta un typeManual gia' fissato).
                const _applyRetype = d._typeManual
                    ? (foundExisting.type !== d.type)
                    : (win._discCanAutoRetype(foundExisting.type, d.type) &&
                       shouldRefreshIdentity && score >= 70 && !foundExisting.typeManual);
                if(_applyRetype){
                    const prevType = foundExisting.type;
                    foundExisting.type = d.type;
                    const prevDefaultPorts = TYPES[prevType]?.ports || 0;
                    const nextDefaultPorts = TYPES[d.type]?.ports || 0;
                    if(!foundExisting.ports || foundExisting.ports === prevDefaultPorts){
                        foundExisting.ports = nextDefaultPorts || foundExisting.ports;
                    }
                }
                if(d._typeManual) foundExisting.typeManual = true;
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
                _discIndexNode(existingIdx, foundExisting);
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
                    id: _nextNodeId(d.type, usedNodeIds), type: d.type,
                    name: _discDisplayName(d), hostname: d.hostname||'', ip: d.ip||'',
                    mac: normalizeMacAddress(d.mac||''),
                    brand: d.vendor || def.brand || '',
                    vendorHint: d.vendorHint || _discVendorFromMac(d.mac) || '',
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
                    id: _nextNodeId(d.type, usedNodeIds), type: d.type,
                    name: _discDisplayName(d), hostname: d.hostname||'', ip: d.ip||'',
                    mac: normalizeMacAddress(d.mac||''),
                    brand: d.vendor || def.brand || '',
                    vendorHint: d.vendorHint || _discVendorFromMac(d.mac) || '',
                    identitySource: win._discIdentitySource(d),
                    identityConfidence: d.identityConfidence || d.confidence?.level || 'low',
                    possibleReplacement: !!d.possibleReplacement,
                    netbiosName: d.netbiosName || '',
                    netbiosGroup: d.netbiosGroup || '',
                    smbShares: Array.isArray(d.smbShares) ? d.smbShares : [],
                    rackId, rackU, sizeU: sU, ports: def.ports||0, integration,
                };
            }
            if(d._typeManual) n.typeManual = true;   // tipo scelto a mano nel dialogo = pinnato
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
            _discIndexNode(existingIdx, n);
            if(_isLeafEndpoint(d.type)) _importedEndpoints.push(n);
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
            focusNode(first);
        } else if(imported - floorCount > 0){
            switchRack(rackId);
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
        store._discImporting=false;
        if(ibtn) ibtn.innerHTML = `<i class="fas fa-file-import"></i> ${_dt('pnl.disc.addSelected','Aggiungi selezionati')}`;
        if(sbtn) sbtn.disabled = false;
        _discUpdateImportBtn();
    }
}

expose({
    openDiscovery, closeDiscovery, _closeDiscoveryOverlayClick, runDiscovery,
    discSelectAll, importDiscovered, _discOnRowToggle, _discOnTypeChange,
    _discExistingNode, _discRenderTable, _discCrawlRow, _discArpRow, _discVendorLabel,
    _discApplyEdges, _discEdgeBadge,
});
