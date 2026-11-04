// Fib kesişimi: bir itkiden (0→1) sonra A-B; itkinin %61,8 geri çekilmesi ile C = B − 1,272 × A aynı yere düşüyorsa limit giriş.
// Dalga-3 modundaki ★ çakışmasıyla aynı formül; fark: Elliott kuralı, süre şartı yok, itkinin yönünde son dört dönüş noktasına bakılır.
// Seviye, durum ve R:R için zonePlan kullanılır. Fikir: mugiatama34/crypto_technical_analysis (MIT).
import { zigzag, fillAtr } from './zigzag.js';
import { atr as atrOf } from '../data/indicators.js';
import { zonePlan } from './zone.js';
import { DEFAULTS, w1Quality, originOf } from './wave3.js';

export const FIB_DEFAULTS = {
  fibPairs: 'golden', // 'golden': yalnızca 0,618 × 1,272 | 'all': 0,5 / 0,618 / 0,786 × 1,272 / 1,382 / 1,618
  fibSens: [2, 3, 4], // ZigZag eşikleri (× ATR)
  fibTolAtr: 0.5, // iki seviye arası en fazla bu × ATR
  fibMinImpulseAtr: 3, // itki boyu en az bu × ATR
  fibBMin: 0.382, // B, A'yı en az bu oranda geri almalı
  fibBMax: 1, // en fazla bu oranda
  fibStop: 'r886', // 'r886': itkinin %88,6'sı | 'w0': itkinin başı
  fibMarket: 'spot', // 'spot' | 'swap': OKX USDT vadeli (coin listesi ve mumlar); yalnızca bu modda geçerli
};

/** Taramanın mum ve coin listesini aldığı piyasa: vadeli yalnızca fib modunda seçilebilir, diğer modlar hep spot. */
export const marketOf = (o) => (o.mode === 'fib' && o.fibMarket === 'swap' ? 'swap' : 'spot');

const GOLDEN = [[0.618, 1.272]];
const ALL_PAIRS = [0.5, 0.618, 0.786].flatMap((r) => [1.272, 1.382, 1.618].map((e) => [r, e]));

/**
 * 0→1 itki, A itkiye ters, B A'yı kısmen geri alır. Çakışan en iyi oran çifti (0,618 × 1,272 öncelikli).
 * @returns {{ r, e, lvR, lvC, mid, bRet }|null}
 */
export function fibPairOf(P0, P1, A, B, atr, o) {
  const d = P1.price > P0.price ? 1 : -1;
  const L = d * (P1.price - P0.price), lenA = d * (P1.price - A.price);
  if (L < o.fibMinImpulseAtr * atr || !(lenA > 0)) return null;
  const bRet = (d * (B.price - A.price)) / lenA;
  if (bRet < o.fibBMin || bRet > o.fibBMax) return null;
  let best = null;
  for (const [r, e] of o.fibPairs === 'all' ? ALL_PAIRS : GOLDEN) {
    const lvR = P1.price - d * r * L, lvC = B.price - d * e * lenA;
    const diff = Math.abs(lvR - lvC) / atr;
    if (diff > o.fibTolAtr) continue;
    const rank = diff + (r === 0.618 && e === 1.272 ? 0 : 0.25);
    if (!best || rank < best.rank) best = { r, e, lvR, lvC, mid: (lvR + lvC) / 2, bRet, rank };
  }
  if (!best) return null;
  // Bölge A'nın ötesinde (C, A'yı geçer) ve itkinin başından önce olmalı
  if (d * (A.price - best.mid) <= 0 || d * (best.mid - P0.price) <= 0) return null;
  return best;
}

