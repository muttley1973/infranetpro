# styles/ — CSS modularizzato + design tokens

`style.css` (monolite ~1990 righe) è stato **spaccato** in partial ordinate,
caricate via `<link>` in `netmapper.html` **nell'ordine sotto** (l'ordine = la
cascata CSS: cambiare l'ordine cambia la resa). Servite da `server.js` via
`/styles/:file`. Lo split è stato verificato **byte-identico** (riconcatenazione
== `style.css` originale) e **pixel-perfect** (screenshot E2E before/after).

## Moduli (ordine di caricamento = cascata)

| # | file | contenuto |
|---|------|-----------|
| 01 | `01-tokens.css` | **Design tokens** (`:root`) + scheletro tema chiaro inerte |
| 02 | `02-base.css` | reset, body, header, project bar, toolbar buttons, search, save-dot |
| 03 | `03-layout.css` | workspace, divider floor/rack, sidebar (libreria), fisarmoniche |
| 04 | `04-floor-rack.css` | floor plan, rack view, righello U, floor nodes, porte, rack-device, stacking/HA, skin, MGMT |
| 05 | `05-cables-wifi.css` | cavi (trace/wireless), pannello Wi-Fi, porte radio, banner autolink/validazione |
| 06 | `06-panels.css` | SNMP poll, fisarmoniche Proprietà, tabella porte, popup porta, segmento condiviso, LAG |
| 07 | `07-modals.css` | zoom, modal generica, connection overlay, rack-icon su floor, discovery, auto-poll, toggle |
| 08 | `08-topology.css` | overlay/tooltip topologia, toast, legenda, pillole TRUNK/WLAN/ENDPOINT/VLAN, modalità instradamento |
| 09 | `09-user-theme.css` | user menu, disabilitazione viewer, modal utenti, override tema chiaro |

**Aggiungere CSS**: mettilo nel modulo del componente giusto. Un componente
nuovo e trasversale → nuovo file `NN-nome.css` + nuovo `<link>` nella posizione
di cascata corretta + (niente da fare lato server, la route `/styles/:file` è
generica).

## Design tokens (`01-tokens.css` → `:root`)

Già esistenti (non toccati): **colori** (`--bg-color`, `--panel-*`, `--text-*`,
`--accent`, stati `--active/fault/inactive/idle-color`), **superfici semantiche**
(`--surface-1/2/hover`, `--hairline`, `--accent-soft`, `--danger-soft`),
**ombre** (`--shadow-sm/md/lg`), **tipografia** (`--fs-xs…--fs-2xl`).

Aggiunti in questa sessione:

- **Raggi** `--radius-xs|sm|md|lg|xl|pill` (2/4/6/8/10/999 px) — **APPLICATI**
  in tutto il CSS (90 occorrenze). Outlier deliberati (1/3/5/7/12px) restano
  grezzi dove sono micro-aggiustamenti (LED porta, celle, badge).
- **Spaziatura** `--space-1…7` (2/4/6/8/12/16/24 px) — scala **going-forward**:
  usala per padding/margin/gap NUOVI. Il legacy si migra incrementalmente
  (alcuni 5/10px fuori griglia restano finché non si rivede il componente).
- **Z-index** `--z-base/sticky/overlay/dropdown/modal/toast/tooltip` — scala
  **semantica di guida**. I valori legacy sono ad-hoc (0…10000); NON rimappati
  in massa (riordinare lo stacking è rischioso → si fa per area, verificando).
- **Transizioni** `--transition-fast|base` (.12s/.15s) — guida per le durate.

### Regola
Per ogni valore **nuovo** usa un token. Niente colori di superficie, raggi o
(d'ora in poi) spaziature hardcoded: così un eventuale tema chiaro futuro si fa
"a regole" (un blocco `html[data-theme=light]` che ridefinisce solo i token).

## Verifica dopo modifiche
Le modifiche CSS osservabili vanno verificate nel browser reale:
`RUN_E2E=1 npm run e2e` (il boot fallisce su un 404 CSS) + confronto screenshot
se è un refactor a-resa-invariata.
