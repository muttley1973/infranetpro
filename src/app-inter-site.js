// ============================================================
// SEDI E COLLEGAMENTI — il layer multi-sede visto dall'utente (Fase 1).
// ------------------------------------------------------------
// Un progetto InfraNet documenta UN edificio. Questo pannello è il piano di
// sopra: l'organizzazione, le sue sedi (ognuna un RIFERIMENTO a un progetto, mai
// una copia), gli uplink WAN e i collegamenti che le legano — su una mappa, e
// scrivibili a mano.
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
// L'a11y (focus-trap + Esc) è automatica: è un `.tool-modal-overlay`.
// ============================================================
import { t } from './_bridge.js';
import { escapeHTML, uid } from './app-util.js';
import { store } from './store.js';
import { showAlert, showConfirm, switchProject } from './app-core.js';
import { registerClickActions, registerChangeActions, registerInputActions, registerKeydownActions, dispatchClick } from './app-delegation.js';
import { buildInterSiteLayout, interSiteEdgePath } from '../lib/inter-site-layout.js';
import { SITE_ROLES, INTER_SITE_KINDS, INTER_SITE_TOPOLOGIES, INTER_SITE_STATES } from '../lib/inter-site.js';
import { factDeclared, factOrigin, factValue, isFact } from '../lib/provenance.js';
import { subnetInputToCidr, addrFamily } from '../lib/cidr.js';
import { prefixesOf, migrateIpam } from '../lib/ipam-model.js';   // l'autorità sulle reti DICHIARATE di un progetto
import { nodeLabelParts } from '../lib/node-label.js';
import { orgContextInvalidate } from './app-org-context.js';
import { TYPES } from './app-types.js';

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
  tab: 'map',
  dirty: false,
  saving: false,
  loading: false,
  loadErr: '',
  /** ⑭ Il collegamento a cui la mappa ha appena mandato: la riga da portare
   *  sotto gli occhi al prossimo disegno. `null` = nessuno. */
  /** @type {string|null} */ focusLink: null,
  /** ⚠️ Vero mentre i progetti-sede stanno arrivando. Serve SOLO a `focusLink`:
   *  quando arrivano si ridisegna, l'HTML della riga viene rifatto da capo e
   *  con esso se ne va lo scorrimento. Finché è vero, la richiesta di messa a
   *  fuoco non si consuma — o il salto durerebbe un decimo di secondo. */
  warming: false,
};

function _el(id) { return document.getElementById(id); }
const _isAdmin = () => !(store._currentUser && store._currentUser.role === 'viewer');

// ── Rete ──────────────────────────────────────────────────────────────────

/** Adotta la risposta del server come verità (③). */
function _adopt(j) {
  _st.org = (j && j.organization) ? j.organization : EMPTY_ORG();
  _st.audit = (j && j.audit) || null;
  _st.unknownRefs = (j && j.unknownProjectRefs) || [];
  _st.dirty = false;
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_st.org),
    });
    if (r.status === 403) { showAlert(t('org.saveForbidden')); return; }
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
    if (f === 'cirMbps') row.cirMbps = v === '' ? null : Number(v);
    else if (f === 'publicIps') { const l = _splitNets(v); row.publicIps = l.length ? factDeclared(l) : null; _paintAddrHint(el); }
    else if (f === 'wanIfRef') _setFact(row, f, v);
    else row[f] = v;                                   // siteId, provider, serviceType, circuitId, slaRef
    return;
  }
  // link
  switch (f) {
    case 'state':
      row.state = v ? factDeclared(v) : null;          // «—» = non pronunciato, che NON è «giù»
      break;
    case 'topology': row.topology = v || null; break;
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
    default: row[f] = v; break;                        // aSiteId, bSiteId, kind, vrf, service, overlay, media, phase1Name
  }
  // `kind` cambia QUALI campi esistono; cambiare un capo cambia il titolo della
  // riga, le etichette di `reach` e — soprattutto — l'elenco dell'altra tendina,
  // che deve smettere di offrire la sede appena scelta. Sono tutti `change` su
  // una tendina: ridisegnare non toglie il cursore a nessuno.
  if (f === 'kind' || f === 'aSiteId' || f === 'bSiteId') _render();
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

// ── Righe: aggiunta e rimozione ───────────────────────────────────────────

