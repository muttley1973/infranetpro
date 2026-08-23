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
import { nodeById, getNodeDisplayName, _linksForPort, switchRightTab, _cableProofBadgeHtml } from './app.js';
import { focusNode } from './app-search-zoom-rack.js';
import { _snmpFreshness } from './app-snmp.js';
import { _driftRowHtml, _driftNetworksSection } from './app-drift.js';   // B3/B4: drill-down inline «Vero» riusa righe+azioni e la sezione «Reti» del Drift
import { registerClickActions } from './app-delegation.js';
import { setPropsSectionState } from './app-properties.js';   // click «Subnet»/«Indirizzi liberi» → pannello VLAN (dove le reti si DICHIARANO)
import { _ipamAuditReport } from './app-l3.js';   // ② «Vero»: igiene IPAM (IP duplicati + overlap subnet), stesso modello dell'overlay L3 (include gli IP VM)
import { wifiVlanCoherence } from './app-wifi.js';   // ⑤ «Sicurezza»: coerenza VLAN wireless (stesso motore del vecchio report, ora assorbito nella Dashboard)
import { buildOverview, _rackFill } from '../lib/overview.js';
import { computeHealthAlerts } from '../lib/health-alerts.js';   // ⑥ Salute live: soglie DOCUMENTATE una volta sola (le stesse che legge l'assistente AI)
import { ipamByVidView, prefixesOf } from '../lib/ipam-model.js';   // vista per-VLAN + l'autorità prefix-first

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

// La LENTE della Panoramica: 'summary' = Sintesi (le 3 colonne) · 'recovery' =
// «Ripristinabilità» · 'security' = «Sicurezza & Servizi» · 'health' = «Salute
// live» (l'unica che parla del presente). Come la vista, è una
// preferenza LOCALE (localStorage per macchina), MAI in `state`: cambiare lente
// non deve sporcare il documento.
const LENS_KEY = 'infranet.ov.lens';
const _LENSES = ['summary', 'recovery', 'security', 'health'];
// Le lenti a colonna singola (non le 3 colonne della Sintesi).
const _SINGLE_LENSES = ['recovery', 'security', 'health'];
function _savedLens() {
    try { const v = localStorage.getItem(LENS_KEY); return _LENSES.indexOf(v) !== -1 ? v : 'summary'; } catch (_) { return 'summary'; }
}
function _saveLens(v) {
    try { localStorage.setItem(LENS_KEY, _LENSES.indexOf(v) !== -1 ? v : 'summary'); } catch (_) { /* storage negato: pazienza */ }
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
// I timestamp «vivi» viaggiano come ISO (n.snmpLastOk, integration.lastPoll,
// n.powerLiveAt); qualche progetto vecchio può portarli in ms. 0 = non databile —
// e una misura che non si sa quando è stata presa non tinge di verde nulla.
function _liveTs(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const ms = Date.parse(v || '');
    return Number.isFinite(ms) ? ms : 0;
}

function _buildModel() {
    const st = store.state || {};
    const nodes = Array.isArray(st.nodes) ? st.nodes : [];
    const ports = st.ports || {};
    const rackName = (id) => { const r = (st.racks || []).find((x) => x && x.id === id); return r ? (r.name || id) : id; };

    const spareDevices = [];
    const caps = [];
    const liveHealth = [];
    const portMacNodeIds = new Set();
    const portMacById = Object.create(null);   // nodeId → primo MAC visto sulle sue interfacce
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
            // Su un apparato SNMP il MAC arriva per INTERFACCIA: oltre a segnare che
            // il device un'identita' L2 ce l'ha, si tiene il PRIMO MAC visto, perche'
            // l'abbinamento ARP della Panoramica deve poter mostrare un indirizzo vero
            // invece di un trattino su un device che il conteggio da' per documentato.
            if (String(p.mac || '').trim()) {
                portMacNodeIds.add(n.id); _rememberMac(p.mac, n.id);
                if (!portMacById[n.id]) portMacById[n.id] = String(p.mac).trim();
            }
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
            if (l && String(l.mac || '').trim()) {
                portMacNodeIds.add(n.id); _rememberMac(l.mac, n.id);
                if (!portMacById[n.id]) portMacById[n.id] = String(l.mac).trim();
            }
        }
        const c = computeDeviceCapabilities({
            type: n.type, spec: n.spec, radios: n.radios, vmsCount: (n.vms || []).length,
            ports: pc ? { list: capPorts, total: pc, free: freePorts } : undefined,
            lagNames: st.lagGroups || {}, lagModes: st.lagModes || {},
        });
        if (c) caps.push({ id: n.id, caps: c });

        // ⑥ Salute live: la telemetria che l'apparato ha DAVVERO restituito
        // (HOST-RESOURCES · Printer-MIB · UPS-MIB). Gli allarmi non li decide questo
        // glue: li deriva lib/health-alerts.js con le sue soglie documentate — le
        // stesse che legge l'assistente AI, così «RAM piena» significa la stessa cosa
        // ovunque. Qui si RACCOGLIE (chi ha risposto, quando, con che numeri).
        const _hb = {
            host: (n.integration && typeof n.integration.hostResources === 'object') ? n.integration.hostResources : null,
            printer: (n.integration && typeof n.integration.printer === 'object') ? n.integration.printer : null,
            power: (n.powerLive && typeof n.powerLive === 'object') ? n.powerLive : null,
        };
        if (_hb.host || _hb.printer || _hb.power) {
            let alerts = [];
            // Un blocco malformato non deve far sparire la lente: peggio di «non lo
            // so» c'è solo una schermata bianca.
            try { alerts = computeHealthAlerts({ health: _hb }) || []; } catch (_) { alerts = []; }
            liveHealth.push({
                id: n.id, type: n.type,
                at: Math.max(_liveTs(n.snmpLastOk), _liveTs(n.integration && n.integration.lastPoll), _liveTs(n.powerLiveAt)),
                blocks: { host: !!_hb.host, printer: !!_hb.printer, power: !!_hb.power },
                cpu: (_hb.host && typeof _hb.host.cpuLoad === 'number') ? _hb.host.cpuLoad : null,
                alerts,
            });
        }

        // Porte libere: solo infrastruttura (un PC non e' capacita' disponibile).
        if (_isLeafEndpoint(n.type, n) || !pc) continue;
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
            // `speed`: l'override a mano vince sulla misura (manual-first), e null
            // resta null — «velocita' non nota» e' un fatto, non uno zero.
            list.push({
                pid, kind, cabled: !!cabled[i], activeSnmp: responded && pi.status === 'active',
                speed: (pi.speedOvr != null) ? pi.speedOvr : (pi.speed != null ? pi.speed : null),
            });
        }
        if (list.length) {
            spareDevices.push({ id: n.id, type: n.type, name: getNodeDisplayName(n) || n.id, rackId: n.rackId || null, rackName: rackName(n.rackId), ports: list });
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
    try { networks = (deriveProjectNetworks({ nodes, types: TYPES, prefixes: prefixesOf(st) }) || {}).networks || []; } catch (_) { networks = []; }

    // Igiene IPAM (doc↔doc, non doc↔realtà): IP duplicati + subnet che si
    // sovrappongono. Calcolata dal motore L3 (stesso modello dell'overlay, con gli
    // IP delle VM) e passata alla lib: la Panoramica la RACCONTA, non la ricalcola.
    // null = non valutata: la riga lo dirà, invece di dichiarare zero conflitti.
    let ipamAudit;
    try { ipamAudit = _ipamAuditReport(); } catch (_) { ipamAudit = null; }
    // ⑤ Coerenza VLAN wireless: la Panoramica la RACCONTA (stesso motore del report),
    // non la ricalcola. { issues, apCount } grezzi → il motore (lib) fa la riga.
    let wifiCoh;
    try { wifiCoh = wifiVlanCoherence(); } catch (_) { wifiCoh = { issues: [], apCount: 0 }; }

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

    // Nomi VLAN MISURATI (SNMP), aggregati sui nodi. Se due apparati danno nomi diversi
    // per lo stesso VID è una discordanza del fabric: la Panoramica la segnala e non
    // sceglie un vincitore (paletto ② no-invenzioni). Solo VLAN reali.
    // ⭐ Qui si RACCOGLIE soltanto: `said` è il verbale di CHI ha detto COSA, e il
    // giudizio — quali nomi contano per lo stesso, quindi chi discorda con chi — sta
    // tutto nel motore (una regola sola, in un posto solo, collaudabile in Node).
    // Senza i testimoni un conflitto è un'accusa che non si può chiudere.
    const measuredVlanNames = {};
    for (const n of nodes) {
        const mv = (n.integration && n.integration.vlanNames) || {};
        for (const vid in mv) {
            const nm = String(mv[vid] || '').trim();
            if (!nm) continue;
            const rec = measuredVlanNames[vid] || (measuredVlanNames[vid] = { name: nm, said: [] });
            rec.said.push({ node: getNodeDisplayName(n), name: nm });
        }
    }

    return {
        nodes, types: TYPES, links: Array.isArray(st.links) ? st.links : [], portMacNodeIds, portMacById, macToNode, presence,
        ipamVlans: ipamByVidView(st),
        prefixes: prefixesOf(st),   // prefix-first: TUTTE le reti dichiarate (anche senza VLAN, e i 2° prefissi dual-stack)
        vlanIdsInUse, vlanNames: st.vlanNames || {}, measuredVlanNames,
        spare: buildSpareReport(spareDevices), sfpTotal, rackFill, networks, ipamAudit,
        caps, fleet: computeFleetCapabilities(caps.map((x) => x.caps)), liveHealth,
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
        mgmtVlans: Array.isArray(st.mgmtVlans) ? st.mgmtVlans : [],   // ⑤ Sicurezza: VLAN marcate «di gestione» (segmentazione)
        wifiVlanIssues: wifiCoh.issues, wifiApCount: wifiCoh.apCount,   // ⑤ Sicurezza: coerenza VLAN wireless (SSID fuori dal trunk)
        // Solo un admin vede QUALE default (public/private/vuota) usa una community: il
        // motore emette il tag unicamente se questo è vero (un viewer non lo riceve mai).
        isAdmin: !!(store._currentUser && store._currentUser.role === 'admin'),
        now: Date.now(),
    };
}

