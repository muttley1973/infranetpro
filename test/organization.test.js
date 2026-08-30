'use strict';
// ============================================================
// ORGANIZZAZIONE MULTI-SEDE — store + rotta (Fase 1, persistenza).
//
// Le invarianti che questa fetta deve difendere:
//   ① UNA organizzazione per installazione, e NON dentro un progetto: le sedi
//      puntano ai progetti con `projectRef`, un riferimento e mai una copia;
//   ② il server è autorevole: ri-normalizza il body e non si fida del client;
//   ③ ciò che viene SCARTATO si dice — un collegamento rifiutato che sparisse in
//      silenzio farebbe credere a chi ha salvato di averlo salvato;
//   · «non c'è ancora» ≠ «c'è ed è vuota» ≠ «è rotta»: tre stati distinti;
//   · un file corrotto riparte dal vuoto, mai da dati inventati;
//   · un controllo non eseguibile (lista progetti illeggibile) si REGISTRA.
// ============================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-org-'));
const PROJECTS = path.join(TMP, 'projects');
fs.mkdirSync(PROJECTS, { recursive: true });
process.env.INFRANET_PROJECTS_DIR = PROJECTS;
process.env.INFRANET_ORG_FILE = path.join(TMP, 'organization.json');

// Due progetti-sede esistenti: le sedi ci puntano con `projectRef`.
for (const [id, name] of [[1, 'Milano'], [2, 'Roma']]) {
  fs.writeFileSync(path.join(PROJECTS, `${id}.json`), JSON.stringify({
    id, name, created_at: '2026-08-28 09:00:00', updated_at: '2026-08-28 09:00:00',
    state: { nodes: [], racks: [], links: [] },
  }), 'utf8');
}

const express = require('express');
const store = require('../server/organization-store');

let server, base;
// Il PUT è dietro `auth.requireAdmin`, che guarda `req.session.user.role`. Qui la
// sessione la iniettiamo noi invece di montare tutto `auth.register`: così il
// test resta sulla rotta, e cambiando `ROLE` si può verificare anche il rifiuto.
let ROLE = 'admin';

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = ROLE ? { user: { id: 1, username: 'test', role: ROLE } } : {};
    next();
  });
  app.use(require('../server/routes/organization'));
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server.close(); } catch (_) { /* già chiuso */ } });

const ORG = () => ({
  id: 'acme', name: 'Acme',
  sites: [
    { id: 'mi', name: 'Milano', role: 'hub', projectRef: '1', subnets: ['10.1.0.0/24'] },
    { id: 'rm', name: 'Roma', role: 'spoke', projectRef: '2', subnets: ['10.2.0.9/24'] },
  ],
  uplinks: [{ id: 'u-mi', siteId: 'mi', provider: 'Acme Fiber', cirMbps: 200 }],
  links: [{
    id: 'mi-rm', aSiteId: 'mi', bSiteId: 'rm', kind: 'ipsec', topology: 'hub-and-spoke',
    reach: { origin: 'declared', value: { a: ['10.1.0.0/24'], b: ['10.2.0.0/24'] } },
  }],
});

