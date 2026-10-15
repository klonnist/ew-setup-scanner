// Ayarlar: varsayılanlar, tarayıcıda saklama ve "Ayarlar" bölmesinin formu.
import { DEFAULTS } from '../scan/wave3.js';

const KEY = 'ew-setup-scanner:settings:v1';

export const UI_DEFAULTS = {
  ...DEFAULTS,
  timeframe: '4H',
  topN: 50,
  manualCoins: '',
  autoRefresh: 0, // dakika; 0 = kapalı
  showAll: false,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...UI_DEFAULTS, ...JSON.parse(raw) };
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
  ['retrMin', 'Dalga 2 geri çekilme min', 'pct'],
  ['retrMax', 'Dalga 2 geri çekilme max', 'pct'],
  ['requireAbc', 'Dalga 2 ABC zorunlu', 'bool'],
  ['abcKinds', 'ABC tipi', 'select', { options: [['both', 'Zigzag veya flat'], ['zigzag', 'Sadece zigzag'], ['flat', 'Sadece flat']] }],
  ['minTimeRatio', 'Süre(2) / Süre(1) en az (>)', 'number', { step: 0.1, min: 0 }],
  ['minW1Atr', 'Min. dalga 1 boyu (× ATR)', 'number', { step: 0.5, min: 0 }],
  ['rsiMode', 'RSI filtresi (Ders 3)', 'select', { options: [['score', 'Skora ekle'], ['require', 'Zorunlu'], ['off', 'Kapalı']], hint: "C'de A'ya göre uyumsuzluk / dalga 1'de RSI ≥ 60 (short: ≤ 40)" }],
  ['volume', 'Hacim filtresi (W1 > W2 hacmi skora +)', 'bool'],
  ['stopMode', 'Stop yeri', 'select', { options: [['w2', 'Dalga 2 ucu'], ['w0', '0 noktası (geçersizlik)']] }],
  ['stopAtr', 'Stop tamponu (× ATR)', 'number', { step: 0.05, min: 0 }],
  ['targets', 'Hedefler (× dalga 1)', 'list'],
  ['mainTarget', 'R:R için hedef', 'select', { options: [[0, 'Hedef 1'], [1, 'Hedef 2'], [2, 'Hedef 3']], num: true }],
  ['minRR', 'Min. R:R', 'number', { step: 0.25, min: 0 }],
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
