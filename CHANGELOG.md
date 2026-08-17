# Changelog

## [2.9.2] — 2026-08-14
**A port someone shut on purpose no longer looks like a port nobody uses.**

### Added
- **The rack tells a port that was switched off from one that is merely idle.** InfraNet read only `ifOperStatus` — whether a port has link — and never `ifAdminStatus`, whether a person turned it off. On a real Zyxel GS1900 eight ports read "down" and nothing separated the two someone had shut from the six that were simply empty. The two off-states now share a monochrome scale, near-black for shut by hand and dark grey for no link across three consecutive verifies, and the PDF dossier and the draw.io export print the same colours — paper has no tooltip to ask. The port's Properties say it in words, on the SNMP line, next to what the switch reports. A cable you drew yourself over a shut port gets a **"Port shut"** badge and its own row in the Verify — your word and the word written on the device contradict each other, which usually means the kit was decommissioned and the document has not caught up. A status you declared yourself keeps your colour, and the reading is forgotten as soon as the switch stops confirming it: an assertion this strong does not outlive its evidence.

- **The Dashboard says out loud that it never looks at port access control.** The perimeter row under every lens names the dimensions this summary does not judge — WAN, L3 routing, STP, firewall, AAA, restore, sensors, trunk symmetry — and 802.1X, MAB and port-security were not among them, with a "Security" lens sitting right above it. In that lens silence reads as absolution. The new chip is a declaration and not a feature: the OIDs exist (IEEE8021-PAE-MIB), but reading half of them would be worse than reading none, because "authorized" on its own does not tell an authenticated supplicant from a port forced open that checks nobody. Until it can be read whole, it is declared. The handover dossier prints the same list from the same definition, so paper and screen cannot drift apart.

- **The Wi-Fi a DCIM declares now arrives as Wi-Fi.** An 802.11 interface is not a port, it is an antenna — and the import filed it under logical ports, so an imported access point reached the document mute: no band, no channel, no SSID, no encryption, and the wireless audit had nothing to look at. The two models say the same thing in the same shape: NetBox holds a radio as an interface with an RF role and a channel, with wireless LANs hanging off it; InfraNet holds a radio with band, channel and standard, and underneath the BSSs it broadcasts, each with its VLAN and its encryption. Radios now come in as radios, up to the eight per device the model allows — and the ninth is declared, not dropped. The channel comes in only when it is comparable: a DCIM states a wide channel ("80 MHz centred on 42") while the model asks for the primary 20 MHz one, and that block covers four of them without saying which — so the band goes in, being certain, and the channel is left to be chosen, with a row saying so. Each SSID keeps a stable identity derived from its DCIM id, so re-importing the same network does not orphan the links that point at it. One reading is stated out loud rather than passed off as a fact: NetBox says "personal" or "enterprise" and never says the generation, so WPA2 goes in as the common case and a row in the decision list says so — correct it once and it is never overwritten. WEP, which the model has no word for, is left empty instead of rounded to something close.

- **The virtual machines a DCIM declares now land on the host that runs them.** NetBox keeps them in a store of its own and the import never opened it: the hypervisor arrived, its VM panel opened, and the list was empty — a defect in appearance, a datum that never left in fact. Who hosts what has two answers there and only one is explicit. `device` names the physical machine; `cluster` names the cluster, and a cluster with exactly one imported member is not ambiguous, so the VM lands there and the reading is declared as a reading rather than passed off as a fact. A cluster with two or more members says nothing about which one runs it, so the VM stays out with a row explaining why — picking one at random is not documentation. A machine brings its name, role, guest OS, declared state, resources and its virtual adapters, each with MAC, VLAN and addresses: a VM's address now joins the address audit exactly like a device's, and its VLAN feeds the derived trunk on the host's uplink. A device the DCIM puts VMs on becomes a virtualization host — whatever hosts VMs is one, and without that the data would arrive in a panel with no section to show it, which is the very defect this starts from; the type change is declared too, and yours from then on. Two units are converted out loud instead of inside a division: a DCIM counts memory and disk in megabytes where InfraNet shows gigabytes, and after the wide-channel bug — two systems using one unit for two different questions — that gets said rather than assumed. And when none come in, the panel says how many exist and how many arrived: an empty list with nothing to explain it reads as a broken application, which is exactly how this was found.

