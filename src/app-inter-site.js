// ============================================================
// SEDI E COLLEGAMENTI — il layer multi-sede visto dall'utente (Fase 1).
// ------------------------------------------------------------
// Un progetto InfraNet documenta UN edificio. Questa vista è il piano di
// sopra: l'organizzazione, le sue sedi (ognuna un RIFERIMENTO a un progetto, mai
// una copia), gli uplink WAN e i collegamenti che le legano — su una mappa, e
// scrivibili a mano.
//
// ⭐ È una VISTA dello spazio di lavoro, non un dialogo: acceso dal bottone «Multisito»,
// prende il posto della planimetria (al centro la carta), della libreria degli elementi
// (a sinistra l'elenco delle sedi) e del rack (a destra Proprietà · Collegamenti ·
// Coerenza). Il tile in alto a destra, che sulla planimetria filtra le VLAN, qui filtra i
// tipi di connessione (`lib/multisite-view.js`). Vedi «La vista» più in basso.
//
// ── Le scelte, e perché ───────────────────────────────────────────────────
//
//  ① **Mappa e form nello stesso pannello.** Non sono due funzioni: una mappa
//     che nessuno può popolare resta vuota per sempre, e un form senza mappa non
//     mostra il motivo per cui lo si compila. Le tab sono viste della STESSA
//     organizzazione in lavorazione, non pagine diverse.
//
//  ② **La mano è la strada base, non un ripiego.** L'IT-di-uno della PMI non ha
//     NetBox: per lui questo pannello *è* il layer multi-sede (paletto ①). Il
//     futuro import da NetBox riempirà gli stessi campi, non altri.
//
//  ③ **Il SERVER è autorevole, e si adotta la sua risposta.** Dopo il PUT lo
//     stato in lavorazione viene rimpiazzato da ciò che il server ha davvero
//     scritto, non da ciò che avevamo mandato. È così che l'utente vede una
//     subnet rientrare canonica, o un collegamento cadere — e `dropped` glielo
//     dice a parole, invece di farlo sparire in silenzio.
//
//  ④ **L'audit NON si ricalcola qui.** Arriva già dentro la risposta di
//     `GET`/`PUT /api/organization`. Ricalcolarlo lato client sarebbe la 13ª
//     definizione duplicata motore↔renderer di questo progetto.
//
//  ⑤ **La geometria della mappa sta in `lib/inter-site-layout.js`.** Qui si
//     traduce in SVG e basta: le coordinate le decide un modulo puro e testato,
//     che domani userà identico anche l'export in PDF/draw.io.
//
// NB ratchet: nessun `win.*` (fetch diretta sui route) e nessun `on*=` inline
// (tutto via `data-act`/`data-change`/`data-input`) → non fa crescere l'ASSE B.
// ⚠️ Non è più un `.tool-modal-overlay`: l'a11y non è automatica. L'elenco è fatto di bottoni, le
// schede hanno `role="tab"`, i bottoni a icona hanno un nome, e la carta si governa anche
// dall'elenco — la tastiera non deve passare da Leaflet.
// ============================================================
import { t } from './_bridge.js';
import { escapeHTML, uid } from './app-util.js';
import { store } from './store.js';
import { showAlert, showConfirm, switchProject } from './app-core.js';
import { registerClickActions, registerChangeActions, registerInputActions, registerKeydownActions, dispatchClick } from './app-delegation.js';
import { buildInterSiteLayout, interSiteEdgePath } from '../lib/inter-site-layout.js';
import { buildGeoMapModel, clusterMarkers } from '../lib/inter-site-geo-map.js';
import { SITE_ROLES, INTER_SITE_STATES, WAN_ADDRESSING, WAN_SERVICE_TYPES,
  INTER_SITE_TRANSPORTS, INTER_SITE_TUNNELS, CARRIER_TRANSPORTS,
  knownProviders, parseCoordinate, normalizeGeo } from '../lib/inter-site.js';
// I nomi con cui «Trova» può non riuscire: il vocabolario è quello della rotta, e
// le parole del pannello si guardano contro QUESTO (test/inter-site-panel-i18n).
import { GEOCODE_ERRORS } from '../lib/geocode.js';
import { GEODCIM_ERRORS } from '../lib/dcim-geo.js';
// ㉖ La classificazione problema/lacuna si IMPORTA. C'era una seconda copia qui,
// e coincideva con quella del motore per abitudine: un controllo aggiunto di là
// sarebbe stato calcolato e mai disegnato, perché questo file disegna solo ciò
// che sta in uno dei due elenchi. Tredicesima occorrenza della famiglia.
import { INTER_SITE_AUDIT_PROBLEMS as AUDIT_PROBLEMS,
  INTER_SITE_AUDIT_GAPS as AUDIT_GAPS } from '../lib/inter-site-audit.js';
import { factDeclared, factOrigin, factValue, isFact } from '../lib/provenance.js';
import { subnetInputToCidr, addrFamily } from '../lib/cidr.js';
// 🔒 La stessa guardia che il modello applica ai due puntatori (l'assistenza
// dell'operatore e dove sta la PSK) e che `node.backup.ref` usa da sempre. Si
// IMPORTA invece di riscriverne una: una seconda definizione di «questo è un
// segreto» diverge alla prima regex ritoccata, ed è la famiglia di difetti che
// qui è già tornata dodici volte.
import { validateBackupRef } from '../lib/backup-ref.js';
import { prefixesOf, migrateIpam } from '../lib/ipam-model.js';   // l'autorità sulle reti DICHIARATE di un progetto
import { nodeLabelParts } from '../lib/node-label.js';
import { orgContextInvalidate } from './app-org-context.js';
import { TYPES } from './app-types.js';
import { expose } from './_bridge.js';
import { buildTile, kindAxis, kindStyle, connectionKind, ACCESS_NONE } from '../lib/multisite-view.js';

const API = '/api/organization';

/**
 * I tipi di apparato che, in pratica, terminano un collegamento fra sedi.
 *
 * Nella PMI il capo di un IPsec è quasi sempre il **firewall**, perché il
 * firewall *è* il bordo internet: è lui ad avere l'IP pubblico. Nell'enterprise,
 * o quando la linea ha un router gestito dall'operatore, è il **router**. Su un
 * MPLS il capo è il CE, che è un router e spesso è la scatola del provider.
 *
 * ⚠️ Questa lista serve a ORDINARE, non a FILTRARE. Qualcuno termina un tunnel
 * su un NAS o su un server, e non tocca a noi dirgli che ha torto: gli altri
 * apparati restano tutti scegliibili, in un secondo gruppo (paletto ③).
 */
const WAN_EDGE_TYPES = ['firewall', 'router', 'sdwan', 'vpncon'];

/** L'organizzazione VUOTA — la stessa forma che restituisce lo store del server
 *  quando il file non c'è ancora. «Non c'è» non è «è rotta»: è uno stato normale. */
const EMPTY_ORG = () => ({ id: '', name: '', sites: [], uplinks: [], links: [] });

const _st = {
  /** ㉖ Come stai GUARDANDO la mappa — non che cosa hai documentato. Sta qui e
   *  non nell'organizzazione: non si salva, non sporca, non fa scattare il
   *  «da salvare». `zoom: 1` è l'inquadratura «tutto dentro».
   *  @type {{x:number, y:number, zoom:number}} */
  mapView: { x: 0, y: 0, zoom: 1 },
  /** @type {any} */ org: EMPTY_ORG(),
  /** @type {any} */ audit: null,
  /** @type {{siteId:string, projectRef:string}[]} */ unknownRefs: [],
  /** @type {{sites:number, uplinks:number, links:number}|null} */ dropped: null,
  /** @type {{id:number, name:string}[]} */ projects: [],
  /** Il CONTENUTO dei progetti-sede, letto su richiesta e tenuto da parte.
   *  `undefined` = mai chiesto · `null` = chiesto e NON leggibile · oggetto = letto.
   *  I tre stati sono distinti apposta: «non l'ho ancora letto» e «l'ho letto e
   *  non c'era niente» non devono avere la stessa faccia a schermo.
   *  @type {Map<string, {devices:{id:string,name:string,type:string}[], nets:string[]}|null>} */
  projectData: new Map(),
  /** L'esito dell'ultima lettura delle linee WAN dal DCIM. Sta nel pannello e
   *  non in un modale: le note sono più d'una, e un elenco dentro un avviso che
   *  si chiude col primo clic è un elenco che nessuno legge. `null` = mai fatta.
   *  @type {{added:number, total:number, already:number, addedLinks:number,
   *          totalLinks:number, notes:any[]}|null} */
  wanReport: null,
  /** @type {boolean} */ wanBusy: false,
  /** Ciò che si sta SCRIVENDO nei due campi del punto di una sede, per id di sede.
   *  Esiste perché il modello tiene un punto o niente (②): scrivere la latitudine
   *  e non ancora la longitudine non ha un punto da mostrare, e senza questo il
   *  testo digitato sparirebbe al primo ridisegno. Si butta quando arriva un
   *  documento (`_adopt`) o quando un punto viene scelto.
   *  @type {Record<string, {lat:string, lng:string}>} */
  geoDraft: {},
  /** L'ultima ricerca «Trova», con ciò che ha proposto. NON è nel documento: sono
   *  proposte, e una proposta non scelta non esiste (②). `tok` serve a scartare
   *  la risposta di una ricerca vecchia se nel frattempo ne è partita un'altra o
   *  il pannello è stato chiuso.
   *  @type {{siteId:string, tok:number, busy:boolean, candidates:{lat:number,lng:number,label:string}[],
   *          error:string, host:string|null}|null} */
  geoFind: null,
  /** Come si disegnano le sedi al centro: `geo` (dove sono) o `schema` (come sono legate).
   *  Parte da `geo`: la carta prende il posto della planimetria. Chi non ha scritto nessun
   *  punto non trova una pagina bianca — la mappa dice quali sedi le mancano e come darle un punto.
   *  @type {'schema'|'geo'} */
  mapMode: 'geo',
  /** ⭐ Il Multisito è acceso? Non è un dialogo: è una VISTA dello spazio di lavoro, come la
   *  Panoramica. Acceso, la mappa prende il posto della planimetria, l'elenco delle sedi quello
   *  della libreria e le schede quello del rack. Non si salva: è come stai guardando. */
  view: false,
  /** La sede scelta (elenco o mappa): è quella che la scheda «Proprietà» mostra. '' = nessuna. */
  selSite: '',
  /** I tipi di collegamento SPENTI dal tile (`{ipsec:true}`): si guardano, non si documentano. */
  hiddenKinds: {},
  /** L'accesso scelto nel tile ('' = nessuno): evidenzia le sedi che lo hanno. */
  accessSel: '',
  /** Cosa si sta cercando nella tabella aperta. */
  filter: '',
  /** Il collegamento e la linea WAN scelti (la sede scelta è `selSite`): la scheda a destra mostra la riga della scheda aperta. */
  selLink: '',
  selUp: '',
  /** Il cassetto: aperto o ridotto alla sola barra, e quanto è alto da aperto (px). */
  dockOpen: true,
  dockH: 320,
  /** Finché nessuno ha mosso la maniglia il cassetto si adatta alla scheda della riga (vedi `_fitDock`). */
  dockAuto: true,
  /** Se la ricerca per indirizzo c'è su questo server, e dove va l'indirizzo.
   *  `null` = non l'ho ancora chiesto (il bottone resta attivo: si scopre cliccando).
   *  @type {{enabled:boolean, host:string|null, reason:string|null}|null} */
  geocoder: null,
  /** La scheda del cassetto: `sites` · `links` · `wan` (tabelle) · `audit` (il referto).
   *  @type {'sites'|'links'|'wan'|'audit'} */
  tab: 'sites',
  dirty: false,
  saving: false,
  loading: false,
  loadErr: '',
  /** ⑭ Il collegamento a cui la mappa ha appena mandato: la riga da portare
   *  sotto gli occhi al prossimo disegno. `null` = nessuno. */
  /** @type {string|null} */ focusLink: null,
  /** L'id del record appena creato dal bottone «aggiungi»: la riga da portare
   *  sotto gli occhi al prossimo disegno. Da quando il bottone sta in cima, nella
   *  barra delle schede, la riga nuova nasce IN FONDO all'elenco — cioè fuori
   *  dallo schermo — e senza questo un «aggiungi» sembrerebbe non fare niente.
   *  @type {string|null} */ focusNew: null,
  /** ⚠️ Vero mentre i progetti-sede stanno arrivando. Serve SOLO a `focusLink`:
   *  quando arrivano si ridisegna, l'HTML della riga viene rifatto da capo e
   *  con esso se ne va lo scorrimento. Finché è vero, la richiesta di messa a
   *  fuoco non si consuma — o il salto durerebbe un decimo di secondo. */
  warming: false,
};

function _el(id) { return document.getElementById(id); }

/**
 * ㉖ **La vista della mappa: `{x, y, zoom}`, come la planimetria.**
 * Non è una seconda invenzione: è lo stesso modello di `store.state.floorView`
 * (`src/app-search-zoom-rack.js`), perché chi ha imparato a muoversi sul
 * pavimento non deve reimparare qui — e perché quel modello ha già risolto la
 * parte difficile, cioè ingrandire VERSO IL CURSORE invece che verso il centro.
 *
 * ⚠️ Vive in `_st`, non nel progetto: è come stai guardando, non che cosa hai
 * documentato. Non sporca l'organizzazione e non fa scattare il «da salvare».
 * ⚠️ `zoom: 1` è esattamente l'inquadratura che `_fitMapViewBox` calcola, cioè
 * «tutto dentro»: così il 100% vuol dire una cosa sola, e il bottone che ci
 * riporta non deve ricalcolare niente.
 */
const MAP_ZOOM = { min: 0.4, max: 6, step: 0.2 };

/** Un punto dello schermo nelle unità del `viewBox`. Si chiede all'SVG con
 *  `getScreenCTM()` invece di dividere per un rapporto calcolato a mano: con
 *  `preserveAspectRatio` il disegno è centrato e ha due bande ai lati, e una
 *  proporzione scritta a mano sbaglierebbe proprio dove serve — sotto il
 *  cursore. ⚠️ È anche la ragione per cui non si misura con `getBoundingClientRect`. */
function _mapPoint(svg, ev) {
  if (!svg || typeof svg.getScreenCTM !== 'function') return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const p = svg.createSVGPoint();
  p.x = ev.clientX; p.y = ev.clientY;
  return p.matrixTransform(ctm.inverse());
}

/** L'SVG dello schema, se il centro lo sta mostrando. */
function _mapSvg() {
  const host = _el('ms-schema');
  return host ? host.querySelector('svg.org-map') : null;
}

/** Scrive la vista sul gruppo, senza ridisegnare niente: il trascinamento deve
 *  essere fluido, e un `_render()` per fotogramma ricostruirebbe l'intero SVG. */
function _applyMapView() {
  const svg = _mapSvg();
  const g = svg && svg.querySelector('.org-map-zoom');
  if (!g) return;
  const v = _st.mapView;
  g.setAttribute('transform', `translate(${_n(v.x)} ${_n(v.y)}) scale(${_n(v.zoom)})`);
  const lbl = _el('org-map-zoom-lbl');
  if (lbl) lbl.textContent = Math.round(v.zoom * 100) + '%';
  const wrap = svg.closest('.org-map-frame');
  if (wrap) wrap.classList.toggle('is-zoomed', Math.abs(v.zoom - 1) > 0.001 || !!v.x || !!v.y);
}

/** Ingrandisce di `delta`, tenendo fermo il punto sotto il cursore (o il centro
 *  dell'inquadratura, se lo chiede un bottone). Stessa aritmetica di `zoomFloor`. */
function _zoomMap(delta, ev) {
  const svg = _mapSvg();
  if (!svg) return;
  const v = _st.mapView;
  const vecchio = v.zoom;
  const z = Math.max(MAP_ZOOM.min, Math.min(MAP_ZOOM.max, vecchio + delta));
  if (Math.abs(z - vecchio) < 1e-9) return;
  const p = ev ? _mapPoint(svg, ev) : null;
  const vb = svg.viewBox && svg.viewBox.baseVal;
  const cx = p ? p.x : (vb ? vb.x + vb.width / 2 : 0);
  const cy = p ? p.y : (vb ? vb.y + vb.height / 2 : 0);
  v.x = cx - (cx - v.x) / vecchio * z;
  v.y = cy - (cy - v.y) / vecchio * z;
  v.zoom = z;
  _applyMapView();
}

/** Torna a «tutto dentro». Il 100% è l'inquadratura del `viewBox`, quindi
 *  rimettere i tre numeri a zero-zero-uno È il ritorno alla vista intera. */
function _fitMap() {
  _st.mapView = { x: 0, y: 0, zoom: 1 };
  _applyMapView();
}
const _isAdmin = () => !(store._currentUser && store._currentUser.role === 'viewer');

// ── Rete ──────────────────────────────────────────────────────────────────

/** Adotta la risposta del server come verità (③). */
function _adopt(j) {
  _st.org = (j && j.organization) ? j.organization : EMPTY_ORG();
  _st.audit = (j && j.audit) || null;
  _st.unknownRefs = (j && j.unknownProjectRefs) || [];
  _st.dirty = false;
  // Un documento nuovo è la verità: ciò che si stava digitando o proponendo era
  // riferito al documento di prima.
  _st.geoDraft = {};
  _st.geoFind = null;
}

// ⭐ La versione dell'organizzazione che questa scheda ha in mano, presa dall'ETag
// della risposta e ripresentata a ogni Salva come `If-Match`. L'organizzazione è
// UNA per installazione: non serve che due persone abbiano aperto lo stesso
// progetto, bastano due schede qualsiasi — e senza questo la seconda scrittura
// vinceva in silenzio, con le sedi della prima sparite e un 200 a dire che era
// andato tutto bene. Metadato di TRASPORTO: modulo-scoped, non nell'organizzazione.
// ⚠️ Solo dalle risposte RIUSCITE. Anche il 409 porta un ETag — quello di chi ha
// scritto per ultimo — e adottarlo qui farebbe passare il salvataggio successivo
// senza chiedere niente a nessuno: la guardia si disinnescherebbe da sé, proprio
// al primo caso che deve fermare (stessa disciplina di `_captureEtag` sui progetti).
let _orgEtag = null;
function _captureOrgEtag(res) {
  if (!res || !res.ok) return;
  const t = res.headers.get('ETag');
  if (t) _orgEtag = t;
}

async function _load() {
  _st.loading = true; _st.loadErr = '';
  // I progetti-sede si rileggono insieme all'organizzazione: fra un'apertura e
  // l'altra qualcuno può aver aggiunto l'apparato che qui si sta cercando.
  _st.projectData.clear();
  try {
    const [r, rp] = await Promise.all([
      fetch(API, { headers: { Accept: 'application/json' } }),
      fetch('/api/projects', { headers: { Accept: 'application/json' } }),
    ]);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    _captureOrgEtag(r);
    _adopt(await r.json());
    // La lista progetti serve alla tendina `projectRef`. Se non arriva, la
    // tendina resta col solo valore già scritto: meglio un campo povero di un
    // riferimento perso.
    // `devices`/`racks` arrivano dalla lista (il server li conta nel parse che fa
    // comunque): il riquadro-sede mostra quanto c'è dentro senza scaricare i
    // progetti interi — una planimetria come data-URL pesa più di tutto il resto.
    // `?? null` e non `|| 0`: un server più vecchio non li manda, e «non lo so»
    // non deve diventare «zero» (vedi `_contentLabel`).
    _st.projects = rp.ok
      ? (await rp.json()).map(p => ({
          id: p.id, name: p.name,
          devices: p.devices == null ? null : p.devices,
          racks: p.racks == null ? null : p.racks,
        }))
      : [];
  } catch (e) {
    _st.loadErr = String((e && e.message) || e);
  } finally {
    _st.loading = false;
    _render();
  }
}

// ── Il progetto di una sede: apparati e reti DICHIARATE ───────────────────

/**
 * ⭐ Le reti che si prendono da un progetto sono quelle **dichiarate**
 * (`state.ipam.prefixes` — le righe del pannello Reti, scritte o importate da un
 * DCIM), MAI le /24 che `lib/project-networks.js` deduce dagli indirizzi degli
 * apparati. La differenza non è di dettaglio: le prime sono un documento, e
 * copiarle qui è un documento che diventa un altro documento; le seconde sono
 * una DERIVAZIONE, e portarle nell'organizzazione le promuoverebbe a
 * dichiarazione dell'azienda — cioè inventerebbe, con la faccia di una scelta.
 *
 * ⚠️ Prima si applica `migrateIpam` a una copia usa-e-getta. Un progetto salvato
 * prima della 2.x tiene la subnet dentro `ipam.vlans[<vid>].subnet`, e leggere
 * `ipam.prefixes` senza migrare risponderebbe «nessuna rete»: uno zero
 * silenzioso, che è la bugia peggiore. L'oggetto arriva da `res.json()` ed è
 * nostro — la migrazione non tocca niente sul disco né nell'app.
 */
function _readProject(p) {
  const state = (p && p.state && typeof p.state === 'object') ? p.state : null;
  if (!state) return { devices: [], nets: [], dcimSites: [] };
  migrateIpam(state);
  const nets = [];
  for (const row of prefixesOf(state)) {
    const c = subnetInputToCidr(row && row.cidr);
    if (c && nets.indexOf(c) < 0) nets.push(c);
  }
  const devices = (Array.isArray(state.nodes) ? state.nodes : [])
    .filter(n => n && n.id)
    .map(n => ({ id: String(n.id), name: nodeLabelParts(n).primary || String(n.id), type: String(n.type || '') }));
  // Da quale fetta di DCIM è nato questo progetto. È il documento a dirlo
  // (`state.source`, scritto dall'import), e da qui si sa QUALI siti chiedere a
  // NetBox per le linee WAN: senza, bisognerebbe indovinarlo da un nome.
  // ⚠️ Assente = progetto scritto a mano, o importato prima della 2.9.2. Sono
  // due cose diverse da «nessun sito», e chi legge deve poterlo distinguere:
  // una lista vuota qui vuol dire solo «non risulta».
  const dcim = state.source && state.source.dcim;
  const dcimSites = (dcim && Array.isArray(dcim.sites) ? dcim.sites : [])
    .filter(s => s && s.id != null)
    .map(s => ({ id: s.id, name: s.name == null ? '' : String(s.name) }));
  return { devices, nets: nets.sort(), dcimSites };
}

/** Legge un progetto-sede una volta sola. Un progetto che non si legge resta
 *  `null` in cache: si RIPROVA solo riaprendo il pannello, non a ogni disegno. */
async function _fetchProject(ref) {
  const key = String(ref || '');
  if (!key) return null;
  if (_st.projectData.has(key)) return _st.projectData.get(key);
  try {
    const r = await fetch('/api/projects/' + encodeURIComponent(key), { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = _readProject(await r.json());
    _st.projectData.set(key, data);
    return data;
  } catch (_) {
    _st.projectData.set(key, null);
    return null;
  }
}

/** Scalda la cache per i progetti che la scheda corrente dovrà mostrare, e
 *  ridisegna UNA volta quando sono arrivati tutti — non uno alla volta. */
async function _warmProjects(refs) {
  const mancanti = [...new Set(refs.filter(Boolean).map(String))].filter(k => !_st.projectData.has(k));
  if (!mancanti.length) return;
  _st.warming = true;
  try { await Promise.all(mancanti.map(_fetchProject)); }
  finally { _st.warming = false; }
  _render();
}

async function _save() {
  if (_st.saving) return;
  _st.saving = true; _render();
  try {
    const r = await fetch(API, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, _orgEtag ? { 'If-Match': _orgEtag } : {}),
      body: JSON.stringify(_st.org),
    });
    if (r.status === 403) { showAlert(t('org.saveForbidden')); return; }
    // 409: qualcun altro ha scritto l'organizzazione mentre questa scheda la
    // modificava. Non si sovrascrive e non si adotta il suo ETag: si DICE, e chi
    // legge decide se ricaricare (le sue modifiche restano qui, non le tocchiamo).
    if (r.status === 409) { showAlert(t('org.saveStale')); return; }
    _captureOrgEtag(r);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error('HTTP ' + r.status);
    _st.dropped = j.dropped || null;
    _adopt(j);   // ③ si adotta ciò che il server ha SCRITTO
    // La briciola «dove sono» della sotto-header legge la stessa organizzazione da
    // una cache sua: senza questo, rinominare qui una sede lascerebbe il vecchio
    // nome scritto là sotto — la stessa verità raccontata in due modi diversi.
    orgContextInvalidate();
  } catch (e) {
    showAlert(t('org.saveFailed') + ' ' + String((e && e.message) || e));
  } finally {
    _st.saving = false; _render();
  }
}

// ── Helper di modello ─────────────────────────────────────────────────────

const _sites = () => _st.org.sites || (_st.org.sites = []);
const _uplinks = () => _st.org.uplinks || (_st.org.uplinks = []);
const _links = () => _st.org.links || (_st.org.links = []);

const _siteName = (id) => {
  const s = _sites().find(x => x.id === id);
  return s ? s.name : '';
};

/**
 * L'etichetta di un campo che parla di UN capo: «Apparato presso Verona».
 *
 * ⑬ Il nome della sede al posto di «primo capo»/«secondo capo». I due capi
 * altrimenti si distinguono solo per POSIZIONE, e per sapere quale sia il primo
 * bisogna risalire alle due tendine in cima alla riga: sei campi più su, fuori
 * dallo sguardo mentre si compila. Col nome scritto non c'è niente da ricordare.
 *
 * ⚠️ Se la sede non c'è — riferimento rotto, ed è l'audit a dirlo — resta il suo
 * id. Un'etichetta che finisce nel vuoto («Apparato presso ») è peggio di un id
 * brutto: non si vede nemmeno che manca qualcosa. Stessa scelta già fatta per le
 * caselle dell'underlay.
 */
function _atSite(key, siteId) {
  return t(key).replace('{site}', _siteName(siteId) || siteId || '—');
}

/** Il valore nudo di un campo che PUÒ portare l'envelope (`publicIp`, `state`…). */
function _fv(f) { return isFact(f) ? String(factValue(f) == null ? '' : factValue(f)) : ''; }

/**
 * Scrivere a mano un campo misurabile lo rende una DICHIARAZIONE.
 * Non è una perdita: è il paletto manual-first: se una persona lo scrive, quella
 * è la verità documentale. L'origine precedente resta visibile accanto al campo
 * finché non lo si tocca, così nessuno crede di star correggendo una misura
 * senza accorgersene.
 */
function _setFact(obj, key, raw) {
  const v = String(raw == null ? '' : raw).trim();
  obj[key] = v ? factDeclared(v) : null;
}

/** Una lista di subnet scritta a mano → righe. La canonicalizzazione la fa il
 *  SERVER (non ne esiste una seconda qui): questa è solo la spezzettatura. */
function _splitNets(s) {
  // ⚠️ Si LEGGE largo e si SCRIVE stretto: qui entrano virgole, punti e
  // virgola, spazi e a capo, perché chi incolla da un preventivo o da una
  // console non deve rimettere a posto i separatori a mano; ma quando il
  // campo si ridisegna esce sempre con la virgola, che è il separatore del
  // resto dell'app (le VLAN di un trunk si scrivono «1,10,20,100»). Un campo
  // che accetta tutto e restituisce un formato diverso da quello di tutti
  // gli altri insegna una regola sbagliata a ogni ridisegno.
  return String(s == null ? '' : s).split(/[\s,;]+/).filter(Boolean);
}

/** Le righe che NON sono reti — dette PRIMA di salvare, perché il server le
 *  scarterebbe in silenzio (`dropped` conta sedi/uplink/collegamenti, non subnet). */
function _badNets(list) {
  return (list || []).filter(x => !subnetInputToCidr(x));
}

/** Le righe che non sono né un INDIRIZZO né un BLOCCO (⑦ di `lib/inter-site.js`).
 *  Due strade diverse apposta: `203.0.113.10` è un indirizzo e resta tale,
 *  `203.0.113.8/29` è un blocco e si canonicalizza come rete. Confonderle
 *  ridurrebbe un indirizzo alla sua /24, che è un altro fatto. */
