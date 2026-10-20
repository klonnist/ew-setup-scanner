// Diagonal (kama) modu: ZigZag'de art arda 6 pivot 0-1-2-3-4-5, kural motorunda diagonal olarak geçerli
// (dalga 4 dalga 1 bölgesine girer, 1–3 ve 2–4 çizgileri daralır ya da genişler).
// Her diagonal iki ayrı setup üretebilir (Ayarlar → Diagonal türü ile süzülür):
//  - Ending (dönüş): 5. / C dalgası yerinde. Kapanış 2–4 çizgisini kırınca TERS yöne giriş, stop 5'in ötesi,
//    hedefler 4 → 2 → 0 (diagonal'in başı).
//  - Leading (devam): 1. / A dalgası yerinde. Dalga 2 için 0→5'in %61,8'inde limit, stop 0'ın ötesi,
//    hedefler 5'in ucu ve dalga 3 = 1 / 1,618 × dalga 1 (limitten).
// Saf fonksiyonlar; DOM ve ağ kullanmaz.
import { zigzag, fillAtr } from './zigzag.js';
import { atr as atrOf } from '../data/indicators.js';
import { DEFAULTS as W3 } from './wave3.js';
import { evaluate } from '../ew/engine/analyze.js';

export const DIAG_DEFAULTS = {
  diagSens: [2, 3, 4.5, 6], // ana ZigZag eşikleri (× ATR)
  diagKind: 'both', // 'both' | 'ending' | 'leading'
  diagShape: 'all', // 'all' | 'contracting' | 'expanding'
  minDiagAtr: 4, // 0→5 en az bu × ATR
  diagBreakAtr: 0.1, // ending: kapanış 2–4 çizgisinin bu × ATR ötesinde → kırılım
  diagStopAtr: 0.25, // stop tamponu (× ATR): ending 5'in, leading 0'ın ötesi
  diagRecent: 10, // kırılım bu kadar mum içindeyse "Kırıldı", daha eskiyse "Kırılım eski"
  diagRetr: 0.618, // leading: dalga 2 limiti = 0→5'in bu oranı
  diagEndTarget: 'p0', // ending ana hedef: 'p4' | 'p2' | 'p0'
  diagLeadTarget: 'w3a', // leading ana hedef: 'p5' | 'w3a' (1×) | 'w3b' (1,618×)
  diagMinRR: 1,
};

export const DIAG_KIND = { ending: 'Ending diagonal', leading: 'Leading diagonal' };
export const DIAG_SHAPE = { contracting: 'daralan', expanding: 'genişleyen' };
export const DIAG_STATE = {
  waiting: 'Kırılım bekleniyor',
  approaching: 'Kırılıma yakın',
  triggered: 'Kırıldı (giriş)',
  old: 'Kırılım eski',
  failed: 'Bozuldu (5 uzadı)',
  lwaiting: 'Limit bekliyor',
  lapproaching: 'Limite yaklaştı',
  filled: 'Limit doldu',
  missed: 'Limite gelmedi',
  stopped: 'Stop oldu',
  target: 'Hedef 1 görüldü',
};
const OPEN = new Set(['waiting', 'approaching', 'triggered', 'lwaiting', 'lapproaching', 'filled']);
export const isOpenDiag = (st) => OPEN.has(st);
export const DIAG_PLAN = { dend: 'Ending: 2–4 kırılımı', dlead: 'Leading: dalga 2 limiti' };

/** Doğru (i1,p1)-(i2,p2) üzerinde i'deki değer. */
const lineAt = (L, i) => L.p1 + ((L.p2 - L.p1) * (i - L.i1)) / (L.i2 - L.i1);

