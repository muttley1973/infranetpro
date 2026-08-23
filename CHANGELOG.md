# Changelog

## [2.10.1] — 2026-08-23

### Fixed

- **A VLAN nobody declared is left absent, not written down as 1.** The SNMP driver ended every port with a fallback of 1, so silence produced a number indistinguishable from a measurement — and a VLAN declared by hand or propagated from upstream was not overruled by it, it was skipped over. Measured on the bench: a Cisco vIOS exposes neither table that carries an access port's VLAN, and all nine of its ports came out on VLAN 1. The measurement no longer outlives the reading either — absent on a port the walk covered now means forgotten, the way a port's up/down state already worked. Manual overrides never travel this path, and a reading of 1 still does not displace a known VLAN above 1, since some images answer 1 by default.
- **A port bundled into an aggregate inherits what the aggregate declares.** The inheritance existed but the aggregates were indexed by interface index while the lookup used the logical id, and `Po1` is logical id 1 living at index 10. The two coincide almost never, so the block had never once run and no test exercised it. Visible on the bench Arista, where two ports in a trunk aggregate carrying VLANs 30 and 99 were documented as plain access ports. A member that declares its own trunk is still not overwritten: its own measurement is more specific than the bundle's.
- **An interface that calls itself virtual is not a port you can cable.** The list of names marking an interface as software was written from the Linux side — docker, veth, virbr, lxc — and lacked the word that says it outright. A Cisco wireless controller publishes «Virtual Interface» beside its real port, both Ethernet and sharing one MAC, so it was documented with two ports; the cable then came out «inferred, to be confirmed» when it was the only possibility there was. The match is anchored at the start of the name, so a physical port mentioning the word further along stays a port.
- **A management interface written out in full is the one announced in short.** An agent that calls its interface «Management Port» announces it as «mgmt» over LLDP, and the two never resolved to each other: the neighbour matched nothing and the cable was lost without a word. The trailing generic noun — *Port*, *Interface* — is decoration rather than identity, and is now ignored when testing the management family and only there, so a physical port called «Port 1» stays port 1.
- **The native VLAN of a Cisco trunk is read instead of assumed.** On IOS the standard PVID does not cover trunk ports and the Cisco fallback covers access ports only; the native lives in a third column nothing was asking for. Every trunk therefore read VLAN 1 — right by coincidence, and indistinguishable from right, until someone writes `switchport trunk native vlan 99`. Applied only to ports already recognised as trunks, since the column stays populated on access ports where it describes nothing.
- **A cable's colour was answering the wrong question, in eight places, and asking the wrong device.** It asked for the *native* VLAN: on an access cable that is the whole truth, on a trunk it is one VLAN among several and legitimately 1, so a lab where everything real travels tagged came out uniformly grey. Three things were wrong at once. **The question**: an access cable now takes the one VLAN that applies, from whichever source can name it, while a trunk carrying more than one takes no colour at all — every rule for electing one asserted something untrue, and the case that settles it is an interface doing management *and* VLAN 30, which has no answer. Its VLANs appear instead as coloured pills, and VLAN 1 counts among them: filtering it out let a trunk with native 1 plus one tagged VLAN pass for single-VLAN and take that colour (three cables out of 1,171, all textbook). **The device**: whoever may name a cable's VLAN is whoever *switches* it, not whoever is typed «active» — a device whose entire VLAN world is `[1]` is saying «my port is untagged», and on the bench a wireless controller and an EXOS switch overruled a declared network on exactly that basis. **The place**: rack, topology, floor plan, PDF, draw.io export and colour picker each had their own line, and the same cable could come out two colours depending on the view. One module decides now, and a test refuses a ninth caller.
- **A cable whose two ends name different VLANs no longer picks one and asserts it.** The ladder took the first end that spoke: VLAN 20 on one side and 30 on the other painted «VLAN 20, set by hand» — `known: true`, the same hex as a cable whose ends agree. On the wire that link carries nothing, so it was the only state where the drawing was certain and the network was broken. It is an outcome of its own now: neutral, with the panel naming both numbers. Falling to the next rung would have been worse, since the bottom rung is the site native — a real contradiction surfacing as a plausible number. ⚠️ Only between equals: a PC does not contradict a switch, and a declared value against a measured one is manual-first rather than a conflict.
- **A switch declared in a stack could make the whole properties panel disappear.** `isInStack()` accepts two shapes on purpose — `spec.stackId` and a flat `node.stackId` an imported project may carry — but the panel read `spec` only, so on a node the guard had just approved the read threw and took the entire panel with it, with nothing on screen saying why. A generous guard paired with a narrow read is the worst combination of the two: it lets through exactly the cases it exists to catch. The fix adds no check — it makes the library's readers public, so whoever asks the guard reads with the same definition.
- **A device panel stopped filling itself in, and a camera stopped specifying itself.** Ninety-eight editable fields opened with a value already written in — a projector at 3,000 lumens, a UPS at 1,500 VA, a camera with a «2.8mm / 110deg» lens — that nobody had declared and nothing had measured. A field that is editable and pre-filled reads as a statement. ⚠️ The damage was a contradiction between two layers: the dossier engine drops the absent, so it reported no brightness while the panel showed 3,000 — same machine, same moment, two answers. And `data-ndef` made it permanent: clearing a field wrote the default straight back, so «I don't know» was not expressible. The number now lives in the `placeholder`, every dropdown offers «not declared», and three optional coercions turn an empty field into nothing. Dropping a camera on the plan no longer writes mount, height, power, resolution and lens into the project JSON — the only true thing about it is that it is **planned**. ⚠️ Defaults stay where they are not claims about the customer's equipment: drawing geometry, structural counts that create real objects, the parameters the tool connects with, and zero.
- **A device missing from the network had its alert painted over by the one below it.** The red ring is a box-shadow just outside the box; every rack device is `position:relative` with no `z-index`, so DOM order decides and the neighbour further down repaints over it. On the bench the absent server was child 3 and the patch panel below it child 16, so the ring lost its bottom edge — leaving a single horizontal red line that reads as a rendering artefact, which is exactly how it was reported. A device carrying a state ring now stacks above its neighbours, below the selection.
- **A port declared faulty was exported grey, in all three exports.** Two different functions were both called `normalizeStatus` — one for port state, one for a device's operating status — and both landed on `window`, where the device one won. `export.js` reads the bare global with *port* meaning, and the wrong function answers `''` to a word it does not know, falling through to the grey default. Green survived by coincidence and grey *is* the default. **Red did not**: a faulty port came out the same grey as a free one in the rack SVG, the dossier and the draw.io export. ⚠️ Nothing showed it inside the app — the renderer imports its own function — so it was visible only in the file you take into the machine room. The port one is `normalizePortStatus` now, and nothing on `window` can be confused with it.
- **The one case where the network is genuinely broken was the only one without a name.** Two ends contradicting each other leave the cable neutral, and so do a trunk and a routed link: the contradiction was visible solely by opening that cable and reading a grey line. It is a finding in the cable's problem list now, at error level like `native-mismatch`, its twin on the trunk. ⚠️ The verdict is not recomputed where it is displayed — it travels from the colour model already decided, because two layers answering one question is the defect this area was built to end.
- **A VLAN the document carries and the plan never names is said out loud.** There was no signal at all: a cable could carry VLAN 30, an access point serve it, and nothing pointed out that the plan had never heard of it. ⚠️ The comparison could not use the VLAN list the app already had — `vlanColors` fills itself with every VLAN ever *seen*, so «used» and «known» were the same set and the check would have come out green on every project ever. Declaring is an act, and two count: giving a VLAN a name, or a network. ⚠️ A plan that declares no VLAN judges nobody, and is reported as *not checked* rather than clean; the site's native is never accused, being the floor where everything unassigned lands.
- **A hierarchy you wrote by hand can say it is one.** A container prefix and the networks inside it are not an overlap — but only the DCIM could say so, the word coming from NetBox's `status`. A site's `/16` with its `/24`s inside it was therefore accused of overlapping its own subnets, on every opening of the report, permanently. ⚠️ The defect is not the false positive, it is that it was **impossible to close**: a warning that is true-but-intended and never goes away teaches a reader to skip every warning, including the one that will matter. What gets stored is the difference from the source, so agreeing with the DCIM writes nothing — an absent key means «I did not say», not «no».
- **A cable that does not exist no longer reports itself as carrying VLAN 1.** A defensive line covered two different situations — no cable at all, and the trunk engine not loaded — with one reply: *access, native 1, carrying [1]*. Nothing downstream can tell such a claim from a reading, and the VLAN filter took it at its word, so a link that did not exist counted as a member of VLAN 1. ⚠️ That literal 1 was also a **second definition of the floor** beside `_siteNativeVlan()`: on a site declaring native 99 it still said 1. Twelve window reads went with it, the last two in the VM editor, where the same fallback returned an empty list — so a VLAN just declared on a virtual NIC never got its colour and was drawn as an unknown number.
- **Every VLAN on every Cisco switch was named «1», and the overview called that a conflict.** The VTP fallback read column `.2` of `vtpVlanTable` — `vtpVlanState`, where 1 means operational — instead of `.4`, the name. Beside it an Arista answering through the standard table gave the real name, and the overview reported a fabric in disagreement: five VLANs «in conflict» on the bench, four of them born from one digit of an OID. Measured live on the core switch, column `.4` answers `default / DATA / VOIP / SERVER / MGMT`. A test pins the column the way the trunk columns already were — third time a Cisco table was read one column off. Nothing is migrated: the stored value is a measurement and the next poll replaces it.
- **The routed entry in the VLAN legend is a badge like the others, and it filters.** It read «instradato», four times the width of any VLAN badge beside it — 53 pixels against 12 — and it was inert: a caption where everything around it was a control. It reads «L3» now, the same in both languages, with the full word in its tooltip, and a click shows only those cables. It shares the VLAN filter rather than owning a switch, because asking for VLAN 30 and for the cables in no VLAN at all is not a question. Of the two non-VLAN entries only this one became a control: a cable whose ends disagree is a finding to close, not a view to inhabit.
- **The strongest proof state of a cable is called «Strong», not «Fresh».** The badge names how strong the adjacency is — LLDP or CDP at 0.90 or better — not how recent it is, which is a separate multiplier with no badge of its own. The manual gave it away by explaining the badge two lines below as «a strong adjacency (LLDP/CDP) or a weak one». The key behind it is renamed too, since one called `fresh` invites the next reader to make the same mistake.
- **A MAC the network places at a documented device's address is no longer accused of being undocumented.** Infrastructure has no documented MAC to match — a switch exposes no device MAC over SNMP — so its signature could never meet a row of any forwarding table. On the bench SW-CORE's switched interface was accused at every Verify: true in form, wrong in substance, and impossible to close. The reconciliation now goes through the identifier the document does have — if ARP places that MAC at a documented device's address, it is that device's MAC. Where no measurement ties a MAC to an address, the finding stands.
- **A host the crawl only saw in an ARP table is asked who it is before being described.** A device that does not speak the collector's neighbour protocol never got walked to: it surfaced as passively observed and was typed by the classifier's floor as a PC — one UDP round-trip away, with credentials the crawl already had. On the bench an Arista switch, a Juniper firewall and an Extreme switch were each described as a PC, and the crawl returned eight devices where a sweep returned eleven. Candidates are now probed with the crawl's own pool, and one answering with the name of a device already found is recognised as its second address. A candidate that stays silent is left as it was: seen, not confirmed.
- **A disagreement about a VLAN name now says who disagrees — and stops inventing ones that are not there.** The row put the declared name against the *first* measured one, so in the very case the check exists for it printed the same name twice, «DATA ↔ DATA»: an accusation nobody could understand or close. It reads «DATA (SW-CORE, SW-ACC1) ↔ VLAN0010 (vEOS)» now, with witnesses shown only when there is more than one variant. And names are compared through a key that folds case — the family `addrKey`/`segmentKey`/`macKey` already belong to — because the bench's VLAN 1 is `default` to Cisco and Arista and `Default` to Extreme, which is one name written by three vendors, not three networks disagreeing.

