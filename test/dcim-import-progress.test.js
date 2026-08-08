'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INTEGRATIONS = fs.readFileSync(path.join(ROOT, 'src', 'app-integrations.js'), 'utf8');
const STYLES = fs.readFileSync(path.join(ROOT, 'styles', '07-modals.css'), 'utf8');
const I18N = fs.readFileSync(path.join(ROOT, 'lib', 'i18n.js'), 'utf8');

test('il commit DCIM espone uno stato di avanzamento e impedisce richieste duplicate', () => {
  assert.match(INTEGRATIONS, /if \(_wiz\.commit\.state === 'running'\) return;/);
  assert.match(INTEGRATIONS, /_renderCommitProgress\(\)/);
  assert.match(INTEGRATIONS, /_wiz\.commit\.state = 'done'/);
  assert.match(INTEGRATIONS, /_wiz\.commit\.state = 'error'/);
});

test('il risultato del commit DCIM permette di aprire il progetto creato', () => {
  assert.match(INTEGRATIONS, /'dcim-open-created':/);
  assert.match(INTEGRATIONS, /switchProject\(id\); closeDcimSync\(\)/);
  assert.match(INTEGRATIONS, /class="dcim-result-grid"/);
});

test('il visualizzatore DCIM ha stile e traduzioni in entrambe le lingue', () => {
  assert.match(STYLES, /\.dcim-import-progress/);
  for (const key of ['integrations.commitTitle', 'integrations.commitStageRead', 'integrations.commitDone', 'integrations.openProject']) {
    assert.equal((I18N.match(new RegExp(`'${key.replace('.', '\\.')}'`, 'g')) || []).length, 2, `${key} deve esistere in italiano e inglese`);
  }
});
