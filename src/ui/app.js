// Panel: araç çubuğu, tarama, özet, setup kartları ve ayrıntı (grafik + kural kontrolleri).
import { runScan, detect, sortSetups } from '../scan/scanner.js';
import { pickSetups, activePlans, riskPct, feeR, tbMissing } from '../scan/wave3.js';
import { pickTriangles, findTriangles } from '../scan/triangle.js';
import { pickAbcde } from '../scan/abcde.js';
import { pickDiagonals } from '../scan/diagonal.js';
import { loadSettings, saveSettings, renderSettings, toScanOptions, UI_DEFAULTS } from './settings.js';
import { drawSetup, drawTriangle, drawAbcde, drawDiagonal, destroyChart, LEGEND, TRI_LEGEND, ABCDE_LEGEND, DIAG_LEGEND } from './chart.js';
import { triCard, triDetail, triSummary, triKey } from './triangleView.js';
import { abcdeCard, abcdeDetail, abcdeSummary, abcdeKey } from './abcdeView.js';
import { diagCard, diagDetail, diagSummary, diagKey } from './diagonalView.js';
import { drawWatch } from './chart.js';
import { watchCard, watchDetail } from './watchView.js';
import { snapshot, evaluatePlan, isOpen, triangleShape } from '../watch/track.js';
import { loadWatch, addWatch, removeWatch, updateWatch, saveAll, findByKey, exportWatch, importWatch } from '../watch/store.js';
import { getCandles, TIMEFRAMES } from '../data/okx.js';
import { LONG_BARS } from '../scan/scanner.js';
import { fmtPrice, fmtPct, fmtX, fmtTime, esc, smtChip, conflictChip } from './format.js';

const $ = (sel) => document.querySelector(sel);
const NET_KEYS = ['timeframe', 'topN', 'manualCoins'];
const SHORT_TF = new Set(['1m', '5m']); // gürültü / komisyon uyarısı

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
  view: 'setups', // 'setups' | 'watch'
  watchEval: new Map(), // kayıt id → planların evaluatePlan sonuçları
  watchData: new Map(), // "instId|tf" → { candles, live }
  selectedWatch: null,
};

const isTri = () => state.settings.mode === 'triangle';
const isAbc = () => state.settings.mode === 'abcde';
const isDiag = () => state.settings.mode === 'diagonal';
const LONG_KINDS = new Set(['triangle', 'abcde', 'diagonal']); // 600 mumluk pencerede bulunanlar
const setupKey = (s) => (s.kind === 'triangle' ? triKey(s) : s.kind === 'abcde' ? abcdeKey(s) : s.kind === 'diagonal' ? diagKey(s) : `${s.coin}|${s.direction}|${s.phase}|${s.points.p0.price}|${s.points.p1.price}`);

// ------------------------------------------------------------------ araç çubuğu
function syncToolbar() {
  const s = state.settings;
  for (const b of document.querySelectorAll('#tf button')) b.setAttribute('aria-pressed', String(b.dataset.tf === s.timeframe));
  $('#ruleSet').value = s.ruleSet;
  $('#entryType').value = s.entryType;
  $('#showAll').checked = !!s.showAll;
  $('#onlyPerfect').checked = !!s.onlyPerfect;
  $('#mode').value = s.mode;
  // Dalga-3'e özgü kontroller üçgen modunda gizlenir
  document.body.classList.toggle('mode-triangle', s.mode === 'triangle');
  document.body.classList.toggle('mode-abcde', s.mode === 'abcde');
  document.body.classList.toggle('mode-diagonal', s.mode === 'diagonal');
}

function updateSettings(patch) {
  const prev = state.settings;
  state.settings = patch === null ? { ...UI_DEFAULTS } : { ...prev, ...patch };
  saveSettings(state.settings);
  syncToolbar();
  if (patch === null) renderSettings($('#settings'), state.settings, updateSettings);
  if ('autoRefresh' in (patch || {})) setupAutoRefresh();
  if (patch && 'mode' in patch && patch.mode !== prev.mode) renderSettings($('#settings'), state.settings, updateSettings); // seçili modun bölümü açılsın
  const netChanged = patch === null || NET_KEYS.some((k) => k in patch && String(patch[k]) !== String(prev[k]));
  if (!state.scan) { if (state.busy) scan(); return; } // ilk tarama sürerken değişiklik: yeniden başlat
  if (netChanged) { markStale(); scan(); }
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
    refreshWatch({ notify: silent });
  } catch (err) {
    if (err.name === 'AbortError' && ctrl.signal.aborted) return; // yerine yeni tarama başladı
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
    r.setups = detect(r, { ...opts, diagnostics }, state.scan.refs);
    for (const s of r.setups) setups.push({ ...s, coin: r.coin, instId: r.instId });
  }
  sortSetups(setups, opts);
  state.setups = setups;
  state.diagnostics = diagnostics;
  render();
}

/** Zaman dilimi / coin listesi değişti: eski sonuçlar yeni tarama bitene kadar soluk gösterilir. */
function markStale() {
  document.querySelector('.layout').classList.add('stale');
  $('#summary').innerHTML = `<p class="muted">${esc(state.settings.timeframe)} taranıyor… Aşağıdaki sonuçlar önceki taramaya ait.</p>`;
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
  if (isTri()) return notifyTriangles(silent);
  if (isAbc()) return notifyAbcde(silent);
  if (isDiag()) return notifyDiagonals(silent);
  const vis = pickSetups(state.setups, toScanOptions(state.settings));
  const keys = new Set(vis.map(setupKey));
  const approaching = new Set(vis.filter((s) => s.zone?.state === 'approaching').map(setupKey));
  const prev = state.seenKeys, prevApp = state.seenApproaching;
  state.seenKeys = keys;
  state.seenApproaching = approaching;
  if (!silent || !prev) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const line = (s) => `${s.zone?.perfect ? '★ ' : ''}${s.coin} ${dirTxt(s)} · ${planSummary(s)}`;
  const fresh = vis.filter((s) => !prev.has(setupKey(s)));
  // Emre yaklaşanlar ve mükemmel setup'lar ayrı bildirim: kaçırılmasın.
  const near = vis.filter((s) => approaching.has(setupKey(s)) && !prevApp?.has(setupKey(s)));
  const perfect = fresh.filter((s) => s.zone?.perfect);
  const other = fresh.filter((s) => !s.zone?.perfect);
  const tf = state.scan.tf.id;
  try {
    if (near.length) new Notification(`Fiyat emre yaklaştı (${tf})`, { body: near.slice(0, 5).map((s) => `${line(s)} · emir ${fmtPrice(s.zone.legs[0], s.price)}`).join('\n') });
    if (perfect.length) new Notification(`★ Yeni mükemmel setup (${tf})`, { body: perfect.slice(0, 5).map((s) => `${line(s)} · seviye ${fmtPrice(s.zone.confluence, s.price)}`).join('\n') });
    if (other.length) new Notification(`Yeni dalga-3 setup (${tf})`, { body: other.slice(0, 5).map(line).join('\n') });
  } catch { /* bazı tarayıcılarda yalnızca SW ile */ }
}

