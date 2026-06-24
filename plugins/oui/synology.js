'use strict';

const ouiPrefixes = [
  '0011328', '00113225', '00113234', '00113280', '001132AB', '001132F1', '001132FF',
  '0050D2', '0CCBB1', '247252', '90090693', '90E61D', '94B86D', 'A0779E', 'A4F69C',
];

const priority = 100;

function match() { return true; }

function enrich(mac, context = {}) {
  return {
    vendor: 'Synology',
    family: 'Synology DiskStation',
    deviceType: 'nas',
    tags: ['storage', 'nas', 'synology', 'dsm'],
    confidence: 94,
    infranet: { deviceType: 'nas', rackEligible: true, floorEligible: true, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
