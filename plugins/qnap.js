'use strict';

const vendorPrefix = '1.3.6.1.4.1.24681';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich() {
  return {
    vendor: 'QNAP',
    deviceType: 'nas',
    family: 'QNAP NAS / Storage',
    confidence: 96,
    tags: ['storage', 'nas', 'snmp'],
    infranet: { deviceType: 'nas', rackEligible: true, floorEligible: false, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
