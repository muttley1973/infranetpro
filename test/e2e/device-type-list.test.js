'use strict';
// ============================================================
// E2E «APPLICA MODELLO»: L'ELENCO SEGUE IL TIPO DEL DISPOSITIVO (Chrome vero, catalogo vero)
// ============================================================
// Il campo «Applica modello» suggeriva i 5.616 modelli del catalogo a QUALUNQUE dispositivo: a uno switch anche i
// firewall, i PDU, gli access point. Ora a uno switch si propongono gli switch (e i modelli che il catalogo non sa
// classificare), a un firewall i firewall, a un UPS gli UPS; un tipo senza una classe propria (un server) vede tutto, e
// «Mostra tutti i modelli» li ridà tutti agli altri. Il catalogo e' quello VERO servito dal server di prova: cosi' si
// prova anche che i ruoli scritti dal generatore arrivano al browser.
// OFF di default come gli altri e2e: RUN_E2E=1.
const test = require('node:test');
const assert = require('node:assert');

const RUN = process.env.RUN_E2E === '1';
const SKIP = RUN ? false : 'E2E headless OFF (RUN_E2E=1 per attivarlo; richiede Chrome di sistema)';

let chromium, startServer;
if (RUN) {
  ({ chromium } = require('playwright-core'));
  ({ startServer } = require('./helpers/server.js'));
}

