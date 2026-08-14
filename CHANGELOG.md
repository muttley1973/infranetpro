# Changelog

## [2.9.1] — 2026-08-14
**Three answers that could be wrong are now right.** A patch release: no new capability, only correctness in places where the app was stating something it did not know.

### Fixed
- **A declared network is recognised as declared, whatever its shape.** The Verify and the Overview each read a CIDR with a reader of their own, both IPv4-only: an IPv6 network you had declared never earned its badge, and "declared if it sits in a subnet of /24 or wider" was a threshold from when every row was a /24 — a /22 or a /25 was judged against 24 instead of its own size. One reader answers now (`lib/cidr.js`), a row is declared when a declared network contains it and is no narrower, and the list counts the networks with no VLAN too.
- **A sighting with no date no longer counts as one from this morning.** Confidence fades with age, but only when the record carried a date; without one it never aged and scored like something seen yesterday. An unknown age now weighs as much as a month of silence and is shown as "Undated" rather than hidden — it is not called stale, and no age is invented: not knowing is the finding.
- **The AI chat being admin-only is recorded as a decision**, not a default waiting to be relaxed: opening it to viewers would take a rate limit and a spending budget first, not the removal of the gate.

## [2.9.0] — 2026-08-14
**A network is a thing of its own, and every address is checked — not just the first IPv4.** The subnet stops being a field of the VLAN: a network is first-class, its VLAN optional, the shape every real IPAM uses. Project format goes to schema 2, migrated in place on open.

### Added
- **A "Networks" panel** — every declared network in one list, sorted by address, overlaps spelled out. Add several at once; edit an address in place, delete one row, or clear the plan (both "clear all" actions ask first).
- **A VLAN can carry more than one network** (dual-stack, or a second range on the same SVI), and **a network can have no VLAN at all** — on a real NetBox, most of the plan.
- **IPv6 can be declared**, not just measured: a bare address normalises to its /64, and a /64 shows the addresses actually seen instead of a meaningless percentage.
- **`prefixes` in the REST inventory**, with VLAN (`null` when none), name, gateway, DNS and provenance.

### Changed
- **"Networks" comes before "VLAN"**: the addressing plan is the document, a VLAN is a label a network may carry. The VLAN card shows its networks and takes you to them; it no longer writes them.
- **The two gateways are named**: "Gateway (IP)" is the address, on the network; "Routed by" is the device, on the VLAN.
- **The L3 map is one row per network, not per VLAN**, and wider so device names are not cut.
- Addresses, CIDRs and MACs use the interface font with tabular figures; code and logs stay monospace.

### Fixed
- **Presence no longer depends on how a MAC is written**: a dash-separated or Cisco dotted address stopped matching and the device went grey forever. The five MAC normalisers became one, so a dotted MAC is also recognised as virtual or randomised.
- **A declared network's real mask decides, instead of an assumed /24.** That assumption was written in five places and decided three verdicts: a device nobody probed reported **absent**, a router invented inside a /22, dead hosts resurrected as discovery candidates.
- **No IPv6 gateway was ever checked**, and an IPv6 network read as empty: the L3 report and the overlap audit now walk every declared network, both families, comparing addresses by identity rather than by spelling.
- **An address written on a port counts everywhere** — occupancy, "next free" and the L3 map had all ignored it.
- **The assistant is told the whole documentation, not a third of it**: 23 of 30 documented parameters never reached the model, which answers only from what it is given. Secrets are unaffected — every block is an explicit allowlist.
- **Topology and cabling**: a cable inferred twice is removed even when the real one is corroborated; the crawl no longer overwrites a pinned name; a trunk set by hand stays a trunk.
- **The DCIM import stops throwing prefixes away** — 51 of 90 on a real NetBox were VLAN-less — and declares what stays out.
- **Smaller correctness fixes**: a link-local is not a duplicate (RFC 4007); an empty VLAN key no longer becomes "VLAN 0"; SNMP no longer stamps "VLAN 1" on a port it never measured.

### Security
- **The AI chat is admin-only**: it spends the admin's key and sends the project's topology to an external provider.
- **A colour from an imported project can no longer run as code**: a `vlanColors` value that is not a plain `#rrggbb` is snapped to neutral grey on load.

## [2.8.2] — 2026-08-12
### Added
- **An address on the port**: a router answers on one address per interface, and each one can now be documented where it lives.
- **Draggable columns in the Discover table**, with the Name column no longer repeating the IP that already has its own.

