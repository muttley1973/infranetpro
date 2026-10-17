// ============================================================
// ID SAFETY — un identificatore è un nome, non un pezzo di HTML (puro)
// ============================================================
// Gli identificatori del progetto (`rack.id`, `link.id`, `floor.id`, `vm.id`…) li genera
// l'app (`uid()`: lettere, cifre, `_`), ma NON li decide l'app: un file importato, una
// chiamata alle API o un editor possono scrivere qualunque stringa nel campo `id`. E
// l'interfaccia li interpola come valori di attributo (`data-lid="${l.id}"`,
// `<option value="${r.id}">`): un id come  "><img src=x onerror=…>  eseguiva codice nel
// browser di chiunque aprisse il progetto — anche di un viewer, anche dell'admin.
// (Gli id dei NODI no: `_normalizeProjectNodeIds` li rinumera al caricamento.)
//
// Ci sono due difese, e non si escludono:
//   · l'USCITA — ogni punto che interpola un valore lo passa da escapeHTML(); è la difesa
//     vera, ma sta su più di mille interpolazioni scritte a mano (test/html-escaping.test.js
//     ne tiene il conto) e basta una dimenticata;
//   · l'INGRESSO — questo file. Un `id` ha un solo compito, dire «sono io», e per dirlo
//     non gli servono né virgolette né parentesi angolari. Quello che non è un nome valido
//     non entra nel documento: il server rifiuta lo stato (`findUnsafeIds`) e il client,
//     caricando un progetto GIÀ salvato con id strani, li ripara (`repairUnsafeIds`).
//
// ⚠️ La riparazione non è una pulizia a caso: un id è anche un RIFERIMENTO (`node.rackId`,
// `state.currentRack`, gli estremi di un cavo…). Rinominare l'id e lasciare i riferimenti
// scollega il progetto; per questo la rinomina riscrive, in tutto lo stato, ogni valore
// (e ogni chiave) uguale al vecchio id. Uguale, non «che lo contiene»: un id ostile non
// compare per caso dentro un altro valore, e un confronto largo toccherebbe dati di altri.
//
// Puro: nessun DOM, nessun IO. Condiviso browser (import ESM) + server + test.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Lettere, cifre e i separatori che gli id veri usano (`rack_ab12`, `l-3`, `nb:12`, `a.b`,
  // `x@y`, `a+b`, `#1`). Niente spazi, virgolette, `<>`, `&`, backtick, backslash: un nome che
  // non ne ha bisogno non deve poterli portare dentro un attributo.
  const SAFE_ID_RE = /^[A-Za-z0-9_.:@+#-]{1,100}$/;
  const MAX_DEPTH = 12;

  function isSafeId(v) { return typeof v === 'string' && SAFE_ID_RE.test(v); }

  const _isObj = (x) => x != null && typeof x === 'object';
  // Il prefisso della rinomina viene dal nome dell'elenco che contiene l'oggetto.
  const PREFIX = { racks: 'rack', links: 'l', floors: 'floor', rooms: 'room', vms: 'vm', sites: 'site', storeys: 'storey' };

  // Cammina lo stato e chiama `visit(owner, path, parentKey)` per ogni oggetto con un `id` stringa.
  function _walk(node, path, parentKey, visit, depth) {
    if (!_isObj(node) || depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) _walk(node[i], `${path}[${i}]`, parentKey, visit, depth + 1);
      return;
    }
    if (typeof node.id === 'string') visit(node, path, parentKey);
    for (const k of Object.keys(node)) {
      if (k === 'id') continue;
      _walk(node[k], path ? `${path}.${k}` : k, k, visit, depth + 1);
    }
  }

  /**
   * Gli `id` non validi dello stato, con il loro percorso (al più `max`).
   * @returns {Array<{path:string, value:string}>}
   */
  function findUnsafeIds(state, max) {
    const out = [];
    const cap = max > 0 ? max : 20;
    _walk(state, '', '', (owner, path) => {
      if (out.length < cap && !isSafeId(owner.id)) out.push({ path: path ? `${path}.id` : 'id', value: String(owner.id).slice(0, 60) });
    }, 0);
    return out;
  }

  /**
   * Rinomina gli `id` non validi e riscrive i riferimenti. Non tocca `nodes[].id`: li
   * rinumera `_normalizeProjectNodeIds`, che conosce le porte `<nodo>-<n>`.
   * @param {Object} state
   * @param {(prefix:string)=>string} [mk]  generatore di id nuovi (default: contatore)
   * @returns {number} quanti id sono stati rinominati
   */
  function repairUnsafeIds(state, mk) {
    if (!_isObj(state)) return 0;
    const used = new Set();
    const bad = [];
    _walk(state, '', '', (owner, path, parentKey) => {
      const topNode = /^nodes\[\d+\]$/.test(path);
      if (isSafeId(owner.id)) used.add(owner.id);
      else if (!topNode) bad.push({ owner, parentKey });
    }, 0);
    if (!bad.length) return 0;

    let seq = 0;
    const gen = typeof mk === 'function' ? mk : ((p) => `${p}_fix${++seq}`);
    const map = new Map();
    for (const { owner, parentKey } of bad) {
      const old = owner.id;
      if (map.has(old)) { owner.id = map.get(old); continue; }       // lo stesso id vecchio → lo stesso nuovo
      let next;
      do { next = gen(PREFIX[parentKey] || 'id'); } while (used.has(next) || !isSafeId(next));
      used.add(next);
      map.set(old, next);
      owner.id = next;
    }
    _rewrite(state, map, 0);
    return map.size;
  }

  // Riscrive, in tutto lo stato, ogni valore e ogni chiave uguale a un vecchio id.
  function _rewrite(node, map, depth) {
    if (!_isObj(node) || depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const v = node[i];
        if (typeof v === 'string' && map.has(v)) node[i] = map.get(v);
        else _rewrite(v, map, depth + 1);
      }
      return;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string') { if (k !== 'id' && map.has(v)) node[k] = map.get(v); }
      else _rewrite(v, map, depth + 1);
      if (map.has(k)) {                                              // chiave = vecchio id (mappe per id)
        node[map.get(k)] = node[k];
        delete node[k];
      }
    }
  }

  return { SAFE_ID_RE, isSafeId, findUnsafeIds, repairUnsafeIds };
});
