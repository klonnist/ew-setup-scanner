import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, mirror } from './helpers.js';
import { backtestScalp, summarizeScalp } from '../src/scalp/engine.js';
import { pivots, rangeAt, SCALP_DEFAULTS } from '../src/scalp/detect.js';
import { atr } from '../src/data/indicators.js';

// 100–110 arası olgun range, sonra küçük bir iç tepe (≈103,5), alt low süpürülür (≈98,6) ve fiyat geri döner.
const RANGE = [[0, 105], [10, 110], [20, 100], [30, 110], [40, 100], [50, 110], [60, 100], [70, 109.5], [80, 100.5], [90, 109], [96, 102], [98, 103.5], [104, 98.6]];
const OPTS = { window: 60, minRR: 0.5, feePct: 0 };
const run = (path, extra = {}) => backtestScalp(build(path), { ...OPTS, ...extra });

test('süpürme → iç kırılım → range tepesi hedef: kârlı long, giriş süpürmeden sonra', () => {
  const r = run([...RANGE, [120, 112]]);
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.equal(t.d, 1);
  assert.equal(t.alts.A.outcome, 'hedef');
  assert.ok(t.alts.A.R > 0);
  assert.ok(t.entryTime > t.sweepTime);
  assert.ok(t.sweepPrice < t.rangeLow);
  assert.ok(t.entry > t.msbPrice && t.msbPrice > t.rangeLow);
  assert.ok(Math.abs(t.target - t.rangeHigh) < 1e-9);
  // B: yarısı TP1'de, yarısı hedefte
  const exp = 0.5 * t.tp1R + 0.5 * t.alts.A.R;
  assert.ok(Math.abs(t.alts.B.R - exp) < 1e-9, `${t.alts.B.R} vs ${exp}`);
});

test('TP1 sonrası stopa dönüş: A −1R, B = ½·TP1R − ½, C = ½·TP1R (stop girişe)', () => {
  const r = run([...RANGE, [116, 109.6], [130, 90]]);
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.ok(t.alts.B.tp1, 'TP1 görülmeli');
  assert.equal(t.alts.A.outcome, 'stop');
  assert.ok(Math.abs(t.alts.A.R + 1) < 1e-9, `A = ${t.alts.A.R}`);
  assert.ok(Math.abs(t.alts.B.R - (0.5 * t.tp1R - 0.5)) < 1e-9);
  assert.ok(Math.abs(t.alts.C.R - 0.5 * t.tp1R) < 1e-9);
});

test('süpürmesiz, derin kırılım: işlem yok', () => {
  const r = run([...RANGE.slice(0, -1), [104, 92], [120, 100]]);
  assert.equal(r.trades.length, 0);
});

test('gelecek veri yok: giriş mumunda kesilen veri aynı girişi verir', () => {
  const candles = build([...RANGE, [120, 112]]);
  const full = backtestScalp(candles, OPTS).trades[0];
  const idx = candles.findIndex((c) => c.time === full.entryTime);
  const cut = backtestScalp(candles.slice(0, idx + 1), OPTS).trades[0];
  assert.ok(cut, 'kesik veride de giriş olmalı');
  assert.equal(cut.entry, full.entry);
  assert.equal(cut.stop, full.stop);
  assert.equal(cut.tp1, full.tp1);
});

test('pivot sağ mumları: son L mum pivot olamaz', () => {
  const candles = build([[0, 100], [10, 110], [13, 108]]);
  const p = pivots(candles, 3);
  assert.ok(p.hi.every((i) => i <= candles.length - 1 - 3));
});

test('short ayna: üst süpürme → short, aynı R', () => {
  const candles = build([...RANGE, [120, 112]]);
  const long = backtestScalp(candles, OPTS).trades[0];
  const short = backtestScalp(mirror(candles, 220), OPTS).trades[0];
  assert.equal(short.d, -1);
  assert.ok(Math.abs(short.alts.A.R - long.alts.A.R) < 1e-9);
});

test('komisyon R\'den düşülür ve özet tutarlı', () => {
  const free = run([...RANGE, [120, 112]]).trades;
  const paid = run([...RANGE, [120, 112]], { feePct: 0.1 }).trades;
  assert.ok(paid[0].alts.A.R < free[0].alts.A.R);
  const s = summarizeScalp(free, 'A');
  assert.equal(s.n, 1);
  assert.equal(s.winRate, 1);
  assert.ok(Math.abs(s.total - free[0].alts.A.R) < 1e-12);
});

test('yükselen kanal range sayılmaz (tepe/dip dokunuşları iç içe değil)', () => {
  // Dipler hep pencerenin başında, tepeler hep sonunda; yükseklik ve dokunuş sayısı range şartlarını sağlıyor
  const c = build([[0, 104], [6, 100], [12, 104.5], [18, 100.3], [24, 105], [30, 101.5], [36, 108], [42, 104], [48, 108.2], [54, 104.5], [60, 108.1], [66, 105], [72, 107.8], [76, 105.5]]);
  const A = atr(c.map((x) => x.high), c.map((x) => x.low), c.map((x) => x.close), 14);
  const o = { ...SCALP_DEFAULTS, window: 60 };
  assert.equal(rangeAt(c, pivots(c, 3), 76, A[75], o), null);
  // Aynı pencere, iç içe dokunuşlu gerçek range: geçerli
  const r = build(RANGE.slice(0, 11));
  const B = atr(r.map((x) => x.high), r.map((x) => x.low), r.map((x) => x.close), 14);
  assert.ok(rangeAt(r, pivots(r, 3), 95, B[94], o));
});

test('yön filtresi: sadece short istenirse long setup verilmez', () => {
  assert.equal(run([...RANGE, [120, 112]], { direction: 'short' }).trades.length, 0);
});