const put = (body) => fetch(`${base}/api/organization`, {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const get = () => fetch(`${base}/api/organization`);

// ── Lo store, prima di tutto ───────────────────────────────────────────────
test('senza file, l\'organizzazione è VUOTA e non è un errore', () => {
  try { fs.unlinkSync(process.env.INFRANET_ORG_FILE); } catch (_) { /* già assente */ }
  assert.equal(store.hasOrganization(), false, '«non c\'è ancora» è uno stato legittimo');
  const org = store.readOrganization();
  assert.deepEqual(org, { id: '', name: '', sites: [], uplinks: [], links: [] });
});

test('scrive, rilegge identico, e canonicalizza le subnet', () => {
  const { organization } = store.writeOrganization(ORG());
  assert.equal(store.hasOrganization(), true);
  assert.deepEqual(store.readOrganization(), organization, 'il giro su disco non cambia niente');
  // «10.2.0.9/24» era una scrittura valida della stessa rete: esce canonica
  assert.deepEqual(organization.sites[1].subnets, ['10.2.0.0/24']);
});

test('① la sede porta un RIFERIMENTO al progetto, non una copia', () => {
  const { organization } = store.writeOrganization(ORG());
  assert.equal(organization.sites[0].projectRef, '1');
  assert.ok(!('project' in organization.sites[0]) && !('nodes' in organization.sites[0]));
});

test('③ ciò che non è modellabile non entra — e il conteggio lo dice', () => {
  const raw = ORG();
  raw.sites.push({ name: 'senza id' });                                   // -1 sede
  raw.links.push({ id: 'x', aSiteId: 'mi', bSiteId: 'rm', kind: 'pptp' }); // -1 collegamento (⑲ fuori vocabolario di proposito)
  raw.uplinks.push({ id: 'orfano' });                                     // -1 uplink (senza sede)
  const { organization, dropped } = store.writeOrganization(raw);
  assert.deepEqual(dropped, { sites: 1, uplinks: 1, links: 1 });
  assert.equal(organization.sites.length, 2);
  assert.equal(organization.links.length, 1);
});

test('un salvataggio pulito non riporta nessuno scarto', () => {
  assert.deepEqual(store.writeOrganization(ORG()).dropped, { sites: 0, uplinks: 0, links: 0 });
});

test('un file CORROTTO riparte dal vuoto, non da dati inventati', () => {
  fs.writeFileSync(process.env.INFRANET_ORG_FILE, '{ questo non è json', 'utf8');
  assert.deepEqual(store.readOrganization().sites, []);
  assert.equal(store.hasOrganization(), true, 'il file c\'è: è rotto, non assente — sono due cose diverse');
  store.writeOrganization(ORG());   // ripristina per i test seguenti
});

test('un body assurdo produce un\'organizzazione vuota, non un\'eccezione', () => {
  for (const bad of [null, undefined, 42, 'x', []]) {
    assert.deepEqual(store.writeOrganization(bad).organization,
      { id: '', name: '', sites: [], uplinks: [], links: [] });
  }
  store.writeOrganization(ORG());
});

// ── La rotta ───────────────────────────────────────────────────────────────
test('GET restituisce organizzazione, audit ed esistenza', async () => {
  store.writeOrganization(ORG());
  const r = await get();
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.exists, true);
  assert.deepEqual(j.organization.sites.map(s => s.id), ['mi', 'rm']);
  assert.ok(j.audit, 'l\'audit viaggia con lo stato: non serve una seconda chiamata');
  assert.deepEqual(j.unknownProjectRefs, []);
});

test('② il server RI-NORMALIZZA il body: non si fida del client', async () => {
  const raw = ORG();
  raw.sites[0].role = 'PRIMARIO';                 // fuori vocabolario
  raw.sites[0].subnets = ['10.1.0.77/24'];        // da canonicalizzare
  const j = await (await put(raw)).json();
  assert.equal(j.organization.sites[0].role, 'standalone', 'un ruolo ignoto non si corregge in silenzio');
  assert.deepEqual(j.organization.sites[0].subnets, ['10.1.0.0/24']);
});

test('③ il PUT risponde con ciò che è stato SCRITTO e con cosa è caduto', async () => {
  const raw = ORG();
  raw.links.push({ id: 'x', aSiteId: 'mi', bSiteId: 'rm', kind: 'pptp' });
  const j = await (await put(raw)).json();
  assert.equal(j.dropped.links, 1, 'chi salva deve sapere che quel collegamento non è entrato');
  assert.deepEqual(j.organization.links.map(l => l.id), ['mi-rm']);
});

test('il PUT rifiuta un body che non è un oggetto', async () => {
  // Due strati, e vale la pena sapere quale risponde:
  //   · un ARRAY passa `express.json()` (è JSON strutturato) e arriva qui, dove
  //     lo rifiuta la rotta con un errore che si può leggere a macchina;
  //   · una stringa, un numero o `null` non superano nemmeno `express.json()`,
  //     che in strict mode accetta solo oggetti e array: 400 con la pagina di
  //     errore di Express. Lo STATO è giusto lo stesso, e non è questa fetta il
  //     posto dove cambiare il gestore d'errore globale del server.
  const r = await put([]);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'bad-body', 'un array lo respinge la rotta, e lo dice');

  for (const bad of ['stringa', 42, null]) {
    assert.equal((await put(bad)).status, 400, `${JSON.stringify(bad)} doveva essere rifiutato`);
  }
});

test('un oggetto SENZA le liste attese non è un errore: è un\'organizzazione vuota', async () => {
  // `{}` è JSON valido e strutturalmente un'organizzazione — solo, non dice
  // niente. Rifiutarlo impedirebbe di svuotare l'organizzazione, che è un'azione
  // legittima; normalizzarlo a vuoto è la risposta onesta.
  const j = await (await put({})).json();
  assert.deepEqual(j.organization, { id: '', name: '', sites: [], uplinks: [], links: [] });
  assert.deepEqual(j.dropped, { sites: 0, uplinks: 0, links: 0 });
  await put(ORG());   // ripristina per i test seguenti
});

test('il PUT persiste davvero: il GET successivo lo rilegge', async () => {
  const raw = ORG();
  raw.name = 'Acme Riorganizzata';
  await put(raw);
  assert.equal((await (await get()).json()).organization.name, 'Acme Riorganizzata');
});

