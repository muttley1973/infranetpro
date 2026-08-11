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
    'title.topology': 'Topologia LLDP/CDP', 'title.assets': 'Registro asset', 'title.notes': 'Note',
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
        'pdu.fw': 'Firmware', 'pdu.position': 'Posizione', 'pdu.orientation': 'Montaggio',
    'pdu.rated': 'Corrente nom.', 'pdu.mgmtPorts': 'Porte gestione', 'pdu.assetTag': 'Asset tag',
    'pdu.orient.vertical-0u': 'Verticale 0U', 'pdu.orient.horizontal-1u': 'Orizzontale 1U',
    'pdu.feedFrom': 'ALIMENTATA DA', 'pdu.loadList': 'PRESE E CARICHI',
    'sub.cables': 'cavi documentati nel progetto', 'sub.routes': 'percorsi tracciati',
    'sub.vlans': 'VLAN configurate', 'sub.assets': 'dispositivi documentati',
    'sub.portsA': 'porte su', 'sub.portsB': 'dispositivi',
    'assets.lastRevised': 'Ultima revisione documento',
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
    'cover.title': 'Dossier di consegna', 'cover.project': 'Progetto', 'cover.date': 'Data',
    'cover.lastRevised': 'Ultima revisione', 'cover.user': 'Generato da',
    'cover.devices': 'Dispositivi', 'cover.cables': 'Cavi', 'cover.vlans': 'VLAN',
    'cover.vms': 'Macchine virtuali',
    'cover.footer': 'Generato con InfraNet Pro', 'audit.system': 'sistema',
  },
  en: {
    'title.inventory': 'Cable inventory', 'title.asbuilt': 'Cabling route (As-Built)',
    'title.racks': 'Rack view', 'title.ports': 'Port assignment', 'title.vlans': 'VLAN summary',
    'title.topology': 'LLDP/CDP topology', 'title.assets': 'Asset register', 'title.notes': 'Notes',
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
        'pdu.fw': 'Firmware', 'pdu.position': 'Position', 'pdu.orientation': 'Mounting',
    'pdu.rated': 'Rated current', 'pdu.mgmtPorts': 'Management ports', 'pdu.assetTag': 'Asset tag',
    'pdu.orient.vertical-0u': 'Vertical 0U', 'pdu.orient.horizontal-1u': 'Horizontal 1U',
    'pdu.feedFrom': 'FED FROM', 'pdu.loadList': 'OUTLETS AND LOADS',
    'sub.cables': 'cables documented in the project', 'sub.routes': 'traced routes',
    'sub.vlans': 'VLANs configured', 'sub.assets': 'devices documented',
    'sub.portsA': 'ports across', 'sub.portsB': 'devices',
    'assets.lastRevised': 'Document last revised',
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

function _rTable(doc, cols, rows, y0, title, projName, date) {
  const M = _RM, HH = 16, RH = 13, FS = 7;
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
    const rowH = Math.max(RH, 4 + rowLines * 9);

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
      c.vlan ? `${c.vlan}${c.vlanName ? ' - ' + c.vlanName : ''}` : '-',
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
    const SC = { active: '#16a34a', fault: '#dc2626', idle: '#d97706', inactive: '#6b7280' };
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

// Pagine Note: tabella Dispositivo | Nota (testo a capo).
function _addNotesPages(doc, notes, projName, date, lang = 'it') {
  if (!Array.isArray(notes) || !notes.length) return;
  const L = _rlang(lang);
  const T = _rt(L, 'title.notes');
  doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  _rHdr(doc, T, projName, date);
  const cols = [
    { label: _rt(L, 'col.device'), w: 150 },
    { label: _rt(L, 'col.note'), w: _RW - 150, wrap: true },
  ];
  _rTable(doc, cols, notes.map(n => [n.label, n.text]), _TOP, T, projName, date);
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
      [_rt(L, 'pdu.orientation'), s.orientation ? lbl('pdu.orient', s.orientation) : null],
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
    // Prese: solo quelle che alimentano qualcosa portano un testo lungo; le libere
    // restano compatte. Questo è il "collegamenti" che serve per ricablare.
    // La provenienza qualifica il COLLEGAMENTO: senza un apparato da mostrare non
    // c'è nulla da attribuire, e stampare «[Importato]» accanto a una presa vuota
    // farebbe pensare a un carico che il documento non sta dichiarando.
    const outLines = mine.map(o =>
      `${o.label}  ${lbl('pdu.st', o.status)}`
      + (o.deviceName
        ? `  ->  ${o.deviceName}${o.portName ? ` · ${o.portName}` : ''}`
          + (o.source ? `  [${_rt(L, `pdu.src.${o.source}`)}]` : '')
        : ''));

    doc.font('Helvetica');
    const pairRows = Math.ceil(pairs.length / 2);
    const noteRows = s.notes ? _wrapFit(doc, s.notes, CW - 12, 6).length : 0;
    const feedRows = feedLines.reduce((a, l) => a + _wrapFit(doc, l, CW - 12, 6).length, 0);
    const outRows = outLines.reduce((a, l) => a + _wrapFit(doc, l, CW - 12, 6).length, 0);
    const cardH = 18 + 3 + pairRows * 10 + 4
      + (feedLines.length ? 10 + feedRows * 9 : 0)
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
  const sub = `${list.length} ${_rt(L, 'sub.assets')}`
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
  _rTable(doc, cols, rows, y, T, projName, date);
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

module.exports = { _loadPdfDeps, _addReportPages, _addCoverPage, _addNotesPages, _addChangelogPages, _addSparePages, _addPduPages, _addAssetRegisterPages, _addRecoveryPages, _addOverviewPages, _assetDeviceLabel, _fmtRevised, _rt, _fit, _wrapFit };
