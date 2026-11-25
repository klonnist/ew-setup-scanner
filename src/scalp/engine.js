// Scalp backtest motoru (saf, DOM'suz; worker'da ve Node'da çalışır).
// Kurgu (Altcoin Evreni): olgun range → bir ucun likiditesi süpürülür → iç kırılım (MSB) kapanışı → market giriş,
// stop süpürme ucunun ötesi, hedef range'in öbür ucu. Her mum kapanışında yalnızca o ana kadar bilinen veri kullanılır;
// giriş MSB mumunun kapanışından yapılır, stop/hedef en erken bir sonraki mumda kontrol edilir.
import { atr } from '../data/indicators.js';
import { SCALP_DEFAULTS, pivots, rangeAt, inSpan, lastInner } from './detect.js';

export const SCALP_BT_DEFAULTS = {
  feePct: 0.05, // işlem tarafı başına komisyon (%)
  maxHold: 96, // açık pozisyon en fazla kaç mum
  partial: 0.5, // B / C: TP1'de kapatılan oran
};

/** Yönetim varyantları: A tek hedef · B TP1'de kısmi, stop yerinde · C TP1'de kısmi + stop girişe. */
export const VARIANTS = [
  { id: 'A', name: 'Tek hedef', partial: false, be: false },
  { id: 'B', name: 'TP1 %50 · stop yerinde', partial: true, be: false },
  { id: 'C', name: 'TP1 %50 · stop girişe', partial: true, be: true },
];

/**
 * @param candles kapanmış mumlar (eskiden yeniye)
 * @param cfg { from, to (ms), coin, ...SCALP_DEFAULTS, ...SCALP_BT_DEFAULTS }
 * @returns {{ trades: object[], stats: { setups, skipped: {reason: n} } }}
 */
