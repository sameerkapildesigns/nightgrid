// R5 air jumps: flight envelope per authored ramp, trick commitment, gating, determinism, reward ledger, snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrackData, H0 } from '../../src/core/maps.js';
import { AIR, buildRamps, rampProblems, tryLaunch, airStep, remainingAir, respawnS } from '../../src/core/airjump.js';
import { createSim } from '../../src/core/sim.js';
 
const DT = 1 / 120, VMAX_TEST = 140;   // 140 m/s: above boost x strong catch-up x draft on every redesigned map
const RAMP_MAPS = { casino: 2, summit: 4 };
 
function racerAt(td, rp, v) {
  const M = td.MAIN;
  return { path: M, prevS: rp.lip - v * DT * 0.5, s: rp.lip + v * DT * 0.5, d: 0, h: H0, vh: 0, jump: 0, tk: 0, tkDir: 0, tkN: 0, jT: 0, jY: 0, jVy: 0 };
}
function fly(td, rp, v, trick = 0) {
  const r = racerAt(td, rp, v);
  const launched = tryLaunch(r, td, [rp], v, H0);
  const input = { drift: trick ? 1 : 0, right: trick > 0 ? 1 : 0, left: trick < 0 ? 1 : 0 };
  let info = null, maxH = 0, t = 0;
  while (launched && !info && t < 8) { r.prevS = r.s; r.s += v * DT; info = airStep(r, td, v, DT, input, H0, true); maxH = Math.max(maxH, r.h); t += DT; }
  return { launched, info, s: r.s, maxH, r };
}
 
test('authored ramps exist only on Casino and Summit and all pass the gates', () => {
  for (const key of ['velocity', 'casino', 'summit', 'drift', 'technical', 'legacy']) {
    const td = buildTrackData(key, 0);
    const want = RAMP_MAPS[key] || 0;
    assert.equal((td.ramps || []).length, want, key + ' authored ramps');
    for (const rp of td.ramps || []) assert.deepEqual(rampProblems(td, rp), [], key + ' ramp @' + Math.round(rp.lip));
    assert.equal(buildRamps(td).length, want, key + ' validated ramps');
  }
});
 
test('every ramp lands inside its window from vMin to 140 m/s, bounded height and airtime, real air at speed', () => {
  for (const key of Object.keys(RAMP_MAPS)) {
    const td = buildTrackData(key, 0);
    for (const rp of buildRamps(td)) for (let v = rp.vMin; v <= VMAX_TEST; v += 5) {
      const f = fly(td, rp, v);
      const tag = `${key} ramp ${rp.id} v=${v}`;
      assert.ok(f.launched, tag + ' launched');
      assert.ok(f.info, tag + ' landed');
      assert.ok(f.s <= rp.end, `${tag} lands at ${f.s.toFixed(0)} > window end ${rp.end.toFixed(0)}`);
      assert.ok(f.info.airT <= AIR.T_SOFT, `${tag} airtime ${f.info.airT.toFixed(2)} (safety gravity must never engage)`);
      assert.ok(f.maxH <= 25, `${tag} apex ${f.maxH.toFixed(1)} m above road`);
      assert.ok(f.info.rel <= 25, `${tag} touchdown closing ${f.info.rel.toFixed(1)} m/s`);
      if (v >= 80) assert.ok(f.info.airT >= 0.3, `${tag} real airtime ${f.info.airT.toFixed(2)} s`);
    }
  }
});
 
test('a started roll always completes before touchdown; at most two rolls', () => {
  for (const key of Object.keys(RAMP_MAPS)) {
    const td = buildTrackData(key, 0);
    for (const rp of buildRamps(td)) for (let v = rp.vMin; v <= VMAX_TEST; v += 5) for (const dir of [-1, 1]) {
      const f = fly(td, rp, v, dir);
      assert.ok(f.info, `${key} ${rp.id} v=${v} landed`);
      assert.equal(f.info.open, false, `${key} ramp ${rp.id} v=${v} dir=${dir}: roll left open at touchdown`);
      assert.ok(f.info.rolls <= AIR.TRICK_MAX);
      assert.equal(f.r.tk, 0, 'completed rolls leave no residual body angle');
    }
  }
});
 
test('no roll starts when the remaining air cannot cover it', () => {
  const td = buildTrackData('casino', 0), rp = buildRamps(td)[0], v = 90;
  const r = racerAt(td, rp, v); assert.ok(tryLaunch(r, td, [rp], v, H0));
  const idle = { drift: 0, right: 0, left: 0 }, press = { drift: 1, right: 1, left: 0 };
  let guard = 0;
  while (remainingAir(r, td, v, H0) >= AIR.TRICK_T + AIR.TRICK_MARGIN && guard++ < 2000) { r.prevS = r.s; r.s += v * DT; assert.equal(airStep(r, td, v, DT, idle, H0, true), null); }
  let info = null;
  while (!info && guard++ < 4000) { r.prevS = r.s; r.s += v * DT; info = airStep(r, td, v, DT, press, H0, true); if (!info) assert.equal(r.tkDir, 0, 'late press must not start a roll'); }
  assert.ok(info); assert.equal(info.rolls, 0); assert.equal(info.open, false);
});
 
