# Architecture Decision Records

This directory is the **committed home for the "why"** behind InfraNet Pro's
non-obvious decisions. `ARCHITECTURE.md` (repo root) describes *how the app is
built*; these records explain *why the rules that govern it exist*, so a second
developer can change the code without re-deriving — or accidentally breaking — a
deliberate choice.

Read `ARCHITECTURE.md` first, then this directory.

---

## Why this exists

The source code cites these decisions by short tag in comments and tests, e.g.:

```js
//  PURO (zero DOM/IO, ADR D4).                    // lib/ai-draft.js:5
// A field that isn't documented is omitted … (paletto #2)   // CHANGELOG / prompt.js
// (D6). È egress verso un host scelto dall'admin …          // dhcp-drivers/index.js:15
```

Until now those tags resolved to notes the maintainer kept **outside the repo**
(the private handbook). A contributor reading `// ADR D4` had nowhere to look it
up. This directory closes that gap: **every decision tag cited in committed code
resolves here** (or to a named `ARCHITECTURE.md` section, via the table below).

## The two citation schemes (both live)

The tags grew organically and there are **two overlapping families**. We do
**not** renumber the code — that would touch dozens of golden-adjacent files and
create drift. Instead every tag string is made resolvable as-is.

- **Data-integrity principles** — the product rules that make the tool
  trustworthy ("we refuse to lie about the network"). Cited in code as
  `manual-first`, `paletto #2`, `vendor-neutral` / `REGOLA CARDINE ③`,
  `misurato≠dichiarato`, and (for the AI/REST surfaces) `paletto #1` /
  `paletto sicurezza`. **⚠️ The number is context-dependent** — in the AI-feature
  code `paletto #1` means *data security* and `#2` means *no-invention*, whereas
  the project-wide "regole cardine" number them ① manual-first ② no-invention
  ③ vendor-neutral ④ measured-not-declared. Match on the **name**, not the number.
- **Technical decisions (`ADR Dn`)** — the maintainer's engineering-decision log
  (`D3` zero-dep, `D4` pure-lib, `D6` localhost-bound egress, `D18` store proxy…).
  Only the records actually referenced from committed code are reproduced here or
  mapped to `ARCHITECTURE.md`; the full historical log (`D0…`) is maintainer-held.
  We reproduce a record when the code points at it — not before.

## Records in this directory

| Record | Principle | Cited in code as |
|---|---|---|
| [manual-first.md](manual-first.md) | User-entered data always wins | `manual-first` |
| [no-invention.md](no-invention.md) | InfraNet computes, the AI narrates | `paletto #2`, "no invention" |
| [vendor-neutral.md](vendor-neutral.md) | Build for every vendor; the lab only validates | `vendor-neutral`, `REGOLA CARDINE ③`, `paletto 3`, `vendor ≠ type` |
| [measured-not-declared.md](measured-not-declared.md) | A reported fact is measured, or labelled as not | `misurato≠dichiarato`, "observed", "theoretical max, not a meter reading" |
| [pure-lib-modules.md](pure-lib-modules.md) | Decision logic in pure, tested `lib/` modules | `ADR D4` |

## Decisions documented in `ARCHITECTURE.md` (no separate file)

These are cited in code but already have authoritative prose in `ARCHITECTURE.md`;
the tag resolves there rather than duplicating it.

| Tag | Meaning | Where documented |
|---|---|---|
| `ADR D3`, "zero-dep", "no new runtime dependency" | Zero esoteric dependencies; HTTP via `node:https`, tests via `node --test` only | `ARCHITECTURE.md` §1.2, §9 |
| `(D6)`, "admin-gated egress" | Server binds `127.0.0.1`; live egress (SNMP poll, DHCP driver) only to an admin-chosen host | `ARCHITECTURE.md` §8 |
| `paletto #1` (AI), `paletto sicurezza` | Allowlist-only data surfaces; the AI/SNMP key stays server-side and never leaks (build-failing guard test) | `ARCHITECTURE.md` §8 |
| `ADR D18`, `decisione D18` | The `window`-bridge strangler: shared mutable state behind `src/store.js`, retired under a monotonic ratchet | `ARCHITECTURE.md` §10; `test/bridge-ratchet.test.js` |

---

## Format

Records are lightweight ([MADR](https://adr.github.io/madr/)-ish): **Status ·
Context · Decision · Consequences · Enforcement · Cited in code as · Related.**
The *Enforcement* section names the tests and code that keep the decision true —
that is what makes an ADR actionable rather than decorative.

## Adding a record

1. Copy the shape of an existing file; name it by a descriptive slug (no leading
   ordinal — it avoids the numbering tangle above).
2. Fill *Enforcement* with the real test/guard that holds the line. If there's
   none, that is a finding, not a formality.
3. Put the exact grep string a reader would meet in the code under *Cited in code
   as*, and add a row to the table above.
4. If the code cites a tag, add the tag string here too — even if the record is
   short — so no citation dangles.

> Language: English, to match the other committed docs (`ARCHITECTURE.md`,
> `CONTRIBUTING.md`, `README.md`) and external contributors. The *Cited in code
> as* strings are kept verbatim (Italian, e.g. `paletto #2`) so `grep` still finds
> them.
