# Changelog

## [Unreleased]

**The subnet stops being a field of the VLAN.** A network is now a thing in its own right, and the VLAN it belongs to is optional — the shape every IPAM of reference uses. Project format goes to schema 2; opening a project migrates it in place, and nothing moves on screen for a project that has one subnet per VLAN.

### Added
- **A "Networks" section in the project panel**, listing every declared network sorted by address, with its VLAN as a badge rather than a container. Click a network and its detail opens: VLAN, name, gateway, DNS, occupancy, Adopt. Below, the plan itself, with overlapping pairs marked and the conflict spelled out — sorting by VLAN would hide exactly what you need to see, since two colliding networks are neighbours in the address space, not in the VLAN list. Type several networks separated by commas and they all land in one step; what does not parse stays in the field, in red.
- **A VLAN can carry more than one network.** Dual-stack works: an IPv4 prefix and an IPv6 prefix on the same VLAN, each with its own gateway, because in reality those are two different gateways. So does a secondary address on the same SVI — the network someone added a second range to when the /24 ran out.
- **Networks with no VLAN.** Point-to-point links, transit networks, out-of-band management — real addresses that no VLAN describes. They sit in "Networks" with everything else: on a real NetBox they are most of the plan, and a section named after what they lack would be a worse name than no name.
- **IPv6 in the CIDR helpers.** Discovery has measured IPv6 since 2.5; now it can be declared too. A bare IPv6 normalises to its /64, the twin of the existing bare-IPv4-to-its-/24 rule. There is no capacity bar for an IPv6 prefix — 2^64 addresses is not a percentage — so occupancy counts the addresses actually seen.
- **`prefixes` in the REST inventory** (`/api/v1/projects/:id`): every declared network with its VLAN (`null` when it has none), name, gateway, DNS and provenance. `vlans[].subnet` keeps its shape and its meaning of "the VLAN's IPv4 prefix".

### Changed
- **The VLAN card says which networks, not how they are built.** The IPAM drawer behind the grid icon is gone; in its place a membership field, where the button detaches a network from the VLAN instead of deleting it — the network stays in the document with its gateway and DNS. Deleting is done from "Networks", which is the door where a network exists or does not. Both write through the same functions on the same array, so neither holds a copy.

### Fixed
- **Adopt from leases reached no candidates for a network with no VLAN**, because it asked for "the leases of VLAN N" while occupancy was always computed from the prefix. It now takes the prefix. A lease adopted from a network without a VLAN no longer lands in a "VLAN 0" that does not exist.
- **The overlap audit was blind to more than half of a real plan.** It compared one prefix per VLAN, so networks with no VLAN — 51 out of 90 on a real NetBox — and the second prefix of a dual-stack VLAN were never checked; two overlapping prefixes on the same VLAN were skipped on purpose, which hid a secondary address colliding with the primary.
- **The DCIM import stops throwing prefixes away.** It used to copy each CIDR into a single per-VLAN field: on a real NetBox the 51 prefixes out of 90 that carry no VLAN never reached the app, and a VLAN with two prefixes kept whichever came last — silently, with no line in the decision list. Both now come in, and the preview says how many arrived without a VLAN and which VLANs carry more than one.
- **Overlapping-subnet detection works on IPv6** and never reports two address families as a conflict: a /24 and a /64 on the same VLAN are dual-stack.

## [2.8.2] — 2026-08-12

### Added
- **An address on the port.** A router answers on one address per interface; the device card keeps the management address. Shown in the port tooltip. Not offered on passive ports (patch panels, wall outlets).
- **Draggable columns in the Discover table.** Drag a column edge to widen it, double-click to restore it; widths are remembered. Wider than the dialog and the table scrolls sideways, header pinned.

### Changed
- **Retention ceilings raised where they were cutting history short**: change journal and discovery sightings to 10,000, verification timeline to 10,000 rows. Each sat next to an ageing rule (90 days, one year) that the count exhausted first. When the sighting ceiling does bite it now gives up what was seen least recently, not what has been known longest.
- **The change journal moves out of the project file** into `history/<id>/audit.json`, joining presence and sightings. Merging is a union: nothing lost, nothing duplicated. Copies start their own history; portable exports leave it behind, since it carries usernames.
- **The Name column in Discover stops repeating the IP address**, which already has its own column. Without a model or hostname it composes from what was measured — type and brand, "IoT-AzureWave" — and says so on hover.
- **The PDU has no "Orientation" field any more.** It offered "Vertical 0U" while InfraNet only ever mounts a PDU horizontally. It returns when the vertical mount is actually drawn.
- **The power-outlet chips in the PDU panel are easier to read.**

### Fixed
- **A device that will not answer SNMP no longer looks like a device that is gone.** The ring on the floor plan is orange, drawn exactly like the red halo of an absent device: same shape, different colour, because they are different pieces of news. Hovering says which and why.
- **The import preview no longer announces a limit that does not exist** — the tenant of an imported device has been on screen since 2.8.0.

## [2.8.1] — 2026-08-12

**A project file that holds what you declared, and nothing else.** Measurements — presence, discovery sightings, propagated VLANs — now live beside the project instead of inside it, so opening a project no longer changes it and the file stops growing on its own. Verified on a 500-device network.

### Added
- **Declared by the DCIM** — a read-only block at the foot of the Properties panel showing what NetBox declares about an imported device: owner (tenant), status, role, platform. Only fields actually declared, because a printed blank reads as data.

### Fixed
- **Looking at a project no longer changes it.** VLAN propagation is rebuilt from scratch on every render, yet it was written to disk — and the render created port records that did not exist (159 on a 500-device network, +5% file). Saving now strips it.
- **The browser tab has an icon.** Neither page declared one, so every load asked for `/favicon.ico`, got a 404 and logged a console error. The mark is the app's own `fa-network-wired` glyph, rendered from the vendored Font Awesome and inlined — not redrawn by hand.

### Changed
- **Presence lives in exactly one place.** It sat both in the project file and in its own store beside it, kept in line by a freshness rule that existed only to paper over the duplication. Saving now folds it into the store and takes it out of the document — which is also the migration for existing projects.
- **Discovery sightings move out too**, into `history/<id>/observations.json`: up to 96% of a small project's file. Merging keeps the wider history and takes the count as a maximum, so saving twice cannot inflate a sighting into a certainty.
- **Fields nobody reads are gone** from the project file: `physicalKind`, stamped on every port by the DCIM import, and `lastDiscoveryMatch`. Existing projects shed them at the next save.
- **Portable exports carry the document only** — no presence, no sightings, no derived VLANs: whoever opens one elsewhere runs their own Verify rather than inheriting a photograph of an installation they are not looking at.

**Measured on real projects: 838 KB → 719 KB; one of them 49.6 KB → 1.6 KB.**

## [2.8.0] — 2026-08-11

**Import an existing NetBox/DCIM as a new InfraNet project — on a NetBox-compatible device catalog — while automation proposes instead of silently overwriting what you documented by hand.** DCIM/IPAM sync builds a project from a NetBox site (racks on the floor plan, a front/rear cabinet split, patch-panel cabling as a native pass-through chain); the device catalog is the canonical CC0 library projected through neutral port-slot semantics (combo ports and a full PDU model, up to 48 outlets); and portable JSON exports are versioned and secret-free. At the same time the network view keeps the same identity and presence state across reloads — runtime caches are cleared when a project changes, persisted presence proof stays visible, and the hyphen-safe port→node resolver stays O(1) so large topologies never freeze mid-scan during an automatic monitor. The import rebuilds what the model can hold — a NetBox virtual chassis becomes an InfraNet stack instead of a handful of unrelated boxes — and names what it cannot: console ports, per-device power feeds and tenants are declared in the preview rather than disappearing between two screens.

