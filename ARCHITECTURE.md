# InfraNet Pro — Architecture

> The mental model, not a line-by-line reference. Read this first; then the code
> reads itself. For the full feature manual, see the PDF in this repo
> (`MANUALE_TECNICO_IT.pdf` / `TECHNICAL_MANUAL_EN.pdf`).

InfraNet Pro is a **self-hosted L1/L2 network documentation tool** — racks,
cabling, ports, VLANs, MAC/FDB, LLDP/CDP topology, SNMP discovery — with a
visual, commercial-grade UI. Vanilla JS frontend, Node/Express backend, JSON
file storage. **Minimal tooling** (a lightweight esbuild bundle for the frontend,
introduced by the in-progress ESM migration — see §10), **no framework.**

---

## 1. Non-negotiable principles

These are deliberate. Don't "fix" them without understanding why:

1. **Minimal build.** Pure `lib/*.js` stay plain UMD-lite (no transpile, Node
   tests import them as-is). The glue layer is being migrated to ES modules bundled
   by **esbuild** (`npm run build` → `dist/app.bundle.js`) to kill the implicit
   global coupling + `typeof` guards. **The JS strangler is complete:** all
   `lib/app-*.js` glue **and** the nucleus (`src/app.js`) are now ESM in the bundle.
   The only remaining classic `<script>`s are the pure `lib/*.js` and `export.js`
   (by design — golden lib-script rule). See §10.
2. **Zero esoteric dependencies.** Backend uses only Express, bcryptjs,
   express-session/rate-limit, net-snmp, pdfkit. Tests use **`node --test`
   only** — zero test dependencies. This is a point of pride and a selling point.
3. **`lib/` pure + glue.** Reusable logic lives in pure, testable modules in
   `lib/`. The glue (now ESM modules in `src/app-*.js`, bundled by esbuild) wires
   that logic to the DOM. (See §3.)
4. **Manual-first.** User-entered data always wins; SNMP/discovery never silently
   overwrites a manual value.
5. **Localhost-bound.** The server binds `127.0.0.1` only. It is a LAN tool that
   runs *inside* the network it documents, not a public service.

---

## 2. File map

```text
server.js              Express bootstrap: static files, auth, routers, listen (127.0.0.1)
auth.js                Sessions, bcrypt login, roles (admin/viewer), user CRUD
server/                Backend (CommonJS): projects-store, netscan, classify,
                       pdf-report, label-sheet, routes/{projects,discovery,export}
drivers/snmp.js        SNMP v1/v2c/v3 driver
engine/                sysObjectID + OUI classification engines (plugin loaders)
plugins/               Seed vendor catalogs (zero database)

lib/                   Shared browser + test modules (the heart of the app)
  i18n.js              t(key,vars), it/en dictionaries, glossary  (pure)
  cidr.js netnames.js linkstate.js correlate.js cabling.js
  topo-lines.js frontpanel.js stack.js ha-pair.js l3-gateway.js
  power-mib.js wifi-spec.js cable-labels.js drift-report.js
  radio.js          radio interfaces: pid/anchor/linkKind/seeds       (pure)
  vlan-trunk.js     carriedVlans + effLinkVlans (trunk derivato)       (pure)  …
                       (PURE only — the ex-`lib/app-*.js` GLUE now lives in src/)
src/app.js             Core glue/nucleus: state, escapeHTML, init(), renderAll dispatch
                       (now ESM in the bundle, imported 2nd in src/main.js after app-types)
netmapper.html         The app shell + the <script> load order (authoritative)
styles/                Modular CSS (9 ordered partials + design tokens) — ex style.css; see styles/README.md
build.js               esbuild build of the frontend ESM bundle (dist/app.bundle.js)
src/                   GLUE migrated to ESM (bundled): _bridge, main, app-types (TYPES,
                       imported first), + all ex-`lib/app-*.js`
src/_bridge.js         Migration bridge: win.* read, expose() publish (sparirà a fine migrazione)
test/                  node --test: pure-lib tests + smoke-app (vm + DOM stub)
```

---

## 3. The key pattern: pure lib + glue

Every non-trivial piece of logic is a **pure UMD-lite module** in `lib/`: it works
in Node (for tests) and in the browser (exposed as a global via `Object.assign`).

```js
// lib/example.js — PURE: no DOM, no globals, just data in → data out
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node
  if (typeof window !== 'undefined') Object.assign(window, api);             // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function buildSomething(model) { /* pure */ return result; }
  return { buildSomething };
});
```

The **glue** (`src/app-*.js`, ESM) calls `buildSomething(...)` and turns the result into
HTML/DOM. **Logic is unit-tested in `lib/`; presentation is not.** When adding a
feature: put the *decision* logic in a pure lib with tests, keep the glue thin.

