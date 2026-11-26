// ============================================================
// SCAN-COMMUNITY-HINTS — la community PER RETE nel dialogo «Scopri» (UMD-lite, browser + Node · puro)
// ============================================================
// La community e' una credenziale: dove va la decide una persona, non il codice. Con piu' reti nella scansione ogni rete puo'
// avere la sua (un campo mascherato, che non si salva), e il dialogo puo' PROPORRE quella che gli apparati gia' documentati in
// quella rete usano. Tre regole:
//
//  1. Il suggerimento viene da un dato che il progetto ha GIA' (`integration.community` dei nodi, classe `secret`): non nasce
//     nessun archivio nuovo, e niente esce dalla rete da cui viene — la community di un apparato di 10.0.5.0/24 si propone per
//     10.0.5.0/24, mai per un'altra rete.
//  2. Si PROPONE, non si usa da sola: chi la vuole la conferma con un clic. Se gli apparati della rete ne usano di DIVERSE non se
//     ne sceglie una a caso: si dice che sono diverse e basta (e le due non escono da qui).
//  3. Il VALORE non va mai in una pagina da sola: la funzione lo rende solo quando e' uno e uno solo, chi la chiama lo mette in un
//     campo mascherato al clic; nel DOM, in un attributo o in un suggerimento non compare.
//
// L'indirizzo a cui si rivolge il poller e' quello di `snmpTargetHost` (`integration.host`, poi l'IP del nodo): una sola
// definizione, la stessa dei poller. La lettura dell'indirizzo e' `_parseIpv4Int` (lib/cidr.js).

(function (root, factory) {
  // In Node/bundle le dipendenze si risolvono via require; nel browser classico arrivano come globali, lette a CALL-TIME.
  const dep = (typeof module !== 'undefined' && module.exports)
    ? { cidr: require('./cidr.js'), target: require('./snmp-target.js') }
    : { cidr: root, target: root };
  const api = factory(dep);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';

  // Solo v1 e v2c hanno una community (v3 usa utente e password). Il server accetta il driver in qualunque maiuscola.
  const COMMUNITY_DRIVERS = ['snmp-v1', 'snmp-v2c'];

  const _ip = (s) => (dep.cidr && typeof dep.cidr._parseIpv4Int === 'function') ? dep.cidr._parseIpv4Int(s) : null;
  const _host = (n) => (dep.target && typeof dep.target.snmpTargetHost === 'function') ? dep.target.snmpTargetHost(n) : '';

  /** Per ogni rete: quanti apparati documentati vi hanno una community, quante ne usano di diverse, e LA community solo se e' una sola.
   *  @param {any[]|null} nodes i nodi del progetto
   *  @param {{text:string,first:string,last:string}[]|null} ranges le reti del piano (`first`/`last` = primo e ultimo host)
   *  @returns {{text:string,count:number,distinct:number,value:string|null}[]} */
  function communityHints(nodes, ranges) {
    if (!Array.isArray(ranges)) return [];
    const list = Array.isArray(nodes) ? nodes : [];
    return ranges.map((r) => {
      const lo = _ip(r && r.first), hi = _ip(r && r.last);
      const seen = new Set();
      let count = 0;
      if (lo !== null && hi !== null) {
        for (const n of list) {
          const integ = n && n.integration;
          if (!integ || typeof integ !== 'object') continue;
          if (!COMMUNITY_DRIVERS.includes(String(integ.driver == null ? '' : integ.driver).trim().toLowerCase())) continue;
          const community = typeof integ.community === 'string' ? integ.community : '';
          if (community.trim() === '') continue;
          const ip = _ip(_host(n));
          if (ip === null || ip < lo || ip > hi) continue;
          count++; seen.add(community);
        }
      }
      return { text: String(r && r.text), count, distinct: seen.size, value: seen.size === 1 ? [...seen][0] : null };
    });
  }

  /** La community che vale per UNA rete: la sua, se la persona ne ha scritta una (non vuota), altrimenti quella del campo comune.
   *  @param {string} range @param {Record<string,string>|null} overrides @param {string} fallback @returns {string} */
  function communityFor(range, overrides, fallback) {
    if (overrides && typeof overrides === 'object' && Object.prototype.hasOwnProperty.call(overrides, range)) {
      const v = overrides[range];
      if (typeof v === 'string' && v.trim() !== '') return v;
    }
    return fallback == null ? '' : String(fallback);
  }

  /** Le reti raggruppate per community, nell'ordine di prima comparsa: il crawl dei vicini parte UNA volta per gruppo, con la sua
   *  credenziale. Senza sovrascritture e' un gruppo solo (un solo crawl, come prima).
   *  @param {string[]} ranges @param {string[]} communities una per rete @returns {{community:string,indexes:number[]}[]} */
  function groupRangesByCommunity(ranges, communities) {
    const groups = [];
    (Array.isArray(ranges) ? ranges : []).forEach((_r, i) => {
      const c = communities[i];
      let g = groups.find((x) => x.community === c);
      if (!g) { g = { community: c, indexes: [] }; groups.push(g); }
      g.indexes.push(i);
    });
    return groups;
  }

  return { communityHints, communityFor, groupRangesByCommunity };
});
