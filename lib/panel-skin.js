// Panel-skin — parser/validatore PURO per skin SVG custom del pannello device.
// Condiviso browser + test (UMD-lite, stesso pattern di lib/frontpanel.js).
//
// Una "skin" e' un SVG disegnato a mano (es. in Illustrator) che riproduce un
// PANNELLO reale di un MODELLO di device — FRONTALE *o* RETRO (un server ha
// porte su entrambe le facce: non lo si sa a priori, quindi la skin dichiara la
// sua `face`). Le forme-porta del disegno portano un id convenzionale
// (`port-N`, `sfp-N`, `mgmt-N`) oppure `data-port="N"`: a render-time il glue
// inietta `data-pid` su quelle forme, e il motore di cablaggio esistente
// (app-pointer: `closest('[data-pid]')`) le tratta come i LED-porta generati.
// Cosi' l'artwork DIVENTA la superficie interattiva.
//
// FACCE: i numeri di porta sono ASSOLUTI sul device (1..portCount); una porta
// fisica sta su UNA faccia. La skin frontale copre le porte sul davanti, quella
// retro le porte dietro: insieme coprono tutte le porte, senza sovrapposizione.
// Il mapping pid NON dipende dalla faccia.
//
// Questo modulo NON tocca il DOM: lavora su stringhe (sanitizzazione + estrazione
// porte + validazione + mappatura pid), per restare puro e testabile in node.
// Mappatura pid (deve combaciare con app-render-core.js):
//   - porte dati (port/sfp)  ->  `${nodeId}-${num}`        (SFP = porte main uplink)
//   - porte management (mgmt) ->  `${nodeId}-mgmt${num}`
//
// SICUREZZA: la sorgente SVG e' semi-fidata (l'autore della skin / skin-pack),
// non upload arbitrario da internet. La sanitizzazione qui rimuove i vettori
// ovvi (script, handler on*, foreignObject/iframe, riferimenti esterni,
// javascript: URI). Il glue di render DEVE comunque inserire l'SVG in modo
// controllato; questa e' difesa in profondita', non l'unica barriera.
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        Object.assign(root, factory());
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Tipi di porta riconosciuti dalla convenzione di naming. 'sfp' e' un alias
    // visivo di 'port' (stesso namespace pid): cambia solo come l'artista la
    // disegna, non il numero di porta (che resta assoluto 1..portCount).
    var PORT_KINDS = { port: 'data', sfp: 'data', mgmt: 'mgmt' };

    // Facce valide del pannello. 'front' di default quando non dichiarata.
    function normFace(face) { return face === 'rear' ? 'rear' : 'front'; }

    // ---- Sanitizzazione -----------------------------------------------------

    /** Rimuove dai contenuti SVG i costrutti pericolosi. Ritorna l'SVG ripulito
     *  e l'elenco di cosa e' stato tolto (per diagnostica/warn in import). */
    function sanitizeSvg(svgText) {
        var removed = [];
        var s = String(svgText == null ? '' : svgText);

        var drop = function (re, label) {
            if (re.test(s)) { if (removed.indexOf(label) === -1) removed.push(label); s = s.replace(re, ''); }
            re.lastIndex = 0;
        };

        // elementi eseguibili / fuori-SVG (con contenuto, anche multiriga)
        drop(/<script\b[\s\S]*?<\/script\s*>/gi, 'script');
        drop(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, 'foreignObject');
        drop(/<iframe\b[\s\S]*?<\/iframe\s*>/gi, 'iframe');
        // ...e i tag ORFANI (aperti senza chiusura, self-close o chiusura sola): un
        // `<script>alert(1)` NON chiuso sopravviveva alle regex di coppia qui sopra
        // ed era il vettore principale di bypass. `<\/?tag\b[^>]*>` copre aperto,
        // `</tag>` e `<tag/>`; il testo residuo (es. "alert(1)") resta inerte.
        drop(/<\/?script\b[^>]*>/gi, 'script');
        drop(/<\/?foreignObject\b[^>]*>/gi, 'foreignObject');
        drop(/<\/?iframe\b[^>]*>/gi, 'iframe');
        drop(/<!\[CDATA\[[\s\S]*?\]\]>/g, 'cdata');
        drop(/<\?[\s\S]*?\?>/g, 'processing-instruction');

        // handler eventi inline in QUALSIASI forma. La vecchia regex prendeva solo
        // valori QUOTATI preceduti da spazio → passavano indenni: on*=valore non
        // quotato (onload=alert(1)), backtick (onx=`..`) e separatore slash
        // (<rect id="x"/onerror=alert(1)>). Ora: separatore [spazio|/], valore
        // "…"/'…'/`…`/non-quotato (fino a spazio, quote, > o /).
        var onRe = /[\s/]on[a-z][a-z0-9_-]*\s*=\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s"'`>/]+)/gi;
        if (onRe.test(s)) {
            removed.push('event-handlers');
            onRe.lastIndex = 0;
            s = s.replace(onRe, '');
        }

        // javascript: URI in un attributo (quotato o non quotato)
        if (/javascript:/i.test(s)) {
            removed.push('javascript-uri');
            s = s.replace(/(=\s*["'])\s*javascript:[^"']*(["'])/gi, '$1#$2');   // quotato
            s = s.replace(/=\s*javascript:[^\s"'`>]*/gi, '=#');                  // non quotato
        }

        // riferimenti ESTERNI in href/xlink:href/src: tieni solo i locali `#...`.
        // Toglie l'attributo (e il suo valore) quando NON inizia per `#`, sia col
        // valore quotato sia non quotato (href=//evil sfuggiva alla vecchia regex).
        var extRef    = /[\s/](?:xlink:)?(?:href|src)\s*=\s*(["'])(?!\s*#)[^"']*\1/gi;
        var extRefUnq = /[\s/](?:xlink:)?(?:href|src)\s*=\s*(?!["'#])[^\s"'`>]+/gi;
        if (extRef.test(s) || extRefUnq.test(s)) {
            removed.push('external-ref');
            extRef.lastIndex = 0; extRefUnq.lastIndex = 0;
            s = s.replace(extRef, '').replace(extRefUnq, '');
        }

        return { svg: s, removed: removed };
    }

    // ---- Estrazione porte dalla convenzione ---------------------------------

    /** Trova le forme-porta nell'SVG (per id `port-/sfp-/mgmt-N` o attributo
     *  `data-port="N"`). Ritorna [{ id, kind, num }] ordinate (dati poi mgmt,
     *  per numero crescente), deduplicate per (namespace,num). Puro: regex su
     *  stringa, nessun DOM. */
    function extractSkinPorts(svgText) {
        var s = String(svgText == null ? '' : svgText);
        var found = {};   // chiave "data:3" / "mgmt:1" -> {id,kind,num}
        var add = function (kind, num, id) {
            if (!(num >= 1)) return;
            var ns = PORT_KINDS[kind];
            if (!ns) return;
            var key = ns + ':' + num;
            if (!found[key]) found[key] = { id: id, kind: kind, num: num };
        };

        // id="port-12" / id='sfp-1' / id="mgmt-2"  (case-insensitive)
        var reId = /\bid\s*=\s*(["'])\s*(port|sfp|mgmt)-(\d+)\s*\1/gi;
        var m;
        while ((m = reId.exec(s)) !== null) {
            add(m[2].toLowerCase(), parseInt(m[3], 10), m[2].toLowerCase() + '-' + m[3]);
        }
        // data-port="12" / data-mgmt="1"
        var reData = /\bdata-(port|mgmt)\s*=\s*(["'])\s*(\d+)\s*\2/gi;
        while ((m = reData.exec(s)) !== null) {
            var k = m[1].toLowerCase();
            add(k, parseInt(m[3], 10), 'data-' + k + '-' + m[3]);
        }

        return Object.keys(found).map(function (k) { return found[k]; }).sort(function (a, b) {
            var na = PORT_KINDS[a.kind], nb = PORT_KINDS[b.kind];
            if (na !== nb) return na === 'data' ? -1 : 1;   // dati prima di mgmt
            return a.num - b.num;
        });
    }

    // ---- viewBox ------------------------------------------------------------

    /** Estrae il viewBox dell'<svg> radice -> { viewBox, width, height } o null. */
    function parseViewBox(svgText) {
        var s = String(svgText == null ? '' : svgText);
        var m = /<svg\b[^>]*\bviewBox\s*=\s*(["'])\s*([\d.\-+eE]+(?:[ ,]+[\d.\-+eE]+){3})\s*\1/i.exec(s);
        if (!m) return null;
        var raw = m[2].trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
        var p = raw.split(' ').map(Number);
        if (p.length !== 4 || p.some(function (x) { return !isFinite(x); })) return null;
        return { viewBox: raw, x: p[0], y: p[1], width: p[2], height: p[3] };
    }

    // ---- Mappatura pid ------------------------------------------------------

    /** pid del motore per una porta-skin su un dato nodo. Deve combaciare con
     *  lo schema di app-render-core.js. Indipendente dalla faccia. */
    function skinPortPid(nodeId, port) {
        var num = port && port.num;
        if (port && port.kind === 'mgmt') return nodeId + '-mgmt' + num;
        return nodeId + '-' + num;   // port | sfp (porte dati, incl. SFP uplink)
    }

    /** Mappa { idForma -> pid } per il glue: clona l'SVG, per ogni forma con
     *  questo id imposta data-pid = valore. */
    function buildSkinPidMap(nodeId, ports) {
        var map = {};
        (ports || []).forEach(function (p) { map[p.id] = skinPortPid(nodeId, p); });
        return map;
    }

    // ---- Parser principale --------------------------------------------------

    /** Valida e descrive una skin a partire dal testo SVG.
     *  `meta` (opzionale): { id, name, brand, model, face, uHeight } passati nel
     *  descrittore per comodita' (il record-skin completo lo assembla il glue).
     *  `face` normalizzata a 'front' | 'rear' (default 'front').
     *  Ritorna un descrittore con ok/errore + warning non bloccanti. */
    function parsePanelSkin(svgText, meta) {
        meta = meta || {};
        var face = normFace(meta.face);
        var sane = sanitizeSvg(svgText);
        var s = sane.svg;
        var warnings = [];

        if (!/<svg\b/i.test(s)) {
            return _fail('no-svg', 'Nessun elemento <svg> trovato.', sane.removed);
        }
        var vb = parseViewBox(s);
        if (!vb) {
            return _fail('no-viewbox', 'L\'<svg> deve avere un viewBox (esporta da Illustrator con "Responsive").', sane.removed);
        }
        var ports = extractSkinPorts(s);
        if (ports.length === 0) {
            return _fail('no-ports', 'Nessuna forma-porta riconosciuta (usa id="port-1", "port-2", … o data-port="1").', sane.removed);
        }

        var data = ports.filter(function (p) { return PORT_KINDS[p.kind] === 'data'; });
        var mgmt = ports.filter(function (p) { return p.kind === 'mgmt'; });

        // warning non bloccanti: sequenza dati con buchi / non da 1.
        // NB: con skin a doppia faccia una sola faccia copre solo PARTE delle
        // porte → questi warning sono informativi, non errori (la copertura
        // completa front∪rear la valida il glue quando ha il portCount).
        var nums = data.map(function (p) { return p.num; });
        if (nums.length) {
            var max = Math.max.apply(null, nums);
            if (nums.indexOf(1) === -1) warnings.push('le porte dati non partono da 1 (normale se è la faccia retro)');
            if (max !== nums.length) warnings.push('numerazione porte dati non contigua (1..' + max + ', trovate ' + nums.length + ')');
        }
        // width/height fissi sull'<svg> radice: ostacolano lo scaling nel rack
        if (/<svg\b[^>]*\b(width|height)\s*=/i.test(s)) {
            warnings.push('l\'<svg> ha width/height fissi: verranno ignorati, conta solo il viewBox');
        }
        if (sane.removed.length) {
            warnings.push('rimossi per sicurezza: ' + sane.removed.join(', '));
        }

        return {
            ok: true,
            error: null,
            errorCode: null,
            face: face,
            viewBox: vb.viewBox,
            width: vb.width,
            height: vb.height,
            svg: s,
            ports: ports,
            counts: { data: data.length, mgmt: mgmt.length },
            warnings: warnings,
            removed: sane.removed,
            // passthrough metadati skin-pack
            id: meta.id || null,
            name: meta.name || null,
            brand: meta.brand || null,
            model: meta.model || null,
            uHeight: meta.uHeight || null
        };

        function _fail(code, msg, removed) {
            return {
                ok: false, error: msg, errorCode: code, face: face,
                viewBox: null, width: 0, height: 0, svg: s,
                ports: [], counts: { data: 0, mgmt: 0 },
                warnings: warnings, removed: removed || []
            };
        }
    }

    return {
        sanitizeSvg: sanitizeSvg,
        extractSkinPorts: extractSkinPorts,
        parseViewBox: parseViewBox,
        skinPortPid: skinPortPid,
        buildSkinPidMap: buildSkinPidMap,
        parsePanelSkin: parsePanelSkin,
        normPanelFace: normFace,
        PANEL_SKIN_PORT_KINDS: PORT_KINDS
    };
});
