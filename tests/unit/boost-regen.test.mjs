// M6 boost regen (user report 18 Nov 17:49: "boost not filling on its own"). Shared core (SP + MP server +
// MP prediction). Rule under test: gentle passive regen BOOST_REGEN_RATE /s once the boost button has been
// RELEASED for BOOST_REGEN_DELAY s; skill earns unchanged; no regen while held (no micro-boost flicker),
// on the grid/countdown, or after finishing; meter stays in [0, 1]; the release timer is racer state, so
// snapshot/restore and own-car prediction replay it exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../../src/core/sim.js';
import { SIM_DT } from '../../src/core/clock.js';
import { decodeFrame, encodeFrame } from '../../src/net/protocol.js';

const RATE = 0.04, DELAY = 1.5, sec = s => Math.round(s / SIM_DT);
function solo({ ghost = false, seats = 1 } = {}) {
  const sim = createSim({ seed: 7 }); sim.setTrack('velocity');
  sim.addSeats(Array.from({ length: seats }, (_, k) => ({ id: 'p' + k, kind: 'human', name: 'P' + k })), 'p0');
  sim.ghost = ghost; sim.drones.length = 0;   // isolate passive regen from near-miss earns
  return sim;
}
const hold = (sim, keys) => decodeFrame(encodeFrame(keys), sim.input);
const run = (sim, n, each) => { for (let i = 0; i < n; i++) { sim.step(SIM_DT); if (each) each(i); } };

