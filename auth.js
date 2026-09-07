'use strict';
// ============================================================
//  InfraNet Pro — Auth module
//  Gestione utenti, sessioni, middleware ruoli
// ============================================================

const fs        = require('fs');
const path      = require('path');
const crypto    = require('crypto');
const bcrypt    = require('bcryptjs');
const session   = require('express-session');
const rateLimit = require('express-rate-limit');
// Helper della libreria: normalizza l'IP (mascheratura /56 dell'IPv6) per una
// keyGenerator personalizzata — express-rate-limit v8 lo richiede quando si compone
// la chiave a partire da req.ip, altrimenti avverte del rischio di bypass IPv6.
const ipKeyGenerator = rateLimit.ipKeyGenerator;
const { timestamp } = require('./utils');
const { atomicWriteFile } = require('./server/projects-store');

// Override via INFRANET_USERS_FILE: tiene gli account su un volume dati persistente
// (es. /data/users.json in Docker); default invariato su bare-metal.
const USERS_FILE  = process.env.INFRANET_USERS_FILE || path.join(__dirname, 'users.json');
const BCRYPT_COST = 12;
// Hash fittizio (stesso costo di quelli reali) contro cui confrontare la password
// quando lo username NON esiste: equipara il tempo di risposta del login e nega
// l'enumerazione degli utenti validi via timing. Calcolato una volta al boot.
const _DUMMY_HASH = bcrypt.hashSync('infranet-dummy', BCRYPT_COST);

// ---- Bypass auth SOLO per sviluppo (off di default) -------------------------
// Attivabile con INFRANET_DEV_NO_AUTH=1: inietta una sessione admin fittizia così
// gli strumenti di preview/anteprima possono vedere la UI senza login.
// SEC-M2 (audit 2026-07-21): fail-closed. Il bypass è onorato SOLO se il server è
// legato al loopback (dev locale) e NON è in produzione. Con un HOST di rete
// (0.0.0.0/::/IP) o NODE_ENV=production il flag viene IGNORATO: un no-auth su
// un'interfaccia raggiungibile darebbe accesso admin a chiunque la contatti.
function _computeDevNoAuth(env) {
  env = env || {};
  if (env.INFRANET_DEV_NO_AUTH !== '1') return { requested: false, enabled: false, reason: '' };
  if (env.NODE_ENV === 'production') return { requested: true, enabled: false, reason: 'NODE_ENV=production' };
  const host = String(env.HOST || '127.0.0.1').trim().toLowerCase();
  const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  if (!loopback) return { requested: true, enabled: false, reason: `HOST=${env.HOST} non è loopback` };
  return { requested: true, enabled: true, reason: '' };
}
const _DEV_NO_AUTH = _computeDevNoAuth(process.env);
const DEV_NO_AUTH = _DEV_NO_AUTH.enabled;
const DEV_USER = { id: 0, username: 'dev', role: 'admin' };

// ---- Reverse-proxy TLS ------------------------------------------------------
// Dietro un reverse-proxy che termina il TLS: INFRANET_TRUST_PROXY=1 marca il
// cookie di sessione come `secure` (inviato solo su HTTPS) e fa fidare Express
// dell'header X-Forwarded-*. OFF di default → su HTTP/localhost nulla cambia.
const TRUST_PROXY = process.env.INFRANET_TRUST_PROXY === '1';

// ---- Secret auto-generato (persiste tra riavvii grazie a .session-secret) --

// Override via INFRANET_SESSION_SECRET_FILE: in Docker (utente non-root, /app di
// sola lettura) il secret auto-generato deve poter essere scritto su un path
// scrivibile e persistente (/data), altrimenti l'avvio senza SESSION_SECRET nell'
// ambiente fallirebbe con EACCES. Default invariato su bare-metal.
const SECRET_FILE = process.env.INFRANET_SESSION_SECRET_FILE || path.join(__dirname, '.session-secret');

function _genSecret() {
  if (fs.existsSync(SECRET_FILE)) {
    // Retrofit permessi: un file preesistente poteva essere stato scritto coi
    // permessi di default (world-readable) → il secret firma TUTTI i cookie di
    // sessione, quindi chi lo legge forgia sessioni admin. Lo irrigidiamo a 0o600.
    try { fs.chmodSync(SECRET_FILE, 0o600); } catch (_) { /* best-effort (no-op su Windows) */ }
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  }
  // CSPRNG (NON Math.random): il secret firma i cookie di sessione → deve essere
  // imprevedibile. 48 byte casuali → ~64 char base64 ad alta entropia. 0o600:
  // leggibile solo dal proprietario (mai da altri utenti dell'host).
  const s = crypto.randomBytes(48).toString('base64');
  fs.writeFileSync(SECRET_FILE, s, { encoding: 'utf8', mode: 0o600 });
  return s;
}

