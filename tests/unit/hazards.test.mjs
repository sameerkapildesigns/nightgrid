import{Vec3}from'../../src/core/vec.js';
// M8 hazards: deterministic layout, bounded obstacle contact, shield / self-boost pads owned by the
// authoritative sim (room server), predictor pad sync, snapshot resume determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../../src/core/sim.js';
import { SIM_DT } from '../../src/core/clock.js';
import { buildTrackData, MAP_KEYS, S0 } from '../../src/core/maps.js';
import { buildHazards,buildRacePads, HAZ, gapS, encodePads, applyPads, powerFlags } from '../../src/core/hazards.js';
import { decodeFrame, encodeFrame, compactRacer, expandRacer } from '../../src/net/protocol.js';
import { Predictor } from '../../src/net/netcode.js';

const mod = (a, n) => ((a % n) + n) % n;
function mkSim(map, n = 1, events = null, seed = 11) {
  const ev = { list: [] };
  const sim = createSim({ seed, events: events || { racer: (k, r, x) => ev.list.push([k, r.id, x]) } });
  sim.setTrack(map); sim.hazards = true; sim.ghost = true;
  const seats = []; for (let k = 0; k < n; k++) seats.push({ id: 'h' + k, kind: 'human', name: 'H' + k });
  sim.addSeats(seats, 'h0'); for (const r of sim.racers) if (r !== sim.player) r.input = {};
  sim.drones.length = 0;   // isolate from road traffic unless a test adds it back
  return { sim, ev };
}
// put racer r at track position (s, d) moving straight ahead at v m/s
function put(sim, r, s, d, v) { r.s = mod(s, sim.track.MAIN.L); r.d = d; r.va = v; r.vd = 0; r.psi = 0; r.yawV = 0; r.prevS = undefined; r.lastRd = sim.rdist(r.path, r.s); sim.pose(r); }

test('layout: deterministic, 3-4 obstacles per lap, 6 pad rows of 3, never near start/finish, seam, tunnel, loop or blind corner', () => {
  for (const k of MAP_KEYS) {
    const a = buildHazards(buildTrackData(k)), b = buildHazards(buildTrackData(k));
    assert.deepEqual(a, b, k + ': identical from map key');
    assert.ok(a.obstacles.length >= 3 && a.obstacles.length <= 4, `${k}: ${a.obstacles.length} obstacles`);
    assert.equal(a.pads.filter(p=>p.kind!=='R').length, 18); assert.deepEqual(a.pads.filter(p=>p.kind!=='R').map(p => p.kind).join(''), 'SBSBSBSBSBSBSBSBSB');
    const td = buildTrackData(k), M = td.MAIN;
    for (const o of a.obstacles) {
      const fromLine = Math.min(mod(o.s - S0, M.L), mod(S0 - o.s, M.L));
      assert.ok(fromLine >= HAZ.START_CLEAR, `${k}: ${o.s} is ${fromLine} m from the line`);
      assert.ok(Math.min(o.s, M.L - o.s) >= HAZ.SEAM_CLEAR, `${k}: seam`);
      for (let j = -HAZ.RUNUP; j <= 30; j++) {
        const i = mod(Math.round(o.s / M.ds) + j, M.N);
        assert.ok(!(M.tag[i] & 1) && M.U[i].y >= HAZ.MIN_UPY && Math.abs(M.KG[i]) <= HAZ.RUNUP_K, `${k}: ${o.s}+${j} tunnel/inverted/corner`);
      }
    }
    for (const p of a.pads.filter(p=>p.kind!=='R')) {
      const fromLine = Math.min(mod(p.s - S0, M.L), mod(S0 - p.s, M.L)); assert.ok(fromLine >= 160, k + ': pickup start clear');
      for (let j = -30; j <= 30; j++) { const i = mod(Math.round(p.s / M.ds) + j, M.N); assert.ok(!(M.tag[i] & 1) && M.U[i].y >= HAZ.MIN_UPY && Math.abs(M.KG[i]) <= 1/100, k + ': pickup safe station'); }
      for (const o of a.obstacles) assert.ok(Math.abs(gapS(o.s,p.s,M.L)) >= HAZ.PAD_CLEAR, k + ': pickup not on obstacle');
    }
    for (const o of a.obstacles) {
      // the open side is always >= 3 car widths; the block never spans the road
      const W = td.W0, open = Math.max(W - (o.d + o.hw), (o.d - o.hw) + W) - 1.2;
      assert.ok(open >= 3 * 2 * HAZ.CAR_HALF_W, `${k}: open width ${open}`);
      assert.ok(2 * o.hw <= 0.25 * 2 * W, `${k}: block ${2 * o.hw} m of ${2 * W} m`);
    }
    for (let i = 0; i < a.obstacles.length; i++) for (let j = i + 1; j < a.obstacles.length; j++)
      assert.ok(Math.abs(gapS(a.obstacles[i].s, a.obstacles[j].s, M.L)) >= HAZ.OB_SPACING);
  }
});

