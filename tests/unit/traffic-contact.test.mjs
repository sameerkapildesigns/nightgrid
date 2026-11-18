// M7: road traffic (drone) contact. Repro for user report 18 Nov 5:59 "taxi road unrealistic collision".
// Base (d158936) collideRacers drone branch: 5.2 x 2.9 box with NO height check, fixed 6 m/s lateral kick added on
// EVERY overlapping 120 Hz tick, random R(-3,3) lateral on tail hits (consumes the sim RNG), droneHit event every tick.
// Drone mesh: 2.6 w x 1.5 h x 5.2 l (game.js makeDrone); racer box half-width 1.4 (racer-racer contact 2.8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../../src/core/sim.js';
import { SIM_DT } from '../../src/core/clock.js';
import { H0 } from '../../src/core/maps.js';

const S = 150;   // Velocity start straight (0..360 m): level, no curvature
function rig({ gap = 10, d = 0, h = H0, va = 60, vd = 0, droneSpeed = 35, laneD = 0 } = {}) {
  const sim = createSim({ seed: 7 }); sim.setTrack('velocity'); sim.addRacers([]);
  sim.startRace();
  const p = sim.player, dr = sim.drones[0]; sim.drones.length = 1;
  dr.s = S; dr.lane = laneD; dr.speed = droneSpeed; dr.h = H0 + 0.1; dr.vh = 0;
  p.s = S - gap; p.d = laneD + d; p.h = h; p.vh = 0; p.va = va; p.vd = vd; p.psi = 0; p.speed = Math.abs(va);
  const hits = []; sim.events = { droneHit: r => hits.push({ t: sim.time, dh: r.h - dr.h, gs: dr.s - r.s, gd: dr.d - r.d }) };
  const trace = [];
  const run = secs => { for (let n = 0; n < Math.round(secs / SIM_DT); n++) { sim.step(SIM_DT); trace.push({ va: p.va, vd: p.vd, d: p.d, s: p.s, h: p.h }); } };
  return { sim, p, dr, hits, trace, run };
}
const peak = (tr, k) => Math.max(...tr.map(x => Math.abs(x[k])));

test('airborne racer passing over a drone does not collide (height check)', () => {
  const t = rig({ h: H0 + 3.5, va: 60, gap: 9 }); t.run(0.4);
  assert.equal(t.hits.length, 0, `phantom hits while ${t.hits[0] && t.hits[0].dh.toFixed(2)} m above the drone`);
  assert.ok(t.p.va > 55, `airborne car lost speed to a drone below it: ${t.p.va.toFixed(1)}`);
});

test('near pass with visible clearance (0.1 m) is not a hit', () => {
  const t = rig({ d: -2.8, va: 60, gap: 10 }); t.run(0.6);
  assert.equal(t.hits.length, 0, 'phantom near-pass hit');
  assert.ok(peak(t.trace, 'vd') < 0.5, `lateral kick ${peak(t.trace, 'vd').toFixed(2)} m/s on a clean pass`);
});

test('low relative velocity side touch: gentle separation, one event at most', () => {
  const t = rig({ d: -2.68, va: 35, vd: 0.3, droneSpeed: 35, gap: 0 }); t.run(0.8);
  assert.ok(t.hits.length <= 1, `${t.hits.length} droneHit events for one touch`);
  assert.ok(peak(t.trace, 'vd') <= 1.5, `lateral speed ${peak(t.trace, 'vd').toFixed(2)} m/s from a 0.3 m/s touch`);
});

test('sideswipe at 4 m/s: bounded restitution, one event, separates', () => {
  const t = rig({ d: -2.75, va: 35, vd: 4, droneSpeed: 35, gap: 0 }); t.run(0.8);
  assert.equal(t.hits.length, 1, `${t.hits.length} droneHit events`);
  const minVd = Math.min(...t.trace.map(x => x.vd));
  assert.ok(minVd < -0.3 && minVd >= -3, `outward lateral speed ${minVd.toFixed(2)} (want 0.3..3)`);
  assert.ok(t.p.d < t.dr.d - 2.6, 'racer ends separated from the drone');
});

test('rear-end at 45 m/s closing: one event, speed bounded to the drone, no RNG side effect', () => {
  const t = rig({ va: 80, gap: 8, droneSpeed: 35 });
  const ctl = rig({ va: 80, gap: 8, droneSpeed: 35 }); ctl.dr.lane = 9;   // same run, drone out of the way
  t.run(1.0); ctl.run(1.0);
  assert.equal(t.hits.length, 1, `${t.hits.length} droneHit events for one rear-end`);
  const after = t.trace.find((x, k) => k > 0 && t.trace[k - 1].va - x.va > 10);
  assert.ok(after && after.va <= 35 + 1 && after.va >= 35 * 0.6, `post-impact speed ${after && after.va.toFixed(1)}`);
  assert.ok(peak(t.trace, 'vd') <= 3.5, `lateral deflection ${peak(t.trace, 'vd').toFixed(2)} m/s`);
  assert.equal(t.sim.rngState, ctl.sim.rngState, 'contact consumed the sim RNG (server/predictor divergence risk)');
});

test('head-on (wrong way into traffic): one event, no repeated bulldozing', () => {
  const t = rig({ va: -30, gap: -8, droneSpeed: 35 }); t.run(1.0);
  assert.ok(t.hits.length === 1, `${t.hits.length} droneHit events`);
  const last = t.trace[t.trace.length - 1];
  assert.ok(last.va >= 35 - 1.5, `after head-on the car still drives into the drone: va ${last.va.toFixed(1)}`);
});

test('determinism: same contact twice and snapshot-resume mid-contact give identical state', () => {
  const a = rig({ va: 80, gap: 8 }), b = rig({ va: 80, gap: 8 });
  a.run(0.12); const sn = JSON.parse(JSON.stringify(a.sim.snapshot()));
  a.run(0.5); b.run(0.62);
  assert.deepEqual(JSON.parse(JSON.stringify(a.sim.snapshot())), JSON.parse(JSON.stringify(b.sim.snapshot())));
  const c = createSim({ seed: 1 }); c.importSnapshot(sn); for (let n = 0; n < Math.round(0.5 / SIM_DT); n++) c.step(SIM_DT);
  assert.deepEqual(JSON.parse(JSON.stringify(c.snapshot())), JSON.parse(JSON.stringify(a.sim.snapshot())));
});