const SESSION_SECRET = process.env.SESSION_SECRET || _genSecret();

// ---- Users storage ----------------------------------------------------------

// Legge e parsa il file utenti distinguendo TRE esiti (serve a ensureDefaultAdmin
// per non rigenerare l'admin sopra un DB corrotto → perdita silenziosa di account):
//   { ok:true,  users:[...] }              file valido (anche vuoto), o recuperato dal .bak
//   { ok:false, absent:true }              nessun file → primo avvio legittimo
//   { ok:false, absent:false }             file PRESENTE ma illeggibile/corrotto (e .bak idem)
function _readUsersFile() {
  const bak = `${USERS_FILE}.bak`;
  let mainErr = null;
  if (fs.existsSync(USERS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      if (Array.isArray(parsed)) return { ok: true, users: parsed };
      mainErr = new Error('users.json non e\' un array');
    } catch (e) { mainErr = e; }
  }
  // main assente o corrotto → prova il backup lasciato da atomicWriteFile
  if (fs.existsSync(bak)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(bak, 'utf8'));
      if (Array.isArray(parsed)) return { ok: true, users: parsed };
    } catch (_) { /* nemmeno il backup e' valido */ }
  }
  if (mainErr) return { ok: false, absent: false };  // c'era ma e' corrotto/non-array
  return { ok: false, absent: true };                 // davvero primo avvio
}

function loadUsers() {
  const r = _readUsersFile();
  return r.ok ? r.users : [];
}

function saveUsers(users) {
  // Scrittura atomica (temp + fsync + rename) con .bak, come i progetti: un crash a
  // meta' scrittura lascia intatto il file precedente invece di troncarlo.
  atomicWriteFile(USERS_FILE, JSON.stringify(users, null, 2));
}

function nextUserId(users) {
  // reduce() evita il limite dello stack di Math.max(...spread) su array grandi
  return users.reduce((max, u) => u.id > max ? u.id : max, 0) + 1;
}

// ---- Policy password --------------------------------------------------------
// Requisito minimo: la LUNGHEZZA. Niente vincoli di composizione (maiuscole/
// simboli obbligatori spingono a password prevedibili — «Password1!» — e sono
// scoraggiati dalle linee guida NIST). Vale a chi CREA o CAMBIA una password
// (createUser, updateUser, cambio-proprio); il LOGIN non la applica, perché si
// deve poter entrare con la password esistente qualunque essa sia. Ritorna un
// messaggio d'errore (stringa) o null se accettabile.
const MIN_PASSWORD_LEN = 8;
function _passwordError(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LEN) {
    return `La password deve avere almeno ${MIN_PASSWORD_LEN} caratteri`;
  }
  return null;
}

// ---- Invalidazione sessioni: un'EPOCA per utente ----------------------------
//
// Mappa in-memory id utente → epoca (contatore). Ogni sessione porta con sé
// l'epoca letta al login; un cambio di password o ruolo, o la cancellazione,
// incrementano l'epoca e ogni sessione più vecchia muore alla prima richiesta.
// Un NUOVO login non riabilita le vecchie: legge l'epoca corrente, le altre
// restano indietro. (Smoke 06/09: con un Set svuotato al login, una sessione
// declassata e lasciata intatta tornava admin appena l'utente rientrava
// altrove.) Si azzera al riavvio, come le sessioni Express.

const _sessionEpoch = new Map();
const _epochOf   = id => _sessionEpoch.get(id) || 0;
const _bumpEpoch = id => _sessionEpoch.set(id, _epochOf(id) + 1);
// Forma pubblica dell'utente in sessione: l'epoca resta dentro il server.
const _publicUser = u => ({ id: u.id, username: u.username, role: u.role });

// ---- Primo avvio: crea admin di default ------------------------------------

