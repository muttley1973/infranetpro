# Manual-first: user-entered data always wins

**Status:** Accepted — foundational, in force since the earliest discovery/SNMP work.

## Context

InfraNet Pro documents a network that a human *knows* better than any probe can
infer. The whole point of the tool is a curated, trustworthy record: rack layout,
cabling, VLAN intent, device roles. Automated inputs — SNMP polls, subnet scans,
DHCP leases, LLDP/CDP crawls — are noisy, incomplete, vendor-quirky, and often
*wrong* in ways the operator can see at a glance but a heuristic cannot. If
automation could silently overwrite what a human typed, the document would decay
toward "whatever the last scan guessed", and the operator would stop trusting it.

## Decision

**A value a human entered always wins over an automated one.** Discovery and SNMP
never *silently* overwrite a manual field; at most they surface a candidate,
propose a change the operator confirms, or fill a field the human left blank.

Concretely, automation may:
- **fill a blank** (a port with no documented VLAN gets the polled one),
- **propose** a row/candidate the operator explicitly imports or selects,
- **flag a conflict** for the human to resolve (Drift / reconcile warnings).

Automation may **not**:
- replace a non-empty manual value with a polled one without consent,
- pre-select or auto-import an *observed* candidate,
- auto-create cabling from an inferred adjacency.

## Consequences

- **Good:** the document stays authoritative; operators trust it; a bad scan can't
  quietly corrupt curated data.
- **Cost:** more "propose → confirm" plumbing than a fire-and-forget importer;
  some automation is opt-in (off by default) rather than automatic.
- **Neutral:** every new automated input path must answer "what happens when it
  disagrees with a manual value?" before it ships.

## Enforcement

Where the line is actually held (not exhaustive — grep `manual-first`):

- **SNMP VLAN guard** — `_snmpVlanToUi` (`src/app-snmp.js`, `drivers/snmp.js`): a
  read of VLAN 1 (default/native, or simply not exposed by an image) never
  overwrites a hand-documented non-default VLAN. On lab images that expose neither
  `dot1qPvid` nor `vmVlan`, this guard is the only thing protecting the documented
  VLAN.
- **LAG reconcile** — `lib/lag-reconcile.js`: one member per active port, hygiene
  applied without clobbering manual bundles.
- **Port mapping is ifName-anchored, not positional** — `applyPollResult`
  (`src/app-snmp.js`): a hand-cabled port without an ifName is *preserved*, never
  clobbered; a genuine endpoint-vs-trunk conflict is *surfaced*
  (`portReconcileConflicts` → amber panel warning), not silenced.
- **Discovery candidates are observed, not imported** — DHCP-lease and ARP-SNMP
  rows arrive `alive:false` / `snmpReachable:false` and are **not** pre-selected;
  pre-selection is gated on confidence ≥ 15% (`DISC_PRESELECT_MIN_CONF`,
  `src/app-discovery.js`). A saved manual type hint / existing project device wins
  over any classifier output.
- **IP auto-renew is opt-in** — `state.autoIpRenew` defaults OFF; even when on it
  only changes IPs whose `ipManual` is falsy.
- **macsuck edge is a hint, not a cable** — a located MAC renders a badge; it does
  not auto-create a link.

## Cited in code as

`manual-first` (throughout `src/`, `server/`, `lib/`, `CHANGELOG.md`,
`ARCHITECTURE.md` §1).

## Related

- [no-invention.md](no-invention.md) — the AI/derived-facts sibling of this rule.
- [measured-not-declared.md](measured-not-declared.md) — how "observed" candidates
  are kept distinct from confirmed data.
- `ARCHITECTURE.md` §1 (principle 4), §4 (data flow).
