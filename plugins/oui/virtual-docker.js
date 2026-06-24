'use strict';

// Docker bridge / container default MACs.
//   02:42:..  Docker daemon (default veth and container ranges)

const ouiPrefixes = ['0242'];

const priority = 100;

function match() { return true; }

function enrich() {
  return {
    vendor: 'Docker',
    family: 'Docker veth / container',
    deviceType: 'iot',
    isVirtual: true,
    tags: ['virtual', 'docker', 'veth'],
    confidence: 88,
    infranet: { deviceType: 'iot', rackEligible: false, floorEligible: false, sourcePriority: 'mac-oui' },
  };
}

// Plugin uses a non-IEEE-standard 4-char (16-bit) prefix to capture the full
// 02:42:.. block. The OUI engine accepts arbitrary lengths up to 12, but a 16-
// bit prefix overlaps a lot of unrelated address space owned by IEEE
// registrants. We keep priority equal to the other plugins so longest-prefix-
// wins in the engine still gives precedence to a more specific 24/28/36-bit
// vendor entry when one exists.
module.exports = { ouiPrefixes, priority, match, enrich };
