'use strict';
// ============================================================
//  Bersagli di scansione — UNA lettura, e si manda sul filo quella.
//
//  Un indirizzo che arriva da fuori (il campo «subnet», la lista della Verifica, i
//  semi del crawl, l'host di una poll) sta per diventare traffico: ping, connessioni
//  TCP, datagrammi SNMP con la community dentro. Qui si decide se e' un bersaglio, e
//  in che forma parte.
//
//  Prima ogni porta d'ingresso aveva la sua lettura (`/^\d{1,3}(\.\d{1,3}){3}$/`,
//  `Number()` sui pezzi, un controllo solo sul ramo CIDR) e nessuna era la definizione
//  del progetto. Misurato il 01/10, sulla macchina di sviluppo (Windows):
//    · `ping.exe` legge `0300.0250.0.1` come OTTALE (pinga 192.168.0.1); il resolver di
//      Node, quello di dgram e net.connect, rifiuta la stessa stringa. Il progetto
//      accetta APPOSTA gli zeri iniziali (`192.168.001.005` e' `192.168.1.5`, v.
//      `_parseIpv4Int`), quindi `10.10.010.5` veniva pingato come 10.10.8.5 — un altro
//      host — e le sonde TCP non lo risolvevano proprio. Si controllava una lettura e
//      se ne mandava un'altra.
//    · `999.999.999.999` e `256.1.1.1` passavano come bersagli.
//    · multicast, broadcast e «questa rete» erano bersagli ammessi: un SNMP v2c verso un
//      gruppo spedisce la community a tutto il segmento.
//
//  La regola: la lettura e' `_parseIpv4Int` (lib/cidr.js, l'unica definizione), e cio'
//  che parte e' la forma CANONICA che ne esce. Cosi' si controlla e si manda la STESSA
//  stringa, e `ping` non ha piu' niente da interpretare.
//
//  Cosa e' un bersaglio, e perche' cosi' poco restrittivo:
//    ✔ loopback — il banco di prova (simulatore SNMP) e' su 127.0.0.1;
//    ✔ link-local, 192.0.0.0/24 (192.0.0.64 e' il default di certe telecamere),
//      documentazione, CGNAT — sono host veri, e respingerli toglierebbe bersagli;
//    ✘ 0.0.0.0/8 («questa rete»), 224.0.0.0/4 (multicast), 255.255.255.255 (broadcast
//      limitato) — non sono MAI un host: un'unica risposta non identifica nessuno.
//    Il broadcast DIRETTO di una subnet (x.x.x.255) non si distingue senza la maschera:
//    resta ammesso, e il CIDR lo esclude da se' (da .1 a .count).
//
//  ⚠️ IPv6 non si tocca qui: questa guardia e' l'IPv4, e un host che contiene ':' passa
//  com'e' (v. `hostOrName`).
// ============================================================
const { _parseIpv4Int, _intToIpv4, addrScope } = require('../lib/cidr.js');

/**
 * Legge un bersaglio.
 *   ok:true  → { ok, ip (forma canonica), scope }
 *   ok:false → { ok, reason: 'invalid' | 'unspecified' | 'multicast' | 'broadcast', ip? }
 * `invalid` = non e' un IPv4 decimale a quattro ottetti; gli altri motivi hanno `ip`,
 * perche' l'indirizzo si legge ma non e' un host.
 */
function scanTarget(raw) {
  const s = String(raw == null ? '' : raw).trim();
  const n = _parseIpv4Int(s);
  if (n == null) return { ok: false, reason: 'invalid' };
  const ip = _intToIpv4(n);
  if ((n >>> 24) === 0) return { ok: false, reason: 'unspecified', ip };
  if (n === 0xFFFFFFFF) return { ok: false, reason: 'broadcast', ip };
  const scope = addrScope(ip);
  if (scope === 'multicast') return { ok: false, reason: 'multicast', ip };
  return { ok: true, ip, scope };
}

/** La frase da dire a chi ha dato un bersaglio che non lo e'. `raw` = cio' che ha scritto. */
function targetError(t, raw) {
  if (!t || t.ok) return '';
  switch (t.reason) {
    case 'unspecified': return `${t.ip} non è un host: è «questa rete» (0.0.0.0/8)`;
    case 'multicast': return `${t.ip} è un indirizzo multicast: non è un host`;
    case 'broadcast': return `${t.ip} è il broadcast: non è un host`;
    default: return `Indirizzo non valido: «${String(raw == null ? '' : raw).trim()}»`;
  }
}

/**
 * Una lista di bersagli dal corpo di una richiesta.
 *   targets  Map<ip canonico, [scritture originali]> — UNA sonda per indirizzo, e la
 *            risposta va resa sotto OGNI scrittura che il chiamante ha usato (la sua
 *            lista parla con le sue stringhe: `10.10.010.5` e `10.10.10.5`).
 *   rejected [{ value, reason }] — cio' che non e' un bersaglio, col motivo. Il vuoto
 *            (null, '') non e' uno scarto: non e' stato dato niente.
 * `opts.max` = tetto sul numero di indirizzi (gli ulteriori si ignorano, come prima).
 */
function targetList(rawList, opts) {
  const max = Number.isFinite(opts && opts.max) ? opts.max : Infinity;
  const targets = new Map();
  const rejected = [];
  for (const x of (Array.isArray(rawList) ? rawList : [])) {
    const value = String(x == null ? '' : x).trim();
    if (!value) continue;
    const t = scanTarget(value);
    if (!t.ok) { rejected.push({ value, reason: t.reason }); continue; }
    if (!targets.has(t.ip)) {
      if (targets.size >= max) continue;
      targets.set(t.ip, []);
    }
    const chiavi = targets.get(t.ip);
    if (!chiavi.includes(value)) chiavi.push(value);
  }
  return { targets, rejected };
}

/**
 * L'host di una poll puo' essere un NOME (un hostname, un IPv6): quello passa com'e', non
 * e' affare di questa guardia. Se invece ha la FORMA di un IPv4 — solo cifre e punti — lo
 * e' o non lo e': `10.0.0` e `12345` non sono nomi, e il resolver li leggerebbe come
 * indirizzi diversi (`12345` = 0.0.48.57). Rende { host } o { error }.
 */
function hostOrName(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!/^[0-9.]+$/.test(s)) return { host: s };
  const t = scanTarget(s);
  return t.ok ? { host: t.ip } : { error: targetError(t, s) };
}

module.exports = { scanTarget, targetError, targetList, hostOrName };
