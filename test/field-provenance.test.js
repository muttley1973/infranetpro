'use strict';
// ============================================================
//  LA PROVENIENZA DI UN VALORE È LA REGOLA, NON UN'ECCEZIONE
// ============================================================
// Un campo che una persona può scrivere e che una lettura (Sync, Discovery) riempie quando è
// vuoto non dice, dopo la copia, da dove viene: a valle diventa «dichiarato». Tre difetti del
// 16/10 avevano questa radice (vedi lib/field-provenance.js). Qui la regola è tenuta in piedi
// da quattro cose:
//   1. le primitive (marca, cancella, chiedi);
//   2. il REGISTRO dei campi a doppia natura, agganciato allo schema del progetto;
//   3. due guardiani che si DERIVANO dal codice — nessun campo nuovo scritto da una lettura può
//      non essere classificato, nessun nuovo scrittore di un campo marcato può saltare il segno;
//   4. il comportamento vero: la lettura marca, la persona cancella.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const FP = require('../lib/field-provenance.js');
const ID = require('../lib/identity-reconcile.js');
const { classifyField } = require('../lib/project-schema.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// ── 1. le primitive ──────────────────────────────────────────────────────────

test('markFromRead / isFromRead / forgetFromRead: per campo, e senza lasciare oggetti vuoti', () => {
  const r = {};
  FP.markFromRead(r, 'desc'); FP.markFromRead(r, 'ip');
  assert.deepEqual(r.copiedFromRead, { desc: true, ip: true });
  assert.equal(FP.isFromRead(r, 'desc'), true);
  assert.equal(FP.isFromRead(r, 'mac'), false);
  FP.forgetFromRead(r, 'desc');
  assert.deepEqual(r.copiedFromRead, { ip: true });
  FP.forgetFromRead(r, 'ip');
  assert.ok(!('copiedFromRead' in r), 'tolta l\'ultima marca sparisce anche l\'oggetto');
  FP.forgetFromRead(r, 'ip'); FP.forgetFromRead(null, 'x'); FP.forgetFromRead(undefined, 'x');   // nessun errore
  FP.markFromRead(null, 'x');                                                                      // nessun errore
});

test('fillFromRead: riempie solo un vuoto, marca solo ciò che ha scritto, mai una chiave vuota', () => {
  const r = {};
  assert.equal(FP.fillFromRead(r, 'mac', 'aa:bb:cc:dd:ee:ff'), true);
  assert.equal(r.mac, 'aa:bb:cc:dd:ee:ff');
  assert.equal(FP.isFromRead(r, 'mac'), true);
  // un campo già pieno non si tocca e non si marca
  const piena = { mac: 'MIO' };
  assert.equal(FP.fillFromRead(piena, 'mac', 'altro'), false);
  assert.equal(piena.mac, 'MIO');
  assert.ok(!('copiedFromRead' in piena));
  // uno spazio non è un valore, né da scrivere né nel campo
  const spazi = { mac: '   ' };
  assert.equal(FP.fillFromRead(spazi, 'mac', 'x'), true, 'degli spazi non sono un valore: si riempie');
  const vuoto = {};
  assert.equal(FP.fillFromRead(vuoto, 'mac', ''), false);
  assert.equal(FP.fillFromRead(vuoto, 'mac', null), false);
  assert.ok(!('mac' in vuoto) && !('copiedFromRead' in vuoto), 'un valore vuoto non crea nemmeno la chiave');
  // la condizione in più (il lucchetto) vince
  assert.equal(FP.fillFromRead({}, 'brand', 'X', false), false);
});

test('stillFromRead: marcato E ancora uguale alla lettura; sameReadValue: trim e maiuscole', () => {
  const r = { model: 'GS1900', copiedFromRead: { model: true } };
  assert.equal(FP.stillFromRead(r, 'model', ' gs1900 '), true);
  assert.equal(FP.stillFromRead(r, 'model', 'ALTRO'), false);
  assert.equal(FP.stillFromRead({ model: 'GS1900' }, 'model', 'GS1900'), false, 'senza marca resta dichiarato');
  assert.equal(FP.sameReadValue('', ''), false, 'due vuoti non sono «lo stesso valore»');
});

test('i nomi d\'identità di identity-reconcile sono le STESSE primitive, non copie', () => {
  assert.equal(ID.markCopiedFromRead, FP.markFromRead);
  assert.equal(ID.forgetCopiedFromRead, FP.forgetFromRead);
  assert.equal(ID.copiedStillRead, FP.stillFromRead);
  assert.equal(ID.sameIdentityValue, FP.sameReadValue);
});

// ── 2. il registro ───────────────────────────────────────────────────────────

const MECCANISMI = ['mark', 'lock', 'override', 'shadow', 'flag', 'debt'];

test('registro: ogni campo ha almeno un meccanismo, e solo meccanismi conosciuti', () => {
  for (const [scope, campi] of Object.entries(FP.FIELD_PROVENANCE)) {
    for (const [campo, e] of Object.entries(campi)) {
      const chiavi = Object.keys(e);
      assert.ok(chiavi.length > 0, `${scope}.${campo}: nessun meccanismo`);
      for (const k of chiavi) assert.ok(MECCANISMI.includes(k), `${scope}.${campo}: «${k}» non è un meccanismo`);
    }
  }
});

test('registro: ogni campo è DOCUMENT nello schema (è proprio la doppia natura), e i suoi lucchetti/ombre sono classificati', () => {
  for (const [scope, campi] of Object.entries(FP.FIELD_PROVENANCE)) {
    for (const [campo, e] of Object.entries(campi)) {
      assert.equal(classifyField(scope, campo), 'document', `${scope}.${campo} dovrebbe essere document nello schema`);
      if (e.lock) assert.equal(classifyField(scope, e.lock), 'document', `${scope}.${e.lock} (lucchetto) non classificato come document`);
      if (e.override) assert.equal(classifyField(scope, e.override), 'document', `${scope}.${e.override} (slot della persona) non classificato come document`);
      if (e.shadow) assert.equal(classifyField(scope, e.shadow), 'measure', `${scope}.${e.shadow} (ombra) dovrebbe essere una misura`);
    }
  }
});

test('registro: le quattro identità di identity-reconcile sono tutte campi marcati', () => {
  for (const f of ID.IDENTITY_FIELDS) assert.ok(FP.provenanceFields('node').includes(f), f + ' manca dal registro');
});

test('registro: il segno stesso è una misura, su nodo e su porta (non esce nell\'export portabile)', () => {
  assert.equal(classifyField('node', 'copiedFromRead'), 'measure');
  assert.equal(classifyField('port', 'copiedFromRead'), 'measure');
});

test('registro: il DEBITO si può solo ridurre', () => {
  // Campi che una lettura riscrive a ogni giro e che una persona può seminare (cavo, import), a cui
  // nessun meccanismo è stato ancora dato. Se ne togli uno, ABBASSA questo tetto: non si alza mai.
  const DEBITO_MAX = { node: 0, port: 11 };
  for (const scope of Object.keys(FP.FIELD_PROVENANCE)) {
    const debito = FP.provenanceDebt(scope);
    assert.ok(debito.length <= (DEBITO_MAX[scope] ?? 0),
      `${scope}: ${debito.length} campi in debito, il tetto è ${DEBITO_MAX[scope] ?? 0} — un campo nuovo senza meccanismo non si aggiunge: dagli il segno o il lucchetto. In debito: ${debito.join(', ')}`);
    if (debito.length < (DEBITO_MAX[scope] ?? 0)) assert.fail(`${scope}: il debito è sceso a ${debito.length}: abbassa DEBITO_MAX (il tetto non deve avanzare)`);
  }
});

test('registro: ogni debito dice PERCHÉ (nessun «TODO» muto)', () => {
  for (const [scope, campi] of Object.entries(FP.FIELD_PROVENANCE)) {
    for (const [campo, e] of Object.entries(campi)) {
      if (e.debt) assert.ok(typeof e.debt === 'string' && e.debt.length > 15, `${scope}.${campo}: il debito non è motivato`);
    }
  }
});

// ── 3. i guardiani derivati dal codice ───────────────────────────────────────

// Chi scrive per conto di una LETTURA. L'elenco dei file è corto di proposito: sono i percorsi in cui
// un'osservazione della rete entra nel progetto.
const PERCORSI_DI_LETTURA = ['app-snmp.js', 'app-discovery.js', 'app-discovery-classify.js'];
const RECV = {
  node: String.raw`(?:n|node|nd|ex|foundExisting)`,
  port: String.raw`(?:p|pp|pi|store\.state\.ports\[[^\]]+\]|state\.ports\[[^\]]+\])`,
};

/** [{ scope, campo, dove }] — ogni assegnazione `ricevente.campo =` nei percorsi di lettura. */
function scritturePerConto() {
  const out = [];
  for (const f of PERCORSI_DI_LETTURA) {
    fs.readFileSync(path.join(SRC, f), 'utf8').split('\n').forEach((riga, i) => {
      if (/^\s*(\/\/|\*)/.test(riga)) return;
      for (const scope of ['node', 'port']) {
        const rx = new RegExp(String.raw`\b` + RECV[scope] + String.raw`\.([A-Za-z0-9_]+)\s*=[^=]`, 'g');
        let m;
        while ((m = rx.exec(riga))) out.push({ scope, campo: m[1], dove: `${f}:${i + 1}` });
      }
    });
  }
  return out;
}

test('guardiano: ogni campo che una lettura scrive è CLASSIFICATO nello schema', () => {
  // Un campo misurato senza classe esce nell'export portabile accanto al documento (è già successo con
  // `snmpError`; il 16/10 ne sono stati trovati altri sette). Il giro dei progetti veri lo vede solo se
  // quel campo sta in un progetto salvato: qui si legge il CODICE.
  const scritture = scritturePerConto();
  assert.ok(scritture.length > 30, 'letti i percorsi di lettura veri: ' + scritture.length);
  const senzaClasse = [...new Set(scritture.filter(s => classifyField(s.scope, s.campo) === null).map(s => `${s.scope}.${s.campo} (${s.dove})`))];
  assert.deepEqual(senzaClasse, [],
    'campi scritti da una lettura e non classificati in lib/project-schema.js: ' + senzaClasse.join(', '));
});

test('guardiano: ogni campo DOCUMENT che una lettura scrive sta nel registro, con il suo meccanismo', () => {
  const scritture = scritturePerConto();
  const fuori = [...new Set(scritture
    .filter(s => classifyField(s.scope, s.campo) === 'document' && !(FP.FIELD_PROVENANCE[s.scope] || {})[s.campo])
    .map(s => `${s.scope}.${s.campo} (${s.dove})`))];
  assert.deepEqual(fuori, [],
    'una lettura scrive in un campo a doppia natura che il registro (lib/field-provenance.js) non conosce: dagli un meccanismo — il segno, il lucchetto, uno slot suo — o dichiara il debito: ' + fuori.join(', '));
});

test('guardiano: nessun nuovo scrittore RAW di un campo marcato, salvo quelli di una persona dichiarati qui', () => {
  // I campi con il segno si scrivono per conto di una lettura con fillFromRead/markFromRead. Una
  // scrittura grezza sopravvive solo se (a) sulla stessa riga c'è anche markFromRead, o (b) è una
  // scrittura di una PERSONA, elencata qui col suo motivo.
  const ECCEZIONI = {
    'app-device-types.js': 'l\'utente sceglie un modello dal catalogo: è una sua decisione (dichiarato)',
    'app-pointer.js': 'alla posa di un pannello vuoto/passacavo la marca si azzera: creazione, nessuna lettura',
    'app-shared-segment.js': 'l\'utente assegna un dispositivo/ruolo a un segmento condiviso: l\'etichetta della porta è scelta da lui',
  };
  const campi = { node: FP.provenanceFields('node'), port: FP.provenanceFields('port') };
  const trovati = [];
  for (const f of fs.readdirSync(SRC).filter(x => x.endsWith('.js'))) {
    fs.readFileSync(path.join(SRC, f), 'utf8').split('\n').forEach((riga, i) => {
      if (/^\s*(\/\/|\*)/.test(riga)) return;
      for (const scope of ['node', 'port']) {
        const recv = scope === 'node'
          ? String.raw`(?:n|node|nd|ex|foundExisting|nn|newNode|tgt|master|member|dev|host)`
          : String.raw`(?:p|pp|pi|port|store\.state\.ports\[[^\]]+\]|state\.ports\[[^\]]+\]|ports\[[^\]]+\])`;
        for (const campo of campi[scope]) {
          if (new RegExp(String.raw`\b` + recv + String.raw`\.` + campo + String.raw`\s*=[^=]`).test(riga)
              && !/markFromRead\(|fillFromRead\(|markCopiedFromRead\(/.test(riga)) {
            trovati.push({ f, dove: `${f}:${i + 1}`, scope, campo });
          }
        }
      }
    });
  }
  const abusivi = trovati.filter(t => !ECCEZIONI[t.f]);
  assert.deepEqual(abusivi.map(t => `${t.scope}.${t.campo} ${t.dove}`), [],
    'scritture grezze di un campo marcato fuori dalle eccezioni: usa fillFromRead/markFromRead (che registrano la provenienza) o aggiungi un\'eccezione motivata');
  // le eccezioni devono essere vere: se un file non scrive più nulla di grezzo, si toglie dall'elenco
  const usate = new Set(trovati.map(t => t.f));
  for (const f of Object.keys(ECCEZIONI)) assert.ok(usate.has(f), `l'eccezione ${f} non serve più: toglila`);
});

// ── 4. il comportamento vero ─────────────────────────────────────────────────

let APP;
test('carica l\'app nel DOM finto', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });
const J = (code) => JSON.parse(run(APP.ctx, '(() => { try { ' + code + ' } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.message||e) }); } })()'));

const LETTURA = `{ ok:true, lags:[], vlans:[], interfaces:[
  { name:'Gi1', operStatus:1, alias:'Uplink verso il core', ip:'10.0.0.2' },
  { name:'Gi2', operStatus:1, alias:'Lasciata dalla persona', ip:'10.0.0.3' } ] }`;

test('Sync: descrizione e indirizzo copiati dalla lettura sono marcati; quelli di una persona no', () => {
  const r = J(`
    state = _buildDefaultState(); state.ports = state.ports || {};
    state.nodes.push({ id:'zp1', type:'switch', name:'ZP', ports:2, ip:'10.0.0.1' });
    // Gi2 ha già una descrizione e un IP scritti da una persona
    state.ports['zp1-2'] = { desc:'Sala server', ip:'192.168.9.9' };
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    applyPollResult('zp1', ${LETTURA}, { noHistory:true });
    return JSON.stringify({ ok:true, p1:state.ports['zp1-1'], p2:state.ports['zp1-2'] });`);
  assert.ok(r.ok, r.err);
  assert.equal(r.p1.desc, 'Uplink verso il core');
  assert.equal(r.p1.ip, '10.0.0.2');
  assert.deepEqual(r.p1.copiedFromRead, { desc: true, ip: true });
  assert.equal(r.p2.desc, 'Sala server', 'manual-first: la descrizione di una persona non si tocca');
  assert.equal(r.p2.ip, '192.168.9.9');
  assert.ok(!r.p2.copiedFromRead, 'e non risulta copiata da una lettura');
});

test('porta: scrivere a mano, svuotare o ripristinare cancella la provenienza', () => {
  const r = J(`
    state = _buildDefaultState(); state.ports = state.ports || {};
    state.nodes.push({ id:'zp2', type:'switch', name:'ZP', ports:2, ip:'10.0.0.1' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    applyPollResult('zp2', ${LETTURA}, { noHistory:true });
    const prima = JSON.stringify(state.ports['zp2-1'].copiedFromRead);
    setPortField('zp2-1', 'desc', 'La metto io');
    const dopoDesc = JSON.stringify(state.ports['zp2-1'].copiedFromRead);
    clearPortField('zp2-1', 'ip');
    const dopoClear = state.ports['zp2-1'].copiedFromRead === undefined ? 'assente' : JSON.stringify(state.ports['zp2-1'].copiedFromRead);
    return JSON.stringify({ ok:true, prima, dopoDesc, dopoClear, desc:state.ports['zp2-1'].desc });`);
  assert.ok(r.ok, r.err);
  assert.deepEqual(JSON.parse(r.prima), { desc: true, ip: true });
  assert.deepEqual(JSON.parse(r.dopoDesc), { ip: true }, 'digitare la descrizione la toglie, l\'IP resta della lettura');
  assert.equal(r.desc, 'La metto io');
  assert.equal(r.dopoClear, 'assente', 'ripristinato anche l\'IP: nessuna marca, nemmeno l\'oggetto vuoto');
});

test('nodo: Discovery riempie un MAC vuoto e lo marca; un MAC già scritto non si tocca; scriverlo a mano lo toglie', () => {
  const r = J(`
    state = _buildDefaultState();
    state.nodes.push({ id:'zn1', type:'server', name:'S1', ports:1, ip:'10.0.0.50' });
    state.nodes.push({ id:'zn2', type:'server', name:'S2', ports:1, ip:'10.0.0.51', mac:'00:11:22:33:44:55' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const toc = (id, mac) => _discTouchNodeIdentity(nodeById(id), { ip: nodeById(id).ip, mac }, null);
    toc('zn1', 'AA:BB:CC:DD:EE:01');
    toc('zn2', 'AA:BB:CC:DD:EE:02');
    const a = JSON.stringify({ mac: nodeById('zn1').mac, c: nodeById('zn1').copiedFromRead||null });
    const b = JSON.stringify({ mac: nodeById('zn2').mac, c: nodeById('zn2').copiedFromRead||null });
    selType='node'; selId='zn1';
    updateN('mac', 'AA:BB:CC:DD:EE:99');
    const c = JSON.stringify({ mac: nodeById('zn1').mac, c: nodeById('zn1').copiedFromRead||null });
    return JSON.stringify({ ok:true, a, b, c });`);
  assert.ok(r.ok, r.err);
  const a = JSON.parse(r.a), b = JSON.parse(r.b), c = JSON.parse(r.c);
  assert.ok(a.mac && /aa:bb:cc:dd:ee:01/i.test(a.mac), 'riempito: ' + a.mac);
  assert.deepEqual(a.c, { mac: true });
  assert.equal(b.mac, '00:11:22:33:44:55', 'manual-first: il MAC scritto non si tocca');
  assert.equal(b.c, null);
  assert.equal(c.c, null, 'scritto a mano: la provenienza sparisce');
});

// ── il registro e le chiamate stanno d'accordo, nei due sensi ────────────────

/** Le chiamate `fillFromRead(ricevente, 'campo'…)` / `markFromRead(ricevente, 'campo')` in src/. */
function chiamateAlSegno() {
  const out = [];
  for (const f of fs.readdirSync(SRC).filter(x => x.endsWith('.js'))) {
    fs.readFileSync(path.join(SRC, f), 'utf8').split('\n').forEach((riga, i) => {
      if (/^\s*(\/\/|\*)/.test(riga)) return;
      const rx = /\b(?:fillFromRead|markFromRead)\(\s*([^,()]+?)\s*,\s*'([A-Za-z0-9_]+)'/g;
      let m;
      while ((m = rx.exec(riga))) {
        const scope = /^(?:p|pp|pi|port)$|ports\[/.test(m[1]) ? 'port' : 'node';
        out.push({ scope, campo: m[2], dove: `${f}:${i + 1}` });
      }
    });
  }
  return out;
}

test('guardiano: ogni campo che si marca in src/ è nel registro CON il segno', () => {
  const chiamate = chiamateAlSegno();
  assert.ok(chiamate.length >= 5, 'lette le chiamate vere: ' + chiamate.map(c => c.dove).join(' '));
  const fuori = chiamate.filter(c => !FP.provenanceFields(c.scope).includes(c.campo)).map(c => `${c.scope}.${c.campo} (${c.dove})`);
  assert.deepEqual(fuori, [], 'si marca un campo che il registro non dichiara «mark»: aggiungilo a FIELD_PROVENANCE (lib/field-provenance.js)');
});

test('guardiano: ogni campo «mark» del registro è davvero marcato da qualcuno (il registro non mente)', () => {
  const marcati = new Set(chiamateAlSegno().map(c => `${c.scope}.${c.campo}`));
  for (const f of ID.IDENTITY_FIELDS) marcati.add('node.' + f);   // le quattro identità passano da fillIdentityFromRead
  const orfani = [];
  for (const scope of ['node', 'port']) {
    for (const campo of FP.provenanceFields(scope)) if (!marcati.has(`${scope}.${campo}`)) orfani.push(`${scope}.${campo}`);
  }
  assert.deepEqual(orfani, [], 'campi dichiarati «mark» che nessun percorso di lettura marca più: togli la voce o ripristina la scrittura');
});

// ── gli altri gesti della persona, e il ritorno della lettura ────────────────

test('porta: updateP (il vecchio scrittore generico) e «ripristina tutto» cancellano la provenienza', () => {
  const r = J(`
    state = _buildDefaultState(); state.ports = state.ports || {};
    state.nodes.push({ id:'zp3', type:'switch', name:'ZP', ports:2, ip:'10.0.0.1' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    applyPollResult('zp3', ${LETTURA}, { noHistory:true });
    selType='port'; selId='zp3-1';
    updateP('ip', '172.16.0.9');
    const dopoUpdateP = JSON.stringify(state.ports['zp3-1'].copiedFromRead);
    // l'altra porta: la descrizione copiata sparisce col «ripristina tutto», e con lei la marca
    const prima = JSON.stringify(state.ports['zp3-2'].copiedFromRead);
    clearAllPortOverrides('zp3-2');
    const p2 = state.ports['zp3-2'];
    return JSON.stringify({ ok:true, dopoUpdateP, prima, descRimasta: p2.desc === undefined ? 'assente' : p2.desc,
      marcaDopo: p2.copiedFromRead === undefined ? 'assente' : JSON.stringify(p2.copiedFromRead) });`);
  assert.ok(r.ok, r.err);
  assert.deepEqual(JSON.parse(r.dopoUpdateP), { desc: true }, 'l\'IP scritto con updateP non e\' piu\' della lettura');
  assert.deepEqual(JSON.parse(r.prima), { desc: true, ip: true });
  assert.equal(r.descRimasta, 'assente');
  assert.deepEqual(JSON.parse(r.marcaDopo), { ip: true }, 'tolta la descrizione, la sua marca; quella dell\'IP resta');
});

test('porta: svuotato e rimportato, il campo si ripopola e torna a risultare copiato', () => {
  const r = J(`
    state = _buildDefaultState(); state.ports = state.ports || {};
    state.nodes.push({ id:'zp4', type:'switch', name:'ZP', ports:2, ip:'10.0.0.1' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    const dati = ${LETTURA};
    applyPollResult('zp4', dati, { noHistory:true });
    clearPortField('zp4-1', 'ip');
    const vuoto = JSON.stringify({ ip: state.ports['zp4-1'].ip === undefined ? 'assente' : state.ports['zp4-1'].ip, c: state.ports['zp4-1'].copiedFromRead });
    applyPollResult('zp4', dati, { noHistory:true });
    return JSON.stringify({ ok:true, vuoto, ip: state.ports['zp4-1'].ip, c: state.ports['zp4-1'].copiedFromRead });`);
  assert.ok(r.ok, r.err);
  assert.deepEqual(JSON.parse(r.vuoto), { ip: 'assente', c: { desc: true } });
  assert.equal(r.ip, '10.0.0.2', 'rimportato: il campo si ripopola');
  assert.deepEqual(r.c, { desc: true, ip: true }, 'e torna a risultare copiato dalla lettura');
});
