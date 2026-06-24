'use strict';

const vendorPrefix = '1.3.6.1.4.1.890';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  const deviceType = /zywall|usg|firewall|security gateway/.test(text)
    ? 'firewall'
    : (/router|gateway/.test(text) ? 'router' : 'switch');
  return {
    vendor: 'Zyxel',
    deviceType,
    family: 'Zyxel Network Device',
    confidence: 86,
    tags: ['network', 'snmp', deviceType],
    infranet: { deviceType, rackEligible: true, floorEligible: false, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
