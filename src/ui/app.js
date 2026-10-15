// Panel: araç çubuğu, tarama, özet, setup kartları ve ayrıntı (grafik + kural kontrolleri).
import { runScan } from '../scan/scanner.js';
import { findWave3Setups, compareSetups } from '../scan/wave3.js';
import { loadSettings, saveSettings, renderSettings, toScanOptions, UI_DEFAULTS } from './settings.js';
import { drawSetup, destroyChart, LEGEND } from './chart.js';
import { fmtPrice, fmtPct, fmtX, fmtTime, esc } from './format.js';

const $ = (sel) => document.querySelector(sel);
const NET_KEYS = ['timeframe', 'topN', 'manualCoins'];

const state = {
  settings: loadSettings(),
  scan: null, // runScan sonucu (mumlar önbellekte)
  setups: [],
  diagnostics: [],
  selected: null,
  busy: false,
  abort: null,
  timer: null,
  seenKeys: null,
};

const setupKey = (s) => `${s.coin}|${s.direction}|${s.points.p1.price}|${s.points.p2.price}`;

// ------------------------------------------------------------------ araç çubuğu
function syncToolbar() {
  const s = state.settings;
  for (const b of document.querySelectorAll('#tf button')) b.setAttribute('aria-pressed', String(b.dataset.tf === s.timeframe));
  $('#ruleSet').value = s.ruleSet;
  $('#showAll').checked = !!s.showAll;
}

function updateSettings(patch) {
  const prev = state.settings;
  state.settings = patch === null ? { ...UI_DEFAULTS } : { ...prev, ...patch };
  saveSettings(state.settings);
  syncToolbar();
  if (patch === null) renderSettings($('#settings'), state.settings, updateSettings);
  if ('autoRefresh' in (patch || {})) setupAutoRefresh();
  const netChanged = patch === null || NET_KEYS.some((k) => k in patch && String(patch[k]) !== String(prev[k]));
  if (!state.scan) return;
  if (netChanged) scan();
  else recompute();
}

// ------------------------------------------------------------------ tarama
async function scan({ silent = false } = {}) {
  if (state.busy) state.abort?.abort();
  const ctrl = new AbortController();
  state.abort = ctrl;
  state.busy = true;
  $('#scanBtn').disabled = true;
  $('#scanBtn').textContent = 'Taranıyor…';
  const prog = $('#progress');
  prog.hidden = false;
  setProgress(0, 0, 'Coin listesi alınıyor…');
  try {
    const opts = toScanOptions(state.settings);
    const diagnostics = [];
    const res = await runScan({ ...opts, diagnostics }, {
      signal: ctrl.signal,
      onProgress: ({ done, total, coin }) => setProgress(done, total, coin ? `${coin} (${done}/${total})` : `0/${total}`),
      onRetry: ({ attempt, wait }) => setProgress(null, null, `OKX yoğun, yeniden deneniyor (${attempt}. deneme, ${Math.round(wait / 1000)} sn)…`),
    });
    if (ctrl.signal.aborted) return;
    state.scan = res;
    state.diagnostics = diagnostics;
    state.setups = res.setups;
    notifyNew(silent);
    render();
  } catch (err) {
    if (err.name === 'AbortError') return;
    $('#summary').innerHTML = `<p class="error">Tarama başarısız: ${esc(err.message)}</p>`;
  } finally {
    if (state.abort === ctrl) {
      state.busy = false;
      $('#scanBtn').disabled = false;
      $('#scanBtn').textContent = 'Tara';
      prog.hidden = true;
    }
  }
}

/** Ağ gerektirmeyen ayar değişikliği: önbellekteki mumlar üzerinde algılamayı yeniden çalıştır. */
function recompute() {
  const opts = toScanOptions(state.settings);
  const diagnostics = [];
  const setups = [];
  for (const r of state.scan.results) {
    if (!r.candles.length) continue;
    for (const s of findWave3Setups(r.candles, { ...opts, diagnostics }, r.live)) setups.push({ ...s, coin: r.coin, instId: r.instId });
  }
  setups.sort(compareSetups);
  state.setups = setups;
  state.diagnostics = diagnostics;
  render();
}

