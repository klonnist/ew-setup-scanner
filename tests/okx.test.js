import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankByVolume, parseCandle, splitLive } from '../src/data/okx.js';

test('rankByVolume: USDT pariteleri hacme göre, stablecoin hariç', () => {
  const t = (instId, volCcy24h, last = 1, open24h = 1) => ({ instId, volCcy24h: String(volCcy24h), last: String(last), open24h: String(open24h) });
  const out = rankByVolume([
    t('BTC-USDT', 900), t('USDC-USDT', 5000), t('ETH-USDT', 1200, 110, 100), t('SOL-USDC', 9999),
    t('DOGE-USDT', 50), t('BAD-USDT', 10, 0),
  ]);
  assert.deepEqual(out.map((x) => x.coin), ['ETH', 'BTC', 'DOGE']);
  assert.ok(Math.abs(out[0].change24h - 0.1) < 1e-9);
  // Kripto kümesi verilirse dışındakiler (ör. tokenize hisse) atlanır
  const only = rankByVolume([t('BTC-USDT', 900), t('XNVDA-USDT', 5000)], 'USDT', new Set(['BTC-USDT']));
  assert.deepEqual(only.map((x) => x.coin), ['BTC']);
});

test('parseCandle + splitLive: sıralama ve canlı mum ayrımı', () => {
  const rows = [
    ['3000', '3', '4', '2', '3.5', '10', '0', '0', '0'],
    ['2000', '2', '3', '1', '2.5', '10', '0', '0', '1'],
    ['1000', '1', '2', '0.5', '1.5', '10', '0', '0', '1'],
  ];
  const { candles, live } = splitLive(rows.map(parseCandle));
  assert.deepEqual(candles.map((c) => c.time), [1000, 2000]);
  assert.equal(live.time, 3000);
});
