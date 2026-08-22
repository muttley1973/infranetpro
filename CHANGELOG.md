# Changelog

## [2.10.1] — 2026-08-21

### Fixed

- **A VLAN nobody declared is no longer written as VLAN 1.** The SNMP driver ended every port with a fallback of 1, so a device that says nothing about a port's VLAN still produced a number, and in the document that number was indistinguishable from a measured one. Everything downstream then treated it as a measurement — the cable's VLAN is taken from an active port before the propagated one is ever consulted — so a VLAN that had been declared by hand, or propagated from upstream, could never prevail: it was not overruled, it was skipped over. Measured on the bench, this is not an exotic case: a Cisco vIOS exposes neither of the two tables that carry an access port's VLAN, and all nine of its ports came out on VLAN 1. The field is simply left absent now, and the same switch tells two different truths where it used to tell one — its access ports report no VLAN, its trunks report the native one, because that one *is* declared.
- **And a VLAN measurement no longer outlives the reading that produced it.** Not inventing new ones was only half of it: the port's VLAN field *is* the measurement — the hand-written value lives elsewhere — yet when a poll came back with nothing to say about a port, the previous value was kept. Every 1 the driver used to invent was therefore immortal, because no later reading could ever remove it. Measured live on the bench: asked again, the same switch correctly reported no VLAN on its access ports while the document still read VLAN 1, and the cables to the wireless controller and to the Linux server stayed grey. A measurement absent on a port the walk *did* cover is now forgotten, the way an interface's up/down state already is — an assertion does not survive the evidence that carried it. Manual overrides never travel this path and are untouched, and a reading of VLAN 1 still does not displace a known VLAN above 1, since some images answer 1 by default.
- **A port bundled into an aggregate finally inherits what the aggregate declares.** The inheritance existed — trunk state, carried VLANs and native VLAN passing from a Port-channel to its member ports — but the aggregates were indexed by their interface index while the lookup used the logical id, and `Po1` is logical id 1 living at interface index 10. The two coincide almost never, so the block found nothing and had never once run; no test noticed because none exercised it. It stayed invisible on the images that do not publish membership at all, and showed on the bench Arista, where two ports sat in a trunk aggregate carrying VLANs 30 and 99 and were documented as plain access ports. A member that declares its own trunk is still not overwritten: the port's own measurement is more specific than the bundle's.
- **An interface that calls itself virtual is no longer counted as a port you can cable.** The list of names that mark an interface as software was written from the Linux side — docker, veth, virbr, lxc — and did not contain the word that says it outright. A Cisco wireless controller publishes «Virtual Interface» alongside its real port, both declared as Ethernet and sharing one MAC address, so the controller was documented with two ports instead of one; the consequence reached the topology, because a neighbour announced on a device with several ports has its far end *deduced* rather than known, and the controller's cable came out as «inferred, to be confirmed» when it was the only possibility there was. The match is anchored at the start of the name, so a physical port that mentions the word further along stays a port.
- **A management interface written out in full is recognised as the one announced in short.** An agent that calls its interface «Management Port» in the interface table announces it as «mgmt» over LLDP, and the two names did not resolve to each other: a neighbour announced on that port matched nothing in the document, and the cable was lost without a word. The generic noun trailing the name — *Port*, *Interface* — is decoration rather than identity, and many agents append it; it is now ignored when testing the management family, and only there, so a physical port called «Port 1» stays the physical port 1 instead of being swallowed into the management family. A test pins that direction too.
- **The native VLAN of a Cisco trunk is read instead of assumed.** On IOS the standard PVID does not cover trunk ports and the Cisco fallback covers access ports only; the native lives in a third column that nothing was asking for. Every trunk therefore read as VLAN 1 — right by coincidence while the native is one, wrong and indistinguishable from right the moment someone writes `switchport trunk native vlan 99`. It is applied only to ports already recognised as trunks, since the column stays populated on access ports where it describes nothing.

