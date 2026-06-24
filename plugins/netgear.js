'use strict';

const vendorPrefix = '1.3.6.1.4.1.4526';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  const deviceType = /router|gateway|orbi|nighthawk/.test(text) ? 'router' : 'switch';
  return {
    vendor: 'Netgear',
    deviceType,
    family: 'Netgear Network Device',
    confidence: 80,
    tags: ['network', 'snmp', deviceType],
    infranet: { deviceType, rackEligible: true, floorEligible: false, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
