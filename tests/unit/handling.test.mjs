// M3-C/D: driving modes, steering response, braking/drift, pace caps, corner speeds, AI scaling, records per mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../../src/core/sim.js';
import { SIM_DT } from '../../src/core/clock.js';
import { MAP_KEYS } from '../../src/core/maps.js';
import { MODE, PACE, PACE_TARGETS, paceFor } from '../../src/core/pace.js';
import { recordKey, createRecordStore, memoryStorage } from '../../src/core/records.js';
import { Vec3 } from '../../src/core/vec.js';

const mkF = () => ({ P: new Vec3(), T: new Vec3(), U: new Vec3(), R: new Vec3() });
const cascade = (a, b, up) => { let s = up ? 0 : 1, y = s, t = 0; while ((up ? y < 0.9 : y > 0.1) && t < 3) { s += ((up ? 1 : 0) - s) * Math.min(1, SIM_DT * a); y += (s - y) * Math.min(1, SIM_DT * b); t += SIM_DT; } return t; };
function newSim(map, mode, seed = 3) { const sim = createSim({ seed }); sim.setMode(mode); sim.setTrack(map); sim.addRacers(['GHOST', 'VEX', 'BLITZ'].map(name => ({ name }))); return sim; }
// input-only driver (keys like a person) + per-map tight-window stats
function drive(map, mode, { laps = 1, boost = false } = {}) {
  const sim = newSim(map, mode); const p = sim.player; p.carMods = { vmax: 1.035, acc: 0.95, grip: 0.96 };
  const M = sim.track.MAIN, kw = new Float32Array(M.N); for (let i = 0; i < M.N; i++) { let m = 0; for (let j = -20; j <= 20; j += 3) m = Math.max(m, Math.abs(M.KG[(i + j + M.N) % M.N])); kw[i] = m; }
  const kmax = Math.max(...kw), tight = i => kw[i] > kmax * 0.9;
  const st = { aiT: [], pT: [], pMax: 0, aiMax: 0, crashes: 0, laps: [] }; sim.events = { crash: () => st.crashes++, lap: l => st.laps.push(l) };
  sim.input.up = 1; sim.startRace();
  for (let n = 0; n < 500 / SIM_DT && !(p.lap >= laps && sim.racers.slice(1).every(r => r.lap >= 1)); n++) {
    // M7: steer around road traffic like a person would (base passed only because drone contact added random
    // lateral kicks every tick that shook the centred bot off a lane-0 drone; contact is deterministic now).
    let aim = 0; for (const dr of sim.drones) { let g = dr.s - p.s; if (g < -M.L / 2) g += M.L; if (p.path === M && g > -3 && g < 45 && Math.abs(dr.d - p.d) < 4) aim = dr.d + (dr.d > 0 ? -4.5 : 4.5); }
    const f = sim.frameAt(p.path, p.s + 10, mkF()); const e = Math.asin(Math.max(-0.5, Math.min(0.5, (p.d - aim) * 0.05))) + f.path.KG[f.i] * 8 - p.psi;
    sim.input.left = e > 0.03 ? 1 : 0; sim.input.right = e < -0.03 ? 1 : 0; sim.input.boost = boost ? 1 : 0; if (boost) p.meter = 1;
    sim.step(SIM_DT);
    if (p.lap === 0 && p.path === M) { st.pMax = Math.max(st.pMax, p.speed); if (tight(Math.round(p.s / M.ds) % M.N)) st.pT.push(p.speed); }
    for (const r of sim.racers.slice(1)) if (r.lap === 0 && r.path === M) { st.aiMax = Math.max(st.aiMax, r.speed); if (tight(Math.round(r.s / M.ds) % M.N)) st.aiT.push(r.speed); }
  }
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1] * 3.6; };
  return Object.assign(st, { sim, p, aiTmed: med(st.aiT), pTmed: med(st.pT) });
}
const RUN = {}; for (const m of MAP_KEYS) for (const mode of ['assisted', 'expert']) RUN[m + mode] = drive(m, mode);

