'use strict';
// ============================================================
// DOM STUB — ambiente browser finto, zero dipendenze (per smoke test)
// ============================================================
// Stub minimale e TOLLERANTE di window/document: ogni metodo DOM ignoto è un
// no-op, ogni proprietà è settabile, le query ritornano stub benigni. Scopo:
// far ESEGUIRE il codice glue (app.js + lib/app-*.js, pieni di innerHTML e
// getElementById) senza un browser, così lo smoke test cattura i CRASH
// (variabili/funzioni non definite, errori di logica) — non la fedeltà del DOM.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Elemento DOM finto: innerHTML/className/value/style sono campi liberi; i
// metodi comuni sono no-op; le query ritornano elementi/array vuoti.
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    nodeType: 1,
    innerHTML: '', outerHTML: '', textContent: '', value: '', id: '', title: '',
    className: '', checked: false, disabled: false, selected: false, hidden: false,
    scrollTop: 0, scrollLeft: 0, offsetWidth: 0, offsetHeight: 0,
    clientWidth: 0, clientHeight: 0, children: [], childNodes: [],
    parentNode: null, nextSibling: null, previousSibling: null, firstChild: null,
    style: new Proxy({}, { get: () => '', set: () => true }),
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; }, replace() {} },
  };
  el.appendChild = (c) => { el.children.push(c); if (c) c.parentNode = el; return c; };
  el.removeChild = (c) => { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; };
  el.insertBefore = (c) => { el.children.push(c); return c; };
  el.replaceChild = () => {};
  el.append = () => {}; el.prepend = () => {}; el.remove = () => {}; el.replaceWith = () => {};
  el.setAttribute = (k, v) => { if (k === 'id') el.id = v; };
  el.getAttribute = () => null;
  el.removeAttribute = () => {};
  el.hasAttribute = () => false;
  el.addEventListener = () => {}; el.removeEventListener = () => {}; el.dispatchEvent = () => true;
  el.querySelector = () => null;
  el.querySelectorAll = () => [];
  el.getElementsByClassName = () => [];
  el.getElementsByTagName = () => [];
  el.closest = () => null;
  el.matches = () => false;
  el.contains = () => false;
  el.focus = () => {}; el.blur = () => {}; el.click = () => {}; el.scrollIntoView = () => {};
  el.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  el.getContext = () => ({ measureText: () => ({ width: 0 }), fillRect() {}, clearRect() {}, beginPath() {}, stroke() {}, fill() {} });
  el.cloneNode = () => makeEl(tag);
  el.setAttributeNS = () => {};
  el.insertAdjacentHTML = () => {};
  return el;
}

// Crea un contesto vm con window/document/localStorage/… stubbati.
// window === il global del contesto, così i moduli UMD-lite che fanno
// Object.assign(window, api) espongono le funzioni come globali bare-name.
function makeBrowserContext() {
  const byId = new Map();
  const document = {
    getElementById(id) { if (!byId.has(id)) byId.set(id, makeEl('div')); return byId.get(id); },
    createElement: (t) => makeEl(t),
    createElementNS: (ns, t) => makeEl(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: t }),
    createDocumentFragment: () => makeEl('fragment'),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementsByClassName: () => [],
    getElementsByTagName: () => [],
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'),
    documentElement: makeEl('html'),
    head: makeEl('head'),
    cookie: '',
    activeElement: null,
    hidden: false,
    readyState: 'complete',
  };
  document.body.parentNode = document.documentElement;

  const storage = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), key: () => null, length: 0 };
  };

  const ctx = {
    console,
    document,
    localStorage: storage(),
    sessionStorage: storage(),
    navigator: { userAgent: 'smoke', language: 'it', clipboard: { writeText: () => Promise.resolve() } },
    location: { href: 'http://localhost/', origin: 'http://localhost', pathname: '/', reload() {}, assign() {}, replace() {} },
    history: { pushState() {}, replaceState() {}, back() {} },
    // rAF SINCRONO con guardia anti-ricorsione: i render rAF-coalesced girano
    // subito durante lo smoke, ma senza loop infiniti.
    requestAnimationFrame(cb) { if (ctx.__rafDepth > 50) return 0; ctx.__rafDepth++; try { cb(Date.now()); } finally { ctx.__rafDepth--; } return 0; },
    cancelAnimationFrame() {},
    setTimeout(cb) { return 0; },   // no-op: lo smoke non aspetta timer
    clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    queueMicrotask(cb) { try { cb(); } catch (_) {} },
    getComputedStyle: () => ({ getPropertyValue: () => '', width: '0px', height: '0px' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    alert() {}, confirm: () => true, prompt: () => null,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }), text: () => Promise.resolve('') }),
    FileReader: class { readAsText() {} readAsDataURL() {} },
    Blob: class {}, FormData: class {}, Image: class {},
    URL: { createObjectURL: () => 'blob:smoke', revokeObjectURL() {} },
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    __rafDepth: 0,
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return ctx;
}

// Estrae l'ordine reale degli script da netmapper.html (lib puri /lib, export.js, bundle /dist…)
function scriptOrderFromHtml(rootDir) {
  const html = fs.readFileSync(path.join(rootDir, 'netmapper.html'), 'utf8');
  const order = [];
  const re = /<script\s+src="(\/[^"]+\.js)"/g;
  let m;
  while ((m = re.exec(html)) !== null) order.push(m[1].replace(/^\//, ''));
  return order;
}

// Carica TUTTI gli script nell'ordine di netmapper.html, concatenati in UN solo
// programma vm (replica la condivisione del global lexical env tra <script>
// classici: let/const/function visibili tra file). Ritorna il contesto.
function loadApp(rootDir) {
  const ctx = makeBrowserContext();
  const files = scriptOrderFromHtml(rootDir);
  const parts = [];
  for (const f of files) {
    const p = path.join(rootDir, f);
    if (!fs.existsSync(p)) throw new Error(`Script referenziato da netmapper.html ma assente: ${f}`);
    parts.push(`/* ==== ${f} ==== */\n` + fs.readFileSync(p, 'utf8'));
  }
  vm.runInContext(parts.join('\n;\n'), ctx, { filename: 'netmapper-bundle.js' });
  return { ctx, files };
}

// Esegue codice nel contesto (accede a tutti i globali lexical: state, renderProps…).
function run(ctx, code) {
  return vm.runInContext(code, ctx, { filename: 'smoke-inline.js' });
}

module.exports = { makeBrowserContext, loadApp, scriptOrderFromHtml, run, makeEl };
