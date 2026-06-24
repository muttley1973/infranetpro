'use strict';

const vendorPrefix = '1.3.6.1.4.1.14988';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  const isSwitchFamily = /\bcrs\d|cloud router switch|switchos/.test(text);
  const deviceType = isSwitchFamily ? 'switch' : 'router';
  return {
    vendor: 'MikroTik',
    deviceType,
    family: isSwitchFamily ? 'CRS / SwitchOS' : 'RouterOS',
    confidence: 92,
    tags: ['network', 'snmp', 'routeros', deviceType],
    infranet: { deviceType, rackEligible: true, floorEligible: false, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