### Changed
- **Retention ceilings raised** where they were cutting history short (change journal, discovery sightings, verification timeline).
- **The change journal moves out of the project file**, joining presence and sightings in `history/<id>/`.
- The PDU loses its "Orientation" field, and its outlet chips are easier to read.

### Fixed
- **A device that will not answer SNMP no longer looks like a device that is gone**: an authentication failure is not an absence.
- The import preview stops announcing a limit that does not exist.

## [2.8.1] — 2026-08-12
### Added
- **Declared by the DCIM** — a read-only block in Properties showing what NetBox says, kept apart from what you declared.

### Changed
- **Presence lives in exactly one place**, and discovery sightings move out of the project file too: up to 96% smaller on a small project.
- **Fields nobody reads are gone** from the project file.
- **Portable exports carry the document only** — no presence, no sightings, no derived VLANs.

### Fixed
- **Looking at a project no longer changes it.**
- The browser tab has an icon.

## [2.8.0] — 2026-08-11
**Sync with NetBox, and a hardware catalogue that speaks its language.** Import is free; write-back is a paid module.

### Added
- **DCIM/IPAM import from NetBox** (free): base URL + API token stored server-side, progressive preview, selection by site/role/tag, explicit reconciliation. Devices, interfaces, cables, VLANs, prefixes, IP addresses and racks come across.
- **Imported racks are placed on the floor plan**; a cabinet with devices on both faces becomes two InfraNet racks (front / rear).
- **Patch-panel cabling**: front/rear-port terminations become a native pass-through chain, so a run through a panel stays one run.
- **A virtual chassis is imported as a stack**, a declared platform picks the Ansible network OS, and a device description is kept as a note.
- **PDU model**: up to 48 passive outlets inside the rack frame, an editable outlet list with what each one feeds, NetBox outlet status mapped to active/inactive/faulty, and management/console/auxiliary ports told apart.
- **Power chapter in the PDF report and the handover dossier** — one PDU per block, one row per outlet.
- **Vendor-neutral hardware catalogue** from the CC0 source, projected into a neutral port-slot model (management, copper, SFP/SFP+, QSFP…).
- **Portable, versioned project JSON**: projects carry a schema version; exports declare their format.
- **Write-back to NetBox** as a **paid module**: dry-run diff, create-or-PATCH by natural key.

### Changed
- **The import's reconciliation step is a list of decisions, not a list of warnings**: each row says what will happen, what it costs and how to change it. The separate manual-reconciliation panel is gone, absorbed into the same list; changing a decision no longer re-reads the whole DCIM.
- **The import declares what it leaves behind** instead of dropping it quietly, and "not in service" is a decision you make rather than a filter applied for you.
- **Device notes travel with their device** in the handover dossier, instead of a separate chapter to cross-reference.
- **High-density SFP rendering** for devices with large optic blocks.

### Fixed
- **A prefix with no VLAN is no longer documented as "VLAN 0"** — the first-class network of 2.9.0 starts here.
- **A device you switch off turns red, and stays red after a reload**: a measurement is not an edit, and it is kept beside the history rather than inside the document. A stale SNMP success no longer hides a proven absence, and an SNMP failure is drawn as a fault, not as a disappearance.
- **Verify, SNMP poll and topology stay responsive on large networks**: the port→node resolver went from scanning every node per port to constant time (4.4 s to milliseconds on 500 devices).
- **Port identifiers containing hyphens are resolved safely** across correlation, topology, drift and SNMP.
- **Manual brand edits stay manual-first**; discovery and SNMP no longer replace a brand you typed.
- **A PDU outlet set to "inactive" by hand stays inactive**, and a PDU in Ethernet management mode always shows its cable-able port.
- **The default "trunk + access" topology view shows all rack cables**, with the same emphasis as the exclusive states.
- Deleting a project also removes its timeline and snapshots; the import preview no longer multiplies the VLANs it reports.

## [2.7.3] — 2026-08-09
### Changed
- **A hand-typed device name is manual-first**: Discovery no longer renames what you named.
- **A retype is proposed, not applied**, on a device that is already documented.
- **A hand-set port count is manual-first**: SNMP proposes a different count instead of raising it silently.

### Fixed
- Drift's IP-change no longer overwrites a hand-pinned SNMP host.
- **Rack devices show honest presence**: absence is drawn where it was measured.

## [2.7.1] — 2026-08-06
### Changed
- **One "Automatic monitoring" replaces two schedulers** — a single timer with two depths, instead of an SNMP poll and a Verify going their own way.

