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
  const r = find([...DIAG, [77, 118]], { ...O, diagType: 'ending' });
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
  const t = find([...DIAG, [74, 124]], { ...O, diagType: 'ending' })[0];
  assert.ok(t);
  assert.ok(['waiting', 'approaching'].includes(t.state));
  assert.equal(t.plans[0].entryKind, 'stop');
});

test('leading diagonal: dalga 2 limiti 0→5 %61,8, stop 0 altı; limite gelince dolar', () => {
  const t = find([...DIAG, [80, 112]], { ...O, diagType: 'leading' })[0];
  assert.ok(t);
  assert.equal(t.type, 'leading');
  assert.equal(t.direction, 'long');
  const size = t.points.p5.price - t.points.p0.price;
  assert.ok(Math.abs(t.plans[0].level - (t.points.p5.price - 0.618 * size)) < 1e-9);
  assert.ok(t.levels.stop < t.points.p0.price);
  // 112 limite (≈ 110,8) inmedi → bekliyor; 108'e inince doldu
  assert.ok(['lwaiting', 'lapproaching'].includes(t.state));
  const f = find([...DIAG, [80, 108], [84, 112]], { ...O, diagType: 'leading' })[0];
  assert.equal(f.state, 'filled');
});

test('her ikisi: aynı diagonal iki ayrı setup (ters yönlerde)', () => {
  const r = find([...DIAG, [80, 112]], { ...O, diagType: 'ending' }).concat(find([...DIAG, [80, 112]], { ...O, diagType: 'leading' }));
  assert.deepEqual(r.map((t) => t.type).sort(), ['ending', 'leading']);
  assert.notEqual(r[0].direction, r[1].direction);
});

test('örtüşme yoksa (4, 1 bölgesine girmiyor) diagonal değil', () => {
  const path = [[0, 130], [20, 100], [30, 120], [40, 108], [50, 130], [60, 122], [70, 133], [80, 118]];
  assert.equal(find(path, { ...O, diagType: 'all' }).filter((t) => t.type !== 'w4').length, 0);
});

test('short aynası: alçalan diagonal → ending long', () => {
  const c = mirror(build([...DIAG, [80, 112]]), 240);
  const t = findDiagonals(c, { ...O, diagType: 'ending' })[0];
  assert.ok(t);
  assert.equal(t.direction, 'long');
  assert.ok(t.levels.stop < t.points.p5.price);
});

test('backtest: ending kırılımda girer, leading limiti dolar', async () => {
  const { backtestCoin } = await import('../src/backtest/engine.js');
  // Ending sonrası 0'a kadar düşüş
  const c1 = build([...DIAG, [77, 118], [95, 100]]);
  const r1 = backtestCoin(c1, { from: 0, to: c1[c1.length - 1].time, opts: { mode: 'diagonal', ...O, diagType: 'ending', diagMinRR: 0 }, window: 600 });
  const e = r1.trades.find((t) => t.type === 'dend');
  assert.ok(e, JSON.stringify(r1.stats));
  assert.equal(e.dir, 'short');
  assert.ok(e.reach.p4);
  // Leading: dalga 2 limite (≈110,8) iner, sonra yukarı (dalga 3)
  const c2 = build([...DIAG, [80, 109], [110, 160]]);
  const r2 = backtestCoin(c2, { from: 0, to: c2[c2.length - 1].time, opts: { mode: 'diagonal', ...O, diagType: 'leading', diagMinRR: 0 }, window: 600 });
  const l = r2.trades.find((t) => t.type === 'dlead');
  assert.ok(l, JSON.stringify(r2.stats));
  assert.equal(l.dir, 'long');
  assert.equal(l.outcome, 'hedef');
});

test('takip kaydı: diagonal planı ve 1–3 / 2–4 çizgileri', async () => {
  const { snapshot } = await import('../src/watch/track.js');
  const c = build([...DIAG, [74, 124]]);
  const t = { ...findDiagonals(c, { ...O, diagType: 'ending' })[0], coin: 'X', instId: 'X-USDT' };
  const snap = snapshot(t, c, { tf: { id: '4H', ms: 3600e3 }, mode: 'diagonal' });
  assert.equal(snap.kind, 'diagonal');
  assert.equal(snap.plans[0].entryKind, 'stop');
  assert.equal(snap.plans[0].cancelBeyond, t.points.p5.price);
  assert.equal(snap.shape.lines.length, 2);
});

