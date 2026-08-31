# Changelog

## [Unreleased]

### Changed

- **Notifications stay until you dismiss them.** They used to share a single box at the bottom of the screen and fade on a timer, so a second message overwrote a first nobody had read yet — and the longest ones were gone in five and a half seconds whether or not you were looking at that corner. Each message is now its own card with a close button, and several stack in a centred column that empties only when you empty it. The stack scrolls past 60% of the window height rather than pushing the oldest card off the top where it could no longer be closed. The per-message duration argument is gone rather than ignored: fifty-eight call sites were passing a number between 2.5 and 12 seconds, and a number that no longer does anything reads like a number that does.
- **The status badges stopped shoving the toolbar.** The four of them — data freshness, SNMPv3 still to configure, highlighted spare ports, automatic polling — lived in three different places, and each one appearing pushed the action buttons sideways. They now sit in one bay immediately after the search field, which is the only element that can give up width: measured at 1920px with all four lit, Discover, Verify, History, Automations and the account button move by zero pixels, where they used to jump 267, 210 and 210. No width is reserved for them, because reserving it would hold the header at its widest even when there is nothing to report.
- **The toolbar reads as groups instead of one long row.** Thirteen vertical rules separated pairs, singles and triples in no rhythm the eye could use; five remain, and they mark the boundaries of what the bar actually does — the project, the document, the search and its state, the operations on reality, the tools. Deleting a project is no longer painted red at rest: a red that stays lit for three days stops warning anybody, so it arrives on hover and in the confirmation, where the choice is made. «History» gets its word back — a declutter had left it as one of three wordless icons from three unrelated domains — and Automations loses the cog, which in every other application means settings.
- **A full canvas render reuses the DOM instead of recreating it.** Rooms, floor tiles and rack devices are reconciled by key: an element whose rendered output is unchanged is left alone, a changed one is patched in place, and no existing element is ever torn down and recreated. Measured on the render bench against the frozen baseline: a full rebuild costs 54 ms at 500 devices and 92 ms at 1000 (was 119 and 203), the floor-only render no longer grows with project size (29 ms at 1000, was 93), the topology toggle is about 20% faster, and dragging a device no longer produces a single long task. A new end-to-end guard pins the invariant: same key, same DOM element, across any render.
- **Two hot lookups stopped being paid on every render.** Resolving a port id to its device now remembers the answer (cleared together with the existing node index, by the same invalidation), and the rack-unit height no longer forces a whole-document style recalculation on each redraw.
- **Selecting or deselecting a device no longer rebuilds the whole canvas.** A click paid for a full re-render of every room, tile, rack device and port — 122 ms at 500 devices, 205 ms at 1000, measured on the render bench. Selection now repaints only what depends on it: the selection classes, the properties panel, the cables (whose visibility reads the selection) and the topology overlay. The click now costs the same at 500 and at 1000 devices, and the DOM survives it — nodes are no longer torn down and recreated under the pointer.

## [2.11.0] — 2026-08-31

A project documents one building; this release documents how the buildings talk to each other — the sites, the WAN lines each one buys, the tunnels between them, as a map and as a form in the same place, with the declared model checking itself and a WAN chapter in the handover dossier.

### Added

