'use strict';

const vendorPrefix = '1.3.6.1.4.1.311';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''} ${context.netbiosName || ''}`.toLowerCase();
  const isServer = /windows server|server|domain controller|hyper-v|iis|file server/.test(text);
  const deviceType = isServer ? 'server' : 'pc';

  return {
    vendor: 'Microsoft',
    deviceType,
    family: 'Windows SNMP Agent',
    confidence: isServer ? 92 : 86,
    tags: ['os', 'windows', 'snmp', deviceType],
    os: {
      family: 'windows',
      vendor: 'Microsoft',
      name: isServer ? 'Windows Server' : 'Windows',
      confidence: isServer ? 92 : 86,
      tags: ['windows'],
    },
    infranet: { deviceType, rackEligible: isServer, floorEligible: true, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
