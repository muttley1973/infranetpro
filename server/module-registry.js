'use strict';
// ============================================================
//  Registro plugin-moduli (generico, feature-agnostico).
//
//  I moduli a pagamento vivono in modules/<name>/ (cartella gitignored,
//  consegnata a parte) e si agganciano al core tramite un contratto NEUTRO:
//  ogni modulo esporta function(app, ctx) e usa ctx per (a) dichiarare una
//  voce di menu e (b) registrare una pulizia dei propri file alla
//  cancellazione di un progetto. Il core NON sa cosa sia un modulo: qui non
//  compare nessun riferimento ad alcun modulo specifico.
// ============================================================
const fs   = require('fs');
const path = require('path');

const _nav = [];          // voci di menu: [{ label, path, icon }]
const _deleteHooks = [];  // callback (id) => void, chiamate a progetto eliminato

// Voce di navigazione dichiarata da un modulo (mostrata nell'header se presente).
function registerNav(entry) {
  if (!entry || typeof entry.path !== 'string' || !entry.path) return;
  _nav.push({
    label: String(entry.label || 'Module'),
    path:  entry.path,
    icon:  entry.icon ? String(entry.icon) : '',
  });
}

// Copia difensiva: il chiamante non puo' mutare lo stato interno.
function getNav() { return _nav.map((e) => ({ ...e })); }

// Un modulo registra una pulizia dei propri sidecar per quando un progetto
// viene eliminato (il core non sa quali file siano — restano nel modulo).
function registerProjectDeleteHook(fn) {
  if (typeof fn === 'function') _deleteHooks.push(fn);
}

// Eseguita dalla route DELETE progetto, dopo l'unlink del JSON: isola gli errori
// cosi' un hook difettoso non blocca gli altri ne' la cancellazione.
function runProjectDeleteHooks(id) {
  for (const fn of _deleteHooks) {
    try { fn(id); }
    catch (e) { console.error(`[modules] onProjectDelete: ${e.message}`); }
  }
}

// Autoloader: monta ogni modules/<name>/server/index.js presente in `dir`.
// Assenza della cartella o di un modulo = no-op silenzioso (deployment free).
function loadModules(app, ctx, dir) {
  const loaded = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return loaded; }               // nessuna cartella modules/ -> salta
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const entry = path.join(dir, d.name, 'server', 'index.js');
    if (!fs.existsSync(entry)) continue;
    try {
      const init = require(entry);
      if (typeof init === 'function') { init(app, ctx); loaded.push(d.name); }
    } catch (e) {
      console.error(`[modules] errore nel modulo ${d.name}: ${e.message}`);
    }
  }
  return loaded;
}

// Solo per i test: azzera lo stato del singleton.
function __resetForTests() { _nav.length = 0; _deleteHooks.length = 0; }

module.exports = {
  registerNav, getNav,
  registerProjectDeleteHook, runProjectDeleteHooks,
  loadModules, __resetForTests,
};
