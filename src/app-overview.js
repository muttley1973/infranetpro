// ============================================================
// PANORAMICA — vista di sintesi (Completo · Vero · Margine)   [modulo ESM]
// ------------------------------------------------------------
// Glue fra lo stato del progetto e lib/overview.js: costruisce il modello,
// chiede i FATTI alla lib pura e li rende in tre colonne che stanno in UNA
// schermata. Sola lettura: non modifica nulla, non chiama mai markDirty.
//
// Divisione dei compiti ("InfraNet calcola, l'app racconta"):
//   • lib/overview.js  → numeri, elenchi, provenienza. Nessuna stringa UI.
//   • questo modulo    → parole (i18n), DOM, interazione.
// Cosi' la stessa lib serve it/en e i test non dipendono dalla lingua.
//
// Dipendenze: i motori sono gia' <script> in netmapper.html → si leggono dal
// PONTE (buildSpareReport, deriveProjectNetworks, computeDeviceCapabilities…).
// Importarli da ../lib li ri-bundlerebbe congelando uno snapshot al build.
// lib/overview.js NON e' uno <script>: quello si importa via ESM (come node-label).
// ============================================================
import { t, expose, buildSpareReport, deriveProjectNetworks, computeDeviceCapabilities, computeFleetCapabilities } from './_bridge.js';
import { store } from './store.js';
import { TYPES, _frontPanelSfpGroups } from './app-types.js';
import { _isLeafEndpoint } from './app-autolink.js';
import { nodeById, getNodeDisplayName, _linksForPort, switchRightTab } from './app.js';
import { focusNode } from './app-search-zoom-rack.js';
import { _snmpFreshness } from './app-snmp.js';
import { _driftRowHtml, _driftNetworksSection } from './app-drift.js';   // B3/B4: drill-down inline «Vero» riusa righe+azioni e la sezione «Reti» del Drift
import { registerClickActions } from './app-delegation.js';
import { setPropsSectionState } from './app-properties.js';   // click «Subnet»/«Indirizzi liberi» → pannello VLAN (dove le reti si DICHIARANO)
import { buildOverview, _rackFill } from '../lib/overview.js';

// La vista corrente e' una preferenza DELL'UTENTE su QUESTA macchina, non un
// dato del progetto: se vivesse in `state` riaprirebbe il bug chiuso il
// 2026-07-23 (guardare la topologia marcava il documento come non salvato).
const VIEW_KEY = 'infranet.view';

// Riga aperta PER SEZIONE (sec -> key). Vive fuori dal DOM perche' deve
// sopravvivere ai re-render: un poll SNMP in background chiama renderAll, e un
// dettaglio che si richiude da solo mentre lo stai leggendo e' inaccettabile.
const _open = new Map();

// Scheda attiva PER DETTAGLIO raggruppato (sec:key -> group). Come `_open`, vive
// fuori dal DOM cosi' la scelta della scheda («In rack»/«Fuori rack») sopravvive
// ai re-render di background.
const _grpTab = new Map();

function _savedView() {
    try { return localStorage.getItem(VIEW_KEY) || ''; } catch (_) { return ''; }
}
function _saveView(v) {
    try { localStorage.setItem(VIEW_KEY, v || ''); } catch (_) { /* storage negato: pazienza */ }
}

// La LENTE della Panoramica: '' = Sintesi (le 3 colonne) · 'recovery' =
// «Ripristinabilità». Come la vista, è una preferenza LOCALE (localStorage per
// macchina), MAI in `state`: cambiare lente non deve sporcare il documento.
const LENS_KEY = 'infranet.ov.lens';
function _savedLens() {
    try { return localStorage.getItem(LENS_KEY) === 'recovery' ? 'recovery' : 'summary'; } catch (_) { return 'summary'; }
}
function _saveLens(v) {
    try { localStorage.setItem(LENS_KEY, v === 'recovery' ? 'recovery' : ''); } catch (_) { /* storage negato: pazienza */ }
}

// Delta «dall'ultima lettura»: la baseline vive in localStorage (per progetto),
// MAI in state — guardare non deve sporcare il documento (stesso paletto della
// vista). Ancorata a lastSyncAt: cosi' il delta riflette il cambio fra DUE Sync,
// non il rumore dei re-render (a syncAt invariato si ripresenta il delta salvato).
const SNAP_KEY = 'infranet.ov.snap';
function _loadSnap(pid) {
    try { return JSON.parse(localStorage.getItem(SNAP_KEY + '.' + pid) || 'null'); } catch (_) { return null; }
}
function _saveSnap(pid, obj) {
    try { localStorage.setItem(SNAP_KEY + '.' + pid, JSON.stringify(obj)); } catch (_) { /* storage negato: pazienza */ }
}
// Metrica confrontabile per colonna = health.issues (piu' basso = meglio, uniforme
// per le tre sezioni). Ritorna { complete, truth, margin } (differenze; negativo =
// migliorato) o null se manca una lettura o una baseline con cui confrontare.
function _overviewDelta(pid, o, syncAt) {
    if (!syncAt) return null;                       // mai letto → niente da confrontare
    const cur = {
        complete: (o.complete.health && o.complete.health.issues) || 0,
        truth: (o.truth.health && o.truth.health.issues) || 0,
        margin: (o.margin.health && o.margin.health.issues) || 0,
    };
    const snap = _loadSnap(pid);
    if (!snap || !snap.counts) { _saveSnap(pid, { syncAt, counts: cur, delta: null }); return null; }
    if (snap.syncAt === syncAt) return snap.delta || null;   // stessa lettura → delta persistito
    const delta = {
        complete: cur.complete - (Number(snap.counts.complete) || 0),
        truth: cur.truth - (Number(snap.counts.truth) || 0),
        margin: cur.margin - (Number(snap.counts.margin) || 0),
    };
    _saveSnap(pid, { syncAt, counts: cur, delta });          // ri-ancora alla lettura nuova
    return delta;
}

