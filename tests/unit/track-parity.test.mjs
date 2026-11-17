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

test('core track generator is byte-for-byte the v5b generator on every map', () => {
  for (const k of MAP_KEYS) {
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
  assert.deepEqual(MAP_KEYS, ['velocity', 'technical', 'legacy']);
  for (const k of MAP_KEYS) {
    const td = buildTrackData(k), e = expect[k];
    assert.equal(td.LAPS, e.laps); assert.equal(td.W0, e.W0); assert.equal(td.SECTORS.length, e.sectors);
    assert.equal(td.MAIN.N, e.N); assert.equal(td.HASBR, e.br);
    assert.ok(td.MAIN.closed);
    assert.equal(td.SECSTART[0], Math.round(S0 / td.MAIN.ds));
    for (let s = 1; s < td.SECSTART.length; s++) assert.ok(td.SECSTART[s] > td.SECSTART[s - 1], k + ' sectors ordered');
  }
});
