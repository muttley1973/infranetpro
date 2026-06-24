// ============================================================
// NAME-ABBREV — abbreviazione PURA dei nomi device per il display.
//
// Sostituisce la PRIMA parola del nome (la "parola-tipo", es. PRINTER, ROUTER)
// con una sigla breve (PRN, RTR) per ridurre l'ingombro in planimetria ed
// etichette. È una trasformazione di SOLO DISPLAY: non muta i dati (n.name resta
// intero). Se la parola iniziale non è una sigla nota, ritorna il nome invariato
// (graceful: i nomi liberi/Italiani non vengono toccati).
//
// Attivazione lato app via il flag state.abbrevNames (toggle "Nomi abbreviati").
// Qui la funzione abbrevia SEMPRE: il gating sul flag lo fa il chiamante.
//   abbreviateName('BADGEREADER-P01') → 'BDG-P01'
//   abbreviateName('ACC-SW-P2')       → 'ACC-SW-P2'  (ACC non è un tipo)
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Parola-tipo (come compare nei nomi, MAIUSCOLA) → sigla breve.
  // Solo i tipi con nome lungo: AP/PC/TV/NAS/UPS/PDU/ATS/KVM/PBX/NVR sono già corti.
  const NAME_ABBREV = {
    PRINTER: 'PRN', PROJECTOR: 'PRJ', BADGEREADER: 'BDG',
    WEBCAM: 'CAM', CAMERA: 'CAM', DOORCTRL: 'DOOR', DOOR: 'DOOR',
    VOIP: 'TEL', PHONE: 'TEL',
    ROUTER: 'RTR', SWITCH: 'SW', FIREWALL: 'FW', SERVER: 'SRV',
    WORKSTATION: 'WS', CONSOLE: 'CON', CONSOLESVR: 'CON', WLANCTRL: 'WLC',
    MEDIACONV: 'MC', PATCHPANEL: 'PP', PANELBOARD: 'QEL', HYPERVISOR: 'HV',
  };

  // Sostituisce la prima parola alfabetica iniziale se è un tipo noto.
  // \p sarebbe più pulito ma teniamo la compatibilità: [A-Za-z] + accenti latini.
  function abbreviateName(name) {
    const s = String(name == null ? '' : name);
    return s.replace(/^[A-Za-zÀ-ÿ]+/, m => NAME_ABBREV[m.toUpperCase()] || m);
  }

  return { abbreviateName, NAME_ABBREV };
});
