'use strict';
// ============================================================
//  SNMPv3: COSA IL PRODOTTO SA PARLARE, E COSA FA DI UN VALORE CHE NON CONOSCE
// ============================================================
// Il driver traduceva il nome scritto nel progetto in una costante di net-snmp
// con `mappa[nome] ?? default`. Due difetti, uno dentro l'altro:
//   ① la mappa non conosceva `aes256r` (la derivazione della chiave che molti
//     apparati usano per AES-256) e l'interfaccia offriva solo MD5/SHA e DES/AES,
//     quindi un apparato configurato così non si poteva interrogare;
//   ② un nome che la mappa non conosce diventava SHA-1, AES-128 o authPriv
//     SENZA dirlo. A valle nessuno distingue «ho usato quello che hai scritto»
//     da «ho usato il mio»: l'utente scrive SHA-256, il driver parla SHA-1, e
//     l'unica cosa che vede è un TIMEOUT, cioè un apparato che sembra spento.
//
// ⚠️ MISURATO prima di scrivere queste prove (net-snmp 3.29.1, agente locale):
//   · con auth MD5/SHA-1/SHA-224 le due AES-256 (Blumenthal e Reeder) derivano
//     chiavi DIVERSE: la variante sbagliata risponde «Request timed out»;
//   · con auth SHA-256/384/512 la chiave localizzata è già lunga 32 byte e le
//     due varianti COINCIDONO. Per questo il difetto ① non si vede con SHA-2 e
//     una prova fatta solo con SHA-2 sarebbe verde anche col difetto.
// L'elenco dei nomi non si ricopia qui né nell'interfaccia: sta in
// lib/snmp-v3.js, e le prove lo confrontano con ciò che net-snmp espone davvero.
const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const path = require('node:path');
const snmp = require('net-snmp');
const { _createSnmpSession } = require('../drivers/snmp.js')._internals;
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const lib = () => require('../lib/snmp-v3.js');   // lazy: ogni prova cade sulla SUA asserzione, non sul require

const cfgV3 = (extra) => Object.assign(
  { v3user: 'monitor', v3secLevel: 'authPriv', v3authProto: 'SHA', v3authPass: 'authpass-123',
    v3privProto: 'AES', v3privPass: 'privpass-123' }, extra || {});
const sessione = (cfg) => _createSnmpSession('snmp-v3', '127.0.0.1', 1, 50, cfg, 0);
const chiudi = (s) => { try { s.close(); } catch (_) { /* già chiusa */ } };

// ── ① Cosa net-snmp espone, e cosa il progetto ne usa ─────────────────────────

test('① ogni protocollo che net-snmp espone ha un nome nel progetto (e viceversa)', () => {
  const { V3_AUTH, V3_PRIV } = lib();
  const esposti = (o) => Object.keys(o).filter((k) => isNaN(Number(k)) && k !== 'none').sort();
  // Anti-vuoto: se net-snmp cambiasse forma l'insieme sarebbe vuoto e la prova muta.
  assert.ok(esposti(snmp.AuthProtocols).length >= 6 && esposti(snmp.PrivProtocols).length >= 4);
  assert.deepEqual(V3_AUTH.map((o) => o.key).sort(), esposti(snmp.AuthProtocols),
    'un protocollo di autenticazione di net-snmp non ha un nome nel progetto (o viceversa)');
  assert.deepEqual(V3_PRIV.map((o) => o.key).sort(), esposti(snmp.PrivProtocols),
    'un protocollo di cifratura di net-snmp non ha un nome nel progetto (o viceversa)');
});

test('① ogni nome del progetto punta a una costante che esiste', () => {
  const { V3_AUTH, V3_PRIV } = lib();
  for (const o of V3_AUTH) assert.notEqual(snmp.AuthProtocols[o.key], undefined, `auth ${o.value}`);
  for (const o of V3_PRIV) assert.notEqual(snmp.PrivProtocols[o.key], undefined, `priv ${o.value}`);
});

// ── Il driver mette in sessione ciò che è scritto ─────────────────────────────

