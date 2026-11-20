'use strict';
// ============================================================
//  IL TIPO DI OGNI MODELLO DEL CATALOGO: il generatore lo scrive (`role`) e «Applica modello» lo legge
// ============================================================
// Due cose. (1) Il GENERATORE scrive `role` in ogni modello, per tutti e due i percorsi (dalla libreria e da
// --from-canonical) con la stessa regola: un solo punto, `entryRole`. (2) Il catalogo COMMITTATO è coerente: ogni modello
// ha un ruolo valido, i modelli con prese elettriche sono «power», e alcuni modelli noti stanno nell'elenco giusto.
// La regola sul nome è provata a parte (device-model-kind.test.js); qui si prova che arriva nei dati.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const updater = require('../scripts/update-device-types');
const { entryRole, roleOf, buildTemplate } = require('../tools/import-device-types.js');
const K = require('../lib/device-model-kind.js');

const GE = (n) => Array.from({ length: n }, (_, i) => ({ name: 'p' + (i + 1), type: '1000base-t' }));
const dt = (manufacturer, model, interfaces, extra) => Object.assign({ slug: 'x-' + model, manufacturer, model, interfaces }, extra || {});
const role = (d) => entryRole(d, buildTemplate(d).counts);

test('entryRole: un apparato di rete prende il tipo dal nome, dove il nome lo dice', () => {
  assert.equal(role(dt('Fortinet', 'FortiGate 60F', GE(10))), 'firewall');
  assert.equal(role(dt('Cisco', 'Catalyst 9300-24P', GE(24))), 'switch');
  assert.equal(role(dt('Cisco', 'ISR4331', GE(3))), 'router');
  assert.equal(role(dt('Supermicro', 'SYS-6028TR-HTR', GE(8))), 'other', 'un server con 8 porte non è un apparato di rete');
});

test('entryRole: un router a UNA porta (ruolo strutturale «router») e un chassis modulare si precisano col nome come gli altri', () => {
  // una porta e la parola «gateway»: per struttura è un router, ma il nome dice che è un firewall
  const unaPorta = dt('Netgate', '1100 Security Gateway', GE(1));
  assert.equal(roleOf(unaPorta, buildTemplate(unaPorta).counts).role, 'router', 'per struttura');
  assert.equal(role(unaPorta), 'firewall', 'per nome');
  // un router a una porta che il nome non precisa resta «router»
  const router1 = dt('Acme', 'Edge Gateway X', GE(1));
  assert.equal(roleOf(router1, buildTemplate(router1).counts).role, 'router');
  assert.equal(role(router1), 'router');
  // un chassis modulare (porte nelle schede): per struttura «chassis», il nome lo dice switch o router
  const bays = [{ name: 'slot1' }, { name: 'slot2' }];
  const chassis = dt('Cisco', 'Nexus 9508', [], { 'module-bays': bays });
  assert.equal(roleOf(chassis, buildTemplate(chassis).counts).role, 'chassis', 'per struttura');
  assert.equal(role(chassis), 'switch', 'per nome');
  assert.equal(role(dt('Acme', 'Modular 7', [], { 'module-bays': bays })), 'chassis', 'senza segnale nel nome resta chassis');
});

test('entryRole: dove il nome non dice niente il ruolo resta quello strutturale: «network», e si propone a tutti', () => {
  assert.equal(role(dt('Acme', 'X-100', GE(24))), 'network');
  assert.equal(roleOf(dt('Acme', 'X-100', GE(24)), buildTemplate(dt('Acme', 'X-100', GE(24))).counts).role, 'network');
});

test('entryRole: i ruoli NON di rete non si toccano, qualunque sia il nome (un UPS «switch» resta un UPS)', () => {
  const outlets = [{ name: 'o1', type: 'iec-60320-c13' }, { name: 'o2', type: 'iec-60320-c13' }];
  assert.equal(role(dt('Cisco', 'Catalyst Rack PDU', GE(1), { 'power-outlets': outlets })), 'power', 'le prese vincono sul nome');
  assert.equal(role(dt('Acme', 'U6 Lite', GE(1).concat([{ name: 'w0', type: 'ieee802.11ax' }, { name: 'w1', type: 'ieee802.11ax' }]))), 'ap');
  const serial = Array.from({ length: 8 }, (_, i) => ({ name: 's' + i, type: 'rj-45' }));
  assert.equal(role(dt('Cisco', 'Firepower Console', GE(1), { 'console-server-ports': serial })), 'console', 'le porte seriali vincono sul nome');
});

