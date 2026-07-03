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
                       pdf-report, label-sheet, routes/{projects,discovery,export,ai}
server/ai-config.js    AI assistant config: enabled/endpoint/model/key + scope/features
                       (data/ai-config.json git-ignored; key server-side only, env INFRANET_AI_KEY)
server/ai/             AI assistant: context.js (sanitized §8b + ports/SNMP-health/topology +
                       hw-capabilities + health alerts, re-sanitized browser liveFacts,
                       scope-aware, allowlist+denylist; nested driver shapes survive a
                       depth-4 secret-filtered sanitizer; passive no-IP gear -- wall
                       ports/patch panels -- marked passive:true so the AI won't call
                       them missing-IP gaps), prompt.js (grounding it/en +
                       capabilities + problem alerts + §4c help: UI catalog + full workflow
                       journey), provider.js (OpenAI-compatible client via
                       node:https, zero-dep). routes/ai.js derives the UI help catalog once
                       (lib/ui-catalog from netmapper.html+i18n) and returns an entities digest
                       (extractEntities) so the client can run the anti-invention check.
drivers/snmp.js        SNMP v1/v2c/v3 driver
engine/                sysObjectID + OUI classification engines (plugin loaders)
plugins/               Seed vendor catalogs (zero database)

lib/                   Shared browser + test modules (the heart of the app)
  i18n.js              t(key,vars), it/en dictionaries, glossary  (pure)
  cidr.js netnames.js linkstate.js correlate.js cabling.js
  topo-lines.js frontpanel.js stack.js ha-pair.js l3-gateway.js
  power-mib.js wifi-spec.js cable-labels.js drift-report.js
  ai-grounding.js   extractEntities + checkGrounding (citations + anti-invention)  (pure)
  ai-draft.js       splitDraftBlocks (segments AI reply → text + Ansible draft cards)  (pure)
  onboarding.js     nextStep(summary) → deterministic «next step» chip (onboarding §4d)  (pure)
  health-alerts.js  computeHealthAlerts → deterministic problem alerts from SNMP telemetry (RAM/disk/ink/UPS)  (pure)
  ui-catalog.js     extractCatalog/catalogLines: derive UI help (buttons+tooltips) from HTML+i18n  (pure)
  ipam.js           computeIpamUsage incl. nextFree (next free host = «suggested IP»)  (pure)
  ipam-audit.js     buildIpamAudit → duplicate IPs + overlapping subnets (IPAM hygiene, doc↔doc)  (pure)
  lag-audit.js      checkLagMembers → LAG member consistency (speed/VLAN mismatch);
                    checkLagPair → LACP cross-end mode coherence (both-passive /
                    lacp-vs-static)  (pure)
  lag-reconcile.js  isLagEligibleType (active-only, no passive/pass-through) +
                    stripLagOnPassive + reconcileLagMemberConflicts (one member per
                    active port, manual-first) — LAG data hygiene on load + auto-link  (pure)
  subbar-stats.js   computeSubbarStats → sub-header numbers: doc completeness
                    (withIp/addressable), device count (rooms excluded), SNMP health
                    (ok/err/warn/none) — same field defs as api-shape/app-drift  (pure)
  mac-class.js      isVirtualMac/isRandomizedMac (BYOD); sharedMacsInBatch (a MAC on
                    ≥2 IPs = shared next-hop) + gatewayMacSet (documented L3 gateways)
                    → discovery skips by-MAC merge on those, no gateway collapse  (pure)
  device-signatures.js  canonical sysObjectID→type table (OID_TYPE_VOTES; oidTypeVotes/
                    oidType/oidIsType) — single source read by the fusion scorer, the
                    legacy classifier AND the client _guessType (no OID drift)  (pure)
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
          vlanNames{}, ipam{vlans{}}, lagGroups{}, lagModes{}, guestVlans[], … }
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
At the tail of each rebuild it also refreshes the sub-header (`src/app-subbar.js`
`renderSubbar` → `#modern-subbar`: breadcrumb · next-step suggestion · project
stats) — a bare-global typeof-guarded call, so no new `win.*` reference.

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
  logic. Fast, zero-dep. ~840 tests. Includes the AI assistant's **anti-leak guard**
  (`test/ai-context.test.js`): asserts no SNMP community / credential / secret-named
  field can ever reach the AI context (data-security paletto, build-failing).
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

