// Takip listesi: yıldızlanan setup'tan dondurulmuş plan çıkarma ve kayıttan sonraki mumlarla durum hesabı.
// Saf fonksiyonlar (DOM yok). Dolum kuralları backtest motoruyla aynı: stop-emir seviyeyi geçince (boşlukta açılış),
// limit seviyeye gelince (boşlukta açılış), aynı mumda stop ve hedef görülürse stop, dolum mumunda hedef sayılmaz.

export const WATCH_STATE = {
  waiting: 'Bekliyor',
  entered: 'Girildi',
  stopped: 'Stop oldu',
  done: 'Son hedef görüldü',
  missed: 'Girişe gelmedi',
  invalid: 'Bozuldu (giriş öncesi)',
  expired: 'Süre doldu',
};
export const PLAN_NAME = { break: 'B kırılımı', zone: 'Limit bölge', triangle: 'Üçgen kırılımı', elimit: 'E limiti (C–D %61,8)', econfirm: 'E onayı' };
const OPEN = new Set(['waiting', 'entered']);
export const isOpen = (st) => OPEN.has(st);

/**
 * Üçgenin çizgileri, zamanlarla (indeksler mumlar kaydıkça değişir): düz kenar, eğik kenar, önceki hareket, kırılım anı.
 * @param tAt  indeks → zaman
 */
export function triangleShape(s, tAt) {
  const L = s.slopeLine;
  return {
    flat: { t1: tAt(s.first.i), price: s.level, title: s.type === 'asc' ? 'Direnç' : 'Destek' },
    slope: { t1: tAt(L.i1), p1: L.p1, t2: tAt(L.i2), p2: L.p2 },
    prior: s.prior ? { from: { time: tAt(s.prior.from.i), price: s.prior.from.price }, to: { time: tAt(s.prior.to.i), price: s.prior.to.price } } : null,
    breakTime: s.breakIdx >= 0 ? tAt(s.breakIdx) : null,
  };
}

/**
 * Taramadaki setup'tan (dalga-3 ya da üçgen) takip kaydı oluşturur. Pivot indeksleri zamana çevrilir
 * (mumlar kaydırıldıkça indeksler değişir; zaman değişmez).
 * @param s        setup (coin/instId eklenmiş)
 * @param candles  setup'ın indekslerinin ait olduğu mumlar (dalga-3: son 300, üçgen: 600)
 * @param ctx      { tf: TIMEFRAMES[...] , mode, now }
 */
