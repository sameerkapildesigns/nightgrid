import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambientGains, engineGains, AMBIENT } from '../../src/client/audio-mix.js';

// pre-R2 formulas copied from AU.engine (game.js, baseline d60cfa9)
const pre = (s01, thr, boost) => ({ body: 0.09 + thr * 0.07 + s01 * 0.06 + boost * 0.05, whine: 0.006 + s01 * 0.018 + boost * 0.03 });

test('ambient toggle: on = pre-R2 levels, off = silent', () => {
  assert.deepEqual(ambientGains(true), { hum: 0.22, rain: 0.035 });
  assert.deepEqual(ambientGains(false), { hum: 0, rain: 0 });
  assert.equal(AMBIENT.hum, 0.22);
});

test('engine idle on reproduces pre-R2 exactly', () => {
  for (const s of [0, 0.1, 0.5, 1, 1.3]) for (const t of [0, 0.5, 1]) for (const b of [0, 1]) {
    const a = engineGains(s, t, b, true), p = pre(s, t, b);
    assert.ok(Math.abs(a.body - p.body) < 1e-12 && Math.abs(a.whine - p.whine) < 1e-12);
  }
});

test('engine idle off: silent when parked/menus, identical once driving', () => {
  assert.deepEqual(engineGains(0, 0, 0, false), { body: 0, whine: 0 });
  for (const [s, t] of [[0.2, 0], [0.5, 0], [0, 1], [1, 1]]) {
    const a = engineGains(s, t, 0, false), p = pre(s, t, 0);
    assert.ok(Math.abs(a.body - p.body) < 1e-12, `${s},${t}`);
  }
  assert.ok(engineGains(0.05, 0, 0, false).body < pre(0.05, 0, 0).body);
});
