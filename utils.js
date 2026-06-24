'use strict';
// ============================================================
//  InfraNet Pro — Utility condivise
// ============================================================

/**
 * Timestamp leggibile nel formato "YYYY-MM-DD HH:MM:SS".
 * Usato da server.js e auth.js per created_at / updated_at.
 */
function timestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

module.exports = { timestamp };
