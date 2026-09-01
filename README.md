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
  <a href="#testing"><img alt="3,509 tests, 0 failing" src="https://img.shields.io/badge/tests-3%2C509%20%C2%B7%200%20failing-3fb950"></a>
  <a href="#testing"><img alt="120 real-browser end-to-end flows" src="https://img.shields.io/badge/e2e-120%20real--browser%20flows-3fb950"></a>
  <a href="#snmp-integration"><img alt="SNMP v1, v2c and v3" src="https://img.shields.io/badge/SNMP-v1%20%C2%B7%20v2c%20%C2%B7%20v3-00b3d6"></a>
  <a href="#oui-intelligence-engine"><img alt="About 57,000 IEEE OUI entries" src="https://img.shields.io/badge/IEEE%20OUI-~57k-8957e5"></a>
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
<sub>48 pagine illustrate · interfaccia, onboarding e manuale completi in italiano, con selettore IT/EN nell'app.</sub>
</td>
<td align="center" width="50%">
<a href="TECHNICAL_MANUAL_EN.pdf"><img src="GitHub%20Images/flag-gb.svg" width="26" alt=""><br><b>Technical manual — English</b></a><br>
<sub>48 illustrated pages · fully bilingual UI, onboarding and manual, with an in-app IT/EN switcher.</sub>
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

## What it is

InfraNet Pro is a **self-hosted web application** that lets network engineers draw rack layouts and floor-plan diagrams, then bring them to life by polling live data from real devices via SNMP. Interfaces, VLANs, LAG groups and neighbour topology are discovered automatically — no external database, no cloud dependency, minimal tooling (a lightweight esbuild bundle for the frontend; `npm start` builds it).

Current product direction: InfraNet Pro keeps discovery and classification inside the app. External discovery and monitoring engines are not part of the active roadmap; the internal SNMP/sysObjectID/LLDP/CDP/FDB engine is the source of truth and can be refined with local plugins over time.

<table>
<tr>
<td width="33%" valign="top">
<b>🗺️ The drawing checks itself</b><br><br>
You draw the racks and the floor plan. One button polls the real devices and reports what moved: port state, an IP change on the same MAC, a swapped serial, a device that vanished, a cable that never existed.
</td>
<td width="33%" valign="top">
<b>✋ Manual-first, always</b><br><br>
What you declare is law. Discovery <i>proposes</i> and never overwrites: edited fields carry a padlock, and a measurement that disagrees is raised as a warning instead of quietly winning the argument.
</td>
<td width="33%" valign="top">
<b>🚫 It never bluffs</b><br><br>
Every figure declares where it came from — declared, measured (with its age), or derived. A number nobody measured shows as a dash, not a zero, and each lens names what it is <i>not</i> looking at.
</td>
</tr>
<tr>
<td width="33%" valign="top">
<b>📦 Zero infrastructure</b><br><br>
One Node process and one main JSON file per project, with optional history and snapshot sidecars kept outside that project file. No database, no cloud, no agent on your devices, no telemetry. Binds to <code>127.0.0.1</code> by default, and runs in Docker with one command.
</td>
<td width="33%" valign="top">
<b>🔌 Standard MIBs, any vendor</b><br><br>
IF-MIB, Q-BRIDGE, LLDP/CDP, ENTITY-MIB, IEEE 802.3ad, UPS-MIB, Printer-MIB, HOST-RESOURCES. Vendor intelligence lives in hot-reloadable local plugins — never hardcoded into the scan path.
</td>
<td width="33%" valign="top">
<b>📤 Built to hand over</b><br><br>
A vector PDF dossier with an audit-ready asset register, editable draw.io racks (one layer per VLAN), printable cable labels, a read-only REST API and a ready-made Ansible inventory.
</td>
</tr>
</table>

---

## Quick start

```bash
git clone https://github.com/muttley1973/infranetpro.git
cd infranetpro
npm install
npm start
```

Open **http://localhost:8421**. An **admin** account is created on first start and you are prompted to change its password.

<table>
<tr>
<td valign="top" width="50%">
<b>🐳 Prefer a container?</b><br>
<code>docker compose up -d --build</code><br>
<sub>Host networking by default, so discovery is complete. See <a href="#docker">Docker</a>.</sub>
</td>
<td valign="top" width="50%">
<b>🖥️ On Windows?</b><br>
Double-click <code>avvia.bat</code>.<br>
<sub>Full detail in <a href="#installation">Installation</a> and <a href="#configuration">Configuration</a>.</sub>
</td>
</tr>
</table>

> **Your first five minutes:** *New project* → **Add device** → give it an IP → **Properties → Integration** → community → **Poll**. Then run **Discover subnet** on your LAN, and press **Verify** to see your document compared against the live network, row by row.

> 📰 **What's new (v2.11.1) — the canvas got about twice as fast, and the app stopped stating things it had not measured.**
>
> - **Drawing is roughly twice as fast, and a click costs the same at any size.** A full render now reuses the
>   DOM instead of recreating it: 55 ms at 500 devices and 92 at 1000, where it used to be 119 and 203. The
>   floor-only render no longer grows with the project at all, selecting a device repaints only what depends on
>   the selection rather than the whole canvas, and dragging one no longer produces a single long frame. The
>   project list is paid once per save instead of once per read — which is what the per-site device counts on
>   the multi-site map are made of, so the cost used to grow with the number of sites.
> - **A port's VLAN that could not be read is no longer written down as 1.** Zero is not a value a PVID can
>   take — the standard uses it to mean *no VLAN* — so a zero there was a decoding failure wearing the shape of
>   a measurement, and on a device that switches VLANs that invented 1 could outrank a network somebody had
>   documented by hand. It stays absent now, which is a state the rest of the app already knows how to read.
> - **The toolbar stopped moving under your hand.** The four status badges live in one bay after the search
>   field, so nothing shifts when one of them lights up; thirteen dividers became the five that mark what the
>   bar actually does; Delete is no longer painted red at rest, because a warning that is always lit stops
>   warning; and Save is loud when there *is* something to save rather than when there is not.
> - **Notifications stay until you dismiss them.** They used to share one box at the bottom of the screen and
>   fade on a timer, so a second message overwrote a first nobody had read yet.
> - **Text you could not read, in two places.** Four of the twelve cable badges could not carry white text —
>   the worst at 2.03:1 was the one warning you *not* to trust that cable — and the ink is now derived from
>   each background instead of assumed. The type scale is applied as well, which retires 31 near-identical
>   text sizes crammed between 10 and 16 pixels.

