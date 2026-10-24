// Backtest sayfası: form, veri indirme + worker havuzu, sonuç raporu ve kayıtlı çalışmalar.
import { getTopCoins, TIMEFRAMES } from '../data/okx.js';
import { getHistory, estimateRequests } from './history.js';
import { summarize, BT_DEFAULTS, TRI_WINDOW } from './engine.js';
import { loadRuns, saveRun, deleteRun, importRuns, packTrades, unpackTrades, usedBytes, MAX_BYTES } from './store.js';
import { loadSettings, saveSettings, renderSettings, toScanOptions, UI_DEFAULTS } from '../ui/settings.js';
import { fmtPct, fmtX, esc } from '../ui/format.js';
import { simulate, toCsv, MONEY_DEFAULTS } from './money.js';
import { findWave3Setups } from '../scan/wave3.js';
import { findTriangles, TRI_DEFAULTS } from '../scan/triangle.js';
import { findAbcde, ABCDE_DEFAULTS } from '../scan/abcde.js';
import { findDiagonals, DIAG_DEFAULTS } from '../scan/diagonal.js';
import { refCoinFor, SMT_LABEL, SMT_HELP } from '../scan/smt.js';
import { drawSetup, drawTriangle, drawAbcde, drawDiagonal, drawTradeOnly, markTrade, destroyChart, LEGEND, TRI_LEGEND, ABCDE_LEGEND, DIAG_LEGEND } from '../ui/chart.js';

const $ = (s) => document.querySelector(s);
const PKEY = 'ew-setup-scanner:btparams:v1';
const DAY = 86400e3;
// Kısa zaman dilimlerinde istek sayısı çok büyür (1m'de 1 yıl ≈ coin başına 5000+ istek): aralık sınırlı.
const MAX_DAYS = { '1m': 14, '5m': 60 };
const QUICK = {
  '1m': [['1 gün', 1], ['3 gün', 3], ['7 gün', 7]],
  '5m': [['7 gün', 7], ['14 gün', 14], ['30 gün', 30]],
  '15m': [['7 gün', 7], ['30 gün', 30], ['90 gün', 90]],
  '4H': [['3 ay', 91], ['6 ay', 182], ['1 yıl', 365]],
  '1D': [['1 yıl', 365], ['2 yıl', 730], ['3 yıl', 1095]],
};
const TYPE_NAME = { break: 'B kırılımı', zone: 'Limit bölge', triangle: 'Üçgen kırılımı', elimit: 'ABCDE · E limiti (C–D %61,8)', econfirm: 'ABCDE · E onayı', d4lim: 'Diagonal 4 → 5 · dalga 4 limiti', d4conf: 'Diagonal 4 → 5 · 4 onayı', dend: 'Ending diagonal · 2–4 kırılımı', dlead: 'Leading diagonal · dalga 2 limiti' };
const isAbcdeT = (t) => t.type === 'elimit' || t.type === 'econfirm';
const isDiagT = (t) => ['d4lim', 'd4conf', 'dend', 'dlead'].includes(t.type);
const windowFor = (mode) => (['triangle', 'abcde', 'diagonal'].includes(mode) ? TRI_WINDOW : BT_DEFAULTS.window);

let settings = loadSettings();
let params = loadParams();
let running = null; // { ctrl, workers }
let current = null; // gösterilen çalışma
let eqChart = null;
let moneyChart = null;
let filterMode = null;
let filter = { type: '', dir: '', coin: '', exit: '', smt: '' }; // sonuç filtresi (çalışma değişince sıfırlanır); exit: '' ana hedef | '1'..'n'
let view = { trades: [], p: null }; // süzülmüş işlemler
const MKEY = 'ew-setup-scanner:money:v1';
let moneyOpts = (() => { try { return { ...MONEY_DEFAULTS, ...JSON.parse(localStorage.getItem(MKEY) || '{}') }; } catch { return { ...MONEY_DEFAULTS }; } })();

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
    tf, ...defaultsFor(tf), topN: 20, mode: 'wave3', entryType: 'both', onlyPerfect: '', note: '',
    exitTarget: BT_DEFAULTS.exitTarget, feePct: BT_DEFAULTS.feePct, maxPending: BT_DEFAULTS.maxPending, maxHold: BT_DEFAULTS.maxHold,
    ...(p || {}), tf,
  };
}
function saveParams() { try { localStorage.setItem(PKEY, JSON.stringify(params)); } catch { /* yoksay */ } }