export function backtestScalp(candles, cfg = {}) {
  const o = { ...SCALP_DEFAULTS, ...SCALP_BT_DEFAULTS, ...cfg };
  const n = candles.length;
  const trades = [];
  const skipped = {};
  const skip = (r) => { skipped[r] = (skipped[r] || 0) + 1; };
  let setups = 0, rangeBars = 0, sweeps = 0;
  if (n < o.window + 20) return { trades, stats: { setups, skipped } };

  const A = atr(candles.map((c) => c.high), candles.map((c) => c.low), candles.map((c) => c.close), 14);
  const ext = pivots(candles, o.pivot);
  const inn = pivots(candles, o.inner);
  const from = o.from ?? candles[0].time, to = o.to ?? candles[n - 1].time;
  let t0 = candles.findIndex((c) => c.time >= from);
  if (t0 < 0) return { trades, stats: { setups, skipped } };
  t0 = Math.max(t0, o.window + 15);

  let armed = null; // süpürme sürüyor, MSB bekleniyor
  let pos = null; // açık işlem
  let cooldownUntil = -1;
  const allowL = o.direction !== 'short', allowS = o.direction !== 'long';

  for (let t = t0; t < n; t++) {
    const bar = candles[t];
    if (pos) {
      stepPos(pos, bar, t, o);
      if (pos.done) { trades.push(finish(pos, o)); pos = null; }
      continue; // coin başına tek işlem
    }
    if (bar.time > to) break;
    const atrT = A[t - 1];

    if (armed) {
      const d = armed.d;
      // Süpürme uzuyor mu?
      if (d === 1 ? bar.low < armed.sweepPrice : bar.high > armed.sweepPrice) {
        armed.sweepPrice = d === 1 ? bar.low : bar.high;
        armed.sweepIdx = t;
        const depth = d === 1 ? armed.range.low - armed.sweepPrice : armed.sweepPrice - armed.range.high;
        if (depth > o.maxDepthAtr * armed.atr) { skip('derin kırılım'); armed = null; cooldownUntil = t + o.confirmBars; continue; }
        // Yeni dip / tepe: MSB seviyesi bu ekstremden önceki son iç pivot olur (bilinenlerden)
        const m = lastInner(candles, d === 1 ? inn.hi : inn.lo, armed.sweepIdx, t - o.inner, d);
        if (m) armed.msb = m;
      }
      if (t - armed.start > o.confirmBars) { skip('onay gelmedi'); armed = null; cooldownUntil = t + o.confirmBars; continue; }
      // Onay: iç tepe/dip kapanışla kırıldı VE fiyat range içine geri döndü (süpürme + geri alım)
      const reclaim = d === 1 ? bar.close > armed.range.low : bar.close < armed.range.high;
      if (armed.msb && reclaim && (d === 1 ? bar.close > armed.msb.price : bar.close < armed.msb.price) && armed.sweepIdx < t) {
        const r = openPos(armed, bar, t, A[t], candles, inn, o);
        armed = null;
        if (r.skip) { skip(r.skip); cooldownUntil = t + o.confirmBars; continue; }
        setups++;
        pos = r.pos;
      }
      continue;
    }

    if (t < cooldownUntil) continue;
    const range = rangeAt(candles, ext, t, atrT, o);
    if (!range) continue;
    rangeBars++;
    const prev = candles[t - 1];
    const sweepL = allowL && bar.low < range.low - o.sweepAtr * atrT && prev.low >= range.low;
    const sweepS = allowS && bar.high > range.high + o.sweepAtr * atrT && prev.high <= range.high;
    if (sweepL === sweepS) continue; // ikisi birden (dev mum) ya da hiçbiri
    const d = sweepL ? 1 : -1;
    const sweepPrice = d === 1 ? bar.low : bar.high;
    const depth = d === 1 ? range.low - sweepPrice : sweepPrice - range.high;
    if (depth > o.maxDepthAtr * atrT) { skip('derin kırılım'); cooldownUntil = t + o.confirmBars; continue; }
    sweeps++;
    armed = {
      d, range, start: t, sweepIdx: t, sweepPrice, atr: atrT,
      msb: lastInner(candles, d === 1 ? inn.hi : inn.lo, t, t - o.inner, d),
    };
    // MSB seviyesi range dışında kalamaz (iç yapı range içindedir)
    if (armed.msb && (armed.msb.price > range.high || armed.msb.price < range.low)) armed.msb = null;
  }
  if (pos) trades.push(finish(pos, o, true));
  return { trades, stats: { setups, skipped, rangeBars, sweeps } };
}

function openPos(armed, bar, t, atrNow, candles, inn, o) {
  const d = armed.d;
  const entry = bar.close;
  const stop = armed.sweepPrice - d * o.stopBufAtr * armed.atr;
  const target = d === 1 ? armed.range.high : armed.range.low;
  const risk = (entry - stop) * d;
  if (!(risk > 0)) return { skip: 'risk yok' };
  const rr = ((target - entry) * d) / risk;
  if (rr < o.minRR) return { skip: 'R:R düşük' };
  // TP1: girişle hedef arasındaki ilk bilinen iç pivot (ilk likidite); yoksa / çok yakınsa 1R
  const lst = inSpan(d === 1 ? inn.hi : inn.lo, Math.max(0, t - o.window), t - o.inner);
  let tp1 = null;
  for (const i of lst) {
    const p = d === 1 ? candles[i].high : candles[i].low;
    const r = ((p - entry) * d) / risk;
    if (r >= 0.5 && r < rr && (tp1 == null || (p - tp1) * d < 0)) tp1 = p;
  }
  if (tp1 == null) tp1 = entry + d * risk;
  const pos = {
    d, entry, stop, target, tp1, risk, rr,
    tp1R: ((tp1 - entry) * d) / risk,
    entryIdx: t, entryTime: bar.time,
    sweepTime: candles[armed.sweepIdx].time, sweepPrice: armed.sweepPrice, sweepStartTime: candles[armed.start].time,
    msbPrice: armed.msb.price, msbTime: candles[armed.msb.idx].time,
    rangeHigh: armed.range.high, rangeLow: armed.range.low,
    rangeFrom: candles[Math.min(armed.range.hiIdx, armed.range.loIdx)].time,
    mae: 0, mfe: 0,
    v: VARIANTS.map((v) => ({ ...v, open: 1, stop, legs: [], tp1Hit: false, done: false })),
    done: false,
  };
  return { pos };
}