- **A cable's colour was answering the wrong question.** It asked for the *native* VLAN and painted that. On an access cable the native is the whole truth; on a trunk it is one VLAN among several, and legitimately 1 — so a lab where everything real travels tagged came out uniformly grey, saying «all VLAN 1» about a network that was not. On an access cable the colour now comes from whichever source can actually name the one VLAN that applies: a hand-set value, a measured one, the VLAN propagated from upstream, a dot1Q sub-interface standing on the cabled port, or the declared network of a device that has exactly one cable — its address can only be talking about that one.
- **And on a trunk, no VLAN wins, so none of them gets to be the colour.** Every rule for electing one was tried and every one of them asserted something untrue; the case that settles it is an interface doing management *and* VLAN 30, which has no answer — not a hard one, none. A trunk carrying more than one VLAN is therefore neutral, and the VLANs it carries are shown together as coloured pills in the cable panel, all at the same weight. Where a trunk carries exactly one VLAN the colour returns, because there nothing is being chosen — it is being observed.
- **And a trunk carries its native VLAN like any other, VLAN 1 included.** The count filtered VLAN 1 out, so a trunk with native 1 plus one tagged VLAN passed for «carrying a single VLAN» and took that colour. Two VLANs cross that copper: the native's untagged traffic goes over it as well, and painting one of them asserts the other is not there. Measured across every real project before changing anything — three cables out of 1,171, and they are the textbook case: two access-point uplinks carrying management untagged in VLAN 1 and the SSID tagged in 99, plus a server with native 1 and VLAN 20 tagged. The filter was the common practice — don't use VLAN 1, prune it from trunks — mistaken for a description of the wire; removing it leaves the rule without exceptions, since more than one VLAN means neutral whichever they are. The label was counting the same way and would write «trunk — 1 VLAN, none prevails», a line that contradicts itself. ⚠️ One limit stays, deliberately: a VLAN 1 *pruned* from the trunk does not really cross and is counted anyway — but that error leads to neutral, which asserts nothing, instead of painting a VLAN that isn't the whole story.
- **And it was asking the wrong device.** Whoever may name a cable's VLAN was taken to be «an active device» — switch, router, firewall, wireless controller — but *active* is a property of the type, our own classification, and says nothing about whether that device assigns VLANs. The question is whether it **switches** them, and the answer is already in the measurement, with no vendor list needed: a device whose entire VLAN world is `[1]` has named only the VLAN that exists when nothing is configured, so its `vlan=1` means «my port is untagged», not «this cable is in VLAN 1» — and it cannot be authoritative about a VLAN it does not know. Measured on the bench: a wireless controller and an EXOS switch, both answering on 10.10.99.x and therefore living in VLAN 99, published exactly that and overruled the declared network, while the switch facing them stayed silent because that IOS does not publish access PVIDs. It is the same shape as the invented VLAN 1 this release already fixed — a 1 that looks like a measurement and measures something else. A device that does know other VLANs and still says 1 is *choosing*, and keeps its authority. The untagged 1 is not thrown away either, it is demoted below the declared sources, so a flat network — where 1 really is the only VLAN there is — still reads VLAN 1 while a declared network wins wherever the two disagree. The same rule now governs propagation, or the discarded claim would cross the cable and win one rung lower: a passive port still inherits an untagged VLAN, an active one inherits only a value that carries authority. Over the whole bench one cable changes VLAN — the controller's, from 1 to the declared 99 — and ten more keep the VLAN they had while finally saying where it comes from.
- **And it was answering it in eight places, which had already drifted apart.** The rack painted the native, the topology painted the most frequent VLAN of the pair, the floor plan, the PDF, the draw.io export and the colour picker each had their own line — the same cable could come out two colours depending on which view you were looking at. One module decides now and everything reads it, including the per-VLAN layers of the draw.io export, which used to be able to contradict the colour of the very cable they contained. A test refuses any new caller that computes it again, so the ninth cannot appear quietly.
- **A cable whose two ends name different VLANs no longer picks one and asserts it.** The ladder that decides a cable's VLAN took the first end that spoke: with VLAN 20 declared on one side and 30 on the other it painted «VLAN 20, set by hand» — `known: true`, and the very same hex as a cable whose ends agree. On the wire that access link carries no traffic, so it was the only state in which the drawing was certain and the network was broken. Two ends speaking with equal authority and disagreeing is now an outcome of its own: the cable goes neutral, like a trunk but for a reason of its own, and the panel names both numbers so you know where to look. Falling through to the next rung would have been worse — the bottom rung is the site native, so a real contradiction would have surfaced as a plausible number. ⚠️ Only between equals: a PC still does not contradict a switch, a declared value against a measured one is manual-first rather than a conflict, and on a trunk two disagreeing natives keep the name they already had.
- **A switch declared in a stack could make the whole properties panel disappear.** `isInStack()` accepts two shapes on purpose — `spec.stackId`, which is what the app writes, and a flat `node.stackId`, which an imported or hand-edited project may well carry — but the panel read the value out of `spec` only. On a node the guard had just approved, `spec` was undefined and the read threw; and it did not take the stack section down with it, it took the entire properties panel, so the device became impossible to open and nothing on screen said why. A generous guard paired with a narrow read is the worst combination of the two, because it lets through exactly the cases it exists to catch. The fix adds no check: it makes the library's own readers public, so whoever asks the guard reads with the same definition. The bridge did not grow either — the setter used to call the guard *and* re-read the field, which was asking the same question twice, and now asks it once.
- **A device panel stopped filling itself in.** Ninety-eight editable fields — thirty-five inputs and sixty-three dropdowns — opened with a value already written into them: a projector with 3,000 lumens, an NVR with 16 channels, a UPS rated 1,500 VA, an access point on management VLAN 1, a camera with a «2.8mm / 110deg» lens, a firewall in routed mode. Nobody had declared any of it and nothing had measured it — they were choices of the renderer, and a field that is editable and pre-filled reads as a statement, because the only thing separating it from a value someone typed is knowing which one you typed. ⚠️ The damage was not cosmetic, it was a **contradiction between two layers**: the engine that builds the handover dossier reads those very fields through `_posNum`/`_str`, which drop the absent, so the report said the projector had no brightness while the panel said 3,000 — same machine, same moment, two answers. And a twin defect made it permanent: `data-ndef` meant that *clearing* a field wrote the default straight back (`parseInt('') || 3000`), so the invented value was not merely wrong, it was not removable — «I don't know» was not expressible. The suggested number now lives in the `placeholder`, where it reads as a proposal while still carrying the order of magnitude and the unit; every dropdown offers «not declared» and opens on it; and three optional coercions (`intopt`/`floatopt`/`stropt`) turn an empty field into **nothing**, with `updateN` deleting the key rather than writing over it. Verified end to end in the browser through the real delegation — write, re-read, clear — with the node coming back to `{spec:{}}` and no residue. ⚠️ What keeps its default is what is not a claim about the customer's equipment: the **geometry** of what is drawn (a rack is 200 wide because that is how it is drawn), the **structural** counts that generate real objects (a PDU with zero outlets does not exist, and the count creates the sockets in `state.ports`), the parameters the **tool** connects with (161 is the port that will be queried, not an assertion about the device), and **zero**, which is the honest neutral for a count and which the engine already reads as absent. A source-scanning test refuses the next one — it is what caught the three dropdowns carrying attributes after `data-nfield`, which had escaped the first pass.
- **And a camera dropped onto the plan stopped specifying itself.** That one was the invention **persisted**: creating a webcam wrote mount, install height, power type, resolution and lens into the project JSON, so it travelled on into the export, the PDF and the asset register as though someone had surveyed it. The only true thing about a camera you have just dragged is that it is **planned** — which is the user's own act, and stays.
- **A device that is missing from the network had its alert painted over by the one below it.** An absent device carries a red ring — the notice that says "documented here, not on the network" — drawn as a box-shadow that sits just outside the box. Every rack device is `position:relative` with no `z-index`, so at equal stacking level the DOM order decides, and the neighbour further down the list repaints over the ring of the one before it. Measured on the bench: the absent server was child 3 and the patch panel butted against it below was child 16, so the ring lost its bottom edge. ⚠️ What survives is the deceptive part — a single horizontal red line, which does not read as an outline at all but as a rendering artefact, and that is exactly how it was reported. A device carrying a state ring now stacks above its neighbours, below the selection so that selecting an absent device still shows the selection outline. And the ring is a hairline rather than 2px, on all four states together: the rule these already follow is that the geometry stays identical and only the colour changes, so thinning one alone would make them look like unrelated decorations.