### Added
- **DCIM/IPAM sync — import from NetBox** (free): connect with a base URL + API token (secret stored server-side at `0o600`, never in git or the browser) plus a connection test; a three-step wizard (site scope → entity toggles → preview with per-row deselect) builds a **new** project, with a staged progress screen and a result summary. Import is read-only — it never writes to NetBox. Pure NetBox→state mapping in `lib/dcim-map.js`; admin-gated routes under `/api/integrations/dcim/*`.
- **Imported racks are placed on the floor plan** and open in the Rack view — each rack gets a non-overlapping grid position and a clickable floor icon; the first rack is set current so the cabinet renders populated.
- **Front/rear cabinet split** — a NetBox rack with devices on both faces becomes two InfraNet racks (`… · retro`), devices assigned by face, cross-face cables drawn as cross-rack links.
- **Patch-panel cabling** — front/rear-port terminations become a native pass-through chain sharing the pass-through pid (no synthetic segments); type-aware termination resolution, with the NetBox 4.6 `rear_ports[]` array schema handled alongside the legacy singular field. Power/PDU and WAN-circuit cables stay out of scope, and the preview says so.
- **A NetBox virtual chassis is imported as a stack.** `virtual_chassis` becomes the stack name, `vc_position` the member number, and the chassis master the explicit master role — the same tag-based model the Properties panel and the SNMP auto-detection already use. The members stay separate devices, because they are separate boxes in separate rack units; what changes is that they now know they belong together, so a port on member 2 reads as part of the same switch instead of an orphan. When NetBox does not declare a master, none is written: the existing lowest-member-number fallback decides, rather than the import guessing. Two virtual chassis sharing a name merge into one stack — declared, since InfraNet keys a stack by name.
- **A platform declared in NetBox picks the Ansible network OS.** Until now `ansible_network_os` was inferred from the brand alone, so a Nexus documented as such still received the IOS value if its brand read "Cisco". A declared platform is documentation and now wins; when it says nothing recognisable the brand-based inference still runs. A platform that names a cloud-managed family (Meraki) stays a veto and is never overridden by the brand, which would otherwise say the opposite. The value is kept as provenance only — never in the firmware field, where the drift audit compares it against what ENTITY-MIB measures and would report a device swap that never happened.
- **A NetBox device description is kept as a note**, alongside the site and location already carried there, and prints in the asset register with its own device.
- **Power chapter in the PDF report and the handover dossier**: one continuous flow in the same visual language as the rest of the report, with a **restore card per PDU** that never splits across pages — identity (brand, model, serial, firmware, asset tag, warranty), position (rack, U, size, mounting), electrical rating (type, phase, current), management (mode, port mix, IP, MAC), the backup pointer, the input feeds it is **powered from**, and the **outlets and loads** (state, the device each outlet powers, its power port, and whether that link was imported or set by hand). Included in the dossier by default and toggleable from the PDF export dialog, in Italian and English. Undeclared fields print a dash rather than a zero, and a PDU that declares an outlet count without listing the outlets says so instead of showing a row of zeros that would read as a measurement.
- **Write-back to NetBox** is a **paid module** (`modules/dcim-export/`): dry-run diff, create-or-PATCH by natural key, never delete; the free build feature-detects it and hides the Export tab.
- **Vendor-neutral NetBox hardware compatibility**: the CC0 catalog is kept as a canonical source and projected into the InfraNet runtime catalog through aliases, overrides, exclusions and generated revision metadata; update tooling and catalog diff tests make refreshes repeatable without changing the source dataset.
- **Complete DCIM/IPAM reconciliation**: NetBox devices, interfaces, cables, VLANs, prefixes, IP addresses, racks and floor devices are mapped into InfraNet's own model, with a manual review step for ambiguous roles and locations before a new project is created.
- **Neutral physical port-slot model**: management, copper, SFP/SFP+, QSFP and other physical roles are represented by vendor-neutral slot semantics, so importing a device or applying a hardware model does not invent or reorder ports.
- **Portable, versioned project JSON**: projects carry a schema version; browser exports use an `infranet-project-export` envelope, redact SNMP credentials and sanitize backup references, while imports accept both the new envelope and legacy bare state files.
- **PDU power-outlet presentation**: rack PDUs support up to 48 passive power outlets inside the rack port frame, with cells that scale down as density grows, the frame resizing with the rack height (`1U`, `2U` and above), a dedicated management frame and no network cable endpoint semantics.
- **PDU power connections**: the Properties panel exposes an **Alimentazione** accordion with an editable outlet list; NetBox connections remain the source value, while manual device/port edits are stored as separate overrides and can be reset without losing the imported data.
- **Single PDU outlet properties**: the power connection is now an accordion with a rack-device dropdown for the powered device and an editable power-port field. The operational state follows the same manual-first rule as network ports: NetBox remains the imported source, a manual `statusOvr` is stored separately, and reset restores the imported state.
- **PDU outlet status mapping**: NetBox `Enabled`, `Disabled` and `Faulty` map to InfraNet active, inactive and fault; an undocumented outlet is inactive by default, while a documented connection becomes active unless an explicit operational state says otherwise. A manual `statusOvr` always takes precedence over the imported `rawStatus`, including when NetBox reports `Enabled`.
- **PDU interface model**: the properties panel now separates Ethernet/IP management ports from serial console, sensor, USB and expansion/feature ports; only Ethernet ports render as network endpoints, while auxiliary ports remain visible without creating network cable targets.

### Fixed
- **A prefix with no VLAN is no longer documented as "VLAN 0".** `Number.isFinite(+null)` is true — `+null` is `0` — so a NetBox prefix without a VLAN came in tagged to a VLAN that does not exist, and left a phantom entry keyed `null` in the VLAN map. Measured against a real NetBox: **51 of 90 prefixes** carried the invented VLAN 0. No VLAN beats a false one.
- **The import preview announced nine times the VLANs it delivers.** NetBox models VLANs per site or group, so the same ID can be declared dozens of times; InfraNet keys them by ID alone, so they merge. The counter reported the declarations read (63) rather than the VLANs you get (7). It now counts what lands, keeps the number of declarations read alongside it, and says so in the reconciliation panel — including how many merged declarations disagreed on the name, which is the case where one name silently overwrites another.
- **Cables left outside the import are declared instead of vanishing.** Power, console and WAN-circuit cables are out of scope by design, but the preview only ever said "0 unresolved cables" — on a real NetBox that meant **58 of 108 cables** disappeared with no mention at all. They now appear among what will not come in, grouped by why.
- **A device you switch off now turns red — the presence audit no longer trusts a memory.** Three separate lookups were treating a *remembered* sighting as a *current* one, so a documented device could stay green (or fall into no presence bucket at all) long after it was unplugged. (1) The reachability sweep returned "alive" for any IP already in the operating system's neighbour table **without probing it at all** — and that table keeps a `Stale` entry, MAC and all, long after the host is gone; the sweep now always probes, and only the neighbour table re-read *after* the probe counts, which still keeps an ICMP-filtered but present host green because its L2 resolution succeeds. (2) A switch MAC-address table entry suppressed a fresh absence proof, though a MAC table holds a just-disconnected client for its whole ageing time (300 s by default, longer on some vendors). (3) A valid DHCP lease did the same, and a lease lasts hours. All three now yield to a fresh ARP-miss measured on the server's own wire — the same rule already applied to a router's ARP and IPv6 neighbour caches. Verified live: a device off but still `Stale` in the neighbour table flipped from green to red, with no live host turned red.
- **And it stays red after a reload: a measurement is not an edit.** Turning red was only half the story. The check writes presence onto every device and marks the document dirty — then waited for someone to press Save. Autosave is off by default, on purpose, while the automatic monitor runs a check every hour: so each reading lived only in the open page, and a reload repainted the floor from the last time the document was saved. Measured on a real network: four checks in one afternoon, the last one proving four devices absent, while the file on disk still carried the presence of nine hours earlier. The document is what a person writes — where a device sits, what it is called, how it is wired — and it rightly waits for Save; presence is what the network writes, and making it wait is what lost it. It is now stored the moment it is measured, beside the project's history rather than inside the project file, through the same store interface, and read back when the project is opened. Merging back has one rule: the fresher measurement wins, so a stored reading never drags a newer one backwards. "Absent" still refuses to travel without the hard evidence that justifies it — the honesty rule now holds on the way to disk too, not only on screen. Nothing else moves: unsaved edits stay unsaved, the project file is not rewritten behind anyone's back, and deleting a project takes its presence with it.
- **On the floor plan, a device's state is drawn on the device, and an SNMP failure no longer poses as a fault.** The red ring for a failed SNMP poll was an inline outline around the *label* inside the tile, in the same red as the absence ring around the *tile* — so two devices flagged in red appeared to have two different borders for no reason. It is now a class on the tile like every other state, and dashed rather than solid, because "I cannot question it" is not "it is not there" — the rack already makes that distinction with its left border. More importantly it is no longer drawn at all when presence has already reached a verdict: on a device the sweep cannot reach — a subnet out of range, greyed as unverifiable — SNMP fails *because of that*, and an alarm ring would sell as a fault something that is merely out of sight; on one proven absent it would be a second ring repeating the same news. A failed poll is news only when the device is there and will not answer: wrong community, an ACL, a stopped agent. Same rule as every other verdict — no alarm without a measurement to back it.

