'use strict';

// Xen / Citrix XenServer / XCP-ng virtual NIC ranges.
//   00:16:3E  XenSource Xen virtual NIC

const ouiPrefixes = ['00163E'];

const priority = 100;

function match() { return true; }

function enrich() {
  return {
    vendor: 'XenSource',
    family: 'Xen Virtual NIC',
    deviceType: 'server',
    isVirtual: true,
    tags: ['virtual', 'hypervisor', 'xen'],
    confidence: 90,
    infranet: { deviceType: 'server', rackEligible: true, floorEligible: false, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
