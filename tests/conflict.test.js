import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from './helpers.js';
import { openViews, tagConflicts } from '../src/scan/conflict.js';
import { detect } from '../src/scan/scanner.js';
import { DEFAULTS } from '../src/scan/wave3.js';

const views = [
  { mode: 'diagonal', label: 'Diagonal', direction: 'short' },
  { mode: 'wave3', label: 'Dalga-3', direction: 'short' },
  { mode: 'triangle', label: 'Üçgen', direction: 'long' },
];

test('Çelişki: ters yön etiketlenir (aynı modun başka derecesi dahil), aynı yön etiketlenmez', () => {
  const [l, s] = tagConflicts([{ direction: 'long' }, { direction: 'short' }], views, 'wave3');
  assert.deepEqual(l.conflicts.map((v) => v.mode), ['diagonal', 'wave3']);
  assert.deepEqual(s.conflicts.map((v) => v.mode), ['triangle']);
});

test('Çelişki: üçgen modu kendi zıt kırılım yönünü saymaz, başka modları sayar', () => {
  const [s] = tagConflicts([{ direction: 'short' }], views, 'triangle');
  assert.deepEqual(s.conflicts, []);
  const [l] = tagConflicts([{ direction: 'long' }], views, 'triangle');
  assert.deepEqual(l.conflicts.map((v) => v.mode), ['diagonal', 'wave3']);
});

test('Çelişki: görünümler önbelleklenir, yalnızca mod değişince yeniden hesaplanmaz', () => {
  const c = build([[0, 100], [40, 140], [60, 120], [80, 135], [100, 110], [140, 150], [160, 130]]);
  const r = { coin: 'X', candles: c, longCandles: c, live: null };
  const a = openViews(r, { ...DEFAULTS, mode: 'wave3' });
  assert.equal(openViews(r, { ...DEFAULTS, mode: 'diagonal' }), a);
  assert.notEqual(openViews(r, { ...DEFAULTS, mode: 'wave3', minRR: 9 }), a);
});

test('Çelişki: detect her kuruluma conflicts dizisi yazar, algılama değişmez', () => {
  const c = build([[0, 100], [40, 140], [60, 120], [80, 135], [100, 110], [140, 150], [160, 130]]);
  const r = { coin: 'X', candles: c, longCandles: c, live: null };
  const out = detect(r, { ...DEFAULTS, mode: 'wave3', entryType: 'both' });
  for (const s of out) assert.ok(Array.isArray(s.conflicts));
  assert.equal(JSON.stringify(out.map(({ conflicts, ...s }) => s)),
    JSON.stringify(detect({ ...r, views: undefined }, { ...DEFAULTS, mode: 'wave3', entryType: 'both' }).map(({ conflicts, ...s }) => s)));
});