test('il generatore scrive `role` nel catalogo in uso, per la libreria e per --from-canonical, con lo stesso risultato', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-kind-'));
  const source = path.join(root, 'src'), store = path.join(root, 'store');
  fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(store, { recursive: true });
  const yaml = (slug, brand, model, n) => ['slug: ' + slug, 'manufacturer: ' + brand, 'model: ' + model, 'u_height: 1', 'interfaces:']
    .concat(Array.from({ length: n }, (_, i) => ['  - name: p' + (i + 1), '    type: 1000base-t']).flat()).join('\n');
  try {
    fs.writeFileSync(path.join(source, 'a.yaml'), yaml('fortinet-fg-60f', 'Fortinet', 'FortiGate 60F', 8), 'utf8');
    fs.writeFileSync(path.join(source, 'b.yaml'), yaml('cisco-c9300', 'Cisco', 'Catalyst 9300-24P', 24), 'utf8');
    fs.writeFileSync(path.join(source, 'c.yaml'), yaml('cisco-isr4331', 'Cisco', 'ISR4331', 3), 'utf8');
    fs.writeFileSync(path.join(source, 'd.yaml'), yaml('acme-x100', 'Acme', 'X-100', 24), 'utf8');
    const direct = updater.build(source, true);
    const roles = (list) => Object.fromEntries(list.map((m) => [m.sourceSlug, m.role]));
    const expected = { 'fortinet-fg-60f': 'firewall', 'cisco-c9300': 'switch', 'cisco-isr4331': 'router', 'acme-x100': 'network' };
    assert.deepEqual(roles(direct.runtime), expected, 'dalla libreria');
    // il percorso --from-canonical: lo stesso catalogo, dallo stesso canonico, con gli stessi ruoli
    const none = path.join(store, 'assente.json');
    const args = (extra) => [path.resolve(__dirname, '..', 'scripts', 'update-device-types.js'), '--quiet'].concat(extra, [
      '--canonical=' + path.join(store, 'canonical.json'), '--catalog=' + path.join(store, 'runtime.json'),
      '--manifest=' + path.join(store, 'manifest.json'), '--diff=' + path.join(store, 'diff.json'),
      '--aliases=' + none, '--overrides=' + none, '--exclusions=' + none]);
    assert.equal(spawnSync(process.execPath, args(['--input=' + source]), { encoding: 'utf8', windowsHide: true }).status, 0);
    assert.deepEqual(roles(JSON.parse(fs.readFileSync(path.join(store, 'runtime.json'), 'utf8'))), expected, 'scritto dalla libreria');
    fs.writeFileSync(path.join(store, 'runtime.json'), '[]');
    const r = spawnSync(process.execPath, args(['--from-canonical']), { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(roles(JSON.parse(fs.readFileSync(path.join(store, 'runtime.json'), 'utf8'))), expected, 'ricostruito dal canonico');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── Il catalogo committato ──────────────────────────────────────────────────────────────────────────────────────────
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'device-types.json'), 'utf8'));
const ROLES = new Set(K.ALL_ROLES);

test('catalogo committato: ogni modello ha un ruolo valido', () => {
  const senza = catalog.filter((c) => !ROLES.has(c.role));
  assert.deepEqual(senza.slice(0, 5).map((c) => c.brand + ' ' + c.model + ' → ' + c.role), [], `${senza.length} modelli senza un ruolo valido`);
});

test('catalogo committato: chi ha prese elettriche e\' «power», e solo loro (il ruolo strutturale non e\' stato toccato dal nome)', () => {
  for (const c of catalog) {
    if (Array.isArray(c.powerOutlets) && c.powerOutlets.length) assert.equal(c.role, 'power', c.brand + ' ' + c.model);
  }
});

// ⚠️ Il catalogo si AGGIORNA (dalla libreria NetBox, dalla schermata «Aggiorna catalogo»): niente qui dipende da QUALI
// modelli ci sono, ne' da quanti. Si prova la RELAZIONE fra le regole e i dati — il ruolo scritto e' quello che le regole
// dicono oggi — e le proprieta' degli elenchi. Un catalogo ricostruito con regole piu' vecchie, o un ruolo ritoccato a mano
// nel file generato, esce rosso e dice cosa fare: `node scripts/update-device-types.js --from-canonical`.
test('catalogo committato: il ruolo scritto e\' quello che le regole dicono oggi (nessun catalogo vecchio, nessun ritocco a mano)', () => {
  const stale = [];
  // I modelli corretti A MANO in data/device-types-overrides.json (`role`) sono la sola eccezione voluta: lì decide la persona.
  let overrides = {};
  try { overrides = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'device-types-overrides.json'), 'utf8')) || {}; } catch (_) { overrides = {}; }
  const manual = new Set(Object.keys(overrides).filter((slug) => overrides[slug] && K.ALL_ROLES.includes(overrides[slug].role)));
  for (const c of catalog) {
    if (manual.has(c.sourceSlug) || manual.has(c.slug)) continue;
    const k = K.networkKind(c.brand, c.model);
    if (c.role === 'switch' || c.role === 'firewall' || c.role === 'other') { if (k !== c.role) stale.push(`${c.brand} ${c.model}: scritto «${c.role}», le regole dicono «${k}»`); }
    else if (c.role === 'router') { if (k !== 'router' && k !== null) stale.push(`${c.brand} ${c.model}: scritto «router», le regole dicono «${k}»`); }   // un router a una porta e' tale gia' per la struttura
    else if (c.role === 'network' || c.role === 'chassis') { if (k !== null) stale.push(`${c.brand} ${c.model}: non classificato, ma le regole oggi dicono «${k}»`); }
  }
  assert.deepEqual(stale.slice(0, 5), [], `${stale.length} modelli non coerenti con le regole: ricostruisci il catalogo con «node scripts/update-device-types.js --from-canonical»`);
});

