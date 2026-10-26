// Çelişen sayım: modlar ve dereceler birbirinden habersiz çalışır; aynı coinde başka bir sayım (başka mod ya da aynı
// modun başka derecesi) açık bir kurulumla ters yönü gösteriyorsa kurulum etiketlenir. Üçgen modunda aynı moddaki zıt
// yönler sayılmaz (simetrik üçgenin iki kırılım yönü çelişki değildir).
// Yalnızca bilgi: algılama, sıralama ve filtreler değişmez.
import { findWave3Setups, pickSetups } from './wave3.js';
import { findTriangles, pickTriangles } from './triangle.js';
import { findAbcde, pickAbcde } from './abcde.js';
import { findDiagonals, pickDiagonals } from './diagonal.js';

const MODES = {
  wave3: { label: 'Dalga-3', find: findWave3Setups, pick: pickSetups, long: false },
  triangle: { label: 'Üçgen', find: findTriangles, pick: pickTriangles, long: true },
  abcde: { label: 'ABCDE', find: findAbcde, pick: pickAbcde, long: true },
  diagonal: { label: 'Diagonal', find: findDiagonals, pick: pickDiagonals, long: true },
};

/**
 * Bir coindeki tüm modların açık kurulum yönleri: [{ mode, label, direction }].
 * Yön ayarı ve SMT filtresi uygulanmaz (karşı sayım her durumda görülsün). Sonuç r üzerinde ayarlara göre önbelleklenir:
 * yalnızca mod değişince yeniden hesaplanmaz.
 */
export function openViews(r, opts) {
  const { mode, diagnostics, ...rest } = opts;
  const key = JSON.stringify(rest);
  if (r.views?.key === key) return r.views.list;
  const list = [];
  for (const [id, m] of Object.entries(MODES)) {
    const candles = m.long ? r.longCandles : r.candles;
    if (!candles?.length) continue;
    const o = { ...rest, mode: id, direction: 'both' };
    const seen = new Set();
    for (const s of m.pick(m.find(candles, o, r.live), o)) {
      if (seen.has(s.direction)) continue;
      seen.add(s.direction);
      list.push({ mode: id, label: m.label, direction: s.direction });
    }
  }
  r.views = { key, list };
  return list;
}

/** Her kuruluma ters yönlü açık sayımları yazar (s.conflicts; yoksa boş dizi). Üçgen modu kendi zıt yönünü saymaz. */
export function tagConflicts(setups, views, mode) {
  for (const s of setups) s.conflicts = views.filter((v) => v.direction !== s.direction && !(mode === 'triangle' && v.mode === 'triangle'));
  return setups;
}
