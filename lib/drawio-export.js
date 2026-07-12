// ============================================================
// DRAWIO-EXPORT - costruzione PURA dell'XML mxGraph (draw.io / diagrams.net)
// per l'elevazione dei rack.
//
// Separa il "QUALE XML" (questa lib, pura+testabile) dal "COME scaricarlo"
// (export.js exportDrawio: raccoglie lo stato, inietta i global, fa il Blob).
// Ricalca la geometria di export.js _buildRackSVG (matematica U, porte, SFP/
// MGMT, tacca SNMP) ma emette VERI mxCell nativi -> il file .drawio e'
// pulito, editabile, ZERO artefatti (niente immagine/SVG incollato).
//
// buildDrawioXml(model) -> stringa <mxfile> (una <diagram> per rack).
//
// model: SOLO plain-data + helper iniettati (niente DOM, niente globali):
//   racks[]   : [{ id, name, sizeU, uNumberFromTop }]
//   nodes[]   : [{ id, type, rackId, rackU, sizeU, ports, name, color,
//                  frontPanel, snmpStatus }]
//   ports     : { [pid]: { status, statusOvr, hidden, lagGroup, lagId } }
//   skins     : { [nodeId]: { image (data URI), aspect, ports:[{pid,xf,yf,wf,hf}] } }
//               (opz.) device con skin custom: faccia = immagine, porte = celle
//               native sovrapposte alle frazioni-viewBox (calcolate via getBBox
//               dal glue export.js, che ha il DOM). Con skin il grid generato e'
//               saltato (fallback totale al layout generato SOLO senza skin).
//   opts      : { rackUnitSize?, host? }
//   helpers   : {
//     types,                            catalogo TYPES (isRack, sizeU, ports, mgmtEligible)
//     getRackSize(rackId) -> number,    (clamp 6..60; fallback su rack.sizeU)
//     normalizeStatus(s) -> 'active'|'fault'|'idle'|'inactive',
//     normalizeNumber(v,def,min,max),
//     hasSnmpIntegration(node) -> bool,
//     typeName(type) -> string,
//   }
//
// Costanti geometriche CALIBRATE su app.diagrams.net (round-trip reale, F0):
//   - childLayout=rack + allowGaps=1 rispetta la Y dei figli al pixel e
//     conserva gli U vuoti; la formula Y e' quella di _buildRackSVG.
//   - ricetta zero-artefatti: collapsible=0 su ogni container (niente icona-
//     fold resa come <image>) + html=0 e NIENTE whiteSpace=wrap sulle
//     etichette (testo <text> puro, niente <foreignObject>).
//
// Condivisa browser + test (UMD-lite). NON muta il model.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- Costanti geometriche (F0) -------------------------------------------
  const DEFAULT_U     = 20;    // px per unita' rack (draw.io default 14.8; 20 = porte leggibili)
  const MARGIN_LEFT   = 33;    // strip numeri a sinistra (rackCabinet3)
  const MARGIN_RIGHT  = 9;
  const MARGIN_TOP    = 21;
  const MARGIN_BOTTOM = 22;
  const DEVICE_W      = 260;   // larghezza faccia device (interno rack)
  const CABINET_X     = 40;
  const CABINET_Y     = 40;

  // --- Colori (identici alla vista rack / _buildRackSVG) -------------------
  const STATUS_COLOR = {
    active: '#39d353', fault: '#f85149', idle: '#f5a623', inactive: '#6e7681',
  };
  const LAG_COLOR   = '#00d4ff';
  const DEV_FILL    = '#3a3a3a';
  const DEV_GRAD    = '#2b2b2b';
  const DEV_STROKE  = '#111827';
  const PORT_STROKE = '#334155';
  const SFP_BORDER  = '#9aa5b1';   // argento
  const MGMT_BORDER = '#00d4ff';   // ciano

  // --- Utility -------------------------------------------------------------
  function _escXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  // Numero pulito per le coordinate (niente code di decimali, niente ".0").
  function _n(v) {
    const r = Math.round(v * 100) / 100;
    return Object.is(r, -0) ? 0 : r;
  }
  function _clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function _validHex(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c); }
  // Ombreggia un hex per fattore (come _shadeHex dell'app): usato per rendere il
  // gradiente-metallo di un device colorato (node.color) coerente con _rackDeviceBg.
  function _shade(hex, f) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return hex;
    const ch = i => _clamp(Math.round(parseInt(m[i], 16) * f), 0, 255).toString(16).padStart(2, '0');
    return `#${ch(1)}${ch(2)}${ch(3)}`;
  }
  function _fit(text, max) {
    const s = String(text || '');
    return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s;
  }

  // Un mxCell vertex con geometria. value viene escapato; style e' controllato
  // (nessun input utente); id viene escapato per sicurezza (i pid sono ascii).
  function _cell(id, value, style, parent, x, y, w, h) {
    return `<mxCell id="${_escXml(id)}" value="${_escXml(value)}" style="${style}" vertex="1" parent="${_escXml(parent)}">`
      + `<mxGeometry x="${_n(x)}" y="${_n(y)}" width="${_n(w)}" height="${_n(h)}" as="geometry"/>`
      + `</mxCell>`;
  }

  // --- Helper con fallback (per test senza l'app) --------------------------
  function _mkHelpers(h) {
    h = h || {};
    return {
      types: h.types || {},
      getRackSize: h.getRackSize || null,
      normalizeStatus: h.normalizeStatus || function (s) {
        s = String(s == null ? '' : s).toLowerCase();
        return STATUS_COLOR[s] ? s : 'inactive';
      },
      normalizeNumber: h.normalizeNumber || function (v, def, min, max) {
        let n = Number(v);
        if (!Number.isFinite(n)) n = def;
        return _clamp(Math.round(n), min, max);
      },
      hasSnmpIntegration: h.hasSnmpIntegration || function () { return false; },
      typeName: h.typeName || function (t) { return String(t || 'device'); },
      isAbsent: h.isAbsent || null,   // device assente all'ultima Verifica -> attenuato
    };
  }

  // Colore tacca SNMP a sinistra del device (come stripeColor in _buildRackSVG).
  function _snmpColor(node, H) {
    if (!H.hasSnmpIntegration(node)) return '#6e7681';   // non configurato
    if (node.snmpStatus === 'ok')  return '#39d353';
    if (node.snmpStatus === 'err') return '#f85149';
    return '#d29922';                                     // configurato, non confermato
  }

  // Colore di una porta dal suo stato (LAG vince col ciano).
  function _portColor(pi, H) {
    const lag = !!(pi.lagGroup) || (parseInt(pi.lagId || 0, 10) > 0);
    if (lag) return LAG_COLOR;
    return STATUS_COLOR[H.normalizeStatus(pi.statusOvr != null ? pi.statusOvr : pi.status)] || STATUS_COLOR.inactive;
  }

  // Larghezza di un blocco laterale SFP/MGMT (grid 2 righe, cella 8, gap 2, pad 6).
  function _sideW(cells) {
    if (cells <= 0) return 0;
    const cols = Math.ceil(cells / 2);
    return cols * 8 + (cols - 1) * 2 + 6;
  }

  // Blocco laterale (SFP o MGMT): grid 2 righe di celle-porta. parent = device.
  function _sideBlock(node, ports, pidList, bx, by, bw, bh, borderColor, H) {
    if (!pidList || !pidList.length) return '';
    const cols = Math.ceil(pidList.length / 2);
    const cw = 8, ch = 5, gap = 2;
    const gridW = cols * cw + (cols - 1) * gap;
    const gridH = 2 * ch + gap;
    const gx = bx + (bw - gridW) / 2;
    const gy = by + (bh - gridH) / 2;
    let out = '';
    pidList.forEach(function (pid, idx) {
      const col = Math.floor(idx / 2), row = idx % 2;
      const cx = gx + col * (cw + gap), cy = gy + row * (ch + gap);
      const pi = ports[pid] || {};
      const has = (pi.statusOvr != null || pi.status != null);
      const fill = has ? _portColor(pi, H) : 'none';
      out += _cell(pid, '', `rounded=1;fillColor=${fill};strokeColor=${borderColor};`, node.id, cx, cy, cw, ch);
    });
    return out;
  }

  // Porte dati principali (1..pc): 1 riga se <=24, 2 righe (dispari sopra /
  // pari sotto) se >24. Coerente con drawPorts di _buildRackSVG.
  function _mainPorts(node, ports, pc, x0, w, y0, h, H) {
    if (pc <= 0 || w <= 2) return '';
    const isHidden = function (i) { return !!((ports[`${node.id}-${i}`] || {}).hidden); };
    let out = '';
    const port = function (i, cx, cy, size) {
      if (isHidden(i)) return '';
      const pid = `${node.id}-${i}`;
      const pi = ports[pid] || {};
      const style = `rounded=1;fillColor=${_portColor(pi, H)};strokeColor=${PORT_STROKE};fontSize=5;fontColor=#0d1117;`;
      return _cell(pid, String(i), style, node.id, cx, cy, size, size);
    };
    if (pc > 24) {
      const cols = Math.ceil(pc / 2);
      const pitch = w / cols;
      let led = Math.min(7, h * 0.40);
      if (led > pitch - 1) led = Math.max(3, pitch - 1);
      const topY = y0 + h * 0.30 - led / 2;
      const botY = y0 + h * 0.70 - led / 2;
      for (let j = 0; j < cols; j++) {
        const cx = x0 + j * pitch + (pitch - led) / 2;
        out += port(2 * j + 1, cx, topY, led);
        if (2 * j + 2 <= pc) out += port(2 * j + 2, cx, botY, led);
      }
    } else {
      const pitch = w / pc;
      let led = Math.min(9, h * 0.62);
      if (led > pitch - 1) led = Math.max(3, pitch - 1);
      const cy = y0 + h * 0.5 - led / 2;
      for (let i = 1; i <= pc; i++) {
        const cx = x0 + (i - 1) * pitch + (pitch - led) / 2;
        out += port(i, cx, cy, led);
      }
    }
    return out;
  }

  // Faccia skin custom: l'artwork del pannello come immagine (letterbox, aspetto
  // mantenuto = imageAspect=1, come il render live in xMidYMid meet) + celle-porta
  // NATIVE sovrapposte, posizionate dalle frazioni-viewBox (calcolate via getBBox
  // dal chiamante) e colorate per stato. parent = device.
  function _skinCells(node, ports, skin, h, H) {
    let out = _cell(`${node.id}__skin`, '',
      `shape=image;image=${skin.image};imageAspect=1;imageAlign=center;imageVerticalAlign=middle;`,
      node.id, 0, 0, DEVICE_W, h);
    const boxW = DEVICE_W, boxH = h;
    const asp = skin.aspect > 0 ? skin.aspect : (boxW / boxH);
    // Fit "meet" centrato: l'immagine riempie il box mantenendo l'aspetto.
    let rW, rH, offX, offY;
    if (boxW / boxH > asp) { rH = boxH; rW = boxH * asp; offX = (boxW - rW) / 2; offY = 0; }
    else { rW = boxW; rH = boxW / asp; offX = 0; offY = (boxH - rH) / 2; }
    (skin.ports || []).forEach(function (sp) {
      const w = sp.wf * rW, hh = sp.hf * rH;
      if (!(w > 0 && hh > 0)) return;
      const x = offX + sp.xf * rW, y = offY + sp.yf * rH;
      const pi = ports[sp.pid] || {};
      out += _cell(sp.pid, '', `rounded=1;fillColor=${_portColor(pi, H)};strokeColor=#0d1117;opacity=85;`, node.id, x, y, w, hh);
    });
    return out;
  }

  // Tutte le celle di un device: faccia + tacca SNMP + porte (SFP/MGMT/main).
  function _deviceCells(node, ports, cabinetId, rs, U, H, skins) {
    const def = H.types[node.type] || {};
    const sU = H.normalizeNumber(node.sizeU != null ? node.sizeU : (def.sizeU != null ? def.sizeU : 1), 1, 1, rs);
    const rackU = H.normalizeNumber(node.rackU, 1, 1, Math.max(1, rs - sU + 1));
    const y = MARGIN_TOP + (rs - rackU - sU + 1) * U;
    const h = sU * U;
    const skin = (skins && skins[node.id] && skins[node.id].image) ? skins[node.id] : null;
    // Colore device: se node.color e' un hex valido usa il gradiente-metallo
    // ombreggiato (come _rackDeviceBg), altrimenti il metallo di default.
    let fill = DEV_FILL, grad = DEV_GRAD;
    if (_validHex(node.color)) { fill = _shade(node.color, 1.08); grad = _shade(node.color, 0.68); }
    // Con skin: nome omesso (come .rack-device.has-skin live, l'artwork identifica il modello).
    const name = skin ? '' : _fit(node.name || H.typeName(node.type), 22);
    // Presenza: device assente all'ultima Verifica -> attenuato (opacity 50, come
    // .node-absent). Guardia gia' applicata dal chiamante (macOrphan && snmp!='ok').
    const absent = H.isAbsent ? !!H.isAbsent(node) : false;

    const devStyle = `rounded=0;html=0;fillColor=${fill};gradientColor=${grad};strokeColor=${DEV_STROKE};`
      + `fontColor=#f8fafc;fontSize=8;align=right;verticalAlign=middle;spacingRight=6;container=1;collapsible=0;`
      + (absent ? 'opacity=50;' : '');
    let cells = _cell(node.id, name, devStyle, cabinetId, MARGIN_LEFT, y, DEVICE_W, h);

    // Tacca SNMP (4px a sinistra, tutta altezza). Mantenuta anche con skin.
    cells += _cell(`${node.id}__snmp`, '', `rounded=0;fillColor=${_snmpColor(node, H)};strokeColor=none;`, node.id, 0, 0, 4, h);

    // Con skin: artwork + porte dallo skin; NIENTE grid generato (fallback totale
    // al layout generato SOLO senza skin, come nel render live).
    if (skin) { cells += _skinCells(node, ports, skin, h, H); return cells; }

    // Porte (relative all'origine del device).
    const pcTotal = node.ports != null ? node.ports : (def.ports || 0);
    if (pcTotal > 0 && node.type !== 'cablemanager') {
      const fp = node.frontPanel || {};
      const sfpCount = fp.separateSfp ? _clamp(parseInt(fp.sfpCount, 10) || 0, 0, pcTotal) : 0;
      const mgmtCount = def.mgmtEligible ? _clamp(parseInt(fp.mgmtCount, 10) || 0, 0, 4) : 0;
      const pc = pcTotal - sfpCount;
      const sfpRight = fp.sfpRight !== false;
      const mgmtRight = fp.mgmtPosition === 'right';

      // pid dei blocchi laterali.
      const mgmtPids = [];
      for (let k = 1; k <= mgmtCount; k++) mgmtPids.push(`${node.id}-mgmt${k}`);
      const sfpPids = [];
      for (let k = 0; k < sfpCount; k++) sfpPids.push(`${node.id}-${pcTotal - sfpCount + k + 1}`);

      const namePad = name ? 56 : 8;
      const sfpW = _sideW(sfpCount), mgmtW = _sideW(mgmtCount);
      const py = 1, ph = h - 2;
      let lc = 12;                    // cursore sinistro
      let rc = DEVICE_W - namePad;    // cursore destro (verso l'interno)

      // Ordine: [MGMT-left][SFP-left][data][SFP-right][MGMT-right][nome].
      if (mgmtCount > 0 && !mgmtRight) { cells += _sideBlock(node, ports, mgmtPids, lc, py, mgmtW, ph, MGMT_BORDER, H); lc += mgmtW + 2; }
      if (sfpCount  > 0 && !sfpRight)  { cells += _sideBlock(node, ports, sfpPids,  lc, py, sfpW,  ph, SFP_BORDER,  H); lc += sfpW + 2; }
      if (mgmtCount > 0 && mgmtRight)  { rc -= mgmtW; cells += _sideBlock(node, ports, mgmtPids, rc, py, mgmtW, ph, MGMT_BORDER, H); rc -= 2; }
      if (sfpCount  > 0 && sfpRight)   { rc -= sfpW;  cells += _sideBlock(node, ports, sfpPids,  rc, py, sfpW,  ph, SFP_BORDER,  H); rc -= 2; }
      cells += _mainPorts(node, ports, pc, lc, rc - lc, py, ph, H);
    }
    return cells;
  }

  // Una <diagram> (pagina) con il cabinet e i suoi device.
  function _rackDiagram(rack, nodes, ports, U, H, skins) {
    const rs = H.getRackSize ? H.getRackSize(rack.id) : _clamp(Math.round(Number(rack.sizeU) || 42), 6, 60);
    const cabinetId = `rk_${rack.id}`;
    const cabH = MARGIN_TOP + rs * U + MARGIN_BOTTOM;
    const cabW = MARGIN_LEFT + DEVICE_W + MARGIN_RIGHT;
    const numDisp = rack.uNumberFromTop ? 'descend' : 'ascend';

    const cabStyle = `shape=mxgraph.rackGeneral.rackCabinet3;rackUnitSize=${U};fillColor2=#f4f4f4;`
      + `container=1;collapsible=0;childLayout=rack;allowGaps=1;`
      + `marginLeft=${MARGIN_LEFT};marginRight=${MARGIN_RIGHT};marginTop=${MARGIN_TOP};marginBottom=${MARGIN_BOTTOM};`
      + `textColor=#666666;numDisp=${numDisp};`;

    let body = `<mxCell id="0"/><mxCell id="1" parent="0"/>`;
    body += _cell(cabinetId, `${rack.name || rack.id} (${rs}U)`, cabStyle, '1', CABINET_X, CABINET_Y, cabW, cabH);

    (nodes || [])
      .filter(function (n) { return n.rackId === rack.id && H.types[n.type] && H.types[n.type].isRack; })
      .forEach(function (n) { body += _deviceCells(n, ports, cabinetId, rs, U, H, skins); });

    const model = `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0"><root>${body}</root></mxGraphModel>`;
    return `<diagram name="${_escXml(rack.name || rack.id)}" id="pg_${_escXml(rack.id)}">${model}</diagram>`;
  }

  // API pubblica.
  function buildDrawioXml(model) {
    const m = model || {};
    const racks = m.racks || [];
    const nodes = m.nodes || [];
    const ports = m.ports || {};
    const opts = m.opts || {};
    const U = Number(opts.rackUnitSize) > 0 ? Number(opts.rackUnitSize) : DEFAULT_U;
    const host = opts.host || 'InfraNetPro';
    const H = _mkHelpers(m.helpers);
    const skins = m.skins || {};   // { nodeId: { image, aspect, ports:[{pid,xf,yf,wf,hf}] } }

    const diagrams = racks.map(function (r) { return _rackDiagram(r, nodes, ports, U, H, skins); }).join('');
    return `<mxfile host="${_escXml(host)}">${diagrams}</mxfile>`;
  }

  return { buildDrawioXml, _escXml };
});
