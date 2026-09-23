'use strict';
// ============================================================
//  IL PASSO DI RILASCIO, MISURATO INVECE CHE RICORDATO
// ============================================================
// Sette versioni su dodici sono state corrette il giorno DOPO il tag, e la
// 2.7.2 non ha mai avuto la sua sezione di CHANGELOG. Non e' distrazione: il
// rilascio e' una lista di posti da toccare a mano, e una lista a mano si
// dimentica. Questo script tocca i posti, e sorveglia i numeri che nessun
// altro puo' sorvegliare.
//
//   node tools/release.js bump 2.12.0     scrive la versione nei QUATTRO posti
//   node tools/release.js check           il cancello, PRIMA del tag
//   node tools/release.js check --rapido  come sopra, ma senza rilanciare la suite
//
// ⚠️ COSA NON RIFA', e dirlo conta quanto il codice. L'allineamento della
// versione e il conteggio dei sorgenti hanno GIA' il loro cancello dentro la
// suite (`test/versione-allineata.test.js`, `test/readme-numeri-misurati.test.js`).
// Qui non se ne scrive una seconda copia: `check` LANCIA la suite e si fida di
// quella. Due definizioni della stessa regola divergono sempre, perche' la
// seconda non la aggiorna nessuno.
//
// ⚠️ IL CONTEGGIO DEI TEST puo' misurarlo solo uno script come questo, e il
// motivo e' scritto nel cancello che rimanda qui: una prova che conta le prove
// e' CIRCOLARE — il numero cambierebbe scrivendo la prova che lo controlla.
// Quindi si misura dopo la suite, da fuori.
//
// ⚠️ COSA NON PUO' MISURARE: le pagine dei manuali. I sorgenti vivono in un
// repo privato separato (`_local/manual-src/`), quindi restano un passo A MANO
// della checklist — e lo script lo DICE invece di dare un verde che non ha
// guadagnato. Il conteggio si fa con i form-feed di `pdftotext`, che ne emette
// uno ANCHE dopo l'ultima pagina: ⛔ non si aggiunge uno.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const leggi = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const scrivi = (f, s) => fs.writeFileSync(path.join(ROOT, f), s);

const RE_SEMVER = /^\d+\.\d+\.\d+$/;
const ok = (s) => console.log('  \u2713 ' + s);
const ko = (s) => console.log('  \u2717 ' + s);
const nota = (s) => console.log('  \u2022 ' + s);

// ── I quattro posti ───────────────────────────────────────────────────────
// Sono quattro FILE ma cinque campi: il lockfile porta la versione due volte
// (radice e `packages[""]`), ed e' esattamente quella la copia che e' scivolata
// in passato. Ogni voce dichiara quante occorrenze si aspetta: se ne trova un
// numero diverso NON scrive niente e si ferma — un rilascio che tocca il file
// sbagliato e' peggio di un rilascio che non parte.
function posti(nomePacchetto) {
    const nome = nomePacchetto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [
        // ⚠️ Ogni voce porta DUE regex sulla stessa ancora: una per scrivere
        // (`re`) e una per leggere il numero che c'e' (`reLeggi`, che lo
        // cattura). Sono scritte a mano tutt'e due di proposito: ricavare la
        // seconda dalla prima a colpi di `source.replace(...)` funzionava, ma
        // e' il genere di trucco che si rompe senza dirlo il giorno che
        // qualcuno tocca l'ancora.
        {
            file: 'package.json',
            re: /("version"\s*:\s*")\d+\.\d+\.\d+(")/,
            reLeggi: /"version"\s*:\s*"(\d+\.\d+\.\d+)"/g,
            attese: 1,
            dove: 'package.json → "version"',
        },
        {
            // Radice E packages[""]: la stessa forma, ancorata al NOME del
            // pacchetto che la precede. Ancorare al solo `"version"` sarebbe un
            // disastro — nel lockfile compare centinaia di volte, una per
            // dipendenza.
            file: 'package-lock.json',
            re: new RegExp('("name"\\s*:\\s*"' + nome + '",\\s*"version"\\s*:\\s*")\\d+\\.\\d+\\.\\d+(")', 'g'),
            reLeggi: new RegExp('"name"\\s*:\\s*"' + nome + '",\\s*"version"\\s*:\\s*"(\\d+\\.\\d+\\.\\d+)"', 'g'),
            attese: 2,
            dove: 'package-lock.json → "version" di radice E packages[""]',
        },
        {
            // L'ancora e' il MARKUP che contiene il numero, non la `v`: fra la
            // `v` e la cifra non c'e' confine di parola, e un `\b` non
            // troverebbe niente (trappola gia' costata una volta al cancello).
            file: 'login.html',
            re: /(<div class="lf-app">InfraNet Pro v)\d+\.\d+\.\d+(<\/div>)/,
            reLeggi: /<div class="lf-app">InfraNet Pro v(\d+\.\d+\.\d+)<\/div>/g,
            attese: 1,
            dove: 'login.html → <div class="lf-app">',
        },
    ];
}

