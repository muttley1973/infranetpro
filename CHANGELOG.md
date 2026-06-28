# Changelog

What's new in InfraNet Pro. Format loosely based on [Keep a Changelog](https://keepachangelog.com/); dates are ISO‑8601. The full historical log lives in the [Roadmap](README.md#roadmap).

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
