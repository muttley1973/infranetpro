// ============================================================
//  PRESENCE STORE — lo stato di presenza vive FUORI dal JSON di progetto
// ============================================================
//  Il problema. La Verifica misura chi c'è e chi non c'è e scrive `n.proof` su
//  ogni nodo, poi chiama `markDirty()`: da lì in poi quel risultato aspetta che
//  qualcuno prema Salva. Ma il salvataggio automatico è OFF di default, e il
//  monitoraggio automatico gira da solo ogni ora — così ogni misura veniva
//  buttata via al primo ricaricamento della pagina, e un apparato spento tornava
//  verde perché il file su disco raccontava l'ultima volta che si era salvato.
//
//  ⚠️ IL PUNTO: `n.proof` non è una MODIFICA al documento, è una MISURA. Il
//  documento lo scrive l'utente (dove sta un apparato, come si chiama, com'è
//  cablato); la presenza la scrive la rete. Trattarla come un edit da confermare
//  a mano significa perderla — ed è la stessa ragione per cui lo storico delle
//  Verifiche vive già fuori dal `<id>.json`. La presenza segue quella strada.
//
//  Qui c'è solo la parte PURA (sanificazione + fusione): il file lo scrive
//  server/history-store-fs.js, accanto alla timeline dello stesso progetto.
//  UMD-lite: <script> nel browser + require() in Node/test.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Gli stati che lib/proof.js sa produrre. Whitelist: dal client arriva JSON, e
  // uno stato inventato dipingerebbe il pavimento con un colore che non esiste.
  const STATUSES = ['declared', 'proven', 'absent', 'unverified', 'stale', 'diverged'];
  const METHODS = ['snmp', 'ping', 'arp', 'tcp'];
  const MAX_ENTRIES = 5000;   // ben oltre il tetto di prodotto (~500 apparati)

  function _iso(v) {
    const s = String(v == null ? '' : v);
    return Number.isFinite(Date.parse(s)) ? s : null;
  }
  function _ms(v) { const t = Date.parse(String(v == null ? '' : v)); return Number.isFinite(t) ? t : 0; }

  // Un solo record di presenza, ripulito. Ritorna null se non c'è niente di buono
  // da tenere: meglio nessuna voce che una voce inventata (paletto ②).
  function sanitizeProof(proof) {
    if (!proof || typeof proof !== 'object') return null;
    const status = STATUSES.indexOf(String(proof.status)) >= 0 ? String(proof.status) : null;
    if (!status) return null;
    const out = { status };
    const provenAt = _iso(proof.lastProvenAt);
    const checkedAt = _iso(proof.lastCheckedAt);
    if (provenAt) out.lastProvenAt = provenAt;
    if (checkedAt) out.lastCheckedAt = checkedAt;
    if (METHODS.indexOf(String(proof.method)) >= 0) out.method = String(proof.method);
    // «assente» non esiste senza la prova che lo sostiene: il flag non si eredita
    // da uno stato diverso, e senza flag l'assenza non si conserva.
    if (proof.absentEvidence === true) out.absentEvidence = true;
    if (status === 'absent' && out.absentEvidence !== true) return null;
    return out;
  }

  // Mappa nodeId → proof, ripulita e cappata. Accetta sia { nodes: {...} } sia la
  // mappa nuda, così il payload del client può crescere senza rompere il formato.
  function sanitizePresence(payload) {
    const src = (payload && typeof payload === 'object')
      ? (payload.nodes && typeof payload.nodes === 'object' ? payload.nodes : payload)
      : null;
    const nodes = {};
    if (!src) return { nodes };
    let n = 0;
    for (const id of Object.keys(src)) {
      if (n >= MAX_ENTRIES) break;
      const key = String(id).trim();
      if (!key || key.length > 128) continue;
      const proof = sanitizeProof(src[id]);
      if (!proof) continue;
      nodes[key] = proof;
      n++;
    }
    return { nodes };
  }

  // Applica la presenza salvata allo stato, IN PLACE. Regola unica: vince la
  // misura più FRESCA. Se il documento porta già un `proof` controllato dopo
  // quello del sidecar (è successo un Salva più recente, o un'altra scheda ha
  // misurato dopo), il documento resta — non si torna indietro nel tempo.
  function mergePresence(state, presence) {
    const nodes = (state && Array.isArray(state.nodes)) ? state.nodes : [];
    const src = (presence && presence.nodes && typeof presence.nodes === 'object') ? presence.nodes : null;
    const result = { applied: 0, skipped: 0 };
    if (!src || !nodes.length) return result;
    for (const node of nodes) {
      if (!node || node.id == null) continue;
      const incoming = src[String(node.id)];
      if (!incoming) continue;
      const mine = _ms(node.proof && node.proof.lastCheckedAt);
      const theirs = _ms(incoming.lastCheckedAt);
      // A parità di istante vince il sidecar: è l'ultimo che ha scritto.
      if (mine > theirs) { result.skipped++; continue; }
      node.proof = Object.assign({}, incoming);
      result.applied++;
    }
    return result;
  }

  // Estrae dallo stato ciò che va salvato: solo i nodi che hanno un proof buono.
  function collectPresence(state) {
    const nodes = (state && Array.isArray(state.nodes)) ? state.nodes : [];
    const out = {};
    for (const node of nodes) {
      if (!node || node.id == null) continue;
      const proof = sanitizeProof(node.proof);
      if (proof) out[String(node.id)] = proof;
    }
    return { nodes: out };
  }

  return { sanitizeProof, sanitizePresence, mergePresence, collectPresence, PRESENCE_STATUSES: STATUSES };
});
