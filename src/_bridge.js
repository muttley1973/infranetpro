// ============================================================
// PONTE DI MIGRAZIONE verso lo scope globale legacy.
//
// Finché la conversione a moduli ESM non è completa, i file glue ancora-classic
// (e gli handler inline dell'HTML) vivono su `window`. I moduli convertiti:
//   • leggono i globali ancora-legacy via `win.<nome>` (es. win.state, win.nodeById);
//   • pubblicano la propria API pubblica con expose({...}) così i chiamanti
//     legacy / gli onclick="" dell'HTML continuano a trovarli.
//
// A migrazione completa questo file sparisce: gli import diventano espliciti e
// l'unica esposizione su window resterà quella richiesta dagli handler inline.
// ============================================================
export const win = (typeof window !== 'undefined') ? window : globalThis;

/** Pubblica su window l'API pubblica di un modulo convertito (bridge legacy). */
export function expose(api) { Object.assign(win, api); }

// ---- Forward ai lib puri caricati come <script> PRIMA del bundle ------------
// REGOLA: un lib puro (lib/*.js, UMD-lite) che è già un <script> in netmapper.html
// e si auto-pubblica su window NON va importato dai moduli src/. Importarlo lo
// ri-bundla in dist/app.bundle.js: la sua UMD ri-esegue `Object.assign(window,…)`
// e — siccome il bundle è l'ULTIMO script — sovrascrive la copia "viva" con uno
// SNAPSHOT congelato al build. Per i18n questo significava dizionario stantio nei
// menu finché non si rifaceva `npm run build` (bug del 2026-06-16).
// Leggendoli dal ponte resta UNA sola istanza (quella del <script>), sempre
// fresca, il bundle non li duplica e modificarli non richiede rebuild.
// I forward sono per-chiamata (arrow) → sempre la versione live di window.
export const t                = (key, vars) => win.t(key, vars);            // lib/i18n.js
export const getLang          = ()          => win.getLang();               // lib/i18n.js
export const buildSpareReport = (...a)       => win.buildSpareReport(...a);  // lib/spare-ports.js
export const auditToCsv       = (...a)       => win.auditToCsv(...a);        // lib/audit-log.js
export const auditActionLabel = (...a)       => win.auditActionLabel(...a);  // lib/audit-log.js
// Costante: il <script> di audit-log.js gira prima del bundle → riferimento pronto.
export const ACTION_LABELS    = win.ACTION_LABELS;                          // lib/audit-log.js
export const parseDhcpLeases     = (...a) => win.parseDhcpLeases(...a);      // lib/dhcp-lease.js
export const reconcileDhcpLeases = (...a) => win.reconcileDhcpLeases(...a);  // lib/dhcp-lease.js
