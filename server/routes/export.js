'use strict';
// ============================================================
//  Router export PDF (estratto da server.js, logica invariata).
// ============================================================
const express = require('express');
const auth = require('../../auth');
const { _loadPdfDeps, _addReportPages, _addCoverPage, _addNotesPages, _addChangelogPages, _addSparePages } = require('../pdf-report');
const { addLabelPages } = require('../label-sheet');

const router = express.Router();

router.post('/api/export-pdf', auth.requireAdmin, (req, res) => {
  const { svg, projectName, bgImage, bgImageW, bgImageH, bgImageType, reportData, reportOptions } = req.body ?? {};
  const opts = {
    includePlanimetria: true,
    includeBackground: true,
    includeInventory: true,
    includeAsBuilt: true,
    includeRacks: true,
    includePorts: true,
    includeVlans: true,
    includeTopology: true,
    ...(reportOptions || {}),
  };

  const hasPlanSvg = typeof svg === 'string' && svg.length > 0;
  const wantsReportPages = !!(opts.includeInventory || opts.includeAsBuilt || opts.includeRacks || opts.includePorts || opts.includeVlans || opts.includeTopology || opts.includeCover || opts.includeNotes || opts.includeChangelog || opts.includeSpare);

  if (!opts.includePlanimetria && !wantsReportPages) {
    return res.status(400).json({ error: 'Nessuna sezione selezionata per l\'export PDF' });
  }
  if (opts.includePlanimetria && !hasPlanSvg) {
    return res.status(400).json({ error: 'Payload mancante: svg (stringa SVG richiesta)' });
  }
  if (wantsReportPages && (!reportData || typeof reportData !== 'object')) {
    return res.status(400).json({ error: 'Payload mancante: reportData per le pagine report richieste' });
  }

  let PDFDocument, SVGtoPDF;
  try {
    ({ PDFDocument, SVGtoPDF } = _loadPdfDeps());
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const hName = String(projectName || 'InfraNet Pro').substring(0, 100);
    const hDate = new Date().toLocaleDateString('it-IT',
                    { day: '2-digit', month: '2-digit', year: 'numeric' });

    const doc = new PDFDocument({ size: [595, 842], margin: 0, autoFirstPage: false });

    // Dossier di consegna (N4): copertina come PRIMA pagina
    if (opts.includeCover && reportData && reportData.handoff && reportData.handoff.cover) {
      _addCoverPage(doc, reportData.handoff.cover);
    }

    if (opts.includePlanimetria && hasPlanSvg) {
      const vbMatch = svg.match(/viewBox="([^"]+)"/);
      const vbParts = vbMatch ? vbMatch[1].trim().split(/[\s,]+/).map(Number) : [0, 0, 800, 600];
      const svgW = vbParts[2] || 800;
      const svgH = vbParts[3] || 600;

      const MAX_PT = 760;
      const ratio  = Math.min(MAX_PT / svgW, MAX_PT / svgH, 1);
      const pdfW   = Math.round(svgW * ratio);
      const pdfH   = Math.round(svgH * ratio);

      const MARGIN   = 20;
      const HEADER_H = 28;
      const pageW    = pdfW + MARGIN * 2;
      const pageH    = pdfH + HEADER_H + MARGIN;

      doc.addPage({ size: [pageW, pageH], margin: 0 });
      doc.font('Helvetica').fontSize(9).fillColor('#888888')
         .text(`${hName}  -  Planimetria  -  ${hDate}`, MARGIN, 10, { lineBreak: false });
      doc.moveTo(MARGIN, 22)
         .lineTo(pageW - MARGIN, 22)
         .strokeColor('#555555').lineWidth(0.5).stroke();

      if (opts.includeBackground && bgImage && typeof bgImage === 'string' && bgImage.startsWith('data:')) {
        const srcW = bgImageW || svgW;
        const srcH = bgImageH || svgH;
        const iW   = Math.round(srcW * ratio);
        const iH   = Math.round(srcH * ratio);

        if (bgImageType === 'svg') {
          try {
            const dataPart = bgImage.split(',').slice(1).join(',');
            const svgText  = bgImage.includes(';base64,')
              ? Buffer.from(dataPart, 'base64').toString('utf8')
              : decodeURIComponent(dataPart);
            const bgWarn = [];
            SVGtoPDF(doc, svgText, MARGIN, HEADER_H, {
              width: iW, height: iH, assumePt: true,
              preserveAspectRatio: 'xMidYMid meet',
              fontCallback: () => 'Helvetica',
              warningCallback: (m) => bgWarn.push(m),
            });
            if (bgWarn.length) console.warn(`  [PDF] bg-SVG warnings: ${bgWarn.slice(0,5).join(' | ')}`);
          } catch (svgErr) {
            console.error(`  [PDF] Background SVG skip: ${svgErr.message}`);
          }
        } else {
          try {
            const b64    = bgImage.split(',')[1] || '';
            const imgBuf = Buffer.from(b64, 'base64');
            if (imgBuf.length >= 4) {
              const magic4 = imgBuf.readUInt32BE(0);
              const magic2 = imgBuf.readUInt16BE(0);
              if (magic4 !== 0x89504E47 && magic2 !== 0xFFD8) {
                throw new Error(`Formato non supportato (magic 0x${magic4.toString(16).toUpperCase()})`);
              }
            }
            doc.image(imgBuf, MARGIN, HEADER_H, { width: iW, height: iH });
          } catch (imgErr) {
            console.error(`  [PDF] Background raster skip: ${imgErr.message}`);
          }
        }
      }

      const svgWarnings = [];
      SVGtoPDF(doc, svg, MARGIN, HEADER_H, {
        width: pdfW, height: pdfH, assumePt: true,
        preserveAspectRatio: 'xMidYMid meet',
        fontCallback: (_family, _bold) => _bold ? 'Helvetica-Bold' : 'Helvetica',
        warningCallback: (msg) => svgWarnings.push(msg),
      });
      if (svgWarnings.length) {
        console.warn(`  [PDF] svg-to-pdfkit warnings (${svgWarnings.length}):`);
        svgWarnings.forEach(w => console.warn(`    • ${w}`));
      }
    }

    if (wantsReportPages && reportData && typeof reportData === 'object') {
      _addReportPages(doc, reportData, hName, hDate, SVGtoPDF, opts);
    }
    // Dossier di consegna (N4): note e storia modifiche in coda
    if (opts.includeNotes && reportData && reportData.handoff) {
      _addNotesPages(doc, reportData.handoff.notes, hName, hDate);
    }
    if (opts.includeChangelog && reportData && reportData.handoff) {
      _addChangelogPages(doc, reportData.handoff.changelog, hName, hDate);
    }
    // Porte libere (capacità): pagina A4 opzionale.
    if (opts.includeSpare && reportData && reportData.spare) {
      _addSparePages(doc, reportData.spare, hName, hDate);
    }

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => {
      const buf = Buffer.concat(chunks);
      res.setHeader('Content-Type',        'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="infranetpro-report.pdf"');
      res.setHeader('Content-Length',      buf.length);
      res.end(buf);
    });
    doc.on('error', err => {
      console.error(`  [PDF] Errore stream: ${err.message}`);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    doc.end();

  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`  [PDF] ${msg}`);
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
});

// ---- Export PDF etichette cavo (fogli Avery / rotoli Dymo / generico) -------
router.post('/api/export-labels-pdf', auth.requireAdmin, (req, res) => {
  const { rows, template, detail, fields, wrap, grid } = req.body ?? {};

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Nessuna etichetta da esportare (rows vuoto)' });
  }

  let PDFDocument;
  try {
    ({ PDFDocument } = _loadPdfDeps());
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const doc = new PDFDocument({ margin: 0, autoFirstPage: false });
    addLabelPages(doc, rows, { template, detail, fields, wrap: !!wrap, grid });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => {
      const buf = Buffer.concat(chunks);
      res.setHeader('Content-Type',        'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="infranetpro-etichette.pdf"');
      res.setHeader('Content-Length',      buf.length);
      res.end(buf);
    });
    doc.on('error', err => {
      console.error(`  [PDF-labels] Errore stream: ${err.message}`);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    doc.end();
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`  [PDF-labels] ${msg}`);
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
});

module.exports = router;