function quante(testo, re) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    return (testo.match(g) || []).length;
}

// ── bump ──────────────────────────────────────────────────────────────────
function bump(versione) {
    if (!RE_SEMVER.test(versione)) {
        console.error('Versione non valida: "' + versione + '". Forma attesa x.y.z');
        return 1;
    }
    const pkg = JSON.parse(leggi('package.json'));
    const vecchia = pkg.version;
    console.log('\nVersione ' + vecchia + ' → ' + versione + '\n');

    // Primo giro: si CONTROLLA tutto, non si scrive niente. Un bump a meta' —
    // due file nuovi e due vecchi — e' lo stato che il cancello della versione
    // trova rosso senza sapere perche'.
    const lavoro = [];
    for (const p of posti(pkg.name)) {
        const testo = leggi(p.file);
        const n = quante(testo, p.re);
        if (n !== p.attese) {
            ko(p.dove + ': trovate ' + n + ' occorrenze, ne aspettavo ' + p.attese);
            console.error('\nNiente scritto. O il file e\' cambiato di forma (aggiorna l\'ancora QUI, '
                + 'non toglierla) o stai lanciando lo script fuori dalla radice del progetto.');
            return 1;
        }
        lavoro.push({ p, testo });
    }
    for (const { p, testo } of lavoro) {
        scrivi(p.file, testo.replace(p.re, '$1' + versione + '$2'));
        ok(p.dove + (p.attese > 1 ? ' (' + p.attese + ' campi)' : ''));
    }

    console.log('\nRestano a te, perche\' sono scelte e non misure:');
    nota('la sezione `## [' + versione + ']` nel CHANGELOG (senza, `check` e\' ROSSO)');
    nota('il banner della versione nel README, se questa versione lo cambia');
    nota('copertina e colofone dei due manuali (repo privato) + PDF rigenerati');
    console.log('');
    return 0;
}

// ── I numeri dichiarati nel README ────────────────────────────────────────
// Tre citazioni dello stesso numero (targhetta, indirizzo della targhetta, riga
// del capitolo Testing) piu' quella dell'e2e. Si leggono tutte: due copie di un
// numero divergono sempre, e qui le copie sono tre.
function numeriDelReadme() {
    const R = leggi('README.md');
    const num = (s) => Number(String(s).replace(/[,.]/g, ''));
    const badgeUrl = R.match(/badge\/tests-([^%]*(?:%[0-9A-Fa-f]{2}[^%]*)*?)%20/);
    const dichiarati = {
        badgeAlt: R.match(/alt="([\d,.]+) tests, 0 failing"/),
        badgeUrl: badgeUrl ? [badgeUrl[0], decodeURIComponent(badgeUrl[1])] : null,
        testing: R.match(/currently \*\*([\d,.]+) tests, 0 failing\*\*/),
    };
    const mancanti = Object.keys(dichiarati).filter((k) => !dichiarati[k]);
    const valori = Object.keys(dichiarati)
        .filter((k) => dichiarati[k])
        .map((k) => ({ dove: k, n: num(dichiarati[k][1]) }));
    const e2e = R.match(/\*\*(\d+) flows\*\*/);
    return { valori, mancanti, e2e: e2e ? Number(e2e[1]) : null };
}

