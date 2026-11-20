'use strict';
// ============================================================
// E2E COMPOSITORE DEL CASSETTO OTTICO — i gesti veri, in un Chrome vero
// ============================================================
// Il compositore (src/app-fiberdrawer-composer.js) si usa con TRE gesti: trascinare un modulo su uno slot, toccare un
// modulo e passare sugli slot per dipingere, «Tutti uguali a…». Qui si provano col mouse, con la tastiera e col DITO
// (tocco emulato, eventi Pointer di tipo 'touch': e' il caso del tablet, dove il drag HTML5 non funzionerebbe).
// La logica (piano per slot, numerazione, cavi coinvolti) e' provata a parte, senza browser: fiber-compose.test.js.
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

/** Un'app con un rack, un cassetto LC duplex da 24 slot (fd1), uno switch (sw1) e TRE cavi: sulla porta 15 e sulla 3 (capo `src`) e sulla 16 (capo `dst`). */
async function apri(browser, srv, ctxOpts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1400, height: 900 } }, ctxOpts || {}));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.goto(srv.baseURL, { waitUntil: 'load' });
  await page.waitForFunction(() => { try { return typeof renderAll === 'function' && Array.isArray(state.nodes); } catch (e) { return false; } }, null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-pid]').length > 10, null, { timeout: 15000 });
  await page.evaluate(() => {
    state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
    state.racks = [{ id: 'r1', name: 'Rack', sizeU: 6 }]; state.currentRack = 'r1';
    state.nodes = []; state.links = []; state.ports = {};
    state.nodes.push({ id: 'fd1', type: 'fiberdrawer', name: 'ODF-1', ports: 24, rackId: 'r1', rackU: 4, sizeU: 1, spec: { ppFiberConnector: 'lc-duplex' } });
    state.nodes.push({ id: 'sw1', type: 'switch', name: 'SW1', ports: 24, rackId: 'r1', rackU: 2, sizeU: 1 });
    state.links.push({ id: 'L1', src: 'fd1-15', dst: 'sw1-1' }, { id: 'L2', src: 'fd1-3', dst: 'sw1-2' }, { id: 'L3', src: 'sw1-3', dst: 'fd1-16' });
    if (typeof _invalidateIdx === 'function') _invalidateIdx();
    document.body.classList.remove('view-overview');
    _renderAllNow();
    window._propsExplicit = true; selType = 'node'; selId = 'fd1'; renderProps();
  });
  return { ctx, page, errs };
}
const apriCompositore = async (page) => {
  await page.waitForSelector('[data-act="fd-compose"]', { timeout: 8000 });
  await page.click('[data-act="fd-compose"]');
  await page.waitForSelector('#fdcomp-overlay .fdc-slot', { timeout: 5000 });
};
const bozza = (page) => page.evaluate(() => [...document.querySelectorAll('#fdc-strip .fdc-box')].map((b) => /fdc-k-([a-z0-9-]+)/.exec(b.className)[1]));
const centro = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const slotCentro = (page, i) => centro(page.locator(`#fdc-strip .fdc-col[data-i="${i}"] .fdc-slot`));
const modulo = (page, k) => page.locator(`#fdc-pal .fdc-mod[data-k="${k}"]`);
const nodo = (page) => page.evaluate(() => { const n = nodeById('fd1'); return { ports: n.ports, manual: n.portsManual, fdSlots: n.spec && n.spec.fdSlots ? n.spec.fdSlots.slice() : null, conn: n.spec && n.spec.ppFiberConnector, unit: n.spec && n.spec.ppFiberPortUnit, links: state.links.map((l) => l.src + '>' + l.dst) }; });
const rack = (page) => page.evaluate(() => {
  const el = document.querySelector('.rack-device[data-id="fd1"]');
  const cls = (c) => el.querySelectorAll('.port-led.' + c).length;
  return { mpo: cls('fo-mpo'), lc2: cls('fo-lc2'), big2: cls('fo-big2'), plates: el.querySelectorAll('.fo-plate').length, pids: el.querySelectorAll('[data-pid]').length };
});

