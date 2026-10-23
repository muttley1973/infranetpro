<div align="center">

<img src="GitHub%20Images/hero.png" alt="InfraNet Pro — document your network, then let SNMP prove the drawing is still true" width="100%">

<p>
  <a href="https://github.com/muttley1973/infranetpro/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/muttley1973/infranetpro/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/muttley1973/infranetpro/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/muttley1973/infranetpro?label=release&color=00b3d6"></a>
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-1f6feb"></a>
  <a href="https://nodejs.org/"><img alt="Node.js 16 or newer" src="https://img.shields.io/badge/Node.js-%E2%89%A5%2016-3fb950?logo=nodedotjs&logoColor=white"></a>
  <a href="#docker"><img alt="Docker ready" src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white"></a>
</p>
<p>
  <a href="#testing"><img alt="4,307 tests, 0 failing" src="https://img.shields.io/badge/tests-4%2C307%20%C2%B7%200%20failing-3fb950"></a>
  <a href="#testing"><img alt="149 real-browser end-to-end flows" src="https://img.shields.io/badge/e2e-149%20real--browser%20flows-3fb950"></a>
  <a href="#snmp-integration"><img alt="SNMP v1, v2c and v3" src="https://img.shields.io/badge/SNMP-v1%20%C2%B7%20v2c%20%C2%B7%20v3-00b3d6"></a>
  <a href="#discovery--classification-engines"><img alt="About 57,000 IEEE OUI entries" src="https://img.shields.io/badge/IEEE%20OUI-~57k-8957e5"></a>
  <img alt="No database" src="https://img.shields.io/badge/database-none-8b949e">
</p>

<p>
  <a href="#quick-start"><b>Quick start</b></a> &nbsp;·&nbsp;
  <a href="#features"><b>Features</b></a> &nbsp;·&nbsp;
  <a href="#screenshots"><b>Screenshots</b></a> &nbsp;·&nbsp;
  <a href="#architecture"><b>Architecture</b></a> &nbsp;·&nbsp;
  <a href="#rest-api-v1"><b>REST API</b></a> &nbsp;·&nbsp;
  <a href="#roadmap"><b>Roadmap</b></a> &nbsp;·&nbsp;
  <a href="CHANGELOG.md"><b>Changelog</b></a>
</p>

<table>
<tr>
<td align="center" width="50%">
<a href="MANUALE_TECNICO_IT.pdf"><img src="GitHub%20Images/flag-it.svg" width="26" alt=""><br><b>Manuale tecnico — Italiano</b></a><br>
<sub>70 pagine illustrate · interfaccia, onboarding e manuale completi in italiano, con selettore IT/EN nell'app.</sub>
</td>
<td align="center" width="50%">
<a href="TECHNICAL_MANUAL_EN.pdf"><img src="GitHub%20Images/flag-gb.svg" width="26" alt=""><br><b>Technical manual — English</b></a><br>
<sub>73 illustrated pages · fully bilingual UI, onboarding and manual, with an in-app IT/EN switcher.</sub>
</td>
</tr>
</table>

<a href="https://ko-fi.com/infranetpro"><img height="34" alt="Support InfraNet Pro on Ko-fi" src="https://ko-fi.com/img/githubbutton_sm.svg"></a><br>
<sub><b>InfraNet Pro is free and open source.</b> If it helps your work, a coffee funds the next feature. ☕</sub>

</div>

---

<p align="center">
  <img src="GitHub%20Images/demo.gif" alt="InfraNet Pro — a quick tour: topology, live racks, VLAN isolation, SNMP discovery and the AI assistant" width="900"><br>
  <em>A quick tour — auto-discovered topology, live 19″ racks, one-click VLAN isolation, SNMP discovery and the grounded AI assistant. <a href="#screenshots">More screenshots ↓</a></em>
</p>

---

## The difference, in four lines

- A **DCIM stores what you declare** and never checks it. A **monitor draws what it measures** and never holds a declaration.
- **InfraNet Pro keeps both — and the product is the disagreement.** One button compares the document against the live network in **nine categories**, including the two most tools never separate: *documented but absent* (we looked, it is gone) and *not verifiable* (the sweep never reached that subnet).
- A device that should answer SNMP but stays quiet is counted as **silent to this key**, not as one without SNMP — most often it is the wrong community.
- When it could not look at enough of the network to judge, **it says so instead of handing you a number**.

That is the whole idea: a document you can hand to a client, that tells you what it could not check.

<p align="center">
  <img src="GitHub%20Images/verify.png" width="640" alt="The Dashboard's Conformance column after a check: every SNMP device answering, one address that changed on the same MAC, two devices on the network that the document does not know, and the seven declared LAN networks each with its own verdict, one of them marked not reached by the check with its 13 unverified devices nested underneath"><br>
  <em><b>The check, on a demo network.</b> A subnet marked <i>not reached by the check</i> carries its unverified devices — they are not reported as absent, because nothing proved an absence. A MAC that moved address is a <i>changed IP</i>, not a new device.</em>
</p>

---

## What it is

InfraNet Pro is a **self-hosted web application** for documenting a network and then proving the document still matches it. You draw the racks and the floor plan; one button polls the real devices over SNMP and reports, row by row, where the drawing and the network disagree — and where it could not check. No external database, no cloud dependency, minimal tooling (a lightweight esbuild bundle that `npm start` builds).