- **The roles a DCIM gives its VLANs can now fill the declarations that read them — once you say which is which.** InfraNet holds four statements about VLANs that you type by hand today and that a good deal of already-written code reads: management (the security lens, and the rule that a stranger there is infrastructure and never a personal device), voice (bulk assignment to phones, and the derived trunk), guest (whose devices are guests, not undocumented strangers) and the native VLAN. NetBox knows all four — and calls them whatever the person filling the archive felt like. Measured on a real instance: "Access - Data", "Access - Voice", "Access - Wireless", "Management", "Testing". So the engine does not guess. It reads the role off the VLAN, which costs no extra call, and brings each one to the preview as a row of its own with the VLANs it touches; you match it once per role, not once per VLAN, and only what you matched is written. "Access - Wireless" is not the guest network, and a rule that saw the word "wireless" would have declared the whole corporate network a guest network without being asked — the same shortcut that once filed a "KVM Switch" under switches. Three of the four targets are lists and take every VLAN of the role; the native VLAN is a single value, so a role that touches more than one is declared rather than resolved by picking one, and VLAN 1 is never written since it is the default. The same VLAN arriving into two different declarations is applied and said out loud, because the document allows it and it almost always means one of the two matches is wrong. And a role that sits only on networks with no VLAN — "Management" on thirteen of them, on that same real instance — is declared too: there is no VLAN to hang it on, and silence would make the role look like it did not exist.