test('② la sessione porta il protocollo scritto: ogni autenticazione', () => {
  const ATTESI = { MD5: 'md5', SHA: 'sha', SHA224: 'sha224', SHA256: 'sha256', SHA384: 'sha384', SHA512: 'sha512' };
  for (const [nome, chiave] of Object.entries(ATTESI)) {
    const s = sessione(cfgV3({ v3authProto: nome }));
    assert.equal(s.user.authProtocol, snmp.AuthProtocols[chiave], `auth ${nome}`);
    chiudi(s);
  }
});

test('② la sessione porta il protocollo scritto: ogni cifratura, AES-256 Reeder compresa', () => {
  const ATTESI = { DES: 'des', AES: 'aes', AES256: 'aes256b', AES256R: 'aes256r' };
  for (const [nome, chiave] of Object.entries(ATTESI)) {
    const s = sessione(cfgV3({ v3privProto: nome }));
    assert.equal(s.user.privProtocol, snmp.PrivProtocols[chiave], `priv ${nome}`);
    chiudi(s);
  }
});

test('② il nome si legge senza badare a maiuscole e spazi (come prima, e adesso detto)', () => {
  const s = sessione(cfgV3({ v3authProto: ' sha256 ', v3privProto: 'aes256r', v3secLevel: 'AUTHPRIV' }));
  assert.equal(s.user.authProtocol, snmp.AuthProtocols.sha256);
  assert.equal(s.user.privProtocol, snmp.PrivProtocols.aes256r);
  assert.equal(s.user.level, snmp.SecurityLevel.authPriv);
  chiudi(s);
});

test('② un campo NON scritto prende il valore che l\'interfaccia mostra già selezionato', () => {
  // Controllo di NON regressione: nei progetti salvati senza questi campi la
  // select mostra SHA / AES / authPriv, e il driver ha sempre parlato così.
  const s = sessione({ v3user: 'monitor', v3authPass: 'authpass-123', v3privPass: 'privpass-123' });
  assert.equal(s.user.level, snmp.SecurityLevel.authPriv);
  assert.equal(s.user.authProtocol, snmp.AuthProtocols.sha);
  assert.equal(s.user.privProtocol, snmp.PrivProtocols.aes);
  chiudi(s);
});

// ── Un nome che non si conosce si DICE ────────────────────────────────────────

test('③ un protocollo sconosciuto è un errore che nomina il campo e dice cosa è ammesso', () => {
  const CASI = [
    [{ v3secLevel: 'authSuper' }, /livello di sicurezza/, 'authSuper'],
    [{ v3authProto: 'SHA999' }, /autenticazione/, 'SHA999'],
    [{ v3privProto: 'AES192' }, /cifratura/, 'AES192'],
  ];
  for (const [extra, campo, valore] of CASI) {
    assert.throws(() => sessione(cfgV3(extra)), (e) => {
      assert.match(e.message, campo);
      assert.ok(e.message.includes(valore), `l'errore non riporta il valore scritto (${valore}): ${e.message}`);
      assert.match(e.message, /ammessi:/);
      return true;
    }, `${valore} doveva essere rifiutato, non sostituito`);
  }
  // E l'elenco degli ammessi comprende la variante che prima mancava.
  assert.throws(() => sessione(cfgV3({ v3privProto: 'AES192' })), /AES256R/);
});

test('③ si rifiuta solo ciò che il livello di sicurezza USA', () => {
  // Un campo che il livello non legge non può far fallire una sessione che non lo usa.
  assert.doesNotThrow(() => chiudi(sessione(cfgV3({ v3secLevel: 'noAuthNoPriv', v3authProto: 'X', v3privProto: 'Y' }))));
  assert.doesNotThrow(() => chiudi(sessione(cfgV3({ v3secLevel: 'authNoPriv', v3privProto: 'Y' }))));
  // …ma l'autenticazione, se il livello la usa, non si indovina.
  assert.throws(() => sessione(cfgV3({ v3secLevel: 'authNoPriv', v3authProto: 'X' })), /autenticazione/);
});

test('③ poll() rifiuta subito, senza attendere un timeout, e il messaggio arriva a chi chiama', async () => {
  const { poll } = require('../drivers/snmp.js');
  const t0 = Date.now();
  await assert.rejects(
    poll({ driver: 'snmp-v3', host: '127.0.0.1', port: 1, timeout: 5, ...cfgV3({ v3authProto: 'SHA999' }) }),
    /autenticazione.*SHA999/);
  assert.ok(Date.now() - t0 < 1500, 'doveva fallire prima di toccare la rete');
});

