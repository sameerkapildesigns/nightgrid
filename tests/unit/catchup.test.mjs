// R2 catch-up assist: bounded, solo-only, deterministic, never-record-eligible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../../src/core/sim.js';
import { SIM_DT } from '../../src/core/clock.js';
import { Vec3 } from '../../src/core/vec.js';
import { validateLap } from '../../src/core/records.js';
import { CATCHUP, catchupMul, gapToCarAhead, catchupEligible, updateCatchup } from '../../src/core/catchup.js';

const mk = () => new Vec3();
const P = CATCHUP.progPerSec;

test('multiplier: none near the pack, smooth ramp, hard cap', () => {
  for (const g of [-30, -1, 0, 2, CATCHUP.startSec-.01, CATCHUP.startSec]) assert.equal(catchupMul(g), 1, `gap ${g}`);
  assert.ok(catchupMul(CATCHUP.startSec + 0.01) > 1);
  assert.equal(catchupMul(CATCHUP.fullSec), 1 + CATCHUP.maxCap);
  for (const g of [CATCHUP.fullSec, 60, 1e6, Infinity]) assert.equal(catchupMul(g), 1 + CATCHUP.maxCap, `cap at ${g}`);
  let prev = 1;
  for (let g = 0; g <= 30; g += 0.25) { const m = catchupMul(g); assert.ok(m >= prev && m <= 1 + CATCHUP.maxCap); prev = m; }
  assert.equal(catchupMul(NaN), 1);
});

test('gap: ahead / near / far behind; finished racers ignored', () => {
  const me = { prog: 1000 };
  assert.equal(gapToCarAhead([me, { prog: 900 }, { prog: 500 }], me), 0, 'leading');
  assert.equal(gapToCarAhead([me, { prog: 1000 + 3 * P }], me), 3, 'near');
  assert.equal(gapToCarAhead([me, { prog: 1000 + 20 * P }, { prog: 1000 + 30 * P }], me), 20, 'nearest car ahead, not the leader');
  assert.equal(gapToCarAhead([me, { prog: 1000 + 20 * P, finished: true }], me), 0, 'finished cars do not count');
});

function fake({ ghost = false, catchup = true, humans = 1, gap = 20 } = {}) {
  const racers = [];
  for (let i = 0; i < humans; i++) racers.push({ isAI: false, prog: 1000 - i, lapIntegrity: {} });
  racers.push({ isAI: true, prog: 1000 + gap * P });
  return { ghost, catchup, racers };
}

test('eligibility: solo only; rooms (ghost), opt-out and multi-human sims get nothing', () => {
  assert.equal(catchupEligible(fake()), true);
  for (const s of [fake({ ghost: true }), fake({ catchup: false }), fake({ humans: 2 })]) {
    assert.equal(catchupEligible(s), false);
    updateCatchup(s);
    for (const r of s.racers) if (!r.isAI) { assert.equal(r.catchMul, 1); assert.notEqual(r.lapIntegrity.assist, true); }
  }
});

test('update: behind gets the capped boost and taints the lap; near and ahead get none', () => {
  const far = fake({ gap: CATCHUP.fullSec }); updateCatchup(far);
  assert.equal(far.racers[0].catchMul, 1 + CATCHUP.maxCap); assert.equal(far.racers[0].lapIntegrity.assist, true);
  const near = fake({ gap: CATCHUP.startSec }); updateCatchup(near);
  assert.equal(near.racers[0].catchMul, 1); assert.notEqual(near.racers[0].lapIntegrity.assist, true);
  const ahead = fake({ gap: -10 }); updateCatchup(ahead);
  assert.equal(ahead.racers[0].catchMul, 1);
  assert.equal(validateLap({ time: 90, lapLen: 4000, integrity: { assist: true } }).reason, 'catch-up-assist');
});

