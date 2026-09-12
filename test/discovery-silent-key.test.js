'use strict';
// ============================================================
//  test/discovery-silent-key.test.js — la catena INTERA di «muto a questa chiave».
//
//  Il motore (lib/snmp-silence.js) ha le sue prove; queste guardano che il fatto
//  ARRIVI A CHI LEGGE, che è la parte che si rompe in silenzio. È la lezione di
//  «una guardia un passo prima del consumatore»: il calcolo era corretto e verde,
//  e il lettore riceveva un trattino.
//
//  Tre anelli, uno per prova:
//   ① il server EMETTE l'annuncio insieme al miss (senza, il client ha solo un IP);
//   ② il client COSTRUISCE la riga invece di buttare l'evento;
//   ③ la tabella la MOSTRA — badge, parola giusta sulla presenza, e NON spuntata.
//
//  ⚠️ Prima del 12/09 l'anello ① c'era a metà e il ② non c'era affatto: un vicino
//  che LLDP dichiara e che non risponde alla nostra community spariva del tutto.
//  Non un verdetto sbagliato: un'assenza, che si legge come «non c'è».
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { crawlNetwork } = require('../server/crawl-bfs.js');
const { loadApp, run } = require('../tools/smoke-dom-stub.js');

const ROOT = path.join(__dirname, '..');

// ── ① Il server: il miss porta CHI l'ha annunciato ─────────────────────────
test('crawl: un vicino che non risponde emette un miss con l\'annuncio, non un IP nudo', async () => {
  const topo = {
    '10.0.0.1': {
      host: 'CORE-SW',
      neighbors: [{ remoteIP: '10.0.0.2', protocol: 'LLDP', localPort: 'Gi1/0/24', remoteDevice: 'SW-PIANO2' }],
    },
    // 10.0.0.2 esiste ed è annunciato, ma alla NOSTRA community non risponde.
  };
  const ev = [];
  await crawlNetwork({
    seeds: ['10.0.0.1'], maxDepth: 3, maxDevices: 50, pool: 1,
    probe: async (ip) => (topo[ip] ? { reachable: true, hostname: topo[ip].host } : { reachable: false, error: 'no response' }),
    pollNeighbors: async (ip) => ({ neighbors: (topo[ip] || {}).neighbors || [] }),
    decorate: (row) => ({ ...row }),
    emit: (e) => ev.push(e),
    isAborted: () => false,
  });
  const miss = ev.find(e => e.type === 'miss' && e.ip === '10.0.0.2');
  assert.ok(miss, 'il vicino muto deve comunque produrre un evento');
  assert.equal(miss.protocol, 'LLDP', 'con che protocollo è stato annunciato');
  assert.equal(miss.from, '10.0.0.1', 'e da CHI — senza questo il client ha solo un IP, e un IP non è una notizia');
  assert.equal(miss.port, 'Gi1/0/24', 'e su che porta lo vede');
  assert.equal(miss.name, 'SW-PIANO2', 'e con che nome lo chiama il vicino');
});

// ── ②③ Il client: la riga esiste, dice la parola giusta, e si vede ─────────
let APP;
test('load app (muto a questa chiave)', () => { APP = loadApp(ROOT); assert.ok(APP.ctx); });

test('il motore è caricato nella pagina: senza, il badge non uscirebbe e nessuno se ne accorgerebbe', () => {
  // ⚠️ Il badge è dietro un `typeof snmpSilence === 'function'`: se il tag <script>
  // sparisse da netmapper.html la tabella resterebbe VERDE e muta. La guardia sta
  // qui perché quella è esattamente la rottura che non fa rumore.
  const tipo = run(APP.ctx, 'typeof snmpSilence + "|" + typeof countSnmpSilent');
  assert.equal(tipo, 'function|function', 'lib/snmp-silence.js deve essere fra gli script di netmapper.html');
});

function render(righe, nodi) {
  return run(APP.ctx, `(() => {
    state = _buildDefaultState(); if(typeof _migrateState==='function') _migrateState(state);
    ${nodi ? `state.nodes = ${JSON.stringify(nodi)};` : ''}
    window._discTypeMap = {}; window._discSelMap = {};
    window._discResults = ${JSON.stringify(righe)};
    _discRenderTable();
    return document.getElementById('disc-tbody').innerHTML;
  })()`);
}