- **Sites and links: the multi-site layer, as a map and as a form.** A panel beside the project picker holds the organisation — its sites, their WAN lines, the tunnels between them. Clicking a site walks down into that site's own project, and the sub-header path leads back up. Writing it by hand is the primary path, not a fallback; reading is open to everyone and writing is admin-only, because documenting is not administering.
- **Each site's box says how much is inside it** — devices and racks, counted server-side inside the parse the project list already does. `null`, never `0`, when a project has no readable state: a project whose contents we do not know is not an empty one.
- **The device holding each end of a link, picked from the site's project or typed.** WAN-edge kinds are suggested first and nothing is filtered out — somebody terminates a tunnel on a NAS. What you pick shows as linked and says when it stops resolving; what you type stays a declaration.
- **A site can take its networks from its project**, in one button. It takes the *declared* rows, never the /24s inferred from device addresses, and it only ever adds.
- **The declared model checks itself.** `lib/inter-site-audit.js` reports a tunnel carrying a network no site claims, the same subnet at two sites, an end pointing at a site that does not exist, a spoke touching no hub, a link declaring a WAN line that belongs to neither of its sites, a link that never says which line carries it, an implausible MTU or bandwidth, and an address declared *public* that is not one — RFC1918, a carrier's `100.64`, a loopback, classified off the IANA special-purpose registry rather than a vendor list. Inconsistencies and gaps stay in separate lists, because a missing line and a false one are not the same thing, and every check that could not run leaves its name and its reason instead of passing for a clean bill of health.
- **The map is drawn by a pure, deterministic module.** Same input, same coordinates, every time — which is what lets the browser, the PDF and the coming draw.io export draw the same map. It zooms and pans with the floor plan's own controls; parallel links fan apart instead of overlapping; a link pointing at a site that does not exist is reported as undrawable with the missing name.
- **The organisation is stored, and the server decides what is well-formed.** `data/organization.json` holds one organisation per installation — not a copy inside each project. `GET` returns it with its audit; `PUT` is admin-only, re-normalises the body and answers with what was actually written plus a count of what was refused.
- **The WAN lines of a site can be read from NetBox.** Circuits become uplinks or inter-site links depending on where their two ends land; a line whose far end is a carrier's provider network stays an uplink and the cloud is said rather than modelled. The bandwidth comes from `port_speed` on the site-side termination, in kbps converted to Mbps. The cable leaving the termination identifies the WAN port — device and interface — so the line can be recognised.
- **What links two sites is read too.** NetBox keeps L2 services and tunnels in `vpn/`, which nothing was opening: VPLS, IPsec, GRE and the rest now arrive alongside the circuits. Their kind is *translated* from NetBox's own closed vocabularies rather than guessed from free text, and anything with no counterpart enters as `other` carrying NetBox's label.
- **After an import, InfraNet offers to register the site on the map** — it offers, because joining the organisation is a company-level declaration. A project already registered says so; a namesake with no project is linked rather than duplicated; a project born from more than one NetBox site is refused with the reason.
- **The dossier gains the WAN chapter.** The map redrawn for print — vector, with its own colours, so it does not come out black or in the generator's theme — and one recovery card per line and per link: who sells it, the circuit id you dictate on the phone, the port bandwidth, the SLA reference, the WAN interface with when it was read, the public addresses as a list, the device holding each end, and the networks the link makes reachable, which on an IPsec **are** the encryption domain. The header counts the chapter's own holes instead of hiding them.
- **A floor plan gains a second level of containment: the storey.** Drawn like a room, not modelled as a device, so a two-storey building stops being two projects or one flat drawing.
- **A value can carry how we know it.** `lib/provenance.js`: `declared` (a person wrote it, and it never ages), `measured` (read from a device at a stated instant) or `derived`. A bare value is deliberately not promoted to `declared`, and a measurement with an unreadable timestamp stays `undated` rather than being stamped with now.
- **Every field of a project has a written class** — `document`, `measure`, `derived`, `private` or `secret` — and therefore a decided fate in an export. A field a person can type in the UI stays a `document`: erring that way adds one field to an export the user made themselves, erring the other way deletes somebody's work.

### Fixed

- **An edit made while a save was in flight disappeared, and the interface said «saved».** The unsaved dot now stays on: that edit could not have been inside a request that had already left. With autosave on, the last edit of the day could stay in memory and never reach the disk.
- **Two sessions saving the same project both got 200 OK, and one afternoon vanished.** The project now carries a version: a save that would overwrite somebody else's work is refused with who wrote and when, and offers to overwrite. Whoever sends no version keeps the old behaviour, so imports, scripts and tests need not learn a protocol.
- **A project served from its backup arrived without saying so.** When a project file cannot be read the store falls back to the last valid copy — older content — and in the same instant the version marker answers «I cannot tell», which lets the save through: the older version then became the project. The browser now warns when the project opens, before it can be saved over, and says which of the two failures happened. A project whose file broke also stays *in the list*, rebuilt from that same copy, instead of disappearing while its content sits intact beside it.
- **Credentials were blanked from a hand-written list, in two copies** — so a fourth secret field would have gone out in the clear with the suite still green. The container is now classified field by field, and both consumers ask that classification for the list instead of keeping one each.
- **A project export carried measurements by construction of a blocklist** that had to be remembered; it now follows the field classification.
- **Running the headless test suite could overwrite your organisation.** The end-to-end harness redirected every store to a temporary directory except that one.
- **Deleting one of two identical networks deleted both.**
- **Every port MAC was lost when importing from NetBox 4.2 or newer**, which moved MAC addresses into objects of their own; and a trunk's native VLAN now survives the import.
- **The import knew which port the WAN line lands on and threw the answer away** — the first question of a line that is down.
- **Two sites sharing one id both went in, and one of them vanished from the map.**
- **On a hub-and-spoke map the sites sat on top of each other** and the links disappeared underneath.
- **A bandwidth no line can have reached the recovery card**: `0`, `-100` and anything else that is not a measurement.
- **Which project opens at start-up was a coin toss** — `updated_at` is truncated to the second, and two projects saved in the same second left the order to the filesystem.
- **The floor plan grid ended and you could walk off it**; a storey could be drawn but not moved or deleted; and the properties panel called a storey a room.
- **«Sites and links» jumped back to the top of the list on every change**, so editing the eighth site meant scrolling back to it each time.
- **«Save» has its word back at 1920**, where most screens are: it had been collapsed to its icon by a measurement taken on the other side of that width.
- **The sub-header said «No project» while a project was open**, and a toolbar button's height depended on whether its label happened to be visible.
- **The import result printed a raw `{n}` at the reader**, and had no singular: «1 linee», «1 servizi» and four more like them.