/** Üçgen modu bildirimi: yeni kırılımlar ve kırılıma yaklaşanlar. */
function notifyTriangles(silent) {
  const vis = visibleSetups();
  const keyed = (st) => new Set(vis.filter((t) => t.state === st).map(setupKey));
  const broken = keyed('broken'), near = keyed('near');
  const prevB = state.seenBroken, prevN = state.seenNear;
  state.seenBroken = broken;
  state.seenNear = near;
  if (!silent || !prevB) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const tf = state.scan.tf.id;
  const line = (t) => `${t.coin} ${t.typeLabel} · ${t.contextLabel} · R:R ${fmtX(t.rr, 1)}`;
  const nb = vis.filter((t) => broken.has(setupKey(t)) && !prevB.has(setupKey(t)));
  const nn = vis.filter((t) => near.has(setupKey(t)) && !prevN?.has(setupKey(t)));
  try {
    if (nb.length) new Notification(`Üçgen kırıldı (${tf})`, { body: nb.slice(0, 5).map(line).join('\n') });
    if (nn.length) new Notification(`Üçgen kırılıma yakın (${tf})`, { body: nn.slice(0, 5).map(line).join('\n') });
  } catch { /* yoksay */ }
}

/** Diagonal modu bildirimi: 2–4 kırılımı (ending), limite yaklaşan / dolan (leading). */
function notifyDiagonals(silent) {
  const vis = visibleSetups();
  const hot = new Set(vis.filter((t) => ['approaching', 'triggered', 'lapproaching', 'filled'].includes(t.state)).map(setupKey));
  const prev = state.seenDiag;
  state.seenDiag = hot;
  if (!silent || !prev) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const fresh = vis.filter((t) => hot.has(setupKey(t)) && !prev.has(setupKey(t)));
  const line = (t) => `${t.coin} ${dirTxt(t)} · ${t.typeLabel} · ${t.stateLabel}`;
  try {
    if (fresh.length) new Notification(`Diagonal (${state.scan.tf.id})`, { body: fresh.slice(0, 5).map(line).join('\n') });
  } catch { /* yoksay */ }
}

/** ABCDE modu bildirimi: limite yaklaşan / dolan ve E'si yeni onaylanan üçgenler. */
function notifyAbcde(silent) {
  const vis = visibleSetups();
  const keyed = (sts) => new Set(vis.filter((t) => t.plans.some((p) => sts.includes(p.state))).map(setupKey));
  const hot = keyed(['approaching', 'filled', 'ready']);
  const prev = state.seenAbcde;
  state.seenAbcde = hot;
  if (!silent || !prev) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const fresh = vis.filter((t) => hot.has(setupKey(t)) && !prev.has(setupKey(t)));
  const line = (t) => `${t.coin} ${dirTxt(t)} · ${t.variantLabel} · ${t.plans.map((p) => p.stateLabel).join(' / ')}`;
  try {
    if (fresh.length) new Notification(`ABCDE üçgen: E bölgesi (${state.scan.tf.id})`, { body: fresh.slice(0, 5).map(line).join('\n') });
  } catch { /* yoksay */ }
}

// ------------------------------------------------------------------ çizim
const useBreak = () => state.settings.entryType !== 'zone';
const useZone = () => state.settings.entryType !== 'break';
const dirTxt = (s) => (s.direction === 'long' ? 'LONG ▲' : 'SHORT ▼');

function visibleSetups() {
  if (isTri()) return state.settings.showAll ? state.setups : pickTriangles(state.setups, toScanOptions(state.settings));
  if (isAbc()) return state.settings.showAll ? state.setups : pickAbcde(state.setups, toScanOptions(state.settings));
  if (isDiag()) return state.settings.showAll ? state.setups : pickDiagonals(state.setups, toScanOptions(state.settings));
  if (!state.settings.showAll) return pickSetups(state.setups, toScanOptions(state.settings));
  return state.settings.onlyPerfect ? state.setups.filter((s) => s.zone?.perfect) : state.setups;
}

function resultOf(s) {
  return state.scan.results.find((x) => x.coin === s.coin);
}

/** Süre koşulu dolmadıysa limit emrin kaç mum sonra aktif olacağı. */
function barsUntilActive(s) {
  const z = s.zone;
  if (!z?.pendingTime || z.activeFrom == null) return 0;
  return Math.max(0, z.activeFrom - (resultOf(s).candles.length - 1));
}

function planSummary(s) {
  const parts = [];
  const act = activePlans(s, toScanOptions(state.settings)).map((p) => p.type);
  if (act.includes('break')) parts.push(`B kırılımı ${s.stateLabel} R:R ${fmtX(s.rr, 1)}`);
  if (act.includes('zone')) parts.push(`Bölge ${s.zone.stateLabel} R:R ${fmtX(s.zone.rr, 1)}`);
  return parts.join(' · ');
}

const REASONS = [
  [/Yapı kırılmadı|0 öncesi/, 'Yapı kırılmadı'],
  [/Ders kitabı/, 'Ders kitabı şekli değil'],
  [/ABC/, 'Dalga 2 ABC değil'],
  [/Süre/, "Dalga 2 dalga 1'den kısa"],
  [/geri çekilme/, 'Geri çekilme bant dışı'],
  [/İtki/, 'İtki kuralı ihlali'],
  [/Dalga 1 küçük/, 'Dalga 1 küçük'],
  [/stop/i, "Bölge stop'un ötesinde"],
];

