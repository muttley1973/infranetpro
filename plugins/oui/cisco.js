'use strict';

// Top Cisco Systems OUIs (24-bit MA-L). Cisco has 300+ assigned OUIs; we list
// the most common production ranges. The IEEE database plugin covers anything
// else with vendor-only metadata.

const ouiPrefixes = [
  '00000C', '000142', '000143', '00017F', '0001C7', '0001C9', '0002B9', '0002BA',
  '0003E3', '0003FD', '00042B', '0004C0', '000502', '00059A', '0006D6', '0007EB',
  '00085C', '0009B7', '000A41', '000B45', '000BBE', '000C30', '000D29', '000D88',
  '000E08', '000E0C', '000E84', '000ED7', '000FF7', '00101F', '0010F6', '0011BB',
  '00126D', '0013C3', '0014A8', '0015C7', '0015F9', '00163C', '0016C7', '0017DF',
  '00181D', '0019A9', '001A2F', '001A6C', '001B0C', '001B53', '001C0E', '001C58',
  '001CB0', '001D45', '001DA1', '001E13', '001E4A', '001F26', '001FCA', '0021A1',
  '0021BE', '0022BD', '0023AC', '0023BD', '0024C4', '0025B4', '0026CB', '00270D',
  '0027E3', '003094', '0050BD', '00603E', '00800B', '008049', '00DDD0', '040A95',
  '04C5A4', '081196', '084FA9', '0CD996', '107BEF', '1414E6', '18EF63', '1CDF0F',
  '20BBC0', '24B6FD', '24C9DE', '283656', '28E0A6', '2C3F38', '2C5A05', '2C6BF5',
  '341B22', '3CCE73', '3CDFBD', '40A6B7', '4403A7', '503DE5', '5475D0', '58F39C',
  '5C835D', '60737C', '6422C4', '6CB2AE', '70568D', '745E1C', '7C0ECE', '88F031',
  '8C604F', '90E2BA', '94A7AD', '989E63', '9C57AD', 'A036F0', 'A488DB', 'A89D21',
  'B0FAEB', 'C067AF', 'C4724F', 'D89695', 'DC774C', 'E007F2', 'E04C7F', 'F44E05',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  let deviceType = 'switch';
  const tags = ['network', 'cisco'];

  if (/asa|firepower|firewall|ftd|sonicwall/.test(text)) deviceType = 'firewall';
  else if (/aironet|access point|\bap\b/.test(text))    deviceType = 'ap';
  else if (/asr|isr|csr|router|edge/.test(text))         deviceType = 'router';
  else if (/catalyst|nexus|switch|wsc/.test(text))       deviceType = 'switch';

  return {
    vendor: 'Cisco Systems',
    family: 'Cisco Network Device',
    deviceType,
    tags: [...tags, deviceType],
    confidence: 90,
    infranet: { deviceType, rackEligible: true, floorEligible: false, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
