import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, mirror } from './helpers.js';
import { findWave3Setups, pickSetups } from '../src/scan/wave3.js';
import { openViews } from '../src/scan/conflict.js';
import { detect } from '../src/scan/scanner.js';
import { backtestCoin } from '../src/backtest/engine.js';
import { snapshot } from '../src/watch/track.js';

// 0 = 99,7 · 1 = 130,3 · A = 114,7 onaylı · B oluşuyor (122,3'e kadar geldi), C henüz yok.
const B_PATH = [[0, 120], [20, 100], [40, 130], [52, 115], [60, 122]];
const OPTS = { sensitivities: [4.5], subDivisors: [2], entryType: 'zone', direction: 'both', zoneFrontAtr: 0, approachAtr: 0, minRR: 0 };
const ON = { ...OPTS, w3FormingB: true };
const forming = (candles, o, live = null) => findWave3Setups(candles, o, live).filter((s) => s.phase === 'forming');

test('kapalıyken B oluşan kurulum yok, açıkken var', () => {
  const c = build(B_PATH);
  assert.equal(forming(c, OPTS).length, 0);
  const [s, ...rest] = forming(c, ON);
  assert.equal(rest.length, 0);
  assert.equal(s.bForming, true);
  assert.equal(s.direction, 'long');
  assert.equal(s.points.cNow, null);
  assert.equal(s.stateLabel, 'B oluşuyor');
  assert.equal(s.cDone, false);
  assert.equal(s.abc.A.price, 114.7);
  assert.ok(Math.abs(s.abc.B.price - 122.3) < 1e-9);
  assert.ok(Math.abs(s.zone.lvC - (122.3 - 1.272 * 15.6)) < 1e-9);
  assert.ok(Math.abs(s.zone.lvR - (130.3 - 0.618 * 30.6)) < 1e-9);
  assert.equal(s.zone.state, 'waiting');
});

test('B yükselince C seviyesi de yükselir', () => {
  const low = forming(build([[0, 120], [20, 100], [40, 130], [52, 115], [58, 120]]), ON)[0];
  const high = forming(build(B_PATH), ON)[0];
  assert.ok(high.abc.B.price > low.abc.B.price);
  assert.ok(high.zone.lvC > low.zone.lvC);
});

test('short aynası', () => {
  const [s] = forming(mirror(build(B_PATH), 260), ON);
  assert.equal(s.bForming, true);
  assert.equal(s.direction, 'short');
  assert.ok(Math.abs(s.abc.B.price - (260 - 122.3)) < 1e-9);
});

test('canlı mum oluşan B\'yi geçerse B onun ucu olur, geçmezse B aynı kalır', () => {
  const c = build(B_PATH);
  const live = (high) => ({ time: 60 * 3600e3, open: 122, close: 121.5, high, low: 121, volume: 1, confirmed: false });
  const [up] = forming(c, ON, live(123));
  assert.equal(up.abc.B.price, 123);
  assert.equal(up.abc.B.i, c.length - 1);
  assert.ok(Math.abs(up.zone.lvC - (123 - 1.272 * 15.6)) < 1e-9);
  const [same] = forming(c, ON, live(122));
  assert.ok(Math.abs(same.abc.B.price - 122.3) < 1e-9);
});

test('onaylı B varsa sonuç seçenekten etkilenmez', () => {
  const c = build([[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [66, 112]]);
  const off = forming(c, OPTS), on = forming(c, ON);
  assert.equal(on.length, 1);
  assert.equal(on[0].bForming, false);
  assert.deepEqual(JSON.stringify(on), JSON.stringify(off));
});

test('B kırılımı girişinde B oluşan kurulum listelenmez', () => {
  const s = findWave3Setups(build(B_PATH), { ...ON, entryType: 'break' });
  assert.ok(!s.some((x) => x.bForming));
});

test('çelişen sayım: B oluşan kurulum başka modlara yansımaz', () => {
  const c = build(B_PATH);
  assert.ok(pickSetups(findWave3Setups(c, ON), ON).length > 0);
  const r = { coin: 'X', candles: c, longCandles: c, live: null };
  assert.deepEqual(openViews(r, { ...ON, mode: 'wave3' }).filter((v) => v.mode === 'wave3'), []);
});

test('sadece SMT\'li: B oluşan kurulum C ölçülene kadar gizli', () => {
  const c = build(B_PATH);
  const r = { coin: 'X', candles: c, longCandles: c, live: null };
  assert.ok(detect(r, { ...ON, mode: 'wave3' }).some((s) => s.bForming));
  r.views = null;
  assert.ok(!detect(r, { ...ON, mode: 'wave3', smtOnly: true }).some((s) => s.bForming));
});

test('takip kaydı: başlıkta B oluşuyor, B? etiketi, C noktası yok', () => {
  const c = build(B_PATH);
  const s = forming(c, ON)[0];
  const w = snapshot({ ...s, coin: 'X', instId: 'X-USDT' }, c, { tf: { id: '4H', ms: 3600e3 }, mode: 'wave3', now: 1 });
  assert.match(w.title, /B oluşuyor/);
  assert.ok(w.points.some((p) => p.label === 'B?'));
  assert.ok(!w.points.some((p) => p.label === 'C?'));
});

// Backtest 60. mumdan başlar: B bacağı bundan sonra oluşsun diye yol sağa kaydırıldı. 0 = bar 19, 1 = bar 49, A = bar 65, B = bar 74.
// Ana derece büyük: tepki A'yı ana derecede onaylamaz, dalga 2 sürer.
const BT_PATH = [[0, 120], [20, 100], [50, 130], [66, 115], [75, 121], [90, 110], [130, 85]];
const runBt = (opts) => {
  const c = build(BT_PATH);
  return backtestCoin(c, { from: c[0].time, to: c[c.length - 1].time, feePct: 0, opts: { ...OPTS, sensitivities: [7], subDivisors: [3], direction: 'long', ...opts } });
};

test('backtest: B yükselirken eski emir iptal olur, B bitince aynı işlem açılır', () => {
  const off = runBt({});
  const on = runBt({ w3FormingB: true });
  assert.ok(on.stats.orders > off.stats.orders, `emir: ${on.stats.orders} / ${off.stats.orders}`);
  assert.ok(on.stats.cancelled['zone:B kırıldı, bölgeye gelmedi'] > 0);
  assert.equal(on.trades.length, off.trades.length);
  assert.ok(off.trades.length > 0);
  // Stop tamponu emrin verildiği mumdaki ATR'den gelir; giriş ve sonuç aynı
  assert.deepEqual(on.trades.map((t) => [t.entry, t.R]), off.trades.map((t) => [t.entry, t.R]));
  assert.ok(on.trades[0].created < off.trades[0].created);
});

test('backtest: SMT filtresi açıkken B oluşan emir verilmez', () => {
  const off = runBt({ smtOnly: true });
  const on = runBt({ smtOnly: true, w3FormingB: true });
  assert.equal(on.stats.orders, off.stats.orders);
});
