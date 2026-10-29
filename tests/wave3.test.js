import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, mirror } from './helpers.js';
import { zigzag, fillAtr } from '../src/scan/zigzag.js';
import { atr } from '../src/data/indicators.js';
import { findWave3Setups, pickSetups } from '../src/scan/wave3.js';

// 0=100 (bar 20), 1=130 (bar 40), A=115 (52), B=122 (60), C=2=110 (70), sonra 119'a tepki.
// Dalga 1: 20 mum, dalga 2: 30 mum → süre oranı 1,5×. Geri çekilme ≈ %67.
const BASE = [[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [70, 110], [76, 119]];
const OPTS = { sensitivities: [4.5] };

const atrOf = (c) => fillAtr(atr(c.map((x) => x.high), c.map((x) => x.low), c.map((x) => x.close)));

test('zigzag: dönüş noktalarını sırayla ve doğru yerde bulur', () => {
  const c = build(BASE);
  const { pivots } = zigzag(c, atrOf(c), 2);
  assert.deepEqual(pivots.map((p) => p.type + p.i), ['H0', 'L19', 'H39', 'L51', 'H59', 'L69']);
});

test('long dalga-3 setup: ABC zigzag, süre oranı, seviyeler', () => {
  const c = build(BASE);
  const [s] = findWave3Setups(c, OPTS);
  assert.ok(s, 'setup bulunmalı');
  assert.equal(s.direction, 'long');
  assert.equal(s.abc.kind, 'zigzag');
  assert.equal(s.state, 'ready');
  assert.equal(s.durations.D1, 20);
  assert.equal(s.durations.D2, 30);
  assert.ok(Math.abs(s.timeRatio - 1.5) < 1e-9);
  const { p0, p1, p2 } = s.points;
  // Hedef 1 = dalga 2 ucu × (dalga 1 oranı), log ölçek
  assert.ok(Math.abs(s.levels.targets[0].price - p2.price * (p1.price / p0.price)) < 1e-9);
  assert.equal(s.levels.trigger, s.abc.B.price);
  assert.ok(s.levels.stop < p2.price);
  assert.ok(s.rr > 2);
  assert.equal(pickSetups([s]).length, 1);
});

test('short setup aynı yapının aynası', () => {
  const c = mirror(build(BASE), 260);
  const [s] = findWave3Setups(c, OPTS);
  assert.ok(s);
  assert.equal(s.direction, 'short');
  assert.equal(s.abc.kind, 'zigzag');
  assert.ok(s.levels.stop > s.points.p2.price);
  assert.ok(s.levels.targets[0].price < s.points.p2.price);
  assert.equal(findWave3Setups(c, { ...OPTS, direction: 'long' }).length, 0);
});

test('dalga 2 dalga 1\'den kısa sürerse elenir', () => {
  // Dalga 1 = 40 mum, dalga 2 = 30 mum → oran 0,75
  const c = build([[0, 120], [20, 100], [60, 130], [72, 115], [80, 122], [90, 110], [98, 121]]);
  const O = { sensitivities: [6] }; // dalga 1 yavaş → ATR küçük; B ana pivot olmasın diye daha kaba derece
  assert.equal(findWave3Setups(c, O).length, 0);
  // Süre koşulu gevşetilirse aynı yapı geçer (elemenin sebebi süre)
  assert.equal(findWave3Setups(c, { ...O, minTimeRatio: 0.5 }).length, 1);
});

test('dalga 2 ABC değilse (tek bacak) elenir', () => {
  const c = build([[0, 120], [20, 100], [40, 130], [70, 110], [76, 120]]);
  assert.equal(findWave3Setups(c, OPTS).length, 0);
  const [s] = findWave3Setups(c, { ...OPTS, requireAbc: false });
  assert.ok(s);
  assert.equal(s.abc, null);
});

test('fiyat dalga 2 ucunu kırarsa geçersiz, hedef 1 aşılırsa kaçtı', () => {
  const c = build(BASE);
  const live = { ...c[c.length - 1], low: 105, high: 119, close: 106, confirmed: false };
  assert.equal(findWave3Setups(c, OPTS, live)[0].state, 'invalid');
  const live2 = { ...c[c.length - 1], low: 118, high: 150, close: 149, confirmed: false };
  assert.equal(findWave3Setups(c, OPTS, live2)[0].state, 'gone');
  const live3 = { ...c[c.length - 1], low: 118, high: 124, close: 123, confirmed: false };
  const s = findWave3Setups(c, OPTS, live3)[0];
  assert.equal(s.state, 'triggered');
  assert.equal(s.levels.entry, 123); // tetiklenince giriş = güncel fiyat
});

test('geri çekilme bandı dışındaysa elenir', () => {
  const c = build(BASE);
  assert.equal(findWave3Setups(c, { ...OPTS, retrMax: 0.6 }).length, 0);
});

test('R:R filtresi pickSetups ile uygulanır', () => {
  const c = build(BASE);
  const all = findWave3Setups(c, OPTS);
  assert.equal(pickSetups(all, { minRR: 50 }).length, 0);
});

test('Dalga 1 kalitesi: düz itki yüksek verim/hız, testere düşük; şablon filtresi kapalıyken sonuç değişmez', async () => {
  const { w1Quality, findWave3Setups } = await import('../src/scan/wave3.js');
  const { fillAtr } = await import('../src/scan/zigzag.js');
  const { atr } = await import('../src/data/indicators.js');
  const { build } = await import('./helpers.js');
  const q = (path, i0, i1) => {
    const c = build(path);
    const a = fillAtr(atr(c.map((x) => x.high), c.map((x) => x.low), c.map((x) => x.close), 14));
    return w1Quality(c, a, { i: i0, price: c[i0].low }, { i: i1, price: c[i1].high });
  };
  const straight = q([[0, 100], [20, 100.5], [30, 120], [40, 110]], 20, 29);
  const saw = [[0, 100], [20, 100.5]];
  for (let b = 22, p = 100.5; b <= 60; b += 2) { p += (b / 2) % 2 ? 3 : -2.5; saw.push([b, p]); }
  const choppy = q([...saw, [70, 105]], 20, 59);
  assert.ok(straight.er > 0.9 && straight.speed > choppy.speed, JSON.stringify({ straight, choppy }));
  assert.ok(choppy.er < 0.2, JSON.stringify(choppy));
  // Kapalıyken (varsayılan) algılama aynı ve her kurulum şablon puanı taşır; açıkken şartı sağlamayan elenir
  const path = [[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [70, 110], [74, 115]];
  const o = { sensitivities: [4.5], subDivisors: [2], minRR: 0, entryType: 'both' };
  const off = findWave3Setups(build(path), o);
  assert.ok(off.length && off.every((s) => s.w1q && s.textbook));
  const on = findWave3Setups(build(path), { ...o, textbook: true, textbookMin: 4, cleanW1Er: 2 });
  assert.equal(on.length, 0);
});

test('Ders kitabı şablonu: ideal oranlar 4/4, minicik ABC ve uzun dalga 2 eksik sayılır', async () => {
  const { textbookOf, tbMissing, DEFAULTS } = await import('../src/scan/wave3.js');
  const base = {
    P0: { price: 100 }, P1: { price: 130 }, A: { price: 116 }, B: { price: 125 }, C: 107.5,
    w1q: { er: 0.7, speed: 0.6 }, aq: { er: 0.6, speed: 0.5 }, zone: { perfect: true }, timeRatio: 1.6, atr: 2,
  };
  const ideal = textbookOf(base, DEFAULTS); // a = 14/30, b = 9/14 (%64), c = 17,5/14
  assert.equal(ideal.n, 4, JSON.stringify(ideal));
  const tiny = textbookOf({ ...base, A: { price: 129 }, B: { price: 129.6 }, C: 128.8 }, DEFAULTS);
  assert.equal(tiny.checks.abc, false);
  const slow = textbookOf({ ...base, timeRatio: 4, zone: { perfect: false } }, DEFAULTS);
  assert.equal(slow.n, 2);
  assert.deepEqual(tbMissing(slow), ['★ yok', 'dalga 2 çok uzun']);
  // A–B ilişkisi 1–2 gibi: B, A'nın %85'i → orantısız; A testere → "A testere"
  const deepB = textbookOf({ ...base, B: { price: 127.9 }, C: 110 }, DEFAULTS);
  assert.deepEqual(tbMissing(deepB), ['ABC orantısız']);
  const sawA = textbookOf({ ...base, aq: { er: 0.15, speed: 0.1 } }, DEFAULTS);
  assert.deepEqual(tbMissing(sawA), ['A testere']);
});