function _addSite() {
  _sites().push({ id: uid('site'), name: t('org.newSiteName'), role: 'standalone', projectRef: null, address: null, subnets: [] });
  _st.dirty = true; _st.tab = 'sites'; _render();
}
function _addUplink() {
  const s = _sites()[0];
  if (!s) { showAlert(t('org.needSiteFirst')); return; }
  _uplinks().push({ id: uid('wan'), siteId: s.id, provider: '', serviceType: '', circuitId: '', cirMbps: null, slaRef: '', publicIps: null, wanIfRef: null });
  _st.dirty = true; _st.tab = 'wan'; _render();
}
function _addLink() {
  const ss = _sites();
  if (ss.length < 2) { showAlert(t('org.needTwoSites')); return; }
  _links().push({
    id: uid('isl'), aSiteId: ss[0].id, bSiteId: ss[1].id, kind: 'ipsec',
    topology: null, state: null, reach: null, provider: null, circuitId: null, name: null,
    endpointA: { deviceRef: null, peerIp: null }, endpointB: { deviceRef: null, peerIp: null },
    phase1Name: null, ikeVersion: null,
  });
  _st.dirty = true; _st.tab = 'links'; _render();
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
  _st.tab = 'wan';
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
      // ⚠️ Il resto NON si riempie: l'SLA non sta in NetBox, e gli indirizzi
      // pubblici non si deducono dall'IP di un'interfaccia WAN — dietro a una
      // linea business ci sono NAT e blocchi instradati, e scriverne uno
      // sbagliato in un campo dichiarato è peggio di lasciarlo vuoto.
      slaRef: '', publicIps: null, wanIfRef: null,
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
    const chiave = _linkKey(c.name, c.provider, c.circuitId, c.kindLabel);
    const dup = _links().some(l => _linkKey(l.name, l.provider, l.circuitId, l.kindLabel) === chiave
      && ((l.aSiteId === a && l.bSiteId === b) || (l.aSiteId === b && l.bSiteId === a)));
    if (dup) { alreadyLinks++; continue; }
    // La natura la porta il candidato: dai `circuits` è sempre `other` (il tipo
    // è testo libero dell'istanza), da `vpn/` è quella vera, perché là il
    // vocabolario di NetBox è chiuso quanto il nostro.
    const kind = INTER_SITE_KINDS.indexOf(c.kind) >= 0 ? c.kind : 'other';
    const row = {
      id: uid('isl'), aSiteId: a, bSiteId: b,
      kind, kindLabel: kind === 'other' ? (c.kindLabel || null) : null,
      name: c.name || null,
      topology: INTER_SITE_TOPOLOGIES.indexOf(c.topology) >= 0 ? c.topology : null,
      state: null, reach: null,
      provider: c.provider || null, circuitId: c.circuitId || null,
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
    _st.dirty = true; _render();
  });
}

// ── Mappa (⑤: le coordinate arrivano dal modulo puro) ─────────────────────

const KIND_ICON = { ipsec: 'fa-lock', mpls: 'fa-network-wired', vpls: 'fa-diagram-project', sdwan: 'fa-cloud-bolt', directLink: 'fa-grip-lines', other: 'fa-circle-question' };

/**
 * Come si CHIAMA un collegamento, a schermo. Per le cinque nature è la loro
 * parola; per `other` (⑨) sono le parole di chi l'ha documentato — «FWA
 * punto-punto» dice qualcosa, «Altro» no. Sta in una funzione sola perché la
 * mappa, l'intestazione della riga e l'audit devono dire lo stesso nome: due
 * posti che lo compongono da soli sono il modo in cui divergono.
 */
