'use strict';
// ============================================================
//  server/dcim/capabilities.js — flag runtime "export disponibile".
//
//  Il modulo a pagamento modules/dcim-export/ chiama setExportAvailable(true)
//  al caricamento. Il client interroga GET /api/integrations/dcim/capabilities
//  e nasconde l'Esporta se il flag è falso. Nel build FREE la cartella modules/
//  è assente → il flag resta false → nessuna scrittura verso il DCIM esposta.
// ============================================================
let _exportAvailable = false;

function setExportAvailable(v) { _exportAvailable = !!v; }
function isExportAvailable() { return _exportAvailable; }

module.exports = { setExportAvailable, isExportAvailable };
