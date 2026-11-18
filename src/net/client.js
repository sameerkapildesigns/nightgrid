// Multiplayer connection + race timeline (no DOM, no Three.js). Runs in the browser (src/client/mp.js)
// and in Node for the headless network tests, with an injected WebSocket implementation and clock.
//
// Timeline: the server simulates step k of the race at countdownAt + k * SIM_DT (server clock). The
// client estimates server time (ClockSync) and runs its own prediction AHEAD of the server by `lead`
// steps, so that frame k reaches the server just before the server needs it. The server reports how
// many of our frames are queued (q); lead adapts to keep a small queue (jitter buffer). Local input is
// therefore applied to the local car immediately, never delayed by the round trip.
import { Predictor, Interpolator, ClockSync, MAX_CATCHUP, VIEW_FIELDS } from './netcode.js';
import { SIM_DT } from '../core/clock.js';
import { PROTOCOL, NET_HZ, encodeFrame, MAX_FRAMES_PER_MSG, MAX_LEAD_FRAMES, normalizeCode, validCode } from './protocol.js';

const RECONNECT_DELAYS = [500, 1000, 2000, 3000, 4000, 4000];
export class NetClient {
  constructor({ wsUrl, WebSocketImpl, now, build, name = 'Player', events = null, onEvent = () => { } }) {
    this.wsUrl = wsUrl; this.WS = WebSocketImpl; this.now = now; this.build = build; this.name = name;
    this.simEvents = events; this.onEvent = onEvent;
    this.ws = null; this.code = null; this.token = null; this.you = null; this.room = null; this.results = null;
    this.race = null; this.clock = new ClockSync(); this.lead = 8; this.qe = 4; this.snapN = 0; this.frameMs = 16; this.lastFrameAt = 0;
    this.outbox = []; this.outSeq = 0; this.lastSend = 0; this.lastPing = -1e9; this.pingN = 0;
    this.closedByUser = false; this.retry = 0; this.status = 'idle'; this.useEventTime = typeof window !== 'undefined';
    this.stats = { sentMsgs: 0, sentBytes: 0, recvMsgs: 0, recvBytes: 0, snapAges: [], recvDelay: [], frameGaps: [], t0: now(), snaps: 0, behindMax: 0, resyncSteps: 0 };
  }
  connect(code, token = null) {
    code = normalizeCode(code); if (!validCode(code)) { this.onEvent('error', { error: 'bad-code', fatal: true }); return false; }
    // a new connect() replaces any socket still connecting/open (double Create/Join, room change): the old
    // one is detached first so its late messages/close cannot touch this session, and its seat is released
    const old = this.ws; if (old) { this.ws = null; old.onopen = old.onmessage = old.onclose = null; try { if (old.readyState === 1) old.send(JSON.stringify({ t: 'leave' })); old.close(1000, 'switch'); } catch (e) { } }
    if (code !== this.code) { this.room = null; this.you = null; this.token = null; this.race = null; this.results = null; }
    this.code = code; if (token) this.token = token; this.closedByUser = false; this.fatal = false; this.fatalReason = null; this.retry = 0; this.open(); return true;
  }
  open() {
    this.status = this.retry ? 'reconnecting' : 'connecting';
    const ws = this.ws = new this.WS(`${this.wsUrl}/api/rooms/${this.code}/ws`);
    ws.onopen = () => { this.status = 'open'; this.sendRaw({ t: 'hello', p: PROTOCOL, build: this.build, name: this.name, token: this.token || undefined }); this.ping(true); };
    // e.timeStamp = when the browser received the message (same clock as performance.now()), so a slow
    // render frame that delays this handler does not inflate the measured round trip
    ws.onmessage = e => this.recv(typeof e.data === 'string' ? e.data : String(e.data), e.timeStamp > 0 && this.useEventTime ? e.timeStamp : this.now());
    ws.onclose = e => {
      if (this.ws !== ws) return; this.ws = null;
      const fatal = this.closedByUser || this.fatal || (e && (e.code === 4100 || e.code === 4004 || e.code === 4009));
      if (fatal) { this.status = 'closed'; this.onEvent('closed', { code: e && e.code, reason: this.fatalReason || (e && e.reason) }); return; }
      if (this.retry < RECONNECT_DELAYS.length && this.token) { const d = RECONNECT_DELAYS[this.retry++]; this.status = 'reconnecting'; this.onEvent('reconnecting', { inMs: d }); setTimeout(() => { if (!this.closedByUser && !this.ws) this.open(); }, d); }
      else { this.status = 'closed'; this.onEvent('closed', { code: e && e.code, reason: 'connection-lost' }); }
    };
    ws.onerror = () => { };
  }
  leave() { this.closedByUser = true; this.sendRaw({ t: 'leave' }); try { this.ws && this.ws.close(1000, 'leave'); } catch (e) { } this.race = null; this.status = 'closed'; }
  // ---- lobby actions (the server validates every one; host-only ones are refused for non-hosts) ----
  addBot() { this.sendRaw({ t: 'addBot' }); } removeBot(bot) { this.sendRaw({ t: 'removeBot', bot }); }
  config(o) { this.sendRaw({ t: 'config', ...o }); } car(car, paint) { this.sendRaw({ t: 'car', car, paint }); }
  setName(name) { this.name = name; this.sendRaw({ t: 'name', name }); } ready(r) { this.sendRaw({ t: 'ready', ready: !!r }); }
  start() { this.sendRaw({ t: 'start' }); } toLobby() { this.sendRaw({ t: 'lobby' }); }
  get isHost() { return !!(this.room && this.you && this.room.hostId === this.you); }
  get me() { return this.room && this.room.seats.find(s => s.id === this.you); }