### Added

- **A port can be declared L3, and a hand-drawn project stops claiming that a router-to-router cable switches.** «Routed» was measurable and not sayable, so a project drawn by hand could never produce one — and that cable did not come out neutral: it fell to the floor and was painted VLAN 1, which is not a missing answer but a wrong one. Port mode, which already carried *access* and *trunk*, now carries **L3**, consulted above every measurement — `vlanOvr` describes the PVID of one port while «it routes» describes the cable, and on a single wire the sentence about the wire decides the wire. ⚠️ A third value of an existing field, not a new switch beside it: two independent controls answering one question can contradict each other and eventually do. Choosing L3 clears that port's VLAN override and carried-VLAN list. The measured veto is not silenced — if the device reports a bridge port while you declared it routed, your declaration stands and the panel says the two disagree.
- **And the declaration names which network the port routes.** The model knew *that* a device routes 10.255.0.0/30, never *from which port*; the SVI row gains the port column it was missing, with only the `cidr` stored so `prefixesOf` stays the authority. ⚠️ The list offers **every** declared network, not only the VLAN-less ones: the first cut allowed only those, and on the bench the field came up empty, because a real project declares five networks and every one has a VLAN — a control that offers nothing reads as broken. ⚠️ Optional on purpose, and never inferred: not from the interface address, which any NIC has, and not from «routed by» on the VLAN card, which proves the device sits *inside* that VLAN.
- **A link that routes is told apart from one whose VLAN we simply cannot read.** Every switched port is in a VLAN — VLAN 1 if nobody said otherwise, which is what VLAN 1 is for. A routed port is not, and those two silences used to be the same silence, though they call for opposite things: one is a fact with nothing missing, the other a gap. ⚠️ «Routes» is measured as «is not a port of the bridge», which is what the word means: the old field promised a conclusion and read a premise, firing on a wireless controller's NIC that switches perfectly well. The evidence is `dot1dBasePortIfIndex`, standard and already on the wire, and it is used asymmetrically — being in the table is a veto, being absent proves nothing, since a vIOS publishes it for two ports out of eight and another unit of the same image for none. ⚠️ And it is consulted only when no VLAN applies at all: with the check placed first, the lab's VyOS router and its wireless controller, both on access ports in VLAN 99, came out as routed links.
- **A cable that switches always has a VLAN, so it always has a colour.** «VLAN not declared» was an outcome the picture could produce, and it is not a state that exists in switching: every bridge port has a PVID, and where nobody configured one that PVID is 1 — the 802.1Q default, not one vendor's convention. ⚠️ An unmanaged switch stops swallowing it: a plain 802.1D bridge forwards on MAC and adds no tags, so the VLAN of everything hanging off it is decided by the VLAN-aware port at its edge, and applies to all its sockets. ⚠️ The neutral stops looking like VLAN 1 — it is a colour of its own now, distinct in hue rather than shade, and it means one of exactly two things: a trunk carrying several VLANs, or a routed link. The legend follows: «no VLAN colour», an entry defined by absence, is gone, and only **routed** replaces it.
- **The cable panel says what the cable is, and why** — «VLAN 99», «trunk — 4 VLANs, none prevails», «routed link — no VLAN» — followed by the source in plain words: measured on the port, sub-interface on the cabled port, declared network of the connected device. A trunk's carried VLANs are shown as coloured pills, all at the same weight, in the same language as the legend. ⚠️ The panel and the map used to answer differently: the map asked the model, the panel asked `_getLinkVlan`, which answers the link's *native* VLAN. Found by looking at the screen — four bench cables painted 99 or 30 while the panel wrote «VLAN 1».
- **A trunk whose declared VLANs no longer match the measured ones says so.** The hand-written list wins everywhere, colour included, which is correct — but nothing compared it with what the switches allow, so changing `switchport trunk allowed vlan` left the document quietly behind, still showing yesterday's list as though it were today's. Found the hard way on the bench, changing a lab trunk and watching the picture not move.
- **The two ends of a trunk are compared on the VLANs they carry, not just on the native.** It is not a link-down: the cable comes up and passes whatever both lists have in common, while every VLAN present on one side only dies there. That is the most common cause of «it works for some VLANs and not others», and the hardest to see precisely because the link is UP and the counters are moving. ⚠️ It needs both lists — an agent that does not publish its carried VLANs leaves its end empty, and empty means «not read», not «carries none».
- **A router-on-a-stick stops being invisible.** A dot1Q sub-interface — `Gi1.99` — is not something you plug a cable into, so the driver discarded it as «not physical» and took two things with it: the VLAN and the address. On the bench the management address of a Cisco CSR1000v sits on the sub-interface, so the interface InfraNet was talking *through* did not exist in the document. They enter as logical ports now, and the port beneath them carries their VLAN — not a deduction of ours, since the device declares both halves. ⚠️ The standard interface stack decides the parent, with the Cisco table filling the gap only where the stack is silent; and where the VLAN is not declared it stays unknown, because the 99 in the name is not a measurement.
- **An address that lives outside every declared network is something the app says out loud.** Declare-first has been the rule for a while, but nothing ever asked the question: a device on 192.168.77.5 in a site that is entirely 10.0.x appeared nowhere. ⚠️ Judged per address family, which is the guard the rest rests on — a plan declaring no IPv6 would otherwise report every IPv6 address as outside it, which is the noise of comparing against nothing. IPv6 link-local stays out: `fe80::/10` belongs to no plan.
- **«I could not check» stopped looking exactly like «there is nothing wrong».** The overlap classifier returns an empty result without its CIDR parser, and the L3 report's fallback object was literally the shape of a clean network — either way the summary read «no issues» about a verification that never ran. In an audit that costs more than in a drawing, because an audit that says nothing is believed. Every check that could not run now leaves its name and its reason in `notChecked[]`.
- **A bundle is checked for where its members live, and how many there are.** The LAG audit compared what each member *is* and never asked the two questions that decide whether the bundle exists: a group with a single member aggregates nothing, and members on two different devices only bundle if those devices are one logical switch — a stack, or MLAG/vPC/MC-LAG depending on the vendor.
- **A LAG's VLAN can be declared once, on the bundle.** On real hardware a Port-channel is configured once and its members inherit; saying it here meant repeating it on every member, and forgetting one earned you a coherence warning for work the hardware does by itself. The row writes the declaration onto every member at once and shows «mixed» rather than inventing a number when they disagree.
- **The handover dossier stops printing «VLAN 1» for a trunk.** The cable table showed the native, which on a trunk is the least informative VLAN it carries — the same convenient story as the screen, on paper. A trunk now prints what it actually carries; an access cable is unchanged.
- **The declared operating status carries the padlock the other hand-set fields already had.** Choosing a status always wrote a second field beside it — the mark that says *I declared this* — and nothing ever read it or showed it: set invisibly, impossible to clear. ⚠️ The wording had to differ, and that difference is the point: the other padlocks defend a declaration from the network, this one only records that the value is yours.
- **The rack's zoom percentage became the way back.** Past a certain zoom the chassis falls outside its window's `overflow:hidden`, taking the state ring with it, and the only way back was the minus button 10% at a time. Clicking the percentage fits the rack to its window, and the percentage turns amber while you are seeing only part of it. ⚠️ The break-even zoom is measured with `offsetWidth`, not `getBoundingClientRect`: the wrapper carries a transition, so mid-animation the rect returns a value halfway between two zooms — the first version computed the fit from a number that did not exist.

