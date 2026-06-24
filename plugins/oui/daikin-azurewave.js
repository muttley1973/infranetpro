'use strict';

// AzureWave Technology Inc. — supplier WiFi modules used by Daikin (and other
// home appliance vendors). Devices appear in IoT environments as Daikin
// climate / wall units and similar smart appliances.

const ouiPrefixes = [
  '0007E9', '0017F2', '0024D7', '00259C', '0CEFAF', '14CC20', '186518', '3C1E04',
  '3C5A37', '40160A', '50F520', '6C5AB0', '7C9EBD', '7CDD90', '80EA96', '88DA1A',
  '942A6F', '94EBCD', '94F827', 'A47733', 'AC8389', 'AC83F3', 'ACBC32', 'B0CAFB',
  'BC8CCD', 'C09F42', 'C46E1F', 'C82C2B', 'C870ED', 'CC81DA', 'D03393', 'D0589E',
  'D8A01D', 'DC2E6A', 'E04F43', 'E083C1', 'F062E1', 'F4BFA1',
];

const priority = 95; // slightly lower than other top-tier vendor plugins

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  let deviceType = 'iot';
  let family = 'AzureWave IoT';
  if (/daikin|climate|air[ -]?con/.test(text)) { family = 'Daikin Smart Air'; }
  return {
    vendor: 'AzureWave / Daikin',
    family,
    deviceType,
    tags: ['iot', 'wifi-module', 'home-automation'],
    confidence: 62,
    infranet: { deviceType, rackEligible: false, floorEligible: true, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