// ── Modello per la lib ───────────────────────────────────────────────────────
// Un solo giro sui nodi: costruisce insieme i device per il report porte libere,
// il conteggio delle porte in fibra e le capacita' hardware per apparato.
function _buildModel() {
    const st = store.state || {};
    const nodes = Array.isArray(st.nodes) ? st.nodes : [];
    const ports = st.ports || {};
    const rackName = (id) => { const r = (st.racks || []).find((x) => x && x.id === id); return r ? (r.name || id) : id; };

    const spareDevices = [];
    const caps = [];
    const portMacNodeIds = new Set();
    // MAC→id nodo (chiave esadecimale, STESSA norm della lib _macKey): serve a
    // risolvere a nome i vicini LLDP/CDP che si annunciano solo col chassis-id
    // MAC. Copre node.mac + MAC di porta + MAC di LAG (primo che vince).
    const macToNode = {};
    const ipToNode = {};   // IP→id nodo (primo che vince): risolve le observation di discovery al nodo per la presenza temporale (lente DR)
    const _macKey = (v) => { const h = String(v || '').toLowerCase().replace(/[^0-9a-f]/g, ''); return h.length === 12 ? h : ''; };
    const _rememberMac = (mac, id) => { const k = _macKey(mac); if (k && !(k in macToNode)) macToNode[k] = id; };
    let sfpTotal = 0;
    for (const n of nodes) {
        if (!n) continue;
        const def = TYPES[n.type] || {};
        const pc = (n.ports !== undefined) ? n.ports : (def.ports || 0);
        _rememberMac(n.mac, n.id);
        { const _ipv = String(n.ip || '').trim(); if (_ipv && !(_ipv in ipToNode)) ipToNode[_ipv] = n.id; }

        // Capacita' HW: lo spec e' la fonte, le porte servono a PoE/LAG/banda.
        // ⚠️ `ports` vuole la forma { list, total, free } — un array nudo fa
        // ritornare null a `_portsCap` e la banda uplink sparisce in silenzio
        // (era il caso fino al 2026-07-23: il riquadro diceva «velocità assenti»
        // mentre 76 porte su 84 avevano la velocità MISURATA dal Sync).
        // Stessa forma del chiamante canonico, server/ai/context.js:_collectPorts.
        const capPorts = [];
        const cabled = [];
        let freePorts = 0;
        for (let i = 1; i <= pc; i++) {
            const pid = n.id + '-' + i;
            const p = ports[pid] || {};
            // Su un apparato SNMP il MAC arriva per INTERFACCIA: `node.mac` resta
            // vuoto mentre le porte hanno il loro ifPhysAddress. Vale come identita'
            // L2 documentata quanto il MAC di chassis.
            if (String(p.mac || '').trim()) { portMacNodeIds.add(n.id); _rememberMac(p.mac, n.id); }
            cabled[i] = _linksForPort(pid).length > 0;
            if (!cabled[i]) freePorts++;
            capPorts.push({
                speed: (p.speedOvr != null) ? p.speedOvr : (p.speed != null ? p.speed : null),
                status: p.statusOvr || p.status || null,
                lagGroup: p.lagGroup || null,
                poe: (p.snmpPoe != null) ? p.snmpPoe : null,
            });
        }
        for (const l of ((n.integration && n.integration.lags) || [])) {
            if (l && String(l.mac || '').trim()) { portMacNodeIds.add(n.id); _rememberMac(l.mac, n.id); }
        }
        const c = computeDeviceCapabilities({
            type: n.type, spec: n.spec, radios: n.radios, vmsCount: (n.vms || []).length,
            ports: pc ? { list: capPorts, total: pc, free: freePorts } : undefined,
            lagNames: st.lagGroups || {}, lagModes: st.lagModes || {},
        });
        if (c) caps.push({ id: n.id, caps: c });

        // Porte libere: solo infrastruttura (un PC non e' capacita' disponibile).
        if (_isLeafEndpoint(n.type) || !pc) continue;
        const sfp = new Set();
        for (const g of _frontPanelSfpGroups(n, pc)) for (const p of (g.ports || [])) sfp.add(p);
        const responded = n.snmpStatus === 'ok';
        const list = [];
        for (let i = 1; i <= pc; i++) {
            const pid = n.id + '-' + i;
            const pi = ports[pid] || {};
            if (pi.hidden) continue;
            const kind = sfp.has(i) ? 'sfp' : 'access';
            if (kind === 'sfp') sfpTotal++;
            // `cabled[i]` è già stato risolto nel giro sopra: `_linksForPort` costa
            // una scansione dei link, chiederla due volte per porta si sente a 500 nodi.
            list.push({ pid, kind, cabled: !!cabled[i], activeSnmp: responded && pi.status === 'active' });
        }
        if (list.length) {
            spareDevices.push({ id: n.id, name: getNodeDisplayName(n) || n.id, rackId: n.rackId || null, rackName: rackName(n.rackId), ports: list });
        }
    }

    const vlanIdsInUse = [...new Set(Object.keys(ports).map((k) => (ports[k] || {}).vlan).filter(Boolean))];
    // Il riempimento rack lo calcola la lib PURA (_rackFill), non questo glue: era
    // una cucitura non testata, e li' viveva il bug del denominatore — leggeva
    // `r.units || r.u`, campi che sul rack non esistono (il vero e' `sizeU`), quindi
    // il totale cadeva SEMPRE a 42. Ora la funzione pura, coperta da test, legge sizeU.
    const rackFill = _rackFill(st.racks, nodes, TYPES);

    // Le reti /24 OSSERVATE dagli indirizzi documentati (l'IPAM dichiarato può
    // essere vuoto). Se il motore non c'è o inciampa, la riga resta "non
    // dichiarato": mai un elenco inventato al suo posto.
    let networks;
    try { networks = (deriveProjectNetworks({ nodes, types: TYPES }) || {}).networks || []; } catch (_) { networks = []; }

    // Presenza per apparato (advisory, lente «Ripristinabilità»): piega le observation
    // di discovery sul nodo — via MAC noto o IP — e ne ricava «visto di recente» vs
    // «stantìo» dall'ultimo avvistamento. INLINE di proposito: temporal-confidence.js è
    // un <script> (regola del ponte: non ri-bundlarlo via ESM), e alla lente DR basta il
    // fatto binario live/stale, non lo score pieno. Soglia = STALE_DAYS del lib (30gg).
    const PRESENCE_STALE_DAYS = 30;
    const _obs = (st.discoveryHistory && Array.isArray(st.discoveryHistory.observations)) ? st.discoveryHistory.observations : [];
    const _lastSeenByNode = {};
    for (const o of _obs) {
        if (!o) continue;
        const k = _macKey(o.mac);
        let id = k ? macToNode[k] : null;
        if (!id) { const ipv = String(o.ip || '').trim(); if (ipv) id = ipToNode[ipv]; }
        if (!id) continue;
        const ms = Date.parse(o.lastSeen || o.ts || '');
        if (!Number.isFinite(ms)) continue;
        if (!(id in _lastSeenByNode) || ms > _lastSeenByNode[id]) _lastSeenByNode[id] = ms;
    }
    const presence = {};
    const _nowMs = Date.now();
    for (const id in _lastSeenByNode) {
        const ageDays = Math.max(0, (_nowMs - _lastSeenByNode[id]) / 864e5);
        presence[id] = { tier: ageDays > PRESENCE_STALE_DAYS ? 'stale' : 'live', ageDays };
    }

    return {
        nodes, types: TYPES, links: Array.isArray(st.links) ? st.links : [], portMacNodeIds, macToNode, presence,
        ipamVlans: (st.ipam && st.ipam.vlans) ? st.ipam.vlans : {},
        vlanIdsInUse, vlanNames: st.vlanNames || {},
        spare: buildSpareReport(spareDevices), sfpTotal, rackFill, networks,
        caps, fleet: computeFleetCapabilities(caps.map((x) => x.caps)),
        topoCache: st.topoCache || {}, lagGroups: st.lagGroups || {},
        lastSyncAt: st.lastSnmpSyncAt || 0, lastSyncResult: st.lastSnmpSyncResult || {},
        lastVerify: st.lastVerify || null,   // Fase 2: l'ultima Verifica come stato (riga «Vero»)
        // B3: le righe-categoria navigabili della «Vero» escono dal report VIVO, ma
        // SOLO se è l'esito di una VERIFICA (`_fromVerify`). Un Sync (app-snmp.js:421)
        // ricalcola store._driftReport per l'ingrigimento presenza senza persistere
        // lastVerify: mostrarlo qui contraddirebbe la meta-riga «verify». Senza flag →
        // null → restano i soli conteggi persistiti (B2). Il drill-down resta coerente
        // con la Verifica (per rivederlo dopo un Sync si ri-esegue la Verifica).
        driftLive: (store._driftReport && store._driftReport._fromVerify) ? store._driftReport : null,
        now: Date.now(),
    };
}

