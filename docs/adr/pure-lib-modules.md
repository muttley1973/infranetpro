# Pure `lib/` modules (decision logic in, DOM out)

**Status:** Accepted. Cited in code as **`ADR D4`**.

## Context

The app is vanilla JS with no framework and a deliberately minimal build. Business
logic that lives tangled with the DOM is untestable without a browser, tends to
get duplicated (two render paths, a client and a server classifier), and drifts
apart silently. The tool needs its *decisions* — cabling rules, IPAM math, drift
diffs, classification, capability computation — to be fast to test and impossible
to accidentally fork.

## Decision

**Every non-trivial piece of decision logic is a pure, UMD-lite module in `lib/`:
data in → data out, zero DOM, zero I/O, zero global state.** It runs unchanged in
Node (for `node --test`) and in the browser (exposed as a global via
`Object.assign`). The **glue** in `src/app-*.js` (ESM, bundled by esbuild) calls
the pure function and turns its result into HTML/DOM.

Rule of thumb when adding a feature: put the *decision* in a pure `lib/` module
with tests; keep the glue thin. Logic is unit-tested in `lib/`; presentation is
not.

## Consequences

- **Good:** ~1370 fast, zero-dependency tests; logic reusable across browser +
  Node + server; a single source of truth for each decision.
- **Good:** the pure `lib/*.js` intentionally stay classic `<script>`s (imported
  as CJS by esbuild for Node tests) — re-bundling them as ESM would clobber the
  live `<script>` copy. This is *why* a handful of globals persist behind the
  `window` bridge (see `ARCHITECTURE.md` §10 / ADR D18).
- **Cost:** a bit of ceremony (the UMD-lite wrapper; registering the `<script>` in
  `netmapper.html` before the bundle, and in `tsconfig.json`).
- **Trap — "pure" is worthless if the logic is copied.** When the same decision is
  implemented in two places instead of one shared pure module, the two drift.
  Seen repeatedly: the twin floor renderers (`_renderAllNow` ↔ `_renderFloorNow`,
  since unified into `_buildFloorNodeEl`), the client vs. server classifier (`B3`,
  since made to defer to the server), the `lib/ui-catalog` onclick↔data-act
  reader. **If logic must exist once, it must exist in one pure place** — that is
  the whole point of this ADR.

## Enforcement

- **The pattern** — `ARCHITECTURE.md` §3 shows the UMD-lite wrapper verbatim.
- **The tests** — `test/*.test.js` under `node --test`: `test/ipam.test.js`,
  `test/drift-report.test.js`, `test/hw-capabilities.test.js`,
  `test/link-model.test.js`, `test/correlate.test.js`, … one per pure engine.
- **Headers** — pure modules carry `PURO (zero DOM/IO, ADR D4)` (e.g.
  `lib/ai-draft.js`, `lib/ai-grounding.js`, `lib/health-alerts.js`,
  `lib/link-model.js`, `lib/onboarding.js`, `lib/ui-catalog.js`,
  `lib/api-shape.js`).

## Cited in code as

`ADR D4`, "PURO (zero DOM/IO, ADR D4)", "Zero DOM, zero stato: solo funzioni pure".

## Related

- [no-invention.md](no-invention.md) — the computed facts the AI narrates are
  produced by these pure engines.
- `ARCHITECTURE.md` §3 (pure lib + glue), §10 & `test/bridge-ratchet.test.js`
  (ADR D18, why some globals persist), §7 (testing).
