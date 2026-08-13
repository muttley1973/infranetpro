// ============================================================
// IPAM (stato + occupazione per-VLAN)  [modulo ESM, estratto da app.js]
// Split app.js #1: helper IPAM legati allo store. Motori puri in lib/ipam.js +
// lib/cidr.js (caricati come <script>, letti bare). expose() per i consumatori
// che risolvono queste fn su window (app-ai, app-drift-adopt, app-properties-floor
// via typeof-guard); i 4 export ESM restano raggiungibili anche da ./app.js
// (re-export), così i moduli che già importano da lì non cambiano una riga.
// ============================================================
import { expose } from "./_bridge.js";
import { store } from "./store.js";
import { getNodeDisplayName, getNodeByPortId } from "./app.js";   // ciclo benigno: uso solo a runtime (dentro _collectKnownIps)
import { normalizeMacAddress } from "./app-util.js";
import { vmIps, vmIp6s } from "../lib/vm-nics.js";   // indirizzi di tutte le vNIC (stesso import di app.js: esbuild deduplica)
import { ensureIpam, vlanIpamView } from "../lib/ipam-model.js";   // l'autorita' sui prefissi: la subnet non e' piu' un campo della VLAN
// Bare globals (no-undef OFF su src/): state - computeIpamUsage (lib/ipam.js) -
// isLeaseStale (lib/dhcp-lease.js) - _parseCidrInfo/_ipInCidr/addrFamily/addrKey (lib/cidr.js).

export function _ensureIpamState(){
    return ensureIpam(state).vlans;
}

// Il RECORD per-VLAN: quel che e' davvero della VLAN e non del prefisso — il
// legame manuale con l'interfaccia SVI (`gatewayNodeId`) e i metadati che l'import
// DCIM legge dalla VLAN (nome, descrizione, stato, sito, tenant).
// ⚠️ NON contiene la subnet: quella sta in `ipam.prefixes[]`. Chi vuole vedere
// «subnet + gateway + DNS di questa VLAN» usa _vlanIpam(), che e' la VISTA.
// Si chiamava _ipamEntry: rinominata di proposito, cosi' un lettore rimasto
// indietro non trova un oggetto dalla forma giusta e dal contenuto sbagliato.
export function _vlanRecord(vid, create=false){
    const vlans = _ensureIpamState();
    const key = String(vid);
    if(!vlans[key] && create) vlans[key] = {};
    return vlans[key] || null;
}

// Vista per-VLAN derivata dall'autorita': { subnet, gateway, dns } dal prefisso
// principale + i campi per-VLAN veri. Ricalcolata a ogni chiamata, mai memorizzata.
export function _vlanIpam(vid){
    return vlanIpamView(state, vid);
}

// _parseIpv4Int, _parseCidrInfo, _ipInCidr sono ora in /lib/cidr.js
// (caricato come <script> prima di app.js, esposto come globali).

// F6 — memo IPAM per-frame. _renderFloorProps chiama _ipamUsageForPrefix per OGNI rete
// dichiarata (i chip delle card VLAN piu' la sezione «Reti»), e ognuna rifà
// _collectKnownIps()/_activeLeaseIps() (scan di TUTTI i nodi
// + lease). Con N reti il costo era ~O(N·nodi) a ogni resa. Durante UNA singola resa
// sincrona del pannello i nodi/lease non cambiano → si calcolano una volta sola. Il memo
// vive SOLO tra _ipamMemoBegin() e _ipamMemoEnd() (chiamate sincrone da _renderFloorProps)
// → nessuna staleness fuori dalla resa: le altre chiamate (Assistente AI, L3) girano con
// memo nullo e ricalcolano fresco.
let _ipamFrameMemo = null;
function _ipamMemoBegin(){ _ipamFrameMemo = { known:null, leases:null }; }
function _ipamMemoEnd(){ _ipamFrameMemo = null; }

