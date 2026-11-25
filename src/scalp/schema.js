// Şematik mum grafikleri (SVG). Gerçek fiyat değildir; yalnızca kurgunun nasıl göründüğünü anlatır.
const NS = 'http://www.w3.org/2000/svg';
const COL = {
  up: '#26a69a', down: '#ef5350', grid: '#1c2430', text: '#b6bfcc', muted: '#8f99aa',
  liq: '#f0c75e', msb: '#b06cf0', entry: '#3987e5', stop: '#ef5350', tp1: '#7cc4a8', target: '#3fb950', fake: '#fab219',
};

// Tohumlu gürültü: her çizimde aynı mumlar
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** [[bar, fiyat], ...] dönüş noktalarından mumlar; `wick` = { bar: { low?, high? } } elle iğne. */
export function schemaCandles(path, { seed = 7, noise = 0.35, wick = {} } = {}) {
  const r = rng(seed);
  const out = [];
  for (let s = 0; s < path.length - 1; s++) {
    const [b0, p0] = path[s], [b1, p1] = path[s + 1];
    for (let b = b0; b < b1; b++) {
      const a = p0 + ((p1 - p0) * (b - b0)) / (b1 - b0);
      const z = p0 + ((p1 - p0) * (b + 1 - b0)) / (b1 - b0) + (b + 1 < b1 ? (r() - 0.5) * noise * 2 : 0);
      const open = out.length ? out[out.length - 1].close : a;
      const c = { open, close: z, high: Math.max(open, z) + r() * noise, low: Math.min(open, z) - r() * noise };
      if (wick[b]?.low != null) c.low = wick[b].low;
      if (wick[b]?.high != null) c.high = wick[b].high;
      out.push(c);
    }
  }
  return out;
}

const el = (tag, attrs = {}, text) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};

/**
 * @param svg   hedef <svg>
 * @param spec  { candles, upto (kaç mum görünür), notes: [...] , lo, hi }
 *   note tipleri: { t:'h', y, from, to, color, dash, label, side } yatay çizgi
 *                 { t:'box', x0, x1, y0, y1, color, label }       bölge
 *                 { t:'dot', x, y, color, label, dy }              işaret
 *                 { t:'arrow', x0, y0, x1, y1, color }             ok
 */
