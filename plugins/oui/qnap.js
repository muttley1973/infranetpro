'use strict';

const ouiPrefixes = [
  '00089B', '008092', '244BFE', '245EBE', '94E1AC', 'A45F73',
];

const priority = 100;

function match() { return true; }

function enrich() {
  return {
    vendor: 'QNAP',
    family: 'QNAP Turbo NAS',
    deviceType: 'nas',
    tags: ['storage', 'nas', 'qnap', 'qts'],
    confidence: 92,
    infranet: { deviceType: 'nas', rackEligible: true, floorEligible: true, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
