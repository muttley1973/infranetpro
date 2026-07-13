// ============================================================
// DRAWIO-EXPORT - costruzione PURA dell'XML mxGraph (draw.io / diagrams.net)
// per l'elevazione dei rack.
//
// Separa il "QUALE XML" (questa lib, pura+testabile) dal "COME scaricarlo"
// (export.js exportDrawio: raccoglie lo stato, inietta i global, fa il Blob).
// Ricalca la geometria di export.js _buildRackSVG (matematica U, porte, SFP/
// MGMT) ma emette VERI mxCell nativi -> il file .drawio e'
// pulito, editabile, ZERO artefatti (niente immagine/SVG incollato).
// NB: la tacca di stato SNMP a sinistra NON viene esportata: e' un indicatore
// LIVE e un .drawio e' una rappresentazione STATICA (sarebbe fuorviante).
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
//   links[]   : [{ id, src, dst, color?, colorOvr? }] (opz.) — src/dst = pid porta
//               (`${nodeId}-${n}`). I cavi INTRA-RACK (entrambi i capi sulla stessa
//               pagina) escono come ARCHI nativi su un LAYER separato attivabile,
//               inizialmente nascosto. I link con un capo su un altro rack/porta
//               nascosta sono saltati (niente archi penzolanti).
//   opts      : { rackUnitSize?, host?, cablesLayerName? }
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
  const LABEL_GAP     = 10;    // stacco etichetta-nome dal bordo destro del cabinet
  const LABEL_W       = 170;   // larghezza etichetta-nome (FUORI dal rack)
  const NAME_COLOR    = '#f8fafc';  // testo nome BIANCO (come la vista rack live, dark-only)
  const NAME_BG       = '#0d1117';  // sfondo scuro dietro al SOLO testo: leggibile su canvas scuro (si fonde) E chiaro (chip)

  // --- Colori (identici alla vista rack / _buildRackSVG) -------------------
  const STATUS_COLOR = {
    active: '#39d353', fault: '#f85149', idle: '#f5a623', inactive: '#6e7681',
  };
  const LAG_COLOR   = '#00d4ff';
  const CABLE_COLOR = '#9aa5b1';   // cavo di default (argento) SOLO quando manca colore VLAN/manuale
  const LANE_GAP    = 16;          // stacco 1a corsia cavi dal bordo SINISTRO del cabinet
  const LANE_STEP   = 7;           // passo fra corsie cavi adiacenti
  const LANE_MIN_GAP = 4;          // gap Y minimo per riusare una corsia (cavi che non si sovrappongono)
  const H_STAGGER_MAX = 6;         // passo max di sfalsamento verticale dei cavi che escono da uno stesso device
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
      linkColor: h.linkColor || null, // (l)->hex colore VLAN/override del cavo (dalla glue, come la vista live)
      linkVlan: h.linkVlan || null,   // (l)->numero VLAN del cavo (per il layer per-VLAN)
      vlanName: h.vlanName || null,   // (vid)->nome VLAN (per nominare il layer)
    };
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

  // Porte dati principali (1..pc): 1 riga se <=8, 2 righe (dispari sopra / pari
  // sotto) se >8 — come la vista rack LIVE (front-panel `auto`: app-types.js
  // _frontPanelRows, list.length>8 -> 2 righe alternate). LED impacchettati con
  // gap LIMITATO (gapBreath, geometria di _buildRackSVG) e blocco CENTRATO — NON
  // spalmati sull'intera larghezza. Numero DENTRO il LED (font per-cifra) solo se
  // abbastanza grande (pSize>=3.6). NB: baseLayout esplicito (linear/sequential)
  // non e' ancora replicato: il caso comune (auto) e' coperto.
  function _mainPorts(node, ports, pc, x0, w, y0, h, H) {
    if (pc <= 0 || w <= 2) return '';
    const isVisible = function (i) { return !((ports[`${node.id}-${i}`] || {}).hidden); };
    // port riceve il CENTRO (cx,cy); _cell vuole l'angolo → converto.
    const port = function (i, cx, cy, size) {
      const pid = `${node.id}-${i}`;
      const pi = ports[pid] || {};
      const digits = String(i).length;
      const val = size >= 3.6 ? String(i) : '';   // numero dentro solo se leggibile
      const fs = Math.max(3, size * (digits >= 2 ? 0.52 : 0.64));
      const style = `rounded=1;fillColor=${_portColor(pi, H)};strokeColor=${PORT_STROKE};fontSize=${_n(fs)};fontColor=#0d1117;`;
      return _cell(pid, val, style, node.id, cx - size / 2, cy - size / 2, size, size);
    };
    let out = '';
    if (pc > 8) {
      const nCols = Math.ceil(pc / 2);
      let pSize = Math.min(5.4, h * 0.42);
      const gapMin = 0.8, gapBreath = Math.min(3.5, pSize * 0.6);
      if (nCols * pSize + (nCols - 1) * gapMin > w) pSize = Math.max(2.8, (w - (nCols - 1) * gapMin) / nCols);
      const slack = nCols > 1 ? (w - nCols * pSize) / (nCols - 1) : 0;
      const gap = Math.max(gapMin, Math.min(gapBreath, slack));
      const colStep = pSize + gap;
      const total = nCols * pSize + (nCols - 1) * gap;
      const startX = x0 + Math.max(0, (w - total) / 2) + pSize / 2;
      const topY = y0 + h * 0.30, botY = y0 + h * 0.70;
      for (let j = 0; j < nCols; j++) {
        const cx = startX + j * colStep;
        const odd = 2 * j + 1, even = 2 * j + 2;
        if (isVisible(odd)) out += port(odd, cx, topY, pSize);
        if (even <= pc && isVisible(even)) out += port(even, cx, botY, pSize);
      }
    } else {
      const visible = [];
      for (let i = 1; i <= pc; i++) if (isVisible(i)) visible.push(i);
      const n = visible.length;
      if (!n) return '';
      let pSize = Math.min(7.2, h * 0.74);
      const gapMin = 1.4, gapBreath = Math.min(5.5, pSize * 0.7);
      if (n * pSize + (n - 1) * gapMin > w) pSize = Math.max(3.4, (w - (n - 1) * gapMin) / n);
      const slack = n > 1 ? (w - n * pSize) / (n - 1) : 0;
      const gap = Math.max(gapMin, Math.min(gapBreath, slack));
      const colStep = pSize + gap;
      const total = n * pSize + (n - 1) * gap;
      const startX = x0 + Math.max(0, (w - total) / 2) + pSize / 2;
      const ledY = y0 + h * 0.50;
      visible.forEach(function (i, k) { out += port(i, startX + k * colStep, ledY, pSize); });
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

  // Geometria di un device nel cabinet: { y (relativa al cabinet), h }. Formula U
  // di _buildRackSVG. Condivisa da _deviceCells (posizione faccia) e dal routing
  // cavi (centro Y assoluto di ogni device) -> restano SEMPRE allineati.
  function _nodeGeom(node, rs, U, H) {
    const def = H.types[node.type] || {};
    const sU = H.normalizeNumber(node.sizeU != null ? node.sizeU : (def.sizeU != null ? def.sizeU : 1), 1, 1, rs);
    const rackU = H.normalizeNumber(node.rackU, 1, 1, Math.max(1, rs - sU + 1));
    return { y: MARGIN_TOP + (rs - rackU - sU + 1) * U, h: sU * U };
  }

  // Tutte le celle di un device: faccia + porte (SFP/MGMT/main) + nome esterno.
  function _deviceCells(node, ports, cabinetId, rs, U, H, skins) {
    const def = H.types[node.type] || {};
    const geom = _nodeGeom(node, rs, U, H);
    const y = geom.y, h = geom.h;
    const skin = (skins && skins[node.id] && skins[node.id].image) ? skins[node.id] : null;
    // Colore device: se node.color e' un hex valido usa il gradiente-metallo
    // ombreggiato (come _rackDeviceBg), altrimenti il metallo di default.
    let fill = DEV_FILL, grad = DEV_GRAD;
    if (_validHex(node.color)) { fill = _shade(node.color, 1.08); grad = _shade(node.color, 0.68); }
    // Il nome NON e' piu' dentro il device: la faccia interna resta libera per le
    // interfacce. `name` sopravvive SOLO come riserva-larghezza delle porte
    // (namePad piu' sotto) -> la disposizione delle porte resta INVARIATA.
    const name = skin ? '' : _fit(node.name || H.typeName(node.type), 22);
    // Presenza: device assente all'ultima Verifica -> attenuato (opacity 50, come
    // .node-absent). Guardia gia' applicata dal chiamante (macOrphan && snmp!='ok').
    const absent = H.isAbsent ? !!H.isAbsent(node) : false;

    const devStyle = `rounded=0;html=0;fillColor=${fill};gradientColor=${grad};strokeColor=${DEV_STROKE};`
      + `container=1;collapsible=0;`
      + (absent ? 'opacity=50;' : '');
    let cells = _cell(node.id, '', devStyle, cabinetId, MARGIN_LEFT, y, DEVICE_W, h);

    // Etichetta-nome ESTERNA: figlia del layer root ('1', NON del cabinet -> il
    // childLayout=rack non la tocca), a destra del cabinet, allineata al device.
    // Testo BIANCO (come la vista rack live) su sfondo-testo scuro
    // (labelBackgroundColor): leggibile sia su canvas draw.io scuro (lo sfondo si
    // fonde) sia chiaro (chip scuro). <text> + <rect> nativi (html=0, niente wrap)
    // -> ZERO artefatti. Emessa per TUTTI i device (anche con skin: comoda a lato).
    const labelName = _fit(node.name || H.typeName(node.type), 30);
    const cabRight = CABINET_X + MARGIN_LEFT + DEVICE_W + MARGIN_RIGHT;
    const lblStyle = `text;html=0;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;`
      + `fontColor=${NAME_COLOR};labelBackgroundColor=${NAME_BG};fontSize=11;` + (absent ? 'opacity=50;' : '');
    cells += _cell(`${node.id}__name`, labelName, lblStyle, '1', cabRight + LABEL_GAP, CABINET_Y + y, LABEL_W, h);

    // NB: nessuna tacca di stato SNMP a sinistra. E' un indicatore LIVE (colore da
    // snmpStatus), mentre un .drawio e' una rappresentazione STATICA: congelarci uno
    // stato momentaneo sarebbe fuorviante. La barretta resta solo nella vista live.

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

  // Colore di un cavo, STESSA convenzione della vista live/topologia (export.js:
  // `colorOvr || vlanColors[vlan] || grigio`): la glue inietta H.linkColor(l) che
  // risolve override manuale + colore VLAN (dato reale, no invenzione). Fallback:
  // colore esplicito sul record, poi argento di default.
  function _cableColor(l, H) {
    const vc = (H && typeof H.linkColor === 'function') ? H.linkColor(l) : null;
    if (_validHex(vc)) return vc;
    if (_validHex(l && l.colorOvr)) return l.colorOvr;
    if (_validHex(l && l.color)) return l.color;
    return CABLE_COLOR;
  }

  // Un layer mxGraph (figlio della root '0'), inizialmente NASCOSTO (visible=0):
  // draw.io lo mostra come casella ATTIVABILE nel pannello Livelli.
  function _layerCell(id, name) {
    return `<mxCell id="${_escXml(id)}" value="${_escXml(name)}" parent="0" visible="0"/>`;
  }

  // Un cavo come ARCO nativo: source/target = le celle-porta (id = pid). Nessuna
  // freccia (un cavo non ha verso). parent = il layer cavi attivabile.
  // ANTI-SOVRAPPOSIZIONE: ogni cavo scende in una CORSIA verticale dedicata a
  // sinistra del cabinet (2 waypoint a `laneX`, tratto verticale unico per corsia);
  // esce/entra dal lato SINISTRO delle porte (exitX/entryX=0). Le corsie sono
  // assegnate a monte con partizionamento a intervalli (cavi che non si sovrappongono
  // in Y condividono corsia). Colore = `color` (VLAN/override) -> distinguibile.
  function _cableEdge(l, idx, layerId, esc, color, laneX, yA, yB, exitDy, entryDy) {
    const style = `endArrow=none;startArrow=none;html=0;edgeStyle=orthogonalEdgeStyle;rounded=0;`
      + `exitX=0;exitY=0.5;exitDx=0;exitDy=${_n(exitDy || 0)};entryX=0;entryY=0.5;entryDx=0;entryDy=${_n(entryDy || 0)};`
      + `strokeColor=${color};strokeWidth=1.5;`;
    const eid = `cbl_${_escXml(String(l.id != null && l.id !== '' ? l.id : idx))}`;
    const pts = `<Array as="points"><mxPoint x="${_n(laneX)}" y="${_n(yA)}"/><mxPoint x="${_n(laneX)}" y="${_n(yB)}"/></Array>`;
    return `<mxCell id="${eid}" style="${style}" edge="1" parent="${_escXml(layerId)}" `
      + `source="${esc(l.src)}" target="${esc(l.dst)}"><mxGeometry relative="1" as="geometry">${pts}</mxGeometry></mxCell>`;
  }

  // Una <diagram> (pagina): cabinet + device (layer di default) e, su un LAYER
  // separato attivabile, i cavi intra-rack come archi nativi.
  function _rackDiagram(rack, nodes, ports, U, H, skins, links, cablesName) {
    const rs = H.getRackSize ? H.getRackSize(rack.id) : _clamp(Math.round(Number(rack.sizeU) || 42), 6, 60);
    const cabinetId = `rk_${rack.id}`;
    const cabH = MARGIN_TOP + rs * U + MARGIN_BOTTOM;
    const cabW = MARGIN_LEFT + DEVICE_W + MARGIN_RIGHT;
    const numDisp = rack.uNumberFromTop ? 'descend' : 'ascend';

    const cabStyle = `shape=mxgraph.rackGeneral.rackCabinet3;rackUnitSize=${U};fillColor2=#f4f4f4;`
      + `container=1;collapsible=0;childLayout=rack;allowGaps=1;`
      + `marginLeft=${MARGIN_LEFT};marginRight=${MARGIN_RIGHT};marginTop=${MARGIN_TOP};marginBottom=${MARGIN_BOTTOM};`
      + `textColor=#666666;numDisp=${numDisp};`;

    // Corpo device (layer di default '1'): costruito PRIMA per raccogliere gli id
    // delle celle-porta realmente emesse (le porte nascoste sono gia' escluse).
    let devBody = _cell(cabinetId, `${rack.name || rack.id} (${rs}U)`, cabStyle, '1', CABINET_X, CABINET_Y, cabW, cabH);
    (nodes || [])
      .filter(function (n) { return n.rackId === rack.id && H.types[n.type] && H.types[n.type].isRack; })
      .forEach(function (n) { devBody += _deviceCells(n, ports, cabinetId, rs, U, H, skins); });

    // Cavi INTRA-RACK su layer separato attivabile: solo i link con ENTRAMBI i capi
    // fra le celle-porta emesse in QUESTA pagina. Cosi' niente archi penzolanti: i
    // link rack<->rack (capo remoto su un'altra pagina) e verso porte nascoste
    // vengono saltati. Il livello parte NASCOSTO (l'utente lo attiva quando serve).
    const emitted = new Set();
    const reId = /<mxCell id="([^"]+)"/g;
    let mm; while ((mm = reId.exec(devBody))) emitted.add(mm[1]);
    const esc = function (s) { return _escXml(String(s == null ? '' : s).trim()); };
    const rackLinks = (links || []).filter(function (l) {
      return l && emitted.has(esc(l.src)) && emitted.has(esc(l.dst));
    });

    let layerDecl = '', edges = '';
    if (rackLinks.length) {
      // Centro Y assoluto e geometria di ogni device (routing corsie + sfalsamento).
      const nodeById = new Map();
      (nodes || []).forEach(function (n) { if (n && !nodeById.has(n.id)) nodeById.set(n.id, n); });
      const nodeOf = function (pid) { return nodeById.get(String(pid || '').split('-')[0]) || null; };
      const yCenter = function (n) { if (!n) return CABINET_Y; const g = _nodeGeom(n, rs, U, H); return CABINET_Y + g.y + g.h / 2; };
      const cab = rackLinks.map(function (l, i) {
        const sn = nodeOf(l.src), dn = nodeOf(l.dst);
        const yA = yCenter(sn), yB = yCenter(dn);
        return { l: l, i: i, sn: sn, dn: dn, yA: yA, yB: yB, top: Math.min(yA, yB), bot: Math.max(yA, yB),
          color: _cableColor(l, H), exitDy: 0, entryDy: 0, ySrc: yA, yDst: yB };
      });

      // SFALSAMENTO orizzontale: i cavi che toccano lo STESSO device condividono
      // ~la stessa Y (porte in fila) -> i tratti orizzontali si sovrappongono.
      // Distribuisco i cavi di ogni device su slot verticali distinti (passo <=
      // H_STAGGER_MAX, comunque dentro l'altezza del device) -> ogni cavo ha il suo
      // tratto orizzontale. exitDy/entryDy spostano il punto di uscita/entrata.
      const perDev = new Map();
      const _push = function (id, e) { let a = perDev.get(id); if (!a) { a = []; perDev.set(id, a); } a.push(e); };
      cab.forEach(function (c) { if (c.sn) _push(c.sn.id, { c: c, side: 's' }); if (c.dn) _push(c.dn.id, { c: c, side: 'd' }); });
      perDev.forEach(function (list, id) {
        const n = list.length;
        const g = _nodeGeom(nodeById.get(id), rs, U, H);
        const band = Math.max(0, g.h - 4);
        const step = n > 1 ? Math.min(H_STAGGER_MAX, band / (n - 1)) : 0;
        list.forEach(function (e, s) {
          const dy = (s - (n - 1) / 2) * step;
          if (e.side === 's') { e.c.exitDy = dy; e.c.ySrc = e.c.yA + dy; }
          else { e.c.entryDy = dy; e.c.yDst = e.c.yB + dy; }
        });
      });

      // Corsie verticali: partizionamento a intervalli sull'asse Y -> corsie minime;
      // cavi che non si sovrappongono in Y condividono corsia (laneEnd = ultima bot).
      const laneEnd = [];
      cab.slice().sort(function (a, b) { return a.top - b.top || a.bot - b.bot; }).forEach(function (c) {
        let lane = -1;
        for (let k = 0; k < laneEnd.length; k++) { if (laneEnd[k] <= c.top - LANE_MIN_GAP) { lane = k; break; } }
        if (lane === -1) { lane = laneEnd.length; laneEnd.push(c.bot); } else { laneEnd[lane] = c.bot; }
        c.lane = lane;
      });

      // UN LAYER PER VLAN, nominato col nome VLAN: la glue inietta linkVlan(l) (numero
      // VLAN) e vlanName(vid). Ogni cavo va sul layer della sua VLAN -> in draw.io ogni
      // VLAN si attiva/disattiva da sola nel pannello Livelli. Se la VLAN non e'
      // iniettata (uso base/test) resta un unico layer 'Cavi'. NB: corsie + sfalsamento
      // restano GLOBALI -> niente sovrapposizioni anche mostrando piu' VLAN insieme.
      const hasVlan = typeof H.linkVlan === 'function';
      const layerById = new Map();
      cab.forEach(function (c) {
        let vid = hasVlan ? H.linkVlan(c.l) : null;
        if (vid == null || vid === '') vid = hasVlan ? 1 : null;   // default/untagged -> VLAN 1
        c.layerKey = (vid == null) ? '_all' : String(vid);
      });
      Array.from(new Set(cab.map(function (c) { return c.layerKey; })))
        .sort(function (a, b) { return (Number(a) || 0) - (Number(b) || 0); })
        .forEach(function (k) {
          let id, name;
          if (k === '_all') { id = `cbl_layer_${rack.id}`; name = cablesName || 'Cavi'; }
          else {
            const nm = (typeof H.vlanName === 'function' ? H.vlanName(k) : '') || '';
            id = `cbl_v${k}_${rack.id}`; name = nm || ('VLAN ' + k);
          }
          layerById.set(k, id);
          layerDecl += _layerCell(id, name);
        });

      // Emissione (ordine originale, id stabili). laneX = a SINISTRA del cabinet.
      cab.forEach(function (c) {
        const laneX = CABINET_X - LANE_GAP - c.lane * LANE_STEP;
        edges += _cableEdge(c.l, c.i, layerById.get(c.layerKey), esc, c.color, laneX, c.ySrc, c.yDst, c.exitDy, c.entryDy);
      });
    }

    // Ordine: base(0,1) + [layer cavi] + cabinet/device + archi cavi.
    const body = `<mxCell id="0"/><mxCell id="1" parent="0"/>` + layerDecl + devBody + edges;

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
    const links = m.links || [];   // [{ id, src, dst, color?, colorOvr? }] — src/dst = pid porta
    const cablesName = opts.cablesLayerName || 'Cavi';

    const diagrams = racks.map(function (r) { return _rackDiagram(r, nodes, ports, U, H, skins, links, cablesName); }).join('');
    return `<mxfile host="${_escXml(host)}">${diagrams}</mxfile>`;
  }

  return { buildDrawioXml, _escXml };
});