// ── Parole: la lib da' chiavi e numeri, qui diventano testo ──────────────────
const _n = (v) => (v == null ? t('ov.none') : String(v));

// Mbps → l'unità con cui la gente parla delle porte: 1000 diventa «1 Gbps», 2500
// «2.5 Gbps», 100 resta «100 Mbps». Sta qui e non nella lib perché è una parola,
// non un dato — il motore ragiona in Mbps e basta.
function _speedTxt(mbps) {
    const v = Number(mbps) || 0;
    if (v >= 1000) {
        const g = v / 1000;
        return (Number.isInteger(g) ? String(g) : String(Math.round(g * 10) / 10)) + ' Gbps';
    }
    return v + ' Mbps';
}

// Una data DICHIARATA (ISO 'YYYY-MM-DD') resa nel formato locale. Se non è una
// data la si restituisce com'è: meglio il testo grezzo dell'utente che un
// «Invalid Date» — non si inventa nulla nemmeno quando il dato è malformato.
function _fmtDate(iso) {
    const s = String(iso == null ? '' : iso).trim();
    if (!s) return '';
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? new Date(ms).toLocaleDateString() : s;
}

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
        case 'suspectPorts': return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), r.total ? t('ov.of', { n: r.total }) : ''];
        case 'conflicts':    return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), ''];
        case 'secSnmp':      return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), t('ov.of', { n: r.total })];
        case 'secCommunity': return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), ''];
        case 'secMgmtVlan':  return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), ''];
        case 'secWifiVlan':  return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), ''];
        case 'neighbors':    return [_n(r.value), ''];
        case 'lags':         return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), ''];
        case 'verify':       return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), ''];
        // Numero grande = capacità SWITCH; se ci sono porte «altro» (patch panel/
        // appliance) il secondo contatore «+N non switch» sta accanto, popolazione
        // diversa, mai sommata (stesso schema di «verifiable»).
        case 'freePorts': {
            const e = r.extra || {};
            const alt = Number(e.otherFree) > 0
                ? { num: '+' + e.otherFree, sub: t('ov.st.nonSwitch') } : null;
            return r.prov === 'none' ? [t('ov.none'), '', alt] : [_n(r.value), t('ov.of', { n: r.total }), alt];
        }
        case 'freeSfp':      return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), t('ov.of', { n: r.total })];
        case 'rackU':        return r.prov === 'none' ? [t('ov.none'), ''] : [r.value + 'U', t('ov.of', { n: r.total })];
        case 'poe':          return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), t('ov.of', { n: r.total })];
        case 'uplink':       return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), 'Mbps'];
        case 'ipFree':       return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), ''];
        // DOPPIO contatore: quanti rispondono fra quelli che interroghi, e — a
        // fianco, in ambra — quanti non li interroghi affatto. Sono due popolazioni
        // diverse, non un rapporto: sommarle o metterle nello stesso «di N» le
        // farebbe leggere come una lacuna, che non sono.
        case 'verifiable': {
            const nv = (r.extra || {}).unverifiable > 0
                ? { num: String(r.extra.unverifiable), sub: t('ov.st.unverifiableShort') } : null;
            return r.prov === 'none' ? [t('ov.none'), '', nv] : [_n(r.value), t('ov.of', { n: r.total }), nv];
        }
        case 'drRedundancy': return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), t('ov.of', { n: r.total })];
        case 'drLifecycle':  return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), t('ov.of', { n: r.total })];
        // ⑥ Salute live — «quanti stanno bene su quanti ne hanno parlato». Il
        // denominatore e' chi ha RISPOSTO con quella telemetria, non la flotta.
        case 'hlReading':    return r.prov === 'none' ? [t('ov.none'), ''] : [r.total ? r.value + '/' + r.total : _n(r.value), ''];
        case 'hlHost':
        case 'hlPower':
        case 'hlSupplies':   return r.prov === 'none' ? [t('ov.none'), ''] : [_n(r.value), t('ov.of', { n: r.total })];
        case 'hlCpu':        return r.prov === 'none' ? [t('ov.none'), ''] : [r.value + '%', ''];
        default:             return [_n(r.value), r.total != null ? t('ov.of', { n: r.total }) : ''];
    }
}

