// Scalp backtest işçisi: arayüzü dondurmadan coin başına simülasyon.
import { backtestScalp } from './engine.js';

self.onmessage = (e) => {
  const { id, candles, cfg } = e.data;
  try {
    self.postMessage({ id, result: backtestScalp(candles, cfg) });
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
