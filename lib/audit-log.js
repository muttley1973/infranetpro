// ============================================================
// AUDIT LOG — journal append-only "chi / quando / cosa" (N2)
// ============================================================
// Logica PURA del changelog di progetto: costruzione voci, cap della
// lista, formattazione leggibile, export CSV e filtri. Nessun accesso a
// DOM/state/global. La cattura degli eventi (logAudit) e la UI vivono
// nell'app. Condiviso browser + test (UMD-lite).
//
// ── Modello voce ─────────────────────────────────────────────────────
// entry = {
//   ts:      ISO string        // quando
//   user:    string            // chi (username, o 'sistema')
//   action:  string            // cosa (chiave fra ACTION_LABELS)
//   target:  string            // su cosa (nome/id leggibile, opzionale)
//   summary: string            // descrizione breve (opzionale)
// }
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ACTION_LABELS = {
    'device-add':     'Dispositivo aggiunto',
    'device-remove':  'Dispositivo rimosso',
    'device-rename':  'Dispositivo rinominato',
    'cable-add':      'Cavo creato',
    'cable-remove':   'Cavo rimosso',
    'vlan-change':    'VLAN porta modificata',
    'snmp-sync':      'Sync SNMP eseguito',
    'drift-apply':    'Documentazione allineata (drift)',
    'drift-ipchange':      'IP rinnovato (drift)',
    'drift-ipchange-auto': 'IP rinnovato auto (DHCP)',
    'vm-state-auto': 'Stato VM impostato dalla Verifica',
    'project-create': 'Progetto creato',
    'project-rename': 'Progetto rinominato',
  };

  // Traduzioni EN (stesse chiavi): usate dal report PDF quando lang='en'.
  const ACTION_LABELS_EN = {
    'device-add':     'Device added',
    'device-remove':  'Device removed',
    'device-rename':  'Device renamed',
    'cable-add':      'Cable created',
    'cable-remove':   'Cable removed',
    'vlan-change':    'Port VLAN changed',
    'snmp-sync':      'SNMP sync run',
    'drift-apply':    'Documentation aligned (drift)',
    'drift-ipchange':      'IP renewed (drift)',
    'drift-ipchange-auto': 'IP renewed auto (DHCP)',
    'vm-state-auto': 'VM state set by the Verify run',
    'project-create': 'Project created',
    'project-rename': 'Project renamed',
  };

  // ⚠️ UNICA definizione del tetto: chi appende NON passa un numero suo (lo
  // faceva src/app-history.js, e alzarlo qui non avrebbe cambiato niente —
  // famiglia [[definizioni-duplicate-motore-renderer]]).
  //
  // 10.000 e non 1.000 perché il giornale non sta più DENTRO il documento: da
  // 2.8.2 vive in `history/<id>/audit.json`, quindi la sua lunghezza non pesa
  // più sul progetto che l'utente apre e salva. Il tetto è un soffitto, non
  // un'allocazione: un giornale vero, oggi, sta sulle decine di voci. Serve a
  // impedire una crescita infinita, non a decidere quanta storia tenere — e
  // buttare via la storia di chi ha cambiato cosa è esattamente il contrario
  // di quello che serve a un documento di rete.
  const AUDIT_CAP_DEFAULT = 10000;

  function _str(x) { return (x == null) ? '' : String(x); }

  // Normalizza una voce: timestamp di default (ora), campi a stringa.
  function buildAuditEntry(e) {
    e = e || {};
    return {
      ts: e.ts || new Date().toISOString(),
      user: _str(e.user) || 'sistema',
      action: _str(e.action),
      target: _str(e.target),
      summary: _str(e.summary),
    };
  }

  // Append append-only con cap: aggiunge in coda e scarta le voci piu'
  // vecchie oltre `cap`. Opera sull'array passato (lo ritorna).
  function appendAudit(log, entry, cap) {
    if (!Array.isArray(log)) log = [];
    cap = Number.isFinite(cap) && cap > 0 ? cap : AUDIT_CAP_DEFAULT;
    log.push(buildAuditEntry(entry));
    if (log.length > cap) log.splice(0, log.length - cap);
    return log;
  }

  // ── Il giornale vive FUORI dal documento ────────────────────────────
  // ⚠️ A differenza di presenza e osservazioni, questo NON è una misura: è la
  // storia del documento, «chi ha cambiato cosa e quando». Sta comunque fuori dal
  // `<id>.json` per la stessa ragione della timeline — è un GIORNALE, cresce da
  // solo, e il codice lo trattava già da non-documento (escluso da undo e dagli
  // snapshot). Vive in `history/<id>/audit.json`.
  //
  // ⚠️ E per la stessa ragione la regola di fusione è DIVERSA: qui non vince la
  // misura più fresca né la storia più larga — si fa l'UNIONE, senza perdere una
  // voce e senza duplicarne nessuna. L'identità è il record intero: risalvare lo
  // stesso stato due volte non deve raddoppiare il giornale.
  function _auditKey(e) {
    return [e && e.ts, e && e.user, e && e.action, e && e.target, e && e.summary]
      .map(v => String(v == null ? '' : v)).join('\u0000');
  }

  function foldAudit(base, incoming, cap) {
    cap = Number.isFinite(cap) && cap > 0 ? cap : AUDIT_CAP_DEFAULT;
    const seen = new Set();
    const out = [];
    for (const src of [base, incoming]) {
      const list = Array.isArray(src) ? src : (src && Array.isArray(src.entries) ? src.entries : []);
      for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        const e = buildAuditEntry(raw);
        if (!e.action) continue;                 // una voce senza azione non dice niente
        const k = _auditKey(e);
        if (seen.has(k)) continue;
        seen.add(k); out.push(e);
      }
    }
    // Ordine cronologico: entrambe le liste arrivano già in ordine, e il sort di
    // JS è stabile → a parità di istante l'ordine d'inserimento non si perde.
    out.sort((a, b) => (Date.parse(a.ts) || 0) - (Date.parse(b.ts) || 0));
    if (out.length > cap) out.splice(0, out.length - cap);   // si tengono le più RECENTI
    return { entries: out };
  }

  // ── Le voci dei GIRI si salvano SUBITO, le altre col documento ────────
  // Una voce di giornale normalmente arriva su disco quando il progetto viene SALVATO: la
  // scrive `foldAudit` dentro il PUT del progetto. Va bene per ciò che una persona ha fatto
  // («ho aggiunto un cavo»): la voce e la modifica viaggiano insieme. NON va bene per il giro
  // del monitoraggio automatico, che nessuno salva: con l'autosave spento (il default) le sue
  // righe vivevano nella memoria della pagina e morivano al primo ricaricamento, mentre la
  // timeline delle Verifiche — che il server scrive per conto suo — andava avanti. Risultato:
  // la scheda Modifiche si fermava al giorno dell'ultimo Salva, e l'ultima riga visibile era
  // un Sync vecchio di nove giorni che diceva «tutti raggiungibili».
  //
  // Un GIRO è la registrazione di una lettura che è AVVENUTA, indipendentemente dal fatto che
  // qualcuno salvi il progetto: per questo — e solo per questo — la sua voce va sul disco da
  // sola, come la presenza. Le voci che descrivono una MODIFICA al documento (un cavo, un IP
  // rinnovato) restano legate al Salva: una riga «IP rinnovato» su disco, con l'IP nuovo mai
  // salvato, racconterebbe una cosa che il documento non dice.
  //
  // L'elenco è UNO: lo legge il server per decidere cosa accettare da quella rotta. Nessuna
  // fusione speciale: `foldAudit` è già un'unione senza duplicati, quindi la stessa voce che
  // più tardi arriva col Salva non raddoppia.
  const RUN_ACTIONS = ['snmp-sync'];

  function isRunAction(action) { return RUN_ACTIONS.indexOf(_str(action)) !== -1; }

  // Quante voci per richiesta e quanto lunghi i campi: un giro ne produce una, e la rotta
  // non deve poter gonfiare il giornale. (Il PUT del progetto accetta già tutto da un admin:
  // qui non si allarga la fiducia, si tiene stretta la porta.)
  const RUN_BATCH_MAX = 50;
  const RUN_FIELD_MAX = 400;

  // Dal corpo di una richiesta alle sole voci di giro, normalizzate. Puro.
  function sanitizeRunEntries(raw) {
    const list = Array.isArray(raw) ? raw.slice(0, RUN_BATCH_MAX) : [];
    const out = [];
    for (const r of list) {
      if (!r || typeof r !== 'object' || !isRunAction(r.action)) continue;
      const e = buildAuditEntry(r);
      const ts = String(e.ts);
      out.push({
        // Il `ts` resta quello del client: e' parte dell'identita' della voce, e il Salva che
        // arriva dopo porta la STESSA voce — un ts rifatto qui la raddoppierebbe.
        ts: Number.isFinite(Date.parse(ts)) ? ts : new Date().toISOString(),
        user: e.user.slice(0, RUN_FIELD_MAX),
        action: e.action,
        target: e.target.slice(0, RUN_FIELD_MAX),
        summary: e.summary.slice(0, RUN_FIELD_MAX),
      });
    }
    return out;
  }

  // Toglie il giornale dallo stato che sta per essere scritto sul disco.
  function stripAudit(state) {
    if (!state || typeof state !== 'object') return 0;
    const n = Array.isArray(state.auditLog) ? state.auditLog.length : 0;
    delete state.auditLog;
    return n;
  }

  // Rimette il giornale nello stato, IN PLACE (unito a quello che lo stato già
  // porta: i progetti scritti prima se lo trascinano dentro).
  function mergeAudit(state, saved, cap) {
    if (!state || typeof state !== 'object') return 0;
    state.auditLog = foldAudit(saved, state.auditLog, cap).entries;
    return state.auditLog.length;
  }

  // Etichetta leggibile di un'azione. `lang` opzionale ('en' → tabella EN);
  // default IT (retrocompat: i chiamanti esistenti non passano lang).
  function auditActionLabel(action, lang) {
    const map = (lang === 'en') ? ACTION_LABELS_EN : ACTION_LABELS;
    return map[action] || action || (lang === 'en' ? 'Change' : 'Modifica');
  }

  // Riga leggibile: "12/06/2026, 10:30 · mario · Dispositivo aggiunto «Core-01»".
  function formatAuditLine(entry, locale) {
    const e = buildAuditEntry(entry);
    let when = e.ts;
    try { when = new Date(e.ts).toLocaleString(locale || 'it-IT'); } catch (_) { /* tieni ISO */ }
    let s = `${when} · ${e.user} · ${auditActionLabel(e.action)}`;
    if (e.target) s += ` «${e.target}»`;
    if (e.summary) s += ` — ${e.summary}`;
    return s;
  }

  // Filtro: per target (substring case-insensitive), action, e da una data ISO.
  function filterAudit(log, opts) {
    if (!Array.isArray(log)) return [];
    opts = opts || {};
    const t = opts.target ? String(opts.target).toLowerCase() : null;
    const a = opts.action || null;
    const since = opts.since ? Date.parse(opts.since) : null;
    return log.filter(e => {
      if (a && e.action !== a) return false;
      if (t && !String(e.target || '').toLowerCase().includes(t)) return false;
      if (since != null && !Number.isNaN(since) && Date.parse(e.ts) < since) return false;
      return true;
    });
  }

  // Export CSV (BOM UTF-8 + CRLF, escaping RFC 4180). Colonne fisse.
  function auditToCsv(log) {
    const rows = Array.isArray(log) ? log : [];
    const esc = v => {
      const s = _str(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ['data_ora', 'utente', 'azione', 'oggetto', 'dettaglio'];
    const lines = [head.join(',')];
    for (const e0 of rows) {
      const e = buildAuditEntry(e0);
      lines.push([e.ts, e.user, auditActionLabel(e.action), e.target, e.summary].map(esc).join(','));
    }
    return '﻿' + lines.join('\r\n');
  }

  return {
    ACTION_LABELS, ACTION_LABELS_EN, AUDIT_CAP_DEFAULT,
    buildAuditEntry, appendAudit, auditActionLabel,
    formatAuditLine, filterAudit, auditToCsv,
    foldAudit, stripAudit, mergeAudit,
    RUN_ACTIONS, isRunAction, sanitizeRunEntries,
  };
});
