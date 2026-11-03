// Diagonal modu: kart, özet ve ayrıntı HTML'i (app.js çağırır; grafik chart.js drawDiagonal).
import { fmtPrice, fmtPct, fmtX, esc, smtChip, conflictChip } from './format.js';
import { riskPct, feeR } from '../scan/wave3.js';
import { DIAG_PLAN, isOpenDiag } from '../scan/diagonal.js';

// Anahtar yapının değişmeyen noktalarından (0-1-2): oluşan 4 / 5 ilerledikçe değişmez.
export const diagKey = (t) => `${t.coin}|diag|${t.type}|${t.direction}|${t.points.p0.price}|${t.points.p1.price}|${t.points.p2.price}`;
const dirTxt = (t) => (t.d === 1 ? 'LONG ▲' : 'SHORT ▼');
const lv = (label, value) => `<div><b>${esc(label)}</b><span class="num">${value}</span></div>`;
const KIND_ICON = { w4: '④', ending: '⤺', leading: '➚' };

/** Planın ne yaptığı (kartta ve ayrıntıda): kullanıcı türleri karıştırmasın. */
export const HOW = {
  w4: "Diagonal'in 4. dalgasında giriş, 5. dalgayı hedefler. Dalga 4 dalga 1 bölgesine iner; giriş iki Fibonacci çakışmasında kademeli: daralanda 0→3 %38,2 ≈ 2→3 %50 ve 0→3 %50 ≈ 2→3 %61,8 (genişleyende bir kademe derin). Hedef 1 3'ün ucu, ana hedef −0,236 uzantıları (5, 3'ü geçmeli; daralanda 3'ten kısa). Stop, 4'ün geçersizlik seviyesinin ötesinde (daralanda 4 dalga 2'den kısa olmalı, genişleyende 2'nin ucunu geçemez). Alt dalgalar 3-3-3-3-3 ya da 5-3-5-3-5 olmalı.",
  ending: "Ending diagonal 5. / C dalgasıdır: 5 bittikten sonra sert dönüş beklenir. Kapanış 2–4 çizgisini kırınca diagonal'in TERSİNE giriş, stop 5'in ötesinde, hedefler 4 → 2 → 0.",
  leading: "Leading diagonal 1. / A dalgasıdır: bittikten sonra derin dalga 2, ardından trend yönünde dalga 3 beklenir. Limit 0→5'in %61,8 geri alımında, stop diagonal'in başının (0) ötesinde.",
};

function stopTxt(entry, stop, ref) {
  const pct = riskPct(entry, stop);
  return `${fmtPrice(stop, ref)} <small class="${pct < 1.5 ? 'warn-txt' : 'muted'}">%${pct.toFixed(pct < 1 ? 2 : 1).replace('.', ',')}</small>`;
}

function entryLabel(p) {
  if (p.type === 'dlead' || p.type === 'd4lim') return p.fillIdx >= 0 ? 'Doldu' : 'Limit';
  if (p.type === 'd4conf') return 'Giriş';
  return p.fillIdx >= 0 ? 'Giriş' : 'Tetik (2–4)';
}

function planBlock(t, p) {
  return `<div class="plan${isOpenDiag(p.state) ? '' : ' faded'}">
      <div class="plan-head"><span class="plan-name">${esc(DIAG_PLAN[p.type])}</span><span class="state dg-${p.state}">${esc(p.stateLabel)}</span><span class="rr">R:R <b class="num">${fmtX(p.rr, 1)}</b></span></div>
      <div class="lv">${lv(entryLabel(p), p.legs?.length > 1 && p.filledLegs < p.legs.length ? p.legs.map((x) => fmtPrice(x, t.price)).join(' / ') : fmtPrice(p.entry, t.price))}${lv('Stop', stopTxt(p.entry, p.stop, t.price))}${lv('Hedef 1', fmtPrice(p.targets[0].price, t.price))}${lv('Ana hedef', fmtPrice(p.main.price, t.price))}</div>
    </div>`;
}

const progress = (t) => (t.type === 'w4' ? (t.forming ? '4 oluşuyor' : '4 bitti · 5 sürüyor') : t.forming ? '5 oluşuyor' : '5 bitti');

