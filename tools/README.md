# Import device-type YAML → InfraNet catalog / skins

`import-device-types.js` trasforma **dati YAML pubblici di device-type** (formato
`device-types/<Vendor>/<model>.yaml`, licenza **CC0-1.0** / pubblico dominio) in:

- un **catalogo di template nativi** InfraNet (`ports` + `frontPanel`), e/o
- **skin di pannello native**: SVG vettoriali con porte *vive* (`id="port-N"`).

## Perché così (licenza)
- I dati usati sono **CC0-1.0** (pubblico dominio): marca, modello, `u_height` ed
  elenco porte sono riusabili liberamente, anche in commercio, senza attribuzione.
- **NON** usiamo immagini di elevazione raster: sono senza id-porta (non
  diventerebbero LED vivi) e con provenienza incerta. Prendiamo solo il dato e
  **ridisegniamo l'artwork da zero**, così le porte restano interattive e nostre.

## Due modi d'uso

### A) Template NATIVI → "Applica modello" (CONSIGLIATO, look ESATTO)
Genera un **catalogo** di template nativi (`ports` + `frontPanel`: sfpCount/sfp2Count/
sfpStartNum/mgmtCount/sharedMediaSlots) che il **renderer di default** dell'app usa per disegnare
porte/SFP/MGMT esatte. È la strada giusta: nessun SVG, riusa il render nativo.

`sharedMediaSlots` descrive posizioni fisiche condivise da più media senza aumentare
il numero delle porte: `{ start: 10, count: 1, media: ["copper", "fiber"] }` è
uno slot dati unico compatibile con rame o fibra. Le correzioni hardware verificate
restano in `data/device-types-overrides.json`, senza regole dipendenti dal vendor.
```bash
node tools/import-device-types.js <inputDir> <outDir> --catalog=data/device-types.json
```
Filtri utili: `--vendors=A,B` (limita alle cartelle-vendor indicate) e `--roles`
(tiene solo apparati di rete: switch/router/AP/firewall/UPS-PDU/NAS/console;
scarta endpoint, server/blade e accessori, con report per-vendor tenuti/scartati).

Il file `data/device-types.json` è servito da `GET /api/device-types`; nell'app,
device → Proprietà → **Layout porte → "Applica modello"** (cerca marca/modello) setta
`ports`+`frontPanel` → il device si disegna esatto. Merge idempotente per slug (piu'
vendor si accumulano).

### B) Skin SVG custom (faceplate su misura)
```bash
# genera skin .svg + catalogo:
node tools/import-device-types.js <inputDir> <outDir>
# ...oppure installa le skin nello skin store del server:
node tools/import-device-types.js <inputDir> <outDir> --seed
```
Nota: la skin **non** riproduce le gabbie SFP/MGMT trasparenti del default (il render
skin forza il `fill`). Per il look esatto usa la strada A.
Con `--seed` le skin finiscono in `skins/<slug>.svg` + `skins/index.json` (lo skin
store letto da `GET /api/skins`): compaiono nel dropdown **Skin pannello** e col
match brand/model (il ✓). Il seed è **idempotente**: ri-eseguendolo rimuove prima
le skin preesistenti con stessa `(brand, model, face)`.

Output senza `--seed`: `<outDir>/<slug>.svg` (una per modello) + `<outDir>/catalog.json`
(brand, modello, u_height, conteggi porte).

## Come classifica e numera
- **rame** (`*base-t/tx`) → `id="port-N"` · **fibra** (`*sfp/qsfp/base-x`) →
  `id="sfp-N"` · **management** (`mgmt_only` o nome *mgmt*) → `id="mgmt-K"`.
- Porte dati numerate in ordine **assoluto** `1..N` (fibra dopo il rame);
  console/power/interfacce virtuali/wireless vengono **scartate**.
- Ogni skin è validata con `lib/panel-skin.js` (`parsePanelSkin`) prima di salvarla.

Il renderer nativo del rack usa gli stessi dati `frontPanel` senza introdurre una
classificazione dipendente dal vendor. Quando un modello combina una riga principale
densa con un blocco SFP ampio, applica automaticamente una modalità visuale compatta:
riduce gli spazi e le celle, rimuove gli spostamenti fissi e mantiene visibili le porte
rame, SFP/QSFP e MGMT. La modalità riguarda solo la geometria CSS: non modifica il
conteggio, l'ordine, la numerazione o il mapping delle interfacce.

