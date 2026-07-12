'use strict';
// ============================================================
// E2E HEADLESS REALE — carica l'app in un Chrome vero (Playwright su Chrome
// di sistema, niente Chromium scaricato) bypassando il login via
// INFRANET_DEV_NO_AUTH, ed esercita i FLUSSI CRITICI sul DOM/JS reale del
// browser. Toglie il punto cieco "non riproducibile in browser" che gli smoke
// su DOM-stub (node:vm) non possono coprire: ordine/caricamento reale degli
// script, API DOM/SVG reali, event wiring del pointer.
//
// OFF di default (richiede Chrome + spawn del server): si attiva con RUN_E2E=1.
//   RUN_E2E=1 npm run e2e        oppure        RUN_E2E=1 node --test test/e2e
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const RUN = process.env.RUN_E2E === '1';
const SKIP = RUN ? false : 'E2E headless OFF (RUN_E2E=1 per attivarlo; richiede Chrome di sistema)';

// require pigro: senza RUN_E2E non tocchiamo playwright né spawniamo il server.
let chromium, startServer;
if (RUN) {
  ({ chromium } = require('playwright-core'));
  ({ startServer } = require('./helpers/server.js'));
}

// Una route 404 attesa: il browser chiede /favicon.ico (nessuna favicon servita).
const isBenign404 = (u) => /\/favicon\.ico(\?|$)/.test(u);