// Dalga 4 → 5: 0=100, 1=120, 2=108, 3=124 (dalga 3 < dalga 1 → daralan). Geçersizlik = 3 − (1−2) = 112.
// Bölge: 0→3 (24) için %38,2 → 114,83 (1'in altında, örtüşme ✓); %50 → 112 (geçersizliğe kırpılır).
const W4 = [[0, 126], [20, 130], [40, 100], [50, 120], [60, 108], [70, 124]];
const OW = { diagSens: [2], diagType: 'w4', diagW4Entry: 'near' }; // eski tek seviye limit (parity)
const w4 = (path, opts = OW) => findDiagonals(build(path), opts).filter((t) => t.type === 'w4' && t.direction === 'long');

test('dalga 4 oluşurken: bölgede limit, stop geçersizlik altı, hedef 3 ucu', () => {
  const t = w4([...W4, [75, 119]])[0];
  assert.ok(t, 'dalga 4 setup bulunamadı');
  assert.equal(t.shape, 'contracting');
  assert.equal(t.forming, true);
  assert.deepEqual(t.plans.map((p) => p.type), ['d4lim']);
  const lim = t.plans[0];
  assert.ok(Math.abs(lim.level - (t.points.p3.price - 0.382 * (t.points.p3.price - t.points.p0.price))) < 1e-9);
  assert.ok(Math.abs(t.zone.invalid - (t.points.p3.price - (t.points.p1.price - t.points.p2.price))) < 1e-9);
  assert.ok(lim.stop < t.zone.invalid);
  assert.equal(lim.targets[0].price, t.points.p3.price);
  assert.ok(['lwaiting', 'lapproaching'].includes(lim.state));
});

test('4 onaylandı: limit doldu, onay planı girişe hazır; 3 geçilince hedef', () => {
  const t = w4([...W4, [80, 114], [88, 120]])[0];
  assert.ok(t);
  assert.equal(t.forming, false);
  const lim = t.plans.find((p) => p.type === 'd4lim'), conf = t.plans.find((p) => p.type === 'd4conf');
  assert.equal(lim.state, 'filled');
  assert.ok(conf && conf.state === 'ready');
  const done = w4([...W4, [80, 114], [92, 126]])[0];
  assert.ok(done.plans.every((p) => p.state === 'target'));
});

test('4 geçersizliği aşarsa (daralanda 2 boyundan uzun) dalga 4 setup yok', () => {
  assert.equal(w4([...W4, [80, 110], [88, 116]]).length, 0);
});

test('dalga 4 short aynası ve tür filtresi', () => {
  const c = mirror(build([...W4, [75, 119]]), 240);
  const t = findDiagonals(c, OW).find((x) => x.type === 'w4');
  assert.ok(t && t.direction === 'short');
  assert.ok(t.plans[0].stop > t.zone.invalid);
  assert.ok(findDiagonals(build([...W4, [75, 119]]), { ...OW, diagType: 'ending' }).every((x) => x.type !== 'w4'));
});

test('backtest: dalga 4 limiti 4 oluşurken verilir, 3 aşılınca hedef', async () => {
  const { backtestCoin } = await import('../src/backtest/engine.js');
  const c = build([...W4, [80, 114], [96, 127]]);
  const r = backtestCoin(c, { from: 0, to: c[c.length - 1].time, opts: { mode: 'diagonal', ...OW, diagMinRR: 0 }, window: 600 });
  const lim = r.trades.find((t) => t.type === 'd4lim');
  assert.ok(lim, JSON.stringify(r.stats));
  assert.equal(lim.dir, 'long');
  assert.equal(lim.outcome, 'hedef');
  assert.ok(lim.reach.p3);
});

test('takip kaydı: dalga 4 limiti, kaçış seviyesi 3 ucu', async () => {
  const { snapshot } = await import('../src/watch/track.js');
  const c = build([...W4, [75, 119]]);
  const t = { ...w4([...W4, [75, 119]])[0], coin: 'X', instId: 'X-USDT' };
  const snap = snapshot(t, c, { tf: { id: '4H', ms: 3600e3 }, mode: 'diagonal' });
  assert.equal(snap.plans[0].type, 'd4lim');
  assert.equal(snap.plans[0].entryKind, 'limit');
  assert.equal(snap.plans[0].cancelFav, t.points.p3.price);
  assert.deepEqual(snap.points.map((p) => p.label), ['0', '1', '2', '3', '4?']);
});

