'use strict';

// Hewlett Packard Enterprise, Aruba Networks (HPE), 3Com legacy.
// Many OUIs were migrated under HPE umbrella after acquisitions.

const ouiPrefixes = [
  '0001E6', '0001E7', '000802', '000883', '000AF7', '000B43', '000E7F',
  '000FBA', '0011A5', '0014C2', '0017A4', '001A1E', '001B78', '001C2E', '001CC4',
  '001E0B', '001EC9', '001F29', '00219B', '0023AE', '00256B', '002590', '002655',
  '0026F1', '003048', '0030C1', '003B97', '0040FF', '009027', '0080A1', '008092',
  '040973', '04094B', '0871FE', '0CC47A', '10604B', '1062E5', '1458D0', '14586C',
  '1C98EC', '20677C', '2C44FD', '3CA82A', '3CD92B', '442B03', '482C6A', '5C8A38',
  '6CC217', '74867A', '7C2E0D', '8CDCD4', '94E6F7', '9C8E99', 'A0D3C1', 'AC162D',
  'B499BA', 'B4B52F', 'B855F0', 'C45444', 'C46516', 'C4716A', 'CC3DDD', 'DC4A3E',
  'E8E84F', 'F4CE46', 'F4F26D',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  let deviceType = 'switch';
  const tags = ['network', 'hpe', 'aruba'];

  if (/proliant|server|gen[0-9]/.test(text))            deviceType = 'server';
  else if (/officejet|laserjet|deskjet|color.*laser/.test(text)) deviceType = 'printer';
  else if (/instant|iap|access point|\bap\b/.test(text))         deviceType = 'ap';
  else if (/procurve|aruba.*cx|aruba.*switch|comware/.test(text))deviceType = 'switch';
  else if (/storeonce|nimble|3par|msa/.test(text))               deviceType = 'nas';

  return {
    vendor: 'HPE / Aruba',
    family: 'HPE Network / Server',
    deviceType,
    tags: [...tags, deviceType],
    confidence: 88,
    infranet: { deviceType, rackEligible: deviceType !== 'ap', floorEligible: deviceType === 'ap', sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