### Added

- **The rack's zoom percentage became the way back.** The chassis has a width of its own — 356px — while its window depends on the panel, so past a certain zoom the sides fall outside the viewport's `overflow:hidden`, taking the state ring with them. Zooming in is the normal way to read port numbers on a 48-port switch, so the problem was never the zoom: it was that the only way back was the minus button, 10% at a time, with nothing saying you had gone past the point where the rack still fits. Clicking the percentage now fits the rack to the width of its window, and the percentage turns amber with a ↔ while you are looking at only part of it — because what is missing is precisely what you cannot see. It is a `<button>` rather than a `<span>`, so it is reachable from the keyboard. ⚠️ The break-even zoom is measured with `offsetWidth`, not `getBoundingClientRect`: the rack wrapper carries a `transition` on its transform, so mid-animation the rect returns a value halfway between two zooms — and it is already multiplied by the scale. The first version computed the fit from a number that did not exist, and fitting did not fit. The floor plan's label stays a plain span: a free canvas has no width of its own to fit to.
- **The two ends of a trunk are compared on the VLANs they carry, not just on the native.** Native VLAN mismatch has been checked for a while; the tagged VLANs — the other half of what a trunk is — were compared by nobody. It is not a link-down: the cable comes up and passes whatever both lists have in common, while every VLAN present on one side only dies there. That is the most common cause of «it works for some VLANs and not others», and the hardest to see precisely because the link is UP and the counters are moving. The warning names which VLANs are one-sided, on each side. ⚠️ A warning and not an error, because pruning a VLAN off a trunk is legitimate and from outside a deliberate prune is indistinguishable from a forgotten one. And it needs **both** lists: an agent that does not publish its carried VLANs leaves its end empty, and empty means «not read», not «carries none» — on the bench a vIOS does exactly that, and comparing against it would have claimed the other end carried everything extra.
- **An address that lives outside every declared network is finally something the app says out loud.** Declare-first has been the rule for a while — the plan is the authority, and an address outside it is either a typo or a network nobody ever wrote down — but nothing in the app ever asked the question. The nine buckets of Verifica do not include it, and the IPAM audit did not either, so a device on 192.168.77.5 in a site that is entirely 10.0.x simply appeared nowhere. It is checked now, and the report names the address and the device that carries it, without choosing between the two possible conclusions: they call for different fixes and that call is yours. ⚠️ Judged **per address family**, which is the guard the rest rests on: a plan that declares no IPv6 network would otherwise report every documented IPv6 address as «outside the plan» — not a finding, just the noise of comparing against nothing. No network of that family means no verdict on that family, and a project with no declared networks at all accuses nobody. IPv6 link-local stays out for the same reason it stays out of the duplicates: `fe80::/10` belongs to no plan, it exists on every interface by itself.
- **«I could not check» stopped looking exactly like «there is nothing wrong».** The overlap classifier returns an empty result when the CIDR parser is not injected, and the L3 report's fallback object — used whenever the audit module is absent or throws — was literally the shape of a clean network. Either way the summary line read «no issues» about a verification that never ran. That is the opposite of the rule this project applies everywhere else to the grey «not known», and in an audit it costs more than in a drawing, because an audit that says nothing is believed. Every check that could not run now leaves its name and its reason in `notChecked[]`, the summary carries a chip for them, and the hygiene section spells them out — including the case where there is simply no declared plan to compare against, which is not a failure but must not read as a confirmation either. The duplicate-address check reports itself as degraded when the canonical-form helper is missing, since without it two spellings of the same IPv6 stop being a duplicate.
- **A bundle is checked for where its members live, and how many there are.** The LAG audit compared what each member *is* — speed, VLAN, LACP mode — and never asked the two questions that decide whether the bundle exists at all. A group with a single member aggregates nothing: either the second port has not been added yet, or a member dropped out. And members sitting on two different devices only bundle if those devices are one logical switch — a stack, or an MLAG/vPC/MC-LAG depending on the vendor; otherwise LACP forms nothing and half the uplink stays dark. The section is per-device, so the crossing was the one thing it could never see: the group is now collected across the whole project. ⚠️ Whether two devices are one logical switch is not decided here — `lib/stack.js` already owns that definition (`getLagCrossMemberInfo`, the cross-stack EtherChannel), and a second copy of it would drift from the first. And when the answer is unknown nobody is accused: a LAG across two devices may perfectly well be a legitimate MLAG, and on a core it usually is, so silence is the only honest response — but the audit records that it *is* silence and not an acquittal.
- **A link that routes is told apart from one whose VLAN we simply cannot read.** Every *switched* port is in a VLAN — VLAN 1 if nobody said otherwise; that is what VLAN 1 is for. A **routed** port is not: `no switchport` plus an address takes the interface out of the switching domain altogether, and it belongs to no VLAN, not even 1. Those two silences used to be the same silence. They are now separate states, because they call for opposite things: a routed link is a fact with nothing missing, while a switched port whose VLAN nobody declares is a gap that can be closed. The evidence was already on the wire and already being walked — the standard address-to-interface table, of which only the IPv6 rows were kept. On the bench it identifies exactly one port out of every port of every device: the one carrying `10.99.0.2` toward the edge router.
- **And «routes» is now measured as «is not a port of the bridge», which is what it means.** The field promised a conclusion and read a premise: it said *this port routes* while measuring only the address-to-interface table, and owning an address is ordinary for any host — it fired on a wireless controller's NIC, which switches perfectly well. The question that decides whether a VLAN exists is whether the port is part of the **bridge**, and the evidence is standard, vendor-neutral and was already on the wire and already being read: `dot1dBasePortIfIndex`, walked all along to translate PVIDs, which are indexed by bridge port rather than by interface. ⚠️ The proof is asymmetric and is treated as such, because the bench says it must be: the controller's port **is** a bridge port with PVID 1 *and* owns 10.10.99.24, so being in the table is a **veto** on «routes» — that port switches, full stop; but a vIOS publishes the table for two ports out of eight, and another unit of the same image for none at all, so being absent from it proves nothing and the address stays an indication, now labelled as one. The two measurements are named for what they measure — `ownsIp` and `bridges`, the latter absent rather than false when the agent says nothing — and a single pure function composes them. Measured over the bench: the controller's cable stops being called routed, and the one genuinely routed link, `SW-CORE Gi0/0` to the edge router, still is.
- **An address on a host's own NIC does not make its cable routed** — a router or a wireless controller always has one and is still an endpoint inside a VLAN. Measured: with that check placed first, the lab's VyOS router and its wireless controller, both on access ports in VLAN 99, came out as routed links. Whether a port routes is therefore only consulted when no VLAN applies at all, where it explains the absence instead of causing one.
- **A cable that switches always has a VLAN, so it always has a colour.** «VLAN not declared» was an outcome the picture could produce, and it is not a state that exists in switching: every port of a bridge has a PVID, and where nobody configured one that PVID is 1. That is the 802.1Q default rather than one vendor's convention — VLAN 1 exists on every switch, cannot be deleted, and is where everything nobody assigned elsewhere ends up. Measured on the bench: the Arista reports PVID 1 on every port nobody has touched, and VLAN 1's own membership list contains exactly those ports. A switched cable no source can name therefore takes the **site native VLAN** — 1 by default, declarable otherwise for a site that runs its native elsewhere — as the **last** rung, below every source that actually knows something. The provenance travels with it and the cable panel always shows it, because the number alone would make a default indistinguishable from a reading, which is the defect this release started from. **A routed link keeps no colour**: `no switchport` plus an address takes the interface out of the switching domain, and VLAN 1 is the floor of that domain, not of the universe — when you make a port routed the switch itself allocates an internal VLAN from the extended range rather than putting it in 1. A trunk carrying several VLANs keeps none too, for the reason above. Over four real projects the floor lands on five cables, all in hand-drawn chains where nothing was ever measured; on the bench it lands on none.
- **And an unmanaged switch stops swallowing the VLAN.** The criterion is the one the hardware itself follows when frames go by: a frame keeps its identity until a VLAN-aware port reclassifies it. An unmanaged switch is a plain 802.1D bridge — it forwards on MAC, has no VLAN table, adds and strips no tags — so the VLAN of everything hanging off it is decided by the VLAN-aware port at its edge, and it applies to all of its sockets, because inside it is a single broadcast domain. InfraNet treated it as a switch like any other: the VLAN reached its uplink port and stopped there, and every cable on the far side read as undeclared. Measured before the change, with the upstream switch fully authoritative on VLAN 30: the uplink cable said 30, the cable beyond it said nothing. The declaration was already in the Switch panel — `managed / smart-managed / unmanaged` — and nothing read it. It is declared and never inferred, because a managed switch nobody has polled looks exactly like an unmanaged one, and guessing would push a VLAN through a device that in fact keeps VLANs apart. Only `unmanaged` is transparent: a smart-managed switch has VLANs and classifies like a managed one.
- **And the cable panel says what the map says.** The two answered the same question differently: the map asks the model, the panel asked `_getLinkVlan`, which answers a *different* question — the link's **native** VLAN — and whose ladder knows neither the dot1Q sub-interface nor the declared network of a single-homed endpoint. Found by looking at the screen: four bench cables painted 99 or 30 while the panel wrote «VLAN 1». The panel now reads the model for the number, its name, and the colour of the dot. ⚠️ And that field is *editable* — it writes an override onto the active port — so pre-filling it with a fallback asserted something nobody had said: it now carries only the **declaration**, empty when there is none, with what applies shown as a placeholder that asserts nothing. The same reading was collecting the VLAN list for the handover dossier, where a cable in 99 counted as 1. `_getLinkVlan` stays for the native, which is its real job, and now says so in its own documentation so the tenth caller doesn't repeat this.
- **And the VLAN legend contains VLANs again.** One entry, «no VLAN colour», stood for every neutral cable — a label defined by absence, in a model where a cable that switches now always has a colour. It is gone, and only one non-VLAN entry replaces it: **routed**, the sole neutral state that has no other way of being discovered. A trunk has one, and better: its own button in the topology highlights every trunk at once, which a legend swatch cannot do, and the colour of any individual cable can still be overridden from its properties. The entry appears only where at least one routed link exists, because an entry explaining a colour that is nowhere on the map is noise.
- **And the neutral stops looking like VLAN 1.** A cable with no VLAN colour used to fall through to the site's native VLAN and be painted in the same grey as a cable genuinely in VLAN 1, so one shade covered states that ask for opposite things. Neutral is now a colour of its own, distinct in hue rather than merely in shade, and it means one of exactly two things — a trunk carrying several VLANs, or a routed link. Both are assertions rather than gaps, which is why nothing else lands there any more.
- **The cable panel says what the cable is, and why** — «VLAN 99», or «trunk — 4 VLANs, none prevails», or «routed link — no VLAN», or «VLAN not declared» — followed by the source in plain words: measured on the port, sub-interface on the cabled port, declared network of the connected device. It appears only when it adds something the line above does not already say.
- **And the carried VLANs of a trunk are shown as coloured pills**, in the cable panel, all at the same weight — the same language as the legend's VLAN pills, which the eye already knows. It is what replaces the colour on the cable: rather than electing one VLAN, all of them are visible at once.
- **A trunk whose declared VLANs no longer match the ones measured now says so.** The list of VLANs a trunk carries is written by hand on the cable, and being hand-written it wins everywhere — colour included, which is correct. But nothing was comparing it with what the switches actually allow, so changing `switchport trunk allowed vlan` on the hardware left the document quietly behind, still showing yesterday's list as though it were today's. Found the hard way on the bench, changing a lab trunk and watching the picture not move. The declaration still wins; the contradiction is now reported as a state discrepancy, one per end, so a trunk misconfigured on only one side is visible. Sets are compared as sets — `20,10` and `10,20` are the same list, and a range written compactly equals the ids it expands to — and a side that says nothing never produces a discrepancy: an unread port does not contradict a declaration. Adopting the reality writes onto the **cable**, where the declaration lives, not onto the port, where the next poll would overwrite it anyway.
- **The handover dossier stops printing «VLAN 1» for a trunk.** The cable table showed the native, which on a trunk is the least informative of the VLANs it carries — the same convenient story as the screen, on paper. A trunk now prints the list of what it actually carries; an access cable is unchanged, keeping the VLAN and its name.
- **A router-on-a-stick stops being invisible.** A dot1Q sub-interface — `Gi1.99` — is not something you plug a cable into, so the driver discarded it as "not physical" and said nothing. It took two things with it: the VLAN, and the address. On the bench the management address of a Cisco CSR1000v sits on the sub-interface, not on the port beneath it, which means the interface InfraNet was talking *through* did not exist in the document. Sub-interfaces now enter as logical ports — the same shape the NetBox import already uses, one model rather than two — carrying the physical port they stand on, taken from the device's own interface stack rather than inferred from the dotted name.
- **The sub-interface keeps its physical port even where the standard table is silent.** The Cisco table that declares a sub-interface's VLAN is indexed by VLAN *and by the physical interface*, so it states the parent as well; that second half was being read past. The standard interface stack still decides — it is RFC 2863 and holds on any vendor, the Cisco table only fills the gap where the stack says nothing, and a test pins that precedence. The same table warns that several rows can point at one interface: where two of them declare different VLANs for it, the VLAN is now reported as unknown rather than settled by whichever row the walk happened to read last.
- **And the port beneath them carries their VLAN.** That is not a deduction of ours: the device declares both halves — this interface *is* VLAN 99, and it lives on `Gi1` — so a cable on `Gi1` can finally say 99 instead of reporting only the untagged VLAN. Where the VLAN is not declared the sub-interface still appears and the VLAN stays unknown; the 99 in the name is not a measurement, and reading it from there would be the same wager as taking six bytes for a MAC address because they are six.
- **A LAG’s VLAN can be declared once, on the bundle.** On real hardware a Port-channel is configured once and its members inherit — members that disagree do not aggregate at all, which is exactly what the coherence warning already said. Saying it here meant repeating it on every member port, and forgetting one earned you that warning for work the hardware does by itself. The LAG row now carries a VLAN field: it writes the declaration onto every member at once, shows «mixed» instead of inventing a single number when they disagree, and leaves an empty field meaning *nothing declared* rather than VLAN 1. ⛔ The tempting shortcut — letting an undeclared member inherit from a sibling inside `propagateVlans` — was refused twice over: it would write a number onto a port nobody declared, the defect this release exists to close, and it would silence the one warning that catches a genuinely broken bundle. A test pins both the writing and the fact that the warning stays reachable.

