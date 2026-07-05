'use strict';
// ============================================================
//  Generazione report PDF (pdfkit + svg-to-pdfkit, lazy).
//  Estratto da server.js senza modifiche di logica.
// ============================================================

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
    'spare.unracked': '(fuori rack)',
    'cover.title': 'Dossier di consegna', 'cover.project': 'Progetto', 'cover.date': 'Data',
    'cover.lastRevised': 'Ultima revisione', 'cover.user': 'Generato da',
    'cover.devices': 'Dispositivi', 'cover.cables': 'Cavi', 'cover.vlans': 'VLAN',
    'cover.footer': 'Generato con InfraNet Pro', 'audit.system': 'sistema',
  },
  en: {
    'title.inventory': 'Cable inventory', 'title.asbuilt': 'Cabling route (As-Built)',
    'title.racks': 'Rack view', 'title.ports': 'Port assignment', 'title.vlans': 'VLAN summary',
    'title.topology': 'LLDP/CDP topology', 'title.assets': 'Asset register', 'title.notes': 'Notes',
    'title.changelog': 'Change history', 'title.spare': 'Free ports', 'title.floorplan': 'Floor plan',
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
    'spare.unracked': '(unracked)',
    'cover.title': 'Handover dossier', 'cover.project': 'Project', 'cover.date': 'Date',
    'cover.lastRevised': 'Last revised', 'cover.user': 'Generated by',
    'cover.devices': 'Devices', 'cover.cables': 'Cables', 'cover.vlans': 'VLANs',
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

// Tronca il testo al numero di caratteri che entrano nella colonna.
// Helvetica 7pt: larghezza media per carattere ≈ fontSize * 0.5 pt
function _fit(str, widthPt, fs = 7) {
  str = String(str ?? '');
  const max = Math.floor(widthPt / (fs * 0.50));
  if (!str || str.length <= max) return str;
  return str.substring(0, max - 3) + '...';
}

function _wrapFit(str, widthPt, fs = 7) {
  const s = String(str ?? '');
  const max = Math.max(1, Math.floor(widthPt / (fs * 0.50)));
  if (!s.length) return [''];
  const out = [];
  for (let i = 0; i < s.length; i += max) out.push(s.substring(i, i + max));
  return out;
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
      doc.text(_fit(c.label, c.w - 6, FS), x + 3, y + 4, { lineBreak: false });
      x += c.w;
    });
    y += HH;
  };

  drawHdr();

  rows.forEach((row, ri) => {
    const cellLines = cols.map((c, ci) => {
      const raw = String(row[ci] ?? '');
      if (c.wrap) return _wrapFit(raw, c.w - 6, FS);
      if (c.shrink) return [raw];
      return [_fit(raw, c.w - 6, FS)];
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
        const leftRaw  = String(m?.[1] ?? '').trim();
        const rightRaw = String(m?.[2] ?? '').trim();
        const cellL = x + 3;
        const cellR = x + c.w - 3;
        const mid   = (cellL + cellR) / 2;
        const arrow = '->';
        const gap   = 10;
        const leftW  = Math.max(10, (mid - gap) - cellL);
        const rightW = Math.max(10, cellR - (mid + gap));

        // Riduce il font solo quanto basta per mantenere tutto in monoriga.
        const fsLeftNeed  = leftRaw.length  ? (leftW  / (leftRaw.length  * 0.50)) : FS;
        const fsRightNeed = rightRaw.length ? (rightW / (rightRaw.length * 0.50)) : FS;
        const fs = Math.max(5, Math.min(FS, fsLeftNeed, fsRightNeed));
        const arrowW = fs * 1.2;

        doc.font('Helvetica').fontSize(fs).fillColor(color)
           .text(leftRaw, cellL, y + 3, { width: leftW, align: 'right', lineBreak: false });
        doc.font('Helvetica').fontSize(fs).fillColor(color)
           .text(arrow, mid - (arrowW / 2), y + 3, { lineBreak: false });
        doc.font('Helvetica').fontSize(fs).fillColor(color)
           .text(rightRaw, mid + gap, y + 3, { width: rightW, align: 'left', lineBreak: false });
        x += c.w;
        return;
      }

      lines.forEach((line, li) => {
        let fs = FS;
        let txt = line;
        if (c.shrink && li === 0) {
          // Monoriga senza ellissi: riduce il font solo per questa cella fino a un minimo leggibile.
          const targetW = c.w - 6;
          const neededFs = baseText.length > 0 ? (targetW / (baseText.length * 0.50)) : FS;
          fs = Math.max(5, Math.min(FS, neededFs));
          txt = baseText;
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
                      p.status, p.speed || '-', p.vlan || '-', p.connectedTo || '-'])
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
        const agRows = ag.reduce((s, g) => {
          const portsStr = (g.ports || []).map(p => `P${p}`).join('  ');
          return s + _wrapFit(portsStr, PORTS_W, 6).length;
        }, 0);
        const tlRows = tl2.reduce((s, link) => {
          const txt = typeof link === 'string'
            ? link
            : `${link?.src || '?'} P${link?.srcPort || '?'} -> ${link?.dst || '?'} P${link?.dstPort || '?'}`
              + (link?.vlans ? ` [${link.vlans}]` : '');
          return s + _wrapFit(txt, CW - 6, 6).length;
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
        doc.text(_fit(hdr, maxName, 8), M + 18, y + 5, { lineBreak: false });
        // IPAM inline nella fascia blu, dopo il nome, separato da " | "
        if (ipamParts.length) {
          const ipamStr = '|  ' + ipamParts.join('  |  ');
          const startX = M + 18 + nameW + 8;
          const availW = (M + CW - countsW - 10) - startX;
          if (availW > 30) {
            doc.font('Helvetica').fontSize(6.5).fillColor('#ffffff')
               .text(_fit(ipamStr, availW, 6.5), startX, y + 6.5, { lineBreak: false });
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
            const portLines = _wrapFit(portsStr, PORTS_W, 6);
            doc.font('Helvetica-Bold').fontSize(6).fillColor('#334155')
               .text(_fit(devLabel, DNAME_W - 6, 6), M + 3, y, { lineBreak: false });
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
            _wrapFit(txt, CW - 6, 6).forEach(line => {
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
  const stats = [[_rt(L, 'cover.devices'), cover.deviceCount], [_rt(L, 'cover.cables'), cover.cableCount], [_rt(L, 'cover.vlans'), cover.vlanCount]];
  const bw = (W - 20) / 3;
  stats.forEach(([k, v], i) => {
    const x = M + i * (bw + 10);
    doc.rect(x, y, bw, 64).fillAndStroke('#f1f5f9', '#cbd5e1');
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#1e3a5f').text(String(v == null ? 0 : v), x, y + 12, { width: bw, align: 'center', lineBreak: false });
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
  const summary = `${_rt(L, 'spare.total')}: ${t.free || 0} ${_rt(L, 'spare.freeOf')} ${t.ports || 0}  -  ${t.freeAccess || 0} access  -  ${t.freeSfp || 0} SFP/uplink`
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
    rackName, d.name, String(d.free), String(d.freeAccess), String(d.freeSfp),
    d.suspect ? String(d.suspect) : '', String(d.used), String(d.total),
  ]);
  racks.forEach(r => (r.devices || []).forEach(d => pushDev(r.name, d)));
  unracked.forEach(d => pushDev(_rt(L, 'spare.unracked'), d));
  _rTable(doc, cols, rows, y, T, projName, date);
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
    d.name || '-', d.type || '-', d.brand || '-', d.model || '-',
    d.serial || '-', d.ip || '-', d.mac || '-',
    (d.vlan != null ? String(d.vlan) : '-'),
    d.rack ? (String(d.rack.name || d.rack.id || '') + (d.rack.u != null ? ` U${d.rack.u}` : '')) : '-',
  ]);
  _rTable(doc, cols, rows, y, T, projName, date);
}

module.exports = { _loadPdfDeps, _addReportPages, _addCoverPage, _addNotesPages, _addChangelogPages, _addSparePages, _addAssetRegisterPages, _fmtRevised, _rt };