// ── projectRef: l'unica cosa che il client non può verificare da solo ──────
test('una sede che punta a un progetto INESISTENTE viene segnalata', async () => {
  const raw = ORG();
  raw.sites[1].projectRef = '999';
  const j = await (await put(raw)).json();
  assert.deepEqual(j.unknownProjectRefs, [{ siteId: 'rm', projectRef: '999' }]);
});

test('una sede SENZA projectRef non è un progetto mancante (è solo non collegata)', async () => {
  const raw = ORG();
  delete raw.sites[1].projectRef;
  const j = await (await put(raw)).json();
  assert.deepEqual(j.unknownProjectRefs, [], 'non aver scelto un progetto ≠ averne scelto uno sbagliato');
});

test('l\'audit arriva con la rotta e vede le incoerenze', async () => {
  const raw = ORG();
  raw.sites[1].subnets = ['10.1.0.0/24'];   // Roma rivendica la rete di Milano
  const j = await (await put(raw)).json();
  assert.deepEqual(j.audit.subnetsAtTwoSites, [{ subnet: '10.1.0.0/24', siteIds: ['mi', 'rm'] }]);
});

// ── Il cancello: scrivere richiede l'admin, leggere no ─────────────────────
test('⛔ un utente non-admin non può riscrivere l\'organizzazione', async () => {
  await put(ORG());                       // stato noto, da admin
  const prima = (await (await get()).json()).organization.name;
  ROLE = 'user';
  try {
    const r = await put(Object.assign(ORG(), { name: 'Scritta da chi non doveva' }));
    assert.equal(r.status, 403);
    assert.equal((await (await get()).json()).organization.name, prima, 'e non ha scritto niente');
  } finally { ROLE = 'admin'; }
});

test('la LETTURA resta aperta: documentare non è amministrare', async () => {
  ROLE = null;
  try { assert.equal((await get()).status, 200); } finally { ROLE = 'admin'; }
});

// ── ⑪ Un'identità duplicata sparisce, ma DETTA ─────────────────────────────
test('⭐ una sede con un id già preso non entra, e `dropped` lo dice', async () => {
  const raw = ORG();
  raw.sites.push({ id: 'mi', name: 'Milano (vecchia)', role: 'spoke', subnets: ['10.9.0.0/24'] });
  const j = await (await put(raw)).json();
  // Prima passava: il modello ne teneva tre, il report ne contava tre e la mappa
  // — che indicizza per id — ne disegnava DUE. La terza spariva dallo schermo
  // restando nei totali, e `dropped` diceva 0: nessuno avvertiva chi salvava.
  assert.equal(j.dropped.sites, 1, 'chi salva deve sapere che quella sede non è entrata');
  assert.deepEqual(j.organization.sites.map(s => s.name), ['Milano', 'Roma']);
});

test('⭐ una banda contrattuale che non è banda non viene salvata', async () => {
  const raw = ORG();
  raw.uplinks[0].cirMbps = -100;
  const j = await (await put(raw)).json();
  assert.equal(j.organization.uplinks[0].cirMbps, null,
    'il -100 arrivava fino alla scheda di ripristino travestito da dato');
  // ⚠️ L'uplink NON cade: il resto della linea (operatore, codice circuito) è
  // buono e serve. Cade il solo campo che non poteva essere vero.
  assert.equal(j.dropped.uplinks, 0);
  assert.equal(j.organization.uplinks[0].provider, 'Acme Fiber');
});

// ── ⑳ Su quale linea corre: il salvataggio non lo butta più via ────────────
test('⭐ un IPsec può dire su quali linee corre, e il salvataggio lo tiene', async () => {
  const raw = ORG();
  raw.uplinks.push({ id: 'u-rm', siteId: 'rm', provider: 'Acme Wireless' });
  raw.links[0].underlayUplinkIds = ['u-mi', 'u-rm'];
  const j = await (await put(raw)).json();
  // Prima il campo esisteva SOLO sul `kind` `sdwan`: su un IPsec il server lo
  // normalizzava via, in silenzio e senza contarlo in `dropped` — chi l'aveva
  // dichiarato non aveva modo di accorgersene. E «è giù la linea di Milano,
  // quali collegamenti cadono?» restava senza risposta anche col dossier in mano.
  assert.deepEqual(j.organization.links[0].underlayUplinkIds, ['u-mi', 'u-rm']);
  assert.equal(j.dropped.links, 0);
  // E ci resta: la conferma vera è la RILETTURA, non l'eco della scrittura.
  const dopo = await (await get()).json();
  assert.deepEqual(dopo.organization.links[0].underlayUplinkIds, ['u-mi', 'u-rm']);
});
