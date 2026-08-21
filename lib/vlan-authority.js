// ============================================================
// VLAN-AUTHORITY — chi ha TITOLO per dire la VLAN di un cavo
// ============================================================
// La domanda sembra risolta dal tipo dell'apparato: switch, router, firewall e
// controller sono «attivi», quindi comandano. Ma «attivo» e' una proprieta' del
// TIPO — una nostra classificazione — e non dice affatto che quell'apparato stia
// assegnando VLAN. La domanda vera e' un'altra: **questo apparato COMMUTA VLAN?**
//
// Misurato sul banco il 2026-08-21: il controller wireless e lo switch EXOS
// dichiarano `vlan=1` sulla propria porta e hanno un mondo VLAN di `[1]`. Vuol
// dire che la loro interfaccia e' UNTAGGED — non che «sta in VLAN 1». Ma
// rispondono su 10.10.99.x, quindi vivono in VLAN 99, e quel «1» scavalcava la
// rete DICHIARATA: il cavo usciva VLAN 1 su una rete che dice 99.
//
// ⭐ Il discriminante e' gia' nel dato ed e' vendor-neutral: **un apparato il cui
// mondo VLAN e' `[1]` non sta commutando VLAN**, e non puo' essere autorevole su
// una VLAN che non conosce. Uno che ne conosce altre, quando dice «1», la sta
// scegliendo — e allora vale. Nessun elenco di vendor, nessun caso speciale per
// il banco: si guarda cio' che l'apparato stesso ha pubblicato.
//
// ⚠️ Stessa forma del difetto chiuso nella 2.10.1: un «1» che sembra una misura
// e misura un'altra cosa. Il paletto ② non e' «non scrivere valori falsi», e'
// «non trasformare un'assenza in un valore» — e «untagged» e' un'assenza.
//
// Questo modulo esiste perche' la risposta serve in DUE punti (il colore del
// cavo e la propagazione delle VLAN) e deve essere UNA: quando lo stesso
// concetto vive in due strati, i due divergono — e' la classe di bug piu'
// ricorrente del progetto.
// ============================================================
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** VLAN valida = intero 1..4094. Tutto il resto e' assenza, non zero. */
  function _v(x) {
    const n = parseInt(x, 10);
    return (Number.isFinite(n) && n >= 1 && n <= 4094) ? n : null;
  }

  /**
   * L'apparato COMMUTA VLAN? Si guarda il suo mondo VLAN misurato — le VLAN che
   * lui stesso ha nominato (PVID + egress + trunk, `node.integration.vlans`).
   * Se la' dentro c'e' qualcosa oltre la 1, sta facendo lavoro di VLAN.
   *
   * `[1]` NON conta: e' la VLAN che esiste anche quando nessuno ha configurato
   * niente. Un elenco vuoto o assente vuol dire che l'apparato non ha nominato
   * nessuna VLAN, e vale come `[1]`: nessuna prova di commutazione.
   *
   * @param {number[]|null|undefined} deviceVlans
   * @returns {boolean}
   */
  function switchesVlans(deviceVlans) {
    if (!Array.isArray(deviceVlans)) return false;
    return deviceVlans.some(v => { const n = _v(v); return n !== null && n !== 1; });
  }

  /**
   * La VLAN che questo capo dichiara CON TITOLO, o null se non ne ha.
   *
   * Tre gradini, e il terzo e' il difetto:
   *   1. capo passivo (patch panel, presa) → non parla mai: non ha VLAN propria
   *   2. override MANUALE → parla sempre, prima di ogni misura (manual-first:
   *      chi scrive un numero a mano sa cosa sta scrivendo)
   *   3. misura SNMP → vale se > 1 (nessuno dichiara una VLAN non di default per
   *      sbaglio) oppure se l'apparato commuta VLAN (allora anche «1» e' una
   *      scelta fra VLAN che conosce). Altrimenti e' solo «sono untagged», che
   *      non dice in quale VLAN lo switch di fronte lo abbia messo.
   *
   * @param {{active?:boolean, vlanOvr?:number, vlan?:number, deviceVlans?:number[]}} end
   * @returns {number|null}
   */
  function authoritativeVlan(end) {
    const e = end || {};
    if (!e.active) return null;
    const ovr = _v(e.vlanOvr);
    if (ovr) return ovr;
    const v = _v(e.vlan);
    if (!v) return null;
    if (v > 1) return v;
    return switchesVlans(e.deviceVlans) ? v : null;
  }

  /**
   * Questa porta INSTRADA? Cioe': sta fuori dal dominio di commutazione, e
   * quindi non appartiene a nessuna VLAN — nemmeno alla 1, che e' il default
   * dei soli port commutati.
   *
   * Due misure, e vanno pesate in modo DIVERSO perche' la prova e' asimmetrica:
   *   • `bridges === true` → l'apparato dichiara questa interfaccia come porta
   *     del bridge. E' un VETO: quella porta commuta, punto. Misurato sul banco:
   *     la NIC di un controller wireless possiede un indirizzo ED e' bridge-port
   *     con PVID 1 — prima usciva «instradata» per il solo fatto di avere un IP.
   *   • `bridges === false / assente` → NON prova che la porta non commuti. Il
   *     vIOS del banco pubblica la tabella per 2 porte su 8, e su un altro
   *     esemplare della stessa immagine per nessuna. Resta il possesso di un
   *     indirizzo come INDIZIO: e' quello che si usava prima, ma ora si sa che
   *     e' un indizio e non una prova.
   *
   * ⚠️ Il nome dei campi dice cio' che misurano: `ownsIp` («possiede un
   * indirizzo») e `bridges` («e' una porta del bridge»). Il vecchio `routed`
   * prometteva una conclusione e ne misurava una premessa — ed e' cosi' che una
   * NIC qualsiasi finiva per «instradare».
   *
   * @param {{ownsIp?:boolean, bridges?:boolean}} port
   * @returns {boolean}
   */
  function isRoutedPort(port) {
    const p = port || {};
    if (!p.ownsIp) return false;
    return p.bridges !== true;
  }

  return { switchesVlans, authoritativeVlan, isRoutedPort };
});