## Limiti noti
- Layout **generico** a 2 righe: leggibile ma non 1:1 col pannello fisico reale
  (con l'ancoraggio SNMP all'`ifName`, il numero disegnato è comunque cosmetico).
- Gestisce `interfaces`; **`rear-ports` / faccia retro** non ancora (i `module-bays`
  dei chassis modulari sono riconosciuti dal filtro ruolo, ma non disegnati).
- `u_height` 0 o frazionario (AP/antenne) forzato a 1U.

> Nota: `skins/` è gitignored. Le skin generate restano locali; questo strumento
> le rigenera on-demand da qualunque set di YAML CC0.

## Aggiornamento periodico del catalogo

Il catalogo CC0 viene aggiornato separatamente dall'importazione DCIM/IPAM.
L'importazione NetBox usa sempre l'ultimo catalogo locale valido e non scarica
la sorgente durante il wizard.

Nella finestra **Sincronizzazione DCIM/IPAM**, l'amministratore vede lo stato
del catalogo e può usare **Controlla aggiornamenti** o **Aggiorna catalogo**.
Il viewer può consultare lo stato ma non avviare operazioni. L'aggiornamento
usa lo stesso script locale, non modifica i progetti e non invia dati NetBox.
Per la sorgente GitHub l'updater usa un clone parziale (`sparse checkout`):
scarica solo `device-types/*.yaml` e `device-types/*.yml`, non l'intero archivio
del repository. Il timeout del trasferimento è di 120 secondi; se Git non è
disponibile, l'errore viene mostrato senza sostituire il catalogo precedente.

```bash
# acquisisce la sorgente pubblica, genera canonico e runtime
npm run update-device-types

# analizza la sorgente senza scrivere file
npm run update-device-types -- --dry

# controlla se la revisione locale è cambiata (exit code 2 se c'è un aggiornamento)
npm run update-device-types -- --check

# usa una checkout locale, utile per sviluppo e CI senza rete
npm run update-device-types -- --input=C:\path\to\devicetype-library

# usa una revisione precisa della sorgente
npm run update-device-types -- --ref=<commit>

# riscrive SOLO il catalogo runtime dal canonico che hai già sul disco,
# senza rete: serve quando cambia la PROIEZIONE (nuovi campi nel template)
# e non la sorgente. Manifesto e diff non vengono toccati.
npm run update-device-types -- --from-canonical

# salva un report differenziale in un percorso esplicito
npm run update-device-types -- --dry --report=data/device-types-review.json
```

Lo script genera:

- `data/device-types-canonical.json` con dati e interfacce completi;
- `data/device-types.json` con i template leggeri usati dall'app;
  include le PRESE di alimentazione (nome, tipo, e il gruppo quando il
  costruttore lo scrive nel nome: «Group 2 - Output 1» → gruppo 2);
- `data/device-types-manifest.json` con sorgente, commit, checksum e statistiche;
- `data/device-types-diff.json` con modelli aggiunti, rimossi, modificati ed esclusi.

Le correzioni locali restano separate dalla sorgente CC0:

- `data/device-types-aliases.json` per rinominare slug NetBox non allineati;
- `data/device-types-overrides.json` per correzioni hardware verificate;
- `data/device-types-exclusions.json` per escludere esplicitamente modelli dal runtime.

Gli override sono applicati solo alla proiezione runtime; il canonico conserva
sempre il valore originale. Il comando interrompe l'aggiornamento se trova YAML
incompleti, slug duplicati, file troppo grandi, symlink o una variazione anomala
delle esclusioni. `--strict-license` abilita anche il controllo esplicito della
licenza CC0 nella sorgente locale.

Il runtime usa prima `device_type.slug` NetBox, poi alias e marca/modello
normalizzati. Se il modello non viene trovato, il device e le sue interfacce
restano comunque importabili e visualizzabili; il report segnala il fallback.
Un aggiornamento del catalogo non modifica automaticamente i progetti esistenti.
Se un progetto contiene un nodo importato con una revisione precedente, il pannello
proprietà mostra un avviso **scheda hardware aggiornata**: l'azione **Rivedi /
applica nuova scheda** aggiorna porte, front-panel e altezza solo dopo conferma
esplicita. La preview DCIM distingue inoltre i casi non riconciliati dagli oggetti
esclusi manualmente dall'utente.
