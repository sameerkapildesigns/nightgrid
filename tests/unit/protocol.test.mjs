import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import * as P from '../../src/net/protocol.js';
import { createBudget } from '../../src/net/budget.js';
const J = JSON.stringify;

test('input frame encode/decode round-trips every key and analogue steer in hundredths', () => {
  for (const up of [0, 1]) for (const down of [0, 1]) for (const boost of [0, 1]) for (const drift of [0, 1]) for (const st of [-1, -0.37, 0, 0.5, 1]) {
    const f = P.encodeFrame({ up, down, boost, drift, left: st < 0 ? -st : 0, right: st > 0 ? st : 0 });
    assert.ok(P.validFrame(f)); const k = P.decodeFrame(f);
    assert.deepEqual([k.up, k.down, k.boost, k.drift], [up, down, boost, drift]); assert.equal(+(k.right - k.left).toFixed(2), st);
  }
  assert.equal(P.validFrame(-1), false); assert.equal(P.validFrame(1.5), false); assert.equal(P.validFrame((201 << 4)), false); assert.equal(P.validFrame(1e9), false);
});
test('parseClient: schema validation, size cap, protocol version, bounded batches', () => {
  assert.equal(P.parseClient('x'.repeat(2000)).error, 'too-large');
  assert.equal(P.parseClient('{nope').error, 'bad-json');
  assert.equal(P.parseClient('[]').error, 'bad-type');
  assert.equal(P.parseClient(J({ t: 'teleport', s: 5 })).error, 'bad-type');
  assert.equal(P.parseClient(J({ t: 'hello', p: 1, build: 'b' })).error, 'protocol-mismatch');
  assert.equal(P.parseClient(J({ t: 'hello', p: 2 })).error, 'bad-hello');
  assert.ok(P.parseClient(J({ t: 'hello', p: 2, build: 'b', name: 'N' })).ok);
  assert.equal(P.parseClient(J({ t: 'in', q: 0, f: [] })).error, 'bad-input');
  assert.equal(P.parseClient(J({ t: 'in', q: 0, f: Array(25).fill(1) })).error, 'bad-input');
  assert.equal(P.parseClient(J({ t: 'in', q: -1, f: [1] })).error, 'bad-input');
  assert.equal(P.parseClient(J({ t: 'in', q: 0, f: [1, 'x'] })).error, 'bad-input');
  assert.equal(P.parseClient(J({ t: 'in', q: 0, f: [99999] })).error, 'bad-input');
  const ok = P.parseClient(J({ t: 'in', q: 7, f: [P.encodeFrame({ up: 1 })], pos: [0, 0, 0], lap: 3 }));
  assert.ok(ok.ok); assert.deepEqual(Object.keys(ok.msg).sort(), ['f', 'q', 't'], 'unknown fields (positions, laps) are dropped');
  assert.equal(P.parseClient(J({ t: 'ready', ready: 'yes' })).error, 'bad-ready');
  assert.equal(P.parseClient(J({ t: 'config', map: 5 })).error, 'bad-config');
  assert.equal(P.parseClient(J({ t: 'car', car: 'wedge', paint: 1.5 })).error, 'bad-car');
});
test('bounds are consistent: max lead < queue-drop bound < time-ahead bound', () => {
  assert.ok(P.MAX_LEAD_FRAMES < P.QUEUE_DROP_FRAMES && P.QUEUE_DROP_FRAMES <= P.MAX_AHEAD_FRAMES);
});
test('token bucket limits rate and refills over time', () => {
  const lim = P.rateLimiter(10, 5); let ok = 0; for (let i = 0; i < 20; i++) if (lim(1000)) ok++; assert.equal(ok, 5);
  assert.equal(lim(1100), true); assert.equal(lim(1100), false); assert.equal(lim(1100 + 1000, 5), true);
});
test('room codes: 6 chars from the readable alphabet, unguessable (CSPRNG), unique in a large sample', () => {
  const g = b => webcrypto.getRandomValues(b); const seen = new Set();
  for (let i = 0; i < 20000; i++) { const c = P.makeRoomCode(g); assert.ok(P.validCode(c), c); seen.add(c); }
  assert.ok(seen.size > 19990); assert.equal(P.validCode('ABCDE'), false); assert.equal(P.validCode('ABCDEI'), false);
  assert.equal(P.normalizeCode(' ab-cd ef '), 'ABCDEF');
  assert.equal(P.makeToken(g).length, 48);
});
test('budget: shared across rooms - capacity cap, daily budget with safety margin, heartbeats charge, lifetime close, UTC day roll', () => {
  const t0 = Date.UTC(2026, 10, 17, 10, 0, 0);
  const b = createBudget({ dailyRoomMs: 60 * 60e3, safety: 0.5, maxActiveRooms: 2, reserveMs: 5 * 60e3, roomMaxLifetimeMs: 20 * 60e3, staleMs: 60 * 60e3 });
  assert.ok(b.admit('A', t0).ok); assert.ok(b.admit('B', t0).ok); assert.equal(b.admit('C', t0).error, 'capacity');
  assert.equal(b.beat('A', t0 + 15 * 60e3).close, undefined); assert.equal(b.state.usedMs, 15 * 60e3);
  assert.equal(b.beat('A', t0 + 21 * 60e3).close, 'lifetime');
  b.release('A', t0 + 21 * 60e3); b.release('B', t0 + 21 * 60e3);   // used 21 + 21 = 42 min > 30 min limit (50% of 60)
  assert.equal(b.admit('C', t0 + 22 * 60e3).error, 'daily-budget');
  assert.ok(b.admit('C', Date.UTC(2026, 10, 18, 0, 0, 1)).ok, 'new UTC day resets usage');
});
test('budget: a room that stops heart-beating is reaped and charged only to its last beat', () => {
  const t0 = Date.UTC(2026, 10, 17); const b = createBudget({ maxActiveRooms: 1, staleMs: 60e3 });
  b.admit('A', t0); b.beat('A', t0 + 30e3); assert.equal(b.admit('B', t0 + 60e3).error, 'capacity');
  assert.ok(b.admit('B', t0 + 100e3).ok); assert.equal(b.state.usedMs, 30e3);
  assert.equal(b.canRace('B', t0 + 100e3).ok, true); assert.equal(b.canRace('nope', t0).ok, false);
});
