'use strict';
// ============================================================
// Fixture SINTETICA: il poll di uno switch Cisco con DUE Port-channel (nessun dato di rete reale)
// ============================================================
// La FORMA e' quella misurata sul banco (vIOS, 24/09/2026): il Port-channel e' ifType 53, i membri
// stanno in ifStackTable, e i MEMBRI non sono porte del bridge — lo e' l'aggregatore (e' lui l'unica
// porta che lo spanning-tree vede). I numeri (ifIndex, MAC, costi) sono inventati e lo dicono: una
// prova costruita non e' una cattura, e nessun test che la usa va letto come «provato sull'apparato».
//
//   ifIndex 2, 3   Gi0/1, Gi0/2   membri di Port-channel1 (ifIndex 11)
//   ifIndex 4      Gi0/3          porta radice, fuori da ogni LAG
//   ifIndex 5, 6   Gi0/4, Gi0/5   membri di Port-channel2 (ifIndex 12)
//   bridge-port    1→4 (Gi0/3, radice) · 2→11 (Po1) · 3→12 (Po2)
//
// `po1State` / `po2State` = lo stato STP (RFC 4188) letto per l'aggregatore: 5 forwarding · 2 blocking · 6 broken.
const { OID } = require('../../drivers/snmp.js')._internals;

const B = (s) => Buffer.from(s, 'utf8');
const mac = (s) => Buffer.from(s.replace(/[^0-9a-f]/gi, ''), 'hex');
const u32 = (n) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const bridgeId = (prio, m) => Buffer.concat([Buffer.from([(prio >> 8) & 255, prio & 255]), mac(m)]);
const P = OID.dot1dStp;
const sc = (n) => `${P}.${n}.0`;
const col = (c, bp) => `${P}.15.1.${c}.${bp}`;

/** I varbind di un poll con la radice altrove (non radice), porta radice Gi0/3, due aggregati. */
function ciscoPoll({ name = 'SW-SYN', po1State = 5, po2State = 5, oper = 1 } = {}) {
  const v = { [`${OID.sysName}.0`]: B(name) };
  const iface = (ix, nm, type, m) => {
    v[`${OID.ifDescr}.${ix}`] = B(nm);
    v[`${OID.ifType}.${ix}`] = type;
    v[`${OID.ifPhysAddress}.${ix}`] = mac(m);
    if (oper !== null) v[`${OID.ifOperStatus}.${ix}`] = u32(oper);
  };
  iface(2, 'GigabitEthernet0/1', 6, '02:00:00:00:00:02');
  iface(3, 'GigabitEthernet0/2', 6, '02:00:00:00:00:03');
  iface(4, 'GigabitEthernet0/3', 6, '02:00:00:00:00:04');
  iface(5, 'GigabitEthernet0/4', 6, '02:00:00:00:00:05');
  iface(6, 'GigabitEthernet0/5', 6, '02:00:00:00:00:06');
  iface(11, 'Port-channel1', 53, '02:00:00:00:00:0b');
  iface(12, 'Port-channel2', 53, '02:00:00:00:00:0c');
  // appartenenza (ifStackTable): aggregatore.membro
  v[`${OID.ifStackStatus}.11.2`] = 1; v[`${OID.ifStackStatus}.11.3`] = 1;
  v[`${OID.ifStackStatus}.12.5`] = 1; v[`${OID.ifStackStatus}.12.6`] = 1;
  // bridge-port → ifIndex: SOLO la radice e i due aggregati (i membri non sono porte del bridge)
  v[`${OID.bridgePortIf}.1`] = u32(4); v[`${OID.bridgePortIf}.2`] = u32(11); v[`${OID.bridgePortIf}.3`] = u32(12);
  // STP: non radice, costo 4, porta radice = bridge-port 1; timer positivi (un bridge che esegue lo STP li ha)
  v[sc(5)] = bridgeId(0x8001, '02:ff:ff:ff:ff:01'); v[sc(6)] = 4; v[sc(7)] = 1; v[sc(4)] = 1;
  v[sc(8)] = 2000; v[sc(9)] = 200; v[sc(11)] = 1500;
  // tabella porte: colonna 1 (porta), 2 (priorita'), 3 (STATO) per ognuna delle tre
  const stati = { 1: 5, 2: po1State, 3: po2State };
  for (const bp of [1, 2, 3]) { v[col(1, bp)] = bp; v[col(2, bp)] = 128; v[col(3, bp)] = stati[bp]; }
  return v;
}

module.exports = { ciscoPoll, col, sc, bridgeId, mac, u32 };
