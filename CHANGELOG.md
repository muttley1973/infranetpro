# Changelog

What's new in InfraNet Pro. Format loosely based on [Keep a Changelog](https://keepachangelog.com/); dates are ISO-8601, newest first. One line per change — the reasoning behind each fix lives in the commit history.

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
