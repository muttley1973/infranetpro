'use strict';
// ============================================================
//  server/dcim/pull-cache.js — cache IN MEMORIA della lettura NetBox
// ============================================================
//  Il problema che risolve. L'anteprima dell'import ricaricava TUTTO da NetBox a
//  ogni ricalcolo: misurato, ~2 minuti per 72 apparati (2498 interfacce, 108 cavi).
//  Ma il pannello delle decisioni invita a provare l'alternativa e vedere come
//  cambia il preventivo — e ogni prova pagava un pull completo. Con quel pedaggio
//  nessuno prova, e le alternative restano lettera morta.
//  La mappatura (lib/dcim-map.js) è una funzione PURA: ricalcolarla sul bundle già
//  letto costa millisecondi. Quindi si tiene il bundle, non il risultato.
//
//  ⚠️ VIVE SOLO IN MEMORIA. Non viene mai serializzata, non entra nel JSON di
//  progetto e non tocca il disco: il progetto salvato deve contenere il documento
//  di rete, non la fotografia grezza del DCIM da cui è nato. Il processo che si
//  riavvia la perde, ed è giusto così — è un accorgimento di velocità, non un dato.
//
//  ⚠️ La chiave copre SOLO ciò che determina la LETTURA (istanza, utente, scope,
//  entità). Decisioni, mappature manuali ed esclusioni cambiano la MAPPATURA, non
//  cosa si scarica: se entrassero nella chiave, ogni scelta dell'utente farebbe
//  ripartire il pull — cioè esattamente il problema da cui siamo partiti.
//
//  Modulo puro (zero IO, orologio iniettabile) → testabile davvero.
// ============================================================

const DEFAULT_TTL_MS = 10 * 60 * 1000;   // 10 minuti: oltre, meglio rileggere
const DEFAULT_MAX_ENTRIES = 2;           // un bundle è grande: se ne tengono pochi

// JSON con chiavi ordinate, così due selezioni equivalenti danno la STESSA chiave.
// Gli array di soli primitivi si ordinano: [1,2] e [2,1] chiedono a NetBox la
// stessa fetta, e trattarli come diversi sarebbe un miss inutile.
function _stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) {
    const primitives = value.every(v => v === null || typeof v !== 'object');
    const items = primitives ? value.slice().sort((a, b) => String(a).localeCompare(String(b))) : value;
    return '[' + items.map(_stable).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stable(value[k])).join(',') + '}';
}

function createPullCache(opts) {
  opts = opts || {};
  const ttlMs = Number.isFinite(+opts.ttlMs) && +opts.ttlMs > 0 ? +opts.ttlMs : DEFAULT_TTL_MS;
  const maxEntries = Number.isFinite(+opts.maxEntries) && +opts.maxEntries > 0 ? +opts.maxEntries : DEFAULT_MAX_ENTRIES;
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const entries = new Map();   // key → { value, at }

  // `instance` = l'URL del DCIM: due istanze diverse non condividono niente.
  // `userId` separa gli amministratori: leggono con token e permessi propri.
  function keyFor(parts) {
    parts = parts || {};
    return _stable({
      instance: String(parts.instance == null ? '' : parts.instance),
      userId: String(parts.userId == null ? '' : parts.userId),
      scope: parts.scope || {},
      entities: parts.entities || {},
    });
  }

  function get(key) {
    const hit = entries.get(key);
    if (!hit) return null;
    if (now() - hit.at > ttlMs) { entries.delete(key); return null; }
    // Rinfresca la posizione: la voce usata è quella che conviene tenere.
    entries.delete(key); entries.set(key, hit);
    return { value: hit.value, at: hit.at };
  }

  // Ritorna la voce scritta: chi legge deve poter dire l'ETÀ del dato senza
  // rileggere la cache né tenere un secondo orologio (due orologi divergono).
  function set(key, value) {
    const entry = { value, at: now() };
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    return entry;
  }

  function invalidate(key) { return entries.delete(key); }
  function clear() { entries.clear(); }
  function size() { return entries.size; }

  return { keyFor, get, set, invalidate, clear, size };
}

module.exports = { createPullCache, DEFAULT_TTL_MS, DEFAULT_MAX_ENTRIES };
