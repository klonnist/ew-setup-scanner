// Scalp (Altcoin Evreni mantığı) — saf yardımcılar: pivotlar, range, olgunluk.
// Gelecek veri kuralı: L sağ mumlu bir pivot ancak L mum sonra bilinir. t anında yalnızca i ≤ t − L olan pivotlar kullanılır.

export const SCALP_DEFAULTS = {
  pivot: 3, // range için dış pivot (her iki yanda mum)
  inner: 2, // iç yapı (MSB seviyesi ve TP1) için küçük pivot
  window: 96, // range penceresi (mum)
  band: 0.25, // range'in üst / alt %25'i = likidite bandı
  minTouches: 2, // her bantta en az kaç pivot (eşit tepe / dip havuzu)
  minHeightAtr: 2, // range yüksekliği alt sınırı (ATR)
  maxHeightAtr: 12, // üst sınır
  sweepAtr: 0.05, // süpürme: range ucunu en az bu kadar aşmalı
  maxDepthAtr: 3, // bundan derin kırılım = gerçek kırılım, setup iptal
  confirmBars: 12, // süpürmeden sonra MSB için en fazla mum
  stopBufAtr: 0.1, // stop süpürme ucunun bu kadar ötesi
  minRR: 2, // hedefe (range'in öbür ucu) asgari R:R (videoda 3; 5m'de 3 ile çok az işlem kalıyor)
  direction: 'both', // both | long | short
};

/**
 * Fraktal pivotlar: hi[i] = i mumu, solundaki L mumdan yüksek ve sağındaki L mumdan düşük olmayan tepe.
 * Diziler yalnızca indeks listesidir; "ne zaman bilindiği" çağıranın sorumluluğu (i + L).
 */
export function pivots(candles, L) {
  const hi = [], lo = [];
  for (let i = L; i < candles.length - L; i++) {
    const h = candles[i].high, l = candles[i].low;
    let isH = true, isL = true;
    for (let k = 1; k <= L && (isH || isL); k++) {
      const a = candles[i - k], b = candles[i + k];
      if (!(h > a.high && h >= b.high)) isH = false;
      if (!(l < a.low && l <= b.low)) isL = false;
    }
    if (isH) hi.push(i);
    if (isL) lo.push(i);
  }
  return { hi, lo };
}

/** Sıralı indeks listesinde [a, b] aralığındakiler. */
export function inSpan(list, a, b) {
  const out = [];
  for (const i of list) {
    if (i > b) break;
    if (i >= a) out.push(i);
  }
  return out;
}

/**
 * t mumu kapanmadan ÖNCE bilinen yapıdan range (t − 1 anına kadar bilinen pivotlar).
 * @returns {{ high, low, hiIdx, loIdx, height } | null}  olgun değilse null
 */
export function rangeAt(candles, piv, t, atrT, o) {
  const a = Math.max(0, t - o.window), b = t - 1 - o.pivot;
  if (b <= a) return null;
  const hs = inSpan(piv.hi, a, b), ls = inSpan(piv.lo, a, b);
  if (hs.length < o.minTouches || ls.length < o.minTouches) return null;
  let hiIdx = hs[0], loIdx = ls[0];
  for (const i of hs) if (candles[i].high > candles[hiIdx].high) hiIdx = i;
  for (const i of ls) if (candles[i].low < candles[loIdx].low) loIdx = i;
  const high = candles[hiIdx].high, low = candles[loIdx].low, height = high - low;
  if (!(atrT > 0) || height < o.minHeightAtr * atrT || height > o.maxHeightAtr * atrT) return null;
  const top = hs.filter((i) => candles[i].high >= high - o.band * height);
  const bot = ls.filter((i) => candles[i].low <= low + o.band * height);
  if (top.length < o.minTouches || bot.length < o.minTouches) return null;
  // Yatay olmalı: tepe ve dip dokunuşları iç içe geçer. Yükselen trendde dipler hep önce, tepeler hep sonra gelir → range değil.
  if (!(top[0] < bot[bot.length - 1] && bot[0] < top[top.length - 1])) return null;
  // Range bu pencerede hâlâ geçerli olmalı: pencerede (bilinmeyen son mumlar dahil) range dışına kapanış olmamış
  for (let i = a; i < t; i++) if (candles[i].close > high || candles[i].close < low) return null;
  return { high, low, hiIdx, loIdx, height };
}

/** d = 1 long: süpürmeden önceki son iç tepe (MSB seviyesi). d = −1 short: son iç dip. */
export function lastInner(candles, innerList, beforeIdx, knownBy, d) {
  let best = -1;
  for (const i of innerList) {
    if (i >= beforeIdx || i > knownBy) break;
    best = i;
  }
  if (best < 0) return null;
  return { idx: best, price: d === 1 ? candles[best].high : candles[best].low };
}
