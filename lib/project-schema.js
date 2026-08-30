// ============================================================
// CLASSIFICA DEI CAMPI — che cos'è, ciascun campo del progetto
// (UMD-lite, Node + browser · zero-dip · lingua-indipendente · puro)
// ============================================================
// Cambio 3A del piano `_local/notes/PIANO_debito-strutturale-e-typescript.md`.
// **ZERO COMPORTAMENTO**: questo file non tocca niente, dice soltanto la verità
// su ogni campo. Chi la usa per costruire l'export è 3B, in un passo separato e
// rivedibile — perché cambiare cosa esce da un export è una cosa che si guarda
// prima di farla, non dopo.
//
// ── Il problema che questa classifica esiste per chiudere ─────────────────
// Oggi `sanitizePortableState` è una **blocklist**: elenca i campi da togliere.
// Vuol dire che un campo MISURATO nuovo esce nell'export finché qualcuno non si
// ricorda di aggiungerlo alla lista — ed è già successo. In un attrezzo il cui
// unico superpotere è il dato fidato, «esce anche quello che non doveva» non è
// un dettaglio: è la differenza fra un documento e una fotografia della TUA rete
// spedita a qualcun altro.
//
// ── Le cinque classi, e cosa comportano per l'export ──────────────────────
//   `document` — l'ha scritto (o importato) una persona. **ESCE.**
//   `measure`  — l'ha letto un apparato. **NON esce**: chi apre il file altrove
//                non deve ereditare le misure di un impianto che non ha davanti.
//   `derived`  — calcolato da altro. **NON esce**: si ricalcola al primo render,
//                e portarlo dentro vorrebbe dire farlo invecchiare.
//   `private`  — interno e personale (nomi utente). **NON esce**, per riservatezza.
//   `secret`   — credenziale. **Esce SVUOTATO**, non tolto: la forma resta, il
//                valore no, così chi riapre vede che il campo esiste e va rimesso.
//
// ── LA REGOLA che scioglie i campi a doppia natura ────────────────────────
// Molti campi storici possono venire da una MANO o da una MISURA: `serialNumber`,
// `mac`, `model`, `ip`. Non hanno l'envelope di provenienza (`lib/provenance.ts`
// esiste appunto perché i campi NUOVI non nascano così). Per loro vale:
//
//     **se una persona può scriverlo nella UI, è `document`.**
//
// È la direzione SICURA: sbagliare verso `document` fa uscire un dato in più
// dall'export che l'utente stesso ha generato; sbagliare verso `measure`
// CANCELLA il lavoro di qualcuno. I due errori non si equivalgono, e questa
// classifica non finge che si equivalgano.
// Per lo stesso motivo esistono i campi-ombra dedicati (`modelMatch`,
// `portsMeasured`, `osTypeMeasured`): la misura si tiene ACCANTO al dichiarato,
// mai sopra — ed è quella l'unica che si può classificare `measure` a cuor leggero.
//
// ── Un campo che NON è in questa tabella ──────────────────────────────────
// `classifyField` risponde `null`, e chi consuma **lo tiene**. Non si butta via
// il campo di qualcuno perché io non l'ho previsto. Il buco non resta però in
// silenzio: `test/project-schema.test.js` diventa ROSSO se un campo visto nel
// corpus non è classificato. Il cancello sta in CI, dove costa poco; il default
// a runtime sta dalla parte di chi ha dei dati, dove sbagliare costa caro.
//
// ── Perché questo file è `.js` e non `.ts` ────────────────────────────────
// Era nato `.ts` come `lib/provenance.ts` e `lib/inter-site.ts`. Non regge:
// chi lo consuma è `lib/project-format.js`, che il browser carica con un
// `<script src>` — e un `.ts` al browser può arrivare SOLO dal bundle `src/`.
// L'export portatile si costruisce lato client (unico chiamante: `export.js`),
// quindi con un `.ts` la classifica sarebbe stata `undefined` proprio lì, e
// l'export sarebbe tornato a far uscire tutto **senza dirlo**.
// La regola che se ne ricava: **il linguaggio di un modulo lo decide chi deve
// consumarlo**, non il gusto di chi lo scrive. Un `.ts` va bene per un modulo
// nuovo che serve codice nuovo (che passa dal bundle); non per uno che deve
// stare accanto a uno script classico. I tipi qui vivono come `@typedef` JSDoc
// e `tsc` li controlla lo stesso — questo file è nel `tsconfig`.

