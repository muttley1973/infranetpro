'use strict';
// ============================================================
// E2E «SCOPRI» CON PIU' RETI (Chrome vero, server vero)
// ============================================================
// «Scopri» scansionava UN intervallo per volta e si apriva vuoto. Ora il campo e' una lista, sotto ci sono le «reti conosciute»
// (quelle a cui il server e' collegato e le subnet dichiarate nel progetto) da spuntare, e la scansione fa una rete dopo l'altra:
// mai in parallelo (anti-IDS), con i risultati fusi, e una rete che fallisce si dice senza fermare le altre.
// Il PIANO (/api/discover/plan) e le reti (/api/discover/networks) sono quelli VERI del server di prova; solo /api/discover
// e il crawl si recitano, cosi' non parte nessun pacchetto.
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

test('E2E «Scopri» con piu\' reti: reti conosciute da spuntare, una dopo l\'altra, risultati fusi, una che fallisce si dice', { skip: SKIP }, async () => {
  const srv = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await page.goto(srv.baseURL, { waitUntil: 'load' });
    await page.waitForFunction(() => { try { return typeof renderAll === 'function' && Array.isArray(state.nodes) && typeof openDiscovery === 'function'; } catch (e) { return false; } }, null, { timeout: 15000 });
    // ⚠️ Il progetto di avvio si carica DOPO che le funzioni esistono: se lo stato di prova lo si mette prima, il caricamento lo sostituisce
    // e i prefissi dichiarati spariscono (la prova cadeva a intermittenza, al primo giro dopo una pausa). Si aspetta il demo disegnato.
    await page.waitForFunction(() => document.querySelectorAll('[data-pid]').length > 10, null, { timeout: 15000 });

    // — un progetto con tre prefissi dichiarati: una /24 con VLAN, una /16 (troppo larga) e un IPv6 (non si scansiona)
    await page.evaluate(() => {
      setLang('it');
      state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
      state.nodes.length = 0; state.links.length = 0; state.ports = {};
      state.ipam = state.ipam || {};
      state.ipam.prefixes = [{ cidr: '10.20.30.0/24', vlan: 20 }, { cidr: '10.40.0.0/16', vlan: null }, { cidr: '2001:db8::/64', vlan: null }];
      state.vlanNames = Object.assign({}, state.vlanNames, { 20: 'Uffici' });
      if (typeof _invalidateIdx === 'function') _invalidateIdx();
      openDiscovery();
    });
    // Se la lista non arriva, il motivo sta nel messaggio (non un generico «Timeout»): stato del contenitore e richieste fatte.
    const attesa = await page.waitForFunction(() => !!document.querySelector('#disc-nets-list input[data-cidr="10.20.30.0/24"]'), null, { timeout: 20000 }).then(() => null, () => null);
    if (attesa === null && !(await page.evaluate(() => !!document.querySelector('#disc-nets-list input[data-cidr="10.20.30.0/24"]')))) {
      const diag = await page.evaluate(() => ({ nascosto: document.getElementById('disc-nets').hidden, righe: document.querySelectorAll('#disc-nets-list .disc-net').length, html: document.getElementById('disc-nets-list').innerHTML.slice(0, 200) }));
      assert.fail('le reti conosciute non sono comparse in 20 s: ' + JSON.stringify(diag) + ' errori: ' + errs.join(' | '));
    }

    // 1) il campo e' una LISTA (textarea) e sta alla stessa altezza degli altri campi della riga
    const campo = await page.evaluate(() => {
      const f = document.getElementById('disc-subnet');
      return { tag: f.tagName, h: f.offsetHeight, hCommunity: document.getElementById('disc-community').offsetHeight, ph: f.placeholder };
    });
    assert.strictEqual(campo.tag, 'TEXTAREA');
    assert.ok(Math.abs(campo.h - campo.hCommunity) <= 2, `il campo e' alto come gli altri (${campo.h} contro ${campo.hCommunity})`);
    assert.match(campo.ph, /192\.168\.1\.0\/24, /, 'il suggerimento mostra una lista');

    // 2) le reti conosciute: quelle della macchina sono QUELLE DEL SERVER (stessa lista, stesso «si puo' scansionare»), poi le dichiarate
    const server = await page.evaluate(() => fetch('/api/discover/networks').then((r) => r.json()));
    assert.strictEqual(server.ok, true);
    const righe = await page.evaluate(() => Array.from(document.querySelectorAll('#disc-nets-list .disc-net')).map((l) => ({
      cidr: l.querySelector('input').dataset.cidr, off: l.classList.contains('off'), disabled: l.querySelector('input').disabled,
      meta: l.querySelector('.disc-net-meta').textContent, tip: l.getAttribute('data-tip') || '', checked: l.querySelector('input').checked,
    })));
    for (const n of server.networks) {
      const r = righe.find((x) => x.cidr === n.cidr);
      assert.ok(r, `la rete della macchina ${n.cidr} e' proposta`);
      assert.strictEqual(r.disabled, !n.scannable, `${n.cidr}: si spunta solo se si puo' scansionare`);
      assert.match(r.meta, /questa macchina/, 'dice che e\' della macchina');
    }
    const uffici = righe.find((x) => x.cidr === '10.20.30.0/24');
    assert.ok(uffici && !uffici.disabled, 'la subnet dichiarata e\' proposta e si spunta');
    assert.match(uffici.meta, /VLAN 20 — Uffici/, 'dice a quale VLAN appartiene');
    assert.match(uffici.meta, /254 host/);
    const larga = righe.find((x) => x.cidr === '10.40.0.0/16');
    assert.ok(larga && larga.disabled && larga.off, 'una /16 si vede ma non si spunta');
    assert.match(larga.tip, /Prefisso \/22 - \/30/, 'e il suggerimento dice perche\' (il motivo del tetto)');
    assert.ok(!righe.some((x) => x.cidr.includes(':')), 'un prefisso IPv6 non e\' una rete da scansionare');
    assert.ok(righe.every((x) => !x.checked), 'nessuna rete e\' spuntata da sola: la scelta e\' della persona');

    // 3) spuntare aggiunge la voce AL TESTO; il testo e' l'unica fonte e le caselle lo seguono
    await page.click('#disc-nets-list input[data-cidr="10.20.30.0/24"]');
    assert.strictEqual(await page.inputValue('#disc-subnet'), '10.20.30.0/24');
    assert.strictEqual(await page.evaluate(() => document.getElementById('disc-vlan').disabled), false, 'con UNA rete l\'associazione a una VLAN resta possibile');
    await page.fill('#disc-subnet', '10.20.30.0/24, 192.168.77.0/24');
    assert.strictEqual(await page.isChecked('#disc-nets-list input[data-cidr="10.20.30.0/24"]'), true, 'una voce scritta a mano che coincide spunta la casella');
    assert.strictEqual(await page.evaluate(() => document.getElementById('disc-vlan').disabled), true, 'con piu\' reti l\'associazione a UNA VLAN e\' spenta');
    assert.match(await page.textContent('#disc-vlan-hint'), /una rete sola/i, 'e il suggerimento lo dice');
    await page.click('#disc-nets-list input[data-cidr="10.20.30.0/24"]');
    assert.strictEqual(await page.inputValue('#disc-subnet'), '192.168.77.0/24', 'togliere la spunta toglie solo quella voce');
    assert.strictEqual(await page.evaluate(() => document.getElementById('disc-vlan').disabled), false, 'tornata una rete sola, la VLAN si puo\' scegliere di nuovo');
    // le caselle SEGUONO il testo in tutti e due i sensi: una voce scritta a mano accende la casella spenta, un testo svuotato la spegne
    const casella = '#disc-nets-list input[data-cidr="10.20.30.0/24"]';
    assert.strictEqual(await page.isChecked(casella), false, 'a questo punto la casella e\' spenta');
    await page.fill('#disc-subnet', '10.20.30.0/24');
    assert.strictEqual(await page.isChecked(casella), true, 'scritta a mano mentre era spenta: la casella si accende');
    await page.fill('#disc-subnet', '');
    assert.strictEqual(await page.isChecked(casella), false, 'testo svuotato: la casella si spegne');

    // 4) una lista con una voce sbagliata NON parte, dice quale, e nessun pacchetto e' stato chiesto
    const posts = [];
    await page.route('**/api/discover', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      posts.push(JSON.parse(route.request().postData()).subnet);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, total: 0, results: [], warnings: [] }) });
    });
    const sbagliata = await page.evaluate(async () => {
      document.getElementById('disc-subnet').value = '10.20.30.0/24, banana';
      await runDiscovery();
      return document.getElementById('disc-progress').textContent.replace(/\s+/g, ' ');
    });
    assert.match(sbagliata, /banana/, 'dice QUALE voce e\' sbagliata');
    assert.match(sbagliata, /Formato non valido/, 'col motivo di sempre');
    assert.strictEqual(posts.length, 0, 'con un refuso nell\'elenco non parte nessuna scansione');
    await page.unroute('**/api/discover');

    // 5) due reti (+ una voce che sta dentro la prima): UNA DOPO L'ALTRA, mai insieme, risultati fusi (un indirizzo una volta sola)
    const riga = (ip, nome, snmp) => ({ ip, alive: true, pingReachable: true, status: 'On', hostname: nome, descr: '', objectId: '', snmpReachable: !!snmp, snmpDriver: snmp ? 'snmp-v2c' : '', snmpVersions: snmp ? ['snmp-v2c'] : [], needsCredentials: false, mac: '', vendor: '', httpTitle: '', httpsTitle: '', services: [], netbiosName: '', netbiosGroup: '', smbShares: [], cast: false });
    const log = [], comms = []; let inFlight = 0, maxInFlight = 0;   // `comms`: la community con cui e' partita ogni richiesta, nello stesso ordine di `log`
    const falliscono = new Set();
    let conAvvisi = false;   // ogni rete risponde con lo stesso avviso («manca ping»): in fondo deve comparire UNA volta
    await page.route('**/api/discover', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const b = JSON.parse(route.request().postData());
      log.push(b.subnet); comms.push(b.community); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 120));
      inFlight--;
      if (falliscono.has(b.subnet)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'rete irraggiungibile (prova)' }) });
      const base = b.subnet.startsWith('10.20.30') ? '10.20.30.' : '192.168.77.';
      const results = [riga(base + '10', 'host-' + base + '10', true), riga(base + '20', 'host-' + base + '20')];
      if (base === '192.168.77.') results.push(riga('10.20.30.10', 'doppione-di-una-rete-vicina'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, total: 254, results, warnings: conAvvisi ? [{ code: 'ping-missing', tool: 'ping' }] : [] }) });
    });
    const crawls = [];
    await page.route('**/api/discover/topology', async (route) => {
      crawls.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });   // non e' un event-stream: il client chiude la fase 2 senza leggere niente
    });
    const scan = (testo, espandi) => page.evaluate(async ({ testo, espandi }) => {
      const f = document.getElementById('disc-subnet');
      f.value = testo; f.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('disc-expand-topology').checked = !!espandi;
      const p = document.getElementById('disc-progress');
      const visti = [];
      const obs = new MutationObserver(() => visti.push(p.textContent.replace(/\s+/g, ' ')));
      obs.observe(p, { childList: true, subtree: true, characterData: true });
      await runDiscovery();
      obs.disconnect();
      return { visti, nAvvisi: p.querySelectorAll('div.tm-err').length, finale: p.textContent.replace(/\s+/g, ' '), righe: Array.from(document.querySelectorAll('#disc-tbody tr')).map((tr) => tr.textContent.replace(/\s+/g, ' ')) };
    }, { testo, espandi });

    let r = await scan('10.20.30.0/24, 192.168.77.0/24, 10.20.30.10-20', false);
    assert.deepStrictEqual(log, ['10.20.30.0/24', '192.168.77.0/24'], 'le reti partono nell\'ordine scritto, e la voce contenuta in un\'altra NON parte');
    assert.strictEqual(maxInFlight, 1, 'una dopo l\'altra: mai due richieste di scansione insieme (la base sweep non si parallelizza: anti-IDS)');
    assert.ok(r.visti.some((s) => /Rete 1 di 2 · 10\.20\.30\.0\/24/.test(s)), 'dice a che rete e\' arrivata');
    assert.ok(r.visti.some((s) => /Rete 2 di 2 · 192\.168\.77\.0\/24/.test(s)));
    assert.strictEqual(r.righe.length, 4, 'cinque risultati meno un doppione: 10.20.30.10 compare una volta sola (4 non 5)');
    assert.strictEqual(r.righe.filter((t) => /10\.20\.30\.10/.test(t)).length, 1, 'l\'indirizzo che due reti riportano e\' una riga');
    assert.match(r.finale, /10\.20\.30\.10-20 è già compresa in 10\.20\.30\.0\/24/, 'si dice cosa non e\' stato rifatto');
    assert.ok(!/non scansionate/.test(r.finale), 'nessuna rete fallita');

    // 5b) gli strumenti mancanti si dicono, e lo stesso avviso di due reti si dice UNA volta
    conAvvisi = true;
    r = await scan('10.20.30.0/24, 192.168.77.0/24', false);
    assert.strictEqual(r.nAvvisi, 1, 'l\'avviso «manca ping» compare una volta, non due (una per rete) e non zero');
    conAvvisi = false;

    // 6) con la fase 2 il filtro dei vicini vale per TUTTE le reti (la lista, non la prima)
    log.length = 0; crawls.length = 0;
    await scan('10.20.30.0/24, 192.168.77.0/24', true);
    assert.strictEqual(crawls.length, 1, 'il crawl parte una volta');
    assert.strictEqual(crawls[0].scanCidr, '10.20.30.0/24, 192.168.77.0/24', 'scanCidr porta la lista intera');

    // 7) una rete che fallisce SI DICE e le altre vanno avanti
    log.length = 0; falliscono.add('192.168.77.0/24');
    r = await scan('10.20.30.0/24, 192.168.77.0/24', false);
    assert.deepStrictEqual(log, ['10.20.30.0/24', '192.168.77.0/24'], 'la seconda e\' stata provata');
    assert.match(r.finale, /Reti non scansionate \(1\) — 192\.168\.77\.0\/24 \(rete irraggiungibile \(prova\)\)/, 'dice QUALE rete e perche\'');
    assert.strictEqual(r.righe.length, 2, 'i risultati della prima restano');

    // 8) con UNA rete sola il percorso e' quello di prima: niente «Rete 1 di 1», e un errore e' l'errore di sempre
    log.length = 0; falliscono.clear(); falliscono.add('10.20.30.0/24');
    r = await scan('10.20.30.0/24', false);
    assert.ok(!r.visti.some((s) => /Rete 1 di 1/.test(s)), 'una rete sola non si annuncia come «1 di 1»');
    assert.match(r.finale, /Errore: rete irraggiungibile \(prova\)/, 'errore di una rete sola: il messaggio di sempre');

    // 9) tutte le reti fallite: lo dice, senza tabella finta
    log.length = 0; falliscono.add('192.168.77.0/24');
    r = await scan('10.20.30.0/24, 192.168.77.0/24', false);
    assert.match(r.finale, /Nessuna rete scansionata/);
    assert.match(r.finale, /Reti non scansionate \(2\)/);

    // 10) COMMUNITY PER RETE: la sua per ogni rete, e quella che gli apparati gia' documentati in QUELLA rete usano si propone — da confermare
    // Apparati documentati con una community, a indirizzi che le scansioni finte NON restituiscono (non sono righe della tabella).
    await page.evaluate(() => {
      const mk = (id, ip, c) => state.nodes.push({ id, type: 'switch', name: id, ip, x: 50, y: 50, ports: 8, integration: { driver: 'snmp-v2c', community: c } });
      mk('u1', '10.20.30.101', 'segreta-uffici'); mk('u2', '10.20.30.102', 'segreta-uffici'); mk('u3', '10.20.30.103', 'segreta-uffici');
      mk('f1', '192.168.77.101', 'uno'); mk('f2', '192.168.77.102', 'due');
      if (typeof _invalidateIdx === 'function') _invalidateIdx();
    });
    const SEGRETA = 'segreta-uffici';
    const righeComm = () => page.evaluate(() => Array.from(document.querySelectorAll('#disc-comm-list .disc-comm-row')).map((x) => ({
      rete: x.querySelector('.disc-comm-range').textContent, nota: (x.querySelector('.disc-comm-note') || {}).textContent || '', bottone: !!x.querySelector('button'),
    })));
    const scrivi = async (testo) => { await page.fill('#disc-subnet', testo); await page.waitForTimeout(700); };
    await page.evaluate(() => { closeDiscovery(); openDiscovery(); });
    assert.strictEqual(await page.inputValue('#disc-community'), 'public', 'il campo comune NON si precompila piu\' dal primo apparato del progetto (con piu\' community era un caso)');

    // una rete sola, con apparati documentati: compare UNA riga col suggerimento
    await scrivi('10.20.30.0/24');
    await page.waitForFunction(() => document.querySelectorAll('#disc-comm-list .disc-comm-row').length === 1, null, { timeout: 10000 });
    let rc = await righeComm();
    assert.deepStrictEqual(rc, [{ rete: '10.20.30.0/24', nota: 'Documentati qui: 3', bottone: true }]);
    assert.ok(!(await page.content()).includes(SEGRETA), 'la community suggerita NON sta nel markup: il valore non passa dalla pagina finche\' non lo scegli');
    // se gli apparati documentati usano GIA' la community del campo comune non c'e' niente da proporre; con un'altra nel campo il suggerimento torna
    await page.fill('#disc-community', SEGRETA);
    await page.waitForFunction(() => document.getElementById('disc-comm').hidden, null, { timeout: 10000 });
    await page.fill('#disc-community', 'public');
    await page.waitForFunction(() => !document.getElementById('disc-comm').hidden, null, { timeout: 10000 });
    // una rete senza apparati documentati: niente blocco
    await scrivi('10.99.0.0/24');
    await page.waitForFunction(() => document.getElementById('disc-comm').hidden, null, { timeout: 10000 });
    // due reti: una con una community sola, una con community DIVERSE (non se ne sceglie una a caso: si dice e basta)
    await scrivi('10.20.30.0/24, 192.168.77.0/24');
    await page.waitForFunction(() => document.querySelectorAll('#disc-comm-list .disc-comm-row').length === 2, null, { timeout: 10000 });
    rc = await righeComm();
    assert.deepStrictEqual(rc[0], { rete: '10.20.30.0/24', nota: 'Documentati qui: 3', bottone: true });
    assert.deepStrictEqual(rc[1], { rete: '192.168.77.0/24', nota: 'Documentati qui: 2, con 2 community diverse', bottone: false });
    assert.ok(!(await page.content()).includes('>uno<') && !(await page.content()).includes(SEGRETA));

    // con un clic il suggerimento va nel campo MASCHERATO della rete, e il suggerimento usato scompare
    await page.click('#disc-comm-list .disc-comm-use');
    const campoRete = await page.evaluate(() => { const i = Array.from(document.querySelectorAll('#disc-comm-list input[data-range]')).find((x) => x.dataset.range === '10.20.30.0/24'); return { v: i.value, t: i.type }; });
    assert.deepStrictEqual(campoRete, { v: SEGRETA, t: 'password' });
    assert.strictEqual(await page.evaluate(() => !!document.querySelector('#disc-comm-list .disc-comm-use')), false, 'usato: il suggerimento scompare');
    assert.ok(!(await page.content()).includes(SEGRETA), 'nemmeno dopo l\'uso il valore e\' nel markup');

    // la scansione manda a OGNI rete la SUA community: quella scelta per la prima, quella del campo comune per l'altra
    log.length = 0; comms.length = 0; crawls.length = 0; falliscono.clear();
    r = await scan('10.20.30.0/24, 192.168.77.0/24', false);
    assert.deepStrictEqual(log, ['10.20.30.0/24', '192.168.77.0/24']);
    assert.deepStrictEqual(comms, [SEGRETA, 'public'], 'la prima rete parte con la sua community, la seconda con quella del campo comune');

    // e il crawl dei vicini parte UNA volta per community, coi semi delle SUE reti
    log.length = 0; comms.length = 0; crawls.length = 0;
    await scan('10.20.30.0/24, 192.168.77.0/24', true);
    assert.deepStrictEqual(crawls.map((c) => c.community), [SEGRETA, 'public'], 'un crawl per community diversa, nell\'ordine delle reti');
    assert.deepStrictEqual(crawls.map((c) => c.seeds), [['10.20.30.10'], ['192.168.77.10']], 'ognuno coi semi delle sue reti (un seme non esce con la credenziale di un\'altra rete)');
    assert.ok(crawls.every((c) => c.scanCidr === '10.20.30.0/24, 192.168.77.0/24'), 'il filtro dei vicini vale per tutte le reti');

    // una community scritta per una rete che NON si vede piu' non si usa di nascosto
    await page.click('#disc-new-search');   // dopo una scansione il dialogo mostra i risultati: «Nuova ricerca» torna al modulo
    await scrivi('10.98.0.0/24, 10.99.0.0/24');
    await page.waitForFunction(() => document.querySelectorAll('#disc-comm-list .disc-comm-row').length === 2, null, { timeout: 10000 });
    await page.fill('#disc-comm-list input[data-range="10.99.0.0/24"]', 'nascosta');
    await scrivi('10.99.0.0/24');
    await page.waitForFunction(() => document.getElementById('disc-comm').hidden, null, { timeout: 10000 });
    log.length = 0; comms.length = 0; crawls.length = 0;
    await scan('10.99.0.0/24', false);
    assert.deepStrictEqual(comms, ['public'], 'il blocco non si vede: la community scritta prima per quella rete NON parte');

    // chiudere il dialogo svuota le community per rete: non restano nella pagina
    await page.click('#disc-new-search');
    await scrivi('10.98.0.0/24, 10.99.0.0/24');
    await page.waitForFunction(() => document.querySelectorAll('#disc-comm-list .disc-comm-row').length === 2, null, { timeout: 10000 });
    assert.strictEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#disc-comm-list input[data-range]')).find((x) => x.dataset.range === '10.99.0.0/24').value), 'nascosta', 'finche\' il dialogo e\' aperto il valore resta');
    await page.evaluate(() => { closeDiscovery(); openDiscovery(); });
    await page.waitForFunction(() => document.querySelectorAll('#disc-comm-list .disc-comm-row').length === 2, null, { timeout: 10000 });
    assert.deepStrictEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#disc-comm-list input[data-range]')).map((x) => x.value)), ['', ''], 'chiuso e riaperto: le community per rete sono vuote');

    await page.evaluate(() => closeDiscovery());
    assert.deepStrictEqual(errs, [], 'nessun errore di pagina: ' + errs.join(' | '));
  } finally {
    await browser.close();
    await srv.close();
  }
});