export function snapshot(s, candles, ctx) {
  const tAt = (i) => (i <= candles.length - 1 ? candles[i].time : candles[candles.length - 1].time + (i - candles.length + 1) * ctx.tf.ms);
  const pt = (p, label) => ({ time: tAt(p.i), price: p.price, type: p.type, label });
  const base = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    savedAt: ctx.now ?? Date.now(),
    coin: s.coin, instId: s.instId, tf: ctx.tf.id, mode: ctx.mode, d: s.d, direction: s.direction,
    score: s.score, priceAtSave: s.price, note: '', lastStatus: null,
  };
  if (s.kind === 'triangle') {
    const L = s.levels;
    return {
      ...base,
      kind: 'triangle',
      key: `${s.coin}|${ctx.tf.id}|tri|${s.type}|${tAt(s.first.i)}`,
      title: `${s.typeLabel} · ${s.contextLabel}`,
      points: [...s.flat.map((p) => pt(p, '')), ...s.slope.map((p) => pt(p, ''))],
      lines: [{ price: s.level, kind: 'flat', title: s.type === 'asc' ? 'Direnç' : 'Destek' }],
      shape: triangleShape(s, tAt),
      plans: [{
        type: 'triangle',
        entryKind: s.state === 'broken' ? 'market' : 'stop',
        legs: [s.state === 'broken' ? s.price : L.breakLevel],
        stop: L.stop,
        targets: L.targets.filter((x) => s.d * (x.price - L.entry) > 0).sort((a, b) => s.d * (a.price - b.price)).map((x) => ({ name: x.name, price: x.price })),
        cancelBeyond: L.stop, cancelFav: null, activeFrom: null,
      }],
    };
  }
  if (s.kind === 'abcde') {
    const P = s.points;
    const L = s.levels;
    const line = (l) => ({ t1: tAt(l.i1), p1: l.p1, t2: tAt(l.i2), p2: l.p2 });
    const plans = [];
    for (const p of s.plans) {
      const limitOpen = p.type === 'elimit' && (p.state === 'waiting' || p.state === 'approaching');
      const marketNow = (p.type === 'elimit' && p.state === 'filled') || (p.type === 'econfirm' && p.state === 'ready');
      if (!limitOpen && !marketNow) continue;
      const entry = limitOpen ? p.level : s.price;
      plans.push({
        type: p.type,
        entryKind: limitOpen ? 'limit' : 'market',
        legs: [entry],
        stop: p.stop,
        targets: L.targets.filter((x) => s.d * (x.price - entry) > 0).map((x) => ({ name: x.name, price: x.price })),
        cancelBeyond: null, cancelFav: limitOpen ? P.D.price : null, activeFrom: null,
      });
    }
    const names = ['3', 'A', 'B', 'C', 'D', s.forming ? 'E?' : 'E'];
    return {
      ...base,
      kind: 'abcde',
      key: `${s.coin}|${ctx.tf.id}|abcde|${s.direction}|${tAt(P.p0.i)}|${tAt(P.A.i)}|${tAt(P.C.i)}`,
      title: `${s.variantLabel} · ${s.stateLabel}`,
      points: [P.p0, P.A, P.B, P.C, P.D, P.E].map((p, n) => pt(p, names[n])),
      lines: [], // stop zaten plan çizgisi
      shape: { lines: [line(s.lineAC), line(s.lineBD)], until: tAt(P.E.i + Math.max(5, Math.round((P.E.i - P.p0.i) * 0.25))) },
      plans,
    };
  }
  const plans = [];
  if (s.phase === 'complete' && s.levels && (s.state === 'ready' || s.state === 'triggered')) {
    const L = s.levels;
    plans.push({
      type: 'break',
      entryKind: s.state === 'triggered' ? 'market' : 'stop',
      legs: [L.entry],
      stop: L.stop,
      targets: L.targets.map((x) => ({ name: `Hedef (${x.k} × W1)`, price: x.price })),
      cancelBeyond: s.points.p2.price, cancelFav: null, activeFrom: null,
    });
  }
  const z = s.zone;
  if (z && ['waiting', 'approaching', 'filled'].includes(z.state)) {
    plans.push({
      type: 'zone',
      entryKind: z.state === 'filled' ? 'market' : 'limit',
      legs: z.state === 'filled' ? [s.price] : z.legs,
      stop: z.stop,
      targets: z.targets.map((x) => ({ name: `Hedef (${x.k} × W1)`, price: x.price })),
      cancelBeyond: null, cancelFav: s.abc?.B.price ?? null,
      activeFrom: z.activeFrom != null && z.state !== 'filled' ? tAt(z.activeFrom) : null,
    });
  }
  const p2 = s.points.p2 || s.points.cNow;
  return {
    ...base,
    kind: 'wave3',
    key: `${s.coin}|${ctx.tf.id}|w3|${s.direction}|${tAt(s.points.p0.i)}|${tAt(s.points.p1.i)}`,
    title: `${s.phase === 'forming' ? 'Dalga 2 sürüyor' : 'Dalga 2 tamam'}${z?.perfect ? ' · ★ mükemmel' : ''}`,
    points: [
      pt(s.points.p0, '0'), pt(s.points.p1, '1'),
      ...(s.abc ? [pt(s.abc.A, 'A'), pt(s.abc.B, 'B')] : []),
      pt(p2, s.phase === 'forming' ? 'C?' : '2'),
    ],
    lines: [{ price: s.points.p0.price, kind: 'inval', title: '0 / geçersiz' }],
    plans,
  };
}

/**
 * Planın kayıttan sonraki durumu.
 * @param plan     snapshot().plans[i]
 * @param candles  kapanmış mumlar (eskiden yeniye) + varsa canlı mum sonda
 * @param savedAt  kayıt anı (ms) — bu andan SONRA açılan mumlar kullanılır
 * @param opts     { d, maxPending (mum, varsayılan 50), price (güncel fiyat) }
 */
