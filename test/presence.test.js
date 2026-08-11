const test = require('node:test');
const assert = require('node:assert/strict');
const { nodePresenceClass } = require('../lib/presence.js');

test('presenza usa il report corrente quando disponibile', () => {
  const node = { id: 'iot1', proof: { status: 'absent' } };
  assert.equal(nodePresenceClass(node, { macOrphan: [], unverified: [{ nodeId: 'iot1' }] }), ' node-unverified');
});

test('presenza ripristina il proof persistente dopo il reload', () => {
  assert.equal(nodePresenceClass({ id: 'iot1', proof: { status: 'absent' } }, null), ' node-absent');
  assert.equal(nodePresenceClass({ id: 'iot1', proof: { status: 'unverified' } }, null), ' node-unverified');
});

// Regressione: «un device spento non diventa rosso». `snmpStatus` sopravvive al
// salvataggio, quindi un 'ok' vecchio di mesi zittiva l'overlay anche quando la
// Verifica appena fatta aveva la PROVA dell'assenza (e anche il proof persistito
// dopo il reload). Il LED del rack applicava già la soglia di freschezza, questa
// funzione no: stesso concetto, due regole. Ora «ha risposto» vale solo se è
// RECENTE — la misura più fresca decide.
const _ago = (ms) => new Date(Date.now() - ms).toISOString();
const _absentReport = { macOrphan: [{ nodeId: 'pc1' }], unverified: [] };

test('presenza: un «ok» SNMP recente azzera l\'overlay (device davvero riacceso)', () => {
  assert.equal(nodePresenceClass({ id: 'pc1', snmpStatus: 'ok', snmpLastOk: _ago(3600e3) }, _absentReport), '');
  assert.equal(nodePresenceClass({ id: 'pc1', snmpStatus: 'ok', snmpLastOk: _ago(60e3), proof: { status: 'absent' } }, null), '');
});

test('presenza: un «ok» SNMP STANTIO non sopprime più l\'assenza provata', () => {
  assert.equal(nodePresenceClass({ id: 'pc1', snmpStatus: 'ok', snmpLastOk: _ago(30 * 864e5) }, _absentReport), ' node-absent');
  // ...nemmeno dopo il reload, dove decide il proof persistito.
  assert.equal(nodePresenceClass({ id: 'pc1', snmpStatus: 'ok', snmpLastOk: _ago(30 * 864e5), proof: { status: 'absent' } }, null), ' node-absent');
  // Un 'ok' senza data non è databile → non vale come «vivo adesso» (come _snmpIsStale).
  assert.equal(nodePresenceClass({ id: 'pc1', snmpStatus: 'ok' }, _absentReport), ' node-absent');
});

test('presenza: i percorsi senza «ok» restano invariati', () => {
  assert.equal(nodePresenceClass({ id: 'pc1', snmpStatus: 'err' }, _absentReport), ' node-absent');
  assert.equal(nodePresenceClass({ id: 'pc1' }, _absentReport), ' node-absent');
  assert.equal(nodePresenceClass({ id: 'altro' }, _absentReport), '');
});

// ── L'anello dell'errore SNMP sulla planimetria ──────────────────────────────
// Sta sulla TILE come ogni altro stato (prima era un contorno inline sull'etichetta
// interna: stesso rosso dell'assenza, ma su un elemento diverso), ed è TRATTEGGIATO
// perché «non riesco a interrogarlo» non è «non c'è».
// ⚠️ L'invariante che conta: NON si disegna quando la presenza ha già un verdetto.
// Su un apparato in una subnet fuori portata l'SNMP fallisce PER QUELLO — spacciarlo
// per guasto sarebbe un allarme senza una misura che lo regga.
const fs = require('node:fs');
const path = require('node:path');
const RENDER = fs.readFileSync(path.join(__dirname, '..', 'src', 'app-render-core.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'styles', '04-floor-rack.css'), 'utf8');

test('errore SNMP sul pavimento: anello sulla tile, mai sull\'etichetta interna', () => {
  assert.match(RENDER, /el\.classList\.add\('snmp-fault'\)/, 'classe sul contenitore');
  assert.equal(/class="label"\s*\$\{_ferr\}/.test(RENDER), false, 'niente stile inline sull\'etichetta');
  assert.equal(/outline:2px solid #f85149/.test(RENDER), false, 'niente colore cablato a mano nel renderer');
  assert.match(CSS, /\.floor-node\.snmp-fault \{[^}]*dashed/, 'tratteggiato: distinto dall\'assenza, che è piena');
});

test('⚠️ nessun anello di guasto se la presenza ha gia\' un verdetto', () => {
  assert.match(RENDER, /n\.snmpStatus==='err' && !absentCls/,
    'un apparato irraggiungibile (grigio) o provato assente non prende anche l\'anello SNMP');
});
