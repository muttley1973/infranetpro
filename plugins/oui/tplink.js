'use strict';

const ouiPrefixes = [
  '001478', '14CC20', '14CF92', '1810E3', '1C61B4', '1C3BF3', '202BC1', '20F4C4',
  '24A2E1', '24F5A2', '2887BA', '300506', '3C1E04', '3C46D8', '404A03', '485D60',
  '50C7BF', '54AF97', '5C628B', '60E327', '6C5AB0', '74DA88', '7C8BCA', '849369',
  '94E978', '98DAC4', 'A42BB0', 'A842A1', 'AC15A2', 'B0487A', 'B0F1EC', 'C006C3',
  'C4E984', 'C84630', 'D03745', 'D8076B', 'D89AD3', 'DC0BDC', 'E4C32A', 'E848B8',
  'F0F249', 'F4F26D', 'FCD7A8',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  let deviceType = 'router';
  if (/eap|access point|omada.*ap|deco/.test(text))   deviceType = 'ap';
  else if (/t[\d]+|switch|tl-sg/.test(text))          deviceType = 'switch';
  else if (/kasa|smart plug|smart bulb|smart switch/.test(text)) deviceType = 'iot';
  return {
    vendor: 'TP-Link',
    family: 'TP-Link / Tapo / Kasa',
    deviceType,
    tags: ['network', 'tp-link', deviceType],
    confidence: 86,
    infranet: { deviceType, rackEligible: deviceType === 'switch', floorEligible: deviceType !== 'switch', sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