### Changed

- **Everything about a cable's VLAN lives in one collapsible section, and it stopped saying the same thing three times.** The blue TRUNK pill sat inside the VLAN section, reading as something about the VLAN rather than the link; it now stands with the badges that answer «what is this cable», and ACCESS is shown there too, because a mode means nothing unless both values are visible together. Inside the section, in reading order: what the VLAN is, the port mode, the native, the carried ones, the colour override. A trunk used to state its VLANs four times over — in words, as a verdict, as two fields, then as pills; the pills carry it alone now, larger, because on a trunk they are the whole answer rather than decoration beside a sentence.
- **A port has three states, and «idle» is no longer one of them.** The fourth LED colour meant four different things depending on the reader: its label promised «up but carrying no traffic», the SNMP layer wrote `testing`/`dormant` into it — which RFC 2863 defines as the opposite — the screenshot generator used it for «shut by hand», and the architecture notes called it «Ready». Nothing read it to decide anything. ⚠️ The device's word is not thrown away: `testing` and `dormant` travel as `operWait`, a measurement beside `adminDown` and `operUp`, printed untranslated in the SNMP bar for the same reason `admin shutdown` is.
- **A port with no link for three verifies is amber now, not dark grey.** The two «off» states shared a monochrome scale ending in neutral grey, but they are not the same kind of fact: `shutdown` is a **decision** — whoever made it knows — while no link across three verifies is an ambiguous **symptom** (device off? dead NIC? SFP pulled?) that somebody has to go and look at. The floor plan learned it too: the rack consulted the measurement in three places, the floor plan in none, so no stylesheet could have rescued it. ⚠️ Its amber is deliberately not the generic warning amber used in some thirty places — two ambers that coincide get merged by the eye — so the measured port state takes a deeper `#d29922`. That hex is written in three places, since the SVG dossier and the draw.io export cannot read a CSS token, and a test now compares the three.
- **The status badges are bigger, and they stay on one line.** The row split its width 55/45 regardless of content, so a cable with four badges wrapped while the field beside it sat half empty; the field takes what is left now. Measured across all 1,680 combinations the row can produce — four port modes and states, three discovery protocols, six proof states, four type values, in both languages — none wraps at a typical desktop width.
- **Every info box in the properties panel states its rule in one line, at one size.** Fifteen of them held two or three sentences each and wrapped inside a 410-pixel column, turning an aside into a paragraph. Each now carries the condition alone, with the examples and the reasoning in its tooltip. ⚠️ They had five different hand-written sizes — four of them off the type scale entirely, two of them two lines apart in the same stylesheet — which is the same defect as a definition living in two layers. One of the boxes had been written in Italian inside the renderer and never went through the dictionary. A character budget guards them now: sixteen strings carry a measured cap in both languages, and the test demands the matching `…Tip` key, since shortening a line is only honest if the rest is still reachable.
- **The LAG section speaks the panel's language, and the proof badge's shape left the code that builds it.** The LAG row was built before the rest of the panel settled and showed it: a blue bold name competing with the section title, a raw browser dropdown among drawn fields, a delete button half the height of its neighbours and the last element still using hard-coded greys. The proof badge carried its padding and font size inline, so the two places that show it could not be sized differently without an `!important` fight; the shape is a stylesheet rule now and the code passes only the colour, which is the part that depends on the state.

