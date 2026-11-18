// Remote-car presentation in the LOCAL car's timeline (pure; no DOM/Three.js; used by game.js and tests).
//
// Why: the local car is predicted ahead of the server (step `seq` = server step + lead), while the old
// path drew remote cars ~120 ms in the PAST (snapshot interpolation). On one screen that put remote cars
// 13-24 m (p50, measured) behind their true position relative to you, so close passes looked wrong and
// the HUD position, computed from those mismatched values, flipped several times more than the true
// order did (tests/net/smooth.mjs, docs/M5-SYNC.md).
//
// What: each remote car is dead-reckoned along the track from its newest authoritative snapshot to the
// local car's step (track-space: s advances with the along-track speed, lateral offset with a short,
// clamped lateral velocity). When a newer snapshot changes the estimate, the difference is NOT shown as a
// jump: it becomes a visual offset that decays smoothly (soft correction). Only very large errors (branch
// change, crash/respawn, > SNAP_M) snap, and those are counted.
//
// Authority is unchanged: laps, finish order and results still come from the server. This module only
// decides where remote cars are DRAWN and what the HUD position says between server results.
import { mod, wrapA } from '../core/math.js';   // page-only module: kept OUT of src/net so the network build id does not change
import { SIM_DT } from '../core/clock.js';

export const HORIZON_MAX_S = 1.0;   // dead-reckon at most 1 s past the newest snapshot (then hold)
export const LAT_HORIZON_S = 0.15;  // lateral velocity applies only briefly (lane changes are short)
export const LAT_V_MAX = 12;        // m/s clamp on the lateral velocity estimate
export const SOFT_RATE = 4;         // 1/s: visual offset decays with a 250 ms time constant
export const SOFT_MAX_SPEED = 25;   // m/s: an offset never closes faster than this (no visible lunge)
export const SNAP_M = 30;           // larger along-track error: snap (counted)
export const RANK_BAND_M = 2;       // HUD: a pairwise order flips only after the gap crosses +-2 m

