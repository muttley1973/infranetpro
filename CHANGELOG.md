# Changelog

What's new in InfraNet Pro. Format loosely based on [Keep a Changelog](https://keepachangelog.com/); dates are ISO-8601, newest first. One line per change — the reasoning behind each fix lives in the commit history.

## 2026-07-24 — Overview: a read-only summary of what's missing, stale, or spare

- **Added** — a new **Overview** view (a view switch like Topology, it never touches the document): three columns — **Document · Conformance · Expansion** — each cell a number *and* a plain-word verdict, declaring the **provenance** of every figure (declared / from scan / derived / not declared); a missing datum shows dashed, never a zero. Composes existing engines only, no new measurement; the chosen view lives in `localStorage`, never in the project.
- At-a-glance **health-dot verdict** per column (red reserved for a never-synced project, so a synced-but-imperfect one stays amber), a **since-last-read delta** (−N / +N, baseline in `localStorage`), a severity-coloured accent on the most urgent tile, and in-place **drill-down** on every row.
- Honest labels along the way: the mismatch verdict is "to be defined", the provenance pill "from scan", "Device name", a missing *name* "to confirm"; the breadcrumb follows the active view (Floor plan / Topology / Overview).

## 2026-07-24 — An exported floor plan doesn't claim presence without a Verify (v2.1.0)

- **Fixed** — with no drift report, a floor device that hasn't answered SNMP now renders *unverified* (its type colour, a grey ring, a gentle `0.7` fade), not "present": a static export must not freeze an unchecked state. The on-screen view (which has live context) is unchanged.

## 2026-07-24 — "Configured for SNMP" is not "responding"; a wireless problem is one problem

- **Fixed** — the AI context now carries `summary.snmpResponding` (devices that answered ok at the last Verify) beside the merely-configured `summary.snmp`, and the wireless-VLAN check de-duplicates by (AP, SSID, VLAN) — one logical problem is one row, not one per radio.

## 2026-07-24 — Measures now say when they were taken; devices are counted once

- **Fixed** — measured facts (SNMP health, UPS, alerts) are stamped with the read time (`asOf` / `summary.measuredAt`), so a 50-hour-old reading no longer reads as live; onboarding and the sub-header statistic now count the same population (non-structural nodes), with passives disclosed in the tooltip.

## 2026-07-24 — The report stops inventing facts the data doesn't support

- **Fixed** — the dossier enumerates any `node.vms` (not a catalogue flag), so 32 documented VMs stop vanishing and an absent power state reads "unspecified"; IPAM's "next free IP" now includes VM addresses (no collision); the fleet capability roll-up drops the double-counted "uplink" sum for an honest per-device LAG figure (a MAX never doubles the two ends).

## 2026-07-24 — An unset HA role is not "Active"; an unmeasured PVID is not "VLAN 1"

- **Fixed** — an undeclared HA role renders "— unspecified —" instead of a phantom second "Active" (a pair imported without roles no longer shows two Actives); a port's VLAN field stays blank (site-native placeholder) unless the PVID was set, measured or propagated — no more asserting "VLAN 1" on 148/232 unobserved ports.

## 2026-07-24 — Absent status no longer reads as "off": ports and VMs

- **Fixed** — on the printed dossier a port with no reading and no override shows "—" (not "inactive"), and a VM's power state is tri-state (running / stopped / unspecified) — a VM is no longer born "running" until the user or an SNMP probe determines it.

## 2026-07-24 — An absent field no longer states an invented default

- **Fixed** — the 18 identity selects (brand / OS / platform) show "— unspecified —" when the field is absent instead of pre-picking a real value ("Dell", "Windows 11"), and cable type is tri-state (unspecified / patch cord / permanent) so an unclassified cable never labels itself "patch cord". The technical defaults (PoE, wired, L2, mount…) stay — they describe a typical setup, not an observed identity.

## 2026-07-23 — A blind Check no longer reports "documentation aligned"

- **Fixed** — a Verify that observed nothing (empty FDB, no sweep) now reports *blind*, not "aligned": `buildDriftReport` exposes `evaluated` + `docCount`, so `driftBannerKind` distinguishes a genuinely-empty project from one it never looked at (487 devices on the bench were reported fine by a Check that saw none of them).

## 2026-07-23 — The "documented" percentage was counting the wrong devices

- **Fixed** — an active device (switch / router / hypervisor / controller) is addressable even without the `hasIP` flag — its address is implicit in `isActive`, as the rest of the code already assumes (`isActive || hasIP`). The documented-% denominator goes from 19 to 31 on *Rete+Lab*; a test fixture describing a non-existent catalogue is corrected.

## 2026-07-23 — Looking is not editing: the Topology view no longer marks the project as unsaved

