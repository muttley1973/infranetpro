'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  osIconFromString, osIconFromTtlFamily, osIconFromVmGuest, osIconFromNodeOs, osIconFromHvPlatform, osIconFromFamily,
  resolveOsIcon, osIconHtml, osIconHtmlFor, OS_ICON_COLORS,
} = require('../lib/os-icon.js');
const { OS_ICON_SYMBOLS, osIconSprite } = require('../lib/os-icon-sprite.js');

test('osIconFromString: distro/OS specifici → chiave giusta', () => {
  const cases = [
    ['Ubuntu Server 22.04 LTS', 'ubuntu'],
    ['Microsoft Windows Server 2019', 'windows'],
    ['Debian GNU/Linux 12', 'debian'],
    ['CentOS Linux 7', 'rhel'],
    ['Red Hat Enterprise Linux', 'rhel'],
    ['Rocky Linux 9', 'rhel'],
    ['Fedora 39', 'fedora'],
    ['openSUSE Leap', 'suse'],
    ['FreeBSD 13.2-RELEASE', 'bsd'],
    ['TrueNAS (FreeBSD)', 'bsd'],
    ['macOS 14 Sonoma', 'macos'],
    ['Darwin Kernel', 'macos'],
    ['Android 14', 'android'],
    ['VMware ESXi 8.0', 'vmware'],
    ['Proxmox VE 8', 'proxmox'],
    ['Docker 24 / containerd', 'container'],
    ['Raspbian GNU/Linux', 'raspberrypi'],
    ['Raspberry Pi OS', 'raspberrypi'],
    ['Linux 5.15 generic', 'linux'],
  ];
  for (const [str, key] of cases) {
    const d = osIconFromString(str);
    assert.ok(d, `nessun match per "${str}"`);
    assert.equal(d.key, key, `"${str}" → atteso ${key}, ottenuto ${d && d.key}`);
    assert.equal(d.color, OS_ICON_COLORS[key]);
  }
});

test('collisioni: gli OS di rete non finiscono su Apple/Windows/generico', () => {
  assert.equal(osIconFromString('Cisco IOS 15.2').key, 'netdev');
  assert.equal(osIconFromString('JUNOS 21.4').key, 'netdev');
  assert.equal(osIconFromString('MikroTik RouterOS').key, 'netdev');
  assert.equal(osIconFromString('FortiOS 7.2').key, 'netdev');
  // "IOS-XE" non deve diventare Apple, "PVE" resta Proxmox
  assert.equal(osIconFromString('Cisco IOS-XE').key, 'netdev');
  // ⚠️ Extreme: il sysDescr vero dice "ExtremeXOS", la forma corta dice "EXOS".
  // Il confine di parola di /(b)eos(b)/ (Arista) NON cade dentro extremexos —
  // prima di "exos" c'e' una lettera — quindi servono tutt'e due le scritture,
  // e prima di questa riga ogni switch Extreme prendeva l'icona generica.
  assert.equal(osIconFromString('ExtremeXOS (X460-48t) version 16.2.1.4').key, 'netdev');
  assert.equal(osIconFromString('EXOS 31.7').key, 'netdev');
  // E il verso opposto, che e' il motivo del confine di parola: "exos" dentro
  // un'altra parola non deve diventare un apparato di rete.
  assert.equal(osIconFromString('exosphere linux 6.1').key, 'linux');
});

test('stringhe ignote / vuote → null (nessuna icona inventata)', () => {
  assert.equal(osIconFromString(''), null);
  assert.equal(osIconFromString(null), null);
  assert.equal(osIconFromString('QualcosaDiIgnoto 1.0'), null);
});

test('osIconFromTtlFamily: solo le 3 famiglie, colore incluso', () => {
  assert.equal(osIconFromTtlFamily('unix').key, 'linux');
  assert.equal(osIconFromTtlFamily('windows').key, 'windows');
  assert.equal(osIconFromTtlFamily('netdev').key, 'netdev');
  assert.equal(osIconFromTtlFamily('bogus'), null);
});

