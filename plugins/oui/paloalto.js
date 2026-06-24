'use strict';

const ouiPrefixes = [
  '001B17', '08D40C', '64ED57', '94DFB8', 'B40C25', 'D440FB', 'E80188', 'F4F26D',
];

const priority = 100;

function match() { return true; }

function enrich() {
  return {
    vendor: 'Palo Alto Networks',
    family: 'Palo Alto Firewall',
    deviceType: 'firewall',
    tags: ['network', 'security', 'paloalto', 'firewall'],
    confidence: 92,
    infranet: { deviceType: 'firewall', rackEligible: true, floorEligible: false, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
