'use strict';

const vendorPrefix = '1.3.6.1.4.1.41112';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  const isAp = oid.startsWith(`${vendorPrefix}.1.4`) || /unifi.*ap|\buap\b|access point/.test(text);
  const isGateway = /dream machine|\budm\b|\busg\b|gateway/.test(text);
  const deviceType = isAp ? 'ap' : (isGateway ? 'router' : 'switch');
  return {
    vendor: 'Ubiquiti',
    deviceType,
    family: isAp ? 'UniFi Access Point' : (isGateway ? 'UniFi Gateway' : 'UniFi Switch'),
    confidence: 90,
    tags: ['network', 'unifi', 'snmp', deviceType],
    infranet: { deviceType, rackEligible: !isAp, floorEligible: isAp, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