/** Cosa è un campo, e quindi cosa gli succede all'export.
 *  @typedef {'document'|'measure'|'derived'|'private'|'secret'} FieldClass */

/** Dove vive il campo. Ogni scope ha il suo vocabolario.
 *  @typedef {'state'|'node'|'spec'|'port'|'link'} FieldScope */

(function () {
  'use strict';

  // ── state: il progetto ───────────────────────────────────────────────────
  /** @type {Record<string, FieldClass>} */
  const STATE = {
    // il disegno e le sue impostazioni
    autoPoll: 'document', bgImage: 'document', bgImageAsset: 'document',
    bgImageHash: 'document', bgImageLocked: 'document', bgImageOpacity: 'document',
    bgImageScale: 'document', currentRack: 'document', floorView: 'document',
    gridHidden: 'document', rackView: 'document', uiColors: 'document',
    // il modello dichiarato
    ipam: 'document', lagGroups: 'document', lagModes: 'document',
    links: 'document', nodes: 'document', ports: 'document', racks: 'document',
    nativeVlan: 'document', guestVlans: 'document', mgmtVlans: 'document',
    voiceVlans: 'document', vlanColors: 'document', vlanNames: 'document',
    schemaVersion: 'document', source: 'document',
    // decisioni prese dall'utente: sono atti, e valgono quanto un disegno
    driftIgnores: 'document', rejectedAutoLinks: 'document',
    // misure: la fotografia di UNA rete in UN momento
    discoveryHistory: 'measure', lastSnmpSyncAt: 'measure',
    lastSnmpSyncResult: 'measure', lastVerify: 'measure',
    lastAutoLinkResult: 'measure',
    // ⚠️ DA CONFERMARE (§ in fondo): oggi ESCE, e contiene i lease letti da un
    // server DHCP — cioè chi c'era su quella rete, con nome e MAC.
    dhcpSources: 'measure',
    // calcolato: si rifà al primo render
    topoCache: 'derived',
    // il giornale delle modifiche porta i NOMI UTENTE di chi ha lavorato
    auditLog: 'private',
  };

  // ── node: un apparato ────────────────────────────────────────────────────
  /** @type {Record<string, FieldClass>} */
  const NODE = {
    // identità e disegno — tutto scrivibile a mano
    id: 'document', name: 'document', type: 'document', notes: 'document',
    brand: 'document', model: 'document', hostname: 'document',
    serialNumber: 'document', mac: 'document', ip: 'document', ip6: 'document',
    vlan: 'document', voiceVlan: 'document', platform: 'document',
    status: 'document', spec: 'document', ports: 'document', radios: 'document',
    vms: 'document', frontPanel: 'document', powerOutlets: 'document',
    // i «manual» sono la memoria del paletto ①: dicono che l'ha deciso una persona
    nameManual: 'document', hostnameManual: 'document', ipManual: 'document',
    typeManual: 'document', portsManual: 'document',
    // posizione e aspetto
    x: 'document', y: 'document', w: 'document', h: 'document',
    color: 'document', opacity: 'document', fontSize: 'document',
    placement: 'document', rackId: 'document', rackU: 'document', sizeU: 'document',
    positionSource: 'document', isStructural: 'document', passThrough: 'document',
    // PDU / alta affidabilità / stack — dichiarazioni
    pduEthernetPorts: 'document', pduMgmtMode: 'document',
    pduOutletCount: 'document', pduPowerPorts: 'document',
    haPeer: 'document', haRole: 'document',
    // riferimenti d'origine (lib/source-ref.js): identità verso un DCIM, e
    // `test/source-ref-survival.test.js` pretende che sopravvivano
    srcLoc: 'document', srcDevice: 'document', srcRack: 'document',
    source: 'document', catalogMatch: 'document', portId: 'document',
    // dove vive il backup — mai il backup, e `ref` viene ripulito dalle credenziali
    backup: 'document',
    // ── misure ──
    proof: 'measure',                 // presenza: la fotografia di un istante
    snmpStatus: 'measure', snmpLastOk: 'measure',
    firstSeen: 'measure', lastSeen: 'measure',
    currentIp: 'measure', previousIps: 'measure', ipHistory: 'measure',
    discoveryConflicts: 'measure', possibleReplacement: 'measure',
    identitySource: 'measure', identityConfidence: 'measure',
    vendorHint: 'measure', firmwareVer: 'measure',
    netbiosName: 'measure', netbiosGroup: 'measure', smbShares: 'measure',
    // i campi-ombra: la misura ACCANTO al dichiarato, mai sopra (paletto ①)
    modelMatch: 'measure', portsMeasured: 'measure', osTypeMeasured: 'measure',
    portsReal: 'measure',
    // dedotto dal modello, non affermato da nessuno
    inferred: 'derived',
    // ── credenziali ──
    integration: 'secret', snmp: 'secret',
  };

  // ── node.spec: i campi d'apparato (vedi [[spec-fields-custom-value]]) ─────
  // Sono TUTTI dichiarazioni: `spec` è dove finisce ciò che scrive una persona
  // nel pannello. Elencati lo stesso, perché la guardia possa contarli.
  /** @type {Record<string, FieldClass>} */
  const SPEC = {
    pduOutletCount: 'document', stackId: 'document', stackMemberId: 'document',
    stackRole: 'document', swMgmt: 'document', swPoeBudgetW: 'document',
    voiceVlan: 'document',
  };

  // ── port: una porta ──────────────────────────────────────────────────────
  /** @type {Record<string, FieldClass>} */
  const PORT = {
    // dichiarato a mano nel pannello o nella tabella porte
    desc: 'document', vlan: 'document', vlanOvr: 'document', mode: 'document',
    isTrunk: 'document', trunkVlans: 'document', status: 'document',
    mgmt: 'document', logical: 'document', parentPid: 'document',
    lagGroup: 'document', lagId: 'document', speed: 'document',
    ifName: 'document', mac: 'document', ip: 'document',
    // riferimenti d'origine DCIM — devono sopravvivere al salva-e-riapri
    srcIf: 'document', srcFront: 'document', srcRear: 'document',
    // ── misure ──
    alias: 'measure',              // ifAlias: lo scrive l'apparato
    adminDown: 'measure', operUp: 'measure', downStreak: 'measure',
    ownsIp: 'measure', bridges: 'measure', lagIfIndex: 'measure',
    snmpMedium: 'measure', snmpPoe: 'measure',
    // ── derivati: si ricalcolano ──
    // i tre della VLAN sono già tolti oggi da `stripDerivedVlan`: qui la stessa
    // verità, scritta una volta sola invece che in due posti
    vlanProp: 'derived', trunkProp: 'derived', isTrunkProp: 'derived',
    sharedSegmentHint: 'derived', sharedSegmentMacCount: 'derived',
    sharedSegmentNodeId: 'derived', sharedSegmentRole: 'derived',
    sharedSegmentRoleSuggested: 'derived',
    // `overflow` = questa porta è finita oltre le posizioni del frontale, e lo
    // decide un CONTO dell'import (`slot > layout.dataPorts` in dcim-map): non
    // lo scrive nessuno e si ricalcola da sé al prossimo import. Derivato.
    overflow: 'derived',
  };

  // ── link: un cavo o un'associazione wireless ─────────────────────────────
  /** @type {Record<string, FieldClass>} */
  const LINK = {
    id: 'document', src: 'document', dst: 'document', mode: 'document',
    trunkVlans: 'document', wireless: 'document', bss: 'document',
    cableCategory: 'document', isPermanent: 'document',
    lagMembers: 'document', lagLogicalKey: 'document', lagMemberPair: 'document',
    source: 'document', sourceCableId: 'document',
    // ⚠️ `autoLinked`/`confidence`/`protocol` restano DOCUMENT di proposito:
    // sono ciò che rende un cavo dedotto DISTINGUIBILE da uno disegnato a mano.
    // Toglierli dall'export non nasconderebbe una misura — trasformerebbe ogni
    // deduzione in una dichiarazione, che è esattamente la bugia che questo
    // progetto combatte (→ proof-state: «un dedotto non è un provato»).
    autoLinked: 'document', confidence: 'document', protocol: 'document',
    resolution: 'document',
    // Colore e lunghezza del cavo: li scrive l'import DCIM leggendo NetBox, ma
    // sono anche due campi che una persona compila a mano nel pannello cavo —
    // e la regola per i campi a doppia origine è che vince `document`. Sbagliare
    // verso `document` lascia un campo in più in un export che l'utente ha fatto
    // lui; sbagliare verso `measure` gli CANCELLA un dato scritto a mano.
    color: 'document', lengthM: 'document',
  };

  /** @type {Record<FieldScope, Record<string, FieldClass>>} */
  const BY_SCOPE = {
    state: STATE, node: NODE, spec: SPEC, port: PORT, link: LINK,
  };

  /** Cosa succede a ciascuna classe quando si costruisce un export portatile. */
  /** @type {Record<FieldClass, 'keep'|'drop'|'blank'>} */
  const EXPORT_ACTION = {
    document: 'keep', measure: 'drop', derived: 'drop', private: 'drop', secret: 'blank',
  };

  /**
   * La classe di un campo, o `null` se non è classificato.
   * ⚠️ `null` NON vuol dire «misura»: vuol dire «non lo so», e chi consuma deve
   * tenere il campo. La guardia in `test/project-schema.test.js` fa in modo che
   * un `null` non sopravviva a una CI.
   */
  /** @param {FieldScope|string} scope @param {string} key @returns {FieldClass|null} */
  function classifyField(scope, key) {
    const table = BY_SCOPE[scope];
    if (!table) return null;
    const k = String(key == null ? '' : key);
    return Object.prototype.hasOwnProperty.call(table, k) ? table[k] : null;
  }

  /**
   * Che fare di un campo in un export: `keep` · `drop` · `blank`.
   * Un campo non classificato si TIENE (vedi l'intestazione).
   */
  /** @param {FieldScope|string} scope @param {string} key @returns {'keep'|'drop'|'blank'} */
  function exportActionFor(scope, key) {
    const cls = classifyField(scope, key);
    return cls ? EXPORT_ACTION[cls] : 'keep';
  }

  /** Tutti i campi di uno scope che appartengono a una classe. Ordinati. */
  /** @param {FieldScope|string} scope @param {FieldClass} cls @returns {string[]} */
  function fieldsOfClass(scope, cls) {
    const table = BY_SCOPE[scope];
    if (!table) return [];
    return Object.keys(table).filter(k => table[k] === cls).sort();
  }

  /** Gli scope noti, per chi vuole ciclare senza conoscerli a memoria. */
  /** @type {FieldScope[]} */
  const FIELD_SCOPES = ['state', 'node', 'spec', 'port', 'link'];
  /** @type {FieldClass[]} */
  const FIELD_CLASSES = ['document', 'measure', 'derived', 'private', 'secret'];

  // ── ⚠️ DA CONFERMARE con l'utente prima del Cambio 3B ────────────────────
  // Questi sono classificati NON-document, quindi il giorno in cui 3B entra in
  // vigore **smetteranno di uscire dall'export**. Sono dedotti dal codice che li
  // scrive, non da una decisione presa: vanno guardati da chi conosce il
  // prodotto prima che il comportamento cambi. Elencati qui perché una cosa da
  // confermare, scritta in un commento, non la conferma nessuno.
  /** @type {{scope: FieldScope, key: string, why: string}[]} */
  const TO_CONFIRM = [
    { scope: 'state', key: 'dhcpSources', why: 'porta i lease letti da un server DHCP: chi c\'era su quella rete, con nome e MAC' },
    { scope: 'state', key: 'lastAutoLinkResult', why: 'esito dell\'ultima passata di auto-collegamento' },
    { scope: 'port', key: 'alias', why: 'ifAlias lo scrive l\'apparato, ma la UI lo mostra accanto a `desc`' },
    { scope: 'port', key: 'bridges', why: 'lo scrivono sia il driver SNMP sia il pannello porta' },
    { scope: 'node', key: 'inferred', why: 'lo scrive il Sync quando materializza un vicino annunciato (src/app-topology-rebuild.js) e la ricostruzione lo rilegge per sapere quali nodi ha creato lei: è una DEDUZIONE dell\'app, non una dichiarazione di chi documenta' },
    // `catalogMatch` NON è qui di proposito: lo scrive l'import DCIM (che è una
    // dichiarazione) ma anche il catalogo lato client, quindi è ambiguo — ed è
    // classificato `document`, cioè come si comporta già oggi. Niente cambia,
    // quindi non c'è niente da confermare: elencarlo avrebbe fatto rumore a vuoto.
  ];

  const api = {
    classifyField, exportActionFor, fieldsOfClass,
    FIELD_SCOPES, FIELD_CLASSES, EXPORT_ACTION, TO_CONFIRM,
    // le tabelle, per la guardia e per la doc
    FIELD_CLASS_BY_SCOPE: BY_SCOPE,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})();
