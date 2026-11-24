// ============================================================
// PORT LIVE — la lettura DAL VIVO di UNA porta (IF-MIB, EtherLike-MIB), pura
// ============================================================
// Quando si clicca la porta di uno switch il pannello puo' chiedere all'apparato COME STA
// ADESSO: quanto traffico passa, se ci sono errori, da quando e' in questo stato. Questo
// modulo e' la parte che non tocca la rete: dice QUALI colonne si leggono e trasforma due
// letture ravvicinate in cio' che si mostra. Il driver (`drivers/snmp.js`, `pollPort`) fa i
// GET e consegna i grezzi qui; il pannello (`src/app-port-live.js`) disegna il risultato.
//
// ── Perche' NON si salva nel progetto ───────────────────────────────────────────
// I contatori sono CUMULATIVI dall'avvio e cambiano a ogni secondo: un numero salvato col
// Sync di ore fa sembra attuale e non lo e'. Salvare ~25 misure per porta gonfierebbe il
// JSON, andrebbe classificato per l'export e scadrebbe. Letti al clic, dicono la verita'
// di ADESSO e non lasciano niente in giro (stessa scelta di `/api/poll-power` per gli UPS).
//
// ── Cio' che si dichiara (paletto ②: niente invenzioni) ────────────────────────
//   • una colonna che l'apparato non pubblica vale `null` = «non letto», MAI zero;
//   • la velocita' attuale si calcola solo da DUE letture dello stesso apparato con la
//     stessa base dei contatori; se i contatori sono stati azzerati nel frattempo, o se
//     calano, la velocita' non si dice;
//   • nessuna SOGLIA inventata: un valore e' «cresciuto» se fra le due letture e' salito,
//     e basta. Le collisioni singole/multiple/differite non contano: in half duplex sono
//     normali, non un guasto.
//
// UMD-lite come le altre lib pure: Node require(), nel bundle `import`, <script> in browser.
// Nessuna dipendenza, nessun DOM.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // Node (driver, test)
  if (typeof window !== 'undefined') Object.assign(window, api);               // browser (<script>)
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SYS_UPTIME = '1.3.6.1.2.1.1.3.0';

  // Colonne per PORTA: base OID, a cui il driver aggiunge «.<ifIndex>». L'ORDINE conta: il
  // driver le legge a gruppi nell'ordine dato, e `sysUpTime` (scalare) sta nel primo gruppo
  // insieme ai contatori di traffico, cosi' il tempo e i byte sono presi quasi nello stesso istante.
  const IF = '1.3.6.1.2.1.2.2.1.';          // IF-MIB ifTable
  const IFX = '1.3.6.1.2.1.31.1.1.1.';      // IF-MIB ifXTable
  const DOT3 = '1.3.6.1.2.1.10.7.2.1.';     // EtherLike-MIB dot3StatsTable
  const PAUSE = '1.3.6.1.2.1.10.7.10.1.';   // EtherLike-MIB dot3PauseTable
  const PORT_COLUMNS = {
    hcInOctets: IFX + '6',   hcOutOctets: IFX + '10',
    hcInUcast:  IFX + '7',   hcOutUcast:  IFX + '11',
    hcInMulti:  IFX + '8',   hcOutMulti:  IFX + '12',
    hcInBcast:  IFX + '9',   hcOutBcast:  IFX + '13',
    oper:       IF + '8',    admin:       IF + '7',    lastChange: IF + '9',
    inOctets32: IF + '10',   outOctets32: IF + '16',
    inErrors:   IF + '14',   outErrors:   IF + '20',
    inDiscards: IF + '13',   outDiscards: IF + '19',
    inUnknown:  IF + '15',   discontinuity: IFX + '19',
    mtu:        IF + '4',    speed:       IF + '5',    highSpeed: IFX + '15',
    duplex:     DOT3 + '19',
    fcs:        DOT3 + '3',  align:       DOT3 + '2',  symbol: DOT3 + '18',
    tooLong:    DOT3 + '13', macRx:       DOT3 + '16', macTx:  DOT3 + '10',
    late:       DOT3 + '8',  excessive:   DOT3 + '9',  carrier: DOT3 + '11',
    single:     DOT3 + '4',  multiple:    DOT3 + '5',  deferred: DOT3 + '7',
    pauseIn:    PAUSE + '3', pauseOut:    PAUSE + '4',
  };
  const PORT_KEYS = Object.keys(PORT_COLUMNS);

  // Quante colonne per ogni GET: pochi OID per richiesta, perche' alcuni agenti rifiutano i pacchetti grandi
  // e perche' un solo rifiuto non deve far perdere tutta la lettura.
  const GET_CHUNK = 10;

  // I valori «in errore»: se uno SALE fra le due letture, il pannello lo segna. Le collisioni singole,
  // multiple e differite NON ci sono: in half duplex sono il funzionamento normale del mezzo.
  const ERROR_KEYS = ['inErrors', 'outErrors', 'inDiscards', 'outDiscards'];
  const DETAIL_KEYS = ['fcs', 'align', 'symbol', 'tooLong', 'macRx', 'macTx', 'late', 'excessive', 'carrier',
                       'single', 'multiple', 'deferred'];
  const WATCH_KEYS = ERROR_KEYS.concat(['fcs', 'align', 'symbol', 'tooLong', 'macRx', 'macTx', 'late', 'excessive', 'carrier']);

  const MAX32 = 4294967296;

  // Un valore SNMP grezzo → numero, o null se non e' un contatore leggibile.
  // I Counter64 arrivano come Buffer di lunghezza variabile (gli zeri iniziali non si mandano): si leggono
  // come intero grande. Oltre 2^53 (9 PB) la precisione cala di qualche unita': per un contatore di byte e'
  // irrilevante, e una differenza fra due letture ravvicinate resta esatta nell'ordine che si mostra.
  function counterValue(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
    if (typeof v === 'bigint') return v >= 0 ? Number(v) : null;
    if (typeof v === 'string') return /^\d{1,20}$/.test(v.trim()) ? Number(v.trim()) : null;
    if (typeof v === 'object' && typeof v.length === 'number') {
      if (v.length === 0 || v.length > 9) return null;
      let n = 0;
      for (let i = 0; i < v.length; i++) n = n * 256 + (v[i] & 255);
      return n;
    }
    return null;
  }

  // Quanto e' salito un contatore fra due letture. Un contatore a 32 bit che e' calato ha fatto un giro
  // (si somma il modulo); uno a 64 bit che cala e' stato AZZERATO, e non se ne dice niente.
  function counterDelta(prev, cur, bits) {
    if (prev == null || cur == null) return null;
    if (cur >= prev) return cur - prev;
    if (bits === 32) return cur + MAX32 - prev;
    return null;
  }

  const OPER = { 1: 'up', 2: 'down', 3: 'testing', 4: 'unknown', 5: 'dormant', 6: 'notPresent', 7: 'lowerLayerDown' };
  const ADMIN = { 1: 'up', 2: 'down', 3: 'testing' };
  const DUPLEX = { 2: 'half', 3: 'full' };   // 1 = unknown (porta giu' o agente che non lo sa): resta null

  // Velocita' del link in Mbit/s: ifHighSpeed e' gia' in Mbit/s; ifSpeed e' in bit/s e SATURA a 4294967295
  // oltre i 4 Gbit/s (allora non dice niente). 0 vuol dire «ignota», non «zero».
  function speedMbps(v) {
    const hs = v.highSpeed;
    if (hs != null && hs > 0) return hs;
    const sp = v.speed;
    if (sp != null && sp > 0 && sp !== MAX32 - 1) return sp / 1e6;
    return null;
  }

  function spanSeconds(s0, s1) {
    if (!s1) return null;
    const a = s0 && s0.upCs, b = s1 && s1.upCs;
    if (typeof a === 'number' && typeof b === 'number' && b > a) return (b - a) / 100;
    const ta = s0 && s0.at, tb = s1 && s1.at;
    if (typeof ta === 'number' && typeof tb === 'number' && tb > ta) return (tb - ta) / 1000;
    return null;
  }

  // Due letture → quello che il pannello mostra. `samples` = [{upCs, at, v:{chiave:numero|null}}, ...]; la
  // PRIMA e' la base per le differenze, l'ULTIMA e' lo stato mostrato. Con una sola lettura non ci sono velocita'.
  function summarizePortLive(samples) {
    const s0 = samples && samples[0];
    if (!s0 || !s0.v) return { answered: false };
    const s1 = samples.length > 1 ? samples[samples.length - 1] : null;
    const cur = s1 && s1.v ? s1 : s0;
    const v = cur.v;
    const answered = PORT_KEYS.some(k => v[k] != null);
    if (!answered) return { answered: false };

    const span = spanSeconds(s0, s1 && s1.v ? s1 : null);
    // Contatori azzerati nel mezzo della misura: le differenze non valgono.
    const reset = !!(s1 && s1.v && s0.v.discontinuity != null && s1.v.discontinuity != null
                     && s0.v.discontinuity !== s1.v.discontinuity);
    const usable = !!(span && span >= 0.5 && !reset);
    const d = (key, bits) => (usable ? counterDelta(s0.v[key], v[key], bits) : null);

    // Traffico. I contatori a 64 bit se ci sono tutti e due; altrimenti quelli a 32 (che a 1 Gbit/s fanno un
    // giro in mezzo minuto: la differenza di pochi secondi resta valida, il totale NO e lo si dice).
    const hc = v.hcInOctets != null && v.hcOutOctets != null;
    const c32 = !hc && v.inOctets32 != null && v.outOctets32 != null;
    const bits = hc ? 64 : (c32 ? 32 : null);
    const kIn = hc ? 'hcInOctets' : 'inOctets32', kOut = hc ? 'hcOutOctets' : 'outOctets32';
    const dIn = bits ? d(kIn, bits) : null, dOut = bits ? d(kOut, bits) : null;
    const mbps = speedMbps(v);
    const linkUp = OPER[v.oper] === 'up';
    const util = (delta) => (delta != null && mbps && linkUp ? Math.min(100, (delta * 8) / span / (mbps * 1e6) * 100) : null);
    const sumPk = (keys, pick) => {
      if (v[keys[0]] == null) return null;
      let tot = 0;
      for (const k of keys) { const x = pick(k); if (x != null) tot += x; }
      return tot;
    };
    const pkIn = ['hcInUcast', 'hcInMulti', 'hcInBcast'], pkOut = ['hcOutUcast', 'hcOutMulti', 'hcOutBcast'];
    // Byte che passano e ZERO pacchetti non e' un fatto, e' un agente che conta gli uni e non gli altri (misurato
    // sulla vmnic di un host ESXi: 2 MB, 0 pacchetti): si dice «non letto» invece di scrivere uno zero che mente.
    const pkts = (keys, bytes) => { const p = sumPk(keys, k => v[k]); return (p === 0 && bytes > 0) ? null : p; };
    const pIn = pkts(pkIn, bits ? v[kIn] : 0), pOut = pkts(pkOut, bits ? v[kOut] : 0);
    const dpIn = usable && pIn != null ? sumPk(pkIn, k => counterDelta(s0.v[k], v[k], 64)) : null;
    const dpOut = usable && pOut != null ? sumPk(pkOut, k => counterDelta(s0.v[k], v[k], 64)) : null;
    const traffic = {
      bits,
      inBytes: bits ? v[kIn] : null, outBytes: bits ? v[kOut] : null,
      inPkts: pIn, outPkts: pOut,
      inBps: dIn != null ? dIn * 8 / span : null, outBps: dOut != null ? dOut * 8 / span : null,
      inPps: dpIn != null ? dpIn / span : null, outPps: dpOut != null ? dpOut / span : null,
      inUtil: util(dIn), outUtil: util(dOut),
      spanS: usable ? span : null,
      reset,
    };

    // Errori e scarti, e il dettaglio EtherLike (solo cio' che non e' zero).
    const grew = [], deltas = {};
    const errors = { answered: ERROR_KEYS.some(k => v[k] != null), detail: [], grew, deltas };
    for (const k of ERROR_KEYS) errors[k] = v[k] != null ? v[k] : null;
    errors.unknownProtos = v.inUnknown != null ? v.inUnknown : null;
    // Un contatore di errori che CALA fra due letture a pochi secondi e' stato azzerato, non ha fatto un giro: niente differenza.
    for (const k of WATCH_KEYS) { const dk = d(k, 64); if (dk != null && dk > 0) { grew.push(k); deltas[k] = dk; } }
    for (const k of DETAIL_KEYS) {
      if (v[k] == null || v[k] <= 0) continue;
      const dk = d(k, 64);
      errors.detail.push({ key: k, value: v[k], delta: dk });
    }
    errors.any = ERROR_KEYS.some(k => v[k] > 0) || errors.detail.length > 0;

    // Stato: da quanto tempo la porta e' cosi'. ifLastChange e' il sysUpTime dell'ultimo cambio; 0 = «da prima
    // dell'avvio della gestione», cioe' dall'avvio. Se e' PIU' GRANDE di sysUpTime il contatore dei tick ha fatto
    // un giro (~497 giorni) e il dato non e' piu' attendibile.
    let sinceSec = null, sinceBoot = false;
    if (v.lastChange != null && typeof cur.upCs === 'number') {
      if (v.lastChange === 0) { sinceSec = cur.upCs / 100; sinceBoot = true; }
      else if (v.lastChange <= cur.upCs) sinceSec = (cur.upCs - v.lastChange) / 100;
    }
    return {
      answered: true,
      oper: v.oper != null ? (OPER[v.oper] || 'unknown') : null,
      admin: v.admin != null ? (ADMIN[v.admin] || null) : null,
      sinceSec, sinceBoot,
      uptimeSec: typeof cur.upCs === 'number' ? cur.upCs / 100 : null,
      speedMbps: mbps,
      mtu: v.mtu != null && v.mtu > 0 ? v.mtu : null,
      duplex: v.duplex != null ? (DUPLEX[v.duplex] || null) : null,
      traffic, errors,
      pause: (v.pauseIn != null || v.pauseOut != null) ? { in: v.pauseIn, out: v.pauseOut } : null,
    };
  }

  // ── Scale per mostrare i numeri (nessuna lingua qui: la formattazione del numero e' del pannello) ──
  function _scale(n, units, step) {
    let x = Math.abs(n), i = 0;
    while (x >= step && i < units.length - 1) { x /= step; i++; }
    return { value: x, unit: units[i] };
  }
  const scaleBytes = n => _scale(n, ['B', 'kB', 'MB', 'GB', 'TB', 'PB'], 1000);
  const scaleBits = n => _scale(n, ['bit/s', 'kbit/s', 'Mbit/s', 'Gbit/s', 'Tbit/s'], 1000);
  const scaleCount = n => _scale(n, ['', 'k', 'M', 'G', 'T'], 1000);
  function scaleDuration(sec) {
    if (sec < 90) return { value: Math.round(sec), unit: 's' };
    if (sec < 5400) return { value: sec / 60, unit: 'min' };
    if (sec < 129600) return { value: sec / 3600, unit: 'h' };
    return { value: sec / 86400, unit: 'd' };
  }

  return {
    SYS_UPTIME, PORT_COLUMNS, PORT_KEYS, GET_CHUNK, ERROR_KEYS, DETAIL_KEYS, WATCH_KEYS,
    counterValue, counterDelta, speedMbps, summarizePortLive,
    scaleBytes, scaleBits, scaleCount, scaleDuration,
  };
});