function setProgress(done, total, text) {
  if (done != null && total) $('#progressBar').style.width = `${Math.round((100 * done) / total)}%`;
  if (done === 0) $('#progressBar').style.width = '0%';
  $('#progressText').textContent = text;
}

// ------------------------------------------------------------------ otomatik yenileme + bildirim
function setupAutoRefresh() {
  clearInterval(state.timer);
  state.timer = null;
  const min = Number(state.settings.autoRefresh) || 0;
  if (!min) return;
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  state.timer = setInterval(() => { if (!state.busy) scan({ silent: true }); }, min * 60e3);
}

function notifyNew(silent) {
  const keys = new Set(visibleSetups().map(setupKey));
  const prev = state.seenKeys;
  state.seenKeys = keys;
  if (!silent || !prev) return;
  const fresh = visibleSetups().filter((s) => !prev.has(setupKey(s)));
  if (!fresh.length || !('Notification' in window) || Notification.permission !== 'granted') return;
  const body = fresh.slice(0, 5).map((s) => `${s.coin} ${s.direction === 'long' ? 'LONG ▲' : 'SHORT ▼'} · ${s.stateLabel} · R:R ${fmtX(s.rr, 1)}`).join('\n');
  try { new Notification(`Yeni dalga-3 setup (${state.scan.tf.id})`, { body }); } catch { /* bazı tarayıcılarda yalnızca SW ile */ }
}

// ------------------------------------------------------------------ çizim
function visibleSetups() {
  const s = state.settings;
  return state.setups.filter((x) => s.showAll || ((x.state === 'ready' || x.state === 'triggered') && x.rr >= s.minRR));
}

const REASONS = [
  [/ABC/, 'Dalga 2 ABC değil'],
  [/Süre/, 'Dalga 2 dalga 1\'den kısa'],
  [/geri çekilme/, 'Geri çekilme bant dışı'],
  [/İtki/, 'İtki kuralı ihlali'],
  [/Dalga 1 küçük/, 'Dalga 1 küçük'],
];

