// Scalp sayfası: şematik anlatım + OKX geçmiş verisiyle backtest.
import { getTopCoins, instIdOf, TIMEFRAMES } from '../data/okx.js';
import { getHistory, estimateRequests } from '../backtest/history.js';
import { SCALP_DEFAULTS } from './detect.js';
import { SCALP_BT_DEFAULTS, VARIANTS, summarizeScalp } from './engine.js';
import { drawSchema, longSteps, shortSpec, fakeSpecs } from './schema.js';
import { fmtPct, fmtTime, esc, decimals } from '../ui/format.js';

const $ = (s) => document.querySelector(s);
const DAY = 86400e3;
const VCOL = { A: '#3987e5', B: '#ff9f43', C: '#7cc4a8' };

// ------------------------------------------------------------------ şemalar
const steps = longSteps();
let step = 0;
function showStep() {
  const s = steps[step];
  drawSchema($('#schemaLong'), s);
  $('#stepTitle').textContent = s.title;
  $('#stepText').textContent = s.text;
  $('#stepPrev').disabled = step === 0;
  $('#stepNext').disabled = step === steps.length - 1;
  $('#stepNo').textContent = `${step + 1} / ${steps.length}`;
}
$('#stepPrev').onclick = () => { step = Math.max(0, step - 1); showStep(); };
$('#stepNext').onclick = () => { step = Math.min(steps.length - 1, step + 1); showStep(); };
showStep();
drawSchema($('#schemaShort'), shortSpec());
const [real, fake] = fakeSpecs();
drawSchema($('#schemaReal'), real);
drawSchema($('#schemaFake'), fake);

// ------------------------------------------------------------------ form
const params = { tf: '5m', days: 30 };
function seg(id, key, cast = String) {
  const box = $(id);
  const sync = () => box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(cast(b.dataset.v) === params[key])));
  box.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    params[key] = cast(b.dataset.v);
    sync();
    estimate();
  };
  sync();
}
seg('#tf', 'tf');
seg('#days', 'days', Number);
$('#minRR').value = SCALP_DEFAULTS.minRR;
$('#feePct').value = SCALP_BT_DEFAULTS.feePct;
$('#window').value = SCALP_DEFAULTS.window;
$('#confirmBars').value = SCALP_DEFAULTS.confirmBars;
$('#maxDepthAtr').value = SCALP_DEFAULTS.maxDepthAtr;
for (const id of ['#topN', '#market']) $(id).onchange = estimate;

function estimate() {
  const tf = TIMEFRAMES[params.tf];
  const n = +$('#topN').value;
  const req = estimateRequests(tf, Date.now() - params.days * DAY - warmMs(tf), Date.now()) * n;
  const sec = Math.round(req * 0.45); // OKX geçmiş mum ucu: ölçülen ≈ 0,45 sn / istek
  $('#estimate').textContent = `${n} coin × ${Math.round((params.days * DAY) / tf.ms).toLocaleString('tr-TR')} mum · ~${req} OKX isteği · tahmini ${sec < 90 ? sec + ' sn' : Math.round(sec / 60) + ' dk'}`;
}
const warmMs = (tf) => (+$('#window').value + 40) * tf.ms;
estimate();

// ------------------------------------------------------------------ çalıştırma
let running = null;
let result = null;
const store = new Map(); // coin → mumlar (işlem grafiği için)

function makeWorker() {
  const url = new URL('./worker.js', import.meta.url);
  url.search = new URL(import.meta.url).search;
  const w = new Worker(url, { type: 'module' });
  let seq = 0;
  const pending = new Map();
  w.onmessage = (e) => {
    const j = pending.get(e.data.id);
    pending.delete(e.data.id);
    if (e.data.error) j.reject(new Error(e.data.error)); else j.resolve(e.data.result);
  };
  w.onerror = (e) => { for (const j of pending.values()) j.reject(new Error(e.message || 'Worker hatası')); pending.clear(); };
  return {
    run: (candles, cfg) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); w.postMessage({ id, candles, cfg }); }),
    terminate: () => w.terminate(),
  };
}

