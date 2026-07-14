# Import public-domain device-type data → skin InfraNet

`import-device-types.js` trasforma i **dati** della
[public-domain device-type library](https://github.com/public-domain device-type library)
in **skin di pannello native InfraNet**: SVG vettoriali con porte *vive*
(`id="port-N"`) + un catalogo modelli.

## Perché così (licenza)
- La devicetype-library è **CC0-1.0** (pubblico dominio): i suoi **dati** (marca,
  modello, u_height, elenco porte) sono riusabili liberamente, anche in commercio.
- **NON** usiamo le sue *immagini* di elevazione: sono raster, **senza id-porta**
  (non diventerebbero LED vivi) e con provenienza incerta. Prendiamo solo il dato
  e **ridisegniamo l'artwork da zero**, così le porte restano interattive e nostre.

## Due modi d'uso

### A) Template NATIVI → "Applica modello" (CONSIGLIATO, look ESATTO)
Genera un **catalogo** di template nativi (`ports` + `frontPanel`: sfpCount/sfp2Count/
sfpStartNum/mgmtCount) che il **renderer di default** dell'app usa per disegnare
porte/SFP/MGMT esatte. È la strada giusta: nessun SVG, riusa il render nativo.
```bash
node tools/import-device-types.js <inputDir> <outDir> --catalog=data/device-types.json
```
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

## Limiti noti (PoC)
- Layout **generico** a 2 righe: leggibile ma non 1:1 col pannello fisico reale
  (con l'ancoraggio SNMP all'`ifName`, il numero disegnato è comunque cosmetico).
- Gestisce `interfaces`; **`rear-ports` / `module-bays` / faccia retro** non ancora.
- `u_height` 0 o frazionario (AP/antenne) forzato a 1U.

> Nota: `skins/` è gitignored. Le skin generate restano locali; questo strumento
> le rigenera on-demand da qualunque set di YAML CC0.