## [2.7.0] — 2026-08-06
**The project can look after itself, and you can go back.**

### Added
- **Autosave** (opt-in, off by default): after a real change the project saves itself.
- **Scheduled Verify** (off by default): a silent documentation check on a timer.
- **A verification timeline**: each Verify appends a dated row, so drift has a history instead of only a last-known state.
- **Restorable snapshots and a unified History panel**: full-state snapshots you can go back to.

### Fixed
- The header stays on one row when the runtime badges appear.
- The "restore point created" feedback is visible from inside the History panel.

## [2.6.2] — 2026-08-05
### Added
- **The Security lens flags a wireless client whose IP VLAN is not its SSID's VLAN.**

### Fixed
- The VLAN filter matches the cable's real carried VLANs, and follows a wireless device to the VLAN of its SSID.

## [2.6.1] — 2026-08-05
### Changed
- The header buttons are evenly spaced and the search bar takes the free space; Verify sits centred between its dividers.

### Fixed
- On short screens the Dashboard columns scroll their own tiles, and an open drill-down list stays readable.

## [2.6.0] — 2026-08-05
**A cable says how well it is known.**

### Added
- **Proof-state for cables** from a pure engine: fresh or weak for an inference, ghost for one no longer corroborated, declared for one you drew by hand — a silent manual cable is *declared*, never a ghost.
- **A Truth Score on the Dashboard**: how many cables are ghost, inferred, declared.
- **A proof-state badge** beside the LLDP/CDP/MAC provenance, in the cable properties and the list.
- **Per-port miscabling detection**: the neighbour a port announces is compared with the cable you declared, and a mismatch is shown rather than silently trusted.

### Changed
- Inferred cables render dashed, ghosts attenuated.
- The drift "ghost cable" counts only inferred cables: a manual cable on a long-down port is a device down, not a phantom cable.

## [2.5.2] — 2026-08-04
### Added
- **Discover associates the scanned subnet with a VLAN**, so the same subnet is not typed twice.
- **A reveal toggle on every masked password field** — SNMP communities, the AI key, DCIM tokens.

### Changed
- The VLAN filter badge moves into the sub-header; cable tooltips join each device with its port on one line.

## [2.5.1](https://github.com/muttley1973/infranetpro/releases/tag/v2.5.1) — 2026-08-02
### Fixed
- Cable rendering ignores property-panel controls that reuse a port ID, so traces no longer start from the wrong place.
- Custom manual property values survive a re-render.

## [2.5.0](https://github.com/muttley1973/infranetpro/releases/tag/v2.5.0) — 2026-08-02
**The Overview becomes the Dashboard, and the report menu is absorbed into it.**

### Added
- The **Live reading** and **Management VLAN** tiles open a list, like every other tile.
- A **wireless VLAN coherence** verdict in the Security lens.

### Changed
- **The "Reports" menu is absorbed into the Dashboard**: free ports and the L3 map are drill-downs of the tiles that already state their numbers.
- **Free ports headlines real switch capacity** — the port where a new device actually goes — with the rest counted apart.
- The **Gateway** tile opens the full subnet→gateway map; the **Default community** tile names which known default a device answers to.
- The toolbar spells out its actions, and the freshness chip shows the age of the last SNMP read, colour-coded.

## [2.4.0](https://github.com/muttley1973/infranetpro/releases/tag/v2.4.0) — 2026-07-31
### Added
- Two legend pills **cycle through three states** (wired/wireless, trunk/access) instead of two.
- **Cables the active filter picked are drawn thicker**, whichever way it is filtering.
- **Every fan-out line can be clicked**, not only those of the open rack.
- **A passive hop can be declared occupied**: on a patch panel or outlet, *active* means a cable is in it.

### Changed
- **The README is a landing page**; language flags are SVG files, because no Windows font renders the flag emoji.
- **The release badge reads GitHub** instead of a hand-typed number.
- **Wall outlets are born `WA-01`**, matching the ones already on the wall.

### Fixed
- The breadcrumb says which view you are in; ENDPOINT hides VoIP phones too.
- A trunk no longer borrows the look of the cable you are tracing: thickness says *trunk*, glow says *you are following this one*.
- The toolbar stops wrapping at full screen.

## [2.3.1](https://github.com/muttley1973/infranetpro/releases/tag/v2.3.1) — 2026-07-31
**One classifier, and no word outranking a measurement.**

