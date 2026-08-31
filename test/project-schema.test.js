'use strict';
// ============================================================
// GUARDIA — nessun campo del progetto resta senza classe (lib/project-schema.js).
//
// La classifica serve a costruire l'export per COSTRUZIONE invece che a memoria
// (Cambio 3). Ma una classifica incompleta è peggio di nessuna: dà l'impressione
// di aver deciso, mentre metà dei campi cade nel default. Questo test è ciò che
// impedisce quel silenzio.
//
// ── Il censimento, e il suo limite (detto, non nascosto) ───────────────────
// `projects/` NON è in git: i progetti veri stanno solo sulla macchina di chi
// lavora. Il censimento qui sotto è stato preso il 28/08/2026 da **13 progetti
// reali** (lab multivendor, stress enterprise-500, governance, casa) e vale come
// FOTOGRAFIA: blinda ciò che si sapeva quel giorno, così una classe non può
// sparire in silenzio.
//
// ⚠️ Quello che NON può fare: accorgersi da solo di un campo NUOVO che nessuno
//    di quei 13 progetti conteneva. Per quello c'è il secondo test, che gira sui
//    progetti veri **se ci sono** (in locale sì, in CI no) — e quando ci sono,
//    trova esattamente i campi che il censimento non conosce.
//    Chi aggiunge un campo misurato deve classificarlo. Questa guardia rende
//    quella dimenticanza rumorosa il prima possibile, non silenziosa per sempre.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../lib/project-schema.js');

const { classifyField, exportActionFor, fieldsOfClass,
  FIELD_SCOPES, FIELD_CLASSES, EXPORT_ACTION, TO_CONFIRM, FIELD_CLASS_BY_SCOPE } = S;

// Censimento 2026-08-28 · 13 progetti reali. Vedi l'intestazione.
const CENSUS = {
  state: `auditLog autoPoll bgImage bgImageAsset bgImageHash bgImageLocked bgImageOpacity
    bgImageScale currentRack dhcpSources discoveryHistory driftIgnores floorView gridHidden
    guestVlans ipam lagGroups lagModes lastAutoLinkResult lastSnmpSyncAt lastSnmpSyncResult
    lastVerify links mgmtVlans nativeVlan nodes ports rackView racks rejectedAutoLinks
    schemaVersion source topoCache uiColors vlanColors vlanNames voiceVlans`,
  node: `brand catalogMatch color currentIp discoveryConflicts firmwareVer firstSeen fontSize
    frontPanel h haPeer haRole hostname hostnameManual id identityConfidence identitySource
    inferred integration ip ip6 ipHistory ipManual isStructural lastSeen mac model name
    nameManual netbiosGroup netbiosName notes opacity passThrough pduEthernetPorts pduMgmtMode
    pduOutletCount pduPowerPorts placement platform portId ports positionSource
    possibleReplacement powerOutlets previousIps rackId rackU radios serialNumber sizeU
    smbShares snmpLastOk snmpStatus source spec srcLoc status type typeManual vendorHint vlan
    vms voiceVlan w x y`,
  spec: `pduOutletCount stackId stackMemberId stackRole swMgmt swPoeBudgetW voiceVlan`,
  port: `adminDown alias bridges desc downStreak ifName ip isTrunk isTrunkProp lagGroup lagId
    lagIfIndex logical mac mgmt mode operUp ownsIp parentPid sharedSegmentHint
    sharedSegmentMacCount sharedSegmentNodeId sharedSegmentRole sharedSegmentRoleSuggested
    snmpMedium snmpPoe speed srcFront srcIf srcRear status trunkProp trunkVlans vlan vlanOvr
    vlanProp`,
  link: `autoLinked bss cableCategory confidence dst id isPermanent lagLogicalKey lagMemberPair
    lagMembers mode protocol resolution source sourceCableId src trunkVlans wireless`,
  // Censimento 2026-08-31 · 17 progetti reali, 191 sacchetti `node.integration`
  // (nel campione nessun `vm.integration` ne' `vm.snmp`: le VM di questa
  // installazione non hanno un'integrazione propria). Vale come le altre righe —
  // una MISURA, non una deduzione dal codice che ci scrive dentro. La differenza
  // l'ha pagata subito: `lastError` sta in tre sacchetti veri e nel prodotto non lo
  // scrive ne' lo legge nessuno (lo lasciano i generatori di demo in `_local/`).
  // Dedotto dal codice, sarebbe rimasto senza classe.
  integration: `community driver host hostResources inventory lags lastError lastPoll port
    printer system vlanNames vlans`,
};
const keysOf = (scope) => CENSUS[scope].trim().split(/\s+/);

