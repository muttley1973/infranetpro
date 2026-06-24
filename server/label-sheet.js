'use strict';
// ============================================================
//  Etichette cavo — render PDF su fogli Avery / rotoli Dymo / griglia
//  generica (P1.3). Usa pdfkit (gia' dipendenza per il report PDF).
//
//  addLabelPages(doc, rows, { template, detail, wrap, grid })
//    doc      PDFDocument creato dal chiamante (autoFirstPage:false)
//    rows     righe da lib/cable-labels.js buildCableLabelRows
//    template id geometria (vedi TEMPLATES) — default 'avery-l7651'
//    detail   'idOnly' | 'idFromTo' | 'full'  — quanto testo per cella
//    wrap     true → testo ID ripetuto nelle due meta' (etichetta a
//             bandierina: leggibile da entrambi i lati avvolgendo il cavo)
//    grid     override geometria per template 'generic-grid' (valori in mm)
//
//  Geometrie in MILLIMETRI (nominali da datasheet) → convertite in punti.
//  NB: la prima stampa va verificata su carta, poi si calibra con
//  'generic-grid' (cfr. caveat nel piano / nota UI).
// ============================================================

const MM = 2.83465;                 // 1 mm in punti PDF
const A4     = { w: 595.28, h: 841.89 };
const LETTER = { w: 612,    h: 792   };

// kind 'sheet' = griglia su pagina; 'roll' = 1 etichetta = 1 pagina.
const TEMPLATES = {
  // Foglio A4, 65 etichette 38.1x21.2mm (5 colonne x 13 righe).
  'avery-l7651': {
    kind: 'sheet', page: A4, label: 'Avery L7651 (A4, 65/foglio)',
    cols: 5, rows: 13, labelW: 38.1, labelH: 21.2,
    marginLeft: 4.65, marginTop: 10.7, pitchX: 40.6, pitchY: 21.2,
  },
  // Foglio Letter, 12 etichette quadrate 1.5"x1.5" (3 colonne x 4 righe).
  'avery-22806': {
    kind: 'sheet', page: LETTER, label: 'Avery 22806 (Letter, 12/foglio, quadrata)',
    cols: 3, rows: 4, labelW: 38.1, labelH: 38.1,
    marginLeft: 15.875, marginTop: 12.7, pitchX: 63.5, pitchY: 50.8,
  },
  // Rotolo Dymo LabelWriter indirizzo 89x28mm (1 etichetta = 1 pagina).
  'dymo-99010': {
    kind: 'roll', label: 'Dymo 99010 (LabelWriter, 89x28mm)',
    labelW: 89, labelH: 28,
  },
  // Rotolo Dymo LabelWriter multifunzione 25x13mm.
  'dymo-11353': {
    kind: 'roll', label: 'Dymo 11353 (LabelWriter, 25x13mm)',
    labelW: 25, labelH: 13,
  },
  // Griglia A4 configurabile dal client (rete di sicurezza per stock vari).
  'generic-grid': {
    kind: 'sheet', page: A4, label: 'Griglia generica (configurabile)',
    cols: 4, rows: 10, labelW: 48, labelH: 25,
    marginLeft: 8, marginTop: 12, pitchX: 49, pitchY: 27,
  },
};

const DETAILS = new Set(['idOnly', 'idFromTo', 'full']);

function _isHexColor(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c); }

// Font size che fa stare `text` in `maxW` punti, tra start e min (passo 0.5).
function _fitFont(doc, text, maxW, startFs, minFs) {
  let fs = startFs;
  doc.font('Helvetica');
  while (fs > minFs && doc.fontSize(fs).widthOfString(String(text || '')) > maxW) fs -= 0.5;
  return fs;
}

// Tronca con ellissi se `text` a `fs` supera `maxW`.
function _truncate(doc, text, maxW, fs) {
  let t = String(text == null ? '' : text);
  doc.font('Helvetica').fontSize(fs);
  if (doc.widthOfString(t) <= maxW) return t;
  while (t.length > 1 && doc.widthOfString(t + '…') > maxW) t = t.slice(0, -1);
  return t + '…';
}

