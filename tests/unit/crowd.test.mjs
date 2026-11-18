// M7 crowd budget: label declutter + remote detail levels (pure planner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCrowd, CROWD } from '../../src/client/crowd.js';

const grid20 = () => Array.from({ length: 19 }, (_, k) => ({ id: 'r' + k, dist: 6 + 4 * k, sx: 480 + ((k % 4) - 1.5) * 30, sy: 300 - Math.floor(k / 4) * 6, onScreen: true }));

test('packed 20-car grid: at most LABEL_MAX labels, none closer than MIN_PX on screen', () => {
  const plan = planCrowd(grid20()), it = grid20().filter(x => plan.get(x.id).label);
  assert.ok(it.length >= 1 && it.length <= CROWD.LABEL_MAX, `${it.length} labels`);
  for (let a = 0; a < it.length; a++) for (let b = a + 1; b < it.length; b++) assert.ok(Math.hypot(it[a].sx - it[b].sx, it[a].sy - it[b].sy) >= CROWD.MIN_PX);
  assert.equal(plan.get('r0').label, true, 'nearest remote keeps its label');
});
test('proxy substitution is OFF by default (awaiting visual approval): a 400 m remote keeps its model (lite)', () => {
  assert.equal(CROWD.PROXY, false);
  const plan = planCrowd([{ id: 'far', dist: 400, sx: 0, sy: 0, onScreen: true }]);
  assert.equal(plan.get('far').detail, 'lite'); assert.equal(plan.get('far').label, false);
});
test('near cars keep full detail; at most FULL_MAX full; (PROXY enabled) beyond FAR_M becomes a proxy', () => {
  const items = grid20().concat([{ id: 'far', dist: 400, sx: 0, sy: 0, onScreen: true }]);
  const plan = planCrowd(items, new Map(), { ...CROWD, PROXY: true }), lv = items.map(x => plan.get(x.id).detail);
  assert.equal(lv.filter(x => x === 'full').length, CROWD.FULL_MAX);
  for (let k = 0; k < CROWD.FULL_MAX; k++) assert.equal(plan.get('r' + k).detail, 'full', 'nearest cars are the full ones');
  assert.equal(plan.get('far').detail, 'far');
  assert.equal(plan.get('far').label, false, 'no label beyond LABEL_M');
});
test('off-screen remotes never get a label', () => {
  const plan = planCrowd([{ id: 'a', dist: 10, sx: 0, sy: 0, onScreen: false }]);
  assert.equal(plan.get('a').label, false);
});
test('hysteresis: a car hovering at the full/far thresholds does not flicker', () => {
  let prev = new Map(), flips = 0, last = null;
  for (let k = 0; k < 200; k++) {
    const d = CROWD.FULL_M + Math.sin(k / 3) * (CROWD.HYST * 0.8);
    const p = planCrowd([{ id: 'x', dist: d, sx: 1, sy: 1, onScreen: true }], prev).get('x').detail;
    if (last && p !== last) flips++; last = p; prev = new Map([['x', p]]);
  }
  assert.ok(flips <= 1, `${flips} detail flips`);
  prev = new Map(); last = null; flips = 0;
  for (let k = 0; k < 200; k++) {
    const d = CROWD.FAR_M + Math.sin(k / 3) * (CROWD.HYST * 0.8);
    const p = planCrowd([{ id: 'x', dist: d, sx: 1, sy: 1, onScreen: true }], prev, { ...CROWD, PROXY: true }).get('x').detail;
    if (last && p !== last) flips++; last = p; prev = new Map([['x', p]]);
  }
  assert.ok(flips <= 1, `${flips} far flips`);
});
test('deterministic tie-break on equal distance', () => {
  const a = planCrowd([{ id: 'b', dist: 5, sx: 0, sy: 0, onScreen: true }, { id: 'a', dist: 5, sx: 1, sy: 1, onScreen: true }]);
  assert.equal(a.get('a').label, true); assert.equal(a.get('b').label, false);
});
