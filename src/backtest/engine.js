// Backtest motoru (saf, DOM'suz; worker'da ve Node testlerinde çalışır).
// Her kapanan mumda canlı tarayıcının yaptığını yapar: son `window` mumla findWave3Setups.
// Yeni çıkan setup'tan emir oluşturur ve sonraki mumlarda simüle eder. Gelecek veri kullanılmaz:
// t mumunda görülen setup'ın emri en erken t+1 mumunda dolabilir (tetiklenmişse t kapanışından piyasa emri).
import { findWave3Setups, DEFAULTS, riskOk } from '../scan/wave3.js';
import { findTriangles, TRI_DEFAULTS, reachOf } from '../scan/triangle.js';
import { findAbcde, ABCDE_DEFAULTS, abcdeReach } from '../scan/abcde.js';
import { findDiagonals, DIAG_DEFAULTS } from '../scan/diagonal.js';

// Üçgen modunda canlı tarayıcıyla aynı uzun pencere (bkz. scanner.js LONG_BARS)
export const TRI_WINDOW = 600;

export const BT_DEFAULTS = {
  window: 300, // canlı taramadaki mum sayısı
  exitTarget: 1, // 0: hedef 1, 1: hedef 2, 2: hedef 3
  feePct: 0.1, // işlem başına komisyon (%), giriş + çıkış
  maxPending: 50, // dolmayan emir kaç mum sonra iptal
  maxHold: 200, // açık pozisyon kaç mum sonra kapanışla kapatılır
};

const sideExt = (c, d) => ({ adverse: d === 1 ? c.low : c.high, fav: d === 1 ? c.high : c.low });

/**
 * @param candles  kapanmış mumlar (eskiden yeniye), [from, to] aralığı + öncesinde ısınma
 * @param cfg      { from, to (ms), opts: tarayıcı ayarları, ...BT_DEFAULTS }
 * @returns {{ trades: object[], stats: { orders, cancelled: {reason: n} } }}
 */
