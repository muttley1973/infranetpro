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

- **Famiglie** `--font-ui` e `--font-mono` — **APPLICATE** ovunque (31
  dichiarazioni). Prima non esistevano: `var(--font-mono, monospace)` e
  `var(--mono, monospace)` erano scritti in 7 punti ma **non definiti** da
  nessuna parte, e altri 20 dichiaravano `monospace` nudo → su Windows 27
  regole su 30 rendevano in Courier New e 3 in Consolas. Nessun `font-family`
  nuovo fuori da questi due token.
  - **Gli indirizzi non sono codice.** IP, CIDR, MAC e gateway si scrivono in
    `--font-ui` con `font-variant-numeric: tabular-nums` (le cifre restano
    incolonnate senza il tono da macchina da scrivere). La regola è **una
    sola**, in `02-base.css`, con l'elenco delle classi: undici dichiarazioni
    separate divergevano alla prima aggiunta.
  - Restano `--font-mono`: `<code>`/`<kbd>`, log, token API, `sysDescr` grezzo,
    le textarea dove si incolla una configurazione, e la serigrafia del rack
    (dove il monospazio serve a stare dentro una cella larga 4 px).
  - I controlli di modulo **non ereditano** il carattere: `input, textarea,
    select, button { font-family: inherit }` in `02-base.css`. Senza,
    un `<input>` fuori da `.prop-group` prende quello di sistema (Arial).

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