> 📰 **v2.11.0 — a project documents one building; this release documents how the buildings talk to each other.**
>
> - **Sites and links, as a map and as a form in the same place.** A panel beside the project picker holds the
>   organisation: its sites, the WAN lines each one buys, the tunnels between them. Clicking a site on the map
>   walks down into that site's own project. Writing it by hand is the primary path, not a fallback — and the
>   NetBox import fills these same fields rather than different ones, reading the circuits and the VPN tunnels
>   an import used never to open.
> - **The declared model now checks itself.** A tunnel carrying a network no site claims, the same subnet
>   declared at two sites, a link that never says which WAN line carries it, an address declared *public* that
>   is a carrier's `100.64` — inconsistencies and gaps kept in separate lists, because a missing line and a
>   false one are not the same thing. Every check that could not run leaves its name and its reason instead of
>   passing for a clean bill of health.
> - **The dossier gains the WAN chapter.** The map of the sites, then one recovery card per line and per link:
>   who sells it, the circuit id you dictate on the phone, the port bandwidth, the device holding each end, and
>   the networks the link makes reachable — which on an IPsec **are** the encryption domain.
> - **A floor plan can hold storeys**, drawn as containers rather than modelled as devices, and the NetBox
>   import stops flattening the locations it reads.
> - **Three ways of quietly losing work are closed.** An edit made *during* a save no longer vanishes; two
>   sessions no longer overwrite each other in silence; and a project reopened from its backup now says so,
>   before you save the older content back over the newer.
>
> 📰 **v2.10.2 — a scan now recognises the model, and the dashboard is a map you can click.**
>
> - **A scan recognises the device model and proposes it — it never applies it on its own.** The model is
>   matched against the catalogue from what the device actually reports (its ENTITY-MIB model name, else its
>   sysDescr), with an honest confidence — an exact hit, or a family. A chip in *Discover* names the match, and
>   the properties panel offers an **Adopt** button: the same manual choice you always had, one step shorter.
> - **The dashboard is a map you can click.** A cable lights up its physical path across the floor and the rack;
>   a subnet, gateway, VLAN or LLDP/CDP neighbour jumps to where it is declared. Each row leaves the overview for
>   the place the thing is edited.
> - **A device that answers on several NICs is one box, not one per address.** A multi-homed server or NAS is
>   folded on authoritative keys only — its own IP table, serial, engine-id — shown with a badge and reversible
>   with a split, and each interface now carries the IP it owns.
>
> The cable VLAN diagnostics were also made consistent and legible.
>
> 📰 **v2.10.1 — the app stopped filling in what nobody had told it.**
>
> - **A VLAN nobody declared is left absent**, not written down as 1. And three things the devices
>   were saying that nobody was reading: the native VLAN of a Cisco trunk, the dot1Q sub-interface
>   where a router-on-a-stick keeps its VLAN and its address, and what a link aggregate declares to
>   the ports bundled into it.
> - **A cable's colour has one definition** instead of the eight that had drifted apart. An access
>   cable takes the one VLAN that applies; **a trunk takes none** and shows what it carries; a
>   **routed** link belongs to no VLAN at all — and you can now declare one **by hand**, so a project
>   drawn without polling anything stops claiming a router-to-router cable switches.
> - **A port has three states, and "idle" is no longer one of them** — one word had been doing four
>   jobs. A port with no link across three verifies turns amber: one switched off by hand is a
>   decision and stays quiet, one that simply lost link is a symptom worth going to look at.
>
> Twenty areas were re-tested live against a home network and a 12-device, 7-OS bench.
>
> 📰 **v2.10.0 — the document learns where things are, and what hosts what.**
>
> - **A NetBox location becomes a room** on the floor plan, with its racks and devices inside it.
>   What has no location stays outside the rooms rather than in one nobody declared.
> - **Hosting virtual machines is a capability, not a type**, so the import stops rewriting a
>   device's type to make room for them.
> - **An LLDP identifier is read from the subtype it declares**, not from the length of its value —
>   the old rule lost MAC addresses written out in full and invented others out of port names.
>
> 📖 Earlier releases — networks as first-class objects with IPv6 parity (2.9.0), the NetBox/DCIM import (2.8.0),
> per-interface addresses (2.8.2) — are in the [CHANGELOG](CHANGELOG.md).

