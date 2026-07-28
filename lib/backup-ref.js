// ============================================================
// BACKUP-REF — validazione PURA del puntatore al backup di config
// ============================================================
// `node.backup.ref` è un PUNTATORE (path/URL/repo) a DOVE vive il backup della
// running-config, NON il config stesso: InfraNet resta un registro, non un deposito
// di config (che conterrebbe segreti). Questa validazione è la prima barriera di
// sicurezza dati sul valore che l'utente digita.
//
// 🔒 Regole (difesa in profondità — il valore finisce anche in un YAML Ansible):
//  - RIFIUTA credenziali embedded nell'URL (`scheme://user:pass@host`): un segreto
//    nel puntatore è un leak → save bloccato (reason 'credentials').
//  - RIFIUTA caratteri di controllo/newline (reason 'charset'): eviterebbero il
//    quoting quando l'AI cuce il valore nel playbook.
//  - Cap a 512 caratteri (reason 'tooLong').
//  - Vuoto è LECITO (cancellare il campo).
// Manual-first: non normalizza «furbo», si limita a trim + validazione.
//
// validateBackupRef(ref) -> { ok:boolean, reason:string, value:string }
//   value = il valore da salvare (trim). Su 'credentials' → '' (non si persiste il segreto).
// Funzione PURA. UMD-lite: <script> browser (validazione UI) + require() in Node/test.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_LEN = 512;
  // scheme://user:pass@…  → credenziali embedded (il ':' password è il segnale).
  const CRED_RE = /:\/\/[^/@\s]*:[^/@\s]*@/;

  // Caratteri di controllo (< 0x20, incl. \n \r \t) e DEL (0x7f). Niente regex-escape
  // per evitare mangling del sorgente: solo confronti numerici su charCodeAt.
  function _isCtrl(code) { return code < 0x20 || code === 0x7f; }
  function _hasCtrl(s) {
    for (let i = 0; i < s.length; i++) if (_isCtrl(s.charCodeAt(i))) return true;
    return false;
  }
  function _stripCtrl(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) if (!_isCtrl(s.charCodeAt(i))) out += s[i];
    return out;
  }

  function validateBackupRef(ref) {
    const value = String(ref == null ? '' : ref).trim();
    if (!value) return { ok: true, reason: '', value: '' };            // vuoto = cancella, lecito
    if (CRED_RE.test(value)) return { ok: false, reason: 'credentials', value: '' };  // 🔒 mai persistere un segreto
    if (_hasCtrl(value)) return { ok: false, reason: 'charset', value: _stripCtrl(value) };
    if (value.length > MAX_LEN) return { ok: false, reason: 'tooLong', value: value.slice(0, MAX_LEN) };
    return { ok: true, reason: '', value };
  }

  return { validateBackupRef, BACKUP_REF_MAX_LEN: MAX_LEN };
});