function renderSummary() {
  const r = state.scan;
  const opts = toScanOptions(state.settings);
  if (isTri()) {
    $('#summary').innerHTML = triSummary(null, {
      results: r.results, setups: state.setups, visible: pickTriangles(state.setups, opts), tf: r.tf, at: r.at, fmtTime, minRR: opts.triMinRR,
    });
    $('#listTitle').textContent = `Üçgenler (${visibleSetups().length})`;
    return;
  }
  if (isAbc()) {
    $('#summary').innerHTML = abcdeSummary({
      results: r.results, setups: state.setups, visible: pickAbcde(state.setups, opts), tf: r.tf, at: r.at, fmtTime, minRR: opts.abcdeMinRR,
    });
    $('#listTitle').textContent = `ABCDE üçgenler (${visibleSetups().length})`;
    return;
  }
  if (isDiag()) {
    $('#summary').innerHTML = diagSummary({
      results: r.results, setups: state.setups, visible: pickDiagonals(state.setups, opts), tf: r.tf, at: r.at, fmtTime, minRR: opts.diagMinRR,
    });
    $('#listTitle').textContent = `Diagonaller (${visibleSetups().length})`;
    return;
  }
  const errors = r.results.filter((x) => x.error);
  const vis = pickSetups(state.setups, opts);
  const nBreak = vis.filter((s) => activePlans(s, opts).some((p) => p.type === 'break')).length;
  const nZone = vis.filter((s) => activePlans(s, opts).some((p) => p.type === 'zone')).length;
  const loose = pickSetups(state.setups, { ...opts, minRR: 0 }).length;
  const counts = new Map();
  for (const d of state.diagnostics) {
    for (const reason of d.reasons) {
      const name = REASONS.find(([re]) => re.test(reason))?.[1] || reason;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  const chips = [...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="chip">${esc(k)}: ${v}</span>`).join('');
  const nPerfect = vis.filter((s) => s.zone?.perfect).length;
  const split = [useBreak() ? `${nBreak} B kırılımı` : '', useZone() ? `${nZone} limit bölge` : '', `★ ${nPerfect} mükemmel`].filter(Boolean).join(', ');
  $('#summary').innerHTML = `
    <p><strong>${r.results.length} coin</strong> · ${esc(r.tf.label)} · ${fmtTime(r.at)} ·
      <strong>${vis.length}</strong> aktif setup (${split})${loose > vis.length ? ` · ${loose - vis.length} tanesi R:R &lt; ${opts.minRR} olduğu için gizli` : ''} ·
      ${state.setups.length - loose} kaçan/bozulan
      ${errors.length ? `<span class="error"> · ${errors.length} coin okunamadı (${esc(errors.slice(0, 4).map((e) => e.coin).join(', '))})</span>` : ''}</p>
    ${chips ? `<div class="chips"><span class="chip muted">Elenen adaylar →</span>${chips}</div>` : ''}`;
  $('#listTitle').textContent = `Setup'lar (${visibleSetups().length})`;
}

// Dar stop: giriş geçersizlik seviyesine çok yakınsa komisyon R'nin büyük kısmını yer.
const TIGHT_PCT = 1.5;
const pctTxt = (x, d) => x.toFixed(d).replace('.', ',');
function stopCell(entry, stop, ref) {
  const pct = riskPct(entry, stop);
  return `${fmtPrice(stop, ref)} <small class="${pct < TIGHT_PCT ? 'warn-txt' : 'muted'}">%${pctTxt(pct, pct < 1 ? 2 : 1)}</small>`;
}
function tightNote(entry, stop) {
  const pct = riskPct(entry, stop);
  if (pct >= TIGHT_PCT) return '';
  const fr = feeR(entry, stop, state.settings.feePct ?? 0.1);
  return `<div class="note">⚠ Stop çok yakın (%${pctTxt(pct, 2)}): komisyon ≈ ${pctTxt(fr, 2)}R</div>`;
}

const lvBox =(label, value, cls = '') => `<div${cls ? ` class="${cls}"` : ''}><b>${esc(label)}</b><span class="num">${value}</span></div>`;

function breakBlock(s, active) {
  if (s.phase !== 'complete') {
    return `<div class="plan muted-plan"><div class="plan-head"><span class="plan-name">B kırılımı</span><span class="muted">C tamamlanınca hesaplanır · tetik B = ${fmtPrice(s.abc.B.price, s.price)}</span></div></div>`;
  }
  const L = s.levels;
  return `<div class="plan${active ? '' : ' faded'}">
    <div class="plan-head"><span class="plan-name">B kırılımı</span><span class="state ${s.state}">${esc(s.stateLabel)}</span><span class="rr">R:R <b class="num">${fmtX(s.rr, 1)}</b></span></div>
    <div class="lv">${lvBox(s.state === 'triggered' ? 'Fiyat' : 'Tetik', fmtPrice(L.entry, s.price))}${lvBox('Stop', stopCell(L.entry, L.stop, s.price))}${lvBox('Hedef 1', fmtPrice(L.targets[0].price, s.price))}${lvBox('Hedef 2', fmtPrice(L.targets[1]?.price, s.price))}</div>
    ${tightNote(L.entry, L.stop)}
  </div>`;
}

function zoneBlock(s, active) {
  const z = s.zone;
  if (!z) return `<div class="plan muted-plan"><div class="plan-head"><span class="plan-name">Limit bölge</span><span class="muted">ABC yok, bölge hesaplanamadı</span></div></div>`;
  const wait = barsUntilActive(s);
  const fill = z.legs.length > 1 && z.filledLegs ? ` (${z.filledLegs}/${z.legs.length})` : '';
  return `<div class="plan${active ? '' : ' faded'}">
    <div class="plan-head"><span class="plan-name">Limit bölge</span><span class="state zone-${z.state}">${esc(z.stateLabel)}${fill}</span>
      <span class="chip str-${z.strength}">${z.perfect ? '★ ' : ''}${esc(z.strength)}${z.inside ? ` · ${z.inside} çakışma` : ''}</span>
      <span class="rr">R:R <b class="num">${fmtX(z.rr, 1)}</b></span></div>
    ${wait ? `<div class="note">Süre koşulu: emir ${wait} mum sonra aktif</div>` : ''}
    <div class="lv">${z.perfect
      ? lvBox('Çakışma seviyesi', `${fmtPrice(z.confluence, s.price)} <small class="muted">fark ${fmtX(z.widthAtr, 2)} ATR</small>`, 'wide')
      : lvBox('Bölge', `${fmtPrice(z.near, s.price)} – ${fmtPrice(z.far, s.price)}`, 'wide')}${lvBox(z.filledLegs ? 'Ort. giriş' : 'Emir', fmtPrice(z.entry, s.price))}${lvBox('Stop', stopCell(z.entry, z.stop, s.price))}${lvBox('Hedef 2', fmtPrice(z.targets[1]?.price, s.price))}</div>
    ${tightNote(z.entry, z.stop)}
  </div>`;
}

/** Yapı kırılmadıysa uyarı chip'i: dalga 1, 0'dan önceki son tepeyi (short: dibi) geçmedi → önceki trend bitmemiş olabilir. */
function originChip(s) {
  if (!s.origin || s.origin.ok) return '';
  const why = s.origin.prev == null ? '0 öncesinde dönüş noktası yok'
    : `Dalga 1, 0'dan önceki son ${s.d === 1 ? 'tepeyi' : 'dibi'} (${fmtPrice(s.origin.prev, s.price)}) geçmedi`;
  return `<span class="chip tb-part" title="${esc(why + ' — önceki trend bitmemiş olabilir')}">⚠ Yapı kırılmadı</span>`;
}

/** Ders kitabı şablon uyumu chip'i: 4/4 vurgulu, eksik şartlar yazılır. */
function tbChip(s) {
  const tb = s.textbook;
  if (!tb) return '';
  const miss = tbMissing(tb);
  return `<span class="chip ${tb.n === 4 ? 'tb-full' : 'tb-part'}" title="Ders kitabı şablonu: net dalga 1, orantılı ABC, ★ çakışma, süre dengesi">📐 ${tb.n === 4 ? 'Ders kitabı 4/4' : `${tb.n}/4 · ${esc(miss.join(', '))}`}</span>`;
}

/** Dalga-3 aşaması: C alt derecede bittiyse (fiyat C'den döndü) kurulum listede kalır, etiketi değişir. */
function phaseLabel(s) {
  if (s.phase !== 'forming') return 'Dalga 2 tamam';
  return s.cDone ? 'C tamam · dalga 3 başlıyor' : 'Dalga 2 sürüyor';
}

function card(s) {
  const act = activePlans(s, toScanOptions(state.settings)).map((p) => p.type);
  const sel = state.selected && setupKey(state.selected) === setupKey(s);
  const phase = phaseLabel(s);
  const time = s.phase === 'forming'
    ? `Süre 2/1 şu an ${fmtX(s.timeRatio, 2)}${s.timeOk ? ' ✓' : ''}`
    : `Süre 2/1 = ${fmtX(s.timeRatio, 2)}`;
  return `
  <button type="button" class="card ${s.direction}${act.length ? '' : ' faded'}" data-key="${esc(setupKey(s))}" aria-current="${sel}">
    <div class="head">
      <span class="coin">${esc(s.coin)}</span>
      <span class="dir ${s.direction}">${dirTxt(s)}</span>
      <span class="chip">${phase}</span>
      ${smtChip(s)}${tbChip(s)}${originChip(s)}${conflictChip(s)}
      <span class="score">Skor <b class="num">${s.score}</b></span>
    </div>
    <div class="meta">
      <span>Dalga 2: ${s.abc ? esc(s.abc.kind) : 'ABC yok'}</span>
      <span>Geri çekilme ${fmtPct(s.retr, 1)}${s.phase === 'forming' ? ' (şu an)' : ''}</span>
      <span>${time}</span>
      <span>derece ${s.sensitivity}×ATR</span>
    </div>
    ${useBreak() ? breakBlock(s, act.includes('break')) : ''}
    ${useZone() ? zoneBlock(s, act.includes('zone')) : ''}
  </button>`;
}

function renderCards() {
  const vis = visibleSetups();
  const box = $('#cards');
  if (!vis.length) {
    box.innerHTML = `<div class="empty muted">Bu zaman diliminde tüm koşulları sağlayan setup yok.<br/>Başka bir zaman dilimi ya da giriş tipi dene veya “Kaçan / bozulanları da göster”i aç.</div>`;
    return;
  }
  if (isTri()) {
    const sel = state.selected && setupKey(state.selected);
    box.innerHTML = vis.map((t) => triCard(t, { selected: setupKey(t) === sel, active: ['forming', 'near', 'broken'].includes(t.state) })).join('');
  } else if (isAbc()) {
    const sel = state.selected && setupKey(state.selected);
    box.innerHTML = vis.map((t) => abcdeCard(t, { selected: setupKey(t) === sel })).join('');
  } else if (isDiag()) {
    const sel = state.selected && setupKey(state.selected);
    box.innerHTML = vis.map((t) => diagCard(t, { selected: setupKey(t) === sel })).join('');
  } else {
    box.innerHTML = vis.map(card).join('');
  }
  for (const el of box.querySelectorAll('.card')) {
    const s = vis.find((x) => setupKey(x) === el.dataset.key);
    el.addEventListener('click', () => select(s));
    addStar(el.querySelector('.head'), s);
  }
}

// ------------------------------------------------------------------ ★ takip listesi
function watchKeyOf(s) {
  const r = resultOf(s);
  return snapshot(s, LONG_KINDS.has(s.kind) ? r.longCandles : r.candles, { tf: state.scan.tf, mode: state.settings.mode }).key;
}

/** Kart başlığına (ya da ayrıntı başlığına) ☆/★ düğmesi; tıklama kartı seçmez. */
function addStar(head, s) {
  if (!head || !s) return;
  const on = !!findByKey(watchKeyOf(s));
  const star = document.createElement('span');
  star.className = `star${on ? ' on' : ''}`;
  star.setAttribute('role', 'button');
  star.setAttribute('tabindex', '0');
  star.setAttribute('aria-label', on ? 'Takipten çıkar' : 'Takibe al');
  star.title = on ? 'Takipten çıkar' : 'Takibe al';
  star.textContent = on ? '★' : '☆';
  const act = (e) => { e.preventDefault(); e.stopPropagation(); toggleStar(s); };
  star.addEventListener('click', act);
  star.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') act(e); });
  head.appendChild(star);
}

function toggleStar(s) {
  const r = resultOf(s);
  const snap = snapshot(s, LONG_KINDS.has(s.kind) ? r.longCandles : r.candles, { tf: state.scan.tf, mode: state.settings.mode });
  const existing = findByKey(snap.key);
  if (existing) removeWatch(existing.id);
  else {
    if (!snap.plans.length) { alert('Bu setup\'ın takip edilecek aktif planı yok.'); return; }
    addWatch(snap);
    refreshWatch({ ids: [snap.id] });
  }
  updateWatchCount();
  renderCards();
  if (state.selected) {
    renderDetail();
    addStar(document.querySelector('#detail .detail-head'), state.selected);
  }
}

function updateWatchCount() {
  const list = loadWatch();
  $('#watchCount').textContent = String(list.length);
}

/** Takip listesindeki coin / zaman dilimi çiftleri için mumları getirir ve durumları hesaplar. */
async function refreshWatch({ notify = false, ids = null } = {}) {
  const list = loadWatch();
  const items = ids ? list.filter((x) => ids.includes(x.id)) : list;
  if (!items.length) { if (state.view === 'watch') renderWatch(); return; }
  $('#watchInfo').textContent = 'güncelleniyor…';
  const pairs = [...new Set(items.map((x) => `${x.instId}|${x.tf}`))];
  await Promise.all(pairs.map(async (pk) => {
    const [instId, tf] = pk.split('|');
    // Bu taramada zaten indirildiyse yeniden indirme
    const r = state.scan?.tf.id === tf ? state.scan.results.find((x) => x.instId === instId && x.longCandles?.length) : null;
    if (r) { state.watchData.set(pk, { candles: r.longCandles, live: r.live }); return; }
    try {
      const { candles, live } = await getCandles(instId, TIMEFRAMES[tf] || TIMEFRAMES['4H'], LONG_BARS);
      state.watchData.set(pk, { candles, live });
    } catch { /* ağ hatası: önceki veri kalır */ }
  }));
  const changes = [];
  for (const it of items) {
    const data = state.watchData.get(`${it.instId}|${it.tf}`);
    if (!data) continue;
    if (it.kind === 'triangle' && !it.shape) backfillShape(it, data);
    const all = data.live ? [...data.candles, data.live] : data.candles;
    const price = all[all.length - 1]?.close;
    const evals = it.plans.map((p) => evaluatePlan(p, all, it.savedAt, { d: it.d, price }));
    state.watchEval.set(it.id, evals);
    const keys = evals.map((e) => e.key);
    if (it.lastStatus && keys.some((k, i) => k !== it.lastStatus[i])) changes.push({ it, evals });
    it.lastStatus = keys;
  }
  // lastStatus'u kalıcı yaz (aynı olay iki kez bildirilmesin)
  const byId = new Map(items.map((x) => [x.id, x]));
  saveAll(loadWatch().map((x) => (byId.has(x.id) ? { ...x, lastStatus: byId.get(x.id).lastStatus } : x)));
  $('#watchInfo').textContent = `güncellendi ${fmtTime(Date.now())}`;
  if (notify && changes.length && 'Notification' in window && Notification.permission === 'granted') {
    const body = changes.slice(0, 6).map(({ it, evals }) => `${it.coin} ${it.tf} ${it.d === 1 ? '▲' : '▼'} · ${evals.map((e) => e.stateLabel + (e.targetsHit ? ` H${e.targetsHit}` : '')).join(' / ')}`).join('\n');
    try { new Notification('★ Takip listesinde değişiklik', { body }); } catch { /* yoksay */ }
  }
  if (state.view === 'watch') renderWatch();
}

/**
 * Çizgi bilgisi olmadan kaydedilmiş eski üçgen kaydı: aynı mumlarda üçgeni yeniden bul, kayıt anahtarı eşleşirse
 * düz kenar / eğik kenar / önceki hareketi bir kez tamamla.
 */
function backfillShape(it, data) {
  const c = data.candles;
  const tAt = (i) => (i < c.length ? c[i].time : c[c.length - 1].time);
  const match = findTriangles(c, toScanOptions(state.settings), data.live)
    .find((t) => `${it.coin}|${it.tf}|tri|${t.type}|${tAt(t.first.i)}` === it.key);
  if (!match) return;
  it.shape = triangleShape(match, tAt);
  updateWatch(it.id, { shape: it.shape });
}

function watchPrice(it) {
  const d = state.watchData.get(`${it.instId}|${it.tf}`);
  if (!d) return null;
  return (d.live || d.candles[d.candles.length - 1])?.close ?? null;
}

function renderWatch() {
  const filter = $('#watchFilter').value;
  const list = loadWatch().filter((it) => {
    if (filter === 'all') return true;
    const evals = state.watchEval.get(it.id);
    const open = !evals || evals.some((e) => isOpen(e.state));
    return filter === 'open' ? open : !open;
  });
  const box = $('#cards');
  if (!list.length) {
    box.innerHTML = `<div class="empty muted">${loadWatch().length ? 'Bu filtrede kayıt yok.' : 'Takip listen boş.<br/>Setup\'lar sekmesinde bir kartın ☆ simgesine basınca buraya eklenir.'}</div>`;
  } else {
    box.innerHTML = list.map((it) => watchCard(it, state.watchEval.get(it.id), { selected: it.id === state.selectedWatch, price: watchPrice(it) })).join('');
    for (const el of box.querySelectorAll('.watch-card')) {
      const open = () => { state.selectedWatch = el.dataset.wid; renderWatch(); };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el) open(); });
    }
    for (const b of box.querySelectorAll('[data-remove]')) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const it = loadWatch().find((x) => x.id === b.dataset.remove);
        if (it) removeItem(it);
      });
    }
  }
  if (!list.some((x) => x.id === state.selectedWatch)) state.selectedWatch = list[0]?.id ?? null;
  $('#watchClearClosed').disabled = !closedItems().length;
  renderWatchDetail();
}

