'use strict';

const vendorPrefix = '1.3.6.1.4.1.534';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  const isPdu = /\bpdu\b|epdu|power distribution/.test(text);
  const deviceType = isPdu ? 'pdu' : 'ups';
  return {
    vendor: 'Eaton',
    deviceType,
    family: isPdu ? 'Eaton ePDU' : 'Eaton UPS',
    confidence: 90,
    tags: ['power', 'snmp', deviceType],
    infranet: { deviceType, rackEligible: true, floorEligible: false, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
