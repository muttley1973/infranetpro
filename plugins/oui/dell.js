'use strict';

const ouiPrefixes = [
  '00065B', '00084C', '000AF3', '000BDB', '000D56', '000E0B', '000FFE', '00114F',
  '00126A', '0013F7', '0014C2', '001517', '001543', '001A4A', '001BB1', '001C23',
  '001D09', '001E4F', '001E1F', '001EC9', '0021219', '0021701', '0021704', '00226B',
  '002264', '002354', '0023AE', '0024E8', '00265F', '002654', '00269A', '0026B9',
  '0030489', '0030FE', '00FAE6', '040973', '141877', '14187766', '1418779B', '141877B0',
  '14B31FE6', '18036F', '180373B6', '180373CB', '180373CC', '185A58', '1866DA', '189296',
  '189BA5', '1C40242', '203AEF', '20DDFA', '24B6FD', '283A4D', '305D38', '34174E',
  '3417EB', '34E6D7', '38F9D3', '3CD92B', '4421B0', '4C76253B', '4C76253E', '4C7625C7',
  '4C76253F', '5C260A', '5CF9DD', '6045BD', '60BE6A', '643AB1', '6C2B59', '74867A',
  '7445A1', '74E6E2', '78ACDE', '7C1E52', '801F02', '802AA8', '80289B', '802AAD',
  '84134A', '848F69', '84F02C', '885C09', '888DF2', '8CECEB', '90B11C', '94B86D',
  '98E743', 'A0140D', 'A41F726B', 'A42F69', 'A4BAA1', 'A86BAD', 'A89D21', 'A8C5F0',
  'A8C9F3', 'A86BAD', 'B083FE', 'B0865C', 'B49691', 'B499BA', 'B83565', 'B894F1',
  'BC07DA', 'C0566E', 'C81F66', 'C81F66E', 'CC4886', 'CC8D9F', 'D025BD', 'D04D2C',
  'D067E5', 'D094DC', 'D8458B', 'D8D385', 'D89EF3', 'D8EA8F', 'DCF401', 'DC7E1F',
  'E03F49', 'E454E80', 'E4F004', 'EC0DBB', 'EC0DBB02', 'EC0DBB28', 'EC0DBB30',
  'F04DA2', 'F40270', 'F48E38', 'F4905B', 'F8B156', 'F8BC12', 'F8CAB8', 'FC15B4',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''} ${context.netbiosName || ''}`.toLowerCase();
  let deviceType = 'pc';
  let family = 'Dell Endpoint';
  if (/poweredge|idrac|server|gen[\d]/.test(text))        { deviceType = 'server';  family = 'Dell PowerEdge'; }
  else if (/precision|workstation/.test(text))            { deviceType = 'pc';      family = 'Dell Precision'; }
  else if (/optiplex/.test(text))                         { deviceType = 'pc';      family = 'Dell OptiPlex'; }
  else if (/latitude/.test(text))                         { deviceType = 'pc';      family = 'Dell Latitude'; }
  else if (/powerstore|powervault|equallogic|compellent/.test(text)) { deviceType = 'nas'; family = 'Dell Storage'; }
  return {
    vendor: 'Dell',
    family,
    deviceType,
    tags: ['dell', deviceType],
    confidence: 80,
    infranet: { deviceType, rackEligible: deviceType === 'server' || deviceType === 'nas', floorEligible: deviceType === 'pc', sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
