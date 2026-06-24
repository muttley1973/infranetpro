'use strict';

// VMware ESX/Workstation/Fusion virtual NIC ranges.
//   00:50:56  vSphere / Workstation (user-assigned)
//   00:0C:29  ESXi auto-assigned
//   00:05:69  legacy ESX 2.x

const ouiPrefixes = ['005056', '000C29', '000569'];

const priority = 100;

function match() { return true; }

function enrich() {
  return {
    vendor: 'VMware',
    family: 'VMware Virtual NIC',
    deviceType: 'server',
    isVirtual: true,
    tags: ['virtual', 'hypervisor', 'vmware'],
    confidence: 92,
    infranet: { deviceType: 'server', rackEligible: true, floorEligible: false, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
