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
// interna: stesso rosso dell'assenza, ma su un elemento diverso), ed è ARANCIONE
// perché «non riesco a interrogarlo» non è «non c'è».
// ⚠️ L'invariante che conta: NON si disegna quando la presenza ha già un verdetto.
// Su un apparato in una subnet fuori portata l'SNMP fallisce PER QUELLO — spacciarlo
// per guasto sarebbe un allarme senza una misura che lo regga.
const fs = require('node:fs');
const path = require('node:path');
const RENDER = fs.readFileSync(path.join(__dirname, '..', 'src', 'app-render-core.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'styles', '04-floor-rack.css'), 'utf8');

test('errore SNMP sul pavimento: anello sulla tile, mai sull\'etichetta interna', () => {
  // Fase ② cura render: il builder produce un DESCRITTORE (niente più el.classList
  // nel builder) — la classe si somma alla className della TILE (`_cls`), che
  // _applicaDesc scrive sul contenitore. Stessa notizia, nuovo idioma.
  assert.match(RENDER, /_cls \+= ' snmp-fault'/, 'classe sul contenitore (via descrittore)');
  assert.equal(/class="label"\s*\$\{_ferr\}/.test(RENDER), false, 'niente stile inline sull\'etichetta');
  assert.equal(/outline:2px solid #f85149/.test(RENDER), false, 'niente colore cablato a mano nel renderer');
  // ⚠️ Guasto e assenza sono due valori della STESSA notizia: stessa forma,
  // colore diverso. Il tratteggio qui non entra — in questa app significa già
  // «dedotto, da confermare» (i cavi inferiti da LLDP/FDB, documentato anche nel
  // manuale), e un outline staccato faceva sembrare i due stati due decorazioni
  // scorrelate invece che due letture dello stesso apparato.
  const RING   = CSS.match(/\.floor-node\.snmp-fault \{[^}]*\}/)[0];
  const ABSENT = CSS.match(/\.floor-node\.node-absent[^{]*\{[^}]*\}/)[0];
  // Solo le misure del primo strato: il colore DEVE essere diverso, la forma no.
  const geom = (rule) => ((rule.match(/box-shadow:\s*([\d.px\s-]+?)\s*(?:var\(|rgba?\()/) || [])[1] || '').trim();
  assert.match(RING, /box-shadow/, 'alone come l\'assenza, non un outline staccato');
  assert.doesNotMatch(RING, /outline|dashed/, 'né contorno staccato né tratteggio');
  assert.equal(geom(RING), geom(ABSENT), 'STESSA geometria dell\'alone dell\'assente');
  assert.match(RING, /var\(--probe-warn\)/, 'colore da token semantico');
  assert.doesNotMatch(RING, /--fault-color/, 'NON il rosso dell\'assenza: cambia il colore, che è la notizia');
});

test('l\'anello di guasto SNMP si spiega da sé (nessuna legenda da cercare)', () => {
  // Un anello colorato senza testo obbliga a chiedere cosa significa: è successo.
  // Fase ②: il builder mette la spiegazione nel descrittore (`_titolo`) e
  // _applicaDesc la porta sull'elemento — si verifica TUTTA la catena, o il
  // title potrebbe nascere nel builder e non arrivare mai a schermo.
  assert.match(RENDER, /_titolo = t\('floor\.snmpFaultTip'\)/, 'il descrittore porta la spiegazione');
  assert.match(RENDER, /el\.title = d\.title/, 'e il materializzatore la scrive sulla tile');
});

test('⚠️ nessun anello di guasto se la presenza ha gia\' un verdetto', () => {
  assert.match(RENDER, /n\.snmpStatus==='err' && !absentCls/,
    'un apparato irraggiungibile (grigio) o provato assente non prende anche l\'anello SNMP');
});

// ── Lo stato operativo DICHIARATO cambia la LETTURA, mai la misura ──────────
// (lib/device-status.js · docs/adr/measured-not-declared.md)

test('assenza SPIEGATA dallo stato dichiarato: non e piu il rosso d\'allerta', () => {
  const n = { id: 'sw9', status: 'planned', proof: { status: 'absent' } };
  assert.equal(nodePresenceClass(n, null), ' node-absent-expected');
  // e lo stesso vale quando la Verifica ha appena prodotto il report
  assert.equal(nodePresenceClass(n, { macOrphan: [{ nodeId: 'sw9' }], unverified: [] }), ' node-absent-expected');
});

test('senza stato dichiarato il comportamento storico non si muove', () => {
  assert.equal(nodePresenceClass({ id: 'a', proof: { status: 'absent' } }, null), ' node-absent');
  assert.equal(nodePresenceClass({ id: 'a', status: '', proof: { status: 'absent' } }, null), ' node-absent');
  // uno stato non riconosciuto e' come non dichiarato: non silenzia niente
  assert.equal(nodePresenceClass({ id: 'a', status: 'banana', proof: { status: 'absent' } }, null), ' node-absent');
});

test('«in servizio» non silenzia un\'assenza: il rosso resta rosso', () => {
  assert.equal(nodePresenceClass({ id: 'a', status: 'active', proof: { status: 'absent' } }, null), ' node-absent');
});

test('⚠️ la CONTRADDIZIONE: dichiarato fuori servizio ma risponde', () => {
  // e' il caso simmetrico al silenziamento: senza, il campo sarebbe solo un modo
  // per far sparire i problemi.
  assert.equal(nodePresenceClass({ id: 'a', status: 'offline', proof: { status: 'proven' } }, null), ' node-status-conflict');
  assert.equal(nodePresenceClass({ id: 'a', status: 'decommissioning', proof: { status: 'proven' } }, null), ' node-status-conflict');
});

test('la contraddizione batte l\'uscita anticipata di «ha risposto da poco»', () => {
  // e' proprio il caso in cui accade: risponde ORA, e il documento dice che non dovrebbe.
  const n = { id: 'a', status: 'offline', snmpStatus: 'ok', snmpLastOk: new Date().toISOString() };
  assert.equal(nodePresenceClass(n, null), ' node-status-conflict');
  // mentre un apparato in servizio che risponde non ha nessun overlay, come sempre
  const ok = { id: 'b', status: 'active', snmpStatus: 'ok', snmpLastOk: new Date().toISOString() };
  assert.equal(nodePresenceClass(ok, null), '');
});

test('lo stato dichiarato non tocca il grigio del «non verificabile»', () => {
  // non abbiamo misurato niente: non c'e' nulla da spiegare ne' da contraddire
  assert.equal(nodePresenceClass({ id: 'a', status: 'planned', proof: { status: 'unverified' } }, null), ' node-unverified');
});
