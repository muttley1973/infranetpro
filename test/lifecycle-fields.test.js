'use strict';
// ============================================================
// GARANZIA E FINE VITA: DUE DATE CHE NESSUNO MISURA
// ============================================================
// La lente ④ «Ripristinabilità» ha una riga «Ciclo di vita», ma il dato che la
// alimenta esiste solo se l'utente ha un posto dove scriverlo. Qui si presidia
// la METÀ UMANA della feature — il campo nel pannello Proprietà — perché il
// motore, coperto in test/overview.test.js, senza quel campo resterebbe muto per
// sempre e nessun test se ne accorgerebbe.
//
// Paletto ①/②: sono campi DICHIARATI e basta. Nessun apparato risponde via SNMP
// «la garanzia scade il…», quindi non esiste un placeholder «misurato» come per
// marca/modello/seriale: il campo vuoto significa «non lo so», non «illimitata».
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const props = fs.readFileSync(path.join(SRC, 'app-properties.js'), 'utf8');

test('il pannello Proprietà offre Garanzia e Fine vita come date dichiarabili', () => {
  // Il blocco inventario è UNO SOLO, condiviso da tutti i pannelli device: basta
  // presidiare lui perché la coppia compaia ovunque (switch, router, NAS, UPS…).
  const inv = props.slice(props.indexOf('export function _buildInventoryFieldsHtml'));
  assert.ok(/_buildInventoryFieldsHtml/.test(props), 'il builder condiviso esiste ancora');
  for (const [campo, chiave] of [['warrantyUntil', 'field.warranty'], ['eolDate', 'field.eol']]) {
    // Scrittura per DELEGATION (data-change), non con un onchange inline: il
    // cricchetto dell'ASSE B non deve crescere per due campi nuovi.
    assert.ok(inv.includes(`data-change="node-field" data-field="${campo}"`), `manca la scrittura delegata del campo ${campo}`);
    assert.ok(!new RegExp(`onchange="updateN\\('${campo}'`).test(inv), `${campo}: handler inline, usa la delegation`);
    assert.ok(inv.includes(`t('${chiave}')`), `manca l'etichetta i18n ${chiave}`);
    assert.ok(inv.includes(`t('${chiave}Tip')`), `manca il tip che spiega ${campo}`);
  }
  // Date vere: input nativo, valore ISO — confrontabile senza parsing di lingua.
  const dateInputs = (inv.match(/<input type="date"/g) || []).length;
  assert.equal(dateInputs, 2, 'entrambi i campi sono <input type="date">');
});

test('sono campi SOLO dichiarati: nessun placeholder «misurato» sotto', () => {
  // Marca/modello/seriale/firmware mostrano in placeholder ciò che ENTITY-MIB ha
  // letto. Garanzia e fine vita no — non esiste una misura da suggerire, e un
  // placeholder inventato sarebbe una data che l'utente non ha mai scritto.
  const inv = props.slice(props.indexOf('export function _buildInventoryFieldsHtml'));
  const riga = inv.slice(inv.indexOf('field.warranty'), inv.indexOf('field.eolTip') + 40);
  assert.ok(!/placeholder=/.test(riga), 'nessun placeholder sulle due date');
  assert.ok(!/inventory\.(warranty|eol)/.test(inv), 'nessun gemello misurato da cui pescare');
});

test('non sono campi spec di TIPO: vivono sul nodo, come il seriale', () => {
  // I campi in NODE_SPEC_FIELDS finiscono in `node.spec[key]` e valgono per un
  // tipo solo. Garanzia e fine vita valgono per QUALUNQUE asset, quindi stanno
  // sul nodo accanto a serialNumber — updateN li scrive lì senza registrarli.
  const types = fs.readFileSync(path.join(SRC, 'app-types.js'), 'utf8');
  const set = types.slice(types.indexOf('const NODE_SPEC_FIELDS'), types.indexOf('function _isNodeSpecField'));
  assert.ok(!/warrantyUntil|eolDate/.test(set), 'restano fuori dal catalogo spec (altrimenti finirebbero in node.spec)');
});
