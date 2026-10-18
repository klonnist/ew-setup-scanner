// Dalga 4 yerinde daralan / running ABCDE üçgeni: 0 = dalga 3 ucu, ardından A-B-C-D-E (ZigZag'de art arda 6 pivot).
// Kurallar (long; short aynası): C, A'nın sonunu geçemez; D, B'nin sonunu geçemez; E, C'nin sonunu geçemez.
// Tek istisna: B, dalga 3'ün ucunu (0) geçebilir (running). Her bacak alt derecede 3'lü (ABC) olmalı.
// Planlar: E limiti = C–D bacağının %61,8 geri alımı (kural; E aşabilir) ve E onayı (ZigZag döndü, o mumun kapanışı).
// Stop C'nin ötesi; hedefler dalga 3 ucu / thrust / dalga 3 uzantıları. Bacak oranı ≈ 0,618 beklenir (puan).
// Saf fonksiyonlar; DOM ve ağ kullanmaz.
import { zigzag, fillAtr } from './zigzag.js';
import { atr as atrOf } from '../data/indicators.js';
import { findAbc, DEFAULTS as W3 } from './wave3.js';
import { evaluate } from '../ew/engine/analyze.js';

export const ABCDE_DEFAULTS = {
  abcdeSens: [2, 3, 4.5, 6], // ana ZigZag eşikleri (× ATR); büyük üçgenler için 6 da taranır
  innerAbc: 'require', // 'require': her bacak 3'lü olmalı | 'prefer': elemez, puanı düşürür
  abcdeDivisors: [1.5, 2, 2.5, 3, 4, 5], // iç ABC için alt eşik = ana eşik ÷ bölen
  abcLog: false, // bacak iç ABC kontrolü doğrusal ölçekte (TradingView varsayılanı gibi)
  w3Check: 'prefer', // önceki hareket 5 dalgalı itki (dalga 3) mi: 'require' elenir | 'prefer' yalnızca puan
  minW3Atr: 4, // dalga 3 en az bu × ATR
  abcdeTolAtr: 0.05, // C/A, D/B, E/C karşılaştırmasında tolerans (× ATR)
  abcdeStopAtr: 0.25, // stop: C'nin bu × ATR ötesi
  abcdeRecent: 10, // E onayı bu kadar mum içindeyse "Girişe hazır", daha eskiyse "E eski"
  abcdeEntry: 'both', // 'limit': E = C–D bacağının %61,8'inde limit (kural) | 'confirm': E onaylanınca | 'both'
  eRetr: 0.618, // E limiti: C–D bacağının bu oranı
  ratioTol: 0.15, // bacak oranı 0,618'e bu kadar yakınsa uyumlu sayılır (yalnızca puan)
  approachAtr: 0.5, // fiyat limite bu × ATR yaklaşınca işaretlenir
  abcdeTarget: 'thrust', // ana hedef: 'top' dalga 3 ucu | 'thrust' | 'e1236' | 'e1618'
  abcdeMinRR: 1,
  abcdeVariant: 'all', // 'all' | 'running' | 'contracting'
};

export const ABCDE_STATE = {
  forming: 'E oluşuyor',
  ready: 'Girişe hazır',
  old: 'E eski',
  target: 'Hedef 1 görüldü',
  failed: 'Bozuldu (C geçildi)',
};
export const ABCDE_VARIANT = { running: 'Running üçgen', contracting: 'Daralan üçgen' };
export const LEG_NAMES = ['A', 'B', 'C', 'D', 'E'];
const TARGET_KEYS = { top: 'Başlangıç (0)', thrust: 'Thrust (en geniş bacak)', e1236: 'Önceki hareket × 1,236', e1618: 'Önceki hareket × 1,618' };

/** Doğru (i1,p1)-(i2,p2) üzerinde i'deki değer. */
export const lineAt = (L, i) => L.p1 + ((L.p2 - L.p1) * (i - L.i1)) / (L.i2 - L.i1);

/**
 * Dalga 3'ün başı: 0'dan geriye, 0'ı aşan bir ters pivot görülene kadar en uç aynı tipli pivot
 * (long: 0'dan önceki en düşük dip; aradaki tepeler 0'ın altında kalmalı).
 */
