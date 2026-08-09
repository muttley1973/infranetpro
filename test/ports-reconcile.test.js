// Test per la riconciliazione conteggio-porte (lib/ports-reconcile.js).
// Manual-first: senza pin la misura piu' alta alza `ports` (ombra in `portsReal`);
// col pin `portsManual` il dichiarato e' legge e la misura diventa una PROPOSTA
// in `portsMeasured`. Invariante ai due rami: mai ridurre su walk parziale.
const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcilePortCount } = require('../lib/ports-reconcile.js');

// Riproduzione FEDELE del vecchio comportamento in-place (src/app-snmp.js prima di
// P5), per certificare che il ramo NON pinnato resti identico byte-per-byte.
function legacyApply(n, measured) {
  if (measured > 0) {
    const declared = n.ports || 0;
    if (measured > declared) { n.ports = measured; if (declared) n.portsReal = declared; }
    else if (n.portsReal) delete n.portsReal;
  }
  return n;
}
// Applica il delta puro come fa src/app-snmp.js dopo P5.
function apply(n, measured) {
  const res = reconcilePortCount({ declared: n.ports || 0, measured, pinned: !!n.portsManual });
  if (res) {
    n.ports = res.ports;
    if (res.portsReal == null) delete n.portsReal; else n.portsReal = res.portsReal;
    if (res.portsMeasured == null) delete n.portsMeasured; else n.portsMeasured = res.portsMeasured;
  }
  return n;
}

test('non pinnato, misura > dichiarato: alza ports, dichiarato in ombra (portsReal)', () => {
  const r = reconcilePortCount({ declared: 24, measured: 28, pinned: false });
  assert.deepEqual(r, { ports: 28, portsReal: 24, portsMeasured: null });
});

test('non pinnato, misura <= dichiarato: non alza, niente ombra', () => {
  assert.deepEqual(reconcilePortCount({ declared: 24, measured: 24, pinned: false }),
    { ports: 24, portsReal: null, portsMeasured: null });
  assert.deepEqual(reconcilePortCount({ declared: 48, measured: 24, pinned: false }),
    { ports: 48, portsReal: null, portsMeasured: null });
});

test('non pinnato, nessun dichiarato (0/undefined): la misura diventa il conteggio, niente ombra', () => {
  assert.deepEqual(reconcilePortCount({ declared: 0, measured: 8, pinned: false }),
    { ports: 8, portsReal: null, portsMeasured: null });
});

test('PINNATO, misura > dichiarato: tiene ports, misura come PROPOSTA (portsMeasured)', () => {
  const r = reconcilePortCount({ declared: 24, measured: 28, pinned: true });
  assert.deepEqual(r, { ports: 24, portsReal: null, portsMeasured: 28 });
});

test('PINNATO, misura <= dichiarato: tiene ports, nessuna proposta', () => {
  assert.deepEqual(reconcilePortCount({ declared: 24, measured: 24, pinned: true }),
    { ports: 24, portsReal: null, portsMeasured: null });
  assert.deepEqual(reconcilePortCount({ declared: 24, measured: 12, pinned: true }),
    { ports: 24, portsReal: null, portsMeasured: null });
});

test('nessuna misura (0 interfacce): ritorna null → il nodo resta intatto', () => {
  assert.equal(reconcilePortCount({ declared: 24, measured: 0, pinned: false }), null);
  assert.equal(reconcilePortCount({ declared: 24, measured: 0, pinned: true }), null);
});

test('mai ridurre: un walk parziale (meno interfacce) non intacca il conteggio, pinnato o no', () => {
  assert.equal(apply({ ports: 48 }, 24).ports, 48);
  assert.equal(apply({ ports: 48, portsManual: true }, 24).ports, 48);
});

test('parita col comportamento storico sul ramo NON pinnato (nessuna regressione)', () => {
  const cases = [
    { ports: 24 }, { ports: 48 }, { ports: 8 }, { ports: 0 }, {},
    { ports: 24, portsReal: 20 },   // ombra pregressa che deve sparire se misura<=dichiarato
  ];
  const measures = [0, 1, 8, 24, 28, 52];
  for (const base of cases) {
    for (const m of measures) {
      const a = apply({ ...base }, m);
      const b = legacyApply({ ...base }, m);
      assert.deepEqual(a, b, `divergenza su base=${JSON.stringify(base)} measured=${m}`);
    }
  }
});

test('igiene: aggiungere il pin poi misurare pulisce una vecchia ombra portsReal', () => {
  // Nodo che in passato (non pinnato) aveva accumulato portsReal; ora e' pinnato.
  const n = apply({ ports: 24, portsReal: 20, portsManual: true }, 28);
  assert.equal(n.ports, 24);
  assert.equal(n.portsReal, undefined);   // l'ombra non-pinnata sparisce
  assert.equal(n.portsMeasured, 28);      // subentra la proposta pinnata
});

test('adozione simulata: il conteggio adottato = misura, la proposta si azzera al giro dopo', () => {
  // Dopo che l'utente adotta (ports=28, portsManual resta true), un nuovo giro SNMP
  // con la stessa misura non deve ri-proporre nulla.
  const n = { ports: 28, portsManual: true };
  apply(n, 28);
  assert.equal(n.ports, 28);
  assert.equal(n.portsMeasured, undefined);
});
