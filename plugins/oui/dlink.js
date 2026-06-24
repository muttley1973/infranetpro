'use strict';

const ouiPrefixes = [
  '00055D', '000D88', '000F3D', '001346', '0015E9', '00179A', '001B11', '001CF0',
  '001E58', '00211B', '0022B0', '00241D', '002690', '00266F', '00B00C', '0EF6FB',
  '14D64D', '1CAFF7', '1CBDB9', '1CC73D', '20FAC7', '283B82', '28107B', '2C68A3',
  '34BC72', '3C1E04', '40E230', '4EDD3C', '5C33BD', '6038E0', '64C5AA', '6C7220',
  '78320D', '786A89', '7C8AE1', '84C9B2', '90945A', '90948F', '9CD643', 'A0AB1B',
  'B0C554', 'B83A08', 'C8BE19', 'CCB255', 'D8FEE3', 'E0152D', 'E46F13', 'F07D68',
  'FC9F7E',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  let deviceType = 'router';
  if (/dgs|des|dxs|switch/.test(text))           deviceType = 'switch';
  else if (/dap|dwa|access point/.test(text))    deviceType = 'ap';
  else if (/dcs|nvr|camera|webcam/.test(text))   deviceType = 'webcam';
  else if (/dns-[\d]|sharecenter|nas/.test(text)) deviceType = 'nas';
  return {
    vendor: 'D-Link',
    family: 'D-Link Networking',
    deviceType,
    tags: ['network', 'd-link', deviceType],
    confidence: 84,
    infranet: { deviceType, rackEligible: deviceType !== 'ap' && deviceType !== 'webcam', floorEligible: deviceType === 'ap' || deviceType === 'webcam', sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