// Una riga di testo centrata orizzontalmente, baseline-top a `y`.
function _line(doc, text, x, y, w, fs, opts = {}) {
  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
     .fontSize(fs)
     .fillColor(opts.color || '#111111')
     .text(_truncate(doc, text, w, fs), x, y, { width: w, align: opts.align || 'center', lineBreak: false });
}

// Disegna il contenuto di UNA etichetta nell'area (x,y,w,h) in punti.
// Elenco canonico dei campi selezionabili (stessi nomi del CSV).
const FIELDS = ['label', 'da', 'a', 'lunghezza', 'tipo_cavo',
                'vlan', 'permanente', 'installato_il', 'installato_da', 'stanza'];

// Mappatura di compatibilita' dei vecchi preset `detail` → set di campi.
const DETAIL_FIELDS = {
  idOnly:   ['label'],
  idFromTo: ['label', 'da', 'a'],
  full:     ['label', 'da', 'a', 'vlan', 'tipo_cavo', 'lunghezza'],
};

// Set di campi richiesti: da opts.fields (array) o fallback dal preset detail.
function _normFields(opts) {
  let arr = Array.isArray(opts.fields) ? opts.fields : null;
  if (!arr) arr = DETAIL_FIELDS[DETAILS.has(opts.detail) ? opts.detail : 'idFromTo'];
  const set = new Set(arr.filter(f => FIELDS.includes(f)));
  if (!set.size) set.add('label');   // almeno l'ID
  return set;
}

// Costruisce le righe di testo (oltre al pallino colore) per i campi scelti.
function _cellLines(row, fields) {
  const lines = [];
  if (fields.has('label')) {
    lines.push({ t: String((row.label || row.id || '')).replace(/→/g, '->'), role: 'head' });
  }
  const ft = [];
  if (fields.has('da')) ft.push(row.from || '?');
  if (fields.has('a'))  ft.push(row.to   || '?');
  if (ft.length) lines.push({ t: ft.join(' -> '), role: 'sub' });

  const chips = [];
  if (fields.has('vlan') && row.vlan != null) chips.push('V' + row.vlan + (row.vlanName ? ' ' + row.vlanName : ''));
  if (fields.has('tipo_cavo') && row.cableType) chips.push(row.cableType);
  if (fields.has('lunghezza') && row.lengthM != null) chips.push(row.lengthM + 'm');
  if (fields.has('permanente')) chips.push(row.isPermanent ? 'permanente' : 'bretella');
  if (chips.length) lines.push({ t: chips.join('  ·  '), role: 'meta' });

  const inst = [];
  if (fields.has('installato_il') && row.installedAt) inst.push(row.installedAt);
  if (fields.has('installato_da') && row.installedBy) inst.push(row.installedBy);
  if (inst.length) lines.push({ t: inst.join(' · '), role: 'meta' });

  if (fields.has('stanza') && row.room) lines.push({ t: String(row.room), role: 'meta' });
  if (fields.has('note') && row.notes) lines.push({ t: String(row.notes), role: 'meta' });
  return lines;
}

// head = Etichetta (ID); sub/meta (tutti gli altri campi) ~13px in anteprima → ~9.75pt sul PDF.
const _ROLE_FS = { head: ch => Math.min(10, ch * 0.34), sub: ch => Math.min(9.75, ch * 0.312), meta: ch => Math.min(9.75, ch * 0.292) };
const _ROLE_COLOR = { head: '#111111', sub: '#444444', meta: '#666666' };