test('E2E compositore: trascinare, dipingere, tastiera, applica, annulla (mouse vero)', { skip: SKIP }, async () => {
  const srv = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
  try {
    const { ctx, page, errs } = await apri(browser, srv);

    // — apertura: parte da com'era (24 slot LC duplex), niente da applicare, nessuna modifica nel progetto
    await apriCompositore(page);
    assert.deepStrictEqual(await bozza(page), new Array(24).fill('lc-duplex'));
    assert.strictEqual(await page.locator('#fdc-apply').isDisabled(), true, 'nessuna modifica: Applica spento');
    assert.match(await page.textContent('#fdc-warn'), /non cambia/);
    assert.strictEqual(await page.locator('#fdc-pal .fdc-mod').count(), 9, 'otto moduli piu\' il vuoto');

    // — TRASCINARE: l'MPO sul 15° slot (quello col cavo). Il fantasma segue il puntatore e lo slot sotto si evidenzia.
    const p0 = await centro(modulo(page, 'mpo-12'));
    const s15 = await slotCentro(page, 14);
    await page.mouse.move(p0.x, p0.y); await page.mouse.down();
    await page.mouse.move(p0.x + 40, p0.y + 40, { steps: 3 });
    await page.mouse.move(s15.x, s15.y, { steps: 6 });
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('fdc-ghost')).display), 'block', 'il fantasma c\'e\' durante il trascinamento');
    assert.strictEqual(await page.locator('#fdc-strip .fdc-over').count(), 1, 'lo slot sotto il puntatore e\' evidenziato');
    assert.strictEqual((await bozza(page))[14], 'lc-duplex', 'finche\' non si rilascia non cambia niente');
    await page.mouse.up();
    let b = await bozza(page);
    assert.strictEqual(b[14], 'mpo-12', 'lo slot 15 ha l\'MPO');
    assert.strictEqual(b.filter((k) => k === 'mpo-12').length, 1);
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('fdc-ghost')).display), 'none');
    assert.strictEqual(await page.locator('#fdc-pal .fdc-mod.on').count(), 0, 'trascinare non attiva il modulo');
    assert.match(await page.textContent('#fdc-warn'), /Cavi attaccati a porte che cambiano posto: 1 \(porte 15\)/, 'il cavo sulla 15 e\' avvisato PRIMA di applicare');
    assert.strictEqual(await page.locator('#fdc-warn.fdc-warn-on').count(), 1, 'avviso acceso (ambra)');
    assert.strictEqual(await page.locator('#fdc-apply').isDisabled(), false);
    assert.deepStrictEqual((await nodo(page)).fdSlots, null, 'la bozza non ha toccato il progetto');

    // — rilasciare FUORI dagli slot non fa niente
    const p1 = await centro(modulo(page, 'sc'));
    await page.mouse.move(p1.x, p1.y); await page.mouse.down();
    await page.mouse.move(p1.x + 200, p1.y - 10, { steps: 6 });
    await page.mouse.up();
    assert.deepStrictEqual(await bozza(page), b, 'rilasciato nel vuoto: la bozza e\' la stessa');
    assert.strictEqual(await page.locator('#fdc-pal .fdc-mod.on').count(), 0);

    // — trascinare un modulo e rilasciarlo sopra se stesso non lo attiva (il click che segue il rilascio non e' un tocco)
    const pf = await centro(modulo(page, 'fc'));
    await page.mouse.move(pf.x, pf.y); await page.mouse.down();
    await page.mouse.move(pf.x + 30, pf.y + 30, { steps: 4 });
    await page.mouse.move(pf.x, pf.y, { steps: 4 });
    await page.mouse.up();
    assert.strictEqual(await page.locator('#fdc-pal .fdc-mod.on').count(), 0, 'un trascinamento che torna sul modulo non lo attiva');

    // — DIPINGERE: tocco SC duplex (resta attivo) e passo dal 20° al 24° slot tenendo premuto
    await modulo(page, 'sc-duplex').click();
    assert.strictEqual(await page.locator('#fdc-pal .fdc-mod.on').count(), 1);
    assert.match(await page.textContent('#fdc-hint'), /Modulo attivo: SC duplex/);
    const a = await slotCentro(page, 19), z = await slotCentro(page, 23);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(z.x, z.y, { steps: 15 });
    await page.mouse.up();
    b = await bozza(page);
    assert.deepStrictEqual(b.slice(19), new Array(5).fill('sc-duplex'), 'il tratto dipinto');
    assert.strictEqual(b.slice(0, 14).every((k) => k === 'lc-duplex'), true, 'il resto e\' intatto');
    assert.strictEqual(await page.locator('#fdc-pal .fdc-mod.on').count(), 1, 'dopo un tratto il modulo resta attivo');
    // un tocco su un solo slot lo cambia subito
    const s3 = await slotCentro(page, 2);
    await page.mouse.click(s3.x, s3.y);
    assert.strictEqual((await bozza(page))[2], 'sc-duplex', 'un click su uno slot col modulo attivo');
    await modulo(page, 'sc-duplex').click();   // secondo tocco: lo toglie
    assert.strictEqual(await page.locator('#fdc-pal .fdc-mod.on').count(), 0);
    const s4 = await slotCentro(page, 3);
    await page.mouse.click(s4.x, s4.y);
    assert.strictEqual((await bozza(page))[3], 'lc-duplex', 'senza modulo attivo un click sullo slot non cambia niente');

    // — TASTIERA: Invio sul modulo lo attiva, Invio su uno slot lo applica
    await modulo(page, 'blank').focus();
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.locator('#fdc-pal .fdc-mod.on[data-k="blank"]').count(), 1, 'Invio sul modulo lo attiva');
    await page.locator('#fdc-strip .fdc-col[data-i="9"] .fdc-slot').focus();
    await page.keyboard.press('Enter');
    assert.strictEqual((await bozza(page))[9], 'blank', 'Invio su uno slot applica il modulo attivo');
    await page.keyboard.press('Space');
    assert.strictEqual((await bozza(page))[9], 'blank');
    assert.match(await page.textContent('#fdc-sum'), /10 vuoto|vuot/);

    // — APPLICA: un passo solo, il progetto cambia, il rack si ridisegna
    await page.click('#fdc-apply');
    await page.waitForTimeout(300);
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('fdcomp-overlay')).display), 'none', 'la finestra si chiude');
    const n1 = await nodo(page);
    assert.strictEqual(n1.fdSlots.length, 24);
    assert.strictEqual(n1.fdSlots[14], 'mpo-12');
    assert.strictEqual(n1.fdSlots[9], 'blank');
    assert.strictEqual(n1.conn, 'lc-duplex', 'il connettore di partenza resta com\'era');
    assert.strictEqual(n1.ports, 23, 'le porte vengono dai moduli: 24 slot meno una lastra = 23');
    assert.strictEqual(n1.manual, true, 'e restano un valore deciso da una persona: l\'SNMP non lo alza in silenzio');
    assert.deepStrictEqual(n1.links, ['fd1-15>sw1-1', 'fd1-3>sw1-2', 'sw1-3>fd1-16'], 'i cavi restano sui NUMERI di porta');
    const r1 = await rack(page);
    assert.deepStrictEqual({ mpo: r1.mpo, plates: r1.plates, pids: r1.pids }, { mpo: 1, plates: 1, pids: 23 });
    assert.ok(r1.big2 >= 5);
    // il pannello dice i moduli a parole e blocca il campo porte
    await page.waitForSelector('.fd-modules', { timeout: 5000 });
    assert.match(await page.textContent('.fd-modules'), /MTP\/MPO-12/);
    assert.strictEqual(await page.locator('input[data-nfield="ports"]:disabled').count(), 1, 'le porte non si scrivono a mano');
    assert.strictEqual(await page.locator('select[data-nfield="ppFiberConnector"]').count(), 0);

    // — ANNULLA (Ctrl+Z): UN passo riporta tutto com'era
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const n2 = await nodo(page);
    assert.strictEqual(n2.fdSlots, null, 'composizione tolta');
    assert.strictEqual(n2.ports, 24);
    assert.strictEqual(n2.conn, 'lc-duplex');
    assert.strictEqual((await rack(page)).mpo, 0);

    // — RIAPRO su un cassetto composto: parte dalla composizione, non da zero
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(300);
    assert.strictEqual((await nodo(page)).fdSlots.length, 24, 'ripeti la rimette');
    await page.evaluate(() => { window._propsExplicit = true; selType = 'node'; selId = 'fd1'; renderProps(); });
    await apriCompositore(page);
    b = await bozza(page);
    assert.strictEqual(b[14], 'mpo-12'); assert.strictEqual(b[9], 'blank');
    assert.strictEqual(await page.locator('#fdc-apply').isDisabled(), true);

    // — ANNULLA nella finestra (Esc e «Annulla»): niente cambia
    await modulo(page, 'fc').click();
    const q = await slotCentro(page, 0);
    await page.mouse.click(q.x, q.y);
    assert.strictEqual((await bozza(page))[0], 'fc');
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('fdcomp-overlay')).display), 'none', 'Esc chiude');
    assert.strictEqual((await nodo(page)).fdSlots[0], 'lc-duplex', 'Esc scarta la bozza');
    await apriCompositore(page);
    assert.strictEqual((await bozza(page))[0], 'lc-duplex', 'riaperta: parte dal progetto, non dalla bozza scartata');
    await page.click('.fdc-foot [data-act="fdc-close"]');
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('fdcomp-overlay')).display), 'none');

    // — il clic FUORI dalla finestra (sullo sfondo) la chiude, e scarta la bozza
    await apriCompositore(page);
    await modulo(page, 'fc').click();
    const q2 = await slotCentro(page, 0);
    await page.mouse.click(q2.x, q2.y);
    assert.strictEqual((await bozza(page))[0], 'fc', 'la bozza e\' cambiata');
    await page.mouse.click(5, 5);
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('fdcomp-overlay')).display), 'none', 'clic sullo sfondo chiude');
    assert.strictEqual((await nodo(page)).fdSlots[0], 'lc-duplex', 'e non applica');

    // — TUTTI UGUALI a…: tutti MPO → cassetto UNIFORME MPO (niente elenco), 24 porte
    await apriCompositore(page);
    await page.selectOption('select[data-change="fdc-all"]', 'mpo-12');
    assert.deepStrictEqual(await bozza(page), new Array(24).fill('mpo-12'));
    assert.strictEqual(await page.locator('select[data-change="fdc-all"]').inputValue(), '', 'la tendina torna su «Tutti uguali a…»');
    await page.click('#fdc-apply');
    await page.waitForTimeout(300);
    const n3 = await nodo(page);
    assert.strictEqual(n3.fdSlots, null, 'tutti uguali = cassetto uniforme');
    assert.strictEqual(n3.conn, 'mpo-12');
    assert.strictEqual(n3.ports, 24);
    assert.strictEqual(await page.locator('select[data-nfield="ppFiberConnector"]').count(), 1, 'e la tendina del connettore e\' tornata');
    assert.strictEqual(await page.locator('input[data-nfield="ports"]:disabled').count(), 0);
    // l'unita' di conto ha senso solo se c'e' un modulo con piu' connettori: con tutti MPO la tendina non c'e'
    await apriCompositore(page);
    assert.strictEqual(await page.locator('select[data-change="fdc-unit"]').count(), 0, 'tutti MPO: niente tendina «una porta e\'»');
    await page.click('.fdc-foot [data-act="fdc-close"]');

    // — UN MODULO CON PIU' PORTE rinumera: un quad (2 porte) al posto di un LC duplex, e la porta = singolo connettore
    await page.selectOption('select[data-nfield="ppFiberConnector"]', 'lc-duplex');
    await page.waitForTimeout(200);
    await apriCompositore(page);
    assert.strictEqual(await page.locator('select[data-change="fdc-unit"]').count(), 1, 'con l\'LC duplex la tendina «una porta e\'» c\'e\'');
    await modulo(page, 'lc-quad').click();
    const t1 = await slotCentro(page, 5);
    await page.mouse.click(t1.x, t1.y);
    assert.strictEqual(await page.locator('#fdc-strip .fdc-col[data-i="5"] .fdc-cell').count(), 2, 'il quad ha 2 celle (2 duplex)');
    assert.strictEqual(await page.locator('#fdc-strip .fdc-box').first().evaluate((el) => el.style.aspectRatio.replace(/\s/g, '')), '192.31/396.63', 'con un quad la scatola e\' alta per tutti');
    assert.match(await page.textContent('#fdc-warn'), /Cavi attaccati a porte che cambiano posto: 2 \(porte 15–16\)/, 'dopo il quad (slot 6) le porte 15 (cavo col capo src sul cassetto) e 16 (capo dst) sono altre: i due cavi sono avvisati');
    assert.match(await page.textContent('#fdc-sum'), /25 porte · 24 slot/);
    await page.selectOption('select[data-change="fdc-unit"]', 'single');
    assert.strictEqual(await page.locator('#fdc-strip .fdc-col[data-i="5"] .fdc-cell').count(), 4, 'porta = singolo connettore: il quad ha 4 celle');
    assert.match(await page.textContent('#fdc-sum'), /50 porte · 24 slot/, 'con la porta = singolo connettore: 23 LC duplex da 2 porte e un quad da 4');
    await page.click('#fdc-apply');
    await page.waitForTimeout(300);
    const n4 = await nodo(page);
    assert.strictEqual(n4.unit, 'single');
    assert.strictEqual(n4.fdSlots[5], 'lc-quad');
    assert.strictEqual(n4.ports, 23 * 2 + 4);

    assert.deepStrictEqual(errs, [], 'nessun errore in console');
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('E2E compositore: cambiare quanti slot e il tetto delle U', { skip: SKIP }, async () => {
  const srv = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
  try {
    const { ctx, page, errs } = await apri(browser, srv);
    await apriCompositore(page);
    const max1U = await page.getAttribute('input[data-change="fdc-count"]', 'max');
    assert.strictEqual(max1U, '24', 'a 1U ci stanno 24 slot');
    await page.fill('input[data-change="fdc-count"]', '30');
    await page.press('input[data-change="fdc-count"]', 'Tab');
    assert.strictEqual((await bozza(page)).length, 24, 'oltre il tetto delle U si ferma');
    await page.fill('input[data-change="fdc-count"]', '12');
    await page.press('input[data-change="fdc-count"]', 'Tab');
    assert.strictEqual((await bozza(page)).length, 12);
    assert.match(await page.textContent('#fdc-warn'), /Cavi attaccati a porte che cambiano posto: 2 \(porte 15–16\)/, 'togliere slot toglie le porte oltre: i cavi sulla 15 e sulla 16 restano orfani, e lo dice');
    await page.fill('input[data-change="fdc-count"]', '0');
    await page.press('input[data-change="fdc-count"]', 'Tab');
    assert.strictEqual((await bozza(page)).length, 1, 'mai zero slot');
    await page.click('.fdc-foot [data-act="fdc-close"]');
    // un cassetto con un connettore che non e' un modulo (LC simplex: dati vecchi) non apre il compositore, nemmeno col pulsante forzato
    await page.evaluate(() => { nodeById('fd1').spec.ppFiberConnector = 'lc-simplex'; document.body.insertAdjacentHTML('beforeend', '<button id="forzato" data-act="fd-compose" data-nid="fd1">x</button>'); });
    await page.click('#forzato');
    assert.strictEqual(await page.evaluate(() => { const o = document.getElementById('fdcomp-overlay'); return getComputedStyle(o).display; }), 'none', 'LC simplex: non si compone');
    await page.evaluate(() => { nodeById('fd1').spec.ppFiberConnector = 'lc-duplex'; document.getElementById('forzato').remove(); renderProps(); });
    // una composizione che nel progetto c'e' gia' ed e' piu' lunga delle U (30 slot a 1U) si puo' tenere, e la finestra dice che il frontale e' semplificato
    await page.evaluate(() => { const n = nodeById('fd1'); n.ports = 30; n.spec.fdSlots = new Array(30).fill('sc'); _renderAllNow(); window._propsExplicit = true; selType = 'node'; selId = 'fd1'; renderProps(); });
    await apriCompositore(page);
    assert.strictEqual(await page.getAttribute('input[data-change="fdc-count"]', 'max'), '30', 'una composizione piu\' lunga delle U si puo\' tenere');
    assert.match(await page.textContent('#fdc-warn'), /Oltre 24 slot \(1U × 24\)/, 'e la finestra lo dice');
    await page.click('.fdc-foot [data-act="fdc-close"]');
    await page.evaluate(() => { const n = nodeById('fd1'); n.ports = 24; delete n.spec.fdSlots; _renderAllNow(); window._propsExplicit = true; selType = 'node'; selId = 'fd1'; renderProps(); });
    // a 2U: 48 slot, due file
    await page.evaluate(() => { nodeById('fd1').sizeU = 2; nodeById('fd1').rackU = 3; _renderAllNow(); window._propsExplicit = true; selType = 'node'; selId = 'fd1'; renderProps(); });
    await apriCompositore(page);
    assert.strictEqual(await page.getAttribute('input[data-change="fdc-count"]', 'max'), '48');
    await page.fill('input[data-change="fdc-count"]', '30');
    await page.press('input[data-change="fdc-count"]', 'Tab');
    assert.strictEqual((await bozza(page)).length, 30);
    assert.strictEqual(await page.locator('#fdc-strip .fdc-row').count(), 2, 'due file da 24: la seconda ha 6 slot');
    assert.strictEqual(await page.locator('#fdc-strip .fdc-row').nth(1).locator('.fdc-col').count(), 6);
    await modulo(page, 'mpo-12').click();
    const last = await slotCentro(page, 29);
    await page.mouse.click(last.x, last.y);
    await page.click('#fdc-apply');
    await page.waitForTimeout(300);
    const n = await nodo(page);
    assert.strictEqual(n.fdSlots.length, 30);
    assert.strictEqual(n.ports, 30);
    assert.strictEqual(await page.evaluate(() => document.querySelectorAll('.rack-device[data-id="fd1"] .rack-ports-row').length), 2, 'il rack ha le due file');
    assert.deepStrictEqual(errs, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});

// La sezione del pannello e' composta su una GABBIA a 12 colonne (design «B, due colonne»): la riga e le tessere dei moduli
// dividono lo spazio a meta' e le due colonne partono dallo stesso x; campi da 40 px, tessere da 32, 8 px fra etichetta e
// campo e fra tessere, 24 px fra i blocchi. A barra stretta le due meta' si impilano, sempre sulla stessa gabbia.
test('E2E pannello del cassetto composto: la gabbia (colonne allineate, misure a 8 px) e l\'impilamento a barra stretta', { skip: SKIP }, async () => {
  const srv = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
  try {
    const { ctx, page, errs } = await apri(browser, srv, { viewport: { width: 1920, height: 1000 } });
    await page.evaluate(() => {
      const n = nodeById('fd1');
      n.ports = 6; n.portsManual = true; n.spec.ppFiberMode = 'mm-om4';
      n.spec.fdSlots = ['lc-duplex', 'lc-quad', 'sc', 'mpo-12', 'blank', 'sc-duplex'];
      _renderAllNow(); window._propsExplicit = true; selType = 'node'; selId = 'fd1'; renderProps();
    });
    await page.waitForSelector('.fd-panel .fd-chip', { timeout: 5000 });
    const gabbia = () => page.evaluate(() => {
      const b = (el) => el.getBoundingClientRect();
      const p = document.querySelector('.fd-panel');
      const chips = [...p.querySelectorAll('.fd-chip')];
      const sel = p.querySelector('select[data-nfield="ppFiberMode"]');
      const stats = p.querySelector('.fd-stats');
      const head = p.querySelector('.fd-modules-head');
      const btn = p.querySelector('.fd-compose .toolbar-btn');
      const row = p.querySelector('.fd-row');
      const lab = sel.closest('.prop-group').querySelector('label');
      const ys = [...new Set(chips.map((c) => Math.round(b(c).y)))].sort((x, y) => x - y);
      return {
        w: b(p).width, selX: b(sel).x, selH: b(sel).height, statsX: b(stats).x, statsY: b(stats).y, selY: b(sel).y,
        chipXs: [...new Set(chips.map((c) => Math.round(b(c).x * 10) / 10))], chipH: b(chips[0]).height, chipGapY: ys.length > 1 ? ys[1] - ys[0] - b(chips[0]).height : null,
        labGap: b(sel).y - (b(lab).y + b(lab).height), rowToHead: b(head).y - (b(row).y + b(row).height), headToChips: b(chips[0]).y - (b(head).y + b(head).height),
        chipsToBtn: b(btn).y - (b(chips[chips.length - 1]).y + b(chips[chips.length - 1]).height), btnH: b(btn).height, btnW: b(btn).width,
      };
    });
    const g = await gabbia();
    assert.strictEqual(g.chipXs.length, 2, 'tessere su due colonne');
    assert.ok(Math.abs(g.selX - g.chipXs[0]) < 0.6, 'la classe di fibra parte dalla prima colonna delle tessere');
    assert.ok(Math.abs(g.statsX - g.chipXs[1]) < 0.6, 'il riepilogo parte dalla seconda colonna delle tessere');
    assert.strictEqual(g.selH, 40, 'campo da 40 px');
    assert.strictEqual(g.chipH, 32, 'tessera da 32 px');
    assert.strictEqual(g.labGap, 8, '8 px fra etichetta e campo');
    assert.strictEqual(g.chipGapY, 8, '8 px fra le tessere');
    assert.strictEqual(g.headToChips, 8, '8 px fra l\'etichetta «Moduli» e le tessere');
    assert.strictEqual(g.rowToHead, 24, '24 px fra i blocchi');
    assert.strictEqual(g.chipsToBtn, 24, '24 px fra i blocchi');
    assert.strictEqual(g.btnH, 40, 'pulsante da 40 px');
    assert.ok(Math.abs(g.btnW - g.w) < 0.6, 'il pulsante e\' a tutta larghezza');
    // barra stretta: le due meta' una sopra l'altra, tutte sul bordo sinistro
    await page.evaluate(() => { const rv = document.getElementById('rack-view'); rv.style.width = rv.style.minWidth = rv.style.maxWidth = '340px'; });
    await page.waitForTimeout(250);
    const s = await gabbia();
    assert.strictEqual(s.chipXs.length, 1, 'tessere su una colonna sola');
    assert.ok(Math.abs(s.statsX - s.selX) < 0.6, 'il riepilogo e\' sotto la classe di fibra, non fuori dalla gabbia');
    assert.ok(s.statsY > s.selY + s.selH, 'impilato');
    assert.ok(s.w < 408, 'sotto la soglia di impilamento');
    assert.deepStrictEqual(errs, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});

test('E2E compositore col DITO (tablet): tocco il modulo, passo sugli slot, trascino dalla palette', { skip: SKIP }, async () => {
  const srv = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
  try {
    const { ctx, page, errs } = await apri(browser, srv, { hasTouch: true });
    await apriCompositore(page);
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const pt = (p) => ({ x: Math.round(p.x), y: Math.round(p.y), id: 1 });

    // un TAP su un modulo lo attiva
    const sc = await centro(modulo(page, 'sc'));
    await touch('touchStart', [pt(sc)]); await touch('touchEnd', [pt(sc)]);
    await page.waitForTimeout(150);
    assert.strictEqual(await page.locator('#fdc-pal .fdc-mod.on[data-k="sc"]').count(), 1, 'un tocco attiva il modulo');

    // il dito scorre dal 4° al 9° slot: dipinge il tratto (e la pagina non scorre: touch-action:none sullo strip)
    const a = await slotCentro(page, 3), z = await slotCentro(page, 8);
    const scrollPrima = await page.evaluate(() => document.getElementById('fdcomp-body').scrollTop);
    await touch('touchStart', [pt(a)]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [pt({ x: a.x + (z.x - a.x) * i / 10, y: a.y + (z.y - a.y) * i / 10 })]);
    await touch('touchEnd', [pt(z)]);
    await page.waitForTimeout(150);
    const b = await bozza(page);
    assert.deepStrictEqual(b.slice(3, 9), new Array(6).fill('sc'), 'col dito si dipinge un tratto');
    assert.strictEqual(b[2], 'lc-duplex'); assert.strictEqual(b[9], 'lc-duplex');
    assert.strictEqual(await page.evaluate(() => document.getElementById('fdcomp-body').scrollTop), scrollPrima, 'il gesto non scorre la finestra');

    // un TAP su uno slot (col modulo attivo) lo cambia
    const s12 = await slotCentro(page, 11);
    await touch('touchStart', [pt(s12)]); await touch('touchEnd', [pt(s12)]);
    await page.waitForTimeout(150);
    assert.strictEqual((await bozza(page))[11], 'sc');

    // TRASCINARE dalla palette (MPO) sul 20° slot, col dito
    await modulo(page, 'sc').click();   // tolgo l'attivo
    const mpo = await centro(modulo(page, 'mpo-12'));
    const s20 = await slotCentro(page, 19);
    await touch('touchStart', [pt(mpo)]);
    for (let i = 1; i <= 12; i++) await touch('touchMove', [pt({ x: mpo.x + (s20.x - mpo.x) * i / 12, y: mpo.y + (s20.y - mpo.y) * i / 12 })]);
    await touch('touchEnd', [pt(s20)]);
    await page.waitForTimeout(150);
    assert.strictEqual((await bozza(page))[19], 'mpo-12', 'trascinato col dito dalla palette');
    assert.strictEqual(await page.locator('#fdc-pal .fdc-mod.on').count(), 0, 'trascinare non attiva');

    // un trascinamento INTERROTTO (il sistema annulla il tocco) non lascia il fantasma ne' cambia niente
    const prima = await bozza(page);
    const fc = await centro(modulo(page, 'fc'));
    const s2 = await slotCentro(page, 1);
    await touch('touchStart', [pt(fc)]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [pt({ x: fc.x + (s2.x - fc.x) * i / 8, y: fc.y + (s2.y - fc.y) * i / 8 })]);
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('fdc-ghost')).display), 'block');
    await touch('touchCancel', []);
    await page.waitForTimeout(150);
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('fdc-ghost')).display), 'none', 'annullato: il fantasma sparisce');
    assert.deepStrictEqual(await bozza(page), prima, 'e lo slot sotto il dito non cambia');

    assert.deepStrictEqual(errs, []);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
});
