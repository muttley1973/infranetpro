# Changelog

What's new in InfraNet Pro. Format loosely based on [Keep a Changelog](https://keepachangelog.com/); dates are ISO‑8601. The full historical log lives in the [Roadmap](README.md#roadmap).

## 2026-06-29 — AI assistant (advisory)

### Added
- **AI assistant (advisory, in‑app)** — a third **«Assistant»** tab in the right panel (keyboard shortcut **A**, plus a toolbar entry) that answers questions about *your documented network* in plain language: presence, VLANs, free IPs, **ports** (status / VLAN / what's connected), **SNMP health** (CPU/RAM/toner/UPS) and **topology**. **Bring‑your‑own‑key, provider‑agnostic**: a single **OpenAI‑compatible** endpoint → **local (Ollama) by default** for privacy, or any cloud model (OpenAI, Anthropic's OpenAI‑compatible endpoint, …). Configured under **Users and access → AI assistant** (enable, endpoint, model, write‑only key). Advisory and manual‑first: it proposes, you confirm; Ansible output is a marked **draft**, never executed.
  - **Data security (paletto #1)** — the key lives **only on the server** (`data/ai-config.json`, git‑ignored; or env `INFRANET_AI_KEY`) and never returns to the browser. The context is built from the **same allowlist** as the REST API (`lib/api-shape.js`) — the SNMP community and credentials are *physically not in the list* — plus a defense‑in‑depth secret‑name denylist on the SNMP‑health passthrough. A **«Show what leaves»** button previews the exact sanitized JSON before anything is sent, and a build‑failing **guard test** asserts no secret can reach the AI context.
  - **No hallucination (paletto #2)** — «InfraNet computes, the AI narrates»: facts (drift, free IPs, gaps) are pre‑computed and put in the context; the system‑prompt forbids inventing names/IPs/VLANs and instructs the model to answer *"not in the documentation"* when it doesn't know.
  - **Scope & capability toggles** — choose **what leaves** the machine (Inventory · Ports · SNMP health · Topology · Drift) for privacy/cost, and **what the assistant may do** (Q&A · Diagnostics · Find gaps · Suggestions · Ansible draft). All on by default. Zero new runtime dependency (HTTPS via `node:https`); no model bundled.
  - **Chat controls** — a **settings gear** in the chat header (admin) reopens the scope/capability configuration even once the assistant is enabled (previously reachable only from the not‑yet‑configured empty state); a **red trash button** clears the current conversation (session‑only, never persisted); and **saving the configuration refreshes the panel instantly** (enable → chat, endpoint → 🔒 Local / ☁ Cloud chip) without switching tabs.

## 2026-06-29

### Added
- **Visible lock for documented values** — a clickable lock (🔒) next to **IP**, **hostname** and a **port's VLAN** in the Properties panel. It is **not a new mechanism**: it surfaces the manual‑first protection that already existed. Locked = the value is your decision (the Sync leaves it untouched and *Verify documentation* flags any divergence from the network); unlocked = the field follows the network again. Reuses the existing `ipManual` / `hostnameManual` / `vlanOvr` pins — no engine change.
- **Richer Ansible inventory host‑vars** — every host in the dynamic inventory (`/api/v1/projects/:id/ansible-inventory`) now carries its **network context** (`vlan_name`, `subnet`, `gateway`, `dns`, derived from the device's VLAN), **asset data** (`serial`, `firmware`, `hostname`), **physical placement** (`rack_id`, `rack_unit`) and **management** info (`wireless`, `mgmt_protocol`, `mgmt_url`). Two new facet groups — `wireless` and `snmp_managed` — let you target APs or SNMP‑managed gear directly. Still allowlist‑only and secret‑free: the SNMP community never leaks, and `mgmt_url` is stripped of any `user:pass@` credentials before it is exposed.

### Fixed
- DHCP lease reconciliation now matches devices even when a pasted/imported lease table uses a non‑normalized MAC format (lowercase or dash‑separated) — the lease MAC is normalized in the lookup, so a "messy" export no longer produces false *undocumented* rows.

## 2026-06-28

### Added
- **IPAM occupancy per VLAN** — the VLAN's IPAM card now shows **real address usage**: capacity for the declared subnet, a usage bar (amber near full) and a breakdown of **documented vs DHCP‑only vs free** addresses. Occupancy combines documented IPs with active DHCP leases ("reality on the wire"). Pure, tested engine (`lib/ipam.js`).
- **Adopt from leases** — a per‑VLAN "**N undocumented → Adopt**" shortcut on the IPAM card maps DHCP‑only leases straight into the Adopt picker (MAC + IP + hostname), so the adopted device is born documented — no full Reality Check required.
- **"Management VLAN" role** — mark a VLAN as management (anti‑guest). An unknown device on a management VLAN is treated as **infrastructure** (never collapsed as BYOD) and flagged with a red **"On management VLAN"** security badge (possible intruder); Adopt proposes it as infra.
- **Import a discovered device as a host VM** — drag a floor tile (e.g. a VM that showed up as a loose PC) onto a host's **"Import VM"** drop‑zone in its Properties to absorb it into `node.vms[]`, inheriting name/IP/MAC. Its MAC joins the Drift known set, so it stops being reported as undocumented. The import fires **only** when the tile is released inside the drop‑zone; dropping anywhere else just repositions it (or snaps it back if released on a panel). Undoable with Ctrl+Z.
- **DHCP lease import (cross‑VLAN reality)** — paste or load a DHCP lease table (auto‑detects ISC dhcpd / dnsmasq / Kea CSV / generic CSV; covers pfSense / OPNsense / MikroTik / Synology / Windows exports) to feed the documentation check with authoritative MAC ↔ IP across **all VLANs** — the piece local ARP can't see behind an L3 firewall. Multiple servers accumulate as persisted sources (merged by MAC, freshest lease wins). A lease table is treated as an **identity map, not a liveness probe** (a documented device missing from leases is *unverifiable*, never wrongly *absent*; expired leases ignored; manually‑pinned IPs are never silently overwritten). Pure parser (`lib/dhcp-lease.js`); the file/paste path is built‑in, live vendor pull is a separate optional driver pack.
- **Endpoint / BYOD transparency** — undocumented entries that look like user devices (guest VLAN, crowded uplink port, or randomized "private" MAC) are collapsed into a *user/BYOD* group so the actionable infrastructure stays clean; each hidden row explains **why** in plain language (technical signal in the tooltip), with a toggle to reveal them inline.

### Changed
- **Uniform floor ↔ rack interaction** — floor devices now behave like rack devices: **single click selects**, **double click opens Properties**. (Previously a single click on a floor device opened its Properties.)

### Fixed
- Double‑click on a floor device now reliably opens its Properties — the native `dblclick` never fires on floor nodes because the floor re‑renders between the two clicks, so it's now detected manually by timestamp (same scheme already used for rack devices and ports).
- VM import no longer triggers by accident: the decision is taken from the **actual release point**, not from the last drag‑move, so a fast drag that passes over the drop‑zone but is released elsewhere no longer absorbs the device.

## 2026-06-27 — REST API v1

### Added
- **Read‑only REST API (`/api/v1/*`)** for external consumers (Ansible, dashboards, wikis, automation) — bearer‑token auth (no browser session), **sanitized** output only (never SNMP communities). Endpoints for projects, full inventory, device list, **Ansible dynamic inventory** and an OpenAPI 3.0 description. Token management UI under **Users and access → API tokens** (shown once).
- **Ansible dynamic inventory** (`integrations/ansible/`, Python stdlib only): every device with an IP becomes a host grouped by `type_*`, `vlan_*`, `rack_*`, `brand_*`. InfraNet stays the source of truth; Ansible executes.

## 2026-06-25 — Docker

### Added
- **One‑command Docker setup** (`Dockerfile` + `docker-compose.yml`): builds the frontend bundle internally and keeps data in a named volume. Default **host networking** gives complete discovery (ARP MAC → vendor, SNMP, LLDP/CDP) like a bare‑metal install; an isolated **bridge** variant is provided for reverse‑proxy / Docker‑Desktop setups.
