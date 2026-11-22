'use strict';
// ============================================================
// BIND-WARNING — cosa dire all'avvio quando il server NON ascolta solo sul computer
// ============================================================
// Il server ascolta di default su 127.0.0.1: e' la premessa di sicurezza da cui parte tutto il resto
// (SECURITY.md: «il server si lega a 127.0.0.1; pubblicarlo in rete e' una decisione dell'operatore, e
// va fatta dietro un reverse proxy TLS»). `HOST` la cambia — in un container deve essere 0.0.0.0 — e fino
// ad ora lo faceva in silenzio: chi imposta HOST=0.0.0.0 su un PC per «provare da un altro computer»
// espone gli accessi, i progetti e la scansione della rete senza che nessuna riga di log glielo dica.
//
// Qui NON si vieta niente: si DICE, una volta, all'avvio, con le due uscite oneste (il container con la
// porta pubblicata solo sul loopback dell'host; il reverse proxy TLS). Il silenzio resta in due casi:
//   · l'indirizzo e' di loopback (127.0.0.0/8, ::1, `localhost`);
//   · l'operatore ha dichiarato il proxy (`INFRANET_TRUST_PROXY=1`): sa gia' di essere dietro qualcosa.
//
// «E' loopback?» non e' un confronto di stringhe: 127.0.0.2, `[::1]` e `::ffff:127.0.0.1` sono tutti
// loopback e nessuno e' uguale a «127.0.0.1». La domanda la risolve `addrScope` (lib/cidr.js), la stessa
// che classifica gli indirizzi nel resto del prodotto — qui non si riscrive «127/8».

const { addrScope } = require('../lib/cidr.js');

/** @param {unknown} host il valore di HOST
 *  @returns {boolean} true se ascolta SOLO sul computer stesso */
function isLoopbackHost(host) {
  const h = String(host == null ? '' : host).trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (!h) return false;
  if (h === 'localhost') return true;                       // un nome, non un indirizzo: addrScope risponde null
  // L'IPv4 incastonato in un IPv6 (`::ffff:127.0.0.1`) e' loopback come lui: si guarda l'indirizzo dentro.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  return addrScope(mapped ? mapped[1] : h) === 'loopback';
}

/** @param {unknown} host il valore di HOST
 *  @param {Record<string, string|undefined>} [env] l'ambiente (per INFRANET_TRUST_PROXY)
 *  @returns {string} la riga da scrivere nel log, oppure '' se non c'e' niente da dire */
function bindWarning(host, env) {
  if (isLoopbackHost(host)) return '';
  if (env && env.INFRANET_TRUST_PROXY === '1') return '';
  const dove = String(host).trim() || '(vuoto)';
  return `  [SICUREZZA] Il server ascolta su ${dove}, non solo su questo computer: chi raggiunge la porta raggiunge il login. ` +
    'Va bene in un container con la porta pubblicata solo sul 127.0.0.1 dell\'host; in ogni altro caso mettilo dietro un ' +
    'reverse proxy TLS e imposta INFRANET_TRUST_PROXY=1 (che zittisce questo avviso), oppure lascia HOST a 127.0.0.1.';
}

module.exports = { isLoopbackHost, bindWarning };