test('obstacle: nose hit at race speed is bounded (keeps >= 60 %, loses <= 35 m/s), deflects to the open side, one event, never stops the car', () => {
  for (const v of [40, 70, 100]) {
    const { sim, ev } = mkSim('velocity');
    const o = sim.obstacles[0], me = sim.player; sim.pads.length = 0; sim.startRace();
    put(sim, me, o.s - 12, o.d, v);
    decodeFrame(encodeFrame({ up: 1 }), sim.input);
    let minV = Infinity, maxDrop = 0, prev = me.va;
    let maxFrac = 0;
    for (let i = 0; i < 120; i++) { sim.step(SIM_DT); minV = Math.min(minV, me.va); maxDrop = Math.max(maxDrop, prev - me.va); maxFrac = Math.max(maxFrac, (prev - me.va) / prev); prev = me.va; }
    const hits = ev.list.filter(e => e[0] === 'obstacle');
    assert.equal(hits.length, 1, `v=${v}: one event`);
    assert.ok(maxDrop <= HAZ.OB_MAX_LOSS + 0.5 && maxFrac <= 1 - HAZ.OB_SPEED_KEEP + 0.01, `v=${v}: single-step loss ${maxDrop} (${maxFrac})`);
    assert.ok(minV > v * 0.45, `v=${v}: min speed ${minV}`);
    assert.ok(Math.abs(me.d - o.d) >= o.hw + HAZ.CAR_HALF_W - 1e-6, `v=${v}: slid clear (d=${me.d})`);
    assert.ok(Math.sign(me.d) !== Math.sign(o.d) || Math.abs(me.d) < Math.abs(o.d), 'pushed toward the open side');
  }
});

test('obstacle: side scrape pushes out without a speed penalty; airborne car clears; shield absorbs once and is consumed', () => {
  { const { sim, ev } = mkSim('technical'); const o = sim.obstacles[0], me = sim.player; sim.pads.length = 0; sim.startRace();
    put(sim, me, o.s, o.d + (o.hw + HAZ.CAR_HALF_W) * Math.sign(-o.d) * 0.8, 60); me.vd = 3 * Math.sign(o.d);
    sim.step(SIM_DT); assert.ok(me.va > 59, 'no nose penalty on a side contact'); assert.ok(Math.abs(me.d - o.d) >= o.hw + HAZ.CAR_HALF_W - 1e-6); }
  { const { sim, ev } = mkSim('velocity'); const o = sim.obstacles[1], me = sim.player; sim.startRace();
    put(sim, me, o.s - 4, o.d, 70); me.h = 1 + o.h + 0.3;
    sim.step(SIM_DT); assert.equal(ev.list.filter(e => e[0] === 'obstacle').length, 0, 'airborne clears'); }
  { const { sim, ev } = mkSim('velocity'); const o = sim.obstacles[0], me = sim.player; sim.pads.length = 0; sim.startRace();
    me.shieldT = 5; put(sim, me, o.s - 8, o.d, 70);
    for (let i = 0; i < 60; i++) sim.step(SIM_DT);
    assert.equal(ev.list.filter(e => e[0] === 'obstacle').length, 0, 'no hit with shield');
    assert.deepEqual(ev.list.filter(e => e[0] === 'shield').map(e => e[2]), ['obstacle']);
    assert.equal(me.shieldT, 0, 'shield consumed');
    const c = mkSim('velocity').sim; c.pads.length = 0; c.startRace(); put(c, c.player, o.s + 200, o.d, 70); for (let i = 0; i < 60; i++) c.step(SIM_DT);
    assert.ok(Math.abs(me.va - c.player.va) < 0.5, `no penalty (${me.va} vs free ${c.player.va})`); }
});

