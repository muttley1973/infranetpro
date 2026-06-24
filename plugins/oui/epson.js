'use strict';

const ouiPrefixes = [
  '000048', '00026F', '0026AB', '08002E', '04F8C8', '4429B7', '64EB8C', '74F61C',
  '8443E1', 'A4EE57', 'AC180D', 'B0E892', 'D49A20',
];

const priority = 100;

function match() { return true; }

function enrich() {
  return {
    vendor: 'Seiko Epson',
    family: 'Epson Printer',
    deviceType: 'printer',
    tags: ['printer', 'epson'],
    confidence: 90,
    infranet: { deviceType: 'printer', rackEligible: false, floorEligible: true, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
