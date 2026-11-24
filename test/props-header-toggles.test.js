'use strict';
// ============================================================
// INTESTAZIONE DEI PANNELLI PROPRIETA' — gli chevron «espandi / comprimi» ci sono in TUTTI
// ============================================================
// Ogni pannello delle Proprieta' (progetto, apparato, cavo, porta, presa PDU, radio, scheda VM) che ha delle
// fisarmoniche porta nell'intestazione i bottoni «espandi tutto» / «comprimi tutto» (e, dove serve, «ripristina»),
// scritti da UN builder solo: `_propsToggleButtonsHtml` (src/app-properties.js). Erano gia' passati da quattro
// copie della stessa stringa a una; il pannello PORTA, quando ha preso le sue fisarmoniche (VLAN e lettura dal
// vivo), non li aveva ancora: chi ha un pannello con le fisarmoniche e non ha i bottoni ha un'interfaccia che
// si comporta in un modo qui e in un altro li'.
//
// La guardia e' di testo, ed e' CRUDA di proposito: ogni chiamata a `_buildPropsHeader(` in un file che disegna
// fisarmoniche (`props-collapsible`) deve avere `_propsToggleButtonsHtml` nella chiamata o appena prima (la scheda
// VM lo calcola in una costante sopra la chiamata). Il conteggio minimo di chiamate trovate impedisce che la
// guardia diventi cieca se qualcuno rinomina il builder dell'intestazione.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js'));

function headerCalls() {
  const out = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(SRC, f), 'utf8');
    if (!text.includes('props-collapsible')) continue;
    for (const m of text.matchAll(/_buildPropsHeader\(/g)) {
      const before = text.slice(Math.max(0, m.index - 12), m.index);
      if (/function\s+$/.test(before)) continue;   // la definizione, non una chiamata
      const line = text.slice(0, m.index).split('\n').length;
      const around = text.slice(Math.max(0, m.index - 400), m.index + 700);
      out.push({ file: f, line, ok: around.includes('_propsToggleButtonsHtml') });
    }
  }
  return out;
}

test('ogni pannello Proprieta\' con fisarmoniche ha gli chevron «espandi/comprimi» nell\'intestazione', () => {
  const calls = headerCalls();
  const senza = calls.filter(c => !c.ok).map(c => `${c.file}:${c.line}`);
  assert.deepStrictEqual(senza, [], 'intestazioni senza i bottoni espandi/comprimi: ' + senza.join(', '));
});

test('la guardia non e\' cieca: trova le intestazioni di tutti i pannelli (progetto, apparato, cavo, porta, presa PDU, radio, VM)', () => {
  const calls = headerCalls();
  const byFile = {};
  for (const c of calls) byFile[c.file] = (byFile[c.file] || 0) + 1;
  for (const f of ['app-properties-floor.js', 'app-properties-node.js', 'app-properties-link.js', 'app-properties-vm.js', 'app-wifi.js']) {
    assert.ok(byFile[f] >= 1, `nessuna intestazione trovata in ${f}`);
  }
  assert.strictEqual(byFile['app-properties-port.js'], 2, 'il file della porta ha DUE pannelli: porta e presa PDU');
  assert.ok(calls.length >= 7, `solo ${calls.length} intestazioni trovate`);
});

test('i tre bottoni sono scritti in un posto solo: nessun pannello ricopia il markup degli chevron', () => {
  for (const f of files) {
    if (f === 'app-properties.js') continue;
    const text = fs.readFileSync(path.join(SRC, f), 'utf8');
    assert.ok(!/data-act="props-expand-all"/.test(text), `${f} ricopia il bottone «espandi tutto»: usa _propsToggleButtonsHtml`);
    assert.ok(!/data-act="props-collapse-all"/.test(text), `${f} ricopia il bottone «comprimi tutto»: usa _propsToggleButtonsHtml`);
  }
});
