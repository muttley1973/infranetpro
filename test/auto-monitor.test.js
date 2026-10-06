'use strict';
// Unit test della config PURA del «Monitoraggio automatico» unificato
// (lib/auto-monitor.js): schema nuovo, migrazione morbida dai legacy (auto-poll +
// Verifica automatica separati) e clamp dell'intervallo per profondità.
const test = require('node:test');
const assert = require('node:assert');
const { effAutoConfig, clampMonitorInterval, fmtMonitorInterval, createMonitorScheduler, MONITOR_INTERVALS } = require('../lib/auto-monitor.js');

test('effAutoConfig: schema nuovo rispettato (enabled/interval/depth)', () => {
  assert.deepEqual(effAutoConfig({ enabled: true, depth: 'light', interval: 5 }), { enabled: true, depth: 'light', interval: 5 });
  assert.deepEqual(effAutoConfig({ enabled: true, depth: 'full', interval: 60 }), { enabled: true, depth: 'full', interval: 60 });
  // disabilitato ma con profondità scelta: la conserva (spento ≠ perde la scelta)
  assert.deepEqual(effAutoConfig({ enabled: false, depth: 'full', interval: 360 }), { enabled: false, depth: 'full', interval: 360 });
});

test('effAutoConfig: migrazione dai legacy (nessun campo depth)', () => {
  // «Verifica automatica» con intervallo VALIDO nel set full → conservato
  assert.deepEqual(effAutoConfig({ autoVerify: true, verifyEvery: 360 }), { enabled: true, depth: 'full', interval: 360 });
  // vecchi 15/30m (non più nel set full) → clamp al floor sano (60 = 1h)
  assert.deepEqual(effAutoConfig({ autoVerify: true, verifyEvery: 30 }), { enabled: true, depth: 'full', interval: 60 });
  // verifyEvery mancante → default full (60)
  assert.deepEqual(effAutoConfig({ autoVerify: true }), { enabled: true, depth: 'full', interval: 60 });
  // vecchio auto-poll SNMP → profondità light al suo intervallo (10 valido)
  assert.deepEqual(effAutoConfig({ enabled: true, interval: 10 }), { enabled: true, depth: 'light', interval: 10 });
  // vecchio auto-poll a 1m (non più nel set light) → clamp a 5m
  assert.deepEqual(effAutoConfig({ enabled: true, interval: 1 }), { enabled: true, depth: 'light', interval: 5 });
  // entrambi i legacy attivi: vince full (la Verifica ingloba il poll)
  assert.deepEqual(effAutoConfig({ enabled: true, interval: 5, autoVerify: true, verifyEvery: 60 }), { enabled: true, depth: 'full', interval: 60 });
});

test('effAutoConfig: niente attivo → spento, default full/60', () => {
  assert.deepEqual(effAutoConfig({}), { enabled: false, depth: 'full', interval: 60 });
  assert.deepEqual(effAutoConfig(null), { enabled: false, depth: 'full', interval: 60 });
  assert.deepEqual(effAutoConfig({ enabled: false }), { enabled: false, depth: 'full', interval: 60 });
});

test('effAutoConfig: intervallo sporco nello schema nuovo viene clampato al set della profondità', () => {
  assert.deepEqual(effAutoConfig({ enabled: true, depth: 'full', interval: 7 }), { enabled: true, depth: 'full', interval: 60 });
  assert.deepEqual(effAutoConfig({ enabled: true, depth: 'light', interval: 999 }), { enabled: true, depth: 'light', interval: 5 });
});

test('clampMonitorInterval: fuori dal set → default della profondità', () => {
  assert.equal(clampMonitorInterval('light', 10), 10);    // light valido
  assert.equal(clampMonitorInterval('light', 1), 5);      // 1 non è più light → default light (5)
  assert.equal(clampMonitorInterval('light', 60), 5);     // 60 non è light → default light (5)
  assert.equal(clampMonitorInterval('full', 1440), 1440); // full valido (24h)
  assert.equal(clampMonitorInterval('full', 60), 60);     // full valido (1h)
  assert.equal(clampMonitorInterval('full', 30), 60);     // 30 non è più full → default full (60)
  assert.equal(clampMonitorInterval('full', 5), 60);      // 5 non è full → default full (60)
  assert.equal(clampMonitorInterval('boh', 60), 60);      // depth ignoto → trattato come full
});

test('MONITOR_INTERVALS: set attesi per profondità', () => {
  assert.deepEqual(MONITOR_INTERVALS.light, [5, 10, 15, 30]);
  assert.deepEqual(MONITOR_INTERVALS.full, [60, 360, 720, 1440]);
});