const setStatus = (h) => { $('#status').innerHTML = h; };

$('#runBtn').onclick = run;
$('#stopBtn').onclick = () => running?.abort();

async function run() {
  if (running) return;
  const tf = TIMEFRAMES[params.tf];
  const market = $('#market').value;
  const n = +$('#topN').value;
  const end = Date.now();
  const from = end - params.days * DAY;
  const cfg = {
    from, to: end,
    minRR: +$('#minRR').value || 0, feePct: +$('#feePct').value || 0,
    window: Math.max(30, +$('#window').value || SCALP_DEFAULTS.window),
    confirmBars: Math.max(2, +$('#confirmBars').value || SCALP_DEFAULTS.confirmBars),
    direction: $('#direction').value,
    maxDepthAtr: Math.max(0.5, +$('#maxDepthAtr').value || SCALP_DEFAULTS.maxDepthAtr),
  };
  const ctrl = new AbortController();
  running = ctrl;
  $('#runBtn').disabled = true;
  $('#stopBtn').hidden = false;
  const worker = makeWorker();
  const trades = [];
  const errors = [];
  const fun = { rangeBars: 0, sweeps: 0, setups: 0, skipped: {} };
  store.clear();
  $('#funnel').innerHTML = '';
  try {
    setStatus('<p>Coin listesi alınıyor…</p>');
    const coins = await getTopCoins(n, { signal: ctrl.signal }, market);
    let done = 0;
    for (const c of coins) {
      const id = instIdOf(c.coin, market);
      setStatus(`<p>${done} / ${coins.length} coin · ${esc(c.coin)} indiriliyor…</p>`);
      try {
        const candles = await getHistory(id, tf, from - warmMs(tf), end, { signal: ctrl.signal });
        store.set(c.coin, candles);
        const r = await worker.run(candles, { ...cfg, coin: c.coin });
        trades.push(...r.trades);
        fun.rangeBars += r.stats.rangeBars; fun.sweeps += r.stats.sweeps; fun.setups += r.stats.setups;
        for (const [k, v] of Object.entries(r.stats.skipped)) fun.skipped[k] = (fun.skipped[k] || 0) + v;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        errors.push(`${c.coin}: ${e.message}`);
      }
      done++;
    }
    result = { trades, cfg, tf: params.tf, days: params.days, market, coins: coins.map((c) => c.coin), at: end };
    setStatus(`<p>${coins.length} coin tarandı · ${trades.length} işlem.${errors.length ? ` <span class="error">${errors.length} coin hata verdi: ${esc(errors.join(' · '))}</span>` : ''}</p>`);
    renderFunnel(fun, trades.length);
    render();
  } catch (e) {
    setStatus(e.name === 'AbortError' ? '<p>Durduruldu.</p>' : `<p class="error">${esc(e.message)}</p>`);
  } finally {
    worker.terminate();
    running = null;
    $('#runBtn').disabled = false;
    $('#stopBtn').hidden = true;
  }
}

