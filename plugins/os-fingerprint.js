'use strict';

const vendorPrefix = '0';

function match(oid, context = {}) {
  return !!infer(context);
}

function enrich(oid, context = {}) {
  return infer(context);
}

function infer(context = {}) {
  const text = collectText(context);
  const vendor = String(context.vendor || '').toLowerCase();
  const mac = String(context.mac || '').toLowerCase();
  const services = new Set((context.services || []).map(s => parseInt(s.port, 10)).filter(Number.isFinite));

  if (/windows server|microsoft windows server|hyper-v/.test(text)) {
    return osRecord('Microsoft', 'server', 'Windows Server', 'windows', 'Microsoft', 82, ['windows', 'server']);
  }
  if (/windows|workgroup|desktop-|^win[0-9-]|netbios/.test(text) || services.has(3389)) {
    return osRecord('Microsoft', 'pc', 'Windows', 'windows', 'Microsoft', services.has(3389) ? 78 : 68, ['windows']);
  }
  if (/proxmox|\bpve\b/.test(text)) {
    return osRecord('Proxmox', 'server', 'Proxmox VE', 'linux', 'Proxmox', 86, ['linux', 'hypervisor']);
  }
  if (/truenas|freenas/.test(text)) {
    return osRecord('iXsystems', 'nas', /freenas/.test(text) ? 'FreeNAS' : 'TrueNAS', 'bsd', 'iXsystems', 88, ['storage', 'nas']);
  }
  if (/vmware|esxi|vsphere/.test(text)) {
    return osRecord('VMware', 'server', 'VMware ESXi', 'vmware', 'VMware', 86, ['hypervisor']);
  }
  if (/ubuntu server|debian|centos|red hat|rhel|rocky linux|alma linux|suse|freebsd|linux/.test(text)) {
    return osRecord('Linux/Unix', 'server', 'Linux/Unix', /freebsd/.test(text) ? 'bsd' : 'linux', 'Linux/Unix', 70, ['linux']);
  }
  if (/iphone|ipad|\bios\b|ios device/.test(text)) {
    return osRecord('Apple', 'pc', /ipad/.test(text) ? 'iPadOS' : 'iOS', /ipad/.test(text) ? 'ipados' : 'ios', 'Apple', 72, ['apple', 'mobile']);
  }
  if (/macbook|imac|mac mini|macos|mac os|darwin/.test(text) || /apple/.test(vendor)) {
    return osRecord('Apple', 'pc', 'macOS', 'macos', 'Apple', 76, ['apple', 'desktop']);
  }
  if (/android tv|google tv|shield tv|bravia android/.test(text)) {
    return osRecord('Android', 'tv', 'Android TV', 'android', 'Google', 76, ['android', 'tv']);
  }
  if (/android/.test(text) || /google|samsung|xiaomi|oneplus|huawei|oppo|vivo/.test(vendor)) {
    return osRecord('Android', 'pc', 'Android', 'android', 'Google', 62, ['android', 'mobile']);
  }
  if (/chromecast|google cast/.test(text)) {
    return osRecord('Google', 'iot', 'Cast OS', 'castos', 'Google', 70, ['cast', 'media']);
  }
  if (mac.startsWith('00:05:02') || mac.startsWith('00:03:93') || /apple/.test(vendor)) {
    return osRecord('Apple', 'pc', 'Apple OS', 'apple', 'Apple', 55, ['apple']);
  }

  return null;
}

function collectText(context) {
  const services = (context.services || []).map(s => `${s.service || ''} ${s.banner || ''}`).join(' ');
  const shares = (context.smbShares || []).map(s => `${s.name || s} ${s.type || ''} ${s.comment || ''}`).join(' ');
  return [
    context.descr,
    context.hostname,
    context.vendor,
    context.httpTitle,
    context.httpsTitle,
    context.netbiosName,
    context.netbiosGroup,
    services,
    shares,
  ].filter(Boolean).join(' ').toLowerCase();
}

function osRecord(vendor, deviceType, name, family, osVendor, confidence, tags) {
  return {
    vendor,
    deviceType,
    family: name,
    confidence,
    tags: ['os-fingerprint', ...tags],
    os: {
      family,
      vendor: osVendor,
      name,
      confidence,
      tags,
    },
    infranet: { deviceType, rackEligible: deviceType === 'server' || deviceType === 'nas', floorEligible: true, sourcePriority: 'fingerprint' },
  };
}

module.exports = { vendorPrefix, match, enrich };
