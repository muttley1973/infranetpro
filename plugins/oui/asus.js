'use strict';

const ouiPrefixes = [
  '00112F', '0013D4', '0015F2', '001731', '0017312', '0018F3', '001A92', '001B11',
  '001BFC', '001D60', '001EA8', '001EA9', '001F11', '00226B', '00248C', '00266C',
  '0026188', '002618A', '0026189', '002618C', '0026188', '0026189', '00261886',
  '04421A', '04D43D', '04D9F5', '08606E', '107B44', '14DAE9', '1C872C', '1CB72C',
  '20CF300', '244BFE', '2C56DC', '2C4D54', '305A3A', '3085A9', '38D547', '3C7C3F',
  '4061862', '40167E', '4CED', '50465D', '54A050', '54A05D', '5494', '6045CB',
  '60451B', '707BE8', '7445A1', '74D02B', '7C10C9', '88D7F6', '8C10D4', '90E6BA',
  '9C5C8E', 'A036BC', 'A85E45', 'AC220B', 'AC9E17', 'ACBB7F', 'AC9E17', 'B048', 'B4D5BD',
  'BCAEC5', 'C86000', 'D017C2', 'D045DD', 'D45D64', 'D88300', 'D850E6', 'D8A2', 'F046',
  'F02FA8', 'F46D04', 'F4B7E2', 'F832E4', 'FC3497', 'FC34', 'FCAA14',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''} ${context.netbiosName || ''}`.toLowerCase();
  let deviceType = 'pc';
  let family = 'Asus Endpoint';
  if (/router|rt-[a-z]|access point/.test(text)) { deviceType = 'router'; family = 'Asus Router'; }
  else if (/zenbook|vivobook|rog|tuf/.test(text)) { deviceType = 'pc'; family = 'Asus Notebook'; }
  return {
    vendor: 'Asus',
    family,
    deviceType,
    tags: ['asus', deviceType],
    confidence: 70,
    infranet: { deviceType, rackEligible: false, floorEligible: true, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
