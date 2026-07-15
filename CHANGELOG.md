# Changelog

What's new in InfraNet Pro. Format loosely based on [Keep a Changelog](https://keepachangelog.com/); dates are ISO‑8601. The full historical log lives in the [Roadmap](README.md#roadmap).

## 2026-07-15 — Topology accuracy: LAG uplinks + "cables not shown" hint

### Fixed
- **Aggregate (LAG) interface names no longer resolve to a physical port.** When a switch's FDB learns MACs on an aggregate interface (`LAG1` / `Po1` / `ae1` / `Eth-Trunk1` …), the port resolver's weak numeric fallback matched it to the physical port sharing the same number (e.g. `LAG1` → physical port 1). Result: devices behind an unmanaged switch on the aggregate uplink were wired to the wrong — often shut — port. An aggregate now resolves only to a port that *is* that LAG, or to its member ports (`lagId` / `lagGroup`); a MAC learned on a LAG interface is treated as transit (behind the uplink), never a direct attachment — regardless of MAC count. Vendor-neutral across all aggregate naming families. `lib/correlate.js`, `src/app-topology-discover.js`, `src/app-autolink.js`.

### Added
- **"Cables not shown" hint in the workspace sub-bar.** In the Topology view, an amber pill flags documented cables that don't appear because the rack they belong to isn't placed on the floor plan; clicking it places the rack(s) in one undoable step so the links appear. Pure engine `computeTopoHiddenCables` in `lib/subbar-stats.js`. `src/app-subbar.js`, `lib/i18n.js`, `styles/10-modern.css`.

## 2026-07-15 — Security & robustness hardening (post-audit sprint)

Follows a full read-only audit of the app. All gates green: 1440 unit tests / 0 fail, e2e 76/76, ESLint 0 errors, `tsc` 0.

### Security
- **Panel-skin importer stored-XSS closed.** The SVG sanitizer only stripped *quoted* `on*` handlers preceded by whitespace, so `onload=alert(1)` (unquoted), backtick handlers, slash-separated handlers (`id="x"/onmouseover=…`) and unclosed `<script>`/`<foreignObject>` survived — and executed when *any* user (including a read-only viewer) opened the Properties panel of a device using that skin. The sanitizer now strips handlers in every form plus orphan executable tags and unquoted `javascript:`/external refs. In addition, the skin **preview** and **rack render** now sanitize through a real DOM parse instead of injecting raw SVG markup — defence in depth that also cleans skins stored before this fix. `lib/panel-skin.js`, `src/app-panel-skin.js`.

### Fixed
- **Project list no longer 500s** on a legacy/hand-copied project JSON missing `updated_at` (the sort threw and took down the whole list). `server/projects-store.js`.
- **Express error handler added** — malformed or oversized request bodies, and any synchronous route throw, now return a clean JSON error instead of an HTML page leaking the stack trace and absolute server paths. `server.js`.
- **API tokens written atomically** — `api-tokens.json` (rewritten ~1/min to bump `lastUsedAt`) now uses the atomic write + `.bak` path, so a crash mid-write can no longer silently invalidate every API token. `server/api-tokens.js`.
- **AI chat no longer hangs** on a context-build error — context/prompt assembly moved inside the request `try` → clean 500 instead of a hung request. `server/routes/ai.js`.
- **LAG audit: a down member (speed 0) is treated as unknown**, not a distinct value — no more false "heterogeneous speeds 0M, 1G". `lib/lag-audit.js`.
- **L3 / IPAM audit read `ip || integration.host`** (uniform with the rest of the app) — an SNMP-only device whose IP lives in `integration.host` is no longer flagged as an orphan gateway, and its duplicate IPs are caught. `src/app-l3.js`.
- **Front-panel port labels stay consistent with the rendered block** when the two SFP counts exceed the port count. `lib/frontpanel.js`.
- **Apply-model clamps the device height to the rack** — applying a tall model (e.g. 50U) to a device in a smaller rack (e.g. 42U) no longer overflows the frame (the position silently collapsed to U1). `src/app-device-types.js`.
- **Manual-value dropdown resolver hardened** — the resolver that pre-selects a custom value in Properties dropdowns no longer fails *silently* if an inline handler signature changes (it now logs a clear warning) and supports an explicit `data-*` reference path. `src/app.js`.

### Changed / Performance
- **Apply-model surfaces truncated fibre ports** — for the ~86 extreme datacentre switches whose fibre banks exceed the 48-per-block panel cap, applying the model now reports how many ports aren't shown instead of dropping them silently. `src/app-device-types.js`.

### Hardening (low-severity batch, senior-reviewed)
- **Secrets are owner-only (`0o600`) and crash-safe.** `.session-secret` is written `0o600` with a load-time retrofit; `ai-config.json` (holds the BYO API key) and skin SVGs are written atomically (the shared `atomicWriteFile` gained an optional `mode` so the temp file is never briefly world-readable). `auth.js`, `server/ai-config.js`, `server/skins-store.js`, `server/projects-store.js`.
- **Login no longer leaks valid usernames via timing** — a dummy bcrypt compare (same cost) runs when the username is unknown, equalising response time. `auth.js`.
- **AI provider response capped at 8 MB** — a hostile/misconfigured endpoint can't exhaust server memory. `server/ai/provider.js`.
- **Cabling advice reach corrected** — the speed-vs-category message uses each category's real reach (Cat8 = 30 m for 25/40GBASE-T, not 100 m). `lib/cable-validate.js`.
- **2.5G/5G link speeds label correctly** (`2500` → `2.5G`, not `2500M`). `lib/hw-capabilities.js`.
- **IPAM utilisation clamped to 100 %** even if the network/broadcast addresses get documented by mistake. `lib/ipam.js`.
- **`.254` recognised as a likely gateway** alongside `.1` for the router-vote heuristic. `engine/fusion-scorer.js`.
- **HA active-passive validation reads legacy top-level `haMode`** (not only `spec.haMode`), so older projects still get the "max 1 active" check. `lib/ha-pair.js`.
- **UPS keyword matching tightened** — `backups`/`groups`/`startups` no longer misclassify as UPS, while `Back-UPS`/`SmartUPS`/`UPS-1500` still match. `src/app-discovery-classify.js`.
- **`GET /api/device-types` cached in-memory** (keyed on file mtime+size) instead of reading + parsing the ~1.4 MB catalog on every request — the event loop no longer stalls when the catalog is opened. `server/routes/device-types.js`.
- **The device-type `<datalist>` (~4,071 options) is built once at boot** instead of being regenerated on every Properties render, removing input latency when editing a device. `src/app-device-types.js`.

## 2026-07-14 — Fix: fibre ports mis-rendered as copper; SFP blocks split by type; cap 24→48

### Fixed
- **Fibre ports no longer render as copper.** For all-fibre / high-density switches the importer built a front panel whose *implied* copper (`ports − sfpCount − sfp2Count`) didn't match the real copper count, so the renderer drew phantom copper LEDs — e.g. **Aruba 6300M-24SFPP-4SFP56** showed *4 copper + 24 SFP* instead of *24× SFP+ (block 1) + 4× SFP56 (block 2), 0 copper*. `ports` is now capped in lock-step with the renderer's block clamp, so implied copper always equals real copper. This affected **~553 of 4,070** catalog models; a new invariant test asserts **zero** phantom copper across the whole catalog. `tools/import-device-types.js`, `test/device-types-native.test.js`.
- **SFP blocks now split by interface type, not just "QSFP/40G+".** SFP56 (50G), SFP28 (25G) and other higher-speed uplinks go to **SFP block 2** when they form a distinct group after the main SFP bank (previously lumped into block 1). Split happens at the first interface-type change in physical order.

### Changed
- **SFP block cap raised 24 → 48 per block** (`lib/frontpanel.js`, Properties UI, importer), so 48-port fibre banks (e.g. Juniper QFX5120-48Y: 48×SFP28 + 8×QSFP28) model in full instead of capping at 24. 86 extreme datacentre switches (96–128 ports) still cap at 48/block — shown, never mis-rendered as copper.

## 2026-07-14 — Device-type catalog expanded to 52 vendors (~4,100 models) with a network-role filter

### Added
- **The bundled catalog grows from 110 (MikroTik only) to 4,070 models across 52 vendors**, all from public-domain (CC0) device-type data; network infrastructure only (switch / router / AP / firewall / UPS-PDU / NAS / console-server). By role:
  - *Switch / router / AP*: Cisco, HPE/Aruba, Juniper, Arista, Extreme, Huawei, Nokia, Alcatel-Lucent, Brocade, LANCOM, Allied Telesis, Ubiquiti, MikroTik, TP-Link, Netgear, Zyxel, D-Link, FS, Ruckus, CommScope, Edgecore, TrendNet, EnGenius, ZTE, Ruijie, Raisecom, Tenda, Grandstream, Dell.
  - *Firewall*: Fortinet, Palo Alto, Check Point, SonicWall, Sophos, Stormshield, WatchGuard, Barracuda, OPNsense.
  - *UPS / PDU*: APC, Eaton, Raritan, Vertiv, CyberPower, Riello, Server Technology.
  - *NAS*: Synology, QNAP, NetApp. *Console / OOB*: WTI, Opengear, Avocent. *Camera/NVR*: Hikvision (network appliances only).
  - `data/device-types.json` (~1.3 MB; served compact via `GET /api/device-types`).
