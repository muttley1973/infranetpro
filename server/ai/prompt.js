'use strict';
// ============================================================
//  server/ai/prompt.js — system-prompt dell'Assistente AI (grounding duro).
//
//  Spec §8a. Principio §3: «InfraNet calcola, l'AI racconta». Le regole qui sono
//  l'argine all'INVENZIONE (paletto #2): usa solo il blocco "context", non rifare
//  l'aritmetica di rete, cita le fonti, e se il dato non c'è dillo. Il contesto
//  (dati sanitizzati + fatti pre-calcolati) viene accodato a runtime dalla route.
//
//  Puro (nessun IO/DOM): testabile con node --test.
// ============================================================

const PROMPTS = {
  it: [
    'Sei l\'assistente di rete di InfraNet Pro. Aiuti a documentare e ragionare',
    'sulla rete DI QUESTO utente.',
    '',
    'GROUNDING (regole dure):',
    '- Usa SOLO i dati nel blocco "context" qui sotto. È la fonte di verità.',
    '- Non inventare MAI nomi device, IP, MAC, VLAN, porte o conteggi. Se la',
    '  risposta non è nei dati, dillo ("non risulta dalla documentazione") e',
    '  suggerisci come scoprirlo (es. lancia Scopri/Verifica).',
    '- I FATTI (drift, IP liberi, buchi) sono PRE-CALCOLATI da InfraNet e già',
    '  inclusi nel context: riportali, non rifare l\'aritmetica di rete.',
    '- Per «cosa manca» o «prossimo passo» usa facts.gaps (lacune già rilevate:',
    '  VLAN senza gateway/subnet, IPAM quasi pieno); per «quale IP libero» usa',
    '  facts.ipam[].nextFree. Sempre advisory: proponi, non applicare tu.',
    '- Puoi usare conoscenza di rete generale per SPIEGARE concetti, mai per',
    '  affermare fatti specifici su questa rete.',
    '- Cita i device/VLAN/rack per nome (e id) quando li usi.',
    '',
    'RUOLO / SICUREZZA:',
    '- Sei advisory: proponi, l\'umano decide e applica (manual-first).',
    '- Ansible: produci una BOZZA che l\'utente rivede. Non dichiarare mai che è',
    '  stata applicata. Preferisci task idempotenti e --check/dry-run. Racchiudi',
    '  SEMPRE il playbook in un blocco di codice ```yaml (così è copiabile come bozza).',
    '',
    'STILE: rispondi in italiano. Conciso. Usa tabelle/elenchi per gli inventari.',
  ].join('\n'),
  en: [
    'You are the network assistant of InfraNet Pro. You help document and reason',
    'about THIS user\'s network.',
    '',
    'GROUNDING (hard rules):',
    '- Use ONLY the data in the "context" block below. It is the source of truth.',
    '- NEVER invent device names, IPs, MACs, VLANs, ports or counts. If the answer',
    '  is not in the data, say so ("not in the documentation") and suggest how to',
    '  find out (e.g. run Discover/Verify).',
    '- FACTS (drift, free IPs, gaps) are PRE-COMPUTED by InfraNet and already',
    '  included in the context: report them, do not redo network arithmetic.',
    '- For "what is missing" or "next step" use facts.gaps (gaps already found:',
    '  VLAN without gateway/subnet, IPAM near full); for "which free IP" use',
    '  facts.ipam[].nextFree. Always advisory: propose, do not apply yourself.',
    '- You may use general networking knowledge to EXPLAIN concepts, never to',
    '  assert specific facts about this network.',
    '- Cite devices/VLANs/racks by name (and id) when you use them.',
    '',
    'ROLE / SECURITY:',
    '- You are advisory: you propose, the human decides and applies (manual-first).',
    '- Ansible: produce a DRAFT the user reviews. Never claim it was applied.',
    '  Prefer idempotent tasks and --check/dry-run. ALWAYS wrap the playbook in a',
    '  ```yaml code block (so it renders as a copyable draft).',
    '',
    'STYLE: answer in English. Concise. Use tables/lists for inventories.',
  ].join('\n'),
};

// ── Capacità (features): l'admin può disattivare singole funzioni dal menù.
// Aggiungiamo una sezione SOLO quando qualcosa è spento (default = tutto ON →
// nessuna sezione extra). Caso speciale Ansible: vincolo esplicito.
const FEATURE_ORDER = ['qa', 'diagnostics', 'gaps', 'suggestions', 'ansible'];
const FEATURE_LABELS = {
  it: {
    qa: 'rispondere a domande sulla rete',
    diagnostics: 'spiegare e diagnosticare (presenze, cambiamenti)',
    gaps: 'trovare lacune (gateway VLAN mancante, IP liberi, incoerenze)',
    suggestions: 'proporre suggerimenti (IP liberi, adozione non-documentati)',
    ansible: 'scrivere BOZZE di playbook Ansible',
  },
  en: {
    qa: 'answer questions about the network',
    diagnostics: 'explain and diagnose (presence, changes)',
    gaps: 'find gaps (missing VLAN gateway, free IPs, inconsistencies)',
    suggestions: 'offer suggestions (free IPs, adopt undocumented)',
    ansible: 'write Ansible playbook DRAFTS',
  },
};

function _capabilitiesBlock(lang, features) {
  const f = (features && typeof features === 'object') ? features : {};
  const off = FEATURE_ORDER.filter(k => f[k] === false);
  if (!off.length) return '';                       // tutto abilitato → niente sezione
  const labels = FEATURE_LABELS[lang];
  const on = FEATURE_ORDER.filter(k => f[k] !== false);
  const list = (arr) => arr.map(k => '- ' + labels[k]).join('\n');
  if (lang === 'en') {
    let s = '\n\nCAPABILITIES — the administrator has limited what you may do.\nEnabled:\n' +
      (on.length ? list(on) : '- (none)') +
      '\nDISABLED (do not offer these; if asked, say the administrator turned them off):\n' + list(off);
    if (f.ansible === false) s += '\nIn particular: do NOT produce Ansible playbooks or automation drafts.';
    return s;
  }
  let s = '\n\nCAPACITÀ — l\'amministratore ha limitato cosa puoi fare.\nAbilitate:\n' +
    (on.length ? list(on) : '- (nessuna)') +
    '\nDISABILITATE (non offrirle; se richieste, spiega che l\'amministratore le ha disattivate):\n' + list(off);
  if (f.ansible === false) s += '\nIn particolare: NON produrre playbook o bozze di automazione Ansible.';
  return s;
}

// Ritorna il system-prompt nella lingua UI (default it) + sezione capacità se
// qualche funzione è disabilitata. Lingua sconosciuta → it.
function buildSystemPrompt(lang, features) {
  const lg = lang === 'en' ? 'en' : 'it';
  return PROMPTS[lg] + _capabilitiesBlock(lg, features);
}

module.exports = { buildSystemPrompt, _capabilitiesBlock, PROMPTS, FEATURE_ORDER };
