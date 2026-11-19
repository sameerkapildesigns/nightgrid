// R5 authored air jumps + barrel-roll tricks. Pure and deterministic: the room authority, the client predictor and
// the tests run this exact code at the fixed 120 Hz step, so a jump is reproduced bit-for-bit from snapshot state.
// All state lives in plain racer fields (jump, jT, jY, jVy, jRamp, jElig, jAw, tk, tkDir, tkN), so sim.snapshot(),
// racerState() / setRacerState() and importSnapshot() carry a racer mid-air with no special handling.
//
// Flight model (relative ground done correctly). A jump starts only when a grounded racer crosses a validated ramp lip
// on the main road at >= vMin. From then on the racer's WORLD height yW follows a ballistic arc (gravity AIR.G) and the
// track-space hover height is derived every step from the road under the car:
//     h = (yW - surfaceY(s, d)) / U.y,      surfaceY = P.y + d * R.y   (same point sim.pose uses for h = 0)
// so when the road drops away beneath the car the car is genuinely higher above it; nothing is clamped mid-flight.
// Launch vertical speed = road vertical velocity at the lip (v_along * T.y) + hover vertical speed (vh * U.y) + the
// ramp's authored pop, capped once at launch (VY_MAX bounds the apex). Touchdown happens when h crosses H0 while
// closing; position is continuous and the closing speed is capped to LAND_VH (inelastic landing, the hover spring
// takes the rest), so there is no height snap and no 9 m hover-cap clamp on the way down.
// Along-track motion in the air stays track-space (s, d advance as before): the car keeps following the road's plan
// curvature. The gates keep that invisible: |KG| <= KG_MAX over the whole ramp window.
//
// Gates (rampProblems / buildRamps): upright road (U.y >= UP_MIN), gentle curvature, no tunnel, outside the fork
// region, not across the lap seam, not on reversed variants (ramps are directional). Invalid ramps are dropped.
//
// Tricks: drift + steer (|steer| >= TRICK_STEER) while airborne starts one full roll (2*pi in TRICK_T) only if the
// predicted remaining airtime covers it plus a margin; a started roll is committed and runs at a fixed rate. At most
// TRICK_MAX completed rolls per jump. The roll is a body angle only (presentation reads r.tk); it never moves the car
// or the camera. Reward: only on a clean landing of an authored jump, and only one reward opportunity per ramp per
// lap per racer (claimed at launch, so a messy first attempt forfeits that lap's reward). No jump is required to finish.
import { wrapA } from './math.js';
 
export const AIR = Object.freeze({
  G: 14,                 // m/s^2 world-vertical gravity in flight (sim GRAV 3.43 would float for 5+ s)
  POP_MAX: 4,            // m/s cap on an authored lip pop
  VY_MAX: 18,            // m/s cap on launch vertical speed (bounds the apex at launch; never clamped mid-flight)
  LIP_H: 2.5,            // m above H0: racer must be on/near the road to launch (crest lift before a lip stays below this)
  LIP_PRE: 15,           // m of road before the lip that must pass the gates too
  LAND_VH: 5,            // m/s closing speed kept at touchdown; the rest is absorbed (inelastic; no position change)
  T_SOFT: 3.4, T_HARD: 4.4,   // safety net only: gravity ramps x1 -> x3 between these flight times (validated ramps land earlier)
  UP_MIN: 0.97,          // gate: ramp window must be upright (bank + grade)
  KG_MAX: 1 / 250,       // gate: ramp window curvature (track-space flight follows plan curvature)
  FORK_PRE: 280, FORK_POST: 160,   // same fork exclusion as hazards.okStation
  TRICK_T: 0.8,          // s per full roll
  TRICK_MARGIN: 0.15,    // s of predicted air left over when a roll would finish
  TRICK_MAX: 2,          // completed rolls per jump
  TRICK_STEER: 0.6,      // |steer| needed (with drift) to start a roll
  CLEAN_PSI: 0.5,        // rad: landing heading within ~29 deg of the road
  MESSY_KEEP: 0.92,      // speed kept after touching down mid-roll
  REWARD_LAND: 0.06, REWARD_ROLL: 0.12,   // meter: clean landing + per completed roll (max 0.30)
  RESPAWN_PRE: 80, RESPAWN_WINDOW_PRE: 40, RESPAWN_WINDOW_POST: 30
});
const TAU = Math.PI * 2;
const modL = (s, L) => ((s % L) + L) % L;
const _q = { y: 0, uy: 1, ty: 0 }, _p = { y: 0, uy: 1, ty: 0 };
 
