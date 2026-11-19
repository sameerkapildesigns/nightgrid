// Client netcode (pure; no DOM, no Three.js, no sockets): own-car prediction with server reconciliation,
// remote-car snapshot interpolation, and clock sync. Used by the browser (src/client/mp.js) and by the
// headless network tests (tests/net/*), so what is measured is the same code that ships.
//
// Prediction model: the local car is simulated by a private sim that contains ONLY the local racer and
// the traffic drones (imported from the authoritative race snapshot, so drones and track match the
// server). Each 120 Hz step consumes the local input frame; frames are kept until the server
// acknowledges them. On every snapshot the local racer is reset to the server's state at the
// acknowledged frame and the un-acknowledged frames are replayed (silently: no presentation events).
// Rooms are contact-free (sim.ghost, M5). Slipstream from OTHER cars still exists only on the server, so it
// arrives as a correction (measured, see docs/M5-SYNC.md). The rendered car hides small corrections by
// blending a decaying visual offset; large ones (> HARD_SNAP_M) snap.
import { createSim } from '../core/sim.js';
import { SIM_DT } from '../core/clock.js';
import { wrapA, mod } from '../core/math.js';
import { Vec3 } from '../core/vec.js';
import { decodeFrame, INTERP_DELAY_MS, EXTRAP_MAX_MS } from './protocol.js';
import { applyPads } from '../core/hazards.js';

// local-car fields the renderer needs (sim.pose recomputes world/frame from these)
export const VIEW_FIELDS = ['s', 'd', 'h', 'vh', 'psi', 'va', 'vd', 'yawV', 'steer', 'speed', 'dv', 'prog', 'lastRd', 'lap', 'lapStart', 'lapTimes', 'finished', 'finishTime', 'boost', 'meter', 'drift', 'air', 'airT', 'thr', 'vf', 'vl', 'acc', 'scrape', 'scrapeSide', 'sector', 'draftT', 'tow', 'wrongWayT', 'bestLap', 'curSplits', 'autopilot', 'rollAI', 'edgeAssist', 'cornerAssist', 'shieldT', 'surgeT', 'powCD', 'wpn', 'wpnAt', 'fireCD', 'wImmT', 'empT', 'slowT', 'slowRate', 'wBoxAt', 'lockId', 'lastAid', 'aLog', 'wDistance', 'wThreats','tk','tkDir','tkN','jump'];
export const HARD_SNAP_M = 6, SMOOTH_RATE = 12, MAX_PENDING = 360, MAX_CATCHUP_STEPS = 120;   // prediction steps are cheap (one car): up to 1 s per call

export class Predictor {
  // raceMsg: the server's 'race' message; events: presentation hooks for the local car (or null)
  constructor(raceMsg, events = null) {
    const sim = this.sim = createSim({ seed: raceMsg.seed });
    sim.setMode(raceMsg.mode); sim.setTrack(raceMsg.map);
    sim.importSnapshot(raceMsg.snap); sim.predictOnly = true; sim.ghost = true;   // same rule as the room server (contact-free), so prediction has no contact term to miss
    const me = sim.racers.find(r => r.id === raceMsg.you);
    if (!me) throw new Error('you are not in this race');
    sim.racers.length = 0; sim.racers.push(me);
    sim.finishOrder = sim.finishOrder.filter(r => r === me);
    sim.player = me; Object.assign(sim.input, me.input); me.input = sim.input;
    this.me = me; this.you = raceMsg.you; this.events = events; sim.events = events;
    this.hist = new Map();      // seq -> frame (un-acknowledged)
    this.seq = raceMsg.step | 0; // next frame sequence number == local step index
    this.ack = -1; this.correction = new Vec3(); this._p = new Vec3();
    this.stats = { corrections: [], visual: [], hard: 0, replayed: 0, maxPending: 0, resyncs: 0 };
  }
  get pending() { return this.hist.size; }
  // advance one fixed step with this input frame
  step(frame) {
    if (this.hist.size >= MAX_PENDING) return false;   // server silent for 3 s: stop predicting further (bounded)
    decodeFrame(frame, this.sim.input);
    if (this.sim.phase === 'grid') this.sim.startRace();   // frame 0 = lights out (same order as the server)
    this.hist.set(this.seq, frame); this.seq++;
    this.sim.step(SIM_DT);
    if (this.hist.size > this.stats.maxPending) this.stats.maxPending = this.hist.size;
    return true;
  }
  // jump the timeline forward without simulating (tab was hidden / huge stall); the next snapshot corrects
  resync(seq) { this.stats.resyncs++; this.seq = seq; }
  // authoritative snapshot -> reset to server state at the ack, replay the rest
  reconcile(s) {
    if (!s.me || s.ack < this.ack) return null;
    for (const k of this.hist.keys()) if (k <= s.ack) this.hist.delete(k);
    this.ack = s.ack;
    const sim = this.sim, me = this.me;
    this._p.copy(me.world).add(this.correction);   // what is on screen now
    const raw = me.world.clone();                   // where prediction had the car (no visual offset)
    const evs = sim.events; sim.events = null;      // replay is silent (no duplicate sfx / flashes / boost FX)
    sim.setRacerState(this.you, s.me);
    sim.stepIndex = s.k;
    sim.time = s.tm; if (s.ph === 'race') sim.phase = me.finished ? 'finished' : 'race';
    if (s.pk) applyPads(sim.pads, s.pk, s.tm);   // M8: pad availability is the server's, never the prediction's
    if (s.dr) s.dr.forEach((d, k) => { const o = sim.drones[k]; if (o) { o.s = d[0]; o.h = d[1]; o.vh = d[2]; } });
    let n = 0;
    for (const [, frame] of [...this.hist.entries()].sort((a, b) => a[0] - b[0])) { decodeFrame(frame, sim.input); sim.step(SIM_DT); n++; }
    sim.events = evs; this.stats.replayed += n;
    // visual error = where the car was drawn minus where it now is
    const err = this._p.clone().sub(me.world), dist = err.length();
    const mis = raw.distanceTo(me.world); this.stats.corrections.push(mis);   // misprediction (metres) at this snapshot
    if (dist > HARD_SNAP_M || me.crashed > 0) { this.correction.set(0, 0, 0); if (dist > HARD_SNAP_M) this.stats.hard++; } else this.correction.copy(err);
    this.stats.visual.push(dist); return mis;
  }
  // per rendered frame: decay the visual offset
  decay(dt) { this.correction.multiplyScalar(Math.exp(-SMOOTH_RATE * dt)); return this.correction; }
}

