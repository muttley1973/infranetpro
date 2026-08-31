'use strict';
// ============================================================
//  Generazione report PDF (pdfkit + svg-to-pdfkit, lazy).
//  Estratto da server.js senza modifiche di logica.
// ============================================================

// Lib PURE del core (nessun IO, nessuna dipendenza esterna): si caricano subito,
// a differenza di pdfkit che resta lazy.
const { nodeLabelParts } = require('../lib/node-label.js');
const { _i18nDict: _I18N_DICT } = require('../lib/i18n.js');   // dizionario indicizzabile per lingua, senza cambiare quella globale
const { stripRefCreds } = require('../lib/backup-ref.js');     // 🔒 stessa regola del validatore: il puntatore resta, il segreto no
const OV_THRESHOLDS = require('../lib/overview.js');           // soglie DR/ciclo di vita: una sola definizione, dossier e app
// La mappa inter-sede del dossier nasce dalle STESSE coordinate del pannello: il
// modulo del layout è l'unica geometria, il serializzatore la veste d'inchiostro
// da stampa (fondo bianco, colori negli attributi). → lib/inter-site-svg.js ①
const { buildInterSiteLayout } = require('../lib/inter-site-layout.js');
const { buildInterSiteMapSvg, INTER_SITE_SVG_GEOM } = require('../lib/inter-site-svg.js');

let _pdfkitMod = null, _svgToPdfMod = null;
function _loadPdfDeps() {
  if (!_pdfkitMod) {
    try {
      _pdfkitMod   = require('pdfkit');
      _svgToPdfMod = require('svg-to-pdfkit');
    } catch (e) {
      throw new Error('Dipendenze PDF non disponibili (esegui: npm install pdfkit svg-to-pdfkit). ' + e.message);
    }
  }
  return { PDFDocument: _pdfkitMod, SVGtoPDF: _svgToPdfMod };
}

// ============================================================
// PDF REPORT - helper per pagine tabellari (2-6)
// ============================================================

const _RM  = 28;      // margine orizzontale
const _RW  = 539;     // larghezza contenuto (595 - 28*2)
const _TOP = 38;      // Y primo contenuto dopo header
const _BOT = 820;     // Y limite inferiore (A4 841.89)

// ── Localizzazione del report (it/en) ────────────────────────────────────────
// Tabella LOCALE e self-contained: il report e' chrome server-side e NON dipende
// da lib/i18n.js (quelle chiavi sono UI). Traduce solo l'ossatura (titoli,
// sottotitoli, intestazioni colonna, stati vuoti, copertina). I termini tecnici
// (VLAN, SFP, access, trunk, rack, uplink) restano invariati in entrambe le lingue.
// La lingua arriva dal client (getLang) via la route; default 'it' (retrocompat).
const _RL = {
  it: {
    'title.inventory': 'Inventario Cavi', 'title.asbuilt': 'Tracciato cablaggio (As-Built)',
    'title.racks': 'Vista rack', 'title.ports': 'Assegnazione porte', 'title.vlans': 'Sommario VLAN',
    'title.topology': 'Topologia LLDP/CDP', 'title.assets': 'Registro asset',
    'title.changelog': 'Storia modifiche', 'title.spare': 'Porte libere', 'title.floorplan': 'Planimetria',
    'title.vms': 'Macchine virtuali',
    'sub.vms': 'VM documentate sugli host di virtualizzazione',
    'empty.vms': 'Nessuna VM documentata sugli host di virtualizzazione.',
    'col.host': 'Host', 'col.vm': 'VM', 'col.role': 'Ruolo', 'col.res': 'Risorse',
    'col.owner': 'Responsabile', 'col.crit': 'Criticità',
    'vm.running': 'Accesa', 'vm.stopped': 'Spenta', 'vm.unknown': 'Non spec.',
    'vm.crit.low': 'Bassa', 'vm.crit.medium': 'Media', 'vm.crit.high': 'Alta', 'vm.crit.critical': 'Critica',
    // ── Alimentazione / PDU ──────────────────────────────────────────────
    'title.pdu': 'Alimentazione — PDU', 'title.pduOutlets': 'Alimentazione — Prese',
    'sub.pdu': 'unità di distribuzione documentate',
    'sub.pduOutlets': 'prese documentate',
    'empty.pdu': 'Nessuna PDU documentata nel progetto.',
    'col.phase': 'Fasi', 'col.outlets': 'Prese', 'col.active': 'Attive',
    'col.fault': 'Guasti', 'col.mgmt': 'Gestione', 'col.powered': 'con carico',
    'pdu.type.basic': 'Base', 'pdu.type.metered': 'Metered', 'pdu.type.switched': 'Switched',
    'pdu.type.switched-metered': 'Switched+Metered',
    'pdu.phase.single': 'Mono', 'pdu.phase.three': 'Trifase',
    'pdu.mgmt.none': 'Nessuna', 'pdu.mgmt.ethernet': 'Ethernet', 'pdu.mgmt.serial': 'Console',
    'pdu.mgmt.ethernet-serial': 'Ethernet+Console',
    'pdu.st.active': 'Attiva', 'pdu.st.inactive': 'Inattiva', 'pdu.st.fault': 'Guasta',
    'pdu.src.manual': 'Manuale', 'pdu.src.imported': 'Importato',
        'pdu.fw': 'Firmware', 'pdu.position': 'Posizione', 
    'pdu.rated': 'Corrente nom.', 'pdu.mgmtPorts': 'Porte gestione', 'pdu.assetTag': 'Asset tag',
    'pdu.feedFrom': 'ALIMENTATA DA', 'pdu.loadList': 'PRESE E CARICHI',
    'pdu.groups': 'GRUPPI DI PRESE', 'pdu.grp.switched': 'commutabile', 'pdu.grp.always': 'sempre acceso',
    'pdu.grp.battery': 'batteria', 'pdu.grp.surge': 'solo filtrata',
    'sub.cables': 'cavi documentati nel progetto', 'sub.routes': 'percorsi tracciati',
    'sub.vlans': 'VLAN configurate', 'sub.assets': 'dispositivi documentati',
    'sub.portsA': 'porte su', 'sub.portsB': 'dispositivi',
    'assets.lastRevised': 'Ultima revisione documento', 'assets.withNotes': 'con nota',
    'empty.cables': 'Nessun cavo presente.',
    'empty.asbuilt': 'Nessun percorso tracciabile. Collegare i dispositivi per generare i tracciati.',
    'empty.racks': 'Nessun rack presente nel progetto.', 'empty.ports': 'Nessuna porta configurata.',
    'empty.vlans': 'Nessuna VLAN configurata.', 'empty.assets': 'Nessun dispositivo documentato.',
    'col.num': '#', 'col.label': 'Etichetta', 'col.from': 'Da', 'col.to': 'A', 'col.medium': 'Mezzo',
    'col.length': 'Lungh.', 'col.category': 'Categoria', 'col.route': 'Percorso', 'col.rack': 'Rack',
    'col.device': 'Dispositivo', 'col.pnum': 'P#', 'col.alias': 'Alias / Desc', 'col.status': 'Stato',
    'col.speed': 'Vel.', 'col.connto': 'Connesso a', 'col.type': 'Tipo', 'col.brand': 'Marca',
    'col.model': 'Modello', 'col.serial': 'Serial', 'col.note': 'Nota', 'col.datetime': 'Data / ora',
    'col.user': 'Utente', 'col.action': 'Azione', 'col.object': 'Oggetto', 'col.detail': 'Dettaglio',
    'col.free': 'Libere', 'col.access': 'Access', 'col.sfp': 'SFP', 'col.suspect': 'Sospette',
    'col.used': 'Occupate', 'col.total': 'Totale',
    'vlan.accessPorts': 'Porte access:', 'vlan.trunkLinks': 'Trunk link:',
    'spare.total': 'Totale', 'spare.freeOf': 'libere su', 'spare.suspect': 'sospette (SNMP attive)',
    'spare.noSfp': 'nessuna porta in fibra dichiarata',
    'spare.unracked': '(fuori rack)',
    'title.overview': 'Dashboard',
    'sub.overview': 'Le tre domande sul documento, alla data di questo dossier',
    'empty.overview': 'Dashboard non disponibile per questo progetto.',
    'title.recovery': 'Ripristinabilità (DR)',
    'empty.recovery': 'Nessun apparato gestito da valutare.',
    'rec.recoverable': 'ripristinabili', 'rec.noBackupN': 'senza backup', 'rec.noLocN': 'senza posizione',
    'rec.nonePop': 'nessun apparato da valutare',
    'rec.none': '— nessuno', 'rec.mismatchN': 'con identità da sciogliere', 'rec.mismatch': 'sostituito?',
    'col.lifecycle': 'Ciclo di vita', 'rec.eolN': 'fuori produzione',
    'rec.lcEol': 'EOL', 'rec.lcExpired': 'fuori garanzia', 'rec.lcSoon': 'in scadenza', 'rec.lcOk': 'ok',
    'col.backupRef': 'Backup (dove)', 'col.method': 'Metodo', 'col.backupDate': 'Data backup',
    // ── WAN inter-sede: la mappa e le schede di ripristino ────────────────
    // ⚠️ Qui sta solo l'IMPALCATURA del capitolo (titoli, colonne, stati vuoti):
    // è chrome del report e nell'app non esiste. Le parole dei vocabolari chiusi
    // — la natura di un collegamento, il ruolo di una sede, l'origine di un fatto
    // — NON si riscrivono: si leggono da lib/i18n.js (`_wanVoc`), o il dossier
    // finirebbe per chiamare le stesse cose con nomi diversi dallo schermo.
    'title.wan': 'WAN — mappa delle sedi', 'title.wanSites': 'WAN — sedi',
    'title.wanLines': 'WAN — linee', 'title.wanLinks': 'WAN — collegamenti fra sedi',
    'title.wanAudit': 'WAN — cosa non torna',
    'sub.wanSites': 'sedi', 'sub.wanLines': 'linee WAN', 'sub.wanLinks': 'collegamenti',
    // ㉖ I NOMI dei controlli non stanno qui: si leggono da `lib/i18n.js`
    // (`org.a.*` e `org.why.*`), che è lo stesso dizionario del pannello. Una
    // seconda copia di quaranta frasi diverge alla prima riformulata, e sulla
    // carta la divergenza non la vede nessuno.
    'wan.aProblems': 'incoerenze', 'wan.aGaps': 'lacune',
    'wan.aNotChecked': 'non controllati',
    'wan.aClean': 'Nessun rilievo su sedi, linee e collegamenti.',
    'wan.aNotCheckedTitle': 'Non ho potuto controllare',
    'sub.wanNone': 'nessuna sede dichiarata',
    'empty.wan': 'Nessuna sede dichiarata nel pannello Inter-sede: non c\'è una WAN da documentare.',
    'empty.wanLines': 'Nessuna linea WAN documentata.',
    'empty.wanLinks': 'Nessun collegamento fra sedi documentato.',
    'empty.wanMap': 'Mappa non disponibile: le sedi ci sono, ma il disegno non si è potuto comporre.',
    'wan.noCircuitIdN': 'senza codice circuito', 'wan.noReachN': 'senza reti dichiarate',
    'wan.noProviderN': 'senza operatore',
    'wan.noNextHopN': 'statiche senza gateway',
    // ⚠️ Questa porta il nome di ciò che conta, quindi ha anche il suo SINGOLARE:
    // «1 sedi senza linea WAN» in cima a un capitolo fa dubitare di tutto il
    // resto di ciò che c'è scritto sotto. Le altre due contano senza nominare.
    'wan.noLineN': 'sedi senza linea WAN', 'wan.noLineOne': 'sede senza linea WAN',
    'wan.legendDown': 'tratteggio = collegamento dichiarato down',
    'wan.legendHere': 'bordo in evidenza = la sede di questo progetto',
    'wan.here': 'questa sede',
    'col.site': 'Sede', 'col.address': 'Indirizzo', 'col.nets': 'Reti', 'col.lines': 'Linee',
    'wan.provider': 'Operatore', 'wan.service': 'Servizio', 'wan.circuitId': 'Codice circuito',
    'wan.cir': 'Banda della porta', 'wan.wanIf': 'Interfaccia WAN',
    'wan.addressing': 'Indirizzamento', 'wan.nextHop': 'Gateway (next-hop)',
    'wan.addr.static': 'Statico', 'wan.addr.dhcp': 'DHCP', 'wan.addr.pppoe': 'PPPoE',
    'wan.deliveryVlan': 'VLAN di consegna', 'wan.mtu': 'MTU',
    'wan.support': 'Assistenza operatore',
    'wan.publicIps': 'INDIRIZZI PUBBLICI', 'wan.publicIpsShort': 'Indirizzi pubblici',
    'wan.kind': 'Natura', 'wan.name': 'Nome', 'wan.state': 'Stato',
    'wan.vrf': 'VRF', 'wan.overlay': 'Overlay', 'wan.media': 'Mezzo',
    'wan.ike': 'Versione IKE', 'wan.phase1': 'Nome fase 1',
    'wan.prop1': 'Proposta fase 1 (IKE)', 'wan.prop2': 'Proposta fase 2 (IPsec)',
    'wan.pskRef': 'Dove sta la chiave (PSK)',
    'wan.ends': 'CAPI DEL COLLEGAMENTO', 'wan.reach': 'RETI RAGGIUNGIBILI',
    'wan.underlay': 'LINEE CHE LO TRASMETTONO (UNDERLAY)',
    'wan.at': 'presso', 'wan.peerSeen': 'peer visto da qui',
    'wan.dev.linked': 'agganciato al progetto', 'wan.dev.typed': 'scritto a mano',
    'wan.dev.missing': 'apparato non trovato nel progetto', 'wan.dev.unreadable': 'progetto non leggibile',
    'wan.dev.none': 'apparato non dichiarato',
    'wan.missingSite': 'sede non trovata', 'wan.notFound': 'non trovata',
    'cover.title': 'Dossier di consegna', 'cover.project': 'Progetto', 'cover.date': 'Data',
    'cover.lastRevised': 'Ultima revisione', 'cover.user': 'Generato da',
    'cover.devices': 'Dispositivi', 'cover.cables': 'Cavi', 'cover.vlans': 'VLAN',
    'cover.vms': 'Macchine virtuali',
    'cover.footer': 'Generato con InfraNet Pro', 'audit.system': 'sistema',
  },
  en: {
    'title.inventory': 'Cable inventory', 'title.asbuilt': 'Cabling route (As-Built)',
    'title.racks': 'Rack view', 'title.ports': 'Port assignment', 'title.vlans': 'VLAN summary',
    'title.topology': 'LLDP/CDP topology', 'title.assets': 'Asset register',
    'title.changelog': 'Change history', 'title.spare': 'Free ports', 'title.floorplan': 'Floor plan',
    'title.vms': 'Virtual machines',
    'sub.vms': 'VMs documented on the virtualization hosts',
    'empty.vms': 'No VMs documented on the virtualization hosts.',
    'col.host': 'Host', 'col.vm': 'VM', 'col.role': 'Role', 'col.res': 'Resources',
    'col.owner': 'Owner', 'col.crit': 'Criticality',
    'vm.running': 'Running', 'vm.stopped': 'Stopped', 'vm.unknown': 'Unknown',
    'vm.crit.low': 'Low', 'vm.crit.medium': 'Medium', 'vm.crit.high': 'High', 'vm.crit.critical': 'Critical',
    // ── Power / PDU ──────────────────────────────────────────────────────
    'title.pdu': 'Power — PDUs', 'title.pduOutlets': 'Power — Outlets',
    'sub.pdu': 'documented power distribution units',
    'sub.pduOutlets': 'documented outlets',
    'empty.pdu': 'No PDU documented in this project.',
    'col.phase': 'Phase', 'col.outlets': 'Outlets', 'col.active': 'Active',
    'col.fault': 'Fault', 'col.mgmt': 'Management', 'col.powered': 'with a load',
    'pdu.type.basic': 'Basic', 'pdu.type.metered': 'Metered', 'pdu.type.switched': 'Switched',
    'pdu.type.switched-metered': 'Switched+Metered',
    'pdu.phase.single': 'Single', 'pdu.phase.three': 'Three-phase',
    'pdu.mgmt.none': 'None', 'pdu.mgmt.ethernet': 'Ethernet', 'pdu.mgmt.serial': 'Console',
    'pdu.mgmt.ethernet-serial': 'Ethernet+Console',
    'pdu.st.active': 'Active', 'pdu.st.inactive': 'Inactive', 'pdu.st.fault': 'Fault',
    'pdu.src.manual': 'Manual', 'pdu.src.imported': 'Imported',
        'pdu.fw': 'Firmware', 'pdu.position': 'Position', 
    'pdu.rated': 'Rated current', 'pdu.mgmtPorts': 'Management ports', 'pdu.assetTag': 'Asset tag',
    'pdu.feedFrom': 'FED FROM', 'pdu.loadList': 'OUTLETS AND LOADS',
    'pdu.groups': 'OUTLET GROUPS', 'pdu.grp.switched': 'switchable', 'pdu.grp.always': 'always on',
    'pdu.grp.battery': 'battery', 'pdu.grp.surge': 'surge only',
    'sub.cables': 'cables documented in the project', 'sub.routes': 'traced routes',
    'sub.vlans': 'VLANs configured', 'sub.assets': 'devices documented',
    'sub.portsA': 'ports across', 'sub.portsB': 'devices',
    'assets.lastRevised': 'Document last revised', 'assets.withNotes': 'with a note',
    'empty.cables': 'No cables.',
    'empty.asbuilt': 'No traceable route. Connect the devices to generate routes.',
    'empty.racks': 'No racks in the project.', 'empty.ports': 'No ports configured.',
    'empty.vlans': 'No VLANs configured.', 'empty.assets': 'No devices documented.',
    'col.num': '#', 'col.label': 'Label', 'col.from': 'From', 'col.to': 'To', 'col.medium': 'Medium',
    'col.length': 'Length', 'col.category': 'Category', 'col.route': 'Route', 'col.rack': 'Rack',
    'col.device': 'Device', 'col.pnum': 'P#', 'col.alias': 'Alias / Desc', 'col.status': 'Status',
    'col.speed': 'Speed', 'col.connto': 'Connected to', 'col.type': 'Type', 'col.brand': 'Brand',
    'col.model': 'Model', 'col.serial': 'Serial', 'col.note': 'Note', 'col.datetime': 'Date / time',
    'col.user': 'User', 'col.action': 'Action', 'col.object': 'Object', 'col.detail': 'Detail',
    'col.free': 'Free', 'col.access': 'Access', 'col.sfp': 'SFP', 'col.suspect': 'Suspect',
    'col.used': 'Used', 'col.total': 'Total',
    'vlan.accessPorts': 'Access ports:', 'vlan.trunkLinks': 'Trunk links:',
    'spare.total': 'Total', 'spare.freeOf': 'free of', 'spare.suspect': 'suspect (SNMP active)',
    'spare.noSfp': 'no fibre ports declared',
    'spare.unracked': '(unracked)',
    'title.overview': 'Dashboard',
    'sub.overview': 'The three questions about the document, as of this dossier',
    'empty.overview': 'Dashboard not available for this project.',
    'title.recovery': 'Recoverability (DR)',
    'empty.recovery': 'No managed devices to assess.',
    'rec.recoverable': 'recoverable', 'rec.noBackupN': 'without a backup', 'rec.noLocN': 'without a location',
    'rec.nonePop': 'no devices to assess',
    'rec.none': '— none', 'rec.mismatchN': 'with an unresolved identity', 'rec.mismatch': 'replaced?',
    'col.lifecycle': 'Lifecycle', 'rec.eolN': 'end-of-life',
    'rec.lcEol': 'EOL', 'rec.lcExpired': 'out of warranty', 'rec.lcSoon': 'expiring', 'rec.lcOk': 'ok',
    'col.backupRef': 'Backup (where)', 'col.method': 'Method', 'col.backupDate': 'Backup date',
    // ── Inter-site WAN: the map and the recovery cards ────────────────────
    'title.wan': 'WAN — site map', 'title.wanSites': 'WAN — sites',
    'title.wanLines': 'WAN — lines', 'title.wanLinks': 'WAN — links between sites',
    'title.wanAudit': 'WAN — what does not add up',
    'sub.wanSites': 'sites', 'sub.wanLines': 'WAN lines', 'sub.wanLinks': 'links',
    'wan.aProblems': 'inconsistencies', 'wan.aGaps': 'gaps',
    'wan.aNotChecked': 'not checked',
    'wan.aClean': 'Nothing to report on sites, lines and links.',
    'wan.aNotCheckedTitle': 'Could not be checked',
    'sub.wanNone': 'no site declared',
    'empty.wan': 'No site declared in the Inter-site panel: there is no WAN to document.',
    'empty.wanLines': 'No WAN line documented.',
    'empty.wanLinks': 'No link between sites documented.',
    'empty.wanMap': 'Map unavailable: the sites are there, but the drawing could not be composed.',
    'wan.noCircuitIdN': 'without a circuit ID', 'wan.noReachN': 'without declared networks',
    'wan.noProviderN': 'without a provider',
    'wan.noNextHopN': 'static without a gateway',
    'wan.noLineN': 'sites without a WAN line', 'wan.noLineOne': 'site without a WAN line',
    'wan.legendDown': 'dashed = link declared down',
    'wan.legendHere': 'highlighted box = the site of this project',
    'wan.here': 'this site',
    'col.site': 'Site', 'col.address': 'Address', 'col.nets': 'Networks', 'col.lines': 'Lines',
    'wan.provider': 'Provider', 'wan.service': 'Service', 'wan.circuitId': 'Circuit ID',
    'wan.cir': 'Port bandwidth', 'wan.wanIf': 'WAN interface',
    'wan.addressing': 'Addressing', 'wan.nextHop': 'Gateway (next hop)',
    'wan.addr.static': 'Static', 'wan.addr.dhcp': 'DHCP', 'wan.addr.pppoe': 'PPPoE',
    'wan.deliveryVlan': 'Delivery VLAN', 'wan.mtu': 'MTU',
    'wan.support': 'Operator support',
    'wan.publicIps': 'PUBLIC ADDRESSES', 'wan.publicIpsShort': 'Public addresses',
    'wan.kind': 'Kind', 'wan.name': 'Name', 'wan.state': 'State',
    'wan.vrf': 'VRF', 'wan.overlay': 'Overlay', 'wan.media': 'Medium',
    'wan.ike': 'IKE version', 'wan.phase1': 'Phase 1 name',
    'wan.prop1': 'Phase 1 proposal (IKE)', 'wan.prop2': 'Phase 2 proposal (IPsec)',
    'wan.pskRef': 'Where the key lives (PSK)',
    'wan.ends': 'LINK ENDS', 'wan.reach': 'REACHABLE NETWORKS',
    'wan.underlay': 'LINES CARRYING IT (UNDERLAY)',
    'wan.at': 'at', 'wan.peerSeen': 'peer as seen from here',
    'wan.dev.linked': 'linked to the project', 'wan.dev.typed': 'typed by hand',
    'wan.dev.missing': 'device not found in the project', 'wan.dev.unreadable': 'project cannot be read',
    'wan.dev.none': 'device not declared',
    'wan.missingSite': 'site not found', 'wan.notFound': 'not found',
    'cover.title': 'Handover dossier', 'cover.project': 'Project', 'cover.date': 'Date',
    'cover.lastRevised': 'Last revised', 'cover.user': 'Generated by',
    'cover.devices': 'Devices', 'cover.cables': 'Cables', 'cover.vlans': 'VLANs',
    'cover.vms': 'Virtual machines',
    'cover.footer': 'Generated with InfraNet Pro', 'audit.system': 'system',
  },
};
function _rlang(lang) { return lang === 'en' ? 'en' : 'it'; }             // normalizza (default it)
function _localeTag(lang) { return lang === 'en' ? 'en-GB' : 'it-IT'; }   // per toLocale*
function _rt(lang, key) {
  const L = _RL[_rlang(lang)];
  return (L[key] != null) ? L[key] : (_RL.it[key] != null ? _RL.it[key] : key);
}

