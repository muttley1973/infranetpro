'use strict';
// ============================================================
// E2E XSS FUZZ — un progetto OSTILE nei campi che NON sono testo libero
// ============================================================
// Il testo libero (nome, note, hostname…) passa da escapeHTML() su più di mille
// interpolazioni scritte a mano, e il cricchetto di test/html-escaping.test.js tiene il
// conto di ciò che non riesce a dimostrare. Resta fuori da quel conto proprio ciò che
// «non sembra» testo: gli IDENTIFICATORI (`link.id`, `rack.id`, `node.id`…) e i campi
// NUMERICI (`integration.port`, `integration.timeout`, `rackU`…). Un editor, un file
// importato o una chiamata alle API possono scriverci una stringa qualunque; un
// pannello che la interpola senza escape la esegue nel browser di chi apre il progetto
// — anche di un viewer, anche dell'admin.
//
// Questo test costruisce un progetto dove OGNI foglia numerica e OGNI identificatore
// porta un payload tracciabile, lo carica per la stessa via di un progetto aperto
// (`_migrateState`), apre ogni pannello e dice QUALE campo, se uno, ha eseguito codice.
// Il payload copre i due contesti che contano: attributo HTML (`"><img onerror>`) e
// testo (`<img onerror>` è incluso nello stesso valore).
//
// OFF di default come gli altri e2e: RUN_E2E=1.
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