### Changed

- **A link between two sites answers two questions, not one.** «MPLS» and «IPsec» sat in one dropdown, and they are not alternatives — an IPsec runs *over* an MPLS every day. The model now carries what it runs on (`transport`) and what runs on top (`tunnel`), the technologies went from five to twelve, and the words are the ones a carrier's contract uses rather than ours: *technology* and *topology*, *overlay* and *underlay* explained where they are used.
- **A WAN line's bandwidth field is the port's, not the contract's** — in the panel, in the dossier and in the import, which reads `port_speed` from the site-side termination and never the circuit's `commit_rate`. They are different numbers: on the reference archive one line sells 100 Mbps over a 1000 Mbps port. The field arrives empty more often as a result, and the panel counts and names the lines it left empty.
- **A WAN line carries public addresses, plural**, because one was false as soon as there is a routed block, an IPv6 alongside it, or an HA pair; both ends of a link name their device and their site rather than «first» and «second»; and a link says who sells it and under which circuit id whatever its kind.
- **The coherence panel states the fact and stops adding what follows from it**, says each thing once instead of repeating its heading on every row, and «I could not check» stopped meaning «there was nothing to check».
- **The recovery card became a checklist rather than an inventory**: an IPsec link carries the two proposals you actually retype and a pointer to where the key lives — never the key.
- **The Provider field suggests the providers already in the document** and still takes anything typed, matched on identity rather than on spelling.
- **The map's chips say who sells a link**, a site's colour says whether a finding names it, and clicking a link's badge opens the row that describes it.
- **The «add» buttons moved into the tab bar**, one per tab, so adding the twelfth site no longer means scrolling past eleven; Save sits next to the project bar; and the multi-site button says «Multisito» instead of being an icon with a tooltip.
- **The NetBox import stops flattening the location hierarchy into a name**, and the box reporting a WAN read went from 389 pixels of prose to three lines and two drawers.
- **The overview stopped declaring it was not looking at the WAN**, which had stopped being true.
- **Two fields left the multi-site model** rather than staying as free text nobody filled, and the panel's lists are comma-separated like the rest of the app.

### Removed

- **The «next step» nudge is gone from the sub-header.** It sat in the middle of the bar on every screen, permanently, telling you what to do next.

## [2.10.2] — 2026-08-27

### Fixed

- **The port table stopped writing «1» into the VLAN field of a port nobody had declared.** `_effPortVlan()` always answers — with no source it falls to the site native, which is the right answer for the *cable* and not for the *port* — and writing it inside an editable input turned it into a statement. The properties panel already knew this and left the field empty with the number as a placeholder, so the two disagreed about the same port at the same instant. The test is now `hasPortVlan()` in `app-util.js`, twin of the `hasPortStatus()` that was already there for the identical problem on port state, and both renderers ask it.
- **The L3 report stopped calling «declared» the VLANs a project is merely born with.** A new project seeds `vlanColors` with 10/20/30/40/99 as a palette, and every one of them earned a row reading «declared VLAN, no network» — declared by nobody. A colour is not an act; a name is, and so is having chosen who routes it. ⚠️ The palette itself stays whole, so a prefix citing VLAN 40 keeps its colour: what narrows is who earns a row of their own. It is the same warning `ipam-audit` already carried — it compares against what was declared and never against `vlanColors` — which had not reached here.
- **A model recognised in a scan could take the wrong vendor's model when its designation collapsed to a short number.** Stripping the leading vendor code off a model core left short shared numbers that met across vendors — a TP-Link «TL-SG1008D» resolved to «D-Link DES-1008D», a D-Link «DES-1024D» to «Fortinet FortiSwitch 1024D», both reducing to «1008d»/«1024d». A false exact on the SOHO long tail is the very kind of invention the recogniser must not make. A core now carries an EXACT only when it stays specific — it keeps a separator («2960-24TC-L») or has at least two letters («SRX300», «GS308E»); a core collapsed to a short number is left to the family step, which needs two or more variants and can never assert a single wrong model. Vendor-neutral, a rule on the shape of the core and never on the brand, and it subsumes the earlier bare-number guard. Found by a broad SOHO sweep across vendors.

