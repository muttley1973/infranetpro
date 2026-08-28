# Changelog

## [Unreleased] — post-v2.10.2

The multi-site layer: a project documents one building, and this is the floor above it — how the
buildings talk to each other (plan: `_local/notes/PIANO_multi-sede-wan-vpn.md`). Most of what
follows is the machinery under it; the last entry is the part you can see and use.

### Added

- **Sites and links: the multi-site layer is now something you can look at and fill in.** A new panel beside the project picker holds the organisation — its sites, their WAN uplinks, the tunnels between them — as a map and as a form, in the same place. They are not two features: a map nobody can populate stays empty forever, and a form with no map never shows what it is for. Writing it by hand is the *primary* path, not a fallback: the one-person IT department this is built for does not run NetBox, and the coming NetBox import will fill these same fields rather than different ones. Clicking a site on the map walks down into that site's own project. Reading is open to everyone and writing is admin-only, because documenting is not administering. Three things it refuses to do: it does not recompute the coherence audit, which already travels inside the server's answer — a second copy of that logic is how this codebase has grown a duplicate definition twelve times; after saving it adopts what the server actually *wrote* rather than what was sent, so a subnet coming back canonical or a link being refused is visible instead of silent; and a line that is not a network is named before saving rather than dropped afterwards. A measured value edited by hand becomes a declaration — that is manual-first — and the field says what it was beforehand, so nobody overwrites a reading without noticing.
- **The device that holds each end of a link — pickable from the site's project, or typed.** «Which box do I put my hands on» is the question you open this map at 3am to answer. The field suggests the devices of the site's project, WAN-edge kinds first — the firewall is the internet edge of a small business, the router is what you find when the line is carrier-managed — but nothing is filtered out, because somebody terminates a tunnel on a NAS and that is not ours to refuse. It is not a closed list: a carrier's CE is usually not a documented node and a site may not have a project yet, so forcing a choice from a list would have made the commonest case undocumentable. What you pick shows as linked and says when it stops resolving; what you type stays a declaration.
- **A site can take its networks from its project.** Instead of retyping what the site's project already says, one button adds them. It takes the *declared* networks — the rows of the project's Networks panel — and never the /24s inferred from device addresses: the first are a document, and copying a document into another document is honest; the second are a derivation, and promoting them to a company-level declaration would be inventing with the face of a choice. It only ever adds, never replaces, because there is no way to tell a hand-typed row from one taken yesterday, and a button that can delete somebody's work when mis-clicked is the wrong button. It reports two numbers — how many were added and how many the project declares — since «added 0 of 4» and «added 0 of 0» are different answers.
- **Where each site goes on the map is decided by a pure, deterministic module.** `lib/inter-site-layout.js` turns an organisation into coordinates: no SVG, no DOM, no strings — which is what lets the browser and the coming PDF / draw.io export draw *the same* map, because they read the same numbers. Same input, same coordinates, every time: no force-directed settling, because a map that rearranges itself on every open cannot be compared with yesterday's or printed twice alike. The shape follows the declared role — one declared hub goes to the centre, and zero hubs or two fall back to a ring rather than picking one for you. Two links between the same pair of sites (the real case: an MPLS primary with an IPsec backup) fan apart instead of drawing one line over the other. A link pointing at a site that does not exist cannot be drawn, so it is reported as undrawable with the missing name — a map that loses a tunnel in silence is worse than one that shows the hole.

