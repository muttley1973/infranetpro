// ============================================================
// IPAM AUDIT — igiene IPAM: IP duplicati + overlap di subnet (report puro)
// ============================================================
// Consistenza doc↔doc (NON doc↔realtà: quello è il Drift). Dati i prefissi IPAM
// dichiarati e i nodi documentati, segnala due misconfig che un IPAM reale pesca
// e che InfraNet finora non vedeva:
//   - duplicateIps[]:   lo STESSO indirizzo su >=2 nodi documentati (refuso o
//                       conflitto), IPv4 e IPv6, con l'IPv6 confrontato in forma
//                       canonica: due scritture dello stesso indirizzo sono UN
//                       indirizzo. ⚠️ Non nella stessa VRF = non e' un conflitto:
//                       due VRF sono due tabelle di routing. Si esclude SOLO se
//                       entrambe sono DICHIARATE e diverse (come per i prefissi):
//                       se una manca non lo sappiamo, e resta un duplicato
//   - subnetOverlaps[]: due PREFISSI che si INTERSECANO (o sono la stessa rete)
//   - addressesOutsidePlan[]: un indirizzo DOCUMENTATO che non cade in nessuna
//                       rete dichiarata. E' il declare-first applicato all'IPAM:
//                       il piano e' l'autorita', e un apparato che vive fuori dal
//                       piano o e' un errore di battitura, o e' una rete che
//                       nessuno ha mai scritto. In entrambi i casi si dice.
//
// Funzione PURA, sola lettura: NON muta nulla (manual-first) e non inventa —
// tutto deriva dai campi già documentati dall'utente. Nessun DOM, nessun globale.
// UMD-lite: browser (window) + Node (module.exports), come lib/ipam.js.
//
// INPUT model = {
//   prefixes:  [ { cidr, vlan, container?, status?, vrfId? } ],  // ipam.prefixes[] — l'autorità
//   nodes:     [ { id, name, ip, ip6 } ],            // nodi documentati (entrambe le famiglie)
//                       + facoltativi, l'ANCORA con cui `addresses` si lega al nodo: `deviceRef` (l'id del device
//                       nel DCIM: `source.deviceId`) e `portId` (una riga per IP di porta)
//   addresses: [ { address, vrfId?, vrfName?, portId?, deviceId? } ],  // ipam.addresses[]: gli IP che il DCIM dichiara.
//                       Da qui, PER VALORE, si legge la VRF di ogni indirizzo (`attachVrfs`)
//   parseCidr: fn(cidr) -> { family, network, broadcast, prefix, raw } | null  // iniettato (lib/cidr.js _parseCidrInfo)
//   vlanNames: { <vid>: nome },                     // il piano VLAN: dare un nome è dichiarare
//   vlansInUse:[ { vlan, where:[nomi] } ],           // VLAN viste nel documento (porte/trunk/SSID/VM)
//   siteNativeVlan: numero,                          // il pavimento: non si accusa
// }
// OUTPUT {
//   duplicateIps:  [ { ip, nodes:[ { id, name } ] } ],                    // ordinati per IP
//   duplicateIpsSharedByHa: [ { ip, nodes } ],   // ci sono, non sono un errore: l'indirizzo di servizio di un
//                       gruppo HA DICHIARATO per intero (nodi con `haPeer` reciproco, o lo stesso `haGroupId`)
//   duplicateIpsAcrossVrf:  [ { ip, vrfs:[{id,name}], nodes:[{id,name,vrfId}] } ],  // ci sono, non sono un errore: lo
//                       stesso indirizzo in due VRF DICHIARATE e diverse. Si dicono lo stesso: «un audit che tace viene creduto»
//   subnetOverlaps:[ { a:{cidr,vlan}, b:{cidr,vlan}, identical } ],       // ordinati per indirizzo, `a` prima di `b`
//   subnetOverlapsExpected: [ { a, b, identical, reason } ],              // ci sono, non sono un errore
//   addressesOutsidePlan:   [ { ip, family, node:{id,name} } ],           // ordinati per indirizzo
//   vlansOutsidePlan:       [ { vlan, where:[nomi] } ],                  // ordinate per numero
//   notChecked:             [ { check, reason } ],                        // ⭐ vedi qui sotto
// }
//
// ⭐ `notChecked` esiste perche' «non ho potuto controllare» e «ho controllato e
// non c'e' niente» uscivano IDENTICI: una lista vuota. Se `parseCidr` non arriva,
// il classificatore delle sovrapposizioni ritorna zero conflitti — e il report
// scrive «nessun problema» su una verifica che non e' mai partita. E' l'opposto
// esatto della regola che questo progetto applica ovunque al grigio «non risulta»,
// e in un audit e' peggio che in un disegno: un audit che tace viene creduto.
// Ogni controllo che non ha potuto girare lascia qui il suo nome e il motivo.
// `status` e `vrfId` arrivano dall'import DCIM e finora non li leggeva nessuno: un
// contenitore che contiene le proprie reti, o lo stesso spazio in due VRF diverse,
// venivano accusati come conflitti. Sono la norma in un piano vero.
// ⚠️ E `container` è la stessa cosa DETTA DA TE: senza di lui una gerarchia scritta
// a mano non aveva modo di dichiararsi, e restava accusata per sempre di una
// sovrapposizione che era voluta. Vedi `isContainerPrefix`.
(function (root, factory) {
  // `cidrLib` = lib/cidr.js: Node/bundle via require, browser via window (cidr.js
  // e' uno <script> caricato prima). Stessa convenzione di lib/correlate.js.
  const cidrLib = (typeof module !== 'undefined' && module.exports) ? require('./cidr.js') : root;
  const api = factory(cidrLib);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (cidrLib) {
  'use strict';

  // Chiave numerica di un IPv4 per un ordinamento stabile "umano" (1.2.3.4 <
  // 1.2.3.40). Se non è un IPv4 valido → NaN (finisce in coda, ordine stringa).
  // ⭐ Un ottetto e' SOLO cifre decimali, e la definizione sta in lib/cidr.js: una sola.
  // Qui c'era una copia con `Number()`, che digeriva '0x7f'->127, '1e2'->100 e l'ottetto
  // vuoto->0 — la superficie IDENTICA che 6bb4f9c ha tolto a cidr.js. Un indirizzo finto
  // prendeva una chiave numerica e si metteva in fila FRA i veri, invece di cadere in
  // coda col resto di cio' che non e' un indirizzo. Il sentinella resta NaN, che e' la
  // convenzione dei due sort qui dentro. Il ripiego sotto serve solo se cidr.js non c'e'
  // (browser, <script> non ancora caricato): mai un risultato inventato.
  function _ipSortKey(ip) {
    const f = cidrLib && cidrLib._parseIpv4Int;
    if (typeof f === 'function') { const n = f(ip); return n == null ? NaN : n; }
    const p = String(ip || '').trim().split('.');
    if (p.length !== 4) return NaN;
    let n = 0;
    for (const o of p) {
      const v = Number(o);
      if (!Number.isInteger(v) || v < 0 || v > 255) return NaN;
      n = (n * 256) + v;
    }
    return n;
  }

  // L'intersezione fra due prefissi ha UNA definizione, in lib/cidr.js, e vale per
  // IPv4 e IPv6. Qui c'era il confronto fra interi a 32 bit: su un prefisso v6 quei
  // campi non esistono e i confronti su `undefined` davano `false` — nessun falso
  // positivo, ma per caso, non per scelta.
  function _rangesOverlap(a, b) {
    const f = cidrLib && cidrLib._cidrsOverlap;
    return typeof f === 'function' ? !!f(a, b) : false;
  }

  // L'identita' di un indirizzo ha UNA definizione, in lib/cidr.js: un IPv4 e' la
  // sua stringa, un IPv6 la sua forma canonica. Senza, "2001:DB8::10" e
  // "2001:db8:0:0:0:0:0:10" sullo stesso segmento passavano per due indirizzi
  // diversi, ed e' proprio il caso che questo audit deve pescare.
  function _key(addr) {
    const f = cidrLib && cidrLib.addrKey;
    return typeof f === 'function' ? f(addr) : String(addr == null ? '' : addr).trim();
  }

  // Stesso indirizzo (non vuoto) su >=2 nodi documentati. IPv4 E IPv6: un device
  // dual-stack ne dichiara due, e un IPv6 ricopiato su due apparati e' un conflitto
  // esattamente quanto un IPv4 — prima di qui nessuno lo guardava.
  // Un nodo che ripete lo stesso indirizzo su entrambi i campi non fa un duplicato
  // con se' stesso: la lista e' per NODO, non per campo.
  // Un IPv6 link-local (fe80::/10) e' unico PER-LINK (RFC 4007): lo stesso fe80::1 su
  // due router in segmenti diversi e' legale, non un conflitto. L'app non modella il
  // "link" dall'ip6 di gestione, quindi non puo' dire se due nodi lo condividono →
  // fuori dall'audit duplicati. Definizione della classe in lib/cidr.js (una sola).
  function _isLinkLocal(addr) {
    const f = cidrLib && cidrLib.addrIsLinkLocalV6;
    return typeof f === 'function' ? !!f(addr) : false;
  }

  // Il «gruppo HA» DICHIARATO di un nodo (lib/ha-pair.js): `haGroupId` per un cluster, `haPeer` per una
  // coppia 1-1. Due unita' sono lo stesso gruppo solo se lo DICHIARANO tutte e due: una coppia e' la
  // chiave ordinata dei due id, quindi A.peer=B e B.peer=A coincidono, mentre A.peer=B senza che B
  // risponda no (un lato solo non e' una coppia dichiarata — e lo dice gia' validateHaSymmetry).
  function _haSetKey(n) {
    if (!n) return null;
    const gid = typeof n.haGroupId === 'string' ? n.haGroupId.trim() : '';
    if (gid) return 'g:' + gid;
    const peer = typeof n.haPeer === 'string' ? n.haPeer.trim() : '';
    if (peer && n.id != null) return 'p:' + [String(n.id), peer].sort().join('|');
    return null;
  }

  // ── La VRF di un indirizzo ─────────────────────────────────────────────────
  // Due apparati con lo stesso indirizzo in VRF DIVERSE non si confondono: sono due tabelle di routing, ed
  // e' la norma (clienti diversi sulla stessa rete). Era l'unico controllo di questo file che non lo sapeva:
  // quello dei prefissi si'. La regola e' la STESSA, e per lo stesso motivo — si esclude solo se ENTRAMBE le
  // VRF sono dichiarate e diverse; se una manca non lo sappiamo, e il silenzio non si compra con l'ignoranza.
  //
  // La VRF NON sta sul nodo: sta sull'indirizzo che il DCIM dichiara (`ipam.addresses[]`). Si legge da li' PER
  // VALORE, e solo se il record combacia con l'indirizzo che il nodo scrive ORA: se l'utente lo corregge a mano
  // la VRF smette di valere (declare-first) invece di restare attaccata a un indirizzo che non c'e' piu'.

  // Un record dell'IPAM dice la sua VRF? `''` e `null` = nessuna: la tabella globale, o non detto — non si sa.
  function _recVrf(r) {
    if (!r || r.vrfId == null || r.vrfId === '') return null;
    return { id: r.vrfId, name: r.vrfName == null ? '' : String(r.vrfName).trim() };
  }

  // L'indirizzo `r` e' PROPRIO di quel nodo? L'àncora e' la porta (`portId`: l'IP di un'interfaccia) o il device
  // (`deviceId` del record = `deviceRef` del nodo). Numero e stringa sono lo stesso id.
  function _anchored(r, entry) {
    if (entry.portId != null && r.portId != null && String(r.portId) === String(entry.portId)) return true;
    return entry.deviceRef != null && r.deviceId != null && String(r.deviceId) === String(entry.deviceRef);
  }

  // La VRF di UN indirizzo di UN nodo, o `null` se non si sa. Un nodo con àncora si fida SOLO dei record che gli
  // appartengono: lo stesso indirizzo di un altro device, in un'altra VRF, non e' il suo. Un nodo senza àncora
  // (una VM, un apparato scritto a mano) si fida del valore solo se in tutto l'IPAM sta in UNA VRF sola.
  function _vrfOfAddress(entry, raw, index) {
    const cands = index.get(_key(raw));
    if (!cands) return null;
    const ancorato = entry.portId != null || entry.deviceRef != null;
    const pool = ancorato ? cands.filter(r => _anchored(r, entry)) : cands;
    let vrf = null;
    for (const r of pool) {
      const v = _recVrf(r);
      if (!v) return null;                                    // un record senza VRF: non si sa
      if (!vrf) vrf = v;
      else if (String(vrf.id) !== String(v.id)) return null;  // i record non concordano
      else if (!vrf.name && v.name) vrf.name = v.name;
    }
    return vrf;
  }

  /**
   * Attacca a ogni nodo la VRF dei suoi indirizzi (`ipVrf` per `ip`, `ip6Vrf` per `ip6`: `{id,name}` o `null`),
   * leggendola da `addresses` (= `ipam.addresses[]`). Non modifica l'input.
   * @param {Array} nodes      voci come quelle di `buildIpamAudit`; l'àncora e' `deviceRef` e/o `portId`
   * @param {Array} addresses  [{ address, vrfId?, vrfName?, portId?, deviceId? }]
   */
  function attachVrfs(nodes, addresses) {
    const index = new Map();
    for (const r of (Array.isArray(addresses) ? addresses : [])) {
      if (!r || !r.address) continue;
      const k = _key(String(r.address).trim().split('/')[0]);
      if (!k) continue;
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(r);
    }
    return (Array.isArray(nodes) ? nodes : []).map(n => {
      if (!n || typeof n !== 'object') return n;
      return Object.assign({}, n, {
        ipVrf: n.ip ? _vrfOfAddress(n, n.ip, index) : null,
        ip6Vrf: n.ip6 ? _vrfOfAddress(n, n.ip6, index) : null,
      });
    });
  }

  // Due apparati sullo stesso indirizzo si danno fastidio salvo che le loro VRF siano dichiarate e diverse.
  function _sameTable(a, b) { return !(a.vrf && b.vrf && String(a.vrf.id) !== String(b.vrf.id)); }

  // I gruppi «indirizzo → nodi che lo scrivono» (>= 2), con per ciascun nodo la VRF e il gruppo HA.
  function _groups(nodes) {
    const byIp = new Map();
    for (const n of (Array.isArray(nodes) ? nodes : [])) {
      const seen = new Set();
      for (const [raw, vrf] of [[n && n.ip, n && n.ipVrf], [n && n.ip6, n && n.ip6Vrf]]) {
        if (_isLinkLocal(raw)) continue;
        const key = _key(raw);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        // La chiave normalizza, ma cio' che si MOSTRA e' com'e' stato scritto
        // (manual-first): vince la prima scrittura incontrata.
        if (!byIp.has(key)) byIp.set(key, { ip: String(raw).trim(), entries: [] });
        byIp.get(key).entries.push({
          id: n.id, name: n.name || n.id || '',
          vrf: vrf && vrf.id != null ? vrf : null,
          set: _haSetKey(n),
        });
      }
    }
    return [...byIp.values()].filter(g => g.entries.length >= 2);
  }

  // Il gruppo senza chi e' al riparo in un'altra VRF: restano i nodi che hanno ALMENO UN altro con cui dividere
  // la stessa tabella (o che non si sa). Meno di due → nessun conflitto.
  function _conflicting(g) {
    const es = g.entries;
    const hit = es.filter((a, i) => es.some((b, j) => i !== j && _sameTable(a, b)));
    // la relazione e' simmetrica: o nessuno ha un compagno di tabella, o ce ne sono almeno due
    return hit.length ? { ip: g.ip, entries: hit } : null;
  }

  // Tutti i nodi che scrivono quell'indirizzo sono dello STESSO gruppo HA dichiarato? Allora e' l'indirizzo
  // di SERVIZIO del gruppo (VIP, IP del cluster), non un conflitto. Basta uno fuori — un terzo apparato,
  // un'altra coppia, un lato che non conferma — e resta un duplicato, con tutti i nomi.
  function _sharedByOneHaSet(rec) {
    const first = rec.entries[0].set;
    return !!first && rec.entries.every(e => e.set === first);
  }

  function _publicRec(rec) { return { ip: rec.ip, nodes: rec.entries.map(e => ({ id: e.id, name: e.name })) }; }

  // I gruppi in conflitto (dopo le VRF), per chi poi li divide fra «errore» e «gruppo HA».
  function _conflictGroups(nodes) { return _groups(nodes).map(_conflicting).filter(Boolean); }

  function _sortRecs(out) {
    out.sort((x, y) => {
      const kx = _ipSortKey(x.ip), ky = _ipSortKey(y.ip);
      // Le famiglie non si mescolano: prima le v4 (chiave numerica), poi tutto il
      // resto in ordine di stringa. Scelta qualsiasi, ma STABILE.
      if (Number.isNaN(kx) || Number.isNaN(ky)) {
        if (Number.isNaN(kx) !== Number.isNaN(ky)) return Number.isNaN(kx) ? 1 : -1;
        return String(x.ip).localeCompare(String(y.ip));
      }
      return kx - ky;
    });
    return out;
  }

  function findDuplicateIps(nodes) {
    return _sortRecs(_conflictGroups(nodes).filter(rec => !_sharedByOneHaSet(rec)).map(_publicRec));
  }

  // L'altra faccia: gli indirizzi che piu' nodi scrivono ma che un gruppo HA DICHIARATO (per intero)
  // condivide. Non sono un errore e non spariscono dal report: «un audit che tace viene creduto».
  function findSharedHaIps(nodes) {
    return _sortRecs(_conflictGroups(nodes).filter(_sharedByOneHaSet).map(_publicRec));
  }

  // E la terza: lo stesso indirizzo in due o piu' VRF DICHIARATE e diverse. Non e' un errore — sono tabelle di
  // routing separate — ma «ce n'erano e li ho giudicati normali» e' un'altra frase da «non ce n'erano»: un
  // conteggio che cala in silenzio e' peggio di uno sbagliato (lo stesso motivo di `subnetOverlapsExpected`).
  // Elenca i nodi che DICHIARANO la loro VRF; quelli che non la dicono non sono qui, sono nei duplicati.
  function findDuplicateIpsAcrossVrf(nodes) {
    const out = [];
    for (const g of _groups(nodes)) {
      const note = g.entries.filter(e => e.vrf);
      const vrfs = new Map();
      for (const e of note) {
        const k = String(e.vrf.id);
        if (!vrfs.has(k) || (!vrfs.get(k).name && e.vrf.name)) vrfs.set(k, { id: e.vrf.id, name: e.vrf.name || '' });
      }
      if (vrfs.size < 2) continue;
      out.push({
        ip: g.ip,
        vrfs: [...vrfs.values()],
        nodes: note.map(e => ({ id: e.id, name: e.name, vrfId: e.vrf.id })),
      });
    }
    return _sortRecs(out);
  }

  // Ordine nello SPAZIO DEGLI INDIRIZZI: 10.0.0.0/8 prima di 192.168.1.0/24, e a
  // parità di rete il prefisso più largo prima del più stretto (/24 prima di /25).
  // Le famiglie non si mescolano: prima le v4, poi le v6 — una scelta qualsiasi, ma
  // STABILE, così due letture consecutive non si scambiano le righe.
  // Sta qui perché è l'ordine con cui si LEGGE un piano di indirizzamento — le
  // collisioni sono vicine nello spazio degli indirizzi, non nelle VLAN. Una
  // definizione sola, riusata da chi mostra l'elenco: la stessa regola in due strati
  // diverge, ed è sempre l'incompleta a vincere.
  function compareCidr(a, b) {
    if (!a || !b) return a ? -1 : (b ? 1 : 0);
    const fa = a.family || 4, fb = b.family || 4;
    if (fa !== fb) return fa - fb;
    if (fa === 6) {
      const wa = a.network6 || [], wb = b.network6 || [];
      for (let i = 0; i < 8; i++) { const d = (wa[i] || 0) - (wb[i] || 0); if (d) return d; }
      return a.prefix - b.prefix;
    }
    // `network` è unsigned a 32 bit: si confronta, non si sottrae (la differenza
    // fra due /8 lontane esce dal range dei signed).
    if (a.network !== b.network) return a.network < b.network ? -1 : 1;
    return a.prefix - b.prefix;
  }

  // Coppie di PREFISSI dichiarati che si sovrappongono. Prende `ipam.prefixes[]`,
  // non la vista per-VLAN: la sovrapposizione è un fatto dello spazio degli
  // indirizzi (L3), e la VLAN (L2) è un attributo FACOLTATIVO di ciascuno dei due.
  // Confrontare «il prefisso principale di ogni VLAN» rendeva invisibili sia le reti
  // senza VLAN (su un NetBox vero, la maggioranza) sia il secondo prefisso di una
  // VLAN dual-stack.
  // Due prefissi sulla STESSA VLAN non sono più esclusi a priori: v4+v6 è dual-stack
  // e non si interseca mai (ci pensa `_cidrsOverlap`, famiglie diverse), ma due v4
  // che si intersecano sulla stessa VLAN sono un conflitto vero.
  // `identical` = si sovrappongono e hanno lo stesso prefisso ⇒ sono la stessa rete.
  //
  // ⚠️ NON tutte le sovrapposizioni sono un errore, e due casi sono la NORMA in un
  // piano indirizzi vero (si vedono al primo import da un DCIM). `_expectedReason`
  // li riconosce e li tiene FUORI dall'accusa — restano contati a parte, perché un
  // conteggio che cala in silenzio è peggio di un conteggio sbagliato.
  //
  //   'hierarchy' — un prefisso CONTENITORE e le reti dichiarate dentro di lui. In
  //     un IPAM il contenitore serve esattamente a dire «questo spazio è suddiviso
  //     qua sotto»: accusarlo di sovrapporsi ai propri figli è come accusare un
  //     cassetto di occupare il posto delle cartelle che contiene.
  //   'vrf' — lo stesso spazio in due VRF DICHIARATE e diverse: sono due tabelle di
  //     routing separate, e la stessa 192.168.1.0/24 può viverci due volte senza che
  //     nessuno si confonda. Solo se ENTRAMBE sono note: se una manca non lo
  //     sappiamo, e il silenzio non si compra con l'ignoranza.
  //
  // ⚠️ In aritmetica CIDR due prefissi della stessa famiglia o sono disgiunti o uno
  // CONTIENE l'altro — la sovrapposizione parziale non esiste. Quindi «si
  // sovrappongono e hanno prefissi diversi» significa già «il più largo contiene il
  // più stretto»: basta guardare se il più largo è un contenitore.
  /**
   * «Questa rete è un CONTENITORE»: esiste per essere suddivisa, non per ospitare
   * apparati. UNA definizione per DUE sorgenti, ed è deliberato che stia qui e non
   * ricomposta in chi la usa — è così che due strati cominciano a rispondere
   * diverso alla stessa domanda.
   *
   * ⚠️ Prima lo diceva solo il DCIM (`status: 'container'`, vocabolario di NetBox),
   * e una gerarchia scritta A MANO non aveva nessun modo di dichiararsi: restava
   * accusata di sovrapporsi alle proprie sottoreti, a ogni apertura del report,
   * per sempre. Un avviso che non si può chiudere perché è vero-ma-voluto è il modo
   * più rapido per insegnare a chi legge a ignorare TUTTI gli avvisi.
   *
   * ⚠️ Manual-first, e in entrambi i versi: `container:true` dichiara, ma
   * `container:false` NEGA anche ciò che il DCIM afferma. Chi documenta ha visto la
   * rete; l'import ha letto un altro archivio. La chiave ASSENTE non è né l'uno né
   * l'altro: vuol dire «non l'ho detto io», e allora parla la sorgente.
   * @param {{container?:boolean, status?:any}|null|undefined} p
   */
  function isContainerPrefix(p) {
    if (!p) return false;
    if (p.container === true) return true;
    if (p.container === false) return false;
    // Normalizzato a minuscole: «Container» e «container» sono la stessa parola.
    return String(p.status == null ? '' : p.status).trim().toLowerCase() === 'container';
  }

  /**
   * Che cosa SALVARE quando l'interruttore del pannello passa a `checked`.
   *
   * L'interruttore mostra la RISPOSTA (`isContainerPrefix`), non il campo grezzo:
   * una rete importata come contenitore nasce già accesa. Quindi si conserva la
   * DIFFERENZA rispetto a ciò che dice la sorgente — d'accordo con lei non c'è
   * nessuna dichiarazione da tenere (`''`, e chi scrive toglie la chiave), in
   * disaccordo resta scritta. ⚠️ Senza questo, ogni rete che apri si porterebbe a
   * casa un `container:false` che non afferma niente: la stessa zavorra dei campi
   * che si pre-compilavano da soli.
   * @returns {boolean|''} il valore da scrivere, o '' per «togli la chiave»
   */
  function containerDeclarationFor(p, checked) {
    return (!!checked === isContainerPrefix({ status: p && p.status })) ? '' : !!checked;
  }

  function _expectedReason(a, b) {
    if (a.vrf != null && b.vrf != null && a.vrf !== b.vrf) return 'vrf';
    if (a.info.prefix !== b.info.prefix) {
      const wide = a.info.prefix <= b.info.prefix ? a : b;
      if (wide.container) return 'hierarchy';
    }
    return null;
  }

  // Un solo passaggio, due viste: la regola di cosa è un conflitto vive QUI e non
  // in due funzioni gemelle che col tempo divergono.
  function _classifyOverlaps(prefixes, parseCidr) {
    const empty = { conflicts: [], expected: [] };
    if (typeof parseCidr !== 'function') return empty;
    const parsed = [];
    for (const p of (Array.isArray(prefixes) ? prefixes : [])) {
      if (!p) continue;
      const cidr = String(p.cidr == null ? '' : p.cidr).trim();
      if (!cidr) continue;
      const info = parseCidr(cidr);
      if (!info) continue;
      // `+null === 0`: il null resta null, o una rete senza VLAN diventa «VLAN 0».
      const vlan = (p.vlan == null || !Number.isFinite(+p.vlan)) ? null : +p.vlan;
      // Dichiarato a mano oppure detto dal DCIM: la domanda è una, e la risposta
      // sta in `isContainerPrefix` — qui non si ricompone la regola.
      const container = isContainerPrefix(p);
      const vrf = (p.vrfId == null || p.vrfId === '') ? null : String(p.vrfId);
      parsed.push({ cidr, vlan, container, vrf, info });
    }
    // Ordinati PRIMA del confronto: le coppie escono già in ordine di indirizzo e
    // `a` è sempre il prefisso che viene prima.
    parsed.sort((x, y) => compareCidr(x.info, y.info) || String(x.cidr).localeCompare(String(y.cidr)));
    const conflicts = [], expected = [];
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const a = parsed[i], b = parsed[j];
        if (!_rangesOverlap(a.info, b.info)) continue;
        const pair = {
          a: { cidr: a.cidr, vlan: a.vlan },
          b: { cidr: b.cidr, vlan: b.vlan },
          identical: a.info.prefix === b.info.prefix,
        };
        const reason = _expectedReason(a, b);
        if (reason) expected.push(Object.assign({ reason }, pair));
        else conflicts.push(pair);
      }
    }
    return { conflicts, expected };
  }

  /**
   * Indirizzi documentati che non cadono in NESSUNA rete dichiarata.
   *
   * Il piano IPAM e' l'autorita' (declare-first): se un apparato vive fuori da
   * tutte le reti che hai scritto, o l'indirizzo e' sbagliato o la rete non e'
   * mai stata dichiarata. Sono due conclusioni diverse e non sta a noi sceglierne
   * una — si nomina l'indirizzo e chi lo porta, e decide chi legge.
   *
   * ⚠️ Si giudica PER FAMIGLIA, e questa e' la guardia che tiene su tutto il
   * resto: se il piano non dichiara nemmeno una rete IPv6, allora ogni IPv6
   * documentato risulterebbe «fuori dal piano» — e non sarebbe una scoperta, solo
   * il rumore di un confronto contro il nulla. Nessuna rete di quella famiglia =
   * nessun giudizio su quella famiglia. Vale anche per l'IPv4: un progetto senza
   * reti dichiarate non accusa nessuno.
   *
   * ⚠️ Il link-local IPv6 resta fuori per la stessa ragione per cui e' fuori dai
   * duplicati: `fe80::/10` non appartiene a un piano di indirizzamento, esiste su
   * ogni interfaccia per conto suo (RFC 4291) e nessuno lo dichiara mai.
   */
  /**
   * Le VLAN che il PIANO dichiara.
   *
   * ⚠️ NON è `vlanColors`: quello è l'elenco di ogni VLAN mai VISTA, e ci finisce
   * da sola ogni VLAN letta via SNMP (`_ensureVlanColor`). Un elenco che si
   * riempie da solo non può fare da piano — confrontare l'uso con quello sarebbe
   * confrontare una cosa con se stessa, e uscirebbe sempre «tutto a posto».
   *
   * Dichiarare è un ATTO, e ne bastano due: darle un nome, o darle una rete.
   * Chi ha fatto l'uno o l'altro ha detto «questa VLAN esiste e so cos'è».
   * @returns {Set<number>}
   */
  function declaredVlans(prefixes, vlanNames) {
    const out = new Set();
    for (const p of (Array.isArray(prefixes) ? prefixes : [])) {
      if (!p || p.vlan == null || !Number.isFinite(+p.vlan)) continue;
      out.add(+p.vlan);
    }
    const names = (vlanNames && typeof vlanNames === 'object') ? vlanNames : {};
    for (const k of Object.keys(names)) {
      const v = +k;
      if (Number.isFinite(v) && String(names[k] == null ? '' : names[k]).trim()) out.add(v);
    }
    return out;
  }

  /**
   * Le VLAN che il documento USA DAVVERO, con il nome di chi le porta.
   *
   * ⚠️ Non è `vlanColors`: quello è l'elenco di ogni VLAN mai VISTA — ci finisce
   * da sola ogni VLAN letta via SNMP — e serviva a colorare, non a dichiarare.
   * Confrontare l'uso con quell'elenco vorrebbe dire confrontare una cosa con se
   * stessa, e uscirebbe «tutto a posto» su qualunque progetto.
   *
   * Si guarda dove le VLAN vivono per davvero, e le sorgenti sono TRE — dimenticarne
   * una non si vede a schermo, si vede solo qui:
   *   · le PORTE: misurata (`vlan`), dichiarata (`vlanOvr`), propagata (`vlanProp`),
   *     più le trasportate del trunk (`trunkVlans`) e quelle propagate lungo il run
   *     passivo (`trunkProp`);
   *   · i DEVICE: SSID delle radio, voce VoIP, vNIC delle VM — tutte e tre da
   *     `carriedVlans`, che è già l'unica definizione di «cosa trasporta questo
   *     apparato»;
   *   · i CAVI: il trunk scritto a mano sul collegamento, che non sta su nessuna
   *     delle due.
   *
   * Le funzioni arrivano iniettate come `parseCidr`: questa lib resta pura e non
   * sa niente né del DOM né di dove viva lo stato.
   * @returns {Array<{vlan:number, where:string[]}>} ordinate per numero
   */
  function collectVlansInUse(doc) {
    const d = doc || {};
    const carried = typeof d.carriedVlans === 'function' ? d.carriedVlans : () => [];
    const parseList = typeof d.parseVlanList === 'function' ? d.parseVlanList : () => [];
    const nodeOfPort = typeof d.nodeOfPort === 'function' ? d.nodeOfPort : () => null;
    const nameOf = typeof d.nameOf === 'function' ? d.nameOf : (n => (n && (n.name || n.id)) || '');

    const visto = new Map();
    const add = (v, dove) => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1 || n > 4094) return;
      if (!visto.has(n)) visto.set(n, new Set());
      if (dove) visto.get(n).add(String(dove));
    };

    const ports = (d.ports && typeof d.ports === 'object') ? d.ports : {};
    for (const pid of Object.keys(ports)) {
      const pi = ports[pid] || {};
      const dove = nameOf(nodeOfPort(pid));
      add(pi.vlan, dove); add(pi.vlanOvr, dove); add(pi.vlanProp, dove);
      for (const v of parseList(pi.trunkVlans || [])) add(v, dove);
      if (Array.isArray(pi.trunkProp)) for (const v of pi.trunkProp) add(v, dove);
    }
    for (const n of (Array.isArray(d.nodes) ? d.nodes : [])) {
      const dove = nameOf(n);
      for (const v of carried(n)) add(v, dove);
    }
    for (const l of (Array.isArray(d.links) ? d.links : [])) {
      if (!l || !l.trunkVlans) continue;
      const dove = nameOf(nodeOfPort(l.src)) || nameOf(nodeOfPort(l.dst));
      for (const v of parseList(l.trunkVlans)) add(v, dove);
    }
    return Array.from(visto.entries())
      .map(([vlan, chi]) => ({ vlan, where: Array.from(chi).sort() }))
      .sort((a, b) => a.vlan - b.vlan);
  }

  /**
   * VLAN che il documento USA e di cui il piano non dice niente.
   *
   * È il declare-first applicato alle VLAN, gemello di `addressesOutsidePlan`: se
   * un cavo porta la VLAN 30 e nel piano la 30 non ha né un nome né una rete, o
   * qualcuno l'ha configurata senza scriverla, o l'ha scritta e non è più quella.
   * Le due conclusioni sono diverse e non sta a noi sceglierne una: si dice il
   * numero e dove si è visto.
   *
   * ⚠️ La guardia che tiene su tutto: se il piano non dichiara NEMMENO UNA VLAN,
   * nessun giudizio. Ogni VLAN in uso risulterebbe fuori dal piano, e non sarebbe
   * una scoperta — solo il rumore di un confronto contro il nulla, su ogni
   * progetto che non usa ancora la sezione VLAN. Identico al «nessuna rete di
   * quella famiglia, nessun giudizio su quella famiglia» qui sotto.
   *
   * ⚠️ La nativa di SITO non si accusa: è il pavimento, il posto dove finisce
   * tutto ciò che nessuno ha assegnato altrove (802.1Q). Chiedere di dichiarare
   * il pavimento sarebbe una riga su ogni progetto, e una riga che compare sempre
   * non la legge più nessuno.
   *
   * @param {Array<{vlan:number, where?:string[]}>} vlansInUse VLAN viste nel documento
   * @param {Set<number>|number[]} declared il piano
   * @param {number} siteNativeVlan il pavimento (default 1)
   * @returns {Array<{vlan:number, where:string[]}>} ordinate per numero
   */
  function findVlansOutsidePlan(vlansInUse, declared, siteNativeVlan) {
    const plan = (declared instanceof Set) ? declared : new Set((Array.isArray(declared) ? declared : []).map(Number));
    if (!plan.size) return [];
    const nat = Number.isFinite(+siteNativeVlan) ? +siteNativeVlan : 1;
    const out = [];
    for (const u of (Array.isArray(vlansInUse) ? vlansInUse : [])) {
      const v = u && +u.vlan;
      if (!Number.isFinite(v) || v < 1 || v > 4094) continue;
      if (v === nat || plan.has(v)) continue;
      const where = Array.isArray(u.where) ? u.where.filter(Boolean).map(String) : [];
      out.push({ vlan: v, where });
    }
    out.sort((a, b) => a.vlan - b.vlan);
    return out;
  }

  function findAddressesOutsidePlan(nodes, prefixes, parseCidr) {
    const inCidr = cidrLib && cidrLib._ipInCidr;
    const family = cidrLib && cidrLib.addrFamily;
    if (typeof parseCidr !== 'function' || typeof inCidr !== 'function' || typeof family !== 'function') return [];
    const reti = [];
    for (const p of (Array.isArray(prefixes) ? prefixes : [])) {
      const cidr = String(p && p.cidr == null ? '' : p.cidr).trim();
      if (!cidr) continue;
      const info = parseCidr(cidr);
      if (info) reti.push(info);
    }
    const famiglie = new Set(reti.map(r => r.family));
    const out = [];
    for (const n of (Array.isArray(nodes) ? nodes : [])) {
      const visti = new Set();
      for (const raw of [n && n.ip, n && n.ip6]) {
        const ip = String(raw == null ? '' : raw).trim();
        if (!ip || visti.has(ip)) continue;
        visti.add(ip);
        if (_isLinkLocal(ip)) continue;
        const fam = family(ip);
        // Famiglia non riconosciuta = non e' un indirizzo, e un campo scritto male
        // non e' «fuori dal piano»: e' un'altra faccenda, e non la si accusa qui.
        if (!fam || !famiglie.has(fam)) continue;
        let dentro = false;
        for (const r of reti) { if (r.family === fam && inCidr(ip, r)) { dentro = true; break; } }
        if (!dentro) out.push({ ip, family: fam, node: { id: n.id, name: n.name || n.id || '' } });
      }
    }
    out.sort((x, y) => {
      const kx = _ipSortKey(x.ip), ky = _ipSortKey(y.ip);
      if (Number.isNaN(kx) || Number.isNaN(ky)) {
        if (Number.isNaN(kx) !== Number.isNaN(ky)) return Number.isNaN(kx) ? 1 : -1;
        return String(x.ip).localeCompare(String(y.ip));
      }
      return kx - ky;
    });
    return out;
  }

  // Le sovrapposizioni da SEGNALARE: due reti che si pestano i piedi davvero.
  function findSubnetOverlaps(prefixes, parseCidr) {
    return _classifyOverlaps(prefixes, parseCidr).conflicts;
  }

  // Le sovrapposizioni ATTESE: ci sono, non sono un errore, e si dicono lo stesso.
  function findExpectedOverlaps(prefixes, parseCidr) {
    return _classifyOverlaps(prefixes, parseCidr).expected;
  }

  function buildIpamAudit(model) {
    model = model || {};
    // Una classificazione sola per entrambe le liste: due chiamate rifarebbero lo
    // stesso doppio ciclo, e soprattutto potrebbero un giorno rispondere diverso.
    const ov = _classifyOverlaps(model.prefixes, model.parseCidr);
    // ⭐ Ogni controllo che NON ha potuto girare lascia qui il suo nome. Una lista
    // vuota vuol dire «ho guardato»; senza questo registro voleva dire anche «non
    // ho guardato», e le due cose finivano nella stessa frase: «nessun problema».
    const notChecked = [];
    const hasParser = typeof model.parseCidr === 'function';
    const prefissi = (Array.isArray(model.prefixes) ? model.prefixes : [])
      .filter(p => p && String(p.cidr == null ? '' : p.cidr).trim());
    if (!hasParser) {
      notChecked.push({ check: 'subnetOverlaps', reason: 'no-parser' });
      notChecked.push({ check: 'addressesOutsidePlan', reason: 'no-parser' });
    } else if (!prefissi.length) {
      // Non e' un guasto: e' che non c'e' un piano con cui confrontare. Detto lo
      // stesso, o «nessun indirizzo fuori dal piano» suonerebbe come una conferma.
      notChecked.push({ check: 'addressesOutsidePlan', reason: 'no-plan' });
    }
    // L'identita' di un IPv6 dipende dalla forma canonica: senza `addrKey` il
    // confronto cade sulla stringa grezza e due scritture dello stesso indirizzo
    // smettono di essere un duplicato. Il controllo gira lo stesso, ma degradato,
    // e chi legge deve saperlo.
    if (!cidrLib || typeof cidrLib.addrKey !== 'function') notChecked.push({ check: 'duplicateIps', reason: 'no-canon' });
    // Le VLAN: stesso metro delle reti. Un piano che non dichiara nemmeno una VLAN
    // non è un piano contro cui misurare — e dirlo è l'unico modo per non far
    // passare «nessuna VLAN fuori dal piano» per una promozione.
    const piano = declaredVlans(model.prefixes, model.vlanNames);
    if (!piano.size) notChecked.push({ check: 'vlansOutsidePlan', reason: 'no-vlan-plan' });
    // La VRF di ogni indirizzo, letta dall'IPAM dichiarato (se il progetto ne ha uno): senza `addresses` i nodi
    // restano come sono e vale la regola di sempre.
    const nodi = Array.isArray(model.addresses) ? attachVrfs(model.nodes, model.addresses) : model.nodes;
    return {
      duplicateIps: findDuplicateIps(nodi),
      duplicateIpsSharedByHa: findSharedHaIps(nodi),
      duplicateIpsAcrossVrf: findDuplicateIpsAcrossVrf(nodi),
      subnetOverlaps: ov.conflicts,
      subnetOverlapsExpected: ov.expected,
      addressesOutsidePlan: findAddressesOutsidePlan(model.nodes, model.prefixes, model.parseCidr),
      vlansOutsidePlan: findVlansOutsidePlan(model.vlansInUse, piano, model.siteNativeVlan),
      notChecked,
    };
  }

  return { buildIpamAudit, attachVrfs, findDuplicateIps, findSharedHaIps, findDuplicateIpsAcrossVrf, findSubnetOverlaps, findExpectedOverlaps, findAddressesOutsidePlan, compareCidr, isContainerPrefix, containerDeclarationFor, declaredVlans, findVlansOutsidePlan, collectVlansInUse };
});
