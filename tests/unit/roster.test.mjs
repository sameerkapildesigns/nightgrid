import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { CARS, CAR_KEYS, DEFAULT_CAR, RIVAL_LIV, bootLoadOrder, raceCarKeys, isRaceReady } from '../../src/core/roster.js';

test('six approved models, Hypercar default, no Z-32S', () => {
  assert.deepEqual(CAR_KEYS, ['hypercar', 'endurance', 'wedge', 'rally', 'streamliner', 'wipeout']);
  assert.equal(DEFAULT_CAR, 'hypercar');
  assert.ok(!('z32s' in CARS)); assert.ok(!CAR_KEYS.some(k => /z32/i.test(k)));
  for (const k of CAR_KEYS) { const f = new URL(`../../assets/models/${k}.glb`, import.meta.url); assert.ok(existsSync(f) && statSync(f).size > 1e6, k + '.glb present'); }
  assert.ok(!existsSync(new URL('../../assets/models/z32s.glb', import.meta.url)));
});
test('load order: selected car first, then rival cars; nothing else at boot', () => {
  assert.deepEqual(bootLoadOrder('hypercar'), ['hypercar', 'wedge', 'endurance']);
  assert.deepEqual(bootLoadOrder('wipeout'), ['wipeout', 'hypercar', 'wedge', 'endurance']);
  for (const k of CAR_KEYS) { const o = bootLoadOrder(k); assert.equal(o[0], k); assert.ok(o.length <= 4); }
  assert.deepEqual(raceCarKeys('wedge').sort(), ['endurance', 'hypercar', 'wedge']);
  assert.deepEqual(Object.values(RIVAL_LIV).map(r => r.car).sort(), ['endurance', 'hypercar', 'wedge']);
});
test('race readiness needs every race car settled (ok or failed->labelled fallback)', () => {
  const st = { hypercar: 'ok', wedge: 'ok', endurance: 'loading' };
  assert.equal(isRaceReady('hypercar', k => st[k] || 'none'), false);
  st.endurance = 'failed'; assert.equal(isRaceReady('hypercar', k => st[k] || 'none'), true);
  assert.equal(isRaceReady('rally', k => st[k] || 'none'), false);
});
