'use strict';
// ============================================================
// Il vendor di un MAC esce dal REGISTRO, non da tabelle scritte a mano.
//
// Audit V6: c'erano DUE tabelle OUI cablate nel codice — una in server/netscan.js
// e il suo gemello client in src/app-discovery-classify.js — con gli stessi 35
// prefissi, che erano l'inventario del banco di prova. Peggio: `row.vendor` è il
// primo anello letto da engine/fusion-scorer.js, quindi quando la tabella
// sbagliava vinceva su tutto il resto. E sbagliava: 18:60:24 vi risultava
// «Hewlett Packard», mentre lo IEEE lo assegna a Canon.
//
// Questi test tengono chiusa la porta in due modi: le tabelle non devono tornare
// nel sorgente, e i prefissi che servivano davvero devono restare risolvibili dal
// registro (i quattro Cisco che allo snapshot IEEE mancano vivono ora in
// plugins/oui/cisco.js, dove `npm run update-oui` non li cancella).
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { OuiEngine } = require('../engine');

const ROOT = path.join(__dirname, '..');
const engine = new OuiEngine({ pluginDir: path.join(ROOT, 'plugins', 'oui'), watch: false, signatureCheckIntervalMs: -1 });

// I prefissi che la vecchia tabella copriva: nessuno deve regredire a «ignoto».
const EX_TABELLA = [
  'D4:1A:D1', '08:26:97', 'BC:CF:4F',                       // Zyxel
  '50:68:12', '50:F8:B7', '50:7A:19', '50:9D:DD',            // Cisco (nel plugin, non nello snapshot IEEE)
  '08:00:09', 'F4:39:09', '18:60:24',
  '00:0C:C1', '00:11:32', 'EC:71:DB', '00:0C:29', '00:50:56',
  '00:D0:4B', '00:1C:42', 'F4:F5:E8', 'FC:F1:52', '00:04:4B',
  'F0:03:8C', '40:9F:38', '7C:D5:66', '60:F6:77', '08:00:27',
  'F4:BF:80', '4C:BC:E9', '88:46:04', '4C:E0:DB', 'F4:60:E2',
  'A4:50:46', '58:FD:B1',
];

test('il registro risolve TUTTI i prefissi che la tabella a mano copriva', () => {
  const muti = EX_TABELLA.filter(p => !engine.getVendor(p + ':00:00:01'));
  assert.deepEqual(muti, [], 'prefissi non piu\' risolvibili: ' + muti.join(', '));
});

test('e li risolve MEGLIO: 18:60:24 e\' Canon, non Hewlett Packard', () => {
  // La riga che dimostra perche' una tabella a mano non e' solo ridondante.
  assert.match(engine.getVendor('18:60:24:00:00:01'), /canon/i);
  assert.match(engine.getVendor('50:68:12:00:00:01'), /cisco/i);
  assert.match(engine.getVendor('00:11:32:00:00:01'), /synology/i);
});

test('nessuna tabella OUI scritta a mano e\' tornata nel sorgente', () => {
  for (const rel of ['server/netscan.js', 'src/app-discovery-classify.js', 'server/routes/discovery.js']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // Una mappa OUI a mano si riconosce da piu' prefissi MAC come CHIAVI di oggetto.
    const chiaviOui = src.match(/'[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}'\s*:/g) || [];
    assert.ok(chiaviOui.length < 3,
      rel + ': sembra esserci di nuovo una tabella OUI cablata (' + chiaviOui.length + ' voci). '
      + 'I prefissi che il registro non conosce vanno nel plugin del loro vendore (plugins/oui/).');
  }
});