bcrypt-hashed passwords (cost 12), server-side sessions (httpOnly, sameSite=strict;
`secure` behind a TLS proxy via `INFRANET_TRUST_PROXY=1`), a rate-limited login,
admin/viewer roles, and **scan/poll routes gated to admin**. `execFile` is always
called with an argument array (no shell → no injection). The session secret and the
first-run admin password are generated with a **CSPRNG** (`crypto.randomBytes` /
`crypto.randomInt`), never `Math.random`. Every `projectId` reaching the filesystem
is coerced to a positive integer (no path traversal). The user store is written
**atomically** (temp + fsync + rename, with a `.bak`, via `atomicWriteFile`); a
present-but-corrupt `users.json` recovers from the `.bak` and, failing that, **halts
startup** instead of regenerating a default admin over existing accounts. The data
surfaces — AI context, REST DTOs, exports — are **allowlist-only**: secrets are
structurally excluded and a build-failing guard test enforces it. Binds to
`127.0.0.1`. `users.json`,
`.session-secret`, `api-tokens.json`, `data/ai-config.json`, `projects/` are
git-ignored. A 2026-06 AppSec audit found **no critical issues**; the follow-up
hardening is covered by regression tests (`test/ai-context.test.js`,
`test/ai-route-security.test.js`). Do **not** expose the instance to the public
internet — it is a network scanner with command execution; the right access model
is VPN/LAN.

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
- **Discovery engine — hardened by live multivendor PnetLab validation (2026-07).**
  - **Access VLAN — `vmVlan` fallback + a manual-first guard (addressed).** The access VLAN
    is now read from CISCO-VLAN-MEMBERSHIP-MIB (`vmVlan`, `9.9.68.1.2.2.1.2`, per ifIndex)
    when Q-BRIDGE `dot1qPvid` doesn't carry it — standard-first (used only where PVID is
    missing/1 and `vmVlan` > 1), vendor-neutral (empty subtree on non-Cisco → no effect).
    And an SNMP read of VLAN 1 (default/native, or simply not exposed on an image) never
    overwrites a hand-documented non-default VLAN (`_snmpVlanToUi` guard). `drivers/snmp.js`,
    `src/app-snmp.js`. *(Lab image `vios_l2` exposes **neither** `dot1qPvid`-real **nor**
    `vmVlan`, so on that lab the manual-first guard is what protects the documented VLAN; a
    real Cisco IOS/NX-OS reads it correctly via `vmVlan`. Trunk VLANs come through fine via
    CISCO-VTP-MIB `9.9.46`.)*
  - **The ping-sweep retries, now SPACED** (default 2, `pingRetries` 1–4; ~200 ms between
    attempts) so a host that drops the first ICMP (a VPCS, a slow stack, ARP-warmup behind a
    gateway) isn't missed. Live measurement showed the loss is **bursty/correlated**: two
    back-to-back pings fail *together* ~27% of the time on a rate-limited path, so an unspaced
    retry is nearly useless — a small gap drops the retry outside the loss window. Cost falls
    only on hosts that already missed the first try. Applies to the reachability audit too.
    `_pingHostRetry`, `server/netscan.js`.
  - **No false SNMPv3 on non-SNMP hosts (addressed).** The v3 credential-less detection used
    to treat *any* non-timeout error as "live v3 agent needing credentials"; an ICMP
    port-unreachable from an alive host with no SNMP (VPCS/PC/IoT) raises a
    `ResponseInvalidError`, so those hosts intermittently surfaced as SNMPv3 "to configure".
    It now requires a genuine USM **remote engineID** — the authoritative engineID present
    *and* different from net-snmp's own local engine — a signal only a real agent produces.
    Vendor- and library-version-neutral (no PEN/prefix hardcoded). Validated live: VPCS/PC/SRV
    → 0 false v3, Cisco/VyOS still detected. `_v3RemoteEngineDiscovered`, `drivers/snmp.js`.
  - **Still open — a ping-only, off-segment host can be missed under sweep load.** On a path
    that rate-limits ICMP, a full `/24` sweep saturates it and even the gateway is
    intermittently lost (measured: a VPCS surfaced in 2 of 5 sweeps). A device that speaks
    **neither SNMP nor LLDP/CDP** and is **off-segment** (no local ARP MAC) has ICMP as its
    only signal, so retry-spacing alone can't guarantee it appears. The robust vendor-neutral
    fix is to **surface the SNMP ARP table** (`ipNetToMediaTable`) of the crawled switches as
    discovery candidates — `pollNeighbors` already returns `arpTable`, so the off-segment
    host's IP+MAC (hence OUI vendor) is available with no ICMP. Planned; presentation and
    noise-scoping are a design decision.
  - **Still open — the ping sweep trusts the `ping` exit code** (`_pingHost`). On Windows,
    `ping` exits `0` even for a router's *"destination host unreachable"* reply, so empty IPs
    **behind an L3 gateway** can be counted as live (the gateway rate-limits the ICMP errors
    → a handful of scattered phantoms, not the whole subnet). A real echo-reply must be
    required (`ttl=` / `bytes from`) **and** unreachable replies excluded; the text fallback
    (`'1 received'`) is Linux-only, so on Windows the buggy exit-code path still wins.