// ── Il cricchetto ──────────────────────────────────────────────────────────
for (const scope of Object.keys(CENSUS)) {
  test(`CRICCHETTO — ogni campo «${scope}» visto nei progetti veri ha una classe`, () => {
    const orfani = keysOf(scope).filter(k => classifyField(scope, k) === null);
    assert.deepStrictEqual(orfani, [],
      `campi «${scope}» senza classe in lib/project-schema.js:\n  ${orfani.join('\n  ')}\n`
      + 'Ognuno va deciso: document (esce) · measure/derived/private (non esce) · secret (esce svuotato).');
  });
}

test('CRICCHETTO — la classifica non elenca campi mai visti in nessun progetto', () => {
  // Non è un errore (esistono campi che compaiono solo dopo uno scan: `proof`,
  // `modelMatch`, `portsMeasured`…), ma vederli elencati tiene onesta la lista.
  // Gli ultimi tre li scrive SOLO un import DCIM, e il censimento è stato fatto
  // su progetti nati prima che l'import esistesse: `color` e `lengthM` arrivano
  // dal cavo NetBox, `overflow` da un apparato le cui interfacce sfondano le
  // posizioni del frontale. Visti su un import da NetBox vero (4.6.7), quindi
  // non sono campi finti — sono campi che il campione non poteva contenere.
  // ⚠️ `length` è un caso a sé, e l'ha trovato l'ALTRO guard — quello sui
  // progetti veri di questa installazione, non il censimento congelato qui
  // sopra. La lunghezza di un cavo ha due nomi: `lengthM` (documenti ed
  // etichette) e `length`, che è quello che il pannello cavo SCRIVE davvero.
  // Nessuno dei tredici progetti del campione aveva una lunghezza compilata,
  // quindi il censimento non poteva vederlo: non è un campo finto, è un campo
  // che il campione non conteneva. Si aggiunge qui invece che al censimento,
  // che è una misura e non si riscrive.
  const attesi = new Set(['proof', 'modelMatch', 'portsMeasured', 'osTypeMeasured', 'portsReal',
    'portsManual', 'backup', 'snmp', 'srcDevice', 'srcRack',
    'color', 'lengthM', 'length', 'overflow',
    // Il blocco SNMPv3 e il `timeout`: li scrive il pannello Integrazione
    // (`data-ikey`), ma nessuno dei 17 progetti del campione usa la v3. Campi che
    // il campione non poteva contenere, non campi finti. `hostManual` lo scrive il
    // Drift quando l'host lo decide una persona; `integration.mac` lo legge
    // `lib/correlate.js` e nel pannello non c'e' un campo che lo scriva.
    'timeout', 'v3user', 'v3authProto', 'v3authPass', 'v3privProto', 'v3privPass',
    'v3secLevel', 'v3context', 'hostManual', 'mac']);
  for (const scope of Object.keys(CENSUS)) {
    const visti = new Set(keysOf(scope));
    const extra = Object.keys(FIELD_CLASS_BY_SCOPE[scope]).filter(k => !visti.has(k) && !attesi.has(k));
    assert.deepStrictEqual(extra, [],
      `«${scope}» classifica campi che nessun progetto ha e che non sono nell'elenco atteso: ${extra.join(', ')}`);
  }
});

test('sui progetti VERI, se ci sono, nessun campo sfugge (in CI questo test passa a vuoto)', () => {
  const dir = path.join(__dirname, '..', 'projects');
  if (!fs.existsSync(dir)) return;   // CI: `projects/` non è in git
  const files = fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f));
  if (!files.length) return;

  const orfani = new Set();
  const nota = (scope, obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) if (classifyField(scope, k) === null) orfani.add(`${scope}.${k}`);
  };
  for (const f of files) {
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    if (s && s.state && Array.isArray(s.state.nodes)) s = s.state;
    if (!s || !Array.isArray(s.nodes)) continue;
    nota('state', s);
    for (const n of s.nodes) {
      nota('node', n); if (!n) continue;
      nota('spec', n.spec);
      // Il sacchetto credenziali: tre contenitori, una tabella sola. E' qui che si
      // vede per primo un campo segreto NUOVO — prima che qualcuno se ne accorga
      // perche' e' uscito in chiaro da un export.
      nota('integration', n.integration); nota('integration', n.snmp);
      for (const vm of (Array.isArray(n.vms) ? n.vms : [])) {
        if (!vm) continue;
        nota('integration', vm.integration); nota('integration', vm.snmp);
      }
    }
    for (const l of (s.links || [])) nota('link', l);
    const ports = (s.ports && typeof s.ports === 'object' && !Array.isArray(s.ports)) ? Object.values(s.ports) : [];
    for (const p of ports) nota('port', p);
  }
  assert.deepStrictEqual([...orfani].sort(), [],
    'campi presenti in un progetto reale e non classificati:\n  ' + [...orfani].sort().join('\n  '));
});

