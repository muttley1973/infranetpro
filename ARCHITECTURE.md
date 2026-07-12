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
4. **Manual-first** ([ADR](docs/adr/manual-first.md)). User-entered data always
   wins; SNMP/discovery never silently overwrites a manual value.
5. **Localhost-bound.** The server binds `127.0.0.1` only. It is a LAN tool that
   runs *inside* the network it documents, not a public service.

> **Why these exist — decision records.** The *why* behind the rules that make the
> tool trustworthy lives in **[`docs/adr/`](docs/adr/)**: the data-integrity
> principles [manual-first](docs/adr/manual-first.md),
> [no-invention](docs/adr/no-invention.md) ("InfraNet computes, the AI narrates"),
> [vendor-neutral](docs/adr/vendor-neutral.md) ("build for every vendor, the lab
> only validates") and [measured-not-declared](docs/adr/measured-not-declared.md),
> plus architectural decisions such as [pure `lib/` modules](docs/adr/pure-lib-modules.md)
> (ADR D4). Code comments cite these by tag (`paletto #2`, `ADR D4`, …); every tag
> resolves from [`docs/adr/README.md`](docs/adr/README.md).

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
server/module-registry.js  Generic paid-module plugin seam (feature-agnostic): loadModules
                       mounts modules/<name>/server if present (modules/ gitignored, private
                       repo, in-process so modules get req.session.user + auth.requireAdmin);
                       getNav feeds GET /api/modules (header nav slot); onProjectDelete lets a
                       module clean its own sidecars on project delete. The core knows no
                       specific module.
drivers/snmp.js        SNMP v1/v2c/v3 driver
engine/                sysObjectID + OUI classification engines (plugin loaders)
plugins/               Seed vendor catalogs (zero database)

lib/                   Shared browser + test modules (the heart of the app)
  i18n.js              t(key,vars), it/en dictionaries, glossary  (pure)
  cidr.js netnames.js linkstate.js correlate.js cabling.js
  topo-lines.js frontpanel.js stack.js ha-pair.js l3-gateway.js
  power-mib.js wifi-spec.js cable-labels.js drift-report.js
  project-networks.js  deriveProjectNetworks (/24s from devices+leases →
                    covered/blocked/open) + annotateNetworksVerification (join with
                    the Verifica outcome: presence badge per subnet + non-verifiable
                    devices nested under their /24, absorbing the old bucket)  (pure)
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
                    oidType/oidIsType) — single source read by the fusion scorer AND
                    the client _guessType (no OID drift)  (pure)
  discovery-mdns.js canonical mDNS(DNS-SD)+SSDP(UPnP) helpers: query build, wire-format
                    parse (DNS compression, SSDP headers, UPnP XML), service→type map
                    (vendor-neutral) + aggregateSweep. Drives server _mdnsSsdpSweep  (pure)
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
src/store.js           Shared mutable view-state behind a proxy (state/selId/… ex-win.*)
src/app-delegation.js  Delegated click/change/input listeners: data-act/change/input="key" → imported fn
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