/** Durumu hesaplanmış ve hiçbir planı açık olmayan kayıtlar. */
function closedItems() {
  return loadWatch().filter((it) => {
    const evals = state.watchEval.get(it.id);
    return evals?.length && !evals.some((e) => isOpen(e.state));
  });
}

function removeItem(it) {
  if (!confirm(`${it.coin} ${it.tf} takipten çıkarılsın mı?`)) return;
  removeWatch(it.id);
  state.watchEval.delete(it.id);
  if (state.selectedWatch === it.id) state.selectedWatch = null;
  updateWatchCount();
  renderWatch();
}

function clearClosed() {
  const list = closedItems();
  if (!list.length) return;
  if (!confirm(`${list.length} kapanmış kayıt silinsin mi?\n${list.map((x) => `${x.coin} ${x.tf}`).join(', ')}`)) return;
  const ids = new Set(list.map((x) => x.id));
  saveAll(loadWatch().filter((x) => !ids.has(x.id)));
  for (const id of ids) state.watchEval.delete(id);
  if (ids.has(state.selectedWatch)) state.selectedWatch = null;
  updateWatchCount();
  renderWatch();
}

function renderWatchDetail() {
  const it = loadWatch().find((x) => x.id === state.selectedWatch);
  const box = $('#detail');
  if (!it) {
    destroyChart();
    box.innerHTML = '<div class="empty muted">Takip listesinden bir işlem seçince grafiği ve durumu burada görünür.</div>';
    return;
  }
  const evals = state.watchEval.get(it.id) || [];
  box.innerHTML = watchDetail(it, evals, { price: watchPrice(it) });
  const data = state.watchData.get(`${it.instId}|${it.tf}`);
  const legend = it.kind === 'diagonal'
    ? [['0-1-2-3-4-5', '#f0c75e', ''], ['1–3 / 2–4', '#ef5350', ''], ['Giriş', '#3987e5', ''], ['Stop', '#ef5350', 'dash'], ['Hedefler', '#7cc4a8', 'dash']]
    : it.kind === 'abcde'
    ? [['0-A-B-C-D-E', '#f0c75e', ''], ['A–C / B–D', '#ef5350', ''], ['Giriş', '#3987e5', ''], ['Stop (C ötesi)', '#ef5350', 'dash'], ['Hedefler', '#7cc4a8', 'dash']]
    : it.shape
    ? [...TRI_LEGEND.slice(0, 3), ['Giriş', '#3987e5', ''], ['Stop', '#ef5350', 'dash'], ['Hedefler', '#7cc4a8', 'dash']]
    : [['Dalga yolu', '#f0c75e', ''], ['Giriş', '#3987e5', ''], ['Stop', '#ef5350', 'dash'], ['0 / geçersiz', '#b06cf0', 'dash'], ['Hedefler', '#7cc4a8', 'dash']];
  $('#watchLegend').innerHTML = legend.map(([t, c, cls]) => `<span><i class="${cls}" style="border-top-color:${c}"></i>${esc(t)}</span>`).join('');
  if (data) drawWatch($('#chart'), data.candles, data.live, it, evals);
  else $('#chart').innerHTML = '<p class="muted" style="padding:16px">Grafik verisi yükleniyor…</p>';
  $('#watchSaveNote').addEventListener('click', () => { updateWatch(it.id, { note: $('#watchNote').value.trim() }); renderWatch(); });
  $('#watchRemove').addEventListener('click', () => removeItem(it));
}