// ── Parole: la lib da' chiavi e numeri, qui diventano testo ──────────────────
const _n = (v) => (v == null ? t('ov.none') : String(v));

function _age(ms, at) {
    if (!at) return t('ov.never');
    const f = (typeof _snmpFreshness === 'function') ? _snmpFreshness(at) : null;
    return (f && f.txt) ? f.txt : '';
}

// OGNI voce ha il suo numero grande e il suo verdetto. Un titolo unico per
// sezione era fuorviante: diceva «19» parlando di UNA riga su sei, e faceva
// sembrare le altre cinque un contorno (rilevato provando la vista, 2026-07-23).
//
// _tileValue → [numero grande, spalla piccola]. Quando il dato NON c'e' il
// numero e' un trattino: mai uno zero al posto di "non lo sappiamo".
function _tileValue(r) {
    switch (r.key) {
        case 'cables':       return [_n(r.value), ''];
        case 'subnets':      return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), ''];
        case 'gateways':     return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), t('ov.of', { n: r.total })];
        case 'lastSync':     return r.prov === 'none' ? [t('ov.none'), ''] : [r.value + '/' + r.total, ''];
        case 'suspectPorts': return [_n(r.value), r.total ? t('ov.of', { n: r.total }) : ''];
        case 'neighbors':    return [_n(r.value), ''];
        case 'lags':         return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), ''];
        case 'verify':       return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), ''];
        case 'freePorts':    return [_n(r.value), t('ov.of', { n: r.total })];
        case 'freeSfp':      return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), t('ov.of', { n: r.total })];
        case 'rackU':        return r.prov === 'none' ? [t('ov.none'), ''] : [r.value + 'U', t('ov.of', { n: r.total })];
        case 'poe':          return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), t('ov.of', { n: r.total })];
        case 'uplink':       return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), 'Mbps'];
        case 'ipFree':       return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), ''];
        case 'drRedundancy': return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), t('ov.of', { n: r.total })];
        default:             return [_n(r.value), r.total != null ? t('ov.of', { n: r.total }) : ''];
    }
}