function _badAddrs(list) {
  return (list || []).filter(x => (String(x).indexOf('/') >= 0) ? !subnetInputToCidr(x) : !addrFamily(x));
}

/** Come `_paintNetHint`, ma per gli indirizzi pubblici. */
function _paintAddrHint(el) {
  const hint = el.parentElement && el.parentElement.querySelector('[data-net-hint]');
  if (!hint) return;
  const bad = _badAddrs(_splitNets(el.value));
  hint.textContent = bad.length ? t('org.notAddresses') + ' ' + bad.join(', ') : '';
  hint.style.display = bad.length ? '' : 'none';
}

/** Come sopra, per la banda (⑩ di `lib/inter-site.js`; il campo si chiama ancora
 *  `cirMbps` mentre l'etichetta dice «della porta» — la ragione sta lì).
 *  ⚠️ Il campo è `type="number" min="1"`, ma `min` NON impedisce di digitare
 *  `-100`: il browser lo marca `rangeUnderflow` e lascia il valore leggibile.
 *  Chi lo legge deve CHIEDERGLIELO — il vecchio codice non lo faceva, e il -100
 *  arrivava fino alla scheda di ripristino. */
function _paintCirHint(el) {
  const hint = el.parentElement && el.parentElement.querySelector('[data-cir-hint]');
  if (!hint) return;
  const cattivo = el.value !== '' && _cirValue(el.value) === null;
  hint.textContent = cattivo ? t('org.cirNotPositive') + ' ' + el.value : '';
  hint.style.display = cattivo ? '' : 'none';
}

/** 🔒 Un puntatore che porta credenziali: il modello lo SCARTA, e senza una
 *  parola chi ha digitato vede sparire il suo testo al salvataggio senza sapere
 *  che è stato lui. Il valore non si tocca mentre scrive — manual-first — ma la
 *  riga rossa compare subito, come per una subnet che subnet non è. */
function _paintCredHint(el) {
  const hint = el.parentElement && el.parentElement.querySelector('[data-cred-hint]');
  if (!hint) return;
  const cattivo = el.value !== '' && validateBackupRef(el.value).reason === 'credentials';
  hint.textContent = cattivo ? t('backup.credWarn') : '';
  hint.style.display = cattivo ? '' : 'none';
}

/** La banda che il MODELLO accetterà, o `null`. Stessa regola di `_posNum` in
 *  `lib/inter-site.js`: un campo pre-validato qui e rifiutato là sarebbe la
 *  solita definizione scritta due volte, che diverge. */
function _cirValue(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Scrittura dei campi (una sola azione delegata per tutti) ──────────────

/**
 * Un campo qualsiasi del form. `data-scope` dice su cosa, `data-idx` su quale
 * riga, `data-field` quale campo. Una sola funzione invece di trenta handler:
 * i nomi dei campi sono SINTETICI (`peerA`, `reachA`) e la mappatura sul modello
 * sta tutta qui — l'HTML non conosce la forma dell'unione discriminata.
 */
function _setField(el) {
  const scope = el.dataset.scope, i = Number(el.dataset.idx), f = el.dataset.field;
  const v = el.value;
  const row = scope === 'site' ? _sites()[i] : scope === 'uplink' ? _uplinks()[i] : scope === 'link' ? _links()[i] : null;
  if (!row) return;
  _touch();

  if (scope === 'site') {
    if (f === 'subnets') row.subnets = _splitNets(v);
    else row[f] = v;                                   // name, role, projectRef, address
    if (f === 'subnets') _paintNetHint(el);
    if (f === 'role') _render();                       // cambia l'icona della riga e la forma della mappa
    return;
  }
  if (scope === 'uplink') {
    if (f === 'cirMbps') { row.cirMbps = _cirValue(v); _paintCirHint(el); }
    else if (f === 'publicIps') { const l = _splitNets(v); row.publicIps = l.length ? factDeclared(l) : null; _paintAddrHint(el); }
    else if (f === 'wanIfRef') _setFact(row, f, v);
    // ㉑ I tre numeri della scheda di ripristino restano NUMERI, con la stessa
    // regola della banda: un `<input type=number>` svuotato dà '', e '' in un
    // campo numerico è una stringa che il modello butterebbe in silenzio al
    // primo salvataggio. Qui diventa `null`, che è come si scrive «non
    // dichiarato». ⚠️ L'INTERVALLO (intero, VLAN ≤ 4094) lo tiene il modello, e
    // qui non si riscrive: gli attributi `min`/`max`/`step` guidano chi digita,
    // la definizione resta una sola — vedi `_cirValue`.
    else if (f === 'deliveryVlan' || f === 'mtu') row[f] = _cirValue(v);
    // `addressing` è un vocabolario chiuso e la tendina offre solo i suoi
    // valori; «—» è la stringa vuota, cioè non dichiarato.
    else if (f === 'addressing') row.addressing = v || null;
    else if (f === 'supportRef') { row.supportRef = v; _paintCredHint(el); }
    else row[f] = v;                                   // siteId, provider, serviceType, circuitId, nextHop, supportRef
    return;
  }
  // link
  switch (f) {
    case 'state':
      row.state = v ? factDeclared(v) : null;          // «—» = non pronunciato, che NON è «giù»
      break;
    case 'reachA':
    case 'reachB': {
      const cur = isFact(row.reach) ? factValue(row.reach) : { a: [], b: [] };
      const next = { a: (cur && cur.a) || [], b: (cur && cur.b) || [] };
      next[f === 'reachA' ? 'a' : 'b'] = _splitNets(v);
      row.reach = (next.a.length || next.b.length) ? factDeclared(next) : null;
      _paintNetHint(el);
      break;
    }
    case 'peerA': (row.endpointA || (row.endpointA = {})).peerIp = v || null; break;
    case 'peerB': (row.endpointB || (row.endpointB = {})).peerIp = v || null; break;
    case 'devA': _setEndpointDevice(row, 'endpointA', row.aSiteId, v); break;
    case 'devB': _setEndpointDevice(row, 'endpointB', row.bSiteId, v); break;
    case 'ikeVersion': row.ikeVersion = v ? Number(v) : null; break;
    case 'pskRef': row.pskRef = v; _paintCredHint(el); break;
    // ㉔ «—» è la stringa vuota, cioè «non dichiarato»: non è `none`, che sul
    // tunnel vuol dire «guardato, non c'è».
    case 'transport': row.transport = v || null; break;
    case 'tunnel': row.tunnel = v || null; break;
    default: row[f] = v; break;                        // aSiteId, bSiteId, vrf, service, overlay, media, le etichette, phase1Name, le due proposte, pskRef
  }
  // `kind` cambia QUALI campi esistono; cambiare un capo cambia il titolo della
  // riga, le etichette di `reach` e — soprattutto — l'elenco dell'altra tendina,
  // che deve smettere di offrire la sede appena scelta. Sono tutti `change` su
  // una tendina: ridisegnare non toglie il cursore a nessuno.
  // ㉔ I due assi cambiano QUALI campi esistono, e i capi cambiano il titolo.
  if (f === 'transport' || f === 'tunnel' || f === 'aSiteId' || f === 'bSiteId') _render();
}

/**
 * Ciò che è stato scritto nel campo «Apparato presso …» → riferimento OPPURE
 * nome (⑧ di `lib/inter-site.js`).
 *
 * Il testo diventa un RIFERIMENTO solo se combacia con il nome di **un solo**
 * apparato del progetto della sede. Due nodi omonimi non fanno un riferimento:
 * sceglierne uno sarebbe indovinare, e resta ciò che l'utente ha scritto — che
 * è comunque la verità documentale che ha in mano.
 */
function _setEndpointDevice(row, key, siteId, raw) {
  const ep = row[key] || (row[key] = { deviceRef: null, deviceName: null, peerIp: null });
  const v = String(raw == null ? '' : raw).trim();
  if (!v) { ep.deviceRef = null; ep.deviceName = null; return; }
  const devs = _devicesOf(siteId) || [];
  const pari = devs.filter(d => d.name === v);
  if (pari.length === 1) { ep.deviceRef = pari[0].id; ep.deviceName = null; }
  else { ep.deviceRef = null; ep.deviceName = v; }
}

/** L'avviso «queste righe non sono reti», aggiornato mentre si scrive. */
function _paintNetHint(el) {
  const hint = el.parentElement && el.parentElement.querySelector('[data-net-hint]');
  if (!hint) return;
  const bad = _badNets(_splitNets(el.value));
  hint.textContent = bad.length ? t('org.notNetworks') + ' ' + bad.join(', ') : '';
  hint.style.display = bad.length ? '' : 'none';
}

// ── Il punto di una sede sulla carta ──────────────────────────────────────
//
// Tre strade, e la prima è la base (①): scrivere le due coordinate; «Trova» le
// PROPONE dall'indirizzo e si sceglie; (poi) un clic sulla carta. In tutti e tre i
// casi è l'utente a mettere il punto, e `source` dice quale strada ha fatto.
// Il modello tiene un punto o niente (②): ciò che si sta digitando sta a parte,
// in `_st.geoDraft`, finché non sono due coordinate valide.

/** Cosa si legge sotto i due campi. Una sola funzione per il disegno e per il
 *  ritocco mentre si scrive: due frasi sulla stessa cosa divergerebbero.
 *  ⚠️ La regola dell'intervallo NON è qui: è `parseCoordinate`, del modello. */
function _geoHintText(d) {
  if (!d) return '';
  const vuoto = (v) => String(v == null ? '' : v).trim() === '';
  const lat = parseCoordinate(d.lat, 'lat'), lng = parseCoordinate(d.lng, 'lng');
  if ((!vuoto(d.lat) && lat === null) || (!vuoto(d.lng) && lng === null)) return t('org.geoInvalid');
  if (vuoto(d.lat) !== vuoto(d.lng)) return t('org.geoBoth');
  return '';
}

/** Come è nato il punto, a parole. */
function _geoSourceText(geo) {
  return geo ? t('org.geoSource.' + (geo.source || 'none')) : '';
}

/** Una coordinata come testo da mostrare in un campo. */
const _geoShow = (v) => (v == null ? '' : String(v));

function _geoBlock(s, i, ro) {
  const d = _st.geoDraft[s.id];
  const val = (axis) => (d ? d[axis] : (s.geo ? _geoShow(s.geo[axis]) : ''));
  const f = (_st.geoFind && _st.geoFind.siteId === s.id) ? _st.geoFind : null;
  const gc = _st.geocoder;
  const spenta = !!(gc && !gc.enabled);
  const host = (gc && gc.host) || '';
  const campo = (axis, key, ph) => `<label class="org-geo-axis"><span>${escapeHTML(t(key))}</span>
      <input type="text" inputmode="decimal" autocomplete="off" ${ro ? 'disabled' : ''} value="${escapeHTML(val(axis))}"
             placeholder="${escapeHTML(t(ph))}"
             data-input="org-geo" data-idx="${i}" data-axis="${escapeHTML(axis)}"></label>`;
  const trova = ro ? '' : `<button class="um-btn ghost org-mini" data-act="org-geo-find" data-idx="${i}"
        ${(spenta || (f && f.busy)) ? 'disabled' : ''}
        title="${escapeHTML(spenta ? t('org.geoErr.disabled') : (host ? t('org.geoFindTip').replace('{host}', host) : t('org.geoFindTip').replace('{host}', '…')))}">
        <i class="fas ${f && f.busy && f.kind === 'find' ? 'fa-spinner fa-spin' : 'fa-magnifying-glass-location'}"></i>
        ${escapeHTML(f && f.busy && f.kind === 'find' ? t('org.geoBusy') : t('org.geoFind'))}</button>`;
  // La posizione che il DCIM già dichiara per il sito da cui nasce il progetto di
  // questa sede: stessa disciplina di «Trova» — propone, e la scelta è tua. Serve
  // un progetto collegato, come per le reti e le linee WAN.
  const letturaDcim = ro ? '' : `<button class="um-btn ghost org-mini" data-act="org-geo-dcim" data-idx="${i}"
        ${(s.projectRef && !(f && f.busy)) ? '' : 'disabled'}
        title="${escapeHTML(s.projectRef ? t('org.geoDcimTip') : t('org.netsNoProject'))}">
        <i class="fas ${f && f.busy && f.kind === 'dcim' ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}"></i>
        ${escapeHTML(f && f.busy && f.kind === 'dcim' ? t('org.geoBusy') : t('org.geoDcim'))}</button>`;
  const togli = (ro || !(s.geo || d)) ? '' : `<button class="um-btn ghost org-mini" data-act="org-geo-clear" data-idx="${i}">
        <i class="fas fa-xmark"></i> ${escapeHTML(t('org.geoClear'))}</button>`;
  const cands = (f && !f.busy && f.candidates.length)
    ? `<p class="org-hint">${escapeHTML(t('org.geoCands'))}</p>
       <ul class="org-geo-cands">${f.candidates.map((c, k) => `<li class="org-geo-cand">
         <span class="org-geo-cand-label">${escapeHTML(c.label)}</span>
         <span class="org-geo-cand-xy">${escapeHTML(Number(c.lat) + ', ' + Number(c.lng))}</span>
         <button class="um-btn primary org-mini" data-act="org-geo-use" data-idx="${i}" data-cand="${Number(k)}">
           <i class="fas fa-check"></i> ${escapeHTML(t('org.geoUse'))}</button></li>`).join('')}</ul>`
    : '';
  return `<div class="org-f org-f-wide org-geo">
      <span>${escapeHTML(t('org.geo'))}</span>
      <div class="org-geo-row">
        ${campo('lat', 'org.geoLat', 'org.geoLatPh')}${campo('lng', 'org.geoLng', 'org.geoLngPh')}
        ${trova}${letturaDcim}${togli}
      </div>
      <small class="org-bad" data-geo-hint ${_geoHintText(d) ? '' : 'style="display:none"'}>${escapeHTML(_geoHintText(d))}</small>
      <small class="org-hint" data-geo-source>${escapeHTML(_geoSourceText(s.geo))}</small>
      ${(!ro && host) ? `<small class="org-hint">${escapeHTML(t('org.geoSendsTo').replace('{host}', host))}</small>` : ''}
      ${f && !f.busy ? (f.error ? `<small class="org-bad">${escapeHTML(f.error)}</small>` : (f.note || !f.candidates.length ? `<small class="org-hint">${escapeHTML(f.note || t('org.geoNone'))}</small>` : '')) : ''}${cands}
    </div>`;
}

/** Un campo del punto, mentre si scrive: niente ridisegno (butterebbe il cursore). */
function _setGeoAxis(el) {
  const i = Number(el.dataset.idx);
  const axis = el.dataset.axis;
  const s = _sites()[i];
  if (!s || (axis !== 'lat' && axis !== 'lng')) return;
  const d = _st.geoDraft[s.id] || (_st.geoDraft[s.id] = {
    lat: s.geo ? _geoShow(s.geo.lat) : '', lng: s.geo ? _geoShow(s.geo.lng) : '',
  });
  d[axis] = el.value;
  _touch();
  // Scrivere il punto è dichiararlo a mano: se veniva da «Trova» o dalla carta,
  // adesso non lo è più, e la sorgente lo dice.
  s.geo = normalizeGeo({ lat: d.lat, lng: d.lng, source: 'manual' });
  const box = el.closest('.org-geo');
  if (!box) return;
  const hint = box.querySelector('[data-geo-hint]');
  if (hint) { const m = _geoHintText(d); hint.textContent = m; hint.style.display = m ? '' : 'none'; }
  const src = box.querySelector('[data-geo-source]');
  if (src) src.textContent = _geoSourceText(s.geo);
}

function _geoClear(i) {
  const s = _sites()[i];
  if (!s) return;
  s.geo = null;
  delete _st.geoDraft[s.id];
  if (_st.geoFind && _st.geoFind.siteId === s.id) _st.geoFind = null;
  _touch(); _render();
}

/** Sceglie uno dei punti proposti. Qui, e solo qui, una proposta diventa un dato. */
function _geoUse(i, k) {
  const s = _sites()[i];
  const f = _st.geoFind;
  const c = f && s && f.siteId === s.id ? f.candidates[k] : null;
  if (!s || !c) return;
  // Come è arrivato il punto lo dice il candidato (`dcim` se l'ha letto il DCIM);
  // «Trova» non lo scrive e allora vale `geocoded`. È sempre la persona a sceglierlo.
  s.geo = normalizeGeo({ lat: c.lat, lng: c.lng, source: c.source || 'geocoded' });
  delete _st.geoDraft[s.id];
  _st.geoFind = null;
  _touch(); _render();
}

let _geoSeq = 0;
async function _geoFind(i) {
  const s = _sites()[i];
  if (!s || (_st.geoFind && _st.geoFind.busy)) return;
  if (!String(s.address || '').trim()) { showAlert(t('org.geoNoAddress')); return; }
  const tok = ++_geoSeq;
  _st.geoFind = { siteId: s.id, tok, kind: 'find', busy: true, candidates: [], error: '', note: '', host: null };
  _render();
  let candidates = [], error = '', host = null;
  try {
    const r = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ q: s.address }),
    });
    const j = await r.json().catch(() => null);
    if (r.status === 401 || r.status === 403) error = t('org.saveForbidden');
    else if (!r.ok) {
      const code = j && GEOCODE_ERRORS.indexOf(j.code) >= 0 ? j.code : 'generic';
      const sec = Math.max(1, Math.ceil(Number(j && j.retryAfterMs) / 1000) || 1);
      error = t('org.geoErr.' + code).replace('{s}', String(sec));
    } else if (j && Array.isArray(j.candidates)) { candidates = j.candidates; host = j.host || null; }
    else error = t('org.geoErr.generic');
  } catch (_) {
    error = t('org.geoErr.generic');
  }
  // Una risposta vecchia non si adotta: nel frattempo è partita un'altra ricerca, o
  // il pannello ha cambiato documento.
  if (!_st.geoFind || _st.geoFind.tok !== tok) return;
  _st.geoFind = { siteId: s.id, tok, kind: 'find', busy: false, candidates, error, note: '', host };
  _render();
}

/**
 * La posizione che il DCIM dichiara per il sito da cui nasce il progetto di questa
 * sede. Come «Trova», PROPONE: ciò che torna entra nell'elenco dei punti da
 * scegliere, con la sua etichetta («Dal DCIM: <nome>»), e il punto lo mette chi
 * clicca «Usa questo punto» — con `source: 'dcim'`. Niente si scrive da solo, e
 * un punto già scritto non si scavalca: resta lì finché non se ne sceglie un altro.
 *
 * L'AMBITO non lo sceglie chi guarda: lo dice il progetto della sede, che registra
 * da quale sito (o quali) è nato (`state.source.dcim.sites`) — stessa fonte delle
 * linee WAN. Se i siti sono più d'uno e più d'uno ha una posizione, si propongono
 * tutti col loro nome: scegliere il primo sarebbe un ripiego, cioè un'affermazione.
 * E si DICE anche ciò che non è stato proposto (nessuna posizione, posizione
 * storta, sito sparito), perché il silenzio si leggerebbe come «il DCIM non sa».
 */
async function _geoFromDcim(i) {
  const s = _sites()[i];
  if (!s || (_st.geoFind && _st.geoFind.busy)) return;
  if (!s.projectRef) { showAlert(t('org.netsNoProject')); return; }
  const data = await _fetchProject(s.projectRef);
  if (data === null) { showAlert(t('org.projectUnreadable')); return; }
  if (!data.dcimSites.length) { showAlert(t('org.wanNoOrigin')); return; }

  const tok = ++_geoSeq;
  _st.geoFind = { siteId: s.id, tok, kind: 'dcim', busy: true, candidates: [], error: '', note: '', host: null };
  _render();
  let candidates = [], error = '', note = '';
  try {
    const r = await fetch('/api/integrations/dcim/sites-geo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ siteIds: data.dcimSites.map(x => x.id) }),
    });
    const j = await r.json().catch(() => null);
    if (r.status === 401 || r.status === 403) error = t('org.saveForbidden');
    else if (!r.ok || !j) {
      const code = j && GEODCIM_ERRORS.indexOf(j.code) >= 0 ? j.code : 'generic';
      error = t('org.geoDcimErr.' + code);
    } else {
      candidates = (j.found || []).map(x => ({
        lat: x.lat, lng: x.lng, source: 'dcim',
        label: t('org.geoDcimLabel').replace('{name}', x.name || ('#' + x.siteId)),
      }));
      const nomi = (righe) => righe.map(x => x.name || ('#' + x.siteId)).join(', ');
      const parti = [];
      if ((j.noPosition || []).length) parti.push(t('org.geoDcimNone'));
      if ((j.invalid || []).length) parti.push(t('org.geoDcimInvalid').replace('{names}', nomi(j.invalid)));
      if ((j.missing || []).length) parti.push(t('org.geoDcimMissing').replace('{ids}', j.missing.join(', ')));
      note = parti.join(' ');
    }
  } catch (_) {
    error = t('org.geoDcimErr.generic');
  }
  if (!_st.geoFind || _st.geoFind.tok !== tok) return;
  _st.geoFind = { siteId: s.id, tok, kind: 'dcim', busy: false, candidates, error, note, host: null };
  _render();
}

/** Se la ricerca per indirizzo c'è e dove manda l'indirizzo. Un guasto qui non è un
 *  guasto del pannello: si resta con «non lo so», e il bottone si scopre cliccando. */
async function _loadGeocoderStatus() {
  try {
    const r = await fetch('/api/geocode/status', { headers: { Accept: 'application/json' } });
    if (!r.ok) return;
    const j = await r.json();
    _st.geocoder = { enabled: !!j.enabled, host: j.host || null, reason: j.reason || null };
    if (_st.view) _renderDetail();
  } catch (_) { /* nessun servizio di stato: il bottone resta com'è */ }
}

// ── Righe: aggiunta e rimozione ───────────────────────────────────────────

function _addSite() {
  const id = uid('site');
  _sites().push({ id, name: t('org.newSiteName'), role: 'standalone', projectRef: null, address: null, geo: null, subnets: [] });
  _st.dirty = true; _st.tab = 'sites'; _st.selSite = id; _st.focusNew = id; _render();
}
function _addUplink() {
  // La linea nasce sulla sede SCELTA: l'«aggiungi» sta dentro la sua scheda, e una linea che
  // finisse su un'altra sede (la prima dell'elenco) sparirebbe da sotto gli occhi di chi l'ha chiesta.
  const s = _sites().find(x => x.id === _st.selSite) || _sites()[0];
  if (!s) { showAlert(t('org.needSiteFirst')); return; }
  const nuovo = uid('wan');
  _uplinks().push({
    id: nuovo, siteId: s.id, provider: '', serviceType: '', circuitId: '', cirMbps: null,
    // ㉑ Tutti a «non dichiarato», nessuno con un valore di comodo: un campo
    // pre-compilato è un'AFFERMAZIONE, e su una scheda di ripristino sarebbe
    // un'affermazione che nessuno ha fatto.
    addressing: null, nextHop: '', deliveryVlan: null, mtu: null,
    supportRef: '',
    publicIps: null, wanIfRef: null,
  });
  _st.dirty = true; _st.tab = 'wan'; _st.selSite = s.id; _st.selUp = nuovo; _st.focusNew = nuovo; _render();
}
function _addLink() {
  const ss = _sites();
  if (ss.length < 2) { showAlert(t('org.needTwoSites')); return; }
  // Il primo capo è la sede scelta, se c'è: si aggiunge un collegamento «da qui».
  const a = ss.find(x => x.id === _st.selSite) || ss[0];
  const b = ss.find(x => x.id !== a.id);
  _links().push({
    // ㉔ Nessuna natura pre-scelta: un campo pre-compilato è un'AFFERMAZIONE, e
    // «IPsec» messo lì dal software è una frase che non ha detto nessuno.
    id: uid('isl'), aSiteId: a.id, bSiteId: b.id, transport: null, tunnel: null,
    state: null, reach: null, provider: null, circuitId: null, name: null,
    underlayUplinkIds: [],
    endpointA: { deviceRef: null, peerIp: null }, endpointB: { deviceRef: null, peerIp: null },
    phase1Name: null, ikeVersion: null,
    phase1Proposal: null, phase2Proposal: null, pskRef: null,
  });
  const nuovoLink = _links()[_links().length - 1].id;
  _st.dirty = true; _st.tab = 'links'; _st.selLink = nuovoLink; _st.focusNew = nuovoLink; _render();
}

/**
 * Prende le reti DICHIARATE dal progetto della sede e le aggiunge alle sue.
 *
 * **Aggiunge, non sostituisce.** Quello che c'era scritto a mano resta dov'è:
 * un pulsante che rimpiazza una lista è un pulsante che, premuto per sbaglio,
 * cancella il lavoro di qualcuno — e qui non c'è modo di distinguere una riga
 * scritta a mano da una presa dal progetto ieri. Additivo è l'unica forma che
 * non può togliere niente.
 *
 * E dice sempre **due** numeri: quante ne ha aggiunte e quante ne dichiarava il
 * progetto. «Aggiunte 0 su 4» e «aggiunte 0 su 0» sono due risposte diverse —
 * la prima vuol dire «le avevi già», la seconda «quel progetto non dichiara
 * nessuna rete», e con un numero solo si confonderebbero.
 */
async function _netsFromProject(i) {
  const s = _sites()[i];
  if (!s || !s.projectRef) return;
  const data = await _fetchProject(s.projectRef);
  if (data === null) { showAlert(t('org.projectUnreadable')); return; }
  const avute = new Set((s.subnets || []).map(x => subnetInputToCidr(x) || String(x)));
  const nuove = data.nets.filter(c => !avute.has(c));
  if (nuove.length) { s.subnets = (s.subnets || []).concat(nuove); _touch(); _render(); }
  showAlert(t('org.netsImported')
    .replace('{n}', String(nuove.length))
    .replace('{tot}', String(data.nets.length)));
}

// ── Le linee WAN dal DCIM ─────────────────────────────────────────────────

/** La chiave d'identità di una linea: il CODICE del circuito, e chi lo vende.
 *  In NetBox il `cid` è obbligatorio, quindi non è mai vuota per una candidata —
 *  ma resta vuota per una riga appena aggiunta a mano, e due righe vuote non
 *  sono «la stessa linea»: chi la usa lo sa e non deduplica su una chiave nuda. */
const _wanKey = (provider, circuitId) => JSON.stringify([
  String(circuitId == null ? '' : circuitId).trim().toLowerCase(),
  String(provider == null ? '' : provider).trim().toLowerCase(),
]);

/** L'identità di un COLLEGAMENTO, per non iscriverlo due volte. È fatta di ciò
 *  che di lui resta scritto: un candidato dai `circuits` porta il codice, uno da
 *  `vpn/` porta il nome. ⚠️ Non basta la coppia di sedi: due sedi possono essere
 *  legate da un MPLS e da un IPsec di scorta, ed è il caso normale. */
const _linkKey = (name, provider, circuitId, kindLabel) => JSON.stringify(
  [name, circuitId, provider, kindLabel].map(x => String(x == null ? '' : x).trim().toLowerCase()));

/**
 * `id del sito NetBox → id della sede InfraNet`, letto dai progetti già in cache.
 *
 * ⚠️ Il valore `null` vuol dire **ambiguo**: due sedi che dichiarano lo stesso
 * sito NetBox sono un dato reale e sbagliato, e sceglierne una attaccherebbe un
 * collegamento alla sede sbagliata senza dirlo. Chi lo trova si ferma e lo dice.
 */
function _siteByNetboxId() {
  const idx = new Map();
  for (const s of _sites()) {
    const d = s.projectRef ? _st.projectData.get(String(s.projectRef)) : null;
    for (const x of ((d && d.dcimSites) || [])) {
      const k = String(x.id);
      idx.set(k, (idx.has(k) && idx.get(k) !== s.id) ? null : s.id);
    }
  }
  return idx;
}