function _kindText(l) {
  if (!l) return '';
  if (l.kind === 'other' && l.kindLabel) return String(l.kindLabel);
  return t('org.kind.' + l.kind);
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
  const L = buildInterSiteLayout(_st.org, opts || undefined);
  if (L.layout === 'empty') {
    return `<div class="org-empty">
      <i class="fas fa-sitemap org-empty-icon"></i>
      <p class="org-empty-title">${escapeHTML(t('org.emptyTitle'))}</p>
      <p class="org-empty-sub">${escapeHTML(t('org.emptySub'))}</p>
      ${_isAdmin() ? `<button class="um-btn primary" data-act="org-add-site"><i class="fas fa-plus"></i> ${escapeHTML(t('org.addSite'))}</button>` : ''}
    </div>`;
  }
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
    const label = _kindText(l) + (carried ? ' · ' + _netsLabel(carried) : '');
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
      <g class="org-edge-chip" data-act="org-link" data-keydown="org-activate" data-link="${escapeHTML(String(e.linkId))}"
         tabindex="0" role="button" aria-label="${escapeHTML(t('org.editLink').replace('{link}', _linkName(e.linkId, l && l.kind)))}">
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
    return `<g class="org-node ${linked ? 'is-linked' : 'is-unlinked'}" data-act="org-node" data-keydown="org-activate" data-site="${escapeHTML(n.siteId)}" data-boxh="${Number(_boxHeight(righe))}" tabindex="0" role="button">
      <title>${escapeHTML(n.name + ' · ' + t('org.role.' + n.role) + (linked ? '' : ' · ' + t('org.noProject')))}</title>
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

  return `<div class="org-map-wrap">
    <svg class="org-map" viewBox="0 0 ${Number(L.width)} ${Number(L.height)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHTML(t('org.mapAria'))}">
      ${edges}${nodes}
    </svg>
    <p class="org-map-hint">${escapeHTML(L.layout === 'hub' ? t('org.layoutHub') : t('org.layoutRing'))} · ${escapeHTML(t('org.clickSite'))}${
      // Un'istruzione per una mossa che a schermo non c'è è un'istruzione che
      // fa cercare qualcosa di inesistente: la pastiglia si nomina solo se
      // almeno un arco è disegnato.
      L.edges.length ? ' · ' + escapeHTML(t('org.clickLink')) : ''}</p>
    ${warn}
  </div>`;
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
 * Quali linee WAN trasportano questo overlay SD-WAN.
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
  const righe = _uplinks().map(u => `
    <label class="org-check">
      <input type="checkbox" ${ro ? 'disabled' : ''} ${scelti.includes(u.id) ? 'checked' : ''}
             data-change="org-underlay" data-idx="${i}" data-uplink="${escapeHTML(u.id)}">
      <span>${escapeHTML((u.provider || t('org.uplinkNoProvider')) + ' · ' + (_siteName(u.siteId) || u.siteId))}</span>
    </label>`).join('');
  return `<div class="org-f org-f-wide org-f-underlay"><span>${escapeHTML(t('org.underlay'))}</span>
    ${righe || `<p class="org-note">${escapeHTML(t('org.underlayNone'))}</p>`}</div>`;
}

function _fieldsOfKind(l, i) {
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
  const F = (field, label, val, ph, hint) => `<label class="org-f"><span>${escapeHTML(label)}</span>
    <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(val == null ? '' : val)}" ${ph ? `placeholder="${escapeHTML(ph)}"` : ''}
      data-input="org-field" data-scope="link" data-idx="${i}" data-field="${escapeHTML(field)}">
    ${hint ? `<small class="org-hint">${escapeHTML(hint)}</small>` : ''}</label>`;
  switch (l.kind) {
    case 'ipsec':
      // ⚠️ Gli APPARATI dei due capi non stanno qui: valgono per ogni `kind` e
      // si disegnano una volta sola in `_renderLinks`. Qui restano gli IP dei
      // peer, che sono davvero una cosa da tunnel — su un MPLS non vogliono
      // dire niente, e un campo che non vuole dire niente invita a riempirlo.
      // ⚠️ «visto da», non «presso»: `endpointA.peerIp` è l'indirizzo dell'ALTRO
      // capo — quello che si scrive nella configurazione del tunnel SU A. Un
      // «IP del peer presso Verona» direbbe l'esatto contrario, e nessuno a
      // valle potrebbe accorgersene: sono due indirizzi ugualmente plausibili nei due campi sbagliati.
      return F('peerA', _atSite('org.peerA', l.aSiteId), (l.endpointA || {}).peerIp, '203.0.113.1')
        + F('peerB', _atSite('org.peerB', l.bSiteId), (l.endpointB || {}).peerIp, '198.51.100.1')
        + F('phase1Name', t('org.phase1'), l.phase1Name)
        + `<label class="org-f"><span>${escapeHTML(t('org.ike'))}</span>
            <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="link" data-idx="${i}" data-field="ikeVersion">
              ${_opt('', '—', l.ikeVersion == null ? '' : l.ikeVersion)}${_opt('1', 'IKEv1', l.ikeVersion)}${_opt('2', 'IKEv2', l.ikeVersion)}
            </select></label>`;
    case 'mpls':
    case 'vpls':
      return F('vrf', 'VRF', l.vrf) + F('service', t('org.service'), l.service);
    case 'sdwan':
      return F('overlay', t('org.overlay'), l.overlay, t('org.overlayPh'), t('org.overlayHint'))
        + _underlayField(l, i, ro);
    case 'directLink':
      return F('media', t('org.media'), l.media, t('org.mediaPh'));
    case 'other':
      // ⑨ Il campo che rende `other` diverso da un buco — le parole di chi
      // documenta — NON sta qui: sta attaccato alla tendina «Tecnologia», in
      // `_renderLinks`. Gli altri `kind` portano PROPRIETÀ del collegamento
      // (il VRF, l'overlay, il mezzo); questo invece COMPLETA la natura stessa,
      // ed è la risposta alla stessa domanda della tendina, scritta a parole.
      // Staccarlo di sei campi lo faceva leggere come una domanda a sé — ed è
      // esattamente così che è stato segnalato («ma non è lo stesso di Stato?»).
      return '';
    default:
      return '';
  }
}

function _renderSites() {
  const ro = !_isAdmin();
  const rows = _sites().map((s, i) => {
    const bad = _badNets(s.subnets);
    const unknown = _st.unknownRefs.some(u => u.siteId === s.id);
    return `<article class="org-row">
      <header class="org-row-head">
        <i class="fas ${escapeHTML(ROLE_ICON[s.role] || 'fa-building')}"></i>
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
        <label class="org-f org-f-wide"><span>${escapeHTML(t('org.subnets'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML((s.subnets || []).join(' '))}" placeholder="10.1.0.0/24 10.1.1.0/24"
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
  }).join('');
  return rows + (ro ? '' : `<button class="um-btn primary org-add" data-act="org-add-site"><i class="fas fa-plus"></i> ${escapeHTML(t('org.addSite'))}</button>`);
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
  const key = PREFISSO[m[1]] + m[2];
  const s = t(key);
  if (!s || s === key) return '';        // codice che non conosciamo: si tace, non si stampa una chiave
  return s
    .replace('{n}', String(n.n == null ? '' : n.n))
    .replace('{circuitId}', String(n.circuitId || '—'))
    .replace('{site}', String(n.site || '—'))
    .replace('{type}', String(n.type || '—'))
    .replace('{name}', String(n.name || '—'))
    .replace('{id}', String(n.id || '—'))
    .replace('{error}', String(n.error || '—'))
    .replace('{clouds}', ((n.clouds || []).join(', ')))
    .replace('{sites}', ((n.sites || []).join(', ')))
    .replace('{rows}', (n.rows || []).map(r => String(r.circuitId || r.name || '—') + ' (' + String(r.status || '') + ')').join(', '));
}

