// Regression: the netsim lane (server/local.mjs, test tool) must deliver in send order like one WebSocket
// stream, even with jitter. The old per-message setTimeout version delivered lobby v10 after v11..v13
// (tests/net/m8-rounds.mjs n=8 'canStart' timeout: host kept a stale room where 3 humans were not ready).
import test from 'node:test';
import assert from 'node:assert/strict';
import { netLane } from '../../server/local.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('netsim lane keeps send order under 60 ms lag + 10 ms jitter with bursts', async () => {
  const lane = netLane(() => true, () => Date.now() + Math.max(0, 30 + (Math.random() * 2 - 1) * 5));
  const got = []; let n = 0;
  for (let burst = 0; burst < 60; burst++) {
    const k = 1 + Math.floor(Math.random() * 8);
    for (let i = 0; i < k; i++) { const v = n++; lane(() => got.push(v)); }
    await sleep(Math.floor(Math.random() * 4));
  }
  await sleep(200);
  assert.equal(got.length, n);
  assert.deepEqual(got, [...got].sort((a, b) => a - b));
});

test('netsim lane holds messages through an outage, still in order', async () => {
  const until = Date.now() + 40;
  const lane = netLane(() => true, () => Date.now() + 2, () => until);
  const got = [];
  for (let i = 0; i < 20; i++) lane(() => got.push([i, Date.now()]));
  await sleep(120);
  assert.deepEqual(got.map(x => x[0]), [...Array(20).keys()]);
  assert.ok(got.every(x => x[1] >= until - 1));
});

test('netsim lane is a pass-through when netsim is off', () => {
  const lane = netLane(() => false, () => Date.now() + 1000); let ran = false;
  lane(() => { ran = true; }); assert.equal(ran, true);
});