function renderSummary() {
  const r = state.scan;
  const errors = r.results.filter((x) => x.error);
  const vis = visibleSetups();
  const active = state.setups.filter((x) => x.state === 'ready' || x.state === 'triggered');
  const lowRR = active.filter((x) => x.rr < state.settings.minRR).length;
  const counts = new Map();
  for (const d of state.diagnostics) {
    for (const reason of d.reasons) {
      const name = REASONS.find(([re]) => re.test(reason))?.[1] || reason;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  const chips = [...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="chip">${esc(k)}: ${v}</span>`).join('');
  $('#summary').innerHTML = `
    <p><strong>${r.results.length} coin</strong> · ${esc(r.tf.label)} · ${fmtTime(r.at)} ·
      <strong>${active.length}</strong> aktif setup${lowRR ? ` (${lowRR} tanesi R:R &lt; ${state.settings.minRR} olduğu için gizli)` : ''} ·
      ${state.setups.length - active.length} kaçan/bozulan
      ${errors.length ? `<span class="error"> · ${errors.length} coin okunamadı (${esc(errors.slice(0, 4).map((e) => e.coin).join(', '))})</span>` : ''}</p>
    ${chips ? `<div class="chips"><span class="chip muted">Elenen adaylar →</span>${chips}</div>` : ''}`;
  $('#listTitle').textContent = `Setup'lar (${vis.length})`;
}

function card(s) {
  const L = s.levels;
  const dirTxt = s.direction === 'long' ? 'LONG ▲' : 'SHORT ▼';
  const sel = state.selected && setupKey(state.selected) === setupKey(s);
  const faded = s.state === 'gone' || s.state === 'invalid' || s.rr < state.settings.minRR;
  return `
  <button type="button" class="card ${s.direction}${faded ? ' faded' : ''}" data-key="${esc(setupKey(s))}" aria-current="${sel}">
    <div class="head">
      <span class="coin">${esc(s.coin)}</span>
      <span class="dir ${s.direction}">${dirTxt}</span>
      <span class="state ${s.state}">${esc(s.stateLabel)}</span>
      <span class="score">Skor <b class="num">${s.score}</b> · R:R <b class="num">${fmtX(s.rr, 1)}</b></span>
    </div>
    <div class="meta">
      <span>Dalga 2: ${s.abc ? esc(s.abc.kind === 'flat' ? 'flat' : 'zigzag') : 'ABC yok'}</span>
      <span>Geri çekilme ${fmtPct(s.retr, 1)}</span>
      <span>Süre 2/1 = ${fmtX(s.timeRatio, 2)}</span>
      <span>${s.barsSince2} mum önce</span>
    </div>
    <div class="lv">
      <div><b>${s.state === 'triggered' ? 'Fiyat' : 'Tetik'}</b><span class="num">${fmtPrice(L.entry, s.price)}</span></div>
      <div><b>Stop</b><span class="num">${fmtPrice(L.stop, s.price)}</span></div>
      <div><b>Hedef 1</b><span class="num">${fmtPrice(L.targets[0].price, s.price)}</span></div>
      <div><b>Hedef 2</b><span class="num">${fmtPrice(L.targets[1]?.price, s.price)}</span></div>
    </div>
  </button>`;
}

function renderCards() {
  const vis = visibleSetups();
  const box = $('#cards');
  if (!vis.length) {
    box.innerHTML = `<div class="empty muted">Bu zaman diliminde tüm koşulları sağlayan setup yok.<br/>Başka bir zaman dilimi dene veya “Kaçan / bozulanları da göster”i aç.</div>`;
    return;
  }
  box.innerHTML = vis.map(card).join('');
  for (const el of box.querySelectorAll('.card')) {
    el.addEventListener('click', () => select(vis.find((s) => setupKey(s) === el.dataset.key)));
  }
}

const ICON = { pass: '✓', warn: '⚠', fail: '✗', info: 'i', na: '–' };

function ruleList(title, results) {
  const items = results
    .filter((r) => r.status !== 'na')
    .map((r) => `<li class="${r.status}"><span class="ic" aria-label="${r.status}">${ICON[r.status] || '·'}</span>
      <div><div class="nm">${esc(r.rule.name)}</div>${r.detail ? `<div class="dt">${esc(r.detail)}</div>` : ''}<div class="src">${esc(r.rule.source || '')}</div></div></li>`)
    .join('');
  return `<h3>${esc(title)}</h3><ul>${items}</ul>`;
}

function renderDetail() {
  const s = state.selected;
  const box = $('#detail');
  if (!s) {
    destroyChart();
    box.innerHTML = '<div class="empty muted">Bir setup seçince grafik ve kural kontrolleri burada görünür.</div>';
    return;
  }
  const r = state.scan.results.find((x) => x.coin === s.coin);
  const L = s.levels;
  const risk = Math.abs(L.entry - L.stop) / L.entry;
  const rsi = [];
  if (s.rsi.divergence) rsi.push(`C/A uyumsuzluk ${s.rsi.divergence.ok ? 'var ✓' : 'yok'} (${s.rsi.divergence.rA.toFixed(0)} → ${s.rsi.divergence.rC.toFixed(0)})`);
  if (s.rsi.w1Momentum) rsi.push(`dalga 1 RSI ${s.rsi.w1Momentum.r1.toFixed(0)} ${s.rsi.w1Momentum.ok ? '✓' : ''}`);
  const tv = `https://www.tradingview.com/chart/?symbol=OKX%3A${encodeURIComponent(s.coin)}USDT`;
  box.innerHTML = `
    <div class="detail-head">
      <h2>${esc(s.coin)}/USDT</h2>
      <span class="dir ${s.direction}">${s.direction === 'long' ? 'LONG ▲' : 'SHORT ▼'}</span>
      <span class="state ${s.state}">${esc(s.stateLabel)}</span>
      <span class="chip">${esc(state.scan.tf.id)} · derece ${s.sensitivity}×ATR</span>
      <a class="ext" href="${tv}" target="_blank" rel="noopener">TradingView'de aç ↗</a>
    </div>
    <div class="chart" id="chart"></div>
    <div class="legend">${LEGEND.map(([t, c, cls]) => `<span><i class="${cls}" style="border-top-color:${c}"></i>${esc(t)}</span>`).join('')}</div>
    <div class="facts">
      <div><b>Güncel fiyat</b><span class="num">${fmtPrice(s.price)}</span></div>
      <div><b>${s.state === 'triggered' ? 'Giriş (güncel)' : 'Tetik (B kırılımı)'}</b><span class="num">${fmtPrice(L.entry, s.price)}</span></div>
      <div><b>Stop</b><span class="num">${fmtPrice(L.stop, s.price)}</span> <small class="muted">risk ${fmtPct(risk)}</small></div>
      <div><b>Geçersizlik (0)</b><span class="num">${fmtPrice(L.invalidation, s.price)}</span></div>
      ${L.targets.map((t, i) => `<div><b>Hedef ${i + 1} (${t.k} × W1)</b><span class="num">${fmtPrice(t.price, s.price)}</span></div>`).join('')}
      <div><b>R:R (hedef ${state.settings.mainTarget + 1})</b><span class="num">${fmtX(s.rr, 2)}</span></div>
      <div><b>Dalga 2 geri çekilme</b><span class="num">${fmtPct(s.retr)}</span></div>
      <div><b>Süre: dalga 1 / dalga 2</b><span class="num">${s.durations.D1} / ${s.durations.D2} mum (${fmtX(s.timeRatio)})</span></div>
      <div><b>Dalga 2 yapısı</b><span>${s.abc ? esc(s.abc.label) : 'ABC bulunamadı'}</span></div>
      <div><b>RSI</b><span>${esc(rsi.join(' · ') || '–')}</span></div>
      <div><b>Hacim W1 / W2</b><span>${s.volume.ok ? 'W1 > W2 ✓' : 'W1 ≤ W2'}</span></div>
      <div><b>Skor</b><span class="num">${s.score}/100</span></div>
    </div>
    <div class="rules">
      ${ruleList(`İtki başlangıcı 0-1-2 (${state.settings.ruleSet})`, s.impulse.results)}
      ${s.abc ? ruleList(`Dalga 2 iç yapısı: ${s.abc.label}`, s.abc.results) : ''}
    </div>`;
  drawSetup($('#chart'), r.candles, r.live, s);
}

function select(s) {
  state.selected = s || null;
  renderCards();
  renderDetail();
  if (s && window.matchMedia('(max-width: 900px)').matches) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function render() {
  renderSummary();
  const vis = visibleSetups();
  const keep = state.selected && vis.find((s) => setupKey(s) === setupKey(state.selected));
  state.selected = keep || vis[0] || null;
  renderCards();
  renderDetail();
}

// ------------------------------------------------------------------ başlat
function init() {
  syncToolbar();
  renderSettings($('#settings'), state.settings, updateSettings);
  for (const b of document.querySelectorAll('#tf button')) b.addEventListener('click', () => updateSettings({ timeframe: b.dataset.tf }));
  $('#ruleSet').addEventListener('change', (e) => updateSettings({ ruleSet: e.target.value }));
  $('#showAll').addEventListener('change', (e) => { state.settings.showAll = e.target.checked; saveSettings(state.settings); if (state.scan) render(); });
  $('#scanBtn').addEventListener('click', () => scan());
  $('#settingsBtn').addEventListener('click', () => {
    const el = $('#settings');
    el.hidden = !el.hidden;
    $('#settingsBtn').setAttribute('aria-expanded', String(!el.hidden));
  });
  setupAutoRefresh();
  scan();
}

init();
