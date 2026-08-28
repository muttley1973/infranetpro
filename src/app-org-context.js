// ============================================================
// DOVE SONO — il progetto aperto, visto dal piano di sopra.
// ------------------------------------------------------------
// Un progetto InfraNet documenta UN edificio, e finché lo si guarda da dentro
// nulla dice che quell'edificio è la sede di Milano di un'organizzazione che ne
// ha altre due. Questo modulo risponde a UNA domanda — «il progetto aperto è una
// sede dichiarata, e di chi?» — e la sotto-header la trasforma in un percorso su
// cui si può risalire.
//
// ── Le scelte, e perché ───────────────────────────────────────────────────
//
//  ① **Nessun import.** È il modulo più a valle di tutti: la sotto-header lo usa
//     a ogni `renderAll`, e il pannello «Sedi e collegamenti» gli dice quando
//     buttare la cache. Se importasse uno dei due nascerebbe un ciclo ESM, che
//     in un bundle si manifesta come un `undefined` a runtime — non come errore
//     di build. Zero import = ciclo impossibile per costruzione.
//
//  ② **Assente ≠ sconosciuto.** `orgContextFor` distingue tre esiti, e chiamare
//     `orgContextReady()` prima è obbligatorio: cache non ancora arrivata (non
//     si sa), caricata e il progetto NON è una sede (`null`), caricata ed è una
//     sede (l'oggetto). Senza il primo caso la barra lampeggerebbe «non sei in
//     nessuna sede» per la frazione di secondo prima della risposta — una
//     affermazione falsa, detta con la faccia di un dato.
//
//  ③ **Si legge, non si deduce.** Il legame progetto→sede è `site.projectRef`,
//     un riferimento scritto da qualcuno. Non si cerca per NOME: due sedi
//     possono chiamarsi come il loro progetto, e indovinare qui vorrebbe dire
//     mostrare un percorso che nessuno ha dichiarato (paletto ②).
//
//  ④ **Un fallimento è silenzio, non un errore.** Se `/api/organization` non
//     risponde, la briciola semplicemente non compare: è un'informazione in
//     più su dove sei, non una funzione che si rompe. La barra resta quella di
//     prima.
// ============================================================

const API = '/api/organization';

/** @type {{ready:boolean, org:any, inflight:Promise<void>|null}} */
const _c = { ready: false, org: null, inflight: null };

/** True quando una risposta (o un fallimento) è arrivata: prima di questo
 *  momento «non è una sede» non è una risposta, è un'attesa (②). */
export function orgContextReady() { return _c.ready; }

/**
 * Carica l'organizzazione UNA volta sola. Chiamate concorrenti condividono la
 * stessa richiesta (`inflight`): la sotto-header si ridisegna a ogni `renderAll`
 * e senza questa guardia un solo cambio di vista partorirebbe cinque fetch.
 * Non rifiuta mai: un errore è uno stato «pronto, senza organizzazione» (④).
 */
export function orgContextLoad() {
  if (_c.ready) return Promise.resolve();
  if (_c.inflight) return _c.inflight;
  _c.inflight = (async () => {
    try {
      const r = await fetch(API, { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const j = await r.json();
        _c.org = (j && j.organization) || null;
      }
    } catch (_) { /* ④ silenzio: la briciola non compare, la barra regge */ }
    _c.ready = true;
    _c.inflight = null;
  })();
  return _c.inflight;
}

/** Dimentica quel che si sapeva: la prossima `orgContextLoad()` rilegge davvero.
 *  La chiama il pannello dopo aver SALVATO — rinominare una sede lì e vedere il
 *  vecchio nome nella barra sarebbe la stessa verità raccontata in due modi. */
export function orgContextInvalidate() { _c.ready = false; _c.org = null; _c.inflight = null; }

/**
 * La sede che dichiara di essere questo progetto, o `null` se nessuna lo fa.
 *
 * ⚠️ Il confronto è fra STRINGHE di id perché `projectRef` è scritto a mano nel
 * modello inter-sede (dove è testo) mentre `store.currentProjectId` è un numero:
 * `'12' === 12` è falso, e senza normalizzare la briciola non comparirebbe mai
 * — su ogni progetto, cioè in silenzio e sempre.
 *
 * @param {string|number|null|undefined} projectId
 * @returns {{orgName:string, siteName:string, siteId:string}|null}
 */
export function orgContextFor(projectId) {
  if (!_c.org || projectId == null || projectId === '') return null;
  const key = String(projectId);
  const sites = Array.isArray(_c.org.sites) ? _c.org.sites : [];
  const site = sites.find(s => s && s.projectRef != null && String(s.projectRef) === key);
  if (!site) return null;
  return {
    orgName: String(_c.org.name || '').trim(),
    siteName: String(site.name || '').trim(),
    siteId: String(site.id || ''),
  };
}
