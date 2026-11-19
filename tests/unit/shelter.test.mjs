// M3-B rain shelter map: drops under any road deck / tunnel roof are hidden; open sky is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_KEYS, buildTrackData } from '../../src/core/maps.js';
import { buildShelter, isSheltered, shelterTop } from '../../src/core/shelter.js';
import { TRK } from '../../src/core/track.js';
const S = Object.fromEntries(MAP_KEYS.map(k => { const td = buildTrackData(k); return [k, { td, sh: buildShelter(td) }]; }));

test('UPSIDE DOWN: every point between an inverted deck and its occupants (car-side of the deck) is sheltered', () => {
  let n = 0;
  for (const k of MAP_KEYS) { const { td, sh } = S[k], M = td.MAIN;
    for (let i = 0; i < M.N; i += 3) { const U = M.U[i]; if (U.y > -0.6) continue;
      for (const d of [-M.WL[i] + 1, 0, M.WR[i] - 1]) for (const h of [0.5, 1.5, 3]) {   // where the car / chase camera are
        const P = M.P[i], R = M.R[i]; const x = P.x + R.x * d + U.x * h, y = P.y + R.y * d + U.y * h, z = P.z + R.z * d + U.z * h;
        assert.ok(isSheltered(sh, x, y, z), `${k} i=${i} d=${d} h=${h}`); n++; } } }
  assert.ok(n > 300, 'enough inverted samples tested: ' + n);
});
test('Legacy Riviera is now open sky, upright road is not sheltered above the surface', () => {
  const { td, sh } = S.legacy, M = td.MAIN; let t = 0, o = 0;
  for (let i = 0; i < M.N; i += 5) { const P = M.P[i], U = M.U[i];
    const inT = M.tag[i] & TRK.TUNNEL; const y = P.y + U.y * 3;
    if (inT) { assert.ok(isSheltered(sh, P.x, y, P.z), 'tunnel ' + i); t++; }
    else if (U.y > 0.95 && shelterTop(sh, P.x, P.z) < P.y + 2) { assert.ok(!isSheltered(sh, P.x, y, P.z), 'open ' + i); o++; } }
  assert.ok(t === 0 && o > 200, `${t} tunnel, ${o} open samples`);
});
test('elevated crossings: the lower road is sheltered where an upper deck passes over it', () => {
  let n = 0;
  for (const k of MAP_KEYS) { const { td, sh } = S[k], M = td.MAIN;
    for (let i = 0; i < M.N; i += 4) { const P = M.P[i]; if (M.U[i].y < 0.9) continue;
      const top = shelterTop(sh, P.x, P.z); if (top > P.y + 6) { assert.ok(isSheltered(sh, P.x, P.y + 2, P.z)); n++; } } }
  assert.ok(n > 0, 'at least one crossing found: ' + n);
});
test('shelter bake is cheap', () => { const t0 = performance.now(); for (const k of MAP_KEYS) buildShelter(S[k].td); assert.ok(performance.now() - t0 < 1500); });
