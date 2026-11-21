// ============================================================
// CABLE-CATEGORY — le categorie di un cavo, in UN posto (UMD-lite, browser + Node · puro · lingua-indipendente)
// ============================================================
// Il pannello Cavo offre quindici categorie (`CABLE_CATEGORIES`: Cat3…Cat8 per il rame, OS1/OS2 e OM1…OM5 per la fibra:
// tutti i gradi che NetBox conosce) e il validatore ragiona su quelle. Ma lo STESSO campo (`cableCategory`) lo scrive
// anche chi importa da un DCIM, e NetBox le chiama a modo suo: `cat6a`, `mmf-om4`, `smf-os2`, `smf`… Prima ognuno
// confrontava stringhe per conto suo: l'import scriveva `cat6` e `fiber-sm`, il validatore cercava `Cat6` e `OS2`, e le
// regole non scattavano sui cavi importati. Qui stanno le tre domande, con la risposta sola:
//   · `canonicalCableCategory(x)`  — quale delle quindici e' (tollera maiuscole e separatori: `cat6a` → `Cat6A`), o '';
//   · `cableCategoryKind(x)`       — 'copper' | 'fiber' | '' (anche per i valori che il pannello non offre, come il
//                                    `fiber-sm` scritto da un import di una versione precedente): serve a dire
//                                    «questo NON e' fibra» senza conoscere il grado;
//   · `cableCategoryFamily(x)`     — 'sm' (monomodale) | 'mm' (multimodale) | '' per la fibra.
// Il GRADO (OM3 contro OM4) si conosce solo se la categoria e' una delle quindici: dove non c'e' non si inventa. E per
// una categoria nuova le regole di velocita' e di portata (lib/cable-validate.js) tacciono finche' non c'e' una cifra
// di norma da metterci: l'elenco dice COSA si puo' dichiarare, non quanto regge.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Le categorie del pannello Cavo, nell'ordine della tendina. I valori sono quelli che si SALVANO. */
  const CABLE_CATEGORIES = Object.freeze(['Cat3', 'Cat5', 'Cat5e', 'Cat6', 'Cat6A', 'Cat7', 'Cat7A', 'Cat8',
    'OS1', 'OS2', 'OM1', 'OM2', 'OM3', 'OM4', 'OM5']);

  // Chiave di confronto: minuscole, solo lettere e cifre. `Cat6A`, `cat6a`, `CAT-6A` → `cat6a`.
  const _key = (x) => String(x == null ? '' : x).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const _BY_KEY = Object.freeze(Object.fromEntries(CABLE_CATEGORIES.map((c) => [_key(c), c])));

  /** Quale delle quindici categorie e' `x`, scritta nel modo in cui il pannello la salva; '' se non e' una di quelle. */
  function canonicalCableCategory(x) {
    const k = _key(x);
    return Object.prototype.hasOwnProperty.call(_BY_KEY, k) ? _BY_KEY[k] : '';
  }

  /** 'copper' per ogni `Cat<n>`, 'fiber' per ogni `OS<n>`/`OM<n>` e per `fiber-sm`/`fiber-mm` (come li ha scritti
   *  l'import di una versione precedente), '' per il resto (`dac`, `aoc`, testo libero). */
  function cableCategoryKind(x) {
    const k = _key(x);
    if (/^cat\d/.test(k)) return 'copper';
    if (/^(os|om)\d/.test(k) || k === 'fibersm' || k === 'fibermm') return 'fiber';
    return '';
  }

  /** La famiglia ottica: 'sm' (OS1/OS2, `fiber-sm`) o 'mm' (OM1…OM5, `fiber-mm`), '' se non e' fibra. */
  function cableCategoryFamily(x) {
    const k = _key(x);
    if (/^os\d/.test(k) || k === 'fibersm') return 'sm';
    if (/^om\d/.test(k) || k === 'fibermm') return 'mm';
    return '';
  }

  return { CABLE_CATEGORIES, canonicalCableCategory, cableCategoryKind, cableCategoryFamily };
});