test('pads: server claims in seat order, respawn and per-racer cooldown, one power of a kind at a time', () => {
  const { sim, ev } = mkSim('velocity', 2); const [A, B] = sim.racers; sim.startRace();
  const pS = sim.pads.find(p => p.kind === 'S'), iS = sim.pads.indexOf(pS);
  put(sim, A, pS.s - 1, pS.d, 30); put(sim, B, pS.s - 1, pS.d, 30);   // contested in the same step
  sim.step(SIM_DT);
  assert.ok(A.shieldT > 0 && !(B.shieldT > 0), 'first seat wins a contested pad');
  assert.ok(pS.readyAt > sim.time, 'pad taken');
  assert.deepEqual(encodePads(sim.pads, sim.time).map((x, k) => (k === iS ? x > 0 : x)), sim.pads.map((p, k) => (k === iS ? true : 0)));
  // cooldown: A cannot take a boost pad straight away
  const pB = sim.pads.find(p => p.kind === 'B' && p.row === pS.row);
  put(sim, A, pB.s - 1, pB.d, 30); sim.step(SIM_DT); assert.ok(A.surgeT > 0, 'overdrive bypasses shield cooldown for chaining');
  // respawn after PAD_RESPAWN s
  const t0 = sim.time; while (sim.time < t0 + HAZ.PAD_RESPAWN + 0.1) { put(sim, B, pS.s + 500, 0, 0); sim.step(SIM_DT); }
  assert.ok(pS.readyAt <= sim.time, 'respawned'); B.powCD = 0; put(sim, B, pS.s - 1, pS.d, 30); sim.step(SIM_DT);
  assert.ok(B.shieldT > 0, 'B takes the respawned pad');
  // already holding a shield: a shield pad is not consumed
  const other = sim.pads.find(p => p.kind === 'S' && p !== pS); B.powCD = 0; put(sim, B, other.s - 1, other.d, 30); sim.step(SIM_DT);
  assert.ok(other.readyAt <= sim.time, 'shield pad left for others while B holds a shield');
});

test('self-boost: surge forces boost for SURGE_TIME without draining the meter; bots surge too', () => {
  const { sim } = mkSim('technical'); const me = sim.player; sim.startRace();
  const p = sim.pads.find(x => x.kind === 'B'); put(sim, me, p.s - 1, p.d, 40); me.meter = 0.2;
  decodeFrame(encodeFrame({ up: 1 }), sim.input);
  sim.step(SIM_DT); assert.ok(me.surgeT > 0, 'claimed'); sim.step(SIM_DT); assert.ok(me.boost, 'boosting');
  let steps = 0; while (me.surgeT > 0) { sim.step(SIM_DT); steps++; assert.ok(me.boost); }
  assert.ok(Math.abs((steps + 1) * SIM_DT - HAZ.SURGE_TIME) < 2 * SIM_DT, `${steps} steps`);
  assert.ok(me.meter >= 0.2 - 1e-9, 'meter not drained');
  sim.step(SIM_DT); assert.ok(!me.boost, 'surge over');
  assert.equal(powerFlags({ shieldT: 1, surgeT: 0 }), 1); assert.equal(powerFlags({ shieldT: 0, surgeT: 1 }), 2);
});

