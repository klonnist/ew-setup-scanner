import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, mirror } from './helpers.js';
import { findAbcde, pickAbcde } from '../src/scan/abcde.js';

/**
 * Dönüş noktalarından yol: her bacak içte a-b-c (a = bacağın %60'ı, b = %36'ya geri, c = son), 8'er mum.
 * İtki (dalga 3 öncesi) düz çizgi.
 */
function path(points, { lead = [[0, 50]], tail = [] } = {}) {
  const out = [...lead];
  let [bar, p] = out[out.length - 1];
  for (const q of points) {
    const D = q - p;
    for (const f of [0.6, 0.36, 1]) { bar += 8; out.push([bar, p + f * D]); }
    p = q;
  }
  for (const [n, q] of tail) { bar += n; out.push([bar, q]); }
  return out;
}

// Dalga 3: 50 → 100 (40 mum). Üçgen: A 70, B, C 76, D 92, E 80; ardından yükseliş (E onayı).
// Dalga 3: 50 → 100, 5 dalgalı itki (1: 70, 2: 62, 3: 90, 4: 84, 5: 100). Düz çizgi versiyonu itki değildir.
const W3 = [[0, 50], [8, 70], [14, 62], [26, 90], [32, 84], [40, 100]];
const W3_FLAT = [[0, 50], [40, 100]];
const TRI = (B) => [70, B, 76, 92, 80];
const O = { abcdeSens: [4.5] };
const run = (B, tail = [[12, 98]], opts = O) => findAbcde(build(path(TRI(B), { lead: W3, tail })), opts);

test('daralan üçgen: E onaylanınca girişe hazır, stop C altında', () => {
  const r = run(95);
  assert.equal(r.length, 1);
  const t = r[0];
  assert.equal(t.direction, 'long');
  assert.equal(t.variant, 'contracting');
  assert.equal(t.state, 'ready');
  assert.ok(t.innerOk, `iç yapı eksik: ${t.missing}`);
  assert.deepEqual(['p0', 'A', 'B', 'C', 'D', 'E'].map((n) => Math.round(t.points[n].price)), [100, 70, 95, 76, 92, 80]);
  assert.ok(Math.abs(t.levels.stop - (t.points.C.price - 0.25 * t.levels.atr)) < 1e-9);
  // Hedefler sıralı; thrust = E + en geniş bacak (A = 30,3 fitil dahil)
  const T = t.levels.targets.map((x) => x.price);
  assert.deepEqual(T, [...T].sort((a, b) => a - b));
  const thrust = t.levels.targets.find((x) => x.key === 'thrust').price;
  assert.ok(Math.abs(thrust - (t.points.E.price + t.widest)) < 1e-9);
  assert.equal(t.levels.targets[0].key, 'top');
  assert.equal(pickAbcde(r).length, 1);
});

test("running üçgen: B dalga 3'ün ucunu geçebilir", () => {
  const t = run(104)[0];
  assert.ok(t);
  assert.equal(t.variant, 'running');
  // Running'de ilk hedef B ucu
  assert.ok(Math.abs(t.levels.targets[0].price - t.points.B.price) < 1e-9);
});

test('kural ihlalleri üçgeni eler: C<A, D>B, E<C', () => {
  const bad = (pts) => findAbcde(build(path(pts, { lead: W3, tail: [[12, 98]] })), O).filter((t) => t.direction === 'long' && Math.round(t.points.p0.price) === 100);
  assert.equal(bad([70, 95, 66, 92, 80]).length, 0, 'C, A altına indi');
  assert.equal(bad([70, 95, 76, 97, 80]).length, 0, 'D, B üstüne çıktı');
  assert.equal(bad([70, 95, 76, 92, 74]).length, 0, 'E, C altına indi');
});

test('E limiti = D − 0,618 × (D − C); E oluşurken yalnızca limit planı', () => {
  // Son bacak E (92 → 80) bitmedi: c alt dalgası yok
  const pts = path(TRI(95), { lead: W3 });
  const t = findAbcde(build(pts.slice(0, -1)), O).find((x) => x.direction === 'long');
  assert.ok(t);
  assert.equal(t.state, 'forming');
  const { C, D } = t.points;
  assert.ok(Math.abs(t.levels.eLimit - (D.price - 0.618 * (D.price - C.price))) < 1e-9);
  assert.deepEqual(t.plans.map((p) => p.type), ['elimit']);
  assert.ok(['waiting', 'approaching'].includes(t.plans[0].state));
});

