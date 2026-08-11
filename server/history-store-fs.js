'use strict';
// ============================================================
//  HISTORY STORE — backend a FILE (v1), dietro un'interfaccia stabile
// ============================================================
// Lo storico del progetto vive FUORI dal <id>.json (paletto: non appesantire i
// JSON, già al limite). Tutto passa da un'interfaccia `historyStore` così un
// domani un backend SQLite (ADR D7) subentra senza toccare route né UI.
//
// Due livelli di "fotografia":
//   • TIMELINE leggera (Fase 3): una riga ~1 KB per Verifica (append-only JSONL).
//     Linea del tempo (salute/divergenze nel tempo, diff tra due date).
//   • SNAPSHOT completo RIPRISTINABILE (Fase 4): lo stato intero gzip, di rado
//     (Salva/on-demand/pre-rischiose). Restore = torni a una versione.
//
// Layout su disco (baseDir = projects/history, gitignored con projects/):
//   <baseDir>/<id>/timeline.jsonl                 — righe di timeline
//   <baseDir>/<id>/snapshots.jsonl                — indice meta degli snapshot
//   <baseDir>/<id>/snapshots/<snapId>.json.gz     — stato intero gzip
//   <baseDir>/<id>/presence.json                  — chi c'è / chi non c'è (corrente)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function removeProjectHistory(baseDir, projectId) {
  const rawBaseDir = String(baseDir == null ? '' : baseDir).trim();
  if (!rawBaseDir) return false;
  const root = path.resolve(rawBaseDir);
  const id = String(projectId == null ? '' : projectId);
  if (!/^\d+$/.test(id) || root === path.parse(root).root) return false;
  const target = path.resolve(root, id);
  if (target === root || !target.startsWith(root + path.sep)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

// Retention TIMELINE: generosa (righe minuscole). Cap numero + età.
const TIMELINE_CAP = 2000;                               // ~2000 Verifiche
const TIMELINE_MAX_AGE_MS = 365 * 24 * 3600 * 1000;      // 1 anno

// Retention SNAPSHOT: cap + assottigliamento (le etichettate sono esenti, mai
// cancellate). Finestre: < 48h tutte · 48h→7g una/ora · 7g→30g una/giorno · oltre 30g via.
const SNAPSHOT_CAP     = 100;
const SNAP_KEEP_ALL_MS = 48 * 3600 * 1000;
const SNAP_HOURLY_MS   = 7  * 24 * 3600 * 1000;
const SNAP_DAILY_MS    = 30 * 24 * 3600 * 1000;

function createFsHistoryStore(opts = {}) {
  const baseDir = opts.baseDir;
  if (!baseDir) throw new Error('history-store-fs: baseDir richiesto');
  const tlCap    = opts.timelineCap      || TIMELINE_CAP;
  const tlMaxAge = opts.timelineMaxAgeMs || TIMELINE_MAX_AGE_MS;
  const snapCap  = opts.snapshotCap      || SNAPSHOT_CAP;

  const _dir          = (id) => path.join(baseDir, String(id));
  const _timelineFile = (id) => path.join(_dir(id), 'timeline.jsonl');
  const _snapDir      = (id) => path.join(_dir(id), 'snapshots');
  const _snapIndex    = (id) => path.join(_dir(id), 'snapshots.jsonl');
  const _presenceFile = (id) => path.join(_dir(id), 'presence.json');

  // Scrittura atomica: tmp + rename (vale per stringhe e Buffer/gzip).
  function _atomicWrite(file, data) {
    const tmp = file + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, data); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  }
  // Legge un JSONL tollerando righe corrotte (le salta).
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
  const _at = (e) => { const t = Date.parse(e && e.at); return Number.isFinite(t) ? t : 0; };

  // ── TIMELINE ───────────────────────────────────────────────────────
  function _pruneTimeline(entries) {
    let arr = entries;
    if (tlMaxAge > 0) {
      const cutoff = Date.now() - tlMaxAge;
      arr = arr.filter(e => _at(e) === 0 || _at(e) >= cutoff);
    }
    if (arr.length > tlCap) arr = arr.slice(arr.length - tlCap);
    return arr;
  }

  // ── SNAPSHOT — assottigliamento ─────────────────────────────────────
  // Ritorna { keep:Set(id), drop:[id] }. Etichettate sempre tenute (esenti da
  // thinning e cap). Le altre: tenute per finestra d'età, poi cap sulle più recenti.
  function _thinSnapshots(metas, now, cap) {
    const labeled   = metas.filter(m => m.label);
    const unlabeled = metas.filter(m => !m.label);
    const keep = new Set(labeled.map(m => m.id));
    // Ordina per data ASC; itera dal PIÙ RECENTE per tenere il più nuovo di ogni bucket.
    const asc = unlabeled.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const hourSeen = new Set(), daySeen = new Set();
    const kept = [];
    for (let i = asc.length - 1; i >= 0; i--) {
      const m = asc[i];
      const age = now - (Date.parse(m.at) || 0);
      if (age < SNAP_KEEP_ALL_MS) { kept.push(m); continue; }              // < 48h: tutte
      if (age < SNAP_HOURLY_MS)   { const k = String(m.at).slice(0, 13); if (!hourSeen.has(k)) { hourSeen.add(k); kept.push(m); } continue; }
      if (age < SNAP_DAILY_MS)    { const k = String(m.at).slice(0, 10); if (!daySeen.has(k))  { daySeen.add(k);  kept.push(m); } continue; }
      // oltre 30g: scartata
    }
    // Cap sulle NON etichettate (le etichettate non contano nel taglio, ma occupano il tetto).
    const allow = Math.max(0, cap - labeled.length);
    let capped = kept.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));  // ASC
    if (capped.length > allow) capped = capped.slice(capped.length - allow);             // tieni le più recenti
    capped.forEach(m => keep.add(m.id));
    const drop = metas.filter(m => !keep.has(m.id)).map(m => m.id);
    return { keep, drop };
  }
  function _applySnapPrune(projectId, metas, now) {
    const { keep, drop } = _thinSnapshots(metas, now, snapCap);
    const kept = metas.filter(m => keep.has(m.id));
    _atomicWrite(_snapIndex(projectId), kept.map(m => JSON.stringify(m)).join('\n') + '\n');
    for (const id of drop) { try { fs.unlinkSync(path.join(_snapDir(projectId), id + '.json.gz')); } catch (_) { /* best-effort */ } }
    return kept;
  }

  return {
    // ── TIMELINE (Fase 3) ─────────────────────────────────────────────
    appendTimeline(projectId, entry) {
      fs.mkdirSync(_dir(projectId), { recursive: true });
      const file = _timelineFile(projectId);
      const entries = _pruneTimeline(_readLines(file).concat([entry]));
      _atomicWrite(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
      return entry;
    },
    listTimeline(projectId, q = {}) {
      let entries = _readLines(_timelineFile(projectId));
      if (q.from) entries = entries.filter(e => String(e.at || '') >= String(q.from));
      if (q.to)   entries = entries.filter(e => String(e.at || '') <= String(q.to));
      const lim = q.limit | 0;
      if (lim > 0 && entries.length > lim) entries = entries.slice(entries.length - lim);
      return entries;
    },
    pruneTimeline(projectId) {
      const entries = _pruneTimeline(_readLines(_timelineFile(projectId)));
      _atomicWrite(_timelineFile(projectId), entries.map(e => JSON.stringify(e)).join('\n') + '\n');
      return entries.length;
    },

    // ── SNAPSHOT completi ripristinabili (Fase 4) ─────────────────────
    // Salva lo `stateObj` INTERO gzip + una riga meta nell'indice, poi assottiglia.
    // meta = { at, by, label?, reason? }; ritorna il record salvato (con id, sizeGz).
    putSnapshot(projectId, meta, stateObj) {
      fs.mkdirSync(_snapDir(projectId), { recursive: true });
      let id = String(Date.now());
      let blob = path.join(_snapDir(projectId), id + '.json.gz');
      while (fs.existsSync(blob)) { id = String(Number(id) + 1); blob = path.join(_snapDir(projectId), id + '.json.gz'); }
      const gz = zlib.gzipSync(Buffer.from(JSON.stringify(stateObj)));
      _atomicWrite(blob, gz);
      const rec = { id, at: (meta && meta.at) || '', by: (meta && meta.by) || 'sistema',
                    label: (meta && meta.label) || '', reason: (meta && meta.reason) || '', sizeGz: gz.length };
      const metas = _readLines(_snapIndex(projectId)).concat([rec]);
      _applySnapPrune(projectId, metas, Date.now());
      return rec;
    },
    listSnapshots(projectId) {
      // Indice cronologico (ASC). Filtra i record il cui blob è sparito (coerenza).
      return _readLines(_snapIndex(projectId)).filter(m => fs.existsSync(path.join(_snapDir(projectId), m.id + '.json.gz')));
    },
    getSnapshot(projectId, id) {
      let buf;
      try { buf = fs.readFileSync(path.join(_snapDir(projectId), String(id) + '.json.gz')); } catch (_) { return null; }
      try { return JSON.parse(zlib.gunzipSync(buf).toString('utf8')); } catch (_) { return null; }
    },
    // Prune on-demand (now iniettabile per test deterministici dell'assottigliamento).
    pruneSnapshots(projectId, o = {}) {
      const now = Number.isFinite(o.now) ? o.now : Date.now();
      return _applySnapPrune(projectId, _readLines(_snapIndex(projectId)), now).length;
    },
    // ── PRESENZA (chi c'è / chi non c'è) ────────────────────────────────
    // Sta qui e non nel <id>.json per la stessa ragione della timeline: non è
    // una modifica al documento, è una MISURA. Il documento lo scrive l'utente e
    // aspetta Salva; la presenza la scrive la rete e non può aspettare nessuno,
    // altrimenti un apparato spento torna verde al primo reload.
    // File singolo sovrascritto (non append): esiste UNA presenza corrente.
    savePresence(projectId, presence) {
      fs.mkdirSync(_dir(projectId), { recursive: true });
      const rec = { at: new Date().toISOString(), nodes: (presence && presence.nodes) || {} };
      _atomicWrite(_presenceFile(projectId), JSON.stringify(rec));
      return rec;
    },
    readPresence(projectId) {
      try { return JSON.parse(fs.readFileSync(_presenceFile(projectId), 'utf8')); }
      catch (_) { return null; }   // assente o illeggibile = nessuna presenza salvata
    },
    removeProject(projectId) {
      return removeProjectHistory(baseDir, projectId);
    },
  };
}

module.exports = { createFsHistoryStore, removeProjectHistory };
