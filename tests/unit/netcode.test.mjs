// Gate 2 (determinism) + client netcode units: predictor parity with the authoritative sim,
// reconcile/replay correctness, interpolation, clock sync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../../src/core/sim.js';
import { SIM_DT } from '../../src/core/clock.js';
import { MAP_KEYS } from '../../src/core/maps.js';
import { Predictor, Interpolator, ClockSync } from '../../src/net/netcode.js';
import { encodeFrame, decodeFrame, compactRacer } from '../../src/net/protocol.js';
const J = x => JSON.stringify(x);
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const JC = x => JSON.stringify(canon(x));
const frameAt = (k, n) => encodeFrame({ up: 1, down: (n + 37 * k) % 900 < 30 ? 1 : 0, left: Math.sin(n * 0.013 + k) > 0.6 ? 0.7 : 0, right: Math.sin(n * 0.011 + 2 * k) > 0.65 ? 1 : 0, boost: (n + 100 * k) % 500 < 90 ? 1 : 0 });

test('determinism: snapshot -> JSON -> import continues identically for 12 s with collisions, boost and a respawn, on all 3 maps; PRNG continues', () => {
  for (const map of MAP_KEYS) {
    const mk = seed => { const s = createSim({ seed }); s.setMode('expert'); s.setTrack(map); s.addSeats([{ id: 'h1', kind: 'human' }, { id: 'h2', kind: 'human' }, { id: 'b1', kind: 'bot' }, { id: 'b2', kind: 'bot' }], 'h1'); return s; };
    const A = mk(77); const cnt = { bump: 0, crash: 0, respawn: 0, boostSteps: 0 };
    A.events = { bump: () => cnt.bump++, racer: t => { if (t in cnt) cnt[t]++; } };
    A.startRace(); let n = 0;
    const drive = (S, n) => S.racers.forEach((r, k) => { if (!r.isAI) decodeFrame(frameAt(k, n), r.input); });
    for (; n < 600; n++) { drive(A, n); A.step(SIM_DT); }
    // force contact: h2 right behind/inside h1; force h2 off an edge later (respawn path)
    const [h1, h2] = A.racers; Object.assign(h2, { path: h1.path, s: h1.s - 1, d: h1.d + 0.8, va: h1.va + 15, prevS: h1.s - 1 }); h2.lastRd = A.rdist(h2.path, h2.s); h2.prog = h1.prog - 1;
    const mid = JSON.parse(J(A.snapshot()));
    const B = mk(31337); B.importSnapshot(mid); B.events = null;
    assert.equal(J(B.snapshot()), J(A.snapshot()), `${map}: import reproduces state`);
    for (let m = n; m < n + 1440; m++) {   // 12 s
      if (m === n + 300 && map === 'legacy') for (const S of [A, B]) { const r = S.racers[1]; r.path = S.track.BR; r.s = 100; r.prevS = 100; r.d = 30; r.va = 40; r.lastRd = S.rdist(r.path, r.s); }   // off the rail-less loop branch
      drive(A, m); A.step(SIM_DT); drive(B, m); B.step(SIM_DT);
      if (A.racers[0].boost) cnt.boostSteps++;
    }
    assert.equal(J(B.snapshot()), J(A.snapshot()), `${map}: identical after 12 s`);
    assert.equal(B.rngState, A.rngState, `${map}: PRNG continuation`);
    assert.ok(cnt.bump >= 1, `${map}: collision exercised (${cnt.bump})`); assert.ok(cnt.boostSteps >= 10, `${map}: boost exercised (${cnt.boostSteps} steps)`);
    if (map === 'legacy') assert.ok(cnt.crash >= 1 && cnt.respawn >= 1, `${map}: crash+respawn exercised ${J(cnt)}`);   // Velocity/Kage have rails everywhere: no crash is possible there by design
    assert.notEqual(A.racers[0].input, A.racers[1].input, 'two humans have separate input objects');
  }
});
function serverAndRaceMsg(map, seats, you) {
  const S = createSim({ seed: 9 }); S.setMode('assisted'); S.setTrack(map); S.addSeats(seats, null);
  for (const r of S.racers) if (!r.isAI) r.wallLim = 1.2;
  const msg = { seed: 9, map, mode: 'assisted', you, step: 0, snap: JSON.parse(J(S.snapshot())) };
  return { S, msg };
}
test('predictor parity: the client predictor fed the same frames matches the server racer exactly (solo seat, all maps)', () => {
  for (const map of MAP_KEYS) {
    const { S, msg } = serverAndRaceMsg(map, [{ id: 'p1', kind: 'human' }], 'p1');
    const P = new Predictor(msg);
    for (let n = 0; n < 1800; n++) { const f = frameAt(0, n); P.step(f); P.hist.clear(); if (n === 0) { decodeFrame(f, S.racers[0].input); S.startRace(); } decodeFrame(f, S.racers[0].input); S.step(SIM_DT); }
    assert.equal(JC(P.sim.racerState('p1')), JC(S.racerState('p1')), map);
  }
});
test('reconcile: reset to the server state at the ack + replay of pending frames == uninterrupted prediction; corrections ~0; replay is silent', () => {
  const { S, msg } = serverAndRaceMsg('technical', [{ id: 'p1', kind: 'human' }], 'p1');
  const P = new Predictor(msg); const sfx = []; P.sim.events = { sfx: () => sfx.push(1), flash: () => sfx.push(1), cp: () => sfx.push(1) };
  const frames = []; for (let n = 0; n < 2400; n++) frames.push(frameAt(1, n));
  let sN = 0; const serverStep = () => { const f = frames[sN]; if (sN === 0) { decodeFrame(f, S.racers[0].input); S.startRace(); } decodeFrame(f, S.racers[0].input); S.step(SIM_DT); sN++; };
  for (let n = 0; n < 2400; n++) {
    P.step(frames[n]);
    if (n >= 12) serverStep();   // server runs 12 steps behind (100 ms lead)
    if (n % 6 === 5 && sN > 0) {
      const sfxBefore = sfx.length;
      const d = P.reconcile({ ack: sN - 1, me: JSON.parse(J(S.racerState('p1'))), tm: S.time, ph: 'race', dr: S.drones.map(x => [x.s, x.h, x.vh]) });
      assert.ok(d < 1e-6, `step ${n}: correction ${d}`); assert.equal(sfx.length, sfxBefore, 'no events during replay');
    }
  }
  assert.ok(P.pending <= 18, 'pending bounded by the lead: ' + P.pending);
  assert.ok(sfx.length > 0, 'forward prediction still emits presentation events');
});
test('reconcile: a server-side push (contact) is corrected; small error blended, large error snapped', () => {
  const { S, msg } = serverAndRaceMsg('velocity', [{ id: 'p1', kind: 'human' }], 'p1');
  const P = new Predictor(msg); for (let n = 0; n < 600; n++) { const f = frameAt(0, n); P.step(f); P.hist.clear(); if (n === 0) { decodeFrame(f, S.racers[0].input); S.startRace(); } decodeFrame(f, S.racers[0].input); S.step(SIM_DT); }
  const st = JSON.parse(J(S.racerState('p1'))); st.d += 0.8;   // the server pushed us sideways
  const d = P.reconcile({ ack: 599, me: st, tm: S.time, ph: 'race' }); assert.ok(d > 0.7 && d < 0.9, 'measured ' + d);
  assert.ok(P.correction.length() > 0.7); P.decay(0.25); assert.ok(P.correction.length() < 0.05, 'blended away within 250 ms');
  st.d += 6; P.reconcile({ ack: 599, me: st, tm: S.time, ph: 'race' }); assert.equal(P.correction.length(), 0); assert.equal(P.stats.hard, 1);
});
test('predictor stops at 360 un-acked frames (bounded pending queue)', () => {
  const { msg } = serverAndRaceMsg('velocity', [{ id: 'p1', kind: 'human' }], 'p1'); const P = new Predictor(msg);
  let ok = 0; for (let n = 0; n < 500; n++) if (P.step(frameAt(0, n))) ok++; assert.equal(ok, 360); assert.equal(P.pending, 360);
});
test('interpolator: renders 120 ms in the past, wraps the lap seam, bounded extrapolation, snaps on path change', () => {
  const S = createSim({ seed: 1 }); S.setTrack('legacy'); S.addSeats([{ id: 'a', kind: 'human' }, { id: 'b', kind: 'bot' }], null);
  const I = new Interpolator(S.track, 120), L = S.track.MAIN.L, r = S.racers[0];
  const snap = (t, s, br = 0, speed = 80) => { r.s = s; r.speed = speed; r.psi = 0; r.path = br ? S.track.BR : S.track.MAIN; return { sn: t, a: [compactRacer(r, S.track.BR)] }; };
  I.push(snap(1000, L - 2)); I.push(snap(1050, 2)); const o = {};
  I.sample('a', 1145, o); assert.ok(o.s < 0.01 || L - o.s < 0.01, 'seam: halfway between L-2 and 2 is the line, not mid-lap: ' + o.s);
  I.sample('a', 1132, o); assert.ok(Math.abs(o.s - (L - 1.04)) < 0.01, 'before the seam ' + o.s);
  I.sample('a', 1050 + 120 + 500, o); assert.ok(Math.abs(o.s - mod0(2 + 80 * 0.1, L)) < 0.01, 'extrapolation capped at 100 ms: ' + o.s);
  assert.ok(I.stats.underruns >= 1);
  I.push(snap(1100, 50, 1)); I.sample('a', 1100 + 120 - 25, o); assert.equal(o.path, S.track.BR, 'branch switch is a snap, not a lerp across paths');
});
const mod0 = (a, n) => ((a % n) + n) % n;
test('clock sync: estimates server offset from the lowest-RTT samples despite queueing delay', () => {
  const C = new ClockSync(); const off = 123456;
  for (let i = 0; i < 12; i++) { const c = i * 100, up = 20 + (i % 3) * 40, down = 20; C.sample(c, c + up + off, c + up + down); }
  assert.ok(Math.abs(C.offset - off) < 25, 'offset ' + (C.offset - off)); assert.equal(C.rtt, 40);
});