/** Bir coinin mumlarında diagonal setup'larını bulur (ending ve/veya leading; tüm dereceler, tekrarsız). */
export function findDiagonals(candles, options = {}, live = null) {
  const o = { ...W3, ...DIAG_DEFAULTS, ...options };
  if (candles.length < 60) return [];
  const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low), closes = candles.map((c) => c.close);
  const atrArr = fillAtr(atrOf(highs, lows, closes, 14));
  const all = live ? [...candles, live] : candles;
  const last = all.length - 1;
  const price = all[last].close;
  const out = [];
  const seen = new Set();

  for (const k of o.diagSens) {
    const { pivots, tentative } = zigzag(candles, atrArr, k);
    // Tamamlanmış: son 6 onaylı pivot. Oluşuyor: son 5 onaylı + 5. dalga tentative (yalnızca ending için).
    const cands = [];
    if (pivots.length >= 6) cands.push({ pts: pivots.slice(-6), forming: false });
    if (pivots.length >= 5 && tentative) cands.push({ pts: [...pivots.slice(-5), tentative], forming: true });
    // Leading: dalga 2 de onaylandıysa (5'ten sonra bir pivot daha) dolan limit görünür kalsın
    if (pivots.length >= 7) cands.push({ pts: pivots.slice(-7, -1), forming: false, afterW2: true });
    for (const c of cands) {
      const key = `${c.pts[0].i}|${c.pts[4].i}|${c.forming}|${!!c.afterW2}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(...evaluateDiagonal({ all, atrArr, cand: c, k, o, price, last }));
    }
  }
  // Aynı diagonal farklı derecelerde bulunabilir: aynı tür ve yönde zamanda çakışanlardan puanı yüksek olan kalır.
  out.sort((a, b) => b.score - a.score || b.points.p5.i - a.points.p5.i);
  const kept = [];
  for (const t of out) {
    const dup = kept.some((x) => x.type === t.type && x.d === t.d && t.points.p0.i <= x.points.p5.i && x.points.p0.i <= t.points.p5.i);
    if (!dup) kept.push(t);
  }
  return kept;
}

function evaluateDiagonal({ all, atrArr, cand, k, o, price, last }) {
  const [P0, P1, P2, P3, P4, P5] = cand.pts;
  const dd = P0.type === 'L' ? 1 : -1; // diagonal'in yönü (yükselen: +1)
  const v = (p) => dd * p.price;
  // Hızlı ön eleme: 1 > 0, 3 > 1, 4 < 3, 4 dalga 1 bölgesinde (örtüşme), 5 > 3 (kesik ending'e motor karar verir)
  if (!(v(P1) > v(P0) && v(P3) > v(P1) && v(P4) < v(P3) && v(P4) < v(P1) && v(P2) > v(P0))) return [];
  const atrE = atrArr[Math.min(P5.i, atrArr.length - 1)];
  const size = Math.abs(P5.price - P0.price);
  if (size < o.minDiagAtr * atrE) return [];

  // Kural motoru: her tür × şekil için değerlendir, geçerli olanların en iyisi
  const pts = [P0, P1, P2, P3, P4, P5].map((p) => ({ t: p.i, p: p.price }));
  const shapes = o.diagShape === 'all' ? ['contracting', 'expanding'] : [o.diagShape];
  const kinds = o.diagKind === 'both' ? ['ending', 'leading'] : [o.diagKind];
  const line13 = { i1: P1.i, p1: P1.price, i2: P3.i, p2: P3.price };
  const line24 = { i1: P2.i, p1: P2.price, i2: P4.i, p2: P4.price };
  const res = [];
  for (const kind of kinds) {
    if (kind === 'leading' && cand.forming) continue; // dalga 2 limiti 5 bitince verilir
    if (kind === 'ending' && cand.afterW2) continue;
    const evs = shapes.map((shape) => evaluate('diagonal', pts, { ruleSet: o.ruleSet, logScale: false }, { kind, shape }))
      .filter((e) => e.valid).sort((a, b) => b.score - a.score);
    if (!evs.length) continue;
    const ev = evs[0];
    const plan = kind === 'ending'
      ? endingPlan({ all, P0, P2, P4, P5, line24, dd, atrE, o, last, price, forming: cand.forming })
      : leadingPlan({ all, P0, P5, dd, atrE, o, last, price, size });
    if (!plan) continue;
    const d = kind === 'ending' ? -dd : dd; // işlem yönü
    res.push({
      kind: 'diagonal',
      type: kind,
      typeLabel: DIAG_KIND[kind],
      shape: ev.variant.shape,
      shapeLabel: DIAG_SHAPE[ev.variant.shape],
      d,
      dd,
      direction: d === 1 ? 'long' : 'short',
      sensitivity: k,
      forming: cand.forming,
      points: { p0: P0, p1: P1, p2: P2, p3: P3, p4: P4, p5: P5 },
      line13,
      line24,
      eval: { label: ev.label, score: ev.score, results: ev.results, warns: ev.warns },
      plans: [plan],
      state: plan.state,
      stateLabel: plan.stateLabel,
      levels: { entry: plan.entry, stop: plan.stop, targets: plan.targets, main: plan.main, atr: atrE },
      rr: plan.rr,
      size,
      price,
      score: Math.min(100, Math.round(ev.score * 0.8 + (ev.warns ? 0 : 10) + (cand.forming ? 0 : 5))),
    });
  }
  return res;
}

/** İşlem yönünde (d) girişten sonra: stop görüldü → stopped, hedef 1 görüldü → target, yoksa open (aynı mumda ikisi → stop). */
function afterEntry(all, from, last, d, stop, t1) {
  for (let i = from + 1; i <= last; i++) {
    const adverse = d === 1 ? all[i].low : all[i].high;
    if (d * (adverse - stop) <= 0) return 'stopped';
    const fav = d === 1 ? all[i].high : all[i].low;
    if (d * (fav - t1) >= 0) return 'target';
  }
  return 'open';
}

const mainOf = (targets, key, entry, d) => {
  const want = targets.find((t) => t.key === key);
  if (want && d * (want.price - entry) > 0) return want;
  return targets.find((t) => d * (t.price - entry) > 0) ?? targets[targets.length - 1];
};
const rrOf = (entry, stop, main, d) => { const risk = d * (entry - stop); return risk > 0 ? (d * (main.price - entry)) / risk : 0; };

/** Ending: diagonal yönünün tersine; kapanış 2–4 çizgisini (tampon dahil) kırınca giriş. */
function endingPlan({ all, P0, P2, P4, P5, line24, dd, atrE, o, last, price, forming }) {
  const d = -dd;
  const buf = o.diagBreakAtr * atrE;
  const stop = P5.price + dd * o.diagStopAtr * atrE; // 5'in ötesi
  let breakIdx = -1, st = 'waiting';
  for (let i = P5.i + 1; i <= last; i++) {
    const ext = dd === 1 ? all[i].high : all[i].low;
    if (!forming && dd * (ext - P5.price) > 0) { st = 'failed'; break; } // 5 uzadı (kırılım öncesi)
    if (d * (all[i].close - (lineAt(line24, i) + d * buf)) > 0) { breakIdx = i; break; }
  }
  const targets = [
    { key: 'p4', name: '4 ucu', price: P4.price },
    { key: 'p2', name: '2 ucu', price: P2.price },
    { key: 'p0', name: "Başlangıç (0)", price: P0.price },
  ].sort((a, b) => d * (a.price - b.price));
  let entry, entryKind;
  if (breakIdx >= 0) {
    entry = all[breakIdx].close;
    entryKind = 'market';
    const a = afterEntry(all, breakIdx, last, d, stop, targets[0].price);
    st = a === 'open' ? (last - breakIdx <= o.diagRecent ? 'triggered' : 'old') : a;
  } else {
    entry = lineAt(line24, last) + d * buf; // tetik: şu anki çizgi seviyesi
    entryKind = 'stop';
    if (st === 'waiting' && Math.abs(price - entry) <= 0.5 * atrE) st = 'approaching';
  }
  if (d * (entry - stop) <= 0) return null; // giriş stop'un yanlış tarafında (çok geç)
  const now = st === 'triggered' ? price : entry;
  const main = mainOf(targets, o.diagEndTarget, now, d);
  return { type: 'dend', entryKind, level: entry, entry, fillIdx: breakIdx, state: st, stateLabel: DIAG_STATE[st], stop, targets, main, rr: rrOf(now, stop, main, d) };
}

/** Leading: diagonal yönünde; dalga 2 için 0→5'in diagRetr oranında limit, stop 0'ın ötesi. */
function leadingPlan({ all, P0, P5, dd, atrE, o, last, price, size }) {
  const d = dd;
  const level = P5.price - d * o.diagRetr * size;
  const stop = P0.price - d * o.diagStopAtr * atrE;
  const targets = [
    { key: 'p5', name: '5 ucu (dalga 1 sonu)', price: P5.price },
    { key: 'w3a', name: 'Dalga 3 = 1 × dalga 1', price: level + d * size },
    { key: 'w3b', name: 'Dalga 3 = 1,618 × dalga 1', price: level + d * 1.618 * size },
  ].sort((a, b) => d * (a.price - b.price));
  let st = 'lwaiting', fillIdx = -1, fill = null;
  for (let i = P5.i + 1; i <= last; i++) {
    const adverse = d === 1 ? all[i].low : all[i].high;
    if (d * (adverse - level) <= 0) { fillIdx = i; fill = d === 1 ? Math.min(level, all[i].open) : Math.max(level, all[i].open); break; }
    const fav = d === 1 ? all[i].high : all[i].low;
    if (d * (fav - P5.price) > 0) { st = 'missed'; break; } // dalga 2 limite inmeden 5 aşıldı
  }
  if (fillIdx >= 0) {
    const adverse = d === 1 ? all[fillIdx].low : all[fillIdx].high;
    if (d * (fill - stop) <= 0 || d * (adverse - stop) <= 0) st = 'stopped';
    else { const a = afterEntry(all, fillIdx, last, d, stop, targets[0].price); st = a === 'open' ? 'filled' : a; }
  } else if (st === 'lwaiting' && d * (price - level) <= 0.5 * atrE) st = 'lapproaching';
  const entry = fill ?? level;
  const main = mainOf(targets, o.diagLeadTarget, entry, d);
  return { type: 'dlead', entryKind: 'limit', level, entry, fillIdx, state: st, stateLabel: DIAG_STATE[st], stop, targets, main, rr: rrOf(entry, stop, main, d) };
}

/** Panelde gösterilecekler: açık plan ve min R:R. */
export function pickDiagonals(all, options = {}) {
  const o = { ...DIAG_DEFAULTS, ...options };
  return all.filter((t) => OPEN.has(t.state) && t.rr >= o.diagMinRR).sort(compareDiagonals);
}

const RANK = { triggered: 0, filled: 0, approaching: 1, lapproaching: 1, waiting: 2, lwaiting: 2 };
export function compareDiagonals(a, b) {
  const ra = RANK[a.state] ?? 5, rb = RANK[b.state] ?? 5;
  if (ra !== rb) return ra - rb;
  return b.score - a.score;
}
