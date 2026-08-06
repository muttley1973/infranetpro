# Changelog

What's new in InfraNet Pro. Format based on [Keep a Changelog](https://keepachangelog.com/); newest first, grouped by release. **One line per change** — the reasoning behind each one lives in the commit history.

**A linked version number is a published release** — follow it to the release on GitHub. *Unreleased* is what has landed on `main` since the last one.

## [Unreleased]

**The header never spills onto a second line when a status badge appears.** Turning on background polling, highlighting spare ports, a freshness counter or an SNMPv3 notice each add width the responsive breakpoints can't foresee; in the ~1738–1920px range that alone was enough to push the right-hand cluster onto a second row — just enabling polling broke the layout. The header now measures itself and reclaims space in the requested order: first it collapses button labels to icons, and only as a last resort narrows the search bar, so it stays on one line. Verify keeps its label.

**Background automation can keep the document saved and verified on its own, every Verify leaves a dated row in a per-project history, and you can now take restorable full snapshots and roll back to one — all kept outside the project file.** Four opt-in automations, all reachable from the Automazioni menu: an autosave that persists real changes without pressing Save, a scheduled silent Verify, a lightweight timeline of each Verify, and restorable full-state snapshots with a unified History panel. The history lives outside the project JSON (already at its size limit), behind a storage-agnostic interface ready for a future database.

### Added
- **Autosave** (opt-in, off by default): after any real change (edit, Sync, Verify) the project saves itself a few seconds after activity settles, silently — reusing the existing save path; just browsing never marks the document dirty, so it never triggers a save. Toggle in the Automazioni menu.
- **Scheduled Verify** (off by default; 15/30/60 min or daily): a timer runs a *silent* documentation Verify at the chosen interval — same engine as the manual Verify (SNMP poll + reachability sweep + proof-state) but without stealing the screen (no alert, no spinner, no forced Dashboard) and never adopting on its own; it skips a hidden tab. It uses the same on/off slider + interval control as auto-poll, grouped in the Automazioni menu with no new header badge.
- **A lightweight verification timeline**: each Verify (auto or manual) appends a ~1 KB dated row (divergences + network size) to a per-project history kept **outside** the project JSON (`projects/history/<id>/timeline.jsonl`), via a storage-agnostic `historyStore` interface (ready for a future SQLite backend). Admin-only routes, server-stamped author/time, whitelisted counts, generous retention (cap + age). Toggle "snapshot on each verify" (on by default).
- **Restorable full-state snapshots + a unified "History" panel**: gzip snapshots of the whole state live outside the project JSON (`projects/history/<id>/snapshots/`); *Restore* rolls back to one after first taking an automatic pre-restore safety point (reusing the load/undo apply path). Snapshots are taken on demand, on manual Save (throttled to one per 10 min), and before risky operations (import, bulk adopt); retention thins them (all < 48h → hourly to 7 d → daily to 30 d) with a cap of 100 and labelled points never deleted. The old "Storia modifiche" overlay becomes the "Storia" panel with three tabs — Changes (audit), Verifications (timeline), Restore (snapshots) — reachable from the Report menu.

### Fixed
- **The header stays on one row when the runtime status badges appear** (auto-poll, spare ports, freshness, SNMPv3, paid-module entries): a fitter measures the wrap and reclaims space by priority — button labels to icons first (Export → Dashboard → Save → Discover), the search bar last — instead of relying on the search's shrink headroom, which the badge set could exceed above the ≤1737px breakpoint. The media queries still own the layout when no badge is showing (the fitter is purely additive); Verify never loses its label.

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