// ---- whole-sim checks with an input-only driver (same controller as sim.test.mjs) ----
// `limit` caps the driver's own target speed to model a struggling player.
function solo(map, { seed = 4242, catchup = true, ghost = false, limit = 85, seconds = 120, laps = Infinity } = {}) {
  const sim = createSim({ seed }); sim.setTrack(map); sim.addRacers(['GHOST', 'VEX', 'BLITZ'].map(name => ({ name })));
  sim.catchup = catchup; sim.ghost = ghost;
  sim.input.up = 1; sim.startRace();
  const p = sim.player; let maxMul = 1, assistSteps = 0, steps = 0;
  for (let n = 0; n < seconds / SIM_DT && p.lap < laps && !p.finished; n++) {
    const f = sim.frameAt(p.path, p.s + 10, { P: mk(), T: mk(), U: mk(), R: mk() });
    const kg = f.path.KG[f.i], psiT = Math.asin(Math.max(-0.5, Math.min(0.5, p.d * 0.05))) + kg * 8, e = psiT - p.psi;
    sim.input.left = e > 0.03 ? 1 : 0; sim.input.right = e < -0.03 ? 1 : 0;
    sim.input.up = p.speed < limit ? 1 : 0; sim.input.down = p.speed > limit + 10 ? 1 : 0;
    sim.step(SIM_DT); steps++;
    if (p.catchMul > maxMul) maxMul = p.catchMul;
    if (p.catchMul > 1) assistSteps++;
  }
  return { sim, p, maxMul, assistShare: assistSteps / steps };
}
const aiState = sim => sim.racers.filter(r => r.isAI).map(r => [r.name, r.prog.toFixed(6), r.speed.toFixed(6)]);

test('sim: a struggling solo player gets the bounded assist and its laps are not record-eligible', () => {
  const { p, maxMul } = solo('legacy', { limit: 55, seconds: 150, laps: 1 });
  assert.ok(maxMul > 1, 'assist engaged');
  assert.ok(maxMul <= 1 + CATCHUP.maxCap + 1e-12, `capped (${maxMul})`);
  if (p.lap >= 1) assert.equal(p.lapValid[0], false);
});

test('sim: private rooms (ghost) and opt-out never engage, even far behind', () => {
  for (const o of [{ ghost: true }, { catchup: false }]) {
    const { p, maxMul } = solo('legacy', { limit: 55, seconds: 60, ...o });
    assert.equal(maxMul, 1, JSON.stringify(o)); assert.equal(p.catchMul, 1);
  }
});

test('sim: near the pack the assist is bit-identical to off (NPC baseline preserved)', () => {
  // first 8 s: everyone is within the startSec window off the grid
  const on = solo('legacy', { seconds: 8, catchup: true }), off = solo('legacy', { seconds: 8, catchup: false });
  assert.equal(on.maxMul, 1);
  assert.deepEqual(aiState(on.sim), aiState(off.sim));
  assert.equal(on.p.prog.toFixed(9), off.p.prog.toFixed(9));
});

test('sim: deterministic for the same seed and inputs', () => {
  const a = solo('legacy', { limit: 55, seconds: 45 }), b = solo('legacy', { limit: 55, seconds: 45 });
  assert.equal(a.p.prog, b.p.prog); assert.equal(a.p.catchMul, b.p.catchMul);
  assert.deepEqual(aiState(a.sim), aiState(b.sim));
});

test('sim: NPC code path unchanged; NPCs never read the assist', () => {
  const { sim } = solo('legacy', { limit: 55, seconds: 30 });
  for (const r of sim.racers) if (r.isAI) assert.equal(r.catchMul, 1);
});

test('snapshot preserves solo recovery flag and deterministic continuation',()=>{const a=createSim();a.setTrack('velocity');a.addRacers([{name:'GHOST'}]);a.catchup=true;a.startRace();a.input.up=1;for(let i=0;i<150;i++)a.step(SIM_DT);const b=createSim();b.importSnapshot(JSON.parse(JSON.stringify(a.snapshot())));assert.equal(b.catchup,true);for(let i=0;i<120;i++){a.step(SIM_DT);b.step(SIM_DT);}assert.equal(a.player.prog,b.player.prog);assert.equal(a.player.catchMul,b.player.catchMul);});
