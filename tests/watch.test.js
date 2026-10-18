import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, mirror } from './helpers.js';
import { evaluatePlan, snapshot } from '../src/watch/track.js';
import { useStorage, loadWatch, addWatch, removeWatch, updateWatch, importWatch, exportWatch } from '../src/watch/store.js';
import { findWave3Setups } from '../src/scan/wave3.js';
import { findTriangles } from '../src/scan/triangle.js';

const H = 3600e3;
// Kayıt bar 0'da; fiyat 100'den 110'a çıkar (bar 10), sonra 95'e düşer (bar 20). Mumlar ±0,3 fitilli.
const UP_DOWN = build([[0, 100], [10, 110], [20, 95]]);
const stopPlan = (o = {}) => ({ type: 'break', entryKind: 'stop', legs: [104], stop: 98, targets: [{ name: 'H1', price: 108 }, { name: 'H2', price: 112 }], cancelBeyond: null, cancelFav: null, activeFrom: null, ...o });

test('stop-emir: seviye geçilince girilir, hedef 1 görülür, sonra stop', () => {
  const r = evaluatePlan(stopPlan(), UP_DOWN, 0, { d: 1 });
  assert.equal(r.state, 'stopped');
  assert.equal(r.targetsHit, 1); // 108 görüldü, 112 görülmedi (tepe 110,3)
  assert.ok(r.entryTime > 0);
  assert.ok(Math.abs(r.R + 1) < 0.1); // stop'ta ≈ −1R
});

test('stop-emir: tüm hedefler görülürse "son hedef"; açıkken anlık R güncel fiyata göre', () => {
  const r = evaluatePlan(stopPlan({ targets: [{ name: 'H1', price: 106 }, { name: 'H2', price: 109 }] }), UP_DOWN, 0, { d: 1 });
  assert.equal(r.state, 'done');
  assert.equal(r.exitPrice, 109);
  const open = evaluatePlan(stopPlan({ targets: [{ name: 'H1', price: 150 }] }), UP_DOWN.slice(0, 9), 0, { d: 1, price: 107 });
  assert.equal(open.state, 'entered');
  assert.ok(Math.abs(open.R - (107 - 104) / 6) < 0.05);
});

test('limit: seviyeye gelince dolar; B kırılırsa (yukarı) dolmadan "girişe gelmedi"', () => {
  const down = build([[0, 110], [10, 100], [20, 115]]);
  const lim = { type: 'zone', entryKind: 'limit', legs: [102], stop: 95, targets: [{ name: 'H1', price: 112 }], cancelBeyond: null, cancelFav: 111, activeFrom: null };
  const r = evaluatePlan(lim, down, 0, { d: 1 });
  assert.equal(r.state, 'done');
  assert.ok(r.R > 0);
  const miss = evaluatePlan({ ...lim, legs: [90], stop: 85 }, build([[0, 110], [5, 105], [15, 115]]), 0, { d: 1 });
  assert.equal(miss.state, 'missed');
});

test('süre koşulu: limit emir activeFrom öncesinde dolmaz; giriş gelmezse süre dolar', () => {
  const down = build([[0, 110], [10, 100], [60, 101]]);
  const lim = { type: 'zone', entryKind: 'limit', legs: [102], stop: 95, targets: [{ name: 'H1', price: 130 }], cancelBeyond: null, cancelFav: null, activeFrom: 40 * H };
  // Fiyat 102'ye bar ~8'de geliyor ama emir bar 40'tan itibaren aktif; o zaman fiyat ~100,8 → dolum (açılış 100,8 < 102)
  const r = evaluatePlan(lim, down, 0, { d: 1 });
  assert.equal(r.state, 'entered');
  assert.ok(r.entryTime >= 40 * H);
  const ex = evaluatePlan({ ...lim, legs: [80], stop: 70, activeFrom: null }, down, 0, { d: 1, maxPending: 20 });
  assert.equal(ex.state, 'expired');
});

test('short aynası ve market giriş', () => {
  const m = mirror(UP_DOWN, 200); // 100 → 90 → 105
  const r = evaluatePlan({ ...stopPlan(), legs: [96], stop: 102, targets: [{ name: 'H1', price: 92 }, { name: 'H2', price: 88 }] }, m, 0, { d: -1 });
  assert.equal(r.state, 'stopped');
  assert.equal(r.targetsHit, 1);
  const mk = evaluatePlan({ ...stopPlan(), entryKind: 'market', legs: [100] }, UP_DOWN, 0, { d: 1 });
  assert.equal(mk.entryTime, 0);
});

