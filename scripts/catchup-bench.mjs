// R2 catch-up bench: full solo races with the input-only driver (sim.test.mjs controller),
// assist on vs off. To model a player who lost time (crash, bad start), the driver waits
// `delay` seconds on the grid, then drives toward target speed `limit`.
// Prints finish time, position and gap to the last NPC. The driver is a crude model, not a human.
// Usage: node scripts/catchup-bench.mjs [map ...]
import { createSim } from '../src/core/sim.js';
import { SIM_DT } from '../src/core/clock.js';
import { Vec3 } from '../src/core/vec.js';
const mk = () => new Vec3();
const maps = process.argv.slice(2).length ? process.argv.slice(2) : ['legacy', 'velocity', 'technical'];

function run(map, limit, catchup, delay = 0, seed = 4242) {
  const sim = createSim({ seed }); sim.setTrack(map); sim.addRacers(['GHOST', 'VEX', 'BLITZ'].map(name => ({ name })));
  sim.catchup = catchup; sim.input.up = 1; sim.startRace();
  const p = sim.player; let assist = 0, n = 0, lastNpcT = null, gapAtLastNpc = null;
  for (; n < 900 / SIM_DT && !p.finished; n++) {
    const f = sim.frameAt(p.path, p.s + 10, { P: mk(), T: mk(), U: mk(), R: mk() });
    const kg = f.path.KG[f.i], psiT = Math.asin(Math.max(-0.5, Math.min(0.5, p.d * 0.05))) + kg * 8, e = psiT - p.psi;
    sim.input.left = e > 0.03 ? 1 : 0; sim.input.right = e < -0.03 ? 1 : 0;
    const waiting = sim.raceTime() < delay;
    sim.input.up = !waiting && p.speed < limit ? 1 : 0; sim.input.down = waiting || p.speed > limit + 10 ? 1 : 0;
    sim.step(SIM_DT);
    if (p.catchMul > 1) assist++;
    const ai = sim.racers.filter(r => r.isAI);
    if (lastNpcT === null && ai.every(r => r.finished)) { lastNpcT = sim.raceTime(); }
  }
  const pos = sim.finishOrder.indexOf(p) + 1;
  return { t: p.finished ? p.finishTime : null, pos: pos || null, lastNpcT, assistPct: (100 * assist / n).toFixed(0) };
}
for (const map of maps) for (const [limit, delay] of [[85, 0], [85, 15], [85, 30], [999, 0], [999, 15], [999, 30]]) {
  const off = run(map, limit, false, delay), on = run(map, limit, true, delay);
  const fmt = r => `t=${r.t?.toFixed(1) ?? 'DNF'} P${r.pos ?? '-'} lastNPC=${r.lastNpcT?.toFixed(1) ?? '-'} gapToLast=${r.t && r.lastNpcT ? (r.t - r.lastNpcT).toFixed(1) : '-'}s assist=${r.assistPct}%`;
  console.log(`${map.padEnd(9)} drv<${limit} wait${delay}s  OFF ${fmt(off)}  |  ON ${fmt(on)}`);
}
