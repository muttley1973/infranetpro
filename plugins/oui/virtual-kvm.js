'use strict';

// QEMU / KVM default range (libvirt, Proxmox, virt-manager).
//   52:54:00  locally administered, used by QEMU as default

const ouiPrefixes = ['525400'];

const priority = 100;

function match() { return true; }

function enrich() {
  return {
    vendor: 'QEMU / KVM',
    family: 'KVM Virtual NIC',
    deviceType: 'server',
    isVirtual: true,
    tags: ['virtual', 'hypervisor', 'kvm', 'qemu'],
    confidence: 90,
    infranet: { deviceType: 'server', rackEligible: true, floorEligible: false, sourcePriority: 'mac-oui' },
  };
}

module.exports = { ouiPrefixes, priority, match, enrich };