function setView(v) {
  state.view = v;
  try { localStorage.setItem('ew-setup-scanner:view', v); } catch { /* yoksay */ }
  document.body.classList.toggle('view-watch', v === 'watch');
  $('#tabSetups').setAttribute('aria-selected', String(v === 'setups'));
  $('#tabWatch').setAttribute('aria-selected', String(v === 'watch'));
  if (v === 'watch') { renderWatch(); refreshWatch(); }
  else if (state.scan) { renderCards(); renderDetail(); }
  else { destroyChart(); $('#cards').innerHTML = ''; $('#detail').innerHTML = '<div class="empty muted">Bir setup seçince grafik ve kural kontrolleri burada görünür.</div>'; }
}

function exportWatchFile() {
  const blob = new Blob([exportWatch()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ew-takip-listesi-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importWatchFile(file) {
  try {
    const n = importWatch(JSON.parse(await file.text()));
    $('#watchInfo').textContent = `${n} işlem içe aktarıldı`;
    updateWatchCount();
    refreshWatch();
  } catch (err) {
    $('#watchInfo').textContent = `içe aktarılamadı: ${err.message}`;
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

const fact = (label, value, extra = '') => `<div><b>${esc(label)}</b><span class="num">${value}</span>${extra}</div>`;

function breakFacts(s) {
  if (s.phase !== 'complete') return '';
  const L = s.levels;
  const risk = Math.abs(L.entry - L.stop) / L.entry;
  return `<h3 class="sec">B kırılımı (onaylı) · <span class="state ${s.state}">${esc(s.stateLabel)}</span></h3>
    <div class="facts">
      ${fact(s.state === 'triggered' ? 'Giriş (güncel fiyat)' : 'Tetik (B kırılımı)', fmtPrice(L.entry, s.price))}
      ${fact('Stop', fmtPrice(L.stop, s.price), ` <small class="muted">risk ${fmtPct(risk)}</small>`)}
      ${L.targets.map((t, i) => fact(`Hedef ${i + 1} (${t.label})`, fmtPrice(t.price, s.price))).join('')}
      ${fact(`R:R (hedef ${state.settings.mainTarget + 1})`, fmtX(s.rr, 2))}
    </div>`;
}

const ENTRY_TXT = { mid: 'kademeli (yarısı yakın, yarısı uzak kenar)', near: 'yakın kenar', far: 'uzak kenar', r618: 'sadece %61,8 seviyesi', c127: 'sadece C = 1,272A seviyesi' };

function zoneFacts(s) {
  const z = s.zone;
  if (!z) return '';
  const risk = Math.abs(z.entry - z.stop) / z.entry;
  const wait = barsUntilActive(s);
  const entryTxt = z.perfect ? 'tek çakışma seviyesi' : ENTRY_TXT[state.settings.zoneEntry];
  const levels = [...z.levels].sort((a, b) => b.price - a.price).map((l) =>
    `<li class="${l.edge ? 'edge' : l.inside ? 'in' : ''}"><span>${esc(l.name)}${l.edge ? ' · kenar' : ''}</span><span class="num">${fmtPrice(l.price, s.price)}</span><span>${l.inside ? '● bölgede' : ''}</span></li>`).join('');
  return `<h3 class="sec">Limit bölge (erken) · <span class="state zone-${z.state}">${esc(z.stateLabel)}</span></h3>
    ${wait ? `<p class="note">Süre koşulu: dalga 2, dalga 1'den uzun sürünce emir aktif olur (${wait} mum sonra).</p>` : ''}
    <div class="facts">
      ${fact('Yakın kenar', fmtPrice(z.near, s.price))}
      ${fact('Uzak kenar', fmtPrice(z.far, s.price))}
      ${fact('İki kenar farkı', `${fmtPrice(Math.abs(z.near - z.far), s.price)} · ${fmtX(z.widthAtr, 2)} ATR${z.perfect ? ' ★' : ''}`)}
      ${fact(z.legs.length > 1 ? 'Emir seviyeleri' : 'Emir seviyesi', z.legs.map((l) => fmtPrice(l, s.price)).join(' / '),
        ` <small class="muted">${z.front > 0 ? `seviyenin ${fmtPrice(z.front, s.price)} önünde` : 'tam seviye'} · yaklaşma uyarısı ${state.settings.approachAtr} ATR</small>`)}
      ${fact('Bölge gücü', `${esc(z.strength)} · ${fmtX(z.widthAtr, 1)} ATR · ${fmtPct(z.widthPct, 2)}`)}
      ${fact('Giriş', fmtPrice(z.entry, s.price), ` <small class="muted">${esc(entryTxt)}${z.filledLegs ? `, ${z.filledLegs}/${z.legs.length} doldu` : ''}</small>`)}
      ${fact(z.stopMode === 'r886' ? 'Stop (dalga 2 = %88,6)' : 'Stop (dalga 1 başı)', fmtPrice(z.stop, s.price), ` <small class="muted">risk ${fmtPct(risk)}</small>`)}
      ${z.targets.map((t, i) => fact(`Hedef ${i + 1} (${t.label})`, fmtPrice(t.price, s.price))).join('')}
      ${fact(`R:R (hedef ${state.settings.mainTarget + 1})`, fmtX(z.rr, 2))}
    </div>
    <ul class="levels">${levels}</ul>`;
}

function renderDetail() {
  const s = state.selected;
  const box = $('#detail');
  if (!s) {
    destroyChart();
    box.innerHTML = '<div class="empty muted">Bir setup seçince grafik ve kural kontrolleri burada görünür.</div>';
    return;
  }
  const r = resultOf(s);
  if (s.kind === 'triangle') {
    box.innerHTML = triDetail(s, { tfId: state.scan.tf.id, feePct: state.settings.feePct });
    $('#triLegend').innerHTML = TRI_LEGEND.map(([t, c, cls]) => `<span><i class="${cls}" style="border-top-color:${c}"></i>${esc(t)}</span>`).join('');
    drawTriangle($('#chart'), r.longCandles, r.live, s);
    return;
  }
  if (s.kind === 'diagonal') {
    box.innerHTML = diagDetail(s, { tfId: state.scan.tf.id, feePct: state.settings.feePct, ruleSet: state.settings.ruleSet });
    $('#diagLegend').innerHTML = DIAG_LEGEND.map(([t, c, cls]) => `<span><i class="${cls}" style="border-top-color:${c}"></i>${esc(t)}</span>`).join('');
    drawDiagonal($('#chart'), r.longCandles, r.live, s);
    return;
  }
  if (s.kind === 'abcde') {
    box.innerHTML = abcdeDetail(s, { tfId: state.scan.tf.id, feePct: state.settings.feePct, eRetr: state.settings.eRetr });
    $('#abcdeLegend').innerHTML = ABCDE_LEGEND.map(([t, c, cls]) => `<span><i class="${cls}" style="border-top-color:${c}"></i>${esc(t)}</span>`).join('');
    drawAbcde($('#chart'), r.longCandles, r.live, s);
    return;
  }
  const rsi = [];
  if (s.rsi.divergence) rsi.push(`C/A uyumsuzluk ${s.rsi.divergence.ok ? 'var ✓' : 'yok'} (${s.rsi.divergence.rA.toFixed(0)} → ${s.rsi.divergence.rC.toFixed(0)})`);
  if (s.rsi.w1Momentum) rsi.push(`dalga 1 RSI ${s.rsi.w1Momentum.r1.toFixed(0)} ${s.rsi.w1Momentum.ok ? '✓' : ''}`);
  const tv = `https://www.tradingview.com/chart/?symbol=OKX%3A${encodeURIComponent(s.coin)}USDT`;
  box.innerHTML = `
    <div class="detail-head">
      <h2>${esc(s.coin)}/USDT</h2>
      <span class="dir ${s.direction}">${dirTxt(s)}</span>
      <span class="chip">${phaseLabel(s)}</span>
      <span class="chip">${esc(state.scan.tf.id)} · derece ${s.sensitivity}×ATR</span>
      ${smtChip(s)}${tbChip(s)}${originChip(s)}${conflictChip(s)}
      <a class="ext" href="${tv}" target="_blank" rel="noopener">TradingView'de aç ↗</a>
    </div>
    <div class="chart" id="chart"></div>
    <div class="legend">${LEGEND.filter(([, , , t]) => !t || (t === 'break' ? useBreak() : useZone())).map(([t, c, cls]) => `<span><i class="${cls}" style="border-top-color:${c}"></i>${esc(t)}</span>`).join('')}</div>
    <div class="facts">
      ${fact('Güncel fiyat', fmtPrice(s.price))}
      ${fact('Geçersizlik (0)', fmtPrice(s.points.p0.price, s.price))}
      ${fact(s.phase === 'forming' ? 'Dalga 2 geri çekilme (şu an)' : 'Dalga 2 geri çekilme', fmtPct(s.retr))}
      ${s.w1q ? fact('Dalga 1: verim · hız', `${fmtX(s.w1q.er, 2).replace('×', '')} · ${fmtX(s.w1q.speed, 2).replace('×', '')} ATR/mum${s.textbook?.checks.w1 ? ' ✓ net itki' : ' – testere / yavaş'}`) : ''}
      ${s.origin ? fact('Yapı kırılımı', s.origin.prev == null ? '0 öncesinde dönüş noktası yok'
    : `${s.origin.ok ? '✓ kırıldı' : '– kırılmadı'} · 0 öncesi son ${s.d === 1 ? 'tepe' : 'dip'} ${fmtPrice(s.origin.prev, s.price)} (${fmtX(s.origin.prior, 2)} dalga 1)`) : ''}
      ${s.textbook ? fact('Ders kitabı şablonu', `${s.textbook.n}/4${s.textbook.ratios ? ` · a %${Math.round(s.textbook.ratios.a * 100)} · b %${Math.round(s.textbook.ratios.b * 100)} · c ${fmtX(s.textbook.ratios.c, 2)}${s.textbook.ratios.aEr != null ? ` · A verim ${fmtX(s.textbook.ratios.aEr, 2).replace('×', '')}` : ''}` : ''}${tbMissing(s.textbook).length ? ' – eksik: ' + tbMissing(s.textbook).join(', ') : ' ✓'}`) : ''}
      ${fact('Süre: dalga 1 / dalga 2', `${s.durations.D1} / ${s.durations.D2} mum (${fmtX(s.timeRatio)})${s.phase === 'forming' ? (s.timeOk ? ' ✓' : ' – henüz sağlanmadı') : ''}`)}
      ${fact('Dalga 2 yapısı', s.abc ? esc(s.abc.label) + (s.phase === 'forming' ? (s.cDone ? ' (C tamam, dönüş başladı)' : ' (C oluşuyor)') : '') : 'ABC bulunamadı')}
      ${s.phase === 'complete' ? fact('RSI', esc(rsi.join(' · ') || '–')) : ''}
      ${s.volume ? fact('Hacim W1 / W2', s.volume.ok ? 'W1 > W2 ✓' : 'W1 ≤ W2') : ''}
      ${fact('Skor', `${s.score}/100`)}
    </div>
    ${useBreak() ? breakFacts(s) : ''}
    ${useZone() ? zoneFacts(s) : ''}
    <div class="rules">
      ${ruleList(`İtki başlangıcı 0-1-2 (${state.settings.ruleSet})${s.phase === 'forming' ? ' — 2 = şimdiye kadarki uç' : ''}`, s.impulse.results)}
      ${s.abc ? ruleList(`Dalga 2 iç yapısı: ${s.abc.label}${s.phase === 'forming' ? (s.cDone ? ' (0-A-B, C tamam)' : ' (0-A-B, C oluşuyor)') : ''}`, s.abc.results) : ''}
    </div>`;
  drawSetup($('#chart'), r.candles, r.live, s, { showBreak: useBreak(), showZone: useZone() });
}

function select(s) {
  state.selected = s || null;
  renderCards();
  renderDetail();
  addStar(document.querySelector('#detail .detail-head'), state.selected);
  if (s && window.matchMedia('(max-width: 900px)').matches) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function render() {
  document.querySelector('.layout').classList.remove('stale');
  renderSummary();
  if (SHORT_TF.has(state.scan.tf.id)) {
    $('#summary').insertAdjacentHTML('afterbegin', `<p class="note">⚠ ${esc(state.scan.tf.id)}: 600 mum yalnızca ${state.scan.tf.id === '1m' ? '10 saat' : '2 gün'}; dalga sayımı gürültülü.
      Stop dar olduğu için komisyon R'nin büyük kısmını yer (kartlardaki komisyon uyarısına bak).</p>`);
  }
  const vis = visibleSetups();
  const keep = state.selected && vis.find((s) => setupKey(s) === setupKey(state.selected));
  state.selected = keep || vis[0] || null;
  if (state.view === 'watch') return renderWatch();
  renderCards();
  renderDetail();
  addStar(document.querySelector('#detail .detail-head'), state.selected);
}

// ------------------------------------------------------------------ başlat
function init() {
  syncToolbar();
  renderSettings($('#settings'), state.settings, updateSettings);
  for (const b of document.querySelectorAll('#tf button')) b.addEventListener('click', () => updateSettings({ timeframe: b.dataset.tf }));
  $('#ruleSet').addEventListener('change', (e) => updateSettings({ ruleSet: e.target.value }));
  $('#entryType').addEventListener('change', (e) => updateSettings({ entryType: e.target.value }));
  $('#mode').addEventListener('change', (e) => { state.selected = null; updateSettings({ mode: e.target.value }); });
  $('#onlyPerfect').addEventListener('change', (e) => updateSettings({ onlyPerfect: e.target.checked }));
  $('#showAll').addEventListener('change', (e) => { state.settings.showAll = e.target.checked; saveSettings(state.settings); if (state.scan) render(); });
  $('#scanBtn').addEventListener('click', () => scan());
  $('#settingsBtn').addEventListener('click', () => {
    const el = $('#settings');
    el.hidden = !el.hidden;
    $('#settingsBtn').setAttribute('aria-expanded', String(!el.hidden));
  });
  // Takip listesi sekmesi
  $('#tabSetups').addEventListener('click', () => setView('setups'));
  $('#tabWatch').addEventListener('click', () => setView('watch'));
  $('#watchFilter').addEventListener('change', renderWatch);
  $('#watchRefresh').addEventListener('click', () => refreshWatch());
  $('#watchExport').addEventListener('click', exportWatchFile);
  $('#watchClearClosed').addEventListener('click', clearClosed);
  $('#watchImport').addEventListener('change', (e) => { if (e.target.files[0]) importWatchFile(e.target.files[0]); e.target.value = ''; });
  updateWatchCount();
  let v = 'setups';
  try { v = localStorage.getItem('ew-setup-scanner:view') === 'watch' ? 'watch' : 'setups'; } catch { /* yoksay */ }
  setView(v);
  setupAutoRefresh();
  scan();
}

init();

