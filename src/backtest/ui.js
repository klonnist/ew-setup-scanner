// Backtest sayfası: form, veri indirme + worker havuzu, sonuç raporu ve kayıtlı çalışmalar.
import { getTopCoins, TIMEFRAMES } from '../data/okx.js';
import { getHistory, estimateRequests } from './history.js';
import { summarize, BT_DEFAULTS } from './engine.js';
import { loadRuns, saveRun, deleteRun, importRuns, packTrades, unpackTrades, usedBytes, MAX_BYTES } from './store.js';
import { loadSettings, saveSettings, renderSettings, toScanOptions, UI_DEFAULTS } from '../ui/settings.js';
import { fmtPct, fmtX, esc } from '../ui/format.js';

const $ = (s) => document.querySelector(s);
const PKEY = 'ew-setup-scanner:btparams:v1';
const DAY = 86400e3;
const QUICK = {
  '15m': [['7 gün', 7], ['30 gün', 30], ['90 gün', 90]],
  '4H': [['3 ay', 91], ['6 ay', 182], ['1 yıl', 365]],
  '1D': [['1 yıl', 365], ['2 yıl', 730], ['3 yıl', 1095]],
};
const TYPE_NAME = { break: 'B kırılımı', zone: 'Limit bölge' };

let settings = loadSettings();
let params = loadParams();
let running = null; // { ctrl, workers }
let current = null; // gösterilen çalışma
let eqChart = null;

// ------------------------------------------------------------------ parametreler
function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
function dayMs(s, end = false) { return Date.parse(s + 'T00:00:00Z') + (end ? DAY - 1 : 0); }

function defaultsFor(tf) {
  const days = QUICK[tf][1][1];
  const to = Date.now();
  return { from: isoDay(to - days * DAY), to: isoDay(to) };
}

function loadParams() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PKEY) || 'null'); } catch { /* yoksay */ }
  const tf = p?.tf && TIMEFRAMES[p.tf] ? p.tf : '4H';
  return {
    tf, ...defaultsFor(tf), topN: 20, entryType: 'both', note: '',
    exitTarget: BT_DEFAULTS.exitTarget, feePct: BT_DEFAULTS.feePct, maxPending: BT_DEFAULTS.maxPending, maxHold: BT_DEFAULTS.maxHold,
    ...(p || {}), tf,
  };
}
function saveParams() { try { localStorage.setItem(PKEY, JSON.stringify(params)); } catch { /* yoksay */ } }

function syncForm() {
  for (const b of document.querySelectorAll('#tf button')) b.setAttribute('aria-pressed', String(b.dataset.tf === params.tf));
  for (const k of ['from', 'to', 'topN', 'entryType', 'exitTarget', 'feePct', 'maxPending', 'maxHold', 'note']) $('#' + k).value = params[k];
  $('#to').max = isoDay(Date.now());
  $('#quick').innerHTML = QUICK[params.tf].map(([t, d]) => `<button type="button" class="ghost sm" data-days="${d}">${t}</button>`).join('');
  for (const b of document.querySelectorAll('#quick button')) {
    b.addEventListener('click', () => {
      params.to = isoDay(Date.now());
      params.from = isoDay(Date.now() - Number(b.dataset.days) * DAY);
      saveParams(); syncForm();
    });
  }
  updateEstimate();
}

function coinCount() {
  if (Number(params.topN)) return Number(params.topN);
  return toScanOptions(settings).manualCoins?.length || 0;
}

function updateEstimate() {
  const tf = TIMEFRAMES[params.tf];
  const from = dayMs(params.from), to = dayMs(params.to, true);
  if (!(to > from)) { $('#estimate').textContent = 'Bitiş tarihi başlangıçtan sonra olmalı.'; return; }
  const req = estimateRequests(tf, from - BT_DEFAULTS.window * tf.ms, to) * coinCount();
  const bars = Math.round((Math.min(to, Date.now()) - from) / tf.ms);
  const sec = Math.round(req * 0.12 + (bars * coinCount() * 0.0006) / Math.max(1, workerCount()));
  $('#estimate').textContent = `${coinCount()} coin × ${bars.toLocaleString('tr-TR')} mum · ~${req.toLocaleString('tr-TR')} OKX isteği · tahmini süre ${sec < 90 ? sec + ' sn' : Math.round(sec / 60) + ' dk'} (aynı aralık sayfa açıkken tekrar indirilmez)`;
}