test('catalogo committato: gli elenchi per tipo sono piu\' stretti del catalogo, non vuoti, e non contengono modelli di un altro tipo', () => {
  const inList = (l) => catalog.filter((c) => K.modelInList(c, l));
  const net = { switch: inList('switch'), firewall: inList('firewall'), router: inList('router') };
  for (const [l, items] of Object.entries(net)) {
    assert.ok(items.length > 0, `l'elenco «${l}» e' vuoto: o il catalogo non ha il ruolo, o le regole non classificano piu' niente`);
    assert.ok(items.length < catalog.length, `l'elenco «${l}» non e' piu' stretto del catalogo`);
  }
  const altro = (l, vietati) => net[l].filter((c) => vietati.includes(c.role));
  assert.deepEqual(altro('switch', ['firewall', 'router', 'other', 'power', 'nas', 'console', 'ap']), []);
  assert.deepEqual(altro('firewall', ['switch', 'router', 'other', 'power', 'nas', 'console', 'ap']), []);
  assert.deepEqual(altro('router', ['switch', 'firewall', 'other', 'power', 'nas', 'console', 'ap']), []);
  // niente va perso: ogni modello sta in almeno un elenco di rete, o ha un ruolo di un altro mondo
  const fuori = catalog.filter((c) => !net.switch.includes(c) && !net.firewall.includes(c) && !net.router.includes(c) && !['power', 'nas', 'console', 'ap', 'other'].includes(c.role));
  assert.deepEqual(fuori.slice(0, 5).map((c) => c.brand + ' ' + c.model + ' (' + c.role + ')'), []);
});

test('un modello NUOVO (che il catalogo di oggi non ha) prende il tipo dalle regole, senza toccare codice ne\' dati', () => {
  // lo scenario di ogni aggiornamento: la libreria cresce di famiglie che nessuno ha classificato a mano
  assert.equal(role(dt('Fortinet', 'FortiGate 999Z', GE(12))), 'firewall');
  assert.equal(role(dt('Cisco', 'Catalyst 9999-96P', GE(96))), 'switch');
  assert.equal(role(dt('Juniper', 'MX9999', GE(12))), 'router');
  assert.equal(role(dt('Nuovo Marchio', 'Famiglia 7', GE(24))), 'network', 'senza un segnale nel nome resta «non so»: si propone a tutti i tipi di rete');
  // e una correzione a mano di UN modello (data/device-types-overrides.json) vince sulla regola
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-kind-override-'));
  try {
    fs.writeFileSync(path.join(root, 'a.yaml'), ['slug: nuovo-fam7', 'manufacturer: Nuovo Marchio', 'model: Famiglia 7', 'u_height: 1', 'interfaces:'].concat(GE(8).flatMap((i) => ['  - name: ' + i.name, '    type: 1000base-t'])).join('\n'), 'utf8');
    const r = updater.build(root, true, { overrides: { 'nuovo-fam7': { role: 'firewall' } } });
    assert.equal(r.runtime[0].role, 'firewall', 'l\'override per modello decide');
    // un refuso nell'override non scrive un ruolo che nessun elenco conosce: vale quello che dicono le regole
    const typo = updater.build(root, true, { overrides: { 'nuovo-fam7': { role: 'firewal' } } });
    assert.equal(typo.runtime[0].role, 'network', 'un ruolo fuori vocabolario non vale');
    assert.equal(updater.build(root, true, { overrides: { 'nuovo-fam7': { role: 7 } } }).runtime[0].role, 'network', 'e nemmeno un non-testo');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
