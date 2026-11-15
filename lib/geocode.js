'use strict';
// ============================================================
// GEOCODIFICA — la parte PURA: la domanda ripulita, la risposta creduta il giusto
// ============================================================
// «Trova» trasforma l'indirizzo scritto di una sede in un punto PROPOSTO. Qui non
// c'è rete e non c'è stato: c'è solo cosa si manda (la query, ripulita) e cosa si
// crede di ciò che torna (candidati con numeri veri). La rete sta in
// `server/geocoder.js`.
//
//  ① **Si propone, non si scrive.** Questo modulo non conosce nessuna sede e non
//     tocca nessun documento: restituisce candidati. A mettere il punto sulla sede
//     è l'utente, con un clic (paletto ②: nessuna invenzione).
//  ② **Ciò che arriva da fuori non si crede.** Un servizio può rispondere con
//     coordinate fuori dal globo, con stringhe al posto dei numeri, con un oggetto
//     d'errore al posto dell'elenco: ognuna di queste cade qui, e le coordinate
//     passano dalla STESSA regola del modello (`parseCoordinate`), non da una copia.
//  ③ **La forma attesa è quella di Nominatim** (`format=jsonv2`: un elenco di
//     `{lat, lon, display_name}`, con `lat`/`lon` come TESTO). È la forma del
//     servizio pubblico di OpenStreetMap e di ogni Nominatim in casa: il servizio
//     è configurabile, la lingua che parla no.
//
// ⚠️ `.js` e non `.ts`: `engines >=16` e la CI su 18/20, dove un `.ts` è SyntaxError.

const IS = require('./inter-site.js');

/** I nomi con cui una ricerca può non riuscire — il vocabolario che la rotta, il
 *  pannello e le sue parole condividono. Uno solo: un guasto aggiunto di qua e
 *  non di là arriverebbe a schermo come «ricerca non riuscita» senza dire perché.
 *  @type {string[]} */
const GEOCODE_ERRORS = ['disabled', 'bad-query', 'too-fast', 'unreachable', 'upstream', 'upstream-busy', 'bad-response'];

/** Una query più lunga di così non è un indirizzo: è un testo incollato per sbaglio. */
const GEOCODE_MAX_QUERY = 200;
/** Quanti candidati si offrono: oltre cinque si sta scegliendo, non confermando. */
const GEOCODE_MAX_RESULTS = 5;
/** Un'etichetta di candidato si legge su una riga. */
const GEOCODE_MAX_LABEL = 160;

/** Toglie i caratteri di controllo (NUL compreso) e comprime gli spazi.
 *  @param {string} s @returns {string} */
function _plain(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * La query che si può mandare, o `null`. Meno di tre caratteri non è un indirizzo
 * (e a un servizio ospite non si chiede «ab»); più di `GEOCODE_MAX_QUERY` nemmeno.
 * @param {unknown} v @returns {string|null}
 */
function cleanGeocodeQuery(v) {
  if (typeof v !== 'string') return null;
  const s = _plain(v);
  if (s.length < 3 || s.length > GEOCODE_MAX_QUERY) return null;
  return s;
}

/**
 * I candidati di una risposta Nominatim, o `[]`.
 * @param {unknown} json @returns {{lat:number, lng:number, label:string}[]}
 */
function parseGeocodeResults(json) {
  if (!Array.isArray(json)) return [];
  const out = [];
  for (const r of json) {
    if (out.length >= GEOCODE_MAX_RESULTS) break;
    if (!r || typeof r !== 'object') continue;
    const o = /** @type {Record<string,unknown>} */ (r);
    const lat = IS.parseCoordinate(o.lat, 'lat');
    const lng = IS.parseCoordinate(o.lon, 'lng');
    if (lat === null || lng === null) continue;
    const dichiarata = typeof o.display_name === 'string' ? _plain(o.display_name) : '';
    // Un candidato senza nome si legge dalle sue coordinate: sparire farebbe credere
    // che il servizio non abbia trovato niente, e invece ha trovato un punto muto.
    const label = (dichiarata || (lat + ', ' + lng)).slice(0, GEOCODE_MAX_LABEL);
    out.push({ lat, lng, label });
  }
  return out;
}

module.exports = {
  GEOCODE_ERRORS, GEOCODE_MAX_QUERY, GEOCODE_MAX_RESULTS, GEOCODE_MAX_LABEL,
  cleanGeocodeQuery, parseGeocodeResults,
};
