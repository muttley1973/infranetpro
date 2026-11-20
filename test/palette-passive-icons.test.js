'use strict';
// ============================================================
//  LA LIBRERIA: I PASSIVI DA RACK HANNO TUTTI LA STESSA ICONA GRIGIA
// ============================================================
// Il chip dell'icona in libreria si tinge PER TIPO (`styles/10-modern.css`, «LIBRERIA: chip icona tinto per tipo»): un
// tipo che nella regola non c'e' prende il ciano di default. Il cassetto ottico era nato cosi': l'unico passivo ciano
// fra patch panel, pannello vuoto e passacavo (che sono grigi).
// La relazione e' LETTA dai due file — il gruppo «Rack · Passivi» di `netmapper.html` (`data-palette-group="rack_passive"`)
// e la regola grigia del foglio — e non elencata qui: un passivo aggiunto domani al gruppo senza il grigio fa cadere il test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'netmapper.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles/10-modern.css'), 'utf8');

/** I tipi del gruppo «Rack · Passivi»: i `data-type` delle voci fra l'apertura della sezione e la sua chiusura. */
function tipiPassiviDaRack() {
  const m = /<section class="palette-group" data-palette-group="rack_passive">([\s\S]*?)<\/section>/.exec(html);
  assert.ok(m, 'il gruppo «Rack · Passivi» c\'e\' in netmapper.html');
  return [...m[1].matchAll(/class="equip-item"[^>]*data-type="([a-z0-9_-]+)"/g)].map((x) => x[1]);
}

/** La regola della libreria che dà il grigio: i `data-type` nei selettori della dichiarazione `color:#8b949e`. */
function tipiGrigi() {
  const m = /((?:\.equip-item\[data-type="[a-z0-9_-]+"\] i,?\s*)+)\{\s*color:\s*#8b949e;/.exec(css);
  assert.ok(m, 'la regola grigia della libreria c\'e\' in 10-modern.css');
  return [...m[1].matchAll(/data-type="([a-z0-9_-]+)"/g)].map((x) => x[1]);
}

test('il gruppo «Rack · Passivi» non e\' vuoto (il test non e\' vacuo)', () => {
  assert.ok(tipiPassiviDaRack().length >= 4, 'patch panel, cassetto, pannello vuoto, passacavo');
});

test('ogni voce del gruppo «Rack · Passivi» ha l\'icona grigia (nessun passivo prende il ciano di default)', () => {
  const grigi = new Set(tipiGrigi());
  const senza = tipiPassiviDaRack().filter((t) => !grigi.has(t));
  assert.deepEqual(senza, [], `passivi da rack senza il grigio in libreria: ${senza.join(', ')}`);
});

test('nessun passivo da rack e\' anche in un\'altra tinta (una regola sola per tipo)', () => {
  const passivi = new Set(tipiPassiviDaRack());
  const altre = [...css.matchAll(/((?:\.equip-item\[data-type="[a-z0-9_-]+"\] i,?\s*)+)\{\s*color:\s*(#[0-9a-fA-F]{6});/g)]
    .filter((m) => m[2].toLowerCase() !== '#8b949e')
    .flatMap((m) => [...m[1].matchAll(/data-type="([a-z0-9_-]+)"/g)].map((x) => x[1]));
  assert.deepEqual(altre.filter((t) => passivi.has(t)), []);
});
