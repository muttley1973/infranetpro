'use strict';
// ============================================================
// CRAWL BFS — orchestrazione della scoperta topologica LLDP/CDP, ESTRATTA dalla
// route SSE (server/routes/discovery.js) per essere TESTABILE (probe/pollNeighbors
// iniettati → zero rete nei test) e per poter parallelizzare la fase deep/neighbor.
//
// PERCHE' livello-sincrono (level-synchronized BFS):
//   La scansione BASE degli host resta fuori di qui (sequenziale/anti-IDS). Qui si
//   interrogano SOLO device gia' scoperti e autenticati (SNMP) → parallelizzarli non
//   e' una firma di scansione. Il polling di rete e' I/O-bound (attesa timeout SNMP),
//   quindi un piccolo pool sovrappone le attese senza caricare la CPU — adatto anche
//   a un Raspberry (footprint socket = `pool`). Best-practice: netdisco usa un worker
//   pool per macsuck/arpnip; noi lo teniamo BASSO (default 4) perche' i test sul lab
//   mostrano il ginocchio dei rendimenti a K≈4-6 e il pavimento = device piu' lento.
//
// DETERMINISMO (identita' output pool=1 vs pool=N):
//   La parallelizzazione riguarda SOLO il lavoro I/O (probe + pollNeighbors), eseguito
//   entro una BARRIERA per livello. Tutto lo stato ordine-dipendente (dedup per sysName
//   `seenName`, primo-scopritore `discoveredBy`, ordine di `results`) e' aggiornato DOPO
//   la barriera iterando la frontiera **ordinata per IP** → il risultato non dipende da
//   quale worker finisce prima. Cosi' pool=1 e pool=N danno output IDENTICO (testato).
//   (Nel vecchio BFS sequenziale il vincitore di un dedup dipendeva dall'ordine dei
//   vicini; ora e' l'IP piu' basso: comportamento *deterministico*, entrambi validi.)
// ============================================================

function _ipNum(ip) {
  const p = String(ip || '').split('.');
  if (p.length !== 4) return -1;
  let n = 0;
  for (const o of p) { const v = parseInt(o, 10); if (!(v >= 0 && v <= 255)) return -1; n = n * 256 + v; }
  return n;
}
// Ordina per valore numerico dell'IP (stabile, deterministico); IP non-IPv4 in coda.
function cmpIp(a, b) {
  const na = _ipNum(a), nb = _ipNum(b);
  if (na !== nb) return na - nb;
  return String(a).localeCompare(String(b));
}

// Esegue `fn` su `items` con al massimo `k` in volo. Preserva l'ordine di output.
async function runPool(items, k, fn) {
  const out = new Array(items.length);
  let i = 0;
  const conc = Math.max(1, Math.min(k | 0 || 1, items.length || 1));
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } }
  await Promise.all(Array.from({ length: conc }, worker));
  return out;
}

// IP di vicino non instradabile/non valido → non si accoda (come il BFS originale).
function _skipNeighborIp(nip) {
  if (!nip) return true;
  const oct = nip.split('.').map(Number);
  if (oct[0] === 0 || oct[0] === 127) return true;
  if (oct[0] === 169 && oct[1] === 254) return true;
  return false;
}

