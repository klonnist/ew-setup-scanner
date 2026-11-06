import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rankByVolume, instIdOf, getTopCoins } from '../src/data/okx.js';
import { marketOf } from '../src/scan/fibcluster.js';
import { runScan } from '../src/scan/scanner.js';
import { snapshot } from '../src/watch/track.js';
import { findFibClusters } from '../src/scan/fibcluster.js';
import { findWave3Setups } from '../src/scan/wave3.js';
import { build } from './helpers.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const tick = (instId, volCcy24h, last = 2) => ({ instId, last: String(last), open24h: String(last), volCcy24h: String(volCcy24h) });

test('instIdOf: spot ve vadeli parite kimliği', () => {
  assert.equal(instIdOf('BTC'), 'BTC-USDT');
  assert.equal(instIdOf('BTC', 'swap'), 'BTC-USDT-SWAP');
});

test('marketOf: fibMarket yalnızca Fib modunda geçerli', () => {
  assert.equal(marketOf({ mode: 'fib', fibMarket: 'swap' }), 'swap');
  assert.equal(marketOf({ mode: 'fib', fibMarket: 'spot' }), 'spot');
  assert.equal(marketOf({ mode: 'fib' }), 'spot');
  for (const mode of ['wave3', 'triangle', 'abcde', 'diagonal']) assert.equal(marketOf({ mode, fibMarket: 'swap' }), 'spot');
});

test('rankByVolume: vadelide hacim adet × fiyat, yalnızca USDT vadeli', () => {
  const tickers = [tick('AAA-USDT-SWAP', 100, 10), tick('BBB-USDT-SWAP', 600, 1), tick('CCC-USD-SWAP', 9999), tick('DDD-USDT', 9999), tick('USDC-USDT-SWAP', 9999), tick('EEE-USDT-260925', 9999)];
  const out = rankByVolume(tickers, 'USDT', null, 'swap');
  assert.deepEqual(out.map((x) => x.coin), ['AAA', 'BBB']); // 1000 $ > 600 $
  assert.equal(out[0].volUsd, 1000);
  assert.equal(out[0].instId, 'AAA-USDT-SWAP');
});

test('rankByVolume: spot davranışı aynı, vadeli sözleşmeler girmez', () => {
  const out = rankByVolume([tick('AAA-USDT', 100), tick('BBB-USDT', 300), tick('CCC-USDT-SWAP', 9999)]);
  assert.deepEqual(out.map((x) => x.coin), ['BBB', 'AAA']);
  assert.equal(out[0].volUsd, 300);
});

/** OKX'i taklit eder: istenen adresleri kaydeder, her pariteye aynı 60 mumu döner. */
function stubOkx() {
  const urls = [];
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    urls.push(u);
    const type = u.searchParams.get('instType');
    let data = [];
    if (u.pathname.endsWith('/market/tickers')) data = type === 'SWAP' ? [tick('AAA-USDT-SWAP', 100)] : [tick('AAA-USDT', 100)];
    else if (u.pathname.endsWith('/public/instruments')) data = type === 'SWAP' ? [{ instId: 'AAA-USDT-SWAP', state: 'live', ctType: 'linear' }] : [{ instId: 'AAA-USDT', state: 'live' }];
    else data = Array.from({ length: 60 }, (_, i) => [String((60 - i) * 3600e3), '10', '11', '9', '10', '1', '1', '1', '1']);
    return { ok: true, status: 200, json: async () => ({ code: '0', data }) };
  };
  return urls;
}
const instOf = (urls) => [...new Set(urls.filter((u) => u.pathname.endsWith('/market/candles')).map((u) => u.searchParams.get('instId')).filter((x) => x.startsWith('AAA')))];

test('marketOf: w3Market yalnızca Dalga-3 modunda geçerli, mod yoksa Dalga-3', () => {
  assert.equal(marketOf({ mode: 'wave3', w3Market: 'swap' }), 'swap');
  assert.equal(marketOf({ w3Market: 'swap' }), 'swap');
  assert.equal(marketOf({ mode: 'wave3', w3Market: 'spot' }), 'spot');
  assert.equal(marketOf({ mode: 'wave3' }), 'spot');
  for (const mode of ['fib', 'triangle', 'abcde', 'diagonal']) assert.equal(marketOf({ mode, w3Market: 'swap' }), 'spot');
});

test('tarama: fib + vadeli vadeli mumları indirir', async () => {
  const urls = stubOkx();
  const res = await runScan({ mode: 'fib', fibMarket: 'swap', timeframe: '4H', topN: 1 });
  assert.equal(res.market, 'swap');
  assert.deepEqual(instOf(urls), ['AAA-USDT-SWAP']);
  assert.ok(urls.some((u) => u.searchParams.get('instType') === 'SWAP'));
});

