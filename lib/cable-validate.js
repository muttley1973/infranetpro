// ============================================================
// CABLE VALIDATE — validazioni smart incompatibilità (P1.4)
// ============================================================
// Funzione PURA: dato un link (cavo) + contesto SNMP opzionale, ritorna una
// lista di problemi { level:'error'|'warn', code, title, why }. Il campo `why`
// e' EDUCATIVO: spiega il PERCHE' (norma/standard), non solo il blocco — cosi'
// lo strumento insegna invece di limitarsi a vietare. Nessun accesso a
// DOM/state: input espliciti → output. Condiviso browser + test (UMD-lite).
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
  const SPEED_MBPS = { '100M': 100, '1G': 1000, '2.5G': 2500, '5G': 5000, '10G': 10000, '25G': 25000, '40G': 40000, '100G': 100000, '400G': 400000 };

  function _speedMbps(s) { return SPEED_MBPS[String(s || '').trim()] || 0; }
  function _mbpsLabel(m) {
    if (!m) return '';
    if (m >= 1000) return (m % 1000 === 0 ? (m / 1000) : (m / 1000).toFixed(1).replace(/\.0$/, '')) + 'G';
    return m + 'M';
  }
  // Categoria rame minima che regge la velocità (per il consiglio educativo).
  function _minCatFor(mbps) {
    const order = ['Cat5e', 'Cat6', 'Cat6A', 'Cat8'];
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

    // 1) Mezzo ↔ categoria incoerenti
    if (med === 'copper' && FIBER_CATS.includes(cat)) {
      out.push({ level: 'error', code: 'medium-cat', title: 'Categoria fibra su mezzo rame',
        why: `${cat} è una fibra ottica, ma il Mezzo è impostato su Rame. Imposta Mezzo = Fibra oppure scegli una categoria Cat (rame).` });
    }
    if (med === 'fiber' && COPPER_CATS.includes(cat)) {
      out.push({ level: 'error', code: 'medium-cat', title: 'Categoria rame su mezzo fibra',
        why: `${cat} è una categoria di rame, ma il Mezzo è Fibra. Usa una categoria ottica (OS2/OM3/OM4/OM5) o cambia il Mezzo.` });
    }

    // 2) Mezzo ↔ connettore incoerenti
    if (med === 'copper' && FIBER_CONNECTORS.includes(conn)) {
      out.push({ level: 'error', code: 'medium-conn', title: 'Connettore ottico su rame',
        why: `${conn} è un connettore per fibra ottica; su rame si termina con RJ45. Verifica Mezzo o Connettore.` });
    }
    if (med === 'fiber' && conn === 'RJ45') {
      out.push({ level: 'error', code: 'medium-conn', title: 'RJ45 su fibra',
        why: 'Il connettore RJ45 termina il rame, non una fibra ottica. Su fibra si usa LC, SC o MPO/MTP.' });
    }

    // 3) Velocità oltre la categoria del rame (es. 10G su Cat5e/Cat6)
    if (med === 'copper' && speed && COPPER_CAT_MAX[cat] && speed > COPPER_CAT_MAX[cat]) {
      const rec = _minCatFor(speed);
      const tail = rec
        ? `Per ${l.maxSpeed} a 100m serve ${rec}${cat === 'Cat6' && speed === 10000 ? ' (su Cat6 il 10G regge solo fino a ~55m)' : ''}.`
        : `Questa velocità non è supportata su rame: usa fibra o DAC.`;
      out.push({ level: 'warn', code: 'speed-cat', title: 'Velocità oltre la categoria del cavo',
        why: `${l.maxSpeed} su ${cat}: la categoria garantisce fino a ${_mbpsLabel(COPPER_CAT_MAX[cat])} a 100m. ${tail}` });
    }

    // 4) Lunghezza rame > 100m (TIA-568)
    if (med === 'copper' && hasLen && len > 100) {
      out.push({ level: 'warn', code: 'copper-length', title: 'Tratta in rame oltre 100m',
        why: `${len}m: TIA-568 limita il canale in rame a 100m (90m permanent + 10m bretelle). Oltre, il link può non negoziare o restare instabile — usa fibra o un apparato intermedio.` });
    }

    // 5) DAC troppo lungo
    if (med === 'dac' && hasLen && len > 10) {
      out.push({ level: 'warn', code: 'dac-length', title: 'DAC troppo lungo',
        why: `${len}m: i cavi DAC arrivano a ~5–7m (passivi) o ~10m (attivi). Per distanze maggiori usa transceiver ottici + fibra.` });
    }

    // 6) PoE su fibra (impossibile)
    if (poe && med === 'fiber') {
      out.push({ level: 'error', code: 'poe-fiber', title: 'PoE su fibra',
        why: 'Il Power over Ethernet viaggia solo sul rame: una fibra non porta alimentazione. Serve un iniettore o alimentazione locale al dispositivo remoto.' });
    }

    // 7) 802.3bt (PoE++) su Cat5e (marginale)
    if (poe === '802.3bt' && med === 'copper' && cat === 'Cat5e') {
      out.push({ level: 'warn', code: 'poe-cat', title: 'PoE++ (90W) su Cat5e',
        why: 'Il 802.3bt usa tutte e 4 le coppie ad alta corrente: su Cat5e funziona ma scalda nei fasci fitti. Per dissipazione e margine è raccomandato Cat6/6A.' });
    }

    // 8) Cross-check realtà↔doc: la porta negozia più del cavo dichiarato
    const snmpMbps = Number(opts.snmpSpeedMbps) || 0;
    if (speed && snmpMbps && snmpMbps > speed) {
      out.push({ level: 'warn', code: 'speed-vs-snmp', title: 'Velocità reale oltre il dichiarato',
        why: `La porta negozia ${_mbpsLabel(snmpMbps)} ma il cavo è documentato ${l.maxSpeed}. Aggiorna la Velocità massima o verifica che il cablaggio regga la velocità reale.` });
    }

    // 9) Cross-check mezzo: SNMP vede un mezzo diverso da quello documentato
    const snmpMed = opts.snmpMedium || '';
    if (med && snmpMed && med !== snmpMed) {
      const lbl = { copper: 'Rame', fiber: 'Fibra', dac: 'DAC' };
      out.push({ level: 'warn', code: 'medium-vs-snmp', title: 'Mezzo diverso da SNMP',
        why: `SNMP rileva ${lbl[snmpMed] || snmpMed} ma il cavo è documentato come ${lbl[med] || med}. Allinea il campo Mezzo alla realtà.` });
    }

    // 10) Native VLAN mismatch su trunk fra due apparati attivi (switch↔switch):
    //     su un device reale è un errore (loop/leak di traffico untagged).
    const sn = parseInt(opts.srcNative, 10), dn = parseInt(opts.dstNative, 10);
    if (opts.isTrunk && sn >= 1 && dn >= 1 && sn !== dn) {
      out.push({ level: 'error', code: 'native-mismatch', title: 'VLAN nativa non coincidente',
        why: `I due capi del trunk hanno VLAN nativa diversa (${sn} vs ${dn}). Su un trunk reale è un errore: il traffico untagged finisce in VLAN diverse ai due lati. Allinea il PVID dei due apparati.` });
    }

    return out;
  }

  return { validateCable };
});
