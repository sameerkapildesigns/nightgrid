import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClock, createFpsMeter, SIM_DT } from '../../src/core/clock.js';

const run = (c, frameSec, totalSec, ts = 1) => { let sim = 0; const n = Math.round(totalSec / frameSec); for (let i = 0; i < n; i++) sim += c.advance(frameSec, ts).simDt; return sim; };
const near = (a, b, eps = SIM_DT + 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('sim time tracks wall time at 60, 20, 10, 5 and 4 FPS (no slow motion)', () => {
  for (const fps of [60, 20, 10, 5, 4]) { const c = createClock(); near(run(c, 1 / fps, 10), 10); assert.equal(c.droppedMs, 0, fps + ' fps drops nothing'); }
});
test('v5b behaviour for contrast: capping dt at 50 ms halves race time at 10 FPS', () => {
  let t = 0; for (let i = 0; i < 100; i++) t += Math.min(0.05, 0.1); assert.equal(+t.toFixed(6), 5);
});
test('fixed step size and bounded catch-up per frame', () => {
  const c = createClock(); const r = c.advance(0.2); assert.equal(r.h, SIM_DT); assert.equal(r.steps, 24);
  const r2 = c.advance(0.6); assert.ok(r2.steps <= Math.ceil(0.25 / SIM_DT) + 1); near(r2.simDt, 0.25); near(r2.dropped, 0.35, 1e-9);
  near(c.droppedMs, 350, 1e-6);
});
test('a long gap is a stall: nothing simulated, gap reported', () => {
  const c = createClock(); c.advance(0.1);
  const r = c.advance(5); assert.equal(r.stalled, true); assert.equal(r.steps, 0); assert.equal(c.stalls, 1); near(c.lastStallMs, 5000, 1e-6);
  const r2 = c.advance(1 / 60); assert.equal(r2.stalled, false);   // resumes normally afterwards
  near(c.simTime, 0.1 + 1 / 60);
});
test('time scale (finish slow motion) scales simulated time only', () => { const c = createClock(); near(run(c, 1 / 30, 3, 0.3), 0.9); });
test('zero / negative / NaN frame times are ignored', () => { const c = createClock(); for (const v of [0, -1, NaN, undefined]) assert.equal(c.advance(v).steps, 0); assert.equal(c.wallTime, 0); });
test('FPS meter reports real low frame rates (v5b could not report below 20)', () => {
  const m = createFpsMeter(1); for (let i = 0; i < 30; i++) m.frame(0.1); assert.ok(Math.abs(m.fps - 10) < 0.01, String(m.fps));
});