function _rHdr(doc, title, projName, date) {
  const M = _RM;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e293b')
     .text(`${projName}  -  ${title}`, M, 12, { lineBreak: false });
  doc.font('Helvetica').fontSize(7).fillColor('#94a3b8')
     .text(date, M, 13, { width: _RW, align: 'right', lineBreak: false });
  doc.moveTo(M, 26).lineTo(M + _RW, 26).strokeColor('#cbd5e1').lineWidth(0.4).stroke();
}

function _rSub(doc, text, y) {
  doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text(text, _RM, y);
  return y + 13;
}

// Tronca il testo alla larghezza REALE della colonna (doc.widthOfString col font
// corrente). La vecchia stima `fontSize*0.5/char` sottostimava i nomi in maiuscolo/
// simboli (es. "CORE-SW-2 (MLAG) P1") -> il testo sforava nella colonna accanto.
// Misura al `fs` dato e RIPRISTINA il fontSize del chiamante (niente effetti collaterali).
function _fit(doc, str, widthPt, fs = 7) {
  str = String(str ?? '');
  if (!str) return str;
  const prev = doc._fontSize;
  doc.fontSize(fs);
  let r = str;
  if (doc.widthOfString(str) > widthPt) {
    while (r.length > 1 && doc.widthOfString(r + '...') > widthPt) r = r.slice(0, -1);
    r += '...';
  }
  doc.fontSize(prev);
  return r;
}

// Manda a capo alla larghezza REALE, preferendo gli spazi (word-aware); i token piu'
// lunghi della colonna vengono spezzati sul punto esatto che entra. Ripristina il fontSize.
function _wrapFit(doc, str, widthPt, fs = 7) {
  const s = String(str ?? '');
  if (!s.length) return [''];
  const prev = doc._fontSize;
  doc.fontSize(fs);
  const fits = t => doc.widthOfString(t) <= widthPt;
  const out = [];
  const hardSplit = (tok) => {                       // token senza spazi piu' largo della colonna
    let t = tok;
    while (t.length && !fits(t)) {
      let lo = 1, hi = t.length, cut = 1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (fits(t.slice(0, mid))) { cut = mid; lo = mid + 1; } else hi = mid - 1; }
      out.push(t.slice(0, cut));
      t = t.slice(cut);
    }
    return t;                                        // resto che entra
  };
  let line = '';
  s.split(/\s+/).filter(Boolean).forEach(w => {
    const cand = line ? line + ' ' + w : w;
    if (fits(cand)) { line = cand; return; }
    if (line) { out.push(line); line = ''; }
    line = fits(w) ? w : hardSplit(w);
  });
  if (line) out.push(line);
  doc.fontSize(prev);
  return out.length ? out : [''];
}

// `opts.notes` (facoltativo, array PARALLELO a `rows`): la nota della riga, disegnata
// a TUTTA LARGHEZZA sotto le celle invece che in una colonna. Una nota e' prosa libera
// di lunghezza imprevedibile: in una colonna da ~50pt sarebbe illeggibile e farebbe
// esplodere l'altezza di ogni riga, mentre a tutta larghezza sta in una o due righe e
// resta attaccata al suo apparato (stessa banda zebrata, stesso bordo).
// `opts.noteLabel` = etichetta breve premessa al testo (es. «Nota»).
function _rTable(doc, cols, rows, y0, title, projName, date, opts = {}) {
  const M = _RM, HH = 16, RH = 13, FS = 7;
  const NFS = 6.5, NLH = 8;                            // nota: piu' piccola del corpo tabella
  const notesArr = Array.isArray(opts.notes) ? opts.notes : null;
  const noteLabel = opts.noteLabel ? String(opts.noteLabel) + ': ' : '';
  const TW = cols.reduce((s, c) => s + c.w, 0);
  let y = y0;

  const drawHdr = () => {
    let x = M;
    doc.rect(M, y, TW, HH).fill('#1e3a5f');
    doc.font('Helvetica-Bold').fontSize(FS).fillColor('#ffffff');
    cols.forEach(c => {
      doc.text(_fit(doc, c.label, c.w - 6, FS), x + 3, y + 4, { lineBreak: false });
      x += c.w;
    });
    y += HH;
  };

  drawHdr();

  rows.forEach((row, ri) => {
    doc.font('Helvetica').fontSize(FS);                 // misura le celle col font di disegno (non il Bold dell'header)
    const cellLines = cols.map((c, ci) => {
      const raw = String(row[ci] ?? '');
      if (c.wrap) return _wrapFit(doc, raw, c.w - 6, FS);
      if (c.shrink) return [raw];
      return [_fit(doc, raw, c.w - 6, FS)];
    });
    const rowLines = Math.max(...cellLines.map(lines => lines.length));
    const cellsH = Math.max(RH, 4 + rowLines * 9);
    const noteTxt = notesArr ? String(notesArr[ri] ?? '').trim() : '';
    const noteLines = noteTxt ? _wrapFit(doc, noteLabel + noteTxt, TW - 22, NFS) : [];
    const rowH = cellsH + (noteLines.length ? noteLines.length * NLH + 3 : 0);

    if (y + rowH > _BOT) {
      doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
      _rHdr(doc, title, projName, date);
      y = _TOP;
      drawHdr();
    }
    doc.rect(M, y, TW, rowH).fill(ri % 2 === 0 ? '#ffffff' : '#f8fafc');
    doc.font('Helvetica').fontSize(FS);
    let x = M;
    cols.forEach((c, ci) => {
      const color = c.statusMap?.[String(row[ci])] ?? c.color ?? '#1e293b';
      const lines = cellLines[ci];
      const baseText = String(row[ci] ?? '');

      if (c.arrowAlign && lines.length && /\s*->\s*/.test(baseText)) {
        const m = baseText.match(/^(.*?)\s*->\s*(.*)$/);
        let leftRaw  = String(m?.[1] ?? '').trim();
        let rightRaw = String(m?.[2] ?? '').trim();
        const cellL = x + 3;
        const cellR = x + c.w - 3;
        const mid   = (cellL + cellR) / 2;
        const gap   = 6;
        const leftW  = Math.max(10, (mid - gap) - cellL);
        const rightW = Math.max(10, cellR - (mid + gap));

        // Riduce il font (misura REALE) finche' entrambe le meta' entrano; sotto il
        // minimo leggibile (5pt) tronca con ellissi -> mai overflow nella colonna accanto.
        doc.font('Helvetica');
        const needFs = (txt, w) => {
          if (!txt) return FS;
          let f = FS; doc.fontSize(f);
          while (f > 5 && doc.widthOfString(txt) > w) { f -= 0.25; doc.fontSize(f); }
          return f;
        };
        const fs = Math.max(5, Math.min(FS, needFs(leftRaw, leftW), needFs(rightRaw, rightW)));
        leftRaw  = _fit(doc, leftRaw,  leftW,  fs);
        rightRaw = _fit(doc, rightRaw, rightW, fs);
        const arrowW = doc.fontSize(fs).widthOfString('->');

        doc.font('Helvetica').fontSize(fs).fillColor(color)
           .text(leftRaw, cellL, y + 3, { width: leftW, align: 'right', lineBreak: false });
        doc.font('Helvetica').fontSize(fs).fillColor(color)
           .text('->', mid - (arrowW / 2), y + 3, { lineBreak: false });
        doc.font('Helvetica').fontSize(fs).fillColor(color)
           .text(rightRaw, mid + gap, y + 3, { width: rightW, align: 'left', lineBreak: false });
        x += c.w;
        return;
      }

      lines.forEach((line, li) => {
        let fs = FS;
        let txt = line;
        if (c.shrink && li === 0) {
          // Monoriga: riduce il font (misura REALE) fino a un minimo leggibile; se al
          // minimo non entra ancora, tronca con ellissi -> mai overflow.
          const targetW = c.w - 6;
          doc.font('Helvetica'); fs = FS; doc.fontSize(fs);
          while (fs > 5 && doc.widthOfString(baseText) > targetW) { fs -= 0.25; doc.fontSize(fs); }
          txt = doc.widthOfString(baseText) > targetW ? _fit(doc, baseText, targetW, fs) : baseText;
        }
        doc.font('Helvetica').fontSize(fs).fillColor(color)
           .text(txt, x + 3, y + 3 + (li * 9), { lineBreak: false });
      });
      x += c.w;
    });
    // Nota della riga: corsivo tenue, rientrata, sotto le celle e dentro la stessa
    // banda. Le metriche di Helvetica-Oblique sono quelle di Helvetica -> la misura
    // fatta sopra con _wrapFit resta valida.
    if (noteLines.length) {
      doc.font('Helvetica-Oblique').fontSize(NFS).fillColor('#64748b');
      noteLines.forEach((line, li) => {
        doc.text(line, M + 11, y + cellsH - 1 + (li * NLH), { lineBreak: false });
      });
      doc.font('Helvetica');
    }
    doc.moveTo(M, y + rowH).lineTo(M + TW, y + rowH).strokeColor('#e2e8f0').lineWidth(0.2).stroke();
    y += rowH;
  });

  doc.moveTo(M,        y0).lineTo(M,        y).strokeColor('#cbd5e1').lineWidth(0.3).stroke();
  doc.moveTo(M + TW, y0).lineTo(M + TW, y).strokeColor('#cbd5e1').lineWidth(0.3).stroke();
  return y + 6;
}