// Gli indirizzi DOCUMENTATI, di tutte e due le famiglie. Fino alla 2.8.x il filtro
// era `_parseIpv4Int(s) == null → scarta`: ogni IPv6 usciva qui, e l'occupazione di
// una rete v6 restava a zero per sempre — un /64 con sei apparati dentro mostrava
// «1 IP» (il solo gateway, che lib/ipam.js aggiunge per conto suo). Un IPv6 e' un
// indirizzo occupato esattamente quanto un IPv4; il filtro per famiglia lo fa gia'
// `ipInCidr` prefisso per prefisso, qui non serve e faceva danno.
// La chiave e' `addrKey` (lib/cidr.js): due scritture dello stesso IPv6 sono UN
// indirizzo, e finiscono nella stessa riga invece di contare due volte.
function _collectKnownIps(){
    if(_ipamFrameMemo && _ipamFrameMemo.known) return _ipamFrameMemo.known;
    const seen = new Map();
    const _add = (ip, label) => {
        const s = String(ip||'').trim();
        if(!s || addrFamily(s) == null) return;
        const key = addrKey(s);
        // Cio' che si MOSTRA e' come e' stato scritto (manual-first): vince la prima.
        if(!seen.has(key)) seen.set(key, { ip:s, nodes:[] });
        seen.get(key).nodes.push(label);
    };
    for(const n of state.nodes || []){
        _add(n.ip, getNodeDisplayName(n));
        _add(n.ip6, getNodeDisplayName(n));
        _add(n.integration?.host, getNodeDisplayName(n));
        // Le VM occupano indirizzi REALI nella loro VLAN: senza contarle, il
        // «prossimo IP libero» (nextFree) le proponeva come libere → collisione
        // (schema ①/cecità: 32/32 IP di VM invisibili su progetto 9). Ogni indirizzo
        // di ogni vNIC entra fra i «noti», etichettato host / nome-VM.
        for(const vm of (n.vms || [])){
            const label = `${getNodeDisplayName(n)} / ${vm && vm.name ? vm.name : 'VM'}`;
            for(const rec of vmIps(vm)) _add(rec && rec.ip, label);     // vmIps  → [{nicId,name,ip}]
            for(const rec of vmIp6s(vm)) _add(rec && rec.ip6, label);   // vmIp6s → [{nicId,name,ip6}]
        }
    }
    // Indirizzi di INTERFACCIA (2.8.2, `state.ports[pid].ip`): un router risponde con
    // un IP per porta, e quegli indirizzi OCCUPANO la subnet esattamente come l'IP di
    // gestione — senza, l'occupazione era sottostimata e `nextFree` poteva proporre un
    // IP di porta gia' in uso. La chiave `addrKey` dedup-a un IP di porta uguale al
    // mgmt (conta una volta sola).
    for(const [pid, pi] of Object.entries(state.ports || {})){
        if(!pi || !pi.ip) continue;
        const nd = getNodeByPortId(pid);
        _add(pi.ip, nd ? (getNodeDisplayName(nd) || nd.name || nd.id) : pid);
    }
    // Ordine: prima gli IPv4 (numerico, 1.2.3.4 < 1.2.3.40), poi gli IPv6. Un
    // ordinamento unico misto metterebbe "2001:…" in mezzo ai "192.168…", e questa
    // lista la legge una persona nel campione della card.
    const _res = [...seen.values()].sort((a,b)=>{
        const fa = addrFamily(a.ip) || 4, fb = addrFamily(b.ip) || 4;
        if(fa !== fb) return fa - fb;
        return a.ip.localeCompare(b.ip, undefined, { numeric:true });
    });
    if(_ipamFrameMemo) _ipamFrameMemo.known = _res;
    return _res;
}

// IP dei lease DHCP ATTIVI in cache (store._dhcpLeases): scartati gli stale
// (isLeaseStale = G2, stesso criterio del Drift) e i duplicati. Alimentano
// l'occupazione IPAM (lib/ipam.js). Transitori, non persistiti.
function _activeLeaseIps(){
    if(_ipamFrameMemo && _ipamFrameMemo.leases) return _ipamFrameMemo.leases;
    const leases = Array.isArray(store._dhcpLeases) ? store._dhcpLeases : [];
    const out = [], seen = new Set();
    for(const l of leases){
        const ip = String((l && l.ip) || '').trim();
        if(!ip || seen.has(ip) || isLeaseStale(l)) continue;
        seen.add(ip);
        out.push(ip);
    }
    if(_ipamFrameMemo) _ipamFrameMemo.leases = out;
    return out;
}