test('bots dodge obstacles (8 bots, full race, every map) without pickups and keep their pace', () => {
  for (const map of MAP_KEYS) {
    const out = {};
    for (const haz of [false, true]) {
      let hits = 0; const sim = createSim({ seed: 7, events: { racer: k => { if (k === 'obstacle') hits++; } } });
      sim.setTrack(map);sim.pads.length=0; sim.hazards = haz; sim.ghost = true;
      sim.addSeats(Array.from({ length: 8 }, (_, k) => ({ id: 'b' + k, kind: 'bot' })), null); sim.startRace();
      let t = 0; while (sim.finishOrder.length < 8 && t < 600) { sim.step(SIM_DT); t += SIM_DT; }
      assert.equal(sim.finishOrder.length, 8, map + ' all finish');
      out[haz] = { hits, win: sim.finishOrder[0].finishTime };
    }
    assert.ok(out.true.hits <= 2, `${map}: ${out.true.hits} bot hits`);
    assert.ok(Math.abs(out.true.win - out.false.win) / out.false.win < 0.03, `${map} pace ${out.false.win} -> ${out.true.win}`);
  }
});

test('traffic changes lane around obstacles without a scripted hop or block overlap',()=>{
 for(const map of MAP_KEYS){const sim=createSim({seed:5});sim.setTrack(map);sim.hazards=true;sim.addSeats([{id:'b',kind:'bot'}]);sim.startRace();
  for(const o of sim.obstacles){const d=sim.drones[0];d.lane=o.d;d.speed=35;let passed=false;
   for(let gap=90;gap>=-60;gap-=.5){d.s=mod(o.s-gap,sim.track.MAIN.L);d.h=1.1;d.vh=0;sim.poseAll();
    const f=sim.frameAt(sim.track.MAIN,d.s,{P:new Vec3(),T:new Vec3(),U:new Vec3(),R:new Vec3()});assert.ok(d.d>=-sim.track.MAIN.WL[f.i]+2.2-1e-6&&d.d<=sim.track.MAIN.WR[f.i]-2.2+1e-6);
    assert.equal(d.h,1.1,'pose does not script an obstacle jump');if(Math.abs(gap)<4){passed=true;assert.ok(Math.abs(d.d-o.d)>=o.hw+1.6,`${map}: gap ${gap}, d ${d.d}`);}
   }assert.ok(passed);
  }
 }
});

test('snapshot: hazards flag + pad state + racer power fields survive export/import; resumed run is identical', () => {
  const run = (resumeAt) => {
    const { sim } = mkSim('velocity', 3, {}, 21); sim.startRace();
    const f = encodeFrame({ up: 1, right: 1 }); const pS = sim.pads[0];
    put(sim, sim.racers[1], pS.s - 1, pS.d, 30); put(sim, sim.racers[2], sim.obstacles[0].s - 6, sim.obstacles[0].d, 60);
    let s = sim;
    for (let i = 0; i < 600; i++) {
      if (i === resumeAt) { const sn = JSON.parse(JSON.stringify(s.snapshot())); const t = createSim({ seed: 1 }); t.setTrack('velocity'); t.importSnapshot(sn); s = t; }
      decodeFrame(f, s.input); s.step(SIM_DT);
    }
    return JSON.stringify(s.snapshot());
  };
  const a = run(-1), b = run(37);
  assert.equal(a, b);
  const sn = JSON.parse(a); assert.equal(sn.hazards, true); assert.equal(sn.pads.length, (()=>{const t=createSim({seed:21});t.setTrack('velocity');return t.pads.length;})());
  assert.ok('shieldT' in sn.racers[0] && 'surgeT' in sn.racers[0]);
});

