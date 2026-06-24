'use strict';

// Ubiquiti Networks (UniFi/EdgeMAX/AirMAX/UISP).

const ouiPrefixes = [
  '0418D6', '0427C7', '186518', '24A43C', '245A4C', '2C268A', '44D9E7', '4418FD',
  '5C24EB', '60D81F', '68725F', '687251', '6CD5B1', '74ACB9', '74831F', '7483C2',
  '788A20', '784558', '802AA8', '94A4FF', '96B1A8', '98A4D8', 'AC8BA9', 'B43B6C',
  'BCD6FE', 'C03830', 'C8B5AD', 'D021F9', 'D29EFD', 'DC9FDB', 'E063DA', 'E438B0',
  'F09FC2', 'F492BF', 'FC56B0', 'FCECDA',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  let deviceType = 'ap';
  if (/usg|udm|edgemax|edgerouter|udr|udwpro|gateway/.test(text)) deviceType = 'router';
  else if (/usw|unifi.*switch|ubnt.*switch/.test(text))           deviceType = 'switch';
  else if (/unifi.*protect|nvr|camera|cctv/.test(text))           deviceType = 'webcam';
  else if (/cloud key|controller/.test(text))                     deviceType = 'server';
  return {
    vendor: 'Ubiquiti Networks',
    family: 'Ubiquiti / UniFi',
    deviceType,
    tags: ['network', 'ubiquiti', 'unifi', deviceType],
    confidence: 92,
    infranet: { deviceType, rackEligible: deviceType !== 'ap', floorEligible: deviceType === 'ap' || deviceType === 'webcam', sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
