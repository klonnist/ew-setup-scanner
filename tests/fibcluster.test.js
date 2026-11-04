import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, mirror } from './helpers.js';
import { fibPairOf, findFibClusters, FIB_DEFAULTS } from '../src/scan/fibcluster.js';
import { activePlans, findWave3Setups } from '../src/scan/wave3.js';
import { backtestCoin } from '../src/backtest/engine.js';
import { snapshot } from '../src/watch/track.js';

const pt = (price) => ({ price });
const O = { ...FIB_DEFAULTS };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('elle hesap: 0 = 100, 1 = 200, A = 160, B = 190, ATR = 2 → %61,8 = 138,2; C = 139,12; orta 138,66', () => {
  const p = fibPairOf(pt(100), pt(200), pt(160), pt(190), 2, O);
  near(p.lvR, 138.2);
  near(p.lvC, 190 - 1.272 * 40);
  near(p.mid, (138.2 + 139.12) / 2);
  near(p.bRet, 0.75);
  assert.equal(p.r, 0.618);
  assert.equal(p.e, 1.272);
});

test('short ayna', () => {
  const p = fibPairOf(pt(200), pt(100), pt(140), pt(110), 2, O);
  near(p.lvR, 161.8);
  near(p.lvC, 110 + 1.272 * 40);
});

test('red: fark toleransı, küçük itki, B aralığı, A yönü', () => {
  assert.equal(fibPairOf(pt(100), pt(200), pt(160), pt(190), 1, O), null, 'fark 0,92 > 0,5 ATR');
  assert.equal(fibPairOf(pt(100), pt(200), pt(160), pt(190), 40, O), null, 'itki 2,5 ATR < 3');
  assert.equal(fibPairOf(pt(100), pt(200), pt(160), pt(170), 2, O), null, "B, A'nın %25'i");
  assert.equal(fibPairOf(pt(100), pt(200), pt(160), pt(210), 2, O), null, "B, A'nın %125'i");
  assert.equal(fibPairOf(pt(100), pt(200), pt(210), pt(205), 2, O), null, 'A itkiye ters değil');
});

test("red: bölge A'nın ötesinde ve itkinin başından önce olmalı", () => {
  const wide = { ...O, fibTolAtr: 9 };
  // %61,8 = 138,2 · C = 200 − 1,272 × 85 = 91,88 · orta 115,04: A (115) henüz geçilmiyor
  assert.equal(fibPairOf(pt(100), pt(200), pt(115), pt(200), 10, wide), null);
  // %61,8 = 138,2 · C = 150 − 1,272 × 90 = 35,52 · orta 86,86: itkinin başı (100) geçiliyor
  assert.equal(fibPairOf(pt(100), pt(200), pt(110), pt(150), 20, wide), null);
});

test('tüm çiftler seçeneği: 0,618 × 1,272 tutmayan kurulum başka çiftle geçer', () => {
  // %61,8 = 138,2 · B − 1,272 × A = 195 − 44,52 = 150,48 (fark 6 ATR) · B − 1,618 × A = 138,37
  const args = [pt(100), pt(200), pt(165), pt(195), 2];
  assert.equal(fibPairOf(...args, O), null);
  const p = fibPairOf(...args, { ...O, fibPairs: 'all' });
  assert.equal(p.r, 0.618);
  assert.equal(p.e, 1.618);
});

test('tüm çiftlerde 0,618 × 1,272 öncelikli', () => {
  const p = fibPairOf(pt(100), pt(200), pt(160), pt(190), 2, { ...O, fibPairs: 'all', fibTolAtr: 9 });
  assert.equal(p.r, 0.618);
  assert.equal(p.e, 1.272);
});

// 0 = 99,7, 1 = 200,3, A = 159,7, B = 190,3 (±0,3 fitil). L = 100,6 · %61,8 = 138,13 · C = 190,3 − 1,272 × 40,6 = 138,66
const IMPULSE = [[0, 130], [20, 100], [50, 200], [62, 160], [72, 190]];
const FORMING = build([...IMPULSE, [80, 165]]);
const OPTS = { direction: 'both', fibSens: [4], fibTolAtr: 2, zoneFrontAtr: 0, approachAtr: 0 };

