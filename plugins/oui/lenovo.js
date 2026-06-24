'use strict';

const ouiPrefixes = [
  '000142', '00146C', '0017A4', '0024D6', '00254E', '00595C', '04A316', '08D40C',
  '101F74', '105F49', '20EE28', '24F0FF', '286FB9', '301966', '305A3A', '347E5C',
  '3C970E', '3CDFA9', '4423A9', '4CCC6A', '54A05D', '58732F', '5C260A', '5C803B',
  '5CD3FB', '6C0B84', '7470FD', '74E5F9', '78F882', '887873', '8C7A15', '8C73CC',
  '94B86D', '94E978', '9CB6D0', 'A4B197', 'A85E45', 'B4B686', 'B85056', 'BC0F2B',
  'BC305B', 'C0B883', 'D481D7', 'D89695', 'DC2BAA', 'DC4123', 'E0A3AC', 'E8B1FC',
  'F0DEF1', 'F40272',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''} ${context.netbiosName || ''}`.toLowerCase();
  let deviceType = 'pc';
  let family = 'Lenovo Endpoint';
  if (/thinksystem|server|sr[\d]+|sd[\d]+/.test(text)) { deviceType = 'server'; family = 'Lenovo ThinkSystem'; }
  else if (/thinkpad/.test(text))                       { deviceType = 'pc';     family = 'Lenovo ThinkPad'; }
  else if (/thinkcentre|thinkstation/.test(text))       { deviceType = 'pc';     family = 'Lenovo ThinkCentre'; }
  return {
    vendor: 'Lenovo',
    family,
    deviceType,
    tags: ['lenovo', deviceType],
    confidence: 78,
    infranet: { deviceType, rackEligible: deviceType === 'server', floorEligible: deviceType === 'pc', sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
