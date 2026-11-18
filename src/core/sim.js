// Pure race simulation: racer physics, AI, collisions, slipstream, laps, drones.
// Moved from v5b game.html with behaviour preserved. Differences from v5b:
//  - no DOM / audio / Three.js: presentation side effects are emitted as events;
//  - time is the simulation's own clock (`sim.time`), advanced in fixed steps;
//  - each lap carries an integrity record (position jumps, autopilot, debug) used by
//    record validation;
//  - randomness comes from an injected seeded RNG (the city keeps its own stream).
import { Vec3 } from './vec.js';
import { clamp, lerp, mod, wrapA, damp, fmtTime } from './math.js';
import { paceFor, FASTEST_MOD } from './pace.js';
import { buildHazards, HAZ, gapS } from './hazards.js';
import { buildTrackData, frameAt as frameAtTD, kgAt as kgAtTD, raceS as raceSTD, rdist as rdistTD, mkF, S0, H0, WB } from './maps.js';

export { H0, S0 };
export const GRAV = 9.8 * 0.35;
// personalities: lat = cornering grip the AI trusts, vmax = top pace, ...
export const PERS = {
  VEX: { vmax: 93.0, lat: 84, acc: 26, brake: 52, off: -0.6, short: 0.95, aggr: 1.0, block: 0, boostUse: 1.3, margin: 3.3, css: '#ff3355' },
  GHOST: { vmax: 94.5, lat: 86, acc: 25, brake: 44, off: 0.0, short: 0.45, aggr: 0.0, block: 0, boostUse: 1.0, margin: 5.0, css: '#b9a6ff' },
  BLITZ: { vmax: 93.0, lat: 82, acc: 25, brake: 46, off: 0.9, short: 0.0, aggr: 0.3, block: 1, boostUse: 0.8, margin: 4.2, css: '#ffc81e' }
};
export const DIFF = { normal: { vmax: 0.97, lat: 0.95 }, hard: { vmax: 1.03, lat: 1.1 } };   // AI pace only
// Largest believable forward progress per fixed step: top speed plus collision push-out.
export const MAX_STEP_ADVANCE = (h) => 150 * h + 5;
const FINISH_PERS = { vmax: 60, lat: 50, acc: 20, brake: 40, off: 0, short: 0, aggr: 0, block: 0, boostUse: 0, margin: 5 };

// M7 grid. <= 4 racers: the v5b 2x2 grid unchanged (single-player parity: GHOST, VEX, BLITZ, player).
// 5..20: 4 abreast, rows 8 m apart, lanes spread to the map's road width (2.4 m kept to each wall), so the
// back row of 20 starts 32 m behind the front row (the M6 prototype's 2-wide, 14 m rows put it 126 m behind,
// ~1.6 s at race pace). Returns [metres behind the start line, lateral offset] per grid slot.
export const MAX_RACERS = 20, GRID_FRONT = 14, GRID_ROW = 8, GRID_WIDE = 4;
const GRID_V5B = [[14, -4.4], [14, 4.4], [28, -4.4], [28, 4.4]];
export function gridSlots(n, W0) {
  if (n <= 4) return GRID_V5B.slice(0, Math.max(n, 4));
  const sp = Math.min(5.2, (2 * W0 - 2 * 2.4) / GRID_WIDE), out = [];
  for (let k = 0; k < n; k++) out.push([GRID_FRONT + GRID_ROW * Math.floor(k / GRID_WIDE), (k % GRID_WIDE - (GRID_WIDE - 1) / 2) * sp]);
  return out;
}