// Il VERDETTO: due parole che dicono se quel numero va bene. Senza, «25» non
// significa niente. Tono: ok / warn / none — mai il colore da solo.
function _tileStatus(r) {
    const e = r.extra || {};
    const gap = (r.total != null && r.value != null) ? r.total - r.value : null;
    const gapStatus = (missKey = 'ov.st.missing') => (r.prov === 'none' ? { w: t('ov.st.none'), tone: 'none' }
        : (gap === 0 ? { w: t('ov.st.complete'), tone: 'ok' } : { w: t(missKey, { n: gap }), tone: 'warn' }));
    // B4/B5 — «Reti del progetto»: informativa (copertura per subnet), non una decisione.
    if (r.drill === '__networks') return { w: t('ov.driftNetworks'), tone: 'info' };
    // B3 — righe-categoria del Drift: verdetto uniforme «da decidere» (una per riga).
    if (r.drill) return { w: t('ov.driftAction'), tone: r.value > 0 ? 'warn' : 'ok' };
    switch (r.key) {
        case 'addr': case 'vlanNames': return gapStatus();
        // I nomi «mancanti» sono in realta' «da confermare»: il device c'e', gli
        // manca solo un nome proprio (spesso si chiama ancora come il suo IP).
        case 'name': return gapStatus('ov.st.missingNames');
        // Il MAC e' completo anche quando arriva dalle interfacce: dirlo evita
        // la domanda «ma il MAC c'e', perche' me lo dai per mancante?».
        case 'mac': return (gap === 0 && e.fromPorts)
            ? { w: t('ov.st.completeVia', { n: e.fromPorts }), tone: 'ok' }
            : gapStatus();
        // «17 documentati» era vago proprio dove serviva precisione: un cavo
        // dedotto dall'auto-link non e' un cavo dichiarato.
        case 'cables':       return e.auto
            ? { w: t('ov.st.cableSplit', { m: e.manual, a: e.auto }), tone: 'info' }
            : { w: t('ov.st.documented'), tone: 'info' };
        // Nella colonna «il documento è completo?» la lacuna è il punto: la
        // subnet c'è nella rete ma NON è dichiarata nel progetto. «non dichiarate»
        // (col conteggio delle osservate) lo dice meglio di «osservate», che
        // suonava come un dato a posto.
        // Con dichiarazioni presenti ma segmenti in uso NON dichiarati, il verdetto
        // spinge all'azione: «N da dichiarare» (② il dichiarato è legge).
        case 'subnets':      return r.prov === 'none'
            ? { w: t('ov.subnetsUndeclared', { n: e.observed || 0 }), tone: 'none' }
            : (e.undeclared > 0 ? { w: t('ov.subnetsToDeclare', { n: e.undeclared }), tone: 'warn' } : { w: t('ov.st.declared'), tone: 'ok' });
        // Gateway per subnet: senza gateway non sai instradare la subnet (buco DR).
        case 'gateways':     return r.prov === 'none'
            ? { w: t('ov.gwNoSubnet'), tone: 'none' }
            : (gap === 0 ? { w: t('ov.gwAll'), tone: 'ok' } : { w: t('ov.gwMissing', { n: gap }), tone: 'warn' });
        case 'lastSync':     return r.prov === 'none'
            ? { w: t('ov.st.never'), tone: 'none' }
            : { w: t('ov.st.read', { age: _age(e.ageMs, e.at) }), tone: 'info' };
        case 'verifiable':   return gap ? { w: t('ov.st.unverifiable', { n: gap }), tone: 'warn' }
            : { w: t('ov.st.verifiedAll'), tone: 'ok' };
        case 'suspectPorts': return r.value > 0
            ? { w: t('ov.st.mismatch'), tone: 'warn' }
            : { w: t('ov.st.coherent'), tone: 'ok' };
        case 'neighbors':    return { w: t('ov.neighborsFrom', { n: e.fromDevices || 0 }), tone: 'info' };
        case 'lags':         return r.prov === 'none'
            ? { w: t('ov.st.none'), tone: 'none' }
            : { w: t('ov.lagSplit', { m: e.measured, d: e.derived }), tone: 'info' };
        case 'verify': {
            if (r.prov === 'none') return { w: t('ov.st.never'), tone: 'none' };
            const when = _age(e.ageMs, e.at);
            // Ordine onesto: prima il residuo da decidere; poi il caso "cieco"
            // (verifica girata ma nulla di verificabile); infine allineato.
            if (r.value > 0) return { w: t('ov.verify.diffs', { n: r.value, age: when }), tone: 'warn' };
            if (e.banner === 'blind') return { w: t('ov.verify.blind', { age: when }), tone: 'warn' };
            return { w: t('ov.verify.aligned', { age: when }), tone: 'ok' };
        }
        case 'freePorts':    return e.suspect
            ? { w: t('ov.rawMinusSuspect', { raw: e.raw, suspect: e.suspect }), tone: 'info' }
            : { w: t('ov.st.available'), tone: 'ok' };
        case 'freeSfp':      return r.prov === 'none' ? { w: t('ov.st.none'), tone: 'none' }
            : (r.value === 0 ? { w: t('ov.st.noneFree'), tone: 'warn' } : { w: t('ov.st.available'), tone: 'ok' });
        case 'rackU':        return r.prov === 'none' ? { w: t('ov.st.none'), tone: 'none' }
            : (r.value === 0 ? { w: t('ov.st.rackFull'), tone: 'warn' } : { w: t('ov.st.free'), tone: 'ok' });
        case 'poe':          return r.prov === 'none'
            ? { w: t('ov.ofSwitches', { n: r.total || 0 }), tone: 'none' }
            : { w: e.headroomW != null ? t('ov.headroomW', { n: e.headroomW }) : t('ov.st.declared'), tone: 'ok' };
        case 'uplink':       return r.prov === 'none'
            ? { w: t('ov.st.noSpeeds'), tone: 'none' }
            : { w: t('ov.st.widestLag', { n: e.devices || 0 }), tone: 'info' };
        // Liberi DEDOTTI assumendo /24 (come deriveProjectNetworks): il verdetto
        // dichiara l'assunzione, cosi' il numero non si spaccia per certo.
        // ① "sempre sul dichiarato": se la capacità è misurata su subnet DICHIARATE
        // il verdetto lo dice (niente «/24 assunto»); altrimenti resta l'assunzione /24.
        case 'ipFree':       return r.prov === 'none'
            ? { w: t('ov.st.needSubnet'), tone: 'none' }
            : { w: t(e.declared ? 'ov.freeDeclared' : 'ov.freeAssumed24', { n: e.subnets || 0 }), tone: 'info' };
        // ④ RIPRISTINABILITÀ — ogni dimensione dice quanti apparati mancano di quel
        // pezzo per essere rimessi in piedi (backup fresco · identità nota · posizione).
        case 'drBackup': {
            if (r.prov === 'none') return { w: t('ov.dr.na'), tone: 'none' };
            const miss = (r.total || 0) - (r.value || 0);
            return miss === 0 ? { w: t('ov.dr.backupAll'), tone: 'ok' } : { w: t('ov.dr.backupGap', { n: miss }), tone: 'warn' };
        }
        case 'drIdentity': {
            if (r.prov === 'none') return { w: t('ov.dr.na'), tone: 'none' };
            const miss = (r.total || 0) - (r.value || 0);
            if (miss === 0) return { w: t('ov.dr.idAll'), tone: 'ok' };
            return { w: e.mismatch > 0 ? t('ov.dr.idMismatch', { n: e.mismatch }) : t('ov.dr.idGap', { n: miss }), tone: 'warn' };
        }
        case 'drLocation': {
            if (r.prov === 'none') return { w: t('ov.dr.na'), tone: 'none' };
            const miss = (r.total || 0) - (r.value || 0);
            return miss === 0 ? { w: t('ov.dr.locAll'), tone: 'ok' } : { w: t('ov.dr.locGap', { n: miss }), tone: 'warn' };
        }
        case 'drPresence':   return r.prov === 'none'
            ? { w: t('ov.dr.presNone'), tone: 'none' }
            : (e.stale > 0 ? { w: t('ov.dr.presStale', { n: e.stale }), tone: 'warn' } : { w: t('ov.dr.presLive'), tone: 'info' });
        case 'drRedundancy': return r.prov === 'none'
            ? { w: t('ov.dr.redNone'), tone: 'none' }
            : { w: t('ov.dr.redProtected', { n: r.value }), tone: 'info' };
        default:             return { w: '', tone: 'info' };
    }
}

function _el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
}

function _meter(r) {
    const m = _el('div', 'ov-meter' + (r.prov === 'none' ? ' is-none' : ''));
    if (r.prov !== 'none' && r.pct != null) {
        const i = document.createElement('i');
        i.style.width = Math.max(0, Math.min(100, r.pct)) + '%';
        m.appendChild(i);
    }
    return m;
}

