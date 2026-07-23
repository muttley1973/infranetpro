/* ============================================================
   InfraNet Pro — lib/node-label.js
   Come si LEGGE il nome di un dispositivo: parte leggibile + indirizzo.

   PERCHE' ESISTE
   L'import dello Scopri, quando non trova ne' un modello ne' un hostname
   utilizzabile, ricade sull'IP (`_discDisplayName`, app-discovery.js) — quindi
   `node.name` FINISCE PER ESSERE L'INDIRIZZO. Su una rete reale succede a circa
   meta' dei device, e la planimetria diventa un elenco di numeri: un dump, non
   documentazione.

   IL PALETTO
   La risposta NON e' scrivere un nome inventato dentro il documento: `node.name`
   e' un campo dichiarato dall'utente (manual-first) e nessun motore lo deve
   indovinare. Qui si deriva un'etichetta SOLO PER IL DISPLAY, a partire da cio'
   che e' gia' MISURATO — il tipo (dal classificatore) e il vendor (dall'OUI) —
   e l'indirizzo resta sempre visibile come seconda riga. Nel momento in cui
   l'utente scrive un nome vero, l'etichetta derivata sparisce da sola.

   PURA: nessun DOM, nessun i18n, nessun accesso a TYPES. Il nome del tipo
   arriva gia' localizzato dal chiamante (`typeName(n.type)`), cosi' la lib
   resta testabile e indipendente dalla lingua.
   ============================================================ */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) module.exports = factory();
    else Object.assign(root, factory());
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function _str(v) { return v == null ? '' : String(v).trim(); }

    // Vendor che NON sono vendor: segnaposto che l'OUI restituisce per i MAC
    // localmente amministrati / randomizzati (BYOD). Stamparli come marca
    // ("PC Private") inventerebbe un produttore inesistente — paletto ②.
    const PLACEHOLDER_VENDORS = new Set([
        'private', 'unknown', 'unassigned', 'reserved', 'randomized',
        'locally administered', 'n/a', 'na', '-'
    ]);
    // Il vendor arriva dal registro IEEE, cioe' dalla ragione sociale: "Cisco
    // Systems, Inc.", "Hangzhou Hikvision Digital Technology Co.,Ltd.". Su
    // un'etichetta serve la MARCA, non la societa'. Due regole, in quest'ordine:
    //  1) si tolgono i suffissi societari generici (vale per qualunque vendor);
    //  2) restano i casi che la regola generale non risolve, elencati sotto.
    // Si taglia SEMPRE dalla stringa originale, mai ricomponendola: "AzureWave",
    // "MikroTik", "LaCie" hanno maiuscole interne che una ri-capitalizzazione
    // distruggerebbe.
    const VENDOR_SUFFIX_RE = /^(inc|incorporated|corp|corporation|corporate|co|company|ltd|limited|llc|plc|gmbh|ag|sa|spa|srl|bv|nv|oy|ab|pty|technologies|technology|systems|electronics|communications|networks|solutions|international|intl|group|holdings|industries|wireless)$/i;
    const VENDOR_ALIASES = {
        'hewlett packard': 'HP', 'hewlett-packard': 'HP', 'hp inc': 'HP',
        'hewlett packard enterprise': 'HPE',
        'hangzhou hikvision digital': 'Hikvision',
        'zhejiang dahua': 'Dahua',
        'asustek computer': 'ASUS',
        'super micro computer': 'Supermicro',
        'raspberry pi trading': 'Raspberry Pi',
        'tp-link': 'TP-Link', 'd-link': 'D-Link',
    };

    function normalizeVendor(v) {
        const s = _str(v).replace(/[.,]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (!s) return '';
        const alias = x => VENDOR_ALIASES[x.toLowerCase()];
        if (alias(s)) return alias(s);
        const w = s.split(' ');
        // `> 1`: un vendor che si chiama solo "Systems" non deve sparire.
        while (w.length > 1 && VENDOR_SUFFIX_RE.test(w[w.length - 1])) w.pop();
        const out = w.join(' ');
        return alias(out) || out || s;
    }

    function _vendorOrEmpty(v) {
        const s = _str(v);
        return PLACEHOLDER_VENDORS.has(s.toLowerCase()) ? '' : normalizeVendor(s);
    }

    // I nomi-tipo del catalogo sono pensati per una tendina ("PC / Workstation",
    // "Webcam / CCTV", "NAS (desktop)", "ATS — Transfer Switch"): su un nodo di
    // planimetria largo 60px sfondano. Si tiene la prima alternativa, che e'
    // sempre quella principale. Il taglio e' MECCANICO: i tipi il cui nome e'
    // prosa senza separatore ("Dispositivo IoT") hanno una voce breve dedicata
    // e tradotta (`type.short.*`), che il chiamante passa gia' risolta.
    function _shortType(v) {
        return _str(v).split(/\s*[/(—–]/)[0].trim();
    }

    /**
     * Scompone l'etichetta di un nodo in parte leggibile + indirizzo.
     *
     * @param {object} node  nodo del progetto (name/ip/ip6/brand)
     * @param {object} [opts]
     * @param {string} [opts.typeName] nome del tipo GIA' localizzato (es. "Webcam")
     * @param {string} [opts.vendor]   vendor; default `node.brand` (dall'OUI)
     * @returns {{primary:string, secondary:string, derived:boolean}}
     *   `derived` = true quando la parte leggibile NON viene da un nome
     *   dichiarato ma e' stata composta qui (il chiamante puo' renderla piu'
     *   tenue, e non deve abbreviarla).
     */
    function nodeLabelParts(node, opts) {
        const o = opts || {};
        const name = _str(node && node.name);
        const ip = _str(node && node.ip);
        const ip6 = _str(node && node.ip6);
        const addr = ip || ip6;

        // Un nome vero vince sempre: e' il dato dichiarato.
        if (name && name !== ip && name !== ip6) {
            return { primary: name, secondary: addr, derived: false };
        }

        // Niente nome (o nome = indirizzo): componi dal misurato.
        // Tipo e marca sono due fatti distinti: il trattino li tiene leggibili
        // come un'unica etichetta ("IoT-AzureWave") senza sembrare un nome.
        const vendor = _vendorOrEmpty(o.vendor !== undefined ? o.vendor : (node && node.brand));
        const primary = [_shortType(o.typeName), vendor].filter(Boolean).join('-');

        // Nemmeno il tipo: meglio l'indirizzo da solo che una riga vuota.
        if (!primary) return { primary: addr || name, secondary: '', derived: false };

        return { primary, secondary: addr, derived: true };
    }

    return { nodeLabelParts, normalizeVendor };
}));