test('E limiti aşıldıysa (E daha derin) limit doldu; E onayı ikinci plan', () => {
  const t = run(95)[0];
  // E = 80, limit = 92.3 − 0.618 × (92.3 − 75.7) ≈ 82 → dolar, stop görülmedi
  const lim = t.plans.find((p) => p.type === 'elimit');
  const conf = t.plans.find((p) => p.type === 'econfirm');
  assert.equal(lim.state, 'filled');
  assert.ok(Math.abs(lim.entry - t.levels.eLimit) < 1e-9);
  assert.equal(conf.state, 'ready');
  assert.ok(conf.entry > lim.entry);
  // Yalnızca onay girişi seçilirse limit planı yok
  assert.deepEqual(run(95, undefined, { ...O, abcdeEntry: 'confirm' })[0].plans.map((p) => p.type), ['econfirm']);
});

test('short aynası', () => {
  const c = mirror(build(path(TRI(95), { lead: W3, tail: [[12, 98]] })), 200);
  const t = findAbcde(c, O)[0];
  assert.ok(t);
  assert.equal(t.direction, 'short');
  assert.equal(t.state, 'ready');
  assert.ok(t.levels.stop > t.points.C.price);
  assert.ok(t.levels.targets.every((x) => x.price < t.levels.entry));
});

test('iç ABC: düz bacak zorunlu modda elenir, tercih modunda kalır', () => {
  // D bacağı düz çizgi (iç yapı yok)
  const pts = path(TRI(95), { lead: W3, tail: [[12, 98]] });
  // D bacağının ilk iç noktası (lead + 3 bacak × 3 nokta) → doğrusal yap
  const i = W3.length + 3 * 3; // D'nin a noktası
  const p = pts[i - 1][1], q = pts[i + 1][1];
  pts[i][1] = p + (q - p) * 0.5;
  const c = build(pts);
  assert.equal(findAbcde(c, O).filter((t) => t.direction === 'long' && t.state === 'ready').length, 0);
  const t = findAbcde(c, { ...O, innerAbc: 'prefer' }).find((x) => x.direction === 'long');
  assert.ok(t && !t.innerOk);
  assert.deepEqual(t.missing, ['D']);
});

test('backtest: E limiti dolar, E onayı kapanıştan girer; ikisi de hedefe gider', async () => {
  const { backtestCoin } = await import('../src/backtest/engine.js');
  // Üçgen sonrası 130'a thrust
  const c = build(path(TRI(95), { lead: W3, tail: [[12, 98], [20, 130]] }));
  const r = backtestCoin(c, { from: 0, to: c[c.length - 1].time, opts: { mode: 'abcde', ...O, abcdeMinRR: 0 }, window: 600 });
  const lim = r.trades.find((t) => t.type === 'elimit');
  const conf = r.trades.find((t) => t.type === 'econfirm');
  assert.ok(lim && conf, JSON.stringify(r.stats));
  assert.ok(lim.entry < conf.entry);
  assert.equal(lim.outcome, 'hedef');
  assert.ok(lim.reach.top && lim.reach.thrust);
});

test('takip kaydı: ABCDE planları ve A–C / B–D çizgileri zamanla saklanır', async () => {
  const { snapshot } = await import('../src/watch/track.js');
  const c = build(path(TRI(95), { lead: W3 }).slice(0, -1));
  const t = { ...findAbcde(c, O).find((x) => x.direction === 'long'), coin: 'X', instId: 'X-USDT' };
  const snap = snapshot(t, c, { tf: { id: '4H', ms: 3600e3 }, mode: 'abcde' });
  assert.equal(snap.kind, 'abcde');
  assert.deepEqual(snap.points.map((p) => p.label), ['0', 'A', 'B', 'C', 'D', 'E?']);
  assert.equal(snap.plans[0].type, 'elimit');
  assert.equal(snap.plans[0].entryKind, 'limit');
  assert.equal(snap.plans[0].cancelFav, t.points.D.price);
  assert.equal(snap.shape.lines[0].t1, c[t.points.A.i].time);
});

test('önceki hareket: 5 dalgalı itki bulunur; düz harekette itki yok, zorunlu modda üçgen elenir', () => {
  const t = run(95)[0];
  assert.ok(t.w3Impulse.ok, 'itki bulunamadı');
  assert.deepEqual(t.w3Impulse.points.map((p) => Math.round(p.price)), [70, 62, 90, 84]);
  const flat = build(path(TRI(95), { lead: W3_FLAT, tail: [[12, 98]] }));
  const f = findAbcde(flat, O).find((x) => x.direction === 'long');
  assert.ok(f && !f.w3Impulse.ok);
  assert.ok(f.rules.some((r) => r.id === 'W3' && !r.ok));
  assert.equal(findAbcde(flat, { ...O, w3Check: 'require' }).filter((x) => x.direction === 'long').length, 0);
});
