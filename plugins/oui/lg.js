'use strict';

// LG Electronics - mostly TV / smart home / appliances / displays.
// 58:FD:B1 is a very common LG webOS TV prefix.

const ouiPrefixes = [
  '001E75', '001F6B', '001FE2', '002101', '00226D', '00257F', '0026E2', '0050BA',
  '00E091', '08D40C', '0CB7C2', '0CD9C1', '101212', '20A6CD', '34FCEF', '38AB41',
  '38E8DF', '3CCD93', '3C71BF', '40B0FA', '485929', '4CB199', '50554A', '58A2B5',
  '58FDB1', '6048A4', '6CDD30', '70910F', '74A78E', '74E1FA', '78F882', '7C1CA3',
  '94C232', '9893CC', 'A03992', 'A4774D', 'B81832', 'BC8DA7', 'BCF5AC', 'C49A02',
  'CC2D8C', 'C40415', 'C80210', 'CC448E', 'CCFA00', 'D8C0A6', 'DCBDEC', 'E40B72',
  'F02763', 'F8A45F', 'F8B7E2',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''} ${context.httpTitle || ''}`.toLowerCase();
  let deviceType = 'tv';
  let family = 'LG webOS TV';
  if (/refrigerator|washer|dryer|dishwasher|oven|aircon|thinq/.test(text)) { deviceType = 'iot'; family = 'LG ThinQ Appliance'; }
  else if (/lg.*nuc|monitor|display/.test(text))                            { deviceType = 'pc';  family = 'LG Display'; }
  return {
    vendor: 'LG Electronics',
    family,
    deviceType,
    tags: ['lg', deviceType],
    confidence: 70,
    infranet: { deviceType, rackEligible: false, floorEligible: true, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
