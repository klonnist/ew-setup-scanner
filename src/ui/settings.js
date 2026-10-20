// Ayarlar: varsayılanlar, tarayıcıda saklama ve "Ayarlar" bölmesinin formu.
import { DEFAULTS } from '../scan/wave3.js';
import { TIMEFRAMES } from '../data/okx.js';
import { TRI_DEFAULTS } from '../scan/triangle.js';
import { ABCDE_DEFAULTS } from '../scan/abcde.js';
import { DIAG_DEFAULTS } from '../scan/diagonal.js';

const KEY = 'ew-setup-scanner:settings:v1';

export const UI_DEFAULTS = {
  ...TRI_DEFAULTS,
  ...ABCDE_DEFAULTS,
  ...DIAG_DEFAULTS,
  ...DEFAULTS, // ortak anahtar (sensitivities) dalga-3 varsayılanı
  mode: 'wave3', // 'wave3' | 'triangle' | 'abcde' | 'diagonal'
  timeframe: '4H',
  entryType: 'both',
  topN: 50,
  manualCoins: '',
  autoRefresh: 0, // dakika; 0 = kapalı
  showAll: false,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...UI_DEFAULTS, ...JSON.parse(raw) };
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

// Form alanları: [anahtar, etiket, tür, ek]
const FIELDS = [
  ['topN', 'Coin sayısı (hacme göre)', 'select', { options: [[20, 'İlk 20'], [50, 'İlk 50'], [100, 'İlk 100']], num: true }],
  ['manualCoins', 'Elle coin listesi', 'text', { hint: 'Doluysa hacim listesi yerine bu kullanılır. Ör: BTC, ETH, SOL' }],
  ['direction', 'Yön', 'select', { options: [['both', 'Long + Short'], ['long', 'Sadece long'], ['short', 'Sadece short']] }],
  ['sensitivities', 'ZigZag duyarlılığı (× ATR)', 'list', { hint: 'Her değer bir dalga derecesi. Küçük = kısa dalgalar.' }],
  ['w1Extend', 'Dalga 1 başlangıcı', 'select', { options: [[0, 'Son dönüş noktası'], [1, '1 iç dalgalanma geri'], [2, '2 iç dalgalanma geri'], [99, 'En geniş dalga 1']], num: true, hint: "Daha önceki dip daha aşağıdaysa ve aradaki tepe 1'i geçmiyorsa 0 noktası geriye taşınır." }],
  ['retrMin', 'Dalga 2 geri çekilme min', 'pct'],
  ['retrMax', 'Dalga 2 geri çekilme max', 'pct'],
  ['requireAbc', 'Dalga 2 ABC zorunlu', 'bool'],
  ['abcKinds', 'ABC tipi', 'select', { options: [['both', 'Zigzag veya flat'], ['zigzag', 'Sadece zigzag'], ['flat', 'Sadece flat']] }],
  ['minTimeRatio', 'Süre(2) / Süre(1) en az (>)', 'number', { step: 0.1, min: 0 }],
  ['minW1Atr', 'Min. dalga 1 boyu (× ATR)', 'number', { step: 0.5, min: 0 }],
  ['rsiMode', 'RSI filtresi (Ders 3)', 'select', { options: [['score', 'Skora ekle'], ['require', 'Zorunlu'], ['off', 'Kapalı']], hint: "C'de A'ya göre uyumsuzluk / dalga 1'de RSI ≥ 60 (short: ≤ 40)" }],
  ['volume', 'Hacim filtresi (W1 > W2 hacmi skora +)', 'bool'],
  ['stopMode', 'Stop yeri (B kırılımı)', 'select', { options: [['w2', 'Dalga 2 ucu'], ['w0', '0 noktası (geçersizlik)']] }],
  ['stopAtr', 'Stop tamponu (× ATR)', 'number', { step: 0.05, min: 0, hint: 'İki giriş tipinde de stop bu kadar ötesine konur.' }],
  ['zoneCExt', 'Bölge kenarı: C = ? × A', 'number', { step: 0.001, min: 0.5, hint: "B'den ölçülür. Varsayılan 1,272." }],
  ['zoneRetr', 'Bölge kenarı: dalga 2 geri çekilme', 'pct', { hint: 'Varsayılan %61,8.' }],
  ['zoneEntry', 'Bölge girişi', 'select', { options: [['mid', 'Kademeli: yarısı yakın, yarısı uzak kenar'], ['near', 'Yakın kenar'], ['far', 'Uzak kenar'], ['r618', 'Sadece %61,8 seviyesi'], ['c127', 'Sadece C = 1,272A seviyesi']], hint: "Mükemmel setup'larda (iki seviye çakışınca) her seçenekte tek çakışma seviyesi kullanılır." }],
  ['zoneStop', 'Stop yeri (limit bölge)', 'select', { options: [['w0', 'Dalga 1 başı (0 noktası)'], ['r886', 'Dalga 2 = %88,6']] }],
  ['perfectAtr', '★ Mükemmel: iki kenar farkı ≤ ? × ATR', 'number', { step: 0.05, min: 0, hint: '%61,8 ile C = 1,272A bu kadar yakınsa tek çakışma seviyesi sayılır.' }],
  ['zoneFrontAtr', 'Limit emri seviyenin önüne (× ATR)', 'number', { step: 0.05, min: 0, hint: 'Fiyat seviyeye birkaç tik kala dönse de emir dolsun. 0 = tam seviye.' }],
  ['approachAtr', 'Yaklaşma uyarısı (× ATR)', 'number', { step: 0.1, min: 0, hint: 'Fiyat emre bu kadar yaklaşınca kart "Seviyeye yaklaştı" olur ve bildirim gelir.' }],
  ['zoneTime', 'Süre koşulu (limit bölge)', 'select', { options: [['require', "Emir, süre(2) > süre(1) olunca aktif"], ['ignore', 'Süreye bakma']] }],
  ['targets', 'Hedefler (× dalga 1)', 'list'],
  ['mainTarget', 'R:R için hedef', 'select', { options: [[0, 'Hedef 1'], [1, 'Hedef 2'], [2, 'Hedef 3']], num: true }],
  ['minRR', 'Min. R:R', 'number', { step: 0.25, min: 0 }],
  ['minRiskPct', 'Min. stop mesafesi (%)', 'number', { step: 0.1, min: 0, hint: "Giriş ile stop (geçersizlik) arası bundan darsa plan gösterilmez. 0 = kapalı; dar stopta komisyon R'yi yer." }],
  ['feePct', 'Komisyon (% / işlem tarafı)', 'number', { step: 0.01, min: 0, hint: 'Kartta dar stop uyarısındaki komisyon tahmini için.' }],
  ['triType', 'Üçgen: tip', 'select', { options: [['all', 'Yükselen + alçalan'], ['asc', 'Sadece yükselen (yukarı kırılım)'], ['desc', 'Sadece alçalan (aşağı kırılım)']] }],
  ['triContext', 'Üçgen: önceki hareket', 'select', { options: [['all', 'Hepsi'], ['after-down', 'Düşüş sonrası'], ['after-up', 'Yükseliş sonrası']] }],
  ['flatAtr', 'Üçgen: düz kenar toleransı (× ATR)', 'number', { step: 0.05, min: 0, hint: 'Tepeler (dipler) en yüksek tepeye bu kadar yakınsa düz kenara dokunmuş sayılır.' }],
  ['minTops', 'Üçgen: düz kenara en az dokunuş', 'number', { step: 1, min: 2 }],
  ['minBottoms', 'Üçgen: eğik kenara en az dokunuş', 'number', { step: 1, min: 2 }],
  ['minWidthBars', 'Üçgen: en az genişlik (mum)', 'number', { step: 1, min: 3 }],
  ['triTarget', 'Üçgen: ana hedef (R:R)', 'select', { options: [['mm', 'Ölçülü hareket (1× yükseklik)'], ['f382', 'Önceki hareketin %38,2'], ['f50', '%50'], ['f618', '%61,8'], ['f786', '%78,6'], ['f100', '%100']] }],
  ['triMinRR', 'Üçgen: min. R:R', 'number', { step: 0.25, min: 0 }],
  ['abcdeEntry', 'ABCDE: giriş', 'select', { options: [['both', 'İkisi: E limiti + E onayı'], ['limit', "Sadece E limiti (C–D %61,8)"], ['confirm', 'Sadece E onayı']] }],
  ['eRetr', 'ABCDE: E limiti (C–D geri alımı)', 'pct', { hint: 'E = D − oran × (D − C). Varsayılan %61,8; E aşabilir, stop C’nin ötesinde.' }],
  ['innerAbc', 'ABCDE: her bacak 3’lü (ABC)', 'select', { options: [['require', 'Zorunlu'], ['prefer', 'Tercih (elemez, puan düşer)']] }],
  ['w3Check', 'ABCDE: önceki hareket 5 dalgalı itki (dalga 3)', 'select', { options: [['prefer', 'Tercih (elemez, puan)'], ['require', 'Zorunlu']] }],
  ['abcdeVariant', 'ABCDE: tip', 'select', { options: [['all', 'Running + daralan'], ['running', "Sadece running (B, 3'ün ucunu geçti)"], ['contracting', 'Sadece daralan']] }],
  ['abcdeSens', 'ABCDE: ZigZag duyarlılığı (× ATR)', 'list', { hint: 'Üçgenler büyük dereceli olabilir; 6 da taranır.' }],
  ['abcdeStopAtr', 'ABCDE: stop tamponu (C ötesi, × ATR)', 'number', { step: 0.05, min: 0 }],
  ['abcdeTarget', 'ABCDE: ana hedef (R:R)', 'select', { options: [['thrust', 'Thrust (E + en geniş bacak)'], ['top', 'Başlangıç (0)'], ['e1236', 'Önceki hareket × 1,236'], ['e1618', 'Önceki hareket × 1,618']] }],
  ['abcdeMinRR', 'ABCDE: min. R:R', 'number', { step: 0.25, min: 0 }],
  ['diagType', 'Diagonal: türü', 'select', { options: [['w4', 'Dalga 4 → 5 (4. dalgada giriş, hedef 3 ucu)'], ['ending', 'Ending dönüşü (5 bitince, 2–4 kırılımı)'], ['leading', 'Leading (bitince dalga 2 limiti)'], ['all', 'Hepsi']] }],
  ['diagShape', 'Diagonal: şekil', 'select', { options: [['all', 'Daralan + genişleyen'], ['contracting', 'Sadece daralan'], ['expanding', 'Sadece genişleyen']] }],
  ['diagSens', 'Diagonal: ZigZag duyarlılığı (× ATR)', 'list'],
  ['diagRetr', 'Diagonal (leading): dalga 2 limiti', 'pct', { hint: '0→5 hareketinin geri alım oranı. Varsayılan %61,8.' }],
  ['diagStopAtr', 'Diagonal: stop tamponu (× ATR)', 'number', { step: 0.05, min: 0, hint: "Ending: 5'in ötesi. Leading: 0'ın ötesi." }],
  ['diagEndTarget', 'Diagonal (ending): ana hedef', 'select', { options: [['p0', 'Başlangıç (0)'], ['p2', '2 ucu'], ['p4', '4 ucu']] }],
  ['diagLeadTarget', 'Diagonal (leading): ana hedef', 'select', { options: [['w3a', 'Dalga 3 = 1 × dalga 1'], ['w3b', 'Dalga 3 = 1,618 × dalga 1'], ['p5', '5 ucu (dalga 1 sonu)']] }],
  ['diagW2Min', 'Diagonal (dalga 4): dalga 2 en az', 'pct', { hint: "Dalga 2'nin dalga 1'i geri alma oranı. Diagonalde dalga 2 derindir; itkiden ayırt etmeye yarar." }],
  ['diagExpMax', 'Diagonal (dalga 4, genişleyen): dalga 3 en fazla (× dalga 1)', 'number', { step: 0.1, min: 1 }],
  ['diagMinRR','Diagonal: min. R:R', 'number', { step: 0.25, min: 0 }],
  ['autoRefresh', 'Otomatik yenileme', 'select', { options: [[0, 'Kapalı'], [5, '5 dakikada bir'], [15, '15 dakikada bir']], num: true, hint: 'Sekme açıkken çalışır; yeni setup çıkınca bildirim gösterir.' }],
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderSettings(root, s, onChange) {
  const html = FIELDS.map(([key, label, type, ex = {}]) => {
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
  }).join('');
  root.innerHTML = `${html}<div class="actions"><button type="button" id="set-reset" class="ghost">Varsayılanlara dön</button></div>`;

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