function ensureDefaultAdmin() {
  const r = _readUsersFile();

  // File PRESENTE ma illeggibile/corrotto (e nessun .bak valido): NON rigenerare.
  // Sovrascrivere qui con un admin fresco cancellerebbe in silenzio tutti gli
  // account. Meglio fermare l'avvio e chiedere intervento umano (ripristino).
  if (!r.ok && !r.absent) {
    console.error('');
    console.error('  ============================================================');
    console.error('  FATAL - users.json presente ma ILLEGGIBILE/CORROTTO');
    console.error(`         (${USERS_FILE})`);
    console.error('         NON rigenero l\'admin per non cancellare gli account.');
    console.error('         Ripristina il file (o il suo .bak) e riavvia.');
    console.error('  ============================================================');
    console.error('');
    throw new Error('users.json corrupt - refusing to overwrite existing accounts');
  }

  if (r.ok && r.users.length > 0) return;   // gia' inizializzato

  const pwd  = _randomPassword();
  const hash = bcrypt.hashSync(pwd, BCRYPT_COST);
  const now  = new Date().toISOString().replace('T', ' ').substring(0, 19);

  saveUsers([{ id: 1, username: 'admin', passwordHash: hash, role: 'admin', createdAt: now }]);

  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║   PRIMO AVVIO — Credenziali amministratore       ║');
  console.log('  ║                                                  ║');
  console.log(`  ║   Utente  :  admin                               ║`);
  console.log(`  ║   Password:  ${pwd.padEnd(35)} ║`);
  console.log('  ║                                                  ║');
  console.log('  ║   ⚠  Cambia la password al primo accesso!        ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');
}

function _randomPassword() {
  // CSPRNG + keyspace ampio: la password admin di primo avvio non deve essere
  // né prevedibile (Math.random) né a basso numero di combinazioni. Prefisso
  // leggibile + 12 char casuali url-safe da crypto.randomBytes (~72 bit).
  const w = ['Net','Pro','Rack','Infra','Switch','Vlan','Port','Link'];
  const word = w[crypto.randomInt(w.length)];
  const rand = crypto.randomBytes(9).toString('base64url');
  return `${word}-${rand}!`;
}

// ---- Session middleware -----------------------------------------------------

function sessionMiddleware() {
  return session({
    secret:            SESSION_SECRET,
    resave:            false,
    saveUninitialized: false,
    cookie: {
      httpOnly:  true,
      sameSite:  'strict',
      secure:    TRUST_PROXY,        // dietro reverse-proxy TLS → cookie solo su HTTPS
      maxAge:    8 * 60 * 60 * 1000, // 8 ore
    },
    name: 'infranet.sid',
  });
}

// ---- Rate limiter login -----------------------------------------------------

const loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minuti
  max:              10,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { ok: false, error: 'Troppi tentativi. Riprova tra 15 minuti.' },
  skipSuccessfulRequests: true,
  // Chiave IP+username, non il solo IP. Dietro un reverse-proxy senza
  // INFRANET_TRUST_PROXY (o nel bridge di docker-compose) tutte le richieste
  // arrivano da un unico IP: con la sola chiave-IP 10 tentativi di CHIUNQUE
  // bloccavano il login a TUTTI per 15' (smoke 06/09). Con IP+username l'attacco
  // a un utente non consuma il budget degli altri; un anonimo senza username
  // ricade sulla sola chiave-IP. `req.body` è già parsato (express.json globale
  // gira prima di questa route). Username non-stringa → si usa il solo IP.
  keyGenerator: (req) => {
    const ipKey = ipKeyGenerator(req.ip);
    const u = (req.body && typeof req.body.username === 'string') ? req.body.username.toLowerCase().trim() : '';
    return u ? `${ipKey}|${u}` : ipKey;
  },
});

// ---- Middleware autenticazione ----------------------------------------------

function requireAuth(req, res, next) {
  if (DEV_NO_AUTH) {                       // bypass dev: sessione admin fittizia
    if (req.session && !req.session.user) req.session.user = DEV_USER;
    return next();
  }
  if (req.session?.user) {
    // Sessione più vecchia dell'epoca corrente (cambio password / ruolo, utente
    // cancellato e ricreato con lo stesso id) → distrutta.
    if ((req.session.user.epoch || 0) !== _epochOf(req.session.user.id)) {
      req.session.destroy(() => {});
      if (req.method === 'GET' && !req.path.startsWith('/api/'))
        return res.redirect('/login');
      return res.status(401).json({ ok: false, error: 'Sessione scaduta — rieffettua il login' });
    }
    return next();
  }
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.redirect('/login');
  }
  return res.status(401).json({ ok: false, error: 'Non autenticato' });
}

function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  return res.status(403).json({ ok: false, error: 'Richiede privilegi amministratore' });
}

// ---- Route handlers ---------------------------------------------------------

function loginPage(req, res) {
  if (DEV_NO_AUTH || req.session?.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'login.html'));
}

