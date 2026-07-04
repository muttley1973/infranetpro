#!/usr/bin/env node
'use strict';

/**
 * Update the Private Enterprise Numbers (PEN) database from the official IANA
 * registry. This is the SNMP-side twin of scripts/update-oui-db.js: it maps an
 * IANA enterprise number (the 7th arc of a sysObjectID, 1.3.6.1.4.1.<PEN>) to the
 * registrant organization, so vendor resolution from SNMP no longer depends on a
 * hand-maintained table. The curated PEN_VENDOR in server/classify.js still wins
 * for clean short names; this file catches everything else.
 *
 * Zero external dependencies: only Node built-ins (https, fs, path, process).
 *
 * Usage:
 *   node scripts/update-pen-db.js           # download + write data/pen-db.json
 *   node scripts/update-pen-db.js --dry     # show stats, do not write file
 *   node scripts/update-pen-db.js --quiet   # no progress logs
 *
 * Output schema (data/pen-db.json):
 *   {
 *     "version": "2026-07-04",
 *     "generatedAt": "2026-07-04T...Z",
 *     "source": "https://www.iana.org/assignments/enterprise-numbers/enterprise-numbers",
 *     "count": 60123,
 *     "entries": { "9": "Cisco Systems Inc.", "30065": "Arista Networks, Inc.", ... }
 *   }
 * Key = decimal PEN as string; value = registrant organization name.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SOURCE = 'https://www.iana.org/assignments/enterprise-numbers/enterprise-numbers';
const OUTPUT = path.resolve(__dirname, '..', 'data', 'pen-db.json');
const TIMEOUT_MS = 60_000;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry');
const QUIET = args.has('--quiet');

function log(msg) { if (!QUIET) console.log(msg); }
function warn(msg) { console.error(msg); }

function download(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: TIMEOUT_MS, headers: { 'User-Agent': 'InfraNet-Pro-PEN-Updater/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        return resolve(download(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout ${TIMEOUT_MS}ms for ${url}`)));
    req.on('error', reject);
  });
}

/**
 * Parse the IANA enterprise-numbers flat file. Each record is:
 *   <decimal PEN at column 0>
 *   \x20\x20<Organization>
 *   \x20\x20\x20\x20<Contact>
 *   \x20\x20\x20\x20\x20\x20<Email>
 * The decimal on its own line at column 0 identifies the record; the very next
 * non-empty line is the organization. Records with no/placeholder org are skipped.
 * Returns a plain object { "<pen>": "<org>" }.
 */
function parseIana(text) {
  const lines = String(text || '').split(/\r?\n/);
  const entries = {};
  for (let i = 0; i < lines.length; i++) {
    // A PEN line is a bare decimal with no leading whitespace (org/contact/email
    // lines are all indented, so they can never match).
    if (!/^\d+$/.test(lines[i])) continue;
    const pen = String(parseInt(lines[i], 10));
    const org = String(lines[i + 1] || '').trim();
    if (!org || org === '|' || /^-+\s*none\s*-+$/i.test(org)) continue;
    if (entries[pen] === undefined) entries[pen] = org;
  }
  return entries;
}

async function main() {
  log('InfraNet PEN database updater');
  log(`Source: ${SOURCE}`);
  log('');

  const text = await download(SOURCE);
  const entries = parseIana(text);
  const count = Object.keys(entries).length;
  log(`Parsed ${count.toLocaleString()} enterprise numbers`);

  if (count < 10000) {
    warn(`! Suspiciously few entries (${count}) — refusing to overwrite. Aborting.`);
    process.exit(2);
  }

  const now = new Date();
  const out = {
    version: now.toISOString().slice(0, 10),
    generatedAt: now.toISOString(),
    source: SOURCE,
    count,
    entries: Object.fromEntries(
      Object.entries(entries).sort(([a], [b]) => (parseInt(a, 10) - parseInt(b, 10)))
    ),
  };

  if (DRY_RUN) {
    log('Dry run — file not written.');
    log(`Sample: 9 -> ${entries['9'] || '(none)'} | 30065 -> ${entries['30065'] || '(none)'}`);
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 0) + '\n', 'utf8');
  const sizeKb = Math.round(fs.statSync(OUTPUT).size / 1024);
  log(`✔ Wrote ${OUTPUT} (${sizeKb.toLocaleString()} KB, ${count.toLocaleString()} entries)`);
}

if (require.main === module) {
  main().catch(err => {
    warn(`Fatal: ${err && err.stack || err}`);
    process.exit(1);
  });
}

module.exports = { parseIana, download };
