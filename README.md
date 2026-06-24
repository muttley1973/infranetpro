# InfraNet Pro

> **Network infrastructure diagramming and live SNMP management — in a single self-hosted app.**

[![CI](https://github.com/muttley1973/infranetpro/actions/workflows/ci.yml/badge.svg)](https://github.com/muttley1973/infranetpro/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D16-brightgreen?logo=node.js)](https://nodejs.org/)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.0.0-orange)]()

<p align="center">
  <b>InfraNet Pro is free and open source.</b> If it helps your work, you can buy me a coffee — it funds new features. ☕<br>
  <a href="https://ko-fi.com/infranetpro"><img height="36" src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support InfraNet Pro on Ko-fi"></a>
</p>

InfraNet Pro is a **self-hosted web application** that lets network engineers draw rack layouts and floor-plan diagrams, then bring them to life by polling live data from real devices via SNMP. Interfaces, VLANs, LAG groups and neighbour topology are discovered automatically — no external database, no cloud dependency, minimal tooling (a lightweight esbuild bundle for the frontend; `npm start` builds it).

Current product direction: InfraNet Pro keeps discovery and classification inside the app. External discovery and monitoring engines are not part of the active roadmap; the internal SNMP/sysObjectID/LLDP/CDP/FDB engine is the source of truth and can be refined with local plugins over time.

---

## Table of Contents

- [Screenshots](#screenshots)
- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [SNMP Integration](#snmp-integration)
- [sysObjectID Intelligence Engine](#sysobjectid-intelligence-engine)
- [OUI Intelligence Engine](#oui-intelligence-engine)
- [Fusion Scoring Engine](#fusion-scoring-engine)
- [LAG / EtherChannel Detection](#lag--etherchannel-detection)
- [VLAN Management](#vlan-management)
- [Authentication & Roles](#authentication--roles)
- [Project Data Model](#project-data-model)
- [API Reference](#api-reference)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Testing](#testing)
- [Contributing](#contributing)
- [License](#license)

---

## Screenshots

> 📖 **Full feature manual (PDF):** [🇮🇹 Italiano](MANUALE_TECNICO_IT.pdf) · [🇬🇧 English](TECHNICAL_MANUAL_EN.pdf) — dark cover, white printable interior, 16 illustrated chapters.

<p align="center">
  <img src="GitHub%20Images/Topologia.png" alt="InfraNet Pro — topology view" width="900"><br>
  <em>Topology — auto-discovered L1/L2 neighbours (LLDP / CDP / FDB) drawn over the floor plan</em>
</p>

| Rack view | Rack detail |
|:---:|:---:|
| ![Rack view](GitHub%20Images/Rack.png) | ![Rack detail](GitHub%20Images/Dettaglio%20Rack.png) |
| 19″ rack with live, colour-coded **square** port LEDs and an SNMP status stripe | Front-panel detail: port numbering, MGMT / SFP blocks; device data lives in the Properties panel |

| VLAN filter | Physical cable path |
|:---:|:---:|
| ![VLAN filter](GitHub%20Images/Filtra%20Vlan.png) | ![Physical path](GitHub%20Images/Connessione%20fisica.png) |
| Isolate a VLAN across the whole map in one click | Double-click a cable to trace switch → patch panel → wall socket → endpoint |

| Discovery (SNMP) | Login |
|:---:|:---:|
| ![Discovery](GitHub%20Images/Scopri.png) | ![Login](GitHub%20Images/Login.png) |
| Scan a subnet with SNMP v1 / v2c / v3 and import reachable devices | Session-based auth, IT / EN switcher, bound to `127.0.0.1` by default |

---

## Features

### Diagramming
- **Rack view** — drag-and-drop 19″ rack units (1U–8U) with colour-coded port LEDs
- **Front-panel controls** — per-device port-count/layout options for compact home-lab and SMB rack fronts. Visual radio-button thumbnails for the 4 base layouts (Auto / Linear / Sequential / Cisco-alternating). Optional separate SFP block and dedicated MGMT (management) block with their own count + position controls
- **Dedicated MGMT ports** — up to 4 cyan-bordered cells outside the regular `1..N` port numbering, on `mgmtEligible` device types (switch, router, firewall, server, NAS, KVM, PBX, console server, WLAN controller, NVR, SD-WAN edge, VPN concentrator). Editable base label (MGMT, iLO, iDRAC, me, fxp0, …). Excluded from VLAN/LAG/FDB data-plane logic
- **SFP block** — silver-metal anodised border (Cisco/Aruba-style), separate cell group at left/right of the main port grid
- **Floor map** — place devices on an SVG floor plan; cables drawn as bezier curves
- **Multi-port floor devices** — PC/workstations, access points and custom endpoints can declare more than one network port (PC dual-NIC or NIC + OOB management, AP dual-uplink/LACP, etc.). Each port renders as a separate, independently cablable LED under the device icon. Pass-through devices (wall socket, VoIP phone) keep their two-sided transit model — the two concerns are orthogonal flags (`multiPort` vs `passThrough`)
- **Wireless links (Packet-Tracer style)** — mark any connection as wireless and it's drawn as a **sine-wave** instead of a straight cable (in both floor map and topology), skips physical-cable validation, and is auto-suggested when one end is an AP. Wi-Fi-capable devices (AP / router / firewall, per-device toggle in *Network & Access*) expose a **radio port**: a virtual connector that hosts many wireless clients without consuming physical ports and stays out of the *Free ports* report — drag a client onto the radio badge to associate it. A **WLAN** toggle in the topology legend hides all wireless connections at once
- **Wireless properties (documentation-grade, NetBox-style hybrid)** — the AP's radio holds **SSID · band (2.4/5/6 GHz) · channel (grouped by UNII sub-band, DFS-marked, with Auto) · security (Open/WPA2/WPA3/OWE) · 802.11 standard (Wi-Fi 4…7)**, validated with educational warnings (channel↔band, 6 GHz needs WPA3/OWE, standard↔band, open network); the wireless **association** inherits those read-only and carries its own **RSSI / distance**. Pure tested logic in `lib/wifi-spec.js`
- **UPS / ATS live SNMP** (UPS-MIB RFC 1628 + APC PowerNet) — Sync polls power devices for a read-only **Live status** block: UPS shows mains/**on-battery**, **battery %**, **runtime remaining** (red warning under 10 min), battery status, load %, input/output V, temperature; ATS shows **active source (A/B)**, redundancy, over-current. Vendor-neutral via UPS-MIB; manual-first (live values stay separate from the documented spec fields). Pure tested parsing in `lib/power-mib.js`, server reads in `drivers/snmp.js#pollPower` (`POST /api/poll-power`)
- **L3-lite gateway** — bind each VLAN to the device that routes it (auto-suggested from the gateway IP, manual override wins): an **L3 badge** on the device, a read-only **Gateway L3 / SVI** panel section, and a **Report → L3 map** (VLAN → subnet → gateway → device, with orphan/out-of-subnet warnings + CSV)
- **Cable path insight** — cable properties show a read-only **Physical Path** accordion that reconstructs linear paths across wall ports, patch panels and media converters
- **Multiple projects** — create, rename, copy and delete independent network maps
- **Vector PDF / SVG export** — full rack SVG export including the MGMT/SFP side blocks; port-assignment table that lists MGMT ports per device
- **Progressive patch-panel numbering** — when several patch panels serve one continuous run, each panel can *continue the numbering* from another (`Panel A` = 1–24, `Panel B` continues → 25–48, …) via an explicit chain, or override with a manual start number. The chosen number shows consistently on the front panel, port tooltips and auto cable labels. Port IDs stay stable (display-only, no data migration); a cycle guard and downstream-exclusion in the picker prevent loops
- **Cable-label export** — pick exactly the fields you need (label, from, to, colour, length, cable type, VLAN, install date/by, **room**, notes) with a live preview. Export as multi-column CSV for mail-merge into any label software, or as ready-to-print **PDF label sheets**: Avery A4 grids (L7651 / 22806), Dymo LabelWriter rolls (99010 / 11353) and a configurable generic grid. Includes a **wrap/flag** mode that repeats the ID so it reads from both sides of the cable. The room is derived geometrically from the device position on the floor plan
- **Dark UI** — focused dark theme tuned for netadmin/devops use; surface colours, depth and shadows are driven by semantic CSS tokens (a future light theme would just add a second value set)

### Live Device Integration (SNMP)
- **SNMP v1 / v2c / v3** (authPriv, authNoPriv, noAuthNoPriv) out of the box
- **Auto-discovery** — scan a subnet (CIDR or range) and auto-place reachable devices
- **Interface discovery** — pulls all physical interfaces with speed, duplex, admin/oper state
- **Hardware inventory (ENTITY-MIB native)** — automatic `brand` / `model` / `serialNumber` / `firmwareVer` population from RFC 6933 `entPhysical*`. Surfaced in the device `Inventario` accordion; manually edited values are never overwritten
- **LLDP / CDP neighbour polling** — resolves connected neighbours and auto-draws cables
- **Auto-link creation** — duplicate links between the same pair become a LAG group automatically. Virtual MAC addresses (Docker / VMware / Hyper-V / Xen / KVM) are filtered out via the OUI engine so containers don't pollute the suggested links
- **Topology walk** — one-click recursive discovery across a seed device's LLDP neighbours
- **Manual-first** — user-edited `hostname`, `ip`, `integration.host` are protected by `*Manual` flags and never overwritten by SNMP / discovery
- **Reality Check / Drift Report** — a **"Verifica documentazione"** button runs the existing SNMP sync, plus a multi-signal presence sweep (**ping / ARP / TCP** on top of SNMP/FDB), then compares the live network against the documentation and produces an interactive report in **6 categories**: **consistent ports**, **state drift** (documented active but really down, or speed/duplex/VLAN mismatch), **IP change (same MAC)** (a documented device now answering on a different IP — one-click re-bind), **documented-but-absent** (no signal at all — SNMP, ping, ARP or FDB), **undocumented devices** (MACs seen in the network but not in the map — cross-referenced with `rejectedAutoLinks` so already-rejected links aren't re-proposed), and **ghost cables** (documented cable whose port has been down for ≥ N consecutive syncs, N configurable, default 3). One-click per row: *update doc* (aligns the documentation to reality), *ignore* (persisted, won't reappear until the condition changes), *investigate* (opens the device/port on the map). The diff is a pure, tested function (`lib/drift-report.js`); ignores and the down-streak counter persist additively in the project

### LAG / EtherChannel (multi-level detection)
- **L0** — `ifStackTable` higher/lower layer analysis
- **L1** — `dot3adAggMemberPorts` (IEEE 802.3ad MIB)
- **L2** — `lagAttached` + `ActorOperState` bitmask
- **LLDP-inferred** — two or more parallel LLDP links between the same device pair
- Cisco IOS `Port-channel` (ifType 53 / propVirtual) fully supported
- LAG groups auto-named from the aggregator interface name (e.g. `Port-channel1`, `bond0`)
- Selecting any LAG member port **highlights all sibling ports** with a yellow glow

### VLAN Management
- Per-port VLAN assignment (access mode)
- Trunk port detection with native VLAN + allowed VLAN list
- VLAN list shown in both the **cable popup** and the **port popup**
- VLAN ranges displayed in compact notation (e.g. `1,10,100-120,200`)
- Fallback VLAN discovery via **Cisco VTP MIB** (`vtpVlanName`) — no per-VLAN community required
- **Optional VLAN legend on the floor plan** (toggle in the VLAN panel; in Topology view it stays on as the clickable VLAN filter)
- **VLAN details grouped by device**: the VLAN members modal collapses access ports into per-device accordions (icon + name + port count)
- **Auto-derived trunks** (`lib/vlan-trunk.js`): a link's trunk membership is *derived* from the VLANs its endpoints carry — VoIP **voice VLAN** and per-SSID **Wi-Fi VLANs** — plus the SNMP-polled trunk of the port. Manual-first: a hand-set trunk/access wins. The native (untagged) VLAN is editable inline on the cable (writes the active port's PVID)
- **Unified VLAN distribution, cable ↔ wireless**: the same propagation BFS seeds physical ports *and* radio interfaces, so a wireless client inherits its SSID's VLAN exactly like a wired access port
- **Site default native VLAN** (`state.nativeVlan`): change the untagged default (e.g. 1 → 99) site-wide; per-port/per-trunk overrides win

### Wireless
- **Up to 8 radio interfaces per device** (`lib/radio.js`), each with its own SSID / band / channel / security / VLAN and a dedicated **WIRELESS** panel
- **Wireless is its own connection type**: a radio port only connects to another radio port (radio↔radio = wireless association, rendered as a wave); radio↔network-port is rejected. The association emanates from the specific radio's anchor in Topology
- **Per-device radio layout**: floor tiles show radios on 8 perimeter anchors (corners + mid-sides); rack devices line them up on the left edge
- A device's SSID VLANs are carried (tagged) on its wired uplink, which automatically becomes a **trunk** (see VLAN Management)

### Cabling Metadata
- Cable-level metadata on `state.links[]`: `cableType`, `lengthM`, `color`, `installedAt`, `installedBy`, `isPermanent`, `notes`
- Backward-compatible link normalization for legacy fields (`length`, `colorOvr`, `category`)
- **Segment editor (P1.5)**: route a cable through pass-through ports without popups — *highlight mode* lights up every free pass-through port (patch panels in any rack + wall sockets on the floor); click one to split the cable into two real segments (`PC ↔ patch panel ↔ switch`). "Remove hop" merges two segments back into a direct cable. Pure split/merge logic in `lib/cabling.js`
- **TIA-568 hierarchy rule** (`canRouteThrough`): a hop can only be inserted if it sits *between* the endpoints in the structured-cabling hierarchy (endpoint 0 → wall socket 1 → patch panel / media converter 2 → active equipment 3), so a completed run can't be extended with out-of-place hops. **VoIP phones** are pass-through at level 0.5 (`PC → phone → socket → patch panel → switch`)
- **End-to-end chain validation**: a ⚠ badge flags structurally anomalous paths (active device mid-span, non-monotone order, too many hops). Informational, non-blocking
- **Chain-aware topology state**: a routed inferred cable stays *inferred* (animated) on every hop until the **whole** chain is confirmed manual, then turns solid uniformly — no mixed animated/solid segments
- **Map view bar** — the `Topology` toggle and the `Filter VLAN` legend live together in a single bar at the top-right of the floor plan (both are "how I look at the map" controls), separated by a divider
- **Topology legend toggles** — `TRUNK` highlights trunk links (dims the rest) and, while in Topology view, also makes trunk cables appear (highlighted) inside the rack window; `ENDPOINT` hides the last hop to leaf devices and the endpoint nodes themselves to declutter the backbone view
- **Physical-path trace** — double-click a cable in Topology to open its properties and light up the **whole** physical run (switch → patch → wall socket → endpoint) across racks and floor, not just the clicked segment

### Security
- Session-based authentication (express-session + bcryptjs)
- Rate-limited login endpoint (blocks brute-force)
- Two roles: **admin** (full control) and **viewer** (read-only)
- Auto-generated session secret persisted to `.session-secret`
- Binds to `127.0.0.1` only — not exposed to the network by default

### Internationalization (i18n)
- **Bilingual UI (Italian / English)** with an IT/EN switcher in the user menu **and on the login page** (the login choice is persisted in `localStorage` and carried into the app); choice persisted in `localStorage`
- Pure, zero-dependency `lib/i18n.js`: `t(key, vars)` with `it → en` fallback so an untranslated key never breaks the UI
- Two wiring mechanisms: `data-i18n` / `data-i18n-tip` / `data-i18n-ph` / `data-i18n-html` for static HTML, and `t('key')` inline for JS-generated panels
- Technical glossary (VLAN, SNMP, LLDP/CDP, SFP, …) and vendor names are intentionally left untranslated
- `it ↔ en` key-parity unit test guards against missing translations

---

## Architecture

```text
infranetpro/
├── server.js               # Bootstrap Express: middleware, statici, auth, router, listen
├── auth.js                 # Sessioni, login bcrypt, ruoli, user CRUD
├── utils.js                # Helper condivisi
├── server/                 # Moduli backend (CommonJS)
│   ├── drivers.js          # Registry driver di polling
│   ├── projects-store.js   # Persistenza progetti JSON
│   ├── netscan.js          # Primitive rete (ARP/DNS/HTTP/NetBIOS/SMB/deep scan)
│   ├── classify.js         # Classificazione device + metadata discovery
│   ├── pdf-report.js       # Generazione report PDF
│   ├── label-sheet.js      # Render PDF etichette cavo (Avery/Dymo/generico)
│   └── routes/
│       ├── projects.js     # CRUD progetti
│       ├── discovery.js    # poll / discover / topology / crawl SSE
│       └── export.js       # export PDF report + PDF etichette
├── drivers/
│   └── snmp.js             # Driver SNMP v1/v2c/v3
├── engine/
│   ├── index.js            # Export pubblico (SysObjectEngine + OuiEngine + FusionScorer)
│   ├── sysobject-engine.js # sysObjectID plugin loader, hot-reload, longest-prefix-wins
│   ├── oui-engine.js       # OUI/MAC plugin loader, hot-reload, longest-prefix-wins, priority
│   └── fusion-scorer.js    # Fusion scoring engine: deviceType + confidence + alternatives
├── plugins/                # Catalogo seed vendor sysObjectID (zero database)
├── plugins/oui/            # Catalogo seed vendor OUI/MAC + _ieee-database.js (IEEE fallback)
├── data/
│   └── oui-db.json         # Snapshot ufficiale IEEE (~57k voci) — rigenerabile con `npm run update-oui`
├── scripts/
│   └── update-oui-db.js    # Zero-dep downloader registri IEEE (MA-L+MA-M+MA-S+IAB)
├── lib/                    # Moduli condivisi browser + test
│   ├── i18n.js             # i18n puro: t(key,vars), dizionari it/en, glossario tecnico
│   ├── cidr.js             # IPAM e CIDR IPv4
│   ├── netnames.js         # Normalizzazione MAC / ifName / FDB
│   ├── linkstate.js        # Stati espliciti dei link
│   ├── correlate.js        # Correlation engine: pairSig, buildNeighborCandidates, findPortByIfName
│   ├── app-types.js        # Catalogo TYPES dispositivi, NODE_SPEC_FIELDS, wrapper frontpanel
│   ├── app-core.js         # Bootstrap frontend, progetti, modali
│   ├── app-auth.js         # Auth frontend e gestione utenti
│   ├── app-discovery-classify.js # OUI vendor map, identity matching, class hints, _guessType
│   ├── app-discovery.js    # Discovery UI e import
│   ├── app-topology-crawl.js # Topology crawl UI e import da crawl
│   ├── app-csv-import.js   # Import CSV e preview dispositivi
│   ├── app-ports.js        # UI porte, override, tooltip, LAG
│   ├── app-popup.js        # Popup link/porta/topologia e percorso fisico
│   ├── app-render-core.js  # renderAll/renderScope/renderFloor, cable paths, shouldRenderLink
│   ├── app-topology-overlay.js # Topology overlay: pairMap 3 passate, legenda VLAN, fan-out
│   ├── app-pointer.js      # Drag&drop, pointer events, dblclick, link creation, trace
│   ├── app-management.js   # Protocolli/app di management e relativo editor
│   ├── app-search-zoom-rack.js # Ricerca, zoom/pan, divider, palette, menu, rack mgmt, map import
│   ├── app-vlan-autopoll.js # VLAN palette/propagazione/IPAM, auto-poll SNMP, link mode/trunk
│   ├── app-autolink.js     # Auto-link LLDP/CDP/FDB/ARP, shared segment, refresh FDB
│   └── app-properties.js   # Pannello proprietà, form di dettaglio, preferenze fisarmoniche
├── tools/
│   └── check-syntax.js     # Check sintattico ricorsivo di tutti i file JS (62 file oggi)
├── netmapper.html          # Struttura HTML principale
├── export.js               # Costruzione SVG / payload report (classic <script>, by design)
├── styles/                 # CSS modularizzato (9 partial + design tokens) — ex style.css; vedi styles/README.md
├── build.js                # Build esbuild del frontend (bundle dei moduli glue migrati a ESM)
├── src/                    # Tutto il JS frontend in ESM (bundle esbuild): glue app-*.js + nucleo app.js (~2300 righe: stato, undo/redo, eventi, setters, init)
├── login.html              # Pagina di login
├── test/                   # Suite di regressione `node --test`
├── tests/                  # Test dedicati ai nuovi moduli engine/plugin
├── .github/workflows/      # CI
├── projects/               # File progetto JSON (git-ignored)
├── users.json              # Credenziali hashate (git-ignored)
├── .session-secret         # Segreto sessione auto-generato (git-ignored)
└── package.json
```

**Design principles:**
- **Minimal-tooling frontend** — historically zero-build (plain static assets loaded directly). Now migrating to explicit ES modules bundled by **esbuild** (`npm run build` → `dist/app.bundle.js`) to remove the implicit global coupling and `typeof` guards of the glue layer; the pure logic in `lib/*.js` stays UMD-lite (globals in the browser, `require()`-able in tests, imported as-is by esbuild). **The strangler migration is complete** (merged to `main`): all glue **and** the nucleus `app.js` are ESM modules in `src/`; only the pure `lib/*.js` and `export.js` stay classic *by design*. CSS is modularized in `styles/` (partials + design tokens, see `styles/README.md`).
- **File-based storage** — each project is a plain JSON file; easy to back up or version-control. The floor-plan image is kept out of the JSON as a sidecar asset (`projects/assets/<id>.<ext>`) and re-attached as a data-URL on load, so saves and the project listing stay fast even with large maps
- **Internal plugin model** - discovery intelligence is extended with local SNMP/sysObjectID plugins and self-contained drivers, without depending on external discovery platforms
- **Tested core** — bug-prone parsing/normalization logic is covered by a dependency-free regression suite (`npm test`); CI on every push also runs a syntax check, an ESLint gate (`npm run lint`), a type check (`tsc` JSDoc) and a real-browser e2e suite

---

## Requirements

| Dependency | Version |
|---|---|
| [Node.js](https://nodejs.org/) | ≥ 16.0.0 |
| npm | ≥ 8 (bundled with Node 16) |
| Network access | UDP 161 to managed devices |

No external database. No Docker required (though it works fine in a container).

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/muttley1973/infranetpro.git
cd infranetpro

# 2. Install dependencies
npm install

# 3. Start the server
node server.js
# or
npm start
```

Open your browser at **http://localhost:8421**

On first start, a default **admin** account is created automatically. You will be prompted to change the password on first login.

> **Windows users:** double-click `avvia.bat` to start the server in a console window.

> **Prefer `git clone` over "Download ZIP".** The frontend bundle (`dist/app.bundle.js`)
> is a build artifact and is **git-ignored** — it is never in the repo. `npm install`
> rebuilds it automatically (via the `postinstall` hook), so a clone + `npm install`
> always runs the current code. A stale ZIP, by contrast, has no `.git` (you can't tell
> which version it is) and won't update — the classic "I'm on an old version" trap. If
> you must use a ZIP, download it from the **`main`** branch and re-`npm install`. To
> confirm you're current: `src/app.js` exists and there is **no** root `app.js`.

---

## Configuration

All configuration is done via **environment variables** — no config file needed.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8421` | TCP port the server listens on |
| `SESSION_SECRET` | *(auto-generated)* | Override the session signing secret |

Example:
```bash
PORT=80 node server.js
```

To expose the server on all interfaces (e.g. inside a trusted LAN):
```javascript
// server.js — change the listen call
app.listen(PORT, '0.0.0.0', () => { ... });
```

> ⚠️ InfraNet Pro is designed for **internal/trusted networks**. Do not expose it directly to the internet without a reverse proxy and TLS.

---

## Usage

### 1. Create a Project
Click **New Project**, give it a name (e.g. `Core Network`). Each project stores its own devices, cables, VLANs and layout independently.

### 2. Add Devices
Use **Add Device** to place a switch, router, server or generic device on the rack or floor map. Set the hostname, IP, icon and number of ports.

### 3. Poll via SNMP
Select a device → **Poll** tab → choose driver (`snmp-v2c`, `snmp-v3`, …) → enter community / credentials → **Poll**. The app fills in:
- Hostname (sysName)
- All physical interfaces with speed, admin/oper state, duplex
- LAG aggregators and their member ports
- VLAN information
- LLDP/CDP neighbours

### 4. Auto-Discover Topology
Use **Discover Subnet** to scan a CIDR block (e.g. `192.168.1.0/24`) and auto-place all reachable SNMP devices. Then **Walk Topology** on a seed device to recursively pull LLDP neighbours and auto-draw cables between them.

### 5. Manage Cables & VLANs
Click any cable to inspect it (mode: trunk/access, native VLAN, allowed VLANs). Click any port LED to see the interface detail and edit its VLAN assignment. LAG member ports glow yellow when selected.

---

## SNMP Integration

### Supported Drivers

| Driver ID | Protocol | Notes |
|---|---|---|
| `snmp-v1` | SNMPv1 | Legacy; community string |
| `snmp-v2c` | SNMPv2c | Recommended for most switches |
| `snmp-v3` | SNMPv3 | authPriv / authNoPriv / noAuthNoPriv |
| `auto` | v1 + v2c + v3 | **Discovery only**: probes all versions in parallel, keeps whichever answers, and reports every version a host responds to (`snmpVersions`). |

**Universal discovery.** The *Scopri* dialog scans with `auto` (only Community +
Timeout to set). A host that speaks v2c is imported with data; a **v3-only** host
is detected *without credentials* via the SNMPv3 engineID/USM handshake and flagged
**"v3 da configurare"** (a 🔑 pill on the device + a counter next to *Sync* jump you
to each one). You then fill the v3 credentials in **Properties → Integration** and
*Sync*. Devices that answer both show `SNMPv2c · +v3` (v2c is exposed — consider
disabling it). The Integration panel is available for any device with an IP (rack
**and** floor: printers, APs, cameras, NAS…), not just rack devices.

### SNMPv3 Parameters

| Field | Description |
|---|---|
| Username | Security name (USM) |
| Auth protocol | `MD5` or `SHA` |
| Auth passphrase | ≥ 8 characters |
| Privacy protocol | `DES` or `AES` |
| Privacy passphrase | ≥ 8 characters |
| Security level | `noAuthNoPriv` / `authNoPriv` / `authPriv` |
| **Context name** | SNMPv3 context — required by some agents (e.g. **HP JetDirect → `jetdirect`**); leave empty for the default context |

### MIBs Used

| MIB / OID tree | Purpose |
|---|---|
| `IF-MIB` (`ifTable`, `ifXTable`) | Interface index, name, type, speed, status |
| `IF-MIB ifStackTable` | LAG stacking relationships (L0) |
| `IEEE 802.3ad` (`dot3adAgg*`) | LACP aggregator / member ports (L1/L2) |
| `BRIDGE-MIB` / `Q-BRIDGE-MIB` | Bridge port mapping, VLAN egress/untagged bitmaps |
| `LLDP-MIB` | Neighbour discovery, port descriptions |
| `CISCO-CDP-MIB` | Cisco Discovery Protocol neighbours |
| `Cisco VTP MIB` (`1.3.6.1.4.1.9.9.46`) | VLAN names on Cisco IOS without per-VLAN community |
| `SNMPv2-MIB` (`sysName`, `sysDescr`, `sysObjectID`, `sysServices`) | Hostname, device description, vendor/model intelligence and L2/L3 service hints |
| `SNMPv2-MIB` (`sysLocation`, `sysContact`, `sysUpTime`) | Live system info card (location / contact / uptime) — any IP device |
| `ENTITY-MIB` (`entPhysical*`) | Hardware inventory: vendor, model, serial number, firmware/software revision |
| `Printer-MIB` (RFC 3805) + `hrPrinterStatus` | Printer card: toner/ink levels per colorant (CMYK %), total page count, printer status — `printer` devices |
| `HOST-RESOURCES-MIB` (RFC 2790) | Host card: CPU load (avg `hrProcessorLoad`), RAM and disk usage (`hrStorageTable`, pseudo-fs filtered + bind-mounts de-duplicated) — `server`/`pc`/`nas`/`homelab` |

**Live read-only cards.** System / Printer / Host-resources data is shown as
read-only "live" cards in the Integration panel and **never overwrites manual
fields** (manual-first). They appear only when the device actually exposes the
data. **Per-class isolated read:** Printer-MIB is read in a separate
**concurrency-1** pass gated on the device type — weak agent stacks (HP JetDirect)
non-deterministically truncate the supplies columns under the concurrent multi-OID
walk; isolating that read returns complete data. HOST-RESOURCES is fetched only for
compute devices. v2c and v3 expose the *same* OIDs.

---

## sysObjectID Intelligence Engine

InfraNet Pro includes a dependency-free `sysObjectID` engine designed to enrich SNMP discovery results without adding a database dependency.

This engine is the preferred extension path for vendor intelligence. Add or refine local plugins under `plugins/`; do not add runtime dependencies on external discovery systems.

Current state:

- **Engine location**: `engine/sysobject-engine.js`
- **Public API**: `const { SysObjectEngine } = require('./engine')`
- **Plugin directory**: `plugins/`
- **Runtime model**: one isolated engine instance per webapp, no shared global registry
- **Matching rule**: prefix-based, with **longest-prefix-wins**
- **Hot reload**: adding, changing or removing `.js` / `.cjs` plugin files updates the registry at runtime
- **Failure isolation**: a broken plugin is skipped; a plugin throwing during `enrich()` returns `null` and does not crash the engine
- **SQLite-ready seam**: the constructor accepts an optional `storage` field for future catalog overrides/history, but the current engine remains zero-database
- **Discovery integration**: `server/classify.js` resolves `row.objectId` through the engine before falling back to legacy PEN/regex heuristics
- **OS/agent fingerprinting**: plugins can also return operating-system hints; context-only fingerprints use `vendorPrefix: '0'` through `engine.fingerprint(context)`

Example:

```js
const { SysObjectEngine } = require('./engine');

const sysObjectEngine = new SysObjectEngine({
  pluginDir: './plugins',
});

const result = sysObjectEngine.resolve('1.3.6.1.4.1.6574.1', {
  descr: 'Synology DiskStation',
  hostname: 'nas-lab',
  sysServices: 72,
});

const osHint = sysObjectEngine.fingerprint({
  hostname: 'MacBook-Pro',
  vendor: 'Apple',
});
```

### Seed Vendor Catalog

The bundled seed catalog covers the most common home-lab / small-business vendors:

- Network: Cisco, HPE/Aruba, MikroTik, Ubiquiti, Zyxel, Netgear, TP-Link, D-Link
- Security: Fortinet, Palo Alto Networks
- Storage/server: Synology, QNAP, VMware
- Power/video: APC, Eaton, Axis, Hikvision
- OS/agent fingerprints: Microsoft Windows, Net-SNMP/Linux/Unix, Proxmox, TrueNAS/FreeNAS, Apple macOS/iOS, Android/Android TV, Chromecast/Cast OS

The seed catalog is intentionally practical, not a claim of global completeness. `sysObjectID` does not have one universal official model database; the official stable part is the IANA PEN/vendor prefix, while model-level mappings are vendor/community-specific.

### Adding a New Vendor

Add one file under `plugins/`, for example `plugins/examplevendor.js`.

Each plugin must export **exactly** these three fields:

```js
'use strict';

const vendorPrefix = '1.3.6.1.4.1.99999';

function match(oid, context = {}) {
  return oid === vendorPrefix || oid.startsWith(`${vendorPrefix}.`);
}

function enrich(oid, context = {}) {
  const text = `${context.descr || ''} ${context.hostname || ''}`.toLowerCase();
  const deviceType = /firewall|gateway/.test(text) ? 'firewall' : 'switch';

  return {
    vendor: 'Example Vendor',
    deviceType,
    family: 'Example Network Device',
    model: undefined,
    confidence: 80,
    tags: ['network', 'snmp', deviceType],
    os: {
      family: 'linux',
      vendor: 'Example Vendor',
      name: 'ExampleOS',
      confidence: 70,
    },
    infranet: {
      deviceType,
      rackEligible: true,
      floorEligible: false,
      sourcePriority: 'sysObjectID',
    },
  };
}

module.exports = { vendorPrefix, match, enrich };
```

Rules:

- Use the vendor PEN prefix when possible: `1.3.6.1.4.1.<PEN>`
- Prefer generic family/type logic over one-off hacks for a single lab device
- Put exact model mappings inside the plugin only when the OID is known and stable
- Keep `deviceType` aligned with InfraNet Pro types (`switch`, `router`, `firewall`, `server`, `nas`, `ap`, `printer`, `webcam`, `nvr`, `ups`, `pdu`, `iot`, `pc`)
- For OS-only/context fingerprints without a `sysObjectID`, use `vendorPrefix = '0'` and match context fields such as hostname, vendor, MAC, HTTP title, NetBIOS, SMB or services
- Optional `os` output fields are supported: `family`, `vendor`, `name`, `confidence`, `tags`
- Do not query SQLite, Redis, HTTP APIs or external files from a plugin
- Do not use plugins as adapters to external discovery engines
- Run `npm.cmd test` after adding or changing plugins

---

## OUI Intelligence Engine

InfraNet Pro ships a second plugin-based engine for **MAC OUI vendor + device
intelligence**, mirroring the sysObjectID engine architecture: plugin-based,
hot-reload, zero-database, production-ready.

### Components

- **Engine**: `engine/oui-engine.js` — public via `const { OuiEngine } = require('./engine')`
- **Plugin directory**: `plugins/oui/`
- **IEEE catch-all**: `plugins/oui/_ieee-database.js` loads `data/oui-db.json`
  (~57k entries: MA-L 24-bit + MA-M 28-bit + MA-S 36-bit + IAB legacy)
- **Database updater**: `scripts/update-oui-db.js` — zero-dep, downloads the four
  official IEEE registries and writes `data/oui-db.json`. Run via `npm run update-oui`

### Resolution rules

- **Compact prefix trie**: lookup walks at most 12 hex nibbles (~131 ns on a
  warm process) instead of probing every plugin's Map. Built once at every
  `refresh()`; longest-prefix wins, with priority-desc tie-break inside the
  same node and fallback through shorter prefixes when the longer match
  vetoes via `match()`
- **Longest-prefix-wins**: 24/28/36-bit IEEE assignments + arbitrary 2..12 char hex
  prefixes for special non-IEEE blocks (e.g. Docker `0242`)
- **Plugin priority**: default 100; the IEEE catch-all uses priority 0 so
  vendor-specific plugins always win when their prefix overlaps
- **Hot reload**: plugin add/change/remove updates the registry at runtime
- **Failure isolation**: identical guarantees to the sysObjectID engine
- **SQLite-ready seam**: `new OuiEngine({ storage })` constructor accepts a future
  persistence handle without changing any call site
- **Discovery integration**: `server/classify.js._resolveOui()` enriches every
  discovery row with vendor + (often) deviceType from MAC; the OUI signal feeds
  the device scoring engine, and `isVirtual()` filters virtual NICs from
  auto-link/topology

### Seed catalog (32 specific plugins + IEEE fallback)

- **Virtual**: VMware, Hyper-V, Xen, KVM/QEMU, Docker
- **Network**: Cisco, HPE/Aruba, MikroTik, Ubiquiti, TP-Link, Netgear, Zyxel, D-Link
- **Security**: Fortinet, Palo Alto Networks
- **Endpoint**: Apple, Samsung, LG, Microsoft, Dell, Lenovo, Asus
- **IoT / CCTV**: Daikin (AzureWave), Reolink, Hikvision, Dahua, Axis
- **NAS**: Synology, QNAP
- **Printer**: HP, Epson, Canon

### Public API

```js
const { OuiEngine } = require('./engine');

const oui = new OuiEngine({ pluginDir: './plugins/oui' });

oui.lookup('00:50:56:11:22:33');
// → { status:'found', vendor:'VMware', deviceType:'server',
//     isVirtual:true, isLocallyAdministered:false, ... }

oui.isVirtual('02:42:ac:11:00:02');         // true (Docker)
oui.isLocallyAdministered('52:54:00:..');   // true (QEMU/KVM)
oui.isMulticast('01:00:5e:00:00:01');       // true
oui.getVendor('00:00:0c:aa:bb:cc');         // 'Cisco Systems'
oui.format('aabbccddeeff');                 // 'aa:bb:cc:dd:ee:ff'
```

### Refresh the IEEE snapshot

```bash
npm run update-oui
# downloads MA-L + MA-M + MA-S + IAB CSVs from standards-oui.ieee.org
# writes data/oui-db.json (~3.5 MB, ~57k entries)
```

The file is committed to the repository so the engine is fully functional after
`git clone` without any additional setup. Re-run periodically (every ~6 months)
to capture new IEEE assignments.

---

## Fusion Scoring Engine

The Fusion Scoring Engine is the central decision layer that turns all available
discovery signals (sysObjectID engine, OS fingerprint, OUI engine, sysServices,
TCP ports, hostname/vendor/banner regexes) into a single classified device.

### Why extract it

The legacy `_classifyDiscoveredDevice` was a ~250-line monolith inside
`server/classify.js`. Extracting it provides:

- **Testability**: the scorer is a pure module (`engine/fusion-scorer.js`) with a
  dedicated test suite (`tests/fusion-scorer.test.js`)
- **Confidence as a first-class output**: in addition to the type name, the
  engine returns a numeric `confidence` (10–99), `alternatives` ranked by score,
  the full `scores` map and the `evidences` / `reasons` trail
- **Tunable**: priority order, decision threshold, and a future `storage` seam
  for learned weights / per-tenant rule overrides
- **Behavioural parity**: the legacy classifier is preserved as
  `_classifyDiscoveredDeviceLegacy` and exercised by 14 parity tests against the
  new engine — same input, same output

### Public API

```js
const { FusionScorer } = require('./engine');

const scorer = new FusionScorer({
  // priority: ['firewall','router','switch',...],   // override tie-break order
  // decisionThreshold: 30,                           // raw score floor
  // storage: sqliteHandle,                           // future SQLite seam
});

const result = scorer.classify(row, {
  sysObjectInfo,    // result of SysObjectEngine.resolve(...)
  osFingerprint,    // result of SysObjectEngine.fingerprint(...)
  ouiInfo,          // result of OuiEngine.lookup(...)
  vendorByObjectId, // (oid) => vendor   (PEN fallback)
  normMac,          // (mac) => normalized
  decodeSysServices,// (value) => {raw, l1..l7}
});

// result = {
//   deviceType: 'switch',
//   confidence: 87,
//   alternatives: [{type:'router', score:45}, {type:'server', score:30}],
//   scores: { switch:78, router:45, server:30, ... },
//   evidences: [{source:'sysobject', label:'Cisco / Catalyst 2960', ...}, ...],
//   reasons: ['sysobject-plugin', 'sysservices-l2', ...],
// }
```

### Integration

`server/classify.js._scoreDiscoveredDevice(row)` is the production entry point:
it resolves all upstream signal engines and feeds them to the scorer. The
discovery payload now exposes a `classification` object alongside the legacy
`deviceClass` / `confidence` for UI consumers:

```json
{
  "ip": "192.168.1.100",
  "deviceClass": "switch",
  "confidence": 92,
  "classification": {
    "deviceType": "switch",
    "confidence": 87,
    "alternatives": [{ "type": "router", "score": 45 }],
    "scores": { "switch": 78, "router": 45 },
    "reasons": ["sysobject-plugin", "sysservices-l2"]
  }
}
```

---

## LAG / EtherChannel Detection

InfraNet Pro uses a **four-level cascade** to detect link aggregation groups:

```
Level 0 — ifStackTable
  Higher/lower layer walk. If ifA is stacked above ifB,
  ifA is the aggregator and ifB is a member.

Level 1 — dot3adAggMemberPorts
  IEEE 802.3ad MIB. Direct map of aggPortAttachedAggID.

Level 2 — dot3adAggPortActorOperState
  LACP bitmask — distinguishes active/collecting/distributing ports.

LLDP-inferred
  If two or more LLDP links exist between the same device pair,
  they are automatically grouped into a logical LAG,
  even without SNMP LAG MIB support on the device.
```

**Cisco IOS specifics:**
- `Port-channel` interfaces have ifType **53** (propVirtual), not 161 (ieee8023adLag)
- The regex `/^(port-?channel|bond\d*|ae\d|po\d+$|lag\d)/i` catches all common naming conventions
- LAG groups are auto-named from the first aggregator interface with a name (e.g. `Port-channel1`)

---

## VLAN Management

VLAN data is collected from three sources, in priority order:

1. **Q-BRIDGE-MIB egress/untagged bitmaps** (`dot1qVlanCurrentEgressPorts`) — most accurate, but requires per-VLAN SNMP community context (`public@100`) on Cisco IOS
2. **Bridge port → VLAN membership** from `state.ports` — used when explicit VLAN bitmaps are available
3. **Cisco VTP MIB** (`vtpVlanName`, OID `1.3.6.1.4.1.9.9.46.1.3.1.1.2`) — fallback that works without any special community, returns all VLANs defined in the VTP domain

Trunk vs access detection is derived from the egress / untagged bitmaps: a port is a trunk if it carries any VLAN not in its untagged set.

---

## Authentication & Roles

| Role | Capabilities |
|---|---|
| **admin** | Full access: create/edit/delete projects, poll devices, manage users |
| **viewer** | Read-only: browse diagrams, inspect ports and cables |

Users are stored in `users.json` with bcrypt-hashed passwords (cost factor 12).

The login endpoint is rate-limited to **10 attempts per 15 minutes** per IP.

### Managing Users (admin panel)
Log in as admin → **Settings → Users** to:
- Add new users
- Change passwords
- Promote / demote roles
- Delete users

---

## Project Data Model

Each project is a JSON file in `projects/<id>.json`:

```jsonc
{
  "id": 1,
  "name": "Core Network",
  "created_at": "2026-05-27T08:00:00.000Z",
  "updated_at": "2026-05-28T17:00:00.000Z",
  "state": {
    "nodes": [ /* device objects */ ],
    "links": [ /* cable objects */ ],
    "ports": { /* port objects keyed by portId */ },
    "lagGroups": { /* LAG display names keyed by groupId */ },
    "racks": [ /* rack definitions */ ],
    "vlans": [ /* VLAN definitions */ ],
    "floorView": { /* pan/zoom state */ }
  }
}
```

The exact `state` shape evolves with the app and is stored as-is. The most important collections today are `nodes`, `links`, `ports`, `racks`, `lagGroups` and VLAN/IPAM-related state.

**Representative objects:**

```jsonc
// Node (device)
{
  "id": "node-1",
  "name": "switch1.example.com",
  "hostname": "switch1",
  "ip": "192.168.1.1",
  "type": "switch",
  "rackId": "rack_default",
  "rackU": 40,
  "sizeU": 1,
  "ports": 24,
  "integration": {
    "lastPoll": "2026-05-28T17:00:00.000Z",
    "lags": [ { "index": 1, "name": "Port-channel1", "members": [2,3], "isTrunk": true, "trunkVlans": [1,100] } ],
    "vlans": [1, 100, 200]
  }
}

// Link (cable)
{
  "id": "link-abc",
  "src": "p1",                // source portId
  "dst": "p2",                // destination portId
  "label": "A-12-RUN",
  "mode": "trunk",
  "vlan": 1,
  "trunkVlans": [1, 100, 200],
  "cableType": "cat6a-utp",
  "lengthM": 12.5,
  "color": "#00d4ff",
  "installedAt": "2026-06-01",
  "installedBy": "Mario",
  "isPermanent": false,
  "notes": "Patch cord rack A",
  "lagGroup": "lldp-lag-node-1||node-2",
  "autoLinked": true,
  "confidence": 0.91,
  "protocol": "lldp",
  "segments": [
    { "from": "wp-a12-1", "to": "pp-a-12", "length": 25, "type": "cat6a-utp", "permanent": true },
    { "from": "pp-a-12", "to": "sw-core-24", "length": 1.5, "type": "cat6-utp", "permanent": false }
  ]
}

// Port
{
  "ifName": "Gi0/1",
  "alias": "Uplink Core",
  "status": "active",
  "speed": 1000,
  "vlan": 100,
  "isTrunk": false,
  "lagGroup": "snmp-lag-node-1-1",
  "mac": "00:11:22:33:44:55"
}

// Rack
{
  "id": "rack_default",
  "name": "Rack principale",
  "sizeU": 42
}
```

---

## API Reference

All endpoints require an authenticated session. Write endpoints require the **admin** role.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/projects` | any | List all projects (metadata only) |
| `POST` | `/api/projects` | admin | Create a new project |
| `GET` | `/api/projects/:id` | any | Get full project (including state) |
| `PUT` | `/api/projects/:id` | admin | Update project name or state |
| `DELETE` | `/api/projects/:id` | admin | Delete a project |
| `POST` | `/api/projects/:id/copy` | admin | Duplicate a project |
| `POST` | `/api/poll` | admin | Poll a single device via SNMP |
| `POST` | `/api/discover` | admin | Scan a subnet/range and return enriched discovery results |
| `POST` | `/api/topology` | admin | Pull LLDP/CDP neighbours from a single device |
| `POST` | `/api/discover/topology` | admin | Start a topology crawl via SSE from one or more seed IPs |
| `POST` | `/api/auth/login` | — | Log in (rate-limited) |
| `POST` | `/api/auth/logout` | any | Log out |
| `GET` | `/api/auth/me` | any | Current session user info |
| `GET` | `/api/auth/users` | admin | List all users |
| `POST` | `/api/auth/users` | admin | Create a user |
| `PUT` | `/api/auth/users/:id` | admin | Update user (password / role) |
| `DELETE` | `/api/auth/users/:id` | admin | Delete a user |

### Poll Request Body

```jsonc
{
  "driver": "snmp-v2c",
  "host": "192.168.1.1",
  "community": "public",
  "port": 161,
  "timeout": 5
}
```

### Discover Request Body

```jsonc
{
  "subnet": "192.168.1.0/24",   // CIDR or "192.168.1.1-254"
  "driver": "snmp-v2c",
  "community": "public",
  "concurrency": 20,            // parallel probes
  "timeout": 2,
  "safeMode": true,
  "deepScan": false
}
```

### Topology Crawl Request Body

```jsonc
{
  "seed": "192.168.1.1",        // or use "seeds": ["192.168.1.1", "192.168.1.2"]
  "driver": "snmp-v2c",
  "community": "public",
  "port": 161,
  "timeout": 3,
  "maxDepth": 5,
  "maxDevices": 100
}
```

The crawl endpoint streams progress as `text/event-stream` events such as `start`, `probing`, `found`, `queued`, `dup`, `skip`, `warn` and `done`.

---

## Known Limitations

| Area | Limitation | Workaround |
|---|---|---|
| Cisco IOS Q-BRIDGE | `dot1qVlanStaticName` and egress bitmaps return empty without per-VLAN community context (`public@100`) | VTP MIB fallback is used automatically |
| VLAN bitmap size | Q-BRIDGE bitmaps cover VLANs 1–4094; extended range VLANs (4095+) not supported | — |
| SNMPv3 EngineID | Must be auto-discovered; manual EngineID entry not yet supported | Use v2c if v3 discovery fails |
| CDP | Read-only; Cisco proprietary CDP is polled but not written | Use LLDP where possible |
| Concurrent users | No WebSocket push; each browser polls independently | Refresh manually after another admin makes changes |
| Storage | File-based JSON; not suitable for >1000 projects or multi-server deployments | Migrate to a database backend for large scale |
| Physical Path | Segment editing (P1.5) supports linear chains through `port`-type pass-throughs (`wallport`, `patchpanel`, `voip`); `device`-type media converters are not yet offered as routing hops | Media-converter routing + automatic voice-VLAN tagging are archived for a later step |

---

## Roadmap

**Recently shipped:**
- [x] **Smartphone / Tablet endpoint + custom-value fix (June 2026)**: new unified floor endpoint **`mobile`** ("Smartphone / Tablet", `fa-mobile-screen-button`) with the basic useful fields — **Form factor** (smartphone/tablet), Brand/Model, OS (iOS/iPadOS/Android/Windows), **Ownership** (Corporate/BYOD), **MDM management**, Connection (Wi-Fi/Cellular). Also fixed a pre-existing bug where the **"Custom…" select value** wasn't kept on many device fields: `_resolveManualPropValue` read only `n[key]`, but device-specific fields live in `n.spec[key]` (`NODE_SPEC_FIELDS`) where `updateN` deletes `n[key]` — so the custom option wasn't re-detected on re-render and the select snapped back to default. It now reads `n.spec[key]` first, so the typed custom value sticks and stays selected.
- [x] **Grid & label polish (June 2026)**: the **grid toggle** moved into *Floor properties → Floor plan image* (next to scale/opacity), and disabling the grid now also **turns off snap-to-grid** — placement becomes free-to-the-pixel for drop/drag/resize of floor devices and floor-placed racks (shared `_snapFloor` helper in `src/app-pointer.js`, driven by per-project `gridHidden`). **Delivery dossier** *Port assignment* table: rebalanced column widths so the **Rack** column no longer truncates long rack names (e.g. `CED · Rack Accesso`), with wrap as a safety net (`server/pdf-report.js`). **Cable-label export**: removed the *Colore* and *Note* fields (client `export.js` + server `server/label-sheet.js`); on the printed label the **ID stays the primary text** while every other selected field is rendered a touch larger for legibility (~13px preview / ~9.75pt PDF, via `_ROLE_FS`). **Rack front-panel balance**: the port block now centers naturally between the left edge and the name tag (equal gaps, any port count) — the old leftward `translateX` on patch panels and high-density (`>16 ports/row`) devices was removed (it was the cause of the imbalance); SFP-layout devices keep their dedicated tuning (`styles/04-floor-rack.css`).
- [x] **Floor-plan polish (June 2026)**: per-project **map opacity** control (slider in *Floor properties → Floor plan image*, 5–100%, stored as `bgImageOpacity`, overrides the global 0.4 so a clean vector plan can be shown crisp); **login-page language switcher** (IT/EN inside the login card, shared with the app via `localStorage`); the **Floor plan context panel is now fully translated** (it/en) like the rest of the chrome; the *Type* dropdown in **Discover devices** is now sorted alphabetically; transported-VLAN field uses the same font as the native-VLAN field.
- [x] **Toolbar redesign + storage slimming (June 2026)**: **«Verifica documentazione»** promoted to a primary header action (out of the Report dropdown); the floating status chips (v3-pending / free-ports / auto-poll / VLAN-filter) unified into one **status cluster**; background automations (SNMP auto-poll + DHCP IP auto-renewal) gathered into an **«Automazioni rete» header popover** (moved out of the floor-plan panel); **label diet** (secondary buttons become icon-only, IT/EN switcher moved into the user menu). The **`Topology`** toggle moved onto the floor plan next to the VLAN filter (single **map view bar**). The `TRUNK` legend toggle again reveals trunk cables (highlighted) inside the **rack window** while in Topology view (gated to topology — no carry-over). New floor device type **NAS (desktop)** split out from the rack **Storage (SAN/RAID)** type. **`bgImage` extracted out of the project JSON** into a sidecar asset (`projects/assets/<id>.<ext>`, transparently re-attached as a data-URL on load) so saves and the project listing stay fast even with large maps. Golden-render UI baseline re-activated as a default test gate.
- [x] **Handoff Dossier (N4, "Living Documentation")**: one-click **"Dossier di consegna"** export — a complete handover PDF that bundles the existing report (planimetria, racks, ports, VLAN/IPAM, inventory, topology) plus a **cover page** (project, date, who generated it, device/cable/VLAN counts), a **notes** section (aggregated per-device notes) and a **recent changelog** (from the audit trail). Pure tested assembly (`lib/handoff.js`); the three new PDF pages reuse the existing pdfkit pipeline (`/api/export-pdf`), added as opt-in sections so the normal export is unchanged
- [x] **Audit Trail / Changelog (N2, "Living Documentation")**: append-only project journal of structural changes (who / when / what) — device add/remove/rename, cable create/remove, port VLAN change, SNMP sync, drift "update doc", project rename. "Storia" toolbar button opens a filterable history panel with **CSV export**; pure tested logic (`lib/audit-log.js`), additive `state.auditLog` (capped, excluded from undo snapshots so the trail survives undo/redo)
- [x] **Reality Check / Drift Report (N1, "Living Documentation")**: "Verifica documentazione" button → reuses the SNMP sync, then a pure tested diff engine (`lib/drift-report.js`) classifies doc-vs-reality into 6 categories (consistent / state drift / IP-change same-MAC / documented-but-absent / undocumented devices, minus `rejectedAutoLinks` / ghost cables down ≥ N syncs; presence later extended to a multi-signal ping/ARP/TCP sweep). Per-row 1-click actions (update doc / ignore-persistently / investigate). Additive persistence (`state.driftIgnores`, per-port `downStreak`); the SNMP sync itself is untouched
- [x] **Progressive patch-panel numbering**: explicit `ppContinueFrom` chain (or manual `ppStartNum`) so multiple panels share one continuous sequence (Panel B = 25–48 after a 24-port Panel A); display-only with stable port IDs, pure offset helper with cycle guard
- [x] **Manual-first topology + render consistency**: the **"manual always wins"** principle, reapplied across topology and cabling. ① **Routing = manual**: routed segments no longer inherit `autoLinked`/`protocol`/`confidence`, so SNMP sync never rewrites or duplicates a documented routing (the `!l.autoLinked` guard protects them). ② **Topology opens without a Sync**: it always draws from documented `state.links`; the SNMP layer (LLDP/CDP) is enrichment, with a **per-device** cache (partial OK, age shown) **persisted with the project** (`state.topoCache` + `_restoreTopoSession`) — reopening a project shows topology immediately, Sync only *refreshes* it. ③ **Gray-cable fixes**: the reuse path created a `{from,to}` segment without `src/dst` (a ghost link, gray, excluded from VLAN propagation) — now a real `{id,src,dst}` link + a migration that repairs already-saved malformed links; plus `chainVlanColorMap` (pure, tested) so an untagged downstream hop inherits the VLAN colour of its chain, and a VLAN-1 colour fallback in topology to match the floor. ④ **Cable UX in topology**: double-click a cable → highlights the physical path and opens Properties with **clickable segments** (reliable selection from the panel, since rack-side hops aren't clickable as a cable); the "show physical path" tooltip buttons are gone. ⑤ **Fan-out for all placed racks** (full floor↔rack overview) with non-current racks drawn display-only so they don't block rack dragging. VLAN members modal now lists only VLAN-**source** devices (802.1Q `source`/`capable` tiers)
- [x] **Cabling segment editor (P1.5 + P1.5-bis)**: highlight-mode routing of a cable through pass-through ports (no popups) — click a lit patch-panel/wall-socket port to split a cable into real segments, "remove hop" to merge back. Pure `lib/cabling.js` (split/merge, TIA-568 `canRouteThrough` hierarchy rule, `validateCablingChain` anomaly badge, `chainAmbiguousLinkIds`). VoIP daisy-chain support (`voip` as a level-0.5 pass-through: `PC → phone → socket → patch panel → switch`). 32 tests in `test/cabling.test.js`
- [x] **Chain-aware topology rendering** (`chainAmbiguousLinkIds`, pure/tested): aggregates a cable's inferred/manual state per physical chain. *(Note: routing now produces MANUAL segments per the manual-first principle — see the top entry — so a routed chain renders uniformly solid; the chain aggregation still applies to genuinely-inferred multi-hop chains.)*
- [x] **VLAN UX**: optional VLAN legend on the floor plan (toggle in the VLAN panel; always-on as the filter in Topology), and VLAN members modal with access ports grouped into per-device accordions
- [x] **Discovery reachability states**: explicit **On** (ping/SNMP confirmed) / **Osservato** (service/web/NetBIOS/ARP, unconfirmed) / **Inattivo** (passive-only or no signal) badges, with a multi-source Bayesian convergence bonus in `server/classify.js`
- [x] **app.js refactoring (R1-R5)**: god-file split from 5282 to ~2950 lines (−44%) into 5 new `lib/` modules — `app-types.js` (device catalog + node spec), `app-discovery-classify.js` (OUI map + identity matching + `_guessType`), `app-render-core.js` (renderAll/renderScope/renderFloor + cable paths), `app-topology-overlay.js` (topology overlay + VLAN legend), `app-pointer.js` (drag&drop + pointer events + link creation). Pure code-move, line-by-line equivalence with the previous version verified mechanically; zero duplicate functions and zero top-level `let`/`const` collisions across the 26 loaded scripts
- [x] **Rack scroll cable fixes** (two historical bugs surfaced by the refactor testing, confirmed pre-existing via `git stash` A/B test): ① `#rack-cable-overlay` is absolutely positioned inside the scrollable viewport and used to scroll away with the content while cable coordinates are viewport-relative — now re-pinned to the visible corner (`scrollTop`/`scrollLeft`) on every render, so cables stick to the LEDs while scrolling; ② pointerdown on the rack scrollbar fell into the "click on empty area → deselect" branch, making the selected cable vanish as soon as the slider was touched — scrollbar-zone clicks (beyond `clientWidth`/`clientHeight`) are now ignored
- [x] **Topology floor-floor segments**: cables between two non-structural floor nodes (e.g. PC ↔ wallport, AP ↔ wallport) are now rendered in topology view (passata 3 in `_renderTopoOverlayNow`). Endpoints anchored to tile edges via `_rectEdge`, same pattern as rack icons. VLAN filter for floor-floor pairs now operates **per-link** (`_linkMatchesVlanFilter`) instead of per-node, so segments stay visible even when `vlanProp` hasn't propagated to the endpoints
- [x] **Topology legend → VLAN pills**: top-right horizontal bar (`Filtra VLAN | pills | hint`). Pills clickable in topology (toggle filter), passive in Map (legend only). Rectangular shape (border-radius 4px) and styling uniform with library element tiles (`.equip-item`). Replaces the old hidden eye-icon per VLAN row. Bug fix: legend was rendering inside the transformed `#floor-canvas` (5000×5000) — moved to `#floorplan` (viewport-fixed) so it never drifts off-screen on zoom/pan. Bug fix listener: `handlePointerDown` now excludes `#topo-legend` from its catch-all `closest('#floorplan')` branch that was zeroing the VLAN filter right after a pill click
- [x] **Property panel UX phase 1+2**: 11 incongruences fixed (single-click port = props pane, drag/click threshold 5px, Esc deselects + clears link, `_propsExplicit` semantic flag replacing `_rackPropsExplicitId`, cursor crosshair during link-start, keyboard shortcuts 1/2/R/P for view+tab navigation, rack icon Map=Topology behavior, port rack click context-aware → killed the floating popup as redundant with Props pane)
- [x] **Render refactor (Fase 4 P1-P3)**: `renderScope(scope)` dispatcher (props/cables/topology/floor/rack/all), `renderTopoOverlay` coalesced with requestAnimationFrame (hover/drag rack now 60fps fluid even on 30+ racks), `renderFloor()` extracted as separate function (resize-room operations now ~3-5× faster — only floor rebuilds, not full DOM)
- [x] **Contesto planimetria → accordion**: collapsible sections (Immagine planimetria / VLAN / Colori workspace / Etichette) uniformed with device props panel pattern. Default open: image + VLAN. *(Auto-poll SNMP and DHCP IP auto-renewal later moved out of this panel into the «Automazioni rete» header popover — see the top entry.)* Persisted in localStorage. Fix regression from session 17: `Importa mappa` button was only visible when `state.bgImage` existed → impossible to load a map on a fresh project. Now always-visible primary button (label switches to "Sostituisci mappa…" when one is loaded)
- [x] Vector PDF / SVG export
- [x] VLAN IPAM (subnet/gateway/DNS per VLAN, in-subnet usage)
- [x] **L3-lite gateway** (`lib/l3-gateway.js`): promotes each VLAN's gateway from a plain IP to a **VLAN → routing-device binding**. Manual-first: auto-suggests the device whose IP matches the gateway (confirmable), explicit choice always wins, stale bindings are flagged not silently replaced. Shows up as an **"L3" badge** on the rack device, a read-only **"Gateway L3 / SVI"** section in its panel, and a **Report → Mappa L3** overlay (VLAN → subnet → gateway → device → #IPs → DNS, with orphan/out-of-subnet warnings + CSV export)
- [x] **Adopt undocumented (close-the-loop)** (`lib/drift-adopt.js`): from the Drift "In rete, non documentati" category, an **"Add to map…"** button (and per-row `+`) opens a *Scopri*-style picker — MAC + OUI vendor + VLAN + where-seen + a pre-guessed type — that creates the chosen nodes (rack/floor), dedups against existing MACs, optionally **auto-cables them to the FDB port** where the network saw them (reusing `_autoLinkEndpoint`), and recomputes the Drift so adopted rows disappear
- [x] **Free ports report** (`lib/spare-ports.js`): "where do I plug the new device?" — rack highlight (free=green, SNMP-active-but-uncabled=amber), per rack→device totals, CSV + optional A4 PDF page / delivery dossier section
- [x] **Drift category rename**: symmetric pair **"Documentati, assenti in rete"** (in project, absent from network) ↔ **"In rete, non documentati"** (on network, absent from project)
- [x] **Wireless link (Packet-Tracer style)** (`lib/wave-path.js`): per-link `wireless` flag rendered as a true **sine-wave** path (integer cycles → exact endpoints) instead of a straight cable, so radio associations read at a glance. Toggle **📶 Wireless** in the link panel (skips physical-cable validation: medium/category/length don't apply), **auto-suggested** when one end is an AP. Pure tested geometry
- [x] Deep network discovery (TCP/NetBIOS/SMB) + device auto-classification & confidence scoring
- [x] Multi-vendor LAG detection (logical id) and brand-agnostic member parsing
- [x] Dependency-free regression test suite + GitHub Actions CI
- [x] Server modularization (server.js → routers + domain modules under `server/`)
- [x] Explicit link states (manual / lag / discovered / ambiguous) with visual cues
- [x] IPAM range/gateway/DNS in the PDF VLAN summary
- [x] Correlation engine — pure primitives in `lib/correlate.js`: `pairSig`, `createCandidateSet`, `matchNodeByIdent`, `buildPortIndex`, `buildMacIndex`, `buildPortMacIndex`, `findPortByIfName`, `buildNeighborCandidates`, `buildFdbCandidates`
- [x] Server-side topology correlation in `/api/topology` for `LLDP/CDP`, `FDB`, `ARP+FDB`, with additive `suggestedLinks` and base `suggestedSharedSegments`
- [x] Frontend modularization advanced (`lib/app-core.js`, `lib/app-auth.js`, `lib/app-discovery.js`, `lib/app-topology-crawl.js`, `lib/app-csv-import.js`, `lib/app-ports.js`, `lib/app-popup.js`, `lib/app-management.js`, `lib/app-search-zoom-rack.js`, `lib/app-vlan-autopoll.js`, `lib/app-autolink.js`, `lib/app-properties.js`)
- [x] Shared-segment UI hint: `suggestedSharedSegments` from server fills `sharedSegmentHint` on ports — the classification panel (Switch/AP/Gateway/Uplink/Hypervisor) appears immediately after the first SNMP sync, even without local discovery history
- [x] Manual > automatic priority: user-edited `hostname`, `ip` and `integration.host` are never overwritten by SNMP/discovery (flag-protected: `hostnameManual`, `ipManual`, `integration.hostManual`)
- [x] Contextual confidence in `_buildDiscoveryMeta`: LLDP/CDP neighbor +15, SNMP+sysServices class-confirmed +15, multi-source convergence +5/+3
- [x] Real-device regression tests in `test/discovery.test.js` for Zyxel, ArubaCX, Cisco IOSv/IOSvL2, HP printer, Reolink, Sony Bravia, LG webOS, NVIDIA Shield, Synology/LaCie NAS, Eaton UPS, VMware ESXi, Windows PC, Daikin IoT, Chromecast
- [x] Rack front-panel refinement: numeric-only front labels, compact 8/24/48-port spacing, simplified per-device layout controls, and SNMP status moved from the old green dot to the left status stripe
- [x] Device-specific property fixes after layout refactor: `patchpanel` keeps an editable `Numero porte` field while passive fillers stay intentionally minimal
- [x] Properties panel polish: shared `Rete & Accesso` block for hostname/IP/management/MAC, collapsible `Note`, and header icon actions for expand/collapse/reset/delete
- [x] `panelboard` properties aligned to the same pattern as the other floor/passive devices: `Nome / ID` outside, technical electrical fields inside the dedicated accordion
- [x] Cable foundation metadata: physical/documentation fields on links (`cableType`, `lengthM`, `color`, `installedAt`, `installedBy`, `isPermanent`, `notes`) with soft migration and legacy-field normalization
- [x] Read-only `Physical Path` accordion in cable properties with inferred full-path reconstruction and selected-segment highlighting for linear chains through pass-through devices
- [x] Semantic pass-through model for path inference (`wallport`, `patchpanel`, `mediaconv`) instead of hardcoded type checks
- [x] Shared-segment workflow simplified: the port popup now shows only a compact shared-link warning, while classification/confirmation lives in the Properties accordion
- [x] Physical trace now highlights the inferred cable path segments directly instead of walking every reachable adjacent link from the source port
- [x] Cable properties header aligned with device properties: expand/collapse/reset/delete icon group, no oversized delete button at the bottom
- [x] Rack device chrome: fixed-size black `.rack-label` tag (name/ID, 0.48rem), hostname moved from inline brand to native `title` tooltip — frees space for ports on dense switches
- [x] LED tooltips harmonized across rack and floor (`title` HTML native): `Porta N · ifName · speed · VLAN · LAG` identical everywhere
- [x] Light theme polish: rack-view LEDs keep vivid dark-theme colors (scoped variable override); all inputs/selects/textareas force white background; `.toolbar-btn.danger` shows vibrant `#f85149` red; `#project-select` forced white via explicit specificity override
- [x] Topology open via Sync SNMP cache: `_topoNeighborsCache` populated during `_autoDiscoverLinks`, reused by `discoverTopology()` with 60-min TTL; button enters `'stale'` state when cache expires, hinting the user to run Sync
- [x] Rack cable re-render after zoom: deferred `renderCables` at 140ms compensates the `.rack-chassis-wrap` 100ms CSS transition so cables re-align to LED positions without needing a port click
- [x] Port layout panel unified across all rack devices with ports (incl. `patchpanel`): same controls as switches (port count, base layout, top numbering, odd-on-top, reset). SFP-related controls hidden on `patchpanel` since passive panels have no SFP logic
- [x] Patch panel physical typology (Step A): new `ppMedia` (copper/fiber/mixed), `ppCopperCat` (Cat 5e/6/6A/7/8), `ppCopperShield` (UTP/FTP/STP), `ppFiberConnector` (LC simplex/duplex, SC, ST, FC, MTP/MPO-12/24), `ppFiberMode` (SM OS1/OS2, MM OM1–OM5). Data-only, no rendering change yet
- [x] Per-rack U numbering (Option B): `rack.uNumberFromTop` flag — ruler, property panel and PNG export show "1 at top" (telco/ETSI style) without altering internal `rackU` (always 1=bottom). Toggle in Rack menu. Helpers: `isRackTopNumbered`, `rackUToVisible`, `visibleUToRackU`
- [x] Light theme borders sharpened: `--panel-border` now `rgba(0,0,0,0.5)` — all dividers/borders/inputs/panel edges inherit the 50% black
- [x] Light theme floor nodes: `.floor-node` and `.floor-rack` background `#cccccc`, border `#808080`, main icon `#808080` — uniform muted palette on the floor plan
- [x] Header tooltip anti-clipping: `[data-tip]` on header buttons opens below the button instead of above (was being clipped by `body{overflow:hidden}` at viewport top)
- [x] Management protocols (Option C): per-device protocol selector + optional URL override. Default list: HTTPS / HTTP / SSH / Telnet / RDP / VNC / WinBox. **User-extensible**: gear icon next to the selector opens an editor where you can add/remove protocols dynamically (label + scheme), persisted in `localStorage`. No username/password stored — IP only. Data: `n.mgmtProto`, `n.mgmtUrl` (override). Launch strategy: HTTP(S) opens in a new tab; every other scheme is delegated to the OS-registered handler via a hidden iframe — no blank tabs, no downloads. If the handler isn't registered, the click is a silent no-op (recommended clients: PuTTY/MobaXterm for SSH, mRemoteNG/Royal TS for RDP, RealVNC/TightVNC for VNC, WinBox for MikroTik)
- [x] sysObjectID intelligence engine integrated into server classification: plugin-based zero-database resolver under `engine/` + seed vendor/OS catalog under `plugins/`, with hot-reload, longest-prefix-wins, per-instance isolation, OS/agent fingerprinting and a future SQLite seam
- [x] Node `spec` refactor: type-specific device fields are stored under `node.spec` with soft migration and legacy-compatible property reads
- [x] ENTITY-MIB native inventory: SNMP poll extracts `brand`, `model`, `serialNumber`, `firmwareVer` and exposes them in the device `Inventario` accordion
- [x] Device catalog — Pack B (edge & physical security): five new device types covering the most common gaps vs commercial DCIM tools
  - **NVR / Videosorveglianza** (rack 2U): platform, channels, storage TB, retention days, codec, CCTV VLAN — pairs naturally with floor webcams
  - **SD-WAN Edge** (rack 1U): platform (Meraki/VeloCloud/Versa/Fortinet/Aruba EC/Prisma/Cato/Peplink), WAN uplinks, throughput, mode, cloud controller URL
  - **VPN Concentrator** (rack 1U): platform, mode (site-to-site / remote / both), enabled protocols (IPsec/SSL/WireGuard/L2TP), max concurrent sessions, licenses
  - **Door Controller** (floor): platform (HID/Axis/Suprema/ZKTeco/Genetec/Paxton/BFT), managed doors, reader technology (Mifare/Prox/NFC/biometric/PIN), PoE, access-control VLAN
  - **Quadro elettrico** (floor passive): supply type (1ph 230 / 3ph 400 / 3ph 690 / DC -48), nominal current, DIN modules, upstream source, RCD/SPD flags, feeds-UPS flag — completes the electrical chain panelboard → UPS/ATS → PDU
- [x] OUI intelligence engine — plugin-based, hot-reload, longest-prefix-wins with priority tie-break, compact trie lookup (~10× faster than Map probing). 32 seed plugins (virtual NICs / network / endpoint / IoT / NAS / printer / security) plus full IEEE database snapshot (~57k entries, MA-L + MA-M + MA-S + IAB) regenerable via `npm run update-oui`
- [x] Fusion Scoring Engine — pure module `engine/fusion-scorer.js` that fuses sysObjectID, OUI, sysServices, TCP ports and hostname/banner regex into `{deviceType, confidence 10-99, alternatives, scores, evidences, reasons}`. 14 parity tests vs the legacy classifier
- [x] Virtual MAC filter in auto-link: Docker / VMware / Hyper-V / Xen / KVM MACs detected via OUI engine and excluded from suggested links and shared-segment thresholds. Payload exposes `physicalMacCount` + `virtualMacCount` breakdown
- [x] Discovery freeze fix on LLDP crawl: signature check opt-out and lookup dedup
- [x] Front panel: unified `oneBottom` flag (refactor of legacy `numberTop` + `oddTop` which were conceptually the same thing)
- [x] Properties panel preview chips on closed accordions (LAG, Integration, Inventario): summary visible at a glance
- [x] Dedicated MGMT ports on the rack front: 1..4 cells per device (cyan border, Cisco console-cable convention), grid mirror of the SFP block, independent left/right position, editable base label (MGMT, iLO, iDRAC, me, fxp0, …). Pid namespace `${nodeId}-mgmt<N>` outside the `1..N` data-port range, fully excluded from VLAN/LAG/FDB. Eligibility flag on 13 device types
- [x] SFP cells re-coloured silver-metal `#9aa5b1` (anodised cage, neutral) — WCAG contrast verified on both dark and light themes
- [x] Layout porte panel UX uniformity: SFP and MGMT both use `count + position` controls (no more standalone checkboxes); `Layout base` is now a 4-thumbnail visual radio-button group (Auto / Linear / Sequential / Alternating) with numeric hints (`1` / `5` vs `1` / `2`) to distinguish sequential from Cisco-alternating at a glance
- [x] PDF export now renders MGMT and SFP as separate side blocks on the rack SVG via a shared `drawSideBlock` helper; the port-assignment table lists MGMT ports per device with their textual label as identifier
- [x] **Stacking support** (Cisco StackWise / Aruba VSF / Juniper Virtual Chassis / HPE IRF) — full 3-phase implementation: tag-based model on `node.spec.stackId` + `stackMemberId` + `stackRole`. Phase A: data model + Properties accordion + cyan `is-stacked` rack label. Phase B: `<member>/0/<port>` port numbering qualifier + cross-member LAG highlight + master→members sync of hostname/IP/SNMP. Phase C: SNMP auto-detection via `ifDescr` parsing (Cisco/Aruba/Juniper/Arista patterns) with detection banner in Properties. Out of scope: VSS/VSX/MC-LAG (different problem) and modular chassis with line cards (structural redesign)
- [x] **HA pair / cluster modeling — Tappa A**: tag-based model on `node.spec.haPeer` (1-1 pair) or `node.spec.haGroupId` (cluster N>2), mutually exclusive. Properties accordion with role (Active/Standby/Master/Slave/Peer), mode (active-standby / active-active), sync state. Orange `is-ha` rack label. Symmetric propagation: setting A.peer=B auto-sets B.peer=A with complementary role. Eligibility flag on 8 device types (firewall, router, switch L3, server, NAS, hypervisor, SD-WAN edge, VPN concentrator). Tappa B (HA-dedicated cables) and Tappa C (SNMP auto-detection) parked as optional
- [x] **SFP independent numbering**: optional `sfpStartNum` + `sfpPrefix` per SFP block — supports Cisco Cat 9300 (`Te1-4`), Cisco 9500 (`Hu49-52`), Aruba (`xe1-4`), Juniper (`xe-0/0/48`) numbering conventions without coupling SFP numbers to data port range
- [x] **Second SFP block** (`sfp2Count` + `sfp2StartNum` + `sfp2Prefix`): for enterprise devices with two distinct uplink groups, e.g. Cisco Cat 9300X-24Y4D (24 data + 4 Te + 4 Hu), Juniper QFX5120-48Y8C, Arista 7050QX-32
- [x] **UI infrastructure refactor** (June 2026): Font Awesome 6.4.0 self-hosted in `vendor/fontawesome/` (no CDN dependency, app works offline); modal system unified on `.tool-modal-*` (3 legacy modals migrated, ~50 inline-style removed); typography scale tokens `--fs-xs/sm/md/lg/xl/2xl` in `:root` with full migration of 157 `font-size` occurrences in `style.css`; "Tenta collegamento automatico" button relocated inside "Rete & Accesso" accordion (co-locality with MAC field)
- [x] **Click workflow refactor**: double-click on rack port → Properties tab; double-click on rack device → Properties tab with auto tab switch; double-click on empty map area → "Planimetria" panel (Map + VLAN/IPAM + workspace colors); single-click on floor device port → immediate Properties tab; double-click on floor device port → switch to connected rack + Rack tab + cable highlighted; click on rack icon in topology → opens rack window. Manual timestamp-based dblclick detection on floor ports (native `dblclick` doesn't fire because `renderAll()` rebuilds the DOM between clicks)
- [x] **Visual differentiation inferred vs confirmed cables**: in Topology view, inter-rack and rack↔floor fan-out lines containing at least one inferred cable get a slow 2.5s dash animation; racks with intra-rack inferred cables get a pulsing yellow "!" badge for quick scan. In rack/floor view, confirmed cables stay static; inferred cables get a 1s dash animation (active investigation pace), preserving VLAN color. Cable thickness reduced to 60% of original (1.5/3/2.4/2.7 stroke-width) for cleaner look. In cable Properties: "Stato" badge shows orange "AUTO" label for inferred cables (matching the topology yellow alert convention)
- [x] **Map cleanup + scan robustness**: removed "Planimetria" dropdown menu (top-left of floor) and "Modalità" indicator (bottom-right) — both replaced by double-click on empty map area opening the existing properties panel. Click on the dark overlay outside a Discovery or Topology Crawl modal during a scan no longer aborts the operation (toast warns to use the explicit "Annulla" button). Cable "MAC viste su questa porta" block deduplicated: the MAC list is now unique inside "Segmento L2 condiviso" with full visibility (max-height 280px, no more `+N altri` truncation)

- [x] **SNMP parameter import** (June 2026): live read-only cards in the Integration panel for **system info** (sysLocation / sysContact / sysUpTime — any IP device), **Printer-MIB** (toner/ink % per colorant, page count, status — printers) and **HOST-RESOURCES** (CPU / RAM / disk — server/pc/nas/homelab). Manual-first (never overwrites manual fields). Printer-MIB read in a concurrency-1 isolated pass (weak agent stacks truncate supplies under concurrent walks); HOST-RESOURCES storage table filters pseudo-fs and de-duplicates bind-mounts. Validated end-to-end on real hardware (HP OfficeJet, Synology NAS).

**Planned:**
- [ ] Permanent link vs patch cord — full segment editing UI (read-only `Physical Path` is shipped; the editor is the missing piece)
- [ ] UPS-MIB (RFC 1628) dynamic polling: runtime min remaining, battery %, V/A for any RFC-compliant UPS
- [ ] `ENTITY-SENSOR-MIB` (temperatures/fans/PSU) + real PoE wattage (`POWER-ETHERNET pethPsePortPower`) per switch
- [ ] Explicit topology states in UI: `exact / probable / ambiguous / shared-segment / uplink-to-unknown` with distinct visual styles
- [ ] SQLite-backed storage for discovery history, IP history, FDB cache and audit log (branch `feat/sqlite-store` when ready)
- [ ] Internal discovery/classification hardening: richer local sysObjectID plugins, standard MIB coverage and more real-device regression tests
- [ ] **Topology scoring multi-source fusion**: boost confidence when LLDP and MAC FDB independently agree on the same pairing; bidirectional cross-check (MAC seen on switch port ↔ `ifPhysAddress` on the remote device ↔ ARP entry); stricter `macsOnPort` thresholds to detect unmanaged switches hidden behind managed ports
- [ ] Docker image + `docker-compose.yml`

**Out of scope** (parked):
- WebSocket multi-user live push (single-user persona)
- SNMP trap receiver (would shift product identity toward NMS-light, decision not taken)
- Temporal confidence on links (depends on SQLite + niche)
- Per-VLAN community auto-config wizard for Cisco IOS (vendor-specific niche)
- BGP4-MIB, POWER-ETHERNET-MIB, Print-MIB (low ROI for PMI sysadmin persona)
- Conduits / cable trays modeling (datacenter/enterprise) — abandoned 2026-06-12
- Fiber loss budget / dB attenuation math (cabling-engineering tool, not a documentation persona) — abandoned 2026-06-12; the useful part (copper length & speed/category checks vs TIA-568) ships as smart cable validation
- HA Tappe B+C, vendor-specific MIBs — open on demand

---

## Testing

The project ships with a **zero-dependency** regression suite built on Node's
built-in test runner (`node --test`). No framework, no `node_modules` for tests.

```bash
npm test              # run the regression suite (node --test)
npm run check         # syntax-check all project JS sources
npm run typecheck     # JSDoc + checkJs type-check of the pure libs (tsc --noEmit)
npm run build         # bundle the migrated ESM frontend modules (esbuild → dist/)
RUN_E2E=1 npm run e2e # headless end-to-end in a real Chrome (login bypass) — off by default
```

A real **headless E2E** (`test/e2e/`, Playwright on the system Chrome via
`INFRANET_DEV_NO_AUTH`) drives the critical flows in a real browser (cable
routing, VLAN propagation, wireless, rack drag/pan); it spawns an isolated
server on a temp store and is skipped unless `RUN_E2E=1`.

Coverage focuses on the pure, bug-prone logic that has historically broken:

| Area | File | What it locks in |
|---|---|---|
| SNMP parsing | `test/snmp.test.js` | `decodePortList` (IEEE 802.1D bitmap), `macToStr`, `bufToInt`, multi-vendor LAG name → logical id |
| SNMP end-to-end | `test/extractData.test.js` | `extractData` interface/LAG/VLAN/ENTITY-MIB inventory extraction, incl. ArubaCX name-list LAG → logical `lagId` |
| Discovery | `test/discovery.test.js` | device classification, unified discovery record/confidence, NetBIOS & SMB output parsing, 14 real-device regression cases |
| Correlation primitives | `test/correlate.test.js` | `pairSig`, `matchNodeByIdent`, `findPortByIfName`, `buildPortIndex`, `buildMacIndex`, `buildNeighborCandidates`, `buildFdbCandidates` with virtual-MAC filter |
| sysObjectID engine | `tests/sysobject-engine.test.js` | isolated instances, hot-reload add/remove, plugin failure isolation, longest-prefix-wins, seed catalog, OS fingerprints |
| OUI engine | `tests/oui-engine.test.js` | longest-prefix-wins, plugin priority tie-break, trie lookup, IEEE database fallback, virtual / locally-administered / multicast helpers |
| Fusion scorer | `tests/fusion-scorer.test.js` | behavioural parity with the legacy classifier across 14 real-device cases, plus structured output (`deviceType`, `confidence`, `alternatives`, `scores`, `evidences`, `reasons`) |
| Front-panel state | `test/frontpanel.test.js` | `frontPanelState`/`frontPanelLegacyState` derivation: `oneBottom` flag, SFP count + position, MGMT count (0..4) + position + label, eligibility filter, back-compat reads for legacy `mgmtPort` boolean and pre-`baseLayout` projects |
| Cable validation | `test/cable-validate.test.js` | `validateCable` smart compatibility rules (medium/category/connector, copper speed vs TIA-568, length, PoE-on-fiber, SNMP cross-checks) |
| **App smoke E2E** | `test/smoke-app.test.js` | loads **all** `netmapper.html` scripts (the pure `lib/*.js`, `app.js`, `export.js` **and the esbuild bundle `dist/app.bundle.js`** — which now carries every ex-`lib/app-*.js` glue module) into a zero-dependency `vm` + forgiving DOM stub, then exercises `renderAll` / `renderProps` on **every** device type and on a cable, asserting nothing throws. Catches script-order regressions, missing globals and render crashes that the pure-unit tests can't see — the safety net for glue refactors. Requires `npm run build` first. DOM stub lives in `tools/smoke-dom-stub.js` (not a test file). |

Current local quality baseline:
- `npm run check` validates all project JS sources (~140 files)
- `npm test` runs the full regression suite (currently 460+ tests, all passing)
- final visual verification is still important for rack/front-panel refinements

> Pure functions are exposed for tests via an additive `_internals` export on
> `drivers/snmp.js` and `server.js` — runtime behaviour is unaffected.
> `server.js` starts its listener only under `require.main === module`, so it can
> be imported by tests without binding a port.

**CI** ([GitHub Actions](.github/workflows/ci.yml)) runs `npm run check` and
`npm test` on every push and pull request to `main`, across Node 18 and 20.

---

## Feedback & requests

Found a bug, or want to request a change? Here's where it goes:

- 🐞 **Bugs** → open an [issue](https://github.com/muttley1973/infranetpro/issues/new/choose) using the **Bug report** template (steps, version, OS, logs).
- 💡 **Feature requests / changes** → open an [issue](https://github.com/muttley1973/infranetpro/issues/new/choose) using the **Feature request** template.
- 💬 **Questions & ideas** → start a [Discussion](https://github.com/muttley1973/infranetpro/discussions) — best for open-ended ideas before they become a concrete issue.
- 💼 **Commercial license / private enquiries** → see [LICENSING.md](LICENSING.md).

## Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork** the repository and create a feature branch (`git checkout -b feature/my-feature`)
2. Respect the **minimal-build philosophy** — the only frontend build step is the lightweight esbuild bundle of the `src/` ESM glue (`npm run build` → `dist/app.bundle.js`, run automatically by `npm install`/`npm start`). The pure `lib/*.js`, `app.js`, `export.js` and the modular `styles/` CSS stay plain static assets loaded directly; no transpile step
3. New device drivers go in `drivers/<protocol>.js` and must export `poll(cfg)`, `probe(cfg)` and optionally `pollNeighbors(cfg)`
4. Test against real hardware or a GNS3/EVE-NG lab before submitting
5. Open a **Pull Request** with a clear description of what changed and why

### Adding a Driver

```javascript
// drivers/myprotocol.js
'use strict';

/**
 * @param {object} cfg  { host, port, timeout, ...protocolOptions }
 * @returns {Promise<{ hostname, interfaces, lags, vlans }>}
 */
async function poll(cfg) {
  // ... your implementation
  return { hostname, interfaces, lags, vlans };
}

/**
 * Quick reachability probe — used by /api/discover
 * @returns {Promise<{ reachable: boolean, hostname?: string, descr?: string }>}
 */
async function probe(cfg) {
  // ...
  return { reachable: true, hostname: 'myswitch' };
}

module.exports = { poll, probe };
```

Register it in `server.js`:
```javascript
const DRIVERS = {
  'snmp-v2c':     loadDriver('snmp'),
  'myprotocol':   loadDriver('myprotocol'),   // ← add here
};
```

---

## Support

InfraNet Pro is free and open source (AGPLv3). If it saves you time, you can support
its development with a coffee on Ko-fi — it funds the work that keeps new features
coming. ☕

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/infranetpro)

> Need it adapted to your company's specific devices/APIs, or embedded in a closed-source
> product? Custom integration and commercial licensing are available — see [LICENSING.md](LICENSING.md).

---

## License

**GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)** — Copyright © 2026 [muttley1973](https://github.com/muttley1973). Full text in [LICENSE](LICENSE).

InfraNet Pro is free software: you can use, study, share and modify it under the
terms of the AGPLv3. In short — if you run a modified version to provide a service
over a network, you must make your modified source available to its users.

A **commercial license** is available for organizations that prefer not to be bound
by the AGPL copyleft obligations (e.g. embedding InfraNet Pro in a closed-source
product). **Custom integration** to specific device APIs is also offered. See
[LICENSING.md](LICENSING.md) for details and contact.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU AGPL for more details.

---

<p align="center">
  Built with ❤️ for network engineers who prefer developing with a coding agent.
</p>


