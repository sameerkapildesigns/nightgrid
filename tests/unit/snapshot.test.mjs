// M4-1: per-racer inputs, multi-seat races, complete snapshot/import (incl. PRNG) parity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../../src/core/sim.js';
import { SIM_DT } from '../../src/core/clock.js';
import { MAP_KEYS } from '../../src/core/maps.js';

// deterministic scripted driver: inputs are a pure function of (racer index, step)
const script = (k, n) => ({ up: 1, down: (n + 37 * k) % 900 < 40 ? 1 : 0, left: Math.sin(n * 0.013 + k) > 0.6 ? 1 : 0, right: Math.sin(n * 0.011 + 2 * k) > 0.65 ? 1 : 0, boost: (n + 100 * k) % 700 < 60 ? 1 : 0, drift: 0 });
const drive = (sim, n) => sim.racers.forEach((r, k) => { if (!r.isAI) Object.assign(r.input, script(k, n)); });
const J = sn => JSON.stringify(sn);
function mpSim(seed, map, seats, focus = null, mode = 'expert') { const s = createSim({ seed }); s.setMode(mode); s.setTrack(map); s.addSeats(seats, focus); return s; }
const SEATS = { '1h3b': [{ id: 'h1', kind: 'human' }, { id: 'b1', kind: 'bot' }, { id: 'b2', kind: 'bot' }, { id: 'b3', kind: 'bot' }],
  '2h2b': [{ id: 'h1', kind: 'human' }, { id: 'h2', kind: 'human' }, { id: 'b1', kind: 'bot' }, { id: 'b2', kind: 'bot' }],
  '4h': [{ id: 'h1', kind: 'human' }, { id: 'h2', kind: 'human' }, { id: 'h3', kind: 'human' }, { id: 'h4', kind: 'human' }] };

test('snapshot -> JSON -> import into a sim from a DIFFERENT seed continues bit-identically (all maps, SP + MP, both modes)', () => {
  for (const map of MAP_KEYS) for (const [label, mk] of [
    ['sp', seed => { const s = createSim({ seed }); s.setTrack(map); s.addRacers(['GHOST', 'VEX', 'BLITZ'].map(name => ({ name }))); return s; }],
    ['2h2b', seed => mpSim(seed, map, SEATS['2h2b'], null, 'assisted')]]) {
    const A = mk(11); A.startRace(); let n = 0;
    for (; n < 1200; n++) { drive(A, n); A.step(SIM_DT); }
    const mid = JSON.parse(J(A.snapshot()));
    const B = mk(999); B.importSnapshot(mid);
    assert.equal(J(B.snapshot()), J(A.snapshot()), `${map}/${label}: import reproduces state`);
    for (let m = n; m < n + 1800; m++) { drive(A, m); A.step(SIM_DT); drive(B, m); B.step(SIM_DT); }
    assert.equal(J(B.snapshot()), J(A.snapshot()), `${map}/${label}: identical after 15 s more`);
    assert.equal(B.rngState, A.rngState);
  }
});
test('PRNG state is part of the snapshot (AI decisions after import match)', () => {
  const A = mpSim(5, 'legacy', SEATS['1h3b']); A.startRace(); for (let n = 0; n < 600; n++) { drive(A, n); A.step(SIM_DT); }
  const sn = A.snapshot(); const r0 = A.rngState; assert.equal(sn.rng, r0);
  A.R(); assert.notEqual(A.rngState, r0);   // the generator advanced; the snapshot keeps the pre-draw state
  const B = mpSim(1, 'legacy', SEATS['1h3b']); B.importSnapshot(sn); assert.equal(B.rngState, r0);
});
test('same seed + same per-racer inputs => identical races (server/browser shared core)', () => {
  const a = mpSim(42, 'technical', SEATS['4h']), b = mpSim(42, 'technical', SEATS['4h']); a.startRace(); b.startRace();
  for (let n = 0; n < 3000; n++) { drive(a, n); drive(b, n); a.step(SIM_DT); b.step(SIM_DT); }
  assert.equal(J(a.snapshot()), J(b.snapshot()));
});
test('per-racer inputs: two humans with different inputs move differently; inputs are not shared', () => {
  const s = mpSim(3, 'velocity', [{ id: 'h1', kind: 'human' }, { id: 'h2', kind: 'human' }]); s.startRace(); const [h1, h2] = s.racers;
  assert.notEqual(h1.input, h2.input);
  for (let n = 0; n < 600; n++) { h1.input.up = 1; h2.input.up = 0; s.step(SIM_DT); }
  assert.ok(h1.speed > 40 && h2.speed < 1, `${h1.speed} vs ${h2.speed}`);
});
for (const [label, seats] of Object.entries(SEATS)) test(`MP race ${label}: every racer finishes, per-human lap/finish events, server has no presentation events`, () => {
  const s = mpSim(7, 'technical', seats); const ev = { racer: [], other: 0 };
  s.events = new Proxy({}, { get: (_, k) => k === 'racer' ? (type, r, d) => ev.racer.push([type, r.id, d]) : () => { ev.other++; } });
  for (const r of s.racers) if (!r.isAI) { r.autopilot = true; r.pers = { vmax: 92, lat: 84, acc: 26, brake: 46, off: 0, short: 0, aggr: 0, block: 0, boostUse: 0, margin: 4 }; }
  s.startRace(); let n = 0; while (!s.racers.every(r => r.finished) && n < 400 / SIM_DT) { s.step(SIM_DT); n++; }
  assert.ok(s.racers.every(r => r.finished), label);
  const humans = s.racers.filter(r => !r.isAI);
  for (const h of humans) { assert.equal(ev.racer.filter(e => e[0] === 'lap' && e[1] === h.id).length, 3); assert.equal(ev.racer.filter(e => e[0] === 'finish' && e[1] === h.id).length, 1); }
  assert.equal(ev.other, 0, 'no flash/sfx/cp events without a focus racer');
  assert.equal(s.phase, 'finished'); assert.equal(s.finishOrder.length, seats.length);
});
test('seat cap: 0 or MAX_RACERS+1 seats rejected, MAX_RACERS accepted', () => {
  const many = n => Array.from({ length: n }, (_, k) => ({ id: 'h' + k, kind: 'human' }));
  assert.throws(() => mpSim(1, 'velocity', [])); assert.throws(() => mpSim(1, 'velocity', many(21))); assert.doesNotThrow(() => mpSim(1, 'velocity', many(20)));
});
test('per-racer crash/respawn: a non-focus human who leaves the edgeless branch respawns', () => {
  const s = mpSim(2, 'legacy', [{ id: 'h1', kind: 'human' }, { id: 'h2', kind: 'human' }], 'h1'); s.startRace();
  const h2 = s.racers[1]; const kinds = []; s.events = { racer: (t, r) => { if (r === h2) kinds.push(t); } };
  h2.path = s.track.BR; h2.s = 100; h2.d = 30; h2.va = 40; h2.speed = 40; h2.prevS = 100; h2.lastRd = s.rdist(h2.path, h2.s);
  for (let n = 0; n < 400; n++) s.step(SIM_DT);
  assert.deepEqual(kinds.slice(0, 2), ['crash', 'respawn']); assert.equal(h2.crashed, 0); assert.equal(h2.path, s.track.MAIN);
});