// ------------------------------------------------------------------ sonuç
const fR = (x, d = 2) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}R`;
const fPF = (x) => (Number.isFinite(x) ? x.toFixed(2) : '∞');
const cls = (x) => (x >= 0 ? 'pos' : 'neg');
let variant = 'B';

function render() {
  const { trades } = result;
  $('#results').hidden = false;
  $('#resMeta').textContent = `${result.tf} · son ${result.days} gün · ${result.coins.length} coin (${result.market === 'swap' ? 'vadeli' : 'spot'}) · min R:R ${result.cfg.minRR} · komisyon %${result.cfg.feePct}/taraf`;
  const rows = VARIANTS.map((v) => {
    const s = summarizeScalp(trades, v.id);
    const L = summarizeScalp(trades.filter((t) => t.d === 1), v.id), S = summarizeScalp(trades.filter((t) => t.d === -1), v.id);
    const gross = trades.reduce((a, t) => a + t.alts[v.id].gross, 0);
    return `<tr class="${v.id === variant ? 'sel' : ''}" data-v="${v.id}">
      <td><i class="sw" style="background:${VCOL[v.id]}"></i>${v.id} · ${esc(v.name)}</td>
      <td class="num">${s.n}</td><td class="num">${fmtPct(s.winRate, 0)}</td>
      <td class="num ${cls(s.total)}">${fR(s.total, 1)}</td><td class="num ${cls(gross)}">${fR(gross, 1)}</td>
      <td class="num ${s.pf >= 1 ? 'pos' : 'neg'}">${fPF(s.pf)}</td><td class="num ${cls(s.avg)}">${fR(s.avg)}</td>
      <td class="num">${s.maxDD.toFixed(1)}R</td>
      <td class="num ${cls(L.total)}">${L.n} · ${fR(L.total, 1)}</td><td class="num ${cls(S.total)}">${S.n} · ${fR(S.total, 1)}</td></tr>`;
  }).join('');
  $('#varTable').innerHTML = `<thead><tr><th>Yönetim</th><th>İşlem</th><th>Kazanma</th><th>Toplam</th><th>Komisyonsuz</th><th>Kâr faktörü</th><th>Ort.</th><th>Maks. düşüş</th><th>Long</th><th>Short</th></tr></thead><tbody>${rows}</tbody>`;
  $('#varTable').onclick = (e) => {
    const tr = e.target.closest('tr[data-v]');
    if (!tr) return;
    variant = tr.dataset.v;
    render();
  };
  drawEquity(trades);
  renderCoins(trades);
  renderTrades(trades);
}

let eqChart = null;
function drawEquity(trades) {
  const el = $('#equity');
  if (eqChart) { eqChart.remove(); eqChart = null; }
  const LW = window.LightweightCharts;
  if (!LW || !trades.length) { el.innerHTML = trades.length ? '<p class="error">Grafik kütüphanesi yüklenemedi.</p>' : '<p class="muted pad">İşlem yok.</p>'; return; }
  el.innerHTML = '';
  eqChart = LW.createChart(el, {
    width: el.clientWidth, height: el.clientHeight,
    layout: { background: { type: 'solid', color: '#121822' }, textColor: '#8f99aa', fontSize: 11 },
    grid: { vertLines: { color: '#1c2430' }, horzLines: { color: '#1c2430' } },
    rightPriceScale: { borderColor: '#1c2430' }, timeScale: { borderColor: '#1c2430', timeVisible: true },
    localization: { locale: 'tr-TR', priceFormatter: (v) => `${v.toFixed(1)}R` },
  });
  for (const v of VARIANTS) {
    const pts = new Map();
    let eq = 0;
    for (const t of [...trades].sort((a, b) => a.entryTime - b.entryTime)) {
      eq += t.alts[v.id].R;
      pts.set(Math.floor(t.entryTime / 1000), eq);
    }
    eqChart.addSeries(LW.LineSeries, { color: VCOL[v.id], lineWidth: v.id === variant ? 3 : 1, priceLineVisible: false })
      .setData([...pts].map(([time, value]) => ({ time, value })));
  }
  eqChart.timeScale().fitContent();
  $('#eqLegend').innerHTML = VARIANTS.map((v) => `<span><i style="border-top-color:${VCOL[v.id]}"></i>${v.id} · ${esc(v.name)} (kümülatif R)</span>`).join('');
  new ResizeObserver(([e]) => { if (eqChart && e.contentRect.width > 0) eqChart.resize(Math.floor(e.contentRect.width), Math.floor(e.contentRect.height)); }).observe(el);
}

function renderCoins(trades) {
  const by = new Map();
  for (const t of trades) (by.get(t.coin) || by.set(t.coin, []).get(t.coin)).push(t);
  const rows = [...by].map(([coin, list]) => ({ coin, s: summarizeScalp(list, variant) })).sort((a, b) => b.s.total - a.s.total);
  $('#coinTable').innerHTML = `<thead><tr><th>Coin</th><th>İşlem</th><th>Kazanma</th><th>Toplam (${variant})</th><th>PF</th></tr></thead><tbody>${rows.map(({ coin, s }) =>
    `<tr><td>${esc(coin)}</td><td class="num">${s.n}</td><td class="num">${fmtPct(s.winRate, 0)}</td><td class="num ${cls(s.total)}">${fR(s.total, 1)}</td><td class="num">${fPF(s.pf)}</td></tr>`).join('')}</tbody>`;
}

const OUT = { hedef: 'hedef', stop: 'stop', 'giriş': 'girişte stop', 'süre': 'süre doldu', 'veri bitti': 'açık' };
function renderTrades(trades) {
  const list = [...trades].sort((a, b) => b.entryTime - a.entryTime);
  $('#trades').innerHTML = `<thead><tr><th></th><th>Giriş zamanı</th><th>Coin</th><th>Yön</th><th>R:R</th><th>A</th><th>B</th><th>C</th><th>Sonuç (${variant})</th></tr></thead><tbody>${list.map((t, i) =>
    `<tr><td><button type="button" class="ghost mini" data-i="${trades.indexOf(t)}" title="Grafikte göster">📈</button></td>
      <td>${fmtTime(t.entryTime)}</td><td>${esc(t.coin)}</td><td class="${t.d === 1 ? 'pos' : 'neg'}">${t.d === 1 ? 'Long' : 'Short'}</td>
      <td class="num">${t.rr.toFixed(1)}</td>
      ${VARIANTS.map((v) => `<td class="num ${cls(t.alts[v.id].R)}">${fR(t.alts[v.id].R)}</td>`).join('')}
      <td>${OUT[t.alts[variant].outcome] || esc(t.alts[variant].outcome)}${t.alts[variant].tp1 ? ' · TP1✓' : ''}</td></tr>`).join('')}</tbody>`;
  $('#trades').onclick = (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) showTrade(trades[+b.dataset.i]);
  };
  // İlk açılışta bir örnek göster: en yeni hedefe ulaşan işlem
  const ex = list.find((t) => t.alts.A.outcome === 'hedef') || list[0];
  if (ex && !$('#tradeView').dataset.shown) { $('#tradeView').dataset.shown = '1'; showTrade(ex, false); }
}

// ------------------------------------------------------------------ işlem grafiği
const TZ = -new Date().getTimezoneOffset() * 60;
const sec = (ms) => Math.floor(ms / 1000) + TZ;
let tChart = null;
function showTrade(t, scroll = true) {
  const box = $('#tradeView');
  box.hidden = false;
  const candles = store.get(t.coin) || [];
  const tfMs = TIMEFRAMES[result.tf].ms;
  const exitT = Math.max(...VARIANTS.map((v) => t.alts[v.id].exitTime || t.entryTime));
  const a = candles.findIndex((c) => c.time >= t.rangeFrom - 15 * tfMs);
  let b = candles.findIndex((c) => c.time > exitT + 20 * tfMs);
  if (b < 0) b = candles.length;
  const part = candles.slice(Math.max(0, a), b);
  const alt = t.alts[variant];
  $('#tvTitle').textContent = `${t.coin} · ${t.d === 1 ? 'Long' : 'Short'} · ${fmtTime(t.entryTime)} · ${variant}: ${fR(alt.R)} (${OUT[alt.outcome] || alt.outcome})`;
  const el = $('#tradeChart');
  if (tChart) { tChart.remove(); tChart = null; }
  const LW = window.LightweightCharts;
  if (!LW) { el.innerHTML = '<p class="error">Grafik kütüphanesi yüklenemedi.</p>'; return; }
  const prec = decimals(t.entry);
  tChart = LW.createChart(el, {
    width: el.clientWidth, height: el.clientHeight,
    layout: { background: { type: 'solid', color: '#121822' }, textColor: '#8f99aa', fontSize: 11 },
    grid: { vertLines: { color: '#1c2430' }, horzLines: { color: '#1c2430' } },
    rightPriceScale: { borderColor: '#1c2430' }, timeScale: { borderColor: '#1c2430', timeVisible: true, secondsVisible: false },
    crosshair: { mode: LW.CrosshairMode.Normal }, localization: { locale: 'tr-TR' },
  });
  const s = tChart.addSeries(LW.CandlestickSeries, {
    upColor: '#26a69a', downColor: '#ef5350', borderUpColor: '#26a69a', borderDownColor: '#ef5350', wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    priceFormat: { type: 'price', precision: prec, minMove: 10 ** -prec },
  });
  s.setData(part.map((c) => ({ time: sec(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
  const line = (price, color, title, dashed = true) => s.createPriceLine({ price, color, lineWidth: 1, lineStyle: dashed ? LW.LineStyle.Dashed : LW.LineStyle.Solid, axisLabelVisible: true, title });
  line(t.rangeHigh, '#f0c75e', t.d === 1 ? 'Range tepe (hedef)' : 'Range tepe');
  line(t.rangeLow, '#f0c75e', t.d === 1 ? 'Range dip' : 'Range dip (hedef)');
  line(t.msbPrice, '#b06cf0', 'MSB');
  line(t.entry, '#3987e5', 'Giriş', false);
  line(t.stop, '#ef5350', 'Stop', false);
  line(t.tp1, '#7cc4a8', 'TP1');
  const marks = [
    { time: sec(t.sweepTime), position: t.d === 1 ? 'belowBar' : 'aboveBar', color: '#f0c75e', shape: t.d === 1 ? 'arrowUp' : 'arrowDown', text: 'Süpürme' },
    { time: sec(t.msbTime), position: t.d === 1 ? 'aboveBar' : 'belowBar', color: '#b06cf0', shape: 'circle', text: 'iç tepe/dip' },
    { time: sec(t.entryTime), position: t.d === 1 ? 'belowBar' : 'aboveBar', color: '#3987e5', shape: t.d === 1 ? 'arrowUp' : 'arrowDown', text: 'Giriş' },
  ];
  if (alt.exitTime) marks.push({ time: sec(alt.exitTime), position: 'inBar', color: alt.R >= 0 ? '#3fb950' : '#f05a5a', shape: 'square', text: `Çıkış ${fR(alt.R)}` });
  marks.sort((x, y) => x.time - y.time);
  LW.createSeriesMarkers(s, marks);
  tChart.timeScale().fitContent();
  new ResizeObserver(([e]) => { if (tChart && e.contentRect.width > 0) tChart.resize(Math.floor(e.contentRect.width), Math.floor(e.contentRect.height)); }).observe(el);
  if (scroll) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ------------------------------------------------------------------ huni: işlemler nerede eleniyor
const SKIP_TXT = {
  'derin kırılım': 'süpürme çok derine gitti → gerçek kırılım sayıldı',
  'onay gelmedi': 'süre içinde iç kırılım (onay) gelmedi',
  'R:R düşük': 'onay geldi ama hedefe R:R yetmedi',
  'risk yok': 'giriş stopun ötesinde',
};
function renderFunnel(f, n) {
  const sk = Object.entries(f.skipped).sort((a, b) => b[1] - a[1]);
  $('#funnel').innerHTML = `<div class="warn-box"><p><b>Huni:</b> ${f.sweeps} süpürme görüldü → ${n} işlem açıldı.</p>
    ${sk.map(([k, v]) => `<p>· ${v} tanesi: ${esc(SKIP_TXT[k] || k)}</p>`).join('')}
    ${n === 0 ? '<p>İşlem çıkmadıysa süreyi uzat (30–60 gün), coin sayısını artır ya da min R:R / derinlik ayarını gevşet.</p>' : ''}</div>`;
}
