// R5 redesigned circuits (pure; no Three.js): Velocity, Casino, Summit, Shinrai.
// Kage (r4-tracks.js buildKageR4) and Legacy (track.js TRK.assemble) are NOT built or touched here.
//
// Closure. Every circuit is two identical PLAN halves (same piece lengths and yaws, each half turning exactly pi), so
// the second half is the first rotated by 180 degrees about the origin-to-midpoint and the loop closes exactly in x/z
// by construction: no offline solver, no seam connector. The closing yaw of each half is computed (closeHalves), never
// typed. Heights are functions of plan distance that start and end at 0, so the two halves can differ completely in
// elevation, bank and roll (identity) while the closure check still holds to float precision.
//
// Frames. Same integration as NEW_TRACK_INTERNALS.circuit: heading eases per piece with turnProgress, grade comes from
// the height function, bank is an absolute on-camber target per piece (never accumulated). New: an absolute roll
// profile rollAt(s) about the tangent, combined as  roll + bank * cos(roll)  so a banked turn stays on-camber both
// upright (roll 0) and inverted (roll pi): inverted turns press the car into the deck (KN >= 0) instead of lifting it.
// TRK.finalize then owns the final frames: it resamples the polyline by exact 3D arc length (~1 m), rebuilds T from
// central differences, projects our U onto the plane normal to that T (Gram-Schmidt), smooths U with two 7-sample
// passes, rebuilds R = T x U and recomputes KG/KN from the finalized frames. Our U is therefore only the per-sample
// "which way is up" input: roll survives as a rotation about the finalized T, positions are untouched, and every
// invariant (roll rate, KN, clearance) is tested on finalize's output (tests/unit/r5-tracks.test.mjs), not on inputs.
//
// Ramps are authored on plan distance and converted to finalized arc length (toPath). Exported as
//   ramps: [{ lip, len, vMin, pop }]   (airjump.js validates and owns the flight)
//   rampZones: [[a, b]]                (hazards.okStation / traffic exclusion, path metres)
import { TRK } from './track.js';
import { NEW_TRACK_INTERNALS } from './new-tracks.js';
 
const PI = Math.PI, HALF_PI = PI / 2;
const { turnProgress } = NEW_TRACK_INTERNALS;
const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoother = t => { t = clamp01(t); return t * t * t * (10 + t * (-15 + 6 * t)); };
// 0 -> 1 over [a, b] at constant grade with eased ends (fraction e of the span each end; zero slope at a and b).
export function ramp(s, a, b, e) {
  const t = clamp01((s - a) / (b - a));
  return t < e ? t * t / (2 * e * (1 - e)) : t > 1 - e ? 1 - (1 - t) * (1 - t) / (2 * e * (1 - e)) : (t - e / 2) / (1 - e);
}
export function hump(s, a, peak, b, h) { return s < a || s > b ? 0 : s < peak ? h * smoother((s - a) / (peak - a)) : h * (1 - smoother((s - peak) / (b - peak))); }
 
// Two identical plan halves; the piece flagged close gets yaw = pi - (sum of the others), bank on-camber.
function closeHalves(half, secOf) {
  const k = half.findIndex(p => p.close);
  const yaw = PI - half.reduce((a, p, i) => (i === k ? a : a + (p.yaw || 0)), 0);
  const h = half.map((p, i) => { const q = { ...p }; delete q.close; if (i === k) { q.yaw = yaw; q.bank = Math.sign(yaw) * Math.abs(p.bank || 0); } return q; });
  return [...h.map((p, i) => ({ ...p, sec: secOf(0, i) })), ...h.map((p, i) => ({ ...p, sec: secOf(1, i) }))];
}
 
