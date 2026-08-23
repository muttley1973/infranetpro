'use strict';
// ============================================================================
// Lo stato operativo è una DICHIARAZIONE, e si vede che è la tua
// ============================================================================
// `node.status` (planned/staged/inventory/active/failed/decommissioning/offline)
// decide come si legge il SILENZIO di un apparato: un pianificato che non
// risponde non è un guasto. Il pannello scrive anche `statusManual` — il segno
// «questo l'ho dichiarato io» — attraverso `node-field-manual`.
//
// ⚠️ La differenza dagli altri quattro pin della famiglia manual-first
// (`nameManual`, `hostnameManual`, `ipManual`, `portsManual`) è CHI potrebbe
// riscrivere il campo. Quelli difendono una dichiarazione da una MISURA: la
// rete dice altro, e il pin decide chi vince. Lo stato non lo misura nessuno —
// nessun apparato annuncia via SNMP di essere «in dismissione» — quindi qui il
// pin difende la tua dichiarazione da un'ALTRA dichiarazione, quella del DCIM.
// È un conflitto fra due documentazioni, e per questo il testo del lucchetto
// non può essere quello di hostname/IP («segue la rete, lo aggiorna il Sync»):
// sarebbe falso, e sullo schermo.
//
// ⚠️ Oggi il flag REGISTRA e non IMPEDISCE: l'unico altro scrittore di
// `node.status` è l'import DCIM, che costruisce un progetto NUOVO dove non c'è
// nessuna scelta da sovrascrivere. Il secondo test è la porta in faccia per
// chi aggiungerà la metà che RISCRIVE: un nuovo scrittore o legge il flag, o
// si dichiara qui sotto con la sua ragione.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

// ── ① Il pannello ───────────────────────────────────────────────────────────

test('lo stato dichiarato porta il lucchetto, lo riflette e lo commuta', () => {
  const APP = loadApp(ROOT);
  const out = run(APP.ctx, `(() => {
    state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
    _propsExplicit = true;                       // senza questo il pannello resta vuoto
    state.nodes.push({ id:'sw', type:'switch', name:'CORE', rackId:state.currentRack, rackU:1, sizeU:1, ports:8 });
    if(typeof _invalidateIdx==='function') _invalidateIdx();

    const panel = () => { selType='node'; selId='sw'; renderProps(); return document.getElementById('props-panel').innerHTML || ''; };
    // Il bottone del lucchetto DELLO STATO, per intero: serve a leggerne il testo.
    const bottone = h => {
      const i = h.indexOf('data-act="node-lock" data-field="status"');
      return i < 0 ? '' : h.slice(h.lastIndexOf('<button', i), i + 60);
    };
    const chiuso = h => /aria-pressed="true"/.test(bottone(h));

    const vuoto = panel();
    // Esattamente cio' che fa il gestore delegato \`node-field-manual\`.
    updateN('status','offline'); updateN('statusManual', true);
    const dichiarato = panel();
    toggleNodeLock('status');                    // il clic sul lucchetto
    const sganciato = panel();

    return {
      selectManuale: /data-change="node-field-manual" data-field="status"/.test(vuoto),
      lockPresente:  bottone(vuoto) !== '',
      apertoDaVuoto: !chiuso(vuoto),
      chiusoDaDichiarato: chiuso(dichiarato),
      flagDopoToggle: !!nodeById('sw').statusManual,
      apertoDopoToggle: !chiuso(sganciato),
      statoIntatto: nodeById('sw').status,
      testoLock: bottone(dichiarato).replace(/^[\\s\\S]*?data-tip="/, '').replace(/".*$/, ''),
    };
  })()`);

  assert.equal(out.selectManuale, true, 'lo stato si scrive con node-field-manual (che pinna il flag)');
  assert.equal(out.lockPresente, true, 'il lucchetto dello stato è a schermo, come per hostname e IP');
  assert.equal(out.apertoDaVuoto, true, 'stato non dichiarato = lucchetto aperto');
  assert.equal(out.chiusoDaDichiarato, true, 'stato dichiarato = lucchetto chiuso: il pin si VEDE');
  assert.equal(out.flagDopoToggle, false, 'il clic sul lucchetto sgancia il pin');
  assert.equal(out.apertoDopoToggle, true, 'e il pannello lo mostra sganciato');
  assert.equal(out.statoIntatto, 'offline', 'sganciare il pin NON cancella lo stato dichiarato');

  // ⭐ L'assertion che conta: il lucchetto dello stato non può raccontare la
  // storia della rete. Nessun apparato misura il proprio ciclo di vita, quindi
  // «segue la rete, lo aggiorna il Sync» sarebbe una bugia stampata a video.
  // Le parole cambiano con la lingua; «DCIM» e «Sync» no.
  assert.match(out.testoLock, /DCIM/, 'il lucchetto dello stato parla del DCIM, che è chi altro lo dichiara');
  assert.doesNotMatch(out.testoLock, /Sync/, 'e NON della rete: lo stato non lo misura nessuno');
});

