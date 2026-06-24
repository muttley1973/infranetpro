'use strict';

const ouiPrefixes = [
  '00408C', '0040A0', 'ACCC8E', 'B8A44F', 'B8DA4A', 'F8B568',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  let deviceType = 'webcam';
  let family = 'Axis Network Camera';
  if (/door|access|controller/.test(text)) { deviceType = 'doorctrl'; family = 'Axis Door Controller'; }
  return {
    vendor: 'Axis Communications',
    family,
    deviceType,
    tags: ['cctv', 'axis', deviceType],
    confidence: 92,
    infranet: { deviceType, rackEligible: false, floorEligible: true, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
