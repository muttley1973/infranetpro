// ============================================================
// POWER-GROUPS — i GRUPPI di prese di un UPS (o di una barra), logica PURA.
//
// Perché esistono. Una barra PDU risponde a «chi è alimentato». Un UPS deve
// rispondere a una domanda diversa, ed è la sola per cui lo si compra: «chi
// resta acceso quando manca la corrente, e chi posso sacrificare per durare di
// più». Quella risposta non sta sulla singola presa: sta sul GRUPPO.
//
// Il modello, misurato sui vendor (non inventato). Marchi diversi usano parole
// diverse — APC «Main Outlet Group» + «Switched Outlet Group», Eaton «load
// segment» con «Primary group», Vertiv prese «programmable» e «non
// programmable», CyberPower e Ubiquiti «Battery/Surge» contro «Surge only»,
// Bastion e SNR «Segment1_3» — ma dicono DUE cose sole:
//
//   ① commutazione: il gruppo si può spegnere da solo (`switched`) oppure vive
//      quanto l'uscita dell'UPS (`always`). È ciò che permette riavvio remoto,
//      sequenze di accensione e sacrificio del non critico.
//   ② soccorso: la presa è tenuta dalla batteria (`battery`) o solo filtrata
//      (`surge`). È ciò che decide se sopravvive al buio, e basta da sola a
//      spiegare metà dei guasti «ma era attaccato all'UPS!».
//
// Due assi, e ci stanno dentro tutti. Chi ne aggiunge un terzo lo aggiunge QUI,
// non in un pannello.
//
// ⚠️ Il gruppo è un dato DICHIARATO, non misurato. RFC 1628 (UPS-MIB) non
// contempla i gruppi di prese: ognuno ce li mette nel proprio MIB privato. Chi
// un domani volesse misurarlo scriverà un driver per marchio — non si spaccia
// per misura ciò che è la parola dell'utente.
//
// Condivisa browser + test (UMD-lite). Niente DOM, niente globali: solo dati.
// NON muta il nodo: chi scrive sta nella UI, qui si legge e si normalizza.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Otto è il tetto dei gruppi. Nessun UPS a catalogo ne dichiara più di tre
  // (APC ne ammette al massimo tre commutati più il principale); otto lascia
  // aria alle barre a banchi senza diventare un elenco da scorrere.
  const MAX_POWER_GROUPS = 8;
  const POWER_GROUP_SWITCHING = ['switched', 'always'];
  const POWER_GROUP_BACKUP = ['battery', 'surge'];

  function _str(v) { return String(v == null ? '' : v).trim(); }

  // Id del gruppo: chiave stabile e breve, perché ci puntano le prese. Le prese
  // referenziano l'ID, mai il nome — così rinominare «Gruppo 1» in «Critici»
  // non stacca le prese dal loro gruppo.
  function normalizeGroupId(value) {
    return _str(value).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 12);
  }

  function normalizeSwitching(value, fallback = 'switched') {
    const v = _str(value).toLowerCase();
    if (POWER_GROUP_SWITCHING.includes(v)) return v;
    return POWER_GROUP_SWITCHING.includes(fallback) ? fallback : 'switched';
  }

  function normalizeBackup(value, fallback = 'battery') {
    const v = _str(value).toLowerCase();
    if (POWER_GROUP_BACKUP.includes(v)) return v;
    return POWER_GROUP_BACKUP.includes(fallback) ? fallback : 'battery';
  }

  function _rawGroups(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node.powerGroups)) return node.powerGroups;
    const spec = node.spec;
    if (spec && typeof spec === 'object' && Array.isArray(spec.powerGroups)) return spec.powerGroups;
    return [];
  }

  // I gruppi DICHIARATI del nodo, normalizzati: id valido, senza doppioni, entro
  // il tetto. Un gruppo senza nome tiene il suo id come nome — meglio una
  // etichetta tecnica che una riga vuota.
  function powerGroups(node) {
    const seen = new Set();
    const out = [];
    for (const raw of _rawGroups(node)) {
      if (!raw || typeof raw !== 'object') continue;
      const id = normalizeGroupId(raw.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        name: _str(raw.name) || id,
        switching: normalizeSwitching(raw.switching),
        backup: normalizeBackup(raw.backup),
      });
      if (out.length >= MAX_POWER_GROUPS) break;
    }
    return out;
  }

  // A che gruppo appartiene una presa. `groupOvr` è la parola dell'utente e
  // batte `group`, che è ciò che un domani scriverà il catalogo o l'import
  // leggendo il nome della presa («Group 2 - Output 1»): manual-first, come
  // ovunque. Il campo esiste già ORA perché chi legge non debba cambiare il
  // giorno che il catalogo arriva.
  function outletGroupId(outlet) {
    if (!outlet || typeof outlet !== 'object') return { id: '', manual: false };
    const manual = Object.prototype.hasOwnProperty.call(outlet, 'groupOvr');
    const id = normalizeGroupId(manual ? outlet.groupOvr : outlet.group);
    return { id, manual: manual && id !== '' };
  }

  // Il gruppo di una presa, risolto sul nodo. null se la presa non è assegnata
  // o se punta a un gruppo che non esiste più (cancellato dopo l'assegnazione).
  function groupOfOutlet(node, outlet) {
    const { id } = outletGroupId(outlet);
    if (!id) return null;
    return powerGroups(node).find(g => g.id === id) || null;
  }

  // Primo id libero: g1, g2, … Serve a chi aggiunge un gruppo dal pannello.
  function nextGroupId(node) {
    const used = new Set(powerGroups(node).map(g => g.id));
    for (let i = 1; i <= MAX_POWER_GROUPS; i++) {
      const id = 'g' + i;
      if (!used.has(id)) return id;
    }
    return '';
  }

  // La VISTA che serve al pannello e al render: ogni gruppo con le sue prese,
  // più le prese che nessuno ha assegnato e quelle che puntano a un gruppo
  // sparito. `orphan` non si nasconde: una presa che punta al vuoto è un dato
  // sbagliato, e un elenco che la conta fra le «non assegnate» lo seppellisce.
  function powerGroupView(node, outlets) {
    const groups = powerGroups(node);
    const list = Array.isArray(outlets) ? outlets : [];
    const byId = new Map(groups.map((g, index) => [g.id, Object.assign({}, g, { index, outlets: [] })]));
    const ungrouped = [];
    const orphan = [];
    list.forEach((outlet, i) => {
      const { id } = outletGroupId(outlet);
      if (!id) { ungrouped.push(i); return; }
      const g = byId.get(id);
      if (g) g.outlets.push(i);
      else orphan.push({ index: i, id });
    });
    return { groups: Array.from(byId.values()), ungrouped, orphan };
  }

  // Indice 1..8 del gruppo di una presa, per la fascia di colore nel rack.
  // 0 = nessun gruppo (o gruppo sparito): niente fascia, che è la verità.
  function outletGroupIndex(node, outlet) {
    const { id } = outletGroupId(outlet);
    if (!id) return 0;
    const i = powerGroups(node).findIndex(g => g.id === id);
    return i < 0 ? 0 : i + 1;
  }

  return {
    MAX_POWER_GROUPS, POWER_GROUP_SWITCHING, POWER_GROUP_BACKUP,
    normalizeGroupId, normalizeSwitching, normalizeBackup,
    powerGroups, outletGroupId, groupOfOutlet, nextGroupId, powerGroupView, outletGroupIndex,
  };
});
