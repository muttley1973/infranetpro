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

/** Aspetta che il server risponda su /login (route pubblica) entro `timeoutMs`. */
async function waitReady(baseURL, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
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
 */
async function startServer(opts = {}) {
  const port = opts.port || (await freePort());
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

  try {
    await waitReady(baseURL, 20000);
  } catch (e) {
    proc.kill();
    throw new Error(`${e.message}\n--- server output ---\n${logs.join('')}`);
  }
  if (exited) {
    throw new Error(`server uscito subito (code=${exited.code})\n${logs.join('')}`);
  }

  return {
    baseURL,
    proc,
    logs,
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
