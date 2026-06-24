// ============================================================
// InfraNet Pro — tipi di dominio condivisi (ambient, globali).
//
// Tipizzazione INCREMENTALE dei moduli PURI (lib/*.js) via JSDoc + checkJs:
// i .js restano identici a runtime (UMD-lite, caricati come <script> nel
// browser); `tsc --noEmit` (npm run typecheck) li controlla a build-time.
//
// Questi tipi sono volutamente "loose" (campi opzionali, [k:string]) perché
// il modello a runtime è un blob JSON: l'obiettivo è blindare le FORME usate
// dai puri (radio/ssid/link/vlan), non imporre strict su tutto il progetto.
// Si stringono col tempo, file per file. Niente import/export → globali.
// ============================================================

/** VLAN id (1..4094 a runtime). */
type Vlan = number;

/** Un BSS/SSID logico trasmesso da una radio (livello logico del Wi-Fi). */
interface Ssid {
  /** id stabile referenziato da NetLink.bss. */
  id: string;
  ssid?: string;
  vlan?: number | string;
  security?: string;
}

/** Una radio FISICA: campi PHY + lista di BSS. (i campi legacy
 *  ssid/vlan/security pre-migrazione restano per migrateRadioSsids.) */
interface Radio {
  label?: string;
  band?: string;
  channel?: number | string;
  standard?: string;
  bx?: number;
  by?: number;
  ssids?: Ssid[];
  ssid?: string;
  vlan?: number | string;
  security?: string;
}

/** Un nodo (device) del progetto. Loose: solo i campi letti dai puri. */
interface NetNode {
  id: string;
  type: string;
  name?: string;
  radios?: Radio[];
  voiceVlan?: number | string;
  spec?: { voiceVlan?: number | string;[k: string]: any };
  wifi?: boolean;
  wifiCfg?: { [k: string]: any };
  [k: string]: any;
}

/** Un link: cavo fisico o associazione wireless (radio↔radio). */
interface NetLink {
  id: string;
  src: string;
  dst: string;
  wireless?: boolean;
  /** id del BSS servito dall'associazione (vedi Ssid.id). */
  bss?: string;
  mode?: string;
  trunkVlans?: number[] | string;
  vlan?: number | string;
  from?: string;
  to?: string;
  [k: string]: any;
}

/** Descrittore EFFETTIVO delle VLAN di un link (output di effLinkVlans). */
interface LinkVlanInfo {
  mode: "access" | "trunk";
  native: number;
  vlans: number[];
  carried: number[];
  derived: boolean;
}

// ── Globali del wrapper UMD dei moduli puri (niente @types/node) ──────
declare var module: { exports: any } | undefined;

/** i18n: funzione di traduzione globale (browser); i puri la usano con
 *  guardia `typeof t === 'function'` e fallback IT in Node/test. */
declare var t: ((key: string, vars?: any) => string) | undefined;
