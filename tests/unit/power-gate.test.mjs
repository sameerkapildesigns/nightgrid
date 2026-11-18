// M8 multiplayer pickup feedback gate: positive feedback only on server-confirmed rising edges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPowerGate, ownFlags } from '../../src/client/power-gate.js';

test('power gate: seeds on first snapshot, fires once per confirmed rising edge, never for a lost contest', () => {
  const g = createPowerGate();
  assert.deepEqual(g.snap(0), []);                 // race start
  assert.deepEqual(g.snap(0), []);                 // lost contest: prediction had a shield, server says 0 -> nothing
  assert.deepEqual(g.snap(1), ['S']);              // won: once
  assert.deepEqual(g.snap(1), []); assert.deepEqual(g.snap(1), []);   // reconnect replays the same state: no duplicate
  assert.deepEqual(g.snap(3), ['B']); assert.deepEqual(g.snap(1), []); assert.deepEqual(g.snap(0), []);
  assert.deepEqual(g.snap(1), ['S']);              // a later, separate claim fires again
  const r = createPowerGate(); assert.deepEqual(r.snap(3), []); assert.equal(r.flags, 3);   // page reload mid-race: seed, no stale flash
  assert.equal(ownFlags({ a: [['p1', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]] }, 'p1'), 2);
  assert.equal(ownFlags({ a: [] }, 'p1'), null);
});