/** Bir mumla açık pozisyonu ilerlet. Aynı mumda stop ve hedef/TP1 görülürse stop önce sayılır (muhafazakâr). */
function stepPos(p, bar, t, o) {
  const d = p.d;
  const adverse = d === 1 ? bar.low : bar.high, fav = d === 1 ? bar.high : bar.low;
  p.mae = Math.max(p.mae, ((p.entry - adverse) * d) / p.risk);
  p.mfe = Math.max(p.mfe, ((fav - p.entry) * d) / p.risk);
  const timeout = t - p.entryIdx >= o.maxHold;
  for (const v of p.v) {
    if (v.done) continue;
    const hitStop = (adverse - v.stop) * d <= 0;
    if (hitStop) {
      // Boşlukla açılış stopun ötesindeyse açılıştan dolar
      const px = (bar.open - v.stop) * d < 0 ? bar.open : v.stop;
      v.legs.push({ w: v.open, px, why: v.tp1Hit && v.be ? 'giriş' : 'stop', time: bar.time });
      v.open = 0; v.done = true; continue;
    }
    if (v.partial && !v.tp1Hit && (fav - p.tp1) * d >= 0) {
      v.tp1Hit = true;
      const w = o.partial;
      v.legs.push({ w, px: p.tp1, why: 'TP1', time: bar.time });
      v.open -= w;
      if (v.be) v.stop = p.entry; // bir sonraki mumdan itibaren geçerli
    }
    if ((fav - p.target) * d >= 0) {
      v.legs.push({ w: v.open, px: p.target, why: 'hedef', time: bar.time });
      v.open = 0; v.done = true; continue;
    }
    if (timeout) {
      v.legs.push({ w: v.open, px: bar.close, why: 'süre', time: bar.time });
      v.open = 0; v.done = true;
    }
  }
  p.done = p.v.every((v) => v.done);
}

function finish(p, o, cut = false) {
  const fee = o.feePct / 100;
  const alts = {};
  for (const v of p.v) {
    if (!v.done) v.legs.push({ w: v.open, px: p.entry, why: 'veri bitti', time: null });
    let gross = 0, exitNotional = 0;
    for (const l of v.legs) { gross += l.w * ((l.px - p.entry) * p.d) / p.risk; exitNotional += l.w * l.px; }
    const feeR = (fee * (p.entry + exitNotional)) / p.risk;
    const last = v.legs[v.legs.length - 1];
    alts[v.id] = {
      R: gross - feeR, gross, feeR,
      outcome: last.why, tp1: v.tp1Hit, exitTime: last.time,
      legs: v.legs.map((l) => ({ w: l.w, px: l.px, why: l.why })),
    };
  }
  const { v, ...rest } = p;
  return { ...rest, coin: o.coin, alts, cut };
}

/** Bir varyantın özet istatistikleri (işlemler giriş zamanına göre sıralı). */
export function summarizeScalp(trades, variant = 'A') {
  const list = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  let total = 0, wins = 0, gw = 0, gl = 0, peak = 0, dd = 0;
  const curve = [];
  for (const t of list) {
    const r = t.alts[variant].R;
    total += r;
    if (r > 0) { wins++; gw += r; } else gl -= r;
    peak = Math.max(peak, total);
    dd = Math.max(dd, peak - total);
    curve.push({ time: t.entryTime, R: total });
  }
  const nT = list.length;
  return {
    n: nT, wins, winRate: nT ? wins / nT : 0, total, avg: nT ? total / nT : 0,
    pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0), maxDD: dd, curve,
  };
}
