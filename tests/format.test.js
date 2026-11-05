import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveTxt, levelCell } from '../src/ui/format.js';
import { planEntry } from '../src/watch/track.js';
import { watchCard } from '../src/ui/watchView.js';
import { nearTargets, widenRange } from '../src/ui/chart.js';

test('moveTxt: long, hedef + ve stop −', () => {
  assert.equal(moveTxt(100, 108, 1), '+%8,0');
  assert.equal(moveTxt(100, 96, 1), '−%4,0');
});

test('moveTxt: short, fiyatın düşmesi kazanç', () => {
  assert.equal(moveTxt(100, 92, -1), '+%8,0');
  assert.equal(moveTxt(100, 104, -1), '−%4,0');
});

test('moveTxt: %1 altı iki hane, geçersiz değer boş', () => {
  assert.equal(moveTxt(100, 100.5, 1), '+%0,50');
  assert.equal(moveTxt(100, undefined, 1), '');
  assert.equal(moveTxt(undefined, 100, 1), '');
  assert.equal(moveTxt(0, 100, 1), '');
});

test('levelCell: renk yöne göre, hedef yoksa yalnızca tire', () => {
  assert.match(levelCell(100, 108, 1, 100), /class="pos">\+%8,0</);
  assert.match(levelCell(100, 96, 1, 100), /class="neg">−%4,0</);
  assert.equal(levelCell(100, undefined, 1, 100), '–');
});

test('planEntry: dolduysa gerçekleşen, dolmadıysa emirlerin ortalaması', () => {
  const p = { legs: [100, 90] };
  assert.equal(planEntry(p), 95);
  assert.equal(planEntry(p, { entry: null }), 95);
  assert.equal(planEntry(p, { entry: 100 }), 100);
});

test('takip kartı: yüzdeler girişten, short yönüne göre', () => {
  const item = {
    id: 'x', coin: 'BTC', tf: '4H', mode: 'wave3', d: -1, direction: 'short', savedAt: Date.now(), priceAtSave: 100, title: 't',
    plans: [{ type: 'zone', entryKind: 'limit', legs: [100], stop: 110, targets: [{ name: 'H1', price: 90 }, { name: 'H2', price: 80 }] }],
  };
  const html = watchCard(item, null, { selected: false, price: 100 });
  assert.match(html, /−%10,0/);
  assert.match(html, /\+%10,0/);
  assert.match(html, /\+%20,0/);
});

test('nearTargets: girişin ötesindeki en yakın iki hedef, short dahil', () => {
  const T = [{ price: 130 }, { price: 110 }, { price: 95 }, { price: 120 }];
  assert.deepEqual(nearTargets(100, T, 1), [110, 120]);
  assert.deepEqual(nearTargets(100, T, -1), [95]);
  assert.deepEqual(nearTargets(undefined, T, 1), []);
  assert.deepEqual(nearTargets(100, undefined, 1), []);
});

test('widenRange: stop ve hedef ölçeğe girer, geçersiz değerler atlanır', () => {
  const info = { priceRange: { minValue: 100, maxValue: 110 }, margins: { above: 1, below: 1 } };
  assert.deepEqual(widenRange(info, [95, 120, null, undefined, NaN]).priceRange, { minValue: 95, maxValue: 120 });
  assert.deepEqual(widenRange(info, [105]).priceRange, { minValue: 100, maxValue: 110 });
  assert.equal(widenRange(info, [105]).margins.above, 1);
  assert.equal(widenRange(null, [1]), null);
  assert.equal(widenRange(info, []), info);
});