- **Importer gains recursive vendor discovery, `--vendors=`, and a `--roles` filter.** `tools/import-device-types.js` now walks `device-types/<Vendor>/*.yaml`, can restrict to named vendors, and (with `--roles`) keeps only network-infra roles — dropping endpoints (IP phones, workstations), servers/blades and accessories (PSUs, rack kits/trays/mounts, transceivers), with a transparent per-vendor *kept / dropped* report. Modular chassis (line cards in `module-bays`) and multi-vendor AP families (Catalyst 91xx, Aruba (I)AP, FortiAP, Ubiquiti air\*, TP-Link WA/CPE) are recognised and kept. The native catalog no longer depends on skin validity, so 0-data-port UPS/PDU/NAS keep their template (identity + rack height).

## 2026-07-14 — Apply real device models (native ports + front panel)

### Added
- **"Apply model" in device Properties → Port layout.** Search a real switch/router model and one click sets `ports` + `frontPanel` (SFP/QSFP/MGMT counts and numbering); the built-in renderer then draws the exact port faceplate — same LEDs, SFP/MGMT cages and numbers as any native device, because it *is* the native renderer. Catalog served from `data/device-types.json` via `GET /api/device-types`. New `src/app-device-types.js`, `server/routes/device-types.js`, `test/device-types-native.test.js`; wired via event delegation (no new `window.*` / inline handlers).
- **Device-type catalog generator.** `tools/import-device-types.js` turns public-domain (CC0) device-type YAML into native templates (`--catalog`) and, optionally, editable SVG panel skins (`--seed`). MikroTik models bundled to start; expanded to 20 vendors the same day (see the section above). Only the *data* is reused — the artwork is drawn from scratch, so ports stay live.

### Changed
- **SFP block cap raised from 8 to 24 per block** (`sfpCount` / `sfp2Count`), so high-density fibre switches (e.g. MikroTik CRS518, 16×SFP+ + 2×QSFP+) model correctly instead of clamping to 8. `lib/frontpanel.js`, Properties UI, importer, bundled catalog; golden baseline updated (SFP input `max` now `min(24, portCount)`).

## 2026-07-14 — draw.io cables: per-VLAN tables with click-to-highlight, A4/A3 auto page; PDF table-fit fix

### Added
- **Each VLAN cable layer gains a clickable cable table; clicking a row highlights that cable.** One row per cable (`DeviceA/port -> DeviceB/port`) as native `data:action/json` links that persistently thicken the chosen cable (radio-style, one at a time, amber flash + scroll); the header row resets. `lib/drawio-export.js`, `test/drawio-export.test.js`.
- **The draw.io page auto-fits paper size: A4 portrait by default, A3 when content doesn't fit.** Chosen per rack from real content bounds (height-driven; width always fits A4). `lib/drawio-export.js`.

### Changed
- **More generous cable spacing, and per-VLAN tables share one anchor to stay within A4 width.** The horizontal-stagger gets a guaranteed minimum gap and a larger max; the VLAN tables all sit at the same right-side anchor instead of side-by-side columns. `lib/drawio-export.js`.

### Fixed
- **The delivery-dossier cable-inventory table no longer overflows between columns.** Column fitting now measures real width via `doc.widthOfString` instead of an `fontSize × 0.5` estimate (also hardened a PDF-text test helper to slice streams by exact `/Length`). `server/pdf-report.js`, new `test/pdf-report.test.js`, `test/pdf-handoff.test.js`.

## 2026-07-13 — draw.io rack export: names outside the rack, per-VLAN cable layers, cleaner routing

### Added
- **The draw.io rack export gains an activatable cable layer, split per VLAN.** Intra-rack cables emitted as native mxGraph edges on initially-hidden per-VLAN layers, coloured by VLAN and bound to real port cells; routing uses per-cable vertical lanes plus vertical stagger to avoid overlaps. `lib/drawio-export.js`, `export.js`, `lib/i18n.js`, `test/drawio-export.test.js`.

### Changed
- **Device names moved outside the rack, freeing the device face for its interfaces.** The name is now a separate `text` cell right of the cabinet (white on a dark label background); the port layout is byte-for-byte unchanged.
- **The left SNMP status stripe is no longer exported.** It is a live indicator; a `.drawio` file is a static snapshot, so it stays in the live rack view only.

## 2026-07-12 — draw.io (diagrams.net) rack export

### Added
- **Export any rack to a native, editable draw.io (`.drawio`) diagram.** New "Export to draw.io" writes mxGraph XML, one page per rack, rebuilt as real `mxCell`s (rack container + per-U devices + status-coloured port cells), fully editable in diagrams.net; custom device skins embed as a background image with real port positions recovered via `getBBox`. New pure `lib/drawio-export.js` (`buildDrawioXml`, unit-tested) + `exportDrawio()` glue in `export.js`, menu wired via `addEventListener`. `lib/drawio-export.js`, `test/drawio-export.test.js`, `export.js`, …

## 2026-07-12 — Property panels hardened (floor-render divergence, NAS/server defaults, SNMP field guards, LAG steal)

### Fixed
- **The two floor-plan renderers had drifted, so a partial re-render lost node decorations.** `_renderAllNow` and `_renderFloorNow` now emit identical floor-node markup (absent graying, v3 badge, `topo-endpoint`). `src/app-render-core.js`.
- **A newly-added NAS defaulted to RAID 1 instead of RAID 5.** The `||'raid5'` default now sits on the raid5 `<option>`. `src/app-properties-node-devices.js` (golden regenerated).
- **A diskless / boot-from-SAN server (0 TB local storage) re-rendered as 2 TB.** The storage field changed from `||2` to nullish `?? 2` on the `min="0"` input. `src/app-properties-node-devices.js`.
- **Stealing a port into a new LAG could orphan its old LAG at a single member.** `confirmLag` now dissolves any old group that drops below two members. `src/app-ports.js`.
- **Clearing the SNMP UDP-port or timeout field stored 0 and broke the next poll.** The handlers now fall back to the default (`||161` / `||3`). `src/app-properties-node.js`.
- **The SNMP error-status card could show "Invalid Date".** The error branch now guards a missing `lastPoll` to `—`. `src/app-properties-node.js`.

### Changed
- **The two floor-plan renderers now share one `_buildFloorNodeEl` helper, so they can no longer drift.** Removes the duplicated node-building logic; byte-identical markup, net −26 lines. `src/app-render-core.js`.

### Fixed
- **A device serving an over-sized HTTP/SOAP body could hang the whole discovery sweep.** The Cast/UPnP/ONVIF probes now settle their promise explicitly at the `req.destroy()` site (a bare `req.destroy()` emits no `end`/`timeout`/`error`). `server/netscan.js`.
- **The topology-crawl SSE handler could leak the connection and raise an unhandled rejection.** The whole crawl body now runs under one `try/catch/finally` that always emits an error event and closes the stream; `server/crawl-bfs.js` also wraps the injected `emit`. `server/routes/discovery.js`.
- **A device reachable from two switches at the same depth was probed (and listed) twice.** The BFS level is now deduped globally by IP. `server/crawl-bfs.js`.
- **`/api/discover` silently skipped all SNMP for an unknown driver.** It now rejects an unknown driver like `/api/crawl` and `/api/poll`.
- **`/api/reachability` returned zero results if a single probe rejected.** Each host is now wrapped in its own catch.
- **The `192.168.x.y-z` range form did not validate its first three octets.** Base octets ≤ 255 are now checked. `server/netscan.js`.
- **A hostile mDNS packet could be a decompression-amplification (DoS) vector.** Decoded names are now capped at the RFC-1035 255-octet limit. `lib/discovery-mdns.js`.
- **Smaller correctness/robustness fixes:** NBSTAT/reverse-DNS timeouts cleared on the fast path; `_onvifGetDeviceInfo` uses `Buffer.byteLength`; `loadDriver` logs a `require()` failure; ping-sweep/mDNS loops use a `Map` instead of O(n²) `find()`. `server/netscan.js`, `server/routes/discovery.js`, … *(Two `server/classify.js` scoring issues were found and reported but left unchanged, as they alter the pipeline.)*

## 2026-07-12 — Selectors, checkboxes and the two file pickers move to event delegation