const workerCount = () => Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

// ------------------------------------------------------------------ çalıştırma
function makePool(n) {
  const url = new URL('./worker.js', import.meta.url);
  url.search = new URL(import.meta.url).search; // önbellek kırıcıyı taşı
  const workers = Array.from({ length: n }, () => new Worker(url, { type: 'module' }));
  const idle = [...workers];
  const queue = [];
  let seq = 0;
  const pending = new Map();
  const pump = () => {
    while (idle.length && queue.length) {
      const w = idle.pop();
      const job = queue.shift();
      pending.set(job.id, { ...job, w });
      w.postMessage({ id: job.id, candles: job.candles, cfg: job.cfg });
    }
  };
  for (const w of workers) {
    w.onmessage = (e) => {
      const job = pending.get(e.data.id);
      pending.delete(e.data.id);
      idle.push(w);
      if (e.data.error) job.reject(new Error(e.data.error));
      else job.resolve(e.data.result);
      pump();
    };
    w.onerror = (e) => { for (const j of pending.values()) j.reject(new Error(e.message || 'Worker hatası')); pending.clear(); };
  }
  return {
    run: (candles, cfg) => new Promise((resolve, reject) => { queue.push({ id: ++seq, candles, cfg, resolve, reject }); pump(); }),
    terminate: () => workers.forEach((w) => w.terminate()),
  };
}

function setStatus(html) { $('#status').innerHTML = html; }

async function run() {
  if (running) return;
  const tf = TIMEFRAMES[params.tf];
  const from = dayMs(params.from), to = Math.min(dayMs(params.to, true), Date.now());
  if (!(to > from)) return setStatus('<p class="error">Bitiş tarihi başlangıçtan sonra olmalı.</p>');
  const scan = toScanOptions(settings);
  const opts = { ...scan, entryType: params.entryType };
  delete opts.manualCoins;
  const cfg = {
    from, to, opts,
    exitTarget: Number(params.exitTarget), feePct: Number(params.feePct),
    maxPending: Number(params.maxPending), maxHold: Number(params.maxHold), window: BT_DEFAULTS.window,
  };

  const ctrl = new AbortController();
  const pool = makePool(workerCount());
  running = { ctrl, pool };
  $('#runBtn').disabled = true;
  $('#stopBtn').hidden = false;
  const t0 = Date.now();
  try {
    setStatus('<p>Coin listesi alınıyor…</p>');
    const coins = Number(params.topN)
      ? await getTopCoins(Number(params.topN), { signal: ctrl.signal })
      : (scan.manualCoins || []).map((c) => ({ coin: c, instId: `${c}-USDT` }));
    if (!coins.length) throw new Error('Coin listesi boş (elle liste seçiliyse tarama ayarlarından coin gir).');

    const trades = [];
    const cancelled = {};
    const errors = [];
    let fetched = 0, computed = 0, orders = 0;
    const progress = (extra = '') => setStatus(`<p>Veri: <b>${fetched}/${coins.length}</b> coin · Hesap: <b>${computed}/${coins.length}</b> · ${trades.length} işlem · ${Math.round((Date.now() - t0) / 1000)} sn ${extra}</p>
      <div class="progress"><div class="bar"><span style="width:${Math.round((50 * (fetched + computed)) / coins.length)}%"></span></div></div>`);
    progress();
    const jobs = [];
    let next = 0;
    const fetcher = async () => {
      while (next < coins.length) {
        const c = coins[next++];
        try {
          const candles = await getHistory(c.instId, tf, from - cfg.window * tf.ms, to + cfg.maxHold * tf.ms, {
            signal: ctrl.signal,
            onRetry: ({ attempt }) => progress(`· OKX yoğun, yeniden deneniyor (${attempt})`),
          });
          fetched++;
          progress(`· ${esc(c.coin)}`);
          jobs.push(pool.run(candles, cfg).then((r) => {
            for (const t of r.trades) trades.push({ ...t, coin: c.coin });
            for (const [k, v] of Object.entries(r.stats.cancelled)) cancelled[k] = (cancelled[k] || 0) + v;
            orders += r.stats.orders;
          }).catch((err) => errors.push(`${c.coin}: ${err.message}`)).finally(() => { computed++; progress(); }));
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          fetched++; computed++;
          errors.push(`${c.coin}: ${err.message}`);
        }
      }
    };
    const aborted = new Promise((_, reject) => ctrl.signal.addEventListener('abort', () => reject(Object.assign(new Error('Durduruldu'), { name: 'AbortError' })), { once: true }));
    await Promise.race([Promise.all([fetcher(), fetcher()]), aborted]);
    await Promise.race([Promise.all(jobs), aborted]);
    if (ctrl.signal.aborted) return;

    const runObj = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      secs: Math.round((Date.now() - t0) / 1000),
      params: {
        tf: params.tf, from, to, topN: Number(params.topN), coins: coins.map((c) => c.coin), note: params.note || '',
        entryType: params.entryType, exitTarget: cfg.exitTarget, feePct: cfg.feePct, maxPending: cfg.maxPending, maxHold: cfg.maxHold,
        settings: pickSettings(opts),
      },
      orders, cancelled, errors,
      trades: packTrades(trades),
    };
    const saved = saveRun(runObj);
    renderRuns();
    show(runObj);
    setStatus(`<p>Bitti: ${coins.length} coin, ${trades.length} işlem, ${runObj.secs} sn.
      ${saved.ok ? (saved.dropped ? ` Yer açmak için en eski ${saved.dropped} çalışma silindi.` : ' Kaydedildi.') : ' <span class="error">Kaydedilemedi (tarayıcı depolaması dolu veya kapalı).</span>'}
      ${errors.length ? `<span class="error"> ${errors.length} coin okunamadı: ${esc(errors.slice(0, 3).join('; '))}</span>` : ''}</p>`);
  } catch (err) {
    if (err.name === 'AbortError') setStatus('<p class="muted">Durduruldu.</p>');
    else setStatus(`<p class="error">Backtest başarısız: ${esc(err.message)}</p>`);
  } finally {
    pool.terminate();
    running = null;
    $('#runBtn').disabled = false;
    $('#stopBtn').hidden = true;
  }
}

