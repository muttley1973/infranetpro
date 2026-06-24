# Hardware compatibility — SNMP

How InfraNet Pro stays compatible with as much real-world hardware as possible,
and how we prove it **without owning every device**.

## Principles

1. **Lean on standard MIBs.** IF-MIB, BRIDGE/Q-BRIDGE, LLDP, ENTITY-MIB, Printer-MIB,
   HOST-RESOURCES, UPS-MIB cover the vast majority of managed devices across vendors.
   Vendor-specific MIBs are an opt-in extension, never a requirement.
2. **The RFC gives the OID, the device gives the truth.** Real agents deviate from
   the spec. Every parser is **defensive**: it guards values (signed sentinels
   `-1/-2/-3`, OID-typed values, sparse non-`1..N` indices), tolerates missing
   columns/empty tables, and **degrades gracefully** — returns `null`/partial,
   never crashes.
3. **Parse by capability presence, not by assumption.** A card appears because the
   device *exposed* the data, not because of its type label.
4. **Per-class read strategy when stacks are weak.** Fragile agents (HP JetDirect)
   truncate columns under concurrent multi-OID walks → those MIBs are read in an
   isolated, low-concurrency pass gated on device type.

## How we test compatibility (three layers)

| Layer | What it proves | Where |
|---|---|---|
| **Real hardware** | the data is parsed correctly on a physical device | manual, captured to a fixture |
| **`.snmprec` replay** | parsers stay correct on real device *snapshots* | `test/snmprec-replay.test.js` + `test/fixtures/snmprec/` *(local)* |
| **Fault injection** *(planned)* | the driver *survives* misbehaving agents (truncation/sleep/noise) | `tools/snmp-sim/` chaos mode *(local)* |

The **replay harness** loads each `.snmprec` snapshot (yours or from the public BSD
corpus) via `tools/snmprec.js` into the same varbind map net-snmp produces, runs the
pure parsers, and asserts the result against a sidecar `*.expect.json` — so every
captured device becomes a repeatable compatibility check.

> **The harness is kept local, not committed** (`tools/snmprec.js`, the replay test
> and the `test/fixtures/snmprec/` captures are git-ignored): real-device snapshots
> can contain personal data (location, contact, serials). This page documents the
> approach; set the harness up locally as below. Run it: `node --test
> test/snmprec-replay.test.js`.

## MIB coverage matrix

Legend: ✅ verified on real hardware · 🧪 covered by a replay fixture ·
🌐 coverable via the public corpus · 📐 implemented to RFC, device-verification pending.

| MIB / data | Purpose | Status | Notes |
|---|---|---|---|
| `SNMPv2-MIB` sys* | hostname, descr, location, contact, uptime | ✅🧪 | HP, Synology, Net-SNMP |
| `IF-MIB` / `ifXTable` | interfaces (name, MAC, speed, status) | ✅ | many switches (real) |
| `BRIDGE` / `Q-BRIDGE` | bridge ports, VLAN egress/untagged | ✅ | Cisco, Zyxel, Aruba (real) |
| `IEEE 802.3ad` LAG | aggregators / member ports | ✅ | 3-level detection (real) |
| `LLDP-MIB` / `CISCO-CDP` | neighbour topology | ✅ | real + sim |
| `ENTITY-MIB` | hardware inventory (vendor/model/serial/fw) | ✅ | real |
| `Printer-MIB` (RFC 3805) | toner/ink %, page count, status | ✅🧪 | HP OfficeJet (real); isolated read |
| `HOST-RESOURCES` (RFC 2790) | CPU / RAM / disk | ✅🧪 | Synology (real); pseudo-fs filtered |
| `UPS-MIB` (RFC 1628) | UPS live (runtime/battery/load) | ✅ | sim-validated; real APC pending |
| APC PowerNet (ATS) | transfer-switch source/redundancy | 📐 | OIDs wired; **real ATS pending** |
| `POWER-ETHERNET` PoE detect | PoE port detection/class | ✅ | real |

## Verified real devices

- **HP OfficeJet Pro 8715** — Printer-MIB (CMYK ink, 2939 pages, status). Captured →
  `test/fixtures/snmprec/hp-officejet-8715.snmprec`.
- **Synology DSM (NAS)** — HOST-RESOURCES (4 cores, RAM 99%, /volume1, /). Captured →
  `test/fixtures/snmprec/synology-dsm.snmprec`.
- **Net-SNMP / Linux** — system group (public BSD snapshot).
- Simulated profiles (Cisco/Juniper/Fortinet/Aruba/APC) via `tools/snmp-sim/network-sim.js`.

## Known device quirks (hard-won)

- **HP JetDirect truncates** the Printer-MIB supplies columns under the concurrent
  multi-OID walk → read in a concurrency-1 isolated pass (`cfg.printer`). The fix is
  *isolation*, not a "direct GET".
- **Printers/IoT sleep** → the first poll may time out then respond slowly; a single
  timeout must not be read as "no SNMP".
- **Signed sentinels** in Printer-MIB levels: `-1` unknown, `-2` unlimited, `-3` some
  remaining → no percentage.
- **Sparse indices**: `hrProcessorLoad` indices are not `1..N` (Synology: 196608+).
- **Storage noise**: `hrStorageTable` on Linux/NAS is full of pseudo-fs (tmpfs) and
  bind-mounts/subvolumes → filtered + de-duplicated.
- **SNMPv3 without credentials**: a v3 agent answers a report on the engineID/USM
  handshake even with an empty user → used to *detect* v3 in discovery.

## Growing the corpus

**Capture your own device** (any host you can reach):

```bash
# 1) dump the device to an snmpwalk file
snmpwalk -v2c -c public -ObentU <host> 1.3.6.1 > mydevice.snmpwalk
# 2) convert to .snmprec (snmpsim) and drop it under test/fixtures/snmprec/
#    (snmpsim-manage-records, or a thin OID|TYPE|VALUE writer)
```

Then add an optional `mydevice.expect.json` with the fields to assert
(`{ "equals": { "printer.pageCount": 1234 }, "contains": { "system.sysDescr": "…" } }`)
and `node --test test/snmprec-replay.test.js`.

**Public corpus (breadth).** The [snmpsim](https://github.com/etingof/snmpsim) /
[snmpsim-data](https://pypi.org/project/snmpsim-data-lextudio) project ships hundreds
of real-device `.snmprec` snapshots under **BSD-2-Clause**. To widen coverage, drop a
curated subset under `test/fixtures/snmprec/` and record the attribution in
`test/fixtures/snmprec/NOTICE.md` (BSD requires preserving the copyright notice).
Prefer a small, representative selection (one per vendor/MIB) over bulk-vendoring.

> The `.snmprec` format is `OID|TYPE[:variation]|VALUE` (pipe-delimited). The loader
> `tools/snmprec.js` resolves snmpsim variations (`67:numeric`, `4:writecache`, `4x`
> hex, `6` OID) to the static value shape net-snmp would return.