function _rowEl(secKey, r) {
    // Cliccabile se ha un elenco (drill-down nativo) OPPURE è una riga-categoria del
    // Drift (B3): il suo dettaglio riusa le righe+azioni dell'overlay (store._driftReport).
    const clickable = (Array.isArray(r.items) && r.items.length > 0) || !!r.drill;
    const el = document.createElement(clickable ? 'button' : 'div');
    const st = _tileStatus(r);
    el.className = 'ov-r s-' + st.tone + (r.prov === 'none' ? ' is-missing' : '');
    if (clickable) {
        el.type = 'button';
        el.dataset.act = 'overview-row';
        el.dataset.sec = secKey;
        el.dataset.key = r.key;
    }
    // 1) etichetta + pallino di provenienza
    const k = _el('div', 'ov-k');
    const dot = _el('span', 'ov-d p-' + r.prov);
    dot.title = t('ov.prov.' + r.prov) + ' — ' + t('ov.provHint.' + r.prov);
    k.appendChild(dot);
    k.appendChild(_el('span', 'ov-t', t('ov.row.' + r.key)));
    el.appendChild(k);

    // 2) il numero grande di QUESTA voce
    const [val, sub] = _tileValue(r);
    const v = _el('div', 'ov-val');
    v.appendChild(_el('span', 'ov-num', val));
    if (sub) v.appendChild(_el('span', 'ov-sub', sub));
    el.appendChild(v);

    // 3) il verdetto in parole + il meter, che e' solo un rinforzo del numero
    const f = _el('div', 'ov-foot-row');
    f.appendChild(_el('span', 'ov-st', st.w));
    f.appendChild(_meter(r));
    el.appendChild(f);
    return el;
}

// Costruisce la riga <li> di UNA voce del dettaglio (device / rete / porta).
function _itemLi(it) {
    const li = document.createElement('li');
    // id e (opzionale) peer = i due capi di un LAG o di un cavo dedotto. Se il
    // primario non si risolve a nodo ma il peer si', il peer diventa primario.
    let aId = it.id || null, bId = it.peer || null;
    let aN = aId ? nodeById(aId) : null;
    if (!aN && bId) { aId = bId; bId = null; aN = nodeById(aId); }
    // Un elemento del progetto si apre; una rete o una porta e' solo testo.
    const inner = aN ? _el('button', 'ov-go') : _el('span', 'ov-go');
    if (aN) { inner.type = 'button'; inner.dataset.act = 'overview-goto'; inner.dataset.id = aId; }
    inner.appendChild(_el('span', null, aN ? (getNodeDisplayName(aN) || aId) : String(aId != null ? aId : '')));
    // Il secondo capo, risolto a nome (l'altro estremo di un LAG/cavo dedotto).
    if (bId) {
        const bN = nodeById(bId);
        inner.appendChild(_el('span', 'ov-peer', '↔ ' + (bN ? (getNodeDisplayName(bN) || bId) : String(bId))));
    }
    // Provenienza per-voce (misurato/dedotto): la lib da' il token, la parola
    // la mette qui — mai stringhe di interfaccia dentro la lib.
    if (it.tag) inner.appendChild(_el('span', 'ov-tag p-' + it.tag, t('ov.prov.' + it.tag)));
    const metaTxt = it.addr || (it.meta != null ? String(it.meta) : '');
    if (metaTxt || it.of != null) {
        const m = _el('span', 'ov-meta');
        if (metaTxt) m.appendChild(_el('span', null, metaTxt));
        // «di {of}» attenuato: il contesto (es. utilizzabili del CIDR) accanto
        // al valore principale, senza rubargli peso.
        if (it.of != null) m.appendChild(_el('span', 'ov-meta-of', ' ' + t('ov.of', { n: it.of })));
        inner.appendChild(m);
    }
    li.appendChild(inner);
    return li;
}

// Contenuto (HTML) del drill-down di una riga-categoria del Drift o di «Reti del
// progetto», dal report VIVO (store._driftReport). Serializzato LAZY (all'apertura),
// riusando ESATTAMENTE le righe+azioni dell'overlay (_driftRowHtml) e la sezione reti
// (_driftNetworksSection) — così i data-act restano quelli delegati globalmente. (D4)
function _driftDetailHtml(cat) {
    const rep = store._driftReport;
    if (cat === '__networks') return (rep && typeof _driftNetworksSection === 'function') ? _driftNetworksSection(rep) : '';
    let rows = (rep && Array.isArray(rep[cat])) ? rep[cat] : [];
    // I non-documentati "endpoint" (telefoni/BYOD) restano fuori: nella «Vero» si mostra
    // solo l'infrastruttura azionabile, come il conteggio counts.undocumented.
    if (cat === 'undocumented') rows = rows.filter((x) => x && x.cls !== 'endpoint');
    return rows.length
        ? rows.map((x) => _driftRowHtml(cat, x)).join('')
        : `<div class="drift-empty">${t('ov.driftGone')}</div>`;
}

// «Subnet» (Completo) e «Indirizzi liberi» (Margine) misurano sulle reti del
// progetto: il loro dettaglio elenca le subnet dichiarate e le «non dichiarate».
// Da lì un ponte al pannello dove le reti si DICHIARANO chiude il cerchio —
// vedo la lacuna, la correggo dove è nata. → [[declare-first-workflow]]
function _wantsVlanCta(secKey, key) {
    return (secKey === 'complete' && key === 'subnets') || (secKey === 'margin' && key === 'ipFree');
}

