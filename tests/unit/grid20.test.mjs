// M7: fair grid for up to 20 racers. Implementation-agnostic (measures placed racers), so the same file shows the
// M6 prototype FAIL: its 2-wide rows 14 m apart put the 20th car 126 m behind the front row.
globalThis.NG_PROTO_MAX_SEATS = 20;   // only read by the M6 prototype (repro); ignored by M7
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { createSim } = await import('../../src/core/sim.js');
const { MAX_SEATS } = await import('../../src/core/room.js');
const { MAP_KEYS, S0 } = await import('../../src/core/maps.js');
import { SIM_DT } from '../../src/core/clock.js';

const seats = n => Array.from({ length: n }, (_, k) => ({ id: 'p' + k, kind: k % 3 ? 'bot' : 'human', name: 'R' + k }));
function placed(map, n) {
  const sim = createSim({ seed: 9 }); sim.setTrack(map); sim.addSeats(seats(n)); sim.ghost = true;
  const M = sim.track.MAIN;
  return { sim, M, cars: sim.racers.map(r => ({ back: ((S0 - r.s) % M.L + M.L) % M.L, d: r.d, s: r.s })) };
}

test('room cap is 20', () => assert.equal(MAX_SEATS, 20));

for (const map of MAP_KEYS) {
  test(`${map}: 20-car grid is compact (back row <= 32 m behind the front), inside the walls, no overlap, level`, () => {
    const { M, cars } = placed(map, 20);
    const backs = cars.map(c => c.back), spread = Math.max(...backs) - Math.min(...backs);
    assert.ok(spread <= 32 + 1e-6, `back row ${spread.toFixed(0)} m behind the front row`);
    for (const c of cars) {
      const i = Math.round(c.s / M.ds) % M.N;
      assert.ok(c.d > -M.WL[i] + 2.3 && c.d < M.WR[i] - 2.3, `car at d=${c.d.toFixed(1)} outside walls (${M.WL[i].toFixed(1)})`);
      assert.ok(M.U[i].y > 0.995, `grid spot at ${c.s.toFixed(0)} m not level (U.y ${M.U[i].y.toFixed(3)})`);
      assert.ok(c.s >= 0 && c.s < S0, 'grid stays on the start straight before the line, not across the seam');
    }
    for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
      const A = cars[a], B = cars[b];
      assert.ok(Math.abs(A.back - B.back) >= 7.9 || Math.abs(A.d - B.d) >= 3.6, `cars ${a}/${b} overlap`);
    }
  });
}

test('<= 4 racers keep the v5b grid exactly (single-player parity)', () => {
  const { cars } = placed('velocity', 4);
  assert.deepEqual(cars.map(c => [Math.round(c.back), c.d]), [[14, -4.4], [14, 4.4], [28, -4.4], [28, 4.4]]);
});

test('20 racers (ghost) launch cleanly: 6 s of racing, everyone moving, no crash, lap state sane', () => {
  for (const map of MAP_KEYS) {
    const { sim } = placed(map, 20); sim.startRace();
    for (let n = 0; n < Math.round(6 / SIM_DT); n++) sim.step(SIM_DT);
    for (const r of sim.racers) { assert.ok(!(r.crashed > 0), map + ' crash ' + r.name); assert.ok(r.isAI ? r.speed > 20 : true, map + ' bot stuck ' + r.name); assert.equal(r.lap, 0); }
  }
});
