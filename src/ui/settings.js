// Ayarlar: varsayılanlar, tarayıcıda saklama ve "Ayarlar" bölmesinin formu.
import { DEFAULTS } from '../scan/wave3.js';
import { TIMEFRAMES } from '../data/okx.js';
import { TRI_DEFAULTS } from '../scan/triangle.js';
import { ABCDE_DEFAULTS } from '../scan/abcde.js';
import { DIAG_DEFAULTS } from '../scan/diagonal.js';
import { SMT_DEFAULTS } from '../scan/smt.js';

const KEY = 'ew-setup-scanner:settings:v1';

export const UI_DEFAULTS = {
  ...TRI_DEFAULTS,
  ...ABCDE_DEFAULTS,
  ...DIAG_DEFAULTS,
  ...SMT_DEFAULTS,
  smtOnly: false,
  ...DEFAULTS, // ortak anahtar (sensitivities) dalga-3 varsayılanı
  mode: 'wave3', // 'wave3' | 'triangle' | 'abcde' | 'diagonal'
  timeframe: '4H',
  entryType: 'both',
  topN: 50,
  manualCoins: '',
  autoRefresh: 0, // dakika; 0 = kapalı
  showAll: false,
  settingsRev: 2, // 2: textbookMin varsayılanı 3'e çekildi (eski kayıtlı 4 bir kez sıfırlanır)
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...UI_DEFAULTS, ...JSON.parse(raw) };
      if ((s.settingsRev || 1) < 2) { s.textbookMin = UI_DEFAULTS.textbookMin; s.settingsRev = 2; }
      if (!TIMEFRAMES[s.timeframe]) s.timeframe = UI_DEFAULTS.timeframe; // ör. kaldırılan 1H
      return s;
    }
  } catch { /* depolama kapalı olabilir */ }
  return { ...UI_DEFAULTS };
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* yoksay */ }
}

/** Ayar nesnesini tarayıcının beklediği biçime çevirir. */
export function toScanOptions(s) {
  const manual = String(s.manualCoins || '')
    .split(/[\s,;]+/)
    .map((x) => x.trim().toUpperCase().replace(/-USDT$/, ''))
    .filter(Boolean);
  return { ...s, manualCoins: manual.length ? manual : null };
}

const nums = (v) => String(v).split(/[\s,;]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0);

