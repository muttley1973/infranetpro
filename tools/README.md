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

## Uso
```bash
# 1. procurati gli YAML di un produttore (repo pubblico CC0), es. MikroTik:
#    (una cartella con i file .yaml di device-types/<Vendor>/)

# 2. genera skin + catalogo in una cartella di output:
node tools/import-device-types.js <inputDir> <outDir>

# 3. ...oppure genera E installa direttamente nello skin store del server:
node tools/import-device-types.js <inputDir> <outDir> --seed
```
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
