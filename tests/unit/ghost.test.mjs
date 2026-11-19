// M5 ghost rule (approved 18 Nov 2026): multiplayer rooms have NO car-to-car contact (no push, no impulse,
// no bump event) for humans and bots; walls and drones unchanged; single-player keeps contact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../../src/core/sim.js';
import { SIM_DT } from '../../src/core/clock.js';
import { RoomServer } from '../../server/room-server.js';
import { decodeFrame, encodeFrame } from '../../src/net/protocol.js';

// two human racers forced to overlap (same s, 1 m apart laterally), identical full-throttle input
function overlap(ghost, steps = 360) {
  const bumps = [];
  const sim = createSim({ seed: 9, events: new Proxy({}, { get: (_, k) => (...a) => { if (k === 'bump') bumps.push(a[2]); } }) });
  sim.setTrack('casino');
  sim.addSeats([{ id: 'a', kind: 'human', name: 'A' }, { id: 'b', kind: 'human', name: 'B' }], 'a');
  sim.ghost = ghost;
  const [A, B] = sim.racers; B.input = {};
  A.s=15;B.s = A.s; B.d = A.d + 1; sim.pose(B);
  sim.drones.length = 0;   // isolate car-to-car
  sim.startRace();
  const f = encodeFrame({ up: 1 }); decodeFrame(f, sim.input); decodeFrame(f, B.input);
  let minSep = Infinity, maxSep = 0;
  for (let i = 0; i < steps; i++) { sim.step(SIM_DT); const sep = Math.abs(B.d - A.d); minSep = Math.min(minSep, sep); maxSep = Math.max(maxSep, sep); }
  return { A, B, minSep, maxSep, bumps, sim };
}

test('ghost: overlapping cars pass through (no push, no impulse, no bump event)', () => {
  const g = overlap(true);
  assert.ok(Math.abs(g.maxSep - 1) < 1e-6 && Math.abs(g.minSep - 1) < 1e-6, `lateral gap stays 1 m (min ${g.minSep}, max ${g.maxSep})`);
  assert.equal(g.bumps.length, 0);
  assert.ok(Math.abs(g.A.s - g.B.s) < 1e-6, 'identical along-track progress');
  assert.ok(Math.abs(g.A.va - g.B.va) < 1e-6, 'identical speed: no impulse');
});
test('contact still exists outside ghost mode (single-player default) - control', () => {
  const c = overlap(false);
  assert.ok(c.maxSep >= 2.8 - 1e-6, `pushed apart to the contact width (max ${c.maxSep})`);
});
// bots: the focus human is placed inside two bots repeatedly; with contact a bump event fires and the
// human's lateral position is pushed; in ghost mode neither happens (bot steering may still react: that is
// AI behaviour, not contact)
function botOverlap(ghost, away = 0) {
  const bumps = []; const sim = createSim({ seed: 5, events: new Proxy({}, { get: (_, k) => (...a) => { if (k === 'bump') bumps.push(a[2]); } }) });
  sim.setTrack('velocity'); sim.addSeats([{ id: 'h', kind: 'human', name: 'H' }, { id: 'b1', kind: 'bot', pers: 'VEX' }, { id: 'b2', kind: 'bot', pers: 'BLITZ' }], 'h');
  sim.ghost = ghost; sim.drones.length = 0; sim.startRace(); decodeFrame(encodeFrame({ up: 1 }), sim.input);
  const H = sim.racers[0]; const trace = [];
  for (let i = 0; i < 900; i++) {
    for (const r of sim.racers.slice(1)) { r.s = H.s + 0.5 + away; r.d = H.d + 0.4; }
    sim.step(SIM_DT); trace.push([H.s, H.d, H.va, H.vd]);
  }
  return { bumps: bumps.length, trace };
}
test('ghost: bots overlapping the player cause no bump and no push (control: contact on)', () => {
  const g = botOverlap(true), ref = botOverlap(true, 200), c = botOverlap(false), cref = botOverlap(false, 200);
  assert.equal(g.bumps, 0);
  assert.deepEqual(g.trace, ref.trace, 'human trajectory identical with bots inside it vs 200 m away');
  // Continuous forced overlap can be resolved as a push without a high-speed impact event.
  assert.notDeepEqual(c.trace, cref.trace, 'control: contact changes the human trajectory');
});
test('ghost survives snapshot/import (predictor and server agree)', () => {
  const s = createSim({ seed: 1 }); s.setTrack('velocity'); s.addSeats([{ id: 'a', kind: 'human' }, { id: 'b', kind: 'bot' }], 'a'); s.ghost = true;
  const t = createSim({ seed: 1 }); t.importSnapshot(JSON.parse(JSON.stringify(s.snapshot())));
  assert.equal(t.ghost, true);
  const u = createSim({ seed: 1 }); u.setTrack('velocity'); u.addSeats([{ id: 'a', kind: 'human' }], 'a');
  const v = createSim({ seed: 1 }); v.importSnapshot(JSON.parse(JSON.stringify(u.snapshot())));
  assert.equal(v.ghost, false, 'single-player snapshots stay contact-on');
});
test('room server races are ghost and say so in the race message', () => {
  const sent = [];
  const timers = { now: () => 1000, setInterval: () => 1, clearInterval: () => { }, setTimeout: () => 1, clearTimeout: () => { } };
  const rs = new RoomServer({ code: 'ABCDEF', build: 'b', timers, random: a => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } });
  const conn = { send: t => sent.push(JSON.parse(t)), close: () => { } };
  rs.connect(conn); rs.message(conn, JSON.stringify({ t: 'hello', p: 3, build: 'b', name: 'H' }));
  rs.message(conn, JSON.stringify({ t: 'addBot' })); rs.message(conn, JSON.stringify({ t: 'ready', ready: true })); rs.message(conn, JSON.stringify({ t: 'start' }));
  const race = sent.find(m => m.t === 'race');
  assert.ok(race, 'race started'); assert.equal(rs.sim.ghost, true); assert.equal(race.snap.ghost, true);
});