function loginApi(req, res) {
  const { username, password } = req.body ?? {};
  // Tipo controllato PRIMA di usarli: un body {"username":{}} arrivava a
  // toLowerCase() e usciva come 500 (smoke 06/09).
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ ok: false, error: 'Username e password obbligatori' });
  }

  const users = loadUsers();
  const user  = users.find(u => u.username.toLowerCase() === username.toLowerCase());

  // Anti user-enumeration: esegui SEMPRE un compare bcrypt (contro l'hash fittizio
  // se l'utente non esiste) così il tempo di risposta non distingue "username
  // sconosciuto" da "password errata".
  const okPw = bcrypt.compareSync(password, user ? user.passwordHash : _DUMMY_HASH);
  if (!user || !okPw) {
    return res.status(401).json({ ok: false, error: 'Credenziali non valide' });
  }

  // Anti session-fixation: si RIGENERA l'id di sessione al passaggio da anonimo
  // ad autenticato, così un id piantato prima del login (via cookie preimpostato)
  // non sopravvive all'accesso. Solo DOPO la rigenerazione si scrive l'utente.
  req.session.regenerate(regenErr => {
    if (regenErr) return res.status(500).json({ ok: false, error: 'Errore sessione' });
    // L'epoca CORRENTE entra nella sessione nuova; quelle già aperte restano
    // all'epoca in cui sono nate e, se è passata, muoiono alla prossima richiesta.
    req.session.user = { id: user.id, username: user.username, role: user.role, epoch: _epochOf(user.id) };
    req.session.save(err => {
      if (err) return res.status(500).json({ ok: false, error: 'Errore sessione' });
      res.json({ ok: true, user: _publicUser(req.session.user) });
    });
  });
}

function logoutApi(req, res) {
  req.session.destroy(() => {
    res.clearCookie('infranet.sid');
    res.json({ ok: true });
  });
}

function meApi(req, res) {
  res.json({ ok: true, user: _publicUser(req.session.user) });
}

// Cambio password del PROPRIO account: ogni utente autenticato, viewer inclusi
// (che non hanno accesso alla gestione utenti admin-only). Richiede la password
// ATTUALE — difende da una sessione lasciata aperta o dirottata — e rispetta la
// policy. Le ALTRE sessioni dell'utente muoiono (epoca+1); QUESTA resta viva
// perché ne riallineiamo l'epoca: cambiare la propria password non deve
// disconnettere chi la sta cambiando.
function changeOwnPassword(req, res) {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    return res.status(400).json({ ok: false, error: 'Password attuale e nuova obbligatorie' });
  }
  const pErr = _passwordError(newPassword);
  if (pErr) return res.status(400).json({ ok: false, error: pErr });

  const users = loadUsers();
  const idx   = users.findIndex(u => u.id === req.session.user.id);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'Utente non trovato' });

  // compareSync SEMPRE (non un ramo che salta il bcrypt): la password attuale
  // sbagliata è un 403, non un errore di forma.
  if (!bcrypt.compareSync(currentPassword, users[idx].passwordHash)) {
    return res.status(403).json({ ok: false, error: 'Password attuale errata' });
  }

  users[idx].passwordHash = bcrypt.hashSync(newPassword, BCRYPT_COST);
  saveUsers(users);
  _bumpEpoch(req.session.user.id);                        // le ALTRE sessioni muoiono
  req.session.user.epoch = _epochOf(req.session.user.id);  // ...ma non questa
  req.session.save(err => {
    if (err) return res.status(500).json({ ok: false, error: 'Errore sessione' });
    res.json({ ok: true });
  });
}

// ---- User CRUD (admin only) -------------------------------------------------

function listUsers(req, res) {
  const users = loadUsers().map(({ id, username, role, createdAt }) =>
    ({ id, username, role, createdAt }));
  res.json(users);
}

function createUser(req, res) {
  const { username, password, role } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Username e password obbligatori' });
  }
  if (!['admin', 'viewer'].includes(role)) {
    return res.status(400).json({ ok: false, error: 'Ruolo non valido (admin|viewer)' });
  }
  const users = loadUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ ok: false, error: 'Username già esistente' });
  }
  const pErr = _passwordError(password);
  if (pErr) return res.status(400).json({ ok: false, error: pErr });
  const now  = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const user = {
    id:           nextUserId(users),
    username:     username.trim(),
    passwordHash: bcrypt.hashSync(password, BCRYPT_COST),
    role,
    createdAt:    now,
  };
  users.push(user);
  saveUsers(users);
  res.status(201).json({ ok: true, user: { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt } });
}