// I NOMI dietro un verdetto, non il loro numero. Con più rack, «2 non rispondono»
// costringe a sfogliare le pagine per scoprire QUALI: il nome, lì, fa risparmiare
// il giro. Se ne mostrano al più tre e poi «+N»: la riga resta una riga, e il
// testo intero vive comunque nel `title` e nel dettaglio che si apre.
const _NAMES_MAX = 3;
function _itemNames(r, tag) {
    const ids = (r.items || []).filter((it) => it.tag === tag).map((it) => it.id);
    const names = ids.slice(0, _NAMES_MAX).map((id) => {
        const n = nodeById(id);
        return (n && getNodeDisplayName(n)) || String(id);
    });
    const rest = ids.length - names.length;
    return names.join(' · ') + (rest > 0 ? ' +' + rest : '');
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
        // IP e MAC in una riga sola: il numero grande conta gli IP, il verdetto
        // porta la METÀ mancante dell'identità — quanti sono senza MAC, o (se ci
        // sono tutti) quanti arrivano dalle interfacce invece che dal chassis, che
        // evita la domanda «ma il MAC c'è, perché me lo dai per mancante?».
        case 'addr': {
            if (gap > 0) return gapStatus();
            if (e.macNone > 0) return { w: t('ov.st.missingMac', { n: e.macNone }), tone: 'warn' };
            return e.fromPorts ? { w: t('ov.st.completeVia', { n: e.fromPorts }), tone: 'ok' }
                               : { w: t('ov.st.complete'), tone: 'ok' };
        }
        // Nomi VLAN: il dichiarato è legge, ma SNMP colma le lacune e segnala i conflitti.
        // Priorità: conflitto (decisione umana) > lacuna colmabile da SNMP > gap semplice.
        case 'vlanNames':
            if (e.conflict > 0 && e.fromSnmp > 0) return { w: t('ov.vlanMixed', { f: e.fromSnmp, c: e.conflict }), tone: 'warn' };
            if (e.conflict > 0) return { w: t('ov.vlanConflict', { n: e.conflict }), tone: 'warn' };
            if (e.fromSnmp > 0) return { w: t('ov.vlanFromSnmp', { n: e.fromSnmp }), tone: 'warn' };
            return gapStatus();
        // I nomi «mancanti» sono in realta' «da confermare»: il device c'e', gli
        // manca solo un nome proprio (spesso si chiama ancora come il suo IP).
        case 'name': return gapStatus('ov.st.missingNames');
        // «17 documentati» era vago proprio dove serviva precisione: un cavo
        // dedotto dall'auto-link non e' un cavo dichiarato.
        case 'cables': {
            // Dopo una Verifica il verdetto diventa il NUMERO-D'IDENTITÀ del cablaggio:
            // ogni cavo eredita lo stato dei suoi estremi (spec Proof-State §5.3). Il
            // fantasma (inferenza senza evidenza) è la notizia → tono warn. Senza
            // Verifica (proofCounts null) resta il vecchio split dedotti/manuali.
            const pc = e.proofCounts;
            if (pc) {
                const derived = pc.derivedStrong + pc.derivedWeak;
                const declared = pc.declared + pc.review;
                // I cavi su porta spenta si aggiungono in coda SOLO se ce n'è almeno
                // uno: è la condizione rara, e una riga che dice sempre «0 su porta
                // spenta» diventa rumore che si smette di leggere.
                const shut = e.shutCable || 0;
                const w = t('ov.st.cableProof', { g: pc.ghost, d: derived, m: declared })
                    + (shut > 0 ? ' · ' + t('ov.st.cableShut', { n: shut }) : '');
                return { w, tone: (pc.ghost > 0 || shut > 0) ? 'warn' : (derived > 0 ? 'info' : 'ok') };
            }
            return e.auto
                ? { w: t('ov.st.cableSplit', { m: e.manual, a: e.auto }), tone: 'info' }
                : { w: t('ov.st.documented'), tone: 'info' };
        }
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
        // Con più rack, sfogliare le pagine per scoprire cosa non va è il lavoro che
        // questa riga deve togliere: quindi qui escono i NOMI, non i conteggi.
        // Chi non risponde per primo, in rosso — è un guasto. Quando tutto quello
        // che si interroga risponde il verdetto è VERDE: chi non è verificabile lo
        // dice il SECONDO CONTATORE accanto al numero, e i nomi stanno nell'elenco
        // che si apre. Una riga di testo in più sotto il verdetto era rumore.
        case 'verifiable': {
            if (r.prov === 'none') return { w: t('ov.st.noPoll'), tone: 'none' };
            if (e.errors > 0) return { w: t('ov.st.errNames', { names: _itemNames(r, 'snmpErr') }), tone: 'bad' };
            return { w: t('ov.st.verifiedAll'), tone: 'ok' };
        }
        // Mai letto = nessun confronto possibile: «coerente» in verde sarebbe una
        // misura inventata (il numero 0 qui è assenza di dati, non assenza di guai).
        case 'suspectPorts': return r.prov === 'none'
            ? { w: t('ov.st.never'), tone: 'none' }
            : (r.value > 0 ? { w: t('ov.st.mismatch'), tone: 'warn' } : { w: t('ov.st.coherent'), tone: 'ok' });
        // Conflitti IPAM: 0 = piano pulito (verde); >0 = da risolvere (ambra). Il
        // verdetto distingue duplicati e overlap così l'utente sa cosa aprire.
        case 'conflicts':    return r.prov === 'none'
            ? { w: t('ov.confUnknown'), tone: 'none' }
            : (r.value > 0
                ? { w: t(e.dup && e.overlap ? 'ov.confBoth' : (e.overlap ? 'ov.confOverlap' : 'ov.confDup'),
                         { d: e.dup || 0, o: e.overlap || 0 }), tone: 'warn' }
                : { w: t('ov.confClean'), tone: 'ok' });
        // Stato dichiarato: nessuno lo dichiara = tratteggiato (non «tutto a posto»).
        // Quando qualcuno lo dichiara, il verdetto dice PRIMA la contraddizione — chi
        // risponde pur essendo dato fuori servizio — e solo in sua assenza quante
        // assenze la dichiarazione ha spiegato. Quel secondo numero non è decorativo:
        // è il conto dei rossi che NON abbiamo acceso, e va detto ad alta voce.
        case 'statusDeclared': {
            if (r.prov === 'none') return { w: t('ov.status.undeclared'), tone: 'none' };
            if (r.value > 0) return { w: t('ov.status.conflict', { n: r.value }), tone: 'warn' };
            return e.absentExpected > 0
                ? { w: t('ov.status.explained', { d: e.declared, a: e.absentExpected }), tone: 'info' }
                : { w: t('ov.status.clean', { d: e.declared }), tone: 'ok' };
        }
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
        // Ripartizione delle libere per velocità: le prime due classi (dalla più
        // veloce), e a seguire quante non hanno velocità nota. Quelle NON sono
        // porte lente — è il motivo per cui restano fuori dal numero grande.
        // Altezza rack: se anche un solo rack non la dichiara il totale è un'ipotesi
        // (42U di ripiego) → si dice, invece di sentenziare «pieno»/«libere» su un
        // denominatore inventato. Stesso schema di ipFree («/24 assunto»).
        case 'rackU':
            if (r.prov === 'none') return { w: t('ov.st.none'), tone: 'none' };
            if (e.assumed) return { w: t('ov.rackAssumed', { n: e.assumed }), tone: 'info' };
            return r.value === 0 ? { w: t('ov.st.rackFull'), tone: 'warn' } : { w: t('ov.st.free'), tone: 'ok' };
        // PoE: un margine NEGATIVO non è un margine. Il budget dichiarato che non
        // copre le classi misurate è un DEBITO — mostrarlo in verde come «−40 W di
        // margine» diceva «va bene» proprio dove non va (N10 dell'audit).
        case 'poe':
            if (r.prov === 'none') return { w: t('ov.ofSwitches', { n: r.total || 0 }), tone: 'none' };
            if (e.debtW) return { w: t('ov.poeDebt', { w: e.debtW, n: e.over || 0 }), tone: 'warn' };
            return { w: e.headroomW != null ? t('ov.headroomW', { n: e.headroomW }) : t('ov.st.declared'), tone: 'ok' };
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
            if (e.mismatch > 0) return { w: t('ov.dr.idMismatch', { n: e.mismatch }), tone: 'warn' };
            if (miss > 0) return { w: t('ov.dr.idGap', { n: miss }), tone: 'warn' };
            // Tutti identificabili: il firmware ignoto è un avviso LIEVE (non blocca il
            // ripristino, ma serve la versione giusta per un config compatibile).
            return e.noFirmware > 0 ? { w: t('ov.dr.fwGap', { n: e.noFirmware }), tone: 'info' } : { w: t('ov.dr.idAll'), tone: 'ok' };
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
        // Ciclo di vita: nessuno dichiara date → riga tratteggiata, non un verde.
        // Poi, dal più grave: fuori produzione · fuori garanzia · in scadenza.
        // Quando tutto è coperto il verdetto dice anche quanti NON dichiarano
        // niente: «12 di 12» su una popolazione di 32 sarebbe un verde comprato
        // con l'ignoranza degli altri 20.
        case 'drLifecycle': {
            if (r.prov === 'none') return { w: t('ov.dr.lcNone'), tone: 'none' };
            if (e.eol > 0) return { w: t('ov.dr.lcEol', { n: e.eol }), tone: 'bad' };
            if (e.expired > 0) return { w: t('ov.dr.lcExpired', { n: e.expired }), tone: 'warn' };
            if (e.soon > 0) return { w: t('ov.dr.lcSoon', { n: e.soon }), tone: 'warn' };
            return e.undeclared > 0
                ? { w: t('ov.dr.lcCoveredOf', { n: e.undeclared }), tone: 'info' }
                : { w: t('ov.dr.lcCovered'), tone: 'ok' };
        }
        // ⑤ SICUREZZA — esposizione della gestione (SNMP · community · segmentazione).
        case 'secSnmp': {
            if (r.prov === 'none') return { w: t('ov.sx.snmpNone'), tone: 'none' };
            const weak = (r.total || 0) - (r.value || 0);
            return weak > 0 ? { w: t('ov.sx.snmpWeak', { n: weak }), tone: 'warn' } : { w: t('ov.sx.snmpAll'), tone: 'ok' };
        }
        case 'secCommunity': return r.prov === 'none'
            ? { w: t('ov.sx.commNa'), tone: 'none' }
            : (r.value > 0 ? { w: t('ov.sx.commDefault', { n: r.value }), tone: 'warn' } : { w: t('ov.sx.commClean'), tone: 'ok' });
        case 'secMgmtVlan':  return r.prov === 'none'
            ? { w: t('ov.sx.vlanNone'), tone: 'none' }
            : { w: t('ov.sx.vlanSep', { n: r.value }), tone: 'info' };
        case 'secWifiVlan':  return r.prov === 'none'
            ? { w: t('ov.sx.wifiNa'), tone: 'none' }
            : (r.value > 0 ? { w: t('ov.sx.wifiIssues', { n: r.value }), tone: 'warn' } : { w: t('ov.sx.wifiOk'), tone: 'ok' });
        // ⑥ SALUTE LIVE — telemetria misurata (RAM/dischi · UPS · consumabili).
        // «Quando» in cima: una misura senza data non vale come «adesso».
        case 'hlReading':    return r.prov === 'none'
            ? { w: t('ov.hl.noReading'), tone: 'none' }
            : { w: t('ov.hl.readAge', { age: _age(e.ageMs, e.at) }), tone: 'info' };
        // Nessuna risposta per quella telemetria = riga tratteggiata: un apparato che
        // non parla di dischi non è un apparato «coi dischi a posto».
        case 'hlHost':
        case 'hlPower':
        case 'hlSupplies': {
            if (r.prov === 'none') return { w: t('ov.hl.na'), tone: 'none' };
            if (e.crit > 0) return { w: t('ov.hl.crit', { n: e.crit }), tone: 'bad' };
            if (e.alerts > 0) return { w: t('ov.hl.warn', { n: e.alerts }), tone: 'warn' };
            return { w: t('ov.hl.clean'), tone: 'ok' };
        }
        // CPU: RIPORTATA, mai giudicata. Una soglia sul carico istantaneo sarebbe
        // inventata (un picco fra due poll non è un guasto) → tono neutro sempre.
        case 'hlCpu':        return r.prov === 'none'
            ? { w: t('ov.hl.cpuNone'), tone: 'none' }
            : { w: t('ov.hl.cpuMax', { n: e.devices || 0 }), tone: 'info' };
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
        // La percentuale viaggia come custom property: il CSS decide se riempie in
        // orizzontale (larghezza, default) o in verticale (altezza, colonna ①).
        m.style.setProperty('--pct', Math.max(0, Math.min(100, r.pct)) + '%');
        m.appendChild(document.createElement('i'));
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

    // 2) il numero grande di QUESTA voce — e, se la voce ne ha DUE, il secondo
    // contatore accanto: popolazione diversa, colore diverso, mai sommati.
    const [val, sub, alt] = _tileValue(r);
    const v = _el('div', 'ov-val');
    v.appendChild(_el('span', 'ov-num', val));
    if (sub) v.appendChild(_el('span', 'ov-sub', sub));
    // Numero e parola del secondo contatore stanno in UN solo elemento: sono una
    // cosa sola («20 non verificabili»), e da elementi flex separati il numero
    // restava in riga mentre la parola scendeva sotto — un 20 orfano che sembrava
    // parte del rapporto grande. Ora, se lo spazio manca, scendono insieme.
    if (alt && alt.num) {
        const a = _el('span', 'ov-alt');
        a.appendChild(_el('span', 'ov-num-alt', alt.num));
        if (alt.sub) a.appendChild(_el('span', 'ov-sub-alt', alt.sub));
        v.appendChild(a);
        // Il riquadro con DUE contatori chiede il doppio di spazio: dentro un terzo
        // di schermo diviso in tre, «13 di 13» + «20 non verificabili» sono ~176px
        // contro i ~158 disponibili, e la seconda coppia scendeva sotto. Occupa due
        // celle della griglia invece di rimpicciolire il testo fino a non leggerlo.
        el.classList.add('has-alt');
    }
    el.appendChild(v);

    // 3) il verdetto in parole + il meter, che e' solo un rinforzo del numero.
    // A 3 tile per riga la frase puo' andare a ellissi: il testo pieno resta
    // raggiungibile in hover (title), cosi' la PAROLA non si perde mai davvero.
    const f = _el('div', 'ov-foot-row');
    const stEl = _el('span', 'ov-st', st.w);
    if (st.w) stEl.title = st.w;
    f.appendChild(stEl);
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
    // Numero-d'identità del singolo cavo: il badge dello stato di prova (post-Verifica),
    // stessa pillola dei badge di provenienza nel pannello Proprietà. `it.proof` è un
    // token dal motore (cableProof); la parola/colore li mette il badge (i18n), mai la lib.
    if (it.proof && typeof _cableProofBadgeHtml === 'function') {
        const _pb = _cableProofBadgeHtml(it.proof);
        if (_pb) { const holder = _el('span', 'ov-proof'); holder.innerHTML = _pb; inner.appendChild(holder); }
    }
    // Provenienza per-voce (misurato/dedotto): la lib da' il token, la parola
    // la mette qui — mai stringhe di interfaccia dentro la lib.
    if (it.tag) inner.appendChild(_el('span', 'ov-tag p-' + it.tag, t('ov.prov.' + it.tag)));
    // Alcune voci portano un TOKEN di metrica invece di un numero nudo (la lente
    // «Salute», il debito PoE, le date del ciclo di vita): la parola la mette qui
    // — la lib resta senza stringhe d'interfaccia. `l` è il nome grezzo (volume,
    // colore) e può mancare: il trim finale evita lo spazio orfano davanti al
    // valore. Le DATE viaggiano in ISO (confrontabili, senza lingua) e diventano
    // formato locale solo qui, all'ultimo momento.
    const metaTxt = it.metric
        ? t('ov.hl.m.' + it.metric, { v: it.metric === 'date' ? _fmtDate(it.value)
                                       : it.metric === 'speedClass' ? _speedTxt(it.value)
                                       : (it.value != null ? it.value : ''), l: it.label || '' }).replace(/\s+/g, ' ').trim()
        : (it.addr || (it.meta != null ? String(it.meta) : ''));
    if (metaTxt || it.of != null) {
        const m = _el('span', 'ov-meta');
        if (metaTxt) m.appendChild(_el('span', null, metaTxt));
        // «di {of}» attenuato: il contesto (es. utilizzabili del CIDR) accanto
        // al valore principale, senza rubargli peso.
        if (it.of != null) m.appendChild(_el('span', 'ov-meta-of', ' ' + t('ov.of', { n: it.of })));
        inner.appendChild(m);
    }
    li.appendChild(inner);
    // Il MAC va SOTTO l'indirizzo, non accanto: sono l'abbinamento ARP dello stesso
    // apparato, e affiancati su una riga di dettaglio finivano a ellissi tutti e due.
    // Quando manca si scrive un trattino — «non osservato» è un fatto, e va detto.
    if (it.mac !== undefined) {
        const mc = _el('span', 'ov-mac' + (it.mac ? '' : ' is-none'), it.mac || t('ov.none'));
        if (it.mac && it.macFromPorts) mc.title = t('ov.macFromPorts');
        li.appendChild(mc);
    }
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
    return (secKey === 'complete' && (key === 'subnets' || key === 'vlanNames')) || (secKey === 'margin' && key === 'ipFree');
}

