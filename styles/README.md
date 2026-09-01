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
| 02 | `02-base.css` | reset, body, header, project bar, toolbar buttons, search, stato «da salvare» del bottone Salva |
| 03 | `03-layout.css` | workspace, divider floor/rack, sidebar (libreria), fisarmoniche |
| 04 | `04-floor-rack.css` | floor plan, rack view, righello U, floor nodes, porte, rack-device, stacking/HA, skin, MGMT |
| 05 | `05-cables-wifi.css` | cavi (trace/wireless), pannello Wi-Fi, porte radio, banner autolink/validazione |
| 06 | `06-panels.css` | SNMP poll, fisarmoniche Proprietà, tabella porte, popup porta, segmento condiviso, LAG |
| 07 | `07-modals.css` | zoom, modal generica, connection overlay, rack-icon su floor, discovery, auto-poll, toggle |
| 08 | `08-topology.css` | overlay/tooltip topologia, toast, legenda, pillole TRUNK/WLAN/ENDPOINT/VLAN, modalità instradamento |
| 09 | `09-user-theme.css` | user menu, disabilitazione viewer, modal utenti, override tema chiaro |
| 10 | `10-modern.css` | sotto-header (`#modern-subbar`), briciole di percorso, chip di stato, reskin |
| 11 | `11-overview.css` | Panoramica/Dashboard: colonne, righe chiave→valore, verdetti, lenti |

**Aggiungere CSS**: mettilo nel modulo del componente giusto. Un componente
nuovo e trasversale → nuovo file `NN-nome.css` + nuovo `<link>` nella posizione
di cascata corretta + (niente da fare lato server, la route `/styles/:file` è
generica).

## Design tokens (`01-tokens.css` → `:root`)

Preesistenti: **colori** (`--bg-color`, `--panel-*`, `--text-*`, `--accent`,
stati `--active/fault/inactive/idle-color`), **superfici semantiche**
(`--surface-1/2/hover`, `--hairline`, `--accent-soft`, `--danger-soft`),
**ombre** (`--shadow-sm/md/lg`).

### La scala tipografica è APPLICATA, e una guardia la tiene (31/08/2026)

`--fs-xs…--fs-2xl` esistevano da sempre, e per anni sono stati usati **a metà**:
761 dichiarazioni `font-size`, il **45% fuori scala**, in **53 corpi distinti** —
di cui **31 stipati fra i 10 e i 16 px**. Trentuno gradini in sei millimetri non
sono una gerarchia: l'occhio non li distingue, e tutto quello che ci sta dentro
si appiattisce in «testo minore» indifferenziato.

**97 di quelle dichiarazioni riscrivevano a mano il valore di un token**
(`0.82rem` ventisette volte, mentre `--fs-sm` **è** 0.82rem): stesso pixel oggi,
pixel diverso il giorno in cui il token si muove. Ora usano il token, a resa
invariata (lo conferma il golden).

⭐ **E il resto del grappolo aveva una causa sola: mancava un gradino.** Sotto
`--fs-xs` (12 px) la scala non aveva **niente**, e **84 dichiarazioni** si erano
inventate lo stesso corpo in **sette scritture diverse** (`0.72rem` ×33, `11px`
×19, `0.7rem` ×18, `0.68rem` ×10, più le varianti senza lo zero iniziale). Non
erano sette misure: era **una** misura che nessuno poteva chiamare per nome. È
nato **`--fs-2xs`** (0.7rem ≈ 11 px) e le ha accorpate tutte — scarto massimo
**0,32 px**, fuori scala **267 → 183**, sulla scala dal 64% al **76%**.

⚠️ **La guardia ha preso in carico `0.7rem` DA SOLA**, nell'istante in cui il
token è nato, perché legge `01-tokens.css` invece di avere un elenco scritto a
mano. È il motivo per cui l'elenco non si scrive.

⚠️ **Le unità `em` restano fuori PER MISURA**: `0.9em` è relativo al **padre**,
non alla radice, quindi non è «`--fs-md` scritto a mano» e convertirlo
cambierebbe il disegno. Fuori anche `login.html` (non carica i token) ed
`export.js` (produce un documento **serializzato**, dove `var(--fs-*)` non
troverebbe chi lo definisce e il testo cadrebbe alla misura di default: lì il
letterale è la scelta giusta).

La guardia è `test/type-scale-ratchet.test.js`: tetto **zero** sui valori di
token riscritti a mano, e un cricchetto sul resto che può solo **calare**.
⚠️ I letterali proibiti si **derivano** leggendo `01-tokens.css`, non sono
elencati: un token aggiunto domani entra nella guardia da solo, mentre un elenco
resterebbe verde e cieco.

### Il colore di un badge non porta anche il suo inchiostro

I badge a fondo pieno scrivevano `color:#fff` fisso, e quattro dei dodici fondi
non reggevano il bianco — il peggiore a **2,03:1**, ed era proprio quello che
avverte «non fidarti di questo cavo». L'inchiostro ora lo sceglie `badgeInk()`
(`src/app-util.js`) confrontando i due contrasti, **senza cambiare un colore**.
⚠️ Nessuna soglia di luminanza: la prima versione ne usava una (0,45) e correggeva
un caso su quattro con la guardia contenta. Guardia: `test/badge-ink.test.js`,
che legge i fondi **dalle tabelle nel sorgente**.

Aggiunti nella sessione del 13/08/2026:

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
Per ogni valore **nuovo** usa un token. Niente colori di superficie, raggi,
**corpi del testo** o (d'ora in poi) spaziature hardcoded: così un eventuale tema
chiaro futuro si fa "a regole" (un blocco `html[data-theme=light]` che ridefinisce
solo i token). Sui corpi non è più una raccomandazione: c'è un cancello, e uno
`0.82rem` scritto a mano lo fa rosso indicandoti riga e token.

⚠️ Vale anche per il CSS scritto **inline dentro il JS**: è da lì che la scala si
era sfaldata (173 `font-size` nei template di `src/`, di cui solo 11 passavano da
un token). Il cancello guarda `netmapper.html` + `styles/*.css` + `src/*.js`, cioè
tutto quello che carica `01-tokens.css`.

## Verifica dopo modifiche
Le modifiche CSS osservabili vanno verificate nel browser reale:
`RUN_E2E=1 npm run e2e` (il boot fallisce su un 404 CSS) + confronto screenshot
se è un refactor a-resa-invariata.