const SETTING_KEYS = ['ruleSet', 'sensitivities', 'w1Extend', 'retrMin', 'retrMax', 'requireAbc', 'abcKinds', 'minTimeRatio', 'minW1Atr',
  'rsiMode', 'volume', 'stopMode', 'stopAtr', 'targets', 'minRR', 'direction', 'zoneCExt', 'zoneRetr', 'zoneEntry', 'zoneStop', 'zoneTime'];
function pickSettings(o) { return Object.fromEntries(SETTING_KEYS.map((k) => [k, o[k]])); }

function settingsText(p) {
  const s = p.settings;
  const w1 = { 0: 'son pivot', 1: '1 geri', 2: '2 geri', 99: 'en geniş' }[s.w1Extend] ?? s.w1Extend;
  const parts = [
    `${s.ruleSet}`, `dalga 1: ${w1}`, `süre>${s.minTimeRatio}`, `min R:R ${s.minRR}`, `H${p.exitTarget + 1}`, `kom. %${p.feePct}`,
  ];
  if (p.entryType !== 'break') parts.push(`bölge ${s.zoneEntry}/${s.zoneStop === 'r886' ? 'stop %88,6' : 'stop 0'}${s.zoneTime === 'ignore' ? '/süresiz' : ''}`);
  if (p.entryType !== 'zone') parts.push(`B stop ${s.stopMode}`);
  return parts.join(' · ');
}

// ------------------------------------------------------------------ rapor
const fmtR = (r) => { const v = Math.abs(r) < 0.005 ? 0 : r; return `${v > 0 ? "+" : ""}${v.toFixed(2)}R`; };
const fmtPF = (pf) => (pf === Infinity ? '∞' : pf.toFixed(2));

function statRow(name, s) {
  return `<tr><td>${esc(name)}</td><td class="num">${s.n}</td><td class="num">${fmtPct(s.winRate, 0)}</td><td class="num ${s.avgR >= 0 ? 'pos' : 'neg'}">${fmtR(s.avgR)}</td><td class="num ${s.totalR >= 0 ? 'pos' : 'neg'}">${fmtR(s.totalR)}</td><td class="num">${fmtPF(s.pf)}</td></tr>`;
}

