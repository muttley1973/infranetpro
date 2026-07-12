# No invention: InfraNet computes, the AI narrates

**Status:** Accepted — introduced with the AI assistant, applies to every derived
fact.

> Cited in the AI-feature code as **`paletto #2`**. (In that same code
> `paletto #1` means *data security* — see the README's note on context-dependent
> numbering.)

## Context

The app now surfaces derived facts (Drift, IPAM gaps, hardware capabilities,
health alerts) and an optional LLM assistant that answers questions about the
documented network. An LLM will happily invent a plausible IP, VLAN, hostname, or
PoE number if asked — and a confident wrong answer about someone's network is
worse than "I don't know". The same risk applies to any derived value the UI
presents as fact.

## Decision

**"InfraNet computes, the AI narrates."** Every fact is *computed deterministically
by InfraNet* from the documented model and placed in the context; the model (or
the UI) only **renders** those facts. The system-prompt forbids inventing
names/IPs/VLANs and instructs the model to answer *"not in the documentation"*
when a fact isn't present. **A field that isn't documented is omitted** from the
context — so the honest answer surfaces naturally instead of being fabricated.

Corollary: derived numbers are produced by **pure, tested engines**
(see [pure-lib-modules.md](pure-lib-modules.md)), never by the presentation layer
and never by the model.

## Consequences

- **Good:** answers and reports are grounded and auditable; a "Show what leaves"
  preview shows the exact facts the model received.
- **Cost:** any new question the assistant should answer requires a real computed
  fact in the context first — you cannot "just ask the model". Capability grows by
  adding pure engines (`hw-capabilities`, `health-alerts`, `onboarding`, …), not
  prompt tricks.
- **Neutral:** the model may still propose *advice* and draft config — clearly
  labelled advisory/draft and separated from authoritative facts (see
  [measured-not-declared.md](measured-not-declared.md)).

## Enforcement

- **Downstream grounding check** — `lib/ai-grounding.js` (`extractEntities` +
  `checkGrounding`): compares the entities the model cited against the entities
  actually in the context, catching invented names/IPs (`paletto #2` in its
  header).
- **Facts are pre-computed, pure, tested** — `lib/hw-capabilities.js`,
  `lib/health-alerts.js`, `lib/ipam.js`, `lib/drift-report.js`,
  `lib/onboarding.js` (each `PURO (zero DOM/IO, ADR D4)` with `node --test`
  coverage). A capability field absent from `spec` is **omitted**, so the
  assistant says "not documented" (`lib/hw-capabilities.js`, CHANGELOG
  2026-06-30).
- **Prompt grounding** — `server/ai/prompt.js`: forbids invention, mandates
  "not in the documentation" (it/en, asserted in `test/ai-prompt.test.js`).
- **Draft, never executed** — `lib/ai-draft.js` segments any Ansible output into
  draft cards ("not applied · review before use"); InfraNet runs nothing.

## Cited in code as

`paletto #2`, "no invention" / "no hallucination", "InfraNet computes, the AI
narrates" / "InfraNet calcola, l'AI racconta". See `lib/ai-grounding.js`,
`server/ai/prompt.js`, `server/ai/context.js`, `lib/hw-capabilities.js`,
`lib/health-alerts.js`, `test/ai-prompt.test.js`.

## Related

- [manual-first.md](manual-first.md) — the human-input sibling of this rule.
- [pure-lib-modules.md](pure-lib-modules.md) — where the computed facts live.
- [measured-not-declared.md](measured-not-declared.md) — keeping advice/estimates
  distinct from measured facts.
- `ARCHITECTURE.md` §8 (the allowlist that also protects secrets).
