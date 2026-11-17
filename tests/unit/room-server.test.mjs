// RoomServer integration over fake sockets + a manual clock (no network, no real time).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomServer } from '../../server/room-server.js';
import { fakeTimers, fakeConn, fakeRandom } from '../helpers/fake-timers.mjs';
import { encodeFrame, PROTOCOL, ZERO_FRAME, QUEUE_DROP_FRAMES } from '../../src/net/protocol.js';
import { createBudget } from '../../src/net/budget.js';

const BUILD = 'test-build';
const J = JSON.stringify;
function mk(opts = {}) {
  const T = fakeTimers(); const closed = [];
  const budget = opts.budget || null;
  const S = new RoomServer({ code: 'ABCDEF', build: BUILD, timers: T, random: fakeRandom, budget, onClose: r => closed.push(r), cfg: opts.cfg || {} });
  const run = ms => T.advance(ms, () => S.housekeep());
  return { T, S, closed, run };
}
function player(S, name, extra = {}) {
  const c = fakeConn(); S.connect(c); S.message(c, J({ t: 'hello', p: PROTOCOL, build: BUILD, name, ...extra })); return c;
}
const msg = (S, c, m) => S.message(c, J(m));
const UP = encodeFrame({ up: 1 });
// a client that sends one batch of frames per 50 ms tick starting at seq `from`
function feeder(S, c, frameOf, lead = 12) { let seq = 0; return { tick(step) { const want = step + lead; const f = []; while (seq < want && f.length < 24) f.push(frameOf(seq++)); if (f.length) msg(S, c, { t: 'in', q: seq - f.length, f }); }, get seq() { return seq; } }; }

