'use strict';
// ============================================================
//  HISTORY STORE — backend a FILE (v1), dietro un'interfaccia stabile
// ============================================================
// Lo storico del progetto vive FUORI dal <id>.json (paletto: non appesantire i
// JSON, già al limite). Tutto passa da un'interfaccia `historyStore` così un
// domani un backend SQLite (ADR D7) subentra senza toccare route né UI.
//
// FASE 3 — solo la TIMELINE leggera: una riga ~1 KB per ogni Verifica
// (append-only JSONL). È la "linea del tempo" (salute/divergenze nel tempo,
// diff tra due date). Le FOTOGRAFIE COMPLETE ripristinabili (putSnapshot/
// listSnapshots/getSnapshot, gzip) arriveranno in Fase 4, sulla stessa
// interfaccia e nella stessa cartella `projects/history/<id>/`.
//
// Layout su disco:  <baseDir>/<projectId>/timeline.jsonl
// (baseDir = projects/history, gitignored insieme a projects/).
const fs = require('fs');
const path = require('path');

// Retention timeline: generosa (le righe sono minuscole). Doppio limite: numero
// di righe + età. Il prune gira a ogni append (frequenza bassa: una Verifica ogni
// N minuti → costo trascurabile anche riscrivendo il file intero).
const TIMELINE_CAP = 2000;                               // ~2000 Verifiche
const TIMELINE_MAX_AGE_MS = 365 * 24 * 3600 * 1000;      // 1 anno

function createFsHistoryStore(opts = {}) {
  const baseDir = opts.baseDir;
  if (!baseDir) throw new Error('history-store-fs: baseDir richiesto');
  const cap    = opts.timelineCap       || TIMELINE_CAP;
  const maxAge = opts.timelineMaxAgeMs  || TIMELINE_MAX_AGE_MS;

  const _dir          = (id) => path.join(baseDir, String(id));
  const _timelineFile = (id) => path.join(_dir(id), 'timeline.jsonl');

  // Scrittura atomica: tmp + rename (stessa filosofia di projects-store.atomicWriteFile,
  // ma self-contained per non accoppiare lo store al modulo progetti).
  function _atomicWrite(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  }

  // Legge un JSONL tollerando righe corrotte (le salta invece di rompere tutto).
  function _readLines(file) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return []; }
    const out = [];
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try { out.push(JSON.parse(s)); } catch (_) { /* riga corrotta: salta */ }
    }
    return out;
  }

  function _at(e) { const t = Date.parse(e && e.at); return Number.isFinite(t) ? t : 0; }

  // Applica retention: prima per età (rispetto ad ADESSO), poi cap sulle ultime N.
  function _prune(entries) {
    let arr = entries;
    if (maxAge > 0) {
      const cutoff = Date.now() - maxAge;
      arr = arr.filter(e => _at(e) === 0 || _at(e) >= cutoff);  // 0 = data illeggibile → non buttarla per età
    }
    if (arr.length > cap) arr = arr.slice(arr.length - cap);
    return arr;
  }

  return {
    // Aggiunge una riga di timeline (entry già server-stamped: at/by decisi dalla route).
    // Riscrive il file intero (append + prune) in modo atomico → nessuna riga a metà.
    appendTimeline(projectId, entry) {
      fs.mkdirSync(_dir(projectId), { recursive: true });
      const file = _timelineFile(projectId);
      const entries = _prune(_readLines(file).concat([entry]));
      _atomicWrite(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
      return entry;
    },

    // Lista la timeline in ordine cronologico (= ordine d'append). Filtri opzionali
    // from/to (confronto lessicografico sulle stringhe 'YYYY-MM-DD HH:MM:SS', che
    // ordina come il tempo) e limit (ultime N righe).
    listTimeline(projectId, q = {}) {
      let entries = _readLines(_timelineFile(projectId));
      if (q.from) entries = entries.filter(e => String(e.at || '') >= String(q.from));
      if (q.to)   entries = entries.filter(e => String(e.at || '') <= String(q.to));
      const lim = q.limit | 0;
      if (lim > 0 && entries.length > lim) entries = entries.slice(entries.length - lim);
      return entries;
    },

    // Prune on-demand (stessa politica dell'append). Ritorna quante righe restano.
    pruneTimeline(projectId) {
      const file = _timelineFile(projectId);
      const entries = _prune(_readLines(file));
      _atomicWrite(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
      return entries.length;
    },
  };
}

module.exports = { createFsHistoryStore };
