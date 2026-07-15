'use strict';
// ============================================================
// PANEL-SKIN — test del parser/validatore puro delle skin SVG custom del
// pannello device (frontale O retro). Copre: sanitizzazione (script/on*/
// foreignObject/ref esterni/js URI), estrazione porte (id port-/sfp-/mgmt-N +
// data-port), viewBox, mappatura pid, faccia front/rear, e i casi d'errore
// (no svg / no viewBox / no porte) + warning non bloccanti.
const test = require('node:test');
const assert = require('node:assert');
const PS = require('../lib/panel-skin.js');

// SVG di base valido: 3 porte dati + 1 mgmt, con viewBox.
const OK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 40">
  <rect id="port-1" x="0" y="0" width="10" height="10"/>
  <rect id="port-2" x="12" y="0" width="10" height="10"/>
  <rect id="port-3" x="24" y="0" width="10" height="10"/>
  <rect id="mgmt-1" x="380" y="0" width="10" height="10"/>
</svg>`;

// ---- sanitizeSvg --------------------------------------------------------

test('sanitize: rimuove <script>', () => {
  const r = PS.sanitizeSvg(`<svg><script>alert(1)</script><rect id="port-1"/></svg>`);
  assert.ok(!/script/i.test(r.svg), 'niente tag script');
  assert.ok(r.removed.includes('script'));
});

test('sanitize: rimuove handler on* inline', () => {
  const r = PS.sanitizeSvg(`<svg><rect id="port-1" onclick="steal()" onload='x()'/></svg>`);
  assert.ok(!/onclick|onload/i.test(r.svg), 'niente handler eventi');
  assert.ok(r.removed.includes('event-handlers'));
  assert.ok(/id="port-1"/.test(r.svg), 'la forma resta, solo gli handler via');
});

test('sanitize: rimuove foreignObject e iframe', () => {
  const r = PS.sanitizeSvg(`<svg><foreignObject><body>x</body></foreignObject><iframe src="//evil"></iframe></svg>`);
  assert.ok(!/foreignObject|iframe/i.test(r.svg));
  assert.ok(r.removed.includes('foreignObject'));
  assert.ok(r.removed.includes('iframe'));
});

test('sanitize: strippa riferimenti esterni, tiene quelli locali #', () => {
  const r = PS.sanitizeSvg(`<svg><image href="https://evil/x.png"/><use xlink:href="#grad"/></svg>`);
  assert.ok(!/https:\/\/evil/.test(r.svg), 'href esterno rimosso');
  assert.ok(/xlink:href="#grad"/.test(r.svg), 'riferimento locale #grad preservato');
  assert.ok(r.removed.includes('external-ref'));
});

test('sanitize: neutralizza javascript: URI', () => {
  const r = PS.sanitizeSvg(`<svg><a href="javascript:alert(1)"><rect id="port-1"/></a></svg>`);
  assert.ok(!/javascript:/i.test(r.svg));
  assert.ok(r.removed.includes('javascript-uri'));
});

test('sanitize: SVG pulito non viene toccato', () => {
  const r = PS.sanitizeSvg(OK_SVG);
  assert.equal(r.removed.length, 0);
  assert.equal(r.svg, OK_SVG);
});

// ---- sanitize: vettori di bypass che PRIMA passavano (A1) ---------------

test('sanitize: handler on* NON quotato (onerror=alert(1))', () => {
  const r = PS.sanitizeSvg(`<svg><image href="x" onerror=alert(1)/><rect id="port-1"/></svg>`);
  assert.ok(!/onerror/i.test(r.svg), 'handler non quotato rimosso');
  assert.ok(r.removed.includes('event-handlers'));
});

test('sanitize: handler on* con backtick', () => {
  const r = PS.sanitizeSvg('<svg><rect id="port-1" onclick=`steal()`/></svg>');
  assert.ok(!/onclick/i.test(r.svg), 'handler backtick rimosso');
  assert.ok(r.removed.includes('event-handlers'));
});

test('sanitize: handler on* separato da slash (id="x"/onmouseover=…)', () => {
  const r = PS.sanitizeSvg(`<svg><rect id="port-1"/onmouseover="steal()"/></svg>`);
  assert.ok(!/onmouseover/i.test(r.svg), 'niente handler dopo lo slash');
  assert.ok(r.removed.includes('event-handlers'));
});

test('sanitize: <script> NON chiuso (bypass della regex di coppia)', () => {
  const r = PS.sanitizeSvg(`<svg><script>alert(document.cookie)<rect id="port-1"/></svg>`);
  assert.ok(!/<script/i.test(r.svg), 'niente tag <script>, anche orfano');
  assert.ok(r.removed.includes('script'));
  assert.ok(/id="port-1"/.test(r.svg), 'la forma-porta resta');
});

test('sanitize: <foreignObject> NON chiuso rimosso', () => {
  const r = PS.sanitizeSvg(`<svg><foreignObject><rect id="port-1"/></svg>`);
  assert.ok(!/foreignObject/i.test(r.svg));
  assert.ok(r.removed.includes('foreignObject'));
});

test('sanitize: riferimento esterno NON quotato (href=//evil)', () => {
  const r = PS.sanitizeSvg(`<svg><image href=//evil.example/x.png /><rect id="port-1"/></svg>`);
  assert.ok(!/evil\.example/.test(r.svg), 'href esterno non quotato rimosso');
  assert.ok(r.removed.includes('external-ref'));
});

