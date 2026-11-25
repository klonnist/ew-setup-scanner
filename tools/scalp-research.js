// Scalp seçenekleri için eğitim / test ölçümü (Node 22).
// Kullanım: node tools/scalp-research.js <önbellekKlasörü> [testGün=120] [çıktı.json]
// Önbellek: <coin>.json = [[time, o, h, l, c], ...] (15m) + meta.json { end, days, coins }.
// Tüm yıl tek seferde simüle edilir; işlemler giriş zamanına göre eğitim (eski) / test (son testGün) diye ayrılır.
// Seçim yalnızca eğitim döneminden yapılır; test dönemi o seçimin doğrulamasıdır.
import fs from 'node:fs';
import path from 'node:path';
import { backtestScalp, summarizeScalp, VARIANTS } from '../src/scalp/engine.js';

const [dir, testDaysArg = '120', outFile] = process.argv.slice(2);
const testDays = +testDaysArg;
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const split = meta.end - testDays * 86400e3;
const data = [];
for (const coin of meta.coins) {
  const f = path.join(dir, `${coin}.json`);
  if (!fs.existsSync(f)) continue;
  const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
  data.push([coin, rows.map(([time, open, high, low, close]) => ({ time, open, high, low, close }))]);
}

const configs = [];
for (const minRR of [2, 3]) for (const wickSweep of [false, true]) for (const htf of ['off', 'with', 'notAgainst']) for (const entryMode of ['market', 'retest']) for (const priorMove of ['off', 'drop', 'any']) {
  configs.push({ minRR, wickSweep, htf, entryMode, priorMove, feePct: 0.05, ...(entryMode === 'retest' ? { makerFeePct: 0.02 } : {}) });
}

const label = (c) => `RR${c.minRR} ${c.wickSweep ? 'iğne' : '-'} ${c.htf === 'off' ? '-' : c.htf === 'with' ? '4H=' : '4H≠ters'} ${c.entryMode === 'retest' ? 'retest' : 'market'} ${c.priorMove === 'off' ? '-' : c.priorMove === 'drop' ? 'düşüş-sonrası' : 'hareket-sonrası'}`;
const results = [];
for (const cfg of configs) {
  const trades = [];
  for (const [coin, candles] of data) trades.push(...backtestScalp(candles, { coin, ...cfg }).trades);
  const tr = trades.filter((t) => t.entryTime < split), te = trades.filter((t) => t.entryTime >= split);
  const sum = (list) => Object.fromEntries(VARIANTS.map((v) => {
    const s = summarizeScalp(list, v.id);
    const L = summarizeScalp(list.filter((t) => t.d === 1), v.id), S = summarizeScalp(list.filter((t) => t.d === -1), v.id);
    return [v.id, { n: s.n, wr: s.winRate, R: s.total, pf: s.pf, dd: s.maxDD, longR: L.total, longN: L.n, shortR: S.total, shortN: S.n }];
  }));
  results.push({ cfg, label: label(cfg), train: sum(tr), test: sum(te) });
  process.stderr.write(`${label(cfg)} ${trades.length}\n`);
}

const f = (x) => (x >= 0 ? '+' : '') + x.toFixed(1);
const pf = (x) => (Number.isFinite(x) ? x.toFixed(2) : '∞');
console.log(`# ${data.length} coin · 15m · ${new Date(meta.end - meta.days * 86400e3).toISOString().slice(0, 10)} → ${new Date(meta.end).toISOString().slice(0, 10)} · test = son ${testDays} gün (${new Date(split).toISOString().slice(0, 10)}+)`);
console.log('ayar\t| eğitim n\tA R(PF)\tC R(PF)\tC long/short\t| test n\tA R(PF)\tC R(PF)\tC long/short');
for (const r of results) {
  const a = r.train, b = r.test;
  console.log(`${r.label}\t| ${a.A.n}\t${f(a.A.R)} (${pf(a.A.pf)})\t${f(a.C.R)} (${pf(a.C.pf)})\t${f(a.C.longR)}/${f(a.C.shortR)}\t| ${b.A.n}\t${f(b.A.R)} (${pf(b.A.pf)})\t${f(b.C.R)} (${pf(b.C.pf)})\t${f(b.C.longR)}/${f(b.C.shortR)}`);
}
// Her seçeneğin tek başına etkisi (min R:R 2, diğerleri kapalı)
const isBase = (c) => c.minRR === 2 && !c.wickSweep && c.htf === 'off' && c.entryMode === 'market' && c.priorMove === 'off';
const singles = results.filter((r) => r.cfg.minRR === 2 && [r.cfg.wickSweep, r.cfg.htf !== 'off', r.cfg.entryMode !== 'market', r.cfg.priorMove !== 'off'].filter(Boolean).length <= 1);
console.log('\n## Tek seçenek (min R:R 2)');
for (const r of singles.sort((x, y) => (isBase(y.cfg) ? 1 : 0) - (isBase(x.cfg) ? 1 : 0))) {
  console.log(`${isBase(r.cfg) ? 'TEMEL' : r.label}\t| eğitim ${r.train.C.n} işlem A ${f(r.train.A.R)} C ${f(r.train.C.R)} (PF ${pf(r.train.C.pf)})\t| test ${r.test.C.n} işlem A ${f(r.test.A.R)} C ${f(r.test.C.R)} (PF ${pf(r.test.C.pf)})`);
}
// Eğitimde en iyi (en az 30 işlem, C toplam R) → testteki sonucu
const eligible = results.filter((r) => r.train.C.n >= 30);
const best = eligible.sort((x, y) => y.train.C.R - x.train.C.R)[0];
if (best) console.log(`\nEğitimde en iyi (C, n≥30): ${best.label} → eğitim ${f(best.train.C.R)}R PF ${pf(best.train.C.pf)} · test ${f(best.test.C.R)}R PF ${pf(best.test.C.pf)} (${best.test.C.n} işlem)`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ meta: { ...meta, split, testDays, coinsUsed: data.map(([c]) => c) }, results, best: best?.label }, null, 1));
