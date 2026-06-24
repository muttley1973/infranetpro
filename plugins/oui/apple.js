'use strict';

// Apple Inc. - one of the largest OUI holders. We capture the top common ranges
// for Macs, iPhones, iPads, Apple TV, AirPort, HomePod. The IEEE catch-all
// covers the rest.

const ouiPrefixes = [
  '000393', '000502', '000A27', '000A95', '000D93', '000E12', '000F38', '0010FA',
  '00112F', '00115A', '00127F', '0014A4', '0016CB', '0017F2', '00193A', '001B63',
  '001CB3', '001D4F', '001E52', '001EC2', '001F5B', '001FF3', '00214C', '0021E9',
  '002241', '00236C', '002332', '002436', '00254B', '0025BC', '00264A', '0026BB',
  '003065', '003EE1', '0050E4', '04489A', '0469F8', '04F13E', '04F7E4', '083E0C',
  '0C30215', '0C3B50', '0C743E', '0CBC9F', '107B44', '109ADD', '14109F', '14205E',
  '145A05', '14B9C0', '14CB85', '180373', '189EFC', '1C36BB', '1C5CF2', '1C9148',
  '1CABA7', '20768F', '20A2E4', '20C9D0', '24F094', '24F677', '283737', '28E02C',
  '28E14C', '2C3361', '2C4034', '2CB43A', '2CD5DC', '30357A', '30F7C5', '34159E',
  '34A395', '38B54D', '38CADA', '3CD0F8', '40A6D9', '40B395', '40CDB4', '485A0C',
  '4860BC', '48BF6B', '48D705', '48F855', '4C7C5F', '4C8D79', '5800E3', '5C5F67',
  '5C8D4E', '5C95AE', '5C969D', '5CADCF', '60030B', '6045BD', '60C547', '60D9C7',
  '60F445', '60FACD', '6CC26B', '70CD60', '70DEE2', '74E1B6', '78A3E4', '78CA39',
  '789F70', '7C0157', '7C04D0', '7C11BE', '7C6D62', '7CC3A1', '7CC537', '7CD1C3',
  '7CFADF', '843835', '8489AD', '88C663', '8C1ABF', '8C2DAA', '904CE5', '90840D',
  '90B931', '90B0ED', '90FD61', '942CB3', '94E96A', '986D35', '9803D8', '987DD5',
  '9CF48E', '9CFC01', 'A4B197', 'A4D1D2', 'A4E975', 'A8667F', 'A88E24', 'A8BBCF',
  'A8FAD8', 'AC293A', 'AC3C0B', 'B065BD', 'B418D1', 'B8634D', 'B88D12', 'B8E856',
  'B8FF61', 'BC3BAF', 'BC5436', 'BC926B', 'BCEC5D', 'C06394', 'C0CECD', 'C8334B',
  'C81EE7', 'C82A14', 'C869CD', 'CC25EF', 'D0034B', 'D023DB', 'D02598', 'D04F7E',
  'D0817A', 'D0E140', 'D49A20', 'D4F46F', 'D89695', 'D8BB2C', 'DC2B61', 'DCA904',
  'E0ACCB', 'E0B9BA', 'E0F5C6', 'E425E7', 'E48B7F', 'E8040B', 'E8802E', 'F0764F',
  'F0DBE2', 'F0DCE2', 'F40F24', 'F45C89', 'F86214', 'FC253F', 'FCFC48',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''} ${context.netbiosName || ''}`.toLowerCase();
  let deviceType = 'pc';
  let family = 'Apple Device';
  if (/iphone/.test(text))         { deviceType = 'pc';  family = 'iPhone'; }
  else if (/ipad/.test(text))      { deviceType = 'pc';  family = 'iPad'; }
  else if (/macbook|imac|mac mini|mac pro|macos/.test(text)) { deviceType = 'pc'; family = 'Mac'; }
  else if (/apple tv|appletv/.test(text)) { deviceType = 'tv'; family = 'Apple TV'; }
  else if (/airport|time capsule/.test(text)) { deviceType = 'ap'; family = 'AirPort'; }
  else if (/homepod/.test(text))   { deviceType = 'iot'; family = 'HomePod'; }
  return {
    vendor: 'Apple',
    family,
    deviceType,
    tags: ['apple', deviceType],
    confidence: 86,
    infranet: { deviceType, rackEligible: false, floorEligible: true, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