test('osIconFromVmGuest: guest-OS delle VM (incl. distro aggiunte)', () => {
  assert.equal(osIconFromVmGuest('win-srv').key, 'windows');
  assert.equal(osIconFromVmGuest('win').key, 'windows');
  assert.equal(osIconFromVmGuest('ubuntu').key, 'ubuntu');
  assert.equal(osIconFromVmGuest('debian').key, 'debian');
  assert.equal(osIconFromVmGuest('rhel').key, 'rhel');
  assert.equal(osIconFromVmGuest('fedora').key, 'fedora');
  assert.equal(osIconFromVmGuest('suse').key, 'suse');
  assert.equal(osIconFromVmGuest('linux').key, 'linux');
  assert.equal(osIconFromVmGuest('bsd').key, 'bsd');
  assert.equal(osIconFromVmGuest('macos').key, 'macos');
  assert.equal(osIconFromVmGuest('container').key, 'container');
  assert.equal(osIconFromVmGuest('appliance'), null);
  assert.equal(osIconFromVmGuest('altro'), null);
});

test('osIconFromNodeOs: codici delle select osType/srvOs/tvOs', () => {
  assert.equal(osIconFromNodeOs('win11').key, 'windows');
  assert.equal(osIconFromNodeOs('win10').key, 'windows');
  assert.equal(osIconFromNodeOs('win-srv').key, 'windows');
  assert.equal(osIconFromNodeOs('ubuntu').key, 'ubuntu');
  assert.equal(osIconFromNodeOs('debian').key, 'debian');
  assert.equal(osIconFromNodeOs('rhel').key, 'rhel');
  assert.equal(osIconFromNodeOs('fedora').key, 'fedora');
  assert.equal(osIconFromNodeOs('suse').key, 'suse');
  assert.equal(osIconFromNodeOs('linux').key, 'linux');
  assert.equal(osIconFromNodeOs('bsd').key, 'bsd');
  assert.equal(osIconFromNodeOs('macos').key, 'macos');
  assert.equal(osIconFromNodeOs('esxi').key, 'vmware');
  assert.equal(osIconFromNodeOs('proxmox').key, 'proxmox');
  assert.equal(osIconFromNodeOs('hyperv').key, 'windows');   // Hyper-V (server OS) → Windows
  assert.equal(osIconFromNodeOs('android-tv').key, 'android');
  assert.equal(osIconFromNodeOs('ipados').key, 'macos');
  // OS Linux embedded senza glifo dedicato + 'altro'/'' → null
  assert.equal(osIconFromNodeOs('tizen'), null);
  assert.equal(osIconFromNodeOs('webos'), null);
  assert.equal(osIconFromNodeOs('altro'), null);
  assert.equal(osIconFromNodeOs(''), null);
});

test('resolveOsIcon: nodeOs nella precedenza', () => {
  assert.equal(resolveOsIcon({ nodeOs: 'esxi' }).key, 'vmware');
  assert.equal(resolveOsIcon({ nodeOs: 'esxi' }).confident, true);
  // vmGuest vince su nodeOs
  assert.equal(resolveOsIcon({ vmGuest: 'linux', nodeOs: 'win11' }).key, 'linux');
});

test('osIconFromFamily: famiglie del fingerprint', () => {
  assert.equal(osIconFromFamily('windows').key, 'windows');
  assert.equal(osIconFromFamily('vmware').key, 'vmware');
  assert.equal(osIconFromFamily('macos').key, 'macos');
  assert.equal(osIconFromFamily('ios').key, 'macos');
  assert.equal(osIconFromFamily('android').key, 'android');
  assert.equal(osIconFromFamily('castos'), null);
});

test('osIconFromHvPlatform: piattaforma hypervisor/homelab → logo dedicato', () => {
  assert.equal(osIconFromHvPlatform('esxi').key, 'vmware');
  assert.equal(osIconFromHvPlatform('proxmox').key, 'proxmox');
  assert.equal(osIconFromHvPlatform('docker').key, 'container');
  assert.equal(osIconFromHvPlatform('truenas').key, 'linux');
  assert.equal(osIconFromHvPlatform('nutanix').key, 'nutanix');
  assert.equal(osIconFromHvPlatform('unraid').key, 'unraid');
  assert.equal(osIconFromHvPlatform('kvm').key, 'qemu');       // KVM → stack QEMU/KVM
  assert.equal(osIconFromHvPlatform('hyperv').key, 'windows');   // Hyper-V → Windows (Microsoft)
  assert.equal(osIconFromHvPlatform('azurelocal').key, 'azure'); // Azure Local → logo Azure a colori (CC0 VLZ)
  // senza logo dedicato in nessuna raccolta CC0 → nessuna icona
  assert.equal(osIconFromHvPlatform('xcpng'), null);
  assert.equal(osIconFromHvPlatform('altro'), null);
  // precedenza nel resolver
  assert.equal(resolveOsIcon({ hvPlatform: 'esxi' }).key, 'vmware');
  assert.equal(resolveOsIcon({ hvPlatform: 'esxi' }).confident, true);
});