test('tarama: elle coin listesi de seçilen piyasadan gelir', async () => {
  const urls = stubOkx();
  await runScan({ mode: 'fib', fibMarket: 'swap', timeframe: '4H', manualCoins: ['AAA'] });
  assert.deepEqual(instOf(urls), ['AAA-USDT-SWAP']);
});

for (const [mode, fibMarket] of [['fib', 'spot'], ['wave3', 'swap'], ['triangle', 'swap'], ['abcde', 'swap'], ['diagonal', 'swap']]) {
  test(`tarama: ${mode} (fibMarket ${fibMarket}) spot kalır`, async () => {
    const urls = stubOkx();
    const res = await runScan({ mode, fibMarket, timeframe: '4H', topN: 1 });
    assert.equal(res.market, 'spot');
    assert.deepEqual(instOf(urls), ['AAA-USDT']);
    assert.ok(!urls.some((u) => u.searchParams.get('instType') === 'SWAP'));
  });
}

test('tarama: Dalga-3 + vadeli vadeli mumları ve coin listesini indirir', async () => {
  const urls = stubOkx();
  const res = await runScan({ mode: 'wave3', w3Market: 'swap', timeframe: '4H', topN: 1 });
  assert.equal(res.market, 'swap');
  assert.deepEqual(instOf(urls), ['AAA-USDT-SWAP']);
  assert.ok(urls.some((u) => u.searchParams.get('instType') === 'SWAP'));
});

test('tarama: Dalga-3 elle coin listesi de vadeliden gelir', async () => {
  const urls = stubOkx();
  await runScan({ mode: 'wave3', w3Market: 'swap', timeframe: '4H', manualCoins: ['AAA'] });
  assert.deepEqual(instOf(urls), ['AAA-USDT-SWAP']);
});

for (const mode of ['fib', 'triangle', 'abcde', 'diagonal']) {
  test(`tarama: ${mode} (w3Market swap) spot kalır`, async () => {
    const urls = stubOkx();
    const res = await runScan({ mode, w3Market: 'swap', timeframe: '4H', topN: 1 });
    assert.equal(res.market, 'spot');
    assert.deepEqual(instOf(urls), ['AAA-USDT']);
  });
}

test('getTopCoins: varsayılan spot', async () => {
  const urls = stubOkx();
  const list = await getTopCoins(5, {});
  assert.deepEqual(list.map((x) => x.instId), ['AAA-USDT']);
  assert.ok(urls.every((u) => u.searchParams.get('instType') !== 'SWAP'));
});

test('takip kaydı: vadeli parite ayrı anahtar, başlıkta belli, mumlar vadeliden yenilenir', () => {
  const candles = build([[0, 130], [20, 100], [50, 200], [62, 160], [72, 190], [80, 165]]);
  const s = findFibClusters(candles, { direction: 'both', fibSens: [4], fibTolAtr: 2 })[0];
  const ctx = { tf: { id: '4H', ms: 3600e3 }, mode: 'fib', now: 1 };
  const spot = snapshot({ ...s, coin: 'X', instId: 'X-USDT' }, candles, ctx);
  const swap = snapshot({ ...s, coin: 'X', instId: 'X-USDT-SWAP' }, candles, ctx);
  assert.equal(swap.instId, 'X-USDT-SWAP');
  assert.notEqual(spot.key, swap.key);
  assert.match(swap.title, /vadeli/);
  assert.doesNotMatch(spot.title, /vadeli/);
});

test('takip kaydı: Dalga-3 vadeli ayrı anahtar ve başlıkta belli, spot anahtarı değişmez', () => {
  const candles = build([[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [66, 112]]);
  const s = findWave3Setups(candles, { sensitivities: [4.5], entryType: 'zone', direction: 'both' }).find((x) => x.phase === 'forming');
  const ctx = { tf: { id: '4H', ms: 3600e3 }, mode: 'wave3', now: 1 };
  const spot = snapshot({ ...s, coin: 'X', instId: 'X-USDT' }, candles, ctx);
  const swap = snapshot({ ...s, coin: 'X', instId: 'X-USDT-SWAP' }, candles, ctx);
  assert.equal(swap.instId, 'X-USDT-SWAP');
  assert.equal(swap.key, spot.key + '|swap');
  assert.doesNotMatch(spot.key, /swap/);
  assert.match(swap.title, /vadeli/);
  assert.doesNotMatch(spot.title, /vadeli/);
});