function wave3Start(pivots, j0, d) {
  let best = null;
  for (let j = j0 - 1; j >= 0; j--) {
    const p = pivots[j];
    if (p.type === pivots[j0].type) { if (d * (p.price - pivots[j0].price) > 0) break; continue; }
    if (!best || d * (p.price - best.price) < 0) best = p;
  }
  return best;
}

/**
 * Önceki hareket (S → 0) alt derecede 5 dalgalı itki mi. Alt ZigZag'in iç pivotlarından 1-2-3-4 seçilir
 * (aradaki küçük dalgalanmalar alt dereceye ait sayılır); temel kuralları geçen adaylar kural motorunda
 * itki olarak denenir. Kaba dereceden başlar; ilk geçerli sayım döner. Bulunamazsa { ok: false }.
 */
function impulseOf(candles, atrArr, S, P0, k, o) {
  if (P0.i - S.i < 5) return { ok: false };
  const d = S.type === 'L' ? 1 : -1;
  const MAX_PIVOTS = 20; // kombinasyon sayısını sınırla
  for (const div of o.abcdeDivisors) {
    const { pivots } = zigzag(candles, atrArr, k / div, { from: S.i, to: P0.i, start: { i: S.i, type: S.type } });
    const inner = pivots.filter((p) => p.i > S.i && p.i < P0.i);
    if (inner.length < 4) continue;
    if (inner.length > MAX_PIVOTS) break; // daha ince dereceler daha da kalabalık
    const tops = inner.filter((p) => p.type !== S.type), bots = inner.filter((p) => p.type === S.type);
    const v = (p) => d * p.price; // long gibi düşün
    for (const w1 of tops) {
      if (v(w1) >= v(P0)) continue;
      for (const w2 of bots) {
        if (w2.i <= w1.i || v(w2) <= v(S)) continue; // 2, 1'in başını geçemez
        for (const w3 of tops) {
          if (w3.i <= w2.i || v(w3) <= v(w1) || v(w3) > v(P0)) continue; // 3, 1'i geçmeli
          for (const w4 of bots) {
            if (w4.i <= w3.i || v(w4) <= v(w1)) continue; // 4, 1 bölgesine giremez
            const ev = evaluate('impulse', [S, w1, w2, w3, w4, P0].map((p) => ({ t: p.i, p: p.price })), { ruleSet: o.ruleSet, logScale: o.abcLog });
            if (ev.valid) return { ok: true, div, points: [w1, w2, w3, w4] };
          }
        }
      }
    }
  }
  return { ok: false };
}

/** E'nin ZigZag'de onaylandığı ilk mum: fiyat E'den k × ATR döndü. */
function confirmIndex(candles, atrArr, E, d, k) {
  for (let i = E.i + 1; i < candles.length; i++) {
    const move = d === 1 ? candles[i].high - E.price : E.price - candles[i].low;
    if (move >= k * atrArr[Math.min(i, atrArr.length - 1)]) return i;
  }
  return -1;
}

