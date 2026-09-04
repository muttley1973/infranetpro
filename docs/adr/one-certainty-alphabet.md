# One certainty alphabet — unify the words, never the engines

**Status:** Accepted (2026-09-04, shipped in 2.11.3).

## Context

[measured-not-declared](measured-not-declared.md) settled *that* a value must be
labelled with how it is known. It did not settle **in whose words**, and the answer
grew one screen at a time: by 2.11.2 seven independent vocabularies were answering
the same reader question — *how much do I trust this?*

| Vocabulary | Where | Words |
|---|---|---|
| `proof` | cable badges | `derived-strong`, `declared`, `derived-weak`, `declared-review`, `declared-shut`, `ghost` |
| `linkstate` | cable badges | `discovered`, `manual`, `ambiguous`, `lag` |
| `temporal-confidence` | L2 segment | `stable`, `established`, `recurring`, `fresh`, `stale`, `undated` |
| `prov` | Overview dots | `declared`, `measured`, `derived`, `none` |
| `disc.conf` | Discovery rows | `high`, `mid`, `low` (a 0–100 score) |
| presence classes | floor plan, racks | *no words at all* — a red halo, a greyed tile, a grey ring |
| `status` | everywhere | the seven lifecycle states |

None of these were synonyms of each other, which is how the worst case became
measurable: a cable's Status row could mount **five** badges, three of them
answering that one question in three incompatible notations — a link-state word, a
proof word, and a percentage that contradicted both. `lib/linkstate.js` states in
its own comments that an 8/8 score "remains an INFERENCE", and printed the number
anyway.

The obvious cure — one engine — is the wrong one, and `lib/provenance.js` already
says why: the engines keep **legitimately different half-lives**. A declaration does
not age; a measurement does, at a rate that depends on what was measured, which is
why `proof.js` (6h/7d/30d) and `temporal-confidence.js` (30d/60d) disagree on
purpose. Merging them would trade a reading problem for a modelling lie.

## Decision

**Unify the alphabet, not the model.** `lib/certainty.js` is a pure map from every
engine's *real* keys onto **six signs** — `measured`, `declared`, `derived`,
`contradicted`, `undeclared`, `unread` — ordered from the most load-bearing to the
least. Every engine keeps computing exactly what it computed; what is shared is the
word the reader sees, and it means the same thing on every surface.

Four consequences are part of the decision, not details of it:

1. **The two absences are separate signs, drawn identically.** `undeclared` is the
   absence of a *declaration*, `unread` the absence of a *reading*. They are
   symmetric to the two positive origins and they ask different people to act — one
   asks you to write something, the other asks a probe to go and look. But the mark
   is the same empty ring for both: the word carries the meaning, the colour only
   confirms it.
2. **A key that is not a certainty is declared as such**, in `NOT_A_CERTAINTY`,
   never left unmapped — silence cannot distinguish "different axis" from
   "forgotten". `linkstate`'s `lag` says what a link *is* (the TRUNK/ACCESS axis);
   Discovery's high/mid/low say how *strong* a guess is.
3. **A score is not an origin.** Discovery's confidence is an additive vote over
   heterogeneous signals and reaches "high" (≥70) with no SNMP and no LLDP at all —
   NetBIOS 14 + SMB 20 + services 18 + hostname 12 + MAC 12 + ping 10 = 86. The
   grade therefore comes from the *signals* (`certaintyForDiscovery`): `measured`
   only when something authoritative spoke. Winning the score means "I guessed with
   more confidence", not "the device confirmed it".
4. **The grade carries no colour.** `.cty-<grade>` defines one ink in the
   stylesheet; tint, border and dot are derived from it with `color-mix`. A grade's
   colour exists in exactly one place, and it is a token. A surface may restyle the
   pill's *density* — the Overview's cable list does, to sit beside `.ov-tag` — but
   never its colour: an override there would win on specificity, silently.

**Conversion is counted on callers, not on memory.** The first pass converted "the
five surfaces", and the Overview's cable list survived for a day showing the old
words for the very same engine — one cable, two alphabets, two screens, inside the
cure for exactly that. It was found writing the manual, not reading the code. A
`grep` for the old function's callers would have said so in a second, and that is
the check: a surface is converted when nothing calls the old renderer, not when it
feels done.

## Consequences

- **Good:** the notation is learnt once and read everywhere; a surface that had no
  words (floor plan, racks) inherits some; three hand-written colour tables and a
  fifth amber disappear with the duplication that produced them.
- **Cost:** mapping `temporal-confidence` onto six grades is lossy — freshness is
  not origin — so the conversion is **declared in the file** rather than hidden, and
  anything needing the exact tier keeps reading the engine.
- **Neutral:** an engine gaining a state now has a second obligation (map it), which
  is enforced rather than remembered.

## Enforcement

- **`test/certainty.test.js` derives, it does not enumerate.** It extracts each
  engine's key set from that engine's own source — `lib/linkstate.js`,
  `lib/temporal-confidence.js`, `lib/proof.js`, `src/app-discovery.js`,
  `lib/overview.js`, `lib/presence.js` — so a new unmapped state turns it red
  instead of slipping through as an unlabelled badge. The map necessarily
  enumerates, so the proof must not. The guard was proven to bite by removing a
  mapping and watching it fail. The same file greps `lib/certainty.js` for hex
  literals: a grade that decided its own colour would leave the token system
  silently.
  - ⚠️ That list is itself a lesson. The `proof` derivation originally read a
    *colour table* in `src/app.js`; when that table was retired the guard went red
    saying "anchor not found" — refusing to go blind, which is what it is for. The
    fix was not to restore the anchor but to move it to the **engine**, the only
    place a state cannot disappear from without ceasing to exist.
- **`test/badge-ink.test.js`** forbids either cable surface — the property panel and
  the Overview's cable list — from painting its certainty badges by hand again, and
  forbids the retired vocabulary from returning anywhere: a separate case walks all
  of `src/` plus `lib/i18n.js` looking for `_CABLE_PROOF_BADGE`,
  `_cableProofBadgeHtml` or a `proof.badge.*` key outside a comment. Two per-surface
  cases enumerate their files (a third surface must be added by hand); the
  vocabulary case does not, so a new file cannot slip past it.
- **`test/overview.test.js`** holds the provenance vocabulary as a *closed* list, so
  a seventh word cannot appear without a decision.
- **`test/golden-render.test.js`** carries a `scope:provenienza` scenario, because
  the golden's own devices have empty inventory fields and had gone blind to the
  marks.

## Cited in code as

`NOTAZIONE UNICA DELLA CERTEZZA` (the header of `lib/certainty.js`), the `cty.*`
i18n namespace, `certaintyOf` / `certaintyForCable` / `certaintyForField` /
`certaintyForDiscovery` / `certaintyForPresence`, `NOT_A_CERTAINTY`, and the
`.cty-<grade>` CSS classes.

## Related

- [measured-not-declared.md](measured-not-declared.md) — *that* a soft fact must be
  labelled; this record fixes *the words it is labelled with*.
- [no-invention.md](no-invention.md) — an unmapped state given a grade by guesswork
  would be an invention.
- `ARCHITECTURE.md` §2 (`lib/certainty.js`), §4 "One question, one alphabet".
