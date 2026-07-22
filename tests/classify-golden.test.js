'use strict';

// Classification golden — a behavior-preserving safety net for the classifier
// consolidation (B3). A broad corpus of representative device rows (real home-LAN
// devices, the multivendor lab, and vendors NOT on any test network) is run through
// the server classifier; the expected device types are frozen here. Refactors that
// only MOVE code (e.g. extracting the regex tables into lib/device-patterns.js, or
// adding an additive signal) MUST keep every one of these unchanged. A deliberate
// behavior change updates the expectation in the same commit, with a note.
//
// Captured 2026-07-07 from server/classify.js _scoreDiscoveredDevice.

const test = require('node:test');
const assert = require('node:assert/strict');
const { _scoreDiscoveredDevice } = require('../server/classify');

const CORPUS = {
  // --- home-LAN device shapes (sanitized) ---
  'zyxel-intelligent-switch': [{ mac: 'bc:cf:4f:00:00:10', vendor: 'Zyxel', httpTitle: 'Intelligent Switch', alive: true }, 'switch'],
  'zyxel-gateway': [{ ip: '192.168.1.1', mac: 'bc:cf:4f:00:00:01', vendor: 'Zyxel', httpTitle: 'Web-Based Configurator', alive: true }, 'router'],
  'zyxel-gs1200': [{ mac: 'bc:cf:4f:00:00:98', vendor: 'Zyxel', httpTitle: 'GS1200-8', alive: true }, 'switch'],
  'hp-officejet': [{ vendor: 'Hewlett Packard', httpTitle: 'HP OfficeJet', services: [{ port: 9100 }, { port: 80 }], alive: true }, 'printer'],
  'hp-officejet-hostname': [{ vendor: 'Hewlett Packard', hostname: 'HP-OfficeJet', alive: true }, 'printer'],
  'synology-nas': [{ vendor: 'Synology', httpTitle: 'Synology Web', objectId: '1.3.6.1.4.1.6574.1', snmpReachable: true, services: [{ port: 5000 }] }, 'nas'],
  'lacie-nas': [{ vendor: 'LaCie', httpTitle: 'LaCie Dashboard', alive: true }, 'nas'],
  'reolink-cam': [{ vendor: 'Reolink', httpTitle: 'Reolink', services: [{ port: 554 }, { port: 80 }], alive: true }, 'webcam'],
  'eaton-keil-eweb': [{ vendor: 'Eaton', httpTitle: 'Keil-EWEB/2.1', alive: true }, 'iot'],
  'vmware-vm-web': [{ vendor: 'VMware', httpTitle: 'Redirecting to /store/public', alive: true, services: [{ port: 443 }] }, 'server'],
  'apple-mac': [{ vendor: 'Apple', hostname: 'MacBook-Pro', alive: true }, 'pc'],
  'huawei-tablet': [{ vendor: 'Huawei', mac: 'f4:bf:80:00:00:01', alive: true }, 'mobile'],
  'iphone-hostname': [{ hostname: 'iPhone-di-Mario', vendor: 'Apple', alive: true }, 'mobile'],
  'chromecast-cast': [{ vendor: 'Google', cast: true, services: [{ port: 8008 }, { port: 8009 }], alive: true }, 'tv'],
  'shield-cast': [{ vendor: 'NVIDIA', cast: true, services: [{ port: 445 }, { port: 8008 }], alive: true }, 'tv'],
  'lg-webos-tv': [{ vendor: 'LG', mac: '58:fd:b1:00:00:01', httpTitle: 'LG webOS TV', alive: true }, 'tv'],
  'sony-bravia-tv': [{ vendor: 'Sony', httpTitle: 'BRAVIA', alive: true }, 'tv'],
  // NB: the "daikin-AP" hostname trips the generic \bap\b in AP_RE (a known edge case,
  // frozen here so the refactor is proven behavior-preserving; a real Daikin AC with
  // no "AP" hostname classifies iot via the smart-home rule).
  'daikin-azurewave-ac': [{ vendor: 'AzureWave', hostname: 'daikin-AP', alive: true }, 'ap'],
  'hp-pc-smb': [{ vendor: 'Hewlett Packard', services: [{ port: 445 }, { port: 5357 }], smbShares: [{ name: 'C' }, { name: 'D' }], alive: true }, 'pc'],
  // --- lab (multivendor) ---
  'arista-veos': [{ objectId: '1.3.6.1.4.1.30065.1.2759', descr: 'Arista Networks EOS running on vEOS', sysServices: 2 | 4 | 8, snmpReachable: true, hostname: 'lab-switch' }, 'switch'],
  'cisco-wlc': [{ objectId: '1.3.6.1.4.1.9.1.1631', descr: 'Cisco Controller', sysServices: 2, snmpReachable: true }, 'wlanctrl'],
  'cisco-vios-l2': [{ objectId: '1.3.6.1.4.1.9.1.1227', descr: 'Cisco IOS Software, vios_l2', sysServices: 2 | 4 | 8 | 64, snmpReachable: true, hostname: 'core-switch' }, 'switch'],
  'juniper-srx': [{ objectId: '1.3.6.1.4.1.2636.1.1.1.2.96', descr: 'Juniper Networks firefly-perimeter internet router JUNOS', sysServices: 4, snmpReachable: true }, 'router'],
  'vyos-router': [{ descr: 'VyOS router', sysServices: 4, snmpReachable: true, hostname: 'lab-router' }, 'router'],
  // --- vendors NOT on the user network (cross-network generalization) ---
  'fortinet-fw': [{ descr: 'FortiGate-60F', objectId: '1.3.6.1.4.1.12356.101.1', snmpReachable: true }, 'firewall'],
  'paloalto-fw': [{ descr: 'Palo Alto Networks PA-220', snmpReachable: true }, 'firewall'],
  'sonicwall-fw': [{ httpTitle: 'SonicWall', alive: true }, 'firewall'],
  'aruba-cx-switch': [{ descr: 'Aruba CX 6300', objectId: '1.3.6.1.4.1.14823.1.3', sysServices: 2, snmpReachable: true }, 'switch'],
  'aruba-iap': [{ descr: 'Aruba IAP-315 access point', snmpReachable: true }, 'ap'],
  'ubiquiti-uap': [{ hostname: 'UAP-AC-PRO', vendor: 'Ubiquiti', alive: true }, 'ap'],
  'ruckus-ap': [{ descr: 'Ruckus ZoneFlex R610', snmpReachable: true }, 'ap'],
  'netgear-switch': [{ vendor: 'Netgear', httpTitle: 'ProSafe GS716', alive: true }, 'switch'],
  'tplink-router': [{ vendor: 'TP-Link', descr: 'TP-Link Router Archer', alive: true }, 'router'],
  'mikrotik-router': [{ httpTitle: 'RouterOS router configuration', alive: true }, 'router'],
  'qnap-nas': [{ descr: 'QNAP TS-453', snmpReachable: true, hostname: 'qnap-store' }, 'nas'],
  'truenas': [{ descr: 'TrueNAS-13.0', snmpReachable: true }, 'nas'],
  'axis-cam': [{ descr: 'AXIS P3225 Network Camera', snmpReachable: true }, 'webcam'],
  'hikvision-cam': [{ vendor: 'Hikvision', services: [{ port: 554 }], alive: true }, 'webcam'],
  'yealink-voip': [{ descr: 'Yealink SIP-T46S', snmpReachable: true }, 'voip'],
  'grandstream-voip': [{ objectId: '1.3.6.1.4.1.25858.1', snmpReachable: true }, 'voip'],
  'apc-ups': [{ objectId: '1.3.6.1.4.1.318.1.1.1', descr: 'APC Smart-UPS', snmpReachable: true }, 'ups'],
  'raritan-pdu': [{ descr: 'Raritan PX3 PDU', snmpReachable: true }, 'pdu'],
  'windows-desktop': [{ hostname: 'DESKTOP-ABC123', vendor: 'Microsoft', alive: true }, 'pc'],
  'windows-server': [{ descr: 'Microsoft Windows Server 2019', snmpReachable: true }, 'server'],
  'esxi-host': [{ descr: 'VMware ESXi 7.0', objectId: '1.3.6.1.4.1.6876.1', snmpReachable: true }, 'hypervisor'],
  'proxmox-host': [{ descr: 'Proxmox VE pve', snmpReachable: true }, 'hypervisor'],
  'washing-machine': [{ descr: 'LG ThinQ Washing Machine', vendor: 'LG Electronics', alive: true }, 'iot'],
  'dishwasher': [{ descr: 'Bosch Home Connect dishwasher', alive: true }, 'iot'],
  'shelly-iot': [{ hostname: 'shelly1-aabbcc', httpTitle: 'Shelly', alive: true }, 'iot'],
  'sonoff-iot': [{ httpTitle: 'Sonoff', alive: true }, 'iot'],
  'roku-tv': [{ descr: 'Roku Streaming Stick', alive: true }, 'tv'],
  'firetv': [{ descr: 'Amazon Fire TV', alive: true }, 'tv'],
  'samsung-tizen-tv': [{ descr: 'Samsung Smart TV', httpTitle: 'Tizen', alive: true }, 'tv'],
  'bare-ping-only': [{ ip: '10.0.0.9', alive: true }, 'pc'],
  'bare-mac-only': [{ mac: 'aa:bb:cc:dd:ee:ff', alive: true }, 'pc'],
  // --- nuovi tipi (riconciliazione tassonomia 2026-07-22) — casi ADDITIVI, le
  // aspettative sopra sono INVARIATE. Coprono i 2 falsi positivi (KVM/ATS non
  // piu' 'switch') e i nuovi percorsi ats/nvr/vpncon/pbx/consolesvr/projector/
  // kvm/doorctrl; ASA resta firewall (deliberato: un ASA E' un firewall).
  'aten-kvm': [{ vendor: 'ATEN', httpTitle: 'KVM over IP Switch', alive: true }, 'kvm'],
  'apc-ats': [{ descr: 'APC Automatic Transfer Switch AP4423', snmpReachable: true }, 'ats'],
  'hikvision-nvr': [{ vendor: 'Hikvision', httpTitle: 'DS-7608NI NVR', services: [{ port: 554 }], alive: true }, 'nvr'],
  'grandstream-ucm-pbx': [{ objectId: '1.3.6.1.4.1.25858.1', descr: 'Grandstream UCM6302', snmpReachable: true }, 'pbx'],
  'freepbx-server': [{ hostname: 'centralino', httpTitle: 'FreePBX Administration', alive: true }, 'pbx'],
  'opengear-console': [{ descr: 'Opengear IM7200 console server', snmpReachable: true }, 'consolesvr'],
  'epson-projector': [{ vendor: 'Epson', httpTitle: 'EPSON Projector Web Control', alive: true }, 'projector'],
  'anyconnect-vpncon': [{ httpsTitle: 'AnyConnect Secure Mobility', alive: true }, 'vpncon'],
  'altiga-vpncon-oid': [{ objectId: '1.3.6.1.4.1.3076.1.1', snmpReachable: true }, 'vpncon'],
  'cisco-asa-firewall': [{ descr: 'Cisco Adaptive Security Appliance ASA 5516', snmpReachable: true }, 'firewall'],
  'axis-a1001-doorctrl': [{ descr: 'AXIS A1001 Network Door Controller', snmpReachable: true }, 'doorctrl'],
  // Forma REALE dal vivo (LaCie D2 sulla /24 di casa, 2026-07-22): un NAS che si
  // presenta da host SMB (445 + nome NetBIOS, zero SNMP) restava pc perche' i voti
  // SMB/NetBIOS sommavano piu' del brand; ora sono guardati da !score.nas (SMB e'
  // il comportamento di un NAS, non una contraddizione).
  'lacie-d2-smb-nas': [{ hostname: 'LACIED2', vendor: 'LaCie', netbiosName: 'LACIED2', services: [{ port: 21 }, { port: 80 }, { port: 443 }, { port: 445 }], alive: true }, 'nas'],
};

for (const [label, [row, expected]] of Object.entries(CORPUS)) {
  test(`classify-golden: ${label} -> ${expected}`, () => {
    assert.equal(_scoreDiscoveredDevice(row).deviceType, expected);
  });
}
