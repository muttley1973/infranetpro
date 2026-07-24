'use strict';
// ============================================================
//  lib/link-model.js — modello PURO del "link" (cavo logico) e dei suoi segmenti.
//
//  Zero DOM, zero stato: solo funzioni pure (ADR D4) che operano sull'OGGETTO link
//  passato (e i suoi `segments`). Estratte da src/app.js (il nucleo era cresciuto a
//  ~2300 righe) per renderle testabili a tavolino e snellire il monolite.
//
//  Convenzione UMD-lite del progetto: caricato come <script> in netmapper.html
//  (assegna a window) PRIMA del bundle, così src/app.js + il glue le usano come
//  global bare / via il ponte (win.*). I consumatori NON la importano (regola del
//  ponte, vedi test/bundle-architecture.test.js): leggono i global esposti qui.
//
//  Un "link" è { id, src:'nodeId-portN', dst:'nodeId-portN', segments?:[...] , ... }.
//  Un "segment" è una tratta fisica { from, to, length/lengthM, cableType/type, ... }.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node (test)
  if (typeof window !== 'undefined') Object.assign(window, api);             // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Normalizza i metadati di un link IN PLACE (alias storici length↔lengthM,
  // category↔cableCategory, color↔colorOvr; trim di stringhe; isPermanent → bool)
  // e i suoi segmenti. Ritorna lo stesso oggetto.
  function _normalizeLinkMetadata(link){
    if(!link || typeof link !== 'object') return link;

    if(link.length == null && link.lengthM != null) link.length = link.lengthM;
    if(link.length != null && link.lengthM == null) link.lengthM = link.length;
    if(link.cableCategory == null && link.category != null) link.cableCategory = link.category;
    if(link.colorOvr == null && link.color != null) link.colorOvr = link.color;
    if(link.colorOvr != null && link.color == null) link.color = link.colorOvr;

    if(link.cableType != null){
        const raw = String(link.cableType).trim();
        if(raw) link.cableType = raw;
        else delete link.cableType;
    }

    if(link.installedAt != null){
        const raw = String(link.installedAt).trim();
        if(raw) link.installedAt = raw;
        else delete link.installedAt;
    }
    if(link.installedBy != null){
        const raw = String(link.installedBy).trim();
        if(raw) link.installedBy = raw;
        else delete link.installedBy;
    }
    if(link.isPermanent != null){
        if(link.isPermanent === true || link.isPermanent === 'true' || link.isPermanent === 1 || link.isPermanent === '1'){
            link.isPermanent = true;
        } else if(link.isPermanent === false || link.isPermanent === 'false' || link.isPermanent === 0 || link.isPermanent === '0'){
            link.isPermanent = false;   // "patch cord" ESPLICITO ≠ non specificato (assente): tri-stato onesto
        } else {
            delete link.isPermanent;
        }
    }

    _normalizeLinkSegments(link);

    return link;
  }

  // Normalizza un singolo segmento IN PLACE (alias type↔cableType, permanent↔
  // isPermanent; trim di from/to/notes/installed*). Ritorna il segmento o null.
  function _normalizeLinkSegment(segment){
    if(!segment || typeof segment !== 'object') return null;

    if(segment.from != null){
        const raw = String(segment.from).trim();
        if(raw) segment.from = raw;
        else delete segment.from;
    }
    if(segment.to != null){
        const raw = String(segment.to).trim();
        if(raw) segment.to = raw;
        else delete segment.to;
    }

    if(segment.length == null && segment.lengthM != null) segment.length = segment.lengthM;
    if(segment.length != null && segment.lengthM == null) segment.lengthM = segment.length;

    if(segment.cableType == null && segment.type != null) segment.cableType = segment.type;
    if(segment.type == null && segment.cableType != null) segment.type = segment.cableType;

    if(segment.cableType != null){
        const raw = String(segment.cableType).trim();
        if(raw){
            segment.cableType = raw;
            segment.type = raw;
        } else {
            delete segment.cableType;
            delete segment.type;
        }
    }

    if(segment.installedAt != null){
        const raw = String(segment.installedAt).trim();
        if(raw) segment.installedAt = raw;
        else delete segment.installedAt;
    }
    if(segment.installedBy != null){
        const raw = String(segment.installedBy).trim();
        if(raw) segment.installedBy = raw;
        else delete segment.installedBy;
    }
    if(segment.notes != null){
        const raw = String(segment.notes).trim();
        if(raw) segment.notes = raw;
        else delete segment.notes;
    }

    if(segment.isPermanent == null && segment.permanent != null) segment.isPermanent = segment.permanent;
    if(segment.isPermanent != null){
        if(segment.isPermanent === true || segment.isPermanent === 'true' || segment.isPermanent === 1 || segment.isPermanent === '1'){
            segment.isPermanent = true;
            segment.permanent = true;
        } else {
            delete segment.isPermanent;
            segment.permanent = false;
        }
    } else if(segment.permanent != null){
        segment.permanent = !!segment.permanent;
    }

    return segment;
  }

  // Normalizza l'array link.segments IN PLACE; rimuove i segmenti vuoti, e se non
  // ne resta nessuno significativo elimina del tutto la proprietà.
  function _normalizeLinkSegments(link){
    if(!link || !Array.isArray(link.segments)) return link;

    const normalized = link.segments
        .map(_normalizeLinkSegment)
        .filter(segment => segment && (segment.from || segment.to || segment.length != null || segment.cableType || segment.notes));

    if(normalized.length) link.segments = normalized;
    else delete link.segments;

    return link;
  }

  // Crea un record di segmento normalizzato da from/to (+ extra).
  function _createLinkSegmentRecord(from, to, extra={}){
    return _normalizeLinkSegment({ from, to, ...extra });
  }

  // Coppie [from,to] del link: dai segmenti se presenti, altrimenti dal solo src→dst.
  function _getLinkSegmentPairs(link){
    const pairs = [];
    if(Array.isArray(link?.segments)){
        for(const segment of link.segments){
            const from = String(segment?.from || '').trim();
            const to = String(segment?.to || '').trim();
            if(from && to && from !== to) pairs.push([from, to]);
        }
    }
    if(!pairs.length){
        const src = String(link?.src || '').trim();
        const dst = String(link?.dst || '').trim();
        if(src && dst && src !== dst) pairs.push([src, dst]);
    }
    return pairs;
  }

  // Tutti i port-id toccati dal link (src/dst + estremi dei segmenti), deduplicati.
  function _getLinkPortIds(link){
    const out = new Set();
    const src = String(link?.src || '').trim();
    const dst = String(link?.dst || '').trim();
    if(src) out.add(src);
    if(dst) out.add(dst);
    for(const [from, to] of _getLinkSegmentPairs(link)){
        out.add(from);
        out.add(to);
    }
    return [...out];
  }

  // true se il link tocca la porta pid (src/dst o un estremo di segmento).
  function _linkTouchesPort(link, pid){
    if(!link || !pid) return false;
    return _getLinkPortIds(link).includes(pid);
  }

  // Porte adiacenti a pid lungo le coppie del link (il "dall'altro lato").
  function _linkAdjacentPorts(link, pid){
    if(!link || !pid) return [];
    const adj = new Set();
    for(const [from, to] of _getLinkSegmentPairs(link)){
        if(from === pid && to !== pid) adj.add(to);
        if(to === pid && from !== pid) adj.add(from);
    }
    return [...adj];
  }

  // La prima porta adiacente a pid (capo opposto di un link diretto).
  function _linkOtherPort(link, pid){
    const adj = _linkAdjacentPorts(link, pid);
    return adj[0] || null;
  }

  // true se il link contiene la coppia {a,b} in un verso o nell'altro.
  function _linkHasPair(link, a, b){
    if(!link || !a || !b) return false;
    return _getLinkSegmentPairs(link).some(([from, to]) => (from === a && to === b) || (from === b && to === a));
  }

  // Estremi da DISEGNARE: src/dst del link, con fallback al primo/ultimo segmento.
  function _getLinkDrawEndpoints(link){
    let src = String(link?.src || '').trim();
    let dst = String(link?.dst || '').trim();
    if((!src || !dst) && Array.isArray(link?.segments) && link.segments.length){
        const first = link.segments[0] || {};
        const last = link.segments[link.segments.length - 1] || {};
        src = src || String(first.from || first.to || '').trim();
        dst = dst || String(last.to || last.from || '').trim();
    }
    return { src, dst };
  }

  return {
    _normalizeLinkMetadata, _normalizeLinkSegment, _normalizeLinkSegments,
    _createLinkSegmentRecord, _getLinkSegmentPairs, _getLinkPortIds,
    _linkTouchesPort, _linkAdjacentPorts, _linkOtherPort, _linkHasPair,
    _getLinkDrawEndpoints,
  };
});