// ── ② La porta in faccia per il prossimo scrittore ──────────────────────────

// Chi può scrivere `node.status` senza consultare `statusManual`, e PERCHÉ.
// Un'eccezione senza ragione è un permesso a tempo indeterminato: qui la
// ragione è obbligatoria, e il test la rilegge (deve essere ancora vera).
const SCRITTORI_AMMESSI = {
  'lib/dcim-map.js': 'l\'import costruisce un progetto NUOVO: non esiste una scelta dell\'utente da sovrascrivere',
};

// Assegnazioni a `<qualcosa>.status` su un ricevitore che somiglia a un NODO.
// Stretto di proposito: `state.ports[pid].status`, `prefix.status`, `row.status`
// e `proof.status` sono altri campi con lo stesso nome, e un guard rumoroso
// verrebbe messo a tacere invece che ascoltato.
const SCRIVE_STATUS = /\b(?:node|n|dev|device|existing|foundExisting)\s*\.\s*status\s*=(?!=)/;

function scansiona() {
  const trovati = [];
  for (const dir of ['src', 'lib']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (!f.endsWith('.js')) continue;
      const rel = dir + '/' + f;
      const src = fs.readFileSync(path.join(ROOT, dir, f), 'utf8');
      if (!SCRIVE_STATUS.test(src)) continue;
      // «Consultare» = una riga di CODICE che nomina il flag. Un commento che lo
      // cita non protegge niente — è esattamente l'errore che questo file chiude.
      const legge = src.split(/\r?\n/).some(l =>
        l.includes('statusManual') && !/^\s*(?:\/\/|\*|\/\*)/.test(l));
      trovati.push({ rel, legge });
    }
  }
  return trovati;
}

test('chi scrive node.status legge statusManual, o si dichiara qui con la sua ragione', () => {
  const abusivi = scansiona().filter(x => !x.legge && !SCRITTORI_AMMESSI[x.rel]).map(x => x.rel);
  assert.deepStrictEqual(abusivi, [],
    'questi file scrivono lo stato di un nodo senza guardare `statusManual`: ' +
    abusivi.join(', ') + '. O leggono il flag (manual-first: la dichiarazione ' +
    'dell\'utente vince), o si aggiungono a SCRITTORI_AMMESSI con la ragione per cui ' +
    'in quel punto non c\'è una scelta da proteggere.');
});

test('le eccezioni non scadono in silenzio: chi è ammesso scrive ancora node.status', () => {
  const chiScrive = new Set(scansiona().map(x => x.rel));
  for (const rel of Object.keys(SCRITTORI_AMMESSI)) {
    assert.ok(chiScrive.has(rel),
      `${rel} è fra gli SCRITTORI_AMMESSI ma non scrive più node.status: ` +
      'un permesso scaduto va tolto, altrimenti copre il prossimo che arriva.');
    assert.ok(SCRITTORI_AMMESSI[rel].length > 20, `${rel}: l'eccezione senza una ragione scritta non vale`);
  }
});
