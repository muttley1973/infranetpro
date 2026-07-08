'use strict';

// Arista Networks sysObjectID plugin (PEN 1.3.6.1.4.1.30065). Arista builds
// data-center SWITCHES (EOS on DCS / vEOS / CCS platforms); a few high-end models
// can also route. Like plugins/cisco.js, the type is inferred from the device's
// MEASURED sysServices OSI layers, NOT from the vendor name alone: a device that
// bridges (L2 set) is a multilayer switch; a device that is pure L3 (no L2) is a
// router. This is the same sysObjectID-recognition layer used for every other major
// network vendor — not an OUI/vendor-default guess.

const vendorPrefix = '1.3.6.1.4.1.30065';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const svc = parseInt(context.sysServices || 0, 10) || 0;
  const l2 = !!(svc & 2);
  const l3 = !!(svc & 4);
  // Pure L3 (routes, does not bridge) -> router; otherwise (bridges, or no layer
  // info) -> switch, since Arista is a switch-first vendor.
  const deviceType = (l3 && !l2) ? 'router' : 'switch';
  return {
    vendor: 'Arista',
    deviceType,
    family: 'Arista EOS',
    confidence: 85,
    tags: ['network', 'snmp', deviceType],
    infranet: { deviceType, rackEligible: true, floorEligible: false, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
