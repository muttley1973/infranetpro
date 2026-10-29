// ============================================================
// VM-PRESENCE — «questa VM si vede in rete?» (puro, UMD-lite)
// ============================================================
// Lo stato di una VM (acceso / spento) è un campo DICHIARATO: lo commuta una persona.
// Qui si calcola l'altra faccia, quello che la RETE dice adesso, con lo stesso
// vocabolario di prova dei nodi (lib/proof.js: proven · unverified · absent · stale)
// e lo si tiene ACCANTO al dichiarato, mai sopra. Nessuna stringa di UI: la lib
// calcola, la glue racconta.
//
// ⚠️ «Si vede in rete» NON è «è accesa», e le due metà non pesano uguale:
//   · se risponde (ping, TCP, ARP) o il suo MAC compare nelle tabelle di vicinato
//     (ARP/ND dei router, MAC-table degli switch) → è accesa. Prova forte.
//   · se tace → NON si sa: un firewall del guest, una VM sospesa o appena partita
//     tacciono allo stesso modo di una spenta. Il silenzio è «non verificata».
//   · l'unica assenza che vale è quella dei nodi (lib/drift-snapshot.js): l'IP sta sul
//     filo LOCALE del server e non risponde nemmeno all'ARP dopo il ping
//     (`reach[ip].absent`). Solo quella autorizza «non è più sulla rete locale».
//   Una VM spenta non è un'anomalia: per questo NON passa dai bucket rossi della
//   Verifica (macOrphan), che sono per ciò che dovrebbe esserci. Si riusano i SEGNALI
//   che la Verifica già raccoglie, non i suoi verdetti.
//
// La misura batte il ricordo (come nello snapshot dei nodi): le tabelle di vicinato
// dicono «l'ho visto passare», non «c'è adesso». Se la sweep ha appena provato assenti
// TUTTI gli IP della VM, un MAC rimasto nelle tabelle non la rimette in piedi.
//
// Chi scrive lo stato dichiarato? Una persona, sempre; oppure — solo se il progetto ha
// acceso «segui lo stato osservato» — la Verifica, e SOLO dove lo stato è vuoto o lo
// aveva scritto lei (`vm.stateAuto`): un campo commutato a mano non si tocca, la
// discrepanza si mostra (v. vmStateConflict).
//
// UMD-lite come le altre lib pure: in Node require(), nel bundle ESM via esbuild.
// ============================================================
(function (root, factory) {
  const api = factory(
    typeof module !== 'undefined' && module.exports ? require('./vm-nics.js') : root,
    typeof module !== 'undefined' && module.exports ? require('./mac-class.js') : root,
    typeof module !== 'undefined' && module.exports ? require('./proof.js') : root
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this, function (/** @type {any} */ vn, /** @type {any} */ mc, /** @type {any} */ proof) {
  'use strict';

  const _s = v => (v == null ? '' : String(v)).trim();
  // L'indirizzo scritto con la lunghezza del prefisso (`10.0.0.5/24`) è lo stesso indirizzo.
  const _bare = v => _s(v).replace(/\/\d{1,3}$/, '');
  const _isV4 = ip => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every(o => +o <= 255);

  /**
   * Con quale metodo la sweep ha visto un host. `via` è ciò che scrive POST /api/reachability:
   * `ping`, `arp`, `tcp:<porta>` (o `icmp` nei dati più vecchi). Una definizione sola: la usa anche
   * la Verifica per i nodi — prima `tcp:445` non combaciava con nessun metodo e un host visto su TCP
   * finiva registrato come «ping».
   * @param {any} via @returns {'ping'|'arp'|'tcp'|'snmp'|null}
   */
  function methodOfVia(via) {
    const v = _s(via).toLowerCase();
    if (v === 'icmp' || v === 'ping') return 'ping';
    if (v === 'arp' || v === 'snmp') return v;
    if (v === 'tcp' || v.indexOf('tcp:') === 0) return 'tcp';
    return null;
  }

  /**
   * Gli indirizzi con cui si può cercare una VM in rete: gli IPv4 e i MAC delle sue vNIC, già nella forma
   * canonica del progetto (il MAC come `macKey`). Un IPv6 non entra: la sweep è IPv4; l'ND dei router
   * arriva comunque, per MAC.
   * @param {any} vm @returns {{ips:string[], macs:string[]}}
   */
  function vmTargets(vm) {
    const ips = [];
    for (const e of vn.vmIps(vm)) { const ip = _bare(e.ip); if (_isV4(ip) && ips.indexOf(ip) < 0) ips.push(ip); }
    const macs = [];
    for (const m of vn.vmMacs(vm)) { const k = mc.macKey(m); if (k && macs.indexOf(k) < 0) macs.push(k); }
    return { ips, macs };
  }

  /**
   * Tutti gli IPv4 delle VM del progetto: vanno aggiunti agli indirizzi che la sweep della Verifica
   * interroga (prima partiva solo dai nodi, e una VM non veniva mai contattata).
   * @param {any[]} nodes @returns {string[]}
   */
  function vmSweepIps(nodes) {
    const out = new Set();
    for (const host of (Array.isArray(nodes) ? nodes : [])) {
      if (!host || !Array.isArray(host.vms)) continue;
      for (const vm of host.vms) { if (vm) for (const ip of vmTargets(vm).ips) out.add(ip); }
    }
    return [...out];
  }

  /**
   * Dai segnali di rete di QUESTO giro ai segnali di prova di una VM (lo stesso `sig` di
   * `deriveNodeProof`). Ordine delle prove:
   *   1. un suo IP ha risposto alla sweep → viva (misura);
   *   2. un suo MAC è nell'ARP vivo della sweep → viva (misura);
   *   3. un suo MAC è nelle tabelle di vicinato → viva (ricordo: vale SOLO se la sweep non ha provato assenti
   *      tutti i suoi IP);
   *   4. tutti i suoi IP provati assenti sul filo locale → assenza provata;
   *   5. interrogata o cercata e nulla → non verificata; mai interrogata → niente da dire.
   * @param {any} vm
   * @param {{reach?:Record<string,{alive?:boolean,via?:string,absent?:boolean}>|null, liveMacs?:Set<string>|null, neighborMacs?:Set<string>|null}} ctx
   *   `liveMacs`/`neighborMacs`: insiemi di `macKey`.
   */
  function presenceSignals(vm, ctx) {
    const c = ctx || {};
    const { ips, macs } = vmTargets(vm);
    const reach = (c.reach && typeof c.reach === 'object') ? c.reach : null;
    const live = c.liveMacs instanceof Set ? c.liveMacs : null;
    const neighbors = c.neighborMacs instanceof Set ? c.neighborMacs : null;

    const rows = reach ? ips.map(ip => reach[ip]).filter(Boolean) : [];
    const answered = rows.find(r => r.alive);
    if (answered) return { reachable: true, attempted: true, absentEvidence: false, method: methodOfVia(answered.via) };
    if (live && macs.some(m => live.has(m))) return { reachable: true, attempted: true, absentEvidence: false, method: 'arp' };

    // La sweep ha provato TUTTI i suoi indirizzi assenti? (uno solo non basta: la VM può avere un'altra scheda)
    const provenAbsent = ips.length > 0 && reach != null && ips.every(ip => reach[ip] && reach[ip].absent === true);
    if (!provenAbsent && neighbors && macs.some(m => neighbors.has(m))) {
      return { reachable: true, attempted: true, absentEvidence: false, method: 'arp' };
    }
    if (provenAbsent) return { reachable: false, attempted: true, absentEvidence: true, method: null };

    const looked = rows.length > 0 || (macs.length > 0 && ((live && live.size > 0) || (neighbors && neighbors.size > 0)));
    return { reachable: looked ? false : null, attempted: looked, absentEvidence: false, method: null };
  }

  /**
   * Lo stato di prova di una VM in questo giro. `fresh` dice se il giro ha davvero guardato la VM: se no,
   * `proof` è solo quello di prima che invecchia, e non va riletto come un'osservazione di adesso.
   * @param {any} vm  la VM (`vm.proof` è lo stato precedente)
   * @param {object} ctx  v. presenceSignals
   * @param {number} [now]
   * @returns {{proof:any, fresh:boolean}}
   */
  function evaluateVmPresence(vm, ctx, now) {
    const sig = presenceSignals(vm, ctx);
    const fresh = !!(sig.attempted || sig.reachable === true || sig.absentEvidence);
    return { proof: proof.deriveNodeProof(Object.assign({}, sig, { prev: vm && vm.proof }), now), fresh };
  }

  /**
   * Che stato di accensione dice la rete, se lo dice. Solo le due prove che reggono: «risponde» e «non è più
   * sul filo locale». Tutto il resto (silenzio, prova vecchia) non è un'osservazione.
   * @param {any} p una prova di `evaluateVmPresence` @returns {'running'|'stopped'|null}
   */
  function observedPowerState(p) {
    if (!p) return null;
    if (p.status === 'proven') return 'running';
    if (p.status === 'absent' && p.absentEvidence === true) return 'stopped';
    return null;
  }

  /**
   * La VM dichiara una cosa e la rete ne dice un'altra? Solo le due contraddizioni con una prova che regge, e solo se
   * la prova è fresca (una VM vista tre settimane fa non smentisce niente).
   * @param {any} vm @param {number} [now] @returns {'aliveButStopped'|'goneButRunning'|null}
   */
  function vmStateConflict(vm, now) {
    if (!vm || !vm.proof) return null;
    const seen = observedPowerState(vm.proof);
    if (!seen) return null;
    // «Fresca» si misura sul momento che regge l'osservazione: l'ultima volta che l'ho vista viva, oppure l'ultimo
    // controllo che l'ha trovata assente (una VM mai vista viva ha `lastProvenAt` vuoto, e non per questo è vecchia).
    const at = seen === 'running' ? vm.proof.lastProvenAt : vm.proof.lastCheckedAt;
    const t = Date.parse(_s(at));
    if (!Number.isFinite(t) || proof.freshness((now != null ? +now : Date.now()) - t) < 1) return null;
    if (seen === 'running' && vm.state === 'stopped') return 'aliveButStopped';
    if (seen === 'stopped' && vm.state === 'running') return 'goneButRunning';
    return null;
  }

  /**
   * Cosa raccontare della prova di una VM, senza dire più di quanto si sa: «si vede adesso» solo se l'osservazione è
   * fresca (entro la soglia di `lib/proof.js`), altrimenti «ultima volta in rete». Il testo è della glue.
   * @param {any} p `vm.proof` @param {number} [now]
   * @returns {{kind:'seen'|'silent'|'gone'|'last', at:string, last:string|null, via:string|null}|null}
   */
  function presenceView(p, now) {
    if (!p || typeof p !== 'object') return null;
    const t = now != null ? +now : Date.now();
    const fresh = at => { const ms = Date.parse(_s(at)); return Number.isFinite(ms) && proof.freshness(t - ms) >= 1; };
    const last = p.lastProvenAt || null;
    const lastOnly = last ? { kind: 'last', at: last, last: null, via: null } : null;
    if (p.status === 'proven') return fresh(last) ? { kind: 'seen', at: last, last: null, via: p.method || null } : lastOnly;
    if (p.status === 'absent' && p.absentEvidence === true) return fresh(p.lastCheckedAt) ? { kind: 'gone', at: p.lastCheckedAt, last, via: null } : lastOnly;
    if (p.status === 'unverified') return fresh(p.lastCheckedAt) ? { kind: 'silent', at: p.lastCheckedAt, last, via: null } : lastOnly;
    if (p.status === 'stale') return lastOnly;
    return null;
  }

  /**
   * Cosa scriverebbe «segui lo stato osservato» in `vm.state`, o null. Il dichiarato è legge: si scrive solo dove
   * lo stato è vuoto o lo aveva scritto la rete (`vm.stateAuto`); uno stato commutato da una persona resta suo.
   * @param {any} vm @param {'running'|'stopped'|null} seen @returns {'running'|'stopped'|null}
   */
  function followedState(vm, seen) {
    if (!vm || !seen) return null;
    const writable = !vm.state || vm.stateAuto === true;
    return writable && vm.state !== seen ? seen : null;
  }

  /**
   * Un giro di presenza su tutte le VM: aggiorna `vm.proof` e, se `opts.follow`, lo stato dichiarato dove è lecito.
   * Muta le VM (è l'unico punto che scrive). `opts.beforeStateWrite` parte UNA volta, prima della prima scrittura di
   * `vm.state`: è il momento della «foto prima» per l'annulla (v. undo-redo-convenzione-foto-prima).
   * @param {any[]} nodes
   * @param {object} ctx  v. presenceSignals
   * @param {{follow?:boolean, now?:number, beforeStateWrite?:()=>void}} [opts]
   * @returns {{checked:number, seen:number, changes:Array<{host:any, vm:any, from:string, to:string}>}}
   */
  function applyPresence(nodes, ctx, opts) {
    const o = opts || {};
    const out = { checked: 0, seen: 0, changes: [] };
    // Prima si CALCOLA tutto, poi si scrive: la «foto prima» dell'annulla deve precedere ogni modifica,
    // comprese le prove delle VM che vengono prima in elenco.
    const plan = [];
    for (const host of (Array.isArray(nodes) ? nodes : [])) {
      if (!host || !Array.isArray(host.vms)) continue;
      for (const vm of host.vms) {
        if (!vm || typeof vm !== 'object') continue;
        const r = evaluateVmPresence(vm, ctx, o.now);
        const seen = r.fresh ? observedPowerState(r.proof) : null;
        plan.push({ host, vm, r, seen, next: o.follow ? followedState(vm, seen) : null });
      }
    }
    if (plan.some(p => p.next) && typeof o.beforeStateWrite === 'function') o.beforeStateWrite();
    for (const p of plan) {
      // Una VM mai guardata e senza prova di prima non riceve un oggetto vuoto: sarebbe peso nel JSON senza dire niente.
      if (p.r.fresh || p.vm.proof) p.vm.proof = p.r.proof;
      if (!p.r.fresh) continue;
      out.checked++;
      if (p.seen === 'running') out.seen++;
      if (!p.next) continue;
      out.changes.push({ host: p.host, vm: p.vm, from: p.vm.state || '', to: p.next });
      p.vm.state = p.next;
      p.vm.stateAuto = true;
    }
    return out;
  }

  return {
    methodOfVia, vmTargets, vmSweepIps, presenceSignals, evaluateVmPresence,
    observedPowerState, vmStateConflict, presenceView, followedState, applyPresence,
  };
});