// ── Coerenza interna della classifica ──────────────────────────────────────
test('ogni classe dichiarata ha un\'azione di export, e sono solo tre', () => {
  assert.deepStrictEqual(Object.keys(EXPORT_ACTION).sort(), FIELD_CLASSES.slice().sort());
  for (const c of FIELD_CLASSES) {
    assert.ok(['keep', 'drop', 'blank'].includes(EXPORT_ACTION[c]), `azione ignota per ${c}`);
  }
  assert.strictEqual(EXPORT_ACTION.document, 'keep');
  assert.strictEqual(EXPORT_ACTION.measure, 'drop');
  assert.strictEqual(EXPORT_ACTION.derived, 'drop');
  assert.strictEqual(EXPORT_ACTION.private, 'drop');
  assert.strictEqual(EXPORT_ACTION.secret, 'blank', 'un segreto si SVUOTA, non si toglie: la forma resta');
});

test('ogni valore nella tabella è una classe conosciuta', () => {
  for (const scope of FIELD_SCOPES) {
    for (const [k, v] of Object.entries(FIELD_CLASS_BY_SCOPE[scope])) {
      assert.ok(FIELD_CLASSES.includes(v), `${scope}.${k} ha la classe ignota «${v}»`);
    }
  }
});

// ── ⚠️ Il default: un campo ignoto si TIENE ────────────────────────────────
test('⚠️ un campo NON classificato si tiene — non si butta via il dato di qualcuno', () => {
  assert.strictEqual(classifyField('node', 'campoDelFuturo'), null);
  assert.strictEqual(exportActionFor('node', 'campoDelFuturo'), 'keep');
  assert.strictEqual(exportActionFor('scopeInesistente', 'x'), 'keep');
  assert.strictEqual(classifyField('scopeInesistente', 'x'), null);
});

test('classifyField non si fa ingannare dalla catena dei prototipi', () => {
  for (const k of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    assert.strictEqual(classifyField('node', k), null, `${k} non è un campo di progetto`);
  }
});

// ── Le decisioni che contano, incise ───────────────────────────────────────
test('⭐ i campi a doppia natura restano DOCUMENT (sbagliare non cancella il lavoro di nessuno)', () => {
  // La regola: se una persona può scriverlo nella UI, è documento. Sbagliare
  // verso `document` fa uscire un dato in più; sbagliare verso `measure` CANCELLA.
  for (const k of ['serialNumber', 'mac', 'model', 'ip', 'hostname', 'platform', 'status']) {
    assert.strictEqual(classifyField('node', k), 'document', `node.${k} deve restare documento`);
  }
});

test('⭐ i campi-OMBRA sono misure: è la misura tenuta ACCANTO al dichiarato', () => {
  for (const k of ['modelMatch', 'portsMeasured', 'osTypeMeasured', 'proof']) {
    assert.strictEqual(classifyField('node', k), 'measure');
    assert.strictEqual(exportActionFor('node', k), 'drop');
  }
});

test('⭐ un cavo DEDOTTO resta riconoscibile come dedotto anche nell\'export', () => {
  // Togliere `autoLinked`/`confidence`/`protocol` non nasconderebbe una misura:
  // trasformerebbe ogni deduzione in una dichiarazione. È la bugia che il
  // proof-state esiste per impedire.
  for (const k of ['autoLinked', 'confidence', 'protocol']) {
    assert.strictEqual(classifyField('link', k), 'document', `link.${k} deve uscire`);
  }
});

test('i riferimenti d\'origine sono documento: c\'è un test che li fa sopravvivere', () => {
  // Gemello di test/source-ref-survival.test.js: se qui diventassero misure,
  // l\'export perderebbe l\'identità verso il DCIM e il giro dopo non si
  // riconoscerebbe più niente.
  for (const k of ['srcIf', 'srcFront', 'srcRear']) assert.strictEqual(classifyField('port', k), 'document');
  for (const k of ['srcLoc', 'srcDevice', 'srcRack']) assert.strictEqual(classifyField('node', k), 'document');
});

test('i tre derivati della VLAN combaciano con DERIVED_VLAN_FIELDS di project-format', () => {
  // Stessa verità in due file = il bug-classe di questo progetto. Finché le due
  // liste esistono entrambe, questa guardia le tiene allineate.
  const { DERIVED_VLAN_FIELDS } = require('../lib/project-format.js');
  for (const k of DERIVED_VLAN_FIELDS) {
    assert.strictEqual(classifyField('port', k), 'derived',
      `port.${k} è tolto da stripDerivedVlan: qui deve risultare derived`);
  }
});

