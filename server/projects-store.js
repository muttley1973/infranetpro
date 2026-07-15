'use strict';
// ============================================================
//  Persistenza progetti — file JSON in /projects
//  Estratto da server.js (comportamento invariato).
// ============================================================
const fs   = require('fs');
const path = require('path');

// La cartella projects/ sta nella root del progetto (server/ è un livello sotto).
// Override via INFRANET_PROJECTS_DIR: serve a far girare il server su uno store
// isolato (es. E2E headless su dir temporanea) senza toccare i dati reali.
const PROJECTS_DIR = process.env.INFRANET_PROJECTS_DIR || path.join(__dirname, '..', 'projects');

if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// ---- Scrittura atomica + durabile -------------------------------------------
// Scrive su un file temporaneo, forza il flush su disco (fsync) e poi rinomina
// sul file finale: il rename e' atomico sullo stesso filesystem. Un crash o un
// calo di tensione a meta' scrittura lascia INTATTO il file originale — mai un
// JSON troncato. Prima del rename conserva l'ultima versione valida come `.bak`
// (best-effort), da cui loadProject sa recuperare.
// Helper puro nel path: accetta un percorso esplicito → testabile su dir temp.
// `mode` opzionale: crea il file temporaneo con quei permessi FIN DALL'INIZIO
// (es. 0o600 per un file con segreti) → nessuna finestra world-readable fra
// scrittura e chmod. Omesso → permessi di default (comportamento invariato).
function atomicWriteFile(file, data, mode) {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd  = (mode !== undefined) ? fs.openSync(tmp, 'w', mode) : fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data, 0, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, `${file}.bak`); } catch (_) { /* best-effort */ }
  }
  fs.renameSync(tmp, file);
}

// ---- bgImage: estrazione su file (lo stato/JSON resta piccolo) --------------
// La planimetria caricata è un data-URL base64 (spesso >1 MB). Tenerla nel JSON
// gonfia ogni Salva (riscrive tutto) e ogni listProjects (parse di tutto). Qui la
// estraiamo in projects/assets/<id>.<ext> e nel JSON resta solo il riferimento
// (`state.bgImageAsset` + `bgImageHash`); `loadProject` la RIATTACCA come data-URL
// PRIMA di restituirla al client → render/export restano invariati (vedono base64).
// Trasparente per il client; ottimizzazione puramente di storage.
const ASSETS_DIR = path.join(PROJECTS_DIR, 'assets');
const _MIME_EXT = { 'image/png':'png', 'image/jpeg':'jpg', 'image/jpg':'jpg', 'image/gif':'gif', 'image/webp':'webp', 'image/svg+xml':'svg', 'image/bmp':'bmp' };
const _EXT_MIME = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', bmp:'image/bmp' };

function _parseDataUrl(durl) {
  if (typeof durl !== 'string' || !durl.startsWith('data:')) return null;
  const comma = durl.indexOf(',');
  if (comma < 0) return null;
  const header = durl.slice(5, comma);                 // es. "image/png;base64"
  const data   = durl.slice(comma + 1);
  const isB64  = /;base64/i.test(header);
  const mime   = (header.split(';')[0] || '').toLowerCase() || 'application/octet-stream';
  const buf    = isB64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
  return { mime, buf };
}

function _hashBuf(buf) {
  return require('crypto').createHash('sha1').update(buf).digest('hex').slice(0, 12);
}

// Scrittura atomica dell'asset (temp + fsync + rename), SENZA .bak: il JSON tiene
// l'hash; un asset perso/corrotto degrada a "nessuna immagine" (riattacco fallisce
// in modo soft), non corrompe il progetto.
function _writeAssetAtomic(file, buf) {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd  = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, buf); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

// Ritorna una COPIA dello stato pronta per il disco: se bgImage è un data-URL lo
// scrive su asset (saltando la riscrittura se l'hash combacia col precedente) e lo
// sostituisce col riferimento. Non muta `state` (il client tiene il suo data-URL).
function extractBgAsset(id, state, assetsDir, prevMeta) {
  const out = Object.assign({}, state);
  const durl = (state && typeof state.bgImage === 'string') ? state.bgImage : '';
  const prevAsset = prevMeta && prevMeta.bgImageAsset;
  if (durl.startsWith('data:')) {
    const p = _parseDataUrl(durl);
    if (p) {
      const ext   = _MIME_EXT[p.mime] || 'bin';
      const hash  = _hashBuf(p.buf);
      const fname = `${id}.${ext}`;
      const fpath = path.join(assetsDir, fname);
      const unchanged = prevMeta && prevMeta.bgImageHash === hash && prevMeta.bgImageAsset === fname && fs.existsSync(fpath);
      if (!unchanged) {
        if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
        if (prevAsset && prevAsset !== fname) { try { fs.unlinkSync(path.join(assetsDir, prevAsset)); } catch (_) {} }
        _writeAssetAtomic(fpath, p.buf);
      }
      out.bgImage = null;
      out.bgImageAsset = fname;
      out.bgImageHash = hash;
      return out;
    }
  }
  // nessuna immagine (o non-dataurl): rimuovi l'asset precedente e i riferimenti
  if (prevAsset) { try { fs.unlinkSync(path.join(assetsDir, prevAsset)); } catch (_) {} }
  out.bgImage = (typeof out.bgImage === 'string' && !out.bgImage.startsWith('data:')) ? out.bgImage : null;
  delete out.bgImageAsset;
  delete out.bgImageHash;
  return out;
}

