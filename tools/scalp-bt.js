// Scalp backtest ölçümü (Node 22): OKX'ten mumları indirir, scalp motorunu farklı ayarlarla çalıştırır, tablo basar.
// Kullanım: node tools/scalp-bt.js [coinSayısı=20] [market=swap] [önbellekKlasörü]
import fs from 'node:fs';
import path from 'node:path';
import { getTopCoins, instIdOf, TIMEFRAMES } from '../src/data/okx.js';
import { getHistory } from '../src/backtest/history.js';
import { backtestScalp, summarizeScalp, VARIANTS } from '../src/scalp/engine.js';

const N = +(process.argv[2] || 20);
const market = process.argv[3] || 'swap';
const cacheDir = process.argv[4] || null;
const DAY = 86400e3;
const now = Date.now();
const end = Math.floor(now / (5 * 60e3)) * 5 * 60e3 - 1;

const PLANS = [
  { tf: '5m', fetchDays: 31, periods: [7, 30] },
  { tf: '15m', fetchDays: 62, periods: [30, 60] },
];
const GRID = [
  { minRR: 2, feePct: 0.05 }, { minRR: 3, feePct: 0.05 },
  { minRR: 2, feePct: 0.1 }, { minRR: 3, feePct: 0.1 },
];

async function load(instId, tf, days) {
  const f = cacheDir && path.join(cacheDir, `${instId}_${tf.id}_${days}.json`);
  if (f && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const c = await getHistory(instId, tf, end - days * DAY, end);
  if (f) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(c)); }
  return c;
}

const coins = await getTopCoins(N, {}, market);
console.log(`# ${new Date(now).toISOString()} · ${market} · ilk ${coins.length}: ${coins.map((c) => c.coin).join(' ')}`);
const rows = [];
for (const plan of PLANS) {
  const tf = TIMEFRAMES[plan.tf];
  const data = {};
  for (const c of coins) {
    const id = instIdOf(c.coin, market);
    try { data[c.coin] = await load(id, tf, plan.fetchDays); } catch (e) { console.error(id, e.message); }
    process.stderr.write(`${plan.tf} ${c.coin} ${data[c.coin]?.length || 0}\n`);
  }
  // Önbellekten okununca "şimdi" değil, verinin son mumu bitiştir
  const endT = Math.max(...Object.values(data).filter((c) => c.length).map((c) => c[c.length - 1].time));
  for (const days of plan.periods) {
    for (const g of GRID) {
      const trades = [];
      for (const [coin, candles] of Object.entries(data)) {
        trades.push(...backtestScalp(candles, { coin, from: endT - days * DAY, to: endT, ...g }).trades);
      }
      for (const v of VARIANTS) {
        const s = summarizeScalp(trades, v.id);
        const L = summarizeScalp(trades.filter((t) => t.d === 1), v.id), S = summarizeScalp(trades.filter((t) => t.d === -1), v.id);
        rows.push({ tf: plan.tf, days, ...g, v: v.id, n: s.n, wr: s.winRate, R: s.total, pf: s.pf, avg: s.avg, dd: s.maxDD, longR: L.total, longN: L.n, shortR: S.total, shortN: S.n });
      }
    }
  }
}
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '∞');
console.log('tf\tgün\tminRR\tkom%\tvar\tişlem\twin%\ttoplamR\tPF\tortR\tmaxDD\tlong(n:R)\tshort(n:R)');
for (const r of rows) {
  console.log([r.tf, r.days, r.minRR, r.feePct, r.v, r.n, (r.wr * 100).toFixed(0), f2(r.R), f2(r.pf), f2(r.avg), f2(r.dd), `${r.longN}:${f2(r.longR)}`, `${r.shortN}:${f2(r.shortR)}`].join('\t'));
}
if (cacheDir) fs.writeFileSync(path.join(cacheDir, 'results.json'), JSON.stringify({ at: now, market, coins: coins.map((c) => c.coin), rows }, null, 1));