### Added

- **A cable whose device carries an IP in a different VLAN than its port now says so.** The colour follows the endpoint's declared-IP VLAN while the port shows its own; instead of the two disagreeing in silence, a sober warning (`ip-vlan-mismatch`) names both numbers. The verdict is decided once in `link-vlan-color` and only reported by the cable validator, like `vlan-ends-disagree`.
- **A trackpad pinch now zooms the floor and the rack in Safari.** Chrome and Firefox deliver the pinch as a `ctrl`+wheel event the zoom already caught; Safari sends its own `gesture*` stream with a cumulative scale, and nothing was listening. The scale ratio now drives the same `zoomFloor`/`zoomRack`, with the point under the fingers held fixed.
- **Clicking a cable in the dashboard now lights up its path on the floor.** The «Cables» list opened one endpoint of the row; a cable row now carries its link id and, on click, leaves the Panoramica and traces the whole physical route (through patch panels) across the floor and the rack, with the «Physical path» panel open — reusing the same highlight the topology view and the port popup already use.
- **The dashboard’s subnet, gateway, VLAN and LLDP/CDP neighbour rows are clickable too.** A subnet or gateway opens its network detail in «Networks»; a VLAN opens its card in «VLAN»; an LLDP/CDP neighbour that matches a documented cable lights up that cable’s path. Each one leaves the Panoramica for the place where the item is edited or shown — the same move the cable rows already make.
- **A device that answers on more than one NIC is imported as one box, not one per address.** A multi-homed server or NAS shows up in a scan as several rows — one per responding IP, each with its own MAC — and each used to become its own node. A pre-pass (`lib/host-merge.js`) now folds those rows into one, on *authoritative* keys only: the device's own IP table, its serial number, its SNMP engine-id, its mDNS UUID — never a shared name, a MAC or a model id, which identical or neighbouring boxes also carry. The fold is shown (a «+N NIC» badge that names the key) and reversible (a «split» control), and a hard veto keeps two boxes apart the instant their serials disagree.
- **Each interface now shows the IP it owns.** The port panel always had a per-interface address field — a router has one address per interface — but nothing filled it. A Sync now takes the address the device publishes for each interface (from its own IP table, matched to the interface by index) and writes it on the matching port, fill-if-empty so a hand-typed address is never overwritten. It is also how a folded second NIC resurfaces: the box declares the interface, and its port carries the IP on the next Sync.
- **A model string measured in a scan can now be matched to the catalogue, with a confidence it never overstates.** The device-type resolver (`lib/device-catalog.js`) only matched exact keys and only ran in the DCIM import; it gains a fuzzy `model-core` stage and a separate `confidence` field. An order code or an ENTITY-MIB `entPhysicalModelName` resolves `exact`; a bare family root like `2960` resolves `family` — several variants, carrying no entry, so ports and rack height can never be auto-filled from a guess. A part-number index (the order code many devices report verbatim — `WS-C2960-24TC-L`, `J9776A`, `ISR4331/K9`) is tried first; a bare number is barred from `exact` (no «Nexus 9000» → «ION 9000»), and version strings, unmatched part numbers, OS banners and a virtual verdict all decline. Opt-in (`{fuzzy:true}`), so the DCIM import stays exact-only and byte-identical. A golden trap-table is the oracle.
- **A scan now recognises the device model and proposes it, without ever applying it on its own.** Each discovered row is resolved against the catalogue — from its `entPhysicalModelName`, else its `sysDescr`, else its mDNS model (the resolver self-filters banners, so feeding `sysDescr` is safe: a Zyxel reports «GS1900-24» there, not in ENTITY-MIB, measured on a real /24) — and a chip in the results names the match, `exact` or `family`. On import the recognised model rides onto the node as a *measured proposal* (`modelMatch`), never as the editable `model` field and never touching the ports; the properties panel shows an «Adopt» banner, and only an explicit click applies the full template — the same manual choice, one step shorter. Vendor-neutral, no per-brand rule.

### Changed

