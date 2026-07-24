# Changelog

What's new in InfraNet Pro. Format loosely based on [Keep a Changelog](https://keepachangelog.com/); dates are ISO-8601, newest first. One line per change — the reasoning behind each fix lives in the commit history.

## 2026-07-24 — An absent field no longer states an invented default

Open a device with no brand recorded and the properties panel pre-selected **"Dell"** — and "Windows 11", "Cisco", "Hikvision", "patch cord". None of it was in the data: the `<select>` defaulted its first option with `n.field || 'Dell'`, painting a confident identity the system had never observed. On the sample projects that is **81 false assertions across 30 of 35 nodes** for brand alone, and every one of **17/17 cables** labelled "patch cord" without anyone saying so. A code audit sees a correct default; only the output, read against real data, shows the label lying. (Schema ① of the semantic audit: absent → strong claim.)

### Fixed
- **Identity selects say "— non specificato —" when the field is absent.** The 18 selects that declare *what a device is* — brand, OS, platform across 15 device types — now carry a blank placeholder as their first, selected-when-empty option, and drop the `|| 'default'` that used to pre-pick a real value. Nothing is written to the model until the user chooses; the technical defaults (PoE, wired, L2, mount…) stay, as they describe a typical setup rather than an observed identity. `src/app-properties-node-devices.js`; golden baseline regenerated (15 panels — placeholder added, strong default de-selected, nothing else moved).
- **Cable type is honestly tri-state: unspecified / patch cord / permanent.** `isPermanent` was `true`-or-absent, and the link normalizer actively deleted any non-`true` value, so an unclassified cable rendered as "patch cord" everywhere — including the physical **cable label** a technician sticks on the wire ("bretella"). It now keeps an explicit `false` (a chosen patch cord) distinct from absent (unspecified); the panel select, the segment/summary counts, `cable-labels`, and `label-sheet` all omit the claim when nothing was said. `lib/link-model.js`, `src/app.js`, `src/app-properties-link.js`, `lib/cable-labels.js`, `server/label-sheet.js`, +tests, golden `scope:link`.

## 2026-07-23 — A blind Check no longer reports "documentation aligned"

The Verify banner has three outcomes: anomalies to act on, *blind* (nothing could be verified), and *aligned* (reality was compared and matched). The middle one was unreachable exactly when it mattered. When a Check observed nothing at all — no switch returned a forwarding table, no reachability sweep ran — the presence audit was skipped wholesale, so the documented devices landed in neither the "unverified" bucket nor anywhere else. The counts read `{consistent:0, unverified:0}`, indistinguishable from an empty project, and the banner declared **"Documentazione allineata"** over devices it had never looked at. On the 500-device bench that is **487 devices** reported as fine by a Check that saw none of them.

### Fixed
- **"Aligned" now requires that something was actually verified.** `buildDriftReport` already knew the honest fact (`sweepRan`) but did not pass it on; it now also exposes `evaluated` — whether there was any observability — and `docCount` — how many documented devices a Check *should* have reached. `driftBannerKind` reads the report alongside the counts and returns *blind*, not *aligned*, when zero devices were compared on a non-empty project. A genuinely empty project (`docCount:0`) stays *aligned* — there is nothing to alarm. Called with counts only it behaves as before, so nothing else moves. `lib/drift-report.js`, `src/app-drift.js`, +2 regression tests measuring the 487-device case end to end.

## 2026-07-23 — The "documented" percentage was counting the wrong devices

The sub-header reports how much of the addressing is documented. On a real project it read **19/19 · 100%** — while twelve switches, routers, an hypervisor, a server and a WLAN controller, all carrying an IP, were not in the denominator at all. The percentage happened to be right; the population it described was not.

### Fixed
- **An active device is addressable even without the `hasIP` flag.** In the type catalogue `hasIP` marks only the *non-active* types that can still hold an address — UPS, PDU, ATS, media converter, and the floor endpoints; on switches, routers, firewalls, hypervisors and controllers the address is implicit in `isActive`, which is why the rest of the codebase asks `isActive || hasIP` in six places. The statistics engine asked for `hasIP` alone. On *Rete+Lab* the count goes from 19 to **31 addressable devices**; on the 500-device bench the documented share becomes 99% of 490 instead of a subset. `lib/subbar-stats.js`.
- **The test fixture described a catalogue that does not exist** — it declared `switch: { hasIP: true }`, so the suite was green while production was wrong. It now mirrors `src/app-types.js`, plus a regression test pinning that an active type with no `hasIP` counts, and that an active device *without* an address lowers the percentage instead of vanishing from it. The catalogue itself now states the rule where the flag is missing, rather than implying it in a section heading. `test/subbar-stats.test.js`, `src/app-types.js`.

## 2026-07-23 — Looking is not editing: the Topology view no longer marks the project as unsaved

Switching to the Topology view turned the Save button amber. Nothing had been edited — and an unsaved-changes indicator that fires when you merely *look* at something is worse than no indicator: it teaches you to ignore the one signal that tells you whether your documentation is safe on disk.

### Fixed
- **The view controls are chrome, not canvas.** `#map-view-bar` (the Topology toggle and the VLAN filter) is positioned inside `<main id="floorplan">` so it stays fixed while the map pans and zooms. `handlePointerDown` reads that as a click on the empty map: it cleared the selection and opened a pan, and the matching `pointerup` called `markDirty()`. The bar now sits in the same exclusion list that already covered the zoom controls — which also means clicking it no longer deselects what you had selected. `src/app-pointer.js`.
- **A pan that moved nothing is not a change.** Floor and rack pans marked the document dirty on every `pointerup`, including a plain click that never moved the pointer. Both now use the same 5px threshold as a drag, so only a real pan counts. The view *is* saved with the project, so a genuine pan still marks it dirty — that part was correct. `src/app-pointer.js`, +1 e2e covering both views and the real-pan case.

## 2026-07-23 — Name first: a floor plan made of IP addresses is a dump, not documentation

Half the devices on a real map read `192.168.1.133`. Not because the renderer preferred the address — it already asked for `n.name` — but because **the name *was* the address**: when Discover finds no usable hostname, `_discDisplayName` falls back to the IP and that is what lands in `node.name`. On the sample project it happens to **19 devices out of 34**. The same value then repeated itself in the asset register, one column away from the IP column.

Writing a made-up name into the document was not an option: `node.name` is a declared field and no engine gets to guess it. So the label is **derived for display only**, from what is already measured — the type (classifier) and the vendor (OUI) — and `node.name` is never rewritten.

### Added
- **`lib/node-label.js` (new, pure + 24 unit tests)** — `nodeLabelParts()` splits a device into a readable part and an address, recognising the name-equals-address case; `normalizeVendor()` turns the IEEE company name into a brand (`Cisco Systems, Inc.` → `Cisco`, `Hangzhou Hikvision Digital Technology Co.,Ltd.` → `Hikvision`) by stripping generic corporate suffixes, always slicing the original string so internal capitals survive (`MikroTik`, `LaCie`, `AzureWave`). OUI placeholders for randomised MACs (`Private`, `Unknown`, `n/a`…) are **not** brands and never printed as one. `tsconfig.json`.
- **Short type labels, translated** — `type.short.*` (17 keys × it/en) plus `typeShort()` in `src/app-types.js`. Catalogue names are written for a dropdown: on a 60px node "Dispositivo IoT" says nothing (everything is a device) and "Smart TV / Media Player" overflows. Names with a separator are cut mechanically at the first `/`, `(` or em dash; the ones that are prose get an explicit short form. `lib/i18n.js`.
- **The floor label became two lines** — what it is on top, where it is underneath, in a lighter tone. A declared name is rendered at full weight, a derived one lighter, so the two are never confused. `src/app-render-core.js`, `styles/04-floor-rack.css`, +1 e2e asserting `node.name` is not rewritten.

