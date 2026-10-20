// Diagonal modu: kart, özet ve ayrıntı HTML'i (app.js çağırır; grafik chart.js drawDiagonal).
import { fmtPrice, fmtPct, fmtX, esc } from './format.js';
import { riskPct, feeR } from '../scan/wave3.js';
import { DIAG_PLAN, isOpenDiag } from '../scan/diagonal.js';

export const diagKey = (t) => `${t.coin}|diag|${t.type}|${t.direction}|${t.points.p0.price}|${t.points.p2.price}|${t.points.p4.price}`;
const dirTxt = (t) => (t.d === 1 ? 'LONG ▲' : 'SHORT ▼');
const lv = (label, value) => `<div><b>${esc(label)}</b><span class="num">${value}</span></div>`;
const KIND_ICON = { ending: '⤺', leading: '➚' };

function stopTxt(entry, stop, ref) {
  const pct = riskPct(entry, stop);
  return `${fmtPrice(stop, ref)} <small class="${pct < 1.5 ? 'warn-txt' : 'muted'}">%${pct.toFixed(pct < 1 ? 2 : 1).replace('.', ',')}</small>`;
}

function entryLabel(p) {
  if (p.type === 'dlead') return p.fillIdx >= 0 ? 'Doldu' : 'Limit';
  return p.fillIdx >= 0 ? 'Giriş' : 'Tetik (2–4)';
}

export function diagCard(t, { selected }) {
  const p = t.plans[0];
  return `
  <button type="button" class="card ${t.direction}${isOpenDiag(p.state) ? '' : ' faded'}" data-key="${esc(diagKey(t))}" aria-current="${selected}">
    <div class="head">
      <span class="coin">${esc(t.coin)}</span>
      <span class="dir ${t.direction}">${dirTxt(t)}</span>
      <span class="chip">${KIND_ICON[t.type]} ${esc(t.typeLabel)} · ${esc(t.shapeLabel)}</span>
      <span class="score">Skor <b class="num">${t.score}</b></span>
    </div>
    <div class="meta">
      <span>${t.dd === 1 ? 'yükselen' : 'alçalan'} kama${t.forming ? ' · 5 oluşuyor' : ''}</span>
      <span>${t.eval.warns ? `${t.eval.warns} uyarı` : 'kurallar ✓'}</span>
      <span>derece ${t.sensitivity}×ATR</span>
    </div>
    <div class="plan">
      <div class="plan-head"><span class="plan-name">${esc(DIAG_PLAN[p.type])}</span><span class="state dg-${p.state}">${esc(p.stateLabel)}</span><span class="rr">R:R <b class="num">${fmtX(p.rr, 1)}</b></span></div>
      <div class="lv">${lv(entryLabel(p), fmtPrice(p.entry, t.price))}${lv('Stop', stopTxt(p.entry, p.stop, t.price))}${lv('Hedef 1', fmtPrice(p.targets[0].price, t.price))}${lv('Ana hedef', fmtPrice(p.main.price, t.price))}</div>
    </div>
  </button>`;
}

export function diagSummary({ results, setups, visible, tf, at, fmtTime, minRR }) {
  const errors = results.filter((x) => x.error);
  const n = (type) => visible.filter((t) => t.type === type).length;
  const open = setups.filter((t) => isOpenDiag(t.state)).length;
  return `<p><strong>${results.length} coin</strong> · ${esc(tf.label)} · ${fmtTime(at)} ·
    <strong>${visible.length}</strong> diagonal setup (${n('ending')} ending, ${n('leading')} leading)
    ${open > visible.length ? ` · ${open - visible.length} tanesi R:R &lt; ${minRR} olduğu için gizli` : ''} ·
    ${setups.length - open} kapanmış / eski
    ${errors.length ? `<span class="error"> · ${errors.length} coin okunamadı</span>` : ''}</p>`;
}

const fact = (label, value, extra = '') => `<div><b>${esc(label)}</b><span class="num">${value}</span>${extra}</div>`;
const ICON = { pass: '✓', warn: '⚠', fail: '✗', info: 'i', na: '–' };