test('il vicino annunciato e muto: badge, «Annunciato» e NON pre-spuntato', () => {
  const html = render([{
    ip: '10.0.0.2', _via: 'lldp', viaProtocol: 'LLDP', viaFrom: '10.0.0.1', viaPort: 'Gi1/0/24',
    announcedName: 'SW-PIANO2', hostname: '', mac: '', vendor: '',
    snmpReachable: false, alive: false, snmpSilent: true,
  }]);
  assert.match(html, /snmp-silent/, 'il badge «muto a questa chiave» deve comparire');
  assert.match(html, /Annunciato/,
    'e la presenza si chiama «Annunciato», non «Inattivo»: chi lo annuncia lo sta vedendo su una porta adesso');
  assert.doesNotMatch(html, /Inattivo/,
    'un verdetto sulla PRESENZA ricavato dal silenzio a una CHIAVE è il difetto che stiamo chiudendo');
  assert.doesNotMatch(html, /class="disc-chk"[^>]*checked/,
    'presenza certa ma identità non misurata: si mostra, non si importa da solo');
});

test('chi ha risposto NON si prende il badge, e nemmeno un host qualunque senza SNMP', () => {
  const html = render([
    { ip: '10.0.0.3', _via: 'lldp', viaProtocol: 'LLDP', snmpReachable: true, alive: true, hostname: 'SW-OK' },
    { ip: '10.0.0.50', alive: true, mac: 'aa:bb:cc:dd:ee:ff', vendor: 'Acme', pingReachable: true },
  ]);
  assert.doesNotMatch(html, /snmp-silent/,
    'il badge su ogni host muto sarebbe rumore, e il rumore su un segnale lo cancella');
});

test('un apparato DOCUMENTATO come SNMP che smette di rispondere si prende il badge', () => {
  // È l'altra autorità: non l'ha annunciato un vicino, lo dice il DOCUMENTO.
  const html = render(
    [{ ip: '10.0.20.2', alive: true, pingReachable: true, snmpReachable: false, mac: 'aa:bb:cc:00:00:01' }],
    [{ id: 'n1', type: 'switch', name: 'SW-Core', ip: '10.0.20.2', mac: 'aa:bb:cc:00:00:01',
       integration: { driver: 'snmp-v2c', host: '10.0.20.2' } }],
  );
  assert.match(html, /snmp-silent/,
    'declare-first: che parli SNMP lo dice il progetto, quindi il suo silenzio è una notizia');
});

test('l\'evento miss è CABLATO a una riga: è l\'anello che prima non esisteva', () => {
  // ⚠️ Prova di CABLAGGIO, come quella qui sotto, e per lo stesso motivo: il
  // lettore SSE vive dentro `_runCrawlPhase`, che fa fetch e stream — dalla
  // harness non è raggiungibile senza esporlo al ponte (e il ponte è a ratchet,
  // non lo si allarga per una prova). Quello che questa guardia impedisce è la
  // regressione ESATTA che abbiamo appena chiuso: il ramo 'miss' che torna a non
  // esserci, e un vicino dichiarato che sparisce di nuovo senza lasciare traccia.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'src', 'app-discovery.js'), 'utf8');
  assert.match(src, /evt\.type==='miss'/, 'il ramo che raccoglie i miss deve esistere');
  assert.match(src, /evt\.type==='miss'[\s\S]{0,200}?evt\.protocol \|\| evt\.from/,
    'e deve pretendere un annuncio: un miss senza mittente è un seme che non ha risposto, non una notizia');
  assert.match(src, /evt\.type==='miss'[\s\S]{0,900}?_discSilentRow\(evt\)/,
    'e deve costruire la riga, non solo riconoscere l\'evento');
});

test('il conteggio in cima è CABLATO: è lui che fa rifare la scansione con l\'altra community', () => {
  // ⚠️ Questa è una prova di CABLAGGIO, non di resa, e lo dice invece di far finta:
  // `_discSummaryHtml` è locale al modulo (non esposta al ponte) e la sua uscita
  // non è raggiungibile dalla harness. Il CONTEGGIO in sé è provato sul motore
  // (test/snmp-silence.test.js); qui si prova che quel conteggio arrivi davvero
  // ai chip, perché un numero calcolato e non mostrato è un numero che non esiste.
  // Fallisce se qualcuno toglie la chiamata O il chip: servono tutt'e due.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'src', 'app-discovery.js'), 'utf8');
  const i = src.indexOf('function _discSummaryHtml');
  assert.ok(i > 0, 'il riassunto deve esistere');
  const corpo = src.slice(i, src.indexOf('\n}', i));
  assert.match(corpo, /countSnmpSilent\(/, 'il riassunto deve CONTARE i muti');
  assert.match(corpo, /\['silent',[^\]]*silent\]/,
    'e il conteggio deve finire nei chip: calcolato e non mostrato varrebbe zero');
});
