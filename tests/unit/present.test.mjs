// Deterministic regression tests for src/client/present.js (page-side presentation; no network, no clock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemotePresenter, OwnSmoother, stepOf, stepAt, HORIZON_MAX_S, SNAP_M, RANK_BAND_M, WORKER_CORR_RATE, OWN_EXTRAP_MAX_S, OWN_CORR_MAX_M } from '../../src/client/present.js';
import { SMOOTH_RATE } from '../../src/net/netcode.js';
import { SIM_DT } from '../../src/core/clock.js';

const L = 1000;
const TRACK = { MAIN: { L, name: 'main' }, BR: { L: 200, name: 'br' } };
// compact row: [id, br, s, d, h, psi, speed, lap, prog, boost, finished, crashed, roll, steer, drift, thr]
const row = (id, s, { br = 0, d = 0, speed = 60, prog = s, fin = 0, cr = 0, lap = 0 } = {}) => [id, br, s, d, 1, 0, speed, lap, prog, 0, fin, cr, 0, 0, 0, 1];
const snap = (k, rows, fo = []) => ({ k, sn: k * 8.33, ph: 'race', a: rows, fo });
const finite = o => ['s', 'd', 'h', 'psi', 'speed', 'prog'].every(k => Number.isFinite(o[k]));

test('constants agree with the worker netcode (soft correction re-filter assumes SMOOTH_RATE)', () => {
  assert.equal(WORKER_CORR_RATE, SMOOTH_RATE);
});
test('dead-reckons to the local step and is continuous across snapshots on a steady car', () => {
  const P = new RemotePresenter(TRACK), o = {};
  P.push(snap(0, [row('r', 100)])); P.push(snap(6, [row('r', 100 + 60 * 6 * SIM_DT)]));
  assert.ok(P.sample('r', 0, o, { ownStep: 30 }));
  assert.ok(Math.abs(o.s - (100 + 60 * 30 * SIM_DT)) < 1e-6, 'extrapolated to step 30');
  let prev = o.s;
  for (let T = 31; T < 120; T++) {
    if (T % 6 === 0) P.push(snap(T - 24, [row('r', 100 + 60 * (T - 24) * SIM_DT)]));   // snapshots arrive 24 steps late
    P.sample('r', 0, o, { ownStep: T }); assert.ok(Math.abs(o.s - prev - 60 * SIM_DT) < 1e-6, 'steady motion, no step at re-anchor'); prev = o.s;
  }
});
test('horizon is bounded: a silent server freezes the car after HORIZON_MAX_S', () => {
  const P = new RemotePresenter(TRACK), o = {};
  P.push(snap(0, [row('r', 100)]));
  P.sample('r', 0, o, { ownStep: 10000 });
  assert.ok(Math.abs(o.s - (100 + 60 * HORIZON_MAX_S)) < 1e-6);
});
test('wraps the lap seam (MAIN) without a jump', () => {
  const P = new RemotePresenter(TRACK), o = {};
  P.push(snap(0, [row('r', L - 1)]));
  let prev = null;
  for (let T = 0; T <= 6; T++) {
    P.sample('r', 0, o, { ownStep: T }); assert.ok(o.s >= 0 && o.s < L);
    if (prev != null) { let ds = o.s - prev; if (ds < -L / 2) ds += L; assert.ok(Math.abs(ds - 60 * SIM_DT) < 1e-6, `step ${T}: ${ds}`); }
    prev = o.s;
  }
  assert.ok(o.s < 5, 'crossed the seam');
});
test('branch change and crash reset the offset (no slide across topologies)', () => {
  const P = new RemotePresenter(TRACK), o = {};
  P.push(snap(0, [row('r', 100)])); P.sample('r', 0, o, { ownStep: 0 });
  P.push(snap(6, [row('r', 10, { br: 1 })])); P.sample('r', 0, o, { ownStep: 6 });
  assert.equal(o.path, TRACK.BR); assert.ok(Math.abs(o.s - 10) < 1e-6);
  P.push(snap(12, [row('r', 10 + 60 * 6 * SIM_DT, { br: 1, cr: 1, speed: 0 })])); P.sample('r', 0, o, { ownStep: 40 });
  assert.equal(o.netCrashed, true); assert.ok(Math.abs(o.s - (10 + 60 * 6 * SIM_DT)) < 1e-6, 'crashed: held, not extrapolated');
});
test('crossing the finish line: no backwards motion, no snap (server keeps finished cars driving)', () => {
  const P = new RemotePresenter(TRACK), o = {};
  let prev = null, k = 0; const v = T => (T < 120 ? 60 : 40);   // finishes at step 120, then rolls at 40 m/s
  const pos = T => { let s = 100; for (let i = 0; i < T; i++) s += v(i) * SIM_DT; return s; };
  for (let T = 0; T < 480; T++) {
    if (T % 6 === 0 && T >= 48) { k = T - 48; P.push(snap(k, [row('r', pos(k), { fin: k >= 120 ? 1 : 0, speed: v(k) })])); }   // 400 ms late
    if (T < 48) P.push(snap(0, [row('r', 100)]));
    if (!P.sample('r', 0, o, { ownStep: T })) continue;
    if (prev != null) assert.ok(o.s - prev >= -1e-9, `step ${T}: moved backwards ${o.s - prev}`);
    prev = o.s;
  }
  assert.equal(P.stats.snaps_hard, 0);
  assert.equal(o.finished, true);
});
test('snapshots stop (race over): motion is bounded by the horizon, then holds', () => {
  const P = new RemotePresenter(TRACK), o = {};
  P.push(snap(0, [row('r', 100, { fin: 1, speed: 40 })]));
  P.sample('r', 0, o, { ownStep: 1000 }); const a = o.s; P.sample('r', 0, o, { ownStep: 2000 });
  assert.equal(o.s, a); assert.ok(Math.abs(a - (100 + 40 * HORIZON_MAX_S)) < 1e-6);
});
test('large error snaps (counted); out-of-order snapshots ignored; outputs finite', () => {
  const P = new RemotePresenter(TRACK), o = {};
  P.push(snap(0, [row('r', 100)])); P.sample('r', 0, o, { ownStep: 0 });
  P.push(snap(6, [row('r', 100 + SNAP_M + 50)])); P.sample('r', 0, o, { ownStep: 6 });
  assert.equal(P.stats.snaps_hard, 1);
  P.push(snap(3, [row('r', 0)])); assert.equal(P.stats.outOfOrder, 1);
  P.push({ sn: 1, a: [], fo: [] }); assert.equal(P.stats.outOfOrder, 2, 'missing k is ignored');
  assert.ok(finite(o));
  assert.equal(P.sample('nobody', 0, o, { ownStep: 1 }), false);
});
test('soft offset closes smoothly, never faster than the cap', () => {
  const P = new RemotePresenter(TRACK), o = {};
  P.push(snap(0, [row('r', 100, { speed: 0 })])); P.sample('r', 0, o, { ownStep: 0 });
  P.push(snap(6, [row('r', 110, { speed: 0 })]));   // 10 m correction
  let prev = null;
  for (let T = 6; T < 6 + 360; T++) { P.sample('r', 0, o, { ownStep: T }); if (prev != null) assert.ok(Math.abs(o.s - prev) <= 25 * SIM_DT + 1e-9); prev = o.s; }
  assert.ok(Math.abs(o.s - 110) < 0.01, 'converged');
});
test('HUD rank: sticky band, server finish order authoritative, rematch-safe', () => {
  const P = new RemotePresenter(TRACK), o = {};
  P.push(snap(0, [row('me', 100), row('r', 100)]));
  P.sample('r', 0, o, { ownStep: 0 });
  assert.equal(P.rank('me', 100.5, false), 1);
  P.sample('r', 0, o, { ownStep: 0 }); assert.equal(P.rank('me', 100 - RANK_BAND_M + 0.5, false), 1, 'inside band: no flip');
  assert.equal(P.rank('me', 100 - RANK_BAND_M - 0.5, false), 2, 'outside band: flips');
  // the other car finished first per the server; I am ahead in my own (predicted) view: server wins
  P.push(snap(6, [row('me', 300, { fin: 0 }), row('r', 299, { fin: 1 })], ['r']));
  P.sample('r', 0, o, { ownStep: 6 });
  assert.equal(P.rank('me', 400, true), 2);
  P.push(snap(12, [row('me', 300, { fin: 1 }), row('r', 299, { fin: 1 })], ['r', 'me']));
  assert.equal(P.rank('me', 400, true), 2, 'server order');
  // rematch: a new presenter per race (game.js creates it per NetClient race), no carried state
  const Q = new RemotePresenter(TRACK); Q.push(snap(0, [row('me', 50), row('r', 40)])); Q.sample('r', 0, o, { ownStep: 0 });
  assert.equal(Q.rank('me', 50, false), 1);
});
test('stepOf / stepAt', () => {
  const m = { step: 10, snap: { time: 5 } };
  assert.equal(stepOf(5 + 20 * SIM_DT, m), 30); assert.ok(Math.abs(stepAt(5 + 20.5 * SIM_DT, m) - 30.5) < 1e-9);
});
// ---------------- OwnSmoother ----------------
const view = (time, s, { br = false, corr = [0, 0, 0], crashed = 0, d = 0 } = {}) => ({ time, me: { s, d, h: 1, psi: 0, br, crashed }, corr: { x: corr[0], y: corr[1], z: corr[2] } });
test('OwnSmoother: 60 Hz views drawn at 120 Hz move every frame by the same amount', () => {
  const S = new OwnSmoother(L); let t = 0, prev = null; const steps = [];
  for (let f = 0; f < 240; f++) {
    const now = f * 1000 / 120, vt = Math.floor(now / (1000 / 60)) * (1 / 60);   // view at 60 Hz
    const o = S.frame(view(vt, 100 + 60 * vt), now);
    if (prev != null && f > 4) steps.push(o.s - prev); prev = o.s; t = o.t;
  }
  const mn = Math.min(...steps), mx = Math.max(...steps);
  assert.ok(mn > 0.4 && mx < 0.6, `every frame moves ~0.5 m (min ${mn}, max ${mx})`);
  assert.ok(Number.isFinite(t));
});
test('OwnSmoother: bounded extrapolation, holds on branch change/crash, resets on a new race, wraps', () => {
  const S = new OwnSmoother(L);
  S.frame(view(0, 100), 0); S.frame(view(1 / 60, 101), 1000 / 60);
  const o = S.frame(view(1 / 60, 101), 10000);   // views stopped: extrapolation capped
  assert.ok(o.s - 101 <= 60 * OWN_EXTRAP_MAX_S + 1e-6);
  S.frame(view(2 / 60, 5, { br: true }), 10020); const b = S.frame(view(2 / 60, 5, { br: true }), 10025);
  assert.equal(b.br, true); assert.equal(b.s, 5, 'branch change: hold');
  const c = S.frame(view(3 / 60, 6, { br: true, crashed: 1 }), 10040); assert.equal(c.s, 6, 'crash: hold');
  const n = S.frame(view(0, 50), 20000); assert.equal(n.s, 50, 'new race (time went back): reset');
  const W = new OwnSmoother(L); W.frame(view(0, L - 0.5), 0); W.frame(view(1 / 60, 0.5), 1000 / 60);
  const w = W.frame(view(1 / 60, 0.5), 1000 / 60 + 8); assert.ok(w.s >= 0 && w.s < 2, `wrapped, got ${w.s}`);
});
test('OwnSmoother.softCorr: reconciliation jumps pass through, decay is slower, magnitude capped', () => {
  const S = new OwnSmoother(L);
  const c0 = { ...S.softCorr(view(0, 0, { corr: [0, 0, 0] })) };
  const c1 = { ...S.softCorr(view(SIM_DT, 0, { corr: [2, 0, 0] })) };   // reconcile adds 2 m
  assert.ok(Math.abs(c1.x - 2) < 1e-9);
  // worker decays at 12/s; the page keeps more of the offset (5/s)
  const w = 2 * Math.exp(-WORKER_CORR_RATE * 0.1), c2 = S.softCorr(view(SIM_DT + 0.1, 0, { corr: [w, 0, 0] }));
  assert.ok(c2.x > w && Math.abs(c2.x - 2 * Math.exp(-5 * 0.1)) < 1e-9);
  const c3 = S.softCorr(view(SIM_DT + 0.11, 0, { corr: [w + 50, 0, 0] })); assert.ok(Math.hypot(c3.x, c3.y, c3.z) <= OWN_CORR_MAX_M + 1e-9);
  assert.ok(c0.x === 0);
});
