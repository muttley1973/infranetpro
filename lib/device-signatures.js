'use strict';
// ============================================================
//  lib/device-signatures.js — firme device CANONICHE, condivise (PURO, UMD-lite).
//
//  UNICA fonte delle tabelle di riconoscimento, per eliminare il DRIFT fra i
//  classificatori (server FusionScorer + legacy, client _guessType + sanitize):
//  finche' ognuno aveva la propria copia, le tabelle divergevano (es. il client
//  aveva l'OID Lexmark 641 e i VoIP Grandstream/Yealink che il server NON aveva).
//
//  B1: tabella OID->tipo (prefissi sysObjectID sotto 1.3.6.1.4.1.<PEN>).
//  Le fette successive (vendor-regex, PEN->vendor) si aggiungono qui.
//
//  Convenzione punti = quella storica del FusionScorer (device specifici 95,
//  ups 85, hypervisor/voip 90, switch 70, router 60): i consumatori "a somma"
//  (fusion/legacy) sommano tutti i voti che matchano; quelli "first-match"
//  (client) usano oidType() = il tipo col punteggio piu' alto.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node (server + test)
  if (typeof window !== 'undefined') Object.assign(window, api);             // browser (client)
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Prefissi sysObjectID -> tipo device, con punteggio. Ordine non significativo:
  // i consumatori "a somma" votano TUTTI i prefissi che matchano (es. un APC rPDU
  // sotto 318.1.1.12 prende pdu 95 E ups 85 -> pdu vince). PEN = il numero dopo
  // 1.3.6.1.4.1. Canonico = unione delle 3 copie storiche (server + client),
  // con le voci che al server MANCAVANO marcate. Nessuna voce e' stata rimossa.
  const OID_TYPE_VOTES = [
    // printer (95)
    { prefix: '1.3.6.1.4.1.11.2.3.9', type: 'printer', points: 95 }, // HP JetDirect
    { prefix: '1.3.6.1.4.1.1248.',    type: 'printer', points: 95 }, // Epson
    { prefix: '1.3.6.1.4.1.1602.',    type: 'printer', points: 95 }, // Canon
    { prefix: '1.3.6.1.4.1.367.',     type: 'printer', points: 95 }, // Ricoh
    { prefix: '1.3.6.1.4.1.253.',     type: 'printer', points: 95 }, // Xerox
    { prefix: '1.3.6.1.4.1.1347.',    type: 'printer', points: 95 }, // Kyocera
    { prefix: '1.3.6.1.4.1.2435.',    type: 'printer', points: 95 }, // Brother
    { prefix: '1.3.6.1.4.1.18334.',   type: 'printer', points: 95 }, // Konica Minolta
    { prefix: '1.3.6.1.4.1.641.',     type: 'printer', points: 95 }, // Lexmark  (MANCAVA al server)
    // webcam (95)
    { prefix: '1.3.6.1.4.1.39165.',   type: 'webcam',  points: 95 }, // Hikvision
    { prefix: '1.3.6.1.4.1.368.',     type: 'webcam',  points: 95 }, // Axis
    // nas (95)
    { prefix: '1.3.6.1.4.1.6574.',    type: 'nas',     points: 95 }, // Synology
    { prefix: '1.3.6.1.4.1.24681.',   type: 'nas',     points: 95 }, // QNAP
    // ap (95)
    { prefix: '1.3.6.1.4.1.41112.1.4.', type: 'ap',    points: 95 }, // Ubiquiti UniFi AP
    { prefix: '1.3.6.1.4.1.14179.',   type: 'ap',      points: 95 }, // Cisco Aironet
    { prefix: '1.3.6.1.4.1.25053.',   type: 'ap',      points: 95 }, // Ruckus
    // pdu (95) — piu' specifico di ups sotto lo stesso PEN 318
    { prefix: '1.3.6.1.4.1.13742.',   type: 'pdu',     points: 95 }, // Raritan
    { prefix: '1.3.6.1.4.1.318.1.1.12.', type: 'pdu',  points: 95 }, // APC rPDU
    // ups (85)
    { prefix: '1.3.6.1.4.1.318.',     type: 'ups',     points: 85 }, // APC (generico)
    { prefix: '1.3.6.1.4.1.534.',     type: 'ups',     points: 85 }, // Eaton
    // firewall (95)
    { prefix: '1.3.6.1.4.1.12356.',   type: 'firewall',points: 95 }, // Fortinet
    { prefix: '1.3.6.1.4.1.25461.',   type: 'firewall',points: 95 }, // Palo Alto
    // voip (90) — MANCAVANO ENTRAMBI al server (aveva solo il vendor PEN)
    { prefix: '1.3.6.1.4.1.37049.',   type: 'voip',    points: 90 }, // Yealink
    { prefix: '1.3.6.1.4.1.25858.',   type: 'voip',    points: 90 }, // Grandstream
    // router (60)
    { prefix: '1.3.6.1.4.1.14988.',   type: 'router',  points: 60 }, // MikroTik
    { prefix: '1.3.6.1.4.1.11863.',   type: 'router',  points: 60 }, // TP-Link
    { prefix: '1.3.6.1.4.1.4526.',    type: 'router',  points: 60 }, // Netgear
    { prefix: '1.3.6.1.4.1.171.',     type: 'router',  points: 60 }, // D-Link
    // switch (70)
    { prefix: '1.3.6.1.4.1.14823.',   type: 'switch',  points: 70 }, // Aruba
    { prefix: '1.3.6.1.4.1.1916.',    type: 'switch',  points: 70 }, // Extreme
    { prefix: '1.3.6.1.4.1.1588.',    type: 'switch',  points: 70 }, // Brocade
    // hypervisor (90)
    { prefix: '1.3.6.1.4.1.6876.',    type: 'hypervisor', points: 90 }, // VMware
  ];

  // Tutti i voti tipo/punti per un sysObjectID (per i classificatori "a somma").
  function oidTypeVotes(objectId) {
    const oid = String(objectId || '').trim();
    if (!oid) return [];
    const out = [];
    for (const v of OID_TYPE_VOTES) {
      if (oid.startsWith(v.prefix)) out.push({ type: v.type, points: v.points });
    }
    return out;
  }

  // Tipo migliore (punteggio piu' alto) per un sysObjectID, o '' (per il client
  // "first-match"). A parita' di punti vince la voce che compare prima.
  function oidType(objectId) {
    let best = null;
    for (const v of oidTypeVotes(objectId)) {
      if (!best || v.points > best.points) best = v;
    }
    return best ? best.type : '';
  }

  // Il sysObjectID matcha un prefisso del tipo dato? Per i consumatori
  // "first-match a posizione" (client _guessType) che vogliono chiedere, in un
  // preciso punto di priorita', "questo OID e' un <type>?" senza reintrodurre la
  // lista di prefissi a mano.
  function oidIsType(objectId, type) {
    const oid = String(objectId || '').trim();
    if (!oid || !type) return false;
    return OID_TYPE_VOTES.some(v => v.type === type && oid.startsWith(v.prefix));
  }

  return { OID_TYPE_VOTES, oidTypeVotes, oidType, oidIsType };
});