## [2.10.0] — 2026-08-20

### Added

- **NetBox locations become rooms on the floor plan.** A location is the floor or the room a device sits in, and until now it survived only as text in the device notes. It is a rectangle now, with its racks and devices drawn inside it, sized from its contents. ⚠️ What NetBox does not have is the geometry — a location has a name and a parent, never a position or a size — so the split is stated rather than blurred: that the room exists is measured, where it sits and how big it is is our choice. Nested locations collapse into one name («Floor 1 · Server room»), and the room carries the NetBox id so renaming it upstream is a rename rather than a delete and an add. ⚠️ What has no location stays **outside** the rooms and below them, counted in a decision row: drawing it inside some rectangle to tidy the picture would claim a membership the DCIM never declared.
- **Hosting virtual machines is a capability, not a type.** Storage arrays, desktop NAS boxes and servers now carry the same *Virtual machines* section a hypervisor has — a Synology or QNAP runs them from a package and is still a storage box, with its capacity, RAID level and protocols where they belong. So the import stops rewriting a device's type: a NetBox device with VMs on it used to come back as a hypervisor, erasing the role its own archive declared. That happens now only for a type that cannot host them at all, where the data would otherwise have nowhere to live, and the import says so in its list of decisions.
- **A declared life-cycle status** — planned / staged / in stock / in service / failed / decommissioning / out of service. It changes how silence is read: a device declared planned that stays quiet is expected, not a fault. And it cuts both ways — one declared out of service that *answers* is flagged amber, stale documentation that nothing caught before. The measure itself is untouched; only the reading changes. The Overview gains a row where contradictions take the headline and the absences the declaration explained away are stated out loud; no device declaring a status leaves it dashed, not a green zero. The DCIM import fills it, and an unknown word stays undeclared rather than guessed.
- **Imported objects keep their DCIM identity.** Ports, patch-panel slots (front *and* rear) and racks carry the id of the object they came from, in a field of their own — a port's only anchor used to be `ifName`, a string, and a cable is addressed by its two interfaces, so writing one back was impossible. ⚠️ The reference never lives inside the InfraNet id, because ids get renumbered. The encoding puts the object type in the field's name: 13 bytes per port instead of 57, so a 40-device document grows by a third rather than double. The rack diff matches by reference now instead of by name — renaming a rack used to report it gone and re-appeared — falling back to the name for older projects, with that weaker pairing counted rather than passed off as certainty. A fixture drives the whole round trip (import, portable export, JSON, reopen) and asserts each family is present, so the gate cannot pass by proving nothing.
- **Two devices that announce each other are drawn as adjacent even when the port is not known.** The topology used to need a port at each end, so a neighbour whose port name matched nothing left the pair looking like strangers. The line is there now with `?` where the port is unknown — the honest shape of what was measured, rather than picking a port at random for the sake of drawing something — and precision still wins, since a real cable between the two makes the pair read as confirmed. ⚠️ And a neighbour that produces no cable now **says why**: the protocol announcing an attachment while the picture shows nothing used to look exactly like a device with no neighbours, which is how a defect hides for months — the local-port bug fixed in this same release lived inside a bare guard that discarded a candidate without a word. The reasons stay apart because they ask for opposite things.