test('fmtMonitorInterval: minuti < 60 → "Nm"; multipli di 60 → "Nh"', () => {
  assert.equal(fmtMonitorInterval(5), '5m');
  assert.equal(fmtMonitorInterval(30), '30m');
  assert.equal(fmtMonitorInterval(60), '1h');
  assert.equal(fmtMonitorInterval(360), '6h');
  assert.equal(fmtMonitorInterval(720), '12h');
  assert.equal(fmtMonitorInterval(1440), '24h');
});

test('effAutoConfig è PURA: non muta l\'input', () => {
  const ap = { autoVerify: true, verifyEvery: 30 };
  const snapshot = JSON.stringify(ap);
  effAutoConfig(ap);
  assert.equal(JSON.stringify(ap), snapshot, 'effAutoConfig non deve toccare l\'oggetto passato');
});

// ── Scheduler: il giro che non può partire resta DOVUTO, e il badge non resta a «0s» ──
// Il difetto: alla scadenza con un Sync/Verifica in corso (o, allora, la scheda nascosta) il giro
// usciva PRIMA di riprogrammare. Il badge «Auto Nm» arrivava a 0s e ci restava fino alla
// scadenza successiva (un'ora, con la Verifica completa), e nessuno recuperava il giro
// nemmeno quando il campo si liberava. Si prova con un orologio finto: nessun timer vero.
function fakeClock() {
  let t = 0;
  const timers = new Set();
  return {
    now: () => t,
    setInterval: (fn, ms) => { const h = { fn, ms, at: t + ms }; timers.add(h); return h; },
    clearInterval: (h) => { timers.delete(h); },
    // Avanza l'orologio scattando i timer IN ORDINE; lascia girare le promise fra uno scatto e l'altro.
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let nxt = null;
        for (const h of timers) if (h.at <= end && (!nxt || h.at < nxt.at)) nxt = h;
        if (!nxt) break;
        t = nxt.at; nxt.at += nxt.ms;
        nxt.fn();                       // come un timer vero: il risultato non si aspetta
        await new Promise(r => setImmediate(r));
      }
      t = end;
      await new Promise(r => setImmediate(r));
    },
  };
}
const MIN = 60000;
function mkSched(over) {
  const clk = fakeClock();
  const env = { blocked: false, runs: 0, errors: 0, changes: 0, cfg: { enabled: true, interval: 5, depth: 'light' }, gate: null };
  const sched = createMonitorScheduler(Object.assign({
    getConfig: () => env.cfg,
    isBlocked: () => env.blocked,
    run: async () => { env.runs++; if (env.gate) await env.gate; if (env.fail) throw new Error('rete'); },
    onChange: () => { env.changes++; },
    onError: () => { env.errors++; },
    now: clk.now, setInterval: clk.setInterval, clearInterval: clk.clearInterval,
  }, over || {}));
  return { clk, env, sched };
}

test('scheduler: alla scadenza libera il giro parte e il prossimo è un intervallo dopo', async () => {
  const { clk, env, sched } = mkSched();
  sched.start();
  assert.equal(sched.nextAt(), 5 * MIN);
  await clk.advance(5 * MIN);
  assert.equal(env.runs, 1);
  assert.equal(sched.nextAt(), 10 * MIN);
  assert.equal(sched.isDue(), false);
});

test('scheduler: bloccato alla scadenza — il badge non resta nel passato e il giro è recuperato con resume()', async () => {
  const { clk, env, sched } = mkSched();
  sched.start();
  env.blocked = true;
  await clk.advance(5 * MIN + 1000);
  assert.equal(env.runs, 0, 'bloccato: il giro non parte');
  assert.equal(sched.isDue(), true, 'ma resta DOVUTO');
  assert.ok(sched.nextAt() > clk.now(), 'il prossimo appuntamento è nel FUTURO, non fermo a 0s');
  await clk.advance(2 * MIN);
  assert.equal(env.runs, 0, 'finché è bloccato non gira');
  env.blocked = false;
  await sched.resume();      // chi libera il campo può chiedere il recupero subito
  assert.equal(env.runs, 1, 'liberato: il giro dovuto parte SUBITO, senza aspettare un altro intervallo');
  assert.equal(sched.isDue(), false);
});

test('scheduler: bloccato da un\'altra operazione — il giro parte appena si libera (controllo ogni 30s), non alla scadenza dopo', async () => {
  const { clk, env, sched } = mkSched();
  sched.start();
  env.blocked = true;                     // un Sync/Verifica in corso quando scade
  await clk.advance(5 * MIN);
  assert.equal(env.runs, 0);
  assert.equal(sched.isDue(), true);
  env.blocked = false;
  await clk.advance(30000);               // un giro del controllo del badge
  assert.equal(env.runs, 1, 'recuperato entro 30s dalla liberazione');
});

