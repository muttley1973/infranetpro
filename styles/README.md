# styles/ — modular CSS + design tokens

The old `style.css` monolith (~1990 lines) was **split** into ordered partials,
loaded via `<link>` in `netmapper.html` **in the order below** (the order *is* the
CSS cascade: change the order and you change the rendering). Served by `server.js`
through `/styles/:file`. The split was verified **byte-identical**
(re-concatenation == the original `style.css`) and **pixel-perfect** (before/after
E2E screenshots).

## Modules (load order = cascade)

| # | file | contents |
|---|------|----------|
| 01 | `01-tokens.css` | **Design tokens** (`:root`) + the inert light-theme skeleton |
| 02 | `02-base.css` | reset, body, header, project bar, toolbar buttons, search, the Save button's «unsaved» state |
| 03 | `03-layout.css` | workspace, floor/rack divider, sidebar (library), accordions |
| 04 | `04-floor-rack.css` | floor plan, rack view, U ruler, floor nodes, ports, rack-device, stacking/HA, skins, MGMT |
| 05 | `05-cables-wifi.css` | cables (trace/wireless), Wi-Fi panel, radio ports, autolink/validation banners |
| 06 | `06-panels.css` | SNMP poll, Properties accordions, port table, port popup, shared segment, LAG |
| 07 | `07-modals.css` | zoom, generic modal, connection overlay, rack icon on the floor, discovery, auto-poll, toggles |
| 08 | `08-topology.css` | topology overlay/tooltip, toasts, legend, TRUNK/WLAN/ENDPOINT/VLAN pills, routing mode |
| 09 | `09-user-theme.css` | user menu, viewer disabling, users modal, light-theme overrides |
| 10 | `10-modern.css` | sub-header (`#modern-subbar`), breadcrumbs, status chips, reskin |
| 11 | `11-overview.css` | Overview/Dashboard: columns, key→value rows, verdicts, lenses |

**Adding CSS**: put it in the module its component belongs to. A component that is
new *and* cross-cutting → a new `NN-name.css` file + a new `<link>` at the right
place in the cascade + (nothing to do server-side, the `/styles/:file` route is
generic).

## Design tokens (`01-tokens.css` → `:root`)

Already there: **colours** (`--bg-color`, `--panel-*`, `--text-*`, `--accent`,
states `--active/fault/inactive/idle-color`), **semantic surfaces**
(`--surface-1/2/hover`, `--hairline`, `--accent-soft`, `--danger-soft`),
**shadows** (`--shadow-sm/md/lg`).

### The type scale is APPLIED, and a guard holds it (2026-08-31)

`--fs-xs…--fs-2xl` had existed all along, and for years they were used **halfway**:
761 `font-size` declarations, **45% of them off-scale**, across **53 distinct
sizes** — **31 of which were crammed between 10 and 16 px**. Thirty-one steps
inside six millimetres are not a hierarchy: the eye cannot tell them apart, and
everything in there flattens into undifferentiated «smaller text».

**97 of those declarations were re-typing a token's value by hand** (`0.82rem`
twenty-seven times, while `--fs-sm` **is** 0.82rem): the same pixel today, a
different pixel the day the token moves. They use the token now, with the
rendering unchanged (the golden confirms it).

⭐ **And the rest of the cluster had a single cause: a step was missing.** Below
`--fs-xs` (12 px) the scale had **nothing**, and **84 declarations** had invented
the same size in **seven different spellings** (`0.72rem` ×33, `11px` ×19,
`0.7rem` ×18, `0.68rem` ×10, plus the variants without the leading zero). They
were not seven measurements: they were **one** measurement nobody could call by
name. **`--fs-2xs`** was born (0.7rem ≈ 11 px) and absorbed them all — a maximum
deviation of **0.32 px**, off-scale **267 → 183**, on-scale from 64% to **76%**.

⚠️ **The guard took `0.7rem` on BY ITSELF**, the instant the token was born,
because it reads `01-tokens.css` instead of carrying a hand-written list. That is
the reason the list is not written down.