/** Bir coinin mumlarında ABCDE üçgenlerini bulur (tüm dereceler, tekrarsız). */
export function findAbcde(candles, options = {}, live = null) {
  const o = { ...W3, ...ABCDE_DEFAULTS, ...options };
  if (candles.length < 60) return [];
  const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low), closes = candles.map((c) => c.close);
  const atrArr = fillAtr(atrOf(highs, lows, closes, 14));
  const all = live ? [...candles, live] : candles;
  const last = all.length - 1;
  const price = all[last].close;
  const out = [];
  const seen = new Set();

  for (const k of o.abcdeSens) {
    const { pivots, tentative } = zigzag(candles, atrArr, k);
    // Tamamlanmış: son 6 onaylı pivot 0-A-B-C-D-E. Oluşuyor: son 5 onaylı 0-A-B-C-D + E tentative.
    const cands = [];
    if (pivots.length >= 7) cands.push({ pts: pivots.slice(-6), j0: pivots.length - 6, forming: false });
    if (pivots.length >= 6 && tentative) cands.push({ pts: [...pivots.slice(-5), tentative], j0: pivots.length - 5, forming: true });
    for (const c of cands) {
      const key = `${c.pts[0].i}|${c.pts[5].i}|${c.forming}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = evaluateAbcde({ all, candles, atrArr, pivots, cand: c, k, o, price, last });
      if (t) out.push(t);
    }
  }
  // Aynı üçgen farklı derecelerde bulunabilir: zamanda çakışan aynı yönlülerden puanı yüksek olanı tut.
  // Bir pivot kaydırılmış ters yönlü sayım (ör. A'yı 0 sayan) da aynı üçgendir: 4+ ortak pivot varsa iç yapısı tam, puanı yüksek olan kalır.
  out.sort((a, b) => b.innerOk - a.innerOk || b.score - a.score || b.points.E.i - a.points.E.i);
  const kept = [];
  const idx = (t) => new Set(['p0', 'A', 'B', 'C', 'D', 'E'].map((n) => t.points[n].i));
  for (const t of out) {
    const ti = idx(t);
    const dup = kept.some((x) => {
      if (x.d === t.d) return t.points.p0.i <= x.points.E.i && x.points.p0.i <= t.points.E.i;
      let n = 0;
      for (const i of idx(x)) if (ti.has(i)) n++;
      return n >= 4;
    });
    if (!dup) kept.push(t);
  }
  return kept;
}

function evaluateAbcde({ all, candles, atrArr, pivots, cand, k, o, price, last }) {
  const [P0, A, B, C, D, E] = cand.pts;
  const d = P0.type === 'H' ? 1 : -1; // 0 tepe → yükselen dalga 3 → long
  if (o.direction === 'long' && d !== 1) return null;
  if (o.direction === 'short' && d !== -1) return null;
  const atrE = atrArr[Math.min(E.i, candles.length - 1)];
  const tol = o.abcdeTolAtr * atrE;

  // Kullanıcının kuralları (d ile çarpınca hep long gibi): C > A, D < B, E > C. B > 0 serbest (running).
  const rules = [
    { id: 'CA', name: "C, A'nın sonunu geçmedi", ok: d * (C.price - A.price) > -tol },
    { id: 'DB', name: "D, B'nin sonunu geçmedi", ok: d * (B.price - D.price) > -tol },
    { id: 'EC', name: "E, C'nin sonunu geçmedi", ok: d * (E.price - C.price) > -tol },
  ];
  if (rules.some((r) => !r.ok)) return null;
  const variant = d * (B.price - P0.price) > 0 ? 'running' : 'contracting';
  if (o.abcdeVariant !== 'all' && o.abcdeVariant !== variant) return null;

  // Dalga 3
  const S = wave3Start(pivots, cand.j0, d);
  if (!S) return null;
  const w3 = Math.abs(P0.price - S.price);
  if (w3 < o.minW3Atr * atrArr[P0.i]) return null;
  // Önceki hareket gerçekten 5 dalgalı itki mi (dalga 3)?
  const w3Impulse = impulseOf(candles, atrArr, S, P0, k, o);
  if (o.w3Check === 'require' && !w3Impulse.ok) return null;
  const w3Bigger = w3 > Math.abs(A.price - P0.price);

  // İç yapı: her bacak 3'lü mü
  const pts = [P0, A, B, C, D, E];
  const legs = [];
  const abcOpts = { ...o, subDivisors: o.abcdeDivisors };
  for (let n = 1; n <= 5; n++) {
    const p = pts[n - 1], q = pts[n];
    const leg = { name: LEG_NAMES[n - 1], from: p, to: q, len: Math.abs(q.price - p.price), bars: q.i - p.i, abc: null };
    // Oluşan E'nin iç yapısı henüz bilinemez
    if (!(cand.forming && n === 5) && q.i - p.i >= 3) {
      const r = findAbc(candles, atrArr, p.i, q.i, p.type, k, abcOpts);
      if (!r.none) leg.abc = { kind: r.kind, div: r.div, A: r.A, B: r.B };
    }
    legs.push(leg);
  }
  const missing = legs.filter((l, n) => !l.abc && !(cand.forming && n === 4)).map((l) => l.name);
  if (o.innerAbc === 'require' && missing.length) return null;

  const lineAC = { i1: A.i, p1: A.price, i2: C.i, p2: C.price };
  const lineBD = { i1: B.i, p1: B.price, i2: D.i, p2: D.price };
  const widest = Math.max(legs[0].len, legs[1].len);
  const stop = C.price - d * o.abcdeStopAtr * atrE;

  // E limiti: C–D bacağının %61,8'i (E = D − 0,618 × (D − C)); E bunu aşabilir (stop C'nin ötesinde).
  const eLimit = D.price - d * o.eRetr * Math.abs(D.price - C.price);

  // Hedefler: dalga 3 ucu (running'de B daha uçsa B), thrust (E'den en geniş bacak kadar; E oluşuyorsa limitten), uzantılar (log)
  const top = d * (B.price - P0.price) > 0 ? B.price : P0.price;
  const lw = Math.log(P0.price / S.price);
  const eBase = cand.forming ? eLimit : E.price;
  const targets = [
    { key: 'top', name: variant === 'running' ? "B ucu (0'ın ötesi)" : TARGET_KEYS.top, price: top },
    { key: 'thrust', name: TARGET_KEYS.thrust, price: eBase + d * widest },
    { key: 'e1236', name: TARGET_KEYS.e1236, price: P0.price * Math.exp(0.236 * lw) },
    { key: 'e1618', name: TARGET_KEYS.e1618, price: P0.price * Math.exp(0.618 * lw) },
  ].sort((a, b) => d * (a.price - b.price));
  const t1 = targets[0].price;

  const mainFor = (entry) => {
    const want = targets.find((t) => t.key === o.abcdeTarget);
    if (want && d * (want.price - entry) > 0) return want;
    return targets.find((t) => d * (t.price - entry) > 0) ?? targets[targets.length - 1];
  };
  const rrOf = (entry, main) => { const risk = d * (entry - stop); return risk > 0 ? (d * (main.price - entry)) / risk : 0; };
  /** Girişten sonra: stop görüldü → stopped; hedef 1 görüldü → target; yoksa open (aynı mumda ikisi → stop). */
  const after = (from) => {
    for (let i = from + 1; i <= last; i++) {
      const adverse = d === 1 ? all[i].low : all[i].high;
      if (d * (adverse - stop) <= 0) return 'stopped';
      const fav = d === 1 ? all[i].high : all[i].low;
      if (d * (fav - t1) >= 0) return 'target';
    }
    return 'open';
  };

  const plans = [];
  // 1) E limiti (kural): D'den sonra fiyat limite gelince dolar; gelmeden D aşılırsa ya da E limite inmeden onaylanırsa kaçtı
  if (o.abcdeEntry !== 'confirm') {
    let st = 'waiting', fillIdx = -1, fill = null;
    for (let i = D.i + 1; i <= last; i++) {
      const adverse = d === 1 ? all[i].low : all[i].high;
      if (d * (adverse - eLimit) <= 0) { fillIdx = i; fill = d === 1 ? Math.min(eLimit, all[i].open) : Math.max(eLimit, all[i].open); break; }
      const fav = d === 1 ? all[i].high : all[i].low;
      if (d * (fav - D.price) > 0) { st = 'missed'; break; }
    }
    if (fillIdx >= 0) {
      const adverse = d === 1 ? all[fillIdx].low : all[fillIdx].high;
      if (d * (fill - stop) <= 0 || d * (adverse - stop) <= 0) st = 'stopped'; // dolum mumunda stop görüldü
      else { const a = after(fillIdx); st = a === 'open' ? 'filled' : a; } // hedef dolum mumunda sayılmaz
    } else if (st === 'waiting' && !cand.forming) st = 'missed'; // E onaylandı ama limite inmedi
    if (st === 'waiting' && d * (price - eLimit) <= o.approachAtr * atrE) st = 'approaching';
    const entry = fill ?? eLimit;
    const main = mainFor(entry);
    plans.push({ type: 'elimit', entryKind: 'limit', level: eLimit, entry, fillIdx, state: st, stateLabel: PLAN_STATE[st], stop, main, rr: rrOf(entry, main) });
  }
  // 2) E onayı: ZigZag E'yi onaylayınca o mumun kapanışından
  let confirmIdx = -1;
  if (!cand.forming) {
    confirmIdx = confirmIndex(all, atrArr, E, d, k);
    if (confirmIdx < 0) return null;
  }
  if (o.abcdeEntry !== 'limit' && confirmIdx >= 0) {
    const entry = all[confirmIdx].close;
    const a = after(confirmIdx);
    const st = a === 'open' ? (last - confirmIdx <= o.abcdeRecent ? 'ready' : 'old') : a;
    const now = st === 'ready' ? price : entry;
    const main = mainFor(now);
    plans.push({ type: 'econfirm', entryKind: 'market', level: entry, entry, fillIdx: confirmIdx, state: st, stateLabel: PLAN_STATE[st], stop, main, rr: rrOf(now, main) });
  }

  // Yapı durumu
  let state;
  if (cand.forming) state = 'forming';
  else {
    const a = after(confirmIdx);
    state = a === 'stopped' ? 'failed' : a === 'target' ? 'target' : last - confirmIdx <= o.abcdeRecent ? 'ready' : 'old';
  }

  // Bacak oranları: her bacak bir öncekinin ≈ 0,618'i beklenir (aşmalar olabilir → yalnızca puan)
  const innerOk = missing.length === 0;
  const ratios = legs.slice(1).map((l, n) => ({ name: `${l.name}/${legs[n].name}`, r: l.len / legs[n].len, forming: cand.forming && n === 3 }));
  const near618 = ratios.filter((x) => !x.forming && Math.abs(x.r - 0.618) <= o.ratioTol).length;
  const score = Math.min(100, Math.max(0, Math.round(45 + 5 * legs.filter((l) => l.abc).length + 6 * near618 + (variant === 'running' ? 3 : 0) + Math.min(8, (w3 / widest) * 4) - (innerOk ? 0 : 10) + (w3Impulse.ok ? 8 : -8))));

  const best = plans.find((p) => OPEN_PLAN.has(p.state)) ?? plans[0] ?? null;
  return {
    kind: 'abcde',
    d,
    direction: d === 1 ? 'long' : 'short',
    variant,
    variantLabel: ABCDE_VARIANT[variant],
    sensitivity: k,
    points: { w3s: S, p0: P0, A, B, C, D, E },
    forming: cand.forming,
    legs,
    ratios,
    rules: [
      ...rules,
      { id: 'B0', name: variant === 'running' ? "B, başlangıcı (0) geçti (running)" : "B, başlangıcın (0) gerisinde kaldı", ok: true },
      { id: 'W3', name: w3Impulse.ok ? `Önceki hareket 5 dalgalı itki (dalga 3, alt derece ÷${w3Impulse.div})` : 'Önceki hareket 5 dalgalı itki değil (dalga 3 olduğu doğrulanamadı)', ok: w3Impulse.ok },
      { id: 'W3A', name: w3Bigger ? "Önceki hareket A bacağından büyük" : "Önceki hareket A bacağından küçük", ok: w3Bigger },
    ],
    innerOk,
    missing,
    lineAC,
    lineBD,
    w3,
    w3Impulse,
    w3Bigger,
    widest,
    state,
    stateLabel: ABCDE_STATE[state],
    confirmIdx,
    plans,
    levels: { eLimit, stop, targets, atr: atrE, entry: best?.entry ?? eLimit, main: best?.main ?? targets[0] },
    rr: best?.rr ?? 0,
    price,
    score,
  };
}

export const PLAN_STATE = {
  waiting: 'Limit bekliyor',
  approaching: 'Limite yaklaştı',
  filled: 'Limit doldu',
  ready: 'Girişe hazır',
  old: 'Giriş eski',
  missed: 'Limite gelmedi',
  stopped: 'Stop oldu',
  target: 'Hedef 1 görüldü',
};
export const PLAN_NAME_ABCDE = { elimit: 'E limiti (C–D %61,8)', econfirm: 'E onayı' };
const OPEN_PLAN = new Set(['waiting', 'approaching', 'filled', 'ready']);
export const isOpenPlan = (st) => OPEN_PLAN.has(st);

/** Panelde gösterilecekler: açık planı olanlar (bekleyen / dolan limit ya da girişe hazır) ve min R:R. */
export function pickAbcde(all, options = {}) {
  const o = { ...ABCDE_DEFAULTS, ...options };
  return all.filter((t) => t.plans.some((p) => OPEN_PLAN.has(p.state) && p.rr >= o.abcdeMinRR)).sort(compareAbcde);
}

const PLAN_RANK = { filled: 0, ready: 0, approaching: 1, waiting: 2 };
export function compareAbcde(a, b) {
  const rk = (t) => Math.min(5, ...t.plans.map((p) => PLAN_RANK[p.state] ?? 5));
  if (rk(a) !== rk(b)) return rk(a) - rk(b);
  return b.score - a.score;
}

/** Girişten sonraki en uç fiyata göre hangi hedefler görüldü. */
export function abcdeReach(targets, d, mfePrice) {
  const out = {};
  for (const x of targets) out[x.key] = d * (mfePrice - x.price) >= 0;
  return out;
}
