// ============================================================
// HEADER FIT — l'header non va MAI a due righe quando compaiono i badge
// ============================================================
// I badge di STATO dell'header compaiono/spariscono a runtime (polling auto
// "Auto 4m", "Porte libere", freschezza "16 h", SNMPv3 da configurare, voci
// dei moduli a pagamento) e ognuno aggiunge larghezza. Sopra il breakpoint
// ≤1737 la ricerca ha ancora un basis largo (320px), quindi la comparsa dei
// badge nella fascia ~1738–1920px spinge il cluster destro su una SECONDA riga
// (bug: bastava attivare il polling per far "spezzare" l'header).
//
// Le media query non possono reagire alla comparsa di un badge (non è una
// condizione di larghezza), quindi qui MISURIAMO e recuperiamo spazio nella
// PRIORITÀ chiesta:
//   1) prima si portano a ICONA le etichette dei pulsanti (meno importanti →
//      più importanti: Esporta, Dashboard, Salva, Multisito, Scopri);
//   2) SOLO come ultima risorsa si stringe la barra di ricerca.
// L'etichetta di «Verifica» (azione primaria) non si tocca mai — resta l'unica
// scritta anche nel caso peggiore (coerente con la scelta storica del layout).
//
// Come: si aggiungono al `<header>` le classi cumulative hf1…hf6 (una alla
// volta, finché torna su una riga); il collasso vero lo fa il CSS in
// styles/09-user-theme.css. Nessuno stile inline → nessun ciclo con l'osservatore.
// Le media query restano l'autorità del layout SENZA badge (a badge spenti il
// fitter non fa nulla): questo modulo è puramente ADDITIVO al caso "con badge".
// ============================================================

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  // Sei gradini, uno per parola che può cedere (Esporta · Dashboard · Salva ·
  // Multisito · Scopri) più la stretta della ricerca. Erano cinque, con Salva ed
  // Esporta appaiate sul primo: appaiarle costava «Salva» al primo badge acceso,
  // che sui progetti con SNMP è la condizione normale, non il caso raro.
  const MAX_LEVEL = 6;          // hf1…hf6 (5 etichette + stretta ricerca)
  const WRAP_EPS = 20;          // px: soglia "il cluster destro è su un'altra riga"

  const header = () => document.querySelector('header');

  // Wrap = il cluster destro (.header-right, il blocco più largo e l'ultimo a
  // rientrare) è finito su una riga sotto al titolo. Robusto ai cambi di
  // padding/min-height fra i breakpoint: confronta gli offsetTop, non un'altezza
  // magica. (Leggere offsetTop forza il reflow → la misura riflette le classi
  // appena applicate.)
  function isWrapped(h) {
    const right = h.querySelector('.header-right');
    const title = h.querySelector('.header-title');
    if (!right || !title) return false;
    return (right.offsetTop - title.offsetTop) > WRAP_EPS;
  }

  function fitHeader() {
    const h = header();
    if (!h) return;
    // Reset: si riparte SEMPRE dal layout pieno (le etichette ricompaiono se lo
    // spazio è tornato — es. si spegne un badge o si allarga la finestra), poi
    // si sale di livello solo quanto serve.
    for (let i = 1; i <= MAX_LEVEL; i++) h.classList.remove('hf' + i);
    let level = 0;
    while (level < MAX_LEVEL && isWrapped(h)) {
      level++;
      h.classList.add('hf' + level);
    }
    // Se anche hf6 non basta (finestra molto stretta + molti badge insieme)
    // l'header va a capo come prima: rete di sicurezza invariata, nessun
    // pulsante tagliato fuori schermo.
  }

  // Coalescenza: tante mutazioni nello stesso frame → un solo fitHeader.
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    const run = () => { scheduled = false; fitHeader(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  function init() {
    const h = header();
    if (!h) return;
    fitHeader();

    window.addEventListener('resize', schedule);

    // Un solo osservatore su tutto l'header: cattura la comparsa dei badge
    // (style.display), il ripopolarsi dei menu/slot (childList), il cambio di
    // testo (countdown "Auto …", switch lingua delle etichette, nome progetto).
    // attributeFilter ESCLUDE 'class' apposta: il fitter tocca solo la class del
    // `<header>`, quindi la sua stessa mutazione NON rientra dall'osservatore
    // (niente ciclo). Nessun altro attributo/figlio/testo cambia per mano sua.
    if (typeof MutationObserver === 'function') {
      const mo = new MutationObserver(schedule);
      mo.observe(h, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['style', 'aria-hidden'],
      });
    }

    // Le icone (Font Awesome) e i font caricano async e cambiano la larghezza
    // dei pulsanti dopo il primo paint → rimisura quando i font sono pronti e a
    // 'load' (belt-and-suspenders contro un wrap iniziale che sparisce solo al
    // primo resize).
    if (document.fonts && typeof document.fonts.ready?.then === 'function') {
      document.fonts.ready.then(schedule).catch(() => {});
    }
    window.addEventListener('load', schedule);
  }

  // Esposto per i test e2e/il debug live (window.*, non il ponte win.* → fuori
  // dal cricchetto MAX_WIN_REFS).
  window._fitHeader = fitHeader;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}
