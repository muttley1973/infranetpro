// ============================================================
// OS ICON — risolutore PURO stringa/famiglia/TTL/guest-VM → icona (UMD-lite)
// ============================================================
// Gemella di lib/os-hint.js. Data una descrizione OS (da SNMP sysDescr, dal
// guest-OS di una VM, dal fingerprint, o dalla famiglia TTL) restituisce QUALE
// glifo mostrare e in che COLORE — col gate di confidenza:
//   - sorgente autorevole (sysDescr / manuale / fingerprint) → confident:true,
//     il colore ufficiale del brand è disponibile per i punti d'accento;
//   - solo indizio TTL (peso basso) → confident:false, il chiamante lo rende in
//     grigio (mai un logo di distro da un TTL: il TTL non distingue Ubuntu da Debian).
//   - nessun segnale → null → NESSUNA icona (niente default inventato, schema ①).
// I glifi vivono in lib/os-icon-sprite.js (<symbol id="os-<key>">); qui si emette
// solo <use href="#os-<key>">. Vendor-neutral: matching per parole-chiave su testo
// MISURATO, nessun quirk di prodotto. Condiviso browser + Node (test).
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Colori UFFICIALI dei brand (per i punti d'accento). vmware alleggerito per la
  // leggibilità su fondo scuro; hypervisor/netdev sono concetti generici → tinta neutra-tech.
  const OS_ICON_COLORS = {
    windows: '#00A4EF', linux: '#FCC624', macos: '#A2AAAD', ubuntu: '#E95420',
    debian: '#A81D33', rhel: '#EE0000', fedora: '#51A2DA', suse: '#73BA25',
    bsd: '#AB2B28', android: '#3DDC84', raspberrypi: '#C51A4A',
    vmware: '#7F9BA6', proxmox: '#E57000', nutanix: '#024DA1', unraid: '#F15A2C',
    qemu: '#FF6600', azure: '#0078D4', hypervisor: '#4EB1A6', container: '#2496ED', netdev: '#00D4FF',
  };

  // Matcher ORDINATO: le voci con collisioni note vanno PRIMA.
  //  - gli OS di rete (JunOS/RouterOS/…) prima dell'"ios" Apple e del generico;
  //  - gli hypervisor di prodotto prima di Windows (un ESXi non è un PC Windows);
  //  - le distro specifiche prima del generico "linux".
  const MATCHERS = [
    { re: /junos|routeros|\bvyos\b|edgeos|fortios|pan-?os|arubaos|screenos|nx-?os|ios[ _-]?xe|ios[ _-]?xr|cisco ios|\beos\b/, key: 'netdev', family: 'netdev' },
    { re: /esxi|vmware|vsphere/, key: 'vmware', family: 'hypervisor' },
    { re: /proxmox|\bpve\b/, key: 'proxmox', family: 'hypervisor' },
    { re: /xenserver|\bxen\b|\bkvm\b|\bqemu\b|hyper-?v/, key: 'hypervisor', family: 'hypervisor' },
    { re: /docker|containerd|podman|\blxc\b|\bcontainer\b/, key: 'container', family: 'container' },
    { re: /windows|win32|win64|winnt|\bwin ?(?:srv|server|10|11|7|8)\b|microsoft/, key: 'windows', family: 'windows' },
    { re: /ubuntu/, key: 'ubuntu', family: 'unix' },
    { re: /raspbian|raspberry ?pi ?os|raspberrypi/, key: 'raspberrypi', family: 'unix' },
    { re: /debian/, key: 'debian', family: 'unix' },
    { re: /red ?hat|rhel|centos|rocky ?linux|alma ?linux|oracle linux|amazon linux|scientific linux/, key: 'rhel', family: 'unix' },
    { re: /fedora/, key: 'fedora', family: 'unix' },
    { re: /suse|sles|sled/, key: 'suse', family: 'unix' },
    { re: /freebsd|openbsd|netbsd|dragonfly|\bbsd\b|pfsense|opnsense|truenas|freenas/, key: 'bsd', family: 'unix' },
    { re: /mac ?os|macos|os ?x\b|osx|darwin|macbook|imac|mac ?mini|macintosh/, key: 'macos', family: 'unix' },
    { re: /iphone|ipad|ipados|watchos|tvos/, key: 'macos', family: 'unix' },
    { re: /android/, key: 'android', family: 'unix' },
    { re: /linux|\bunix\b|\bgnu\b|solaris|sunos|\baix\b|hp-?ux/, key: 'linux', family: 'unix' },
  ];

  const TTL_KEY = { unix: 'linux', windows: 'windows', netdev: 'netdev' };

  // guest-OS delle VM (lib/app-properties-vm.js _VM_GUEST_OS). 'appliance'/'altro'
  // = nessun OS certo → null (non si inventa un logo).
  const VM_GUEST_KEY = {
    'win-srv': 'windows', 'win': 'windows',
    'ubuntu': 'ubuntu', 'debian': 'debian', 'rhel': 'rhel', 'fedora': 'fedora', 'suse': 'suse',
    'linux': 'linux', 'bsd': 'bsd', 'macos': 'macos', 'container': 'container',
  };

  // Codici OS dei nodi (le select osType/srvOs/tvOs in app-properties-node-devices.js).
  // 'tizen'/'webos' (Linux embedded senza glifo dedicato) e 'altro'/'' → null: nessun
  // logo inventato per un OS che non sappiamo rappresentare.
  const NODE_OS_KEY = {
    win11: 'windows', win10: 'windows', 'win-srv': 'windows',
    ubuntu: 'ubuntu', debian: 'debian', rhel: 'rhel', fedora: 'fedora', suse: 'suse',
    linux: 'linux', bsd: 'bsd', macos: 'macos',
    ios: 'macos', ipados: 'macos',
    android: 'android', 'android-tv': 'android', 'google-tv': 'android',
    proxmox: 'proxmox', esxi: 'vmware', hyperv: 'windows',
  };

  // Famiglie prodotte dal fingerprint (plugins/os-fingerprint.js os.family).
  const FAMILY_KEY = { windows: 'windows', linux: 'linux', bsd: 'bsd', vmware: 'vmware', macos: 'macos', apple: 'macos', ios: 'macos', ipados: 'macos', android: 'android' };

  // Piattaforma di un hypervisor/homelab (campo hvPlatform, app-hypervisor.js) →
  // logo dedicato: Azure Local (Stack HCI) usa il logo Azure a colori (CC0 da
  // VectorLogoZone); Hyper-V usa il logo Windows (tecnologia Microsoft); kvm usa il
  // logo QEMU dello stack QEMU/KVM. XCP-ng non ha logo CC0 → null: niente logo
  // inventato. TrueNAS Scale = Debian-based. (Il vSphere Client verde/giallo NON
  // esiste in nessuna raccolta CC0 → VMware resta il logo monocromatico.)
  const HV_PLATFORM_KEY = { esxi: 'vmware', proxmox: 'proxmox', docker: 'container', truenas: 'linux', nutanix: 'nutanix', unraid: 'unraid', kvm: 'qemu', hyperv: 'windows', azurelocal: 'azure' };

  function _mk(key, family) {
    if (!key) return null;
    return { key, color: OS_ICON_COLORS[key] || null, family: family || null };
  }

  // Stringa OS (autorevole) → { key, color, family } | null.
  function osIconFromString(str) {
    const s = String(str == null ? '' : str).toLowerCase();
    if (!s.trim()) return null;
    for (const m of MATCHERS) if (m.re.test(s)) return _mk(m.key, m.family);
    return null;
  }

  // Famiglia TTL ('unix'|'windows'|'netdev') → glifo di famiglia (peso basso).
  function osIconFromTtlFamily(fam) {
    const k = TTL_KEY[String(fam == null ? '' : fam).toLowerCase()];
    return k ? _mk(k, String(fam).toLowerCase()) : null;
  }

  // guest-OS di una VM → { key, color, family } | null.
  function osIconFromVmGuest(guest) {
    const k = VM_GUEST_KEY[String(guest == null ? '' : guest).toLowerCase()];
    return k ? _mk(k, k === 'windows' ? 'windows' : k === 'container' ? 'container' : 'unix') : null;
  }

  // Codice OS di un nodo (osType / srvOs / tvOs) → { key, color, family } | null.
  function osIconFromNodeOs(code) {
    const k = NODE_OS_KEY[String(code == null ? '' : code).toLowerCase()];
    return k ? _mk(k, k === 'windows' ? 'windows' : (k === 'vmware' || k === 'hypervisor' || k === 'proxmox') ? 'hypervisor' : 'unix') : null;
  }

  // Piattaforma di un hypervisor/homelab → { key, color, family } | null.
  function osIconFromHvPlatform(code) {
    const k = HV_PLATFORM_KEY[String(code == null ? '' : code).toLowerCase()];
    if (!k) return null;
    const fam = k === 'windows' ? 'windows' : k === 'container' ? 'container' : (['vmware', 'proxmox', 'qemu', 'nutanix', 'azure'].indexOf(k) >= 0) ? 'hypervisor' : 'unix';
    return _mk(k, fam);
  }

  // Famiglia del fingerprint → { key, color, family } | null.
  function osIconFromFamily(fam) {
    const k = FAMILY_KEY[String(fam == null ? '' : fam).toLowerCase()];
    return k ? _mk(k, k === 'windows' ? 'windows' : k === 'vmware' ? 'hypervisor' : 'unix') : null;
  }

  // Risolutore unico con PRECEDENZA. input:
  //   string  → trattata come stringa OS autorevole
  //   object  → { vmGuest?, os?, family?, ttlFamily? } (autorevoli prima, TTL ultimo)
  // Ritorna { key, color, family, confident } | null.
  function resolveOsIcon(input) {
    if (input == null) return null;
    if (typeof input === 'string') {
      const d = osIconFromString(input);
      return d ? Object.assign(d, { confident: true }) : null;
    }
    let d = null;
    if (input.vmGuest) d = osIconFromVmGuest(input.vmGuest);
    if (!d && input.nodeOs) d = osIconFromNodeOs(input.nodeOs);
    if (!d && input.hvPlatform) d = osIconFromHvPlatform(input.hvPlatform);
    if (!d && input.os) d = osIconFromString(input.os);
    if (!d && input.family) d = osIconFromFamily(input.family);
    if (d) return Object.assign(d, { confident: true });
    if (input.ttlFamily) {
      const t = osIconFromTtlFamily(input.ttlFamily);
      if (t) return Object.assign(t, { confident: false });
    }
    return null;
  }

  // Descrittore → markup <svg><use>. Regole colore/confidenza:
  //   confident:false          → grigio (classe os-muted), MAI colore del brand;
  //   confident:true + accent  → colore ufficiale inline (badge / intestazione);
  //   confident:true, no accent → neutro: eredita currentColor dal contesto (liste).
  // descriptor null → '' (nessuna icona). opts: { accent?, size?, cls? }.
  function osIconHtml(descriptor, opts) {
    if (!descriptor || !descriptor.key) return '';
    const o = opts || {};
    const muted = descriptor.confident === false;
    let cls = 'os-ico';
    if (muted) cls += ' os-muted';
    if (o.cls) cls += ' ' + o.cls;
    let style = '';
    if (o.accent === true && !muted && descriptor.color) style += 'color:' + descriptor.color + ';';
    if (o.size) style += 'width:' + o.size + 'px;height:' + o.size + 'px;';
    const styleAttr = style ? ' style="' + style + '"' : '';
    return '<svg class="' + cls + '"' + styleAttr + ' aria-hidden="true"><use href="#os-' + descriptor.key + '"></use></svg>';
  }

  // Comodità: input → markup direttamente.
  function osIconHtmlFor(input, opts) {
    return osIconHtml(resolveOsIcon(input), opts);
  }

  return {
    OS_ICON_COLORS,
    osIconFromString, osIconFromTtlFamily, osIconFromVmGuest, osIconFromNodeOs, osIconFromHvPlatform, osIconFromFamily,
    resolveOsIcon, osIconHtml, osIconHtmlFor,
  };
});
