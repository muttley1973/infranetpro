'use strict';

const ouiPrefixes = [
  '78C1CF', 'EC71DB', '3C52A1', '94E1AC', 'AC4C53',
];

const priority = 100;

function match() { return true; }

function enrich() {
  return {
    vendor: 'Reolink',
    family: 'Reolink IP Camera / NVR',
    deviceType: 'webcam',
    tags: ['cctv', 'reolink', 'webcam', 'rtsp'],
    confidence: 92,
    infranet: { deviceType: 'webcam', rackEligible: false, floorEligible: true, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