function _renderWanReport() {
  const r = _st.wanReport;
  if (!r) return '';
  const righe = (r.notes || []).map(_wanNoteText).filter(Boolean);
  // «Aggiunto 1 collegamenti» fa dubitare del resto di ciò che c'è scritto
  // sopra: il singolare non è un dettaglio di stile. E una riga «0 su 0» accanto
  // a un elenco di collegamenti veri è rumore — si scrive solo di ciò che c'è.
  // ⚠️ Le due chiavi si passano PER ESTESO invece di comporre `chiave + 'One'`:
  // il cricchetto che verifica le traduzioni legge le chiavi dal sorgente, e una
  // chiave composta a runtime gli sarebbe invisibile — cioè potrebbe mancare dal
  // dizionario e comparire nuda a schermo senza che nessun test arrossisca.
  const frase = (molti, uno, n, tot, gia) =>
    t(n === 1 ? uno : molti).replace('{n}', String(n)).replace('{tot}', String(tot))
    + (gia ? ' ' + t(gia === 1 ? 'org.wanAlreadyOne' : 'org.wanAlready').replace('{n}', String(gia)) : '');
  const vuoto = !r.total && !r.totalLinks;
  const testa = vuoto ? t('org.wanNone')
    : (r.total ? frase('org.wanAdded', 'org.wanAddedOne', r.added, r.total, r.already) : '');
  const capi = r.totalLinks
    ? frase('org.wanAddedLinks', 'org.wanAddedLinksOne', r.addedLinks, r.totalLinks, r.alreadyLinks) : '';
  return `<div class="org-wan-report">
    <p class="org-wan-head"><i class="fas fa-cloud-arrow-down"></i>
      <strong>${escapeHTML(r.siteName || '')}</strong>${testa ? ' — ' + escapeHTML(testa) : ''}
      <button class="um-btn ghost org-mini" data-act="org-wan-clear" title="${escapeHTML(t('common.close'))}"><i class="fas fa-xmark"></i></button></p>
    ${capi ? `<p>${escapeHTML(capi)}</p>` : ''}
    ${righe.length ? `<ul>${righe.map(x => `<li>${escapeHTML(x)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function _renderUplinks() {
  const ro = !_isAdmin();
  if (!_sites().length) return _renderWanReport() + `<p class="org-note">${escapeHTML(t('org.needSiteFirst'))}</p>`;
  const rows = _uplinks().map((u, i) => {
    const ips = isFact(u.publicIps) ? (factValue(u.publicIps) || []) : [];
    const badIps = _badAddrs(ips);
    return `<article class="org-row">
      <header class="org-row-head">
        <i class="fas fa-cloud-arrow-up"></i>
        <input class="org-row-title" type="text" value="${escapeHTML(u.provider || '')}" placeholder="${escapeHTML(t('org.providerPh'))}" ${ro ? 'disabled' : ''}
               data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="provider" aria-label="${escapeHTML(t('org.provider'))}">
        ${ro ? '' : `<button class="um-btn danger org-del" data-act="org-del-uplink" data-idx="${i}" title="${escapeHTML(t('org.removeUplink'))}"><i class="fas fa-trash"></i></button>`}
      </header>
      <div class="org-grid">
        <label class="org-f"><span>${escapeHTML(t('org.site'))}</span>
          <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="uplink" data-idx="${i}" data-field="siteId">${_siteOptions(u.siteId)}</select></label>
        <label class="org-f"><span>${escapeHTML(t('org.serviceType'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(u.serviceType || '')}" placeholder="FTTH"
                 data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="serviceType"></label>
        <label class="org-f"><span>${escapeHTML(t('org.circuitId'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(u.circuitId || '')}"
                 data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="circuitId"></label>
        <label class="org-f"><span>${escapeHTML(t('org.cir'))}</span>
          <input type="number" min="0" step="1" ${ro ? 'disabled' : ''} value="${u.cirMbps == null ? '' : escapeHTML(u.cirMbps)}"
                 data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="cirMbps">
          <small class="org-hint">${escapeHTML(t('org.cirHint'))}</small></label>
        <label class="org-f org-f-span2"><span>${escapeHTML(t('org.publicIps'))} ${_originBadge(u.publicIps)}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(ips.join(' '))}" placeholder="203.0.113.10 203.0.113.8/29 2001:db8::1"
                 data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="publicIps">
          <small class="org-bad" data-net-hint ${badIps.length ? '' : 'style="display:none"'}>${badIps.length ? escapeHTML(t('org.notAddresses') + ' ' + badIps.join(', ')) : ''}</small>
          <small class="org-hint">${escapeHTML(t('org.publicIpsHint'))}</small></label>
        <label class="org-f"><span>${escapeHTML(t('org.slaRef'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(u.slaRef || '')}"
                 data-input="org-field" data-scope="uplink" data-idx="${i}" data-field="slaRef"></label>
      </div>
    </article>`;
  }).join('');
  return _renderWanReport() + rows + (ro ? '' : `<button class="um-btn primary org-add" data-act="org-add-uplink"><i class="fas fa-plus"></i> ${escapeHTML(t('org.addUplink'))}</button>`);
}

function _renderLinks() {
  const ro = !_isAdmin();
  if (_sites().length < 2) return `<p class="org-note">${escapeHTML(t('org.needTwoSites'))}</p>`;
  const rows = _links().map((l, i) => {
    const reach = isFact(l.reach) ? factValue(l.reach) : { a: [], b: [] };
    const a = (reach && reach.a) || [], b = (reach && reach.b) || [];
    const badA = _badNets(a), badB = _badNets(b);
    return `<article class="org-row" data-link="${escapeHTML(String(l.id))}">
      <header class="org-row-head">
        <i class="fas ${escapeHTML(KIND_ICON[l.kind] || 'fa-link')}"></i>
        <span class="org-row-title org-row-static">${escapeHTML(_siteName(l.aSiteId) || '?')} ↔ ${escapeHTML(_siteName(l.bSiteId) || '?')}${l.name ? ' · ' + escapeHTML(l.name) : ''}
          <span class="org-row-kind">${escapeHTML(_kindText(l))}</span></span>
        ${ro ? '' : `<button class="um-btn danger org-del" data-act="org-del-link" data-idx="${i}" title="${escapeHTML(t('org.removeLink'))}"><i class="fas fa-trash"></i></button>`}
      </header>
      <div class="org-grid">
        <label class="org-f"><span>${escapeHTML(t('org.siteA'))}</span>
          <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="link" data-idx="${i}" data-field="aSiteId">${_siteOptions(l.aSiteId, l.bSiteId)}</select></label>
        <label class="org-f"><span>${escapeHTML(t('org.siteB'))}</span>
          <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="link" data-idx="${i}" data-field="bSiteId">${_siteOptions(l.bSiteId, l.aSiteId)}</select></label>
        <label class="org-f"><span>${escapeHTML(t('org.kind'))}</span>
          <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="link" data-idx="${i}" data-field="kind">
            ${INTER_SITE_KINDS.map(k => _opt(k, t('org.kind.' + k), l.kind)).join('')}</select></label>
        ${l.kind !== 'other' ? '' : `<label class="org-f"><span>${escapeHTML(t('org.kindLabel'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(l.kindLabel || '')}" placeholder="${escapeHTML(t('org.kindLabelPh'))}"
                 data-input="org-field" data-scope="link" data-idx="${i}" data-field="kindLabel"></label>`}
        <label class="org-f"><span>${escapeHTML(t('org.topology'))}</span>
          <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="link" data-idx="${i}" data-field="topology">
            ${_opt('', '—', l.topology || '')}${INTER_SITE_TOPOLOGIES.map(x => _opt(x, t('org.topo.' + x), l.topology || '')).join('')}</select></label>
        <label class="org-f"><span>${escapeHTML(t('org.linkState'))} ${_originBadge(l.state)}</span>
          <select ${ro ? 'disabled' : ''} data-change="org-field" data-scope="link" data-idx="${i}" data-field="state">
            ${_opt('', '— ' + t('org.stateUnspoken'), _fv(l.state))}${INTER_SITE_STATES.map(s => _opt(s, t('org.state' + (s === 'up' ? 'Up' : 'Down')), _fv(l.state))).join('')}</select></label>
        <label class="org-f"><span>${escapeHTML(t('org.linkName'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(l.name || '')}" placeholder="${escapeHTML(t('org.linkNamePh'))}"
                 data-input="org-field" data-scope="link" data-idx="${i}" data-field="name"></label>
        <label class="org-f"><span>${escapeHTML(t('org.provider'))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(l.provider || '')}" placeholder="${escapeHTML(t('org.providerPh'))}"
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
        ${_fieldsOfKind(l, i)}
        <label class="org-f org-f-wide"><span>${escapeHTML(_atSite('org.reachA', l.aSiteId))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(a.join(' '))}" placeholder="10.1.0.0/24"
                 data-input="org-field" data-scope="link" data-idx="${i}" data-field="reachA">
          <small class="org-bad" data-net-hint ${badA.length ? '' : 'style="display:none"'}>${badA.length ? escapeHTML(t('org.notNetworks') + ' ' + badA.join(', ')) : ''}</small></label>
        <label class="org-f org-f-wide"><span>${escapeHTML(_atSite('org.reachB', l.bSiteId))}</span>
          <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(b.join(' '))}" placeholder="10.2.0.0/24"
                 data-input="org-field" data-scope="link" data-idx="${i}" data-field="reachB">
          <small class="org-bad" data-net-hint ${badB.length ? '' : 'style="display:none"'}>${badB.length ? escapeHTML(t('org.notNetworks') + ' ' + badB.join(', ')) : ''}</small></label>
      </div>
      <p class="org-hint org-reach-hint">${escapeHTML(t('org.reachHint'))}</p>
    </article>`;
  }).join('');
  return rows + (ro ? '' : `<button class="um-btn primary org-add" data-act="org-add-link"><i class="fas fa-plus"></i> ${escapeHTML(t('org.addLink'))}</button>`);
}

// ── Coerenza (④: si RACCONTA l'audit del server, non se ne calcola un altro) ─

/** Le liste dell'audit, in tre gruppi che NON si sommano fra loro. */
const AUDIT_PROBLEMS = ['subnetsNowhere', 'subnetsAtTwoSites', 'linksToUnknownSite', 'uplinksToUnknownSite', 'spokesWithoutHub'];
const AUDIT_GAPS = ['subnetsNotCarried', 'linksWithoutReach', 'sitesWithoutLink', 'sitesWithoutUplink', 'uplinksWithoutPublicIp'];

/** Una rete, in tondo monospazio: un CIDR si legge a colpo d'occhio solo se le
 *  cifre sono allineate, e in mezzo a una frase si perde. */
function NET(n) {
  return `<code>${escapeHTML(n)}</code>`;
}

/** Il nome leggibile di un collegamento: «Caci ↔ Aloys · VPLS». Un `linkId`
 *  generato non dice niente a chi legge, e l'audit può solo darci quello. */
function _linkName(linkId, kind) {
  const l = _links().find(x => x.id === linkId);
  const capi = l ? `${_siteName(l.aSiteId) || '?'} ↔ ${_siteName(l.bSiteId) || '?'}` : linkId;
  // ⑨ Il nome della natura lo dà `_kindText`, che per `other` usa le parole
  // scritte da chi documenta: qui dire «Altro» butterebbe via l'unica cosa
  // che quel collegamento aveva da dire di sé.
  const natura = l ? _kindText(l) : (kind ? t('org.kind.' + kind) : '');
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
    case 'linksToUnknownSite': return `${escapeHTML(_linkName(row.linkId, row.kind))} <span class="org-audit-at">${row.missing.map(escapeHTML).join(' · ')}</span>`;
    case 'uplinksToUnknownSite': return `${escapeHTML(_uplinkName(row.uplinkId, row.siteId))}`;
    case 'spokesWithoutHub': return S(row.siteId);
    case 'subnetsNotCarried': return `${NET(row.subnet)} <span class="org-audit-at">${S(row.siteId)}</span>`;
    case 'linksWithoutReach': return escapeHTML(_linkName(row.linkId, row.kind));
    case 'sitesWithoutLink': return S(row.siteId);
    case 'sitesWithoutUplink': return S(row.siteId);
    case 'uplinksWithoutPublicIp': return escapeHTML(_uplinkName(row.uplinkId, row.siteId));
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

// ── Il pannello ───────────────────────────────────────────────────────────

const TABS = [
  ['map', 'fa-map', 'org.tabMap'],
  ['sites', 'fa-building', 'org.tabSites'],
  ['wan', 'fa-cloud-arrow-up', 'org.tabWan'],
  ['links', 'fa-link', 'org.tabLinks'],
  ['audit', 'fa-clipboard-check', 'org.tabAudit'],
];

/** Il conteggio dell'audit, come pastiglie. Non si sommano: sono tre domande
 *  diverse, e fonderle in un punteggio unico è esattamente il modo di non
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

function _renderBody() {
  switch (_st.tab) {
    case 'sites': return _renderSites();
    case 'wan': return _renderUplinks();
    case 'links': return _renderLinks();
    case 'audit': return _renderAudit();
    default: return _renderMap();
  }
}

/**
 * Il piè di pagina, DA SOLO.
 *
 * ⚠️ Va ridisegnato separatamente dal corpo, ed è il motivo per cui esiste come
 * funzione: mentre si scrive in un campo il corpo NON si ridisegna (rifarne
 * l'HTML butterebbe via il cursore), ma lo stato del bottone «Salva» cambia
 * proprio in quel momento. Con un disegno solo, il bottone restava spento
 * e ciò che si era scritto non si poteva salvare. Qui dentro non c'è nessun
 * campo di testo, quindi ridisegnarlo a ogni tasto non toglie il fuoco a nessuno.
 */
function _renderFooter() {
  const foot = _el('org-footer');
  if (!foot) return;
  if (_st.loading || _st.loadErr) { foot.innerHTML = ''; return; }
  const ro = !_isAdmin();
  const drop = _st.dropped && (_st.dropped.sites || _st.dropped.uplinks || _st.dropped.links)
    ? `<span class="org-dropped"><i class="fas fa-filter-circle-xmark"></i> ${escapeHTML(
      t('org.dropped')
        .replace('{s}', String(_st.dropped.sites))
        .replace('{u}', String(_st.dropped.uplinks))
        .replace('{l}', String(_st.dropped.links)))}</span>`
    : '';
  foot.innerHTML = `${drop}
    ${ro ? `<span class="org-note">${escapeHTML(t('org.readOnly'))}</span>`
    : `<button class="um-btn primary" data-act="org-save"${(_st.saving || !_st.dirty) ? ' disabled' : ''}>
        <i class="fas ${_st.saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}"></i> ${escapeHTML(_st.dirty ? t('org.save') : t('org.saved'))}</button>`}
    <button class="um-btn ghost" data-act="org-close"><i class="fas fa-times"></i> ${escapeHTML(t('common.close'))}</button>`;
}

/** Segna una modifica: accende il bottone «Salva» senza toccare il corpo.
 *  Solo al PRIMO tocco — a ogni tasto rifarebbe il piè di pagina per niente. */
function _touch() {
  if (_st.dirty) return;
  _st.dirty = true;
  _renderFooter();
}

/**
 * Allarga il viewBox della mappa fino a contenere le ETICHETTE.
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
  if (!svg || typeof svg.getBBox !== 'function') return;
  let b;
  try { b = svg.getBBox(); } catch (_) { return; }
  if (!b || !(b.width > 0) || !(b.height > 0)) return;
  const m = 14;
  const r = (n) => Math.round(n * 100) / 100;
  svg.setAttribute('viewBox',
    `${r(b.x - m)} ${r(b.y - m)} ${r(b.width + m * 2)} ${r(b.height + m * 2)}`);
}

function _render() {
  const body = _el('org-body');
  if (!body) return;

  if (_st.loading) { body.innerHTML = `<p class="org-note">${escapeHTML(t('org.loading'))}</p>`; _renderFooter(); return; }
  if (_st.loadErr) {
    body.innerHTML = `<p class="org-bad"><i class="fas fa-plug-circle-xmark"></i> ${escapeHTML(t('org.loadFailed'))} ${escapeHTML(_st.loadErr)}</p>
      <button class="um-btn" data-act="org-reload"><i class="fas fa-rotate"></i> ${escapeHTML(t('org.retry'))}</button>`;
    _renderFooter();
    return;
  }

  const ro = !_isAdmin();
  body.innerHTML = `
    <div class="org-head">
      <label class="org-f org-f-name"><span>${escapeHTML(t('org.orgName'))}</span>
        <input type="text" ${ro ? 'disabled' : ''} value="${escapeHTML(_st.org.name || '')}" placeholder="${escapeHTML(t('org.orgNamePh'))}"
               data-input="org-name"></label>
      <div class="org-counts">
        <span class="org-chip"><i class="fas fa-building"></i> ${_sites().length}</span>
        <span class="org-chip"><i class="fas fa-cloud-arrow-up"></i> ${_uplinks().length}</span>
        <span class="org-chip"><i class="fas fa-link"></i> ${_links().length}</span>
        ${_auditChips()}
      </div>
    </div>
    <div class="um-tabs org-tabs">
      ${TABS.map(([k, icon, key]) => `<button class="um-tab${_st.tab === k ? ' active' : ''}" data-act="org-tab" data-tab="${k}"><i class="fas ${icon}"></i> <span>${escapeHTML(t(key))}</span></button>`).join('')}
    </div>
    <div class="org-pane">${_renderBody()}</div>`;
  // ④ La SECONDA passata della mappa: ora l'SVG è nel documento, quindi le righe
  // dentro i riquadri si possono misurare per davvero e la geometria si rifà con
  // le larghezze vere. Si fa una volta sola — con un `boxOf` già in mano non si
  // rientra — perché due passate bastano e una terza inseguirebbe sé stessa.
  if (_st.tab === 'map') {
    const svg = body.querySelector('svg.org-map');
    const misure = _measureBoxes(svg);
    if (misure) {
      const pane = body.querySelector('.org-pane');
      if (pane) pane.innerHTML = _renderMap(misure);
    }
  }
  // Il ritaglio si fa DOPO che l'SVG è nel documento: prima non c'è niente da
  // misurare, e `getBBox()` risponderebbe zero.
  _fitMapViewBox(body.querySelector('svg.org-map'));
  _applyFocusLink(body);
  _renderFooter();
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
  const row = Array.from(body.querySelectorAll('.org-row')).find(r => r.dataset.link === _st.focusLink);
  if (!row) return;                       // altra scheda, o riga sparita: si riproverà
  row.scrollIntoView({ block: 'center' });
  row.classList.add('org-row-target');    // si spegne da sé: l'animazione finisce
  if (!_st.warming) _st.focusLink = null;
}

// Chiusura sul backdrop solo se anche la PRESSIONE era sul backdrop: una
// selezione di testo che parte da un input e finisce fuori dal box non deve
// chiudere il pannello (stessa trappola già risolta nel modale DCIM).
let _pressOnBackdrop = false;
let _wired = false;
function _wireBackdrop() {
  if (_wired) return;
  const ov = _el('org-overlay');
  if (!ov) return;
  ov.addEventListener('mousedown', (e) => { _pressOnBackdrop = (e.target === ov); });
  _wired = true;
}

/** Apre «Sedi e collegamenti» e ricarica dal server: l'organizzazione è una per
 *  installazione, e potrebbe averla cambiata un altro amministratore.
 *  ⚠️ Con modifiche non salvate NON si ricarica: la risposta del server
 *  rimpiazzerebbe lo stato in lavorazione, cioè butterebbe via ciò che si stava
 *  scrivendo, senza chiedere e senza dirlo. */
export function openOrgPanel() {
  const ov = _el('org-overlay');
  if (!ov) return;
  _wireBackdrop();
  ov.classList.add('open');
  if (_st.dirty) { _render(); return; }
  _st.tab = 'map'; _st.dropped = null; _st.wanReport = null; _st.wanBusy = false;
  _render();
  _load();
}

export function closeOrgPanel() {
  const ov = _el('org-overlay');
  if (!ov) return;
  if (_st.dirty) {
    showConfirm(t('org.confirmDiscard'), () => { _st.dirty = false; ov.classList.remove('open'); });
    return;
  }
  ov.classList.remove('open');
}

/** Click su una sede della mappa: si scende nel progetto-sede. Senza un
 *  riferimento valido non si indovina un progetto — si dice che manca. */
function _openSite(siteId) {
  const s = _sites().find(x => x.id === siteId);
  if (!s) return;
  const p = s.projectRef && _st.projects.find(x => String(x.id) === String(s.projectRef));
  if (!p) { showAlert(t('org.noProjectFor').replace('{name}', s.name)); return; }
  if (_st.dirty) {
    showConfirm(t('org.confirmDiscard'), () => { _st.dirty = false; closeOrgPanel(); switchProject(p.id); });
    return;
  }
  closeOrgPanel();
  switchProject(p.id);
}

registerClickActions({
  'org-open': () => openOrgPanel(),
  'org-close': () => closeOrgPanel(),
  'org-backdrop': (el, ev) => { if (ev.target === el && _pressOnBackdrop) closeOrgPanel(); },
  'org-reload': () => { _load(); },
  // Si disegna SUBITO con quello che si ha, e i progetti-sede arrivano dopo: la
  // scheda «Collegamenti» ha bisogno degli apparati per riempire le due tendine,
  // ma aspettarli lascerebbe il pannello fermo. Le tendine dicono «carico…»
  // finché non ci sono, e `_warmProjects` ridisegna una volta sola alla fine.
  'org-tab': (el) => {
    _st.tab = el.dataset.tab || 'map';
    _st.focusLink = null;
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
  'org-node': (el) => _openSite(el.dataset.site || ''),
  // ⑭ Dalla mappa alla riga. Si scaldano i progetti come fa `org-tab`: le due
  // tendine degli apparati vivono di quelli, e arrivarci dalla mappa non è un
  // modo diverso di aprire la stessa scheda.
  'org-link': (el) => {
    _st.focusLink = el.dataset.link || null;
    _st.tab = 'links';
    _render();
    _warmProjects(_links()
      .flatMap(l => [l.aSiteId, l.bSiteId])
      .map(id => (_sites().find(s => s.id === id) || {}).projectRef));
  },
  'org-nets-from-project': (el) => { _netsFromProject(Number(el.dataset.idx)); },
  'org-wan-from-dcim': (el) => { _wanFromDcim(Number(el.dataset.idx)); },
  // L'esito resta finché non lo si congeda: è un elenco da leggere, non un
  // lampo. Chiuderlo non tocca le righe già iscritte.
  'org-wan-clear': () => { _st.wanReport = null; _render(); },
});

registerInputActions({
  'org-name': (el) => { _st.org.name = el.value; _touch(); },
  // Volutamente NESSUN re-render mentre si scrive: rifare l'HTML a ogni tasto
  // butterebbe via il cursore. La mappa vive in un'altra tab e si ricostruisce
  // quando ci si torna.
  'org-field': (el) => _setField(el),
});

// ⚠️ `role="button"` senza tastiera è un'etichetta che mente: chi naviga col
// tabulatore arriva sull'elemento, legge «bottone» e preme invano. Il riquadro
// della sede lo prometteva già da prima; ora tutti e due lo mantengono.
registerKeydownActions({
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
