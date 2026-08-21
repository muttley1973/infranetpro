'use strict';
// ============================================================
// E2E helper — avvia un'istanza ISOLATA del server per i test headless.
//   • INFRANET_DEV_NO_AUTH=1  → la UI è raggiungibile senza login (sessione
//     admin fittizia iniettata da auth.js: vedi requireAuth).
//   • INFRANET_PROJECTS_DIR / INFRANET_SKINS_DIR → store su dir temporanea,
//     così l'E2E non tocca i progetti/skin reali dell'utente.
//   • PORT effimera → niente collisione con un dev server già attivo (8421).
// Nessuna dipendenza esterna: spawn di `node server.js` + polling HTTP.
// ============================================================
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..', '..');

/** Trova una porta TCP libera su 127.0.0.1 (effimera assegnata dal kernel). */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** GET su un URL → risolve con lo status code (qualsiasi risposta = server su). */
function httpStatus(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('timeout')));
  });
}

/**
 * Aspetta che il server risponda su /login (route pubblica) entro `timeoutMs`.
 * ⚠️ `morto()` è la via d'uscita ANTICIPATA: un processo che è già uscito (porta
 * occupata → EADDRINUSE) non diventerà pronto, e continuare a interrogarlo per
 * venti secondi non lo cambia — sposta solo di venti secondi il momento in cui
 * si scopre. Con tre tentativi era un minuto prima di dire cosa era successo.
 */
async function waitReady(baseURL, timeoutMs, morto) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (typeof morto === 'function' && morto()) {
      throw new Error(`server uscito prima di essere pronto su ${baseURL}`);
    }
    try {
      await httpStatus(baseURL + '/login');
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error(`server non pronto su ${baseURL} entro ${timeoutMs}ms`);
}

/**
 * Avvia il server isolato. Ritorna { baseURL, close() }.
 * close() termina il processo e rimuove la dir temporanea dello store.
 *
 * ⚠️ `freePort()` ha una finestra TOCTOU incomprimibile: il kernel assegna la
 * porta, la si RILASCIA per leggerne il numero, e solo dopo la si rioccupa col
 * server. Nel mezzo chiunque può prendersela — e la porta viene pescata
 * dall'intervallo EFFIMERO, lo stesso da cui il sistema serve ogni connessione
 * in uscita. Su una macchina che sta facendo traffico (misurato: poll SNMP +
 * traceroute verso un lab, decine di socket al secondo) la finestra si apre
 * davvero, e il fallimento non somiglia a una collisione: il server non parte o
 * muore, e il test muore molto più a valle con un ERR_CONNECTION_RESET che
 * sembra un difetto dell'app. Non si può chiudere la finestra, si può solo
 * NON considerare definitivo il primo tentativo: si ripesca una porta e si
 * riprova. Stessa famiglia della race su `boundingBox` (2.10.0).
 * Una porta IMPOSTA dal chiamante non si ritenta: è una scelta, non un caso.
 */
async function startServer(opts = {}) {
  if (opts.port) return _startOnce(opts, opts.port);
  const prove = Number.isFinite(opts.retries) ? opts.retries : 2;
  // Seam per il test della guardia: serve a far fallire il PRIMO tentativo in
  // modo deterministico (una porta già occupata), che è l'unico modo di provare
  // che il ritentativo esiste davvero. In produzione è sempre `freePort`.
  const pescaPorta = opts._freePort || freePort;
  let ultimo = null;
  for (let i = 0; i <= prove; i++) {
    try {
      return await _startOnce(opts, await pescaPorta());
    } catch (e) {
      ultimo = e;
      // La porta successiva la ripesca il giro dopo: insistere sulla stessa
      // sarebbe insistere sull'unica che sappiamo essere contesa.
    }
  }
  throw new Error(`server non avviato dopo ${prove + 1} tentativi su porte diverse.\n${ultimo && ultimo.message}`,
    { cause: ultimo });
}

async function _startOnce(opts, port) {
  const baseURL = `http://127.0.0.1:${port}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infranet-e2e-'));
  const projectsDir = path.join(tmpDir, 'projects');
  const skinsDir = path.join(tmpDir, 'skins');
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.mkdirSync(skinsDir, { recursive: true });

  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      INFRANET_DEV_NO_AUTH: '1',
      INFRANET_PROJECTS_DIR: projectsDir,
      INFRANET_SKINS_DIR: skinsDir,
      // Config Assistente AI su file temporaneo: l'E2E può fare PUT senza toccare
      // (né committare) il data/ai-config.json reale. La chiave eventuale resta qui.
      INFRANET_AI_CONFIG_FILE: path.join(tmpDir, 'ai-config.json'),
      INFRANET_DCIM_CONFIG_FILE: path.join(tmpDir, 'dcim-config.json'),
      // Store token API + utenti su file temporanei: un test che conia/revoca token
      // o crea utenti NON deve scrivere l'api-tokens.json / users.json reale (stessa
      // isolazione hermetica degli altri store).
      INFRANET_API_TOKENS_FILE: path.join(tmpDir, 'api-tokens.json'),
      INFRANET_USERS_FILE: path.join(tmpDir, 'users.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  proc.stdout.on('data', (d) => logs.push(d.toString()));
  proc.stderr.on('data', (d) => logs.push(d.toString()));

  let exited = null;
  proc.on('exit', (code, sig) => { exited = { code, sig }; });

  const pulisci = () => {
    try { proc.kill(); } catch (_) { /* già morto */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  };

  try {
    await waitReady(baseURL, 20000, () => exited || proc.exitCode != null);
  } catch (e) {
    pulisci();
    throw new Error(`${e.message}\n--- server output ---\n${logs.join('')}`);
  }
  if (exited) {
    pulisci();
    throw new Error(`server uscito subito (code=${exited.code})\n${logs.join('')}`);
  }
  // Secondo controllo DOPO waitReady: fra la risposta a /login e il ritorno di
  // questa funzione il processo può essere morto (porta soffiata sotto, crash
  // all'avvio tardivo). Costa nulla e toglie un pezzo alla finestra.
  if (proc.exitCode != null) {
    pulisci();
    throw new Error(`server morto subito dopo essere stato pronto (code=${proc.exitCode})\n${logs.join('')}`);
  }

  return {
    baseURL,
    proc,
    logs,
    /**
     * null se il server è ancora vivo; altrimenti il MOTIVO, col suo output.
     * Serve a chi fallisce PIÙ TARDI (una navigazione che si becca un
     * ERR_CONNECTION_RESET) per dire se il server è caduto invece di lasciare
     * l'errore del browser a raccontare la cosa sbagliata.
     */
    morto() {
      if (!exited && proc.exitCode == null) return null;
      const c = exited ? exited.code : proc.exitCode;
      return `il server di prova è USCITO (code=${c}) — non è un difetto dell'app.\n`
           + `--- server output ---\n${logs.join('')}`;
    },
    async close() {
      await new Promise((resolve) => {
        if (proc.exitCode != null || exited) return resolve();
        proc.once('exit', () => resolve());
        proc.kill();
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} resolve(); }, 3000);
      });
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    },
  };
}

module.exports = { startServer, freePort };
