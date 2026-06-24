'use strict';

const vendorPrefix = '1.3.6.1.4.1.6876';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich() {
  return {
    vendor: 'VMware',
    deviceType: 'hypervisor',
    family: 'ESXi / vSphere Host',
    confidence: 95,
    tags: ['hypervisor', 'server', 'snmp'],
    // L'host ESXi è un hypervisor da datacenter: rack, non floor. (Il Mini-server
    // homelab è una scelta MANUALE: nessun segnale di rete distingue il form factor.)
    infranet: { deviceType: 'hypervisor', rackEligible: true, floorEligible: false, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
