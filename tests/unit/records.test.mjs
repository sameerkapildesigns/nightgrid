import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLap, minPlausibleLap, createRecordStore, memoryStorage, RECORD_PREFIX, MAX_LAP_SPEED } from '../../src/core/records.js';
import { buildTrackData, MAP_KEYS } from '../../src/core/maps.js';

const L = Object.fromEntries(MAP_KEYS.map(k => [k, buildTrackData(k).LAPLEN]));
const ok = (map, time, integrity = {}) => validateLap({ time, lapLen: L[map], integrity });

test('physics bound: laps faster than 140 m/s average are impossible', () => {
  assert.equal(MAX_LAP_SPEED, 140);
  for (const k of MAP_KEYS) { const m = minPlausibleLap(L[k]); assert.equal(ok(k, m * 0.99).reason, 'faster-than-physics'); assert.equal(ok(k, m * 1.01).ok, true); }
  assert.equal(ok('velocity', 40).ok, false);   // the 40 s lap written by v5b's automated flow test
  assert.equal(ok('technical', 40).ok, true);   // 40 s on the 2.4 km Kage circuit is a real AI-pace lap
});
test('integrity flags reject teleported, autopilot and debug laps', () => {
  assert.equal(ok('legacy', 70, { teleport: true }).reason, 'position-jump');
  assert.equal(ok('legacy', 70, { autopilot: true }).reason, 'autopilot');
  assert.equal(ok('legacy', 70, { debug: true }).reason, 'debug-session');
});
test('garbage values are rejected', () => { for (const t of [NaN, Infinity, -1, 0, 1e9, '60']) assert.equal(validateLap({ time: t, lapLen: 5000 }).ok, false); });

test('store: keeps only faster valid laps, ignores polluted stored values, never throws', () => {
  const mem = memoryStorage(); mem.setItem(RECORD_PREFIX + 'velocity', '40'); mem.setItem('nightgrid_v2_best', 'banana');
  const st = createRecordStore(mem, { lapLenOf: k => L[k] });
  assert.equal(st.get('velocity'), Infinity); assert.equal(st.get('legacy'), Infinity);
  assert.ok(st.rejected.some(r => r.reason === 'faster-than-physics'));
  assert.deepEqual(st.offer('velocity', { time: 66, lapLen: L.velocity }), { saved: true, reason: null });
  assert.equal(st.get('velocity'), 66);
  assert.equal(st.offer('velocity', { time: 70, lapLen: L.velocity }).reason, 'not-faster');
  assert.equal(st.offer('velocity', { time: 20, lapLen: L.velocity }).reason, 'faster-than-physics');
  assert.equal(st.offer('velocity', { time: 60, lapLen: L.velocity, integrity: { debug: true } }).saved, false);
  assert.equal(st.get('velocity'), 66);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const st2 = createRecordStore(broken, { lapLenOf: k => L[k] });
  assert.equal(st2.get('velocity'), Infinity); assert.equal(st2.offer('velocity', { time: 66, lapLen: L.velocity }).reason, 'storage-error');
});
test('legacy key from v3 is still honoured when plausible', () => {
  const mem = memoryStorage(); mem.setItem('nightgrid_v2_best', '75.5');
  assert.equal(createRecordStore(mem, { lapLenOf: k => L[k] }).get('legacy'), 75.5);
});
