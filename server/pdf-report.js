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

function _addReportPages(doc, report, projName, date, SVGtoPDF, options = {}) {
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
    const T = 'Inventario Cavi';
    let y = newPage(T);
    y = _rSub(doc, `${(report.cables || []).length} cavi documentati nel progetto`, y);
    const cols = [
      { label: '#',          w: 22  },
      { label: 'Etichetta',  w: 155, shrink: true, arrowAlign: true },
      { label: 'Da',         w: 75, wrap: true },
      { label: 'A',          w: 75, wrap: true },
      { label: 'VLAN',       w: 70, shrink: true },
      { label: 'Mezzo',      w: 40  },
      { label: 'Lungh.',     w: 30  },
      { label: 'Categoria',  w: 72, wrap: true },
    ]; // 539
    const rows = (report.cables || []).map((c, i) => [
      i + 1, c.label || '-', c.from || '-', c.to || '-',
      c.vlan ? `${c.vlan}${c.vlanName ? ' - ' + c.vlanName : ''}` : '-',
      c.medium || '-', c.length || '-', c.category || '-',
    ]);
    if (!rows.length)
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text('Nessun cavo presente.', _RM, y);
    else
      _rTable(doc, cols, rows, y, T, projName, date);
  }

  // ── Pagina 3: Tracciato As-Built ───────────────────────────────────────
  if (opts.includeAsBuilt) {
    const T = 'Tracciato cablaggio (As-Built)';
    let y = newPage(T);
    y = _rSub(doc, `${(report.asBuilt || []).length} percorsi tracciati`, y);
    const cols = [
      { label: '#',               w: 22  },
      { label: 'Percorso',        w: 333, wrap: true },
      { label: 'VLAN',            w: 112, shrink: true },
      { label: 'Mezzo',           w: 72  },
    ]; // 539
    const rows = (report.asBuilt || []).map((p, i) => [
      i + 1, (p.steps || []).join(' -> '), p.vlan || '-', p.medium || '-',
    ]);
    if (!rows.length)
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
         .text('Nessun percorso tracciabile. Collegare i dispositivi per generare i tracciati.', _RM, y);
    else
      _rTable(doc, cols, rows, y, T, projName, date);
  }

  // ── Pagina 4: Assegnazione porte ───────────────────────────────────────
  // Vista rack: una pagina per rack.
  if (opts.includeRacks) {
    const T = 'Vista rack';
    const rackSvgs = Array.isArray(report.rackSvgs)
      ? report.rackSvgs.filter(r => r && typeof r.svg === 'string' && r.svg.trim())
      : [];

    if (!rackSvgs.length) {
      let y = newPage(T);
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
         .text('Nessun rack presente nel progetto.', _RM, y);
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
    const T = 'Assegnazione porte';
    let y = newPage(T);
    const allRows = [];
    (report.portAssignment || []).forEach(dev =>
      (dev.ports || []).forEach(p =>
        allRows.push([dev.rack, dev.device, p.num, p.alias || '-',
                      p.status, p.speed || '-', p.vlan || '-', p.connectedTo || '-'])
      )
    );
    y = _rSub(doc, `${allRows.length} porte su ${(report.portAssignment || []).length} dispositivi`, y);
    const SC = { active: '#16a34a', fault: '#dc2626', idle: '#d97706', inactive: '#6b7280' };
    const cols = [
      { label: 'Rack',         w: 96, wrap: true },
      { label: 'Dispositivo',  w: 74, wrap: true },
      { label: 'P#',           w: 24  },
      { label: 'Alias / Desc', w: 92, wrap: true },
      { label: 'Stato',        w: 50, statusMap: SC },
      { label: 'Vel.',         w: 42  },
      { label: 'VLAN',         w: 70, shrink: true },
      { label: 'Connesso a',   w: 91, wrap: true },
    ]; // 539
    if (!allRows.length)
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text('Nessuna porta configurata.', _RM, y);
    else
      _rTable(doc, cols, allRows, y, T, projName, date);
  }

  // ── Pagina 5: Sommario VLAN (card per VLAN) ────────────────────────────
  if (opts.includeVlans) {
    const T = 'Sommario VLAN';
    let y = newPage(T);
    y = _rSub(doc, `${(report.vlans || []).length} VLAN configurate`, y);

    if (!(report.vlans || []).length) {
      doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
         .text('Nessuna VLAN configurata.', _RM, y);
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
             .text('Porte access:', M + 3, y + 2, { lineBreak: false });
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
             .text('Trunk link:', M + 3, y + 2, { lineBreak: false });
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
    const T = 'Topologia LLDP/CDP';
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
function _actionLabel(a) {
  if (_auditLabel === null) {
    try { _auditLabel = require('../lib/audit-log').auditActionLabel; }
    catch (_) { _auditLabel = (x => x); }
  }
  return _auditLabel(a) || a || 'Modifica';
}

// Copertina A4: banda titolo, metadati progetto/data/autore, box conteggi.
function _addCoverPage(doc, cover) {
  cover = cover || {};
  const M = _RM, W = _RW;
  doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  doc.rect(0, 0, 595, 150).fill('#1e3a5f');
  doc.font('Helvetica-Bold').fontSize(26).fillColor('#ffffff')
     .text(String(cover.title || 'Dossier di consegna'), M, 54, { width: W, lineBreak: false });
  doc.font('Helvetica').fontSize(13).fillColor('#cbd5e1')
     .text(String(cover.project || ''), M, 100, { width: W, lineBreak: false });

  let y = 200;
  const meta = [
    ['Progetto', cover.project || '—'],
    ['Data', cover.date || '—'],
    ['Generato da', cover.user || '—'],
  ];
  meta.forEach(([k, v]) => {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#64748b').text(k, M, y, { width: 120, lineBreak: false });
    doc.font('Helvetica').fontSize(10).fillColor('#1e293b').text(String(v), M + 120, y, { width: W - 120, lineBreak: false });
    y += 22;
  });

  y += 24;
  const stats = [['Dispositivi', cover.deviceCount], ['Cavi', cover.cableCount], ['VLAN', cover.vlanCount]];
  const bw = (W - 20) / 3;
  stats.forEach(([k, v], i) => {
    const x = M + i * (bw + 10);
    doc.rect(x, y, bw, 64).fillAndStroke('#f1f5f9', '#cbd5e1');
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#1e3a5f').text(String(v == null ? 0 : v), x, y + 12, { width: bw, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(k, x, y + 44, { width: bw, align: 'center', lineBreak: false });
  });

  doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
     .text('Generato con InfraNet Pro', M, 802, { width: W, align: 'center', lineBreak: false });
}

// Pagine Note: tabella Dispositivo | Nota (testo a capo).
function _addNotesPages(doc, notes, projName, date) {
  if (!Array.isArray(notes) || !notes.length) return;
  doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  _rHdr(doc, 'Note', projName, date);
  const cols = [
    { label: 'Dispositivo', w: 150 },
    { label: 'Nota', w: _RW - 150, wrap: true },
  ];
  _rTable(doc, cols, notes.map(n => [n.label, n.text]), _TOP, 'Note', projName, date);
}

// Pagine Changelog: tabella Data/ora | Utente | Azione | Oggetto | Dettaglio.
function _addChangelogPages(doc, changelog, projName, date) {
  if (!Array.isArray(changelog) || !changelog.length) return;
  doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  _rHdr(doc, 'Storia modifiche', projName, date);
  // Oggetto/Azione ora WRAPPANO (niente piu' troncamento "..."): l'Oggetto
  // contiene i nomi cavo "A -> B" che possono essere lunghi. Larghezze ribilanciate
  // a favore di Oggetto (somma colonne = _RW).
  const cols = [
    { label: 'Data / ora', w: 90 },
    { label: 'Utente', w: 50 },
    { label: 'Azione', w: 94, wrap: true },
    { label: 'Oggetto', w: 187, wrap: true },
    { label: 'Dettaglio', w: _RW - 421, wrap: true },
  ];
  // La freccia unicode → (U+2192) non e' nel font WinAnsi di base del PDF e usciva
  // come "!'": la normalizziamo a "->", rappresentabile e coerente con l'arrowAlign.
  const _pdfTxt = s => String(s == null ? '' : s).replace(/→/g, '->');
  const rows = changelog.map(e => {
    let when = e && e.ts || '';
    try { when = new Date(e.ts).toLocaleString('it-IT'); } catch (_) {}
    return [when, (e && e.user) || 'sistema', _actionLabel(e && e.action), _pdfTxt(e && e.target), _pdfTxt(e && e.summary)];
  });
  _rTable(doc, cols, rows, _TOP, 'Storia modifiche', projName, date);
}

// Pagine Porte libere (capacità): riepilogo + tabella per rack → device.
// spare = output di lib/spare-ports.js: { totals, racks[], unracked[] }.
function _addSparePages(doc, spare, projName, date) {
  spare = spare || {};
  const racks = Array.isArray(spare.racks) ? spare.racks : [];
  const unracked = Array.isArray(spare.unracked) ? spare.unracked : [];
  if (!racks.length && !unracked.length) return;
  const t = spare.totals || {};
  doc.addPage({ size: [595, 842], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  _rHdr(doc, 'Porte libere', projName, date);
  const summary = `Totale: ${t.free || 0} libere su ${t.ports || 0}  -  ${t.freeAccess || 0} access  -  ${t.freeSfp || 0} SFP/uplink`
    + (t.suspect ? `  -  ${t.suspect} sospette (SNMP attive)` : '');
  const y = _rSub(doc, summary, _TOP);
  const cols = [
    { label: 'Rack', w: 95 },
    { label: 'Dispositivo', w: 150 },
    { label: 'Libere', w: 48, color: '#1a7f37' },
    { label: 'Access', w: 46 },
    { label: 'SFP', w: 40 },
    { label: 'Sospette', w: 58, color: '#b8860b' },
    { label: 'Occupate', w: 50 },
    { label: 'Totale', w: 46 },
  ];
  const rows = [];
  const pushDev = (rackName, d) => rows.push([
    rackName, d.name, String(d.free), String(d.freeAccess), String(d.freeSfp),
    d.suspect ? String(d.suspect) : '', String(d.used), String(d.total),
  ]);
  racks.forEach(r => (r.devices || []).forEach(d => pushDev(r.name, d)));
  unracked.forEach(d => pushDev('(fuori rack)', d));
  _rTable(doc, cols, rows, y, 'Porte libere', projName, date);
}

module.exports = { _loadPdfDeps, _addReportPages, _addCoverPage, _addNotesPages, _addChangelogPages, _addSparePages };
