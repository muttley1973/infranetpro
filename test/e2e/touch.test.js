'use strict';
// ============================================================
// E2E TOUCH — l'app usata col dito (tablet), in un Chrome vero con tocco emulato.
//
// Perché un file a parte e non un flusso di critical-flows: qui il contesto del
// browser ha `hasTouch` (media `(pointer: coarse)` e `(hover: none)` veri, eventi
// Pointer di tipo 'touch'), che il contesto degli altri flussi non ha. E tiene
// fuori dal conto dei flussi (README / badge) un insieme che ha un'altra natura.
//
// Le dita sono SINTETICHE, via CDP `Input.dispatchTouchEvent`. Due regole del
// protocollo che costano un giro a chi non le sa:
//   • per ALZARE UN DITO si manda `touchEnd` con QUEL punto; un `touchMove` con un
//     punto solo NON lo solleva (il dito resta giu', e il test misura un pinch
//     ancora in corso credendo che sia finito);
//   • `touchEnd` con l'elenco vuoto alza TUTTE le dita rimaste.
//
// Cosa NON copre, e va detto: il Safari di iPad (gesture* + pointer events insieme)
// e un tablet vero (dimensione del polpastrello, latenza). Si prova sul dispositivo.
//
// OFF di default come l'altro e2e: RUN_E2E=1.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');

const RUN = process.env.RUN_E2E === '1';
const SKIP = RUN ? false : 'E2E headless OFF (RUN_E2E=1 per attivarlo; richiede Chrome di sistema)';