> 🔒 **Security-audited & hardened.** The codebase has undergone an application-security audit (no critical issues) and the follow-up fixes are covered by **automated security regression tests**: the data surfaces (AI context, REST DTOs, exports) are **allowlist-only** so secrets never leave the machine, OS commands run via `execFile` with no shell, project IDs are path-traversal-safe, and secrets use a CSPRNG. See [Authentication & Roles → Security hardening & audit](#authentication--roles).

---
## Table of Contents

<table>
<tr>
<td valign="top" width="33%">

<b>🚀 Get it running</b>
<ul>
<li><a href="#quick-start">Quick start</a></li>
<li><a href="#requirements">Requirements</a></li>
<li><a href="#installation">Installation</a></li>
<li><a href="#docker">Docker</a></li>
<li><a href="#configuration">Configuration</a></li>
<li><a href="#usage">Usage</a></li>
<li><a href="#testing">Testing</a></li>
</ul>

</td>
<td valign="top" width="33%">

<b>🧭 What it does</b>
<ul>
<li><a href="#screenshots">Screenshots</a></li>
<li><a href="#features">Features</a></li>
<li><a href="#snmp-integration">SNMP integration</a></li>
<li><a href="#vlan-management">VLAN management</a></li>
<li><a href="#lag--etherchannel-detection">LAG / EtherChannel detection</a></li>
<li><a href="#authentication--roles">Authentication &amp; roles</a></li>
<li><a href="#known-limitations">Known limitations</a></li>
</ul>

</td>
<td valign="top" width="33%">

<b>🔬 Under the hood</b>
<ul>
<li><a href="#architecture">Architecture</a></li>
<li><a href="#sysobjectid-intelligence-engine">sysObjectID engine</a></li>
<li><a href="#oui-intelligence-engine">OUI engine</a></li>
<li><a href="#fusion-scoring-engine">Fusion scoring engine</a></li>
<li><a href="#project-data-model">Project data model</a></li>
<li><a href="#api-reference">API reference</a></li>
<li><a href="#rest-api-v1">REST API (v1)</a></li>
</ul>

</td>
</tr>
</table>

<p align="center">
  <a href="#roadmap">Roadmap</a> ·
  <a href="#feedback--requests">Feedback &amp; requests</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="#support">Support</a> ·
  <a href="#license">License</a> ·
  <a href="ARCHITECTURE.md">ARCHITECTURE.md</a> ·
  <a href="CHANGELOG.md">CHANGELOG.md</a> ·
  <a href="LICENSING.md">LICENSING.md</a>
</p>

---
## Screenshots

<p align="center">
  <b>Full feature manual (PDF)</b> —
  <a href="MANUALE_TECNICO_IT.pdf"><img src="GitHub%20Images/flag-it.svg" width="20" alt=""> Italiano</a> ·
  <a href="TECHNICAL_MANUAL_EN.pdf"><img src="GitHub%20Images/flag-gb.svg" width="20" alt=""> English</a><br>
  <sub>Dark cover, white printable interior, 19 illustrated chapters, 48 pages per language.</sub>
</p>

<p align="center">
  <img src="GitHub%20Images/Multisito.png" alt="InfraNet Pro — Sites and links: the multi-site map, with each site's WAN lines, the tunnels between them and the coherence counters" width="900"><br>
  <em>Sites and links — the floor above a project: each site with the lines it buys and what is inside it, the tunnels between them, and the counters of what does not add up. Click a site to walk down into its own project.</em>
</p>

<p align="center">
  <img src="GitHub%20Images/Topologia.png" alt="InfraNet Pro — topology view" width="900"><br>
  <em>Topology — auto-discovered L1/L2 neighbours (LLDP / CDP / FDB) drawn over the floor plan</em>
</p>

<p align="center">
  <img src="GitHub%20Images/pannello%20Panoramica.png" alt="InfraNet Pro — the Dashboard: three columns of verdicts with the provenance of every figure" width="900"><br>
  <em>Dashboard — three standing questions in three columns, every number carrying its <b>provenance</b>: declared, from a scan, derived, or <em>not declared</em> as a dash rather than a zero. Rows open in place. <sub>(Shown in Italian — the whole UI ships in both languages.)</sub></em>
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

| Area | At a glance |
|---|---|
| **🗺️ Diagramming** | 19″ racks with live port LEDs, floor plans, ~5,300 device models across 276 vendors, MGMT & SFP blocks, hypervisors and VMs, the Dashboard, exports to PDF · SVG · draw.io |
| **🏢 Multi-site** | The floor above a project: the sites, the WAN lines each one buys and the tunnels between them, as a map and as a form in the same place. A coherence audit on the declared model alone keeps inconsistencies and gaps apart and names what it could not check; NetBox circuits and VPN tunnels are read per site; the dossier gains a WAN chapter with a recovery card per line and per link. |
| **📡 Live SNMP** | v1 / v2c / v3 discovery, interfaces, VLANs, LAG, LLDP/CDP neighbours, ENTITY-MIB inventory, wireless associations, DHCP lease import, the Verify / Drift report |
| **🔄 DCIM / IPAM sync** | Import an existing **NetBox** into a new project over its REST API — sites, racks (front/rear split), floor-placed, devices, interfaces, VLANs/prefixes and patch-panel cabling; free import, paid write-back |
| **🔗 LAG detection** | A four-level cascade — `ifStackTable` · IEEE 802.3ad · LACP actor state · LLDP-inferred — plus coherence checks on what a bundle needs to actually form: uniform member speed and VLAN, LACP mode across both ends, a bundle that is not left with a single member, and members that do not straddle two devices unless those are one logical switch (stack / MLAG) |
| **🏷️ VLAN** | Access and trunk detection, Q-BRIDGE bitmaps with a VTP fallback, auto-derived trunks, per-VLAN IPAM occupancy, one-click isolation across the whole map |
| **🧮 IPAM hygiene** | Duplicate addresses (IPv4 and IPv6, compared in canonical form), overlapping prefixes told apart from the hierarchies a plan legitimately contains, and addresses that fall outside every declared network — judged per address family, so a plan with no IPv6 network passes no verdict on IPv6. Any check that could not run says so instead of reporting a clean result |
| **📶 Wireless** | Up to 8 radios per device with their own SSID, band, channel, security and VLAN; over-the-air association discovery from the bridge FDB and the L3 neighbour table |
| **🧵 Cabling** | Segment editor on the TIA-568 hierarchy, copper *and* fibre reach validation, end-to-end physical path trace, printable label sheets and CSV |
| **🕓 History & automation** | One **Automatic monitoring** scheduler (Light / Full), opt-in autosave, a verification timeline and restorable full-state snapshots — kept outside the project file, behind a database-ready interface |
| **🤖 AI assistant** | Bring-your-own-key, OpenAI-compatible, local by default; allowlist context, grounded answers with clickable citations, Ansible drafts — advisory, never auto-applied |
| **🔒 Security** | Session auth with admin/viewer roles, rate-limited login, loopback bind, secrets structurally excluded from every data surface |
| **🌍 Bilingual** | Complete Italian and English interface, onboarding and a ~65-page manual, guarded by an `it ↔ en` key-parity test |

> Every heading below opens. Deeper detail lives in [ARCHITECTURE.md](ARCHITECTURE.md), the [technical manuals](MANUALE_TECNICO_IT.pdf) and the commit history.
<details>
<summary><b>🗺️ Diagramming</b> — <sub>racks, floor plans, labels, hypervisors, the Dashboard and every export</sub></summary>

- **Rack view** — drag-and-drop 19″ rack units (1U–8U) with colour-coded port LEDs.
- **Apply model** — search a real switch or router model and apply it in one click: port count and front panel are set natively and drawn by the built-in renderer. The catalogue ships ~5,300 models across 276 vendors, generated from public-domain device data (`tools/import-device-types.js`).
- **Front-panel controls** — per-device port count and layout (Auto / Linear / Sequential / Cisco-alternating), with an optional separate SFP block and a dedicated MGMT block.
- **Dedicated MGMT ports** — up to 4 cyan cells outside the regular `1..N` numbering, with an editable label (MGMT, iLO, iDRAC, fxp0…). Excluded from VLAN/LAG/FDB data-plane logic.
- **SFP block** — a separate cell group with an anodised border, left or right of the main port grid, up to 48 per block; high-density combinations compact the gaps and cells automatically so copper, SFP and MGMT ports remain visible.
- **Floor map** — place devices on an SVG floor plan; cables drawn as bezier curves.
- **Two levels of containment: storeys and rooms** — a room for an office or a server room, a **storey** for the level that holds them. Same shape at a larger scale, so same drag, resize, lock, colour and opacity; the stacking is declared rather than left to DOM order (storey under room, room under devices), because a container covering what it contains makes its contents unselectable. A storey is always top-level, and neither ever enters the device inventory.
- **Labels say what a thing is** — the name on top, the address underneath. When Discover finds no hostname it stores the IP as the name, so the readable line is *derived for display* from the classified type and vendor (`IoT-AzureWave`, `NAS-LaCie`); `node.name` is never rewritten and a declared name always wins (`lib/node-label.js`).
- **Multi-port floor devices** — PCs, access points and custom endpoints can declare several ports, each independently cablable. Orthogonal to the pass-through model of wall sockets and VoIP phones.
- **VMs under whatever hosts them** — hypervisor, home lab, storage array, desktop NAS or server: hosting VMs is something a device *does*, not what it is, and a Synology or QNAP running them from a package is still a storage box. Model VMs under a host (`node.vms[]`): a compact list, and a dedicated **VM card** with identity, network & access, allocated resources and handover data. A VM can declare several **vNICs** (a virtual firewall has WAN + LAN + DMZ), each feeding the derived trunk, the documented devices of the Check and the duplicate audit. A vNIC has no cable of its own: it rides the host uplink, and with uplinks in teaming which one carries it is not knowable — so it is not declared.
- **VMs over SNMP** — a VM exposing its own agent is polled like any host (`vm.integration` mirrors the device shape field for field). What comes back is a **measured block stamped with the read time**, kept apart from what you declared. An answer proves the VM is running; silence never marks it stopped.
- **Absorb a discovered tile into its host** — drag a loose tile onto the host's *Virtual machines* section and it becomes a VM, inheriting name/IP/MAC, so it stops being flagged undocumented. A MAC *or* an IP is enough. Undoable.
- **Sites and links (multi-site)** — a project documents one building; this is the floor above it. Describe the organisation, its **sites** (each a *reference* to its existing project, never a copy), the **WAN uplinks** and the **links between sites**. A link answers **two** questions on two separate fields, because an IPsec inside an MPLS is one link and a single field forced you to drop half of it: **transport** — what it travels on (internet, MPLS, VPLS, VPWS, VXLAN, EVPN, direct link, *other*) — and **tunnel** — what runs on top (none, IPsec, GRE, WireGuard, OpenVPN, L2TP, SD-WAN, *other*). Either may stay unstated; neither is ever guessed. Which subnets a link makes reachable at each end is one concept for every nature (on an IPsec it *is* the encryption domain), and so is **which WAN lines carry it** — the recovery question: *the Milan fibre is down, what falls with it?* Both ends record the device that holds them, picked from the site's project or typed by hand — because the CE of a carrier link is often not a documented node, and so do the provider and the circuit id, which are the same question whatever the kind. Written by hand — no device is queried — or, for a site imported from a DCIM, **read from NetBox's circuits** with one button per site.
- **The inter-site map** — sites as boxes holding their own WAN lines, links as edges carrying their transport, tunnel and the networks they transport, and two links between the same pair fanned apart instead of drawn over each other; a declared state and a measured one never look the same. Deterministic geometry — the same input always draws the same map, so it can be compared with yesterday's and printed twice alike. Click a site to walk down into its own project.
- **Multi-site coherence** — the questions a hand-drawn multi-site document should have to survive: a link carrying a network no site claims, the same subnet declared at two sites, an endpoint pointing at a site that does not exist, a spoke touching no hub, a link declaring a WAN line that belongs to neither of its two sites — a Turin line cannot carry a Milan-to-Rome link — and a link that never says which line carries it at all. **Incoherences and gaps stay apart** — one is wrong, the other is merely unwritten — and every check that could not run says so by name, so an empty list never means two things at once.
- **Take a site's networks from its project** — one button adds the networks *declared* in the site's project, and never the /24s inferred from device addresses: the first are a document, the second a derivation. It only adds, never replaces.
- **Uniform floor/rack interaction** — single click selects, double click opens Properties, on the floor as in the rack.
- **Operating-system logos** — in the device and VM panel headers and the VM list, from public-domain and permissively-licensed sets. A specific logo only from an **authoritative source** (SNMP `sysDescr`, a manual field, a guest OS), a grey family glyph for a mere TTL hint, and **nothing** when the OS is unknown (`lib/os-icon.js`).
- **Sub-header bar** — breadcrumb (organisation · project · view, with the organisation as the step back up), the active VLAN filter, and project stats on the right (documentation completeness, device count, SNMP health dot). Computed, never estimated (`lib/subbar-stats.js`).
- **Dashboard view** — a read-only view switch that answers three standing questions in three columns: **LAN** (is the document complete?), **Conformance** (does it still match reality?), **Expansion** (how much can I grow?). Every cell carries a number, a plain-word verdict and the **provenance** of the figure — declared, measured with a date, derived, or *not declared* as a dashed cell rather than a zero.
- **Dashboard verdicts** — each column opens with a health dot and a sober phrase; red is reserved for *flying blind*, so a synced-but-imperfect project reads amber. A **since-last-read delta** shows problems closed or opened versus the previous read, and after seven days without contact a green verdict in the two measurement-based columns degrades and says how long ago it was read.
- **Dashboard drill-downs** — every row opens in place. Free addresses count capacity on the **declared subnet prefix** (a /16 is ~65,000 addresses, not 254), networks you use but never declared surface as *undeclared*, free ports split into **in-rack / outside-rack / by-speed**, and IP and MAC share one row as the project's **ARP pairing**.
- **Dashboard navigation** — the detail rows are live, not only readable: click a cable to trace its whole physical path across the floor and rack, a subnet, gateway or VLAN to open the panel where it is declared, an LLDP/CDP neighbour to light up the cable it matches. Each click leaves the Dashboard for the place the thing is edited or seen.
- **Dashboard lenses** — three opt-in full-width lenses beyond the summary: **Recoverability (DR)** (backup freshness, hardware identity, location, presence), **Security & Services** (encrypted versus cleartext SNMP, default communities counted without the value ever leaving the engine, management-VLAN segmentation), and **Health** — the only one that speaks about the present, composing telemetry already returned through documented thresholds.
- **"What I'm not looking at"** — a footnote under every lens naming the dimensions the summary does *not* judge (WAN, L3 routing, spanning tree, firewall/ACL, AAA, restore proof, temperature, trunk symmetry), so the absence of an alarm is never read as *all clear*. It is data in the engine, retired one line at a time.
- **Wireless links** — mark a connection wireless and it draws as a sine wave, skips cable validation and is auto-suggested when one end is an access point. Wi-Fi-capable devices expose a **radio port** that hosts many clients without consuming physical ports; any other device can opt into **AP mode** to broadcast an SSID without changing its type.
- **Wireless properties** — SSID, band, channel (grouped by sub-band, DFS-marked), security and 802.11 standard, validated with educational warnings; the association inherits them read-only and carries its own RSSI and distance (`lib/wifi-spec.js`).
- **UPS / ATS live SNMP** — a read-only live block from UPS-MIB (RFC 1628) and the APC PowerNet profile: mains or battery, charge, runtime remaining, load, input/output voltage. A transfer switch whose profile doesn't answer **says so** rather than showing a card of dashes (`lib/power-mib.js`).
- **L3-lite gateway** — who routes each **network**, one row per declared prefix, both address families: an L3 badge, a read-only SVI panel section, and a **Report → L3 map** with orphan, out-of-subnet, wrong-family and reserved-address warnings plus CSV. Binding a VLAN to its routing device stays on the VLAN, auto-suggested with the manual override winning — the SVI is one interface even when it carries an IPv4 and an IPv6 gateway.
- **IPAM hygiene** — the L3 map flags the same address documented on two devices (IPv4 and IPv6, compared canonically, so two spellings of one IPv6 are one address) and any two declared prefixes that overlap (`lib/ipam-audit.js`, document against document, never invented).
- **LAG member consistency** — warns when a group's members have different speeds or access VLANs; they would not bundle on real hardware (`lib/lag-audit.js`).
- **LACP mode & cross-end coherence** — each group has a mode (active / passive / static), auto-derived over SNMP and manual-first. InfraNet resolves the peer LAG from the cabling and warns on the two classic failures: both ends passive, and LACP against static.
- **Cable path insight** — cable properties reconstruct the linear path across wall ports, patch panels and media converters.
- **Multiple projects** — create, rename, copy and delete independent maps.
- **Vector PDF / SVG export** — full rack export including MGMT and SFP side blocks, with a port-assignment table.
- **draw.io rack export** — a native, editable `.drawio` diagram, one page per rack, with real port cells inside draw.io's own numbered rack container. Cables export as one native edge each on **one layer per VLAN**, coloured and routed so they never overlap, each layer carrying a **clickable cable table**. Pages auto-fit A4 or A3.
- **Audit-ready asset register (PDF)** — an optional per-device inventory page built from the same **secret-free allowlist DTO** as the REST API, plus a *last revised* timestamp on the cover: the documentation evidence NIS2 and ISO 27001 A.5.9 ask for. The whole report is bilingual and follows the UI language.
- **Dashboard page in the dossier** — one page after the floor plan carrying the three questions, their verdicts, the provenance dots and the *"what I'm not looking at"* line. The executive summary the dossier was missing.
- **Recoverability (DR) section in the PDF** — one row per managed device: where the backup lives (the pointer, never the config or credentials), when it was taken, the serial and firmware to procure, the lifecycle dates and the rack it returns to. Kept off-site, it survives the LAN it rebuilds.
- **Progressive patch-panel numbering** — several panels serving one run can continue each other's numbering via an explicit chain, with a cycle guard. Display-only: port IDs stay stable.
- **Cable-label export** — pick the fields you need with a live preview; export as CSV for mail-merge or as ready-to-print **PDF label sheets** (Avery A4 grids, Dymo rolls, configurable generic). Includes a wrap/flag mode that repeats the ID so it reads from both sides. The room is derived geometrically from the floor position.
- **Dark UI** — a focused dark theme driven by semantic CSS tokens, so a light theme would only add a second value set.

</details>

<details>
<summary><b>📡 Live Device Integration (SNMP)</b> — <sub>discovery, polling, neighbours, honest presence, the drift report and DHCP leases</sub></summary>

- **SNMP v1 / v2c / v3** (authPriv, authNoPriv, noAuthNoPriv) out of the box.
- **Auto-discovery** — scan a subnet (CIDR or range) and auto-place reachable devices.
- **Interface discovery** — every physical interface with speed, duplex, admin and operational state.
- **Hardware inventory** — `brand` / `model` / `serialNumber` / `firmwareVer` from ENTITY-MIB (RFC 6933). Manually edited values are never overwritten.
- **LLDP / CDP neighbour polling** — resolves connected neighbours and auto-draws cables.
- **Wireless association discovery** — the Sync draws over-the-air associations from the **bridge FDB** (a client MAC on a radio interface) and the **L3 neighbour table**, the latter universally implemented so it covers all-in-one boxes and software hotspots. The SSID is chosen by VLAN match; ambiguity is left for you (`lib/wifi-assoc.js`).
- **Auto-link creation** — duplicate links between the same pair become a LAG automatically; virtual MACs (Docker, VMware, Hyper-V, Xen, KVM) are filtered out via the OUI engine.
- **Topology walk** — one-click recursive discovery across a seed device's LLDP neighbours.
- **Off-segment discovery via SNMP ARP** — the walk also reads each reachable device's ARP table and proposes hosts that answer neither ping nor SNMP nor LLDP/CDP. Bounded to the scanned subnet, deduped, presented as observed and **not pre-selected**.
- **Manual-first** — user-edited `hostname`, `ip` and `integration.host` are protected by `*Manual` flags and never overwritten by SNMP or discovery.
- **Port mapping by ifName** — SNMP interfaces are matched to ports by name, not by position, so a hand-cabled port is never silently reassigned. A genuine access-versus-trunk mismatch is **surfaced as a warning**, not hidden. *Validated on a multivendor lab: Cisco vIOS, MikroTik, VyOS, net-snmp, two LACP bundles, four VLANs.*
- **Reality Check / Drift Report** — one button runs the SNMP sync plus a multi-signal presence sweep (ping / ARP / TCP on top of SNMP and FDB), then compares the live network against the documentation in **6 categories**: consistent ports, state drift, IP change on the same MAC, documented-but-absent, undocumented devices, and ghost cables.
- **Honest presence** — red only from a signal a live host cannot suppress (a local ARP miss on the server's own segment, or a switch access port down for N consecutive syncs). A merely silent device, or one on a subnet the sweep never reached, is reported **not verified** — never wrongly absent. A device proven alive by a router's ARP table stays green across subnets.
- **One click per row** — *update doc*, *ignore* (persisted until the condition changes), *investigate*. The diff is a pure tested function (`lib/drift-report.js`), and the result lands in the Dashboard's Conformance column as saved state rather than a transient overlay.
- **DHCP lease import** — paste or load a lease table (ISC dhcpd, dnsmasq, Kea, generic CSV; pfSense, OPNsense, MikroTik, Synology, Windows exports) for authoritative MAC ↔ IP across **all VLANs** — what local ARP cannot see behind an L3 firewall. Multiple servers accumulate as persisted sources. A lease table is an **identity map, not a liveness probe**: a documented device missing from it is *unverifiable*, never absent (`lib/dhcp-lease.js`). Live vendor pull is a separately-distributed driver pack.
- **Endpoint/BYOD transparency** — undocumented entries that look like user devices (guest VLAN, crowded uplink port, randomised MAC) collapse into a group so the actionable infrastructure stays clean. Each hidden row says **why** in plain language, and a toggle reveals them.
- **"Management VLAN" role** — the opposite of a guest VLAN: an undocumented device seen there is forced to infrastructure, never collapsed as BYOD, and flagged with a red security badge.

</details>

<details>
<summary><b>🔄 DCIM / IPAM sync (NetBox)</b> — <sub>import an existing NetBox into a new project; write-back is a paid module</sub></summary>

- **Live connection over the REST API** — set a base URL and an API token, then **Test connection** probes `/api/status/` (chip turns green on success, red on failure). If an API endpoint is pasted by mistake, InfraNet reduces it to the instance base automatically. The token is stored server-side at `0o600`, is never returned to the browser, and never enters git — the same secret handling as the SNMP and AI keys.
- **Three-step import wizard** → new project — **Scope** (pick a site, with counts), **Entities** (devices+ports+cables / IPAM / racks toggles), **Preview** (live counts, per-row deselect, honest warnings) → **Create project**. A staged progress screen, a result with counts and *Open project*, and a retry on error. Import is read-only (GET); it never writes to NetBox.
- **NetBox authentication** — use the v2 token format (`nbt_<key>.<secret>`), sent as `Authorization: Bearer`; legacy tokens continue temporarily as `Authorization: Token` and are identified by the connection test with a migration warning. Raw tokens and complete `Token ...` / `Bearer ...` header values are accepted. REST paths remain unversioned (`/api/dcim/...`, `/api/ipam/...`, `/api/status/`).
- **One site = one project** — the site names the project, racks keep their NetBox names, and a device's Location becomes a note (InfraNet has no multi-floor model); import one site at a time so rack names stay unambiguous.
- **Racks placed on the floor plan** — each imported rack is auto-positioned on a non-overlapping grid and appears as a clickable floor icon; the first rack opens in the Rack view, populated.
- **Front/rear cabinet split** — a NetBox rack with devices on *both* faces becomes **two** InfraNet racks (`… · retro`), each device on its own side, with cross-face cables drawn as cross-rack links.
- **Patch-panel cabling** — front/rear-port terminations are reconstructed as a **native pass-through chain** (switch → panel-A → panel-B → server) sharing the pass-through pid — no synthetic segments. Type-aware termination resolution avoids id collisions across NetBox's separate id spaces, and the NetBox 4.6 `rear_ports[]` array schema is handled alongside the legacy singular field. Power/PDU cables are out of scope and skipped quietly; a cable landing on a **WAN circuit** is not lost — the line itself is read in *Sites and links*, where uplinks live.
- **Inter-site links from L2VPNs and tunnels** — NetBox keeps what *binds* two sites in an application of its own (`vpn/`): L2 services (VPLS, VXLAN, EVPN, E-Line) and tunnels (IPsec, GRE, WireGuard). They are read alongside the circuits, and here the kind is **translated** rather than guessed — `l2vpn.type` and `tunnel.encapsulation` are closed NetBox vocabularies, unlike a circuit's type, which is free text of that instance; anything with no counterpart enters as *other* carrying NetBox's own label. The outside addresses **cross over** (the peer of one end is the other end's outside address), hub/spoke roles give the topology while two peers give nothing, and a multipoint service is refused with the reason rather than split into invented pairs.
- **WAN lines from circuits** — per site, the circuits terminating at the NetBox site the project came from are read and **added** (never replacing) as WAN uplinks: provider, circuit id, service type and the committed rate (kbps → Mbps; the port speed is never used as a fallback — it is a different thing). A circuit between two sites becomes an inter-site link when both are sites here; a line ending on a carrier's provider network stays an uplink and the cloud is *said*, because several sites on one MPLS cloud are not pairs of connected sites. Only *active* circuits are offered: an uplink has no state field, so a planned or decommissioned line would be indistinguishable from one in service.
- **Catalogue reconciliation** — a NetBox `device_type.slug` is matched against the built-in device-type catalogue (both seeded from the same public NetBox library), applying the native port count and front panel; otherwise the imported interface count is used.
 - **PDU power connections** — up to 48 outlets are rendered inside a frame that adapts to the device height (`1U`, `2U` and above). The PDU and single-outlet Properties → **Alimentazione** accordions expose the powered device through a dropdown of devices placed in the project racks and its power port from NetBox; the aggregated outlet list uses the same dark controls, typography and focus treatment as the single-outlet panel. Manual edits are stored as protected overrides, with a one-click reset to the imported value. Outlet state follows NetBox's `Enabled` / `Disabled` / `Faulty` model as active / inactive / fault, defaults to inactive when undocumented, and becomes active when a connection is documented unless an explicit manual or imported state says otherwise. A manual state always wins over the imported NetBox value, including the raw imported status.
- **Manual-first, non-destructive** — import creates a **new** project and never clobbers an existing one. **Write-back to NetBox is a paid module** (`modules/dcim-export/`): dry-run diff first, create-or-PATCH by natural key, **never delete**; the free build feature-detects it and hides the Export tab.

</details>

<details>
<summary><b>🔗 LAG / EtherChannel (multi-level detection)</b> — <sub>the four-level cascade, and what Cisco does differently</sub></summary>

- **L0** — `ifStackTable` higher/lower layer analysis.
- **L1** — `dot3adAggMemberPorts` (IEEE 802.3ad MIB).
- **L2** — `lagAttached` + actor operational state bitmask.
- **LLDP-inferred** — two or more parallel LLDP links between the same device pair.
- Cisco IOS `Port-channel` (ifType 53 / propVirtual) fully supported.
- Groups auto-named from the aggregator interface (`Port-channel1`, `bond0`).
- Selecting a LAG member port highlights all its siblings.

</details>

<details>
<summary><b>🏷️ VLAN Management</b> — <sub>access and trunk, the VTP fallback, derived trunks and IPAM occupancy</sub></summary>

- **Per-port VLAN assignment** (access mode) and **trunk detection** with native VLAN and allowed list.
- VLAN list shown in both the cable popup and the port popup, in compact range notation (`1,10,100-120,200`).
- **Fallback VLAN discovery via Cisco VTP MIB** — no per-VLAN community required.
- **Optional VLAN legend on the floor plan**; in Topology view it stays on as the clickable VLAN filter.
- **VLAN details grouped by device** — the members modal collapses access ports into per-device accordions.
- **Auto-derived trunks** — a link's trunk membership is *derived* from the VLANs its endpoints carry (VoIP voice VLAN, per-SSID Wi-Fi VLANs) plus the polled trunk. Manual-first: a hand-set trunk wins (`lib/vlan-trunk.js`).
- **Unified VLAN distribution, cable ↔ wireless** — the same propagation seeds physical ports *and* radios, so a wireless client inherits its SSID's VLAN exactly like a wired access port.
- **Site default native VLAN** — change the untagged default site-wide; per-port and per-trunk overrides win. It is also the **floor**: a cable that switches and that no source can name takes it, labelled as a default rather than a reading.
- **One decision for a cable's colour** (`lib/link-vlan-color.js`) — four outcomes and nothing else: one VLAN applies and you see its colour; a trunk carries several and stays neutral with the carried VLANs as equal pills; a routed link belongs to no VLAN at all; and when the two ends name *different* VLANs with the same authority the cable stays neutral too, because that one does not describe the cable but the document — there is no answer until somebody decides. Eight sites used to compute this independently and had already drifted apart.
- **Whoever names a VLAN must switch it** (`lib/vlan-authority.js`) — being an *active* device is not enough: a box whose entire VLAN world is `[1]` is saying «my port is untagged», so its 1 no longer overrules a declared network. The same rule governs propagation, so the claim cannot come back as an inherited VLAN one rung lower.
- **Unmanaged switches are VLAN-transparent** — declared in the Switch panel, never guessed: the VLAN arriving at the box's edge applies to every one of its sockets, the way a plain 802.1D bridge actually behaves.
- **Routed ports are measured, not inferred** — a port that owns an address *and* is absent from the bridge-port table routes; being **in** that table vetoes the verdict, because a device that switches is not routing.
- **Carried VLANs are reconciled** — the trunk list written by hand is compared with what the switches allow, one row per end, and adopting reality writes onto the cable where the declaration lives.
- **IPAM occupancy from DHCP leases** — real address usage per VLAN: capacity, a usage bar, and a documented / DHCP-only / free breakdown, with an *"N undocumented → Adopt"* shortcut that carries MAC, IP and hostname (`lib/ipam.js`, read-only).

</details>

<details>
<summary><b>📶 Wireless</b> — <sub>radios, SSIDs, bands and channels — and why a radio only talks to a radio</sub></summary>

- **Up to 8 radio interfaces per device**, each with its own SSID, band, channel, security and VLAN (`lib/radio.js`).
- **Wireless is its own connection type** — a radio port only connects to another radio port; radio to network-port is rejected.
- **Per-device radio layout** — floor tiles show radios on 8 perimeter anchors, rack devices line them up on the left edge.
- A device's SSID VLANs are carried tagged on its wired uplink, which automatically becomes a **trunk**.

</details>

<details>
<summary><b>🧵 Cabling Metadata</b> — <sub>segments, the TIA-568 hierarchy, reach validation and the physical path trace</sub></summary>

- Cable-level metadata on `state.links[]`: type, length, colour, install date and installer, permanence, notes — with backward-compatible normalisation of legacy fields.
- **Segment editor** — highlight mode lights every free pass-through port; click one to split a cable into two real segments (`PC ↔ patch panel ↔ switch`). *Remove hop* merges them back (`lib/cabling.js`).
- **TIA-568 hierarchy rule** — a hop can only be inserted if it sits *between* the endpoints in the structured-cabling hierarchy, so a completed run cannot be extended with out-of-place hops. VoIP phones are pass-through at level 0.5.
- **End-to-end chain validation** — a badge flags structurally anomalous paths (active device mid-span, non-monotone order, too many hops). Informational, non-blocking.
- **Cable validation** — copper reach per category (Cat8 is 30 m, and 10G over Cat6 within 55 m is compliant, so it does not warn) and **fibre reach by optical class *and speed*** — OM3 carries 300 m at 10G but 100 m at 40G. Without a class, a speed or a length, nothing is asserted.
- **Chain-aware topology state** — a routed inferred cable stays inferred on every hop until the whole chain is confirmed, so there are no mixed animated and solid segments.
- **Map view bar** — the Topology toggle and the VLAN filter legend sit together at the top-right of the floor plan.
- **Topology legend toggles** — `TRUNK` highlights trunk links and reveals them inside the rack window; `ENDPOINT` hides the last hop to leaf devices to declutter the backbone.
- **Physical-path trace** — double-click a cable in Topology to light up the *whole* run (switch → patch → wall socket → endpoint) across racks and floor.

</details>

<details>
<summary><b>🤖 AI Assistant (advisory)</b> — <sub>bring-your-own-key, allowlist context, grounded answers and Ansible drafts</sub></summary>

- **In-app assistant, bring-your-own-key** — a third *Assistant* tab that answers questions about *your documented network* in plain language: who is on a VLAN, what is on a port, which IPs are free, why a device is absent, SNMP health, topology, SSIDs and hardware capabilities. Provider-agnostic through a single **OpenAI-compatible** endpoint, **local by default** so data never leaves the machine.
- **Data security by construction** — the API key lives **only on the server** and never returns to the browser. The context is built from the **same allowlist** as the REST API, so the SNMP community and credentials are not in the list and physically cannot leave; a secret-name denylist guards the health passthrough. A **"Show what leaves"** button previews the exact sanitised JSON, and a build-failing test asserts no secret can reach the context.
- **No hallucination** — *"InfraNet computes, the AI narrates"*: drift, free IPs and gaps are pre-computed and passed as facts, and the model is told to answer *"not in the documentation"* when it doesn't know.
- **Scope & capability toggles** — pick what leaves the machine (inventory, ports, health, topology, drift) and what the assistant may do (Q&A, diagnostics, gap-finding, suggestions, Ansible draft). Zero-dependency server client; no model bundled.
- **Chat controls** — the robot button in the toolbar opens the scope and capability settings at any time, a red trash button clears the conversation (session-only, never persisted), and saving the config refreshes the panel instantly.
- **Clickable citations & anti-invention check** — answers surface the devices and VLANs they used as chips that jump to the node on the map, and a downstream check flags any IP or MAC the model names that **isn't in your data** (`lib/ai-grounding.js`; SNMP OIDs are recognised as such, never mistaken for IPs).
- **Find gaps, draft Ansible, explain Drift** — the context carries pre-computed gaps and the next free IP per VLAN. Ask for automation and you get a playbook rendered as a **draft card**, never executed, and every actionable Verify row has an **Explain** button that seeds a grounded question about that exact case.
- **Hardware capabilities & per-model advice** — each device's documented capabilities are pre-computed (`lib/hw-capabilities.js`): PoE budget and headroom, UPS runtime, CPU/RAM/storage, NAS capacity, firewall throughput, controller AP capacity, port capacity and aggregate uplink bandwidth. An undocumented field is **omitted, never invented**. Model-specific suggestions are labelled *"typical, verify on the datasheet"* and kept separate from InfraNet's authoritative data.
- **Onboarding copilot** — a **next-step chip** from deterministic rules over your project state, working even before a model is configured (`lib/onboarding.js`). **"Show me"** lights the *real* toolbar button with a coach-mark that stays until you click it; **"Ask"** seeds a grounded how-to. Help is anchored to the real command surface derived from the UI itself, so it cites labels that exist.
- **Onboarding guide** — the assistant orients you across the full workflow (build → document → verify → analyse → hand off → automate) by the features' real labels, and proactively surfaces under-used ones relevant to your project's actual state.
- **Health monitoring & proactive alerts** — the assistant sees each device's real SNMP health (printer supplies, host CPU/RAM/disks, UPS). A pure engine derives **deterministic alerts against thresholds** (`lib/health-alerts.js`) and the prompt tells the assistant to report problems first, using only pre-computed values. HOST-RESOURCES is polled for network gear too, so Linux-based devices give CPU, RAM and disk for free. Reachability stays with Verify; temperature and traffic are not collected, so they are never fabricated.

</details>

<details>
<summary><b>🔒 Security</b> — <sub>authentication, roles, what it binds to and what it never sends</sub></summary>

- Session-based authentication (express-session + bcryptjs) with a **rate-limited login** endpoint.
- Two roles: **admin** (full control) and **viewer** (read-only), with SNMP secrets redacted for viewers.
- Auto-generated session secret persisted to `.session-secret`, owner-only and written atomically.
- Binds to `127.0.0.1` only — not exposed to the network by default.
- Baseline security headers on every response, path-traversal-safe project IDs, and CSPRNG-generated secrets. See [Security hardening & audit](#authentication--roles).

</details>

<details>
<summary><b>🌍 Internationalization (i18n)</b> — <sub>the bilingual interface, and the test that keeps it honest</sub></summary>

- **Bilingual UI (Italian / English)** with a switcher in the user menu *and* on the login page; the choice is persisted and carried into the app.
- Pure, zero-dependency `lib/i18n.js`: `t(key, vars)` with an `it → en` fallback, so an untranslated key never breaks the UI.
- Two wiring mechanisms: `data-i18n` attributes for static HTML, `t('key')` inline for JS-generated panels.
- The technical glossary (VLAN, SNMP, LLDP/CDP, SFP…) and vendor names are intentionally left untranslated.
- An `it ↔ en` key-parity test guards against missing translations — including the pure validators, whose warnings used to be hardcoded Italian.

</details>

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
- **Minimal-tooling frontend** — the only build step is a lightweight esbuild bundle of the `src/` ESM modules; the pure `lib/*.js` and `export.js` stay classic static assets *by design*. The strangler migration to ESM is complete; retiring the transitional `window` bridge (`win.*` reads → `import`, inline handlers → event delegation) is **being finished one panel at a time** — Axis A (`win.*` → `import`) is down to 264 reads and still falling — twice now a supposed floor turned out to be one more caller nobody had converted — and Axis B (inline handlers → delegation) is driven down behind a monotonic ratchet that only shrinks. See [ARCHITECTURE.md](ARCHITECTURE.md) §10.
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
3. **Cisco VTP MIB** (`vtpVlanName`, OID `1.3.6.1.4.1.9.9.46.1.3.1.1.4` — column `.4` of `vtpVlanTable`; `.2` is `vtpVlanState`) — fallback that works without any special community, returns all VLANs defined in the VTP domain (the reserved rows 1002-1005 are skipped)

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
InfraNet Pro is designed for a **trusted LAN, behind login**, bound to `127.0.0.1` by default. The codebase has undergone an **application-security audit** (no critical findings) and the follow-up hardening is enforced by tests.

<details>
<summary><b>The 14 hardening measures, and the test that guards each one</b></summary>

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

</details>

> 🔐 Found a vulnerability? Please report it **privately** to the maintainer instead of opening a public issue.

### Managing Users (admin panel)
Log in as admin → **Settings → Users** to:
- Add new users
- Change passwords
- Promote / demote roles
- Delete users

---

## Project Data Model

Each project is a plain JSON file in `projects/<id>.json`: top-level `format`, `schemaVersion`, `id` / `name` / `created_at` / `updated_at` plus a `state` object holding the network. The main collections are `nodes` (devices), `links` (cables — with cabling metadata, LAG grouping, auto-link confidence and pass-through `segments`), `ports` (keyed by portId), `racks`, `lagGroups`, `vlans` and VLAN/IPAM state; the floor-plan image is kept out of the JSON as a sidecar asset. The state is migrated idempotently and carries its schema version so older projects remain readable. Verification history and restorable snapshots live in `projects/history/<id>/` with retention and are removed together with the project.

The **Export → JSON** action creates a portable `infranet-project-export` envelope containing the schema version and state, while removing SNMP credentials and credentials embedded in backup pointers. Import accepts this envelope as well as legacy bare state JSON and server project envelopes.

The secret-free device projection reused by the REST API and the exports is defined in `lib/api-shape.js` (`nodeToDevice`). Field-by-field detail of each object (node / link / port / rack) lives in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## API Reference

All endpoints require an authenticated session. Write endpoints require the **admin** role.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/projects` | any | List all projects (metadata only) |
| `POST` | `/api/projects` | admin | Create a new project |
| `GET` | `/api/projects/:id` | any | Get full project (including state) |
| `PUT` | `/api/projects/:id` | admin | Update project name or state — send `If-Match` with the ETag of the version you read and a save that has been superseded is refused with **409** instead of overwriting in silence |
| `DELETE` | `/api/projects/:id` | admin | Delete a project |
| `POST` | `/api/projects/:id/copy` | admin | Duplicate a project |
| `GET` | `/api/organization` | any | The organisation (sites, WAN uplinks, inter-site links) **with its coherence audit** |
| `PUT` | `/api/organization` | admin | Replace the organisation; answers with what was written and a count of what was refused |
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

Full request/response schemas are in the machine-readable **OpenAPI 3.0** spec at `GET /api/v1/openapi.json`. A project (and the organisation) travels with an **ETag** taken from the file itself: a client sending `If-Match` gets a **409** carrying who wrote last and when, rather than a silent last-writer-wins; a client sending nothing keeps the previous behaviour, deliberately, so imports and scripts do not have to learn a protocol to stay alive. In short: `/api/poll` takes `{ driver, host, community, port, timeout }`; `/api/discover` takes a `subnet` (CIDR or `a.b.c.1-254` range) plus `driver` / `community` / `concurrency` / `timeout` and scan flags (`safeMode`, `deepScan`); `/api/discover/topology` takes one or more `seed`(s) with `maxDepth` / `maxDevices` and streams `text/event-stream` progress (`start`, `probing`, `found`, `queued`, `dup`, `skip`, `warn`, `done`).

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

`integrations/ansible/` ships a ready-made dynamic inventory (`infranet_inventory.py`, Python standard library only): every device with an IP becomes a host (`ansible_host` = its IP), grouped automatically by `type_*`, `vlan_*`, `rack_*`, `brand_*` and `backup_missing`. Each host also carries **`ansible_network_os`** (derived from the documented vendor + `sysDescr` — Cisco IOS/NX-OS/ASA, Arista, Juniper, VyOS, MikroTik, Fortinet; omitted, never guessed, for unknown vendors) and a **config-backup pointer** (`config_backup_ref`/`_method`/`_at`) — so a generated backup playbook targets the right module and destination with no hand-editing. InfraNet documents *where* the backup lives, never the config itself, and never a credential. InfraNet stays the source of truth; Ansible executes. Set `INFRANET_URL`, `INFRANET_TOKEN` and `INFRANET_PROJECT`, then:

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
| Concurrent users | No WebSocket push; each browser polls independently | A save that has been superseded is now refused instead of silently overwriting: the app says who wrote and when, and offers to overwrite. You still learn of the other session at save time, not while they work |
| Storage | File-based JSON; not suitable for >1000 projects or multi-server deployments | Migrate to a database backend for large scale |
| Physical Path | Segment editing (P1.5) supports linear chains through `port`-type pass-throughs (`wallport`, `patchpanel`, `voip`); `device`-type media converters are not yet offered as routing hops | Media-converter routing + automatic voice-VLAN tagging are archived for a later step |

---

## Roadmap

Full release notes live in [CHANGELOG.md](CHANGELOG.md). Highlights of what has shipped:

<details>
<summary><b>✅ Shipped</b> — <sub>30 milestones</sub></summary>

- [x] **The multi-site layer** — the floor above the per-site projects: an organisation with its sites (each a *reference* to its project, never a copy), their WAN lines and the links between them, as a deterministic map and a form in one panel. A link answers two questions on two fields — **transport** and **tunnel** — because an IPsec inside an MPLS is one link; both ends name the device that holds them; and *which WAN lines carry it* is the recovery question, asked of every nature. It checks itself (incoherences and gaps kept apart, every check that could not run named), it fills itself from NetBox circuits and `vpn/` services where a site came from a DCIM, and it prints a **WAN chapter** in the handover dossier with one recovery card per line and per link

- [x] **DCIM / IPAM sync (NetBox), read side** — sites, racks, devices, interfaces, patch-panel front/rear ports, PDU outlets, virtual machines on their host, IPAM prefixes/addresses/reservations and VLAN roles. Every import is a **list of decisions**, one row per choice, with what is not coming across declared rather than dropped; re-import **compares without writing** (`lib/dcim-diff.js`) and one site is one project. Imported objects keep their DCIM id in a field of their own, so a rename never looks like a delete plus an add
- [x] **Declared life-cycle status** — planned / staged / in stock / in service / failed / decommissioning / out of service, filled by the import or by hand. It changes how *silence* is read (a planned device that stays quiet is expected, not a fault) and flags the opposite too: declared out of service but answering. The measure underneath is never touched
- [x] **Outlet groups on UPSs and power strips** — two declared axes (switchable / always-on, battery-backed / filtered-only) because RFC 1628 has no groups and every vendor keeps them in a private MIB; outlets arrive from the catalogue and the group is read from the maker's own naming where present. The rack shows them as colour bands; the handover dossier prints a per-PDU recovery sheet
- [x] **A port shut on purpose vs one simply without link** — `ifAdminStatus` enters as a measure, the two off-states share a monochrome scale in rack, PDF and draw.io, and a cable drawn over a shut port gets a "Port shut" badge. A status you declared keeps your colour, and the reading expires when the switch stops confirming it
- [x] **Prefix-first IPAM** — the prefix is a first-class object (`ipam.prefixes[]`, v4 and v6, with or without a VLAN), an editable **Networks** field per VLAN, and overlap/duplicate auditing across *all* declared prefixes rather than one per VLAN
- [x] **Dashboard (summary view)** — a read-only view (like Topology; it never touches the document) in three columns — **Document / Conformance / Expansion** — each cell a number *and* a plain-word verdict declaring the **provenance** of every figure (declared / from scan / derived / not declared, a missing datum shown dashed, never a zero); an at-a-glance **health dot + verdict** per column, a severity-coloured **entry-point accent** on the most urgent tile, and a **since-last-read delta** (−N / +N, baseline in `localStorage`, never in the document). Every row **drills down in place**. Composes existing engines only — no new measurement (`lib/overview.js`, pure + tests)
- [x] **AI assistant** — advisory, bring-your-own-key, OpenAI-compatible (local Ollama by default); server-side key, allowlist context + a build-failing anti-leak guard test; scope/capability toggles; never auto-applies
- [x] **REST API v1 + Ansible dynamic inventory** — read-only, bearer-token, sanitized `/api/v1/*`; token UI; stdlib-only `infranet_inventory.py` with rich host-vars (VLAN/subnet/gateway, serial/firmware, rack, mgmt, **`ansible_network_os`**, **config-backup pointer**) and a **`backup_missing`** group
- [x] **DHCP lease import** — cross-VLAN authoritative MAC ↔ IP for the documentation check; multi-server persisted sources; treated as an identity map, never a false *absent*
- [x] **IPAM occupancy · management-VLAN role · VM import** — real per-VLAN address usage (documented / DHCP-only / free); anti-guest management VLAN; absorb a discovered floor tile as a host VM
- [x] **Reality Check / Drift Report + Adopt** — doc-vs-network diff in 7 categories (state, IP change, **hardware identity — a swapped serial/model vs ENTITY-MIB**, absent, undocumented, ghost cable, unverifiable) with per-row update/ignore/investigate and a multi-signal ping/ARP/TCP presence sweep; one-click Adopt of undocumented devices
- [x] **Handoff Dossier + Audit Trail** — one-click handover PDF; append-only project changelog with CSV export
- [x] **Visible locks for documented values** — one-click freeze on IP / hostname / port-VLAN (surfaces the existing manual-first pins)
- [x] **Wireless** — Packet-Tracer sine-wave links, up to 8 radios/device (SSID/band/channel/security/VLAN), SSID-VLAN trunk derivation
- [x] **L3-lite gateway** — network → routing-device resolution (one row per prefix, v4 and v6), VLAN → SVI binding, L3 badge, Report → L3 map with CSV
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
- [x] **IPv6 (Scope A), treated like IPv4:** address field in device Properties **with the same padlock** (`ip6Manual`); the SNMP poll reads the device's **own** address (`ipAddressTable`) so the **Sync auto-populates** it and **Verify** flags a locked divergence. Plus Neighbour Discovery (`ipNetToPhysicalTable`, routable global/ULA only) — which now also feeds **cross-subnet presence**: a device in a router's ND cache is green even if IPv6-only or ARP-aged (twin of the router-ARP path) — EUI-64 → vendor hint, privacy-IID → BYOD. IPv6 is also **declarable and audited** like IPv4: a VLAN carries both prefixes, each with its own gateway, and the L3 map checks the v6 gateway, its containment, and which device answers it — addresses compare by identity, not by text, so `2001:DB8:0:20:0:0:0:1` and `2001:db8:0:20::1` are one address. There is no capacity bar for a /64 (2^64 is not a percentage): occupancy counts the addresses actually seen. Active IPv6 sweep (`ping ff02::1`) stays parked.
- [x] **OS-family hint from ping TTL** (nmap-style, zero-cost, low-weight, embedded-appliance-suppressed; internal — not shown in the scan table)

</details>

**Planned:**
- [ ] **Per-field provenance in the schema** — every field carrying an explicit origin (declared / measured / derived), so the document can say where each value came from instead of the app inferring it per screen. **Half of it exists**: `lib/provenance.js` is the envelope and `lib/project-schema.js` classifies all 165 fields of a project — what is missing is the consumption, since today only the multi-site layer is born wrapped in it
- [ ] **DCIM write-back** — the half that writes, gated: maker-checker, dry-run, re-read after the write, and a closed list of writable fields. A deduced cable is never promoted to the DCIM unless its proof state allows it
- [ ] `ENTITY-SENSOR-MIB` (temperatures/fans/PSU) + real PoE wattage per switch
- [ ] Explicit topology states in the UI (`exact / probable / ambiguous / shared-segment / uplink-to-unknown`)
- [ ] SQLite-backed storage for discovery/IP history, FDB cache and audit log
- [ ] Internal discovery/classification hardening (richer local plugins, more real-device tests)
- [ ] Topology multi-source fusion (LLDP + FDB agreement boost; stricter unmanaged-switch detection)
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
- `npm run check` parses every JS source of the product — **525** of them. It skips the folders `eslint.config.js` already ignores (git worktrees, the private workspace, the editor's caches), so the number stays stable between runs instead of drifting with whatever happens to be checked out beside the repo
- `npm test` runs the full regression suite (currently **3,509 tests, 0 failing**) plus a real‑browser E2E suite (`RUN_E2E=1`, **120 flows**)
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