/** Bir coinin mumlarında fib kesişimi kurulumları. Biçim dalga-3 'forming' kurulumuyla aynı (kind: 'fib'). */
export function findFibClusters(candles, options = {}, live = null) {
  const opts = { ...DEFAULTS, ...FIB_DEFAULTS, ...options };
  if (candles.length < 40) return [];
  const atrArr = fillAtr(atrOf(candles.map((c) => c.high), candles.map((c) => c.low), candles.map((c) => c.close), 14));
  const price = live?.close ?? candles[candles.length - 1].close;
  const seen = new Set();
  const out = [];
  for (const k of opts.fibSens) {
    const { pivots, tentative } = zigzag(candles, atrArr, k);
    const n = pivots.length;
    // C oluşuyor: son dört nokta 0-1-A-B. C onaylandı: bir önceki dört nokta (dolan işlem ve kaçan kurulum listede kalır).
    // B henüz oluşurken kurulum yok: B oynadıkça seviye de oynar, limit emir anlamsız olur.
    const wins = [];
    if (n >= 4 && tentative) wins.push({ pts: pivots.slice(n - 4), C: tentative, done: false });
    if (n >= 5) wins.push({ pts: pivots.slice(n - 5, n - 1), C: pivots[n - 1], done: true });
    for (const { pts, C, done } of wins) {
      const key = pts.map((p) => p.i).join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      const s = evaluate({ candles, atrArr, pivots, pts, C, done, k, opts, live, price });
      if (s) out.push(s);
    }
  }
  return out;
}

function evaluate({ candles, atrArr, pivots, pts, C, done, k, opts, live, price }) {
  const [P0, P1, A, B] = pts;
  const d = P1.price > P0.price ? 1 : -1;
  const direction = d === 1 ? 'long' : 'short';
  if (opts.direction !== 'both' && opts.direction !== direction) return null;
  // ATR B'de sabitlenir: seviyeler değişmediği için kurulum sonraki mumlarda ATR oynadı diye kaybolmaz
  const atr = atrArr[B.i];
  const pair = fibPairOf(P0, P1, A, B, atr, opts);
  if (!pair) return null;
  const path = candles.slice(B.i + 1);
  if (live) path.push(live);
  const zone = zonePlan({
    d, p0: P0.price, p1: P1.price, A: A.price, B: B.price, atr, l1Log: Math.abs(Math.log(P1.price) - Math.log(P0.price)), base: null, pathStart: B.i + 1,
  }, path, done, { ...opts, zoneCExt: pair.e, zoneRetr: pair.r, perfectAtr: opts.fibTolAtr, zoneStop: opts.fibStop, targetSet: 'fib' });
  if (!zone || zone.invalid) return null;
  const L = Math.abs(P1.price - P0.price);
  const D1 = P1.i - P0.i, D2 = C.i - P1.i;
  const golden = pair.r === 0.618 && pair.e === 1.272;
  return {
    kind: 'fib',
    phase: 'forming',
    cDone: done,
    w1q: w1Quality(candles, atrArr, P0, P1),
    origin: originOf(pivots, P0, P1, d),
    textbook: null,
    tpl: null,
    fib: { r: pair.r, e: pair.e, lvR: pair.lvR, lvC: pair.lvC, bRet: pair.bRet, golden },
    direction,
    d,
    sensitivity: k,
    points: { p0: P0, p1: P1, p2: null, cNow: { i: C.i, price: C.price, type: C.type } },
    abc: { kind: 'fib', label: 'Fib kesişimi', A, B, results: [], score: 0 },
    impulse: { label: 'İtki', results: [], score: 0 },
    retr: (d * (P1.price - C.price)) / L,
    timeRatio: D2 / (D1 || 1),
    timeOk: true,
    durations: { D1, D2 },
    rsi: { divergence: null, w1Momentum: null },
    volume: null,
    levels: null,
    zone,
    price,
    rr: 0,
    state: 'forming',
    stateLabel: done ? 'C tamam' : 'C oluşuyor',
    barsSince2: null,
    // Sıralama için: önce 0,618 × 1,272, sonra fiyata yakınlık
    score: (golden ? 50 : 30) + Math.max(0, 50 - Math.round((5 * Math.abs(price - zone.confluence)) / atr)),
  };
}
