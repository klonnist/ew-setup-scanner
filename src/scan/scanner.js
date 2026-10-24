// Tarama akışı: hacme göre coin listesi → her coin için mumlar → moda göre setup'lar (dalga-3, üçgen, ABCDE üçgen ya da diagonal).
import { getTopCoins, getCandles, TIMEFRAMES } from '../data/okx.js';
import { findWave3Setups, compareSetups, DEFAULTS } from './wave3.js';
import { findTriangles, compareTriangles } from './triangle.js';
import { findAbcde, compareAbcde } from './abcde.js';
import { findDiagonals, compareDiagonals } from './diagonal.js';
import { tagSmt, refCoinFor, timeIndex, SMT_DEFAULTS } from './smt.js';

const CONCURRENCY = 6;
// Dalga-3 son 300 mumla (canlı ve backtest aynı pencere); üçgenler aylarca sürebildiği için 600 mum indirilir.
export const WAVE_BARS = 300;
export const LONG_BARS = 600;

/**
 * Bir coinin önbellekteki mumlarında seçilen moda göre setup'ları bulur.
 * refs verilirse her setup'a SMT etiketi yazılır (yalnızca bilgi; algılama ve sıralama değişmez).
 */
export function detect(r, opts, refs = null) {
  const long = opts.mode === 'triangle' || opts.mode === 'abcde' || opts.mode === 'diagonal';
  const subject = long ? r.longCandles : r.candles;
  const setups = opts.mode === 'triangle' ? findTriangles(subject, opts, r.live)
    : opts.mode === 'abcde' ? findAbcde(subject, opts, r.live)
    : opts.mode === 'diagonal' ? findDiagonals(subject, opts, r.live)
    : findWave3Setups(subject, opts, r.live);
  const rc = refCoinFor(r.coin, opts.smtRef ?? SMT_DEFAULTS.smtRef);
  tagSmt(setups, subject, rc ? refs?.[rc] || null : null, opts);
  for (const s of setups) s.smtRef = s.smt ? rc : null;
  // Sadece SMT'li: karşılaştırılacak ucu olmayan kalıplar (üçgen, leading) ve referans verisi olmayanlar etkilenmez
  return opts.smtOnly ? setups.filter((s) => !s.smt || s.smt === 'smt') : setups;
}

/** SMT referans grafikleri (BTC, ETH): taramada indirilmişse oradan, yoksa ayrıca indirilir. Hata taramayı bozmaz. */
async function loadRefs(results, tf, opts, net) {
  const refs = {}; // kapalıyken de indirilir: ayar sonradan açılınca yeniden tarama gerekmesin
  for (const coin of ['BTC', 'ETH']) {
    let c = results.find((x) => x?.coin === coin && x.longCandles?.length)?.longCandles;
    if (!c) {
      try { c = (await getCandles(`${coin}-USDT`, tf, LONG_BARS, net)).candles; } catch (err) { if (err.name === 'AbortError') throw err; c = null; }
    }
    if (c?.length) refs[coin] = { candles: c, index: timeIndex(c) };
  }
  return refs;
}

export function sortSetups(setups, opts) {
  const cmp = opts.mode === 'triangle' ? compareTriangles : opts.mode === 'abcde' ? compareAbcde : opts.mode === 'diagonal' ? compareDiagonals : (a, b) => compareSetups(a, b, opts);
  setups.sort(cmp);
  return setups;
}

/**
 * @param settings  { mode, timeframe, topN, manualCoins: string[]|null, ...ayarlar }
 * @param hooks     { onProgress({done,total,coin}), onRetry, signal }
 * @returns {{ coins, results: {coin, instId, setups, candles, longCandles, live, error}[], setups, at }}
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
        const { candles: longCandles, live } = await getCandles(c.instId, tf, LONG_BARS, net);
        const r = { ...c, candles: longCandles.slice(-WAVE_BARS), longCandles, live };
        results[idx] = r;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        results[idx] = { ...c, candles: [], longCandles: [], live: null, setups: [], error: err.message };
      }
      done++;
      hooks.onProgress?.({ done, total: coins.length, coin: c.coin });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, coins.length) }, worker));
  const refs = await loadRefs(results, tf, opts, net);
  for (const r of results) if (!r.error) r.setups = detect(r, opts, refs);

  const setups = results.flatMap((r) => r.setups.map((s) => ({ ...s, coin: r.coin, instId: r.instId })));
  sortSetups(setups, opts);
  return { tf, coins, results, setups, refs, at: Date.now() };
}
