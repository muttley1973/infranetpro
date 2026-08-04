// ============================================================
// OCCHIO "mostra password" sui campi mascherati (type=password).
//
// Riutilizzabile e IDEMPOTENTE: enhancePwFields(root) trova ogni
// input[type=password] non ancora arricchito, lo avvolge in un `.pw-field`
// (posizionato) e vi appende un bottone occhio delegato (data-act="pw-toggle").
// Il click alterna type password<->text e l'icona fa-eye<->fa-eye-slash.
//
// Chiamato:
//   · all'init (DOM pronto) -> campi STATICI dei modali (community SNMP di
//     Scopri/Topologia, API key AI, cambio password, nuovo utente, cred. DHCP);
//   · a fine renderProps() -> campi DINAMICI del pannello (credenziali SNMPv3).
//
// Nota sicurezza: rivelare è un gesto ESPLICITO dell'utente sul proprio schermo;
// non tocca la redazione dei segreti verso l'esterno (AI/log/export), che resta.
// Un campo può opt-out con data-no-pw-eye (layout bespoke).
// ============================================================
import { expose, t } from './_bridge.js';
import { registerClickActions } from './app-delegation.js';

const _pwLabel = (k, fb) => (typeof t === 'function' ? t(k) : fb);

// Avvolge i campi mascherati di `root` (default: document) non ancora arricchiti.
export function enhancePwFields(root) {
    const scope = root || document;
    let list;
    try { list = scope.querySelectorAll('input[type="password"]:not([data-pw-eye]):not([data-no-pw-eye])'); }
    catch (_) { return; }
    list.forEach((inp) => {
        if (!inp.parentNode) return;
        inp.setAttribute('data-pw-eye', '1');
        const wrap = document.createElement('span');
        wrap.className = 'pw-field';
        // Il wrapper EREDITA il posto dell'input nel layout: sposto flex/larghezza
        // esplicite (inline) sul wrapper e faccio riempire l'input al 100%. Cosi'
        // i campi flex (cred DHCP) e a larghezza fissa restano dimensionati bene.
        if (inp.style.flex) { wrap.style.flex = inp.style.flex; inp.style.flex = ''; }
        if (inp.style.width) { wrap.style.width = inp.style.width; }
        inp.parentNode.insertBefore(wrap, inp);
        wrap.appendChild(inp);
        inp.style.width = '100%';
        inp.style.paddingRight = '32px';   // spazio per l'occhio (batte il padding inline)
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pw-eye';
        btn.tabIndex = -1;   // non entra nel tab-order del form
        btn.setAttribute('data-act', 'pw-toggle');
        btn.setAttribute('aria-label', _pwLabel('pw.reveal', 'Mostra password'));
        btn.innerHTML = '<i class="fas fa-eye"></i>';
        wrap.appendChild(btn);
    });
}

// Toggle delegato: mostra/nasconde il campo accanto al bottone.
registerClickActions({
    'pw-toggle': (el) => {
        const wrap = el.closest('.pw-field'); if (!wrap) return;
        const inp = wrap.querySelector('input'); if (!inp) return;
        const reveal = inp.type === 'password';
        inp.type = reveal ? 'text' : 'password';
        const ic = el.querySelector('i');
        if (ic) ic.className = reveal ? 'fas fa-eye-slash' : 'fas fa-eye';
        el.setAttribute('aria-label', _pwLabel(reveal ? 'pw.hide' : 'pw.reveal', reveal ? 'Nascondi password' : 'Mostra password'));
        el.setAttribute('aria-pressed', reveal ? 'true' : 'false');
    },
});

// Arricchisce i campi statici appena il DOM e' pronto (il bundle e' l'ultimo
// <script>: DOMContentLoaded puo' essere gia' passato -> chiama subito).
if (document.readyState !== 'loading') enhancePwFields(document);
else document.addEventListener('DOMContentLoaded', () => enhancePwFields(document), { once: true });

expose({ enhancePwFields });