export function evaluatePlan(plan, candles, savedAt, opts) {
  const d = opts.d;
  const maxPending = opts.maxPending ?? 50;
  const legs = plan.legs.map((level) => ({ level, w: 1 / plan.legs.length, filled: plan.entryKind === 'market', price: plan.entryKind === 'market' ? level : null }));
  const bars = candles.filter((c) => c.time >= savedAt);
  let state = plan.entryKind === 'market' ? 'entered' : 'waiting';
  let entryTime = plan.entryKind === 'market' ? savedAt : null;
  let exitPrice = null, exitTime = null, hit = 0, pendingBars = 0;
  const t1 = plan.targets[0]?.price;

  for (const b of bars) {
    const adverse = d === 1 ? b.low : b.high;
    const fav = d === 1 ? b.high : b.low;
    if (state === 'waiting') {
      pendingBars++;
      if (plan.cancelBeyond != null && d * (adverse - plan.cancelBeyond) < 0) { state = 'invalid'; break; }
      const fills = [];
      if (plan.activeFrom == null || b.time >= plan.activeFrom) {
        for (const leg of legs) {
          if (leg.filled) continue;
          if (plan.entryKind === 'stop' && d * (fav - leg.level) >= 0) {
            leg.price = d === 1 ? Math.max(leg.level, b.open) : Math.min(leg.level, b.open);
          } else if (plan.entryKind === 'limit' && d * (adverse - leg.level) <= 0) {
            leg.price = d === 1 ? Math.min(leg.level, b.open) : Math.max(leg.level, b.open);
            if (d * (leg.price - plan.stop) <= 0) { state = 'invalid'; break; }
          } else continue;
          leg.filled = true;
          fills.push(leg);
        }
      }
      if (state === 'invalid') break;
      if (!fills.length) {
        if (plan.cancelFav != null && d * (fav - plan.cancelFav) > 0) { state = 'missed'; break; }
        if (t1 != null && d * (fav - t1) >= 0) { state = 'missed'; break; }
        if (pendingBars > maxPending) { state = 'expired'; break; }
        continue;
      }
      state = 'entered';
      entryTime = b.time;
      if (d * (adverse - plan.stop) <= 0) { state = 'stopped'; exitPrice = d === 1 ? Math.min(plan.stop, b.open) : Math.max(plan.stop, b.open); exitTime = b.time; break; }
      continue; // dolum mumunda hedef sayılmaz
    }
    // Pozisyon açık: kalan limit bacakları dolabilir
    if (plan.entryKind === 'limit') {
      for (const leg of legs) {
        if (leg.filled || d * (adverse - leg.level) > 0) continue;
        const px = d === 1 ? Math.min(leg.level, b.open) : Math.max(leg.level, b.open);
        if (d * (px - plan.stop) <= 0) continue;
        leg.filled = true;
        leg.price = px;
      }
    }
    if (d * (adverse - plan.stop) <= 0) { state = 'stopped'; exitPrice = d === 1 ? Math.min(plan.stop, b.open) : Math.max(plan.stop, b.open); exitTime = b.time; break; }
    while (hit < plan.targets.length && d * (fav - plan.targets[hit].price) >= 0) hit++;
    if (hit === plan.targets.length && hit > 0) { state = 'done'; exitPrice = plan.targets[hit - 1].price; exitTime = b.time; break; }
  }

  // R: planlanan risk (bacak seviyesi → stop) birimiyle; açık pozisyonda güncel fiyata göre
  const filled = legs.filter((l) => l.filled);
  const mark = exitPrice ?? opts.price ?? candles[candles.length - 1]?.close;
  let R = null, entry = null;
  if (filled.length) {
    R = 0;
    let w = 0;
    for (const l of filled) {
      const risk = d * (l.level - plan.stop);
      if (!(risk > 0)) continue;
      R += l.w * (d * (mark - l.price)) / risk;
      w += l.w;
    }
    entry = filled.reduce((s, l) => s + l.price * l.w, 0) / (w || 1);
  }
  return {
    state,
    stateLabel: WATCH_STATE[state],
    open: isOpen(state),
    entry,
    entryTime,
    filledLegs: filled.length,
    legs: legs.length,
    targetsHit: hit,
    exitPrice,
    exitTime,
    R,
    key: `${state}|${hit}|${filled.length}`, // bildirim için durum anahtarı
  };
}