/** Dalga 4 kitabi göstergeleri: alt dalga kalıbı ve Fibonacci çakışması. */
function bookChips(t) {
  if (t.type !== 'w4' || !t.sub) return '';
  const sub = t.sub.pattern
    ? `<span class="chip tb-full" title="Alt dalgalar ${esc(t.sub.pattern)} (ending tipi 3-3-3-3-3, leading tipi 5-3-5-3-5)">🧩 ${esc(t.sub.pattern)}</span>`
    : '<span class="chip tb-part" title="Bacakların hepsi 3\'lü ya da 1-3 5\'li / 2-4 3\'lü sayılamadı">🧩 alt yapı belirsiz</span>';
  const fib = t.fib?.tight
    ? `<span class="chip tb-full" title="Dalga 4 seviyeleri: 0→3 ve 2→3 Fibonacci'leri ${t.fib.tight}/2 çakışmada 0,5 ATR'den yakın">Fib çakışması ${t.fib.tight}/2</span>`
    : '';
  return sub + fib;
}

export function diagCard(t, { selected }) {
  const open = t.plans.some((p) => isOpenDiag(p.state));
  return `
  <button type="button" class="card ${t.direction}${open ? '' : ' faded'}" data-key="${esc(diagKey(t))}" aria-current="${selected}">
    <div class="head">
      <span class="coin">${esc(t.coin)}</span>
      <span class="dir ${t.direction}">${dirTxt(t)}</span>
      <span class="chip">${KIND_ICON[t.type]} ${esc(t.typeLabel)} · ${esc(t.shapeLabel)}</span>
      ${bookChips(t)}${smtChip(t)}${conflictChip(t)}
      <span class="score">Skor <b class="num">${t.score}</b></span>
    </div>
    <div class="meta">
      <span>${t.dd === 1 ? 'yükselen' : 'alçalan'} kama · ${progress(t)}</span>
      <span>${t.eval.warns ? `${t.eval.warns} uyarı` : 'kurallar ✓'}</span>
      <span>derece ${t.sensitivity}×ATR</span>
    </div>
    ${t.plans.map((p) => planBlock(t, p)).join('')}
  </button>`;
}

export function diagSummary({ results, setups, visible, tf, at, fmtTime, minRR }) {
  const errors = results.filter((x) => x.error);
  const n = (type) => visible.filter((t) => t.type === type).length;
  const open = setups.filter((t) => isOpenDiag(t.state)).length;
  return `<p><strong>${results.length} coin</strong> · ${esc(tf.label)} · ${fmtTime(at)} ·
    <strong>${visible.length}</strong> diagonal setup (${n('w4')} dalga 4 → 5, ${n('ending')} ending dönüşü, ${n('leading')} leading)
    ${open > visible.length ? ` · ${open - visible.length} tanesi R:R &lt; ${minRR} olduğu için gizli` : ''} ·
    ${setups.length - open} kapanmış / eski
    ${errors.length ? `<span class="error"> · ${errors.length} coin okunamadı</span>` : ''}</p>`;
}

const fact = (label, value, extra = '') => `<div><b>${esc(label)}</b><span class="num">${value}</span>${extra}</div>`;
const ICON = { pass: '✓', warn: '⚠', fail: '✗', info: 'i', na: '–' };