### Fixed
- **A UPS's outlets stopped being thrown away on import.** Its outlets are the only thing that says who stays on when the power goes — the one question a UPS is bought to answer — and they reached the exact line that files them, only to be counted among the losses. Nothing in the model was missing: not one line of the outlet layout ever looked at the device type, and the cell size comes from the rack units, so a 2U UPS was never an unforeseen case. What kept them out were six copies of `type === 'pdu'` spread across the import, the properties panel, the outlet editor, the rack drawing and the PDF chapter — the same duplicated-definition trap this project keeps meeting, waiting to be flipped. They now ask one predicate, and a test keeps the one copy that cannot import it — the PDF exporter is a classic script — in step with the original. Manual-first where it matters: a UPS you documented by hand keeps the front panel it has, and switches to the outlet grid only once it really has outlets, imported or typed in. Declaring them by hand is now possible from the UPS panel, and the outlet's own panel no longer calls itself a PDU outlet when it belongs to a UPS. **The ATS stays out, and that is a decision, not an oversight**: the point of an ATS is its two inputs, and giving it outlets without them would tell the half that matters less while implying the redundancy had been captured.
- **Nine kinds of device the app has always known could not come in from a DCIM, and one came in wrong.** The role table that turns a DCIM role into an InfraNet type covered infrastructure and stopped there: cameras, phones, PCs, displays, projectors, door controllers, sensors, tablets and KVMs — all types InfraNet draws, documents and audits — had no entry, so an import of eight different terminals produced eight copies of the same generic. The generic itself was wrong twice over: it was the *rack* generic even for devices with no rack, and the fallback that guesses from the name classified a "KVM Switch" as a switch, because the word is right there in it. A wrong type is worse than a missing one — nobody goes back to check it. The table now carries the slugs people actually write in their own DCIM, the name-guessing rules that can collide are tested against each other, and a device with no rack falls back to the floor generic: the class stays unknown, which is honest, but the place is known and was never in doubt.
- **Shutting a port no longer counts as evidence about the cable through it.** The down-streak — consecutive verifies with no link — feeds both the dark grey "no link" shade and the ghost verdict on an inferred cable. A port in `shutdown` has no link *by decision*, which is not an observation about the cabling, yet it was counted all the same. Two things followed: an inferred cable on a port you shut was promoted to ghost, drawn at 35% opacity with a sparse dash, which on screen reads as gone; and reopening the port went straight back to dark grey instead of returning to neutral, on the strength of verifies that had watched a decision rather than a cable. The streak now stands still while the port is shut, is cleared when the port is reopened so the "no link" has to be re-earned over three real verifies, and a cable whose end is shut is never called a ghost even if an older save left a high streak behind.
- **"Replaced device" is no longer claimed from a reading that never happened.** A switch's identity — make, model, serial, firmware — is measured over ENTITY-MIB, and that MIB is walked by index: on a Zyxel GS1900 the chassis sits at index 67,108,992 while a minor "Stack" entry sits at 64, so a walk cut short by a slow device or a busy network left only the low indices and the app crowned the survivor. Two harms followed. The reading that carried no identity **overwrote** a good measurement taken months earlier, and what survived carried no age, so it was compared against your documentation as if freshly read — and out came an accusation built on a partial read. A measured identity now has three states instead of two: reconfirmed, **last known** (kept, dated, and marked as not reconfirmed), or never measured. Whoever accuses — the Verify, the Overview's recovery lens, the handover dossier, three engines that each had their own copy of the rule — now asks the same one and stays quiet unless the measurement was reconfirmed. Whoever informs still reads it: for buying the kit again, the last known model beats nothing, as long as the panel says that is what it is. A failed poll changes nothing at all — nothing was measured and nothing was contradicted.
- **Three fixes to one row of the import panel, all visible on screen.** The row about VLANs carrying more than one network printed a raw `{total}` placeholder, because the decision builder copied context numbers through a closed list of allowed keys and a newer message brought one the list had never heard of; the rule is now reversed, so any numeric key a message carries reaches the text and nobody has to know that line exists. Its example then dumped every network of every VLAN — eighteen `/24`s on a real NetBox — turning three examples into a wall of text; an example is an example, so it shows three and how many remain. And every row that speaks for a whole reading rather than for one device counted itself as a single case: "One IP address stays out" over a hundred and eighty of them, "One VLAN carries more than one network" above a list showing three. Those messages already declared how many cases they stand for; the count now uses it, and the singular is kept for when there really is one.
- **A container prefix no longer counts as overlapping the networks inside it.** An IPAM plan is hierarchical on purpose: a container says "this space is subdivided below", and every network declared inside it sits within its range. The overlap check compared every pair of prefixes and called each of those a conflict — so importing a real NetBox produced a Conformance lens full of accusations about a plan that was in perfect order. On a seven-network plan of the usual shape: eight conflicts, none of them real. The same went for one space declared twice in two different VRFs, which are separate routing tables where the same range can live twice without anyone getting confused. Both are now recognised and kept out of the accusation — and counted separately rather than silently dropped, because a number that quietly shrinks is worse than a number that is wrong. What still gets flagged: two ordinary networks that overlap, the same network declared twice, and a container's amnesty never extends to a prefix sitting inside a network that declared nothing. The information was already in the document — the import writes it down and the Networks panel shows it — but the part that judges had never read it.
- **A reading that never arrived no longer counts as evidence about the cable.** The down-streak — consecutive verifies with no link — was computed from the port's status, which is not a measurement: the user drawing a cable writes it, the DCIM import writes it, and when `ifOperStatus` does not come back the poll leaves the *previous* value in place. So a walk cut short on a long table, or an interface that vanished along with the module it belonged to, kept the series climbing on an observation nobody had repeated — the same shape as the shut port, an unobserved thing turned into proof, and with the same two consequences: an inferred cable promoted to ghost, and a port jumping to dark grey. The link state is now measured into its own field beside "shut by hand", with the same three states — link, no link, **not measured** — and the same expiry, and a poll forgets the readings of every mapped port its walk did not cover. One case was hiding in plain sight: `ifOperStatus = unknown(4)`, which the RFC defines as "the agent cannot determine the state", sat with testing and dormant and came out **amber** — a port the switch says it knows nothing about was lit as though it were under test. It now keeps whatever was known before, like a column that was never read at all. A project saved before this release carries no such measurement and accumulates nothing until the next Sync writes it.
- **A tooltip in the perimeter row showed a raw translation key.** "Trunk symmetry" was declared by the engine but had no wording in either language, and a missing key falls back to the key itself — so hovering that chip read `ov.blindHint.trunkSym`. The it/en parity gate could not see it: the key was absent from both dictionaries, so the two stayed identical and the symmetry was perfect while the hole was too. A structural test now checks that every declared dimension carries its label and its tooltip in both languages, because the perimeter is meant to grow.
- **An address the import had already worked out now reaches the port it belongs to.** The address is not the device's, it is the socket's: a router answers with one per interface, and InfraNet has the field for it — editable in the port panel, and already read by whoever counts occupancy and whoever hunts for duplicate addresses. The import resolved that pairing, wrote it into the document's address list, and stopped there, because nothing reads that list: of an imported router only the management address arrived, and four interface addresses sat in a drawer nobody opens. The port field holds one address and wants it IPv4, so the first IPv4 NetBox declares goes in and never overwrites a value written by hand. What cannot fit — a second address on the same interface, an IPv6, an address on an interface the document has no port for — is counted and declared rather than dropped in silence. Measured against a real NetBox: a router that used to arrive with one address now arrives with five, and a single line says the IPv6 stayed out.
- **"Next free IP" stops offering an address the plan has already booked.** Occupancy was computed from documented devices and active DHCP leases — what is on the wire — and an IPAM also declares addresses that sit on no device at all: reserved, planned, left over from a migration. They are not devices and nobody knows whose they are, but they are not free either, and leaving them out meant suggesting one of them as the next address to hand out. Measured against a real NetBox: a network whose first thirty addresses are booked was proposing the first of them. Reservations now come in with the import and land on the network rather than on a device, which is what they are; they count towards occupancy, keep their own share of the bar so a high number under a nearly empty network still explains itself, and a booking that turns out to have a real device on it counts once, where it can be seen. Two belts against the same trap: NetBox answers a query filter it does not recognise by silently returning everything, so an address attached to an interface is rejected as a reservation both at the fetch and at the mapping.
- **A count taken across the whole archive no longer reads as a count of what you are importing.** The import row that reports the addresses NetBox declares and attaches to nothing takes its number from a census of the entire instance, while an import is nearly always scoped to a site. Measured against a real NetBox: importing a site that held six such addresses, the panel announced a hundred and eighty-six — true of the archive, false of the import, and the examples printed underneath came from other sites too. Narrowing the count is not free: an unattached address has no site of its own, only the one it inherits from whichever prefix contains it, so counting per scope would cost one call for every imported network. Until that is worth paying for, the sentence says what it actually counted.

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