- **Discovery engine — SNMP port mapping is now ifName-anchored (2026-07).** A live
  **multivendor** PnetLab run (Cisco vIOS ×3, MikroTik RouterOS, VyOS and Ubuntu/net-snmp
  + VPCS; two LACP bundles, four VLANs, L3-lite) confirmed recognition / HOST-RESOURCES /
  LAG-trunk-VLAN reads, and surfaced a merge bug: `applyPollResult` mapped SNMP interfaces
  to ports **positionally** (`${nodeId}-${idx+1}`), so on a **hand-documented** switch whose
  port order didn't match the device's ifIndex order, a trunk/Port-channel member's data was
  written onto a port where an endpoint was cabled → the endpoint got pulled into the LAG.
  Now interfaces are matched **by ifName** (stable re-syncs with `snmp-server ifindex persist`),
  a hand-cabled port without an ifName is **preserved** (never clobbered), and a genuine
  endpoint-vs-trunk conflict is **surfaced** (`portReconcileConflicts` → amber panel warning),
  not silenced. The LLDP-LAG naming was also fixed to pick the aggregator that actually
  connects the peer (by `lagId`/trunk VLANs). `src/app-snmp.js`, `src/app-autolink.js`,
  `src/app-properties-node.js`. Follow-ups from a live re-test: the reconcile warning now
  fires **only** on a genuine access-vs-trunk mismatch (not on hand-documented trunk members);
  the ghost-cable *"port down for N syncs"* check **ignores hand-cabled ports without an
  ifName** (their status is stale/mis-mappable, `src/app-drift.js`); and when a single manual
  cable to a confirmed LLDP/CDP neighbor sits on a port without an ifName, the **real interface
  name is backfilled** onto that documented port (in SNMP form) and freed from the positional
  one it had landed on, so future syncs match it by ifName (`src/app-autolink.js`). Manual-first
  and vendor-neutral throughout. The Scopri **crawl** also no longer blanks the vendor of an
  LLDP/CDP-discovered neighbor: the backend resolves it from `sysObjectID` (e.g. Cisco from
  PEN 9), but a stale `vendor:''` default in the merge was overwriting it *after* the spread,
  so crawled devices showed Vendor "—" while a directly-scanned device kept it. The merge now
  preserves the resolved vendor (`_discCrawlRow`, `src/app-discovery.js`). The discovery items
  still open are the ping-sweep **exit-code false-positive** and the **off-segment ping-only**
  miss under sweep load (both above).

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
