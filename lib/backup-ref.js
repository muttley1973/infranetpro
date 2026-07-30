// ============================================================
// BACKUP-REF — validazione PURA del puntatore al backup di config
// ============================================================
// `node.backup.ref` è un PUNTATORE (path/URL/repo) a DOVE vive il backup della
// running-config, NON il config stesso: InfraNet resta un registro, non un deposito
// di config (che conterrebbe segreti). Questa validazione è la prima barriera di
// sicurezza dati sul valore che l'utente digita.
//
// 🔒 Regole (difesa in profondità — il valore finisce anche in un YAML Ansible):
//  - RIFIUTA credenziali embedded, sia in forma URL (`scheme://user:pass@host`)
//    sia in forma scp/rsync senza schema (`user:pass@host:/path`): un segreto nel
//    puntatore è un leak → save bloccato (reason 'credentials').
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

  // Credenziali embedded: il segnale è `utente:segreto@host`, cioè un ':' che
  // precede una '@' senza che in mezzo ci sia un separatore di percorso.
  // Due FORME, perché una sola regex non le copre entrambe senza falsi positivi:
  //
  //  A) con schema  →  scheme://user:pass@host
  //     La password può contenere '/': è una URL malformata, ma un utente la
  //     digita lo stesso e resta un segreto. L'utente (prima dei ':') invece NON
  //     può, altrimenti `smb://server/share@2024` e `file:///C:/bk@2024/x`
  //     verrebbero letti come credenziali.
  //  B) senza schema → scp/rsync: user:pass@host:/path
  //     Ancorata all'inizio; il segreto non può iniziare per '/' (sarebbe lo
  //     schema di A: `smb://server/share@2024` non è una credenziale) né contenere
  //     backslash (un percorso Windows `C:\backup\admin@corp\x.cfg` nemmeno).
  //     `git@github.com:org/repo.git` (SSH senza password) NON matcha: non c'è
  //     ':' prima della '@' — ed è la forma legittima più usata.
  const CRED_SCHEME_RE = /(:\/\/)[^/@\s]+:[^@\s]*@/;
  const CRED_SCP_RE    = /^[A-Za-z0-9._-]+:(?:[^@\s\\/][^@\s\\]*)?@(?=[A-Za-z0-9.-]+[:/])/;
  function _hasCreds(s) { return CRED_SCHEME_RE.test(s) || CRED_SCP_RE.test(s); }

  // Toglie la parte credenziale e TIENE il resto: `https://u:p@git/r.git` →
  // `https://git/r.git`. Serve lato server e nei DTO, dove buttare via l'intero
  // puntatore perderebbe un dato utile dell'utente — mentre nella UI, dove sta
  // digitando, il salvataggio si blocca e glielo si dice.
  function stripRefCreds(ref) {
    const s = String(ref == null ? '' : ref).trim();
    if (!s) return '';
    return s.replace(CRED_SCHEME_RE, '$1').replace(CRED_SCP_RE, '');
  }

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
    if (_hasCreds(value)) return { ok: false, reason: 'credentials', value: '' };  // 🔒 mai persistere un segreto
    if (_hasCtrl(value)) return { ok: false, reason: 'charset', value: _stripCtrl(value) };
    if (value.length > MAX_LEN) return { ok: false, reason: 'tooLong', value: value.slice(0, MAX_LEN) };
    return { ok: true, reason: '', value };
  }

  return { validateBackupRef, stripRefCreds, BACKUP_REF_MAX_LEN: MAX_LEN };
});