### Added
- A shared **classifier corpus** (53 rows) and two goldens, run through *both* engines: the browser and the server can no longer disagree in silence.
- **Emulation platforms are a class** (GNS3, containerlab, EVE-NG…), not the bench they were first written on.
- The browser reads the **sysObjectID** for types it had no regex for.
- The Overview opens **rack space and free fibre** as lists, and free ports gain a "by speed" tab.

### Fixed
- **A word no longer outranks a measurement**: a description saying `ios` scored higher than a device that answered.
- **Brands stop deciding types**: `apc`, `raritan`, `sony`, `cyberpower`, `liebert`/`vertiv` all make more than one kind of thing.
- **"switch" is no longer the answer for the unrecognised**, and a vSRX is no longer a router because `srx` appears inside its name.
- A Synology is recognised by its product line; on managed gear the MAC comes from the interfaces, where it lives.
- A patch panel with nothing filled in no longer declares a specification.

### Changed
- Inference rules built on an identity string (HP factory hostname, Juniper names, phone-vendor list) lose weight to rules built on measurement.
- **"Detected identity" moves to the top of every property panel**; IP and MAC share one row.

### Repository
- ⚠️ **The commit history was rewritten and force-pushed** (English messages, no bot trailers).

## [2.3.0](https://github.com/muttley1973/infranetpro/releases/tag/v2.3.0) — 2026-07-30
**A sixth lens — Health — and a long pass on numbers that were stating more than they knew.**

### Added
- **Health lens**: what problems are there right now, composed from telemetry already collected.
- **Warranty and end-of-life dates** per device, feeding a Lifecycle row in Recoverability.
- The dossier opens with the **Overview page** and closes with **"What I'm not looking at"**, naming the dimensions it does *not* judge.
- **Fibre runs are validated** against their optical class: reach depends on the optic, not on the metre.

### Fixed
- **A zero that was never measured is no longer printed as a fact.** Across the Overview, the PDF and the dossier: "0 free addresses" with no valid subnet, "0 VLANs named" on a project with no VLANs, "0 fibre free" where no fibre was declared, "0 suspect ports · all coherent" on a project never verified, a rack that never declared its height getting 42U written into the document, a counter never supplied printing a dash instead of a zero. Where an engine fails, the answer is "not assessed", not a green tick.
- **A negative PoE headroom is a debt, not a margin.**
- **A measurement no longer overwrites what you set by hand**: a VM's power state, a LAG created by hand, a LAG renamed.
- **Ages are visible**: the SNMP indicator and per-device lamps turn amber past six hours, and a summary row that forgets its provenance no longer claims a human wrote it.
- The validators speak English too, and layout no longer scrolls sideways or overlaps at narrow widths.

### Changed
- A MAC's vendor comes from the **refreshable registry**, not a hand-written table; VMware's OID is no longer hardcoded.
- **"Add to map" no longer arrives with every candidate pre-ticked.**
- When SNMP finds more interfaces than the declared port count, the drawing shows them as proposed.

### Security
- **The backup pointer no longer reaches the PDF with credentials inside it**, and the same check now runs on the server, on save and on import — it lived only in the browser.
- **The SNMP community is masked** like the v3 passphrases already were, on devices and on virtual machines.

## [2.2.0](https://github.com/muttley1973/infranetpro/releases/tag/v2.2.0) — 2026-07-29
**Two new questions: can you bring it back up, and how exposed is management?**

### Added
- A **Recoverability (DR) lens** — if it falls tonight, can you restore it? — and a matching **DR section in the PDF**, one row per managed device.
- A **Security & Services lens**: encrypted SNMP versus clear text, default communities, management exposure.
- **VLAN names read over SNMP**, reconciled against what you declared.
- **IPAM conflicts, Gateway and Redundancy rows** in Conformance: the same IP on two devices, a declared subnet with no gateway, how many devices declare an HA twin.
- **Wireless association discovery** over SNMP, with an opt-in "AP mode" for devices that broadcast without being access points.
- **Hardware identity drift** as a seventh Verify category: a changed serial or model means the box was replaced.
- **A configuration-backup pointer** per device — where the backup lives, never the config itself.
- **Temporal confidence**: the discovery sightings already collected become a score.
- **Operating-system logos** in the device and VM panels.

### Changed
- **The declared addressing plan is law**: free addresses are measured against the network you declared.
- **One primary action, "Verify"**: the separate Sync button retired, the Verify overlay replaced by a result that stays in the Overview.
- **Conformance stops being green when the data is old** — past seven days a verdict is suspended, not assumed.
- A backup counts as fresh within 30 days, matching the device panel.