- **The neutral cable colour is kept a step lighter than the inactive-port grey** (`#6b7d99` → `#a6aab1`), so a neutral cable (multi-VLAN trunk or routed) crossing a port at rest stays visible instead of blending with `--inactive-color`. One definition — floor, rack, topology, PDF and draw.io all follow.
- **The port panel’s VLAN section reads at one size.** Its explanatory sub-texts — the trunk summary, the VLAN-name tag, the range hint, the «N VLANs configured» line — now use the hint size like every other hint (secondary weight is carried by colour, not a smaller body), and the carried-VLAN field matches the native-VLAN field instead of a smaller monospace box.
- **The cable diagnostics now read in one voice, and the trunk carried-VLAN warning is legible again.** When one trunk end carried no extra VLAN the warning printed a bare «—» as the subject of the sentence («— only on one side»); each side is now named after a label, so the placeholder reads as «none». The Italian dropped the untranslated «Allowed VLAN» / «allowed-list» for the app’s own «VLAN trasportate» (carried VLANs), and the three VLAN-mismatch titles — access, native and carried — now share the «not aligned» register their own fix line already used («Align…»). Two smaller alignments came with it: «Max speed» to match the field label, and «permanent link» for the TIA-568 term.

## [2.10.1] — 2026-08-23

### Fixed

- **A VLAN nobody declared is left absent, not written down as 1**, and the measurement no longer outlives the reading that produced it. On the bench a Cisco vIOS publishes neither table that carries an access port's VLAN, and all nine of its ports came out on VLAN 1.
- **A port bundled into an aggregate inherits what the aggregate declares.** The lookup used the logical id where the index was the interface index — `Po1` is id 1 at index 10 — so the block had never once run.
- **An interface that calls itself virtual is not a port you can cable.** A Cisco wireless controller publishes «Virtual Interface» beside its real port, and was documented with two.
- **A management interface written out in full is the one announced in short.** «Management Port» in the interface table is «mgmt» over LLDP, and the cable was lost without a word.
- **The native VLAN of a Cisco trunk is read instead of assumed.** It lives in a third column nothing was asking for, so every trunk read VLAN 1 — right by coincidence until someone sets `switchport trunk native vlan 99`.
- **A cable's colour asked the wrong question, in eight places, of the wrong device.** It painted the *native* VLAN, which on a trunk is one among several; an access cable now takes the one VLAN that applies and a trunk takes none, the authority is whoever *switches* the VLAN rather than whoever is typed «active», and one module decides for the rack, the topology, the floor plan, the PDF and both exports — which had already drifted into painting the same cable two colours.
- **A cable whose two ends name different VLANs no longer picks one and asserts it.** It went out as «VLAN 20, set by hand», the same hex as a cable whose ends agree, in the one state where the drawing was certain and the network was broken.
- **A switch declared in a stack could make the whole properties panel disappear.** The guard accepted two shapes and the panel read only one, so on a node the guard had just approved the read threw and took everything with it.
- **A device panel stopped filling itself in, and a camera stopped specifying itself.** Ninety-eight editable fields opened pre-filled with values nobody had declared and nothing had measured; clearing one wrote the default straight back, so «I don't know» was not expressible.
- **A device missing from the network had its red ring painted over by the device below it**, leaving a single horizontal line that reads as a rendering artefact.
- **A port declared faulty was exported grey, in all three exports.** Two functions shared the name `normalizeStatus` on `window`; the port one is `normalizePortStatus` now. ⚠️ On screen the red was correct — it was wrong only in the file you take into the machine room.
- **A cable whose two ends contradict each other is a finding, not just a grey line.** Neutral is also what a trunk and a routed link look like, so the one case where the network is genuinely broken was the only one without a name.
- **A VLAN the document carries and the plan never names is said out loud.** ⚠️ Not compared against `vlanColors`, which fills itself with every VLAN ever *seen* — the check would have been green on every project ever.
- **A hierarchy you wrote by hand can say it is one.** A `/16` with its `/24`s inside it was accused of overlapping its own subnets on every opening of the report, and the accusation was impossible to close.
- **A cable that does not exist no longer reports itself as carrying VLAN 1.** ⚠️ That literal 1 was also a second definition of the site native, which on a site declaring 99 still said 1.
- **Every VLAN on every Cisco switch was named «1».** The VTP fallback read column `.2` of `vtpVlanTable` — the state — instead of `.4`, the name, and the overview called the result a fabric in disagreement: five VLANs «in conflict» on the bench, four born from one digit of an OID.
- **The routed entry in the VLAN legend is a badge like the others, and it filters.** It read «instradato» at four times the width of a VLAN badge, and it was inert.
- **The strongest proof state of a cable is called «Strong», not «Fresh».** The badge names how strong the adjacency is, not how recent it is.
- **A MAC the network places at a documented device's address is no longer accused of being undocumented.** Infrastructure exposes no device MAC over SNMP, so the accusation was true in form, wrong in substance, and impossible to close.
- **A host the crawl only saw in an ARP table is asked who it is before being described.** Three pieces of bench infrastructure were each typed as a PC, one UDP round-trip away with credentials the crawl already had.
- **A disagreement about a VLAN name says who disagrees, and stops inventing ones that are not there.** It printed «DATA ↔ DATA» in the very case the check exists for; and names now compare through a case-folding key, since `default` and `Default` are one name written by two vendors.