// Form alanları: [anahtar, etiket, tür, ek]. ek.group: bölüm (general | wave3 | triangle | abcde | diagonal), ek.sub: alt başlık.
const FIELDS = [
  // Genel
  ['topN', 'Coin sayısı (hacme göre)', 'select', { group: 'general', options: [[20, 'İlk 20'], [50, 'İlk 50'], [100, 'İlk 100']], num: true }],
  ['manualCoins', 'Elle coin listesi', 'text', { group: 'general', hint: 'Doluysa hacim listesi yerine bu kullanılır. Ör: BTC, ETH, SOL' }],
  ['direction', 'Yön', 'select', { group: 'general', options: [['both', 'Long + Short'], ['long', 'Sadece long'], ['short', 'Sadece short']] }],
  ['minRiskPct', 'Min. stop mesafesi (%)', 'number', { group: 'general', step: 0.1, min: 0, hint: "Giriş ile stop arası bundan darsa plan gösterilmez. 0 = kapalı; dar stopta komisyon R'yi yer." }],
  ['feePct', 'Komisyon (% / işlem tarafı)', 'number', { group: 'general', step: 0.01, min: 0, hint: 'Kartta dar stop uyarısındaki komisyon tahmini için.' }],
  ['smtRef', 'SMT referansı', 'select', { group: 'general', options: [['BTC', 'BTC (BTC için ETH)'], ['ETH', 'ETH (ETH için BTC)'], ['off', 'Kapalı']], hint: "Yalnızca dalga-3 limit bölge LONG: dalga 2'nin C'si A dibini süpürdü mü, referans grafik aynı anda süpürdü mü? Yalnızca etiket; kalıp, giriş, stop ve hedef değişmez." }],
  ['smtWin', 'SMT penceresi (± mum)', 'number', { group: 'general', step: 1, min: 0, hint: 'Referans grafikte uç noktanın çevresinde kaç muma bakılır.' }],
  ['smtOnly', "Sadece SMT'li limit bölge long'ları (diğer kurulumlar etkilenmez)", 'bool', { group: 'general' }],
  ['autoRefresh', 'Otomatik yenileme', 'select', { group: 'general', options: [[0, 'Kapalı'], [5, '5 dakikada bir'], [15, '15 dakikada bir']], num: true, hint: 'Sekme açıkken çalışır; yeni setup çıkınca bildirim gösterir.' }],

  // Dalga-3
  ['sensitivities', 'ZigZag duyarlılığı (× ATR)', 'list', { group: 'wave3', sub: 'Dalga yapısı', hint: 'Her değer bir dalga derecesi. Küçük = kısa dalgalar.' }],
  ['w1Extend', 'Dalga 1 başlangıcı', 'select', { group: 'wave3', sub: 'Dalga yapısı', options: [[0, 'Son dönüş noktası'], [1, '1 iç dalgalanma geri'], [2, '2 iç dalgalanma geri'], [99, 'En geniş dalga 1']], num: true, hint: "Daha önceki dip daha aşağıdaysa ve aradaki tepe 1'i geçmiyorsa 0 noktası geriye taşınır." }],
  ['minW1Atr', 'Min. dalga 1 boyu (× ATR)', 'number', { group: 'wave3', sub: 'Dalga yapısı', step: 0.5, min: 0 }],
  ['textbook', 'Sadece ders kitabı şekli', 'bool', { group: 'wave3', sub: 'Dalga yapısı', hint: "Şablon: net dalga 1 · orantılı ABC (a = dalga 1'in %30–60'ı, b = a'nın %50–78,6'sı, c = a'nın 1–1,4 katı; A da net itki) · ★ çakışma · dalga 2 süresi ≤ 2,5 × dalga 1." }],
  ['originReal', 'Yapı kırılımı şart (önceki trend bitmiş olsun)', 'bool', { group: 'wave3', sub: 'Dalga yapısı', hint: "Dalga 1, 0'dan önceki son tepeyi (short: dibi) geçmiş olmalı. Düşüş trendinde tepeler alçalır; son alçalan tepenin kırılması düşüşün bittiğini gösterir." }],
  ['textbookMin', 'En az şablon uyumu', 'select', { group: 'wave3', sub: 'Dalga yapısı', options: [[3, '3/4 ve üstü (biri eksik olabilir)'], [4, 'Sadece 4/4 (dört şart da)']], num: true }],
  ['cleanW1Er', 'Dalga 1 verimi en az (şablon)', 'number', { group: 'wave3', sub: 'Dalga yapısı', step: 0.05, min: 0, hint: 'Net hareket ÷ mumların gidip geldiği toplam yol. 1 = dümdüz itki, 0 = testere.' }],
  ['cleanW1Speed', 'Dalga 1 hızı en az (şablon, ATR / mum)', 'number', { group: 'wave3', sub: 'Dalga yapısı', step: 0.05, min: 0, hint: 'Dalga 1 boyu (× ATR) ÷ mum sayısı.' }],
  ['retrMin', 'Dalga 2 geri çekilme min', 'pct', { group: 'wave3', sub: 'Dalga yapısı' }],
  ['retrMax', 'Dalga 2 geri çekilme max', 'pct', { group: 'wave3', sub: 'Dalga yapısı' }],
  ['requireAbc', 'Dalga 2 ABC zorunlu', 'bool', { group: 'wave3', sub: 'Dalga yapısı' }],
  ['abcKinds', 'ABC tipi', 'select', { group: 'wave3', sub: 'Dalga yapısı', options: [['both', 'Zigzag veya flat'], ['zigzag', 'Sadece zigzag'], ['flat', 'Sadece flat']] }],
  ['minTimeRatio', 'Süre(2) / Süre(1) en az (>)', 'number', { group: 'wave3', sub: 'Dalga yapısı', step: 0.1, min: 0 }],
  ['rsiMode', 'RSI filtresi (Ders 3)', 'select', { group: 'wave3', sub: 'Dalga yapısı', options: [['score', 'Skora ekle'], ['require', 'Zorunlu'], ['off', 'Kapalı']], hint: "C'de A'ya göre uyumsuzluk / dalga 1'de RSI ≥ 60 (short: ≤ 40)" }],
  ['volume', 'Hacim filtresi (W1 > W2 hacmi skora +)', 'bool', { group: 'wave3', sub: 'Dalga yapısı' }],
  ['stopMode', 'Stop yeri', 'select', { group: 'wave3', sub: 'B kırılımı', options: [['w2', 'Dalga 2 ucu'], ['w0', '0 noktası (geçersizlik)']] }],
  ['stopAtr', 'Stop tamponu (× ATR)', 'number', { group: 'wave3', sub: 'B kırılımı', step: 0.05, min: 0, hint: 'İki giriş tipinde de stop bu kadar ötesine konur.' }],
  ['zoneCExt', 'Bölge kenarı: C = ? × A', 'number', { group: 'wave3', sub: 'Limit bölge', step: 0.001, min: 0.5, hint: "B'den ölçülür. Varsayılan 1,272." }],
  ['zoneRetr', 'Bölge kenarı: dalga 2 geri çekilme', 'pct', { group: 'wave3', sub: 'Limit bölge', hint: 'Varsayılan %61,8.' }],
  ['zoneEntry', 'Bölge girişi', 'select', { group: 'wave3', sub: 'Limit bölge', options: [['mid', 'Kademeli: yarısı yakın, yarısı uzak kenar'], ['near', 'Yakın kenar'], ['far', 'Uzak kenar'], ['r618', 'Sadece %61,8 seviyesi'], ['c127', 'Sadece C = 1,272A seviyesi']], hint: "Mükemmel setup'larda (iki seviye çakışınca) her seçenekte tek çakışma seviyesi kullanılır." }],
  ['zoneStop', 'Stop yeri', 'select', { group: 'wave3', sub: 'Limit bölge', options: [['w0', 'Dalga 1 başı (0 noktası)'], ['r886', 'Dalga 2 = %88,6']] }],
  ['perfectAtr', '★ Mükemmel: iki kenar farkı ≤ ? × ATR', 'number', { group: 'wave3', sub: 'Limit bölge', step: 0.05, min: 0, hint: '%61,8 ile C = 1,272A bu kadar yakınsa tek çakışma seviyesi sayılır.' }],
  ['zoneFrontAtr', 'Limit emri seviyenin önüne (× ATR)', 'number', { group: 'wave3', sub: 'Limit bölge', step: 0.05, min: 0, hint: 'Fiyat seviyeye birkaç tik kala dönse de emir dolsun. 0 = tam seviye.' }],
  ['approachAtr', 'Yaklaşma uyarısı (× ATR)', 'number', { group: 'wave3', sub: 'Limit bölge', step: 0.1, min: 0, hint: 'Fiyat emre bu kadar yaklaşınca kart "Seviyeye yaklaştı" olur ve bildirim gelir.' }],
  ['zoneTime', 'Süre koşulu', 'select', { group: 'wave3', sub: 'Limit bölge', options: [['require', 'Emir, süre(2) > süre(1) olunca aktif'], ['ignore', 'Süreye bakma']] }],
  ['targetSet', 'Hedef seti', 'select', { group: 'wave3', sub: 'Hedef ve R:R', options: [['classic', "Klasik (C'den 1 · 1,618 · 2,618 × dalga 1)"], ['book', 'Kitabi (−0,236 uzantı · 1,272 · 1,618 · 2,618)']], hint: "Kitabi: ilk hedef dalga 1 tepesinin 0,236 × dalga 1 ötesi; sonrakiler C'den ölçülür." }],
  ['targets', 'Hedefler (× dalga 1, klasik set)', 'list', { group: 'wave3', sub: 'Hedef ve R:R' }],
  ['mainTarget', 'R:R için hedef', 'select', { group: 'wave3', sub: 'Hedef ve R:R', options: [[0, 'Hedef 1'], [1, 'Hedef 2'], [2, 'Hedef 3']], num: true }],
  ['minRR', 'Min. R:R', 'number', { group: 'wave3', sub: 'Hedef ve R:R', step: 0.25, min: 0 }],

  // Üçgen kırılımı
  ['triType', 'Tip', 'select', { group: 'triangle', options: [['all', 'Yükselen + alçalan'], ['asc', 'Sadece yükselen (yukarı kırılım)'], ['desc', 'Sadece alçalan (aşağı kırılım)']] }],
  ['triContext', 'Önceki hareket', 'select', { group: 'triangle', options: [['all', 'Hepsi'], ['after-down', 'Düşüş sonrası'], ['after-up', 'Yükseliş sonrası']] }],
  ['flatAtr', 'Düz kenar toleransı (× ATR)', 'number', { group: 'triangle', step: 0.05, min: 0, hint: 'Tepeler (dipler) en yüksek tepeye bu kadar yakınsa düz kenara dokunmuş sayılır.' }],
  ['minTops', 'Düz kenara en az dokunuş', 'number', { group: 'triangle', step: 1, min: 2 }],
  ['minBottoms', 'Eğik kenara en az dokunuş', 'number', { group: 'triangle', step: 1, min: 2 }],
  ['minWidthBars', 'En az genişlik (mum)', 'number', { group: 'triangle', step: 1, min: 3 }],
  ['triTarget', 'Ana hedef (R:R)', 'select', { group: 'triangle', options: [['mm', 'Ölçülü hareket (1× yükseklik)'], ['f382', 'Önceki hareketin %38,2'], ['f50', '%50'], ['f618', '%61,8'], ['f786', '%78,6'], ['f100', '%100']] }],
  ['triMinRR', 'Min. R:R', 'number', { group: 'triangle', step: 0.25, min: 0 }],

  // Running üçgen (ABCDE)
  ['abcdeEntry', 'Giriş', 'select', { group: 'abcde', options: [['both', 'İkisi: E limiti + E onayı'], ['limit', 'Sadece E limiti (C–D %61,8)'], ['confirm', 'Sadece E onayı']] }],
  ['eRetr', 'E limiti (C–D geri alımı)', 'pct', { group: 'abcde', hint: 'E = D − oran × (D − C). Varsayılan %61,8; E aşabilir, stop C’nin ötesinde.' }],
  ['innerAbc', 'Her bacak 3’lü (ABC)', 'select', { group: 'abcde', options: [['require', 'Zorunlu'], ['prefer', 'Tercih (elemez, puan düşer)']] }],
  ['w3Check', 'Önceki hareket 5 dalgalı itki (dalga 3)', 'select', { group: 'abcde', options: [['prefer', 'Tercih (elemez, puan)'], ['require', 'Zorunlu']] }],
  ['abcdeVariant', 'Tip', 'select', { group: 'abcde', options: [['all', 'Running + daralan'], ['running', "Sadece running (B, 0'ı geçti)"], ['contracting', 'Sadece daralan']] }],
  ['abcdeSens', 'ZigZag duyarlılığı (× ATR)', 'list', { group: 'abcde', hint: 'Üçgenler büyük dereceli olabilir; 6 da taranır.' }],
  ['abcdeStopAtr', 'Stop tamponu (C ötesi, × ATR)', 'number', { group: 'abcde', step: 0.05, min: 0 }],
  ['abcdeTarget', 'Ana hedef (R:R)', 'select', { group: 'abcde', options: [['thrust', 'Thrust (E + en geniş bacak)'], ['top', 'Başlangıç (0)'], ['e1236', 'Önceki hareket × 1,236'], ['e1618', 'Önceki hareket × 1,618']] }],
  ['abcdeMinRR', 'Min. R:R', 'number', { group: 'abcde', step: 0.25, min: 0 }],

  // Diagonal
  ['diagType', 'Tür', 'select', { group: 'diagonal', sub: 'Genel', options: [['w4', 'Dalga 4 → 5 (4. dalgada giriş, hedef 3 ucu)'], ['ending', 'Ending dönüşü (5 bitince, 2–4 kırılımı)'], ['leading', 'Leading (bitince dalga 2 limiti)'], ['all', 'Hepsi']] }],
  ['diagShape', 'Şekil', 'select', { group: 'diagonal', sub: 'Genel', options: [['all', 'Daralan + genişleyen'], ['contracting', 'Sadece daralan'], ['expanding', 'Sadece genişleyen']] }],
  ['diagSens', 'ZigZag duyarlılığı (× ATR)', 'list', { group: 'diagonal', sub: 'Genel' }],
  ['diagStopAtr', 'Stop tamponu (× ATR)', 'number', { group: 'diagonal', sub: 'Genel', step: 0.05, min: 0, hint: "Dalga 4: geçersizliğin ötesi. Ending: 5'in ötesi. Leading: 0'ın ötesi." }],
  ['diagMinRR', 'Min. R:R', 'number', { group: 'diagonal', sub: 'Genel', step: 0.25, min: 0 }],
  ['diagW4Entry', 'Limit yeri', 'select', { group: 'diagonal', sub: 'Dalga 4 → 5', options: [['near', 'Bölgenin yakın kenarı'], ['mid', 'Bölgenin ortası'], ['far', 'Bölgenin uzak kenarı']] }],
  ['diagW2Min', 'Dalga 2 en az', 'pct', { group: 'diagonal', sub: 'Dalga 4 → 5', hint: "Dalga 2'nin dalga 1'i geri alma oranı. Diagonalde dalga 2 derindir; itkiden ayırt etmeye yarar." }],
  ['diagExpMax', 'Genişleyende dalga 3 en fazla (× dalga 1)', 'number', { group: 'diagonal', sub: 'Dalga 4 → 5', step: 0.1, min: 1 }],
  ['diagEndTarget', 'Ana hedef', 'select', { group: 'diagonal', sub: 'Ending dönüşü', options: [['p0', 'Başlangıç (0)'], ['p2', '2 ucu'], ['p4', '4 ucu']] }],
  ['diagRetr', 'Dalga 2 limiti', 'pct', { group: 'diagonal', sub: 'Leading', hint: '0→5 hareketinin geri alım oranı. Varsayılan %61,8.' }],
  ['diagLeadTarget', 'Ana hedef', 'select', { group: 'diagonal', sub: 'Leading', options: [['w3a', 'Dalga 3 = 1 × dalga 1'], ['w3b', 'Dalga 3 = 1,618 × dalga 1'], ['p5', '5 ucu (dalga 1 sonu)']] }],
];