- **🗺️ The drawing checks itself** — port state, an IP change on the same MAC, a swapped serial, a device that vanished, a cable that never existed.
- **✋ Manual-first, always** — what you declare is law. Discovery *proposes* and never overwrites: edited fields carry a padlock, and a measurement that disagrees is raised as a warning.
- **🚫 It never bluffs** — every figure declares where it came from (declared, measured with its age, or derived). A number nobody measured shows as a dash, not a zero, and each lens names what it is *not* looking at.
- **📦 Zero infrastructure** — one Node process and one JSON file per project. No database, no cloud, no agent on your devices, no telemetry. Binds to `127.0.0.1` by default; runs in Docker with one command.
- **🔌 Standard MIBs, any vendor** — IF-MIB, Q-BRIDGE, LLDP/CDP, ENTITY-MIB, IEEE 802.3ad, UPS-MIB, Printer-MIB, HOST-RESOURCES. Vendor intelligence lives in hot-reloadable local plugins, never in the scan path.
- **📤 Built to hand over** — a vector PDF dossier with an audit-ready asset register, editable draw.io racks, printable cable labels, a read-only REST API and a ready-made Ansible inventory.
- **🧭 Engines stay inside the app** — discovery and classification are internal; an external engine could only be a secondary evidence source, never a runtime dependency. Integrations with vendor or platform APIs can be built on request — see [Feedback & requests](#feedback--requests).

---

## Quick start

```bash
git clone https://github.com/muttley1973/infranetpro.git
cd infranetpro
npm install
npm start
```

Open **http://localhost:8421**. An **admin** account is created on first start with a random password, printed once in the console — change it right away from the user menu (**Change password**).

- 🐳 **Container:** `docker compose up -d --build` — host networking by default, so discovery is complete. See [Docker](#docker).
- 🖥️ **Windows:** double-click `avvia.bat`. Details in [Installation](#installation) and [Configuration](#configuration).
- **Your first five minutes:** *New project* → **Add device** → give it an IP → **Properties → Integration** → community → **Poll**. Then **Discover subnet** on your LAN, and press **Verify** to see your document compared against the live network, row by row.

> 📰 **What's new (v2.11.19) — the dossier lives inside Export PDF, the catalogue update works again, and the manuals describe the interface as it is.**
>
> - The handover dossier is no longer a menu entry: the Export PDF dialog opens with it locked on (cover page and change history) and every section starts unticked, so the PDF carries what you tick.
> - The hardware catalogue update no longer stops when the source library grows; the catalogue in use now has 5,502 models.
> - Both manuals draw the toolbar and the status bar as they are, and the README screenshots show the current interface.
>
> Earlier:
> - **v2.11.18** — a machine you documented stays documented, Ctrl+Z does what it says, and the VM card closes like the host panel.
> - **v2.11.17** — a neighbour is created as what it announces over LLDP/CDP; a hostile id can no longer run code; "0 found" says when the scan could not look.
> - **v2.11.16** — a value says where it comes from; a model you typed is no longer called a swapped device.
> - **v2.11.15** — the map and the rack work with a finger on a tablet; the History says what the Sync really read.
> - **v2.11.14** — a device that never answers no longer freezes the monitoring; a *Port descriptions* report.
>
> Every release, in detail: [CHANGELOG.md](CHANGELOG.md).

---

## Screenshots

<p align="center">
  <b>Full feature manual (PDF)</b> —
  <a href="MANUALE_TECNICO_IT.pdf"><img src="GitHub%20Images/flag-it.svg" width="20" alt=""> Italiano</a> ·
  <a href="TECHNICAL_MANUAL_EN.pdf"><img src="GitHub%20Images/flag-gb.svg" width="20" alt=""> English</a><br>
  <sub>Dark cover, white printable interior, 22 illustrated chapters — 70 pages in Italian, 73 in English.</sub>
</p>

<p align="center">
  <img src="GitHub%20Images/Multisito.png" alt="InfraNet Pro — Sites and links: the multi-site map, with each site's WAN lines, the tunnels between them and the coherence counters" width="900"><br>
  <em>Sites and links — each site with its WAN lines, the tunnels between them and the counters of what does not add up. Click a site to walk down into its project.</em>
</p>

<p align="center">
  <img src="GitHub%20Images/Topologia.png" alt="InfraNet Pro — topology view" width="900"><br>
  <em>Topology — auto-discovered L1/L2 neighbours (LLDP / CDP / FDB) drawn over the floor plan</em>
</p>

<p align="center">
  <img src="GitHub%20Images/pannello%20Panoramica.png" alt="InfraNet Pro — the Dashboard: three columns of verdicts with the provenance of every figure" width="900"><br>
  <em>Dashboard — three standing questions in three columns, every number carrying its <b>provenance</b>. <sub>(Shown in Italian — the whole UI ships in both languages.)</sub></em>
</p>

| Rack view | Rack detail |
|:---:|:---:|
| ![Rack view](GitHub%20Images/Rack.png) | ![Rack detail](GitHub%20Images/Dettaglio%20Rack.png) |
| 19″ rack with live, colour-coded port LEDs and an SNMP status stripe | Front-panel detail: port numbering, MGMT / SFP blocks |

| VLAN filter | Physical cable path |
|:---:|:---:|
| ![VLAN filter](GitHub%20Images/Filtra%20Vlan.png) | ![Physical path](GitHub%20Images/Connessione%20fisica.png) |
| Isolate a VLAN across the whole map in one click | Double-click a cable to trace switch → patch panel → wall socket → endpoint |

| Discovery (SNMP) | Login |
|:---:|:---:|
| ![Discovery](GitHub%20Images/Scopri.png) | ![Login](GitHub%20Images/Login.png) |
| Scan a subnet with SNMP v1 / v2c / v3 and import reachable devices | Session auth, IT / EN switcher, bound to `127.0.0.1` by default |

| AI assistant — setup | AI assistant — chat |
|:---:|:---:|
| ![AI assistant configuration](GitHub%20Images/configurazione%20AI.png) | ![AI assistant chat](GitHub%20Images/chat%20ai.png) |
| Any OpenAI-compatible endpoint (local Ollama or a cloud model); you pick which context scopes it may read | Grounded on your own network — advisory and manual-first |

---

## Features

**🗺️ Diagramming**
- 19″ rack view with colour-coded port LEDs; drag-and-drop units from 1U to 8U.
- **Apply model** — pick a real switch or router model and its port count and front panel are set natively. The catalogue ships ~5,500 models across 289 vendors, generated from public-domain device data.
- Front panels with a dedicated MGMT block and a separate SFP block; per-device port layout.
- Floor plan with storeys and rooms; cables as bezier curves; labels say what a thing is without ever rewriting the name you declared.
- Multi-port floor devices; wall sockets and VoIP phones as pass-through.
- Catalogue of NVR, SD-WAN edge, VPN concentrator, door controller and panelboard; stacking (StackWise, VSF, Virtual Chassis, IRF) and HA pairs; UPS and PDU outlet groups.
- A declared life-cycle status (planned, in service, out of service…) that changes how silence is read: a planned device that stays quiet is expected, not a fault.
- **VMs under their host** — hypervisor, home lab, storage array or NAS: a VM list plus a VM card (identity, network, resources, handover), several vNICs, optional SNMP polling kept apart from what you declared. Drag a discovered tile onto its host to absorb it; a machine is documented once.
- Operating-system logos, only from an authoritative source; nothing when the OS is unknown.
- Sub-header with breadcrumb, active VLAN filter and project stats; multiple projects; a focused dark UI.

**🏢 Multi-site**
- The floor above a project: an organisation with its sites (each a *reference* to its project), the WAN uplinks each one buys and the links between sites.
- A link answers two questions on two fields — **transport** (internet, MPLS, VPLS, VXLAN…) and **tunnel** (IPsec, GRE, WireGuard…) — and says which WAN lines carry it.
- A deterministic inter-site map and a form in the same panel; a coherence audit that keeps incoherences and gaps apart and names every check it could not run.
- Fills itself from NetBox circuits and VPN services; prints a WAN chapter in the dossier with a recovery card per line and per link.

**📊 Dashboard**
- Three standing questions in three columns — **LAN** (is the document complete?), **Conformance** (does it still match reality?), **Expansion** (how much can I grow?).
- Every cell carries a number, a plain-word verdict and the **provenance** of the figure: declared, measured with a date, derived, or *not declared* as a dash.
- A health dot and verdict per column, a since-last-read delta, and a stale green that degrades after seven days without contact.
- Every row opens in place and leads to where the thing is edited: a cable traces its physical path, a VLAN opens its panel.
- Opt-in lenses: **Recoverability (DR)**, **Security & Services**, **Health**. A footnote under each names what it is *not* looking at.
- Reports: free ports, port descriptions, L3 map, change history — with CSV.

**📡 Live SNMP**
- v1 / v2c / v3 discovery of interfaces, VLANs, LAG, LLDP/CDP neighbours and ENTITY-MIB inventory; wireless associations from the bridge FDB and the L3 neighbour table.
- Read-only live cards (system, Printer-MIB, HOST-RESOURCES, UPS/ATS) that never overwrite what you typed.
- Topology walk, off-segment discovery through the SNMP ARP table, port mapping by ifName, deep scan with confidence scoring, mDNS/SSDP/ONVIF listen; one device per chassis — the NICs of one box are folded together on authoritative keys only, never on a name or a MAC.
- A port shut on purpose is told apart from one simply without link, in the rack, the PDF and draw.io.
- **Reality Check / Drift Report** — nine categories: consistent ports, state discrepancies, hardware identity changed, IP change on the same MAC, documented-but-absent, not verifiable, on-network-but-undocumented, ghost cables, cables on a shut port.
- **Honest presence** — red only from a signal a live host cannot suppress; a merely silent device, or one on a subnet the sweep never reached, is *not verified*, never wrongly absent.
- One click per row: update the document, ignore until the condition changes, investigate; **Adopt** undocumented devices.
- DHCP lease import for MAC ↔ IP across all VLANs (an identity map, not a liveness probe); BYOD collapse with the reason on each row; a management-VLAN role.
- IPv6 treated like IPv4, with the same padlock and Neighbour Discovery presence.

**🔄 DCIM / IPAM sync (NetBox)**
- Read-only import into a new project: sites, racks (front and rear), devices, interfaces, patch-panel cabling, PDU outlets, VMs, IPAM prefixes and VLANs, circuits and VPN services.
- Every import is a list of decisions — what does not come across is declared, not dropped; a re-import compares without writing. One site is one project.
- Write-back to NetBox is a paid module (dry-run diff, never deletes).

**🔗 LAG detection**
- Four-level cascade: `ifStackTable`, IEEE 802.3ad, LACP actor state, and parallel LLDP adjacencies **where one end reports the aggregate** — parallel cables alone are never called a LAG.
- Coherence checks: uniform member speed and VLAN, LACP mode across both ends, no single-member bundle, no members straddling two devices unless they are one logical switch.

**🏷️ VLAN & IPAM**
- Access and trunk detection, Q-BRIDGE bitmaps with a VTP fallback, auto-derived trunks, a site default native VLAN, one-click isolation across the whole map.
- A cable's colour comes from one decision: one VLAN, a trunk, a routed link (no VLAN) or two ends that disagree (neutral, flagged).
- Per-VLAN IPAM occupancy, prefix-first IPAM, duplicate and overlapping address audit (IPv4 and IPv6, compared by identity), L3-lite gateway map.

**📶 Wireless**
- Up to 8 radios per device, each with its own SSID, band, channel, security and VLAN; a radio only connects to a radio; the SSID VLANs make the wired uplink a trunk.

**🧵 Cabling**
- Segment editor on the TIA-568 hierarchy, copper and fibre reach validation, end-to-end physical path trace, progressive patch-panel numbering.
- The passive layer stays true by derivation: the run inside the wall never changes, so the wall socket is derived from the switch port.
- Printable label sheets (Avery, Dymo) and CSV.

**🕓 History & automation**
- One **Automatic monitoring** scheduler (Light / Full), opt-in autosave, a verification timeline with a trend, and restorable snapshots kept outside the project file.

**🤖 AI assistant**
- Bring-your-own-key, OpenAI-compatible, local by default. The context is built from the same allowlist as the REST API, so credentials physically cannot leave; a "Show what leaves" button previews it.
- *InfraNet computes, the AI narrates*: gaps, free IPs and drift are pre-computed facts; answers carry clickable citations and a check flags any IP or MAC not in your data.
- Advisory, never auto-applied: Ansible drafts, an onboarding copilot, deterministic health alerts.

**📤 Exports & hand-over**
- A vector **PDF dossier**: the cover page and change history are always in; the sections you tick come on top. Includes an audit-ready asset register, a Recoverability section and a WAN chapter.
- Rack SVG, a native editable **draw.io** diagram (one layer per VLAN) and cable-label sheets.
- A read-only REST API and a ready-made Ansible inventory.

**🔒 Security & 🌍 Bilingual**
- Session auth with admin and viewer roles, a rate-limited login, a loopback bind and secrets structurally excluded from every data surface. See [Security](#authentication--roles).
- Complete Italian and English interface, onboarding and a ~70-page manual, guarded by an `it ↔ en` key-parity test.

---

## Architecture

A single Node/Express backend serves a static frontend and persists each project as a JSON file — no database, no cloud.

```text
infranetpro/
├── server.js · auth.js · utils.js   # Express bootstrap, session auth (bcrypt), shared helpers
├── server/                          # Backend modules: projects store, netscan, classify, PDF/label render, AI, routes
├── drivers/snmp.js                  # SNMP v1/v2c/v3 driver (poll / probe / neighbours)
├── engine/                          # Plugin engines: sysobject-engine, oui-engine, fusion-scorer
├── plugins/ · plugins/oui/          # Seed vendor catalogs (sysObjectID + OUI/MAC), zero-database
├── data/                            # oui-db.json (IEEE snapshot) · device-type catalogue · ai-config.json (git-ignored)
├── lib/                             # Pure shared logic (browser + tests)
├── src/                             # Frontend ESM bundled by esbuild → dist/app.bundle.js
├── styles/                          # Modular CSS (partials + design tokens)
├── netmapper.html · login.html · export.js
├── test/ · tools/                   # Regression suite + syntax check
└── projects/ · users.json · .session-secret   # Runtime data (git-ignored)
```

- **Minimal-tooling frontend** — the only build step is a lightweight esbuild bundle of the `src/` modules; the pure `lib/*.js` and `export.js` stay classic static assets by design.
- **File-based storage** — each project is a plain JSON file (easy to back up and version-control); the floor-plan image is a sidecar asset, so saves stay fast on large maps.
- **Internal plugin model** — discovery intelligence grows through local SNMP/sysObjectID/OUI plugins and self-contained drivers.
- **Tested core** — a dependency-free regression suite; CI also runs a syntax check, an ESLint gate, a `tsc` JSDoc type check and a real-browser end-to-end suite.

The module-by-module layout, the data flow and the conventions are in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Requirements

- [Node.js](https://nodejs.org/) ≥ 16 and npm ≥ 8.
- Network access: UDP 161 to the managed devices.
- No external database. [Docker](#docker) is optional — bare-metal Node works exactly the same.

---

## Installation

```bash
git clone https://github.com/muttley1973/infranetpro.git
cd infranetpro
npm install        # also builds the frontend bundle (postinstall)
npm start          # or: node server.js
```

Open **http://localhost:8421**. On first start an **admin** account is created with a random password, printed once in the console; the server does not force a change, so do it from the user menu (**Change password**). On Windows, double-click `avvia.bat`.

> **Prefer `git clone` over "Download ZIP".** The frontend bundle is a build artifact and is git-ignored; `npm install` rebuilds it, so a clone always runs the current code. A ZIP has no `.git`, cannot tell you its version and does not update. To confirm you are current: `src/app.js` exists and there is **no** root `app.js`.

---

## Docker

No Node install required: the image builds the frontend internally and keeps all data in a named volume, so it survives re-creation and upgrades.

```bash
cp .env.example .env          # then set SESSION_SECRET=<random>  (openssl rand -base64 48)
docker compose up -d --build
```

Open `http://<host-ip>:8421`. The generated **admin** password is in the container log: `docker compose logs infranetpro`.

- **Default — host networking** (`network_mode: host`): the container sees your real network, so discovery is complete (ARP → MAC → vendor, SNMP, LLDP/CDP). It needs a **Linux** host and publishes the login-protected UI on the host's interfaces — keep it on a trusted network, use a VPN or a TLS reverse proxy for outside access, never expose it to the internet. `HOST=<ip>` binds it to one address.
- **Isolated variant** — `docker compose -f docker-compose.bridge.yml up -d --build`, for Docker Desktop or a sandbox behind a proxy: SNMP discovery works, but ARP-based MAC/vendor detection does not. It binds host-loopback by default; `BIND_ADDR=0.0.0.0` reaches it from the LAN.
- **Plain `docker run`** — `docker build -t infranetpro .`, then run with `--network host --cap-add NET_RAW -e SESSION_SECRET=… -v infranet_data:/data`.
- The container runs as the non-root `node` user, and every secret lives on the volume, never in an image layer.

| Volume path | Holds |
|---|---|
| `/data/projects` | saved projects + image assets |
| `/data/skins` | uploaded panel skins |
| `/data/users.json` | user accounts (bcrypt hashes) |
| `/data/api-tokens.json` | REST API tokens (SHA-256 hashes) |
| `/data/ai-config.json` | AI assistant configuration, including the BYO key |
| `/data/dcim-config.json` | DCIM/IPAM instance and token |
| `/data/.session-secret` | session signing secret, when `SESSION_SECRET` is not supplied |

---

## Configuration

Everything is an **environment variable** — no config file.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8421` | TCP port |
| `HOST` | `127.0.0.1` | Interface to bind; keep loopback unless behind a proxy or VPN (`0.0.0.0` in a container) |
| `SESSION_SECRET` | *(auto)* | Session signing secret |
| `INFRANET_PROJECTS_DIR` | `./projects` | Projects and image assets |
| `INFRANET_SKINS_DIR` | `./skins` | Uploaded panel skins |
| `INFRANET_USERS_FILE` | `./users.json` | User accounts |
| `INFRANET_API_TOKENS_FILE` | `./api-tokens.json` | REST API tokens |
| `INFRANET_AI_CONFIG_FILE` | `./data/ai-config.json` | AI configuration (holds the BYO key) |
| `INFRANET_DCIM_CONFIG_FILE` | `./data/dcim-config.json` | DCIM/IPAM configuration (holds the token) |
| `INFRANET_SESSION_SECRET_FILE` | `./.session-secret` | Where the auto-generated secret is kept; point it at a persistent path when the code directory is read-only |
| `INFRANET_AI_KEY` / `INFRANET_AI_ENDPOINT` | *(unset)* | AI key from the environment (off disk); the endpoint, when set, wins over the saved one so the key cannot be redirected |
| `INFRANET_DCIM_URL` / `INFRANET_DCIM_TOKEN` | *(unset)* | DCIM instance and token from the environment |
| `INFRANET_TRUST_PROXY` | *(off)* | Set `1` behind a TLS reverse proxy: secure cookie, trusts `X-Forwarded-*` and counts logins per real client instead of per proxy |
| `INFRANET_LOGIN_IP_MAX` | `100` | Failed logins one address may make in 15 minutes |
| `INFRANET_LOGIN_CONCURRENCY` / `INFRANET_LOGIN_QUEUE` | `2` / `8` | Password checks at once / waiting; beyond that login answers `503` with `Retry-After` |
| `INFRANET_FILE_MODE` | `600` | Permissions of the files that hold credentials; anything that grants access to others is ignored |

The four `*_FILE` paths let a deployment keep every secret on one persistent volume; the Docker image sets them to `/data/…`.

> ⚠️ InfraNet Pro is designed for **internal, trusted networks**. Do not expose it to the internet without a reverse proxy and TLS (and `INFRANET_TRUST_PROXY=1`).

---

## Usage

1. **Create a project** — *New Project*; each one keeps its own devices, cables, VLANs and layout.
2. **Add devices** — *Add Device* on the rack or the floor; set hostname, IP, icon and port count.
3. **Poll via SNMP** — select a device → *Poll* → driver and credentials → *Poll*. It fills in hostname, interfaces (speed, state, duplex), LAG, VLANs and LLDP/CDP neighbours.
4. **Auto-discover** — *Discover Subnet* on a CIDR block, then *Walk Topology* from a seed device to pull LLDP neighbours and draw the cables.
5. **Manage cables and VLANs** — click a cable for its mode, native and allowed VLANs; click a port LED for the interface detail and its VLAN.
6. **Verify** — compare the document with the live network and work through the rows.

---

## SNMP Integration

| Driver ID | Protocol | Notes |
|---|---|---|
| `snmp-v1` | SNMPv1 | Legacy; community string |
| `snmp-v2c` | SNMPv2c | Recommended for most switches |
| `snmp-v3` | SNMPv3 | authPriv / authNoPriv / noAuthNoPriv |
| `auto` | v1 + v2c + v3 | **Discovery only**: probes every version in parallel and keeps what answers |

- **Universal discovery.** The *Scopri* dialog scans with `auto`. A v2c host is imported with data; a **v3-only** host is detected without credentials and flagged **"v3 da configurare"** — fill the credentials in **Properties → Integration** and *Sync*. The Integration panel works for any device with an IP, not only rack devices.
- **SNMPv3 fields:** username; auth `MD5`, `SHA` (SHA-1), `SHA224`–`SHA512`; privacy `DES`, `AES` (128), `AES256` (Blumenthal) or `AES256R` (Reeder — the agent's variant must match, a wrong one shows up as a timeout); passphrases ≥ 8 characters; an optional **context name** (HP JetDirect needs `jetdirect`). A protocol name the driver does not know is refused with an error, never replaced by another.
- **MIBs used (standard, vendor-neutral):** IF-MIB (`ifTable`, `ifXTable`, `ifStackTable`) · IEEE 802.3ad · BRIDGE-MIB and Q-BRIDGE-MIB · LLDP-MIB and CISCO-CDP-MIB · Cisco VTP · SNMPv2-MIB · ENTITY-MIB · Printer-MIB and `hrPrinterStatus` · HOST-RESOURCES-MIB.
- **Live cards** (system, Printer-MIB, HOST-RESOURCES) are read-only, appear only when the device exposes them and never overwrite manual fields. Printer-MIB is read in an isolated single-concurrency pass, because weak agent stacks truncate it otherwise.

---

## Discovery & classification engines

- **sysObjectID engine** (`engine/sysobject-engine.js`) — resolves an OID against local plugins under `plugins/`, longest prefix wins, hot reload, a failing plugin never crashes it. The seed catalogue covers common SMB and home-lab vendors; add a vendor with one file exporting `vendorPrefix`, `match(oid, ctx)` and `enrich(oid, ctx)`.
- **OUI engine** (`engine/oui-engine.js`) — MAC → vendor over a prefix trie, with the IEEE snapshot (~57k entries, `npm run update-oui`) committed so it works right after `git clone`, plus vendor-specific seed plugins and virtual-NIC filtering.
- **Fusion scoring engine** (`engine/fusion-scorer.js`) — fuses every signal (sysObjectID, OS fingerprint, OUI, `sysServices`, TCP ports, banners) into one classification with a confidence, ranked alternatives and an evidence trail. **Vendor identity ≠ device type**: a vendor is identity only and a measured signal always outranks an inference. It is the single authoritative classifier, frozen by a 55-device golden test.

Plugin contract and a worked example: [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Authentication & Roles

- **admin** — full control: projects, polling, users. **viewer** — read-only, with SNMP secrets redacted.
- Users live in `users.json` (bcrypt, cost 12); login is rate-limited per address and account. Admins manage users in **Settings → Users**.

**Security hardening.** Designed for a trusted LAN behind login, bound to `127.0.0.1` by default; the code has been through an application-security audit with no critical findings, and the follow-up measures are enforced by tests.

- **Secrets never leave on the data surfaces** — the AI context, the REST DTOs and the exports use an explicit allowlist; a build-failing test guards the AI context.
- **Credential files are owner-only (`0600`) and written atomically**; a damaged state file is read from its `.bak` and never copied over the good one.
- **Sessions** — `httpOnly` + `sameSite=strict`, a new id on sign-in, revoked on a password or role change; constant-work login (no user enumeration); `Cache-Control: no-store` on every `/api/*` response.
- **Baseline headers** (`Content-Security-Policy` without `eval`, `nosniff`, `X-Frame-Options: DENY`, `no-referrer`); errors return JSON, never a stack trace.
- **No command injection** (`execFile` with an argument array); scan targets are read once, sent as checked and never multicast or broadcast; the discovery crawl stays in internal address space.
- **Uploaded skins and management URLs are sanitised** — scripts, handlers and external references are stripped; `javascript:`, `data:` and `file:` never become a link.
- **The PDF export cannot be made to read the disk or hang**; a project `state` is checked before it replaces one.
- **The container is non-root** and keeps secrets out of image layers.

Details: [SECURITY.md](SECURITY.md) and [ARCHITECTURE.md](ARCHITECTURE.md) §8. 🔐 Found a vulnerability? Report it **privately** to the maintainer, not in a public issue.

---

## Project Data Model

- Each project is a plain JSON file, `projects/<id>.json`: `format`, `schemaVersion`, `id`, `name` and a `state` with `nodes`, `links` (cables, with cabling metadata, LAG grouping and pass-through `segments`), `ports`, `racks`, `lagGroups`, `vlans` and IPAM state. The floor-plan image is a sidecar asset; the state is migrated idempotently.
- History and restorable snapshots live in `projects/history/<id>/` and go away with the project.
- **Export → JSON** writes a portable envelope without SNMP credentials or credentials in backup pointers; import also accepts legacy bare state JSON.
- The secret-free device projection shared by the REST API and the exports is `nodeToDevice` in `lib/api-shape.js`; field-by-field detail is in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## API Reference

Every endpoint needs an authenticated session; writes need the **admin** role. The `/api/v1/openapi.json` spec holds the machine-readable schemas.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` / `POST` | `/api/projects` | any / admin | List projects / create one |
| `GET` / `PUT` / `DELETE` | `/api/projects/:id` | any / admin | Read / update / delete — send `If-Match` with the ETag you read and a superseded save is refused with **409** instead of overwriting in silence |
| `POST` | `/api/projects/:id/copy` | admin | Duplicate a project |
| `GET` / `PUT` | `/api/organization` | any / admin | The organisation (sites, WAN uplinks, links) with its coherence audit / replace it |
| `POST` | `/api/poll` | admin | Poll one device via SNMP — `{ driver, host, community, port, timeout }` |
| `POST` | `/api/discover` | admin | Scan a subnet or range — `subnet`, `driver`, `community`, `concurrency`, `timeout`, `safeMode`, `deepScan` |
| `POST` | `/api/topology` | admin | LLDP/CDP neighbours of one device |
| `POST` | `/api/discover/topology` | admin | Topology crawl from one or more seeds, streamed as `text/event-stream` |
| `POST` / `GET` | `/api/auth/login` · `/logout` · `/me` | — / any | Log in (rate-limited) / out / session info |
| `GET` `POST` `PUT` `DELETE` | `/api/auth/users[/:id]` | admin | Manage users |
| `GET` `POST` `DELETE` | `/api/auth/tokens[/:id]` | admin | List, mint (shown once) or revoke API tokens |

---

## REST API (v1)

A versioned, **read-only** API for Ansible, dashboards and wikis to read the documented network as a source of truth. `/api/v1/*` authenticates with a **bearer token** (minted by an admin in **Users and access → API tokens**, shown once) and returns sanitized data only — never SNMP communities or other secrets.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/openapi.json` | — | OpenAPI 3.0 description |
| `GET` | `/api/v1/projects` | token | List projects |
| `GET` | `/api/v1/projects/:id` | token | Full inventory: VLANs, racks, devices |
| `GET` | `/api/v1/projects/:id/devices` | token | Device list only |
| `GET` | `/api/v1/projects/:id/ansible-inventory` | token | Ansible dynamic inventory (`--list` format) |

```bash
curl -H "Authorization: Bearer inp_…" http://<host>:8421/api/v1/projects/1
```

- Each device exposes `id, name, type, brand, model, ip, mac, vlan` (derived from IP ↔ subnet), `rack`, `snmp` (a boolean — the community is never exposed) and `wireless`.
- **Ansible dynamic inventory** — `integrations/ansible/infranet_inventory.py` (Python standard library only): every device with an IP becomes a host, grouped by `type_*`, `vlan_*`, `rack_*`, `brand_*` and `backup_missing`, with `ansible_network_os` (omitted, never guessed, for unknown vendors) and a config-backup pointer (*where* the backup lives, never the config or a credential). Set `INFRANET_URL`, `INFRANET_TOKEN`, `INFRANET_PROJECT`, then `ansible-inventory -i infranet_inventory.py --graph`. Walkthrough: [integrations/ansible/README.md](integrations/ansible/README.md).

---

## Known Limitations

- **Cisco IOS Q-BRIDGE** returns empty VLAN names and bitmaps without a per-VLAN community (`public@100`) — the VTP MIB fallback is used automatically.
- **Cisco trunk VLANs** read from VTP cover VLANs 0–1023 only; VLANs 1024–4094 on such a trunk are not read.
- **SNMPv3 EngineID** is auto-discovered; entering one by hand is not supported yet — use v2c if v3 discovery fails.
- **Touch** — the map and the rack work with a finger, verified on Chrome with emulated touch only, not on a real tablet; drawing a cable and dragging from the library still need a mouse.
- **Writes to devices — none, by design.** SNMP, LLDP and CDP are only read; configuration changes stay in your own tooling.
- **Concurrent users** — no push: a superseded save is refused and says who wrote and when, but you learn of the other session at save time.
- **Storage** is file-based JSON served by one process, not built for multi-server deployments.
- **Physical path** — segment editing supports linear chains through pass-through ports; media converters are not yet offered as routing hops.

---

## Roadmap

Everything that has shipped is in [CHANGELOG.md](CHANGELOG.md). Next:

- [ ] **Per-field provenance in the schema** — every field carrying an explicit origin (declared / measured / derived). Half of it exists: the envelope and the classification of every project field; what is missing is the consumption.
- [ ] **DCIM write-back** — gated: maker-checker, dry-run, re-read after the write, a closed list of writable fields.
- [ ] `ENTITY-SENSOR-MIB` (temperatures, fans, PSU) and real PoE wattage per switch.
- [ ] SQLite-backed storage for discovery and IP history, the FDB cache and the audit log.
- [ ] Internal discovery and classification hardening (richer local plugins, more real-device tests).
- [ ] Topology multi-source fusion (LLDP + FDB agreement boost; stricter unmanaged-switch detection).

**Out of scope** (parked): WebSocket multi-user push, an SNMP trap receiver, a per-VLAN community wizard, BGP4 / POWER-ETHERNET / Print MIBs, conduit and cable-tray modelling, fibre loss-budget maths.

---

## Testing

A **zero-dependency** regression suite on Node's built-in test runner — no framework, no `node_modules` for tests.

```bash
npm test              # the regression suite (node --test)
npm run check         # syntax-check every JS source
npm run typecheck     # JSDoc + checkJs type-check of the pure libs (tsc --noEmit)
npm run build         # bundle the ESM frontend modules (esbuild → dist/)
RUN_E2E=1 npm run e2e # headless end-to-end in a real Chrome — off by default
```

- The **end-to-end suite** (`test/e2e/`, Playwright on the system Chrome with `INFRANET_DEV_NO_AUTH`) drives the critical flows in a real browser on an isolated server and a temporary store.
- Coverage focuses on the pure logic that has historically broken: SNMP parsing, discovery and classification, the three engines, cable validation, IPAM and LAG audits — plus an app-wide smoke test that loads every script into a DOM stub and asserts rendering never throws.

Current local quality baseline:
- `npm run check` parses every JS source of the product — **576** of them.
- `npm test` runs the full regression suite (currently **4,307 tests, 0 failing**) plus a real‑browser E2E suite (`RUN_E2E=1`, **149 flows**).
- `npm run release -- check` is the gate before a tag: the version in its four places, a CHANGELOG section that lists something, and the test count measured against what the suite really prints.

**CI** ([GitHub Actions](.github/workflows/ci.yml)) runs `npm run check` and `npm test` on every push and pull request to `main`, on Node 18 and 20.

---

## Feedback & requests

- 🐞 **Bugs** → an [issue](https://github.com/muttley1973/infranetpro/issues/new/choose) with the **Bug report** template (steps, version, OS, logs).
- 💡 **Feature requests** → an [issue](https://github.com/muttley1973/infranetpro/issues/new/choose) with the **Feature request** template.
- 💬 **Questions and ideas** → a [Discussion](https://github.com/muttley1973/infranetpro/discussions).
- 💼 **Commercial licence, private enquiries** → [LICENSING.md](LICENSING.md).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

1. **Fork** and create a feature branch (`git checkout -b feature/my-feature`).
2. Respect the **minimal-build philosophy**: the only frontend build step is the esbuild bundle of `src/` (`npm run build`, run by `npm install` and `npm start`); the pure `lib/*.js`, `export.js` and `styles/` stay plain static assets.
3. Put decision logic in a pure module under `lib/` and unit-test it; keep the glue thin.
4. New device drivers go in `drivers/<protocol>.js`, export `poll(cfg)`, `probe(cfg)` and optionally `pollNeighbors(cfg)`, and are registered in `server/drivers.js`:

   ```javascript
   // drivers/myprotocol.js
   'use strict';
   async function poll(cfg)  { /* → { hostname, interfaces, lags, vlans } */ }
   async function probe(cfg) { /* → { reachable, hostname?, descr? } — used by /api/discover */ }
   module.exports = { poll, probe };
   ```

   ```javascript
   // server/drivers.js
   const DRIVERS = Object.assign(Object.create(null), {
     'myprotocol': loadDriver('myprotocol'),   // ← add here
   });
   ```
5. Test against real hardware or a GNS3/EVE-NG lab, then open a **Pull Request** saying what changed and why.

---

## Support

InfraNet Pro is free and open source (AGPLv3). If it saves you time, a coffee on Ko-fi funds the work that keeps new features coming. ☕

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/infranetpro)

> Need it adapted to your company's devices or APIs, or embedded in a closed-source product? Custom integration and commercial licensing are available — see [LICENSING.md](LICENSING.md).

---

## License

**GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)** — Copyright © 2026 [muttley1973](https://github.com/muttley1973). Full text in [LICENSE](LICENSE).

- Free software: use, study, share and modify it under the AGPLv3. If you run a modified version to provide a service over a network, you must make your modified source available to its users.
- A **commercial licence** is available for organisations that prefer not to be bound by the AGPL copyleft (for example, embedding it in a closed-source product), and **custom integration** to specific device APIs is offered. See [LICENSING.md](LICENSING.md).
- Distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; see the GNU AGPL for details.

---

<div align="center">

<img src="GitHub%20Images/logo-mark.png" width="52" alt=""><br>
<b>InfraNet Pro</b><br>
<sub>Built with ❤️ for network engineers who prefer developing with a coding agent.</sub><br>
<sub>If it earns a place in your workflow, a ⭐ helps other engineers find it.</sub>

<p>
  <a href="#quick-start">Quick start</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="ARCHITECTURE.md">Architecture</a> ·
  <a href="https://github.com/muttley1973/infranetpro/issues/new/choose">Report a bug</a> ·
  <a href="https://github.com/muttley1973/infranetpro/discussions">Discussions</a> ·
  <a href="LICENSING.md">Commercial licence</a>
</p>

<p>
  <a href="MANUALE_TECNICO_IT.pdf"><img src="GitHub%20Images/flag-it.svg" width="18" alt=""> Manuale tecnico</a>
  &nbsp;·&nbsp;
  <a href="TECHNICAL_MANUAL_EN.pdf"><img src="GitHub%20Images/flag-gb.svg" width="18" alt=""> Technical manual</a>
</p>

<a href="https://ko-fi.com/infranetpro"><img height="32" alt="Support InfraNet Pro on Ko-fi" src="https://ko-fi.com/img/githubbutton_sm.svg"></a>

</div>
