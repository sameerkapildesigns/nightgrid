// M7: track frame continuity. Repro for the Velocity end-seam flip (user report 18 Nov 5:58):
// v5b Velocity accumulated +2.3 rad of corner bank that never unwound, so the final straight ran at
// ~132 deg bank and the closing 7-sample U smoothing snapped it upright in ~12 m (21.5 deg/m).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_KEYS, buildTrackData, frameAt, mkF } from '../../src/core/maps.js';

const D = 180 / Math.PI;
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * D;
// bank = roll of U about T relative to the gravity-upright frame (NaN when T is near vertical)
function bankDeg(T, U) {
  const ty = T.y; let u0 = [-T.x * ty, 1 - ty * ty, -T.z * ty]; const l = Math.hypot(...u0); if (l < 0.2) return NaN;
  u0 = u0.map(x => x / l); const r0 = [T.y * u0[2] - T.z * u0[1], T.z * u0[0] - T.x * u0[2], T.x * u0[1] - T.y * u0[0]];
  return Math.atan2(U.x * r0[0] + U.y * r0[1] + U.z * r0[2], U.x * u0[0] + U.y * u0[1] + U.z * u0[2]) * D;
}
// Intentional features set the per-map ceiling: Velocity R4 barrel roll2pi/170m (raised-cosine peak4.24deg/m),
// Legacy corkscrew 2pi/104 m (peak 6.9 deg/m). Kage has no rolls.
const CAP = { velocity: 4.5,drift:1, technical: 1.5, casino: 1.5, summit: 1.5, legacy: 7.2 };

for (const k of MAP_KEYS) {
  const td = buildTrackData(k), M = td.MAIN, N = M.N;
  test(`${k}: no U/T/P discontinuity anywhere on the lap, including the seam`, () => {
    let worstU = 0, at = 0, worstT = 0, worstGap = 0;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, u = ang(M.U[i], M.U[j]) / M.ds, t = ang(M.T[i], M.T[j]) / M.ds, g = M.P[i].distanceTo(M.P[j]);
      if (u > worstU) { worstU = u; at = i; } worstT = Math.max(worstT, t); worstGap = Math.max(worstGap, g);
    }
    assert.ok(worstU <= CAP[k], `${k} up-vector rate ${worstU.toFixed(2)} deg/m at ${(at * M.ds).toFixed(0)} m > ${CAP[k]}`);
    assert.ok(worstGap < M.ds * 1.05, `${k} position gap ${worstGap.toFixed(3)} m`);
  });
  test(`${k}: seam window (last 80 m -> first 40 m) is smooth and close to level`, () => {
    const f = mkF(); let prev = null, worst = 0, worstBank = 0;
    for (let s = M.L - 80; s <= M.L + 40; s += 0.25) {   // through the wrap with the runtime sampler
      frameAt(td, M, s, f); const U = f.U.clone();
      if (prev) worst = Math.max(worst, ang(prev, U) / 0.25); prev = U;
      const b = bankDeg(f.T, f.U); if (!Number.isNaN(b)) worstBank = Math.max(worstBank, Math.abs(b));
    }
    assert.ok(worst <= 1.5, `${k} seam up-vector rate ${worst.toFixed(2)} deg/m`);
    assert.ok(worstBank <= 10, `${k} seam bank ${worstBank.toFixed(1)} deg (start/finish straight must be near level)`);
  });
}

// v5b closure jog: the offline-solved closure ended 0.14 m (Velocity) / 0.27 m (Kage) to the side of the origin, so
// the last metre kinked heading 4.1 / 7.9 deg and back (a geodesic-curvature spike the Assisted corner lookahead
// and AI read as a corner right before the line). M7 closes it with a gentle shift on the final straight.
for (const k of MAP_KEYS) {
  const M = buildTrackData(k).MAIN, N = M.N;
  const jog = Math.max(ang(M.T[N - 1], M.T[0]), ang(M.T[N - 2], M.T[N - 1])) / M.ds;
  test(`${k}: seam heading kink <= 1 deg/m`, () => {
    assert.ok(jog <= 1, `${k} seam heading kink ${jog.toFixed(2)} deg/m`);
  });
}
