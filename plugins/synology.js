'use strict';

const vendorPrefix = '1.3.6.1.4.1.6574';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich() {
  return {
    vendor: 'Synology',
    deviceType: 'nas',
    family: 'DiskStation / RackStation',
    confidence: 96,
    tags: ['storage', 'nas', 'snmp'],
    infranet: { deviceType: 'nas', rackEligible: true, floorEligible: false, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
