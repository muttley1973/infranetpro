# InfraNet Pro

> **Network infrastructure diagramming and live SNMP management — in a single self-hosted app.**

[![CI](https://github.com/muttley1973/infranetpro/actions/workflows/ci.yml/badge.svg)](https://github.com/muttley1973/infranetpro/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D16-brightgreen?logo=node.js)](https://nodejs.org/)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.0.5-orange)]()
[![Lingua: Italiano · English](https://img.shields.io/badge/lang-Italiano%20%C2%B7%20English-00b3d6)]()

<p align="center">
  <b>InfraNet Pro is free and open source.</b> If it helps your work, you can buy me a coffee — it funds new features. ☕<br>
  <a href="https://ko-fi.com/infranetpro"><img height="36" src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support InfraNet Pro on Ko-fi"></a>
</p>

<p align="center">
  <img src="GitHub%20Images/demo.gif" alt="InfraNet Pro — a quick tour: topology, live racks, VLAN isolation, SNMP discovery and the AI assistant" width="900"><br>
  <em>A quick tour — auto-discovered topology, live 19″ racks, one-click VLAN isolation, SNMP discovery and the grounded AI assistant. <a href="#screenshots">More screenshots ↓</a></em>
</p>

> 🌍 **Bilingue · Bilingual — 🇮🇹 Italiano & 🇬🇧 English.** Interfaccia, onboarding e manuale tecnico completi in entrambe le lingue, con selettore IT/EN nell'app. · Fully bilingual UI, onboarding and technical manual, with an in-app IT/EN switcher. 📖 [Manuale IT](MANUALE_TECNICO_IT.pdf) · [Manual EN](TECHNICAL_MANUAL_EN.pdf)

> 📰 **What's new:** see [CHANGELOG.md](CHANGELOG.md). Latest: **"Apply model" — set a device's ports, SFP/QSFP and MGMT from a real switch/router model in one click**, now covering **~4,100 models across 52 vendors** (Cisco, HPE/Aruba, Juniper, Arista, Huawei, Fortinet, Sophos, Ubiquiti, LANCOM, Allied Telesis, APC/Eaton/Vertiv, Synology/QNAP, …) generated from public-domain (CC0) device-type data; SFP block cap 48, fibre never mis-rendered as copper.

> 🔒 **Security-audited & hardened.** The codebase has undergone an application-security audit (no critical issues) and the follow-up fixes are covered by **automated security regression tests**: the data surfaces (AI context, REST DTOs, exports) are **allowlist-only** so secrets never leave the machine, OS commands run via `execFile` with no shell, project IDs are path-traversal-safe, and secrets use a CSPRNG. See [Authentication & Roles → Security hardening & audit](#authentication--roles).

InfraNet Pro is a **self-hosted web application** that lets network engineers draw rack layouts and floor-plan diagrams, then bring them to life by polling live data from real devices via SNMP. Interfaces, VLANs, LAG groups and neighbour topology are discovered automatically — no external database, no cloud dependency, minimal tooling (a lightweight esbuild bundle for the frontend; `npm start` builds it).

Current product direction: InfraNet Pro keeps discovery and classification inside the app. External discovery and monitoring engines are not part of the active roadmap; the internal SNMP/sysObjectID/LLDP/CDP/FDB engine is the source of truth and can be refined with local plugins over time.

---

## Table of Contents

- [Screenshots](#screenshots)
- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [Docker](#docker)
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
- [REST API (v1)](#rest-api-v1)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Testing](#testing)
- [Contributing](#contributing)
- [License](#license)

---

## Screenshots

> 📖 **Full feature manual (PDF):** [🇮🇹 Italiano](MANUALE_TECNICO_IT.pdf) · [🇬🇧 English](TECHNICAL_MANUAL_EN.pdf) — dark cover, white printable interior, 17 illustrated chapters.

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

| AI assistant — setup | AI assistant — chat |
|:---:|:---:|
| ![AI assistant configuration](GitHub%20Images/configurazione%20AI.png) | ![AI assistant chat](GitHub%20Images/chat%20ai.png) |
| Connect any OpenAI-compatible endpoint (local Ollama, or any cloud model) and pick which context scopes it may read — data stays on your server | Grounded on your own network: onboarding guidance, SNMP health & capacity alerts, and Ansible / CLI config drafts — advisory and manual-first |

---

## Features

### Diagramming
- **Rack view** — drag-and-drop 19″ rack units (1U–8U) with colour-coded port LEDs
- **Apply model** — in a device's *Port layout*, search a real switch/router model and apply it in one click: it sets the port count and the SFP/QSFP/MGMT front-panel exactly, then the built-in renderer draws the correct faceplate. The catalog ships with **~4,100 models across 52 vendors** — switch/router/AP (Cisco, HPE/Aruba, Juniper, Arista, Extreme, Huawei, Nokia, Alcatel-Lucent, Brocade, LANCOM, Allied Telesis, Ubiquiti, TP-Link, Netgear, Zyxel, D-Link, FS, Ruckus, Edgecore, TrendNet, EnGenius, ZTE, Dell, MikroTik), firewall (Fortinet, Palo Alto, Check Point, SonicWall, Sophos, Stormshield, WatchGuard, Barracuda, OPNsense), UPS/PDU (APC, Eaton, Raritan, Vertiv, CyberPower, Riello), NAS (Synology, QNAP, NetApp), console/OOB (WTI, Opengear, Avocent) generated from **public-domain (CC0) device-type data** with `tools/import-device-types.js` (`--vendors=`, network-role `--roles` filter); only the data is reused, so ports stay live. Up to **48 SFP per block**
- **Front-panel controls** — per-device port-count/layout options for compact home-lab and SMB rack fronts. Visual radio-button thumbnails for the 4 base layouts (Auto / Linear / Sequential / Cisco-alternating). Optional separate SFP block and dedicated MGMT (management) block with their own count + position controls
- **Dedicated MGMT ports** — up to 4 cyan-bordered cells outside the regular `1..N` port numbering, on `mgmtEligible` device types (switch, router, firewall, server, NAS, KVM, PBX, console server, WLAN controller, NVR, SD-WAN edge, VPN concentrator). Editable base label (MGMT, iLO, iDRAC, me, fxp0, …). Excluded from VLAN/LAG/FDB data-plane logic
- **SFP block** — silver-metal anodised border (Cisco/Aruba-style), separate cell group at left/right of the main port grid
- **Floor map** — place devices on an SVG floor plan; cables drawn as bezier curves
- **Multi-port floor devices** — PC/workstations, access points and custom endpoints can declare more than one network port (PC dual-NIC or NIC + OOB management, AP dual-uplink/LACP, etc.). Each port renders as a separate, independently cablable LED under the device icon. Pass-through devices (wall socket, VoIP phone) keep their two-sided transit model — the two concerns are orthogonal flags (`multiPort` vs `passThrough`)
- **Hypervisors & home‑lab VMs** — model VMs under a host (`node.vms[]`) on hypervisor and home‑lab devices. The host's *Virtual machines* section **lists** them one per row (state dot, name, role · IP · resources) and each row opens a **dedicated VM card**: identity (name, role/service, guest OS, power state), network & access (hostname + a **management row** — protocol + URL + one-click open, like a PC), **vNIC ports**, allocated resources (vCPU, RAM, disk) and handover data (owner, criticality, backup, notes). A VM can declare **several virtual cards** (`vm.nics[]`: name, IP, VLAN, MAC, IPv6, port group / vSwitch) — a virtual firewall has WAN + LAN + DMZ — and each one feeds the three couplings that already exist: its VLAN goes into the **derived trunk** on the host uplink, its MAC into the **documented devices** of the Check, its IP into the **duplicate audit**. A vNIC has no cable of its own and none is drawn: it rides the host uplink, and which physical NIC carries it (with uplinks in teaming) is decided by the balancing policy — not knowable, so not declared. Those fields are declared by hand. On top of them, a VM that exposes an **SNMP agent on its own address** can be queried like any other host — the *Integration* section is the device one field for field (`vm.integration`: driver, host override, port, timeout, community or the full v3 block), reusing the same poll route: system name, uptime, CPU cores, RAM and disks come back as a **measured block stamped with the read time**, kept visually apart from what you declared and copied into it only on an explicit click. An answer proves the VM is running (the state becomes a measurement); silence proves nothing and never marks it stopped. A VM that shows up on the network as a loose tile (a MAC *or* an IP is enough — SNMP‑monitored devices on another subnet have no MAC) can be **absorbed into its host** by dragging it onto that section (the whole section is the drop area; the dashed invite sits above the list): it inherits the tile's name/IP/MAC (when known), so it stops being flagged as undocumented. Absorb fires only on release **inside** the section; releasing elsewhere repositions the device (or snaps it back, with a toast explaining an ineligible drop). Undoable. VMs get their **own chapter in the handover dossier** and their **own counter on the cover** — never summed into the device count
- **Uniform floor/rack interaction** — floor devices behave like rack devices: **single click selects**, **double click opens Properties**
- **Sub-header bar** — a thin bar under the toolbar with a **breadcrumb** (InfraNet Pro / project / floor plan), the **next recommended step** in the centre (the same deterministic onboarding hint as the assistant — text + a one-click *Discover now* / *Verify now* button), and at-a-glance **project stats** on the right: documentation completeness, total devices, and SNMP health (coloured dot). Numbers are computed, never estimated (`lib/subbar-stats.js`)
- **Wireless links (Packet-Tracer style)** — mark any connection as wireless and it's drawn as a **sine-wave** instead of a straight cable (in both floor map and topology), skips physical-cable validation, and is auto-suggested when one end is an AP. Wi-Fi-capable devices (AP / router / firewall, per-device toggle in *Network & Access*) expose a **radio port**: a virtual connector that hosts many wireless clients without consuming physical ports and stays out of the *Free ports* report — drag a client onto the radio badge to associate it. A **WLAN** toggle in the topology legend hides all wireless connections at once
- **Wireless properties (documentation-grade hybrid)** — the AP's radio holds **SSID · band (2.4/5/6 GHz) · channel (grouped by UNII sub-band, DFS-marked, with Auto) · security (Open/WPA2/WPA3/OWE) · 802.11 standard (Wi-Fi 4…7)**, validated with educational warnings (channel↔band, 6 GHz needs WPA3/OWE, standard↔band, open network); the wireless **association** inherits those read-only and carries its own **RSSI / distance**. Pure tested logic in `lib/wifi-spec.js`
- **UPS / ATS live SNMP** (UPS-MIB RFC 1628 + APC PowerNet) — Sync polls power devices for a read-only **Live status** block: UPS shows mains/**on-battery**, **battery %**, **runtime remaining** (red warning under 10 min), battery status, load %, input/output V, temperature; ATS shows **active source (A/B)**, redundancy, over-current. Vendor-neutral via UPS-MIB; manual-first (live values stay separate from the documented spec fields). Pure tested parsing in `lib/power-mib.js`, server reads in `drivers/snmp.js#pollPower` (`POST /api/poll-power`)
- **L3-lite gateway** — bind each VLAN to the device that routes it (auto-suggested from the gateway IP, manual override wins): an **L3 badge** on the device, a read-only **Gateway L3 / SVI** panel section, and a **Report → L3 map** (VLAN → subnet → gateway → device, with orphan/out-of-subnet warnings + CSV)
- **IPAM hygiene** — the *L3 map* also flags two misconfigurations a real IPAM catches: the **same IP documented on two devices** and **two VLANs with overlapping subnets** (pure `lib/ipam-audit.js`, doc↔doc, never invented)
- **LAG member consistency** — the LAG section of the device panel warns when a group's member ports have **different speeds or access/native VLANs** (they wouldn't bundle on real hardware); pure `lib/lag-audit.js`
- **LACP mode & cross-end coherence** — each LAG group has a **mode** (LACP active / passive / static "on"), stored in `state.lagModes`. It is **auto-derived over SNMP** during Sync (active/passive read from the 802.3ad actor state of the member ports; static is left manual, never guessed) and stays **manual-first** — a mode you set by hand is never overwritten. InfraNet resolves the peer LAG from the cabling and warns on the two classic failures: **both ends passive** (neither starts negotiation → bundle never forms) and **LACP vs static** (incompatible ends). The mode also flows into the AI context; `lib/lag-audit.js` `checkLagPair`
- **Cable path insight** — cable properties show a read-only **Physical Path** accordion that reconstructs linear paths across wall ports, patch panels and media converters
- **Multiple projects** — create, rename, copy and delete independent network maps
- **Vector PDF / SVG export** — full rack SVG export including the MGMT/SFP side blocks; port-assignment table that lists MGMT ports per device
- **draw.io (diagrams.net) rack export** — export any rack to a native, editable `.drawio` diagram (mxGraph XML), one page per rack. Devices and ports become *real editable cells* inside draw.io's own numbered rack container (snap-to-U); device names sit **outside** the rack so the faceplate is all interfaces, and custom device skins are honoured — not a pasted image. The **live SNMP status stripe is not exported** (it's a runtime indicator; the `.drawio` is static). Intra-rack cables export as **one native edge per cable**, on **one draw.io layer per VLAN** (named after the VLAN, toggled independently), coloured by VLAN and routed in per-cable vertical lanes + horizontal stagger so they never overlap. Each VLAN layer also carries a **cable table** (one row per cable, `DeviceA/port → DeviceB/port`); in draw.io View/lightbox mode, clicking a row highlights that cable persistently (thickens it) and scrolls to it, clicking the table header resets. Page format is **A4 portrait by default, auto-switching to A3** per page when a tall rack or long cable table doesn't fit
- **Audit-ready asset register (PDF)** — an optional per-device inventory page (name / type / brand / model / serial / IP / MAC / VLAN / rack-U) built from the same **secret-free allowlist DTO** as the REST API (`nodeToDevice`), plus a **"last revised" timestamp** on the dossier cover (project `updated_at`, not the print date) — the documentation evidence NIS2 / ISO 27001 A.5.9 / cyber-insurance questionnaires ask for. The whole PDF report is **bilingual (it / en)**, following the UI language (technical terms stay unchanged); historical audit values are kept in the language they were recorded in
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
- **Off-segment discovery via SNMP ARP** — during the topology walk, InfraNet also reads each reachable switch/router's ARP table (`ipNetToMediaTable`, the standard `arpnip` method) and proposes the hosts it has seen at L2/L3 — including devices that answer **neither ping nor SNMP nor LLDP/CDP** and live on a subnet the collector can't reach directly (a VPCS, a mute IoT). Bounded to the scanned subnet, deduped, presented as **observed / not pre-selected**, and refined with imported DHCP leases (a matching lease attaches the hostname and raises confidence). Standard SNMP, vendor-neutral
- **Manual-first** — user-edited `hostname`, `ip`, `integration.host` are protected by `*Manual` flags and never overwritten by SNMP / discovery
- **Port mapping by ifName (manual-first)** — on Sync, SNMP interfaces are matched to existing ports by `ifName` (stable across re-syncs, needs `snmp-server ifindex persist`), not by position, so a port you cabled by hand is never silently re-assigned. A real mismatch — an endpoint-cabled port that SNMP sees as a trunk/LAG member — is **surfaced** as a per-node *"port to reconcile"* warning, not hidden. *Validated live on a multivendor PnetLab lab: Cisco vIOS ×3, MikroTik RouterOS, VyOS, Ubuntu/net-snmp, VPCS endpoints, two LACP bundles, four VLANs, L3-lite.*
- **Reality Check / Drift Report** — a **"Verifica documentazione"** button runs the existing SNMP sync, plus a multi-signal presence sweep (**ping / ARP / TCP** on top of SNMP/FDB), then compares the live network against the documentation and produces an interactive report in **6 categories**: **consistent ports**, **state drift** (documented active but really down, or speed/duplex/VLAN mismatch), **IP change (same MAC)** (a documented device now answering on a different IP — one-click re-bind), **documented-but-absent** (**honest presence**: red only from a signal a live host cannot suppress — a **local ARP-miss** on the server's own segment or a **switch access port down for ≥ N syncs**; a device that is merely silent, on an unreached subnet, or only a mute SNMP agent is reported **not-verified**, never wrongly absent — and a plain Sync reds a node only via the authoritative switch-port-down signal (which needs no sweep); a merely silent device stays grey, while a device proven alive by a **router's ARP table** stays green even across subnets), **undocumented devices** (MACs seen in the network but not in the map — cross-referenced with `rejectedAutoLinks` so already-rejected links aren't re-proposed), and **ghost cables** (documented cable whose port has been down for ≥ N consecutive syncs, N configurable, default 3). One-click per row: *update doc* (aligns the documentation to reality), *ignore* (persisted, won't reappear until the condition changes), *investigate* (opens the device/port on the map). The diff is a pure, tested function (`lib/drift-report.js`); ignores and the down-streak counter persist additively in the project
- **DHCP lease import (cross-VLAN reality)** — paste or load a DHCP lease table (auto-detects ISC dhcpd / dnsmasq / Kea CSV / generic CSV; covers pfSense / OPNsense / MikroTik / Synology / Windows exports) to feed the documentation check with authoritative MAC ↔ IP across **all VLANs** — the piece local ARP can't see behind an L3 firewall (a "firewall-on-a-stick"). Multiple servers **accumulate as persisted sources** (one entry per DHCP server, merged by MAC keeping the freshest lease); leases drive **cross-VLAN IP-change** and **undocumented-device** detection (showing the lease hostname). A lease table is treated as an **identity map, not a liveness probe**: a documented device missing from the leases is reported as *unverifiable*, never wrongly *absent*; expired/released leases are ignored; and a manually-pinned IP is never silently overwritten (you confirm before unpinning). Pure parser in `lib/dhcp-lease.js`. Loading a lease table from a file or paste is built-in; live vendor pull (FortiGate / PAN-OS / OPNsense / MikroTik REST APIs) is an optional, separately-distributed driver pack
- **Endpoint/BYOD transparency** — undocumented entries that look like user devices (on a guest VLAN, behind a crowded uplink port, or using a randomized "private" MAC) are collapsed into a *user/BYOD* group so the actionable infrastructure stays clean; each hidden row shows **why** it was hidden in plain language, with the technical signal in a tooltip, and a toggle reveals them inline
- **"Management VLAN" role (anti‑guest)** — mark a VLAN as management with a per‑VLAN toggle. The opposite of a guest VLAN: an undocumented device seen there is forced to **infrastructure** (never collapsed as BYOD), its noise signals cleared, and flagged with a red **"On management VLAN"** security badge (possible intruder); Adopt proposes it as infra. State in `state.mgmtVlans`

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
- **IPAM occupancy from DHCP leases** — the per‑VLAN IPAM card shows **real address usage** for the declared subnet: capacity, a usage bar (amber near full) and a **documented vs DHCP‑only vs free** breakdown (occupancy = documented IPs ∪ active leases). A **"N undocumented → Adopt"** shortcut maps DHCP‑only leases straight into the Adopt picker (MAC + IP + hostname), with management‑VLAN leases proposed as infrastructure. Pure, tested engine (`lib/ipam.js`); manual‑first, read‑only

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

### AI Assistant (advisory)
- **In-app assistant, bring-your-own-key** — a third **«Assistant»** tab in the right panel (keyboard shortcut **A** + a toolbar entry) that answers questions about *your documented network* in plain language: who's on a VLAN, what's on a port, which IPs are free, why a device is absent, SNMP health (CPU/RAM/toner/UPS), topology, wireless SSIDs (VLAN/security/band), and **hardware capabilities** (PoE budget/headroom, UPS VA/W & runtime, CPU/RAM/storage, throughput, LAG/uplink bandwidth). Provider-agnostic via a single **OpenAI-compatible** endpoint — **local (Ollama) by default** so data never leaves the machine, or any cloud model exposing an OpenAI-compatible API; configured under *Users and access → AI assistant*. Advisory and manual-first: it proposes, you confirm; Ansible output is a marked **draft**, never executed
- **Data security by construction** — the API key lives **only on the server** (`data/ai-config.json`, git-ignored, or env `INFRANET_AI_KEY`) and never returns to the browser. The context the model sees is built from the **same allowlist** as the REST API (`lib/api-shape.js`): the SNMP community and credentials are *not in the list*, so they physically cannot leave; an extra secret-name denylist guards the SNMP-health passthrough. A **«Show what leaves»** button previews the exact sanitized JSON before you enable anything, and a build-failing guard test asserts no secret can reach the AI context
- **No hallucination** — *"InfraNet computes, the AI narrates"*: drift, free IPs and gaps are pre-computed and passed as facts; the model is instructed to never invent names/IPs/VLANs and to answer *"not in the documentation"* when it doesn't know
- **Scope & capability toggles** — pick **what leaves** the machine (Inventory · Ports · SNMP health · Topology · Drift) for privacy and token cost, and **what the assistant may do** (Q&A · Diagnostics · Find gaps · Suggestions · Ansible draft). All on by default; zero-dependency server client (`node:https`), no model bundled
- **Chat controls** — the **robot button in the toolbar** (admin, right of *Report*) opens the scope/capability settings at any time, a red **trash** button clears the conversation (session-only), and saving the config refreshes the panel instantly (enable → chat, endpoint → 🔒 Local / ☁ Cloud chip)
- **Clickable citations & anti-invention check** — answers surface the devices/VLANs they used as **clickable chips that jump to the node on the map**; a downstream check (`lib/ai-grounding.js`) flags any IP/MAC the model names that **isn't in your data** with a ⚠ *"reference not found"* chip (SNMP OIDs like `1.3.6.1.2.1.43` are recognised as such and never mistaken for IPs). The model is also fed **live facts** (drift + IPAM occupancy computed in the browser, re-sanitized server-side, gated by the *Drift* scope toggle), so it reasons over the current reality, not just the saved JSON
- **Find gaps, draft Ansible, explain Drift** — the context carries pre-computed **gaps** (VLAN without gateway/subnet, IPAM near full) and a **next free IP** per VLAN (`lib/ipam.js`), so *"what's missing / which IP?"* is grounded. Ask for automation and you get a **fenced Ansible playbook rendered as a draft card** (amber *"DRAFT — not applied"* banner + Copy; never executed; `lib/ai-draft.js`). And every actionable **Verify/Drift row** has an **«Explain»** button that opens the assistant and seeds a grounded question about that exact case (absent device, IP change, undocumented…)
- **Hardware capabilities & per-model advice** — the context also carries each device's **documented capabilities**, pre-computed by InfraNet (`lib/hw-capabilities.js`, pure & tested): switch **PoE budget & headroom** (worst-case per-class envelope), **UPS** VA/W & runtime, **server/hypervisor** CPU/RAM/storage (+ hosted VMs), **NAS** capacity, **firewall/SD-WAN** throughput, **WLAN-controller** AP capacity, **AP** radios/bands/SSID counts, and per-device **port capacity** (free ports, speed mix, **aggregate LAG/uplink bandwidth**), plus a **fleet summary**. So *"how much PoE headroom on SW-X?"*, *"how many VMs can this host take?"*, *"do I have uplink bandwidth for another AP?"* are answered from facts; an undocumented field is **omitted, never invented**. The assistant may also use each device's **official identity already in the context** (vendor/model/firmware + SNMP `sysDescr`) to propose **model-specific solutions and CLI/OS config snippets** — rendered as a draft, **labelled "typical for &lt;brand/model&gt;, verify on the official datasheet/CLI"** and kept separate from InfraNet's authoritative data (no new data leaves the machine, no third-party calls). Allowlist by construction — reads only known `spec` keys, so secrets (SNMP community, keys) are structurally excluded and the build-failing anti-leak test still holds
- **Onboarding copilot — next-step chip + spotlight** — the Assistant tab proposes the **next useful step** from deterministic rules over your project state (empty → *Discover*; documented but unverified → *Verify*; VLAN without subnet/gateway, undocumented/absent → the matching nudge; `lib/onboarding.js`). **«Show me»** lights the *real* toolbar button with a blinking cyan coach-mark that stays until you click it (and never moves the page); **«Ask»** seeds a grounded how-to. It guides even before a model is configured, and never applies anything (manual-first). *"How do I X in InfraNet?"* is grounded on the real command surface — buttons + tooltips **derived** from the UI itself (`lib/ui-catalog.js`) — so it cites the actual button label and can't invent menus
- **Onboarding guide — the whole journey, not just the spine** — beyond the next-step chip, the assistant orients you across the **full workflow** (① build the map → ② document → ③ verify → ④ analyse → ⑤ hand off → ⑥ automate), naming the **real features by their actual labels** — including the *Report* / *Import-Export* / *Automation* commands and the drag-drop *Element library* that the button catalog (toolbar-only) can't see — and **proactively surfaces useful, under-used features** relevant to your project's real state (e.g. free ports → where to relocate; a documented & verified network → a *Handoff dossier*), staying advisory and separate from the facts
- **Health monitoring & proactive problem alerts** — the assistant sees each device's real **SNMP health** (a printer's ink/toner cartridges, a host's CPU/RAM/disks, a UPS): the context sanitizer was deepened so the **nested driver shapes** (`printer.supplies[]`, `hostResources.volumes[]`) actually reach the model, with the per-key secret filter still running at every level. A pure engine (`lib/health-alerts.js`, *"InfraNet computes, the AI narrates"*) derives **deterministic alerts from telemetry against thresholds** — RAM/disk near full, ink/toner low, UPS on battery / low runtime / low charge / high load — surfaced as `device.alerts` + a fleet summary; the system-prompt tells the assistant to **report problems first**, citing the device by name and using only the pre-computed values (no invented alarms, no fabricated levels). HOST-RESOURCES is now polled for **network gear too** (switch/router/firewall/SD-WAN), so Linux-based devices (MikroTik, FortiGate, Aruba CX…) get CPU/RAM/disk for free. Reachability / device-down stays with **Verify/drift** (which distinguishes a real fault from *"not verifiable from this host"*); temperature and traffic congestion aren't collected, so they're never fabricated

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

A single Node/Express backend serves a static frontend and persists each project as a JSON file — no database, no cloud. Top-level layout:

```text
infranetpro/
├── server.js · auth.js · utils.js   # Express bootstrap, session auth (bcrypt), shared helpers
├── server/                          # Backend modules: projects store, netscan, classify, PDF/label render, AI (context/prompt/provider), routes
├── drivers/snmp.js                  # SNMP v1/v2c/v3 driver (poll / probe / neighbours)
├── engine/                          # Plugin engines: sysobject-engine.js, oui-engine.js, fusion-scorer.js (+ index.js)
├── plugins/ · plugins/oui/          # Seed vendor catalogs (sysObjectID + OUI/MAC), zero-database
├── data/                            # oui-db.json (IEEE snapshot) · ai-config.json (BYO key, git-ignored)
├── lib/                             # Pure shared logic (browser + tests): i18n, cidr, correlate, and the app-*.js glue modules
├── src/                             # Frontend ESM bundled by esbuild → dist/app.bundle.js (app.js nucleus + glue)
├── styles/                          # Modular CSS (partials + design tokens)
├── netmapper.html · login.html · export.js
├── test/ · tests/ · tools/          # Regression suites + syntax check
└── projects/ · users.json · .session-secret   # Runtime data (git-ignored)
```

**Design principles:**
- **Minimal-tooling frontend** — the only build step is a lightweight esbuild bundle of the `src/` ESM modules; the pure `lib/*.js` and `export.js` stay classic static assets *by design*. The strangler migration to ESM is complete; retiring the transitional `window` bridge (`win.*` reads → `import`, inline handlers → event delegation) is **suspended — a low-priority, spare-time task** (the state is stable; monotonic ratchets prevent regression). See [ARCHITECTURE.md](ARCHITECTURE.md) §10.
- **File-based storage** — each project is a plain JSON file (easy to back up / version-control); the floor-plan image is kept out of the JSON as a sidecar asset and re-attached as a data-URL on load, so saves stay fast even with large maps.
- **Internal plugin model** — discovery intelligence is extended with local SNMP/sysObjectID/OUI plugins and self-contained drivers, never external discovery platforms.
- **Tested core** — bug-prone parsing/normalization logic is covered by a dependency-free regression suite (`npm test`); CI also runs a syntax check, an ESLint gate, a `tsc` JSDoc type check and a real-browser e2e suite.

The full module-by-module layout is documented in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Requirements

| Dependency | Version |
|---|---|
| [Node.js](https://nodejs.org/) | ≥ 16.0.0 |
| npm | ≥ 8 (bundled with Node 16) |
| Network access | UDP 161 to managed devices |

No external database. A one-command **[Docker](#docker)** setup is provided, but it's optional — bare-metal Node works exactly the same.

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

## Docker

Run InfraNet Pro in a container — no Node install required. The image builds the
frontend bundle internally and keeps all data (projects, skins, user accounts) in a
named volume, so it survives container re-creation and upgrades.

```bash
# 1. Set a fixed session secret (otherwise logins reset on every re-create)
cp .env.example .env          # then edit .env → SESSION_SECRET=<random>
#   openssl rand -base64 48

# 2. Build and start
docker compose up -d --build
```

Open `http://<host-ip>:8421` (the IP of the machine running Docker). On first start the
generated **admin** password is printed to the container log — read it with
`docker compose logs infranetpro`, then change it on first login.

### Networking — full discovery by default

The default `docker-compose.yml` uses **`network_mode: host`**, so the container behaves
like a native install: it sees your real network. **Discovery is complete** — ARP gives
device MACs → **vendor names** (OUI), alongside SNMP and LLDP/CDP — and the UI is reachable
at `http://<host-ip>:8421`.

> ⚠️ **Security:** host mode publishes the (login-protected) UI on the host's interfaces.
> Keep it on a trusted network; for outside access use a VPN or a reverse proxy with TLS —
> never expose it directly to the internet. To bind the server to one address set
> `HOST=<host-ip>` (or `HOST=127.0.0.1` for host-loopback only).
>
> Host networking needs a **Linux** host. On Docker Desktop (macOS/Windows) host mode is
> limited — use the isolated variant below.

**Isolated (bridge) variant** — for a sandboxed container behind a reverse proxy/VPN, or on
Docker Desktop:

```bash
docker compose -f docker-compose.bridge.yml up -d --build
```

Here the container's network is isolated from the host: SNMP discovery still works (it's L3),
but **ARP-based MAC/vendor detection does not** — devices without SNMP appear with no
MAC/vendor. It binds host-loopback only by default; set `BIND_ADDR=0.0.0.0` to reach it from
the LAN.

### Plain `docker run`

```bash
docker build -t infranetpro .
docker run -d --name infranetpro \
  --network host \
  -e SESSION_SECRET="$(openssl rand -base64 48)" \
  -v infranet_data:/data \
  --cap-add NET_RAW \
  infranetpro
```

| Volume path | Holds |
|---|---|
| `/data/projects` | saved projects + image assets |
| `/data/skins` | uploaded panel skins |
| `/data/users.json` | user accounts (bcrypt hashes) |

---

## Configuration

All configuration is done via **environment variables** — no config file needed.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8421` | TCP port the server listens on |
| `HOST` | `127.0.0.1` | Interface to bind. Keep loopback unless behind a proxy/VPN; set `0.0.0.0` in a container |
| `SESSION_SECRET` | *(auto-generated)* | Override the session signing secret |
| `INFRANET_PROJECTS_DIR` | `./projects` | Where project JSON + image assets are stored |
| `INFRANET_SKINS_DIR` | `./skins` | Where uploaded panel skins are stored |
| `INFRANET_USERS_FILE` | `./users.json` | Path to the user-accounts file |
| `INFRANET_TRUST_PROXY` | *(off)* | Set `1` when behind a TLS reverse proxy: flags the session cookie `secure` (HTTPS-only) and trusts `X-Forwarded-*`. Leave unset for plain HTTP / localhost |

Example:
```bash
PORT=80 node server.js
```

To expose the server on all interfaces (e.g. inside a trusted LAN):
```bash
HOST=0.0.0.0 node server.js
```

> ⚠️ InfraNet Pro is designed for **internal/trusted networks**. Do not expose it directly to the internet without a reverse proxy and TLS.
> When you put it behind a TLS reverse proxy, also set `INFRANET_TRUST_PROXY=1` so the session cookie is flagged `secure` (sent over HTTPS only).

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

Standard, vendor-neutral MIBs (v2c and v3 expose the *same* OIDs):

- **IF-MIB** (`ifTable`/`ifXTable`, `ifStackTable`) — interfaces (name, type, speed, status) + LAG stacking
- **IEEE 802.3ad** (`dot3adAgg*`) — LACP aggregator / member ports
- **BRIDGE-MIB / Q-BRIDGE-MIB** — bridge port mapping, VLAN egress/untagged bitmaps
- **LLDP-MIB** + **CISCO-CDP-MIB** — neighbour discovery
- **Cisco VTP MIB** — VLAN names without a per-VLAN community
- **SNMPv2-MIB** (`sysName`/`sysDescr`/`sysObjectID`/`sysServices`, `sysLocation`/`sysContact`/`sysUpTime`) — identity, vendor/model intelligence, live system card
- **ENTITY-MIB** (`entPhysical*`) — hardware inventory (vendor, model, serial, firmware)
- **Printer-MIB** (RFC 3805) + `hrPrinterStatus` — toner/ink %, page count, status (printers)
- **HOST-RESOURCES-MIB** (RFC 2790) — CPU / RAM / disk (server/pc/nas/homelab, and network gear)

**Live read-only cards.** System / Printer / Host-resources data is shown as read-only "live" cards in the Integration panel and **never overwrites manual fields** (manual-first), appearing only when the device exposes them. Printer-MIB is read in an isolated **concurrency-1** pass (weak agent stacks like HP JetDirect truncate the supplies columns under a concurrent walk); HOST-RESOURCES is fetched only for compute devices.

---

## sysObjectID Intelligence Engine

A dependency-free `sysObjectID` engine (`engine/sysobject-engine.js`, public via `const { SysObjectEngine } = require('./engine')`) enriches SNMP discovery results without a database. It resolves an OID against local plugins under `plugins/` using **longest-prefix-wins**, runs one isolated instance per webapp, hot-reloads plugin files at runtime, and isolates failures (a plugin throwing in `enrich()` returns `null`, never crashes the engine). It can also return OS/agent fingerprints — context-only matches use `vendorPrefix: '0'` via `engine.fingerprint(ctx)`. `server/classify.js` resolves `row.objectId` through it before the legacy PEN/regex fallback. A `storage` constructor seam is reserved for a future SQLite catalog; today it stays zero-database. This is the preferred extension path for vendor intelligence — refine local plugins, don't add external discovery dependencies. See [ARCHITECTURE.md](ARCHITECTURE.md).

### Seed Vendor Catalog

The bundled seed catalog covers common home-lab / SMB vendors — network (Cisco, HPE/Aruba, MikroTik, Ubiquiti, Zyxel, Netgear, TP-Link, D-Link), security (Fortinet, Palo Alto), storage/server (Synology, QNAP, VMware), power/video (APC, Eaton, Axis, Hikvision) and OS/agent fingerprints (Windows, Net-SNMP/Linux, Proxmox, TrueNAS, Apple macOS/iOS, Android, Chromecast). It's intentionally practical, not globally complete: `sysObjectID` has no universal official model database — the stable part is the IANA PEN/vendor prefix, while model-level mappings are vendor/community-specific.

### Adding a New Vendor

Add one file under `plugins/` exporting exactly `vendorPrefix`, `match(oid, ctx)` and `enrich(oid, ctx)` — where `enrich` returns `vendor` / `deviceType` / `family` / `confidence` plus optional `os` and `infranet` hints. Use the vendor PEN prefix (`1.3.6.1.4.1.<PEN>`), keep `deviceType` aligned with InfraNet types (`switch`, `router`, `firewall`, `server`, `nas`, `ap`, `printer`, `webcam`, `nvr`, `ups`, `pdu`, `iot`, `pc`), prefer generic family logic over per-lab hacks, and never query SQLite/HTTP/external files from a plugin. For OS-only/context fingerprints use `vendorPrefix = '0'`. Run `npm test` after changes. The full plugin contract and a worked example live in [ARCHITECTURE.md](ARCHITECTURE.md) and the seed files under `plugins/`.

---

## OUI Intelligence Engine

A second plugin-based engine (`engine/oui-engine.js`, public via `const { OuiEngine } = require('./engine')`) resolves **MAC OUI → vendor + device intelligence**, mirroring the sysObjectID engine: plugin-based, hot-reload, zero-database. Lookup uses a compact prefix trie (**longest-prefix-wins** with priority tie-break) over 24/28/36-bit IEEE assignments plus special non-IEEE blocks (e.g. Docker `0242`). A catch-all plugin (`plugins/oui/_ieee-database.js`) loads `data/oui-db.json` — the official IEEE snapshot (~57k entries: MA-L + MA-M + MA-S + IAB) regenerated by `npm run update-oui` and **committed** so the engine works right after `git clone`. 32 vendor-specific seed plugins under `plugins/oui/` (virtual NICs, network, endpoint, IoT/CCTV, NAS, printer, security) win over the IEEE fallback (priority 0). `server/classify.js._resolveOui()` enriches every discovery row with vendor (and often deviceType) from MAC, feeds the scoring engine, and filters virtual NICs (`isVirtual()`) out of auto-link/topology. Helpers: `lookup` / `isVirtual` / `isLocallyAdministered` / `isMulticast` / `getVendor` / `format`. See [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Fusion Scoring Engine

The Fusion Scoring Engine (`engine/fusion-scorer.js`, pure and tested) is the central decision layer: it fuses every discovery signal — the sysObjectID engine, OS fingerprint, OUI engine, `sysServices` OSI bits, TCP ports and hostname/vendor/banner regexes — into a single classified device with a numeric `confidence` (10–99), ranked `alternatives`, the full `scores` map and an `evidences`/`reasons` trail.

> **Design invariant — vendor identity ≠ device type.** Exactly as nmap / Fingerbank / netdisco do, the vendor (from a MAC OUI or a `sysObjectID` PEN) is **identity only** and is never keyword‑matched for the type nouns `gateway|switch|router|firewall` (so a "Gateway Inc." PC or an org literally named "SWITCH" isn't mistyped). Type comes from behaviour/structure, and signals are **tiered** so a *measured* signal (SNMP, banner/model text, a probed service port, NetBIOS/SMB, Google Cast, the opt‑in mDNS/SSDP listen for closed‑port devices) always outranks a vendor‑identity inference; a device known *only* by inference has its confidence capped (manual‑first).

It is the single authoritative classifier — the Discover UI defers to it (the thin client `_guessType` only fills gaps), the in‑line legacy twin was removed, and behaviour is frozen by the 55‑device `tests/classify-golden.test.js` plus a representative freeze in `tests/fusion-scorer.test.js`. `server/classify.js._scoreDiscoveredDevice(row)` is the production entry point; the discovery payload exposes a `classification` object (`deviceType` / `confidence` / `alternatives` / `scores` / `reasons`) alongside the legacy `deviceClass`/`confidence`. See [ARCHITECTURE.md](ARCHITECTURE.md).

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

### Security hardening & audit
InfraNet Pro is designed for a **trusted LAN, behind login**, bound to `127.0.0.1` by default. The codebase has undergone an **application-security audit** (no critical findings) and the follow-up hardening is enforced by tests:
- **Secrets never leave the machine on the data surfaces** — the AI context, the REST API v1 DTOs and the exports are built from an **explicit allowlist** (`lib/api-shape.js`, `server/ai/context.js`): SNMP communities, Wi-Fi passphrases/PSK, API keys and tokens are structurally excluded. A **build-failing guard test** (`test/ai-context.test.js`) fails the build if a secret-looking field ever reaches the AI context.
- **The bring-your-own AI key is stored owner-only** — `data/ai-config.json` is written `0o600` (and re-tightened at startup) so a co-tenant on the host can't read the key; supply it via `INFRANET_AI_KEY` to keep it off disk entirely (`server/ai-config.js`, guarded by `test/ai-config.test.js`).
- **Uploaded skin SVGs are sanitized before render** — a shared library skin is stripped of `<script>` / event handlers (`on*`, in every quoting form) / external references, both by a server-side regex pass and by a real **DOM parse** on the client for the preview *and* the rack, so a poisoned skin-pack can't run script in another user's Properties panel (`lib/panel-skin.js`, `src/app-panel-skin.js`, guarded by `test/panel-skin.test.js`).
- **Login is constant-work (no user enumeration)** — a dummy bcrypt compare runs when the username is unknown so response timing doesn't reveal which usernames exist; login / RBAC / session-invalidation-on-role-change / last-admin / rate-limiter are covered by regression tests (`test/auth-api.test.js`, `test/auth-store.test.js`).
- **Errors return JSON, never a stack trace** — a global Express error handler maps malformed/oversized bodies and thrown errors to a clean JSON error instead of an HTML page leaking server paths (`server.js`).
- **Durable, owner-only secret files** — the session secret is `0o600` (with a startup retrofit); `api-tokens.json`, `ai-config.json` and skin SVGs are written **atomically** (temp + fsync + rename + `.bak`) so a crash mid-write can't truncate them or silently invalidate every API token.
- **No command injection** — every OS call (`ping`, `arp`, …) uses `execFile` with an argument array (no shell); scan inputs are regex-validated and capped.
- **Path-traversal-safe project IDs** — every `projectId` is coerced to a positive integer before touching the filesystem (guarded by `test/ai-route-security.test.js`).
- **CSPRNG secrets** — the session secret and the first-run admin password are generated with `crypto.randomBytes` / `crypto.randomInt`, never `Math.random`.
- **Cookies** — session cookies are `httpOnly` + `sameSite=strict`; set `INFRANET_TRUST_PROXY=1` behind a TLS reverse proxy to also flag them `secure` (HTTPS-only).
- **SNMP secrets never reach a read-only viewer** — `GET /api/projects/:id` strips the community and v3 auth/priv passphrases from the project for any non-admin (viewers can't save, so the redaction is loss-free), so a read-only account can't lift the credentials to the backbone (`server/routes/projects.js`, guarded by `test/security-hardening.test.js`).
- **The dev auth-bypass is fail-closed** — `INFRANET_DEV_NO_AUTH=1` (a preview convenience) is honoured **only** when the server is bound to loopback and `NODE_ENV` is not `production`; on a network-reachable bind it is ignored with a loud warning, so it can never silently disable auth in production (`auth.js`, guarded by `test/security-hardening.test.js`).
- **Baseline HTTP security headers on every response** — `Content-Security-Policy` (self-hosted assets → `default-src 'self'` with `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`; inline kept because the UI needs it), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (`server.js`).
- **Skin CSS sanitized too** — beyond `<script>` / event handlers / external refs, `<style>` and `style=""` are stripped of external / `data:` / `javascript:` `url()` (local `url(#id)` kept), `expression()` and `@import`, and `vbscript:` is neutralised like `javascript:` (`lib/panel-skin.js`).

> 🔐 Found a vulnerability? Please report it **privately** to the maintainer instead of opening a public issue.

### Managing Users (admin panel)
Log in as admin → **Settings → Users** to:
- Add new users
- Change passwords
- Promote / demote roles
- Delete users

---

## Project Data Model

Each project is a plain JSON file in `projects/<id>.json`: top-level `id` / `name` / `created_at` / `updated_at` plus a `state` object holding the network. The main collections are `nodes` (devices), `links` (cables — with cabling metadata, LAG grouping, auto-link confidence and pass-through `segments`), `ports` (keyed by portId), `racks`, `lagGroups`, `vlans` and VLAN/IPAM state; the floor-plan image is kept out of the JSON as a sidecar asset. The shape evolves with the app and is stored as-is.

The secret-free device projection reused by the REST API and the exports is defined in `lib/api-shape.js` (`nodeToDevice`). Field-by-field detail of each object (node / link / port / rack) lives in [ARCHITECTURE.md](ARCHITECTURE.md).

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
| `GET` | `/api/auth/tokens` | admin | List API tokens (prefixes only) |
| `POST` | `/api/auth/tokens` | admin | Mint an API token (shown once) |
| `DELETE` | `/api/auth/tokens/:id` | admin | Revoke an API token |

### Request bodies

Full request/response schemas are in the machine-readable **OpenAPI 3.0** spec at `GET /api/v1/openapi.json`. In short: `/api/poll` takes `{ driver, host, community, port, timeout }`; `/api/discover` takes a `subnet` (CIDR or `a.b.c.1-254` range) plus `driver` / `community` / `concurrency` / `timeout` and scan flags (`safeMode`, `deepScan`); `/api/discover/topology` takes one or more `seed`(s) with `maxDepth` / `maxDevices` and streams `text/event-stream` progress (`start`, `probing`, `found`, `queued`, `dup`, `skip`, `warn`, `done`).

---

## REST API (v1)

A versioned, **read-only** API for external consumers (Ansible, dashboards, wikis, automation) to read the documented network as a source of truth. Unlike the session-gated endpoints above, `/api/v1/*` authenticates with a **bearer token** (no browser session needed) and returns **sanitized** data only — never SNMP communities or other secrets.

Mint a token as an admin in **Users and access → API tokens** (shown once), then pass it as a bearer header:

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/openapi.json` | — | OpenAPI 3.0 description (public) |
| `GET` | `/api/v1/projects` | token | List projects |
| `GET` | `/api/v1/projects/:id` | token | Full inventory: VLANs, racks, devices |
| `GET` | `/api/v1/projects/:id/devices` | token | Device list only |
| `GET` | `/api/v1/projects/:id/ansible-inventory` | token | Ansible dynamic inventory (`--list` format) |

```bash
curl -H "Authorization: Bearer inp_…" http://<host>:8421/api/v1/projects/1
```

Each device exposes `id, name, type, brand, model, ip, mac, vlan` (derived from IP ↔ subnet), `rack`, `snmp` (a boolean — the community is never exposed) and `wireless`.

### Ansible dynamic inventory

`integrations/ansible/` ships a ready-made dynamic inventory (`infranet_inventory.py`, Python standard library only): every device with an IP becomes a host (`ansible_host` = its IP), grouped automatically by `type_*`, `vlan_*`, `rack_*` and `brand_*`. InfraNet stays the source of truth; Ansible executes. Set `INFRANET_URL`, `INFRANET_TOKEN` and `INFRANET_PROJECT`, then:

```bash
ansible-inventory -i infranet_inventory.py --graph
```

See [integrations/ansible/README.md](integrations/ansible/README.md) for the full walkthrough.

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

Full release notes live in [CHANGELOG.md](CHANGELOG.md). Highlights of what has shipped:

**Done:**
- [x] **AI assistant** — advisory, bring-your-own-key, OpenAI-compatible (local Ollama by default); server-side key, allowlist context + a build-failing anti-leak guard test; scope/capability toggles; never auto-applies
- [x] **REST API v1 + Ansible dynamic inventory** — read-only, bearer-token, sanitized `/api/v1/*`; token UI; stdlib-only `infranet_inventory.py` with rich host-vars (VLAN/subnet/gateway, serial/firmware, rack, mgmt)
- [x] **DHCP lease import** — cross-VLAN authoritative MAC ↔ IP for the documentation check; multi-server persisted sources; treated as an identity map, never a false *absent*
- [x] **IPAM occupancy · management-VLAN role · VM import** — real per-VLAN address usage (documented / DHCP-only / free); anti-guest management VLAN; absorb a discovered floor tile as a host VM
- [x] **Reality Check / Drift Report + Adopt** — doc-vs-network diff in 6 categories with per-row update/ignore/investigate and a multi-signal ping/ARP/TCP presence sweep; one-click Adopt of undocumented devices
- [x] **Handoff Dossier + Audit Trail** — one-click handover PDF; append-only project changelog with CSV export
- [x] **Visible locks for documented values** — one-click freeze on IP / hostname / port-VLAN (surfaces the existing manual-first pins)
- [x] **Wireless** — Packet-Tracer sine-wave links, up to 8 radios/device (SSID/band/channel/security/VLAN), SSID-VLAN trunk derivation
- [x] **L3-lite gateway** — VLAN → routing-device binding, L3 badge, Report → L3 map with CSV
- [x] **VLAN** — IPAM (subnet/gateway/DNS), floor legend/filter, per-device VLAN accordions, auto-derived trunks
- [x] **Cabling** — segment editor (TIA-568 hierarchy), physical-path trace, progressive patch-panel numbering, cable metadata, cable-label PDF/CSV export
- [x] **Free ports report** — "where do I plug in?" rack highlight + CSV / PDF page
- [x] **draw.io (diagrams.net) rack export** (`lib/drawio-export.js`): native, editable mxGraph rack, one page per rack, devices/ports as cells in draw.io's numbered rack container (snap-to-U), names outside the rack; the live SNMP status stripe is not exported. Cables = one native edge each, one draw.io layer per VLAN (coloured by VLAN, per-cable anti-overlap routing) with a click-to-highlight cable table per layer; A4 portrait auto-switching to A3 when content doesn't fit
- [x] **Vector PDF / SVG export + audit-ready asset register** — full rack SVG (MGMT/SFP side blocks); bilingual (it/en) report; secret-free per-device inventory page with a "last revised" timestamp
- [x] **Classification engines** — sysObjectID + OUI (IEEE ~57k) + Fusion Scorer (vendor identity ≠ device type), plugin-based, hot-reload, zero-database; behaviour frozen by the 55-device golden
- [x] **SNMP parameter import** — live read-only system / Printer-MIB / HOST-RESOURCES cards; manual-first; validated on real hardware
- [x] **Discovery** — deep scan (TCP/NetBIOS/SMB) + confidence scoring, reachability states, off-segment SNMP-ARP (`arpnip`), switch-port mapping (FDB `macsuck`), DHCP-as-source, mDNS/SSDP/ONVIF listen
- [x] **Device catalog** — NVR, SD-WAN edge, VPN concentrator, door controller, panelboard; dedicated MGMT + SFP (×2) blocks; stacking (StackWise/VSF/Virtual Chassis/IRF); HA pair/cluster modeling; management-protocol launcher
- [x] **Multi-vendor LAG detection** — four-level cascade (ifStack / 802.3ad / ActorOperState / LLDP-inferred), logical id, LACP mode coherence
- [x] **Topology "to confirm" states** — deduced infra/uplink cables (guessed remote port, materialised gateway, FDB uplink-resolution of a documented device) are born *Inferred · to verify* (amber Confirm/Delete, dashed on the map), never mislabelled `LLDP` — nor `LAG` when the uplink lands on a local LAG member port toward a blind switch whose port we can't know; a hidden multi-port intermediary behind a 2–4-MAC access port is surfaced as a shared L2 segment with a role **suggested** from the endpoints (other subnet → gateway · virtual OUI → hypervisor · randomised MAC → AP · else switch) and materialised from the Shared L2 panel
- [x] **Engineering** — zero-dep regression suite + CI, server modularization, frontend ESM/esbuild migration, correlation primitives (`lib/correlate.js`), ENTITY-MIB inventory, `node.spec` refactor

**Planned:**
- [ ] Full segment-editing UI (read-only `Physical Path` is shipped; the editor is the missing piece)
- [ ] `ENTITY-SENSOR-MIB` (temperatures/fans/PSU) + real PoE wattage per switch
- [ ] Explicit topology states in the UI (`exact / probable / ambiguous / shared-segment / uplink-to-unknown`)
- [ ] SQLite-backed storage for discovery/IP history, FDB cache and audit log
- [ ] Internal discovery/classification hardening (richer local plugins, more real-device tests)
- [ ] Topology multi-source fusion (LLDP + FDB agreement boost; stricter unmanaged-switch detection)
- [x] **IPv6 (Scope A), treated like IPv4:** address field in device Properties **with the same padlock** (`ip6Manual`); the SNMP poll reads the device's **own** address (`ipAddressTable`) so the **Sync auto-populates** it and **Verify** flags a locked divergence. Plus Neighbour Discovery (`ipNetToPhysicalTable`, routable global/ULA only) — which now also feeds **cross-subnet presence**: a device in a router's ND cache is green even if IPv6-only or ARP-aged (twin of the router-ARP path) — EUI-64 → vendor hint, privacy-IID → BYOD. Active IPv6 sweep (`ping ff02::1`) stays parked.
- [x] **OS-family hint from ping TTL** (nmap-style, zero-cost, low-weight, embedded-appliance-suppressed; internal — not shown in the scan table)
- [ ] Discovered-device de-duplication, shadow/rogue-device signal
- [ ] Keep discovery propose-and-reconcile, never overwrite (the *"discovered ≠ intent"* model)

**Out of scope** (parked): WebSocket multi-user live push, SNMP trap receiver, temporal confidence on links, per-VLAN community auto-config wizard, BGP4 / POWER-ETHERNET / Print MIBs, conduit/cable-tray modeling, fiber loss-budget math, HA Tappe B+C.

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

Coverage focuses on the pure, bug-prone logic that has historically broken: SNMP parsing & extraction (`test/snmp.test.js`, `test/extractData.test.js`), discovery & classification (`test/discovery.test.js`, 14 real-device cases), correlation primitives (`test/correlate.test.js`), the sysObjectID / OUI / Fusion engines (`tests/*.test.js`), front-panel state, cable validation (incl. **Cat8 30 m reach**), IPAM & LAG audits, and an app-wide **smoke E2E** (`test/smoke-app.test.js`) that loads every `netmapper.html` script plus the esbuild bundle into a `vm` + DOM stub and asserts `renderAll`/`renderProps` never throw on any device type.

Current local quality baseline:
- `npm run check` validates all project JS sources (~140 files)
- `npm test` runs the full regression suite (currently 1590+ unit tests, all passing) plus a real‑browser E2E suite (`RUN_E2E=1`, 79 flows)
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


