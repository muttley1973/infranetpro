'use strict';

const ouiPrefixes = [
  '001349', '0019CB', '001F1F', '00237C', '002795', '0026CF', '002859', '0030F1',
  '0090DC', '105F49', '108326', '1C740D', '40F201', '4CACE1', '503EAA', '545E9B',
  '5C6A8067', '64B47A', '6CFAA7', '78321B', '7C2664', '90EF68', '94A7BC', 'A0E4CB',
  'B0B2DC', 'B8B3DC', 'BC22B5', 'BC9909', 'BCCF4F', 'BCF685', 'C0FBF9', 'C87B5B',
  'D0D94F', 'D0FCE6', 'D8EB97', 'DC4427', 'E067BF', 'E8265D', 'EC4321', 'FCF528',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  let deviceType = 'router';
  if (/gs[\d]|xgs[\d]|switch/.test(text)) deviceType = 'switch';
  else if (/usg|zywall|firewall/.test(text)) deviceType = 'firewall';
  else if (/wax|wac|nwa|access point/.test(text)) deviceType = 'ap';
  return {
    vendor: 'Zyxel',
    family: 'Zyxel Networking',
    deviceType,
    tags: ['network', 'zyxel', deviceType],
    confidence: 88,
    infranet: { deviceType, rackEligible: deviceType !== 'ap', floorEligible: deviceType === 'ap', sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
