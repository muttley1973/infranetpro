'use strict';

// Microsoft Corp endpoints (Surface, Xbox, HoloLens). Note that Hyper-V virtual
// NICs use the same 00:15:5D range but are handled by virtual-hyperv.js with
// the same priority — the longer-prefix-wins logic doesn't apply here, so we
// keep Hyper-V intentionally and skip 00:15:5D in this plugin to avoid
// duplicate matches.

const ouiPrefixes = [
  '000D3A', '0017FA', '001DD8', '002248', '003BB3', '0CFE5D', '149A10', '249A6E',
  '283437', '2816A8', '286B35', '2C549188', '2C8158', '30598B', '300D43', '3007F6',
  '347C25', '38C75D', '407831', '485073', '4894F5', '4C8AF1', '4CEDDE', '50A5BD',
  '54180F', '5C797A', '604AAA', '60450294', '60D9A0', '649E31', '649ABE', '7444E7',
  '785EE5', '7C1E520', '7CED8D', '885C4D', '8851FB', '88533A', '90188B', '9C28F7',
  '9E5DF0', 'A4EBD3', 'A88195', 'AC5346', 'AC7235', 'C0335E', 'C03F0E', 'C8C1B8',
  'D02212', 'D0571396', 'DC2185', 'DC32D1', 'E04E1B', 'E454E801', 'E89A8F', 'EC4A0A',
  'EC8E8D', 'F0019C', 'F47B5E', 'F8634D', 'F8E61A',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''} ${context.netbiosName || ''}`.toLowerCase();
  let deviceType = 'pc';
  let family = 'Microsoft Device';
  if (/xbox/.test(text))            { deviceType = 'tv';     family = 'Xbox Console'; }
  else if (/surface/.test(text))    { deviceType = 'pc';     family = 'Microsoft Surface'; }
  else if (/hololens/.test(text))   { deviceType = 'iot';    family = 'HoloLens'; }
  else if (/azure.*sphere/.test(text)) { deviceType = 'iot'; family = 'Azure Sphere'; }
  return {
    vendor: 'Microsoft',
    family,
    deviceType,
    tags: ['microsoft', deviceType],
    confidence: 72,
    infranet: { deviceType, rackEligible: false, floorEligible: true, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