export function backtestCoin(candles, cfg) {
  const c = { ...BT_DEFAULTS, ...cfg };
  const opts = { ...TRI_DEFAULTS, ...ABCDE_DEFAULTS, ...DIAG_DEFAULTS, ...DEFAULTS, ...c.opts, diagnostics: undefined };
  const triMode = opts.mode === 'triangle';
  const abcMode = opts.mode === 'abcde';
  const diagMode = opts.mode === 'diagonal';
  if (triMode || abcMode || diagMode) c.window = Math.max(c.window, TRI_WINDOW);
  const trackers = []; // üçgenler: girişten sonra en uç fiyatı (stop görülene kadar) izler
  const useBreak = opts.entryType !== 'zone';
  const useZone = opts.entryType !== 'break';
  const n = candles.length;
  const startT = Math.max(60, candles.findIndex((x) => x.time >= c.from));
  if (startT < 0 || startT >= n) return { trades: [], stats: { orders: 0, cancelled: {} } };

  const seen = new Set();
  const orders = []; // bekleyen emirler + açık pozisyonlar
  const trades = [];
  const cancelled = {};
  let orderCount = 0;
  const cancel = (o, reason) => { o.done = true; cancelled[o.type + ':' + reason] = (cancelled[o.type + ':' + reason] || 0) + 1; };

  for (let t = startT; t < n; t++) {
    const bar = candles[t];
    const inRange = bar.time <= c.to;

    // 1) Önceki mumlarda oluşan emir / pozisyonları bu mumla ilerlet
    for (const o of orders) if (!o.done && o.created < t) step(o, bar, t);
    for (const k of trackers) if (!k.done && k.start < t) track(k, bar, t);

    if (!inRange) {
      if (!orders.some((o) => !o.done) && !trackers.some((k) => !k.done)) break;
      continue; // aralık bitti: yeni emir yok, açık olanlar kapanana kadar devam
    }

    // 2) Bu mum kapandı: canlı tarayıcı ne görürdü?
    const off = Math.max(0, t + 1 - c.window);
    const win = candles.slice(off, t + 1);
    if (triMode) {
      triangleStep(win, off, bar, t);
      continue;
    }
    if (abcMode) {
      abcdeStep(win, off, bar, t);
      continue;
    }
    if (diagMode) {
      diagStep(win, off, bar, t);
      continue;
    }
    const setups = findWave3Setups(win, opts, null);
    for (const s of setups) {
      if (opts.onlyPerfect && !s.zone?.perfect) continue;
      const abs = (p) => candles[p.i + off].time;
      const base = `${s.direction}|${abs(s.points.p0)}|${abs(s.points.p1)}`;
      if (useBreak && s.phase === 'complete' && (s.state === 'ready' || s.state === 'triggered') && s.rr >= opts.minRR
        && riskOk(s.state === 'triggered' ? bar.close : s.levels.trigger, s.levels.stop, opts)) {
        const key = `B|${base}|${abs(s.points.p2)}`;
        if (!seen.has(key)) {
          seen.add(key);
          orderCount++;
          const L = s.levels;
          const o = {
            type: 'break', d: s.d, created: t, key,
            legs: [{ level: s.state === 'triggered' ? bar.close : L.trigger, w: 1, market: s.state === 'triggered' }],
            stop: L.stop, target: L.targets[Math.min(c.exitTarget, L.targets.length - 1)].price,
            t1: L.targets[0].price, cancelBeyond: s.points.p2.price, cancelFav: null,
            meta: meta(s),
          };
          if (o.legs[0].market) fillLeg(o, o.legs[0], bar.close, t);
          orders.push(o);
        }
      }
      if (useZone && s.phase === 'forming' && s.zone && s.zone.rr >= opts.minRR && riskOk(s.zone.entry, s.zone.stop, opts)) {
        const key = `Z|${base}|${abs(s.abc.A)}|${abs(s.abc.B)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (s.zone.state !== 'waiting' && s.zone.state !== 'approaching') { cancel({ type: 'zone' }, 'geç algılandı'); orderCount++; continue; }
        orderCount++;
        const z = s.zone;
        const w = 1 / z.legs.length;
        orders.push({
          type: 'zone', d: s.d, created: t, key,
          legs: z.legs.map((level) => ({ level, w, market: false })),
          activeFrom: z.activeFrom != null ? z.activeFrom + off : -Infinity,
          stop: z.stop, target: z.targets[Math.min(c.exitTarget, z.targets.length - 1)].price,
          t1: z.targets[0].price, cancelBeyond: null, cancelFav: s.abc.B.price,
          meta: { ...meta(s), strength: z.strength, inside: z.inside },
        });
      }
    }
  }

  // Veri bitti: açık pozisyonlar son kapanıştan "açık" olarak raporlanır, bekleyen emirler iptal.
  const last = candles[n - 1];
  for (const o of orders) {
    if (o.done) continue;
    if (o.legs.some((l) => l.filled)) close(o, last.close, n - 1, 'open');
    else cancel(o, 'veri bitti');
  }
  for (const k of trackers) if (!k.done) finishTrack(k, true);
  return { trades, stats: { orders: orderCount, cancelled } };

  // ---------------------------------------------------------------- üçgen kırılımı
  // Kalıp bu mumun kapanışıyla kırıldıysa (breakIdx = son mum) kapanıştan piyasa emriyle girilir.
  function triangleStep(win, off, bar, t) {
    const last = win.length - 1;
    for (const tr of findTriangles(win, opts, null)) {
      if (tr.state !== 'broken' || tr.breakIdx !== last) continue;
      const key = `T|${tr.type}|${candles[tr.first.i + off].time}|${tr.level}`;
      if (seen.has(key)) continue;
      seen.add(key);
      orderCount++;
      const L = tr.levels;
      if (tr.rr < opts.triMinRR) { cancel({ type: 'triangle' }, 'R:R düşük'); continue; }
      if (!riskOk(bar.close, L.stop, opts)) { cancel({ type: 'triangle' }, 'stop çok yakın'); continue; }
      const o = {
        type: 'triangle', d: tr.d, created: t, key,
        legs: [{ level: bar.close, w: 1, market: true }],
        stop: L.stop, target: L.main.price, t1: L.main.price, cancelBeyond: null, cancelFav: null,
        meta: {
          sensitivity: tr.sensitivity, score: tr.score, pattern: tr.type, context: tr.context,
          // Kırılım seviyesinin kendisi önceki hareketin hangi Fib oranında (bundan gerideki seviyeler 'zaten geçilmiş' sayılır)
          startFib: reachOf(tr, L.breakLevel).mfeFib,
          strength: null, abc: null, retr: null, timeRatio: null,
        },
      };
      fillLeg(o, o.legs[0], bar.close, t);
      orders.push(o);
      // Nereye kadar gitti: hedeften çıkılsa bile stop görülene (ya da maxHold dolana) kadar izlenir.
      trackers.push({ o, tr, start: t, mfe: bar.close, done: false });
    }
  }

  // ---------------------------------------------------------------- ABCDE üçgen (dalga 4)
  // E limiti: üçgen ilk kez "E oluşuyor" görülünce C–D %61,8'e limit emir (D aşılırsa iptal).
  // E onayı: ZigZag E'yi bu mumda onayladıysa kapanıştan piyasa emri.
  function abcdeStep(win, off, bar, t) {
    const last = win.length - 1;
    for (const tr of findAbcde(win, opts, null)) {
      const P = tr.points;
      const abs = (p) => candles[p.i + off].time;
      const base = `${tr.direction}|${abs(P.p0)}|${abs(P.A)}|${abs(P.B)}|${abs(P.C)}|${abs(P.D)}`;
      const meta = { sensitivity: tr.sensitivity, score: tr.score, pattern: tr.variant, context: tr.innerOk ? 'inner' : 'loose', strength: null, abc: tr.w3Impulse.ok ? 'impulse' : 'no-impulse', retr: null, timeRatio: null };
      for (const p of tr.plans) {
        const isLimit = p.type === 'elimit';
        if (isLimit && !tr.forming) continue; // limit yalnızca E oluşurken verilir
        if (!isLimit && tr.confirmIdx !== last) continue; // onay bu mumda
        const key = `${p.type}|${base}${isLimit ? '' : `|${abs(P.E)}`}`;
        if (seen.has(key)) continue;
        seen.add(key);
        orderCount++;
        if (isLimit && p.state !== 'waiting' && p.state !== 'approaching') { cancel({ type: p.type }, 'geç algılandı'); continue; }
        const entry = isLimit ? p.level : bar.close;
        if (p.rr < opts.abcdeMinRR) { cancel({ type: p.type }, 'R:R düşük'); continue; }
        if (!riskOk(entry, p.stop, opts)) { cancel({ type: p.type }, 'stop çok yakın'); continue; }
        const targets = tr.levels.targets;
        const o = {
          type: p.type, d: tr.d, created: t, key,
          legs: [{ level: entry, w: 1, market: !isLimit }],
          activeFrom: -Infinity,
          stop: p.stop, target: p.main.price, t1: targets[0].price,
          cancelBeyond: null, cancelFav: isLimit ? P.D.price : null,
          meta,
        };
        if (!isLimit) fillLeg(o, o.legs[0], bar.close, t);
        orders.push(o);
        trackers.push({ o, d: tr.d, stop: p.stop, start: t, mfe: isLimit ? null : bar.close, done: false, reach: (m) => ({ reach: abcdeReach(targets, tr.d, m) }) });
      }
    }
  }

  // ---------------------------------------------------------------- diagonal
  // Dalga 4 → 5: limit, aday ilk kez "4 oluşuyor" görülünce (3 aşılırsa iptal); 4 onayı bu mumdaysa kapanıştan.
  // Ending: kapanış 2–4 çizgisini bu mumda kırdıysa kapanıştan ters yöne piyasa emri.
  // Leading: diagonal ilk kez tamamlanmış görülünce dalga 2 limiti (5 aşılırsa iptal).
  function diagStep(win, off, bar, t) {
    const last = win.length - 1;
    for (const tr of findDiagonals(win, opts, null)) {
      const P = tr.points;
      const abs = (q) => candles[q.i + off].time;
      for (const p of tr.plans) {
        const key = `${p.type}|${tr.direction}|${abs(P.p0)}|${abs(P.p1)}|${abs(P.p2)}`;
        const isLimit = p.entryKind === 'limit';
        if (!isLimit && !((p.state === 'triggered' || p.state === 'ready') && p.fillIdx === last)) continue; // piyasa: tetik bu mumda
        if (isLimit && p.type === 'd4lim' && !tr.forming && !seen.has(key)) { seen.add(key); continue; } // 4 bitmişken ilk görülen limit verilmez
        if (seen.has(key)) continue;
        seen.add(key);
        orderCount++;
        if (isLimit && p.state !== 'lwaiting' && p.state !== 'lapproaching') { cancel({ type: p.type }, 'geç algılandı'); continue; }
        const entry = isLimit ? p.level : bar.close;
        if (p.rr < opts.diagMinRR) { cancel({ type: p.type }, 'R:R düşük'); continue; }
        if (!riskOk(entry, p.stop, opts)) { cancel({ type: p.type }, 'stop çok yakın'); continue; }
        const cancelFav = !isLimit ? null : p.type === 'd4lim' ? P.p3.price : P.p5.price;
        const o = {
          type: p.type, d: tr.d, created: t, key,
          legs: [{ level: entry, w: 1, market: !isLimit }],
          activeFrom: -Infinity,
          stop: p.stop, target: p.main.price, t1: p.targets[0].price,
          cancelBeyond: null, cancelFav,
          meta: { sensitivity: tr.sensitivity, score: tr.score, pattern: tr.shape, context: tr.type, strength: null, abc: null, retr: null, timeRatio: null },
        };
        if (!isLimit) fillLeg(o, o.legs[0], bar.close, t);
        orders.push(o);
        const targets = p.targets;
        trackers.push({ o, d: tr.d, stop: p.stop, start: t, mfe: isLimit ? null : bar.close, done: false, reach: (m) => ({ reach: abcdeReach(targets, tr.d, m) }) });
      }
    }
  }
  function track(k, b, t) {
    const d = k.d ?? k.tr.d;
    const stop = k.stop ?? k.tr.levels.stop;
    if (k.mfe == null) { // limit emri: dolunca izlemeye başla
      if (k.o.done && !k.o.trade) { k.done = true; return; } // dolmadan iptal
      if (!k.o.legs.some((l) => l.filled)) return;
      k.mfe = k.o.legs[0].price;
      if (k.o.trade?.outcome === 'stop') return finishTrack(k); // dolum mumunda stop
      if (k.o.entryT === t) return; // dolum mumunda fav sayılmaz
    }
    const { adverse, fav } = sideExt(b, d);
    // Stop mumunda fav sayılmaz (mum içi sıra bilinmez)
    if (d * (adverse - stop) <= 0) return finishTrack(k);
    if (d * (fav - k.mfe) > 0) k.mfe = fav;
    if (t - (k.o.entryT ?? k.start) >= c.maxHold) finishTrack(k); // süre girişten sayılır (limit emri sonra dolabilir)
  }

  function finishTrack(k) {
    k.done = true;
    if (k.mfe == null) return;
    const r = k.reach ? k.reach(k.mfe) : reachOf(k.tr, k.mfe);
    const trade = k.o.trade;
    if (trade) Object.assign(trade, r.reach ? { reach: r.reach } : { mfeH: r.mfeH, mfeFib: r.mfeFib });
    else k.o.reach = r; // pozisyon henüz kapanmadı: close() bunu işleme yazar
  }

  // ---------------------------------------------------------------- yardımcılar
  function meta(s) {
    return {
      sensitivity: s.sensitivity, score: s.score, retr: s.retr, timeRatio: s.timeRatio, abc: s.abc?.kind || null,
      widthAtr: s.zone ? s.zone.widthAtr : null, perfect: s.zone ? s.zone.perfect : null,
    };
  }

  function fillLeg(o, leg, price, t) {
    leg.filled = true;
    leg.price = price;
    leg.t = t;
    if (o.entryT == null) o.entryT = t;
  }

  function step(o, b, t) {
    const d = o.d;
    const { adverse, fav } = sideExt(b, d);
    const open = o.legs.some((l) => l.filled);
    const fillsNow = [];

    // Bekleyen bacaklar
    for (const leg of o.legs) {
      if (leg.filled) continue;
      if (o.type === 'break') {
        if (d * (adverse - o.cancelBeyond) < 0) { cancel(o, 'dalga 2 uzadı'); return; }
        if (d * (fav - leg.level) >= 0) {
          const px = d === 1 ? Math.max(leg.level, b.open) : Math.min(leg.level, b.open);
          fillLeg(o, leg, px, t);
          fillsNow.push(leg);
        }
      } else if (t >= o.activeFrom) {
        if (d * (adverse - leg.level) <= 0) {
          const px = d === 1 ? Math.min(leg.level, b.open) : Math.max(leg.level, b.open);
          // Emir aktif olduğunda fiyat zaten stop'un ötesindeyse (süre koşulu beklenirken geçildi) setup bozulmuştur:
          // gerçekte bu emir verilmez. Hiç dolum yoksa iptal, varsa bu bacak atlanır.
          if (d * (px - o.stop) <= 0) {
            if (!o.legs.some((l) => l.filled)) { cancel(o, 'stop seviyesi geçildi'); return; }
            continue;
          }
          fillLeg(o, leg, px, t);
          fillsNow.push(leg);
        }
      }
    }

    const nowOpen = o.legs.some((l) => l.filled);
    if (!nowOpen) {
      if (o.cancelFav != null && d * (fav - o.cancelFav) > 0) return cancel(o, { elimit: 'D aşıldı, E limite gelmedi', dlead: '5 aşıldı, dalga 2 limite gelmedi', d4lim: '3 aşıldı, dalga 4 limite gelmedi' }[o.type] || 'B kırıldı, bölgeye gelmedi');
      if (d * (fav - o.t1) >= 0) return cancel(o, 'hedef 1 dolmadan görüldü');
      if (t - o.created > c.maxPending) return cancel(o, 'süre aşımı');
      return;
    }

    // Pozisyon yönetimi: önce stop (muhafazakâr), sonra hedef (dolum mumunda hedef sayılmaz)
    if (d * (adverse - o.stop) <= 0) {
      const px = d === 1 ? Math.min(o.stop, b.open) : Math.max(o.stop, b.open);
      return close(o, px, t, 'stop');
    }
    if (open && !fillsNow.length && d * (fav - o.target) >= 0) {
      const px = d === 1 ? Math.max(o.target, b.open) : Math.min(o.target, b.open);
      return close(o, px, t, 'hedef');
    }
    if (t - o.entryT >= c.maxHold) return close(o, b.close, t, 'süre');
  }

  function close(o, exit, t, outcome) {
    o.done = true;
    const d = o.d;
    let R = 0, risk = 0;
    for (const leg of o.legs) {
      if (!leg.filled) continue;
      const r = d * (leg.level - o.stop); // planlanan risk (1R)
      if (!(r > 0)) continue;
      const fee = (c.feePct / 100) * (leg.price + exit);
      R += leg.w * ((d * (exit - leg.price) - fee) / r);
      risk += leg.w;
    }
    const filled = o.legs.filter((l) => l.filled);
    const trade = {
      type: o.type,
      dir: d === 1 ? 'long' : 'short',
      created: candles[o.created].time,
      entryTime: candles[o.entryT].time,
      exitTime: candles[t].time,
      entry: filled.reduce((s, l) => s + l.price * l.w, 0) / (risk || 1),
      exit,
      stop: o.stop,
      target: o.target,
      filledLegs: filled.length,
      legs: o.legs.length,
      R,
      outcome,
      bars: t - o.entryT,
      ...o.meta,
      ...(o.reach ? (o.reach.reach ? { reach: o.reach.reach } : { mfeH: o.reach.mfeH, mfeFib: o.reach.mfeFib }) : {}),
    };
    o.trade = trade;
    trades.push(trade);
  }
}

/** İşlem listesinden özet istatistik. */
export function summarize(trades) {
  const closed = trades.filter((t) => t.outcome !== 'open');
  const wins = closed.filter((t) => t.R > 0);
  const losses = closed.filter((t) => t.R <= 0);
  const gw = wins.reduce((s, t) => s + t.R, 0);
  const gl = -losses.reduce((s, t) => s + t.R, 0);
  let eq = 0, peak = 0, maxDD = 0;
  for (const t of [...closed].sort((a, b) => a.exitTime - b.exitTime)) {
    eq += t.R;
    peak = Math.max(peak, eq);
    maxDD = Math.max(maxDD, peak - eq);
  }
  return {
    n: closed.length,
    open: trades.length - closed.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    avgR: closed.length ? (gw - gl) / closed.length : 0,
    totalR: gw - gl,
    pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    maxDD,
    targets: closed.filter((t) => t.outcome === 'hedef').length,
    stops: closed.filter((t) => t.outcome === 'stop').length,
    timeouts: closed.filter((t) => t.outcome === 'süre').length,
  };
}