### Changed
- **Five static form controls dropped inline `onchange` for delegation — project/rack selectors and three checkboxes.** `switchProject`/`switchRack`/`discSelectAll`/`tdSelectAll`/`_saveDeepScanPref` now use `data-change`; 10 inline `onchange` → 5. `src/app-core.js`, …, `netmapper.html`.
- **The map-image and JSON-import file pickers followed.** `handleMapUpload`/`importJSON` moved to `data-change`, off `window`; 3 inline `onchange` left (all in `export.js`). `src/app.js`, `src/app-search-zoom-rack.js`, `netmapper.html`.
- **The delegation harness grew to five event types, and the global search box came off the bridge.** Added delegated `focus` (as `focusin`) and `keydown`; the search box uses `data-input`/`data-focus`/`data-keydown`. `src/app-delegation.js`, `src/app-search-zoom-rack.js`, `netmapper.html`.
- **Delegation reaches dynamic templates — cluster 1: Discover table rows + search-results dropdown.** `_discOnRowToggle`/`_discOnTypeChange`/`selectSearchResult` moved to `data-*` markers. `src/app-discovery.js`, `src/app-search-zoom-rack.js`.
- **Second dynamic cluster: the Drift report panel's one-click actions.** Its seven local actions moved to `data-act`/`data-change` (`drift-*`), with key/CIDR in `data-*`. `src/app-drift.js`.
- **The Drift panel's "Explain with the assistant" button moved to delegation too.** `aiExplainDrift` became the assistant module's first ESM export. `src/app-ai.js`, `src/app-drift.js`.
- **Fourth dynamic cluster: the "Add to map" (Adopt) modal.** Its three local actions moved to `adopt-*` markers. `src/app-drift-adopt.js`.
- **Third dynamic cluster: the three report overlays (Audit log, Spare ports, L3 map).** All nine local actions moved to delegation. `src/app-audit.js`, `src/app-spare.js`, `src/app-l3.js`.
- **Fifth cluster: the whole "Users & access" / "Change password" modal — and a latent bug fixed.** Twelve functions off `window`; `openUserManager` becoming an ESM export fixed the admin "AI settings" entry that switched the modal's tab without ever opening it. `src/app-auth.js`, `src/app-ai.js`, `netmapper.html`.
- **Sixth cluster: three topology/management modals.** The management-protocols editor, the topology-crawl modal and the hover-tooltip migrated (eleven functions off `window`); backdrop guards preserved via `ev.target === el`. `src/app-management.js`, `src/app-topology-crawl.js`, …

## 2026-07-11 — The assistant's command catalog is complete again, and more toolbar wiring moves to event delegation

### Fixed
- **Loading a project with non-canonical device IDs silently broke its LAGs.** The `lag-<deviceId>-poN` port reference and the LAG-map key now go through one shared `remapLagId` helper, so they stay aligned. `src/app.js` (+1 regression test).
- **The AI assistant's on-screen command catalog was losing entries as buttons migrated off inline handlers.** `extractCatalog` now falls back to `data-act` as the citable action. `lib/ui-catalog.js` (+1 unit test).

### Changed
- **The static header menus and toolbar buttons now dispatch through event delegation.** The account/Report menus and New/Rename/Duplicate/Delete/Save use `data-act`, off `window`. `src/app-auth.js`, …, `netmapper.html`.
- **The AI assistant's buttons moved to delegation, and the harness now also handles `change` and `input`.** Six assistant controls to `data-act`; the rack-size field (`change`) and palette search (`input`) are the first non-click proofs. `src/app-delegation.js`, `src/app-ai.js`, …
- **The CSV and DHCP import dialogs' change/input controls moved to delegation too.** Five handlers (`loadCsvFile`/`previewCsv`/`loadDhcpFile`/`previewDhcp`/`updateDhcpVendorFields`) off `window`. `src/app-csv-import.js`, `src/app-dhcp-import.js`, `netmapper.html`.

## 2026-07-09 — Discover names Windows PCs, and Stealth mode randomizes its scan order

### Added
- **Windows PCs finally get a name in Discover.** Resolved via a direct NBSTAT (NetBIOS node-status) query over UDP 137 per alive nameless host (~40 ms), avoiding the slow multi-NIC `nbtstat` CLI (kept as a Windows-only fallback); runs on Normal/Safe only, local host named from `os.hostname()`. `server/routes/discovery.js`, `lib/i18n.js`.

### Changed
- **Stealth mode now randomizes the scan order — a sequential sweep is itself a scan signature.** Fisher-Yates shuffle on both the ping sweep and the SNMP/enrichment phase; new pure `_shuffled` in `server/netscan.js`. Normal/Safe unchanged. `server/routes/discovery.js`.

## 2026-07-09 — The Verifica report stops repeating itself, and the asset register lists assets (not the cabling)

### Changed
- **"Non verificabili" is folded into the "Reti del progetto" section, under the subnet it belongs to.** Each `/24` now carries a presence badge (verified / not reached) and nests its non-verifiable devices with their ignore/investigate/explain actions. New pure `annotateNetworksVerification` in `lib/project-networks.js`; `lib/drift-report.js` exposes `sweepRan`+`observedSubnets`. `src/app-drift.js`, …
- **The PDF asset register lists IT assets, not the structural cabling.** Wall ports and electrical panels are excluded by a vendor-neutral class (`isFloor && isPassive && !hasIP`); patch panels and UPS/PDU/ATS stay. `lib/api-shape.js`, `server/routes/export.js`.
- **Discover dialog and Contesto progetto panel — UI consistency.** The Cadenza dropdown matches the surrounding dark fields; the Contesto progetto title is uppercased (cosmetic, DOM text unchanged). `styles/07-modals.css`, `src/app-properties.js`, …

## 2026-07-08 — Closed-port devices finally identify themselves: mDNS + SSDP + ONVIF discovery

### Added
- **An opt-in mDNS/SSDP listen pass makes the "silent" devices name themselves — phones, tablets, smart TVs and appliances.** One mDNS query + one SSDP M-SEARCH read the advertised service back as a MEASURED, vendor-neutral device type:
  - `_googlecast`/`_airplay`/`MediaRenderer`/Roku/DIAL/Fire TV → **tv**; `_ipp`/`_printer` → **printer**; `_hap`/`_matter`/Hue/ESPHome → **iot**; `_apple-mobdev2` → **mobile**; `InternetGatewayDevice` → **router**; `MediaServer` → **nas**.
  - The announced model/manufacturer (mDNS TXT + UPnP description) feed brand/model recognition; the query sets the QU bit so replies arrive even when UDP 5353 is already held (common on Windows).
  - A device that ignores ping but announces via multicast is now discovered (marked present).
  - **IP cameras / NVRs via ONVIF WS-Discovery.** A Probe on `239.255.255.250:3702`; only trusted with a real `onvif://` scope (Windows/printers also answer WSD); Bonjour `_device-info` icon placeholders treated as generic.
  - **Exact model, where exposed.** ONVIF GetDeviceInformation prefers the commercial `Model`; SNMP discovery also reads ENTITY-MIB `entPhysicalModelName`.
- **Readable device names in Discover.** The Name column shows the hostname, else the cleaned model, else the IP — never an opaque mDNS UUID; a UPnP `friendlyName` seeds the hostname once, cleaned, and is never re-exposed.
- **Honest scoping and safety.** Multicast is link-local (same subnet only); the announced type is a candidate weighted below SNMP/banner; opt-in and off by default; the UPnP fetch is constrained to the responding IP (no SSRF) and the parsers are bounded. New pure `lib/discovery-mdns.js`; `_mdnsSsdpSweep` in `server/netscan.js`; additive vote in `engine/fusion-scorer.js`.

## 2026-07-08 — One classifier, for real: the duplicate "legacy twin" is gone

### Changed
- **The device classifier is now a single implementation.** The duplicate `_classifyDiscoveredDeviceLegacy` (~190 lines) is removed now that the 55-device golden freezes the engine; its 21 parity rows are preserved as a golden-style freeze. Byte-identical classification. `server/classify.js`, `tests/fusion-scorer.test.js`.

## 2026-07-07 — One classifier of record: the client stops re-typing, one shared regex table, and 40+ more vendors recognized by SNMP

### Changed
- **Discovery gets a single authoritative classifier, one shared pattern table, and 40+ more SNMP-recognized vendors.** Three linked changes:
  - **The client defers to the server class whenever the server produced one.** The thin `_guessType` runs only as a last-resort fallback; the TV/printer-before-switch ordering bug is fixed in both fallback and server. Manual overrides still win.
  - **One shared regex table.** The ~28 type-patterns move to a single `lib/device-patterns.js`; new `tests/classify-golden.test.js` (55 devices) proves the extraction changed nothing.
  - **40+ more vendors recognized from sysObjectID.** `lib/device-signatures.js` gains netdisco/SNMP::Info (BSD-3) enterprise→role facts covering plugin-less firewalls, WLCs, APs, switches and routers; weighted below a model banner; a new vendor-neutral WLAN-controller detector; type names cross-walked to the Nmap vocabulary (internal keys unchanged).
- Validated by the golden + legacy↔fusion parity + a headless corpus. `src/app-discovery.js`, `engine/fusion-scorer.js`, `lib/device-patterns.js` (new), `lib/device-signatures.js`, …