test('scheduler: più scadenze mentre è fermo → UN solo giro di recupero (niente accumulo)', async () => {
  const { clk, env, sched } = mkSched();
  sched.start();
  env.blocked = true;
  await clk.advance(40 * MIN);            // otto scadenze perse
  assert.equal(env.runs, 0);
  env.blocked = false;
  await sched.resume();
  await clk.advance(1000);
  assert.equal(env.runs, 1);
});

test('scheduler: una scadenza durante il NOSTRO giro non ne accoda un secondo', async () => {
  let release;
  const { clk, env, sched } = mkSched();
  env.gate = new Promise(r => { release = r; });
  sched.start();
  await clk.advance(5 * MIN);             // il giro parte e resta in corso
  assert.equal(env.runs, 1);
  assert.equal(sched.isRunning(), true);
  await clk.advance(5 * MIN);             // scade di nuovo mentre ancora gira
  assert.equal(env.runs, 1, 'niente giro sovrapposto');
  release();
  await clk.advance(1000);
  assert.equal(env.runs, 1, 'e finito il primo non ne parte uno di recupero: il prossimo appuntamento è già fissato');
  assert.equal(sched.isRunning(), false);
});

test('scheduler: un giro fallito non ferma il monitoraggio', async () => {
  const { clk, env, sched } = mkSched();
  env.fail = true;
  sched.start();
  await clk.advance(5 * MIN);
  assert.equal(env.runs, 1);
  assert.equal(env.errors, 1);
  assert.equal(sched.isRunning(), false);
  env.fail = false;
  await clk.advance(5 * MIN);
  assert.equal(env.runs, 2, 'la scadenza dopo riparte');
});

test('scheduler: stop() azzera appuntamento e giro dovuto; disattivato a metà non gira', async () => {
  const { clk, env, sched } = mkSched();
  sched.start();
  env.blocked = true;
  await clk.advance(5 * MIN);
  assert.equal(sched.isDue(), true);
  sched.stop();
  assert.equal(sched.nextAt(), 0);
  assert.equal(sched.isDue(), false);
  env.blocked = false;
  await clk.advance(60 * MIN);
  assert.equal(env.runs, 0, 'fermo non gira, nemmeno il recupero');
  // disattivato (toggle) con un giro dovuto: lo scioglie senza eseguirlo
  const b = mkSched();
  b.sched.start(); b.env.blocked = true;
  await b.clk.advance(5 * MIN);
  b.env.cfg = { enabled: false, interval: 5, depth: 'light' };
  b.env.blocked = false;
  await b.sched.resume();
  assert.equal(b.env.runs, 0);
  assert.equal(b.sched.isDue(), false);
});

test('scheduler: config non attiva → start() non arma nulla', async () => {
  const { clk, env, sched } = mkSched();
  env.cfg = { enabled: false, interval: 5, depth: 'light' };
  sched.start();
  assert.equal(sched.nextAt(), 0);
  await clk.advance(60 * MIN);
  assert.equal(env.runs, 0);
});

// ── Scadenza lato client di UNA lettura SNMP (snmpReadBudgetMs) ──────────────
// Prima il client non aveva nessun tetto: una risposta che non tornava mai teneva
// `_snmpSyncing` acceso per sempre. Il budget deve stare SOPRA il caso peggiore del
// driver (altrimenti taglia un apparato lento ma vivo) e restare FINITO. Si legge dal
// corpo della richiesta: timeout + flag dei passaggi in più (stampante, HOST-RESOURCES).
const { snmpReadBudgetMs } = require('../lib/auto-monitor.js');

test('snmpReadBudgetMs: default (timeout 3 s, un passaggio) = 70 s — sopra il caso peggiore misurato sul lab (42 s)', () => {
  assert.equal(snmpReadBudgetMs({}), 70000);
  assert.equal(snmpReadBudgetMs(undefined), 70000);
  assert.ok(snmpReadBudgetMs({}) > 42000);
});

test('snmpReadBudgetMs: ogni passaggio in più (stampante, HOST-RESOURCES) ha il suo budget fresco, come nel driver', () => {
  const uno = snmpReadBudgetMs({ timeout: 3 });
  const due = snmpReadBudgetMs({ timeout: 3, hostResources: true });
  const stampante = snmpReadBudgetMs({ timeout: 3, printer: true });
  const tre = snmpReadBudgetMs({ timeout: 3, printer: true, hostResources: true });
  assert.equal(due - uno, 40000);
  assert.equal(stampante - uno, 40000);
  assert.equal(tre - uno, 80000);
});

