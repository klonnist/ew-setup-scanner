// Running / daralan ABCDE üçgeni modu: kart, özet ve ayrıntı HTML'i (app.js çağırır; grafik chart.js drawAbcde).
import { fmtPrice, fmtPct, fmtX, esc, smtChip } from './format.js';
import { riskPct, feeR } from '../scan/wave3.js';
import { PLAN_NAME_ABCDE, isOpenPlan } from '../scan/abcde.js';

export const abcdeKey = (t) => `${t.coin}|abcde|${t.direction}|${t.points.p0.price}|${t.points.A.price}|${t.points.C.price}`;
const dirTxt = (t) => (t.d === 1 ? 'LONG ▲' : 'SHORT ▼');
const lv = (label, value) => `<div><b>${esc(label)}</b><span class="num">${value}</span></div>`;
const r2 = (x) => x.toFixed(2).replace('.', ',');

function stopTxt(entry, stop, ref) {
  const pct = riskPct(entry, stop);
  return `${fmtPrice(stop, ref)} <small class="${pct < 1.5 ? 'warn-txt' : 'muted'}">%${pct.toFixed(pct < 1 ? 2 : 1).replace('.', ',')}</small>`;
}

function planBlock(t, p) {
  const open = isOpenPlan(p.state);
  const entryLbl = p.type === 'elimit' ? (p.fillIdx >= 0 ? 'Doldu' : 'Limit') : 'Giriş';
  return `<div class="plan${open ? '' : ' faded'}">
    <div class="plan-head"><span class="plan-name">${esc(PLAN_NAME_ABCDE[p.type])}</span><span class="state ab-${p.state}">${esc(p.stateLabel)}</span><span class="rr">R:R <b class="num">${fmtX(p.rr, 1)}</b></span></div>
    <div class="lv">${lv(entryLbl, fmtPrice(p.entry, t.price))}${lv('Stop (C)', stopTxt(p.entry, p.stop, t.price))}${lv('Hedef 1', fmtPrice(t.levels.targets[0].price, t.price))}${lv('Ana hedef', fmtPrice(p.main.price, t.price))}</div>
  </div>`;
}

export function abcdeCard(t, { selected }) {
  const open = t.plans.some((p) => isOpenPlan(p.state));
  const ratios = t.ratios.map((x) => `${x.name} ${r2(x.r)}${x.forming ? '…' : ''}`).join(' · ');
  return `
  <button type="button" class="card ${t.direction}${open ? '' : ' faded'}" data-key="${esc(abcdeKey(t))}" aria-current="${selected}">
    <div class="head">
      <span class="coin">${esc(t.coin)}</span>
      <span class="dir ${t.direction}">${dirTxt(t)}</span>
      <span class="chip">${esc(t.variantLabel)}</span>
      <span class="chip">${esc(t.stateLabel)}</span>
      ${smtChip(t)}
      <span class="score">Skor <b class="num">${t.score}</b></span>
    </div>
    <div class="meta">
      <span>${ratios}</span>
      <span>${t.w3Impulse?.ok ? 'önceki hareket itki ✓' : 'önceki hareket itki ✗'}</span>
      <span>${t.innerOk ? 'iç ABC ✓' : `iç yapı bulunamadı: ${esc(t.missing.join(', '))}`}</span>
      <span>derece ${t.sensitivity}×ATR</span>
    </div>
    ${t.plans.map((p) => planBlock(t, p)).join('')}
  </button>`;
}

export function abcdeSummary({ results, setups, visible, tf, at, fmtTime, minRR }) {
  const errors = results.filter((x) => x.error);
  const has = (st) => visible.filter((t) => t.plans.some((p) => p.state === st)).length;
  const hidden = setups.filter((t) => t.plans.some((p) => isOpenPlan(p.state))).length - visible.length;
  return `<p><strong>${results.length} coin</strong> · ${esc(tf.label)} · ${fmtTime(at)} ·
    <strong>${visible.length}</strong> ABCDE üçgen (${has('filled')} limit doldu, ${has('approaching')} limite yaklaştı, ${has('waiting')} limit bekliyor, ${has('ready')} E onaylandı)
    ${hidden > 0 ? ` · ${hidden} tanesi R:R &lt; ${minRR} olduğu için gizli` : ''} ·
    ${setups.length - visible.length - Math.max(0, hidden)} kapanmış / eski
    ${errors.length ? `<span class="error"> · ${errors.length} coin okunamadı</span>` : ''}</p>`;
}