### Fixed
- Two documented devices sharing a MAC (VRRP/HSRP) no longer collide in the drift keys.
- The "Copy" button for an API token works over plain HTTP, where the clipboard API is not available.

## [2.1.0](https://github.com/muttley1973/infranetpro/releases/tag/v2.1.0) — 2026-07-24
**The Overview: is the document complete, does it still match reality, and what is coming next.**

### Added
- **The Overview view** — three columns and a health-dot verdict per column, red reserved for a project never synced.
- **Device labels say what a thing is**, not just where it answers.
- **IPv6 as a first-class address**, read from the device and from neighbour discovery.
- **An OS hint from the ping TTL** already captured by the sweep — low weight, never decisive.
- **vNIC ports and a dedicated VM card**: a VM can declare several virtual cards and be polled over SNMP like a device.
- **Honest presence on the floor**: red when confirmed absent, grey when not verifiable.
- **Eight new classifiable types** (ATS, NVR, PBX, VPN concentrator, console server, projector…).

### Fixed
- **A blind Check no longer reports "documentation aligned"**: observing nothing is not a clean bill of health.
- **Looking is not editing** — switching view no longer marks the project unsaved.
- **An absent field no longer states an invented default** (18 identity selects, cable types, and more).
- **"Configured for SNMP" is not "responding"**, and measurements are stamped with the time they were taken.
- **PoE classes were read off-by-one**, inflating every budget.
- **The AI context stopped scanning the whole project for every port**: 4.5 s to 5 ms on a large network.

### Security
- SNMP secrets are **redacted for read-only viewers**; the development auth-bypass fails closed.

## [2.0.5](https://github.com/muttley1973/infranetpro/releases/tag/v2.0.5) — 2026-07-14
### Added
- **"Apply model"**: search a real switch or router model and apply it — port count, layout and optics — in one click, from a **catalogue of ~4,100 models across 52 vendors** built from public-domain data.
- **draw.io rack export**: a native, editable diagram, one page per rack, one edge per cable, one layer per VLAN.

### Fixed
- **Fibre ports no longer render as phantom copper** (~553 of 4,070 catalogue models were affected).
- **The two floor-plan renderers share one builder** — they had drifted, so a partial redraw disagreed with a full one.
- Defaults that asserted things nobody set are gone (NAS RAID level, diskless-server storage…).
- **Discovery robustness**: an oversized HTTP body no longer hangs the sweep; an aggregate interface name no longer resolves to a same-numbered physical port.

### Security
- **The panel-skin importer's stored XSS is closed.** Secrets are owner-only and written atomically; the login timing leak is equalised.

## [2.0.4](https://github.com/muttley1973/infranetpro/releases/tag/v2.0.4) — 2026-07-10
### Added
- **Direct NBSTAT over UDP** names Windows hosts in about 40 ms, instead of shelling out per host.
- **Stealth mode shuffles both sweep phases**: a sequential sweep is itself a signature.

### Changed
- The Verify report stops repeating itself, and the PDF asset register lists IT assets rather than structural cabling.

## [2.0.2](https://github.com/muttley1973/infranetpro/releases/tag/v2.0.2) – [2.0.3](https://github.com/muttley1973/infranetpro/releases/tag/v2.0.3) — 2026-07-08
### Added
- **Closed-port devices identify themselves**: an opt-in multicast pass (mDNS, SSDP, ONVIF).
- **Off-segment discovery via SNMP ARP**, and **DHCP leases as a discovery source** with macsuck locating each MAC on its switch.
- A **"Project networks"** section in the Verify report, derived from the documented devices.
- The full **IANA PEN registry** (~66k organisations), so a new vendor resolves without a code change.
- A **bilingual PDF report** and an **audit-ready asset register**.

### Changed
- **One classifier, for real**: the duplicate legacy implementation was removed.
- **The MAC vendor stops deciding the device type** — the OUI drops to the identity tier.
- SNMP interfaces are matched to ports **by `ifName`, not by position**, so a hand-cabled port keeps its cable.
- A WLAN controller no longer counts as a Wi-Fi radio device: it has no radios.

### Fixed
- **Sync no longer stalls on a slow SNMP device**: a deadline returns partial data instead of hanging.
- **The presence audit no longer greys an unobserved subnet** in a multi-fabric project.
- **Performance**: the topology overlay batches its work — 724 ms to 7 ms on a large map.

### Security
- The AI key file is written owner-only, and a dead route that leaked an absolute path is gone.