test('snmpReadBudgetMs: chi alza il timeout per un apparato lento ma vivo non viene tagliato', () => {
  // il driver si concede max(25 s, 5×timeout) per passaggio: il client sempre di più
  for (const t of [1, 3, 5, 10, 30]) {
    const driverPass = Math.max(25, 5 * t) * 1000;
    assert.ok(snmpReadBudgetMs({ timeout: t }) > driverPass + 5 * t * 1000, `timeout ${t}`);
  }
  assert.equal(snmpReadBudgetMs({ timeout: 10 }), (50 + 50 + 30) * 1000);
});

test('snmpReadBudgetMs: valori sporchi → ripiego come il driver (parseInt || 3), mai zero né infinito', () => {
  for (const cfg of [{ timeout: 'abc' }, { timeout: 0 }, { timeout: -4 }, { timeout: null }, null]) {
    const ms = snmpReadBudgetMs(cfg);
    assert.ok(Number.isFinite(ms) && ms >= 60000 && ms < 400000, JSON.stringify(cfg));
  }
  assert.equal(snmpReadBudgetMs({ timeout: '10' }), snmpReadBudgetMs({ timeout: 10 }));   // stringa numerica, come arriva da un campo
});

// ── Scadenza lato client dello sweep di raggiungibilità (reachabilityBudgetMs) ──────────
// La risposta di /api/reachability sta DENTRO runDriftCheck: se non tornava mai restava acceso
// `_driftRunning` e il monitoraggio «Completo» non partiva più. Il budget scala con le ONDATE
// (REACHABILITY_BATCH IP alla volta) e deve stare sopra il caso peggiore del server.
const { reachabilityBudgetMs, REACHABILITY_BATCH, REACHABILITY_MAX_IPS } = require('../lib/auto-monitor.js');

test('reachabilityBudgetMs: una ondata = 38 s, e cresce di 8 s a ondata', () => {
  assert.equal(reachabilityBudgetMs(1), 38000);
  assert.equal(reachabilityBudgetMs(REACHABILITY_BATCH), 38000);          // ancora una ondata
  assert.equal(reachabilityBudgetMs(REACHABILITY_BATCH + 1), 46000);      // la seconda
  assert.equal(reachabilityBudgetMs(2 * REACHABILITY_BATCH), 46000);
  assert.equal(reachabilityBudgetMs(2 * REACHABILITY_BATCH + 1), 54000);
});

test('reachabilityBudgetMs: sta SEMPRE sopra il caso peggiore del server (13 s di ARP + 6,4 s a ondata) e sopra il lab (14 s)', () => {
  for (const n of [1, 18, 24, 25, 100, 500, 1024]) {
    const ondate = Math.ceil(n / REACHABILITY_BATCH);
    const peggiore = (13 + 6.4 * ondate) * 1000;
    assert.ok(reachabilityBudgetMs(n) >= peggiore + 15000, `${n} IP: ${reachabilityBudgetMs(n)} ms contro un peggiore di ${peggiore} ms`);
  }
  assert.ok(reachabilityBudgetMs(18) > 2.5 * 13800, 'il lab (18 IP, 11-14 s misurati) ha più del doppio e mezzo di margine');
});

test('reachabilityBudgetMs: oltre il tetto del server non cresce, e un valore sporco vale una ondata', () => {
  assert.equal(reachabilityBudgetMs(REACHABILITY_MAX_IPS), reachabilityBudgetMs(REACHABILITY_MAX_IPS + 5000));
  assert.equal(reachabilityBudgetMs(REACHABILITY_MAX_IPS), (30 + 8 * Math.ceil(REACHABILITY_MAX_IPS / REACHABILITY_BATCH)) * 1000);
  for (const v of [0, -3, NaN, undefined, null, 'abc']) assert.equal(reachabilityBudgetMs(v), 38000, String(v));
});

test('reachabilityBudgetMs: ondata e tetto li legge il SERVER da qui — una definizione sola', () => {
  // Se la rotta riscrive «24» e «1024» a mano, il budget del client smette di descriverla e
  // nessuno se ne accorge (con ondate più piccole servirebbero più secondi).
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server', 'routes', 'discovery.js'), 'utf8');
  assert.match(src, /require\('\.\.\/\.\.\/lib\/auto-monitor\.js'\)/, 'il server importa la lib');
  assert.match(src, /const CONC = REACHABILITY_BATCH;/, 'l\'ondata dello sweep è REACHABILITY_BATCH');
  assert.match(src, /max: REACHABILITY_MAX_IPS/, 'il tetto di IP dello sweep è REACHABILITY_MAX_IPS');
  assert.doesNotMatch(src, /const CONC = 24;/, 'niente 24 scritto a mano');
});