## 2026-07-07 — The MAC vendor stops deciding the device type: switches, phones/tablets and Cast media now classify correctly

### Changed
- **Four vendor-neutral rules, from a live scan of a real home LAN, close the last gaps with zero per-vendor code.** The anti-pattern was always a MAC-vendor identity signal outranking a measured one:
  - **(1) The OUI device-type is demoted to the identity tier (~45).** Any measured signal now wins; fixes the whole Zyxel/D-Link/Netgear/TP-Link→router class at once, no plugin edited.
  - **(2) Google Cast is detected as a protocol, not a brand.** A `/setup/eureka_info` probe + Cast ports 8008/8009 → any Cast device → `tv`.
  - **(3) Phones and tablets classify as `mobile`, decided by the OS not the brand.** The OS fingerprint now emits `mobile` for Android/iOS; Android-TV/Cast stay `tv`, a Mac stays `pc`.
  - **(4) Confidence is capped when nothing was measured.** A MAC/OUI-only guess is never near-certain; any measured signal uncaps it.
- **Three more, from the multivendor lab (`10.10.99.0/24`):**
  - **(5) `sysServices` L2+L3 = a multilayer switch, not a router.** Pure L3 → router, L2+L3 → switch.
  - **(6) A WLAN controller is a `wlanctrl`, not a switch.** A vendor-neutral WLC signal + the Cisco sysObjectID plugin's controller case now emit `wlanctrl`.
  - **(7) Cisco "IOS" is not Apple "iOS".** The OS `ios` token is now guarded against network-OS keywords.
  - **Two vendors gained sysObjectID plugins:** new `plugins/arista.js` (PEN 30065) and the completed `plugins/cisco.js`; an SNMP class confirmed by sysServices is now high-confidence on its own merit.
- Mirrored in the legacy classifier; validated live on the real LAN and the lab, every already-correct device unchanged. `engine/fusion-scorer.js`, `server/classify.js`, `plugins/os-fingerprint.js`, … *(no `plugins/oui/*` vendor file touched)*.

## 2026-07-07 — Discovery trusts one classifier + a Windows host is no longer mistyped by its NIC vendor

### Changed
- **Discover defers to the server classifier, and a file-sharing Windows host is typed a computer even when its MAC vendor says "printer".** Three gaps from a live scan: **(1)** the client now trusts the server class whenever it found a real signal (`_guessType` only a genuine-gap net); **(2)** deep-scan NetBIOS suffix codes now feed classification (`<1B>/<1C>`→server, `<20>`→server, else pc — mostly legacy, NetBT off by default on modern Windows); **(3)** SMB is the modern signal — port 445 + shares + no print ports → `pc`, beating the OUI inference. Mirrored in the legacy classifier. `src/app-discovery.js`, `engine/fusion-scorer.js`, `server/classify.js`.

## 2026-07-07 — Device type is no longer decided by the vendor's company name (classification precision)

### Fixed
- **Discovery mis-typed devices by words inside their vendor's company name.** After the full IANA PEN registry landed, a "Gateway Inc." PC became a router and an org named "SWITCH" a switch, at high confidence. Three changes (identity and type are separate axes, per nmap/Fingerbank/netdisco): **(1)** the type-nouns `gateway|switch|router|firewall` are stripped from the vendor string before type-matching (brand tokens still vote); **(2)** the low-confidence fallback reads measured `sysServices` OSI bits instead of guessing "switch"; **(3)** a contradiction discount lowers confidence when a competing type scores close. Mirrored in the legacy classifier; a pre-existing regression from `948ad0e`. `engine/fusion-scorer.js`, `server/classify.js`.

## 2026-07-07 — "Project networks": the Verifica report now derives your subnets and says what to do

### Added
- **The Verifica report derives your subnets and tells you, per subnet, whether topology is reconstructable — and lets you act.** A "Project networks" section (from documented devices + imported DHCP leases) lists each `/24` as **covered** / **blocked** (SNMP switch not answering, its IP named) / **open**, each with a "Discover network" button that opens Discover pre-filled with that CIDR (manual, your chosen cadence). New pure `lib/project-networks.js` (`deriveProjectNetworks`, +7 tests). `src/app-drift.js`, `src/app-discovery.js`, …

## 2026-07-07 — Presence audit no longer greys a whole subnet it never observed (multi-fabric)

### Fixed
- **After a Sync, every device on a subnet the SNMP fabric can't see at L2 was greyed out as "absent".** The audit treated any populated FDB as proof it could see MACs on all VLANs; it now scopes FDB coverage to the subnets the bridge FDB actually spans (`fdbSubnets`), greying a device absent only if its subnet was genuinely observed, else marking it **unverified**. Back-compatible (single-fabric unchanged). `lib/drift-snapshot.js`, `lib/drift-report.js` (+4 tests).

## 2026-07-07 — Sync no longer stalls on a single slow/half-answering SNMP device

### Fixed
- **One unresponsive SNMP device could make a whole-project Sync appear to hang.** Three vendor-neutral fixes: **(1)** the SNMP walk honours a wall-clock deadline and returns partial data (derived from the timeout, override `SNMP_WALK_DEADLINE_MS`; 70.7 s → ~18 s measured); **(2)** the Sync's topology phase issues `/api/topology` in parallel batches of 5 with an AbortController timeout; **(3)** `pollAllSNMP` runs inside `try/finally` so the sync flag and buttons always reset. `drivers/snmp.js` (+4 tests), `src/app-autolink.js`, `src/app-snmp.js`.

## 2026-07-07 — Optional stealth (anti-IDS) pacing for the base subnet sweep

### Added
- **A stealth mode for the subnet scan that stays under an IDS's radar.** Opt-in (`stealth: true` / `scanDelay`), it serialises the sweep (concurrency 1) and spaces each probe by a jittered delay (~400 ms ±30%); applies only to the unknown-IP sweep, not the authenticated deep poll. New pure `_stealthDelayMs` in `server/netscan.js` (+4 tests); exposed as a 3-level Cadence selector (Normal/Safe/Stealth). `server/routes/discovery.js`, …

## 2026-07-07 — Topology crawl polls devices in parallel (IDS-aware), same result

### Changed
- **The LLDP/CDP topology crawl polled one device at a time.** It now runs as a level-synchronised BFS with a bounded worker pool (`server/crawl-bfs.js`, extracted + unit-tested): same-depth devices are probed concurrently, then results are processed in deterministic IP order, so `pool=1` and `pool=N` give identical output; deep phase only, base sweep stays sequential/paced. `CRAWL_POOL` default 4 (1-32); ~1.3-4x faster. `server/crawl-bfs.js` (+11 tests), `server/routes/discovery.js`.

## 2026-07-07 — Topology overlay render batched (no layout thrashing), no output change

### Changed
- **Drawing the topology overlay caused heavy layout thrashing on large networks.** The render now builds the SVG in a DocumentFragment appended once (so `offsetWidth` reads no longer force a per-line reflow) and uses an O(1) id→tile index instead of two `querySelector` per line. Byte-identical output; 724 ms → 7 ms on 1200 lines. `src/app-topology-overlay.js`, `src/app-popup.js`.

## 2026-07-07 — Topology build is up to ~28x faster on large networks (no output change)

### Changed
- **Building the topology overlay was O(n^3) and slow on large networks.** `buildTopoLines` now uses O(1) index maps (`nodeById`/`rackById`/`linkById`) plus a per-rack node index, instead of linear scans inside its loops. Byte-identical output; 1920 nodes 4066 → 145 ms (~28x). `lib/topo-lines.js`.

## 2026-07-07 — Topology crawl is faster: SNMP walk retry scoped to the FDB, default lowered

### Changed
- **The topology crawl got slower after the adaptive walk-retry fix — reined back in without losing the macsuck cure.** **(1)** the retry is now restricted to the FDB group (`FDB_RETRY_BASES`) so LLDP/CDP/ARP fail fast; **(2)** the default retry is lowered from 2 to 1; also fixes `SNMP_WALK_RETRIES=0` not disabling retries (the old `|| 2`). Tunable via `SNMP_WALK_RETRIES`/`SNMP_WALK_CONCURRENCY`. `drivers/snmp.js` (+3 tests).

## 2026-07-06 — Device MAC shown for SNMP infrastructure in the Properties panel

### Fixed
- **The MAC field in Properties was empty for switches, routers and firewalls.** SNMP infrastructure carries no device-level MAC, so the panel now shows a representative port MAC (lowest numeric suffix ≈ chassis) with a tooltip; display-only, `node.mac` is never written. `src/app-properties.js`, `lib/i18n.js`.

## 2026-07-06 — A WLAN controller no longer counts as a Wi-Fi radio device

### Fixed
- **The `WLAN Controller` type was flagged as Wi-Fi-serving (`wifiServe`), which is physically wrong.** A WLC has no radios (the APs broadcast the SSIDs); removed `wifiServe` from `wlanctrl` so the data model matches the UI (the Wi-Fi section was already hidden). `src/app-types.js` (comment in `src/app-wifi.js`).