### Added

- **A port can be declared L3, so a hand-drawn project stops claiming a router-to-router cable switches.** «Routed» was measurable and not sayable, and that cable fell to the floor and was painted VLAN 1 — not a missing answer but a wrong one. It is the third value of port mode rather than a switch beside it, and it can name which declared network it routes, which gives the device's SVI section the port column it was missing.
- **A routed link is told apart from one whose VLAN we simply cannot read**, and «routes» is measured as «is not a port of the bridge» rather than «owns an address», which any host does. ⚠️ Asymmetric on purpose: being in `dot1dBasePortIfIndex` is a veto, being absent proves nothing — a vIOS publishes it for two ports out of eight.
- **A cable that switches always has a VLAN, so it always has a colour** — every bridge port has a PVID, and where nobody configured one it is 1. The neutral is now a colour of its own and means exactly two things: a multi-VLAN trunk, or a routed link.
- **The cable panel says what the cable is and why** — «VLAN 99», «trunk — 4 VLANs, none prevails», «routed link» — with the source in plain words, and a trunk's carried VLANs as coloured pills.
- **A trunk whose declared VLANs no longer match the measured ones says so**, and the two ends are compared on what they carry rather than on the native alone — the most common cause of «it works for some VLANs and not others».
- **A router-on-a-stick stops being invisible.** A dot1Q sub-interface was discarded as «not physical», taking the VLAN and the address with it — on the bench the management address of a CSR1000v sits there, so the interface InfraNet was talking through did not exist in the document.
- **An address that lives outside every declared network is something the app says out loud**, judged per address family so a plan with no IPv6 accuses nobody.
- **«I could not check» stopped looking exactly like «there is nothing wrong».** Two fallbacks returned the shape of a clean network, and an audit that says nothing is believed.
- **A bundle is checked for how many members it has and where they live.** A group with one member aggregates nothing, and members on two devices only bundle if those devices are one logical switch.
- **A LAG's VLAN can be declared once, on the bundle**, instead of on every member with a coherence warning for the one you forgot.
- **The handover dossier prints what a trunk carries** instead of its native VLAN, which is the least informative of them.
- **The declared operating status carries the padlock the other hand-set fields already had.** It was set invisibly and could not be cleared.
- **The rack's zoom percentage became the way back.** Past a certain zoom the chassis falls outside its window and the only way back was the minus button, 10% at a time.

### Changed

- **Everything about a cable's VLAN lives in one collapsible section**, with the port mode moved up among the badges that answer «what is this cable». A trunk used to state its VLANs four times over; the pills carry it alone now.
- **A port has three states, and «idle» is no longer one of them** — one word had been doing four different jobs, and nothing read it to decide anything. The device's own word survives as `operWait`, printed untranslated.
- **A port with no link for three verifies is amber, not dark grey.** A `shutdown` is a decision and stays quiet; no link is an ambiguous symptom somebody has to go and look at. ⚠️ A deeper `#d29922` than the generic warning amber, written in three places since the exports cannot read a CSS token, with a test comparing them.
- **The status badges are bigger and stay on one line**, verified across all 1,680 combinations the row can produce.
- **Every info box in the properties panel states its rule in one line, at one size**, with the rest in its tooltip. They had carried five hand-written sizes, four of them off the type scale, and one box was written in Italian inside the renderer. A character budget guards them now.
- **The LAG section speaks the panel's language, and the proof badge's shape left the code that builds it.**

## [2.10.0] — 2026-08-20

### Added