Load path: `loadProject(id)` fetches the stored `state` and runs it through
`_migrateState()` (`src/app.js`) before it becomes the live model. Migration is
idempotent and mostly additive (defaults for new fields, legacy VLAN/radio/link
repairs), with one structural step: `_normalizeProjectNodeIds` **canonicalizes
device IDs** that don't already match the `<type-prefix><n>` scheme (an imported
`core1` switch becomes `sw1`) and remaps every ID-embedding reference — link
`src`/`dst`, `ports` keys, and LAG identifiers. **Invariant:** a reference that
embeds a device ID must be remapped on *both* sides or it dangles — in particular
the port-side `ports[].lagGroup` and the `state.lagGroups` map keys go through one
shared `remapLagId` helper so they stay aligned across formats (`snmp-lag-…`,
`lldp-lag-a||b`, `lag-<id>-poN`). App-created projects already use canonical IDs,
so this is a no-op for them; it only reshapes imported/generated projects.

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
  logic. Fast, zero-dep. ~1370 tests. Includes the AI assistant's **anti-leak guard**
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
structurally excluded and a build-failing guard test enforces it. (The PDF
report's per-device asset register is built from the same `nodeToDevice` DTO
(minus structural cabling — wall ports and electrical panels are not IT assets —
via `isStructuralCabling`), so no SNMP community or credential can reach the
exported document; report chrome is
localized it/en server-side while device data is emitted verbatim.) Binds to
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
- **SNMP walk — adaptive retry kills FDB truncation under crawl load (2026-07-04).** The crawl's
  `pollNeighbors` walks the forwarding table (FDB) alongside LLDP/CDP and ARP — many single-column
  GETBULK walks on the same agent (limited to `WALK_CONCURRENCY`, default 4). A small-business switch
  under that pressure drops UDP; a GETBULK times out and net-snmp's `subtree` returns a **partial**
  FDB with no downstream error → macsuck placed some/all MACs on no port ("sometimes 0 badges"). Fix
  in `_runWalks` (`drivers/snmp.js`): a **timed-out** walk is retried on the same base with
  `max-repetitions` **halved** (25 → 12 → 6, floor `WALK_MIN_REPS`) + backoff — the netdisco bulkwalk-retry
  strategy. Idempotent (`oid→value`, a retry overwrites partials); healthy devices never retry; a
  deliberate loop/runaway abort is not retried. `SNMP_WALK_RETRIES` (default **1** — the first
  halved-reps retry recovers nearly all truncations; a second quartered pass cost real crawl time
  for a marginal gain; `0` truly disables). **Crawl scope (2026-07-07):** in `pollNeighbors` the retry
  is restricted to the **FDB group** (`FDB_RETRY_BASES` — dot1d/dot1q FDB + the bridge-port→ifIndex
  map), the only family whose truncation breaks macsuck; LLDP/CDP/ARP that time out fail immediately
  instead of paying repeated timeouts (they only cost fewer neighbours/hosts, not a badge bug). Other
  callers (`poll`/printer/host-resources/`walkSession`) pass no scope → every base still retries.
  Pure-ish + unit-tested with a mock session.
- **Vendor recognition — full IANA PEN + IEEE OUI registries (2026-07-04).** Two bundled,
  refreshable datasets back vendor resolution, so a new device is recognized without a code
  change (the fix to a recurring "vendor X is missing" class of reports):
  - **MAC → vendor**: `data/oui-db.json` (~57k IEEE prefixes, MA-L/M/S + IAB), refreshed by
    `npm run update-oui` (`scripts/update-oui-db.js`). Consumed by the priority-0 catch-all OUI
    plugin; per-vendor plugins (Cisco/Apple/…) override it to add `deviceType`.
  - **SNMP sysObjectID → vendor**: `data/pen-db.json` (~66k IANA Private Enterprise Numbers),
    refreshed by `npm run update-pen` (`scripts/update-pen-db.js`, which parses IANA's flat
    `enterprise-numbers` file). `_vendorByObjectId` maps the enterprise number (7th arc of
    `1.3.6.1.4.1.<PEN>`) against it. The curated `PEN_VENDOR` (~50 entries) wins for clean short
    names; the registry is the fallback (lazy-loaded, degrades to the curated table if the file
    is missing). **Lab caveat**: virtual images (vEOS/vIOS) carry a hypervisor MAC with no IEEE
    OUI, so their vendor comes from SNMP (PEN) — proven live: a lab Arista (`sysObjectID
    …30065.1.2759`) resolves to **Arista** where the MAC path can't see it.
