'use strict';
// ============================================================
//  Persistenza progetti — file JSON in /projects
//  Estratto da server.js (comportamento invariato).
// ============================================================
const fs   = require('fs');
const fsp  = require('fs/promises');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { PROJECT_STATE_SCHEMA_VERSION } = require('../lib/project-format.js');
const { migrateIpam } = require('../lib/ipam-model.js');
const { cleanUserText } = require('../lib/user-text.js');   // la forma di una stringa che l'utente sceglie: senza controlli, con un tetto
// `LAYOUT_TYPES` (oggi: `room`) è la denylist strutturale GIÀ definita e motivata
// lato server in lib/api-shape.js. Riusarla — invece di riscrivere qui `!== 'room'`
// — è ciò che tiene UNO il significato di «quanti apparati»: il conteggio della
// lista progetti e quello della sotto-header devono dare lo stesso numero, o il
// riquadro della mappa contraddice la barra dentro la stessa sede.
const { LAYOUT_TYPES } = require('../lib/api-shape.js');

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
// ⚠️ Il nome del temporaneo identifica la SCRITTURA, non il processo. Prima era
// `<file>.<pid>.tmp`: dentro un processo tutte le scritture dello stesso file
// condividevano quel nome. Oggi non fa danno — sono sincrone, non si intrecciano —
// ma e' una trappola che scatta il giorno che questa I/O diventa asincrona, e a
// quel punto due salvataggi si sovrascriverebbero il temporaneo A VICENDA, PRIMA
// del rename: il rename resterebbe atomico e il file finale conterrebbe meta' di
// una scrittura e meta' dell'altra, senza che niente segnali un errore.
// ⚠️ Prima il NOME, poi semmai l'asincrono: nell'altro ordine il guasto e' gia'
// passato, e si presenta come un JSON valido col contenuto sbagliato.
// Il contatore basta e non serve altro: il pid separa i processi, il progressivo
// separa le scritture dentro un processo. Niente orologio e niente casualita', che
// renderebbero il nome irriproducibile in una prova.
let _tmpSeq = 0;
function _tmpPath(file) { return `${file}.${process.pid}.${++_tmpSeq}.tmp`; }

// ⚠️ E un nome unico OBBLIGA a ripulire. Col nome fisso un temporaneo rimasto
// indietro veniva riusato dalla scrittura dopo; con un nome nuovo ogni volta,
// ogni fallimento lascerebbe un orfano che nessuno raccoglie piu'. Il `finally`
// lo toglie: se il rename e' avvenuto, il temporaneo non c'e' gia' piu'.
function atomicWriteFile(file, data, mode) {
  const tmp = _tmpPath(file);
  let rinominato = false;
  try {
    const fd = (mode !== undefined) ? fs.openSync(tmp, 'w', mode) : fs.openSync(tmp, 'w');
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
    rinominato = true;
  } finally {
    if (!rinominato) { try { fs.unlinkSync(tmp); } catch (_) { /* non c'e': niente da togliere */ } }
  }
}