const fact = (label, value, extra = '') => `<div><b>${esc(label)}</b><span class="num">${value}</span>${extra}</div>`;
const ok = (b) => (b ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>');

export function abcdeDetail(t, { tfId, feePct, eRetr }) {
  const P = t.points;
  const tv = `https://www.tradingview.com/chart/?symbol=OKX%3A${encodeURIComponent(t.coin)}USDT`;
  const pct = (a, b) => fmtPct(Math.abs(a - b) / b, 1);
  const legs = t.legs.map((l, n) => {
    const r = n ? t.ratios[n - 1] : null;
    const near = r && Math.abs(r.r - 0.618) <= 0.15;
    const inner = l.abc ? `${esc(l.abc.kind)} (alt derece ÷${l.abc.div})` : t.forming && n === 4 ? 'oluşuyor' : 'bulunamadı';
    return `<tr><td>${l.name}</td><td class="num">${fmtPrice(l.from.price, t.price)} → ${fmtPrice(l.to.price, t.price)}</td><td class="num">${pct(l.to.price, l.from.price)}</td><td class="num">${l.bars}</td><td class="num">${r ? `${r2(r.r)}${near ? ' ≈0,618' : ''}` : '–'}</td><td>${l.abc ? '✓ ' : ''}${inner}</td></tr>`;
  }).join('');
  const plans = t.plans.map((p) => {
    const fr = feeR(p.entry, p.stop, feePct ?? 0.1);
    const how = p.type === 'elimit'
      ? `E = D − ${String(eRetr).replace('.', ',')} × (D − C); E bu seviyeyi aşabilir, stop C'nin ötesinde`
      : "ZigZag E'yi onayladığı mumun kapanışı";
    return `<h3 class="sec">${esc(PLAN_NAME_ABCDE[p.type])} · <span class="state ab-${p.state}">${esc(p.stateLabel)}</span></h3>
      <div class="facts">
        ${fact(p.type === 'elimit' ? 'Limit' : 'Giriş', fmtPrice(p.entry, t.price), ` <small class="muted">${esc(how)}</small>`)}
        ${fact('Stop (C ötesi)', fmtPrice(p.stop, t.price), ` <small class="muted">risk %${riskPct(p.entry, p.stop).toFixed(2).replace('.', ',')} · komisyon ≈ ${r2(fr)}R</small>`)}
        ${fact(`R:R (${p.main.name})`, fmtX(p.rr, 2))}
      </div>`;
  }).join('');
  const targets = t.levels.targets.map((x) => `<li><span>${esc(x.name)}</span><span class="num">${fmtPrice(x.price, t.price)}</span><span></span></li>`).join('');
  return `
    <div class="detail-head">
      <h2>${esc(t.coin)}/USDT</h2>
      <span class="dir ${t.direction}">${dirTxt(t)}</span>
      <span class="chip">${esc(t.variantLabel)}</span>
      <span class="chip">${esc(t.stateLabel)}</span>
      <span class="chip">${esc(tfId)} · derece ${t.sensitivity}×ATR</span>
      ${smtChip(t)}
      <a class="ext" href="${tv}" target="_blank" rel="noopener">TradingView'de aç ↗</a>
    </div>
    <div class="chart" id="chart"></div>
    <div class="legend" id="abcdeLegend"></div>
    <div class="facts">
      ${fact('Güncel fiyat', fmtPrice(t.price))}
      ${fact('Önceki hareket → 0', `${fmtPrice(P.w3s.price, t.price)} → ${fmtPrice(P.p0.price, t.price)}`, ` <small class="muted">${pct(P.p0.price, P.w3s.price)} · ${t.w3Impulse?.ok ? `5 dalgalı itki ✓ (dalga 3, alt derece ÷${t.w3Impulse.div})` : 'itki doğrulanamadı ✗'}</small>`)}
      ${fact('E limiti (C–D %61,8)', fmtPrice(t.levels.eLimit, t.price))}
      ${fact('Stop', fmtPrice(t.levels.stop, t.price))}
      ${fact('Skor', `${t.score}/100`)}
    </div>
    ${plans}
    <h3 class="sec">Kurallar</h3>
    <ul class="rule-list">${t.rules.map((r) => `<li>${ok(r.ok)} ${esc(r.name)}</li>`).join('')}
      <li>${ok(t.innerOk)} Her bacak 3'lü (ABC)${t.innerOk ? '' : ` — bulunamadı: ${esc(t.missing.join(', '))}`}</li></ul>
    <h3 class="sec">Bacaklar · her bacak bir öncekinin ≈ 0,618'i beklenir (aşmalar olabilir)</h3>
    <div class="table-wrap"><table class="stat"><thead><tr><th>Bacak</th><th>Fiyat</th><th>Boy</th><th>Mum</th><th>Oran</th><th>İç yapı</th></tr></thead><tbody>${legs}</tbody></table></div>
    <h3 class="sec">Hedefler</h3>
    <ul class="levels">${targets}</ul>
    <p class="muted small">0 = üçgenin başlangıcı (önceki hareket itkiyse dalga 3'ün sonu). Uzantılar log ölçekte, görünen pencerede önceki hareketin başından ölçülür.</p>`;
}