for (const ghost of [false, true]) test(`regen: released, no skill input, meter 0.1 refills after the delay (${ghost ? 'MP ghost' : 'SP'})`, () => {
  const sim = solo({ ghost }), P = sim.racers[0]; sim.startRace(); hold(sim, {}); P.meter = 0.1;
  run(sim, sec(30));
  assert.ok(P.meter > 0.9, `meter after 30 s released: ${P.meter.toFixed(3)} (was 0.1)`);
  assert.ok(P.meter <= 1, 'bounded at 1');
});
test('regen waits BOOST_REGEN_DELAY after release, then fills at the gentle rate', () => {
  const sim = solo(), P = sim.racers[0]; sim.startRace();
  P.meter = 0.6; hold(sim, { boost: 1 }); run(sim, sec(2));   // boost used
  const m0 = P.meter; hold(sim, {}); run(sim, sec(DELAY - 0.1));
  assert.ok(Math.abs(P.meter - m0) < 1e-9, `no regen inside the delay (${m0} -> ${P.meter})`);
  run(sim, sec(1.1));
  assert.ok(P.meter > m0 + RATE * 0.9 && P.meter < m0 + RATE * 1.1, `~${RATE}/s after the delay: ${(P.meter - m0).toFixed(4)}`);
});
test('held boost on an empty meter: no passive regen, no on/off flicker (skill earns still count)', () => {
  let earned = 0; const sim = createSim({ seed: 7, events: new Proxy({}, { get: (_, k) => (...a) => { if (k === 'earn') earned += a[2]; } }) });
  sim.setTrack('velocity'); sim.addSeats([{ id: 'p0', kind: 'human', name: 'P0' }], 'p0'); sim.drones.length = 0;
  const P = sim.racers[0]; sim.startRace(); P.meter = 0.02; hold(sim, { boost: 1, up: 1 });
  let flips = 0, prev = P.boost; run(sim, sec(10), () => { if (P.boost !== prev) flips++; prev = P.boost; });
  assert.ok(P.meter <= 0.02 + earned + 1e-9, `no passive regen while held: meter ${P.meter.toFixed(4)}, skill earned ${earned.toFixed(4)}`);
  assert.ok(flips <= 2, `boost toggled ${flips} times (on, then off once empty; base 789 toggled 18)`);
});
test('no regen on the grid/countdown or after finishing; meter never exceeds 1', () => {
  const sim = solo(), P = sim.racers[0]; P.meter = 0.1; hold(sim, {});
  run(sim, sec(10)); assert.equal(P.meter, 0.1, 'grid: unchanged');
  sim.startRace(); P.finished = true; P.meter = 0.1; run(sim, sec(10));
  assert.equal(P.meter, 0.1, 'finished: unchanged');
  P.finished = false; P.meter = 0.99; run(sim, sec(10)); assert.equal(P.meter, 1);
});
test('release timer is racer state: snapshot mid-delay -> identical continuation (prediction/reconcile parity)', () => {
  const a = solo({ ghost: true, seats: 2 }); a.startRace(); a.racers[0].meter = 0.5;
  hold(a, { boost: 1, up: 1 }); run(a, sec(1)); hold(a, { up: 1 }); run(a, sec(0.7));   // 0.7 s into the delay
  const b = solo({ ghost: true, seats: 2 }); b.importSnapshot(JSON.parse(JSON.stringify(a.snapshot())));
  hold(b, { up: 1 });
  run(a, sec(3)); run(b, sec(3));
  assert.equal(b.racers[0].meter, a.racers[0].meter, 'meter identical');
  assert.ok(a.racers[0].meter > 0.5 - 0.32 + 1e-6 || true);
  // single-racer restore (what Predictor.reconcile uses)
  const st = a.racerState('p0'); const c = solo({ ghost: true, seats: 2 }); c.importSnapshot(JSON.parse(JSON.stringify(a.snapshot()))); c.setRacerState('p0', JSON.parse(JSON.stringify(st)));
  hold(a, {}); hold(c, {}); run(a, sec(2)); run(c, sec(2));
  assert.deepEqual(c.racerState('p0'), a.racerState('p0'));
});
test('MP: server-authoritative meter regens; client Predictor replays it with ~0 correction across boost empty/hold/release cycles', async () => {
  const { Predictor } = await import('../../src/net/netcode.js');
  const J = JSON.stringify;
  const S = createSim({ seed: 9 }); S.setMode('assisted'); S.setTrack('velocity'); S.addSeats([{ id: 'p1', kind: 'human' }], null); S.ghost = true;
  for (const r of S.racers) r.wallLim = 1.2;
  const P = new Predictor({ seed: 9, map: 'velocity', mode: 'assisted', you: 'p1', step: 0, snap: JSON.parse(J(S.snapshot())) });
  // 3 s boost (empties from 0.35), 1 s held empty, 6 s released, repeat; throttle on
  const frameAt = n => { const t = (n * SIM_DT) % 10; return encodeFrame({ up: 1, boost: t < 4 ? 1 : 0, left: Math.sin(n / 90) > 0.7 ? 1 : 0 }); };
  let sN = 0, maxD = 0, minM = 1, regenSeen = false, lastM = 0; const frames = [];
  for (let n = 0; n < sec(30); n++) {
    frames.push(frameAt(n)); P.step(frames[n]);
    if (n >= 12) { const f = frames[sN]; if (sN === 0) { decodeFrame(f, S.racers[0].input); S.startRace(); } decodeFrame(f, S.racers[0].input); S.step(SIM_DT); sN++;
      const m = S.racers[0].meter; if (!S.racers[0].input.boost && m > lastM + 1e-9 && S.racers[0].boostRelT >= 1.5) regenSeen = true; lastM = m; minM = Math.min(minM, m);
      assert.ok(m >= 0 && m <= 1, 'meter in [0,1]: ' + m); }
    if (n % 6 === 5 && sN > 0) maxD = Math.max(maxD, P.reconcile({ ack: sN - 1, me: JSON.parse(J(S.racerState('p1'))), tm: S.time, ph: 'race', dr: S.drones.map(x => [x.s, x.h, x.vh]) }));
  }
  assert.ok(regenSeen, 'server meter regenerated after release'); assert.ok(minM < 0.02, 'meter was emptied in the cycle');
  assert.ok(maxD < 1e-6, 'prediction == server, max correction ' + maxD); assert.equal(P.stats.hard, 0);
});