// crawlNetwork — BFS livello-sincrono. Dipendenze iniettate (nessuna rete qui dentro):
//   probe(ip)         -> { reachable, hostname, descr, objectId, sysServices, error? }
//   pollNeighbors(ip) -> { neighbors:[{remoteIP,protocol,localPort,remoteDevice}], arpTable, fdbTable }
//   decorate(row,via) -> device (mapping riga di scoperta; iniettato per non legare la lib alla route)
//   emit(evt)         -> void (eventi SSE; opzionale)
//   isAborted()       -> bool (interruzione client; opzionale)
// Ritorna { results, arpTables, fdbTables, visited }.
async function crawlNetwork(opts) {
  const {
    seeds = [], maxDepth = 5, maxDevices = 100, pool = 4, collectArp = false,
    probe, pollNeighbors, decorate,
    emit: rawEmit = () => {}, isAborted = () => false,
  } = opts || {};
  if (typeof probe !== 'function' || typeof pollNeighbors !== 'function' || typeof decorate !== 'function') {
    throw new Error('crawlNetwork: probe, pollNeighbors e decorate sono obbligatori');
  }
  // emit e' "opzionale" e best-effort: un handler che lancia (es. SSE res.write DOPO
  // che il client ha chiuso) NON deve rigettare il worker -> abortire tutto il crawl e
  // perdere i risultati parziali. Lo isoliamo qui una volta sola.
  const emit = (e) => { try { rawEmit(e); } catch (_) { /* best-effort */ } };

  const visited = new Set();
  const seenName = new Set();
  const discoveredBy = new Map();
  const results = [];
  const arpTables = [];
  const ndTables = [];
  const fdbTables = [];

  emit({ type: 'start', seeds });

  // Frontiera iniziale: i semi a profondita' 0 (dedup per IP, ordine deterministico).
  const seedSeen = new Set();
  let frontier = [];
  for (const ip of seeds) { const s = String(ip || '').trim(); if (s && !seedSeen.has(s)) { seedSeen.add(s); frontier.push({ ip: s, depth: 0 }); } }

  while (frontier.length && results.length < maxDevices && !isAborted()) {
    // Livello corrente: scarta i gia' visitati, DEDUP per IP (due genitori dello
    // STESSO livello possono accodare lo stesso vicino prima che venga marcato
    // visitato -> senza dedup verrebbe sondato due volte e, se sysName vuoto,
    // finirebbe due volte in results), ordina per IP (determinismo), e MARCA
    // visitato PRIMA di processare (evita ri-accodamenti cross-livello).
    const seenIp = new Set();
    const level = frontier.filter(f => {
      if (visited.has(f.ip) || seenIp.has(f.ip)) return false;
      seenIp.add(f.ip); return true;
    }).sort((a, b) => cmpIp(a.ip, b.ip));
    for (const f of level) visited.add(f.ip);
    frontier = [];
    if (!level.length) break;

    // --- Lavoro I/O in PARALLELO (pool bounded), entro barriera di livello ---
    const processed = await runPool(level, pool, async (f) => {
      if (isAborted()) return { f, aborted: true };
      if (f.depth > maxDepth) return { f, skip: 'maxDepth' };
      emit({ type: 'probing', ip: f.ip, depth: f.depth, found: results.length });
      let pr;
      try { pr = await probe(f.ip); } catch (e) { pr = { reachable: false, error: e && e.message }; }
      if (!pr || !pr.reachable) return { f, miss: (pr && pr.error) || 'no response' };
      let nb;
      try { nb = await pollNeighbors(f.ip); } catch (e) { nb = { error: (e && e.message) || 'poll error' }; }
      return { f, probe: pr, nb };
    });

    // --- Elaborazione DETERMINISTICA post-barriera, in ordine di livello (IP crescente) ---
    for (const p of processed) {
      if (!p || p.aborted || isAborted()) continue;
      if (results.length >= maxDevices) break;
      const f = p.f;
      if (p.skip) { emit({ type: 'skip', ip: f.ip, reason: p.skip }); continue; }
      if (p.miss) { emit({ type: 'miss', ip: f.ip, error: p.miss }); continue; }

      const pr = p.probe;
      const sysN = (pr.hostname || '').trim();
      if (sysN && seenName.has(sysN)) { emit({ type: 'dup', ip: f.ip, name: sysN }); continue; }
      if (sysN) seenName.add(sysN);

      const meta = discoveredBy.get(f.ip) || {};
      const via = { viaProtocol: meta.protocol || '', viaFrom: meta.from || '', viaPort: meta.port || '' };
      const device = decorate({
        ip: f.ip, hostname: pr.hostname, descr: pr.descr, objectId: pr.objectId, depth: f.depth,
        sysServices: parseInt(pr.sysServices || 0, 10) || 0,
        snmpReachable: true, alive: true, status: 'On', ...via,
      }, via);
      results.push(device);
      emit({ type: 'found', device, total: results.length });

      // Vicini → prossima frontiera. Ordine deterministico (per IP), dedup locale.
      const nb = p.nb;
      if (nb && !nb.error) {
        if (collectArp && nb.arpTable && typeof nb.arpTable === 'object') arpTables.push({ table: nb.arpTable, fromIp: f.ip });
        if (collectArp && nb.ndTable && typeof nb.ndTable === 'object') ndTables.push({ table: nb.ndTable, fromIp: f.ip });
        if (nb.fdbTable && typeof nb.fdbTable === 'object' && Object.keys(nb.fdbTable).length) {
          fdbTables.push({ switchIp: f.ip, switchName: sysN, fdbTable: nb.fdbTable });
        }
        const seenLocal = new Set();
        const neigh = (nb.neighbors || []).slice().sort((a, b) => cmpIp(a && a.remoteIP, b && b.remoteIP));
        for (const n of neigh) {
          const nip = (n.remoteIP || '').trim();
          if (!nip || seenLocal.has(nip) || visited.has(nip)) continue;
          seenLocal.add(nip);
          if (_skipNeighborIp(nip)) continue;
          frontier.push({ ip: nip, depth: f.depth + 1 });
          if (!discoveredBy.has(nip)) {
            discoveredBy.set(nip, { protocol: n.protocol || '', from: f.ip, port: n.localPort || '', name: n.remoteDevice || '' });
          }
          emit({ type: 'queued', from: f.ip, neighbor: nip, port: n.localPort, name: n.remoteDevice, protocol: n.protocol });
        }
      } else if (nb && nb.error) {
        emit({ type: 'warn', ip: f.ip, message: nb.error });
      }
    }
  }

  return { results, arpTables, ndTables, fdbTables, visited };
}

module.exports = { crawlNetwork, cmpIp, runPool, _ipNum, _skipNeighborIp };
