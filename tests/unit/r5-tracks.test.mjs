// R5 redesigned circuits: closure, wiring, frame smoothness, inversion shape, KN bounds, footprint clearance, widths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrackData, MAPS } from '../../src/core/maps.js';
import { validVariant } from '../../src/core/variants.js';
import { buildVelocityR5, buildCasinoR5, buildSummitR5, buildShinraiR5 } from '../../src/core/r5-tracks.js';
import { buildKageR4 } from '../../src/core/r4-tracks.js';
 
const R5 = ['velocity', 'casino', 'summit', 'drift'];
const DEG = Math.PI / 180;
const variants = k => [0, 1, 2, 3, 4, 5, 6, 7].filter(v => validVariant(k, v));
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)));
 
// Unwrapped roll of U about T, relative to the upright reference (world up projected normal to T).
function rollProfile(M) {
  const out = new Float64Array(M.N); let prev = 0, acc = 0;
  for (let i = 0; i < M.N; i++) {
    const T = M.T[i], U = M.U[i];
    let ux = -T.x * T.y, uy = 1 - T.y * T.y, uz = -T.z * T.y; const l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
    const rx = T.y * uz - T.z * uy, ry = T.z * ux - T.x * uz, rz = T.x * uy - T.y * ux;
    const a = Math.atan2(U.x * rx + U.y * ry + U.z * rz, U.x * ux + U.y * uy + U.z * uz);
    if (i) { let d = a - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; acc += d; } else acc = a;
    prev = a; out[i] = acc;
  }
  return out;
}
 
test('R5 builders close (exact half-turn symmetry) and are wired; Kage/Legacy builders untouched', () => {
  for (const b of [buildVelocityR5, buildCasinoR5, buildSummitR5, buildShinraiR5]) { const raw = b(); assert.ok(raw.main.closed && raw.main.N > 2000, b.name); }
  assert.equal(MAPS.velocity.build, buildVelocityR5); assert.equal(MAPS.casino.build, buildCasinoR5);
  assert.equal(MAPS.summit.build, buildSummitR5); assert.equal(MAPS.drift.build, buildShinraiR5);
  assert.equal(MAPS.technical.build, buildKageR4);
});
 
test('frames are smooth on every allowed variant', () => {
  for (const k of R5) for (const vr of variants(k)) {
    const M = buildTrackData(k, vr).MAIN;
    let maxU = 0, maxT = 0;
    for (let i = 0; i < M.N; i++) { const j = (i + 1) % M.N; maxU = Math.max(maxU, ang(M.U[i], M.U[j]) / M.ds); maxT = Math.max(maxT, ang(M.T[i], M.T[j]) / M.ds); }
    assert.ok(maxU <= 1.6 * DEG, `${k} vr${vr} U turns ${(maxU / DEG).toFixed(2)} deg/m`);
    assert.ok(maxT <= 2.5 * DEG, `${k} vr${vr} T turns ${(maxT / DEG).toFixed(2)} deg/m`);
  }
});
 
test('no longitudinal 360 anywhere; only Velocity inverts, as designed', () => {
  for (const k of R5) for (const vr of variants(k)) {
    const M = buildTrackData(k, vr).MAIN, roll = rollProfile(M);
    let max = 0, rate = 0; for (let i = 0; i < M.N; i++) { max = Math.max(max, Math.abs(roll[i])); if (i) rate = Math.max(rate, Math.abs(roll[i] - roll[i - 1]) / M.ds); }
    assert.ok(Math.abs(roll[M.N - 1] - roll[0]) < 0.2, `${k} vr${vr} net roll ${roll[M.N - 1].toFixed(2)}`);
    assert.ok(max <= (k === 'velocity' ? Math.PI + 0.5 : 0.7), `${k} vr${vr} max roll ${max.toFixed(2)}`);
    assert.ok(rate <= 1.3 * DEG, `${k} vr${vr} roll rate ${(rate / DEG).toFixed(2)} deg/m`);
  }
});
 
test('Velocity inverted deck: length, elevation, KN never lifts and stays bounded', () => {
  for (const vr of variants('velocity')) {
    const M = buildTrackData('velocity', vr).MAIN;
    let inv = 0, minKN = Infinity, maxKN = -Infinity, minY = Infinity;
    for (let i = 0; i < M.N; i++) if (M.U[i].y < -0.2) { inv += M.ds; minKN = Math.min(minKN, M.KN[i]); maxKN = Math.max(maxKN, M.KN[i]); minY = Math.min(minY, M.P[i].y); }
    assert.ok(inv >= 500 && inv <= 1100, `vr${vr} inverted ${inv.toFixed(0)} m`);
    assert.ok(minKN >= -5e-4, `vr${vr} inverted KN min ${minKN} (negative = lift off the deck)`);
    assert.ok(maxKN <= 4e-3, `vr${vr} inverted KN max ${maxKN}`);
    assert.ok(minY >= 50, `vr${vr} inverted deck elevation ${minY.toFixed(1)} m`);
  }
});
 
test('footprint clearance: no two road parts closer than both half widths + 4 m unless 14 m apart vertically', () => {
  for (const k of R5) {
    const M = buildTrackData(k, 0).MAIN, step = 2;
    for (let i = 0; i < M.N; i += step) for (let j = i + step; j < M.N; j += step) {
      const arc = Math.min(j - i, M.N - (j - i)) * M.ds; if (arc < 80) continue;
      const a = M.P[i], b = M.P[j], dh = Math.hypot(a.x - b.x, a.z - b.z), dy = Math.abs(a.y - b.y);
      if (dh < M.W[i] + M.W[j] + 4 && dy < 14) assert.fail(`${k}: s=${(i * M.ds).toFixed(0)} vs s=${(j * M.ds).toFixed(0)} horizontal ${dh.toFixed(1)} m, vertical ${dy.toFixed(1)} m`);
    }
  }
});
 
test('elevation identity and widths', () => {
  const ys = k => { const M = buildTrackData(k, 0).MAIN; let lo = Infinity, hi = -Infinity; for (const p of M.P) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); } return [lo, hi]; };
  assert.ok(ys('summit')[1] >= 175, 'Summit reaches ~180 m');
  assert.ok(ys('casino')[1] >= 65, 'Casino drops from 70+ m');
  assert.ok(ys('velocity')[1] >= 55, 'Velocity deck');
  for (const k of R5) { const M = buildTrackData(k, 0).MAIN; for (let i = 0; i < M.N; i++) assert.ok(Math.abs(M.W[i] - 14) < 1e-6, `${k} half width ${M.W[i]} at ${i}`); }
  assert.equal(MAPS.drift.W0, 14);
});
 