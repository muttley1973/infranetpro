'use strict';

const vendorPrefix = '1.3.6.1.4.1.25461';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich() {
  return {
    vendor: 'Palo Alto Networks',
    deviceType: 'firewall',
    family: 'PAN-OS Firewall',
    confidence: 96,
    tags: ['security', 'firewall', 'snmp'],
    infranet: { deviceType: 'firewall', rackEligible: true, floorEligible: false, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
