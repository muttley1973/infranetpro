// Test di lib/dcim-site-proposal.js — dopo l'import, questo progetto è una sede?
// PURO: nessun server, nessun DOM. La decisione di cosa proporre è una funzione,
// e si prova come tale.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { proposeSite, applyProposal } = require('../lib/dcim-site-proposal.js');

const ORG = () => ({
  id: 'org1', name: 'Aloys',
  sites: [
    { id: 'site_a', name: 'Caci', role: 'hub', projectRef: '10', subnets: [] },
    { id: 'site_b', name: 'Aloys', role: 'spoke', projectRef: '8', subnets: [] },
  ],
  uplinks: [], links: [],
});

test('sito nuovo → si propone di crearlo, col nome che dice NetBox', () => {
  const p = proposeSite(ORG(), [{ id: '30', name: 'Trento Filiale' }], 23);
  assert.equal(p.kind, 'create');
  assert.equal(p.siteName, 'Trento Filiale');
});

test('progetto GIÀ iscritto → non si ripropone nulla', () => {
  // ⚠️ `projectRef` è testo nel modello e numero nella lista progetti: il
  // confronto normalizza, altrimenti '10' === 10 è falso e si proporrebbe di
  // iscrivere una sede che c'è già — creandone una seconda uguale.
  const p = proposeSite(ORG(), [{ id: '26', name: 'Caci' }], 10);
  assert.equal(p.kind, 'already');
  assert.equal(p.siteName, 'Caci');
  const q = proposeSite(ORG(), [{ id: '26', name: 'Caci' }], '10');
  assert.equal(q.kind, 'already', 'stringa o numero, la risposta non cambia');
});

test('omonima LIBERA → si collega quella, non se ne crea una seconda', () => {
  const org = ORG();
  org.sites.push({ id: 'site_c', name: 'Spresiano', role: 'spoke', projectRef: null, subnets: [] });
  const p = proposeSite(org, [{ id: '31', name: 'Spresiano' }], 24);
  assert.equal(p.kind, 'link');
  assert.equal(p.existing.id, 'site_c');

  const nuova = applyProposal(org, p, 24, () => 'MAI');
  assert.equal(nuova.sites.length, 3, 'nessuna sede in più');
  assert.equal(nuova.sites.find(s => s.name === 'Spresiano').projectRef, '24');
});

test('omonima che punta ad ALTRO progetto → conflitto, non si sovrascrive', () => {
  // È il legame dichiarato da qualcuno: riscriverlo cancellerebbe il suo lavoro.
  const p = proposeSite(ORG(), [{ id: '99', name: 'Caci' }], 24);
  assert.equal(p.kind, 'conflict');
  assert.equal(p.existing.projectRef, '10');
  // E applicare un conflitto non deve fare NIENTE.
  const nuova = applyProposal(ORG(), p, 24, () => 'x');
  assert.deepEqual(nuova.sites.map(s => s.projectRef), ['10', '8']);
});

test('progetto nato da PIÙ siti → non si propone, si dice', () => {
  // Il modello vuole un sito = un progetto: due sedi sullo stesso progetto
  // sarebbero una scrittura falsa, sceglierne una sola sarebbe peggio.
  const p = proposeSite(ORG(), [{ id: '29', name: 'Verona HQ' }, { id: '30', name: 'Trento Filiale' }], 23);
  assert.equal(p.kind, 'multi');
  assert.deepEqual(p.sites, ['Verona HQ', 'Trento Filiale']);
  assert.deepEqual(applyProposal(ORG(), p, 23, () => 'x').sites.length, 2, 'e non si scrive niente');
});

test('nessuna origine → nessuna proposta (un progetto vecchio non la registrava)', () => {
  assert.equal(proposeSite(ORG(), [], 24).kind, 'none');
  assert.equal(proposeSite(ORG(), null, 24).kind, 'none');
  assert.equal(proposeSite(ORG(), [{ id: '1', name: '  ' }], 24).kind, 'none', 'un nome vuoto non è un nome');
});

test('organizzazione assente o vuota → si propone lo stesso di creare', () => {
  // È il caso della PRIMA sede: chi importa per primo non ha ancora un modello
  // multi-sede, ed è proprio lui che ne trae di più.
  for (const org of [null, {}, { sites: [] }]) {
    const p = proposeSite(org, [{ id: '30', name: 'Trento Filiale' }], 23);
    assert.equal(p.kind, 'create', 'org ' + JSON.stringify(org));
    const nuova = applyProposal(org, p, 23, () => 'site_new');
    assert.equal(nuova.sites.length, 1);
    assert.deepEqual(nuova.sites[0], {
      id: 'site_new', name: 'Trento Filiale', role: 'standalone',
      projectRef: '23', address: null, subnets: [],
    });
  }
});

test('applyProposal NON muta l\'organizzazione ricevuta', () => {
  // Se il salvataggio fallisce, chi l'ha in mano deve poterla ancora leggere
  // com'era: una copia modificata a metà è peggio di un errore.
  const org = ORG();
  const prima = JSON.stringify(org);
  applyProposal(org, proposeSite(org, [{ id: '30', name: 'Trento' }], 23), 23, () => 'site_x');
  assert.equal(JSON.stringify(org), prima);
});

test('il resto dell\'organizzazione sopravvive alla proposta', () => {
  // Il PUT sostituisce l'intera organizzazione: se uplink o collegamenti si
  // perdessero per strada, iscrivere una sede cancellerebbe le WAN delle altre.
  const org = ORG();
  org.uplinks = [{ id: 'wan1', siteId: 'site_a', provider: 'TIM' }];
  org.links = [{ id: 'l1', kind: 'vpls', aSiteId: 'site_a', bSiteId: 'site_b' }];
  const nuova = applyProposal(org, proposeSite(org, [{ id: '30', name: 'Trento' }], 23), 23, () => 'site_x');
  assert.equal(nuova.name, 'Aloys');
  assert.deepEqual(nuova.uplinks, org.uplinks);
  assert.deepEqual(nuova.links, org.links);
  assert.equal(nuova.sites.length, 3);
});
