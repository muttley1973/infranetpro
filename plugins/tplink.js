'use strict';

const vendorPrefix = '1.3.6.1.4.1.11863';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  const deviceType = /omada|eap|access point|\bap\b/.test(text)
    ? 'ap'
    : (/router|gateway|er\d+|archer/.test(text) ? 'router' : 'switch');
  return {
    vendor: 'TP-Link',
    deviceType,
    family: 'TP-Link Network Device',
    confidence: 82,
    tags: ['network', 'snmp', deviceType],
    infranet: { deviceType, rackEligible: deviceType !== 'ap', floorEligible: deviceType === 'ap', sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
