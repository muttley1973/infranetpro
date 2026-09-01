# Import device-type YAML → InfraNet catalog / skins

`import-device-types.js` turns **public device-type YAML data** (the
`device-types/<Vendor>/<model>.yaml` format, **CC0-1.0** / public domain licence)
into:

- a **catalog of native InfraNet templates** (`ports` + `frontPanel`), and/or
- **native panel skins**: vector SVGs with *live* ports (`id="port-N"`).

## Why this way (licence)
- The data used is **CC0-1.0** (public domain): brand, model, `u_height` and the
  port list are freely reusable, commercially too, without attribution.
- We do **NOT** use raster elevation images: they carry no port ids (they would
  never become live LEDs) and their provenance is uncertain. We take only the
  data and **redraw the artwork from scratch**, so the ports stay interactive and
  ours.

## Two ways to use it

### A) NATIVE templates → "Apply model" (RECOMMENDED, EXACT look)
Generates a **catalog** of native templates (`ports` + `frontPanel`: sfpCount/sfp2Count/
sfpStartNum/mgmtCount/sharedMediaSlots) that the app's **default renderer** uses to draw
exact ports/SFP/MGMT. This is the right road: no SVG, it reuses the native render.

`sharedMediaSlots` describes physical positions shared by several media without
increasing the number of ports: `{ start: 10, count: 1, media: ["copper", "fiber"] }`
is a single data slot that accepts copper or fibre. Verified hardware corrections
live in `data/device-types-overrides.json`, with no vendor-dependent rules.
```bash
node tools/import-device-types.js <inputDir> <outDir> --catalog=data/device-types.json
```
Useful filters: `--vendors=A,B` (restrict to the named vendor folders) and `--roles`
(keep network equipment only: switch/router/AP/firewall/UPS-PDU/NAS/console; drop
endpoints, servers/blades and accessories, with a per-vendor kept/dropped report).

`data/device-types.json` is served by `GET /api/device-types`; in the app,
device → Properties → **Port layout → "Apply model"** (search brand/model) sets
`ports`+`frontPanel` → the device is drawn exactly. The merge is idempotent by slug
(several vendors accumulate).

### B) Custom SVG skins (bespoke faceplates)
```bash
# generate .svg skins + catalog:
node tools/import-device-types.js <inputDir> <outDir>
# ...or install the skins into the server's skin store:
node tools/import-device-types.js <inputDir> <outDir> --seed
```
Note: a skin does **not** reproduce the default's transparent SFP/MGMT cages (the
skin renderer forces the `fill`). For the exact look, take road A.
With `--seed` the skins end up in `skins/<slug>.svg` + `skins/index.json` (the skin
store read by `GET /api/skins`): they appear in the **Panel skin** dropdown and via
the brand/model match (the ✓). The seed is **idempotent**: re-running it first
removes pre-existing skins with the same `(brand, model, face)`.

Output without `--seed`: `<outDir>/<slug>.svg` (one per model) + `<outDir>/catalog.json`
(brand, model, u_height, port counts).

## How it classifies and numbers
- **copper** (`*base-t/tx`) → `id="port-N"` · **fibre** (`*sfp/qsfp/base-x`) →
  `id="sfp-N"` · **management** (`mgmt_only`, or a name containing *mgmt*) →
  `id="mgmt-K"`.
- Data ports numbered in **absolute** order `1..N` (fibre after copper);
  console/power/virtual/wireless interfaces are **dropped**.
- Every skin is validated with `lib/panel-skin.js` (`parsePanelSkin`) before it is
  saved.

The native rack renderer uses the same `frontPanel` data without introducing any
vendor-dependent classification. When a model combines a dense main row with a wide
SFP block, it automatically applies a compact visual mode: it shrinks the gaps and
the cells, removes the fixed offsets, and keeps copper, SFP/QSFP and MGMT ports
visible. The mode concerns CSS geometry only: it does not change the count, the
order, the numbering or the interface mapping.

## Known limits
- A **generic** 2-row layout: readable, but not 1:1 with the real physical panel
  (with SNMP anchored on `ifName`, the drawn number is cosmetic anyway).
- It handles `interfaces`; **`rear-ports` / the rear face** not yet (the
  `module-bays` of modular chassis are recognised by the role filter, but not
  drawn).
- A `u_height` of 0 or a fractional one (APs/antennas) is forced to 1U.

> Note: `skins/` is gitignored. Generated skins stay local; this tool regenerates
> them on demand from any set of CC0 YAML.

## Periodic catalog updates

The CC0 catalog is updated separately from the DCIM/IPAM import. The NetBox import
always uses the latest valid local catalog and never downloads the source during
the wizard.

In the **DCIM/IPAM synchronisation** window, an administrator sees the catalog
status and can use **Check for updates** or **Update catalog**. A viewer can read
the status but not start any operation. The update uses the same local script, does
not modify projects and sends no NetBox data. For the GitHub source the updater uses
a partial clone (`sparse checkout`): it fetches only `device-types/*.yaml` and
`device-types/*.yml`, not the repository's whole archive. The transfer timeout is
120 seconds; if Git is unavailable, the error is shown without replacing the
previous catalog.

```bash
# fetch the public source, generate the canonical and the runtime catalogs
npm run update-device-types

# analyse the source without writing any file
npm run update-device-types -- --dry

# check whether the local revision has changed (exit code 2 if an update exists)
npm run update-device-types -- --check

# use a local checkout, useful for development and for CI without network
npm run update-device-types -- --input=C:\path\to\devicetype-library

# use one precise revision of the source
npm run update-device-types -- --ref=<commit>

# rewrite ONLY the runtime catalog from the canonical one already on disk,
# with no network: this is what you want when the PROJECTION changes (new
# template fields) and the source does not. Manifest and diff are left alone.
npm run update-device-types -- --from-canonical

# write a differential report to an explicit path
npm run update-device-types -- --dry --report=data/device-types-review.json
```

The script generates:

- `data/device-types-canonical.json` with the full data and interfaces;
- `data/device-types.json` with the light templates the app uses;
  it includes power OUTLETS (name, type, and the group when the manufacturer
  writes it into the name: «Group 2 - Output 1» → group 2);
- `data/device-types-manifest.json` with source, commit, checksum and statistics;
- `data/device-types-diff.json` with models added, removed, changed and excluded.

Local corrections stay separate from the CC0 source:

- `data/device-types-aliases.json` to rename NetBox slugs that do not line up;
- `data/device-types-overrides.json` for verified hardware corrections;
- `data/device-types-exclusions.json` to explicitly exclude models from the runtime.

Overrides are applied to the runtime projection only; the canonical file always
keeps the original value. The command aborts the update if it finds incomplete
YAML, duplicate slugs, oversized files, symlinks, or an abnormal change in the
exclusions. `--strict-license` additionally enables the explicit CC0 licence check
on the local source.

The runtime uses the NetBox `device_type.slug` first, then aliases and normalised
brand/model. If the model is not found, the device and its interfaces remain
importable and viewable all the same; the report flags the fallback. A catalog
update never modifies existing projects on its own. If a project holds a node
imported under an earlier revision, the properties panel shows a **hardware sheet
updated** notice: the **Review / apply new sheet** action updates ports, front
panel and height only after explicit confirmation. The DCIM preview also
distinguishes the unreconciled cases from the objects the user excluded by hand.