let chromium, startServer;
if (RUN) {
  ({ chromium } = require('playwright-core'));
  ({ startServer } = require('./helpers/server.js'));
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;

test('E2E tocco: pan, pinch, tap e divisori col dito (tablet, Chrome emulato)', { skip: SKIP }, async (t) => {
  const srv = await startServer();
  const ciArgs = process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ciArgs });
  // Un tablet in orizzontale: la palette, la mappa e il pannello destro tutti visibili.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

  try {
    await page.goto(srv.baseURL, { waitUntil: 'load' });
    await page.waitForFunction(() => {
      try { return typeof renderAll === 'function' && Array.isArray(state.nodes); } catch (e) { return false; }
    }, null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-pid]').length > 10, null, { timeout: 15000 });

    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    // Due frame: il tempo che i gesti (rAF) impiegano ad arrivare al DOM e allo stato.
    // La storia di annulla/ripeti: un trascinamento "armato" (oltre la soglia) ne scrive una voce,
    // un tap no. E' l'unica traccia che l'aggancio alla griglia non cancella: 8px di spostamento
    // su una griglia da 20 tornano alla posizione di prima.
    const hist = () => page.evaluate(() => (window._history || []).length + ':' + window._histIdx);
    // Il pannello Proprieta' si apre con un doppio tap: se un secondo dito arrivasse all'app
    // sulla stessa stanza del primo, sarebbe letto proprio cosi'.
    const panel = () => page.evaluate(() => ({ tab: window._rightTab, explicit: !!window._propsExplicit }));
    const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const view = () => page.evaluate(() => ({ x: state.floorView.x, y: state.floorView.y, z: state.floorView.zoom }));
    const resetView = async () => {
      await page.evaluate(() => { state.floorView.zoom = 1; state.floorView.x = 0; state.floorView.y = 0; updateTransforms(); });
      await frames();
    };
    // Un punto in cui, ORA, sotto il dito c'e' davvero lo sfondo della mappa.
    // Con `half` > 0 il punto e' il CENTRO di due dita a ±half: entrambe sullo sfondo.
    const findEmpty = (half = 0) => page.evaluate((h) => {
      const fp = document.getElementById('floorplan').getBoundingClientRect();
      const bare = (x, y) => { const el = document.elementFromPoint(x, y); return !!el && (el.id === 'floorplan' || el.id === 'floorplan-grid'); };
      for (let y = fp.y + 120; y < fp.y + fp.height - 80; y += 20) {
        for (let x = fp.x + 120 + h; x < fp.x + fp.width - 120 - h; x += 20) {
          if (bare(x - h, y) && bare(x + h, y)) return { x, y };
        }
      }
      return null;
    }, half);
    // Un punto sul CORPO di una stanza: niente porte, niente maniglie. (Su un apparato
    // da pavimento il corpo e' quasi tutta la porta, e un dito atterra sulla porta.)
    const findRoom = () => page.evaluate(() => {
      const fp = document.getElementById('floorplan').getBoundingClientRect();
      for (const el of document.querySelectorAll('.floor-struct')) {
        const r = el.getBoundingClientRect();
        for (let y = r.y + r.height - 12; y > r.y + 12; y -= 18) {
          for (let x = r.x + 12; x < r.x + r.width - 12; x += 18) {
            if (x > fp.right - 20 || y > fp.bottom - 20) continue;
            const top = document.elementFromPoint(x, y);
            if (top && top.closest('.floor-struct') === el && !top.closest('.floor-node') && !top.closest('[data-pid]') && !top.closest('.resize-handle')) {
              const n = nodeById(el.dataset.id);
              return { id: el.dataset.id, x, y, nx: n.x, ny: n.y };
            }
          }
        }
      }
      return null;
    });
    // Un gesto a un dito: giù, una serie di spostamenti, su.
    const oneFinger = async (from, to, steps = 8) => {
      await touch('touchStart', [{ x: from.x, y: from.y, id: 1 }]);
      for (let i = 1; i <= steps; i++) {
        await touch('touchMove', [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps, id: 1 }]);
        await frames();
      }
      await touch('touchEnd', []);
      await frames();
    };
    // Un punto sul CORPO di un apparato del rack (non su una porta), con la sua unita' di partenza.
    const findRackDevice = () => page.evaluate(() => {
      for (const el of document.querySelectorAll('#rack-viewport .rack-device')) {
        const r = el.getBoundingClientRect();
        if (!(r.width > 40 && r.height > 8)) continue;
        for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8]) {
          for (const fy of [0.5, 0.3, 0.7]) {
            const x = r.x + r.width * fx, y = r.y + r.height * fy;
            const top = document.elementFromPoint(x, y);
            if (top && top.closest('.rack-device') === el && !top.closest('[data-pid]') && !top.closest('.rack-ports')) {
              const n = nodeById(el.dataset.id);
              return { id: el.dataset.id, x, y, rackU: n.rackU, unitPx: r.height / (n.sizeU || 1) };
            }
          }
        }
      }
      return null;
    });
    // L'unita' di TUTTI gli apparati del rack: un trascinamento puo' spingerne altri (risoluzione delle sovrapposizioni).
    const rackSnap = () => page.evaluate(() => state.nodes.filter((n) => n.rackU !== undefined).map((n) => n.id + ':' + n.rackU).join(','));
    const rackRestore = (snap) => page.evaluate((s) => {
      for (const p of s.split(',')) { const [id, u] = p.split(':'); const n = nodeById(id); if (n) n.rackU = Number(u); }
      renderAll();
    }, snap);
    // Un pinch simmetrico attorno a `mid`: la distanza fra le dita va da 2*h0 a 2*h1.
    const pinch = async (mid, h0, h1, steps = 10, drift = { x: 0, y: 0 }) => {
      const at = (h, i) => [
        { x: mid.x - h + drift.x * i / steps, y: mid.y + drift.y * i / steps, id: 1 },
        { x: mid.x + h + drift.x * i / steps, y: mid.y + drift.y * i / steps, id: 2 },
      ];
      await touch('touchStart', at(h0, 0));
      for (let i = 1; i <= steps; i++) { await touch('touchMove', at(h0 + (h1 - h0) * i / steps, i)); await frames(); }
      await touch('touchEnd', []);
      await frames();
    };

    const fpRect = await page.evaluate(() => { const r = document.getElementById('floorplan').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    // Il centro del pinch sta DENTRO la mappa, con entrambe le dita (altrimenti un dito
    // finisce sul pannello e il gesto, giustamente, non e' un pinch).
    const mid = { x: fpRect.x + fpRect.w * 0.45, y: fpRect.y + fpRect.h * 0.5 };

    await t.test('ambiente: dito vero (pointer coarse, niente hover) e la mappa non lascia il gesto al browser', async () => {
      const env = await page.evaluate(() => ({
        coarse: matchMedia('(pointer: coarse)').matches,
        hoverNone: matchMedia('(hover: none)').matches,
        mapTA: getComputedStyle(document.getElementById('floorplan')).touchAction,
        rackTA: getComputedStyle(document.getElementById('rack-viewport')).touchAction,
        divTA: getComputedStyle(document.getElementById('sidebar-divider')).touchAction,
        divW: document.getElementById('sidebar-divider').getBoundingClientRect().width,
      }));
      assert.ok(env.coarse && env.hoverNone, 'il contesto di prova non emula un dito: ' + JSON.stringify(env));
      // Senza `touch-action: none` il browser usa il trascinamento per scorrere la pagina e al
      // primo spostamento manda pointercancel: la mappa non si muoverebbe mai.
      assert.equal(env.mapTA, 'none', '#floorplan deve avere touch-action: none');
      assert.equal(env.rackTA, 'none', '#rack-viewport deve avere touch-action: none');
      assert.equal(env.divTA, 'none', 'i divisori devono avere touch-action: none');
      assert.equal(Math.round(env.divW), 18, 'il divisore e\' largo 18px col dito (6px col mouse)');
    });

    await t.test('un dito sul vuoto sposta la mappa quanto si muove il dito', async () => {
      await resetView();
      const e = await findEmpty();
      assert.ok(e, 'serve un punto vuoto sulla mappa');
      const v0 = await view();
      await oneFinger(e, { x: e.x + 80, y: e.y + 48 });
      const v1 = await view();
      assert.ok(near(v1.x - v0.x, 80, 3) && near(v1.y - v0.y, 48, 3), 'dx/dy: ' + (v1.x - v0.x) + '/' + (v1.y - v0.y));
    });

    await t.test('tap sul vuoto deseleziona; una panoramica no', async () => {
      await resetView();
      let e = await findEmpty();
      await page.evaluate(() => { window.selType = 'node'; window.selId = state.nodes[0].id; });
      await oneFinger(e, { x: e.x + 72, y: e.y });
      assert.ok(await page.evaluate(() => window.selId), 'una panoramica non deve togliere la selezione (e il filtro VLAN)');
      await resetView();
      e = await findEmpty();
      await touch('touchStart', [{ x: e.x, y: e.y, id: 1 }]);
      await touch('touchEnd', []);
      await frames();
      assert.equal(await page.evaluate(() => window.selId), null, 'un tap sul vuoto deseleziona');
    });

    await t.test('tap con tremolio (<10px): seleziona e non sposta', async () => {
      await resetView();
      const r = await findRoom();
      assert.ok(r, 'serve una stanza sulla mappa');
      const hist0 = await hist();
      await touch('touchStart', [{ x: r.x, y: r.y, id: 1 }]);
      await touch('touchMove', [{ x: r.x + 7, y: r.y + 5, id: 1 }]);   // 8,6px: sotto i 10 del dito, SOPRA i 5 del mouse
      await frames();
      await touch('touchEnd', []);
      await frames();
      const tap = await page.evaluate((id) => ({ sel: window.selId, x: nodeById(id).x, y: nodeById(id).y }), r.id);
      assert.equal(tap.sel, r.id, 'il tap seleziona la stanza');
      assert.ok(tap.x === r.nx && tap.y === r.ny, 'un dito che trema non sposta la stanza');
      assert.equal(await hist(), hist0, "e non scrive nella storia (nessun trascinamento armato: la soglia del dito e' 10px, non 5)");

    });

    await t.test('senza pressione lunga un dito che parte da una stanza fa scorrere la MAPPA e la stanza non si muove', async () => {
      await resetView();
      await page.waitForTimeout(450);   // oltre i 350ms del doppio tap, altrimenti il secondo gesto e' un doppio tap
      const r = await findRoom();
      const hist0 = await hist();
      const v0 = await view();
      await oneFinger({ x: r.x, y: r.y }, { x: r.x + 120, y: r.y + 60 });
      const after = await page.evaluate((id) => ({ x: nodeById(id).x, y: nodeById(id).y }), r.id);
      const v1 = await view();
      assert.ok(after.x === r.nx && after.y === r.ny, 'la stanza non deve spostarsi: afferrarla richiede la pressione lunga');
      assert.ok(near(v1.x - v0.x, 120, 3) && near(v1.y - v0.y, 60, 3), 'scorre la mappa, di quanto si muove il dito: ' + (v1.x - v0.x) + '/' + (v1.y - v0.y));
      assert.equal(await hist(), hist0, 'e non scrive nella storia');
      await resetView();
    });

    await t.test('con la pressione lunga la stanza si SOLLEVA e poi segue il dito', async () => {
      await resetView();
      await page.waitForTimeout(450);
      const r = await findRoom();
      await touch('touchStart', [{ x: r.x, y: r.y, id: 1 }]);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.touch-lifted').length), 0, 'appena toccata non e\' ancora afferrata');
      await page.waitForTimeout(380);
      assert.equal(await page.evaluate((id) => document.querySelector('.floor-struct[data-id="' + id + '"]').classList.contains('touch-lifted'), r.id), true,
        'tenuta premuta, la stanza si solleva: senza un segno non si saprebbe se il gesto e\' stato preso');
      for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: r.x + i * 15, y: r.y + i * 8, id: 1 }]); await frames(); }
      await touch('touchEnd', []);
      await frames();
      const moved = await page.evaluate((id) => ({ x: nodeById(id).x, y: nodeById(id).y, lifted: document.querySelectorAll('.touch-lifted').length }), r.id);
      assert.ok(moved.x !== r.nx || moved.y !== r.ny, 'afferrata, la stanza segue il dito');
      assert.equal(moved.lifted, 0, 'al rilascio il segno sparisce');
      await page.evaluate(([id, x, y]) => { const n = nodeById(id); n.x = x; n.y = y; renderAll(); }, [r.id, r.nx, r.ny]);
      await frames();
    });

    await t.test("un pinch che parte DOPO la pressione lunga lascia la stanza com'era e toglie il segno di sollevata", async () => {
      await resetView();
      await page.waitForTimeout(450);
      const r = await findRoom();
      const z0 = (await view()).z;
      await touch('touchStart', [{ x: r.x, y: r.y, id: 1 }]);
      await page.waitForTimeout(380);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.touch-lifted').length), 1, 'prima del secondo dito la stanza e\' sollevata');
      await touch('touchStart', [{ x: r.x, y: r.y, id: 1 }, { x: r.x + 90, y: r.y + 10, id: 2 }]);
      for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: r.x - i * 8, y: r.y, id: 1 }, { x: r.x + 90 + i * 20, y: r.y + 10, id: 2 }]); await frames(); }
      assert.equal(await page.evaluate(() => document.querySelectorAll('.touch-lifted').length), 0, 'il pinch toglie il segno: altrimenti resterebbe sollevata per sempre');
      await touch('touchEnd', []);
      await frames();
      const after = await page.evaluate((id) => ({ x: nodeById(id).x, y: nodeById(id).y, z: state.floorView.zoom }), r.id);
      assert.ok(after.x === r.nx && after.y === r.ny && after.z > z0 * 1.5, 'la stanza non si muove e la mappa zooma: ' + JSON.stringify(after));
      await resetView();
    });

    await t.test('pinch: zoom ×4 con il punto sotto le dita FERMO, poi ÷3, e il tetto a 5', async () => {
      await resetView();
      const v0 = await view();
      const panel0 = await panel();
      const before = { x: (mid.x - fpRect.x - v0.x) / v0.z, y: (mid.y - fpRect.y - v0.y) / v0.z };
      await pinch(mid, 40, 160);                                    // dita da 80 a 320px: ×4
      const v1 = await view();
      const after = { x: (mid.x - fpRect.x - v1.x) / v1.z, y: (mid.y - fpRect.y - v1.y) / v1.z };
      assert.ok(near(v1.z / v0.z, 4, 0.1), 'zoom ×4: ' + v1.z);
      assert.ok(near(before.x, after.x, 1) && near(before.y, after.y, 1), 'il punto sotto il centro delle dita deve restare lo stesso: ' + JSON.stringify({ before, after }));
      assert.ok(!(await page.evaluate(() => window.isPanningFloor || window.dragNode)), 'nessun gesto di panoramica o trascinamento resta armato');
      assert.deepEqual(await panel(), panel0, "due dita sulla STESSA stanza non sono un doppio tap: le Proprieta' non si aprono");

      await resetView();
      const w0 = await view();
      await pinch(mid, 150, 50, 10, { x: 40, y: 30 });             // ÷3 mentre il centro si sposta
      const w1 = await view();
      assert.ok(near(w0.z / w1.z, 3, 0.15), 'zoom ÷3: ' + w1.z);

      await resetView();
      await pinch(mid, 20, 260, 8);                                 // molto oltre ×5
      assert.ok((await view()).z <= 5.0001, 'lo zoom non supera 5');
      await resetView();
    });

    await t.test('pinch che parte da una stanza: la stanza non si muove, la mappa zooma', async () => {
      await resetView();
      await page.waitForTimeout(450);
      const r = await findRoom();
      const z0 = (await view()).z;
      const panel0 = await panel();
      await touch('touchStart', [{ x: r.x, y: r.y, id: 1 }]);
      await touch('touchStart', [{ x: r.x, y: r.y, id: 1 }, { x: r.x + 90, y: r.y + 10, id: 2 }]);
      for (let i = 1; i <= 8; i++) {
        await touch('touchMove', [{ x: r.x - i * 8, y: r.y, id: 1 }, { x: r.x + 90 + i * 20, y: r.y + 10, id: 2 }]);
        await frames();
      }
      await touch('touchEnd', []);
      await frames();
      const after = await page.evaluate((id) => ({ x: nodeById(id).x, y: nodeById(id).y, z: state.floorView.zoom, drag: window.dragNode }), r.id);
      assert.ok(after.x === r.nx && after.y === r.ny, 'il secondo dito annulla il trascinamento del primo: la stanza resta ferma');
      assert.ok(after.z > z0 * 1.5, 'e la mappa zooma: ' + after.z);
      assert.ok(!after.drag, 'nessun trascinamento resta armato');
      assert.deepEqual(await panel(), panel0, "e le Proprieta' non si aprono");
      await resetView();
    });

    await t.test('riappoggiare un dito riprende il pinch dal punto in cui è, senza salti (anche se si era alzato il PRIMO)', async () => {
      await resetView();
      await touch('touchStart', [{ x: mid.x - 40, y: mid.y, id: 1 }, { x: mid.x + 40, y: mid.y, id: 2 }]);
      for (let i = 1; i <= 4; i++) { await touch('touchMove', [{ x: mid.x - 40 - i * 10, y: mid.y, id: 1 }, { x: mid.x + 40 + i * 10, y: mid.y, id: 2 }]); await frames(); }
      await touch('touchEnd', [{ x: mid.x - 80, y: mid.y, id: 1 }]);        // si alza il PRIMO dito
      await frames();
      const v1 = await view();
      // un dito nuovo si riappoggia, piu' in la; il secondo e' ancora giu'
      await touch('touchStart', [{ x: mid.x + 80, y: mid.y, id: 2 }, { x: mid.x + 200, y: mid.y, id: 3 }]);
      await frames();
      const v2 = await view();
      assert.ok(near(v1.x, v2.x, 0.5) && near(v1.y, v2.y, 0.5) && near(v1.z, v2.z, 0.001), 'appoggiare il dito non deve muovere la vista: ' + JSON.stringify({ v1, v2 }));
      for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: mid.x + 80, y: mid.y, id: 2 }, { x: mid.x + 200 + i * 20, y: mid.y, id: 3 }]); await frames(); }
      await touch('touchEnd', []);
      await frames();
      const v3 = await view();
      assert.ok(v3.z > v2.z * 1.5, 'il pinch riprende e zooma ancora: ' + v2.z + ' → ' + v3.z);
      await resetView();
    });

    await t.test("un secondo dito durante un trascinamento gia' in corso non lo interrompe e non zooma", async () => {
      await resetView();
      await page.waitForTimeout(450);
      const r = await findRoom();
      const z0 = (await view()).z;
      await touch('touchStart', [{ x: r.x, y: r.y, id: 1 }]);
      await page.waitForTimeout(380);                                       // pressione lunga: la stanza e' afferrata
      await touch('touchMove', [{ x: r.x + 40, y: r.y + 20, id: 1 }]);   // oltre la soglia: il trascinamento e' ARMATO
      await frames();
      const e = await findEmpty();
      await touch('touchStart', [{ x: r.x + 40, y: r.y + 20, id: 1 }, { x: e.x, y: e.y, id: 2 }]);   // il palmo si appoggia
      await touch('touchMove', [{ x: r.x + 80, y: r.y + 40, id: 1 }, { x: e.x + 60, y: e.y, id: 2 }]);
      await frames();
      await touch('touchEnd', []);
      await frames();
      const after = await page.evaluate((id) => ({ x: nodeById(id).x, y: nodeById(id).y, z: state.floorView.zoom }), r.id);
      assert.equal(after.z, z0, "non e' un pinch: lo zoom non cambia");
      assert.ok(after.x === r.nx + 80 && after.y === r.ny + 40, 'il primo dito ha portato la stanza fino in fondo: ' + JSON.stringify({ da: [r.nx, r.ny], a: [after.x, after.y] }));
      await page.evaluate(([id, x, y]) => { const n = nodeById(id); n.x = x; n.y = y; renderAll(); }, [r.id, r.nx, r.ny]);
      await resetView();
    });

    await t.test('dopo un pinch il dito rimasto non fa panoramica (altrimenti salta)', async () => {
      await resetView();
      // Il primo dito atterra sullo SFONDO: e' il caso in cui l'app ha gia' armato una panoramica,
      // che il secondo dito deve annullare (altrimenti il dito rimasto la riprende con un salto).
      const c = await findEmpty(60);
      assert.ok(c, 'servono due punti vuoti a 120px di distanza');
      await touch('touchStart', [{ x: c.x - 40, y: c.y, id: 1 }, { x: c.x + 40, y: c.y, id: 2 }]);
      await touch('touchMove', [{ x: c.x - 60, y: c.y, id: 1 }, { x: c.x + 60, y: c.y, id: 2 }]);
      await frames();
      await touch('touchEnd', [{ x: c.x + 60, y: c.y, id: 2 }]);   // si alza SOLO il secondo dito
      await frames();
      const mid1 = await view();
      for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: c.x - 60 - i * 20, y: c.y + i * 10, id: 1 }]); await frames(); }
      await touch('touchEnd', []);
      await frames();
      const end = await view();
      assert.ok(near(end.x, mid1.x, 0.5) && near(end.y, mid1.y, 0.5), 'il dito rimasto ha mosso la vista: ' + JSON.stringify({ mid1, end }));
      await resetView();
    });

    await t.test('rack: pinch zooma, pan a un dito sposta, la transizione torna', async () => {
      await page.evaluate(() => document.getElementById('tab-rack').click());
      await page.waitForFunction(() => document.getElementById('rack-viewport').getBoundingClientRect().width > 0);
      const box = await page.evaluate(() => { const r = document.getElementById('rack-viewport').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      const rv = () => page.evaluate(() => ({ x: state.rackView.x || 0, y: state.rackView.y || 0, z: state.rackView.zoom }));
      const reset = async () => { await page.evaluate(() => { state.rackView.zoom = 1; state.rackView.x = 0; state.rackView.y = 0; updateTransforms(); }); await page.waitForTimeout(250); };
      await reset();
      const c = { x: box.x + box.w / 2, y: box.y + 220 };
      const r0 = await rv();
      await touch('touchStart', [{ x: c.x - 30, y: c.y, id: 1 }, { x: c.x + 30, y: c.y, id: 2 }]);
      for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: c.x - 30 - i * 10, y: c.y, id: 1 }, { x: c.x + 30 + i * 10, y: c.y, id: 2 }]); await frames(); }
      await touch('touchEnd', []);
      await frames();
      const r1 = await rv();
      assert.ok(r1.z > r0.z * 1.8, 'il rack zooma: ' + r1.z);
      assert.equal(await page.evaluate(() => document.body.classList.contains('rack-panning')), false, 'a fine pinch la transizione del rack e\' di nuovo attiva');

      await reset();
      // Un punto da cui il pan parta SUL viewport (non sul chassis, non sull'intestazione).
      const from = await page.evaluate((b) => {
        for (let y = b.y + 120; y < b.y + b.h - 60; y += 20) { const e = document.elementFromPoint(b.x + 10, y); if (e && e.id === 'rack-viewport') return { x: b.x + 10, y }; }
        return null;
      }, box);
      assert.ok(from, 'serve un punto libero nel viewport del rack');
      const p0 = await rv();
      await oneFinger(from, { x: from.x + 48, y: from.y + 30 }, 6);
      await page.waitForTimeout(120);
      const p1 = await rv();
      assert.ok(near(p1.x - p0.x, 48, 4) && near(p1.y - p0.y, 30, 4), 'pan del rack: ' + (p1.x - p0.x) + '/' + (p1.y - p0.y));
      await reset();
    });

    await t.test("rack: il primo dito di un pinch che scivola PRIMA dell'arrivo del secondo non sposta l'apparato", async () => {
      // E' il caso reale: due dita non atterrano mai insieme, e nel rack il primo cade quasi sempre
      // su un apparato. Con 10px di scivolamento prima del secondo dito, l'apparato cambiava unita'.
      await page.evaluate(() => document.getElementById('tab-rack').click());
      await page.waitForFunction(() => document.getElementById('rack-viewport').getBoundingClientRect().width > 0);
      await page.evaluate(() => { state.rackView.zoom = 1; state.rackView.x = 0; state.rackView.y = 0; updateTransforms(); });
      await page.waitForTimeout(250);
      const d = await findRackDevice();
      assert.ok(d, 'serve un apparato nel rack');
      const snap = await rackSnap();
      const z0 = await page.evaluate(() => state.rackView.zoom);
      const box = await page.evaluate(() => { const r = document.getElementById('rack-viewport').getBoundingClientRect(); return { x: r.x, w: r.width }; });
      const x2 = d.x + (d.x < box.x + box.w / 2 ? 90 : -90);
      await touch('touchStart', [{ x: d.x, y: d.y, id: 1 }]);
      for (let i = 1; i <= 4; i++) { await touch('touchMove', [{ x: d.x, y: d.y - i * 7, id: 1 }]); await frames(); }   // scivola di 28px
      await page.waitForTimeout(60);
      await touch('touchStart', [{ x: d.x, y: d.y - 28, id: 1 }, { x: x2, y: d.y - 28, id: 2 }]);
      for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: d.x - i * 8 * Math.sign(x2 - d.x), y: d.y - 28, id: 1 }, { x: x2 + i * 8 * Math.sign(x2 - d.x), y: d.y - 28, id: 2 }]); await frames(); }
      await touch('touchEnd', []);
      await page.waitForTimeout(150);
      assert.equal(await rackSnap(), snap, "nessun apparato del rack ha cambiato unita' mentre si zoomava");
      assert.ok((await page.evaluate(() => state.rackView.zoom)) > z0 * 1.4, 'e il rack ha zoomato');
      await page.evaluate(() => { state.rackView.zoom = 1; state.rackView.x = 0; state.rackView.y = 0; updateTransforms(); });
      await page.waitForTimeout(250);
    });

    await t.test("rack: un dito che parte da un apparato fa scorrere il rack; con la pressione lunga lo sposta di unita'", async () => {
      const reset = async () => { await page.evaluate(() => { state.rackView.zoom = 1; state.rackView.x = 0; state.rackView.y = 0; updateTransforms(); }); await page.waitForTimeout(250); };
      await reset();
      const d = await findRackDevice();
      const snap = await rackSnap();
      const rv = () => page.evaluate(() => ({ x: state.rackView.x || 0, y: state.rackView.y || 0 }));
      const p0 = await rv();
      await oneFinger({ x: d.x, y: d.y }, { x: d.x, y: d.y + 48 }, 6);
      await page.waitForTimeout(150);
      const p1 = await rv();
      assert.equal(await rackSnap(), snap, "un dito che si muove subito NON sposta l'apparato");
      assert.ok(near(p1.y - p0.y, 48, 4), 'il rack scorre di quanto si muove il dito: ' + (p1.y - p0.y));
      await reset();

      // Pressione lunga: l'apparato si solleva, poi segue il dito (tre unita' verso l'alto).
      await page.waitForTimeout(450);
      const d2 = await findRackDevice();
      // Le unita' libere piu' vicine: nel rack gli apparati sono attaccati, e se si lascia un apparato su un altro
      // la risoluzione delle sovrapposizioni lo rimette dov'era (e il test non proverebbe niente).
      const delta = await page.evaluate((id) => {
        const n = nodeById(id), rack = state.racks.find((r) => r.id === n.rackId), size = (rack && rack.sizeU) || 42, s = n.sizeU || 1;
        const occ = new Set();
        for (const o of state.nodes) if (o.id !== id && o.rackId === n.rackId && o.rackU !== undefined) for (let k = 0; k < (o.sizeU || 1); k++) occ.add(o.rackU + k);
        let best = null;
        for (let p = 1; p + s - 1 <= size; p++) {
          let ok = true; for (let k = 0; k < s; k++) if (occ.has(p + k)) ok = false;
          if (ok && p !== n.rackU && (best === null || Math.abs(p - n.rackU) < Math.abs(best - n.rackU))) best = p;
        }
        return best === null ? null : best - n.rackU;
      }, d2.id);
      assert.ok(delta, "serve una posizione libera nel rack per portarci l'apparato");
      await touch('touchStart', [{ x: d2.x, y: d2.y, id: 1 }]);
      await page.waitForTimeout(380);
      assert.equal(await page.evaluate((id) => document.querySelector('#rack-viewport .rack-device[data-id="' + id + '"]').classList.contains('touch-lifted'), d2.id), true, "tenuto premuto l'apparato si solleva");
      for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: d2.x, y: d2.y - i / 8 * delta * d2.unitPx, id: 1 }]); await frames(); }   // verso l'alto = unita' crescenti
      await touch('touchEnd', []);
      await page.waitForTimeout(150);
      const moved = await page.evaluate((id) => ({ u: nodeById(id).rackU, lifted: document.querySelectorAll('.touch-lifted').length }), d2.id);
      assert.equal(moved.u, d2.rackU + delta, "afferrato con la pressione lunga, l'apparato va dove lo porta il dito (" + delta + ' unita\')');
      assert.equal(moved.lifted, 0, 'al rilascio il segno sparisce');
      await rackRestore(snap);
      await reset();
    });

    await t.test('il divisore della palette si trascina col dito', async () => {
      const dv = await page.evaluate(() => {
        const r = document.getElementById('sidebar-divider').getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + 80, w: document.getElementById('sidebar-left').getBoundingClientRect().width };
      });
      await oneFinger({ x: dv.x, y: dv.y }, { x: dv.x + 90, y: dv.y }, 6);
      // La larghezza ha una transition (.25s): si misura a transizione finita.
      await page.waitForTimeout(450);
      const w = await page.evaluate(() => document.getElementById('sidebar-left').getBoundingClientRect().width);
      assert.ok(near(w - dv.w, 90, 3), 'palette: ' + dv.w + ' → ' + w);
    });

    await t.test('pointercancel (il browser si riprende il gesto) non lascia stato armato', async () => {
      await resetView();
      const e = await findEmpty();
      await touch('touchStart', [{ x: e.x, y: e.y, id: 1 }]);
      await touch('touchMove', [{ x: e.x + 30, y: e.y, id: 1 }]);
      await frames();
      assert.equal(await page.evaluate(() => window.isPanningFloor), true, 'prima della cancellazione la panoramica e\' armata');
      await touch('touchCancel', []);
      await frames();
      assert.equal(await page.evaluate(() => window.isPanningFloor), false, 'dopo un pointercancel nessuna panoramica resta armata');
    });

    await t.test("il mouse non e' cambiato: stessa panoramica, e una stanza si afferra SUBITO (niente pressione lunga)", async () => {
      await resetView();
      const e = await findEmpty();
      const v0 = await view();
      await page.mouse.move(e.x, e.y);
      await page.mouse.down();
      await page.mouse.move(e.x + 40, e.y + 20, { steps: 4 });
      await page.mouse.up();
      await frames();
      const v1 = await view();
      assert.ok(near(v1.x - v0.x, 40, 2) && near(v1.y - v0.y, 20, 2), 'dx/dy: ' + (v1.x - v0.x) + '/' + (v1.y - v0.y));

      // La pressione lunga e' solo del dito: col mouse l'afferrare resta immediato, come sempre.
      await resetView();
      const r = await findRoom();
      await page.mouse.move(r.x, r.y);
      await page.mouse.down();
      await page.mouse.move(r.x + 60, r.y + 40, { steps: 6 });
      await page.mouse.up();
      await frames();
      const m = await page.evaluate((id) => ({ x: nodeById(id).x, y: nodeById(id).y }), r.id);
      assert.ok(m.x !== r.nx || m.y !== r.ny, 'col mouse la stanza segue subito il cursore');
      await page.evaluate(([id, x, y]) => { const n = nodeById(id); n.x = x; n.y = y; renderAll(); }, [r.id, r.nx, r.ny]);
      await frames();
    });

    await t.test('Topologia: un dito che parte da un cavo sposta comunque la mappa; il tap su un cavo non deseleziona', async () => {
      // Il setup di topologia e' quello del flusso «app-topology-overlay» di critical-flows: due rack
      // sulla mappa, uno switch in ciascuno, un cavo fra loro. Le linee hanno un'area sensibile larga
      // 18px che col mouse ferma la pointerdown; col dito, che copre ~1/5 della mappa, no.
      await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        state.racks = [{ id: 'rA', name: 'A', sizeU: 42, x: 120, y: 320 }, { id: 'rB', name: 'B', sizeU: 42, x: 480, y: 320 }];   // in basso: la barra vista (in alto a destra) non deve coprire il cavo
        state.currentRack = 'rA';
        state.nodes = [
          { id: 'sA', type: 'switch', name: 'swA', rackId: 'rA', rackU: 1, sizeU: 1, ports: 8 },
          { id: 'sB', type: 'switch', name: 'swB', rackId: 'rB', rackU: 1, sizeU: 1, ports: 8 },
        ];
        state.ports = { 'sA-1': {}, 'sB-1': {} };
        state.links = [window._createLinkRecord('sA-1', 'sB-1')];
        _invalidateIdx();
        window._topoData = null; window._topoVisible = true; window._viewMode = 'topology';
        renderAll(); renderTopoOverlay();
      });
      await page.waitForFunction(() => document.querySelectorAll('#topo-floor-overlay .tfl').length > 0, null, { timeout: 5000 });
      await frames();
      // Il punto: lungo la linea, e solo dove la linea e' DAVVERO l'elemento sotto il dito.
      const hitPoint = () => page.evaluate(() => {
        const l = [...document.querySelectorAll('#topo-floor-overlay line')].find((x) => x.getAttribute('stroke') === 'transparent');
        if (!l) return null;
        const r = l.getBoundingClientRect();
        for (let i = 1; i < 20; i++) {
          const x = r.x + r.width * i / 20, y = r.y + r.height * i / 20;
          if (document.elementFromPoint(x, y) === l) return { x, y, onHit: true };
        }
        return null;
      });
      const hit = await hitPoint();
      assert.ok(hit && hit.onHit, 'serve il punto di un cavo di topologia: ' + JSON.stringify(hit));
      const v0 = await view();
      await oneFinger(hit, { x: hit.x + 60, y: hit.y + 40 });
      const v1 = await view();
      assert.ok(near(v1.x - v0.x, 60, 3) && near(v1.y - v0.y, 40, 3), 'un dito partito da un cavo sposta la mappa: ' + (v1.x - v0.x) + '/' + (v1.y - v0.y));

      // Un TAP sul cavo non toglie la selezione (col mouse un clic sul cavo non la tocca).
      await resetView();
      await page.evaluate(() => { window.selType = 'node'; window.selId = 'sA'; });
      const hit2 = await hitPoint();
      assert.ok(hit2, "il cavo e' ancora raggiungibile dopo aver riportato la vista a zero");
      await touch('touchStart', [{ x: hit2.x, y: hit2.y, id: 1 }]);
      await touch('touchEnd', []);
      await frames();
      assert.equal(await page.evaluate(() => window.selId), 'sA', 'il tap su un cavo lascia la selezione dov\'era');

      // Fuori dalla Topologia per i test che seguono.
      await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        window._topoData = null; window._topoVisible = false; window._viewMode = 'map';
        renderAll();
      });
      await frames();
    });

    assert.deepEqual(errs, [], 'errori JS/console durante i gesti: ' + errs.join(' | '));
  } finally {
    await browser.close();
    if (srv.close) await srv.close();
  }
});