// Assorbimento del vecchio menu «Report e analisi» nella Dashboard: dal drill-down
// del tile, un CTA apre il REPORT di dettaglio (tabella + CSV) di QUEL concetto. Il
// verdetto e gli item vivono gia' qui; il report aggiunge solo l'export → nessuna
// duplicazione (un dato, una porta). Chiave = 'secKey:rowKey'; l'azione e' registrata
// nel modulo PROPRIETARIO del report (app-spare/app-l3/app-wifi), non qui.
const _REPORT_CTA = {
    'margin:freePorts':  { act: 'overview-spare-report', label: 'ov.cta.spareReport' },
    'complete:gateways': { act: 'overview-l3-report',    label: 'ov.cta.l3Report' },
};

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
    // Ponte al report di dettaglio assorbito dal menu header (tabella + CSV).
    const _rc = _REPORT_CTA[secKey + ':' + r.key];
    if (_rc) {
        const cta = _el('button', 'ov-cta', t(_rc.label));
        cta.type = 'button';
        cta.dataset.act = _rc.act;
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
const _META_ROWS = { truth: ['lastSync', 'verify'], health: ['hlReading'] };

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
    // Verdetto stantìo: se è warn per SOLA vecchiaia del dato (niente da decidere),
    // il messaggio lo dice invece di «0 da decidere» o «margine risicato» — che
    // sarebbero due bugie diverse sulla stessa causa. Vale per ogni lente che
    // porta il flag: la lib decide QUALI (② e ③), il renderer lo racconta e basta.
    const vtxt = (health && health.stale)
        ? t('ov.staleVerdict', { n: health.staleDays || 0 })
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

// «Cosa non sto guardando»: il PERIMETRO reso esplicito. La lib dà le dimensioni
// fuori-scope (blindSpots = chiavi + tier); qui diventano parole. Sempre in fondo, a
// OGNI lente: il perimetro vale per tutta la Panoramica, non per una colonna. È
// onestà del perimetro — l'assenza di un allarme non è la promessa che «va tutto
// bene». Sola lettura, nessuna interazione: il testo pieno è nel title (hover).
function _perimeterEl(blindSpots) {
    const box = _el('section', 'ov-perimeter');
    // La riga sta SEMPRE su una riga sola, e ci sta per DIMENSIONE: etichette corte,
    // introduzione breve. La frase per esteso — perché quelle dimensioni restano
    // fuori — vive nel title della riga, così l'onestà non costa una seconda riga.
    box.title = t('ov.perimeter.hint');
    box.appendChild(_el('span', 'ov-perim-title', t('ov.perimeter.title')));
    box.appendChild(_el('span', 'ov-perim-lead', t('ov.perimeter.lead')));
    const chips = _el('span', 'ov-perim-chips');
    for (const b of blindSpots) {
        // tier 'elsewhere' = misurato altrove ma non in un verdetto qui: chip marcata
        // (un puntino) e il perché aggiunto all'hint, così la distinzione è onesta.
        const chip = _el('span', 'ov-perim-chip t-' + b.tier, t('ov.blind.' + b.key));
        chip.title = t('ov.blindHint.' + b.key)
            + (b.tier === 'elsewhere' ? ' — ' + t('ov.perimeter.elsewhere') : '');
        chips.appendChild(chip);
    }
    box.appendChild(chips);
    return box;
}

// Selettore di LENTE (opt-in): [Sintesi] [Ripristinabilità] [Sicurezza]. La scelta
// è una preferenza locale (localStorage), non tocca `state`. Sintesi resta il
// default così la schermata a 3 colonne — il paletto «una schermata» — non si affolla.
function _lensSwitchEl(active) {
    const s = _el('div', 'ov-lens-switch');
    for (const key of _LENSES) {
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

// ⑤ SICUREZZA & SERVIZI a tutta larghezza: verdetto «X di Y accessi SNMP cifrati»
// + le dimensioni (SNMP · community · VLAN di gestione). Riusa la STESSA macchina
// delle colonne (_rowEl/_detailEl via data-sec="security") e lo stile del verdetto DR.
function _securityEl(secKey, sec) {
    const col = _el('section', 'ov-col ov-col-recovery');
    col.dataset.sec = secKey;
    const h2 = document.createElement('h2');
    h2.appendChild(document.createTextNode(t('ov.sec.security')));
    col.appendChild(h2);
    col.appendChild(_el('p', 'ov-ask', t('ov.sec.securityQ')));

    // Verdetto: «quanti accessi di gestione sono cifrati?». Colore dalla salute.
    const lvl = (sec.health && sec.health.level) || 'ok';
    const verdict = _el('div', 'ov-dr-verdict v-' + lvl);
    verdict.appendChild(_el('span', 'ov-vdot'));
    if (sec.managed > 0 && sec.snmpTotal > 0) {
        const big = _el('span', 'ov-dr-big');
        big.appendChild(_el('b', null, String(sec.secured)));
        big.appendChild(_el('span', 'ov-dr-of', ' ' + t('ov.of', { n: sec.snmpTotal })));
        verdict.appendChild(big);
        verdict.appendChild(_el('span', 'ov-dr-lbl', t('ov.sx.secured')));
    } else {
        verdict.appendChild(_el('span', 'ov-dr-lbl', t(sec.managed > 0 ? 'ov.sx.noSnmp' : 'ov.sx.empty')));
    }
    col.appendChild(verdict);

    // Con apparati gestiti mostriamo le righe (anche senza SNMP: la VLAN di gestione
    // resta un segnale). Progetto senza apparati gestiti → solo il verdetto vuoto.
    if (sec.managed > 0) {
        const rows = _el('div', 'ov-rows');
        for (const r of sec.rows) rows.appendChild(_rowEl(secKey, r));
        col.appendChild(rows);
        for (const r of sec.rows) if ((r.items && r.items.length) || r.drill) col.appendChild(_detailEl(secKey, r));
    }
    return col;
}

// ⑥ SALUTE LIVE a tutta larghezza: verdetto «X di Y apparati senza allarmi» + le
// telemetrie che hanno risposto (risorse · UPS · consumabili · CPU). Riusa la STESSA
// macchina delle colonne (_rowEl/_detailEl via data-sec="health") e lo stile del
// verdetto DR — una lente in più, non un'altra grammatica da imparare.
function _healthEl(secKey, sec) {
    const col = _el('section', 'ov-col ov-col-recovery');
    col.dataset.sec = secKey;
    const h2 = document.createElement('h2');
    h2.appendChild(document.createTextNode(t('ov.sec.health')));
    col.appendChild(h2);
    col.appendChild(_el('p', 'ov-ask', t('ov.sec.healthQ')));

    // Verdetto: «quanti apparati non hanno niente da segnalare?». Senza NEMMENO
    // una lettura il livello è 'none' (grigio): «non lo so» ha il suo colore, non
    // si traveste da verde — l'errore che questa lente non deve ripetere.
    const lvl = (sec.health && sec.health.level) || 'none';
    const verdict = _el('div', 'ov-dr-verdict v-' + lvl);
    verdict.appendChild(_el('span', 'ov-vdot'));
    if (sec.measured > 0) {
        const big = _el('span', 'ov-dr-big');
        big.appendChild(_el('b', null, String(sec.healthy)));
        big.appendChild(_el('span', 'ov-dr-of', ' ' + t('ov.of', { n: sec.measured })));
        verdict.appendChild(big);
        verdict.appendChild(_el('span', 'ov-dr-lbl', t('ov.hl.healthy')));
        // Dato vecchio: il verde diventa giallo e il PERCHÉ è scritto, non implicito.
        // Una salute letta ieri non è la salute di adesso. Due frasi, due fatti
        // diversi: se anche la lettura PIÙ RECENTE è vecchia il dato è vecchio e
        // basta; se invece ce n'è una di poco fa, il problema sono gli apparati
        // rimasti indietro. L'età usa le STESSE parole della striscia in cima
        // (_snmpFreshness): due unità per lo stesso fatto si leggono come due fatti.
        const _rd = sec.rows.find((r) => r.key === 'hlReading');
        if (sec.health && sec.health.stale && _rd) {
            const e = _rd.extra || {};
            const w = sec.health.allStale
                ? t('ov.hl.stale', { age: _age(null, e.newestAt) })
                : t('ov.hl.staleSome', { n: sec.staleReadings || 0 });
            verdict.appendChild(_el('span', 'ov-hl-stale', w));
        }
    } else {
        verdict.appendChild(_el('span', 'ov-dr-lbl', t(sec.targets > 0 ? 'ov.hl.empty' : 'ov.hl.noSnmp')));
    }
    col.appendChild(verdict);

    // Il «quando» della lettura in cima, come la data del capitolo nella «Vero».
    const metaKeys = _META_ROWS[secKey] || [];
    if (metaKeys.length) col.appendChild(_metaStripEl(sec, metaKeys));

    const rows = _el('div', 'ov-rows');
    for (const r of sec.rows) {
        if (metaKeys.indexOf(r.key) !== -1) continue;
        rows.appendChild(_rowEl(secKey, r));
    }
    col.appendChild(rows);
    for (const r of sec.rows) if (r.items && r.items.length) col.appendChild(_detailEl(secKey, r));
    return col;
}

// ── La Panoramica dentro il dossier ──────────────────────────────────────────
// I verdetti che l'utente vede a schermo non arrivavano MAI nel PDF: il dossier
// consegnava i dati grezzi e teneva il giudizio dentro l'app. Chi paga la
// consulenza — «la mia rete è documentata? è ancora vera? è ripristinabile?» —
// non lo leggeva mai.
//
// Qui si costruisce il DTO per il report. Le PAROLE non si riscrivono lato
// server: sono le stesse che _tileValue/_tileStatus mettono a schermo, e la lib
// resta l'unica fonte dei numeri. Il server disegna soltanto — nessuna terza
// copia della logica (l'errore che la pagina DR ha fatto duplicando le soglie).
//
// Gli `items` NON entrano: è una sintesi da una pagina, e il drill-down (nomi,
// IP, elenchi di device) è materiale da schermo. Meno superficie, meno rischio.
const _REPORT_SECTIONS = [
    ['complete', 1], ['truth', 2], ['margin', 3],
];

export function buildOverviewReport() {
    const o = buildOverview(_buildModel());
    const sections = _REPORT_SECTIONS.map(([key, num]) => {
        const sec = o[key] || {};
        const health = sec.health || {};
        const lvl = health.level || 'ok';
        return {
            key, num,
            title: t('ov.sec.' + key),
            question: t('ov.sec.' + key + 'Q'),
            level: lvl,
            // Il verdetto di colonna, con la stessa eccezione «stantìo» dello schermo.
            verdict: health.stale
                ? t('ov.staleVerdict', { n: health.staleDays || 0 })
                : t('ov.health.' + key + '.' + lvl, { n: health.issues || 0 }),
            rows: (sec.rows || []).map((r) => {
                const [val, sub, alt] = _tileValue(r);
                const st = _tileStatus(r);
                // Nel PDF non c'è una seconda cifra grande: il contatore in più si
                // accoda al testo, così il fatto non si perde nella carta.
                return { label: t('ov.row.' + r.key), value: val,
                    sub: (sub || '') + (alt && alt.num ? ' · ' + alt.num + ' ' + (alt.sub || '') : ''),
                    status: st.w || '', tone: st.tone, prov: r.prov };
            }),
        };
    });
    return {
        sections,
        // Il perimetro dichiarato: in un dossier di consegna è la riga che
        // protegge chi consegna — nero su bianco, cosa NON è stato valutato.
        perimeter: {
            title: t('ov.perimeter.title'),
            lead: t('ov.perimeter.hint'),
            chips: (o.blindSpots || []).map((b) => t('ov.blind.' + b.key)),
        },
        legend: ['declared', 'measured', 'derived', 'none'].map((p) => ({ prov: p, label: t('ov.prov.' + p) })),
    };
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

    // Selettore di LENTE: Sintesi (le 3 colonne) · Ripristinabilità · Sicurezza · Salute live.
    const lens = _savedLens();
    root.appendChild(_lensSwitchEl(lens));

    if (_SINGLE_LENSES.indexOf(lens) !== -1) {
        const wrap = _el('div', 'ov-cols ov-cols-single');
        const build = { recovery: () => _recoveryEl('recovery', o.recovery),
                        security: () => _securityEl('security', o.security),
                        health: () => _healthEl('health', o.health) };
        wrap.appendChild(build[lens]());
        root.appendChild(wrap);
    } else {
        const cols = _el('div', 'ov-cols');
        cols.appendChild(_sectionEl('complete', 1, o.complete, dl && dl.complete));
        cols.appendChild(_sectionEl('truth', 2, o.truth, dl && dl.truth));
        cols.appendChild(_sectionEl('margin', 3, o.margin, dl && dl.margin));
        root.appendChild(cols);
    }

    // Il perimetro esplicito («cosa non sto guardando»), sotto i risultati e prima
    // della legenda: vale per tutta la Panoramica, quindi fuori dalla logica di lente.
    if (Array.isArray(o.blindSpots) && o.blindSpots.length) root.appendChild(_perimeterEl(o.blindSpots));

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
    // Il terzo segmento del fil di Arianna SEGUE la vista (Planimetria/Topologia/
    // Panoramica): cambiandola qui va ridisegnato, altrimenti resta fermo a quella
    // di prima — entrando in Panoramica continuava a dire «Topologia», e uscendone
    // il contrario. Chiamata BARE con typeof-guard, come renderOverview dalla coda
    // di renderAll (app-render-core.js): niente import nuovo fra i due moduli.
    if (typeof renderSubbar === 'function') renderSubbar();
}

export function toggleOverview() { setOverview(!document.body.classList.contains('view-overview')); }

// Commuta la lente (Sintesi ⇄ le lenti opt-in): salva la preferenza locale e
// ridisegna. Niente markDirty: cambiare lente non sporca il documento.
function _setLens(v) {
    _saveLens(v);   // _saveLens valida contro _LENSES (summary/recovery/security/health)
    renderOverview();
}

/** Ripristina la vista salvata all'avvio (dopo il primo render dello stato). */
export function restoreOverviewView() {
    if (_savedView() === 'overview') setOverview(true);
}

// renderOverview e' chiamata BARE (typeof-guard) dalla coda di renderAll in
// app-render-core.js — stesso schema di renderSubbar: evita un import circolare
// fra render-core e questo modulo, che importa gia' il nucleo.
// buildOverviewReport esce sul ponte: export.js e' uno <script> (non un modulo del
// bundle) e lo chiama con typeof-guard, come fa gia' con buildSpareReport.
expose({ renderOverview, toggleOverview, setOverview, restoreOverviewView, buildOverviewReport });

registerClickActions({
    'overview-toggle': () => toggleOverview(),
    'overview-row': (el) => _toggleRow(el),
    'overview-detail-close': (el) => { const c = el.closest('.ov-col'); if (c) _closeIn(c); },
    'overview-goto': (el) => _gotoNode(el.dataset.id),
    'overview-vlan-panel': () => _gotoVlanPanel(),
    'overview-lens': (el) => _setLens(el.dataset.lens),
    'overview-grp-tab': (el) => _switchGrpTab(el),
});
