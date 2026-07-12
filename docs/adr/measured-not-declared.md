# Measured, not declared

**Status:** Accepted — the project's "regola cardine ④" (`misurato≠dichiarato`).

## Context

The tool mixes three kinds of value: things a human **declared** (documented
intent), things InfraNet **measured** (a live SNMP read, a ping reply, an FDB
entry), and things InfraNet **derived** (a worst-case envelope, a per-model
suggestion). Presenting a derived or unverified value with the same authority as a
measured one is a subtle lie: it makes the document look more certain than it is,
and the operator makes decisions on false confidence. This is the same honesty
instinct as [manual-first](manual-first.md) and [no-invention](no-invention.md),
applied to *how a value is labelled*.

## Decision

**A value InfraNet reports as fact must be measured — and where it is derived,
estimated, or unverified, it is labelled as such and kept visually and structurally
distinct from measured data.** Never let a theoretical maximum, a typical-spec, or
an "observed but unconfirmed" value pass as a meter reading.

## Consequences

- **Good:** the operator can tell "the switch measured 47 W" from "the worst-case
  envelope is 120 W" from "seen in a neighbour's ARP cache, unconfirmed". Trust is
  calibrated, not blanket.
- **Cost:** more UI/label nuance; reports carry qualifiers instead of clean single
  numbers; the verify path must track *why* something couldn't be confirmed.
- **Neutral:** every derived number needs an honest label before it ships.

## Enforcement

- **PoE headroom is a labelled envelope** — `lib/hw-capabilities.js` computes a
  worst-case PoE budget as Σ of each active port's class nominal
  (802.3af/at/bt), "clearly a theoretical max, not a meter reading" (CHANGELOG
  2026-06-30), named so in the field semantics — not presented as measured draw.
- **Verify never over-claims** — `driftBannerKind()` (`lib/drift-report.js`): if
  the Reality Check observed nothing (subnets unreachable from this host), the
  banner does **not** show green "aligned"; it shows amber "can't verify from this
  machine, N devices on networks not reached", and a partial pass carries a
  "(N not verifiable)" note.
- **Observed ≠ confirmed in discovery** — ARP-SNMP and DHCP-lease candidates are
  presented as *observed, low-confidence, not pre-selected*
  (`snmpReachable:false, alive:false`), greyed (`.disc-lowconf`), with a source
  badge ("ARP via <switch>"); they cross into "confirmed" only with corroboration
  (e.g. seen in ARP *and* DHCP) or operator import.
- **Per-model advice is labelled typical** — the AI may use a device's
  brand/model/firmware to suggest config, but it is rendered as a **draft**
  labelled *"typical for &lt;brand/model&gt;, verify on the official
  datasheet/CLI"* and kept distinct from InfraNet's authoritative `capabilities`,
  which always win (`server/ai/prompt.js`, CHANGELOG 2026-06-30).
- **Cross-subnet scope is stated, not faked** — mDNS is link-local (TTL 1); the
  sweep says it only sees the local subnet rather than implying full coverage
  (`lib/discovery-mdns.js`, CHANGELOG).

## Cited in code as

`misurato≠dichiarato` / "measured ≠ declared", "observed" (discovery rows),
"theoretical max, not a meter reading", "typical for … verify". See
`lib/hw-capabilities.js`, `lib/drift-report.js`, `src/app-discovery.js`,
`server/ai/prompt.js`.

## Related

- [no-invention.md](no-invention.md) — don't fabricate a fact; this rule adds:
  don't mis-label a soft fact as a hard one.
- [manual-first.md](manual-first.md) — observed candidates stay proposals.
- `ARCHITECTURE.md` §8 (report honesty), §9 (discovery confidence bands).
