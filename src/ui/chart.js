// Lightweight Charts 5 ile setup grafiği: mumlar, 0-1-A-B-2 dalga yolu, etiketler ve seviye çizgileri.
import { decimals } from './format.js';

const C = {
  bg: '#121822', grid: '#1c2430', text: '#8f99aa',
  up: '#26a69a', down: '#ef5350', wave: '#f0c75e',
  entry: '#3987e5', stop: '#ef5350', inval: '#b06cf0', target: '#7cc4a8',
  zone: '#ff9f43', zoneStop: '#ff6b81',
};

// LWC zamanı UTC gösterir; yerel saat görünsün diye kaydırılır.
const TZ = -new Date().getTimezoneOffset() * 60;
const sec = (ms) => Math.floor(ms / 1000) + TZ;

let current = null;

export function destroyChart() {
  if (current) {
    current.ro?.disconnect();
    current.chart.remove();
    current = null;
  }
}

/**
 * @param el     grafik kabı
 * @param candles kapanmış mumlar (+ canlı mum eklenebilir)
 * @param s      setup (wave3.js çıktısı)
 * @param show   { showBreak, showZone } hangi giriş planlarının çizileceği
 */
export function drawSetup(el, candles, live, s, show = { showBreak: true, showZone: false }) {
  destroyChart();
  const LW = window.LightweightCharts;
  if (!LW) {
    el.innerHTML = '<p class="error">Grafik kütüphanesi yüklenemedi.</p>';
    return;
  }
  const prec = decimals(s.price);
  const chart = LW.createChart(el, {
    width: el.clientWidth,
    height: el.clientHeight,
    layout: { background: { type: 'solid', color: C.bg }, textColor: C.text, fontSize: 11, fontFamily: getComputedStyle(document.body).fontFamily },
    grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
    rightPriceScale: { borderColor: C.grid },
    timeScale: { borderColor: C.grid, timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: { mode: LW.CrosshairMode.Normal },
    localization: { locale: 'tr-TR' },
  });
  const series = chart.addSeries(LW.CandlestickSeries, {
    upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down,
    priceFormat: { type: 'price', precision: prec, minMove: 10 ** -prec },
  });
  const all = live ? [...candles, live] : candles;
  series.setData(all.map((c) => ({ time: sec(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));

  // Dalga yolu ve etiketler
  const { p0, p1 } = s.points;
  const p2 = s.points.p2 || s.points.cNow;
  const pts = [
    { p: p0, label: '0' },
    { p: p1, label: '1' },
    ...(s.abc ? [{ p: s.abc.A, label: 'A' }, { p: s.abc.B, label: 'B' }] : []),
    { p: p2, label: s.phase === 'forming' ? 'C?' : s.abc ? '2 (C)' : '2' },
  ];
  const path = chart.addSeries(LW.LineSeries, {
    color: C.wave, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    priceFormat: { type: 'price', precision: prec, minMove: 10 ** -prec },
  });
  path.setData(pts.map(({ p }) => ({ time: sec(candles[p.i].time), value: p.price })));
  LW.createSeriesMarkers(series, pts.map(({ p, label }) => ({
    time: sec(candles[p.i].time),
    position: p.type === 'H' ? 'aboveBar' : 'belowBar',
    shape: p.type === 'H' ? 'arrowDown' : 'arrowUp',
    color: C.wave,
    text: label,
  })));

  // Seviyeler
  const L = s.levels;
  const line = (price, color, title, style = LW.LineStyle.Dashed) =>
    series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
  line(p0.price, C.inval, '0 / geçersiz', LW.LineStyle.Dotted);
  if (show.showBreak && L) {
    line(L.entry, C.entry, s.state === 'triggered' ? 'Giriş (güncel)' : 'Tetik B', LW.LineStyle.Solid);
    line(L.stop, C.stop, 'Stop');
  } else if (show.showBreak && s.abc) {
    line(s.abc.B.price, C.entry, 'Tetik B', LW.LineStyle.Solid);
  }
  const Z = show.showZone ? s.zone : null;
  if (Z) {
    const nm = (v) => (v === Z.lvC ? `C=${String(Z.cExtK).replace('.', ',')}A` : `%${String(+(Z.retrR * 100).toFixed(1)).replace('.', ',')}`);
    if (Z.perfect) {
      line(Z.confluence, C.zone, `★ ${nm(Z.lvR)} ≈ ${nm(Z.lvC)}`, LW.LineStyle.Solid);
    } else {
      line(Z.near, C.zone, `Bölge ${nm(Z.near)}`, LW.LineStyle.Solid);
      line(Z.far, C.zone, `Bölge ${nm(Z.far)}`, LW.LineStyle.Solid);
    }
    if (Z.front > 0) Z.legs.forEach((lv) => line(lv, C.zone, 'Emir', LW.LineStyle.Dotted));
    line(Z.stop, C.zoneStop, 'Stop (bölge)');
  }
  (L?.targets || Z?.targets || []).forEach((t, i) => line(t.price, C.target, `H${i + 1} ${t.k}`));

  // Görünüm: 0 noktasının biraz öncesinden sona
  const from = Math.max(0, p0.i - Math.round((all.length - p0.i) * 0.25));
  chart.timeScale().setVisibleLogicalRange({ from, to: all.length + 6 });

  const ro = new ResizeObserver(([e]) => {
    const r = e.contentRect;
    if (r.width > 0 && r.height > 0) chart.resize(Math.floor(r.width), Math.floor(r.height));
  });
  ro.observe(el);
  current = { chart, ro };
}

// [etiket, renk, çizgi sınıfı, plan ('' = her zaman)]
export const LEGEND = [
  ['Dalga yolu 0-1-A-B-2', C.wave, '', ''],
  ['Tetik B / giriş', C.entry, '', 'break'],
  ['Stop (B kırılımı)', C.stop, 'dash', 'break'],
  ['Limit bölge kenarları', C.zone, '', 'zone'],
  ['Stop (bölge)', C.zoneStop, 'dash', 'zone'],
  ['0 noktası (geçersizlik)', C.inval, 'dash', ''],
  ['Hedefler', C.target, 'dash', ''],
];

// ---------------------------------------------------------------- üçgen kırılımı
const T = { flat: '#f0c75e', slope: '#5299ec', prior: '#8f99aa', entry: '#3987e5', stop: '#ef5350', mm: '#b06cf0', fib: '#7cc4a8' };

/** Üçgen: düz kenar, eğik kenar (sona uzatılmış), dokunuş işaretleri, önceki hareket, giriş / stop / hedef çizgileri. */
export function drawTriangle(el, candles, live, t) {
  destroyChart();
  const LW = window.LightweightCharts;
  if (!LW) {
    el.innerHTML = '<p class="error">Grafik kütüphanesi yüklenemedi.</p>';
    return;
  }
  const prec = decimals(t.price);
  const pf = { type: 'price', precision: prec, minMove: 10 ** -prec };
  const chart = LW.createChart(el, {
    width: el.clientWidth,
    height: el.clientHeight,
    layout: { background: { type: 'solid', color: C.bg }, textColor: C.text, fontSize: 11, fontFamily: getComputedStyle(document.body).fontFamily },
    grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
    rightPriceScale: { borderColor: C.grid },
    timeScale: { borderColor: C.grid, timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: { mode: LW.CrosshairMode.Normal },
    localization: { locale: 'tr-TR' },
  });
  const series = chart.addSeries(LW.CandlestickSeries, {
    upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down,
    priceFormat: pf,
  });
  const all = live ? [...candles, live] : candles;
  series.setData(all.map((c) => ({ time: sec(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
  const tm = (i) => sec(all[Math.min(i, all.length - 1)].time);
  const lastI = all.length - 1;
  const lineOpts = (color, style = LW.LineStyle.Solid, width = 2) => ({
    color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: pf,
  });

  // Düz kenar: kalıbın başından bugüne (ya da kırılıma)
  const endI = t.breakIdx >= 0 ? t.breakIdx : lastI;
  chart.addSeries(LW.LineSeries, lineOpts(T.flat)).setData([{ time: tm(t.first.i), value: t.level }, { time: tm(endI), value: t.level }]);
  // Eğik kenar: X'ten aynı eğimle bugüne
  const { i1, p1, i2, p2 } = t.slopeLine;
  const at = (i) => p1 + ((p2 - p1) * (i - i1)) / (i2 - i1);
  chart.addSeries(LW.LineSeries, lineOpts(T.slope)).setData([{ time: tm(i1), value: p1 }, { time: tm(endI), value: at(endI) }]);
  // Önceki hareket
  if (t.prior) {
    chart.addSeries(LW.LineSeries, lineOpts(T.prior, LW.LineStyle.Dashed, 1))
      .setData([{ time: tm(t.prior.from.i), value: t.prior.from.price }, { time: tm(t.prior.to.i), value: t.prior.to.price }]);
  }
  // Dokunuş işaretleri
  const marks = [
    ...t.flat.map((p) => ({ p, text: '' })),
    ...t.slope.map((p) => ({ p, text: '' })),
    ...(t.prior ? [{ p: t.prior.from, text: 'başlangıç' }] : []),
  ].sort((a, b) => a.p.i - b.p.i);
  const seenT = new Set();
  LW.createSeriesMarkers(series, marks.filter(({ p }) => !seenT.has(p.i) && seenT.add(p.i)).map(({ p, text }) => ({
    time: tm(p.i),
    position: p.type === 'H' ? 'aboveBar' : 'belowBar',
    shape: 'circle',
    color: p.type === (t.type === 'asc' ? 'H' : 'L') ? T.flat : T.slope,
    text,
  })));

  const L = t.levels;
  const line = (price, color, title, style = LW.LineStyle.Dashed) =>
    series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
  line(L.entry, T.entry, t.state === 'broken' ? 'Giriş (güncel)' : 'Kırılım', LW.LineStyle.Solid);
  line(L.stop, T.stop, 'Stop');
  for (const x of L.targets) {
    if (t.d * (x.price - L.entry) <= 0) continue; // girişin gerisindeki hedefleri çizme
    line(x.price, x.kind === 'mm' ? T.mm : T.fib, x.kind === 'mm' ? 'Ölçülü' : x.name.replace('Geri çekilme ', '').replace('İzdüşüm ', 'İzd. '));
  }

  const from = Math.max(0, (t.prior ? t.prior.from.i : t.first.i) - 10);
  chart.timeScale().setVisibleLogicalRange({ from, to: all.length + 6 });
  const ro = new ResizeObserver(([e]) => {
    const r = e.contentRect;
    if (r.width > 0 && r.height > 0) chart.resize(Math.floor(r.width), Math.floor(r.height));
  });
  ro.observe(el);
  current = { chart, ro };
}

export const TRI_LEGEND = [
  ['Düz kenar', T.flat, ''],
  ['Eğik kenar', T.slope, ''],
  ['Önceki hareket', T.prior, 'dash'],
  ['Kırılım / giriş', T.entry, ''],
  ['Stop', T.stop, 'dash'],
  ['Ölçülü hedef', T.mm, 'dash'],
  ['Fib hedefleri', T.fib, 'dash'],
];

// ---------------------------------------------------------------- ABCDE üçgen (dalga 4)
const A5 = { path: '#e8ebf1', w3: '#8f99aa', ac: '#ef5350', bd: '#ef5350', limit: '#ff9f43', entry: '#3987e5', stop: '#ef5350', target: '#7cc4a8' };

/** ABCDE: 0-A-B-C-D-E yolu ve etiketler, A–C ve B–D çizgileri (ileri uzatılmış), önceki hareket, E limiti / giriş / stop / hedefler. */
export function drawAbcde(el, candles, live, t, { plans = t.plans } = {}) {
  destroyChart();
  const LW = window.LightweightCharts;
  if (!LW) {
    el.innerHTML = '<p class="error">Grafik kütüphanesi yüklenemedi.</p>';
    return;
  }
  const prec = decimals(t.price);
  const pf = { type: 'price', precision: prec, minMove: 10 ** -prec };
  const chart = LW.createChart(el, {
    width: el.clientWidth,
    height: el.clientHeight,
    layout: { background: { type: 'solid', color: C.bg }, textColor: C.text, fontSize: 11, fontFamily: getComputedStyle(document.body).fontFamily },
    grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
    rightPriceScale: { borderColor: C.grid },
    timeScale: { borderColor: C.grid, timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: { mode: LW.CrosshairMode.Normal },
    localization: { locale: 'tr-TR' },
  });
  const series = chart.addSeries(LW.CandlestickSeries, {
    upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down,
    priceFormat: pf,
  });
  const all = live ? [...candles, live] : candles;
  series.setData(all.map((c) => ({ time: sec(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
  const tm = (i) => sec(all[Math.min(i, all.length - 1)].time);
  const lastI = all.length - 1;
  const lineOpts = (color, style = LW.LineStyle.Solid, width = 2) => ({
    color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: pf,
  });
  const P = t.points;
  // Önceki hareket: itki bulunduysa 1-2-3-4 üzerinden, yoksa düz kesikli çizgi
  const imp = t.w3Impulse?.ok ? t.w3Impulse.points : [];
  chart.addSeries(LW.LineSeries, lineOpts(A5.w3, LW.LineStyle.Dashed, 1)).setData([P.w3s, ...imp, P.p0].map((p) => ({ time: tm(p.i), value: p.price })));
  const seq = [P.p0, P.A, P.B, P.C, P.D, P.E];
  chart.addSeries(LW.LineSeries, lineOpts(A5.path, LW.LineStyle.Solid, 1)).setData(seq.map((p) => ({ time: tm(p.i), value: p.price })));
  // A–C ve B–D çizgileri: E'nin biraz ötesine kadar
  const ext = Math.min(lastI, P.E.i + Math.max(5, Math.round((P.E.i - P.p0.i) * 0.25)));
  const ray = (L, color) => {
    const v = (i) => L.p1 + ((L.p2 - L.p1) * (i - L.i1)) / (L.i2 - L.i1);
    chart.addSeries(LW.LineSeries, lineOpts(color)).setData([{ time: tm(L.i1), value: L.p1 }, { time: tm(ext), value: v(ext) }]);
  };
  ray(t.lineAC, A5.ac);
  ray(t.lineBD, A5.bd);
  const names = ['0', 'A', 'B', 'C', 'D', t.forming ? 'E?' : 'E'];
  LW.createSeriesMarkers(series, [
    { time: tm(P.w3s.i), position: P.w3s.type === 'H' ? 'aboveBar' : 'belowBar', shape: 'circle', color: A5.w3, text: '' },
    ...imp.map((p, n) => ({ time: tm(p.i), position: p.type === 'H' ? 'aboveBar' : 'belowBar', shape: 'circle', color: A5.w3, text: `(${n + 1})` })),
    ...seq.map((p, n) => ({ time: tm(p.i), position: p.type === 'H' ? 'aboveBar' : 'belowBar', shape: p.type === 'H' ? 'arrowDown' : 'arrowUp', color: n === 0 ? '#f0c75e' : A5.path, text: names[n] })),
  ].sort((a, b) => a.time - b.time));

  const line = (price, color, title, style = LW.LineStyle.Dashed) =>
    series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
  for (const p of plans) {
    if (p.type === 'elimit') line(p.level, A5.limit, 'E limiti %61,8', LW.LineStyle.Solid);
    else line(p.entry, A5.entry, 'E onayı', LW.LineStyle.Solid);
  }
  line(t.levels.stop, A5.stop, 'Stop (C)');
  for (const x of t.levels.targets) line(x.price, A5.target, x.key === 'top' ? '0 (başlangıç)' : x.key === 'thrust' ? 'Thrust' : x.key === 'e1236' ? '1,236' : '1,618');

  chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, P.w3s.i - 10), to: all.length + 6 });
  const ro = new ResizeObserver(([e]) => {
    const r = e.contentRect;
    if (r.width > 0 && r.height > 0) chart.resize(Math.floor(r.width), Math.floor(r.height));
  });
  ro.observe(el);
  current = { chart, ro };
}

export const ABCDE_LEGEND = [
  ['Önceki hareket', A5.w3, 'dash'],
  ['0-A-B-C-D-E', A5.path, ''],
  ['A–C / B–D çizgileri', A5.ac, ''],
  ['E limiti (C–D %61,8)', A5.limit, ''],
  ['E onayı girişi', A5.entry, ''],
  ['Stop', A5.stop, 'dash'],
  ['Hedefler', A5.target, 'dash'],
];

// ---------------------------------------------------------------- takip listesi
const PLAN_TAG = { zone: ' (bölge)', break: ' (B)', elimit: ' (E limiti)', econfirm: ' (E onayı)' };
const W = { wave: '#f0c75e', entry: '#3987e5', stop: '#ef5350', target: '#7cc4a8', inval: '#b06cf0', flat: '#f0c75e', fill: '#ff9f43' };

/**
 * Takip kaydı: güncel mumlar + kayıttaki seviyeler. Pivotlar zamanla eşlenir; pencere dışında kalanlar çizilmez.
 * @param item  watch kaydı (snapshot)   @param evals  planların evaluatePlan sonuçları
 */
export function drawWatch(el, candles, live, item, evals) {
  destroyChart();
  const LW = window.LightweightCharts;
  if (!LW) {
    el.innerHTML = '<p class="error">Grafik kütüphanesi yüklenemedi.</p>';
    return;
  }
  const all = live ? [...candles, live] : candles;
  const ref = all[all.length - 1]?.close ?? item.priceAtSave;
  const prec = decimals(ref);
  const pf = { type: 'price', precision: prec, minMove: 10 ** -prec };
  const chart = LW.createChart(el, {
    width: el.clientWidth,
    height: el.clientHeight,
    layout: { background: { type: 'solid', color: C.bg }, textColor: C.text, fontSize: 11, fontFamily: getComputedStyle(document.body).fontFamily },
    grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
    rightPriceScale: { borderColor: C.grid },
    timeScale: { borderColor: C.grid, timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: { mode: LW.CrosshairMode.Normal },
    localization: { locale: 'tr-TR' },
  });
  const series = chart.addSeries(LW.CandlestickSeries, {
    upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down, priceFormat: pf,
  });
  series.setData(all.map((c) => ({ time: sec(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
  const times = new Set(all.map((c) => c.time));
  const pts = item.points.filter((p) => times.has(p.time)).sort((a, b) => a.time - b.time);
  if ((item.kind === 'wave3' || item.kind === 'abcde') && pts.length > 1) {
    chart.addSeries(LW.LineSeries, { color: W.wave, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: pf })
      .setData(pts.map((p) => ({ time: sec(p.time), value: p.price })));
  }
  // Kayıt anı ve giriş işaretleri
  const marks = pts.map((p) => ({ time: sec(p.time), position: p.type === 'H' ? 'aboveBar' : 'belowBar', shape: item.kind !== 'triangle' ? (p.type === 'H' ? 'arrowDown' : 'arrowUp') : 'circle', color: W.wave, text: p.label }));
  const savedBar = all.find((c) => c.time >= item.savedAt) || all[all.length - 1];
  if (savedBar) marks.push({ time: sec(savedBar.time), position: item.d === 1 ? 'belowBar' : 'aboveBar', shape: 'square', color: '#e8ebf1', text: '★ kayıt' });
  evals.forEach((ev) => {
    if (!ev.entryTime) return;
    const bar = all.find((c) => c.time >= ev.entryTime);
    if (bar) marks.push({ time: sec(bar.time), position: item.d === 1 ? 'belowBar' : 'aboveBar', shape: item.d === 1 ? 'arrowUp' : 'arrowDown', color: W.fill, text: 'giriş' });
  });
  const seenM = new Set();
  LW.createSeriesMarkers(series, marks.sort((a, b) => a.time - b.time).filter((m) => !seenM.has(m.time + m.text) && seenM.add(m.time + m.text)));

  const line = (price, color, title, style = LW.LineStyle.Dashed) =>
    series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
  const sh = item.shape;
  if (sh) {
    // Üçgenler: tarama ekranındaki çizgiler (zamanlar mumlara oturtulur)
    const t0 = all[0].time, tN = all[all.length - 1].time;
    const snap = (t) => (all.find((c) => c.time >= t) || all[all.length - 1]).time;
    const seg = (color, style, width, a, b) => chart.addSeries(LW.LineSeries, {
      color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: pf,
    }).setData(a.time === b.time ? [a] : [a, b]);
    if (sh.lines) {
      // ABCDE: A–C ve B–D çizgileri, E'nin biraz ötesine kadar
      const last = snap(Math.min(sh.until ?? tN, tN));
      for (const l of sh.lines) {
        const at = (t) => l.p1 + ((l.p2 - l.p1) * (t - l.t1)) / (l.t2 - l.t1 || 1);
        const a = snap(Math.max(l.t1, t0));
        seg(A5.ac, LW.LineStyle.Solid, 2, { time: sec(a), value: at(a) }, { time: sec(last), value: at(last) });
      }
    } else {
      const end = sh.breakTime != null ? Math.min(sh.breakTime, tN) : tN;
      const fStart = snap(Math.max(sh.flat.t1, t0));
      seg(T.flat, LW.LineStyle.Solid, 2, { time: sec(fStart), value: sh.flat.price }, { time: sec(snap(end)), value: sh.flat.price });
      const s = sh.slope;
      const at = (t) => s.p1 + ((s.p2 - s.p1) * (t - s.t1)) / (s.t2 - s.t1 || 1);
      const sStart = snap(Math.max(s.t1, t0));
      seg(T.slope, LW.LineStyle.Solid, 2, { time: sec(sStart), value: at(sStart) }, { time: sec(snap(end)), value: at(snap(end)) });
      if (sh.prior && sh.prior.from.time >= t0) {
        const pa = snap(sh.prior.from.time);
        seg(T.prior, LW.LineStyle.Dashed, 1, { time: sec(pa), value: sh.prior.from.price }, { time: sec(snap(sh.prior.to.time)), value: sh.prior.to.price });
      }
    }
  }
  for (const l of item.lines) {
    if (sh && l.kind === 'flat') continue; // düz kenar zaten segment olarak çizildi
    line(l.price, l.kind === 'flat' ? W.flat : W.inval, l.title, l.kind === 'flat' ? LW.LineStyle.Solid : LW.LineStyle.Dotted);
  }
  item.plans.forEach((p, i) => {
    const tag = item.plans.length > 1 ? PLAN_TAG[p.type] || '' : '';
    p.legs.forEach((lv) => line(lv, W.entry, `Giriş${tag}`, LW.LineStyle.Solid));
    line(p.stop, W.stop, `Stop${tag}`);
    if (i === 0) p.targets.forEach((t, k) => line(t.price, W.target, `H${k + 1}`));
  });

  const first = Math.min(...item.points.map((p) => p.time), item.savedAt, item.shape?.prior?.from.time ?? Infinity);
  const fromIdx = Math.max(0, all.findIndex((c) => c.time >= first) - 10);
  chart.timeScale().setVisibleLogicalRange({ from: fromIdx, to: all.length + 6 });
  const ro = new ResizeObserver(([e]) => {
    const r = e.contentRect;
    if (r.width > 0 && r.height > 0) chart.resize(Math.floor(r.width), Math.floor(r.height));
  });
  ro.observe(el);
  current = { chart, ro };
}