export function drawSchema(svg, spec) {
  const W = 720, H = 340, padL = 8, padR = 150, padT = 14, padB = 14;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();
  const cs = spec.candles;
  const lo = spec.lo ?? Math.min(...cs.map((c) => c.low)) - 0.5;
  const hi = spec.hi ?? Math.max(...cs.map((c) => c.high)) + 0.5;
  const nBars = spec.bars ?? cs.length;
  const bw = (W - padL - padR) / nBars;
  const X = (b) => padL + (b + 0.5) * bw;
  const Y = (p) => padT + ((hi - p) / (hi - lo)) * (H - padT - padB);
  const defs = el('defs');
  defs.append(el('marker', { id: `ah-${spec.id}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }));
  defs.firstChild.append(el('path', { d: 'M0 0 L10 5 L0 10 z', fill: 'context-stroke' }));
  svg.append(defs);
  for (let k = 1; k < 5; k++) svg.append(el('line', { x1: padL, x2: W - padR, y1: padT + (k * (H - padT - padB)) / 5, y2: padT + (k * (H - padT - padB)) / 5, stroke: COL.grid }));
  const upto = Math.min(spec.upto ?? cs.length, cs.length);
  const g = el('g');
  for (let i = 0; i < upto; i++) {
    const c = cs[i], col = c.close >= c.open ? COL.up : COL.down;
    g.append(el('line', { x1: X(i), x2: X(i), y1: Y(c.high), y2: Y(c.low), stroke: col, 'stroke-width': 1.2 }));
    const top = Y(Math.max(c.open, c.close)), h = Math.max(1, Math.abs(Y(c.open) - Y(c.close)));
    g.append(el('rect', { x: X(i) - bw * 0.32, y: top, width: bw * 0.64, height: h, fill: col, rx: 1 }));
  }
  svg.append(g);
  const labels = [];
  for (const n of spec.notes || []) {
    const color = COL[n.color] || n.color || COL.text;
    if (n.t === 'box') {
      svg.insertBefore(el('rect', { x: X(n.x0) - bw / 2, width: X(n.x1) - X(n.x0) + bw, y: Y(n.y1), height: Y(n.y0) - Y(n.y1), fill: color, 'fill-opacity': 0.08, stroke: color, 'stroke-opacity': 0.35, 'stroke-dasharray': '4 4' }), g);
      if (n.label) svg.append(el('text', { x: X(n.x0) + 2, y: Y(n.y1) - 4, fill: color, 'font-size': 11 }, n.label));
    } else if (n.t === 'h') {
      const x1 = n.from != null ? X(n.from) : padL, x2 = n.to != null ? X(n.to) : W - padR;
      svg.append(el('line', { x1, x2, y1: Y(n.y), y2: Y(n.y), stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': n.dash ? '5 4' : '' }));
      if (n.label) labels.push({ y: Y(n.y), text: n.label, color });
    } else if (n.t === 'dot') {
      svg.append(el('circle', { cx: X(n.x), cy: Y(n.y), r: 5, fill: 'none', stroke: color, 'stroke-width': 2 }));
      if (n.label) svg.append(el('text', { x: X(n.x), y: Y(n.y) + (n.dy ?? 18), fill: color, 'font-size': 11, 'text-anchor': 'middle', 'font-weight': 600 }, n.label));
    } else if (n.t === 'arrow') {
      svg.append(el('line', { x1: X(n.x0), y1: Y(n.y0), x2: X(n.x1), y2: Y(n.y1), stroke: color, 'stroke-width': 1.8, 'marker-end': `url(#ah-${spec.id})` }));
    } else if (n.t === 'text') {
      svg.append(el('text', { x: X(n.x), y: Y(n.y), fill: color, 'font-size': 11, 'text-anchor': n.anchor || 'start' }, n.label));
    }
  }
  // Sağ kenar etiketleri (çakışmasın diye aralanır)
  labels.sort((a, b) => a.y - b.y);
  let last = -1e9;
  for (const l of labels) {
    const y = Math.max(l.y, last + 13);
    last = y;
    svg.append(el('text', { x: W - padR + 6, y: y + 4, fill: l.color, 'font-size': 11 }, l.text));
  }
}

// ----------------------------------------------------------------- hazır örnekler
const LONG_PATH = [[0, 121], [8, 104.5], [12, 107.6], [17, 100.5], [22, 107.8], [27, 100.4], [32, 107.5], [36, 102.6], [38, 104.4], [42, 99.2], [44, 101.2], [46, 103.8], [48, 105.6], [50, 104.8], [58, 108.6], [62, 107.9]];
const LONG_WICK = { 41: { low: 97.9 } };

export function longSteps() {
  const candles = schemaCandles(LONG_PATH, { seed: 11, wick: LONG_WICK });
  const base = { id: 'long', candles, bars: 62, lo: 96.5, hi: 110.5 };
  const range = { t: 'box', x0: 9, x1: 40, y0: 100.2, y1: 108, color: 'muted', label: 'Range (yatay bölge)' };
  const eqh = { t: 'h', y: 108, from: 9, color: 'liq', dash: true, label: 'Üst likidite (short stopları)' };
  const eql = { t: 'h', y: 100.2, from: 9, color: 'liq', dash: true, label: 'Alt likidite (long stopları)' };
  const sweep = { t: 'dot', x: 41, y: 97.9, color: 'liq', label: 'Süpürme', dy: 18 };
  const msb = { t: 'h', y: 104.55, from: 37, to: 47, color: 'msb', label: 'İç tepe (MSB seviyesi)' };
  const msbDot = { t: 'dot', x: 47, y: 105.2, color: 'msb', label: 'Kırılım', dy: -12 };
  const entry = { t: 'h', y: 105.5, from: 47, color: 'entry', label: 'Giriş (kapanışta market)' };
  const stop = { t: 'h', y: 97.5, from: 41, color: 'stop', label: 'Stop (süpürme altı)' };
  const tp1 = { t: 'h', y: 106.6, from: 47, color: 'tp1', dash: true, label: 'TP1 = ilk likidite → riski sat' };
  const tgt = { t: 'h', y: 108, from: 47, color: 'target', label: 'Hedef = üst likidite' };
  return [
    { ...base, upto: 36, notes: [range, eqh, eql], title: '1 · Sert hareketten sonra range', text: 'Sert düşüşün ardından fiyat yatay bir bölgeye oturur. Üstte eşit tepeler (short açanların stopları), altta eşit dipler (long açanların stopları) birikir. Orta bölgede işlem yok; alarm iki uca kurulur.' },
    { ...base, upto: 43, notes: [range, eqh, eql, sweep], title: '2 · Bir ucun likiditesi alınır', text: '"Hangi bölgenin likiditesi önce alınırsa tam tersi yöne oyun planı." Alt dipler iğneyle süpürülür; dipten long açanlar stop olur. Henüz işlem yok — onay bekleniyor.' },
    { ...base, upto: 48, notes: [range, eqh, eql, sweep, msb, msbDot], title: '3 · İç kırılım (dönüş onayı)', text: 'Süpürmeden önceki son iç tepe (düşüşü yaptıran tepe) 5m/15m mum kapanışıyla yukarı kırılır. Fiyat da range içine geri dönmüştür. Bu, kısa zaman dilimindeki dönüş onayıdır.' },
    { ...base, upto: 48, notes: [range, eqh, eql, sweep, msb, entry, stop, tp1, tgt], title: '4 · Giriş, stop, hedef', text: 'Scalpta çoğu zaman retest beklenmez: kırılım mumunun kapanışında market giriş. Stop süpürme dibinin altında. TP1 ilk likidite (pozisyonun %50\'si kapatılır, risk satılır), son hedef üstteki eşit tepeler.' },
    { ...base, upto: 62, notes: [range, eqh, eql, sweep, msb, entry, stop, tp1, tgt], title: '5 · Sonuç', text: 'Fiyat üst likiditeye gider. Bu kurgu her zaman çalışmaz: süpürme bazen gerçek kırılıma dönüşür ve stop olur. Bu yüzden kural setinin geçmiş veride ne yaptığına aşağıdaki backtest ile bakıyoruz.' },
  ];
}

export function shortSpec() {
  // Long örneğinin aynası
  const ax = 210;
  const path = LONG_PATH.map(([b, p]) => [b, ax - p]);
  const candles = schemaCandles(path, { seed: 11, wick: { 41: { high: ax - 97.9 } } });
  return {
    id: 'short', candles, bars: 62, lo: ax - 110.5, hi: ax - 96.5, upto: 62,
    notes: [
      { t: 'box', x0: 9, x1: 40, y0: ax - 108, y1: ax - 100.2, color: 'muted', label: 'Range' },
      { t: 'h', y: ax - 100.2, from: 9, color: 'liq', dash: true, label: 'Üst likidite (süpürülür)' },
      { t: 'h', y: ax - 108, from: 9, color: 'liq', dash: true, label: 'Alt likidite = hedef' },
      { t: 'dot', x: 41, y: ax - 97.9, color: 'liq', label: 'Süpürme', dy: -12 },
      { t: 'h', y: ax - 104.55, from: 37, to: 47, color: 'msb', label: 'İç dip (MSB)' },
      { t: 'h', y: ax - 105.5, from: 47, color: 'entry', label: 'Short giriş' },
      { t: 'h', y: ax - 97.5, from: 41, color: 'stop', label: 'Stop (son tepe üstü)' },
    ],
  };
}

export function fakeSpecs() {
  // Solda: önce alt likidite süpürülür, sonra kırılım → gerçek. Sağda: süpürme olmadan orta bölgede "kırılım" → fake.
  const real = schemaCandles([[0, 104], [5, 108], [10, 100.6], [15, 107.6], [20, 100.4], [23, 99], [27, 104.6], [36, 108.4]], { seed: 3, wick: { 22: { low: 98.4 } } });
  const fake = schemaCandles([[0, 104], [5, 108], [10, 100.6], [15, 107.6], [19, 103], [21, 104.6], [24, 105.4], [28, 101.5], [32, 98.6], [36, 100.5]], { seed: 5 });
  const common = { bars: 36, lo: 97.2, hi: 109.5 };
  return [
    { ...common, id: 'real', candles: real, notes: [
      { t: 'h', y: 100.4, color: 'liq', dash: true, label: 'Alt likidite' },
      { t: 'h', y: 107.8, color: 'liq', dash: true, label: 'Üst likidite' },
      { t: 'dot', x: 22, y: 98.4, color: 'liq', label: 'Önce süpürme', dy: 18 },
      { t: 'arrow', x0: 25, y0: 102, x1: 33, y1: 107.2, color: 'target' },
      { t: 'text', x: 1, y: 109, label: 'GEÇERLİ: süpürme → kırılım', color: 'target' },
    ] },
    { ...common, id: 'fake', candles: fake, notes: [
      { t: 'h', y: 100.4, color: 'liq', dash: true, label: 'Alt likidite (açık)' },
      { t: 'h', y: 107.8, color: 'liq', dash: true, label: 'Üst likidite' },
      { t: 'dot', x: 22, y: 105, color: 'fake', label: '"Kırılım"', dy: -12 },
      { t: 'arrow', x0: 25, y0: 104.5, x1: 31, y1: 99.4, color: 'stop' },
      { t: 'text', x: 1, y: 109, label: 'FAKE: süpürme yok, orta bölge', color: 'fake' },
    ] },
  ];
}
