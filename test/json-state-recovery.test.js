'use strict';
// ============================================================
// test/json-state-recovery.test.js — UNA politica per i file JSON di stato.
//
// Il difetto (provato il 01/10 su file temporanei, mai su quelli veri): se
// `organization.json` si corrompe — disco pieno, antivirus, un editor, una modifica
// a mano — `readOrganization()` rendeva l'organizzazione VUOTA senza provare il
// `.bak`, e il primo salvataggio dopo copiava il file corrotto SOPRA l'unica copia
// buona (`atomicWriteFile` fa `copyFile(file, file.bak)` prima del rename). Il
// guasto che il `.bak` esiste per coprire lo distruggeva proprio lui.
//
// Non era un caso solo: due store (utenti, progetti) leggevano dal `.bak`, e cinque
// (organizzazione, config AI, config DCIM, token API, indice skin) rispondevano
// «vuoto» o «default» e basta. In `api-tokens.js` un commento diceva anzi che il
// `.bak` rendeva lo store «durevole come progetti e utenti» — ma il lettore non lo
// apriva mai: la frase descriveva un recupero che nessuno eseguiva.
//
// Due regole, ognuna provata dal lato in cui poteva rompersi:
//   LETTURA  un file PRESENTE ma illeggibile si cerca nel `.bak`; un file ASSENTE
//            resta assente (cancellarlo a mano è una decisione, non un guasto: se
//            il `.bak` lo facesse rivivere, una chiave API cancellata tornerebbe).
//   SCRITTURA un file JSON che non si legge più NON diventa il `.bak`: la copia di
//            un file rotto non è una copia.
//
// Ogni store legge il proprio percorso da una variabile d'ambiente al caricamento:
// vanno impostate TUTTE prima dei require, su una cartella temporanea.
// ============================================================
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inp-json-recovery-'));
const F = {
  org: path.join(TMP, 'organization.json'),
  ai: path.join(TMP, 'ai-config.json'),
  dcim: path.join(TMP, 'dcim-config.json'),
  tokens: path.join(TMP, 'api-tokens.json'),
  users: path.join(TMP, 'users.json'),
};
const SKINS = path.join(TMP, 'skins');
const PROJECTS = path.join(TMP, 'projects');
fs.mkdirSync(SKINS, { recursive: true });
fs.mkdirSync(PROJECTS, { recursive: true });
process.env.INFRANET_ORG_FILE = F.org;
process.env.INFRANET_AI_CONFIG_FILE = F.ai;
process.env.INFRANET_DCIM_CONFIG_FILE = F.dcim;
process.env.INFRANET_API_TOKENS_FILE = F.tokens;
process.env.INFRANET_USERS_FILE = F.users;
process.env.INFRANET_SKINS_DIR = SKINS;
process.env.INFRANET_PROJECTS_DIR = PROJECTS;
process.env.SESSION_SECRET = 'test';                  // niente .session-secret sul repo
delete process.env.INFRANET_AI_KEY;
delete process.env.INFRANET_AI_ENDPOINT;
delete process.env.INFRANET_DCIM_URL;
delete process.env.INFRANET_DCIM_TOKEN;
delete process.env.INFRANET_DEV_NO_AUTH;

const store = require('../server/projects-store.js');
const org = require('../server/organization-store.js');
const ai = require('../server/ai-config.js');
const dcim = require('../server/dcim-config.js');
const tokens = require('../server/api-tokens.js');
const skins = require('../server/skins-store.js');
const auth = require('../auth.js');

// La cintura: se un percorso non è nella cartella temporanea, si ferma tutto
// PRIMA di scrivere (è l'incidente della sonda API v1: tre token nel file vero).
for (const [nome, p] of Object.entries({ ...F, skins: SKINS, progetti: PROJECTS })) {
  assert.ok(path.resolve(p).startsWith(path.resolve(TMP)), nome + ' deve stare nella cartella temporanea');
}
assert.equal(path.resolve(org.ORG_FILE || F.org), path.resolve(F.org));
assert.equal(path.resolve(ai.CONFIG_FILE), path.resolve(F.ai));
assert.equal(path.resolve(dcim.CONFIG_FILE), path.resolve(F.dcim));
assert.equal(path.resolve(tokens.TOKENS_FILE), path.resolve(F.tokens));
assert.equal(path.resolve(skins.SKINS_DIR), path.resolve(SKINS));