### Fixed

- **An LLDP neighbour is read from the subtype it declares, not from the length of its value.** Every LLDP identifier travels with a subtype saying what it is; we never asked, and guessed — six bytes meant a MAC address. Wrong in both directions, and the bench proved both: the same Cisco chassis id arrives as six raw octets through an Arista and as seventeen bytes of text through a MikroTik, because the encoding is the *answering* agent's choice. The text form was dropped whole, and with it the one identity of a neighbour that never changes.
- **The local port of a neighbour is read, not assumed to be an ifIndex.** LLDP numbers the ports it advertises in a space of the agent's own: on the bench Arista, `Management1` is LLDP port 97 and interface 999001. Reading 97 as an ifIndex finds nothing and invents the name `port97`, so the candidate link was dropped without a word, leaving two adjacent devices and no cable between them.
- **A port a neighbour identifies by MAC resolves to that port.** Some devices advertise their ports by address — every port of a MikroTik does — and that value was filed as a port *name*, where no port can match it, so the link fell back to the first free port and was marked inferred. The address has a field of its own now and is looked up among the ports' own addresses; not found, the old inference still applies and is still labelled as such.
- **A room follows the cursor while you drag it, and the grid you see is the grid you land on.** The helper that finds a node's object on the floor plan only knew about device tiles, so for a room it returned nothing and the live update was skipped in silence: the position moved in the document while the rectangle stayed put, and since a floor drag does not redraw on release it stayed put after you let go. It looked like the room was stuck to a grid; it was getting no feedback at all. Separately, the grid was drawn at 40px while things snapped at 20, so everything stopped half a cell short of the line — the step now comes from the one number objects snap to, and the render imposes it on the drawing. Nothing moves: what changes is the drawing, not where things land.
- **The assistant no longer says every switch is full.** It counted a device's ports by counting *port records*, and a record only exists once a port is documented or cabled — so «total minus used» was zero on every switch of every project. On the 500-device bench: 291 free ports per the Overview, **0** per the assistant, on all fourteen. The total is now what the device declares, with the documented count travelling alongside as its own figure.
- **A PDU stops having two outlet counts.** Device fields live in `node.spec`; «Apply model» was writing the outlet count one level up. Two copies, and the readers disagreed by design — the rack grid showed one number and the Overview another, at the same instant, and the grid changed on its own after a reload. One precedence now, `spec` first, everywhere.
- **The public API counts a device as SNMP-managed only if it can be polled.** Picking a driver was enough, so a device with no address still counted in `/api/v1` and landed in the `snmp_managed` Ansible group — a playbook target with nowhere to connect. Three switches with one reachable: the app said one, the API three.
- **The Dashboard stops declaring a full network empty.** Left on the Dashboard and reopened, it said «the network is still empty — run Discovery» over a loaded document: loading a project reset the per-project runtime, view flag included, while the page stayed on the Dashboard, so the Overview bailed out of every render and kept the empty screen drawn before the project arrived. The same cause made switching project show the previous one's numbers.

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