/**
 * Legge da NetBox le linee WAN di questa sede e le AGGIUNGE.
 *
 * Stessa forma del bottone «Reti dal progetto», e per lo stesso motivo:
 * **additivo**. Quello che c'era scritto a mano resta dov'è — qui non c'è modo
 * di distinguere una riga scritta ieri da una presa dal DCIM, e un pulsante che
 * rimpiazza una lista è un pulsante che, premuto per sbaglio, cancella il lavoro
 * di qualcuno.
 *
 * L'AMBITO non lo sceglie chi guarda: lo dice il progetto della sede, che
 * registra da quale sito NetBox è nato (`state.source.dcim.sites`). Un progetto
 * scritto a mano non ne ha, e allora non c'è niente da chiedere: si dice, invece
 * di leggere tutto NetBox e far finta che riguardi questa sede.
 */
async function _wanFromDcim(i) {
  const s = _sites()[i];
  if (!s || _st.wanBusy) return;
  if (!s.projectRef) { showAlert(t('org.netsNoProject')); return; }
  const data = await _fetchProject(s.projectRef);
  if (data === null) { showAlert(t('org.projectUnreadable')); return; }
  if (!data.dcimSites.length) { showAlert(t('org.wanNoOrigin')); return; }

  _st.wanBusy = true; _render();
  let esito = null, errore = '';
  try {
    const r = await fetch('/api/integrations/dcim/wan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteIds: data.dcimSites.map(x => x.id) }),
    });
    const j = await r.json().catch(() => null);
    if (r.status === 403) errore = t('org.saveForbidden');
    else if (!r.ok || !j) errore = t('org.wanFailed') + ' ' + String((j && j.error) || ('HTTP ' + r.status));
    else esito = j;
  } catch (e) {
    errore = t('org.wanFailed') + ' ' + String((e && e.message) || e);
  }
  _st.wanBusy = false;
  if (errore) { _render(); showAlert(errore); return; }

  // Le ALTRE sedi servono solo ai collegamenti, e si leggono adesso: scaricarle
  // prima avrebbe pagato dei progetti anche quando la lettura fallisce.
  await _warmProjects(_sites().map(x => x.projectRef));
  _mergeWan(s, esito);
  // L'esito si legge nella scheda della sede da cui si è partiti: è lì che stanno le sue linee.
  _st.tab = 'wan'; _st.selSite = s.id;
  _render();
}

/** L'innesto vero e proprio. Puro rispetto alla rete: prende ciò che il server
 *  ha mappato e decide che cosa entra, che cosa c'era già e che cosa non si può
 *  mettere da nessuna parte — e quest'ultima categoria si DICE. */
function _mergeWan(site, j) {
  const cache = _st.projectData.get(String(site.projectRef));
  const nostri = new Set(((cache && cache.dcimSites) || []).map(x => String(x.id)));
  const perNb = _siteByNetboxId();
  const notes = ((j && j.notes) || []).slice();

  const uplinkCand = (j && j.uplinks) || [];
  const visti = new Set(_uplinks().filter(u => u.siteId === site.id).map(u => _wanKey(u.provider, u.circuitId)));
  let added = 0, already = 0;
  for (const c of uplinkCand) {
    if (!nostri.has(String(c.netboxSiteId))) { notes.push({ code: 'wan.otherSite', circuitId: c.circuitId, site: c.netboxSiteName }); continue; }
    const k = _wanKey(c.provider, c.circuitId);
    if (visti.has(k)) { already++; continue; }
    visti.add(k);
    _uplinks().push({
      id: uid('wan'), siteId: site.id,
      provider: c.provider || '', serviceType: c.serviceType || '', circuitId: c.circuitId || '',
      cirMbps: c.cirMbps == null ? null : c.cirMbps,
      // ⚠️ Questi due NON si riempiono: l'SLA non sta in NetBox, e gli indirizzi
      // pubblici non si deducono dall'IP di un'interfaccia WAN — dietro a una
      // linea business ci sono NAT e blocchi instradati, e scriverne uno
      // sbagliato in un campo dichiarato è peggio di lasciarlo vuoto.
      // ㉑ E con loro i sei campi del ripristino: NetBox non ha un next-hop, un
      // tag di consegna né un MTU di consegna, e dedurli sarebbe una
      // corrispondenza, non un'identità (paletto ②). Li scrive chi documenta.
      publicIps: null,
      // ⑥ La porta WAN invece SI riempie, e prima non lo faceva: NetBox dice su
      // quale interfaccia arriva il circuito (il cavo dalla terminazione va lì),
      // l'import la risolveva davvero — lo smoke quattro-sedi lo pretende per
      // OGNI uplink — e poi la lasciava cadere qui, così il dossier stampava un
      // trattino su una risposta che l'applicazione aveva in mano.
      // `declared` e non `measured`: NetBox è un archivio di dichiarazioni, e
      // seguire il cavo è LEGGERE quella dichiarazione, non misurare la rete.
      wanIfRef: c.wanIf ? factDeclared(c.wanIf) : null,
    });
    added++;
  }

  const linkCand = (j && j.links) || [];
  let addedLinks = 0, alreadyLinks = 0;
  for (const c of linkCand) {
    const a = perNb.get(String(c.aNetboxSiteId));
    const b = perNb.get(String(c.bNetboxSiteId));
    if (!a || !b) {
      // Il capo lontano non è una sede di questa organizzazione (o è ambiguo):
      // un collegamento ha bisogno di DUE sedi, e inventarne una sarebbe peggio.
      notes.push({ code: 'wan.farSiteUnknown', circuitId: c.circuitId, site: a ? c.bNetboxSiteName : c.aNetboxSiteName });
      continue;
    }
    if (a === b) { notes.push({ code: 'wan.samePairSite', circuitId: c.circuitId }); continue; }
    // L'identità di un collegamento importato è ciò che di lui viene SCRITTO: il
    // nome, il codice del circuito e l'operatore. Un candidato che non porta
    // niente di distinguibile (capita ai `circuits`, che non hanno un nome) si
    // riconosce comunque dal codice, che in NetBox è obbligatorio.
    const chiave = _linkKey(c.name, c.provider, c.circuitId, c.transportLabel);
    const dup = _links().some(l => _linkKey(l.name, l.provider, l.circuitId, l.transportLabel) === chiave
      && ((l.aSiteId === a && l.bSiteId === b) || (l.aSiteId === b && l.bSiteId === a)));
    if (dup) { alreadyLinks++; continue; }
    // La natura la porta il candidato: dai `circuits` è sempre `other` (il tipo
    // è testo libero dell'istanza), da `vpn/` è quella vera, perché là il
    // vocabolario di NetBox è chiuso quanto il nostro.
    // ㉔ Il candidato porta già i DUE assi: NetBox li tiene separati alla
    // sorgente (`l2vpn.type` ≠ `tunnel.encapsulation`), e l'import ha smesso di
    // schiacciarli in uno.
    const transport = INTER_SITE_TRANSPORTS.indexOf(c.transport) >= 0 ? c.transport : null;
    const tunnel = INTER_SITE_TUNNELS.indexOf(c.tunnel) >= 0 ? c.tunnel : null;
    const row = {
      id: uid('isl'), aSiteId: a, bSiteId: b,
      transport, tunnel,
      transportLabel: transport === 'other' ? (c.transportLabel || null) : null,
      tunnelLabel: tunnel === 'other' ? (c.tunnelLabel || null) : null,
      name: c.name || null,
      state: null,
      // ⑧ di `lib/dcim-vpn.js` — le reti raggiungibili a ciascun capo, quando
      // l'archivio le dichiara: oggi solo un servizio L2 appeso a una VLAN, perché
      // per i tunnel NetBox non modella l'encryption domain e per i circuiti non
      // modella le reti trasportate. Prima qui c'era `null` fisso, e due controlli
      // dell'audit si dichiaravano ciechi su OGNI progetto importato.
      // `declared` e non `derived`: seguire il campo `vlan` di un prefisso è LEGGERE
      // una dichiarazione dell'archivio, non calcolarla da roba nostra — è la stessa
      // ragione già scritta qui sopra per `wanIfRef`, che segue un cavo.
      // ⚠️ `null` se nessuno dei due capi porta niente: un `reach` assente è «non lo
      // sappiamo», e `{a:[],b:[]}` sarebbe «non raggiunge niente».
      reach: (c.aReach && c.aReach.length) || (c.bReach && c.bReach.length)
        ? factDeclared({ a: c.aReach || [], b: c.bReach || [] })
        : null,
      provider: c.provider || null, circuitId: c.circuitId || null,
      // ⑳ Vuoto, e non dedotto: nessun import sa su quale linea corre un tunnel
      // (paletto ②). Far combaciare `peerIp` con un `publicIps` è una
      // corrispondenza, non un'identità — e sull'archivio vero non ne combacia
      // nemmeno una. Lo dichiara chi documenta, con le caselle del pannello.
      underlayUplinkIds: [],
      endpointA: { deviceRef: null, deviceName: null, peerIp: c.aPeerIp || null },
      endpointB: { deviceRef: null, deviceName: null, peerIp: c.bPeerIp || null },
    };
    // Il nome dell'apparato diventa un RIFERIMENTO solo se combacia con uno solo
    // del progetto di quella sede: la regola è già scritta lì, e qui si chiama.
    _setEndpointDevice(row, 'endpointA', a, c.aDeviceName || '');
    _setEndpointDevice(row, 'endpointB', b, c.bDeviceName || '');
    _links().push(row);
    addedLinks++;
  }

  _st.wanReport = {
    siteName: site.name, fetchedAt: (j && j.fetchedAt) || null,
    added, total: uplinkCand.length, already,
    addedLinks, totalLinks: linkCand.length, alreadyLinks,
    // ⑱ Il censimento dei tipi arriva dal server e si porta avanti tale e
    // quale: è un verbale, e riscriverlo qui vorrebbe dire tenere una seconda
    // copia della stessa regola — quella che decide la tecnologia — in un
    // posto dove non ci sono gli slug per applicarla.
    types: (j && j.types) || [],
    notes,
  };
  if (added || addedLinks) _touch();
}

/**
 * Togliere una sede lascia orfani i suoi uplink e i suoi collegamenti. NON si
 * cancellano a cascata di nascosto: si dice quanti sono e si chiede conferma —
 * e chi conferma li vede sparire insieme, il che è diverso dallo scoprirlo dopo.
 */
function _removeSite(i) {
  const s = _sites()[i];
  if (!s) return;
  const orphU = _uplinks().filter(u => u.siteId === s.id).length;
  const orphL = _links().filter(l => l.aSiteId === s.id || l.bSiteId === s.id).length;
  const ask = (orphU || orphL)
    ? t('org.confirmRemoveSiteWith').replace('{n}', String(orphU + orphL))
    : t('org.confirmRemoveSite');
  showConfirm(ask.replace('{name}', s.name), () => {
    _st.org.sites = _sites().filter((_, k) => k !== i);
    _st.org.uplinks = _uplinks().filter(u => u.siteId !== s.id);
    _st.org.links = _links().filter(l => l.aSiteId !== s.id && l.bSiteId !== s.id);
    if (_st.selSite === s.id) _st.selSite = '';      // la scheda di una sede che non c'è più non si mostra
    _st.dirty = true; _render();
  });
}

// ── Mappa (⑤: le coordinate arrivano dal modulo puro) ─────────────────────

// ⑲ Un'icona per natura, così le famiglie si riconoscono a colpo d'occhio: i
// tunnel hanno un'idea di chiusura o di percorso, i servizi un'idea di rete,
// il fisico una di filo.
const TRANSPORT_ICON = {
  internet: 'fa-globe',
  mpls: 'fa-network-wired', vpls: 'fa-diagram-project', vpws: 'fa-circle-nodes',
  vxlan: 'fa-layer-group', evpn: 'fa-sitemap',
  directLink: 'fa-grip-lines', other: 'fa-circle-question',
};
const TUNNEL_ICON = {
  ipsec: 'fa-lock', gre: 'fa-route', wireguard: 'fa-shield-halved',
  openvpn: 'fa-key', l2tp: 'fa-arrows-left-right',
  sdwan: 'fa-cloud-bolt', other: 'fa-circle-question',
};
/** ㉔ L'icona di un collegamento: vince il TUNNEL quando c'è, perché è la cosa
 *  che ci corre sopra ed è quella che si va a rimettere su. Senza tunnel parla
 *  il trasporto; senza nessuno dei due, il filo generico. */
function _natureIcon(l) {
  if (!l) return 'fa-link';
  if (l.tunnel && l.tunnel !== 'none' && TUNNEL_ICON[l.tunnel]) return TUNNEL_ICON[l.tunnel];
  return TRANSPORT_ICON[l.transport] || 'fa-link';
}

/**
 * Come si CHIAMA un collegamento, a schermo. Per le nature del vocabolario è la loro
 * parola; per `other` (⑨) sono le parole di chi l'ha documentato — «FWA
 * punto-punto» dice qualcosa, «Altro» no. Sta in una funzione sola perché la
 * mappa, l'intestazione della riga e l'audit devono dire lo stesso nome: due
 * posti che lo compongono da soli sono il modo in cui divergono.
 */
function _natureText(l) {
  if (!l) return '';
  const tr = l.transport === 'other' ? (l.transportLabel || t('org.transport.other'))
    : l.transport ? t('org.transport.' + l.transport) : null;
  const tu = l.tunnel === 'other' ? (l.tunnelLabel || t('org.tunnel.other'))
    : (l.tunnel && l.tunnel !== 'none') ? t('org.tunnel.' + l.tunnel) : null;
  // ㉔ «IPsec su MPLS»: è la frase che un tecnico dice davvero, e con un campo
  // solo non si poteva scrivere. Quando ce n'è uno solo si dice quello; quando
  // non c'è niente si DICE che non c'è, invece di lasciare un vuoto che si legge
  // come un difetto del disegno.
  if (tu && tr) return t('org.natureOver').replace('{tunnel}', tu).replace('{transport}', tr);
  if (tu || tr) return tu || tr;
  if (l.tunnel === 'none') return t('org.tunnel.none');
  return t('org.natureUnspoken');
}
const ROLE_ICON = { hub: 'fa-star', spoke: 'fa-circle-dot', standalone: 'fa-building' };

/** Lo stato di un collegamento, come classe CSS: il valore dice cosa, l'origine
 *  dice chi lo afferma — e sono due cose diverse, quindi due attributi diversi. */
function _edgeStateAttrs(link) {
  if (!link || !isFact(link.state)) return { cls: 'is-unspoken', title: t('org.stateUnspoken') };
  const v = factValue(link.state);
  const origin = factOrigin(link.state);
  return {
    cls: 'is-' + v + (origin === 'measured' ? ' is-measured' : ' is-declared'),
    title: t('org.state' + (v === 'up' ? 'Up' : 'Down')) + ' · ' + t('org.origin.' + origin),
  };
}

/** «1 rete» / «3 reti». Il singolare non è un dettaglio di stile: un'etichetta
 *  che dice «1 reti» fa dubitare del resto di ciò che c'è scritto sopra. */
function _netsLabel(n) {
  return n + ' ' + t(n === 1 ? 'org.netsOne' : 'org.netsShort');
}

// ── ⑩ Il contenuto del riquadro di una sede ───────────────────────────────
// La geometria la decide `lib/inter-site-layout.js`; COSA c'è scritto dentro lo
// decide qui, perché è l'unico posto che sa in che lingua si sta parlando.

/** Le righe di misura del riquadro: quanto è alto lo dice il NUMERO di righe (che
 *  è un dato), quanto è largo lo dirà il testo misurato. Costanti di geometria,
 *  non di stile: il font sta nel CSS. */
// ⚠️ L'imbottitura è stata STRETTA (era 15/13): il riquadro è il pezzo grosso
// della mappa, e ogni pixel che si prende lo toglie al collegamento — che è
// l'altra metà di quello che la mappa deve raccontare. Segnalato guardandola:
// «il collegamento si vede ancora poco, riduci un po' i riquadri».
const BOX = { padX: 11, padY: 10, nameH: 20, lineH: 15, maxUplinks: 3 };

/**
 * Le righe di testo dentro il riquadro di una sede: il nome, poi ogni linea WAN
 * con il suo operatore, il tipo di servizio e gli indirizzi pubblici, e infine
 * quante reti ha la sede.
 *
 * ⚠️ Con molte linee il riquadro crescerebbe senza fine: se ne mostrano al più
 * `maxUplinks` e le altre si CONTANO. Un elenco troncato in silenzio direbbe
 * «queste sono tutte»; «+2 altre» dice quante ne restano.
 */
function _nodeLines(n) {
  const righe = [{ text: n.name, cls: 'org-node-name' }];
  const mie = (n.uplinkIds || []).map(id => _uplinks().find(u => u.id === id)).filter(Boolean);
  for (const u of mie.slice(0, BOX.maxUplinks)) {
    const testa = [u.provider || t('org.uplinkNoProvider'), u.serviceType].filter(Boolean).join(' · ');
    righe.push({ text: testa, cls: 'org-node-wan' });
    const ips = isFact(u.publicIps) ? (factValue(u.publicIps) || []) : [];
    if (ips.length) righe.push({ text: ips.join('  '), cls: 'org-node-ip' });
  }
  if (mie.length > BOX.maxUplinks) {
    righe.push({ text: t('org.moreUplinks').replace('{n}', String(mie.length - BOX.maxUplinks)), cls: 'org-node-wan' });
  }
  if (!mie.length) righe.push({ text: t('org.noUplinkShort'), cls: 'org-node-wan' });
  righe.push({ text: n.subnets ? _netsLabel(n.subnets) : t('org.noNets'), cls: 'org-node-sub' });
  const dentro = _contentLabel(n.projectRef);
  if (dentro) righe.push({ text: dentro, cls: 'org-node-in' });
  return righe;
}

/**
 * Cosa c'è DENTRO la sede: il conto di apparati e rack del progetto collegato.
 * È l'anteprima del gradino sotto — si vede quanto pesa una sede prima di
 * entrarci, e un riquadro senza questa riga dice a colpo d'occhio che lì il
 * progetto non c'è ancora.
 *
 * ⚠️ Tre casi diversi, e due di essi devono restare MUTI:
 *   • nessun `projectRef`, o riferimento a un progetto sparito → niente riga
 *     (l'audit lo segnala già come tale: non è compito del riquadro accusare);
 *   • progetto collegato ma conteggi `null` (un JSON senza `state`, importato da
 *     una versione vecchia) → niente riga. Scrivere «0 apparati» sarebbe un
 *     ripiego indistinguibile da una misura, e direbbe che la sede è vuota.
 * Solo il terzo caso — conteggi veri — parla.
 *
 * I numeri li calcola il SERVER in `listProjects()` con la stessa denylist
 * strutturale del resto del backend: qui non si ricontano i nodi, o sarebbe la
 * n-esima definizione doppia motore↔renderer.
 */
function _contentLabel(projectRef) {
  if (!projectRef) return '';
  const p = _st.projects.find(x => String(x.id) === String(projectRef));
  if (!p || p.devices == null) return '';
  const parti = [p.devices + ' ' + t(p.devices === 1 ? 'org.boxDeviceOne' : 'org.boxDevices')];
  // I rack sono facoltativi: una sede tutta a muro non ne ha, e «0 rack» è un
  // dato vero ma inutile accanto agli apparati. Si nomina solo se ce n'è almeno uno.
  if (p.racks) parti.push(p.racks + ' ' + t(p.racks === 1 ? 'org.boxRackOne' : 'org.boxRacks'));
  return parti.join(' · ');
}

/** L'altezza del riquadro dal NUMERO di righe — che è un dato, non una misura. */
function _boxHeight(righe) {
  return BOX.padY * 2 + BOX.nameH + (righe.length - 1) * BOX.lineH;
}

/**
 * Le larghezze VERE dei riquadri, lette dall'SVG già disegnato.
 *
 * ④ Il modulo puro non misura il testo, e chi disegna non copia i font dal CSS
 * (sarebbe la definizione doppia che diverge al primo restyle): si disegna una
 * prima volta con la misura dichiarata, si chiede a `getBBox()` quanto sono
 * larghe le righe DAVVERO, e si ridisegna con quelle. Due passate, e la seconda
 * è esatta perché misura il testo reso, non una stima.
 */
function _measureBoxes(svg) {
  /** @type {Record<string, {w:number, h:number}>} */
  const box = Object.create(null);
  if (!svg) return null;
  for (const g of svg.querySelectorAll('.org-node')) {
    const id = g.dataset.site;
    if (!id) continue;
    let max = 0;
    for (const t2 of g.querySelectorAll('text')) {
      try { max = Math.max(max, t2.getBBox().width); } catch (_) { return null; }
    }
    if (!max) return null;                  // non ancora impaginato: si tiene il primo giro
    const alt = Number(g.dataset.boxh) || 0;
    box[id] = { w: max + BOX.padX * 2, h: alt };
  }
  if (!Object.keys(box).length) return null;
  // ⚠️ Si misura anche l'ETICHETTA DEGLI ARCHI, e non è un di più: lo spazio fra
  // due riquadri è dove quella pastiglia finisce. Con lo spazio di default (56 px)
  // «Fibra spenta · 2 reti» esce da tutte e due le parti e si appoggia sopra i
  // riquadri — cioè si legge male e per giunta sembra appartenere a loro. La
  // misura la fa chi disegna, che è l'unico ad avere il font: il modulo puro
  // riceve due numeri (④).
  // Si tiene la larghezza di OGNI etichetta, non solo la massima: ognuna avrà la
  // sua pastiglia, e una pastiglia larga quanto la più lunga delle altre sarebbe
  // un riquadro vuoto attorno a una parola corta.
  /** @type {Record<string, number>} */
  const labels = Object.create(null);
  let maxLabel = 0;
  for (const t2 of svg.querySelectorAll('.org-edge-label')) {
    const id = t2.dataset.link;
    let w;
    try { w = t2.getBBox().width; } catch (_) { w = 0; }
    if (!w) continue;
    if (id) labels[id] = w;
    maxLabel = Math.max(maxLabel, w);
  }
  return {
    box, labels,
    labelW: maxLabel ? maxLabel + BADGE.padX * 2 + BADGE.margin * 2 : 0,
    labelH: maxLabel ? BADGE.h + BADGE.margin * 2 : 0,
  };
}

/** La pastiglia di un collegamento: quanto è imbottita, quanto è alta, quanto
 *  sta lontana dai due riquadri. Sono misure di DISEGNO e stanno qui, non nel
 *  modulo puro — che riceve solo l'ingombro che ne risulta. */
// ⚠️ `margin` è quanta LINEA resta scoperta di qua e di là dalla pastiglia. Con
// 12 la pastiglia sembrava appoggiata fra due riquadri senza niente che la
// tenesse: un collegamento si legge dal filo, non dall'etichetta. Alzarlo
// allarga la fessura fra le sedi, e quindi la parte di linea che si vede.
const BADGE = { padX: 9, h: 20, r: 10, margin: 30 };

/** Un numero pronto per un attributo SVG, senza code di virgola. */
const _n = (v) => Math.round(Number(v) * 100) / 100;

function _renderMap(m) {
  const opts = m ? { boxOf: (id) => m.box[id] || null } : null;
  // Lo spazio non si RESTRINGE mai sotto il default: è il modulo puro a tenere
  // il minimo, qui si dice solo quanto serve IN PIÙ per la pastiglia.
  if (opts && m.labelW) { opts.labelW = m.labelW; opts.labelH = m.labelH; }
  // ⑰ E la misura di OGNI pastiglia, che è il testo più il suo bordo: è la
  // pastiglia a non doversi sovrapporre, non il testo dentro.
  if (opts && m.labels) {
    opts.labelOf = (id) => {
      const w = m.labels[id];
      return w ? { w: w + BADGE.padX * 2, h: BADGE.h } : null;
    };
  }
  const L = buildInterSiteLayout(_st.org, opts || undefined);
  if (L.layout === 'empty') return _mapEmptyHtml();
  const byId = Object.create(null);
  for (const n of L.nodes) byId[n.siteId] = n;
  const linkById = Object.create(null);
  for (const l of _links()) linkById[l.id] = l;

  // Le coordinate arrivano dal modulo puro, che le arrotonda: il `Number()` qui
  // sotto rende quella garanzia LOCALE, nel punto in cui il numero smette di
  // essere un numero e diventa testo dentro un attributo SVG.
  const edges = L.edges.map(e => {
    const l = linkById[e.linkId];
    const st = _edgeStateAttrs(l);
    const nets = isFact(l && l.reach) ? factValue(l.reach) : null;
    const carried = nets ? (nets.a.length + nets.b.length) : 0;
    // ㉗ Sulla pastiglia c'è anche CHI la vende. Sulla mappa un arco si guarda
    // per capire in fretta che cos'è, e la natura da sola non basta: fra Milano
    // e Roma corrono tre collegamenti, e «VXLAN» non dice quale contratto
    // guardare quando è giù. L'ordine è lo stesso con cui i tile scrivono già le
    // loro linee — «TIM · MPLS» — perché due posti che dicono la stessa cosa in
    // due ordini diversi si leggono come due cose diverse.
    // ⚠️ L'operatore c'è su 3 collegamenti su 8: manca su tutto ciò che non si
    // compra da nessuno. Si compone per FILTRO, così quando non c'è non resta
    // un separatore appeso a niente.
    const label = [l && l.provider, _natureText(l), carried ? _netsLabel(carried) : null]
      .filter(Boolean).join(' · ');
    // ⑫ La PASTIGLIA: si disegna solo quando la larghezza del testo è nota, cioè
    // dalla seconda passata. Al primo giro resta il solo testo con il suo alone —
    // una pastiglia di larghezza indovinata sarebbe un rettangolo che non
    // contiene le parole, che è peggio del rettangolo che manca.
    const lw = (m && m.labels && m.labels[e.linkId]) || 0;
    const chip = lw ? `<rect class="org-edge-badge" x="${_n(e.mx - lw / 2 - BADGE.padX)}" y="${_n(e.my - BADGE.h / 2)}"
        width="${_n(lw + BADGE.padX * 2)}" height="${_n(BADGE.h)}" rx="${_n(BADGE.r)}"/>` : '';
    // ⑭ La pastiglia è un BOTTONE, e porta alla riga di QUEL collegamento.
    // La domanda che si fa guardando la mappa — «questo qui che cos'è?» — aveva
    // come risposta tre passaggi: cambia scheda, scorri, riconosci la riga fra
    // le altre dai due nomi. Che è di nuovo il problema da cui si era partiti.
    // ⚠️ Cliccabile è la pastiglia, NON l'arco. Il filo è spesso due pixel e
    // prenderlo col mouse è un tiro; e un arco sensibile per tutta la sua
    // lunghezza ruba il clic destinato alla sede che ci passa vicino.
    return `<g class="org-edge ${escapeHTML(st.cls)}">
      <title>${escapeHTML(_siteName(e.aSiteId) + ' ↔ ' + _siteName(e.bSiteId) + ' · ' + st.title)}</title>
      <path d="${interSiteEdgePath(e)}" class="org-edge-line"/>
      ${st.cls.indexOf('is-up') >= 0 ? `<path d="${interSiteEdgePath(e)}" class="org-edge-flow"/>` : ''}
      <g class="org-edge-chip" data-act="org-link" data-keydown="org-activate" data-link="${escapeHTML(String(e.linkId))}"
         tabindex="0" role="button" aria-label="${escapeHTML(t('org.editLink').replace('{link}', _linkName(e.linkId)))}">
        ${chip}
        <text x="${Number(e.mx)}" y="${Number(e.my)}" data-link="${escapeHTML(String(e.linkId))}"
              class="org-edge-label" text-anchor="middle" dominant-baseline="central">${escapeHTML(label)}</text>
      </g>
    </g>`;
  }).join('');

  const nodes = L.nodes.map(n => {
    const linked = n.projectRef && _st.projects.some(p => String(p.id) === String(n.projectRef));
    const righe = _nodeLines(n);
    const x0 = n.x - n.w / 2 + BOX.padX;          // testo allineato a SINISTRA: i CIDR
    let y = n.y - n.h / 2 + BOX.padY + 13;        // si leggono incolonnati, non centrati
    const testi = righe.map((r, i) => {
      const el = `<text x="${Number(x0)}" y="${Number(y)}" class="${escapeHTML(r.cls)}">${escapeHTML(r.text)}</text>`;
      y += (i === 0 ? BOX.nameH : BOX.lineH);
      return el;
    }).join('');
    // ⑯ Il bordo porta lo STATO della sede: rosso incoerenza, giallo lacuna,
    // verde nessun rilievo — gli stessi tre colori delle pastiglie in cima.
    // ⚠️ Tranne una sede SENZA progetto agganciato, che resta grigia e non
    // dichiara niente. Prima era tratteggiata, e il tratteggio su un riquadro
    // pieno di testo si legge come un difetto di disegno, non come un'assenza.
    // La salute di quella sede non sparisce: resta scritta nel titolo.
    const h = _siteHealth(n.siteId);
    return `<g class="org-node ${linked ? 'is-linked' : 'is-unlinked'}${h ? ' ' + h.cls : ''}" data-act="org-node" data-keydown="org-activate" data-site="${escapeHTML(n.siteId)}" data-boxh="${Number(_boxHeight(righe))}" tabindex="0" role="button">
      <title>${escapeHTML(n.name + ' · ' + t('org.role.' + n.role) + (linked ? '' : ' · ' + t('org.noProject')) + (h ? ' · ' + h.title : ''))}</title>
      <rect x="${Number(n.x - n.w / 2)}" y="${Number(n.y - n.h / 2)}" width="${Number(n.w)}" height="${Number(n.h)}" rx="10" class="org-node-box"/>
      ${n.role === 'hub' ? `<text x="${Number(n.x + n.w / 2 - BOX.padX)}" y="${Number(n.y - n.h / 2 + BOX.padY + 13)}" class="org-node-icon" text-anchor="end">★</text>` : ''}
      ${testi}
    </g>`;
  }).join('');

  const warn = (L.undrawable.links.length || L.undrawable.uplinks.length)
    ? `<p class="org-warn"><i class="fas fa-triangle-exclamation"></i> ${escapeHTML(
      t('org.undrawable')
        .replace('{l}', String(L.undrawable.links.length))
        .replace('{u}', String(L.undrawable.uplinks.length)))}</p>`
    : '';

  // ㉖ Tutto il disegno sta in UN gruppo, ed è quello che si sposta e si
  // ingrandisce: il `viewBox` resta l'inquadratura «tutto dentro» calcolata da
  // `_fitMapViewBox`, e le due cose non si contendono lo stesso numero.
  return `<div class="org-map-wrap">
    <div class="org-map-frame">
    <svg class="org-map" viewBox="0 0 ${Number(L.width)} ${Number(L.height)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHTML(t('org.mapAria'))}">
      <g class="org-map-zoom">${edges}${nodes}</g>
    </svg>
    <div class="zoom-controls org-map-zoom-ctl">
      <button class="zoom-btn" type="button" data-act="org-zoom" data-delta="-0.2" title="${escapeHTML(t('org.zoomOut'))}" aria-label="${escapeHTML(t('org.zoomOut'))}"><i class="fas fa-minus"></i></button>
      <button class="zoom-label" type="button" id="org-map-zoom-lbl" data-act="org-zoom-fit" title="${escapeHTML(t('org.zoomFit'))}">100%</button>
      <button class="zoom-btn" type="button" data-act="org-zoom" data-delta="0.2" title="${escapeHTML(t('org.zoomIn'))}" aria-label="${escapeHTML(t('org.zoomIn'))}"><i class="fas fa-plus"></i></button>
    </div>
    </div>
    <p class="org-map-hint">${escapeHTML(L.layout === 'hub' ? t('org.layoutHub') : t('org.layoutRing'))} · ${escapeHTML(t('org.clickSite'))}${
      // Un'istruzione per una mossa che a schermo non c'è è un'istruzione che
      // fa cercare qualcosa di inesistente: la pastiglia si nomina solo se
      // almeno un arco è disegnato.
      L.edges.length ? ' · ' + escapeHTML(t('org.clickLink')) : ''} · ${escapeHTML(t('org.mapZoomHint'))}</p>
    ${warn}
  </div>`;
}