function groupTable(title, trades, keyFn, { limit = 0, sort = 'n' } = {}) {
  const groups = new Map();
  for (const t of trades) {
    const k = keyFn(t);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  let rows = [...groups].map(([k, list]) => [k, summarize(list)]).filter(([, s]) => s.n);
  rows.sort((a, b) => (sort === 'R' ? b[1].totalR - a[1].totalR : b[1].n - a[1].n));
  if (limit && rows.length > limit * 2) rows = [...rows.slice(0, limit), ['…', null], ...rows.slice(-limit)];
  if (!rows.length) return '';
  return `<div class="bd"><h3>${esc(title)}</h3><table class="stat"><thead><tr><th></th><th>İşlem</th><th>Kazanma</th><th>Ort.</th><th>Toplam</th><th>PF</th></tr></thead>
    <tbody>${rows.map(([k, s]) => (s ? statRow(String(k), s) : '<tr><td colspan="6" class="muted">…</td></tr>')).join('')}</tbody></table></div>`;
}

function tile(label, value, cls = '') { return `<div class="tile"><b>${esc(label)}</b><span class="num ${cls}">${value}</span></div>`; }

function show(runObj) {
  current = runObj;
  const p = runObj.params;
  const trades = unpackTrades(runObj.trades);
  $('#results').hidden = false;
  $('#resTitle').textContent = `${p.tf} · ${isoDay(p.from)} → ${isoDay(p.to)} · ${p.coins.length} coin${p.note ? ' · ' + p.note : ''}`;
  $('#resMeta').textContent = settingsText(p);

  const types = [...new Set(trades.map((t) => t.type))];
  const blocks = (types.length ? types : [p.entryType === 'zone' ? 'zone' : 'break']).map((type) => {
    const s = summarize(trades.filter((t) => t.type === type));
    return `<div class="tile-group"><h3>${TYPE_NAME[type]}</h3><div class="tile-row">
      ${tile('İşlem', `${s.n}${s.open ? ` <small class="muted">+${s.open} açık</small>` : ''}`)}
      ${tile('Kazanma', fmtPct(s.winRate, 1))}
      ${tile('Ort. R', fmtR(s.avgR), s.avgR >= 0 ? 'pos' : 'neg')}
      ${tile('Toplam R', fmtR(s.totalR), s.totalR >= 0 ? 'pos' : 'neg')}
      ${tile('Kâr faktörü', fmtPF(s.pf), s.pf >= 1 ? 'pos' : 'neg')}
      ${tile('Maks. düşüş', `${s.maxDD.toFixed(1)}R`)}
      ${tile('Hedef / stop / süre', `${s.targets} / ${s.stops} / ${s.timeouts}`)}
    </div></div>`;
  }).join('');
  const canc = Object.entries(runObj.cancelled || {}).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => { const [t, r] = k.split(':'); return `<span class="chip">${esc(TYPE_NAME[t] || t)}: ${esc(r)} ${v}</span>`; }).join('');
  $('#tiles').innerHTML = `${blocks}<p class="muted small">${runObj.orders} emir oluştu, ${trades.length} tanesi doldu.</p>${canc ? `<div class="chips"><span class="chip muted">Dolmayan emirler →</span>${canc}</div>` : ''}`;

  drawEquity(trades, types);

  const closed = trades.filter((t) => t.outcome !== 'open');
  $('#breakdowns').innerHTML = [
    groupTable('Plan tipi', closed, (t) => TYPE_NAME[t.type]),
    groupTable('Yön', closed, (t) => (t.dir === 'long' ? 'LONG ▲' : 'SHORT ▼')),
    groupTable('Bölge gücü (limit bölge)', closed.filter((t) => t.type === 'zone'), (t) => t.strength),
    groupTable('Bölgede çakışan seviye', closed.filter((t) => t.type === 'zone'), (t) => `${t.inside} çakışma`),
    groupTable('Dalga 2 tipi', closed, (t) => t.abc || 'ABC yok'),
    groupTable('Derece (× ATR)', closed, (t) => `${t.sensitivity}×`),
    groupTable('Kademeli dolum', closed.filter((t) => t.type === 'zone' && t.legs > 1), (t) => `${t.filledLegs}/${t.legs} doldu`),
    groupTable('Coin (en iyi / en kötü)', closed, (t) => t.coin, { limit: 5, sort: 'R' }),
  ].join('');

  const rows = [...trades].sort((a, b) => b.entryTime - a.entryTime).slice(0, 500);
  const dt = (ms) => new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  $('#trades').innerHTML = `<thead><tr><th>Giriş</th><th>Coin</th><th>Plan</th><th>Yön</th><th>Sonuç</th><th>R</th><th>Mum</th><th>Giriş fiyatı</th><th>Çıkış</th></tr></thead><tbody>
    ${rows.map((t) => `<tr><td>${dt(t.entryTime)}</td><td>${esc(t.coin)}</td><td>${TYPE_NAME[t.type]}${t.legs > 1 ? ` ${t.filledLegs}/${t.legs}` : ''}</td><td>${t.dir === 'long' ? '▲' : '▼'}</td><td>${esc(t.outcome)}</td>
      <td class="num ${t.R >= 0 ? 'pos' : 'neg'}">${fmtR(t.R)}</td><td class="num">${t.bars}</td><td class="num">${t.entry.toPrecision(5)}</td><td class="num">${t.exit.toPrecision(5)}</td></tr>`).join('')}</tbody>
    ${trades.length > 500 ? `<caption class="muted">Son 500 işlem gösteriliyor (toplam ${trades.length}).</caption>` : ''}`;
  renderRuns();
}