- **NetBox locations become rooms on the floor plan**, with their racks and devices inside them. ⚠️ NetBox has no geometry — that the room exists is measured, where it sits and how big it is is our choice — and what has no location stays **outside** the rooms rather than in one nobody declared.
- **Hosting virtual machines is a capability, not a type.** Storage, NAS and servers carry the same VM section a hypervisor has, and the import stops rewriting a device's type to make room for them.
- **A declared life-cycle status** — planned through out of service. It changes how silence is read: a planned device that stays quiet is expected, and one declared out of service that *answers* is flagged.
- **Imported objects keep their DCIM identity** — ports, patch-panel slots and racks carry the id of the object they came from, so renaming a rack upstream is a rename and not a delete followed by an arrival. ⚠️ The reference never lives inside the InfraNet id, because ids get renumbered.
- **Two devices that announce each other are drawn as adjacent even when the port is unknown**, with `?` where the port would be rather than one picked at random. And a neighbour that produces no cable now says why — the silence used to look exactly like a device with no neighbours at all.

### Fixed

- **An LLDP neighbour is read from the subtype it declares, not from the length of its value.** «Six bytes means a MAC» lost the addresses written out in full and invented others out of port names — and the encoding is the *answering* agent's choice, not the advertiser's.
- **The local port of a neighbour is read, not assumed to be an ifIndex.** On the bench Arista, `Management1` is LLDP port 97 and interface 999001, so the cable was dropped without a word.
- **A port a neighbour identifies by MAC resolves to that port** instead of falling back to the first free one and being marked inferred.
- **A room follows the cursor while you drag it, and the grid you see is the grid you land on.** The live update was skipped in silence for rooms; and the grid was drawn at 40px while things snapped at 20.
- **The assistant no longer says every switch is full.** It counted port *records*, which only exist once a port is documented — 291 free ports per the Overview, 0 per the assistant, on all fourteen bench switches.
- **A PDU stops having two outlet counts.** «Apply model» wrote one level above `node.spec`, so the rack grid and the Overview disagreed by design.
- **The public API counts a device as SNMP-managed only if it can be polled.** Picking a driver was enough, so a device with no address landed in the `snmp_managed` Ansible group with nowhere to connect.
- **The Dashboard stops declaring a full network empty.** Loading a project reset the view flag while the page stayed put, so the Overview bailed out of every render and kept the empty screen drawn before the project arrived.

## [2.9.2] — 2026-08-18
**Power gets documented the way it actually fails: by group, not by socket.**

### Added

- **Outlet groups on UPSs and strips.** A group answers the question a UPS is bought for — what stays on when the power goes, and what can be shed to last longer. Two axes, measured across APC, Eaton, Vertiv, CyberPower, Ubiquiti and others: whether the group can be switched on its own, and whether the battery holds it. The rack repeats each group as a colour band above its outlets, over the fill that shows state; the handover dossier prints them. **Declared, not measured**: RFC 1628 has no outlet groups, every brand keeps them in a private MIB.
- **A UPS from the catalogue arrives with its outlets.** The slim catalogue kept only network ports, so 53 UPS models carried none. They now come across with name and socket type, and the group is read from the name where the maker wrote it — 56% of UPS outlets, measured. What the name does not say stays blank: position is not evidence. Applying a model never costs you work: what you wrote on an outlet survives, and groups you declared are not renamed.
- **`--from-canonical` rebuilds the slim catalogue without the network**, reprojecting it from the canonical file on disk and leaving the manifest and diff untouched — the source did not change, only the projection.
- **The rack tells a port shut on purpose from one merely idle.** InfraNet read only whether a port has link, never whether someone turned it off. The two off-states now share a monochrome scale — near-black for shut by hand, dark grey for no link across three verifies — and the PDF and draw.io export print the same colours. A cable you drew over a shut port gets a "Port shut" badge: your word and the switch contradict each other. A status you declared keeps your colour, and the reading expires when the switch stops confirming it.
- **The Dashboard says out loud that it never looks at port access control.** 802.1X, MAB and port-security were missing from the list of dimensions the summary does not judge, with a "Security" lens right above it — and there silence reads as absolution. Declaring it beats reading half of it: "authorized" alone cannot tell an authenticated supplicant from a port forced open.
- **Wi-Fi from a DCIM arrives as Wi-Fi.** An 802.11 interface is an antenna, not a port: radios now come in as radios with band, standard and their BSSs, up to the eight the model allows, and the ninth is declared rather than dropped. The channel enters only when comparable — a wide channel names a block, not the primary 20 MHz one — and WPA2 goes in as the common case with a row saying so.
- **Virtual machines land on the host that runs them.** A cluster with exactly one imported member is unambiguous, so the VM goes there and the reading is declared as a reading; a cluster with two or more says nothing, so the VM stays out with the reason. Adapters bring MAC, VLAN and addresses, and megabytes become gigabytes out loud rather than inside a division.
- **IPAM roles can fill the four VLAN declarations that read them** — management, voice, guest, native — matched once per role, not once per VLAN. "Access - Wireless" is not the guest network: a rule reading the word "wireless" would have declared the whole corporate network a guest network.
- **Compare with the DCIM, without writing anything.** Rows show the document value and the DCIM value side by side. A device you added by hand is never reported as "gone from the DCIM" — that would accuse you of your own work — only declared fields are compared, and "different" is not "wrong": with no per-field timestamp nobody can say who changed it.

