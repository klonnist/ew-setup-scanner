// Biçimlendirme yardımcıları.
import { SMT_LABEL, SMT_HELP } from '../scan/smt.js';

/** Fiyatın büyüklüğüne göre ondalık hane sayısı (PEPE gibi küçük fiyatlar için daha fazla). */
export function decimals(p) {
  const a = Math.abs(p);
  if (!(a > 0)) return 2;
  if (a >= 1000) return 2;
  if (a >= 1) return 4;
  return Math.min(10, Math.ceil(-Math.log10(a)) + 3);
}

export function fmtPrice(p, ref = p) {
  if (!Number.isFinite(p)) return '–';
  return p.toLocaleString('tr-TR', { minimumFractionDigits: decimals(ref), maximumFractionDigits: decimals(ref) });
}

export const fmtPct = (r, d = 1) => `%${(r * 100).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const fmtX = (r, d = 2) => `${r.toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d })}×`;

export function fmtTime(ms) {
  return new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** SMT etiketi (yalnızca bilgi): kalıbın son ucu, referans grafikle (BTC/ETH) karşılaştırıldı. */
export function smtChip(s) {
  if (!s.smt) return '';
  const ref = s.smtRef ? ` · ${s.smtRef}` : '';
  return `<span class="chip smt-${s.smt}" title="${esc(SMT_HELP[s.smt] + (s.smtRef ? ` Referans: ${s.smtRef}.` : ''))}">${esc(SMT_LABEL[s.smt] + ref)}</span>`;
}

/** Aynı coinde ters yönlü açık başka bir sayım varsa uyarı chip'i. */
export function conflictChip(s) {
  if (!s.conflicts?.length) return '';
  const txt = s.conflicts.map((v) => `${v.label} ${v.direction === 'long' ? 'LONG' : 'SHORT'}`).join(', ');
  return `<span class="chip conflict" title="${esc('Aynı coinde başka bir sayım açık bir kurulumla ters yönü gösteriyor: ' + txt + '. Sayımlardan biri yanlış; teyit seviyelerini bekle ya da pozisyonu küçült.')}">⚠ Çelişen sayım · ${esc(txt)}</span>`;
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