function updateUser(req, res) {
  const id    = parseInt(req.params.id);
  const users = loadUsers();
  const idx   = users.findIndex(u => u.id === id);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'Utente non trovato' });

  const { password, role } = req.body ?? {};

  // Se si imposta una nuova password, deve rispettare la policy (lunghezza).
  if (password !== undefined) {
    const pErr = _passwordError(password);
    if (pErr) return res.status(400).json({ ok: false, error: pErr });
  }
  // Impedisce di cambiare il proprio ruolo
  if (req.session.user.id === id && role && role !== users[idx].role) {
    return res.status(400).json({ ok: false, error: 'Non puoi cambiare il tuo ruolo' });
  }
  // Impedisce di eliminare l'ultimo admin
  if (role === 'viewer' && users[idx].role === 'admin') {
    const adminCount = users.filter(u => u.role === 'admin').length;
    if (adminCount <= 1) {
      return res.status(400).json({ ok: false, error: 'Deve esistere almeno un amministratore' });
    }
  }

  // Invalida le sessioni attive dell'utente se password o ruolo cambiano
  // (check PRIMA di aggiornare users[idx] per confrontare il valore corrente)
  if (password || (role && role !== users[idx].role)) _bumpEpoch(id);

  if (role) users[idx].role = role;
  if (password) users[idx].passwordHash = bcrypt.hashSync(password, BCRYPT_COST);

  saveUsers(users);
  res.json({ ok: true, user: { id: users[idx].id, username: users[idx].username, role: users[idx].role } });
}

function deleteUser(req, res) {
  const id    = parseInt(req.params.id);
  if (req.session.user.id === id) {
    return res.status(400).json({ ok: false, error: 'Non puoi eliminare te stesso' });
  }
  const users = loadUsers();
  const user  = users.find(u => u.id === id);
  if (!user) return res.status(404).json({ ok: false, error: 'Utente non trovato' });

  if (user.role === 'admin') {
    const adminCount = users.filter(u => u.role === 'admin').length;
    if (adminCount <= 1) {
      return res.status(400).json({ ok: false, error: 'Deve esistere almeno un amministratore' });
    }
  }

  _bumpEpoch(id); // ogni sessione dell'utente muore alla prossima richiesta; un futuro utente con lo stesso id non le eredita
  saveUsers(users.filter(u => u.id !== id));
  res.json({ ok: true, deleted_id: id });
}

// ---- Registra route su app Express -----------------------------------------

function register(app) {
  ensureDefaultAdmin();

  // Dietro reverse-proxy TLS: fidati dell'header X-Forwarded-Proto così il
  // cookie `secure` viene impostato anche se l'hop proxy→app è in chiaro.
  if (TRUST_PROXY) app.set('trust proxy', 1);

  if (DEV_NO_AUTH) {
    console.warn('');
    console.warn('  ⚠️  INFRANET_DEV_NO_AUTH=1 — AUTENTICAZIONE DISABILITATA (solo sviluppo)');
    console.warn('      Chiunque raggiunga il server entra come admin. NON usare in produzione.');
    console.warn('');
  } else if (_DEV_NO_AUTH.requested) {
    // Richiesto ma RIFIUTATO (fail-closed, SEC-M2): l'auth resta attiva.
    console.warn('');
    console.warn('  🔒 INFRANET_DEV_NO_AUTH=1 IGNORATO — auth ATTIVA.');
    console.warn(`      Motivo: ${_DEV_NO_AUTH.reason}. Il bypass è ammesso solo su loopback e fuori produzione.`);
    console.warn('');
  }

  app.use(sessionMiddleware());

  // Pagina login — pubblica
  app.get('/login', loginPage);

  // API auth — pubbliche
  app.post('/api/auth/login',  loginLimiter, loginApi);
  app.post('/api/auth/logout', logoutApi);

  // Tutto il resto richiede autenticazione
  app.use(requireAuth);

  // API auth — autenticate
  app.get('/api/auth/me', meApi);
  app.post('/api/auth/password', changeOwnPassword);   // cambio password proprio (ogni ruolo)

  // API utenti — solo admin
  app.get   ('/api/auth/users',     requireAdmin, listUsers);
  app.post  ('/api/auth/users',     requireAdmin, createUser);
  app.put   ('/api/auth/users/:id', requireAdmin, updateUser);
  app.delete('/api/auth/users/:id', requireAdmin, deleteUser);
}

module.exports = {
  register, requireAdmin,
  // esposti per i test (F16): store utenti + inizializzazione admin
  loadUsers, saveUsers, ensureDefaultAdmin, _readUsersFile,
  // SEC-M2: guardia pura del bypass auth (loopback + non-produzione)
  _computeDevNoAuth,
  // policy password (pura, testabile a tavolino)
  _passwordError, MIN_PASSWORD_LEN,
};
