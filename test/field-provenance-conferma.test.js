'use strict';
// ============================================================
//  UN DATO CHE UNA LETTURA HA SCRITTO O CONFERMA È MISURATO — SEMPRE
// ============================================================
// La regola dell'utente: quando un valore viene popolato da una lettura SNMP è misurato, e non deve risultare
// «Dichiarato» solo perché la copia è avvenuta con una versione dell'app che non teneva la provenienza, o perché
// il nodo è NATO da una scansione (il letterale scrive mac e marca in un colpo solo, nessuna assegnazione).
// Tre buchi, tre chiusure:
//   1. una lettura che trova nel campo lo STESSO valore lo conferma e lo marca (i dati vecchi guariscono al Sync);
//   2. un record nato da una lettura marca i campi che porta pieni;
//   3. chi mostra non si fida solo della marca: `fieldSource` conta anche la conferma del dispositivo di adesso.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const FP = require('../lib/field-provenance.js');
const ID = require('../lib/identity-reconcile.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// ── le primitive ─────────────────────────────────────────────────────────────

test("confirmFromRead: marca solo se la lettura dice la STESSA cosa che il campo contiene", () => {
  const r = { desc: "Uplink verso il core" };
  assert.equal(FP.confirmFromRead(r, "desc", " uplink verso il core "), true, "trim e maiuscole non sono una differenza");
  assert.equal(FP.isFromRead(r, "desc"), true);
  const diverso = { desc: "La metto io" };
  assert.equal(FP.confirmFromRead(diverso, "desc", "Altro testo"), false);
  assert.ok(!("copiedFromRead" in diverso), "una lettura diversa NON marca: il valore resta di chi l'ha scritto");
  const vuoto = {};
  assert.equal(FP.confirmFromRead(vuoto, "desc", "x"), false, "un campo vuoto non si conferma (si riempie, con fillFromRead)");
  assert.equal(FP.confirmFromRead({ desc: "x" }, "desc", ""), false, "una lettura vuota non conferma niente");
  assert.equal(FP.confirmFromRead(null, "desc", "x"), false);
});

test("markFilledFromRead: marca i campi che il record ha pieni, e solo quelli", () => {
  const n = { mac: "AA:BB:CC:DD:EE:01", brand: "", hostname: "h", ip: "10.0.0.1" };
  FP.markFilledFromRead(n, ["mac", "brand", "model"]);
  assert.deepEqual(n.copiedFromRead, { mac: true }, "brand vuoto e model assente non si marcano");
  FP.markFilledFromRead(null, ["mac"]);                       // nessun errore
  FP.markFilledFromRead({}, undefined);                       // nessun errore
});

test("fieldSource: tabella di verità", () => {
  const marcato = (v) => ({ model: v, copiedFromRead: { model: true } });
  // vuoto → nessuna provenienza da dire
  assert.equal(FP.fieldSource({}, "model", "X"), null);
  assert.equal(FP.fieldSource({ model: "  " }, "model", "X"), null);
  // il dispositivo lo CONFERMA → misurato, marcato o no
  assert.equal(FP.fieldSource({ model: "GS1900" }, "model", "gs1900"), "measured");
  assert.equal(FP.fieldSource(marcato("GS1900"), "model", "GS1900"), "measured");
  // né marcato né confermato → dichiarato
  assert.equal(FP.fieldSource({ model: "GS1900" }, "model", "GS1900-48"), "declared");
  assert.equal(FP.fieldSource({ model: "GS1900" }, "model", undefined), "declared");
  assert.equal(FP.fieldSource({ model: "GS1900" }, "model", ""), "declared");
  // marcato e la lettura di adesso manca → misurato (l'apparato che tace non smentisce)
  assert.equal(FP.fieldSource(marcato("GS1900"), "model", undefined), "measured");
  assert.equal(FP.fieldSource(marcato("GS1900"), "model", ""), "measured");
  // marcato ma la lettura di adesso dice ALTRO → dichiarato (l'apparato è cambiato), tranne `lenient`
  assert.equal(FP.fieldSource(marcato("GS1900"), "model", "ALTRO"), "declared");
  assert.equal(FP.fieldSource(marcato("Cisco"), "model", "Cisco Systems Inc", { lenient: true }), "measured");
  // un campo senza lettura da confrontare (MAC, IP di porta): conta la sola marca
  assert.equal(FP.fieldSource({ mac: "aa" , copiedFromRead: { mac: true } }, "mac"), "measured");
  assert.equal(FP.fieldSource({ mac: "aa" }, "mac"), "declared");
});

test("fillIdentityFromRead: un campo che c'era già ed è uguale alla lettura viene CONFERMATO, non riscritto", () => {
  const n = { model: "GS1900-24", serialNumber: "MIO-SERIALE", brand: "ZyXEL, Inc." };
  const scritti = ID.fillIdentityFromRead(n, { brand: "ZyXEL, Inc.", model: "gs1900-24", serialNumber: "S202", firmwareVer: "2.10" }, "");
  assert.deepEqual([...scritti].sort(), ["firmwareVer"], "scrive solo il vuoto");
  assert.equal(n.model, "GS1900-24", "il valore esistente non si tocca (manual-first)");
  assert.deepEqual(n.copiedFromRead, { brand: true, model: true, firmwareVer: true },
    "marca, modello e firmware sono misurati; la matricola e' diversa e resta di chi l'ha scritta");
});

// ── il Sync e la Discovery nel browser finto ─────────────────────────────────

let APP;
test("carica l'app nel DOM finto", () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });
const J = (code) => JSON.parse(run(APP.ctx, "(() => { try { " + code + " } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.message||e) }); } })()"));