export function diagDetail(t, { tfId, feePct, ruleSet }) {
  const P = t.points;
  const p = t.plans.find((x) => isOpenDiag(x.state)) ?? t.plans[0];
  const tv = `https://www.tradingview.com/chart/?symbol=OKX%3A${encodeURIComponent(t.coin)}USDT`;
  const names = t.type === 'w4'
    ? [['0', P.p0], ['1', P.p1], ['2', P.p2], ['3', P.p3], [t.forming ? '4 (oluşuyor)' : '4', P.p4]]
    : [['0', P.p0], ['1', P.p1], ['2', P.p2], ['3', P.p3], ['4', P.p4], [t.forming ? '5 (oluşuyor)' : '5', P.p5]];
  const waves = names.map(([n, q]) => `<li><span>${n}</span><span class="num">${fmtPrice(q.price, t.price)}</span><span></span></li>`).join('');
  const targets = p.targets.map((x) => `<li class="${x.key === p.main.key ? 'edge' : ''}"><span>${esc(x.name)}${x.key === p.main.key ? ' · ana hedef' : ''}</span><span class="num">${fmtPrice(x.price, t.price)}</span><span>${fmtPct(Math.abs(x.price - p.entry) / p.entry, 1)}</span></li>`).join('');
  const plans = t.plans.map((q) => {
    const fr = feeR(q.entry, q.stop, feePct ?? 0.1);
    return `<h3 class="sec">${esc(DIAG_PLAN[q.type])} · <span class="state dg-${q.state}">${esc(q.stateLabel)}</span></h3>
      <div class="facts">
        ${fact(entryLabel(q), fmtPrice(q.entry, t.price), q.type === 'dend' && q.fillIdx < 0 ? ' <small class="muted">2–4 çizgisi zamanla kayar; tetik her taramada güncellenir</small>' : '')}
        ${fact('Stop', fmtPrice(q.stop, t.price), ` <small class="${riskPct(q.entry, q.stop) < 1.5 ? 'warn-txt' : 'muted'}">risk %${riskPct(q.entry, q.stop).toFixed(2).replace('.', ',')} · komisyon ≈ ${fr.toFixed(2).replace('.', ',')}R</small>`)}
        ${fact(`R:R (${q.main.name})`, fmtX(q.rr, 2))}
      </div>`;
  }).join('');
  const z = t.zone;
  const pc = (r) => `%${String(+(r * 100).toFixed(1)).replace('.', ',')}`;
  const fibTxt = (x) => `0→3 ${pc(x.ra)} ${fmtPrice(x.a, t.price)} ≈ 2→3 ${pc(x.rb)} ${fmtPrice(x.b, t.price)}${x.tight ? ' ✓' : ''}`;
  const zoneFacts = z ? `
      ${z.fib && t.fib
    ? fact('Dalga 4 bölgesi (kademeli)', `${fmtPrice(z.near, t.price)} / ${fmtPrice(z.far, t.price)}`, ` <small class="muted">üst: ${fibTxt(t.fib.pairs[0])} · alt: ${fibTxt(t.fib.pairs[1])}</small>`)
    : fact('Dalga 4 bölgesi', `${fmtPrice(z.near, t.price)} – ${fmtPrice(z.far, t.price)}`, ` <small class="muted">0→3'ün %${String(z.r1 * 100).replace('.', ',')}–${String(z.r2 * 100).replace('.', ',')}'i, dalga 1 bölgesine kırpılmış</small>`)}
      ${t.sub ? fact('Alt dalgalar', t.sub.pattern || 'belirsiz', ` <small class="muted">${t.sub.legs.map((l, j) => `${j + 1}: ${l.n ? `${l.n}'lü` : '?'}`).join(' · ')}</small>`) : ''}
      ${fact('4 geçersizlik', fmtPrice(z.invalid, t.price), ` <small class="muted">${t.shape === 'contracting' ? "daralan: 4, dalga 2'den kısa olmalı" : "genişleyen: 4, 2'nin ucunu geçemez"}</small>`)}` : '';
  const rules = t.eval.results.filter((r) => r.status !== 'na').map((r) => `<li class="${r.status}"><span class="ic">${ICON[r.status] || '·'}</span>
      <div><div class="nm">${esc(r.rule.name)}</div>${r.detail ? `<div class="dt">${esc(r.detail)}</div>` : ''}<div class="src">${esc(r.rule.source || '')}</div></div></li>`).join('');
  return `
    <div class="detail-head">
      <h2>${esc(t.coin)}/USDT</h2>
      <span class="dir ${t.direction}">${dirTxt(t)}</span>
      <span class="chip">${KIND_ICON[t.type]} ${esc(t.typeLabel)} · ${esc(t.shapeLabel)}</span>
      <span class="state dg-${p.state}">${esc(p.stateLabel)}</span>
      <span class="chip">${esc(tfId)} · derece ${t.sensitivity}×ATR</span>
      ${bookChips(t)}${smtChip(t)}${conflictChip(t)}
      <a class="ext" href="${tv}" target="_blank" rel="noopener">TradingView'de aç ↗</a>
    </div>
    <div class="chart" id="chart"></div>
    <div class="legend" id="diagLegend"></div>
    <p class="note">${esc(HOW[t.type])}</p>
    <div class="facts">
      ${fact('Güncel fiyat', fmtPrice(t.price))}
      ${zoneFacts}
      ${fact(t.type === 'w4' ? 'Diagonal boyu (0→3)' : 'Diagonal boyu (0→5)', fmtPrice(t.size, t.price), ` <small class="muted">${fmtX(t.size / t.levels.atr, 1)} ATR</small>`)}
      ${fact('Skor', `${t.score}/100`)}
    </div>
    ${plans}
    <h3 class="sec">Dalgalar</h3>
    <ul class="levels">${waves}</ul>
    <h3 class="sec">Hedefler</h3>
    <ul class="levels">${targets}</ul>
    <div class="rules"><h3>${esc(t.eval.label)} · kural seti: ${esc(ruleSet)}</h3><ul>${rules}</ul></div>`;
}
