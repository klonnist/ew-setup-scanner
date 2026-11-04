import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenarioPaths, SCENARIO_AHEAD } from '../src/scan/scenario.js';

const LIMIT = { entryKind: 'limit', legs: [100], stop: 90, targets: [{ price: 120 }, { price: 140 }, { price: 160 }] };
const prices = (path) => path.map((p) => p.price);
const labels = (path) => path.map((p) => p.label);

test('limit bekleyen long: ana yol giriş → H1 → H2, alternatif giriş → stop → iptal', () => {
  const s = scenarioPaths(LIMIT, 1, 110);
  assert.deepEqual(prices(s.main), [110, 100, 120, 140]);
  assert.deepEqual(labels(s.main), ['', 'giriş', 'H1', 'H2']);
  assert.deepEqual(prices(s.alt), [110, 100, 90, 85]); // iptal = stop − 0,5 × risk
  assert.deepEqual(labels(s.alt), ['', 'giriş', 'stop', 'iptal']);
});

test('short ayna: yollar ters yönde, etiketler yön tarafında', () => {
  const plan = { entryKind: 'limit', legs: [100], stop: 110, targets: [{ price: 80 }, { price: 60 }] };
  const s = scenarioPaths(plan, -1, 90);
  assert.deepEqual(prices(s.main), [90, 100, 80, 60]);
  assert.deepEqual(prices(s.alt), [90, 100, 110, 115]);
  assert.equal(s.main.at(-1).above, false);
  assert.equal(s.alt.at(-1).above, true);
});

test('kademeli emir: giriş adımı ortalama seviye', () => {
  const s = scenarioPaths({ ...LIMIT, legs: [104, 96] }, 1, 110);
  assert.equal(s.main[1].price, 100);
});

test('girilmiş işlem: giriş adımı atlanır, geride kalan hedefler çizilmez', () => {
  const s = scenarioPaths({ ...LIMIT, entryKind: 'market' }, 1, 125);
  assert.deepEqual(prices(s.main), [125, 140, 160]);
  assert.deepEqual(labels(s.main), ['', 'H1', 'H2']);
  assert.deepEqual(prices(s.alt).slice(0, 2), [125, 90]);
});

test('takip listesi: limit plan dolmuşsa entered ile girilmiş sayılır', () => {
  const s = scenarioPaths(LIMIT, 1, 105, true);
  assert.deepEqual(labels(s.main), ['', 'H1', 'H2']);
});

test('çizilecek yol yoksa null', () => {
  assert.equal(scenarioPaths(null, 1, 100), null);
  assert.equal(scenarioPaths({ ...LIMIT, legs: [] }, 1, 110), null);
  assert.equal(scenarioPaths(LIMIT, 1, 85), null); // fiyat stopun altında
  assert.equal(scenarioPaths({ ...LIMIT, entryKind: 'market' }, 1, 170), null); // tüm hedefler geride
  assert.equal(scenarioPaths({ ...LIMIT, targets: [] }, 1, 110), null);
});

test('yollar grafiğin ayırdığı boş mumlara sığar', () => {
  const s = scenarioPaths(LIMIT, 1, 110);
  for (const p of [...s.main, ...s.alt]) assert.ok(p.k <= SCENARIO_AHEAD);
});
