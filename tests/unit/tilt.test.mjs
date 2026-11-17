// Simulated tilt math only. Physical iPhone/Android calibration is unverified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTilt, axisFor } from '../../src/core/tilt.js';
test('axis/sign mirror between the two landscape orientations; portrait inactive', () => {
  assert.equal(axisFor({ beta: 10, gamma: 0 }, 90), 10);
  assert.equal(axisFor({ beta: 10, gamma: 0 }, 270), -10);
  assert.equal(axisFor({ beta: 10, gamma: 0 }, -90), -10);
  assert.equal(axisFor({ beta: 10, gamma: 0 }, 0), null);
  assert.equal(axisFor({ beta: null, gamma: null }, 90), null);   // permission-less / no-sensor events
});
test('relative to recentred neutral, deadzone, full lock, clamped', () => {
  const t = createTilt({ smoothing: 0 });
  t.recenter({ beta: 20, gamma: 5 }, 90);
  assert.equal(t.update({ beta: 22, gamma: 5 }, 90), 0);                 // inside 3 deg deadzone
  assert.ok(Math.abs(t.update({ beta: 20 + 13.5, gamma: 5 }, 90) - 0.5) < 1e-9);
  assert.equal(t.update({ beta: 80, gamma: 5 }, 90), 1);                 // clamped
  assert.equal(t.update({ beta: -40, gamma: 5 }, 90), -1);
});
test('smoothing approaches target; reset zeroes steering', () => {
  const t = createTilt({ smoothing: 0.5 }); t.recenter({ beta: 0, gamma: 0 }, 90);
  const a = t.update({ beta: 30, gamma: 0 }, 90), b = t.update({ beta: 30, gamma: 0 }, 90);
  assert.ok(a > 0 && a < b && b < 1);
  t.reset(); assert.equal(t.steer, 0);
  assert.equal(t.update({ beta: 30, gamma: 0 }, 0), 0);                  // portrait -> 0
});