### Changed
- **`getNodeDisplayName()` finally does what it always said it did.** Its fallback (`n.name || typeName(n.type)`) had never once fired, because a name was always present. Routing it through the new lib fixes **59 call sites at once**: drift report, audit log, L3 map, cabling editor, L2 segment panel, hypervisor toasts, search. `src/app.js`.
- **Cable labels and the dossier read the same way** — automatic cable label, node text in the exported floor SVG, as-built cable paths, VLAN-by-device. `src/app.js`, `export.js`.
- **The asset register answers "which device", not "which address".** The *Device* column repeated the IP column for those 19 rows; it now carries the derived label, following the dossier's language. The DTO is untouched: those objects are the **REST API v1 contract**, so the change lives in the renderer and a test pins that `d.name` is not mutated. `server/pdf-report.js`, `test/pdf-report.test.js`.

## 2026-07-22 — vNIC ports: a VM can finally have more than one network card

A VM record held **one** address (`vm.ip/ip6/mac/vlan`), so a virtual firewall with WAN + LAN + DMZ could be documented for a third of what it is. The gap was already leaking into the code in two places: `lib/vlan-trunk.js` carried a comment about squeezing multi-vNIC appliances into a comma-separated `vm.vlan`, and the SNMP read gave up whenever it measured more than one MAC, because there was only one field to write it into.

The obvious move — copy the **Network ports** accordion from the PC panel — was **rejected**, and deliberately so. On a floor device that accordion is not descriptive: `n.ports` generates real cable endpoints (`<nodeId>-<i>` LEDs you can wire). A vNIC has no cable: it plugs into a port group on a vSwitch whose uplink is the host's physical NIC, already documented and already cabled. And with uplinks in teaming, *which* physical NIC carries a given VM is decided by the load-balancing policy — not knowable, therefore not declared.

### Added
- **`vm.nics[]` — the VM's network identity, one entry per virtual card**, with its own **"vNIC ports" accordion** in the VM card (after *Network & access*, which keeps hostname and the management console). Each card carries name, IP, VLAN, MAC, IPv6 and **port group / vSwitch**. Field names were chosen to coincide with what a hypervisor API returns (vSphere port group, Proxmox bridge), so a future driver populates them without changing shape. The card shows one empty row from the start — typing in it *is* what creates the interface — and the last one has no delete button: you empty the fields, you do not end up with a VM that has nowhere to write an address. `lib/vm-nics.js` (new, pure + 13 unit tests), `src/app-properties-vm.js`, `src/app-hypervisor.js`, `lib/i18n.js`, `styles/07-modals.css`, `netmapper.html`, `tsconfig.json`.
- **Every card reaches all three couplings the project already had**, which is what "connected to the rest" actually means for a virtual interface: its **VLAN** feeds the derived trunk on the host uplink (`lib/vlan-trunk.js` now unions per-vNIC instead of parsing one comma list), its **MAC** joins `deviceSigs` so the machine stops being flagged as undocumented (`lib/drift-snapshot.js` — a three-legged firewall used to have two of its three MACs reported as strangers at every Check), and its **IP** joins the duplicate audit (`src/app-l3.js`, one `vm:<host>:<vm>:<nic>` entry per address, labelled with the card name only when there is more than one).
- **Silent migration of existing projects.** `_migrateState` moves the flat fields onto the first vNIC and deletes them, so there is exactly one truth per datum; readers that never pass through the UI (server, export, tests) get the same view from the tolerant reader in `lib/vm-nics.js`, which synthesises the implicit card. A VM with no network data gets no invented interface. `src/app.js`.
- **The dossier prints every leg**: the *Virtual machines* chapter joins the values of all cards in the VLAN/IP columns (now wrapping, widths rebalanced at unchanged total) — still one row per machine, because that chapter is an inventory of VMs, not of interfaces. `export.js`, `server/pdf-report.js`.

### Changed
- **The SNMP read keeps all measured MACs instead of hiding them.** It used to store one when unambiguous and merely count the rest; the measured block now lists them all, since that is the only data that lets you fill in a multi-card VM. Automatic assignment is still limited to the case with no ambiguity — one measurement, one declared card — because the polled interfaces carry no IP addresses and pairing them is not deducible. `src/app-hypervisor.js`, `src/app-properties-vm.js`.
- **The host list row states how many cards a VM has** (`2 vNIC`) next to role, resources and the first address. `src/app-hypervisor.js`.
- The new surface is built entirely on delegation (`data-act="vm-nic-add|vm-nic-del"`, `data-change="vm-nic"` + `data-vm-nic`): the ASSE B ratchet stays at **568**.

## 2026-07-22 — Virtual machines: compact list + full VM card, and they finally reach the handover dossier

Until now a VM carried little more than its address, was edited inline in a block that made the host panel unreadable past four VMs, and appeared **nowhere** in the delivery dossier: the ESXi was documented, the machines running on it were not. Survey of how the field does it (NetBox/Nautobot/Ralph model VMs as first-class objects in their own namespace with a separate counter; Docusnap/Device42/Lansweeper give them their own report chapter) confirmed the shape: **separate but linked** — never merged into the physical device count.

