// Tarama akışı: hacme göre coin listesi → her coin için mumlar → dalga-3 setup'ları.
import { getTopCoins, getCandles, TIMEFRAMES } from '../data/okx.js';
import { findWave3Setups, compareSetups, DEFAULTS } from './wave3.js';

const CONCURRENCY = 6;

/**
 * @param settings  { timeframe, topN, manualCoins: string[]|null, bars, ...wave3 seçenekleri }
 * @param hooks     { onProgress({done,total,coin}), onRetry, signal }
 * @returns {{ coins, results: {coin, instId, setups, candles, live, error}[], setups, at }}
 */
export async function runScan(settings, hooks = {}) {
  const tf = TIMEFRAMES[settings.timeframe] || TIMEFRAMES['4H'];
  const opts = { ...DEFAULTS, ...settings };
  const net = { signal: hooks.signal, onRetry: hooks.onRetry };

  let coins;
  if (settings.manualCoins?.length) {
    coins = settings.manualCoins.map((c) => ({ coin: c, instId: `${c}-USDT` }));
  } else {
    coins = await getTopCoins(settings.topN || 50, net);
  }

  const results = new Array(coins.length);
  let done = 0, next = 0;
  hooks.onProgress?.({ done, total: coins.length });
  const worker = async () => {
    while (next < coins.length) {
      const idx = next++;
      const c = coins[idx];
      try {
        const { candles, live } = await getCandles(c.instId, tf, settings.bars || 300, net);
        const setups = findWave3Setups(candles, opts, live);
        results[idx] = { ...c, candles, live, setups };
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        results[idx] = { ...c, candles: [], live: null, setups: [], error: err.message };
      }
      done++;
      hooks.onProgress?.({ done, total: coins.length, coin: c.coin });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, coins.length) }, worker));

  const setups = results.flatMap((r) => r.setups.map((s) => ({ ...s, coin: r.coin, instId: r.instId })));
  setups.sort((a, b) => compareSetups(a, b, opts));
  return { tf, coins, results, setups, at: Date.now() };
}
