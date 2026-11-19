import {encodeWeaponEntities,encodeWeaponEvents} from '../src/core/weapons.js';
// Authoritative NIGHTGRID room (transport-agnostic). One instance per private room: one Durable Object
// in production (server/worker.js), one object in the local Node runtime (server/local.mjs).
//
// Authority: the server owns the clock, grid, physics, collisions, checkpoints/laps, boost, respawns,
// AI and results. Clients only send per-step input frames (protocol v2); there is no message type that
// can set a position, speed, lap or result. Shared pure core (same sim as the browser).
//
// Timing: fixed 120 Hz simulation advanced by a 20 Hz network tick (setInterval), bounded catch-up via
// core/clock.js (<= 250 ms simulated per tick; >= 1 s gaps are not simulated). Idle lobby: no interval;
// housekeeping is requested through timers.wake(ms) (Node: setTimeout, Durable Object: storage alarm),
// so an idle lobby can hibernate. A countdown/race keeps the interval running (cannot hibernate).
//
// Restart policy: race state is in memory only. If the room object restarts mid-race, the race is
// ABORTED and everyone returns to the lobby with a notice (no silent resume).
import * as Room from '../src/core/room.js';
import { createSim } from '../src/core/sim.js';
import { createClock, SIM_DT } from '../src/core/clock.js';
import { CARS } from '../src/core/roster.js';
import { encodePads } from '../src/core/hazards.js';
import { parseClient, rateLimiter, compactRacer, decodeFrame, makeToken, NET_HZ, FRAME_RATE_MAX, FRAME_BURST, MSG_RATE_MAX, MSG_BURST,
  MAX_AHEAD_FRAMES, QUEUE_DROP_FRAMES, MAX_LEAD_FRAMES, BACKPRESSURE_BYTES, PROTOCOL, ZERO_FRAME } from '../src/net/protocol.js';

export const ROOM_DEFAULTS = {
  weaponsAllowed: false, weaponSlice: 2,
  countdownMs: 4500,          // lobby Start -> lights out (includes track/car preload on clients)
  resultsHoldMs: 20000,       // results shown, then the room returns to the lobby (host can return earlier)
  finishGraceMs: 30000,       // after the first human finishes, others get 30 s
  maxRaceMs: 8 * 60e3,        // hard cap on one race
  emptyCloseMs: 60e3,         // no connected human for 60 s -> room closes
  lobbyIdleMs: 15 * 60e3,     // no lobby activity for 15 min -> room closes
  beatMs: 60e3,               // budget heartbeat
  housekeepMs: 1000
};
const DNF_PERS = { vmax: 45, lat: 40, acc: 14, brake: 40, off: 0, short: 0, aggr: 0, block: 0, boostUse: 0, margin: 5 };
const _k = {};