### Changed

- **The cable's port mode moved up to where the cable is described.** The blue TRUNK pill sat inside the VLAN section, where it read as something about the VLAN rather than about the link; it now stands with the other badges that answer «what is this cable» — first among them, before «Manual», the discovery protocol and the proof state — and ACCESS is shown there too, because a mode means nothing unless both of its values are visible in the same place. A wireless association shows neither, having no port mode to speak of.
- **And everything about the VLAN now lives in one collapsible section**, the same shape every other section of the properties panel already had, and the same treatment the VLAN has in the floorplan panel: same icon, same title, remembered open or closed like the others, with a one-line preview in its head when closed — the model's own answer, with the cable's colour in front of it. Inside it, in reading order: what the VLAN is, the port mode, the native VLAN, the carried ones, and the colour override — the last word on a colour that the lines above have just finished explaining, instead of a lone control three groups further down. Its label lost the word «VLAN», which the section header now says once.
- **The section stopped saying the same thing three times.** A trunk read «native: VLAN 1 · carried: 10, 20, 30, 99» in words, then «this cable: trunk — 4 VLANs, none prevails», then the two fields that hold exactly those values, then the coloured pills. The two text lines are gone on a trunk and the pills carry it, at a larger size, because on a trunk they are not decoration next to a sentence — they are the whole answer. Everywhere else the provenance line stays: it is the only thing separating a measured VLAN 1 from a VLAN 1 nobody ever set.
- **The status badges are bigger, and they stay on one line.** The row split the width 55/45 regardless of what it had to hold, so a cable with four badges wrapped them onto a second line while the field beside it sat half empty. The field now takes what is left instead of what it was promised. Measured across all 1,680 combinations the row can produce — four port modes and states, three discovery protocols, six proof states, four values of the type field, in both languages — none wraps at a typical desktop width. ⚠️ Below roughly a 1,570-pixel window the widest combination still wraps, and that is arithmetic rather than layout: those badges cannot be made to fit without taking words out of them.
- **A port with no link for three verifies is amber now, not dark grey.** The two «off» port states used to share a monochrome scale that ended in neutral grey, on the reasoning that green, red and amber already said other things. But the two are not the same kind of fact: a port in `shutdown` is a **decision** — whoever made it knows — while no link for three consecutive verifies is an ambiguous **symptom** (device off? dead NIC? SFP pulled out?) that somebody has to go and look at. The decision stays the quiet near-black hole in the chassis; the symptom asks for attention — and it now carries the glow, and the translucent tinted treatment on SFP and management slots, that the removed `idle` state used to own. The axis is not «lit or off», which the colour already answers: it is **asks something of you, or does not**. Green, red and amber glow because each of them wants a person to look; the shut port is a settled decision and stays mute. ⚠️ That glow has to be written twice — the rule that actually reaches the screen is the `!important` twin in `06-panels.css`, which had been quietly cancelling anything written beside the other port colours — so a test pins both copies and refuses a shut port that starts glowing.
- **And the floor plan learned a state the rack had been showing on its own.** On a floor tile the device icon doubles as the port light — that is what it is for — but the two renderers asked different questions: the rack consulted the measurement in three places, the floor plan in none, so a port with no link for three verifies simply had no way of reaching the class, and no stylesheet could have rescued it. It asks now, on the single-port icon and on the pins of a multi-port device, and the amber survives the per-type colours, which are more specific and were already having to make room for red. ⚠️ **A port shut by hand is deliberately left alone here.** In the rack the near-black is a hole in the chassis and reads as one; on the floor plan the icon *is* the device, and near-black on a dark ground does not say «switched off on purpose», it says «failed to draw». Whoever typed `shutdown` knows; the amber is for whoever walks past and does not. Three tests hold the chain together, because it takes only one broken link — renderer, colour, or the room the per-type rules make for it — for the colour to vanish with nobody noticing.
- **And its amber is deliberately not the other amber.** The interface already uses `#f5a623` as its generic warning amber, in some thirty places; two ambers that coincide get merged by the eye, so the measured port state takes a deeper `#d29922`. ⚠️ That colour is written in three places — the CSS token, the SVG dossier and the draw.io export, neither of which can read a token from outside the browser — which is exactly the shape of defect that has cost this project nine cases. A test now compares the three, and refuses any two of the five port states that resolve to the same hex.
- **And the LAG section speaks the panel's language.** Its row was built before the rest of the properties panel settled, and it showed: the group name was blue and bold where no other field is, competing with the section title; the mode dropdown was a raw browser control among drawn fields, because the house rules for selects do not reach outside a `.prop-group`; the delete button was half the height of the fields beside it and the only element in the panel still using hard-coded greys instead of tokens; and the port chips carried a `margin-left:auto` that belongs to the port header — here it tore a hole between a group's name and its own ports. ⚠️ Underneath all of that, the declared widths had never taken effect at all: a form control's automatic minimum size is its intrinsic width, so `flex: 0 0 110px` on the name field rendered at 210 and pushed everything else sideways. With `min-width:0` the columns are what they say they are, which is what let the section gain a **column header** — one caption row instead of a label repeated on every group, and where the VLAN field finally says which number it is holding. Measured in the browser at 2, 8 and 16 members: four cells of equal height, four columns aligned to their caption, and a row that never overflows the panel.
- **The proof badge's shape moved out of the code that builds it.** It carried its padding and font size inline, which meant the two places that show it — the dashboard and the cable panel — could not be sized differently without an `!important` fight. The shape is a stylesheet rule now, the code passes only the colour, which is the part that depends on the state.