test('sanitize: NON tocca i ref locali #… ne\' le forme valide (regressione)', () => {
  const clean = `<svg viewBox="0 0 10 10"><use xlink:href="#grad"/><rect id="port-1"/></svg>`;
  const r = PS.sanitizeSvg(clean);
  assert.equal(r.removed.length, 0);
  assert.ok(/xlink:href="#grad"/.test(r.svg), 'ref locale preservato');
});

// ---- extractSkinPorts ---------------------------------------------------

test('extract: trova port-/mgmt- e ordina (dati poi mgmt, per numero)', () => {
  const ports = PS.extractSkinPorts(OK_SVG);
  assert.deepEqual(ports.map(p => p.kind + p.num), ['port1', 'port2', 'port3', 'mgmt1']);
});

test('extract: ordina numericamente anche se l\'SVG e\' fuori ordine', () => {
  const svg = `<svg viewBox="0 0 1 1"><g id="port-10"/><g id="port-2"/><g id="port-1"/></svg>`;
  const ports = PS.extractSkinPorts(svg);
  assert.deepEqual(ports.map(p => p.num), [1, 2, 10]);
});

test('extract: sfp e\' alias di porta dati (stesso namespace)', () => {
  const svg = `<svg viewBox="0 0 1 1"><rect id="port-1"/><rect id="sfp-2"/></svg>`;
  const ports = PS.extractSkinPorts(svg);
  assert.equal(ports.length, 2);
  assert.equal(PS.skinPortPid('sw', ports.find(p => p.kind === 'sfp')), 'sw-2');
});

test('extract: supporta data-port="N"', () => {
  const svg = `<svg viewBox="0 0 1 1"><rect data-port="5"/></svg>`;
  const ports = PS.extractSkinPorts(svg);
  assert.equal(ports.length, 1);
  assert.equal(ports[0].num, 5);
});

test('extract: deduplica per (namespace,num)', () => {
  const svg = `<svg viewBox="0 0 1 1"><rect id="port-1"/><circle id="port-1"/></svg>`;
  const ports = PS.extractSkinPorts(svg);
  assert.equal(ports.length, 1, 'porta duplicata contata una volta');
});

// ---- parseViewBox -------------------------------------------------------

test('viewBox: estrae numeri e dimensioni', () => {
  const vb = PS.parseViewBox(OK_SVG);
  assert.equal(vb.viewBox, '0 0 400 40');
  assert.equal(vb.width, 400);
  assert.equal(vb.height, 40);
});

test('viewBox: virgole e spazi multipli normalizzati', () => {
  const vb = PS.parseViewBox(`<svg viewBox="0,0 , 100,  50"></svg>`);
  assert.deepEqual([vb.width, vb.height], [100, 50]);
});

test('viewBox: assente -> null', () => {
  assert.equal(PS.parseViewBox(`<svg width="100"></svg>`), null);
});

// ---- skinPortPid / buildSkinPidMap -------------------------------------

