// Page-side proxy for the multiplayer worker (src/net/net-worker.js). Same surface the lobby and the race
// view use on a NetClient (room, you, code, status, results, race, lobby actions, serverNow), but the
// socket, input timeline and prediction run in the worker. The page sends its current input frame and
// renders the latest published view; remote cars are interpolated here from forwarded snapshots.
import { normalizeCode, validCode } from '../net/protocol.js';

export class WorkerNet {
  constructor({ wsUrl, build, name, onEvent, onFx }) {
    this.isWorker = true; this.wsUrl = wsUrl; this.build = build; this.name = name; this.onEvent = onEvent; this.onFx = onFx;
    this.room = null; this.you = null; this.code = null; this.token = null; this.status = 'idle'; this.results = null; this.race = null;
    this.K = null; this.clock = { rtt: 0, ready: false }; this.lead = 0; this.st = null; this.lastKeys = -1; this.lastKeysAt = 0;
    this.w = new Worker(new URL('../net/net-worker.js', import.meta.url), { type: 'module' });
    this.w.onmessage = e => this.recv(e.data);
    this.w.onerror = e => { this.onEvent('error', { error: 'worker-failed', fatal: true, detail: e.message }); };
  }
  apply(st) {
    if (!st) return; this.st = st;
    this.room = st.room; this.you = st.you; this.code = st.code; this.token = st.token; this.status = st.status; this.results = st.results;
    if (st.K != null) { this.K = st.K; this.clock.ready = true; } this.clock.rtt = st.rtt || 0; this.lead = st.lead;
  }
  recv(m) {
    switch (m.t) {
      case 'ev': {
        this.apply(m.st);
        if (m.type === 'race') this.race = { msg: m.m, interp: null, view: null, last: null, ended: false };
        if (m.type === 'lobby' && m.m.room.phase === 'lobby' && this.race) this.race = null;
        if (m.type === 'results' && this.race) this.race.ended = true;
        this.onEvent(m.type, m.m); break;
      }
      case 'snap': if (this.race) { this.race.last = m.s; if (this.race.interp) this.race.interp.push(m.s); } this.onEvent('snap', m.s); break;
      case 'view': if (this.race) this.race.view = m.v; if (m.K != null) { this.K = m.K; this.clock.ready = true; } break;
      case 'state': this.apply(m.st); break;
      case 'fx': this.onFx(m.list); break;
    }
  }
  post(m) { try { this.w.postMessage(m); } catch (e) { } }
  connect(code, token = null) { code = normalizeCode(code); if (!validCode(code)) { this.onEvent('error', { error: 'bad-code', fatal: true }); return false; } this.code = code; this.status = 'connecting'; this.post({ t: 'connect', wsUrl: this.wsUrl, build: this.build, name: this.name, code, token }); return true; }
  call(op, ...args) { this.post({ t: 'call', op, args }); }
  addBot() { this.call('addBot'); } removeBot(b) { this.call('removeBot', b); } config(o) { this.call('config', o); } car(c, p) { this.call('car', c, p); }
  setName(n) { this.name = n; this.call('setName', n); } ready(r) { this.call('ready', r); } start() { this.call('start'); } toLobby() { this.call('toLobby'); }
  leave() { this.post({ t: 'leave' }); this.status = 'closed'; this.race = null; setTimeout(() => { try { this.w.terminate(); } catch (e) { } }, 500); }
  refreshState() { this.post({ t: 'state' }); }
  autodrive(on) { this.post({ t: 'autodrive', on: !!on }); }
  // current input frame; re-sent at least every 200 ms so the worker never runs on an unknown frame
  setKeys(f) { const t = performance.now(); if (f !== this.lastKeys || t - this.lastKeysAt > 200) { this.lastKeys = f; this.lastKeysAt = t; this.post({ t: 'keys', f }); } }
  get isHost() { return !!(this.room && this.you && this.room.hostId === this.you); }
  get me() { return this.room && this.room.seats.find(s => s.id === this.you); }
  serverNow() { return performance.timeOrigin + performance.now() + (this.K || 0); }
}