function _drawCell(doc, row, x, y, w, h, fields, wrap) {
  const pad = Math.min(4, w * 0.06, h * 0.12);
  const cx = x + pad, cy = y + pad, cw = w - pad * 2, ch = h - pad * 2;
  if (cw <= 2 || ch <= 2) return;

  const labelTxt = String((row.label || row.id || '')).replace(/→/g, '->');

  // Wrap/bandierina: stesso ID nelle due meta' (alto/basso) → leggibile
  // da entrambi i lati quando si avvolge il cavo. Si ignorano gli altri campi.
  if (wrap) {
    const halfH = ch / 2;
    const fs = Math.max(5, Math.min(_fitFont(doc, labelTxt, cw, Math.min(10, halfH * 0.6), 5), halfH * 0.7));
    _line(doc, labelTxt, cx, cy + (halfH - fs) / 2, cw, fs, { bold: true });
    _line(doc, labelTxt, cx, cy + halfH + (halfH - fs) / 2, cw, fs, { bold: true });
    return;
  }

  const lines = _cellLines(row, fields);
  const showDot = fields.has('colore') && _isHexColor(row.color) && cw > 40;

  // Una sola riga → riempi la cella (comportamento "solo ID").
  if (lines.length <= 1) {
    const txt = lines.length ? lines[0].t : labelTxt;
    const fs = Math.max(5, Math.min(_fitFont(doc, txt, cw, Math.min(13, ch * 0.7), 5), ch * 0.8));
    _line(doc, txt, cx, cy + (ch - fs) / 2, cw, fs, { bold: true });
    return;
  }

  // Font per ruolo + distribuzione verticale.
  lines.forEach(l => { l.fs = _ROLE_FS[l.role](ch); l.color = _ROLE_COLOR[l.role]; l.bold = l.role === 'head'; });
  const totalFs = lines.reduce((s, l) => s + l.fs, 0);
  const gap = Math.min(3, (ch - totalFs) / (lines.length - 1));
  let yy = cy + Math.max(0, (ch - totalFs - gap * (lines.length - 1)) / 2);

  // Pallino colore cavo a sinistra della prima riga.
  let firstX = cx, firstW = cw;
  if (showDot) {
    const r = Math.min(3, lines[0].fs * 0.4);
    doc.circle(cx + r, yy + lines[0].fs / 2, r).fill(row.color);
    firstX = cx + r * 2 + 3; firstW = cw - (r * 2 + 3);
  }

  lines.forEach((l, i) => {
    _line(doc, l.t, i === 0 ? firstX : cx, yy, i === 0 ? firstW : cw, l.fs, { bold: l.bold, color: l.color });
    yy += l.fs + gap;
  });
}

// Risolve il template effettivo, applicando l'override `grid` (mm) al generico.
function _resolveTemplate(template, grid) {
  const base = TEMPLATES[template] || TEMPLATES['avery-l7651'];
  if (template === 'generic-grid' && grid && typeof grid === 'object') {
    const g = { ...base };
    for (const k of ['cols', 'rows', 'labelW', 'labelH', 'marginLeft', 'marginTop', 'pitchX', 'pitchY']) {
      const v = Number(grid[k]);
      if (Number.isFinite(v) && v > 0) g[k] = v;
    }
    if (grid.page === 'letter') g.page = LETTER;
    return g;
  }
  return base;
}

function addLabelPages(doc, rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const fields = _normFields(opts);
  const wrap = !!opts.wrap;
  const tpl = _resolveTemplate(opts.template, opts.grid);

  if (tpl.kind === 'roll') {
    // 1 etichetta = 1 pagina (LabelWriter feed continuo die-cut).
    const w = tpl.labelW * MM, h = tpl.labelH * MM;
    const src = list.length ? list : [{ label: '(vuoto)' }];
    src.forEach(row => {
      doc.addPage({ size: [w, h], margin: 0 });
      _drawCell(doc, row, 0, 0, w, h, fields, wrap);
    });
    return;
  }

  // Sheet: griglia cols x rows per pagina.
  const pageW = tpl.page.w, pageH = tpl.page.h;
  const perPage = tpl.cols * tpl.rows;
  const src = list.length ? list : [];
  for (let i = 0; i < Math.max(src.length, 1); i++) {
    const slot = i % perPage;
    if (slot === 0) doc.addPage({ size: [pageW, pageH], margin: 0 });
    if (i >= src.length) break;  // pagina aperta ma niente piu' righe (caso 0 righe)
    const r = Math.floor(slot / tpl.cols);
    const c = slot % tpl.cols;
    const x = (tpl.marginLeft + c * tpl.pitchX) * MM;
    const y = (tpl.marginTop + r * tpl.pitchY) * MM;
    // bordo cella sottile come guida di taglio
    doc.rect(x, y, tpl.labelW * MM, tpl.labelH * MM).lineWidth(0.3).strokeColor('#d0d0d0').stroke();
    _drawCell(doc, src[i], x, y, tpl.labelW * MM, tpl.labelH * MM, fields, wrap);
  }
}

module.exports = { addLabelPages, TEMPLATES, FIELDS, _resolveTemplate, _normFields, MM };