test('predictor: server pad state overrides the prediction (contested pad), remote power flag rides the compact racer', () => {
  const { sim } = mkSim('velocity', 2); sim.startRace();
  const raceMsg = { seed: 11, mode: sim.mode, map: 'velocity', snap: JSON.parse(JSON.stringify(sim.snapshot())), you: 'h1', step: 0 };
  const P = new Predictor(raceMsg); assert.equal(P.sim.hazards, true);
  const pS = P.sim.pads[0];
  // server: h0 takes the pad; client h1 predicts taking it too
  put(sim, sim.racers[0], pS.s - 1, pS.d, 30); put(sim, sim.racers[1], pS.s - 1, pS.d, 30); sim.step(SIM_DT);
  assert.ok(sim.racers[0].shieldT > 0 && !(sim.racers[1].shieldT > 0));
  put(P.sim, P.me, pS.s - 1, pS.d, 30); P.step(encodeFrame({}));
  assert.ok(P.me.shieldT > 0, 'prediction took it');
  P.reconcile({ me: sim.racerState('h1'), ack: 0, tm: sim.time, ph: 'race', pk: encodePads(sim.pads, sim.time) });
  assert.ok(!(P.me.shieldT > 0), 'server says no shield');
  assert.ok(P.sim.pads[0].readyAt > P.sim.time, 'pad shown taken (server state)');
  const x = expandRacer(compactRacer(sim.racers[0], null)); assert.equal(x.pw, 1);
  const pads = [{ readyAt: 0 }, { readyAt: 0 }]; applyPads(pads, [0, 2.5], 10); assert.deepEqual(pads.map(p => p.readyAt), [0, 12.5]);
});

test('finished (and crashed / airborne) racers cannot collect; tie in one step goes to the earlier seat (documented, not random)', () => {
  const { sim } = mkSim('velocity', 3); const [A, B, C] = sim.racers; sim.startRace();
  const p = sim.pads[0];
  A.finished = true; put(sim, A, p.s - 1, p.d, 30);
  B.crashed = 1; put(sim, B, p.s - 1, p.d, 30);
  put(sim, C, p.s - 1, p.d, 30); C.h = 1 + 2.6;
  sim.step(SIM_DT);
  for (const r of [A, B, C]) assert.ok(!(r.shieldT > 0) && !(r.surgeT > 0), r.id + ' no claim');
  assert.ok(!(p.readyAt > sim.time), 'pad still available');
  // exact same-step tie between seats 1 and 2: seat order decides (host / earlier seat wins)
  const q = mkSim('velocity', 3).sim; q.startRace(); const pp = q.pads[1];
  put(q, q.racers[2], pp.s - 1, pp.d, 30); put(q, q.racers[1], pp.s - 1, pp.d, 30); q.step(SIM_DT);
  const got = q.racers.map(r => r.shieldT > 0 || r.surgeT > 0);
  assert.deepEqual(got, [false, true, false]);
});

test('snapshot restore preserves claim cooldowns, power timers, debounce and pad respawn (mid-cooldown resume == uninterrupted)', () => {
  const { sim } = mkSim('technical', 2); sim.startRace(); const [A] = sim.racers;
  const p = sim.pads.find(x => x.kind === 'S'); put(sim, A, p.s - 1, p.d, 30); sim.step(SIM_DT);
  for (let i = 0; i < 100; i++) sim.step(SIM_DT);
  A.obT = 0.3; A.passT = 0.2; A.surgeT = 0.9;
  const sn = JSON.parse(JSON.stringify(sim.snapshot()));
  const t = createSim({ seed: 99 }); t.setTrack('technical'); t.importSnapshot(sn);
  const a2 = t.racers.find(r => r.id === A.id);
  for (const k of ['shieldT', 'powCD', 'obT', 'passT', 'surgeT']) assert.equal(a2[k], A[k], k);
  assert.deepEqual(t.pads.map(x => x.readyAt), sim.pads.map(x => x.readyAt));
  assert.ok(a2.powCD > 0 && t.pads.some(x => x.readyAt > t.time), 'mid-cooldown state was actually exercised');
  t.racers.forEach((r, k) => { r.input = sim.racers[k].input === sim.input ? t.input : {}; });
  for (let i = 0; i < 900; i++) { sim.step(SIM_DT); t.step(SIM_DT); }
  assert.equal(JSON.stringify(t.snapshot().racers), JSON.stringify(sim.snapshot().racers));
  assert.deepEqual(t.pads.map(x => x.readyAt), sim.pads.map(x => x.readyAt));
});