test('steering response: total 90% (steer filter -> yaw filter) inside the target bands; v5b was 0.64/0.48 s', () => {
  const A = MODE.assisted, E = MODE.expert;
  const r = { aR: cascade(A.steerRise, A.yaw, true), aN: cascade(A.steerNeutral, A.yaw, false), eR: cascade(E.steerRise, E.yaw, true), eN: cascade(E.steerNeutral, E.yaw, false) };
  assert.ok(r.aR >= 0.30 && r.aR <= 0.35, JSON.stringify(r)); assert.ok(r.aN >= 0.20 && r.aN <= 0.25, JSON.stringify(r));
  assert.ok(r.eR >= 0.25 && r.eR <= 0.30, JSON.stringify(r)); assert.ok(r.eN >= 0.18 && r.eN <= 0.22, JSON.stringify(r));
  assert.ok(1 / A.yaw < 0.08 && 1 / E.yaw < 0.08, 'no large stacked yaw delay');
});
test('in-sim steering step reaches 90% of steady yaw rate within the band (Assisted, 30 m/s)', () => {
  const sim = newSim('velocity', 'assisted'); const p = sim.player; sim.startRace(); p.va = 30; p.speed = 30;
  const yaw = []; sim.input.right = 1; for (let n = 0; n < 120; n++) { sim.step(SIM_DT); p.va = 30; yaw.push(p.yawV); }
  const ss = yaw[yaw.length - 1], t90 = yaw.findIndex(v => Math.abs(v) >= 0.9 * Math.abs(ss)) * SIM_DT;
  assert.ok(t90 > 0.2 && t90 <= 0.36, `t90 ${t90.toFixed(3)} s (includes the racing-line assist)`);
});
test('Assisted braking: initial ~20 m/s^2 ramping to full; brake+steer is still braking (no hidden airbrake)', () => {
  for (const steer of [0, 1]) {
    const sim = newSim('velocity', 'assisted'); const p = sim.player; sim.startRace(); p.va = 40; p.speed = 40;
    sim.input.down = 1; sim.input.right = steer; const v = [p.va]; for (let n = 0; n < 72; n++) { sim.step(SIM_DT); v.push(Math.hypot(p.va, p.vd)); }
    const d0 = (v[0] - v[6]) / (6 * SIM_DT), d1 = (v[60] - v[72]) / (12 * SIM_DT);
    assert.ok(d0 > 15 && d0 < 30, `steer ${steer}: initial decel ${d0.toFixed(1)}`); assert.ok(d1 > 38, `steer ${steer}: later decel ${d1.toFixed(1)}`);
    assert.equal(p.drift && !sim.input.drift ? 'airbrake' : 'ok', 'ok');
  }
});
test('Expert: full 46 m/s^2 braking; drift is explicit (drift key + steer) and is the only airbrake', () => {
  const run = (drift) => { const sim = newSim('velocity', 'expert'); const p = sim.player; sim.startRace(); p.va = 40; sim.input.down = drift ? 0 : 1; sim.input.drift = drift ? 1 : 0; sim.input.right = 1; const v0 = p.va; for (let n = 0; n < 12; n++) sim.step(SIM_DT); return (v0 - Math.hypot(p.va, p.vd)) / (12 * SIM_DT); };
  const brake = run(false), drift = run(true);
  assert.ok(brake > 38, `brake ${brake.toFixed(1)}`); assert.ok(drift < 20, `drift decel ${drift.toFixed(1)}`);
});
test('Assisted edge correction is capped at 15% and disabled while the player steers', () => {
  const sim = newSim('velocity', 'assisted'); const p = sim.player; sim.startRace(); p.va = 30; p.d = sim.track.MAIN.WR[0] - 1.3;
  sim.step(SIM_DT); assert.ok(p.edgeAssist < 0 && p.edgeAssist >= -0.15, String(p.edgeAssist));
  sim.input.left = 1; sim.step(SIM_DT); assert.equal(p.edgeAssist, 0);
});
test('pace caps: Assisted top speed == cap (fastest car, no boost), never exceeded incl. AI, gravity, drafting', () => {
  for (const m of MAP_KEYS) {
    const r = RUN[m + 'assisted'], cap = PACE[m].assisted.kmh;
    assert.ok(r.pMax * 3.6 <= cap[0] + 0.5 && r.pMax * 3.6 > cap[0] * 0.95, `${m} player max ${(r.pMax * 3.6).toFixed(1)} vs ${cap[0]}`);
    assert.ok(r.aiMax * 3.6 <= cap[1] + 0.5, `${m} AI max ${(r.aiMax * 3.6).toFixed(1)} vs boost cap ${cap[1]}`);
    const b = drive(m, 'assisted', { boost: true }); assert.ok(b.pMax * 3.6 <= cap[1] + 0.5 && b.pMax * 3.6 > cap[0], `${m} boosted max ${(b.pMax * 3.6).toFixed(1)}`);
  }
});
test('Expert reaches its higher normal cap; other cars scale by modifier/1.035', () => {
  for (const m of MAP_KEYS) { const r = RUN[m + 'expert'], cap = PACE[m].expert.kmh[0]; assert.ok(r.pMax * 3.6 > cap * 0.97, `${m} ${(r.pMax * 3.6).toFixed(0)} vs ${cap}`); }
  const p = paceFor('velocity', 'assisted'); assert.ok(Math.abs(p.normal * 3.6 - 240) < 1e-9 && Math.abs(p.normal * 0.985 / 1.035 * 3.6 - 228.4) < 0.1);
});
test('tight-corner speeds (curvature-based): AI medians in range for both modes; Assisted player in range', () => {
  for (const m of MAP_KEYS) for (const mode of ['assisted', 'expert']) {
    const r = RUN[m + mode], [lo, hi] = PACE_TARGETS[m][mode];
    assert.ok(r.aiTmed >= lo && r.aiTmed <= hi, `${m}/${mode} AI ${r.aiTmed.toFixed(0)} not in ${lo}-${hi}`);
    if (mode === 'assisted') assert.ok(r.pTmed >= lo && r.pTmed <= hi, `${m} player ${r.pTmed.toFixed(0)} not in ${lo}-${hi}`);
  }
});
test('loops / barrel rolls / inversions hold at the lower speeds: no crashes, valid laps, AI and player comparable', () => {
  for (const k of Object.keys(RUN)) {
    const r = RUN[k]; assert.equal(r.crashes, 0, k); assert.equal(r.p.lapValid[0], true, k);
    const ai = r.sim.racers.slice(1).map(x => x.lapTimes[0]); const pl = r.p.lapTimes[0];
    for (const t of ai) assert.ok(t / pl > 0.85 && t / pl < 1.2, `${k}: AI ${t.toFixed(1)} vs player ${pl.toFixed(1)}`);
  }
  for (const m of MAP_KEYS) assert.ok(RUN[m + 'assisted'].p.lapTimes[0] > RUN[m + 'expert'].p.lapTimes[0], m + ': Assisted slower than Expert');
  // maps stay distinct: fast > mixed > technical average speed in both modes
  for (const mode of ['assisted', 'expert']) { const avg = m => RUN[m + mode].sim.track.LAPLEN / RUN[m + mode].p.lapTimes[0]; assert.ok(avg('velocity') > avg('legacy') && avg('legacy') > avg('technical'), mode); }
});
test('records are separate per mode; pre-M3 records are not migrated (and not deleted)', () => {
  const mem = memoryStorage(); mem.setItem('nightgrid_v4_rec_velocity', '66'); const st = createRecordStore(mem, { lapLenOf: () => 5870 });
  assert.equal(recordKey('assisted', 'velocity'), 'm3_assisted_velocity'); assert.equal(recordKey('expert', 'velocity'), 'm3_expert_velocity');
  assert.equal(st.get(recordKey('assisted', 'velocity')), Infinity); assert.equal(st.get(recordKey('expert', 'velocity')), Infinity);
  st.offer(recordKey('assisted', 'velocity'), { time: 92, lapLen: 5870 });
  assert.equal(st.get(recordKey('assisted', 'velocity')), 92); assert.equal(st.get(recordKey('expert', 'velocity')), Infinity);
  assert.equal(mem.getItem('nightgrid_v4_rec_velocity'), '66');
});
