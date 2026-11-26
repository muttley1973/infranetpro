'use strict';
// ============================================================
//  Il piano di una scansione con PIU' reti (dialogo «Scopri»)
// ============================================================
// «Scopri» scansionava UN intervallo per volta, e il tetto di 1024 host per scansione (un /22) obbligava chi ha
// piu' reti a rifare il giro a mano, una per una. Ora il campo accetta una lista, e prima di mandare un solo pacchetto
// si chiede a questo modulo: cosa va scansionato, cosa e' sbagliato (e perche'), cosa e' un doppione o sta
// dentro un'altra voce, quanti host sono in tutto.
//
// ⚠️ Una sola definizione di «intervallo valido»: `expandSubnet` (server/netscan.js). Qui non si rilegge un CIDR e non
// si ricontano i prefissi: si CHIAMA, voce per voce, e si tiene il suo messaggio. La lista la spezza
// `lib/scan-ranges.js`, la stessa che usa il pannello.
//
// ⚠️ Anti-IDS (scan-cadence): chi riceve il piano scansiona le reti UNA DOPO L'ALTRA, mai in parallelo. Qui non
// c'e' nulla da parallelizzare: il piano non manda pacchetti.
const { expandSubnet } = require('./netscan');
const { splitScanTargets } = require('../lib/scan-ranges.js');
const { _parseIpv4Int, _intToIpv4 } = require('../lib/cidr.js');

// Il tetto sul TOTALE (le voci sono gia' tenute a 1024 host l'una da expandSubnet). 4096 = sedici /24: una sede con molte
// VLAN ci sta, e il giro resta qualcosa che si aspetta e non qualcosa che si lancia e si dimentica.
const MAX_SCAN_PLAN_HOSTS = 4096;
// Quante voci si leggono: oltre, non si espande nemmeno (32 voci x 1024 host sono comunque 32.768 indirizzi da tenere).
const MAX_SCAN_RANGES = 32;

/** Il piano di una lista di intervalli.
 *  @param {unknown} text la lista come l'ha scritta l'utente
 *  @returns {{ranges:{text:string,hosts:number,first:string,last:string}[], invalid:{text:string,error:string}[],
 *    skipped:{text:string,reason:'duplicate'|'contained',in:string}[], overlaps:{a:string,b:string,hosts:number}[],
 *    total:number, tooMany:boolean, tooManyRanges:boolean, limits:{ranges:number,hosts:number}}} */
function planScanTargets(text) {
  const tokens = splitScanTargets(text);
  // `limits` viaggia col piano: chi mostra «massimo N» dice il numero del server, non una copia scritta nella pagina.
  const out = { ranges: [], invalid: [], skipped: [], overlaps: [], total: 0, tooMany: false, tooManyRanges: false,
    limits: { ranges: MAX_SCAN_RANGES, hosts: MAX_SCAN_PLAN_HOSTS } };
  if (tokens.length > MAX_SCAN_RANGES) { out.tooManyRanges = true; return out; }

  const acc = [];                 // le voci che si scansionano, con gli indirizzi
  const covered = new Set();      // l'unione: ogni host si conta UNA volta
  for (const token of tokens) {
    let ips;
    try { ips = expandSubnet(token); }
    catch (e) { out.invalid.push({ text: token, error: e.message }); continue; }

    const uguale = acc.find((r) => r.text === token);
    if (uguale) { out.skipped.push({ text: token, reason: 'duplicate', in: uguale.text }); continue; }

    // Una voce che sta TUTTA dentro un'altra non si rifa'...
    const contenitore = acc.find((r) => ips.every((ip) => r.set.has(ip)));
    if (contenitore) { out.skipped.push({ text: token, reason: 'contained', in: contenitore.text }); continue; }

    // ...e una che ne contiene altre le assorbe, a prescindere dall'ordine in cui sono scritte.
    const set = new Set(ips);
    for (let i = acc.length - 1; i >= 0; i--) {
      if (acc[i].ips.every((ip) => set.has(ip))) { out.skipped.push({ text: acc[i].text, reason: 'contained', in: token }); acc.splice(i, 1); }
    }
    // Una sovrapposizione solo in parte resta: non esiste un «resto» che sia a sua volta una voce, e il merge dei risultati
    // tiene un indirizzo una volta sola. Si dice quanti ne condividono, non si finge niente.
    for (const r of acc) {
      let n = 0;
      for (const ip of ips) if (r.set.has(ip)) n++;
      if (n) out.overlaps.push({ a: r.text, b: token, hosts: n });
    }
    acc.push({ text: token, ips, set });
    for (const ip of ips) covered.add(ip);
  }
  out.ranges = acc.map((r) => ({ text: r.text, hosts: r.ips.length, first: r.ips[0], last: r.ips[r.ips.length - 1] }));
  out.total = covered.size;
  out.tooMany = out.total > MAX_SCAN_PLAN_HOSTS;
  return out;
}