function syncForm() {
  for (const b of document.querySelectorAll('#tf button')) b.setAttribute('aria-pressed', String(b.dataset.tf === params.tf));
  for (const k of ['from', 'to', 'topN', 'mode', 'entryType', 'onlyPerfect', 'exitTarget', 'feePct', 'maxPending', 'maxHold', 'note']) $('#' + k).value = params[k];
  $('#to').max = isoDay(Date.now());
  document.body.classList.toggle('mode-triangle', params.mode === 'triangle');
  document.body.classList.toggle('mode-abcde', params.mode === 'abcde');
  document.body.classList.toggle('mode-diagonal', params.mode === 'diagonal');
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

/** Seçilen aralık; kısa zaman diliminde en fazla MAX_DAYS gün (başlangıç ileri alınır). */
function rangeOf() {
  const to = Math.min(dayMs(params.to, true), Date.now());
  let from = dayMs(params.from);
  const max = MAX_DAYS[params.tf];
  const clipped = max != null && to - from > max * DAY;
  if (clipped) from = to - max * DAY;
  return { from, to, clipped, max };
}

function updateEstimate() {
  const tf = TIMEFRAMES[params.tf];
  const { from, to, clipped, max } = rangeOf();
  if (!(to > from)) { $('#estimate').textContent = 'Bitiş tarihi başlangıçtan sonra olmalı.'; return; }
  if (clipped) {
    $('#estimate').textContent = `${params.tf}'de en fazla ${max} gün test edilir: başlangıç ${isoDay(from)} alınacak. `;
    $('#estimate').append(estimateText(tf, from, to));
    return;
  }
  $('#estimate').textContent = estimateText(tf, from, to);
}

function estimateText(tf, from, to) {
  const req = estimateRequests(tf, from - windowFor(params.mode) * tf.ms, to) * coinCount();
  const bars = Math.round((Math.min(to, Date.now()) - from) / tf.ms);
  const sec = Math.round(req * 0.12 + (bars * coinCount() * 0.0006) / Math.max(1, workerCount()));
  return `${coinCount()} coin × ${bars.toLocaleString('tr-TR')} mum · ~${req.toLocaleString('tr-TR')} OKX isteği · tahmini süre ${sec < 90 ? sec + ' sn' : Math.round(sec / 60) + ' dk'} (aynı aralık sayfa açıkken tekrar indirilmez)`;
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
  const { from, to } = rangeOf();
  if (!(to > from)) return setStatus('<p class="error">Bitiş tarihi başlangıçtan sonra olmalı.</p>');
  const scan = toScanOptions(settings);
  const opts = { ...scan, mode: params.mode, entryType: params.entryType, onlyPerfect: !!params.onlyPerfect };
  delete opts.manualCoins;
  const cfg = {
    from, to, opts,
    exitTarget: Number(params.exitTarget), feePct: Number(params.feePct),
    maxPending: Number(params.maxPending), maxHold: Number(params.maxHold), window: windowFor(params.mode),
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

    const refs = {};
    if (opts.smtRef !== 'off') {
      setStatus('<p>SMT referansı (BTC, ETH) indiriliyor…</p>');
      for (const rc of ['BTC', 'ETH']) {
        try { refs[rc] = await getHistory(`${rc}-USDT`, tf, from - cfg.window * tf.ms, to + cfg.maxHold * tf.ms, { signal: ctrl.signal }); } catch (err) { if (err.name === 'AbortError') throw err; }
      }
    }

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
          jobs.push(pool.run(candles, { ...cfg, ref: refs[refCoinFor(c.coin, opts.smtRef)] || null }).then((r) => {
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
        mode: params.mode, entryType: params.entryType, exitTarget: cfg.exitTarget, feePct: cfg.feePct, maxPending: cfg.maxPending, maxHold: cfg.maxHold,
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
  'rsiMode', 'volume', 'stopMode', 'stopAtr', 'targets', 'minRR', 'direction', 'zoneCExt', 'zoneRetr', 'zoneEntry', 'zoneStop', 'zoneTime',
  'perfectAtr', 'zoneFrontAtr', 'approachAtr', 'onlyPerfect', 'minRiskPct',
  'triType', 'triContext', 'flatAtr', 'minTops', 'minBottoms', 'minWidthBars', 'triTarget', 'triMinRR',
  'abcdeEntry', 'eRetr', 'innerAbc', 'w3Check', 'abcdeVariant', 'abcdeSens', 'abcdeStopAtr', 'abcdeTarget', 'abcdeMinRR',
  'diagType', 'diagShape', 'diagSens', 'diagW4Entry', 'diagW2Min', 'diagExpMax', 'diagRetr', 'diagStopAtr', 'diagEndTarget', 'diagLeadTarget', 'diagMinRR', 'smtRef', 'smtWin', 'smtOnly'];
const TRI_TARGET_TXT = { mm: 'ölçülü hareket', f382: '%38,2', f50: '%50', f618: '%61,8', f786: '%78,6', f100: '%100' };
function pickSettings(o) { return Object.fromEntries(SETTING_KEYS.map((k) => [k, o[k]])); }

const ZONE_ENTRY_TXT = { mid: 'kademeli', near: 'yakın kenar', far: 'uzak kenar', r618: 'sadece %61,8', c127: 'sadece 1,272A' };

function settingsText(p) {
  const s = p.settings;
  if (p.mode === 'triangle') {
    return [
      '▲▼ üçgen kırılımı',
      { all: 'yükselen + alçalan', asc: 'sadece yükselen', desc: 'sadece alçalan' }[s.triType] || 'tüm tipler',
      { all: 'tüm bağlamlar', 'after-down': 'düşüş sonrası', 'after-up': 'yükseliş sonrası' }[s.triContext] || 'tüm bağlamlar',
      `düz kenar ±${s.flatAtr} ATR`, `dokunuş ≥${s.minTops}/${s.minBottoms}`, `çıkış: ${TRI_TARGET_TXT[s.triTarget] || s.triTarget}`,
      `min R:R ${s.triMinRR}`, `kom. %${p.feePct}`,
    ].join(' · ');
  }
  if (p.mode === 'diagonal') {
    return [
      'Diagonal',
      { w4: 'dalga 4 → 5', ending: 'ending dönüşü', leading: 'leading', all: 'hepsi' }[s.diagType] || s.diagType || 'ending + leading',
      { all: 'daralan + genişleyen', contracting: 'sadece daralan', expanding: 'sadece genişleyen' }[s.diagShape] || s.diagShape,
      `kural seti ${s.ruleSet}`, `dalga 2 limiti %${+(s.diagRetr * 100).toFixed(1)}`,
      `hedef: ending ${s.diagEndTarget} / leading ${s.diagLeadTarget}`, `min R:R ${s.diagMinRR}`, `kom. %${p.feePct}`,
    ].join(' · ');
  }
  if (p.mode === 'abcde') {
    return [
      'ABCDE üçgen',
      s.w3Check === 'require' ? 'önceki hareket itki zorunlu' : 'itki tercih',
      { both: 'E limiti + E onayı', limit: 'sadece E limiti', confirm: 'sadece E onayı' }[s.abcdeEntry] || s.abcdeEntry,
      `E = C–D %${+(s.eRetr * 100).toFixed(1)}`,
      s.innerAbc === 'prefer' ? 'iç ABC tercih' : 'iç ABC zorunlu',
      { all: 'running + daralan', running: 'sadece running', contracting: 'sadece daralan' }[s.abcdeVariant],
      `çıkış: ${s.abcdeTarget}`, `min R:R ${s.abcdeMinRR}`, `kom. %${p.feePct}`,
    ].join(' · ');
  }
  const w1 = { 0: 'son pivot', 1: '1 geri', 2: '2 geri', 99: 'en geniş' }[s.w1Extend] ?? s.w1Extend;
  const parts = [
    `${s.ruleSet}`, `dalga 1: ${w1}`, `süre>${s.minTimeRatio}`, `min R:R ${s.minRR}`, `H${p.exitTarget + 1}`, `kom. %${p.feePct}`,
  ];
  if (s.minRiskPct > 0) parts.push(`min stop %${s.minRiskPct}`);
  if (s.onlyPerfect) parts.unshift(`★ sadece mükemmel (≤${s.perfectAtr} ATR)`);
  if (p.entryType !== 'break') {
    parts.push(`bölge ${ZONE_ENTRY_TXT[s.zoneEntry] || s.zoneEntry}/${s.zoneStop === 'r886' ? 'stop %88,6' : 'stop 0'}${s.zoneTime === 'ignore' ? '/süresiz' : ''}`);
    if (s.zoneFrontAtr != null) parts.push(`ön pay ${s.zoneFrontAtr} ATR`);
  }
  if (p.entryType !== 'zone') parts.push(`B stop ${s.stopMode}`);
  return parts.join(' · ');
}

// ------------------------------------------------------------------ rapor
const fmtR = (r) => { const v = Math.abs(r) < 0.005 ? 0 : r; return `${v > 0 ? "+" : ""}${v.toFixed(2)}R`; };
const fmtPF = (pf) => (pf === Infinity ? '∞' : pf.toFixed(2));

function statRow(name, s) {
  return `<tr><td>${esc(name)}</td><td class="num">${s.n}</td><td class="num">${fmtPct(s.winRate, 0)}</td><td class="num ${s.avgR >= 0 ? 'pos' : 'neg'}">${fmtR(s.avgR)}</td><td class="num ${s.totalR >= 0 ? 'pos' : 'neg'}">${fmtR(s.totalR)}</td><td class="num">${fmtPF(s.pf)}</td></tr>`;
}

const WIDTH_BUCKETS = ['≤ 0,25 ATR', '0,25–0,5 ATR', '0,5–1 ATR', '1–2,5 ATR', '> 2,5 ATR'];
function widthBucket(w) {
  if (w == null) return null;
  return WIDTH_BUCKETS[w <= 0.25 ? 0 : w <= 0.5 ? 1 : w <= 1 ? 2 : w <= 2.5 ? 3 : 4];
}

// Stop mesafesi ve komisyon maliyeti işlemin entry / exit / stop alanlarından hesaplanır (eski kayıtlarda da çalışır).
const tradeRiskPct = (t) => (Math.abs(t.entry - t.stop) / t.entry) * 100;
const tradeFeeR = (t, feePct) => ((feePct / 100) * (t.entry + t.exit)) / (Math.abs(t.entry - t.stop) || Infinity);
const RISK_BUCKETS = ['< %1', '%1–2', '%2–4', '%4–8', '> %8'];
const riskBucket = (p) => RISK_BUCKETS[p < 1 ? 0 : p < 2 ? 1 : p < 4 ? 2 : p < 8 ? 3 : 4];
const FEE_BUCKETS = ['< 0,1R', '0,1–0,25R', '0,25–0,5R', '> 0,5R'];
const feeBucket = (f) => FEE_BUCKETS[f < 0.1 ? 0 : f < 0.25 ? 1 : f < 0.5 ? 2 : 3];

function groupTable(title, trades, keyFn, { limit = 0, sort = 'n', order = null } = {}) {
  const groups = new Map();
  for (const t of trades) {
    const k = keyFn(t);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  let rows = [...groups].map(([k, list]) => [k, summarize(list)]).filter(([, s]) => s.n);
  rows.sort((a, b) => (order ? order.indexOf(a[0]) - order.indexOf(b[0]) : sort === 'R' ? b[1].totalR - a[1].totalR : b[1].n - a[1].n));
  if (limit && rows.length > limit * 2) rows = [...rows.slice(0, limit), ['…', null], ...rows.slice(-limit)];
  if (!rows.length) return '';
  return `<div class="bd"><h3>${esc(title)}</h3><table class="stat"><thead><tr><th></th><th>İşlem</th><th>Kazanma</th><th>Ort.</th><th>Toplam</th><th>PF</th></tr></thead>
    <tbody>${rows.map(([k, s]) => (s ? statRow(String(k), s) : '<tr><td colspan="6" class="muted">…</td></tr>')).join('')}</tbody></table></div>`;
}

// ---------------------------------------------------------------- üçgen: nereye kadar gitti
const CONTEXT_TXT = { 'after-down': 'Düşüş sonrası', 'after-up': 'Yükseliş sonrası' };
const FIB_STEPS = [0.382, 0.5, 0.618, 0.786, 1];
const MM_STEPS = [0.5, 1, 1.5, 2];
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pctOf = (list, ok) => (list.length ? `%${Math.round((100 * list.filter(ok).length) / list.length)}` : '–');

/**
 * Her kırılımın stop görülmeden önce ulaştığı en uç nokta:
 *  - Fib: kırılım önceki hareketin tersineyse geri alınan oran (TRX: düşüşün %61,8'i), aynı yöndeyse kırılımdan izdüşüm oranı.
 *  - Ölçülü: kırılım seviyesinden üçgen yüksekliğinin katı.
 */
function reachTable(list) {
  if (!list.length) return '';
  const groups = [
    ['Hepsi', list],
    ['Yükselen üçgen ▲', list.filter((t) => t.pattern === 'asc')],
    ['Alçalan üçgen ▼', list.filter((t) => t.pattern === 'desc')],
    ['Yükselen · düşüş sonrası', list.filter((t) => t.pattern === 'asc' && t.context === 'after-down')],
    ['Yükselen · yükseliş sonrası', list.filter((t) => t.pattern === 'asc' && t.context === 'after-up')],
    ['Alçalan · yükseliş sonrası', list.filter((t) => t.pattern === 'desc' && t.context === 'after-up')],
    ['Alçalan · düşüş sonrası', list.filter((t) => t.pattern === 'desc' && t.context === 'after-down')],
  ].filter(([, g]) => g.length);
  const num = (x, d = 2) => (x == null ? '–' : x.toFixed(d).replace('.', ','));
  const rows = groups.map(([name, g]) => {
    const withFib = g.filter((t) => t.mfeFib != null);
    return `<tr><td>${esc(name)}</td><td class="num">${g.length}</td>
      ${FIB_STEPS.map((r) => { const ahead = withFib.filter((t) => t.startFib == null || t.startFib < r); return `<td class="num" title="${ahead.length} kırılımda seviye henüz ilerideydi">${pctOf(ahead, (t) => t.mfeFib >= r)}</td>`; }).join('')}
      <td class="num">${num(median(withFib.map((t) => t.mfeFib)))}</td>
      ${MM_STEPS.map((k) => `<td class="num">${pctOf(g, (t) => t.mfeH >= k)}</td>`).join('')}
      <td class="num">${num(median(g.map((t) => t.mfeH)))}×</td></tr>`;
  }).join('');
  return `<div class="bd reach"><h3>Nereye kadar gitti? (kırılımdan sonra, stop görülmeden önce ulaşılan en uç nokta)</h3>
    <table class="stat"><thead>
      <tr><th></th><th></th><th colspan="6">Önceki hareketin Fib seviyesine ulaşan</th><th colspan="5">Ölçülü hareket (üçgen yüksekliği) katı</th></tr>
      <tr><th>Grup</th><th>Kırılım</th>${FIB_STEPS.map((r) => `<th>%${String(+(r * 100).toFixed(1)).replace(".", ",")}</th>`).join('')}<th>Medyan</th>${MM_STEPS.map((k) => `<th>${String(k).replace('.', ',')}×</th>`).join('')}<th>Medyan</th></tr>
    </thead><tbody>${rows}</tbody></table>
    <p class="muted small">Fib: kırılım önceki hareketin tersine ise (ör. düşüş sonrası yükselen üçgen) önceki hareketin geri alınan oranı;
    aynı yöndeyse kırılım seviyesinden önceki hareket boyunun izdüşümü. Her Fib sütunu yalnızca kırılım anında o seviyenin henüz ileride olduğu işlemleri sayar (zaten geçilmiş seviyeler hariç). Örnek: "%61,8 → %40" bu kırılımların %40'ı stop olmadan önce %61,8'e ulaştı demek.</p></div>`;
}

/** ABCDE: girişten sonra stop görülmeden hangi hedeflere ulaşıldı (plan ve tipe göre). */
function abcdeReachTable(list) {
  if (!list.length) return '';
  const KEYS = [['top', "Başlangıç 0 (running'de B)"], ['thrust', 'Thrust'], ['e1236', 'Önceki hareket × 1,236'], ['e1618', 'Önceki hareket × 1,618']];
  const groups = [
    ['Hepsi', list],
    ...['elimit', 'econfirm'].map((ty) => [TYPE_NAME[ty], list.filter((t) => t.type === ty)]),
    ['Running', list.filter((t) => t.pattern === 'running')],
    ['Daralan', list.filter((t) => t.pattern === 'contracting')],
    ['LONG ▲', list.filter((t) => t.dir === 'long')],
    ['SHORT ▼', list.filter((t) => t.dir === 'short')],
  ].filter(([, g]) => g.length);
  const rows = groups.map(([name, g]) => `<tr><td>${esc(name)}</td><td class="num">${g.length}</td>${KEYS.map(([k]) => `<td class="num">${pctOf(g, (t) => t.reach[k])}</td>`).join('')}</tr>`).join('');
  return `<div class="bd reach"><h3>ABCDE: nereye kadar gitti? (girişten sonra, stop görülmeden önce)</h3>
    <table class="stat"><thead><tr><th>Grup</th><th>İşlem</th>${KEYS.map(([, n]) => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    <p class="muted small">Ana hedefte çıkılsa bile fiyat stop görülene (ya da maks. pozisyon süresi dolana) kadar izlenir.</p></div>`;
}

/** Diagonal: girişten sonra stop görülmeden hangi hedeflere ulaşıldı (tür ve şekle göre). */
function diagReachTable(list) {
  if (!list.length) return '';
  const block = (title, rows, keys) => {
    const g = rows.filter(([, x]) => x.length);
    if (!g.length) return '';
    return `<h3>${esc(title)}</h3><table class="stat"><thead><tr><th>Grup</th><th>İşlem</th>${keys.map(([, n]) => `<th>${esc(n)}</th>`).join('')}</tr></thead>
      <tbody>${g.map(([name, x]) => `<tr><td>${esc(name)}</td><td class="num">${x.length}</td>${keys.map(([k]) => `<td class="num">${pctOf(x, (t) => t.reach[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  };
  const end = list.filter((t) => t.type === 'dend'), lead = list.filter((t) => t.type === 'dlead');
  const w4 = list.filter((t) => t.type === 'd4lim' || t.type === 'd4conf');
  const w4rows = [['Hepsi', w4], ['Dalga 4 limiti', w4.filter((t) => t.type === 'd4lim')], ['4 onayı', w4.filter((t) => t.type === 'd4conf')], ['Daralan', w4.filter((t) => t.pattern === 'contracting')], ['Genişleyen', w4.filter((t) => t.pattern === 'expanding')]];
  const split = (g) => [['Hepsi', g], ['Daralan', g.filter((t) => t.pattern === 'contracting')], ['Genişleyen', g.filter((t) => t.pattern === 'expanding')]];
  return `<div class="bd reach"><h3>Diagonal: nereye kadar gitti? (girişten sonra, stop görülmeden önce)</h3>
    ${block('Dalga 4 → 5', w4rows, [['p3', "3'ün ucu (hedef)"]])}
    ${block('Ending (dönüş)', split(end), [['p4', '4 ucu'], ['p2', '2 ucu'], ['p0', 'Başlangıç (0)']])}
    ${block('Leading (devam)', split(lead), [['p5', '5 ucu'], ['w3a', 'Dalga 3 = 1×'], ['w3b', 'Dalga 3 = 1,618×']])}</div>`;
}

// ------------------------------------------------------------------ filtreler (para panelinde, düğmeler)
// Modun alt türleri: anahtar → işlem eşleşmesi
const SUBTYPES = {
  diagonal: [['', 'Hepsi'], ['w4', 'Dalga 4 → 5', (t) => t.type === 'd4lim' || t.type === 'd4conf'], ['d4lim', 'Dalga 4 limiti'], ['d4conf', '4 onayı'], ['dend', 'Ending'], ['dlead', 'Leading']],
  abcde: [['', 'Hepsi'], ['elimit', 'E limiti'], ['econfirm', 'E onayı']],
  wave3: [['', 'Hepsi'], ['break', 'B kırılımı'], ['zone', 'Limit bölge']],
  triangle: [['', 'Hepsi'], ['asc', 'Yükselen', (t) => t.pattern === 'asc'], ['desc', 'Alçalan', (t) => t.pattern === 'desc']],
};
const subtypesOf = (mode) => SUBTYPES[mode] || SUBTYPES.wave3;
function matchType(t, mode, key) {
  if (!key) return true;
  const st = subtypesOf(mode).find(([k]) => k === key);
  if (!st) return true;
  return st[2] ? st[2](t) : t.type === key;
}

/**
 * Hedef düğmeleri için: kaç hedef var ve her sıradaki en sık hedef adı (oranıyla).
 * Hedefler girişten yakından uzağa sıralı; girişin gerisinde kalan hedef atlandığı için sıra işlemden işleme kayabilir.
 */
function exitTargets(list) {
  const withAlts = list.filter((t) => Array.isArray(t.alts) && t.alts.length);
  if (!withAlts.length) return null;
  const max = Math.max(...withAlts.map((t) => t.alts.length));
  return Array.from({ length: max }, (_, k) => {
    const cnt = new Map();
    for (const t of withAlts) { const a = t.alts[Math.min(k, t.alts.length - 1)]; cnt.set(a.n, (cnt.get(a.n) || 0) + 1); }
    const [name, n] = [...cnt].sort((x, y) => y[1] - x[1])[0];
    return { name, share: n / withAlts.length };
  });
}

function filterBar(all, p) {
  const seg = (key, items, cur, label) => `<div class="fgroup"><span class="flabel">${esc(label)}</span><div class="seg wrap" role="group" aria-label="${esc(label)}">
    ${items.map(([v, t, title = '', disabled = false]) => `<button type="button" data-f="${key}" data-v="${esc(v)}" aria-pressed="${String(cur === v)}"${disabled ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${esc(t)}</button>`).join('')}
  </div></div>`;
  const types = subtypesOf(p.mode).map(([k, t, test]) => [k, t, '', k !== '' && !all.some((x) => (test ? test(x) : x.type === k))]);
  const dirs = [['', 'Hepsi'], ['long', 'Long ▲', '', !all.some((x) => x.dir === 'long')], ['short', 'Short ▼', '', !all.some((x) => x.dir === 'short')]];
  const inType = all.filter((t) => matchType(t, p.mode, filter.type));
  const tg = exitTargets(inType);
  const exits = tg
    ? [['', 'Ana hedef', 'Backtest\'in kullandığı ana hedef'], ...tg.map((x, k) => [String(k + 1), `Hedef ${k + 1}`, `Hedef ${k + 1}: ${x.name}${x.share < 1 ? ` (işlemlerin %${Math.round(x.share * 100)}'ünde)` : ''}`])]
    : [['', 'Ana hedef'], ['1', 'Hedef 1', 'Bu çalışma eski: her hedef için çıkış kaydı yok. Backtest\'i yeniden çalıştır.', true], ['2', 'Hedef 2', '', true], ['3', 'Hedef 3', '', true]];
  const coins = [...new Set(all.map((t) => t.coin))].sort();
  const hasSmt = all.some((t) => t.smt);
  const smtSeg = hasSmt ? seg('smt', [['', 'Hepsi'], ...Object.keys(SMT_LABEL).map((k) => [k, SMT_LABEL[k], SMT_HELP[k], !all.some((t) => t.smt === k)])], filter.smt, 'SMT') : '';
  const pct = (x) => (x.share < 0.995 ? ` <span class="muted">(%${Math.round(x.share * 100)})</span>` : '');
  const exitNames = tg ? `<div class="fnote">${tg.map((x, k) => `<span${filter.exit === String(k + 1) ? ' class="on"' : ''}>Hedef ${k + 1} = ${esc(x.name)}${pct(x)}</span>`).join(' · ')}</div>` : '<div class="fnote muted">Bu çalışma eski: hedef karşılaştırması için backtest\'i yeniden çalıştır.</div>';
  return `<div class="filterbar">
    ${seg('type', types, filter.type, 'Tür')}
    ${seg('dir', dirs, filter.dir, 'Yön')}
    <div class="fgroup">${seg('exit', exits, filter.exit, 'Çıkış hedefi')}${exitNames}</div>
    ${smtSeg}
    <div class="fgroup"><span class="flabel">Coin</span><select id="fCoin"><option value="">Hepsi</option>${coins.map((c) => `<option value="${esc(c)}"${filter.coin === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
  </div>`;
}

function bindFilterBar() {
  for (const btn of document.querySelectorAll('#money [data-f]')) {
    btn.addEventListener('click', () => { filter = { ...filter, [btn.dataset.f]: btn.dataset.v }; show(current); });
  }
  const c = $('#fCoin');
  if (c) c.addEventListener('change', () => { filter = { ...filter, coin: c.value }; show(current); });
}

/** Panel başlığındaki tek satır: hangi çalışma ve hangi filtre. */
function filterLine(p) {
  const parts = [p.tf, `${isoDay(p.from)} → ${isoDay(p.to)}`, `${p.coins.length} coin`, MODE_NAME[p.mode] || p.mode];
  const st = subtypesOf(p.mode).find(([k]) => k === filter.type);
  if (filter.type && st) parts.push(st[1]);
  if (filter.dir) parts.push(filter.dir === 'long' ? 'Long' : 'Short');
  parts.push(filter.exit ? `Hedef ${filter.exit}` : 'Ana hedef');
  if (filter.smt) parts.push(SMT_LABEL[filter.smt]);
  if (filter.coin) parts.push(filter.coin);
  return parts.join(' · ');
}
const MODE_NAME = { wave3: 'Dalga-3', triangle: 'Üçgen kırılımı', abcde: 'Running üçgen (ABCDE)', diagonal: 'Diagonal' };

/** İşlemi k. hedefte çıkmış gibi yeniden yazar (aynı giriş ve stop). Hedefi daha az olan işlemde son hedef kullanılır. */
function withExit(t, k, feePct) {
  if (!Array.isArray(t.alts) || !t.alts.length) return t;
  const a = t.alts[Math.min(k, t.alts.length) - 1];
  const d = t.dir === 'short' ? -1 : 1;
  const risk = d * (t.entry - t.stop);
  const fee = (feePct / 100) * (t.entry + a.x);
  const R = risk > 0 ? (d * (a.x - t.entry) - fee) / risk : t.R;
  const bars = t.bars + Math.round((a.e - t.exitTime) / Math.max(1, (t.exitTime - t.entryTime) / Math.max(1, t.bars)));
  return { ...t, exit: a.x, outcome: a.o, exitTime: a.e, target: a.p, R, bars: Number.isFinite(bars) ? bars : t.bars, exitName: a.n, mae: a.m ?? t.mae };
}

// ------------------------------------------------------------------ para simülasyonu
const usd = (x, sign = true) => `${sign && x > 0 ? '+' : ''}${x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const MODE_TXT = { fixed: 'Her işleme sabit tutar (bütün sinyaller)', single: 'Tek pozisyon, bakiyenin tamamı (bileşik)', slots: 'Sermayeyi N parçaya böl' };

function moneyForm() {
  const o = moneyOpts;
  const num = (id, label, v, step, min, hint = '') => `<label class="field"><span>${esc(label)}</span><input type="number" id="${id}" value="${v}" step="${step}" min="${min}"/>${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
  return `<div class="money-form">
    <label class="field"><span>Sermaye kullanımı</span><select id="mMode">${Object.entries(MODE_TXT).map(([k, t]) => `<option value="${k}"${o.mode === k ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    ${num('mCapital', 'Başlangıç sermayesi ($)', o.capital, 10, 1)}
    ${o.mode === 'fixed' ? num('mMargin', 'İşlem başı teminat ($)', o.margin, 1, 1) : ''}
    ${o.mode === 'slots' ? num('mSlots', 'Parça sayısı (aynı anda en fazla)', o.slots, 1, 1) : ''}
    ${num('mLev', 'Kaldıraç (×)', o.leverage, 1, 1, '1 = kaldıraçsız (spot)')}
    ${num('mFee', 'Komisyon (% / taraf)', o.feePct, 0.01, 0, 'Spot ~%0,1, OKX vadeli taker ~%0,05')}
    ${o.leverage > 1 ? num('mMmr', 'Bakım teminatı (%)', o.mmr, 0.1, 0, 'Tasfiye fiyatını belirler') : ''}
  </div>`;
}

function renderMoney() {
  const { trades, p } = view;
  const box = $('#money');
  if (!p) {
    box.innerHTML = `<div class="bt-title"><h2>Para simülasyonu</h2><span class="muted">${esc(MODE_TXT[moneyOpts.mode])}${moneyOpts.leverage > 1 ? ` · ${moneyOpts.leverage}× kaldıraç` : ''}</span></div>
      ${moneyForm()}
      <p class="muted">Backtest'i çalıştırınca ya da aşağıdaki kayıtlı çalışmalardan birini açınca sonuç burada görünür; tür, yön ve hedefe göre süzebilirsin.</p>`;
    bindMoneyForm();
    return;
  }
  const sim = simulate(trades, moneyOpts);
  const S = sim.summary, o = moneyOpts;
  const cls = (x) => (x >= 0 ? 'pos' : 'neg');
  const tiles = `<div class="tile-row">
    ${tile('Net kâr/zarar', usd(S.net), cls(S.net))}
    ${o.mode === 'fixed' ? tile('Sabit tutarla toplam getiri', fmtPct(S.net / Math.max(1, S.taken * o.margin), 1), cls(S.net)) : tile('Son bakiye', `${usd(S.final, false)} <small class="muted">${fmtPct(S.returnPct, 1)}</small>`, cls(S.net))}
    ${tile('Alınan / atlanan sinyal', `${S.taken} / ${S.skipped}`)}
    ${tile('Kârlı / zararlı', `${S.wins} / ${S.losses}${S.open ? ` <small class="muted">+${S.open} açık</small>` : ''}`)}
    ${o.leverage > 1 ? tile('Tasfiye', `${S.liquidated}${S.approx ? ' <small class="muted">yaklaşık</small>' : ''}`, S.liquidated ? 'neg' : '') : ''}
    ${tile('Ort. kazanç / kayıp', `${usd(S.avgWin)} / ${usd(S.avgLoss)}`)}
    ${tile('En iyi / en kötü işlem', `${usd(S.best)} / ${usd(S.worst)}`)}
    ${tile('En büyük düşüş', `${usd(-S.maxDD)}${S.lowBalance > 0 ? ` <small class="muted">${fmtPct(S.maxDDPct, 1)}</small>` : ''}`, 'neg')}
    ${tile('En düşük bakiye', usd(S.lowBalance, false), S.lowBalance < 0 ? 'neg' : '')}
    ${o.mode === 'single' ? tile('En büyük pozisyon teminatı', usd(S.maxMargin, false)) : tile('Aynı anda gereken teminat', `${usd(S.maxMargin, false)} <small class="muted">${S.maxConcurrent} pozisyon</small>`)}
    ${S.open ? tile('Açık pozisyonlar (anlık)', usd(S.openPnl), cls(S.openPnl)) : ''}
  </div>`;
  const months = S.closed ? `<div class="bd"><h3>Aylık</h3><table class="stat"><thead><tr><th>Ay</th><th>İşlem</th><th>Kârlı</th><th>Kâr/zarar</th><th>Kümülatif</th></tr></thead><tbody>
    ${sim.months.map((m) => `<tr><td>${m.month}</td><td class="num">${m.n}</td><td class="num">${m.wins}</td><td class="num ${cls(m.pnl)}">${usd(m.pnl)}</td><td class="num ${cls(m.cum)}">${usd(m.cum)}</td></tr>`).join('')}</tbody></table></div>` : '';
  const coins = S.closed ? `<div class="bd"><h3>Coin</h3><table class="stat"><thead><tr><th>Coin</th><th>İşlem</th><th>Kâr/zarar</th></tr></thead><tbody>
    ${sim.coins.map((c) => `<tr><td>${esc(c.coin)}</td><td class="num">${c.n}</td><td class="num ${cls(c.pnl)}">${usd(c.pnl)}</td></tr>`).join('')}</tbody></table></div>` : '';
  box.innerHTML = `
    <div class="bt-title"><h2>Para simülasyonu</h2><span class="muted">${esc(filterLine(p))}</span><span class="spacer"></span>
      <button type="button" id="csvBtn" class="ghost sm">İşlemleri CSV indir</button></div>
    ${filterBar(view.all, p)}
    ${moneyForm()}
    ${trades.length ? tiles : '<p class="muted">Bu filtrede işlem yok.</p>'}
    ${trades.length && (S.lowBalance < 0 || (o.mode === 'fixed' && S.maxMargin > o.capital)) ? `<p class="note">⚠ ${usd(o.capital, false)} sermaye bu ayarla yetmez:
      ${S.lowBalance < 0 ? `bakiye bir ara ${usd(S.lowBalance, false)}'a düşüyor` : ''}${S.lowBalance < 0 && S.maxMargin > o.capital ? ', ' : ''}${S.maxMargin > o.capital ? `aynı anda ${usd(S.maxMargin, false)} teminat gerekiyor` : ''}.
      Bu planı kesintisiz uygulamak için yaklaşık (en büyük düşüş + aynı anda gereken teminat) ${usd(Math.ceil((Math.max(0, o.capital - S.lowBalance) + S.maxMargin) / 10) * 10, false)} gerekir; ya da "Sermayeyi N parçaya böl" modunu kullan.</p>` : ''}
    <div class="chart eq" id="moneyChart"></div>
    <div class="breakdowns">${months}${coins}</div>
    <p class="muted small">Kâr/zarar = pozisyon (teminat × kaldıraç) × fiyat değişimi − komisyon (giriş + çıkış). Tasfiye: izole marjin,
      fiyat girişten ${o.leverage > 1 ? `≈ %${((1 / o.leverage - o.mmr / 100) * 100).toFixed(1).replace('.', ',')}` : '–'} aleyhe gidince teminatın tamamı gider; 4 saatlik (seçilen zaman dilimi) mum uç fiyatlarıyla ölçülür${S.approx ? ', bu çalışma eski olduğu için yaklaşık (yalnızca stop mesafesine bakılır; backtest\'i yeniden çalıştır)' : ''}.
      Aynı mumda birden çok sinyal varsa puanı yüksek olan önce alınır. Funding ve kayma dahil değil. Yatırım tavsiyesi değildir.</p>`;
  drawMoney(sim.curve);
  bindFilterBar();
  bindMoneyForm();
  $('#csvBtn').addEventListener('click', () => {
    const csv = toCsv(sim.rows, { typeName: TYPE_NAME, withMoney: true });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `backtest-${p.tf}-${isoDay(p.from)}-${isoDay(p.to)}${filter.type ? '-' + filter.type : ''}${filter.dir ? '-' + filter.dir : ''}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  renderTradeTable(sim);
}

function bindMoneyForm() {
  const bind = (id, key, conv = Number) => { const el = $(id); if (el) el.addEventListener('change', () => { moneyOpts = { ...moneyOpts, [key]: conv(el.value) }; try { localStorage.setItem(MKEY, JSON.stringify(moneyOpts)); } catch { /* yoksay */ } renderMoney(); }); };
  bind('#mMode', 'mode', String); bind('#mCapital', 'capital'); bind('#mMargin', 'margin'); bind('#mSlots', 'slots', (v) => Math.max(1, Math.round(Number(v)))); bind('#mLev', 'leverage', (v) => Math.max(1, Number(v))); bind('#mFee', 'feePct'); bind('#mMmr', 'mmr');
}

function drawMoney(curve) {
  const el = $('#moneyChart');
  if (moneyChart) { moneyChart.remove(); moneyChart = null; }
  const LW = window.LightweightCharts;
  if (!LW || curve.length < 2) { el.hidden = true; return; }
  el.hidden = false;
  moneyChart = LW.createChart(el, {
    width: el.clientWidth, height: el.clientHeight,
    layout: { background: { type: 'solid', color: '#121822' }, textColor: '#8f99aa', fontSize: 11 },
    grid: { vertLines: { color: '#1c2430' }, horzLines: { color: '#1c2430' } },
    rightPriceScale: { borderColor: '#1c2430' }, timeScale: { borderColor: '#1c2430', timeVisible: false },
  });
  const pts = [];
  for (const c of curve) { const time = Math.floor(c.time / 1000); if (pts.length && pts[pts.length - 1].time >= time) pts[pts.length - 1].value = c.value; else pts.push({ time, value: c.value }); }
  moneyChart.addSeries(LW.LineSeries, { color: '#7cc4a8', lineWidth: 2, priceLineVisible: false }).setData(pts);
  moneyChart.timeScale().fitContent();
}

function renderTradeTable(sim) {
  const byT = new Map(sim.rows.map((x) => [x.t, x]));
  const trades = view.trades;
  const rows = [...trades].sort((a, b) => b.entryTime - a.entryTime).slice(0, 500);
  const dt = (ms) => new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const m = (t) => byT.get(t);
  $('#trades').innerHTML = `<thead><tr><th></th><th>Giriş</th><th>Coin</th><th>Plan</th><th>Yön</th><th>Sonuç</th><th>R</th><th>Mum</th><th>Giriş fiyatı</th><th>Çıkış</th><th>Alındı</th><th>Kâr/zarar</th><th>Bakiye</th></tr></thead><tbody>
    ${rows.map((t, i) => { const x = m(t); return `<tr><td><button type="button" class="ghost sm" data-chart="${i}" title="Grafikte göster">📈</button></td><td>${dt(t.entryTime)}</td><td>${esc(t.coin)}</td><td>${TYPE_NAME[t.type]}${t.legs > 1 ? ` ${t.filledLegs}/${t.legs}` : ''}</td><td>${t.dir === 'long' ? '▲' : '▼'}</td><td>${esc(t.outcome)}${x?.liquidated ? ' <b class="neg">tasfiye</b>' : ''}</td>
      <td class="num ${t.R >= 0 ? 'pos' : 'neg'}">${fmtR(t.R)}</td><td class="num">${t.bars}</td><td class="num">${t.entry.toPrecision(5)}</td><td class="num">${t.exit.toPrecision(5)}</td>
      <td>${x?.taken ? '✓' : `<small class="muted">${esc(x?.reason || '')}</small>`}</td><td class="num ${x?.pnl >= 0 ? 'pos' : 'neg'}">${x?.taken ? usd(x.pnl) : ''}</td><td class="num">${x?.taken && !x.open && x.balance != null ? usd(x.balance, false) : x?.open ? 'açık' : ''}</td></tr>`; }).join('')}</tbody>
    ${trades.length > 500 ? `<caption class="muted">Son 500 işlem gösteriliyor (toplam ${trades.length}); hepsi için CSV indir.</caption>` : ''}`;
  for (const b of document.querySelectorAll('#trades [data-chart]')) b.addEventListener('click', () => showTradeChart(rows[Number(b.dataset.chart)]));
}

// ------------------------------------------------------------------ işlem grafiği
let chartReq = 0;
// Kayıtlı işlemlerde fiyatlar 6 anlamlı haneye yuvarlanır (store.js): eşleştirme buna göre toleranslı
const near = (a, b) => Math.abs(a - b) <= Math.abs(b) * 1e-5;

/**
 * İşlemin açıldığı mumda tarayıcının gördüğü kalıbı yeniden bulur (aynı ayarlar, aynı mum penceresi) ve tarama
 * ekranındaki grafikle çizer; gerçekleşen giriş ve çıkış işaretlenir. Kalıp bulunamazsa mumlar + seviyeler çizilir.
 */
async function showTradeChart(t) {
  const p = view.p;
  const box = $('#tradeView');
  const req = ++chartReq;
  box.hidden = false;
  const dirTxt = t.dir === 'short' ? 'SHORT ▼' : 'LONG ▲';
  const dt = (ms) => new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  box.innerHTML = `<div class="bt-title"><h2>${esc(t.coin)}/USDT</h2><span class="dir ${t.dir === 'short' ? 'short' : 'long'}">${dirTxt}</span>
      <span class="chip">${esc(TYPE_NAME[t.type] || t.type)}</span><span class="chip">${esc(p.tf)}</span>${t.smt ? `<span class="chip smt-${t.smt}" title="${esc(SMT_HELP[t.smt])}">${esc(SMT_LABEL[t.smt])}</span>` : ''}
      <span class="muted">${dt(t.entryTime)} → ${t.outcome === 'open' ? 'açık' : dt(t.exitTime)} · ${esc(t.outcome)} · <b class="${t.R >= 0 ? 'pos' : 'neg'}">${fmtR(t.R)}</b></span>
      <span class="spacer"></span><button type="button" id="tvClose" class="ghost sm">Kapat</button></div>
    <div class="chart" id="tvChart"><p class="muted" style="padding:16px">Mumlar indiriliyor…</p></div>
    <div class="legend" id="tvLegend"></div><p class="muted small" id="tvNote"></p>`;
  $('#tvClose').addEventListener('click', () => { destroyChart(); box.hidden = true; });
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const tf = TIMEFRAMES[p.tf];
    const win = windowFor(p.mode);
    const end = (t.outcome === 'open' ? Date.now() : t.exitTime) + 40 * tf.ms;
    const candles = await getHistory(`${t.coin}-USDT`, tf, t.created - (win + 5) * tf.ms, Math.min(end, Date.now()));
    if (req !== chartReq) return;
    const ci = candles.findIndex((c) => c.time === t.created);
    const off = Math.max(0, ci + 1 - win);
    const view2 = candles.slice(off); // indeksler pencereyle aynı başlangıçta: kalıp noktaları doğru yere düşer
    const opts = { ...TRI_DEFAULTS, ...ABCDE_DEFAULTS, ...DIAG_DEFAULTS, ...UI_DEFAULTS, ...(p.settings || {}), mode: p.mode, entryType: p.entryType };
    const s = ci >= 0 ? findPattern(candles.slice(off, ci + 1), t, opts) : null;
    const el = $('#tvChart');
    el.innerHTML = '';
    let legend;
    if (s?.kind === 'diagonal') { drawDiagonal(el, view2, null, s); legend = DIAG_LEGEND; }
    else if (s?.kind === 'abcde') { drawAbcde(el, view2, null, s); legend = ABCDE_LEGEND; }
    else if (s?.kind === 'triangle') { drawTriangle(el, view2, null, s); legend = TRI_LEGEND; }
    else if (s) { drawSetup(el, view2, null, s, { showBreak: t.type === 'break', showZone: t.type === 'zone' }); legend = LEGEND; }
    else drawTradeOnly(el, view2, t);
    markTrade(t);
    $('#tvLegend').innerHTML = (legend || []).map(([n, c, cls]) => `<span><i class="${cls}" style="border-top-color:${c}"></i>${esc(n)}</span>`).join('')
      + '<span><i style="border-top-color:#3987e5"></i>Gerçek giriş</span><span><i class="dash" style="border-top-color:#e8ebf1"></i>Çıkış</span>';
    $('#tvNote').textContent = s
      ? 'Kalıp, işlemin açıldığı mumda backtest\'in gördüğü haliyle (aynı ayarlar ve mum penceresi) yeniden bulundu; sonrasındaki mumlar fiyatın ne yaptığını gösterir. Seviye çizgileri o anki plana aittir; "Gerçek giriş" ve "Çıkış" işlemin gerçekleşen fiyatlarıdır.'
      : 'Kalıp bu ayarlarla yeniden bulunamadı (ayarlar backtest\'ten sonra değişmiş ya da veri farklı olabilir); yalnızca giriş, stop, hedef ve çıkış gösteriliyor.';
  } catch (err) {
    if (req === chartReq) $('#tvChart').innerHTML = `<p class="error" style="padding:16px">Mumlar alınamadı: ${esc(err.message)}</p>`;
  }
}

/** İşlemle aynı plan (tip, yön, stop) — tarayıcının o mumda bulduğu kalıp. */
function findPattern(win, t, opts) {
  const dirOk = (x) => x.direction === t.dir;
  if (opts.mode === 'diagonal') return findDiagonals(win, opts, null).find((x) => dirOk(x) && x.plans.some((q) => q.type === t.type && near(q.stop, t.stop))) || null;
  if (opts.mode === 'abcde') return findAbcde(win, opts, null).find((x) => dirOk(x) && x.plans.some((q) => q.type === t.type && near(q.stop, t.stop))) || null;
  if (opts.mode === 'triangle') return findTriangles(win, opts, null).find((x) => dirOk(x) && near(x.levels.stop, t.stop)) || null;
  return findWave3Setups(win, opts, null).find((x) => dirOk(x) && (t.type === 'zone' ? x.zone && near(x.zone.stop, t.stop) : x.levels && near(x.levels.stop, t.stop))) || null;
}

function tile(label, value, cls = '') { return `<div class="tile"><b>${esc(label)}</b><span class="num ${cls}">${value}</span></div>`; }

function show(runObj) {
  const p = runObj.params;
  // Aynı moddaki çalışmalar arasında filtre korunur; farklı moda geçince sıfırlanır
  if (runObj !== current && p.mode !== filterMode) { filter = { type: '', dir: '', coin: '', exit: '', smt: '' }; filterMode = p.mode; }
  current = runObj;
  const allTrades = unpackTrades(runObj.trades);
  if (filter.coin && !allTrades.some((t) => t.coin === filter.coin)) filter = { ...filter, coin: '' };
  const picked = allTrades.filter((t) => matchType(t, p.mode, filter.type) && (!filter.dir || t.dir === filter.dir) && (!filter.coin || t.coin === filter.coin) && (!filter.smt || t.smt === filter.smt));
  const trades = filter.exit ? picked.map((t) => withExit(t, Number(filter.exit), p.feePct)) : picked;
  view = { trades, p, all: allTrades };
  $('#results').hidden = false;
  $('#resTitle').textContent = `${p.tf} · ${isoDay(p.from)} → ${isoDay(p.to)} · ${p.coins.length} coin${p.note ? ' · ' + p.note : ''}`;
  $('#resMeta').textContent = settingsText(p) + (p.settings?.smtOnly ? " · sadece SMT'li" : '');

  const types = [...new Set(trades.map((t) => t.type))];
  const blocks = (types.length ? types : [p.entryType === 'zone' ? 'zone' : 'break']).map((type) => {
    const list = trades.filter((t) => t.type === type);
    const s = summarize(list);
    const gross = list.filter((t) => t.outcome !== 'open').reduce((a, t) => a + t.R + tradeFeeR(t, p.feePct), 0);
    return `<div class="tile-group"><h3>${TYPE_NAME[type]}</h3><div class="tile-row">
      ${tile('İşlem', `${s.n}${s.open ? ` <small class="muted">+${s.open} açık</small>` : ''}`)}
      ${tile('Kazanma', fmtPct(s.winRate, 1))}
      ${tile('Ort. R', fmtR(s.avgR), s.avgR >= 0 ? 'pos' : 'neg')}
      ${tile('Toplam R', fmtR(s.totalR), s.totalR >= 0 ? 'pos' : 'neg')}
      ${tile('Komisyonsuz toplam', fmtR(gross), gross >= 0 ? 'pos' : 'neg')}
      ${tile('Kâr faktörü', fmtPF(s.pf), s.pf >= 1 ? 'pos' : 'neg')}
      ${tile('Maks. düşüş', `${s.maxDD.toFixed(1)}R`)}
      ${tile('Hedef / stop / süre', `${s.targets} / ${s.stops} / ${s.timeouts}`)}
    </div></div>`;
  }).join('');
  const canc = Object.entries(runObj.cancelled || {}).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => { const [t, r] = k.split(':'); return `<span class="chip">${esc(TYPE_NAME[t] || t)}: ${esc(r)} ${v}</span>`; }).join('');
  const filtered = trades.length !== allTrades.length;
  $('#tiles').innerHTML = `${blocks}<p class="muted small">${runObj.orders} emir oluştu, ${allTrades.length} tanesi doldu${filtered ? ` · filtre: ${trades.length} işlem gösteriliyor` : ''}.</p>${canc ? `<div class="chips"><span class="chip muted">Dolmayan emirler →</span>${canc}</div>` : ''}`;

  drawEquity(trades, types);
  $('#reach').innerHTML = reachTable(trades.filter((t) => t.type === 'triangle' && t.mfeH != null)) + abcdeReachTable(trades.filter((t) => t.reach && isAbcdeT(t))) + diagReachTable(trades.filter((t) => t.reach && isDiagT(t)));

  const closed = trades.filter((t) => t.outcome !== 'open');
  $('#breakdowns').innerHTML = [
    groupTable('Plan tipi', closed, (t) => TYPE_NAME[t.type]),
    groupTable('Yön', closed, (t) => (t.dir === 'long' ? 'LONG ▲' : 'SHORT ▼')),
    groupTable('SMT (kalıbın son ucu, referans BTC / BTC için ETH)', closed, (t) => (t.smt ? SMT_LABEL[t.smt] : null)),
    groupTable('Plan tipi × SMT', closed, (t) => (t.smt ? `${TYPE_NAME[t.type]} · ${t.dir === 'long' ? 'L' : 'S'} · ${SMT_LABEL[t.smt]}` : null)),
    groupTable('Stop mesafesi (giriş → stop)', closed, (t) => riskBucket(tradeRiskPct(t)), { order: RISK_BUCKETS }),
    groupTable(`Komisyon maliyeti (%${p.feePct} → R)`, closed, (t) => feeBucket(tradeFeeR(t, p.feePct)), { order: FEE_BUCKETS }),
    groupTable('Üçgen tipi', closed.filter((t) => t.type === 'triangle'), (t) => (t.pattern === 'asc' ? 'Yükselen (yukarı kırılım)' : t.pattern === 'desc' ? 'Alçalan (aşağı kırılım)' : null)),
    groupTable('Önceki hareket (üçgen)', closed.filter((t) => t.type === 'triangle'), (t) => CONTEXT_TXT[t.context] || 'bağlam yok'),
    groupTable('ABCDE tipi', closed.filter(isAbcdeT), (t) => (t.pattern === 'running' ? "Running (B, 0'ı geçti)" : 'Daralan')),
    groupTable('ABCDE iç yapı', closed.filter(isAbcdeT), (t) => (t.context === 'inner' ? 'Her bacak 3’lü' : 'Eksik iç yapı')),
    groupTable('ABCDE önceki hareket', closed.filter(isAbcdeT), (t) => (t.abc === 'impulse' ? 'İtki (dalga 3) ✓' : 'İtki doğrulanamadı')),
    groupTable('Diagonal türü', closed.filter(isDiagT), (t) => TYPE_NAME[t.type]),
    groupTable('Diagonal şekli', closed.filter(isDiagT), (t) => (t.pattern === 'expanding' ? 'Genişleyen' : 'Daralan')),
    groupTable('Bölge gücü (limit bölge)', closed.filter((t) => t.type === 'zone'), (t) => t.strength),
    groupTable('Bölgede çakışan seviye', closed.filter((t) => t.type === 'zone'), (t) => `${t.inside} çakışma`),
    groupTable('★ Mükemmel mi (iki kenar çakışıyor)', closed, (t) => (t.perfect == null ? null : t.perfect ? '★ Mükemmel' : 'Değil')),
    groupTable('Bölge genişliği (iki kenar farkı)', closed, (t) => widthBucket(t.widthAtr), { order: WIDTH_BUCKETS }),
    groupTable('Dalga 2 tipi', closed.filter((t) => !t.reach), (t) => t.abc || 'ABC yok'),
    groupTable('Derece (× ATR)', closed, (t) => `${t.sensitivity}×`),
    groupTable('Kademeli dolum', closed.filter((t) => t.type === 'zone' && t.legs > 1), (t) => `${t.filledLegs}/${t.legs} doldu`),
    groupTable('Coin (en iyi / en kötü)', closed, (t) => t.coin, { limit: 5, sort: 'R' }),
  ].join('');

  renderMoney();
  renderRuns();
}

const EQ_COLORS = { break: '#3987e5', zone: '#ff9f43', elimit: '#ff9f43', econfirm: '#3987e5', dend: '#3987e5', dlead: '#ff9f43', d4lim: '#ff9f43', d4conf: '#3987e5', all: '#e8ebf1' };
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
    if (patch === null) renderSettings($('#settings'), settings, onSettings, { mode: params.mode });
    updateEstimate();
  };
  renderSettings($('#settings'), settings, onSettings, { mode: params.mode });
  for (const b of document.querySelectorAll('#tf button')) {
    b.addEventListener('click', () => { params = { ...params, tf: b.dataset.tf, ...defaultsFor(b.dataset.tf) }; saveParams(); syncForm(); });
  }
  for (const k of ['from', 'to', 'topN', 'mode', 'entryType', 'onlyPerfect', 'exitTarget', 'feePct', 'maxPending', 'maxHold', 'note']) {
    $('#' + k).addEventListener('change', (e) => { params[k] = e.target.value; saveParams(); updateEstimate(); });
  }
  $('#settingsBtn').addEventListener('click', () => {
    const el = $('#settings');
    el.hidden = !el.hidden;
    $('#settingsBtn').setAttribute('aria-expanded', String(!el.hidden));
  });
  $('#mode').addEventListener('change', () => { renderSettings($('#settings'), settings, onSettings, { mode: params.mode }); document.body.classList.toggle('mode-triangle', params.mode === 'triangle'); document.body.classList.toggle('mode-abcde', params.mode === 'abcde'); document.body.classList.toggle('mode-diagonal', params.mode === 'diagonal'); });
  $('#runBtn').addEventListener('click', run);
  $('#stopBtn').addEventListener('click', () => { running?.ctrl.abort(); running?.pool.terminate(); });
  $('#exportBtn').addEventListener('click', exportRuns);
  $('#importFile').addEventListener('change', (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });
  renderRuns();
  const last = loadRuns()[0];
  if (last) show(last);
  else renderMoney(); // sonuç yokken para paneli ayarlarıyla görünür
}

init();