after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* pazienza */ } });

// ── Attrezzi ────────────────────────────────────────────────────────────────
const put = (file, v) => fs.writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v));
const rm = (...files) => { for (const f of files) { try { fs.unlinkSync(f); } catch (_) { /* assente */ } } };
const parses = (file) => { try { JSON.parse(fs.readFileSync(file, 'utf8')); return true; } catch (_) { return false; } };
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
// Come lo lascia un disco pieno: a metà di una stringa.
const ROTTO = '{"sites":[{"id":"s1","na';
const sede = (n) => ({ id: 's' + n, name: 'Sede ' + n });

// ════════════════════════════════════════════════════════════════════════════
// A. Il lettore comune
// ════════════════════════════════════════════════════════════════════════════
const rjb = store.readJsonWithBak;
const A = path.join(TMP, 'a.json');
const reset = () => rm(A, A + '.bak');

test('lettore: main valido → source main, nessun motivo', () => {
  reset(); put(A, { v: 1 });
  assert.deepEqual(rjb(A), { value: { v: 1 }, source: 'main', reason: null });
});

test('lettore: main CORROTTO + .bak buono → il valore del .bak, e dice perché', () => {
  reset(); put(A, ROTTO); put(A + '.bak', { v: 'vecchio' });
  assert.deepEqual(rjb(A), { value: { v: 'vecchio' }, source: 'backup', reason: 'unreadable' });
});

test('lettore: main corrotto e .bak corrotto → niente valore, e NON inventa', () => {
  reset(); put(A, ROTTO); put(A + '.bak', '{ anche questo no');
  assert.deepEqual(rjb(A), { value: null, source: null, reason: 'unreadable' });
});

test('lettore: main ASSENTE + .bak buono → resta assente (un file cancellato a mano non rivive)', () => {
  reset(); put(A + '.bak', { v: 'vecchio' });
  assert.deepEqual(rjb(A), { value: null, source: null, reason: 'missing' });
});

test('lettore: main assente + .bak buono con recoverMissing → dal .bak (utenti e progetti lo vogliono)', () => {
  reset(); put(A + '.bak', { v: 'vecchio' });
  assert.deepEqual(rjb(A, { recoverMissing: true }), { value: { v: 'vecchio' }, source: 'backup', reason: 'missing' });
});

test('lettore: una forma sbagliata è illeggibile quanto un JSON rotto', () => {
  reset(); put(A, { non: 'un array' }); put(A + '.bak', [1, 2]);
  assert.deepEqual(rjb(A, { shape: 'array' }), { value: [1, 2], source: 'backup', reason: 'unreadable' });
  // …e `null`, `42`, una stringa sono JSON validi ma non sono un oggetto-documento.
  for (const v of ['null', '42', '"x"', '[1]']) {
    put(A, v); put(A + '.bak', { ok: 1 });
    assert.deepEqual(rjb(A, { shape: 'object' }), { value: { ok: 1 }, source: 'backup', reason: 'unreadable' }, v);
  }
});

test('lettore: un parse personalizzato che lancia conta come illeggibile', () => {
  reset(); put(A, { v: 1 }); put(A + '.bak', { v: 0 });
  const parse = (t) => { const o = JSON.parse(t); if (o.v === 1) throw new Error('rifiutato'); return o; };
  assert.deepEqual(rjb(A, { parse }), { value: { v: 0 }, source: 'backup', reason: 'unreadable' });
});

// ════════════════════════════════════════════════════════════════════════════
// B. La scrittura: la copia di un file rotto non è una copia
// ════════════════════════════════════════════════════════════════════════════
test('scrittura (sincrona): un JSON corrotto NON sovrascrive il .bak buono', () => {
  reset(); put(A, ROTTO); put(A + '.bak', { v: 'buono' });
  store.atomicWriteFile(A, JSON.stringify({ v: 'nuovo' }));
  assert.ok(parses(A + '.bak'), 'il .bak è stato sovrascritto dal file rotto');
  assert.deepEqual(json(A + '.bak'), { v: 'buono' }, 'il .bak deve restare la copia buona');
  assert.deepEqual(json(A), { v: 'nuovo' });
});

