// ============================================================
// HW CAPABILITIES — capacità hardware DOCUMENTATE (report puro)
// ============================================================
// «InfraNet calcola, l'AI racconta»: questo motore PRE-CALCOLA le capacità di
// ciascun device dai dati GIÀ documentati/osservati (mai stimati a caso), così
// l'assistente le riporta senza inventare numeri (paletto #2). I campi-capacità
// vivono in `node.spec.*` (catalogo in src/app-types.js → NODE_SPEC_FIELDS):
//   switch  → swPoeBudgetW            UPS/PDU/ATS → upsVa/upsW/upsAutonomyMin, …
//   server  → srvCpu/srvRamGb/…       hypervisor  → hvCpuSockets/hvCores/hvRamGb/…
//   nas     → nasCapacityTb/nasRaid   firewall    → fwThroughputMbps
//   wlanctrl→ apManaged/apCapacity    AP          → radios[] (PHY + SSID)
// Le PORTE (libere / mix velocità / banda LAG aggregata) arrivano dal chiamante
// già risolte. **Regola d'oro**: un campo assente → sotto-blocco OMESSO (così l'AI
// risponde «non documentato»), MAI un valore inventato.
//
// Allowlist per costruzione: leggiamo SOLO chiavi note → qualunque chiave segreta
// (community/apiKey/…) eventualmente finita nello spec è strutturalmente esclusa.
//
// PoE headroom = caso PEGGIORE TEORICO per classe (decisione prodotto): assorbimento
// = Σ del nominale massimo di classe delle porte PoE attive (802.3af/at/bt), non una
// misura. I nomi-campo (`worstCaseW`) lo rendono esplicito.
//
// Funzioni PURE (zero IO/DOM). Condiviso browser + test (UMD-lite), come ipam.js.
//
// INPUT computeDeviceCapabilities(model):
//   model = {
//     type,        // node.type (es. 'switch','ups','server','ap',…)
//     spec,        // node.spec (oggetto) — campi-capacità documentati
//     radios,      // node.radios[] (AP) — PHY + ssids[]
//     vmsCount,    // n. VM ospitate (host)
//     ports,       // { total, used, free, list:[{speed,status,lagGroup,poe}] } o undefined
//     lagNames,    // state.lagGroups: key→'Port-channelN'
//     lagModes,    // state.lagModes: key→'active'|'passive'|'static' (LACP), opz.
//   }
// OUTPUT: oggetto capacità (solo sotto-blocchi presenti) o undefined.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Nominale massimo per classe PoE (W). af=Type1, at=Type2(PoE+), bt=Type3(PoE++)
  // conservativo a 60W (Type4=90W non distinguibile dalla sola classe). Costante,
  // non un dato di rete: usata SOLO per il "caso peggiore teorico".
  const POE_CLASS_W = { '802.3af': 15.4, '802.3at': 30, '802.3bt': 60 };
  const POE_CLASS_KEY = { '802.3af': 'af', '802.3at': 'at', '802.3bt': 'bt' };

  // Lettura spec difensiva: preferisce node.spec.k, ripiega su node.k (alcuni JSON
  // vecchi non sono ancora "compattati" sotto spec). Come lib/stack.js / ha-pair.js.
  function _val(spec, node, key) {
    if (spec && spec[key] != null) return spec[key];
    if (node && node[key] != null) return node[key];
    return null;
  }
  function _num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function _posNum(v) { const n = _num(v); return (n != null && n > 0) ? n : null; }
  function _str(v) { const t = (v == null ? '' : String(v)).trim(); return t ? t.slice(0, 64) : null; }
  function _round1(n) { return Math.round(n * 10) / 10; }

  function _compact(obj) {
    const out = {};
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v === null || v === undefined || v === '') continue;
      if (Array.isArray(v) && !v.length) continue;
      if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) continue;
      out[k] = v;
    }
    return out;
  }

  // ── velocità → Mbps. Accetta numero (Mbps) o stringa '1G'/'10G'/'100M'/'1000'. ──
  function _speedToMbps(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
    const s = String(v).trim().toLowerCase();
    const m = s.match(/^(\d+(?:\.\d+)?)\s*(g|m|gbps|mbps)?$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    const unit = m[2] || '';
    if (unit === 'g' || unit === 'gbps') return Math.round(n * 1000);
    return Math.round(n);              // m/mbps o nudo → già Mbps
  }
  // Mbps → etichetta leggibile ('1G','10G','100M','25G',…) per il mix velocità.
  function _speedLabel(mbps) {
    if (mbps == null) return null;
    // 2.5G/5G (IEEE 802.3bz NBASE-T) NON sono multipli netti di 1000: 2500 → '2.5G'
    // (non '2500M'). 5000/25000/40000 restano interi. Sotto i 1000 Mbps → 'M'.
    if (mbps >= 1000) return (mbps % 1000 === 0 ? (mbps / 1000) : (mbps / 1000).toFixed(1).replace(/\.0$/, '')) + 'G';
    return mbps + 'M';
  }

  // ── PoE (switch): budget documentato vs caso peggiore teorico per classe ──────
  function _poe(spec, node, ports) {
    const budgetW = _posNum(_val(spec, node, 'swPoeBudgetW'));
    if (budgetW == null) return null;                 // niente budget → niente blocco
    const byClass = { af: 0, at: 0, bt: 0 };
    let poePorts = 0, worstCaseW = 0;
    const list = (ports && Array.isArray(ports.list)) ? ports.list : [];
    for (const p of list) {
      const std = p && p.poe ? String(p.poe) : '';
      if (!(std in POE_CLASS_W)) continue;
      poePorts++;
      byClass[POE_CLASS_KEY[std]]++;
      worstCaseW += POE_CLASS_W[std];
    }
    const out = { budgetW, poePorts };
    if (poePorts) {
      out.byClass = _compact(byClass);
      out.worstCaseW = _round1(worstCaseW);
      out.headroomW = _round1(budgetW - worstCaseW);  // <0 = sovra-sottoscritto (informativo)
    }
    return out;
  }

  // ── Alimentazione (UPS/PDU/ATS): VA/W/autonomia + amperaggio/uscite ───────────
  function _power(type, spec, node) {
    const o = {};
    if (type === 'ups') {
      o.va = _posNum(_val(spec, node, 'upsVa'));
      o.w = _posNum(_val(spec, node, 'upsW'));
      o.autonomyMin = _posNum(_val(spec, node, 'upsAutonomyMin'));
      o.topology = _str(_val(spec, node, 'upsTopology'));
    } else if (type === 'pdu') {
      o.phase = _str(_val(spec, node, 'pduPhase'));
      o.currentA = _posNum(_val(spec, node, 'pduCurrentA'));
      o.outlets = _posNum(_val(spec, node, 'pduOutletCount'));
    } else if (type === 'ats') {
      o.inputV = _posNum(_val(spec, node, 'atsInputV'));
      o.currentA = _posNum(_val(spec, node, 'atsCurrentA'));
      o.outlets = _posNum(_val(spec, node, 'atsOutletCount'));
    }
    const c = _compact(o);
    return Object.keys(c).length ? c : null;
  }

  // ── Calcolo (server/hypervisor): CPU/RAM/storage + VM ospitate ────────────────
  function _compute(type, spec, node, vmsCount) {
    const o = {};
    if (type === 'server') {
      o.cpu = _str(_val(spec, node, 'srvCpu'));
      o.ramGb = _posNum(_val(spec, node, 'srvRamGb'));
      o.storageTb = _posNum(_val(spec, node, 'srvStorageTb'));
      o.os = _str(_val(spec, node, 'srvOs'));
    } else if (type === 'hypervisor') {
      o.platform = _str(_val(spec, node, 'hvPlatform'));
      o.cpuSockets = _posNum(_val(spec, node, 'hvCpuSockets'));
      o.cores = _posNum(_val(spec, node, 'hvCores'));
      o.ramGb = _posNum(_val(spec, node, 'hvRamGb'));
      o.storageTb = _posNum(_val(spec, node, 'hvStorageTb'));
    }
    if (vmsCount > 0) o.vms = vmsCount;                // VM censite (top-level node.vms)
    const c = _compact(o);
    return Object.keys(c).length ? c : null;
  }

  // ── Wireless (AP): conteggi PHY/bande/SSID dal modello radio a 2 livelli ──────
  function _wireless(radios) {
    const list = Array.isArray(radios) ? radios : [];
    if (!list.length) return null;
    const bands = [];
    const ssidKeys = new Set();
    for (const r of list) {
      const band = r && r.band ? String(r.band).slice(0, 8) : null;
      if (band && !bands.includes(band)) bands.push(band);
      const ss = (r && Array.isArray(r.ssids)) ? r.ssids : [];
      for (const s of ss) {
        if (!s || s.ssid == null || String(s.ssid).trim() === '') continue;
        ssidKeys.add(String(s.ssid).slice(0, 64) + '|' + (s.vlan != null ? s.vlan : ''));
      }
    }
    const out = { radios: list.length };
    if (bands.length) out.bands = bands;
    if (ssidKeys.size) out.ssids = ssidKeys.size;
    return out;
  }

  // ── Porte: porte libere + mix velocità + banda LAG aggregata ──────────────────
  // Salta i device "banali" (≤1 porta e nessun LAG): un endpoint mono-porta non ha
  // capacità-di-porta utile → niente blocco (contesto più snello).
  function _portsCap(ports, lagNames, lagModes) {
    if (!ports || typeof ports !== 'object') return null;
    const list = Array.isArray(ports.list) ? ports.list : [];
    const total = _posNum(ports.total);

    // mix velocità (per porte con velocità nota)
    const speeds = {};
    for (const p of list) {
      const mbps = _speedToMbps(p && p.speed);
      if (mbps == null) continue;
      const lbl = _speedLabel(mbps);
      speeds[lbl] = (speeds[lbl] || 0) + 1;
    }

    // LAG: raggruppa per lagGroup → banda aggregata = Σ velocità membri
    const names = (lagNames && typeof lagNames === 'object') ? lagNames : {};
    const modes = (lagModes && typeof lagModes === 'object') ? lagModes : {};
    const groups = {};
    for (const p of list) {
      const g = p && p.lagGroup;
      if (!g) continue;
      const mbps = _speedToMbps(p.speed);
      const e = groups[g] || (groups[g] = { members: 0, aggregateMbps: 0, hasSpeed: false });
      e.members++;
      if (mbps != null) { e.aggregateMbps += mbps; e.hasSpeed = true; }
    }
    const lags = [];
    let uplinkAggregateMbps = 0;
    for (const g of Object.keys(groups)) {
      const e = groups[g];
      const lag = { name: _str(names[g]) || String(g).slice(0, 48), members: e.members };
      if (e.hasSpeed) { lag.aggregateMbps = e.aggregateMbps; uplinkAggregateMbps += e.aggregateMbps; }
      const mode = _str(modes[g]);                     // modalità LACP (active/passive/static), se documentata
      if (mode === 'active' || mode === 'passive' || mode === 'static') lag.mode = mode;
      lags.push(lag);
    }
    const hasLags = lags.length > 0;
    if (!hasLags && (total == null || total <= 1)) return null;   // device banale → salta

    const out = {};
    if (ports.free != null) out.free = Number(ports.free);
    if (total != null) out.total = total;
    if (Object.keys(speeds).length) out.speeds = speeds;
    if (hasLags) { out.lags = lags; if (uplinkAggregateMbps > 0) out.uplinkAggregateMbps = uplinkAggregateMbps; }
    return Object.keys(out).length ? out : null;
  }

  function computeDeviceCapabilities(model) {
    const m = (model && typeof model === 'object') ? model : {};
    const type = m.type || '';
    const spec = (m.spec && typeof m.spec === 'object') ? m.spec : null;
    const node = null;                                // lo spec è la fonte; niente top-level extra
    const caps = {};

    const poe = _poe(spec, node, m.ports);
    if (poe) caps.poe = poe;

    const power = _power(type, spec, node);
    if (power) caps.power = power;

    const compute = _compute(type, spec, node, _num(m.vmsCount) || 0);
    if (compute) caps.compute = compute;

    if (type === 'nas') {
      const storage = _compact({ capacityTb: _posNum(_val(spec, node, 'nasCapacityTb')), raid: _str(_val(spec, node, 'nasRaid')), platform: _str(_val(spec, node, 'nasPlatform')) });
      if (Object.keys(storage).length) caps.storage = storage;
    }

    if (type === 'firewall' || type === 'sdwan') {
      const tp = _posNum(_val(spec, node, type === 'firewall' ? 'fwThroughputMbps' : 'sdwanThroughputMbps'));
      if (tp != null) caps.throughputMbps = tp;
    }

    if (type === 'wlanctrl') {
      const wlc = _compact({ apManaged: _posNum(_val(spec, node, 'apManaged')), apCapacity: _posNum(_val(spec, node, 'apCapacity')), platform: _str(_val(spec, node, 'wlcPlatform')) });
      if (Object.keys(wlc).length) caps.wlc = wlc;
    }

    if (type === 'nvr') {
      const nvr = _compact({ channels: _posNum(_val(spec, node, 'nvrChannels')), channelsUsed: _posNum(_val(spec, node, 'nvrChannelsUsed')), storageTb: _posNum(_val(spec, node, 'nvrStorageTb')), retentionDays: _posNum(_val(spec, node, 'nvrRetentionDays')) });
      if (Object.keys(nvr).length) caps.nvr = nvr;
    }

    const wireless = _wireless(m.radios);
    if (wireless) caps.wireless = wireless;

    const portsCap = _portsCap(m.ports, m.lagNames, m.lagModes);
    if (portsCap) caps.ports = portsCap;

    return Object.keys(caps).length ? caps : undefined;
  }

  // ── Riepilogo FLOTTA: somma i totali utili dai blocchi capacità dei device. ───
  // `list` = array delle capacità per-device (alcune undefined). Solo i totali che
  // hanno almeno un contributo finiscono nel risultato.
  function computeFleetCapabilities(list) {
    const arr = Array.isArray(list) ? list : [];
    let freePorts = 0, hasFree = false;
    let poeHeadroomW = 0, hasPoe = false;
    let uplinkAggregateMbps = 0, hasUplink = false;
    let aps = 0, ssids = 0;
    for (const c of arr) {
      if (!c || typeof c !== 'object') continue;
      if (c.ports && c.ports.free != null) { freePorts += Number(c.ports.free) || 0; hasFree = true; }
      if (c.ports && c.ports.uplinkAggregateMbps != null) { uplinkAggregateMbps += Number(c.ports.uplinkAggregateMbps) || 0; hasUplink = true; }
      if (c.poe && c.poe.headroomW != null) { poeHeadroomW += Number(c.poe.headroomW) || 0; hasPoe = true; }
      if (c.wireless) { aps++; if (c.wireless.ssids != null) ssids += Number(c.wireless.ssids) || 0; }
    }
    const out = {};
    if (hasFree) out.freePorts = freePorts;
    if (hasPoe) out.poeHeadroomW = _round1(poeHeadroomW);
    if (hasUplink) out.uplinkAggregateMbps = uplinkAggregateMbps;
    if (aps) out.aps = aps;
    if (ssids) out.ssids = ssids;
    return Object.keys(out).length ? out : undefined;
  }

  return { computeDeviceCapabilities, computeFleetCapabilities, _speedToMbps, _speedLabel, POE_CLASS_W };
});