test('E2E «Applica modello»: l\'elenco segue il tipo, «Mostra tutti» li ridà tutti, un modello scritto a mano si applica comunque', { skip: SKIP }, async () => {
  const srv = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await page.goto(srv.baseURL, { waitUntil: 'load' });
    await page.waitForFunction(() => { try { return typeof renderAll === 'function' && Array.isArray(state.nodes); } catch (e) { return false; } }, null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-pid]').length > 10, null, { timeout: 15000 });
    await page.waitForFunction(() => document.getElementById('devtype-options') && document.getElementById('devtype-options').children.length > 1000, null, { timeout: 15000 });
    const totale = await page.evaluate(() => document.getElementById('devtype-options').children.length);
    assert.ok(totale > 1000, 'il catalogo vero e\' caricato');
    // ⚠️ Il catalogo si AGGIORNA: i modelli di prova si scelgono dal catalogo servito, per RUOLO, non per nome — un
    // aggiornamento che toglie un modello noto non deve far cadere la prova.
    const cat = await page.evaluate(() => fetch('/api/device-types').then((r) => r.json()));
    const nome = (c) => c.brand + ' ' + c.model;
    const pick = (role) => { const c = cat.find((x) => x.role === role); assert.ok(c, `nel catalogo servito non c'e' nessun modello di ruolo «${role}»: il generatore non scrive i ruoli?`); return c; };
    const SWE = pick('switch'), FWE = pick('firewall'), RTE = pick('router'), PWE = pick('power'), NASE = pick('nas');
    const SW = nome(SWE), FW = nome(FWE), RT = nome(RTE), PW = nome(PWE), NAS = nome(NASE);

    await page.evaluate(() => {
      state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
      state.racks = [{ id: 'r1', name: 'Rack', sizeU: 12 }]; state.currentRack = 'r1';
      state.nodes = []; state.links = []; state.ports = {};
      const mk = (id, type, u) => state.nodes.push({ id, type, name: id, ports: 8, rackId: 'r1', rackU: u, sizeU: 1 });
      mk('sw1', 'switch', 1); mk('fw1', 'firewall', 2); mk('rt1', 'router', 3); mk('ups1', 'ups', 4); mk('srv1', 'server', 5); mk('nas1', 'nas', 6);
      if (typeof _invalidateIdx === 'function') _invalidateIdx();
      document.body.classList.remove('view-overview');
      _renderAllNow();
    });
    const apri = async (id) => {
      await page.evaluate((nid) => { window._propsExplicit = true; selType = 'node'; selId = nid; renderProps(); }, id);
      await page.waitForSelector('input[data-change="apply-device-type"]', { timeout: 8000 });
    };
    const elenco = async () => {
      const r = await page.evaluate(() => {
        const inp = document.querySelector('input[data-change="apply-device-type"]');
        const dl = document.getElementById(inp.getAttribute('list'));
        const opts = [...dl.children].map((o) => o.value);
        return { list: inp.getAttribute('list'), n: opts.length, opts,
          scope: (document.querySelector('.devtype-scope') || {}).textContent || '', toggle: !!document.querySelector('input[data-change="devtype-show-all"]') };
      });
      r.opts = new Set(r.opts);   // un Set non attraversa page.evaluate
      return r;
    };
    const ha = (e, nome) => e.opts.has(nome);

    // — switch: gli switch, non i firewall né i router
    await apri('sw1');
    let e = await elenco();
    assert.strictEqual(e.list, 'devtype-options-switch');
    assert.ok(ha(e, SW), 'uno switch');
    assert.ok(!ha(e, FW), 'un firewall non e\' proposto a uno switch');
    assert.ok(!ha(e, RT), 'un router non e\' proposto a uno switch');
    assert.ok(!ha(e, PW) && !ha(e, NAS), 'ne\' un PDU/UPS ne\' un NAS');
    assert.ok(e.n < totale && e.n > 0, `elenco piu' stretto del catalogo: ${e.n} su ${totale}`);
    assert.match(e.scope, new RegExp(String(e.n)), 'la riga dice quanti modelli ci sono');
    assert.strictEqual(e.toggle, true);

    // — firewall e router
    await apri('fw1'); e = await elenco();
    assert.strictEqual(e.list, 'devtype-options-firewall');
    assert.ok(ha(e, FW) && !ha(e, SW) && !ha(e, RT));
    await apri('rt1'); e = await elenco();
    assert.strictEqual(e.list, 'devtype-options-router');
    assert.ok(ha(e, RT) && !ha(e, FW) && !ha(e, SW));

    // — UPS: solo l'alimentazione (nessun apparato di rete)
    await apri('ups1'); e = await elenco();
    assert.strictEqual(e.list, 'devtype-options-power');
    assert.ok(ha(e, PW) && e.n < totale, `elenco dell'alimentazione: ${e.n}`);
    for (const x of [SW, FW, RT, NAS]) assert.ok(!ha(e, x), x);

    // — NAS: solo i NAS
    await apri('nas1'); e = await elenco();
    assert.strictEqual(e.list, 'devtype-options-nas');
    assert.ok(ha(e, NAS) && !ha(e, SW) && !ha(e, PW));

    // — un server non ha una classe propria nel catalogo: vede tutto, senza riga ne' interruttore
    await apri('srv1'); e = await elenco();
    assert.strictEqual(e.list, 'devtype-options');
    assert.strictEqual(e.n, totale);
    assert.strictEqual(e.scope, '');
    assert.strictEqual(e.toggle, false);

    // — «Mostra tutti i modelli»: li ridà tutti a uno switch, e l'interruttore resta acceso passando ad altri dispositivi
    await apri('sw1');
    await page.check('input[data-change="devtype-show-all"]');
    await page.waitForFunction(() => document.querySelector('input[data-change="apply-device-type"]').getAttribute('list') === 'devtype-options');
    e = await elenco();
    assert.strictEqual(e.n, totale, 'tutti i modelli');
    assert.ok(ha(e, FW), 'ora anche un firewall');
    assert.strictEqual(e.scope, '', 'niente riga «Elenco per…» quando si vede tutto');
    assert.strictEqual(await page.isChecked('input[data-change="devtype-show-all"]'), true);
    await apri('fw1'); e = await elenco();
    assert.strictEqual(e.n, totale, 'resta acceso su un altro dispositivo');
    await page.uncheck('input[data-change="devtype-show-all"]');
    await page.waitForFunction(() => document.querySelector('input[data-change="apply-device-type"]').getAttribute('list') === 'devtype-options-firewall');
    e = await elenco();
    assert.ok(e.n < totale, 'spento: torna l\'elenco del tipo');

    // — il catalogo si AGGIORNA mentre l'app e' aperta: gli elenchi per tipo non restano quelli di prima. Qui il catalogo
    //   nuovo e' uno «vecchio» (senza `role`: nessuno sa di che tipo sia ciascuno) → a uno switch si propone tutto; poi torna.
    await apri('sw1');
    await page.evaluate(() => {
      window.__fetchPrima = window.fetch;
      window.fetch = (u, o) => (String(u).indexOf('/api/device-types') >= 0
        ? window.__fetchPrima(u, o).then((r) => r.json()).then((l) => new Response(JSON.stringify(l.map((c) => { const x = Object.assign({}, c); delete x.role; return x; }))))
        : window.__fetchPrima(u, o));
      window.dispatchEvent(new Event('infranet:catalog-updated'));
    });
    await page.waitForFunction((n) => { const i = document.querySelector('input[data-change="apply-device-type"]'); const d = i && document.getElementById(i.getAttribute('list')); return d && d.children.length === n; }, totale, { timeout: 8000 });
    e = await elenco();
    assert.strictEqual(e.n, totale, 'catalogo senza ruoli: nessun modello nascosto');
    await page.evaluate(() => { window.fetch = window.__fetchPrima; window.dispatchEvent(new Event('infranet:catalog-updated')); });
    await page.waitForFunction((n) => { const i = document.querySelector('input[data-change="apply-device-type"]'); const d = i && document.getElementById(i.getAttribute('list')); return d && d.children.length > 0 && d.children.length < n; }, totale, { timeout: 8000 });
    e = await elenco();
    assert.ok(ha(e, SW) && !ha(e, FW), 'il catalogo con i ruoli rimette l\'elenco del tipo');

    // — l'elenco e' un SUGGERIMENTO: un modello scritto a mano, anche di un altro tipo, si applica comunque
    await apri('sw1');
    await page.evaluate((v) => {
      const inp = document.querySelector('input[data-change="apply-device-type"]');
      inp.value = v;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }, FW);
    await page.waitForFunction((m) => { const n = nodeById('sw1'); return n && n.model === m; }, FWE.model, { timeout: 5000 });
    assert.strictEqual(await page.evaluate(() => nodeById('sw1').brand), FWE.brand, 'l\'elenco non e\' un divieto');

    assert.deepStrictEqual(errs, [], 'nessun errore in console');
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
