'use strict';

const ouiPrefixes = [
  '001296', '002569', '044BFF', '101BFC', '14A7AB', '180373F0', '187976', '1C97A4',
  '28571F', '2857BE', '28F0D8', '34D2C5', '440319', '4427F3', '4869CC', '50C771',
  '5C7414', '6C1C71', '7CB57B', '7CDD90', '843415', '901844', '94B86D', '987264',
  'A437D3', 'A4FB8D', 'A45F3B', 'A4839B', 'B499D4', 'BC76E3', 'BCAD28', 'C0510B',
  'C4D654', 'C861FD', 'CCD2C0', 'D02788', 'D08DB3', 'D49E6D', 'D827EB', 'DCEFCA',
  'E04C7F', 'E830CF', 'F84DFC', 'FCCF62',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  let deviceType = 'webcam';
  let family = 'Hikvision IP Camera';
  if (/nvr|dvr|recorder/.test(text)) { deviceType = 'nvr'; family = 'Hikvision NVR'; }
  return {
    vendor: 'Hikvision',
    family,
    deviceType,
    tags: ['cctv', 'hikvision', deviceType, 'rtsp'],
    confidence: 92,
    infranet: { deviceType, rackEligible: deviceType === 'nvr', floorEligible: deviceType === 'webcam', sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
