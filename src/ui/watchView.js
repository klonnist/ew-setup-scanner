// ★ Takip listem: kart ve ayrıntı HTML'i (app.js çağırır; grafik chart.js drawWatch).
import { fmtPrice, fmtTime, esc } from './format.js';
import { PLAN_NAME } from '../watch/track.js';

const MODE_TXT = { wave3: 'Dalga-3', triangle: 'Üçgen' };
const fmtR = (r) => (r == null ? '–' : `${r > 0 ? '+' : ''}${r.toFixed(2).replace('.', ',')}R`);
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 60) return `${m} dk önce`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} sa önce` : `${Math.round(h / 24)} gün önce`;
};

/** Planın durum rozeti: kapanmış / açık / bekliyor ayrımı ve hedef sayısı. */
function badge(ev) {
  if (!ev) return '<span class="state">hesaplanıyor…</span>';
  const extra = ev.state === 'entered' && ev.targetsHit ? ` · H${ev.targetsHit} görüldü` : ev.state === 'stopped' && ev.targetsHit ? ` (H${ev.targetsHit} sonrası)` : '';
  return `<span class="state w-${ev.state}">${esc(ev.stateLabel)}${extra}</span>`;
}

function planRow(item, p, ev, ref) {
  return `<div class="plan">
    <div class="plan-head"><span class="plan-name">${esc(PLAN_NAME[p.type])}</span>${badge(ev)}
      <span class="rr">${ev?.R != null ? `<b class="num ${ev.R >= 0 ? 'pos' : 'neg'}">${fmtR(ev.R)}</b>${ev.open ? ' anlık' : ''}` : ''}</span></div>
    <div class="lv">
      <div><b>${ev?.entry != null ? 'Giriş' : p.entryKind === 'limit' ? 'Limit' : p.entryKind === 'stop' ? 'Tetik' : 'Giriş'}</b><span class="num">${fmtPrice(ev?.entry ?? p.legs[0], ref)}</span></div>
      <div><b>Stop</b><span class="num">${fmtPrice(p.stop, ref)}</span></div>
      <div><b>Hedef 1</b><span class="num">${fmtPrice(p.targets[0]?.price, ref)}</span></div>
      <div><b>Hedef 2</b><span class="num">${fmtPrice(p.targets[1]?.price, ref)}</span></div>
    </div>
  </div>`;
}

export function watchCard(item, evals, { selected, price }) {
  const ref = price ?? item.priceAtSave;
  const dir = item.d === 1 ? 'LONG ▲' : 'SHORT ▼';
  return `
  <div class="card ${item.direction} watch-card" role="button" tabindex="0" data-wid="${esc(item.id)}" aria-current="${selected}">
    <div class="head">
      <span class="coin">${esc(item.coin)}</span>
      <span class="dir ${item.direction}">${dir}</span>
      <span class="chip">${esc(item.tf)} · ${esc(MODE_TXT[item.mode] || item.mode)}</span>
      <span class="score">${ago(item.savedAt)}</span>
    </div>
    <div class="meta"><span>${esc(item.title)}</span><span>kayıt fiyatı ${fmtPrice(item.priceAtSave, ref)}</span>${price != null ? `<span>şimdi ${fmtPrice(price, ref)}</span>` : ''}</div>
    ${item.plans.map((p, i) => planRow(item, p, evals?.[i], ref)).join('')}
    ${item.note ? `<div class="note-txt">📝 ${esc(item.note)}</div>` : ''}
  </div>`;
}

export function watchDetail(item, evals, { price }) {
  const ref = price ?? item.priceAtSave;
  const tv = `https://www.tradingview.com/chart/?symbol=OKX%3A${encodeURIComponent(item.coin)}USDT`;
  const plans = item.plans.map((p, i) => {
    const ev = evals?.[i];
    const rows = [
      ['Giriş türü', { stop: 'tetik (seviye geçilince)', limit: 'limit (seviyeye gelince)', market: 'kayıt anındaki fiyat' }[p.entryKind]],
      ['Emir seviyesi', p.legs.map((l) => fmtPrice(l, ref)).join(' / ')],
      ['Gerçekleşen giriş', ev?.entry != null ? `${fmtPrice(ev.entry, ref)} · ${fmtTime(ev.entryTime)}${ev.legs > 1 ? ` · ${ev.filledLegs}/${ev.legs} bacak` : ''}` : '–'],
      ['Stop', fmtPrice(p.stop, ref)],
      ...p.targets.map((t, k) => [`Hedef ${k + 1}`, `${fmtPrice(t.price, ref)}${ev && ev.targetsHit > k ? ' ✓' : ''} <small class="muted">${esc(t.name)}</small>`]),
      ['Çıkış', ev?.exitPrice != null ? `${fmtPrice(ev.exitPrice, ref)} · ${fmtTime(ev.exitTime)}` : '–'],
      ['R', ev?.R != null ? `${fmtR(ev.R)}${ev.open ? ' (anlık)' : ''}` : '–'],
    ];
    return `<h3 class="sec">${esc(PLAN_NAME[p.type])} · ${badge(ev)}</h3>
      <div class="facts">${rows.map(([k, v]) => `<div><b>${esc(k)}</b><span class="num">${v}</span></div>`).join('')}</div>`;
  }).join('');
  return `
    <div class="detail-head">
      <h2>${esc(item.coin)}/USDT</h2>
      <span class="dir ${item.direction}">${item.d === 1 ? 'LONG ▲' : 'SHORT ▼'}</span>
      <span class="chip">★ takipte · ${esc(item.tf)} · ${esc(MODE_TXT[item.mode] || item.mode)}</span>
      <a class="ext" href="${tv}" target="_blank" rel="noopener">TradingView'de aç ↗</a>
    </div>
    <div class="chart" id="chart"></div>
    <div class="facts">
      <div><b>Kaydedildi</b><span class="num">${fmtTime(item.savedAt)}</span></div>
      <div><b>Kayıt fiyatı</b><span class="num">${fmtPrice(item.priceAtSave, ref)}</span></div>
      <div><b>Güncel fiyat</b><span class="num">${price != null ? fmtPrice(price, ref) : '–'}</span></div>
      <div><b>Yapı</b><span>${esc(item.title)}</span></div>
    </div>
    ${plans}
    <h3 class="sec">Not</h3>
    <textarea id="watchNote" class="watch-note" rows="3" placeholder="Bu işlem hakkında notun (yalnızca bu tarayıcıda saklanır)">${esc(item.note || '')}</textarea>
    <div class="watch-actions">
      <button type="button" id="watchSaveNote" class="ghost sm">Notu kaydet</button>
      <button type="button" id="watchRemove" class="ghost sm danger">Takipten çıkar</button>
    </div>
    <p class="muted small">Durum, kayıttan sonra açılan mumlarla hesaplanır (backtest ile aynı dolum kuralları). Giriş 50 mum içinde gelmezse "Süre doldu" olur.</p>`;
}