## 2026-07-06 — Asset register: MAC column now covers SNMP infrastructure

### Fixed
- **The MAC column of the PDF asset register was empty for switches, routers and controllers.** It now falls back to a representative port MAC (lowest numeric suffix); measured and report-only (the shared REST API DTO keeps the strict device-level MAC). New pure `applyPortMacFallback(devices, ports)` in `lib/api-shape.js`, `server/routes/export.js`.

## 2026-07-05 — The "Floor plan context" panel is now "Project context"

### Changed
- **The right-hand context panel was renamed "Floor plan context" → "Project context" (it: "Contesto planimetria" → "Contesto progetto").** It holds project-level settings; label only, both languages, no behaviour change. `lib/i18n.js` (`floor.title`).

## 2026-07-05 — Audit-ready asset register in the PDF report, and the whole report goes bilingual

### Added
- **Per-device asset register in the PDF report.** A table (name, type, brand, model, serial, IP, MAC, VLAN, rack/U) built server-side from the same allowlist DTO as the REST API (`projectToDevices`→`nodeToDevice`, `lib/api-shape.js`), so secrets are structurally excluded; opt-in checkbox + included in the delivery dossier. `server/pdf-report.js`, `server/routes/export.js`.
- **"Last revised" timestamp on the report cover.** Shows the project's `updated_at`, read server-side by `projectId`. `server/routes/export.js`, `server/pdf-report.js`.

### Changed
- **The PDF report is now bilingual (it / en).** Every title/header/label follows the UI language via a local it/en table in `server/pdf-report.js`, flowing from the client via `/api/export-pdf` (default Italian); dates localised, technical terms unchanged, action labels translated (`auditActionLabel`, `lib/audit-log.js`).

### Notes
- Historical audit **values** in the change-history page are shown in the language they were recorded in (frozen records, not rewritten).

## 2026-07-04 — Security hardening: AI key file locked down, dead-route path leak closed

### Security
- **The stored AI provider key is now written owner-only (`0o600`).** `data/ai-config.json`; `setConfig` re-applies the mode on every overwrite and an existing loose file is tightened at startup (best-effort on non-POSIX). `server/ai-config.js`, `test/ai-config.test.js`.
- **A dead `/app.js` route no longer leaks the server's absolute path.** The route (which `sendFile`'d a missing file, exposing the path via Express's ENOENT page) is removed; it now falls through to the `{"error":"Not found"}` catch-all. `server.js`, `test/static-routes.test.js`.

### Fixed
- **The e2e test harness now isolates the API-token and user stores.** `test/e2e/helpers/server.js` also points `INFRANET_API_TOKENS_FILE`/`INFRANET_USERS_FILE` into the temp dir. Test-only.

## 2026-07-04 — macsuck no longer drops port badges under crawl load (adaptive SNMP walk retry)

