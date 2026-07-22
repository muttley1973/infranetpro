# Changelog

What's new in InfraNet Pro. Format loosely based on [Keep a Changelog](https://keepachangelog.com/); dates are ISO-8601, newest first. One line per change — the reasoning behind each fix lives in the commit history.

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