### Added
- **Dedicated VM card** — a 5th properties scope (`selType==='vm'`, host in `selId` + VM in `selVmId`) alongside node/port/link/floor, with its own renderer file. The **power state sits in the card header** as a clickable chip (green running / red stopped) next to the title, where the eye lands first, instead of being a field buried in the form. The **guest OS is not limited to the built-in list**: the card reuses the panel's existing "Custom…" harness so you can type any system (a VM can host anything), while closed scales — criticality, SNMP driver, management protocol — deliberately stay closed, since free text there would only produce data you cannot compare. Four sections: *Identity* (name, role/service, guest OS), *Network & access* (hostname, IP, VLAN, IPv6, MAC — the management fields of a PC, since the network sees a VM as an endpoint of its own), *Allocated resources* (vCPU, RAM, disk — same triad NetBox models), *Handover and ownership* (owner, criticality, backup, notes: what a delivery document needs and no scan can ever deduce). Everything is declared by hand — nothing here comes from a measurement, and empty fields print `-`, never a zero that would look like one. `src/app-properties-vm.js` (new), `src/app-properties.js`, `src/store.js`, `lib/i18n.js`, `styles/07-modals.css`.
- **The host panel now lists, it doesn't edit.** One VM per row: state dot, name, then the free space beside it carries what tells two VMs apart — role, **allocated resources** and address. Resources prefer the **measured** figures over the declared ones and carry a small dish icon when they came from an SNMP read, so you can see at a glance whether you are looking at a measurement or at a statement. The IP is dropped when it *is* the name (a VM absorbed from a discovered tile is usually named after its address, and repeating it wasted the whole row). Edit and delete on the right — same grammar as the VLAN rows. Clicking a row (or the pencil) opens the card; "+ Add VM" creates one and opens it straight away, since a brand-new VM has nothing to show in a list. `src/app-hypervisor.js`.
- **"Virtual machines" chapter in the handover dossier** (opt-out checkbox, on by default, included in the one-click dossier preset): one row per VM grouped by host — host, VM, role, state, VLAN, IP, allocated resources, owner, criticality. The vNIC MAC stays out of the printed table (at 11 columns every cell was truncated on A4 portrait) but remains in the project JSON, the API and the Drift comparison. `export.js`, `server/pdf-report.js`, `netmapper.html`, `lib/i18n.js`.
- **Management row on the VM card** — protocol picker + optional URL + one-click open, the same control the device panel has (and sharing its user-customisable protocol list, so HTTPS/SSH/RDP/VNC/WinBox behave identically). Empty URL is not a gap: it is built from protocol + the VM's IP. `src/app-properties-vm.js`, `src/app-management.js`.
- **SNMP management of a VM — measured data, kept apart from declared data.** Many VMs (Windows Server, Linux, appliances) expose an SNMP agent on their *own* address, so they can be queried like any other host. The card carries an **Integration section that is the device one, field for field**: same container (`vm.integration`, mirroring `node.integration`), same names and same labels — driver, host override (empty = the VM's IP), UDP port, timeout, community, and the *complete* v3 block (user, auth protocol + passphrase, priv protocol + passphrase, security level, context). One vocabulary for one concept: the poll payload is built the same way and anything that consumes the project later finds a field it already knows. A **Read over SNMP** button reuses the existing `/api/poll` route — no new endpoint, no new server code. What comes back (system name, **vNIC MAC**, uptime, CPU cores, RAM, disks, `sysDescr`) is shown in a **measured block stamped with the read timestamp**, visually separate from what you typed, and never overwrites your fields: copying it into the declared ones is an explicit button (undoable). Reading the MAC is what **closes the loop with the Drift** — a VM's MAC lands in `deviceSigs`, so the machine stops being flagged as undocumented — and it fills exactly the hole left by cross-subnet imports, which never carry one (ARP does not cross the router). Since the polled interfaces do not carry IP addresses, the MAC cannot be matched to the queried address: it is accepted **only when unambiguous** (a single vNIC with a real MAC, the normal case); with several cards the count is noted and the field is left alone rather than guessed, and a MAC you already documented is never overwritten. Two honesty rules are wired in: an answer **proves** the VM is running, so the state flips to running as a measurement; **silence proves nothing** — a timeout is recorded and explained (amber, not red) but never writes "stopped", because the agent may be missing, the community wrong or UDP filtered. Same rule that governs the presence colours. `src/app-hypervisor.js` (`pollVmSnmp`, `applyVmSnmpValues`), `src/app-properties-vm.js`, `lib/i18n.js`, `styles/07-modals.css`.
- **VM counter on the dossier cover**, as a fourth box next to devices/cables/VLANs and **never summed into the device count**: a host with 10 VMs is still one installed appliance, and inflating the number the client reads as "equipment delivered" is exactly the kind of invention the project forbids. `lib/handoff.js`, `server/pdf-report.js`.

### Fixed
- **A VM's IP was invisible to the IPAM audit.** `buildIpamAudit` only ever saw top-level nodes, so assigning a physical device and a VM the same address raised no duplicate — while every DCIM of reference keeps VM addresses in the *same* IPAM as physical ones. VM addresses now take part in the duplicate check (as `vm:<host>:<vm>` pseudo-entries, appended last); they deliberately stay out of gateway resolution, which drives bindings and badges on real project nodes. `src/app-l3.js`.
- **Editing any field in the VM card kicked you back to the host panel.** `updateVm` realigned the panel intent onto the host on every write (needed by the row buttons since the previous release) — from inside the card that closed it at every committed field. The realignment now happens only when the edit comes from the host's list. Caught by a new e2e that clicks and types for real instead of calling the functions directly. `src/app-hypervisor.js`.

### Changed
- **The VM list and card are built without a single inline handler** (`data-act="vm-open|vm-remove|vm-state|vm-back"`, `data-change="vm-field"` + `data-vm-host/-id/-field`): the ASSE B ratchet drops 576 → **568**, the first decrease coming from a new feature rather than a migration pass. `src/app-hypervisor.js`, `test/bridge-ratchet.test.js`.

## 2026-07-22 — VM import drop area: reachable at any list size, works without a MAC, honest refusals

Three real-use bugs in the hypervisor/homelab "Virtual machines" section, all reproduced with real pointer gestures in headless Chrome before fixing.

### Fixed
- **Importing VMs stopped working after the first few drops.** The drop area sat at the *bottom* of the VM list; every import re-rendered the panel (scroll reset to top) and pushed it one row further down — below the panel fold, where `elementFromPoint` can't see it, so every following drop silently bounced back. Now the **whole "Virtual machines" section is the drop target** (`data-vm-dropzone` on the section, summary included when collapsed) and the dashed invite sits **above the list** at a stable, always-visible position. Regression e2e: 4 consecutive real-gesture imports. `src/app-hypervisor.js`, `src/app-pointer.js`, `styles/07-modals.css`.
- **Deleting a VM didn't remove the row until a refresh.** After a single-click on the floor (`_propsExplicit=false`) the trash button mutated the data but the panel re-render was blocked by the explicit-intent guard. Clicking any control in the VM section now realigns selection+intent on that host before re-rendering (same pattern as `absorbNodeAsVm`) — add/toggle/edit had the same latent bug. `src/app-hypervisor.js` (`_propsIntentOnHost`).
- **Devices monitored via SNMP across a subnet couldn't become VMs.** Drag eligibility required a MAC, but cross-subnet imports never have one (ARP doesn't cross the router) — the refusal was silent. Eligibility now accepts any network identity (**MAC or IP/SNMP host**); the VM inherits name+IP and the MAC field stays empty (nothing invented). A tile with no identity at all is still refused — but with an explanatory toast instead of a mute bounce-back (`hv.vmNotEligible`, it/en). `src/app-pointer.js`, `lib/i18n.js`.
- **VM power button: green when running, red when stopped.** It referenced the non-existent `--ok-color` token, so the "running" state inherited plain white; now it uses the semantic tokens (`--active-color`/`--fault-color`), defined in both themes. `src/app-hypervisor.js`.

## 2026-07-22 — Discover results: every device on a single row

The results table wrapped the name+badges cell onto two lines as soon as a device had a long hostname plus 3-4 badges (source · confidence · New · +v3), making the list ragged and half as dense. The name cell is now a flex row where the **name yields first with an ellipsis** while the status badges never wrap (`.disc-name` + `flex:none` badges); fixed columns were trimmed (Status/IP/Vendor/MAC/Type) to give the name column ~358px at the 1080px reference width, and badges got 1-2px tighter padding. Result: 36px single-line rows at any width, badges always intact, no horizontal scroll. `src/app-discovery.js`, `styles/07-modals.css`.

## 2026-07-22 — Discover modal redesign: two phases, plainer terms, compact setup

Senior UX/UI pass on the "Discover devices" modal. The scan options were a flat wrapping row of engineer jargon; setup and results were shown together in one 1180px panel.

### Changed
- **Two distinct phases in one modal.** Setup (form + options) and results (device table) are now separate screens: when a scan completes the form disappears and only the results table shows, with a **‹ New search** button that returns to the form with the entered range preserved. No more setup + results shown together. `src/app-discovery.js` (`_discShowSetupPhase`/`_discShowResultsPhase`), `netmapper.html` (`#disc-setup` wrapper).
- **Plain-language terminology** (it/en). "Cadence/anti-IDS" → **Speed: Fast / Balanced / Careful**; "Deep TCP scan" → **Recognise devices better**; "mDNS/SSDP listen" → **Also find quiet devices**; "Ignore ping (SNMP-probe range)" → **Include hosts that ignore ping**; "Expand LLDP/CDP" → **Follow the links between switches** — each with a one-line plain description. "Timeout" → **Wait**, "Subnet/Range" → **Network range**. `lib/i18n.js`.
- **Grouped, two-column options.** The four "search deeper" toggles are collected in a **Search deeper** fieldset (kept opt-in individually — footprint stays honest) laid out in two columns with a continuous vertical divider; collapses to one column below 640px. `styles/07-modals.css`.
- **Compact setup, wide results.** The range field is capped at ~360px (fits an IPv4 subnet or a full IPv6 CIDR — no half-modal-wide field); the modal is 640px in setup and widens to 1080px only when the 7-column results table appears. `styles/07-modals.css`.
- **New-search button uses event delegation** (`data-act`, `app-delegation.js`), not a new inline `onclick` — keeping the ASSE B inline-handler ratchet at its ceiling. `src/app-discovery.js`.