- **A port has three states, and «idle» is no longer one of them.** The fourth LED colour meant four different things depending on who was reading it: its own label promised «up but carrying no traffic», the SNMP layer wrote `testing`/`dormant` into it, which RFC 2863 defines as the opposite — neither passes packets — the screenshot generator used it for «shut by hand», and the architecture notes called it «Ready», which is the *printer*'s label. Nothing read it to decide anything; it was only a colour. And a colour that changed by itself: the same reading that wrote `idle` also wrote `operUp = false`, so the port accumulated a down-streak and after three verifies moved from one amber to the other. An amber that lasts three polls and then becomes a different amber is not a state, it is noise. On the wire the two values are close to unobtainable in a single-site network anyway — `dormant` belongs to dial-on-demand WAN interfaces and to a Linux NIC waiting on 802.1X, `testing` to a device someone put in loopback — and the one bench device that ought to report `dormant` reports `down` instead. Ports now switch, don't switch, or are faulty. A project saved with the old value needs no migration: it falls through the same branch it always had and reads «inactive», which is what the device was saying. The two manuals were still teaching it — a swatch in the port-colour legend and a line in the rack figure caption — and now carry the amber that actually exists, «no link across three Verifies», plus a note saying where a device own word for a quiet port went: into the SNMP bar, as a measurement that expires. The `--idle-color` token survives with a different job — generic amber for attention — and its comment stopped naming a port state that is gone.
- **And the word the device used is not thrown away.** Losing the colour should not mean losing the reading: `testing` and `dormant` now travel as `operWait`, a measurement beside `adminDown` and `operUp`, and the port panel prints the device's own word in the SNMP bar next to «admin shutdown» and «no link». It is not translated, for the same reason `admin shutdown` is not — that is the word in the MIB and the word you would search for. It is neutral rather than amber, because in that bar amber already means one thing («somebody go and look») and a second meaning would undo the fix above. And being a measurement, it expires with the other three when the switch stops confirming it, which the old colour never did: a port read `dormant` once stayed amber forever while the evidence behind it had long gone.