test('resolveOsIcon: confident true da stringa, false da TTL', () => {
  assert.equal(resolveOsIcon('Ubuntu 22.04').confident, true);
  assert.equal(resolveOsIcon({ ttlFamily: 'unix' }).confident, false);
  assert.equal(resolveOsIcon({ ttlFamily: 'unix' }).key, 'linux');
  assert.equal(resolveOsIcon('boh'), null);
  assert.equal(resolveOsIcon(null), null);
});

test('resolveOsIcon: precedenza autorevole > TTL', () => {
  // vmGuest vince su os; os vince sul ripiego TTL
  assert.equal(resolveOsIcon({ vmGuest: 'win-srv', os: 'Ubuntu' }).key, 'windows');
  const d = resolveOsIcon({ os: 'Debian 12', ttlFamily: 'windows' });
  assert.equal(d.key, 'debian');
  assert.equal(d.confident, true);
  // solo TTL disponibile → famiglia, non confident
  assert.equal(resolveOsIcon({ ttlFamily: 'windows' }).confident, false);
});

test('osIconHtml: null→vuoto, muted quando non confident, colore solo con accent+confident', () => {
  assert.equal(osIconHtml(null), '');
  // confident + accent → colore inline del brand
  const accent = osIconHtml({ key: 'ubuntu', color: '#E95420', confident: true }, { accent: true });
  assert.match(accent, /color:#E95420/);
  assert.match(accent, /<use href="#os-ubuntu">/);
  assert.doesNotMatch(accent, /os-muted/);
  // confident + no accent → neutro (nessun colore inline)
  const neutral = osIconHtml({ key: 'ubuntu', color: '#E95420', confident: true }, {});
  assert.doesNotMatch(neutral, /color:/);
  assert.doesNotMatch(neutral, /os-muted/);
  // non confident → muted, MAI colore anche con accent
  const muted = osIconHtml({ key: 'linux', color: '#FCC624', confident: false }, { accent: true });
  assert.match(muted, /os-muted/);
  assert.doesNotMatch(muted, /color:/);
});

test('osIconHtmlFor: scorciatoia input→markup', () => {
  const html = osIconHtmlFor('VMware ESXi 8.0', { accent: true });
  assert.match(html, /<use href="#os-vmware">/);
  assert.match(html, /color:#7F9BA6/);
});

test('integrità sprite: ogni chiave prodotta ha un <symbol> e viceversa', () => {
  // tutte le chiavi che il resolver può emettere
  const produced = new Set();
  for (const v of Object.values(OS_ICON_COLORS)) void v;
  for (const k of Object.keys(OS_ICON_COLORS)) produced.add(k);
  for (const k of produced) {
    assert.ok(OS_ICON_SYMBOLS[k], `manca il simbolo per "${k}"`);
  }
  // lo sprite emette un <symbol id="os-<key>"> per ogni simbolo
  const sprite = osIconSprite();
  for (const k of Object.keys(OS_ICON_SYMBOLS)) {
    assert.ok(sprite.includes('id="os-' + k + '"'), `sprite senza os-${k}`);
  }
  assert.match(sprite, /fill="currentColor"/);
  // i monocromatici hanno viewBox 24x24 + fill=currentColor; azure è a COLORI:
  // viewBox proprio e NESSUN currentColor sul suo <symbol> (colori/gradienti propri).
  assert.equal(OS_ICON_SYMBOLS.linux.mono, true);
  assert.equal(OS_ICON_SYMBOLS.azure.mono, false);
  assert.equal(OS_ICON_SYMBOLS.vmware.mono, false);   // VMware = logo a colori (dashboard-icons)
  const azureSym = sprite.match(/<symbol id="os-azure"[^>]*>/)[0];
  assert.match(azureSym, /viewBox="0 0 256 242"/);
  assert.doesNotMatch(azureSym, /fill="currentColor"/);
  const vmwareSym = sprite.match(/<symbol id="os-vmware"[^>]*>/)[0];
  assert.match(vmwareSym, /viewBox="0 0 605 604"/);
  assert.doesNotMatch(vmwareSym, /fill="currentColor"/);
});
