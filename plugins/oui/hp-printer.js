'use strict';

// HP / Hewlett-Packard print-server OUIs (JetDirect, LaserJet, OfficeJet).
// Note: HP shares many OUIs with HPE/Aruba; this plugin focuses on those that
// historically host printers. Disambiguation by sysDescr/hostname is in enrich.

const ouiPrefixes = [
  '00306E', '0030C1', '001321', '0014C2', '001E0B', '001F29', '00248C', '002655',
  '00306E', '003048', '0030C1', '040973', '085000', '101F74', '149182', '18A905',
  '1CC1DE', '2C44FD', '2C76800', '305A3A', '3463F8', '36C2DD', '38B19E', '3CD92B',
  '40B034', '50657F', '60BC4C', '6CC217', '6CC2173', '74867A', '74D02B', '7470FD',
  '8CDCD4', '94E6F7', '9CDC710', 'A0481C', 'A0D3C1', 'B499BA', 'C4346B', 'D89D67',
  'D8D385', 'D8C0A6', 'DC4A3E', 'E4E749', 'E8E84F', 'EC8EB5', 'F4039D', 'F4CE46',
];

const priority = 95;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  let deviceType = 'printer';
  let family = 'HP Printer';
  let confidence = 70;
  if (/officejet|laserjet|deskjet|designjet|pagewide|color.*laser|jetdirect/.test(text)) {
    family = 'HP LaserJet / OfficeJet';
    confidence = 92;
  } else if (/proliant|server|gen[\d]/.test(text)) {
    // Avoid mis-classifying servers that share HP OUIs.
    deviceType = 'server';
    family = 'HP ProLiant';
    confidence = 88;
  }
  return {
    vendor: 'HP',
    family,
    deviceType,
    tags: ['hp', deviceType],
    confidence,
    infranet: { deviceType, rackEligible: deviceType === 'server', floorEligible: deviceType === 'printer', sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
