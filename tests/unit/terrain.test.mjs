// M3-A ground clearance: full road width + curbs/rails + hull + vehicle envelope, all maps, main + branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_KEYS, buildTrackData } from '../../src/core/maps.js';
import { buildClearance, groundHeightAt, worstClearance, GROUND_Y, TERRAIN } from '../../src/core/terrain.js';

const T = Object.fromEntries(MAP_KEYS.map(k => { const td = buildTrackData(k); return [k, { td, cl: buildClearance(td) }]; }));
test('BEFORE (v5b flat ground at -0.06): the full-width road solid intersects the ground on every map', () => {
  const exp = { velocity: -14, technical: -0.9, legacy: -2.9 };   // raw y - ground of the swept solid
  for (const k of ['velocity','technical','legacy']) { const w = worstClearance(T[k].td, () => GROUND_Y, TERRAIN, true); assert.ok(w.c < exp[k], `${k}: ${JSON.stringify(w)}`); }
  // the centreline alone never reveals it (why a centreline-only test is insufficient)
  for (const k of MAP_KEYS) assert.ok(Math.min(...T[k].td.MAIN.P.map(p => p.y)) > -0.01);
});
test('AFTER: every swept point (full width + rails, surface..+envelope, main + branch) clears the ground by its required margin', () => {
  for (const k of MAP_KEYS) {
    const { td, cl } = T[k]; const w = worstClearance(td, (x, z) => groundHeightAt(cl, x, z));
    assert.ok(w.c >= -1e-3, `${k}: ${JSON.stringify(w)}`);
  }
});
test('dense proof on the RENDERED triangles: 0.25 m longitudinal x 0.25 m lateral, interpolated frames', () => {
  for (const k of MAP_KEYS) {
    const { td, cl } = T[k]; const w = worstClearance(td, (x, z) => groundHeightAt(cl, x, z), TERRAIN, false, 4, 0.25);
    assert.ok(w.c >= -0.02, `${k}: ${JSON.stringify(w)}`);
  }
});
test('groundHeightAt reproduces the mesh triangulation (a,c,b)+(b,c,d), not bilinear', () => {
  const cl = { x0: 0, z0: 0, cell: 2, nx: 2, nz: 2, req: Float32Array.from([0, 0, 0, -4]) };   // a=0 b=0 c=0 d=-4
  assert.equal(groundHeightAt(cl, 0.5, 0.5), 0);              // lower-left triangle (a,c,b): all corners 0
  assert.equal(groundHeightAt(cl, 1.5, 1.5), -2);             // upper-right triangle: plane through b,c,d
  // bilinear would give -0.25 at (0.5,0.5) and -2.25 at (1.5,1.5)
});
test('ground is untouched (exactly GROUND_Y) away from low road; pits are local', () => {
  for (const k of MAP_KEYS) {
    const { cl } = T[k]; let cut = 0; const G32 = Math.fround(GROUND_Y); for (const v of cl.req) { assert.ok(v <= G32); if (v < G32) cut++; }
    assert.ok(cut / cl.req.length < 0.05, `${k}: ${(100 * cut / cl.req.length).toFixed(1)}% of track-area grid cut`);
    assert.equal(groundHeightAt(cl, cl.x0 - 500, cl.z0 - 500), GROUND_Y);
  }
});
test('pits sit inside the city\'s existing building exclusion zone (buildings keep >= W+9+hd from track samples below 16 m)', () => {
  // every cut cell lies within (W + sideExtra + clearR + 1.5 cells) of some track sample with y < 16,
  // which is inside v5b's building exclusion radius (W + 9 + hd, hd >= 6.4) => no foundation is undercut
  for (const k of MAP_KEYS) {
    const { td, cl } = T[k]; const paths = [td.MAIN].concat(td.BR ? [td.BR] : []);
    // direct check against the city's own exclusion rule (d < W + 9 + hd, hd >= hypot(9,9)/2, samples every 2 m)
    const reach = 9 + Math.hypot(9, 9) / 2 - 1.01;
    for (let j = 0; j < cl.nz; j += 1) for (let i = 0; i < cl.nx; i += 1) {
      if (cl.req[j * cl.nx + i] >= Math.fround(GROUND_Y)) continue;
      const x = cl.x0 + i * cl.cell, z = cl.z0 + j * cl.cell; let ok = false;
      for (const p of paths) { for (let q = 0; q < p.N && !ok; q += 1) { const P = p.P[q]; if (P.y < 16 && Math.hypot(P.x - x, P.z - z) <= Math.max(p.WL[q], p.WR[q]) + reach) ok = true; } if (ok) break; }
      assert.ok(ok, `${k}: cut cell at ${x},${z} outside exclusion`);
    }
  }
});