// ── La mappa con le strade: le sedi dove sono ─────────────────────────────
//
// La stessa scheda Mappa, in due modi: lo SCHEMA dice come sono legate le sedi, la
// MAPPA dice dove sono — su una carta vera, con le strade di OpenStreetMap e un
// cerchio per ogni sede. Cosa mettere sulla carta lo decide `lib/inter-site-geo-map.js`
// (puro e testato); qui si traduce in Leaflet. Le tessere NON le chiede il browser a
// un terzo: arrivano da `/api/tiles/{z}/{x}/{y}.png`, cioè dal nostro server (CSP
// `img-src 'self'`, e il README promette «nessun cloud»).

/** Il selettore carta/schema, sul bordo sinistro del centro: due bottoni a icona, come i comandi
 *  dello zoom, e il nome per esteso nel titolo e nell'etichetta (un'icona sola non è un nome). */
function _mapModeBar() {
  const b = (mode, icon, key) => `<button type="button" class="ms-mode${_st.mapMode === mode ? ' active' : ''}"
      data-act="org-map-mode" data-mode="${escapeHTML(mode)}" aria-pressed="${_st.mapMode === mode ? 'true' : 'false'}"
      title="${escapeHTML(t(key))}" aria-label="${escapeHTML(t(key))}"><i class="fas ${escapeHTML(icon)}"></i></button>`;
  return `<div class="ms-modes" role="group" aria-label="${escapeHTML(t('org.mapModeAria'))}">
    ${b('geo', 'fa-map', 'org.mapModeGeo')}${b('schema', 'fa-sitemap', 'org.mapModeSchema')}</div>`;
}

/** Il pannello senza nemmeno una sede: l'invito ad aggiungerne una. */
function _mapEmptyHtml() {
  return `<div class="org-empty">
      <i class="fas fa-sitemap org-empty-icon"></i>
      <p class="org-empty-title">${escapeHTML(t('org.emptyTitle'))}</p>
      <p class="org-empty-sub">${escapeHTML(t('org.emptySub'))}</p>
      ${_isAdmin() ? `<button class="um-btn primary" data-act="org-add-site"><i class="fas fa-plus"></i> ${escapeHTML(t('org.addSite'))}</button>` : ''}
    </div>`;
}

/** Ciò che la mappa NON mostra, e perché (②): le sedi senza posizione e i collegamenti
 *  che ne dipendono. Una mappa a cui sparisce una sede senza dirlo è peggio di una
 *  che ne mostra il buco. */
function _geoMapWarn(model) {
  const righe = [];
  if (model.unplaced.length) {
    righe.push(t('org.geoUnplaced').replace('{n}', String(model.unplaced.length)).replace('{names}', model.unplaced.map(x => x.name).join(', ')));
  }
  const conta = (reason) => model.cut.filter(x => x.reason === reason).length;
  if (conta('unplaced')) righe.push(t('org.geoLinksUnplaced').replace('{n}', String(conta('unplaced'))));
  if (conta('same-point')) righe.push(t('org.geoLinksClose').replace('{n}', String(conta('same-point'))));
  return righe.map(r => `<p class="org-warn"><i class="fas fa-triangle-exclamation"></i> ${escapeHTML(r)}</p>`).join('');
}

/** Ciò che la carta NON mostra, sul bordo in basso a sinistra: le sedi senza punto (con il
 *  bottone che porta a darglielo) e i collegamenti che ne dipendono. Se nessuna sede ha un
 *  punto la carta resta com'è — l'Italia senza cerchi — e questo riquadro dice perché. */
function _renderUnplaced() {
  const host = _el('ms-unplaced');
  if (!host) return;
  if (_st.mapMode !== 'geo' || !_sites().length) { host.innerHTML = ''; return; }
  const model = buildGeoMapModel(_st.org);
  const warn = _geoMapWarn(model);
  if (!warn) { host.innerHTML = ''; return; }
  const prima = model.unplaced[0];
  host.innerHTML = `${warn}${prima && _isAdmin()
    ? `<button type="button" class="um-btn ms-place" data-act="ms-pick-site" data-site="${escapeHTML(prima.siteId)}"><i class="fas fa-location-crosshairs"></i> ${escapeHTML(t('ms.place'))}</button>`
    : ''}`;
}

/** Leaflet, caricato quando serve: la libreria sta in `vendor/leaflet` (self-hosted,
 *  come Font Awesome) e un pannello che non apre mai la mappa non la scarica. */
let _leafletPromise = null;
function _loadLeaflet() {
  if (globalThis.L && globalThis.L.map) return Promise.resolve(globalThis.L);
  if (_leafletPromise) return _leafletPromise;
  _leafletPromise = new Promise((resolve, reject) => {
    const falla = () => { _leafletPromise = null; reject(new Error('leaflet')); };
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/vendor/leaflet/leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = '/vendor/leaflet/leaflet.js';
    js.onload = () => (globalThis.L && globalThis.L.map ? resolve(globalThis.L) : falla());
    js.onerror = falla;
    document.head.appendChild(js);
  });
  return _leafletPromise;
}

/** Se lo sfondo c'è, e quale attribuzione scrivere. Un guasto qui non è un guasto del
 *  pannello: la mappa resta una mappa senza sfondo. @type {Promise<any>|null} */
let _tilesStatusPromise = null;
function _loadTilesStatus() {
  if (!_tilesStatusPromise) {
    _tilesStatusPromise = fetch('/api/tiles/status', { headers: { Accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : null)).catch(() => null);
  }
  return _tilesStatusPromise;
}

/** La mappa viva, se c'è. Si butta a ogni ridisegno del pannello e alla chiusura:
 *  una Leaflet lasciata attaccata a un contenitore che non esiste più perde memoria. */
let _geoMap = null;
/** I due livelli della mappa viva: i collegamenti (sotto) e i cerchi (sopra, si rifanno a ogni zoom). */
let _geoLines = null;
let _geoPins = null;
/** Un numero che cresce a ogni sincronizzazione e a ogni distruzione: una sincronizzazione in
 *  volo (la libreria sta arrivando) che trova un numero diverso dal suo non disegna più. */
let _geoTok = 0;
function _destroyGeoMap() {
  _geoTok++;
  if (_geoMap) {
    // ⚠️ Leaflet RIMANDA lo zoom della rotella di ~40 ms (somma gli scatti) e `remove()` non cancella quel
    // timer: girare la rotella e spegnere il Multisito nello stesso istante lasciava partire lo zoom su una
    // mappa che non c'è più («Cannot read properties of undefined (reading '_leaflet_pos')»). Lo si cancella
    // prima, e si fermano le animazioni in corso (un panTo che finisce dopo la fine ha lo stesso difetto).
    // E l'animazione di ZOOM in corso (dura 250 ms) non si ferma con `stop()`: il suo timer di chiusura resta in coda e,
    // a mappa tolta, finisce su niente. Si chiude adesso, a mano — `_onZoomTransitionEnd` esce subito se non c'è nulla
    // da chiudere. (Leaflet sta in `vendor/` ed è fissato a una versione: il nome interno non cambia sotto i piedi.)
    try {
      clearTimeout(_geoMap.scrollWheelZoom && _geoMap.scrollWheelZoom._timer);
      _geoMap.stop();
      if (_geoMap._animatingZoom && typeof _geoMap._onZoomTransitionEnd === 'function') _geoMap._onZoomTransitionEnd();
    } catch (_) { /* nessun timer da cancellare */ }
    try { _geoMap.remove(); } catch (_) { /* contenitore già tolto */ }
  }
  _geoMap = null; _geoLines = null; _geoPins = null;
}

/** Un colore dal tema (`--fault-color`…), con un ripiego: Leaflet vuole un colore
 *  vero in mano, non un `var(--…)`. */
function _themeColor(nome, ripiego) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
    return v || ripiego;
  } catch (_) { return ripiego; }
}

/** Lo stato di una sede, a parole: `problem`/`gap`/`ok` dall'audit (gli stessi tre dello
 *  schema), `none` per chi non ha un progetto collegato — che non dichiara niente. */
function _siteTone(siteId, projectRef) {
  const linked = projectRef && _st.projects.some(p => String(p.id) === String(projectRef));
  const h = _siteHealth(siteId);
  if (!(linked && h)) return 'none';
  if (h.cls === 'is-problem') return 'problem';
  if (h.cls === 'is-gap') return 'gap';
  return 'ok';
}

/** Il peggiore fra più stati: un gruppo di sedi mostra il guaio che c'è dentro, non la media. */
const _TONE_RANK = { problem: 3, gap: 2, ok: 1, none: 0 };
const _worseTone = (a, b) => (_TONE_RANK[b] > _TONE_RANK[a] ? b : a);

/**
 * Il segno di un collegamento sulla carta: **il colore dice lo stato, il tratto dice il tipo.**
 * Due domande, due canali. Prima il tratto diceva lo stato (giù = tratteggiato) e il tipo
 * non lo diceva nessuno; adesso il verde è «su», il rosso è «giù», il grigio è «non
 * pronunciato», e continuo / lungo / corto / puntinato dicono se è un MPLS, una fibra o un tunnel
 * (`lib/multisite-view.js`). Lo stato «giù» ha in più un bollino con la parola, perché il rosso
 * da solo non lo legge chi non distingue i colori.
 */
function _lineStyle(link) {
  const st = _edgeStateAttrs(link);
  const k = kindStyle(connectionKind(link));
  const base = { weight: k.width, dashArray: k.dash, lineCap: k.cap, title: st.title };
  if (st.cls.indexOf('is-up') >= 0) return Object.assign(base, { color: _themeColor('--active-color', '#39d353'), state: 'up' });
  if (st.cls.indexOf('is-down') >= 0) return Object.assign(base, { color: _themeColor('--fault-color', '#f85149'), state: 'down' });
  return Object.assign(base, { color: _themeColor('--text-muted', '#8b949e'), state: 'none' });
}

/** Il punto di mezzo di una linea (per il bollino «giù»): l'elemento centrale, o la media dei due centrali. */
function _midOf(coords) {
  const n = coords.length;
  if (n % 2 === 1) return coords[(n - 1) / 2];
  const a = coords[n / 2 - 1], b = coords[n / 2];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Il segno dentro il cerchio di una sede: lo stato si legge anche senza colore. */
const _TONE_GLYPH = { problem: '▲', gap: '◐', ok: '✓', none: '–' };

/**
 * ⭐ Sincronizza la carta con ciò che c'è scritto. A differenza della vecchia scheda NON la
 * rifà da capo a ogni disegno: la mappa (e con lei le tessere, lo zoom, dove si stava
 * guardando) nasce una volta e vive finché il Multisito è acceso; qui si ridisegnano solo i
 * LIVELLI — i collegamenti e i cerchi — che costano poco. Rifarla da capo a ogni campo
 * cambiato voleva dire perdere il punto in cui si guardava a ogni tasto toccato.
 *
 * È asincrona perché la libreria arriva quando serve; se nel frattempo il centro è cambiato
 * (un'altra sincronizzazione, un'altra modalità, il Multisito spento), si lascia perdere.
 */
async function _syncGeoMap() {
  const el = _el('org-geo-map');
  if (!el) return;
  const tok = ++_geoTok;
  const note = _el('org-geo-map-note');
  const dillo = (testo) => { if (note) { note.textContent = testo; note.hidden = !testo; } };
  if (!_geoMap) dillo(t('org.geoMapLoading'));
  let L;
  try { L = await _loadLeaflet(); } catch (_) { dillo(t('org.geoMapLoadFailed')); return; }
  const status = _geoMap ? null : await _loadTilesStatus();
  if (tok !== _geoTok || !_st.view || _st.mapMode !== 'geo' || _el('org-geo-map') !== el || !el.isConnected) return;
  if (!_geoMap) { _createGeoMap(L, el, status, dillo); dillo(''); }
  _drawGeoLayers(L);
}

/** La mappa vera, una volta: sfondo, controlli, inquadratura. */
function _createGeoMap(L, el, status, dillo) {
  // Il doppio clic è di chi lo sa usare (apre la planimetria di una sede): con lo zoom
  // del doppio clic attivo, un doppio clic su un cerchio ingrandirebbe invece di aprire.
  const map = L.map(el, { zoomControl: false, worldCopyJump: true, attributionControl: true, doubleClickZoom: false });
  _geoMap = map;
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  L.control.zoom({ position: 'topleft', zoomInTitle: t('org.zoomIn'), zoomOutTitle: t('org.zoomOut') }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

  // Lo sfondo: le tessere dal NOSTRO server. Senza (spento o non raggiungibile) la
  // mappa resta com'è — le sedi e i collegamenti non dipendono dallo sfondo.
  if (status && status.enabled) {
    let errori = 0;
    // L'attribuzione è obbligatoria (ODbL) e porta al suo avviso. Il testo di un servizio
    // DIVERSO lo scrive chi lo sceglie e qui passa dall'escape: è testo, mai HTML.
    const attribuzione = status.host === 'tile.openstreetmap.org'
      ? '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      : escapeHTML(status.attribution || '');
    const tiles = L.tileLayer('/api/tiles/{z}/{x}/{y}.png', { maxZoom: status.maxZoom || 19, attribution: attribuzione });
    tiles.on('tileerror', () => { if (++errori === 4) dillo(t('org.geoMapNoTiles')); });
    tiles.on('tileload', () => { if (errori) { errori = 0; dillo(''); } });
    tiles.addTo(map);
  } else {
    dillo(t('org.geoMapNoTiles'));
  }

  // I collegamenti sotto, i cerchi sopra: il cerchio è ciò che si clicca.
  _geoLines = L.layerGroup().addTo(map);
  _geoPins = L.layerGroup().addTo(map);
  // I cerchi si RIFANNO a ogni zoom: due sedi vicine sullo schermo diventano un cerchio solo
  // col numero (come in Prospix), e si separano ingrandendo. La distanza che conta è quella in pixel.
  map.on('zoomend', () => { if (_geoMap === map) _drawPins(L); });

  // L'inquadratura: tutte le sedi, o la città di quella sola. Solo alla nascita della mappa:
  // dopo, dove si guarda lo decide chi la usa.
  const model = buildGeoMapModel(_st.org);
  if (model.fit && model.fit.bounds) {
    const b = model.fit.bounds;
    map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [70, 70], maxZoom: model.fit.maxZoom });
  } else if (model.fit) {
    map.setView(model.fit.center, model.fit.maxZoom);
  } else {
    map.setView([42.5, 12.5], 5);      // nessuna sede ha un punto: l'Italia, non il mare
  }
  // Il contenitore ha la sua misura solo dopo che la vista è impaginata: a quel punto anche
  // la distanza in pixel fra le sedi è quella vera, e i gruppi si rifanno.
  setTimeout(() => { if (_geoMap === map) { map.invalidateSize(); _drawPins(L); } }, 0);
}

/**
 * ⭐ Il cassetto si apre alla misura che serve: la scheda di un collegamento ha una ventina di campi, e a
 * un'altezza fissa se ne vedeva metà — chi apriva il Multisito doveva scorrere o trascinare la maniglia
 * per vedere ciò che era venuto a guardare.
 * Si ADATTA solo finché nessuno ha mosso la maniglia (`dockAuto`), e solo per CRESCERE: spostandosi da una
 * scheda a un'altra il cassetto non rimbalza su e giù, e la carta non si ridimensiona a ogni clic. C'è un
 * tetto (`DOCK.maxFrac`): la carta non sparisce, e se la scheda non ci sta si scorre.
 * La misura della scheda si prende dal suo ultimo elemento, non da `scrollHeight`: quest'ultimo non scende
 * mai sotto l'altezza del riquadro, e con un cassetto già alto non direbbe più quanto serve.
 */
function _fitDock() {
  if (!_st.dockAuto || !_st.dockOpen) return;
  const detail = _el('ms-detail');
  if (!detail || !detail.clientHeight || _st.tab === 'audit') return;
  const ultimo = detail.lastElementChild;
  if (!ultimo) return;
  const naturale = ultimo.getBoundingClientRect().bottom - detail.getBoundingClientRect().top + detail.scrollTop + 14;
  const serve = Math.ceil(DOCK.bar + naturale + 2);
  if (serve > _st.dockH) { _st.dockH = serve; _applyDock(); }
}

/** Il modello disegnato adesso, e i dati del tile con cui è stato filtrato. */
let _geoModel = null;
let _geoTile = null;

/** I collegamenti e i cerchi, dal documento e dal tile. */
function _drawGeoLayers(L) {
  if (!_geoMap || !_geoLines || !_geoPins) return;
  const model = buildGeoMapModel(_st.org);
  const tile = buildTile(_st.org, { hidden: _st.hiddenKinds, access: _st.accessSel });
  _geoModel = model; _geoTile = tile;
  _geoLines.clearLayers();
  const visibili = new Set(tile.visibleLinkIds);
  const linkDi = Object.create(null);
  for (const l of _links()) linkDi[l.id] = l;
  for (const ln of model.lines) {
    if (!visibili.has(ln.linkId)) continue;
    const l = linkDi[ln.linkId];
    const stile = _lineStyle(l);
    // Un bordo scuro sotto: il tratto tratteggiato e colorato si legge sulla carta chiara
    // come sullo sfondo scuro, che è la ragione per cui le carte stradali fanno lo stesso.
    // Il collegamento scelto nella tabella ha un alone ciano sotto: si trova a colpo d'occhio fra gli altri.
    if (ln.linkId === _st.selLink) L.polyline(ln.coords, { color: '#00d4ff', weight: stile.weight + 9, opacity: 0.45, lineCap: 'round', interactive: false }).addTo(_geoLines);
    L.polyline(ln.coords, { color: '#0a0e14', weight: stile.weight + 3.4, opacity: 0.55, lineCap: 'round', interactive: false }).addTo(_geoLines);
    const pl = L.polyline(ln.coords, { color: stile.color, weight: stile.weight, opacity: 0.95, dashArray: stile.dashArray, lineCap: stile.lineCap }).addTo(_geoLines);
    const nome = _siteName(ln.aSiteId) + ' ↔ ' + _siteName(ln.bSiteId);
    const etichetta = [l && l.provider, l && _natureText(l)].filter(Boolean).join(' · ');
    pl.bindTooltip(`<b>${escapeHTML(nome)}</b>${etichetta ? '<br>' + escapeHTML(etichetta) : ''}<br>${escapeHTML(stile.title)}`, { sticky: true });
    pl.on('click', () => _goToLink(ln.linkId));
    // Giù si legge anche senza il rosso: un bollino a metà tratto, con la parola.
    if (stile.state === 'down') {
      L.marker(_midOf(ln.coords), {
        icon: L.divIcon({ className: 'ms-down-wrap', html: `<span class="ms-down">${escapeHTML(t('ms.down'))}</span>`, iconSize: [44, 20], iconAnchor: [22, 10] }),
        interactive: false, keyboard: false,
      }).addTo(_geoLines);
    }
  }
  _drawPins(L);
}

/** I cerchi delle sedi (o dei gruppi). Si rifanno a ogni zoom: il raggruppamento è in pixel. */
function _drawPins(L) {
  const map = _geoMap, model = _geoModel, tile = _geoTile;
  if (!map || !model || !_geoPins) return;
  _geoPins.clearLayers();
  const GRUPPO_PX = 46;
  const sitoDi = Object.create(null);
  for (const s of _sites()) sitoDi[s.id] = s;
  const marcaDi = Object.create(null);
  for (const mk of model.markers) marcaDi[mk.siteId] = mk;
  const accesso = tile && tile.accessSiteIds ? new Set(tile.accessSiteIds) : null;
  let accessoNome = '';
  if (_st.accessSel === ACCESS_NONE) accessoNome = t('ms.accessNone');
  else if (_st.accessSel && tile) { const a = tile.accesses.find(x => x.key === _st.accessSel); accessoNome = a ? a.label : ''; }

  /** Un cerchio per una sede sola: il segno dello stato dentro, il nome accanto. */
  const cerchioSede = (mk) => {
    const s = sitoDi[mk.siteId] || {};
    const hub = mk.role === 'hub';
    const tono = _siteTone(mk.siteId, s.projectRef);
    const spenta = !!accesso && !accesso.has(mk.siteId);
    const sel = mk.siteId === _st.selSite;
    const lato = hub ? 28 : 24;
    const h = _siteHealth(mk.siteId);
    const linked = s.projectRef && _st.projects.some(p => String(p.id) === String(s.projectRef));
    // Il resto (ruolo, progetto, stato) sta nel titolo del cerchio, come sullo schema.
    const dettaglio = [mk.name, t('org.role.' + mk.role), linked ? '' : t('org.noProject'), h ? h.title : ''].filter(Boolean).join(' · ');
    const icona = L.divIcon({
      className: 'org-geo-pin-wrap', iconSize: [lato, lato], iconAnchor: [lato / 2, lato / 2],
      html: `<span class="org-geo-pin sm k-${escapeHTML(tono)}${hub ? ' is-hub' : ''}${sel ? ' is-sel' : ''}${spenta ? ' is-dim' : ''}" aria-hidden="true">${escapeHTML(_TONE_GLYPH[tono] || '')}</span>`,
    });
    const m = L.marker([mk.lat, mk.lng], { icon: icona, title: dettaglio, keyboard: false, riseOnHover: true }).addTo(_geoPins);
    // Chi ha l'accesso scelto porta il suo nome accanto al nome: si legge anche senza la differenza di opacità.
    const tag = accesso && !spenta && accessoNome ? ` <span class="ms-tag">${escapeHTML(accessoNome)}</span>` : '';
    m.bindTooltip(escapeHTML((hub ? '★ ' : '') + mk.name) + tag, {
      permanent: true, direction: 'right', offset: [lato / 2 + 2, 0], className: 'org-geo-label' + (spenta ? ' is-dim' : ''),
    });
    m.on('click', () => _pickSite(mk.siteId, false));
    m.on('dblclick', () => _openSite(mk.siteId));
  };

  /** Un cerchio per più sedi vicine: il numero, il colore del PEGGIORE, l'elenco al passaggio, e un
   *  clic ingrandisce fino a separarle. */
  const cerchioGruppo = (g) => {
    const membri = g.ids.map(id => marcaDi[id]).filter(Boolean);
    const toni = membri.map(mk => _siteTone(mk.siteId, (sitoDi[mk.siteId] || {}).projectRef));
    const peggiore = toni.reduce(_worseTone, 'none');
    const icona = L.divIcon({
      className: 'org-geo-pin-wrap', iconSize: [38, 38], iconAnchor: [19, 19],
      html: `<span class="org-geo-pin k-${escapeHTML(peggiore)}">${Number(membri.length)}</span>`,
    });
    const m = L.marker([g.lat, g.lng], { icon: icona, riseOnHover: true, keyboard: false }).addTo(_geoPins);
    m.bindTooltip(
      `<b>${escapeHTML(t('org.geoCluster').replace('{n}', String(membri.length)))}</b>`
      + membri.map(mk => `<br>${escapeHTML((mk.role === 'hub' ? '★ ' : '') + mk.name)}`).join(''),
      { direction: 'top', offset: [0, -16] });
    m.on('click', () => map.fitBounds(membri.map(mk => [mk.lat, mk.lng]), { padding: [100, 100], maxZoom: 15 }));
  };

  const voci = model.markers.map(mk => {
    const p = map.latLngToContainerPoint([mk.lat, mk.lng]);
    return { id: mk.siteId, x: p.x, y: p.y, lat: mk.lat, lng: mk.lng };
  });
  for (const g of clusterMarkers(voci, GRUPPO_PX)) {
    if (g.ids.length === 1) cerchioSede(marcaDi[g.ids[0]]); else cerchioGruppo(g);
  }
}

// ── Form ──────────────────────────────────────────────────────────────────

function _opt(v, label, sel) {
  return `<option value="${escapeHTML(v)}"${String(sel) === String(v) ? ' selected' : ''}>${escapeHTML(label)}</option>`;
}