  sendRaw(m) { if (!this.ws || this.ws.readyState !== 1) return false; const t = JSON.stringify(m); this.stats.sentMsgs++; this.stats.sentBytes += t.length; try { this.ws.send(t); } catch (e) { return false; } return true; }
  ping(force) { const n = this.now(); const iv = this.pingN < 8 ? 250 : 1000; if (!force && n - this.lastPing < iv) return; this.lastPing = n; this.pingN++; this.sendRaw({ t: 'ping', c: n }); }
  serverNow() { return this.clock.serverNow(this.now()); }

  recv(text, at = this.now()) {
    const lag = this.now() - at; if (this.stats.recvDelay.length < 50000) this.stats.recvDelay.push(lag);   // main-thread delay between socket receipt and our handler
    this.stats.recvMsgs++; this.stats.recvBytes += text.length;
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    switch (m.t) {
      case 'pong': this.clock.sample(m.c, m.s, Math.min(at, this.now())); break;
      case 'welcome': this.retry = 0; this.you = m.id; this.token = m.token; this.onEvent('welcome', m); break;
      case 'lobby': this.room = m.room; if (m.room.phase === 'lobby' && this.race) { this.race = null; } this.onEvent('lobby', m); break;
      case 'race': this.beginRace(m); break;
      case 's': this.onSnap(m); break;
      case 'results': this.results = m; if (this.race) this.race.ended = true; this.onEvent('results', m); break;   // stop sending input once the server has finished the race
      case 'error': if (m.error === 'time-ahead') { (this.stats.ahead = this.stats.ahead || []).push({ ahead: m.ahead, phase: m.phase, lead: this.lead, rtt: Math.round(this.clock.rtt), off: Math.round(this.clock.offset), frameMs: Math.round(this.frameMs) }); if (this.stats.ahead.length > 20) this.stats.ahead.shift(); }
        if (m.fatal) { this.fatal = true; this.fatalReason = m.error; } this.onEvent('error', m); break;
      case 'closed': this.fatal = true; this.fatalReason = 'room-closed:' + m.reason; this.onEvent('roomClosed', m); break;
    }
  }
  beginRace(m) {
    if (m.build !== this.build || m.p !== PROTOCOL) { this.onEvent('error', { error: 'build-mismatch', fatal: true }); return; }
    const pred = new Predictor(m, this.simEvents);
    this.race = { msg: m, pred, interp: new Interpolator(pred.sim.track), startAt: m.countdownAt, ended: false };
    this.results = null; this.outbox = []; this.outSeq = pred.seq; this.qe = 4; this.snapN = 0; this.bumpAt = null;   // per-race lead state (a stale cooldown froze lead control in rematches)
    // initial lead: half the round trip + jitter allowance + 2 steps
    this.lead = Math.min(MAX_LEAD_FRAMES, Math.ceil(((this.clock.rtt || 100) / 2 + 30) / (SIM_DT * 1000)) + 2);
    this.onEvent('race', m);
  }
  onSnap(s) {
    const R = this.race; if (!R) return;
    this.stats.snaps++; const sn = this.serverNow(); if (this.stats.snapAges.length < 100000) this.stats.snapAges.push(sn - s.sn);
    R.interp.push(s); R.last = s;
    if (s.ph === 'race') R.pred.reconcile(s);
    // Lead control from what the server actually observed (not from our clock estimate, which a blocked
    // main thread biases): el = lowest recent arrival margin in steps (negative = our frames were late).
    // Keep it >= 4 steps; shrink slowly when it is generous. Floor: our own frame interval + 2 steps.
    if (s.ph === 'race' && s.el != null) {
      this.snapN++;
      if (s.el < 4 && (this.bumpAt == null || this.snapN - this.bumpAt >= 8)) { this.lead += s.el < 0 ? Math.min(30, 6 - s.el) : 2; this.bumpAt = this.snapN; }   // window holds ~0.8 s: one bump per window
      else if (s.el > 24 && this.snapN % 10 === 0) this.lead -= 2;
    }
    const floor = Math.ceil(this.frameMs / (SIM_DT * 1000)) + 2;
    this.lead = Math.max(floor, Math.min(MAX_LEAD_FRAMES, this.lead));
    this.qe += (s.q - this.qe) * 0.15;
    this.onEvent('snap', s);
  }
  // Called every rendered frame with the current local input keys. Returns steps simulated.
  frame(keys) {
    const n = this.now(); this.ping(false);
    if (this.lastFrameAt && this.stats.frameGaps.length < 50000) this.stats.frameGaps.push(n - this.lastFrameAt);
    if (this.lastFrameAt) this.frameMs += (Math.min(500, n - this.lastFrameAt) - this.frameMs) * 0.1; this.lastFrameAt = n;
    const R = this.race; if (!R || !this.clock.ready || R.ended) return 0;
    const target = Math.floor((this.serverNow() - R.startAt) / 1000 / SIM_DT) + this.lead;
    let behind = target - R.pred.seq, steps = 0;
    if (behind > this.stats.behindMax) this.stats.behindMax = behind;
    if (behind > MAX_CATCHUP * 2) { this.stats.resyncSteps += behind; R.pred.resync(target); this.outbox = []; this.outSeq = target; behind = 0; }
    behind = Math.min(behind, MAX_CATCHUP);
    const f = encodeFrame(keys);
    for (let i = 0; i < behind; i++) {
      if (!R.pred.step(f)) break;
      if (!this.outbox.length) this.outSeq = R.pred.seq - 1;
      this.outbox.push(f); steps++;
    }
    if (this.outbox.length && (n - this.lastSend >= 1000 / NET_HZ || this.outbox.length >= 12)) this.flush(n);
    return steps;
  }
  // Plain-data view of the race for rendering (structured-clone safe: crosses the worker boundary).
  // Local car = predicted state + current visual correction; remote cars are NOT included (the renderer
  // interpolates them from forwarded snapshots).
  view() {
    const R = this.race; if (!R) return null;
    const P = R.pred, me = P.me, br = P.sim.track.BR, v = {};
    for (const k of VIEW_FIELDS) { const x = me[k]; v[k] = Array.isArray(x) ? x.slice() : x; }
    v.br = me.path === br; v.crashed = me.crashed;
    if (me.crashed > 0) { v.crashVel = me.crashVel ? { x: me.crashVel.x, y: me.crashVel.y, z: me.crashVel.z } : null; v.crashSpin = me.crashSpin ? { x: me.crashSpin.x, y: me.crashSpin.y, z: me.crashSpin.z } : null; v.world = { x: me.world.x, y: me.world.y, z: me.world.z }; }
    return { me: v, corr: { x: P.correction.x, y: P.correction.y, z: P.correction.z }, time: P.sim.time, raceStart: P.sim.raceStart,
      drones: P.sim.drones.map(d => [d.s, d.d, d.h, d.world.x, d.world.y, d.world.z, d.fi]), fo: R.last ? R.last.fo : [], ended: !!R.ended };
  }
  flush(n = this.now()) {
    while (this.outbox.length) { const f = this.outbox.splice(0, MAX_FRAMES_PER_MSG); this.sendRaw({ t: 'in', q: this.outSeq, f }); this.outSeq += f.length; }
    this.lastSend = n;
  }
}
