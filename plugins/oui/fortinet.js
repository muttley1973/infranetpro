'use strict';

const ouiPrefixes = [
  '000993', '042AE2', '08504F', '08B1C8', '084FA9', '0C20D2', '344B3D', '4C8FC1',
  '5887E7', '5C6F69', '7045B5', '7060B7', '70C18A', '7C8DFB', '80E018', '90F099',
  '9C9100', 'A091A2', 'A88128', 'B4F754', 'C8C3F2', 'CCB31F', 'D4D5C0', 'E0234C',
  'E2BA9A', 'E8F92A',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  let deviceType = 'firewall';
  let family = 'FortiGate Firewall';
  if (/fortiap|access point/.test(text))       { deviceType = 'ap';      family = 'FortiAP'; }
  else if (/fortiswitch/.test(text))           { deviceType = 'switch';  family = 'FortiSwitch'; }
  else if (/fortimanager|fortianalyzer/.test(text)) { deviceType = 'server'; family = 'FortiManager/Analyzer'; }
  return {
    vendor: 'Fortinet',
    family,
    deviceType,
    tags: ['network', 'security', 'fortinet', deviceType],
    confidence: 92,
    infranet: { deviceType, rackEligible: deviceType !== 'ap', floorEligible: deviceType === 'ap', sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