- **A value can now carry how we know it.** `lib/provenance.js` is the envelope: a value is `declared` (a person wrote it — and it never ages, because a decision does not expire), `measured` (read from a device at a stated instant), or `derived` (computed, naming what from). A bare value is deliberately *not* promoted to `declared` for convenience, and a measurement whose timestamp cannot be read is never stamped with the current time — it stays `undated` and says so. It composes with `lib/source-ref.js` instead of repeating it: *which* external object a value came from is an identity question that already has a home, so there is no fourth `imported` origin. The four state engines that exist (`proof`, `temporal-confidence`, `identity-reconcile`, presence) are untouched; new facts are born with the envelope and the model converges forward. ⚠️ One thing the plan got wrong and the code does not: there is no single age rule to unify. `proof.js` (6h / 7d / 30d) measures how fresh the *proof that a device is alive* is; `temporal-confidence.js` (30d / 60d) measures confidence in a *repeated sighting*. Different questions, legitimately different half-lives — so what is shared is the shape of the answer, and the scale is a required argument with no silent default.
- **The model of the multi-site layer: an organisation above the per-site projects.** InfraNet documents one site per project and the projects are islands — nothing modelled the WAN uplinks and the site-to-site tunnels that actually hold a multi-site business together. `lib/inter-site.js` carries sites (each a *reference* to its existing project, never a copy), WAN uplinks, and inter-site links over one closed vocabulary — `ipsec`, `mpls`, `vpls`, `sdwan`, `directLink`. Which subnets a link makes reachable at each end is a single concept (`reach`) across every kind — on an IPsec link it *is* the encryption domain — so no vendor's word enters the model and no viewpoint-dependent «local/remote» either. The envelope sits only on what a device could actually report: a provider, a circuit ID or a contracted rate are declarations by construction (and the contracted rate is never `ifSpeed`). Subnets are canonicalised through `lib/cidr`, so the same network written two ways is one subnet. Model only — no view, no network, no diagnostics.
- **A TypeScript source can no longer be added under `lib/`, and the guard says why.** These modules were written as `.ts` first: Node strips types natively from 22.18 and esbuild compiles them for free, so they ran locally on Node 24. They would have broken CI. `package.json` declares `engines: node >=16` — this is self-hosted software that runs on other people's machines — and CI runs Node **18.x and 20.x**, where the CommonJS loader knows only `.js`, `.json` and `.node`: an unknown extension is handed to the `.js` handler, so a `.ts` file is read as JavaScript and its type annotations are a `SyntaxError`. Verifying that the tool works without checking *where it has to run* is exactly the mistake; `test/ts-gate.test.js` now fails on any `lib/*.ts` (`lib/types.d.ts`, an ambient declaration nobody requires, is the one legitimate exception), checks that `engines` still justifies the ban, and parses every `lib/*.js` the way Node 18 would. Nothing was lost but the extension: the types live as JSDoc `@typedef` — the shared ones in `lib/types.d.ts`, where the repo already keeps cross-module domain types — `tsc` checks them exactly as before, and a `.js` is additionally covered by ESLint and `npm run check`, which a `.ts` was not.

- **The multi-site model can now check itself, on the declared data alone.** `lib/inter-site-audit.js` answers the questions a hand-drawn multi-site document should have to survive: a tunnel that carries a network no site claims; the same subnet declared at two sites; an endpoint pointing at a site that does not exist; a spoke that touches no hub. Incoherences and gaps are kept apart — a tunnel carrying a network nobody owns is *wrong*, an uplink with no public IP is merely *unwritten*, and folding the two is how an audit starts crying wolf. Every check that could not run leaves its name and its reason in `notChecked`, the same discipline `lib/ipam-audit.js` already carries: an empty list must mean "I looked", never also "I didn't". ⚠️ Two corrections to the plan came out of building it. The "asymmetric encryption domain between the two ends" it called for is *not expressible* on this model and is said so rather than faked: `reach` is one declaration on the link, not two to compare — two ends that contradict each other only show up when both firewalls are read, which is drift. And the obvious check (a link's `reach` at one end must sit inside that site's own subnets) is deliberately absent: through a hub, a link legitimately carries a third site's networks, so that check would fire on every real hub-and-spoke.
- **The multi-site model is now stored, and the server is the one that decides what is well-formed.** `data/organization.json` holds one organisation per installation — this install of InfraNet is this company, with its sites — which is the shape of the 2-to-5-site business the layer exists for; the plan puts MSP multi-tenancy explicitly out of scope, and the day it is wanted this is the file to change, deliberately. It does NOT live inside a project: the organisation is shared across the per-site projects, and a copy in each would be, by construction, the same fact in two places. Sites point at their project with `projectRef` — a reference, never a copy. `GET /api/organization` is open like the project list and returns the organisation together with its coherence audit; `PUT` replaces it and is admin-only, like saving a project. The server re-normalises the body rather than trusting the client, and answers with what was actually WRITTEN plus a count of what was refused: a link with a `kind` outside the vocabulary must not enter, but if it vanished in silence the person who saved would believe they had saved it. The one check a browser cannot make itself — whether a site's `projectRef` points at a project that exists — is added by the route, and says so in `notChecked` when the project list cannot be read.
- **Every field of a project now has a written class.** `lib/project-schema.js` says, for each field of `state`/`node`/`spec`/`port`/`link`, whether it is a `document` (a person wrote it), a `measure` (a device reported it), `derived`, `private`, or a `secret` — and therefore what happens to it in an export. 165 fields, censused from thirteen real projects. For the older fields that can come from either a hand or a reading — `serialNumber`, `mac`, `model`, `ip` — the rule is that anything a person can type in the UI stays a `document`: getting it wrong towards `document` puts one extra field in an export the user made themselves, while getting it wrong towards `measure` **deletes somebody's work**, and the two mistakes are not equivalent. An unclassified field is kept for the same reason; what makes the gap loud is `test/project-schema.test.js`, which goes red when a field seen in a real project has no class.


