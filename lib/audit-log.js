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
    'project-create': 'Project created',
    'project-rename': 'Project renamed',
  };

  const AUDIT_CAP_DEFAULT = 1000;

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
  };
});