const EQ_COLORS = { break: '#3987e5', zone: '#ff9f43', all: '#e8ebf1' };
function drawEquity(trades, types) {
  const el = $('#equity');
  if (eqChart) { eqChart.remove(); eqChart = null; }
  const LW = window.LightweightCharts;
  if (!LW) { el.innerHTML = '<p class="error">Grafik kütüphanesi yüklenemedi.</p>'; return; }
  eqChart = LW.createChart(el, {
    width: el.clientWidth, height: el.clientHeight,
    layout: { background: { type: 'solid', color: '#121822' }, textColor: '#8f99aa', fontSize: 11 },
    grid: { vertLines: { color: '#1c2430' }, horzLines: { color: '#1c2430' } },
    rightPriceScale: { borderColor: '#1c2430' }, timeScale: { borderColor: '#1c2430', timeVisible: true },
    localization: { locale: 'tr-TR', priceFormatter: (v) => `${v.toFixed(1)}R` },
  });
  const series = (list, color) => {
    const pts = new Map();
    let eq = 0;
    for (const t of list.filter((x) => x.outcome !== 'open').sort((a, b) => a.exitTime - b.exitTime)) {
      eq += t.R;
      pts.set(Math.floor(t.exitTime / 1000), eq);
    }
    if (!pts.size) return;
    eqChart.addSeries(LW.LineSeries, { color, lineWidth: 2, priceLineVisible: false })
      .setData([...pts].map(([time, value]) => ({ time, value })));
  };
  const lines = types.length > 1 ? ['all', ...types] : types;
  for (const k of lines) series(k === 'all' ? trades : trades.filter((t) => t.type === k), EQ_COLORS[k]);
  eqChart.timeScale().fitContent();
  requestAnimationFrame(() => eqChart?.timeScale().fitContent()); // ilk çizimde genişlik henüz kesinleşmemiş olabilir
  $('#eqLegend').innerHTML = lines.map((k) => `<span><i style="border-top-color:${EQ_COLORS[k]}"></i>${k === 'all' ? 'Toplam' : TYPE_NAME[k]} (kümülatif R)</span>`).join('');
  new ResizeObserver(([e]) => { if (eqChart && e.contentRect.width > 0) eqChart.resize(Math.floor(e.contentRect.width), Math.floor(e.contentRect.height)); }).observe(el);
}

