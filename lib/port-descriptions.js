// ============================================================
// PORT DESCRIPTIONS — quante porte portano una descrizione nel formato
// «presa | testo», e da dove viene quel testo.
// ============================================================
// È il PRIMO passo del disegno «la descrizione della porta è una dichiarazione»
// (STATO_PIANO, gruppo A): prima si MISURA se la convenzione si usa, poi si
// confronta col documento, poi si adotta. Questo modulo è solo la misura.
//
// ⚠️ NON dice che una porta «dichiara una presa»: quello vuol dire che il primo
// segmento combacia con una presa che ESISTE nel progetto, ed è il passo dopo
// (il confronto, per chiave). Qui si conta un fatto più piccolo e verificabile:
// il testo ha la forma `presa | testo libero`. L'etichetta di chi lo mostra deve
// dire quello — «nel formato», non «con una presa».
//
// ── Da dove viene il testo di una porta (manual-first) ──────────────────────
//   `desc`  l'ha scritto una persona nel documento  → source 'declared'
//   `alias` l'ha letto lo SNMP (ifAlias)            → source 'measured'
// Il dichiarato vince sempre sul misurato, e non si fondono: una porta con tutti
// e due conta UNA volta, come dichiarata. `alias` non si copia mai in `desc`.
//
// ── Un alias NON è sempre una descrizione ───────────────────────────────────
// Misurato sul banco il 03/10/2026 (7 apparati, handoff §123): alcuni agenti
// riempiono `ifAlias` da soli. VyOS (net-snmp) ci mette il nome dell'interfaccia
// (`eth0`, `lo`, `pim6reg@NONE`); EXOS un nome logico (`MgmtPort`); pfSense il
// nome dell'interfaccia (`WAN`). L'unico caso che si riconosce SENZA conoscere i
// vendor è il primo: l'alias UGUALE al nome dell'interfaccia (`ifName`) è il nome
// stesso, non una descrizione — è la stessa regola con cui `portTip`
// (src/app-ports.js) decide se usarlo come etichetta, e le due vanno tenute
// uguali. `MgmtPort` e `WAN` NON si riconoscono: non si indovina un nome «da
// agente» enumerando vendor. Contano come descrizioni ma, non avendo il
// separatore, non entrano nel formato — quindi non gonfiano il numero che conta.
//
// ── Il confronto con le prese del documento (primo esito) ───────────────────
// Se il chiamante passa le prese che il PROGETTO documenta (`opts.jacks`: una presa
// a muro, o la porta di un patch panel nel suo nome «pannello-numero»), ogni porta
// NEL formato riceve un esito: `known` (la presa esiste, una sola), `unknown` (non
// c'è nessuna presa con quel nome), `ambiguous` (ce n'è più d'una). Il confronto è
// per CHIAVE (`jackKey`), mai per stringa nuda: «PP1-14», «pp1 14» e «PP1.14» sono
// la stessa presa; «PP11-4» no, e rimuovere i separatori la farebbe collidere con
// «PP1-14». ⚠️ Se il progetto NON documenta nessuna presa l'esito non è «sconosciuta»
// per tutte: è NON VALUTABILE (`jackEvaluable: false`, esiti vuoti). Dire «sconosciuta»
// dove non si ha niente con cui confrontare sarebbe un'affermazione senza prova.
// Non dice che la presa sia quella GIUSTA per quella porta (serve la catena porta →
// bretella → pannello → tratta → presa): solo che esiste.
//
// ── Cosa NON assume sul testo (provato sul banco) ───────────────────────────
//   · lunghezza: Cisco/Arista lo troncano a 64, l'Aruba CX rifiuta oltre 64
//     (e `ifAlias` resta com'era), EXOS/VyOS/MikroTik lo restituiscono intero. Un
//     testo più lungo di 64 è valido e non è un errore; il troncamento taglia da
//     DESTRA, per questo la presa va prima del separatore.
//   · alfabeto: l'Aruba CX restituisce UTF-8 vero (`·`); non è solo ASCII.
//   · il separatore `|` è passato intatto su tutti e 7.
//
// PURO: nessun DOM, nessun IO, nessuna dipendenza. UMD-lite: require() in Node,
// global nel browser.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_SEPARATOR = '|';

  const _str = (v) => (v == null ? '' : String(v)).trim();

  // Il separatore lo DICHIARA chi chiama (oggi è sempre il predefinito: il campo
  // nelle impostazioni del progetto è il passo dopo). Un valore che non è una
  // stringa non vuota ricade sul predefinito invece di far tacere il conteggio.
  const _sep = (opts) => {
    const s = opts && typeof opts === 'object' && typeof opts.separator === 'string'
      ? opts.separator.trim() : '';
    return s || DEFAULT_SEPARATOR;
  };

  /**
   * La CHIAVE di una presa: il nome com'è scritto, ridotto a ciò che lo identifica.
   * Minuscolo, e ogni sequenza di spazi, trattini (anche – e —), underscore e punti
   * diventa UN trattino. Si tengono i separatori invece di toglierli, apposta:
   * «PP1-14» → `pp1-14` e «PP11-4» → `pp11-4` restano due prese, mentre togliendoli
   * entrambe diventerebbero `pp114`. Stringa vuota = niente da confrontare.
   */
  function jackKey(text) {
    const s = _str(text).normalize('NFC').toLowerCase();
    // Un ciclo e non un'espressione regolare: i trattini tipografici (U+2010..U+2015) in una
    // classe di caratteri non si leggono, e qui conta sapere ESATTAMENTE cosa è un separatore.
    let out = '';
    let pendingSep = false;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      const isSep = ch.trim() === '' || ch === '_' || ch === '.' || ch === '-' || (c >= 0x2010 && c <= 0x2015);
      if (isSep) { pendingSep = out !== ''; continue; }   // un separatore in testa non conta; in coda non si scrive mai
      if (pendingSep) { out += '-'; pendingSep = false; }
      out += ch;
    }
    return out;
  }

  // Indice chiave → prese col suo nome, dalla lista che passa il chiamante
  // ({ label, where }: il nome e dove sta). Le voci senza nome non entrano.
  function _jackIndex(jacks) {
    const idx = new Map();
    for (const j of (Array.isArray(jacks) ? jacks : [])) {
      if (!j || typeof j !== 'object') continue;
      const label = _str(j.label);
      const k = jackKey(label);
      if (!k) continue;
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push({ label, where: _str(j.where) });
    }
    return idx;
  }

  /**
   * Il testo che una porta porta, e da dove viene.
   *   { text, source }  con source:
   *     'declared'  `desc` scritto a mano (vince sempre)
   *     'measured'  `alias` letto dall'apparato
   *     'generated' `alias` uguale a `ifName`: è il NOME dell'interfaccia, non una
   *                 descrizione (text vuoto)
   *     'none'      niente da dire (text vuoto)
   */
  function portDescription(pi) {
    const p = (pi && typeof pi === 'object') ? pi : {};
    const desc = _str(p.desc);
    const alias = _str(p.alias);
    // Una descrizione UGUALE all'alias letto (e che non e' il nome dell'interfaccia) e' una COPIA del
    // dispositivo — l'ha adottata una lettura, non l'ha scritta una persona: l'origine resta «misurato».
    if (desc) return { text: desc, source: (desc === alias && alias !== _str(p.ifName)) ? 'measured' : 'declared' };
    if (!alias) return { text: '', source: 'none' };
    if (alias === _str(p.ifName)) return { text: '', source: 'generated' };
    return { text: alias, source: 'measured' };
  }

  /**
   * Il testo ha la forma `presa | testo libero`? `inFormat` è vero solo con il
   * separatore presente E un primo segmento non vuoto: «| 203» non ha una presa, e
   * «PP1-14» da solo non ha il separatore (è una descrizione valida, ma non si può
   * dire che segua la convenzione). Il testo dopo il separatore può essere vuoto
   * («PP1-14 |»): è tagliato, non sbagliato.
   * Il confronto è su `indexOf`, non su una regex: il separatore è dichiarato da
   * una persona e non deve poter diventare un'espressione.
   */
  function parsePortDescription(text, opts) {
    const s = _str(text);
    const sep = _sep(opts);
    const i = s.indexOf(sep);
    if (i < 0) return { inFormat: false, jack: '', note: '' };
    const jack = s.slice(0, i).trim();
    if (!jack) return { inFormat: false, jack: '', note: '' };
    return { inFormat: true, jack, note: s.slice(i + sep.length).trim() };
  }

  /**
   * Il conteggio, su una lista di apparati con le loro porte:
   *   devices = [ { id, name?, rackName?, ports: [ { pid, desc, alias, ifName } ] } ]
   * Il chiamante passa le porte che vuole CONTARE (la stessa popolazione del
   * report delle porte libere, così il numeratore e il totale a fianco parlano
   * delle stesse porte).
   *
   * OUTPUT
   *   ports      porte considerate
   *   described  porte con una descrizione (dichiarata o misurata, NON generata)
   *   inFormat   fra queste, nel formato `presa | testo`
   *   declared / measured   da dove viene il testo (somma = described)
   *   generated  porte il cui alias è il nome dell'interfaccia: NON descrizioni
   *   jackEvaluable / jackKnown / jackUnknown / jackAmbiguous  l'esito del confronto con le
   *              prese passate in `opts.jacks` (v. in testa); gli ultimi tre sommano alle porte nel formato
   *              SOLO se jackEvaluable
   *   items      le porte descritte: prima le FUORI formato, poi quelle nel formato con una presa
   *              sconosciuta o ambigua (sono quelle da guardare), poi le altre, nell'ordine di ingresso. Ogni voce dice
   *              DOVE sta: `device` e `rack` (se il chiamante li porta) e `port`,
   *              cioè il nome dell'interfaccia o, in mancanza, il numero del pid —
   *              una porta dichiarata a mano non ha sempre un ifName
   */
  function portDescriptionCensus(devices, opts) {
    const idx = _jackIndex(opts && opts.jacks);
    const evaluable = idx.size > 0;
    const out = { ports: 0, described: 0, inFormat: 0, declared: 0, measured: 0, generated: 0,
      jackEvaluable: evaluable, jackKnown: 0, jackUnknown: 0, jackAmbiguous: 0, items: [] };
    for (const d of (Array.isArray(devices) ? devices : [])) {
      if (!d || typeof d !== 'object') continue;
      for (const p of (Array.isArray(d.ports) ? d.ports : [])) {
        if (!p || typeof p !== 'object') continue;
        out.ports += 1;
        const r = portDescription(p);
        if (r.source === 'none') continue;
        if (r.source === 'generated') { out.generated += 1; continue; }
        out.described += 1;
        out[r.source] += 1;
        const f = parsePortDescription(r.text, opts);
        if (f.inFormat) out.inFormat += 1;
        // L'esito vale solo per le porte NEL formato (le altre non nominano una presa) e solo se
        // il progetto ne documenta almeno una; altrimenti resta vuoto: «non valutabile».
        let jackState = '', jackWhere = '';
        if (f.inFormat && evaluable) {
          const hit = idx.get(jackKey(f.jack)) || [];
          jackState = hit.length === 0 ? 'unknown' : (hit.length === 1 ? 'known' : 'ambiguous');
          jackWhere = hit.map((h) => h.where || h.label).join(' · ');
          out[jackState === 'known' ? 'jackKnown' : (jackState === 'unknown' ? 'jackUnknown' : 'jackAmbiguous')] += 1;
        }
        const ifName = _str(p.ifName);
        out.items.push({ id: d.id, device: _str(d.name) || _str(d.id), rack: _str(d.rackName), pid: p.pid,
          ifName, port: ifName || _str(p.pid).split('-').pop(), text: r.text, source: r.source,
          inFormat: f.inFormat, jack: f.jack, note: f.note, jackState, jackWhere });
      }
    }
    // Sort STABILE (engines >= 16): prima ciò che si guarda — le FUORI formato, poi le nel formato
    // con una presa sconosciuta o ambigua — e in coda il resto, nell'ordine di ingresso.
    const rank = (it) => (!it.inFormat ? 0 : ((it.jackState === 'unknown' || it.jackState === 'ambiguous') ? 1 : 2));
    out.items.sort((a, b) => rank(a) - rank(b));
    return out;
  }

  /**
   * La Descrizione che una porta deve avere DOPO una lettura SNMP: l'adozione AUTOMATICA.
   * Il testo che l'apparato dice (ifAlias) diventa la descrizione della porta nel documento, senza
   * che nessuno prema niente. Ritorna il testo da scrivere in `desc`, o `undefined` = non toccare.
   *
   *   port       la porta com'e' ora nel documento: { desc, ifName }
   *   prevAlias  l'alias che la lettura PRECEDENTE aveva memorizzato (quello che il documento
   *              ha eventualmente copiato)
   *   nextAlias  l'alias letto adesso
   *
   * Regole — l'automatismo non deve mai passare sopra a una persona:
   *   · una descrizione VUOTA si riempie col testo letto;
   *   · una descrizione UGUALE all'alias di prima e' una COPIA del dispositivo (l'ha adottata una
   *     lettura precedente): segue il dispositivo se questo cambia testo;
   *   · una descrizione DIVERSA dall'alias di prima l'ha scritta o modificata una persona: NON si
   *     tocca mai, nemmeno se il dispositivo dice altro;
   *   · un alias vuoto, o uguale al NOME dell'interfaccia (VyOS lo riempie da solo), non e' una
   *     descrizione: non si adotta;
   *   · una lettura che non porta l'alias NON cancella la descrizione: un walk troncato non e' un
   *     dispositivo che ha tolto il testo, e perdere una descrizione per un timeout sarebbe peggio
   *     di tenerne una vecchia.
   * Non scrive niente da se': decide, e il chiamante scrive.
   */
  function adoptedDescription(port, prevAlias, nextAlias) {
    const p = (port && typeof port === 'object') ? port : {};
    const next = _str(nextAlias);
    if (!next) return undefined;
    if (next === _str(p.ifName)) return undefined;
    const cur = _str(p.desc);
    if (cur === next) return undefined;
    if (!cur) return next;
    if (cur === _str(prevAlias)) return next;
    return undefined;
  }

  // Solo funzioni: l'UMD-lite copia tutto su `window` nel browser, e una costante
  // dal nome generico («DEFAULT_SEPARATOR») sarebbe un globale che nessuno ha chiesto.
  return { portDescription, parsePortDescription, portDescriptionCensus, jackKey, adoptedDescription };
});
