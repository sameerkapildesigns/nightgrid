// Authoritative NIGHTGRID room server (transport-agnostic). One instance per room (one Durable Object).
// The server owns physics, boost, checkpoints, laps and the winner: clients only send inputs; there is
// no message type for results. Shared pure core (same sim as the browser), fixed 120 Hz steps, 20 Hz
// input/snapshot. Idle lobby: no ticking (hibernatable). Countdown/race: a 50 ms interval keeps it awake.
// Persistence: room metadata only on phase changes (never per frame).
// Restart policy: in-memory race state is not persisted; if the room restarts mid-race the race is
// ABORTED and everyone is returned to the lobby with a notice (honest, no silent resume).
import * as Room from '../src/core/room.js';
import { createSim } from '../src/core/sim.js';
import { createClock, SIM_DT } from '../src/core/clock.js';
import { CARS } from '../src/core/roster.js';
import { parseClient, rateLimiter, compactRacer, NET_HZ, INPUT_RATE_MAX, MSG_RATE_MAX, BACKPRESSURE_BYTES, PROTOCOL } from '../src/net/protocol.js';

const ZERO = { up: 0, down: 0, left: 0, right: 0, boost: 0, drift: 0 };
export class RoomServer {
  // timers: { now(), setInterval, clearInterval, setTimeout, clearTimeout }; persist(meta) optional; restored: meta from storage
  constructor({ code, build, timers, persist = null, restored = null, seed = null, resultsHoldMs = 8000, finishGraceMs = 30000 }) {
    this.t = timers; this.persist = persist; this.resultsHoldMs = resultsHoldMs; this.finishGraceMs = finishGraceMs;
    this.room = Room.createRoom({ code, build, now: this.t.now() });
    this.conns = new Map();   // conn -> { id, inRate, msgRate, lastSeq, lastBuffered }
    this.inputs = new Map();  // human id -> { k, seq, at }
    this.sim = null; this.loop = null; this.notice = null; this.seedFn = seed || (() => (Math.random() * 2 ** 32) >>> 0);
    this.stats = { ticks: 0, tickMs: [], sentBytes: 0, sentMsgs: 0, recvMsgs: 0, skippedBackpressure: 0, rejected: {}, persists: 0 };
    if (restored) { Object.assign(this.room, restored, { phase: 'lobby' }); for (const s of this.room.seats) { s.ready = s.kind === 'bot'; s.connected = false; s.dcAt = this.t.now(); } if (restored.phase && restored.phase !== 'lobby') this.notice = 'room-restarted-race-aborted'; this.scheduleExpiry(); }
  }
  // ---- transport hooks ----
  connect(conn) { this.conns.set(conn, { id: null, inRate: rateLimiter(INPUT_RATE_MAX), msgRate: rateLimiter(MSG_RATE_MAX), lastSeq: -1 }); }
  close(conn) {
    const c = this.conns.get(conn); this.conns.delete(conn); if (!c || !c.id) return;
    if (![...this.conns.values()].some(x => x.id === c.id)) { Room.disconnect(this.room, c.id, this.t.now()); this.inputs.delete(c.id); this.scheduleExpiry(); this.broadcastLobby(); this.save(); }
  }
  message(conn, text) {
    const c = this.conns.get(conn); if (!c) return; this.stats.recvMsgs++;
    const now = this.t.now();
    const p = parseClient(text); if (!p.ok) return this.reject(conn, p.error);
    const m = p.msg;
    if (m.t === 'input') { if (!c.inRate(now)) return this.reject(conn, 'input-rate'); }
    else if (!c.msgRate(now)) return this.reject(conn, 'msg-rate');
    if (m.t === 'ping') return this.send(conn, { t: 'pong', c: m.c, s: now });
    if (m.t === 'hello') {
      const r = Room.join(this.room, { id: m.id, name: m.name, build: m.build }, now);
      if (!r.ok) { this.send(conn, { t: 'error', error: r.error }); return conn.close(4000 + (r.error === 'room-full' ? 1 : 2), r.error); }
      c.id = m.id; this.send(conn, { t: 'welcome', id: m.id, protocol: PROTOCOL, notice: this.notice });
      if (this.sim) this.sendRaceStart(conn, c.id);
      this.broadcastLobby(); this.save(); return;
    }
    if (!c.id) return this.reject(conn, 'no-hello');
    let r = { ok: true };
    switch (m.t) {
      case 'input': {
        if (m.seq <= c.lastSeq) return;   // out of order / duplicate
        c.lastSeq = m.seq; const seat = this.room.seats.find(s => s.id === c.id); if (seat) seat.lastInputAt = now;
        this.inputs.set(c.id, { k: m.k, seq: m.seq, at: now }); return;
      }
      case 'addBot': r = Room.addBot(this.room, c.id); break;
      case 'removeBot': r = Room.removeBot(this.room, c.id, m.bot); break;
      case 'config': r = Room.configure(this.room, c.id, m); break;
      case 'car': r = Room.setCar(this.room, c.id, m.car); break;
      case 'ready': r = Room.setReady(this.room, c.id, m.ready); break;
      case 'start': r = Room.start(this.room, c.id, now, this.seedFn()); if (r.ok) this.beginCountdown(); break;
      case 'leave': conn.close(1000, 'leave'); return;
    }
    if (!r.ok) return this.send(conn, { t: 'error', error: r.error });
    this.broadcastLobby(); this.save();
  }
  // ---- race lifecycle ----
  beginCountdown() {
    const R = this.room, sim = this.sim = createSim({ seed: R.seed });
    sim.setMode(R.mode); sim.setTrack(R.map);
    sim.addSeats(R.seats.map(s => ({ id: s.id, kind: s.kind, name: s.name, carMods: CARS[s.car] ? CARS[s.car].mods : null })), null);
    for (const r of sim.racers) if (!r.isAI) r.wallLim = 1.2;
    this.inputs.clear(); this.step = 0; this.clock = createClock(); this.lastTick = this.t.now(); this.firstFinishAt = 0;
    for (const [conn, c] of this.conns) if (c.id) this.sendRaceStart(conn, c.id);
    this.loop = this.t.setInterval(() => this.tick(), 1000 / NET_HZ);
  }
  sendRaceStart(conn, id) { const R = this.room; this.send(conn, { t: 'race', map: R.map, mode: R.mode, seed: R.seed, countdownAt: R.countdownAt, serverNow: this.t.now(), seats: R.seats.map(s => ({ id: s.id, kind: s.kind, name: s.name, car: s.car })), you: id, snap: this.sim.snapshot() }); }
  tick() {
    const t0 = performance.now(), now = this.t.now(), R = this.room, sim = this.sim;
    const wall = Math.max(0, (now - this.lastTick) / 1000); this.lastTick = now;
    const hk = Room.tick(R, now);
    if (hk.changes.length) this.broadcastLobby();
    if (R.phase === 'countdown' && now >= R.countdownAt) { R.phase = 'race'; for (const r of sim.racers) if (!r.isAI) Object.assign(r.input, (this.inputs.get(r.id) || {}).k || ZERO); sim.startRace(); this.save(); }
    if (R.phase === 'race') {
      for (const r of sim.racers) {
        if (r.isAI) continue;
        const inp = this.inputs.get(r.id), seat = R.seats.find(s => s.id === r.id);
        const stale = !inp || hk.stale.includes(r.id) || (seat && seat.left);
        Object.assign(r.input, stale ? ZERO : inp.k);   // stale input released (~250 ms)
      }
      const adv = this.clock.advance(wall);
      for (let i = 0; i < adv.steps; i++) { sim.step(SIM_DT); this.step++; }
      const humans = sim.racers.filter(r => !r.isAI && !R.seats.find(s => s.id === r.id).left);
      if (!this.firstFinishAt && humans.some(r => r.finished)) this.firstFinishAt = now;
      if (humans.every(r => r.finished) || (this.firstFinishAt && now - this.firstFinishAt > this.finishGraceMs) || hk.empty) this.finish();
    }
    if (this.sim && (R.phase === 'race' || R.phase === 'countdown')) this.broadcastSnap(now);
    this.stats.ticks++; this.stats.tickMs.push(performance.now() - t0);
  }
  finish() {
    const R = this.room, sim = this.sim;
    const order = sim.ranks().map((r, k) => ({ pos: k + 1, id: r.id, name: r.name, kind: r.isAI ? 'bot' : 'human', finished: r.finished, time: r.finished ? r.finishTime : null, laps: r.lapTimes.slice(), dnf: !r.finished }));
    R.phase = 'results'; this.t.clearInterval(this.loop); this.loop = null;
    this.broadcast({ t: 'results', order, map: R.map, mode: R.mode });
    this.results = order; this.save();
    this.t.setTimeout(() => { R.phase = 'lobby'; for (const s of R.seats) s.ready = s.kind === 'bot'; this.sim = null; this.broadcastLobby(); this.save(); }, this.resultsHoldMs);
  }
  broadcastSnap(now) {
    const sim = this.sim, others = sim.racers.map(compactRacer);
    for (const [conn, c] of this.conns) {
      if (!c.id) continue;
      if (conn.bufferedAmount && conn.bufferedAmount() > BACKPRESSURE_BYTES) { this.stats.skippedBackpressure++; continue; }   // drop stale snapshots, never queue
      const inp = this.inputs.get(c.id);
      this.send(conn, { t: 'snap', step: this.step, phase: this.room.phase, rt: +sim.raceTime().toFixed(4), sn: now, ack: inp ? inp.seq : -1, me: sim.racerState(c.id), all: others });
    }
  }
  // ---- helpers ----
  scheduleExpiry() { this.t.setTimeout(() => { const hk = Room.tick(this.room, this.t.now()); if (hk.changes.length) { this.broadcastLobby(); this.save(); } }, Room.RECONNECT_MS + 50); }
  broadcastLobby() { this.broadcast({ t: 'lobby', room: Room.publicState(this.room), notice: this.notice }); }
  broadcast(m) { for (const conn of this.conns.keys()) if (this.conns.get(conn).id) this.send(conn, m); }
  send(conn, m) { const txt = JSON.stringify(m); this.stats.sentBytes += txt.length; this.stats.sentMsgs++; try { conn.send(txt); } catch (e) { } }
  reject(conn, why) { this.stats.rejected[why] = (this.stats.rejected[why] || 0) + 1; this.send(conn, { t: 'error', error: why }); }
  save() { if (!this.persist) return; this.stats.persists++; const R = this.room; this.persist({ code: R.code, build: R.build, phase: R.phase, hostId: R.hostId, map: R.map, mode: R.mode, seed: R.seed, nextBot: R.nextBot, seats: R.seats.map(s => ({ ...s })) }); }
  get ticking() { return !!this.loop; }
}