### Changed

- **One site, one project.** Step one is the site list, and an imported project records the slice of the DCIM it was born from — measured from the devices that really came in. The comparison re-reads exactly that slice: against a single-site project, comparing everything reported 181 new devices, all true and all useless. The instance address is deliberately not written into the document, which gets exported and passed around.
- **The import preview says each thing once.** Four ways of stating the same numbers, and two attention signals whose counts disagreed — the banner counted devices, the row counts decisions. Now the estimate is the only statement of numbers, losses join it as chips that jump to the row explaining them, and rows whose default is already right collapse to one line.
- **The manuals no longer cut a box in half at a page change.** 9 split blocks in Italian and 8 in English, measured on the rendered PDFs, now zero — at the cost of one page.

### Fixed

- **A UPS's outlets stopped being thrown away on import.** Nothing in the model was missing: six copies of `type === 'pdu'` across import, panels, rack and PDF kept them out. They now ask one predicate. A UPS you documented by hand keeps its front panel until it really has outlets. **The ATS stays out on purpose**: its two inputs are the point, and outlets without them would imply the redundancy had been captured.
- **Nine kinds of device could not come in from a DCIM, and one came in wrong.** Cameras, phones, PCs, displays, projectors, door controllers, sensors, tablets and KVMs had no entry, so eight different terminals produced eight copies of one generic — the *rack* generic, even with no rack, and the name-guessing rule filed a "KVM Switch" under switches.
- **Renaming a radio changes the labels that name it.** The name lived on the device and nothing that composes a label ever read it: six independent derivations each sliced the internal port id, so a radio printed "Pradio2" whatever you called it. One function answers now — including the names the DCIM import had already brought in and never shown.
- **A shut port, and a reading that never arrived, stop counting as evidence about the cable.** Both fed the down-streak that promotes an inferred cable to ghost and darkens a port. A decision is not an observation, and an unanswered poll is not a measurement: link state is now measured into its own field with three states — link, no link, **not measured** — and `unknown(4)`, which the RFC defines as "the agent cannot determine", no longer comes out amber.
- **"Replaced device" is no longer claimed from a reading that never happened.** A walk cut short left only the low ENTITY-MIB indices and the survivor was crowned, overwriting a good measurement and then being compared as if fresh. A measured identity now has three states — reconfirmed, **last known** (kept and dated), never measured — and whoever accuses asks the same rule and stays quiet unless it was reconfirmed.
- **A container prefix no longer counts as overlapping the networks inside it.** An IPAM plan is hierarchical on purpose: on a seven-network plan of the usual shape, eight conflicts, none real. Same for one space declared twice in two VRFs. Both are recognised and counted separately rather than silently dropped.
- **An address the import had worked out now reaches the port it belongs to.** The address is the socket's, not the device's. A router that used to arrive with one address now arrives with five, and what cannot fit — a second address, an IPv6, an interface with no port — is counted and declared.
- **"Next free IP" stops offering an address the plan has already booked.** IPAM reservations sit on no device but are not free either: they now come in, land on the network rather than on a device, and keep their own share of the occupancy bar.
- **A count taken across the whole archive no longer reads as a count of what you are importing.** Importing a site with six unattached addresses announced a hundred and eighty-six. Narrowing it properly costs one call per network; until that is worth paying, the sentence says what it actually counted.
- **Three fixes to one row of the import panel.** A raw `{total}` placeholder printed as-is, because a closed allow-list of context keys had never heard of it; an example dumped eighteen networks instead of three; and a row speaking for a whole reading counted itself as a single case — "One IP address stays out" over a hundred and eighty of them.
- **A tooltip showed a raw translation key.** "Trunk symmetry" was declared by the engine with no wording in either language, and the it/en parity gate could not see it: the key was absent from both, so the symmetry was perfect while the hole was too. A structural test now checks that every declared dimension carries its label and tooltip in both languages.

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