// ------------------------------------------------------------------ kayıtlı çalışmalar
function renderRuns() {
  const runs = loadRuns();
  const used = usedBytes(runs);
  $('#usage').textContent = `${runs.length} çalışma · ${(used / 1024).toFixed(0)} KB / ${(MAX_BYTES / 1024 / 1024).toFixed(1)} MB`;
  if (!runs.length) { $('#runs').innerHTML = '<tbody><tr><td class="muted">Henüz kayıtlı backtest yok.</td></tr></tbody>'; return; }
  const dt = (ms) => new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  $('#runs').innerHTML = `<thead><tr><th>Çalıştırma</th><th>TF</th><th>Aralık</th><th>Coin</th><th>Giriş</th><th>Ayarlar</th><th>İşlem</th><th>Kazanma</th><th>Ort. R</th><th>PF</th><th>Toplam</th><th></th></tr></thead><tbody>
    ${runs.map((r) => {
      const s = summarize(unpackTrades(r.trades));
      const p = r.params;
      return `<tr class="${current?.id === r.id ? 'sel' : ''}">
        <td>${dt(r.at)}${p.note ? `<div class="muted small">${esc(p.note)}</div>` : ''}</td><td>${esc(p.tf)}</td><td>${isoDay(p.from)} → ${isoDay(p.to)}</td>
        <td class="num">${p.coins.length}</td><td>${esc({ both: 'ikisi', break: 'B kırılımı', zone: 'bölge' }[p.entryType])}</td>
        <td class="small">${esc(settingsText(p))}</td>
        <td class="num">${s.n}</td><td class="num">${fmtPct(s.winRate, 0)}</td><td class="num ${s.avgR >= 0 ? 'pos' : 'neg'}">${fmtR(s.avgR)}</td>
        <td class="num">${fmtPF(s.pf)}</td><td class="num ${s.totalR >= 0 ? 'pos' : 'neg'}">${fmtR(s.totalR)}</td>
        <td class="acts"><button type="button" class="ghost sm" data-show="${r.id}">Göster</button><button type="button" class="ghost sm" data-del="${r.id}" aria-label="Sil">Sil</button></td></tr>`;
    }).join('')}</tbody>`;
  for (const b of document.querySelectorAll('[data-show]')) b.addEventListener('click', () => { show(loadRuns().find((r) => r.id === b.dataset.show)); $('#results').scrollIntoView({ behavior: 'smooth' }); });
  for (const b of document.querySelectorAll('[data-del]')) {
    b.addEventListener('click', () => {
      if (!confirm('Bu backtest kaydı silinsin mi?')) return;
      deleteRun(b.dataset.del);
      if (current?.id === b.dataset.del) { current = null; $('#results').hidden = true; }
      renderRuns();
    });
  }
}

function exportRuns() {
  const blob = new Blob([JSON.stringify(loadRuns())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ew-backtests-${isoDay(Date.now())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importFile(file) {
  try {
    const n = importRuns(JSON.parse(await file.text()));
    setStatus(`<p>${n} çalışma içe aktarıldı.</p>`);
  } catch (err) {
    setStatus(`<p class="error">İçe aktarılamadı: ${esc(err.message)}</p>`);
  }
  renderRuns();
}

// ------------------------------------------------------------------ başlat
function init() {
  syncForm();
  const onSettings = (patch) => {
    settings = patch === null ? { ...UI_DEFAULTS } : { ...settings, ...patch };
    saveSettings(settings);
    if (patch === null) renderSettings($('#settings'), settings, onSettings);
    updateEstimate();
  };
  renderSettings($('#settings'), settings, onSettings);
  for (const b of document.querySelectorAll('#tf button')) {
    b.addEventListener('click', () => { params = { ...params, tf: b.dataset.tf, ...defaultsFor(b.dataset.tf) }; saveParams(); syncForm(); });
  }
  for (const k of ['from', 'to', 'topN', 'entryType', 'exitTarget', 'feePct', 'maxPending', 'maxHold', 'note']) {
    $('#' + k).addEventListener('change', (e) => { params[k] = e.target.value; saveParams(); updateEstimate(); });
  }
  $('#settingsBtn').addEventListener('click', () => {
    const el = $('#settings');
    el.hidden = !el.hidden;
    $('#settingsBtn').setAttribute('aria-expanded', String(!el.hidden));
  });
  $('#runBtn').addEventListener('click', run);
  $('#stopBtn').addEventListener('click', () => { running?.ctrl.abort(); running?.pool.terminate(); });
  $('#exportBtn').addEventListener('click', exportRuns);
  $('#importFile').addEventListener('change', (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });
  renderRuns();
  const last = loadRuns()[0];
  if (last) show(last);
}

init();
