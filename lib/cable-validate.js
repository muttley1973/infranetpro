// ============================================================
// CABLE VALIDATE — validazioni smart incompatibilità (P1.4)
// ============================================================
// Funzione PURA: dato un link (cavo) + contesto SNMP opzionale, ritorna una
// lista di problemi { level:'error'|'warn', code, variant?, params? }. NESSUNA
// parola: la lib dice QUALE norma non torna e con quali numeri, la frase la
// compone il renderer via i18n (chiavi `cbl.<code>[.<variant>].t/.w`). Il testo
// reso resta EDUCATIVO — spiega il PERCHE' (norma/standard), non solo il blocco —
// ma ora esiste in ogni lingua dell'app, non solo in italiano.
// Nessun accesso a DOM/state: input espliciti → output. UMD-lite (browser+test).
//
// Campi link usati: medium ('copper'|'fiber'|'dac'), cableCategory (Cat5e..Cat8,
// OS2/OM3/OM4/OM5), connector (RJ45/LC/SC/MPO|MTP/SFP..), maxSpeed
// ('100M'..'400G'), poe ('none'|'802.3af'|'802.3at'|'802.3bt'), length|lengthM (m).
// opts: { snmpSpeedMbps, snmpMedium } per il cross-check realtà↔documentazione.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FIBER_CATS = ['OS2', 'OM3', 'OM4', 'OM5'];
  const COPPER_CATS = ['Cat5e', 'Cat6', 'Cat6A', 'Cat7', 'Cat8'];
  const FIBER_CONNECTORS = ['LC', 'SC', 'MPO/MTP'];
  // Velocità garantita per categoria rame a 100m (Mbps). 802.3bz (NBASE-T):
  // 2.5G su Cat5e, 5G su Cat6; 10G richiede Cat6A (Cat6 solo ≤55m); Cat8 → 40G a 30m.
  const COPPER_CAT_MAX = { Cat5e: 2500, Cat6: 5000, 'Cat6A': 10000, Cat7: 10000, Cat8: 40000 };
  // Lunghezza massima di CANALE (m) quando la reach della categoria è < 100m:
  // Cat8 (Classe I/II) è specificata solo fino a 30m per 25/40GBASE-T. Le altre
  // categorie reggono 100m alla loro velocità nominale (il caso 10G@Cat6→55m è
  // già coperto dalla regola #3 speed-cat, quindi non serve qui).
  const COPPER_CAT_MAXLEN = { Cat8: 30 };
  const SPEED_MBPS = { '100M': 100, '1G': 1000, '2.5G': 2500, '5G': 5000, '10G': 10000, '25G': 25000, '40G': 40000, '100G': 100000, '400G': 400000 };

  function _speedMbps(s) { return SPEED_MBPS[String(s || '').trim()] || 0; }
  function _mbpsLabel(m) {
    if (!m) return '';
    if (m >= 1000) return (m % 1000 === 0 ? (m / 1000) : (m / 1000).toFixed(1).replace(/\.0$/, '')) + 'G';
    return m + 'M';
  }
  // Categoria rame minima che regge la velocità (per il consiglio educativo).
  function _minCatFor(mbps) {
    const order = ['Cat5e', 'Cat6', 'Cat6A', 'Cat7', 'Cat8'];
    for (const c of order) if (COPPER_CAT_MAX[c] >= mbps) return c;
    return null; // oltre il rame
  }

  function validateCable(link, opts) {
    const l = link || {};
    opts = opts || {};
    const out = [];
    const med = l.medium || '';
    const cat = l.cableCategory || '';
    const conn = l.connector || '';
    const poe = l.poe && l.poe !== 'none' ? l.poe : '';
    const len = Number(l.length != null ? l.length : l.lengthM);
    const hasLen = Number.isFinite(len) && len > 0;
    const speed = _speedMbps(l.maxSpeed);

    // 1) Mezzo ↔ categoria incoerenti. Stesso `code` (la classe di errore), due
    //    `variant` (il verso dello sbaglio): i chiamanti che filtrano per code
    //    continuano a funzionare, il renderer sceglie la frase giusta.
    if (med === 'copper' && FIBER_CATS.includes(cat)) {
      out.push({ level: 'error', code: 'medium-cat', variant: 'fiberOnCopper', params: { cat } });
    }
    if (med === 'fiber' && COPPER_CATS.includes(cat)) {
      out.push({ level: 'error', code: 'medium-cat', variant: 'copperOnFiber', params: { cat } });
    }

    // 2) Mezzo ↔ connettore incoerenti
    if (med === 'copper' && FIBER_CONNECTORS.includes(conn)) {
      out.push({ level: 'error', code: 'medium-conn', variant: 'fiberConnOnCopper', params: { conn } });
    }
    if (med === 'fiber' && conn === 'RJ45') {
      out.push({ level: 'error', code: 'medium-conn', variant: 'rj45OnFiber' });
    }

    // 3) Velocità oltre la categoria del rame (es. 10G su Cat5e/Cat6)
    if (med === 'copper' && speed && COPPER_CAT_MAX[cat] && speed > COPPER_CAT_MAX[cat]) {
      const rec = _minCatFor(speed);
      // Reach REALE della categoria (Cat8 = 30m per 25/40GBASE-T, non 100m): il
      // messaggio prima diceva sempre "a 100m", errato per le categorie a corto raggio.
      const catReach = COPPER_CAT_MAXLEN[cat] || 100;
      const recReach = rec ? (COPPER_CAT_MAXLEN[rec] || 100) : 100;
      // `tail` non e' piu' una frase ma la SCELTA della frase: quale categoria
      // consigliare, o che il rame non ci arriva affatto.
      out.push({
        level: 'warn', code: 'speed-cat',
        params: {
          speed: l.maxSpeed, cat, catMax: _mbpsLabel(COPPER_CAT_MAX[cat]), catReach,
          rec: rec || '', recReach,
          tail: rec ? ((cat === 'Cat6' && speed === 10000) ? 'recCat6' : 'rec') : 'noCopper',
        },
      });
    }

    // 4) Lunghezza rame > 100m (TIA-568)
    if (med === 'copper' && hasLen && len > 100) {
      out.push({ level: 'warn', code: 'copper-length', params: { len } });
    }

    // 4b) Categoria a reach corta oltre la sua lunghezza massima (oggi: Cat8 → 30m).
    //     Solo entro i 100m: oltre, è la regola #4 (canale TIA-568) a parlare.
    if (med === 'copper' && hasLen && COPPER_CAT_MAXLEN[cat] && len > COPPER_CAT_MAXLEN[cat] && len <= 100) {
      out.push({ level: 'warn', code: 'cat-reach', params: { cat, len, max: COPPER_CAT_MAXLEN[cat] } });
    }

    // 5) DAC troppo lungo
    if (med === 'dac' && hasLen && len > 10) {
      out.push({ level: 'warn', code: 'dac-length', params: { len } });
    }

    // 6) PoE su fibra (impossibile)
    if (poe && med === 'fiber') {
      out.push({ level: 'error', code: 'poe-fiber' });
    }

    // 7) 802.3bt (PoE++) su Cat5e (marginale)
    if (poe === '802.3bt' && med === 'copper' && cat === 'Cat5e') {
      out.push({ level: 'warn', code: 'poe-cat' });
    }

    // 8) Cross-check realtà↔doc: la porta negozia più del cavo dichiarato
    const snmpMbps = Number(opts.snmpSpeedMbps) || 0;
    if (speed && snmpMbps && snmpMbps > speed) {
      out.push({ level: 'warn', code: 'speed-vs-snmp', params: { real: _mbpsLabel(snmpMbps), doc: l.maxSpeed } });
    }

    // 9) Cross-check mezzo: SNMP vede un mezzo diverso da quello documentato.
    //    I due mezzi viaggiano come CHIAVI (copper/fiber/dac): «Rame»/«Fibra»
    //    sono parole, e le parole stanno nel renderer.
    const snmpMed = opts.snmpMedium || '';
    if (med && snmpMed && med !== snmpMed) {
      out.push({ level: 'warn', code: 'medium-vs-snmp', params: { snmp: snmpMed, doc: med } });
    }

    // 10) Native VLAN mismatch su trunk fra due apparati attivi (switch↔switch):
    //     su un device reale è un errore (loop/leak di traffico untagged).
    const sn = parseInt(opts.srcNative, 10), dn = parseInt(opts.dstNative, 10);
    if (opts.isTrunk && sn >= 1 && dn >= 1 && sn !== dn) {
      out.push({ level: 'error', code: 'native-mismatch', params: { a: sn, b: dn } });
    }

    return out;
  }

  return { validateCable };
});
