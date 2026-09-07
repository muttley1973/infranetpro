'use strict';
// ============================================================
//  Router export PDF (estratto da server.js, logica invariata).
// ============================================================
const express = require('express');
const auth = require('../../auth');
const { buildPduReport } = require('../../lib/pdu-report.js');
const { buildInterSiteWanReport } = require('../../lib/inter-site-report.js');
const { readOrganization } = require('../organization-store');
const { _loadPdfDeps, _svgImageCallback, _rasterGuard, _addReportPages, _addCoverPage, _addChangelogPages, _addSparePages, _addPduPages, _addAssetRegisterPages, _addRecoveryPages, _addWanPages, _addOverviewPages, _rt } = require('../pdf-report');
const { addLabelPages } = require('../label-sheet');
const { loadProject } = require('../projects-store');
const { projectToDevices, applyPortMacFallback, applyDeviceNotes, isStructuralCabling } = require('../../lib/api-shape');

const router = express.Router();

router.post('/api/export-pdf', auth.requireAdmin, (req, res) => {
  const { svg, projectName, bgImage, bgImageW, bgImageH, bgImageType, reportData, reportOptions, projectId, lang } = req.body ?? {};
  const opts = {
    includePlanimetria: true,
    includeBackground: true,
    includeInventory: true,
    includeAsBuilt: true,
    includeRacks: true,
    includePorts: true,
    includeVlans: true,
    includeTopology: true,
    includeAssets: false,   // registro asset (per-device): opt-in dal client nuovo; default OFF = retrocompat coi client vecchi
    includeRecovery: false, // sezione Ripristinabilità (DR): opt-in; backup pointer + serial/firmware + posizione
    includeWan: false,      // capitolo WAN inter-sede: mappa + schede di ripristino. Opt-in = i client vecchi restano identici
    ...(reportOptions || {}),
  };

  const hasPlanSvg = typeof svg === 'string' && svg.length > 0;
  const wantsReportPages = !!(opts.includeInventory || opts.includeAsBuilt || opts.includeRacks || opts.includePorts || opts.includeVlans || opts.includeTopology || opts.includeCover || opts.includeChangelog || opts.includeSpare || opts.includeAssets || opts.includeRecovery || opts.includePdu);

  // ⚠️ Il capitolo WAN si compone TUTTO nel server (l'organizzazione sta in
  // data/organization.json, non nel progetto): è una sezione vera, ma non chiede
  // `reportData`. Tenerlo fuori da `wantsReportPages` è ciò che permette di
  // spuntare solo lui senza che la richiesta venga respinta per un payload che
  // non gli serve.
  const wantsServerPages = !!opts.includeWan;

  if (!opts.includePlanimetria && !wantsReportPages && !wantsServerPages) {
    return res.status(400).json({ error: 'Nessuna sezione selezionata per l\'export PDF' });
  }
  if (opts.includePlanimetria && !hasPlanSvg) {
    return res.status(400).json({ error: 'Payload mancante: svg (stringa SVG richiesta)' });
  }
  if (wantsReportPages && (!reportData || typeof reportData !== 'object')) {
    return res.status(400).json({ error: 'Payload mancante: reportData per le pagine report richieste' });
  }
  // ⚠️ Le liste del report arrivano dal CLIENT, e il generatore le SCORRE. Una che
  // non è un array lo faceva cadere: `{cables:'x'}` → 500 con «(report.cables ||
  // []).map is not a function», cioè un messaggio da stack trace in faccia a chi
  // chiama (misurato). `|| []` difende dal nullo, non dal tipo sbagliato.
  // ⭐ La rotta GEMELLA — quella delle etichette, dieci righe più giù — questo
  // controllo ce l'ha dal primo giorno (`Array.isArray(rows)` → 400): era la stessa
  // guardia presente da una parte e assente dall'altra. Qui si dice anche QUALE
  // campo, perché un 400 che non nomina il campo manda a indovinare.
  const LISTE_REPORT = ['cables', 'asBuilt', 'portAssignment', 'vlans', 'rackSvgs', 'vms'];
  if (reportData && typeof reportData === 'object') {
    const storte = LISTE_REPORT.filter(k => reportData[k] != null && !Array.isArray(reportData[k]));
    if (storte.length) {
      return res.status(400).json({
        error: `reportData: ${storte.join(', ')} deve essere un array`,
        code: 'bad-report-shape', fields: storte,
      });
    }
  }

  let PDFDocument, SVGtoPDF;
  try {
    ({ PDFDocument, SVGtoPDF } = _loadPdfDeps());
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const hName = String(projectName || 'InfraNet Pro').substring(0, 100);
    const _lang = (lang === 'en') ? 'en' : 'it';   // lingua del report (dal client getLang); default it
    const hDate = new Date().toLocaleDateString(_lang === 'en' ? 'en-GB' : 'it-IT',
                    { day: '2-digit', month: '2-digit', year: 'numeric' });

    // Registro asset + timestamp "ultima revisione": caricati SERVER-SIDE dal
    // progetto (per projectId), cosi' l'asset register riusa i DTO nodeToDevice
    // (allowlist anti-leak) e il timestamp = project.updated_at AUTOREVOLE (il
    // client non lo conosce). Solo interi positivi → loadProject fa path.join(id).
    let _project = null, _lastRevised = null;
    const _pid = Number(projectId);
    if ((opts.includeAssets || opts.includeCover) && Number.isInteger(_pid) && _pid > 0) {
      try { _project = loadProject(_pid); } catch (_) { _project = null; }
      if (_project && _project.updated_at) _lastRevised = _project.updated_at;
    }

    const doc = new PDFDocument({ size: [595, 842], margin: 0, autoFirstPage: false });

    // Dossier di consegna (N4): copertina come PRIMA pagina
    if (opts.includeCover && reportData && reportData.handoff && reportData.handoff.cover) {
      // Inietta "ultima revisione" (project.updated_at) nella copertina: il client
      // costruisce la cover ma non conosce updated_at → lo aggiunge il server.
      if (_lastRevised && reportData.handoff.cover.lastRevised == null) {
        reportData.handoff.cover.lastRevised = _lastRevised;
      }
      _addCoverPage(doc, reportData.handoff.cover, _lang);
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
         .text(`${hName}  -  ${_rt(_lang, 'title.floorplan')}  -  ${hDate}`, MARGIN, 10, { lineBreak: false });
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
              imageCallback: _svgImageCallback,
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
            // Firma COMPLETA + IHDR + tetto sulle dimensioni, non i soli 4 byte di
            // magic: un PNG con alfa passa da png-js, che alloca w*h*canali PRIMA di
            // decomprimere (un IHDR 30000×30000 RGBA = 3,6 GB) e lancia dentro una
            // callback asincrona, fuori da questo try (smoke 07/09).
            const g = _rasterGuard(imgBuf);
            if (!g.ok) throw new Error(`Immagine di sfondo rifiutata: ${g.reason}`);
            doc.image(imgBuf, MARGIN, HEADER_H, { width: iW, height: iH });
          } catch (imgErr) {
            console.error(`  [PDF] Background raster skip: ${imgErr.message}`);
          }
        }
      }

      const svgWarnings = [];
      SVGtoPDF(doc, svg, MARGIN, HEADER_H, {
        imageCallback: _svgImageCallback,
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

    // Panoramica: sintesi ESECUTIVA, quindi PRIMA delle sezioni di dettaglio —
    // chi apre il dossier legge il verdetto, poi semmai i dati che lo sostengono.
    // Contenuto client-built (reportData.overview): parole gia' risolte dal glue,
    // nessun `items` (la sintesi non elenca device: quello e' il registro asset).
    if (opts.includeOverview && reportData && reportData.overview) {
      _addOverviewPages(doc, reportData.overview, hName, hDate, _lang);
    }
    if (wantsReportPages && reportData && typeof reportData === 'object') {
      _addReportPages(doc, reportData, hName, hDate, SVGtoPDF, opts, _lang);
    }
    // Registro asset (per-device): riusa i DTO nodeToDevice del progetto caricato
    // server-side. Se il progetto non e' caricabile, pagina con nota "nessun device".
    if (opts.includeAssets) {
      // Escludi il cablaggio strutturale (prese a muro, quadri elettrici): e'
      // infrastruttura dell'edificio, non asset IT -> fuori dal Registro asset. Il
      // conteggio "N dispositivi documentati" segue la lista filtrata.
      const assets = _project ? projectToDevices(_project).filter(d => !isStructuralCabling(d)) : [];
      // Colonna MAC del registro: gli apparati SNMP non hanno un MAC di device (i loro
      // MAC stanno sulle porte) -> fallback misurato al MAC della porta base, cosi'
      // l'infrastruttura non esce con MAC vuoto. Solo qui (il DTO condiviso resta com'e').
      if (_project && _project.state) applyPortMacFallback(assets, _project.state.ports);
      // La nota scritta a mano sull'apparato viaggia CON la sua riga (non piu' in un
      // capitolo «Note» separato, dove per capire a chi si riferisse bisognava
      // reincrociare i nomi). Come il fallback MAC: vive solo nel registro.
      if (_project && _project.state) applyDeviceNotes(assets, _project.state.nodes);
      _addAssetRegisterPages(doc, assets, hName, hDate, _lastRevised, _lang);
    }
    // Dossier di consegna (N4): storia modifiche in coda
    if (opts.includeChangelog && reportData && reportData.handoff) {
      _addChangelogPages(doc, reportData.handoff.changelog, hName, hDate, _lang);
    }
    // Porte libere (capacità): pagina A4 opzionale.
    if (opts.includeSpare && reportData && reportData.spare) {
      _addSparePages(doc, reportData.spare, hName, hDate, _lang);
    }
    // Ripristinabilità (DR): DOVE vive il backup + serial/firmware + posizione. Il
    // cuore della runbook — dati client-built (reportData.recovery), puntatore backup
    // credential-free, MAI il config né la community.
    if (opts.includeRecovery && reportData && reportData.recovery) {
      _addRecoveryPages(doc, reportData.recovery, hName, hDate, _lang);
    }
    // WAN inter-sede: la mappa delle sedi (vettoriale, fondo bianco) e le schede
    // per rifare una linea o un collegamento. Sta accanto alla Ripristinabilità
    // perché è la stessa domanda, un piano sopra: quella dice come si rimette in
    // piedi un apparato, questa come si rimette in piedi il collegamento fra due
    // edifici.
    // ⚠️ Nessun `reportData`: l'organizzazione è UNA per installazione e vive nel
    // server (`data/organization.json`), non dentro il progetto. Il client manda
    // solo la casella spuntata.
    if (opts.includeWan) {
      const _nodiCache = new Map();      // projectRef → nodi del progetto, o null
      const _nodiDi = (ref) => {
        const k = String(ref == null ? '' : ref);
        if (_nodiCache.has(k)) return _nodiCache.get(k);
        let nodi = null;
        // ⚠️ `projectRef` arriva da un JSON che l'utente può scrivere a mano:
        // solo interi positivi, come per `projectId` — `loadProject` fa
        // `path.join(id)`.
        const n = Number(k);
        if (Number.isInteger(n) && n > 0) {
          try {
            const p = loadProject(n);
            nodi = (p && p.state && Array.isArray(p.state.nodes)) ? p.state.nodes : null;
          } catch (_) { nodi = null; }
        }
        _nodiCache.set(k, nodi);
        return nodi;
      };
      const _org = readOrganization();
      const wan = buildInterSiteWanReport(_org, {
        projectRef: projectId,
        // Tre esiti, e sono diversi: `undefined` = il progetto non si è potuto
        // leggere, `null` = letto, ma quel nodo non c'è più, una stringa = il
        // nome. Dire «apparato non trovato» senza aver guardato sarebbe
        // un'accusa inventata.
        deviceNameOf: (siteId, ref) => {
          const sede = (_org.sites || []).find(s => s.id === siteId);
          const nodi = sede ? _nodiDi(sede.projectRef) : null;
          if (!nodi) return undefined;
          const nodo = nodi.find(x => String(x.id) === String(ref));
          if (!nodo) return null;
          // Stessa regola di `nodeToDevice`: senza nome documentato vale l'id —
          // è quello che il pannello mostra, e il dossier non deve dire altro.
          return String(nodo.name || '').trim() || String(nodo.id);
        },
      });
      _addWanPages(doc, wan, hName, hDate, _lang, SVGtoPDF);
    }
    // Alimentazione (PDU): riepilogo + dettaglio prese. A differenza degli altri
    // capitoli le righe si compongono QUI e non nel client: servono gli helper di
    // lib/pdu-layout.js (stato presa, connessione, modalità di gestione) che nel
    // browser vivono solo dentro il bundle ESM, irraggiungibili da export.js
    // (script classico). Il client manda i soli campi PDU in whitelist — nessun
    // segreto SNMP — e il server compone: una sola implementazione, testata.
    // Anche con ZERO PDU il capitolo si stampa (stato vuoto esplicito): chi lo ha
    // spuntato deve leggere «non c'è nulla di documentato», non trovarsi il capitolo
    // sparito e chiedersi se sia un errore dell'export.
    if (opts.includePdu && reportData && Array.isArray(reportData.pdus)) {
      _addPduPages(doc, buildPduReport({ pdus: reportData.pdus }), hName, hDate, _lang);
    }

    // ── Scadenza della risposta ────────────────────────────────────────────────
    // `doc.end()` finalizza solo quando il contatore interno di pdfkit torna a
    // zero. Un'immagine che fa lanciare png-js DENTRO una callback asincrona lo
    // lascia fermo per sempre: 'end' non arriva, il client resta appeso senza
    // risposta e i `chunks` restano in memoria col socket aperto (smoke 07/09).
    // Qui si garantisce UNA risposta comunque. Generosa: dopo il tetto sul
    // troncamento un dossier grande sta ampiamente sotto.
    const PDF_DEADLINE_MS = 60000;
    const chunks = [];
    let risposto = false;
    const scadenza = setTimeout(() => {
      if (risposto) return;
      risposto = true;
      chunks.length = 0;                     // non trattenere il parziale
      console.error('  [PDF] documento non finalizzato entro 60s: richiesta chiusa');
      if (!res.headersSent) res.status(500).json({ error: 'PDF generation timed out', code: 'pdf-timeout' });
      else res.end();
    }, PDF_DEADLINE_MS);
    const chiudi = (fn) => { if (risposto) return; risposto = true; clearTimeout(scadenza); fn(); };

    doc.on('data', c => { if (!risposto) chunks.push(c); });
    doc.on('end', () => chiudi(() => {
      const buf = Buffer.concat(chunks);
      res.setHeader('Content-Type',        'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="infranetpro-report.pdf"');
      res.setHeader('Content-Length',      buf.length);
      res.end(buf);
    }));
    doc.on('error', err => chiudi(() => {
      console.error(`  [PDF] Errore stream: ${err.message}`);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }));
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
