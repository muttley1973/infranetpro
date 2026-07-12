# Vendor-neutral: build for every vendor, the lab only validates

**Status:** Accepted — the project's "regola cardine ③" (2026-07-03).

## Context

Development is validated against a PnetLab multivendor lab (Cisco vIOS, MikroTik,
VyOS, Arista, a vWLC, VPCS…). The lab is a convenience, not the target. Real
customer networks are arbitrarily heterogeneous. It is tempting to fix a bug by
special-casing whatever the lab shows — a specific vendor's OID, a port-naming
quirk, a hardcoded community string, a VPCS oddity. Every such shortcut is a
latent failure on the *next* vendor and quietly turns a general tool into a
lab-shaped one.

## Decision

**Build for maximum compatibility with all vendors; use the lab only to
validate.** Every fix must generalise to a **class**, never hardcode a lab
specific. In particular, never bake in:

- one vendor's OID or a single-vendor MIB assumption where a standard MIB exists,
- port-naming conventions of a specific device,
- a community string, credential, or endpoint from the lab,
- a device-type inference derived from a **vendor's identity** rather than a
  **measured behaviour** (`vendor ≠ type`).

Recognition data (vendors, OIDs) lives in **refreshable registries**, so a new
device is recognised **without a code change**.

## Consequences

- **Good:** a device from a vendor nobody tested is recognised the day its PEN/OUI
  is in the registry; behaviour degrades gracefully (empty subtree → no effect)
  instead of mis-firing.
- **Cost:** more work per fix (find the standard, find the general class) than a
  one-line vendor hack; some vendor-specific niceties are left on the table.
- **Neutral:** "does this generalise, or is it lab-shaped?" is a required question
  in review for any discovery/classification change.

## Enforcement

- **Refreshable registries, not hand tables** — `data/pen-db.json` (~66k IANA
  Private Enterprise Numbers, `npm run update-pen`) resolves SNMP
  `sysObjectID` → vendor; `data/oui-db.json` (~57k IEEE OUIs, `npm run update-oui`)
  resolves MAC → vendor. A lab Arista resolves to *Arista* from its PEN where the
  MAC path (hypervisor NIC) can't. `test/pen-db.test.js` (`paletto 3`).
- **Type by protocol, not brand** — behavioural detectors: Google Cast
  (`_castProbe`) → `tv`, RTSP → camera, OS fingerprint → `pc`/`mobile`, a
  vendor-neutral WLC signal → `wlanctrl`. The generic type-nouns
  `gateway|switch|router|firewall` are stripped from the vendor string before it
  can vote on type (`engine/fusion-scorer.js`, `server/classify.js`).
- **Signal tiering with no per-vendor edits** — an OUI plugin's device-type guess
  is weighted so **any measured signal outranks it**; the fix that established this
  touched **no `plugins/oui/*` vendor file** (that would be the per-vendor hack
  this rule forbids). Validated live on a mixed home LAN + the lab, every already
  correct device unchanged (CHANGELOG 2026-07).
- **Standard-first with graceful fallback** — access VLAN reads Q-BRIDGE
  `dot1qPvid` first, CISCO-VLAN-MEMBERSHIP `vmVlan` only as fallback; an empty
  subtree on a non-Cisco device simply has no effect (`drivers/snmp.js`).

## Cited in code as

`vendor-neutral`, `REGOLA CARDINE ③` / "regola cardine", `paletto 3`,
`vendor ≠ type`. See `engine/fusion-scorer.js`, `server/classify.js`,
`lib/device-signatures.js`, `lib/discovery-mdns.js`, `drivers/snmp.js`,
`test/pen-db.test.js`, `CHANGELOG.md`.

## Related

- [measured-not-declared.md](measured-not-declared.md) — `vendor ≠ type` is a
  special case: identity is not a measured behaviour.
- [pure-lib-modules.md](pure-lib-modules.md) — the recognition primitives are pure
  and vendor-neutral by construction.
- `ARCHITECTURE.md` §9 ("Vendor recognition — full IANA PEN + IEEE OUI").