function _detailEl(secKey, r) {
    const d = _el('div', 'ov-detail');
    d.dataset.for = secKey + ':' + r.key;

    // B3 — dettaglio di una riga-categoria del Drift: riusa ESATTAMENTE le righe e le
    // azioni 1-clic dell'overlay (_driftRowHtml). I data-act sono già delegati
    // globalmente, quindi Documenta/Ignora/Aggiorna/Adotta funzionano identici qui;
    // dopo l'azione, _renderDriftReport → _driftMirrorOverview ridisegna la Panoramica.
    // Le righe vivono nel report VIVO (store._driftReport): presenti dopo una Verifica
    // in-sessione. Una decisione per riga, mai in blocco (manual-first).
    if (r.drill) {
        // Categorie drift (riusa righe+azioni dell'overlay via _driftRowHtml) e «Reti del
        // progetto» (riusa _driftNetworksSection). Header uniforme: il conteggio è r.value
        // (= counts[cat] o n. reti). La lista PESANTE si serializza LAZY — solo se la riga è
        // GIÀ aperta a render-time, altrimenti all'apertura in _toggleRow — per non ricostruire
        // HTML inutile a ogni renderOverview (poll SNMP, mirror post-azione). (D4)
        const h = _el('div', 'ov-dh');
        h.appendChild(_el('b', null, String(r.value)));
        h.appendChild(document.createTextNode(' ' + t('ov.row.' + r.key)));
        const x = _el('button', 'ov-x', t('ov.close') + ' ✕');
        x.type = 'button';
        x.dataset.act = 'overview-detail-close';
        h.appendChild(x);
        d.appendChild(h);
        const box = _el('div', 'ov-drift-rows');
        box.dataset.drill = r.drill;                                  // marca il popolamento lazy
        if (_open.get(secKey) === r.key) box.innerHTML = _driftDetailHtml(r.drill);
        d.appendChild(box);
        return d;
    }

    const h = _el('div', 'ov-dh');
    h.appendChild(_el('b', null, String(r.items.length)));
    h.appendChild(document.createTextNode(' ' + t('ov.row.' + r.key)));
    const x = _el('button', 'ov-x', t('ov.close') + ' ✕');
    x.type = 'button';
    x.dataset.act = 'overview-detail-close';
    h.appendChild(x);
    d.appendChild(h);

    // Item con `group` → dettaglio a SCHEDE: le sub-header in testa dividono lo
    // spazio in due e commutano la lista mostrata (una alla volta). Senza `group`
    // → lista piatta.
    if (r.items.some((it) => it.group)) {
        const forKey = secKey + ':' + r.key;
        const groups = [];
        const byGroup = new Map();
        for (const it of r.items) {
            const gk = it.group || '';
            if (!byGroup.has(gk)) { byGroup.set(gk, []); groups.push(gk); }
            byGroup.get(gk).push(it);
        }
        // Scheda attiva: quella salvata (se esiste ancora), altrimenti la prima.
        const active = (_grpTab.has(forKey) && byGroup.has(_grpTab.get(forKey))) ? _grpTab.get(forKey) : groups[0];

        const tabs = _el('div', 'ov-tabs');
        for (const gk of groups) {
            const tab = _el('button', 'ov-tab' + (gk === active ? ' is-active' : ''), gk ? t('ov.grp.' + gk) : '');
            tab.type = 'button';
            tab.dataset.act = 'overview-grp-tab';
            tab.dataset.for = forKey;
            tab.dataset.grp = gk;
            tabs.appendChild(tab);
        }
        d.appendChild(tabs);

        for (const gk of groups) {
            const panel = _el('div', 'ov-tab-panel');
            panel.dataset.for = forKey;
            panel.dataset.grp = gk;
            if (gk !== active) panel.hidden = true;
            const ul = document.createElement('ul');
            for (const it of byGroup.get(gk)) ul.appendChild(_itemLi(it));
            panel.appendChild(ul);
            d.appendChild(panel);
        }
    } else {
        const ul = document.createElement('ul');
        for (const it of r.items) ul.appendChild(_itemLi(it));
        d.appendChild(ul);
    }
    // Ponte alla dichiarazione: dal dettaglio subnet/indirizzi al pannello VLAN
    // (dove subnet e VLAN si dichiarano). Sempre presente su queste due righe:
    // serve a colmare le «non dichiarate» e anche solo ad aggiungere una rete.
    if (_wantsVlanCta(secKey, r.key)) {
        const cta = _el('button', 'ov-cta', t('ov.goVlanPanel'));
        cta.type = 'button';
        cta.dataset.act = 'overview-vlan-panel';
        d.appendChild(cta);
    }
    return d;
}

// Commuta la scheda attiva di un dettaglio raggruppato: salva la scelta (fuori
// dal DOM, sopravvive ai re-render) e mostra solo la lista corrispondente.
function _switchGrpTab(el) {
    const forKey = el.dataset.for;
    const grp = el.dataset.grp;
    if (forKey == null) return;
    _grpTab.set(forKey, grp);
    const det = el.closest('.ov-detail');
    if (!det) return;
    det.querySelectorAll('.ov-tab').forEach((tb) => tb.classList.toggle('is-active', tb.dataset.grp === grp));
    det.querySelectorAll('.ov-tab-panel').forEach((p) => { p.hidden = (p.dataset.grp !== grp); });
}

// Voci che NON sono constatazioni sulla rete ma il «quando» del dato: l'ultima
// lettura SNMP e l'ultima Verifica. Come riquadri fra i risultati erano
// fuorvianti — occupavano lo stesso peso di «15 porte non corrispondono» pur
// non essendo un problema da guardare. Vanno in cima alla colonna, come data
// del capitolo: tutto quello che c'e' sotto vale a quella data.
const _META_ROWS = { truth: ['lastSync', 'verify'] };

function _metaStripEl(sec, keys) {
    const strip = _el('div', 'ov-meta-strip');
    for (const key of keys) {
        const r = sec.rows.find((x) => x.key === key);
        if (!r) continue;
        const st = _tileStatus(r);
        const item = _el('span', 'ov-meta-item s-' + st.tone);
        const dot = _el('span', 'ov-d p-' + r.prov);
        dot.title = t('ov.prov.' + r.prov) + ' — ' + t('ov.provHint.' + r.prov);
        item.appendChild(dot);
        item.appendChild(_el('span', 'ov-meta-k', t('ov.row.' + r.key)));
        const [val] = _tileValue(r);
        // Il numero (12/12) resta solo se e' un dato, non un trattino: davanti a
        // «mai eseguita» un «—» sarebbe rumore.
        if (val && val !== t('ov.none')) item.appendChild(_el('span', 'ov-meta-v', val));
        item.appendChild(_el('span', 'ov-meta-s', st.w));
        strip.appendChild(item);
    }
    return strip;
}

// Verdetto di sintesi della colonna: pallino colorato (salute ok/warn/bad) + una
// frase sobria. Il COLORE da' il colpo d'occhio, le parole restano pacate (scelta
// utente «via di mezzo»). Livello e conteggio arrivano dalla lib; qui solo la resa.
function _verdictEl(secKey, health, deltaN) {
    const lvl = (health && health.level) || 'ok';
    const el = _el('div', 'ov-verdict v-' + lvl);
    el.appendChild(_el('span', 'ov-vdot'));
    // «Vero» stantìo: se il verdetto è warn per sola vecchiaia del dato (nessuna
    // differenza da decidere), il messaggio lo dice invece di «0 da decidere».
    const vtxt = (secKey === 'truth' && health && health.stale)
        ? t('ov.truthStale', { n: health.staleDays || 0 })
        : t('ov.health.' + secKey + '.' + lvl, { n: (health && health.issues) || 0 });
    el.appendChild(_el('span', 'ov-vtxt', vtxt));
    // Delta dall'ultima lettura: segno esplicito (−N meno · +N piu'), colore
    // ridondante col segno (verde meglio · rosso peggio). Solo se != 0.
    if (deltaN) {
        const better = deltaN < 0;
        const chip = _el('span', 'ov-delta ' + (better ? 'd-better' : 'd-worse'),
            (deltaN > 0 ? '+' : '−') + Math.abs(deltaN));
        chip.title = t(better ? 'ov.deltaBetter' : 'ov.deltaWorse', { n: Math.abs(deltaN) });
        el.appendChild(chip);
    }
    return el;
}