test('il giornale delle modifiche è PRIVATO, non una misura (porta nomi utente)', () => {
  assert.strictEqual(classifyField('state', 'auditLog'), 'private');
  assert.strictEqual(exportActionFor('state', 'auditLog'), 'drop');
});

test('le credenziali si svuotano, non spariscono', () => {
  assert.strictEqual(exportActionFor('node', 'integration'), 'blank');
  assert.strictEqual(exportActionFor('node', 'snmp'), 'blank');
});

test('⭐ un contenitore `secret` non è un contenitore TUTTO segreto', () => {
  // `node.integration` porta la credenziale SNMP, ma anche host/driver/porta e le
  // misure dell'ultimo poll. `secret` sul CONTENITORE vuol dire «qui dentro c'è da
  // svuotare qualcosa»; CHE COSA lo dice lo scope `integration`. Prima non lo diceva
  // nessuno, e i due consumatori enumeravano tre nomi per conto loro — quindi un
  // quarto campo segreto sarebbe uscito in chiaro lasciando questa suite verde.
  assert.deepStrictEqual(fieldsOfClass('integration', 'secret'),
    ['community', 'v3authPass', 'v3privPass'],
    'i segreti del sacchetto sono i tre campi che il pannello marca type="password"');
  for (const k of ['driver', 'host', 'port', 'v3user', 'v3context']) {
    assert.strictEqual(classifyField('integration', k), 'document',
      `integration.${k} lo digita una persona: identifica, non autentica`);
  }
  for (const k of ['lags', 'vlans', 'inventory', 'system', 'lastPoll']) {
    assert.strictEqual(classifyField('integration', k), 'measure',
      `integration.${k} lo scrive il poll SNMP`);
  }
});

test('il PAVIMENTO della redazione non può restare indietro rispetto alla classifica', () => {
  // Gemello esatto della guardia su `DERIVED_VLAN_FIELDS`. `SECRET_FLOOR_FIELDS` sta
  // a mano APPOSTA — copre il caso in cui la classifica non sia caricata nel browser,
  // dove arriva da un `<script>` che netmapper.html mette prima di project-format —
  // quindi le due liste convivono. Questa guardia impedisce che il pavimento diventi
  // una TERZA verità invece di un minimo garantito.
  const { SECRET_FLOOR_FIELDS } = require('../lib/project-format.js');
  const dichiarati = new Set(fieldsOfClass('integration', 'secret'));
  for (const k of SECRET_FLOOR_FIELDS) {
    assert.ok(dichiarati.has(k),
      `${k} è nel pavimento di project-format ma non risulta \`secret\` nello scope `
      + 'integration: o è un segreto e va classificato, o non lo è e non va svuotato');
  }
});

// ── L'elenco delle cose da confermare prima di cambiare comportamento ──────
test('⚠️ TO_CONFIRM elenca solo campi VERI, non-document, e spiega il perché', () => {
  assert.ok(TO_CONFIRM.length > 0, 'se fosse vuoto, vorrebbe dire che è tutto deciso');
  for (const item of TO_CONFIRM) {
    assert.ok(FIELD_SCOPES.includes(item.scope), `scope ignoto: ${item.scope}`);
    const cls = classifyField(item.scope, item.key);
    assert.ok(cls, `${item.scope}.${item.key} non è nemmeno classificato`);
    assert.notStrictEqual(cls, 'document',
      `${item.scope}.${item.key} è document: non cambierebbe niente, non va confermato`);
    assert.ok(item.why && item.why.length > 10, `manca il perché per ${item.scope}.${item.key}`);
  }
});

// ── fieldsOfClass ──────────────────────────────────────────────────────────
test('fieldsOfClass elenca ordinato, e regge uno scope ignoto', () => {
  const m = fieldsOfClass('port', 'derived');
  assert.deepStrictEqual(m, m.slice().sort());
  assert.ok(m.includes('vlanProp') && m.includes('trunkProp'));
  assert.ok(!m.includes('vlan'), 'la VLAN dichiarata non è un derivato');
  assert.deepStrictEqual(fieldsOfClass('inesistente', 'document'), []);
});

test('ogni scope ha almeno un document e almeno un non-document (o è tutto documento, e si dice)', () => {
  for (const scope of FIELD_SCOPES) {
    assert.ok(fieldsOfClass(scope, 'document').length > 0, `${scope} non ha nemmeno un documento?`);
  }
  // `spec` è l'unico scope interamente dichiarato: è dove finisce ciò che scrive
  // una persona nel pannello. Se un giorno smettesse di esserlo, si vede qui.
  const specNonDoc = FIELD_CLASSES.filter(c => c !== 'document')
    .flatMap(c => fieldsOfClass('spec', c));
  assert.deepStrictEqual(specNonDoc, [], 'node.spec è tutto dichiarato, per costruzione');
});
