'use strict';
// ============================================================
//  lib/ui-catalog.js — CATALOGO UI di InfraNet per l'aiuto in-app (spec §4c).
//
//  PURO (zero DOM/IO, ADR D4). Risolve l'«onboarding/aiuto» dell'assistente: per
//  rispondere a «come si fa X in InfraNet» la fonte di verità NON è il manuale
//  (incompleto, in ritardo) ma **la UI stessa** — i pulsanti con il loro tooltip
//  che DESCRIVE già il comando. Questo modulo DERIVA quel catalogo da
//  netmapper.html (single-source-of-truth, auto-manutenuto → niente deriva /
//  bus-factor) + i dizionari i18n: estrae i bottoni con tooltip (= comandi
//  documentati, user-facing) e li risolve in righe «etichetta — cosa fa».
//
//  Il blocco risultante viene stuffato nel system-prompt (server/ai/prompt.js):
//  l'assistente cita l'etichetta REALE del pulsante e non inventa comandi.
//
//  Convenzione UMD-lite: <script> in netmapper.html (assegna a window) PRIMA del
//  bundle → uso come global bare nel glue; in Node (server/test) lo si require().
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node (server/test)
  if (typeof window !== 'undefined') Object.assign(window, api);             // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Primo identificatore-funzione in un onclick: `pollAllSNMP()` → `pollAllSNMP`,
  // `openAdopt(x);close()` → `openAdopt`. Null se non c'è una chiamata.
  function _handler(onclick) {
    const m = String(onclick || '').match(/([A-Za-z_$][\w$]*)\s*\(/);
    return m ? m[1] : null;
  }

  // Testo visibile di un frammento HTML: via le icone <i …> e tutti i tag, le
  // entità più comuni decodificate, spazi collassati. Per ricavare l'etichetta
  // di un bottone quando non c'è una chiave data-i18n esplicita.
  function _visibleText(html) {
    return String(html || '')
      .replace(/<i\b[^>]*>[\s\S]*?<\/i>/gi, ' ')   // icone Font Awesome
      .replace(/<[^>]+>/g, ' ')                     // ogni altro tag
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function _attr(tag, name) {
    // name esatto (es. data-i18n) senza catturare data-i18n-tip/-ph/-aria: il
    // pattern richiede `="` subito dopo il nome.
    const re = new RegExp(name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '="([^"]*)"');
    const m = tag.match(re);
    return m ? m[1] : null;
  }

  // Estrae i comandi DOCUMENTATI (bottoni con tooltip) da netmapper.html.
  // Ritorna [{ action, labelKey, labelText, tipKey, tipText }] in ordine di
  // apparizione, DEDUPLICATI per action (la prima occorrenza vince). Un bottone
  // senza tooltip (close/back/menu…) è rumore → escluso.
  function extractCatalog(html) {
    const src = String(html || '');
    const out = [];
    const seen = new Set();
    const reBtn = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
    let m;
    while ((m = reBtn.exec(src)) !== null) {
      const openTag = m[1] || '';
      const inner = m[2] || '';
      const whole = m[0] || '';
      const tipKey = _attr(openTag, 'data-i18n-tip');
      const tipText = _attr(openTag, 'data-tip');
      if (!tipKey && !tipText) continue;                 // solo comandi documentati
      const action = _handler(_attr(openTag, 'onclick'));
      if (!action) continue;                             // serve un'azione citabile
      if (seen.has(action)) continue;                    // dedup per handler
      seen.add(action);
      // Etichetta: chiave data-i18n (sul tag o su uno span annidato) o testo visibile.
      const labelKey = _attr(openTag, 'data-i18n') || _attr(whole, 'data-i18n');
      out.push({
        action,
        labelKey: labelKey || null,
        labelText: _visibleText(inner) || null,
        tipKey: tipKey || null,
        tipText: tipText || null,
      });
    }
    return out;
  }

  function _resolve(dict, lang, key, fallback) {
    if (!key) return fallback || '';
    const d = (dict && typeof dict === 'object') ? dict : {};
    const lg = (d[lang] && d[lang][key]);
    if (lg) return lg;
    const it = (d.it && d.it[key]);
    if (it) return it;
    return fallback || '';
  }

  // Catalogo → righe testuali «"Etichetta" — cosa fa», risolte nella lingua UI.
  // Salta le voci senza etichetta utile; cap a opts.max (default 60) per il budget
  // token. Il `dict` è il dizionario i18n ({ it:{}, en:{} }, es. lib/i18n._i18nDict).
  function catalogLines(catalog, dict, lang, opts) {
    const lg = lang === 'en' ? 'en' : 'it';
    const max = (opts && Number.isFinite(opts.max)) ? opts.max : 60;
    const lines = [];
    for (const e of (Array.isArray(catalog) ? catalog : [])) {
      const label = _resolve(dict, lg, e.labelKey, e.labelText) || e.labelText || '';
      const tip = _resolve(dict, lg, e.tipKey, e.tipText) || e.tipText || '';
      const lbl = String(label).trim();
      if (!lbl || !/[\wÀ-ÿ]/.test(lbl)) continue;        // senza un nome reale (solo «…»/simboli) non è citabile
      const tp = String(tip).trim();
      lines.push(tp ? `"${lbl}" — ${tp}` : `"${lbl}"`);
      if (lines.length >= max) break;
    }
    return lines;
  }

  // Comodità: estrae + risolve in un colpo (uso tipico dal server).
  function buildCatalogLines(html, dict, lang, opts) {
    return catalogLines(extractCatalog(html), dict, lang, opts);
  }

  return { extractCatalog, catalogLines, buildCatalogLines, _handler, _visibleText, _resolve };
});
