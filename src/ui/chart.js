// Lightweight Charts 5 ile setup grafiği: mumlar, 0-1-A-B-2 dalga yolu, etiketler ve seviye çizgileri.
import { decimals } from './format.js';

const C = {
  bg: '#121822', grid: '#1c2430', text: '#8f99aa',
  up: '#26a69a', down: '#ef5350', wave: '#f0c75e',
  entry: '#3987e5', stop: '#ef5350', inval: '#b06cf0', target: '#7cc4a8',
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
 */
export function drawSetup(el, candles, live, s) {
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
  const { p0, p1, p2 } = s.points;
  const pts = [
    { p: p0, label: '0' },
    { p: p1, label: '1' },
    ...(s.abc ? [{ p: s.abc.A, label: 'A' }, { p: s.abc.B, label: 'B' }] : []),
    { p: p2, label: s.abc ? '2 (C)' : '2' },
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
  line(L.entry, C.entry, s.state === 'triggered' ? 'Giriş (güncel)' : 'Tetik', LW.LineStyle.Solid);
  line(L.stop, C.stop, 'Stop');
  line(L.invalidation, C.inval, '0 / geçersiz', LW.LineStyle.Dotted);
  L.targets.forEach((t, i) => line(t.price, C.target, `H${i + 1} ${t.k}`));

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

export const LEGEND = [
  ['Dalga yolu 0-1-A-B-2', C.wave, ''],
  ['Tetik / giriş', C.entry, ''],
  ['Stop', C.stop, 'dash'],
  ['0 noktası (geçersizlik)', C.inval, 'dash'],
  ['Hedefler', C.target, 'dash'],
];