test('scrittura (asincrona): un JSON corrotto NON sovrascrive il .bak buono', async () => {
  reset(); put(A, ROTTO); put(A + '.bak', { v: 'buono' });
  await store.atomicWriteFileAsync(A, JSON.stringify({ v: 'nuovo' }));
  assert.ok(parses(A + '.bak'), 'il .bak è stato sovrascritto dal file rotto');
  assert.deepEqual(json(A + '.bak'), { v: 'buono' }, 'il .bak deve restare la copia buona');
  assert.deepEqual(json(A), { v: 'nuovo' });
});

test('scrittura: un JSON corrotto e NESSUN .bak → non nasce un .bak di spazzatura', () => {
  reset(); put(A, ROTTO);
  store.atomicWriteFile(A, JSON.stringify({ v: 1 }));
  assert.equal(fs.existsSync(A + '.bak'), false, 'la copia di un file rotto non è una copia');
});

test('controllo: un JSON valido si conserva ancora come .bak (la regola non spegne il backup)', async () => {
  reset(); put(A, { v: 1 });
  store.atomicWriteFile(A, JSON.stringify({ v: 2 }));
  assert.deepEqual(json(A + '.bak'), { v: 1 });
  await store.atomicWriteFileAsync(A, JSON.stringify({ v: 3 }));
  assert.deepEqual(json(A + '.bak'), { v: 2 });
});

test('controllo: un file NON json (uno SVG) si conserva sempre — la regola vale per i .json', () => {
  const svg = path.join(TMP, 'skin.svg');
  rm(svg, svg + '.bak');
  fs.writeFileSync(svg, '<svg>vecchio, e questo non e\' JSON</svg>');
  store.atomicWriteFile(svg, '<svg>nuovo</svg>');
  assert.equal(fs.readFileSync(svg + '.bak', 'utf8'), '<svg>vecchio, e questo non e\' JSON</svg>');
});

// ════════════════════════════════════════════════════════════════════════════
// C. Gli store veri, nel modo in cui il guasto li colpiva
// ════════════════════════════════════════════════════════════════════════════
test('organizzazione: main corrotto + .bak buono → la UI vede le sedi del .bak, non il vuoto', () => {
  rm(F.org, F.org + '.bak');
  org.writeOrganization({ sites: [sede(1)] });
  org.writeOrganization({ sites: [sede(1), sede(2), sede(3)] });      // il .bak ora ha UNA sede
  put(F.org, ROTTO);
  assert.equal(org.readOrganization().sites.length, 1, 'doveva leggere dal .bak invece di rendere il vuoto');
});

test('organizzazione: il salvataggio dopo il guasto lascia ancora una copia leggibile', () => {
  rm(F.org, F.org + '.bak');
  org.writeOrganization({ sites: [sede(1)] });
  org.writeOrganization({ sites: [sede(1), sede(2), sede(3)] });
  put(F.org, ROTTO);
  // Un salvataggio SENZA lettura prima (uno script, un import): è il caso in cui il
  // vecchio codice copiava il rotto sopra il buono.
  org.writeOrganization({ sites: [sede(9)] });
  assert.ok(parses(F.org + '.bak'), 'il .bak deve restare leggibile');
  assert.equal(json(F.org + '.bak').sites.length, 1, 'e deve essere la copia buona, non il rotto');
  assert.equal(json(F.org).sites.length, 1);
});

test('organizzazione: main corrotto e NESSUN .bak → riparte dal vuoto (mai dati inventati), il file c\'è', () => {
  rm(F.org, F.org + '.bak');
  put(F.org, ROTTO);
  assert.deepEqual(org.readOrganization().sites, []);
  assert.equal(org.hasOrganization(), true, 'è rotto, non assente: sono due cose diverse');
});

test('organizzazione: main ASSENTE + .bak presente → resta assente (non rivive)', () => {
  rm(F.org, F.org + '.bak');
  org.writeOrganization({ sites: [sede(1)] });
  org.writeOrganization({ sites: [sede(1), sede(2)] });              // crea il .bak
  rm(F.org);
  assert.equal(org.hasOrganization(), false);
  assert.deepEqual(org.readOrganization().sites, []);
});

test('config AI: main corrotto + .bak buono → modello e chiave tornano dal .bak', () => {
  rm(F.ai, F.ai + '.bak');
  ai.setConfig({ enabled: true, model: 'modello-uno', key: 'k-prova-bak' });
  ai.setConfig({ model: 'modello-due' });                             // il .bak ha «modello-uno»
  put(F.ai, ROTTO);
  const c = ai.getConfigWithKey();
  assert.equal(c.model, 'modello-uno', 'doveva leggere dal .bak invece dei default');
  assert.equal(c.key === 'k-prova-bak', true, 'la chiave salvata deve tornare dal .bak');
});