test('E2E XSS fuzz: identificatori e campi numerici ostili non eseguono codice', { skip: SKIP }, async () => {
  const srv = await startServer();
  const ciArgs = process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ciArgs });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

  try {
    await page.goto(srv.baseURL, { waitUntil: 'load' });
    await page.waitForFunction(() => {
      try { return typeof renderAll === 'function' && typeof _migrateState === 'function' && Array.isArray(state.nodes); }
      catch (e) { return false; }
    }, null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-pid]').length > 10, null, { timeout: 15000 });

    // ── 1) il progetto ostile, caricato come si carica un progetto ────────────
    const built = await page.evaluate(() => {
      const tags = [];                      // [tag, percorso]
      const P = (path) => {
        const tag = 'X' + tags.length;
        tags.push([tag, path]);
        return `"><img src=x onerror="window.__xss=(window.__xss||[]);window.__xss.push('${tag}')">`;
      };
      const fresh = JSON.parse(JSON.stringify(_migrateState(_buildDefaultState())));
      fresh.nodes = []; fresh.links = []; fresh.ports = {}; fresh.racks = [];

      // Identificatori: un rack, due nodi, un cavo, un piano e una stanza con id ostile,
      // riferiti in modo COERENTE (rackId, porte, estremi del cavo) come in un progetto vero.
      const rackId = P('rack.id'), nodeA = P('node.id'), nodeB = P('node.id(2)');
      fresh.racks.push({ id: rackId, name: 'R', sizeU: 42 });
      fresh.currentRack = rackId;

      const common = () => ({ name: 'N', ip: '10.0.0.5', mac: '00:11:22:33:44:55', brand: 'Acme', model: 'M' });
      const nodes = [];
      const mk = (id, type, extra) => { const n = Object.assign({ id, type }, common(), extra); nodes.push(n); return n; };

      // Una foglia numerica ostile per OGNI chiave numerica plausibile di un nodo da rack…
      const numKeysRack = ['rackU', 'sizeU', 'ports', 'vlan', 'mgmtVlan', 'stackSize', 'poeBudget', 'uplinks'];
      const rackNode = mk(nodeA, 'switch', { rackId, rackU: 3, sizeU: 1, ports: 4,
        integration: { driver: 'snmp-v2c', host: '10.0.0.5', community: 'public', port: 161, timeout: 3, retries: 1, interval: 60 } });
      const hostile = {};
      for (const k of numKeysRack) hostile[k] = P('node.' + k);
      // …su nodi separati, così un layout rotto da un valore non nasconde gli altri.
      numKeysRack.forEach((k, i) => {
        const n = mk('rk' + i, 'switch', { rackId, rackU: 10 + i * 2, sizeU: 1, ports: 4 });
        n[k] = hostile[k];
      });
      rackNode.integration.port = P('integration.port');
      rackNode.integration.timeout = P('integration.timeout');
      rackNode.integration.retries = P('integration.retries');
      rackNode.integration.interval = P('integration.interval');

      const floorKeys = ['x', 'y', 'w', 'h', 'ports', 'vlan'];
      floorKeys.forEach((k, i) => {
        const n = mk('fl' + i, 'pc', { x: 300 + i * 80, y: 300, ports: 1 });
        n[k] = P('floor.' + k);
      });
      mk(nodeB, 'pc', { x: 700, y: 400, ports: 1 });

      // Nodi di ogni tipo, col loro id ostile e le foglie numeriche note.
      let k = 0;
      for (const type of Object.keys(TYPES)) {
        if (['room', 'storey', 'wallport'].includes(type)) continue;
        const def = TYPES[type];
        const id = 'ty' + (++k);
        const n = mk(id, type, def.isRack ? { rackId, rackU: 1, sizeU: def.sizeU || 1, ports: Math.min(def.ports || 2, 4) }
                                           : { x: 900 + (k % 6) * 60, y: 100 + Math.floor(k / 6) * 60, ports: Math.min(def.ports || 1, 4) });
        n.integration = { driver: 'snmp-v2c', host: '10.1.0.' + k, community: 'public', port: P('integration.port(' + type + ')'), timeout: P('integration.timeout(' + type + ')') };
        if (def.hostsVms) n.vms = [{ id: P('vm.id(' + type + ')'), name: 'VM', os: 'Linux', ip: '10.2.0.' + k, cpu: P('vm.cpu'), ram: P('vm.ram'), disk: P('vm.disk'), vlan: P('vm.vlan') }];
      }
      fresh.nodes = nodes;

      // Porte con campi numerici/enumerati ostili, e cavi con id ostile.
      const portKeys = ['vlan', 'vlanOvr', 'speed', 'mtu', 'lagId', 'poeWatts', 'nativeVlan', 'pvid'];
      for (const n of nodes.slice(0, 40)) {
        const np = Math.min(Number(n.ports) || 1, 4);
        for (let p = 1; p <= np; p++) fresh.ports[`${n.id}-${p}`] = { status: 'active' };
      }
      const pids = Object.keys(fresh.ports);
      pids.slice(0, 12).forEach((pid, i) => { fresh.ports[pid][portKeys[i % portKeys.length]] = P('port.' + portKeys[i % portKeys.length]); });
      const linkKeys = ['length', 'vlan', 'nativeVlan', 'lagId', 'speed'];
      const free = pids.filter((p) => !p.startsWith('rk') || true);
      for (let i = 0; i + 1 < free.length && i < 16; i += 2) {
        const l = { id: i === 0 ? P('link.id') : 'lk' + i, src: free[i], dst: free[i + 1], label: 'c' };
        l[linkKeys[i % linkKeys.length]] = P('link.' + linkKeys[i % linkKeys.length]);
        fresh.links.push(l);
      }
      // Id ostili anche su piani e stanze, e su una VLAN IPAM.
      fresh.floors = [{ id: P('floor.id'), name: 'F' }];
      fresh.rooms = [{ id: P('room.id'), name: 'S', x: P('room.x'), y: P('room.y'), w: P('room.w'), h: P('room.h') }];

      window.__tags = tags;
      state = _migrateState(fresh);
      if (typeof _invalidateIdx === 'function') _invalidateIdx();
      renderAll();
      return { tags: tags.length, nodes: state.nodes.length, links: state.links.length,
               ids: { nodeA: state.nodes.find(n => n.type === 'switch' && n.integration && n.integration.interval !== undefined)?.id || state.nodes[0].id,
                      rack: (state.racks[0] || {}).id, link0: (state.links[0] || {}).id, floor: ((state.floors || [])[0] || {}).id } };
    });
    if (process.env.XSS_FUZZ_VERBOSE) console.log('ids dopo il caricamento:', JSON.stringify(built.ids).slice(0, 600));
    assert.ok(built.tags > 60, 'il progetto ostile porta molti punti di iniezione: ' + built.tags);

    // ── 2) si apre tutto ──────────────────────────────────────────────────────
    const openEverything = async () => {
      await page.waitForTimeout(500);
      const nodeIds = await page.evaluate(() => state.nodes.map((n) => n.id));
      for (const id of nodeIds) {
        await page.evaluate((nid) => { selType = 'node'; selId = nid; renderAll(); }, id).catch(() => {});
        await page.click('#tab-props', { timeout: 400 }).catch(() => {});
        await page.click('[data-act="props-expand-all"]', { timeout: 300 }).catch(() => {});
        await page.waitForTimeout(40);
      }
      await page.click('#tab-rack', { timeout: 500 }).catch(() => {});
      await page.waitForTimeout(200);
      const linkIds = await page.evaluate(() => (state.links || []).map((l) => l.id));
      for (const id of linkIds) {
        await page.evaluate((lid) => { selType = 'link'; selId = lid; renderAll(); }, id).catch(() => {});
        await page.click('#tab-props', { timeout: 300 }).catch(() => {});
        await page.click('[data-act="props-expand-all"]', { timeout: 300 }).catch(() => {});
        await page.waitForTimeout(40);
      }
      const portIds = await page.evaluate(() => Object.keys(state.ports || {}).slice(0, 80));
      for (const pid of portIds) {
        await page.evaluate((p) => { selType = 'port'; selId = p; renderAll(); }, pid).catch(() => {});
        await page.click('[data-act="props-expand-all"]', { timeout: 200 }).catch(() => {});
        await page.waitForTimeout(25);
      }
      // popup di porta e pannelli globali
      for (const el of (await page.$$('[data-pid]')).slice(0, 30)) {
        await el.click({ timeout: 250, force: true }).catch(() => {});
        await page.waitForTimeout(20);
        await page.keyboard.press('Escape').catch(() => {});
      }
      const btns = await page.$$('button[id^="btn-"], [data-act], [role=tab], summary');
      for (const b of btns.slice(0, 220)) {
        const id = (await b.getAttribute('id')) || ''; const act = (await b.getAttribute('data-act')) || '';
        if (/delete|remove|logout|clear|reset|del-|erase|wipe|poll|discover|scan|sync|dcim|ai-|export|download|print|pdf|snapshot|undo|redo|import|save|new-project/i.test(id + act)) continue;
        await b.click({ timeout: 200, force: true }).catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
      }
      await page.waitForTimeout(500);
    };
    const firedWhere = () => page.evaluate(() => {
      const m = new Map(window.__tags);
      return [...new Set((window.__xss || []).map((x) => m.get(x) || x))];
    });

    await openEverything();

    // ── 3) l'esito del CARICAMENTO ────────────────────────────────────────────
    const where = await firedWhere();
    const injected = await page.evaluate(() => ({
      img: document.querySelectorAll('img[src="x"]').length,
      onerror: document.querySelectorAll('[onerror]').length,
    }));
    if (process.env.XSS_FUZZ_VERBOSE) console.log('fase 1 (caricamento) fired:', JSON.stringify(where), 'dom:', JSON.stringify(injected), 'pageErrors:', pageErrors.length, pageErrors.slice(0, 5));
    assert.deepEqual(where, [], 'caricando il progetto ostile hanno ESEGUITO codice: ' + where.join(', '));
    assert.deepEqual(injected, { img: 0, onerror: 0 }, 'nessun elemento iniettato è finito nel DOM');
    assert.deepEqual(pageErrors, [], 'un progetto ostile non deve nemmeno rompere il render: ' + pageErrors.join(' | '));

    // ── 4) la seconda difesa: l'USCITA ────────────────────────────────────────
    // Il caricamento ha già riportato a numero ciò che doveva esserlo. Ma un valore ostile
    // può entrare nello stato anche dopo (un'altra scheda, un'importazione che non passa dal
    // caricamento): qui si scrive il payload DIRETTAMENTE nello stato vivo, saltando
    // `_migrateState`, e si riapre tutto. I pannelli devono escapare da soli.
    const tainted = await page.evaluate(() => {
      window.__xss = [];
      const tags = window.__tags;
      const P = (path) => {
        const tag = 'Y' + tags.length;
        tags.push([tag, path]);
        return `"><img src=x onerror="window.__xss=(window.__xss||[]);window.__xss.push('${tag}')">`;
      };
      let n = 0;
      // ⚠️ Senza condizione `k in node`: il caricamento ha CANCELLATO i numeri ostili, e un
      // fuzz che scrivesse solo dove la chiave c'è ancora non scriverebbe niente — e passerebbe.
      for (const node of state.nodes) {
        for (const k of ['ports', 'rackU', 'sizeU', 'x', 'y', 'w', 'h']) { node[k] = P('uscita node.' + k); n++; }
        node.integration = node.integration || { driver: 'snmp-v2c', host: '10.0.0.9', community: 'public' };
        for (const k of ['port', 'timeout', 'retries', 'interval']) { node.integration[k] = P('uscita integration.' + k); n++; }
      }
      for (const pid of Object.keys(state.ports)) { state.ports[pid].vlanOvr = P('uscita port.vlanOvr'); n++; }
      for (const l of state.links) { l.length = P('uscita link.length'); n++; }
      // gli id: anche dopo il caricamento un id nuovo (rack, cavo) deve uscire escapato
      if (state.racks[0]) { state.racks[0].name = 'R'; }
      state.racks.push({ id: P('uscita rack.id'), name: 'R2', sizeU: 42 });
      if (state.links[0]) { state.links[0].id = P('uscita link.id'); }
      n += 2;
      if (typeof _invalidateIdx === 'function') _invalidateIdx();
      return n;
    });
    assert.ok(tainted > 40, 'campi ostili scritti nello stato vivo: ' + tainted);
    await openEverything();
    const where2 = await firedWhere();
    if (where2.length && process.env.XSS_FUZZ_VERBOSE) {
      const ctx = await page.evaluate(() => [...document.querySelectorAll('img[src="x"]')].slice(0, 6).map((e) => {
        const host = e.parentElement; return (host ? host.tagName + '#' + host.id + '.' + host.className + ' <- ' + (host.parentElement ? host.parentElement.className : '') : '?');
      }));
      console.log('contesto delle <img> iniettate:', JSON.stringify(ctx));
    }
    if (process.env.XSS_FUZZ_VERBOSE) console.log('fase 2 (uscita) fired:', JSON.stringify(where2), 'pageErrors:', pageErrors.length, pageErrors.slice(0, 3));
    assert.deepEqual(where2, [], 'senza passare dal caricamento hanno ESEGUITO codice: ' + where2.join(', '));
  } finally {
    await browser.close();
    await srv.close();
  }
});