/** Le sedi come tendina. `escludi` toglie una sede dall'elenco: sui due capi di
 *  un collegamento è ciò che impedisce di scegliere la stessa sede due volte —
 *  il modello rifiuta un collegamento di una sede con sé stessa, e farlo
 *  scartare al salvataggio significherebbe perdere la riga per dirlo dopo. */
function _siteOptions(sel, escludi) {
  return _sites().filter(s => !escludi || s.id !== escludi).map(s => _opt(s.id, s.name, sel)).join('');
}

/** Il nome del tipo di apparato, dal glossario della palette. Un tipo che non
 *  ha una voce non diventa vuoto: resta la sua sigla, che è meglio di niente. */
function _typeLabel(type) {
  const k = 'dev.' + type;
  const tradotto = t(k);
  if (tradotto !== k) return tradotto;
  return (TYPES[type] && TYPES[type].name) || type || '';
}

/**
 * Gli apparati del progetto di una sede, come tendina — la risposta a «su quale
 * scatola vado a mettere le mani», che è il motivo per cui uno apre questa mappa.
 *
 * Il riferimento salvato è l'**id** del nodo (stabile dentro il suo progetto), e
 * il nome è solo ciò che si legge: un apparato rinominato non rompe il legame,
 * e uno cancellato non sparisce in silenzio — resta come «non trovato».
 * I quattro stati del progetto (non collegato · in lettura · non leggibile ·
 * letto) hanno ognuno la sua riga: nessuno di loro è «nessun apparato».
 */
/** Gli apparati del progetto di una sede, o `null` se non se ne sa niente
 *  (nessun progetto collegato, non ancora letto, o illeggibile). */
function _devicesOf(siteId) {
  const site = _sites().find(s => s.id === siteId);
  if (!site || !site.projectRef) return null;
  const data = _st.projectData.get(String(site.projectRef));
  return (data && data.devices) || null;
}

/**
 * Il suggerimento per il campo «Apparato presso …»: gli apparati del progetto
 * della sede, quelli di bordo WAN per primi.
 *
 * ⑧ È un `<datalist>`, non una tendina chiusa: **si può anche scrivere a mano**.
 * Il CE di un MPLS è spesso la scatola dell'operatore, che nel progetto non c'è;
 * e una sede può non avere ancora un progetto. Un elenco obbligatorio avrebbe
 * reso indocumentabile proprio il caso più comune dei collegamenti d'operatore —
 * la mano è la strada base (①), l'elenco è la scorciatoia.
 */
/**
 * ㉗ Gli operatori gia' scritti, come suggerimenti — su tutt'e due i campi
 * «Operatore», quello della linea WAN e quello del collegamento.
 *
 * Il campo resta `type=text` e la tendina SUGGERISCE: e' la stessa scelta del
 * tipo di servizio (㉕) e dei dispositivi. Chiudere l'elenco renderebbe
 * indocumentabile il primo operatore locale che si presenta, e l'elenco degli
 * operatori del mondo non ce l'ha nessuno. Serve solo a non far nascere tre
 * grafie di «TIM», che a valle diventano tre operatori diversi.
 *
 * L'elenco lo costruisce `knownProviders` (lib/inter-site.js), che e' puro e
 * ha il suo banco: qui non si ri-normalizza niente — sarebbe la seconda
 * definizione della stessa cosa, che in questo progetto e' il bug ricorrente.
 *
 * ⚠️ Una `<datalist>` SOLA per tutte le righe, come la ㉕: un id ripetuto in
 * pagina e' un id che non identifica. I due pannelli non sono mai disegnati
 * insieme (`_detailHtml` ne rende uno per volta), quindi l'id resta unico
 * anche se la emettono in due.
 */
function _providerDatalist() {
  return `<datalist id="org-providers">${knownProviders(_st.org)
    .map(p => `<option value="${escapeHTML(p)}"></option>`).join('')}</datalist>`;
}

function _deviceDatalist(id, siteId) {
  const devs = _devicesOf(siteId);
  if (!devs || !devs.length) return `<datalist id="${escapeHTML(id)}"></datalist>`;
  const bordo = devs.filter(d => WAN_EDGE_TYPES.indexOf(d.type) >= 0);
  const altri = devs.filter(d => WAN_EDGE_TYPES.indexOf(d.type) < 0);
  const riga = (d) => `<option value="${escapeHTML(d.name)}" label="${escapeHTML(_typeLabel(d.type))}"></option>`;
  return `<datalist id="${escapeHTML(id)}">${bordo.map(riga).join('')}${altri.map(riga).join('')}</datalist>`;
}

/** Cosa si legge nel campo: il nome del nodo se è un riferimento che risolve,
 *  altrimenti ciò che è stato scritto a mano. */
function _deviceFieldValue(siteId, ep) {
  const e = ep || {};
  if (!e.deviceRef) return e.deviceName || '';
  const devs = _devicesOf(siteId);
  const d = devs && devs.find(x => x.id === e.deviceRef);
  return d ? d.name : '';
}

/** La riga sotto al campo: dice se quello che c'è scritto è AGGANCIATO a un nodo
 *  del progetto o è una dichiarazione. Sono due cose diverse e si vedono diverse
 *  — e un riferimento che non risolve più lo dice invece di sparire. */
function _deviceStatus(siteId, ep) {
  const e = ep || {};
  const site = _sites().find(s => s.id === siteId);
  const stato = (site && site.projectRef) ? _st.projectData.get(String(site.projectRef)) : undefined;
  const hint = (cls, icona, chiave) =>
    `<small class="${escapeHTML(cls)}">${icona ? `<i class="fas ${escapeHTML(icona)}"></i> ` : ''}${escapeHTML(t(chiave))}</small>`;
  if (e.deviceRef) {
    // ⚠️ «Non l'ho ancora letto» e «non si legge» sono due cose diverse: senza
    // distinguerle, un progetto rotto passerebbe per uno lento.
    if (stato === undefined) return hint('org-hint', '', 'org.devLoading');
    if (stato === null) return hint('org-bad', 'fa-plug-circle-xmark', 'org.devUnreadable');
    return stato.devices.some(x => x.id === e.deviceRef)
      ? hint('org-hint org-ok', 'fa-link', 'org.devLinked')
      : hint('org-bad', 'fa-link-slash', 'org.devMissing');
  }
  if (e.deviceName) return hint('org-hint', '', 'org.devTyped');
  if (!site || !site.projectRef) return hint('org-hint', '', 'org.devNoProject');
  if (stato === null) return hint('org-bad', 'fa-plug-circle-xmark', 'org.devUnreadable');
  return '';
}

/** Il nome per esteso del progetto di una sede — per il `title` della tendina:
 *  i nomi di progetto sono lunghi e la casella li taglia, e un nome tagliato a
 *  metà è proprio il campo su cui uno vuole essere sicuro. */
function _projectName(ref) {
  if (!ref) return t('org.noProject');
  const p = _st.projects.find(x => String(x.id) === String(ref));
  return p ? p.name : t('org.missingProject') + ' #' + ref;
}

function _projectOptions(sel) {
  const known = _st.projects.map(p => _opt(String(p.id), p.name, sel)).join('');
  // Un riferimento a un progetto che non c'è più NON si cancella dalla tendina:
  // sparirebbe il dato sbagliato invece di mostrarlo. Resta, marcato.
  const orphan = (sel && !_st.projects.some(p => String(p.id) === String(sel)))
    ? _opt(String(sel), '⚠ ' + t('org.missingProject') + ' #' + sel, sel) : '';
  return _opt('', '— ' + t('org.noProject'), sel || '') + known + orphan;
}

/** L'etichetta d'origine accanto a un campo che può portare l'envelope. */
function _originBadge(f) {
  if (!isFact(f)) return '';
  const o = factOrigin(f);
  if (o === 'declared') return '';   // il caso normale del form: non si annota
  return `<span class="org-origin org-origin-${escapeHTML(o)}" title="${escapeHTML(t('org.originOverwrite'))}">${escapeHTML(t('org.origin.' + o))}</span>`;
}

/**
 * Su quali linee WAN corre questo collegamento.
 *
 * ⑳ **Vale per ogni natura, non solo per l'SD-WAN.** Era un campo di `sdwan` —
 * la parola «underlay» lo faceva sembrare un concetto da SD-WAN — e la domanda
 * invece è la stessa per tutti: un IPsec esce da una linea, un MPLS ci viene
 * consegnato sopra. «È giù la linea di Milano: cosa cade con lei» è la domanda
 * del dossier di ripristino, e senza questo campo su ogni `kind` non ha risposta.
 *
 * ⚠️ Si offrono le linee **dei due capi**, non tutte quelle dell'organizzazione:
 * una linea di Torino non può portare un collegamento fra Milano e Roma, e
 * offrirla è invitare a un errore che poi nessuno rilegge. Ma ciò che è **già
 * dichiarato** si mostra comunque, anche se il capo è cambiato dopo — e persino
 * se la linea non esiste più: un valore che c'è nel modello e non si vede a
 * schermo è impossibile da togliere, e intanto finisce sulla carta.
 *
 * ⚠️ Era un `<select multiple>`, ed **era inutilizzabile**: si aggiunge e si
 * toglie solo col ctrl-clic, un clic normale azzera la selezione, e con un
 * uplink solo sembrava una casella bloccata — «cos'è questo campo che non
 * riesco a modificare» è esattamente la domanda che si è fatto chi l'ha usato.
 * Caselle di spunta: un clic, un effetto, e si legge senza istruzioni.
 * Le linee si mostrano con l'operatore e la sede, perché l'id non dice niente.
 *
 * ⚠️ Sotto le caselle NON c'è una riga d'aiuto. C'era, e diceva a parole ciò che
 * l'etichetta dice già sopra: in fondo a un elenco di voci la stessa frase
 * ricompare più in piccolo, e si legge come se fosse un'altra — l'occhio ci
 * torna a cercare la differenza che non c'è. Il gergo («underlay») è rimasto
 * dove serve: nella riga d'aiuto dell'overlay, che è il campo dove quella
 * parola si incontra per la prima volta.
 */
function _underlayField(l, i, ro) {
  const scelti = l.underlayUplinkIds || [];
  const capi = [l.aSiteId, l.bSiteId];
  const casella = (id, testo, checked) => `
    <label class="org-check">
      <input type="checkbox" ${ro ? 'disabled' : ''} ${checked ? 'checked' : ''}
             data-change="org-underlay" data-idx="${i}" data-uplink="${escapeHTML(id)}">
      <span>${escapeHTML(testo)}</span>
    </label>`;
  const offerte = _uplinks().filter(u => capi.indexOf(u.siteId) >= 0 || scelti.indexOf(u.id) >= 0);
  const righe = offerte.map(u => casella(u.id,
    (u.provider || t('org.uplinkNoProvider')) + ' · ' + (_siteName(u.siteId) || u.siteId),
    scelti.indexOf(u.id) >= 0)).join('')
    // La linea cancellata dopo: la casella resta, spuntata, così si può togliere.
    // Il dossier la stampa già come «non trovata» — se qui sparisse, chi legge
    // quella riga sulla carta non avrebbe nessun posto dove andare a spegnerla.
    + scelti.filter(id => !offerte.some(u => u.id === id))
      .map(id => casella(id, id + ' — ' + t('org.underlayGone'), true)).join('');
  // Le caselle stanno in un contenitore loro, in RIGA: sono poche (le linee dei
  // due capi) e brevi, e una colonna le faceva sembrare un elenco lungo quanto
  // il resto della scheda. In riga si leggono per quello che sono — un insieme
  // fra cui scegliere — e il blocco smette di dominare il collegamento.
  return `<div class="org-f org-f-wide org-f-underlay"><span>${escapeHTML(t('org.underlay'))}</span>
    ${righe
      ? `<div class="org-checks">${righe}</div>`
      : `<p class="org-note">${escapeHTML(t('org.underlayNone'))}</p>`}</div>`;
}

function _fieldsOfNature(l, i) {
  // ⚠️ La sola lettura vale ANCHE qui. Mancava: i campi propri del `kind` erano
  // scrivibili da un viewer, che poi si sarebbe visto rifiutare il salvataggio
  // dal server. Un campo che accetta quello che scrivi e non lo salva è peggio
  // di un campo spento.
  const ro = !_isAdmin();
  // Il quinto argomento è la RIGA DI AIUTO. Non è ornamento: «Overlay» da solo,
  // sopra una casella vuota, è la parola che ha fatto fermare chi lo guardava —
  // e la parola resta perché è quella scritta su ogni console (in italiano non
  // esiste un termine standard: la letteratura tecnica la tiene in inglese e la
  // spiega). Allora la spiega anche il campo, invece di darla per saputa.
  // 🔒 `cred` chiede la riga rossa delle credenziali: la porta solo il campo che
  // ne ha bisogno, così gli altri restano quelli di prima.
  const F = (field, label, val, ph, hint, cred) => `<label class="org-f"><span>${escapeHTML(label)}</span>
    <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(val == null ? '' : val)}" ${ph ? `placeholder="${escapeHTML(ph)}"` : ''}
      data-input="org-field" data-scope="link" data-idx="${i}" data-field="${escapeHTML(field)}">
    ${cred ? '<small class="org-bad" data-cred-hint style="display:none"></small>' : ''}
    ${hint ? `<small class="org-hint">${escapeHTML(hint)}</small>` : ''}</label>`;
  // ㉔ I campi propri seguono il loro ASSE. Prima era uno `switch` sulla natura;
  // con due assi le combinazioni sarebbero il prodotto dei due vocabolari, e
  // ognuna direbbe soltanto «i campi del trasporto più quelli del tunnel». Due
  // blocchi, e si compongono da soli.
  let out = '';

  // ── il TRASPORTO ─────────────────────────────────────────────────────
  // ⑲ I servizi d'operatore hanno un'istanza (VRF) e un nome di servizio.
  // ⚠️ L'identificativo numerico — il VNI di una VXLAN, il VC-ID di un VPWS —
  // NON ha un campo, e non lo si infila in «Servizio»: un campo che ospita due
  // cose diverse comincia a mentire alla prima riga in cui ne porta una sola.
  if (CARRIER_TRANSPORTS.indexOf(l.transport) >= 0) {
    out += F('vrf', 'VRF', l.vrf) + F('service', t('org.service'), l.service);
  }
  if (l.transport === 'directLink') out += F('media', t('org.media'), l.media, t('org.mediaPh'));

  // ── il TUNNEL ────────────────────────────────────────────────────────
  // Gli IP dei peer valgono per OGNI tunnel: è la coppia di indirizzi che si
  // scrive nella configurazione, quale che sia l'incapsulamento. Su un trasporto
  // nudo non vogliono dire niente, e un campo che non vuol dire niente invita a
  // riempirlo.
  // ⚠️ «visto da», non «presso»: `endpointA.peerIp` è l'indirizzo dell'ALTRO
  // capo — quello che si scrive nella configurazione del tunnel SU A. Un «IP del
  // peer presso Verona» direbbe l'esatto contrario, e nessuno a valle potrebbe
  // accorgersene: due indirizzi ugualmente plausibili nei due campi sbagliati.
  // ⚠️ Gli APPARATI dei due capi non stanno qui: valgono per ogni natura (⑥) e
  // si disegnano una volta sola in `_renderLinks`.
  if (l.tunnel && l.tunnel !== 'none') {
    out += F('peerA', _atSite('org.peerA', l.aSiteId), (l.endpointA || {}).peerIp, '203.0.113.1')
      + F('peerB', _atSite('org.peerB', l.bSiteId), (l.endpointB || {}).peerIp, '198.51.100.1');
  }
  if (l.tunnel === 'ipsec') {
    out += F('phase1Name', t('org.phase1'), l.phase1Name)
      + `<label class="org-f"><span>${escapeHTML(t('org.ike'))}</span>
          <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="link" data-idx="${i}" data-field="ikeVersion">
            ${_opt('', '—', l.ikeVersion == null ? '' : l.ikeVersion)}${_opt('1', 'IKEv1', l.ikeVersion)}${_opt('2', 'IKEv2', l.ikeVersion)}
          </select></label>`
      // ㉓ Le due proposte: è ciò che si ridigita sull'apparato, e i due capi
      // devono averle identiche. Testo libero, perché ogni piattaforma le scrive
      // a modo suo e normalizzare fra vendor vorrebbe dire decidere al posto di
      // chi guarda la sua console (paletto ③).
      + F('phase1Proposal', t('org.phase1Proposal'), l.phase1Proposal, t('org.phase1ProposalPh'), t('org.phase1ProposalHint'))
      + F('phase2Proposal', t('org.phase2Proposal'), l.phase2Proposal, t('org.phase2ProposalPh'), t('org.phase2ProposalHint'))
      // 🔒 DOVE sta la chiave, mai la chiave.
      + F('pskRef', t('org.pskRef'), l.pskRef, t('org.pskRefPh'), t('org.pskRefHint'), true);
  }
  // ⑳ Le linee sotto NON stanno qui: come i due capi, si disegnano una volta
  // sola in `_renderLinks`, per ogni natura. Qui resta l'overlay, che dell'SD-WAN
  // è davvero.
  if (l.tunnel === 'sdwan') out += F('overlay', t('org.overlay'), l.overlay, t('org.overlayPh'), t('org.overlayHint'));
  // ⑨ Le etichette di `other` NON stanno qui: stanno attaccate alla loro
  // tendina, in `_renderLinks`. Gli altri campi sono PROPRIETÀ del collegamento
  // (il VRF, l'overlay, il mezzo); quelle COMPLETANO la scelta stessa, e sono la
  // risposta alla stessa domanda della tendina, scritta a parole.
  return out;
}

/** La scheda di UNA sede: nome, ruolo, progetto, indirizzo, punto, reti. `i` è la posizione nel
 *  documento: tutti i campi scrivono per indice, e un indice relativo a un elenco filtrato
 *  scriverebbe sulla sede sbagliata. */
function _siteRowHtml(s, i) {
  const ro = !_isAdmin();
  const bad = _badNets(s.subnets);
  const unknown = _st.unknownRefs.some(u => u.siteId === s.id);
  return `<article class="org-row" data-row="${escapeHTML(String(s.id))}">
      <header class="org-row-head">
        ${(() => { const h = _siteHealth(s.id); return `<i class="fas ${escapeHTML(ROLE_ICON[s.role] || 'fa-building')} org-site-state${h ? ' ' + h.cls : ''}"${h ? ` title="${escapeHTML(h.title)}"` : ''}></i>`; })()}
        <input class="org-row-title" type="text" value="${escapeHTML(s.name)}" ${ro ? 'disabled' : ''}
               data-input="org-field" data-scope="site" data-idx="${i}" data-field="name" aria-label="${escapeHTML(t('org.siteName'))}">
        ${ro ? '' : `<button class="um-btn danger org-del" data-act="org-del-site" data-idx="${i}" title="${escapeHTML(t('org.removeSite'))}"><i class="fas fa-trash"></i></button>`}
      </header>
      <div class="org-grid">
        <label class="org-f"><span>${escapeHTML(t('org.role'))}</span>
          <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="site" data-idx="${i}" data-field="role">
            ${SITE_ROLES.map(r => _opt(r, t('org.role.' + r), s.role)).join('')}
          </select></label>
        <label class="org-f org-f-span2"><span>${escapeHTML(t('org.project'))}</span>
          <select ${ro ? 'disabled' : ''} title="${escapeHTML(_projectName(s.projectRef))}"
                  data-change="org-field" data-scope="site" data-idx="${i}" data-field="projectRef">
            ${_projectOptions(s.projectRef || '')}
          </select>
          ${unknown ? `<small class="org-bad">${escapeHTML(t('org.unknownRef'))}</small>` : ''}</label>
        <label class="org-f org-f-wide"><span>${escapeHTML(t('org.address'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(s.address || '')}"
                 data-input="org-field" data-scope="site" data-idx="${i}" data-field="address"></label>
        ${_geoBlock(s, i, ro)}
        <label class="org-f org-f-wide"><span>${escapeHTML(t('org.subnets'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML((s.subnets || []).join(', '))}" placeholder="10.1.0.0/24, 10.1.1.0/24"
                 data-input="org-field" data-scope="site" data-idx="${i}" data-field="subnets">
          <small class="org-bad" data-net-hint ${bad.length ? '' : 'style="display:none"'}>${bad.length ? escapeHTML(t('org.notNetworks') + ' ' + bad.join(', ')) : ''}</small>
          ${ro ? '' : `<div class="org-row-actions">
            <button class="um-btn ghost org-mini" data-act="org-nets-from-project" data-idx="${i}"${s.projectRef ? '' : ' disabled'}
                    title="${escapeHTML(s.projectRef ? t('org.netsFromProjectTip') : t('org.netsNoProject'))}">
              <i class="fas fa-down-long"></i> ${escapeHTML(t('org.netsFromProject'))}</button>
            <button class="um-btn ghost org-mini" data-act="org-wan-from-dcim" data-idx="${i}"${(s.projectRef && !_st.wanBusy) ? '' : ' disabled'}
                    title="${escapeHTML(s.projectRef ? t('org.wanFromDcimTip') : t('org.netsNoProject'))}">
              <i class="fas ${_st.wanBusy ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}"></i> ${escapeHTML(t('org.wanFromDcim'))}</button>
          </div>`}</label>
      </div>
    </article>`;
}

/**
 * L'esito dell'ultima lettura dal DCIM, a schermo.
 *
 * Sta nel pannello e non in un avviso: le note sono più d'una, e un elenco
 * dentro un modale che si chiude col primo clic è un elenco che nessuno legge.
 * E dice sempre **due** numeri — quante ne ha aggiunte e quante ne dichiarava
 * NetBox: «0 su 3» vuol dire «le avevi già», «0 su 0» vuol dire «NetBox non ne
 * conosce», e con un numero solo si confonderebbero.
 */
/**
 * Le note che contano qualcosa hanno anche il loro SINGOLARE. «Non proposte 1
 * linee» fa dubitare del resto di ciò che c'è scritto sopra, esattamente come
 * «Aggiunto 1 collegamenti» — è la stessa regola dei due conteggi del riquadro,
 * che però passavano da `frase()` e queste no: una nota è una chiave sola,
 * cercata di piatto, e nessuno le aveva dato la variante.
 *
 * ⚠️ Le chiavi si scrivono PER ESTESO tutt'e due, invece di comporre
 * `chiave + 'One'` a runtime: il cricchetto delle traduzioni legge le chiavi dal
 * SORGENTE, e una composta gli sarebbe invisibile — potrebbe mancare dal
 * dizionario, o restare orfana, senza che nessun test arrossisca.
 *
 * ⚠️ `vpn.multipoint` porta un `n` e NON è qui di proposito: scatta solo sopra
 * le due sedi, quindi «1 sede» non esiste e una frase per quel caso sarebbe una
 * traduzione da mantenere per sempre senza che nessuno la veda mai.
 */
const NOTA_SINGOLARE = {
  'org.wanNote.notActive': 'org.wanNote.notActiveOne',
  'org.wanNote.cirMissing': 'org.wanNote.cirMissingOne',
  'org.wanNote.outOfScope': 'org.wanNote.outOfScopeOne',
  'org.vpnNote.notActive': 'org.vpnNote.notActiveOne',
  'org.vpnNote.endpointNoSite': 'org.vpnNote.endpointNoSiteOne',
  'org.vpnNote.outOfScope': 'org.vpnNote.outOfScopeOne',
};

function _wanNoteText(n) {
  const code = String((n && n.code) || '');
  if (!code) return '';
  // ⚠️ Due famiglie, due prefissi. `wan.truncated` e `vpn.truncated` sono due
  // frasi diverse (una parla di circuiti, l'altra di tunnel): appiattirle sullo
  // stesso spazio di chiavi ne farebbe sparire una — e a schermo comparirebbe la
  // frase sbagliata, che è peggio di nessuna frase.
  // ⚠️ I due prefissi si scrivono PER ESTESO: il cricchetto delle traduzioni
  // legge le chiavi dal sorgente, e un `'org.' + famiglia + 'Note.'` composto a
  // runtime gli è invisibile — le venti frasi qui sotto risulterebbero senza
  // nessuno che le chiede, e verrebbero tolte come morte.
  const PREFISSO = { wan: 'org.wanNote.', vpn: 'org.vpnNote.' };
  const m = /^(wan|vpn)\.(.+)$/.exec(code);
  if (!m || !PREFISSO[m[1]]) return '';
  const plurale = PREFISSO[m[1]] + m[2];
  const key = (Number(n.n) === 1 && NOTA_SINGOLARE[plurale]) || plurale;
  const s = t(key);
  if (!s || s === key) return '';        // codice che non conosciamo: si tace, non si stampa una chiave
  // ⚠️ Sostituzione GLOBALE, e con `split`/`join` invece di `replace`. Due
  // ragioni, e tutt'e due si vedono a schermo quando mancano:
  //   · `replace` con una stringa cambia solo la PRIMA occorrenza, quindi una
  //     frase che nomina lo stesso segnaposto due volte ne lasciava uno CRUDO
  //     — capitato alla nota del servizio multipunto, vista in un archivio a
  //     quattro sedi: «tocca 3 sedi … non {n} coppie»;
  //   · nel rimpiazzo `replace` interpreta le sequenze col dollaro ($& e $1), e
  //     qui i valori sono NOMI di sede e di servizio scritti da chi documenta:
  //     un nome che contiene un dollaro verrebbe riscritto invece che stampato.
  const VALORI = {
    '{n}': n.n == null ? '' : n.n,
    '{circuitId}': n.circuitId || '—',
    '{site}': n.site || '—',
    '{type}': n.type || '—',
    '{name}': n.name || '—',
    '{id}': n.id || '—',
    '{error}': n.error || '—',
    '{clouds}': (n.clouds || []).join(', '),
    '{sites}': (n.sites || []).join(', '),
    '{rows}': (n.rows || []).map(r => String(r.circuitId || r.name || '—') + ' (' + String(r.status || '') + ')').join(', '),
  };
  let out = s;
  for (const [segno, v] of Object.entries(VALORI)) out = out.split(segno).join(String(v));
  return out;
}

/**
 * ⑱ **Il verbale dei tipi di circuito.** Il tipo di un circuito in NetBox è
 * testo libero dell'istanza, e la tecnologia di un collegamento nasce da una
 * regola che il software applica DA SÉ: se lo slug del tipo è già una nostra
 * tecnologia allora è quella, altrimenti «Altro» con il nome per descrizione.
 * Una decisione presa in silenzio è una decisione che nessuno può correggere,
 * e qui si dice tipo per tipo — con i NUMERI, perché «un tipo che si chiama
 * MPLS» e «due collegamenti letti come MPLS» non sono la stessa affermazione.
 *
 * ⚠️ La tecnologia si nomina SOLO dove è stata davvero decisa, cioè dove quel
 * tipo ha prodotto un collegamento fra sedi. Un tipo che ha prodotto soltanto
 * linee WAN non ha nessuna tecnologia da mostrare: là il tipo finisce tale e
 * quale nel campo del servizio, e nessuno sceglie niente. Scriverlo lo stesso
 * sarebbe raccontare una decisione mai presa.
 */
