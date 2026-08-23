'use strict';
// ============================================================================
// Una porta GUASTA usciva grigia da tutti e tre gli export
// ============================================================================
// `normalizeStatus` esisteva DUE volte, con vocabolari diversi e lo stesso nome:
// quella delle PORTE (`inactive|active|fault`, src/app-util.js) e quella dello
// STATO OPERATIVO di un apparato (`planned|…|offline`, lib/device-status.js).
// Entrambe finivano su `window`, e a vincere era la seconda.
//
// ⚠️ `export.js` è uno script CLASSIC: legge il globale nudo, con semantica di
// porta. Chiamava quindi la funzione sbagliata, e la funzione sbagliata risponde
// `''` a una parola che non conosce. Il colore si prende da una mappa:
//     ({ active:'#39d353', fault:'#f85149', inactive:'#6e7681' })[normalizeStatus(st)] || '#6e7681'
// Con `''` la ricerca fallisce e si finisce sul ripiego GRIGIO. Il verde
// sopravviveva per pura coincidenza («active» esiste in tutt'e due i vocabolari)
// e il grigio pure (il ripiego è lo stesso colore). A morire era **il rosso**:
// una porta dichiarata GUASTA usciva dell'identico grigio di una porta libera —
// nel rack SVG, nel dossier PDF e nell'export draw.io, che ricevono la stessa
// funzione via `helpers`.
//
// ⚠️ Il difetto non era visibile dall'app: a schermo il rosso c'era, perché il
// renderer importa la sua funzione via ESM. Si vedeva solo nel file esportato —
// cioè nel documento che si porta in sala macchine.
//
// La cura è nel NOME: la funzione delle porte si chiama `normalizePortStatus`, e
// su `window` non c'è più niente con cui possa essere confusa.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');
const ROSSO = '#f85149', VERDE = '#39d353', GRIGIO = '#6e7681';

// Uno switch in rack con tre porte dichiarate: guasta, attiva, spenta.
const SCENA = `
  state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
  state.nodes.length = 0; state.links.length = 0; state.ports = {};
  state.nodes.push({ id:'sw', type:'switch', name:'CORE-SW', rackId:state.currentRack,
                     rackU:1, sizeU:1, ports:8 });
  state.ports['sw-1'] = { statusOvr:'fault' };
  state.ports['sw-2'] = { statusOvr:'active' };
  state.ports['sw-3'] = { statusOvr:'inactive' };
  if(typeof _invalidateIdx==='function') _invalidateIdx();
`;

test('il rack esportato dipinge di ROSSO la porta guasta', () => {
  const APP = loadApp(ROOT);
  const out = JSON.parse(run(APP.ctx, `(() => { try {
    ${SCENA}
    const r = _exportInternals._buildRackSVG(state.currentRack, { pdfMode:true });
    const svg = (r && r.svg) || '';
    return JSON.stringify({ ok:true,
      isSvg: svg.startsWith('<svg'),
      rosso: svg.indexOf('${ROSSO}') >= 0,
      verde: svg.indexOf('${VERDE}') >= 0,
      grigio: svg.indexOf('${GRIGIO}') >= 0 });
  } catch(e){ return JSON.stringify({ ok:false, err:String(e&&e.stack||e) }); } })()`));

  assert.ok(out.ok, '_buildRackSVG lancia: ' + out.err);
  assert.ok(out.isSvg, 'il rack esportato è un documento <svg>');
  // ⭐ L'assertion che conta: prima di rinominare, qui c'era grigio.
  assert.equal(out.rosso, true, 'la porta dichiarata GUASTA esce rossa, non del grigio di una porta libera');
  assert.equal(out.verde, true, 'e quella attiva resta verde (questo funzionava, ma per coincidenza)');
  assert.equal(out.grigio, true, 'lo spento resta grigio');
});

test('la funzione delle porte e quella del device non condividono più il nome', () => {
  const APP = loadApp(ROOT);
  const out = run(APP.ctx, `(() => {
    // Sul globale ne resta UNA sola, ed è quella del DEVICE: il suo vocabolario
    // non conosce «fault», e infatti risponde '' — che è onesto, ma è il motivo
    // per cui non poteva essere lei a colorare le porte.
    const dev = (typeof normalizeStatus === 'function') ? normalizeStatus : null;
    const por = (typeof normalizePortStatus === 'function') ? normalizePortStatus : null;
    return {
      duePortiSuWindow: !!por,
      devSuFault: dev ? dev('fault') : null,
      porSuFault: por ? por('fault') : null,
      porSuIgnoto: por ? por('planned') : null,
    };
  })()`);
  assert.equal(out.duePortiSuWindow, true, 'export.js (classic) trova la funzione delle porte col suo nome');
  assert.equal(out.porSuFault, 'fault', 'e quella funzione conosce «fault»');
  assert.equal(out.devSuFault, '', 'mentre quella del device no: era lei a rispondere prima');
  assert.equal(out.porSuIgnoto, 'inactive', 'il ripiego della porta resta quello di sempre');
});