## [2.10.0] — 2026-08-20

### Added

- **NetBox locations become rooms on the floor plan.** A location is the floor or the room a device sits in, and until now it survived only as text in the device notes. It is a rectangle now, with its racks and its devices drawn inside it. What NetBox does not have is the geometry — a location has a name and a parent, never a position or a size — so the split is stated rather than blurred: that the room exists is measured, where it sits and how big it is is our choice, marked on the data the same way imported rack positions already are. The size comes from the contents: a room holding two racks is small, one holding twelve is large.
- **What has no location stays out of the rooms, and below them.** Drawing a device inside some rectangle to tidy the picture would claim a room membership the DCIM never declared, so those devices sit under the rooms and a decision row counts them. Nested locations collapse into one name — «Floor 1 · Server room» — because an InfraNet room does not contain another, and the room carries the NetBox id so renaming it upstream is a rename, not a delete and an add.
- **Virtual machines belong to whatever hosts them** — storage arrays, desktop NAS boxes and servers now carry the same *Virtual machines* section a hypervisor has: the list, the import drop-zone, the VM card. Hosting VMs is something a device *does*, not what it is — a Synology or QNAP runs them from a package (Virtual Machine Manager, Virtualization Station) and is still a storage box, and its capacity, RAID level and protocols stay on the panel where they belong.
- **So the DCIM import stops rewriting the type** — a NetBox device with virtual machines on it used to come back as a hypervisor (or a home lab, on the floor), erasing the role its own archive declared. That now happens only for a type that cannot host them at all — a switch, a firewall — where the data would otherwise have nowhere to live, and the import still says so in its list of decisions.
- **Declared life-cycle status** — planned / staged / in stock / in service / failed / decommissioning / out of service. It changes how silence is read: a device declared planned that stays quiet is expected, not a fault. The DCIM import fills it; an unknown word stays undeclared rather than guessed.
- **And it cuts both ways**: a device declared out of service that *answers* is flagged amber — stale documentation, which nothing caught before. The measure itself is untouched (`n.proof` records absence as always); only the reading changes.
- **Overview: "Declared status" row** — contradictions take the headline, and the absences the declaration explained away are stated out loud. No device declaring a status leaves the row dashed, not a green zero.
- **Imported objects keep their DCIM identity** — ports, patch-panel slots (front *and* rear) and racks carry the id of the object they came from, in a field of their own. A port's only anchor used to be `ifName`, a string; a cable is addressed by its two interfaces, so writing one back was impossible. The reference never lives inside the InfraNet id: ids get renumbered.
- **The encoding is compact, and the price was measured** — the object type lives in the field's name: 13 bytes per port instead of 57 (a 40-device document grows by a third, not double). One module knows those names, so the encoding can change again without chasing callers.
- **The rack diff stops matching by name** — renaming a rack in the DCIM used to report it gone and re-appeared. It matches by reference now, falling back to the name for older projects, and that weaker pairing is counted rather than passed off as certainty.
- **A gate before any write-back** — a NetBox fixture goes through import, portable export, JSON and reopening, and every reference must come back unchanged; it also asserts each family is present, so it cannot pass by proving nothing.
- **Two devices that announce each other are drawn as adjacent even when the port is not known.** Until now the topology needed a port at each end: a neighbour whose port name matched nothing left the pair looking like strangers, as if they had never seen each other. The line is there now, with `?` where the port is unknown — which is the honest shape of what was measured, rather than picking a port at random for the sake of drawing something. Precision still wins: where a cable of the project already joins the two, the pair reads as confirmed and this stays the rough version of something known better, not a second truth laid over it. The adjacency lives outside the document — it is a measurement, and it lasts as long as the session does.
- **A neighbour that does not become a cable now says why.** The protocol announcing that two devices are attached, and the picture showing nothing, used to look exactly like a device with no neighbours at all — which is how a defect hides for months: the local-port bug fixed in this same release lived inside a bare guard that discarded a candidate whose source port was missing. Every announced neighbour that produces no link is now reported with a reason, and the reasons stay apart because they ask for opposite things: *device not in the document* is closed by scanning it or adding it, *neighbour with no readable identity* is closed by writing code, and *local port unresolved* means the protocol named a port we could not match — the symptom of an identifier we are not reading properly. What the neighbour actually announced travels with the reason, so the report can be traced back to the wire rather than to our paraphrase of it.