test("Sync: IP e descrizione di porta GIÀ presenti e uguali alla lettura guariscono (marcati), quelli diversi no", () => {
  const r = J(`
    state = _buildDefaultState(); state.ports = state.ports || {};
    state.nodes.push({ id:'zc1', type:'switch', name:'ZC', ports:3, ip:'10.0.0.1' });
    // copiati da una versione che non teneva la provenienza: uguali a quello che dira' l'apparato
    state.ports['zc1-1'] = { ifName:'Gi1', alias:'Uplink verso il core', desc:'Uplink verso il core', ip:'10.0.0.2' };
    // scritti da una persona: diversi
    state.ports['zc1-2'] = { ifName:'Gi2', alias:'Vecchio alias', desc:'Sala server', ip:'192.168.9.9' };
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    applyPollResult('zc1', { ok:true, lags:[], vlans:[], interfaces:[
      { name:'Gi1', operStatus:1, alias:'Uplink verso il core', ip:'10.0.0.2' },
      { name:'Gi2', operStatus:1, alias:'Altro alias', ip:'10.0.0.3' } ] }, { noHistory:true });
    return JSON.stringify({ ok:true, p1:state.ports['zc1-1'], p2:state.ports['zc1-2'] });`);
  assert.ok(r.ok, r.err);
  assert.deepEqual(r.p1.copiedFromRead, { desc: true, ip: true }, "confermati dall'apparato → misurati");
  assert.equal(r.p2.desc, "Sala server");
  assert.equal(r.p2.ip, "192.168.9.9");
  assert.ok(!r.p2.copiedFromRead, "diversi da ciò che dice l'apparato: restano di chi li ha scritti");
});

test("Sync: l'identità già presente e uguale all'ENTITY-MIB guarisce al giro successivo", () => {
  const r = J(`
    state = _buildDefaultState();
    state.nodes.push({ id:'zc2', type:'switch', name:'ZC', ports:2, ip:'10.0.0.5', model:'GS1900-24', brand:'ZyXEL, Inc.' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    applyPollResult('zc2', { ok:true, lags:[], vlans:[], interfaces:[], inventory:{ brand:'ZyXEL, Inc.', model:'GS1900-24', serialNumber:'S1', firmwareVer:'2.10' } }, { noHistory:true });
    return JSON.stringify({ ok:true, c: nodeById('zc2').copiedFromRead });`);
  assert.ok(r.ok, r.err);
  assert.deepEqual(r.c, { brand: true, model: true, serialNumber: true, firmwareVer: true });
});

test("Discovery: un MAC già presente e visto uguale dalla rete viene confermato; uno diverso no", () => {
  const r = J(`
    state = _buildDefaultState();
    state.nodes.push({ id:'zc3', type:'server', name:'S', ports:1, ip:'10.0.0.50', mac:'AA:BB:CC:DD:EE:01' });
    state.nodes.push({ id:'zc4', type:'server', name:'S', ports:1, ip:'10.0.0.51', mac:'00:11:22:33:44:55' });
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    _discTouchNodeIdentity(nodeById('zc3'), { ip:'10.0.0.50', mac:'aa:bb:cc:dd:ee:01' }, 'ip', null);
    _discTouchNodeIdentity(nodeById('zc4'), { ip:'10.0.0.51', mac:'AA:BB:CC:DD:EE:02' }, 'ip', null);
    return JSON.stringify({ ok:true, a: nodeById('zc3').copiedFromRead||null, b: nodeById('zc4').copiedFromRead||null, macB: nodeById('zc4').mac });`);
  assert.ok(r.ok, r.err);
  assert.deepEqual(r.a, { mac: true });
  assert.equal(r.b, null);
  assert.equal(r.macB, "00:11:22:33:44:55", "manual-first: il MAC diverso non si tocca");
});

// ── i dati vecchi, sullo schermo ─────────────────────────────────────────────