// ── La prova vera: un agente SNMPv3 locale ────────────────────────────────────
// Costanti che esistono non dicono che l'apparato risponda. Qui un agente
// net-snmp (stessa libreria, ma lato agente) è configurato con una combinazione
// e la sessione costruita DAL DRIVER, dal solo testo del progetto, deve leggerlo.

function portaLibera() {
  return new Promise((res, rej) => {
    const s = dgram.createSocket('udp4');
    s.once('error', rej);
    s.bind(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

async function avviaAgente(utenti) {
  const port = await portaLibera();
  const agent = snmp.createAgent({
    port, address: '127.0.0.1', disableAuthorization: false,
    accessControlModelType: snmp.AccessControlModelType.Simple,
    engineID: '8000B98380' + '0000000001',
  }, () => {});
  const az = agent.getAuthorizer();
  for (const u of utenti) {
    az.addUser({
      name: u.name, level: snmp.SecurityLevel.authPriv,
      authProtocol: snmp.AuthProtocols[u.auth], authKey: 'authpass-123',
      privProtocol: snmp.PrivProtocols[u.priv], privKey: 'privpass-123',
    });
    az.getAccessControlModel().setUserAccess(u.name, snmp.AccessLevel.ReadOnly);
  }
  const mib = agent.getMib();
  mib.registerProvider({ name: 'sysDescr', type: snmp.MibProviderType.Scalar, oid: '1.3.6.1.2.1.1.1',
    scalarType: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess['read-only'] });
  mib.setScalarValue('sysDescr', 'agente di prova');
  return { port, close: () => { try { agent.close(); } catch (_) { /* già chiuso */ } } };
}

function leggi(port, cfg, timeoutMs) {
  return new Promise((res) => {
    let s;
    try { s = _createSnmpSession('snmp-v3', '127.0.0.1', port, timeoutMs, cfg, 0); }
    catch (e) { return res({ ok: false, errore: e.message }); }
    s.get(['1.3.6.1.2.1.1.1.0'], (err, vbs) => {
      chiudi(s);
      if (err) return res({ ok: false, errore: err.message });
      res({ ok: true, valore: String(vbs[0].value) });
    });
  });
}

// Auth SHA-1 e MD5 sono quelle dove le due AES-256 DIVERGONO: se la prova non le
// avesse, sarebbe verde anche con il difetto (vedi l'intestazione).
const GIRO = [
  { auth: 'SHA', priv: 'AES256R', proto: ['SHA', 'AES256R'] },
  { auth: 'MD5', priv: 'AES256R', proto: ['MD5', 'AES256R'] },
  { auth: 'SHA', priv: 'AES256B', proto: ['SHA', 'AES256'] },
  { auth: 'SHA', priv: 'AES', proto: ['SHA', 'AES'] },
  { auth: 'SHA256', priv: 'AES256R', proto: ['SHA256', 'AES256R'] },
  { auth: 'SHA512', priv: 'AES', proto: ['SHA512', 'AES'] },
];

test('④ un agente reale risponde a ogni combinazione, scritta come la scrive un utente', async () => {
  // Chiavi di net-snmp lato agente (minuscole) → il nome lo prendiamo dal progetto.
  const key = { AES256B: 'aes256b', AES256R: 'aes256r', AES: 'aes' };
  const utenti = GIRO.map((g, i) => ({ name: 'u' + i, auth: g.auth.toLowerCase(), priv: key[g.priv] }));
  const agente = await avviaAgente(utenti);
  try {
    for (let i = 0; i < GIRO.length; i++) {
      const [authNome, privNome] = GIRO[i].proto;
      const r = await leggi(agente.port,
        cfgV3({ v3user: 'u' + i, v3authProto: authNome, v3privProto: privNome }), 2000);
      assert.deepEqual(r, { ok: true, valore: 'agente di prova' }, `auth ${authNome} + cifratura ${privNome}`);
    }
  } finally { agente.close(); }
});

test('④ la variante conta SOLO con un\'autenticazione corta: è il motivo per cui il difetto si nascondeva', async () => {
  const agente = await avviaAgente([
    { name: 'corta', auth: 'sha', priv: 'aes256r' },
    { name: 'lunga', auth: 'sha256', priv: 'aes256r' },
  ]);
  try {
    // Reeder sull'agente, Blumenthal sul client.
    const corta = await leggi(agente.port, cfgV3({ v3user: 'corta', v3privProto: 'AES256' }), 700);
    assert.equal(corta.ok, false, 'con SHA-1 le due varianti derivano chiavi diverse: deve fallire');
    const lunga = await leggi(agente.port, cfgV3({ v3user: 'lunga', v3authProto: 'SHA256', v3privProto: 'AES256' }), 2000);
    assert.equal(lunga.ok, true, 'con SHA-256 la chiave è già di 32 byte: le due varianti coincidono');
  } finally { agente.close(); }
});

test('④ la scoperta v3 senza credenziali (noAuthNoPriv) resta com\'era: agente vivo = «da configurare»', async () => {
  // Controllo di NON regressione. Il livello noAuthNoPriv non usa nessun protocollo e
  // ora non ne passa a net-snmp (prima gli passava SHA/AES): misurato uguale prima e dopo.
  const { probe } = require('../drivers/snmp.js');
  const agente = await avviaAgente([{ name: 'u', auth: 'sha', priv: 'aes' }]);
  try {
    const r = await probe({ driver: 'snmp-v3', host: '127.0.0.1', port: agente.port, timeout: 2 });
    assert.equal(r.reachable, true);
    assert.equal(r.driverUsed, 'snmp-v3');
    assert.equal(r.needsCredentials, true);
  } finally { agente.close(); }
});

// ── L'interfaccia offre ciò che il driver parla, da un elenco solo ───────────

const NODI = [
  { id: 'sw3', type: 'switch', name: 'SW-V3', ip: '10.0.0.3',
    integration: { driver: 'snmp-v3', host: '10.0.0.3', v3user: 'ops' } },
  { id: 'sw3x', type: 'switch', name: 'SW-V3X', ip: '10.0.0.5',
    integration: { driver: 'snmp-v3', host: '10.0.0.5', v3user: 'ops',
      v3authProto: 'SHA256', v3privProto: 'AES256R', v3secLevel: 'authNoPriv' } },
  { id: 'hv', type: 'hypervisor', name: 'HV', ip: '10.0.0.4',
    vms: [
      { id: 'vm3', name: 'VM-V3', integration: { driver: 'snmp-v3', host: '10.0.0.10', v3user: 'ops' } },
      { id: 'vm3x', name: 'VM-V3X', integration: { driver: 'snmp-v3', host: '10.0.0.11', v3user: 'ops',
        v3authProto: 'SHA256', v3privProto: 'AES256R', v3secLevel: 'authNoPriv' } },
    ] },
];

function pannello(selType, selId, selVmId) {
  const APP = loadApp(ROOT);
  return run(APP.ctx, `(() => {
    state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
    state.nodes.push(...${JSON.stringify(NODI)});
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    _propsExplicit = true;
    selType = ${JSON.stringify(selType)}; selId = ${JSON.stringify(selId)};
    selVmId = ${JSON.stringify(selVmId || null)};
    renderProps();
    return document.getElementById('props-panel').innerHTML || '';
  })()`);
}

// Le opzioni di una select, col valore che il browser invierebbe (l'attributo
// `value`, o il testo se manca) e se sono selezionate.
function opzioni(html, campo) {
  const m = new RegExp('<select\\b[^>]*(?:data-ikey|data-vm-field)="' + campo + '"[^>]*>([\\s\\S]*?)</select>').exec(html);
  if (!m) return null;
  return [...m[1].matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map((o) => {
    const v = /\bvalue="([^"]*)"/.exec(o[1]);
    return { value: v ? v[1] : o[2], label: o[2], selected: /\bselected\b/.test(o[1]) };
  });
}
const valori = (ops) => ops.map((o) => o.value);

const SCENARI = [
  ['apparato', 'node', 'sw3', null, 'sw3x'],
  ['VM', 'vm', 'hv', 'vm3', 'vm3x'],
];

for (const [nome, selType, selId, vmBase, idX] of SCENARI) {
  const vistaBase = () => pannello(selType, selId, vmBase);
  const vistaX = () => (selType === 'node' ? pannello('node', idX) : pannello('vm', 'hv', idX));

  test(`⑤ ${nome}: le select v3 offrono gli SHA-2 e le due AES-256 (nessuna è scritta nel pannello)`, () => {
    const html = vistaBase();
    const auth = opzioni(html, 'v3authProto');
    const priv = opzioni(html, 'v3privProto');
    assert.ok(auth && priv, `${nome}: select v3 non trovate: il pannello non disegna la sezione`);
    assert.deepEqual(valori(auth), ['MD5', 'SHA', 'SHA224', 'SHA256', 'SHA384', 'SHA512']);
    assert.deepEqual(valori(priv), ['DES', 'AES', 'AES256', 'AES256R']);
    assert.deepEqual(valori(opzioni(html, 'v3secLevel')), ['noAuthNoPriv', 'authNoPriv', 'authPriv']);
  });

  test(`⑤ ${nome}: l'elenco offerto è LO STESSO del driver, e il valore salvato è quello selezionato`, () => {
    const L = lib();
    const html = vistaBase();
    assert.deepEqual(valori(opzioni(html, 'v3authProto')), L.V3_AUTH.map((o) => o.value));
    assert.deepEqual(valori(opzioni(html, 'v3privProto')), L.V3_PRIV.map((o) => o.value));
    assert.deepEqual(valori(opzioni(html, 'v3secLevel')), L.V3_LEVELS.slice());
    // Ogni valore offerto è accettato dal driver: niente voce che si sceglie e poi non parla.
    for (const campo of ['v3authProto', 'v3privProto', 'v3secLevel']) {
      for (const v of valori(opzioni(html, campo))) {
        const cfg = { v3secLevel: 'authPriv' };
        cfg[campo] = v;
        const r = L.v3Params(cfg);
        assert.equal(r.ok, true, `${nome}: «${v}» è offerto per ${campo} ma il driver lo rifiuta (${r.error})`);
      }
    }
    // Campo non scritto → la select mostra i valori che il driver userebbe.
    const sel = (campo) => opzioni(html, campo).filter((o) => o.selected).map((o) => o.value);
    assert.deepEqual(sel('v3authProto'), [L.V3_DEFAULTS.auth]);
    assert.deepEqual(sel('v3privProto'), [L.V3_DEFAULTS.priv]);
    assert.deepEqual(sel('v3secLevel'), [L.V3_DEFAULTS.level]);
    // Campo scritto → è quello, anche se è una delle voci nuove.
    const x = vistaX();
    assert.deepEqual(opzioni(x, 'v3authProto').filter((o) => o.selected).map((o) => o.value), ['SHA256']);
    assert.deepEqual(opzioni(x, 'v3privProto').filter((o) => o.selected).map((o) => o.value), ['AES256R']);
    assert.deepEqual(opzioni(x, 'v3secLevel').filter((o) => o.selected).map((o) => o.value), ['authNoPriv']);
  });
}

// ── La funzione pura ──────────────────────────────────────────────────────────

test('⑥ v3Params: vuoto = i valori mostrati; sconosciuto = errore; non usato = ignorato', () => {
  const { v3Params, V3_DEFAULTS } = lib();
  assert.deepEqual(V3_DEFAULTS, { level: 'authPriv', auth: 'SHA', priv: 'AES' });
  const vuoto = v3Params({});
  assert.equal(vuoto.ok, true);
  assert.deepEqual([vuoto.level, vuoto.auth.value, vuoto.priv.value], ['authPriv', 'SHA', 'AES']);
  assert.equal(v3Params({ v3authProto: 'nope' }).ok, false);
  assert.equal(v3Params({ v3secLevel: 'noAuthNoPriv', v3authProto: 'nope', v3privProto: 'nope' }).ok, true);
  assert.equal(v3Params({ v3secLevel: 'noAuthNoPriv' }).auth, null, 'senza autenticazione non si dichiara un protocollo');
  assert.equal(v3Params({ v3secLevel: 'authNoPriv' }).priv, null, 'senza cifratura non si dichiara un protocollo');
  // Un valore non-stringa (arriva dal corpo di una richiesta) non deve far saltare la funzione.
  assert.equal(v3Params({ v3authProto: 7 }).ok, false);
  assert.equal(v3Params(null).ok, true);
});