test('C oluşurken kurulum: limit emir, stop %88,6, hedefler itki ucu ve +0,272', () => {
  const list = findFibClusters(FORMING, OPTS);
  assert.equal(list.length, 1);
  const s = list[0];
  assert.equal(s.kind, 'fib');
  assert.equal(s.direction, 'long');
  assert.equal(s.phase, 'forming');
  assert.equal(s.cDone, false);
  assert.equal(s.zone.state, 'waiting');
  assert.equal(s.zone.perfect, true);
  const L = 200.3 - 99.7;
  near(s.fib.lvR, 200.3 - 0.618 * L);
  near(s.fib.lvC, 190.3 - 1.272 * (200.3 - 159.7));
  near(s.zone.entry, (s.fib.lvR + s.fib.lvC) / 2);
  near(s.zone.targets[0].price, 200.3);
  near(s.zone.targets[1].price, 200.3 + 0.272 * L, 1e-6);
  assert.ok(s.zone.stop < 200.3 - 0.886 * L, 'stop %88,6 + tampon');
  assert.equal(activePlans(s, { ...OPTS, entryType: 'zone' }).length, 1);
});

test('stop seçeneği: itkinin başı', () => {
  const s = findFibClusters(FORMING, { ...OPTS, fibStop: 'w0' })[0];
  assert.ok(s.zone.stop < 99.7);
  assert.ok(s.zone.stop > 99.7 - 5);
});

test('short: aynalı mumlarda aynı kurulum', () => {
  const s = findFibClusters(mirror(FORMING, 300), OPTS)[0];
  assert.equal(s.direction, 'short');
  near(s.zone.targets[0].price, 300 - 200.3, 1e-6);
});

test('yön ayarı uygulanır', () => {
  assert.equal(findFibClusters(FORMING, { ...OPTS, direction: 'short' }).length, 0);
  assert.equal(findFibClusters(FORMING, { ...OPTS, direction: 'long' }).length, 1);
});

test('fiyat bölgeye girince doldu, C onaylanınca listede kalır', () => {
  const filled = findFibClusters(build([...IMPULSE, [90, 136]]), OPTS)[0];
  assert.equal(filled.zone.state, 'filled');
  const done = findFibClusters(build([...IMPULSE, [90, 136], [100, 165]]), OPTS).find((x) => x.cDone);
  assert.ok(done, 'C onaylı pencere');
  assert.equal(done.zone.state, 'filled');
  assert.equal(activePlans(done, { ...OPTS, entryType: 'zone' }).length, 1);
});

test('bölgeye gelmeden dönerse kaçtı: aktif plan yok', () => {
  const list = findFibClusters(build([...IMPULSE, [80, 150], [110, 210]]), OPTS);
  const s = list.find((x) => x.points.p1.price === 200.3);
  assert.ok(s);
  assert.equal(s.zone.state, 'missed');
  assert.equal(activePlans(s, { ...OPTS, entryType: 'zone' }).length, 0);
});

test("dalga-3'ün reddettiği kurulumu kabul eder (süre şartı ve Elliott kuralı yok)", () => {
  // Düzeltme dalga 1'den kısa: dalga-3 modunda emir aktif olmaz; fib modunda hemen aktif
  const fib = findFibClusters(FORMING, OPTS)[0];
  assert.equal(fib.zone.pendingTime, false);
  assert.equal(fib.zone.activeFrom, null);
  const w3 = findWave3Setups(FORMING, { sensitivities: [4], entryType: 'zone', direction: 'both', minRR: 0 }).filter((s) => s.phase === 'forming' && !s.zone?.pendingTime);
  assert.equal(w3.length, 0);
});

test('takip kaydı: limit plan, A ve B anahtarda', () => {
  const s = { ...findFibClusters(FORMING, OPTS)[0], coin: 'X', instId: 'X-USDT' };
  const snap = snapshot(s, FORMING, { tf: { id: '4H', ms: 3600e3 }, mode: 'fib', now: 1 });
  assert.match(snap.key, /\|fib\|long\|/);
  assert.equal(snap.plans.length, 1);
  assert.equal(snap.plans[0].type, 'zone');
  assert.equal(snap.plans[0].entryKind, 'limit');
  assert.equal(snap.points[0].label, 'İtki başı');
});

test('backtest: fib modunda limit emir dolar, H1 itki ucunda kapanır', () => {
  const candles = build([...IMPULSE, [90, 136], [130, 210]]);
  const { trades } = backtestCoin(candles, {
    from: candles[60].time, to: candles[candles.length - 1].time, exitTarget: 0,
    opts: { ...OPTS, mode: 'fib', entryType: 'break' }, // giriş tipi ayarı fib modunda etkisiz
  });
  assert.ok(trades.length >= 1);
  const t = trades.find((x) => Math.abs(x.target - 200.3) < 1e-6);
  assert.ok(t, 'H1 = itki ucu');
  assert.equal(t.type, 'zone');
  assert.equal(t.dir, 'long');
  assert.equal(t.outcome, 'hedef');
});
