'use strict';

const vendorPrefix = '1.3.6.1.4.1.11';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  const isPrinter = oid.startsWith(`${vendorPrefix}.2.3.9`) || /laserjet|officejet|printer|jetdirect/.test(text);
  const deviceType = isPrinter ? 'printer' : 'switch';
  return {
    vendor: 'Hewlett Packard Enterprise',
    deviceType,
    family: isPrinter ? 'HP Printer / JetDirect' : 'HPE Aruba / ProCurve Switch',
    confidence: isPrinter ? 95 : 82,
    tags: ['snmp', deviceType].concat(isPrinter ? ['print'] : ['network']),
    infranet: { deviceType, rackEligible: !isPrinter, floorEligible: isPrinter, sourcePriority: 'sysObjectID' },
  };
}

module.exports = { vendorPrefix, match, enrich };