### Fixed

- **An LLDP neighbour is read from the subtype it declares, not from the length of its value.** Every LLDP identifier travels with a subtype that says what it is; we never asked for it, and guessed instead — six bytes meant a MAC address. It was wrong in both directions, and the bench proved both. The same Cisco chassis id arrives as six raw octets when read through an Arista and as seventeen bytes of text through a MikroTik: the encoding is the answering agent's choice, not the advertiser's, and the text form was dropped whole — with it the one identity of a neighbour that never changes. In the other direction a port named `Gi1/24` or `ether1` — six characters exactly — became the address `47:69:31:2f:32:34`, which belongs to nobody and matches nothing, so a port the protocol had named exactly was thrown away and then guessed at. Both subtype columns are now read; a chassis id declared *local* yields no MAC rather than an invented one; agents that do not publish the columns keep the old behaviour, plus recognition of a MAC written out in full, which cannot be anything else.
- **The local port of an LLDP neighbour is read, not assumed to be an ifIndex.** LLDP numbers the ports it advertises in a space of the agent's own, and nothing requires it to be the ifIndex space: on the bench's Arista, `Management1` is LLDP port 97 and interface 999001. Reading 97 as an ifIndex finds nothing and invents the name `port97`, which matches no port in the document — so the candidate link is dropped without a word, leaving two adjacent devices and no cable between them. The name now comes from the port description first (on Cisco that is the full `GigabitEthernet0/0`, the one that matches the interface table), then from the advertised identifier when its subtype says it names an interface — which is exactly the Arista's case, since it sends no description — and only then from the old guess, which stays correct wherever the two numbering spaces do coincide.
- **A port a neighbour identifies by MAC now resolves to that port.** Some devices advertise their ports by address instead of name — every port of a MikroTik does. That value used to be filed as a port *name*, where no port can match it, so the link fell back to the first free port and was marked inferred. The address now has a field of its own and is looked up among the ports' own addresses: found, the port is read from the protocol and the link stays authoritative; not found, the old inference still applies, still labelled as such. The same address also identifies the device it belongs to, which recovers neighbours whose name is absent from the document.
- **A room now follows the cursor while you drag it.** Rooms carry a class of their own, and the helper that finds a node's object on the floor plan only knew about device tiles: for a room it returned nothing and the live update was skipped in silence. The position moved in the document while the rectangle stayed put — and since a floor drag does not redraw the plan on release, it stayed put after you let go too. It looked like the room was stuck to a grid; it was getting no feedback at all. Same helper, same fix, for resizing.
- **The grid you see is the grid you land on.** It was drawn at 40px and things snapped at 20, so everything stopped half a cell short of the line. The step now comes from one number — the one objects snap to — and the render imposes it on the drawing, so the stylesheet cannot drift away from the behaviour again. Nothing moves: what changes is the drawing, not where things land.
- **The assistant no longer says every switch is full.** It counted a device's ports by counting *port records*, and a record only exists once a port is documented or cabled — so "total minus used" was zero on every switch of every project. On the 500-device bench: 291 free ports per the Overview, **0** per the assistant, on all fourteen. The total is now what the device declares, with the documented count travelling alongside as its own figure. Undeclared port count → no total and no free count, rather than a guess.
- **A PDU stops having two outlet counts.** Device fields live in `node.spec`; "Apply model" was writing the outlet count one level up. Two copies, and the readers disagreed by design — the rack grid showed one number and the Overview another, at the same instant, and the grid changed on its own after a reload. One precedence now, `spec` first, everywhere; and "Apply model" writes where the panel writes.
- **The public API counts a device as SNMP-managed only if it can be polled.** Picking a driver was enough: a device with no address still counted in `/api/v1` and landed in the `snmp_managed` Ansible group — a playbook target with nowhere to connect. Three switches with one reachable: the app said one, the API three. Now it takes a driver *and* an address, as everywhere else.
- **The Dashboard stops declaring a full network empty.** Left on the Dashboard and reopened, it said "the network is still empty — run Discovery" over a loaded document. Loading a project reset the per-project runtime, view flag included, while the page stayed on the Dashboard: the Overview then bailed out of every render and kept the empty screen drawn before the project arrived. Same cause made switching project show the previous one's numbers. The topology is per-project and still resets; the Dashboard is a local preference and survives.

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