function html(scope, rec) {
  const r = J(`
    state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
    _propsExplicit = true; state.ports = state.ports || {};
    state.nodes.push({ id:'zp9', type:'switch', name:'ZP-9', ports:4, ip:'10.0.0.9', x:10, y:10 });
    state.ports['zp9-1'] = ${JSON.stringify(rec)};
    if(typeof _invalidateIdx==='function') _invalidateIdx();
    ${scope === "port" ? "selType='port'; selId='zp9-1';" : "selType='node'; selId='zp9';"} renderProps();
    return JSON.stringify({ ok:true, html: document.getElementById('props-panel').innerHTML || '' });`);
  assert.ok(r.ok, r.err);
  return r.html;
}
function segno(h, marcatore) {
  const i = h.indexOf(marcatore);
  assert.ok(i >= 0, marcatore + " non e' nel pannello");
  const lab = h.slice(0, i).slice(h.slice(0, i).lastIndexOf("<label>"));
  const m = lab.match(/class="cty-mark cty-(\w+)"/);
  return m ? m[1] : null;
}

test("porta: una descrizione uguale all'alias del dispositivo è MISURATA anche se copiata prima delle marche", () => {
  // Nel progetto 24 dell'utente: 47 descrizioni su 47 sono copie esatte dell'alias, e tutte dicevano «Dichiarato».
  const D = 'data-pfield="desc"';
  assert.equal(segno(html("port", { alias: "Uplink core", desc: "Uplink core" }), D), "measured");
  assert.equal(segno(html("port", { alias: "Uplink core", desc: "Sala server" }), D), "declared", "diversa dall'alias: è di una persona");
  assert.equal(segno(html("port", { desc: "Sala server" }), D), "declared", "senza alias non c'è niente che la confermi");
});

test("porta: un IP senza marca resta «Dichiarato» finché un Sync non lo conferma; con la marca è «Misurato»", () => {
  const I = 'data-pfield="ip"';
  assert.equal(segno(html("port", { ip: "10.0.0.2", ownsIp: true }), I), "declared");
  assert.equal(segno(html("port", { ip: "10.0.0.2", ownsIp: true, copiedFromRead: { ip: true } }), I), "measured");
});

// ── ogni nodo nato da una lettura marca ──────────────────────────────────────

test("guardiano: ogni creazione di un nodo in src/ marca i campi nati da una lettura, o è una scelta di una persona dichiarata qui", () => {
  // Il letterale `{ mac: …, brand: … }` NON è un'assegnazione: il guardiano delle scritture non lo vede. Qui si cerca il
  // `nodes.push(` e si pretende `markFilledFromRead(` nelle righe prima — oppure un'eccezione col suo motivo.
  const ECCEZIONI = {
    "app-csv-import.js": "i nodi vengono da un file che una persona ha compilato: dichiarati",
    "app-pointer.js": "la palette: l'utente trascina un apparato sul disegno",
    "app-shared-segment.js": "l'utente crea lo switch non gestito del segmento condiviso: nessun MAC letto",
  };
  const trovati = [];
  for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith(".js"))) {
    const righe = fs.readFileSync(path.join(SRC, f), "utf8").split("\n");
    righe.forEach((riga, i) => {
      if (/^\s*(\/\/|\*)/.test(riga) || !/store\.state\.nodes\.push\(/.test(riga)) return;
      const prima = righe.slice(Math.max(0, i - 90), i + 1).join("\n");
      trovati.push({ f, dove: f + ":" + (i + 1), marcato: /markFilledFromRead\(/.test(prima) });
    });
  }
  assert.ok(trovati.length >= 8, "letti i punti di creazione veri: " + trovati.map((t) => t.dove).join(" "));
  const abusivi = trovati.filter((t) => !t.marcato && !ECCEZIONI[t.f]);
  assert.deepEqual(abusivi.map((t) => t.dove), [],
    "nodi creati senza marcare la provenienza di ciò che hanno letto: chiama markFilledFromRead(n, [campi]) prima del push, o elenca qui un motivo");
  // le eccezioni devono servire ancora, e nessun sito «da lettura» deve nascondersi dietro di loro
  for (const f of Object.keys(ECCEZIONI)) assert.ok(trovati.some((t) => t.f === f), "l'eccezione " + f + " non serve più: toglila");
  for (const f of ["app-discovery.js", "app-topology-crawl.js", "app-drift-adopt.js", "app-topology-rebuild.js"]) {
    assert.ok(trovati.some((t) => t.f === f && t.marcato), f + " crea nodi da una lettura e deve marcarli");
  }
});

test("Discovery: la fusione con un nodo già documentato conferma MAC e marca che la scansione ritrova uguali", () => {
  // La fusione sta dentro la funzione grande dell'import e non si esercita dal DOM finto: la si fissa sul testo,
  // come la regola «si marca dove si scrive» si fissa sui punti di scrittura.
  const src = fs.readFileSync(path.join(SRC, "app-discovery.js"), "utf8");
  assert.ok(/confirmFromRead\(foundExisting,\s*'mac',\s*safeMac\)/.test(src), "il MAC ritrovato uguale va confermato");
  assert.ok(/confirmFromRead\(foundExisting,\s*'brand',\s*d\.vendor\)/.test(src), "la marca ritrovata uguale va confermata");
  assert.ok(/markFilledFromRead\(n,\s*\['mac',\s*'brand'\]\)/.test(src), "il nodo nato dalla scansione marca MAC e marca");
});
