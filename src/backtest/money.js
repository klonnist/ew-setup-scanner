// Para simülasyonu: backtest işlemlerini dolar, kaldıraç ve sermaye kullanımıyla hesaplar (saf; DOM'suz).
// Modlar:
//  - 'fixed'  : her işleme sabit teminat; bütün sinyaller alınır (gereken en yüksek teminat ayrıca raporlanır)
//  - 'single' : tek pozisyon, bakiyenin tamamı (bileşik); pozisyon açıkken gelen sinyaller atlanır
//  - 'slots'  : sermaye N eşit parçaya bölünür; parçalar doluyken gelen sinyal atlanır
// Tasfiye: izole marjin, tasfiye fiyatı = giriş × (1 ∓ 1/kaldıraç ± mmr). İşlem içi en kötü fiyat (mae) ya da stop
// bu seviyenin ötesindeyse teminatın tamamı kaybedilir. Funding ve kayma dahil değildir.

export const MONEY_DEFAULTS = { mode: 'fixed', capital: 100, margin: 25, slots: 4, leverage: 1, feePct: 0.1, mmr: 0.5 };

const dirOf = (t) => (t.dir === 'short' ? -1 : 1);

/** Tek işlemin sonucu (teminat ve kaldıraçla). */
export function tradeResult(t, margin, o) {
  const d = dirOf(t);
  const lev = Math.max(1, o.leverage);
  const size = margin * lev;
  const fee = o.feePct / 100;
  const liq = lev > 1 ? t.entry * (1 - d * (1 / lev - o.mmr / 100)) : null;
  // Tasfiye: işlem içi en kötü fiyat (yoksa stop) tasfiye fiyatına ulaştı mı. Stop tasfiyeden önceyse fiyat önce stop'a değer.
  let liquidated = false, approx = false;
  if (liq != null) {
    const stopBeyond = d * (t.stop - liq) <= 0;
    if (t.mae != null) liquidated = d * (t.mae - liq) <= 0 && (t.outcome !== 'stop' || stopBeyond);
    else { approx = true; liquidated = t.outcome === 'stop' && stopBeyond; }
  }
  const move = d * (t.exit / t.entry - 1);
  const pnl = liquidated ? -margin - size * fee : size * move - size * fee - size * (t.exit / t.entry) * fee;
  return { pnl, liquidated, approx, liq, size, move };
}

/**
 * @param trades  işlemler (entryTime, exitTime, entry, exit, stop, dir, outcome, mae?, coin)
 * @param opts    MONEY_DEFAULTS alanları
 * @returns {{ rows, summary, months, coins, curve }}
 */