function _renderWanTypes(types) {
  const elenco = (types || []).filter(x => x && (x.name || x.slug));
  if (!elenco.length) return '';
  let soloUplink = false;
  const righe = elenco.map(x => {
    const n = Math.max(0, Number(x.n) || 0);
    const nl = Math.max(0, Number(x.nLinks) || 0);
    const testa = t(n === 1 ? 'org.wanTypeRowOne' : 'org.wanTypeRow')
      .replace('{n}', String(n)).replace('{name}', String(x.name || x.slug));
    if (!nl) { soloUplink = true; return testa; }
    // Una tecnologia che il modello non conosce non si stampa: sarebbe una
    // parola inventata a schermo, e il vocabolario è quello del modello.
    const kind = INTER_SITE_TRANSPORTS.indexOf(x.transport) >= 0 ? x.transport : 'other';
    // ⚠️ Le quattro chiavi si scrivono PER ESTESO: il cricchetto delle
    // traduzioni legge le chiavi dal sorgente, e una composta a runtime gli
    // sarebbe invisibile — potrebbe mancare dal dizionario e comparire nuda.
    const chiave = kind === 'other'
      ? (nl === 1 ? 'org.wanTypeOtherOne' : 'org.wanTypeOther')
      : (nl === 1 ? 'org.wanTypeAsOne' : 'org.wanTypeAs');
    return testa + t(chiave).replace('{n}', String(nl)).replace('{kind}', t('org.transport.' + kind));
  });
  // ⑦ CHIUSO di default, come le note. Questo è il verbale di una decisione che
  // il software ha preso da sé: prezioso quando lo si cerca, rumore quando non
  // lo si cerca — e prima stava aperto a ogni import, in mezzo all'esito.
  const quante = t(righe.length === 1 ? 'org.wanTypesMoreOne' : 'org.wanTypesMore')
    .split('{n}').join(String(righe.length));
  return `<details class="org-wan-more"><summary>${escapeHTML(quante)}</summary>
    <ul class="org-wan-types">${righe.map(x => `<li>${escapeHTML(x)}</li>`).join('')}</ul>
    ${soloUplink ? `<p class="org-wan-types-note">${escapeHTML(t('org.wanTypesUplinkOnly'))}</p>` : ''}</details>`;
}

/** Il titolo della CLASSE a cui una nota appartiene — il suo codice, in parole.
 *  ⚠️ I due prefissi si scrivono PER ESTESO, come per `org.wanNote.`: il
 *  cricchetto delle traduzioni legge le chiavi dal sorgente, e uno composto a
 *  runtime gli sarebbe invisibile. E li conosce entrambi, così un codice nuovo
 *  arriva con l'obbligo di portarsi anche il titolo della sua classe. */
function _wanGroupTitle(code) {
  const PREFISSO = { wan: 'org.wanGroup.', vpn: 'org.vpnGroup.' };
  const m = /^(wan|vpn)\.(.+)$/.exec(String(code || ''));
  if (!m || !PREFISSO[m[1]]) return '';
  const k = PREFISSO[m[1]] + m[2];
  const s = t(k);
  return (!s || s === k) ? '' : s;
}

/**
 * Le note della lettura, RAGGRUPPATE per codice e chiuse.
 *
 * ⑦ **Erano un elenco piatto di paragrafi, e tutti insieme.** Sette frasi
 * lunghe, ciascuna col suo perché, servite ogni volta — anche al ventesimo
 * import, anche a chi quel perché lo sa. Il ragionamento resta parola per
 * parola: cambia CHI lo chiede e QUANDO. Niente sparisce, perché il numero
 * («7 note su questa lettura») sta in faccia e apre con un click.
 *
 * ⚠️ Il conteggio in testa dice «note», non «cose non importate»: alcune non
 * sono rifiuti ma avvisi sulla lettura (troncata, filtro non accettato), e
 * chiamarle tutte scarti direbbe una cosa falsa di un terzo di loro.
 *
 * Il raggruppamento è per `code` — cioè per MOTIVO, che è la struttura che il
 * dato ha già: stesso codice, stessa ragione. Non è una compressione inventata.
 */
function _renderWanNotes(notes) {
  const ordine = [];
  const perCodice = new Map();
  for (const n of (notes || [])) {
    const code = String((n && n.code) || '');
    if (!code) continue;
    if (!perCodice.has(code)) { perCodice.set(code, []); ordine.push(code); }
    perCodice.get(code).push(n);
  }
  let totale = 0;
  const blocchi = ordine.map((code) => {
    const righe = perCodice.get(code).map(_wanNoteText).filter(Boolean);
    if (!righe.length) return '';
    totale += righe.length;
    // Un titolo che manca non fa sparire il gruppo: le sue righe si leggono lo
    // stesso. Il cricchetto arrossisce, l'utente non perde niente.
    const titolo = _wanGroupTitle(code);
    return `<section class="org-wan-group">
      ${titolo ? `<p class="org-wan-group-head">${escapeHTML(titolo)}${righe.length > 1
        ? ` <span class="org-wan-group-n">· ${escapeHTML(righe.length)}</span>` : ''}</p>` : ''}
      <ul>${righe.map(x => `<li>${escapeHTML(x)}</li>`).join('')}</ul>
    </section>`;
  }).filter(Boolean);
  if (!blocchi.length) return '';
  const quante = t(totale === 1 ? 'org.wanNotesMoreOne' : 'org.wanNotesMore')
    .split('{n}').join(String(totale));
  return `<details class="org-wan-more"><summary>${escapeHTML(quante)}</summary>
    ${blocchi.join('')}</details>`;
}

/**
 * L'esito della lettura, in tre livelli: l'ESITO sempre in faccia, il resto a
 * un click.
 *
 * ⑦ **Erano quattro discorsi nello stesso registro.** Un esito, un censimento
 * dei tipi, una nota di metodo sul censimento e sette rifiuti motivati —
 * stessa dimensione, stesso colore, stessi puntini, 389 pixel. Il fatto che
 * conta («non è cambiato niente, sei allineato») bisognava ricostruirselo
 * leggendo due frasi. Ora la prima riga lo dice e le altre due si aprono se
 * uno le vuole. Il contenuto è lo stesso: cambia l'ordine di lettura.
 */
function _renderWanReport() {
  const r = _st.wanReport;
  if (!r) return '';
  // «Aggiunto 1 collegamenti» fa dubitare del resto di ciò che c'è scritto
  // sopra: il singolare non è un dettaglio di stile. E una riga «0 su 0» accanto
  // a un elenco di collegamenti veri è rumore — si scrive solo di ciò che c'è.
  // ⚠️ Le chiavi si passano PER ESTESO invece di comporre `chiave + 'One'`:
  // il cricchetto che verifica le traduzioni legge le chiavi dal sorgente, e una
  // chiave composta a runtime gli sarebbe invisibile — cioè potrebbe mancare dal
  // dizionario e comparire nuda a schermo senza che nessun test arrossisca.
  // ⚠️ E quando non è entrato NIENTE non si apre con uno zero: «Aggiunte 0
  // linee» mette in testa il numero meno interessante della frase, e il lettore
  // deve fare 0+2 per sapere come sta. La frase dedicata dice prima com'è
  // andata, e il numero che conta — quante c'erano già — resta il suo seguito.
  const frase = (molti, uno, nessuno, n, tot, gia) =>
    (n === 0 ? t(nessuno) : t(n === 1 ? uno : molti).split('{n}').join(String(n)).split('{tot}').join(String(tot)))
    + (gia ? ' ' + t(gia === 1 ? 'org.wanAlreadyOne' : 'org.wanAlready').split('{n}').join(String(gia)) : '');
  const vuoto = !r.total && !r.totalLinks;
  const testa = vuoto ? t('org.wanNone')
    : (r.total ? frase('org.wanAdded', 'org.wanAddedOne', 'org.wanNoNewLines', r.added, r.total, r.already) : '');
  const capi = r.totalLinks
    ? frase('org.wanAddedLinks', 'org.wanAddedLinksOne', 'org.wanNoNewLinks', r.addedLinks, r.totalLinks, r.alreadyLinks) : '';
  return `<div class="org-wan-report">
    <p class="org-wan-head"><i class="fas fa-cloud-arrow-down"></i>
      <strong>${escapeHTML(r.siteName || '')}</strong>${testa ? ' — ' + escapeHTML(testa) : ''}
      <button class="um-btn ghost org-mini" data-act="org-wan-clear" title="${escapeHTML(t('common.close'))}"><i class="fas fa-xmark"></i></button></p>
    ${capi ? `<p>${escapeHTML(capi)}</p>` : ''}
    <div class="org-wan-drawers">${_renderWanNotes(r.notes)}${_renderWanTypes(r.types)}</div>
  </div>`;
}

/** La scheda di UNA linea WAN. `i` è la posizione nel documento (vedi `_siteRowHtml`). */
function _uplinkRowHtml(u, i) {
    const ro = !_isAdmin();
    const ips = isFact(u.publicIps) ? (factValue(u.publicIps) || []) : [];
    const badIps = _badAddrs(ips);
    return `<article class="org-row" data-row="${escapeHTML(String(u.id))}">
      <header class="org-row-head">
        <i class="fas fa-cloud-arrow-up"></i>
        <input class="org-row-title" type="text" list="org-providers" title="${escapeHTML(t('org.providerTip'))}"
               value="${escapeHTML(u.provider || '')}" placeholder="${escapeHTML(t('org.providerPh'))}" ${ro ? 'disabled' : ''}
               data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="provider" aria-label="${escapeHTML(t('org.provider'))}">
        ${ro ? '' : `<button class="um-btn danger org-del" data-act="org-del-uplink" data-idx="${i}" title="${escapeHTML(t('org.removeUplink'))}"><i class="fas fa-trash"></i></button>`}
      </header>
      <div class="org-grid">
        <label class="org-f"><span>${escapeHTML(t('org.site'))}</span>
          <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="uplink" data-idx="${i}" data-field="siteId">${_siteOptions(u.siteId)}</select></label>
        <label class="org-f"><span>${escapeHTML(t('org.serviceType'))}</span>
          <input type="text" list="org-svc-types" ${ro ? 'disabled' : ''} value="${escapeHTML(u.serviceType || '')}" placeholder="FTTH"
                 data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="serviceType"></label>
        <label class="org-f"><span>${escapeHTML(t('org.circuitId'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(u.circuitId || '')}"
                 data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="circuitId"></label>
        <label class="org-f"><span>${escapeHTML(t('org.cir'))}</span>
          <input type="number" min="1" step="1" ${ro ? 'disabled' : ''} value="${u.cirMbps == null ? '' : escapeHTML(u.cirMbps)}"
                 data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="cirMbps">
          <small class="org-bad" data-cir-hint style="display:none"></small></label>
        <label class="org-f org-f-span2"><span>${escapeHTML(t('org.publicIps'))} ${_originBadge(u.publicIps)}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(ips.join(', '))}" placeholder="203.0.113.10, 203.0.113.8/29, 2001:db8::1"
                 data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="publicIps">
          <small class="org-bad" data-net-hint ${badIps.length ? '' : 'style="display:none"'}>${badIps.length ? escapeHTML(t('org.notAddresses') + ' ' + badIps.join(', ')) : ''}</small>
          <small class="org-hint">${escapeHTML(t('org.publicIpsHint'))}</small></label>
        <label class="org-f"><span>${escapeHTML(t('org.addressing'))}</span>
          <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="uplink" data-idx="${i}" data-field="addressing">
            ${_opt('', '—', u.addressing || '')}${WAN_ADDRESSING.map(x => _opt(x, t('org.addr.' + x), u.addressing || '')).join('')}</select>
          <small class="org-hint">${escapeHTML(t('org.addressingHint'))}</small></label>
        <label class="org-f"><span>${escapeHTML(t('org.nextHop'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(u.nextHop || '')}" placeholder="203.0.113.1"
                 data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="nextHop">
          <small class="org-hint">${escapeHTML(t('org.nextHopHint'))}</small></label>
        <label class="org-f"><span>${escapeHTML(t('org.deliveryVlan'))}</span>
          <input type="number" min="1" max="4094" step="1" ${ro ? 'disabled' : ''} value="${u.deliveryVlan == null ? '' : escapeHTML(u.deliveryVlan)}"
                 data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="deliveryVlan">
          <small class="org-hint">${escapeHTML(t('org.deliveryVlanHint'))}</small></label>
        <label class="org-f"><span>${escapeHTML(t('org.mtu'))}</span>
          <input type="number" min="1" step="1" ${ro ? 'disabled' : ''} value="${u.mtu == null ? '' : escapeHTML(u.mtu)}" placeholder="1500"
                 data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="mtu">
          <small class="org-hint">${escapeHTML(t('org.mtuHint'))}</small></label>
        <label class="org-f org-f-span2"><span>${escapeHTML(t('org.supportRef'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(u.supportRef || '')}" placeholder="${escapeHTML(t('org.supportRefPh'))}"
                 data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="supportRef">
          <small class="org-bad" data-cred-hint style="display:none"></small>
          <small class="org-hint">${escapeHTML(t('org.supportRefHint'))}</small></label>
        <label class="org-f"><span>${escapeHTML(t('org.wanIf'))} ${_originBadge(u.wanIfRef)}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(isFact(u.wanIfRef) ? factValue(u.wanIfRef) : '')}" placeholder="MI-RTR-01/GigabitEthernet0/0/1"
                 data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="wanIfRef">
          <small class="org-hint">${escapeHTML(t('org.wanIfHint'))}</small></label>
      </div>
    </article>`;
}

/** ㉕ Una `<datalist>` SOLA per tutte le righe: è lo stesso elenco, e un id
 *  ripetuto in pagina è un id che non identifica. Il campo resta `type=text`,
 *  quindi la tendina SUGGERISCE e non chiude: quello che l'import ha scritto
 *  dal NetBox di qualcun altro entra lo stesso, e chi ha un accesso che qui
 *  non c'è lo scrive. */
function _wanSuggestions() {
  return `<datalist id="org-svc-types">${
    WAN_SERVICE_TYPES.map(k => `<option value="${escapeHTML(t('org.svc.' + k))}"></option>`).join('')}</datalist>`
    + _providerDatalist();
}

