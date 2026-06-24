// ============================================================
// ENTRY del bundle frontend (esbuild → dist/app.bundle.js).
//
// Importa i moduli glue GIÀ convertiti a ESM. Ogni modulo si auto-pubblica su
// window (expose()) per coesistere con i file ancora-classic e con gli handler
// inline dell'HTML. Caricato come ULTIMO <script> in netmapper.html, dopo i
// classic script legacy: così i globali legacy esistono già quando il bundle
// gira, e le funzioni qui esportate sovrascrivono/forniscono quelle rimosse
// dalla lista classic.
//
// Man mano che la migrazione avanza, le righe `import` qui crescono e i
// corrispondenti <script src="/lib/app-*.js"> spariscono da netmapper.html.
// ============================================================
import './app-types.js';   // FOUNDATION: definisce TYPES (export const + expose) — per PRIMO
import './store.js';   // FOUNDATION: store dello stato condiviso (proxy window) — early
import './app-util.js';    // FOGLIA: helper puri (escapeHTML/uid) — importati da app.js
import './app.js';         // NUCLEO: stato (store.state) + core bootstrap — subito dopo i TYPES
import './app-auth.js';
import './app-search-zoom-rack.js';
import './app-shared-segment.js';
import './app-autolink.js';
import './app-snmp.js';
import './app-vlan-autopoll.js';
import './app-pointer.js';
import './app-render-core.js';
import './app-popup.js';
import './app-core.js';
import './app-cabling-editor.js';
import './app-audit.js';
import './app-spare.js';
import './app-management.js';
import './app-stack-ha.js';
import './app-panel-skin.js';
import './app-l3.js';
import './app-drift-adopt.js';
import './app-drift.js';
import './app-ports.js';
import './app-wifi.js';
import './app-hypervisor.js';
import './app-properties-floor.js';
import './app-properties-port.js';
import './app-properties-link.js';
import './app-properties.js';
import './app-properties-node-devices.js';
import './app-properties-node.js';
import './app-topology-crawl.js';
import './app-discovery-classify.js';
import './app-topology-discover.js';
import './app-discovery.js';
import './app-topology-overlay.js';
import './app-csv-import.js';