The glue is now **ESM** (`src/`, bundled by esbuild) with explicit `import`/`export`
where ritirato, plus the transitional `window` bridge (`src/_bridge.js`) for what's
not yet retired. Only the remaining classic `<script>`s — the pure `lib/*.js` and
`export.js` — still share one global lexical scope. Beware of name collisions — see
Gotchas.

---

## 4. Data flow

A project is a single `state` object (see `_buildDefaultState()` in `src/app.js`):

```text
state = { racks[], currentRack, nodes[], links[], ports{}, vlanColors{},
          vlanNames{}, ipam{vlans{}}, lagGroups{}, guestVlans[], … }
```

- **node**: `{ id, type, name, rackU, sizeU, ports, rackId, ip, … }`
- **link**: `{ id, src:'nodeId-portN', dst:'nodeId-portN', … }`
- **port**: `state.ports['nodeId-N'] = { status, speed, vlan, … }`

Mutation → render → persist:
`updateN(...)/setLinkProp(...)` mutate `state` → call `renderAll()` (or a scoped
`renderScope('props'|'cables'|'floor'|...)`) → `markDirty()` → `saveProject()`
serializes `state` to JSON via `PUT /api/<projectId>`.

`renderAll()` (rAF-coalesced) rebuilds the rack chassis, floor, cables overlay and
the right panel. `renderProps()` dispatches by selection (`selType`/`selId`) to
`_renderNodeProps` / `_renderLinkProps` / `_renderPortProps` / `_renderFloorProps`.

---

## 5. Recipe: add a new device type

1. `src/app-types.js` — add an entry to `TYPES` (`name`, `icon`, `isRack`/`isFloor`,
   `ports`, flags).
2. `src/app-properties.js` (or the relevant `src/app-properties-*.js`) — add the
   device-specific `<details>` block inside the props renderer (the per-type `if` chain).
3. `netmapper.html` — add the palette `<div class="equip-item" data-type="...">`.
4. i18n — add the label keys (`dev.<type>`, plus any `f.*` field keys) to both
   `it` and `en` in `lib/i18n.js`; tag palette/header with `t(...)`/`data-i18n`.
5. Run `npm run check` + `npm run lint` + `npm test`; verify in the browser.

---

## 6. Rendering & overlays

Report overlays (Drift, Free ports, L3 map) follow one pattern: a `*EnsureOverlay()`
creates the modal **once**, a render function fills it on each open. Because the
shell is created once, **the title is given an `id` and refreshed on every render**
so language changes apply when reopened.

**Golden rule for i18n / dynamic text:** elements that JS rewrites via
`innerHTML` / `textContent` / `.title` **ignore `data-i18n`** — translate them with
`t()` at the JS source, or the translation gets overwritten. See the PDF manual (i18n chapter).

---

## 7. Testing

- **Pure-lib tests** (`test/*.test.js`, `node --test`): the safety net for all
  logic. Fast, zero-dep. ~780 tests.
- **Golden-master render** (`test/golden-render.test.js`): snapshots the rendered
  `innerHTML` of every device's Properties panel + the 4 scopes + the generated
  rack render vs `test/golden/render-golden.json`, to catch unintended UI changes.
  **Active by default** as a gate (UI considered stable after the June 2026
  redesign): skip with `SKIP_GOLDEN=1`, refresh the baseline after a deliberate UI
  change with `UPDATE_GOLDEN=1 node --test test/golden-render.test.js`.
- **Smoke E2E** (`test/smoke-app.test.js` + `tools/smoke-dom-stub.js`): loads the
  whole app into `node:vm` with a stubbed DOM and exercises `renderAll`/`renderProps`
  to catch crashes (missing globals, wrong script order). It does **not** verify
  visual fidelity.
- **Headless E2E** (`test/e2e/critical-flows.test.js` + `test/e2e/helpers/server.js`):
  drives the app in a **real Chrome** (Playwright on the system browser via
  `channel:'chrome'` — no Chromium download) bypassing login with
  `INFRANET_DEV_NO_AUTH=1`. It spawns an isolated server (`INFRANET_PROJECTS_DIR`/
  `INFRANET_SKINS_DIR` → temp dir, so it never touches real data) and exercises the
  critical flows on the real DOM/JS: bundle load with zero JS errors, cable routing
  (`getCablePath` direction-true + TIA-568 pass-through verdicts), VLAN propagation
  AP→client over wireless, BSS re-association, and a real pointer click → selection →
  Properties panel. Removes the "not reproducible in browser" blind spot the DOM
  stub can't cover. **Off by default** (needs Chrome + a server spawn): run with
  `RUN_E2E=1 npm run e2e`. `npm test` reports it as skipped.
