'use strict';

const ouiPrefixes = [
  '000FB5', '00146C', '001B2F', '001E2A', '001F33', '00223F', '00224B6', '00264F',
  '002722', '0846D0', '0C81EE', '10DA43', '203CAE', '204E7F', '288088', '28C68E',
  '2C30033', '3094B4', '3498B5', '3CDFA9', '405BD8', '44A56E', '4C60DE', '4CE676',
  '503EAA', '60BC4C', '6C198F', '6CB0CE', '74440F', '74FB4C', '744401', '8438355',
  '8C3BAD', '9C3DCF', 'A040A0', 'A04181', 'A0408C', 'A040A0', 'B07FB9', 'B0B98A',
  'B82091', 'BC0786', 'C03F0E', 'C04A00', 'C40415', 'C89E43', 'CC40D0', 'D8CFCC',
  'DC2C26', 'E091F5', 'E46F13', 'E4F4C6', 'F87394',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  let deviceType = 'router';
  if (/gs[\d]+|ms[\d]+|switch|prosafe/.test(text))   deviceType = 'switch';
  else if (/wax|orbi|nighthawk.*pro|access point/.test(text)) deviceType = 'ap';
  else if (/readynas|stora|nas/.test(text))          deviceType = 'nas';
  return {
    vendor: 'Netgear',
    family: 'Netgear Networking',
    deviceType,
    tags: ['network', 'netgear', deviceType],
    confidence: 86,
    infranet: { deviceType, rackEligible: deviceType !== 'ap', floorEligible: deviceType === 'ap', sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
