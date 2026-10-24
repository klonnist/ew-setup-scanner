import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, mirror } from './helpers.js';
import { smtCheck, smtPoints, timeIndex, refCoinFor, tagSmt } from '../src/scan/smt.js';

// Dalga 2 benzeri düşüş: A dibi (bar 20), B tepkisi (bar 30), C dibi (bar 40), sonra yükseliş.
const subj = build([[0, 120], [20, 100], [30, 110], [40, 96], [50, 108]]); // C (96) A'yı (100) süpürdü
const pts = { prev: { i: 19, price: 99.7 }, last: { i: 39, price: 95.7 } };
const ref = (path) => { const c = build(path); return { candles: c, index: timeIndex(c) }; };

test('SMT: kalıp A dibini süpürdü, referans süpüremedi → smt', () => {
  const r = ref([[0, 60], [20, 50], [30, 56], [40, 52], [50, 58]]);
  assert.equal(smtCheck(subj, r, pts, 1), 'smt');
});

test('ikisi birlikte süpürdü → both (SMT yok)', () => {
  const r = ref([[0, 60], [20, 50], [30, 56], [40, 47], [50, 58]]);
  assert.equal(smtCheck(subj, r, pts, 1), 'both');
});

test('kalıp süpürmedi, referans süpürdü → ref; ikisi de süpürmedi → none', () => {
  const s2 = build([[0, 120], [20, 100], [30, 110], [40, 103], [50, 108]]);
  const p2 = { prev: { i: 19, price: 99.7 }, last: { i: 39, price: 102.7 } };
  assert.equal(smtCheck(s2, ref([[0, 60], [20, 50], [30, 56], [40, 47], [50, 58]]), p2, 1), 'ref');
  assert.equal(smtCheck(s2, ref([[0, 60], [20, 50], [30, 56], [40, 52], [50, 58]]), p2, 1), 'none');
});

test('short tarafı tepelerle karşılaştırılır (ayna)', () => {
  const r = ref([[0, 60], [20, 50], [30, 56], [40, 52], [50, 58]]);
  const ms = mirror(subj, 200);
  const mr = mirror(r.candles, 100);
  const mp = { prev: { i: 19, price: 200 - 99.7 }, last: { i: 39, price: 200 - 95.7 } };
  assert.equal(smtCheck(ms, { candles: mr, index: timeIndex(mr) }, mp, -1), 'smt');
});

test('gelecek veri kullanılmaz: kalıbın son mumundan sonraki referans mumları sayılmaz', () => {
  const cut = subj.slice(0, 40); // C mumu son mum
  // Referans C'den 1 mum sonra A'nın altına iniyor: o an henüz görülmemiş olmalı
  const r = ref([[0, 60], [20, 50], [30, 56], [40, 52], [41, 45], [50, 58]]);
  assert.equal(smtCheck(cut, r, pts, 1, 2), 'smt');
  assert.equal(smtCheck(subj, r, pts, 1, 2), 'both');
});

test('referans verisi yoksa ya da uçlar yoksa null', () => {
  assert.equal(smtCheck(subj, null, pts, 1), null);
  assert.equal(smtCheck(subj, ref([[100, 50], [120, 60]]), pts, 1), null);
  assert.equal(smtPoints({ kind: 'triangle', points: {} }), null);
  assert.equal(smtPoints({ kind: 'diagonal', type: 'leading', points: { p3: {}, p5: {} } }), null);
});

test('smtPoints: modlara göre karşılaştırılan uçlar', () => {
  const p = (n) => ({ i: n, price: n });
  assert.deepEqual(smtPoints({ kind: 'abcde', points: { C: p(3), E: p(5) } }), { prev: p(3), last: p(5) });
  assert.deepEqual(smtPoints({ kind: 'diagonal', type: 'ending', points: { p3: p(3), p5: p(5) } }), { prev: p(3), last: p(5) });
  assert.deepEqual(smtPoints({ kind: 'diagonal', type: 'w4', points: { p2: p(2), p4: p(4), p5: null } }), { prev: p(2), last: p(4) });
  assert.deepEqual(smtPoints({ points: { p2: null, cNow: p(9) }, abc: { A: p(4) } }), { prev: p(4), last: p(9) });
});

test('refCoinFor: BTC için ETH, kapalıysa null; tagSmt alanı yazar', () => {
  assert.equal(refCoinFor('SOL'), 'BTC');
  assert.equal(refCoinFor('BTC'), 'ETH');
  assert.equal(refCoinFor('ETH', 'ETH'), 'BTC');
  assert.equal(refCoinFor('SOL', 'off'), null);
  const s = [{ kind: 'abcde', d: 1, points: { C: pts.prev, E: pts.last } }];
  tagSmt(s, subj, ref([[0, 60], [20, 50], [30, 56], [40, 52], [50, 58]]));
  assert.equal(s[0].smt, 'smt');
});

test('backtest: SMT yalnızca etiket — referanslı ve referanssız sonuçlar (smt alanı dışında) aynı; smtOnly SMT\'sizleri eler', async () => {
  const { backtestCoin } = await import('../src/backtest/engine.js');
  // backtest.test.js'teki B kırılımı senaryosu (dalga 3 hedefe gider)
  const path = [[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [70, 110], [76, 119], [110, 165]];
  const candles = build(path);
  const cfg = { from: candles[0].time, to: candles[candles.length - 1].time, feePct: 0, exitTarget: 0, opts: { sensitivities: [4.5], subDivisors: [2], minRR: 0, entryType: 'break' } };
  const base = backtestCoin(candles, cfg);
  // Referans: kalıpla aynı yol ama C dibi A'nın çok üstünde (süpürme yok)
  const refC = build([[0, 60], [20, 50], [40, 65], [52, 57], [60, 61], [70, 59], [76, 60], [110, 80]]);
  const withRef = backtestCoin(candles, { ...cfg, ref: refC });
  assert.ok(base.trades.length > 0);
  assert.equal(withRef.trades.length, base.trades.length);
  const strip = (t) => { const { smt, ...x } = t; return x; };
  assert.deepEqual(withRef.trades.map(strip), base.trades.map(strip));
  assert.ok(base.trades.every((t) => t.smt == null));
  assert.ok(withRef.trades.every((t) => ['smt', 'both', 'ref', 'none'].includes(t.smt)));
  const only = backtestCoin(candles, { ...cfg, ref: refC, opts: { ...cfg.opts, smtOnly: true } });
  assert.equal(only.trades.length, withRef.trades.filter((t) => t.smt === 'smt').length);
});
