// ============================================================
// HEALTH STORE — la salute degli apparati (interfacce e sensori): righe piatte, differenze, fusione (pura)
// ============================================================
// Cio' che l'apparato dice di ogni sua interfaccia (stato, errori, scarti, FCS) e dei suoi sensori ambientali (temperatura,
// ventole, alimentatori, tensioni: v. la sezione SENSORI in fondo) ogni volta che si fa il Sync.
// Questo modulo e' la parte che non tocca ne' la rete ne' il disco: dice QUALI colonne si leggono, mette in
// forma la lettura che arriva dal driver, FONDE una lettura nuova in quella gia' salvata e trasforma due
// letture in cio' che si mostra. Il driver (`drivers/snmp.js`, `pollHealth`) fa le walk, il server
// (`server/history-store-fs.js`) scrive il file, il pannello (`src/app-health.js`) disegna.
//
// ── Perche' NON e' nel progetto ─────────────────────────────────────────────────────────────
// E' una MISURA che cambia a ogni Sync e cresce con gli apparati: ~100 byte per porta (la lettura di ora e quella di
// prima), quindi ~460 KB per cento switch da 48 porte (misurato su dati sintetici: 3,7 ms per scriverlo, 2,9 per
// leggerlo), contro i 224 KB del progetto piu' grande che esista oggi. Nel documento ogni salvataggio,
// ogni snapshot e ogni caricamento se la porterebbe dietro. Sta nel sidecar `history/<id>/health.json`, dietro
// l'interfaccia `historyStore` (come presenza e osservazioni): il documento resta documento, e il giorno che lo
// storico passa a un database cambia il backend, non le route ne' l'interfaccia (ADR D7, STATO_PIANO §2.7).
//
// ── La forma: righe SCALARI e PIATTE ────────────────────────────────────────────────────────
// Una riga = una interfaccia = una riga di tabella: `HEALTH_IF_COLUMNS` e' l'elenco UNICO delle colonne, ed e'
// anche lo schema della tabella SQL di domani. Niente oggetti annidati: uno scalare mappa 1:1 su una colonna
// indicizzata, un oggetto annidato no. Sul disco le righe sono tuple (la forma leggibile costerebbe 2,7 volte
// tanto: misurato), ma chi legge chiama `healthDecodeFile` e riceve sempre oggetti con i nomi delle colonne:
// la codifica la conosce solo questo file, come `refOf` per i riferimenti d'origine (lib/source-ref.js).
//
// ── Cio' che si dichiara (paletti ② niente invenzioni, ④ misurato≠dichiarato) ───────────────
//   • una colonna che l'apparato non pubblica vale `null` = «non letto», MAI zero;
//   • una differenza si calcola solo fra DUE letture dello stesso apparato con la stessa base dei contatori:
//       - `sysUpTime` sceso            → `rebooted`        (i contatori sono ripartiti da zero)
//       - `ifCounterDiscontinuityTime` → `discontinuity`   (lo dice l'apparato stesso)
//       - un contatore e' CALATO       → `counter_cleared` (vedi sotto)
//       - nessuna lettura precedente   → `no_baseline`     (si mostra il totale «dall'avvio», non un tasso)
//   • un calo con uptime e discontinuita' invariati vuol dire quasi sempre un `clear counters` dell'operatore:
//     ci vorrebbero 4,3 miliardi di errori per fare il giro di un Counter32. Non si somma il modulo (come fa
//     `port-live.js` nella lettura a 3 secondi, dove il giro e' l'unica spiegazione): si dice «azzerato» e
//     nessuna differenza. Un delta inventato qui sarebbe un errore dichiarato come fatto;
//   • nessuna SOGLIA: un contatore e' «salito» se fra le due letture e' salito, e basta;
//   • la differenza e' un INTERVALLO («N errori fra la lettura A e la lettura B»), non un tasso al secondo:
//     a distanza di un'ora un tasso istantaneo non e' misurato, e' una media.
//
// UMD-lite come le altre lib pure: Node require(), nel bundle `import`. Nessun DOM, nessun IO.
(function (root, factory) {
  const api = factory(typeof module !== 'undefined' && module.exports ? require('./port-live.js') : root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // Node (server, driver, test)
  if (typeof window !== 'undefined') Object.assign(window, api);               // browser (bundle)
})(typeof self !== 'undefined' ? self : this, function (PL) {
  'use strict';

  const HEALTH_FILE_VERSION = 1;

  // L'elenco UNICO delle colonne: ordine delle tuple sul disco e ordine delle colonne della tabella di domani.
  const HEALTH_IF_COLUMNS = ['ifName', 'oper', 'admin', 'inErrors', 'outErrors', 'inDiscards', 'outDiscards', 'fcs', 'disc'];
  // I contatori che si confrontano fra due letture (tutti Counter32: IF-MIB non ha varianti a 64 bit per errori e scarti).
  const HEALTH_IF_COUNTERS = ['inErrors', 'outErrors', 'inDiscards', 'outDiscards', 'fcs'];

  // Gli OID stanno UNA volta, in lib/port-live.js: qui si pescano, non si ricopiano.
  const PC = (PL && PL.PORT_COLUMNS) || {};
  const HEALTH_IF_OIDS = {
    oper: PC.oper, admin: PC.admin,
    inErrors: PC.inErrors, outErrors: PC.outErrors, inDiscards: PC.inDiscards, outDiscards: PC.outDiscards,
    fcs: PC.fcs, disc: PC.discontinuity,
  };
  const HEALTH_IF_NAME_OID = '1.3.6.1.2.1.31.1.1.1.1';    // IF-MIB ifName
  const HEALTH_IF_DESCR_OID = '1.3.6.1.2.1.2.2.1.2';      // IF-MIB ifDescr (ripiego se ifName non c'e')
  const HEALTH_SYS_UPTIME = (PL && PL.SYS_UPTIME) || '1.3.6.1.2.1.1.3.0';

  // Da dove viene ogni colonna: serve al tooltip del pannello e alle righe del Drift (source + MIB + OID).
  const _MIB = { oper: 'IF-MIB', admin: 'IF-MIB', inErrors: 'IF-MIB', outErrors: 'IF-MIB', inDiscards: 'IF-MIB', outDiscards: 'IF-MIB', disc: 'IF-MIB', fcs: 'EtherLike-MIB' };
  function healthIfProvenance(col) {
    if (col === 'ifName') return { source: 'snmp', mib: 'IF-MIB', oid: HEALTH_IF_NAME_OID };
    return HEALTH_IF_OIDS[col] ? { source: 'snmp', mib: _MIB[col], oid: HEALTH_IF_OIDS[col] } : null;
  }

  // Tetti: la PUT e' ostile per definizione (un client puo' mandare qualunque cosa) e il file non deve gonfiare.
  const MAX_NODES_PER_PUT = 1000;
  const MAX_ROWS_PER_NODE = 4096;
  const MAX_NODES_IN_FILE = 5000;
  const MAX_AGE_MS = 90 * 24 * 3600 * 1000;   // una lettura non rinnovata da 90 giorni e' di un apparato che non c'e' piu'

  // ── Normalizzazione ────────────────────────────────────────────────────────────────────────
  // Solo un numero, o un testo che e' un numero. Il confronto «Number(x)» direttamente NON basta: Number([]) vale 0 e
  // Number(true) vale 1, e uno zero uscito da un valore malformato sarebbe un contatore «letto a zero» che nessuno ha letto.
  function _toNum(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '') return Number(v);
    return NaN;
  }
  function _int(v, lo, hi) {
    const n = _toNum(v);
    return Number.isSafeInteger(n) && n >= lo && n <= hi ? n : null;
  }
  function _name(v) {
    // I caratteri di controllo si TOLGONO apposta: il nome arriva dall'apparato e finisce in un attributo e in un file.
    // eslint-disable-next-line no-control-regex
    return String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 128);
  }
  // L'id di un nodo finisce in un nome di chiave e in un attributo: solo i caratteri che gli id dell'app usano.
  const _ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

  // Una riga qualunque → riga pulita, oppure null (senza nome non si sa di quale interfaccia si parli).
  function _row(r) {
    if (!r || typeof r !== 'object') return null;
    const ifName = _name(r.ifName);
    if (!ifName) return null;
    return {
      ifName,
      oper: _int(r.oper, 1, 7), admin: _int(r.admin, 1, 3),
      inErrors: _int(r.inErrors, 0, Number.MAX_SAFE_INTEGER), outErrors: _int(r.outErrors, 0, Number.MAX_SAFE_INTEGER),
      inDiscards: _int(r.inDiscards, 0, Number.MAX_SAFE_INTEGER), outDiscards: _int(r.outDiscards, 0, Number.MAX_SAFE_INTEGER),
      fcs: _int(r.fcs, 0, Number.MAX_SAFE_INTEGER), disc: _int(r.disc, 0, Number.MAX_SAFE_INTEGER),
    };
  }

  // ── SENSORI: righe piatte come quelle delle interfacce ─────────────────────────────────────
  // Una riga = un sensore = una riga di tabella; `HEALTH_SENSOR_COLUMNS` e' l'elenco UNICO (e lo schema di domani).
  //   sid    identita' stabile del sensore sull'apparato (`ent:1001`, `cisco-envmon:temp:3`, …): non e' un OID
  //   kind   cosa misura (temperature, fan, psu, voltage, current, power, other)
  //   value  il valore in unita' REALI (gia' scalato) o null = «non letto» — MAI zero al posto di un'assenza
  //   state  lo stato che DICE l'apparato (ok, warning, critical, …), normalizzato: non e' un giudizio nostro
  //   mib/oid da dove viene (la provenienza che ogni valore mostrato deve poter dire)
  //   limLo/limHi  i limiti che l'APPARATO dichiara (null = non ne dichiara)
  const HEALTH_SENSOR_COLUMNS = ['sid', 'kind', 'label', 'value', 'unit', 'state', 'mib', 'oid', 'limLo', 'limHi'];
  const HEALTH_SENSOR_KINDS = ['temperature', 'fan', 'psu', 'voltage', 'current', 'power', 'other'];
  const HEALTH_SENSOR_STATES = ['ok', 'warning', 'critical', 'shutdown', 'not_present', 'not_functioning', 'unavailable', 'nonoperational', 'unknown'];
  const MAX_SENSORS_PER_NODE = 512;
  const _SID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
  const _MIB_RE = /^[A-Za-z0-9-]{1,40}$/;
  const _OID_RE = /^[0-9.]{1,120}$/;

  // Un numero finito (anche con decimali) o null; arrotondato: lo scalare di un sensore non deve portare rumore binario.
  function _fnum(v) {
    const n = _toNum(v);
    return Number.isFinite(n) && Math.abs(n) <= 1e12 ? Math.round(n * 1e6) / 1e6 : null;
  }
  function _srow(r) {
    if (!r || typeof r !== 'object') return null;
    const sid = String(r.sid === null || r.sid === undefined ? '' : r.sid);
    if (!_SID_RE.test(sid)) return null;
    return {
      sid,
      kind: HEALTH_SENSOR_KINDS.includes(r.kind) ? r.kind : 'other',
      label: _name(r.label) || sid,
      value: _fnum(r.value),
      unit: _name(r.unit).slice(0, 8),
      state: HEALTH_SENSOR_STATES.includes(r.state) ? r.state : 'unknown',
      mib: _MIB_RE.test(String(r.mib || '')) ? String(r.mib) : '',
      oid: _OID_RE.test(String(r.oid || '')) ? String(r.oid) : '',
      limLo: _fnum(r.limLo), limHi: _fnum(r.limHi),
    };
  }

  // UNA lettura di UN apparato: { at (ms epoch), upCs (centesimi di secondo | null), rows:[riga], sensors:[sensore] | null }.
  // `at` e' obbligatorio: senza istante una lettura non si ordina, e non si confronta con niente.
  // `sensors` null = il passo dei sensori NON e' stato fatto (o non e' riuscito): e' diverso da `[]` = l'apparato ha
  // risposto e non ne pubblica nessuno. Confonderli direbbe «nessun sensore» dove si e' solo «non letto».
  function healthReading(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const at = _int(raw.at, 1, Number.MAX_SAFE_INTEGER);
    if (at === null) return null;
    const rows = [];
    for (const r of (Array.isArray(raw.rows) ? raw.rows : [])) {
      if (rows.length >= MAX_ROWS_PER_NODE) break;
      const c = _row(r);
      if (c) rows.push(c);
    }
    let sensors = null;
    if (Array.isArray(raw.sensors)) {
      sensors = [];
      for (const r of raw.sensors) {
        if (sensors.length >= MAX_SENSORS_PER_NODE) break;
        const c = _srow(r);
        if (c) sensors.push(c);
      }
    }
    return { at, upCs: _int(raw.upCs, 0, 4294967295), rows, sensors };
  }

  // ── Codifica sul disco (tuple) ─────────────────────────────────────────────────────────────
  function _encode(rd) {
    const o = { at: rd.at, upCs: rd.upCs, r: rd.rows.map(row => HEALTH_IF_COLUMNS.map(c => row[c])) };
    if (Array.isArray(rd.sensors)) o.s = rd.sensors.map(row => HEALTH_SENSOR_COLUMNS.map(c => row[c]));
    return o;
  }
  function _decode(enc) {
    if (!enc || typeof enc !== 'object' || !Array.isArray(enc.r)) return null;
    const rows = [];
    for (const tup of enc.r) {
      if (!Array.isArray(tup)) continue;
      const o = {};
      HEALTH_IF_COLUMNS.forEach((c, i) => { o[c] = tup[i] === undefined ? null : tup[i]; });
      const clean = _row(o);
      if (clean) rows.push(clean);
    }
    let sensors = null;
    if (Array.isArray(enc.s)) {
      sensors = [];
      for (const tup of enc.s) {
        if (!Array.isArray(tup)) continue;
        const o = {};
        HEALTH_SENSOR_COLUMNS.forEach((c, i) => { o[c] = tup[i] === undefined ? null : tup[i]; });
        const clean = _srow(o);
        if (clean) sensors.push(clean);
      }
    }
    const at = _int(enc.at, 1, Number.MAX_SAFE_INTEGER);
    return at === null ? null : { at, upCs: _int(enc.upCs, 0, 4294967295), rows, sensors };
  }
  // La lettura di «prima» serve solo al confronto fra interfacce: i sensori sono lo stato di ADESSO e non si tengono due volte.
  function _withoutSensors(enc) { return { at: enc.at, upCs: enc.upCs, r: enc.r }; }

  // ── La PUT: corpo ostile → { nodes: { id: lettura } } pulito ───────────────────────────────
  function healthSanitizePut(body) {
    const out = { nodes: {} };
    const src = body && typeof body === 'object' && body.nodes && typeof body.nodes === 'object' ? body.nodes : {};
    let n = 0;
    for (const id of Object.keys(src)) {
      if (n >= MAX_NODES_PER_PUT) break;
      if (!_ID_RE.test(id)) continue;
      const rd = healthReading(src[id]);
      if (!rd) continue;
      out.nodes[id] = rd;
      n++;
    }
    return out;
  }

  // ── La fusione: la lettura nuova diventa «ora», quella di «ora» diventa «prima» ────────────
  // `file` e' quello su disco (o null), `put` e' l'esito di healthSanitizePut. Idempotente: la stessa lettura
  // rimandata due volte (o una piu' vecchia, da un client rimasto indietro) NON scorre: altrimenti «prima» e
  // «ora» diventerebbero la stessa lettura e la differenza sparirebbe. Ritorna un file nuovo, mai lo stesso oggetto.
  function healthFold(file, put, nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const out = { v: HEALTH_FILE_VERSION, nodes: {} };
    const old = file && typeof file === 'object' && file.nodes && typeof file.nodes === 'object' ? file.nodes : {};
    for (const id of Object.keys(old)) {
      if (!_ID_RE.test(id)) continue;
      const cur = _decode(old[id] && old[id].cur);
      if (!cur || now - cur.at > MAX_AGE_MS) continue;   // invecchiato: l'apparato non si legge piu'
      const prev = _decode(old[id].prev);
      out.nodes[id] = { cur: _encode(cur), prev: prev ? _encode(prev) : null };
    }
    const inc = put && put.nodes ? put.nodes : {};
    for (const id of Object.keys(inc)) {
      const rd = inc[id];
      const slot = out.nodes[id];
      if (slot && slot.cur && rd.at <= slot.cur.at) continue;   // stessa lettura o piu' vecchia: niente scorrimento
      out.nodes[id] = { cur: _encode(rd), prev: slot && slot.cur ? _withoutSensors(slot.cur) : null };
    }
    // Tetto sul numero di apparati: cadono i letti da piu' tempo.
    const ids = Object.keys(out.nodes);
    if (ids.length > MAX_NODES_IN_FILE) {
      ids.sort((a, b) => out.nodes[b].cur.at - out.nodes[a].cur.at);
      for (const id of ids.slice(MAX_NODES_IN_FILE)) delete out.nodes[id];
    }
    return out;
  }

  // File (come arriva dal disco) → { id: { cur, prev } } con le righe in oggetti. Tollera qualunque cosa.
  function healthDecodeFile(file) {
    const out = {};
    const nodes = file && typeof file === 'object' && file.nodes && typeof file.nodes === 'object' ? file.nodes : {};
    for (const id of Object.keys(nodes)) {
      if (!_ID_RE.test(id)) continue;
      const cur = _decode(nodes[id] && nodes[id].cur);
      if (!cur) continue;
      out[id] = { cur, prev: _decode(nodes[id].prev) };
    }
    return out;
  }

  // Le righe PIATTE di tutto il file, una per interfaccia, con l'apparato e l'istante in ogni riga: e' la tabella
  // che un database avrebbe (node, at, upCs, ifName, oper, …). Oggi la usano i test; domani la usera' il backend SQL.
  function healthFlatRows(file) {
    const rows = [];
    const dec = healthDecodeFile(file);
    for (const node of Object.keys(dec)) {
      for (const [which, rd] of [['cur', dec[node].cur], ['prev', dec[node].prev]]) {
        if (!rd) continue;
        for (const r of rd.rows) rows.push(Object.assign({ node, reading: which, at: rd.at, upCs: rd.upCs }, r));
      }
    }
    return rows;
  }

  // ── Le differenze ──────────────────────────────────────────────────────────────────────────
  const _key = (s) => String(s).trim().toLowerCase();

  // Le righe di una lettura per nome (minuscole, spazi tagliati: come abbina le porte tutta l'app). Un nome che
  // compare piu' volte e' AMBIGUO e non si indovina quale sia: va in `dup`.
  function _byName(rd) {
    const map = new Map(), dup = new Set();
    for (const r of (rd && rd.rows) || []) {
      const k = _key(r.ifName);
      if (map.has(k)) { dup.add(k); continue; }
      map.set(k, r);
    }
    return { map, dup };
  }

  // Quanto e' durato l'intervallo: dal tempo dell'APPARATO (sysUpTime) se c'e' e cresce, altrimenti dall'orologio.
  function _span(prev, cur) {
    if (prev.upCs !== null && cur.upCs !== null && cur.upCs > prev.upCs) return { spanS: (cur.upCs - prev.upCs) / 100, basis: 'sysUpTime' };
    if (cur.at > prev.at) return { spanS: (cur.at - prev.at) / 1000, basis: 'clock' };
    return { spanS: null, basis: null };
  }

  function _totals(row) {
    const o = {};
    for (const k of HEALTH_IF_COUNTERS) o[k] = row[k];
    return o;
  }

  // Una interfaccia: la riga di prima, quella di ora, e cosa si puo' dire del loro confronto.
  // `min` = la soglia dell'UTENTE sugli errori (1 = ogni aumento, cioe' nessuna soglia; v. `_ifMin`).
  function _port(prevRd, curRd, prevRow, curRow, rebooted, ambiguous, min) {
    const base = { ifName: curRow.ifName, oper: curRow.oper, admin: curRow.admin, totals: _totals(curRow), deltas: null, grew: [], below: false, spanS: null, basis: null };
    if (ambiguous) return Object.assign(base, { status: 'ambiguous' });
    if (!prevRow) return Object.assign(base, { status: 'no_baseline' });
    if (rebooted) return Object.assign(base, { status: 'rebooted' });
    if (prevRow.disc !== null && curRow.disc !== null && prevRow.disc !== curRow.disc) return Object.assign(base, { status: 'discontinuity' });
    const sp = _span(prevRd, curRd);
    const deltas = {};
    let cleared = false;
    for (const k of HEALTH_IF_COUNTERS) {
      const a = prevRow[k], b = curRow[k];
      if (a === null || b === null) { deltas[k] = null; continue; }   // non letto: ne' zero ne' differenza
      if (b < a) { cleared = true; deltas[k] = null; continue; }
      deltas[k] = b - a;
    }
    if (cleared) return Object.assign(base, { status: 'counter_cleared', spanS: sp.spanS, basis: sp.basis });
    const rising = HEALTH_IF_COUNTERS.filter(k => deltas[k] !== null && deltas[k] > 0);
    // La soglia dell'utente decide se l'interfaccia si SEGNALA: basta UN contatore salito di almeno `min`, preso da solo e non
    // sommato agli altri (gli errori FCS stanno di solito GIA' dentro ifInErrors: la somma li conterebbe due volte). Segnalata,
    // l'interfaccia porta TUTTI i contatori saliti, anche quelli sotto soglia: la riga dice cosa e' cambiato, non solo cio' che
    // supera. Con `min` = 1 (nessuna soglia) ogni aumento segnala, come prima. Sotto soglia: `below`, cosi' la scheda puo' dire
    // quante ne ha taciute invece di far sembrare che non sia salito niente.
    const flagged = rising.some(k => deltas[k] >= min);
    return Object.assign(base, { status: 'ok', deltas, grew: flagged ? rising : [], below: !flagged && rising.length > 0, spanS: sp.spanS, basis: sp.basis });
  }
  // La soglia sugli errori scritta dall'utente (`healthSanitizeThresholds` l'ha gia' ripulita), oppure 1: ogni aumento.
  function _ifMin(thr) {
    const m = thr && thr.ifErrors && thr.ifErrors.min;
    return Number.isSafeInteger(m) && m > 1 ? m : 1;
  }

  // Due letture (prima, ora) → quello che il pannello e il Drift mostrano. `prev` puo' essere null. `thr` = le soglie dell'UTENTE
  // (gia' ripulite): senza, ogni aumento di un contatore segnala l'interfaccia. Il risultato porta `min`, cosi' chi disegna
  // puo' dire con quale soglia ha giudicato.
  function healthSummarizeIf(prev, cur, thr) {
    const min = _ifMin(thr);
    if (!cur || !Array.isArray(cur.rows)) return { state: 'not_available', at: null, upCs: null, min, ports: [], counts: _counts([]) };
    // «Non disponibile»: l'apparato non ha pubblicato nessuna delle colonne dei contatori (o nessuna interfaccia).
    const answered = cur.rows.some(r => HEALTH_IF_COUNTERS.some(k => r[k] !== null));
    if (!cur.rows.length || !answered) return { state: 'not_available', at: cur.at, upCs: cur.upCs, min, ports: [], counts: _counts([]) };
    const rebooted = !!(prev && prev.upCs !== null && cur.upCs !== null && cur.upCs < prev.upCs);
    const pn = prev ? _byName(prev) : { map: new Map(), dup: new Set() };
    const cn = _byName(cur);
    const ports = [];
    for (const [k, row] of cn.map) {
      ports.push(_port(prev, cur, pn.map.get(k) || null, row, rebooted, cn.dup.has(k) || pn.dup.has(k), min));
    }
    return { state: 'read', at: cur.at, upCs: cur.upCs, min, ports, counts: _counts(ports) };
  }
  function _counts(ports) {
    const c = { ports: ports.length, grew: 0, below: 0, noBaseline: 0, rebooted: 0, discontinuity: 0, cleared: 0, ambiguous: 0 };
    for (const p of ports) {
      if (p.grew.length) c.grew++;
      if (p.below) c.below++;
      if (p.status === 'no_baseline') c.noBaseline++;
      else if (p.status === 'rebooted') c.rebooted++;
      else if (p.status === 'discontinuity') c.discontinuity++;
      else if (p.status === 'counter_cleared') c.cleared++;
      else if (p.status === 'ambiguous') c.ambiguous++;
    }
    return c;
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════
  // SENSORI AMBIENTALI — cosa si legge, come si converte, cosa si puo' dire
  // ═════════════════════════════════════════════════════════════════════════════════════════
  // Standard prima (ENTITY-SENSOR-MIB, RFC 3433), MIB del fornitore SOLO come ripiego e con una mappa esplicita per
  // ognuna. Un OID di cui non c'e' una fonte letta NON e' qui: sta nell'elenco «non letto» in fondo, con la ragione.
  //
  //   • sensore assente → NESSUNA riga, e `state:'not_available'` per l'apparato: mai uno zero, mai un valore stimato;
  //   • sensore che esiste ma non da' il valore (operStatus «unavailable», Juniper a 0) → riga con `value:null`;
  //   • la GRAVITA' viene dall'apparato (il suo stato, i suoi limiti); solo se l'apparato non ne dice, da una soglia che
  //     l'UTENTE ha configurato nel progetto, e allora la fonte e' `user_default`. MAI una soglia nostra di fabbrica.
  const HEALTH_ENT_SENSOR_BASE = '1.3.6.1.2.1.99.1.1.1';   // entPhySensorEntry (RFC 3433); colonne .1 tipo .2 scala .3 precisione .4 valore .5 stato
  const HEALTH_ENT_SENSOR_COLS = { type: HEALTH_ENT_SENSOR_BASE + '.1', scale: HEALTH_ENT_SENSOR_BASE + '.2', precision: HEALTH_ENT_SENSOR_BASE + '.3', value: HEALTH_ENT_SENSOR_BASE + '.4', status: HEALTH_ENT_SENSOR_BASE + '.5' };
  const HEALTH_ENT_PHYS_NAME = '1.3.6.1.2.1.47.1.1.1.1.7';    // entPhysicalName (ENTITY-MIB): l'etichetta del sensore
  const HEALTH_ENT_PHYS_DESCR = '1.3.6.1.2.1.47.1.1.1.1.2';   // entPhysicalDescr: ripiego se il nome e' vuoto

  // Il tipo del sensore (EntitySensorDataType, RFC 3433) → cosa misura e in che unita'. I tipi che non sono una
  // grandezza fisica nota (other, unknown, truthvalue, …) restano `other` senza unita': si mostrano, non si interpretano.
  const _ENT_TYPE = {
    3: { kind: 'voltage', unit: 'V' }, 4: { kind: 'voltage', unit: 'V' }, 5: { kind: 'current', unit: 'A' }, 6: { kind: 'power', unit: 'W' },
    7: { kind: 'other', unit: 'Hz' }, 8: { kind: 'temperature', unit: '°C' }, 9: { kind: 'other', unit: '%RH' }, 10: { kind: 'fan', unit: 'rpm' },
    11: { kind: 'other', unit: 'cmm' },
  };
  function healthEntityType(n) { return _ENT_TYPE[n] || { kind: 'other', unit: '' }; }
  // EntitySensorStatus: ok(1), unavailable(2), nonoperational(3).
  function healthEntityStatus(n) { return n === 1 ? 'ok' : (n === 2 ? 'unavailable' : (n === 3 ? 'nonoperational' : 'unknown')); }

  // Il valore REALE di un sensore standard. L'RFC non da' una formula unica; si combina cosi' (e il suo unico esempio —
  // «gradi C * 10» con precisione 1 e scala units — torna):
  //   · scala (EntitySensorDataScale): yocto(1) … milli(8), units(9), kilo(10) … yotta(17) = potenza di dieci (scala-9)·3;
  //   · precisione > 0: cifre DECIMALI del numero a virgola fissa → si divide per 10^precisione;
  //   · precisione < 0: «cifre accurate» (il valore e' gia' intero, non si sposta la virgola); 0: non e' a virgola fissa.
  // Fuori dagli intervalli dello standard → null (non si indovina). ⚠️ DA VERIFICARE su hardware: nessun apparato del
  // lab pubblica ENTITY-SENSOR, quindi la formula e' provata solo su fixture scritte a mano dalla MIB.
  function healthEntityValue(raw, scale, precision) {
    const v = _toNum(raw);
    if (!Number.isFinite(v)) return null;
    // RFC 3433: i valori validi vanno da -999.999.999 a +999.999.999; -1000000000 dice «underflow» e +1000000000 «overflow», cioe' un
    // ERRORE di lettura, non una misura. Misurato su una registrazione vera (uno switch con 29 moduli ottici senza luce, stato «ok»):
    // senza questa regola la scheda mostrava «-100 W» come potenza ricevuta.
    if (v <= -1000000000 || v >= 1000000000) return null;
    if (!Number.isInteger(scale) || scale < 1 || scale > 17) return null;
    if (!Number.isInteger(precision) || precision < -8 || precision > 9) return null;
    const e = 3 * (scale - 9) - Math.max(precision, 0);
    return _fnum(e >= 0 ? v * Math.pow(10, e) : v / Math.pow(10, -e));
  }

  // ── MIB dei fornitori (ripiego): DATI, non codice ────────────────────────────────────────────
  // ⚠️ VENDOR-NEUTRAL (regola cardine ③, docs/adr/vendor-neutral.md): qui ci sono TABELLE che descrivono la FORMA di una
  // famiglia di sensori (dove stanno nome, valore, stato, limiti, con che scala) e il driver le legge con UN lettore generico
  // che non conosce nessun nome di marca. Aggiungere un fornitore = aggiungere una voce a questo elenco (con la sua fonte),
  // non un ramo di codice. La famiglia si chiede a un apparato SOLO se il suo sysObjectID e' di quel fornitore: lo decide
  // `_baseApplies` del driver, derivando l'enterprise (PEN) dall'OID stesso della famiglia — nessun elenco di marche.
  //
  // Ogni famiglia: `id` stabile · `mib` (provenienza mostrata) · `tables` (una riga per indice) e/o `scalars` (oid + `.0`).
  // Una `table` ha `base` (l'entry della tabella), `cols` (numeri di colonna: label, value, limLo, limHi, state; `value` puo' essere
  // una LISTA in ordine di preferenza), `div` (valore e limiti sono in unita' piccole: millivolt → /1000), `states` (quale mappa di
  // stato usare), `valueMin` (sotto questo valore la riga non e' una misura: la MIB dichiara «0 = non disponibile»),
  // `multiIndex` (l'indice ha piu' parti, come jnxOperatingTable).
  // Quello che NON e' qui non ha una fonte letta: sta nell'elenco «non letto» in fondo, con la ragione.

  // Gli stati che l'apparato DICHIARA → il nostro vocabolario. Ogni mappa cita la MIB da cui viene l'enumerazione.
  const HEALTH_STATE_MAPS = {
    // CISCO-ENVMON-MIB, CiscoEnvMonState: normal(1) warning(2) critical(3) shutdown(4) notPresent(5) notFunctioning(6).
    'CISCO-ENVMON-MIB:CiscoEnvMonState': { 1: 'ok', 2: 'warning', 3: 'critical', 4: 'shutdown', 5: 'not_present', 6: 'not_functioning' },
    // JUNIPER-MIB, jnxOperatingState (testo della MIB): unknown(1) running(2) ready(3) reset(4) runningAtFullSpeed(5) down(6) standby(7).
    // `down` e' letteralmente «non sta funzionando»; `reset` non dice se sia un guasto o una ripartenza voluta: resta `unknown`.
    'JUNIPER-MIB:jnxOperatingState': { 1: 'unknown', 2: 'ok', 3: 'ok', 4: 'unknown', 5: 'ok', 6: 'not_functioning', 7: 'ok' },
  };
  function healthMapState(mapName, n) {
    const m = HEALTH_STATE_MAPS[mapName];
    return (m && m[n]) || 'unknown';
  }

  const _ENVMON = 'CISCO-ENVMON-MIB:CiscoEnvMonState';
  const HEALTH_SENSOR_FAMILIES = [
    // CISCO-ENVMON-MIB (1.3.6.1.4.1.9.9.13.1): voltage .2.1 (millivolt), temperature .3.1 (°C; la colonna .7 ammette i negativi),
    // fan .4.1 e supply .5.1 (solo stato). Il limite della temperatura (.4) e' quello «prima dell'arresto di emergenza».
    { id: 'cisco-envmon', mib: 'CISCO-ENVMON-MIB', tables: [
      { sid: 'temp',   kind: 'temperature', unit: '°C', label: 'Temperature', base: '1.3.6.1.4.1.9.9.13.1.3.1', cols: { label: 2, value: [7, 3], limHi: 4, state: 6 }, states: _ENVMON },
      { sid: 'volt',   kind: 'voltage',     unit: 'V',  label: 'Voltage',     base: '1.3.6.1.4.1.9.9.13.1.2.1', cols: { label: 2, value: 3, limLo: 4, limHi: 5, state: 7 }, div: 1000, states: _ENVMON },
      { sid: 'fan',    kind: 'fan',         unit: '',   label: 'Fan',         base: '1.3.6.1.4.1.9.9.13.1.4.1', cols: { label: 2, state: 3 }, states: _ENVMON },
      { sid: 'supply', kind: 'psu',         unit: '',   label: 'Power supply', base: '1.3.6.1.4.1.9.9.13.1.5.1', cols: { label: 2, state: 3 }, states: _ENVMON },
    ] },
    // JUNIPER-MIB jnxOperatingTable (1.3.6.1.4.1.2636.3.1.13.1): descr .5, stato .6, temperatura .7 (°C; la MIB dichiara «zero se
    // non disponibile o non applicabile», quindi `valueMin: 1`: un componente senza sensore non e' un sensore a zero gradi).
    // ⚠️ jnxFruTable (PSU, ventole) NON e' letta: le enumerazioni di jnxFruState e jnxFruType non si sono potute verificare.
    { id: 'juniper-operating', mib: 'JUNIPER-MIB', tables: [
      { sid: 'op', kind: 'temperature', unit: '°C', label: 'Component', base: '1.3.6.1.4.1.2636.3.1.13.1', multiIndex: true, cols: { label: 5, value: 7, state: 6 }, valueMin: 1, states: 'JUNIPER-MIB:jnxOperatingState' },
    ] },
    // MIKROTIK-MIB mtxrHealth (1.3.6.1.4.1.14988.1.1.3), scalari `.0`: Temperature e Voltage hanno DISPLAY-HINT d-1 → decimi.
    // ⚠️ mtxrGaugeTable e gli stati di alimentazione NON sono letti: stato di obsolescenza e significato non verificati.
    { id: 'mikrotik-health', mib: 'MIKROTIK-MIB', scalars: [
      { oid: '1.3.6.1.4.1.14988.1.1.3.10', sid: 'temp',      kind: 'temperature', unit: '°C',  div: 10, label: 'Temperature' },
      { oid: '1.3.6.1.4.1.14988.1.1.3.11', sid: 'cpu-temp',  kind: 'temperature', unit: '°C',  div: 10, label: 'CPU temperature' },
      { oid: '1.3.6.1.4.1.14988.1.1.3.5',  sid: 'chip-temp', kind: 'temperature', unit: '°C',  div: 10, label: 'Sensor chip temperature' },
      { oid: '1.3.6.1.4.1.14988.1.1.3.8',  sid: 'voltage',   kind: 'voltage',     unit: 'V',   div: 10, label: 'Voltage' },
      { oid: '1.3.6.1.4.1.14988.1.1.3.18', sid: 'fan2',      kind: 'fan',         unit: 'rpm', div: 1,  label: 'Fan 2 speed' },
    ] },
  ];
  // La radice di una famiglia: l'OID da cui si ricava il suo fornitore (il PEN sta dentro `1.3.6.1.4.1.<PEN>…`).
  function healthFamilyRoot(fam) { return fam.tables && fam.tables.length ? fam.tables[0].base : (fam.scalars && fam.scalars.length ? fam.scalars[0].oid : ''); }
  // Tutte le basi (colonne) da percorrere per le tabelle di una famiglia.
  function healthFamilyBases(fam) {
    const out = [];
    for (const t of (fam.tables || [])) for (const k of Object.keys(t.cols)) for (const c of [].concat(t.cols[k])) out.push(`${t.base}.${c}`);
    return out;
  }

  // Cio' che si e' DECISO di non leggere, e perche': serve a chi estende (e alla scheda, che lo dice).
  const HEALTH_SENSOR_NOT_READ = [
    'Juniper jnxFruTable (PSU, fans): jnxFruState / jnxFruType enumerations not verified from the MIB text',
    'MikroTik mtxrGaugeTable and the power-supply states: obsolescence and meaning not verified',
    'HP / Aruba: no source read',
    'device thresholds from CISCO-ENTITY-SENSOR-MIB entSensorThresholdTable: scale of the threshold value not verified',
  ];

  // ── Soglie dell'UTENTE (progetto) ────────────────────────────────────────────────────────
  // `{ temperature: { warn, crit }, ifErrors: { min } }`: la temperatura in °C, «alto = peggio»; `min` = di quanto deve salire
  // almeno UN contatore d'interfaccia fra due letture perche' l'interfaccia si segnali. E' una DICHIARAZIONE di chi usa l'app:
  // nessun valore di fabbrica, e un sensore che le supera e' `user_default`, mai presentato come dato dell'apparato.
  // `min` vale da 2: 1 e' «ogni aumento», cioe' nessuna soglia, e non si scrive. Un valore che non e' una soglia valida si CANCELLA.
  //
  // PER APPARATO: `nodes: { <idApparato>: { temperature?: { warn, crit }, ifErrors?: { min } } }`. E' un'ECCEZIONE a quelle del progetto,
  // campo per campo: un campo vuoto dell'apparato vale quello del progetto (`healthThresholdsFor`). Per l'apparato `min` puo' valere 1
  // (= «ogni aumento»), perche' li' ha senso: il progetto puo' chiedere 10 e un apparato di dorsale volerli tutti.
  const NODE_THR_MAX = 5000;   // quanti apparati con una soglia propria: un tetto sul file, non sul progetto
  // Una soglia di temperatura valida (°C, da -50 a 200) o null: l'UNICA definizione, per le soglie del progetto e per quelle degli apparati.
  function _limTemp(v) { const n = _fnum(v); return n !== null && n >= -50 && n <= 200 ? n : null; }
  function _sanTemp(t) {
    if (!t || typeof t !== 'object') return null;
    const warn = _limTemp(t.warn), crit = _limTemp(t.crit);
    return warn !== null || crit !== null ? { warn, crit } : null;
  }
  function _sanErr(e, lo) {
    if (!e || typeof e !== 'object') return null;
    const min = _int(e.min, lo, 1e9);
    return min !== null ? { min } : null;
  }
  function _sanNodes(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out = {};
    let n = 0;
    for (const id of Object.keys(raw)) {
      if (id === '__proto__' || !_ID_RE.test(id)) continue;
      const v = raw[id];
      if (!v || typeof v !== 'object') continue;
      const one = {};
      const t = _sanTemp(v.temperature), e = _sanErr(v.ifErrors, 1);
      if (t) one.temperature = t;
      if (e) one.ifErrors = e;
      if (!t && !e) continue;
      out[id] = one;
      if (++n >= NODE_THR_MAX) break;
    }
    return n ? out : null;
  }
  function healthSanitizeThresholds(raw) {
    const out = {};
    const o = raw && typeof raw === 'object' ? raw : null;
    const t = _sanTemp(o && o.temperature);
    if (t) out.temperature = t;
    const e = _sanErr(o && o.ifErrors, 2);
    if (e) out.ifErrors = e;
    const nodes = _sanNodes(o && o.nodes);
    if (nodes) out.nodes = nodes;
    return out;
  }

  // Le soglie che valgono per UN apparato: la sua, campo per campo, e dove non ne ha una la soglia del progetto. Il risultato ha la
  // forma di quello di `healthSanitizeThresholds` (senza `nodes`), quindi `healthSummarizeIf` e `healthSensorSeverity` non cambiano.
  // Qui `ifErrors.min` puo' valere 1 (l'apparato vuole ogni aumento): `_ifMin` lo legge come «nessuna soglia».
  function healthThresholdsFor(raw, nodeId) {
    const s = healthSanitizeThresholds(raw);
    const own = s.nodes && Object.prototype.hasOwnProperty.call(s.nodes, nodeId) ? s.nodes[nodeId] : null;
    const bt = s.temperature || { warn: null, crit: null }, ot = (own && own.temperature) || { warn: null, crit: null };
    const warn = ot.warn !== null ? ot.warn : bt.warn, crit = ot.crit !== null ? ot.crit : bt.crit;
    const min = own && own.ifErrors ? own.ifErrors.min : (s.ifErrors ? s.ifErrors.min : null);
    const out = {};
    if (warn !== null || crit !== null) out.temperature = { warn, crit };
    if (min !== null) out.ifErrors = { min };
    return out;
  }

  // Cambia UN campo di UN apparato ('warn' | 'crit' | 'ifmin') e rende le soglie ripulite. Un testo che non e' una soglia valida
  // CANCELLA il campo (come per il progetto: mai un valore inventato). `known` (un Set di id, facoltativo): gli apparati che non ci
  // sono piu' perdono la loro eccezione, cosi' un apparato cancellato non lascia soglie orfane.
  function healthThresholdsSetNode(raw, nodeId, key, text, known) {
    const s = healthSanitizeThresholds(raw);
    const id = String(nodeId === null || nodeId === undefined ? '' : nodeId);
    if (id === '__proto__' || !_ID_RE.test(id) || (key !== 'warn' && key !== 'crit' && key !== 'ifmin')) return s;
    const nodes = Object.assign({}, s.nodes || {});
    const cur = Object.prototype.hasOwnProperty.call(nodes, id) ? nodes[id] : {};
    const next = { temperature: cur.temperature, ifErrors: cur.ifErrors };
    if (key === 'ifmin') next.ifErrors = { min: text };
    else next.temperature = Object.assign({ warn: null, crit: null }, cur.temperature, { [key]: text });
    nodes[id] = next;
    return healthSanitizeThresholds({ temperature: s.temperature, ifErrors: s.ifErrors, nodes: _onlyKnown(nodes, known) });
  }
  // Toglie ogni eccezione di UN apparato: torna alle soglie del progetto.
  function healthThresholdsClearNode(raw, nodeId, known) {
    const s = healthSanitizeThresholds(raw);
    const nodes = Object.assign({}, s.nodes || {});
    if (Object.prototype.hasOwnProperty.call(nodes, String(nodeId))) delete nodes[String(nodeId)];
    return healthSanitizeThresholds({ temperature: s.temperature, ifErrors: s.ifErrors, nodes: _onlyKnown(nodes, known) });
  }
  function _onlyKnown(nodes, known) {
    if (!known || typeof known.has !== 'function') return nodes;
    const out = {};
    for (const id of Object.keys(nodes)) if (known.has(id)) out[id] = nodes[id];
    return out;
  }

  // Applica una modifica alle tolleranze: UNA definizione per l'anteprima («cosa succederebbe») e per la scrittura, cosi' le due non
  // possono divergere. `scope` = 'project' | 'node' (con `nodeId`); `fields` = { warn?, crit?, ifmin? }: si toccano solo le chiavi
  // presenti, e un testo che non e' una soglia valida CANCELLA il campo (mai un valore inventato). Per un APPARATO un valore UGUALE a
  // quello che erediterebbe dal progetto non e' un'eccezione: il campo si cancella e resta «come il progetto», cioe' segue il progetto
  // se questo cambia. Per il progetto `ifmin` vale da 2 (1 e' «ogni aumento», cioe' nessuna soglia); per l'apparato da 1.
  const _TOL_KEYS = ['warn', 'crit', 'ifmin'];
  function healthThresholdsApply(raw, scope, nodeId, fields, known) {
    let cur = healthSanitizeThresholds(raw);
    const f = fields && typeof fields === 'object' ? fields : {};
    const keys = _TOL_KEYS.filter(k => Object.prototype.hasOwnProperty.call(f, k));
    if (scope === 'project') {
      const t = Object.assign({ warn: null, crit: null }, cur.temperature);
      let e = cur.ifErrors ? { min: cur.ifErrors.min } : null;
      for (const k of keys) { if (k === 'ifmin') e = { min: f[k] }; else t[k] = f[k]; }
      return healthSanitizeThresholds({ temperature: t, ifErrors: e, nodes: _onlyKnown(cur.nodes || {}, known) });
    }
    if (scope !== 'node') return cur;
    for (const k of keys) {
      const norm = k === 'ifmin' ? _int(f[k], 1, 1e9) : _limTemp(f[k]);
      const inherited = k === 'ifmin' ? (cur.ifErrors ? cur.ifErrors.min : null) : (cur.temperature ? cur.temperature[k] : null);
      cur = healthThresholdsSetNode(cur, nodeId, k, norm !== null && norm === inherited ? '' : f[k], known);
    }
    return cur;
  }

  // Il modello della SCALA della temperatura (la barra del pannello «Tolleranza»): numeri e percentuali, nessun HTML. `o` = { value,
  // warn, crit, projectWarn }. Le zone vanno da «a posto» ad «avviso» a «critica» con le stesse regole di `healthSensorSeverity`
  // (la critica vince; se l'avviso e' sopra la critica la zona d'avviso e' vuota). I segni: «ora», avviso, critica e, se diverso
  // dall'avviso dell'apparato, quello del progetto.
  function healthScaleModel(o) {
    const x = o || {};
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const value = num(x.value), warn0 = num(x.warn), crit = num(x.crit), pw = num(x.projectWarn);
    const nums = [value, warn0, crit, pw].filter(v => v !== null);
    const lo = Math.floor((Math.min(20, ...nums) - 5) / 10) * 10, hi = Math.ceil((Math.max(80, ...nums) + 5) / 10) * 10;
    const pct = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    const warn = warn0 !== null && crit !== null && warn0 >= crit ? crit : warn0;
    const zones = [];
    const okTo = warn !== null ? warn : (crit !== null ? crit : hi);
    zones.push({ kind: 'ok', from: 0, to: pct(okTo) });
    if (warn !== null) zones.push({ kind: 'warn', from: pct(warn), to: pct(crit !== null ? crit : hi) });
    if (crit !== null) zones.push({ kind: 'crit', from: pct(crit), to: 100 });
    const marks = [];
    if (value !== null) marks.push({ kind: 'now', at: pct(value), value });
    if (warn0 !== null) marks.push({ kind: 'warn', at: pct(warn0), value: warn0 });
    if (crit !== null) marks.push({ kind: 'crit', at: pct(crit), value: crit });
    if (pw !== null && pw !== warn0) marks.push({ kind: 'project', at: pct(pw), value: pw });
    return { lo, hi, zones, marks };
  }

  // La gravita' di UN sensore: da dove viene e perche'. Ordine: lo stato dell'apparato, poi i limiti dell'apparato,
  // poi (solo se l'apparato non dice niente) la soglia dell'utente. Un valore non letto non ha gravita'.
  function healthSensorSeverity(row, thr) {
    const none = { severity: null, source: null, why: null };
    if (!row) return none;
    if (row.state === 'critical' || row.state === 'shutdown' || row.state === 'not_functioning') return { severity: 'crit', source: 'device', why: 'state' };
    if (row.state === 'warning') return { severity: 'warn', source: 'device', why: 'state' };
    if (row.value === null || row.state === 'not_present' || row.state === 'unavailable' || row.state === 'nonoperational') return none;
    if (row.limHi !== null && row.value > row.limHi) return { severity: 'crit', source: 'device', why: 'limit' };
    if (row.limLo !== null && row.value < row.limLo) return { severity: 'crit', source: 'device', why: 'limit' };
    const t = thr && thr[row.kind];
    if (t) {
      if (t.crit !== null && t.crit !== undefined && row.value >= t.crit) return { severity: 'crit', source: 'user_default', why: 'threshold' };
      if (t.warn !== null && t.warn !== undefined && row.value >= t.warn) return { severity: 'warn', source: 'user_default', why: 'threshold' };
    }
    return none;
  }

  const _SEV_ORDER = { crit: 0, warn: 1 };
  // Una lettura (dell'ora) → cio' che la scheda e il Drift mostrano. `thr` = soglie dell'utente (già ripulite).
  //   not_read       il passo dei sensori non c'e' (lettura vecchia o fallita): non si dice niente
  //   not_available  l'apparato ha risposto e NON pubblica sensori (una VM, un apparato senza hardware di misura)
  //   read           ci sono sensori; ognuno con la sua gravita' (e da chi viene)
  function healthSummarizeSensors(reading, thr) {
    const counts = { total: 0, crit: 0, warn: 0, unavailable: 0, absent: 0 };
    if (!reading || !Array.isArray(reading.sensors)) return { state: 'not_read', at: reading && reading.at ? reading.at : null, items: [], counts };
    const items = reading.sensors.map(r => Object.assign({}, r, healthSensorSeverity(r, thr)));
    // Ordine: prima la gravita' (critici, avvisi); poi per TIPO nell'ordine di HEALTH_SENSOR_KINDS (temperatura, ventole, alimentatori,
    // tensioni, correnti, potenze, altro: quello che serve a un amministratore, non l'ordine alfabetico dei nomi dei tipi); dentro la
    // temperatura il piu' CALDO prima (un sensore non letto in fondo), dentro gli altri tipi per nome con i numeri come numeri. Misurato
    // su una registrazione vera (uno switch con 226 sensori, 35 temperature dei moduli ottici fra 22 e 39 °C e 12 dell'apparato fra
    // 24 e 65): l'ordine alfabetico metteva le correnti dei moduli prima delle temperature dell'apparato; il piu' caldo prima mette
    // l'apparato in cima senza guardare nessun nome.
    const kindRank = (k) => { const i = HEALTH_SENSOR_KINDS.indexOf(k); return i < 0 ? HEALTH_SENSOR_KINDS.length : i; };
    const hotFirst = (a, b) => {
      if (a.kind !== 'temperature' || b.kind !== 'temperature') return 0;
      if (a.value === null || b.value === null) return a.value === b.value ? 0 : (a.value === null ? 1 : -1);
      return b.value - a.value;
    };
    items.sort((a, b) => {
      const sa = a.severity ? _SEV_ORDER[a.severity] : 9, sb = b.severity ? _SEV_ORDER[b.severity] : 9;
      return sa - sb || kindRank(a.kind) - kindRank(b.kind) || hotFirst(a, b) || a.label.localeCompare(b.label, undefined, { numeric: true });
    });
    for (const it of items) {
      counts.total++;
      if (it.severity === 'crit') counts.crit++;
      else if (it.severity === 'warn') counts.warn++;
      if (it.value === null) counts.unavailable++;
      if (it.state === 'not_present') counts.absent++;
    }
    return { state: items.length ? 'read' : 'not_available', at: reading.at, items, counts };
  }

  // Le righe PIATTE dei sensori di tutto il file (apparato + istante in ogni riga): la tabella che un database avrebbe.
  function healthFlatSensorRows(file) {
    const rows = [];
    const dec = healthDecodeFile(file);
    for (const node of Object.keys(dec)) {
      const rd = dec[node].cur;
      if (!rd || !Array.isArray(rd.sensors)) continue;
      for (const r of rd.sensors) rows.push(Object.assign({ node, at: rd.at }, r));
    }
    return rows;
  }

  return {
    HEALTH_FILE_VERSION, HEALTH_IF_COLUMNS, HEALTH_IF_COUNTERS, HEALTH_IF_OIDS, HEALTH_IF_NAME_OID, HEALTH_IF_DESCR_OID, HEALTH_SYS_UPTIME,
    healthIfProvenance, healthReading, healthSanitizePut, healthFold, healthDecodeFile, healthFlatRows, healthSummarizeIf,
    HEALTH_SENSOR_COLUMNS, HEALTH_SENSOR_KINDS, HEALTH_SENSOR_STATES, HEALTH_ENT_SENSOR_BASE, HEALTH_ENT_SENSOR_COLS, HEALTH_ENT_PHYS_NAME, HEALTH_ENT_PHYS_DESCR,
    HEALTH_STATE_MAPS, HEALTH_SENSOR_FAMILIES, HEALTH_SENSOR_NOT_READ,
    healthEntityType, healthEntityStatus, healthEntityValue, healthMapState, healthFamilyRoot, healthFamilyBases,
    healthSanitizeThresholds, healthThresholdsFor, healthThresholdsSetNode, healthThresholdsClearNode, healthThresholdsApply, healthScaleModel, healthSensorSeverity, healthSummarizeSensors, healthFlatSensorRows,
    // Le primitive di pulizia, UNA definizione sola: le usa anche lib/neighbor-store.js (un numero non e' un array, un nome non ha controlli).
    healthClean: { toNum: _toNum, int: _int, fnum: _fnum, name: _name, ID_RE: _ID_RE },
  };
});
