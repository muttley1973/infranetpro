'use strict';

const vendorPrefix = '1.3.6.1.4.1.9';

const knownModels = [
  ['1.3.6.1.4.1.9.1.516', 'Catalyst 3750', 'switch'],
  ['1.3.6.1.4.1.9.1.694', 'Catalyst 2960', 'switch'],
  ['1.3.6.1.4.1.9.1.1208', 'Catalyst 2960-S', 'switch'],
  ['1.3.6.1.4.1.9.1.1745', 'Catalyst 2960-X', 'switch'],
  ['1.3.6.1.4.1.9.1.1041', 'ISR G2', 'router'],
  ['1.3.6.1.4.1.9.1.1269', 'ASA 5500-X', 'firewall'],
];

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const known = knownModels.find(([prefix]) => oid === prefix || oid.startsWith(`${prefix}.`));
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  const deviceType = known ? known[2] : inferCiscoType(text, context.sysServices);
  return {
    vendor: 'Cisco',
    deviceType,
    family: known ? known[1] : 'Cisco Network Device',
    model: known ? known[1] : undefined,
    confidence: known ? 96 : 82,
    tags: ['network', 'snmp', deviceType],
    infranet: { deviceType, rackEligible: true, floorEligible: false, sourcePriority: 'sysObjectID' },
  };
}

function inferCiscoType(text, sysServices) {
  if (/asa|firepower|firewall|ftd/.test(text)) return 'firewall';
  if (/aironet|access point|\bap\b/.test(text)) return 'ap';
  if (/catalyst|nexus|switch|ios[_-]?l2/.test(text)) return 'switch';
  const svc = parseInt(sysServices || 0, 10) || 0;
  if ((svc & 2) && !(svc & 4)) return 'switch';
  return 'router';
}

module.exports = { vendorPrefix, match, enrich };