### Changed
- **DCIM import: the reconciliation step is a list of decisions, not a list of warnings.** Thirteen switches with the same problem produced thirteen identical rows, each offering a "see details" that reopened the same sentence — and none of them asked anything or said what would happen if you did nothing. The panel now opens with what the import will actually do (*I will import 72 devices · 130 cables · 14 VLANs · 5 racks*, plus what the current choices cost), then gives **one row per decision, never per device**: what happens, the alternatives with their consequence, the default already applied, and the affected devices by **name** behind a disclosure. Rows are ordered by what they cost you — what will not come in first, then what you choose, then declared limits that lose nothing. The one real choice today is what to do when NetBox declares more physical interfaces than the catalogue model: no port is lost either way, so what you pick is the **front-panel layout** — keep the model's (default, and usually right on a variant of the same family) or fall back to a neutral panel rather than point at an SFP position that may not be there.
- **The separate "manual reconciliation" panel is gone**, absorbed into the same list. Confirming the type and placement of an unrecognised device is a decision like any other, so it is now a row with its two dropdowns instead of a block of its own with a four-column table — a block that also appeared *empty*, "0 cases to check", after every recalculation. The import still refuses to create the project until those rows are confirmed (or "import anyway" is ticked, now in the panel's footer), and the modal no longer widens to 1080px: at full width the explanations ran 140 characters to the line.
- **The import warnings became structured events.** The mapper emits `{code, deviceId, deviceName, …}` alongside the readable text, from a single call so the two cannot drift apart. This retires the regex that parsed the warning sentence in the renderer: one added word in the message had silently switched the grouping off, which is exactly why the same warning appeared once per device. Grouping, counting, ordering and translation now work off the code; a warning code the interface does not know yet lands among the informational rows instead of breaking the panel.
- **Changing a decision no longer re-reads the whole DCIM.** The preview used to fetch everything from NetBox again on every recalculation — measured on a real instance, 31 seconds for 72 devices, 2498 interfaces and 108 cables. That is the wrong price for a panel whose whole point is "try the other option and see what it costs": at that toll nobody tries, and the alternatives stay dead letters. The raw read is now kept in memory for the duration of an import session and the mapping — a pure function — is what re-runs: the same recalculation takes **40 milliseconds**. The cache is keyed only by what determines the *read* (instance, user, site scope, entity toggles), never by the choices, or every choice would start another fetch. It lives in memory only: it is never written to disk and never reaches the project JSON, which carries the network document, not the raw DCIM snapshot it came from. Changing the DCIM connection empties it, creating the project drops it, and the preview says out loud when NetBox was read, with an explicit "read NetBox again" next to it — an instant answer that does not admit to being a ten-minute-old snapshot reads as "NetBox right now". The commit reuses that same read, so the project you get is the one you approved rather than a second, later fetch.
- **The import preview declares what it leaves behind.** Console ports and power feeds on anything that is not a PDU have no place in the InfraNet model, and inventing one would draw a connector nobody measured — so they stay out, and now say so by name and count instead of disappearing between two screens. A NetBox tenant is kept as the device's provenance but no screen reads it, and the panel says that too rather than letting it pass for an owner field.
- **A device that is not in service is a decision.** NetBox devices marked planned, staged, failed, inventory or decommissioning are always named in the preview, and a single row chooses between importing them anyway — the historic behaviour, and the right one when documenting a rollout that is not switched on yet — or keeping the project to the live network only.
- **The import dialog is 780px wide.** A decision carries an explanation and its alternatives; at 540px they wrapped constantly, and the 1080px of the old reconciliation table ran lines past a hundred characters.
- **Device notes travel with their device**: the handover dossier no longer prints a separate *Notes* chapter. Every hand-written note is now a full-width line under its own row in the **asset register**, and the register subtitle says how many devices carry one. A note is prose of unpredictable length: in a column it would be unreadable, and in a chapter of its own it forced the reader to match names back to devices before the note meant anything. The shared device DTO (REST API v1 / Ansible) still carries no free text — the note is attached only where the register is built.
- **High-density SFP rendering**: devices with dense main-port rows and large SFP blocks now use a compact visual mode that removes fixed horizontal transforms, reduces inter-block spacing and keeps every copper, SFP and management port visible without changing the vendor-neutral classification or numbering.
- **PDU connection field consistency**: the aggregated **Alimentazione** list now uses the same dark controls, typography, spacing and focus treatment as the single-outlet Properties panel.
- **DCIM import workflow**: the wizard now exposes progressive preview, site/role/tag selection, explicit reconciliation choices, catalog revision information and a staged result summary before project creation. Imported racks are placed without overlap, front/rear cabinets remain distinct and patch-panel paths remain native pass-through chains.
- **Project persistence**: the server envelope records the state schema version; history and restorable snapshots remain outside the main JSON, with atomic writes and `fsync` for the history sidecars. Topology cache entries are pruned when their devices no longer exist.
- **NetBox import transport**: the connector canonicalizes an instance URL even when an API endpoint was pasted, accepts raw tokens and complete `Token`/`Bearer` headers, fails closed on cross-origin or failed pagination, enforces batch caps globally and overlaps only independent reads to shorten large imports.

### Fixed
- **Persisted presence is rendered after reload**: documented absent and unverifiable devices keep their red or grey overlay until a newer verification result replaces it.
- **Project replacement clears runtime state**: loading, importing, creating or duplicating a project no longer carries stale topology, discovery, drift or selection data into the new project.
- **Port identifiers with hyphens are resolved safely**: correlation, topology planning, drift and SNMP reconciliation use the longest known node ID, with the legacy parser retained as a fallback.
- **Verify, SNMP poll and topology building stay responsive on large networks**: the hyphen-safe port→node resolver (`getPortNodeId` / `nodeIdOfPort`) is O(1) again in the common case — the naive last-hyphen split is always the longest possible node prefix, so when it is a known node ID it is returned directly; only the rare multi-hyphen suffix (e.g. `…-logical-<id>`) falls back to the longest-prefix scan, over a set built once. Fixes a regression where the resolver, called in per-port hot loops (per-device poll, `buildPortIndex`, drift streaks, auto-link), rebuilt and scanned all node IDs on every call and could freeze the tab mid-scan during an automatic Full or Light monitor.
- **Manual brand edits remain manual-first**: discovery and SNMP inventory no longer replace a brand explicitly entered by the user.
- **Browser UMD modules load the shared port parser before correlation and drift**, keeping the browser and Node/test paths aligned.
- **Manual reconciliation accuracy**: role, device type, site/location and port mapping choices are preserved through preview and import instead of falling back to a generic or stale classification.
- **Project cleanup**: deleting a project also removes its verification timeline and snapshot directory, preventing stale history from being exposed if an identifier is later reused.
- **Catalog and port-layout regressions**: imported NetBox interfaces now follow the same neutral layout rules used when applying a model from Properties, including management and high-speed uplink roles.
- **The topology "trunk + access" (default) pill now shows all rack cables** (`shouldRenderLink`): it force-shows cables that otherwise appear only on selection, but previously only its exclusive "trunk only" / "access only" states did — so the default state hid every cable (an imported rack with only access links looked empty until you narrowed the filter). It now matches its own label and the floor overlay.
- **Cables shown in "trunk + access" get the same 2.5px emphasis as the exclusive states** (`mode-emph`, all three states): a cable no longer draws thinner in the full view than in the filtered one.
- **A PDU outlet can be set to "inactive" by hand**: a manual outlet-status override is now authoritative and no longer re-classified by the fuzzy NetBox-status matcher — which matched the substring "active" inside "inactive" and silently flipped a hand-set inactive outlet back to active. Manual `active`/`inactive`/`fault` are honored verbatim; the matcher also recognizes "inactive" directly.
- **A PDU in Ethernet management mode always shows its cable-able management port**: on an imported PDU with no data ports (`ports === 0`), the management-port count collapsed to zero — so the Ethernet/IP port never rendered and couldn't be cabled. In ethernet/ethernet-serial mode the count is now at least 1 regardless of the (unrelated) data-port count.
- **Console+Ethernet PDUs keep the cable-able Ethernet port**: in the `ethernet-serial` (console+ethernet) management mode, a catalog front-panel layout carrying `mgmtCount = 0` — or an out-of-range `pduEthernetPorts` — used to short-circuit the management-port count to zero through the legacy front-panel path, hiding the Ethernet port the mode guarantees. The declared mode now floors the count at 1 across every port hint, so the console serial port renders alongside a cable-able Ethernet management port.
- **A switched-off device now turns red instead of keeping its full colours**: the ARP table harvested from a router or L3 switch during a Sync is a *memory* of where a MAC was, not a measurement of where it is. It fed the per-MAC "alive" signal with no freshness check, so it outranked the hard proof of absence produced by the current sweep (an ARP miss on the local wire after the ping). The diff engine then took its "still present" branch and the device landed in **no** presence bucket at all — neither red nor grey — and kept its full colours. The fresh measurement now wins: a cached router-ARP entry is ignored for an IP the sweep has just proven absent, while the subnet behind that router stays marked as observed and the cross-subnet green is untouched everywhere the proof is missing (remote silent host, Sync without a sweep, host answering the ping). The IPv6 Neighbor Discovery twin gets the same guard, matched by node MAC since its addresses cannot be paired with an IPv4 sweep.
- **A stale SNMP success no longer hides a proven absence**: the presence overlay treated any `snmpStatus: 'ok'` as "alive", with no freshness gate — but that field survives a save, so a project reopened months later carried an ancient success that silenced the red border even when the verification had just proven the device absent, and even for the presence restored from persisted proof after a reload. The rack LED already applied the shared 6-hour threshold; the overlay now applies the same one, so an undated or expired success no longer outranks a fresh measurement. A recent success still clears the overlay, as before.
- **Automatic monitoring no longer leaves Verify stuck on a spinner**: with the monitor enabled at its default `full` depth, each tick runs a scheduled (silent) verification, which by contract does not touch the Verify button. The SNMP poll it wraps, however, decided button ownership from `_driftRunning` — true for a scheduled verification too — so it wrote its progress spinner onto the button and then delegated the restore to a verification that had never taken the button. The spinner stayed lit forever, and a later manual verification could not recover it either, because it saved the stuck spinner as the button's "original" label. Button ownership is now an explicit signal held only by a visible verification, and a silent poll never writes to the button at all. Covered by an end-to-end regression.
- **SFP uplinks align with the switch data ports across every front-panel density**: the two SFP rows were packed tighter than the two copper rows and sat visually higher, because the SFP LED is shorter than the copper one and the row gap did not compensate. Each density branch now spreads the SFP rows to the copper row pitch — 5px at 2U and above, 3px ultra-dense (2px where `compact-1u`+`dense-xl` also zero the cell's inner gap), and 0 in `compact-1u`, where both LEDs are already the same height. Verified by measurement on all five branches plus the SFP-left, two-SFP-group and opposite-management variants: SFP and copper LED centers now coincide exactly.
- **PDU auxiliary ports (console/serial, sensor, USB, expansion) render as loose cells**: they were wrapped in a bordered box whose fixed five-column grid reserved a constant width even for a single port, squeezing the power-outlet grid next to it — so adding a serial port visibly resized the outlets. They now flow as small content-sized cells and take only the space they need.

### Security
- **js-yaml updated to 4.3.1** in the development dependency tree, clearing the Dependabot high-severity quadratic-CPU advisory without changing runtime behavior.

### Tests and documentation
- Added browser E2E coverage for DCIM import, manual reconciliation, project creation, JSON persistence, neutral port rendering and the imported physical cable chain.
- Added unit coverage for catalog mapping, catalog revisions, portable JSON redaction, schema unwrapping, topology-cache pruning, atomic history writes and project-history cleanup.
- Added regression coverage for NetBox URL/token normalization and connection safety, plus the O(1) hyphen-safe port→node resolver (Set/object membership, multi-hyphen suffixes).
- Documented the NetBox DCIM/IPAM workflow and the manual-first pins in the README, technical architecture and bilingual manual.

What's new in InfraNet Pro. Format based on [Keep a Changelog](https://keepachangelog.com/); newest first, grouped by release. **One line per change** — the reasoning behind each one lives in the commit history.

**A linked version number is a published release** — follow it to the release on GitHub. *Unreleased* is what has landed on `main` since the last one.

## [2.7.3] — 2026-08-09

**Automation now proposes instead of silently overwriting what you documented by hand.** Discovery, Sync, Verify and SNMP could each quietly rewrite a name, a device type, an SNMP host or a port count you had entered yourself. Every hand-entered decision is now a pin the automation respects: a divergent measurement is surfaced as a proposal you adopt on purpose — never applied behind your back — while measured, dynamic state (presence, status) still follows the network.

### Changed
- **A hand-typed device name is manual-first** (`nameManual`): Discovery no longer renames a device you named yourself, even when the name matches its host/IP/type, and Sync/Drift never write the name; clearing the field unlocks auto-naming again. Conservative migration — only names edited from now on are pinned.
- **A device retype is proposed, not applied, on an already-documented node**: when the classifier disagrees with the documented type it records a proposal (old/new type, source, confidence) instead of switching it, and the Properties panel offers Adopt / Dismiss; brand-new devices are still typed automatically.
- **A hand-set port count is manual-first** (`portsManual`): editing "Port count" pins it, and an SNMP walk that measures more interfaces no longer raises the number silently — it surfaces "SNMP detected N — Adopt detected ports"; without the pin the previous behaviour stands (the count rises and the declared value is shadowed in `portsReal`). Never reduced on a partial walk. The declared-vs-measured reconciliation is single-sourced in a pure, unit-tested `lib/ports-reconcile.js`.

### Fixed
- **Drift's IP-change no longer overwrites a hand-pinned SNMP host** (`hostManual`): the reachability and IP-renew paths respect a management host you entered yourself, matching the guard already used in classification.
- **Rack devices show honest presence**: an *absent* (documented MAC not seen on a probed subnet) or *unverifiable* (subnet never reached) rack device now carries the presence overlay, visually distinct from the SNMP-error left border — parity with floor nodes.

## [2.7.1] — 2026-08-06

**The Automazioni menu now has one "Automatic monitoring" scheduler with two depths, instead of two overlapping timers.** Background SNMP polling and scheduled Verify were separate on/off timers — but a Verify already includes the SNMP poll, so running both was redundant and, at coinciding ticks, fired two concurrent SNMP sweeps. They are now a single scheduler: pick a depth and one interval, with an in-flight guard so a poll and a Verify can never sweep SNMP at the same time.

### Changed
- **Unified "Automatic monitoring" (one scheduler, two depths)** replaces the separate SNMP auto-poll and scheduled Verify: one master toggle, one depth selector — *Light* refreshes live SNMP values only (no history), *Full* runs the complete Verify (reality check + history) — and a depth-adaptive interval (Light 5/10/15/30 min — 5 min is the SNMP polling standard, below which large networks can't keep up; Full hourly to daily: 1h/6h/12h/24h). A single in-flight lock prevents overlapping runs and double SNMP sweeps; one countdown badge. Pure config + migration in `lib/auto-monitor.js`: projects saved with the old separate toggles migrate on the fly (a scheduled Verify becomes *Full*, an auto-poll becomes *Light*) without dirtying the file.

## [2.7.0] — 2026-08-06

**The header never spills onto a second line when a status badge appears.** Turning on background polling, highlighting spare ports, a freshness counter or an SNMPv3 notice each add width the responsive breakpoints can't foresee; in the ~1738–1920px range that alone was enough to push the right-hand cluster onto a second row — just enabling polling broke the layout. The header now measures itself and reclaims space in the requested order: first it collapses button labels to icons, and only as a last resort narrows the search bar, so it stays on one line. Verify keeps its label.

**Background automation can keep the document saved and verified on its own, every Verify leaves a dated row in a per-project history, and you can now take restorable full snapshots and roll back to one — all kept outside the project file.** Four opt-in automations, all reachable from the Automazioni menu: an autosave that persists real changes without pressing Save, a scheduled silent Verify, a lightweight timeline of each Verify, and restorable full-state snapshots with a unified History panel. The history lives outside the project JSON (already at its size limit), behind a storage-agnostic interface ready for a future database.

### Added
- **Autosave** (opt-in, off by default): after any real change (edit, Sync, Verify) the project saves itself a few seconds after activity settles, silently — reusing the existing save path; just browsing never marks the document dirty, so it never triggers a save. Toggle in the Automazioni menu.
- **Scheduled Verify** (off by default; 15/30/60 min or daily): a timer runs a *silent* documentation Verify at the chosen interval — same engine as the manual Verify (SNMP poll + reachability sweep + proof-state) but without stealing the screen (no alert, no spinner, no forced Dashboard) and never adopting on its own; it skips a hidden tab. It uses the same on/off slider + interval control as auto-poll, grouped in the Automazioni menu with no new header badge.
- **A lightweight verification timeline**: each Verify (auto or manual) appends a ~1 KB dated row (divergences + network size) to a per-project history kept **outside** the project JSON (`projects/history/<id>/timeline.jsonl`), via a storage-agnostic `historyStore` interface (ready for a future SQLite backend). Admin-only routes, server-stamped author/time, whitelisted counts, generous retention (cap + age). Toggle "snapshot on each verify" (on by default).
- **Restorable full-state snapshots + a unified "History" panel**: gzip snapshots of the whole state live outside the project JSON (`projects/history/<id>/snapshots/`); *Restore* rolls back to one after first taking an automatic pre-restore safety point (reusing the load/undo apply path). Snapshots are taken on demand, on manual Save (throttled to one per 10 min), and before risky operations (import, bulk adopt); retention thins them (all < 48h → hourly to 7 d → daily to 30 d) with a cap of 100 and labelled points never deleted. The old "Storia modifiche" overlay becomes the "Storia" panel with three tabs — Changes (audit), Verifications (timeline), Restore (snapshots) — reachable from the Report menu.

### Fixed
- **The header stays on one row when the runtime status badges appear** (auto-poll, spare ports, freshness, SNMPv3, paid-module entries): a fitter measures the wrap and reclaims space by priority — button labels to icons first (Export → Dashboard → Save → Discover), the search bar last — instead of relying on the search's shrink headroom, which the badge set could exceed above the ≤1737px breakpoint. The media queries still own the layout when no badge is showing (the fitter is purely additive); Verify never loses its label.
- **The "restore point created" feedback is now visible from inside the History panel**: the toast rendered below the modal overlay (z-index 400 vs the panel's 1000), so it was hidden while the panel was open. The toast now sits above panels (z-index 2000), and the Restore tab also shows an inline success/error banner for both create and restore. The verification-timeline row is now written right after the compute and persist — before the UI rendering — so a downstream render error can no longer skip recording a Verify.

## [2.6.2] — 2026-08-05

**The VLAN filter now shows the real, derived VLAN — for cables and for wireless — and flags a wireless client whose IP doesn't match its SSID.** Filtering by a VLAN used to hide anything whose VLAN was *derived* rather than written into the raw trunk field: a VoIP voice VLAN, a per-SSID wireless VLAN, a VLAN propagated along a passive run, or a wireless device that joins an SSID's VLAN. The cable colours and topology already used the full carried set — now the filter uses that same source. The Dashboard also flags a wireless client whose IP falls in a different VLAN's subnet than the SSID it joined.

### Added
- **Security lens flags a wireless client whose IP-VLAN ≠ SSID-VLAN** (`client-ip-vlan-mismatch`): a client inherits the VLAN of the SSID it associates to, so an IP in a different declared VLAN subnet is a contradiction (the SSID or the address is wrong). The connection VLAN comes from the associated SSID/BSS (`_getLinkTrunk`), the IP-VLAN from the declared subnet that contains the address — the warning names the client, the SSID VLAN it joined and the VLAN its IP implies.

### Fixed
- The **VLAN filter matches the cable's real carried VLANs** (`_getLinkTrunk`, derived trunk included) — one source shared with cable colours, topology and properties — instead of the raw `trunkVlans` field or the single native VLAN. A passive element (wall port, patch panel) follows the VLAN of its active endpoints rather than falling back to the site-native VLAN.
- The **VLAN filter follows a wireless device to the VLAN of its SSID**: its radio ports and wireless links are matched too, so a client associated to an SSID on VLAN X shows under X (a passive still reflects its active endpoints). Previously only cabled ports were considered, so a wireless-only device could vanish from its own VLAN.

## [2.6.1] — 2026-08-05

**Header and Dashboard polish.** The header now spreads its buttons evenly and lets the search bar grow into the free space, with Verify centred between its dividers; on short screens the Dashboard columns and an open drill-down list both scroll so nothing is cut off. Presentation only — no data or behaviour changes.

### Changed
- The **header buttons are evenly spaced and the search bar expands to fill the free space**: the two centring auto-margins are gone, so the search (flex-grow) takes the slack instead of leaving two empty cushions around it, and the right cluster stays pinned to the edge.
- The **Verify button is centred between its two dividers**: the SNMPv3 "to configure" chip moved into its own compartment (`Discover │ n │ Verify │`) that collapses to nothing when there is nothing to configure, and a divider now follows Discover.

### Fixed
- On short screens the **Dashboard columns now scroll their own tiles** instead of clipping the ones that overflow below the fold: the column grid row is bounded to the available height and each column scrolls internally, while the lens selector, perimeter note and footer stay pinned. Tall screens are unchanged; below 1100px the stacked columns still scroll the page.
- On short screens **an open Dashboard drill-down list is now always readable**: the tiles above yield space and scroll (keeping a row visible) while the detail list takes at least ~40% of the column and scrolls on its own. On tall screens nothing changes — the tiles keep their full height (the detail grows from a zero basis, so a long list no longer squeezes them).

## [2.6.0] — 2026-08-05

**Every documented cable now carries an honest proof-state.** After a Verify, a cable inherits the reachability of its endpoints: a declared (manual) cable stays solid when its device goes quiet, while an inferred cable whose evidence is lost or has decayed becomes a *ghost* — visible, never deleted. The Dashboard sums it up, and each cable shows its own badge.

### Added
- **Proof-state for cables**, from a pure engine: `Fresh` / `Weak` for a fresh inference (LLDP/CDP vs FDB/MAC), `Ghost` when the endpoint can no longer be confirmed or the confidence has decayed, `Declared` for a hand-drawn cable, `Review` when reality contradicts it. A node's state (proven / unverified / absent / diverged) is persisted with the project during Verify, next to the SNMP data — never an undo step, and the read-only overview never writes it.
- A **Truth Score on the Dashboard cables tile** — *"N ghost · N inferred · N declared"* — the cabling's identity at a glance, composed from each cable's own state.
- A **proof-state badge** next to the LLDP/CDP/MAC provenance badges in the cable properties, and in the cables drill-down list.
- **Per-port miscabling detection**: the observed LLDP/CDP neighbour on a port is compared with the documented other end, and a manual cable to the wrong neighbour is flagged *Review* with a banner naming what the port announces. Silence, unresolved or ambiguous neighbours, and passive ends (patch panels, which LLDP transits) are never flagged.

### Changed
- On the map, **inferred cables render dashed and ghost cables attenuated**, inheriting their endpoints' proof-state; a declared cable stays solid — the unreachability shows on the node, not the cable.
- The drift **"ghost cable" now counts only inferred cables**: a manual cable on a long-down port is the device being down, not a ghost — one honest source for *"a cable that lost its evidence"*, shared with the proof-state (which also ghosts an inferred cable whose port is down even when its device answers by another path).

## [2.5.2] — 2026-08-04

**Type each subnet once, reveal any masked password, and a calmer Discover dialog.** The scan and the VLAN panel share the subnet you type, every masked field gets a reveal toggle, and the sub-header centres the active VLAN filter while cable tooltips fit on one line.

### Added
- **Discover associates the scanned subnet with a VLAN**, so the same subnet is not typed twice: a VLAN dropdown (with a *New VLAN…* option) fills the scan range from a declared VLAN, or — when you scan with a VLAN chosen — declares that subnet in the VLAN panel (range normalised to a CIDR, VLAN created if new, never overwriting a subnet already declared). The SNMP community stays out of the panel.
- A **reveal ("eye") toggle on every masked password field** — the SNMP communities, the AI key, change-password and new-user, the DHCP live credentials, the SNMPv3 panel credentials and the login form.

### Changed
- The **VLAN filter badge moves from the header into the sub-header**, centred between the breadcrumb and the project stats: it takes the centre slot from the next-step hint while a filter is active, and the hint returns when the filter is cleared. The sub-header's two side zones are now equal-width, so the centred element sits truly centred.
- **Cable tooltips join each device with its port on one line** — `device port → device port` instead of the names and the ports on two rows — cutting the popup's height. A LAG bundle with several cables keeps the device pair as a header, one line per port pair.
- The Discover **VLAN field and the floor "Replace map" / "Lock map scale" buttons adopt the outlined Load-SVG style**, a full-width divider separates the scan target from the scan options, and the map-lock button sits below the resize slider it controls.

## [2.5.1](https://github.com/muttley1973/infranetpro/releases/tag/v2.5.1) — 2026-08-02

**Cable traces now follow the documented physical path, and custom values stay saved.**

### Fixed
- Cable rendering now ignores property-panel controls that reuse a port ID, so traces no longer start from hidden `0×0` coordinates. The visible path remains `device → wall port → patch panel → switch`, or the direct `device → switch` path.
- Custom manual property values persist after the delegated form re-renders.

### Changed
- The header's right-hand cluster is evenly spaced and grouped with the same dividers the left side uses.

## [2.5.0](https://github.com/muttley1973/infranetpro/releases/tag/v2.5.0) — 2026-08-02

**The Dashboard is the single place, and its numbers say what they mean.** The "Report e analisi" menu folds into the tiles it belonged to, a new Security verdict flags wireless SSIDs whose VLAN their access point's trunk does not carry, and "Free ports" stops counting patch panels, appliances and wall outlets as switch capacity — the headline is the port a new device can actually use.

### Added
- Dashboard: the **Live reading** and **Management VLAN** tiles now open a list — the SNMP targets (the silent ones first, marked *no reading*, then the ones that answered), and each management VLAN **by name** (declared, or measured over SNMP; there can be more than one).
- Dashboard: a **wireless VLAN coherence** verdict in the Security lens — how many SSIDs advertise a VLAN their access point's uplink trunk does not carry; the drill-down lists the out-of-place SSIDs with their AP, and zero means coherent. An SSID outside the trunk turns the lens amber.

### Changed
- The **Overview is renamed Dashboard** throughout the UI — the toolbar button, the breadcrumb, the tooltips and the dossier's section title.
- The toolbar spells out its actions: **Dashboard**, **Salva/Save**, **Esporta/Export** join Scopri and Verifica as words on wide screens, each collapsing back to its icon as the window narrows, in that order.
- The **freshness chip** shows the age of the last SNMP read again — colour-coded — instead of the response count: the count already lives in the status bar with its dot, and the full result (how many devices answered) moves to the chip's tooltip. The age had been hidden on every viewport ≤1980px CSS — which is nearly any monitor, a 1080p screen or a 4K one at Windows' default 200% scaling both reporting 1920px — leaving only the count on the chip.
- Dashboard: the **Gateway** tile opens the full **subnet → gateway** map — the ones without a gateway first, then each declared subnet with its gateway — instead of only the gaps, and stays clickable when none are missing.
- Dashboard: the **Default community** tile shows an administrator *which* known default a device uses (public / private / empty), as a marker the renderer resolves; the raw value still never leaves the engine, and a custom community is never surfaced.
- The **"Report e analisi" menu is absorbed into the Dashboard**: the free-ports table and the L3/gateway map — both with CSV export — now open from their tile drill-downs, and the wireless-VLAN coherence report becomes a Security-lens verdict. The header keeps only **Change history**, as a standalone button: a log over time is not a state snapshot, so it stays out of the Dashboard.
- Dashboard: **Free ports** now headlines the real *switch* capacity — the port where a new device actually attaches — with patch panels, appliances (NVR, KVM, console server, NAS, firewall…) and wall outlets counted apart as a *+N non-switch* badge instead of inflating the total; the drill-down splits into **In-rack / Outside-rack** (the free wall outlets), each non-switch device marked. On the demo project this reads 114 of 216 switch ports free (+129 non-switch) where it used to claim 243 of 491. The per-speed breakdown tab is dropped in favour of the out-of-rack count.
- The header's right-hand cluster is evenly spaced and grouped with the same dividers the left side uses — views | Verify | tools | automation | account — and the freshness counter sits in a bordered, rounded box instead of a borderless pill (a fresh reading still tints that border with its status colour).

## [2.4.0](https://github.com/muttley1973/infranetpro/releases/tag/v2.4.0) — 2026-07-31

**One thing at a time, and say what you are hiding.** The topology legend stops dimming what you filtered out and starts removing it — then puts the count on the pill, because a view that filters in silence omits without admitting it.

### Added
- Two legend pills **cycle through three states** instead of two: wired / wireless, and trunk / access. Each carries the number of links it is hiding.
- **Cables the active filter picked are drawn 2.5px thick**, whichever way it is filtering — the same view filtered the other way must not draw its cables thinner.
- A run carrying **both** trunk and access survives either filter; one discovered over LLDP and never documented is **counted apart** rather than called access by elimination.
- **Every fan-out line can be clicked**, not only those of the rack that happens to be open — it was 8 to 51 of 78 on the demo project, and none with no rack open.
- A **passive hop can be declared occupied**: on a patch panel or an outlet, *active* means a cable is in it, not link-up. Speed and VLAN stay out — those really do belong upstream.

### Changed
- The **README is a landing page**: banner, proof badges, a value grid and a quick start above the fold; the 120-item feature list becomes a scannable table plus nine sections that open. Nothing was removed.
- **Language flags are SVG files, not emoji** — no font on Windows renders 🇮🇹 or 🇬🇧, so the manual links carried two blank boxes.
- The **release badge reads GitHub** instead of a hand-typed number: one fewer place to bump, and one that had already gone stale.
- **Wall outlets are born `WA-01`**, matching the ones already in the field, numbered from the highest assigned rather than the count — delete one and the next was reborn with a name in use.

### Fixed
- The breadcrumb **says which view you are in**: the Overview kept the label of the view you came from, in both directions.
- **ENDPOINT hides VoIP phones too.** *Endpoint* was defined twice and the two disagreed; a phone falls in the gap — it has an IP and carries the PC downstream — so its cables vanished while the tile stayed on screen with nothing attached.
- A trunk **no longer borrows the look of the cable you are tracing**: thickness says *trunk*, the glow stays reserved for what is selected or traced, and the two marks add up instead of replacing one another.
- The **toolbar wrapped at full screen** and straightened out when the window shrank: above 1737px no rule applied, and at full size the bar asks for 1938px — more than the 1920 most desktops have.
- The **freshness chip** leaves the age to its tooltip below 1980px, and the **"v3 to configure" chip holds its slot at zero** instead of moving the toolbar when a Sync finds v3-only devices.
- Two wrong statements about this project's own record: the README's test counts, and two roadmap entries left under *Planned* with their box already ticked.

## [2.3.1](https://github.com/muttley1973/infranetpro/releases/tag/v2.3.1) — 2026-07-31

**The classifier stops guessing from brand names.** Deciding *what a device is* was the last important decision in the product with no regression net behind it.

### Added
- A shared **classifier corpus** (53 rows) and two goldens, run through *both* engines — the server scorer and the browser's — on every test run.
- Network **emulation platforms are a class**, not the bench they were written on: GNS3, containerlab and Cisco Modeling Labs no longer come out as switches.
- The browser reads the **sysObjectID** for types it had no regex for; a Fortinet identified by its own OID fell through to the fallback.
- Overview: **rack space and free fibre open a list**, like every other tile; assumed rack heights are tagged *derived*.
- Overview: **free ports gain a "by speed" tab** — ports with no declared speed counted apart, because they are not slow ports.

### Fixed
- A **word no longer outranks a measurement**: `ios` in a description scored higher than a device declaring over SNMP that it routes.
- The **operating system is no longer counted twice** — two votes drew on the same evidence, so a Linux-based NAS scored higher as a server than as a NAS.
- **`apc` out of the UPS rule**: that maker also builds PDUs, transfer switches and racks. Its UPS product lines replace it.
- **`raritan` out of the PDU rule**: it also makes KVM-over-IP, and a Dominion KX was typed a power strip.
- Three more **brands that decided a type** (`sony`, `cyberpower`, `liebert`/`vertiv`) replaced by their product lines.
- **"switch" is no longer the answer for the unrecognised**: an SNMP responder declaring no layer now comes out as the generic type, matching the confidence that already said *I don't know*.
- The browser stops being a **second, divergent classifier**: disagreement between the two engines fell from 17 rows of 53 to 4, all structural.
- A **Synology is recognised by its product line** (`DiskStation`/`RackStation`), which is what the unit actually writes, not only by the vendor name.
- **A vSRX is not a router**: there is no word boundary before `srx` inside `vsrx`, so a model-only rule could not see it.
- Overview: on managed gear the **MAC comes from the interfaces**, where it lives — reading only the chassis field printed dashes next to devices the same row called documented.
- Overview: the **two counters on the "verifiable over SNMP" tile share a line** instead of orphaning the second one.
- The **header no longer shifts to two rows on its own** as the freshness chip changes width; the width is reserved for the widest case.
- A **patch panel with nothing filled in no longer declares a specification** — and its dropdowns no longer open pre-set on the guess.

### Changed
- The **HP factory-hostname rule** drops from 65 to 50: an inference from an identity string is not a measurement.
- The two **Juniper-named rules become model rules**, like every other row in that table.
- The **phone-vendor list** in the OS fingerprint drops from 62 to 40: a manufacturer's name alone is the weakest inference.
- Overview: **IP and MAC share one row** — the two halves of one network identity, shown as the project's ARP pairing.
- **"Detected identity" moves to the top of every property panel**, above Name/ID, and is emitted for every device type (only access points had it before).
- In the project context panel, **VLANs come before the floor plan**.

### Repository
- ⚠️ **The commit history was rewritten and force-pushed.** 401 commits are now in English, shortened, and free of the automated co-author trailer. **No file content changed** — every commit tree is byte-identical, and the `v2.1.0`/`v2.2.0`/`v2.3.0` tags were re-pointed to the equivalent commits. **If you have a clone or fork, re-clone or `git fetch && git reset --hard origin/main`.**
- The CI workflow's step names and comments are in English (they are printed on every Actions run page).
- **The documentation was simplified.** This CHANGELOG went from 84 chronological sections — nearly one per change — to one section per release, every entry preserved as a single line: 90 KB to 26 KB. The README's feature list keeps every feature but states each in a sentence or two instead of a paragraph; one bullet alone ran about 6,000 characters, longer than most of the sections it described.

## [2.3.0](https://github.com/muttley1973/infranetpro/releases/tag/v2.3.0) — 2026-07-30

**The honesty pass.** One theme throughout: the app no longer says more than it knows. A verdict resting on nothing is grey, not green; a measurement carries its age; a number declares where it came from.

### Added
- A sixth Overview lens, **Health** — *what problems are there right now?* — composing telemetry the devices already returned through the same thresholds the AI assistant reads. CPU is reported, never judged; a green verdict degrades to amber once the oldest reading passes 6 hours.
- **Warranty and end-of-life dates** in every device's Properties, feeding a **Lifecycle** row in the Recoverability lens and a Lifecycle column in the PDF's DR page (no OID says when a contract expires).
- The dossier now opens with the **Overview page** — one page after the floor plan, carrying the three questions, their verdicts and the same provenance dot as on screen. The verdicts used to never leave the app.
- The Overview closes with **"What I'm not looking at"**, naming the dimensions it does *not* judge, so the absence of an alarm is never read as *all clear*.
- **Fibre runs are validated** against their optical class at last — reach depends on the *speed*, not only the class: OM3 carries 300 m at 10G but 100 m at 40G.

### Fixed
- The page no longer **scrolls sideways** on narrow screens with nothing visible sticking out: the cause was invisible tooltip pseudo-elements overhanging the edge.
- Right-hand toolbar **tooltips stay inside the window**, anchored to the control's right edge.
- Overview **tiles no longer cut their own text**: three per row while they fit, two when the column narrows, labels wrapping instead of clipping.
- In "verifiable over SNMP" the **denominator vanished** — it was the only element with hidden overflow, so it absorbed all the compression.
- Below 1100px the stacked tiles **overlapped the next section's heading**.
- **10G over Cat6 within 55 m no longer warns**: the standard allows it, and a warning on a compliant run teaches you to ignore warnings.
- A **transfer switch that doesn't speak the one documented profile now says so** instead of showing a card of dashes. No OIDs were invented for makes we cannot test.
- A **stacked switch's port label no longer imposes one vendor's naming** — the shape is the measured one, and a hand-declared stack simply omits the slot.
- A VM answering over SNMP **no longer rewrites the power state you set by hand**; the measurement is recorded beside it and highlighted when it disagrees.
- **LAG markers stripped at load** because a cable reaches a passive element are now reported instead of vanishing silently.
- The **SNMP indicator and per-device LEDs have an age**: past six hours the lamp turns amber and says why, and a device bar goes dim green — it answered, but not now.
- A summary row that forgets to state its provenance **no longer claims a human wrote it** (the default was *declared*; three rows were wrong because of it).
- **"0 VLANs named" is no longer green** on a project with no VLANs: nothing to name is not everything named.
- The dossier cover prints a **dash for a counter never supplied**; "0 virtual machines" at 22pt is an assertion.
- The PDF distinguishes **"0 fibre ports free"** from **"no fibre declared"**, and no longer opens the DR page with "0/0 recoverable" on an empty population.
- With no valid subnet the IPAM engine reports free addresses as **unknown, not zero** — "0 free" reads as *network full*.
- A rack that never declared its height no longer gets **42U written into the document**.
- **"0 suspect ports · all coherent"** no longer appears as measured fact on a project never read over SNMP.
- When the IPAM hygiene engine fails the Overview says **"not assessed"**, not a green "no conflicts" — a failed measurement is not a clean result.
- The PDF's **DR page no longer counts a device with a mismatched serial as recoverable**; the dossier was more optimistic than the app.
- A **LAG created by hand is no longer overwritten** by LLDP/CDP inference, and a renamed LAG group no longer reverts on every Sync.
- The cable, Wi-Fi and cabling validators **speak English too** — their warnings were hardcoded Italian inside pure libraries, invisible to the parity test.
- A port that was **never observed is no longer presented as "off"**: the menus offer an explicit *not determined*.
- The L3 map's **CSV export and the delete-rack confirmation follow the interface language**.
- The **Conformance column can turn green again**: "verifiable over SNMP" counted PCs, phones and printers in its denominator, so it stayed amber forever.
- The **Security lens no longer shows a green dot beside "no SNMP access measured"** — zero configured accesses means zero measurements, not zero exposure.
- **A negative PoE headroom is a debt, not a margin**, and the fleet total no longer erases it against other switches' spare capacity.
- Characters outside WinAnsi no longer render as garbage in the PDF — the typographic minus came out as a quote mark.

### Changed
- **Trunk symmetry** joins "What I'm not looking at": in the document both ends coincide by construction, so checking it would prove nothing.
- On the server, a MAC's vendor comes from the **refreshable registry** rather than a hand-written table — which was also wrong on one prefix.
- The DHCP live-pull dialog asks for **the credentials the driver declares**, instead of a per-vendor list to realign by hand.
- VMware's enterprise OID is **no longer hardcoded** in the shared classifier; it was the only vendor written into the generic scorer.
- The **"Add to map" dialog no longer arrives with every candidate pre-ticked** — those rows become real devices.
- When SNMP finds **more interfaces than the declared port count**, the drawing shows them all but the declared number is kept and the difference reported.
- The 7-day **staleness gate covers Expansion** too, whose verdict rests on measurement.
- The catalogue's **per-type default make is no longer written into the device** — it fed a fabricated Ansible network OS.
- An **OUI on its own now scores within the ceiling** the engine declares for every OUI plugin.
- The Overview's first column is titled **"LAN"**; **"verifiable over SNMP" carries two counters**, since responders and non-verifiable devices are two different populations.
- UPS power and device health **left "What I'm not looking at"** — they now carry a verdict.

### Security
- The **backup pointer no longer reaches the PDF with credentials inside it** — the DR page was the only consumer not stripping it, and a dossier gets forwarded by email.
- Credential detection in that pointer had **two ways through**: the scp form without a scheme, and any password containing a slash.
- That check now also runs **on the server**, on save and on import — it lived only in the field you type into.
- The **SNMP community is masked** like the v3 passphrases already were, in the device panel and both scan dialogs.
- SNMP secrets are redacted for non-admin readers **on virtual machines** too; the existing test covered only nodes, which is what let the gap through.

## [2.2.0](https://github.com/muttley1973/infranetpro/releases/tag/v2.2.0) — 2026-07-29

**The Overview grows up: five lenses and an offline DR runbook.**

### Added
- A **Recoverability (DR) lens** — *"if it falls tonight, can you bring it back up?"* — across backup freshness, hardware identity, rack location and presence.
- A **Security & Services lens** — *how exposed is management?*: encrypted SNMP versus cleartext, default communities counted (the value never leaves the engine), management-VLAN segmentation.
- A **Recoverability (DR) section in the PDF**, one row per managed device: where the backup lives, when it was taken, the serial and firmware to procure, and the rack it returns to. Kept off-site, it survives the LAN it rebuilds.
- **VLAN names read over SNMP** surface in the Overview and are reconciled against what you declared — the declared name is never overwritten.
- An **IPAM conflicts row** in the Conformance column: the same IP on two documented devices (VM addresses included), or two VLANs whose subnets overlap.
- A **Gateway row**: declared subnets without a gateway surface as a gap.
- A **Redundancy row**: how many managed devices declare an HA twin. Advisory — resilience is not reconstruction.
- **Wireless association discovery** over SNMP: clients are drawn as over-the-air associations, not cables, from the bridge table and the L3 neighbour table — the latter covers all-in-one boxes and software hotspots.
- Opt-in **"AP mode"**: a Wi-Fi-capable device that is not natively an access point can broadcast an SSID without changing its type. Capability, not role.
- **Hardware identity drift** as a seventh Verify category: a changed serial or model means the device was replaced. A firmware change is informational.
- A **configuration-backup pointer** per device — where the backup lives, never the config or credentials — flowing into the Ansible inventory as `ansible_network_os` and a `backup_missing` group.
- **Temporal confidence** (`lib/temporal-confidence.js`): the discovery observations already recorded become a score that separates a real host from a MAC in transit.
- **Operating-system logos** in the device and VM panel headers, from permissively-licensed sets, with the same honesty rule: a specific logo only from an authoritative source, grey for a mere TTL hint, nothing when unknown.
- The **Verify result is persisted with the project** (counts, verdict and timestamp — never the full dump) and its differences are **navigable and fixable inside the Overview**, one decision per row.
- **Project freshness became an autonomous status chip** next to Verify, and a **"Refresh data & topology"** entry keeps the full manual poll available.

### Changed
- **The declared addressing plan is law**: free addresses and subnets are measured on the real declared prefix — a /16 is 65,000 addresses, not 254 — and networks you use but never declared surface as *undeclared*.
- The toolbar has **a single primary action, "Verify"**; the separate Sync button was retired because Verify already ran the poll.
- The **Verify overlay is retired**: pressing Verify lands in the Overview and the result stays instead of flashing.
- The Overview packs **3 tiles per row** with the fill bar as a vertical gauge on the side.
- The **Conformance column no longer stays green when the data is old** — past seven days a green verdict degrades and says how long ago it was read.
- A backup counts as **fresh within 30 days** (matching the device panel), not 90.
- The Recoverability lens's **hardware identity** asks what a restore actually needs: make and model *or* serial, with firmware advisory.
- The toolbar holds **one compact row down to ~1175px**, the freshness chip moved next to the search field, and Discover/Verify keep their text labels on common monitors.
- Discovery rows **never truncate a device name** any more; the badges give way first.
- The Wi-Fi and AP-mode toggles **share one row**.

### Fixed
- The Overview's Conformance column **stays coherent when a Sync intervenes** — it could otherwise report "never verified" above live differences.
- Two documented devices sharing a MAC (VRRP/HSRP) **no longer collide** in the drift keys, where ignoring one hid the other.
- The **"Copy" button for an API token works over plain HTTP** — it used to fail silently and still say "Copied!", losing a show-once secret.
- The toolbar no longer **wraps and overlaps the sub-bar**, and tooltips wrap instead of clipping.
- The L3-neighbour wireless signal keeps **unicast MACs only**.

## [2.1.0](https://github.com/muttley1973/infranetpro/releases/tag/v2.1.0) — 2026-07-24

**The semantic-honesty pass.** Ten findings, each proven on the sample projects: the report, the AI context, the sub-header and the exported floor plan stop asserting what the data doesn't support.

### Added
- The **Overview** view itself: three columns — is the document complete, does it still match reality, how much can I grow — each cell carrying a number, a plain-word verdict and the **provenance** of the figure. A missing datum shows as a dashed *not declared* cell, never a zero.
- An at-a-glance **health-dot verdict** per column (red reserved for a never-synced project), a severity accent on the most urgent tile, and a **since-last-read delta**.
- **Device labels say what a thing is**, not just where it answers: when the name *is* the address, the readable line is derived for display from the classified type and vendor — `node.name` is never rewritten.
- **IPv6 as a first-class address**: the device's own address read from `ipAddressTable`, a validated field in Properties with its own padlock, and neighbour discovery via `ipNetToPhysicalTable`.
- An **OS-family hint from the ping TTL** already captured by the sweep — low weight, never authoritative, never changing the type.
- **vNIC ports**: a VM can declare several virtual cards, each feeding the derived trunk, the documented devices of the Check, and the duplicate audit.
- VMs get a **dedicated card** (a fifth properties scope), can be **polled over SNMP like any host**, and reach the **handover dossier** with their own chapter and their own cover counter — never summed into the device count.
- **Honest presence on the floor**: red when confirmed absent, grey when not verifiable, and **green across subnets** from the router's ARP and IPv6 neighbour caches.
- An opt-in **"released lease = likely disconnected"** hint: it annotates a grey device, never promotes it to red, and never comes from lease expiry.
- **Eight new classifiable types** (ATS, NVR, PBX, VPN concentrator, console server, projector, KVM, door controller) plus an L3 capability flag on multilayer switches.
- An opt-in **"Ignore ping"** option: an SNMP responder counts as alive, for networks that filter ICMP.
- **Escape works again** and the tool modals became real dialogs (role, focus trap, restore).

### Fixed
- A **blind Check no longer reports "documentation aligned"** — a Verify that observed nothing now says so instead of declaring 487 devices consistent.
- The **"documented" percentage counted the wrong devices**: switches and routers were missing from the denominator, and the test fixture declared a catalogue entry that does not exist.
- **Looking is not editing**: switching to the Topology view no longer marks the project unsaved, and a pan that moved nothing is not a change.
- An **absent field no longer states an invented default** — 18 identity selects, cable type, port status, VM power state, HA role and PVID all became honestly tri-state.
- An **exported floor plan doesn't claim presence without a Verify**, and the unverified rendering stays readable rather than washed out.
- **"Configured for SNMP" is not "responding"**, measures are stamped with the time they were taken, and one wireless problem is counted once rather than once per radio.
- **PoE classes were read off-by-one**, inflating every budget; the LAG detection via `ifStackTable` never returned rows (wrong column); LACP mode is labelled only when LACP is genuinely operational.
- **Presence is never fabricated**: no double-counted down-streak during a Verify, and a persisted interface MAC no longer keeps a powered-off device green.
- Trunk VLANs follow **the port's own aggregator**, and an adjacency inferred from forwarding tables stays *inferred*, not a confirmed LAG.
- The **AI context stopped scanning the whole project for every port** — 4.5 s to 5 ms on a 500-node project, with byte-identical output.
- The **VM import drop area** works at any list size and without a MAC, with honest refusals.
- **Discover results** fit on one row per device, and the modal became two phases with plainer terms.

### Security
- SNMP secrets are **redacted for read-only viewers**; the development auth-bypass is **fail-closed** (loopback and non-production only); baseline security headers on every response; CSS injection sanitised in skin styles.

## [2.0.5](https://github.com/muttley1973/infranetpro/releases/tag/v2.0.5) — 2026-07-14

### Added
- **"Apply model"**: search a real switch or router model and apply it in one click — port count and front panel set natively, drawn by the built-in renderer.
- A **device-type catalogue** of ~4,100 models across 52 vendors, generated from public-domain data, network infrastructure only.
- **draw.io (diagrams.net) rack export**: a native, editable diagram, one page per rack, with real port cells and custom skins honoured — not a pasted image.
- Intra-rack cables export as **one native edge per cable on one layer per VLAN**, each layer carrying a **clickable cable table** that highlights a cable persistently; pages auto-fit A4 or A3.

### Fixed
- **Fibre ports no longer render as phantom copper** (~553 of 4,070 catalogue models affected), and SFP blocks split at the first interface-type change; the per-block cap rose from 24 to 48.
- The **two floor-plan renderers now share one builder** — they had drifted, so partial re-renders lost decorations.
- A batch of defaults that asserted things nobody set: NAS RAID level, diskless-server storage, cleared SNMP port stored as 0, "Invalid Date" on an unset poll.
- **Discovery robustness**: an oversized HTTP body no longer hangs the sweep, the SSE crawl leak is closed, the BFS level is deduped by IP, and an unknown driver is rejected instead of silently skipping all probing.
- Loading a project with **non-canonical IDs no longer breaks its LAGs**; the assistant's command catalogue reads `data-act` so migrated buttons stay citable.
- Aggregate interface names **no longer resolve to a same-numbered physical port**; a MAC learned on a LAG is transit, not a direct attachment.
- An **amber pill flags cables hidden because their rack isn't placed**, and places the racks in one undoable click.
- An inferred FDB uplink on a LAG port stays **"inferred · to verify"**, and a hidden 2–4-MAC intermediary is offered as a **shared L2 segment** with a suggested role rather than an auto-invented switch.

### Security
- The **panel-skin importer's stored XSS is closed** — the sanitiser now covers unquoted, backtick and slash-separated handlers plus orphan executable tags, and both preview and render sanitise through the DOM.
- Secrets are owner-only and written atomically; the login timing leak is equalised; the AI response body is capped.

## [2.0.4](https://github.com/muttley1973/infranetpro/releases/tag/v2.0.4) — 2026-07-10

### Added
- **Direct NBSTAT over UDP** names Windows hosts in about 40 ms — the CLI queried every local interface and took 10–30 s on a multi-NIC host.
- **Stealth mode shuffles both sweep phases**: a sequential sweep is itself a signature, just like a fixed interval.

### Changed
- The Verify report **stops repeating itself**: "not verifiable" folds under its subnet in Project networks, each network carrying a presence badge.
- The PDF **asset register lists IT assets, not structural cabling** — wall ports and electrical panels have no network identity and showed as empty rows.

## [2.0.2](https://github.com/muttley1973/infranetpro/releases/tag/v2.0.2) – [2.0.3](https://github.com/muttley1973/infranetpro/releases/tag/v2.0.3) — 2026-07-08

### Added
- **Closed-port devices identify themselves**: an opt-in multicast pass (mDNS, SSDP, ONVIF) names the silent ones — the advertised service *is* the type, vendor-neutrally.
- **Off-segment discovery via SNMP ARP**: the crawl proposes hosts seen at L2/L3 that answer neither ping nor SNMP nor LLDP/CDP.
- A **"Project networks"** section in the Verify report, deriving your subnets from documented devices and leases with a per-network covered/blocked/open status.
- The full **IANA PEN registry** (~66k organisations) so a new vendor resolves without a code change.
- **DHCP leases as a discovery source**, and **macsuck** locating each MAC on its switch access port.
- Optional **stealth pacing** for the base sweep, and **manual LAG entry** restored in the port Properties panel.
- A **bilingual PDF report** and an **audit-ready asset register** built from the same secret-free allowlist DTO as the REST API.

### Changed
- **One classifier, for real**: the duplicate legacy implementation (~190 lines) was removed, with a 55-device golden freezing the engine.
- **The MAC vendor stops deciding the device type** — the OUI drops to the identity tier, so any measured signal outranks it; Cast is detected as a protocol; a vendor's company name is stripped of type-nouns before matching.
- SNMP interfaces are matched to ports **by `ifName`, not by position**, so a hand-cabled port is never silently reassigned; a genuine conflict is surfaced as a warning.
- The **access VLAN falls back to `vmVlan`** when the standard PVID is blank, and an SNMP read of VLAN 1 never clobbers a hand-documented VLAN.
- The 10 tool modals moved **out of `<header>`** into a modal root, and frontend assets are served `no-cache` — ending the stale-UI class of confusion.
- **Properties and the asset register show a port MAC** for SNMP infrastructure, where the chassis field is empty. Display-only.
- A **WLAN controller no longer counts as a Wi-Fi radio device** — it has no radios.

### Fixed
- **Sync no longer stalls on a slow SNMP device**: a wall-clock deadline returns partial data, and the topology phase runs in parallel batches.
- The **presence audit no longer greys an unobserved subnet** in a multi-fabric project — absent only if the subnet was genuinely observed.
- No false **"SNMPv3 to configure"** on non-SNMP hosts (a genuine USM engine ID is required); the crawl keeps the resolved vendor; ping retries are spaced.
- **Duplicate ARP phantoms collapsed**, the patient web re-probe moved into deep-scan only, and a faster /24 sweep (single ICMP plus ARP-authoritative liveness).
- An **adaptive SNMP walk retry** so macsuck stops dropping port badges under crawl load.
- **Performance**: the topology overlay batches into a document fragment (724 ms to 7 ms on 1200 lines) and `buildTopoLines` uses index maps (~28× at 1920 nodes).

### Security
- The AI key file is written owner-only, and the dead `/app.js` route that leaked an absolute server path was removed.