export const BOOST_REGEN_RATE = 0.04, BOOST_REGEN_DELAY = 1.5, BOOST_RELOCK = 0.05;
export function createSim({ seed = 4242, events = null } = {}) {
  // mulberry32 with exportable state (snapshot/import parity)
  const rng = { a: seed | 0 };
  const rnd = () => { let a = rng.a; a |= 0; a = a + 0x6D2B79F5 | 0; rng.a = a; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const R = (a = 0, b = 1) => a + (b - a) * rnd();
  const noop = () => {};
  // Presentation hooks; unknown/missing handlers are no-ops so the core runs headless.
  const ev = new Proxy({}, { get: (_, k) => { const f = sim.events && sim.events[k]; return typeof f === 'function' ? f : noop; } });

  let td = null, MAIN, BR, SAm, SBm, OFF, W0, LAPLEN, LAPS, HASBR, SECTORS;
  const frameAt = (p, s, o) => frameAtTD(td, p, s, o);
  const kgAt = (p, s) => kgAtTD(td, p, s);
  const raceS = (p, s) => raceSTD(td, p, s);
  const rdist = (p, s) => rdistTD(td, p, s);

  const sim = {
    time: 0, raceStart: 0, phase: 'grid',   // grid | race | finished
    ghost: false,   // true in multiplayer rooms: no car-to-car contact (see collideRacers)
    hazards: false, // M8: static obstacles + shield/self-boost pads (room server and the page turn this on)
    obstacles: [], pads: [],
    racers: [], drones: [], player: null, finishOrder: [],
    input: { up: 0, down: 0, left: 0, right: 0, boost: 0 },
    diff: 'normal', mode: 'expert', pace: null, bestLap: Infinity, bestSplits: [], curSplits: [], wrongWayT: 0,
    get wrongWayT() { return sim.player ? sim.player.wrongWayT : 0; },
    get rngState() { return rng.a; },
    debugTouched: false,   // set by debug hooks; taints laps for record purposes
    events: events || null,
    get track() { return td; },
    raceTime() { return (sim.phase === 'race' || sim.phase === 'finished') ? sim.time - sim.raceStart : 0; },
    rng: rnd, R
  };

  function setTrack(key) {
    td = typeof key === 'string' ? buildTrackData(key) : key;
    ({ MAIN, BR, SAm, SBm, OFF, W0, LAPLEN, LAPS, HASBR, SECTORS } = td);
    sim.pace = paceFor(td.key, sim.mode);
    const hz = buildHazards(td); sim.obstacles = hz.obstacles; sim.pads = hz.pads.map(p => Object.assign({}, p, { readyAt: 0 }));
    for (const r of sim.racers) { r.path = MAIN; r.prevS = undefined; }
    return td;
  }

  const humans = () => sim.racers.filter(r => !r.isAI);
  const isFocus = r => r === sim.player;   // presentation events only for the local focus racer (null on a server)
  // AI rubber band reference: the leading unfinished human (single player: the player)
  function rubberRef() { let b = null; for (const r of sim.racers) if (!r.isAI && !r.finished && (!b || r.prog > b.prog)) b = r; return b; }
  function setMode(mode) { sim.mode = mode === 'assisted' ? 'assisted' : 'expert'; if (td) sim.pace = paceFor(td.key, sim.mode); return sim.mode; }
  // lookahead max |curvature| (follows the branch when the racer is committed to it)
  function lookK(r, look) {
    let km = 0;
    const lp = (r.path === MAIN && r.takeShort && r.s < SAm && r.s > SAm - look) ? null : r.path;
    for (let j = 6; j < look; j += 3) { const ss = r.s + j; let k; if (!lp) { k = ss >= SAm ? kgAt(BR, ss - SAm) : kgAt(MAIN, ss); } else k = kgAt(r.path, ss); k = Math.abs(k); if (k > km) km = k; }
    return km;
  }
  function makeRacer(name, isAI, pers, css) {
    return {
      name, isAI, pers, css, path: MAIN, s: 0, d: 0, h: H0, vh: 0, psi: 0, va: 0, vd: 0, yawV: 0, steer: 0,
      speed: 0, dv: 0, prog: 0, lastRd: 0, lap: 0, lapStart: 0, lapTimes: [], lapValid: [], finished: false, finishTime: 0,
      boost: false, meter: 0.35, boostRelT: 0, boostLock: false, drift: false, air: false, airT: 0, thr: 0, roll: 0, pitch: 0, rollAI: 0, autopilot: isAI,
      vf: 0, vl: 0, acc: 0, phase: R(0, 10), scrape: false, scrapeSide: 0, droneT: 0, sector: 0, takeShort: false,
      draftT: 0, tow: 0, slingT: 0, crashed: 0, phA: R(0, 10), phB: R(0, 10), aiBoostT: 0, aiBoostCD: R(4, 10), blockD: 0,
      world: new Vec3(), F: new Vec3(), Uw: new Vec3(), lastSign: {}, nearRail: 0, flapK: 0,
      carMods: null, wallLim: 1.2, shieldT: 0, surgeT: 0, powCD: 0, obT: 0, passT: 0, lapIntegrity: { teleport: false, autopilot: false, debug: false },
      input: { up: 0, down: 0, left: 0, right: 0, boost: 0, drift: 0 }, wrongWayT: 0, bestLap: Infinity, bestSplits: [], curSplits: [], id: null
    };
  }
  function addRacers(rivals) {   // single player: rivals: [{ name, css }]
    sim.player = makeRacer('YOU', false, null, '#00f0ff'); sim.player.input = sim.input; sim.player.id = 'p0';
    for (const { name, css } of rivals) { const r = makeRacer(name, true, PERS[name], css || PERS[name].css); r.id = name; sim.racers.push(r); }
    sim.racers.unshift(sim.player);
    sim.player.gridSlot = 3; sim.racers.slice(1).forEach((r, k) => { r.gridSlot = k; });
    addDrones();
  }
  // Multiplayer/server: seats in order, kind 'human' | 'bot' (bots use AI personalities). focusId: local
  // racer for presentation events (null on a server). Total cap MAX_RACERS (grid slots, see gridSlots).
  const BOT_NAMES = ['GHOST', 'VEX', 'BLITZ'];
  function addSeats(seats, focusId = null) {
    if (seats.length < 1 || seats.length > MAX_RACERS) throw new Error('1-' + MAX_RACERS + ' seats required');
    let b = 0;
    seats.forEach((st, k) => {
      const bot = st.kind === 'bot', pn = bot ? (PERS[st.pers] ? st.pers : BOT_NAMES[b++ % 3]) : null;
      const r = makeRacer(st.name || (bot ? pn : 'P' + (k + 1)), bot, bot ? PERS[pn] : null, st.css || (bot ? PERS[pn].css : '#00f0ff'));
      r.id = st.id; r.gridSlot = k; if (st.carMods) r.carMods = st.carMods;
      sim.racers.push(r);
      if (st.id === focusId) { sim.player = r; r.input = sim.input; }
    });
    addDrones();
  }
  function addDrones() {
    const lanes = [-6, 0, 6, -4, 5, -7, 2];
    for (let k = 0; k < 7; k++) sim.drones.push({ s: (k + 0.35) * MAIN.L / 7, lane: lanes[k], d: lanes[k], speed: R(30, 41), h: H0 + 0.1, vh: 0, phase: R(0, 10), world: new Vec3(), lastSign: 0, fi: 0 });
    gridUp();
  }
  function placeRacer(r, back, d) {
    r.path = MAIN; r.s = mod(S0 - back, MAIN.L); r.d = d; r.h = H0; r.vh = 0; r.psi = 0; r.va = 0; r.vd = 0; r.speed = 0; r.dv = 0;
    r.lastRd = rdist(MAIN, r.s); r.prog = r.lastRd - LAPLEN; r.prevS = undefined;
    r.lap = 0; r.lapTimes = []; r.lapValid = []; r.finished = false; r.finishTime = 0; r.lapStart = 0; r.boost = false; r.boostRelT = 0; r.boostLock = false; r.drift = false; r.thr = 0;
    r.autopilot = r.isAI; r.vf = 0; r.vl = 0; r.acc = 0; r.yawV = 0; r.steer = 0; r.draftT = 0; r.tow = 0; r.slingT = 0; r.crashed = 0; r.droneT = 0;
    r.sector = MAIN.sec[Math.round(r.s / MAIN.ds) % MAIN.N]; r.takeShort = false; r.air = false; r.airT = 0; r.aiBoostT = 0;
    r.lapIntegrity = { teleport: false, autopilot: false, debug: false };
    r.shieldT = 0; r.surgeT = 0; r.powCD = 0; r.obT = 0; r.passT = 0;
    ev.racerReset(r);
  }
  function gridUp() {
    const slots = gridSlots(sim.racers.length, W0);
    for (const r of sim.racers.slice().sort((a, b) => a.gridSlot - b.gridSlot)) { const [bk, d] = slots[r.gridSlot]; placeRacer(r, bk, d); if (!r.isAI) r.meter = 0.35; }
    sim.drones.forEach((d, k) => { d.s = mod(S0 + 380 + k * MAIN.L / 7, MAIN.L); d.speed = R(30, 41); });
    sim.phase = 'grid'; sim.finishOrder = []; sim.curSplits = []; sim.debugTouched = false;
    for (const p of sim.pads) p.readyAt = 0;
    for (const r of sim.racers) { r.curSplits = []; r.wrongWayT = 0; }
    poseAll();
  }

  /* ---------- physics ---------- */
  const _fp = mkF(), _fa = mkF(), _fb = mkF(), _fv = mkF(), _fd = mkF();
  function earn(r, txt, col, amt) {
    if (r.autopilot || r.isAI) return;
    r.meter = Math.min(1, r.meter + amt); if (isFocus(r)) ev.earn(txt, col, amt);
  }
  function hoverStep(r, kn, speed, dt) {
    const cen = clamp(-speed * speed * kn, -130, 150);
    let ah = cen - r.vh * 11;
    if (r.h > H0) ah -= Math.min(85 * (r.h - H0), 62); else ah += 240 * (H0 - r.h);
    ah += Math.sin(sim.time * 2.6 + r.phase) * 0.6;
    r.vh += ah * dt; r.h += r.vh * dt;
    let impact = 0;
    if (r.h < 0.4) { r.h = 0.4; if (r.vh < 0) { impact = -r.vh; r.vh = 0; } }
    if (r.h > 9) { r.h = 9; r.vh = Math.min(r.vh, 0); }
    return impact;
  }
  function transitions(r) {
    if (r.path === MAIN) {
      const prevS = r.prevS;
      if (prevS !== undefined && prevS < SAm && r.s >= SAm && r.s - prevS < 20) {
        if (r.d > W0) { r.path = BR; r.s = r.s - SAm; r.d -= OFF; if (isFocus(r)) ev.flash('LOOP SHORTCUT', '#ff8a2a'); }
      }
      r.s = mod(r.s, MAIN.L);
    } else {
      if (r.s > BR.L) { r.s = SBm + (r.s - BR.L); r.path = MAIN; r.d += OFF; }
      else if (r.s < 0) { r.s = SAm + r.s; r.path = MAIN; r.d += OFF; }
    }
  }
  function walls(r) { // returns [left limit, right limit, railsLeft, railsRight]
    const f = frameAt(r.path, r.s, _fb); const i = f.i, p = f.path;
    if (p === BR) return [BR.WL[i], BR.WR[i], false, false];
    const fi = Math.floor(mod(r.path === MAIN ? r.s : (r.s < 0 ? SAm + r.s : SBm + r.s - BR.L), MAIN.L) / MAIN.ds) % MAIN.N; // floor: never see the divider early
    return [MAIN.WL[fi], MAIN.WR[fi], true, true];
  }
  function stepPlayer(r, dt) {
    if (r.crashed > 0) return;
    const keys = r.input;
    const f = frameAt(r.path, r.s, _fp); const pth = f.path, i = f.i;
    const kg = pth.KG[i], kn = pth.KN[i];
    const inverted = f.U.y < -0.2, steep = f.U.y < 0.5;
    const PC = sim.pace || paceFor(td.key, sim.mode), MD = PC.mode;
    let thr = keys.up ? 1 : 0; const brk = keys.down ? 1 : 0;
    let st = clamp((+keys.right || 0) - (+keys.left || 0), -1, 1);   // analogue-capable (tilt); keys send 0/1
    // Assisted edge correction: only while the player is not steering (manual override), capped 15 %
    r.edgeAssist = 0;
    if (MD.edgeAssist > 0 && Math.abs(st) < 0.05 && !r.air) {
      const [wl0, wr0] = walls(r), gapR = wr0 - r.d, gapL = r.d + wl0;
      if (gapR < 3) r.edgeAssist = -MD.edgeAssist * clamp((3 - gapR) / 2, 0, 1);
      else if (gapL < 3) r.edgeAssist = MD.edgeAssist * clamp((3 - gapL) / 2, 0, 1);
      st = clamp(st + r.edgeAssist, -1, 1);
    }
    // Assisted corner easing: curvature lookahead -> lift (and gentle brake) above corner speed
    r.cornerAssist = 0;
    if (MD.cornerAssist && !r.air) {
      const vC = Math.sqrt(PC.cornerA * (r.carMods ? r.carMods.grip : 1) / Math.max(lookK(r, 14 + r.speed * 1.2), 1e-4));
      const over = r.va - vC;
      if (over > 0) { thr = 0; r.cornerAssist = Math.min(12, over * 2.5); }
    }
    r.thr = lerp(r.thr, thr, Math.min(1, dt * 8));
    r.steer += (st - r.steer) * Math.min(1, dt * (st === 0 ? MD.steerNeutral : MD.steerRise));
    // M6 boost: drain while held; once emptied while held it stays off until released or refilled to
    // BOOST_RELOCK (no micro-boost flicker from small skill earns). Passive regen BOOST_REGEN_RATE /s only
    // after the button has been released for BOOST_REGEN_DELAY s and not after finishing; skill earns unchanged.
    if (keys.boost) { r.boostRelT = 0; if (r.meter <= 0.01) r.boostLock = true; else if (r.meter >= BOOST_RELOCK) r.boostLock = false; }
    else { r.boostRelT += dt; r.boostLock = false; }
    // M8 self-boost pickup: surgeT forces boost for its duration without draining the meter
    const wantB = keys.boost && r.meter > 0.01 && !r.boostLock, surge = r.surgeT > 0;
    r.boost = wantB || surge; if (wantB && !surge) r.meter = Math.max(0, r.meter - dt * 0.32);
    else if (!keys.boost && !r.finished && r.boostRelT >= BOOST_REGEN_DELAY) r.meter = Math.min(1, r.meter + dt * BOOST_REGEN_RATE);
    const air = r.air;
    let vf = r.va * Math.cos(r.psi) - r.vd * Math.sin(r.psi);
    const avf = Math.abs(vf);
    const sf = Math.min(1, avf / 12) * (1 - 0.4 * Math.min(1, avf / 110));
    // explicit drift (keys.drift) replaces v5b's hidden brake+steer airbrake; brake+steer = full braking
    const airbrake = !!keys.drift && Math.abs(r.steer) > 0.25 && vf > 28;
    r.brakeT = brk ? (r.brakeT || 0) + dt : 0;
    let yawT = -r.steer * 2.2 * sf * (vf < -0.5 ? -1 : 1) * (airbrake ? 1.3 : 1) * (air ? 0.35 : 1);
    // racing-line assist when inverted / on the wall: gently aim back toward the middle (player still steers)
    if ((steep || pth === BR) && vf > 15) {
      const dT = 0, lat = clamp((dT - r.d) * 0.05, -0.35, 0.35);
      const psiT = -Math.asin(clamp(lat, -0.5, 0.5)) + kg * 8;
      const k = (inverted ? 1.0 : steep ? 0.6 : 0.4) * (st === 0 ? 1 : 0.35);
      yawT += clamp((psiT - r.psi) * 3.2, -1.4, 1.4) * k;
    }
    r.yawV += (yawT - r.yawV) * Math.min(1, dt * MD.yaw);
    r.psi = wrapA(r.psi + r.yawV * dt);
    const c = Math.cos(r.psi), sn = Math.sin(r.psi);
    vf = r.va * c - r.vd * sn; let vl = r.va * sn + r.vd * c;
    const tow = r.tow;
    const CM = r.carMods || { vmax: 1, acc: 1, grip: 1 };
    const capN = PC.normal * CM.vmax / FASTEST_MOD, capB = PC.boost * CM.vmax / FASTEST_MOD;
    const vmax = (r.boost ? capB : capN) * (MD.draftOverCap ? 1 + 0.06 * tow : 1);
    let a = 0;
    const tm = air ? 0.25 : 1;
    if (thr) a += (r.boost ? 80 : 44) * CM.acc * tm * Math.max(-0.5, 1 - (vf / vmax) * (vf / vmax));
    else if (r.boost) a += 34 * tm * Math.max(0, 1 - (vf / vmax) * (vf / vmax));
    if (vf > vmax) a -= (vf - vmax) * 1.2;
    if (airbrake && !air) a -= 9;
    else if (brk && !air) a -= vf > 0.5 ? MD.brake0 + (MD.brakeMax - MD.brake0) * Math.min(1, r.brakeT / MD.brakeRamp) : 16;
    else if (r.cornerAssist > 0 && vf > 0.5) a -= r.cornerAssist;
    a -= vf * 0.035 * (1 - 0.35 * tow) + (thr || r.boost ? 0 : 3.5) * Math.sign(vf);
    if (r.slingT > 0) { a += 22; r.slingT -= dt; }
    vf += a * dt; if (vf < -22) vf = -22;
    if (!MD.draftOverCap) {   // Assisted: hard ceiling (boost cap while boosting, decaying back to the normal cap) - gravity/draft/slingshot can't exceed it
      r.capHold = r.boost ? capB : Math.max(capN, Math.min(capB, (r.capHold || capN) - 25 * dt));
      if (vf > r.capHold) vf = r.capHold;
    }
    if (!thr && !brk && !r.boost && Math.abs(vf) < 0.6) vf = 0;
    const grip = air ? 0.4 : airbrake ? 1.5 * CM.grip : (r.boost ? 6.0 : 7.5) * (inverted ? 1.25 : 1) * CM.grip;
    const nvl = vl * Math.exp(-grip * dt), lost = Math.abs(vl - nvl); vl = nvl;
    if (vf > 0 && !air) vf += lost * 0.32;
    r.drift = !air && ((airbrake && Math.abs(vl) > 4) || Math.abs(vl) > 12);
    r.va = vf * c + vl * sn; r.vd = -vf * sn + vl * c;
    r.va -= GRAV * f.T.y * dt;
    // advance along the curved surface
    const den = Math.max(0.3, 1 + kg * (r.d + f.off));
    const dsm = r.va * dt / den;
    r.d += r.vd * dt;
    const ang = kg * dsm, ca = Math.cos(ang), sa = Math.sin(ang);
    const va2 = r.va * ca - r.vd * sa, vd2 = r.vd * ca + r.va * sa; r.va = va2; r.vd = vd2; r.psi = wrapA(r.psi - ang);
    r.prevS = r.s; r.s += dsm; transitions(r);
    r.vf = vf; r.vl = vl; r.acc = a; r.speed = Math.hypot(r.va, r.vd);
    if (r.drift && vf > 30) earn(r, 'DRIFT', '#ffc23f', dt * 0.2);
    // walls
    const [wl, wr, rl, rrl] = walls(r);
    const lim = r.wallLim; r.scrape = false;
    if (r.d > wr - lim || r.d < -wl + lim) {
      const s = r.d > 0 ? 1 : -1, edge = s > 0 ? wr : wl, rails = s > 0 ? rrl : rl;
      if (!rails) { if (Math.abs(r.d) > edge + 1.0) crashOut(r, s); }
      else {
        r.d = s * (edge - lim);
        const vn = r.vd * s;
        if (vn > 0) {
          r.vd -= s * vn * 1.3; const k = 1 - Math.min(0.28, vn * 0.009); r.va *= k; r.vd *= k;
          if (Math.abs(r.psi) < 1.4) r.psi -= r.psi * Math.min(0.6, vn * 0.03);
          if (vn >= 2.5 && isFocus(r)) ev.wallHit(r, vn, s, _fp.R);
        }
        r.scrape = true; r.scrapeSide = s;
      }
    } else if (r.speed > 50 && !air) {
      const gap = Math.min((wr - lim) - r.d, r.d + (wl - lim));
      const rails = (r.d > 0 ? rrl : rl);
      if (gap < 1.1 && rails) { r.nearRail += dt; earn(r, 'NEAR MISS · RAIL', '#00f0ff', dt * 0.14); } else r.nearRail = 0;
    }
    // hover / airtime
    const wasAir = r.air;
    const impact = hoverStep(r, kn, Math.max(0, r.va), dt);
    r.air = r.h > H0 + 0.7;
    if (r.air) { r.airT += dt; if (r.airT > 0.12) earn(r, 'AIRTIME', '#7dff4a', dt * 0.4); }
    if (wasAir && !r.air) { if (r.airT > 0.35 && isFocus(r)) { ev.cp(`AIRTIME ${r.airT.toFixed(1)}s`); ev.sfx('thud', 0.6); ev.shake(0.35); } r.airT = 0; }
    if (impact > 3 && isFocus(r)) ev.shake(Math.min(0.5, impact / 20));
  }
  function crashOut(r, s) {
    r.crashed = 1.7;
    r.crashVel = r.F.clone().multiplyScalar(r.speed * 0.8).addScaledVector(_fp.R, s * 14).addScaledVector(_fp.U, 6);
    r.crashSpin = new Vec3(R(-4, 4), R(-6, 6), R(-4, 4)); r.boost = false;
    ev.racer('crash', r); if (isFocus(r)) { ev.flash('OFF THE EDGE', '#ff3355'); ev.crash(r); }
  }
  function respawn(r) {
    r.path = MAIN; r.s = HASBR ? mod(SAm - 60, MAIN.L) : mod(raceS(r.path, r.s) - 40, MAIN.L); r.d = 0; r.psi = 0; r.va = 32; r.vd = 0; r.h = H0 + 1.5; r.vh = 0; r.prevS = r.s;
    r.crashed = 0; r.yawV = 0; r.steer = 0;
    const nd = rdist(MAIN, r.s); let delta = nd - r.lastRd; if (delta > LAPLEN / 2) delta -= LAPLEN; if (delta < -LAPLEN / 2) delta += LAPLEN; r.prog += delta; r.lastRd = nd;
    ev.racer('respawn', r); if (isFocus(r)) { ev.respawn(r); ev.flash('RESPAWN', '#8a5cff'); ev.sfx('beep', 440, 0.15, 0.12); }
  }
  function stepAI(r, dt) {
    const P0 = r.pers, ref = rubberRef(), racing = sim.phase === 'race' || (sim.phase === 'finished' && !!ref);
    const f = frameAt(r.path, r.s, _fa); const pth = f.path, i = f.i;
    const look = 12 + r.speed * 1.15, km = lookK(r, look), PC = sim.pace || paceFor(td.key, sim.mode);
    const kn = kgAt(r.path, r.s + 8 + r.speed * 0.3);
    const DF = DIFF[sim.diff] || DIFF.normal;
    // M3: corner speed from the mode's lateral accel (personality lat relative to 84, difficulty lat)
    const vC = Math.sqrt(PC.cornerA * (P0 ? P0.lat / 84 : 1) * DF.lat / Math.max(km, 1e-4));
    const noise = 1 + 0.018 * Math.sin(sim.time * 0.21 + r.phA) + 0.012 * Math.sin(sim.time * 0.67 + r.phB);
    let rub = 1;
    if (r.isAI && ref && racing) {
      const gapSec = (ref.prog - r.prog) / 62;
      rub = 1 + (gapSec > 0 ? clamp(gapSec / 8, 0, 1.35) * 0.06 : clamp(gapSec / 8, -1.3, 0) * 0.065);
    }
    // M3: AI top pace scaled to the mode's cap (v5b AI ~= the fastest car's cap), personality relative to 93.75
    let vmax = PC.normal * ((P0 ? P0.vmax : 70) / 93.75) * DF.vmax * noise * rub * (PC.mode.draftOverCap ? 1 + 0.04 * r.tow : 1);
    if (r.isAI && racing) {
      r.aiBoostCD -= dt;
      if (r.aiBoostT > 0) { r.aiBoostT -= dt; r.boost = true; }
      else { r.boost = false; if (r.aiBoostCD <= 0 && vC > vmax * 1.4 && r.speed > 60) { r.aiBoostT = R(1.2, 2.2) * P0.boostUse; r.aiBoostCD = R(9, 16) / P0.boostUse; } }
      if (r.boost) vmax = Math.min(vmax * 1.24, PC.boost * Math.min(1, (P0 ? P0.vmax : 70) / 93.75));
    } else r.boost = false;
    if (r.surgeT > 0 && racing) { r.boost = true; vmax = Math.min(vmax * 1.24, PC.boost * Math.min(1, (P0 ? P0.vmax : 70) / 93.75)); }
    if (r.qaBoost) { r.boost = true; vmax *= 1.24; r.meter = 1; }
    const vT = Math.min(vmax, vC * (r.boost ? 1.04 : 1) * Math.min(1.04, rub * noise));
    const dv = vT - r.speed;
    r.speed += dv > 0 ? Math.min(dv, ((P0 ? P0.acc : 24) + (r.boost ? 12 : 0)) * dt) : Math.max(dv, -(P0 ? P0.brake : 44) * dt);
    r.speed -= GRAV * f.T.y * dt; if (r.speed < 0) r.speed = 0;
    if (!PC.mode.draftOverCap) {   // Assisted: same hard ceiling rule as the player (AI never outruns the cap)
      const pf = Math.min(1, (P0 ? P0.vmax : 70) / 93.75), cN = PC.normal * pf, cB = PC.boost * pf;
      r.capHold = r.boost ? cB : Math.max(cN, Math.min(cB, (r.capHold || cN) - 25 * dt));
      if (r.speed > r.capHold) r.speed = r.capHold;
    }
    r.thr = dv > 0.5 ? 1 : 0.3;
    const W = r.path === BR ? WB : W0;
    let dT = -Math.sign(kn) * Math.min(Math.abs(kn) * 260, 1) * W * 0.55 + (P0 ? P0.off : 0);
    if (r.path === MAIN) {
      const toFork = SAm - r.s;
      if (toFork > 0 && toFork < 500 && r.decidedLap !== r.lap) { r.decidedLap = r.lap; r.takeShort = P0 ? rnd() < P0.short : false; }
      if (toFork > 0 && toFork < 240) dT = r.takeShort ? W0 + WB : Math.min(dT, W0 - 3);
    }
    let blocked = false;
    for (const o of sim.racers) {
      if (o === r || o.path !== r.path || o.crashed) continue;
      let gp = o.s - r.s; if (r.path === MAIN) { if (gp > MAIN.L / 2) gp -= MAIN.L; if (gp < -MAIN.L / 2) gp += MAIN.L; }
      const md = P0 ? P0.margin : 4.4;
      if (gp > -3 && gp < 26 && Math.abs(o.d - r.d) < md) {
        const lim = W - 2;
        const left = o.d - md, right = o.d + md;
        const roomL = left + lim, roomR = lim - right;
        dT = roomL > roomR ? left : right;
        if (P0 && P0.aggr > 0.5) dT = roomL > roomR ? o.d - md * 0.8 : o.d + md * 0.8;
        blocked = true;
      }
      if (P0 && P0.block && !o.isAI && gp < 0 && gp > -45 && Math.abs(kn) < 0.006) {
        r.blockD = lerp(r.blockD, o.d, damp(1.2, dt)); dT = clamp(r.blockD, -W + 2.5, W - 2.5);
      }
    }
    for (const dr of sim.drones) {
      if (r.path !== MAIN) break;
      let gp = dr.s - r.s; if (gp > MAIN.L / 2) gp -= MAIN.L; if (gp < -MAIN.L / 2) gp += MAIN.L;
      if (gp > -4 && gp < 40 && Math.abs(dr.d - r.d) < 4.6) { dT = dr.d + (r.d >= dr.d ? 5.2 : -5.2); if (gp < 12 && Math.abs(dr.d - r.d) < 3.2) r.speed = Math.min(r.speed, dr.speed + 10); }
    }
    // M8: static obstacles have the last word (dodge to the side the car is already on)
    if (sim.hazards && r.path === MAIN) for (const o of sim.obstacles) {
      const gp = gapS(r.s, o.s, MAIN.L), reach = o.hw + HAZ.CAR_HALF_W + 1.2;
      if (gp > -3 && gp < Math.max(70, r.speed * 1.2) && Math.abs(o.d - r.d) < reach) { dT = o.d + (r.d >= o.d ? 1 : -1) * (o.hw + 3.2); blocked = true; }
    }
    const wl = r.path === BR ? WB : MAIN.WL[i], wr = r.path === BR ? WB : MAIN.WR[i];
    dT = clamp(dT, -wl + 2.2, wr - 2.2);
    const latSp = P0 && P0.aggr > 0.5 ? 12 : 9.5;
    const want = clamp((dT - r.d) * 2.0, -latSp, latSp); r.dv = lerp(r.dv, want, damp(blocked ? 5 : 3.5, dt));
    r.d = clamp(r.d + r.dv * dt, -wl + 1.5, wr - 1.5);
    const den = Math.max(0.3, 1 + pth.KG[i] * (r.d + f.off));
    r.prevS = r.s; r.s += r.speed * dt / den; transitions(r);
    r.va = r.speed; r.vd = r.dv; r.psi = -Math.atan2(r.dv, Math.max(r.speed, 6));
    const lat = r.speed * r.speed * kn;
    r.rollAI = -clamp(lat * 0.006, -0.42, 0.42);
    r.drift = Math.abs(lat) > 52;
    r.yawV = r.speed * kn; r.steer = clamp(-lat * 0.02, -1, 1);
    r.speedC = r.speed;
    hoverStep(r, pth.KN[i], r.speed, dt);
    r.air = r.h > H0 + 0.7;
  }
  function relS(a, b) { let gp = b.s - a.s; if (a.path === MAIN) { if (gp > MAIN.L / 2) gp -= MAIN.L; if (gp < -MAIN.L / 2) gp += MAIN.L; } return gp; }
  function bumpRacer(r, ds, dd, vs, vd) {
    if (r.autopilot) { r.d += dd; r.s += ds; r.speed = Math.max(0, r.speed + vs); r.dv += vd; }
    else { r.d += dd; r.s += ds; r.va += vs; r.vd += vd; }
  }
  // sim.ghost (multiplayer rooms, approved 18 Nov 2026): racers pass through each other: no car-to-car
  // position push, no impulse, no bump event, for humans AND bots. Track walls, drones (road traffic),
  // slipstream and near-miss scoring are unchanged. Single-player keeps contact (ghost defaults to false).
  function collideRacers(h) {
    const all = sim.racers;
    if (!sim.ghost) for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) {
      const A = all[a], B = all[b]; if (A.path !== B.path || A.crashed || B.crashed) continue;
      const gs = relS(A, B), gd = B.d - A.d;
      if (Math.abs(gs) > 4.8 || Math.abs(gd) > 2.8) continue;
      const ovS = 4.8 - Math.abs(gs), ovD = 2.8 - Math.abs(gd);
      if (ovD < ovS) { const p = ovD * 0.5 * Math.sign(gd || 1); bumpRacer(A, 0, -p, 0, 0); bumpRacer(B, 0, p, 0, 0); }
      else { const p = ovS * 0.5 * Math.sign(gs || 1); bumpRacer(A, -p, 0, 0, 0); bumpRacer(B, p, 0, 0, 0); }
      const va = A.autopilot ? A.speed : A.va, vb = B.autopilot ? B.speed : B.va;
      const vda = A.autopilot ? A.dv : A.vd, vdb = B.autopilot ? B.dv : B.vd;
      const rvS = (vb - va) * Math.sign(gs || 1), rvD = (vdb - vda) * Math.sign(gd || 1);
      let hit = 0;
      if (rvS < 0 && ovS < ovD + 1) { const j = -rvS * 0.42 * Math.sign(gs || 1); bumpRacer(A, 0, 0, -j, 0); bumpRacer(B, 0, 0, j, 0); hit = Math.max(hit, -rvS); }
      if (rvD < 0) { const j = -rvD * 0.55 * Math.sign(gd || 1); bumpRacer(A, 0, 0, 0, -j); bumpRacer(B, 0, 0, 0, j); hit = Math.max(hit, -rvD); }
      if ((isFocus(A) || isFocus(B)) && hit > 2) ev.bump(A, B, hit);
    }
    for (const r of all) {
      if (r.droneT > 0) r.droneT = Math.max(0, r.droneT - h);
      if (r.path !== MAIN || r.crashed) continue;
      for (const dr of sim.drones) droneContact(r, dr);
      if (sim.hazards) for (const o of sim.obstacles) obstacleContact(r, o, h);
    }
  }
  // Road traffic (drones) is kinematic: it never yields. M7 contact model (user report 18 Nov 5:59):
  // box = drone mesh 2.6 x 5.2 + racer 2.8 x 5.2 (lateral sum 2.7, longitudinal 5.2), vertical gate 1.5 m so an
  // airborne car clears traffic; penetration resolved along the least-overlap axis; velocity response only while
  // closing, along that normal: lateral restitution 0.3, longitudinal inelastic (match the drone), plus a
  // deterministic glance (<= 3 m/s, away from the drone's centre line) so a tail hit slides off without the
  // sim RNG. One droneHit event per contact (0.35 s debounce, closing speed >= 1.5 m/s); state rides in r.droneT.
  const DR_L = 5.2, DR_W = 2.7, DR_H = 1.5, DR_E = 0.3, DR_GLANCE = 3, DR_DEBOUNCE = 0.35, DR_MIN_HIT = 1.5;
  function droneContact(r, dr) {
    let gs = dr.s - r.s; if (gs > MAIN.L / 2) gs -= MAIN.L; if (gs < -MAIN.L / 2) gs += MAIN.L;
    const gd = dr.d - r.d;
    if (Math.abs(gs) >= DR_L || Math.abs(gd) >= DR_W || Math.abs(r.h - dr.h) >= DR_H) return;
    if (sim.hazards && (r.passT > 0 || shieldAbsorb(r, 'drone'))) return;   // M8 shield: one free pass through traffic
    const ovS = DR_L - Math.abs(gs), ovD = DR_W - Math.abs(gd), sgS = gs < 0 ? -1 : 1, sgD = gd < 0 ? -1 : 1;
    const ai = !!r.autopilot, vS = ai ? r.speed : r.va, vD = ai ? r.dv : r.vd;
    let closing = 0;
    if (ovD < ovS) {   // side contact: normal is lateral
      bumpRacer(r, 0, -ovD * sgD, 0, 0);
      const vn = vD * sgD;   // > 0: moving into the drone (drone has no lateral velocity)
      if (vn > 0) { closing = vn; bumpRacer(r, 0, 0, 0, -(1 + DR_E) * vn * sgD); }
    } else {           // nose/tail contact: normal is longitudinal
      bumpRacer(r, -ovS * sgS, 0, 0, 0);
      const vn = (vS - dr.speed) * sgS;   // > 0: closing on the drone
      if (vn > 0) {
        closing = vn; bumpRacer(r, 0, 0, -vn * sgS, 0);
        const away = gd === 0 ? (r.d <= 0 ? -1 : 1) : -sgD;
        bumpRacer(r, 0, 0, 0, away * Math.min(DR_GLANCE, vn * 0.08));
      }
    }
    if (closing >= DR_MIN_HIT && !(r.droneT > 0)) { r.droneT = DR_DEBOUNCE; if (isFocus(r)) ev.droneHit(r, closing); }
  }
  // ---- M8 hazards (see src/core/hazards.js; all state rides in racer fields + sim.pads, so snapshots carry it) ----
  function shieldAbsorb(r, what) {
    if (!(r.shieldT > 0)) return false;
    r.shieldT = 0; r.passT = HAZ.SHIELD_PASS;
    ev.racer('shield', r, what); if (isFocus(r)) ev.shieldPop(r, what);
    return true;
  }
  // Static block, kinematic like traffic. Least-overlap axis: side contact = push out + 0.3 restitution;
  // nose contact = one debounced speed penalty (keep 60 %, lose <= 35 m/s) + glance toward the open side and a
  // lateral slide-out capped at 0.35 m per step (never pushed backwards, never stopped dead). Airborne cars clear it.
  function obstacleContact(r, o, h) {
    const gs = gapS(r.s, o.s, MAIN.L), gd = o.d - r.d, LL = o.hl + HAZ.CAR_HALF_LEN, WW = o.hw + HAZ.CAR_HALF_W;
    if (Math.abs(gs) >= LL || Math.abs(gd) >= WW || r.h >= H0 + o.h) return;
    if (r.passT > 0 || shieldAbsorb(r, 'obstacle')) return;
    const ovS = LL - Math.abs(gs), ovD = WW - Math.abs(gd), sgD = gd < 0 ? -1 : 1;
    const away = gd === 0 ? (o.d > 0 ? -1 : 1) : -sgD;   // toward the open side
    const ai = !!r.autopilot, vS = ai ? r.speed : r.va, vD = ai ? r.dv : r.vd;
    let closing = 0;
    if (ovD < ovS) {
      bumpRacer(r, 0, away * ovD, 0, 0);
      const vn = -vD * away; if (vn > 0) { closing = vn; bumpRacer(r, 0, 0, 0, away * 1.3 * vn); }
    } else {
      bumpRacer(r, 0, away * Math.min(ovD, 0.35), 0, 0);
      if (!(r.obT > 0) && vS > 0) {
        const loss = Math.min(HAZ.OB_MAX_LOSS, vS * (1 - HAZ.OB_SPEED_KEEP)); closing = vS;
        if (ai) r.speed = Math.max(0, r.speed - loss); else { const k = (vS - loss) / vS; r.va *= k; }
        const g = Math.min(HAZ.OB_GLANCE, vS * 0.1);
        if (vD * away < g) bumpRacer(r, 0, 0, 0, away * g - vD);
      }
    }
    if (closing >= 1.5 && !(r.obT > 0)) { r.obT = HAZ.OB_DEBOUNCE; ev.racer('obstacle', r, closing); if (isFocus(r)) ev.obstacleHit(r, closing, o); }
  }
  // pads: claimed in seat order (deterministic); one power of each kind at a time, per-racer cooldown
  function claimPads() {
    for (const r of sim.racers) {
      if (r.crashed > 0 || r.finished || r.path !== MAIN || r.powCD > 0 || r.h > H0 + 2.5) continue;
      for (const p of sim.pads) {
        if (p.readyAt > sim.time) continue;
        if ((p.kind === 'S' && r.shieldT > 0) || (p.kind === 'B' && r.surgeT > 0)) continue;
        if (Math.abs(gapS(r.s, p.s, MAIN.L)) >= HAZ.PAD_HALF_LEN || Math.abs(p.d - r.d) >= HAZ.PAD_HALF_W + 0.6) continue;
        p.readyAt = sim.time + HAZ.PAD_RESPAWN; r.powCD = HAZ.CLAIM_COOLDOWN;
        if (p.kind === 'S') { r.shieldT = HAZ.SHIELD_TIME; r.passT = 0; } else r.surgeT = HAZ.SURGE_TIME;
        ev.racer('pickup', r, p.kind); if (isFocus(r)) ev.pickup(r, p.kind);
        break;
      }
    }
  }
  function hazardTimers(h) {
    for (const r of sim.racers) {
      if (r.shieldT > 0) { r.shieldT = Math.max(0, r.shieldT - h); if (r.shieldT === 0 && isFocus(r)) ev.shieldPop(r, 'expired'); }
      if (r.surgeT > 0) r.surgeT = Math.max(0, r.surgeT - h);
      if (r.powCD > 0) r.powCD = Math.max(0, r.powCD - h);
      if (r.obT > 0) r.obT = Math.max(0, r.obT - h);
      if (r.passT > 0) r.passT = Math.max(0, r.passT - h);
    }
  }
  function nearMisses() { for (const h of sim.racers) if (!h.isAI) nearMiss(h); }
  function nearMiss(p) {
    if (p.autopilot || p.crashed || p.speed < 40) return;
    const others = sim.racers.filter(o => o !== p).map(o => [o, o.path === p.path ? relS(p, o) : null, o.d, o.name]).concat(sim.drones.map((d, k) => [d, p.path === MAIN ? (() => { let g = d.s - p.s; if (g > MAIN.L / 2) g -= MAIN.L; if (g < -MAIN.L / 2) g += MAIN.L; return g; })() : null, d.d, 'D' + k]));
    for (const [, gs, od, key] of others) {
      if (gs == null) { p.lastSign[key] = 0; continue; }
      const sg = Math.sign(gs); const prev = p.lastSign[key] || 0;
      if (prev > 0 && sg <= 0 && Math.abs(gs) < 8) { const ld = Math.abs(od - p.d); if (ld > 2.8 && ld < 5.6) { earn(p, 'NEAR MISS', '#ff2bd6', 0.1); if (isFocus(p)) ev.sfx('zip'); } }
      p.lastSign[key] = Math.abs(gs) < 30 ? sg : 0;
    }
  }
  function slipstream(r, dt) {
    let inCone = false;
    for (const o of sim.racers) {
      if (o === r || o.path !== r.path || o.crashed) continue;
      const gs = relS(r, o); if (gs < 5 || gs > 42) continue;
      if (Math.abs(o.d - r.d) < 1.6 + gs * 0.05) { inCone = true; break; }
    }
    const was = r.draftT;
    if (inCone && r.speed > 45) r.draftT = Math.min(1.8, r.draftT + dt); else r.draftT = Math.max(0, r.draftT - dt * (r.draftT > 1.5 ? 0.6 : 2.2));
    r.tow = clamp((r.draftT - 0.4) / 1.1, 0, 1);
    if (!r.isAI) {
      if (r.tow > 0.2) earn(r, 'SLIPSTREAM', '#00f0ff', dt * 0.06);
      if (!inCone && was >= 1.5 && r.slingT <= 0 && !r.autopilot) { r.slingT = 0.5; r.draftT = 0; if (isFocus(r)) { ev.flash('SLINGSHOT', '#00f0ff'); ev.sfx('whoosh'); ev.kick(6); } }
    } else if (!inCone && was >= 1.5) { r.speed += 6; r.draftT = 0; }   // (Assisted: clipped by the AI ceiling next step)
  }
  function checkLaps(r, h) {
    const nd = rdist(r.path, r.s);
    let delta = nd - r.lastRd; if (delta > LAPLEN / 2) delta -= LAPLEN; if (delta < -LAPLEN / 2) delta += LAPLEN;
    if (delta > MAX_STEP_ADVANCE(h)) r.lapIntegrity.teleport = true;     // position jumped forward: not a drivable lap
    if (!r.isAI && r.autopilot && !r.finished) r.lapIntegrity.autopilot = true;
    if (sim.debugTouched) r.lapIntegrity.debug = true;
    r.prog += delta; r.lastRd = nd;
    const rt = sim.raceTime();
    while (!r.finished && r.prog >= (r.lap + 1) * LAPLEN) {
      const lt = rt - r.lapStart, integ = r.lapIntegrity;
      r.lapTimes.push(lt); r.lapValid.push(!integ.teleport && !integ.autopilot && !integ.debug); r.lapStart = rt; r.lap++;
      r.lapIntegrity = { teleport: false, autopilot: false, debug: false };
      if (!r.isAI) onHumanLap(r, lt, integ);
      if (r.lap >= LAPS) { r.finished = true; r.finishTime = rt; sim.finishOrder.push(r); if (!r.isAI) onHumanFinish(r); }
    }
    const f = frameAt(r.path, r.s, _fb); const sec = f.path.sec[f.i];
    if (sec !== r.sector) {
      const prev = r.sector; r.sector = sec;
      if (!r.isAI && !r.finished && sec === (prev + 1) % SECTORS.length) {
        let split = null, delta2 = null;
        if (sec !== 0) {
          split = rt - r.lapStart; r.curSplits[sec] = split;
          if (r.bestSplits[sec] != null) delta2 = split - r.bestSplits[sec];
          let html = `S${sec} SPLIT &nbsp; ${fmtTime(split)}`;
          if (delta2 != null) html += ` &nbsp; <span class="${delta2 < 0 ? 'neg' : 'pos'}">${delta2 < 0 ? '−' : '+'}${Math.abs(delta2).toFixed(2)}</span>`;
          if (isFocus(r)) { ev.cp(html); ev.sfx('beep', 1320, 0.08, 0.1); }
        }
        if (isFocus(r)) ev.sector(sec, split, delta2);
      }
    }
  }
  function onHumanLap(r, lt, integrity) {
    const isBest = lt < r.bestLap;
    if (isBest) { r.bestLap = lt; r.bestSplits = r.curSplits.slice(); }
    r.curSplits = [];
    if (isFocus(r)) { sim.bestLap = r.bestLap; sim.bestSplits = r.bestSplits; sim.curSplits = r.curSplits; }
    const lap = { time: lt, lapLen: LAPLEN, integrity, isBest, lap: r.lap, map: td.key };
    ev.racer('lap', r, lap);
    if (!isFocus(r)) return;
    ev.lap(lap);
    if (r.lap < LAPS) {
      ev.flash(r.lap === LAPS - 1 ? 'FINAL LAP' : `LAP ${r.lap + 1}`, r.lap === LAPS - 1 ? '#ffc23f' : '#00f0ff');
      ev.cp(`LAP ${fmtTime(lt)}${isBest ? ' &nbsp; <span class="neg">BEST</span>' : ''}`);
      ev.sfx('chime');
    }
  }
  function onHumanFinish(r) {
    r.autopilot = true;
    r.speed = Math.max(25, r.va); r.dv = 0; r.pers = Object.assign({}, FINISH_PERS);
    const p = sim.finishOrder.indexOf(r) + 1;
    ev.racer('finish', r, { position: p, time: r.finishTime });
    if (humans().every(h => h.finished)) sim.phase = 'finished';
    if (!isFocus(r)) return;
    sim.phase = 'finished';   // single player / local view: the local race is over
    ev.flash(p === 1 ? 'VICTORY' : 'FINISH', p === 1 ? '#ffc23f' : '#00f0ff'); ev.sfx('chime');
    ev.cp(`P${p} · ${fmtTime(r.finishTime)}`);
    ev.playerFinish(p, r.finishTime);
  }
  function resetPlayer(r = sim.player) {
    if (!r || r.autopilot || r.crashed) return false;
    const f = frameAt(r.path, r.s, _fp);
    const wl = r.path === BR ? WB : MAIN.WL[f.i], wr = r.path === BR ? WB : MAIN.WR[f.i];
    r.d = clamp(r.d, -wl + 3, wr - 3); r.psi = 0; r.va = Math.max(0, r.va) * 0.3; r.vd = 0; r.yawV = 0; r.steer = 0; r.h = H0 + 1; r.vh = 0;
    ev.racer('reset', r); if (isFocus(r)) { ev.flash('RESET', '#8a5cff'); ev.sfx('beep', 440, 0.15, 0.12); } return true;
  }
  function rankKey(r) { return r.finished ? 1e9 - sim.finishOrder.indexOf(r) * 1e6 : r.prog; }
  function ranks() { return sim.racers.slice().sort((a, b) => rankKey(b) - rankKey(a)); }

  // world pose from track coordinates (was placeRacerVis)
  function pose(r) {
    const f = frameAt(r.path, r.s, _fv);
    const d = r.d + f.off;
    r.world.copy(f.P).addScaledVector(f.R, d).addScaledVector(f.U, r.h);
    const c = Math.cos(r.psi), s = Math.sin(r.psi);
    r.F.copy(f.T).multiplyScalar(c).addScaledVector(f.R, -s);
    r.Uw.copy(f.U);
    return f;
  }
  function poseAll() { for (const r of sim.racers) if (!(r.crashed > 0)) pose(r); for (const d of sim.drones) stepDrone(d, 0, false); }
  function stepDrone(d, dt, move) {
    if (move) d.s = mod(d.s + d.speed * dt, MAIN.L);
    const f = frameAt(MAIN, d.s, _fd);
    d.d = clamp(d.lane * (MAIN.W[f.i] / W0), -MAIN.WL[f.i] + 2.2, MAIN.WR[f.i] - 2.2);
    if (dt > 0) hoverStep(d, MAIN.KN[f.i], d.speed, dt);
    if (sim.hazards) for (const o of sim.obstacles) {   // M8: traffic hops over a static block (deterministic lift)
      const g = gapS(d.s, o.s, MAIN.L);
      if (Math.abs(g) < HAZ.DRONE_HOP_RANGE && Math.abs(o.d - d.d) < o.hw + 1.6) { const lift = H0 + 0.1 + HAZ.DRONE_HOP * 0.5 * (1 + Math.cos(Math.PI * g / HAZ.DRONE_HOP_RANGE)); if (d.h < lift) { d.h = lift; if (d.vh < 0) d.vh = 0; } }
    }
    d.world.copy(f.P).addScaledVector(f.R, d.d).addScaledVector(f.U, d.h);
    d.fi = f.i;
    return f;
  }

  // One fixed simulation step of h seconds.
  function step(h) {
    sim.time += h;
    const racing = sim.phase === 'race' || sim.phase === 'finished';
    if (racing) {
      for (const r of sim.racers) { if (r.crashed > 0) continue; r.autopilot ? stepAI(r, h) : stepPlayer(r, h); }
      if (sim.hazards) hazardTimers(h);
      collideRacers(h);
      if (sim.hazards) claimPads();
      for (const r of sim.racers) { if (!r.crashed) { slipstream(r, h); checkLaps(r, h); } }
      nearMisses();
      // Assisted: ceiling re-applied after slingshot/collision impulses (AI uses r.speed; player uses va/vd)
      if (!(sim.pace && sim.pace.mode.draftOverCap)) for (const r of sim.racers) {
        if (r.capHold == null || r.crashed) continue;
        if (r.autopilot) { if (r.speed > r.capHold) r.speed = r.capHold; }
        else { const sp = Math.hypot(r.va, r.vd); if (sp > r.capHold) { const k = r.capHold / sp; r.va *= k; r.vd *= k; r.speed = r.capHold; } }
      }
    } else {
      for (const r of sim.racers) { const f = frameAt(r.path, r.s, _fb); hoverStep(r, f.path.KN[f.i], 0, h); if (!r.isAI) r.thr = lerp(r.thr, r.input.up ? 1 : 0, Math.min(1, h * 8)); }
    }
    for (const r of sim.racers) {
      if (r.isAI) continue;
      if (r.crashed > 0) { r.crashed -= h; if (r.crashed <= 0) respawn(r); }
      r.wrongWayT = (racing && !r.finished && !r.autopilot && !r.crashed && Math.cos(r.psi) < -0.3 && r.va < -3) ? r.wrongWayT + h : 0;
    }
    for (const d of sim.drones) stepDrone(d, h, racing);
    for (const r of sim.racers) if (!(r.crashed > 0)) pose(r);
  }
  // Countdown finished: lights out.
  function startRace() {
    sim.phase = 'race'; sim.raceStart = sim.time; for (const r of sim.racers) r.lapStart = 0;
    let focusPerfect = false;
    for (const p of sim.racers) {
      if (p.isAI || !p.input.up) continue;
      p.va = 34; p.meter = Math.min(1, p.meter + 0.2);
      if (isFocus(p)) { focusPerfect = true; ev.flash('PERFECT LAUNCH', '#ffc23f'); ev.sfx('whoosh'); ev.kick(8); }
    }
    return focusPerfect;
  }

  // ---- snapshot / import: complete simulation state (incl. PRNG), JSON-safe ----
  const SKIP = new Set(['ship', 'trails', 'emPrev', 'emAcc', 'wvel', 'prevW', 'carKey', 'root', 'beacon']);   // client-only visuals
  const enc = v => {
    if (v === Infinity) return { $inf: 1 }; if (v === -Infinity) return { $inf: -1 };
    if (v instanceof Vec3) return { $v: [v.x, v.y, v.z] };
    if (v === MAIN) return { $path: 'main' }; if (BR && v === BR) return { $path: 'branch' };
    if (Array.isArray(v)) return v.map(enc);
    if (v && typeof v === 'object') { const o = {}; for (const k in v) if (typeof v[k] !== 'function') o[k] = enc(v[k]); return o; }
    return v;
  };
  const dec = v => {
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === 'object') {
      if ('$inf' in v) return v.$inf * Infinity; if ('$v' in v) return new Vec3(...v.$v); if ('$path' in v) return v.$path === 'main' ? MAIN : BR;
      const o = {}; for (const k in v) o[k] = dec(v[k]); return o;
    }
    return v;
  };
  const encObj = (o) => { const out = {}; for (const k in o) if (!SKIP.has(k) && typeof o[k] !== 'function') out[k] = enc(o[k]); return out; };
  function snapshot() {
    return { v: 1, map: td.key, mode: sim.mode, diff: sim.diff, ghost: !!sim.ghost, hazards: !!sim.hazards, pads: sim.pads.map(p => p.readyAt), time: sim.time, raceStart: sim.raceStart, phase: sim.phase, rng: rng.a,
      bestLap: enc(sim.bestLap), bestSplits: enc(sim.bestSplits), curSplits: enc(sim.curSplits), debugTouched: sim.debugTouched,
      focus: sim.player ? sim.player.id : null, finishOrder: sim.finishOrder.map(r => r.id),
      racers: sim.racers.map(encObj), drones: sim.drones.map(encObj) };
  }
  // import into a sim created with the same seed-independent setup (track is rebuilt from the map key)
  function importSnapshot(sn) {
    if (!sn || sn.v !== 1) throw new Error('bad snapshot version');
    if (!td || td.key !== sn.map) setTrack(sn.map);
    setMode(sn.mode); sim.diff = sn.diff; sim.ghost = !!sn.ghost; sim.hazards = !!sn.hazards;
    if (Array.isArray(sn.pads)) sn.pads.forEach((t, k) => { if (sim.pads[k]) sim.pads[k].readyAt = t; }); sim.time = sn.time; sim.raceStart = sn.raceStart; sim.phase = sn.phase; rng.a = sn.rng;
    sim.bestLap = dec(sn.bestLap); sim.bestSplits = dec(sn.bestSplits); sim.curSplits = dec(sn.curSplits); sim.debugTouched = sn.debugTouched;
    const old = new Map(sim.racers.map(r => [r.id, r]));
    sim.racers.length = 0;
    for (const o of sn.racers) { const r = old.get(o.id) || {}; for (const k in r) if (!SKIP.has(k)) delete r[k]; Object.assign(r, dec(o)); sim.racers.push(r); }
    sim.player = sn.focus ? sim.racers.find(r => r.id === sn.focus) || null : null;
    if (sim.player) { Object.assign(sim.input, sim.player.input); sim.player.input = sim.input; }
    sim.finishOrder = sn.finishOrder.map(id => sim.racers.find(r => r.id === id));
    sn.drones.forEach((o, k) => { const d = sim.drones[k] || (sim.drones[k] = {}); for (const key in d) if (!SKIP.has(key)) delete d[key]; Object.assign(d, dec(o)); });
    sim.drones.length = sn.drones.length;
  }

  // one racer's full physics state (own-car prediction / server reconciliation)
  function racerState(id) { const r = sim.racers.find(x => x.id === id); return r ? encObj(r) : null; }
  function setRacerState(id, o) { const r = sim.racers.find(x => x.id === id); if (!r) return false; const inp = r.input; for (const k in r) if (!SKIP.has(k)) delete r[k]; Object.assign(r, dec(o)); if (inp) { Object.assign(inp, r.input); r.input = inp; } pose(r); return true; }
  Object.assign(sim, { racerState, setRacerState, snapshot, importSnapshot, addSeats, setTrack, setMode, addRacers, gridUp, placeRacer, step, startRace, resetPlayer, ranks, rankKey, pose, poseAll, hoverStep, relS,
    frameAt, kgAt, raceS, rdist });
  return sim;
}
