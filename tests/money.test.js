import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, tradeResult, toCsv } from '../src/backtest/money.js';

const H = 3600e3;
const tr = (o) => ({ coin: 'X', type: 'dend', dir: 'long', outcome: 'hedef', R: 1, ...o });

test('sabit tutar 25 $ × 10x: kâr = 250 × değişim − komisyon; tasfiye kaybı = teminat', () => {
  const win = tr({ entryTime: 0, exitTime: 10 * H, entry: 100, exit: 110, stop: 95, mae: 97 });
  const r = tradeResult(win, 25, { leverage: 10, feePct: 0.05, mmr: 0.5 });
  assert.ok(Math.abs(r.pnl - (250 * 0.1 - 250 * 0.0005 - 250 * 1.1 * 0.0005)) < 1e-9);
  assert.equal(r.liquidated, false);
  // Fiyat girişten %10 düştü (tasfiye ≈ −9,5%) sonra hedefe gitti: tasfiye
  const liq = tradeResult({ ...win, mae: 89 }, 25, { leverage: 10, feePct: 0.05, mmr: 0.5 });
  assert.equal(liq.liquidated, true);
  assert.ok(Math.abs(liq.pnl - (-25 - 250 * 0.0005)) < 1e-9);
  // Stop tasfiyeden önce: stop olur, tasfiye olmaz
  const st = tradeResult(tr({ entryTime: 0, exitTime: H, entry: 100, exit: 95, stop: 95, mae: 95, outcome: 'stop', R: -1 }), 25, { leverage: 10, feePct: 0, mmr: 0.5 });
  assert.equal(st.liquidated, false);
  assert.ok(Math.abs(st.pnl - (-12.5)) < 1e-9);
});

test('kaldıraç 1: tasfiye yok; short yönü', () => {
  const r = tradeResult(tr({ dir: 'short', entryTime: 0, exitTime: H, entry: 100, exit: 90, stop: 130, mae: 125 }), 100, { leverage: 1, feePct: 0, mmr: 0.5 });
  assert.equal(r.liquidated, false);
  assert.ok(Math.abs(r.pnl - 10) < 1e-9);
});

test('mae yoksa (eski kayıt) tasfiye yalnızca stop mesafesinden, yaklaşık işaretli', () => {
  const r = tradeResult(tr({ entryTime: 0, exitTime: H, entry: 100, exit: 80, stop: 80, outcome: 'stop', R: -1 }), 25, { leverage: 10, feePct: 0, mmr: 0.5 });
  assert.equal(r.liquidated, true);
  assert.equal(r.approx, true);
});

test('tek pozisyon: açıkken gelen sinyal atlanır, bakiye bileşik', () => {
  const a = tr({ entryTime: 0, exitTime: 10 * H, entry: 100, exit: 110, stop: 90, mae: 99 });
  const b = tr({ entryTime: 5 * H, exitTime: 8 * H, entry: 100, exit: 120, stop: 90, mae: 99 }); // a açıkken
  const c = tr({ entryTime: 12 * H, exitTime: 20 * H, entry: 50, exit: 55, stop: 45, mae: 49 });
  const s = simulate([a, b, c], { mode: 'single', capital: 100, leverage: 1, feePct: 0 });
  assert.deepEqual(s.rows.map((x) => x.taken), [true, false, true]);
  assert.ok(Math.abs(s.summary.final - 100 * 1.1 * 1.1) < 1e-9);
  assert.equal(s.summary.skipped, 1);
});

test('parçalar: N dolu iken atlanır; sabit tutarda hepsi alınır ve eşzamanlı teminat raporlanır', () => {
  const mk = (i) => tr({ entryTime: i * H, exitTime: 100 * H, entry: 100, exit: 101, stop: 90, mae: 99 });
  const list = [0, 1, 2].map(mk);
  const s = simulate(list, { mode: 'slots', capital: 100, slots: 2, leverage: 1, feePct: 0 });
  assert.deepEqual(s.rows.map((x) => x.taken), [true, true, false]);
  const f = simulate(list, { mode: 'fixed', margin: 25, capital: 100, leverage: 10, feePct: 0 });
  assert.equal(f.summary.taken, 3);
  assert.equal(f.summary.maxMargin, 75);
  assert.equal(f.summary.maxConcurrent, 3);
  assert.ok(Math.abs(f.summary.net - 3 * 2.5) < 1e-9);
});

test('aylık tablo ve CSV', () => {
  const list = [tr({ entryTime: Date.UTC(2026, 0, 2), exitTime: Date.UTC(2026, 0, 5), entry: 10, exit: 11, stop: 9, mae: 9.5 }),
    tr({ entryTime: Date.UTC(2026, 1, 2), exitTime: Date.UTC(2026, 1, 5), entry: 10, exit: 9, stop: 9, mae: 9, outcome: 'stop', R: -1 })];
  const s = simulate(list, { mode: 'fixed', margin: 10, leverage: 1, feePct: 0 });
  assert.deepEqual(s.months.map((m) => [m.month, m.n, +m.pnl.toFixed(2), +m.cum.toFixed(2)]), [['2026-01', 1, 1, 1], ['2026-02', 1, -1, 0]]);
  const csv = toCsv(s.rows, { withMoney: true });
  assert.ok(csv.startsWith('\uFEFF#;'));
  assert.equal(csv.split('\r\n').length, 3);
  assert.ok(csv.includes(';1,00;'));
});