function build(pieces, height, rollAt = null) {
  let x = 0, z = 0, psi = 0, s = 0;const totalPlan=pieces.reduce((a,p)=>a+p.len,0);
  const dense = [], planS = [];
  for (const pc of pieces) {
    const n = Math.ceil(pc.len / 0.25), ds = pc.len / n;
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n, ang = psi + (pc.yaw || 0) * turnProgress(u);
      x += Math.sin(ang) * ds; z += Math.cos(ang) * ds; s += ds;
      const y = height(s), grade = (height(s + 0.1) - height(s - 0.1)) / 0.2, th = Math.atan(grade);
      const seamFade=smoother((s-80)/160)*smoother((totalPlan-s-100)/160);
      const bank = (pc.bank || 0) * Math.min(1, u / 0.2, (1 - u) / 0.2)*seamFade, roll = rollAt ? rollAt(s) : 0;
      const f = TRK.frameOf(ang, th, roll + bank * Math.cos(roll));
      dense.push({ p: [x, y, z], U: f.U, sec: pc.sec, w: pc.w, tag: pc.tag || 0 }); planS.push(s);
    }
    psi += pc.yaw || 0;
  }
  const closure = Math.hypot(x, z, height(s) - height(0));
  if (closure > 0.02) throw Error('unsolved circuit closure ' + closure);
  const pts = [{ p: [0, height(0), 0], U: [0, 1, 0], sec: pieces[0].sec, w: pieces[0].w, tag: 0 }, ...dense.slice(0, -1)];
  const main = TRK.finalize(pts, true); main.marks = {};
  // plan distance -> finalized arc length: finalize resamples this exact polyline by 3D arc length from pts[0]
  const cum = new Float64Array(pts.length), ps = new Float64Array(pts.length);
  for (let j = 1; j < pts.length; j++) { const a = pts[j - 1].p, b = pts[j].p; cum[j] = cum[j - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); ps[j] = planS[j - 1]; }
  const toPath = q => {
    if (q <= 0) return 0;
    let lo = 0, hi = ps.length - 1;
    if (q >= ps[hi]) return cum[hi] + (q - ps[hi]);
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ps[m] <= q) lo = m; else hi = m; }
    return cum[lo] + (cum[hi] - cum[lo]) * (q - ps[lo]) / (ps[hi] - ps[lo]);
  };
  return { main, toPath };
}
const pathRamps = (toPath, list) => list.map(r => { const lip = toPath(r.lip); return { lip, len: toPath(r.lip + r.len) - lip, vMin: r.vMin, pop: r.pop }; });
const zonesOf = ramps => ramps.map(r => [r.lip - 60, r.lip + r.len + 120]);
 
// ---- VELOCITY: high-speed open sky. Half A climbs to a 60 m deck, rolls over on a 300 m straight twist, runs two
// inverted sweepers (R 300) on the flat deck, rolls back upright on a second 300 m twist and descends through a long
// banked carousel. Half B is the same plan at ground level, upright, with a 30 m sky crest over its esses.
// Peak roll rate pi*1.875/300 = 1.125 deg/m. No barrel roll, no loop. Every corner is flat-out at expert pace.
export function buildVelocityR5() {
  const P = (len, yaw = 0, bank = 0) => ({ len, yaw, bank, w: 14 });
  const half = [P(300), P(450, 1.0, 0.3), P(300), P(270, 0.9, 0.22), P(270, -0.9, -0.22), P(300), { ...P(700, 0, 0.45), close: true }];
  const pieces = closeHalves(half, (h, i) => (h === 0 ? (i < 2 ? 0 : 1) : 2));
  const TW_IN = [750, 1050], TW_OUT = [1590, 1890];   // plan metres (pieces 3 and 6 of half A, both straight and flat)
  const rollAt = s => PI * (smoother((s - TW_IN[0]) / (TW_IN[1] - TW_IN[0])) - smoother((s - TW_OUT[0]) / (TW_OUT[1] - TW_OUT[0])));
  const height = s => 60 * (ramp(s, 80, 750, 0.15) - ramp(s, 1890, 2700, 0.15)) + 30 * (ramp(s, 3300, 3800, 0.2) - ramp(s, 4000, 4480, 0.2));
  const { main } = build(pieces, height, rollAt);
  return { main, branch: null, rampZones: [], ramps: [] };
}
 