// Riattacca il data-URL leggendo l'asset; ripulisce i campi di storage così il
// round-trip è pulito (il client non vede mai bgImageAsset/bgImageHash).
function reattachBgAsset(proj, assetsDir) {
  const st = proj && proj.state;
  if (st && st.bgImageAsset) {
    try {
      const buf  = fs.readFileSync(path.join(assetsDir, st.bgImageAsset));
      const ext  = String(st.bgImageAsset.split('.').pop() || '').toLowerCase();
      const mime = _EXT_MIME[ext] || 'application/octet-stream';
      st.bgImage = `data:${mime};base64,${buf.toString('base64')}`;
    } catch (_) { st.bgImage = st.bgImage || null; }   // asset mancante → soft-fail
    delete st.bgImageAsset;
    delete st.bgImageHash;
  }
  return proj;
}

// Rimuove gli asset di un progetto (usato dalla delete route per non lasciare orfani).
function removeBgAsset(id, assetsDir) {
  const dir = assetsDir || ASSETS_DIR;
  for (const ext of Object.values(_MIME_EXT).concat('bin')) {
    try { fs.unlinkSync(path.join(dir, `${id}.${ext}`)); } catch (_) {}
  }
}

function nextId() {
  const ids = fs.readdirSync(PROJECTS_DIR)
    .filter(f => /^\d+\.json$/.test(f))
    .map(f => parseInt(f, 10));
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function saveProject(id, name, state, createdAt, updatedAt) {
  const file = path.join(PROJECTS_DIR, `${id}.json`);
  // Meta precedente (per saltare la riscrittura dell'asset se l'immagine è invariata).
  // Letto dal JSON RAW su disco (ha bgImageHash), non dallo stato riattaccato.
  let prevMeta = null;
  try { if (fs.existsSync(file)) prevMeta = (JSON.parse(fs.readFileSync(file, 'utf8')).state) || null; } catch (_) { /* ignora */ }
  const storeState = extractBgAsset(id, state, ASSETS_DIR, prevMeta);
  atomicWriteFile(file, JSON.stringify(
    { id, name, created_at: createdAt, updated_at: updatedAt, state: storeState }
  ));
}

function loadProject(id) {
  const file = path.join(PROJECTS_DIR, `${id}.json`);
  try {
    if (fs.existsSync(file)) return reattachBgAsset(JSON.parse(fs.readFileSync(file, 'utf8')), ASSETS_DIR);
  } catch (_) { /* file principale illeggibile → tenta il backup */ }
  // Recupero: se il file finale e' assente o corrotto, prova l'ultimo `.bak`.
  try {
    const bak = `${file}.bak`;
    if (fs.existsSync(bak)) return reattachBgAsset(JSON.parse(fs.readFileSync(bak, 'utf8')), ASSETS_DIR);
  } catch (_) { /* nemmeno il backup e' valido */ }
  return null;
}

function listProjects() {
  return fs.readdirSync(PROJECTS_DIR)
    .filter(f => /^\d+\.json$/.test(f))
    .map(f => {
      try {
        const o = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8'));
        return { id: o.id, name: o.name, created_at: o.created_at, updated_at: o.updated_at };
      } catch (_) { return null; }
    })
    .filter(Boolean)
    // Fallback su stringa vuota: un JSON progetto valido ma privo di `updated_at`
    // (importato da una versione vecchia o copiato a mano) faceva throw su
    // `undefined.localeCompare` -> 500 sull'INTERA lista progetti (utente bloccato
    // su ogni progetto). Ora quel record finisce in coda, la lista regge.
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

module.exports = {
  PROJECTS_DIR, ASSETS_DIR, atomicWriteFile, nextId, saveProject, loadProject, listProjects,
  extractBgAsset, reattachBgAsset, removeBgAsset,
};
