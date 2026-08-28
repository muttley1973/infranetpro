'use strict';
// ============================================================
//  server/organization-store.js — l'organizzazione multi-sede (server-side).
//
//  Persiste in `data/organization.json` il livello SOPRA i progetti: le sedi,
//  gli uplink WAN e i collegamenti inter-sede. Fase 1 del piano
//  `_local/notes/PIANO_multi-sede-wan-vpn.md`.
//
//  ── Le scelte, e perché ─────────────────────────────────────────────────
//
//  ① **UNA organizzazione per installazione.** Questa installazione di InfraNet
//     = questa azienda, con le sue sedi. È la forma della PMI a 2-5 sedi per cui
//     il layer esiste, e il piano mette l'MSP-multi-tenant (N aziende, isolamento,
//     permessi) esplicitamente FUORI scope: è un altro prodotto. Il giorno in cui
//     servisse davvero, il posto dove aggiungerlo è questo file — e sarà una
//     decisione presa, non un effetto collaterale di un file già plurale.
//
//  ② **NON dentro un progetto.** L'organizzazione è condivisa fra i progetti-sede:
//     metterne una copia in ciascuno sarebbe per costruzione il bug più caro di
//     questo repo (lo stesso concetto in due posti, che divergono). Le sedi
//     puntano ai progetti con `projectRef`: un riferimento, mai una copia.
//
//  ③ **Si normalizza in LETTURA e in SCRITTURA**, con la stessa funzione pura
//     (`lib/inter-site.js`). In scrittura difende da un body malformato, in
//     lettura da un file corrotto o scritto a mano. `normalizeOrganization` è
//     idempotente, quindi normalizzare due volte non cambia niente.
//
//  ④ **Chi scrive viene informato di cosa è stato SCARTATO.** Un collegamento con
//     un `kind` fuori vocabolario non entra (paletto ②): giusto, ma se sparisse
//     in silenzio l'utente crederebbe di averlo salvato. `writeOrganization`
//     ritorna anche i conteggi di ciò che non è passato, così la UI può dirlo.
//
//  Modulo CommonJS puro-di-IO; path iniettabile via INFRANET_ORG_FILE per i test,
//  come projects-store e ai-config.
// ============================================================
const fs = require('fs');
const path = require('path');
const { atomicWriteFile } = require('./projects-store');
const { normalizeOrganization } = require('../lib/inter-site.js');

const ORG_FILE = process.env.INFRANET_ORG_FILE ||
  path.join(__dirname, '..', 'data', 'organization.json');

/** Quante voci c'erano nell'input, per lista. Un non-array conta 0. */
function _count(raw, key) {
  const v = raw && typeof raw === 'object' ? raw[key] : null;
  return Array.isArray(v) ? v.length : 0;
}

/**
 * L'organizzazione su disco, normalizzata.
 * File assente o illeggibile → organizzazione VUOTA, non un errore: «non c'è
 * ancora» è lo stato normale di un'installazione che non ha aperto il capitolo
 * multi-sede, e non deve somigliare a un guasto.
 */
function readOrganization() {
  try {
    if (fs.existsSync(ORG_FILE)) {
      return normalizeOrganization(JSON.parse(fs.readFileSync(ORG_FILE, 'utf8')));
    }
  } catch (_) { /* file corrotto → si riparte dal vuoto, mai da dati inventati */ }
  return normalizeOrganization({});
}

/**
 * Scrive l'organizzazione (sostituzione completa, come il Salva di un progetto).
 * Ritorna `{ organization, dropped }`:
 *   · `organization` = quello che è stato SCRITTO DAVVERO (normalizzato), non
 *     quello che è stato mandato. Se i due differiscono, chi ha scritto deve
 *     poterlo vedere invece di scoprirlo al giro dopo.
 *   · `dropped` = quante sedi / uplink / collegamenti non hanno superato la
 *     normalizzazione (④). Zero ovunque = tutto quello che hai mandato è entrato.
 */
function writeOrganization(raw) {
  const organization = normalizeOrganization(raw);
  const dropped = {
    sites: Math.max(0, _count(raw, 'sites') - organization.sites.length),
    uplinks: Math.max(0, _count(raw, 'uplinks') - organization.uplinks.length),
    links: Math.max(0, _count(raw, 'links') - organization.links.length),
  };
  const dir = path.dirname(ORG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Scrittura ATOMICA (temp + fsync + rename, con .bak del precedente): un crash
  // a metà non lascia un file troncato, cioè un'organizzazione mezza sparita.
  atomicWriteFile(ORG_FILE, JSON.stringify(organization, null, 2));
  return { organization, dropped };
}

/** C'è un'organizzazione scritta? (per la UI: mostrare o no il capitolo multi-sede) */
function hasOrganization() {
  try { return fs.existsSync(ORG_FILE); } catch (_) { return false; }
}

module.exports = {
  readOrganization,
  writeOrganization,
  hasOrganization,
  ORG_FILE,
  // esportato per i test puri
  _count,
};