test('launch gates: speed, grounded, forward crossing, reversed variants', () => {
  const td = buildTrackData('casino', 0), rp = buildRamps(td)[0];
  assert.equal(tryLaunch(racerAt(td, rp, rp.vMin - 1), td, [rp], rp.vMin - 1, H0), null, 'below vMin');
  const high = racerAt(td, rp, 90); high.h = H0 + AIR.LIP_H + 0.1;
  assert.equal(tryLaunch(high, td, [rp], 90, H0), null, 'already floating');
  const back = racerAt(td, rp, 90); [back.prevS, back.s] = [back.s, back.prevS];
  assert.equal(tryLaunch(back, td, [rp], 90, H0), null, 'backwards');
  assert.deepEqual(buildRamps({ ...td, vr: 2, airRamps: undefined }), [], 'reversed: no directional ramps');
});
 
test('touch Brake plus steer starts an airborne roll without a new input bit',()=>{const td=buildTrackData('casino'),rp=buildRamps(td)[0],r=racerAt(td,rp,90);assert.ok(tryLaunch(r,td,[rp],90,H0));r.s+=90*DT;airStep(r,td,90,DT,{down:1,right:1},H0,true);assert.equal(r.tkDir,1);});

test('flight is deterministic', () => {
  const td = buildTrackData('summit', 0);
  for (const rp of buildRamps(td)) { const a = fly(td, rp, 97, 1), b = fly(td, rp, 97, 1); assert.deepEqual(a.info, b.info); assert.equal(a.s, b.s); assert.equal(a.r.h, b.r.h); }
});
 
test('respawn never lands inside a ramp window', () => {
  const td = buildTrackData('summit', 0), ramps = buildRamps(td), L = td.MAIN.L;
  for (let s = 0; s < L; s += 5) {
    const q = respawnS(ramps, s, L);
    for (const rp of ramps) assert.ok(!(q >= rp.lip - AIR.RESPAWN_WINDOW_PRE && q <= rp.end + AIR.RESPAWN_WINDOW_POST), `respawn ${s} -> ${q}`);
  }
});
 
function runJump(sim, rp) {
  const r = sim.player, M = sim.track.MAIN;
  r.path = M; r.s = rp.lip - 30; r.prevS = undefined; r.d = 0; r.h = H0; r.vh = 0; r.psi = 0; r.va = 95; r.vd = 0; r.yawV = 0; r.steer = 0;
  let launched = false;
  for (let k = 0; k < 1500; k++) { sim.step(DT); if (r.jump) launched = true; if (launched && !r.jump) break; }
  return launched;
}
test('one reward opportunity per ramp per lap; continuous airtime earn is gone', () => {
  const sim = createSim({ seed: 11 }); sim.setTrack('casino'); sim.addRacers([]); sim.startRace();
  const earned = []; sim.events = { earn: (txt, col, amt) => earned.push([txt, amt]) };
  sim.input.up = 1;
  const rp = sim.ramps[0];
  assert.ok(runJump(sim, rp), 'first jump');
  const rewards = () => earned.filter(e => /CLEAN|ROLL/.test(e[0])).length;
  assert.equal(rewards(), 1, 'clean landing rewarded once');
  assert.ok(!earned.some(e => e[0] === 'AIRTIME'), 'no continuous AIRTIME earn');
  assert.ok(runJump(sim, rp), 'second jump same lap');
  assert.equal(rewards(), 1, 'same ramp, same lap: no second reward');
});
 
test('mid-air snapshot restores and continues bit-identically', () => {
  const sim = createSim({ seed: 5 }); sim.setTrack('summit'); sim.addRacers([]); sim.startRace(); sim.input.up = 1;
  const r = sim.player, rp = sim.ramps[1], M = sim.track.MAIN;
  r.path = M; r.s = rp.lip - 30; r.prevS = undefined; r.d = 0; r.h = H0; r.vh = 0; r.psi = 0; r.va = 95; r.vd = 0;
  for (let k = 0; k < 1500 && !r.jump; k++) sim.step(DT);
  assert.equal(r.jump, 1, 'airborne');
  for (let k = 0; k < 30; k++) sim.step(DT);
  assert.equal(r.jump, 1, 'still airborne at snapshot');
  const snap = JSON.parse(JSON.stringify(sim.snapshot()));
  const sim2 = createSim({ seed: 5 }); sim2.setTrack('summit'); sim2.importSnapshot(snap);
  for (let k = 0; k < 240; k++) { sim.step(DT); sim2.step(DT); }
  for (const key of ['s', 'd', 'h', 'vh', 'va', 'vd', 'jump', 'jY', 'jVy', 'tk', 'meter', 'prog']) assert.equal(sim2.player[key], sim.player[key], key);
});
 
test('aligned takeoff plus held trick input rolls the body without steering the car into a rail on every authored jump',()=>{
 for(const key of Object.keys(RAMP_MAPS))for(const dir of [-1,1]){
  const sim=createSim({seed:11});sim.setTrack(key);sim.setMode('expert');sim.addRacers([]);sim.startRace();sim.drones=[];sim.hazards=false;
  for(const rp of sim.ramps){const r=sim.player;Object.assign(r,{path:sim.track.MAIN,s:rp.lip-.3,prevS:undefined,d:0,h:H0,vh:0,psi:0,va:95,vd:0,yawV:0,steer:0,finished:false,jump:0,tk:0,scrape:false});
   let launched=false,landed=null;sim.events={racer:(k,r,info)=>{if(k==='land')landed=info;}};
   for(let k=0;k<1000;k++){Object.assign(sim.input,{up:1,drift:r.jump?1:0,left:r.jump&&dir<0?1:0,right:r.jump&&dir>0?1:0});sim.step(DT);launched ||= !!r.jump;if(landed)break;}
   assert.ok(launched&&landed,`${key}/${rp.id} landing`);assert.ok(landed.clean,`${key}/${rp.id} clean`);assert.ok(Math.abs(r.d)<4,`${key}/${rp.id} lane ${r.d}`);
  }
 }
});