// Occupazione di UN prefisso. È questa la funzione vera: un prefisso ha un CIDR e
// un gateway suoi, e una VLAN dual-stack ne ha due. _ipamUsageForVlan qui sotto
// resta come scorciatoia per i lettori che sono per-VLAN per natura.
export function _ipamUsageForPrefix(cidr, gateway){
    const known = _collectKnownIps();
    const gw = String(gateway || '').trim();
    // Motore puro (opzione A: documentati + solo-DHCP = realtà sul filo).
    const u = computeIpamUsage({
        subnet: String(cidr || ''),
        gateway: gw,
        documentedIps: known.map(x => x.ip),
        leaseIps: _activeLeaseIps(),
        parseCidr: _parseCidrInfo,
        ipInCidr: _ipInCidr,
    });
    // Dettaglio documentati con label (per il campione mostrato nella card).
    const usedDetailed = u.cidr ? known.filter(x => _ipInCidr(x.ip, u.cidr)) : [];
    return {
        cidr: u.cidr,
        gateway: gw,
        gatewayOk: u.gatewayOk,
        usedCount: u.usedCount,
        used: usedDetailed,
        sample: usedDetailed.slice(0,3),
        // Occupazione (lib/ipam.js): capacità, ripartizione, liberi, percentuale.
        capacity: u.capacity,
        documentedCount: u.documentedCount,
        dhcpOnlyCount: u.dhcpOnlyCount,
        freeCount: u.freeCount,
        pct: u.pct,
        leaseInCidr: u.leaseInCidr,
        dhcpOnly: u.dhcpOnly,
        nextFree: u.nextFree,        // «prossimo IP libero» (suggerimento IPAM / Assistente AI)
    };
}

// L'occupazione del prefisso PRINCIPALE di una VLAN. Con un prefisso per VLAN —
// cioè ogni progetto scritto fino alla 2.8.x — il risultato è identico a prima.
export function _ipamUsageForVlan(vid){
    const entry = _vlanIpam(vid);
    const u = _ipamUsageForPrefix(entry?.subnet || '', entry?.gateway || '');
    u.hasData = !!(entry && Object.keys(entry).length);
    return u;
}

// Lease "solo DHCP" di un PREFISSO come righe stile drift.undocumented, per il
// flusso Adotta (NON richiede una Verifica). Stessa base dell'ambra nella barra
// (usage.dhcpOnly = IP nel CIDR non documentati), mappata al lease per portare
// MAC + IP + hostname nell'adozione → il device adottato nasce già documentato (esce
// dall'ambra). Manual-first: sola lettura, nessun side-effect.
// Sta sul PREFISSO e non sulla VLAN perché l'occupazione è del prefisso: una rete
// senza VLAN ha lease da adottare come qualsiasi altra, e chiedendo «i lease della
// VLAN» non ne restituiva nessuno. La VLAN resta un parametro, ma solo per quello
// che è davvero suo: se è di management un lease è infrastruttura, non un endpoint.
export function _dhcpUndocumentedForPrefix(cidr, gateway, vid){
    const usage = _ipamUsageForPrefix(cidr, gateway);
    const want = new Set(Array.isArray(usage.dhcpOnly) ? usage.dhcpOnly : []);
    if(!usage.cidr || !want.size) return [];
    const leases = Array.isArray(store._dhcpLeases) ? store._dhcpLeases : [];
    // Sulla VLAN di management un lease è infrastruttura (interfaccia di gestione),
    // non un endpoint → default 'infra' (switch/rack) invece di 'pc'/floor.
    const onMgmt = (state.mgmtVlans || []).map(String).includes(String(vid));
    const out = [], seen = new Set();
    for(const l of leases){
        const ip = String((l && l.ip) || '').trim();
        if(!want.has(ip) || isLeaseStale(l)) continue;
        const mac = normalizeMacAddress(String((l && l.mac) || ''));
        if(!mac || seen.has(mac)) continue; seen.add(mac);
        const host = String((l && l.hostname) || '').trim();
        out.push({
            key: `dhcp:${mac}`, sig: mac, mac, ip, hostname: host,
            label: host ? `${host} · ${ip}` : ip,
            cls: onMgmt ? 'infra' : 'endpoint',               // mgmt → infra; altrove un lease è quasi sempre un endpoint
            // `+null === 0`: senza il controllo su null una rete senza VLAN avrebbe
            // adottato i suoi lease dentro una «VLAN 0» che non esiste.
            vlan: (l && l.vlan != null) ? l.vlan : ((vid != null && Number.isFinite(+vid)) ? +vid : null),
        });
    }
    return out;
}

// `_vlanIpamSummary` NON c'è più: era la riga di riepilogo sotto la card VLAN,
// costruita a mano con «GW …», «DNS …» e due frasi in italiano dentro il codice.
// Diceva della VLAN quello che ora dicono i chip della rete — e di UNA sola rete,
// la principale, perché una riga di testo non sa raccontarne due.
expose({ _ensureIpamState, _vlanRecord, _vlanIpam, _ipamUsageForVlan, _ipamUsageForPrefix,
         _ipamMemoBegin, _ipamMemoEnd, _collectKnownIps, _dhcpUndocumentedForPrefix });