- **Fixed** — switching to the Topology view no longer turns Save amber: the view-controls bar is treated as chrome (not a click on the empty map), and a pan that moved nothing (< 5px) is not a change.

## 2026-07-23 — Name first: a floor plan made of IP addresses is a dump, not documentation

- **Added** — the floor label is now two lines (what it is on top, where it answers underneath): when the name *is* the address (19/34 devices on the sample), the readable part is **derived for display only** from the measured type + OUI vendor — `node.name` is never rewritten. New pure `lib/node-label.js` turns the IEEE company name into a brand (`Cisco Systems, Inc.` → `Cisco`) and never prints an OUI placeholder as a manufacturer.
- **Changed** — the same readable label now feeds the drift report, audit log, L3 map, cabling editor, cable labels and the dossier's asset register (59 call sites), so a device reads identically everywhere; the REST API v1 DTO is untouched (a test pins `d.name` is not mutated).

## 2026-07-22 — vNIC ports: a VM can finally have more than one network card

- **Added** — a VM can declare several virtual cards (`vm.nics[]`: name, IP, VLAN, MAC, IPv6, port group / vSwitch) in a dedicated "vNIC ports" accordion — a virtual firewall gets WAN + LAN + DMZ. Each card feeds the three existing couplings: its VLAN → the host's derived trunk, its MAC → the documented devices of the Check, its IP → the duplicate audit. A vNIC has no cable of its own (it rides the host uplink; with teaming, which physical NIC carries it isn't knowable, so it isn't drawn).
- **Changed** — the SNMP read keeps all measured MACs (auto-assigned only when unambiguous); existing projects migrate silently onto the first vNIC.

## 2026-07-22 — Virtual machines: compact list + full VM card, and they finally reach the handover dossier

- **Added** — VMs get a dedicated **VM card** (a 5th properties scope): identity, network & access (with a management-console row), allocated resources (vCPU / RAM / disk) and handover data (owner / criticality / backup / notes). The host panel now *lists* VMs one per row (state dot, name, role · resources · IP) instead of an inline editor. VMs reach the **handover dossier** (their own chapter, grouped by host) and get their **own cover counter** — never summed into the device count.
- **Added** — a VM that exposes an SNMP agent on its own address can be **polled like any host** (`vm.integration` mirrors the device one field for field, reusing `/api/poll`): system name, MAC, uptime, CPU / RAM / disks come back as a measured block stamped with the read time, kept apart from declared data and copied in only on an explicit click. An answer proves it's running; silence never marks it stopped.
- **Fixed** — a VM's IP now takes part in the IPAM duplicate audit; editing a field in the VM card no longer kicks you back to the host panel.

## 2026-07-22 — VM import drop area: reachable at any list size, works without a MAC, honest refusals

- **Fixed** — the whole "Virtual machines" section is now the drop target (was a fold-hidden strip that stopped working after the first few imports); a cross-subnet SNMP device with no MAC can become a VM (MAC left empty, nothing invented); an ineligible drop explains itself instead of a mute bounce-back; the VM power button uses the right green/red tokens.

## 2026-07-22 — Discover results: every device on a single row

- **Changed** — the results table keeps every device on one 36px row: the name ellipsises first while the status badges never wrap, at any width, no horizontal scroll.

## 2026-07-22 — Discover modal redesign: two phases, plainer terms, compact setup

- **Changed** — the Discover modal is now two phases (setup form → results table, with a "‹ New search" that keeps the range); scan options are plain-language (**Speed: Fast / Balanced / Careful**, "Recognise devices better", "Also find quiet devices", "Include hosts that ignore ping", "Follow the links between switches"), grouped in a two-column "Search deeper" fieldset; setup is compact (640px), results wide (1080px).

## 2026-07-22 — Discover: "Ignore ping" option (SNMP-probe hosts that filter ICMP)

- **Added** — an opt-in "Ignore ping" option probes the whole range via SNMP for hosts that filter ICMP (an SNMP responder is measured proof of life); default off = unchanged. The deep TCP scan still runs only on hosts with a sign of life. Live-verified: a mgmt /24 went from 2 to all 7 devices.

## 2026-07-22 — Classifier taxonomy reconciled with the UI catalog (8 new types + L3 capability)

- **Added** — 8 new classifiable types with traceable votes (`ats`, `nvr`, `pbx`, `vpncon`, `consolesvr`, `projector`, `kvm`, `doorctrl`), plus additive `capabilities.l3` on multilayer switches; 11 additive golden cases freeze the new paths.
- **Fixed** — a KVM switch or an ATS is never classified `switch` anymore; SMB/NetBIOS signals no longer vote `pc` against a recognised NAS (they're confirmation on a device that already scored `nas`). Vendor-neutral throughout.

## 2026-07-21 — Audit 72ª follow-up: two deferred L2/L3 mediums + presence-doc accuracy

- **Fixed (L2/L3)** — trunk VLANs follow the port's own Port-channel (no more copying the first trunk Po's VLANs onto a link on a different Po); an FDB-inferred switch↔switch adjacency stays *"inferred · to confirm"*, never a confirmed `LAG` (only LLDP/CDP are trusted).
- **Docs** — "a plain Sync never turns anything red" corrected: the authoritative *switch access port down ≥ N syncs* signal needs no sweep, so a plain Sync *can* red a node once its down-streak matures; only a *merely silent* node stays grey.