/** L'UNIONE degli indirizzi di una lista (senza doppioni, nell'ordine di prima comparsa): l'«ambito scansionato» che il
 *  crawl usa per filtrare i vicini. Lancia come `expandSubnet` alla prima voce sbagliata: chi la chiama decide cosa farne.
 *  @param {unknown} text @returns {string[]} */
function expandScanTargets(text) {
  const tokens = splitScanTargets(text);
  if (tokens.length > MAX_SCAN_RANGES) throw new Error(`Massimo ${MAX_SCAN_RANGES} intervalli`);
  const seen = new Set();
  const out = [];
  for (const token of tokens) {
    for (const ip of expandSubnet(token)) if (!seen.has(ip)) { seen.add(ip); out.push(ip); }
  }
  return out;
}

// Una netmask e' una rete solo se e' CONTIGUA (1111…0000): «255.0.255.0» non ha un prefisso, e non se ne inventa uno.
function _prefixOfMask(mask) {
  let p = 0, visto0 = false;
  for (let b = 31; b >= 0; b--) {
    if ((mask >>> b) & 1) { if (visto0) return null; p++; } else visto0 = true;
  }
  return p;
}

/** Le reti IPv4 a cui la macchina e' collegata, dalle interfacce (`os.networkInterfaces()`): address & netmask col
 *  prefisso VERO (mai assunto /24). Non sono reti da proporre: la loopback, l'IPv6, gli indirizzi auto-assegnati
 *  (169.254/16: nessun router li ha dati, nessuno li documenta) e i /32 (un punto, non una rete). La stessa rete su piu'
 *  schede e' UNA riga con tutti i nomi. Pura: l'elenco delle interfacce arriva da fuori.
 *  @param {Record<string, any[]>|null|undefined} ifaces
 *  @returns {{cidr:string,address:string,iface:string,prefix:number,hosts:number}[]} */
function localNetworksFrom(ifaces) {
  const byCidr = new Map();
  const src = ifaces && typeof ifaces === 'object' ? ifaces : {};
  for (const [name, entries] of Object.entries(src)) {
    for (const it of Array.isArray(entries) ? entries : []) {
      if (!it || typeof it !== 'object' || it.internal) continue;
      if (!(it.family === 'IPv4' || it.family === 4)) continue;   // Node 18.0-18.3 la dava come numero
      const addr = _parseIpv4Int(it.address), mask = _parseIpv4Int(it.netmask);
      if (addr == null || mask == null) continue;
      const prefix = _prefixOfMask(mask);
      if (prefix === null || prefix === 32) continue;
      const net = (addr & mask) >>> 0;
      if ((net >>> 16) === 0xA9FE) continue;                       // 169.254.0.0/16
      const cidr = _intToIpv4(net) + '/' + prefix;
      const gia = byCidr.get(cidr);
      if (gia) { if (!gia.names.includes(name)) gia.names.push(name); continue; }
      byCidr.set(cidr, { cidr, address: it.address, names: [name], prefix, hosts: Math.max(0, Math.pow(2, 32 - prefix) - 2) });
    }
  }
  return [...byCidr.values()].map((n) => ({ cidr: n.cidr, address: n.address, iface: n.names.join(', '), prefix: n.prefix, hosts: n.hosts }));
}

module.exports = { planScanTargets, expandScanTargets, localNetworksFrom, MAX_SCAN_PLAN_HOSTS, MAX_SCAN_RANGES };
