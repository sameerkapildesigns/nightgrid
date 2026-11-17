import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, MAX_STEP_ADVANCE } from '../../src/core/sim.js';
import { SIM_DT } from '../../src/core/clock.js';
import { MAP_KEYS } from '../../src/core/maps.js';
import { validateLap } from '../../src/core/records.js';
import { Vec3 } from '../../src/core/vec.js';
const mk = () => new Vec3();

const AUTO = { vmax: 92, lat: 84, acc: 26, brake: 46, off: 0, short: 0, aggr: 0, block: 0, boostUse: 0, margin: 4 };
function race(map, { seed = 4242, auto = true, diff = 'normal', maxSec = 600, onStep } = {}) {
  const evs = []; const sim = createSim({ seed, events: new Proxy({}, { get: (_, k) => (...a) => evs.push([k, ...a]) }) });
  sim.setTrack(map); sim.addRacers(['GHOST', 'VEX', 'BLITZ'].map(name => ({ name }))); sim.diff = diff;
  if (auto) { sim.player.autopilot = true; sim.player.pers = AUTO; }
  sim.startRace();
  let n = 0; while (!sim.racers.every(r => r.finished) && n < maxSec / SIM_DT) { if (onStep) onStep(sim, n); sim.step(SIM_DT); n++; }
  return { sim, evs };
}

test('headless race finishes on every map; laps add up; results ordered', () => {
  for (const map of MAP_KEYS) {
    const { sim, evs } = race(map);
    assert.ok(sim.racers.every(r => r.finished), map + ': all finish');
    for (const r of sim.racers) { assert.equal(r.lapTimes.length, sim.track.LAPS); assert.ok(Math.abs(r.lapTimes.reduce((a, b) => a + b, 0) - r.finishTime) < 1e-6); }
    const fin = sim.finishOrder.map(r => r.finishTime); assert.deepEqual(fin, fin.slice().sort((a, b) => a - b));
    assert.deepEqual(sim.ranks(), sim.finishOrder);
    assert.equal(evs.filter(e => e[0] === 'playerFinish').length, 1);
    assert.equal(sim.phase, 'finished');
    // every AI lap is a believable lap
    for (const r of sim.racers.slice(1)) for (const t of r.lapTimes) assert.ok(validateLap({ time: t, lapLen: sim.track.LAPLEN }).ok, `${map} ${r.name} ${t}`);
  }
});
test('deterministic for a given seed', () => {
  const a = race('technical', { seed: 7 }).sim, b = race('technical', { seed: 7 }).sim;
  assert.deepEqual(a.racers.map(r => r.finishTime), b.racers.map(r => r.finishTime));
});
test('Hard rivals are faster than Normal rivals', () => {
  const avg = s => s.racers.slice(1).reduce((a, r) => a + r.finishTime, 0) / 3;
  assert.ok(avg(race('technical', { diff: 'hard' }).sim) < avg(race('technical', { diff: 'normal' }).sim));
});
test('autopilot player laps are flagged and never record-eligible', () => {
  const { sim, evs } = race('velocity');
  assert.deepEqual(sim.player.lapValid, [false, false]);
  for (const [, lap] of evs.filter(e => e[0] === 'lap')) assert.equal(validateLap(lap).ok, false);
});
test('a teleport (forward position jump) taints the lap', () => {
  const { sim } = race('technical', { onStep: (s, n) => { if (n === 1200) { s.racers[1].s += 300; } } });
  assert.equal(sim.racers[1].lapValid[0], false); assert.equal(sim.racers[1].lapValid[1], true);
  assert.ok(MAX_STEP_ADVANCE(SIM_DT) < 300);
});
test('a human-driven player (input-only bot) completes a lap that validates', () => {
  const sim = createSim({ seed: 1 }); sim.setTrack('velocity'); sim.addRacers(['GHOST', 'VEX', 'BLITZ'].map(name => ({ name })));
  const laps = []; sim.events = { lap: l => laps.push(l) };
  sim.input.up = 1; sim.startRace();
  const p = sim.player;
  // drives only through sim.input (keys), like a person: aim back at the centreline with curvature feed-forward
  for (let n = 0; n < 300 / SIM_DT && p.lap < 1; n++) {
    const f = sim.frameAt(p.path, p.s + 10, { P: mk(), T: mk(), U: mk(), R: mk() });
    const kg = f.path.KG[f.i], psiT = Math.asin(Math.max(-0.5, Math.min(0.5, p.d * 0.05))) + kg * 8, e = psiT - p.psi;
    sim.input.left = e > 0.03 ? 1 : 0; sim.input.right = e < -0.03 ? 1 : 0;
    sim.input.up = p.speed < 85 ? 1 : 0; sim.input.down = p.speed > 95 ? 1 : 0;
    sim.step(SIM_DT);
  }
  assert.ok(p.lap >= 1, `completed a lap (prog ${p.prog.toFixed(0)} m)`);
  assert.equal(validateLap(laps[0]).ok, true, JSON.stringify({ t: laps[0].time, i: laps[0].integrity }));
  assert.equal(p.lapValid[0], true);
});
test('countdown launch: throttle held at lights-out gives the perfect launch', () => {
  const sim = createSim(); sim.setTrack('velocity'); sim.addRacers([{ name: 'GHOST' }, { name: 'VEX' }, { name: 'BLITZ' }]);
  sim.input.up = 1; assert.equal(sim.startRace(), true); assert.equal(sim.player.va, 34);
});
test('restart (gridUp) resets race state', () => {
  const { sim } = race('technical');
  sim.gridUp();
  assert.equal(sim.phase, 'grid'); assert.equal(sim.finishOrder.length, 0); assert.ok(sim.racers.every(r => r.lap === 0 && !r.finished && r.lapTimes.length === 0));
});