## 2026-07-22 — Discover: "Ignore ping" option (SNMP-probe hosts that filter ICMP)

On real networks a firewall or CoPP often filters or deprioritizes ICMP while the device still answers SNMP from the management station — so ping-gated discovery silently skipped them. New opt-in **"Ignore ping"** checkbox probes the whole requested range via SNMP; an SNMP responder is marked alive (measured proof of life, not invented). Default off = identical behaviour. The deep TCP scan still runs only on hosts with a sign of life (no 254-IP TCP sweep), and stealth pacing is preserved. Live-verified on the lab: a mgmt /24 went from 2 devices found (ICMP flapping under the emulated slow-path) to all 7 (SW-ACC1/2, Arista, VyOS, vSRX, vWLC). `server/routes/discovery.js`, `src/app-discovery.js`, `netmapper.html`, `lib/i18n.js` (it/en).

## 2026-07-22 — Classifier taxonomy reconciled with the UI catalog (8 new types + L3 capability)

The UI type catalog was richer than what the classifier could emit: 11 active/IP-bearing types had no classification path, and KVM/ATS devices fell into `switch`. The gap is closed function-first (vendor-neutral: brand tokens only as additive recall on measured text), scoring architecture untouched, golden corpus frozen (new cases are additive).

### Fixed
- **A KVM switch or an ATS is never classified `switch` anymore.** New negative guard (`NOT_A_NET_SWITCH_RE`, function words only) suppresses the switch vote when the text says "KVM"/"transfer switch"; the real types vote via their own regexes. `lib/device-patterns.js`, `engine/fusion-scorer.js`.
- **SMB/NetBIOS signals no longer vote `pc` against a recognized NAS.** Open SMB (445) and a NetBIOS name are exactly what a NAS does — on a device that already scored `nas` (brand/OID/"nas" token) they are confirmation, not contradiction; the `tcp-smb-rdp-pc` and `netbios-workstation` bumps now carry the same `!score.nas` guard their `netbios-smb-server` sibling always had (live LaCie D2: was `pc` 143 vs `nas` 90 → now `nas`; a Synology's confidence also rises since the fake pc contradiction is gone). Vendor-neutral: applies to every NAS brand. `engine/fusion-scorer.js`.

### Added
- **8 new classifiable types with traceable votes** (each has a `reasonId` in `reasons`/`evidences`): `ats` (88, beats the APC-OID `ups` 85 when the device declares itself), `nvr` (90, suppresses the `webcam` twin like wlanctrl/ap), `pbx` (90, suppresses the `voip` endpoint twin; UCM OID tie resolved by priority), `vpncon` (88; bare "vpn"/"asa" deliberately excluded — an ASA stays `firewall`), `consolesvr` (88, product-line tokens only for multi-product vendors), `projector` (90, function/PJLink tokens only), `kvm` (85, no bare "kvm" — it collides with QEMU/KVM hypervisors), `doorctrl` (85, strict model tokens; "access controller" excluded — it names Huawei WLCs). `lib/device-patterns.js`, `engine/fusion-scorer.js`.
- **`capabilities.l3` on multilayer switches.** sysServices L2+L3 keeps the type `switch` (rule G5, never `router`) and now exposes an additive `capabilities: { l3: true }` in the classification result (reason `capability-l3`). `engine/fusion-scorer.js`, `server/classify.js`.
- **11 additive golden cases + 2 fusion tests (G10/G11)** freeze the new paths (KVM/ATS not switch, ASA stays firewall, UCM→pbx vs Yealink→voip, Epson projector vs printer tie). `tests/classify-golden.test.js`, `tests/fusion-scorer.test.js`.

### Changed
- **`junos` removed from the router word-list** — it names an OS (identity), not a function, so a Juniper firewall whose sysDescr declares "firewall" was typed `router`. Real Juniper routers are unaffected: their sysDescr says "internet router" (the `router` token) and MX/PTX/ACX keep their dedicated regex; the frozen `juniper-srx` golden case stays `router`. `lib/device-patterns.js`.
- **Altiga OID `1.3.6.1.4.1.3076.` retyped `firewall`→`vpncon`** — the product literally is the Cisco VPN 3000 Concentrator; no golden case covered it. `lib/device-signatures.js`.
- **`DEFAULT_PRIORITY` extended with the 8 types** (insert-only, existing order untouched — affects ties only): vpncon after firewall, kvm/consolesvr after switch, pbx after server but before voip, projector before printer, nvr before webcam, ats before ups, doorctrl before iot. `engine/fusion-scorer.js`.

> **Not added, with rationale:** `badgereader` (no distinguishable network signal — IP readers present as door controllers; manual-first covers the rest); port-based signals for PJLink 4352 / SIP 5060 / IKE 500-4500 (not in the deep-scan port list — separate decision); `ipForwarding` OID (not collected today — separate decision); `homelab`/`nasdesktop` stay auto-classified as `hypervisor`/`server`/`nas` (form factor is placement, not classification).

## 2026-07-21 — Audit 72ª follow-up: two deferred L2/L3 mediums + presence-doc accuracy

Follow-up to the 72ª audit. Two of the deferred L2/L3 Mediums are now fixed, and the "a plain **Sync** never turns anything red" invariant is realigned across the docs to match the code. Gates: 1645 unit / 0 fail, ESLint 0, `tsc` 0.

### Fixed — Medium (L2/L3)
- **Trunk VLANs follow the port's own Port-channel (L2L3-M3).** A switch with several Port-channels no longer copies the *first* trunk Po's VLANs onto a link that lives on a different Po; the aggregator is resolved by the port's `lagId` (= the aggregator's ifIndex, as `drivers/snmp.js` already pairs them). A port on an *access* Po no longer borrows an unrelated trunk Po's VLANs either (that was an invented trunk). New pure `_lagTrunkVlansForPortLag`. `src/app-autolink.js`.
- **An FDB-inferred switch↔switch adjacency stays "inferred", not a confirmed LAG (L2L3-M4).** A LAG bundle whose peer is only correlated by the forwarding table (`FDB-DCT` / `INFERRED`) is shown as *"inferred · to confirm"*, not `LAG` — matching `lib/linkstate.js` (only LLDP/CDP are trusted; any FDB/MAC correlation, however high its score, is the app's inference, not a neighbour's confirmation). The LAG-suppression that already covered `MAC-UPLINK` now covers the other inferred-adjacency protocols; the user confirms it to promote it to a real LAG (manual-first). `src/app-autolink.js` (`_isInferredUplinkProto`).

### Docs
- **"A plain Sync never turns anything red" corrected (B9).** The invariant was imprecise: the authoritative *switch access port down ≥ N syncs* signal needs no sweep, so a plain **Sync** *can* turn a node red once its down-streak matures — only a *merely silent* node (mute SNMP / aged FDB / filtered ICMP / remote subnet) stays grey. Corrected across `ARCHITECTURE.md`, `README.md` and the `lib/drift-report.js` / `lib/drift-snapshot.js` comments (the historical 2026-07-20 entry below, which claimed the two-source red yet then described the port-down red, is now self-consistent).

## 2026-07-21 — Audit 72ª: 8 High + 15 Medium findings fixed (② no-invention + security)