test('pid: porte dati -> id-N, mgmt -> id-mgmtN (indip. dalla faccia)', () => {
  assert.equal(PS.skinPortPid('sw1', { kind: 'port', num: 3 }), 'sw1-3');
  assert.equal(PS.skinPortPid('sw1', { kind: 'mgmt', num: 1 }), 'sw1-mgmt1');
});

test('pidMap: mappa idForma -> pid del nodo', () => {
  const ports = PS.extractSkinPorts(OK_SVG);
  const map = PS.buildSkinPidMap('rtr', ports);
  assert.equal(map['port-2'], 'rtr-2');
  assert.equal(map['mgmt-1'], 'rtr-mgmt1');
});

// ---- faccia front/rear --------------------------------------------------

test('face: default front, normalizza rear, ignora valori ignoti', () => {
  assert.equal(PS.normPanelFace(undefined), 'front');
  assert.equal(PS.normPanelFace('rear'), 'rear');
  assert.equal(PS.normPanelFace('back'), 'front', 'valore non riconosciuto -> front');
});

test('parse: faccia retro propagata nel descrittore', () => {
  const d = PS.parsePanelSkin(`<svg viewBox="0 0 10 10"><rect id="port-25"/><rect id="port-26"/></svg>`, { face: 'rear' });
  assert.ok(d.ok);
  assert.equal(d.face, 'rear');
  // su una faccia retro le porte non partono da 1: warning informativo, non errore
  assert.ok(d.warnings.some(w => /retro|non partono da 1/.test(w)));
});

// ---- parsePanelSkin (integrazione) -------------------------------------

test('parse: skin valida -> ok, counts, viewBox, pulita, face front', () => {
  const d = PS.parsePanelSkin(OK_SVG, { id: 'cisco-2960', name: 'Catalyst 2960', brand: 'Cisco', model: 'C2960', uHeight: 1 });
  assert.ok(d.ok, d.error || '');
  assert.equal(d.face, 'front');
  assert.equal(d.counts.data, 3);
  assert.equal(d.counts.mgmt, 1);
  assert.equal(d.viewBox, '0 0 400 40');
  assert.equal(d.brand, 'Cisco');
  assert.equal(d.uHeight, 1);
  assert.equal(d.warnings.length, 0);
});

test('parse: errore se manca <svg>', () => {
  const d = PS.parsePanelSkin('<div>nope</div>');
  assert.equal(d.ok, false);
  assert.equal(d.errorCode, 'no-svg');
});

test('parse: errore se manca viewBox', () => {
  const d = PS.parsePanelSkin(`<svg><rect id="port-1"/></svg>`);
  assert.equal(d.ok, false);
  assert.equal(d.errorCode, 'no-viewbox');
});

test('parse: errore se nessuna porta riconosciuta', () => {
  const d = PS.parsePanelSkin(`<svg viewBox="0 0 10 10"><rect id="logo"/></svg>`);
  assert.equal(d.ok, false);
  assert.equal(d.errorCode, 'no-ports');
});

test('parse: warning su numerazione non contigua (port-1, port-3)', () => {
  const d = PS.parsePanelSkin(`<svg viewBox="0 0 10 10"><rect id="port-1"/><rect id="port-3"/></svg>`);
  assert.ok(d.ok, 'non blocca, solo warning');
  assert.ok(d.warnings.some(w => /non contigua/.test(w)), 'segnala il buco');
});

test('parse: warning + sanitizzazione propagati nel descrittore', () => {
  const d = PS.parsePanelSkin(`<svg viewBox="0 0 10 10"><script>x()</script><rect id="port-1" onclick="y()"/></svg>`);
  assert.ok(d.ok);
  assert.ok(d.removed.includes('script'));
  assert.ok(d.removed.includes('event-handlers'));
  assert.ok(d.warnings.some(w => /rimossi per sicurezza/.test(w)));
  assert.ok(!/script|onclick/i.test(d.svg), 'svg nel descrittore e\' pulito');
});

test('parse: warning su width/height fissi (ostacolano lo scaling)', () => {
  const d = PS.parsePanelSkin(`<svg viewBox="0 0 10 10" width="500" height="50"><rect id="port-1"/></svg>`);
  assert.ok(d.ok);
  assert.ok(d.warnings.some(w => /width\/height fissi/.test(w)));
});