export function diagDetail(t, { tfId, feePct, ruleSet }) {
  const P = t.points;
  const p = t.plans[0];
  const tv = `https://www.tradingview.com/chart/?symbol=OKX%3A${encodeURIComponent(t.coin)}USDT`;
  const fr = feeR(p.entry, p.stop, feePct ?? 0.1);
  const how = p.type === 'dlead'
    ? "Leading diagonal 1. / A dalgasıdır: ardından derin dalga 2 beklenir. Limit 0→5'in %61,8 geri alımında, stop diagonal'in başının (0) ötesinde."
    : "Ending diagonal 5. / C dalgasıdır: bitince sert dönüş beklenir. Kapanış 2–4 çizgisini kırınca ters yöne giriş, stop 5'in ötesinde.";
  const waves = [['0', P.p0], ['1', P.p1], ['2', P.p2], ['3', P.p3], ['4', P.p4], [t.forming ? '5 (oluşuyor)' : '5', P.p5]]
    .map(([n, q]) => `<li><span>${n}</span><span class="num">${fmtPrice(q.price, t.price)}</span><span></span></li>`).join('');
  const targets = p.targets.map((x) => `<li class="${x.key === p.main.key ? 'edge' : ''}"><span>${esc(x.name)}${x.key === p.main.key ? ' · ana hedef' : ''}</span><span class="num">${fmtPrice(x.price, t.price)}</span><span>${fmtPct(Math.abs(x.price - p.entry) / p.entry, 1)}</span></li>`).join('');
  const rules = t.eval.results.filter((r) => r.status !== 'na').map((r) => `<li class="${r.status}"><span class="ic">${ICON[r.status] || '·'}</span>
      <div><div class="nm">${esc(r.rule.name)}</div>${r.detail ? `<div class="dt">${esc(r.detail)}</div>` : ''}<div class="src">${esc(r.rule.source || '')}</div></div></li>`).join('');
  return `
    <div class="detail-head">
      <h2>${esc(t.coin)}/USDT</h2>
      <span class="dir ${t.direction}">${dirTxt(t)}</span>
      <span class="chip">${KIND_ICON[t.type]} ${esc(t.typeLabel)} · ${esc(t.shapeLabel)}</span>
      <span class="state dg-${p.state}">${esc(p.stateLabel)}</span>
      <span class="chip">${esc(tfId)} · derece ${t.sensitivity}×ATR</span>
      <a class="ext" href="${tv}" target="_blank" rel="noopener">TradingView'de aç ↗</a>
    </div>
    <div class="chart" id="chart"></div>
    <div class="legend" id="diagLegend"></div>
    <p class="note">${esc(how)}</p>
    <div class="facts">
      ${fact('Güncel fiyat', fmtPrice(t.price))}
      ${fact(entryLabel(p), fmtPrice(p.entry, t.price), p.type === 'dend' && p.fillIdx < 0 ? ' <small class="muted">2–4 çizgisi zamanla kayar; tetik her taramada güncellenir</small>' : '')}
      ${fact('Stop', fmtPrice(p.stop, t.price), ` <small class="${riskPct(p.entry, p.stop) < 1.5 ? 'warn-txt' : 'muted'}">risk %${riskPct(p.entry, p.stop).toFixed(2).replace('.', ',')} · komisyon ≈ ${fr.toFixed(2).replace('.', ',')}R</small>`)}
      ${fact(`R:R (${esc(p.main.name)})`, fmtX(p.rr, 2))}
      ${fact('Diagonal boyu (0→5)', fmtPrice(t.size, t.price), ` <small class="muted">${fmtX(t.size / t.levels.atr, 1)} ATR</small>`)}
      ${fact('Skor', `${t.score}/100`)}
    </div>
    <h3 class="sec">Dalgalar</h3>
    <ul class="levels">${waves}</ul>
    <h3 class="sec">Hedefler</h3>
    <ul class="levels">${targets}</ul>
    <div class="rules"><h3>${esc(t.eval.label)} · kural seti: ${esc(ruleSet)}</h3><ul>${rules}</ul></div>`;
}