// Bölümler: sıra, başlık, hangi modla eşleştiği
const GROUPS = [
  { id: 'general', title: 'Genel' },
  { id: 'wave3', title: 'Dalga-3 setup', mode: 'wave3' },
  { id: 'triangle', title: 'Üçgen kırılımı', mode: 'triangle' },
  { id: 'abcde', title: 'Running üçgen (ABCDE)', mode: 'abcde' },
  { id: 'diagonal', title: 'Diagonal', mode: 'diagonal' },
];
// Kullanıcının elle açıp kapattığı bölümler (sayfa açıkken hatırlanır); mod değişince seçili mod yeniden açılır
const openState = new Map();
let lastMode = null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fieldHtml([key, label, type, ex = {}], s) {
  const id = `set-${key}`;
  const hint = ex.hint ? `<small>${esc(ex.hint)}</small>` : '';
  let input;
  if (type === 'select') {
    input = `<select id="${id}">${ex.options.map(([v, t]) => `<option value="${esc(v)}"${String(s[key]) === String(v) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  } else if (type === 'bool') {
    return `<label class="check" for="${id}"><input type="checkbox" id="${id}"${s[key] ? ' checked' : ''}/> ${esc(label)}</label>`;
  } else if (type === 'pct') {
    input = `<input type="number" id="${id}" step="0.1" min="0" max="100" value="${+(s[key] * 100).toFixed(1)}"/>`;
  } else if (type === 'list') {
    input = `<input type="text" id="${id}" value="${esc(s[key].join(', '))}"/>`;
  } else if (type === 'text') {
    input = `<input type="text" id="${id}" value="${esc(s[key] || '')}" placeholder="boş = hacme göre"/>`;
  } else {
    input = `<input type="number" id="${id}" step="${ex.step}" min="${ex.min}" value="${s[key]}"/>`;
  }
  return `<label class="field" for="${id}"><span>${esc(label)}${type === 'pct' ? ' (%)' : ''}</span>${input}${hint}</label>`;
}

/**
 * Ayarlar paneli: her konu kendi başlığı altında (Genel her zaman, seçili mod açık; diğerleri kapalı).
 * @param mode  hangi modun bölümü açık gelsin (varsayılan s.mode; backtest sayfası kendi modunu verir)
 */
export function renderSettings(root, s, onChange, { mode = s.mode } = {}) {
  if (mode !== lastMode) { openState.clear(); lastMode = mode; }
  const html = GROUPS.map((g) => {
    const fields = FIELDS.filter((f) => f[3].group === g.id);
    const subs = [];
    for (const f of fields) {
      const sub = f[3].sub || '';
      let blk = subs.find((x) => x.sub === sub);
      if (!blk) subs.push((blk = { sub, items: [] }));
      blk.items.push(fieldHtml(f, s));
    }
    const isMode = g.mode && g.mode === mode;
    const open = openState.has(g.id) ? openState.get(g.id) : g.id === 'general' || isMode;
    return `<details class="set-group${isMode ? ' current' : ''}" data-group="${g.id}"${open ? ' open' : ''}>
      <summary>${esc(g.title)}${isMode ? ' <span class="chip">seçili mod</span>' : ''}</summary>
      ${subs.map((b) => `${b.sub ? `<h4>${esc(b.sub)}</h4>` : ''}<div class="set-grid">${b.items.join('')}</div>`).join('')}
    </details>`;
  }).join('');
  root.innerHTML = `${html}<div class="actions"><button type="button" id="set-reset" class="ghost">Varsayılanlara dön</button></div>`;

  for (const d of root.querySelectorAll('details.set-group')) d.addEventListener('toggle', () => openState.set(d.dataset.group, d.open));
  for (const [key, , type, ex = {}] of FIELDS) {
    const el = root.querySelector(`#set-${key}`);
    el.addEventListener('change', () => {
      let v;
      if (type === 'bool') v = el.checked;
      else if (type === 'pct') v = Math.max(0, Number(el.value)) / 100;
      else if (type === 'list') { v = nums(el.value); if (!v.length) v = UI_DEFAULTS[key]; }
      else if (type === 'text') v = el.value;
      else if (type === 'select') v = ex.num ? Number(el.value) : el.value;
      else v = Number(el.value);
      onChange({ [key]: v });
    });
  }
  root.querySelector('#set-reset').addEventListener('click', () => onChange(null));
}
