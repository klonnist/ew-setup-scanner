import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, mirror } from './helpers.js';
import { findDiagonals, pickDiagonals } from '../src/scan/diagonal.js';

// 130 → 100 düşüş, ardından daralan yükselen diagonal: 0=100, 1=120, 2=108, 3=124, 4=116, 5=127 (10'ar mum).
// 1>3>5 (20>16>11), 2>4 (12>8), 4 dalga 1 bölgesine giriyor (116 < 120), 0 ve 5 kanal içinde.
const DIAG = [[0, 130], [20, 100], [30, 120], [40, 108], [50, 124], [60, 116], [70, 127]];
const O = { diagSens: [2] };
const find = (path, opts = O) => findDiagonals(build(path), opts);

test('ending diagonal: 2–4 çizgisi kırılınca ters yöne giriş, stop 5 üstü, hedefler 4 → 2 → 0', () => {
  const r = find([...DIAG, [77, 118]], { ...O, diagKind: 'ending' });
  assert.equal(r.length, 1, JSON.stringify(r.map((t) => t.state)));
  const t = r[0];
  assert.equal(t.type, 'ending');
  assert.equal(t.shape, 'contracting');
  assert.equal(t.direction, 'short');
  assert.equal(t.state, 'triggered');
  assert.ok(t.levels.stop > t.points.p5.price);
  assert.deepEqual(t.levels.targets.map((x) => x.key), ['p4', 'p2', 'p0']);
  assert.equal(pickDiagonals(r).length, 1);
});

test('ending: kırılım yokken tetik bekleniyor (stop emri, 2–4 çizgisinde)', () => {
  const t = find([...DIAG, [74, 124]], { ...O, diagKind: 'ending' })[0];
  assert.ok(t);
  assert.ok(['waiting', 'approaching'].includes(t.state));
  assert.equal(t.plans[0].entryKind, 'stop');
});

test('leading diagonal: dalga 2 limiti 0→5 %61,8, stop 0 altı; limite gelince dolar', () => {
  const t = find([...DIAG, [80, 112]], { ...O, diagKind: 'leading' })[0];
  assert.ok(t);
  assert.equal(t.type, 'leading');
  assert.equal(t.direction, 'long');
  const size = t.points.p5.price - t.points.p0.price;
  assert.ok(Math.abs(t.plans[0].level - (t.points.p5.price - 0.618 * size)) < 1e-9);
  assert.ok(t.levels.stop < t.points.p0.price);
  // 112 limite (≈ 110,8) inmedi → bekliyor; 108'e inince doldu
  assert.ok(['lwaiting', 'lapproaching'].includes(t.state));
  const f = find([...DIAG, [80, 108], [84, 112]], { ...O, diagKind: 'leading' })[0];
  assert.equal(f.state, 'filled');
});

test('her ikisi: aynı diagonal iki ayrı setup (ters yönlerde)', () => {
  const r = find([...DIAG, [80, 112]]);
  assert.deepEqual(r.map((t) => t.type).sort(), ['ending', 'leading']);
  assert.notEqual(r[0].direction, r[1].direction);
});

test('örtüşme yoksa (4, 1 bölgesine girmiyor) diagonal değil', () => {
  const path = [[0, 130], [20, 100], [30, 120], [40, 108], [50, 130], [60, 122], [70, 133], [80, 118]];
  assert.equal(find(path).length, 0);
});

test('short aynası: alçalan diagonal → ending long', () => {
  const c = mirror(build([...DIAG, [80, 112]]), 240);
  const t = findDiagonals(c, { ...O, diagKind: 'ending' })[0];
  assert.ok(t);
  assert.equal(t.direction, 'long');
  assert.ok(t.levels.stop < t.points.p5.price);
});

test('backtest: ending kırılımda girer, leading limiti dolar', async () => {
  const { backtestCoin } = await import('../src/backtest/engine.js');
  // Ending sonrası 0'a kadar düşüş
  const c1 = build([...DIAG, [77, 118], [95, 100]]);
  const r1 = backtestCoin(c1, { from: 0, to: c1[c1.length - 1].time, opts: { mode: 'diagonal', ...O, diagKind: 'ending', diagMinRR: 0 }, window: 600 });
  const e = r1.trades.find((t) => t.type === 'dend');
  assert.ok(e, JSON.stringify(r1.stats));
  assert.equal(e.dir, 'short');
  assert.ok(e.reach.p4);
  // Leading: dalga 2 limite (≈110,8) iner, sonra yukarı (dalga 3)
  const c2 = build([...DIAG, [80, 109], [110, 160]]);
  const r2 = backtestCoin(c2, { from: 0, to: c2[c2.length - 1].time, opts: { mode: 'diagonal', ...O, diagKind: 'leading', diagMinRR: 0 }, window: 600 });
  const l = r2.trades.find((t) => t.type === 'dlead');
  assert.ok(l, JSON.stringify(r2.stats));
  assert.equal(l.dir, 'long');
  assert.equal(l.outcome, 'hedef');
});

test('takip kaydı: diagonal planı ve 1–3 / 2–4 çizgileri', async () => {
  const { snapshot } = await import('../src/watch/track.js');
  const c = build([...DIAG, [74, 124]]);
  const t = { ...findDiagonals(c, { ...O, diagKind: 'ending' })[0], coin: 'X', instId: 'X-USDT' };
  const snap = snapshot(t, c, { tf: { id: '4H', ms: 3600e3 }, mode: 'diagonal' });
  assert.equal(snap.kind, 'diagonal');
  assert.equal(snap.plans[0].entryKind, 'stop');
  assert.equal(snap.plans[0].cancelBeyond, t.points.p5.price);
  assert.equal(snap.shape.lines.length, 2);
});
