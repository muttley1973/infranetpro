// ============================================================
// SNMPv3 (USM) — cosa il prodotto sa parlare, e come si legge una configurazione (UMD-lite)
// ============================================================
// UNICA definizione dei livelli di sicurezza, dei protocolli di autenticazione e di
// cifratura, dei loro valori predefiniti e della lettura di una configurazione.
// La usano il driver (drivers/snmp.js, per costruire la sessione) e i due pannelli
// (src/app-properties-node.js e src/app-properties-vm.js, per offrire le scelte).
// Prima erano tre elenchi scritti a mano, e divergevano: il driver ne sapeva sei per
// l'autenticazione e le select due, la mappa delle cifrature non aveva `aes256r`.
//
// `value` è ciò che sta nel progetto: NON si rinomina, i progetti salvati lo contengono.
// `key` è il nome della costante in net-snmp. test/snmp-v3-params.test.js lo confronta
// con ciò che net-snmp espone davvero: un aggiornamento che aggiunge un protocollo fa
// arrossire quella prova invece di restare muto fino a che un apparato non risponde.
//
// ⚠️ AES-256 non è standardizzato e ha DUE derivazioni della chiave (draft Blumenthal e
// draft Reeder). Con un'autenticazione CORTA (MD5, SHA-1, SHA-224) producono chiavi
// diverse e quella sbagliata si vede solo come «Request timed out»; con SHA-256 o più
// la chiave localizzata è già di 32 byte e le due COINCIDONO. Misurato su un agente
// locale (net-snmp 3.29.1). `AES256` resta Blumenthal, com'era: cambiargli significato
// romperebbe i progetti che lo hanno già scritto. AES-192 non c'è: net-snmp non lo
// espone, e questo elenco non dichiara ciò che il driver non può parlare.
//
// ⚠️ Un nome sconosciuto NON diventa un valore di ripiego. Prima `mappa[nome] ?? SHA` lo
// trasformava in SHA-1 senza dirlo: l'utente scriveva SHA-256, il driver parlava SHA-1 e
// l'unica cosa che si vedeva era un timeout. Un campo NON scritto, invece, prende il
// valore che l'interfaccia mostra già selezionato (V3_DEFAULTS): è dichiarato, non scelto
// in silenzio. E si valida solo ciò che il livello USA: una cifratura non si legge se il
// livello è authNoPriv.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const V3_LEVELS = ['noAuthNoPriv', 'authNoPriv', 'authPriv'];

  /** @type {{value: string, key: string, label: string}[]} */
  const V3_AUTH = [
    { value: 'MD5',    key: 'md5',    label: 'MD5' },
    { value: 'SHA',    key: 'sha',    label: 'SHA-1' },     // «SHA» storico = SHA-1
    { value: 'SHA224', key: 'sha224', label: 'SHA-224' },
    { value: 'SHA256', key: 'sha256', label: 'SHA-256' },
    { value: 'SHA384', key: 'sha384', label: 'SHA-384' },
    { value: 'SHA512', key: 'sha512', label: 'SHA-512' },
  ];

  /** @type {{value: string, key: string, label: string}[]} */
  const V3_PRIV = [
    { value: 'DES',     key: 'des',     label: 'DES' },
    { value: 'AES',     key: 'aes',     label: 'AES-128' },
    { value: 'AES256',  key: 'aes256b', label: 'AES-256 (Blumenthal)' },
    { value: 'AES256R', key: 'aes256r', label: 'AES-256 (Reeder)' },
  ];

  // Ciò che la select mostra già selezionato quando il campo non è scritto (i progetti
  // salvati senza questi campi, e le richieste che non li portano).
  const V3_DEFAULTS = { level: 'authPriv', auth: 'SHA', priv: 'AES' };

  const _LEVEL_ENTRIES = V3_LEVELS.map((value) => ({ value }));
  const _text = (v) => (v == null ? '' : String(v)).trim();

  function _read(cfg, field, list, def, what) {
    const s = _text(cfg[field]);
    if (s === '') return { ok: true, entry: list.find((o) => o.value === def) };
    const entry = list.find((o) => o.value.toLowerCase() === s.toLowerCase());
    if (entry) return { ok: true, entry };
    // Il valore scritto si riporta (è un nome di protocollo, non una credenziale), ma
    // tagliato: arriva dal corpo di una richiesta e può essere lungo quanto vuole.
    const shown = JSON.stringify(s.length > 40 ? s.slice(0, 40) + '…' : s);
    return { ok: false,
      error: `SNMPv3: ${what} non riconosciuto ${shown} (ammessi: ${list.map((o) => o.value).join(', ')})` };
  }

  /**
   * Legge i parametri USM di una configurazione (v3secLevel, v3authProto, v3privProto).
   * @param {object} cfg
   * @returns {{ok: true, level: string, auth: ({value: string, key: string}|null), priv: ({value: string, key: string}|null)}
   *          | {ok: false, error: string}}
   *   `auth`/`priv` sono null quando il livello non li usa.
   */
  function v3Params(cfg) {
    const c = cfg || {};
    const lv = _read(c, 'v3secLevel', _LEVEL_ENTRIES, V3_DEFAULTS.level, 'livello di sicurezza');
    if (!lv.ok) return lv;
    const level = lv.entry.value;
    let auth = null, priv = null;
    if (level !== 'noAuthNoPriv') {
      const a = _read(c, 'v3authProto', V3_AUTH, V3_DEFAULTS.auth, 'protocollo di autenticazione');
      if (!a.ok) return a;
      auth = a.entry;
    }
    if (level === 'authPriv') {
      const p = _read(c, 'v3privProto', V3_PRIV, V3_DEFAULTS.priv, 'protocollo di cifratura');
      if (!p.ok) return p;
      priv = p.entry;
    }
    return { ok: true, level, auth, priv };
  }

  return { V3_LEVELS, V3_AUTH, V3_PRIV, V3_DEFAULTS, v3Params };
});