/** La scheda di UN collegamento. `i` è la posizione nel documento (vedi `_siteRowHtml`). */
function _linkRowHtml(l, i) {
    const ro = !_isAdmin();
    const reach = isFact(l.reach) ? factValue(l.reach) : { a: [], b: [] };
    const a = (reach && reach.a) || [], b = (reach && reach.b) || [];
    const badA = _badNets(a), badB = _badNets(b);
    return `<article class="org-row" data-row="${escapeHTML(String(l.id))}">
      <header class="org-row-head">
        <i class="fas ${escapeHTML(_natureIcon(l))}"></i>
        <span class="org-row-title org-row-static">${escapeHTML(_siteName(l.aSiteId) || '?')} ↔ ${escapeHTML(_siteName(l.bSiteId) || '?')}${l.name ? ' · ' + escapeHTML(l.name) : ''}
          <span class="org-row-kind">${escapeHTML(_natureText(l))}</span></span>
        ${ro ? '' : `<button class="um-btn danger org-del" data-act="org-del-link" data-idx="${i}" title="${escapeHTML(t('org.removeLink'))}"><i class="fas fa-trash"></i></button>`}
      </header>
      <div class="org-grid">
        <label class="org-f"><span>${escapeHTML(t('org.siteA'))}</span>
          <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="link" data-idx="${i}" data-field="aSiteId">${_siteOptions(l.aSiteId, l.bSiteId)}</select></label>
        <label class="org-f"><span>${escapeHTML(t('org.siteB'))}</span>
          <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="link" data-idx="${i}" data-field="bSiteId">${_siteOptions(l.bSiteId, l.aSiteId)}</select></label>
        <label class="org-f"><span>${escapeHTML(t('org.transport'))}</span>
          <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="link" data-idx="${i}" data-field="transport">
            ${_opt('', '—', l.transport || '')}${INTER_SITE_TRANSPORTS.map(k => _opt(k, t('org.transport.' + k), l.transport || '')).join('')}</select>
          <small class="org-hint">${escapeHTML(t('org.transportHint'))}</small></label>
        ${l.transport !== 'other' ? '' : `<label class="org-f"><span>${escapeHTML(t('org.transportLabel'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(l.transportLabel || '')}" placeholder="${escapeHTML(t('org.transportLabelPh'))}"
                 data-input="org-field" data-scope="link" data-idx="${i}" data-field="transportLabel"></label>`}
        <label class="org-f"><span>${escapeHTML(t('org.tunnel'))}</span>
          <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="link" data-idx="${i}" data-field="tunnel">
            ${_opt('', '—', l.tunnel || '')}${INTER_SITE_TUNNELS.map(k => _opt(k, t('org.tunnel.' + k), l.tunnel || '')).join('')}</select>
          <small class="org-hint">${escapeHTML(t('org.tunnelHint'))}</small></label>
        ${l.tunnel !== 'other' ? '' : `<label class="org-f"><span>${escapeHTML(t('org.tunnelLabel'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(l.tunnelLabel || '')}" placeholder="${escapeHTML(t('org.tunnelLabelPh'))}"
                 data-input="org-field" data-scope="link" data-idx="${i}" data-field="tunnelLabel"></label>`}
        <label class="org-f"><span>${escapeHTML(t('org.linkState'))} ${_originBadge(l.state)}</span>
          <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="link" data-idx="${i}" data-field="state">
            ${_opt('', '— ' + t('org.stateUnspoken'), _fv(l.state))}${INTER_SITE_STATES.map(s => _opt(s, t('org.state' + (s === 'up' ? 'Up' : 'Down')), _fv(l.state))).join('')}</select></label>
        <label class="org-f"><span>${escapeHTML(t('org.linkName'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(l.name || '')}" placeholder="${escapeHTML(t('org.linkNamePh'))}"
                 data-input="org-field" data-scope="link" data-idx="${i}" data-field="name"></label>
        <label class="org-f"><span>${escapeHTML(t('org.provider'))}</span>
          <input type="text" list="org-providers" title="${escapeHTML(t('org.providerTip'))}" ${ro ? 'disabled' : ''}
                 value="${escapeHTML(l.provider || '')}" placeholder="${escapeHTML(t('org.providerPh'))}"
                 data-input="org-field" data-scope="link" data-idx="${i}" data-field="provider"></label>
        <label class="org-f"><span>${escapeHTML(t('org.circuitId'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(l.circuitId || '')}"
                 data-input="org-field" data-scope="link" data-idx="${i}" data-field="circuitId"></label>
        <label class="org-f"><span>${escapeHTML(_atSite('org.devA', l.aSiteId))}</span>
          <input type="text" ${ro ? 'disabled' : ''} list="org-dl-${i}-a" title="${escapeHTML(t('org.devTip'))}"
                 value="${escapeHTML(_deviceFieldValue(l.aSiteId, l.endpointA))}" placeholder="${escapeHTML(t('org.devPh'))}"
                 data-input="org-field" data-scope="link" data-idx="${i}" data-field="devA">
          ${_deviceDatalist('org-dl-' + i + '-a', l.aSiteId)}
          ${_deviceStatus(l.aSiteId, l.endpointA)}</label>
        <label class="org-f"><span>${escapeHTML(_atSite('org.devB', l.bSiteId))}</span>
          <input type="text" ${ro ? 'disabled' : ''} list="org-dl-${i}-b" title="${escapeHTML(t('org.devTip'))}"
                 value="${escapeHTML(_deviceFieldValue(l.bSiteId, l.endpointB))}" placeholder="${escapeHTML(t('org.devPh'))}"
                 data-input="org-field" data-scope="link" data-idx="${i}" data-field="devB">
          ${_deviceDatalist('org-dl-' + i + '-b', l.bSiteId)}
          ${_deviceStatus(l.bSiteId, l.endpointB)}</label>
        ${_fieldsOfNature(l, i)}
        ${_underlayField(l, i, ro)}
        <label class="org-f org-f-wide"><span>${escapeHTML(_atSite('org.reachA', l.aSiteId))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(a.join(', '))}" placeholder="10.1.0.0/24, 10.1.1.0/24"
                 data-input="org-field" data-scope="link" data-idx="${i}" data-field="reachA">
          <small class="org-bad" data-net-hint ${badA.length ? '' : 'style="display:none"'}>${badA.length ? escapeHTML(t('org.notNetworks') + ' ' + badA.join(', ')) : ''}</small></label>
        <label class="org-f org-f-wide"><span>${escapeHTML(_atSite('org.reachB', l.bSiteId))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(b.join(', '))}" placeholder="10.2.0.0/24, 10.2.1.0/24"
                 data-input="org-field" data-scope="link" data-idx="${i}" data-field="reachB">
          <small class="org-bad" data-net-hint ${badB.length ? '' : 'style="display:none"'}>${badB.length ? escapeHTML(t('org.notNetworks') + ' ' + badB.join(', ')) : ''}</small></label>
      </div>
      <p class="org-hint org-reach-hint">${escapeHTML(t('org.reachHint'))}</p>
    </article>`;
}

/** La scheda «Collegamenti»: TUTTI, con i loro campi. Dalla scheda di una sede si arriva
 *  qui sul collegamento giusto (`_goToLink`); questa è la lista intera. */
function _renderLinks() {
  if (_sites().length < 2) return `<p class="org-note">${escapeHTML(t('org.needTwoSites'))}</p>`;
  const rows = _links().map((l, i) => _linkRowHtml(l, i)).join('');
  return _providerDatalist() + (rows || `<p class="org-note">${escapeHTML(t('org.emptyLinks'))}</p>`);
}

// ── Coerenza (④: si RACCONTA l'audit del server, non se ne calcola un altro) ─

// ㉖ Le liste dell'audit, in tre gruppi che NON si sommano fra loro. I due
// elenchi arrivano dal motore (vedi l'import in cima): erano scritti anche qui,
// e due definizioni della stessa cosa divergono al primo controllo aggiunto.

/**
 * ⑯ **Quale sede nomina una riga d'audit.** L'audit parla per liste, e ogni
 * lista ha una forma sua: chi porta un `siteId`, chi due, chi un `linkId` o un
 * `uplinkId` da risolvere sul modello. Qui, e in un posto solo, si dice come si
 * risale dalla riga alle sedi che riguarda.
 *
 * ⚠️ `subnetsNowhere` NON c'è, ed è voluto: è una rete che nessuna sede
 * rivendica, quindi non esiste una sede a cui attribuirla. Sceglierne una
 * farebbe diventare colpa di qualcuno un problema che è di tutti — e resta
 * comunque contato in alto, nelle pastiglie dell'organizzazione.
 */
const _AUDIT_SITES_OF = {
  subnetsAtTwoSites: (r) => r.siteIds || [],
  linksToUnknownSite: (r) => _linkSites(r.linkId),
  uplinksToUnknownSite: (r) => [r.siteId],
  spokesWithoutHub: (r) => [r.siteId],
  // ⑳ Le sedi sono quelle del COLLEGAMENTO, non quella della linea sbagliata:
  // la spunta da togliere sta sulla riga del collegamento, e accendere la
  // terza sede la farebbe sembrare colpevole di un difetto che non è suo.
  underlaysNotAtEnds: (r) => _linkSites(r.linkId),
  // ㉖ Il capo incrociato è UNO dei due, e la sede è quella: accendere anche
  // l'altra direbbe che il difetto è di tutt'e due, mentre il campo da girare
  // sta su una riga sola.
  crossedPeerIps: (r) => [r.siteId],
  uplinksImplausible: (r) => [r.siteId],
  // La spunta che manca sta sulla riga del collegamento: riguarda i due capi.
  linksWithoutUnderlay: (r) => _linkSites(r.linkId),
  // Qui invece la sede è UNA: è il capo rimasto cieco.
  underlaysAtOneEndOnly: (r) => [r.siteId],
  subnetsNotCarried: (r) => [r.siteId],
  linksWithoutReach: (r) => _linkSites(r.linkId),
  sitesWithoutLink: (r) => [r.siteId],
  sitesWithoutUplink: (r) => [r.siteId],
  uplinksWithoutPublicIp: (r) => [r.siteId],
  uplinksWithNonPublicIp: (r) => [r.siteId],
  staticUplinksWithoutNextHop: (r) => [r.siteId],
};

/** Le due sedi ai capi di un collegamento, per risalire da un `linkId`. */
function _linkSites(linkId) {
  const l = _links().find(x => x.id === linkId);
  return l ? [l.aSiteId, l.bSiteId] : [];
}

/**
 * Come sta UNA sede: rosso se un'incoerenza la nomina, giallo se la nomina una
 * lacuna, verde se nessun rilievo la nomina. Si RACCONTA l'audit del server
 * (④), non se ne calcola un altro.
 *
 * ⚠️ Verde vuol dire «nessun rilievo su questa sede», e il titolo lo dice con
 * quelle parole. NON vuol dire «tutto a posto»: i controlli che non hanno
 * potuto girare sono contati a parte, in cima, e trasformarli qui in
 * un'assoluzione sarebbe la bugia che questo audit evita da sempre — «ho
 * guardato e va bene» non è «non ho potuto guardare».
 *
 * Senza audit (pannello appena aperto) non si colora niente: un colore
 * inventato prima di avere la risposta è un'affermazione senza fonte.
 */
function _siteHealth(siteId) {
  const A = _st.audit;
  if (!A) return null;
  const conta = (chiavi) => chiavi.reduce((n, k) => {
    const dove = _AUDIT_SITES_OF[k];
    if (!dove) return n;
    return n + (A[k] || []).filter(r => dove(r).some(id => id === siteId)).length;
  }, 0);
  const bad = conta(AUDIT_PROBLEMS);
  if (bad) return { cls: 'is-problem', title: t('org.siteBad').replace('{n}', String(bad)) };
  const gap = conta(AUDIT_GAPS);
  if (gap) return { cls: 'is-gap', title: t('org.siteGap').replace('{n}', String(gap)) };
  return { cls: 'is-ok', title: t('org.siteOk') };
}

/** Una rete, in tondo monospazio: un CIDR si legge a colpo d'occhio solo se le
 *  cifre sono allineate, e in mezzo a una frase si perde. */
function NET(n) {
  return `<code>${escapeHTML(n)}</code>`;
}

/** Il nome leggibile di un collegamento: «Caci ↔ Aloys · VPLS». Un `linkId`
 *  generato non dice niente a chi legge, e l'audit può solo darci quello. */
function _linkName(linkId) {
  const l = _links().find(x => x.id === linkId);
  const capi = l ? `${_siteName(l.aSiteId) || '?'} ↔ ${_siteName(l.bSiteId) || '?'}` : linkId;
  // ⑨ Il nome della natura lo dà `_natureText`, che per `other` usa le parole
  // scritte da chi documenta: dire «Altro» butterebbe via l'unica cosa che quel
  // collegamento aveva da dire di sé.
  const natura = l ? _natureText(l) : '';
  return natura ? `${capi} · ${natura}` : capi;
}

/** Il nome leggibile di un uplink: l'operatore se c'è, altrimenti la sua sede. */
function _uplinkName(uplinkId, siteId) {
  const u = _uplinks().find(x => x.id === uplinkId);
  const chi = (u && u.provider) || t('org.uplinkNoProvider');
  const dove = _siteName(siteId) || siteId;
  return `${chi} · ${dove}`;
}

/**
 * Una riga d'audit → SOLO ciò che varia.
 *
 * ⭐ Il difetto che questa funzione ha smesso di avere: ogni riga ripeteva il
 * titolo del suo gruppo. Sotto «Reti di una sede che nessun collegamento
 * trasporta» comparivano tre righe che finivano tutte con «nessun collegamento
 * la trasporta». Detto una volta è un'informazione; ripetuto a ogni riga è
 * rumore che nasconde la parte che cambia — cioè l'unica che si sta leggendo.
 * Qui resta il soggetto, e la frase la porta l'intestazione.
 */
function _auditLine(key, row) {
  const S = (id) => escapeHTML(_siteName(id) || id);
  switch (key) {
    case 'subnetsNowhere': return NET(row.subnet);
    case 'subnetsAtTwoSites': return `${NET(row.subnet)} <span class="org-audit-at">${row.siteIds.map(S).join(' · ')}</span>`;
    case 'linksToUnknownSite': return `${escapeHTML(_linkName(row.linkId))} <span class="org-audit-at">${row.missing.map(escapeHTML).join(' · ')}</span>`;
    case 'uplinksToUnknownSite': return `${escapeHTML(_uplinkName(row.uplinkId, row.siteId))}`;
    case 'spokesWithoutHub': return S(row.siteId);
    // ⑳ Ciò che varia è QUALE linea non torna, e dove sta davvero: senza la
    // sede la riga direbbe «una linea sbagliata» senza dire quale — e la sede è
    // esattamente il pezzo che manca sulla carta, dove il difetto è invisibile.
    case 'underlaysNotAtEnds': return `${escapeHTML(_linkName(row.linkId))} <span class="org-audit-at">${row.siteId
      ? escapeHTML(_uplinkName(row.uplinkId, row.siteId))
      : escapeHTML(row.uplinkId + ' — ' + t('org.underlayGone'))}</span>`;
    // ㉖ Ciò che varia è QUALE capo è incrociato e con quale indirizzo: senza
    // l'indirizzo la riga direbbe «uno dei due campi è sbagliato» senza dire
    // quale, ed è il campo che si va a girare.
    case 'crossedPeerIps': return `${escapeHTML(_linkName(row.linkId))} <span class="org-audit-at">${S(row.siteId)} · ${escapeHTML(row.addr)}</span>`;
    // Il NUMERO è tutto il rilievo: dirlo qui evita di andare a cercarlo.
    case 'uplinksImplausible': return `${escapeHTML(_uplinkName(row.uplinkId, row.siteId))} <span class="org-audit-at">${escapeHTML(t(row.field === 'mtu' ? 'org.mtu' : 'org.cir'))} ${Number(row.value)}</span>`;
    case 'linksWithoutUnderlay': return escapeHTML(_linkName(row.linkId));
    // La sede è il capo RIMASTO SCOPERTO, non quello documentato: è lì che manca
    // la spunta, ed è l'unica metà della frase che il lettore non sa già.
    case 'underlaysAtOneEndOnly': return `${escapeHTML(_linkName(row.linkId))} <span class="org-audit-at">${S(row.siteId)}</span>`;
    case 'subnetsNotCarried': return `${NET(row.subnet)} <span class="org-audit-at">${S(row.siteId)}</span>`;
    case 'linksWithoutReach': return escapeHTML(_linkName(row.linkId));
    case 'sitesWithoutLink': return S(row.siteId);
    case 'sitesWithoutUplink': return S(row.siteId);
    case 'uplinksWithoutPublicIp': return escapeHTML(_uplinkName(row.uplinkId, row.siteId));
    // ㉗ L'indirizzo E il suo scopo: «non è pubblico» e «è il 100.64 del
    // provider» mandano a girare due campi diversi, e senza lo scopo il lettore
    // dovrebbe riconoscere un prefisso a memoria.
    case 'uplinksWithNonPublicIp': return `${escapeHTML(_uplinkName(row.uplinkId, row.siteId))} <span class="org-audit-at">${escapeHTML(row.addr)} · ${escapeHTML(t('org.scope.' + row.scope))}</span>`;
    case 'staticUplinksWithoutNextHop': return escapeHTML(_uplinkName(row.uplinkId, row.siteId));
    default: return escapeHTML(JSON.stringify(row));
  }
}

function _auditGroup(keys, title, icon, cls) {
  const A = _st.audit || {};
  const blocchi = keys.filter(k => (A[k] || []).length).map(k => `
    <div class="org-audit-item">
      <h5>${escapeHTML(t('org.a.' + k))} <span class="org-audit-n">${Number((A[k] || []).length)}</span></h5>
      <ul>${A[k].map(r => `<li>${_auditLine(k, r)}</li>`).join('')}</ul>
    </div>`).join('');
  const head = `<h4><i class="fas ${escapeHTML(icon)}"></i> ${escapeHTML(title)}</h4>`;
  return blocchi
    ? `<section class="org-audit-group ${escapeHTML(cls)}">${head}${blocchi}</section>`
    : `<section class="org-audit-group ${escapeHTML(cls)} is-clean">${head}<p class="org-note">${escapeHTML(t('org.a.none'))}</p></section>`;
}

function _renderAudit() {
  if (!_st.audit) return `<p class="org-note">${escapeHTML(t('org.a.notLoaded'))}</p>`;
  const nc = _st.audit.notChecked || [];
  // ⭐ La disciplina di `ipam-audit`: «nessun problema» e «non ho potuto guardare»
  // non devono avere la stessa faccia. Il registro sta SOPRA i due gruppi.
  // ⚠️ E si scrive a PAROLE: `spokesWithoutHub — no-hub` sono i nomi che il
  // motore usa per sé, e a schermo non dicono niente a nessuno.
  const _perche = (r) => {
    const k = 'org.why.' + r;
    const parole = t(k);
    return parole === k ? r : parole;    // un motivo nuovo si vede com'è, non sparisce
  };
  const ncBlock = nc.length
    ? `<section class="org-audit-group is-unchecked">
        <h4><i class="fas fa-circle-question"></i> ${escapeHTML(t('org.a.notChecked'))}</h4>
        <ul class="org-audit-flat">${nc.map(x =>
    `<li>${escapeHTML(t('org.a.' + x.check) === 'org.a.' + x.check ? x.check : t('org.a.' + x.check))}
           <span class="org-audit-at">${escapeHTML(_perche(x.reason))}</span></li>`).join('')}</ul>
      </section>`
    : '';
  return ncBlock
    + _auditGroup(AUDIT_PROBLEMS, t('org.a.problems'), 'fa-triangle-exclamation', 'is-problem')
    + _auditGroup(AUDIT_GAPS, t('org.a.gaps'), 'fa-circle-half-stroke', 'is-gap');
}

// ── La vista ──────────────────────────────────────────────────────────────
//
// ⭐ Da dialogo a VISTA. Il Multisito non è più una finestra che copre il lavoro: è un
// modo di guardare lo stesso spazio, come la Panoramica. Acceso, la mappa geografica
// prende il posto della planimetria, l'elenco delle sedi quello della libreria degli
// elementi e le tre schede (Proprietà · Collegamenti · Coerenza) quello del rack. Il tile
// che sulla planimetria filtra le VLAN qui filtra i TIPI DI CONNESSIONE.
//
// ⚠️ Le tre zone si ridisegnano da `_render()` e si leggono dallo STESSO stato di prima
// (`_st.org`, `_st.audit`): niente copie da tenere allineate. Le schede delle sedi, delle
// linee e dei collegamenti sono le stesse di sempre (`_siteRowHtml`, `_uplinkRowHtml`,
// `_linkRowHtml`), solo mostrate una per volta invece che tutte in colonna.

// Le quattro schede del cassetto. Le prime tre sono TABELLE (un record per riga, i campi che si
// confrontano in colonna) con a destra la scheda della riga scelta; la quarta è il referto.
const TABS = [
  ['sites', 'fa-building', 'org.tabSites'],
  ['links', 'fa-link', 'org.tabLinks'],
  ['wan', 'fa-cloud-arrow-up', 'org.tabWan'],
  ['audit', 'fa-clipboard-check', 'org.tabAudit'],
];

/** Il conteggio dell'audit, come pastiglie. Non si sommano: sono tre domande
 *  diverse, e fonderle in un punteggiato unico è esattamente il modo di non
 *  rispondere a nessuna delle tre. */
function _auditChips() {
  const A = _st.audit;
  if (!A) return '';
  const n = (keys) => keys.reduce((s, k) => s + ((A[k] || []).length), 0);
  const p = n(AUDIT_PROBLEMS), g = n(AUDIT_GAPS), u = (A.notChecked || []).length;
  return `<span class="org-chip ${p ? 'is-problem' : 'is-ok'}" title="${escapeHTML(t('org.a.problems'))}"><i class="fas fa-triangle-exclamation"></i> ${Number(p)}</span>
    <span class="org-chip ${g ? 'is-gap' : 'is-ok'}" title="${escapeHTML(t('org.a.gaps'))}"><i class="fas fa-circle-half-stroke"></i> ${Number(g)}</span>
    ${u ? `<span class="org-chip is-unchecked" title="${escapeHTML(t('org.a.notChecked'))}"><i class="fas fa-circle-question"></i> ${u}</span>` : ''}`;
}

/** Il filtro di testo del cassetto, in minuscolo. */
const _q = () => String(_st.filter || '').trim().toLowerCase();

/** Cerca `q` nei testi dati (i vuoti si saltano). */
const _hay = (q, parts) => !q || parts.some(x => x && String(x).toLowerCase().indexOf(q) >= 0);

/** La ricerca fra le sedi: il nome e l'indirizzo, e ciò che identifica le loro linee e i loro
 *  collegamenti — l'operatore, il tipo, il codice del circuito — perché è così che si cerca «quella di Roma». */
function _siteMatches(s, q) {
  if (!q) return true;
  const hay = [s.name, s.address];
  for (const u of _uplinks()) if (u.siteId === s.id) hay.push(u.provider, u.serviceType, u.circuitId);
  for (const l of _links()) if (l.aSiteId === s.id || l.bSiteId === s.id) hay.push(l.name, l.provider, l.circuitId);
  return _hay(q, hay);
}

/** Il tratto di un tipo di collegamento, come campione: lo stesso che ha sulla carta. */
function _swatch(key, width) {
  const k = kindStyle(key);
  const w = Number(width) || 26;
  const fine = w - 1;
  return `<svg class="ms-swatch" width="${Number(w)}" height="8" viewBox="0 0 ${Number(w)} 8" aria-hidden="true"><path d="M1 4H${Number(fine)}" fill="none" stroke="currentColor" stroke-width="${Number(k.width)}"${k.dash ? ` stroke-dasharray="${escapeHTML(k.dash)}"` : ''} stroke-linecap="${escapeHTML(k.cap)}"/></svg>`;
}

/** Come si chiama un tipo di collegamento: le parole del modello, non altre. */
function _kindLabel(key) {
  if (key === 'undeclared') return t('ms.kindUndeclared');
  if (key === 'tunnelOther') return t('org.tunnel.other');
  if (key === 'transportOther') return t('org.transport.other');
  return t((kindAxis(key) === 'tunnel' ? 'org.tunnel.' : 'org.transport.') + key);
}

// ── Il cassetto: una tabella per scheda, la scheda della riga a destra ────

/** Cosa si può aggiungere da ogni scheda: l'azione e la sua parola. La Coerenza è un referto e non ha niente. */
const _TAB_ADD = {
  sites: ['org-add-site', 'org.addSite'],
  links: ['org-add-link', 'org.addLink'],
  wan: ['org-add-uplink', 'org.addUplink'],
};

/** Le selezioni devono puntare a qualcosa che esiste, e la scheda aperta non resta a mani vuote se c'è
 *  qualcosa da mostrare: scegliere la prima riga costa un clic in meno a chi apre il cassetto. */
function _ensureSel() {
  const ss = _sites(), ls = _links(), us = _uplinks();
  if (!ss.some(x => x.id === _st.selSite)) _st.selSite = '';
  if (!ls.some(x => x.id === _st.selLink)) _st.selLink = '';
  if (!us.some(x => x.id === _st.selUp)) _st.selUp = '';
  if (_st.tab === 'sites' && !_st.selSite && ss.length) _st.selSite = ss[0].id;
  if (_st.tab === 'links' && !_st.selLink && ls.length) _st.selLink = ls[0].id;
  if (_st.tab === 'wan' && !_st.selUp && us.length) _st.selUp = us[0].id;
}

/** Il segno e la parola dello stato di un collegamento. */
function _linkStateOf(l) {
  const st = _edgeStateAttrs(l);
  const up = st.cls.indexOf('is-up') >= 0, down = st.cls.indexOf('is-down') >= 0;
  return { cls: up ? 'is-up' : down ? 'is-down' : 'is-unspoken', word: up ? t('ms.keyUp') : down ? t('ms.keyDown') : t('ms.keyNone'), title: st.title };
}

function _linkTitle(l) {
  return (_siteName(l.aSiteId) || '?') + ' ↔ ' + (_siteName(l.bSiteId) || '?') + (l.name ? ' · ' + l.name : '');
}

function _sitesTable() {
  const q = _q();
  const righe = _sites().filter(s => _siteMatches(s, q)).map(s => {
    const tono = _siteTone(s.id, s.projectRef);
    const h = _siteHealth(s.id);
    const sel = s.id === _st.selSite;
    const nl = _links().filter(l => l.aSiteId === s.id || l.bSiteId === s.id).length;
    const nu = _uplinks().filter(u => u.siteId === s.id).length;
    const nome = s.name || t('org.newSiteName');
    const pos = s.geo ? Number(s.geo.lat).toFixed(3) + ', ' + Number(s.geo.lng).toFixed(3) : t('ms.noPos');
    return `<tr class="ms-tr${sel ? ' is-sel' : ''}" data-act="ms-pick-row" data-kind="site" data-id="${escapeHTML(String(s.id))}" data-row="${escapeHTML(String(s.id))}">
      <td class="ms-c-glyph"><span class="ms-glyph is-${escapeHTML(tono)}" aria-hidden="true">${escapeHTML(_TONE_GLYPH[tono] || '')}</span></td>
      <th scope="row" class="ms-c-name"><button type="button" class="ms-cell-btn" data-act="ms-pick-row" data-kind="site" data-id="${escapeHTML(String(s.id))}"
          aria-current="${sel ? 'true' : 'false'}" aria-label="${escapeHTML(nome + (h ? ' — ' + h.title : ''))}">${escapeHTML(nome)}</button></th>
      <td>${escapeHTML(t('org.role.' + s.role))}</td>
      <td class="ms-dim ms-opt">${escapeHTML(s.projectRef ? _projectName(s.projectRef) : '—')}</td>
      <td class="ms-num">${Number(nl)}</td>
      <td class="ms-num">${Number(nu)}</td>
      <td class="${s.geo ? 'ms-dim' : 'ms-warn'} ms-opt">${escapeHTML(pos)}</td></tr>`;
  }).join('');
  return `<table class="ms-table"><thead><tr>
      <th scope="col" class="ms-c-glyph"><span class="ms-sr">${escapeHTML(t('ms.colState'))}</span></th>
      <th scope="col">${escapeHTML(t('ms.colSite'))}</th><th scope="col">${escapeHTML(t('ms.colRole'))}</th>
      <th scope="col" class="ms-opt">${escapeHTML(t('ms.colProject'))}</th><th scope="col">${escapeHTML(t('org.tabLinks'))}</th>
      <th scope="col">${escapeHTML(t('org.tabWan'))}</th><th scope="col" class="ms-opt">${escapeHTML(t('ms.colPos'))}</th></tr></thead>
    <tbody>${righe}</tbody></table>${righe ? '' : `<p class="org-note ms-pad">${escapeHTML(_sites().length ? t('ms.noMatch') : t('org.emptySites'))}</p>`}`;
}

function _linksTable() {
  if (_sites().length < 2) return `<p class="org-note ms-pad">${escapeHTML(t('org.needTwoSites'))}</p>`;
  const q = _q();
  const righe = _links().filter(l => _hay(q, [_linkTitle(l), l.provider, l.circuitId, _natureText(l)])).map(l => {
    const st = _linkStateOf(l);
    const sel = l.id === _st.selLink;
    const reach = isFact(l.reach) ? factValue(l.reach) : null;
    const carried = reach ? (((reach && reach.a) || []).length + ((reach && reach.b) || []).length) : 0;
    return `<tr class="ms-tr${sel ? ' is-sel' : ''}" data-act="ms-pick-row" data-kind="link" data-id="${escapeHTML(String(l.id))}" data-row="${escapeHTML(String(l.id))}">
      <td class="ms-c-state" title="${escapeHTML(st.title)}"><span class="ms-line ${escapeHTML(st.cls)}">${_swatch(connectionKind(l), 30)}<span>${escapeHTML(st.word)}</span></span></td>
      <th scope="row" class="ms-c-name"><button type="button" class="ms-cell-btn" data-act="ms-pick-row" data-kind="link" data-id="${escapeHTML(String(l.id))}"
          aria-current="${sel ? 'true' : 'false'}">${escapeHTML(_linkTitle(l))}</button></th>
      <td>${escapeHTML(_natureText(l))}</td>
      <td class="ms-opt${l.provider ? '' : ' ms-dim'}">${escapeHTML(l.provider || '—')}</td>
      <td class="ms-opt ms-mono${l.circuitId ? '' : ' ms-dim'}">${escapeHTML(l.circuitId || '—')}</td>
      <td class="ms-dim ms-opt">${carried ? escapeHTML(_netsLabel(carried)) : '—'}</td></tr>`;
  }).join('');
  return `<table class="ms-table"><thead><tr>
      <th scope="col">${escapeHTML(t('ms.colState'))}</th><th scope="col">${escapeHTML(t('ms.colLink'))}</th>
      <th scope="col">${escapeHTML(t('ms.colNature'))}</th><th scope="col" class="ms-opt">${escapeHTML(t('org.provider'))}</th>
      <th scope="col" class="ms-opt">${escapeHTML(t('org.circuitId'))}</th><th scope="col" class="ms-opt">${escapeHTML(t('ms.colNets'))}</th></tr></thead>
    <tbody>${righe}</tbody></table>${righe ? '' : `<p class="org-note ms-pad">${escapeHTML(_links().length ? t('ms.noMatch') : t('org.emptyLinks'))}</p>`}`;
}

function _wanTable() {
  if (!_sites().length) return `<p class="org-note ms-pad">${escapeHTML(t('org.needSiteFirst'))}</p>`;
  const q = _q();
  const righe = _uplinks().filter(u => _hay(q, [_siteName(u.siteId), u.provider, u.serviceType, u.circuitId])).map(u => {
    const sel = u.id === _st.selUp;
    const nome = _siteName(u.siteId) || '?';
    return `<tr class="ms-tr${sel ? ' is-sel' : ''}" data-act="ms-pick-row" data-kind="wan" data-id="${escapeHTML(String(u.id))}" data-row="${escapeHTML(String(u.id))}">
      <th scope="row" class="ms-c-name"><button type="button" class="ms-cell-btn" data-act="ms-pick-row" data-kind="wan" data-id="${escapeHTML(String(u.id))}"
          aria-current="${sel ? 'true' : 'false'}">${escapeHTML(nome)}</button></th>
      <td>${u.serviceType ? `<span class="ms-pill">${escapeHTML(u.serviceType)}</span>` : '<span class="ms-dim">—</span>'}</td>
      <td class="${u.provider ? '' : 'ms-dim'}">${escapeHTML(u.provider || t('org.uplinkNoProvider'))}</td>
      <td class="ms-opt ms-mono${u.circuitId ? '' : ' ms-dim'}">${escapeHTML(u.circuitId || '—')}</td>
      <td class="ms-dim ms-opt">${u.cirMbps ? escapeHTML(String(u.cirMbps)) + ' ' + escapeHTML(t('ms.mbps')) : '—'}</td>
      <td class="ms-dim ms-opt">${u.addressing ? escapeHTML(t('org.addr.' + u.addressing)) : '—'}</td></tr>`;
  }).join('');
  return `<table class="ms-table"><thead><tr>
      <th scope="col">${escapeHTML(t('ms.colSite'))}</th><th scope="col">${escapeHTML(t('org.serviceType'))}</th>
      <th scope="col">${escapeHTML(t('org.provider'))}</th><th scope="col" class="ms-opt">${escapeHTML(t('org.circuitId'))}</th>
      <th scope="col" class="ms-opt">${escapeHTML(t('ms.colCir'))}</th><th scope="col" class="ms-opt">${escapeHTML(t('org.addressing'))}</th></tr></thead>
    <tbody>${righe}</tbody></table>${righe ? '' : `<p class="org-note ms-pad">${escapeHTML(_uplinks().length ? t('ms.noMatch') : t('org.emptyUplinks'))}</p>`}`;
}

/** La scheda a destra quando non c'è niente di scelto (o niente da scegliere). */
function _detailEmpty() {
  return `<div class="org-empty"><i class="fas fa-hand-pointer org-empty-icon"></i>
    <p class="org-empty-title">${escapeHTML(t('ms.pickTitle'))}</p>
    <p class="org-empty-sub">${escapeHTML(t('ms.pickSub'))}</p></div>`;
}

/** Il bottone che porta nella planimetria della sede: l'unica strada per «entrare» ora che il clic
 *  sulla sede la sceglie soltanto. Senza un progetto agganciato non si indovina — si dice che manca. */
function _openSiteBar(s) {
  const linked = s.projectRef && _st.projects.some(p => String(p.id) === String(s.projectRef));
  return `<div class="ms-open"><button type="button" class="um-btn primary" data-act="ms-open-site" data-site="${escapeHTML(String(s.id))}"${linked ? '' : ' disabled'}
      title="${escapeHTML(linked ? t('ms.openPlanTip') : t('org.noProject'))}"><i class="fas fa-diagram-project"></i> ${escapeHTML(t('ms.openPlan'))}</button></div>`;
}

/** La scheda della riga scelta: gli stessi campi di sempre, uno record per volta. */
function _detailHtml() {
  if (_st.tab === 'sites') {
    const i = _sites().findIndex(x => x.id === _st.selSite);
    return i < 0 ? _detailEmpty() : _openSiteBar(_sites()[i]) + _siteRowHtml(_sites()[i], i);
  }
  if (_st.tab === 'links') {
    const i = _links().findIndex(x => x.id === _st.selLink);
    return i < 0 ? _detailEmpty() : _providerDatalist() + _linkRowHtml(_links()[i], i);
  }
  if (_st.tab === 'wan') {
    const i = _uplinks().findIndex(x => x.id === _st.selUp);
    return _renderWanReport() + _wanSuggestions() + (i < 0 ? _detailEmpty() : _uplinkRowHtml(_uplinks()[i], i));
  }
  return '';
}

/** Lo scorrimento si salva per scheda (l'elenco) e per scheda+riga (la scheda della riga): cambiando
 *  scheda o riga si riparte dall'alto, che è giusto — il contenuto è un altro. */
let _scrollKeys = { master: null, detail: null };
/** L'ultima riga che si è portata sotto gli occhi: la si porta UNA volta per scelta, non a ogni ridisegno. */
let _revealDone = '';

/** Il nome dell'organizzazione nel campo di testa. Se ci si sta scrivendo dentro NON lo si tocca: rimetterci il
 *  valore del documento a metà frase farebbe saltare il cursore. */
function _renderOrgName() {
  const el = _el('ms-org-name');
  if (!el) return;
  el.disabled = !_isAdmin();
  if (document.activeElement !== el) el.value = _st.org.name || '';
}

function _renderTabs() {
  const host = _el('ms-tabs');
  if (!host) return;
  host.innerHTML = TABS.map(([k, icon, key]) => `<button type="button" role="tab" class="ms-tab${_st.tab === k ? ' active' : ''}" aria-selected="${_st.tab === k ? 'true' : 'false'}"
      data-act="org-tab" data-tab="${escapeHTML(k)}"><i class="fas ${escapeHTML(icon)}" aria-hidden="true"></i> <span>${escapeHTML(t(key))}</span>${k === 'sites' ? `<span class="ms-count">${Number(_sites().length)}</span>` : ''}${k === 'links' ? `<span class="ms-count">${Number(_links().length)}</span>` : ''}${k === 'wan' ? `<span class="ms-count">${Number(_uplinks().length)}</span>` : ''}${k === 'audit' ? _auditChips() : ''}</button>`).join('');
}

function _renderMaster() {
  const host = _el('ms-master');
  if (!host) return;
  const vecchio = _scrollKeys.master === _st.tab ? host.scrollTop : 0;
  if (_st.loading) { host.innerHTML = `<p class="org-note ms-pad">${escapeHTML(t('org.loading'))}</p>`; return; }
  if (_st.loadErr) {
    host.innerHTML = `<p class="org-bad ms-pad"><i class="fas fa-plug-circle-xmark"></i> ${escapeHTML(t('org.loadFailed'))} ${escapeHTML(_st.loadErr)}</p>
      <div class="ms-pad"><button class="um-btn" data-act="org-reload"><i class="fas fa-rotate"></i> ${escapeHTML(t('org.retry'))}</button></div>`;
    return;
  }
  host.innerHTML = _st.tab === 'links' ? _linksTable()
    : _st.tab === 'wan' ? _wanTable()
    : _st.tab === 'audit' ? `<div class="ms-audit">${_renderAudit()}</div>`
    : _sitesTable();
  host.scrollTop = vecchio;
  _scrollKeys.master = _st.tab;
  // La riga scelta, se è fuori vista (scelta dalla carta, o appena creata), si porta sotto gli occhi — una volta.
  const sceltaId = _st.tab === 'sites' ? _st.selSite : _st.tab === 'links' ? _st.selLink : _st.tab === 'wan' ? _st.selUp : '';
  const chiave = _st.tab + ':' + sceltaId;
  if (sceltaId && chiave !== _revealDone) {
    const riga = host.querySelector('tr.is-sel');
    if (riga) { riga.scrollIntoView({ block: 'nearest' }); _revealDone = chiave; }
  }
}

function _renderDetail() {
  const host = _el('ms-detail');
  if (!host) return;
  const dock = _el('ms-dock-body');
  if (dock) dock.classList.toggle('is-audit', _st.tab === 'audit');
  const sceltaId = _st.tab === 'sites' ? _st.selSite : _st.tab === 'links' ? _st.selLink : _st.tab === 'wan' ? _st.selUp : '';
  const chiave = _st.tab + ':' + sceltaId;
  const vecchio = _scrollKeys.detail === chiave ? host.scrollTop : 0;
  host.innerHTML = (_st.loading || _st.loadErr) ? '' : _detailHtml();
  host.scrollTop = vecchio;
  _scrollKeys.detail = chiave;
}

/**
 * Le azioni del cassetto, in testa a destra: «aggiungi» della scheda aperta e «Salva».
 *
 * ⚠️ Va ridisegnato separatamente dal resto, ed è il motivo per cui esiste come funzione: mentre si
 * scrive in un campo la scheda NON si ridisegna (rifarne l'HTML butterebbe via il cursore), ma lo stato
 * del bottone «Salva» cambia proprio in quel momento. Con un disegno solo, il bottone restava spento e
 * ciò che si era scritto non si poteva salvare. Qui dentro non c'è nessun campo di testo, quindi
 * ridisegnarlo a ogni tasto non toglie il fuoco a nessuno.
 */
function _renderFooter() {
  const host = _el('ms-actions');
  if (!host) return;
  if (_st.loading || _st.loadErr) { host.innerHTML = ''; return; }
  const ro = !_isAdmin();
  const a = _TAB_ADD[_st.tab];
  const drop = _st.dropped && (_st.dropped.sites || _st.dropped.uplinks || _st.dropped.links)
    ? `<span class="org-dropped"><i class="fas fa-filter-circle-xmark"></i> ${escapeHTML(
      t('org.dropped')
        .replace('{s}', String(_st.dropped.sites))
        .replace('{u}', String(_st.dropped.uplinks))
        .replace('{l}', String(_st.dropped.links)))}</span>`
    : '';
  host.innerHTML = `${drop}
    ${(a && !ro) ? `<button type="button" class="um-btn ms-add-btn" data-act="${escapeHTML(a[0])}"><i class="fas fa-plus"></i> ${escapeHTML(t(a[1]))}</button>` : ''}
    ${ro ? `<span class="org-note">${escapeHTML(t('org.readOnly'))}</span>`
    : `<button class="um-btn primary" data-act="org-save"${(_st.saving || !_st.dirty) ? ' disabled' : ''}>
        <i class="fas ${_st.saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}"></i> ${escapeHTML(_st.dirty ? t('org.save') : t('org.saved'))}</button>`}`;
}

/** Segna una modifica: accende il bottone «Salva» senza toccare il corpo.
 *  Solo al PRIMO tocco — a ogni tasto rifarebbe il piè di pagina per niente. */
function _touch() {
  if (_st.dirty) return;
  _st.dirty = true;
  _renderFooter();
}

/**
 * ⭐ L'altezza del cassetto. La carta sta sopra e prende lo spazio che resta: il cassetto lo dice con una
 * variabile (`--ms-dock-h`) sul contenitore, e Leaflet va avvisato quando la sua misura cambia o
 * resta tagliato in basso. Chiuso, restano la maniglia e la barra delle schede.
 */
const DOCK = { min: 180, bar: 53, step: 32, maxFrac: 0.76, mapMin: 260 };
function _applyDock() {
  const fp = _el('floorplan');
  const dock = _el('ms-dock');
  if (!fp || !dock) return;
  // Il cassetto non supera i tre quarti dello spazio, e la carta non scende sotto `mapMin`: una carta di poche decine di pixel,
  // con il tile che ne copre metà, non è una carta. Se la scheda non ci sta, si scorre — o si trascina la maniglia.
  const area = fp.clientHeight || 600;
  const max = Math.max(DOCK.min + 40, Math.min(Math.round(area * DOCK.maxFrac), area - DOCK.mapMin));
  _st.dockH = Math.max(DOCK.min, Math.min(max, _st.dockH));
  fp.style.setProperty('--ms-dock-h', (_st.view ? (_st.dockOpen ? _st.dockH : DOCK.bar) : 0) + 'px');
  dock.classList.toggle('is-collapsed', !_st.dockOpen);
  const b = _el('ms-dock-toggle');
  if (b) {
    b.setAttribute('aria-expanded', _st.dockOpen ? 'true' : 'false');
    b.setAttribute('aria-label', t(_st.dockOpen ? 'ms.dockClose' : 'ms.dockOpen'));
    b.title = t(_st.dockOpen ? 'ms.dockClose' : 'ms.dockOpen');
  }
  if (_geoMap) { try { _geoMap.invalidateSize(); } catch (_) { /* carta non pronta */ } }
}

// ── Il tile: i tipi di connessione (al posto dei selettori VLAN) ──────────

function _renderTile() {
  const host = _el('ms-tile');
  if (!host) return;
  // Senza niente da filtrare la scheda del tile non compare vuota: sparisce con tutto il suo bordo.
  const bar = host.parentElement;
  const vuota = () => { host.innerHTML = ''; if (bar) bar.classList.add('ms-empty'); };
  if (bar) bar.classList.remove('ms-empty');
  if (_st.loading || _st.loadErr) { vuota(); return; }
  const T = buildTile(_st.org, { hidden: _st.hiddenKinds, access: _st.accessSel });
  if (!T.kinds.length && !T.accesses.length && !T.noAccess) { vuota(); return; }

  const kinds = T.kinds.map(k => `<button type="button" class="ms-pill${k.hidden ? ' is-off' : ''}" data-act="ms-kind" data-kind="${escapeHTML(k.key)}"
      aria-pressed="${k.hidden ? 'false' : 'true'}">${_swatch(k.key, 20)}<span>${escapeHTML(_kindLabel(k.key))}</span><span class="ms-n">${Number(k.n)}</span></button>`).join('');

  const accPill = (key, label, n) => `<button type="button" class="ms-pill ms-pill-acc${_st.accessSel === key ? ' is-on' : ''}" data-act="ms-access" data-access="${escapeHTML(key)}" title="${escapeHTML(t('ms.accessHint'))}"
      aria-pressed="${_st.accessSel === key ? 'true' : 'false'}"><span>${escapeHTML(label)}</span><span class="ms-n">${Number(n)}</span></button>`;
  const acc = T.accesses.map(a => accPill(a.key, a.label, a.n)).join('')
    + (T.noAccess ? accPill(ACCESS_NONE, t('ms.accessNone'), T.noAccess) : '');
  let nota = '';        // la frase compare solo con un accesso scelto: prima, il suggerimento sta nel tooltip delle pastiglie
  if (_st.accessSel && T.accessSiteIds) {
    const a = T.accesses.find(x => x.key === _st.accessSel);
    const nome = _st.accessSel === ACCESS_NONE ? t('ms.accessNone') : (a ? a.label : _st.accessSel);
    const n = T.accessSiteIds.length;
    nota = (n === 1 ? t('ms.accessSelOne') : t('ms.accessSel').replace('{n}', String(n))).replace('{name}', nome);
  }

  host.innerHTML = `<div class="ms-tile-in" role="group" aria-label="${escapeHTML(t('ms.tileAria'))}">
    ${kinds ? `<div class="ms-row"><span class="ms-row-ico" role="img" title="${escapeHTML(t('org.tabLinks'))}" aria-label="${escapeHTML(t('org.tabLinks'))}"><i class="fas fa-link" aria-hidden="true"></i></span>${kinds}${T.hiddenLinks ? `<span class="ms-hid">${escapeHTML(T.hiddenLinks === 1 ? t('ms.hiddenOne') : t('ms.hiddenN').replace('{n}', String(T.hiddenLinks)))}
        <button type="button" class="ms-linkbtn" data-act="ms-kind-reset">${escapeHTML(t('ms.showAll'))}</button></span>` : ''}</div>` : ''}
    ${acc ? `<div class="ms-row"><span class="ms-row-ico" role="img" title="${escapeHTML(t('ms.tileAccess'))}" aria-label="${escapeHTML(t('ms.tileAccess'))}"><i class="fas fa-cloud-arrow-up" aria-hidden="true"></i></span>${acc}${nota ? `<span class="ms-note">${escapeHTML(nota)}</span>` : ''}</div>` : ''}
    <div class="ms-row ms-key" role="group" aria-label="${escapeHTML(t('ms.keyState'))}">
      <span class="ms-line is-up"><svg width="22" height="6" viewBox="0 0 22 6" aria-hidden="true"><path d="M1 3H21" stroke="currentColor" stroke-width="3" fill="none"/></svg>${escapeHTML(t('ms.keyUp'))}</span>
      <span class="ms-line is-down"><svg width="22" height="6" viewBox="0 0 22 6" aria-hidden="true"><path d="M1 3H21" stroke="currentColor" stroke-width="3" fill="none"/></svg>${escapeHTML(t('ms.keyDown'))}</span>
      <span class="ms-line is-unspoken"><svg width="22" height="6" viewBox="0 0 22 6" aria-hidden="true"><path d="M1 3H21" stroke="currentColor" stroke-width="3" fill="none"/></svg>${escapeHTML(t('ms.keyNone'))}</span></div>
  </div>`;
}

// ── Il centro: la carta (o lo schema) al posto della planimetria ──────────

function _renderStage() {
  const stage = _el('ms-stage');
  if (!stage) return;
  stage.dataset.mode = _st.mapMode;
  const modi = _el('ms-modes');
  if (modi) modi.innerHTML = _mapModeBar();
  const vuoto = !_sites().length;
  stage.classList.toggle('is-empty', vuoto);
  const empty = _el('ms-empty');
  if (empty) empty.innerHTML = (vuoto && !_st.loading && !_st.loadErr) ? _mapEmptyHtml() : '';
  _renderUnplaced();
  if (vuoto || _st.loading || _st.loadErr) { _destroyGeoMap(); return; }
  if (_st.mapMode === 'geo') {
    _syncGeoMap();
    return;
  }
  // Schema. Prima passata con la misura dichiarata, seconda con le larghezze vere (vedi `_measureBoxes`).
  _destroyGeoMap();
  const host = _el('ms-schema');
  if (!host) return;
  host.innerHTML = _renderMap(null);
  const misure = _measureBoxes(host.querySelector('svg.org-map'));
  if (misure) host.innerHTML = _renderMap(misure);
  _fitMapViewBox(host.querySelector('svg.org-map'));
  _applyMapView();
}

/**
 * Allarga il viewBox dello schema fino a contenere le ETICHETTE.
 *
 * `lib/inter-site-layout.js` dichiara di non misurare il testo (④): è un modulo
 * puro, e non può sapere quanto è largo «operatore non indicato» con il font di
 * questo browser — lascia un margine e lo dice. Qui invece il testo **è
 * disegnato**, quindi si misura per davvero, e si misura nel modo giusto:
 * `getBBox()` sull'SVG reso, che è l'ingombro vero di ciò che si vede.
 *
 * ⚠️ NON si copiano qui i font dal CSS per calcolarlo a mano: sarebbe una
 * definizione doppia che diverge al primo restyle, e in questo progetto è il bug
 * che torna più spesso. ⚠️ E non si usa `scrollWidth`, che misura il box e non
 * il testo. Se il disegno non è ancora impaginato `getBBox()` alza le mani: si
 * tiene il viewBox del layout, che è comunque un margine generoso.
 */
function _fitMapViewBox(svg) {
  // ㉖ ⚠️ Si misura il GRUPPO, non l'SVG. `getBBox()` risponde nello spazio
  // dell'elemento su cui lo chiami, PRIMA della sua trasformazione: chiedendolo
  // all'SVG l'ingombro seguirebbe lo zoom, e l'inquadratura «tutto dentro» si
  // rimpicciolirebbe a ogni giro di rotella inseguendo sé stessa. Al gruppo
  // risponde sempre lo stesso numero, qualunque sia la vista.
  const g = svg && typeof svg.querySelector === 'function' ? svg.querySelector('.org-map-zoom') : null;
  const target = g || svg;
  if (!target || typeof target.getBBox !== 'function') return;
  let b;
  try { b = target.getBBox(); } catch (_) { return; }
  if (!b || !(b.width > 0) || !(b.height > 0)) return;
  const m = 14;
  const r = (n) => Math.round(n * 100) / 100;
  svg.setAttribute('viewBox',
    `${r(b.x - m)} ${r(b.y - m)} ${r(b.width + m * 2)} ${r(b.height + m * 2)}`);
}

/** Ridisegna il cassetto (schede, tabella, scheda della riga), il tile, la carta e le azioni. Non fa niente a Multisito spento. */
function _render() {
  if (!_st.view) return;
  _ensureSel();
  _renderOrgName();
  _renderTabs();
  _renderMaster();
  _renderDetail();
  const cassetto = _el('ms-dock-body');
  if (cassetto) { _applyFocusLink(cassetto); _applyFocusNew(cassetto); }
  _renderTile();
  _fitDock();
  _renderStage();
  _renderFooter();
}

/**
 * Porta sotto gli occhi la riga appena creata.
 *
 * La riga nasce in fondo a un elenco, cioè fuori dallo schermo, e un'aggiunta che non si
 * vede sembra un'aggiunta che non è avvenuta.
 *
 * ⚠️ Nessun selettore costruito con l'id dentro: si confrontano i dataset, come
 * fa `_applyFocusLink` e per la stessa ragione (un id arriva anche da un
 * documento importato).
 */
function _applyFocusNew(body) {
  if (!_st.focusNew) return;
  const row = Array.from(body.querySelectorAll('[data-row]')).find(r => r.dataset.row === _st.focusNew);
  if (!row) return;                       // altra scheda, o riga sparita: si riproverà
  row.scrollIntoView({ block: 'center' });
  row.classList.add('org-row-target');
  _st.focusNew = null;
}

/**
 * ⑭ Porta sotto gli occhi la riga del collegamento che la mappa ha indicato.
 *
 * Non basta cambiare scheda: in un elenco di dodici collegamenti la riga
 * cercata è una delle dodici, e ritrovarla a occhio è la fatica che il clic
 * doveva togliere.
 *
 * ⚠️ La richiesta si consuma solo quando NON si sta aspettando un progetto.
 * Quando i progetti arrivano si ridisegna: l'HTML della riga viene rifatto e
 * lo scorrimento torna in cima. Tenendo la richiesta, il secondo disegno la
 * riporta dov'era — altrimenti il salto durerebbe il tempo di una fetch.
 *
 * ⚠️ Nessun selettore costruito con l'id dentro: un id arriva anche da un
 * documento importato, e infilarlo in una stringa di selettore è un'iniezione
 * che aspetta. Si confrontano i dataset, che è anche più corto.
 */
function _applyFocusLink(body) {
  if (!_st.focusLink) return;
  const row = Array.from(body.querySelectorAll('[data-row]')).find(r => r.dataset.row === _st.focusLink);
  if (!row) return;                       // altra scheda, o riga sparita: si riproverà
  row.scrollIntoView({ block: 'center' });
  row.classList.add('org-row-target');    // si spegne da sé: l'animazione finisce
  if (!_st.warming) _st.focusLink = null;
}

// Lo schema, sul centro: rotella e trascinamento. Un listener SOLO, sul contenitore che non
// viene mai ricostruito: `_renderStage()` rifà l'SVG a ogni giro, e agganciarsi lì vorrebbe dire
// riagganciarsi ogni volta — con il rischio, noto in questo codice, di dimenticarsene una.
let _wired = false;
function _wireStage() {
  if (_wired) return;
  const ov = _el('ms-stage');
  if (!ov) return;
  // ⚠️ `passive: false`: senza, il browser ignora `preventDefault()` e la rotella
  // fa scorrere il pannello INVECE di ingrandire. È il difetto che si vede solo
  // provandolo, e solo con un pannello più alto dello schermo.
  ov.addEventListener('wheel', (e) => {
    if (!e.target.closest || !e.target.closest('.org-map-frame')) return;
    e.preventDefault();
    _zoomMap(e.deltaY > 0 ? -MAP_ZOOM.step : MAP_ZOOM.step, e);
  }, { passive: false });
  // ⚠️ La rotella NON deve risalire alla planimetria: `#floorplan` ha un `onwheel` che ingrandisce il
  // pavimento (nascosto) e chiama `preventDefault()` — cioè farebbe scorrere NIENTE nelle tabelle del
  // cassetto, e girando la rotella sulla carta cambierebbe lo zoom di un pavimento che non si vede.
  // Il clic invece non si ferma: i gestori di documento (menu da chiudere) lo vogliono.
  for (const id of ['ms-stage', 'ms-dock']) {
    const el = _el(id);
    if (el) el.addEventListener('wheel', (e) => e.stopPropagation());
  }
  // La maniglia: si trascina in su e in giù, e Leaflet viene avvisato a ogni passo.
  const grip = _el('ms-dock-grip');
  if (grip) {
    let da = null;
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      da = { y: e.clientY, h: _st.dockOpen ? _st.dockH : DOCK.bar };
      _st.dockOpen = true;
      _st.dockAuto = false;              // da qui l'altezza la decide chi ha trascinato
      try { grip.setPointerCapture(e.pointerId); } catch (_) { /* niente cattura: si trascina lo stesso */ }
      e.preventDefault();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!da) return;
      _st.dockH = da.h + (da.y - e.clientY);
      _applyDock();
    });
    for (const ev of ['pointerup', 'pointercancel']) grip.addEventListener(ev, () => { da = null; });
  }
  window.addEventListener('resize', () => { if (_st.view) _applyDock(); });

  // Il trascinamento parte SOLO dallo sfondo. Sui riquadri e sulle pastiglie il
  // clic ha già un significato — scegliere la sede, aprire il collegamento — e
  // un trascinamento che parte da lì li renderebbe difficili da premere.
  let trascina = null;
  ov.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !e.target.closest) return;
    const frame = e.target.closest('.org-map-frame');
    if (!frame || e.target.closest('.org-edge-chip') || e.target.closest('.org-node')) return;
    const p = _mapPoint(_mapSvg(), e);
    if (!p) return;
    trascina = { px: p.x, py: p.y, x: _st.mapView.x, y: _st.mapView.y };
    frame.classList.add('is-panning');
    try { frame.setPointerCapture(e.pointerId); } catch (_) { /* niente cattura: si trascina lo stesso */ }
  });
  ov.addEventListener('pointermove', (e) => {
    if (!trascina) return;
    const p = _mapPoint(_mapSvg(), e);
    if (!p) return;
    // ⚠️ Si converte OGNI volta invece di sommare i pixel: le unità del disegno
    // e quelle dello schermo non stanno in rapporto fisso — dipende da quanto è
    // largo il pannello — e sommare pixel farebbe scivolare la mappa sotto il dito.
    _st.mapView.x = trascina.x + (p.x - trascina.px);
    _st.mapView.y = trascina.y + (p.y - trascina.py);
    _applyMapView();
  });
  for (const ev of ['pointerup', 'pointercancel']) {
    ov.addEventListener(ev, () => {
      if (!trascina) return;
      trascina = null;
      const f = _el('ms-schema') && _el('ms-schema').querySelector('.org-map-frame');
      if (f) f.classList.remove('is-panning');
    });
  }
  _wired = true;
}

