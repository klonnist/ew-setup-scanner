import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from './helpers.js';
import { findWave3Setups, activePlans } from '../src/scan/wave3.js';

// Pivotlar (±0,3 fitil): 0 = 99,7 (bar 19), 1 = 130,3 (bar 39), A = 114,7, B = 122,3, C = 109,7.
// Bölge (doğrusal): %61,8 = 130,3 − 0,618 × 30,6 ≈ 111,39 (yakın) · C = 1,272A = 122,3 − 1,272 × 15,6 ≈ 102,46 (uzak)
const BASE = [[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [70, 110], [76, 119]];
const OPTS = { sensitivities: [4.5], entryType: 'both' };
const NEAR = 130.3 - 0.618 * 30.6;
const FAR = 122.3 - 1.272 * 15.6;

test('bölge kenarları: C = 1,272A ve dalga 2 = %61,8; yakın/uzak sırası', () => {
  const s = findWave3Setups(build(BASE), OPTS).find((x) => x.phase === 'complete');
  assert.ok(s?.zone);
  assert.ok(Math.abs(s.zone.near - NEAR) < 1e-9);
  assert.ok(Math.abs(s.zone.far - FAR) < 1e-9);
  assert.equal(s.zone.lvR, s.zone.near);
  // Kenar dışındaki çakışan seviyeler sayılır (ör. C = 1A, %78,6, %88,6 bölge içinde)
  assert.ok(s.zone.inside >= 2);
});

test('tamamlanmış dalga 2: C yakın kenarı geçti → kademeli girişin yarısı doldu', () => {
  const s = findWave3Setups(build(BASE), OPTS).find((x) => x.phase === 'complete');
  assert.equal(s.zone.state, 'filled');
  assert.equal(s.zone.filledLegs, 1);
  assert.ok(Math.abs(s.zone.entry - NEAR) < 1e-9);
  // Stop varsayılanı: dalga 1 başı (0) − tampon
  assert.ok(s.zone.stop < 99.7 && s.zone.stop > 99);
  assert.ok(s.zone.rr > 0);
  assert.deepEqual(activePlans(s, OPTS).map((p) => p.type).sort(), ['break', 'zone']);
  // Uzak kenar girişi seçilirse emir dolmaz → bölge kaçtı
  const far = findWave3Setups(build(BASE), { ...OPTS, zoneEntry: 'far' }).find((x) => x.phase === 'complete');
  assert.equal(far.zone.state, 'missed');
  assert.deepEqual(activePlans(far, OPTS).map((p) => p.type), ['break']);
});

test('B kırılımı modunda bölge hesaplanmaz, bölge modunda B planı aktif sayılmaz', () => {
  const b = findWave3Setups(build(BASE), { sensitivities: [4.5], entryType: 'break' });
  assert.equal(b.length, 1);
  assert.equal(b[0].zone, null);
  const z = findWave3Setups(build(BASE), { sensitivities: [4.5], entryType: 'zone' }).find((x) => x.phase === 'complete');
  assert.deepEqual(activePlans(z, { entryType: 'zone' }).map((p) => p.type), ['zone']);
});

test('%88,6 stop seçilirse uzak kenar stop\'un ötesinde kalır → bölge planı yok', () => {
  const s = findWave3Setups(build(BASE), { ...OPTS, zoneStop: 'r886' }).find((x) => x.phase === 'complete');
  assert.equal(s.zone, null);
});

test('dalga 2 sürüyor: C oluşurken bölge bekleniyor, yakın kenara gelince doldu', () => {
  const waiting = findWave3Setups(build([[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [66, 112]]), OPTS)
    .find((x) => x.phase === 'forming');
  assert.ok(waiting, 'süren dalga 2 bulunmalı');
  assert.equal(waiting.direction, 'long');
  assert.equal(waiting.zone.state, 'waiting');
  assert.equal(waiting.points.p2, null);
  assert.ok(Math.abs(waiting.zone.near - NEAR) < 1e-9);

  const filled = findWave3Setups(build([[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [68, 110.5]]), OPTS)
    .find((x) => x.phase === 'forming');
  assert.equal(filled.zone.state, 'filled');
});

test('süre koşulu: süre(2) > süre(1) dolmadan bölgeye gelinirse emir sayılmaz', () => {
  const path = [[0, 120], [20, 100], [40, 130], [52, 115], [60, 122], [68, 110.5]];
  // minTimeRatio 1,5 → emir bar 39 + 30 + 1 = 70'ten itibaren aktif; dip bar 67'de
  const req = findWave3Setups(build(path), { ...OPTS, minTimeRatio: 1.5 }).find((x) => x.phase === 'forming');
  assert.equal(req.zone.state, 'waiting');
  assert.equal(req.zone.pendingTime, true);
  assert.equal(req.zone.activeFrom, 70);
  const ign = findWave3Setups(build(path), { ...OPTS, minTimeRatio: 1.5, zoneTime: 'ignore' }).find((x) => x.phase === 'forming');
  assert.equal(ign.zone.state, 'filled');
});
