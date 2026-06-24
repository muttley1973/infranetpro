'use strict';

// Microsoft Hyper-V default virtual switch range.
//   00:15:5D  Hyper-V virtual NIC (Windows Server / Windows 10/11 + WSL2 vEthernet)

const ouiPrefixes = ['00155D'];

const priority = 100;

function match() { return true; }

function enrich() {
  return {
    vendor: 'Microsoft',
    family: 'Hyper-V Virtual NIC',
    deviceType: 'server',
    isVirtual: true,
    tags: ['virtual', 'hypervisor', 'hyperv', 'microsoft'],
    confidence: 92,
    infranet: { deviceType: 'server', rackEligible: true, floorEligible: false, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
