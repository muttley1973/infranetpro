'use strict';
// ============================================================
// L'avvio del server E2E sopravvive a una porta soffiata sotto.
//
// `freePort()` ha una finestra TOCTOU incomprimibile: il kernel assegna la
// porta, la si RILASCIA per leggerne il numero, e solo dopo la si rioccupa col
// server. Nel mezzo chiunque può prendersela — e la porta arriva dall'intervallo
// EFFIMERO, lo stesso da cui il sistema serve ogni connessione in uscita.
//
// Misurato il 2026-08-21: due giri di e2e rossi mentre la macchina faceva
// traffico verso il lab (poll SNMP + traceroute), tre verdi a macchina ferma. Il
// fallimento NON somigliava a una collisione di porte: arrivava molto più a
// valle, come `ERR_CONNECTION_RESET` sulla prima navigazione, e sembrava un
// difetto dell'applicazione.
//
// La finestra non si chiude: si smette di considerare definitivo il primo
// tentativo. Questo test occupa DAVVERO la prima porta e pretende che l'avvio
// riesca lo stesso — senza spawnare un browser (niente Playwright qui).
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { startServer, freePort } = require('./e2e/helpers/server.js');

/**
 * Tiene occupata una porta finché non la si rilascia.
 * ⚠️ I socket accettati vanno DISTRUTTI alla chiusura: `server.close()` aspetta
 * che le connessioni in piedi finiscano, e questo finto server non risponde a
 * nessuno — chi lo sonda resta appeso, e con lui la chiusura. Senza questo il
 * test non fallisce: si pianta, che è peggio.
 */
function occupa(port) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    const vivi = new Set();
    srv.on('connection', (s) => { vivi.add(s); s.on('close', () => vivi.delete(s)); });
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve({
      close: () => new Promise((r) => {
        for (const s of vivi) { try { s.destroy(); } catch (_) { /* già chiuso */ } }
        srv.close(() => r());
      }),
    }));
  });
}

test('avvio E2E: la prima porta è già occupata → riprova su un\'altra e parte', async () => {
  const contesa = await freePort();
  const intruso = await occupa(contesa);          // la porta ora NON è libera
  let srv = null;
  try {
    let chiamate = 0;
    srv = await startServer({
      // primo giro: la porta contesa (il server non riuscirà a legarsi)
      // giri successivi: una porta vera
      _freePort: async () => (++chiamate === 1 ? contesa : freePort()),
    });
    assert.ok(chiamate >= 2, `la guardia non ha ritentato (chiamate=${chiamate})`);
    assert.match(srv.baseURL, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(!srv.baseURL.endsWith(':' + contesa), 'non deve essere ripartito sulla porta contesa');
    assert.equal(srv.morto(), null, 'il server appena avviato deve risultare vivo');
  } finally {
    if (srv) await srv.close();
    await intruso.close();
  }
});

test('avvio E2E: una porta IMPOSTA dal chiamante non viene ritentata (è una scelta)', async () => {
  const contesa = await freePort();
  const intruso = await occupa(contesa);
  try {
    await assert.rejects(
      () => startServer({ port: contesa }),
      (e) => /server/i.test(String(e && e.message)),
      'con una porta esplicita l\'errore deve emergere, non essere aggirato');
  } finally {
    await intruso.close();
  }
});

test('avvio E2E: `morto()` distingue un server vivo da uno caduto, e porta il suo output', async () => {
  const srv = await startServer();
  try {
    assert.equal(srv.morto(), null, 'vivo → nessun motivo');
    await new Promise((r) => { srv.proc.once('exit', r); srv.proc.kill(); });
    const motivo = srv.morto();
    assert.ok(motivo, 'caduto → deve dire che è caduto');
    assert.match(motivo, /USCITO/, 'il motivo deve dire cosa è successo, non solo che è successo');
  } finally {
    await srv.close();
  }
});
