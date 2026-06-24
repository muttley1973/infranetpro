'use strict';

const ouiPrefixes = [
  '000085', '0000C4', '001E8F', '0026408', '00BB3A', '081196', '083E0C', '08DF1F',
  '187272', '186024', '20BA7A', '2C7591', '50C2E8', '64ABD8', '683E34', '6824EC',
  '7058A4', '748E08', '787BCB', '88578E', '88FE0F', '8C71F8', '90E2BA', '947085',
  'BCB1F3', 'C0E7BF', 'C0EAE4', 'C81F66', 'D8C0A6', 'E4E4AB', 'F86F73', 'F89B9F',
];

const priority = 100;

function match() { return true; }

function enrich() {
  return {
    vendor: 'Canon',
    family: 'Canon Printer / MFP',
    deviceType: 'printer',
    tags: ['printer', 'canon'],
    confidence: 88,
    infranet: { deviceType: 'printer', rackEligible: false, floorEligible: true, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