// ---- CASINO: R4's slalom plan (two halves, high-roller split kept), rebuilt vertically: each half climbs through the
// slalom to a short neon bench and drops off a lip down a long constant-grade landing hill (70 m and 75 m drops) onto
// the carousel floor. Landing windows cover every launch speed up to 140 m/s (tests/unit/airjump.test.mjs).
export function buildCasinoR5() {
  const P = (len, yaw = 0, bank = 0) => ({ len, yaw, bank, w: 14 });
  const half = [P(260), P(150, 0.9, 0.3), P(240, -1.8, -0.42), P(150, 0.9, 0.3), P(600), P(250, HALF_PI, 0.48), P(180), P(250, HALF_PI, 0.48), P(200), P(160, 0.8, 0.28), { ...P(160, 0, 0), close: true }];
  const pieces = closeHalves(half, (h, i) => (h === 0 ? (i < 4 ? 0 : 1) : (i < 5 ? 2 : 3)));
  const halfL = 2600;
  const height = s => 70 * (ramp(s, 280, 800, 0.1) - ramp(s, 840, 1400, 0.08)) + 75 * (ramp(s, 2660, 3400, 0.1) - ramp(s, 3430, 4000, 0.08));
  const { main: M, toPath } = build(pieces, height);
  const ramps = pathRamps(toPath, [{ lip: 840, len: 440, vMin: 55, pop: 3 }, { lip: 3430, len: 470, vMin: 55, pop: 3 }]);
  // High-roller skyway: same construction as R4, anchored on path indices of the same plan stations.
  const a = Math.round(toPath(halfL + 35) / M.ds), b = Math.round(toPath(halfL + 245) / M.ds), off = 24, dense = [];
  for (let i = a; i <= b; i++) { const u = (i - a) / (b - a), h = 14 * Math.sin(PI * u) ** 2; dense.push({ p: M.P[i].map((x, k) => x + off * M.R[i][k] + h * M.U[i][k]), U: M.U[i].slice(), sec: 2, w: 8, tag: 0 }); }
  const branch = TRK.finalize(dense, false); branch.sA = a; branch.sB = b; branch.off = off;
  return { main: M, branch, rampZones: zonesOf(ramps), ramps };
}
 
// ---- SUMMIT: alpine ridge. Long constant-grade climb (about 15 %) through four sweepers to 180 m, a ridge straight with
// an air crest, ridge esses, a wide summit carousel, then the descent: three benches, each left over a lip onto a
// 12-13 % landing hill. Sweepers only (no hairpins), road half width 14.
export function buildSummitR5() {
  const P = (len, yaw = 0, bank = 0) => ({ len, yaw, bank, w: 14 });
  const half = [P(300), P(320, 0.9, 0.15), P(260, -0.7, -0.15), P(340, 1.0, 0.15), P(300, -0.8, -0.15), P(260), P(200, 0.5, 0.12), P(200, -0.5, -0.12), { ...P(620, 0, 0.35), close: true }];
  const pieces = closeHalves(half, (h, i) => (h === 0 ? (i < 2 ? 0 : i < 5 ? 1 : 2) : 3));
  const height = s => 180 * ramp(s, 150, 1500, 0.12) + hump(s, 1560, 1700, 2060, 14)
    - 60 * ramp(s, 3100, 3640, 0.08) - 60 * ramp(s, 3900, 4400, 0.08) - 60 * ramp(s, 4600, 5300, 0.06);
  const { main, toPath } = build(pieces, height);
  const ramps = pathRamps(toPath, [
    { lip: 1700, len: 260, vMin: 55, pop: 2 },   // ridge air crest
    { lip: 3100, len: 400, vMin: 55, pop: 2 },   // first drop
    { lip: 3900, len: 420, vMin: 55, pop: 2 },   // second drop
    { lip: 4600, len: 320, vMin: 55, pop: 2 }    // valley drop
  ]);
  return { main, branch: null, rampZones: zonesOf(ramps), ramps };
}
 
// ---- SHINRAI: linked drift corners. Chains of 3-4 corners (R 62-92 m effective) linked with no straight between
// direction changes, short resets, half width 14, no obstacles (hazards OB_COUNT.drift = 0), gentle 10 m rise in the
// second half. Upright everywhere.
export function buildShinraiR5() {
  const P = (len, yaw = 0, bank = 0) => ({ len, yaw, bank, w: 14 });
  const half = [P(200), P(100, 1.3, 0.14), P(140, -2.0, -0.14), P(115, 1.6, 0.14), P(120), P(95, -1.2, -0.14), P(170, 2.3, 0.16), P(90), P(110, 1.2, 0.14), P(110, -1.5, -0.14), { ...P(120, 0, 0.14), close: true }, P(150)];
  const pieces = closeHalves(half, (h, i) => h * 2 + (i < 5 ? 0 : 1));
  const height = s => 10 * (ramp(s, 1700, 2100, 0.25) - ramp(s, 2500, 2900, 0.25));
  const { main } = build(pieces, height);
  return { main, branch: null, rampZones: [], ramps: [] };
}
 