// Linear sample of the main road at arc length s: surface elevation at lateral offset d, U.y and T.y.
export function roadAt(M, s, d, out = {}) {
  const f = modL(s, M.L) / M.ds; let i = Math.floor(f); const t = f - i; i %= M.N; const j = (i + 1) % M.N;
  const P0 = M.P[i], P1 = M.P[j], R0 = M.R[i], R1 = M.R[j];
  out.y = P0.y + (P1.y - P0.y) * t + d * (R0.y + (R1.y - R0.y) * t);
  out.uy = M.U[i].y + (M.U[j].y - M.U[i].y) * t;
  out.ty = M.T[i].y + (M.T[j].y - M.T[i].y) * t;
  return out;
}
 
// Reasons a ramp is unsafe on this track (empty array = valid). Exported for tests / tooling.
export function rampProblems(td, rp) {
  const M = td.MAIN, out = [];
  if (!rp || !(rp.len > 0) || !Number.isFinite(rp.lip)) return ['bad-metadata'];
  const a = rp.lip - AIR.LIP_PRE, b = rp.lip + rp.len;
  if (a < 0 || b > M.L) out.push('crosses-seam');
  if (td.HASBR && a < td.SBm + AIR.FORK_POST && b > td.SAm - AIR.FORK_PRE) out.push('fork');
  for (let s = Math.max(0, a); s <= Math.min(M.L, b); s += M.ds) {
    const i = Math.min(M.N - 1, Math.round(s / M.ds));
    if (M.U[i].y < AIR.UP_MIN) { out.push('not-upright@' + Math.round(s)); break; }
    if (Math.abs(M.KG[i]) > AIR.KG_MAX) { out.push('curvature@' + Math.round(s)); break; }
    if (M.tag[i] & 1) { out.push('tunnel@' + Math.round(s)); break; }
  }
  return out;
}
// Validated ramp list for a track (cached). Reversed variants get none: lips would become landings.
export function buildRamps(td) {
  if (td.airRamps) return td.airRamps;
  const list = [];
  if (!(td.vr & 2)) (td.ramps || []).forEach((rp, id) => {
    if (rampProblems(td, rp).length) return;
    list.push({ id, lip: rp.lip, end: rp.lip + rp.len, vMin: Math.max(30, rp.vMin || 55), pop: Math.max(0, Math.min(AIR.POP_MAX, rp.pop || 0)) });
  });
  return (td.airRamps = list);
}
 
const gravityMul = t => (t <= AIR.T_SOFT ? 1 : 1 + 2 * Math.min(1, (t - AIR.T_SOFT) / (AIR.T_HARD - AIR.T_SOFT)));
 
// Call after the racer's s advanced this step (prevS = previous s). Returns the ramp on launch, else null.
export function tryLaunch(r, td, ramps, vAlong, H0) {
  if (r.jump || !ramps || !ramps.length || r.path !== td.MAIN || r.prevS === undefined || !(vAlong > 0)) return null;
  const s0 = r.prevS, s1 = r.s;
  if (!(s1 > s0) || s1 - s0 > 20) return null;   // forward only; a lap-seam wrap never crosses a lip (ramps avoid the seam)
  for (const rp of ramps) {
    if (!(s0 < rp.lip && rp.lip <= s1)) continue;
    if (vAlong < rp.vMin || r.h > H0 + AIR.LIP_H) return null;
    const q = roadAt(td.MAIN, s1, r.d, _q);
    const vy = Math.min(AIR.VY_MAX, vAlong * q.ty + (r.vh || 0) * q.uy + rp.pop);
    r.jump = 1; r.jRamp = rp.id; r.jT = 0; r.jY = q.y + r.h * q.uy; r.jVy = vy;
    r.tk = 0; r.tkDir = 0; r.tkN = 0; r.air = true;
    return rp;
  }
  return null;
}
 
