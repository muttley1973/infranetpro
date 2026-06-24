'use strict';
// Test della geometria onda per i collegamenti wireless (lib/wave-path.js).
const test = require('node:test');
const assert = require('node:assert');
const { buildWavePath } = require('../lib/wave-path.js');

function points(d) {
  // estrae le coppie numeriche dai comandi M/L
  return d.replace(/[ML]/g, ' ').trim().split(/\s+/).map(Number)
    .reduce((acc, n, i) => { if (i % 2 === 0) acc.push([n]); else acc[acc.length - 1].push(n); return acc; }, []);
}

test('estremi esatti: il path parte e finisce sui due punti', () => {
  const d = buildWavePath(0, 0, 100, 0);
  const pts = points(d);
  assert.deepEqual(pts[0], [0, 0], 'primo punto = (x1,y1)');
  assert.deepEqual(pts[pts.length - 1], [100, 0], 'ultimo punto = (x2,y2)');
});

test('estremi esatti anche in diagonale', () => {
  const d = buildWavePath(10, 20, 130, 90);
  const pts = points(d);
  assert.deepEqual(pts[0], [10, 20]);
  assert.deepEqual(pts[pts.length - 1], [130, 90]);
});

test('oscilla: almeno un punto si discosta dalla retta (ampiezza > 0)', () => {
  const d = buildWavePath(0, 0, 100, 0, { amplitude: 8 });
  const pts = points(d);
  const maxOff = Math.max(...pts.map(p => Math.abs(p[1])));   // retta y=0 → offset = |y|
  assert.ok(maxOff > 4, `attesa oscillazione percettibile, max offset ${maxOff}`);
  assert.ok(maxOff <= 8.01, 'offset non supera l ampiezza');
});

test('molti campioni (linea fluida, non 2 punti)', () => {
  const d = buildWavePath(0, 0, 160, 0, { wavelength: 16 });
  assert.ok(points(d).length >= 20, 'attesi molti campioni per un onda fluida');
});

test('segmento degenere → linea dritta valida', () => {
  const d = buildWavePath(5, 5, 5, 5);
  assert.match(d, /^M 5 5 L 5 5$/);
});

test('output è un path SVG valido (inizia con M)', () => {
  assert.match(buildWavePath(0, 0, 50, 50), /^M /);
});
