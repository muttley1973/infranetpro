'use strict';
// ============================================================
// LA POSIZIONE DI UNA SEDE, LETTA DAL DCIM — la parte PURA
// ============================================================
// NetBox tiene `latitude` e `longitude` di ogni sito. Qui si decide cosa se ne
// crede, e si dice in tre risposte diverse (un punto, nessuna posizione, una
// posizione storta) più una quarta per il sito che non c'è più. Niente rete e
// niente stato: la rotta (`server/routes/integrations.js`) legge, questo giudica.
//
//  ① **Si propone, non si scrive.** Come «Trova» (lib/geocode.js) e come le linee
//     WAN: il modulo restituisce candidati; il punto lo mette sulla sede una
//     persona, dal pannello, con un clic (paletto ②). Un DCIM è un archivio di
//     DICHIARAZIONI — ma la sede è dell'organizzazione, e se ha già un punto
//     scritto a mano non lo si scavalca in silenzio.
//  ② **Una coordinata è quella del modello.** Ogni numero passa da
//     `parseCoordinate` (lib/inter-site.js): una latitudine sola non diventa
//     «lat, 0», e fuori dal globo cade. Una definizione sola di «coordinata valida».
//  ③ **L'ambito lo dice chi chiede.** Gli id dei siti NetBox sono quelli che il
//     progetto-sede registra (`state.source.dcim.sites`). Un sito che il server
//     torna senza che nessuno l'abbia chiesto NON entra: su `vpn/` NetBox accetta
//     `?site_id=` e lo IGNORA (misurato, 4.6.7), e un filtro ignorato non deve
//     allargare la lettura a tutto l'archivio.
//  ④ **Il guasto ha un nome.** `GEODCIM_ERRORS` è il vocabolario della rotta e
//     delle parole del pannello: uno solo, e un test li tiene insieme.
//
// ⚠️ `.js` e non `.ts`: `engines >=16` e la CI su 18/20, dove un `.ts` è SyntaxError.

const IS = require('./inter-site.js');
const TESTO = require('./user-text.js');

/** I nomi con cui la lettura può non riuscire. @type {string[]} */
const GEODCIM_ERRORS = ['no-scope', 'not-configured', 'dcim-unreachable'];

/** Un valore «assente» per NetBox: nullo, vuoto o solo spazi. */
const _vuoto = (v) => v == null || (typeof v === 'string' && v.trim() === '');

/**
 * I siti del DCIM, letti per la loro posizione.
 *
 * @param {unknown} rawSites la risposta di `/api/dcim/sites/`
 * @param {{siteIds?: unknown[]}} [scope] gli id NetBox chiesti (③)
 * @returns {{found:{siteId:string,name:string|null,lat:number,lng:number}[],
 *            noPosition:{siteId:string,name:string|null}[],
 *            invalid:{siteId:string,name:string|null,reason:'half'|'invalid'}[],
 *            missing:string[]}}
 */
function sitesToGeo(rawSites, scope) {
  const out = { found: [], noPosition: [], invalid: [], missing: [] };
  const chiesti = ((scope && Array.isArray(scope.siteIds)) ? scope.siteIds : [])
    .filter(x => x != null).map(String);
  if (!chiesti.length || !Array.isArray(rawSites)) return out;

  // Per id, una volta sola: un sito ripetuto nella risposta conta uno. Si tiene il
  // primo, e l'ORDINE finale è quello dell'ambito chiesto, non quello del server.
  /** @type {Record<string, Record<string, unknown>>} */
  const perId = Object.create(null);
  for (const s of rawSites) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
    const o = /** @type {Record<string, unknown>} */ (s);
    if (o.id == null) continue;
    const id = String(o.id);
    if (!(id in perId)) perId[id] = o;
  }

  const visti = new Set();
  for (const id of chiesti) {
    if (visti.has(id)) continue;
    visti.add(id);
    const s = perId[id];
    if (!s) { out.missing.push(id); continue; }
    const nome = TESTO.cleanUserText(s.name) || null;
    const senzaLat = _vuoto(s.latitude), senzaLng = _vuoto(s.longitude);
    if (senzaLat && senzaLng) { out.noPosition.push({ siteId: id, name: nome }); continue; }
    if (senzaLat !== senzaLng) { out.invalid.push({ siteId: id, name: nome, reason: 'half' }); continue; }
    const lat = IS.parseCoordinate(s.latitude, 'lat');
    const lng = IS.parseCoordinate(s.longitude, 'lng');
    if (lat === null || lng === null) { out.invalid.push({ siteId: id, name: nome, reason: 'invalid' }); continue; }
    out.found.push({ siteId: id, name: nome, lat, lng });
  }
  return out;
}

module.exports = { GEODCIM_ERRORS, sitesToGeo };