test('kayıttan önceki mumlar sayılmaz', () => {
  const r = evaluatePlan(stopPlan(), UP_DOWN, 15 * H, { d: 1 }); // kayıt düşüş başlarken; 104 bir daha görülmüyor
  assert.equal(r.state, 'waiting');
  assert.equal(r.entryTime, null);
});

test('snapshot: dalga-3 ve üçgen setup\'ından plan + zaman damgalı pivotlar', () => {
  const tf = { id: '1H', ms: H };
  const c = build([[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [70, 110], [76, 119]]);
  const s = { ...findWave3Setups(c, { sensitivities: [4.5], entryType: 'both' }).find((x) => x.phase === 'complete'), coin: 'X', instId: 'X-USDT' };
  const w = snapshot(s, c, { tf, mode: 'wave3', now: 1 });
  assert.equal(w.kind, 'wave3');
  assert.deepEqual(w.plans.map((p) => p.type).sort(), ['break', 'zone']);
  assert.equal(w.points[0].time, c[s.points.p0.i].time);
  const tc = build([[0, 130], [30, 100], [45, 112], [60, 104], [75, 112.2], [90, 107], [100, 111.9], [108, 109]]);
  const t = { ...findTriangles(tc, { sensitivities: [2] })[0], coin: 'Y', instId: 'Y-USDT' };
  const ts = snapshot(t, tc, { tf, mode: 'triangle', now: 1 });
  assert.equal(ts.plans[0].type, 'triangle');
  assert.equal(ts.plans[0].entryKind, 'stop');
  assert.ok(ts.plans[0].targets.every((x) => x.price > ts.plans[0].legs[0]));
});

test('depolama: ekle (tekrar yok), not güncelle, sil, dışa/içe aktar', () => {
  const mem = new Map();
  useStorage({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) });
  const it = { id: 'a', key: 'K1', instId: 'X-USDT', plans: [], savedAt: 1 };
  assert.equal(addWatch(it).ok, true);
  assert.equal(addWatch({ ...it, id: 'b' }).ok, false);
  updateWatch('a', { note: 'güzel yapı' });
  assert.equal(loadWatch()[0].note, 'güzel yapı');
  const dump = exportWatch();
  removeWatch('a');
  assert.equal(loadWatch().length, 0);
  assert.equal(importWatch(JSON.parse(dump)), 1);
  assert.equal(loadWatch()[0].note, 'güzel yapı');
  assert.equal(importWatch(JSON.parse(dump)), 0); // aynısı tekrar eklenmez
});

test('üçgen kaydı çizgileri zamanla saklar: düz kenar, eğik kenar, önceki hareket', () => {
  const tf = { id: '1H', ms: H };
  const tc = build([[0, 130], [30, 100], [45, 112], [60, 104], [75, 112.2], [90, 107], [100, 111.9], [108, 109]]);
  const t = { ...findTriangles(tc, { sensitivities: [2] })[0], coin: 'Y', instId: 'Y-USDT' };
  const sh = snapshot(t, tc, { tf, mode: 'triangle', now: 1 }).shape;
  assert.equal(sh.flat.t1, tc[t.first.i].time);
  assert.equal(sh.flat.price, t.level);
  assert.equal(sh.slope.t1, tc[t.slopeLine.i1].time);
  assert.equal(sh.slope.t2, tc[t.slopeLine.i2].time);
  // Ara bir zamandaki eğik çizgi değeri indeksle hesaplanan değerle aynı (mumlar eşit aralıklı)
  const i = Math.round((t.slopeLine.i1 + t.slopeLine.i2) / 2);
  const byIdx = t.slopeLine.p1 + ((t.slopeLine.p2 - t.slopeLine.p1) * (i - t.slopeLine.i1)) / (t.slopeLine.i2 - t.slopeLine.i1);
  const byTime = sh.slope.p1 + ((sh.slope.p2 - sh.slope.p1) * (tc[i].time - sh.slope.t1)) / (sh.slope.t2 - sh.slope.t1);
  assert.ok(Math.abs(byIdx - byTime) < 1e-9);
  assert.equal(sh.prior.from.price, t.prior.from.price);
  assert.equal(sh.breakTime, null);
});
