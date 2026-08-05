'use strict';
// ============================================================
//  lib/overview.js — i fatti della «Panoramica» (PURO, "InfraNet calcola").
//
//  Compone in TRE sezioni cio' che i motori gia' calcolano, nell'ordine in cui
//  ci si fanno le domande davanti a una rete documentata:
//    ① COMPLETO — il documento descrive tutto quello che c'e'?
//    ② VERO     — quello che c'e' scritto corrisponde ancora alla realta'?
//    ③ MARGINE  — quanto si puo' crescere senza comprare niente?
//  piu' tre LENTI opt-in, a colonna singola, che rispondono a domande diverse:
//    ④ RIPRISTINABILITA' — se cade stanotte, lo rimetti in piedi?
//    ⑤ SICUREZZA        — quanto e' esposta la gestione della rete?
//    ⑥ SALUTE           — che problemi ci sono adesso?
//
//  NON ricalcola nulla che esista gia': riceve gli output di lib/spare-ports.js,
//  lib/project-networks.js e il catalogo TYPES. E' composizione, non un motore
//  nuovo.
//
//  ZERO stringhe di interfaccia: ogni riga esce come CHIAVE + numeri + elenco.
//  Le parole le mette il renderer via i18n ("InfraNet calcola, l'app racconta"),
//  cosi' la stessa lib serve it/en e i test non dipendono dalla lingua.
//
//  PROVENIENZA su ogni riga (paletto ② no-invenzioni reso dato, non grafica):
//    'declared' l'ha scritto l'utente · 'measured' letto dall'apparato ·
//    'derived'  dedotto da altri segnali · 'none' il dato NON c'e'.
//  Una riga 'none' NON vale zero: vale "non lo sappiamo", e il renderer la
//  disegna tratteggiata. Zero e' un'affermazione, tratteggiato e' una domanda.
//
//  UMD-lite: in Node require(), nel browser global (ma oggi la importa solo
//  src/app-overview.js via ESM).
// ============================================================
(function (root, factory) {
  // Dipende da lib/proof.js (stato di prova del cavo): in Node lo si require, nel
  // browser è già su window (root) via <script> — stesso pattern di drift-snapshot.
  const api = factory(typeof module !== 'undefined' && module.exports ? require('./proof.js') : root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // Node (test)
  if (typeof window !== 'undefined') Object.assign(window, api);               // browser
})(typeof self !== 'undefined' ? self : this, function (proof) {
  'use strict';

  const _str = (v) => (v == null ? '' : String(v)).trim();
  const _arr = (v) => (Array.isArray(v) ? v : []);
  const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const _num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  // Da un id composito (`<nodeId>-<indice>` di una porta, o un token che finisce
  // con l'indice) ricava l'id NODO: il prefisso piu' lungo che e' un nodo vero.
  // Gli id nodo possono contenere trattini (`n-5`), quindi non basta tagliare
  // all'ultimo '-'. Ritorna null se nessun prefisso e' un nodo noto — cosi' il
  // renderer mostra testo grezzo invece di un finto link.
  function _nodeIdOf(token, nodeIds) {
    const s = _str(token);
    if (!s || !(nodeIds && nodeIds.has)) return null;
    if (nodeIds.has(s)) return s;
    let i = s.lastIndexOf('-');
    while (i > 0) {
      const cand = s.slice(0, i);
      if (nodeIds.has(cand)) return cand;
      i = s.lastIndexOf('-', i - 1);
    }
    return null;
  }

  // Chiave MAC robusta al formato: tiene solo gli esadecimali, cosi'
  // 'd4:1a:..' / 'd4-1a-..' / 'd41a..' danno la stessa chiave a 12 cifre.
  // '' se non e' un MAC (evita falsi match su sysName corti). La mappa
  // MAC→nodo la costruisce il chiamante con la STESSA normalizzazione.
  function _macKey(v) {
    const h = _str(v).toLowerCase().replace(/[^0-9a-f]/g, '');
    return h.length === 12 ? h : '';
  }

  // Host UTILIZZABILI di un CIDR: 2^(32-prefix) meno rete e broadcast
  // (/31 = 2 punto-punto RFC 3021, /32 = 1). Prefisso assente → /24, la stessa
  // assunzione con cui deriveProjectNetworks raggruppa gli indirizzi osservati:
  // per questo il conteggio dei liberi e' DEDOTTO, non dichiarato.
  function _usableHosts(cidr) {
    const m = /\/(\d{1,2})\s*$/.exec(_str(cidr));
    let p = m ? Number(m[1]) : 24;
    if (!Number.isFinite(p) || p < 0 || p > 32) p = 24;
    if (p >= 31) return p === 31 ? 2 : 1;
    return Math.pow(2, 32 - p) - 2;
  }

  // Helper CIDR IPv4 MINIMI, in-lib (overview.js e' ESM-bundlato, lib/cidr.js e'
  // uno <script>-globale: mescolarli e' fragile → si tengono qui, puri e testati,
  // come gli altri helper-per-file del progetto (_net24, _subnet24). Bastano per il
  // paletto ① "sempre sul dichiarato": misurare la capacita' sulla subnet DICHIARATA.
  function _ipToInt(ip) {
    const p = _str(ip).split('.');
    if (p.length !== 4) return null;
    let v = 0;
    for (let i = 0; i < 4; i++) { const n = Number(p[i]); if (!Number.isInteger(n) || n < 0 || n > 255) return null; v = (v * 256) + n; }
    return v >>> 0;
  }
  function _intToIp(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.'); }
  // "10.20.0.0/16" (o forma host "10.20.5.1/16") → { network, mask, prefix, cidr canonico } o null.
  function _cidrInfo(cidr) {
    const m = /^(\d{1,3}(?:\.\d{1,3}){3})\s*\/\s*(\d{1,2})$/.exec(_str(cidr));
    if (!m) return null;
    const base = _ipToInt(m[1]); const prefix = Number(m[2]);
    if (base == null || prefix < 0 || prefix > 32) return null;
    const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
    const network = (base & mask) >>> 0;
    return { network, mask, prefix, cidr: _intToIp(network) + '/' + prefix };
  }
  // Subnet DICHIARATE (IPAM VLAN), dedup per rete, PIU' SPECIFICA prima (prefix desc):
  // cosi', con subnet annidate, il primo match e' la piu' precisa.
  function _declaredSubnets(ipamVlans) {
    const out = [], seen = new Set(); const v = _obj(ipamVlans);
    for (const k of Object.keys(v)) {
      const info = _cidrInfo(_str(_obj(v[k]).subnet));
      if (!info) continue;
      const key = info.network + '/' + info.prefix;
      if (seen.has(key)) continue;
      seen.add(key); out.push(info);
    }
    out.sort((a, b) => b.prefix - a.prefix);
    return out;
  }

  // ① "il dichiarato è legge": raggruppa gli IP osservati per SUBNET DICHIARATA (col
  // suo prefisso reale, es. /16 o /28), e ciò che sta FUORI da ogni dichiarazione in
  // /24 «non dichiarate» — MAI perso, MAI assunto in silenzio. Ritorna, dichiarate
  // prima: [{ cidr, prov:'declared'|'undeclared', usable, used }]. Split PER-IP (una
  // /28 dichiarata dentro una /24 osservata prende i suoi host, il resto resta /24
  // non-dichiarata): così i device fuori dalla dichiarazione EMERGONO. Per non contare
  // due volte lo spazio, dalla /24 residua si sottraggono gli host dei sub-range (/25+)
  // dichiarati che vi ricadono. → [[declare-first-workflow]].
  function _subnetGroups(m) {
    const nets = _arr(m.networks);
    const declared = _declaredSubnets(m.ipamVlans);
    const declUsed = new Map();   // cidr dichiarato → Set(ip)
    const residual = new Map();   // /24 net → { cidr, net, ips:Set }
    const noIp = [];              // /24 senza lista ips (solo deviceCount)
    for (const x of nets) {
      const net = _obj(x);
      const ips = _arr(net.ips);
      const cidr24 = _str(net.cidr) || (net.net ? net.net + '.0/24' : '');
      if (!ips.length) { noIp.push({ cidr: cidr24, net: _str(net.net), used: _num(net.deviceCount) }); continue; }
      for (const ip of ips) {
        const iv = _ipToInt(ip);
        if (iv == null) continue;
        const d = declared.find((s) => ((iv & s.mask) >>> 0) === s.network);
        if (d) { if (!declUsed.has(d.cidr)) declUsed.set(d.cidr, new Set()); declUsed.get(d.cidr).add(ip); }
        else {
          const key = _str(net.net) || cidr24;
          if (!residual.has(key)) residual.set(key, { cidr: cidr24, net: _str(net.net), ips: new Set() });
          residual.get(key).ips.add(ip);
        }
      }
    }
    const _net24mask = 0xffffff00 >>> 0;
    const _subUsableInNet24 = (net24) => {
      const base = _ipToInt(_str(net24) + '.0'); if (base == null) return 0;
      let sum = 0;
      for (const d of declared) if (d.prefix > 24 && ((d.network & _net24mask) >>> 0) === ((base & _net24mask) >>> 0)) sum += _usableHosts(d.cidr);
      return sum;
    };
    const out = [];
    for (const d of declared) {
      const used = (declUsed.get(d.cidr) || new Set()).size;
      if (!used) continue;                          // solo dichiarate CON IP del progetto
      out.push({ cidr: d.cidr, prov: 'declared', usable: _usableHosts(d.cidr), used });
    }
    const _resid = (net24, cidr24, used) => ({ cidr: cidr24, prov: 'undeclared', usable: Math.max(0, _usableHosts(cidr24) - _subUsableInNet24(net24)), used });
    for (const r of residual.values()) out.push(_resid(r.net, r.cidr, r.ips.size));
    for (const n of noIp) out.push(_resid(n.net, n.cidr, n.used));
    return out;
  }

  // Indirizzabile = puo' avere un IP. Sugli ATTIVI (switch/router/hypervisor…)
  // il flag `hasIP` non c'e': l'indirizzo e' implicito in `isActive`. Stesso
  // predicato di lib/subbar-stats.js — contare il solo hasIP lascerebbe fuori
  // tutta l'infrastruttura.
  function _isAddressable(def) { const d = _obj(def); return !!(d.isActive || d.hasIP); }

  // Apparato con un accesso SNMP CONFIGURATO (driver snmp* + un host a cui
  // rivolgersi): la stessa condizione con cui la Verifica decide chi interrogare
  // (src/app-drift.js) e con cui la sotto-header conta la salute
  // (lib/subbar-stats.js). Una definizione sola, letta da «Vero» e da «Salute live».
  function _hasSnmp(n) {
    const integ = _obj(n && n.integration);
    return _str(integ.driver).indexOf('snmp') === 0 && !!_str(integ.host || (n && n.ip));
  }

  // Il nome "vero" e' quello che NON coincide con l'indirizzo: lo Scopri, quando
  // non trova un hostname, scrive l'IP dentro node.name (vedi lib/node-label.js).
  // Un nome che ripete l'indirizzo non e' documentazione, e' un segnaposto.
  function _hasRealName(n) {
    const ip = _str(n && n.ip);
    const ip6 = _str(n && n.ip6);
    const nm = _str(n && n.name);
    if (nm && nm !== ip && nm !== ip6) return true;
    // Un hostname PINNATO A MANO (hostnameManual) e' un atto deliberato di
    // denominazione: vale come nome proprio anche se node.name mostra ancora
    // l'IP (il campo Hostname aggiorna hostname+hostnameManual, non name —
    // app-properties.js). Solo il MANUALE: il node.hostname grezzo (auto da
    // sysName/discovery) puo' essere un blob, e se e' leggibile e' gia' finito
    // in node.name via _discDisplayName. Non-vuoto e diverso dall'indirizzo.
    const hn = _str(n && n.hostname);
    if (n && n.hostnameManual && hn && hn !== ip && hn !== ip6) return true;
    return false;
  }

  // L'identita' L2 di un apparato non vive solo in `node.mac`. Su un device
  // gestito via SNMP il MAC arriva PER INTERFACCIA (ifPhysAddress finisce sulle
  // porte, e sui LAG) e `node.mac` — che lo Scopri riempie via ARP — resta vuoto:
  // uno switch con 8 porte ha 8 MAC documentati e zero "MAC del device".
  // Contare il solo `node.mac` dichiarava mancante un dato che c'e' (rilevato
  // dall'utente sul suo progetto, 2026-07-23). `portMacNodeIds` = id dei nodi
  // con almeno un MAC su una porta/LAG, calcolato dal chiamante.
  function _macState(n, portMacIds) {
    if (_str(n && n.mac)) return 'node';
    if (portMacIds && portMacIds.has && portMacIds.has(n && n.id)) return 'ports';
    return 'none';
  }

  // Il default di `prov` e' 'none', non 'declared': una riga che si DIMENTICA di
  // dichiarare la provenienza non deve affermare che il numero l'ha scritto un
  // umano. Era fail-OPEN sul paletto centrale del prodotto — la riga nuova
  // sbagliata di default nella direzione che promette di piu'. Ora tace, e chi
  // aggiunge una riga e' costretto a dire da dove viene il suo numero.
  function _row(key, o) {
    const r = Object.assign({ key, value: null, total: null, prov: 'none', tone: 'normal', items: [] }, o || {});
    // pct calcolata qui una volta sola: il renderer non fa aritmetica.
    r.pct = (r.total != null && r.total > 0 && typeof r.value === 'number')
      ? Math.round((r.value / r.total) * 100) : null;
    return r;
  }

  // Il titolo grande di una sezione: la PRIMA voce presente della lista di
  // priorita', cioe' la cosa su cui si agisce — non il totale piu' grande.
  // Deterministico di proposito: due progetti uguali danno lo stesso titolo.
  function _headline(rows, order) {
    const byKey = new Map(rows.map((r) => [r.key, r]));
    for (const [key, pick] of order) {
      const r = byKey.get(key);
      if (r && pick(r)) return { key, value: r.value, total: r.total, gap: r.total != null ? r.total - r.value : null };
    }
    return null;
  }

  // Salute della sezione (dato per lo «strato colpo d'occhio»): un livello
  // ok/warn/bad + un conteggio. Le PAROLE le mette il glue (i18n); qui solo la
  // classificazione, coerente coi toni dei singoli riquadri.
  //   COMPLETO → giallo se una dimensione (indirizzo/nome/mac/subnet/VLAN) ha un
  //     buco; mai rosso: l'incompletezza e' un'attivita', non un guasto.
  //   VERO → rosso se non c'e' MAI stata una lettura (si vola alla cieca); giallo
  //     se letto ma con discrepanze (porte sospette) o device non verificabili;
  //     verde se letto e coerente. La riga «Verifica completa» e' un segnaposto
  //     di Fase 2 (sempre 'none'): NON deve tingere di rosso ogni progetto.
  //   MARGINE → giallo se una risorsa chiave e' esaurita (0 porte libere, rack
  //     pieno); i dati assenti (PoE/SFP non dichiarati) non abbassano il livello.
  function _sectionHealth(key, rows) {
    const by = new Map(_arr(rows).map((r) => [r && r.key, r]));
    const gapOf = (r) => (r && r.total != null && typeof r.value === 'number') ? r.total - r.value : 0;
    const hasGap = (r) => !!r && (r.prov === 'none' || (r.total != null && typeof r.value === 'number' && r.value < r.total));
    if (key === 'complete') {
      // subnets è una lacuna anche quando ci sono segmenti IN USO ma NON dichiarati
      // (② "il dichiarato è legge": usare una subnet non dichiarata è incompletezza).
      const subGap = (r) => hasGap(r) || _num(_obj(r && r.extra).undeclared) > 0;
      // Gateway: conta come lacuna SOLO se ci sono subnet dichiarate ma qualcuna è
      // senza gateway (prov 'none' = niente subnet = già coperto dalla riga subnets).
      const gwGap = (r) => !!r && _num(r.total) > 0 && typeof r.value === 'number' && r.value < r.total;
      // Un nome VLAN in conflitto (dichiarato ≠ rete) è un'incoerenza da sanare, come una lacuna.
      const vlanConflict = (r) => _num(_obj(r && r.extra).conflict) > 0;
      // `mac` non e' piu' una riga a se': vive dentro `addr`, quindi la sua lacuna
      // si legge da li' (`extra.macNone`) e continua a pesare sul verdetto come prima.
      const macGap = (r) => _num(_obj(r && r.extra).macNone) > 0;
      const issues = ['addr', 'name', 'vlanNames'].filter((k) => hasGap(by.get(k))).length
        + (macGap(by.get('addr')) ? 1 : 0)
        + (subGap(by.get('subnets')) ? 1 : 0)
        + (gwGap(by.get('gateways')) ? 1 : 0)
        + (vlanConflict(by.get('vlanNames')) ? 1 : 0);
      return { level: issues ? 'warn' : 'ok', issues };
    }
    if (key === 'truth') {
      const lastSync = by.get('lastSync');
      const suspect = _num(by.get('suspectPorts') && by.get('suspectPorts').value);
      // Verifica persistita (Fase 2): se è girata e restano differenze da decidere,
      // la sezione è "warn" (+ il loro conteggio fra gli issues, così il delta
      // «dall'ultima lettura» migliora risolvendole). Se non è MAI girata (prov
      // 'none') NON pesa: la lacuna è già dichiarata dalla riga stessa.
      const verify = by.get('verify');
      const drift = (verify && verify.prov !== 'none') ? _num(verify.value) : 0;
      // Conflitti IPAM (IP duplicati + overlap subnet): un errore doc↔doc, pesa sul
      // verdetto come le discrepanze. Non tinge di rosso (rosso = «mai letto»).
      const conflicts = _num(by.get('conflicts') && by.get('conflicts').value);
      if (!lastSync || lastSync.prov === 'none') return { level: 'bad', issues: 0 };
      // Gli apparati che NON rispondono pesano sul conteggio: configurati e muti
      // sono una misura FALLITA, e su una misura fallita non si dipinge verde.
      // Entrano anche nel numero — non solo nella condizione — cosi' il delta
      // «dall'ultima lettura» migliora quando li si rimette in piedi. Chi non ha
      // un accesso configurato invece no: e' gia' una decisione, e va nella lista
      // «a mano» accanto al verdetto, non fra i problemi.
      const snmpErrors = _num(_obj(by.get('verifiable') && by.get('verifiable').extra).errors);
      if (suspect > 0 || snmpErrors > 0 || drift > 0 || conflicts > 0) {
        return { level: 'warn', issues: suspect + drift + conflicts + snmpErrors };
      }
      return { level: 'ok', issues: 0 };
    }
    const freePorts = by.get('freePorts');
    const rackU = by.get('rackU');
    const portsOut = !!freePorts && typeof freePorts.value === 'number' && freePorts.value === 0 && _num(freePorts.total) > 0;
    // «Rack pieno» solo su un'altezza DICHIARATA: gridare al pieno su un totale
    // assunto (42U di ripiego) sarebbe un allarme inventato — il rack potrebbe
    // essere un 47U con spazio di avanzo.
    const rackFull = !!rackU && rackU.prov === 'declared' && _num(rackU.value) === 0 && _num(rackU.total) > 0;
    // Debito PoE: non e' «margine zero», e' margine SOTTO zero — il budget
    // dichiarato non copre le classi misurate. Pesa quanto un rack pieno: si
    // conta un problema per apparato in debito, non un problema soltanto.
    const poeDebt = _num(_obj(by.get('poe') && by.get('poe').extra).over);
    const tight = (portsOut ? 1 : 0) + (rackFull ? 1 : 0) + poeDebt;
    return { level: tight ? 'warn' : 'ok', issues: tight };
  }

  // ── ① COMPLETO ─────────────────────────────────────────────────────────────
  function _complete(m) {
    const types = _obj(m.types);
    const nodes = _arr(m.nodes);
    const addressable = [];
    for (const n of nodes) {
      const def = _obj(types[n && n.type]);
      if (def.isStructural) continue;
      if (_isAddressable(def)) addressable.push(n);
    }
    const item = (n) => ({ id: n.id, type: n.type, addr: _str(n.ip) || _str(n.ip6) });

    const portMacIds = (m.portMacNodeIds instanceof Set) ? m.portMacNodeIds : new Set(_arr(m.portMacNodeIds));
    const noAddr = addressable.filter((n) => !_str(n.ip) && !_str(n.ip6));
    const noName = addressable.filter((n) => !_hasRealName(n));
    const macState = addressable.map((n) => _macState(n, portMacIds));
    const noMac = addressable.filter((n, i) => macState[i] === 'none');
    const macFromPorts = macState.filter((s) => s === 'ports').length;

    // L'abbinamento ARP del progetto: ogni apparato indirizzabile con il suo IP e,
    // sotto, il suo MAC. Ordine: prima chi non ha IP, poi chi non ha MAC, poi tutti
    // gli altri — le lacune restano in cima, che e' il motivo per cui il dettaglio
    // esiste, e sotto c'e' comunque l'elenco completo da consultare.
    // `mac` = stringa vuota SOLO quando davvero non c'e': il renderer scrive «—».
    // ⚠️ Su un apparato SNMP il MAC sta sulle INTERFACCE, non su `node.mac`: usare
    // solo quel campo faceva uscire un trattino su device che il conteggio della
    // riga da' per documentati — la riga si contraddiceva da sola, che e' l'errore
    // che questa Panoramica esiste per non fare. `portMacById` porta il primo MAC
    // visto sulle porte, e `macFromPorts` dice da dove viene.
    const portMacById = _obj(m.portMacById);
    const _macOf = (n, i) => (macState[i] === 'ports' ? _str(portMacById[_str(n.id)])
                            : macState[i] === 'node' ? _str(n.mac) : '');
    const arpItems = addressable
      .map((n, i) => ({ n, i, rank: !_str(n.ip) && !_str(n.ip6) ? 0 : (macState[i] === 'none' ? 1 : 2) }))
      .sort((a, b) => a.rank - b.rank || String(a.n.id).localeCompare(String(b.n.id)))
      .map(({ n, i }) => ({
        id: n.id, type: n.type, addr: _str(n.ip) || _str(n.ip6),
        mac: _macOf(n, i), macFromPorts: macState[i] === 'ports',
      }));

    // ② "il dichiarato è legge": le subnet del progetto raggruppate sul prefisso
    // DICHIARATO (le altre «non dichiarate»), stessa logica di «Indirizzi liberi».
    const subGroups = _subnetGroups(m);
    const undeclaredNets = subGroups.filter((g) => g.prov !== 'declared').length;
    // Subnet dichiarate (VLAN con un CIDR) e, fra queste, quelle SENZA gateway: un
    // gateway mancante è un buco di ripristino (non sai come instradare la subnet).
    // Il dato è nel pannello VLAN (ipamVlans[vid].gateway) ma non arrivava in Panoramica.
    const ipamV = _obj(m.ipamVlans);
    const declSubKeys = Object.keys(ipamV).filter((k) => _str(_obj(ipamV[k]).subnet));
    const declaredSubnets = declSubKeys.length;
    const gwMissing = declSubKeys.filter((k) => !_str(_obj(ipamV[k]).gateway));
    // Ordine del drill-down gateway: prima le SENZA (azione), poi le complete.
    const gwOrdered = gwMissing.concat(declSubKeys.filter((k) => _str(_obj(ipamV[k]).gateway)));
    // Nomi VLAN: il DICHIARATO è legge (manual-first). SNMP legge i nomi reali e la
    // Panoramica li confronta: colma le lacune (VLAN in uso senza nome, ma la rete ne
    // ha uno) e segnala i CONFLITTI (dichiarato ≠ misurato, o switch che discordano).
    // SNMP non riscrive mai il dichiarato — come il serial misurato vs quello scritto.
    const vlansInUse = _arr(m.vlanIdsInUse);
    const vlanNames = _obj(m.vlanNames);
    const measuredVN = _obj(m.measuredVlanNames);
    let vlansNamed = 0, vlanFromSnmp = 0, vlanConflict = 0;
    const vlanFillItems = [], vlanConflictItems = [];
    for (const v of vlansInUse) {
      const decl = _str(vlanNames[String(v)]).trim();
      const meas = _obj(measuredVN[String(v)]);
      const measName = _str(meas.name).trim();
      if (decl) vlansNamed++;
      // Conflitto: (a) il dichiarato diverge dal misurato, o (b) gli switch discordano
      // tra loro (meas.conflict) — anche su una VLAN non dichiarata: la rete stessa non
      // concorda, quindi non c'è un nome da «colmare» senza una decisione umana.
      if (measName && ((decl && decl !== measName) || meas.conflict)) {
        vlanConflict++;
        vlanConflictItems.push({ id: 'VLAN ' + v, meta: (decl ? decl + ' ↔ ' : '') + measName });
      } else if (!decl && measName) {
        // lacuna colmabile: nessun nome dichiarato ma la rete ne conosce uno (concorde).
        vlanFromSnmp++;
        vlanFillItems.push({ id: 'VLAN ' + v, meta: measName, tag: 'measured' });
      }
    }

    const nodeIds = new Set(nodes.map((n) => _str(n && n.id)).filter(Boolean));
    const links = _arr(m.links);
    const derivedLinks = links.filter((l) => l && l.autoLinked);

    // NUMERO-D'IDENTITÀ del cablaggio (spec Proof-State §4.4/§5.3): ogni cavo eredita
    // lo stato di prova dei suoi estremi → un breakdown ONESTO che dice quanti sono
    // dichiarati, dedotti (freschi) o FANTASMA (inferenza che ha perso l'evidenza).
    // Solo DOPO una Verifica (≥1 nodo con proof): senza dati di prova nessun numero
    // (non spacciamo per fantasma un cavo verso un estremo mai verificato). proof.* =
    // lib/proof.js, iniettata nella factory (bare-global nel browser).
    let cableProofCounts = null, cableTruth = null, cableStateById = null;
    if (proof && typeof proof.cableProof === 'function' && nodes.some((n) => n && n.proof)) {
      const proofByNode = {};
      for (const n of nodes) if (n && n.id != null) proofByNode[_str(n.id)] = n.proof;
      cableProofCounts = { declared: 0, derivedStrong: 0, derivedWeak: 0, ghost: 0, review: 0 };
      cableStateById = {};   // id cavo → stato di prova, per il badge nella lista
      const els = links.map((l) => {
        const sp = proofByNode[_nodeIdOf(l.src, nodeIds)];
        const dp = proofByNode[_nodeIdOf(l.dst, nodeIds)];
        const st = proof.cableProof(l, sp, dp);
        if (l && l.id != null) cableStateById[_str(l.id)] = st;
        if (st === 'declared') cableProofCounts.declared++;
        else if (st === 'declared-review') cableProofCounts.review++;
        else if (st === 'derived-strong') cableProofCounts.derivedStrong++;
        else if (st === 'derived-weak') cableProofCounts.derivedWeak++;
        else if (st === 'ghost') cableProofCounts.ghost++;
        return { status: st, effConf: proof.effConf(l, sp, dp) };
      });
      cableTruth = (typeof proof.truthScore === 'function') ? proof.truthScore(els) : null;
    }

    const rows = [
      // `addr` e `name`: 'declared' e' una scelta ESPLICITA, non il vecchio default.
      // Queste due righe misurano la completezza del DOCUMENTO, e il documento e'
      // dell'utente: un indirizzo entrato da un import resta un dato che ha
      // accettato nel suo progetto. Diverso da `cables` e `mac` qui sotto, dove il
      // numero descrive un FATTO che l'app ha dedotto o misurato per conto suo.
      // IP e MAC nella STESSA riga: sono le due meta' di un'unica identita' di rete,
      // e separate obbligavano ad aprire due dettagli e a incrociarli a mente per
      // sapere «chi e' 192.168.1.13». L'elenco e' l'abbinamento ARP del progetto —
      // device, indirizzo, e sotto il MAC. Il numero grande resta quello di prima
      // (quanti hanno un IP): la riga non cambia cosa promette, cambia cosa mostra.
      // Le lacune stanno IN CIMA — chi non ha IP, poi chi non ha MAC — cosi' il
      // dettaglio resta anche la lista di cosa manca, che e' come nasce.
      _row('addr', { value: addressable.length - noAddr.length, total: addressable.length,
        prov: 'declared', items: arpItems,
        // `mac` non e' 'declared' come l'IP: un MAC non si scrive, si osserva
        // (ARP/discovery o ifPhysAddress sulle porte). La riga porta le due
        // provenienze separate invece di fonderle in una sola parola.
        extra: { mac: addressable.length - noMac.length, macNone: noMac.length, fromPorts: macFromPorts } }),
      _row('name', { value: addressable.length - noName.length, total: addressable.length,
        prov: 'declared', items: noName.map(item) }),
      // Un cavo creato dall'auto-link (LLDP/CDP/FDB) NON e' un cavo dichiarato:
      // e' una deduzione che l'utente non ha ancora confermato. Contarli insieme
      // faceva dire «17 documentati» a un progetto dove 15 su 17 erano dedotti
      // (Rete+Lab, 2026-07-23) — nella sezione che chiede se il documento e'
      // completo, e' proprio la distinzione che conta.
      // Le porte impegnate arrivano dallo STESSO report delle porte libere: contarle
      // altrove darebbe un numeratore su una popolazione diversa dal totale a fianco.
      _row('cables', { value: links.length, total: null,
        // E il PALLINO deve dirlo quanto il conteggio: con anche un solo cavo
        // dedotto l'insieme non e' «dichiarato». Un misto non si etichetta con la
        // sua parte migliore — su Rete+Lab erano 15 dedotti su 17, e la riga li
        // rivendicava tutti come scritti a mano.
        prov: links.length ? (derivedLinks.length ? 'derived' : 'declared') : 'none',
        // Post-Verifica AGGIUNGE il numero-d'identità del cablaggio (per stato di
        // prova); senza Verifica la `extra` resta identica a prima (chiavi omesse).
        extra: Object.assign({
          portsUsed: _num(_obj(_obj(m.spare).totals).used),
          auto: derivedLinks.length,
          manual: links.length - derivedLinks.length,
        }, cableProofCounts ? { proofCounts: cableProofCounts, proofScore: cableTruth } : {}),
        // I cavi DEDOTTI (auto-link da LLDP/CDP/FDB) sono i «da verificare»: una
        // buona ipotesi che l'utente non ha ancora confermato. Il click li elenca,
        // i due capi risolti a nome dal renderer (id/peer = nodo di ciascun estremo).
        items: derivedLinks.map((l) => {
          const it = { id: _nodeIdOf(l.src, nodeIds), peer: _nodeIdOf(l.dst, nodeIds) };
          // Numero-d'identità del singolo cavo: lo stato di prova (post-Verifica).
          const st = cableStateById && l && l.id != null ? cableStateById[_str(l.id)] : null;
          if (st) it.proof = st;
          return it;
        }),
      }),
      _row('subnets', {
        value: declaredSubnets, total: null, prov: declaredSubnets ? 'declared' : 'none',
        // observed = quante subnet in uso (dichiarate + non); undeclared = quelle da dichiarare.
        extra: { observed: subGroups.length, undeclared: undeclaredNets },
        // dichiarate PRIMA (dal prefisso reale), le non dichiarate marcate; meta = device.
        items: subGroups.map((g) => ({ id: g.cidr, meta: g.used, tag: g.prov === 'declared' ? 'declaredNet' : 'undeclared' })),
      }),
      // Gateway per subnet dichiarata: senza, la subnet non si sa instradare (buco DR).
      // value = subnet dichiarate CON gateway. Il click elenca TUTTE le dichiarate con
      // il loro gateway (la mappa subnet→gateway, non solo i buchi): prima quelle SENZA
      // — marcate 'noGateway', è l'azione — poi le complete con l'IP del gateway come meta.
      _row('gateways', {
        value: declaredSubnets - gwMissing.length, total: declaredSubnets,
        prov: declaredSubnets ? 'declared' : 'none',
        items: gwOrdered.map((k) => {
          const gw = _str(_obj(ipamV[k]).gateway);
          return Object.assign({ id: _str(_obj(ipamV[k]).subnet), meta: gw || '—' }, gw ? {} : { tag: 'noGateway' });
        }),
      }),
      _row('vlanNames', {
        value: vlansNamed, total: vlansInUse.length,
        // Nessuna VLAN in uso = niente da nominare: 0 su 0 non è «tutto dichiarato»,
        // è una domanda che non si pone. Prima usciva 'declared' su un insieme vuoto.
        prov: !vlansInUse.length ? 'none' : (vlansNamed ? 'declared' : 'none'),
        extra: { fromSnmp: vlanFromSnmp, conflict: vlanConflict },
        // drill-down: prima i conflitti (decisione umana), poi le lacune colmabili da SNMP.
        items: vlanConflictItems.concat(vlanFillItems),
      }),
    ];
    return {
      rows,
      health: _sectionHealth('complete', rows),
      // Prima il buco piu' grave: senza indirizzo non si verifica nulla; senza
      // nome la planimetria e' una colonna di IP; senza MAC il device e' invisibile
      // al confronto con la realta'.
      headline: _headline(rows, [
        ['addr', (r) => r.total > 0 && r.value < r.total],
        ['name', (r) => r.total > 0 && r.value < r.total],
        ['addr', (r) => _num(_obj(r.extra).macNone) > 0],
        ['subnets', (r) => r.prov === 'none'],
        ['addr', () => true],
      ]),
    };
  }

  // Oltre questi GIORNI senza un contatto con la realtà (Sync o Verifica) la
  // colonna «Vero» non può più dirsi verde: il dato potrebbe non corrispondere
  // più. La freschezza a ORE la mostra già il chip in toolbar; qui il VERDETTO
  // degrada solo su staleness di giorni, per non ingiallire un progetto appena letto.
  const STALE_TRUTH_DAYS = 7;

  // L'ULTIMO contatto con la realtà (Sync o Verifica) e la sua età in giorni.
  // Estratto qui perché non serve solo a «Vero»: ③ Margine e ⑤ Sicurezza poggiano
  // anch'esse su una misura, e un verdetto verde su una lettura di settimane fa è
  // lo stesso errore in tre punti diversi.
  //
  // NON si applica a ① LAN né a ④ Ripristinabilità, ed è una scelta:
  //   · ① chiede se il DOCUMENTO descrive tutto — e un documento non invecchia:
  //     ingiallirlo perché non sincronizzi da una settimana sarebbe rumore, non
  //     informazione (e su un progetto disegnato di proposito, mai sincronizzato,
  //     sarebbe ambra per sempre — l'errore appena tolto da «Verificabili»);
  //   · ④ ha già la SUA sveglia, la soglia di 30 giorni sul backup: due orologi
  //     sullo stesso verdetto si leggono come due fatti diversi.
  function _staleness(m) {
    const now = _num(m.now) || 0;
    const freshest = Math.max(_num(m.lastSyncAt) || _num(_obj(m.lastSyncResult).at) || 0,
      _num(_obj(m.lastVerify).at));
    const days = (freshest > 0 && now > 0) ? (now - freshest) / 86400000 : 0;
    return { freshest, days, stale: freshest > 0 && days > STALE_TRUTH_DAYS };
  }

  // Applica il degrado: un VERDE su dati vecchi diventa giallo e lo DICE (il
  // renderer legge `health.stale`/`staleDays`). Warn e bad non si toccano — hanno
  // già un motivo loro, e sovrascriverlo nasconderebbe il problema vero.
  function _applyStale(health, st) {
    if (st.stale && health.level === 'ok') {
      health.level = 'warn'; health.stale = true; health.staleDays = Math.round(st.days);
    }
    return health;
  }

  // ── ② VERO ─────────────────────────────────────────────────────────────────
  function _truth(m) {
    const types = _obj(m.types);
    const nodes = _arr(m.nodes);
    const addressable = nodes.filter((n) => {
      const def = _obj(types[n && n.type]);
      return !def.isStructural && _isAddressable(def);
    });
    // Chi si interroga e chi no lo dice UNA COSA SOLA: il driver nel pannello.
    // Configurato snmp-* = «lo interrogo, deve rispondere». Nessun driver = «non
    // lo interrogo»: e' gia' una dichiarazione, e vale per QUALUNQUE tipo — una
    // stampante parla Printer-MIB quanto uno switch parla IF-MIB, quindi il
    // discrimine non e' il tipo ma la configurazione. Una terza categoria
    // («dichiarato non gestibile») distingueva «non ancora deciso» da «deciso di
    // no»: una differenza che l'app NON puo' conoscere — e affermarla era essa
    // stessa un'invenzione (② no-invenzioni). Tolta.
    //
    // Due stati, e basta:
    //   con driver   entra nel DENOMINATORE. Se l'ultima lettura e' fallita
    //                ('err') non risponde: rosso, col NOME, e niente verde — su
    //                una misura andata male non si dipinge verde.
    //   senza driver esce dal denominatore e finisce nella lista «a mano»: la
    //                nota arancione accanto al verdetto verde. Non blocca nulla,
    //                ma non sparisce — un verde senza quella lista sarebbe
    //                comprato dichiarando di non guardare niente.
    // La lista dei NON VERIFICABILI copre TUTTI quelli che un accesso SNMP potrebbero averlo,
    // non la sola infrastruttura: il confine e' `_isAddressable` (isActive || hasIP)
    // — esattamente quelli a cui il pannello Proprietà offre l'Integrazione. Non e'
    // una soglia inventata qui: e' la stessa domanda che l'app si fa gia' per
    // decidere a chi mostrare quel pannello. Puo' essere una lista lunga: il
    // verdetto ne nomina tre e conta gli altri, l'elenco che si apre li ha tutti.
    const polled = addressable.filter(_hasSnmp);
    const snmpErr = polled.filter((n) => _str(n.snmpStatus) === 'err');
    const notVerifiable = addressable.filter((n) => !_hasSnmp(n));
    const item = (n) => ({ id: n.id, type: n.type, addr: _str(n.ip) || _str(n.ip6) });

    // Porte "sospette": libere sul documento ma che l'apparato vede attive.
    // E' l'unico confronto realta'↔documento disponibile SENZA una Verifica:
    // lo calcola gia' lib/spare-ports.js a ogni lettura SNMP.
    const spare = _obj(m.spare);
    const totals = _obj(spare.totals);
    const suspectByDevice = [];
    for (const rack of _arr(spare.racks)) {
      for (const d of _arr(rack.devices)) if (_num(d.suspect) > 0) suspectByDevice.push({ id: d.id, meta: _num(d.suspect) });
    }
    for (const d of _arr(spare.unracked)) if (_num(d.suspect) > 0) suspectByDevice.push({ id: d.id, meta: _num(d.suspect) });
    suspectByDevice.sort((a, b) => b.meta - a.meta || String(a.id).localeCompare(String(b.id)));

    // Vicini LLDP/CDP dalla cache di topologia, e chi non ha MAI risposto.
    // `items` = le ADIACENZE (device → vicino), cosi' il numero grande e la lista
    // che si apre parlano della stessa cosa. Prima il click mostrava i "mai
    // risposto" mentre il numero contava i vicini: 15 in cima, 1 sotto — la
    // domanda dell'utente «poi ne esce solo 1?» (2026-07-24).
    const nodeIds = new Set(nodes.map((n) => _str(n && n.id)).filter(Boolean));
    // MAC→id nodo (chiave esadecimale): alcuni vicini LLDP/CDP si annunciano solo
    // col chassis-id MAC. Se quel MAC e' di un device del progetto, lo mostriamo
    // a NOME (peer cliccabile) invece che come stringa esadecimale.
    const macToNode = _obj(m.macToNode);
    const cache = _obj(m.topoCache);
    let neighbors = 0, withNeighbors = 0;
    const neverAnswered = [];
    const neighborItems = [];
    for (const n of polled) {
      const c = _obj(cache[n.id]);
      if (!c.ts) { neverAnswered.push({ id: n.id, type: n.type }); continue; }
      const adj = _arr(c.neighbors);
      neighbors += adj.length;
      if (adj.length) withNeighbors++;
      for (const nb of adj) {
        const remote = _str(nb && nb.remoteDevice) || _str(nb && nb.remoteIP);
        const port = _str(nb && nb.remotePort);
        const mk = _macKey(_str(nb && nb.remoteMac) || _str(nb && nb.remoteDevice));
        const peer = mk ? (macToNode[mk] || null) : null;
        if (peer) neighborItems.push({ id: n.id, peer, meta: port });
        else neighborItems.push({ id: n.id, meta: remote ? (port ? remote + ' · ' + port : remote) : port });
      }
    }

    // LAG: la chiave dice da dove arriva (snmp-lag-… misurato · lldp-lag-… dedotto)
    // e codifica i capi (snmp-lag-<nodo>-<idx> · lldp-lag-<a>||<b>).
    const lagGroups = _obj(m.lagGroups);
    const lagKeys = Object.keys(lagGroups);
    const lagMeasured = lagKeys.filter((k) => k.indexOf('snmp-') === 0).length;
    const lagItems = lagKeys.map((k) => {
      const measured = k.indexOf('snmp-') === 0;
      const body = k.replace(/^snmp-lag-/, '').replace(/^lldp-lag-/, '');
      let a, b = null;   // a assegnata in entrambi i rami; b resta null senza '||'
      if (body.indexOf('||') !== -1) { const p = body.split('||'); a = _nodeIdOf(p[0], nodeIds); b = _nodeIdOf(p[1], nodeIds); }
      else { a = _nodeIdOf(body, nodeIds); }
      const nm = lagGroups[k];
      return { id: a, peer: b, meta: _str(typeof nm === 'string' ? nm : (nm && nm.name)), tag: measured ? 'measured' : 'derived' };
    });

    const sync = _obj(m.lastSyncResult);
    const lastAt = _num(m.lastSyncAt) || _num(sync.at) || 0;
    const now = _num(m.now) || 0;

    // ② VERO — la Verifica ora è STATO persistito (Fase 2). L'ultima esecuzione
    // vive in `m.lastVerify` {at, counts, banner, docCount}. "differenze da
    // decidere" = le categorie AZIONABILI, la stessa somma del banner della
    // Verifica (stato · MAC · non-doc · cavi · IP · identità); niente endpoint
    // né solo-firmware, come nel conteggio dell'overlay Drift.
    const lv = _obj(m.lastVerify);
    const lvAt = _num(lv.at);
    const lvc = _obj(lv.counts);
    const lvActionable = _num(lvc.stateDrift) + _num(lvc.macOrphan) + _num(lvc.undocumented)
      + _num(lvc.ghostCable) + _num(lvc.ipChanged) + _num(lvc.identityDrift);

    // B3 — righe-categoria del Drift dal report VIVO (in-sessione): navigabili, il
    // glue rende il drill-down riusando le righe+azioni dell'overlay. Solo le
    // categorie con almeno un elemento; al reload (niente report vivo) non compaiono
    // — resta il conteggio persistito nella riga `verify` (B2). La salute NON le
    // conta a parte: `verify` (= somma azionabile) copre già le stesse differenze.
    const dl = _obj(m.driftLive);
    const dlc = _obj(dl.counts);
    const _driftCats = [
      ['driftState', 'stateDrift'], ['driftIdentity', 'identityDrift'], ['driftIp', 'ipChanged'],
      ['driftUndoc', 'undocumented'], ['driftGhost', 'ghostCable'], ['driftOrphan', 'macOrphan'],
    ];
    const driftRows = m.driftLive
      ? _driftCats.filter(([, cat]) => _num(dlc[cat]) > 0)
          .map(([key, cat]) => _row(key, { value: _num(dlc[cat]), total: null, prov: 'measured', tone: 'alert', drill: cat }))
      : [];
    // B4/B5 — «Reti del progetto» (copertura per /24 + «Scopri rete»): migrata dall'overlay
    // ritirato. Informativa (non una decisione), in coda alle categorie, col report vivo.
    const _nets = _arr(m.networks);
    if (m.driftLive && _nets.length) {
      driftRows.push(_row('driftNetworks', { value: _nets.length, total: null, prov: 'derived', tone: 'normal', drill: '__networks' }));
    }

    // Igiene IPAM (doc↔doc, NON doc↔realtà: quello è il Drift): lo stesso IP su due
    // apparati documentati, o due VLAN con CIDR che si intersecano. Un IPAM reale li
    // pesca; qui diventano una riga della «Vero» perché una pianta con due device
    // sullo stesso indirizzo non è «vera». Il conteggio arriva già calcolato dal glue
    // (lib/ipam-audit.js, che include gli IP delle VM) — la lib lo espone, non lo fa.
    // `ipamAudit` assente/null = motore non disponibile o in errore: NON è «rete
    // pulita». Senza questa distinzione un fallimento di calcolo usciva come
    // verdetto verde «nessun conflitto» (② no-invenzioni).
    const ipamOk = !!m.ipamAudit;
    const ipamAudit = _obj(m.ipamAudit);
    const dupIps = _arr(ipamAudit.duplicateIps);
    const overlaps = _arr(ipamAudit.subnetOverlaps);
    const conflictCount = dupIps.length + overlaps.length;
    const conflictItems = [];
    for (const d of dupIps) {
      const ns = _arr(d.nodes);
      // Caso comune (2 nodi): due capi cliccabili, l'IP nel meta. Con >2 nodi
      // l'IP fa da àncora (testo) e i nomi finiscono nel meta.
      if (ns.length === 2) {
        conflictItems.push({ id: _str(ns[0] && ns[0].id), peer: _str(ns[1] && ns[1].id), meta: _str(d.ip) });
      } else {
        conflictItems.push({ id: _str(d.ip), meta: ns.map((x) => _str(x && x.name) || _str(x && x.id)).join(', ') });
      }
    }
    for (const o of overlaps) {
      conflictItems.push({
        id: _str(o.subnetA) + ' ⇄ ' + _str(o.subnetB),
        meta: 'VLAN ' + _num(o.vidA) + '/' + _num(o.vidB) + (o.identical ? ' ·=' : ''),
      });
    }

    const rows = [
      _row('lastSync', {
        value: lastAt ? _num(sync.ok) : null, total: lastAt ? _num(sync.total) : null,
        prov: lastAt ? 'measured' : 'none', tone: lastAt ? 'normal' : 'muted',
        extra: { at: lastAt || null, ageMs: (lastAt && now) ? Math.max(0, now - lastAt) : null },
      }),
      // «Quanti di quelli che interrogo rispondono»: il numero e' quello, e si
      // legge senza spiegazioni. Senza NESSUN accesso configurato la riga e'
      // tratteggiata ('none'), mai un verde su zero — sarebbe il verde piu' facile
      // da comprare. L'elenco mostra prima chi non risponde (si agisce), poi chi
      // non e' verificabile via SNMP.
      _row('verifiable', {
        value: polled.length ? polled.length - snmpErr.length : null,
        total: polled.length || null,
        prov: polled.length ? 'derived' : 'none',
        tone: snmpErr.length ? 'alert' : 'normal',
        extra: { unverifiable: notVerifiable.length, errors: snmpErr.length },
        items: []
          .concat(snmpErr.map((n) => Object.assign(item(n), { tag: 'snmpErr' })))
          .concat(notVerifiable.map((n) => Object.assign(item(n), { tag: 'unverifiable' }))),
      }),
      // Senza NEMMENO una lettura SNMP non esiste il confronto realtà↔documento:
      // «0 sospette» sarebbe un verde MISURATO su una misura mai fatta. Stesso
      // gating della riga sorella lastSync (assenza ≠ zero).
      _row('suspectPorts', {
        value: lastAt ? _num(totals.suspect) : null, total: lastAt ? _num(totals.free) : null,
        prov: lastAt ? 'measured' : 'none',
        tone: (lastAt && _num(totals.suspect) > 0) ? 'alert' : 'normal', items: suspectByDevice,
      }),
      // Conflitti IPAM: sempre presente (0 = «nessun conflitto», ok; >0 = da
      // risolvere, warn). total=null: non è «N su M», è un conteggio di problemi.
      // prov 'derived': calcolato sui dati DICHIARATI (IP e subnet del progetto).
      _row('conflicts', {
        value: ipamOk ? conflictCount : null, total: null,
        prov: ipamOk ? 'derived' : 'none',
        tone: (ipamOk && conflictCount > 0) ? 'alert' : 'normal',
        extra: { dup: dupIps.length, overlap: overlaps.length },
        items: conflictItems,
      }),
      // B3: le differenze della Verifica, una riga per categoria (solo se >0, report vivo).
      ...driftRows,
      _row('neighbors', {
        value: neighbors, total: null, prov: 'measured',
        extra: { fromDevices: withNeighbors, neverAnswered: neverAnswered.length },
        items: neighborItems,
      }),
      _row('lags', {
        value: lagKeys.length, total: null, prov: lagKeys.length ? 'derived' : 'none',
        extra: { measured: lagMeasured, derived: lagKeys.length - lagMeasured },
        items: lagItems,
      }),
      // Fase 2: la Verifica è STATO — l'ultima esecuzione con le differenze ancora
      // da decidere. 'none' (tratteggiata) finché non è MAI girata: la riga esiste
      // ma dichiara la lacuna, senza tingere di rosso un progetto nuovo.
      lvAt
        ? _row('verify', {
            value: lvActionable, total: null, prov: 'measured',
            tone: lvActionable > 0 ? 'alert' : 'normal',
            extra: {
              at: lvAt, ageMs: (lvAt && now) ? Math.max(0, now - lvAt) : null,
              banner: _str(lv.banner) || null, docCount: _num(lv.docCount),
              counts: Object.assign({}, lvc),
            },
          })
        : _row('verify', { value: null, total: null, prov: 'none', tone: 'muted' }),
    ];
    // Staleness del verdetto: il contatto con la realtà più recente (Sync o
    // Verifica). Se è più vecchio di STALE_TRUTH_DAYS e la sezione sarebbe verde,
    // la si porta a «warn» — un dato di settimane fa non è «corrisponde alla realtà».
    const health = _applyStale(_sectionHealth('truth', rows), _staleness(m));
    return {
      rows,
      health,
      headline: _headline(rows, [
        ['suspectPorts', (r) => r.value > 0],
        ['verifiable', (r) => r.total > 0 && r.value < r.total],
        ['lastSync', () => true],
      ]),
    };
  }

  // ── ③ MARGINE ──────────────────────────────────────────────────────────────
  function _margin(m) {
    const spare = _obj(m.spare);
    const totals = _obj(spare.totals);
    // La testata «Porte libere» conta la capacità SWITCH — la porta dove attacchi
    // davvero un nuovo device. Patch panel e appliance (NVR/KVM/console-server/NAS…)
    // hanno porte libere ma non sono fabric di rete: restano contati, MA a parte
    // (badge «+N non switch»), così il numero grande non promette una capacità che
    // non c'è. Lo split lo fa `byClass` in lib/spare-ports.js. Fallback legacy:
    // senza byClass (chiamanti/test che passano solo `totals`) il totale intero
    // fa da "switch", esattamente com'era. → [[definizioni-duplicate-motore-renderer]]
    const sw = spare.byClass ? _obj(_obj(spare.byClass).switch) : totals;
    const other = _obj(_obj(spare.byClass).other);
    const free = _num(sw.free);
    const suspect = _num(sw.suspect);
    const otherFree = Math.max(0, _num(other.free) - _num(other.suspect));
    const otherPorts = _num(other.ports);
    const sfpTotal = _num(m.sfpTotal);

    // Margine ONESTO: le porte switch libere meno quelle che l'apparato vede attive.
    // Contarle come disponibili sarebbe una promessa che la realta' smentisce.
    const freeHonest = Math.max(0, free - suspect);

    // Per-device: libere / totali, per il dettaglio cliccabile di «Porte libere»,
    // DISTINTI in rack e fuori rack (il report li separa gia': racks[] vs unracked[]).
    // Piu' libere in cima dentro ogni gruppo; prima i device in rack, poi i liberi.
    const _byFree = (a, b) => _num(b.free) - _num(a.free) || String(a && a.id).localeCompare(String(b && b.id));
    const rackDevs = [];
    for (const rack of _arr(spare.racks)) for (const d of _arr(rack.devices)) rackDevs.push(d);
    rackDevs.sort(_byFree);
    const looseDevs = _arr(spare.unracked).slice().sort(_byFree);
    const _spareItem = (group) => (d) => {
      const it = { id: d.id, meta: _num(d.free), of: _num(d.total), group };
      // Marca i non-switch nell'elenco: così, dentro «In rack»/«Fuori rack», patch
      // panel e appliance si distinguono a colpo d'occhio dalla capacità switch.
      if (d.capClass && d.capClass !== 'switch') it.tag = 'nonSwitch';
      return it;
    };

    // Dettaglio a due schede: «In rack» e «Fuori rack» — quest'ultima raccoglie ciò
    // che è libero fuori dagli armadi, in pratica le prese a muro (e altro sul piano).
    // meta = libere, of = totali, per device; i non-switch portano il tag «non switch».
    const freePortItems = [];
    for (const d of rackDevs) freePortItems.push(_spareItem('rack')(d));
    for (const d of looseDevs) freePortItems.push(_spareItem('loose')(d));

    // Dettaglio di «Porte in fibra libere»: solo gli apparati che DICHIARANO fibra
    // (`sfp > 0`). Chi non ne ha non e' «0 libere», e' fuori discorso — la stessa
    // distinzione che la riga fa gia' col suo `prov:'none'`. meta = libere, of =
    // dichiarate; stessi due gruppi rack/fuori-rack di «Porte libere».
    const _byFreeSfp = (a, b) => _num(b.freeSfp) - _num(a.freeSfp) || String(a && a.id).localeCompare(String(b && b.id));
    const _sfpItem = (group) => (d) => ({ id: d.id, meta: _num(d.freeSfp), of: _num(d.sfp), group });
    const sfpItems = rackDevs.filter((d) => _num(d.sfp) > 0).sort(_byFreeSfp).map(_sfpItem('rack'))
      .concat(looseDevs.filter((d) => _num(d.sfp) > 0).sort(_byFreeSfp).map(_sfpItem('loose')));

    const racks = _arr(m.rackFill);
    const rackFree = racks.reduce((a, r) => a + _num(r.free), 0);
    // Il totale U del rack e' `sizeU`. Il glue costruiva rackFill leggendo
    // `r.units || r.u`, campi che sul rack NON esistono → il denominatore cadeva
    // SEMPRE a 42 (progetto 8: 126U dichiarate contro 78U reali, 2026-07-23). Ora
    // la riga porta gia' il campo giusto: vedi _rackFill.
    const rackTot = racks.reduce((a, r) => a + _num(r.sizeU), 0);
    // Quanti rack NON dichiarano la propria altezza: il loro contributo al totale
    // e' il ripiego 42U, cioe' un'ipotesi. Se ce n'e' anche uno solo il totale non
    // e' piu' «dichiarato» → prov 'derived' + la riga lo dice a parole.
    const rackAssumed = racks.filter((r) => !(r && r.declared)).length;
    const rackItems = racks.slice()
      .sort((a, b) => _num(b && b.free) - _num(a && a.free) || String(a && a.id).localeCompare(String(b && b.id)))
      .map((r) => {
        const it = { id: _str(r && r.name) || _str(r && r.id), meta: _num(r && r.free), of: _num(r && r.sizeU) };
        if (!(r && r.declared)) it.tag = 'derived';
        return it;
      });

    const caps = _arr(m.caps);
    const switches = _arr(m.nodes).filter((n) => n && n.type === 'switch').length;
    const withPoe = caps.filter((c) => _obj(_obj(c).caps).poe).length;
    let poeHeadroom = 0, poeDebtW = 0;
    const poeOver = [];
    for (const c of caps) {
      const p = _obj(_obj(_obj(c).caps).poe);
      if (p.headroomW == null) continue;
      const h = _num(p.headroomW);
      poeHeadroom += h;
      // DEBITO PoE: budget DICHIARATO (swPoeBudgetW) inferiore alla richiesta di
      // caso peggiore delle classi MISURATE sulle porte. Non e' un margine
      // "negativo" da sommare via: e' uno switch che, se tutti gli alimentati
      // tirassero la loro classe, resterebbe corto. Sommarlo agli avanzi degli
      // altri lo cancellerebbe dalla vista (il totale di flotta compensa) — per
      // questo il debito esce a parte, per apparato.
      if (h < 0) { poeDebtW += -h; poeOver.push({ id: _obj(c).id, meta: Math.round(-h), metric: 'poeDebt', value: Math.round(-h) }); }
    }
    poeOver.sort((a, b) => b.meta - a.meta || String(a.id).localeCompare(String(b.id)));
    poeDebtW = Math.round(poeDebtW * 10) / 10;
    // ⚠️ Banda «fra gli armadi»: NON sommare i LAG. Un Port-channel fra due switch
    // vive su ENTRAMBI i capi, e sia il totale-flotta (somma) sia il per-device
    // `lagAggregateMbps` (Σ dei LAG del device) lo gonfiano. La risposta onesta e'
    // il SINGOLO collegamento aggregato PIU' CAPIENTE → max su `lags[].aggregateMbps`
    // (max{20G,20G}=20G, mai 40). Un MAX non raddoppia i due capi.
    let uplink = 0;
    const uplinkItems = [];
    for (const c of caps) {
        const p = _obj(_obj(c).caps).ports;
        for (const lag of _arr(p && p.lags)) {
            const mbps = _num(lag && lag.aggregateMbps);
            if (!mbps) continue;
            uplink = Math.max(uplink, mbps);
            uplinkItems.push({ id: _obj(c).id, meta: mbps });
        }
    }
    uplinkItems.sort((a, b) => b.meta - a.meta);

    // Indirizzi LIBERI = host utilizzabili meno gli occupati, ONORANDO il prefisso
    // DICHIARATO (② "il dichiarato è legge"). `_subnetGroups` raggruppa per subnet
    // dichiarata (prefisso reale) e mette le /24 «non dichiarate» a parte, senza
    // perdere gli IP fuori da ogni dichiarazione. → [[declare-first-workflow]].
    const groups = _subnetGroups(m);
    const ipFreeTotal = groups.reduce((a, g) => a + Math.max(0, g.usable - g.used), 0);
    const anyDeclared = groups.some((g) => g.prov === 'declared');

    const rows = [
      // Dedotto, non dichiarato: le libere sono le porte dichiarate meno quelle che
      // l'apparato vede impegnate — un conto che fa l'app, non una cifra scritta.
      _row('freePorts', (() => {
        // extra: il grezzo switch (raw−suspect = onesto) e — SOLO se c'è — il conto
        // «altro» (patch panel/appliance/prese a muro) che il renderer mostra come
        // secondo contatore accanto, mai sommato al numero grande.
        const extra = { raw: free, suspect };
        if (otherPorts > 0) { extra.otherFree = otherFree; extra.otherPorts = otherPorts; }
        return {
          value: freeHonest, total: _num(sw.ports),
          prov: _num(sw.ports) ? 'derived' : 'none',
          extra,
          // Il click mostra, per ogni device, le libere sul totale (es. 19 di 24 →
          // 5 usate), «in rack»/«fuori rack»; i non-switch portano il tag «non switch».
          items: freePortItems,
        };
      })()),
      // sfpTotal === 0 NON significa "zero libere": significa che nessun apparato
      // dichiara porte in fibra. Distinzione voluta — vedi il commento in testa.
      _row('freeSfp', {
        value: sfpTotal ? _num(totals.freeSfp) : null, total: sfpTotal || null,
        prov: sfpTotal ? 'declared' : 'none',
        tone: (sfpTotal && !_num(totals.freeSfp)) ? 'alert' : 'normal',
        items: sfpItems,
      }),
      _row('rackU', {
        value: rackFree, total: rackTot,
        prov: rackTot ? (rackAssumed ? 'derived' : 'declared') : 'none',
        extra: { assumed: rackAssumed, racks: racks.length },
        // Il click elenca i rack: liberi su totale. `tag:'derived'` marca quelli che
        // NON dichiarano la propria altezza — il loro totale e' il ripiego 42U, cioe'
        // un'ipotesi, e chi legge deve poterlo distinguere riga per riga (non solo
        // dalla provenienza aggregata della riga intera).
        items: rackItems,
      }),
      // PoE: il NUMERO e' quanti switch dichiarano un budget (quindi 'declared');
      // il margine e il debito in `extra` sono DEDOTTI — budget dichiarato meno le
      // classi misurate sulle porte — e il verdetto lo dice a parole.
      _row('poe', {
        value: withPoe, total: switches || null, prov: withPoe ? 'declared' : 'none',
        tone: poeDebtW > 0 ? 'alert' : 'normal',
        extra: { headroomW: withPoe ? poeHeadroom : null, debtW: poeDebtW || null, over: poeOver.length },
        items: poeOver,
      }),
      _row('uplink', {
        value: uplink || null, total: null, prov: uplink ? 'derived' : 'none',
        extra: { devices: uplinkItems.length }, items: uplinkItems,
      }),
      _row('ipFree', {
        value: groups.length ? ipFreeTotal : null, total: null,
        prov: groups.length ? (anyDeclared ? 'declared' : 'derived') : 'none',
        extra: { subnets: groups.length, declared: anyDeclared },
        // meta = liberi, of = utilizzabili del prefisso (DICHIARATO se c'e', altrimenti /24
        // assunto); tag = «dichiarato»/«non dichiarata» per riga (il renderer mostra la pastiglia).
        items: groups.map((g) => ({ id: g.cidr, meta: Math.max(0, g.usable - g.used), of: g.usable, tag: g.prov === 'declared' ? 'declaredNet' : 'undeclared' })),
      }),
    ];
    return {
      rows,
      // ③ poggia su una MISURA (le porte «sospette» che l'apparato vede attive, le
      // classi PoE lette dagli switch): dopo settimane senza un contatto, «margine
      // ampio» è un ricordo, non un fatto. Stesso gate di «Vero».
      health: _applyStale(_sectionHealth('margin', rows), _staleness(m)),
      headline: _headline(rows, [
        // Il debito PoE prima di tutto: e' l'unica voce della colonna che descrive
        // una capacita' gia' SFORATA, non una che si sta per esaurire.
        ['poe', (r) => _num(_obj(r.extra).over) > 0],
        ['freeSfp', (r) => r.prov === 'declared' && r.value === 0],
        ['rackU', (r) => r.total > 0 && r.value === 0],
        ['freePorts', () => true],
      ]),
    };
  }

  // ── ④ RIPRISTINABILITÀ (DR-readiness) ───────────────────────────────────────
  // "Se cade stanotte, lo rimetti in piedi?" — lente OPT-IN della Panoramica.
  // NON ricalcola nulla: compone dati che esistono già —
  //   • backup  = puntatore `node.backup {ref, at}` (DOVE vive il config, non il
  //               config) → [[config-backup-ansible]]. Fresco = `at` entro N giorni.
  //   • identità= serial DICHIARATO (`n.serialNumber`) ↔ MISURATO (ENTITY-MIB,
  //               `n.integration.inventory.serialNumber`) → [[identity-drift]].
  //   • posizione = assegnato a un rack (`n.rackId`).
  //   • presenza = confidence temporale «visto N volte» (ADVISORY, da m.presence:
  //               il glue la calcola con lib/temporal-confidence.js — a rischio zero,
  //               non tocca il motore auto-link) → [[temporal-confidence]].
  // Ripristinabile "stanotte" = backup fresco + identità nota (non sostituito) +
  // posizione nota. La presenza è contesto, NON un gate.
  // Soglia ALLINEATA al pannello device (app-properties-node.js: verde ≤30gg): un
  // backup che il pannello mostra verde deve valere «fresco» anche nel verdetto DR.
  const BACKUP_FRESH_DAYS = 30;

  // Ciclo di vita: entro quanti giorni una scadenza smette di essere «lontana».
  // 90 giorni = l'orizzonte in cui un rinnovo o un riacquisto si pianifica ancora
  // con calma; oltre, si scopre la scadenza quando l'apparato e' gia' scoperto.
  const LIFECYCLE_SOON_DAYS = 90;

  function _recovery(m) {
    const types = _obj(m.types);
    const nodes = _arr(m.nodes);
    const now = _num(m.now) || 0;
    const presence = _obj(m.presence);
    const item = (n) => ({ id: n.id, type: n.type, addr: _str(n.ip) || _str(n.ip6) });

    // Popolazione DR = apparati GESTITI (isActive): quelli con un config/serial da
    // rimettere in piedi. Endpoint (PC/telefoni/stampanti), passivi e strutturali fuori.
    const pop = nodes.filter((n) => n && _obj(types[n.type]).isActive);

    const _freshBackup = (at) => {
      const ts = Date.parse(_str(at));
      return Number.isFinite(ts) && now > 0 && (now - ts) <= BACKUP_FRESH_DAYS * 864e5;
    };
    // 'none' nessun puntatore · 'stale' c'è ma vecchio · 'fresh' c'è e recente.
    const _backupState = (n) => {
      if (!_str(_obj(n.backup).ref)) return 'none';
      return _freshBackup(_obj(n.backup).at) ? 'fresh' : 'stale';
    };
    // Identità per il RIPRISTINO: per rimettere in piedi un apparato serve sapere
    // COSA ricomprare (marca/modello — o un seriale, da cui il vendor risale al
    // modello) e QUALE firmware riflashare perché il config torni compatibile.
    //   known    = identificabile: modello (dichiarato/misurato) OPPURE un seriale.
    //   mismatch = seriale dichiarato ≠ misurato (apparato sostituito).
    //   fw       = versione firmware/OS nota (dichiarata/misurata) — advisory, non
    //              blocca il ripristino ma va allineata per un config identico.
    // Il default-catalogo del TIPO non conta: è un'ipotesi, non l'hardware documentato.
    const _identity = (n) => {
      const inv = _obj(_obj(n.integration).inventory);
      const model = _str(n.model) || _str(inv.model);
      const declS = _str(n.serialNumber).trim().toLowerCase();
      const measS = _str(inv.serialNumber).trim().toLowerCase();
      return {
        model, fw: _str(n.firmwareVer) || _str(inv.firmwareVer),
        mismatch: !!(declS && measS && declS !== measS),
        known: !!(model || declS || measS),
      };
    };
    const _locState = (n) => (_str(n.rackId) ? 'known' : 'unknown');
    // Ridondanza HA: il device dichiara un peer 1-1 o un gruppo cluster (n.spec.haPeer /
    // haGroupId, o il legacy n.haGroupId). ADVISORY: un apparato con gemello caldo, se
    // cade, NON è l'emergenza «ricostruiscilo stanotte» — il servizio regge sullo standby.
    const _haProtected = (n) => { const sp = _obj(n.spec); return !!(_str(sp.haPeer) || _str(sp.haGroupId) || _str(n.haGroupId)); };
    // Ciclo di vita: due date DICHIARATE (`n.warrantyUntil`, `n.eolDate`) — nessun
    // apparato dice via SNMP quando scade il contratto o quando il vendor smette di
    // venderlo, quindi qui non esiste un gemello misurato da confrontare.
    // Stato, dal piu' grave: 'eol' non lo ricompri piu' · 'expired' nessuna
    // sostituzione in garanzia · 'soon' una delle due scade entro la soglia.
    // Chi non dichiara NIENTE ritorna null: non e' «a posto», e' fuori dal conto.
    const _lifecycle = (n) => {
      const w = Date.parse(_str(n.warrantyUntil));
      const e = Date.parse(_str(n.eolDate));
      const hasW = Number.isFinite(w), hasE = Number.isFinite(e);
      if (!hasW && !hasE) return null;
      const soonMs = LIFECYCLE_SOON_DAYS * 864e5;
      if (hasE && now > 0 && now > e) return { state: 'eol', at: _str(n.eolDate) };
      if (hasW && now > 0 && now > w) return { state: 'expired', at: _str(n.warrantyUntil) };
      if (now > 0) {
        // La scadenza piu' vicina fra le due: e' quella che detta l'urgenza.
        if (hasW && w - now <= soonMs) return { state: 'soon', at: _str(n.warrantyUntil) };
        if (hasE && e - now <= soonMs) return { state: 'soon', at: _str(n.eolDate) };
      }
      return { state: 'ok', at: '' };
    };

    const noBackup = [], noIdentity = [], noLocation = [], stalePresence = [], haItems = [], lcItems = [];
    let okBackup = 0, okIdentity = 0, okLocation = 0, staleBackup = 0, idMismatch = 0, noFirmware = 0;
    let recoverable = 0, withObs = 0, haProtected = 0;
    let withLc = 0, lcEol = 0, lcExpired = 0, lcSoon = 0;

    for (const n of pop) {
      const b = _backupState(n), idn = _identity(n), lo = _locState(n);
      // Identità OK per il ripristino = identificabile E non «sostituito» (il
      // mismatch è un dubbio da sciogliere, non un'identità su cui contare).
      const idOk = idn.known && !idn.mismatch;
      // tag 'dated' = c'è un backup ma è vecchio (≠ 'stale' della presenza, che è
      // «non visto di recente»): due lacune diverse, due parole diverse.
      if (b === 'fresh') okBackup++;
      else { if (b === 'stale') staleBackup++; noBackup.push(Object.assign(item(n), b === 'stale' ? { tag: 'dated' } : {})); }
      // firmware ignoto conta solo fra gli identificabili: un apparato che non sai
      // nemmeno cosa sia, del firmware è l'ultimo dei problemi.
      if (idOk) { okIdentity++; if (!idn.fw) noFirmware++; }
      else { if (idn.mismatch) idMismatch++; noIdentity.push(Object.assign(item(n), idn.mismatch ? { tag: 'mismatch' } : {})); }
      if (lo === 'known') okLocation++; else noLocation.push(item(n));
      if (_haProtected(n)) { haProtected++; haItems.push(item(n)); }
      if (b === 'fresh' && idOk && lo === 'known') recoverable++;

      // Ciclo di vita (advisory come la presenza): non decide se lo rimetti in
      // piedi STANOTTE — decide se, quando muore, lo puoi ancora sostituire.
      const lc = _lifecycle(n);
      if (lc) {
        withLc++;
        if (lc.state === 'eol') lcEol++;
        else if (lc.state === 'expired') lcExpired++;
        else if (lc.state === 'soon') lcSoon++;
        if (lc.state !== 'ok') lcItems.push(Object.assign(item(n), { tag: lc.state, metric: 'date', value: lc.at }));
      }

      // Presenza temporale (advisory): un apparato non visto da tempo è un dubbio DR
      // («è ancora lì o è già stato dismesso?»). Solo quelli CON storia di discovery.
      const pr = _obj(presence[n.id]);
      if (pr.tier) {
        withObs++;
        if (pr.tier === 'stale') stalePresence.push({ id: n.id, type: n.type, tag: 'stale', meta: pr.ageDays != null ? Math.round(pr.ageDays) + 'gg' : '' });
      }
    }
    const total = pop.length;

    const rows = [
      _row('drBackup', { value: okBackup, total, prov: total ? 'declared' : 'none', extra: { stale: staleBackup }, items: noBackup }),
      _row('drIdentity', { value: okIdentity, total, prov: total ? 'measured' : 'none', extra: { mismatch: idMismatch, noFirmware }, items: noIdentity }),
      _row('drLocation', { value: okLocation, total, prov: total ? 'declared' : 'none', items: noLocation }),
      // Ridondanza HA (advisory): apparati con un gemello caldo dichiarato. 'none' quando
      // nessuno la dichiara → «nessuna ridondanza», utile a chi cerca i single-point-of-failure.
      _row('drRedundancy', { value: haProtected, total, prov: haProtected ? 'declared' : 'none', items: haItems }),
      // Denominatore = apparati CON storia di discovery (withObs), non tutta la
      // popolazione: la presenza vale solo dove è stata misurata (i manuali non contano).
      _row('drPresence', {
        value: withObs ? (withObs - stalePresence.length) : null, total: withObs || null,
        prov: withObs ? 'measured' : 'none', extra: { stale: stalePresence.length, withObs }, items: stalePresence,
      }),
      // Ciclo di vita: denominatore = chi DICHIARA una data (come la presenza usa
      // chi ha una storia). Dire «12 di 12 coperti» contando anche i 20 che non
      // dichiarano niente sarebbe un verde comprato con l'ignoranza; `undeclared`
      // dice quanti restano fuori, e il renderer lo racconta.
      _row('drLifecycle', {
        value: withLc ? (withLc - lcItems.length) : null, total: withLc || null,
        prov: withLc ? 'declared' : 'none',
        tone: (lcEol + lcExpired) > 0 ? 'alert' : 'normal',
        extra: { eol: lcEol, expired: lcExpired, soon: lcSoon, withLc, undeclared: pop.length - withLc },
        items: lcItems,
      }),
    ];

    const issues = total - recoverable;
    const level = (total > 0 && recoverable === 0) ? 'bad' : (issues > 0 ? 'warn' : 'ok');
    return { rows, health: { level, issues }, recoverable, total };
  }

  // ── ⑤ SICUREZZA & SERVIZI ────────────────────────────────────────────────────
  // Quanto è esposta la GESTIONE della rete? Solo segnali MISURATI/DICHIARATI, mai
  // inventati (paletto ②): come parla un apparato SNMP (v3 cifrato vs v1/v2c in
  // chiaro), se usa una community indovinabile (public/private), e se la gestione è
  // segmentata in una VLAN dedicata (state.mgmtVlans). I «servizi in chiaro»
  // (telnet/ftp) NON stanno sui nodi documentati (vivono nello staging di scoperta)
  // → restano fuori da questa sintesi finché non li si documenta sul nodo.
  // Il VALORE grezzo della community NON entra MAI nel modello (anti-leak): una community
  // CUSTOM è un segreto e resta fuori. I default NOTI (public/private/vuota) non sono
  // segreti — sono il nome della vulnerabilità — e SOLO a un admin il drill-down li
  // mostra, come TAG-ENUM (`_COMM_TAG`) che il renderer risolve a testo: così nemmeno il
  // default finisce nel JSON del modello, né nel PDF/API/AI-context che lo serializzano.
  const _DEFAULT_COMMUNITIES = ['public', 'private', ''];
  const _COMM_TAG = { public: 'commPublic', private: 'commPrivate', '': 'commEmpty' };
  function _security(m) {
    const types = _obj(m.types);
    const nodes = _arr(m.nodes);
    const isAdmin = !!m.isAdmin;                     // solo un admin vede QUALE default (mai il viewer)
    const item = (n) => ({ id: n.id, type: n.type, addr: _str(n.ip) || _str(n.ip6) });
    const pop = nodes.filter((n) => n && _obj(types[n.type]).isActive);

    const weakSnmp = [], defaultComm = [];
    let snmpTotal = 0, v3 = 0;
    for (const n of pop) {
      const integ = _obj(n.integration);
      const drv = _str(integ.driver);
      if (drv.indexOf('snmp') !== 0) continue;        // solo chi ha un accesso SNMP
      snmpTotal++;
      if (drv === 'snmp-v3') { v3++; continue; }
      // v1/v2c: la community viaggia in chiaro. La riga elenca questi apparati.
      weakSnmp.push(item(n));
      // Community indovinabile: default noti o vuota. Il device è sempre elencato; il
      // TAG col default (public/private/vuota) lo aggiunge SOLO per un admin. Il valore
      // grezzo di una community custom non arriva mai qui (escluso da questo if).
      const comm = _str(integ.community).trim().toLowerCase();
      if (_DEFAULT_COMMUNITIES.indexOf(comm) !== -1) {
        defaultComm.push(isAdmin ? Object.assign(item(n), { tag: _COMM_TAG[comm] }) : item(n));
      }
    }

    const mgmtVlans = _arr(m.mgmtVlans);
    // Nomi delle VLAN: il DICHIARATO per primo (manual-first), poi il misurato via SNMP.
    const vlanNames = _obj(m.vlanNames);
    const measuredVlanNames = _obj(m.measuredVlanNames);
    // Coerenza VLAN wireless: dato grezzo dal glue (stesso motore del vecchio report
    // lib/wifi-vlan-check.js → nessuna divergenza). wifiApCount = AP con SSID (se 0,
    // niente wireless da valutare → 'none').
    const wifiIssues = _arr(m.wifiVlanIssues);
    const wifiApCount = _num(m.wifiApCount);
    const rows = [
      // Accesso SNMP cifrato: v3 (auth+priv) sui MISURATI; il gap sono i v1/v2c.
      _row('secSnmp', { value: v3, total: snmpTotal, prov: snmpTotal ? 'measured' : 'none', items: weakSnmp }),
      // Community di default: conteggio di problemi (come i conflitti IPAM). 'none'
      // quando non c'è nessun v1/v2c da valutare (niente community da indovinare).
      _row('secCommunity', {
        value: defaultComm.length, total: null,
        prov: weakSnmp.length ? 'measured' : 'none',
        tone: defaultComm.length > 0 ? 'alert' : 'normal', items: defaultComm,
      }),
      // Segmentazione della gestione: quante VLAN sono marcate «di gestione» (possono
      // essere più d'una). Advisory (non gate): averne una dedicata è buona pratica.
      // Il click elenca ogni VLAN di gestione col suo NOME (dichiarato, o misurato).
      _row('secMgmtVlan', {
        value: mgmtVlans.length, total: null, prov: mgmtVlans.length ? 'declared' : 'none',
        items: mgmtVlans.map((v) => {
          const nm = _str(vlanNames[String(v)]) || _str(_obj(measuredVlanNames[String(v)]).name);
          return { id: 'VLAN ' + v, meta: nm || null };
        }),
      }),
      // Coerenza VLAN wireless: SSID che trasmettono una VLAN ASSENTE dal trunk
      // dell'uplink dell'AP (dichiarata sul BSS ma non consentita a monte) → una
      // segmentazione incoerente. Conteggio di problemi come le community di default
      // (total=null); 0 = coerente. 'none' quando non c'è alcun AP con SSID.
      _row('secWifiVlan', {
        value: wifiApCount ? wifiIssues.length : null, total: null,
        prov: wifiApCount ? 'declared' : 'none',
        tone: wifiIssues.length > 0 ? 'alert' : 'normal',
        items: wifiIssues.map((is) => ({
          id: 'SSID «' + _str(is.ssid) + '» · VLAN ' + _str(is.vlan),
          meta: _str(is.ap) || null,   // niente tag: id (SSID·VLAN) + meta (AP) sono già completi
        })),
      }),
    ];

    // Salute. Prima di tutto: NEUTRO (grigio) se non c'è NULLA da valutare. Zero
    // accessi SNMP documentati vuol dire zero misure di esposizione, non «gestione
    // a norma»: l'app non può sapere se quegli apparati non parlano SNMP o se
    // nessuno ha ancora scritto l'accesso (paletto ② — la stessa ragione per cui
    // la riga «Verificabili» resta tratteggiata senza accessi configurati, e per
    // cui la lente ⑥ non è verde senza una lettura). Un pallino verde accanto a
    // «nessun accesso SNMP misurato» era una contraddizione in una riga sola.
    // Poi: ROSSO se c'è una community indovinabile (porta di gestione aperta);
    // GIALLO se c'è SNMP in chiaro o nessuna VLAN di gestione; VERDE altrimenti.
    const exposed = weakSnmp.length;
    let level = 'ok';
    if (!snmpTotal) level = 'none';
    else if (defaultComm.length > 0) level = 'bad';
    else if (exposed > 0 || mgmtVlans.length === 0) level = 'warn';
    // Coerenza VLAN wireless: un SSID fuori dal trunk è segmentazione incoerente →
    // almeno «warn», anche senza SNMP. Solo ALZA il livello (mai lo abbassa): un
    // verde su zero misure resterebbe disonesto, e il grigio-'none' senza SNMP
    // resta grigio se il wireless è coerente (non lo si tinge di verde a comprare).
    if (wifiIssues.length > 0 && level !== 'bad') level = 'warn';
    // NIENTE gate di staleness qui, e vale la pena scriverlo. A prima vista ⑤ è
    // una lente «da misura», ma i suoi tre ingressi sono tutti DICHIARATI: la
    // versione SNMP è il driver che hai scelto, la community è quella che hai
    // scritto, la VLAN di gestione quella che hai marcato. Nessuno di questi fatti
    // invecchia perché non sincronizzi da otto giorni — ingiallire il verdetto
    // sarebbe rumore, la stessa ragione per cui ① LAN resta fuori dal gate.
    return { rows, health: { level, issues: exposed + defaultComm.length + wifiIssues.length }, secured: v3, snmpTotal, managed: pop.length };
  }

  // ── ⑥ SALUTE LIVE ────────────────────────────────────────────────────────────
  // "Che problemi ci sono ADESSO?" — l'unica lente che parla del presente
  // invece che del documento. NON deriva nulla: gli allarmi arrivano gia' calcolati
  // da lib/health-alerts.js (soglie documentate li', le STESSE che legge
  // l'assistente AI) — il glue li applica a ogni apparato con un blocco live e li
  // passa qui. Una sola definizione di «RAM piena» in tutto il prodotto.
  //
  // m.liveHealth = [{ id, type, at, blocks:{host,printer,power}, cpu, alerts:[…] }]
  //   at     = ms dell'ultima lettura live (0/assente = non databile)
  //   blocks = quali telemetrie l'apparato ha davvero restituito → il DENOMINATORE.
  //            Un NAS che non parla Printer-MIB non e' una stampante «senza
  //            allarmi»: non entra proprio nel conto dei consumabili.
  //   cpu    = carico % misurato (HOST-RESOURCES). RIPORTATO, mai giudicato: una
  //            soglia sul carico istantaneo sarebbe inventata (paletto ②) — un
  //            picco a 100% fra due poll non e' un guasto.
  //   alerts = [{ severity:'warn'|'crit', kind:'ram'|'disk'|'ink'|'ups', value, label }]
  //
  // Il dato live INVECCHIA. Una lettura di ieri non e' «salute in tempo reale»:
  // oltre STALE_LIVE_HOURS il verdetto verde degrada a giallo e lo DICE. Senza
  // questo gate un progetto riaperto dopo mesi mostrerebbe pallini verdi su misure
  // fossili — lo stesso errore gia' corretto sul verdetto «Vero».
  const STALE_LIVE_HOURS = 6;                     // = la soglia 'old' del chip di freschezza SNMP
  const _ALERT_BLOCK = { ram: 'host', disk: 'host', ink: 'printer', ups: 'power' };

  function _health(m) {
    const live = _arr(m.liveHealth).filter((x) => x && x.id != null);
    const now = _num(m.now) || 0;
    // Il denominatore della riga «letture»: gli apparati che un accesso SNMP ce
    // l'hanno. Chi non e' interrogabile non e' «senza salute», e' fuori portata.
    const snmpTargets = _arr(m.nodes).filter(_hasSnmp);
    const targets = snmpTargets.length;

    const withBlock = { host: 0, printer: 0, power: 0 };
    const badIds = { host: new Set(), printer: new Set(), power: new Set() };
    const badItems = { host: [], printer: [], power: [] };
    const cpuItems = [];
    let warn = 0, crit = 0, alerting = 0, newest = 0, oldest = 0, cpuMax = null;

    for (const x of live) {
      const at = _num(x.at);
      if (at > newest) newest = at;
      // La freschezza del QUADRO si misura sul dato PIU' VECCHIO, non sul piu'
      // recente: «nessun allarme su 6 apparati» vale quanto vale la misura piu'
      // stantia fra quei sei. Un solo apparato riletto adesso non rinfresca gli
      // altri cinque letti quattro giorni fa.
      if (at > 0 && (oldest === 0 || at < oldest)) oldest = at;
      const blocks = _obj(x.blocks);
      for (const b of ['host', 'printer', 'power']) if (blocks[b]) withBlock[b]++;

      const cpu = x.cpu;
      if (typeof cpu === 'number' && Number.isFinite(cpu)) {
        const v = Math.round(cpu);
        cpuItems.push({ id: x.id, type: x.type, metric: 'cpu', value: v, meta: v });
        if (cpuMax == null || v > cpuMax) cpuMax = v;
      }

      const alerts = _arr(x.alerts);
      if (alerts.length) alerting++;
      for (const a of alerts) {
        if (!a) continue;
        const sev = _str(a.severity) === 'crit' ? 'crit' : 'warn';
        if (sev === 'crit') crit++; else warn++;
        const b = _ALERT_BLOCK[_str(a.kind)];
        if (!b) continue;                          // categoria nuova nel motore alert: non si inventa una riga
        badIds[b].add(x.id);
        // metric = il TOKEN della metrica (le parole le mette il renderer). Per l'UPS
        // la sotto-metrica sta in `label` ('runtime'/'charge'/'load'/'onBattery'), per
        // dischi e consumabili `label` e' il nome grezzo del volume o del colore.
        const sub = _str(a.label);
        const metric = (a.kind === 'ups' && sub) ? 'ups.' + sub : _str(a.kind);
        badItems[b].push({ id: x.id, type: x.type, tag: sev, metric, value: a.value != null ? a.value : null, label: (a.kind === 'ups' ? '' : sub) });
      }
    }
    // I critici in cima: la lista si legge dall'alto e la prima riga e' la peggiore.
    for (const b of ['host', 'printer', 'power']) {
      badItems[b].sort((a, z) => (a.tag === z.tag ? 0 : (a.tag === 'crit' ? -1 : 1)) || String(a.id).localeCompare(String(z.id)));
    }
    cpuItems.sort((a, z) => z.value - a.value || String(a.id).localeCompare(String(z.id)));

    // Riga per telemetria: «quanti stanno bene su quanti ne hanno parlato». Senza
    // nessuna risposta per quel blocco la riga e' 'none' (tratteggiata), non uno zero.
    const _blockRow = (key, b) => {
      const tot = withBlock[b];
      const bad = badIds[b].size;
      return _row(key, {
        value: tot ? tot - bad : null, total: tot || null,
        prov: tot ? 'measured' : 'none',
        tone: bad ? 'alert' : 'normal',
        extra: { alerts: badItems[b].length, devices: bad, crit: badItems[b].filter((it) => it.tag === 'crit').length },
        items: badItems[b],
      });
    };

    const ageMs = (oldest > 0 && now > 0) ? Math.max(0, now - oldest) : null;
    // Drill-down di «Ultima lettura»: i target SNMP, prima i SILENTI (interrogabili ma
    // senza telemetria — l'azione, marcati 'noReading'), poi chi ha risposto. Stessa
    // forma della mappa del tile Gateway (mancanti-prima, poi le complete).
    const liveIds = new Set(live.map((x) => x.id));
    const readOrdered = snmpTargets.filter((n) => !liveIds.has(n.id)).map((n) => ({ id: n.id, type: n.type, silent: true }))
      .concat(live.map((x) => ({ id: x.id, type: x.type, silent: false })));
    const readItems = readOrdered.map((e) => Object.assign({ id: e.id, type: e.type }, e.silent ? { meta: '—', tag: 'noReading' } : {}));
    const rows = [
      // Il «quando» della lente, in cima come la riga «Ultima lettura» della «Vero»:
      // tutto quello che sta sotto vale a quella data. L'eta' mostrata e' quella
      // della lettura PIU' VECCHIA — il quadro non e' piu' fresco del suo pezzo
      // piu' stantio; `newestAt` resta a disposizione di chi volesse l'altra faccia.
      _row('hlReading', {
        value: live.length || null, total: targets || null,
        prov: live.length ? 'measured' : 'none', tone: live.length ? 'normal' : 'muted',
        extra: { at: oldest || null, ageMs, newestAt: newest || null },
        items: readItems,
      }),
      _blockRow('hlHost', 'host'),
      _blockRow('hlPower', 'power'),
      _blockRow('hlSupplies', 'printer'),
      // CPU: il carico PIU' ALTO misurato. Nessuna soglia, nessun verdetto di
      // merito — solo il numero e da chi arriva (paletto ②).
      _row('hlCpu', {
        value: cpuMax, total: null, prov: cpuItems.length ? 'measured' : 'none',
        extra: { devices: cpuItems.length }, items: cpuItems,
      }),
    ];

    // Verdetto: rosso se c'e' un critico, giallo se c'e' un avviso, verde se la
    // telemetria e' arrivata e non dice niente di brutto. Nessuna lettura → 'none':
    // «non lo so» ha il suo livello, non si traveste da verde (l'errore che la
    // lente Sicurezza fa ancora con zero apparati SNMP, N7 dell'audit).
    let level;
    if (!live.length) level = 'none';
    else if (crit > 0) level = 'bad';
    else if (warn > 0) level = 'warn';
    else level = 'ok';
    const staleHours = (oldest > 0 && now > 0) ? (now - oldest) / 3600000 : 0;
    // Quante letture hanno passato la soglia, e se l'ha passata anche la PIU'
    // RECENTE: sono due frasi diverse. Se pure la piu' fresca e' vecchia, il dato
    // e' vecchio e basta; se invece ce n'e' una di poco fa, il problema sono i
    // singoli apparati rimasti indietro — e il renderer lo dice come tale.
    const _stale = (at) => at > 0 && now > 0 && (now - at) / 3600000 > STALE_LIVE_HOURS;
    const staleReadings = live.filter((x) => _stale(_num(x.at))).length;
    const health = { level, issues: crit + warn };
    if (level === 'ok' && staleHours > STALE_LIVE_HOURS) {
      health.level = 'warn'; health.stale = true; health.staleHours = Math.round(staleHours);
      health.allStale = _stale(newest);
    }
    return {
      rows, health, measured: live.length, targets, healthy: live.length - alerting,
      alerting, crit, warn, ageMs, staleReadings,
    };
  }

  // Riempimento dei rack, calcolato QUI (puro) e non nel glue: era una cucitura
  // non testata, ed e' proprio li' che il bug del denominatore e' vissuto. Il
  // campo VERO dell'altezza rack e' `sizeU`; `units`/`u` non esistono sul rack.
  // `used` = somma dei sizeU dei device che OCCUPANO U (solo i tipi isRack; un PC
  // a muro non consuma unita').
  // `declared` distingue l'altezza DICHIARATA dal ripiego 42U: un rack importato o
  // creato via API non dichiara nulla, e il totale che ne esce e' un'ASSUNZIONE —
  // chi legge la riga deve poterlo dire (② no-invenzioni).
  function _rackFill(racks, nodes, types) {
    const T = _obj(types);
    const ns = _arr(nodes);
    return _arr(racks).map((r) => {
      const declU = _num(r && r.sizeU);
      const sizeU = declU || 42;
      let used = 0;
      for (const n of ns) {
        if (n && n.rackId === (r && r.id) && _obj(T[n.type]).isRack) {
          used += _num(n.sizeU) || _num(_obj(T[n.type]).sizeU) || 1;
        }
      }
      // `name` serve al dettaglio cliccabile della riga «Spazio rack»: un rack non
      // e' un nodo, quindi il renderer lo mostra come testo — e «Main Rack» si legge,
      // `rack_1` no.
      return { id: r && r.id, name: _str(r && r.name), sizeU, declared: declU > 0, used, free: Math.max(0, sizeU - used) };
    });
  }

  // Il PERIMETRO della Panoramica, reso ESPLICITO. Ogni voce e' una dimensione di
  // rete che questa sintesi NON valuta: dirlo evita che l'assenza di un allarme si
  // legga come «tutto a posto» (paletto ② no-invenzioni portato al limite — si
  // dichiara anche cio' che non si sa). 'tier':
  //   'unmodeled' il motore non ha affatto questa dimensione (serve modellarla);
  //   'elsewhere' il dato e' MISURATO altrove (una card device) ma non entra in un
  //               verdetto qui. Quando una dimensione verra' modellata, la si TOGLIE
  //               da questa lista: e' un TODO vivo, non una scritta fissa.
  const _BLIND_SPOTS = [
    { key: 'wan',       tier: 'unmodeled' },   // circuiti / uplink ISP / banda / SLA
    { key: 'routing',   tier: 'unmodeled' },   // tabelle di routing, OSPF/BGP, VRF, inter-VLAN
    { key: 'stp',       tier: 'unmodeled' },   // spanning-tree: root bridge, porte bloccate
    { key: 'firewall',  tier: 'unmodeled' },   // regole / ACL / zone / NAT
    { key: 'mgmtSvc',   tier: 'unmodeled' },   // AAA (RADIUS/TACACS) · syslog · NTP · DNS
    { key: 'restore',   tier: 'unmodeled' },   // il backup si RIPRISTINA davvero (non solo: esiste)
    // USCITI da questa lista, perche' modellati: 'power' e 'health' (lente ⑥
    // «Salute»), 'lifecycle' (riga «Ciclo di vita» della lente ④ DR, dalle date
    // dichiarate). Il perimetro e' un TODO vivo — cio' che viene modellato si
    // toglie. Resta dichiarato solo cio' che il motore non legge affatto:
    { key: 'sensors',   tier: 'unmodeled' },   // temperatura (ENTITY-SENSOR) ed errori d'interfaccia: mai interrogati
    // Simmetria dei trunk: che i due capi trasportino le STESSE VLAN taggate.
    // Nel documento coincidono per costruzione — un trunk è un solo oggetto link,
    // quindi confrontarlo con se stesso non proverebbe niente. Servirebbe la lista
    // egress MISURATA per lato, che oggi non leggiamo: finché non la leggiamo la
    // regola si dichiara invece di implementarne una metà che sembra una verifica.
    { key: 'trunkSym',  tier: 'unmodeled' },
  ];

  /**
   * Fatti della Panoramica. `model` esplicito, nessuna lettura di stato globale:
   *   { nodes, links, types, ipamVlans, vlanIdsInUse, vlanNames, portMacNodeIds,
   *     spare (buildSpareReport), sfpTotal, networks (deriveProjectNetworks),
   *     caps, fleet (hw-capabilities), rackFill, topoCache, lagGroups,
   *     liveHealth (alert gia' derivati da lib/health-alerts.js, per apparato),
   *     lastSyncAt, lastSyncResult, now }
   */
  function buildOverview(model) {
    const m = _obj(model);
    return {
      complete: _complete(m), truth: _truth(m), margin: _margin(m),
      recovery: _recovery(m), security: _security(m), health: _health(m),
      // Il perimetro esplicito: cosa la Panoramica NON guarda (il glue lo racconta).
      blindSpots: _BLIND_SPOTS.map((b) => ({ key: b.key, tier: b.tier })),
    };
  }

  // Le soglie escono dal motore perché il DOSSIER deve usare le stesse: erano
  // ricopiate a mano in server/pdf-report.js, e un dossier che contraddice l'app
  // è peggio di nessun dossier. Una sola definizione, due consumatori.
  return { buildOverview, _isAddressable, _hasRealName, _rackFill, _BLIND_SPOTS,
    BACKUP_FRESH_DAYS, LIFECYCLE_SOON_DAYS };
});