// La stessa scrittura, ASINCRONA. Serve al salvataggio dei progetti, che e'
// l'unico posto dove il file e' grande abbastanza da farsi sentire: mentre il
// disco lavora, l'event loop e' fermo e ogni altra richiesta aspetta. Misurato
// prima di toccare niente (500 apparati, 145 KB): una rotta che non c'entra
// niente passa da 2,5 a 12,8 ms di p95 — cinque volte, e il picco a 16,9.
// ⚠️ I PASSI SONO GLI STESSI E NELL'ORDINE STESSO, e non e' una coincidenza da
// tenere a mente: c'e' una guardia che li confronta leggendo le due funzioni
// (test/projects-store-async.test.js). Due copie di una regola vanno bene solo
// finche' qualcosa verifica che siano la stessa regola.
// L'unica differenza e' il .bak: la versione sincrona chiede prima se il file
// c'e', questa prova a copiarlo e accetta il fallimento — che e' lo stesso caso
// (non c'era), senza la finestra fra la domanda e la risposta.
async function atomicWriteFileAsync(file, data, mode) {
  const tmp = _tmpPath(file);
  let rinominato = false;
  try {
    const fh = await fsp.open(tmp, 'w', mode);
    try {
      await fh.writeFile(data, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    try { await fsp.copyFile(file, `${file}.bak`); } catch (_) { /* non c'era: niente da salvare */ }
    await fsp.rename(tmp, file);
    rinominato = true;
  } finally {
    if (!rinominato) { try { await fsp.unlink(tmp); } catch (_) { /* non c'e': niente da togliere */ } }
  }
}

// ---- Una coda per progetto -------------------------------------------------
// ⚠️⚠️ Questa coda NON e' un ottimizzazione: e' cio' che rende l'asincrono sicuro.
// Con l'I/O sincrona due salvataggi dello stesso progetto non potevano
// sovrapporsi — il gestore arrivava in fondo senza mai cedere il turno, e il
// controllo di versione (If-Match) valeva ancora nell'istante della scrittura.
// Appena la scrittura diventa asincrona quella garanzia sparisce: due richieste
// passano tutt'e due il controllo sulla versione VECCHIA e la seconda riscrive
// sopra la prima, con 200 a tutt'e due. E' esattamente il difetto grave chiuso
// in 60969f3, che tornerebbe dalla finestra.
// Quindi: un turno per chiave, e chi entra trova il disco come l'ha lasciato
// chi c'era prima. La chiave e' l'id del progetto; '#nuovo' serve alla CREAZIONE,
// dove il numero lo decide una lettura della cartella e due creazioni in volo
// sceglierebbero lo stesso.
const CHIAVE_NUOVO = '#nuovo';
const _codaPerChiave = new Map();
// Rientranza: chi e' GIA' dentro il turno di una chiave non si mette in coda
// dietro se stesso (si bloccherebbe per sempre). Serve un contesto vero, non un
// flag globale: con l'asincrono un'altra richiesta puo' girare mentre questa
// aspetta il disco, e un flag direbbe «sei dentro» anche a lei.
const _turniAperti = new AsyncLocalStorage();

function withProject(chiave, fn) {
  const k = String(chiave);
  const tenute = _turniAperti.getStore();
  if (tenute && tenute.has(k)) return Promise.resolve().then(fn);
  const mie = new Set(tenute || []);
  mie.add(k);
  const precedente = _codaPerChiave.get(k) || Promise.resolve();
  const dentro = () => _turniAperti.run(mie, fn);
  const turno = precedente.then(dentro);
  // ⚠️ In coda si mette la versione con l'esito GIA' RACCOLTO, e li' sta la
  // protezione: un turno fallito non deve lasciare quel progetto non piu'
  // salvabile fino al riavvio — cioe' un guasto passeggero che diventa permanente,
  // e in silenzio. ⭐ Ci avevo messo anche un gestore di rifiuto su `turno`
  // (`.then(dentro, dentro)`) spiegandolo con questa stessa ragione: e' morto, e
  // la controprova l'ha detto restando VERDE. `precedente` e' sempre questa coda,
  // quindi non puo' rifiutare, e quel secondo gestore non girerebbe mai.
  const coda = turno.then(() => {}, () => {});
  _codaPerChiave.set(k, coda);
  // La mappa non deve crescere per sempre: la chiave se ne va quando la coda si
  // svuota, e solo se nessuno si e' accodato nel frattempo.
  coda.then(() => { if (_codaPerChiave.get(k) === coda) _codaPerChiave.delete(k); });
  return turno;
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
// ⚠️ ASINCRONA come quella del progetto, e per lo stesso motivo misurato: una
// planimetria e' grossa (1,5 MB nel banco) e sincrona fermava l'event loop per
// tutto il tempo — una rotta che non c'entra niente passava a 13,8 ms di p95
// (×4,5), cioe' esattamente il blocco appena tolto al JSON, che tornava intero
// ogni volta che l'utente cambia la piantina.
// La MANCANZA del .bak e' l'unica differenza voluta rispetto alle altre due
// scritture atomiche, e la guardia dei passi la dichiara invece di ignorarla.
async function _writeAssetAtomic(file, buf) {
  const tmp = _tmpPath(file);
  let rinominato = false;
  try {
    const fh = await fsp.open(tmp, 'w');
    try { await fh.writeFile(buf); await fh.sync(); } finally { await fh.close(); }
    await fsp.rename(tmp, file);
    rinominato = true;
  } finally {
    if (!rinominato) { try { await fsp.unlink(tmp); } catch (_) { /* niente da togliere */ } }
  }
}

// «C'e'?» in versione asincrona. Non e' una comodita': dentro `extractBgAsset` la
// domanda sta in mezzo a una catena di await, e un existsSync li' sarebbe l'unico
// passo che ferma tutto per niente.
async function _esiste(p) {
  try { await fsp.access(p); return true; } catch (_) { return false; }
}

// Ritorna una COPIA dello stato pronta per il disco: se bgImage è un data-URL lo
// scrive su asset (saltando la riscrittura se l'hash combacia col precedente) e lo
// sostituisce col riferimento. Non muta `state` (il client tiene il suo data-URL).
// ⚠️ Rende una PROMESSA da quando la scrittura dell'asset e' asincrona: chi la
// chiama deve aspettarla, se no il JSON del progetto punta a un file che non c'e'
// ancora — e chi apre in quel momento vede un progetto senza planimetria.
async function extractBgAsset(id, state, assetsDir, prevMeta) {
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
      // ⭐ La scrittura si SALTA quando l'immagine e' la stessa (l'hash decide), ed
      // e' il caso normale: la piantina si mette una volta e poi si salva cento
      // volte. Per questo la misura che conta e' il salvataggio che la CAMBIA —
      // negli altri non c'e' nessuna scrittura d'asset da rendere asincrona.
      let unchanged = !!(prevMeta && prevMeta.bgImageHash === hash && prevMeta.bgImageAsset === fname);
      if (unchanged) unchanged = await _esiste(fpath);
      if (!unchanged) {
        if (!await _esiste(assetsDir)) await fsp.mkdir(assetsDir, { recursive: true });
        if (prevAsset && prevAsset !== fname) { try { await fsp.unlink(path.join(assetsDir, prevAsset)); } catch (_) {} }
        await _writeAssetAtomic(fpath, p.buf);
      }
      out.bgImage = null;
      out.bgImageAsset = fname;
      out.bgImageHash = hash;
      return out;
    }
  }
  // nessuna immagine (o non-dataurl): rimuovi l'asset precedente e i riferimenti
  if (prevAsset) { try { await fsp.unlink(path.join(assetsDir, prevAsset)); } catch (_) {} }
  out.bgImage = (typeof out.bgImage === 'string' && !out.bgImage.startsWith('data:')) ? out.bgImage : null;
  delete out.bgImageAsset;
  delete out.bgImageHash;
  return out;
}

// Riattacca il data-URL leggendo l'asset; ripulisce i campi di storage così il
// round-trip è pulito (il client non vede mai bgImageAsset/bgImageHash).
function reattachBgAsset(proj, assetsDir) {
  const st = proj && proj.state;
  // Schema 2: la subnet esce dalla VLAN e diventa un prefisso. La migrazione gira
  // anche QUI, non solo nel client: la REST API, l'inventario Ansible, il PDF e
  // l'assistente leggono il progetto dal disco senza passare da _migrateState, e
  // un file scritto in formato 1 sarebbe arrivato loro senza nessuna subnet.
  // Solo in memoria: il file cambia quando il client salva. Idempotente.
  if (st) migrateIpam(st);
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

// ⚠️ Rende una PROMESSA: chi salva deve aspettarla. Senza l'attesa la risposta
// parte prima che il file esista, e la lettura che segue puo' non trovarlo — un
// 404 su un progetto appena creato, oppure lo stato di prima su uno appena
// salvato. La coda per progetto (withProject) serializza le scritture: due
// salvataggi dello stesso progetto non si sovrappongono mai, e chi entra trova
// il disco come l'ha lasciato chi c'era prima.
function saveProject(id, name, state, createdAt, updatedAt) {
  return withProject(id, () => _salvaOra(id, name, state, createdAt, updatedAt));
}

async function _salvaOra(id, name, state, createdAt, updatedAt) {
  // Il NOME passa dalla forma condivisa (lib/user-text.js) qui e non nelle rotte:
  // è il collo di bottiglia di OGNI scrittura — crea, salva, copia, import DCIM —
  // quindi una via sola invece di quattro guardie da tenere allineate.
  // Misurato prima: un nome da 2 MB finiva su disco per intero (file da 2.048 KB),
  // e `\r\n`/NUL/ESC ci entravano tali e quali — mentre il puntatore backup, due
  // moduli più in là, li rifiuta dal primo giorno.
  name = cleanUserText(name);
  const file = path.join(PROJECTS_DIR, `${id}.json`);
  // Meta precedente (per saltare la riscrittura dell'asset se l'immagine è invariata).
  // Letto dal JSON RAW su disco (ha bgImageHash), non dallo stato riattaccato.
  let prevMeta = null;
  // Il file che non c'e' e il file illeggibile finiscono nello stesso ramo, ed e'
  // giusto: in tutt'e due i casi non c'e' un meta precedente da riusare.
  try { prevMeta = (JSON.parse(await fsp.readFile(file, 'utf8')).state) || null; } catch (_) { /* ignora */ }
  const storeState = await extractBgAsset(id, state, ASSETS_DIR, prevMeta);
  const rawVersion = Number(storeState.schemaVersion);
  storeState.schemaVersion = Number.isInteger(rawVersion) && rawVersion > 0
    ? rawVersion : PROJECT_STATE_SCHEMA_VERSION;
  await atomicWriteFileAsync(file, JSON.stringify(
    { format: 'infranet-project', schemaVersion: storeState.schemaVersion, id, name, created_at: createdAt, updated_at: updatedAt, state: storeState }
  ));
  // ⚠️ Chi ha scritto LO SA: la riga d'elenco tenuta da parte per questo progetto
  // non vale piu'. La firma su disco se ne accorgerebbe da sola quasi sempre, ma
  // «quasi» qui ha un caso vero — due scritture nello stesso millesimo e con la
  // stessa dimensione — e capita dove le scritture sono piu' fitte, cioe' in una
  // prova. Non e' una ridondanza: le due vie coprono due popolazioni diverse di
  // scrittori, la firma quelli che non controlliamo e questa riga l'unico che si
  // controlla.
  _cacheRighe.delete(`${id}.json`);
}

// ---- Leggere un progetto, e sapere DA DOVE --------------------------------
// `source`: 'main' quando si è letto il file del progetto, 'backup' quando si è
// dovuto ripiegare sull'ultima copia valida. `reason` dice quale dei due modi di
// non poter leggere: 'missing' (il file non c'è) oppure 'unreadable' (c'è e non
// si apre — un JSON troncato, ma su Windows anche un lock momentaneo di un
// antivirus o di un backup, che è il caso in cui il principale era SANO).
//
// ⚠️ **Perché ripiegare in silenzio non basta.** Il ripiego serve un contenuto
// più VECCHIO senza dirlo, e nello stesso istante `projectEtag` risponde `null`
// — «non lo so», che per disegno lascia passare il salvataggio (v. sotto). Chi
// apre, modifica e salva riscrive quindi il file principale con lo stato
// recuperato: da lì in poi la versione più vecchia È il progetto, e quella che
// c'era non la nomina più nessuno. Le due scelte sono giuste una per una; è il
// loro incrocio che perde lavoro. La cura non è rifiutare il salvataggio —
// punirebbe l'utente per un dubbio nostro — ma DIRLO a chi ha in mano il file,
// prima che ci scriva sopra.
function readProjectFile(id) {
  const file = path.join(PROJECTS_DIR, `${id}.json`);
  // Senza valore iniziale apposta: ogni via che arriva in fondo ne assegna uno,
  // e un `null` di partenza sarebbe un ripiego che nessuna riga legge mai.
  let reason;
  if (fs.existsSync(file)) {
    try {
      return { project: reattachBgAsset(JSON.parse(fs.readFileSync(file, 'utf8')), ASSETS_DIR), source: 'main', reason: null };
    } catch (_) { reason = 'unreadable'; }
  } else {
    reason = 'missing';
  }
  try {
    const bak = `${file}.bak`;
    if (fs.existsSync(bak)) {
      return { project: reattachBgAsset(JSON.parse(fs.readFileSync(bak, 'utf8')), ASSETS_DIR), source: 'backup', reason };
    }
  } catch (_) { /* nemmeno il backup e' valido */ }
  return { project: null, source: null, reason };
}

// Il progetto e basta. La usano tutti i chiamanti che non hanno nessuno a cui
// dirlo (export, REST API v1, assistente, storico): il comportamento è quello di
// sempre, e non devono imparare niente di nuovo per continuare a funzionare.
function loadProject(id) {
  return readProjectFile(id).project;
}

// ---- Da cosa si capisce che un file e' cambiato -----------------------------
// Due fatti, e sempre gli stessi: quando e' stato scritto (al millesimo) e quanto
// e' grande. Li leggono DUE cose che sembrano lontane — il marcatore di versione
// qui sotto e la cache dell'elenco piu' giu' — e devono leggere gli stessi, perche'
// rispondono alla stessa domanda: «questo file e' ancora quello di prima?».
//
// ⭐ Se la coppia basta a RIFIUTARE un salvataggio perche' qualcuno ha riscritto il
// progetto sotto chi sta salvando, basta anche a dire che una riga d'elenco tenuta
// da parte e' ancora buona: il secondo uso e' piu' debole del primo, non piu' forte.
// E se un giorno non bastasse piu', i due sbaglierebbero INSIEME, da un posto solo —
// che e' la ragione per cui la coppia sta qui e non scritta due volte.
//
// `null` = il file non si puo' interrogare. Mai «invariato».
function _versioneFile(p) {
  try { const st = fs.statSync(p); return { mtimeMs: st.mtimeMs, size: st.size }; }
  catch (_) { return null; }
}

function _firmaFile(p) {
  const v = _versioneFile(p);
  return v ? `${v.mtimeMs}-${v.size}` : null;
}

// ---- Marcatore di versione (ETag) -------------------------------------------
// A che serve: al PUT, per accorgersi che il progetto è cambiato SOTTO chi sta
// salvando. Senza, due sessioni che salvano lo stesso progetto ricevono entrambe
// 200 e il lavoro di una delle due sparisce senza che nessuno lo dica — e con
// `data/organization.json`, che è UNO per installazione, bastano due sessioni
// qualsiasi, non due che hanno aperto lo stesso progetto.
//
// Si ricava dal FILE (mtime in millisecondi + dimensione), non dal documento: il
// formato non cambia e i progetti già scritti ne hanno uno da subito, senza
// migrazione.
//
// ⚠️ NON si usa `updated_at`: `timestamp()` (utils.js) tronca ai SECONDI, quindi
// due salvataggi nello stesso secondo darebbero lo stesso marcatore — e due
// salvataggi nello stesso secondo sono ESATTAMENTE il caso da riconoscere. Un
// marcatore che si ripete proprio quando serve non è un marcatore.
//
// `null` quando il file non c'è o non è leggibile: niente marcatore, nessuna
// pretesa. Chi confronta deve trattare `null` come «non posso saperlo» e lasciar
// passare, non come «non combacia» (rifiutare un salvataggio per un file che non
// siamo riusciti a interrogare punirebbe l'utente per un nostro dubbio).
//
// ⚠️ Il marcatore viaggia in un header e il client ne tiene uno in mano fra
// l'apertura e il salvataggio: cambiargli FORMA farebbe fallire il confronto di
// ogni scheda gia' aperta, cioe' un «qualcuno ha modificato il progetto» FALSO al
// primo salvataggio dopo l'aggiornamento. Per questo la forma si scrive UNA volta
// sola, qui: da quando anche l'organizzazione ha il suo marcatore i chiamanti sono
// due, e due copie della stessa forma sarebbero due copie che un giorno divergono.
function fileEtag(p) {
  const v = _versioneFile(p);
  return v ? `W/"${Math.round(v.mtimeMs)}-${v.size}"` : null;
}
function projectEtag(id) {
  return fileEtag(path.join(PROJECTS_DIR, `${id}.json`));
}

// Quanto c'è DENTRO un progetto, per chi lo guarda da fuori (il riquadro-sede
// della mappa inter-sede lo mostra prima di entrarci).
//
// ⚠️ `null`, non `0`, quando lo stato non c'è o non è leggibile. Un progetto
// senza `state` — importato da una versione vecchia, o copiato a mano — non è un
// progetto VUOTO: è un progetto di cui non sappiamo il contenuto. Scrivere `0`
// sarebbe un ripiego che a valle nessuno distingue da una misura, e la mappa
// direbbe «questa sede non ha apparati» di una sede che ne ha trenta.
function _projectCounts(state) {
  if (!state || typeof state !== 'object') return { devices: null, racks: null };
  const nodes = Array.isArray(state.nodes) ? state.nodes : null;
  const racks = Array.isArray(state.racks) ? state.racks : null;
  return {
    devices: nodes ? nodes.filter(n => n && !LAYOUT_TYPES.has(n.type)).length : null,
    racks: racks ? racks.length : null,
  };
}

// ⚠️ **Un progetto illeggibile non deve SPARIRE dalla lista.** Misurato dal
// vivo: con il file principale troncato questo record cadeva, e con esso il
// progetto — la tendina non lo mostrava più, l'avviso di recupero non poteva
// scattare (nessuno chiedeva quell'id), e se era l'unico progetto l'avvio ne
// creava uno NUOVO e vuoto, che è il modo più silenzioso di far sembrare perso
// un lavoro che sta ancora tutto lì, nel `.bak` accanto. La riga si ricostruisce
// quindi dall'ultima copia valida — lo stesso ripiego dell'apertura, non un
// secondo — e solo se manca anche quella il record cade davvero.
// Costa zero sulla via normale: il ripiego vive dentro il `catch`.
function _rigaLista(o) {
  // Il parse dell'intero file avviene comunque (serve a id/name/date): i
  // conteggi costano una scansione dell'array già in memoria, non un I/O.
  const c = _projectCounts(o.state);
  return { id: o.id, name: o.name, created_at: o.created_at, updated_at: o.updated_at,
           devices: c.devices, racks: c.racks };
}

// ---- L'elenco, pagato una volta per SCRITTURA e non una per lettura ---------
// Misurato prima di toccarlo, 40 giri sincroni, su DUE regimi: sullo store reale
// (19 progetti, 0,72 MB) **9,9 ms p50**; su dodici progetti da 1000 nodi (5,79 MB)
// **67,9 p50 e 84,0 p95** — e l'audit del 30/08, su 7,6 MB, misurava 102 e 251.
// ⚠️ Non sono due difetti: sono lo stesso codice a due REGIMI, e quello che conta e'
// il secondo, perche' e' il profilo cliente (dodici sedi da cinquecento apparati).
// Il primo numero, da solo, direbbe che qui non c'e' niente da sistemare.
//
// Perche' fa male: e' tutto sincrono nel processo unico del server, quindi per quella
// durata NON viene servita nessun'altra richiesta, di nessun utente. E il conteggio
// apparati per sede del pannello inter-sede esce da qui — il costo cresce col numero
// di sedi, cioe' proprio con cio' che rende grande un'installazione.
//
// La riga d'elenco di un progetto dipende SOLO dal suo file: quindi si tiene da parte
// e si rifa' quando il file cambia. Il parse si paga una volta per scrittura invece
// che una per lettura.
//
// ⚠️ La mappa si RICOSTRUISCE a ogni giro con i soli file che ci sono davvero, invece
// di cancellare le voci morte: un progetto eliminato esce da solo, e la cache non puo'
// crescere oltre il numero di file. Non c'e' un elenco da tenere aggiornato a mano.
//
// ⚠️ Le righe escono COPIATE. Prima ogni chiamata ne costruiva di nuove e il chiamante
// se le teneva; consegnare quelle della cache vorrebbe dire che un chiamante che ne
// modifica una — oggi nessuno lo fa, ma e' una riga in un'altra rotta — avvelenerebbe
// tutte le letture successive. Il contratto non cambia perche' e' cambiato il modo di
// fare il conto.
let _cacheRighe = new Map();

// La riga di un file, con la firma di cio' da cui e' stata ricavata.
// `daBak`: la riga non viene dal file principale ma dall'ultima copia valida, e allora
// va sorvegliata anche la copia — se no una riga ricavata da un `.bak` poi riscritto
// resterebbe ferma per sempre.
function _voceElenco(file, firma) {
  try {
    return { firma, daBak: false, firmaBak: null, riga: _rigaLista(JSON.parse(fs.readFileSync(file, 'utf8'))) };
  } catch (_) { /* principale illeggibile → l'ultima copia valida */ }
  // ⚠️ La firma del ripiego si prende PRIMA di leggerlo. Presa dopo, se il `.bak`
  // venisse riscritto nel mezzo, terrebbe da parte la firma NUOVA accanto a un
  // contenuto vecchio: uno stantio che non scade piu'.
  const bak = `${file}.bak`;
  const firmaBak = _firmaFile(bak);
  let riga = null;
  try { riga = _rigaLista(JSON.parse(fs.readFileSync(bak, 'utf8'))); }
  catch (_) { /* nemmeno la copia e' valida: qui il record cade davvero */ }
  return { firma, daBak: true, firmaBak, riga };
}

function listProjects() {
  const nuova = new Map();
  const righe = [];
  for (const f of fs.readdirSync(PROJECTS_DIR)) {
    if (!/^\d+\.json$/.test(f)) continue;
    const file = path.join(PROJECTS_DIR, f);
    // La firma si legge PRIMA del contenuto, per lo stesso motivo del `.bak`.
    const firma = _firmaFile(file);
    const vecchia = _cacheRighe.get(f);
    // ⚠️ Due `null` combaciano, ed e' voluto: se il file non si riesce a interrogare
    // (su Windows un lock momentaneo di un antivirus e' il caso normale) la riga di
    // prima e' la risposta migliore che abbiamo. L'alternativa sarebbe far SPARIRE il
    // progetto dall'elenco, che questo file ha gia' deciso di non fare mai.
    const buona = !!vecchia && vecchia.firma === firma
      && (!vecchia.daBak || vecchia.firmaBak === _firmaFile(`${file}.bak`));
    const voce = buona ? vecchia : _voceElenco(file, firma);
    nuova.set(f, voce);
    if (voce.riga) righe.push({ ...voce.riga });
  }
  _cacheRighe = nuova;
  return righe
    // Fallback su stringa vuota: un JSON progetto valido ma privo di `updated_at`
    // (importato da una versione vecchia o copiato a mano) faceva throw su
    // `undefined.localeCompare` -> 500 sull'INTERA lista progetti (utente bloccato
    // su ogni progetto). Ora quel record finisce in coda, la lista regge.
    // ⚠️ A PARITÀ di `updated_at` decide l'id, dal più recente. Senza questo
    // spareggio l'ordine dei pari non era definito: `timestamp()` (utils.js)
    // tronca ai SECONDI, quindi due progetti salvati nello stesso secondo
    // confrontano uguale e a decidere restava l'ordine di `readdirSync` — che è
    // lessicografico sui nomi di file, quindi `10.json` prima di `2.json`, e non
    // è nemmeno garantito dal filesystem. Non è un dettaglio da test: all'avvio
    // l'app apre `list[0]`, così *quale progetto si apre* poteva cambiare fra un
    // riavvio e l'altro, e la tendina mostrare due ordini diversi per gli stessi
    // dati. L'id cresce nel tempo: a parità di secondo, l'ultimo creato è l'ultimo
    // toccato — stessa direzione dell'ordinamento, non una regola nuova.
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
                 || (Number(b.id) || 0) - (Number(a.id) || 0));
}

// Id progetto SICURO: intero positivo, o null. `loadProject` fa
// path.join(PROJECTS_DIR, `${id}.json`): senza coercizione un projectId preso
// da un body ("../projects/2") usciva dalla cartella (smoke 06/09: la
// /dcim/compare lo passava crudo). Le route con :id usano già `+req.params.id`.
function safeProjectId(raw) {
  const n = Number(raw);
  return (Number.isInteger(n) && n > 0) ? n : null;
}

module.exports = {
  PROJECTS_DIR, ASSETS_DIR, atomicWriteFile, atomicWriteFileAsync, withProject, CHIAVE_NUOVO,
  _tmpPath, nextId, saveProject, loadProject, readProjectFile, listProjects, safeProjectId,
  extractBgAsset, reattachBgAsset, removeBgAsset, projectEtag, fileEtag,
};
