'use strict';

const vendorPrefix = '1.3.6.1.4.1.368';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich() {
  return {
    vendor: 'Axis',
    deviceType: 'webcam',
    family: 'Network Camera / Video Encoder',
    confidence: 95,
    tags: ['camera', 'video', 'snmp'],
    infranet: { deviceType: 'webcam', rackEligible: false, floorEligible: true, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