// Remote cars: buffer of timestamped server snapshots, rendered INTERP_DELAY_MS in the past.
export class Interpolator {
  constructor(track, delayMs = INTERP_DELAY_MS) { this.td = track; this.delay = delayMs; this.buf = []; this.stats = { underruns: 0, extrapMs: [], ages: [] }; }
  push(s) { if (this.buf.length && s.sn <= this.buf[this.buf.length - 1].sn) return; this.buf.push({ t: s.sn, a: new Map(s.a.map(x => [x[0], x])) }); if (this.buf.length > 40) this.buf.shift(); }
  // write interpolated fields of racer `id` into `out` (track-space fields used by sim.pose + visuals)
  sample(id, serverNow, out) {
    const b = this.buf; if (!b.length) return false;
    const t = serverNow - this.delay;
    let i = b.length - 1; while (i > 0 && b[i - 1].t > t) i--;
    const B = b[i], A = i > 0 ? b[i - 1] : null, xb = B.a.get(id); if (!xb) return false;
    if (A && t <= B.t && t >= A.t) {
      const xa = A.a.get(id); const k = (t - A.t) / Math.max(1, B.t - A.t);
      if (!xa || xa[1] !== xb[1] || xa[11] !== xb[11]) return this.write(xb, out, 0);
      return this.write(xb, out, 0, xa, k);
    }
    if (t > B.t) {   // late: extrapolate along the track, bounded
      const ex = Math.min(t - B.t, EXTRAP_MAX_MS); this.stats.underruns++; if (this.stats.extrapMs.length < 50000) this.stats.extrapMs.push(t - B.t);
      return this.write(xb, out, ex / 1000);
    }
    return this.write(xb, out, 0);   // older than the buffer: oldest
  }
  write(x, out, exSec, xa = null, k = 0) {
    const MAIN = this.td.MAIN, L = MAIN.L, br = x[1] === 1;
    let s = x[2], d = x[3], h = x[4], psi = x[5], speed = x[6];
    if (xa) {
      let ds = x[2] - xa[2]; if (!br) { if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L; }
      s = xa[2] + ds * k; if (!br) s = mod(s, L);
      d = xa[3] + (x[3] - xa[3]) * k; h = xa[4] + (x[4] - xa[4]) * k; psi = xa[5] + wrapA(x[5] - xa[5]) * k; speed = xa[6] + (x[6] - xa[6]) * k;
    }
    if (exSec > 0 && !x[11] && !x[10]) { s += speed * Math.cos(psi) * exSec; if (!br) s = mod(s, L); }
    out.path = br ? this.td.BR : MAIN; out.s = s; out.d = d; out.h = h; out.psi = psi; out.speed = speed; out.va = speed * Math.cos(psi); out.vd = -speed * Math.sin(psi);
    out.lap = x[7]; out.prog = x[8]; out.boost = !!x[9]; out.finished = !!x[10]; out.netCrashed = !!x[11]; out.rollNet = x[12]; out.steer = x[13]; out.drift = !!x[14]; out.thr = x[15]; out.pw = x[16] | 0;out.tk=xa?(xa[17]||0)+wrapA((x[17]||0)-(xa[17]||0))*k:(x[17]||0);
    return true;
  }
  age(serverNow) { const b = this.buf; return b.length ? serverNow - b[b.length - 1].t : Infinity; }
}

// NTP-style clock sync: keep the lowest-RTT recent samples (least queueing noise).
export class ClockSync {
  constructor() { this.samples = []; this.offset = 0; this.rtt = 0; this.ready = false; }
  sample(c, s, now) {   // c: client send time, s: server time, now: client receive time (same clock as c)
    const rtt = now - c; if (rtt < 0 || rtt > 10000) return;
    this.samples.push({ rtt, off: s - (c + rtt / 2) }); if (this.samples.length > 12) this.samples.shift();
    const best = this.samples.slice().sort((a, b) => a.rtt - b.rtt).slice(0, 4);
    const off = best.reduce((a, x) => a + x.off, 0) / best.length;
    this.offset = this.ready ? this.offset + (off - this.offset) * 0.3 : off; this.rtt = best[0].rtt; this.ready = true;
  }
  serverNow(now) { return now + this.offset; }
}
export { SIM_DT, MAX_CATCHUP_STEPS as MAX_CATCHUP };