function _addReportPages(doc, report, projName, date, SVGtoPDF, options = {}, lang = 'it') {
  const L = _rlang(lang);
  const opts = {
    includeInventory: true,
    includeAsBuilt: true,
    includeRacks: true,
    includePorts: true,
    includeVlans: true,
    includeTopology: true,
    includeVms: true,
    ...options,
  };
  const newPage = (title) => {
    doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    _rHdr(doc, title, projName, date);
    return _TOP;
  };

  // ── Pagina 2: Inventario Cavi ──────────────────────────────────────────
  if (opts.includeInventory) {
    const T = _rt(L, 'title.inventory');
    let y = newPage(T);
    y = _rSub(doc, `${(report.cables || []).length} ${_rt(L, 'sub.cables')}`, y);
    const cols = [
      { label: _rt(L, 'col.num'),      w: 22  },
      { label: _rt(L, 'col.label'),    w: 155, shrink: true, arrowAlign: true },
      { label: _rt(L, 'col.from'),     w: 75, wrap: true },
      { label: _rt(L, 'col.to'),       w: 75, wrap: true },
      { label: 'VLAN',                 w: 70, shrink: true },
      { label: _rt(L, 'col.medium'),   w: 40  },
      { label: _rt(L, 'col.length'),   w: 30  },
      { label: _rt(L, 'col.category'), w: 72, wrap: true },
    ]; // 539
    const rows = (report.cables || []).map((c, i) => [
      i + 1, c.label || '-', c.from || '-', c.to || '-',
      // Un trunk porta piu' VLAN: si stampa la LISTA, non una sola col nome — su
      // carta non c'e' il colore a distinguerle, e una sola diceva meno del vero.
      c.vlanCarried ? c.vlanCarried
        : (c.vlan ? `${c.vlan}${c.vlanName ? ' - ' + c.vlanName : ''}` : '-'),
      c.medium || '-', c.length || '-', c.category || '-',
    ]);
    if (!rows.length)
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(_rt(L, 'empty.cables'), _RM, y);
    else
      _rTable(doc, cols, rows, y, T, projName, date);
  }

  // ── Pagina 3: Tracciato As-Built ───────────────────────────────────────
  if (opts.includeAsBuilt) {
    const T = _rt(L, 'title.asbuilt');
    let y = newPage(T);
    y = _rSub(doc, `${(report.asBuilt || []).length} ${_rt(L, 'sub.routes')}`, y);
    const cols = [
      { label: _rt(L, 'col.num'),    w: 22  },
      { label: _rt(L, 'col.route'),  w: 333, wrap: true },
      { label: 'VLAN',               w: 112, shrink: true },
      { label: _rt(L, 'col.medium'), w: 72  },
    ]; // 539
    const rows = (report.asBuilt || []).map((p, i) => [
      i + 1, (p.steps || []).join(' -> '), p.vlan || '-', p.medium || '-',
    ]);
    if (!rows.length)
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
         .text(_rt(L, 'empty.asbuilt'), _RM, y);
    else
      _rTable(doc, cols, rows, y, T, projName, date);
  }

  // ── Pagina 4: Assegnazione porte ───────────────────────────────────────
  // Vista rack: una pagina per rack.
  if (opts.includeRacks) {
    const T = _rt(L, 'title.racks');
    const rackSvgs = Array.isArray(report.rackSvgs)
      ? report.rackSvgs.filter(r => r && typeof r.svg === 'string' && r.svg.trim())
      : [];

    if (!rackSvgs.length) {
      let y = newPage(T);
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
         .text(_rt(L, 'empty.racks'), _RM, y);
    } else {
      rackSvgs.forEach(rack => {
        const rackName = String(rack.rackName || rack.rackId || 'Rack').substring(0, 80);
        const vbM = rack.svg.match(/viewBox="([^"]+)"/);
        const vbP = vbM ? vbM[1].trim().split(/[\s,]+/).map(Number) : [0, 0, 560, 840];
        const sW = vbP[2] || 560;
        const sH = vbP[3] || 840;
        const ratio = Math.min(_RW / sW, 780 / sH, 1);
        const rW = Math.round(sW * ratio);
        const rH = Math.round(sH * ratio);
        const pageH = Math.max(180, rH + 54);
        const x = _RM + Math.max(0, (_RW - rW) / 2);

        doc.addPage({ size: [595, pageH], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
        _rHdr(doc, `${T} - ${rackName}`, projName, date);
        try {
          SVGtoPDF(doc, rack.svg, x, 34, {
            width: rW, height: rH, assumePt: true,
            preserveAspectRatio: 'xMidYMid meet',
            fontCallback: (_family, bold) => bold ? 'Helvetica-Bold' : 'Helvetica',
            warningCallback: () => {},
          });
        } catch (e) {
          console.error(`  [PDF] rack ${rackName}: ${e.message}`);
        }
      });
    }
  }

  if (opts.includePorts) {
    const T = _rt(L, 'title.ports');
    let y = newPage(T);
    const allRows = [];
    (report.portAssignment || []).forEach(dev =>
      (dev.ports || []).forEach(p =>
        allRows.push([dev.rack, dev.device, p.num, p.alias || '-',
                      p.status || '—', p.speed || '-', p.vlan || '-', p.connectedTo || '-'])
      )
    );
    y = _rSub(doc, `${allRows.length} ${_rt(L, 'sub.portsA')} ${(report.portAssignment || []).length} ${_rt(L, 'sub.portsB')}`, y);
    const SC = { active: '#16a34a', fault: '#dc2626', inactive: '#6b7280' };
    const cols = [
      { label: _rt(L, 'col.rack'),   w: 96, wrap: true },
      { label: _rt(L, 'col.device'), w: 74, wrap: true },
      { label: _rt(L, 'col.pnum'),   w: 24  },
      { label: _rt(L, 'col.alias'),  w: 92, wrap: true },
      { label: _rt(L, 'col.status'), w: 50, statusMap: SC },
      { label: _rt(L, 'col.speed'),  w: 42  },
      { label: 'VLAN',               w: 70, shrink: true },
      { label: _rt(L, 'col.connto'), w: 91, wrap: true },
    ]; // 539
    if (!allRows.length)
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(_rt(L, 'empty.ports'), _RM, y);
    else
      _rTable(doc, cols, allRows, y, T, projName, date);
  }

  // ── Pagina 5: Sommario VLAN (card per VLAN) ────────────────────────────
  if (opts.includeVlans) {
    const T = _rt(L, 'title.vlans');
    let y = newPage(T);
    y = _rSub(doc, `${(report.vlans || []).length} ${_rt(L, 'sub.vlans')}`, y);

    if (!(report.vlans || []).length) {
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
         .text(_rt(L, 'empty.vlans'), _RM, y);
    } else {
      const M = _RM, CW = _RW;

      (report.vlans || []).forEach(v => {
        const ag  = v.accessGroups || [];
        const tl2 = v.trunkLinks   || [];
        const totalAcc = v.totalAccess || ag.reduce((s, g) => s + (g.ports||[]).length, 0);

        // IPAM (da tabella VLAN): range IP, gateway di default, DNS — mostrati
        // inline dentro la fascia blu dell'header, separati da " | ".
        const ipamParts = [];
        if (v.subnet)  ipamParts.push(`Range ${v.subnet}`);
        if (v.gateway) ipamParts.push(`Gateway ${v.gateway}`);
        if (v.dns)     ipamParts.push(`DNS ${v.dns}`);

        // Ricalcola altezza card tenendo conto del wrapping reale.
        const DNAME_W = 140;  // larghezza colonna nome device
        const PORTS_W = CW - DNAME_W - 6;
        doc.font('Helvetica');                      // misura il wrapping col font di disegno
        const agRows = ag.reduce((s, g) => {
          const portsStr = (g.ports || []).map(p => `P${p}`).join('  ');
          return s + _wrapFit(doc, portsStr, PORTS_W, 6).length;
        }, 0);
        const tlRows = tl2.reduce((s, link) => {
          const txt = typeof link === 'string'
            ? link
            : `${link?.src || '?'} P${link?.srcPort || '?'} -> ${link?.dst || '?'} P${link?.dstPort || '?'}`
              + (link?.vlans ? ` [${link.vlans}]` : '');
          return s + _wrapFit(doc, txt, CW - 6, 6).length;
        }, 0);
        const realCardH = 18
          + (ag.length  ? 10 + agRows * 9 + 2 : 0)
          + (tl2.length ? 10 + tlRows * 9    : 0)
          + 6;

        if (y + realCardH > _BOT) {
          doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
          _rHdr(doc, T, projName, date);
          y = _TOP;
        }

        // Header bar
        doc.rect(M, y, CW, 18).fill('#1e293b');
        const vCol = /^#[0-9a-f]{6}$/i.test(v.color || '') ? v.color : '#00d4ff';
        doc.circle(M + 9, y + 9, 3.5).fill(vCol);
        const counts = `${totalAcc} access   ${tl2.length} trunk`;
        const countsW = doc.font('Helvetica').fontSize(7).widthOfString(counts);
        // Nome VLAN (bold, bianco)
        const hdr = `VLAN ${v.id}${v.name ? '  ' + v.name : ''}`;
        const maxName = CW - 110;
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
        const nameW = Math.min(doc.widthOfString(hdr), maxName);
        doc.text(_fit(doc, hdr, maxName, 8), M + 18, y + 5, { lineBreak: false });
        // IPAM inline nella fascia blu, dopo il nome, separato da " | "
        if (ipamParts.length) {
          const ipamStr = '|  ' + ipamParts.join('  |  ');
          const startX = M + 18 + nameW + 8;
          const availW = (M + CW - countsW - 10) - startX;
          if (availW > 30) {
            doc.font('Helvetica').fontSize(6.5).fillColor('#ffffff')
               .text(_fit(doc, ipamStr, availW, 6.5), startX, y + 6.5, { lineBreak: false });
          }
        }
        // Conteggi access/trunk (a destra)
        doc.font('Helvetica').fontSize(7).fillColor('#94a3b8')
           .text(counts, M, y + 6, { width: CW, align: 'right', lineBreak: false });
        y += 18;

        // Porte access raggruppate per device, porte in ordine
        if (ag.length) {
          doc.font('Helvetica-Bold').fontSize(6).fillColor('#475569')
             .text(_rt(L, 'vlan.accessPorts'), M + 3, y + 2, { lineBreak: false });
          y += 10;
          ag.forEach(grp => {
            const portsStr = (grp.ports || []).map(p => `P${p}`).join('  ');
            const devLabel = `${String(grp.device ?? '')}:`;
            doc.font('Helvetica');                  // stesso font del pre-calcolo altezza
            const portLines = _wrapFit(doc, portsStr, PORTS_W, 6);
            doc.font('Helvetica-Bold').fontSize(6).fillColor('#334155')
               .text(_fit(doc, devLabel, DNAME_W - 6, 6), M + 3, y, { lineBreak: false });
            portLines.forEach((line, i) => {
              doc.font('Helvetica').fontSize(6).fillColor('#1e293b')
                 .text(line, M + 3 + DNAME_W, y + (i * 9), { lineBreak: false });
            });
            y += Math.max(1, portLines.length) * 9;
          });
          y += 2;
        }

        // Trunk link
        if (tl2.length) {
          doc.font('Helvetica-Bold').fontSize(6).fillColor('#475569')
             .text(_rt(L, 'vlan.trunkLinks'), M + 3, y + 2, { lineBreak: false });
          y += 10;
          tl2.forEach(link => {
            const txt = typeof link === 'string'
              ? link
              : `${link?.src || '?'} P${link?.srcPort || '?'} -> ${link?.dst || '?'} P${link?.dstPort || '?'}`
                + (link?.vlans ? ` [${link.vlans}]` : '');
            doc.font('Helvetica');                  // stesso font del pre-calcolo altezza
            _wrapFit(doc, txt, CW - 6, 6).forEach(line => {
              doc.font('Helvetica').fontSize(6).fillColor('#1e293b')
                 .text(line, M + 3, y, { lineBreak: false });
              y += 9;
            });
          });
        }

        y += 6;
      });
    }
  }

  // ── Pagina 6: Topologia ────────────────────────────────────────────────
  if (opts.includeTopology && report.topoSvg && typeof report.topoSvg === 'string') {
    const T = _rt(L, 'title.topology');
    const vbM = report.topoSvg.match(/viewBox="([^"]+)"/);
    const vbP = vbM ? vbM[1].trim().split(/[\s,]+/).map(Number) : [0, 0, 800, 600];
    const sW = vbP[2] || 800, sH = vbP[3] || 600;
    const ratio = Math.min(_RW / sW, 780 / sH, 1);
    const rW = Math.round(sW * ratio), rH = Math.round(sH * ratio);
    doc.addPage({ size: [595, rH + 44], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    _rHdr(doc, T, projName, date);
    try {
      SVGtoPDF(doc, report.topoSvg, _RM, 34, {
        width: rW, height: rH, assumePt: true,
        preserveAspectRatio: 'xMidYMid meet',
        fontCallback: () => 'Helvetica',
        warningCallback: () => {},
      });
    } catch (e) { console.error(`  [PDF] topo: ${e.message}`); }
  }

  // ── Macchine virtuali ─────────────────────────────────────────────────
  // Capitolo satellite dell'inventario fisico: l'host e' il device documentato,
  // la VM e' cio' che ci gira sopra. Sta a valle della topologia perche' e'
  // inventario LOGICO, non un percorso fisico. Tutti i dati sono DICHIARATI
  // dall'utente (nessuna misura SNMP dei guest): dove il campo manca si stampa
  // '-', mai uno zero che sembrerebbe una misura (paletto no-invenzioni).
  // Guardia sull'array: un client vecchio non manda report.vms -> niente pagina.
  if (opts.includeVms && Array.isArray(report.vms)) {
    const T = _rt(L, 'title.vms');
    const list = report.vms;
    let y = newPage(T);
    y = _rSub(doc, `${list.length} ${_rt(L, 'sub.vms')}`, y);
    // 10 colonne = il massimo leggibile su A4 verticale a 7pt. Il MAC della VM
    // resta FUORI dalla stampa (a 11 colonne ogni cella finiva troncata): in un
    // documento di consegna conta cosa fa la VM, chi la gestisce e quanto pesa,
    // non l'indirizzo della sua vNIC — che resta comunque nel progetto JSON,
    // nell'API e nel confronto col Drift.
    // VLAN e IP vanno A CAPO: una VM multi-vNIC (firewall virtuale WAN/LAN/DMZ)
    // porta più valori nella stessa cella, e troncarli nasconderebbe proprio la
    // gamba che manca al lettore. Larghezze ribilanciate a somma invariata.
    const cols = [
      { label: _rt(L, 'col.num'),    w: 14 },
      { label: _rt(L, 'col.host'),   w: 56, wrap: true },
      { label: _rt(L, 'col.vm'),     w: 64, wrap: true },
      { label: _rt(L, 'col.role'),   w: 76, wrap: true },
      { label: _rt(L, 'col.status'), w: 40 },
      { label: 'VLAN',               w: 36, wrap: true },
      { label: 'IP',                 w: 82, wrap: true },
      { label: _rt(L, 'col.res'),    w: 85, shrink: true },
      { label: _rt(L, 'col.owner'),  w: 52, wrap: true },
      { label: _rt(L, 'col.crit'),   w: 34, shrink: true },
    ]; // 539
    const rows = list.map((vm, i) => {
      // Risorse allocate in una sola colonna: e' come le legge un umano
      // ("4 vCPU / 8 GB / 100 GB") e lascia spazio alle colonne identitarie.
      const res = [
        vm.vcpu  != null ? `${vm.vcpu} vCPU`  : null,
        vm.ramGb != null ? `${vm.ramGb} GB`   : null,
        vm.diskGb != null ? `${vm.diskGb} GB` : null,
      ].filter(Boolean).join(' / ');
      // Criticita': etichetta tradotta solo per i valori noti. Un valore fuori
      // scala (progetto vecchio, import) si stampa com'e' invece di sparire.
      const crit = vm.criticality
        ? (_RL[L][`vm.crit.${vm.criticality}`] || vm.criticality)
        : '';
      return [
        i + 1, vm.host || '-', vm.name || '-', vm.role || '-',
        _rt(L, vm.state === 'running' ? 'vm.running' : vm.state === 'stopped' ? 'vm.stopped' : 'vm.unknown'),
        vm.vlan || '-', vm.ip || '-', res || '-',
        vm.owner || '-', crit || '-',
      ];
    });
    if (!rows.length)
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(_rt(L, 'empty.vms'), _RM, y);
    else
      _rTable(doc, cols, rows, y, T, projName, date);
  }
}

// ============================================================
// DOSSIER DI CONSEGNA (N4) — pagine aggiuntive: copertina, note, changelog
// ============================================================
let _auditLabel = null;
function _actionLabel(a, lang) {
  if (_auditLabel === null) {
    try { _auditLabel = require('../lib/audit-log').auditActionLabel; }
    catch (_) { _auditLabel = (x => x); }
  }
  return _auditLabel(a, lang) || a || (lang === 'en' ? 'Change' : 'Modifica');
}

// Copertina A4: banda titolo, metadati progetto/data/autore, box conteggi.
function _addCoverPage(doc, cover, lang = 'it') {
  cover = cover || {};
  const L = _rlang(lang);
  const M = _RM, W = _RW;
  doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  doc.rect(0, 0, 595, 150).fill('#1e3a5f');
  doc.font('Helvetica-Bold').fontSize(26).fillColor('#ffffff')
     .text(String(cover.title || _rt(L, 'cover.title')), M, 54, { width: W, lineBreak: false });
  doc.font('Helvetica').fontSize(13).fillColor('#cbd5e1')
     .text(String(cover.project || ''), M, 100, { width: W, lineBreak: false });

  let y = 200;
  const meta = [
    [_rt(L, 'cover.project'), cover.project || '—'],
    [_rt(L, 'cover.date'), cover.date || '—'],
    // "Ultima revisione" = project.updated_at (ultima modifica documentale),
    // distinta dalla data di generazione del report. Presente solo se il server
    // ha potuto caricare il progetto (vedi routes/export.js). Requisito NIS2/ISO:
    // la documentazione deve mostrare quando e' stata aggiornata.
    ...(cover.lastRevised ? [[_rt(L, 'cover.lastRevised'), _fmtRevised(cover.lastRevised, lang)]] : []),
    [_rt(L, 'cover.user'), cover.user || '—'],
  ];
  meta.forEach(([k, v]) => {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#64748b').text(k, M, y, { width: 120, lineBreak: false });
    doc.font('Helvetica').fontSize(10).fillColor('#1e293b').text(String(v), M + 120, y, { width: W - 120, lineBreak: false });
    y += 22;
  });

  y += 24;
  // Le VM hanno un contatore PROPRIO, mai sommato ai dispositivi: un host con 10
  // VM resta UN apparato installato. E' la convenzione dei DCIM di riferimento
  // (NetBox tiene "Devices" e "Virtual machines" su widget distinti) ed evita di
  // gonfiare il numero che il cliente legge come "apparati consegnati".
  const stats = [
    [_rt(L, 'cover.devices'), cover.deviceCount],
    [_rt(L, 'cover.cables'), cover.cableCount],
    [_rt(L, 'cover.vlans'), cover.vlanCount],
    [_rt(L, 'cover.vms'), cover.vmCount],
  ];
  const bw = (W - 10 * (stats.length - 1)) / stats.length;
  stats.forEach(([k, v], i) => {
    const x = M + i * (bw + 10);
    doc.rect(x, y, bw, 64).fillAndStroke('#f1f5f9', '#cbd5e1');
    // Dato mancante = trattino, come ovunque nel dossier. Uno «0» grande così è
    // un'affermazione, e su un contatore mai fornito sarebbe falsa.
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#1e3a5f').text(v == null ? '-' : String(v), x, y + 12, { width: bw, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(k, x, y + 44, { width: bw, align: 'center', lineBreak: false });
  });

  doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
     .text(_rt(L, 'cover.footer'), M, 802, { width: W, align: 'center', lineBreak: false });
}

// Pagine Changelog: tabella Data/ora | Utente | Azione | Oggetto | Dettaglio.
function _addChangelogPages(doc, changelog, projName, date, lang = 'it') {
  if (!Array.isArray(changelog) || !changelog.length) return;
  const L = _rlang(lang);
  const T = _rt(L, 'title.changelog');
  doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  _rHdr(doc, T, projName, date);
  // Oggetto/Azione ora WRAPPANO (niente piu' troncamento "..."): l'Oggetto
  // contiene i nomi cavo "A -> B" che possono essere lunghi. Larghezze ribilanciate
  // a favore di Oggetto (somma colonne = _RW).
  const cols = [
    { label: _rt(L, 'col.datetime'), w: 90 },
    { label: _rt(L, 'col.user'), w: 50 },
    { label: _rt(L, 'col.action'), w: 94, wrap: true },
    { label: _rt(L, 'col.object'), w: 187, wrap: true },
    { label: _rt(L, 'col.detail'), w: _RW - 421, wrap: true },
  ];
  // La freccia unicode → (U+2192) non e' nel font WinAnsi di base del PDF e usciva
  // come "!'": la normalizziamo a "->", rappresentabile e coerente con l'arrowAlign.
  const _pdfTxt = s => String(s == null ? '' : s).replace(/→/g, '->');
  const rows = changelog.map(e => {
    let when = e && e.ts || '';
    try { when = new Date(e.ts).toLocaleString(_localeTag(L)); } catch (_) {}
    return [when, (e && e.user) || _rt(L, 'audit.system'), _actionLabel(e && e.action, L), _pdfTxt(e && e.target), _pdfTxt(e && e.summary)];
  });
  _rTable(doc, cols, rows, _TOP, T, projName, date);
}

// Pagine Porte libere (capacità): riepilogo + tabella per rack → device.
// spare = output di lib/spare-ports.js: { totals, racks[], unracked[] }.
function _addSparePages(doc, spare, projName, date, lang = 'it') {
  spare = spare || {};
  const L = _rlang(lang);
  const T = _rt(L, 'title.spare');
  const racks = Array.isArray(spare.racks) ? spare.racks : [];
  const unracked = Array.isArray(spare.unracked) ? spare.unracked : [];
  if (!racks.length && !unracked.length) return;
  const t = spare.totals || {};
  doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  _rHdr(doc, T, projName, date);
  // «0 SFP» e «nessuna fibra dichiarata» sono due fatti diversi, e la Panoramica
  // li distingue già (riga freeSfp, tratteggiata quando non c'è fibra): il dossier
  // deve dire la stessa cosa dello schermo, o è la stessa metrica con due verità.
  const sfpTxt = t.sfp ? `${t.freeSfp || 0} ${_rt(L, 'spare.freeOf')} ${t.sfp} SFP/uplink`
                       : _rt(L, 'spare.noSfp');
  const summary = `${_rt(L, 'spare.total')}: ${t.free || 0} ${_rt(L, 'spare.freeOf')} ${t.ports || 0}  -  ${t.freeAccess || 0} access  -  ${sfpTxt}`
    + (t.suspect ? `  -  ${t.suspect} ${_rt(L, 'spare.suspect')}` : '');
  const y = _rSub(doc, summary, _TOP);
  const cols = [
    { label: _rt(L, 'col.rack'), w: 95 },
    { label: _rt(L, 'col.device'), w: 150 },
    { label: _rt(L, 'col.free'), w: 48, color: '#1a7f37' },
    { label: 'Access', w: 46 },
    { label: 'SFP', w: 40 },
    { label: _rt(L, 'col.suspect'), w: 58, color: '#b8860b' },
    { label: _rt(L, 'col.used'), w: 50 },
    { label: _rt(L, 'col.total'), w: 46 },
  ];
  const rows = [];
  const pushDev = (rackName, d) => rows.push([
    // Un apparato senza porte in fibra non ha «0 SFP libere»: non ha SFP. Il
    // trattino lo dice, lo zero lo nasconderebbe dentro un conteggio.
    rackName, d.name, String(d.free), String(d.freeAccess), d.sfp ? String(d.freeSfp) : '-',
    d.suspect ? String(d.suspect) : '', String(d.used), String(d.total),
  ]);
  racks.forEach(r => (r.devices || []).forEach(d => pushDev(r.name, d)));
  unracked.forEach(d => pushDev(_rt(L, 'spare.unracked'), d));
  _rTable(doc, cols, rows, y, T, projName, date);
}

// ── ALIMENTAZIONE / PDU ──────────────────────────────────────────────────────
// Due pagine, stessa ossatura grafica del resto del report (_rHdr + _rSub +
// _rTable): un RIEPILOGO (dov'è ogni PDU, che tipo è, quante prese, come si
// gestisce) e il DETTAGLIO PRESE (cosa alimenta ciascuna, e di chi è la parola).
// Le righe arrivano già composte da lib/pdu-report.js (puro, testato): qui si fa
// solo impaginazione e traduzione — nessuna regola di dominio duplicata.
//
// Onestà: un campo non dichiarato stampa '-' e MAI uno zero (uno zero afferma
// «misurato zero»). Un PDU importato che dichiara solo il numero di prese, senza
// elencarle, lo dice a chiare lettere invece di esibire una riga di zeri.
function _addPduPages(doc, pdu, projName, date, lang = 'it') {
  pdu = pdu || {};
  const L = _rlang(lang);
  const summary = Array.isArray(pdu.summary) ? pdu.summary : [];
  const outlets = Array.isArray(pdu.outlets) ? pdu.outlets : [];
  const t = pdu.totals || {};
  // Capitolo CHIESTO ma progetto senza PDU: si stampa la pagina con lo stato vuoto,
  // non si sparisce in silenzio. Sparire lascia il lettore a chiedersi se il
  // capitolo manchi per un errore — e chi l'ha spuntato merita una risposta
  // esplicita («qui non c'è nulla di documentato»). Stessa convenzione di VM e VLAN.
  if (!summary.length) {
    const T0 = _rt(L, 'title.pdu');
    doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    _rHdr(doc, T0, projName, date);
    const y0 = _rSub(doc, `0 ${_rt(L, 'sub.pdu')}`, _TOP);
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(_rt(L, 'empty.pdu'), _RM, y0);
    return;
  }
  // Etichetta tradotta per i valori NOTI; un valore fuori scala (progetto vecchio,
  // import di un vendor esotico) si stampa com'è invece di sparire.
  const lbl = (prefix, v) => (v ? (_RL[L][`${prefix}.${v}`] || v) : '-');

  // ── UNA SCHEDA DI RIPRISTINO PER PDU, tutto su un blocco solo ────────
  // È il capitolo che serve davvero in consegna: chi deve rimettere in servizio
  // una PDU sostituita trova qui, su una sola scheda, identità e matricola, dove
  // sta nel rack, da dove prende corrente, come la si raggiunge per gestirla,
  // dove vive il backup della configurazione e cosa alimenta ogni presa. Stesso
  // linguaggio visivo delle card VLAN (fascia scura + corpo a due colonne).
  const T2 = _rt(L, 'title.pdu');
  doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  _rHdr(doc, T2, projName, date);
  // I totali del capitolo stanno in UNA riga sopra le schede: bastano a dare la
  // misura d'insieme e non costano una pagina di tabella che ripeterebbe, campo
  // per campo, quello che ogni scheda dice già per esteso.
  const freeTxt = t.free == null ? '' : `  -  ${t.free} ${_rt(L, 'col.free')}`;
  let y = _rSub(doc, `${t.pdus || 0} ${_rt(L, 'sub.pdu')}  -  ${t.outlets || 0} ${_rt(L, 'sub.pduOutlets')}`
    + `  -  ${t.active || 0} ${_rt(L, 'col.active')}  -  ${t.powered || 0} ${_rt(L, 'col.powered')}${freeTxt}`
    + (t.fault ? `  -  ${t.fault} ${_rt(L, 'col.fault')}` : ''), _TOP);
  const M = _RM, CW = _RW;
  const outletsByPdu = new Map();
  for (const o of outlets) {
    if (!outletsByPdu.has(o.pduId)) outletsByPdu.set(o.pduId, []);
    outletsByPdu.get(o.pduId).push(o);
  }

  for (const s of summary) {
    const mine = outletsByPdu.get(s.id) || [];
    // Coppie etichetta/valore, due per riga: la scheda si legge come una targa.
    const pairs = [
      [_rt(L, 'col.brand'), s.brand], [_rt(L, 'col.model'), s.model],
      [_rt(L, 'col.serial'), s.serial], [_rt(L, 'pdu.fw'), s.firmware],
      [_rt(L, 'col.rack'), s.rackName], [_rt(L, 'pdu.position'), s.rackU == null ? null : `U${s.rackU}${s.sizeU ? ` (${s.sizeU}U)` : ''}`],
      [_rt(L, 'col.type'), s.pduType ? lbl('pdu.type', s.pduType) : null],
      // ⚠️ Niente riga «Montaggio»: InfraNet monta la PDU solo in orizzontale.
      [_rt(L, 'col.phase'), s.phase ? lbl('pdu.phase', s.phase) : null],
      [_rt(L, 'pdu.rated'), s.currentA == null ? null : `${s.currentA} A`],
      [_rt(L, 'col.mgmt'), lbl('pdu.mgmt', s.mgmtMode)],
      [_rt(L, 'pdu.mgmtPorts'), [s.ethernetPorts ? `${s.ethernetPorts}x Eth` : null,
        s.serialPorts ? `${s.serialPorts}x console` : null, s.sensorPorts ? `${s.sensorPorts}x sensor` : null,
        s.usbPorts ? `${s.usbPorts}x USB` : null, s.expansionPorts ? `${s.expansionPorts}x aux` : null,
      ].filter(Boolean).join(' · ') || null],
      ['IP', s.ip], ['MAC', s.mac],
      [_rt(L, 'pdu.assetTag'), s.assetTag], [_rt(L, 'col.lifecycle'), s.warrantyUntil],
      [_rt(L, 'col.backupRef'), s.backupRef], [_rt(L, 'col.method'), s.backupMethod],
    ].filter(p => p[1] != null && p[1] !== '');

    // Alimentazione in ingresso: una riga per presa di corrente del PDU.
    const feedLines = (s.feeds || []).map(f =>
      `${f.name || '-'}${f.type ? ` (${f.type})` : ''} <- ${f.source || '?'}${f.sourcePort ? ` · ${f.sourcePort}` : ''}`);
    // I GRUPPI: due parole per gruppo (commutabile o sempre acceso, batteria o
    // solo filtrata) e quante prese contiene. E' la risposta alla domanda per cui
    // si compra un UPS, e su carta va letta senza aprire nulla.
    const grpLines = (s.groups || []).map(g =>
      `${g.name}  ·  ${lbl('pdu.grp', g.switching)}  ·  ${lbl('pdu.grp', g.backup)}  ·  ${g.outlets} ${_rt(L, 'col.outlets')}`);
    // Prese: solo quelle che alimentano qualcosa portano un testo lungo; le libere
    // restano compatte. Questo è il "collegamenti" che serve per ricablare.
    // La provenienza qualifica il COLLEGAMENTO: senza un apparato da mostrare non
    // c'è nulla da attribuire, e stampare «[Importato]» accanto a una presa vuota
    // farebbe pensare a un carico che il documento non sta dichiarando.
    const outLines = mine.map(o =>
      `${o.label}${o.group ? `  [${o.group}]` : ''}  ${lbl('pdu.st', o.status)}`
      + (o.deviceName
        ? `  ->  ${o.deviceName}${o.portName ? ` · ${o.portName}` : ''}`
          + (o.source ? `  [${_rt(L, `pdu.src.${o.source}`)}]` : '')
        : ''));

    doc.font('Helvetica');
    const pairRows = Math.ceil(pairs.length / 2);
    const noteRows = s.notes ? _wrapFit(doc, s.notes, CW - 12, 6).length : 0;
    const feedRows = feedLines.reduce((a, l) => a + _wrapFit(doc, l, CW - 12, 6).length, 0);
    const grpRows = grpLines.reduce((a, l) => a + _wrapFit(doc, l, CW - 12, 6).length, 0);
    const outRows = outLines.reduce((a, l) => a + _wrapFit(doc, l, CW - 12, 6).length, 0);
    const cardH = 18 + 3 + pairRows * 10 + 4
      + (feedLines.length ? 10 + feedRows * 9 : 0)
      + (grpLines.length ? 10 + grpRows * 9 : 0)
      + (outLines.length ? 10 + outRows * 9 : 0)
      + (noteRows ? 10 + noteRows * 9 : 0) + 8;

    // Una scheda non si spezza mai fra due pagine: chi la consulta davanti al rack
    // deve avere tutto sotto gli occhi, non metà qui e metà voltando foglio. Se non
    // ci sta nello spazio rimasto, comincia dalla pagina nuova; se è più alta di una
    // pagina INTERA (PDU da 48 prese) si accetta il taglio, ma solo in quel caso.
    const pageH = _BOT - _TOP;
    if (y + cardH > _BOT && (y > _TOP || cardH <= pageH)) {
      doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
      _rHdr(doc, T2, projName, date);
      y = _TOP;
    }

    // Fascia titolo: pallino ambra (alimentazione) + nome + posizione a destra.
    doc.rect(M, y, CW, 18).fill('#1e293b');
    doc.circle(M + 9, y + 9, 3.5).fill('#d29922');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff')
       .text(_fit(doc, s.name, CW - 190, 8), M + 18, y + 5, { lineBreak: false });
    const place = [s.rackName, s.rackU == null ? null : `U${s.rackU}`,
      `${s.outletsTotal} ${_rt(L, 'col.outlets')}`].filter(Boolean).join('  ·  ');
    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8')
       .text(place, M + CW - 175, y + 6, { width: 170, align: 'right', lineBreak: false });
    y += 18 + 3;

    // Corpo: coppie etichetta/valore su due colonne.
    const colW = (CW - 12) / 2;
    pairs.forEach((p, i) => {
      const cx = M + 6 + (i % 2) * colW;
      const cy = y + Math.floor(i / 2) * 10;
      doc.font('Helvetica').fontSize(6).fillColor('#64748b')
         .text(_fit(doc, p[0], 78, 6), cx, cy, { lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#0f172a')
         .text(_fit(doc, String(p[1]), colW - 84, 6.5), cx + 80, cy, { lineBreak: false });
    });
    y += pairRows * 10 + 4;

    const block = (titleKey, lines, color) => {
      if (!lines.length) return;
      doc.font('Helvetica-Bold').fontSize(6).fillColor(color).text(_rt(L, titleKey), M + 6, y, { lineBreak: false });
      y += 9;
      lines.forEach(l => {
        _wrapFit(doc, l, CW - 12, 6).forEach(seg => {
          doc.font('Helvetica').fontSize(6).fillColor('#334155').text(seg, M + 10, y, { lineBreak: false });
          y += 9;
        });
      });
      y += 1;
    };
    block('pdu.feedFrom', feedLines, '#b45309');
    // I gruppi PRIMA dell'elenco prese: si legge «chi resta acceso» e poi si va
    // a vedere quali prese ci stanno dentro, non il contrario.
    block('pdu.groups', grpLines, '#7c3aed');
    // Prese una per riga. Una versione a due colonne impaginava la seconda colonna
    // fuori posto (partiva sopra la prima): meglio una lista che si legge bene e
    // qualche riga in più, che una griglia stretta e sbagliata.
    block('pdu.loadList', outLines, '#1a7f37');
    block('col.note', s.notes ? [s.notes] : [], '#64748b');
    y += 6;
  }
}

// Formatta un ISO timestamp (project.updated_at) in data/ora locale IT. Soft-fail
// sul grezzo se non parsabile: mai lanciare da un helper di report.
function _fmtRevised(v, lang) {
  if (!v) return '';
  try { return new Date(v).toLocaleString(_localeTag(lang)); } catch (_) { return String(v); }
}

// Registro asset (inventario dispositivi) — pagina/e tabellari per-device.
// I dati sono i DTO nodeToDevice (lib/api-shape.js): stessa forma della REST API v1,
// costruita da una ALLOWLIST server-side → nessun segreto (community/credenziali)
// puo' finire nel PDF. `lastRevised` = project.updated_at (ultima modifica del
// documento), distinta dalla data di generazione. Requisito documentale NIS2/ISO
// 27001 (A.5.9): register di asset con owner/ubicazione/identita + data revisione.
// Colonna «Dispositivo»: la domanda e' QUALE apparato e', non quale indirizzo
// ha (l'IP ha una colonna sua). Quando l'import dello Scopri non ha trovato un
// hostname, `name` E' l'indirizzo (_discDisplayName) e ripeterlo qui non dice
// nulla: si compone allora tipo + marca, entrambi MISURATI. Il DTO resta
// intatto — e' contratto della REST API v1, qui si cambia solo la stampa.
function _assetDeviceLabel(d, lang) {
  if (!d) return '';
  const dict = (_I18N_DICT && _I18N_DICT[lang === 'en' ? 'en' : 'it']) || null;
  const typeLabel = dict
    ? (dict['type.short.' + d.type] || dict['type.' + d.type] || String(d.type || ''))
    : String(d.type || '');
  return nodeLabelParts(d, { typeName: typeLabel }).primary || d.name || '';
}

function _addAssetRegisterPages(doc, assets, projName, date, lastRevised, lang = 'it') {
  const list = Array.isArray(assets) ? assets : [];
  const L = _rlang(lang);
  const T = _rt(L, 'title.assets');
  doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  _rHdr(doc, T, projName, date);
  const rev = _fmtRevised(lastRevised, lang);
  // La nota scritta a mano viaggia CON il suo apparato (riga a tutta larghezza sotto
  // la riga del device), non in un capitolo a parte: chi legge il registro ha davanti
  // insieme identita', posizione e la raccomandazione dell'operatore.
  const notes = list.map(d => (d && d.notes != null ? String(d.notes).trim() : ''));
  const withNotes = notes.filter(Boolean).length;
  const sub = `${list.length} ${_rt(L, 'sub.assets')}`
    + (withNotes ? `  -  ${withNotes} ${_rt(L, 'assets.withNotes')}` : '')
    + (rev ? `  -  ${_rt(L, 'assets.lastRevised')}: ${rev}` : '');
  const y = _rSub(doc, sub, _TOP);
  if (!list.length) {
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
       .text(_rt(L, 'empty.assets'), _RM, y);
    return;
  }
  const cols = [
    { label: _rt(L, 'col.num'),    w: 18  },
    { label: _rt(L, 'col.device'), w: 84, wrap: true },
    { label: _rt(L, 'col.type'),   w: 46  },
    { label: _rt(L, 'col.brand'),  w: 50  },
    { label: _rt(L, 'col.model'),  w: 66, wrap: true },
    { label: _rt(L, 'col.serial'), w: 66, shrink: true },
    { label: 'IP',                 w: 60  },
    { label: 'MAC',                w: 82, shrink: true },
    { label: 'VLAN',               w: 30  },
    { label: _rt(L, 'col.rack'),   w: 37, wrap: true },
  ]; // 539
  const rows = list.map((d, i) => [
    i + 1,
    _assetDeviceLabel(d, lang) || '-', d.type || '-', d.brand || '-', d.model || '-',
    d.serial || '-', d.ip || '-', d.mac || '-',
    (d.vlan != null ? String(d.vlan) : '-'),
    d.rack ? (String(d.rack.name || d.rack.id || '') + (d.rack.u != null ? ` U${d.rack.u}` : '')) : '-',
  ]);
  _rTable(doc, cols, rows, y, T, projName, date, { notes, noteLabel: _rt(L, 'col.note') });
}

// Ripristinabilità (DR) — pagina/e per-device: DOVE vive il backup di ogni apparato
// GESTITO, come procurarlo/riflasharlo (serial+firmware) e dove va (rack). È il cuore
// di una runbook: con questa pagina, salvata fuori dall'infrastruttura, ricostruisci
// la LAN anche a InfraNet spento. Ripristinabile = backup FRESCO (≤30gg, allineato al
// pannello e alla lente DR) + identità nota (serial o modello) + posizione (rack).
// I dati sono client-built in reportData.recovery (come spare/cavi/VLAN): puntatore
// backup CREDENTIAL-FREE per contratto (ref rifiuta credenziali), MAI il config né la
// community — stesso confine anti-leak del registro asset.
// Le due soglie NON sono più ricopiate qui: arrivano dal motore (lib/overview.js),
// che è dove la lente DR le definisce. Erano due numeri scritti a mano in due file
// per la stessa domanda — cioè due verità in attesa di divergere alla prima
// modifica. Ora cambiarle nella lente cambia anche il dossier.
const _REC_FRESH_MS = OV_THRESHOLDS.BACKUP_FRESH_DAYS * 864e5;
const _REC_SOON_MS = OV_THRESHOLDS.LIFECYCLE_SOON_DAYS * 864e5;
function _addRecoveryPages(doc, recovery, projName, date, lang = 'it', now = Date.now()) {
  const L = _rlang(lang);
  const T = _rt(L, 'title.recovery');
  const list = (recovery && Array.isArray(recovery.devices)) ? recovery.devices : [];
  doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  _rHdr(doc, T, projName, date);

  const _s = (v) => (v == null ? '' : String(v)).trim();
  // Ciclo di vita: le due date DICHIARATE (garanzia / fine vita), riassunte dallo
  // stato piu' grave — le STESSE regole della lente DR (lib/overview.js
  // `_lifecycle`), soglia «in scadenza» inclusa, cosi' il dossier consegnato non
  // dice una cosa diversa dall'app. Nessuna data dichiarata = trattino: chi legge
  // la runbook deve distinguere «coperto» da «non lo so».
  const _fmtD = (iso) => {
    const ms = Date.parse(_s(iso));
    return Number.isFinite(ms)
      ? new Date(ms).toLocaleDateString(_localeTag(L), { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '';
  };
  const _lifecycle = (d) => {
    const w = Date.parse(_s(d.warrantyUntil));
    const e = Date.parse(_s(d.eolDate));
    const hasW = Number.isFinite(w), hasE = Number.isFinite(e);
    if (!hasW && !hasE) return { state: '', txt: '-' };
    const soon = _REC_SOON_MS;
    const cell = (key, iso) => ({ state: key, txt: (_rt(L, 'rec.lc' + key) + ' ' + _fmtD(iso)).trim() });
    if (hasE && now > e) return cell('Eol', d.eolDate);
    if (hasW && now > w) return cell('Expired', d.warrantyUntil);
    if (hasW && w - now <= soon) return cell('Soon', d.warrantyUntil);
    if (hasE && e - now <= soon) return cell('Soon', d.eolDate);
    return cell('Ok', hasW ? d.warrantyUntil : d.eolDate);
  };

  let recoverable = 0, noBackup = 0, noLoc = 0, mismatch = 0, eolN = 0;
  const rows = list.map((d, i) => {
    const at = Date.parse(_s(d.backupAt));
    const hasBackup = !!_s(d.backupRef);
    const fresh = hasBackup && Number.isFinite(at) && (now - at) <= _REC_FRESH_MS;
    // Identità utile al ripristino = identificabile E NON «sostituito»: un seriale
    // dichiarato diverso da quello misurato è un dubbio da sciogliere, non una
    // certezza su cui ricomprare. Stessa regola della lente DR (lib/overview.js
    // `_identity`): senza, il dossier consegnato era più ottimista dell'app.
    const idMismatch = !!d.identityMismatch;
    const ident = !!(_s(d.serial) || _s(d.model)) && !idMismatch;
    const loc = !!_s(d.rack);
    if (fresh && ident && loc) recoverable++;
    if (!hasBackup) noBackup++;
    if (!loc) noLoc++;
    if (idMismatch) mismatch++;
    // Il ciclo di vita e' ADVISORY come nella lente DR: un apparato fuori
    // produzione con backup fresco resta ripristinabile — l'EOL dice che non lo
    // RICOMPRI, non che non lo rimetti su. Entra nella testata, non nel verdetto.
    const lc = _lifecycle(d);
    if (lc.state === 'Eol') eolN++;
    // La DATA del backup (giorno/ora/minuti): il fatto grezzo, più utile del verdetto
    // «fresco/datato». La freschezza (≤30gg) resta solo nel conteggio in testata.
    const dateTxt = Number.isFinite(at)
      ? new Date(at).toLocaleString(_localeTag(L), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '-';
    return [
      i + 1, _s(d.name) || '-',
      // 🔒 Il puntatore è input libero e questa pagina era l'UNICO consumatore di
      // `backup.ref` che lo stampava verbatim (il DTO REST lo strippa da sempre):
      // un dossier si inoltra per email, e una credenziale finita lì non si ritira.
      hasBackup ? stripRefCreds(d.backupRef) : _rt(L, 'rec.none'),
      _s(d.backupMethod) || '-', dateTxt,
      // Il seriale «sostituito?» è marcato in riga: chi ricompra deve sapere che
      // quel numero è in discussione, non fidarsene.
      (_s(d.serial) || '-') + (idMismatch ? ` (${_rt(L, 'rec.mismatch')})` : ''),
      _s(d.firmware) || '-', lc.txt, _s(d.rack) || '-',
    ];
  });

  // Popolazione vuota: «0/0 ripristinabili» suona come un esito, e non lo è —
  // non c'è nulla da ripristinare. La riga sotto lo dice già a parole
  // (`empty.recovery`), quindi qui il verdetto tace invece di stampare un rapporto
  // su un insieme che non esiste.
  const sub = (list.length ? `${recoverable}/${list.length} ${_rt(L, 'rec.recoverable')}` : _rt(L, 'rec.nonePop'))
    + (noBackup ? `  -  ${noBackup} ${_rt(L, 'rec.noBackupN')}` : '')
    + (noLoc ? `  -  ${noLoc} ${_rt(L, 'rec.noLocN')}` : '')
    + (mismatch ? `  -  ${mismatch} ${_rt(L, 'rec.mismatchN')}` : '')
    + (eolN ? `  -  ${eolN} ${_rt(L, 'rec.eolN')}` : '');
  const y = _rSub(doc, sub, _TOP);
  if (!list.length) {
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(_rt(L, 'empty.recovery'), _RM, y);
    return;
  }
  const cols = [
    { label: _rt(L, 'col.num'),        w: 18  },
    { label: _rt(L, 'col.device'),     w: 80, wrap: true },
    { label: _rt(L, 'col.backupRef'),  w: 104, wrap: true },
    { label: _rt(L, 'col.method'),     w: 42  },
    { label: _rt(L, 'col.backupDate'), w: 74, wrap: true },
    // Il seriale tiene la sua larghezza: ci deve stare anche il marcatore
    // «(sostituito?)», che stretto oltre finiva a ellissi proprio dove serve
    // leggerlo — e' l'avvertenza a chi ricompra.
    { label: _rt(L, 'col.serial'),     w: 70, shrink: true },
    { label: 'Firmware',               w: 58, wrap: true },
    { label: _rt(L, 'col.lifecycle'),  w: 55, wrap: true },
    { label: _rt(L, 'col.rack'),       w: 38, wrap: true },
  ]; // 18+80+104+42+74+70+58+55+38 = 539 (larghezza utile della pagina)
  _rTable(doc, cols, rows, y, T, projName, date);
}

// ── WAN INTER-SEDE: la mappa su carta e le schede di ripristino ─────────────
// Il capitolo che risponde alla domanda della notte dell'incidente: «la linea è
// giù — cosa mi serve per rimetterla su?». Due metà. La MAPPA, che dice com'è
// fatta la rete fra le sedi; e le SCHEDE — una per linea WAN, una per
// collegamento — con quello che nessuno ricorda a memoria: chi vende quel
// circuito, che codice ha, su quale scatola si va a mettere le mani, qual è
// l'indirizzo dell'altro capo, quali reti quel tunnel deve tornare a portare.
//
// ⚠️ **Le righe si compongono QUI e non nel client**, come per le PDU e per lo
// stesso genere di motivo: l'organizzazione vive in `data/organization.json` —
// una per INSTALLAZIONE, non per progetto — che è roba del server; e
// `lib/inter-site*.js` nel browser stanno solo dentro il bundle ESM,
// irraggiungibili da `export.js`, che è uno script classico. Il client manda una
// casella spuntata, il server legge, compone e disegna.

/** Quanta LINEA resta scoperta ai lati della pastiglia di un collegamento: è il
 *  filo a dire che due sedi sono legate, non l'etichetta. Stesso numero del
 *  pannello, per la stessa ragione. */
const _WAN_BADGE_MARGIN = 30;
/** Quante linee WAN si elencano dentro un riquadro. Le altre si CONTANO: un
 *  elenco troncato in silenzio direbbe «queste sono tutte». */
const _WAN_MAX_UPLINKS = 3;

/**
 * Le parole dei vocabolari CHIUSI — la natura di un collegamento, il ruolo di
 * una sede, l'origine di un fatto — si leggono dal dizionario dell'app, non si
 * riscrivono in `_RL`. Sono già tradotte una volta, e il dossier consegnato deve
 * chiamare le cose come le chiama lo schermo di chi l'ha generato: due tabelle
 * per le stesse parole divergono al primo ritocco.
 * → [[definizioni-duplicate-motore-renderer]]
 */
function _wanVoc(lang, key, fallback) {
  const d = (_I18N_DICT && _I18N_DICT[_rlang(lang)]) || null;
  const v = d && d[key];
  return (v == null || v === '') ? (fallback == null ? key : String(fallback)) : String(v);
}

/** La larghezza REALE di un testo col font che lo disegnerà. È il righello che
 *  `buildInterSiteLayout` non ha (④ del layout): un modulo puro non sa quanto è
 *  largo «Fibra spenta · 2 reti», chi stampa sì. Ripristina il font del
 *  chiamante, come `_fit`. */
function _wanTextW(doc, s, size, bold) {
  const prev = doc._fontSize;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  const w = doc.widthOfString(_pdfSafe(s));
  doc.font('Helvetica').fontSize(prev);
  return w;
}

/** «1 rete» / «3 reti»: il singolare non è un dettaglio di stile — un'etichetta
 *  che dice «1 reti» fa dubitare del resto di ciò che c'è scritto sopra. */
function _wanNets(n, lang) {
  return n + ' ' + _wanVoc(lang, n === 1 ? 'org.netsOne' : 'org.netsShort');
}

/** Come si CHIAMA un collegamento. Per `other` (ignoranza dichiarata) valgono le
 *  parole di chi l'ha documentato: «FWA punto-punto» dice qualcosa, «Altro» no. */
function _wanKindText(l, lang) {
  if (!l) return '';
  // ㉔ «IPsec su MPLS»: due assi, e la frase che ne esce è quella che un tecnico
  // dice davvero. Quando ce n'è uno solo si stampa quello; quando non c'è
  // niente lo si DICE, perché su una scheda di ripristino un vuoto si legge
  // come un difetto di stampa invece che come un dato che manca.
  const tr = l.transport === 'other' ? (l.transportLabel || _wanVoc(lang, 'org.transport.other', 'Altro'))
    : l.transport ? _wanVoc(lang, 'org.transport.' + l.transport, String(l.transport)) : null;
  const tu = l.tunnel === 'other' ? (l.tunnelLabel || _wanVoc(lang, 'org.tunnel.other', 'Altro'))
    : (l.tunnel && l.tunnel !== 'none') ? _wanVoc(lang, 'org.tunnel.' + l.tunnel, String(l.tunnel)) : null;
  if (tu && tr) return _wanVoc(lang, 'org.natureOver', '{tunnel} / {transport}')
    .replace('{tunnel}', tu).replace('{transport}', tr);
  if (tu || tr) return String(tu || tr);
  if (l.tunnel === 'none') return _wanVoc(lang, 'org.tunnel.none', 'Nessuno');
  return _wanVoc(lang, 'org.natureUnspoken', '—');
}

/** Chi lo afferma, e da quando: « (misurato, 29/08/2026)». Un valore senza la
 *  sua origine, in un dossier, si legge come una certezza — e spesso non lo è. */
function _wanFactSuffix(f, lang) {
  if (!f || !f.origin) return '';
  const parti = [_wanVoc(lang, 'org.origin.' + f.origin, f.origin)];
  const ms = Date.parse(String(f.at || ''));
  if (Number.isFinite(ms)) {
    parti.push(new Date(ms).toLocaleDateString(_localeTag(lang), { day: '2-digit', month: '2-digit', year: 'numeric' }));
  }
  return ' (' + parti.join(', ') + ')';
}

/**
 * La mappa, in SVG vettoriale su fondo bianco, misurata col motore del PDF.
 *
 * Tre passi: si compone cosa c'è scritto in ogni riquadro (nella lingua del
 * dossier), lo si MISURA con pdfkit — che è lo stesso motore che lo disegnerà —
 * e si passa la misura al layout, che allarga i riquadri e le fessure fra le
 * sedi. Le coordinate che ne escono sono le stesse del pannello, perché il
 * modulo è lo stesso.
 *
 * @returns {{svg:string, width:number, height:number, layoutKind:string}|null}
 */
function _wanMapSvg(doc, R, lang) {
  const org = R && R.organization;
  if (!org || !Array.isArray(org.sites) || !org.sites.length) return null;
  const G = INTER_SITE_SVG_GEOM;
  const sites = Array.isArray(R.sites) ? R.sites : [];
  const lines = Array.isArray(R.lines) ? R.lines : [];
  const links = Array.isArray(R.links) ? R.links : [];

  /** @type {Record<string, *[]>} */
  const perSede = Object.create(null);
  for (const u of lines) (perSede[u.siteId] || (perSede[u.siteId] = [])).push(u);

  const nodeLines = {}, nodeTag = {}, edgeLabels = {}, edgeTone = {}, labelW = {};
  const box = Object.create(null);
  let here = null, maxLabel = 0;

  for (const s of sites) {
    if (s.here) here = s.id;
    const righe = [{ text: _pdfSafe(s.name) }];
    const mie = perSede[s.id] || [];
    for (const u of mie.slice(0, _WAN_MAX_UPLINKS)) {
      righe.push({ text: _pdfSafe([u.provider || _wanVoc(lang, 'org.uplinkNoProvider'), u.serviceType].filter(Boolean).join(' · ')) });
      const ips = u.publicIps ? u.publicIps.value : null;
      if (ips && ips.length) righe.push({ text: _pdfSafe(ips.join('   ')), muted: true });
    }
    if (mie.length > _WAN_MAX_UPLINKS) {
      righe.push({ text: _pdfSafe(_wanVoc(lang, 'org.moreUplinks').replace('{n}', String(mie.length - _WAN_MAX_UPLINKS))), muted: true });
    }
    if (!mie.length) righe.push({ text: _pdfSafe(_wanVoc(lang, 'org.noUplinkShort')), muted: true });
    righe.push({ text: _pdfSafe(s.subnets.length ? _wanNets(s.subnets.length, lang) : _wanVoc(lang, 'org.noNets')), muted: true });
    nodeLines[s.id] = righe;
    // ⑤ Il ruolo è un'ETICHETTA di testo, non la stellina del pannello: i font
    // standard del PDF non sostituiscono un glifo che non hanno, lo disegnano
    // sbagliato — e ★ uscirebbe come un simbolo a caso.
    if (s.role === 'hub') nodeTag[s.id] = _pdfSafe(_wanVoc(lang, 'org.role.hub'));
    let w = 0;
    righe.forEach((r, i) => {
      const largo = _wanTextW(doc, r.text, i === 0 ? G.nameSize : G.lineSize, i === 0)
        // La prima riga divide lo spazio con l'etichetta del ruolo, che le sta a
        // destra: senza contarla, «Hub» finirebbe sopra il nome della sede.
        + (i === 0 && nodeTag[s.id] ? _wanTextW(doc, nodeTag[s.id], G.tagSize, false) + 14 : 0);
      if (largo > w) w = largo;
    });
    box[s.id] = { w: w + G.padX * 2, h: G.padY * 2 + G.nameH + (righe.length - 1) * G.lineH };
  }

  for (const l of links) {
    if (!l.drawable) continue;                    // ③ non è disegnabile: lo dirà la scheda
    const portate = l.reach ? (l.reach.value.a.length + l.reach.value.b.length) : 0;
    // ㉗ Anche qui CHI la vende, e nello stesso ordine dello schermo: la mappa
    // sulla carta e quella nel pannello sono LA STESSA mappa, e due composizioni
    // diverse la farebbero divergere alla prima modifica di una delle due.
    const testo = _pdfSafe([l.provider, _wanKindText(l, lang), portate ? _wanNets(portate, lang) : null]
      .filter(Boolean).join(' · '));
    edgeLabels[l.id] = testo;
    edgeTone[l.id] = l.state ? l.state.value : null;
    const w = _wanTextW(doc, testo, G.labelSize, false);
    labelW[l.id] = w;
    if (w > maxLabel) maxLabel = w;
  }

  const layout = buildInterSiteLayout(org, {
    boxOf: (id) => box[id] || null,
    labelOf: (id) => (labelW[id] ? { w: labelW[id] + G.badgePadX * 2, h: G.badgeH } : null),
    labelW: maxLabel ? maxLabel + G.badgePadX * 2 + _WAN_BADGE_MARGIN * 2 : 0,
    labelH: maxLabel ? G.badgeH + _WAN_BADGE_MARGIN * 2 : 0,
  });
  const svg = buildInterSiteMapSvg(layout, { nodeLines, nodeTag, edgeLabels, edgeTone, labelW, here });
  return svg ? { svg, width: layout.width, height: layout.height, layoutKind: layout.layout } : null;
}

/**
 * Il capitolo WAN. `wan` è l'uscita di `buildInterSiteWanReport` (lib pura), e
 * porta con sé l'organizzazione da cui nasce la mappa.
 */
function _addWanPages(doc, wan, projName, date, lang = 'it', SVGtoPDF = null) {
  const L = _rlang(lang);
  const R = (wan && typeof wan === 'object') ? wan : {};
  const sites = Array.isArray(R.sites) ? R.sites : [];
  const lines = Array.isArray(R.lines) ? R.lines : [];
  const links = Array.isArray(R.links) ? R.links : [];
  const tot = R.totals || {};
  const M = _RM, CW = _RW;
  const DASH = '-';
  const T = _rt(L, 'title.wan');
  const A4 = () => ({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });

  // Capitolo chiesto su un'installazione che non ha aperto il capitolo
  // multi-sede: si stampa lo stato vuoto, non si sparisce. Sparire si legge come
  // un errore dell'export — stessa convenzione di PDU, VM e VLAN.
  if (!sites.length) {
    doc.addPage(A4());
    _rHdr(doc, T, projName, date);
    const y0 = _rSub(doc, _rt(L, 'sub.wanNone'), _TOP);
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(_rt(L, 'empty.wan'), M, y0);
    return;
  }

  // ③ La testata dice l'insieme E i buchi. Una linea senza codice circuito e un
  // collegamento senza reti dichiarate sono esattamente ciò che, la notte
  // dell'incidente, fa perdere l'ora: si contano, come la ripristinabilità conta
  // gli apparati senza backup. Un dossier che tace le proprie lacune è più
  // pericoloso di uno che le stampa.
  const testata = `${tot.sites || 0} ${_rt(L, 'sub.wanSites')}  -  ${tot.lines || 0} ${_rt(L, 'sub.wanLines')}`
    + `  -  ${tot.links || 0} ${_rt(L, 'sub.wanLinks')}`
    + (tot.linesNoCircuitId ? `  -  ${tot.linesNoCircuitId} ${_rt(L, 'wan.noCircuitIdN')}` : '')
    + (tot.linesNoProvider ? `  -  ${tot.linesNoProvider} ${_rt(L, 'wan.noProviderN')}` : '')
    + (tot.linesStaticNoNextHop ? `  -  ${tot.linesStaticNoNextHop} ${_rt(L, 'wan.noNextHopN')}` : '')
    + (tot.linksNoReach ? `  -  ${tot.linksNoReach} ${_rt(L, 'wan.noReachN')}` : '')
    + (tot.sitesNoLine ? `  -  ${tot.sitesNoLine} ${_rt(L, tot.sitesNoLine === 1 ? 'wan.noLineOne' : 'wan.noLineN')}` : '');

  // ── La mappa ──────────────────────────────────────────────────────────
  const mappa = (typeof SVGtoPDF === 'function') ? _wanMapSvg(doc, R, L) : null;
  if (mappa && mappa.svg) {
    const sW = mappa.width || 800, sH = mappa.height || 600;
    const ratio = Math.min(CW / sW, 660 / sH, 1);
    const rW = Math.round(sW * ratio), rH = Math.round(sH * ratio);
    // La pagina si taglia sulla MAPPA, come quella della topologia: una mappa
    // larga e bassa su un A4 in piedi lascerebbe mezzo foglio bianco.
    doc.addPage({ size: [595, Math.max(320, rH + 96)], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    _rHdr(doc, T, projName, date);
    const yMap = _rSub(doc, testata, _TOP);
    try {
      SVGtoPDF(doc, mappa.svg, M, yMap, {
        width: rW, height: rH, assumePt: true,
        preserveAspectRatio: 'xMidYMid meet',
        fontCallback: (_family, bold) => (bold ? 'Helvetica-Bold' : 'Helvetica'),
        warningCallback: () => {},
      });
    } catch (e) { console.error(`  [PDF] wan-map: ${e.message}`); }
    // La legenda nomina SOLO i segni che sono davvero sulla pagina: spiegare un
    // tratteggio che non c'è manda a cercare qualcosa di inesistente.
    const note = [];
    if (mappa.layoutKind === 'hub' || mappa.layoutKind === 'ring') {
      note.push(_wanVoc(L, mappa.layoutKind === 'hub' ? 'org.layoutHub' : 'org.layoutRing'));
    }
    if (links.some(l => l.state && l.state.value === 'down')) note.push(_rt(L, 'wan.legendDown'));
    if (sites.some(s => s.here)) note.push(_rt(L, 'wan.legendHere'));
    if (note.length) {
      doc.font('Helvetica').fontSize(6.5).fillColor('#64748b')
         .text(_pdfSafe(note.join('   ·   ')), M, yMap + rH + 10, { width: CW });
    }
  } else {
    doc.addPage(A4());
    _rHdr(doc, T, projName, date);
    const y0 = _rSub(doc, testata, _TOP);
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(_rt(L, 'empty.wanMap'), M, y0);
  }

  // ── Le sedi ───────────────────────────────────────────────────────────
  // Una tabella e non delle schede: di una sede servono quattro cose, e stanno
  // in riga. Le reti per esteso, non contate: ricostruire una WAN senza sapere
  // quali prefissi vivono dove non si può.
  const T1 = _rt(L, 'title.wanSites');
  doc.addPage(A4());
  _rHdr(doc, T1, projName, date);
  const y1 = _rSub(doc, `${sites.length} ${_rt(L, 'sub.wanSites')}`, _TOP);
  _rTable(doc, [
    { label: _rt(L, 'col.num'), w: 18 },
    { label: _rt(L, 'col.site'), w: 104, wrap: true },
    { label: _rt(L, 'col.role'), w: 52 },
    { label: _rt(L, 'col.address'), w: 118, wrap: true },
    { label: _rt(L, 'col.lines'), w: 30 },
    { label: _rt(L, 'col.nets'), w: 217, wrap: true },
  ], sites.map((s, i) => [
    i + 1,
    _pdfSafe(s.name + (s.here ? `  (${_rt(L, 'wan.here')})` : '')),
    _wanVoc(L, 'org.role.' + s.role, s.role),
    _pdfSafe(s.address || DASH),
    s.uplinks,
    _pdfSafe(s.subnets.length ? s.subnets.join(', ') : DASH),
  ]), y1, T1, projName, date);

  // ── Le schede ─────────────────────────────────────────────────────────
  // Stesso linguaggio visivo delle schede PDU (fascia scura + corpo a due
  // colonne + blocchi in coda): chi apre il dossier riconosce la forma.
  let cy = _TOP, sezione = T;
  const nuova = (titolo) => {
    doc.addPage(A4());
    _rHdr(doc, titolo, projName, date);
    return _TOP;
  };
  const scheda = (titolo, destra, dot, pairs, blocchi) => {
    doc.font('Helvetica');
    const pairRows = Math.ceil(pairs.length / 2);
    const bl = (blocchi || []).filter(b => b && b.lines && b.lines.length);
    const blH = bl.reduce((a, b) => a + 10 + b.lines.reduce((s, l) => s + _wrapFit(doc, l, CW - 12, 6).length, 0) * 9, 0);
    const cardH = 18 + 3 + pairRows * 10 + 4 + blH + 8;
    // Una scheda non si spezza mai fra due pagine: chi la consulta col telefono
    // in mano deve avere tutto sotto gli occhi. Solo se è più alta di una pagina
    // intera si accetta il taglio.
    const pageH = _BOT - _TOP;
    if (cy + cardH > _BOT && (cy > _TOP || cardH <= pageH)) cy = nuova(sezione);
    doc.rect(M, cy, CW, 18).fill('#1e293b');
    doc.circle(M + 9, cy + 9, 3.5).fill(dot);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff')
       .text(_fit(doc, _pdfSafe(titolo), CW - 200, 8), M + 18, cy + 5, { lineBreak: false });
    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8')
       .text(_pdfSafe(destra), M + CW - 185, cy + 6, { width: 180, align: 'right', lineBreak: false });
    cy += 21;
    const colW = (CW - 12) / 2;
    pairs.forEach((p, i) => {
      const x = M + 6 + (i % 2) * colW;
      const yy = cy + Math.floor(i / 2) * 10;
      doc.font('Helvetica').fontSize(6).fillColor('#64748b')
         .text(_fit(doc, _pdfSafe(p[0]), 86, 6), x, yy, { lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#0f172a')
         .text(_fit(doc, _pdfSafe(p[1]), colW - 92, 6.5), x + 88, yy, { lineBreak: false });
    });
    cy += pairRows * 10 + 4;
    bl.forEach(b => {
      doc.font('Helvetica-Bold').fontSize(6).fillColor(b.color || '#64748b')
         .text(_rt(L, b.titleKey), M + 6, cy, { lineBreak: false });
      cy += 9;
      b.lines.forEach(l => _wrapFit(doc, l, CW - 12, 6).forEach(seg => {
        doc.font('Helvetica').fontSize(6).fillColor('#334155').text(seg, M + 10, cy, { lineBreak: false });
        cy += 9;
      }));
      cy += 1;
    });
    cy += 6;
  };

  // Le LINEE WAN.
  sezione = _rt(L, 'title.wanLines');
  cy = nuova(sezione);
  cy = _rSub(doc, `${lines.length} ${_rt(L, 'sub.wanLines')}`, cy);
  if (!lines.length) {
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(_rt(L, 'empty.wanLines'), M, cy);
  }
  for (const u of lines) {
    // ⚠️ I campi con cui si telefona all'operatore restano in scheda ANCHE
    // vuoti, col trattino: a differenza della scheda PDU — dove un campo assente
    // sparisce — qui l'assenza È la scoperta. Una linea senza codice circuito si
    // deve vedere adesso, non la notte in cui serve dettarlo.
    const pairs = [
      [_rt(L, 'col.site'), u.siteName || DASH],
      [_rt(L, 'wan.provider'), u.provider || DASH],
      [_rt(L, 'wan.service'), u.serviceType || DASH],
      [_rt(L, 'wan.circuitId'), u.circuitId || DASH],
      // ⚠️ La banda CONTRATTUALE, non la velocità della porta: è la trappola nota
      // di questo dominio, e un dossier che le confonde fa comprare la linea
      // sbagliata.
      [_rt(L, 'wan.cir'), u.cirMbps == null ? DASH : `${u.cirMbps} Mbps`],
      [_rt(L, 'wan.wanIf'), u.wanIf ? (u.wanIf.value + _wanFactSuffix(u.wanIf, L)) : DASH],
      // ㉑ Come si rimette su. Restano col trattino anche vuoti: su questa
      // scheda l'assenza È la scoperta, e una riga mancante si deve vedere
      // adesso e non la notte in cui serve digitarla.
      [_rt(L, 'wan.addressing'), u.addressing ? _rt(L, 'wan.addr.' + u.addressing) : DASH],
    ];
    // ⚠️ Il gateway si stampa dove VUOL DIRE qualcosa. Su DHCP e PPPoE lo dà la
    // linea: una riga «Gateway —» direbbe che manca un dato che non esiste, e
    // un trattino che accusa il documento giusto insegna a non leggere i
    // trattini. Finché l'indirizzamento non è dichiarato la riga c'è, perché
    // allora il buco è vero.
    // ⚠️ Ma un valore DICHIARATO si stampa sempre, qualunque sia il modo: chi
    // scrive statico + gateway e poi passa a DHCP lascia scritto un indirizzo,
    // e nasconderlo sarebbe un dato che esiste e non si vede — la famiglia di
    // difetti di questo codice. La condizione toglie il TRATTINO, mai un dato.
    if (u.nextHop || (u.addressing !== 'dhcp' && u.addressing !== 'pppoe')) {
      pairs.push([_rt(L, 'wan.nextHop'), u.nextHop || DASH]);
    }
    pairs.push([_rt(L, 'wan.deliveryVlan'), u.deliveryVlan == null ? DASH : String(u.deliveryVlan)]);
    pairs.push([_rt(L, 'wan.mtu'), u.mtu == null ? DASH : String(u.mtu)]);
    pairs.push([_rt(L, 'wan.support'), u.supportRef ? _pdfSafe(u.supportRef) : DASH]);
    if (!u.publicIps) pairs.push([_rt(L, 'wan.publicIpsShort'), DASH]);
    scheda(
      [u.provider, u.serviceType].filter(Boolean).join(' · ') || _wanVoc(L, 'org.uplinkNoProvider'),
      (u.siteName || DASH) + (u.here ? `   ·   ${_rt(L, 'wan.here')}` : ''),
      '#2563eb', pairs,
      // ⑦ Gli indirizzi pubblici sono una LISTA perché uno solo è falso: un
      // blocco instradato, l'IPv6 sulla stessa linea, il VIP di una coppia in HA.
      [{ titleKey: 'wan.publicIps', color: '#1d4ed8',
        lines: u.publicIps ? [_pdfSafe(u.publicIps.value.join('    ') + _wanFactSuffix(u.publicIps, L))] : [] }]
    );
  }

  // I COLLEGAMENTI fra sedi.
  sezione = _rt(L, 'title.wanLinks');
  cy = nuova(sezione);
  cy = _rSub(doc, `${links.length} ${_rt(L, 'sub.wanLinks')}`, cy);
  if (!links.length) {
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(_rt(L, 'empty.wanLinks'), M, cy);
  }
  for (const l of links) {
    const nat = _wanKindText(l, L);
    const pairs = [
      [_rt(L, 'wan.kind'), nat],
      [_rt(L, 'wan.state'), l.state
        ? (_wanVoc(L, l.state.value === 'up' ? 'org.stateUp' : 'org.stateDown') + _wanFactSuffix(l.state, L))
        : DASH],
      [_rt(L, 'wan.provider'), l.provider || DASH],
      [_rt(L, 'wan.circuitId'), l.circuitId || DASH],
    ];
    // I campi propri di una natura si nominano solo dove esistono: chiedere la
    // versione IKE a una fibra spenta sarebbe chiedere un dato che non c'è.
    if (l.name) pairs.push([_rt(L, 'wan.name'), l.name]);
    if (l.vrf) pairs.push([_rt(L, 'wan.vrf'), l.vrf]);
    if (l.service) pairs.push([_rt(L, 'wan.service'), l.service]);
    if (l.overlay) pairs.push([_rt(L, 'wan.overlay'), l.overlay]);
    if (l.media) pairs.push([_rt(L, 'wan.media'), l.media]);
    if (l.ikeVersion) pairs.push([_rt(L, 'wan.ike'), 'IKEv' + l.ikeVersion]);
    if (l.phase1Name) pairs.push([_rt(L, 'wan.phase1'), l.phase1Name]);
    // ㉓ Le due proposte, che sono ciò che si ridigita alle tre di notte, e il
    // PUNTATORE alla chiave — mai la chiave: questo foglio si stampa.
    if (l.phase1Proposal) pairs.push([_rt(L, 'wan.prop1'), _pdfSafe(l.phase1Proposal)]);
    if (l.phase2Proposal) pairs.push([_rt(L, 'wan.prop2'), _pdfSafe(l.phase2Proposal)]);
    if (l.pskRef) pairs.push([_rt(L, 'wan.pskRef'), _pdfSafe(l.pskRef)]);
    // ③ Un collegamento che punta a una sede inesistente non si può disegnare, e
    // lo dice: sparire dalla mappa E dalle schede lo cancellerebbe due volte.
    if (!l.drawable) pairs.push([_rt(L, 'wan.missingSite'), l.missingSites.join(', ')]);

    // ⚠️ `peerIp` è l'indirizzo dell'ALTRO capo visto da questa sede, non
    // l'indirizzo di questa sede: i due si incrociano, ed è la trappola del
    // dominio. Le parole lo dicono per esteso.
    const capo = (e) => `${e.siteName || e.siteId}  ->  ${e.device || _rt(L, 'wan.dev.' + e.deviceState)}`
      + (e.device && e.deviceState !== 'linked' ? `  (${_rt(L, 'wan.dev.' + e.deviceState)})` : '')
      + `  ·  ${_rt(L, 'wan.peerSeen')}: ${e.peerIp || DASH}`;
    const reachLines = [];
    if (l.reach) {
      reachLines.push(_pdfSafe(`${_rt(L, 'wan.at')} ${l.a.siteName || l.a.siteId}: `
        + (l.reach.value.a.length ? l.reach.value.a.join(', ') : DASH)));
      reachLines.push(_pdfSafe(`${_rt(L, 'wan.at')} ${l.b.siteName || l.b.siteId}: `
        + (l.reach.value.b.length ? l.reach.value.b.join(', ') : DASH)));
      const chi = _wanFactSuffix(l.reach, L).trim();
      if (chi) reachLines.push(_pdfSafe(chi));
    }
    scheda(
      l.name || nat,
      `${l.a.siteName || l.a.siteId} ↔ ${l.b.siteName || l.b.siteId}`,
      l.state ? (l.state.value === 'up' ? '#16a34a' : '#dc2626') : '#94a3b8',
      pairs,
      [
        { titleKey: 'wan.ends', color: '#0f766e', lines: [_pdfSafe(capo(l.a)), _pdfSafe(capo(l.b))] },
        // ② Su un IPsec queste reti SONO l'encryption domain: senza, il tunnel
        // si rialza e non ci passa niente.
        { titleKey: 'wan.reach', color: '#7c3aed', lines: reachLines },
        { titleKey: 'wan.underlay', color: '#b45309', lines: (l.underlay || []).map(u => _pdfSafe(
          u.found ? ([u.provider, u.circuitId].filter(Boolean).join(' · ') || u.uplinkId)
            : `${u.uplinkId} (${_rt(L, 'wan.notFound')})`)) },
      ]
    );
  }

  // ── ㉖ COSA NON TORNA ───────────────────────────────────────────────────
  //
  // In coda, e non in testa: prima si legge cosa c'è, poi cosa non torna. Fino a
  // ieri questa sezione non esisteva, e il capitolo stampava i campi tacendo sui
  // rilievi — cioè una linea dichiarata alla sede sbagliata si leggeva
  // esattamente come una giusta, perché sulla carta la sede non c'è. È il posto
  // peggiore in cui lasciare una cosa falsa: chi apre questo capitolo lo apre
  // quando non ha tempo di verificarlo.
  //
  // ⚠️ Le PAROLE dei controlli non si riscrivono qui: si leggono da `lib/i18n.js`
  // (`org.a.*`, `org.why.*`), lo stesso dizionario del pannello. Quaranta frasi
  // ricopiate divergono alla prima riformulata, e a schermo la differenza si
  // vede mentre sulla carta no.
  // ⚠️ E la sezione si stampa ANCHE quando non c'è niente: «nessun rilievo» è
  // un'informazione, una sezione che sparisce si legge come una dimenticanza.
  const dizAudit = (_I18N_DICT && _I18N_DICT[L]) || null;
  const parolaDi = (k, fallback) => (dizAudit && dizAudit[k]) || fallback;
  const RIL = (R.audit && typeof R.audit === 'object') ? R.audit : { counts: {}, findings: [], notChecked: [] };
  const rilievi = Array.isArray(RIL.findings) ? RIL.findings : [];
  const nonVisti = Array.isArray(RIL.notChecked) ? RIL.notChecked : [];
  const cnt = RIL.counts || {};
  sezione = _rt(L, 'title.wanAudit');
  cy = nuova(sezione);
  cy = _rSub(doc, `${cnt.problems || 0} ${_rt(L, 'wan.aProblems')}`
    + `  -  ${cnt.gaps || 0} ${_rt(L, 'wan.aGaps')}`
    + `  -  ${cnt.notChecked || 0} ${_rt(L, 'wan.aNotChecked')}`, cy);
  if (!rilievi.length && !nonVisti.length) {
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(_rt(L, 'wan.aClean'), M, cy);
  }
  // Un blocco per CONTROLLO, e non una `scheda`: il titolo di una scheda si
  // taglia a 339 punti, e qui il titolo È il rilievo — «Collegamenti che non
  // dichiarano quale linea WAN li trasmette…» tagliato a metà smette di dire la
  // cosa per cui esiste. Le frasi si mandano a capo su tutta la larghezza, e
  // sotto stanno i soggetti: la frase detta una volta, le righe portano solo
  // ciò che cambia — la stessa cura presa a schermo.
  const spazio = (h) => { if (cy + h > _BOT) cy = nuova(sezione); };
  const perControllo = [];
  for (const f of rilievi) {
    let g = perControllo.find(x => x.check === f.check);
    if (!g) { g = { check: f.check, group: f.group, righe: [] }; perControllo.push(g); }
    g.righe.push(f);
  }
  for (const g of perControllo) {
    const frase = _wrapFit(doc, _pdfSafe(parolaDi('org.a.' + g.check, g.check)), CW - 30, 7);
    spazio(frase.length * 10 + 14);
    doc.circle(M + 5, cy + 3.5, 3).fill(g.group === 'problem' ? '#dc2626' : '#d97706');
    for (const seg of frase) {
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#0f172a').text(seg, M + 14, cy, { lineBreak: false });
      cy += 10;
    }
    for (const r of g.righe) {
      spazio(9);
      doc.font('Helvetica').fontSize(6.5).fillColor('#334155')
        .text(_fit(doc, _pdfSafe(r.subject || DASH), 250, 6.5), M + 18, cy, { lineBreak: false });
      if (r.note) {
        doc.font('Helvetica').fontSize(6.5).fillColor('#64748b')
          .text(_fit(doc, _pdfSafe(r.note), CW - 290, 6.5), M + 280, cy, { lineBreak: false });
      }
      cy += 9;
    }
    cy += 6;
  }
  if (nonVisti.length) {
    // ① «Non ho potuto guardare» è la terza cosa, e sulla carta serve più che a
    // schermo: un capitolo che tace ciò che non ha esaminato si legge come un
    // capitolo che non ha trovato niente.
    spazio(16);
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#64748b')
      .text(_pdfSafe(_rt(L, 'wan.aNotCheckedTitle')), M, cy, { lineBreak: false });
    cy += 11;
    for (const c of nonVisti) {
      const frase = `${parolaDi('org.a.' + c.check, c.check)}: ${parolaDi('org.why.' + c.reason, c.reason)}`;
      for (const seg of _wrapFit(doc, _pdfSafe(frase), CW - 18, 6.5)) {
        spazio(9);
        doc.font('Helvetica').fontSize(6.5).fillColor('#64748b').text(seg, M + 14, cy, { lineBreak: false });
        cy += 9;
      }
    }
  }
}

// ── PANORAMICA: la sintesi in testa al dossier ───────────────────────────────
// Le tre domande e i loro verdetti, gli stessi che l'utente vede a schermo. Il
// contenuto arriva GIA' IN PAROLE dal client (reportData.overview): la lib pura
// resta l'unica fonte dei numeri, il glue l'unica delle parole, e qui si disegna
// soltanto — nessuna terza copia della logica. Zero `items`: e' una sintesi da
// una pagina, non l'elenco dei device (quello e' il registro asset).
// In coda il PERIMETRO dichiarato: in un dossier di consegna e' la riga che
// protegge chi consegna — nero su bianco, cosa NON e' stato valutato.
const _OV_DOT = { ok: '#16a34a', warn: '#d97706', bad: '#dc2626', none: '#94a3b8', info: '#64748b' };
const _OV_PROV = { declared: '#2563eb', measured: '#16a34a', derived: '#a371f7', none: '#94a3b8' };

// I font STANDARD del PDF (Helvetica & co.) codificano WinAnsi/CP1252: quello che
// sta fuori non viene sostituito, viene disegnato SBAGLIATO. Il segno meno
// tipografico «−» (U+2212) usato a schermo usciva come una virgoletta, le frecce
// come due simboli a caso. Qui si normalizza cio' che l'interfaccia usa davvero,
// e cio' che resta fuori da CP1252 diventa '?': un carattere onesto batte un
// glifo inventato. (Accenti, «», –, —, …, • sono in CP1252: passano intatti.)
const _CP1252_HI = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const _PDF_SUBST = { '−': '-', '→': '->', '←': '<-', '↔': '<->', '⇄': '<->', '⇒': '=>', '‑': '-', '✓': 'ok', '✗': 'x' };
function _pdfSafe(v) {
  let out = '';
  for (const ch of String(v == null ? '' : v)) {
    if (Object.prototype.hasOwnProperty.call(_PDF_SUBST, ch)) { out += _PDF_SUBST[ch]; continue; }
    const c = ch.codePointAt(0);
    out += (c <= 0xff || _CP1252_HI.has(ch)) ? ch : '?';
  }
  return out;
}

function _addOverviewPages(doc, overview, projName, date, lang = 'it') {
  const L = _rlang(lang);
  const T = _rt(L, 'title.overview');
  const secs = (overview && Array.isArray(overview.sections)) ? overview.sections : [];
  doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  _rHdr(doc, T, projName, date);
  // Ogni stringa che arriva dal client passa dal normalizzatore: la Panoramica e'
  // l'unica pagina che porta nel PDF le PAROLE dell'interfaccia, dove i segni
  // tipografici sono la norma.
  const _s = (v) => _pdfSafe(v == null ? '' : String(v)).trim();

  let y = _rSub(doc, _rt(L, 'sub.overview'), _TOP);
  if (!secs.length) {
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(_rt(L, 'empty.overview'), _RM, y);
    return;
  }

  const GAP = 11;
  const CW = Math.floor((_RW - GAP * (secs.length - 1)) / secs.length);
  const yTop = y + 2;
  let yMax = yTop;

  secs.forEach((sec, si) => {
    const x = _RM + si * (CW + GAP);
    let cy = yTop;
    // Intestazione: numero + titolo, poi la domanda a cui risponde.
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e3a5f')
       .text(_fit(doc, `${_s(sec.num)}  ${_s(sec.title)}`, CW, 9), x, cy, { lineBreak: false });
    cy += 12;
    doc.font('Helvetica').fontSize(6.8).fillColor('#94a3b8');
    for (const line of _wrapFit(doc, _s(sec.question), CW, 6.8)) { doc.text(line, x, cy, { lineBreak: false }); cy += 8; }
    cy += 2;
    // Verdetto di colonna: pallino colorato + frase. Il colore e' RIDONDANTE
    // rispetto alla parola, mai l'unico portatore del significato.
    doc.circle(x + 3, cy + 3.4, 3).fill(_OV_DOT[_s(sec.level)] || _OV_DOT.none);
    doc.font('Helvetica-Bold').fontSize(7.2).fillColor('#334155');
    const vLines = _wrapFit(doc, _s(sec.verdict), CW - 10, 7.2);
    vLines.forEach((line, i) => { doc.text(line, x + 10, cy + i * 9, { lineBreak: false }); });
    cy += Math.max(11, vLines.length * 9 + 3);
    doc.moveTo(x, cy).lineTo(x + CW, cy).strokeColor('#e2e8f0').lineWidth(0.4).stroke();
    cy += 6;

    for (const r of (Array.isArray(sec.rows) ? sec.rows : [])) {
      if (cy > _BOT - 26) break;                       // la sintesi resta UNA pagina
      // Pallino di provenienza: da dove viene il numero (paletto ② reso grafica).
      doc.circle(x + 2.5, cy + 2.6, 2.5).fill(_OV_PROV[_s(r.prov)] || _OV_PROV.none);
      doc.font('Helvetica').fontSize(6.6).fillColor('#64748b')
         .text(_fit(doc, _s(r.label), CW - 9, 6.6), x + 9, cy, { lineBreak: false });
      cy += 9;
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1e293b');
      const vw = doc.widthOfString(_s(r.value));
      doc.text(_fit(doc, _s(r.value), CW, 9.5), x + 9, cy, { lineBreak: false });
      if (_s(r.sub)) {
        doc.font('Helvetica').fontSize(6.6).fillColor('#94a3b8')
           .text(_fit(doc, _s(r.sub), CW - vw - 12, 6.6), x + 9 + vw + 3, cy + 3, { lineBreak: false });
      }
      cy += 11;
      if (_s(r.status)) {
        doc.font('Helvetica').fontSize(6.4).fillColor(_OV_DOT[_s(r.tone)] || _OV_DOT.info);
        for (const line of _wrapFit(doc, _s(r.status), CW - 9, 6.4)) { doc.text(line, x + 9, cy, { lineBreak: false }); cy += 7.6; }
      }
      cy += 5;
    }
    if (cy > yMax) yMax = cy;
  });

  y = yMax + 10;
  // Legenda della provenienza: senza, i pallini sono decorazione.
  const legend = (overview && Array.isArray(overview.legend)) ? overview.legend : [];
  if (legend.length && y < _BOT - 40) {
    let lx = _RM;
    doc.font('Helvetica').fontSize(6.4);
    for (const lg of legend) {
      doc.circle(lx + 2.5, y + 2.6, 2.5).fill(_OV_PROV[_s(lg.prov)] || _OV_PROV.none);
      doc.fillColor('#94a3b8').text(_s(lg.label), lx + 8, y, { lineBreak: false });
      lx += 8 + doc.widthOfString(_s(lg.label)) + 14;
    }
    y += 14;
  }

  const per = (overview && overview.perimeter) ? overview.perimeter : null;
  if (per && y < _BOT - 30) {
    doc.moveTo(_RM, y).lineTo(_RM + _RW, y).strokeColor('#e2e8f0').lineWidth(0.4).dash(2, { space: 2 }).stroke().undash();
    y += 6;
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor('#475569').text(_s(per.title), _RM, y, { lineBreak: false });
    y += 9;
    doc.font('Helvetica').fontSize(6.4).fillColor('#94a3b8');
    for (const line of _wrapFit(doc, _s(per.lead), _RW, 6.4)) { doc.text(line, _RM, y, { lineBreak: false }); y += 8; }
    const chips = Array.isArray(per.chips) ? per.chips.map(_s).filter(Boolean) : [];
    if (chips.length) {
      doc.font('Helvetica').fontSize(6.4).fillColor('#64748b');
      for (const line of _wrapFit(doc, chips.join('  ·  '), _RW, 6.4)) { doc.text(line, _RM, y, { lineBreak: false }); y += 8; }
    }
  }
}

module.exports = { _loadPdfDeps, _addReportPages, _addCoverPage, _addChangelogPages, _addSparePages, _addPduPages, _addAssetRegisterPages, _addRecoveryPages, _addWanPages, _wanMapSvg, _addOverviewPages, _assetDeviceLabel, _fmtRevised, _rt, _fit, _wrapFit };