// Predicted seconds until touchdown from the current flight state (pure; same integrator as airStep, constant v).
export function remainingAir(r, td, vAlong, H0) {
  const M = td.MAIN, h = 1 / 60; let y = r.jY, vy = r.jVy, s = r.s, t = 0;
  for (let k = 0; k < 360; k++) {
    vy -= AIR.G * gravityMul(r.jT + t) * h; y += vy * h; s += vAlong * h; t += h;
    const q = roadAt(M, s, r.d, _p);
    if ((y - q.y) / Math.max(0.5, q.uy) <= H0) return t;
  }
  return t;
}
function startTrick(r, td, vAlong, input, H0) {
  if (r.tkDir || r.tkN >= AIR.TRICK_MAX || !(input.drift||input.down)) return;
  const st = (+input.right || 0) - (+input.left || 0);
  if (Math.abs(st) < AIR.TRICK_STEER) return;
  if (remainingAir(r, td, vAlong, H0) < AIR.TRICK_T + AIR.TRICK_MARGIN) return;
  r.tkDir = st > 0 ? 1 : -1;
}
function advanceTrick(r, dt) {
  if (!r.tkDir) return;
  const target = (r.tkN + 1) * TAU, a = Math.abs(r.tk) + TAU / AIR.TRICK_T * dt;
  if (a >= target) { r.tk = r.tkDir * target; r.tkN++; r.tkDir = 0; } else r.tk = r.tkDir * a;
}
function land(r) {
  const open = r.tkDir !== 0;
  const info = { ramp: r.jRamp, airT: r.jT, rolls: r.tkN, rel: Math.max(0, -r.vh), open };
  r.vh = Math.max(-AIR.LAND_VH, Math.min(0, r.vh));
  if (r.h < 0.4) r.h = 0.4;   // hover floor; only reachable at > 72 m/s closing speed (validated ramps: < 25)
  r.jump = 0; r.jT = 0; r.jVy = 0; r.tkDir = 0; r.air = false;
  r.tk = open ? wrapA(r.tk) : 0;   // completed rolls are whole turns; an open one settles via settleTrick
  return info;
}
// One flight step. Call after s/d advanced this step. Returns landing info on touchdown, else null.
export function airStep(r, td, vAlong, dt, input, H0, canTrick) {
  const M = td.MAIN;
  if (r.path !== M) { cancelJump(r); return null; }   // unreachable for validated ramps (no fork inside a ramp window)
  r.jT += dt;
  r.jVy -= AIR.G * gravityMul(r.jT) * dt;
  r.jY += r.jVy * dt;
  const q = roadAt(M, r.s, r.d, _q), uy = Math.max(0.5, q.uy);
  r.h = (r.jY - q.y) / uy;
  r.vh = (r.jVy - vAlong * q.ty) / uy;   // closing speed relative to the road surface under the car
  if (canTrick && input) startTrick(r, td, vAlong, input, H0);
  advanceTrick(r, dt);
  return r.h <= H0 && r.vh <= 0 ? land(r) : null;
}
// Grounded: an open (messy) roll angle settles to 0 smoothly. Deterministic, sim state.
export function settleTrick(r, dt) {
  if (r.jump || !r.tk) return;
  const a = wrapA(r.tk) * Math.exp(-14 * dt);
  r.tk = Math.abs(a) < 1e-3 ? 0 : a;
}
// Reset / respawn / crash / grid: drop any flight state (keeps jAw, the per-lap reward ledger, and h).
export function cancelJump(r) { r.jump = 0; r.jT = 0; r.jY = 0; r.jVy = 0; r.tk = 0; r.tkDir = 0; r.tkN = 0; r.jElig = 0; }
// Respawn position: never inside a ramp take-off/landing window; back up before the lip instead.
export function respawnS(ramps, s, L) {
  for (const rp of ramps || []) if (s >= rp.lip - AIR.RESPAWN_WINDOW_PRE && s <= rp.end + AIR.RESPAWN_WINDOW_POST) return modL(rp.lip - AIR.RESPAWN_PRE, L);
  return s;
}
 