## 2026-07-21 — Audit 72ª: 8 High + 15 Medium findings fixed (② no-invention + security)

Sixth multi-agent audit (6 domains, senior-engineer / architect lens): 7.8/10, **zero critical**. All 8 Highs were ② no-invention violations; the SNMP fixes are live-verified on real hardware (Zyxel GS1900, MikroTik, Synology).

- **Fixed — no-invention** — presence is never fabricated (no double-counted down-streak during a Verify, a persisted MAC counts only if the device answered this cycle, an infinite lease can't lose the dedup); two SNMP off-by-one twins of the 67ª fix (MAU physical-medium keyed by `ifIndex`, VTP trunk columns `.13/.14`); auto-link guardrails restored (endpoint links pass the transit-port filter, graduated confidence, no gateway/VRRP MAC written as an endpoint's identity).
- **Fixed — security** — SNMP secrets redacted for read-only viewers; the dev auth-bypass is fail-closed (loopback + non-prod only); baseline HTTP security headers (CSP, nosniff, `X-Frame-Options: DENY`, `Referrer-Policy`); the skin sanitizer closes the CSS `url()` / `expression()` / `@import` / `vbscript:` vectors.
- **Fixed — SNMP / discovery / drift** — a missing `ifOperStatus` is unknown, not "down" (no false red); LACP mode set only when genuinely operational (a static LAG no longer mislabelled "passive"); leases treated as an identity map, not liveness; exports colour floor nodes by presence, like the screen (a red = absent, grey = not verifiable).

## 2026-07-21 — Released DHCP lease as an opt-in "likely disconnected" hint

- **Added** — an opt-in toggle in the DHCP lease import panel treats a *released* lease as a weak "likely disconnected" hint in the drift report — but it stays **grey**, never red. Only from *released* state (never expiry), and any positive signal still wins.

## 2026-07-21 — ND discovery: green across subnets via the router's IPv6 neighbours

- **Added** — a router/switch's IPv6 Neighbor Discovery cache (`ipNetToPhysicalTable`, already walked on Sync) now feeds presence: a device *behind* a router is **green** because the ND cache proves it's a live neighbour — even IPv6-only or with an aged-out IPv4 ARP entry. Presence-only (it never feeds IP-change detection).

## 2026-07-20 — Honest presence: red only from proof, green across subnets

Principle: *"no answer" is not "dead"* — red must come from a signal a live host cannot suppress. Live-verified on a real network.

- **Changed** — red ("documented-but-absent") fires only from a **local ARP-miss** (an IP on the server's own segment that never appears in ARP after the ping) or a **switch access port down ≥ N syncs**. FDB ageing, filtered ICMP, a mute SNMP agent or an unreached subnet are now **grey ("not verified")**, never red; ARP-during-ping now counts as green.
- **Added** — green across subnets via the router's ARP table (`ipNetToMediaTable`, collected on Sync): SNMP on the backbone proves a device alive on its VLAN, no server ping needed.

## 2026-07-20 — Presence honesty on the floor + Sync result you can trust

- **Added** — floor nodes are **red** when confirmed absent and **grey** when not verifiable (rack devices keep their SNMP LED); IP-only devices (no documented MAC) are audited per-node; the Sync badge is persistent and honest (`ok/total · age`, no longer evaporating after 4 s); the sub-bar surfaces three states it used to hide — non-answering SNMP devices, unreached subnets, and ports documented differently from SNMP reality — plus a persistent auto-link result line.

## 2026-07-20 — Full networking audit + fix sprints (SNMP driver, L2/L3 engines, a11y)

Senior-network-engineer audit of the whole app (protocol correctness, L2/L3 semantics, physical model, UX); live-verified.

- **Fixed** — PoE classes read off-by-one (RFC 3621); ifStackTable LAG detection never returned rows (wrong OID column); one adjacency = one cable (no more double cable + phantom port); multihoming is not an IP change; infinite DHCP leases outrank expired history; a gateway set to the network/broadcast address is flagged; an ambiguous LLDP short-name no longer attaches to the first matching node at 0.97.
- **Added** — the dynamic report modals are real dialogs too — the M9 a11y work (role/aria-modal, focus trap, Escape) now covers the whole `.drift-overlay` family (Verify report, Change history, Adopt, L3 map, Free ports, WiFi tools).

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