test('join: server-issued ids + session tokens; build/protocol mismatch rejected with a fatal error; 5th human rejected without breaking the room', () => {
  const { S } = mk();
  const a = player(S, 'Ann'), b = player(S, 'Bob');
  const wa = a.last('welcome'), wb = b.last('welcome');
  assert.equal(wa.id, 'p1'); assert.equal(wb.id, 'p2'); assert.equal(wa.token.length, 48); assert.notEqual(wa.token, wb.token);
  assert.ok(!J(b.out).includes(wa.token), 'a token never reaches another client');
  const bad = fakeConn(); S.connect(bad); msg(S, bad, { t: 'hello', p: PROTOCOL, build: 'old-build', name: 'X' });
  assert.equal(bad.last('error').error, 'build-mismatch'); assert.equal(bad.last('error').fatal, true); assert.ok(bad.closed);
  const old = fakeConn(); S.connect(old); msg(S, old, { t: 'hello', p: 1, build: BUILD }); assert.equal(old.last('error').error, 'protocol-mismatch'); assert.ok(old.closed);
  player(S, 'C'); player(S, 'D'); const e = player(S, 'E');
  assert.equal(e.last('error').error, 'room-full'); assert.ok(e.closed);
  assert.equal(a.last('lobby').room.seats.length, 4); assert.equal(S.room.seats.length, 4);
});
test('messages before hello, malformed and oversized payloads are rejected and counted', () => {
  const { S } = mk(); const c = fakeConn(); S.connect(c);
  msg(S, c, { t: 'ready', ready: true }); assert.equal(c.last('error').error, 'no-hello');
  S.message(c, '{"t":'); S.message(c, 'x'.repeat(5000)); msg(S, c, { t: 'warp', s: 1 });
  assert.deepEqual(S.stats.rejected, { 'no-hello': 1, 'bad-json': 1, 'too-large': 1, 'bad-type': 1 });
});
test('host-only actions are enforced server-side; non-host cannot add bots, configure, start or return to lobby', () => {
  const { S } = mk(); const h = player(S, 'H'), g = player(S, 'G');
  for (const m of [{ t: 'addBot' }, { t: 'config', map: 'legacy' }, { t: 'start' }, { t: 'removeBot', bot: 'bot1' }]) { msg(S, g, m); assert.equal(g.last('error').error, 'not-host', m.t); }
  msg(S, h, { t: 'addBot' }); assert.equal(S.room.seats.length, 3);
  msg(S, h, { t: 'start' }); assert.equal(h.last('error').error, 'not-all-ready');
});
test('ready/start gate, shared countdown, race message carries build/map/mode/seed/seats/snapshot', () => {
  const { S, run } = mk(); const h = player(S, 'H'), g = player(S, 'G');
  msg(S, h, { t: 'config', map: 'technical', mode: 'expert' }); msg(S, g, { t: 'car', car: 'wipeout', paint: 3 });
  msg(S, h, { t: 'ready', ready: true }); msg(S, h, { t: 'start' }); assert.equal(h.last('error').error, 'not-all-ready');
  msg(S, g, { t: 'ready', ready: true }); msg(S, h, { t: 'start' });
  const rh = h.last('race'), rg = g.last('race');
  assert.ok(rh && rg); assert.equal(rh.countdownAt, rg.countdownAt); assert.equal(rh.seed, rg.seed);
  assert.equal(rh.build, BUILD); assert.equal(rh.map, 'technical'); assert.equal(rh.mode, 'expert'); assert.equal(rh.you, 'p1'); assert.equal(rg.you, 'p2');
  assert.deepEqual(rh.seats.map(s => [s.id, s.car, s.paint]), [['p1', 'hypercar', 0], ['p2', 'wipeout', 3]]);
  assert.equal(rh.snap.racers.length, 2); assert.equal(S.ticking, true);
  run(4600); assert.equal(S.room.phase, 'race');
});
function startRace(seatsFn, opts) {
  const ctx = mk(opts); const { S } = ctx; const cs = seatsFn(S);
  for (const c of cs) msg(S, c, { t: 'ready', ready: true }); msg(S, cs[0], { t: 'start' });
  assert.equal(S.room.phase, 'countdown', 'start accepted'); return { ...ctx, cs };
}
test('per-seat input: two humans in one room control only their own cars', () => {
  const { S, run, cs: [a, b] } = startRace(S => [player(S, 'A'), player(S, 'B')]);
  const fa = feeder(S, a, () => UP), fb = feeder(S, b, () => ZERO_FRAME);
  run(4500); for (let i = 0; i < 60; i++) { fa.tick(S.step); fb.tick(S.step); run(50); }
  const [ra, rb] = S.sim.racers; assert.ok(ra.speed > 40, 'A throttles: ' + ra.speed); assert.ok(rb.speed < 1, 'B idle: ' + rb.speed);
  const sa = a.last('s'); assert.equal(sa.me.id, 'p1'); assert.ok(sa.ack > 300); assert.equal(sa.a.length, 2); assert.equal(sa.dr.length, 7);
  assert.equal(b.last('s').me.id, 'p2');
});
test('input integrity: out-of-order / duplicate frames ignored, far-future frames rejected, frame-rate limit, no queue growth beyond the drop bound', () => {
  const { S, run, cs: [a] } = startRace(S => { const h = player(S, 'A'); msg(S, h, { t: 'addBot' }); return [h]; });
  run(4500);
  msg(S, a, { t: 'in', q: 0, f: Array(12).fill(UP) }); run(50);
  const next0 = S.inputs.get('p1').next; assert.ok(next0 > 0);
  msg(S, a, { t: 'in', q: 0, f: Array(6).fill(ZERO_FRAME) }); assert.equal(S.inputs.get('p1').buf.size, 6, 'already-consumed frames ignored (6 unconsumed remain)');
  msg(S, a, { t: 'in', q: 100000, f: [UP] }); assert.equal(a.last('error').error, 'time-ahead');
  let limited = 0; for (let i = 0; i < 20; i++) { msg(S, a, { t: 'in', q: S.inputs.get('p1').next + i * 24, f: Array(24).fill(UP) }); if (a.last('error') && a.last('error').error === 'input-rate') limited++; }
  assert.ok(S.stats.rejected['input-rate'] >= 1, 'input-rate limit hit');
  run(100); assert.ok(S.inputs.get('p1').buf.size <= QUEUE_DROP_FRAMES, 'queue bounded: ' + S.inputs.get('p1').buf.size);
});
test('stale input: a human who stops sending has every input released after 250 ms (no stuck accelerator)', () => {
  const { S, run, cs: [a] } = startRace(S => { const h = player(S, 'A'); msg(S, h, { t: 'addBot' }); return [h]; });
  const fa = feeder(S, a, () => UP); run(4500);
  for (let i = 0; i < 40; i++) { fa.tick(S.step); run(50); }
  const r = S.sim.racers[0]; const v0 = r.speed; assert.ok(v0 > 40);
  run(1500); assert.equal(r.input.up, 0); assert.ok(r.speed < v0 - 5, `coasting down ${v0} -> ${r.speed}`);
});
test('disconnect/reconnect mid-race: token restores the same seat + full race snapshot; expiry after 15 s retires the car (DNF, server AI)', () => {
  const { S, run, cs: [a, b] } = startRace(S => [player(S, 'A'), player(S, 'B')]);
  const tokB = b.last('welcome').token; run(5000);
  S.close(b); assert.equal(S.room.seats[1].connected, false);
  const b2 = fakeConn(); S.connect(b2); msg(S, b2, { t: 'hello', p: PROTOCOL, build: BUILD, name: 'B', token: tokB });
  assert.equal(b2.last('welcome').id, 'p2'); assert.ok(b2.last('race').snap.racers.length === 2, 'reconnect gets full snapshot');
  const stranger = fakeConn(); S.connect(stranger); msg(S, stranger, { t: 'hello', p: PROTOCOL, build: BUILD, name: 'Z', token: 'f'.repeat(48) });
  assert.equal(stranger.last('error').error, 'race-in-progress', 'unknown token cannot take a seat mid-race');
  S.close(b2); run(15500);
  const rb = S.sim.racers[1]; assert.equal(S.room.seats[1].left, true); assert.equal(rb.dnf, true); assert.equal(rb.autopilot, true);
});
test('full 1 human + 3 bots race -> one shared result order -> results -> back to lobby', () => {
  const { S, run, cs: [h] } = startRace(S => { const c = player(S, 'H'); for (let i = 0; i < 3; i++) msg(S, c, { t: 'addBot' }); msg(S, c, { t: 'config', map: 'technical' }); return [c]; });
  run(4500); const me = S.sim.racers[0]; me.autopilot = true; me.pers = { vmax: 92, lat: 84, acc: 26, brake: 46, off: 0, short: 0, aggr: 0, block: 0, boostUse: 0, margin: 4 };
  let n = 0; while (S.room.phase === 'race' && n++ < 6000) { msg(S, h, { t: 'in', q: S.inputs.get('p1').next, f: Array(6).fill(UP) }); run(50); }
  assert.equal(S.room.phase, 'results'); const res = h.last('results');
  assert.equal(res.order.length, 4); assert.deepEqual(res.order.map(o => o.pos), [1, 2, 3, 4]);
  assert.ok(res.order.find(o => o.id === 'p1').finished); assert.equal(S.ticking, false, 'race loop stopped after finish');
  run(20100); assert.equal(S.room.phase, 'lobby'); assert.equal(h.last('lobby').room.seats.filter(s => s.kind === 'bot').length, 3);
});
test('two rooms are isolated: traffic in one never reaches the other', () => {
  const A = mk(), B = mk(); const a = player(A.S, 'A'); const b = player(B.S, 'B'); const nb = b.out.length;
  msg(A.S, a, { t: 'addBot' }); msg(A.S, a, { t: 'name', name: 'Secret' });
  assert.equal(b.out.length, nb); assert.ok(!J(b.out).includes('Secret'));
});
test('teardown: everyone leaves -> room closes after the empty timeout, budget released; idle lobby closes; no timers left', () => {
  const t = mk({ cfg: { emptyCloseMs: 60000 } }); const a = player(t.S, 'A');
  msg(t.S, a, { t: 'leave' }); t.run(61000); assert.deepEqual(t.closed, ['empty']); assert.equal(t.T.pending(), 0);
  const i = mk({ cfg: { lobbyIdleMs: 120000 } }); player(i.S, 'A'); i.run(121000); assert.deepEqual(i.closed, ['idle']); assert.equal(i.closed.length, 1);
});
test('budget: race refused when the shared daily budget is spent', async () => {
  const budget0 = createBudget({ dailyRoomMs: 10 * 60e3, safety: 1, reserveMs: 3 * 60e3, maxActiveRooms: 2, staleMs: 3600e3 });
  const ctx = mk(); const T = ctx.T;
  ctx.S.budget = { beat: c => budget0.beat(c, T.now()), canRace: c => budget0.canRace(c, T.now()), release: c => budget0.release(c, T.now()) };
  assert.ok(budget0.admit('ABCDEF', T.now()).ok);
  const h = player(ctx.S, 'H'); msg(ctx.S, h, { t: 'addBot' }); msg(ctx.S, h, { t: 'ready', ready: true });
  ctx.run(8 * 60e3 + 1000);   // lobby open 8 min: heartbeats charge 8 min; 8 + 3 reserved > 10
  msg(ctx.S, h, { t: 'start' }); await new Promise(r => setImmediate(r));
  assert.equal(h.last('error').error, 'daily-budget'); assert.equal(ctx.S.room.phase, 'lobby');
  assert.ok(budget0.state.usedMs >= 8 * 60e3);
});
test('server tick cost: 4 cars on each map, measured (informational, asserts only a generous ceiling)', () => {
  for (const map of ['velocity', 'technical', 'legacy']) {
    const { S, run, cs } = startRace(S => { const c = player(S, 'H'); for (let i = 0; i < 3; i++) msg(S, c, { t: 'addBot' }); msg(S, c, { t: 'config', map }); return [c]; });
    const f = feeder(S, cs[0], () => UP); run(4500); S.stats.tickMs.length = 0;
    for (let i = 0; i < 200; i++) { f.tick(S.step); run(50); }
    const ms = S.stats.tickMs.slice().sort((x, y) => x - y); const p50 = ms[ms.length >> 1], p95 = ms[Math.floor(ms.length * 0.95)];
    console.log(`# tick cost ${map}: p50 ${p50.toFixed(3)} ms p95 ${p95.toFixed(3)} ms per 50 ms tick (6 steps, 4 cars)`);
    assert.ok(p95 < 25, `${map} p95 ${p95}`);
  }
});
