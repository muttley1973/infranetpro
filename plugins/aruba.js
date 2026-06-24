'use strict';

const vendorPrefix = '1.3.6.1.4.1.14823';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  const isAp = /\biap\b|instant|access point|\bap[-\s]?\d|arubaos.*ap/.test(text);
  const deviceType = isAp ? 'ap' : 'switch';
  return {
    vendor: 'Aruba',
    deviceType,
    family: isAp ? 'Aruba Instant / Campus AP' : 'ArubaOS-CX / Aruba Switch',
    confidence: isAp ? 88 : 82,
    tags: ['network', 'snmp', deviceType],
    infranet: { deviceType, rackEligible: !isAp, floorEligible: isAp, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
