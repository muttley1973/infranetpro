'use strict';
// ============================================================
//  InfraNet Pro — Auth module
//  Gestione utenti, sessioni, middleware ruoli
// ============================================================

const fs        = require('fs');
const path      = require('path');
const bcrypt    = require('bcryptjs');
const session   = require('express-session');
const rateLimit = require('express-rate-limit');
const { timestamp } = require('./utils');

const USERS_FILE  = path.join(__dirname, 'users.json');
const BCRYPT_COST = 12;

// ---- Bypass auth SOLO per sviluppo (off di default) -------------------------
// Attivabile con INFRANET_DEV_NO_AUTH=1: inietta una sessione admin fittizia così
// gli strumenti di preview/anteprima possono vedere la UI senza login. NON usare
// in produzione: il server è già localhost-bound, ma questo disattiva l'auth.
const DEV_NO_AUTH = process.env.INFRANET_DEV_NO_AUTH === '1';
const DEV_USER = { id: 0, username: 'dev', role: 'admin' };

// ---- Secret auto-generato (persiste tra riavvii grazie a .session-secret) --

const SECRET_FILE = path.join(__dirname, '.session-secret');

function _genSecret() {
  if (fs.existsSync(SECRET_FILE)) {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let s = '';
  for (let i = 0; i < 64; i++) s += chars[Math.floor(Math.random() * chars.length)];
  fs.writeFileSync(SECRET_FILE, s, 'utf8');
  return s;
}

const SESSION_SECRET = process.env.SESSION_SECRET || _genSecret();

// ---- Users storage ----------------------------------------------------------

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (_) { return []; }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function nextUserId(users) {
  // reduce() evita il limite dello stack di Math.max(...spread) su array grandi
  return users.reduce((max, u) => u.id > max ? u.id : max, 0) + 1;
}

// ---- Invalidazione sessioni ------------------------------------------------
//
// Set in-memory degli ID utente le cui sessioni devono essere invalidate.
// Viene popolato quando la password o il ruolo di un utente vengono cambiati.
// Si svuota al riavvio del server (le sessioni Express sono già perse al restart).

const _invalidatedUsers = new Set();

// ---- Primo avvio: crea admin di default ------------------------------------

function ensureDefaultAdmin() {
  const users = loadUsers();
  if (users.length > 0) return;

  const pwd  = _randomPassword();
  const hash = bcrypt.hashSync(pwd, BCRYPT_COST);
  const now  = new Date().toISOString().replace('T', ' ').substring(0, 19);

  users.push({ id: 1, username: 'admin', passwordHash: hash, role: 'admin', createdAt: now });
  saveUsers(users);

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
  const w = ['Net','Pro','Rack','Infra','Switch','Vlan','Port','Link'];
  const d = Math.floor(1000 + Math.random() * 9000);
  return w[Math.floor(Math.random() * w.length)] + d + '!';
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
});

// ---- Middleware autenticazione ----------------------------------------------

function requireAuth(req, res, next) {
  if (DEV_NO_AUTH) {                       // bypass dev: sessione admin fittizia
    if (req.session && !req.session.user) req.session.user = DEV_USER;
    return next();
  }
  if (req.session?.user) {
    // Controlla se la sessione è stata invalidata (cambio password / ruolo)
    if (_invalidatedUsers.has(req.session.user.id)) {
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
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Username e password obbligatori' });
  }

  const users = loadUsers();
  const user  = users.find(u => u.username.toLowerCase() === username.toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ ok: false, error: 'Credenziali non valide' });
  }

  req.session.user = { id: user.id, username: user.username, role: user.role };
  _invalidatedUsers.delete(user.id); // nuovo login → rimuove eventuale invalidazione pendente
  req.session.save(err => {
    if (err) return res.status(500).json({ ok: false, error: 'Errore sessione' });
    res.json({ ok: true, user: req.session.user });
  });
}

function logoutApi(req, res) {
  req.session.destroy(() => {
    res.clearCookie('infranet.sid');
    res.json({ ok: true });
  });
}

function meApi(req, res) {
  res.json({ ok: true, user: req.session.user });
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
  if (password || (role && role !== users[idx].role)) _invalidatedUsers.add(id);

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

  _invalidatedUsers.add(id); // forza logout immediato se l'utente ha una sessione attiva
  saveUsers(users.filter(u => u.id !== id));
  res.json({ ok: true, deleted_id: id });
}

// ---- Registra route su app Express -----------------------------------------

function register(app) {
  ensureDefaultAdmin();

  if (DEV_NO_AUTH) {
    console.warn('');
    console.warn('  ⚠️  INFRANET_DEV_NO_AUTH=1 — AUTENTICAZIONE DISABILITATA (solo sviluppo)');
    console.warn('      Chiunque raggiunga il server entra come admin. NON usare in produzione.');
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

  // API utenti — solo admin
  app.get   ('/api/auth/users',     requireAdmin, listUsers);
  app.post  ('/api/auth/users',     requireAdmin, createUser);
  app.put   ('/api/auth/users/:id', requireAdmin, updateUser);
  app.delete('/api/auth/users/:id', requireAdmin, deleteUser);
}

module.exports = { register, requireAdmin };
