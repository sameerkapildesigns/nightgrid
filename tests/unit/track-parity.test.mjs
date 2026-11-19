// Track parity: the pure core must generate exactly the v5b tracks.
// The v5b generator is evaluated straight out of reference/v5b-game.html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { TRK } from '../../src/core/track.js';
import { MAPS, MAP_KEYS, buildTrackData, S0 } from '../../src/core/maps.js';

const html = readFileSync(new URL('../../reference/v5b-game.html', import.meta.url), 'utf8');
const trkSrc = html.slice(html.indexOf('const TRK = (() => {'), html.indexOf('})();', html.indexOf('const TRK = (() => {')) + 5);
const ctx = {}; vm.createContext(ctx); vm.runInContext(trkSrc + '\nthis.TRK = TRK;', ctx);
const V5B = ctx.TRK;
const J = x => JSON.parse(JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)));   // normalise cross-realm arrays
const v5bBuild = { velocity: () => V5B.assembleCustom(V5B.DEFS.velocity()), technical: () => V5B.assembleCustom(V5B.DEFS.technical()), legacy: () => V5B.assemble() };

// M7 intentional divergence (track-continuity.test.mjs): Velocity's final straight unwinds the accumulated bank, and
// Velocity/Kage final straights close v5b's 0.14/0.27 m lateral closure jog. Sample count, sectors, widths and tags
// stay v5b-exact. The lap gets 0.014 m (Velocity) / 0.046 m (Kage) shorter, so 1 m arc-length resampling drifts samples
// by at most that much; frames before the final straight match v5b to 5e-3 (0.3 deg), and the final straight moves <= 0.3 m.
const M7_FROM = { velocity: 5870 - 300 - 8, technical: 2420 - 100 - 8 };
const near = (A, B, tol) => A.every((x, i) => Math.abs(x - B[i]) <= tol);
test('M7: Velocity/Kage differ from v5b only on the final straight, and only slightly in position', () => {
  for (const [k, from] of Object.entries(M7_FROM)) {
    const a = J(MAPS[k].build()), b = J(v5bBuild[k]()), wrap = 8;
    assert.equal(a.main.N, b.main.N, k); assert.deepEqual(a.main.sec, b.main.sec); assert.deepEqual(a.main.tag, b.main.tag);
    assert.ok(Math.abs(a.main.ds - b.main.ds) * a.main.N < 0.05, k + ' lap length change < 5 cm');
    let worst = 0;
    for (let i = 0; i < a.main.N; i++) {
      const d = Math.hypot(...a.main.P[i].map((x, c) => x - b.main.P[i][c])); worst = Math.max(worst, d);
      if (i >= wrap && i < from) {
        assert.ok(d < 0.05, `${k} P[${i}] moved ${d}`);
        for (const key of ['T', 'U', 'R']) assert.ok(near(a.main[key][i], b.main[key][i], 5e-3), `${k} ${key}[${i}]`);
        assert.ok(Math.abs(a.main.KG[i] - b.main.KG[i]) < 1e-3 && Math.abs(a.main.KN[i] - b.main.KN[i]) < 1e-3, `${k} K[${i}]`);
      }
    }
    assert.ok(worst <= 0.3, `${k} final-straight move ${worst.toFixed(3)} m`);
  }
});

test('core track generator is byte-for-byte the v5b generator on every map', () => {
  for (const k of MAP_KEYS) {
    if (k in M7_FROM || !v5bBuild[k]) continue;   // covered by the M7 test above
    const a = J(MAPS[k].build()), b = J(v5bBuild[k]());
    assert.equal(a.main.N, b.main.N, k + ' sample count');
    assert.deepEqual(a.main.P, b.main.P, k + ' positions');
    assert.deepEqual(a.main.U, b.main.U, k + ' normals');
    assert.deepEqual(a.main.KG, b.main.KG, k + ' curvature');
    assert.deepEqual(a, b, k + ' full output');
    assert.deepEqual(a.main.sec, b.main.sec, k + ' sectors');
    assert.equal(!!a.branch, !!b.branch, k + ' branch');
    if (a.branch) assert.deepEqual(a.branch.P, b.branch.P, k + ' branch positions');
  }
});

test('map catalogue matches v5b (names, laps, widths, sector count, lengths)', () => {
  const expect = { velocity: { laps: 2, W0: 14, sectors: 3, N: 5870, br: false }, technical: { laps: 3, W0: 10.5, sectors: 3, N: 2420, br: false }, legacy: { laps: 3, W0: TRK.W0, sectors: 5, N: 5055, br: true } };
  assert.deepEqual(MAP_KEYS, ['velocity', 'technical', 'casino', 'summit', 'legacy']);
  for (const k of Object.keys(expect)) {
    const td = buildTrackData(k), e = expect[k];
    assert.equal(td.LAPS, e.laps); assert.equal(td.W0, e.W0); assert.equal(td.SECTORS.length, e.sectors);
    assert.equal(td.MAIN.N, e.N); assert.equal(td.HASBR, e.br);
    assert.ok(td.MAIN.closed);
    assert.equal(td.SECSTART[0], Math.round(S0 / td.MAIN.ds));
    for (let s = 1; s < td.SECSTART.length; s++) assert.ok(td.SECSTART[s] > td.SECSTART[s - 1], k + ' sectors ordered');
  }
});
