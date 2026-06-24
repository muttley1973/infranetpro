'use strict';

const vendorPrefix = '1.3.6.1.4.1.8072';

function match(oid) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  const isNas = /truenas|freenas|openmediavault|nas|storage/.test(text);
  const isHypervisor = /proxmox|pve|xcp-ng|xenserver|kvm|hypervisor/.test(text);
  const isVmHost = isHypervisor || /esxi|vmware/.test(text);
  const deviceType = isNas ? 'nas' : (isVmHost || /server|ubuntu|debian|centos|red hat|suse|freebsd/.test(text) ? 'server' : 'pc');
  const osName = osNameFromText(text);

  return {
    vendor: 'Net-SNMP',
    deviceType,
    family: 'Net-SNMP Agent',
    confidence: 84,
    tags: ['os', 'net-snmp', 'snmp', deviceType],
    os: {
      family: osName.family,
      vendor: osName.vendor,
      name: osName.name,
      confidence: osName.confidence,
      tags: ['net-snmp', osName.family],
    },
    infranet: { deviceType, rackEligible: deviceType !== 'pc', floorEligible: true, sourcePriority: 'sysObjectID' },
  };
}

function osNameFromText(text) {
  if (/truenas/.test(text)) return { family: 'bsd', vendor: 'iXsystems', name: 'TrueNAS', confidence: 90 };
  if (/freenas/.test(text)) return { family: 'bsd', vendor: 'iXsystems', name: 'FreeNAS', confidence: 90 };
  if (/freebsd/.test(text)) return { family: 'bsd', vendor: 'FreeBSD', name: 'FreeBSD', confidence: 86 };
  if (/proxmox|\bpve\b/.test(text)) return { family: 'linux', vendor: 'Proxmox', name: 'Proxmox VE', confidence: 90 };
  if (/ubuntu/.test(text)) return { family: 'linux', vendor: 'Canonical', name: 'Ubuntu Linux', confidence: 84 };
  if (/debian/.test(text)) return { family: 'linux', vendor: 'Debian', name: 'Debian Linux', confidence: 84 };
  if (/centos|red hat|rhel|rocky|alma/.test(text)) return { family: 'linux', vendor: 'Red Hat ecosystem', name: 'Enterprise Linux', confidence: 82 };
  return { family: 'linux', vendor: 'Net-SNMP', name: 'Unix/Linux', confidence: 72 };
}

module.exports = { vendorPrefix, match, enrich };