- `test/smoke-ui.test.js` still asserts UX markers in the rendered HTML inside the
  DOM stub. For *manual* visual inspection in dev, `INFRANET_DEV_NO_AUTH=1` (see
  auth.js) lets the preview tooling reach the UI without a login — off by default,
  localhost-only, never for production.

Commands: `npm run check` (syntax), `npm run lint` (ESLint gate), `npm test` (all
tests), `npm run typecheck` (tsc JSDoc), `RUN_E2E=1 npm run e2e` (headless browser
E2E), `npm start` (server on `http://localhost:8421`). CI runs all of them.

---

## 8. Security model (summary)

bcrypt-hashed passwords, server-side sessions (httpOnly, sameSite=strict), a
rate-limited login, admin/viewer roles, and **scan/poll routes gated to admin**.
`execFile` is always called with an argument array (no shell → no injection).
Binds to `127.0.0.1`. `users.json`, `.session-secret`, `projects/` are
git-ignored. Do **not** expose the instance to the public internet — it is a
network scanner with command execution; the right access model is VPN/LAN.

---

## 9. Gotchas / conventions

- **Script order matters** (`netmapper.html`): a global used before it is defined
  breaks silently. `lib/i18n.js` loads first so `t()` is available everywhere.
- **Shadowing:** some functions use a local `const t` (e.g. `rep.totals`). The
  global i18n `t()` is shadowed there — rename the local (e.g. `tot`) before using
  `t()`.
- **Windows:** Git shows LF→CRLF warnings; harmless. The login page blocks the
  preview tooling unless you authenticate.
- **Don't add a new *runtime* dependency** without a strong reason (the build is
  esbuild-only, a dev dep).
- **Shared state lives behind `src/store.js`** (getter/setter proxy su `window`):
  i moduli ESM leggono/scrivono `store.state`, `store.selId`, `store._viewMode`, …
  (23+ simboli pure-data, ADR D18), mentre `window.X` resta vivo per i classic
  (`export.js`/inline). `TYPES` è ora `export const` in `app-types.js` (importato dai
  consumatori; resta su `window.TYPES` via `expose()` per i classic). Le funzioni del
  nucleo (`renderAll`, `renderProps`, `showAlert`, …) sono `export` e importate. Ciò
  che resta sul ponte (`win.*`, ~1800 letture) sono funzioni non ancora ritirate
  (`selected`/`checked`/`_build*`).
- **Commit only when asked.** Keep secrets and user data out of the repo.

---

## 10. Frontend evolution (ESM strangler **complete**, merged to `main`)

- **ESM migration (esbuild).** The glue (`app.js` + ~37 `lib/app-*.js`) was
  decomposed into explicit ES modules bundled by esbuild, one file at a time,
  behind a `window` bridge (`src/_bridge.js`) so the app stayed green at each step.
  Pure `lib/*.js` stay UMD-lite (imported as CJS by esbuild; Node tests unchanged).
  **Status: JS strangler complete,
  merged to `main` (`8b77e63`)** — all `lib/app-*.js` glue **and** the nucleus (`src/app.js`)
  are ESM in the bundle. The only remaining classic `<script>`s are the pure `lib/*.js` and
  `export.js` (by design). Next: retire the `window` bridge toward real `import`/`export`,
  plus the onclick→delegation epic.
- **ESLint gate (`eslint.config.js`, v9).** `no-undef` is enforced as a safety net where
  the module system is explicit (Node/CommonJS + UMD `lib/`) and is **off on `src/`** until
  the `window` bridge is retired (then it re-enables). Cosmetic rules are warnings, so the
  gate is green; it runs in CI via `npm run lint`.
- **Modular CSS + tokens.** `style.css` (≈1990 lines) is split into 9 ordered
  partials in `styles/` (loaded via `<link>` in cascade order, served by
  `/styles/:file`). Design tokens (colors/surfaces/shadows/typography already
  present; **radius** applied, **spacing/z-index/transition** documented) live in
  `styles/01-tokens.css`. See **`styles/README.md`**.
- **Headless E2E.** `test/e2e/` drives the app in a real Chrome (Playwright on the
  system browser via `INFRANET_DEV_NO_AUTH`, isolated temp store) — see §7.
- **Floor/rack navigation parity.** Both canvases pan via a `transform: translate`
  (floor: `floorView`, rack: `rackView.x/y` on `#rack-chassis-wrap`) + wheel-zoom;
  the rack has **no scrollbars** (`overflow:hidden`). Drag on empty area pans, drag
  on a device moves it, Space+drag pans anywhere. Rack px→U conversion reads the
  `--ru-h` token (`rackUPx()`), never a hardcoded unit height.