/**
 * ⭐ Accende o spegne il Multisito. Acceso, ricarica dal server: l'organizzazione è una per
 * installazione, e potrebbe averla cambiata un altro amministratore.
 * ⚠️ Con modifiche non salvate NON si ricarica: la risposta del server rimpiazzerebbe lo stato in
 * lavorazione, cioè butterebbe via ciò che si stava scrivendo, senza chiedere e senza dirlo. E per
 * lo stesso motivo non si SPEGNE senza chiedere.
 * Una vista alla volta: la Panoramica cede il posto.
 */
export function setMultisite(on, forza) {
  const voglio = !!on;
  if (voglio === _st.view) return;
  if (!voglio && _st.dirty && !forza) {
    showConfirm(t('org.confirmDiscard'), () => { _st.dirty = false; setMultisite(false, true); });
    return;
  }
  _st.view = voglio;
  document.body.classList.toggle('view-multisite', voglio);
  const stage = _el('ms-stage');
  if (stage) stage.hidden = !voglio;
  const cassetto = _el('ms-dock');
  if (cassetto) cassetto.hidden = !voglio;
  const btn = _el('btn-org');
  if (btn) btn.setAttribute('aria-pressed', voglio ? 'true' : 'false');
  if (voglio) {
    if (document.body.classList.contains('view-overview') && typeof setOverview === 'function') setOverview(false);
    store._viewMode = 'multisite';
    _wireStage();
    if (_st.dirty) { _applyDock(); _render(); }
    else {
      _st.tab = 'sites'; _st.dropped = null; _st.wanReport = null; _st.wanBusy = false; _st.geoFind = null;
      _applyDock();
      _render();
      _load();
    }
    _loadGeocoderStatus();
  } else {
    _destroyGeoMap();
    _applyDock();                      // a vista spenta l'altezza torna a zero: la planimetria ha di nuovo tutto lo spazio
    store._viewMode = store._topoVisible ? 'topology' : 'map';
  }
  if (typeof renderSubbar === 'function') renderSubbar();
}

export function toggleMultisite() { setMultisite(!_st.view); }

/** Sceglie una sede (dalla tabella o dalla carta): la scheda «Sedi» passa a lei e il suo cerchio si
 *  evidenzia. `pan`: dalla tabella la carta si sposta sulla sede, dalla carta no — chi ha cliccato
 *  sul cerchio lo vede già dov'è, e uno spostamento sotto il dito è il modo di sbagliare il clic dopo. */
function _pickSite(siteId, pan) {
  const s = _sites().find(x => x.id === siteId);
  if (!s) return;
  _st.selSite = s.id; _st.tab = 'sites'; _st.focusLink = null;
  _render();
  if (pan && _geoMap && s.geo) { try { _geoMap.panTo([s.geo.lat, s.geo.lng]); } catch (_) { /* carta non pronta */ } }
}

/** Sceglie un collegamento: la sua riga, e sulla carta si accende. Se la carta non lo mostra per intero
 *  la si porta sul suo punto di mezzo. */
function _pickLink(linkId, pan) {
  const l = _links().find(x => x.id === linkId);
  if (!l) return;
  _st.selLink = l.id; _st.tab = 'links'; _st.focusLink = null;
  _render();
  const a = _sites().find(x => x.id === l.aSiteId), b = _sites().find(x => x.id === l.bSiteId);
  if (pan && _geoMap && a && b && a.geo && b.geo) {
    try { _geoMap.panTo([(a.geo.lat + b.geo.lat) / 2, (a.geo.lng + b.geo.lng) / 2]); } catch (_) { /* carta non pronta */ }
  }
}

/** Sceglie una linea WAN: la sua riga, e la sua sede si evidenzia sulla carta. */
function _pickUplink(upId) {
  const u = _uplinks().find(x => x.id === upId);
  if (!u) return;
  _st.selUp = u.id; _st.selSite = u.siteId; _st.tab = 'wan'; _st.focusLink = null;
  _render();
}

/** Dal collegamento (la pastiglia sullo schema, la linea sulla carta, la riga della sede) alla sua riga.
 *  Si scaldano i progetti come fa `org-tab`: le due tendine degli apparati vivono di quelli. */
function _goToLink(linkId) {
  _st.focusLink = linkId || null;
  if (linkId) _st.selLink = linkId;
  _st.tab = 'links';
  _render();
  _warmProjects(_links()
    .flatMap(l => [l.aSiteId, l.bSiteId])
    .map(id => (_sites().find(s => s.id === id) || {}).projectRef));
}

/** Si scende nel progetto-sede. Senza un riferimento valido non si indovina un progetto — si dice che manca. */
function _openSite(siteId) {
  const s = _sites().find(x => x.id === siteId);
  if (!s) return;
  const p = s.projectRef && _st.projects.find(x => String(x.id) === String(s.projectRef));
  if (!p) { showAlert(t('org.noProjectFor').replace('{name}', s.name)); return; }
  const vai = () => { setMultisite(false, true); switchProject(p.id); };
  if (_st.dirty) {
    showConfirm(t('org.confirmDiscard'), () => { _st.dirty = false; vai(); });
    return;
  }
  vai();
}

registerClickActions({
  'org-zoom': (el) => _zoomMap(Number(el.dataset.delta) || 0, null),
  'org-zoom-fit': () => _fitMap(),
  // Il bottone «Multisito» della testata: un interruttore, non un'apertura.
  'org-open': () => toggleMultisite(),
  'org-reload': () => { _load(); },
  // Si disegna SUBITO con quello che si ha, e i progetti-sede arrivano dopo: la
  // scheda «Collegamenti» ha bisogno degli apparati per riempire le due tendine,
  // ma aspettarli lascerebbe il pannello fermo. Le tendine dicono «carico…»
  // finché non ci sono, e `_warmProjects` ridisegna una volta sola alla fine.
  'org-tab': (el) => {
    const k = el.dataset.tab;
    _st.tab = (k === 'links' || k === 'wan' || k === 'audit') ? k : 'sites';
    _st.focusLink = null;
    // Cambiando tabella si resta sulla STESSA sede, se ha qualcosa da mostrare: scelta una sede, la scheda
    // «Linee WAN» apre la sua prima linea e «Collegamenti» il suo primo collegamento, invece di una riga qualunque.
    if (_st.selSite) {
      if (_st.tab === 'wan') {
        const mia = _uplinks().find(u => u.siteId === _st.selSite);
        if (mia) _st.selUp = mia.id;
      } else if (_st.tab === 'links') {
        const mio = _links().find(l => l.aSiteId === _st.selSite || l.bSiteId === _st.selSite);
        if (mio) _st.selLink = mio.id;
      }
    }
    _render();
    if (_st.tab === 'links') {
      _warmProjects(_links()
        .flatMap(l => [l.aSiteId, l.bSiteId])
        .map(id => (_sites().find(s => s.id === id) || {}).projectRef));
    }
  },
  'org-save': () => { _save(); },
  'org-add-site': () => _addSite(),
  'org-add-uplink': () => _addUplink(),
  'org-add-link': () => _addLink(),
  'org-del-site': (el) => _removeSite(Number(el.dataset.idx)),
  'org-del-uplink': (el) => {
    const i = Number(el.dataset.idx);
    _st.org.uplinks = _uplinks().filter((_, k) => k !== i);
    _st.dirty = true; _render();
  },
  'org-del-link': (el) => {
    const i = Number(el.dataset.idx);
    _st.org.links = _links().filter((_, k) => k !== i);
    _st.dirty = true; _render();
  },
  // Il riquadro dello schema: sceglie la sede, come il cerchio sulla carta. (Prima apriva il progetto.)
  'org-node': (el) => _pickSite(el.dataset.site || '', false),
  'ms-pick-site': (el) => _pickSite(el.dataset.site || '', true),
  'ms-open-site': (el) => _openSite(el.dataset.site || ''),
  // Dall'elenco delle linee: si sceglie la sede e si apre quella linea nella sua scheda.
  // Una riga della tabella aperta: sceglie sede, collegamento o linea secondo di cosa è la riga.
  'ms-pick-row': (el) => {
    const id = el.dataset.id || '';
    if (el.dataset.kind === 'link') _pickLink(id, true);
    else if (el.dataset.kind === 'wan') _pickUplink(id);
    else _pickSite(id, true);
  },
  'ms-dock-toggle': () => { _st.dockOpen = !_st.dockOpen; _applyDock(); },
  // Il tile. Un tipo spento si guarda, non si documenta: nessun «da salvare».
  'ms-kind': (el) => {
    const k = el.dataset.kind || '';
    const prossimo = Object.assign({}, _st.hiddenKinds);
    if (prossimo[k]) delete prossimo[k]; else prossimo[k] = true;
    _st.hiddenKinds = prossimo;
    _renderTile(); _renderStage();
  },
  'ms-kind-reset': () => { _st.hiddenKinds = {}; _renderTile(); _renderStage(); },
  'ms-access': (el) => {
    const k = el.dataset.access || '';
    _st.accessSel = _st.accessSel === k ? '' : k;
    _renderTile(); _renderStage();
  },
  // ⑭ Dalla mappa alla riga. Si scaldano i progetti come fa `org-tab`: le due
  // tendine degli apparati vivono di quelli, e arrivarci dalla mappa non è un
  // modo diverso di aprire la stessa scheda.
  'org-link': (el) => _goToLink(el.dataset.link || null),
  'org-nets-from-project': (el) => { _netsFromProject(Number(el.dataset.idx)); },
  'org-wan-from-dcim': (el) => { _wanFromDcim(Number(el.dataset.idx)); },
  // Il punto di una sede: «Trova» PROPONE, «Usa» sceglie, «Togli» svuota.
  // La carta o lo schema.
  'org-map-mode': (el) => { _st.mapMode = el.dataset.mode === 'schema' ? 'schema' : 'geo'; _render(); },
  'org-geo-find': (el) => { _geoFind(Number(el.dataset.idx)); },
  'org-geo-dcim': (el) => { _geoFromDcim(Number(el.dataset.idx)); },
  'org-geo-use': (el) => _geoUse(Number(el.dataset.idx), Number(el.dataset.cand)),
  'org-geo-clear': (el) => _geoClear(Number(el.dataset.idx)),
  // L'esito resta finché non lo si congeda: è un elenco da leggere, non un
  // lampo. Chiuderlo non tocca le righe già iscritte.
  'org-wan-clear': () => { _st.wanReport = null; _render(); },
});

registerInputActions({
  'org-name': (el) => { _st.org.name = el.value; _touch(); },
  // La ricerca dell'elenco: ridisegna SOLO l'elenco, non il campo in cui si sta scrivendo.
  'ms-filter': (el) => { _st.filter = el.value; _renderMaster(); },
  // Volutamente NESSUN re-render mentre si scrive: rifare l'HTML a ogni tasto
  // butterebbe via il cursore.
  'org-field': (el) => _setField(el),
  // Le due coordinate: come gli altri campi, niente ridisegno mentre si scrive.
  'org-geo': (el) => _setGeoAxis(el),
});

// ⚠️ `role="button"` senza tastiera è un'etichetta che mente: chi naviga col
// tabulatore arriva sull'elemento, legge «bottone» e preme invano. Il riquadro
// della sede lo prometteva già da prima; ora tutti e due lo mantengono.
registerKeydownActions({
  // La maniglia del cassetto si governa anche da tastiera: freccia su = più alto, giù = più basso.
  'ms-grip': (el, ev) => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    ev.preventDefault();
    _st.dockOpen = true;
    _st.dockAuto = false;
    _st.dockH += ev.key === 'ArrowUp' ? DOCK.step : -DOCK.step;
    _applyDock();
  },
  'org-activate': (el, ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();   // o la barra fa scorrere il pannello sotto le dita
    dispatchClick(el, ev);
  },
});

registerChangeActions({
  'org-field': (el) => _setField(el),
  // Una spunta per linea: si aggiunge o si toglie SOLO quella, invece di
  // ricostruire la lista dalla selezione di una casella multipla — che era il
  // modo in cui un clic distratto azzerava tutto il resto.
  'org-underlay': (el) => {
    const l = _links()[Number(el.dataset.idx)];
    if (!l) return;
    const id = el.dataset.uplink;
    const attuali = (l.underlayUplinkIds || []).filter(x => x !== id);
    l.underlayUplinkIds = el.checked ? attuali.concat(id) : attuali;
    _touch();
  },
});

// Chi accende il Multisito senza passare dal bottone (il «torna su» della sotto-header) e la
// Panoramica, che gli cede il posto, lo chiamano per nome: stesso schema di `renderSubbar`.
expose({ setMultisite, toggleMultisite });