export class RoomServer {
  // timers: { now(), setInterval, clearInterval, setTimeout, clearTimeout, wake?(ms) }
  // random: crypto.getRandomValues-compatible. budget: { beat(code), canRace(code), release(code) } (sync or async)
  constructor({ code, build, timers, random, budget = null, persist = null, onClose = null, restored = null, cfg = {} }) {
    this.code = code; this.t = timers; this.random = random; this.budget = budget; this.persist = persist; this.onClose = onClose;
    this.cfg = { ...ROOM_DEFAULTS, ...cfg };
    this.room = Room.createRoom({ code, build, now: this.t.now() });
    this.room.weaponsAllowed = !!this.cfg.weaponsAllowed;
    this.conns = new Map();   // conn -> { id, frames(now,n), msgs(now) }
    this.tokens = new Map();  // session token -> seat id (server memory/storage only; never sent to other clients, never logged)
    this.inputs = new Map();  // seat id -> input queue state
    this.sim = null; this.loop = null; this.notice = null; this.closed = false; this.results = null; this.beatFails = 0;
    this.lastActivity = this.t.now(); this.lastBeat = this.t.now(); this.emptySince = this.t.now(); this.resultsTimer = null;
    this.stats = { ticks: 0, steps: 0, tickMs: [], overruns: 0, lateTicks: 0, droppedMs: 0, sentBytes: 0, sentMsgs: 0, recvMsgs: 0, recvBytes: 0, skippedBackpressure: 0, rejected: {}, persists: 0, starved: 0, skippedFrames: 0 };
    if (restored) this.restore(restored);
    this.wakeLater();
  }
  restore(meta) {
    const wasRacing = meta.phase && meta.phase !== 'lobby';
    Object.assign(this.room, { hostId: meta.hostId, map: meta.map, mode: meta.mode, weapons: !!meta.weapons, vr: meta.vr || 0, nextBot: meta.nextBot, nextHuman: meta.nextHuman, seats: meta.seats.map(s => ({ ...s })), phase: 'lobby', version: (meta.version || 0) + 1 });
    // hibernation wake in the lobby keeps ready flags; a restart that killed a race re-asks everyone
    for (const s of this.room.seats) { if (wasRacing) s.ready = s.kind === 'bot'; if (s.kind === 'human') { s.dcAt = s.connected ? this.t.now() : (s.dcAt || this.t.now()); s.connected = false; } }
    this.room.seats = this.room.seats.filter(s => !s.left);
    for (const [tok, id] of meta.tokens || []) this.tokens.set(tok, id);
    // timer baselines survive eviction, so an idle/empty room still closes on time after a wake
    for (const k of ['createdAt']) if (meta[k]) this.room[k] = meta[k];
    if (meta.lastActivity) this.lastActivity = meta.lastActivity; if (meta.lastBeat) this.lastBeat = meta.lastBeat;
    if (meta.emptySince !== undefined) this.emptySince = meta.emptySince;
    if (wasRacing) this.notice = 'room-restarted-race-aborted';
  }
  // ---------------- transport hooks ----------------
  connect(conn) { this.conns.set(conn, { id: null, weaponCursor: 0, frames: rateLimiter(FRAME_RATE_MAX, FRAME_BURST), msgs: rateLimiter(MSG_RATE_MAX, MSG_BURST) }); }
  // Durable Object hibernation: a socket that survived eviction is re-attached to its seat.
  adopt(conn, id) { this.connect(conn); const c = this.conns.get(conn); if (id && this.room.seats.some(s => s.id === id && s.kind === 'human' && !s.left)) { c.id = id; Room.reconnect(this.room, id, this.t.now()); } }
  close(conn) {
    const c = this.conns.get(conn); this.conns.delete(conn); if (!c || !c.id) return;
    if (![...this.conns.values()].some(x => x.id === c.id)) { Room.disconnect(this.room, c.id, this.t.now()); this.broadcastLobby(); this.save(); this.wakeLater(); }
  }
  message(conn, text) {
    const c = this.conns.get(conn); if (!c || this.closed) return;
    const now = this.t.now(); this.stats.recvMsgs++; this.stats.recvBytes += typeof text === 'string' ? text.length : 0;
    if (!c.msgs(now)) return this.reject(conn, 'rate');
    const p = parseClient(text); if (!p.ok) return this.reject(conn, p.error, p.error === 'protocol-mismatch');
    const m = p.msg;
    if (m.t === 'ping') return this.send(conn, { t: 'pong', c: m.c, s: now });
    if (m.t === 'hello') return this.hello(conn, c, m, now);
    if (!c.id) return this.reject(conn, 'no-hello');
    if (m.t === 'in') return this.input(conn, c, m, now);
    this.lastActivity = now;
    let r = { ok: true };
    switch (m.t) {
      case 'addBot': r = Room.addBot(this.room, c.id); break;
      case 'removeBot': r = Room.removeBot(this.room, c.id, m.bot); break;
      case 'config': if (m.weapons && !this.cfg.weaponsAllowed) { r = {ok:false,error:'weapons-disabled'}; break; } r = Room.configure(this.room, c.id, m); break;
      case 'car': r = Room.setCar(this.room, c.id, m.car, m.paint); break;
      case 'name': r = Room.setName(this.room, c.id, m.name); break;
      case 'ready': r = Room.setReady(this.room, c.id, m.ready); break;
      case 'start': return this.requestStart(conn, c);
      case 'lobby': if (this.room.phase !== 'results') r = { ok: false, error: 'not-in-results' }; else if (c.id !== this.room.hostId) r = { ok: false, error: 'not-host' }; else { this.backToLobby(); return; } break;
      case 'leave': this.leaveSeat(c.id); try { conn.close(1000, 'leave'); } catch (e) { } this.conns.delete(conn); return;
    }
    if (!r.ok) return this.send(conn, { t: 'error', error: r.error });
    this.broadcastLobby(); this.save();
  }
  hello(conn, c, m, now) {
    if (c.id) return this.reject(conn, 'dup-hello');
    if (m.build !== this.room.build) return this.reject(conn, 'build-mismatch', true);
    let id = m.token ? this.tokens.get(m.token) : null, token = m.token;
    if (id) { const r = Room.reconnect(this.room, id, now); if (!r.ok) { this.tokens.delete(m.token); id = null; if (this.room.phase !== 'lobby') return this.reject(conn, r.error, true); } }
    if (!id) {
      const r = Room.join(this.room, { name: m.name, build: m.build }, now);
      if (!r.ok) return this.reject(conn, r.error, true);
      id = r.id; token = makeToken(this.random); this.tokens.set(token, id);
    }
    // one live socket per seat: an older socket for the same seat is replaced
    for (const [k, o] of this.conns) if (k !== conn && o.id === id) { o.id = null; try { k.close(4009, 'replaced'); } catch (e) { } this.conns.delete(k); }
    c.id = id; this.lastActivity = now;
    this.send(conn, { t: 'welcome', p: PROTOCOL, id, token, code: this.code, notice: this.notice, serverNow: now });
    if (this.sim) this.sendRace(conn, id);
    if (this.room.phase === 'results' && this.results) this.send(conn, { t: 'results', ...this.results });
    this.broadcastLobby(); this.save(); this.wakeLater();
  }
  input(conn, c, m, now) {
    if (!c.frames(now, m.f.length)) return this.reject(conn, 'input-rate');
    const q = this.inputs.get(c.id); if (!q || !this.sim || (this.room.phase !== 'race' && this.room.phase !== 'countdown')) return;   // no race running (e.g. results): ignored
    const seat = this.room.seats.find(s => s.id === c.id); if (!seat || seat.left) return;
    // frames > 3 s ahead of the server's step cannot be legitimate lead: the excess is dropped and counted
    // (a batch straddling the bound keeps its valid part); a batch entirely beyond it is rejected
    if (m.q > q.next + MAX_AHEAD_FRAMES) { this.stats.aheadLog = (this.stats.aheadLog || []).concat([[c.id, m.q - q.next, this.room.phase]]).slice(-20); return this.send(conn, { t: 'error', error: 'time-ahead', ahead: m.q - q.next, phase: this.room.phase, rejected: (this.stats.rejected['time-ahead'] = (this.stats.rejected['time-ahead'] || 0) + 1) }); }
    const lim = q.next + MAX_AHEAD_FRAMES; if (m.q + m.f.length - 1 > lim) { this.stats.aheadDropped = (this.stats.aheadDropped || 0) + (m.q + m.f.length - 1 - lim); m.f = m.f.slice(0, lim - m.q + 1); }
    // arrival margin of this batch's oldest frame (steps before it is needed; negative = late). The
    // lowest recent margin is reported back so the client can set its lead from what actually arrived.
    q.early.push(m.q - q.next); if (q.early.length > 8) q.early.shift();
    for (let i = 0; i < m.f.length; i++) { const seq = m.q + i; if (seq >= q.next && !q.buf.has(seq)) q.buf.set(seq, m.f[i]); }
    if (q.buf.size > q.maxQ) q.maxQ = q.buf.size;
    if (m.a?.length) { const r=this.sim.racers.find(r=>r.id===c.id); if(r&&!r.dnf)this.sim.queueWeaponActions(r,m.a); }
    seat.lastInputAt = now; q.lastAt = now;
  }
  leaveSeat(id) {
    Room.leave(this.room, id); const r = this.sim && this.sim.racers.find(x => x.id === id); if (r && !r.finished) this.retire(r);
    for (const [tok, sid] of this.tokens) if (sid === id) this.tokens.delete(tok);
    this.broadcastLobby(); this.save(); this.wakeLater();
  }
  // a human who left / expired mid-race: car keeps racing slowly under server AI (no stuck throttle, not a
  // ghost: it still collides), and is marked DNF in the results.
  retire(r) { r.autopilot = true; r.pers = { ...DNF_PERS }; r.dnf = true; r.boost = false; Object.assign(r.input, { up: 0, down: 0, left: 0, right: 0, boost: 0, drift: 0 }); }
  async requestStart(conn, c) {
    if (c.id !== this.room.hostId) return this.send(conn, { t: 'error', error: 'not-host' });
    const b = Room.startBlocker(this.room); if (b) return this.send(conn, { t: 'error', error: b });
    if (this.budget) {   // fail CLOSED: if the shared budget cannot be asked, no race starts
      let ok = null; try { ok = await this.budget.canRace(this.code); } catch (e) { ok = { ok: false, error: 'capacity' }; this.stats.budgetErrors = (this.stats.budgetErrors || 0) + 1; }
      if (!ok || !ok.ok) return this.send(conn, { t: 'error', error: (ok && ok.error) || 'capacity' });
    }
    const seed = new Uint32Array(1); this.random(seed);
    const r = Room.start(this.room, c.id, this.t.now(), seed[0] || 1, this.cfg.countdownMs);
    if (!r.ok) return this.send(conn, { t: 'error', error: r.error });
    this.beginCountdown(); this.broadcastLobby(); this.save();
  }
  // ---------------- race lifecycle ----------------
  beginCountdown() {
    const R = this.room, sim = this.sim = createSim({ seed: R.seed });
    sim.setMode(R.mode); sim.setTrack(R.map,R.vr||0); sim.diff = 'normal'; sim.ghost = true;   // multiplayer: no car-to-car contact (sim.js collideRacers)
    sim.weapons = !!R.weapons && !!this.cfg.weaponsAllowed; sim.weaponSlice = this.cfg.weaponSlice;
    sim.hazards = true;   // M8: obstacles + server-owned shield/self-boost pads (src/core/hazards.js)
    sim.addSeats(R.seats.map(s => ({ id: s.id, kind: s.kind, name: s.name, pers: s.pers, carMods: CARS[s.car] ? CARS[s.car].mods : null })), null);
    for (const r of sim.racers) if (!r.isAI) r.wallLim = 1.2;
    this.inputs.clear(); for(const c of this.conns.values())c.weaponCursor=0;
    for (const s of R.seats) if (s.kind === 'human') this.inputs.set(s.id, { buf: new Map(), next: 0, last: ZERO_FRAME, lastAt: 0, starve: 0, skipped: 0, maxQ: 0, early: [] });
    this.step = 0; this.clock = createClock(); this.lastTick = R.countdownAt; this.firstFinishAt = 0; this.results = null;
    for (const [conn, c] of this.conns) if (c.id) this.sendRace(conn, c.id);
    if (this.loop) this.t.clearInterval(this.loop);
    this.loop = this.t.setInterval(() => this.tick(), 1000 / NET_HZ);
  }
  sendRace(conn, id) {
    const R = this.room;
    this.send(conn, { t: 'race', p: PROTOCOL, build: R.build, map: R.map, mode: R.mode, seed: R.seed, countdownAt: R.countdownAt, serverNow: this.t.now(), step: this.step,
      seats: R.seats.map(s => ({ id: s.id, kind: s.kind, name: s.name, car: s.car, paint: s.paint || 0, pers: s.pers || null })), you: id, rules: {weapons: this.sim.weapons, vr: R.vr || 0}, snap: this.sim.snapshot() });
  }
  // Exactly one frame per racer per step. A frame that has not arrived when its step runs is MISSED:
  // the server holds the last input (or releases everything once input is stale) and moves on; the
  // frame is discarded if it arrives later. So input latency is bounded and never drifts, and a client
  // that stalled cannot bank time. Snapshots report missed frames so the client raises its lead.
  consume(id, now) {
    const q = this.inputs.get(id); if (!q) return ZERO_FRAME;
    if (q.buf.size > QUEUE_DROP_FRAMES) {   // client far ahead (burst after a stall): keep latency bounded
      const keep = [...q.buf.keys()].sort((a, b) => a - b).slice(-MAX_LEAD_FRAMES)[0];
      for (const k of [...q.buf.keys()]) if (k < keep) { q.buf.delete(k); q.skipped++; this.stats.skippedFrames++; }
    }
    const seq = q.next++;
    if (q.buf.has(seq)) { q.last = q.buf.get(seq); q.buf.delete(seq); return q.last; }
    q.starve++; this.stats.starved++;
    return now - q.lastAt > Room.STALE_INPUT_MS ? ZERO_FRAME : q.last;   // brief gap: hold last input; stale: release everything
  }
  tick() {
    if (this.closed) return;
    const t0 = perfNow(), now = this.t.now(), R = this.room, sim = this.sim;
    const hk = Room.tick(R, now);
    for (const [kind, id] of hk.changes) if (kind === 'expired') { const r = sim && sim.racers.find(x => x.id === id); if (r && !r.finished) this.retire(r); }
    if (hk.changes.length) this.broadcastLobby();
    if (R.phase === 'countdown' && now >= R.countdownAt) {
      Room.toRace(R); this.lastTick = R.countdownAt;
      for (const r of sim.racers) if (!r.isAI) { const q = this.inputs.get(r.id); decodeFrame(q && q.buf.has(0) ? q.buf.get(0) : ZERO_FRAME, r.input); }
      sim.startRace(); this.save();
    }
    if (R.phase === 'race') {
      const wall = Math.max(0, (now - this.lastTick) / 1000); this.lastTick = now;
      if (wall > 1.5 / NET_HZ) this.stats.lateTicks++;
      const adv = this.clock.advance(wall); this.stats.droppedMs = this.clock.droppedMs;
      for (let i = 0; i < adv.steps; i++) {
        for (const r of sim.racers) { if (r.isAI || r.dnf) continue; decodeFrame(this.consume(r.id, now), r.input); r.wNetLead = Math.min(1.5,(this.inputs.get(r.id)?.buf.size||0)/120); }
        sim.step(SIM_DT); this.step++;
      }
      this.stats.steps += adv.steps;
      const live = sim.racers.filter(r => !r.isAI && !r.dnf);
      if (!this.firstFinishAt && live.some(r => r.finished)) this.firstFinishAt = now;
      const raceMs = (now - R.countdownAt);
      if (live.every(r => r.finished) || (this.firstFinishAt && now - this.firstFinishAt > this.cfg.finishGraceMs) || hk.empty || raceMs > this.cfg.maxRaceMs) this.finish(now);
    }
    if (this.sim && (R.phase === 'race' || R.phase === 'countdown')) this.broadcastSnap(now);
    this.housekeep(now);
    const ms = perfNow() - t0; this.stats.ticks++; if (this.stats.tickMs.length < 20000) this.stats.tickMs.push(ms); if (ms > 1000 / NET_HZ) this.stats.overruns++;
  }
  finish(now) {
    const R = this.room, sim = this.sim;
    const order = sim.ranks().map((r, k) => {
      const seat = R.seats.find(s => s.id === r.id) || {};
      const dnf = !!r.dnf || !r.finished;
      return { pos: k + 1, id: r.id, name: r.name, kind: r.isAI ? 'bot' : 'human', car: seat.car, paint: seat.paint || 0, finished: !dnf, time: dnf ? null : +r.finishTime.toFixed(3), best: r.lapTimes.length ? +Math.min(...r.lapTimes).toFixed(3) : null, laps: r.lapTimes.map(x => +x.toFixed(3)), dnf };
    });
    this.results = { order, map: R.map, mode: R.mode, seed: R.seed, steps: this.step };
    Room.toResults(R, null);
    this.t.clearInterval(this.loop); this.loop = null;
    this.broadcastSnap(now); this.broadcast({ t: 'results', ...this.results }); this.broadcastLobby(); this.save();
    this.resultsTimer = this.t.setTimeout(() => this.backToLobby(), this.cfg.resultsHoldMs);
  }
  backToLobby() {
    if (this.resultsTimer) { this.t.clearTimeout(this.resultsTimer); this.resultsTimer = null; }
    if (this.room.phase !== 'results') return;
    Room.toLobby(this.room); this.sim = null; this.inputs.clear(); this.lastActivity = this.t.now();
    this.broadcastLobby(); this.save(); this.wakeLater();
  }
  broadcastSnap(now) {
    const sim = this.sim, br = sim.track.BR, all = sim.racers.map(r => compactRacer(r, br));
    const dr = sim.drones.map(d => [+d.s.toFixed(3), +d.h.toFixed(4), +d.vh.toFixed(4)]);
    const fo = sim.finishOrder.map(r => r.id), rt = +sim.raceTime().toFixed(4), pk = encodePads(sim.pads, sim.time);
    const weaponCache=new Map();
    if(sim.weapons)for(const p of sim.weaponState.shots.concat(sim.weaponState.mines,sim.weaponState.pulses||[]))weaponCache.set(p.id,[p.id,p.kind,sim.racers.findIndex(r=>r.id===p.owner),p.path,+p.s.toFixed(2),+p.d.toFixed(2),+p.h.toFixed(2),p.target?sim.racers.findIndex(r=>r.id===p.target):-1,+p.age.toFixed(2),+(p.speed||0).toFixed(1),p.aid||0]);
    for (const [conn, c] of this.conns) {
      if (!c.id) continue;
      if (conn.bufferedAmount && conn.bufferedAmount() > BACKPRESSURE_BYTES) { this.stats.skippedBackpressure++; continue; }   // drop stale snapshots, never queue
      const q = this.inputs.get(c.id);
      const ws=sim.weapons ? {wx: encodeWeaponEntities(sim,c.id,weaponCache), wv: encodeWeaponEvents(sim,c.id,c.weaponCursor)} : {};
      const sent=this.send(conn, { t: 's', ...ws, k: this.step, sn: now, ph: this.room.phase, rt, tm: sim.time, ack: q ? q.next - 1 : -1, q: q ? q.buf.size : 0, ms: q ? q.starve : 0, el: q && q.early.length ? Math.min(...q.early) : null, me: q ? sim.racerState(c.id) : null, a: all, dr, fo, pk });
      if(sent&&sim.weapons)c.weaponCursor=sim.weaponState.nextEvent-1;
    }
  }
  // ---------------- housekeeping / lifetime ----------------
  housekeep(now = this.t.now()) {
    if (this.closed) return;
    const R = this.room;
    if (!this.loop) { const hk = Room.tick(R, now); if (hk.changes.length) { this.broadcastLobby(); this.save(); } }
    const anyConnected = R.seats.some(s => s.kind === 'human' && s.connected && !s.left);
    const e0 = this.emptySince; if (anyConnected) this.emptySince = 0; else if (!this.emptySince) this.emptySince = now; if (e0 !== this.emptySince) this.save();
    if (this.emptySince && now - this.emptySince >= this.cfg.emptyCloseMs) return this.closeRoom('empty');
    if (R.phase === 'lobby' && now - this.lastActivity >= this.cfg.lobbyIdleMs) return this.closeRoom('idle');
    if (this.budget && now - this.lastBeat >= this.cfg.beatMs) {
      this.lastBeat = now; this.save();
      Promise.resolve().then(() => this.budget.beat(this.code)).then(b => { this.beatFails = 0; if (b && b.close) this.closeRoom(b.close); })
        .catch(() => { this.stats.budgetErrors = (this.stats.budgetErrors || 0) + 1; if (++this.beatFails >= 3) this.closeRoom('budget-unavailable'); });   // fail closed after 3 missed heartbeats
    }
    this.wakeLater();
  }
  // ask the runtime to call housekeep() again (only when no race interval is running)
  wakeLater() {
    if (this.closed || this.loop || !this.t.wake) return;
    const R = this.room, now = this.t.now();
    let ms = this.cfg.beatMs;
    for (const s of R.seats) if (s.kind === 'human' && !s.connected && !s.left) ms = Math.min(ms, Math.max(50, Room.RECONNECT_MS - (now - s.dcAt) + 50));
    if (this.emptySince) ms = Math.min(ms, Math.max(50, this.cfg.emptyCloseMs - (now - this.emptySince) + 50));
    ms = Math.min(ms, Math.max(50, this.cfg.lobbyIdleMs - (now - this.lastActivity) + 50));
    this.t.wake(ms);
  }
  closeRoom(reason) {
    if (this.closed) return;
    if (this.sim && this.room.phase === 'race') this.finish(this.t.now());   // a forced stop still publishes the current order (unfinished = DNF)
    this.closed = true;
    if (this.loop) this.t.clearInterval(this.loop); this.loop = null; if (this.resultsTimer) this.t.clearTimeout(this.resultsTimer);
    this.broadcast({ t: 'closed', reason });
    for (const conn of this.conns.keys()) { try { conn.close(4100, 'room-closed'); } catch (e) { } }
    this.conns.clear(); this.sim = null; if (this.t.wake) this.t.wake = null;
    if (this.budget) Promise.resolve(this.budget.release(this.code)).catch(() => { });
    if (this.onClose) this.onClose(reason);
  }
  // ---------------- helpers ----------------
  broadcastLobby() { this.broadcast({ t: 'lobby', room: Room.publicState(this.room), notice: this.notice }); }
  broadcast(m) { const txt = JSON.stringify(m); for (const [conn, c] of this.conns) if (c.id) this.sendText(conn, txt); }
  send(conn, m) { return this.sendText(conn, JSON.stringify(m)); }
  sendText(conn, txt) { this.stats.sentBytes += txt.length; this.stats.sentMsgs++; try { conn.send(txt); return true; } catch (e) { return false; } }
  reject(conn, why, fatal = false) {
    this.stats.rejected[why] = (this.stats.rejected[why] || 0) + 1; this.send(conn, { t: 'error', error: why, fatal });
    if (fatal) { try { conn.close(4000, why); } catch (e) { } this.conns.delete(conn); }
  }
  meta() { const R = this.room; return { code: R.code, build: R.build, phase: R.phase, hostId: R.hostId, map: R.map, mode: R.mode, weapons: !!R.weapons, vr: R.vr || 0, nextBot: R.nextBot, nextHuman: R.nextHuman, version: R.version, seats: R.seats.map(s => ({ ...s })), tokens: [...this.tokens], createdAt: R.createdAt, lastActivity: this.lastActivity, lastBeat: this.lastBeat, emptySince: this.emptySince }; }
  save() { if (!this.persist || this.closed) return; this.stats.persists++; try { const p = this.persist(this.meta()); if (p && p.catch) p.catch(() => { }); } catch (e) { } }
  get ticking() { return !!this.loop; }
}
const perfNow = () => (globalThis.performance ? performance.now() : Date.now());