⚠️ **`em` units stay out DELIBERATELY**: `0.9em` is relative to the **parent**, not
to the root, so it is not «`--fs-md` typed by hand» and converting it would change
the design. Also out: `login.html` (it does not load the tokens) and `export.js`
(it produces a **serialised** document, where `var(--fs-*)` would find nobody to
define it and the text would fall back to the default size — there the literal is
the right choice).

The guard is `test/type-scale-ratchet.test.js`: a ceiling of **zero** on
hand-retyped token values, and a ratchet on the rest that may only **go down**.
⚠️ The forbidden literals are **derived** by reading `01-tokens.css`, not listed:
a token added tomorrow joins the guard on its own, whereas a list would stay green
and blind.

### A badge's colour does not carry its ink with it

Solid-fill badges wrote a fixed `color:#fff`, and four of the twelve backgrounds
could not carry white — the worst at **2.03:1**, and it was precisely the one that
warns you «do not trust this cable». The ink is now chosen by `badgeInk()`
(`src/app-util.js`), comparing the two contrasts, **without changing a single
colour**. ⚠️ No luminance threshold: the first version used one (0.45) and fixed
one case out of four with the guard perfectly happy. Guard: `test/badge-ink.test.js`,
which reads the backgrounds **from the tables in the source**.

Added in the 2026-08-13 session:

- **Families** `--font-ui` and `--font-mono` — **APPLIED** everywhere (31
  declarations). They did not exist before: `var(--font-mono, monospace)` and
  `var(--mono, monospace)` were written in 7 places but **defined** nowhere, and
  another 20 declared bare `monospace` → on Windows, 27 rules out of 30 rendered
  in Courier New and 3 in Consolas. No new `font-family` outside these two tokens.
  - **Addresses are not code.** IPs, CIDRs, MACs and gateways are set in
    `--font-ui` with `font-variant-numeric: tabular-nums` (the digits stay in
    column without the typewriter tone). The rule is **a single one**, in
    `02-base.css`, with the list of classes: eleven separate declarations diverged
    at the first addition.
  - Still `--font-mono`: `<code>`/`<kbd>`, logs, API tokens, raw `sysDescr`, the
    textareas where a configuration gets pasted, and the rack silkscreen (where
    monospace is what keeps it inside a 4 px-wide cell).
  - Form controls **do not inherit** the font: `input, textarea, select, button
    { font-family: inherit }` in `02-base.css`. Without it, an `<input>` outside
    `.prop-group` takes the system one (Arial).

- **Radii** `--radius-xs|sm|md|lg|xl|pill` (2/4/6/8/10/999 px) — **APPLIED**
  across the CSS (90 occurrences). Deliberate outliers (1/3/5/7/12px) stay raw
  where they are micro-adjustments (port LED, cells, badges).
- **Spacing** `--space-1…7` (2/4/6/8/12/16/24 px) — a **going-forward** scale:
  use it for NEW padding/margin/gap. The legacy is migrated incrementally (a few
  off-grid 5/10px values stay until their component is revisited).
- **Z-index** `--z-base/sticky/overlay/dropdown/modal/toast/tooltip` — a
  **semantic guidance** scale. The legacy values are ad-hoc (0…10000); NOT
  remapped wholesale (reordering the stacking is risky → it is done area by area,
  with verification).
- **Transitions** `--transition-fast|base` (.12s/.15s) — guidance for durations.

### Rule
For every **new** value, use a token. No hardcoded surface colours, radii, **text
sizes** or (from now on) spacing: that way a future light theme is done "by rules"
(one `html[data-theme=light]` block redefining only the tokens). On text sizes it
is no longer a recommendation: there is a gate, and a hand-written `0.82rem` turns
it red, pointing at the line and the token.

⚠️ It applies to CSS written **inline inside the JS** as well: that is where the
scale came apart (173 `font-size` in the templates under `src/`, only 11 of which
went through a token). The gate looks at `netmapper.html` + `styles/*.css` +
`src/*.js` — everything that loads `01-tokens.css`.

## Verifying after changes
Observable CSS changes must be verified in a real browser:
`RUN_E2E=1 npm run e2e` (boot fails on a CSS 404) + a screenshot comparison if it
is a rendering-invariant refactor.