export class RemotePresenter {
  constructor(track) {
    this.td = track; this.L = track.MAIN.L;
    this.cars = new Map();   // id -> { a, b (compact rows), ka, kb (steps), off: {s,d}, lastT, shown }
    this.fo = []; this.lastK = -1;
    this.order = new Map();  // id -> +1 (I am ahead) / -1 (behind), sticky with RANK_BAND_M
    this.stats = { snaps: 0, outOfOrder: 0, snaps_hard: 0, horizonS: [], soft: [] };
  }
  // authoritative snapshot (as forwarded to the page: { k, sn, ph, a, fo })
  push(s) {
    if (s.k == null || s.k <= this.lastK) { this.stats.outOfOrder++; return; }
    this.lastK = s.k; this.stats.snaps++; this.fo = s.fo || [];
    for (const x of s.a) {
      let c = this.cars.get(x[0]);
      if (!c) { c = { a: null, b: null, ka: 0, kb: 0, off: { s: 0, d: 0 }, lastT: null, shown: null }; this.cars.set(x[0], c); }
      // re-anchor: what we would draw at the last drawn time with the old data stays on screen;
      // the difference to the new estimate becomes the visual offset (decays in sample()).
      if (c.b && c.lastT != null) {
        const old = this.extrap(c, c.lastT), oldC = { a: c.b, b: x, ka: c.kb, kb: s.k };
        const neu = this.extrap(oldC, c.lastT);
        if (old.br !== neu.br || !!x[11] !== !!c.b[11]) { c.off.s = 0; c.off.d = 0; }
        else {
          let ds = old.s - neu.s; if (!neu.br) { if (ds > this.L / 2) ds -= this.L; if (ds < -this.L / 2) ds += this.L; }
          const ns = c.off.s + ds, nd = c.off.d + (old.d - neu.d);
          if (Math.abs(ns) > SNAP_M) { c.off.s = 0; c.off.d = 0; this.stats.snaps_hard++; }
          else { c.off.s = ns; c.off.d = nd; if (this.stats.soft.length < 50000) this.stats.soft.push(Math.abs(ds)); }
        }
      }
      c.a = c.b; c.ka = c.kb; c.b = x; c.kb = s.k;
    }
  }
  // dead-reckoned state of car record c at local step T (fractional allowed)
  extrap(c, T) {
    const x = c.b, br = x[1] === 1, L = this.L;
    const h = Math.max(0, Math.min(HORIZON_MAX_S, (T - c.kb) * SIM_DT));
    const moving = !x[11];
    const vs = moving ? x[6] * Math.cos(x[5]) : 0;
    let vd = 0;
    if (moving && c.a && c.a[1] === x[1] && c.kb > c.ka) vd = Math.max(-LAT_V_MAX, Math.min(LAT_V_MAX, (x[3] - c.a[3]) / ((c.kb - c.ka) * SIM_DT)));
    let s = x[2] + vs * h; if (!br) s = mod(s, L);
    return { br, s, d: x[3] + vd * Math.min(h, LAT_HORIZON_S), prog: x[8] + vs * h, h };
  }
  // write the presented state of racer `id` at local step T into `out` (same fields as Interpolator.write)
  sample(id, _serverNow, out, { ownStep }) {
    const c = this.cars.get(id); if (!c || !c.b) return false;
    const T = ownStep, x = c.b, e = this.extrap(c, T);
    // decay the visual offset by the wall time elapsed in local steps, closing at most SOFT_MAX_SPEED
    if (c.lastT != null && T > c.lastT) {
      const dt = (T - c.lastT) * SIM_DT, k = Math.exp(-SOFT_RATE * dt);
      const cap = SOFT_MAX_SPEED * dt;
      const ns = c.off.s * k, nd = c.off.d * k;
      c.off.s = Math.abs(c.off.s - ns) > cap ? c.off.s - Math.sign(c.off.s) * cap : ns;
      c.off.d = nd;
    }
    c.lastT = T;
    if (this.stats.horizonS.length < 50000) this.stats.horizonS.push(e.h);
    let s = e.s + c.off.s; if (!e.br) s = mod(s, this.L);
    out.path = e.br ? this.td.BR : this.td.MAIN; out.s = s; out.d = e.d + c.off.d; out.h = x[4]; out.psi = x[5]; out.speed = x[6];
    out.va = x[6] * Math.cos(x[5]); out.vd = -x[6] * Math.sin(x[5]);
    out.lap = x[7]; out.prog = e.prog + c.off.s; out.boost = !!x[9]; out.finished = !!x[10]; out.netCrashed = !!x[11]; out.rollNet = x[12]; out.steer = x[13]; out.drift = !!x[14]; out.thr = x[15];
    c.shown = out.prog;
    return true;
  }
  // HUD position for the local car: server finish order first, then presented progress with a sticky
  // +-RANK_BAND_M band per opponent (no flicker while two cars are side by side).
  rank(you, ownProg, ownFinished) {
    const fo = this.fo; const fi = fo.indexOf(you);
    if (fi >= 0) return fi + 1;
    let ahead = 0;
    for (const [id, c] of this.cars) {
      if (id === you) continue;
      if (fo.includes(id)) { ahead++; continue; }
      if (ownFinished) { this.order.set(id, 1); continue; }
      if (c.shown == null) continue;
      const gap = ownProg - c.shown; let o = this.order.get(id);
      if (o == null) o = gap >= 0 ? 1 : -1;
      else if (o > 0 && gap < -RANK_BAND_M) o = -1; else if (o < 0 && gap > RANK_BAND_M) o = 1;
      this.order.set(id, o); if (o < 0) ahead++;
    }
    return ahead + 1;
  }
}
// Local prediction step from a published view's sim time. The predictor starts at the race message's
// step/time and adds SIM_DT per step; reconciliation copies the server's time, so this is exact up to
// float rounding (verified against Predictor.seq in tests/net/smooth.mjs). Keeps src/net unchanged.
export function stepOf(viewTime, raceMsg) { return raceMsg.step + Math.round((viewTime - raceMsg.snap.time) / SIM_DT); }
export { wrapA };
