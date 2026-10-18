// Takip listesi: bu tarayıcıda (localStorage) saklanır; JSON olarak dışa / içe aktarılabilir.
const KEY = 'ew-setup-scanner:watch:v1';

// Testlerde sahte depolama verilebilir
let storage = typeof localStorage !== 'undefined' ? localStorage : null;
export function useStorage(s) { storage = s; }

export function loadWatch() {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(list) {
  try { storage?.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}

/** Ekler; aynı anahtarlı (aynı coin, zaman dilimi ve yapı) kayıt varsa eklemez. */
export function addWatch(item) {
  const list = loadWatch();
  if (list.some((x) => x.key === item.key)) return { ok: false, reason: 'zaten listede', list };
  list.unshift(item);
  return { ok: save(list), list };
}

export function removeWatch(id) {
  const list = loadWatch().filter((x) => x.id !== id);
  save(list);
  return list;
}

export function updateWatch(id, patch) {
  const list = loadWatch().map((x) => (x.id === id ? { ...x, ...patch } : x));
  save(list);
  return list;
}

/** Durum güncellemeleri toplu yazılır (her kayıt için yeni lastStatus vb.). */
export function saveAll(list) { return save(list); }

export const findByKey = (key) => loadWatch().find((x) => x.key === key) || null;

export function exportWatch() { return JSON.stringify(loadWatch(), null, 1); }

/** İçe aktarma: anahtarı aynı olanların üzerine yazmaz (mevcut notlar korunur); eklenen sayısını döndürür. */
export function importWatch(list) {
  if (!Array.isArray(list)) throw new Error('Geçersiz dosya: dizi bekleniyordu');
  const cur = loadWatch();
  const keys = new Set(cur.map((x) => x.key));
  const add = list.filter((x) => x && x.key && x.instId && Array.isArray(x.plans) && !keys.has(x.key));
  const next = [...add, ...cur].sort((a, b) => b.savedAt - a.savedAt);
  save(next);
  return add.length;
}
