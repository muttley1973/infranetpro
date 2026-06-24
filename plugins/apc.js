'use strict';

const vendorPrefix = '1.3.6.1.4.1.318';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  const isPdu = oid.startsWith(`${vendorPrefix}.1.1.12`) || /\bpdu\b|rack pdu|power distribution/.test(text);
  const deviceType = isPdu ? 'pdu' : 'ups';
  return {
    vendor: 'APC',
    deviceType,
    family: isPdu ? 'Rack PDU' : 'Smart-UPS / Network Management Card',
    confidence: isPdu ? 95 : 90,
    tags: ['power', 'snmp', deviceType],
    infranet: { deviceType, rackEligible: true, floorEligible: false, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
