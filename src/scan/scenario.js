// Senaryo okları: aktif plandan iki yol. Ana: fiyat → giriş → hedef 1 → hedef 2. Alternatif: fiyat → giriş → stop → iptal.
// Noktalar son mumdan itibaren mum adımıyla (k) verilir; zaman ekseni temsilîdir, tahmin değildir.
// Saf fonksiyon; DOM kullanmaz. Fikir: mugiatama34/crypto_technical_analysis (MIT).

export const SCENARIO_AHEAD = 24; // grafikte son mumun sağına eklenen boş mum sayısı

/**
 * @param plan     takip planı biçimi (snapshot().plans[i]): { entryKind, legs, stop, targets: [{ price }] }
 * @param d        +1 long, −1 short
 * @param price    güncel fiyat
 * @param entered  işleme girildiyse "giriş" adımı atlanır (varsayılan: piyasa emri)
 * @returns {{ main: {k, price, label, above}[], alt: {k, price, label, above}[] }|null}  çizilecek yol yoksa null
 */
export function scenarioPaths(plan, d, price, entered = plan?.entryKind === 'market') {
  if (!plan?.legs?.length || !(price > 0)) return null;
  if (d * (price - plan.stop) <= 0) return null; // fiyat stopun ötesinde: plan bitmiş
  const entry = entered ? price : plan.legs.reduce((s, x) => s + x, 0) / plan.legs.length;
  const risk = d * (entry - plan.stop);
  if (!(risk > 0)) return null;
  const targets = plan.targets.filter((t) => d * (t.price - entry) > 0).slice(0, 2);
  if (!targets.length) return null;
  const start = [{ k: 0, price, label: '', above: false }];
  const enter = entered ? [] : [{ k: 3, price: entry, label: 'giriş', above: d === -1 }];
  return {
    main: [...start, ...enter, ...targets.map((t, i) => ({ k: i === 0 ? 12 : 22, price: t.price, label: `H${i + 1}`, above: d === 1 }))],
    alt: [...start, ...enter, { k: 9, price: plan.stop, label: 'stop', above: d === -1 }, { k: 13, price: plan.stop - d * 0.5 * risk, label: 'iptal', above: d === -1 }],
  };
}
