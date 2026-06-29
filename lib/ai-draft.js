'use strict';
// ============================================================
//  lib/ai-draft.js — scaffolding/segmentazione della BOZZA Ansible (funzione 5).
//
//  PURO (zero DOM/IO, ADR D4). Spec §8c: l'output Ansible è sempre una **BOZZA**
//  (banner «non applicata · rivedi prima di usare») + Copia; InfraNet **non esegue
//  nulla**, è testo. Questo modulo NON genera il playbook (lo scrive il modello):
//  segmenta la risposta in TESTO e BLOCCHI DI CODICE (fence ```), così la UI può
//  rendere i blocchi di automazione come card-bozza (banner ambra + Copia) e il
//  resto come normali bolle. Nessun innerHTML: la UI usa textContent sui pezzi.
//
//  Convenzione UMD-lite: <script> in netmapper.html (assegna a window) PRIMA del
//  bundle → il glue lo usa come global bare; in Node (test) lo si require().
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node (test)
  if (typeof window !== 'undefined') Object.assign(window, api);             // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Linguaggi «di automazione/config» → meritano il banner BOZZA (sono azionabili).
  // Gli altri blocchi di codice restano copiabili ma senza banner (es. json/output).
  const DRAFT_LANGS = new Set([
    'yaml', 'yml', 'ansible', 'ini', 'toml', 'cfg', 'conf',
    'sh', 'bash', 'shell', 'zsh', 'console',
    'jinja', 'jinja2', 'j2', 'hcl', 'tf',
  ]);

  function _isDraftLang(lang) {
    return DRAFT_LANGS.has(String(lang || '').trim().toLowerCase());
  }
  // Toglie SOLO le righe vuote iniziali/finali (preserva l'indentazione interna).
  function _trimEnds(s) {
    return String(s == null ? '' : s).replace(/^\n+/, '').replace(/\s+$/, '');
  }

  // Segmenta il testo in blocchi { type:'text'|'code', content, lang?, draft? }.
  // Fence = una riga che inizia (eventuale spazio) con ``` + lingua opzionale. Un
  // blocco di codice non chiuso a fine testo viene comunque emesso (bozza monca).
  function splitDraftBlocks(text) {
    const lines = String(text == null ? '' : text).split('\n');
    const FENCE = /^\s*```(.*)$/;
    const segs = [];
    let mode = 'text', buf = [], lang = '';
    const flushText = () => {
      const c = _trimEnds(buf.join('\n'));
      if (c) segs.push({ type: 'text', content: c });
      buf = [];
    };
    const flushCode = () => {
      segs.push({ type: 'code', lang: String(lang || '').trim().toLowerCase(), content: _trimEnds(buf.join('\n')), draft: _isDraftLang(lang) });
      buf = []; lang = '';
    };
    for (const line of lines) {
      const m = line.match(FENCE);
      if (m) {
        if (mode === 'text') { flushText(); mode = 'code'; lang = m[1] || ''; }
        else { flushCode(); mode = 'text'; }
        continue;
      }
      buf.push(line);
    }
    if (mode === 'code') flushCode(); else flushText();
    return segs;
  }

  // Comodità: solo i blocchi di codice (per chi vuole l'elenco delle bozze).
  function extractDrafts(text) {
    return splitDraftBlocks(text).filter((s) => s.type === 'code');
  }
  // true se la risposta contiene almeno un blocco di automazione (banner BOZZA).
  function hasDraft(text) {
    return splitDraftBlocks(text).some((s) => s.type === 'code' && s.draft);
  }

  return { splitDraftBlocks, extractDrafts, hasDraft, _isDraftLang };
});