test('config AI: il salvataggio dopo il guasto non butta la copia buona', () => {
  rm(F.ai, F.ai + '.bak');
  ai.setConfig({ model: 'modello-uno', key: 'k-prova-bak' });
  ai.setConfig({ model: 'modello-due' });
  put(F.ai, ROTTO);
  ai.setConfig({ model: 'modello-tre' });
  assert.ok(parses(F.ai + '.bak'), 'il .bak deve restare leggibile');
});

test('config DCIM: main corrotto + .bak buono → URL e token tornano dal .bak', () => {
  rm(F.dcim, F.dcim + '.bak');
  dcim.setConfig({ url: 'https://dcim.example.test', token: 't-prova-bak' });
  dcim.setConfig({ verifyTls: false });                               // il .bak ha l'URL
  put(F.dcim, ROTTO);
  const c = dcim.getConfigWithToken();
  assert.equal(c.url, 'https://dcim.example.test', 'doveva leggere dal .bak invece dei default');
  assert.equal(c.token === 't-prova-bak', true);
});

test('token API: main corrotto + .bak buono → i token tornano, non «tutti invalidati»', () => {
  rm(F.tokens, F.tokens + '.bak');
  const { token } = tokens.createToken('uno');
  tokens.createToken('due');                                          // il .bak ha UN token
  put(F.tokens, ROTTO);
  assert.ok(tokens.verifyToken(token), 'il token del .bak doveva restare valido');
  assert.equal(tokens.listTokens().length, 1);
});

test('token API: un token creato dopo il guasto non butta la copia buona', () => {
  rm(F.tokens, F.tokens + '.bak');
  tokens.createToken('uno');
  tokens.createToken('due');
  put(F.tokens, ROTTO);
  tokens.createToken('tre');                                          // lo scenario del guasto
  assert.ok(parses(F.tokens + '.bak'), 'il .bak deve restare leggibile');
});

test('indice skin: main corrotto + .bak buono → l\'indice torna, le skin non spariscono', () => {
  const idx = path.join(SKINS, 'index.json');
  rm(idx, idx + '.bak');
  skins.saveSkin({ name: 'Prima' }, '<svg/>');
  skins.saveSkin({ name: 'Seconda' }, '<svg/>');                      // il .bak ha UNA skin
  put(idx, ROTTO);
  assert.equal(skins.listSkinsMeta().length, 1, 'doveva leggere dal .bak invece di rendere []');
});

test('utenti: il recupero dal .bak, ora dal lettore comune, si comporta come prima', () => {
  rm(F.users, F.users + '.bak');
  assert.equal(auth._readUsersFile().absent, true, 'assente → primo avvio');
  auth.saveUsers([{ id: 1, username: 'a', role: 'admin' }]);
  auth.saveUsers([{ id: 1, username: 'a', role: 'admin' }, { id: 2, username: 'b', role: 'viewer' }]);
  put(F.users, ROTTO);
  const r = auth._readUsersFile();
  assert.equal(r.ok, true);
  assert.equal(r.users.length, 1, 'dal .bak');
  rm(F.users + '.bak');
  assert.deepEqual(auth._readUsersFile(), { ok: false, absent: false }, 'presente e illeggibile, nessun .bak: NON è un primo avvio');
});

test('progetti: il recupero dal .bak, ora dal lettore comune, si comporta come prima', () => {
  const id = 7;
  const file = path.join(PROJECTS, id + '.json');
  rm(file, file + '.bak');
  const proj = (nome) => ({ id, name: nome, state: { nodes: [] }, created_at: 'x', updated_at: 'y' });
  put(file, proj('buono'));
  store.atomicWriteFile(file, JSON.stringify(proj('ultimo')));        // il .bak ha «buono»
  assert.equal(store.readProjectFile(id).source, 'main');
  put(file, ROTTO);
  const r = store.readProjectFile(id);
  assert.equal(r.source, 'backup');
  assert.equal(r.reason, 'unreadable');
  assert.equal(r.project.name, 'buono');
  rm(file, file + '.bak');
  assert.deepEqual(store.readProjectFile(id), { project: null, source: null, reason: 'missing' });
});