- **Discovery engine — killing phantom ARP-observed rows (2026-07-04).** Live debugging
  of a real `/24` traced a swarm of low-confidence "observed" phantom IPs to TWO
  distinct ARP paths; both are now authoritative-source-aware:
  - **ARP-SNMP is off-segment only.** The crawl harvests each SNMP device's
    `ipNetToMediaTable` (`buildArpCandidates`, the `arpnip` step) to find hosts the
    collector can't ICMP directly. But on the home LAN it was surfacing **on-segment**
    dead IPs out of a neighbour's *stale* ARP cache — root cause: an on-segment Synology
    (`.120`, SNMP public) whose ARP table was full of sleeping/departed entries. Fix:
    `buildArpCandidates` takes `localSubnets` (the collector's own `/24`s from
    `_readLocalInterfaceMap`) and **skips any candidate in a local subnet** — for
    on-segment IPs the local sweep/ARP is authoritative, so a dead one isn't resurrected
    from a remote device's stale table. Off-segment (the feature's real purpose) is
    unaffected. Verified in-browser: full `/24` scan 7 phantoms → 0.
  - **Local ARP read is state-aware on Windows.** `_readArpMap` now uses `netsh
    interface ipv4 show neighbors` (has the neighbour state) instead of `arp -a`, keeping
    only rows whose physical-address column is a real MAC. "Unreachable"/"Incomplete"
    entries carry the localized *state* there (no MAC) → excluded by matching the MAC
    token, **not** the state string (robust across Windows locales; avoids the
    `task_977d2930` trap). `_parseNeighbors` is pure + tested (IT/EN/any-locale).
  - **Stale-duplicate demote — `_demoteStaleArpDup`, two passes.** *Pass 1:* an ARP-only
    row whose MAC is live/DHCP at **another** IP is a stale cache entry of the same device
    → *Inactive*. *Pass 2 (double-phantom, 2026-07-04):* the **same** MAC on two-or-more
    ARP-only rows with **no** strong anchor anywhere (no ping/SNMP/DHCP) is one device
    caught mid DHCP-renewal in a stale cache (common with randomized/BYOD + mobile MACs) —
    keep one representative (highest IP, deterministic via `_ipToNum`), demote the rest to
    *Inactive*. Manual-first: demoted rows stay visible + re-selectable. Prompted by an
    Advanced IP Scanner side-by-side that showed the same MAC at two IPs (a phone at `.180`
    **and** `.240`; a randomized MAC at `.122` **and** `.234`). Pure + unit-tested.
  - **Web fingerprint — fast base, patient deep-scan (2026-07-04).** The HTTP/HTTPS title
    probe (feeds vendor + type from a banner like `GS1200-8` / `Keil-EWEB` / `lighttpd`)
    stays **aggressive (450/650 ms) in the base scan** so a `/24` stays fast. Embedded web
    UIs on UPSs / NAS / cheap switches answer slower and were missed; when **deep-scan** is
    on, discovery re-probes them **patiently (900/1200 ms), in parallel** with the
    NetBIOS/SMB/TCP identity scan, but only the rows still missing a title. The everyday
    fast path is unchanged. `server/routes/discovery.js`.
  - **Crawl heartbeat (UX).** The LLDP/CDP expansion is long (SNMP poll per switch +
    macsuck at the end); the Scansiona button shows "Espansione…" + spinner and the
    progress line updates per probed device (+ located count) so it doesn't look frozen.
  - **Crawl orchestration — level-synchronised parallel BFS (2026-07-07).** The
    neighbour-expansion BFS was extracted from the SSE route into `server/crawl-bfs.js`
    (`crawlNetwork`, probe/pollNeighbors **injected** → unit-tested with zero network).
    It processes each BFS depth-level with a **bounded worker pool**, then a barrier
    updates order-dependent state (`seenName` dedup, `discoveredBy`, `results`) iterating
    the frontier **sorted by IP** → deterministic: `pool=1` and `pool=N` give identical
    output (unit test with skewed latencies + live lab: same device set at pool 1 vs 4).
    Only the *deep* phase parallelises (authenticated SNMP polling of discovered devices —
    not a scan signature); the base host sweep stays sequential/paced (**anti-IDS**).
    Pool = `CRAWL_POOL` (default **4**, clamp 1-32): low on purpose — socket footprint =
    pool (Raspberry-friendly) and the lab returns-knee is ~4-6 (floor = slowest device).
