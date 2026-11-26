// ============================================================
// SCAN-RANGES — la lista di intervalli del dialogo «Scopri» (UMD-lite, browser + Node · puro)
// ============================================================
// Il campo «Intervallo di rete» accetta UNA lista: «192.168.1.0/24, 10.0.5.0/24, 10.0.9.1-50». Chi la spezza
// in voci e' QUESTA lettura e nessun'altra: il pannello (per spuntare e togliere le caselle «reti
// conosciute» dallo stesso testo) e il server (per il piano di scansione e per il filtro dei vicini del
// crawl) la usano tutti e due. Due copie avrebbero voluto dire che una voce che la pagina vede e il server no.
//
// Quello che una voce VALE (un CIDR, un intervallo, un IP; quanti host; se il prefisso e' troppo largo) NON
// sta qui: lo decide `expandSubnet` (server/netscan.js), una volta sola. Questa lib non giudica niente: taglia.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Le voci di un elenco, nell'ordine in cui sono scritte, senza voci vuote.
   *  Separano la virgola, il punto e virgola, l'a-capo e lo spazio. Uno spazio ATTORNO al trattino non spezza
   *  un intervallo («192.168.1.1 - 254» e' «192.168.1.1-254»). Non testo = nessuna voce.
   *  @param {unknown} text
   *  @returns {string[]} */
  function splitScanTargets(text) {
    if (typeof text !== 'string') return [];
    return text.replace(/\s*-\s*/g, '-').split(/[\s,;]+/).filter(Boolean);
  }

  /** La voce c'e' ESATTAMENTE cosi' (10.0.1.0/24 non e' 10.0.1.0/25). */
  function hasScanTarget(text, target) {
    return splitScanTargets(text).includes(String(target));
  }

  /** Il testo con la voce aggiunta in coda (se manca) o tolta (se c'e'). Le altre voci restano com'erano
   *  scritte, solo ricomposte con «, ». Una voce gia' presente non si raddoppia; togliere l'ultima lascia ''.
   *  @param {string} text @param {string} target @param {boolean} on @returns {string} */
  function toggleScanTarget(text, target, on) {
    const voci = splitScanTargets(text);
    const t = String(target);
    if (on) { if (!voci.includes(t)) voci.push(t); return voci.join(', '); }
    return voci.filter((v) => v !== t).join(', ');
  }

  return { splitScanTargets, hasScanTarget, toggleScanTarget };
});