test('E2E flussi critici nel browser reale (Chrome headless)', { skip: SKIP }, async (t) => {
  const srv = await startServer();
  // In CI (utente non-root, niente /dev/shm ampio) Chrome headless può crashare
  // senza questi flag; in locale process.env.CI è assente → args:[] → comportamento
  // identico a prima. Chrome è preinstallato sui runner ubuntu-latest (channel:'chrome').
  const ciArgs = process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ciArgs });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

  const pageErrors = [];
  const consoleErrors = [];
  const httpErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) httpErrors.push({ url: r.url(), status: r.status() }); });

  try {
    await page.goto(srv.baseURL, { waitUntil: 'load' });
    // L'app è pronta quando i globali chiave esistono e lo stato è caricato.
    await page.waitForFunction(() => {
      try { return typeof renderAll === 'function' && typeof state === 'object' && Array.isArray(state.nodes); }
      catch (e) { return false; }
    }, null, { timeout: 15000 });
    // init() rende via renderAll(), che COALESCE il primo paint in un
    // requestAnimationFrame (app-render-core.js:35). In headless CI il rAF può
    // essere throttlato → un waitForTimeout fisso è una race: lo stato risulta
    // caricato (state.nodes pieno) ma il DOM non ha ancora le porte, e il boot
    // falliva su dataPid=0 solo in CI. Aspetta la POST-CONDIZIONE osservabile:
    // il primo render ha davvero prodotto le porte [data-pid] nel DOM.
    await page.waitForFunction(
      () => document.querySelectorAll('[data-pid]').length > 10,
      null, { timeout: 15000 });

    await t.test('boot: bundle caricato in Chrome reale, nessun errore JS, default render produce DOM', async () => {
      const info = await page.evaluate(() => ({
        nodes: (state.nodes || []).length,
        links: (state.links || []).length,
        dataPid: document.querySelectorAll('[data-pid]').length,
        fnsOk: typeof renderAll === 'function' && typeof renderProps === 'function' &&
          typeof propagateVlans === 'function' && typeof _effPortVlan === 'function' &&
          typeof getCablePath === 'function' && typeof setClientAssoc === 'function' &&
          typeof apSsidList === 'function' && typeof validMidTypes === 'function',
      }));
      assert.equal(pageErrors.length, 0, 'errori JS in pagina: ' + pageErrors.join(' | '));
      const realConsoleErrs = consoleErrors.filter((m) => !/Failed to load resource/.test(m));
      assert.deepEqual(realConsoleErrs, [], 'errori console (oltre al 404 risorsa): ' + realConsoleErrs.join(' | '));
      const badHttp = httpErrors.filter((e) => !isBenign404(e.url));
      assert.deepEqual(badHttp, [], 'risposte HTTP di errore inattese: ' + JSON.stringify(badHttp));
      assert.ok(info.fnsOk, 'funzioni di ingresso chiave definite nel browser reale');
      assert.ok(info.nodes >= 5, 'stato di default caricato (nodi)');
      assert.ok(info.dataPid > 10, 'render reale: porte [data-pid] presenti nel DOM');
    });

    await t.test('instradamento cavi: getCablePath è direction-true (niente nodo) nel browser reale', async () => {
      const r = await page.evaluate(() => ({
        horiz: getCablePath(10, 20, 210, 20),
        vert: getCablePath(20, 10, 20, 210),
      }));
      // Orizzontale: i punti di controllo restano sulla y degli estremi (no nodo verticale).
      assert.match(r.horiz, /^M 10 20 C \S+ 20,\S+ 20,210 20$/, 'cavo orizzontale piega solo in x: ' + r.horiz);
      // Verticale: i punti di controllo restano sulla x degli estremi (no nodo orizzontale).
      assert.match(r.vert, /^M 20 10 C 20 \S+,20 \S+,20 210$/, 'cavo verticale piega solo in y: ' + r.vert);
    });

    await t.test('instradamento cavi: validMidTypes/canRouteThrough applicano la gerarchia TIA-568', async () => {
      const r = await page.evaluate(() => ({
        wpSwitch: validMidTypes('wallport', 'switch'),
        pcThroughPp: canRouteThrough('pc', 'patchpanel', 'switch'),
        pcThroughPc: canRouteThrough('pc', 'pc', 'switch'),
      }));
      assert.deepEqual(r.wpSwitch, ['patchpanel'], 'tra wallport e switch passa solo il patch panel');
      assert.equal(r.pcThroughPp, true, 'pc→patchpanel→switch instradabile');
      assert.equal(r.pcThroughPc, false, 'pc→pc→switch NON instradabile');
    });

    await t.test('propagazione VLAN: AP serve un SSID/VLAN, il client wireless la eredita', async () => {
      const r = await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        state.nodes.length = 0; state.links.length = 0; state.ports = {};
        state.nodes.push(
          { id: 'ap', type: 'ap', name: 'AP', x: 0, y: 0, ports: 1, radios: [{ band: '5', ssids: [{ id: 'g', ssid: 'Guest', vlan: 20 }] }] },
          { id: 'cl', type: 'pc', name: 'CL', x: 9, y: 9, ports: 1, radios: [{}] });
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        const wl = _createLinkRecord('ap-radio', 'cl-radio'); wl.wireless = true;
        state.links.push(wl); if (typeof _invalidateIdx === 'function') _invalidateIdx();
        _assignWirelessBss(wl); // 1 solo SSID → bss assegnato in automatico
        propagateVlans();
        return { bss: wl.bss, clientVlan: _effPortVlan('cl-radio') };
      });
      assert.equal(r.bss, 'g', 'associazione automatica al BSS unico');
      assert.equal(r.clientVlan, 20, 'il client eredita la VLAN del BSS servito dall’AP');
    });

    await t.test('wireless: ri-associare il client a un altro BSS ne cambia la VLAN', async () => {
      const r = await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        state.nodes.length = 0; state.links.length = 0; state.ports = {};
        state.nodes.push(
          { id: 'ap2', type: 'ap', name: 'AP2', x: 0, y: 0, ports: 1, radios: [{ ssids: [{ id: 'a', ssid: 'A', vlan: 30 }, { id: 'b', ssid: 'B', vlan: 40 }] }] },
          { id: 'c2', type: 'pc', name: 'C2', x: 9, y: 9, ports: 1, radios: [{}] });
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        const l2 = _createLinkRecord('ap2-radio', 'c2-radio'); l2.wireless = true;
        state.links.push(l2); if (typeof _invalidateIdx === 'function') _invalidateIdx();
        _assignWirelessBss(l2); // 2 SSID → nessuna assegnazione automatica
        _pickBss(l2.id, 'a'); propagateVlans();
        const vA = _effPortVlan('c2-radio');
        _pickBss(l2.id, 'b'); propagateVlans();
        const vB = _effPortVlan('c2-radio');
        return { vA, vB };
      });
      assert.equal(r.vA, 30, 'BSS A → VLAN 30');
      assert.equal(r.vB, 40, 'cambiando BSS a B → VLAN 40');
    });

    await t.test('app-wifi migrato: gestore radio + pannello SSID + report coerenza VLAN nel browser reale', async () => {
      const r = await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        state.nodes.length = 0; state.links.length = 0; state.ports = {};
        state.nodes.push(
          { id: 'apw', type: 'ap', name: 'AP-W', x: 0, y: 0, ports: 1, radios: [{ band: '5', channel: 44, ssids: [{ id: 's1', ssid: 'Corp', vlan: 20, security: 'wpa3-personal' }] }] },
          { id: 'clw', type: 'pc', name: 'CL-W', x: 9, y: 9, ports: 1, radios: [{}] });
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        const wl = _createLinkRecord('apw-radio', 'clw-radio'); wl.wireless = true;
        state.links.push(wl); if (typeof _invalidateIdx === 'function') _invalidateIdx();
        _assignWirelessBss(wl); // 1 SSID → bss assegnato in automatico

        // Gestore interfacce radio dell'AP (HTML builder esposto dal bundle).
        const ifaces = _radioIfacesHtml(state.nodes[0]);

        // Pannello della singola radio dell'AP, renderizzato in un elemento reale.
        const panel = document.createElement('div');
        selType = 'port'; selId = 'apw-radio';
        _renderRadioProps(panel, 'apw-radio');
        const radioPanelHtml = panel.innerHTML;

        // Aggiunta SSID + rinomina via i setter esposti (mutano stato + ri-render).
        const bid = addBss('apw', 0, 30);
        updateBssCfg('apw', 0, bid, 'ssid', 'Guest');
        const ssN = (apSsidList(state.nodes[0]) || []).length;

        // Pannello associazione: eredita il Wi-Fi dell'AP servente.
        const assoc = _wifiAssocHtml(wl);

        // Report coerenza VLAN wireless: apre l'overlay via event delegation (ASSE B:
        // openWifiVlanReport è una voce del menu Report con data-act, non su window), poi lo chiude.
        const reportDelegatedGone = typeof window.openWifiVlanReport === 'undefined';
        document.querySelector('[data-act="report-wifi"]').click();
        const ov = document.getElementById('wifivlan-overlay');
        const reportOpen = !!ov && ov.style.display === 'flex';
        _closeWifiVlanReport();
        const reportClosed = !!ov && ov.style.display === 'none';

        // cleanup: niente overlay/selezione residua per i test successivi.
        selType = null; selId = null;
        const bm = document.getElementById('bss-menu-overlay'); if (bm) bm.remove();
        if (ov) ov.remove();

        return {
          bss: wl.bss,
          ifacesHasInput: ifaces.indexOf('setNodeRadioCount') >= 0,
          radioPanelHasSsid: radioPanelHtml.indexOf('Corp') >= 0,
          radioPanelHasAddBtn: /addBss\(/.test(radioPanelHtml),
          ssN, bidOk: !!bid,
          assocInherits: assoc.indexOf('Corp') >= 0,
          reportOpen, reportClosed, reportDelegatedGone,
        };
      });
      assert.equal(r.bss, 's1', 'associazione automatica al BSS unico (s1)');
      assert.ok(r.bidOk, 'addBss ritorna un id BSS');
      assert.ok(r.ifacesHasInput, 'il gestore radio espone il setter conteggio (setNodeRadioCount)');
      assert.ok(r.radioPanelHasSsid, 'il pannello radio dell’AP mostra l’SSID Corp');
      assert.ok(r.radioPanelHasAddBtn, 'il pannello radio offre "Aggiungi SSID" (addBss)');
      assert.equal(r.ssN, 2, 'addBss aggiunge un secondo SSID (Corp + Guest)');
      assert.ok(r.assocInherits, 'il pannello associazione eredita l’SSID Corp dall’AP');
      assert.ok(r.reportDelegatedGone, 'ASSE B: openWifiVlanReport ritirata dal ponte (voce "VLAN Wi-Fi" del menu Report via data-act)');
      assert.ok(r.reportOpen, 'la voce "VLAN Wi-Fi" del menu Report (data-act) apre l’overlay');
      assert.ok(r.reportClosed, '_closeWifiVlanReport chiude l’overlay');
    });

    await t.test('app-properties-floor migrato: pannello contesto progetto + IPAM cross-boundary (_vlanIpamOpen)', async () => {
      const r = await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        state.vlanColors['10'] = '#00d4ff';
        state.vlanNames = state.vlanNames || {}; state.vlanNames['10'] = 'Uffici';
        const panel = document.createElement('div');
        _renderFloorProps(panel);
        const closed = panel.innerHTML;
        // cross-boundary: un writer classic mette VLAN 10 tra le IPAM aperte (Set
        // var-ificato su window); il modulo bundle deve leggerla via win._vlanIpamOpen.
        _vlanIpamOpen.add(10);
        _renderFloorProps(panel);
        const opened = panel.innerHTML;
        _vlanIpamOpen.clear();
        // Auto-poll + rinnovo IP non sono più in floor props: vivono nel popover
        // "Automazioni rete" in header (renderAutomationMenu su #automation-dropdown).
        state.autoPoll = { enabled: true, interval: 10 };
        state.autoIpRenew = true;
        renderAutomationMenu();
        const pop = (document.getElementById('automation-dropdown') || {}).innerHTML || '';
        return {
          hasHeader: closed.indexOf('Contesto progetto') >= 0,
          pollingMovedOut: closed.indexOf('Polling automatico SNMP') < 0,
          hasColors: closed.indexOf('Colori workspace') >= 0,
          hasVlan10Card: closed.indexOf('VLAN 10') >= 0,
          ipamClosed: closed.indexOf('Subnet / CIDR') < 0,
          ipamOpenedReflectsSet: opened.indexOf('Subnet / CIDR') >= 0,
          popHasPolling: pop.indexOf('Polling automatico SNMP') >= 0,
          popHasIpRenew: pop.indexOf('Rinnovo automatico IP') >= 0,
        };
      });
      assert.ok(r.hasHeader, 'header "Contesto progetto"');
      assert.ok(r.pollingMovedOut, 'Polling NON è più nel Contesto progetto (spostato nel popover Automazioni)');
      assert.ok(r.hasColors, 'sezione Colori workspace');
      assert.ok(r.hasVlan10Card, 'card VLAN 10 presente');
      assert.ok(r.ipamClosed, 'IPAM chiuso di default: niente campi Subnet');
      assert.ok(r.ipamOpenedReflectsSet, 'il modulo legge win._vlanIpamOpen: aprendo VLAN 10 compaiono i campi IPAM (cross-boundary)');
      assert.ok(r.popHasPolling, 'popover Automazioni: sezione Polling automatico SNMP');
      assert.ok(r.popHasIpRenew, 'popover Automazioni: sezione Rinnovo automatico IP (DHCP)');
    });

    await t.test('IPAM × DHCP: card VLAN aperta mostra l\'Occupazione (lib/ipam.js, opzione A) coi lease come fonte', async () => {
      const r = await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        state.nodes.length = 0; state.links.length = 0; state.ports = {};
        state.vlanColors['20'] = '#00d4ff';
        state.vlanNames = state.vlanNames || {}; state.vlanNames['20'] = 'Uffici';
        state.ipam = state.ipam || { vlans: {} };
        state.ipam.vlans['20'] = { subnet: '192.168.20.0/24', gateway: '192.168.20.1' };
        state.nodes.push({ id: 'pc20', type: 'pc', name: 'PC-20', x: 10, y: 10, ports: 1, ip: '192.168.20.10' });
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        // Lease: .10 = già documentato · .45 = solo-DHCP (non documentato) · .99 = SCADUTO
        // (deve essere ignorato da isLeaseStale). → usati = gateway(.1)+nodo(.10)+soloDHCP(.45) = 3.
        window._dhcpLeases = [
          { mac: 'AA:BB:CC:00:00:10', ip: '192.168.20.10', hostname: 'pc-20' },
          { mac: 'AA:BB:CC:00:00:45', ip: '192.168.20.45', hostname: 'tv-sala' },
          { mac: 'AA:BB:CC:00:00:99', ip: '192.168.20.99', state: 'expired' },
        ];
        const panel = document.createElement('div');
        _vlanIpamOpen.add(20);
        _renderFloorProps(panel);
        const withLeases = panel.innerHTML;
        // Manual-first: senza lease il blocco resta (soli documentati) ma sparisce la fonte "DHCP".
        window._dhcpLeases = null;
        _renderFloorProps(panel);
        const noLeases = panel.innerHTML;
        _vlanIpamOpen.clear();
        return {
          hasOcc: withLeases.indexOf('vlan-ipam-occ') >= 0,
          hasDhcpSrc: withLeases.indexOf('vlan-ipam-occ-src') >= 0,
          meta: withLeases.indexOf('3 / 254') >= 0,
          dhcpOnlyChip: withLeases.indexOf('solo DHCP') >= 0,
          freeChip: withLeases.indexOf('251 liberi') >= 0,
          noLeaseStillOcc: noLeases.indexOf('vlan-ipam-occ') >= 0,
          noLeaseNoSrc: noLeases.indexOf('vlan-ipam-occ-src') < 0,
          noLeaseNoDhcpOnly: noLeases.indexOf('solo DHCP') < 0,
        };
      });
      assert.ok(r.hasOcc, 'blocco Occupazione presente nella card IPAM aperta');
      assert.ok(r.hasDhcpSrc, 'occhiello "DHCP" presente quando ci sono lease nel CIDR');
      assert.ok(r.meta, 'occupazione = 3/254 (gateway + nodo + 1 solo-DHCP; lease scaduto ignorato da isLeaseStale)');
      assert.ok(r.dhcpOnlyChip, 'legenda mostra il chip "solo DHCP"');
      assert.ok(r.freeChip, 'legenda mostra gli IP liberi (251)');
      assert.ok(r.noLeaseStillOcc, 'manual-first: senza lease il blocco Occupazione resta (soli documentati)');
      assert.ok(r.noLeaseNoSrc, 'manual-first: senza lease sparisce la fonte "DHCP"');
      assert.ok(r.noLeaseNoDhcpOnly, 'manual-first: senza lease niente chip "solo DHCP"');
    });

    await t.test('IPAM × DHCP — Adotta dalla card: i "solo DHCP" diventano device documentati (no Verifica)', async () => {
      const r = await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        state.nodes.length = 0; state.links.length = 0; state.ports = {};
        state.vlanColors['20'] = '#00d4ff';
        state.vlanNames = state.vlanNames || {}; state.vlanNames['20'] = 'Uffici';
        state.ipam = state.ipam || { vlans: {} };
        state.ipam.vlans['20'] = { subnet: '192.168.20.0/24', gateway: '192.168.20.1' };
        state.nodes.push({ id: 'pc20', type: 'pc', name: 'PC-20', x: 10, y: 10, ports: 1, mac: 'AA:BB:CC:00:00:10', ip: '192.168.20.10' });
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        window._dhcpLeases = [
          { mac: 'AA:BB:CC:00:00:10', ip: '192.168.20.10', hostname: 'pc-20' },   // già documentato (MAC+IP)
          { mac: 'AA:BB:CC:00:00:45', ip: '192.168.20.45', hostname: 'tv-sala' }, // solo-DHCP → adottabile
          { mac: 'AA:BB:CC:00:00:99', ip: '192.168.20.99', state: 'expired' },    // scaduto → ignorato
        ];
        window._driftReport = null;   // nessuna Verifica: l'adozione da lease deve funzionare lo stesso

        // 1) la card aperta mostra il badge "Adotta" coi non documentati
        const panel = document.createElement('div');
        _vlanIpamOpen.add(20); _renderFloorProps(panel);
        const badge = panel.innerHTML;
        _vlanIpamOpen.clear();

        // 2) apri il modal seeded DIRETTAMENTE dai lease (senza Drift report)
        openAdoptFromLeases(20);
        const tb = document.getElementById('adopt-tbody').innerHTML;
        const rowCount = document.querySelectorAll('#adopt-tbody tr').length;

        // 3) adotta (flusso completo)
        selType = null; selId = null;   // contesto floor per il renderProps post-adozione
        const before = state.nodes.length;
        adoptApply();
        const after = state.nodes.length;
        const adopted = state.nodes.find(n => n.ip === '192.168.20.45') || {};

        // 4) ri-render: il device è ora documentato → l'ambra "solo DHCP" e il badge spariscono
        const panel2 = document.createElement('div');
        _vlanIpamOpen.add(20); _renderFloorProps(panel2);
        const afterHtml = panel2.innerHTML;
        _vlanIpamOpen.clear();
        window._dhcpLeases = null;
        const ov = document.getElementById('adopt-overlay'); if (ov) ov.style.display = 'none';

        return {
          badgeShown: badge.indexOf('vlan-ipam-occ-adopt') >= 0 && badge.indexOf('openAdoptFromLeases(20)') >= 0,
          modalHas45: tb.indexOf('AA:BB:CC:00:00:45') >= 0,
          modalNotDoc: tb.indexOf('AA:BB:CC:00:00:10') < 0,
          modalNotExpired: tb.indexOf('AA:BB:CC:00:00:99') < 0,
          rowCount,
          delta: after - before,
          adoptedIp: adopted.ip || '',
          adoptedName: adopted.name || '',
          adoptedMac: adopted.mac || '',
          amberGone: afterHtml.indexOf('vlan-ipam-occ-adopt') < 0 && afterHtml.indexOf('solo DHCP') < 0,
        };
      });
      assert.ok(r.badgeShown, 'la card IPAM aperta mostra il badge "Adotta" coi non documentati');
      assert.ok(r.modalHas45, 'il modal Adotta-da-lease mostra il MAC del lease solo-DHCP (.45)');
      assert.ok(r.modalNotDoc, 'il modal NON ripropone il lease già documentato (.10)');
      assert.ok(r.modalNotExpired, 'il modal NON mostra il lease scaduto (.99, isLeaseStale)');
      assert.equal(r.rowCount, 1, 'un solo candidato (il .45)');
      assert.equal(r.delta, 1, 'adoptApply crea 1 nodo');
      assert.equal(r.adoptedIp, '192.168.20.45', 'il device adottato nasce con l\'IP del lease');
      assert.equal(r.adoptedName, 'tv-sala', 'il device adottato prende il nome dal lease (hostname)');
      assert.equal(r.adoptedMac, 'AA:BB:CC:00:00:45', 'MAC del device adottato normalizzato');
      assert.ok(r.amberGone, 'adozione → device documentato → sparisce l\'ambra "solo DHCP" e il badge (loop chiuso)');
    });

    await t.test('VLAN di management: toggle persistente + i lease lì si adottano come infra (non endpoint)', async () => {
      const r = await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        state.nodes.length = 0; state.links.length = 0; state.ports = {};
        selType = null; selId = null;
        state.vlanColors['20'] = '#00d4ff';
        state.vlanNames = state.vlanNames || {}; state.vlanNames['20'] = 'Mgmt';
        state.ipam = state.ipam || { vlans: {} };
        state.ipam.vlans['20'] = { subnet: '192.168.20.0/24', gateway: '192.168.20.1' };
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        window._dhcpLeases = [{ mac: 'AA:BB:CC:00:00:45', ip: '192.168.20.45', hostname: 'sw-access' }];

        const wasEmpty = !(state.mgmtVlans || []).length;
        toggleMgmtVlan(20);
        const markedOn = (state.mgmtVlans || []).map(Number).includes(20);

        // la card VLAN mostra il pulsante management
        const panel = document.createElement('div');
        _vlanIpamOpen.add(20); _renderFloorProps(panel); _vlanIpamOpen.clear();
        const cardHasMgmtBtn = panel.innerHTML.indexOf('toggleMgmtVlan(20)') >= 0;

        // adozione dalla card: su VLAN di management il candidato è INFRA → typeDefault 'switch', non 'pc'
        openAdoptFromLeases(20);
        const tb = document.getElementById('adopt-tbody').innerHTML;
        // Contratto (B): su VLAN di management il candidato è INFRA (riga non
        // is-endpoint → in rack, non nascosto come BYOD). Il tipo di default poi
        // lo guida l'OUI come sempre — fuori scope qui.
        const rowIsInfra = tb.indexOf('AA:BB:CC:00:00:45') >= 0 && tb.indexOf('is-endpoint') < 0;
        const ov = document.getElementById('adopt-overlay'); if (ov) ov.style.display = 'none';

        toggleMgmtVlan(20);   // idempotenza: ri-clic toglie
        const markedOff = (state.mgmtVlans || []).map(Number).includes(20);
        window._dhcpLeases = null;
        return { wasEmpty, markedOn, cardHasMgmtBtn, rowIsInfra, markedOff };
      });
      assert.ok(r.wasEmpty, 'mgmtVlans parte vuoto');
      assert.ok(r.markedOn, 'toggleMgmtVlan marca la VLAN come management (persistito in state)');
      assert.ok(r.cardHasMgmtBtn, 'la card VLAN mostra il pulsante "VLAN di management"');
      assert.ok(r.rowIsInfra, 'su VLAN di management il candidato è classificato INFRA (riga non is-endpoint), non BYOD');
      assert.ok(!r.markedOff, 'toggleMgmtVlan è idempotente (ri-clic rimuove)');
    });

    await t.test('app-properties-port migrato: pannello switchport + delega a _renderRadioProps nel browser reale', async () => {
      const r = await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        state.nodes.length = 0; state.links.length = 0; state.ports = {};
        state.nodes.push(
          { id: 'sw', type: 'switch', name: 'SW1', x: 0, y: 0, ports: 4 },
          { id: 'apx', type: 'ap', name: 'APx', x: 9, y: 9, ports: 1, radios: [{ band: '5', ssids: [{ id: 'r1', ssid: 'Net', vlan: 20 }] }] });
        if (typeof _invalidateIdx === 'function') _invalidateIdx();

        // Switchport ATTIVO: Port ID + setter stato/desc + bottoni modalità Access/Trunk.
        const panel = document.createElement('div');
        selType = 'port'; selId = 'sw-1';
        _renderPortProps(panel);
        const swHtml = panel.innerHTML;

        // pid radio → _renderPortProps deve DELEGARE a win._renderRadioProps (app-wifi
        // già nel bundle): prova della chiamata cross-modulo via window.
        selType = 'port'; selId = 'apx-radio';
        _renderPortProps(panel);
        const radioHtml = panel.innerHTML;

        selType = null; selId = null;
        return {
          swHasPortId: swHtml.indexOf('Port ID') >= 0,
          swHasField: swHtml.indexOf('setPortField(') >= 0,
          swHasMode: swHtml.indexOf('setPortMode(') >= 0,
          radioDelegated: radioHtml.indexOf('Net') >= 0 || /addBss\(/.test(radioHtml),
        };
      });
      assert.ok(r.swHasPortId, 'switchport: mostra Port ID');
      assert.ok(r.swHasField, 'switchport: setter stato/descrizione (setPortField)');
      assert.ok(r.swHasMode, 'switchport attivo: bottoni modalità Access/Trunk (setPortMode)');
      assert.ok(r.radioDelegated, 'pid radio: _renderPortProps delega a _renderRadioProps (app-wifi)');
    });

    await t.test('app-properties-link migrato: pannello cavo + associazione wireless nel browser reale', async () => {
      const r = await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        state.nodes.length = 0; state.links.length = 0; state.ports = {};
        state.nodes.push(
          { id: 'sw', type: 'switch', name: 'SW1', x: 0, y: 0, ports: 4 },
          { id: 'pc', type: 'pc', name: 'PC1', x: 5, y: 5, ports: 1 },
          { id: 'ap', type: 'ap', name: 'AP1', x: 9, y: 9, ports: 1, radios: [{ band: '5', ssids: [{ id: 's1', ssid: 'Net', vlan: 20 }] }] },
          { id: 'cl', type: 'pc', name: 'CL1', x: 12, y: 12, ports: 1, radios: [{}] });
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        const cable = _createLinkRecord('sw-1', 'pc-1'); state.links.push(cable);
        const wl = _createLinkRecord('ap-radio', 'cl-radio'); wl.wireless = true; state.links.push(wl);
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        _assignWirelessBss(wl);

        const panel = document.createElement('div');
        // Cavo: header + endpoint Da/A (_cablePortDesc) + modalità + specifiche fisiche.
        selType = 'link'; selId = cable.id;
        _renderLinkProps(panel);
        const cableHtml = panel.innerHTML;

        // Wireless: sezione associazione che eredita il Wi-Fi via win._wifiAssocHtml.
        selType = 'link'; selId = wl.id;
        _renderLinkProps(panel);
        const wlHtml = panel.innerHTML;

        selType = null; selId = null;
        return {
          cableHasMode: /setLinkMode\(/.test(cableHtml),
          cableHasSrc: cableHtml.indexOf('SW1') >= 0,
          cablePortDescOk: cableHtml.indexOf('PC1') >= 0,
          cableHasSpecs: cableHtml.indexOf('setLinkProp(') >= 0,
          wlHasWifi: /fa-wifi/.test(wlHtml),
          wlInheritsSsid: wlHtml.indexOf('Net') >= 0,
        };
      });
      assert.ok(r.cableHasMode, 'cavo: bottoni modalità Access/Trunk (setLinkMode)');
      assert.ok(r.cableHasSrc, 'cavo: endpoint sorgente SW1');
      assert.ok(r.cablePortDescOk, 'cavo: descrittore porta altro capo (PC1) via _cablePortDesc');
      assert.ok(r.cableHasSpecs, 'cavo: sezione specifiche fisiche (setLinkProp)');
      assert.ok(r.wlHasWifi, 'wireless: sezione associazione (icona fa-wifi)');
      assert.ok(r.wlInheritsSsid, 'wireless: eredita l’SSID Net via win._wifiAssocHtml');
    });

    await t.test('app-properties (core) migrato: dispatcher renderProps + builder + stato sezioni nel browser reale', async () => {
      const r = await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        state.nodes.length = 0; state.links.length = 0; state.ports = {};
        state.nodes.push({ id: 'sv', type: 'server', name: 'SRV', x: 0, y: 0, ports: 2, ip: '10.0.0.5', mac: 'aa:bb:cc:dd:ee:ff' });
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        const panel = document.getElementById('props-panel');

        // 1) Dispatch su NODE → _renderNodeProps (ancora classic) via win.*
        selType = 'node'; selId = 'sv'; renderProps();
        const nodeHtml = panel.innerHTML;
        // 2) Dispatch "nessuna selezione" → _renderFloorProps
        selType = null; selId = null; renderProps();
        const floorHtml = panel.innerHTML;
        // 3) Builder condivisi diretti
        const header = _buildPropsHeader('T', 'sub', 'fa-server');
        const net = _buildNetAccessHtml(state.nodes[0], TYPES['server'] || {}, {});
        // 4) Stato sezioni: round-trip (module-private _propsSectionsState)
        setPropsSectionState('network-access', false);
        const closedAfterSet = _propsSectionIsOpen('network-access') === false;
        setPropsSectionState('network-access', true);
        const openAfterSet = _propsSectionIsOpen('network-access') === true;

        selType = null; selId = null;
        return {
          nodeDispatched: nodeHtml.indexOf('SRV') >= 0,
          floorDispatched: floorHtml.indexOf('Contesto progetto') >= 0,
          headerOk: header.indexOf('fa-server') >= 0 && header.indexOf('sub') >= 0,
          netHasIp: net.indexOf('10.0.0.5') >= 0 || /updateN\('ip'/.test(net),
          sectionRoundTrip: closedAfterSet && openAfterSet,
        };
      });
      assert.ok(r.nodeDispatched, 'renderProps dispatcha al ramo NODE (_renderNodeProps)');
      assert.ok(r.floorDispatched, 'renderProps dispatcha al ramo FLOOR senza selezione');
      assert.ok(r.headerOk, '_buildPropsHeader produce l’header con icona/sottotitolo');
      assert.ok(r.netHasIp, '_buildNetAccessHtml mostra IP/campi di rete');
      assert.ok(r.sectionRoundTrip, 'setPropsSectionState↔_propsSectionIsOpen round-trip (stato module-private)');
    });

    await t.test('app-properties-node-devices migrato: catena device-spec FLOOR/RACK + _floorAccessVlanRow', async () => {
      const r = await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        state.nodes.length = 0; state.links.length = 0; state.ports = {};
        const pc = { id: 'pcx', type: 'pc', name: 'PC-X', x: 0, y: 0, ports: 1, brand: 'Dell', ip: '10.0.0.9' };
        const srv = { id: 'srx', type: 'server', name: 'SRV-X', x: 5, y: 5, ports: 2 };
        state.nodes.push(pc, srv);
        if (typeof _invalidateIdx === 'function') _invalidateIdx();

        const dPc = (typeof TYPES !== 'undefined' && TYPES['pc']) || {};
        const dSrv = (typeof TYPES !== 'undefined' && TYPES['server']) || {};
        // Ramo FLOOR (pc → h) e ramo RACK/attivo (server → devSpec).
        const pcChain = _nodeDeviceChainHtml(pc, dPc, '<!--id-->');
        const srvChain = _nodeDeviceChainHtml(srv, dSrv, '<!--id-->');
        // Helper esposto, usato anche da app-properties-port (bundle).
        const vlanRow = _floorAccessVlanRow(pc);

        return {
          pcFloorBranch: (pcChain.h || '').indexOf("updateN('brand'") >= 0,
          pcHasDell: (pcChain.h || '').indexOf('Dell') >= 0,
          srvRackBranch: (srvChain.devSpec || '').indexOf('device-server') >= 0,
          vlanRowOk: (vlanRow || '').indexOf('setEndpointVlan(') >= 0,
        };
      });
      assert.ok(r.pcFloorBranch, '_nodeDeviceChainHtml: ramo FLOOR (pc) popola h con i campi device');
      assert.ok(r.pcHasDell, '_nodeDeviceChainHtml: win.selected rende l’opzione brand (Dell)');
      assert.ok(r.srvRackBranch, '_nodeDeviceChainHtml: ramo RACK (server) popola devSpec');
      assert.ok(r.vlanRowOk, '_floorAccessVlanRow produce la riga VLAN endpoint editabile');
    });

    await t.test('app-properties-node migrato: _renderNodeProps rack + guard _propsExplicit (var-ify)', async () => {
      const r = await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        const rackId = (state.racks[0] && state.racks[0].id) || state.currentRack;
        state.nodes.push({ id: 'swk', type: 'switch', name: 'SW-K', ports: 8, rackId, rackU: 1, sizeU: 1 });
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        const panel = document.getElementById('props-panel');

        selType = 'node'; selId = 'swk';
        // guard OFF: un rack NON apre le proprietà senza intent esplicito → early return
        // (prova che il modulo legge win._propsExplicit, var-ificato in app.js).
        window._propsExplicit = false;
        panel.innerHTML = '__SENTINEL__';
        renderProps();
        const blockedWhenImplicit = panel.innerHTML === '__SENTINEL__';

        // guard ON: _renderNodeProps rende il nodo + la sezione device-spec switch.
        window._propsExplicit = true;
        renderProps();
        const rendersWhenExplicit = panel.innerHTML.indexOf('SW-K') >= 0;
        const hasSwitchSpec = panel.innerHTML.indexOf('device-switch') >= 0;

        window._propsExplicit = false; selType = null; selId = null;
        return { blockedWhenImplicit, rendersWhenExplicit, hasSwitchSpec };
      });
      assert.ok(r.blockedWhenImplicit, 'rack senza _propsExplicit: il dispatcher non apre le proprietà (guard via win._propsExplicit)');
      assert.ok(r.rendersWhenExplicit, 'rack con _propsExplicit=true: _renderNodeProps rende il nodo (SW-K)');
      assert.ok(r.hasSwitchSpec, 'rende la sezione device-spec switch (integra la catena node-devices)');
    });

    await t.test('app-topology-crawl migrato: utility rack condivise _findFreeU / _resolveRackOverlap', async () => {
      const r = await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        const rackId = (state.racks[0] && state.racks[0].id) || state.currentRack;
        if (state.racks[0]) state.racks[0].sizeU = 42;
        state.nodes.length = 0;
        // U1-2 occupati da uno switch 2U
        state.nodes.push({ id: 'a', type: 'switch', rackId, rackU: 1, sizeU: 2, ports: 8 });
        if (typeof _invalidateIdx === 'function') _invalidateIdx();

        const freeU = _findFreeU(rackId, 1); // deve evitare U 1-2

        // overlap: nuovo nodo a U1 (occupato) → _resolveRackOverlap lo riposiziona
        const b = { id: 'b', type: 'server', rackId, rackU: 1, sizeU: 1 };
        state.nodes.push(b);
        _resolveRackOverlap(b);

        return { freeU, bRackU: b.rackU, freeAvoidsOccupied: freeU !== 1 && freeU !== 2 };
      });
      assert.ok(typeof r.freeU === 'number' && r.freeU >= 1, '_findFreeU ritorna uno slot U valido');
      assert.ok(r.freeAvoidsOccupied, '_findFreeU evita gli U occupati (1-2)');
      assert.notEqual(r.bRackU, 1, '_resolveRackOverlap sposta il nodo sovrapposto fuori da U1');
    });

    await t.test('app-discovery-classify migrato: _guessType + classificazione + indici identità nel browser reale', async () => {
      const r = await page.evaluate(() => {
        // --- euristiche _guessType (OID SNMP, vendor, sysDescr, fallback) ---
        const gtNas    = _guessType('', '1.3.6.1.4.1.6574.', '', '', '');          // Synology OID
        const gtCam    = _guessType('', '', 'Reolink', '', '');                    // vendor → webcam
        const gtSwitch = _guessType('Cisco IOS Software, Catalyst 2960', '', '', '', '');
        const gtPcFb   = _guessType('', '', '', '', 'DESKTOP-A1B2C3');             // fallback endpoint

        // --- OUI vendor da MAC ---
        const vendor = _discVendorFromMac('ec:71:db:00:11:22');                    // EC:71:DB → Reolink

        // --- sanitize device class (regex early-return, no _discExistingNode) ---
        const klass = _discSanitizeDeviceClass({ vendor: 'Synology', hostname: 'nas01' });

        // --- source → label ---
        const src = _discIdentitySource({ snmpReachable: true });
        const label = _discIdentityLabel(src);

        // --- indici identità + match per mac / ip / conflitto ip-mac ---
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        state.nodes.length = 0;
        state.nodes.push({ id: 'n1', type: 'switch', mac: 'AA:BB:CC:DD:EE:FF', ip: '10.0.0.5', hostname: 'sw-core', ports: 8 });
        _discInvalidateExistingIndexes();
        const idx = _discBuildExistingIndexes();
        const byMac    = _discFindExistingDevice({ mac: 'aa:bb:cc:dd:ee:ff' }, idx);
        const byIp     = _discFindExistingDevice({ ip: '10.0.0.5' }, idx);
        const conflict = _discFindExistingDevice({ ip: '10.0.0.5', mac: '11:22:33:44:55:66' }, idx);

        return {
          gtNas, gtCam, gtSwitch, gtPcFb, vendor, klass, src, label,
          byMacId: byMac.node && byMac.node.id, byMacBy: byMac.matchedBy,
          byIpBy: byIp.matchedBy, conflictBy: conflict.matchedBy,
        };
      });
      assert.equal(r.gtNas, 'nas', '_guessType riconosce OID Synology → nas');
      assert.equal(r.gtCam, 'webcam', '_guessType riconosce vendor Reolink → webcam');
      assert.equal(r.gtSwitch, 'switch', '_guessType riconosce Catalyst → switch');
      assert.equal(r.gtPcFb, 'pc', '_guessType fallback host DESKTOP- → pc');
      assert.equal(r.vendor, 'Reolink', '_discVendorFromMac mappa OUI EC:71:DB → Reolink');
      assert.equal(r.klass, 'nas', '_discSanitizeDeviceClass classifica Synology → nas');
      assert.equal(r.src, 'snmp', '_discIdentitySource: snmpReachable → snmp');
      assert.equal(r.label, 'SNMP confermato', '_discIdentityLabel mappa snmp → etichetta');
      assert.equal(r.byMacId, 'n1', '_discFindExistingDevice trova il nodo per MAC');
      assert.equal(r.byMacBy, 'mac', 'match per MAC etichettato mac');
      assert.equal(r.byIpBy, 'ip', 'match per IP etichettato ip');
      assert.equal(r.conflictBy, 'conflict', 'stesso IP + MAC diverso → conflitto ip-mac');
    });

    await t.test('app-topology-discover migrato: stato condiviso var-ify + discoverTopology manual-first + _findPortByIfName', async () => {
      const r = await page.evaluate(async () => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = state.ports || {};
          const rackId = (state.racks[0] && state.racks[0].id) || 'r1';
          // nodo senza SNMP → discoverTopology apre la vista dal cablaggio (manual-first)
          state.nodes.push({ id: 'tdx1', type: 'switch', name: 'core1', hostname: 'core1', rackId, ports: 8 });
          state.ports['tdx1-1'] = { ifName: 'GigabitEthernet0/1' };
          if (typeof _invalidateIdx === 'function') _invalidateIdx();

          window._topoData = null; window._topoVisible = false; window._viewMode = 'map';
          await discoverTopology(false);
          const opened = {
            vis: window._topoVisible, mode: window._viewMode,
            // lo stato condiviso deve essere leggibile anche BARE (= var su window, non let)
            sharedBare: (typeof _topoVisible !== 'undefined') && _topoVisible === window._topoVisible,
          };

          // _findPortByIfName: match vendor-neutral Gi0/1 → GigabitEthernet0/1
          const pid = _findPortByIfName('tdx1', 'Gi0/1');

          toggleTopology(); // richiude
          const closed = { vis: window._topoVisible, mode: window._viewMode };
          return { ok: true, opened, pid, closed };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso topologia: ' + r.err);
      assert.equal(r.opened.vis, true, 'discoverTopology (manual-first) apre la vista topologia');
      assert.equal(r.opened.mode, 'topology', 'viewMode passa a topology');
      assert.ok(r.opened.sharedBare, '_topoVisible leggibile bare = vive su window (var-ify _topoData/_topoVisible/_viewMode)');
      assert.equal(r.pid, 'tdx1-1', '_findPortByIfName abbina Gi0/1 → tdx1-1 (match normalizzato)');
      assert.equal(r.closed.vis, false, 'toggleTopology richiude la vista');
      assert.equal(r.closed.mode, 'map', 'viewMode torna a map');
    });

    await t.test('app-discovery migrato: openDiscovery + _discRenderTable + reconcile + var-ify stato nel browser reale', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = state.ports || {};
          // device già in progetto → il reconcile NON deve marcarlo "Nuovo"
          state.nodes.push({ id: 'exist1', type: 'switch', name: 'sw-old', hostname: 'sw-old', ip: '10.0.0.5', mac: 'AA:BB:CC:DD:EE:FF', ports: 8 });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();

          openDiscovery(); // apre overlay + azzera stato condiviso (var su window)
          const overlayOpen = document.getElementById('disc-overlay').classList.contains('open');
          const stateReset = window._discResults.length === 0 && window._discRunning === false;

          // popola risultati grezzi e renderizza la tabella (funzione esposta)
          window._discResults = [
            { ip: '10.0.0.5', mac: 'aa:bb:cc:dd:ee:ff', hostname: 'sw-old', alive: true, snmpReachable: true, deviceClass: 'switch', vendor: 'Cisco', sources: [{ id: 'snmp', label: 'SNMP' }], confidence: { score: 80, level: 'high' } },
            { ip: '10.0.0.9', mac: 'EC:71:DB:11:22:33', alive: true, deviceClass: 'webcam', vendor: 'Reolink', sources: [{ id: 'arp', label: 'ARP' }], confidence: { score: 30, level: 'low' } },
          ];
          _discRenderTable();
          const rows = document.querySelectorAll('#disc-tbody tr').length;
          const hasTypeSelect = !!document.querySelector('#disc-tbody select.disc-type');
          const hasChk = !!document.querySelector('#disc-tbody input.disc-chk');
          const recCls = [...document.querySelectorAll('#disc-tbody .disc-badge[class*="rec-"]')].map(b => b.className);
          const firstRowExisting = recCls.length > 0 && !recCls[0].includes('rec-new');

          const exposed = ['openDiscovery', 'closeDiscovery', 'runDiscovery', 'importDiscovered',
            '_discExistingNode', '_discRenderTable']
            .filter(f => typeof window[f] === 'function');
          // ASSE B: discSelectAll + i due handler DINAMICI di riga ritirati da window
          const discSelallOffWin = typeof window.discSelectAll === 'undefined';
          const rowFnsOffWin = ['_discOnRowToggle', '_discOnTypeChange'].every(n => typeof window[n] === 'undefined');
          // Pilota "seleziona tutti" con un vero evento change (delegazione)
          const selall = document.getElementById('disc-selall');
          selall.checked = true;
          selall.dispatchEvent(new Event('change', { bubbles: true }));
          const allChecked = [...document.querySelectorAll('#disc-tbody input.disc-chk')].length > 0 &&
            [...document.querySelectorAll('#disc-tbody input.disc-chk')].every(cb => cb.checked);

          // ASSE B superficie DINAMICA: la riga (creata da _discRenderTable dopo il load)
          // porta data-change="disc-row"/"disc-type". Un vero change su una riga passa
          // per il listener delegato sul document e chiama _discOnRowToggle/_discOnTypeChange.
          const chk0 = document.querySelector('#disc-tbody input.disc-chk');
          const rowWired = chk0.getAttribute('data-change') === 'disc-row' && !chk0.hasAttribute('onchange');
          chk0.checked = false;
          chk0.dispatchEvent(new Event('change', { bubbles: true }));   // -> _discOnRowToggle ricalcola "seleziona tutti"
          const selallUnsetByRow = document.getElementById('disc-selall').checked === false;
          const sel0 = document.querySelector('#disc-tbody select.disc-type');
          const typeWired = sel0.getAttribute('data-change') === 'disc-type' && !sel0.hasAttribute('onchange');
          let typeNoThrow = true;
          try {
            const opts = [...sel0.options].map(o => o.value);
            sel0.value = opts.find(v => v !== sel0.value) || sel0.value;
            sel0.dispatchEvent(new Event('change', { bubbles: true }));   // -> _discOnTypeChange
          } catch (e) { typeNoThrow = false; }

          const matched = window._discExistingNode({ mac: 'aa:bb:cc:dd:ee:ff' });

          closeDiscovery();
          const overlayClosed = !document.getElementById('disc-overlay').classList.contains('open');

          return { ok: true, overlayOpen, stateReset, rows, hasTypeSelect, hasChk, firstRowExisting,
            exposedCount: exposed.length, discSelallOffWin, rowFnsOffWin, allChecked,
            rowWired, selallUnsetByRow, typeWired, typeNoThrow, matchedId: matched && matched.id, overlayClosed };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso discovery: ' + r.err);
      assert.ok(r.overlayOpen, 'openDiscovery apre l\'overlay');
      assert.ok(r.stateReset, 'openDiscovery azzera lo stato condiviso (_discResults/_discRunning var su window)');
      assert.equal(r.rows, 2, '_discRenderTable rende 2 righe');
      assert.ok(r.hasTypeSelect && r.hasChk, 'ogni riga ha select-tipo + checkbox (data-change delegati)');
      assert.ok(r.firstRowExisting, 'il device già in progetto NON è marcato "Nuovo" (reconcile via _discFindExistingDevice del bundle)');
      assert.equal(r.exposedCount, 6, 'le 6 funzioni discovery restanti sono esposte su window (selall + i due handler di riga ora delegati)');
      assert.ok(r.discSelallOffWin, 'ASSE B: discSelectAll ritirata da window (data-change="disc-selall")');
      assert.ok(r.rowFnsOffWin, 'ASSE B: _discOnRowToggle/_discOnTypeChange ritirati da window (superficie dinamica delegata)');
      assert.ok(r.allChecked, 'change su #disc-selall (delegation) seleziona tutte le righe della tabella Scopri');
      assert.ok(r.rowWired, 'la riga (dinamica) ha data-change="disc-row" e nessun onchange inline');
      assert.ok(r.selallUnsetByRow, 'change su una riga (delegation) → _discOnRowToggle ricalcola "seleziona tutti"');
      assert.ok(r.typeWired, 'il select-tipo (dinamico) ha data-change="disc-type" e nessun onchange inline');
      assert.ok(r.typeNoThrow, 'change sul select-tipo (delegation) esegue _discOnTypeChange senza errori');
      assert.equal(r.matchedId, 'exist1', '_discExistingNode abbina il device esistente per MAC');
      assert.ok(r.overlayClosed, 'closeDiscovery chiude l\'overlay');
    });

    await t.test('Import: SNMP attivo SOLO sui device che hanno risposto (snmpReachable); gli altri senza driver', async () => {
      const r = await page.evaluate(async () => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = state.ports || {};
          if (typeof _invalidateIdx === 'function') _invalidateIdx();

          openDiscovery();
          // Due NUOVI device: uno che RISPONDE a SNMP (switch v2c), uno che NON risponde
          // (PC visto solo via ARP). Atteso: il primo riceve il driver snmp-v2c, il
          // secondo NESSUN driver SNMP (cosi' il Sync non lo interroga e non va in fail).
          window._discResults = [
            { ip: '10.9.9.1', mac: '11:22:33:44:55:66', hostname: 'sw-new', alive: true, snmpReachable: true, snmpDriver: 'snmp-v2c', deviceClass: 'switch', vendor: 'Cisco', sources: [{ id: 'snmp', label: 'SNMP' }], confidence: { score: 80, level: 'high' } },
            { ip: '10.9.9.2', mac: 'EC:71:DB:AA:BB:CC', alive: true, snmpReachable: false, deviceClass: 'pc', vendor: 'Dell', sources: [{ id: 'arp', label: 'ARP' }], confidence: { score: 30, level: 'low' } },
          ];
          _discRenderTable();
          document.querySelectorAll('#disc-tbody input.disc-chk').forEach(c => { c.checked = true; });
          await importDiscovered();

          const byIp = ip => (state.nodes || []).find(n => (n.ip || (n.integration && n.integration.host)) === ip);
          const sw = byIp('10.9.9.1');
          const pc = byIp('10.9.9.2');
          return {
            ok: true,
            nodeCount: state.nodes.length,
            swDriver: sw && sw.integration ? sw.integration.driver : 'NO-NODE',
            pcDriver: pc && pc.integration ? (pc.integration.driver || '') : 'NO-NODE',
            pcHost: pc && pc.integration ? pc.integration.host : 'NO-NODE',
          };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nell\'import: ' + r.err);
      assert.equal(r.nodeCount, 2, 'importati i 2 device selezionati');
      assert.equal(r.swDriver, 'snmp-v2c', 'il device che ha risposto a SNMP riceve il driver snmp-v2c');
      assert.equal(r.pcDriver, '', 'il device che NON ha risposto a SNMP NON riceve un driver SNMP (il Sync lo salta)');
      assert.equal(r.pcHost, '10.9.9.2', 'il non-responder mantiene comunque host=IP (SNMP abilitabile a mano dal pannello)');
    });

    await t.test('Sync: bottone rinominato "Sync", chip drift rimosso (le differenze si vedono in Verifica doc)', async () => {
      const r = await page.evaluate(() => {
        try {
          const scopri = !!document.getElementById('btn-discover');
          const syncBtn = document.getElementById('btn-snmp-sync');
          const syncOnclick = syncBtn ? syncBtn.getAttribute('onclick') : null;
          const syncLabel = (document.getElementById('snmp-sync-label')?.textContent || '').trim();
          // Il chip drift è stato rimosso: niente badge, niente funzioni esposte.
          const hasBadge = !!document.getElementById('sync-summary-badge');
          const chipFns = ['syncSNMP', '_renderSyncSummaryBadge', '_syncOpenReport']
            .filter(f => typeof window[f] === 'function').length;
          // Il Sync mantiene l'auto-link: pollAllSNMP è l'handler diretto del bottone.
          const hasPoll = typeof window.pollAllSNMP === 'function';
          return { ok: true, scopri, syncOnclick, syncLabel, hasBadge, chipFns, hasPoll };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso sync: ' + r.err);
      assert.ok(r.scopri, 'il bottone Scopri (btn-discover) resta invariato nell\'header');
      assert.equal(r.syncOnclick, 'pollAllSNMP()', 'il bottone Sync chiama il poll (che fa anche l\'auto-link)');
      assert.equal(r.syncLabel, 'Sync', 'il bottone è rinominato "Sync" (non più "Sync SNMP")');
      assert.equal(r.hasBadge, false, 'il chip drift #sync-summary-badge è stato rimosso');
      assert.equal(r.chipFns, 0, 'le funzioni del chip non sono più esposte su window');
      assert.ok(r.hasPoll, 'pollAllSNMP è esposto (handler del bottone Sync)');
    });

    await t.test('lock manual-first: toggleNodeLock (IP/hostname) e togglePortVlanLock fissano/sbloccano il valore', async () => {
      const r = await page.evaluate(() => {
        try {
          const baseN = state.nodes.length;
          state.nodes.push({ id: 'n_lock', type: 'switch', name: 'LOCK-SW', ip: '10.9.9.9' });
          state.ports['n_lock-1'] = { vlan: 30 };
          if (typeof _invalidateIdx === 'function') _invalidateIdx();   // nodeById è lazy-indexed
          selType = 'node'; selId = 'n_lock';
          // IP: lock → ipManual true; unlock → false (riusa il flag manual-first)
          const ipBefore = !!nodeById('n_lock').ipManual;
          toggleNodeLock('ip'); const ipLocked = !!nodeById('n_lock').ipManual;
          toggleNodeLock('ip'); const ipUnlocked = !!nodeById('n_lock').ipManual;
          // hostname: lock → hostnameManual true
          toggleNodeLock('hostname'); const hnLocked = !!nodeById('n_lock').hostnameManual;
          // VLAN porta: lock → vlanOvr = VLAN live; unlock → rimosso
          const ovrBefore = state.ports['n_lock-1'].vlanOvr != null ? state.ports['n_lock-1'].vlanOvr : null;
          togglePortVlanLock('n_lock-1'); const ovrLocked = state.ports['n_lock-1'].vlanOvr != null ? state.ports['n_lock-1'].vlanOvr : null;
          togglePortVlanLock('n_lock-1'); const ovrUnlocked = state.ports['n_lock-1'].vlanOvr != null ? state.ports['n_lock-1'].vlanOvr : null;
          // render del pannello col lucchetto: non deve lanciare
          selType = 'node'; selId = 'n_lock'; renderProps();
          // cleanup (non inquinare i test successivi)
          state.nodes = state.nodes.filter(n => n.id !== 'n_lock');
          delete state.ports['n_lock-1'];
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          selType = null; selId = null; renderProps();
          return { ok: true, ipBefore, ipLocked, ipUnlocked, hnLocked, ovrBefore, ovrLocked, ovrUnlocked, restored: state.nodes.length === baseN };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso lock: ' + r.err);
      assert.equal(r.ipBefore, false);
      assert.equal(r.ipLocked, true, 'lock IP → ipManual true');
      assert.equal(r.ipUnlocked, false, 'unlock IP → ipManual false');
      assert.equal(r.hnLocked, true, 'lock hostname → hostnameManual true');
      assert.equal(r.ovrBefore, null);
      assert.equal(r.ovrLocked, 30, 'lock VLAN porta → vlanOvr = VLAN live (30)');
      assert.equal(r.ovrUnlocked, null, 'unlock VLAN porta → vlanOvr rimosso');
      assert.ok(r.restored, 'stato ripristinato dopo il test');
    });

    await t.test('app-drift presence-aware: cambio IP (stesso MAC) rilevato dal motore nel browser reale', async () => {
      // Test del motore puro nel browser (no state/render → niente inquinamento
      // della pagina condivisa). Il glue (_driftBuildDocSnapshot/_driftBuildSnmpSnapshot)
      // e l'azione driftApplyIpChange sono verificati a parte (unit + manuale su Test3).
      const r = await page.evaluate(() => {
        try {
          const rep = window.buildDriftReport(
            { observedMacs: [], reachabilityChecked: true, fdbObserved: false, presentNodeIds: {},
              macAtIp: { 'aa:bb:cc:00:00:30': '192.168.1.60', 'aa:bb:cc:00:00:31': '192.168.1.70' } },
            { macs: [
              { mac: 'AA:BB:CC:00:00:30', nodeId: 'srv', ip: '192.168.1.50', label: 'srv' },  // spostato
              { mac: 'AA:BB:CC:00:00:31', nodeId: 'pc',  ip: '192.168.1.70', label: 'pc'  },  // stesso IP
            ] }, [], {});
          return { ok: true, ipChanged: rep.counts.ipChanged, macOrphan: rep.counts.macOrphan,
            row: (rep.ipChanged[0] || null), applyOffWin: typeof window.driftApplyIpChange === 'undefined' };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore: ' + r.err);
      assert.ok(r.applyOffWin, 'ASSE B: driftApplyIpChange ritirata da window (data-act="drift-apply-ip", delegation)');
      assert.equal(r.ipChanged, 1, 'rilevato 1 cambio IP (srv .50→.60); il pc allo stesso IP non conta');
      assert.equal(r.macOrphan, 0, 'nessun assente: i MAC sono vivi in ARP');
      assert.equal(r.row && r.row.oldIp, '192.168.1.50', 'oldIp = IP documentato');
      assert.equal(r.row && r.row.newIp, '192.168.1.60', 'newIp = IP vivo in ARP');
    });

    await t.test('auto-rinnovo IP (DHCP) per MAC noto: opt-in + guard manual-first nel browser reale', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          // pcA: IP derivato dalla rete (ipManual false) → eleggibile al rinnovo.
          // pcB: IP fissato a mano (ipManual true) → NON deve essere toccato.
          const pcA = { id:'pcA', type:'pc', name:'pcA', ip:'192.168.1.50', mac:'AA:BB:CC:00:00:30', ipManual:false };
          const pcB = { id:'pcB', type:'pc', name:'pcB', ip:'192.168.1.70', mac:'AA:BB:CC:00:00:31', ipManual:true  };
          state.nodes.push(pcA, pcB);
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          const mkReport = () => ({ counts: { ipChanged: 2 }, ipChanged: [
            { key:'ipchg:aa:bb:cc:00:00:30', mac:'AA:BB:CC:00:00:30', oldIp:'192.168.1.50', newIp:'192.168.1.60', nodeId:'pcA', label:'pcA' },
            { key:'ipchg:aa:bb:cc:00:00:31', mac:'AA:BB:CC:00:00:31', oldIp:'192.168.1.70', newIp:'192.168.1.75', nodeId:'pcB', label:'pcB' },
          ] });
          // 1) toggle OFF → niente rinnovo
          state.autoIpRenew = false;
          window._driftReport = mkReport();
          const offApplied = window._driftAutoRenewIps();
          const offIpA = pcA.ip;
          // 2) toggle ON → rinnova solo pcA (ipManual false); pcB resta intatto + in tabella
          state.autoIpRenew = true;
          window._driftReport = mkReport();
          const onApplied = window._driftAutoRenewIps();
          return { ok:true, offApplied, offIpA, onApplied,
            ipA: pcA.ip, manualA: pcA.ipManual,
            ipB: pcB.ip, manualB: pcB.ipManual,
            rowsLeft: (window._driftReport.ipChanged || []).map(x => x.nodeId) };
        } catch (e) { return { ok:false, err:String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore: ' + r.err);
      assert.equal(r.offApplied, 0, 'toggle OFF: nessun IP rinnovato');
      assert.equal(r.offIpA, '192.168.1.50', 'toggle OFF: pcA mantiene il vecchio IP');
      assert.equal(r.onApplied, 1, 'toggle ON: rinnovato 1 solo IP (pcA); pcB è manuale');
      assert.equal(r.ipA, '192.168.1.60', 'pcA: IP aggiornato al valore vivo (DHCP)');
      assert.equal(r.manualA, false, 'pcA: resta derivato dalla rete');
      assert.equal(r.ipB, '192.168.1.70', 'pcB: IP manuale NON toccato (manual-first)');
      assert.equal(r.manualB, true, 'pcB: resta fissato a mano');
      assert.deepEqual(r.rowsLeft, ['pcB'], 'in tabella resta solo pcB (manuale, da revisionare)');
    });

    await t.test('app-topology-overlay migrato: legenda VLAN + render SVG overlay (buildTopoLines→_drawTopoPair) nel browser reale', async () => {
      const setup = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.racks = [{ id: 'rA', name: 'A', sizeU: 42, x: 120, y: 120 }, { id: 'rB', name: 'B', sizeU: 42, x: 480, y: 120 }];
          state.currentRack = 'rA';
          state.vlanColors = { 10: '#ff5555', 20: '#55ff55' };
          state.nodes = [
            { id: 'sA', type: 'switch', name: 'swA', rackId: 'rA', rackU: 1, sizeU: 1, ports: 8 },
            { id: 'sB', type: 'switch', name: 'swB', rackId: 'rB', rackU: 1, sizeU: 1, ports: 8 },
          ];
          state.ports = { 'sA-1': {}, 'sB-1': {} };
          state.links = [window._createLinkRecord ? window._createLinkRecord('sA-1', 'sB-1') : { id: 'l1', a: 'sA-1', b: 'sB-1' }];
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          window._topoData = null; window._topoVisible = true; window._viewMode = 'topology';
          renderAll();
          _renderTopoLegend();   // legenda VLAN (esposta)
          renderTopoOverlay();   // overlay coalesced (esposto)
          return { ok: true };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(setup.ok, 'setup overlay senza errori: ' + setup.err);
      // post-condizione osservabile (no timeout fisso): la linea topologia compare nell'SVG
      await page.waitForFunction(() => document.querySelectorAll('#topo-floor-overlay .tfl').length > 0, { timeout: 5000 });
      const r = await page.evaluate(() => ({
        legendPills: document.querySelectorAll('#topo-legend .topo-leg-vlan').length,
        legendVisible: document.getElementById('topo-legend').classList.contains('visible'),
        tflLines: document.querySelectorAll('#topo-floor-overlay .tfl').length,
        exposed: ['renderTopoOverlay', '_renderTopoLegend'].filter(f => typeof window[f] === 'function').length,
      }));
      assert.equal(r.legendPills, 2, '_renderTopoLegend rende 2 pillole VLAN (state.vlanColors via win)');
      assert.ok(r.legendVisible, 'la legenda topologia è marcata visibile');
      assert.ok(r.tflLines >= 1, 'renderTopoOverlay disegna ≥1 linea SVG (buildTopoLines→_drawTopoPair)');
      assert.equal(r.exposed, 2, 'renderTopoOverlay e _renderTopoLegend esposti su window');
    });

    await t.test('presenza: i device ASSENTI (macOrphan del Drift) sono attenuati in planimetria (.node-absent)', async () => {
      const r = await page.evaluate(async () => {
        const raf = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          // endpoint floor deterministico (non strutturale → ramo .floor-node)
          const id = 'absent-test-pc';
          state.nodes.push({ id, type: 'pc', name: 'PC test', x: 60, y: 60, mac: 'aa:bb:cc:dd:ee:01' });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          // Simula l'esito di una Verifica documentazione: questo device è ASSENTE.
          window._driftReport = { macOrphan: [{ key: 'mac:x', nodeId: id }] };
          renderAll(); await raf();   // renderAll è coalesced in rAF → aspetta il flush
          const sel = `.floor-node[data-id="${id}"]`;
          const absentMarked = !!document.querySelector(sel)?.classList.contains('node-absent');
          const othersGray = document.querySelectorAll('.floor-node.node-absent').length;
          // Guardia: se poi RISPONDE allo SNMP non deve restare grigio.
          state.nodes.find(n => n.id === id).snmpStatus = 'ok';
          renderAll(); await raf();
          const stillAbsentAfterOk = !!document.querySelector(sel)?.classList.contains('node-absent');
          // cleanup: niente report → niente attenuazione
          window._driftReport = null;
          renderAll(); await raf();
          const absentAfterClear = document.querySelectorAll('.node-absent').length;
          return { ok: true, absentMarked, othersGray, stillAbsentAfterOk, absentAfterClear };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso presenza→grigio: ' + r.err);
      assert.ok(r.absentMarked, 'il device assente (macOrphan) riceve la classe .node-absent');
      assert.equal(r.othersGray, 1, 'solo il device assente è attenuato, non gli altri');
      assert.equal(r.stillAbsentAfterOk, false, 'se il device poi risponde allo SNMP (ok) NON resta grigio');
      assert.equal(r.absentAfterClear, 0, 'senza Drift report nessun device è attenuato');
    });

    await t.test('app-csv-import migrato: openCsvImport + previewCsv (con errore) + importCsvNodes nel browser reale', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.racks = [{ id: 'r1', name: 'Rack1', sizeU: 42 }]; state.currentRack = 'r1';
          if (typeof _invalidateIdx === 'function') _invalidateIdx();

          openCsvImport();
          const overlayOpen = document.getElementById('csv-overlay').classList.contains('open');
          const btnDisabledInit = document.getElementById('csv-import-btn').disabled === true;

          const csv = [
            'name,hostname,ip,type,rack,rackU,sizeU,ports',
            'sw-a,sw-a,10.0.0.1,switch,Rack1,1,1,24',
            'srv-b,,10.0.0.2,server,Rack1,2,1,4',
            ',no-name,10.0.0.3,switch,Rack1,3,1,8',
            'cam-c,,10.0.0.4,webcam,,,,',
          ].join('\n');
          const csvArea = document.getElementById('csv-textarea');
          csvArea.value = csv;
          // ASSE B change/input: la textarea porta data-input, il file-input data-change;
          // previewCsv/loadCsvFile NON sono più su window.
          const csvInputWired = csvArea.getAttribute('data-input') === 'csv-preview' && !csvArea.hasAttribute('oninput');
          const csvFileEl = document.getElementById('csv-file');
          const csvFileWired = csvFileEl.getAttribute('data-change') === 'csv-file' && !csvFileEl.hasAttribute('onchange');
          const csvGone = ['previewCsv', 'loadCsvFile'].every(n => typeof window[n] === 'undefined');
          csvArea.dispatchEvent(new Event('input', { bubbles: true }));   // input DELEGATO reale → previewCsv
          const previewVisible = document.getElementById('csv-preview').style.display !== 'none';
          const previewRows = document.querySelectorAll('#csv-preview-table tbody tr').length;
          const hasErrors = (document.getElementById('csv-errors').textContent || '').length > 0;
          const btnEnabledAfter = document.getElementById('csv-import-btn').disabled === false;

          const before = state.nodes.length;
          importCsvNodes();
          const imported = state.nodes.length - before;
          const overlayClosed = !document.getElementById('csv-overlay').classList.contains('open');

          return { ok: true, overlayOpen, btnDisabledInit, previewVisible, previewRows, hasErrors, btnEnabledAfter, imported, overlayClosed, csvInputWired, csvFileWired, csvGone };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso CSV: ' + r.err);
      assert.ok(r.overlayOpen, 'openCsvImport apre l\'overlay');
      assert.ok(r.btnDisabledInit, 'import disabilitato all\'apertura');
      assert.ok(r.csvInputWired, 'ASSE B: csv-textarea ha data-input="csv-preview" e nessun oninput');
      assert.ok(r.csvFileWired, 'ASSE B: csv-file ha data-change="csv-file" e nessun onchange');
      assert.ok(r.csvGone, 'ASSE B: previewCsv/loadCsvFile ritirate dal ponte (data-input/data-change)');
      assert.ok(r.previewVisible, 'l\'evento input delegato ha eseguito previewCsv (anteprima visibile)');
      assert.equal(r.previewRows, 4, 'anteprima rende 4 righe (inclusa quella con errore)');
      assert.ok(r.hasErrors, 'la riga senza name è segnalata come errore');
      assert.ok(r.btnEnabledAfter, 'import abilitato con righe valide');
      assert.equal(r.imported, 3, 'importCsvNodes crea 3 nodi (la riga senza name è scartata)');
      assert.ok(r.overlayClosed, 'importCsvNodes chiude l\'overlay');
    });

    await t.test('app-dhcp-import: i lease (file) alimentano il motore Verifica (cambio IP cross-VLAN)', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0;
          state.nodes.push({ id: 'pcX', type: 'pc', name: 'PC-X', x: 10, y: 10, ports: 1, mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.50' });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          window._dhcpLeases = null;

          const exposed = ['openDhcpImport', 'useDhcpLeases'].every(f => typeof window[f] === 'function');
          // ASSE B change/input: previewDhcp/loadDhcpFile fuori da window (data-input/data-change)
          const dhcpGone = ['previewDhcp', 'loadDhcpFile'].every(f => typeof window[f] === 'undefined');
          openDhcpImport();
          const overlayOpen = document.getElementById('dhcp-overlay').classList.contains('open');
          const useDisabledInit = document.getElementById('dhcp-use-btn').disabled === true;
          const dhcpFileEl = document.getElementById('dhcp-file');
          const dhcpFileWired = dhcpFileEl.getAttribute('data-change') === 'dhcp-file' && !dhcpFileEl.hasAttribute('onchange');

          // Lease CSV: pcX a un IP nuovo + un MAC sconosciuto. Niente reconcile qui:
          // i lease vanno in store._dhcpLeases e li usa il motore Drift.
          const dhcpArea = document.getElementById('dhcp-textarea');
          dhcpArea.value = [
            'ip,mac,hostname',
            '10.0.0.80,AA:BB:CC:DD:EE:01,pc-x',
            '10.0.0.82,DE:AD:BE:EF:00:09,ignoto',
          ].join('\n');
          const dhcpInputWired = dhcpArea.getAttribute('data-input') === 'dhcp-preview' && !dhcpArea.hasAttribute('oninput');
          dhcpArea.dispatchEvent(new Event('input', { bubbles: true }));   // input DELEGATO reale → previewDhcp
          const useEnabled = document.getElementById('dhcp-use-btn').disabled === false;
          useDhcpLeases();
          const stored = Array.isArray(window._dhcpLeases) ? window._dhcpLeases.length : 0;
          const overlayStillOpen = document.getElementById('dhcp-overlay').classList.contains('open');
          const sourcesCount = Array.isArray(state.dhcpSources) ? state.dhcpSources.length : 0;

          // Il motore usa i lease come fonte: macAtIp pieno + cambio IP per pcX,
          // senza alcun ARP (è il caso cross-VLAN dietro il firewall).
          const doc = _driftBuildDocSnapshot();
          const snmp = _driftBuildSnmpSnapshot(doc);
          const rep = buildDriftReport(snmp, doc, [], {});
          const ipchgX = (rep.ipChanged || []).find(x => x.nodeId === 'pcX');
          const udIgn = (rep.undocumented || []).find(x => String(x.mac || '').toUpperCase() === 'DE:AD:BE:EF:00:09');
          const out = { ok: true, exposed, dhcpGone, dhcpFileWired, dhcpInputWired, overlayOpen, useDisabledInit, useEnabled, stored, overlayStillOpen, sourcesCount,
            macAtIpX: snmp.macAtIp['aa:bb:cc:dd:ee:01'], reachChecked: snmp.reachabilityChecked,
            ipchgX: ipchgX ? ipchgX.newIp : '',
            udLabel: udIgn ? udIgn.label : '' };
          state.dhcpSources = []; window._dhcpLeases = null;   // non lasciare fonti/lease ai test successivi
          if (typeof closeDhcpImport === 'function') closeDhcpImport();   // chiudi l'overlay: aperto intercetterebbe i click dei test a gesto reale
          { const _ov = document.getElementById('dhcp-overlay'); if (_ov) _ov.classList.remove('open'); }
          return out;
        } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
      });
      assert.ok(r.ok, 'nessun errore: ' + r.err);
      assert.ok(r.exposed, 'openDhcpImport/useDhcpLeases esposte dal bundle');
      assert.ok(r.dhcpGone, 'ASSE B: previewDhcp/loadDhcpFile ritirate dal ponte (data-input/data-change)');
      assert.ok(r.dhcpFileWired, 'ASSE B: dhcp-file ha data-change="dhcp-file" e nessun onchange');
      assert.ok(r.dhcpInputWired, 'ASSE B: dhcp-textarea ha data-input="dhcp-preview" e nessun oninput');
      assert.ok(r.overlayOpen, 'openDhcpImport apre l\'overlay');
      assert.ok(r.useDisabledInit, '"Aggiungi" disabilitato all\'apertura');
      assert.ok(r.useEnabled, 'l\'evento input delegato ha eseguito previewDhcp ("Aggiungi" abilitato)');
      assert.equal(r.stored, 2, 'Aggiungi accumula i lease nella cache store._dhcpLeases');
      assert.equal(r.sourcesCount, 1, 'Aggiungi crea una fonte persistita in state.dhcpSources');
      assert.ok(r.overlayStillOpen, 'Aggiungi NON chiude l\'overlay (si possono aggiungere altre fonti)');
      assert.equal(r.macAtIpX, '10.0.0.80', 'il lease entra in macAtIp del motore (cross-VLAN, senza ARP)');
      assert.ok(r.reachChecked, 'i lease contano come osservabilità');
      assert.equal(r.ipchgX, '10.0.0.80', 'il motore Drift rileva il cambio IP dal lease');
      assert.match(r.udLabel, /ignoto/, 'la riga non-documentata da lease mostra l\'hostname del lease: ' + r.udLabel);
    });

    await t.test('app-dhcp-import: pull live (driver-pack) → carica i lease per la Verifica', async () => {
      const r = await page.evaluate(async () => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          window._dhcpLeases = null;
          // openDhcpImport interroga /api/dhcp-drivers (server reale, pack presente in
          // vendor/) → la sezione live compare e i vendor sono popolati.
          await openDhcpImport();
          const exposed = ['fetchDhcpLive'].every(f => typeof window[f] === 'function');
          // ASSE B change: il select vendor è delegato (data-change), updateDhcpVendorFields fuori da window
          const vendorEl = document.getElementById('dhcp-live-vendor');
          const vendorWired = vendorEl.getAttribute('data-change') === 'dhcp-vendor' && !vendorEl.hasAttribute('onchange');
          const vendorGone = typeof window.updateDhcpVendorFields === 'undefined';
          const liveShown = document.getElementById('dhcp-live-section').style.display !== 'none';
          // Pack-aware (come test/dhcp-drivers.test.js): senza driver-pack
          // (server/dhcp-drivers/vendor/ è gitignored → assente in CI / repo pubblico)
          // la sezione live NON compare. Il pull live è feature locale/a pagamento → salta.
          if (!liveShown) {
            if (typeof closeDhcpImport === 'function') closeDhcpImport();
            { const _ov = document.getElementById('dhcp-overlay'); if (_ov) _ov.classList.remove('open'); }
            return { ok: true, exposed, vendorWired, vendorGone, liveShown: false, noPack: true };
          }
          const vendorCount = document.getElementById('dhcp-live-vendor').options.length;
          const cred2hidden = document.getElementById('dhcp-cred2-wrap').style.display === 'none';
          // Stub solo la POST dei lease (il driver vero lo proviamo su HW reale).
          const _origFetch = window.fetch;
          window.fetch = async () => ({ json: async () => ({ ok: true, format: 'api:fortigate', count: 1, leases: [{ mac: 'AA:BB:CC:DD:EE:0A', ip: '10.0.0.90', hostname: 'pc-l', state: 'active' }] }) });
          document.getElementById('dhcp-live-host').value = '192.168.1.1';
          document.getElementById('dhcp-live-cred1').value = 'tok';
          await fetchDhcpLive();
          const useEnabled = document.getElementById('dhcp-use-btn').disabled === false;
          useDhcpLeases();
          window.fetch = _origFetch;
          const stored = Array.isArray(window._dhcpLeases) ? window._dhcpLeases.length : 0;
          const storedIp = stored ? window._dhcpLeases[0].ip : '';
          state.dhcpSources = []; window._dhcpLeases = null;   // non lasciare fonti/lease ai test successivi
          if (typeof closeDhcpImport === 'function') closeDhcpImport();   // chiudi l'overlay: aperto intercetterebbe i click dei test a gesto reale
          { const _ov = document.getElementById('dhcp-overlay'); if (_ov) _ov.classList.remove('open'); }
          return { ok: true, exposed, vendorWired, vendorGone, liveShown, vendorCount, cred2hidden, useEnabled, stored, storedIp };
        } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso live: ' + r.err);
      assert.ok(r.exposed, 'fetchDhcpLive esposta dal bundle');
      assert.ok(r.vendorWired, 'ASSE B: dhcp-live-vendor ha data-change="dhcp-vendor" e nessun onchange');
      assert.ok(r.vendorGone, 'ASSE B: updateDhcpVendorFields ritirata dal ponte (data-change)');
      if (r.noPack) return;   // CI/repo pubblico: nessun driver-pack → pull live non applicabile (degradazione: resta file/incolla)
      assert.ok(r.liveShown, 'la sezione live compare (driver-pack presente in vendor/)');
      assert.ok(r.vendorCount >= 1, 'vendor popolati dal server');
      assert.ok(r.cred2hidden, 'FortiGate: un solo campo credenziale (cred2 nascosto)');
      assert.ok(r.useEnabled, '"Usa nella Verifica" abilitato dopo il pull');
      assert.equal(r.stored, 1, 'useDhcpLeases mette il lease live in store._dhcpLeases');
      assert.equal(r.storedIp, '10.0.0.90', 'IP corretto dal pull live');
    });

    await t.test('app-auth migrato: API esposte + toggle menu/overlay (DOM, no backend) + var-ify _currentUser', async () => {
      const r = await page.evaluate(() => {
        try {
          // 1) le funzioni pubbliche ANCORA su window (expose dal bundle). ASSE B: i
          // menu utente/report sono passati a event delegation → toggle+voci NON più su window.
          const fns = ['initAuth','toggleImpExpMenu','closeImpExpMenu',
            'closeUserManager','umCreateUser','umToggleRole','umDeleteUser',
            'closeChangePassword','umChangePassword'];
          const allFns = fns.every(n => typeof window[n] === 'function');
          // ASSE B: queste sono DELEGATE (data-act) → ritirate dal ponte
          const delegatedGone = ['doLogout','toggleUserMenu','closeUserMenu','openUserManager',
            'openChangePassword','toggleReportMenu','closeReportMenu']
            .every(n => typeof window[n] === 'undefined');
          // _applyRoleUI è interno → NON deve essere esposto
          const internalHidden = typeof window._applyRoleUI === 'undefined';

          // 2) toggle deterministico del menu utente via click DELEGATO su #btn-user (data-act)
          const dd = document.getElementById('user-dropdown');
          dd.style.display = 'none';
          const closed = dd.style.display === 'none';
          document.getElementById('btn-user').click();
          const opened = dd.style.display === 'block';
          document.getElementById('btn-user').click();
          const reclosed = dd.style.display === 'none';

          // 3) overlay cambio password: apre via voce data-act, chiude via closeChangePassword (esposta)
          document.querySelector('[data-act="change-password"]').click();
          const ovOpen = document.getElementById('chpwd-overlay').style.display === 'flex';
          closeChangePassword();
          const ovClosed = document.getElementById('chpwd-overlay').style.display === 'none';

          // 4) var-ify: _currentUser è una proprietà globale leggibile BARE dai file legacy
          // (qui in page-scope, come fa app-core.js apiFetch con `_currentUser?.role`)
          window._currentUser = { id: 7, username: 'tester', role: 'viewer' };
          const bareRead = _currentUser && _currentUser.username;

          return { ok: true, allFns, delegatedGone, internalHidden, closed, opened, reclosed, ovOpen, ovClosed, bareRead };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso auth: ' + r.err);
      assert.ok(r.allFns, 'le funzioni auth ancora classiche sono esposte su window');
      assert.ok(r.delegatedGone, 'ASSE B: toggle/voci menu utente+report ritirati dal ponte (data-act)');
      assert.ok(r.internalHidden, '_applyRoleUI resta interno (non esposto)');
      assert.ok(r.closed, 'stato iniziale: dropdown utente chiuso');
      assert.ok(r.opened, 'click delegato su #btn-user apre il dropdown');
      assert.ok(r.reclosed, 'secondo click delegato richiude il dropdown');
      assert.ok(r.ovOpen, 'la voce "Cambia password" (data-act) apre l\'overlay');
      assert.ok(r.ovClosed, 'closeChangePassword chiude l\'overlay');
      assert.equal(r.bareRead, 'tester', '_currentUser leggibile BARE (var-ify su window) per i file legacy');
    });

    await t.test('app-search-zoom-rack migrato: search globale + zoom + gestione rack (switch/move) nel browser reale', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0;
          state.racks = [{ id: 'rA', name: 'Rack A', sizeU: 42 }, { id: 'rB', name: 'Rack B', sizeU: 42 }];
          state.currentRack = 'rA';
          state.nodes.push({ id: 'n1', type: 'switch', name: 'CoreSwitch01', rackId: 'rA', rackU: 1, sizeU: 1, ports: 24 });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          renderRackTabs();

          // 1) API esposte dal bundle. NB: zoomFloor/zoomRack/togglePaletteGroup/toggleRackMenu
          //    NON sono più su window (ritiro ponte ASSE B: toolbar rack/zoom/palette → data-act);
          //    filterPaletteItems/updateRackSize NEMMENO (change/input → data-input/data-change);
          //    switchRack NEMMENO (selettore rack → data-change="rack-select"; resta export ESM).
          const fns = ['buildSearchResults','renderRackTabs','moveNodeToRack'];
          const allFns = fns.every(n => typeof window[n] === 'function');

          // 2) ricerca globale: trova il device per nome
          const res = buildSearchResults('coreswitch');
          const foundDevice = res.some(x => x.kind === 'device' && x.id === 'n1');

          // 3) zoom floor via EVENT DELEGATION (data-act): cambia lo stato + scale() al canvas
          const z0 = state.floorView.zoom;
          document.querySelector('[data-act="zoom-floor"][data-delta="0.1"]').click();
          const zoomed = state.floorView.zoom > z0;
          const transformApplied = /scale\(/.test(document.getElementById('floor-canvas').style.transform);

          // 4) renderRackTabs popola il <select> dei rack
          const opts = document.getElementById('rack-select').options.length;

          // 5) selettore rack via EVENT DELEGATION (data-change="rack-select") → switchRack(el.value)
          const rackSel = document.getElementById('rack-select');
          rackSel.value = 'rB';
          rackSel.dispatchEvent(new Event('change', { bubbles: true }));
          const switched = state.currentRack === 'rB';

          // 6) moveNodeToRack sposta il device (era in rA) nel rack libero rB
          const moved = moveNodeToRack('n1', 'rB');
          const nodeRack = nodeById('n1').rackId;

          // 7) ASSE B: la superficie toolbar rack/zoom/palette è DELEGATA → non su window
          const delegatedGone = ['clearSearch','zoomFloor','zoomRack','toggleRackPanel','toggleSidebarPanel',
            'togglePaletteGroup','setPaletteGroupsExpanded','clearPaletteFilter','toggleRackMenu','closeRackMenu',
            'toggleRackOnFloor','addRack','renameRack','toggleRackUNumbering','deleteCurrentRack']
            .every(n => typeof window[n] === 'undefined');
          // 7b) ASSE B change/input: filterPaletteItems/updateRackSize/switchRack/handleMapUpload fuori da window
          const changeInputGone = ['filterPaletteItems','updateRackSize','switchRack','handleMapUpload']
            .every(n => typeof window[n] === 'undefined');
          // 7c) file-input immagine planimetria cablato via delegation (data-change="map-upload")
          const mapUploadWired = document.getElementById('map-upload').getAttribute('data-change') === 'map-upload';

          return { ok: true, allFns, foundDevice, zoomed, transformApplied, opts, switched, moved, nodeRack, delegatedGone, changeInputGone, mapUploadWired };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso search/zoom/rack: ' + r.err);
      assert.ok(r.allFns, 'le funzioni search/zoom/rack (non-toolbar) sono esposte su window');
      assert.ok(r.delegatedGone, 'ASSE B: le 15 funzioni toolbar rack/zoom/palette sono ritirate dal ponte (data-act)');
      assert.ok(r.changeInputGone, 'ASSE B: filterPaletteItems/updateRackSize/switchRack/handleMapUpload ritirate dal ponte (data-input/data-change)');
      assert.ok(r.mapUploadWired, 'ASSE B: #map-upload cablato via data-change="map-upload" (delegation)');
      assert.ok(r.foundDevice, 'buildSearchResults trova il device per nome');
      assert.ok(r.zoomed, 'zoomFloor aumenta lo zoom della planimetria');
      assert.ok(r.transformApplied, 'updateTransforms applica scale() al floor-canvas');
      assert.equal(r.opts, 2, 'renderRackTabs popola il select con 2 rack');
      assert.ok(r.switched, 'change su #rack-select (delegation) cambia il rack corrente via switchRack');
      assert.ok(r.moved, 'moveNodeToRack riesce a spostare il device');
      assert.equal(r.nodeRack, 'rB', 'il device e ora nel rack B');
    });

    await t.test('ASSE B harness change/input: rack size (change) + palette filter (input) via evento reale delegato', async () => {
      const r = await page.evaluate(() => {
        try {
          // Setup rack pulito: currentRack rA (42U) + un device 1U (la riduzione a 30 passa la validazione)
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0;
          state.racks = [{ id: 'rA', name: 'Rack A', sizeU: 42 }];
          state.currentRack = 'rA';
          state.nodes.push({ id: 'n1', type: 'switch', name: 'SW1', rackId: 'rA', rackU: 1, sizeU: 1, ports: 8 });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          renderRackTabs();

          // --- CHANGE: #rack-size-input (data-change="rack-size") → updateRackSize(el.value) ---
          const sizeInput = document.getElementById('rack-size-input');
          const sizeWired = sizeInput.getAttribute('data-change') === 'rack-size' && !sizeInput.hasAttribute('onchange');
          sizeInput.value = '30';
          sizeInput.dispatchEvent(new Event('change', { bubbles: true }));   // evento REALE → listener delegato sul document
          const rackAfterChange = state.racks.find(x => x.id === 'rA').sizeU;

          // --- INPUT: #palette-search (data-input="palette-filter") → filterPaletteItems(el.value) ---
          const paletteInput = document.getElementById('palette-search');
          const paletteWired = paletteInput.getAttribute('data-input') === 'palette-filter' && !paletteInput.hasAttribute('oninput');
          const totalItems = document.querySelectorAll('#sidebar-left .equip-item').length;
          // query che non matcha nulla → filterPaletteItems nasconde TUTTE le voci
          paletteInput.value = 'zzz-nessun-elemento-cosi';
          paletteInput.dispatchEvent(new Event('input', { bubbles: true }));
          const hiddenAfterInput = [...document.querySelectorAll('#sidebar-left .equip-item')]
            .filter(it => it.style.display === 'none').length;
          const clearBtn = document.getElementById('palette-search-clear');
          const clearVisible = clearBtn ? getComputedStyle(clearBtn).visibility === 'visible' : null;
          // ripristino (query vuota → tutte visibili di nuovo)
          paletteInput.value = '';
          paletteInput.dispatchEvent(new Event('input', { bubbles: true }));
          const hiddenAfterReset = [...document.querySelectorAll('#sidebar-left .equip-item')]
            .filter(it => it.style.display === 'none').length;

          return { ok: true, sizeWired, rackAfterChange, paletteWired, totalItems, hiddenAfterInput, clearVisible, hiddenAfterReset };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso change/input: ' + r.err);
      // change
      assert.ok(r.sizeWired, '#rack-size-input ha data-change="rack-size" e nessun onchange inline');
      assert.equal(r.rackAfterChange, 30, 'l\'evento change delegato ha eseguito updateRackSize (sizeU 42→30)');
      // input
      assert.ok(r.paletteWired, '#palette-search ha data-input="palette-filter" e nessun oninput inline');
      assert.ok(r.totalItems > 0, 'la palette ha voci (equip-item) su cui filtrare');
      assert.equal(r.hiddenAfterInput, r.totalItems, 'l\'evento input delegato ha eseguito filterPaletteItems (query no-match → tutte nascoste)');
      if (r.clearVisible !== null) assert.ok(r.clearVisible, 'il pulsante clear della palette diventa visibile a query non vuota');
      assert.equal(r.hiddenAfterReset, 0, 'query vuota → filterPaletteItems ripristina tutte le voci');
    });

    await t.test('ASSE B harness focus/keydown: search box (input+focus+keydown) via eventi reali delegati', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0;
          state.nodes.push({ id: 'n1', type: 'switch', name: 'CoreSwitch01', ports: 8 });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();

          const box = document.getElementById('global-search');
          const panel = document.getElementById('search-results');
          // wiring: 3 attributi delegati, nessun handler inline
          const wired = box.getAttribute('data-input') === 'global-search'
            && box.getAttribute('data-focus') === 'global-search'
            && box.getAttribute('data-keydown') === 'global-search'
            && !box.hasAttribute('oninput') && !box.hasAttribute('onfocus') && !box.hasAttribute('onkeydown');

          // INPUT reale → handleSearchInput costruisce+mostra i risultati
          box.value = 'core';
          box.dispatchEvent(new Event('input', { bubbles: true }));
          const shownAfterInput = getComputedStyle(panel).display !== 'none'
            && panel.querySelectorAll('.search-result').length > 0;

          // reset: query vuota via input → pannello nascosto
          box.value = '';
          box.dispatchEvent(new Event('input', { bubbles: true }));
          const hiddenAfterEmpty = getComputedStyle(panel).display === 'none';

          // FOCUS reale (focusin, che fa bubbling): con value pre-impostato ri-mostra i risultati
          box.value = 'core';
          box.dispatchEvent(new Event('focusin', { bubbles: true }));
          const shownAfterFocus = getComputedStyle(panel).display !== 'none'
            && panel.querySelectorAll('.search-result').length > 0;

          // KEYDOWN reale Escape → handleSearchKey → clearSearch (svuota + nasconde)
          box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          const clearedAfterEsc = box.value === '' && getComputedStyle(panel).display === 'none';

          // ASSE B superficie DINAMICA: le righe risultato (create da renderSearchResults)
          // portano data-act="search-pick" data-idx; un vero CLICK passa per la delegation.
          box.value = 'core';
          box.dispatchEvent(new Event('input', { bubbles: true }));
          const pick0 = panel.querySelector('.search-result');
          const pickWired = !!pick0 && pick0.getAttribute('data-act') === 'search-pick'
            && pick0.hasAttribute('data-idx') && !pick0.hasAttribute('onclick');
          pick0.click();   // click reale → delegation → selectSearchResult(idx)
          const pickSelected = window.selId === 'n1' && box.value === '';   // seleziona il device e pulisce
          const pickGone = typeof window.selectSearchResult === 'undefined';

          // le fn ritirate dal ponte
          const gone = typeof window.handleSearchInput === 'undefined' && typeof window.handleSearchKey === 'undefined';

          return { ok: true, wired, shownAfterInput, hiddenAfterEmpty, shownAfterFocus, clearedAfterEsc, pickWired, pickSelected, pickGone, gone };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso search box: ' + r.err);
      assert.ok(r.wired, '#global-search cablato via data-input/data-focus/data-keydown, nessun handler inline');
      assert.ok(r.shownAfterInput, 'input delegato → handleSearchInput mostra i risultati');
      assert.ok(r.hiddenAfterEmpty, 'input con query vuota → pannello nascosto');
      assert.ok(r.shownAfterFocus, 'focusin delegato → handleSearchInput ri-mostra i risultati (focus non fa bubbling → agganciato focusin)');
      assert.ok(r.clearedAfterEsc, 'keydown Escape delegato → handleSearchKey esegue clearSearch');
      assert.ok(r.pickWired, 'la riga risultato (dinamica) ha data-act="search-pick" data-idx, nessun onclick inline');
      assert.ok(r.pickSelected, 'click delegato su una riga risultato → selectSearchResult seleziona il device e pulisce la ricerca');
      assert.ok(r.pickGone, 'ASSE B: selectSearchResult ritirata da window (delegation)');
      assert.ok(r.gone, 'ASSE B: handleSearchInput/handleSearchKey ritirate da window (delegation)');
    });

    await t.test('app-shared-segment migrato: rilevazione segmento L2 multi-MAC (FDB) + HTML pannello nel browser reale', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0;
          state.racks = [{ id: 'rA', name: 'Rack A', sizeU: 42 }]; state.currentRack = 'rA';
          state.nodes.push({ id: 'sw1', type: 'switch', name: 'SW-Access', rackId: 'rA', rackU: 1, sizeU: 1, ports: 24 });
          state.ports = state.ports || {};
          state.ports['sw1-1'] = { ifName: 'Gi0/1' };
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          // 2 MAC dietro la stessa porta (FDB) -> segmento L2 condiviso
          window._topoFdbCache = { sw1: { 'aa:bb:cc:dd:ee:01': 'Gi0/1', 'aa:bb:cc:dd:ee:02': 'Gi0/1' } };

          const fns = ['_sharedSegmentInfoForPort','_sharedSegmentHtml','_macRowsForPort',
            '_createSharedSegmentNode','_openSharedSegmentBind','_ignoreSharedSegment','_markSharedSegmentRole'];
          const allFns = fns.every(n => typeof window[n] === 'function');

          const rows = _macRowsForPort('sw1-1') || [];
          const info = _sharedSegmentInfoForPort('sw1-1');
          const html = _sharedSegmentHtml('sw1-1', 'popup') || '';
          const htmlHasBadge = /Segmento L2 condiviso/.test(html);

          // marca il ruolo e verifica che lo stato porta venga scritto
          _markSharedSegmentRole('sw1-1', 'switch');
          const roleSet = (state.ports['sw1-1'] || {}).sharedSegmentRole === 'switch';

          return { ok: true, allFns, rowCount: rows.length, infoMacs: info ? info.macs.length : -1,
                   unknown: info ? info.unknownCount : -1, htmlHasBadge, roleSet };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso shared-segment: ' + r.err);
      assert.ok(r.allFns, 'le funzioni shared-segment sono esposte su window');
      assert.equal(r.rowCount, 2, '_macRowsForPort trova 2 MAC dietro la porta');
      assert.equal(r.infoMacs, 2, '_sharedSegmentInfoForPort rileva il segmento (2 MAC)');
      assert.equal(r.unknown, 2, 'i 2 MAC sono sconosciuti (nessun nodo associato)');
      assert.ok(r.htmlHasBadge, '_sharedSegmentHtml rende il badge del segmento condiviso');
      assert.ok(r.roleSet, '_markSharedSegmentRole scrive sharedSegmentRole sulla porta');
    });

    await t.test('app-autolink migrato: API engine esposte + pruneDiscoveryHistory lib (aging/cap in-place) + _isLeafEndpoint nel browser reale', async () => {
      const r = await page.evaluate(() => {
        try {
          const fns = ['_autoDiscoverLinks','_autoLinkEndpoint','_autoLinkEndpointUI','_resolveEndpointSwitchPort',
            '_recordDiscoveryObservation','_nodeByMacMap','_isLeafEndpoint','_isTransitPort','_matchNodeByIdent'];
          const allFns = fns.every(n => typeof window[n] === 'function');
          // pruneDiscoveryHistory ora vive in lib/discovery-history.js (lib-script): verifica
          // che sia DAVVERO caricato e raggiungibile nello scope pagina (integrazione golden-rule).
          const libLoaded = typeof window.pruneDiscoveryHistory === 'function' && typeof window.DISCOVERY_HISTORY_MAX === 'number';

          // pruneDiscoveryHistory: aging + tetto + in-place (integrazione; logica pura in test/discovery-history.test.js)
          const DAY = 864e5, now = Date.now(), iso = ms => new Date(ms).toISOString();
          const a = [];
          for (let i = 0; i < 5; i++) a.push({ ts: iso(now - 200 * DAY), lastSeen: iso(now - 200 * DAY), mac: 'old' + i });
          a.push({ mac: 'nodate' });
          for (let i = 0; i < 20; i++) a.push({ ts: iso(now - 1 * DAY), lastSeen: iso(now - 1 * DAY), mac: 'new' + i });
          const retA = pruneDiscoveryHistory(a);
          const sameRef = retA === a;
          const noOld = !a.some(x => String(x.mac).startsWith('old'));
          const keptNoDate = a.some(x => x.mac === 'nodate');
          const aLen = a.length;
          const b = []; const N = DISCOVERY_HISTORY_MAX + 50;
          for (let i = 0; i < N; i++) b.push({ ts: iso(now - 1 * DAY), lastSeen: iso(now - 1 * DAY), mac: 'r' + i });
          pruneDiscoveryHistory(b);
          const capped = b.length === DISCOVERY_HISTORY_MAX;

          // _isLeafEndpoint: pc (1 porta, hasIP, !isActive) sì, switch no
          const leafPc = _isLeafEndpoint('pc');
          const leafSwitch = _isLeafEndpoint('switch');

          return { ok: true, allFns, libLoaded, sameRef, noOld, keptNoDate, aLen, capped, leafPc, leafSwitch };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso autolink: ' + r.err);
      assert.ok(r.allFns, 'le funzioni engine auto-link sono esposte su window');
      assert.ok(r.libLoaded, 'lib/discovery-history.js caricato: pruneDiscoveryHistory + DISCOVERY_HISTORY_MAX su window');
      assert.ok(r.sameRef, 'pruneDiscoveryHistory sfoltisce IN PLACE (stesso array)');
      assert.ok(r.noOld, 'aging: observation oltre 90 giorni scartate');
      assert.ok(r.keptNoDate, 'record senza data valida mantenuti');
      assert.equal(r.aLen, 21, 'restano 1 senza-data + 20 recenti');
      assert.ok(r.capped, 'tetto rigido DISCOVERY_HISTORY_MAX applicato');
      assert.ok(r.leafPc, '_isLeafEndpoint riconosce un endpoint foglia (pc)');
      assert.ok(!r.leafSwitch, '_isLeafEndpoint esclude lo switch (infrastruttura)');
    });

    await t.test('app-snmp migrato: applyPollResult mappa interfacce/inventario + converter + freschezza nel browser reale', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = {};
          state.racks = [{ id: 'rA', name: 'Rack A', sizeU: 42 }]; state.currentRack = 'rA';
          state.nodes.push({ id: 'sw1', type: 'switch', name: 'SW', rackId: 'rA', rackU: 1, sizeU: 1, ports: 2 });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();

          const fns = ['pollSNMP','pollAllSNMP','applyPollResult','updateIntegration','_snmpFreshness','_pollPowerNode'];
          const allFns = fns.every(n => typeof window[n] === 'function');

          // applyPollResult con dati fittizi (niente fetch): interfacce->porte + inventario
          applyPollResult('sw1', {
            ok: true,
            hostname: 'sw1.lan',
            inventory: { brand: 'Cisco', model: 'C9200', serialNumber: 'ABC123' },
            interfaces: [
              { operStatus: 1, vlan: 10, speed: 1000, name: 'Gi0/1' },
              { operStatus: 2, vlan: 20, speed: 100, name: 'Gi0/2' },
            ],
            vlans: [10, 20], lags: [],
          }, { noHistory: true, noRender: true });

          const n = nodeById('sw1');
          const portCount = n.ports;
          const p1status = (state.ports['sw1-1'] || {}).status;
          const p2status = (state.ports['sw1-2'] || {}).status;
          const p1vlan = (state.ports['sw1-1'] || {}).vlan;
          const brand = n.brand;
          const hostname = n.hostname;
          const snmpOk = n.snmpStatus === 'ok';

          const operActive = _snmpOperToUiStatus(1, null);
          const operFault = _snmpOperToUiStatus(6, null);
          const freshNever = _snmpFreshness(0).level;
          const freshNow = _snmpFreshness(Date.now()).level;

          return { ok: true, allFns, portCount, p1status, p2status, p1vlan, brand, hostname, snmpOk,
                   operActive, operFault, freshNever, freshNow };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso snmp: ' + r.err);
      assert.ok(r.allFns, 'le funzioni SNMP sono esposte su window');
      assert.equal(r.portCount, 2, 'applyPollResult imposta n.ports dal numero di interfacce');
      assert.equal(r.p1status, 'active', 'operStatus 1 -> active');
      assert.equal(r.p2status, 'inactive', 'operStatus 2 -> inactive');
      assert.equal(r.p1vlan, 10, 'PVID interfaccia mappato sulla porta');
      assert.equal(r.brand, 'Cisco', 'inventario brand applicato');
      assert.equal(r.hostname, 'sw1.lan', 'hostname SNMP applicato (no override manuale)');
      assert.ok(r.snmpOk, 'snmpStatus=ok dopo poll riuscito');
      assert.equal(r.operActive, 'active', '_snmpOperToUiStatus(1)=active');
      assert.equal(r.operFault, 'fault', '_snmpOperToUiStatus(6)=fault');
      assert.equal(r.freshNever, 'none', '_snmpFreshness(0)=none');
      assert.equal(r.freshNow, 'fresh', '_snmpFreshness(now)=fresh');
    });

    await t.test('app-vlan-autopoll migrato: propagateVlans (sw->pc) + _effPortVlan + nativa/range nel browser reale', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = {};
          state.racks = [{ id: 'rA', name: 'Rack A', sizeU: 42 }]; state.currentRack = 'rA';
          state.nodes.push({ id: 'sw', type: 'switch', name: 'SW', rackId: 'rA', rackU: 1, sizeU: 1, ports: 4 });
          state.nodes.push({ id: 'pc', type: 'pc', name: 'PC', x: 100, y: 100, ports: 1 });
          state.links.push({ id: 'l1', src: 'sw-1', dst: 'pc-1' });
          state.ports['sw-1'] = { vlanOvr: 10 };
          if (typeof _invalidateIdx === 'function') _invalidateIdx();

          const fns = ['propagateVlans','_effPortVlan','setSiteNativeVlan','toggleVoiceVlan',
            'setLinkMode','showVlanMembers','_vlansToRangeStr','_ensureVlanColor','setAutoPoll'];
          const allFns = fns.every(n => typeof window[n] === 'function');

          propagateVlans();
          const swEff = _effPortVlan('sw-1');   // switchport access VLAN 10
          const pcEff = _effPortVlan('pc-1');   // endpoint eredita la VLAN propagata
          const vlanColorAdded = !!state.vlanColors[10];

          setSiteNativeVlan(99);
          const nativeSet = state.nativeVlan === 99;
          setSiteNativeVlan(1);
          const nativeReset = state.nativeVlan == null;

          const rangeStr = _vlansToRangeStr([1, 10, 11, 12, 20, 100, 101]);

          return { ok: true, allFns, swEff, pcEff, vlanColorAdded, nativeSet, nativeReset, rangeStr };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso vlan-autopoll: ' + r.err);
      assert.ok(r.allFns, 'le funzioni VLAN/auto-poll sono esposte su window');
      assert.equal(r.swEff, 10, '_effPortVlan: switchport access VLAN 10');
      assert.equal(r.pcEff, 10, 'propagateVlans: il PC eredita la VLAN 10 dallo switch');
      assert.ok(r.vlanColorAdded, '_ensureVlanColor registra la VLAN 10 nella palette');
      assert.ok(r.nativeSet, 'setSiteNativeVlan(99) imposta la nativa di sito');
      assert.ok(r.nativeReset, 'setSiteNativeVlan(1) rimuove la nativa custom');
      assert.equal(r.rangeStr, '1,10-12,20,100-101', '_vlansToRangeStr compatta i range');
    });

    await t.test('app-pointer migrato: trace BFS + _traceNodeFloor + _tryFinishLink crea cavo nel browser reale', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = {};
          state.racks = [{ id: 'rA', name: 'Rack A', sizeU: 42 }]; state.currentRack = 'rA';
          state.nodes.push({ id: 'sw', type: 'switch', name: 'SW', rackId: 'rA', rackU: 1, sizeU: 1, ports: 24 });
          state.nodes.push({ id: 'sw2', type: 'switch', name: 'SW2', rackId: 'rA', rackU: 3, sizeU: 1, ports: 24 });
          state.nodes.push({ id: 'wp', type: 'wallport', name: 'WP', x: 0, y: 0, ports: 1 });
          state.nodes.push({ id: 'pc', type: 'pc', name: 'PC', x: 40, y: 40, ports: 1 });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          // catena fisica: sw-1 → wp-1 → pc-1 (2 segmenti)
          state.links.push(_createLinkRecord('sw-1', 'wp-1'), _createLinkRecord('wp-1', 'pc-1'));
          if (typeof _invalidateIdx === 'function') _invalidateIdx();

          const fns = ['handlePointerDown','handlePointerMove','handlePointerUp','handleDrop',
            'onDragStart','handleDoubleClick','handleFloorDoubleClick','trace','_traceNodeFloor',
            '_tryFinishLink','_cancelLink'];
          const allFns = fns.every(n => typeof window[n] === 'function');

          // trace() BFS dal PC: evidenzia tutto il run fisico (2 segmenti)
          highPath.clear(); trace('pc-1'); const traceSize = highPath.size;
          // _traceNodeFloor sul NODO presa a muro: stesso run completo
          highPath.clear(); _traceNodeFloor('wp'); const wpRun = highPath.size;
          highPath.clear(); _traceNodeFloor('pc'); const pcRun = highPath.size;

          // _tryFinishLink: crea un cavo sw-2 ↔ sw2-1 e azzera linkStart (via _cancelLink)
          const before = state.links.length;
          linkStart = 'sw-2';
          const made = _tryFinishLink('sw2-1');
          const after = state.links.length;
          const linkExists = state.links.some(l => (l.src === 'sw-2' && l.dst === 'sw2-1') || (l.src === 'sw2-1' && l.dst === 'sw-2'));

          return { ok: true, allFns, traceSize, wpRun, pcRun, made, before, after, linkExists, linkStartReset: linkStart };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso pointer: ' + r.err);
      assert.ok(r.allFns, 'le funzioni pointer/drag&drop sono esposte su window');
      assert.equal(r.traceSize, 2, 'trace() dal PC evidenzia i 2 segmenti del run');
      assert.equal(r.wpRun, 2, '_traceNodeFloor sulla presa a muro evidenzia lo stesso run');
      assert.equal(r.pcRun, 2, '_traceNodeFloor sul PC evidenzia lo stesso run');
      assert.ok(r.made, '_tryFinishLink restituisce true sul collegamento valido');
      assert.equal(r.after, r.before + 1, '_tryFinishLink aggiunge un cavo allo state');
      assert.ok(r.linkExists, '_tryFinishLink crea il cavo sw-2 ↔ sw2-1');
      assert.equal(r.linkStartReset, null, '_tryFinishLink azzera linkStart via _cancelLink');
    });

    await t.test('app-render-core migrato: renderAll costruisce il DOM + renderScope + getCablePath + shouldRenderLink nel browser reale', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = {};
          state.racks = [{ id: 'rA', name: 'Rack A', sizeU: 42 }]; state.currentRack = 'rA';
          state.nodes.push({ id: 'sw', type: 'switch', name: 'SW', rackId: 'rA', rackU: 1, sizeU: 1, ports: 8 });
          state.nodes.push({ id: 'pc', type: 'pc', name: 'PC', x: 120, y: 80, ports: 1 });
          state.links.push({ id: 'l1', src: 'sw-1', dst: 'pc-1' });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();

          const fns = ['renderAll','renderNow','renderScope','renderFloor','_renderAllNow',
            'getCablePath','getRackCablePath','shouldRenderLink','isRackPort','rackUPx','getPortHTML']
            .every(n => typeof window[n] === 'function');

          renderNow(); // build sincrono del DOM
          const floorItems = document.querySelectorAll('#floor-items .floor-node').length;
          const rackDevs = document.querySelectorAll('#rack-chassis .rack-device').length;

          // bezier dei cavi
          const path = getCablePath(0, 0, 100, 50);
          const isPath = typeof path === 'string' && path.startsWith('M ') && path.includes('C');
          const rackPath = getRackCablePath(0, 0, 100, 50);
          const isRackPath = typeof rackPath === 'string' && rackPath.startsWith('M ') && rackPath.includes('Q');

          // isRackPort discrimina rack vs floor
          const swIsRack = isRackPort('sw-1'), pcIsRack = isRackPort('pc-1');

          // shouldRenderLink: porta selezionata → cavo visibile; deselezionato → nascosto
          selType = 'port'; selId = 'sw-1'; highPath.clear();
          const lnkVisible = shouldRenderLink(state.links[0]);
          selType = null; selId = null; highPath.clear();
          const lnkHidden = shouldRenderLink(state.links[0]);

          renderScope('floor'); // render mirato senza crash (coalescing rAF)

          return { ok: true, fns, floorItems, rackDevs, isPath, isRackPath, swIsRack, pcIsRack, lnkVisible, lnkHidden };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso render-core: ' + r.err);
      assert.ok(r.fns, 'le funzioni di render sono esposte su window');
      assert.equal(r.floorItems, 1, 'renderAll costruisce il nodo floor (PC)');
      assert.equal(r.rackDevs, 1, 'renderAll costruisce il device rack (SW)');
      assert.ok(r.isPath, 'getCablePath → bezier cubico (C) valido');
      assert.ok(r.isRackPath, 'getRackCablePath → bezier quadratico (Q) valido');
      assert.ok(r.swIsRack, 'isRackPort: sw-1 è porta di un device rack');
      assert.ok(!r.pcIsRack, 'isRackPort: pc-1 NON è porta di rack');
      assert.ok(r.lnkVisible, 'shouldRenderLink: cavo visibile con la porta selezionata');
      assert.ok(!r.lnkHidden, 'shouldRenderLink: cavo nascosto senza selezione (declutter)');
    });

    await t.test('app-popup migrato: showPop + _getLinkVlan/_linkMatchesVlanFilter + _applyViewMode + stato topo su window', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = {};
          state.racks = [{ id: 'rA', name: 'Rack A', sizeU: 42 }]; state.currentRack = 'rA';
          state.nodes.push({ id: 'sw', type: 'switch', name: 'SW', rackId: 'rA', rackU: 1, sizeU: 1, ports: 8 });
          state.nodes.push({ id: 'pc', type: 'pc', name: 'PC', x: 100, y: 100, ports: 1 });
          state.links.push({ id: 'l1', src: 'sw-1', dst: 'pc-1' });
          state.ports['sw-1'] = { vlanOvr: 10 };
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          propagateVlans();

          const fns = ['showPop','closePop','_getLinkVlan','_linkMatchesVlanFilter','_applyViewMode',
            '_floorNodeColor','_getRackFloorLinks','_vlanLabel','_hideTopoTip','selectPathSegment']
            .every(n => typeof window[n] === 'function');

          // lo stato topo POSSEDUTO da app-popup vive su window (era var top-level classico)
          const topoStateOnWin = (typeof window._topoVisible === 'boolean')
            && (typeof window._viewMode === 'string')
            && (typeof window._topoFdbVlanCache === 'object');

          // _getLinkVlan: il cavo sw-1↔pc-1 è in VLAN 10 (override sullo switch)
          const linkVlan = _getLinkVlan(state.links[0]);
          _filterVlan = 10; const m10 = _linkMatchesVlanFilter(state.links[0]);
          _filterVlan = 20; const m20 = _linkMatchesVlanFilter(state.links[0]);
          _filterVlan = null;

          // _floorNodeColor: colori usati dall'export SVG/PDF (classico)
          const apColor = _floorNodeColor('ap'), fallbackColor = _floorNodeColor('zzz');

          // showPop costruisce il popup della porta
          showPop({ clientX: 50, clientY: 50 }, 'sw-1');
          const pop = document.getElementById('popup');
          const popOpen = pop.style.display === 'block' && pop.innerHTML.includes('Porta');
          closePop();
          const popClosed = pop.style.display === 'none';

          // _applyViewMode: toggle mappa/topologia
          _viewMode = 'topology'; _applyViewMode();
          const isTopo = document.body.classList.contains('view-topology');
          _viewMode = 'map'; _applyViewMode();
          const isMap = document.body.classList.contains('view-map');

          return { ok: true, fns, topoStateOnWin, linkVlan, m10, m20, apColor, fallbackColor, popOpen, popClosed, isTopo, isMap };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso popup: ' + r.err);
      assert.ok(r.fns, 'le funzioni popup/topo sono esposte su window');
      assert.ok(r.topoStateOnWin, 'lo stato topo posseduto da app-popup vive su window');
      assert.equal(r.linkVlan, 10, '_getLinkVlan: cavo in VLAN 10 (override switch)');
      assert.ok(r.m10, '_linkMatchesVlanFilter: il cavo matcha il filtro VLAN 10');
      assert.ok(!r.m20, '_linkMatchesVlanFilter: il cavo NON matcha il filtro VLAN 20');
      assert.equal(r.apColor, '#5ba3f5', '_floorNodeColor: colore AP per l\'export');
      assert.equal(r.fallbackColor, '#8b949e', '_floorNodeColor: colore di fallback');
      assert.ok(r.popOpen, 'showPop apre il popup della porta');
      assert.ok(r.popClosed, 'closePop chiude il popup');
      assert.ok(r.isTopo, '_applyViewMode(topology) attiva la classe view-topology');
      assert.ok(r.isMap, '_applyViewMode(map) attiva la classe view-map');
    });

    await t.test('app-core migrato: modali (showConfirm/showPrompt/modalResolve) + apiFetch viewer-guard nel browser reale', async () => {
      const r = await page.evaluate(async () => {
        try {
          const fns = ['apiFetch','loadProject',
            'showAlert','showConfirm','showPrompt','modalResolve','_initApp']
            .every(n => typeof window[n] === 'function');
          // ASSE B: i 5 bottoni progetto (data-act) + il selettore progetto (data-change)
          // sono delegati → ritirati dal ponte; switchProject non è più su window.
          const projGone = ['newProject','renameProject','duplicateProject','deleteProject','saveProject','switchProject']
            .every(n => typeof window[n] === 'undefined');
          // il selettore progetto è cablato via delegation (data-change="project-select")
          const projSelectWired = document.getElementById('project-select').getAttribute('data-change') === 'project-select';

          // showConfirm apre il modal-overlay; modalResolve(true) → onOk + chiusura
          let confirmed = null;
          showConfirm('Test?', () => { confirmed = true; }, () => { confirmed = false; });
          const overlayOpen = document.getElementById('modal-overlay').classList.contains('open');
          modalResolve(true);
          const overlayClosed = !document.getElementById('modal-overlay').classList.contains('open');

          // showPrompt: il valore digitato torna nella callback
          let promptVal = null;
          showPrompt('Nome?', 'def', v => { promptVal = v; });
          const inp = document.getElementById('modal-input');
          const inpVisible = inp.style.display === 'block';
          inp.value = 'pippo';
          modalResolve(true);
          const promptOk = promptVal === 'pippo';

          // apiFetch: guard ruolo viewer → throw sui metodi non-GET (prima del fetch)
          const prevUser = window._currentUser;
          window._currentUser = { role: 'viewer' };
          let guardThrew = false;
          try { await apiFetch('/api/projects', { method: 'POST', body: '{}' }); }
          catch (e) { guardThrew = /visualizzatori|consentita/i.test(String(e.message)); }
          window._currentUser = prevUser;

          return { ok: true, fns, projGone, projSelectWired, overlayOpen, overlayClosed, confirmed, inpVisible, promptOk, guardThrew };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso core: ' + r.err);
      assert.ok(r.fns, 'le funzioni core (apiFetch/modali) ancora classiche sono esposte su window');
      assert.ok(r.projGone, 'ASSE B: i 5 bottoni progetto + switchProject (selettore) ritirati dal ponte');
      assert.ok(r.projSelectWired, 'ASSE B: #project-select cablato via data-change="project-select" (delegation)');
      assert.ok(r.overlayOpen, 'showConfirm apre il modal-overlay');
      assert.ok(r.overlayClosed, 'modalResolve chiude il modal-overlay');
      assert.equal(r.confirmed, true, 'modalResolve(true) invoca la callback onOk');
      assert.ok(r.inpVisible, 'showPrompt mostra il campo input');
      assert.ok(r.promptOk, 'modalResolve restituisce il valore digitato alla callback prompt');
      assert.ok(r.guardThrew, 'apiFetch blocca i metodi non-GET per il ruolo viewer');
    });

    await t.test('app-cabling-editor migrato: enterRoutingMode → _routingPickPort (split) → removeRouteHop (merge) nel browser reale', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = {};
          state.racks = [{ id: 'rA', name: 'Rack A', sizeU: 42 }]; state.currentRack = 'rA';
          state.nodes.push({ id: 'sw', type: 'switch', name: 'SW', rackId: 'rA', rackU: 1, sizeU: 1, ports: 8 });
          state.nodes.push({ id: 'pp', type: 'patchpanel', name: 'PP', rackId: 'rA', rackU: 3, sizeU: 1, ports: 24 });
          state.nodes.push({ id: 'pc', type: 'pc', name: 'PC', x: 100, y: 100, ports: 1 });
          const orig = _createLinkRecord('sw-1', 'pc-1'); state.links.push(orig);
          if (typeof _invalidateIdx === 'function') _invalidateIdx();

          const fns = ['enterRoutingMode','_exitRoutingMode','_routingPickPort','removeRouteHop',
            '_routeHopRemovable','_paintRoutingTargets','_computeRoutingTargets']
            .every(n => typeof window[n] === 'function');

          // il patch panel è una tappa valida tra switch e PC (gerarchia TIA-568)
          const targets = _computeRoutingTargets(orig.id);
          const ppIsTarget = targets.has('pp-1');

          enterRoutingMode(orig.id);
          const inRouting = window._routingLinkId === orig.id && document.body.classList.contains('routing-mode');

          const before = state.links.length;
          _routingPickPort('pp-1');           // split: sw-1↔pp-1 + pp-1↔pc-1
          const afterSplit = state.links.length;
          const hasA = state.links.some(l => (l.src==='sw-1'&&l.dst==='pp-1') || (l.src==='pp-1'&&l.dst==='sw-1'));
          const hasB = state.links.some(l => (l.src==='pp-1'&&l.dst==='pc-1') || (l.src==='pc-1'&&l.dst==='pp-1'));
          const exitedAfterSplit = !window._routingLinkId;

          const hopRemovable = _routeHopRemovable('pp-1');
          removeRouteHop('pp-1');             // merge → cavo diretto
          const afterMerge = state.links.length;
          const directRestored = state.links.some(l => (l.src==='sw-1'&&l.dst==='pc-1') || (l.src==='pc-1'&&l.dst==='sw-1'));

          return { ok: true, fns, ppIsTarget, inRouting, before, afterSplit, hasA, hasB, exitedAfterSplit, hopRemovable, afterMerge, directRestored };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso cabling-editor: ' + r.err);
      assert.ok(r.fns, 'le funzioni di instradamento sono esposte su window');
      assert.ok(r.ppIsTarget, '_computeRoutingTargets include le porte del patch panel');
      assert.ok(r.inRouting, 'enterRoutingMode attiva la modalità (routing-mode + _routingLinkId)');
      assert.equal(r.afterSplit, r.before + 1, '_routingPickPort spezza il cavo in 2 tratti');
      assert.ok(r.hasA && r.hasB, '_routingPickPort crea i segmenti sw↔pp e pp↔pc');
      assert.ok(r.exitedAfterSplit, '_routingPickPort esce dalla modalità instradamento');
      assert.ok(r.hopRemovable, '_routeHopRemovable: la tappa pp ha esattamente 2 cavi');
      assert.equal(r.afterMerge, r.afterSplit - 1, 'removeRouteHop fonde i 2 tratti');
      assert.ok(r.directRestored, 'removeRouteHop ripristina il cavo diretto sw↔pc');
    });

    await t.test('app-types migrato: catalogo TYPES su window + node-spec (compact/view) + front-panel layout nel browser reale', async () => {
      const r = await page.evaluate(() => {
        try {
          const fns = ['_ensureNodeSpec','_compactNodeSpec','_nodeSpecView','_fixedRackLabel',
            '_frontPanelState','_frontPanelRows','_frontPanelSfpGroups','_frontPanelIsUplink',
            '_isNodeSpecField','_frontPanelPortLabel'].every(n => typeof window[n] === 'function');

          // TYPES è il catalogo foundation su window
          const typesOk = !!(window.TYPES && window.TYPES.switch && window.TYPES.switch.isRack
            && window.TYPES.pc && window.TYPES.pc.isFloor && window.TYPES.patchpanel.passThrough === 'port');
          const prefixOk = !!(window.NODE_ID_PREFIX && window.NODE_ID_PREFIX.switch === 'sw');
          const fixedLabel = _fixedRackLabel('blankpanel');

          // node-spec: _compactNodeSpec migra i campi noti dentro node.spec
          const node = { id: 'sw', type: 'switch', swRole: 'core', name: 'SW' };
          _compactNodeSpec(node);
          const compacted = !!(node.spec && node.spec.swRole === 'core' && node.swRole === undefined);
          const view = _nodeSpecView(node);
          const viewSees = view.swRole === 'core';
          const isSpecField = _isNodeSpecField('swRole') && !_isNodeSpecField('nonEsiste');

          // front-panel: uno switch a 24 porte → 2 righe (dispari/pari)
          const sw = { id: 'sw', type: 'switch', ports: 24 };
          const rows = _frontPanelRows(sw, 24);
          const twoRows = Array.isArray(rows) && rows.length === 2;
          const fpState = _frontPanelState(sw, 24);
          const fpHasPortCount = !!(fpState && typeof fpState.portCount === 'number' && fpState.portCount > 0);

          return { ok: true, fns, typesOk, prefixOk, fixedLabel, compacted, viewSees, isSpecField, twoRows, fpHasPortCount };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso app-types: ' + r.err);
      assert.ok(r.fns, 'le funzioni node-spec/front-panel sono esposte su window');
      assert.ok(r.typesOk, 'il catalogo TYPES (foundation) vive su window');
      assert.ok(r.prefixOk, 'NODE_ID_PREFIX è esposto (switch→sw)');
      assert.equal(r.fixedLabel, 'Pannello vuoto', '_fixedRackLabel risolve l\'etichetta fissa');
      assert.ok(r.compacted, '_compactNodeSpec migra i campi noti in node.spec');
      assert.ok(r.viewSees, '_nodeSpecView espone i campi spec come fossero sul nodo');
      assert.ok(r.isSpecField, '_isNodeSpecField distingue i campi spec dai non-spec');
      assert.ok(r.twoRows, '_frontPanelRows: switch 24 porte → 2 righe');
      assert.ok(r.fpHasPortCount, '_frontPanelState riporta il portCount');
    });

    await t.test('app.js (nucleo) migrato: stato core su window + funzioni core esposte + index O(1) + owned-state sloppy nel browser reale', async () => {
      const r = await page.evaluate(() => {
        try {
          // 1) stato core + funzioni core su window (come quando app.js era classic script)
          const stateOk = !!(window.state && Array.isArray(window.state.nodes)
            && Array.isArray(window.state.links) && window.state.ports && typeof window.state.ports === 'object');
          // NB: undo/redo NON sono più su window (ritiro ponte ASSE B: 1ª superficie
          // migrata a event delegation → data-act, funzioni IMPORTATE non esposte).
          const coreFns = ['nodeById','getNodeByPortId','getPortNodeId','escapeHTML','uid','normalizeNumber',
            'markDirty','pushHistory','renderCables','updateN','deleteNode','switchRightTab','_migrateState',
            '_getLinkPhysicalView','_cableAutoLabel','_resetSelection','logAudit','_buildDefaultState'
          ].every(n => typeof window[n] === 'function');
          // ASSE B: importJSON (file-input JSON) migrata a event delegation → fuori da window,
          // #json-upload cablato via data-change="json-upload".
          const importJsonGone = typeof window.importJSON === 'undefined';
          const jsonUploadWired = document.getElementById('json-upload').getAttribute('data-change') === 'json-upload';

          // 2) utility pure: comportamento corretto
          const esc = escapeHTML('<a>&"') === '&lt;a&gt;&amp;&quot;';
          const num = normalizeNumber('abc', 7, 1, 10) === 7 && normalizeNumber('99', 1, 1, 10) === 10;
          const idp = _idPrefixForType('switch') === 'sw';
          const uidUnique = uid('l') !== uid('l');

          // 3) index O(1) (nodeById/_rebuildIdx) su uno stato default fresh, poi ripristina
          const fresh = _migrateState(_buildDefaultState());
          const node = fresh.nodes.find(n => n.id === 'sw1');
          const saved = window.state;
          window.state = fresh; _invalidateIdx();
          const lookupOk = nodeById('sw1') === node && nodeById('non-esiste') === null;
          const portNodeOk = getNodeByPortId('sw1-1') === node;
          const phys = _getLinkPhysicalView(fresh.links[0]);
          const physOk = !!(phys && Array.isArray(phys.segments) && phys.segments.length >= 1);
          window.state = saved; _invalidateIdx();

          // 4) owned-state condiviso (sloppy mode): la scrittura bare interna
          //    `selId=null` in _resetSelection colpisce window.selId (la stessa
          //    proprietà che gli altri moduli del bundle leggono via win.selId).
          const prevSel = window.selId, prevType = window.selType;
          window.selId = '__probe__'; window.selType = 'node';
          _resetSelection();
          const ownedStateOk = window.selId === null && window.selType === null;
          window.selId = prevSel; window.selType = prevType;

          return { ok: true, stateOk, coreFns, importJsonGone, jsonUploadWired, esc, num, idp, uidUnique, lookupOk, portNodeOk, physOk, ownedStateOk };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso app.js nucleo: ' + r.err);
      assert.ok(r.stateOk, 'window.state (nodes/links/ports) esiste sul nucleo bundlato');
      assert.ok(r.coreFns, 'le funzioni core del nucleo sono esposte su window');
      assert.ok(r.importJsonGone, 'ASSE B: importJSON ritirata dal ponte (data-change="json-upload")');
      assert.ok(r.jsonUploadWired, 'ASSE B: #json-upload cablato via data-change="json-upload" (delegation)');
      assert.ok(r.esc, 'escapeHTML neutralizza i metacaratteri HTML');
      assert.ok(r.num, 'normalizeNumber applica fallback e clamp');
      assert.ok(r.idp, '_idPrefixForType(switch) === sw');
      assert.ok(r.uidUnique, 'uid genera identificatori distinti');
      assert.ok(r.lookupOk, 'nodeById risolve in O(1) e ritorna null sugli assenti');
      assert.ok(r.portNodeOk, 'getNodeByPortId mappa il pid al nodo');
      assert.ok(r.physOk, '_getLinkPhysicalView ritorna almeno un segmento');
      assert.ok(r.ownedStateOk, 'owned-state: _resetSelection azzera window.selId/selType (sloppy bare→window)');
    });

    await t.test('ASSE B — event delegation: Annulla/Ripeti girano via data-act (funzioni IMPORTATE, non su window)', async () => {
      const r = await page.evaluate(() => {
        try {
          const u = document.getElementById('btn-undo'), rd = document.getElementById('btn-redo');
          // 1) i bottoni non hanno più onclick, ma data-act; e undo/redo NON sono su window
          const wiredOk = u && rd && u.getAttribute('data-act') === 'undo' && rd.getAttribute('data-act') === 'redo'
            && !u.getAttribute('onclick') && !rd.getAttribute('onclick')
            && typeof window.undo === 'undefined' && typeof window.redo === 'undefined';
          // 2) storia undo sintetica a 2 stati (marker _mk) + click DELEGATO
          const s = window.state;
          window._history = [JSON.stringify(Object.assign({}, s, { _mk: 'A' })), JSON.stringify(Object.assign({}, s, { _mk: 'B' }))];
          window._histIdx = 1; window.state._mk = 'B';
          u.disabled = false; u.click();                 // scatta SOLO via delegation
          const undoOk = window._histIdx === 0 && window.state._mk === 'A';
          rd.disabled = false; rd.click();
          const redoOk = window._histIdx === 1 && window.state._mk === 'B';
          return { ok: true, wiredOk, undoOk, redoOk };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso delegation: ' + r.err);
      assert.ok(r.wiredOk, 'i bottoni undo/redo hanno data-act (no onclick) e window.undo/redo sono ritirati dal ponte');
      assert.ok(r.undoOk, 'click delegato su #btn-undo esegue undo() (import) → _histIdx cala, stato ripristinato');
      assert.ok(r.redoOk, 'click delegato su #btn-redo esegue redo() (import) → _histIdx risale');
    });

    await t.test('ASSE B — event delegation: menu utente (toggle/account/lingua/logout) via data-act, non su window', async () => {
      const r = await page.evaluate(() => {
        try {
          const btn = document.getElementById('btn-user');
          const dd = document.getElementById('user-dropdown');
          // 1) le funzioni del menu utente NON sono più su window (ritiro ponte ASSE B)
          const gone = ['toggleUserMenu', 'openUserManager', 'openChangePassword', 'doLogout', 'switchLang']
            .every(n => typeof window[n] === 'undefined');
          // 2) i bottoni portano data-act (no onclick)
          const wiredOk = btn && btn.getAttribute('data-act') === 'user-menu-toggle' && !btn.getAttribute('onclick')
            && document.querySelector('[data-act="user-manager-open"]')
            && document.querySelector('[data-act="change-password"]')
            && document.querySelector('[data-act="logout"]')
            && document.querySelector('[data-act="lang-switch"][data-lang="it"]');
          // 3) il toggle apre/chiude il dropdown via click DELEGATO (no logout/no cambio lingua = niente side-effect)
          dd.style.display = 'none';
          btn.click();
          const opened = dd.style.display === 'block';
          btn.click();
          const closed = dd.style.display === 'none';
          return { ok: true, gone, wiredOk: !!wiredOk, opened, closed };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso menu utente: ' + r.err);
      assert.ok(r.gone, 'toggleUserMenu/openUserManager/openChangePassword/doLogout/switchLang ritirati dal ponte');
      assert.ok(r.wiredOk, 'i bottoni del menu account hanno i data-act attesi (no onclick)');
      assert.ok(r.opened, 'click delegato su #btn-user apre #user-dropdown');
      assert.ok(r.closed, 'secondo click delegato lo richiude (toggle)');
    });

    await t.test('ASSE B — event delegation: bottoni progetto della toolbar via data-act, non su window', async () => {
      // Solo verifica STATICA (wiring + ritiro dal ponte): NON clicco new/save/delete
      // perché mutano lo stato server reale. Il flusso funzionale è coperto altrove.
      const r = await page.evaluate(() => {
        try {
          const map = {
            'project-new': 'newProject', 'project-rename': 'renameProject',
            'project-duplicate': 'duplicateProject', 'project-delete': 'deleteProject',
            'project-save': 'saveProject',
          };
          let wiredOk = true;
          for (const act of Object.keys(map)) {
            const el = document.querySelector('[data-act="' + act + '"]');
            if (!el || el.getAttribute('onclick')) wiredOk = false;
          }
          const btnSave = document.getElementById('btn-save');
          const saveWired = btnSave && btnSave.getAttribute('data-act') === 'project-save';
          const gone = Object.values(map).every(n => typeof window[n] === 'undefined');
          return { ok: true, wiredOk, saveWired: !!saveWired, gone };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore: ' + r.err);
      assert.ok(r.wiredOk, 'i 5 bottoni progetto hanno data-act (no onclick)');
      assert.ok(r.saveWired, '#btn-save ha data-act="project-save"');
      assert.ok(r.gone, 'newProject/renameProject/duplicateProject/deleteProject/saveProject ritirate dal ponte');
    });

    await t.test('VLAN nativa: toggle per-riga sul pannello VLAN imposta state.nativeVlan (stile guest/voce)', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0;
          state.vlanColors = { 1: '#888888', 10: '#ff0000', 99: '#00ff00' };
          delete state.nativeVlan;
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          selType = null; selId = null;                       // contesto progetto (no selezione)
          if (typeof switchRightTab === 'function') switchRightTab('props');
          if (typeof setPropsSectionState === 'function') setPropsSectionState('floor-vlan', true);
          renderProps();

          const beforeNative = (typeof _siteNativeVlan === 'function') ? _siteNativeVlan() : 1;
          const btn = document.querySelector('button[onclick="toggleSiteNativeVlan(99)"]');
          const hadBtn = !!btn;
          if (btn) btn.click();                                // setSiteNativeVlan(99) + re-render
          const afterNative = (typeof _siteNativeVlan === 'function') ? _siteNativeVlan() : 1;
          const stateNat = state.nativeVlan;
          const btn2 = document.querySelector('button[onclick="toggleSiteNativeVlan(99)"]');
          const isActive = btn2 ? btn2.className.includes('primary') : false;
          if (btn2) btn2.click();                              // ri-clic → torna a default (1)
          const afterToggleOff = (typeof _siteNativeVlan === 'function') ? _siteNativeVlan() : 1;

          return { ok: true, hadBtn, beforeNative, afterNative, stateNat, isActive, afterToggleOff };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso VLAN nativa: ' + r.err);
      assert.ok(r.hadBtn, 'il toggle nativa è presente in ogni riga VLAN');
      assert.equal(r.beforeNative, 1, 'nativa di sito parte da 1 (default)');
      assert.equal(r.afterNative, 99, 'clic sul toggle → nativa di sito = 99');
      assert.equal(r.stateNat, 99, 'state.nativeVlan persistito a 99');
      assert.ok(r.isActive, 'il toggle della VLAN scelta è evidenziato (primary)');
      assert.equal(r.afterToggleOff, 1, 're-clic sulla stessa → torna alla nativa default (1)');
    });

    await t.test('app-properties-link: VLAN access editabile sul pannello cavo (capo attivo scrive il PVID)', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = {};
          state.nodes.push({ id: 'sw', type: 'switch', name: 'SW', rackId: state.currentRack, rackU: 1, sizeU: 1, ports: 8 });
          state.nodes.push({ id: 'pc', type: 'pc', name: 'PC', x: 50, y: 50, w: 60, h: 40, ports: 1 });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          const lk = _createLinkRecord('sw-1', 'pc-1'); state.links.push(lk);   // access: pc è leaf → niente trunk
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          if (typeof switchRightTab === 'function') switchRightTab('props');
          selType = 'link'; selId = lk.id; renderProps();

          const inputs = [...document.querySelectorAll('#props-panel input[type="number"]')];
          const vlanInput = inputs.find(i => (i.getAttribute('onchange') || '').includes('setLinkNativeVlan'));
          const hadInput = !!vlanInput;
          if (vlanInput) { vlanInput.value = '50'; vlanInput.dispatchEvent(new Event('change')); }  // wiring reale

          const portOvr = state.ports['sw-1'] && state.ports['sw-1'].vlanOvr;
          const eff = (typeof _getLinkVlan === 'function') ? _getLinkVlan(state.links[0]) : null;
          return { ok: true, hadInput, portOvr, eff };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso VLAN access cavo: ' + r.err);
      assert.ok(r.hadInput, 'il pannello cavo in Access mostra un input VLAN editabile (setLinkNativeVlan)');
      assert.equal(r.portOvr, 50, 'la modifica scrive il PVID (vlanOvr=50) della porta switch attiva');
      assert.equal(r.eff, 50, 'la VLAN effettiva del cavo diventa 50');
    });

    await t.test('VLAN voce editabile nel pannello PORTA del telefono (uniformatura interfaccia)', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = {};
          const rid = state.currentRack;
          state.nodes.push(
            { id: 'sw', type: 'switch', name: 'SW', rackId: rid, rackU: 1, sizeU: 1, ports: 24 },
            { id: 'tel', type: 'voip', name: 'TEL', x: 0, y: 0, ports: 1, voiceVlan: 30 },
            { id: 'pc', type: 'pc', name: 'PC', x: 0, y: 0, ports: 1 });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          state.links.push(_createLinkRecord('sw-2', 'tel-1'), _createLinkRecord('tel-1', 'pc-1'));
          state.ports['sw-2'] = { vlanOvr: 10 };
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          propagateVlans();
          if (typeof switchRightTab === 'function') switchRightTab('props');
          selType = 'port'; selId = 'tel-1'; renderProps();

          // il device-panel del telefono NON deve più avere la VLAN voce (uniformatura)
          selType = 'node'; selId = 'tel'; renderProps();
          const inDevice = (document.getElementById('props-panel').innerHTML || '').includes('setNodeVoiceVlan');
          // il pannello PORTA sì → editor editabile
          selType = 'port'; selId = 'tel-1'; renderProps();
          const inputs = [...document.querySelectorAll('#props-panel input[type="number"]')];
          const voiceInput = inputs.find(i => (i.getAttribute('onchange') || '').includes('setNodeVoiceVlan'));
          const hadInput = !!voiceInput;
          if (voiceInput) { voiceInput.value = '40'; voiceInput.dispatchEvent(new Event('change')); }

          const nodeVoice = (typeof _voipVoiceVlan === 'function') ? _voipVoiceVlan(nodeById('tel')) : nodeById('tel').voiceVlan;
          const carries40 = _getLinkTrunk(state.links[0]).vlans.includes(40);
          return { ok: true, inDevice, hadInput, nodeVoice, carries40 };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso VLAN voce: ' + r.err);
      assert.equal(r.inDevice, false, 'la VLAN voce NON è più nel pannello device del telefono');
      assert.ok(r.hadInput, 'il pannello PORTA del telefono ha l\'editor VLAN voce (setNodeVoiceVlan)');
      assert.equal(r.nodeVoice, 40, 'modificando il campo, node.voiceVlan diventa 40');
      assert.ok(r.carries40, 'il trunk del telefono ora trasporta la nuova VLAN voce (40)');
    });

    await t.test('hypervisor/homelab: le VLAN delle VM rendono l\'uplink un trunk derivato (stesso motore AP)', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = {};
          const rid = state.currentRack;
          state.nodes.push(
            { id: 'sw', type: 'switch', name: 'SW', rackId: rid, rackU: 1, sizeU: 1, ports: 24 },
            // hypervisor (rack): 2 VM su VLAN diverse
            { id: 'hv', type: 'hypervisor', name: 'HV', rackId: rid, rackU: 3, sizeU: 2, ports: 4, mgmtVlan: 99,
              vms: [{ id: 'vm1', name: 'dc01', vlan: 20, state: 'running' }, { id: 'vm2', name: 'web01', vlan: 30, state: 'running' }] },
            // homelab (floor): 1 VM su VLAN 40 → stesso motore
            { id: 'hl', type: 'homelab', name: 'HL', x: 10, y: 10, ports: 1,
              vms: [{ id: 'v3', name: 'pbs', vlan: 40, state: 'running' }] });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          state.links.push(_createLinkRecord('sw-2', 'hv-1'), _createLinkRecord('sw-3', 'hl-1'));
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          propagateVlans();

          // carriedVlans (lib vlan-trunk su window) aggrega le VLAN delle VM
          const hvCarried = carriedVlans(nodeById('hv'));
          const hvTrunk = _getLinkTrunk(state.links[0]).vlans;
          const hlTrunk = _getLinkTrunk(state.links[1]).vlans;

          // il pannello device dell'hypervisor (rack) mostra l'editor VM
          selType = 'node'; selId = 'hv'; renderProps();
          const html = document.getElementById('props-panel').innerHTML || '';
          const hasEditor = html.includes('addVm(') && html.includes('hv-vms');

          // anche il pannello del homelab (FLOOR) dev'essere completo come l'host rack:
          // nome + Rete&Accesso + piattaforma + editor VM (regressione: il device-spec
          // floor finiva nel bucket sbagliato e non veniva mai concatenato).
          selType = 'node'; selId = 'hl'; renderProps();
          const labHtml = document.getElementById('props-panel').innerHTML || '';
          const labComplete = labHtml.includes('addVm(') && labHtml.includes('hvPlatform') && labHtml.includes("updateN('ip'");

          // aggiungere una VM via la funzione esposta e impostarne la VLAN aggiorna il trunk
          addVm('hv');
          const hv = nodeById('hv'); const newVm = hv.vms[hv.vms.length - 1];
          updateVm('hv', newVm.id, 'vlan', '50');
          propagateVlans();
          const carries50 = _getLinkTrunk(state.links[0]).vlans.includes(50);

          return { ok: true, hvCarried, hvTrunk, hlTrunk, hasEditor, labComplete, carries50 };
        } catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
      });
      assert.ok(r.ok, 'nessun errore nel flusso hypervisor/homelab: ' + r.err);
      assert.deepEqual(r.hvCarried, [20, 30], 'carriedVlans dell\'hypervisor = VLAN delle VM');
      assert.ok(r.hvTrunk.includes(20) && r.hvTrunk.includes(30), 'l\'uplink dell\'hypervisor è un trunk con le VLAN delle VM');
      assert.ok(r.hlTrunk.includes(40), 'l\'uplink del homelab (floor) trasporta la VLAN della sua VM — stesso motore');
      assert.ok(r.hasEditor, 'il pannello device dell\'hypervisor mostra l\'editor "Macchine virtuali"');
      assert.ok(r.labComplete, 'il pannello del homelab (floor) è completo: nome+Rete&Accesso+piattaforma+editor VM');
      assert.ok(r.carries50, 'aggiungendo una VM su VLAN 50 il trunk dell\'uplink la trasporta');
    });

    await t.test('VM: assorbi un tile scoperto come VM dell\'host + chiude il cerchio col MAC', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = {};
          // host floor (homelab/mini-server) + un PC scoperto (tile sciolto) con identità di rete
          state.nodes.push({ id: 'lab',  type: 'homelab', name: 'NUC-01', x: 200, y: 120, ports: 1, mac: 'AA:BB:CC:00:00:01' });
          state.nodes.push({ id: 'pcvm', type: 'pc',      name: 'VM-Web', x: 60,  y: 60,  ports: 1, mac: 'AA:BB:CC:00:00:77', ip: '10.0.0.77' });
          state.nodes.push({ id: 'lab2', type: 'homelab', name: 'NUC-02', x: 400, y: 120, ports: 1, mac: 'AA:BB:CC:00:00:02' });
          state.nodes.push({ id: 'pc2',  type: 'pc',      name: 'PC2',    x: 80,  y: 200, ports: 1, mac: 'AA:BB:CC:00:00:88' });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();

          const ok = absorbNodeAsVm('pcvm', 'lab');
          const lab = nodeById('lab');
          const vm = (lab.vms || [])[0] || {};
          const vmNameI = vm.name || '', vmIpI = vm.ip || '', vmMacI = vm.mac || '', vmId = vm.id;
          const tileGone = !nodeById('pcvm');

          // cerchio: il MAC della VM è "noto" nei deviceSigs → non più non-documentato;
          // e NON entra in doc.macs (audit di presenza) → una VM spenta non risulta "assente".
          const doc = _driftBuildDocSnapshot();
          const hex = s => String(s).toUpperCase().replace(/[^0-9A-F]/g, '');
          const vmKnown = (doc.deviceSigs || []).map(hex).includes('AABBCC000077');
          const inPresence = (doc.macs || []).some(m => hex(m.mac) === 'AABBCC000077');

          // guardie
          const guardHostInHost = absorbNodeAsVm('lab2', 'lab');  // un host non si assorbe in un host
          const guardSameNode  = absorbNodeAsVm('pc2', 'pc2');    // stesso nodo / bersaglio non-host

          // editor VM: campo MAC presente + updateVm normalizza
          selType = 'node'; selId = 'lab'; renderProps();
          const panelHasMac = (document.getElementById('props-panel').innerHTML || '').includes("updateVm('lab','" + vmId + "','mac'");
          updateVm('lab', vmId, 'mac', 'aabbcc009900');
          const macNorm = nodeById('lab').vms[0].mac;

          return { ok, vmName: vmNameI, vmIp: vmIpI, vmMac: vmMacI, tileGone, vmKnown, inPresence, guardHostInHost, guardSameNode, panelHasMac, macNorm };
        } catch (e) { return { err: String(e && e.stack || e) }; }
      });
      assert.ok(!r.err, 'nessun errore nel flusso assorbimento VM: ' + r.err);
      assert.ok(r.ok, 'absorbNodeAsVm ritorna true sul drop valido');
      assert.equal(r.vmName, 'VM-Web', 'la VM eredita il nome del tile');
      assert.equal(r.vmIp, '10.0.0.77', 'la VM eredita l\'IP del tile');
      assert.equal(r.vmMac, 'AA:BB:CC:00:00:77', 'la VM eredita il MAC del tile (normalizzato)');
      assert.ok(r.tileGone, 'il tile sciolto sparisce dal floor dopo l\'assorbimento');
      assert.ok(r.vmKnown, 'cerchio chiuso: il MAC della VM è nei deviceSigs del Drift → non più non-documentato');
      assert.ok(!r.inPresence, 'la VM NON entra nell\'audit di presenza (doc.macs): una VM spenta non risulta assente');
      assert.equal(r.guardHostInHost, false, 'guardia: un host non si assorbe dentro un host');
      assert.equal(r.guardSameNode, false, 'guardia: stesso nodo / bersaglio non-host rifiutato');
      assert.ok(r.panelHasMac, 'l\'editor VM mostra il campo MAC (updateVm …,\'mac\')');
      assert.equal(r.macNorm, 'AA:BB:CC:00:99:00', 'updateVm normalizza il MAC della VM');
    });

    await t.test('VM: rilascio DENTRO la drop-zone → import (gesto reale)', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = {};
          state.nodes.push({ id: 'lab',  type: 'homelab', name: 'NUC-01', x: 140, y: 140, ports: 1, mac: 'AA:BB:CC:00:00:01' });
          state.nodes.push({ id: 'pcvm', type: 'pc',      name: 'VM-App', x: 60,  y: 60,  ports: 1, mac: 'AA:BB:CC:00:00:55', ip: '10.0.0.55' });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          _renderAllNow();   // sincrono (renderAll è rAF-coalescato → il tile non sarebbe ancora nel DOM)
          // host selezionato + tab Proprietà + sezioni aperte → la drop-zone è nel pannello, misurabile
          if (typeof switchRightTab === 'function') switchRightTab('props');
          if (typeof setPropsSectionState === 'function') { setPropsSectionState('device-homelab', true); setPropsSectionState('hv-vms', true); }
          selType = 'node'; selId = 'lab'; renderProps();
          const dz = document.querySelector('[data-vm-dropzone][data-host-id="lab"]');
          const dzPresent = !!dz;
          const dzText = dz ? (dz.textContent || '').trim() : '';
          const pcEl = document.querySelector('[data-id="pcvm"]');
          const pcR = pcEl.getBoundingClientRect(), dzR = dz.getBoundingClientRect();
          const px = pcR.left + pcR.width / 2, py = pcR.top + pcR.height / 2;
          const dx = dzR.left + dzR.width / 2, dy = dzR.top + dzR.height / 2;
          // gesto reale: down sul PC → move (oltre soglia) sulla zona → up DENTRO la zona
          pcEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: px, clientY: py, button: 0, bubbles: true }));
          window.dispatchEvent(new PointerEvent('pointermove', { clientX: dx, clientY: dy, button: 0, bubbles: true }));
          const dzActiveMidDrag = dz.classList.contains('active');
          const ghost = document.querySelector('.vm-drag-ghost');
          const ghostShown = !!ghost && ghost.style.display !== 'none' && (ghost.textContent || '').indexOf('VM-App') >= 0;
          window.dispatchEvent(new PointerEvent('pointerup', { clientX: dx, clientY: dy, button: 0, bubbles: true }));
          const lab = nodeById('lab'); const vm = (lab.vms || [])[0] || {};
          return { dzPresent, dzText, dzW: Math.round(dzR.width), dzActiveMidDrag, ghostShown,
            vmCount: (lab.vms || []).length, vmName: vm.name || '', vmMac: vm.mac || '', vmIp: vm.ip || '', tileGone: !nodeById('pcvm') };
        } catch (e) { return { err: String(e && e.stack || e) }; }
      });
      assert.ok(!r.err, 'nessun errore nel gesto import VM: ' + r.err);
      assert.ok(r.dzPresent, 'il pannello host mostra la drop-zone (data-vm-dropzone) sotto "+ Aggiungi VM"');
      assert.ok(/trascina|drag/i.test(r.dzText), 'la drop-zone indica "trascina qui per importare"');
      assert.ok(r.dzW > 0, 'la drop-zone è visibile/misurabile (sezione aperta)');
      assert.ok(r.dzActiveMidDrag, 'la drop-zone si illumina (.active) col tile sopra durante il drag');
      assert.ok(r.ghostShown, 'mentre trascini sul pannello compare il fantasma col nome del device (non "sparisce sotto" il pannello)');
      assert.equal(r.vmCount, 1, 'il rilascio DENTRO la zona crea una VM sull\'host');
      assert.equal(r.vmName, 'VM-App', 'la VM importata eredita il nome del tile');
      assert.equal(r.vmMac, 'AA:BB:CC:00:00:55', 'la VM importata eredita il MAC del tile');
      assert.equal(r.vmIp, '10.0.0.55', 'la VM importata eredita l\'IP del tile');
      assert.ok(r.tileGone, 'il tile sparisce dal floor dopo l\'import');
    });

    await t.test('VM: rilascio sul PANNELLO ma FUORI dalla zona → NESSUN import e il device TORNA alla posizione di partenza', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = {};
          state.nodes.push({ id: 'lab',  type: 'homelab', name: 'NUC-01', x: 140, y: 140, ports: 1, mac: 'AA:BB:CC:00:00:01' });
          state.nodes.push({ id: 'pcvm', type: 'pc',      name: 'VM-App', x: 60,  y: 60,  ports: 1, mac: 'AA:BB:CC:00:00:55', ip: '10.0.0.55' });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          _renderAllNow();
          if (typeof switchRightTab === 'function') switchRightTab('props');
          if (typeof setPropsSectionState === 'function') { setPropsSectionState('device-homelab', true); setPropsSectionState('hv-vms', true); }
          selType = 'node'; selId = 'lab'; renderProps();
          const dz = document.querySelector('[data-vm-dropzone][data-host-id="lab"]');
          const pcEl = document.querySelector('[data-id="pcvm"]');
          const pcR = pcEl.getBoundingClientRect(), dzR = dz.getBoundingClientRect();
          const px = pcR.left + pcR.width / 2, py = pcR.top + pcR.height / 2;
          const dx = dzR.left + dzR.width / 2, dy = dzR.top + dzR.height / 2;
          const ox = nodeById('pcvm').x, oy = nodeById('pcvm').y;   // posizione di partenza (60,60)
          const mx = dzR.left + dzR.width / 2, my = dzR.top - 40;   // sul pannello, SOPRA la zona (non è la zona)
          pcEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: px, clientY: py, button: 0, bubbles: true }));
          // 1) passa SOPRA la drop-zone → la "arma" (stato _vmDropHost = 'lab', poi stale)
          window.dispatchEvent(new PointerEvent('pointermove', { clientX: dx, clientY: dy, button: 0, bubbles: true }));
          const wasActiveOverZone = dz.classList.contains('active');
          // 2) RILASCIA sul pannello, fuori dalla zona, SENZA un move intermedio → lo stato
          //    "ultimo move" resta sulla zona (stale): il vecchio codice avrebbe assorbito.
          window.dispatchEvent(new PointerEvent('pointerup', { clientX: mx, clientY: my, button: 0, bubbles: true }));
          const elAt = document.elementFromPoint(mx, my);
          const relOnPanel = !!(elAt && elAt.closest && elAt.closest('#rack-view'));
          const relIsDz = !!(elAt && elAt.closest && elAt.closest('[data-vm-dropzone]'));
          const lab = nodeById('lab'); const pc = nodeById('pcvm');
          return { wasActiveOverZone, relOnPanel, relIsDz, vmCount: (lab.vms || []).length,
            tilePresent: !!pc, x: pc ? pc.x : null, y: pc ? pc.y : null, ox, oy };
        } catch (e) { return { err: String(e && e.stack || e) }; }
      });
      assert.ok(!r.err, 'nessun errore: ' + r.err);
      assert.ok(r.wasActiveOverZone, 'setup: passando sopra la zona questa si arma (stato "ultimo move" sulla zona, poi stale)');
      assert.ok(r.relOnPanel, 'sanity: il rilascio è sul pannello (#rack-view)');
      assert.ok(!r.relIsDz, 'sanity: il rilascio NON è sulla drop-zone');
      assert.equal(r.vmCount, 0, 'NESSUN import (rilasciato fuori dalla zona, anche se l\'ultimo move era sopra)');
      assert.ok(r.tilePresent, 'il device resta in vita');
      assert.equal(r.x, r.ox, 'il device TORNA alla X di partenza (area sbagliata → niente tile perso sotto il pannello)');
      assert.equal(r.y, r.oy, 'il device TORNA alla Y di partenza');
    });

    await t.test('VM: rilascio sulla PLANIMETRIA (altrove) → riposiziona, NON torna indietro', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = {};
          state.nodes.push({ id: 'pcx', type: 'pc', name: 'PC-Move', x: 80, y: 80, ports: 1, mac: 'AA:BB:CC:00:00:88', ip: '10.0.0.88' });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          _renderAllNow();
          const pcEl = document.querySelector('[data-id="pcx"]');
          const pcR = pcEl.getBoundingClientRect();
          const px = pcR.left + pcR.width / 2, py = pcR.top + pcR.height / 2;
          const ox = nodeById('pcx').x, oy = nodeById('pcx').y;
          const fpR = document.getElementById('floorplan').getBoundingClientRect();
          const fx = fpR.left + fpR.width * 0.5, fy = fpR.top + fpR.height * 0.5;   // centro planimetria
          pcEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: px, clientY: py, button: 0, bubbles: true }));
          window.dispatchEvent(new PointerEvent('pointermove', { clientX: fx, clientY: fy, button: 0, bubbles: true }));
          window.dispatchEvent(new PointerEvent('pointerup', { clientX: fx, clientY: fy, button: 0, bubbles: true }));
          const elAt = document.elementFromPoint(fx, fy);
          const relOnFloor = !!(elAt && elAt.closest && elAt.closest('#floorplan'));
          const pc = nodeById('pcx');
          return { relOnFloor, moved: !!(pc && (pc.x !== ox || pc.y !== oy)), present: !!pc };
        } catch (e) { return { err: String(e && e.stack || e) }; }
      });
      assert.ok(!r.err, 'nessun errore: ' + r.err);
      assert.ok(r.relOnFloor, 'sanity: il rilascio è sulla planimetria (#floorplan)');
      assert.ok(r.moved, 'il device si è RIPOSIZIONATO sul floor (un normale spostamento NON viene annullato)');
      assert.ok(r.present, 'il device resta in vita');
    });

    await t.test('UX uniforme floor=rack: single-click seleziona ma NON apre le proprietà (il pannello host regge)', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = {};
          state.nodes.push({ id: 'lab',  type: 'homelab', name: 'NUC-01', x: 600, y: 350, ports: 1, mac: 'AA:BB:CC:00:00:01' });
          state.nodes.push({ id: 'pcvm', type: 'pc',      name: 'VM-Web', x: 360, y: 320, ports: 1, mac: 'AA:BB:CC:00:00:55', ip: '10.0.0.55' });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          _renderAllNow();
          // host aperto (intent esplicito) → drop-zone nel pannello
          if (typeof switchRightTab === 'function') switchRightTab('props');
          if (typeof setPropsSectionState === 'function') { setPropsSectionState('device-homelab', true); setPropsSectionState('hv-vms', true); }
          window._propsExplicit = true; selType = 'node'; selId = 'lab'; renderProps();
          const hostShown = !!document.querySelector('[data-vm-dropzone][data-host-id="lab"]');

          // SINGLE click reale sul PC (down+up stesso punto, niente drag) = lo scenario del bug
          const el = document.querySelector('[data-id="pcvm"]');
          const rc = el.getBoundingClientRect();
          const x = rc.left + rc.width / 2, y = rc.top + rc.height / 2;
          el.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true }));
          window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0, bubbles: true }));
          const afterSelId = (typeof selId !== 'undefined') ? selId : null;
          const stillHostPanel = !!document.querySelector('[data-vm-dropzone][data-host-id="lab"]');
          const explicit = !!window._propsExplicit;

          // intent esplicito (= ciò che fa il DOPPIO click) → le proprietà del PC SI aprono
          window._propsExplicit = true; selType = 'node'; selId = 'pcvm'; renderProps();
          const dblOpens = (document.getElementById('props-panel').innerHTML || '').includes('VM-Web');
          return { hostShown, afterSelId, stillHostPanel, explicit, dblOpens };
        } catch (e) { return { err: String(e && e.stack || e) }; }
      });
      assert.ok(!r.err, 'nessun errore: ' + r.err);
      assert.ok(r.hostShown, 'setup: il pannello mostra l\'host con la drop-zone');
      assert.equal(r.afterSelId, 'pcvm', 'il single-click SELEZIONA il PC');
      assert.ok(r.stillHostPanel, 'il single-click NON switcha: il pannello resta sull\'host (drop-zone presente) → il drag-import regge anche dopo aver toccato il PC');
      assert.ok(!r.explicit, 'single-click floor → _propsExplicit=false (solo selezione, come il rack)');
      assert.ok(r.dblOpens, 'con intent esplicito (= doppio click) le proprietà del device floor si aprono (VM-Web)');
    });

    await t.test('gesto reale DOPPIO click su device floor → apre le Proprietà (regressione: dblclick nativo non scatta, il DOM si ricostruisce tra i click)', async () => {
      const r = await page.evaluate(() => {
        try {
          state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
          state.nodes.length = 0; state.links.length = 0; state.ports = {};
          state.nodes.push({ id: 'pcx', type: 'pc', name: 'PC-Doppio', x: 520, y: 300, ports: 1, mac: 'AA:BB:CC:00:00:77', ip: '10.0.0.77' });
          if (typeof _invalidateIdx === 'function') _invalidateIdx();
          window._propsExplicit = false; selType = null; selId = null;
          if (typeof switchRightTab === 'function') switchRightTab('props');
          _renderAllNow();

          const fireDown = (x, y) => { document.querySelector('[data-id="pcx"]').dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true })); };
          const fireUp = (x, y) => { window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0, bubbles: true })); };
          const center = () => { const rc = document.querySelector('[data-id="pcx"]').getBoundingClientRect(); return { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2 }; };

          // 1° click reale (down+up stesso punto, niente drag)
          let c = center();
          fireDown(c.x, c.y); fireUp(c.x, c.y);
          const explicitAfter1 = !!window._propsExplicit;          // false = solo selezione
          const selAfter1 = (typeof selId !== 'undefined') ? selId : null;

          // Forza il rebuild del DOM del floor (è ciò che fa il renderAll del 1°
          // click → renderFloor fa innerHTML=''): l'elemento del nodo diventa NUOVO
          // → il dblclick nativo NON scatterebbe. Il rilevamento manuale per
          // id+timestamp deve reggere comunque.
          _renderAllNow();

          // 2° click reale entro la soglia, sullo STESSO nodo
          c = center();
          fireDown(c.x, c.y); fireUp(c.x, c.y);
          const explicitAfter2 = !!window._propsExplicit;          // true = doppio click
          const opens = (document.getElementById('props-panel').innerHTML || '').includes('PC-Doppio');
          return { explicitAfter1, selAfter1, explicitAfter2, opens };
        } catch (e) { return { err: String(e && e.stack || e) }; }
      });
      assert.ok(!r.err, 'nessun errore: ' + r.err);
      assert.ok(!r.explicitAfter1, '1° click reale: solo selezione (_propsExplicit resta false)');
      assert.equal(r.selAfter1, 'pcx', '1° click reale: il device è selezionato');
      assert.ok(r.explicitAfter2, '2° click reale sullo stesso nodo entro 350ms → doppio click → _propsExplicit=true');
      assert.ok(r.opens, 'il DOPPIO click reale apre le Proprietà del device floor (PC-Doppio) ANCHE dopo un rebuild del DOM tra i due click');
    });

    await t.test('gesto reale: click su un device seleziona ed aggiorna il pannello Proprietà', async () => {
      await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        renderAll();
      });
      await page.waitForSelector('.floor-node', { timeout: 5000 });
      await page.click('.floor-node'); // pointer reale → handler di selezione (app-pointer.js)
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        if (typeof switchRightTab === 'function') switchRightTab('props');
        renderProps();
        const placeholder = 'Seleziona un elemento';
        const txt = document.getElementById('props-panel').textContent || '';
        return {
          selType: typeof selType !== 'undefined' ? selType : null,
          selId: typeof selId !== 'undefined' ? selId : null,
          hasSelectedEl: !!document.querySelector('[class*="selected"]'),
          propsRefreshed: txt.length > 15 && !txt.includes(placeholder),
        };
      });
      assert.ok(['node', 'port'].includes(r.selType), 'il click seleziona un device/porta (event wiring reale): ' + r.selType);
      assert.ok(r.selId, 'selId impostato dal click');
      assert.ok(r.hasSelectedEl, 'la selezione è riflessa nel DOM (classe .selected)');
      assert.ok(r.propsRefreshed, 'il pannello Proprietà si aggiorna sull’elemento selezionato');
    });

    await t.test('bundle esbuild: i moduli ESM migrati (app-audit, app-spare, app-management) girano nel browser reale', async () => {
      const r = await page.evaluate(() => {
        // Le funzioni provengono dal bundle (src/*.js → expose()).
        const exposed = typeof _applySpareHighlight === 'function' &&
          typeof _mgmtRow === 'function' && typeof _openMgmt === 'function';
        // ASSE B: openAuditLog/openSpareReport sono DELEGATE (voci menu Report via data-act) → non su window
        const delegatedGone = typeof window.openAuditLog === 'undefined' && typeof window.openSpareReport === 'undefined';
        // ASSE B: le azioni interne agli overlay Storia/Porte-libere sono delegate → fuori da window
        const reportFnsOffWin = ['exportAuditCsv', '_closeAuditLog', 'setAuditFilter',
          'spareExportCsv', '_closeSpareReport', 'setSpareHighlight'].every((n) => typeof window[n] === 'undefined');
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        // app-audit: legge win.state.auditLog (ponte) + t()/getLang() importati dai puri
        state.auditLog = [{ ts: Date.now(), action: 'device-add', target: 'SW-Core', user: 'tester' }];
        document.querySelector('[data-act="report-audit"]').click();   // apre l'overlay via event delegation
        const av = document.getElementById('audit-overlay');
        // app-spare: usa win.TYPES/_isLeafEndpoint/_frontPanelSfpGroups (ponte) +
        // buildSpareReport (import puro) sul default state (switch 24 porte).
        document.querySelector('[data-act="report-spare"]').click();   // apre l'overlay via event delegation
        const sv = document.getElementById('spare-overlay');
        // ASSE B: wiring delegato degli overlay + drive di eventi REALI (se un handler
        // lancia, l'evaluate rigetta e il test fallisce → prova che la route delegata gira).
        const auditWired = !!av.querySelector('[data-act="audit-close"]') && !!av.querySelector('[data-act="audit-export"]')
          && !!av.querySelector('[data-input="audit-filter"]');
        const spareWired = !!sv.querySelector('[data-act="spare-close"]') && !!sv.querySelector('[data-act="spare-export"]')
          && !!sv.querySelector('[data-change="spare-highlight"]');
        const filt = av.querySelector('[data-input="audit-filter"]');
        filt.value = 'SW'; filt.dispatchEvent(new Event('input', { bubbles: true }));   // -> setAuditFilter
        const hl = sv.querySelector('[data-change="spare-highlight"]');
        hl.checked = true; hl.dispatchEvent(new Event('change', { bubbles: true }));      // -> setSpareHighlight
        hl.checked = false; hl.dispatchEvent(new Event('change', { bubbles: true }));     // ripristino
        // app-management: _mgmtRow legge win.nodeById/win.escapeHTML (ponte) e
        // costruisce l'URL primario protocollo+IP (https di default).
        const firstNode = (state.nodes || [])[0];
        const mgmtHtml = firstNode ? _mgmtRow('', '10.0.0.9', firstNode.id) : '';
        return {
          exposed,
          auditVisible: !!av && av.style.display === 'flex',
          auditRow: av ? (av.querySelector('.audit-row') || {}).textContent || '' : '',
          spareVisible: !!sv && sv.style.display === 'flex',
          spareHasRows: !!sv && sv.querySelectorAll('.spare-row').length > 0,
          mgmtHtml,
          delegatedGone, reportFnsOffWin, auditWired, spareWired,
        };
      });
      assert.ok(r.exposed, 'le funzioni dei moduli migrati sono pubblicate su window dal bundle');
      assert.ok(r.delegatedGone, 'ASSE B: openAuditLog/openSpareReport ritirate dal ponte (voci menu Report via data-act)');
      assert.ok(r.reportFnsOffWin, 'ASSE B: azioni interne agli overlay Storia/Porte-libere ritirate da window (delegation)');
      assert.ok(r.auditWired, 'overlay Storia cablato via data-act/data-input (close/export/filter)');
      assert.ok(r.spareWired, 'overlay Porte-libere cablato via data-act/data-change (close/export/highlight)');
      assert.ok(r.auditVisible, 'la voce "Storia" del menu Report (data-act) apre l’overlay (render reale)');
      assert.match(r.auditRow, /SW-Core/, 'la riga audit legge state via il ponte e rende il target');
      assert.ok(r.spareVisible, 'la voce "Porte libere" del menu Report (data-act) apre l’overlay');
      assert.ok(r.spareHasRows, 'il report porte legge state+TYPES via il ponte e calcola le righe');
      assert.match(r.mgmtHtml, /mgmt-block/, '_mgmtRow rende il blocco Management');
      assert.match(r.mgmtHtml, /https:\/\/10\.0\.0\.9/, '_mgmtRow costruisce l’URL primario protocollo+IP via il ponte');
    });

    await t.test('app-stack-ha migrato: setNodeHaPair propaga la simmetria nel browser reale', async () => {
      const r = await page.evaluate(() => {
        // I setter sono nel bundle (src/app-stack-ha.js → expose()). Leggono
        // win.nodeById/selId/TYPES/_ensureNodeSpec/propagateHaSymmetry/state.
        const exposed = typeof setNodeHaPair === 'function' && typeof removeNodeFromHa === 'function' &&
          typeof _defaultStackName === 'function';
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        // due firewall (tipo haEligible) — modello nodo minimale come negli smoke
        const fwA = { id: 'fwA', type: 'firewall', name: 'FW-A', x: 0, y: 0, w: 60, h: 40 };
        const fwB = { id: 'fwB', type: 'firewall', name: 'FW-B', x: 80, y: 0, w: 60, h: 40 };
        state.nodes.push(fwA, fwB);
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        selType = 'node'; selId = 'fwA';
        setNodeHaPair('fwB', 'active', 'active-passive');   // A→B
        const a = nodeById('fwA'), b = nodeById('fwB');
        return {
          exposed,
          aPeer: a?.spec?.haPeer || null, aRole: a?.spec?.haRole || null,
          bPeer: b?.spec?.haPeer || null, bRole: b?.spec?.haRole || null,  // simmetria propagata
          slug: _defaultStackName({ hostname: 'Core01.lan' }),
        };
      });
      assert.ok(r.exposed, 'i setter stack/HA sono pubblicati su window dal bundle');
      assert.equal(r.aPeer, 'fwB', 'A punta a B (setter scrive spec via il ponte)');
      assert.equal(r.bPeer, 'fwA', 'B punta ad A: propagateHaSymmetry ha letto win.state.nodes');
      assert.equal(r.bRole, 'standby', 'il peer riceve il ruolo complementare (active→standby)');
      assert.equal(r.slug, 'stk-core01', '_defaultStackName slugifica hostname senza dominio');
    });

    await t.test('app-panel-skin migrato: sezione skin + fallback render nel browser reale', async () => {
      const r = await page.evaluate(() => {
        // Funzioni dal bundle (src/app-panel-skin.js → expose()). Leggono t (ponte
        // i18n), win.escapeHTML/_propsSectionIsOpen e win.parsePanelSkin (panel-skin.js).
        const exposed = typeof _panelSkinSectionHtml === 'function' &&
          typeof _resolveNodeSkin === 'function' && typeof _panelSkinRackHtml === 'function' &&
          typeof loadPanelSkinStore === 'function' && typeof assignNodeSkin === 'function';
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        const sw = { id: 'swSkin', type: 'switch', name: 'SW-1', brand: 'Cisco', model: 'C9300' };
        state.nodes.push(sw);
        // nodo senza skin: la sezione rende il dropdown "nessuna" e il rack html è '' (fallback)
        const sectionHtml = _panelSkinSectionHtml(sw);
        const rackHtml = _panelSkinRackHtml(sw);
        const resolved = _resolveNodeSkin(sw);
        return {
          exposed,
          sectionHasSelect: sectionHtml.indexOf('assignNodeSkin') >= 0 && sectionHtml.indexOf('skin') >= 0,
          rackFallback: rackHtml === '',          // niente skin → fallback al layout generato
          resolvedNull: resolved === null,
        };
      });
      assert.ok(r.exposed, 'le funzioni panel-skin sono pubblicate su window dal bundle');
      assert.ok(r.sectionHasSelect, '_panelSkinSectionHtml rende il dropdown (legge t + win.escapeHTML via ponte)');
      assert.ok(r.rackFallback, '_panelSkinRackHtml ritorna \'\' senza skin (fallback al layout generato)');
      assert.ok(r.resolvedNull, '_resolveNodeSkin → null per nodo senza skin');
    });

    await t.test('app-l3 migrato: report L3 + badge gateway + SVI nel browser reale', async () => {
      // Copertura spostata qui dallo smoke (test/smoke-app.test.js) dopo la migrazione
      // di app-l3 al bundle: lo stub-DOM dello smoke non carica /dist/app.bundle.js.
      const r = await page.evaluate(() => {
        const exposed = typeof _l3GatewayNodeIds === 'function' &&
          typeof _l3SviSectionHtml === 'function';
        // ASSE B: openL3Report è DELEGATA (voce "Mappa L3" del menu Report via data-act) → non su window
        const delegatedGone = typeof window.openL3Report === 'undefined';
        // ASSE B: le azioni interne al report L3 (chiudi/export/scelta gateway) sono delegate → fuori da window
        const l3FnsOffWin = ['l3ExportCsv', '_closeL3Report', 'updateVlanGatewayNode'].every((n) => typeof window[n] === 'undefined');
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        const rt = { id: 'l3rt', type: 'router', name: 'GW', x: 0, y: 0, w: 60, h: 40, ip: '192.168.50.1', ports: 8 };
        state.nodes.push(rt); if (typeof _invalidateIdx === 'function') _invalidateIdx();
        state.vlanColors[50] = '#00d4ff'; state.vlanNames[50] = 'Test';
        state.ipam = state.ipam || { vlans: {} };
        state.ipam.vlans['50'] = { subnet: '192.168.50.0/24', gateway: '192.168.50.1' };  // → auto-match su rt.ip
        const ids = _l3GatewayNodeIds();                 // legge win.buildL3Report + win._parseCidrInfo via ponte
        const svi = _l3SviSectionHtml('l3rt');
        document.querySelector('[data-act="report-l3"]').click();   // overlay via event delegation
        const ov = document.getElementById('l3-overlay');
        const l3Wired = !!ov && !!ov.querySelector('[data-act="l3-close"]') && !!ov.querySelector('[data-act="l3-export"]');
        const res = {
          exposed,
          delegatedGone, l3FnsOffWin, l3Wired,
          isL3: ids.has('l3rt'),
          sviVlan: svi.indexOf('VLAN 50') >= 0,
          overlayVisible: !!ov && ov.style.display === 'flex',
          overlayHasVlan: !!ov && ov.textContent.indexOf('VLAN 50') >= 0,
        };
        // pulizia via CLICK REALE delegato (data-act="l3-close"): non coprire il rack ai test successivi
        const clBtn = ov && ov.querySelector('[data-act="l3-close"]');
        if (clBtn) clBtn.click();
        res.closedByClick = !!ov && ov.style.display === 'none';
        return res;
      });
      assert.ok(r.exposed, 'le funzioni L3 sono pubblicate su window dal bundle');
      assert.ok(r.delegatedGone, 'ASSE B: openL3Report ritirata dal ponte (voce "Mappa L3" del menu Report via data-act)');
      assert.ok(r.l3FnsOffWin, 'ASSE B: chiudi/export/gateway del report L3 ritirati da window (delegation)');
      assert.ok(r.l3Wired, 'report L3 cablato via data-act (close/export)');
      assert.ok(r.closedByClick, 'click delegato su "chiudi" (data-act="l3-close") nasconde l’overlay L3');
      assert.ok(r.isL3, '_l3GatewayNodeIds riconosce il router come gateway (auto per IP) via il ponte');
      assert.ok(r.sviVlan, '_l3SviSectionHtml elenca VLAN 50 nel pannello device');
      assert.ok(r.overlayVisible, 'la voce "Mappa L3" del menu Report (data-act) apre l’overlay');
      assert.ok(r.overlayHasVlan, 'l’overlay L3 rende la riga VLAN 50');
    });

    await t.test('app-drift-adopt migrato: candidati + creazione nodi + dedup nel browser reale', async () => {
      // Copertura spostata dallo smoke. Esercita anche il var-ify di _driftReport:
      // il modulo (bundle) legge win._driftReport che impostiamo qui dalla pagina.
      const r = await page.evaluate(() => {
        const exposed = typeof openAdoptModal === 'function' && typeof _adoptCandidates === 'function' &&
          typeof _adoptCreateNodes === 'function';
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        // drift report finto su window (var condivisa): due MAC non documentati
        _driftReport = { undocumented: [
          { key: 'dev:1', sig: '1', mac: 'AA:BB:CC:00:00:01', label: 'vista su Sw1 · Gi0/3', cls: 'infra', vlan: 10 },
          { key: 'dev:2', sig: '2', mac: '11:22:33:44:55:66', label: 'vista su Sw1 · Gi0/4', cls: 'endpoint', vlan: 20 },
        ], counts: { undocumented: 1, undocumentedEndpoint: 1 } };
        const cands = _adoptCandidates();                 // legge win._driftReport + win.buildAdoptCandidates
        openAdoptModal();                                 // costruisce overlay + tabella
        const ov = document.getElementById('adopt-overlay');
        const before = state.nodes.length;
        const res = _adoptCreateNodes([
          { cand: cands[0], type: 'switch' },
          { cand: cands[1], type: 'pc' },
        ], false);                                        // autoLink off (nessuna FDB nel test)
        const after = state.nodes.length;
        const res2 = _adoptCreateNodes([{ cand: cands[0], type: 'switch' }], false);  // dedup
        if (ov) ov.style.display = 'none';                // pulizia
        return {
          exposed, cands: cands.length, added: res.added, delta: after - before,
          dedup: res2.skipped, overlayRendered: !!ov && ov.querySelectorAll('.adopt-row').length === 2,
        };
      });
      assert.ok(r.exposed, 'le funzioni adopt sono pubblicate su window dal bundle');
      assert.equal(r.cands, 2, '_adoptCandidates legge win._driftReport (var-ify) → 2 candidati');
      assert.equal(r.added, 2, '_adoptCreateNodes aggiunge 2 nodi via il ponte');
      assert.equal(r.delta, 2, 'state.nodes cresce di 2');
      assert.equal(r.dedup, 1, 'dedup: il MAC già adottato viene saltato');
      assert.ok(r.overlayRendered, 'openAdoptModal rende 2 righe nella tabella');
    });

    await t.test('app-drift migrato: snapshot DOC + render pannello + azioni 1-click nel browser reale', async () => {
      // Copertura della glue Drift (ex lib/app-drift.js) nel bundle ESM. Esercita:
      //  • _driftBuildDocSnapshot (precedenza override statusOvr/vlanOvr);
      //  • _renderDriftReport che legge win._driftReport (var cross-boundary,
      //    scritta qui dalla pagina) e popola l'overlay;
      //  • driftIgnore (persistenza in state.driftIgnores + drop riga);
      //  • driftApplyDoc (allinea state.ports alla realtà, rimuove gli override);
      //  • _closeDriftReport (overlay nascosto → non copre i test rack seguenti).
      const r = await page.evaluate(() => {
        const exposed = ['runDriftCheck', '_driftBuildDocSnapshot', '_driftBuildSnmpSnapshot',
          '_renderDriftReport']
          .every((f) => typeof window[f] === 'function');
        // ASSE B: le 7 azioni 1-click del pannello Drift sono ritirate da window
        // (template dinamico → data-act/data-change, event delegation).
        const driftFnsOffWin = ['driftIgnore', 'driftApplyDoc', 'driftInvestigate', 'driftApplyIpChange',
          '_driftScanNetwork', '_closeDriftReport', 'setDriftShowEndpoints']
          .every((n) => typeof window[n] === 'undefined');
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        // Elementi PASSIVI senza IP (es. presa a muro) con un MAC stampato a valle
        // dal Sync NON sono verificabili → fuori dall'audit di presenza (doc.macs):
        // non rispondono a ping/SNMP/ARP, finirebbero sempre "assenti". Un device
        // ATTIVO con MAC invece c'è. (regressione: wall port marcata "assente".)
        state.nodes.push({ id: 'wp9', type: 'wallport', name: 'WP-9', x: 10, y: 10, ports: 1, mac: 'AA:BB:CC:DD:EE:01' });
        state.nodes.push({ id: 'pc9', type: 'pc', name: 'PC-9', x: 20, y: 20, ports: 1, mac: 'AA:BB:CC:DD:EE:02' });
        // DOC snapshot: un link con override su una porta → il diff engine deve
        // vedere i valori override, non i base.
        state.links = [{ id: 'lk1', src: 'sw1-1', dst: 'sw2-1' }];
        state.ports['sw1-1'] = { status: 'down', statusOvr: 'active', vlan: 1, vlanOvr: 99 };
        const doc = _driftBuildDocSnapshot();
        const _macSet = new Set((doc.macs || []).map((m) => String(m.mac).toUpperCase()));
        const wallportExcluded = !_macSet.has('AA:BB:CC:DD:EE:01');
        const activeMacIncluded = _macSet.has('AA:BB:CC:DD:EE:02');
        const snmp = _driftBuildSnmpSnapshot(doc);   // non deve lanciare (FDB vuota → {})
        // Report finto su window (var condivisa col modulo): una riga per categoria.
        _driftReport = {
          consistent: [],
          stateDrift: [{ key: 'sd:1', label: 'Sw1 / P1', patch: { pid: 'sw1-1', status: 'active', speed: 1000, vlan: 99 }, diffs: [{ field: 'status', doc: 'down', real: 'active' }] }],
          macOrphan: [{ key: 'mo:1', label: 'Vecchio PC', mac: 'AA:BB:CC:00:00:09' }],
          undocumented: [{ key: 'ud:1', mac: '11:22:33:44:55:66', label: 'vista su Sw1 · Gi0/4', cls: 'infra', vlan: 20 }],
          ghostCable: [{ key: 'gc:1', label: 'Sw1 ↔ Sw2', downStreak: 3 }],
          counts: { consistent: 0, stateDrift: 1, macOrphan: 1, undocumented: 1, undocumentedEndpoint: 0, ghostCable: 1 },
        };
        _renderDriftReport();
        const ov = document.getElementById('drift-overlay');
        const rowsRendered = ov ? ov.querySelectorAll('.drift-row').length : 0;
        // ignora il MAC orfano via CLICK REALE delegato (data-act="drift-ignore")
        // → esce dal report + finisce in state.driftIgnores
        const ignBtn = ov.querySelector('[data-act="drift-ignore"][data-key="mo:1"]');
        const ignWired = !!ignBtn && !ignBtn.hasAttribute('onclick');
        ignBtn.click();
        const ignored = Array.isArray(state.driftIgnores) && state.driftIgnores.includes('mo:1');
        const macOrphanLeft = _driftReport.macOrphan.length;
        // applica la doc via CLICK REALE delegato (data-act="drift-apply-doc")
        ov.querySelector('[data-act="drift-apply-doc"][data-key="sd:1"]').click();
        const applied = state.ports['sw1-1'] && state.ports['sw1-1'].status === 'active' && !('statusOvr' in state.ports['sw1-1']);
        const stateDriftLeft = _driftReport.stateDrift.length;
        // chiudi via CLICK REALE delegato (data-act="drift-close")
        ov.querySelector('[data-act="drift-close"]').click();
        const closed = !!ov && ov.style.display === 'none';
        return {
          exposed, driftFnsOffWin, ignWired,
          docStatus: doc.ports['sw1-1'] && doc.ports['sw1-1'].status,
          docVlan: doc.ports['sw1-1'] && doc.ports['sw1-1'].vlan,
          snmpOk: !!snmp && typeof snmp === 'object',
          rowsRendered, ignored, macOrphanLeft, applied, stateDriftLeft, closed,
          wallportExcluded, activeMacIncluded,
        };
      });
      assert.ok(r.exposed, 'le funzioni Drift NON-di-riga (runDriftCheck/snapshot/render) restano su window');
      assert.ok(r.driftFnsOffWin, 'ASSE B: le 7 azioni 1-click del Drift sono ritirate da window (data-act/data-change)');
      assert.ok(r.ignWired, 'il bottone "ignora" (dinamico) ha data-act="drift-ignore", nessun onclick inline');
      assert.equal(r.docStatus, 'active', '_driftBuildDocSnapshot usa statusOvr (override) sopra status base');
      assert.equal(r.docVlan, 99, '_driftBuildDocSnapshot usa vlanOvr (override) sopra vlan base');
      assert.ok(r.snmpOk, '_driftBuildSnmpSnapshot non lancia con FDB vuota');
      assert.ok(r.rowsRendered >= 4, `_renderDriftReport popola l'overlay (righe: ${r.rowsRendered})`);
      assert.ok(r.ignored, 'driftIgnore persiste la chiave in state.driftIgnores');
      assert.equal(r.macOrphanLeft, 0, 'driftIgnore rimuove la riga dal report');
      assert.ok(r.applied, 'driftApplyDoc scrive il valore reale e rimuove statusOvr');
      assert.equal(r.stateDriftLeft, 0, 'driftApplyDoc rimuove la riga applicata');
      assert.ok(r.closed, '_closeDriftReport nasconde l\'overlay (non copre i test rack)');
      assert.ok(r.wallportExcluded, 'elemento passivo senza IP (wall port) escluso da doc.macs (audit presenza)');
      assert.ok(r.activeMacIncluded, 'un device attivo con MAC resta in doc.macs');
    });

    await t.test('app-ports migrato: override porta + flusso LAG + stato cross-boundary su window', async () => {
      // Copertura della glue Ports (ex lib/app-ports.js) nel bundle ESM. Verifica
      // soprattutto i binding CROSS-BOUNDARY che solo il browser reale cattura:
      //  • lagSelMode/lagSelPorts (var-ificate in app.js) scritte dal bundle e
      //    bare-lette dai classic (app-render-core durante renderAll);
      //  • _focusedLagGroup/_focusedLagPorts spostate su window (init nel modulo,
      //    scritte dai classic non-strict, lette da _isLagFocusedPort nel render).
      const r = await page.evaluate(() => {
        const fns = ['renderPortsTable', 'setPortField', 'setPortSpeed', 'clearAllPortOverrides',
          'startLagMode', '_toggleLagPort', 'confirmLag', 'cancelLag', '_focusLagForPort',
          '_isLagFocusedPort', 'portTip'];
        const exposed = fns.every((f) => typeof window[f] === 'function');
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        const sw = nodeById('sw1');
        if (!sw || (sw.ports || 0) < 2) return { abort: 'sw1 senza ≥2 porte', ports: sw && sw.ports };
        const p1 = 'sw1-1', p2 = 'sw1-2';
        // 1) override stato + velocità su una porta, poi reset
        setPortField(p1, 'statusOvr', 'active');
        setPortSpeed(p1, '10G');
        const ovrSet = state.ports[p1] && state.ports[p1].statusOvr === 'active' && state.ports[p1].speedOvr === 10000;
        clearAllPortOverrides(p1);
        const ovrCleared = !state.ports[p1] || (state.ports[p1].statusOvr == null && state.ports[p1].speedOvr == null);
        // 2) flusso LAG: startLagMode scrive win.lagSelMode (var-ify in app.js) e
        //    renderAll (classic) lo legge senza crash → la var è davvero su window
        startLagMode(p1);
        const lagModeOn = window.lagSelMode === true && window.lagSelPorts.has(p1);
        _toggleLagPort(p2);
        const twoSelected = window.lagSelPorts.size === 2;
        confirmLag();
        const lagCreated = !!(state.ports[p1] && state.ports[p1].lagGroup) && window.lagSelMode === false;
        // 3) focus LAG: stato spostato su window, letto da _isLagFocusedPort (render)
        _focusLagForPort(p1);
        const focused = window._focusedLagPorts.has(p1) && _isLagFocusedPort(p1) === true;
        const tipHasLag = /LAG/.test(portTip(p1));
        // cleanup: azzera le flag UI su window per non sporcare i test rack seguenti
        window.lagSelMode = false; window.lagSelPorts = new Set();
        window._focusedLagGroup = null; window._focusedLagPorts = new Set();
        if (typeof selType !== 'undefined') { selType = null; selId = null; }
        return { exposed, ovrSet, ovrCleared, lagModeOn, twoSelected, lagCreated, focused, tipHasLag };
      });
      assert.ok(!r.abort, `precondizione fallita: ${r.abort} (ports=${r.ports})`);
      assert.ok(r.exposed, 'le funzioni Ports sono pubblicate su window dal bundle');
      assert.ok(r.ovrSet, 'setPortField/setPortSpeed scrivono gli override (statusOvr=active, speedOvr=10000)');
      assert.ok(r.ovrCleared, 'clearAllPortOverrides rimuove gli override');
      assert.ok(r.lagModeOn, 'startLagMode scrive win.lagSelMode=true (var-ify app.js) + ancora la porta');
      assert.ok(r.twoSelected, '_toggleLagPort aggiunge la seconda porta alla selezione');
      assert.ok(r.lagCreated, 'confirmLag crea il gruppo LAG e chiude la modalità');
      assert.ok(r.focused, '_focusLagForPort scrive win._focusedLagPorts, letto da _isLagFocusedPort');
      assert.ok(r.tipHasLag, 'portTip riporta il LAG nella porta in gruppo');
    });

    await t.test('REGRESSIONE (tenuta JSON): _migrateState non spezza i LAG rinumerando ID non-canonici', async () => {
      // Scoperto nello smoke test enterprise-500: caricando un progetto con node ID
      // NON canonici (es. "core1") + LAG in formato lag-<nodeId>-poN, la rinumerazione
      // (_normalizeProjectNodeIds) rimappava le CHIAVI di state.lagGroups ma NON i
      // riferimenti ports[].lagGroup (gestiva solo snmp-lag-*) → tutti i LAG orfani.
      // Fix: remapLagId applicata SIMMETRICAMENTE a chiavi mappa e riferimenti porta.
      const r = await page.evaluate(() => {
        const st = {
          nodes: [
            { id: 'core1', type: 'switch', name: 'CORE-1', ports: 8, rackId: 'r1', rackU: 1 },
            { id: 'dist1', type: 'switch', name: 'DIST-1', ports: 8, rackId: 'r1', rackU: 2 },
          ],
          links: [ { id: 'L1', src: 'core1-1', dst: 'dist1-1' }, { id: 'L2', src: 'core1-2', dst: 'dist1-2' } ],
          ports: {
            'core1-1': { lagGroup: 'lag-core1-po1', lagId: 1, status: 'active' },
            'core1-2': { lagGroup: 'lag-core1-po1', lagId: 1, status: 'active' },
            'dist1-1': { lagGroup: 'lag-dist1-po1', lagId: 1, status: 'active' },
            'dist1-2': { lagGroup: 'lag-dist1-po1', lagId: 1, status: 'active' },
          },
          lagGroups: { 'lag-core1-po1': 'Po1', 'lag-dist1-po1': 'Po1' },
          racks: [ { id: 'r1', name: 'R1', sizeU: 42 } ], currentRack: 'r1',
        };
        const m = _migrateState(JSON.parse(JSON.stringify(st)));
        // 1) ID canonicalizzati (core1/dist1 → sw*)
        const idsCanonical = m.nodes.every(n => /^sw\d+$/.test(n.id)) && !m.nodes.some(n => n.id === 'core1');
        // 2) TENUTA LAG: ogni ports[].lagGroup è una chiave presente in state.lagGroups
        const lagKeys = new Set(Object.keys(m.lagGroups));
        const refs = new Set();
        for (const p of Object.values(m.ports)) if (p && p.lagGroup) refs.add(p.lagGroup);
        const dangling = [...refs].filter(x => !lagKeys.has(x));
        const orphan = [...lagKeys].filter(k => !refs.has(k));
        // 3) idempotenza: un secondo migrate resta allineato
        const m2 = _migrateState(JSON.parse(JSON.stringify(m)));
        const keys2 = new Set(Object.keys(m2.lagGroups));
        const refs2 = new Set(); for (const p of Object.values(m2.ports)) if (p && p.lagGroup) refs2.add(p.lagGroup);
        const stillAligned = [...refs2].every(x => keys2.has(x)) && refs2.size === keys2.size;
        return { idsCanonical, lagKeys: lagKeys.size, refs: refs.size, dangling, orphan, stillAligned };
      });
      assert.ok(r.idsCanonical, 'gli ID non-canonici sono stati rinumerati (core1→sw*)');
      assert.equal(r.dangling.length, 0, 'nessun ports[].lagGroup dangling dopo la rinumerazione: ' + r.dangling.join(', '));
      assert.equal(r.orphan.length, 0, 'nessun LAG orfano (chiave senza porte) dopo la rinumerazione: ' + r.orphan.join(', '));
      assert.equal(r.refs, r.lagKeys, 'riferimenti LAG delle porte e chiavi mappa in corrispondenza 1:1');
      assert.ok(r.stillAligned, 'idempotenza: un secondo _migrateState non rispezza i LAG');
    });

    await t.test('rimuovere un LAG da Proprieta riporta porte E cavi allo stato normale (anche LAG da SNMP)', async () => {
      // Regressione: un LAG derivato dall'SNMP marca la porta con lagGroup='snmp-lag-…'
      // MA ANCHE con lagId (l'aggregatore). dissolveLag/removePortFromLag cancellavano
      // solo lagGroup → _portLagGid() ricavava di nuovo il gruppo da lagId>0 e la porta
      // restava viola/LAG a video; il cavo restava "bundle" (lagLogicalKey). Il fix
      // pulisce lagGroup+lagId+lagIfIndex sulle porte e i marcatori LAG sui cavi.
      const r = await page.evaluate(() => {
        const exposed = ['dissolveLag', 'removePortFromLag', '_portLagGid']
          .every((f) => typeof window[f] === 'function');
        const mkSnmpLag = (gid, lid, a, b) => {
          for (const pid of [a, b]) {
            state.ports[pid] = Object.assign(state.ports[pid] || {}, { lagGroup: gid, lagId: lid, lagIfIndex: lid });
          }
          state.lagGroups = state.lagGroups || {}; state.lagGroups[gid] = `Po${lid}`;
          state.links = state.links || [];
          state.links.push({ id: `l_test_${lid}`, src: a, dst: 'sw2-1',
            lagLogicalKey: 'L:test', lagMemberPair: `${a}|sw2-1`, lagMembers: [`${a}||sw2-1`] });
        };

        // --- Scenario A: dissolveLag (✕ sul gruppo nel pannello Proprieta) ---
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        const gidA = 'snmp-lag-sw1-3';
        mkSnmpLag(gidA, 3, 'sw1-1', 'sw1-2');
        const beforeA = _portLagGid('sw1-1') !== '';           // porta È in LAG prima
        dissolveLag(gidA);
        const linkA = state.links.find((l) => l.id === 'l_test_3') || {};
        const afterA = {
          gidEmpty: _portLagGid('sw1-1') === '' && _portLagGid('sw1-2') === '', // porte NORMALI
          noLagId: !state.ports['sw1-1'].lagId && !state.ports['sw1-2'].lagId,
          noGroup: !(state.lagGroups && state.lagGroups[gidA]),
          cableNormal: !linkA.lagLogicalKey && !linkA.lagMemberPair && !linkA.lagMembers,
        };

        // --- Scenario B: removePortFromLag su gruppo a 2 membri → collassa ---
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        const gidB = 'snmp-lag-sw1-4';
        mkSnmpLag(gidB, 4, 'sw1-1', 'sw1-2');
        removePortFromLag('sw1-1');
        const afterB = {
          gidEmpty: _portLagGid('sw1-1') === '' && _portLagGid('sw1-2') === '',
          groupGone: !(state.lagGroups && state.lagGroups[gidB]),
        };

        if (typeof selType !== 'undefined') { selType = null; selId = null; }
        return { exposed, beforeA, afterA, afterB };
      });
      assert.ok(r.exposed, 'dissolveLag/removePortFromLag/_portLagGid pubblicate su window');
      assert.ok(r.beforeA, 'precondizione: la porta risulta in LAG prima della rimozione');
      assert.ok(r.afterA.gidEmpty, 'dissolveLag: le porte NON risultano piu in LAG (_portLagGid vuoto) — no residuo lagId');
      assert.ok(r.afterA.noLagId, 'dissolveLag: lagId rimosso dalle porte del gruppo');
      assert.ok(r.afterA.noGroup, 'dissolveLag: il nome gruppo e rimosso da state.lagGroups');
      assert.ok(r.afterA.cableNormal, 'dissolveLag: il cavo torna normale (no lagLogicalKey/lagMemberPair/lagMembers)');
      assert.ok(r.afterB.gidEmpty, 'removePortFromLag: gruppo a 2 membri collassa → entrambe le porte tornano normali');
      assert.ok(r.afterB.groupGone, 'removePortFromLag: il gruppo collassato e rimosso da state.lagGroups');
    });

    await t.test('drag rack: il device segue il cursore (px→U usa --ru-h, non 24 hardcoded)', async () => {
      // Regressione: il drag convertiva px→U con /24 hardcoded mentre l'altezza
      // 1U (--ru-h) è 29px dopo il "rack in scala". Trascinando di k×ruH px il
      // device deve muoversi di ESATTAMENTE k unità (resta sotto il cursore).
      // Distanza scelta = 3×ruH: con il bug (/24) round(87/24)=4 ≠ 3 → fallirebbe.
      await page.evaluate(() => {
        // chiudi eventuali overlay aperti dai sotto-test precedenti (coprono il rack)
        ['audit-overlay', 'spare-overlay'].forEach((id) => { const o = document.getElementById(id); if (o) o.style.display = 'none'; });
        if (typeof selType !== 'undefined') { selType = null; selId = null; }
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        if (typeof switchRightTab === 'function') switchRightTab('rack'); // rende visibile il rack-viewport
        renderAll();
      });
      const dev = page.locator('.rack-device[data-id="sw1"]');
      await dev.waitFor({ timeout: 5000 });
      const env = await page.evaluate(() => ({ ruH: rackUPx(), zoom: state.rackView.zoom, before: nodeById('sw1').rackU }));
      assert.equal(env.ruH, 29, 'precondizione: --ru-h = 29px (rack in scala)');
      // rAF-throttle hardening (CI headless): durante un re-render in rAF Playwright
      // boundingBox() può tornare null un istante (nodo ricreato a metà paint) → box.x
      // su null. Leggo il rect dal page-scope SOLO quando il box è stabile (w/h>0).
      const box = await page.waitForFunction(() => {
        const el = document.querySelector('.rack-device[data-id="sw1"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return (r.width > 0 && r.height > 0) ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
      }, null, { timeout: 5000 }).then((h) => h.jsonValue());
      const gx = box.x + box.width - 8;          // bordo destro (targhetta), lontano dalle porte
      const gy = box.y + box.height / 2;
      const k = 3;
      await page.mouse.move(gx, gy);
      await page.mouse.down();
      await page.mouse.move(gx, gy + 10);        // supera la soglia 5px
      await page.mouse.move(gx, gy + k * env.ruH); // k unità in giù
      await page.mouse.up();
      const after = await page.evaluate(() => nodeById('sw1').rackU);
      assert.equal(env.before - after, k, `trascinando ${k}×ruH px il device scende di ${k}U (era ${env.before}, ora ${after})`);
    });

    await t.test('pan rack: niente scrollbar; drag su area vuota panna via translate, anche LATERALE a zoom alto', async () => {
      await page.evaluate(() => {
        ['audit-overlay', 'spare-overlay'].forEach((id) => { const o = document.getElementById(id); if (o) o.style.display = 'none'; });
        if (typeof selType !== 'undefined') { selType = null; selId = null; }
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        if (typeof switchRightTab === 'function') switchRightTab('rack');
        // zoom alto: lo zoom è transform:scale → il pan DEVE essere via translate
        // (lo scroll non muoverebbe il contenuto zoomato, specie lateralmente).
        state.rackView.zoom = 2.5; state.rackView.x = 0; state.rackView.y = 0;
        updateTransforms();
      });
      const vpLoc = page.locator('#rack-viewport');
      await vpLoc.waitFor({ timeout: 5000 });
      await page.waitForTimeout(200);
      const pre = await page.evaluate(() => {
        const rv = document.getElementById('rack-viewport');
        const cs = getComputedStyle(rv);
        return { overflow: cs.overflow, scrollbar: rv.offsetWidth - rv.clientWidth, rx: state.rackView.x || 0, ry: state.rackView.y || 0, swBefore: nodeById('sw1').rackU };
      });
      assert.equal(pre.overflow, 'hidden', 'il rack-viewport non ha più scrollbar (overflow hidden)');
      assert.equal(pre.scrollbar, 0, 'nessun gutter di scrollbar');
      const vp = await vpLoc.boundingBox();
      const sw1Before = await page.locator('.rack-device[data-id="sw1"]').boundingBox();
      // area VUOTA bassa, drag diagonale: +150 a destra, -80 in alto (il contenuto segue)
      const px = vp.x + vp.width * 0.5, py = vp.y + vp.height * 0.9;
      await page.mouse.move(px, py);
      await page.mouse.down();                 // PLAIN drag, senza Space
      await page.mouse.move(px + 70, py - 40);
      await page.mouse.move(px + 150, py - 80);
      await page.mouse.up();
      const res = await page.evaluate(() => ({ rx: state.rackView.x || 0, ry: state.rackView.y || 0, swAfter: nodeById('sw1').rackU, panning: isPanningRack }));
      const sw1After = await page.locator('.rack-device[data-id="sw1"]').boundingBox();
      assert.equal(res.rx - pre.rx, 150, 'pan LATERALE a zoom 2.5: il translate x segue il cursore (+150)');
      assert.equal(res.ry - pre.ry, -80, 'pan verticale a zoom 2.5: il translate y segue il cursore (-80)');
      assert.ok(Math.abs((sw1After.x - sw1Before.x) - 150) <= 2, 'il device si sposta a schermo col pan (laterale reale)');
      assert.equal(res.swAfter, pre.swBefore, 'il pan NON sposta il device nel rack (drag su area vuota ≠ drag su device)');
      assert.equal(res.panning, false, 'a pointerup il pan è terminato (isPanningRack=false)');
    });

    await t.test('Assistente AI (scheletro): 3ª tab + entry toolbar + shortcut «A» + scheda impostazioni + a11y', async () => {
      await page.evaluate(() => {
        ['audit-overlay', 'spare-overlay'].forEach((id) => { const o = document.getElementById(id); if (o) o.style.display = 'none'; });
        const um = document.getElementById('user-manager-overlay'); if (um) um.classList.remove('open');
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        if (typeof switchRightTab === 'function') switchRightTab('rack');
      });

      // 1) ASSE B — app-ai: openAssistant resta pubblicata (shortcut «A» + entry
      //    chiamano su window), ma le 6 superfici migrate a event delegation
      //    (data-act) sono USCITE da window e sono cablate nel DOM.
      const api = await page.evaluate(() => ({
        openAssistant: typeof openAssistant,
        gone: ['openAssistantOrSettings', 'openAiSettings', 'aiClearChat', 'aiSend', 'aiCfgSave', 'aiCfgPreview']
          .filter((n) => typeof window[n] !== 'undefined'),
        acts: ['assistant-open', 'ai-settings-open', 'ai-clear', 'ai-send', 'ai-cfg-save', 'ai-cfg-preview']
          .filter((k) => !!document.querySelector('[data-act="' + k + '"]')),
      }));
      assert.equal(api.openAssistant, 'function', 'openAssistant resta pubblicata (shortcut «A» / entry toolbar)');
      assert.deepEqual(api.gone, [], 'le 6 fn assistente migrate a data-act NON sono più su window: ' + api.gone.join(', '));
      assert.equal(api.acts.length, 6, 'i 6 bottoni assistente sono cablati con data-act: ' + api.acts.join(', '));

      // 2) switchRightTab('ai') attiva tab+pannello, nasconde il rack, aggiorna aria-selected
      const sw = await page.evaluate(() => {
        switchRightTab('ai');
        const tabAi = document.getElementById('tab-ai');
        const aw = document.getElementById('ai-panel-wrap');
        return {
          rightTab: typeof _rightTab !== 'undefined' ? _rightTab : null,
          tabActive: tabAi.classList.contains('active'),
          tabRole: tabAi.getAttribute('role'),
          tabAriaSel: tabAi.getAttribute('aria-selected'),
          panelActive: aw.classList.contains('active'),
          panelRole: aw.getAttribute('role'),
          rackHidden: document.getElementById('rack-viewport').style.display === 'none',
          propsAria: document.getElementById('tab-props').getAttribute('aria-selected'),
        };
      });
      assert.equal(sw.rightTab, 'ai', '_rightTab = ai');
      assert.ok(sw.tabActive, 'la tab Assistente è attiva');
      assert.equal(sw.tabRole, 'tab', 'role=tab sulla tab (a11y)');
      assert.equal(sw.tabAriaSel, 'true', 'aria-selected=true sulla tab attiva');
      assert.equal(sw.propsAria, 'false', 'aria-selected=false sulle altre tab');
      assert.ok(sw.panelActive, '#ai-panel-wrap è attivo');
      assert.equal(sw.panelRole, 'tabpanel', 'role=tabpanel sul pannello (a11y)');
      assert.ok(sw.rackHidden, 'il rack-viewport è nascosto con la tab AI attiva');

      // 3) Empty-state «non configurato» presente + i18n statica applicata (IT)
      const empty = await page.evaluate(() => {
        const p = document.getElementById('ai-panel');
        return {
          hasRobot: !!p.querySelector('.ai-empty-icon'),
          title: (p.querySelector('.ai-empty-title')?.textContent || '').trim(),
          hasConfigBtn: !!p.querySelector('button[data-act="ai-settings-open"]'),
          footer: (p.querySelector('.ai-foot')?.textContent || '').trim(),
        };
      });
      assert.ok(empty.hasRobot, 'icona robot nell\'empty-state');
      assert.ok(/non è ancora configurato/i.test(empty.title), 'titolo empty-state tradotto (IT): ' + empty.title);
      assert.ok(empty.hasConfigBtn, 'pulsante «Configura» (apre la scheda AI)');
      assert.ok(empty.footer.length > 10, 'footer advisory presente');

      // 4) openAssistant() da un'altra tab → porta alla tab AI
      const viaEntry = await page.evaluate(() => {
        switchRightTab('rack');
        openAssistant();
        return { rightTab: _rightTab, panelActive: document.getElementById('ai-panel-wrap').classList.contains('active') };
      });
      assert.equal(viaEntry.rightTab, 'ai', 'openAssistant() (entry toolbar) apre la tab AI');
      assert.ok(viaEntry.panelActive, 'openAssistant() attiva il pannello AI');

      // 5) shortcut tastiera «A» (gesto reale) → apre l'assistente
      await page.evaluate(() => {
        switchRightTab('rack');
        if (typeof selType !== 'undefined') { selType = null; selId = null; }
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      });
      await page.keyboard.press('a');
      await page.waitForTimeout(80);
      const viaKey = await page.evaluate(() => _rightTab);
      assert.equal(viaKey, 'ai', 'il tasto «A» apre la tab Assistente');

      // 6) scheda AI nel modale «Utenti e accessi» (umSwitchTab('ai')): _aiCfgLoad
      //    popola i campi via fetch (async) → aspetta che l'endpoint compaia.
      await page.evaluate(() => { if (typeof umSwitchTab === 'function') umSwitchTab('ai'); });
      await page.waitForFunction(() => {
        const el = document.getElementById('ai-cfg-endpoint');
        return !!(el && el.value && el.value.length > 0);
      }, null, { timeout: 5000 });
      const cfg = await page.evaluate(() => ({
        tabActive: document.getElementById('um-tab-ai').classList.contains('active'),
        paneActive: document.getElementById('um-pane-ai').classList.contains('active'),
        endpointDefault: (document.getElementById('ai-cfg-endpoint') || {}).value || '',
        keyType: (document.getElementById('ai-cfg-key') || {}).type || '',
      }));
      assert.ok(cfg.tabActive && cfg.paneActive, 'umSwitchTab("ai") attiva scheda + pane AI');
      assert.equal(cfg.endpointDefault, 'http://localhost:11434/v1', 'endpoint default = Ollama locale (privacy), caricato dal server');
      assert.equal(cfg.keyType, 'password', 'la chiave API è un campo password (write-only)');
    });

    await t.test('Assistente AI: salvare la config aggiorna SUBITO il pannello (empty-state→chat, senza cambiare tab)', async () => {
      // Parti da DISABILITATO → empty-state visibile, chat nascosta.
      await page.evaluate(async () => {
        await fetch('/api/ai/config', {
          method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        });
        if (typeof switchRightTab === 'function') switchRightTab('ai');   // _aiPanelOpen rilegge la config
      });
      await page.waitForFunction(() => {
        const e = document.getElementById('ai-empty');
        const c = document.getElementById('ai-chat');
        return !!(e && e.style.display !== 'none' && c && c.style.display === 'none');
      }, null, { timeout: 5000 });

      // Compila il form della scheda AI e SALVA (gesto = aiCfgSave) restando sulla tab Assistente.
      await page.evaluate(() => { if (typeof umSwitchTab === 'function') umSwitchTab('ai'); });
      await page.waitForFunction(() => {
        const el = document.getElementById('ai-cfg-endpoint');
        return !!(el && el.value && el.value.length > 0);
      }, null, { timeout: 5000 });
      await page.evaluate(() => {
        document.getElementById('ai-cfg-enabled').checked = true;
        document.getElementById('ai-cfg-endpoint').value = 'http://127.0.0.1:11434/v1';   // LAN → chip «Locale»
        // Salva via CLICK DELEGATO (data-act="ai-cfg-save") — prova end-to-end
        // dell'harness ASSE B: aiCfgSave non è più su window.
        document.getElementById('ai-cfg-save').click();
      });
      // SENZA cambiare tab: il pannello riflette subito enabled (chat) + endpoint (chip Locale).
      await page.waitForFunction(() => {
        const e = document.getElementById('ai-empty');
        const c = document.getElementById('ai-chat');
        const chip = document.getElementById('ai-chip-status');
        return !!(c && c.style.display !== 'none' && e && e.style.display === 'none' &&
                  chip && /Locale|Local/.test(chip.textContent || ''));
      }, null, { timeout: 5000 });
    });

    await t.test('Assistente AI L0: config round-trip (PUT→GET mascherato, chiave mai esposta) + preview sanitizzato', async () => {
      const r = await page.evaluate(async () => {
        const put = await fetch('/api/ai/config', {
          method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true, endpoint: 'https://api.example.com/v1', model: 'llama3.1', key: 'sk-LEAKTEST-123' }),
        });
        const putStatus = put.status;
        const getText = await (await fetch('/api/ai/config', { credentials: 'same-origin' })).text();
        const list = await (await fetch('/api/projects', { credentials: 'same-origin' })).json();
        const pid = Array.isArray(list) && list.length ? list[0].id : null;
        let previewText = '';
        if (pid != null) {
          const pv = await fetch('/api/ai/preview', {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: pid }),
          });
          previewText = await pv.text();
        }
        return { putStatus, getText, getJson: JSON.parse(getText), pid, previewText, preview: previewText ? JSON.parse(previewText) : null };
      });
      assert.equal(r.putStatus, 200, 'PUT config ok (sessione dev = admin)');
      assert.equal(r.getJson.enabled, true, 'enabled persistito sul server');
      assert.equal(r.getJson.model, 'llama3.1', 'model persistito');
      assert.equal(r.getJson.keySet, true, 'keySet=true dopo aver salvato una chiave');
      assert.ok(!('key' in r.getJson), 'la config restituita non contiene il campo key');
      assert.ok(!/sk-LEAKTEST-123/.test(r.getText), 'la CHIAVE non compare mai nella config restituita (paletto sicurezza)');
      assert.ok(r.pid != null, 'progetto corrente disponibile per il preview');
      assert.ok(r.preview && r.preview.context && r.preview.context.summary, 'il preview restituisce il contesto sanitizzato');
      assert.ok(!/sk-LEAKTEST-123/.test(r.previewText), 'la chiave non compare nel preview');
    });

    await t.test('Assistente AI: chat end-to-end con provider MOCK (config → invio → risposta + grounding nel contesto)', async () => {
      // Provider OpenAI-compatibile finto in-process: cattura la richiesta e
      // risponde con un contenuto canned → pipe deterministico, niente modello vero.
      let seen = null;
      const mock = http.createServer((req, res) => {
        let b = '';
        req.on('data', (c) => { b += c; });
        req.on('end', () => {
          seen = { url: req.url, body: b };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          // La risposta cita un IP INVENTATO (TEST-NET-3, mai in un progetto reale)
          // → chip ⚠ (anti-invenzione, L1) + un blocco ```yaml → card-bozza (L3).
          const content = 'RISPOSTA-MOCK: dal tuo inventario; nodo sconosciuto 203.0.113.250.\n\n```yaml\n- hosts: all\n  tasks:\n    - ansible.builtin.ping:\n```';
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
        });
      });
      await new Promise((r) => mock.listen(0, '127.0.0.1', r));
      const mockPort = mock.address().port;
      try {
        // Abilita + punta al mock (nessuna key → endpoint LAN = «Locale»).
        await page.evaluate(async (ep) => {
          await fetch('/api/ai/config', {
            method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true, endpoint: ep, model: 'mock', key: '' }),
          });
        }, `http://127.0.0.1:${mockPort}/v1`);

        // Aprendo la tab, _aiPanelOpen rilegge la config → mostra la chat.
        await page.evaluate(() => { if (typeof switchRightTab === 'function') switchRightTab('ai'); });
        await page.waitForFunction(() => {
          const c = document.getElementById('ai-chat');
          return !!(c && c.style.display !== 'none');
        }, null, { timeout: 5000 });

        // Semina un Drift VIVO nel runtime del browser (NON nel JSON): _aiCollectLiveFacts
        // deve allegarlo alla POST e il server ri-sanitizzarlo nel contesto (liveFacts L1).
        await page.evaluate(() => {
          window._driftReport = { undocumented: [{ key: 'dev:x', mac: 'de:ad:be:ef:00:01', label: 'mystery', vlan: 99 }] };
        });

        // Gesto reale: digita + clic Invia.
        await page.fill('#ai-input', 'Chi è sulla VLAN 20?');
        await page.click('#ai-send-btn');
        await page.waitForFunction(
          () => /RISPOSTA-MOCK/.test((document.getElementById('ai-messages') || {}).textContent || ''),
          null, { timeout: 8000 });

        const ui = await page.evaluate(() => {
          const g = document.querySelector('#ai-chat .ai-gear');
          return {
            msgs: document.getElementById('ai-messages').textContent || '',
            chip: (document.getElementById('ai-chip-status') || {}).textContent || '',
            gearVisible: !!(g && g.offsetParent !== null),   // ingranaggio impostazioni raggiungibile anche a chat aperta (admin)
            // copia per-messaggio (stile chat Claude): un'iconcina su input utente + output AI
            copyBtns: document.querySelectorAll('#ai-messages .ai-msg-copy').length,
          };
        });
        assert.match(ui.msgs, /Chi è sulla VLAN 20\?/, 'la domanda utente compare in chat');
        assert.match(ui.msgs, /RISPOSTA-MOCK/, 'la risposta del provider compare in chat');
        assert.match(ui.chip, /Locale|Local/, 'chip privacy «Locale» (endpoint LAN, niente key)');
        assert.ok(ui.gearVisible, 'l\'ingranaggio impostazioni resta accessibile nella testata della chat (admin)');
        assert.ok(ui.copyBtns >= 2, 'copia per-messaggio presente su domanda utente + risposta AI (stile Claude)');

        // Il provider ha ricevuto system-prompt (grounding) + contesto + turno utente.
        assert.ok(seen, 'il mock provider ha ricevuto la richiesta');
        assert.match(seen.url, /\/v1\/chat\/completions$/, 'POST a /chat/completions');
        const payload = JSON.parse(seen.body);
        assert.equal(payload.messages[0].role, 'system', 'primo messaggio = system');
        assert.match(payload.messages[0].content, /GROUNDING/, 'il system-prompt porta le regole di grounding');
        assert.match(payload.messages[0].content, /context:/, 'il contesto sanitizzato è incluso nel system');
        assert.equal(payload.messages[payload.messages.length - 1].content, 'Chi è sulla VLAN 20?', 'ultimo turno = domanda utente');
        assert.ok(!/SUPERSECRET|community/i.test(seen.body), 'nessun segreto nel payload verso il provider');
        // I liveFacts (Drift dal runtime browser) sono arrivati al provider via contesto.
        assert.match(seen.body, /de:ad:be:ef:00:01/, 'il Drift vivo (non-documentato) viaggia nel contesto sanitizzato');

        // Grounding: l'IP inventato 203.0.113.250 → chip ⚠ «riferimento non trovato».
        const grounding = await page.evaluate(() => {
          const chips = [...document.querySelectorAll('#ai-messages .ai-cite-chip')];
          const unknown = chips.find((c) => c.classList.contains('ai-cite-unknown'));
          return { unknownText: unknown ? unknown.textContent : null };
        });
        assert.ok(grounding.unknownText && /203\.0\.113\.250/.test(grounding.unknownText),
          'il controllo anti-invenzione marca l\'IP citato ma assente dai dati');

        // L3: il blocco ```yaml → card-bozza con banner «non applicata» + Copia.
        const draft = await page.evaluate(() => {
          const card = document.querySelector('#ai-messages .ai-draft');
          return {
            present: !!card,
            warn: !!(card && card.classList.contains('ai-draft-warn')),
            code: card ? (card.querySelector('.ai-draft-code') || {}).textContent || '' : '',
            hasCopy: !!(card && card.querySelector('.ai-draft-copy')),
          };
        });
        assert.ok(draft.present && draft.warn, 'la bozza Ansible è una card con banner «non applicata»');
        assert.ok(draft.hasCopy, 'la card-bozza ha il bottone Copia');
        assert.match(draft.code, /hosts: all/, 'il codice della bozza è preservato');

        // L4: aiExplain semina la domanda e la invia (loop «Spiega» dal Drift).
        const explainExposed = await page.evaluate(() => typeof aiExplainDrift === 'function');
        assert.ok(explainExposed, 'aiExplainDrift è esposto per il bottone «Spiega» del Drift');
        await page.evaluate(() => { if (typeof aiExplain === 'function') aiExplain('DOMANDA-L4'); });
        await page.waitForFunction(
          () => /DOMANDA-L4/.test((document.getElementById('ai-messages') || {}).textContent || ''),
          null, { timeout: 5000 });

        // Cestino «Pulisci chat»: compare a conversazione avviata → click → reset.
        const clearVisible = await page.evaluate(() => {
          const b = document.getElementById('ai-clear-btn');
          return !!(b && b.offsetParent !== null);
        });
        assert.ok(clearVisible, 'il cestino «Pulisci chat» compare a conversazione avviata');
        await page.click('#ai-clear-btn');
        // Reset = la risposta del provider (marcatore univoco, mai nel saluto/esempi)
        // sparisce e il cestino si ri-nasconde (conversazione vuota → torna il saluto).
        await page.waitForFunction(() => {
          const msgs = (document.getElementById('ai-messages') || {}).textContent || '';
          const b = document.getElementById('ai-clear-btn');
          return !/RISPOSTA-MOCK/.test(msgs) && !!(b && b.offsetParent === null);
        }, null, { timeout: 5000 });
      } finally {
        await new Promise((r) => mock.close(r));
      }
    });

    await t.test('Onboarding §4d: chip «prossimo passo» (empty-state) + spotlight sul bottone reale + passo che evolve', async () => {
      // L'onboarding deve guidare ANCHE prima di configurare un modello → forziamo
      // l'assistente DISABILITATO così è visibile l'empty-state (non la chat).
      await page.evaluate(async () => {
        await fetch('/api/ai/config', {
          method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false, endpoint: 'http://localhost:11434/v1', model: '', key: '' }),
        });
      });

      // Stato 1: rete VUOTA, nessuna Verifica → passo «Scopri».
      await page.evaluate(() => {
        state = _buildDefaultState(); if (typeof _migrateState === 'function') _migrateState(state);
        state.nodes = []; state.links = [];   // svuota i nodi demo → rete vuota davvero
        window._driftReport = null;
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        if (typeof switchRightTab === 'function') { switchRightTab('rack'); switchRightTab('ai'); }
      });
      await page.waitForFunction(() => {
        const e = document.getElementById('ai-empty');
        const chip = document.querySelector('#ai-empty .ai-nextstep');
        return !!(e && e.style.display !== 'none' && chip);
      }, null, { timeout: 5000 });

      const s1 = await page.evaluate(() => {
        const chip = document.querySelector('#ai-empty .ai-nextstep');
        const act = chip && chip.querySelector('.ai-nextstep-act');
        return { text: chip ? (chip.querySelector('.ai-nextstep-txt') || {}).textContent || '' : '', actText: act ? act.textContent : '' };
      });
      assert.match(s1.text, /Scopri|Discover/, 'rete vuota → passo «Scopri»: ' + s1.text);
      assert.ok(/Mostrami|Show me/.test(s1.actText), 'azione «Mostrami» (spotlight) presente: ' + s1.actText);

      // Click «Mostrami» (gesto reale) → illumina il bottone REALE #btn-discover.
      await page.click('#ai-empty .ai-nextstep-act');
      const lit = await page.evaluate(() => {
        const b = document.getElementById('btn-discover');
        return !!(b && b.classList.contains('coach-spotlight'));
      });
      assert.ok(lit, 'lo spotlight (coach-mark) illumina il bottone reale «Scopri»');

      // PERSISTENZA: il faro resta acceso (nessun auto-spegnimento a tempo)…
      await page.waitForTimeout(350);
      const persisted = await page.evaluate(() => document.getElementById('btn-discover').classList.contains('coach-spotlight'));
      assert.ok(persisted, 'il faro resta acceso finché non lo si clicca (niente timer)');
      // …e si spegne SOLO quando si clicca il bottone illuminato (neutralizzo
      // l'onclick reale per non aprire la discovery: testo solo lo spegnimento).
      const cleared = await page.evaluate(() => {
        const b = document.getElementById('btn-discover');
        b.onclick = null; b.click();
        return !b.classList.contains('coach-spotlight');
      });
      assert.ok(cleared, 'cliccando il bottone illuminato il faro si spegne');

      // Stato 2: device documentati ma SENZA Verifica → il passo evolve in «Verifica».
      await page.evaluate(() => {
        state.nodes.push({ id: 'ob1', type: 'switch', name: 'OB-SW', rackId: state.currentRack, rackU: 1, sizeU: 1, ip: '10.0.0.2', mac: '00:11:22:33:44:aa', integration: { driver: 'snmp' } });
        window._driftReport = null;
        if (typeof _invalidateIdx === 'function') _invalidateIdx();
        if (typeof switchRightTab === 'function') { switchRightTab('rack'); switchRightTab('ai'); }   // ri-render empty-state
      });
      await page.waitForFunction(() => {
        const chip = document.querySelector('#ai-empty .ai-nextstep .ai-nextstep-txt');
        return !!(chip && /Verifica|Verify/.test(chip.textContent || ''));
      }, null, { timeout: 5000 });
      const s2 = await page.evaluate(() => {
        const act = document.querySelector('#ai-empty .ai-nextstep .ai-nextstep-act');
        // simula il click → deve illuminare #btn-drift
        if (act) act.click();
        const b = document.getElementById('btn-drift');
        return { litDrift: !!(b && b.classList.contains('coach-spotlight')) };
      });
      assert.ok(s2.litDrift, 'con device non verificati lo spotlight punta a «Verifica» (#btn-drift)');

      // Dismiss «×»: chiude il chip per quel passo → sparisce.
      await page.evaluate(() => {
        const x = document.querySelector('#ai-empty .ai-nextstep .ai-nextstep-x');
        if (x) x.click();
      });
      const dismissed = await page.evaluate(() => !document.querySelector('#ai-empty .ai-nextstep'));
      assert.ok(dismissed, 'il chip si nasconde dopo «×» (dismiss per-passo)');
    });
  } finally {
    await browser.close();
    await srv.close();
  }
});