- **Discovery engine — DHCP-as-source + macsuck device location (2026-07-04).**
  Two "see it without a ping" additions, from live testing (Synology DHCP + a Zyxel GS1900):
  - **DHCP leases as a discovery source.** The sweep route (`/api/discover`) accepts
    `dhcpLeases` in the body (the frontend sends `store._dhcpLeases`). After the sweep it
    appends a candidate row for every leased IP **inside the scanned subnet** that wasn't
    already found — decorated by the same `_decorateDiscoveryRow` pipeline (OUI vendor,
    hostname), `alive:false` (observed, **not** pre-selected — manual-first). The scorer
    (`_buildDiscoveryMeta`) gains a `dhcp` evidence (weight 14, an authoritative IP-MAC
    binding across all VLANs) that **replaces** the generic `mac` evidence for a lease row
    (no double-count, honest source label). Works with **zero SNMP**. Frontend marks the row
    `_via:'dhcp'` (source badge + "observed" state).
  - **macsuck — `locateMacsOnEdge(fdbBySwitch, opts)` in `lib/correlate.js`.** The crawl
    (`/api/discover/topology`) already got each switch's FDB from `pollNeighbors` (`fdbTable`)
    and threw it away; it now collects it and, at end-of-crawl, locates every target MAC
    (crawl results + `targetMacs` the frontend passes from the sweep) on its access port,
    emitting a single `type:'located'` SSE event `{ edges:{ [macLower]: {switchIp, switchName,
    ifName, macCount, edge, shared, ambiguous} } }`. The frontend `_discApplyEdges` matches by
    lowercased MAC and renders `_discEdgeBadge`. Placement rule (netdisco-canonical): the
    **edge** = the port with the fewest co-learned MACs (`<= edgeMax`, default 4 → direct
    link); if none, the least-busy **non-LAG** port → **shared** ("behind *port*", an AP /
    unmanaged switch); a MAC seen only on a busy **LAG uplink** is left unplaced. Virtual NICs
    excluded. **Pure, vendor-neutral** (BRIDGE-MIB `dot1dTpFdb` / Q-BRIDGE `dot1qTpFdb`).
    ⚠️ **Needs a switch that exposes the FDB over SNMP** (real Cisco/Aruba/HPE/Zyxel/Arista):
    the lab's Cisco vIOS returns an empty bridge FDB (same limit family as `vmVlan`/`dot1qPvid`
    — proven by escalating probes incl. ping-then-read and `community@vlan`), so macsuck is
    unit-tested + validated on real hardware (Zyxel GS1900), not on vIOS. Manual-first: the
    location is a badge hint, not an auto-created cable (auto-cable-on-import is a deliberate
    follow-up).