Sixth multi-agent audit (6 domains, senior network-engineer / architect lens, principles P0–P8 + the cardinal rules ①manual-first ②no-invention ③vendor-neutral): average 7.8/10, **zero critical**. All 8 Highs were ② no-invention violations (the app asserting something it hadn't observed); 15 of ~22 Mediums fixed, the rest deferred with a written rationale. The SNMP-layer fixes are **live-verified against real hardware** (Zyxel GS1900-24, MikroTik RouterOS, Synology) on a real /24. Gates: 1633 unit / 0 fail, e2e 79/79, ESLint 0, `tsc` 0.

### Fixed — High (all ② no-invention)
- **Presence is never fabricated.** A device polled twice per *Verify* no longer double-counts its down-streak (the deferred greying recompute is suppressed while a Verify runs), so the "absent" threshold isn't silently halved; a persisted per-port MAC counts as "seen" only if the device actually answered this cycle (a powered-off device no longer stays green forever); and the cross-source DHCP-lease merge reuses the single `_leaseRank` authority so an infinite static reservation can't lose to a dated/released lease. `src/app-snmp.js`, `src/app-drift.js`, `lib/drift-snapshot.js`, `lib/dhcp-lease.js` (`mergeLeaseSources`), `src/app.js`.
- **Two SNMP off-by-one twins of the 67ª `ifStackStatus` fix.** MAU-MIB physical-medium detection was keyed by `ifMauIndex` (≈1) instead of `ifIndex` — collapsing every port onto one medium — and its copper/fibre table didn't match the IANA `dot3MauType` registry (gigabit-copper read as "fibre"); both corrected, with an unknown code now `null` (no invented medium). The Cisco VTP trunk OIDs read `.14/.15` where the real `DynamicState/DynamicStatus` columns are `.13/.14`. `drivers/snmp.js`, verified against RFC 4836 / IANA-MAU-MIB.
- **Auto-link guardrails no longer bypassed.** Server-computed endpoint suggested-links now pass through the client transit-port filter (an endpoint/VM is never cabled onto a quiet trunk, and the prune/recreate churn within one Sync is gone); the endpoint resolver's confidence is graduated 0.85/0.80/0.68 like `correlate.js` (a 3–4-MAC "mini-switch" port stays below the auto-create threshold); and a gateway / proxy-ARP / VRRP MAC is no longer written as an endpoint's identity on import. `src/app-autolink.js`, `src/app-discovery-classify.js` (`_discMacIsNextHop`), `src/app-discovery.js`.

### Fixed — Medium (security)
- **SNMP secrets are redacted for read-only viewers.** `GET /api/projects/:id` strips community / v3 auth+priv passphrases from the returned project for any non-admin; viewers can't save, so nothing is lost on the round-trip. `server/routes/projects.js`.
- **The dev auth-bypass is fail-closed.** `INFRANET_DEV_NO_AUTH=1` is honoured only when bound to loopback **and** not in production — a no-auth server on a reachable interface would hand admin to anyone; otherwise it is ignored with a loud warning. `auth.js` (`_computeDevNoAuth`).
- **Baseline HTTP security headers.** Every response now carries a `Content-Security-Policy` (inline-safe: the app self-hosts every asset, so `default-src 'self'` with `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`), plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`. `server.js`.
- **Skin sanitizer closes the CSS vectors.** `<style>` / `style=""` are stripped of external / `data:` / `javascript:` `url()` (local `url(#id)` kept), `expression()` and `@import`; `vbscript:` is neutralised like `javascript:`. `lib/panel-skin.js`.

### Fixed — Medium (SNMP / discovery / drift)
- **SNMP driver.** A missing `ifOperStatus` (truncated walk) is emitted as unknown, not forced to "down" (no false red via the presence engine); `ipNetToPhysicalState` invalid(5) ND rows are skipped; `lldpLocPortDesc` now reads the real PortDesc column (`.4`, not `.3` = PortId, which produced mojibake when the port-id subtype was a MAC); and the **LACP mode** label is set only when LACP is genuinely operational (Aggregation set **and** not Defaulted/Expired) — a static LAG (the GS1900 returns `0xc4` on every port) is no longer mislabelled "passive". `drivers/snmp.js`, live-verified.
- **Discovery.** An ARP row adopts a DHCP lease's hostname by IP only when the MACs don't contradict; the HTTP title probe closes the connection at its 4 KB cap instead of draining the body; untrusted mDNS TXT control characters are stripped before they reach node names. `src/app-discovery.js`, `server/netscan.js`, `lib/discovery-mdns.js`.
- **Drift.** ISC `backup` / `abandoned` leases are treated as non-live (no false green); a documented IP that answers the sweep is no longer a false "IP change" even when ARP didn't resolve its MAC (so `autoIpRenew` can't auto-apply it on a dual-homed host); a muted switch resets its ports' down-streak instead of freezing it, so a red from a downed port never eternalises once the switch is unverifiable. `lib/dhcp-lease.js`, `lib/drift-snapshot.js`, `lib/drift-report.js`, `src/app-drift.js`.
- **Exports now colour floor nodes by presence, like the screen (FE-M1).** The SVG/PDF/print export coloured a floor device by its **port status** — so a red meant "port fault", clashing with the on-screen red that means "absent", and the grey "not verifiable" state was missing entirely. The export now uses the **same presence source and guard as the live view** (the last Verify's drift report): the type colour when present, a **red ring when confirmed absent** (`macOrphan`), **grey + dimmed when not verifiable** (`unverified`), and a device that has since answered SNMP (`snmpStatus==='ok'`) is full-colour again — so a printed floor plan tells the same story as the screen. `export.js` (also retires the dead `_floorNodeColor` call, now used as the base colour).

> **Deferred (with rationale, tracked in the audit memo):** the PoE positional fallback (load-bearing where the PoE index ≠ ifIndex, needs live validation), per-run cache invalidation (needs a generational design so a muted device's topology isn't dropped), the VoIP daisy-chain (two cables on one access port — a modelling choice), and the authenticated-SMB-in-stealth scan-policy decision. *(The multi-Po and inferred-LAG-label nuances — L2L3-M3/M4 — are fixed in the follow-up above.)*

## 2026-07-21 — Released DHCP lease as an opt-in "likely disconnected" hint

Gates: 1610 unit / 0 fail, e2e 79/79, ESLint 0, `tsc` 0.

### Added
- **Released-lease presence hint (opt-in, off by default).** A new toggle in the **DHCP lease import panel** treats a **released** DHCP lease (`binding state released` — the device deliberately sent DHCPRELEASE) as a *weak* signal: a documented device with no positive signal and a released lease is annotated **"likely disconnected"** in the drift report — but it stays **grey** ("not verifiable"), never red. It is only ever a hint (many devices leave without releasing), only from **released** state (never from lease **expiry** — an imported old file would mass-flag), and any positive signal still wins (green). `lib/drift-snapshot.js` (`leaseReleasedHint` → `releasedMacs`), `lib/drift-report.js`, `src/app-drift.js`, `src/app-vlan-autopoll.js`.

## 2026-07-21 — ND discovery: green across subnets via the router's IPv6 neighbours

Extends the honest-presence "green across subnets" signal to IPv6, the twin of the router-ARP path. Gates: 1607 unit / 0 fail, e2e 79/79, ESLint 0, `tsc` 0.

### Added
- **Green across subnets via IPv6 Neighbor Discovery.** Each router/switch's SNMP neighbour cache (`ipNetToPhysicalTable`, IPv6 rows — already walked on Sync as `ndTable`) now feeds presence: a documented device *behind* a router is **green** because the router's ND cache proves it is a live neighbour — even if it is **IPv6-only** or its IPv4 ARP entry has aged out (cases the router-ARP path misses). `src/app-autolink.js` (`store._topoNdCache`), `src/app-drift.js`, `src/store.js`, `src/app-popup.js`, `lib/drift-snapshot.js` (`snmpNd`).

> The router's ND cache is consumed as a **presence-only** signal (it only lightens a node to green): it deliberately does **not** feed IP-change detection — an ND IPv6 must never flag a device documented with an IPv4 as "IP changed" (cross-family), and the device's *own* IPv6 change is already tracked authoritatively via its `ipAddressTable` with the manual padlock.

## 2026-07-20 — Honest presence: red only from proof, green across subnets

Refines the floor presence model so a **red** node is always trustworthy. Principle (senior-network-engineer): *"no answer" is not "dead"* — red must come from a signal a live host cannot suppress. Live-verified on a real network (home /24 + a powered-off lab). Gates: 1605 unit / 0 fail, e2e 79/79, ESLint 0, `tsc` 0.

### Changed
- **Red now requires trustworthy absence.** "documented-but-absent" (red) fires only from a **local ARP-miss** — the presence sweep returns `absent:true` only for an IP on the server's *own* segment (computed from the real netmask) that never appears in ARP after the ping — or a **switch access port down for ≥ N syncs**. FDB ageing, host-filtered ICMP, a mute SNMP agent, or a remote/unreached subnet are now **grey ("not verified"), never red**. A plain **Sync** (no active sweep) never reds a *silent* node; the one exception is the authoritative switch-port-down signal below, which needs no sweep. `server/routes/discovery.js`, `lib/drift-snapshot.js`, `lib/drift-report.js`.
- **ARP-during-ping is no longer discarded.** A local host that blocks ICMP but answers ARP while being pinged is now **green** (the ARP reply is a positive signal), instead of being reported falsely absent. `server/routes/discovery.js`.

### Added
- **Green across subnets via the router's ARP.** Each router/switch's SNMP ARP table (`ipNetToMediaTable` / `ipNetToPhysicalTable`), already collected on Sync, now feeds presence: a documented device *behind* a router is **green** because the router proves it is alive on its VLAN — no ping from the server needed. This answers "how do I verify devices on other subnets/VLANs": give SNMP to the backbone. `src/app-autolink.js`, `src/app-popup.js`, `src/store.js`, `src/app-drift.js`, `lib/drift-snapshot.js`.
- **Authoritative red from a downed access port.** A documented device cabled to a switch port that is operationally down for ≥ N consecutive syncs is marked absent — the switch is authoritative on its own port's link and a live host cannot keep it down; the streak is the anti-flap, and any positive signal elsewhere still wins. `lib/drift-report.js`.

> A stale/expired DHCP lease is deliberately **not** used as a red signal (an imported old lease file would mark every device absent, and a static-IP host has no lease at all): an *active* lease still proves presence, a stale one does not prove absence.

## 2026-07-20 — Presence honesty on the floor + Sync result you can trust

Follow-up UX round after the audit, live-verified on a real network (home /24 + a powered-off lab). Gates: 1594 unit / 0 fail, ESLint 0, `tsc` 0.

### Added
- **Presence colours on the floor plan.** A floor node is now **red** when it is confirmed absent (bucket `macOrphan`: its subnet was observed and nothing answered) and **grey** when its presence is simply **not verifiable** (bucket `unverified`: the check never reached its subnet). Rack devices keep their SNMP LED instead of an overlay. `src/app-render-core.js`, `styles/04-floor-rack.css`.
- **Devices with an IP but no documented MAC are audited too.** Infra/endpoints never synced successfully (switches, KVM, cross-subnet PCs) used to stay full-colour because the presence audit was MAC-only; now they are checked per-node (SNMP answered / sweep) — grey when their subnet is unreachable, red when it is observable and an SNMP device stays mute, untouched when non-SNMP on an observable subnet (no invented absence). New `doc.ipOnly`. `lib/drift-snapshot.js`, `lib/drift-report.js`.
- **The Sync result is now persistent and honest.** The badge next to Sync shows `| ok/total · age` (green all-ok / amber mixed / red none) — stored with the project, no longer evaporating after 4 s next to a stale age. `src/app-snmp.js`, `src/app.js`.
- **The workspace sub-bar surfaces three states it used to hide:** SNMP devices that did not answer the last Sync (no more "all good" next to a red dot), documented devices on subnets the check could not reach, and ports documented differently from SNMP reality. Plus a persistent auto-link result line (links created/removed, with the "why not" diagnostics in the tooltip). `lib/onboarding.js`, `src/app-subbar.js`, `src/app-ai.js`, `styles/10-modern.css`, `lib/i18n.js`.
- **The SNMPv3-to-configure chip sits next to Sync** (it is a Sync to-do, not an ambient status). `netmapper.html`.

### Changed
- Auto-link toast lifetime raised to 10 s so the diagnostics are readable. `src/app-snmp.js`.

## 2026-07-20 — Full networking audit + fix sprints (SNMP driver, L2/L3 engines, a11y)

Follows a senior-network-engineer audit of the whole app (protocol correctness, L2/L3 semantics, physical model, UX). Gates: 1580 unit / 0 fail, e2e 78/78, ESLint 0, `tsc` 0; live-verified on a real network.

### Fixed
- **PoE classes were read off-by-one** from the RFC 3621 enum (`class0(1)…class4(5)`): a Class-3 (802.3af) phone showed as 802.3at/30 W, inflating worst-case PoE budgets. `drivers/snmp.js`.
- **ifStackTable LAG detection (L0) never returned rows** — wrong OID column (`.2` = ifStackLowerLayer, not-accessible; now `.3` = ifStackStatus). `drivers/snmp.js`.
- **One adjacency = one cable.** An auto non-trusted link (INFERRED/MAC, guessed remote port) is suppressed when its physical port already has a trusted link (manual or LLDP/CDP) to the same remote node — ends the "double cable + phantom port" when a neighbour announces its port-id as a MAC. New pure `suppressInferredDuplicates`. `lib/correlate.js`, `src/app-autolink.js`.
- **Multihoming is not an IP change.** All live IPs per MAC are kept (`macAtIps`); "IP changed" fires only when the documented IP is none of them — no more false positives on dual-IP NAS/printers, no wrong auto-renew. `lib/drift-snapshot.js`, `lib/drift-report.js`.
- **Infinite DHCP leases** (`ends never`, epoch 0) now outrank dated/expired history in the per-MAC dedup. `lib/dhcp-lease.js`.
- **A gateway set to the network/broadcast address is flagged** (`gatewayReserved` ⚠ in the L3 map; /31 and /32 exempt per RFC 3021). `lib/l3-gateway.js`, `lib/ipam.js`.
- **An ambiguous LLDP short-name no longer attaches to the first matching node** at 0.97 confidence ("gw" with `gw.siteA` and `gw.siteB` documented → no match; an announced IP resolves the tie). `lib/correlate.js`, `src/app-autolink.js`.
- **The "SNMP not authenticated" network hint no longer claims a switch is "reachable"** on a subnet the check never observed — honest copy per case. `src/app-drift.js`, `lib/i18n.js`.
- **The workspace sub-bar no longer goes stale after a Verify** ("all good" while fresh discrepancies existed): `renderAll` now always runs at the end. `src/app-drift.js`.

### Added
- **The dynamic report modals are real dialogs too.** The M9 a11y work (role/aria-modal/labelledby, focus trap, focus restore, Escape) now covers the whole `.drift-overlay` family (Verify report, Change history, Adopt, L3 map, Free ports, WiFi tools) via the same outside observer — ARIA stamped centrally at registration, zero builder rewiring. Esc closes the topmost dialog and never acts behind it; the base alert/confirm cancels on Esc. `src/app-modal-a11y.js`, `src/app.js`, `netmapper.html`.

## 2026-07-17 — IPv6: the device's own address over SNMP, treated like IPv4

- A device's own IPv6 is read from `ipAddressTable` (IP-MIB, RFC 4293) and behaves exactly like its IPv4: auto-populated on Sync (manual-first), same padlock (`ip6Manual`), Verify warns when a locked value diverges. Best-address pick: routable global/ULA only, stable over privacy. `lib/ipv6.js`, `drivers/snmp.js`, `src/app-snmp.js`, `src/app-properties.js`.

## 2026-07-17 — OS hint from ping TTL (nmap-style, zero-cost)

- The OS family is inferred from the echo-reply TTL already captured by the sweep (64 = Linux/Unix, 128 = Windows, 255 = network gear) — zero extra probes. Low-weight, never authoritative, suppressed on dedicated appliances, kept out of the Discover table. New pure `lib/os-hint.js`; `server/netscan.js`, `server/classify.js`.

## 2026-07-17 — IPv6: address field + neighbor discovery (Scope A)

- IPv6 address field in Properties, validated/canonicalised (RFC 5952) by new pure `lib/ipv6.js`; stored as distinct `ip6`, never leaking into IPv4 IPAM or Ansible.
- SNMP Neighbor Discovery: one walk of the address-family-aware `ipNetToPhysicalTable` yields ARP + NDP neighbours; routable-only candidates attach a proposed IPv6 to discovered devices by MAC. `drivers/snmp.js`, `lib/correlate.js`, `server/crawl-bfs.js`.
- EUI-64 → MAC/vendor recovery (never inventing one for privacy IIDs); privacy IIDs feed the BYOD "Private" signal. `src/app-discovery.js`.

## 2026-07-17 — Escape works again + accessible modals

- **Fixed:** every Escape threw a ReferenceError on the branch's first line (bare call to a function the ESM migration made module-local) — deselection, cable-routing exit, `cancelLag`, `_cancelLink` were all dead. `src/app.js`, `src/app-search-zoom-rack.js`.
- **Added (M9):** the 11 static tool modals became real dialogs (role/aria-modal/labelledby, focus trap + restore, Esc closes the topmost via its real X) through an outside observer — no rewiring of the existing open/close pairs. `src/app-modal-a11y.js`.

## 2026-07-16 — Topology: infra links "to confirm" + inferred intermediary → Shared L2 Segment

- An inferred FDB uplink on a LAG port stays *"Inferred · to verify"*, never promoted to a confirmed "LAG". `src/app-autolink.js`.
- Infra auto-links with a guessed remote port are born `INFERRED` (amber, Confirm/Delete), not authoritative LLDP; exact-port LLDP/CDP stays trusted. `lib/correlate.js`.
- FDB uplink-resolution guard is now type-based (traffic-forwarding types), so a dual-NIC NAS no longer blocks a legitimate uplink. `lib/correlate.js`.
- A hidden 2–4-MAC intermediary is no longer auto-materialised: the port is flagged as a **Shared L2 Segment** with a suggested role (gateway/hypervisor/AP/switch) you confirm from the panel. `lib/topology-plan.js`, `src/app-shared-segment.js`.

## 2026-07-15 — Topology accuracy: LAG uplinks + "cables not shown" hint

- Aggregate interface names (`LAG1`/`Po1`/`ae1`…) no longer resolve to a same-numbered physical port; a MAC learned on a LAG is transit, never a direct attachment. `lib/correlate.js`.
- Topology view: an amber pill flags cables hidden because their rack isn't placed, and places the rack(s) in one undoable click. `lib/subbar-stats.js`, `src/app-subbar.js`.

## 2026-07-15 — Security & robustness hardening (post-audit sprint)

- **Security:** panel-skin importer stored-XSS closed (sanitizer covers unquoted/backtick/slash handlers + orphan executable tags; preview and rack render sanitize through a real DOM parse). `lib/panel-skin.js`.
- **Fixed:** project list 500 on legacy JSON without `updated_at`; Express error handler (clean JSON instead of stack-trace HTML); atomic API-token writes; AI chat hang on context error; LAG audit treating a down member (speed 0) as a distinct speed; L3/IPAM audit reading `ip || integration.host`; front-panel label consistency; Apply-model clamping height to the rack.
- **Hardening batch:** secrets owner-only (`0o600`) + atomic; login timing-leak equalised; AI response capped 8 MB; Cat8 = 30 m reach in cabling advice; 2.5G/5G labels; IPAM pct clamped to 100 %; `.254` gateway heuristic; device-type catalog cached (no event-loop stall) and the ~4k-option datalist built once.

## 2026-07-14 — Fibre ports render correctly; SFP blocks split by type; cap 24→48

- Fibre ports no longer render as phantom copper (~553 of 4,070 catalog models affected; invariant test added). `tools/import-device-types.js`.
- SFP blocks split at the first interface-type change (SFP56/SFP28 → block 2); per-block cap raised 24 → 48. `lib/frontpanel.js`.

## 2026-07-14 — Device-type catalog: 52 vendors, ~4,100 models, network-role filter

- Catalog grows from 110 (MikroTik) to 4,070 models across 52 vendors (CC0 device-type data), network infrastructure only. `data/device-types.json`.
- Importer: recursive vendor discovery, `--vendors=`, `--roles` filter (drops endpoints/servers/accessories with a per-vendor report). `tools/import-device-types.js`.

## 2026-07-14 — Apply real device models (native ports + front panel)

- "Apply model" in Properties: search a real model, one click sets `ports` + `frontPanel`, rendered by the native renderer. `src/app-device-types.js`, `server/routes/device-types.js`.
- Catalog generator turns CC0 device-type YAML into native templates (`--catalog`) and optional SVG skins (`--seed`). `tools/import-device-types.js`.

## 2026-07-14 — draw.io cables: per-VLAN tables with click-to-highlight, A4/A3 auto page

- Each VLAN cable layer gains a clickable cable table (row click persistently highlights that cable); page auto-fits A4/A3; dossier cable-table column overflow fixed via real text metrics. `lib/drawio-export.js`, `server/pdf-report.js`.

## 2026-07-13 — draw.io rack export: names outside the rack, per-VLAN cable layers

- Intra-rack cables exported as native edges on hidden per-VLAN layers, coloured and bound to real port cells; device names moved outside the cabinet; the live SNMP stripe is not exported. `lib/drawio-export.js`.

## 2026-07-12 — draw.io (diagrams.net) rack export

- Export any rack to a native, editable `.drawio` (mxGraph XML, one page per rack, real port cells; custom skins embedded with recovered port positions). New pure `lib/drawio-export.js`.

## 2026-07-12 — Property panels hardened

- The two floor-plan renderers now share one `_buildFloorNodeEl` (they had drifted — partial re-renders lost decorations). `src/app-render-core.js`.
- NAS RAID default, diskless-server 0 TB, LAG steal orphaning, SNMP port/timeout cleared-to-0, "Invalid Date" on the SNMP error card — all fixed. `src/app-properties-*.js`, `src/app-ports.js`.
- Discovery robustness: oversized HTTP/SOAP body no longer hangs the sweep; SSE crawl leak closed; BFS level deduped by IP; unknown driver rejected; per-host catch in `/api/reachability`; mDNS decompression cap. `server/netscan.js`, `server/crawl-bfs.js`, `lib/discovery-mdns.js`.

## 2026-07-12 — Selectors, checkboxes and file pickers move to event delegation

- Project/rack selectors, three checkboxes, both file pickers, and six dynamic clusters (Discover rows, Drift actions, Adopt, report overlays, Users & access, topology/management modals) moved off inline handlers to `data-*` delegation; fixed the admin "AI settings" entry that never opened the modal. `src/app-delegation.js` + modules.

## 2026-07-11 — Assistant command catalog complete again; more delegation

- Loading a project with non-canonical IDs no longer breaks its LAGs (`remapLagId` shared helper). `src/app.js`.
- `extractCatalog` falls back to `data-act`, so migrated buttons stay citable by the assistant. `lib/ui-catalog.js`.
- Header menus, toolbar buttons, assistant controls and CSV/DHCP dialogs moved to delegation; the harness gained `change`/`input`.

## 2026-07-09 — Discover names Windows PCs; Stealth randomizes scan order

- Direct NBSTAT query (UDP 137, ~40 ms) names Windows hosts on Normal/Safe scans. `server/routes/discovery.js`.
- Stealth mode shuffles both sweep phases (a sequential sweep is itself a signature). `server/netscan.js`.

## 2026-07-09 — Verify report stops repeating itself; asset register lists assets

- "Non verificabili" folded under its subnet in "Project networks", each `/24` with a presence badge. `lib/project-networks.js`, `src/app-drift.js`.
- The PDF asset register excludes structural cabling (wall ports, electrical panels) by a vendor-neutral class. `lib/api-shape.js`.

## 2026-07-08 — Closed-port devices identify themselves: mDNS + SSDP + ONVIF

- Opt-in multicast pass names the "silent" devices (Cast/AirPlay → tv, `_ipp` → printer, `_hap`/Matter → iot, ONVIF WS-Discovery → cameras…); announced model/manufacturer feed brand recognition; SSRF-guarded, link-local only, weighted below measured signals. New pure `lib/discovery-mdns.js`.

## 2026-07-08 — One classifier, for real

- The duplicate legacy classifier (~190 lines) removed; the 55-device golden freezes the engine. Byte-identical classification. `server/classify.js`.

## 2026-07-07 — One classifier of record + 40 more SNMP vendors

- The client defers to the server class; one shared regex table (`lib/device-patterns.js`, golden-proofed); 40+ vendors recognized from sysObjectID via netdisco/SNMP::Info facts; vendor-neutral WLC detector.

## 2026-07-07 — The MAC vendor stops deciding the device type

- Seven vendor-neutral classification rules from live scans: OUI demoted to identity tier, Cast detected as protocol, phones/tablets → `mobile` by OS, confidence capped without measured signals, `sysServices` L2+L3 → switch, WLC → `wlanctrl`, Cisco "IOS" ≠ Apple "iOS". `engine/fusion-scorer.js`, `server/classify.js`.

## 2026-07-07 — Discovery trusts one classifier; Windows host ≠ its NIC vendor

- Client trusts the server class when it found a real signal; NetBIOS suffix codes feed classification; SMB (445 + shares, no print ports) beats the OUI "printer" inference.

## 2026-07-07 — Type no longer decided by the vendor's company name

- Type-nouns stripped from vendor strings before type-matching; low-confidence fallback reads measured `sysServices`; contradiction discount. Fixes "Gateway Inc." → router. `engine/fusion-scorer.js`.

## 2026-07-07 — "Project networks" section in the Verify report

- Derives your subnets from documented devices + leases; per-`/24` status covered/blocked/open with a pre-filled "Discover network" action. New pure `lib/project-networks.js`.

## 2026-07-07 — Presence audit no longer greys an unobserved subnet (multi-fabric)

- FDB coverage scoped to the subnets the bridge FDB actually spans (`fdbSubnets`): absent only if genuinely observed, else **unverified**. `lib/drift-snapshot.js`, `lib/drift-report.js`.

## 2026-07-07 — Sync no longer stalls on a slow SNMP device

- Wall-clock deadline on SNMP walks (partial data returned), topology phase in parallel batches of 5 with abort timeout, `try/finally` on the sync flag. 70.7 s → ~18 s measured. `drivers/snmp.js`, `src/app-snmp.js`.

## 2026-07-07 — Performance round (no output change)

- Optional stealth pacing for the base sweep (jittered ~400 ms, concurrency 1, opt-in). `server/netscan.js`.
- Topology crawl as level-synchronised BFS with a bounded pool (deterministic result, ~1.3-4× faster). `server/crawl-bfs.js`.
- Topology overlay batched into a DocumentFragment (724 → 7 ms on 1200 lines); `buildTopoLines` O(1) index maps (~28× on 1920 nodes). `src/app-topology-overlay.js`, `lib/topo-lines.js`.
- SNMP walk retry scoped to the FDB group, default lowered to 1. `drivers/snmp.js`.

## 2026-07-06 — MAC shown for SNMP infrastructure

- Properties and the PDF asset register show a representative port MAC (lowest suffix ≈ chassis) for switches/routers/firewalls; display-only. `src/app-properties.js`, `lib/api-shape.js`.
- The `WLAN Controller` type no longer counts as a Wi-Fi radio device (`wifiServe` removed — a WLC has no radios). `src/app-types.js`.

## 2026-07-05 — Bilingual PDF report + audit-ready asset register

- Per-device asset register (same allowlist DTO as the REST API — secrets structurally excluded) + "last revised" on the cover; the whole PDF follows the UI language (it/en). `server/pdf-report.js`, `lib/api-shape.js`.
- The right-hand context panel renamed "Floor plan context" → "Project context". `lib/i18n.js`.

## 2026-07-04 — Security + vendor registries + discovery accuracy

- **Security:** AI key file written `0o600`; dead `/app.js` route (absolute-path leak) removed. `server/ai-config.js`, `server.js`.
- Adaptive SNMP walk retry (GETBULK halved on timeout, netdisco-style) — macsuck no longer drops port badges under crawl load. `drivers/snmp.js`.
- Full IANA PEN registry bundled (~66k orgs, `npm run update-pen`) — Arista and friends resolve by enterprise number. `server/classify.js`.
- Duplicate ARP phantoms collapsed; patient web re-probe in deep-scan only; live crawl heartbeat; DHCP leases become a discovery source; macsuck locates each MAC on its access port (BRIDGE-MIB/Q-BRIDGE, validated on a Zyxel GS1900).
- Faster `/24` sweep (single ICMP + ARP-authoritative liveness, ~3× on dead IPs); fixed Scopri pre-selecting ping-only phantoms, duplicate host rows, and gateway-type inheritance; BYOD vendor from announced names.

## 2026-07-03 — Off-segment ARP-SNMP, port mapping by ifName, cache headers

- LLDP/CDP expansion also proposes hosts from the switches' SNMP ARP table (off-segment only — on-segment phantoms closed the day after). `lib/correlate.js`.
- SNMP interfaces matched to ports **by `ifName`, not position**; hand-cabled ports without an ifName preserved; a "port to reconcile" warning replaces silent preservation and only fires on a genuine access-vs-trunk conflict; LLDP-confirmed neighbours backfill the ifName onto hand-numbered ports. `src/app-snmp.js`, `src/app-autolink.js`.
- Access VLAN falls back to `vmVlan` when `dot1qPvid` is blank; SNMP VLAN 1 never clobbers a hand-documented VLAN; ghost-cable streak ignores manual ports without an ifName. `drivers/snmp.js`, `src/app-snmp.js`, `src/app-drift.js`.
- No false "SNMPv3 to configure" on non-SNMP hosts (requires a genuine USM engineID); crawl keeps the resolved vendor; ping retries spaced. `drivers/snmp.js`, `server/netscan.js`.
- The 10 tool modals moved out of `<header>` into `#modal-root`; frontend assets served `Cache-Control: no-cache` — no more stale-UI class. `netmapper.html`, `server.js`.

## 2026-07-02 — Manual LAG entry restored

- Create/dissolve a LAG by hand again from the port Properties panel ("Add to LAG" + member badge); active devices only. `src/app-properties-port.js`.
