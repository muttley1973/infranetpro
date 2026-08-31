'use strict';
// ============================================================
// CRICCHETTO DELLA SCALA TIPOGRAFICA
// ============================================================
// L'app HA una scala a token (`--fs-xs` … `--fs-2xl`, in styles/01-tokens.css),
// e per anni l'ha usata a meta': il resto dei corpi e' stato scritto a mano nel
// punto in cui si disegnava. Misurato il 2026-08-31, prima di questa guardia:
// 761 dichiarazioni di `font-size`, il 45% fuori scala, in 53 corpi distinti —
// di cui 31 stipati fra i 10 e i 16 px. Trentuno gradini in sei millimetri non
// sono una gerarchia: l'occhio non li distingue, e tutto quello che ci sta dentro
// si appiattisce in «testo minore» indistinto.
//
// Due guardie, con due nature diverse:
//
//   ① NIENTE VALORI DI TOKEN RISCRITTI A MANO — asserzione dura, tetto ZERO.
//      `0.82rem` scritto a mano NON e' `--fs-sm`: e' lo stesso pixel oggi e un
//      pixel diverso il giorno in cui il token cambia. E' il modo silenzioso in
//      cui una scala si sfalda restando verde.
//
//   ② IL FUORI-SCALA PUO' SOLO CALARE — cricchetto, come MAX_WIN_REFS.
//      Non pretende lo zero: qualche corpo fuori scala e' legittimo (una misura
//      dentro un disegno, un caso davvero unico). Pretende che non CRESCA.
//
// ⚠️ L'ELENCO DEI LETTERALI PROIBITI NON E' SCRITTO QUI: si DERIVA leggendo i
// token da 01-tokens.css. Se lo enumerassi, aggiungere un token domani lascerebbe
// la guardia verde e cieca — il difetto-classe piu' caro del progetto (un lato
// deriva, l'altro enumera, e il buco non si vede).
//
// ⚠️ LE UNITA' `em` SONO FUORI: `0.9em` e' relativo al PADRE, non alla radice.
// Non e' «`--fs-md` scritto a mano», e convertirlo cambierebbe il rendering.
//
// AMBITO: netmapper.html + styles/*.css + src/*.js — cioe' l'app, che carica
// /styles/01-tokens.css e dove quindi le custom property risolvono. FUORI:
// `login.html` (non carica i token) ed `export.js` (produce un documento
// SERIALIZZATO, dove un `var(--fs-*)` non troverebbe chi lo definisce e il testo
// cadrebbe alla misura di default: li' il letterale e' la scelta GIUSTA).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REM_PX = 16;   // la radice non e' mai ridefinita: 1rem = 16px

/** I file dell'app in cui un `var(--fs-*)` risolve davvero. */
function inScopeFiles() {
  const out = [path.join(ROOT, 'netmapper.html')];
  for (const dir of ['styles', 'src']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).sort()) {
      if (/\.(css|js)$/.test(f)) out.push(path.join(ROOT, dir, f));
    }
  }
  return out;
}

/** Ogni `font-size:` dell'ambito, col suo file e la sua riga. */
function declarations() {
  const out = [];
  for (const file of inScopeFiles()) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const rx = /font-size:[ \t]*([^;}"'`!\n]+)/g;
      let m;
      while ((m = rx.exec(line)) !== null) {
        out.push({ file: path.relative(ROOT, file), line: i + 1, value: m[1].trim() });
      }
    });
  }
  return out;
}

/**
 * I corpi della scala, LETTI da 01-tokens.css — mai elencati qui.
 * @returns {Map<string,string>} letterale proibito -> nome del token
 */
function forbiddenLiterals() {
  const css = fs.readFileSync(path.join(ROOT, 'styles', '01-tokens.css'), 'utf8');
  const map = new Map();
  const rx = /(--fs-[a-z0-9]+)[ \t]*:[ \t]*([0-9]*\.?[0-9]+)rem/g;
  let m;
  while ((m = rx.exec(css)) !== null) {
    const [, token, num] = m;
    // `0.82rem` e `.82rem` sono lo stesso corpo scritto in due modi: proibiti entrambi.
    map.set(num + 'rem', token);
    if (num.startsWith('0.')) map.set(num.slice(1) + 'rem', token);
    // La forma in px vale solo quando e' esatta: 0.75rem = 12px si', 0.82rem = 13.12px no.
    const px = parseFloat(num) * REM_PX;
    if (Number.isInteger(px)) map.set(px + 'px', token);
  }
  return map;
}

test('scala tipografica: i token non si riscrivono a mano', () => {
  const forbidden = forbiddenLiterals();
  assert.ok(forbidden.size > 0, 'nessun token --fs-* letto da 01-tokens.css: la guardia sarebbe cieca');

  const hits = declarations().filter((d) => forbidden.has(d.value));
  const detail = hits.slice(0, 12)
    .map((d) => `  ${d.file}:${d.line}  font-size:${d.value}  ->  var(${forbidden.get(d.value)})`)
    .join('\n');

  assert.strictEqual(hits.length, 0,
    `${hits.length} dichiarazioni riscrivono a mano il corpo di un token che esiste gia'.\n` +
    `Stesso pixel oggi, pixel diverso il giorno in cui il token cambia: usa il token.\n${detail}` +
    (hits.length > 12 ? `\n  … e altre ${hits.length - 12}.` : ''));
});

// Misurato il 2026-08-31: 370 → 273 col rientro di 97 letterali nella scala,
// poi → 267 quando i badge della riga «Stato» del cavo hanno smesso di scrivere
// la propria forma inline (quattro copie di 0,89rem e una di 0,88rem, sostituite
// da tre regole in 06-panels.css: badge, chip modo-porta e percentuale).
// Quando ne assorbi altri, ABBASSA questo numero a quello stampato dal test.
// ⚠️ Il tetto si scrive QUI e in nessun altro posto: le note lo citano per NOME.
const MAX_OFFSCALE_FONTS = 267;

test('scala tipografica: i corpi fuori scala possono solo calare', () => {
  const off = declarations().filter((d) => !/^var\(--fs-/.test(d.value));
  const total = off.length;

  assert.ok(total <= MAX_OFFSCALE_FONTS,
    `corpi fuori scala = ${total} > tetto ${MAX_OFFSCALE_FONTS}: la scala si sta sfaldando.\n` +
    `Usa un token di 01-tokens.css, o motiva perche' questo corpo non ne ha uno. ` +
    `Se invece e' CALATO, abbassa MAX_OFFSCALE_FONTS a ${total} per fissare il progresso.`);

  if (total < MAX_OFFSCALE_FONTS) {
    console.log(`[ratchet-type] fuori scala = ${total} < tetto ${MAX_OFFSCALE_FONTS}: abbassa MAX_OFFSCALE_FONTS a ${total}.`);
  }
});