- **Discovery engine — scan speed, confidence pre-select, de-dup, BYOD vendor (2026-07-04).**
  From live testing on a real `/24`:
  - **Single-ping sweep + ARP-authoritative liveness.** The spaced double-ping retry (below)
    doubled the time spent on every dead IP; on a full `/24` of empty addresses that pushed the
    scan past the client timeout (~3× slower on dead IPs, measured). The sweep now sends **one**
    ICMP probe by default (`pingRetries` still opt-in, 1–4). Reliability moves to **ARP**, the
    authoritative liveness on a LAN (as nmap does): after the sweep, an on-segment host with a
    **local ARP entry** is marked `alive` even if its ICMP reply was lost (`pingReachable` stays
    false → it weighs as ARP in scoring, not a fake ping), so ICMP-filtered hosts appear too.
    Cross-subnet is safe — the local ARP cache holds only the gateway for off-segment IPs, so no
    false positives. `server/routes/discovery.js`.
  - **Stealth (anti-IDS) pacing — opt-in (2026-07-07).** The base sweep pings *unknown* IPs, the
    one phase with a scan signature that can trip a rate-based IDS/IPS on the network being
    documented. `POST /api/discover` with `stealth: true` (or `scanDelay: <ms>`) **serialises** the
    sweep (concurrency 1) and spaces probes by a **jittered** delay (default 400 ms ±30% — a fixed
    interval is itself a detectable cadence) — nmap's polite/T2 profile. Enrichment/deep are also
    serialised. It covers **only** the base sweep; the deep/LLDP-CDP polling of already-known
    authenticated devices stays parallel (`CRAWL_POOL`) as it isn't a scan signature. Default is
    unchanged (fast/parallel). No hosts lost (same alive set on vs off, validated live). Pure
    `_stealthDelayMs` (jitter, injectable rand) in `server/netscan.js` + unit tests.
    **Refined 2026-07-09:** Stealth also **randomizes the target order** — a sequential
    `.1→.254` sweep is a scan signature just like a fixed interval — on *both* the ping sweep
    **and** the SNMP/enrichment phase (each an independent shuffle; the enrichment phase also
    inherits the jittered pacing). Pure `_shuffled` (Fisher-Yates, injectable rand) + unit tests;
    verified end-to-end against the real `/api/discover` route (ping+SNMP sequential on
    Normal/Safe vs shuffled on Stealth; concurrency 64/32/1 and 16/8/1).
  - **Windows PC names via NetBIOS (2026-07-09).** A Windows host speaks no SNMP and rarely
    advertises its name over mDNS, so it came out nameless. The base flow now resolves it with a
    single **NBSTAT** (NetBIOS node-status) query sent **directly over UDP 137** per *alive,
    still-nameless* host (~40 ms, cross-platform; the `nbtstat` CLI probes every local NIC and
    waits out the dead ones — 10–30 s+ on multi-NIC hosts — kept only as a Windows fallback) — on
    the **Normal and Safe** cadences (a single NBSTAT on a known-alive host is within Safe's light anti-IDS; gentler
    concurrency on Safe), **off on Stealth** (no NetBIOS footprint). The box running InfraNet
    appears in its own scan but `nbtstat` can't query its own IP, so the **local host is named from
    `os.hostname()`** in every cadence (no network probe). Windows-only (nbtstat); a NetBT-disabled
    host with SMB open still relies on the **SMB** identity signal. `server/routes/discovery.js`.
  - **Pre-selection gated on confidence (15%).** A ping-only phantom (the exit-code artifact
    below) scores ~10% (only the `reachability` evidence); anything real starts at ~20% (a bare
    ARP MAC is ≈22%, SNMP ≥57%) — the bands don't overlap, verified with the real scorer on the
    lab. Discovery now pre-checks a row only if `alive && confidence ≥ 15`; the phantoms stay
    visible (greyed `.disc-lowconf`, hand-selectable) but out of the default import
    (`DISC_PRESELECT_MIN_CONF`, `src/app-discovery.js`).
  - **De-dup across sweep and crawl.** The crawl/ARP-SNMP de-dup set (`knownIps`) now starts from
    every swept IP (`store._discResults`), not just the seeds, so a host already found by the sweep
    isn't proposed twice when it also appears in a switch's SNMP ARP table. MACs are normalized to
    one canonical **uppercase** form for all sources (`_discEnsureMeta`), so the same device can't
    slip a MAC-based de-dup (the sweep emitted uppercase, the ARP path lowercase).
  - **Vendor identity ≠ device type + one classifier.** The fusion scorer never keyword-matches the
    vendor *company name* for the generic type nouns `gateway|switch|router|firewall` (those are
    stripped before the vendor enters the type text) — so a "Gateway Inc." PC isn't a router; type
    comes from behaviour/structure (sysObjectID map, `sysServices` bits, `sysDescr` product tokens,
    TCP probes, SMB/NetBIOS role) and the vendor's real *brand* tokens still vote. NetBIOS is off by
    default on modern Windows (nbtstat is silent) → the live "it's a Windows host" signal is **SMB**:
    port 445 + enumerated shares (or RDP/WSD) and **no** print ports (9100/515/631) → `pc`, beating a
    printer-vendor NIC. The Discover UI now treats this server engine as the single source of truth
    (`serverAuthoritative` in `src/app-discovery.js`); the thin client `_guessType` only fills gaps.
    `engine/fusion-scorer.js` is the single authoritative classifier (`server/classify.js` wraps it);
    the in-line "legacy twin" was removed once the fusion path was proven, with the 55-device
    `tests/classify-golden.test.js` as the behaviour freeze.
  - **Signal tiering — a measured signal always beats a vendor-identity inference (2026-07-07).** A
    per-vendor MAC-OUI plugin proposes a device-type *candidate* (Zyxel→router, D-Link→router, …); that
    guess used to be scored high enough (≤80) to beat a real banner/model/port signal, so a Zyxel box
    whose web page reads *"Intelligent Switch"* was typed `router`. The OUI device-type is now weighted
    like the other identity hints (~45), so **any** measured signal outranks it — one rule for every OUI
    plugin, **no `plugins/oui/*` vendor file edited** (that would be the per-vendor hack the vendor-neutral
    rule forbids). Behavioural detection is by **protocol, not brand**: Google Cast (`_castProbe` →
    `/setup/eureka_info` + ports 8008/8009 in `DEEP_TCP_PORTS`) → `tv` for any make, like RTSP→camera; and
    the **OS** fingerprint decides `mobile` (Android/iOS) vs `pc` (`plugins/os-fingerprint.js` emits the
    type, not the brand). A device known *only* by a vendor/OS inference (a MAC with no measured signal)
    has its confidence capped — honest, manual-first. `engine/fusion-scorer.js`, `server/classify.js`,
    `plugins/os-fingerprint.js`, `server/netscan.js`, `server/routes/discovery.js`; validated by two live
    LAN scans (Zyxel switch, Shield/Chromecast→tv, Huawei tablet→mobile; every correct device unchanged).
  - **Merge-guards on the render path (audit F4/F5).** The guard that stops a next-hop/gateway MAC
    from collapsing remote hosts onto the gateway node ran only on import; it now also runs on the
    preview/table index (`_discAttachMergeGuards`), so a remote host no longer inherits the gateway's
    type and the New/Update badges match what import does. A blocked (next-hop) MAC is treated as
    absent throughout `_discFindExistingDevice`, so it can't raise a false IP-vs-MAC conflict.
    `src/app-discovery-classify.js`.
  - **BYOD vendor from the device's own name.** A randomized/private Wi-Fi MAC has no OUI, so the
    vendor was blank. The vendor resolution now falls back to a **hostname/mDNS brand** the device
    announces (`iPhone-…`→Apple, `Galaxy…`→Samsung, …; `_vendorFromHostname`, conservative list, no
    false positives), and where nothing is derivable the table shows an honest **"Private · random
    MAC"** label instead of an empty cell (`_discVendorLabel` + `isRandomizedMac`). The IEEE
    "Private" OUI value is left untouched. Vendor-neutral. `server/classify.js`, `src/app-discovery.js`.
  - **Table + hidden-panel UX/perf.** The Scopri table uses a fixed column layout (`.disc-scan-table`,
    `table-layout:fixed`) and the "SNMPv3 to configure" badge is shortened to "v3" next to the SNMP
    source. And `renderProps()` is skipped in `_renderAllNow` when the panel is hidden and nothing is
    selected (the floor branch scans every VLAN's IPAM), with the IPAM lookups memoized per render
    frame — a speed-up on large projects (audit F6). `src/app-render-core.js`, `src/app.js`,
    `src/app-properties-floor.js`.
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
  - **Off-segment, ping-only hosts surfaced via SNMP ARP (addressed).** On a path that
    rate-limits ICMP, a full `/24` sweep saturates it and even the gateway is intermittently
    lost (measured: a VPCS surfaced in 2 of 5 sweeps), and a device that speaks **neither SNMP
    nor LLDP/CDP** and is **off-segment** (no local ARP MAC) has ICMP as its only signal — so
    retry-spacing alone can't guarantee it appears. The **LLDP/CDP crawl** now also reads the
    **SNMP ARP table** (`ipNetToMediaTable`, already returned by `pollNeighbors` — previously
    discarded) of every crawled switch/router and proposes the hosts it sees at L2/L3: the
    off-segment host's IP+MAC (hence OUI vendor) is known **with no ICMP**. Gated on the
    existing *"Expand via LLDP/CDP"* toggle (no new switch); noise-bounded to the **scanned
    subnet** (`scanCidr` → the client passes it, the route filters ARP IPs to it); MAC unicast
    only, deduped, capped at 256 with a logged/emitted note (no silent truncation). Presented
    as **observed, low-confidence, NOT pre-selected** (`snmpReachable:false, alive:false`),
    with an "ARP (via <switch>)" badge; **refined by the already-imported DHCP leases**
    (`store._dhcpLeases`): a MAC/IP match attaches the real hostname and lifts confidence
    (seen in ARP *and* DHCP = a real host, not a stale ARP row). `buildArpCandidates`
    (`lib/correlate.js`), `server/routes/discovery.js`, `_discArpRow` (`src/app-discovery.js`).
    Validated live: the lab VPCS (`10.10.10.100`, missed 2–3/5 by the sweep) is proposed from
    SW-CORE's ARP without any ping.
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
  `export.js` (by design).
- **Retiring the `window` bridge (in progress).** `src/_bridge.js` still lets not-yet-retired
  code reach globals (`win.*` read, `expose()` publish). Removing it has **two independent axes**,
  each tracked so it can only move forward:
  - **Axis A — `win.*` → real `import`.** A monotonic ratchet (`test/bridge-ratchet.test.js`,
    `MAX_WIN_REFS`, may only decrease) drove `win.*` references down to a floor of **268**: every
    retirable function is imported, and mutable view-state (`state`, `selId`, `_history`, …) lives
    behind a proxy in `src/store.js`. The residue is the pure `lib/*.js` `<script>` globals and their
    `typeof` guards, which stay by design (importing them would re-bundle the UMD, clobbering the live
    `<script>` copy).
  - **Axis B — inline handlers (`onclick`/`onchange`/`oninput`/…) → event delegation.** Inline handlers
    are *why* the bridge still exists (they resolve names in page lexical scope). `src/app-delegation.js`
    installs **one delegated listener per event type** on the document — `data-act` for `click`,
    `data-change` for `change` (selects, checkboxes, file inputs, committed numbers), `data-input` for
    live `input` (typing), `data-focus` for `focus` (attached as `focusin`, which bubbles — plain
    `focus` does not), and `data-keydown` for `keydown` (the handler receives the event) — so an element
    carries `data-<type>="key"` (arguments read off the element via
    `el.value`/`el.checked`/`data-*`), and the module that **owns** the function registers
    `{ key: (el) => fn(el.value) }` at load: the handler is an **imported** function, off `window`. For a
    menu, the owner registers the toggle and each item is registered by the module that owns that item
    (importing the owner's `close` helper). Migrated so far: undo/redo, the rack/zoom/palette toolbar,
    the account + Report header menus, the project toolbar (`New/Rename/Duplicate/Delete/Save`), the AI
    assistant buttons, the non-click controls of the rack size (`change`), the palette search
    (`input`) and the CSV/DHCP import dialogs (file pickers, live-lease vendor selector, paste-area
    previews), the project + rack selectors plus the Discover/Topology "select all" and the
    deep-TCP-scan preference checkboxes (`change`), the map-image + JSON-import file pickers
    (`change`), and the global search box (`input` + `focus` + `keydown`). Of the static HTML the
    change/input/focus/keydown surfaces are done — only the export panel's remain (`export.js` classic)
    — but **~55 `onclick` handlers are still inline** there (report/discovery/import/PDF-export
    actions, status chips: a mix of clean-but-deferred and genuinely blocked).
    The migration then moves into the **~535 handlers inside dynamically-rendered templates** (rows/cards built by `innerHTML`
    at runtime) — these migrate identically, because a document-level delegated listener also catches
    events from elements created *after* load. Dynamic clusters done so far: the Discover table rows
    (`disc-row`/`disc-type`), the search-results dropdown (`search-pick`), the Drift panel's seven
    one-click actions (`drift-*`, with row keys/CIDRs in `data-key`/`data-cidr`), the three report
    overlays — Audit log, Spare ports and L3 (`audit-*`/`spare-*`/`l3-*`, VLAN id in `data-vid`), the
    Adopt modal (`adopt-close`/`adopt-apply`/`adopt-selall`; its entry points stay exposed),
    the Drift "Explain with AI" button (`drift-explain`) — which made `aiExplainDrift` the AI module's
    first ESM `export` (it was a bridge-only module until then) — and the whole **"Users & access" /
    "Change password" modal** (static tabs/close/create + dynamically-rendered user & token rows via
    `um-*`/`tk-*`/`chpwd-*`, ids in `data-id`), which retired twelve functions from the bridge and
    made `openUserManager`/`umSwitchTab` proper ESM exports imported by `app-ai.js` — fixing a latent
    bug where the admin "AI settings" entry never opened the modal because `openUserManager` was read
    as an (unexposed, undefined) `window` global — and three topology/management surfaces: the
    **management-protocols editor modal** (`mgmt-proto-*`; only the modal migrates — its static
    buttons plus the dynamically-rendered proto rows via `data-input`/`data-act` — while the gear that
    opens it stays inline because it lives in the golden properties panel), the **topology-crawl
    modal** (`topo-crawl-*`, the backdrop keeps its "don't close mid-crawl" wrapper behind the
    `ev.target === el` guard), and the **topology hover-tooltip** (`#topo-tip`, rendered by
    `_showTopoTip` in `app-popup.js`: `topo-create-link`/`topo-nav-rack` with the pair-key/rack-id in
    `data-*`). The rest follows surface by surface. `_bridge.js` / `expose()` are deleted only when Axis B is finished. *(Side note: the AI help
    catalog in `lib/ui-catalog.js`, which reads the real button labels/tooltips, derives a button's action
    from `data-act` as well as `onclick`, so delegated buttons stay in the assistant's catalog.)*
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