test('backtest işlemi işlem içi en kötü fiyatı (mae) taşır', async () => {
  const { backtestCoin } = await import('../src/backtest/engine.js');
  const c = build([...W4, [80, 114], [96, 127]]);
  const r = backtestCoin(c, { from: 0, to: c[c.length - 1].time, opts: { mode: 'diagonal', ...OW, diagMinRR: 0 }, window: 600 });
  const lim = r.trades.find((t) => t.type === 'd4lim');
  const entryIdx = c.findIndex((x) => x.time === lim.entryTime), exitIdx = c.findIndex((x) => x.time === lim.exitTime);
  const lowest = Math.min(...c.slice(entryIdx, exitIdx + 1).map((x) => x.low));
  assert.ok(Math.abs(lim.mae - lowest) < 1e-9, `${lim.mae} vs ${lowest}`);
});

// ---- Kitabi dalga 4: Fibonacci çakışmaları (kademeli), H1 = 3 ucu, H2 = −0,236; alt dalga sayımı
const OF = { diagSens: [2], diagType: 'w4' }; // varsayılan diagW4Entry: 'fib'

test('dalga 4 fib: iki çakışmada kademeli limit (A %38,2≈B %50, A %50≈B %61,8), H2 = −0,236 uzantıları', () => {
  const t = w4([...W4, [75, 119]], OF)[0];
  assert.ok(t, 'dalga 4 setup bulunamadı');
  const P = t.points, s03 = P.p3.price - P.p0.price, l3 = P.p3.price - P.p2.price;
  const U = ((P.p3.price - 0.382 * s03) + (P.p3.price - 0.5 * l3)) / 2;
  const D = ((P.p3.price - 0.5 * s03) + (P.p3.price - 0.618 * l3)) / 2;
  const lim = t.plans[0];
  assert.ok(Math.abs(lim.legs[0] - U) < 1e-9 && Math.abs(lim.legs[1] - D) < 1e-9, JSON.stringify(lim.legs));
  assert.deepEqual(lim.targets.map((x) => x.key), ['p3', 'e236']);
  const h2 = ((P.p3.price + 0.236 * s03) + (P.p3.price + 0.236 * l3)) / 2;
  assert.ok(Math.abs(lim.targets[1].price - h2) < 1e-9);
  assert.equal(lim.main.key, 'e236');
  assert.equal(t.sub.pattern, null); // düz bacaklar: alt yapı belirsiz
  assert.ok(['4 bölgesi bekleniyor', '4 bölgesine yaklaşıyor'].includes(lim.stateLabel));
});

test('dalga 4 fib: iki kademe dolar, 3 geçilince hedef 1; stop geçersizliğin altında', () => {
  const t = w4([...W4, [80, 112.9], [90, 126]], OF)[0];
  assert.ok(t);
  const lim = t.plans.find((p) => p.type === 'd4lim');
  assert.equal(lim.filledLegs, 2);
  assert.equal(lim.state, 'target');
  assert.ok(lim.stop < t.zone.invalid);
});

// Alt dalgalı daralan diagonal: her bacak a-b-c (3-3-3-3-3)
const SUB = [[0, 130], [20, 100], [26, 114], [29, 109], [35, 120], [38, 113], [41, 117], [45, 108], [51, 119], [54, 114], [60, 124], [63, 118], [66, 121], [69, 116]];

test('alt dalga sayımı: 3-3-3-3-3 bulunur; kitabi filtre düz bacaklı diagonali eler', () => {
  const t = findDiagonals(build(SUB), { diagSens: [3], diagType: 'w4' }).find((x) => x.type === 'w4' && x.direction === 'long');
  assert.ok(t, 'alt dalgalı diagonal bulunamadı');
  assert.equal(t.sub.pattern, '3-3-3-3-3');
  assert.deepEqual(t.sub.legs.map((l) => l.n), [3, 3, 3]);
  assert.ok(t.fib.tight >= 1);
  assert.ok(findDiagonals(build(SUB), { diagSens: [3], diagType: 'w4', diagBook: true }).some((x) => x.type === 'w4'));
  assert.equal(findDiagonals(build([...W4, [75, 119]]), { ...OF, diagBook: true }).filter((x) => x.type === 'w4').length, 0);
});

test('pickThree: a en uç tepe, b en derin dip; 3 dalga zigzag kuralına uyar', async () => {
  const { pickThree, DEFAULTS } = await import('../src/scan/wave3.js');
  const P = (i, price, type) => ({ i, price, type });
  const abc = pickThree(P(0, 100, 'L'), [P(4, 112, 'H'), P(6, 110, 'L'), P(8, 114, 'H'), P(11, 107, 'L')], P(16, 120, 'H'), DEFAULTS);
  assert.deepEqual(abc.map((p) => p.price), [100, 114, 107, 120]);
});
