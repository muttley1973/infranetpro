# Leaflet 1.9.4 (vendored)

The slippy-map library behind the **Geographic** view of the multi-site panel. Self-hosted
like Font Awesome: no CDN, no npm dependency, served from `/vendor/leaflet/` and loaded
only when someone opens that view.

| file | source | bytes | sha-256 |
|---|---|---|---|
| `leaflet.js` | `https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js` | 147171 | `5c9aecfc30e4564519dbdcddcc53a418227dcc7568e619e9762ddcec7609ed47` |
| `leaflet.css` | `https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css` | 10879 | `b570abbda963c60b4de4b4ff4b26f9326f53fb2ccf1461fdf0955ca094fb2539` |

Downloaded 2026-11-15, unmodified. License: BSD 2-Clause (see `LICENSE`).

- The CSS refers to `images/layers*.png` and `marker-icon.png`; they are **not** shipped on
  purpose — the view draws circle markers, uses no layers control and no default marker icon.
- The map tiles are **not** loaded from this library's defaults: they come from
  `/api/tiles/{z}/{x}/{y}.png`, a route of InfraNet's own server (see `server/tiles.js`), so the
  browser never talks to a third party.
- To update: replace both files, update this table, and run the test suite.