### Fixed
- **macsuck occasionally returned zero port locations during a topology crawl.** A switch under concurrent-walk pressure drops a GETBULK and truncates the FDB; SNMP walks now retry a timed-out walk with `max-repetitions` halved (25→12→6) plus backoff (netdisco's strategy), so slow devices degrade in speed not failure. Tunable via `SNMP_WALK_RETRIES` (default 2). `drivers/snmp.js`.

## 2026-07-04 — Vendor recognition backed by the full IANA + IEEE registries

### Added
- **The full IANA Private Enterprise Numbers registry is now a bundled, refreshable vendor source.** `data/pen-db.json` (~66k orgs, `npm run update-pen`); `_vendorByObjectId` resolves the sysObjectID enterprise number against it — the SNMP twin of the IEEE OUI DB. A curated `PEN_VENDOR` table still wins for clean short names. `scripts/update-pen-db.js`, `server/classify.js`.

### Fixed
- **Arista devices now show their vendor.** Resolves to Arista via PEN 30065 (its virtual MAC has no IEEE OUI), and `arista` in `sysDescr` classifies as a switch. Validated live against a lab Arista. `server/classify.js`.

## 2026-07-04 — Duplicate phantoms collapsed, and patient web fingerprinting in deep-scan

### Fixed
- **Two ARP-cache rows for the same device no longer show as two phantoms.** The demote now also handles the same MAC on ≥2 ARP-only rows with no strong anchor (a device mid DHCP-renewal); keeps one representative (highest IP), demotes the rest to *Inactive*. `server/netscan.js` (`_demoteStaleArpDup`+`_ipToNum`).

### Changed
- **Slow embedded web servers get a patient re-probe — in deep-scan only, so the everyday scan stays fast.** When deep-scan is on, rows still missing an HTTP title are re-probed with more patience (900/1200 ms) in parallel with the NetBIOS/SMB/TCP fingerprint; the fast path is unchanged. `server/routes/discovery.js`.

## 2026-07-04 — No more phantom low-confidence IPs in Scopri, and a live crawl heartbeat

### Fixed
- **Phantom low-confidence "observed" IPs no longer clutter Scopri.** Two sources closed:
  - **ARP-SNMP is now off-segment only.** `buildArpCandidates` skips on-segment IPs (the local sweep is authoritative there); a `/24` scan went 7 phantoms → 0. `lib/correlate.js`, `server/routes/discovery.js`.
  - **Local ARP read is now state-aware (Windows).** `_readArpMap` uses `netsh interface ipv4 show neighbors`, keeping only entries that resolve to a MAC (no localized-string matching); plus a stale-duplicate demote to *Inactive*. `server/netscan.js`, `server/routes/discovery.js`.

### Added
- **Live crawl heartbeat.** The Scansiona button now shows "Expanding…" with a live progress line (the device being probed + how many located on a port). `src/app-discovery.js`, i18n.

## 2026-07-04 — DHCP leases become a discovery source, and Scopri locates devices on their switch port

### Added
- **Imported DHCP leases are now a first-class discovery source.** Every leased IP in the scanned subnet the sweep missed is added as a candidate (IP+MAC+hostname+OUI), shown observed / not pre-selected; works with zero SNMP; adds a `dhcp` evidence to the scorer. `server/routes/discovery.js`, `server/classify.js`, `src/app-discovery.js`.
- **macsuck — the topology crawl locates each discovered MAC on its switch access port.** Uses the collected FDB to show a location badge: a direct edge (few MACs on the port) or "behind *port*" (many non-LAG MACs); a MAC seen only on a busy LAG uplink is left unplaced; standard BRIDGE-MIB/Q-BRIDGE-MIB, validated on a Zyxel GS1900. `lib/correlate.js`, `src/app-discovery.js`.
- **Note on hardware support** — macsuck needs a switch that exposes its FDB over SNMP; the lab's Cisco vIOS images don't, so it's covered by unit tests + real hardware instead.

## 2026-07-04 — Faster subnet scan, cleaner Scopri table, and a vendor for BYOD devices

### Changed
- **The subnet scan is faster and no longer times out on a full `/24`.** The ping-sweep sends a single ICMP probe by default (the retry doubled the time on dead IPs), with ARP as the authoritative liveness (an ARP answer = alive even if ICMP is lost); the spaced retry stays opt-in (`pingRetries` 1-4); ~3× faster on dead IPs. `server/routes/discovery.js`.
- **The Scopri table has fixed columns and tidier badges.** Fixed column layout, single-line MAC, ellipsized vendors, non-wrapping destination icon; "SNMPv3 to configure" shortened to "v3". `netmapper.html`, `styles/07-modals.css`, `src/app-discovery.js`.
- **The properties panel is no longer rebuilt while it's hidden.** No per-VLAN IPAM scan behind a hidden panel, and IPAM lookups memoized per render frame. `src/app-render-core.js`, `src/app.js`.

### Added
- **BYOD devices show a vendor even when the MAC hides it.** Derives the brand from the announced mDNS/DHCP name (`iPhone-di-…`→Apple, `Galaxy-S23`→Samsung…), else an honest "Private · random MAC" label. `server/classify.js`, `src/app-discovery.js`, i18n.

### Fixed
- **Ping-only phantom IPs are no longer pre-selected for import.** A row is pre-checked only if its confidence clears 15% (a ping-only reply scores far below any real device); the phantoms stay visible but out of the default import. `src/app-discovery.js`.
- **The same host is no longer proposed twice in Scopri.** The crawl's de-dup set now includes every swept IP, and MACs are normalized to canonical uppercase across all sources. `src/app-discovery.js`.
- **A remote host no longer inherits the gateway's device type, and the New/Update badges tell the truth.** The next-hop-MAC guard now also runs on the preview/render path, and a blocked MAC is treated as absent throughout the match. `src/app-discovery-classify.js`.

## 2026-07-03 — Discovery finds off-segment hosts from the switches' SNMP ARP table

### Added
- **The LLDP/CDP expansion also proposes hosts seen in the switches' SNMP ARP table.** Reads each reachable switch/router's `ipNetToMediaTable` to surface off-segment hosts (IP+MAC, no ping), bounded to the scanned subnet, shown observed / low-confidence with an "ARP (via *switch*)" badge; a matching DHCP lease raises confidence. Rides the existing "Expand via LLDP/CDP". `lib/correlate.js`, `server/routes/discovery.js`, `src/app-discovery.js`.

## 2026-07-03 — No false SNMPv3 label on a PC/VPCS, and a crawled device keeps its vendor

### Fixed
- **A live host that speaks no SNMP is no longer mislabeled "SNMPv3 (to configure)".** Detection now requires a genuine USM remote engineID (which only a real v3 agent produces), not any non-timeout error; no vendor/library prefix hardcoded. `drivers/snmp.js` (+test).
- **A device discovered via LLDP/CDP crawl keeps its resolved vendor.** A leftover `vendor:''` in the crawl-merge that overwrote the sysObjectID-derived vendor after the spread is removed. `src/app-discovery.js` (+test).
- **The ping-sweep retry is now spaced.** ~200 ms between attempts so a burst-loss retry lands outside the loss window; only a first-try miss pays the wait. `server/netscan.js` (+test).

## 2026-07-03 — The subnet scan retries the ping, so a device that drops the first packet isn't missed

### Fixed
- **The discovery ping-sweep (and the reachability audit) retry the ping instead of trusting a single packet.** Retries up to N (default 2; `pingRetries` 1-4), alive if any attempt answers; only genuinely dead IPs pay the extra pings. `server/netscan.js`, `server/routes/discovery.js` (+test).

## 2026-07-03 — A documented port is aligned to its real interface name using the LLDP/CDP neighbor

### Added
- **When LLDP/CDP confirms a documented cable's neighbor on a real interface, that ifName is backfilled onto your hand-numbered port.** Only fills an empty ifName, only on an unambiguous single cable; from then on every Sync matches that port by name (its live status becomes authoritative), which stops the stale-status and false ghost-cable symptoms at the source. Vendor-neutral. `src/app-autolink.js` (+test).

## 2026-07-03 — Access VLAN read from `vmVlan` when the standard PVID is blank, and a manual VLAN is never clobbered by the default

### Fixed
- **The access VLAN is read from `vmVlan` (CISCO-VLAN-MEMBERSHIP-MIB) when the standard `dot1qPvid` doesn't carry it.** Used only where PVID is missing/1 and `vmVlan` gives a real VLAN (>1); vendor-neutral (empty subtree on non-Cisco). `drivers/snmp.js` (+test).
- **An SNMP read of VLAN 1 no longer overwrites a hand-documented non-default VLAN.** A real VLAN (>1) from SNMP still updates the document; any vendor. `src/app-snmp.js` (+test).

## 2026-07-03 — Ghost-cable check ignores hand-cabled ports without an ifName

### Fixed
- **A hand-cabled port without an ifName no longer feeds the "ghost cable" streak.** Only SNMP-mapped ports (with an ifName) have reliable per-port status, so a manual port's possibly-stale status must not accumulate a down-streak; detection stays fully active for ifName-mapped ports. `src/app-drift.js` (+test).

## 2026-07-03 — Reconcile warning only fires on a genuine access-vs-trunk mismatch

### Fixed
- **The "port to reconcile" warning no longer flags a manual port already documented as trunk/LAG.** It now fires only on a genuine access-vs-trunk mismatch (not on hand-cabled LAG members that legitimately line up with a trunk); warnings dropped 8→2 on the lab. `src/app-snmp.js` (+test).

## 2026-07-03 — Modals moved out of `<header>`, and the browser can no longer serve a stale UI

### Fixed
- **The 10 tool modals now live in a `#modal-root` at the end of `<body>`, not inside `<header>`.** So no header effect (glass/blur/transform) can make the header a containing block and clip a `position:fixed` overlay; a pure markup move (overlays still open/close by id). `netmapper.html`.
- **The frontend assets are served with `Cache-Control: no-cache`.** HTML, CSS, the esbuild bundle and `lib/*.js` now revalidate before reuse (a cheap 304 when unchanged), ending the "I fixed it but the browser shows the old version" class; Font Awesome fonts stay cacheable. `server.js`.

## 2026-07-03 — Discovery: SNMP ports mapped by ifName, plus a "reconcile" warning (from live multivendor validation)

### Fixed
- **SNMP interfaces are matched to ports by `ifName`, not by position.** Positional mapping wrote a trunk member's data onto a hand-cabled PC port when the documented order didn't match ifIndex order; a hand-cabled port without an ifName is now preserved, never overwritten. The discovery-first flow is unchanged. `src/app-snmp.js` (+tests).
- **An auto-derived LAG is named after the bundle that actually connects the peer.** An LLDP-inferred LAG now picks the aggregator matching by `lagId` then trunk VLANs, instead of the node's first Port-channel. `src/app-autolink.js`.

### Added
- **A "port to reconcile" warning instead of silent preservation.** When a preserved hand-cabled port is seen by SNMP as a trunk/LAG member, the node records `portReconcileConflicts` and Properties shows an amber warning; it fires only on a genuine endpoint-vs-trunk conflict and self-clears. `src/app-snmp.js`, `src/app-properties-node.js`, `lib/i18n.js`.

## 2026-07-02 — Manual LAG entry restored in the port Properties panel

### Fixed
- **You can create and dissolve a LAG by hand again, from the port Properties panel.** The orphaned entry (an "Add to LAG" button + a "LAG member" badge with Remove) is put back where port clicks now land; only active devices get it. The LAG engine is unchanged. `src/app-properties-port.js`.

## 2026-07-02 — LAG cable hygiene: no LAG on passive devices, one member per active port

### Fixed
- **A LAG can no longer be attached to a passive or pass-through device.** A link is a LAG member only when both ends are active (`isLagEligibleType`); the spurious tag on a switch-to-patch-panel cable is stripped (the cable stays). `lib/lag-reconcile.js`, `src/app-autolink.js`, `src/app.js`.
- **An active port now terminates a single LAG member.** When auto-inferred LAG cables contend for one port, the most trustworthy wins (manual > LLDP/CDP > MAC/ARP/FDB); it never touches a hand-laid cable, a non-LAG shared segment or a pass-through port. Runs on load and in the auto-linker. `lib/lag-reconcile.js` (+tests), `src/app.js`, `src/app-autolink.js`.

## 2026-07-02 — Discovery import keeps your hand-set identity (hostname, brand, type)

### Fixed
- **Re-importing a discovered device no longer overwrites a hand-set hostname or brand.** Import now mirrors the Sync: a hostname is refreshed only when unlocked (`hostnameManual`), the brand filled only when empty/default; a genuine vendor shift is surfaced as a `discoveryConflicts` entry, not applied silently. `src/app-discovery.js`.
- **A device type you chose is now pinned against automatic re-typing.** A new manual-first `typeManual` flag is respected by the auto-retype, the import dialog and the standard node edit path. `src/app-discovery.js`, `src/app.js`.

## 2026-07-02 — Crash-safe user store (a corrupt file can no longer wipe accounts)

### Fixed
- **`users.json` is now written atomically and a corrupt file never regenerates over your accounts.** Writes go through the atomic temp-file + fsync + rename (with a `.bak`) used for projects, `loadUsers` recovers from the `.bak`, and startup refuses to regenerate the admin over a present-but-unreadable file (FATAL, so you can restore). `auth.js` (reuses `atomicWriteFile`).

## 2026-07-01 — Client reads the shared OID table too (part 2)

### Changed
- **The client `_guessType` no longer keeps its own copy of the OID prefixes.** It asks the shared `lib/device-signatures.js` (`oidIsType`), so server and client can't drift; also adds the missing Ruckus AP OID (25053). `lib/device-signatures.js`, `src/app-discovery-classify.js`, `netmapper.html` (+test).

## 2026-07-01 — Shared canonical OID→type table (kills classifier drift, part 1)

### Changed
- **The sysObjectID → device-type table is now a single shared source.** Extracted into a new pure `lib/device-signatures.js` (`OID_TYPE_VOTES`/`oidTypeVotes`/`oidType`); the server now also recognizes Lexmark (641) and the Grandstream/Yealink VoIP OIDs (25858/37049) the client already knew; parity preserved. `engine/fusion-scorer.js`, `server/classify.js` (+tests).

## 2026-07-01 — Discovery uses documented L3 gateways to avoid MAC collapse

### Added
- **The by-MAC merge guard now also trusts your documented gateways.** The MACs of VLAN gateways (L3-lite `gatewayNodeId` via `_l3GatewayNodeIds`) are next-hops by definition, so a row carrying one is never merged onto that gateway (falls through to hostname/IP); the batch heuristic remains the net when the gateway isn't documented. New pure `gatewayMacSet` in `lib/mac-class.js`; `src/app-discovery-classify.js`, `src/app-discovery.js` (+tests).

## 2026-07-01 — Discovery no longer collapses remote devices onto the gateway

### Fixed
- **Cross-subnet discovery stops merging remote devices onto the gateway node.** The ARP layer answers with the next-hop gateway MAC for every remote IP, so many rows shared a MAC and collapsed; import now detects a shared MAC (`sharedMacsInBatch`: one MAC on ≥2 IPs = a next-hop) and skips the by-MAC merge for it, falling through to hostname/IP. `lib/mac-class.js`, `src/app-discovery-classify.js`, `src/app-discovery.js` (+tests).

## 2026-07-01 — Device-recognition hardening: fusion classifier edge cases

### Fixed
- **An untyped plugin match no longer classifies a device as the literal type `unknown`.** The scorer's `bump()` now ignores `type === 'unknown'` (a plugin match whose `enrich()` returns no type); same guard in the legacy classifier. `engine/fusion-scorer.js`, `server/classify.js` (+test).
- **The LG-webOS-TV MAC-prefix signal no longer dies off the production path.** `_defaultNormMac` now uppercases to match the MAC-prefix rules (production already passed the uppercase `_normMac`). `engine/fusion-scorer.js` (+test).

## 2026-07-01 — Highlighted rack cable swerved to the top-left on the Assistant tab

### Fixed
- **A highlighted cable touching a rack port no longer whips toward the top-left when the Assistant tab is open.** The guard changed from `suppressRackOverlays = _rightTab === 'props'` to `_rightTab !== 'rack'`, matching exactly when `#rack-viewport` is hidden (Properties, Assistant, any future tab). `src/app.js`.

## 2026-07-01 — Stray link-mode cable when switching to Properties/Assistant

### Fixed
- **A ghost cable no longer lingers on the canvas after switching the right-panel tab.** `switchRightTab` now cancels an in-progress link when switching to a non-Rack tab; switching **to** Rack still keeps link-mode alive (needed to finish floor→rack cables). `src/app.js`.

## 2026-07-01 — Modals were clipped at the top (reskin regression)

### Fixed
- **Dialog windows (AI settings, user manager, discovery…) are no longer cut off at the top.** The reskin's `backdrop-filter` on `<header>` made it the containing block for its `position:fixed` modal descendants; removed it (it blurred nothing) and gave the header a solid background. `styles/10-modern.css`.

## 2026-07-01 — LAG-member links showed a raw i18n key

### Fixed
- **A LAG-member topology link now reads "LAG" instead of the raw key `linkstate.lag`.** Added the missing `linkstate.lag` i18n entry (it+en) and aligned the pure-lib fallback. `lib/i18n.js`, `lib/linkstate.js`.

## 2026-07-01 — Modern dark reskin (additive, CSS-only)

### Changed
- **A modern dark reskin of the whole shell.** A purely additive `styles/10-modern.css` (last in the cascade) refreshes surfaces/borders/shadows/radii via existing `:root` tokens, without touching the rack chassis, devices, port LEDs or the white rack viewport; fully reversible; the login page palette is tuned to match. `styles/10-modern.css`, `netmapper.html`, `login.html`.

### Fixed
- **Login page: broken "commercial licence" link and a stray injected script removed.** An external tool had rewritten the `mailto:` licence link into a Cloudflare email-obfuscation URL and injected an `email-decode.min.js` tag (both 404); restored the plain `mailto:`. `login.html`.

## 2026-07-01 — Sub-header: breadcrumb, next-step suggestion & project stats

### Added
- **A sub-header bar under the toolbar.** Three zones: a breadcrumb (left), the deterministic next-step suggestion (`nextStep`, centre), and project stats (right: documentation completeness, total devices, SNMP health dot) from a new pure `lib/subbar-stats.js` (`computeSubbarStats`, +tests) using the same field definitions as the app; rendered outside the export area so it never appears in PDF/SVG exports. `lib/subbar-stats.js`, `src/app-subbar.js`, `netmapper.html`, …

## 2026-07-01 — Cables no longer draw over the Properties/Assistant panel

### Fixed
- **Link-mode rubber-band (and stray cables) no longer paint over the right panel.** `switchRightTab` gives `#rack-view` the class `rv-above-cables` (z-index 70) on any non-Rack tab so the panel covers the overlay; on the Rack tab the overlay stays on top as before. `src/app.js`, `styles/04-floor-rack.css`.

## 2026-07-01 — LACP mode auto-derived over SNMP

### Added
- **LACP mode now fills in automatically from SNMP.** A Sync derives active/passive from the members' 802.3ad actor state (`dot3adAggPortActorOperState`, Activity bit gated on Aggregation); conservative (static is never inferred) and manual-first (only fills an empty mode). `drivers/snmp.js` (+tests), `src/app-snmp.js`.

## 2026-07-01 — LACP mode: bundle mode + cross-end coherence

### Added
- **LACP mode is now a first-class LAG attribute.** Each LAG group gets a mode selector (LACP active/passive/Static) stored manual-first in a new `state.lagModes[gid]` map; cross-end coherence now warns on both-ends-passive and LACP-vs-static via a new pure `lib/lag-audit.js` (`checkLagPair`, +tests); the mode also flows into the AI context. Read-only, zero-invention. `lib/lag-audit.js`, `lib/hw-capabilities.js`, `src/app-ports.js`, …

## 2026-07-01 — AI no longer treats passive wall ports as missing-IP gaps

### Fixed
- **The assistant stops flagging wall ports (and other passive cabling) as undocumented gaps.** Passive-no-IP types are now marked `passive: true` in the AI context (`_PASSIVE_NO_IP_TYPES`; `ups/pdu/ats/mediaconv` excluded since they can carry a management IP), and a grounding rule (it+en) tells the assistant a documented wall port without an IP is correct. `server/ai/context.js`, `server/ai/prompt.js` (+tests).

## 2026-07-01 — Network-model coherence: IPAM hygiene, LAG member consistency, Cat8 reach

### Added
- **IPAM hygiene — duplicate IPs & overlapping subnets.** The L3 map report now flags the same IP on ≥2 devices and two VLANs with overlapping CIDRs; new pure `lib/ipam-audit.js` (`buildIpamAudit`, +tests), surfaced as chips + a section in the L3 overlay. Doc↔doc only. `src/app-l3.js`.
- **LAG member consistency.** A LAG whose members have different speeds or access/native VLANs won't bundle on real hardware; new pure `lib/lag-audit.js` (`checkLagMembers`, +tests) warns per-group in the device panel. `src/app-properties-node.js`.

### Fixed
- **Cat8 reach limit now enforced.** The validator now warns (`cat-reach`) when copper Cat8 exceeds 30m (TIA/IEEE Class I/II) within the 100m channel; Cat7 added to the recommendation ladder. `lib/cable-validate.js` (+tests).

## 2026-06-30 — Discovery enables SNMP only on devices that answered

### Fixed
- **Imported devices no longer get a phantom SNMP driver.** Import assigns an SNMP driver only to devices that actually responded to SNMP during the scan (`d.snmpReachable`); non-responders import with no driver so Sync skips them; an existing manual driver is never overwritten. `src/app-discovery.js` (+e2e).

## 2026-06-30 — AI sees SNMP health & flags problems

### Fixed
- **SNMP health now actually reaches the assistant.** The context sanitizer's recursion cap was raised from depth 2 to 4 (so printer `supplies[]` and host `volumes[]` survive), with the secret filter and caps still running at every level. Test fixtures corrected to the real driver shapes.

### Added
- **The assistant proactively flags real problems.** New pure `lib/health-alerts.js` (`computeHealthAlerts`) derives deterministic alerts from SNMP telemetry vs thresholds (RAM/disk near full, printer ink/toner low, UPS on battery/low runtime/charge/load), surfaced as `device.alerts` + a fleet summary, gated by the SNMP-health scope. Validated on a real Synology.
- **HOST-RESOURCES now requested for network gear too.** The poll now also asks `switch/router/firewall/sdwan` (`_HOST_RES_TYPES`), so Linux-based network OSes report CPU/RAM/disk; unsupported devices stay empty. `src/app-snmp.js`.
- **Out of scope (honest):** device-down alerts stay with Verify/drift; temperature (ENTITY-SENSOR-MIB) and traffic congestion aren't collected yet, so they're never fabricated.

## 2026-06-30 — AI assistant as an onboarding guide

### Changed
- **The assistant now guides the whole workflow, not just the spine.** The in-prompt help expanded from Discover→Sync→Verify to the full six-phase journey, each phase naming the real feature labels (Element library, the Report/Import-Export/Automation menus). `server/ai/prompt.js` (it+en).
- **Proactive potential.** A grounding rule lets the assistant surface useful under-used features tied to the project's real state, kept separate from the facts; prompt-only, no new data leaves.

## 2026-06-30 — AI assistant UI refinements

### Changed
- **Refined chat typography.** Larger body text (15px), relaxed line-height, system font stack with anti-aliasing, tuned from one `#ai-panel-wrap` variable. `styles/04-floor-rack.css`.
- **Assistant settings moved out of the chat.** The gear left the chat header (Clear stays); the toolbar robot button opens Settings for admins; the chat still opens from the Assistant tab or the A shortcut. `src/app-ai.js`, `netmapper.html`, `lib/i18n.js`.

## 2026-06-30 — Security hardening (audit follow-up)

### Security
- **Path traversal closed on the AI routes.** `projectId` in `/api/ai/preview` and `/api/ai/chat` is now coerced/validated to a positive integer (`_safeProjectId`), matching the `+req.params.id` used elsewhere. `server/routes/ai.js` (+guard test).
- **CSPRNG for security secrets.** The `SESSION_SECRET` fallback and the first-run default admin password now use `crypto.randomBytes`/`randomInt` (the default password gains ~72 bits of keyspace). `auth.js`.
- **`secure` session cookie behind TLS.** Set `INFRANET_TRUST_PROXY=1` behind a TLS reverse proxy to flag the cookie `secure` and trust `X-Forwarded-*`; default off. `auth.js`.

## 2026-06-30 — Hardware capabilities in the AI assistant

### Added
- **Hardware capabilities in the AI context.** The assistant now sees each device's documented capabilities, pre-computed by `lib/hw-capabilities.js` (PoE budget/headroom, UPS/PDU power, server/NAS/firewall/AP specs, per-device port capacity + aggregate LAG/uplink) plus a fleet summary; an undocumented field is omitted (no invention), allowlist by construction (secrets structurally excluded, guard test extended).
- **Per-model, vendor-grounded advice.** The prompt lets the assistant use each device's official identity (vendor/model/firmware + `sysDescr`) to propose model-specific CLI snippets as a labelled draft, kept separate from InfraNet's authoritative data; no new data leaves.
- **Copy any chat message.** Every turn gets an always-visible copy icon anchored to the outer top corner of its bubble.

### Changed
- **The assistant now proposes sized solutions.** The grounding rules combine the pre-computed facts + capabilities into concrete fixes (free ports to relocate, PoE/uplink headroom before adding an AP), staying advisory.

## 2026-06-29 — Assistant & Verify refinements

### Added
- **Wireless SSID inventory in the AI context.** Each AP's SSIDs (name, VLAN, security type, bands) leave; never a passphrase (allowlisted, guard test). `server/ai/context.js`.
- **Friendlier assistant tone.** The prompt now asks for a warm, conversational tone (informal "tu" in Italian), no jokes, guardrails intact.

### Changed
- **Verify never claims "aligned" when it couldn't actually verify.** If the Reality Check observed nothing, the banner shows an amber "Can't verify from this machine…" instead of the green "aligned"; a partial run notes "(N not verifiable)". New pure `driftBannerKind()` in `lib/drift-report.js`.
- **Floor properties panel tidy-up.** The section is retitled "Floor plan"; Workspace colors and Labels moved inside as flat sub-groups; taller VLAN list.

## 2026-06-29 — AI assistant (advisory)

### Added
- **AI assistant (advisory, in‑app)** — a third "Assistant" tab (shortcut A) that answers questions about your documented network in plain language; bring‑your‑own‑key, OpenAI‑compatible endpoint (local Ollama by default or any cloud model); advisory, with Ansible output as a marked draft.
  - **Data security (paletto #1)** — the key lives only on the server (`data/ai-config.json`, git‑ignored, or `INFRANET_AI_KEY`), never returns to the browser; context built from the same allowlist as the REST API (`lib/api-shape.js`) + a secret‑name denylist; a "Show what leaves" preview and a build‑failing guard test.
  - **No hallucination (paletto #2)** — facts are pre‑computed into the context; the prompt forbids inventing names/IPs/VLANs and instructs "not in the documentation" when unknown.
  - **Scope & capability toggles** — choose what leaves (Inventory · Ports · SNMP health · Topology · Drift) and what the assistant may do (Q&A · Diagnostics · Find gaps · Suggestions · Ansible draft); zero new runtime dependency.
  - **Chat controls** — a settings gear (admin) reopens the config; a red trash button clears the session‑only conversation; saving the config refreshes the panel instantly.
  - **Clickable citations & anti‑invention check** — answers surface the devices/VLANs relied on as clickable chips that jump to the node; `lib/ai-grounding.js` flags any IP/MAC not in your data; the assistant is fed live drift/IPAM facts (re‑sanitized, gated by the Drift scope).
  - **Find gaps & next free IP** — the context carries pre‑computed gaps (VLAN without gateway/subnet, IPAM near full) and a next free IP per VLAN (`lib/ipam.js` `nextFree`).
  - **Ansible drafts** — a requested playbook renders as a draft card with a "not applied, review before using" banner + Copy; never executed (`lib/ai-draft.js`), gated by the Ansible‑draft toggle.
  - **"Explain" on Verify rows** — every actionable Drift/Verify row gets an Explain button that opens the assistant seeded with a grounded question about that exact case.
  - **Onboarding copilot — next‑step chip + spotlight** — the tab shows a deterministic next‑step chip; "Show me" lights the real toolbar button with a blinking coach‑mark until you click it; "Ask" seeds a how‑to; it appears even before a model is configured and is dismissible per‑step (`lib/onboarding.js`, pure & tested).
  - **Help grounded on the real UI** — how‑to questions are grounded on the actual command surface (buttons + tooltips derived from `netmapper.html` + i18n, `lib/ui-catalog.js`) so it cites real button labels, plus a curated cheat‑sheet.

## 2026-06-29

### Added
- **Visible lock for documented values** — a clickable lock (🔒) next to IP, hostname and a port's VLAN in Properties that surfaces the existing manual‑first protection (reuses `ipManual`/`hostnameManual`/`vlanOvr`, no engine change).
- **Richer Ansible inventory host‑vars** — every host now carries network context (`vlan_name`/`subnet`/`gateway`/`dns`), asset data (`serial`/`firmware`/`hostname`), placement (`rack_id`/`rack_unit`) and management info; two new facet groups (`wireless`, `snmp_managed`); allowlist‑only, `mgmt_url` stripped of credentials.

### Fixed
- **DHCP lease reconciliation now matches a non‑normalized MAC format** (lowercase or dash‑separated) — the lease MAC is normalized in the lookup, so a messy export no longer produces false *undocumented* rows.

## 2026-06-28

### Added
- **IPAM occupancy per VLAN** — the VLAN's IPAM card shows real address usage (capacity, a usage bar, documented vs DHCP‑only vs free), combining documented IPs with active leases. Pure, tested `lib/ipam.js`.
- **Adopt from leases** — a per‑VLAN "N undocumented → Adopt" shortcut maps DHCP‑only leases into the Adopt picker (MAC + IP + hostname).
- **"Management VLAN" role** — mark a VLAN as management; an unknown device on it is treated as infrastructure (never BYOD) and flagged with a red "On management VLAN" badge.
- **Import a discovered device as a host VM** — drag a floor tile onto a host's "Import VM" drop‑zone to absorb it into `node.vms[]`; its MAC joins the Drift known set; fires only on release inside the drop‑zone; undoable.
- **DHCP lease import (cross‑VLAN reality)** — paste/load a lease table (auto‑detects ISC dhcpd / dnsmasq / Kea CSV / generic CSV) to feed the check with authoritative MAC ↔ IP across all VLANs; treated as an identity map, not a liveness probe; persisted sources merged by MAC. Pure parser `lib/dhcp-lease.js`.
- **Endpoint / BYOD transparency** — undocumented user‑looking devices (guest VLAN, crowded uplink port, randomized "private" MAC) are collapsed into a user/BYOD group, each explaining why, with a reveal toggle.

### Changed
- **Uniform floor ↔ rack interaction** — floor devices now single‑click to select, double‑click to open Properties.

### Fixed
- **Double‑click on a floor device now reliably opens Properties** — the native `dblclick` never fires (the floor re‑renders between clicks), so it's detected manually by timestamp.
- **VM import no longer triggers by accident** — the decision is taken from the actual release point, not from the last drag‑move.

## 2026-06-27 — REST API v1

### Added
- **Read‑only REST API (`/api/v1/*`)** for external consumers (Ansible, dashboards, wikis) — bearer‑token auth, sanitized output only (never SNMP communities); endpoints for projects, full inventory, device list, Ansible dynamic inventory and an OpenAPI 3.0 description; token management UI (shown once).
- **Ansible dynamic inventory** (`integrations/ansible/`, Python stdlib) — every device with an IP becomes a host grouped by `type_*`/`vlan_*`/`rack_*`/`brand_*`. InfraNet stays the source of truth; Ansible executes.

## 2026-06-25 — Docker

### Added
- **One‑command Docker setup** (`Dockerfile` + `docker-compose.yml`) — builds the frontend bundle internally and keeps data in a named volume; default host networking gives full discovery (ARP, SNMP, LLDP/CDP), with an isolated bridge variant for reverse‑proxy / Docker‑Desktop setups.
