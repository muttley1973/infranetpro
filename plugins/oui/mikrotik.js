'use strict';

// MikroTik SIA (Latvia). All RouterBOARD/CRS/CCR devices.

const ouiPrefixes = [
  '000C42', '4C5E0C', '6C3B6B', '7491BB', 'B869F4', 'C4AD34', 'CC2DE0', 'D4CA6D',
  'D4CA6E', 'DC2C6E', 'E48D8C', 'F4F26D',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  let deviceType = 'router';
  if (/\bsw[\d-]|crs[\d-]/.test(text)) deviceType = 'switch';
  if (/cap|access point|wireless/.test(text)) deviceType = 'ap';
  return {
    vendor: 'MikroTik',
    family: 'MikroTik RouterBOARD',
    deviceType,
    tags: ['network', 'mikrotik', 'routeros', deviceType],
    confidence: 92,
    infranet: { deviceType, rackEligible: true, floorEligible: deviceType === 'ap', sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