function _sectionEl(secKey, num, sec, deltaN) {
    const col = _el('section', 'ov-col');
    col.dataset.sec = secKey;
    const h2 = document.createElement('h2');
    h2.appendChild(_el('span', 'ov-n', String(num)));
    h2.appendChild(document.createTextNode(t('ov.sec.' + secKey)));
    col.appendChild(h2);
    col.appendChild(_el('p', 'ov-ask', t('ov.sec.' + secKey + 'Q')));

    // Strato colpo d'occhio: la RISPOSTA alla domanda, con pallino di salute e
    // il delta dall'ultima lettura.
    if (sec.health) col.appendChild(_verdictEl(secKey, sec.health, deltaN));

    // Il «quando» del dato in cima, fuori dalla griglia dei risultati.
    const metaKeys = _META_ROWS[secKey] || [];
    if (metaKeys.length) col.appendChild(_metaStripEl(sec, metaKeys));

    // Niente titolo unico di sezione: ogni voce porta il proprio numero. La
    // sezione ha pero' un PUNTO D'INGRESSO — il riquadro piu' urgente prende un
    // bordo d'accento, cosi' l'occhio sa da dove partire senza che un numero
    // solo si spacci per il riassunto di tutti gli altri.
    const rows = _el('div', 'ov-rows');
    const urgent = sec.headline ? sec.headline.key : null;
    for (const r of sec.rows) {
        if (metaKeys.indexOf(r.key) !== -1) continue;   // gia' in cima alla colonna
        const el = _rowEl(secKey, r);
        // Evidenzia il punto d'ingresso SOLO se e' davvero un problema — warn o
        // «non dichiarato» (s-none): la lib ripiega sulla prima voce quando non
        // c'e' nulla che non va, e mettere la barra su «166 porte libere» direbbe
        // una cosa falsa. Il colore della barra segue il verdetto di colonna:
        // ambra per warn, rosso per bad (coerente col pallino in cima).
        if (r.key === urgent && (el.classList.contains('s-warn') || el.classList.contains('s-none'))) {
            el.classList.add('is-urgent');
            if (sec.health && sec.health.level === 'bad') el.classList.add('u-bad');
        }
        rows.appendChild(el);
    }
    col.appendChild(rows);
    // Un dettaglio per riga con elenco (drill-down nativo) o per riga-categoria del
    // Drift (B3: il suo drill-down riusa le righe+azioni dell'overlay).
    for (const r of sec.rows) if ((r.items && r.items.length) || r.drill) col.appendChild(_detailEl(secKey, r));
    return col;
}

// Selettore di LENTE (opt-in): [Sintesi] [Ripristinabilità]. La scelta è una
// preferenza locale (localStorage), non tocca `state`. Sintesi resta il default
// così la schermata a 3 colonne — il paletto «una schermata» — non si affolla.
function _lensSwitchEl(active) {
    const s = _el('div', 'ov-lens-switch');
    for (const key of ['summary', 'recovery']) {
        const b = _el('button', 'ov-lens-btn' + (key === active ? ' is-active' : ''), t('ov.lens.' + key));
        b.type = 'button';
        b.dataset.act = 'overview-lens';
        b.dataset.lens = key;
        b.setAttribute('aria-pressed', key === active ? 'true' : 'false');
        s.appendChild(b);
    }
    return s;
}

// ④ RIPRISTINABILITÀ (DR-readiness) a tutta larghezza: verdetto grande «X di Y in
// piedi» + le dimensioni (backup/identità/posizione/presenza) come righe. Riusa la
// STESSA macchina delle colonne (_rowEl/_detailEl/_toggleRow via data-sec="recovery"),
// così i drill-down e la navigazione al device funzionano identici.
function _recoveryEl(secKey, sec) {
    const col = _el('section', 'ov-col ov-col-recovery');
    col.dataset.sec = secKey;
    const h2 = document.createElement('h2');
    h2.appendChild(document.createTextNode(t('ov.sec.recovery')));
    col.appendChild(h2);
    col.appendChild(_el('p', 'ov-ask', t('ov.sec.recoveryQ')));

    // Verdetto: «se cade stanotte, quanti rimetti in piedi?». Colore dalla salute.
    const lvl = (sec.health && sec.health.level) || 'ok';
    const verdict = _el('div', 'ov-dr-verdict v-' + lvl);
    verdict.appendChild(_el('span', 'ov-vdot'));
    if (sec.total > 0) {
        const big = _el('span', 'ov-dr-big');
        big.appendChild(_el('b', null, String(sec.recoverable)));
        big.appendChild(_el('span', 'ov-dr-of', ' ' + t('ov.of', { n: sec.total })));
        verdict.appendChild(big);
        verdict.appendChild(_el('span', 'ov-dr-lbl', t('ov.dr.recoverable')));
    } else {
        verdict.appendChild(_el('span', 'ov-dr-lbl', t('ov.dr.empty')));
    }
    col.appendChild(verdict);

    // Nessun apparato gestito → solo il verdetto vuoto (righe a «0 di 0» sarebbero rumore).
    if (sec.total > 0) {
        const rows = _el('div', 'ov-rows');
        for (const r of sec.rows) rows.appendChild(_rowEl(secKey, r));
        col.appendChild(rows);
        for (const r of sec.rows) if ((r.items && r.items.length) || r.drill) col.appendChild(_detailEl(secKey, r));
    }
    return col;
}

/**
 * Ridisegna la Panoramica. Chiamata da renderAll SOLO quando la vista e' attiva:
 * fuori dalla vista non si spende un ciclo (il modello gira su tutti i nodi e
 * tutte le porte). Nessuna memoizzazione: la vista e' di sola lettura e si
 * ridisegna raramente — meglio un dato sempre fresco che una cache da invalidare.
 */