### Fixed

- **Every port MAC was being lost when importing from NetBox 4.2 or newer.** NetBox 4.2 moved MAC addresses into objects of their own: the flat `mac_address` field is still on the interface but it reads `null`, and the value lives in `primary_mac_address`. The mapper already knew this and handled both shapes — but only for the virtual NICs of VMs; physical ports read the flat field and nothing else. Measured against a real NetBox **4.6.7**: every imported port came back without a MAC. That is not a cosmetic loss — `port.mac` is what `macKey`, the presence audit, FDB matching and hardware-identity drift are all built on, so an import silently produced a document that could not be reconciled with the network it described. The rule was already written, in one place; the other place never got it, which is this codebase's most familiar failure. Both shapes now work everywhere, and an interface carrying neither still gets no MAC invented for it.
- **A trunk's native VLAN now survives the import from NetBox.** In NetBox `untagged_vlan` means two different things depending on the interface mode, and both are a VLAN somebody *declared*: on an access port it is the PVID, on a tagged port it is the **native**. The mapper only read the first case, so on every trunk imported from a DCIM the declared native was read and thrown away. That is not cosmetic: InfraNet has the field for it — on a trunk `vlanOvr` **is** the native, which `lib/link-vlan-color.js` states in as many words — and builds an **error**-level diagnosis on top of it. `native-mismatch` (`lib/cable-validate.js`) catches two switches whose trunk ends declare different natives, which is untagged traffic crossing where it must not; on any project born from a NetBox import that check could never fire, because both ends arrived empty. A tagged interface with no `untagged_vlan` still gets none — an absent field at the source stays absent here. Found by a new two-site import smoke (`_local/netbox/`), not by a report.


### Removed


### Changed

