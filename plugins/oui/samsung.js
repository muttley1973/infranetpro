'use strict';

// Samsung Electronics - phones, TVs, IoT, semiconductor, displays.

const ouiPrefixes = [
  '000DAE', '000DE5', '0012FB', '00159B', '001632', '0017C9', '00197E', '001A8A',
  '001B98', '001D25', '001DF6', '001E7D', '001EE1', '00214C', '00237A', '002399',
  '0023D6', '00248C', '002566', '0026F3', '0CC07A', '0CDFA4', '14F42A', '186590',
  '1859A5', '1C5A3E', '1C66AA', '20D390', '247225', '249B89', '24DBED', '28987B',
  '2C0E3D', '2C44FD', '300495', '30C7AE', '34145F', '3414BD', '34233E', '34BE00',
  '38ECE4', '3C5A37', '40163B', '40450E', '4849C7', '5440AD', '581FAA', '58B35F',
  '5C0A5B', '5C2E59', '5C497D', '60AF06', '60D819', '6471A4', '6CC4D5', '70F927',
  '780CB8', '78ABBB', '7C9122', '7CA01F', '7CF90E', '843835', '88329B', '8C77123',
  '8CC8CD', '94350A', '94B4F1', '94B89E', '988C4D', '98F183', '9CBDB8', '9CC1BC',
  'A07FB0', 'A0220C', 'A0F4B9', 'A4EBD3', 'A8163F', 'AC36138', 'ACAB13', 'ACEE9E',
  'B05D78', 'B0DE28', 'B413DE', 'B43A28', 'B68E61', 'BC44867', 'BC8CCD', 'C0973C',
  'C8147B', 'C82CFE', 'CC07AB', 'CC0530', 'CC7705', 'D03000', 'D0667B', 'D087E2',
  'D4E8B2', 'D87CF0', 'D8B0FE', 'D8E0E1', 'DC719C', 'E45957', 'E458B8', 'E840F2',
  'E8508B', 'E8AEDB', 'E89A8F', 'EC1F72', 'EC9BF3', 'F008F1', 'F087F6', 'F0E77E',
  'F40E22', 'F47B5E', 'F825F4', 'F8D0BD', 'FC0098',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''} ${context.httpTitle || ''}`.toLowerCase();
  let deviceType = 'pc';
  let family = 'Samsung Device';
  if (/tizen|webos|smart.*tv|bravia|qled|nu[\d]|qe[\d]|ue[\d]/.test(text)) { deviceType = 'tv';  family = 'Samsung Smart TV'; }
  else if (/galaxy|sm-[a-z]/.test(text))                                    { deviceType = 'pc';  family = 'Samsung Mobile'; }
  else if (/smartthings|smart.*plug|smart.*bulb|smart.*lock/.test(text))    { deviceType = 'iot'; family = 'Samsung SmartThings'; }
  else if (/refrigerator|washer|dryer|dishwasher|oven|microwave|aircon/.test(text)) { deviceType = 'iot'; family = 'Samsung Appliance'; }
  return {
    vendor: 'Samsung',
    family,
    deviceType,
    tags: ['samsung', deviceType],
    confidence: 72,
    infranet: { deviceType, rackEligible: false, floorEligible: true, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
