# Contributing to InfraNet Pro

Welcome. This project is intentionally **low-tooling**: vanilla JS, Node-only,
with a *lightweight* esbuild bundle for the frontend (introduced by the ESM
migration). You can be productive in minutes. Read
`ARCHITECTURE.md` first for the mental model.

## Setup & run

```bash
npm install          # runtime (Express, net-snmp, pdfkit…) + dev (esbuild, typescript, playwright-core)
npm start            # build the frontend bundle + serve → http://localhost:8421
```

On first launch a default **`admin` / `admin`** account is created — change the
password immediately. The login page is required to reach the app (and the preview
tooling).

## The commands you'll use

```bash
npm run check        # syntax-check every .js file (tools/check-syntax.js)
npm run lint         # ESLint gate — no-undef as a safety net (eslint.config.js)
npm test             # run all tests (node --test, zero dependencies)
npm start            # serve the app
```

`check`, `lint` and `test` must all be green before you commit (the same three
run in CI). `npm run lint:fix` applies the auto-fixable subset. The lint gate is
deliberately scoped: `no-undef` is enforced where the module system is explicit
(Node/CommonJS + the UMD `lib/`), and **off on `src/`** for now (the bundle's
`window` bridge resolves bare names at runtime — it re-enables once that bridge is
retired). Stylistic findings are warnings, not errors, so the gate stays green.

## Conventions (non-negotiable)

1. **Logic in `lib/`, presentation in glue.** Put decision logic in a pure
   UMD-lite module under `lib/` (works in Node + browser) and unit-test it. Keep
   the glue (ESM modules in `src/app-*.js`, bundled by esbuild) thin — it turns
   pure results into DOM. See `ARCHITECTURE.md` §3.
2. **No new runtime dependency** without a strong, discussed reason. The frontend
   build is esbuild-only (a dev dep); keep the pure `lib/*.js` modules UMD-lite so
   the Node tests import them unchanged.
3. **Tests are zero-dependency** — `node --test` only. New pure logic ships with a
   `test/<name>.test.js`.
4. **Manual-first**: never make discovery/SNMP overwrite a user-entered value.
5. **i18n**: any new UI string gets a key in both `it` and `en` in `lib/i18n.js`.
   Use `data-i18n` for static HTML, `t('key')` for JS templates. Never machine-
   translate; leave technical terms and vendor names alone. The key-parity test
   fails if a translation is missing on one side.

## Your first change (worked example)

Add a field to a device, the right way:

1. **Pure logic (if any)** → a function in a `lib/` module + a test in `test/`.
2. **Glue** → render the field in the relevant block of `src/app-properties.js`
   (or the matching `src/app-properties-*.js`).
3. **i18n** → add the label keys to `it` and `en` in `lib/i18n.js`; tag with
   `t('...')` / `data-i18n`.
4. `npm run check && npm run lint && npm test` → all green.
5. **Verify in the browser** (`npm start`, log in): the smoke tests catch crashes
   but **not** visual issues — open the page and look. Switching the language is a
   good way to surface JS-rewritten text that bypassed i18n.

## Commit & PR

- **Commit messages**: conventional style (`feat(...)`, `fix(...)`, `refactor(...)`,
  `docs(...)`).
- **Never commit** secrets or user data — `users.json`, `.session-secret`,
  `projects/`, `.env` are git-ignored; keep it that way.
- Keep PRs focused; a green `check` + `lint` + `test` is the bar.

## Where things live (quick map)

| You want to… | Look in |
|---|---|
| Add/adjust device types | `src/app-types.js`, `src/app-properties.js`, `netmapper.html` (palette) |
| Change rendering of the rack/floor/cables | `src/app-render-core.js`, `src/app-topology-overlay.js` |
| Touch SNMP polling/discovery | `drivers/snmp.js`, `server/routes/discovery.js`, `src/app-snmp.js` |
| Classification (sysObjectID / OUI) | `engine/`, `plugins/` |
| Translations | `lib/i18n.js` |
| Backend routes / storage | `server/` |

Thanks for keeping it simple. The lack of tooling is a feature — please preserve it.
