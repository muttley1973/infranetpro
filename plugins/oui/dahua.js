'use strict';

const ouiPrefixes = [
  '14A7AB', '3C1B8C', '3CEF8C', '40B4CD', '4ED73C', '50EBF6', '5CF207', '64ACAB',
  '64D14A', '78D593', '78D60B', '901844', '9C14638', '9CF61A', 'A0BD1D', 'AC6A14',
  'BC329E', 'BC1AE4', 'D4D71A', 'D49E6D',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  let deviceType = 'webcam';
  let family = 'Dahua IP Camera';
  if (/nvr|dvr|recorder/.test(text)) { deviceType = 'nvr'; family = 'Dahua NVR'; }
  return {
    vendor: 'Dahua',
    family,
    deviceType,
    tags: ['cctv', 'dahua', deviceType, 'rtsp'],
    confidence: 90,
    infranet: { deviceType, rackEligible: deviceType === 'nvr', floorEligible: deviceType === 'webcam', sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