- **Both ends of a link now name the device that holds them, whatever the kind.** The ends were modelled on IPsec links only, which is backwards: on an MPLS or a VPLS the end is the CE — a device in a rack, with ports on it — and it is precisely on the carrier links that you most need to know which box it is, because it is often not the one you configured. The ends are now common to every kind, the same reasoning that made `reach` one concept for all of them. An end holds *either* a reference to a node in the site's project *or* a name written by hand, never both: a name copied next to a reference is the same name written twice, and the two diverge the first time the node is renamed.
- **A WAN uplink carries public addresses, plural — because one was simply false.** A single public IP per uplink does not survive three ordinary cases: a business line almost always comes with a *routed block* (a /29, a /28) of which one address sits on the WAN interface and the rest serve 1:1 NAT publications; IPv6 is a second address (or a delegated prefix) on the *same* line, not a different uplink; and an HA pair exposes both nodes plus the shared VIP. With one field you had to pick one and stay silent about the others, which is documenting badly on purpose. Each entry is either an address (`203.0.113.10`, `2001:db8::1`) or a block (`203.0.113.8/29`), and the two are normalised down different paths on purpose — sending an address through the subnet canonicaliser would turn `203.0.113.10` into `203.0.113.0/24`, a different and much larger fact. The declared order is kept rather than sorted, because by convention the first entry is the interface's own address and reordering to tidy up would erase that convention silently. The coherence check now asks whether the list is empty, not whether it holds one: how many a line should have depends on the contract, and nobody here knows it.
- **A site is a box on the map, and its WAN line is inside it.** The uplinks were stubs pointing outward, away from the link, and the first question anyone asked of the map was «shouldn't the carrier be at the end of the link?». It is: an uplink belongs to a *site* (`wanUplink.siteId`), and the site is the end of the link — so it belongs inside the site's box, which is exactly what the model says. What could NOT be done is lay the carrier's name along the *edge*, as though that line carried that tunnel: nothing in the model declares it (the only place the association exists is an SD-WAN's `underlayUplinkIds`), and with two lines at one site nobody knows which one carries the IPsec — drawing it would be inventing with the face of a fact. The box now reads the site's name, each WAN line with its provider, service type and public addresses, and how many networks the site has; a site is opened by clicking it as before. Because a box has to fit its text and a pure module cannot know a font, the geometry takes an optional ruler: the browser draws once, measures the rendered lines with `getBBox()` and redraws with the real widths — no font constants copied out of the CSS, which would be one more definition to diverge at the next restyle. The same ruler is what the PDF export will pass, with its own measuring engine.
- **A link whose nature is none of the five can now say so in its own words.** The closed vocabulary — IPsec, MPLS, VPLS, SD-WAN, direct link — is deliberate: a link must not enter as something it is not. But a closed vocabulary that refuses real cases forces a lie (picking «direct link» for a carrier's radio bridge) or loses the row. There is now an `other` kind with a free-text name beside it. That is not the same as opening the field to arbitrary strings, which would have silently broken translations, icons and any future per-kind logic — and, worse, made «it is an IPsec» indistinguishable from «I don't know what to call it». With `other` the software knows that it does not know, and the words come from whoever documented it: the map draws «FWA point-to-point», not «Other». An unknown kind is still refused, exactly as before.
- **The SD-WAN underlay field can actually be edited.** It was a `<select multiple>`: you add and remove only with ctrl-click, an ordinary click wipes the selection, and with a single line it looked like a stuck box — «what is this field I can't change» was the first thing anyone asked of it. It is now one checkbox per line, one click on and one click off, each naming its provider and site, with a sentence saying what the field means and where the lines are described.
- **The coherence pane says each thing once.** Every row used to repeat its own heading — three rows under «Site networks that no link carries» each ending in «no link carries it» — so the part that actually varied was buried in the part that did not. Rows now carry only the subject; the sentence is the heading. Ids became names throughout (a link reads «Caci ↔ Aloys · VPLS», an uplink reads by its provider and site), and the checks that could not run no longer print the engine's own slugs at a human: `spokesWithoutHub — no-hub` is now the check's name and the reason in words. A reason the dictionary does not know yet is shown as it is rather than swallowed.
- **A project export no longer carries measurements — by construction, not by memory.** `sanitizePortableState` was a blocklist: it named what to remove, so a newly added measured field went out in exports until somebody remembered to add it to the list (which had already happened once). Measured against thirteen real projects, **41 fields were leaving that way** — among them `dhcpSources`, which carries the leases read from a DHCP server, meaning the names and MAC addresses of whoever was on that network, inside a file made to be sent to someone else. The export is now built from the field classification above. The old removals stay written out explicitly as a floor, so the export can never end up worse than it was even if the classification fails to load; and a port record that held nothing but measurements no longer leaves an empty shell behind. Nothing declared is dropped: verified on the live lab project, where 32 kinds of measured field were present and none reached the export while all 43 devices, 155 ports and 39 cables did.

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