export function simulate(trades, opts = {}) {
  const o = { ...MONEY_DEFAULTS, ...opts };
  // Aynı mumda birden çok sinyal: puanı yüksek olan önce (çıkış zamanına bakılmaz; gelecek bilgisi kullanılmaz)
  const list = [...trades].sort((a, b) => a.entryTime - b.entryTime || (b.score ?? 0) - (a.score ?? 0) || String(a.coin).localeCompare(String(b.coin)));
  const isOpen = (t) => t.outcome === 'open';
  const rows = [];
  let bal = o.capital; // kapanan işlemlerle bakiye (fixed: sermaye + kümülatif kâr/zarar)
  // Açık pozisyonlar: { until, margin }
  let active = [];
  let maxMargin = 0, maxConcurrent = 0;
  // Bakiye olayları zaman sırasıyla işlenmeli: önce bu girişten önce kapananlar
  const pending = []; // { at, pnl, row }
  const settle = (until) => {
    pending.sort((a, b) => a.at - b.at);
    while (pending.length && pending[0].at <= until) {
      const p = pending.shift();
      bal += p.pnl;
      p.row.balance = bal;
    }
    active = active.filter((a) => a.until > until);
  };

  for (const t of list) {
    settle(t.entryTime);
    let margin, taken = true, reason = '';
    if (o.mode === 'single') {
      if (active.length) { taken = false; reason = 'açık pozisyon var'; }
      else if (bal <= 0) { taken = false; reason = 'bakiye bitti'; }
      margin = bal;
    } else if (o.mode === 'slots') {
      if (active.length >= o.slots) { taken = false; reason = 'parçaların hepsi dolu'; }
      margin = Math.max(0, bal) / o.slots;
      if (taken && margin <= 0) { taken = false; reason = 'bakiye bitti'; }
    } else {
      margin = o.margin;
    }
    if (!taken) { rows.push({ t, taken, reason }); continue; }
    const r = tradeResult(t, margin, o);
    const row = { t, taken, margin, ...r, open: isOpen(t), balance: null };
    rows.push(row);
    active.push({ until: isOpen(t) ? Infinity : t.exitTime, margin });
    maxConcurrent = Math.max(maxConcurrent, active.length);
    maxMargin = Math.max(maxMargin, active.reduce((s, a) => s + a.margin, 0));
    if (!isOpen(t)) pending.push({ at: t.exitTime, pnl: r.pnl, row });
  }
  settle(Infinity);

  // Bakiye eğrisi, en büyük düşüş (kapanış sırasıyla)
  const closed = rows.filter((x) => x.taken && !x.open).sort((a, b) => a.t.exitTime - b.t.exitTime);
  let eq = o.capital, peak = o.capital, dd = 0, ddPct = 0, low = o.capital;
  const curve = [{ time: closed[0]?.t.entryTime ?? 0, value: o.capital }];
  for (const x of closed) {
    eq += x.pnl;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    ddPct = Math.max(ddPct, peak > 0 ? (peak - eq) / peak : 0);
    low = Math.min(low, eq);
    curve.push({ time: x.t.exitTime, value: eq });
  }
  const wins = closed.filter((x) => x.pnl > 0), losses = closed.filter((x) => x.pnl <= 0);
  const sum = (a) => a.reduce((s, x) => s + x.pnl, 0);
  const openRows = rows.filter((x) => x.taken && x.open);
  const net = sum(closed);

  const months = new Map();
  for (const x of closed) {
    const m = new Date(x.t.exitTime).toISOString().slice(0, 7);
    const v = months.get(m) || { month: m, n: 0, wins: 0, pnl: 0 };
    v.n++; if (x.pnl > 0) v.wins++; v.pnl += x.pnl;
    months.set(m, v);
  }
  let cum = 0;
  const monthList = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((v) => ({ ...v, cum: (cum += v.pnl) }));
  const coinMap = new Map();
  for (const x of closed) {
    const v = coinMap.get(x.t.coin) || { coin: x.t.coin, n: 0, pnl: 0 };
    v.n++; v.pnl += x.pnl;
    coinMap.set(x.t.coin, v);
  }

  return {
    rows,
    curve,
    months: monthList,
    coins: [...coinMap.values()].sort((a, b) => b.pnl - a.pnl),
    summary: {
      signals: list.length,
      taken: rows.filter((x) => x.taken).length,
      skipped: rows.filter((x) => !x.taken).length,
      closed: closed.length,
      open: openRows.length,
      openPnl: sum(openRows),
      wins: wins.length,
      losses: losses.length,
      liquidated: closed.filter((x) => x.liquidated).length,
      approx: rows.some((x) => x.approx),
      net,
      final: o.capital + net,
      returnPct: o.capital > 0 ? net / o.capital : 0,
      winSum: sum(wins),
      lossSum: sum(losses),
      avgWin: wins.length ? sum(wins) / wins.length : 0,
      avgLoss: losses.length ? sum(losses) / losses.length : 0,
      best: closed.length ? Math.max(...closed.map((x) => x.pnl)) : 0,
      worst: closed.length ? Math.min(...closed.map((x) => x.pnl)) : 0,
      maxDD: dd,
      maxDDPct: ddPct,
      lowBalance: low,
      maxConcurrent,
      maxMargin,
    },
  };
}

/** İşlem listesini CSV metni olarak (UTF-8 BOM, noktalı virgül; Excel'de açılır). */
const SMT_TXT = { smt: 'SMT var', both: 'SMT yok', ref: 'Ters SMT', none: 'Süpürme yok' };
export function toCsv(rows, { typeName = {}, withMoney = false } = {}) {
  const d = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '');
  const num = (x, p = 6) => (x == null || !Number.isFinite(x) ? '' : String(+x.toPrecision(p)).replace('.', ','));
  const money = (x) => (x == null ? '' : x.toFixed(2).replace('.', ','));
  const OUT = { hedef: 'Hedef', stop: 'Stop', 'süre': 'Süre doldu', open: 'Açık (anlık)', 'kısmi': 'Kısmi (bazı hedefler)' };
  const head = ['#', 'Giriş (UTC)', 'Çıkış (UTC)', 'Coin', 'Plan', 'Yön', 'Giriş fiyatı', 'Stop', 'Çıkış fiyatı', 'Sonuç', 'R', 'Fiyat değişimi %', 'SMT', 'C uzadı'];
  if (withMoney) head.push('Alındı mı', 'Teminat $', 'Pozisyon $', 'Tasfiye fiyatı', 'Tasfiye', 'Kâr/zarar $', 'Bakiye $');
  const lines = [head];
  rows.forEach((x, i) => {
    const t = x.t;
    const line = [i + 1, d(t.entryTime), t.outcome === 'open' ? '' : d(t.exitTime), t.coin, typeName[t.type] || t.type, t.dir === 'short' ? 'SHORT' : 'LONG',
      num(t.entry), num(t.stop), num(t.exit), OUT[t.outcome] || t.outcome, num(t.R, 3), money((dirOf(t) * (t.exit / t.entry - 1)) * 100), SMT_TXT[t.smt] || '', t.cExt == null ? '' : t.cExt ? 'evet' : 'hayır'];
    if (withMoney) {
      line.push(x.taken ? 'evet' : `hayır (${x.reason})`, x.taken ? money(x.margin) : '', x.taken ? money(x.size) : '', x.taken ? num(x.liq) : '',
        x.taken ? (x.liquidated ? 'evet' : 'hayır') : '', x.taken ? money(x.pnl) : '', x.taken && !x.open ? money(x.balance) : x.open ? '(açık)' : '');
    }
    lines.push(line);
  });
  return '﻿' + lines.map((l) => l.join(';')).join('\r\n');
}