// ── check ─────────────────────────────────────────────────────────────────
function misuraSuite() {
    console.log('  … lancio la suite (`node --test --test-concurrency=1`), ci mette qualche minuto');
    const res = spawnSync(process.execPath, ['--test', '--test-concurrency=1'], {
        cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
    });
    const out = (res.stdout || '') + (res.stderr || '');
    // Il sommario cambia glifo fra reporter (`ℹ` allo spec, `#` al tap): si
    // aggancia la PAROLA, non il segno che la precede.
    const campo = (nome) => {
        const m = out.match(new RegExp('^\\s*\\S?\\s*' + nome + '\\s+(\\d+)\\s*$', 'm'));
        return m ? Number(m[1]) : null;
    };
    return { totale: campo('tests'), falliti: campo('fail'), uscita: res.status, out };
}

function check(argv) {
    const rapido = argv.includes('--rapido');
    const pkg = JSON.parse(leggi('package.json'));
    const versione = argv.find((a) => RE_SEMVER.test(a)) || pkg.version;
    let rosso = 0;

    console.log('\nCancello di rilascio — versione ' + versione + '\n');

    // ① I quattro posti. Non si rifa' il confronto (ce l'ha la suite): si
    //    verifica solo che TUTTI dicano la versione che stiamo per taggare.
    for (const p of posti(pkg.name)) {
        const testo = leggi(p.file);
        const trovate = [...testo.matchAll(p.reLeggi)].map((m) => m[1]);
        const fuori = trovate.filter((v) => v !== versione);
        if (trovate.length !== p.attese || fuori.length) {
            ko(p.dove + ': ' + (trovate.length ? trovate.join(', ') : 'nessuna occorrenza')
                + ' invece di ' + versione);
            rosso++;
        } else ok(p.dove);
    }

    // ② Il CHANGELOG. La 2.7.2 non ha mai avuto la sua sezione, e nessuno se
    //    n'e' accorto finche' non e' stata cercata un anno dopo.
    // ⚠️ La sezione si ritaglia per INDICI, non con un lookahead `(?=\n##\s|$)`:
    // con il flag `m` quel `$` vale a fine RIGA, quindi il corpo veniva tagliato
    // subito dopo il titolo e una sezione piena risultava vuota. Provato sul caso
    // vero — la 2.11.9, che le voci ce l'ha — e la prima stesura la dava ROSSA.
    const cl = leggi('CHANGELOG.md');
    const inizio = cl.search(new RegExp('^##\\s*\\[' + versione.replace(/\./g, '\\.') + '\\]', 'm'));
    const dopo = inizio < 0 ? -1 : cl.slice(inizio + 1).search(/\n##\s/);
    const corpo = inizio < 0 ? '' : cl.slice(inizio, dopo < 0 ? undefined : inizio + 1 + dopo);
    if (inizio < 0) {
        ko('CHANGELOG.md: manca la sezione `## [' + versione + ']`');
        rosso++;
    } else if (!corpo.split('\n').some((r) => /^\s*[-*]\s+\S/.test(r))) {
        ko('CHANGELOG.md: la sezione `## [' + versione + ']` c\'e\' ma non elenca niente');
        rosso++;
    } else ok('CHANGELOG.md: la sezione c\'e\' e ha voci');

    // ③ I numeri del README. Prima la coerenza fra le copie, poi la misura.
    const { valori, mancanti, e2e } = numeriDelReadme();
    if (mancanti.length) {
        // ⚠️ Una prova che non trova niente passa: qui deve ARROSSIRE, o diventa
        // un cancello che non guarda piu' nessuno.
        ko('README: non trovo piu\' ' + mancanti.join(', ') + ' — la frase e\' stata riscritta? '
            + 'Aggiorna l\'ancora in tools/release.js, non toglierla');
        rosso++;
    }
    const distinti = [...new Set(valori.map((v) => v.n))];
    if (distinti.length > 1) {
        ko('README: il conteggio dei test e\' citato con numeri diversi — '
            + valori.map((v) => v.dove + '=' + v.n).join(', '));
        rosso++;
    } else if (distinti.length === 1) ok('README: le ' + valori.length + ' citazioni del conteggio dicono tutte ' + distinti[0]);

    if (rapido) {
        nota('suite NON rilanciata (--rapido): il conteggio dei test resta NON verificato');
    } else {
        const s = misuraSuite();
        if (s.uscita !== 0 || s.falliti) {
            ko('la suite non e\' verde (' + (s.falliti == null ? 'uscita ' + s.uscita : s.falliti + ' falliti')
                + '): non si tagga su un rosso');
            // Un cancello che dice solo «rosso» costringe a rilanciare la suite
            // per sapere cosa: i nomi delle prove cadute li ha gia' in mano.
            const caduti = s.out.split('\n').filter((r) => /^\s*(?:✖|not ok)\s/.test(r)).slice(0, 12);
            if (caduti.length) console.log(caduti.map((r) => '      ' + r.trim()).join('\n'));
            rosso++;
        } else if (s.totale == null) {
            ko('non riesco a leggere il sommario di `node --test`: il conteggio resta non verificato');
            rosso++;
        } else {
            ok('suite verde — ' + s.totale + ' test, 0 falliti');
            if (distinti.length === 1 && distinti[0] !== s.totale) {
                ko('il README dice ' + distinti[0] + ' test, ne conto ' + s.totale
                    + ' — e\' un numero MISURATO: riscrivilo nelle ' + valori.length + ' citazioni');
                rosso++;
            } else if (distinti.length === 1) ok('il numero del README e\' quello vero');
        }
    }

    // ④ Quello che lo script NON sa. Dichiarato, non nascosto.
    console.log('\nA mano, perche\' da qui non si misurano:');
    nota('pagine dei manuali (repo privato): `pdftotext X.pdf - | tr -cd \'\\f\' | wc -c` — ⛔ senza aggiungere 1');
    nota('e2e: il README dichiara ' + (e2e == null ? '(citazione non trovata)' : e2e + ' flows')
        + ' — si misura con `RUN_E2E=1 node --test test/e2e/critical-flows.test.js`');
    // ⚠️ Trappola della stessa famiglia del form-feed di pdftotext: il sommario
    // dice UNO in piu' dei flussi, perche' conta anche il test-contenitore che
    // li racchiude. Chi legge 121 e «corregge» il README ha appena scritto un
    // numero falso credendo di rimisurarlo.
    nota('  ⛔ quel sommario stampa ' + (e2e == null ? 'N+1' : e2e + 1) + ': conta anche il test CONTENITORE. '
        + 'I flussi sono i sottotest — non correggere il README a ' + (e2e == null ? 'N+1' : String(e2e + 1)));
    nota('il tag va sull\'ULTIMO commit della versione, e la CI dev\'essere verde SU QUEL COMMIT');

    console.log('\n' + (rosso ? 'ROSSO: ' + rosso + ' cose da sistemare prima del tag.\n'
        : 'Verde. Quello che questo script poteva misurare, torna.\n'));
    return rosso ? 1 : 0;
}

// ── ingresso ──────────────────────────────────────────────────────────────
if (require.main === module) {
    const [, , comando, ...resto] = process.argv;
    if (comando === 'bump') process.exit(bump(resto[0] || ''));
    else if (comando === 'check') process.exit(check(resto));
    else {
        console.log('\nuso:\n'
            + '  node tools/release.js bump <x.y.z>     scrive la versione nei quattro posti\n'
            + '  node tools/release.js check [x.y.z]    il cancello prima del tag\n'
            + '  node tools/release.js check --rapido   senza rilanciare la suite\n');
        process.exit(2);
    }
}

module.exports = { posti, numeriDelReadme };