export function renderOverview() {
    const root = document.getElementById('overview');
    if (!root || store._viewMode !== 'overview') return;

    const model = _buildModel();
    const o = buildOverview(model);
    root.textContent = '';

    // Delta «dall'ultima lettura» (baseline in localStorage, per progetto): quante
    // lacune/discrepanze in meno o in più rispetto al Sync precedente.
    const dl = _overviewDelta(store.currentProjectId, o, Number(model.lastSyncAt) || 0);

    // Selettore di LENTE: Sintesi (le 3 colonne) · Ripristinabilità (DR-readiness).
    const lens = _savedLens();
    root.appendChild(_lensSwitchEl(lens));

    if (lens === 'recovery') {
        const wrap = _el('div', 'ov-cols ov-cols-single');
        wrap.appendChild(_recoveryEl('recovery', o.recovery));
        root.appendChild(wrap);
    } else {
        const cols = _el('div', 'ov-cols');
        cols.appendChild(_sectionEl('complete', 1, o.complete, dl && dl.complete));
        cols.appendChild(_sectionEl('truth', 2, o.truth, dl && dl.truth));
        cols.appendChild(_sectionEl('margin', 3, o.margin, dl && dl.margin));
        root.appendChild(cols);
    }

    const foot = _el('div', 'ov-foot');
    for (const p of ['declared', 'measured', 'derived', 'none']) {
        const lg = _el('span', 'ov-lg');
        lg.appendChild(_el('span', 'ov-d p-' + p));
        lg.appendChild(document.createTextNode(t('ov.prov.' + p)));
        foot.appendChild(lg);
    }
    foot.appendChild(_el('span', 'ov-hint', t('ov.clickHint')));
    root.appendChild(foot);

    // Ri-applica i dettagli che erano aperti: il DOM e' nuovo, l'intenzione no.
    for (const [sec, key] of _open) {
        const col = root.querySelector('.ov-col[data-sec="' + sec + '"]');
        if (!col) continue;
        const row = col.querySelector('.ov-r[data-key="' + key + '"]');
        const det = col.querySelector('.ov-detail[data-for="' + sec + ':' + key + '"]');
        if (row && det) { row.classList.add('is-open'); det.classList.add('is-open'); }
        else _open.delete(sec);   // la lacuna e' stata colmata: la riga non e' piu' cliccabile
    }
}

// ── Interazione: il dettaglio si apre DENTRO la colonna ──────────────────────
// Mai un overlay: coprirebbe il contesto, e questa schermata E' il contesto.
// Una riga aperta per colonna — due colonne aperte insieme sono utili, due
// dettagli nella stessa no.
function _closeIn(col) {
    col.querySelectorAll('.ov-detail.is-open').forEach((d) => d.classList.remove('is-open'));
    col.querySelectorAll('.ov-r.is-open').forEach((r) => r.classList.remove('is-open'));
    if (col.dataset.sec) _open.delete(col.dataset.sec);
}

function _toggleRow(el) {
    const col = el.closest('.ov-col');
    if (!col) return;
    const wasOpen = el.classList.contains('is-open');
    _closeIn(col);
    if (wasOpen) return;                         // secondo clic = chiude
    el.classList.add('is-open');
    const d = col.querySelector('.ov-detail[data-for="' + el.dataset.sec + ':' + el.dataset.key + '"]');
    if (d) {
        d.classList.add('is-open');
        // D4 — popolamento LAZY del dettaglio drift: la lista si serializza qui, all'apertura,
        // non a ogni renderOverview. `data-drill` marca i soli dettagli drift (le righe native
        // sono già nel DOM). Vuoto = mai popolato → riempilo ora dal report vivo.
        const box = d.querySelector('.ov-drift-rows[data-drill]');
        if (box && !box.innerHTML) box.innerHTML = _driftDetailHtml(box.dataset.drill);
    }
    _open.set(el.dataset.sec, el.dataset.key);
}

// Dall'elenco al dispositivo: qui l'intenzione cambia da "consultare" a "agire",
// quindi si esce dalla Panoramica e si va dove il dato si corregge.
function _gotoNode(id) {
    const n = nodeById(id);
    if (!n) return;
    setOverview(false);
    store.selType = 'node';
    store.selId = id;
    store._propsExplicit = true;                 // intent esplicito: il pannello si apre
    if (typeof switchRightTab === 'function') switchRightTab('props');
    if (typeof focusNode === 'function') focusNode(n);
}

// Dalla lacuna alla dichiarazione: «Subnet» e «Indirizzi liberi» portano al
// pannello dove le reti si DICHIARANO (contesto progetto → sezione «VLAN»),
// con la sezione già aperta. Stesso cambio d'intento di _gotoNode — da
// "consultare" ad "agire" — quindi si esce dalla Panoramica. Deseleziona
// (selType/selId a null) così renderProps rende il pannello progetto
// (_renderFloorProps), non l'ultimo device. → [[declare-first-workflow]]
function _gotoVlanPanel() {
    setOverview(false);
    store.selType = null;
    store.selId = null;
    store._propsExplicit = true;                 // intent esplicito: il pannello si apre
    if (typeof setPropsSectionState === 'function') setPropsSectionState('floor-vlan', true);
    if (typeof switchRightTab === 'function') switchRightTab('props');
}

/**
 * Accende/spegne la vista. NON tocca `state`: la scelta e' una preferenza
 * locale (localStorage) e cambiare vista non deve mai sporcare il documento.
 */
export function setOverview(on) {
    const want = !!on;
    if (want) {
        store._viewMode = 'overview';
        document.body.classList.add('view-overview');
        _saveView('overview');
        renderOverview();
    } else {
        document.body.classList.remove('view-overview');
        if (store._viewMode === 'overview') store._viewMode = store._topoVisible ? 'topology' : 'map';
        _saveView('');
    }
    const btn = document.getElementById('btn-overview');
    if (btn) btn.setAttribute('aria-pressed', want ? 'true' : 'false');
}

export function toggleOverview() { setOverview(!document.body.classList.contains('view-overview')); }

// Commuta la lente (Sintesi ⇄ Ripristinabilità): salva la preferenza locale e
// ridisegna. Niente markDirty: cambiare lente non sporca il documento.
function _setLens(v) {
    _saveLens(v === 'recovery' ? 'recovery' : 'summary');
    renderOverview();
}

/** Ripristina la vista salvata all'avvio (dopo il primo render dello stato). */
export function restoreOverviewView() {
    if (_savedView() === 'overview') setOverview(true);
}

// renderOverview e' chiamata BARE (typeof-guard) dalla coda di renderAll in
// app-render-core.js — stesso schema di renderSubbar: evita un import circolare
// fra render-core e questo modulo, che importa gia' il nucleo.
expose({ renderOverview, toggleOverview, setOverview, restoreOverviewView });

registerClickActions({
    'overview-toggle': () => toggleOverview(),
    'overview-row': (el) => _toggleRow(el),
    'overview-detail-close': (el) => { const c = el.closest('.ov-col'); if (c) _closeIn(c); },
    'overview-goto': (el) => _gotoNode(el.dataset.id),
    'overview-vlan-panel': () => _gotoVlanPanel(),
    'overview-lens': (el) => _setLens(el.dataset.lens),
    'overview-grp-tab': (el) => _switchGrpTab(el),
});
