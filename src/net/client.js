// Multiplayer connection + race timeline (no DOM, no Three.js). Runs in the browser (src/client/mp.js)
// and in Node for the headless network tests, with an injected WebSocket implementation and clock.
//
// Timeline: the server simulates step k of the race at countdownAt + k * SIM_DT (server clock). The
// client estimates server time (ClockSync) and runs its own prediction AHEAD of the server by `lead`
// steps, so that frame k reaches the server just before the server needs it. The server reports how
// many of our frames are queued (q); lead adapts to keep a small queue (jitter buffer). Local input is
// therefore applied to the local car immediately, never delayed by the round trip.
import { Predictor, Interpolator, ClockSync, MAX_CATCHUP } from './netcode.js';
import { SIM_DT } from '../core/clock.js';
import { PROTOCOL, NET_HZ, encodeFrame, MAX_FRAMES_PER_MSG, normalizeCode, validCode } from './protocol.js';

const RECONNECT_DELAYS = [500, 1000, 2000, 3000, 4000, 4000];
export class NetClient {
  constructor({ wsUrl, WebSocketImpl, now, build, name = 'Player', events = null, onEvent = () => { } }) {
    this.wsUrl = wsUrl; this.WS = WebSocketImpl; this.now = now; this.build = build; this.name = name;
    this.simEvents = events; this.onEvent = onEvent;
    this.ws = null; this.code = null; this.token = null; this.you = null; this.room = null; this.results = null;
    this.race = null; this.clock = new ClockSync(); this.lead = 8; this.qe = 4; this.snapN = 0;
    this.outbox = []; this.outSeq = 0; this.lastSend = 0; this.lastPing = -1e9; this.pingN = 0;
    this.closedByUser = false; this.retry = 0; this.status = 'idle';
    this.stats = { sentMsgs: 0, sentBytes: 0, recvMsgs: 0, recvBytes: 0, snapAges: [], t0: now(), snaps: 0 };
  }
  connect(code, token = null) {
    code = normalizeCode(code); if (!validCode(code)) { this.onEvent('error', { error: 'bad-code', fatal: true }); return false; }
    this.code = code; if (token) this.token = token; this.closedByUser = false; this.open(); return true;
  }
  open() {
    this.status = this.retry ? 'reconnecting' : 'connecting';
    const ws = this.ws = new this.WS(`${this.wsUrl}/api/rooms/${this.code}/ws`);
    ws.onopen = () => { this.status = 'open'; this.retry = 0; this.sendRaw({ t: 'hello', p: PROTOCOL, build: this.build, name: this.name, token: this.token || undefined }); this.ping(true); };
    ws.onmessage = e => this.recv(typeof e.data === 'string' ? e.data : String(e.data));
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

  recv(text) {
    this.stats.recvMsgs++; this.stats.recvBytes += text.length;
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    switch (m.t) {
      case 'pong': this.clock.sample(m.c, m.s, this.now()); break;
      case 'welcome': this.you = m.id; this.token = m.token; this.onEvent('welcome', m); break;
      case 'lobby': this.room = m.room; if (m.room.phase === 'lobby' && this.race) { this.race = null; } this.onEvent('lobby', m); break;
      case 'race': this.beginRace(m); break;
      case 's': this.onSnap(m); break;
      case 'results': this.results = m; this.onEvent('results', m); break;
      case 'error': if (m.fatal) { this.fatal = true; this.fatalReason = m.error; } this.onEvent('error', m); break;
      case 'closed': this.fatal = true; this.fatalReason = 'room-closed:' + m.reason; this.onEvent('roomClosed', m); break;
    }
  }
  beginRace(m) {
    if (m.build !== this.build || m.p !== PROTOCOL) { this.onEvent('error', { error: 'build-mismatch', fatal: true }); return; }
    const pred = new Predictor(m, this.simEvents);
    this.race = { msg: m, pred, interp: new Interpolator(pred.sim.track), startAt: m.countdownAt, ended: false };
    this.results = null; this.outbox = []; this.outSeq = pred.seq; this.qe = 4; this.snapN = 0;
    // initial lead: half the round trip + jitter allowance + 2 steps
    this.lead = Math.min(90, Math.ceil(((this.clock.rtt || 100) / 2 + 30) / (SIM_DT * 1000)) + 2);
    this.onEvent('race', m);
  }
  onSnap(s) {
    const R = this.race; if (!R) return;
    this.stats.snaps++; const sn = this.serverNow(); if (this.stats.snapAges.length < 100000) this.stats.snapAges.push(sn - s.sn);
    R.interp.push(s); R.last = s;
    if (s.ph === 'race') R.pred.reconcile(s);
    // adaptive lead: keep ~2-8 frames queued at the server
    this.qe += (s.q - this.qe) * 0.15;
    if (++this.snapN % 10 === 0 && s.ph === 'race') { if (this.qe < 2) this.lead = Math.min(90, this.lead + 2); else if (this.qe > 8) this.lead = Math.max(1, this.lead - 1); }
    this.onEvent('snap', s);
  }
  // Called every rendered frame with the current local input keys. Returns steps simulated.
  frame(keys) {
    const n = this.now(); this.ping(false);
    const R = this.race; if (!R || !this.clock.ready || R.ended) return 0;
    const target = Math.floor((this.serverNow() - R.startAt) / 1000 / SIM_DT) + this.lead;
    let behind = target - R.pred.seq, steps = 0;
    if (behind > MAX_CATCHUP * 4) { R.pred.resync(target); this.outbox = []; this.outSeq = target; behind = 0; }
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
  flush(n = this.now()) {
    while (this.outbox.length) { const f = this.outbox.splice(0, MAX_FRAMES_PER_MSG); this.sendRaw({ t: 'in', q: this.outSeq, f }); this.outSeq += f.length; }
    this.lastSend = n;
  }
}
